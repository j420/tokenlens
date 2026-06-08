import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-background">
      <div className="mx-auto max-w-content px-5 py-14 sm:px-8">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div className="max-w-sm">
            <Wordmark />
            <p className="mt-4 text-sm leading-relaxed text-secondary">
              Deterministic cost control for AI coding agents. Local-first,
              fail-safe, and honest by construction — unknown model, no number.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <FooterCol
              title="Product"
              links={[
                { label: "Execution modes", href: "/#program" },
                { label: "Proof", href: "/#proof" },
                { label: "Dashboard", href: "/dashboard" },
              ]}
            />
            <FooterCol
              title="Surfaces"
              links={[
                { label: "Features", href: "/dashboard/features" },
                { label: "Telemetry", href: "/dashboard/telemetry" },
                { label: "Sessions", href: "/dashboard/session" },
                { label: "Settings", href: "/dashboard/settings" },
              ]}
            />
            <FooterCol
              title="Trust"
              links={[
                { label: "Deterministic core", href: "/#proof" },
                { label: "Signed attestations", href: "/#proof" },
                { label: "OTel · FOCUS export", href: "/#proof" },
                { label: "Local-first", href: "/#proof" },
              ]}
            />
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-line pt-6 text-xs text-muted sm:flex-row sm:items-center">
          <span className="numeric">© {new Date().getFullYear()} TokenLens · MIT</span>
          <span className="font-mono uppercase tracking-wider">
            no fabricated numbers · unknown model ⇒ null
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-muted">
        {title}
      </h4>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-sm text-secondary transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
