import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { cn } from "@/lib/utils";

interface Stat {
  value: string;
  label: string;
  src: string;
  tone?: "accent" | "cyan" | "muted";
}

// Every figure is sourced or labelled — never fabricated.
const STATS: Stat[] = [
  {
    value: "52.7%",
    label: "cost cut at flat solve-rate",
    src: 'Observation masking — "The Complexity Trap", arXiv:2508.21433',
    tone: "accent",
  },
  {
    value: "76.1%",
    label: "of agent tokens are reads",
    src: "SWE-Pruner, arXiv:2601.16746",
    tone: "cyan",
  },
  {
    value: "70–90%",
    label: "Smart Copy token reduction",
    src: "Signatures-only copy, CLAUDE.md",
    tone: "accent",
  },
  {
    value: "null",
    label: "fabricated numbers",
    src: "Unknown model ⇒ null. By construction.",
    tone: "muted",
  },
];

const PILLARS = [
  {
    title: "Deterministic core",
    body: "Every gating decision is AST, hash, graph, or control-math — no model call, no regex. Two runs never disagree.",
  },
  {
    title: "Fail-safe",
    body: "Hooks ship shadow-by-default and can never hang, throw, or block the agent. If intelligence trips, counting still works.",
  },
  {
    title: "Local-first",
    body: "Tokenization, parsing, and the read-side run on your machine. Code never leaves it to be counted. Zero keys.",
  },
  {
    title: "Auditable",
    body: "Counterfactual savings, netted of overhead and Ed25519-signed. Export to OpenTelemetry GenAI + FOCUS.",
  },
];

export function StatTiles() {
  return (
    <div>
      <Reveal className="max-w-2xl">
        <p className="eyebrow">Why it's credible</p>
        <h2 className="display mt-4 text-3xl text-foreground">
          Honest by construction.
        </h2>
        <p className="mt-4 text-secondary">
          Diligence asks one question: how do you know the savings are real? Because
          nothing that gates is a guess — and no number is invented.
        </p>
      </Reveal>

      <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <RevealItem key={s.label} className="term-card p-6">
            <div
              className={cn(
                "numeric text-[2.6rem] font-semibold leading-none",
                s.tone === "cyan"
                  ? "text-cyan"
                  : s.tone === "muted"
                    ? "text-muted"
                    : "text-accent-text"
              )}
            >
              {s.value}
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">{s.label}</div>
            <div className="mt-2 text-xs leading-relaxed text-muted">{s.src}</div>
          </RevealItem>
        ))}
      </RevealGroup>

      <RevealGroup className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map((p) => (
          <RevealItem key={p.title} className="term-card p-5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              <h3 className="font-semibold text-foreground">{p.title}</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-secondary">{p.body}</p>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}
