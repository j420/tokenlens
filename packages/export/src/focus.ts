/**
 * FOCUS v1.3 (FinOps Open Cost and Usage Specification) exporter.
 *
 * Maps TokenLens BudgetCharge rows into FOCUS-compliant rows so AI
 * spend appears in existing FinOps dashboards (CloudHealth, Apptio,
 * Vantage, Finout, CloudZero) alongside cloud spend. Spec ratified
 * Dec 4, 2025; 68% of $100M+ orgs are using FOCUS-formatted data as
 * of Q1 2026 (https://focus.finops.org/, Amnic FOCUS 2026 guide).
 *
 * v1.3 column set source:
 *   https://focus.finops.org/focus-specification/v1-2/
 *   (the published v1.3 spec extends v1.2 with no required-column
 *    removals; consumers reading v1.2 also read v1.3.)
 *
 * Scope choices for v0.1:
 *   - Emit every spec-required column (per the FOCUS conformance
 *     guidance). Optional columns are filled when we have the data,
 *     null otherwise — FOCUS allows nulls on optionals.
 *   - Treat each BudgetCharge as one Usage line item. The
 *     ChargePeriodStart/End collapse to the charge timestamp; granular
 *     period rollup is the consumer's job (FinOps platforms do this
 *     natively).
 *   - ServiceCategory = "AI and Machine Learning" per the FOCUS
 *     taxonomy guidance for AI-specific spend.
 */

import type { BudgetChargeRow } from "@prune/persistence";

/** FOCUS-required columns (v1.3) with the values we emit. */
export interface FocusRow {
  BilledCost: number;
  ChargeCategory: "Usage";
  ChargeDescription: string;
  ChargePeriodStart: string;
  ChargePeriodEnd: string;
  CommitmentDiscountCategory: null;
  CommitmentDiscountId: null;
  CommitmentDiscountName: null;
  CommitmentDiscountStatus: null;
  CommitmentDiscountType: null;
  ConsumedQuantity: number;
  ConsumedUnit: "tokens";
  ContractedCost: number;
  ContractedUnitPrice: number | null;
  EffectiveCost: number;
  InvoiceIssuerName: string;
  ListCost: number;
  ListUnitPrice: number | null;
  PricingCategory: "Standard";
  PricingQuantity: number;
  PricingUnit: "1M_tokens";
  ProviderName: string;
  PublisherName: string;
  RegionId: null;
  RegionName: null;
  ResourceId: string;
  ResourceName: string;
  ResourceType: "AIModel";
  ServiceCategory: "AI and Machine Learning";
  ServiceName: string;
  ServiceSubcategory: "Generative AI";
  SkuId: string;
  SkuPriceId: string;
  SubAccountId: string | null;
  SubAccountName: string | null;
  /** Free-form, FOCUS-allowed tag bag for downstream filtering. */
  Tags: Record<string, string>;
}

function publisherFor(provider: string): string {
  switch (provider.toLowerCase()) {
    case "anthropic": return "Anthropic";
    case "openai": return "OpenAI";
    case "google":
    case "vertex_ai": return "Google";
    case "aws.bedrock": return "Amazon Web Services";
    default: return provider;
  }
}

function serviceFor(provider: string, model: string): string {
  if (model.toLowerCase().includes("claude")) return "Claude";
  if (model.toLowerCase().includes("gpt")) return "GPT";
  if (model.toLowerCase().includes("gemini")) return "Gemini";
  return provider;
}

export interface FocusMapOptions {
  /** SubAccount id to stamp on every row (e.g. team id). */
  subAccountId?: string;
  subAccountName?: string;
  /** Extra tags to merge onto every row. */
  extraTags?: Record<string, string>;
}

export function mapChargesToFocus(
  charges: BudgetChargeRow[],
  opts: FocusMapOptions = {}
): FocusRow[] {
  const out: FocusRow[] = [];
  for (const c of charges) {
    const totalTokens = c.tokens_in + c.tokens_out + c.tokens_cached + c.tokens_cache_creation;
    const tags: Record<string, string> = {
      envelope_id: c.envelope_id,
      charge_source: c.source,
      ...(c.agent_id ? { agent_id: c.agent_id } : {}),
      ...(opts.extraTags ?? {}),
    };
    out.push({
      BilledCost: c.cost_usd,
      ChargeCategory: "Usage",
      ChargeDescription: `${c.model} inference: ${totalTokens.toLocaleString()} tokens`,
      ChargePeriodStart: c.timestamp,
      ChargePeriodEnd: c.timestamp,
      CommitmentDiscountCategory: null,
      CommitmentDiscountId: null,
      CommitmentDiscountName: null,
      CommitmentDiscountStatus: null,
      CommitmentDiscountType: null,
      ConsumedQuantity: totalTokens,
      ConsumedUnit: "tokens",
      ContractedCost: c.cost_usd,
      ContractedUnitPrice: totalTokens > 0 ? c.cost_usd / (totalTokens / 1_000_000) : null,
      EffectiveCost: c.cost_usd,
      InvoiceIssuerName: publisherFor(c.provider),
      ListCost: c.cost_usd,
      ListUnitPrice: totalTokens > 0 ? c.cost_usd / (totalTokens / 1_000_000) : null,
      PricingCategory: "Standard",
      PricingQuantity: totalTokens,
      PricingUnit: "1M_tokens",
      ProviderName: publisherFor(c.provider),
      PublisherName: publisherFor(c.provider),
      RegionId: null,
      RegionName: null,
      ResourceId: c.charge_id,
      ResourceName: c.model,
      ResourceType: "AIModel",
      ServiceCategory: "AI and Machine Learning",
      ServiceName: serviceFor(c.provider, c.model),
      ServiceSubcategory: "Generative AI",
      SkuId: c.model,
      SkuPriceId: `${c.model}#${c.source}`,
      SubAccountId: opts.subAccountId ?? null,
      SubAccountName: opts.subAccountName ?? null,
      Tags: tags,
    });
  }
  return out;
}
