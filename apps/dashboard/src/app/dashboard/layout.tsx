"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { IDESelector, usePreferredIDE } from "@/components/ide-selector";
import { ThemeToggle } from "@/components/theme-toggle";

function VsCodeBanner({ onDismiss, ideName }: { onDismiss: () => void; ideName: string }) {
  return (
    <div className="border-b border-status-amber/30 bg-status-amber/10 px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p className="text-sm text-foreground">
          <span className="mr-2">💡</span>
          Want real-time cost tracking in your editor? Install the Prune extension:{" "}
          <code className="rounded bg-status-amber/20 px-1.5 py-0.5 font-mono text-xs">
            ext install delimit.prune
          </code>
        </p>
        <div className="flex shrink-0 gap-2">
          <a
            href="vscode:extension/delimit.prune"
            className="rounded-md bg-status-amber px-3 py-1.5 text-sm font-medium text-white transition hover:bg-status-orange focus:outline-none focus:ring-2 focus:ring-status-amber focus:ring-offset-1"
          >
            Install for {ideName}
          </a>
          <button
            onClick={onDismiss}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-status-amber/20 focus:outline-none focus:ring-2 focus:ring-status-amber focus:ring-offset-1"
          >
            Maybe later
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
    if (!dismissed) {
      setShowBanner(true);
    }
  }, []);

  const handleDismissBanner = () => {
    localStorage.setItem("prune_vscode_banner_dismissed", "true");
    setShowBanner(false);
  };

  const ideName = preferredIDE === "cursor" ? "Cursor" : preferredIDE === "vscode" ? "Claude Code" : "Codex";

  return (
    <div className="min-h-screen bg-background">
      {showBanner && <VsCodeBanner onDismiss={handleDismissBanner} ideName={ideName} />}

      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-foreground text-background text-sm font-bold">
                TL
              </div>
              <span className="font-semibold text-foreground">TokenLens</span>
            </Link>
            <nav className="flex gap-1">
              <Link
                href="/dashboard"
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition",
                  pathname === "/dashboard"
                    ? "bg-card-hover text-foreground"
                    : "text-secondary hover:bg-card-hover hover:text-foreground"
                )}
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard/session"
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition",
                  pathname.startsWith("/dashboard/session")
                    ? "bg-card-hover text-foreground"
                    : "text-secondary hover:bg-card-hover hover:text-foreground"
                )}
              >
                Sessions
              </Link>
              <Link
                href="/dashboard/telemetry"
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition",
                  pathname.startsWith("/dashboard/telemetry")
                    ? "bg-card-hover text-foreground"
                    : "text-secondary hover:bg-card-hover hover:text-foreground"
                )}
              >
                Telemetry
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <IDESelector value={preferredIDE} onChange={setPreferredIDE} compact />
            <ThemeToggle compact />
            <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <a
              href="https://docs.delimit.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-2.5 py-1.5 text-sm text-secondary transition hover:bg-card-hover hover:text-foreground focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-1"
            >
              Docs
            </a>
            <Link
              href="/dashboard/settings"
              className="rounded-md bg-card-hover px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-border focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-1"
            >
              Settings
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
