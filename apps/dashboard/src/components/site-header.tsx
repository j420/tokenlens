"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { IDESelector, usePreferredIDE } from "@/components/ide-selector";

const NAV = [
  { label: "Execution modes", href: "/#program" },
  { label: "Proof", href: "/#proof" },
  { label: "Setup", href: "/#setup" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [ide, setIde] = usePreferredIDE();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-content items-center justify-between px-5 sm:px-8">
        <Link href="/" className="rounded-md" aria-label="prune home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-secondary transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 md:flex">
          <IDESelector value={ide} onChange={setIde} compact />
          <ThemeToggle compact />
          <Link
            href="/dashboard"
            className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-on shadow-glow transition hover:bg-[var(--accent-hover)]"
          >
            Open dashboard
          </Link>
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-secondary transition hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              {open ? (
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-background px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2.5 text-sm text-secondary transition hover:bg-card-hover hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className={cn(
                "mt-2 rounded-md bg-accent px-3.5 py-2.5 text-center text-sm font-medium text-accent-on"
              )}
            >
              Open dashboard
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
