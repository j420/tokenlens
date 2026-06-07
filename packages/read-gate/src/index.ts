/**
 * @prune/read-gate — F16, the Dedup-VoI Read Gate.
 *
 * Public surface:
 *   - evaluateRead(set, req)  → the verdict (allow | deny), pure
 *   - recordRead(set, req)    → new resident set, pure
 *   - stepReadGate(set, req)  → evaluate + record in one step
 *   - emptyResidentSet / advanceEpoch
 *
 * A deny is only ever returned for a proven duplicate (same path, same content
 * hash, same compaction epoch), so it is information-lossless by construction.
 * Pure state machine; no I/O, no regex, no model, no fabricated tokens.
 */

export * from "./types.js";
export {
  advanceEpoch,
  emptyResidentSet,
  evaluateRead,
  recordRead,
  stepReadGate,
} from "./gate.js";
