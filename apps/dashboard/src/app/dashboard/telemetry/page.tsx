"use client";

import { useEffect, useState } from "react";
import { cn, formatCurrency, formatTokens } from "@/lib/utils";
import type {
  FeatureRollup,
  FeatureTelemetryReport,
} from "@/lib/feature-telemetry";

// ============================================================================
// Types
// ============================================================================

interface FeaturesResponse extends FeatureTelemetryReport {
  _meta: {
    storage: "kv" | "memory" | "error";
    hasFeatureTelemetry: boolean;
    scannedEvents: number;
    error?: string;
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Format a nullable number as a token figure, or an honest em-dash. */
function tokensOrDash(value: number | null): string {
  return value === null ? "—" : formatTokens(value);
}

/** Format a nullable USD figure, or an honest em-dash (never a guessed 0). */
function usdOrDash(value: number | null): string {
  return value === null ? "—" : formatCurrency(value);
}

/** Format a nullable 0..1 ratio as a percentage, or an em-dash. */
function pctOrDash(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

/** Format a nullable count, or an em-dash. */
function countOrDash(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

// ============================================================================
// Per-feature summary renderers
// ============================================================================

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-secondary">{label}</span>
      <span
        className={cn(
          "font-mono font-medium",
          value === "—" ? "text-muted" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function FeatureSummaryBody({ rollup }: { rollup: FeatureRollup }) {
  const s = rollup.summary;

  if (rollup.eventCount === 0) {
    return (
      <p className="py-2 text-sm text-muted">
        No {rollup.featureId} telemetry yet.
      </p>
    );
  }

  switch (s.kind) {
    case "f9": {
      const verdicts = Object.entries(s.data.verdictCounts).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      return (
        <div className="divide-y divide-border">
          <MetricRow label="Findings" value={countOrDash(s.data.totalFindings)} />
          <MetricRow
            label="Est. waste"
            value={usdOrDash(s.data.estimatedWasteUsd)}
          />
          <MetricRow
            label="Est. waste tokens"
            value={tokensOrDash(s.data.estimatedWasteTokens)}
          />
          <div className="py-1.5">
            <span className="text-sm text-secondary">Verdicts</span>
            {verdicts.length === 0 ? (
              <span className="ml-2 font-mono text-sm text-muted">—</span>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {verdicts.map(([verdict, count]) => (
                  <span
                    key={verdict}
                    className="rounded-full bg-card-hover px-2 py-0.5 font-mono text-xs text-foreground"
                  >
                    {verdict}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    case "f10":
      return (
        <div className="divide-y divide-border">
          <MetricRow label="Tokens saved" value={tokensOrDash(s.data.savedTokens)} />
          <MetricRow
            label="Full catalog"
            value={tokensOrDash(s.data.fullCatalogTokens)}
          />
          <MetricRow label="Shipped" value={tokensOrDash(s.data.shippedTokens)} />
        </div>
      );
    case "f11":
      return (
        <div className="divide-y divide-border">
          <MetricRow label="USD saved" value={usdOrDash(s.data.savedUsd)} />
          <MetricRow label="Naive cost" value={usdOrDash(s.data.naiveCostUsd)} />
          <MetricRow label="Replay cost" value={usdOrDash(s.data.replayCostUsd)} />
        </div>
      );
    case "f12":
      return (
        <div className="divide-y divide-border">
          <MetricRow
            label="Captures"
            value={s.data.captureCount.toLocaleString()}
          />
          <MetricRow label="Replays" value={s.data.replayCount.toLocaleString()} />
          <MetricRow
            label="Discovery tokens"
            value={tokensOrDash(s.data.discoveryTokens)}
          />
        </div>
      );
    case "f13":
      return (
        <div className="divide-y divide-border">
          <MetricRow label="Hits" value={s.data.hits.toLocaleString()} />
          <MetricRow label="Misses" value={s.data.misses.toLocaleString()} />
          <MetricRow label="Hit rate" value={pctOrDash(s.data.latestHitRate)} />
          <MetricRow
            label="Latency saved (net)"
            value={
              s.data.realizedLatencySavedMs === null
                ? "—"
                : `${Math.round(s.data.realizedLatencySavedMs).toLocaleString()} ms`
            }
          />
          <MetricRow
            label="Speculative elapsed (potential)"
            value={
              s.data.speculativeElapsedMs === null
                ? "—"
                : `${Math.round(s.data.speculativeElapsedMs).toLocaleString()} ms`
            }
          />
        </div>
      );
    case "generic":
      return (
        <p className="py-2 text-sm text-muted">
          Generic telemetry — this feature emits events but has no rich decoder
          yet. The headline metrics above (events, tokens, est. cost) are real.
        </p>
      );
    default:
      return <p className="py-2 text-sm text-muted">No summary available.</p>;
  }
}

function FeatureCard({ rollup }: { rollup: FeatureRollup }) {
  const idle = rollup.eventCount === 0;
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-5 transition",
        idle ? "border-dashed border-border" : "border-border"
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <code className="rounded bg-card-hover px-1.5 py-0.5 font-mono text-xs text-secondary">
              {rollup.featureId}
            </code>
            <h3 className="font-semibold text-foreground">
              {rollup.featureName}
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted">
            {rollup.eventCount.toLocaleString()} event
            {rollup.eventCount === 1 ? "" : "s"}
            {rollup.malformedProofCount > 0 && (
              <>
                {" "}
                · {rollup.malformedProofCount} unreadable proof
                {rollup.malformedProofCount === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>
        <span className="rounded-full bg-card-hover px-2 py-0.5 text-xs font-medium text-secondary">
          shadow
        </span>
      </div>

      {/* Generic, always-honest aggregate columns */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-card-hover px-3 py-2">
          <p className="text-xs text-muted">Tokens in</p>
          <p className="font-mono text-sm font-medium text-foreground">
            {formatTokens(rollup.tokensIn)}
          </p>
        </div>
        <div className="rounded-md bg-card-hover px-3 py-2">
          <p className="text-xs text-muted">Est. cost</p>
          <p className="font-mono text-sm font-medium text-foreground">
            {formatCurrency(rollup.estimatedCostUsd)}
          </p>
        </div>
      </div>

      <FeatureSummaryBody rollup={rollup} />
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function TelemetryPage() {
  const [report, setReport] = useState<FeaturesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/v1/features?limit=500", {
          cache: "no-store",
        });
        const data = (await res.json()) as FeaturesResponse;
        if (!cancelled) setReport(data);
      } catch {
        if (!cancelled) setReport(null);
      }
      if (!cancelled) setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Feature Telemetry
        </h1>
        <p className="mt-1 text-secondary">
          Shadow-mode rollups for the Phase-9.7 features (f9–f13).
        </p>
      </div>

      {/* Shadow-mode caveat — load-bearing honesty, not decoration. */}
      <div className="rounded-lg border border-status-amber/30 bg-status-amber/10 p-4">
        <div className="flex gap-3">
          <span className="text-xl">🕶️</span>
          <div>
            <h3 className="font-medium text-foreground">
              These features run in shadow mode
            </h3>
            <p className="mt-1 text-sm text-secondary">
              f9–f13 collect telemetry in parallel with your sessions but are
              not user-visible yet — none of them change what the AI does. The
              figures below are the quality-proof evidence each feature records,
              used to evaluate whether it is safe to promote. A value shown as{" "}
              <span className="font-mono">—</span> means we could not read that
              number defensibly from the recorded proof; it is never a guess.
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted">Loading feature telemetry…</p>
        </div>
      )}

      {!loading && report && (
        <>
          {/* Data-source / honesty banner */}
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-secondary">
              <span>
                Storage:{" "}
                <span className="font-mono text-foreground">
                  {report._meta.storage}
                </span>
              </span>
              <span>
                Events scanned:{" "}
                <span className="font-mono text-foreground">
                  {report._meta.scannedEvents.toLocaleString()}
                </span>
              </span>
              <span>
                Out-of-scope rows:{" "}
                <span className="font-mono text-foreground">
                  {report.outOfScopeEventCount.toLocaleString()}
                </span>
              </span>
            </div>
            {report._meta.hasFeatureTelemetry && (
              <p className="mt-2 text-muted">
                Showing rollups for the feature-tagged events ingested via{" "}
                <span className="font-mono">POST /api/v1/events</span>. Each card
                reflects the <span className="font-mono">quality_proof</span>{" "}
                blobs those events carried; a value shown as{" "}
                <span className="font-mono">—</span> means it could not be read
                defensibly, never a guess.
              </p>
            )}
            {!report._meta.hasFeatureTelemetry && (
              <p className="mt-2 text-muted">
                No f9–f13 telemetry has been ingested yet. The read-side loop is
                live: any event POSTed to{" "}
                <span className="font-mono">/api/v1/events</span> with a{" "}
                <span className="font-mono">feature_id</span> +{" "}
                <span className="font-mono">quality_proof</span> is accepted,
                stored, and rolled up into the cards below. The canonical f9–f13
                stream is recorded by the extension/MCP hooks into a local SQLite
                sink on the developer&apos;s machine; the only remaining gap is a
                hook that forwards that local telemetry to this ingest API. Until
                tagged events arrive, every card shows an honest empty state.
              </p>
            )}
            {report._meta.storage === "error" && (
              <p className="mt-2 text-status-red">
                Could not read the event store. Showing an empty report rather
                than fabricated data.
              </p>
            )}
          </div>

          {/* Per-feature cards (always f9..f13, deterministic order) */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {report.features.map((rollup) => (
              <FeatureCard key={rollup.featureId} rollup={rollup} />
            ))}
          </div>
        </>
      )}

      {!loading && !report && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted">
            Could not load feature telemetry.
          </p>
        </div>
      )}
    </div>
  );
}
