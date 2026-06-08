"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  cmd: string;
  hint: string;
}

// Real, repo-grounded install paths (no invented package names).
const TABS: Tab[] = [
  {
    id: "vsix",
    label: "Extension",
    cmd: "code --install-extension prune-0.1.0.vsix",
    hint: "VS Code · Cursor · Codex",
  },
  {
    id: "source",
    label: "From source",
    cmd: "npm install && npm run build",
    hint: "build the workspace",
  },
  {
    id: "hooks",
    label: "Claude Code hooks",
    cmd: "node apps/extension/hooks/install.mjs",
    hint: "advisors · breakers · forwarder",
  },
];

function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2M6 8h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2z" />
    </svg>
  );
}

export function InstallTabs() {
  const [active, setActive] = useState(TABS[0].id);
  const [copied, setCopied] = useState(false);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="term-card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-line bg-panel-2 px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setActive(t.id);
              setCopied(false);
            }}
            role="tab"
            aria-selected={t.id === active}
            className={cn(
              "rounded-md px-2.5 py-1 font-mono text-xs transition-colors",
              t.id === active
                ? "bg-card text-foreground"
                : "text-muted hover:text-secondary"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="select-none font-mono text-sm text-accent-text" aria-hidden>
          $
        </span>
        <code className="flex-1 overflow-x-auto whitespace-nowrap bg-transparent p-0 font-mono text-sm text-foreground">
          {tab.cmd}
        </code>
        <button
          onClick={copy}
          aria-label="Copy command"
          className="shrink-0 rounded-md border border-line p-1.5 text-secondary transition-colors hover:border-accent-line hover:text-accent-text"
        >
          <CopyIcon copied={copied} />
        </button>
      </div>
      <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-muted">
        — {tab.hint} · zero API keys · local-first
      </div>
    </div>
  );
}
