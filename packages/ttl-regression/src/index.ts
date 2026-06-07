/**
 * @prune/ttl-regression (List1 silent-ttl-regression-detector)
 *
 * Flags a silent provider cache-TTL downgrade by comparing the caller's
 * configured TTL against the host-observed effective TTL. insufficient_signal
 * when either is unknown; never fabricates. No regex, no model.
 */

export {
  detectTtlRegression,
  type TtlObservation,
  type TtlOptions,
  type TtlReport,
} from "./ttl.js";
