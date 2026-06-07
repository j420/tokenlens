/**
 * @prune/anti-synergy (G1/G2/G3)
 *
 * Deterministic guardrails that stop one optimization from busting another:
 * G1 pruner-vs-cache-bust, G2 skip-retrieval-starves-skill-capture,
 * G3 re-squeeze-prefix-bust. Pure predicates over caller-supplied facts; never
 * blocks (returns a safe/blocked verdict + reason); no regex, no model.
 */

export {
  checkPrunerCacheBust,
  checkSkipStarvesCapture,
  checkResqueezePrefixBust,
  type PrunerCacheBustInput,
  type SkipStarvesInput,
  type ResqueezeInput,
  type GuardVerdict,
  type GuardResult,
} from "./guardrails.js";
