"use client";

import { usePreferredIDE, getIDEUri } from "@/components/ide-selector";
import { ModeConsole } from "@/components/mode-console";

const QUICK = [
  { id: "smartCopy", label: "Smart Copy" },
  { id: "preflight", label: "Pre-flight" },
  { id: "compactionCheck", label: "Check Compaction" },
  { id: "sessionStats", label: "Session Stats" },
];

export default function FeaturesPage() {
  const [ide] = usePreferredIDE();

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <p className="eyebrow">Every lever, by execution mode</p>
        <h1 className="display mt-3 text-3xl text-foreground">
          Features &amp; levers
        </h1>
        <p className="mt-3 max-w-2xl text-secondary">
          Your agent takes the input; Prune transforms the output. Editor commands you
          run, plus the deterministic backend levers — hooks, MCP tools, and library —
          all grouped by how they execute.
        </p>
      </div>

      {/* Flow + consolidated catalog */}
      <ModeConsole />

      {/* Quick actions */}
      <div className="term-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Quick actions</h2>
        <div className="flex flex-wrap gap-2.5">
          {QUICK.map((q) => (
            <a
              key={q.id}
              href={getIDEUri(ide, q.id)}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-card px-3.5 py-2 text-sm font-medium text-secondary transition-colors hover:border-accent-line hover:text-accent-text"
            >
              {q.label}
              <span className="font-mono text-[10px] text-muted">open ↗</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
