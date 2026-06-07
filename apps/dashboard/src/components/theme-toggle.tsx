"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "prune_theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolvedTheme = theme === "system" ? getSystemTheme() : theme;

  if (resolvedTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && ["light", "dark", "system"].includes(stored)) {
      setThemeState(stored);
      applyTheme(stored);
    } else {
      // Dark-first: with no stored preference, the brand canvas is dark.
      setThemeState("dark");
      applyTheme("dark");
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [mounted, theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    localStorage.setItem(STORAGE_KEY, newTheme);
    setThemeState(newTheme);
    applyTheme(newTheme);
  }, []);

  return [theme, setTheme];
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  );
}

function SystemIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={cn("rounded-lg bg-card-hover", compact ? "h-8 w-8" : "h-9 w-24")} />
    );
  }

  if (compact) {
    const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

    return (
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-secondary transition",
          "hover:bg-card-hover hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1"
        )}
        aria-label={`Current theme: ${theme}. Click to switch to ${nextTheme}`}
      >
        {theme === "light" && <SunIcon className="h-4 w-4" />}
        {theme === "dark" && <MoonIcon className="h-4 w-4" />}
        {theme === "system" && <SystemIcon className="h-4 w-4" />}
      </button>
    );
  }

  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="radiogroup" aria-label="Theme selection">
      {(["light", "dark", "system"] as Theme[]).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => setTheme(t)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
            theme === t
              ? "bg-card-hover text-foreground"
              : "text-muted hover:text-secondary"
          )}
        >
          {t === "light" && <SunIcon className="h-3.5 w-3.5" />}
          {t === "dark" && <MoonIcon className="h-3.5 w-3.5" />}
          {t === "system" && <SystemIcon className="h-3.5 w-3.5" />}
          <span className="capitalize">{t}</span>
        </button>
      ))}
    </div>
  );
}
