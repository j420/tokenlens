/**
 * @prune/waste-memo (F13)
 *
 * Cross-session recurring-waste memo: groups a PII-safe hashed-fingerprint store
 * of waste occurrences, keeps only patterns that recur across enough distinct
 * days, and ranks them worst-first (cost when fully priced, else tokens).
 */

export {
  buildWasteMemo,
  type WasteRecord,
  type WasteMemoOptions,
  type WastePattern,
  type WasteMemo,
} from "./waste-memo.js";
