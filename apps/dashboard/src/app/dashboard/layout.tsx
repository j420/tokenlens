"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { IDESelector, usePreferredIDE } from "@/components/ide-selector";

function VsCodeBanner({ onDismiss, ideName }: { onDismiss: () => void; ideName: string }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <p className="text-sm text-amber-800">
          <span className="mr-2">💡</span>
          Want real-time cost tracking in your editor? Install the Prune extension:{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
            ext install delimit.prune
          </code>
        </p>
        <div className="flex gap-2">
          <a
            href="vscode:extension/delimit.prune"
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Install for {ideName}
          </a>
          <button
            onClick={onDismiss}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
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
    <div className="min-h-screen bg-gray-50">
      {showBanner && <VsCodeBanner onDismiss={handleDismissBanner} ideName={ideName} />}

      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-gray-900 text-white text-sm font-bold">
                TL
              </div>
              <span className="font-semibold text-gray-900">TokenLens</span>
            </Link>
            <nav className="flex gap-1">
              <Link
                href="/dashboard"
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition",
                  pathname === "/dashboard"
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                )}
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard/session"
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition",
                  pathname.startsWith("/dashboard/session")
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                )}
              >
                Sessions
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <IDESelector value={preferredIDE} onChange={setPreferredIDE} compact />
            <a
              href="https://docs.delimit.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Docs
            </a>
            <Link
              href="/dashboard/settings"
              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
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
