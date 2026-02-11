"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type OnboardStep = 1 | 2 | 3;

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [signupState, setSignupState] = useState<"idle" | "loading" | "success">("idle");
  const [showOnboard, setShowOnboard] = useState(false);
  const [onboardStep, setOnboardStep] = useState<OnboardStep>(1);
  const [copied, setCopied] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setSignupState("loading");
    // Simulate signup - in production, this would call an API
    await new Promise((resolve) => setTimeout(resolve, 800));
    setSignupState("success");
    setShowOnboard(true);
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenDashboard = () => {
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-foreground text-background text-sm font-bold">
              TL
            </div>
            <span className="font-semibold text-foreground">TokenLens</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#features" className="text-secondary hover:text-foreground transition">Features</a>
            <a href="#setup" className="text-secondary hover:text-foreground transition">Setup</a>
            <a href="/dashboard" className="text-secondary hover:text-foreground transition">Dashboard</a>
          </nav>
        </div>
      </header>

      {/* Hero + Signup Section */}
      <section className="border-b border-border py-16">
        <div className="mx-auto max-w-5xl px-4">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            {/* Left: Value Prop */}
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Token intelligence for AI coding assistants
              </h1>
              <p className="mt-4 text-lg text-secondary">
                See what you spend, where the waste is, and what you're about to spend.
                Zero API keys. All processing happens locally.
              </p>

              <div className="mt-8 space-y-3 text-sm text-secondary">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-foreground"></span>
                  <span>Real-time token counting in your status bar</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-foreground"></span>
                  <span>70-90% token reduction with Smart Copy</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-foreground"></span>
                  <span>Pre-flight optimizer shows spend before you send</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-foreground"></span>
                  <span>Works with Cursor, Claude Code, OpenAI Codex</span>
                </div>
              </div>
            </div>

            {/* Right: Signup Form */}
            <div className="rounded-lg border border-border bg-card p-6">
              {!showOnboard ? (
                <>
                  <h2 className="text-xl font-semibold text-foreground">Get started</h2>
                  <p className="mt-2 text-sm text-secondary">
                    Enter your email to begin setup. We'll guide you through installation.
                  </p>

                  <form onSubmit={handleSignup} className="mt-6">
                    <label className="block text-sm font-medium text-foreground">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                      required
                    />

                    <button
                      type="submit"
                      disabled={signupState === "loading"}
                      className="mt-4 w-full rounded bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
                    >
                      {signupState === "loading" ? "Starting..." : "Start Setup"}
                    </button>
                  </form>

                  <p className="mt-4 text-center text-xs text-muted">
                    No credit card required. Free forever for individuals.
                  </p>
                </>
              ) : (
                /* Inline Onboarding */
                <div>
                  {/* Progress indicator */}
                  <div className="mb-6 flex items-center gap-3">
                    {[1, 2, 3].map((s) => (
                      <div key={s} className="flex items-center gap-3">
                        <div
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition ${
                            onboardStep >= s
                              ? "bg-foreground text-background"
                              : "border border-border text-muted"
                          }`}
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
                          <div className={`h-px w-8 ${onboardStep > s ? "bg-foreground" : "bg-border"}`} />
                        )}
                      </div>
                    ))}
                  </div>

                  {onboardStep === 1 && (
                    <>
                      <h2 className="text-lg font-semibold text-foreground">Install the extension</h2>
                      <p className="mt-2 text-sm text-secondary">
                        TokenLens runs locally in your editor. No cloud required.
                      </p>

                      <div className="mt-5 space-y-4 text-sm">
                        <div className="flex gap-3">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted">1</span>
                          <div>
                            <p className="text-foreground">Open Extensions</p>
                            <p className="text-secondary">
                              <kbd className="rounded border border-border bg-code-bg px-1.5 py-0.5 font-mono text-xs">Cmd+Shift+X</kbd>
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted">2</span>
                          <div>
                            <p className="text-foreground">Search "Prune"</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted">3</span>
                          <div>
                            <p className="text-foreground">Click Install</p>
                          </div>
                        </div>
                      </div>

                      {/* CLI alternative */}
                      <div className="mt-5 border-t border-border pt-5">
                        <p className="text-xs text-muted">Or via terminal:</p>
                        <div className="mt-2 flex items-center gap-2 rounded border border-border bg-code-bg px-3 py-2">
                          <code className="flex-1 text-xs text-foreground">code --install-extension prune-0.1.0.vsix</code>
                          <button
                            onClick={() => handleCopy("code --install-extension prune-0.1.0.vsix")}
                            className="shrink-0 rounded border border-border px-2 py-1 text-xs text-secondary hover:bg-card-hover hover:text-foreground"
                          >
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={() => setOnboardStep(2)}
                        className="mt-5 w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                      >
                        I've installed it
                      </button>
                    </>
                  )}

                  {onboardStep === 2 && (
                    <>
                      <h2 className="text-lg font-semibold text-foreground">Try a command</h2>
                      <p className="mt-2 text-sm text-secondary">
                        Open any code file and test these features.
                      </p>

                      <div className="mt-5 space-y-3">
                        <div className="rounded border border-border p-3">
                          <p className="text-sm font-medium text-foreground">Smart Copy</p>
                          <p className="mt-1 text-xs text-secondary">
                            Right-click → "Copy for AI (Optimized)"
                          </p>
                        </div>
                        <div className="rounded border border-border p-3">
                          <p className="text-sm font-medium text-foreground">Status Bar</p>
                          <p className="mt-1 text-xs text-secondary">
                            Check bottom-left for real-time token count
                          </p>
                        </div>
                        <div className="rounded border border-border p-3">
                          <p className="text-sm font-medium text-foreground">Pre-flight</p>
                          <p className="mt-1 text-xs text-secondary">
                            <kbd className="rounded border border-border bg-code-bg px-1 py-0.5 font-mono text-xs">Ctrl+Alt+P</kbd> to analyze before sending
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 flex gap-3">
                        <button
                          onClick={() => setOnboardStep(1)}
                          className="flex-1 rounded border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-card-hover"
                        >
                          Back
                        </button>
                        <button
                          onClick={() => setOnboardStep(3)}
                          className="flex-1 rounded bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )}

                  {onboardStep === 3 && (
                    <>
                      <div className="flex justify-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-status-green text-white">
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>

                      <h2 className="mt-4 text-center text-lg font-semibold text-foreground">You're all set</h2>
                      <p className="mt-2 text-center text-sm text-secondary">
                        TokenLens is now running locally in your editor.
                      </p>

                      <div className="mt-5 rounded border border-border bg-code-bg p-4">
                        <p className="text-xs font-medium text-foreground">What happens next:</p>
                        <ul className="mt-2 space-y-1.5 text-xs text-secondary">
                          <li className="flex items-start gap-2">
                            <span className="mt-0.5 text-status-green">●</span>
                            <span>Token count shows in status bar</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="mt-0.5 text-status-green">●</span>
                            <span>Smart Copy reduces tokens by 70-90%</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="mt-0.5 text-status-green">●</span>
                            <span>Pre-flight shows spend before you send</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="mt-0.5 text-status-green">●</span>
                            <span>All processing stays on your machine</span>
                          </li>
                        </ul>
                      </div>

                      <button
                        onClick={handleOpenDashboard}
                        className="mt-5 w-full rounded bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                      >
                        Open Dashboard
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="border-b border-border py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-2xl font-semibold text-foreground">Features</h2>
          <p className="mt-2 text-secondary">
            Reduce token consumption while maintaining context quality.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <div className="rounded-lg border border-border p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-code-bg text-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">Smart Copy</h3>
              <p className="mt-2 text-sm text-secondary">
                Copy files as signatures instead of full code. 70-90% token reduction.
              </p>
              <p className="mt-3 text-xs text-muted">
                <kbd className="rounded border border-border bg-code-bg px-1 py-0.5 font-mono">Ctrl+Alt+C</kbd>
              </p>
            </div>

            {/* Feature 2 */}
            <div className="rounded-lg border border-border p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-code-bg text-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">Pre-flight Optimizer</h3>
              <p className="mt-2 text-sm text-secondary">
                See what you're about to spend vs what you could spend with optimization.
              </p>
              <p className="mt-3 text-xs text-muted">
                <kbd className="rounded border border-border bg-code-bg px-1 py-0.5 font-mono">Ctrl+Alt+P</kbd>
              </p>
            </div>

            {/* Feature 3 */}
            <div className="rounded-lg border border-border p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-code-bg text-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">Session Memory</h3>
              <p className="mt-2 text-sm text-secondary">
                Tracks files already in context. Prevents re-reading the same files.
              </p>
              <p className="mt-3 text-xs text-muted">
                Automatic deduplication
              </p>
            </div>

            {/* Feature 4 */}
            <div className="rounded-lg border border-border p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-code-bg text-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">Compaction Recovery</h3>
              <p className="mt-2 text-sm text-secondary">
                Tracks architectural decisions. Shows what may be forgotten on context compaction.
              </p>
              <p className="mt-3 text-xs text-muted">
                Never lose important context
              </p>
            </div>

            {/* Feature 5 */}
            <div className="rounded-lg border border-border p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-code-bg text-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">Code Squeezer</h3>
              <p className="mt-2 text-sm text-secondary">
                Tree-sitter powered compression. Three tiers: lossless, structural, telegraphic.
              </p>
              <p className="mt-3 text-xs text-muted">
                15-70% savings
              </p>
            </div>

            {/* Feature 6 */}
            <div className="rounded-lg border border-border p-5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-code-bg text-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">100% Local</h3>
              <p className="mt-2 text-sm text-secondary">
                No API keys required. No cloud. Your code never leaves your machine.
              </p>
              <p className="mt-3 text-xs text-muted">
                Privacy-first architecture
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Setup Section */}
      <section id="setup" className="py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-2xl font-semibold text-foreground">Quick Setup</h2>
          <p className="mt-2 text-secondary">
            Get running in under a minute.
          </p>

          <div className="mt-8 rounded-lg border border-border bg-card p-6">
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium text-foreground">
                  1
                </div>
                <div>
                  <p className="font-medium text-foreground">Install dependencies</p>
                  <div className="mt-2 rounded border border-border bg-code-bg px-3 py-2">
                    <code className="text-sm text-foreground">npm install</code>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium text-foreground">
                  2
                </div>
                <div>
                  <p className="font-medium text-foreground">Build all packages</p>
                  <div className="mt-2 rounded border border-border bg-code-bg px-3 py-2">
                    <code className="text-sm text-foreground">npm run build</code>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium text-foreground">
                  3
                </div>
                <div>
                  <p className="font-medium text-foreground">Package the extension</p>
                  <div className="mt-2 rounded border border-border bg-code-bg px-3 py-2">
                    <code className="text-sm text-foreground">cd apps/extension && npm run package</code>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium text-foreground">
                  4
                </div>
                <div>
                  <p className="font-medium text-foreground">Install the VSIX</p>
                  <p className="mt-1 text-sm text-secondary">
                    Extensions → ... → Install from VSIX → select prune-0.1.0.vsix
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-background text-xs font-bold">
                TL
              </div>
              <span className="text-sm text-secondary">TokenLens</span>
            </div>
            <p className="text-sm text-muted">
              Token intelligence for AI coding assistants
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
