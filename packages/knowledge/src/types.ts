/**
 * Types for f21 (Repository Knowledge Compiler) + f22 (Proof-Carrying Asset
 * Store) — Verified Repo Memory.
 *
 * Design rules made structural here:
 *  - Every knowledge entry MUST name the file contents it was derived from
 *    (`sourceShas`); an entry with no provenance is unrepresentable, so an
 *    unverifiable memory cannot exist.
 *  - Validity is a STATUS, not an assumption: entries are "valid" only until
 *    a source SHA stops matching the working tree; staleness is recorded
 *    with the exact file that moved, never silently ignored.
 *  - Utility is observed (use counts) or attested (signed proof lineage),
 *    never predicted by a model.
 */

import { z } from "zod";

// ============================================================================
// f21 — compiled repository knowledge
// ============================================================================

export const CompiledSymbolSchema = z
  .object({
    name: z.string().min(1),
    kind: z.string().min(1),
    /** Repo-relative path. */
    filePath: z.string().min(1),
    line: z.number().int().positive(),
    signature: z.string(),
    exported: z.boolean(),
    /**
     * Identifier names referenced in the declaration body — the raw
     * material the symbol graph's edges are resolved from. Dropping these
     * would silently produce an edgeless graph (caught in review of this
     * very file).
     */
    references: z.array(z.string()),
  })
  .strict();
export type CompiledSymbol = z.infer<typeof CompiledSymbolSchema>;

export const CompiledFileSchema = z
  .object({
    /** Repo-relative path, "/"-separated. */
    path: z.string().min(1),
    /** sha256 (hex) of the WORKING-TREE bytes — uncommitted edits invalidate too. */
    contentSha256: z.string().length(64),
    /** Symbols extracted from this file (empty for non-TS/JS sources). */
    symbols: z.array(CompiledSymbolSchema),
    /** Owners resolved from CODEOWNERS (empty when none match / no file). */
    owners: z.array(z.string()),
    /**
     * Commits touching this path in the scan window — a churn SIGNAL (more
     * commits = faster knowledge decay), deliberately not dressed up as a
     * "half-life" the data cannot support.
     */
    commitsInWindow: z.number().int().nonnegative(),
  })
  .strict();
export type CompiledFile = z.infer<typeof CompiledFileSchema>;

export const CompiledEdgeSchema = z
  .object({
    /** "<filePath>#<symbolName>" of the referencing symbol. */
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();
export type CompiledEdge = z.infer<typeof CompiledEdgeSchema>;

export const CompiledKnowledgeSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().min(1),
    /** Window (commit count) the churn signal was computed over. */
    churnWindowCommits: z.number().int().nonnegative(),
    files: z.array(CompiledFileSchema),
    /** Symbol-reference edges (deterministic, from the TS symbol graph). */
    edges: z.array(CompiledEdgeSchema),
    /** True when the file walk stopped at a cap — coverage is partial. */
    truncated: z.boolean(),
    /**
     * sha256 (hex) over the canonical BODY (files+edges+churnWindowCommits,
     * sorted) — excludes generatedAt so identical trees compile to identical
     * hashes regardless of when. The asset's identity.
     */
    contentHash: z.string().length(64),
  })
  .strict();
export type CompiledKnowledge = z.infer<typeof CompiledKnowledgeSchema>;

// ============================================================================
// f22 — proof-carrying knowledge entries
// ============================================================================

export const EntryKindSchema = z.enum([
  /** Human- or agent-authored prose conclusion about the system. */
  "discovery",
  /** A fact mechanically derivable from sources (safe to re-derive). */
  "derived-fact",
  /** Reference to a typed skill (skill-library id). */
  "skill-ref",
  /** Emitted by the compiler itself. */
  "compiled",
]);
export type EntryKind = z.infer<typeof EntryKindSchema>;

export const EntryStatusSchema = z.enum([
  /** Provenance verified against the current tree at last validation. */
  "valid",
  /** At least one source file changed since derivation. */
  "stale",
  /** Superseded by a newer entry with the same (kind, key), or rejected. */
  "demoted",
]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const KnowledgeEntrySchema = z
  .object({
    /** sha256 (hex) of canonical (kind, key, content, sourceShas) — content-addressed. */
    id: z.string().length(64),
    kind: EntryKindSchema,
    /** Logical subject, e.g. "auth/token-refresh" — contradiction unit. */
    key: z.string().min(1),
    /** The knowledge itself (plain text; never executed). */
    content: z.string().min(1),
    /**
     * Provenance: repo-relative path → sha256 of the file content this
     * entry was derived from. MUST be non-empty — no provenance, no entry.
     */
    sourceShas: z.record(z.string(), z.string().length(64)).refine(
      (m) => Object.keys(m).length > 0,
      "an entry must cite at least one source file"
    ),
    /** Entry ids this one was derived from (reasoning lineage). */
    derivedFrom: z.array(z.string().length(64)),
    createdAt: z.string().min(1),
    createdBy: z.enum(["agent", "human", "compiler"]),
    /** Ed25519 over the canonical entry body; null = unsigned (still valid, lower trust). */
    signature: z
      .object({
        publicKeyPem: z.string().min(1),
        signatureBase64: z.string().min(1),
      })
      .nullable(),
    utility: z
      .object({
        /** Times this entry was served while valid. */
        uses: z.number().int().nonnegative(),
        lastUsedAt: z.string().nullable(),
        /** Tokens of attested savings credited to this entry; null = unmeasured. */
        attestedSavingsTokens: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    status: EntryStatusSchema,
    /** Human-readable reason for the current status (e.g. which file moved). */
    statusReason: z.string(),
  })
  .strict();
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

/** Result of validating one entry against the current working tree. */
export interface ValidationVerdict {
  id: string;
  fresh: boolean;
  /** Paths whose current sha differs from (or no longer exists vs) provenance. */
  movedSources: string[];
}
