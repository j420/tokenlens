/**
 * @prune/export
 *
 * Open-standard exporters that move TokenLens data into the FinOps and
 * observability stacks teams already run.
 *
 * Standards targeted:
 *   - OpenTelemetry GenAI semantic conventions
 *     (https://opentelemetry.io/docs/specs/semconv/gen-ai/)
 *   - FOCUS v1.3 — FinOps Open Cost & Usage Specification
 *     (https://focus.finops.org/focus-specification/v1-2/, ratified
 *      Dec 4, 2025)
 *
 * Neither emitter ships a network client; both emit structured
 * payloads the consumer pipes to an OTel Collector / FinOps data lake.
 * That keeps this package tiny and gives the consumer full control
 * over destination, retries, and credentials.
 */

export {
  mapChargesToOtel,
  KNOWN_GEN_AI_SYSTEMS,
  type OtelSpan,
  type OtelMetric,
  type OtelExportPayload,
  type OtelMapOptions,
} from "./otel.js";

export {
  mapChargesToFocus,
  type FocusRow,
  type FocusMapOptions,
} from "./focus.js";

export { rowsToCsv } from "./csv.js";

/** FOCUS v1.3 required + recommended columns in canonical order. */
export const FOCUS_COLUMNS = [
  "BilledCost",
  "ChargeCategory",
  "ChargeDescription",
  "ChargePeriodStart",
  "ChargePeriodEnd",
  "CommitmentDiscountCategory",
  "CommitmentDiscountId",
  "CommitmentDiscountName",
  "CommitmentDiscountStatus",
  "CommitmentDiscountType",
  "ConsumedQuantity",
  "ConsumedUnit",
  "ContractedCost",
  "ContractedUnitPrice",
  "EffectiveCost",
  "InvoiceIssuerName",
  "ListCost",
  "ListUnitPrice",
  "PricingCategory",
  "PricingQuantity",
  "PricingUnit",
  "ProviderName",
  "PublisherName",
  "RegionId",
  "RegionName",
  "ResourceId",
  "ResourceName",
  "ResourceType",
  "ServiceCategory",
  "ServiceName",
  "ServiceSubcategory",
  "SkuId",
  "SkuPriceId",
  "SubAccountId",
  "SubAccountName",
  "Tags",
] as const;
