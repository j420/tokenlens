/**
 * @prune/context-health (F6)
 *
 * Public surface. Hook scripts and the MCP server consume these
 * symbols; downstream packages should not reach into individual
 * source modules.
 */

export * from "./types.js";
export * from "./constants.js";
export {
  computeEcf,
  computeEcfSeries,
  dominantModel,
  aggregateSource,
} from "./ecf.js";
export {
  CusumDetector,
  initialCusumState,
  observe as cusumObserve,
  resetCusum,
} from "./cusum.js";
export {
  cacheHitTrend,
  scopeDriftSlope,
  largeToolResultCause,
} from "./drift.js";
export {
  ContextHealthDetector,
  initialDetectorState,
  replayDetector,
  type DetectorState,
  type ReplayResult,
} from "./detector.js";
export {
  buildAdvisory,
  inferPrimaryCause,
  SCOPE_DRIFT_THRESHOLD,
  VOLATILE_PREFIX_THRESHOLD,
} from "./advisor.js";
export { buildReport, type BuildReportOptions } from "./report.js";
export {
  readPersistedRegime,
  statePathFor,
  type ReadPersistedRegimeOptions,
} from "./state-reader.js";
