"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
} from "framer-motion";
import { cn } from "@/lib/utils";
import {
  EXECUTION_MODES,
  SURFACE_META,
  type ExecutionMode,
  type Line,
  type Verdict,
} from "@/lib/execution-modes";

const CYCLE_MS = 6000;

export function ExecutionModeShowcase() {
  const reduce = useReducedMotion();
  const [activeId, setActiveId] = useState(EXECUTION_MODES[0].id);
  const [paused, setPaused] = useState(false);
  const active =
    EXECUTION_MODES.find((m) => m.id === activeId) ?? EXECUTION_MODES[0];

  // Auto-advance unless paused or reduced-motion.
  useEffect(() => {
    if (paused || reduce) return;
    const t = setTimeout(() => {
      const i = EXECUTION_MODES.findIndex((m) => m.id === activeId);
      setActiveId(EXECUTION_MODES[(i + 1) % EXECUTION_MODES.length].id);
    }, CYCLE_MS);
    return () => clearTimeout(t);
  }, [activeId, paused, reduce]);

  return (
    <div
      className="grid gap-4 lg:grid-cols-[300px_1fr]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Mode switcher */}
      <div
        className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        role="tablist"
        aria-label="Execution modes"
      >
        {EXECUTION_MODES.map((m) => {
          const on = m.id === activeId;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={on}
              onClick={() => setActiveId(m.id)}
              className={cn(
                "group relative shrink-0 rounded-lg border p-3 text-left transition-colors lg:shrink",
                on
                  ? "border-accent-line bg-card-hover"
                  : "border-line bg-card hover:bg-card-hover"
              )}
            >
              <div className="flex items-center gap-2">
                <SurfaceDot surface={m.surface} on={on} />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  {m.surface}
                </span>
              </div>
              <div
                className={cn(
                  "mt-1.5 text-sm font-medium",
                  on ? "text-foreground" : "text-secondary"
                )}
              >
                {m.title}
              </div>
              {on && !reduce && (
                <motion.span
                  layoutId="mode-progress"
                  className="absolute inset-x-0 bottom-0 hidden h-px bg-accent lg:block"
                />
              )}
              {on && (
                <motion.span
                  key={m.id + "-bar"}
                  className="absolute bottom-0 left-0 h-px bg-accent"
                  initial={{ width: reduce ? "100%" : 0 }}
                  animate={{ width: "100%" }}
                  transition={{
                    duration: reduce || paused ? 0 : CYCLE_MS / 1000,
                    ease: "linear",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Terminal panel */}
      <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-lift">
        <ModePanelHeader mode={active} />
        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="p-5 sm:p-6"
          >
            <ModeBody mode={active} reduce={!!reduce} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function SurfaceDot({
  surface,
  on,
}: {
  surface: ExecutionMode["surface"];
  on: boolean;
}) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full transition-colors",
        on ? "bg-accent" : "bg-muted"
      )}
      aria-hidden
    />
  );
}

function ModePanelHeader({ mode }: { mode: ExecutionMode }) {
  return (
    <div className="flex items-center justify-between border-b border-line bg-panel-2 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-line" />
          <span className="h-2.5 w-2.5 rounded-full border border-line" />
          <span className="h-2.5 w-2.5 rounded-full border border-line" />
        </span>
        <span className="ml-2 font-mono text-xs text-secondary">
          {mode.handle}
        </span>
      </div>
      <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted sm:block">
        {SURFACE_META[mode.surface].tag}
      </span>
    </div>
  );
}

function ModeBody({ mode, reduce }: { mode: ExecutionMode; reduce: boolean }) {
  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.18 } },
  };
  const item = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 6 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  };

  return (
    <div>
      <p className="text-sm text-secondary">{mode.blurb}</p>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mt-5 space-y-1.5 font-mono text-[13px] leading-relaxed"
      >
        <motion.div variants={item} className="text-foreground">
          {mode.trigger}
        </motion.div>
        {mode.lines.map((l, i) => (
          <motion.div key={i} variants={item}>
            <LineRow line={l} />
          </motion.div>
        ))}
      </motion.div>

      {/* Result */}
      <motion.div
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          delay: reduce ? 0 : 0.4 + mode.lines.length * 0.18,
          duration: 0.4,
        }}
        className="mt-5 border-t border-line pt-4"
      >
        <ResultBlock mode={mode} reduce={reduce} />
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
          <ProvenanceIcon kind={mode.figure.kind} />
          <span>{mode.figure.text}</span>
        </p>
      </motion.div>
    </div>
  );
}

function LineRow({ line }: { line: Line }) {
  if (line.tone === "decision") {
    return (
      <div className="flex gap-2 text-foreground">
        <span className="select-none text-accent-text">⇒</span>
        <span>{line.text.replace(/^⇒\s*/, "")}</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        line.tone === "trigger" ? "text-foreground" : "text-secondary"
      )}
    >
      {line.text}
    </div>
  );
}

function ResultBlock({ mode, reduce }: { mode: ExecutionMode; reduce: boolean }) {
  if (mode.result.kind === "verdict") {
    return (
      <div className="flex items-center gap-3">
        <VerdictStamp verdict={mode.result.verdict} reduce={reduce} />
        <span className="numeric text-sm text-foreground">
          {mode.result.detail}
        </span>
      </div>
    );
  }
  return (
    <DeltaResult
      from={mode.result.from}
      to={mode.result.to}
      label={mode.result.label}
      reduce={reduce}
    />
  );
}

function VerdictStamp({
  verdict,
  reduce,
}: {
  verdict: Verdict;
  reduce: boolean;
}) {
  const danger = verdict === "DENY";
  return (
    <motion.span
      initial={reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.15 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 18 }}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-sm font-semibold tracking-wider",
        danger
          ? "border-status-red text-status-red"
          : "border-accent-line text-accent-text glow"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          danger ? "bg-status-red" : "bg-accent"
        )}
      />
      {verdict}
    </motion.span>
  );
}

function DeltaResult({
  from,
  to,
  label,
  reduce,
}: {
  from: number;
  to: number;
  label: string;
  reduce: boolean;
}) {
  const value = useCountDown(from, to, reduce);
  const saved = from - to;
  const pct = Math.round((saved / from) * 100);
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div>
        <div className="numeric text-3xl font-semibold tabular-nums text-foreground">
          {value.toLocaleString()}
        </div>
        <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">
          {label}
        </div>
      </div>
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-xs text-muted line-through">
          {from.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-line px-2 py-0.5 font-mono text-xs text-accent-text">
          −{saved.toLocaleString()} · {pct}%
        </span>
      </div>
    </div>
  );
}

function ProvenanceIcon({
  kind,
}: {
  kind: ExecutionMode["figure"]["kind"];
}) {
  const label =
    kind === "cited" ? "cited" : kind === "guarantee" ? "guarantee" : "illustrative";
  return (
    <span
      className="mt-0.5 shrink-0 font-mono text-[10px] uppercase tracking-wider text-accent-text"
      aria-label={label}
      title={label}
    >
      [{label.slice(0, 4)}]
    </span>
  );
}

/** Eased count from `from` to `to`, once, when mounted. Respects reduced motion. */
function useCountDown(from: number, to: number, reduce: boolean, duration = 1100) {
  const [v, setV] = useState(reduce ? to : from);
  const raf = useRef<number>();
  useEffect(() => {
    if (reduce) {
      setV(to);
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (to - from) * e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [from, to, reduce, duration]);
  return v;
}
