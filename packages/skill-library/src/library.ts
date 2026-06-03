/**
 * SkillLibrary — the in-memory store + matcher.
 *
 * Holds a set of skills keyed by content hash (so re-capturing the same
 * logical skill dedups and bumps its useCount instead of duplicating). Matches
 * a new task prompt against stored skills by Jaccard over intent terms, returns
 * candidates above a threshold sorted by similarity. Serializes to a flat
 * `SkillLibraryState` for the persistence layer.
 *
 * Pure data structure: no I/O. The host wires `serialize()`/`fromState()` to
 * its sink and atomic-write layer.
 */

import { jaccard, tokenizeIntent } from "./tokenize.js";
import type {
  Skill,
  SkillLibraryState,
  SkillMatch,
} from "./types.js";

export interface MatchOptions {
  /** Minimum Jaccard similarity to count as a match. Default 0.5. */
  threshold?: number;
  /** Max matches to return (highest similarity first). Default 5. */
  limit?: number;
}

export interface PruneOptions {
  /** Drop skills older than this many days (by capturedAtIso). */
  maxAgeDays?: number;
  /** Keep at most this many skills (highest useCount, then newest). */
  maxSkills?: number;
}

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_LIMIT = 5;

export class SkillLibrary {
  private readonly byHash = new Map<string, Skill>();

  constructor(initial: readonly Skill[] = []) {
    for (const s of initial) this.byHash.set(s.contentHash, s);
  }

  /** Number of skills held. */
  get size(): number {
    return this.byHash.size;
  }

  /**
   * Add a skill. If a byte-identical skill (same content hash) already exists,
   * the existing one is kept and its useCount preserved — re-capture is
   * idempotent. Returns the skill that now lives in the library.
   */
  add(skill: Skill): Skill {
    const existing = this.byHash.get(skill.contentHash);
    if (existing) return existing;
    this.byHash.set(skill.contentHash, skill);
    return skill;
  }

  /** Look up a skill by its content hash. */
  get(contentHash: string): Skill | undefined {
    return this.byHash.get(contentHash);
  }

  /** All skills, in a deterministic order (by id). */
  list(): Skill[] {
    return [...this.byHash.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Match a task prompt against stored skills. Pure read; does not mutate
   * useCount (call `recordReuse` when a match is actually replayed).
   */
  match(taskPrompt: string, options: MatchOptions = {}): SkillMatch[] {
    const threshold = options.threshold ?? DEFAULT_THRESHOLD;
    const limit = options.limit ?? DEFAULT_LIMIT;
    const terms = tokenizeIntent(taskPrompt);
    const matches: SkillMatch[] = [];
    for (const skill of this.byHash.values()) {
      const { similarity, intersection } = jaccard(terms, skill.intentSignature);
      if (similarity >= threshold) {
        matches.push({ skill, similarity, matchedTerms: intersection });
      }
    }
    // Sort by similarity desc, tie-break by useCount desc then id for stability.
    matches.sort(
      (a, b) =>
        b.similarity - a.similarity ||
        b.skill.useCount - a.skill.useCount ||
        a.skill.id.localeCompare(b.skill.id)
    );
    return matches.slice(0, limit);
  }

  /**
   * Record that a skill was actually reused. Increments useCount. Returns the
   * updated skill, or undefined if the hash is unknown.
   */
  recordReuse(contentHash: string): Skill | undefined {
    const s = this.byHash.get(contentHash);
    if (!s) return undefined;
    const updated: Skill = { ...s, useCount: s.useCount + 1 };
    this.byHash.set(contentHash, updated);
    return updated;
  }

  /** Remove a skill by content hash. Returns true if one was removed. */
  retire(contentHash: string): boolean {
    return this.byHash.delete(contentHash);
  }

  /**
   * Prune stale / excess skills. Age pruning uses `now` (injected for
   * determinism in tests). Count pruning keeps the most-used, then newest.
   * Returns the content hashes removed.
   */
  prune(options: PruneOptions, now: Date = new Date()): string[] {
    const removed: string[] = [];
    if (options.maxAgeDays !== undefined) {
      const cutoff = now.getTime() - options.maxAgeDays * 86_400_000;
      for (const [hash, skill] of this.byHash) {
        if (Date.parse(skill.capturedAtIso) < cutoff) {
          this.byHash.delete(hash);
          removed.push(hash);
        }
      }
    }
    if (options.maxSkills !== undefined && this.byHash.size > options.maxSkills) {
      const ranked = [...this.byHash.values()].sort(
        (a, b) =>
          b.useCount - a.useCount ||
          Date.parse(b.capturedAtIso) - Date.parse(a.capturedAtIso) ||
          a.id.localeCompare(b.id)
      );
      for (const skill of ranked.slice(options.maxSkills)) {
        this.byHash.delete(skill.contentHash);
        removed.push(skill.contentHash);
      }
    }
    return removed.sort();
  }

  /** Serialize to a flat state for persistence. Deterministic order. */
  serialize(): SkillLibraryState {
    return { version: 1, skills: this.list() };
  }

  /** Reconstruct a library from a persisted state. */
  static fromState(state: SkillLibraryState): SkillLibrary {
    if (state.version !== 1) {
      throw new Error(
        `skill-library: unsupported state version ${state.version}`
      );
    }
    return new SkillLibrary(state.skills);
  }
}
