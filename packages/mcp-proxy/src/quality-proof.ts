/**
 * `quality_proof` schema for the MCP-proxy.
 *
 * One row per `tools/list` interception. The persistence sink records
 * `feature_id = "f10"` + the payload built here; the post-hoc auditor can
 * re-run the intent matcher against the recorded inputs and assert the
 * same kept/hidden sets.
 *
 * Schema is intentionally flat and small. Tool-name lists are sorted at
 * build time so two audit rows with the same logical content hash to the
 * same JSON bytes (cache-stable for downstream observability).
 */

import type { ReductionAudit } from "./types.js";

export const MCP_PROXY_FEATURE_ID = "f10" as const;
export const QUALITY_PROOF_SCHEMA_VERSION = 1 as const;

export interface McpProxyQualityProof {
  schemaVersion: 1;
  featureId: "f10";
  audit: ReductionAudit;
}

export function buildQualityProof(audit: ReductionAudit): McpProxyQualityProof {
  return {
    schemaVersion: QUALITY_PROOF_SCHEMA_VERSION,
    featureId: MCP_PROXY_FEATURE_ID,
    audit,
  };
}
