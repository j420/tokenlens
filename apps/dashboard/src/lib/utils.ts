import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function formatPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function getSpendColor(amount: number): string {
  if (amount <= 2) return "text-prune-green";
  if (amount <= 5) return "text-prune-amber";
  return "text-prune-red";
}

export function getRoiColor(roi: number): string {
  if (roi >= 0.7) return "text-prune-green";
  if (roi >= 0.4) return "text-prune-amber";
  return "text-prune-red";
}

export function getRoiBgColor(roi: number): string {
  if (roi >= 0.7) return "bg-prune-green";
  if (roi >= 0.4) return "bg-prune-amber";
  return "bg-prune-red";
}
