import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type StatusTone =
  | "critical"
  | "deny"
  | "progress"
  | "mask"
  | "match"
  | "act"
  | "signed"
  | "ready"
  | "local"
  | "neutral";

const TONE: Record<StatusTone, { text: string; dot: string; glow?: string }> = {
  critical: { text: "text-critical", dot: "bg-critical" },
  deny: { text: "text-status-red", dot: "bg-status-red" },
  progress: { text: "text-status-amber", dot: "bg-status-amber" },
  mask: { text: "text-status-amber", dot: "bg-status-amber" },
  match: { text: "text-cyan", dot: "bg-cyan", glow: "glow-cyan" },
  act: { text: "text-accent-text", dot: "bg-accent", glow: "glow" },
  signed: { text: "text-cyan", dot: "bg-cyan", glow: "glow-cyan" },
  ready: { text: "text-accent-text", dot: "bg-accent" },
  local: { text: "text-cyan", dot: "bg-cyan" },
  neutral: { text: "text-secondary", dot: "bg-muted" },
};

/** Cogent-style status badge — CRITICAL / DENY / MATCH / ACT / SIGNED … */
export function StatusBadge({
  tone = "neutral",
  glow = false,
  children,
  className,
}: {
  tone?: StatusTone;
  glow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span className={cn("status-badge", t.text, glow && t.glow, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} aria-hidden />
      {children}
    </span>
  );
}
