"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition",
          "focus:outline-none focus:ring-2 focus:ring-offset-1",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Variants
          variant === "primary" && [
            "bg-status-green text-white",
            "hover:bg-emerald-600 focus:ring-status-green",
          ],
          variant === "secondary" && [
            "border border-border bg-card text-foreground",
            "hover:bg-card-hover focus:ring-status-green",
          ],
          variant === "ghost" && [
            "text-secondary",
            "hover:bg-card-hover hover:text-foreground focus:ring-status-green",
          ],
          variant === "danger" && [
            "bg-status-red text-white",
            "hover:bg-red-600 focus:ring-status-red",
          ],
          variant === "success" && [
            "bg-status-green text-white",
            "hover:bg-emerald-600 focus:ring-status-green",
          ],
          // Sizes
          size === "sm" && "px-3 py-1.5 text-sm",
          size === "md" && "px-4 py-2 text-sm",
          size === "lg" && "px-6 py-3 text-base",
          className
        )}
        {...props}
      >
        {loading && (
          <svg
            className="h-4 w-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export { Button };
