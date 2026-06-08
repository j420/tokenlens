"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast, toast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { MODE_TOTAL } from "@/lib/surfaces";
import { InstallTabs } from "@/components/install-tabs";
import { ResultLedger } from "@/components/result-ledger";
import { IntegrationsMarquee, IntegrationsGrid } from "@/components/integrations";
import { Walkthrough } from "@/components/walkthrough";
import { StatTiles } from "@/components/stat-tiles";
import { ModeConsole } from "@/components/mode-console";

type OnboardStep = 1 | 2 | 3;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [signupState, setSignupState] = useState<"idle" | "loading" | "success">("idle");
  const [showOnboard, setShowOnboard] = useState(false);
  const [onboardStep, setOnboardStep] = useState<OnboardStep>(1);
  const [copied, setCopied] = useState(false);
  const { addToast } = useToast();
  const toastHelpers = toast(addToast);

  const validateEmail = useCallback((value: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value) {
      setEmailError("Email is required");
      return false;
    }
    if (!emailRegex.test(value)) {
      setEmailError("Please enter a valid email address");
      return false;
    }
    setEmailError("");
    return true;
  }, []);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) return;
    setSignupState("loading");
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      setSignupState("success");
      setShowOnboard(true);
      toastHelpers.success("Welcome!", "Let's get you set up with Prune.");
    } catch {
      setSignupState("idle");
      toastHelpers.error("Signup failed", "Please try again later.");
    }
  };

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toastHelpers.success("Copied!", "Command copied to clipboard.");
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toastHelpers.error("Copy failed", "Could not copy to clipboard.");
      }
    },
    [toastHelpers]
  );

  const handleOpenDashboard = () => router.push("/dashboard");

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-content px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr]">
            <Reveal>
              <Eyebrow>Token-cost reduction program</Eyebrow>
              <h1 className="display mt-5 text-[clamp(2.5rem,5.6vw,4.1rem)] text-foreground">
                Make every token count.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-secondary">
                Deterministic cost control for AI coding agents. See what you spend,
                where the waste is, and what you're about to spend — then cut it
                automatically, with no fabricated numbers and nothing leaving your machine.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="#setup"
                  className="rounded-md bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-on shadow-glow transition hover:bg-[var(--accent-hover)]"
                >
                  Get started
                </a>
                <a
                  href="#program"
                  className="inline-flex items-center gap-2 rounded-md border border-line bg-card px-5 py-2.5 text-[15px] font-medium text-foreground transition hover:border-secondary"
                >
                  See it run
                  <span aria-hidden>▸</span>
                </a>
              </div>
              <div className="mt-8">
                <InstallTabs />
              </div>
            </Reveal>

            <Reveal delay={0.1} className="lg:pl-2">
              <ResultLedger />
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 font-mono text-xs text-muted">
                <span>deterministic</span>
                <span className="text-line">/</span>
                <span>fail-safe</span>
                <span className="text-line">/</span>
                <span>local-first</span>
                <span className="text-line">/</span>
                <span className="text-accent-text">{MODE_TOTAL} levers · 4 modes</span>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Works-with marquee ───────────────────────────────── */}
      <IntegrationsMarquee />

      {/* ── 01–04 walkthrough ────────────────────────────────── */}
      <section className="border-b border-line py-20 sm:py-24">
        <div className="mx-auto max-w-content px-5 sm:px-8">
          <Walkthrough />
        </div>
      </section>

      {/* ── Every lever, by execution mode (the flow + catalog) ── */}
      <section id="program" className="border-b border-line py-24 sm:py-28">
        <div className="mx-auto max-w-content px-5 sm:px-8">
          <Reveal className="max-w-2xl">
            <Eyebrow>Every lever, by execution mode</Eyebrow>
            <h2 className="display mt-4 text-3xl text-foreground">
              Your agent takes the input.<br />Prune transforms the output.
            </h2>
            <p className="mt-4 text-secondary">
              Claude Code, Cursor and Codex stay the input taker. Prune sits in the
              middle and transforms what the agent reads, sends and spends — at one of
              four execution modes. Same result, fewer tokens.
            </p>
          </Reveal>
          <Reveal delay={0.08} className="mt-10">
            <ModeConsole />
          </Reveal>
        </div>
      </section>

      {/* ── Proof / credibility ──────────────────────────────── */}
      <section id="proof" className="border-b border-line py-20 sm:py-24">
        <div className="mx-auto max-w-content px-5 sm:px-8">
          <StatTiles />
        </div>
      </section>

      {/* ── Integrations ─────────────────────────────────────── */}
      <section className="border-b border-line py-20 sm:py-24">
        <div className="mx-auto max-w-content px-5 sm:px-8">
          <Reveal className="max-w-2xl">
            <Eyebrow>Integrations</Eyebrow>
            <h2 className="display mt-4 text-3xl text-foreground">
              Plugs into the stack you already run.
            </h2>
            <p className="mt-4 text-secondary">
              Provider-neutral by design — agents, editors, providers, sinks, and the
              open standards your FinOps team already speaks.
            </p>
          </Reveal>
          <Reveal delay={0.08} className="mt-10">
            <IntegrationsGrid />
          </Reveal>
        </div>
      </section>

      {/* ── Setup ────────────────────────────────────────────── */}
      <section id="setup" className="border-b border-line py-20 sm:py-24">
        <div className="mx-auto max-w-content px-5 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <Reveal>
              <Eyebrow>Quick setup</Eyebrow>
              <h2 className="display mt-4 text-3xl text-foreground">
                Running in under a minute.
              </h2>
              <p className="mt-4 text-secondary">
                Build the workspace, package the extension, install the VSIX in your
                editor. No accounts, no keys, no proxy.
              </p>
            </Reveal>

            <Reveal delay={0.08} className="rounded-xl border border-line bg-panel p-2">
              <ol className="divide-y divide-line">
                {[
                  { n: 1, t: "Install dependencies", code: "npm install" },
                  { n: 2, t: "Build all packages", code: "npm run build" },
                  { n: 3, t: "Package the extension", code: "cd apps/extension && npm run package" },
                  { n: 4, t: "Install the VSIX", code: "Extensions → ⋯ → Install from VSIX → prune-0.1.0.vsix" },
                ].map((s) => (
                  <li key={s.n} className="flex gap-4 p-4">
                    <span className="numeric flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-sm text-accent-text">
                      {s.n}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{s.t}</p>
                      <div className="mt-2 overflow-x-auto rounded-md border border-line bg-background px-3 py-2">
                        <code className="whitespace-pre text-[13px] text-foreground">{s.code}</code>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Get started / onboarding ─────────────────────────── */}
      <section id="get-started" className="bg-panel-2/30 py-20 sm:py-24">
        <div className="mx-auto max-w-xl px-5 sm:px-8">
          <div className="rounded-xl border border-line bg-card p-6 shadow-lift">
            {!showOnboard ? (
              <>
                <h2 className="text-xl font-semibold text-foreground">Get started</h2>
                <p className="mt-2 text-sm text-secondary">
                  Enter your email to begin setup. We'll guide you through installation.
                </p>

                <form onSubmit={handleSignup} className="mt-6" noValidate>
                  <label htmlFor="signup-email" className="block text-sm font-medium text-foreground">
                    Email
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) validateEmail(e.target.value);
                    }}
                    onBlur={() => email && validateEmail(email)}
                    placeholder="you@company.com"
                    aria-invalid={emailError ? "true" : undefined}
                    aria-describedby={emailError ? "email-error" : undefined}
                    className={cn(
                      "mt-2 w-full rounded-md border bg-background px-3 py-2.5 text-foreground transition",
                      "placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      emailError
                        ? "border-status-red focus-visible:ring-status-red"
                        : "border-line focus-visible:ring-accent"
                    )}
                  />
                  {emailError && (
                    <p id="email-error" className="mt-1.5 text-sm text-status-red" role="alert">
                      {emailError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={signupState === "loading"}
                    className={cn(
                      "mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-on transition",
                      "hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    {signupState === "loading" && (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {signupState === "loading" ? "Starting…" : "Start setup"}
                  </button>
                </form>

                <p className="mt-4 text-center text-xs text-muted">
                  No credit card required. Free forever for individuals.
                </p>
              </>
            ) : (
              <div>
                <div className="mb-6 flex items-center gap-3">
                  {[1, 2, 3].map((s) => (
                    <div key={s} className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition",
                          onboardStep >= s
                            ? "bg-accent text-accent-on"
                            : "border border-line text-muted"
                        )}
                      >
                        {onboardStep > s ? (
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          s
                        )}
                      </div>
                      {s < 3 && (
                        <div className={cn("h-px w-8", onboardStep > s ? "bg-accent" : "bg-line")} />
                      )}
                    </div>
                  ))}
                </div>

                {onboardStep === 1 && (
                  <>
                    <h2 className="text-lg font-semibold text-foreground">Install the extension</h2>
                    <p className="mt-2 text-sm text-secondary">Prune runs locally in your editor. No cloud required.</p>
                    <div className="mt-5 space-y-4 text-sm">
                      {[
                        { n: 1, t: "Open Extensions", extra: <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-xs">Cmd+Shift+X</kbd> },
                        { n: 2, t: 'Search "Prune"' },
                        { n: 3, t: "Click Install" },
                      ].map((r) => (
                        <div key={r.n} className="flex gap-3">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-xs text-muted">{r.n}</span>
                          <div>
                            <p className="text-foreground">{r.t}</p>
                            {r.extra && <p className="mt-1 text-secondary">{r.extra}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 border-t border-line pt-5">
                      <p className="text-xs text-muted">Or via terminal:</p>
                      <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2">
                        <code className="flex-1 text-xs text-foreground">code --install-extension prune-0.1.0.vsix</code>
                        <button
                          onClick={() => handleCopy("code --install-extension prune-0.1.0.vsix")}
                          className="shrink-0 rounded border border-line px-2 py-1 text-xs text-secondary transition hover:bg-card-hover hover:text-foreground"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => setOnboardStep(2)}
                      className="mt-5 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-on transition hover:bg-[var(--accent-hover)]"
                    >
                      I've installed it
                    </button>
                  </>
                )}

                {onboardStep === 2 && (
                  <>
                    <h2 className="text-lg font-semibold text-foreground">Try a command</h2>
                    <p className="mt-2 text-sm text-secondary">Open any code file and test these.</p>
                    <div className="mt-5 space-y-3">
                      {[
                        { t: "Smart Copy", d: 'Right-click → "Copy for AI (Optimized)"' },
                        { t: "Status Bar", d: "Check bottom-left for real-time token count" },
                        { t: "Pre-flight", d: "Ctrl+Alt+P to analyze before sending" },
                      ].map((r) => (
                        <div key={r.t} className="rounded-md border border-line p-3">
                          <p className="text-sm font-medium text-foreground">{r.t}</p>
                          <p className="mt-1 text-xs text-secondary">{r.d}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 flex gap-3">
                      <button
                        onClick={() => setOnboardStep(1)}
                        className="flex-1 rounded-md border border-line px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-card-hover"
                      >
                        Back
                      </button>
                      <button
                        onClick={() => setOnboardStep(3)}
                        className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-on transition hover:bg-[var(--accent-hover)]"
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}

                {onboardStep === 3 && (
                  <>
                    <div className="flex justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-on glow">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                    <h2 className="mt-4 text-center text-lg font-semibold text-foreground">You're all set</h2>
                    <p className="mt-2 text-center text-sm text-secondary">Prune is now running locally in your editor.</p>
                    <div className="mt-5 rounded-md border border-line bg-panel-2 p-4">
                      <p className="text-xs font-medium text-foreground">What happens next:</p>
                      <ul className="mt-2 space-y-1.5 text-xs text-secondary">
                        {[
                          "Token count shows in the status bar",
                          "Smart Copy reduces tokens by 70–90%",
                          "Pre-flight shows spend before you send",
                          "All processing stays on your machine",
                        ].map((t) => (
                          <li key={t} className="flex items-start gap-2">
                            <span className="mt-0.5 text-accent-text">●</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button
                      onClick={handleOpenDashboard}
                      className="mt-5 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-on transition hover:bg-[var(--accent-hover)]"
                    >
                      Open dashboard
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
