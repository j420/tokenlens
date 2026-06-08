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
  "MCP tool": "border-accent-line text-accent-text",
  Hook: "border-line text-status-amber",
  Library: "border-line text-secondary",
};

function SurfaceBadge({ surface }: { surface: TcrpSurface }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
        SURFACE_STYLE[surface]
      )}
    >
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
        <div className="max-w-2xl">
          <p className="eyebrow">The program</p>
          <h2 className="display mt-4 text-3xl text-foreground sm:text-[2.6rem]">
            Token-Cost Reduction Program
          </h2>
          <p className="mt-4 text-secondary">
            <span className="numeric text-foreground">{TCRP_COUNT}</span> deterministic backend
            levers — MCP self-regulation tools and Claude Code lifecycle hooks. Every one has a
            deterministic decision core (no model call, no regex), is fail-safe, and never fabricates
            a token/cost number — unknown model{" "}
            <span className="null-value">⇒ null</span>.
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
                filter === id ? "bg-accent text-accent-on" : "bg-card-hover text-secondary hover:bg-border"
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
            className="group rounded-lg border border-line bg-card p-5 transition-colors duration-200 hover:border-accent-line hover:bg-card-hover"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{f.icon}</span>
                <h3 className="font-semibold text-foreground">{f.name}</h3>
              </div>
              <SurfaceBadge surface={f.surface} />
            </div>
            <p className="text-sm text-secondary">{f.description}</p>
            <code className="mt-3 inline-block border-none bg-transparent p-0 font-mono text-xs text-muted">
              {f.ref}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
