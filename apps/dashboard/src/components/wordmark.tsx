import { cn } from "@/lib/utils";

/** The prune mark — a deterministic descending staircase (cost coming down). */
export function PruneMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7"
        className="fill-panel-2"
        stroke="var(--line)"
      />
      <path
        d="M7 8.5 H12 V14.5 H17 V20.5 H22"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="8.5" r="2.1" fill="var(--accent)" />
      <circle cx="24.5" cy="22.5" r="1.6" fill="var(--accent)" fillOpacity="0.5" />
    </svg>
  );
}

export function Wordmark({
  className,
  markClassName,
  showText = true,
}: {
  className?: string;
  markClassName?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <PruneMark className={cn("h-7 w-7", markClassName)} />
      {showText && (
        <span className="text-[17px] font-semibold tracking-tight text-foreground">
          prune
          <span className="ml-1 align-top text-[10px] font-medium uppercase tracking-[0.18em] text-muted">
            by tokenlens
          </span>
        </span>
      )}
    </span>
  );
}
