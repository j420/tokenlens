"use client";

import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
  size?: "sm" | "md";
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", size = "sm", ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full font-medium",
          // Sizes
          size === "sm" && "px-2 py-0.5 text-xs",
          size === "md" && "px-2.5 py-1 text-sm",
          // Variants
          variant === "default" && "bg-card-hover text-secondary",
          variant === "success" && "bg-status-green/10 text-status-green",
          variant === "warning" && "bg-status-amber/10 text-status-amber",
          variant === "danger" && "bg-status-red/10 text-status-red",
          variant === "info" && "bg-secondary/10 text-secondary",
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";

// Impact badge for features
export function ImpactBadge({ impact }: { impact: "high" | "medium" | "low" }) {
  const variant = impact === "high" ? "success" : impact === "medium" ? "warning" : "default";
  const label = impact === "high" ? "High Impact" : impact === "medium" ? "Medium" : "Utility";

  return <Badge variant={variant}>{label}</Badge>;
}

// Status badge for sessions/tasks
export function StatusBadge({ status }: { status: "active" | "completed" | "failed" | "pending" }) {
  const config = {
    active: { variant: "success" as const, label: "Active" },
    completed: { variant: "info" as const, label: "Completed" },
    failed: { variant: "danger" as const, label: "Failed" },
    pending: { variant: "warning" as const, label: "Pending" },
  };

  const { variant, label } = config[status];
  return <Badge variant={variant}>{label}</Badge>;
}

// Keybinding badge for shortcuts
export function KeybindingBadge({
  keybinding,
}: {
  keybinding: { windows: string; mac: string } | undefined;
}) {
  if (!keybinding) return null;

  // Detect OS on client
  const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

  return (
    <kbd className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-secondary">
      {isMac ? keybinding.mac : keybinding.windows}
    </kbd>
  );
}

export { Badge };
