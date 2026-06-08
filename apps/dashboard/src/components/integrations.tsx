import { cn } from "@/lib/utils";

// Real integrations the repo actually speaks to — no invented partners.
const TOOLS: { name: string; kind: string }[] = [
  { name: "Claude Code", kind: "agent" },
  { name: "Cursor", kind: "agent" },
  { name: "OpenAI Codex", kind: "agent" },
  { name: "VS Code", kind: "editor" },
  { name: "Anthropic", kind: "provider" },
  { name: "OpenAI", kind: "provider" },
  { name: "Model Context Protocol", kind: "transport" },
  { name: "PostgreSQL", kind: "sink" },
  { name: "SQLite", kind: "sink" },
  { name: "OpenTelemetry", kind: "export" },
  { name: "FOCUS FinOps", kind: "export" },
  { name: "Drizzle ORM", kind: "schema" },
];

export function IntegrationsMarquee() {
  const primary = TOOLS.slice(0, 6);
  return (
    <div className="border-b border-line bg-panel-2/40">
      <div className="mx-auto flex max-w-content flex-wrap items-center justify-center gap-x-6 gap-y-2 px-5 py-4 sm:px-8">
        <span className="mono-label">Works with</span>
        {primary.map((t, i) => (
          <span key={t.name} className="flex items-center gap-x-6">
            {i > 0 && <span className="text-line" aria-hidden>·</span>}
            <span className="font-mono text-xs uppercase tracking-wider text-secondary">
              {t.name}
            </span>
          </span>
        ))}
        <span className="font-mono text-xs uppercase tracking-wider text-muted">
          + 6 more
        </span>
      </div>
    </div>
  );
}

export function IntegrationsGrid({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-4",
        className
      )}
    >
      {TOOLS.map((t) => (
        <div
          key={t.name}
          className="group flex items-center gap-3 bg-panel px-4 py-4 transition-colors hover:bg-card-hover"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line font-mono text-sm text-secondary transition-colors group-hover:border-accent-line group-hover:text-accent-text"
            aria-hidden
          >
            {t.name[0]}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {t.name}
            </span>
            <span className="mono-label">{t.kind}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
