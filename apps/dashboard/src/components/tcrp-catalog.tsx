"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  TCRP_FEATURES,
  TCRP_CATEGORIES,
  TCRP_COUNT,
  type TcrpCategory,
  type TcrpSurface,
} from "@/lib/tcrp-catalog";

type Filter = "all" | TcrpCategory;

const SURFACE_STYLE: Record<TcrpSurface, string> = {
  "MCP tool": "bg-status-green/10 text-status-green border-status-green/20",
  Hook: "bg-status-amber/10 text-status-amber border-status-amber/20",
  Library: "bg-secondary/10 text-secondary border-secondary/20",
};

function SurfaceBadge({ surface }: { surface: TcrpSurface }) {
  return (
    <span className={cn("rounded border px-2 py-0.5 text-xs font-medium", SURFACE_STYLE[surface])}>
      {surface}
    </span>
  );
}

/**
 * Renders the Token-Cost Reduction Program catalog (MCP tools + hooks +
 * library levers) with a category filter. Honest, read-only: these are not
 * editor commands, so there is no "open in IDE" — each card shows its surface
 * and concrete handle (MCP tool name / hook file).
 *
 * `compact` trims the intro for embedding on the landing page.
 */
export function TcrpCatalog({ compact = false }: { compact?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered =
    filter === "all" ? TCRP_FEATURES : TCRP_FEATURES.filter((f) => f.category === filter);

  const counts: Record<Filter, number> = {
    all: TCRP_COUNT,
    "cost-security": 0,
    "cache-provider": 0,
    "context-selection": 0,
    "value-economics": 0,
    learning: 0,
    integrity: 0,
  };
  for (const f of TCRP_FEATURES) counts[f.category] += 1;

  return (
    <div className="space-y-6">
      {!compact && (
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Token-Cost Reduction Program</h2>
          <p className="mt-2 text-secondary">
            {TCRP_COUNT} deterministic backend levers — MCP self-regulation tools and Claude Code
            lifecycle hooks. Every one has a deterministic decision core (no model call, no regex),
            is fail-safe, and never fabricates a token/cost number (unknown model → null).
          </p>
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {([{ id: "all", label: "All" }, ...TCRP_CATEGORIES] as { id: Filter; label: string }[]).map(
          ({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                filter === id ? "bg-prune-green text-white" : "bg-card-hover text-secondary hover:bg-border"
              )}
            >
              {label}
              <span
                className={cn(
                  "ml-2 rounded-full px-2 py-0.5 text-xs",
                  filter === id ? "bg-white/20" : "bg-border"
                )}
              >
                {counts[id]}
              </span>
            </button>
          )
        )}
      </div>

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((f) => (
          <div
            key={f.id}
            className="group rounded-lg border border-border bg-card p-5 transition hover:border-secondary hover:shadow-sm"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{f.icon}</span>
                <h3 className="font-semibold text-foreground">{f.name}</h3>
              </div>
              <SurfaceBadge surface={f.surface} />
            </div>
            <p className="text-sm text-secondary">{f.description}</p>
            <code className="mt-3 inline-block text-xs text-secondary">{f.ref}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
