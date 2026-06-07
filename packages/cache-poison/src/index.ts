/**
 * @prune/cache-poison (F21)
 *
 * Attributes cache-poisoning economic harm to a WRITER identity (equivalence-
 * rejection + near-key-collision rates) and recommends per-writer quarantine =
 * REVALIDATE (never delete). Deterministic rate accounting over caller-fed
 * outcomes; fail-open; no model call, no regex.
 */

export {
  assessWriters,
  type WriteEvent,
  type PoisonOptions,
  type WriterStat,
  type PoisonReport,
} from "./poison.js";
