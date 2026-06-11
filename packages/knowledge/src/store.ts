/**
 * f22 — Proof-Carrying Asset Store: repo-local memory under warranty.
 *
 * What "warranty" means, mechanically:
 *  - WRITES are screened (sentinel injection + secret scans — a memory
 *    store served back into agent context is an injection vector, so a
 *    failing scan REJECTS the write, fail-closed) and content-addressed
 *    (id = sha256 of the canonical body, so an entry cannot be silently
 *    edited in place).
 *  - PROVENANCE is mandatory: every entry cites the file contents it was
 *    derived from; `validate()` re-checks those SHAs against the working
 *    tree and an entry whose sources moved becomes `stale` — named files,
 *    named reason, never served as fresh.
 *  - CONTRADICTION demotes: storing a new valid entry for the same
 *    (kind, key) demotes the previous one with a supersededBy reason. Two
 *    "current" truths about one subject cannot coexist.
 *  - READS never trust the disk: `retrieve()` and `search()` validate at
 *    read time; stale results are returned only when explicitly asked for
 *    (`includeStale`), always labeled.
 *  - SEARCH is deterministic token overlap — a charwise tokenizer (no
 *    regex, no embeddings, no model) over key+content.
 *
 * Concurrency note (v0, documented): writes are atomic (tmp+rename) and
 * last-writer-wins on the whole store file. Two simultaneous writers can
 * drop one write; acceptable for a single-developer repo-local store and
 * honest here rather than hidden.
 */

import {
  createHash,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanForInjection, scanForSecrets } from "@prune/sentinel";
import { canonicalize } from "@prune/wastebench";
import { knowledgeDir, writeAtomic } from "./compiler.js";
import {
  KnowledgeEntrySchema,
  type EntryKind,
  type KnowledgeEntry,
  type ValidationVerdict,
} from "./types.js";

// ============================================================================
// Tokenizer (charwise; no regex)
// ============================================================================

function isWordChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_"
  );
}

/** Lowercased word tokens of length ≥ 2, by character scan. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const c of text) {
    if (isWordChar(c)) {
      current += c.toLowerCase();
    } else if (current.length > 0) {
      if (current.length >= 2) tokens.push(current);
      current = "";
    }
  }
  if (current.length >= 2) tokens.push(current);
  return tokens;
}

// ============================================================================
// Entry construction
// ============================================================================

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Canonical signed/addressed body — excludes mutable fields (status, utility). */
export function entryCanonicalBody(e: {
  kind: EntryKind;
  key: string;
  content: string;
  sourceShas: Record<string, string>;
  derivedFrom: string[];
  createdAt: string;
  createdBy: KnowledgeEntry["createdBy"];
}): string {
  return canonicalize({
    kind: e.kind,
    key: e.key,
    content: e.content,
    sourceShas: e.sourceShas,
    derivedFrom: [...e.derivedFrom].sort(),
    createdAt: e.createdAt,
    createdBy: e.createdBy,
  });
}

export interface NewEntryInput {
  kind: EntryKind;
  key: string;
  content: string;
  /** Repo-relative path → sha256 of the content this was derived from. */
  sourceShas: Record<string, string>;
  derivedFrom?: string[];
  createdBy: KnowledgeEntry["createdBy"];
  /** PKCS8 PEM private key; omit for an unsigned (lower-trust) entry. */
  signingKeyPem?: { privateKeyPem: string; publicKeyPem: string };
  now?: () => string;
}

export type StoreRejection = {
  rejected: true;
  /** Which screen refused the write and why — fail-closed, visible. */
  reason: string;
};

export function buildEntry(
  input: NewEntryInput
): KnowledgeEntry | StoreRejection {
  // Screen BEFORE anything else: a knowledge store is re-served into agent
  // context, which makes it an injection/exfiltration vector.
  const injections = scanForInjection(input.content);
  if (injections.length > 0) {
    return {
      rejected: true,
      reason: `sentinel injection screen: ${injections[0].patternId} (${injections[0].label}) — write refused`,
    };
  }
  const secrets = scanForSecrets(input.content);
  if (secrets.length > 0) {
    return {
      rejected: true,
      reason: `sentinel secret screen: ${secrets[0].patternId} (${secrets[0].label}) — write refused`,
    };
  }
  const createdAt = (input.now ?? (() => new Date().toISOString()))();
  const body = {
    kind: input.kind,
    key: input.key,
    content: input.content,
    sourceShas: input.sourceShas,
    derivedFrom: input.derivedFrom ?? [],
    createdAt,
    createdBy: input.createdBy,
  };
  const canonical = entryCanonicalBody(body);
  let signature: KnowledgeEntry["signature"] = null;
  if (input.signingKeyPem) {
    // Ed25519 one-shot sign (no digest pre-hash) — the same contract
    // wastebench uses for attestation manifests.
    signature = {
      publicKeyPem: input.signingKeyPem.publicKeyPem,
      signatureBase64: cryptoSign(
        null,
        Buffer.from(canonical, "utf8"),
        input.signingKeyPem.privateKeyPem
      ).toString("base64"),
    };
  }
  const entry: KnowledgeEntry = {
    id: sha256Hex(canonical),
    ...body,
    derivedFrom: [...(input.derivedFrom ?? [])].sort(),
    signature,
    utility: { uses: 0, lastUsedAt: null, attestedSavingsTokens: null },
    status: "valid",
    statusReason: "provenance verified at creation",
  };
  return KnowledgeEntrySchema.parse(entry);
}

/** Verify an entry's signature against its own canonical body. */
export function verifyEntrySignature(entry: KnowledgeEntry): boolean {
  if (entry.signature === null) return false;
  try {
    return cryptoVerify(
      null,
      Buffer.from(entryCanonicalBody(entry), "utf8"),
      entry.signature.publicKeyPem,
      Buffer.from(entry.signature.signatureBase64, "base64")
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Validation against the working tree
// ============================================================================

export type FileShaReader = (repoRelativePath: string) => string | null;

export function defaultFileShaReader(repoRoot: string): FileShaReader {
  return (path) => {
    try {
      return createHash("sha256")
        .update(readFileSync(join(repoRoot, path)))
        .digest("hex");
    } catch {
      return null; // missing file = moved source
    }
  };
}

/** Pure given an injected reader: fresh ⇔ every cited source is byte-identical. */
export function validateEntry(
  entry: KnowledgeEntry,
  readSha: FileShaReader
): ValidationVerdict {
  const moved: string[] = [];
  for (const [path, sha] of Object.entries(entry.sourceShas)) {
    const current = readSha(path);
    if (current !== sha) moved.push(path);
  }
  return { id: entry.id, fresh: moved.length === 0, movedSources: moved.sort() };
}

// ============================================================================
// The store
// ============================================================================

export interface SearchHit {
  entry: KnowledgeEntry;
  /** Overlap score (matched query tokens / query tokens), 0..1. */
  score: number;
  fresh: boolean;
}

export class KnowledgeStore {
  private entries: Map<string, KnowledgeEntry>;

  private constructor(
    private readonly repoRoot: string,
    entries: KnowledgeEntry[],
    private readonly readSha: FileShaReader
  ) {
    this.entries = new Map(entries.map((e) => [e.id, e]));
  }

  static storePath(repoRoot: string): string {
    return join(knowledgeDir(repoRoot), "entries.json");
  }

  /**
   * Load the store; entries that fail schema validation are dropped WITH a
   * report (never silently, never a crash).
   */
  static open(
    repoRoot: string,
    readSha?: FileShaReader
  ): { store: KnowledgeStore; invalidEntries: number } {
    const path = KnowledgeStore.storePath(repoRoot);
    let invalid = 0;
    const entries: KnowledgeEntry[] = [];
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const parsed = KnowledgeEntrySchema.safeParse(item);
            if (parsed.success) entries.push(parsed.data);
            else invalid++;
          }
        }
      } catch {
        invalid++;
      }
    }
    return {
      store: new KnowledgeStore(
        repoRoot,
        entries,
        readSha ?? defaultFileShaReader(repoRoot)
      ),
      invalidEntries: invalid,
    };
  }

  /** All entries (any status), sorted by createdAt then id — for audit views. */
  list(): KnowledgeEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
  }

  /**
   * Store a new entry. Screening happens in buildEntry; this enforces the
   * contradiction rule: a prior valid/stale entry with the same (kind, key)
   * is demoted as superseded. Returns the stored entry or the rejection.
   */
  store(input: NewEntryInput): KnowledgeEntry | StoreRejection {
    const built = buildEntry(input);
    if ("rejected" in built) return built;
    if (this.entries.has(built.id)) {
      // Content-addressed: the identical entry already exists — idempotent.
      return this.entries.get(built.id)!;
    }
    for (const existing of this.entries.values()) {
      if (
        existing.kind === built.kind &&
        existing.key === built.key &&
        existing.status !== "demoted"
      ) {
        this.entries.set(existing.id, {
          ...existing,
          status: "demoted",
          statusReason: `superseded by ${built.id}`,
        });
      }
    }
    this.entries.set(built.id, built);
    this.persist();
    return built;
  }

  /**
   * Retrieve by id: validity is re-checked NOW, not trusted from disk. A
   * stale entry is returned only with includeStale, and its persisted
   * status is downgraded so the staleness is durable.
   */
  retrieve(
    id: string,
    opts: { includeStale?: boolean; now?: () => string } = {}
  ): { entry: KnowledgeEntry; verdict: ValidationVerdict } | null {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.status === "demoted") return null;
    const verdict = validateEntry(entry, this.readSha);
    if (!verdict.fresh) {
      const stale: KnowledgeEntry = {
        ...entry,
        status: "stale",
        statusReason: `source(s) changed since derivation: ${verdict.movedSources.join(", ")}`,
      };
      this.entries.set(id, stale);
      this.persist();
      if (!opts.includeStale) return null;
      return { entry: stale, verdict };
    }
    const used: KnowledgeEntry = {
      ...entry,
      status: "valid",
      statusReason: "provenance verified at last read",
      utility: {
        ...entry.utility,
        uses: entry.utility.uses + 1,
        lastUsedAt: (opts.now ?? (() => new Date().toISOString()))(),
      },
    };
    this.entries.set(id, used);
    this.persist();
    return { entry: used, verdict };
  }

  /**
   * Deterministic token-overlap search over (key + content). Fresh entries
   * only unless includeStale; every hit carries its freshness verdict.
   */
  search(
    query: string,
    opts: { limit?: number; includeStale?: boolean } = {}
  ): SearchHit[] {
    const queryTokens = [...new Set(tokenize(query))];
    if (queryTokens.length === 0) return [];
    const limit = opts.limit ?? 10;
    const hits: SearchHit[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "demoted") continue;
      const verdict = validateEntry(entry, this.readSha);
      if (!verdict.fresh && !opts.includeStale) continue;
      const entryTokens = new Set(tokenize(entry.key + " " + entry.content));
      let matched = 0;
      for (const t of queryTokens) if (entryTokens.has(t)) matched++;
      if (matched === 0) continue;
      hits.push({
        entry: verdict.fresh
          ? entry
          : {
              ...entry,
              status: "stale",
              statusReason: `source(s) changed since derivation: ${verdict.movedSources.join(", ")}`,
            },
        score: matched / queryTokens.length,
        fresh: verdict.fresh,
      });
    }
    hits.sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.utility.uses - a.entry.utility.uses ||
        a.entry.id.localeCompare(b.entry.id)
    );
    return hits.slice(0, limit);
  }

  /** Re-validate every non-demoted entry; persists status flips. Returns the verdicts. */
  validateAll(): ValidationVerdict[] {
    const verdicts: ValidationVerdict[] = [];
    let changed = false;
    for (const entry of this.entries.values()) {
      if (entry.status === "demoted") continue;
      const verdict = validateEntry(entry, this.readSha);
      verdicts.push(verdict);
      const nextStatus = verdict.fresh ? "valid" : "stale";
      if (entry.status !== nextStatus) {
        this.entries.set(entry.id, {
          ...entry,
          status: nextStatus,
          statusReason: verdict.fresh
            ? "provenance verified"
            : `source(s) changed since derivation: ${verdict.movedSources.join(", ")}`,
        });
        changed = true;
      }
    }
    if (changed) this.persist();
    return verdicts.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Credit attested savings to an entry (called by the proof pipeline only). */
  creditAttestedSavings(id: string, tokens: number): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined || !Number.isFinite(tokens) || tokens < 0) {
      return false; // garbage credit is refused, not clamped
    }
    this.entries.set(id, {
      ...entry,
      utility: {
        ...entry.utility,
        attestedSavingsTokens:
          (entry.utility.attestedSavingsTokens ?? 0) + Math.round(tokens),
      },
    });
    this.persist();
    return true;
  }

  private persist(): void {
    writeAtomic(
      KnowledgeStore.storePath(this.repoRoot),
      JSON.stringify(this.list(), null, 2) + "\n"
    );
  }
}
