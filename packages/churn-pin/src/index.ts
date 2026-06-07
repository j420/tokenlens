/**
 * @prune/churn-pin (F9)
 *
 * Git-churn cache-pin planner: pin low-churn files into the cacheable prefix and
 * keep high-churn ones out, using recent commit frequency as a forward-looking
 * invalidation proxy. Deterministic over caller-supplied churn counts; PII-safe.
 */

export {
  planChurnPins,
  type ChurnFile,
  type ChurnPinOptions,
  type PinReason,
  type PinDecision,
  type ChurnPinPlan,
} from "./churn-pin.js";
