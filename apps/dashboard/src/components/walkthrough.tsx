import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { StatusBadge, type StatusTone } from "@/components/status-badge";

interface Step {
  n: string;
  title: string;
  body: string;
  badge: { tone: StatusTone; label: string };
  detail: string;
}

const STEPS: Step[] = [
  {
    n: "01",
    title: "Connect",
    body: "Point Prune at your agent — extension, MCP server, or lifecycle hooks. Provider-neutral, zero API keys, nothing to host.",
    badge: { tone: "ready", label: "READY" },
    detail: "claude code · cursor · codex",
  },
  {
    n: "02",
    title: "Watch",
    body: "It reads every tool call, token, and decision locally and scores where the spend goes — no code leaves your machine.",
    badge: { tone: "local", label: "LOCAL" },
    detail: "sqlite · otel-genai",
  },
  {
    n: "03",
    title: "Cut",
    body: "Deterministic levers trim waste at the source: denied re-reads, masked stale context, priced actions. No model in the decision.",
    badge: { tone: "deny", label: "DENY −2,400" },
    detail: "read-gate · observation-mask",
  },
  {
    n: "04",
    title: "Prove",
    body: "Net savings are counterfactual, overhead-subtracted, and Ed25519-signed. Export to your FinOps stack. Unknown model ⇒ null.",
    badge: { tone: "signed", label: "SIGNED" },
    detail: "ed25519 · focus export",
  },
];

export function Walkthrough() {
  return (
    <div>
      <Reveal className="max-w-2xl">
        <p className="eyebrow">How it runs</p>
        <h2 className="display mt-4 text-3xl text-foreground sm:text-[2.6rem]">
          Connect. Watch. Cut. Prove.
        </h2>
        <p className="mt-4 text-secondary">
          Four steps, one discipline — every decision deterministic, fail-safe, and
          auditable end to end.
        </p>
      </Reveal>

      <RevealGroup className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <RevealItem
            key={s.n}
            className="glass flex flex-col p-5"
          >
            <div className="flex items-baseline justify-between">
              <span className="numeric text-2xl font-semibold text-accent-text">
                {s.n}
              </span>
              <StatusBadge tone={s.badge.tone} glow>
                {s.badge.label}
              </StatusBadge>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-secondary">
              {s.body}
            </p>
            <div className="mt-4 border-t border-line pt-3 font-mono text-[11px] uppercase tracking-wider text-muted">
              {s.detail}
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}
