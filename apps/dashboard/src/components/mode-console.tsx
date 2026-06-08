"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  IDESelector,
  usePreferredIDE,
  getIDEUri,
} from "@/components/ide-selector";
import { EXEC_MODES, MODE_TOTAL, type ModeItem } from "@/lib/surfaces";

// ── The flow: agent in → Prune transforms → fewer tokens out ───────────────
function FlowStage({
  kicker,
  title,
  lines,
  accent,
}: {
  kicker: string;
  title: string;
  lines: string[];
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-lg border bg-panel px-4 py-3",
        accent ? "border-accent-line" : "border-line"
      )}
    >
      <div className="mono-label">{kicker}</div>
      <div
        className={cn(
          "mt-1 text-sm font-semibold",
          accent ? "text-accent-text" : "text-foreground"
        )}
      >
        {title}
      </div>
      <div className="mt-1 font-mono text-xs leading-relaxed text-muted">
        {lines.join("  ·  ")}
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <span className="flow-arrow shrink-0 select-none px-1 text-center font-mono text-sm md:py-0">
      <span className="hidden md:inline">→</span>
      <span className="md:hidden">↓</span>
    </span>
  );
}

function Flow() {
  return (
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
      <FlowStage
        kicker="input"
        title="Your agent"
        lines={["Claude Code", "Cursor", "Codex"]}
      />
      <FlowArrow />
      <FlowStage
        kicker="transform"
        title="Prune"
        lines={["command", "hook", "mcp", "library"]}
        accent
      />
      <FlowArrow />
      <FlowStage
        kicker="output"
        title="Same result"
        lines={["fewer tokens", "lower cost", "0 fabricated"]}
      />
    </div>
  );
}

// ── Item rows ──────────────────────────────────────────────────────────────
function CommandRow({ item, ide }: { item: ModeItem; ide: string }) {
  const href = getIDEUri(ide as Parameters<typeof getIDEUri>[0], item.commandId!);
  return (
    <a
      href={href}
      className="group flex items-start justify-between gap-3 rounded-md border border-line bg-card px-3.5 py-3 transition-colors hover:border-accent-line hover:bg-card-hover"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{item.name}</span>
        <span className="mt-0.5 block text-xs text-muted">{item.desc}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        {item.keybinding && (
          <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-secondary">
            {item.keybinding.mac}
          </kbd>
        )}
        <span className="font-mono text-[10px] text-muted transition-colors group-hover:text-accent-text">
          open ↗
        </span>
      </span>
    </a>
  );
}

function FeatureRow({ item }: { item: ModeItem }) {
  return (
    <div className="rounded-md border border-line bg-card px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{item.name}</span>
        <code className="shrink-0 border-none bg-transparent p-0 font-mono text-[11px] text-muted">
          {item.ref}
        </code>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">{item.desc}</p>
    </div>
  );
}

export function ModeConsole() {
  const [active, setActive] = useState(EXEC_MODES[0].id);
  const [ide, setIde] = usePreferredIDE();
  const mode = EXEC_MODES.find((m) => m.id === active) ?? EXEC_MODES[0];

  return (
    <div>
      <Flow />

      {/* Tabs */}
      <div
        className="mt-8 flex flex-wrap gap-2"
        role="tablist"
        aria-label="Execution modes"
      >
        {EXEC_MODES.map((m) => {
          const on = m.id === active;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={on}
              onClick={() => setActive(m.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors",
                on
                  ? "border-accent-line bg-card-hover text-foreground"
                  : "border-line bg-card text-secondary hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  on ? "bg-accent" : "bg-muted"
                )}
                aria-hidden
              />
              {m.label}
              <span className="numeric text-xs text-muted">{m.items.length}</span>
            </button>
          );
        })}
        <span className="ml-auto self-center font-mono text-xs text-muted">
          {MODE_TOTAL} levers · {EXEC_MODES.length} modes
        </span>
      </div>

      {/* Panel */}
      <div className="mt-4 term-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-panel-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {mode.label}
              </h3>
              <span className="mono-label">{mode.tag}</span>
            </div>
            <p className="mt-1 text-xs text-secondary">
              <span className="text-accent-text">{mode.transform}.</span> {mode.when}
            </p>
          </div>
          {mode.id === "command" && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="mono-label">editor</span>
              <IDESelector value={ide} onChange={setIde} compact />
            </div>
          )}
        </div>

        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {mode.items.map((item) =>
            mode.id === "command" ? (
              <CommandRow key={item.ref} item={item} ide={ide} />
            ) : (
              <FeatureRow key={item.ref} item={item} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
