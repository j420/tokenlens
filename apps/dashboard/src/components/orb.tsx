import { cn } from "@/lib/utils";

/**
 * Cinematic gradient orb (Cogent). Decorative, pointer-events-none.
 * Position + size via className (e.g. "h-[420px] w-[420px] -top-32 right-0").
 */
export function Orb({
  color = "cyan",
  className,
}: {
  color?: "cyan" | "navy" | "coral";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "orb",
        color === "cyan" && "orb-cyan",
        color === "navy" && "orb-navy",
        color === "coral" && "orb-coral",
        className
      )}
    />
  );
}
