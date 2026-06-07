"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { IDESelector, usePreferredIDE } from "@/components/ide-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

const NAV = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/session", label: "Sessions" },
  { href: "/dashboard/telemetry", label: "Telemetry" },
  { href: "/dashboard/features", label: "Features" },
];

function VsCodeBanner({ onDismiss, ideName }: { onDismiss: () => void; ideName: string }) {
  return (
    <div className="border-b border-line bg-panel-2">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5">
        <p className="text-sm text-secondary">
          <span className="mr-2 text-accent-text">›</span>
          Real-time cost tracking in your editor —{" "}
          <code className="rounded border border-line bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
            ext install delimit.prune
          </code>
        </p>
        <div className="flex shrink-0 gap-2">
          <a
            href="vscode:extension/delimit.prune"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition hover:brightness-95"
          >
            Install for {ideName}
          </a>
          <button
            onClick={onDismiss}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-secondary transition hover:bg-card-hover hover:text-foreground"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [showBanner, setShowBanner] = useState(false);
  const [preferredIDE, setPreferredIDE] = usePreferredIDE();

  useEffect(() => {
    const dismissed = localStorage.getItem("prune_vscode_banner_dismissed");
    if (!dismissed) setShowBanner(true);
  }, []);

  const handleDismissBanner = () => {
    localStorage.setItem("prune_vscode_banner_dismissed", "true");
    setShowBanner(false);
  };

  const ideName = preferredIDE === "cursor" ? "Cursor" : preferredIDE === "vscode" ? "Claude Code" : "Codex";

  return (
    <div className="min-h-screen bg-background">
      {showBanner && <VsCodeBanner onDismiss={handleDismissBanner} ideName={ideName} />}

      <header className="sticky top-0 z-40 border-b border-line bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-8">
            <Link href="/" className="rounded-md" aria-label="prune home">
              <Wordmark />
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "text-foreground"
                        : "text-secondary hover:text-foreground"
                    )}
                  >
                    {item.label}
                    {active && (
                      <span className="absolute inset-x-3 -bottom-3 h-px bg-accent" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <IDESelector value={preferredIDE} onChange={setPreferredIDE} compact />
            <ThemeToggle compact />
            <div className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
            <a
              href="https://docs.delimit.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-2.5 py-1.5 text-sm text-secondary transition hover:bg-card-hover hover:text-foreground"
            >
              Docs
            </a>
            <Link
              href="/dashboard/settings"
              className="rounded-md border border-line bg-card px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-card-hover"
            >
              Settings
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
