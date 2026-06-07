"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3;

export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenDashboard = () => {
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl">
        <div className="rounded-lg border border-border bg-card p-8">
          {/* Progress indicator */}
          <div className="mb-8 flex items-center justify-center gap-3">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition ${
                    step >= s
                      ? "bg-foreground text-background"
                      : "border border-border text-muted"
                  }`}
                >
                  {step > s ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    s
                  )}
                </div>
                {s < 3 && (
                  <div className={`h-px w-12 ${step > s ? "bg-foreground" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>

          {step === 1 && (
            <>
              <h1 className="mb-2 text-center text-2xl font-semibold text-foreground">
                Install the TokenLens Extension
              </h1>
              <p className="mb-8 text-center text-secondary">
                TokenLens runs locally in your editor. No cloud, no API keys required.
              </p>

              <div className="rounded-lg border border-border bg-code-bg p-6">
                <div className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 font-medium text-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-sm text-background">1</span>
                    Open Extensions in VS Code / Cursor
                  </h3>
                  <p className="ml-8 text-sm text-secondary">
                    Press <kbd className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs">Cmd+Shift+X</kbd> (Mac) or{" "}
                    <kbd className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs">Ctrl+Shift+X</kbd> (Windows/Linux)
                  </p>
                </div>

                <div className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 font-medium text-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-sm text-background">2</span>
                    Search for "Prune"
                  </h3>
                  <p className="ml-8 text-sm text-secondary">
                    Or install from VSIX file if you have it locally
                  </p>
                </div>

                <div className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 font-medium text-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-sm text-background">3</span>
                    Click Install
                  </h3>
                  <p className="ml-8 text-sm text-secondary">
                    That's it! TokenLens will automatically track tokens in your status bar.
                  </p>
                </div>

                {/* Alternative: Install from terminal */}
                <div className="mt-6 border-t border-border pt-6">
                  <p className="mb-3 text-sm font-medium text-secondary">Or install via command line:</p>
                  <div className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2">
                    <code className="flex-1 text-sm text-foreground">code --install-extension prune-0.1.0.vsix</code>
                    <button
                      onClick={() => handleCopy("code --install-extension prune-0.1.0.vsix")}
                      className="shrink-0 rounded border border-border px-2 py-1 text-xs text-secondary hover:bg-card-hover hover:text-foreground transition"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                className="mt-6 w-full rounded bg-foreground px-4 py-3 font-medium text-background transition hover:opacity-90"
              >
                I've installed the extension
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="mb-2 text-center text-2xl font-semibold text-foreground">
                Try TokenLens Commands
              </h1>
              <p className="mb-8 text-center text-secondary">
                Open a code file and try these commands
              </p>

              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <h3 className="font-medium text-foreground">Analyze Selection</h3>
                  <p className="mt-1 text-sm text-secondary">
                    Select some code, right-click, then select "Prune: Analyze Selection"
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Shows token count and estimated cost
                  </p>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <h3 className="font-medium text-foreground">Squeeze Selection</h3>
                  <p className="mt-1 text-sm text-secondary">
                    Select some code, right-click, then select "Prune: Squeeze Selection"
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Compresses code to reduce tokens by 15-70%
                  </p>
                </div>

                <div className="rounded-lg border border-border p-4">
                  <h3 className="font-medium text-foreground">Check Status Bar</h3>
                  <p className="mt-1 text-sm text-secondary">
                    Look at the bottom-left corner of VS Code / Cursor
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Shows real-time token count for current file
                  </p>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 rounded border border-border px-4 py-3 font-medium text-foreground transition hover:bg-card-hover"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 rounded bg-foreground px-4 py-3 font-medium text-background transition hover:opacity-90"
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-on">
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>

              <h1 className="mb-2 text-center text-2xl font-semibold text-foreground">
                You're all set!
              </h1>
              <p className="mb-8 text-center text-secondary">
                TokenLens is now running locally in your editor
              </p>

              <div className="rounded-lg border border-border bg-code-bg p-6">
                <h3 className="mb-4 font-medium text-foreground">What TokenLens does:</h3>
                <ul className="space-y-2 text-sm text-secondary">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-accent-text">●</span>
                    <span>Counts tokens in real-time (status bar)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-accent-text">●</span>
                    <span>Compresses code to save tokens (squeeze)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-accent-text">●</span>
                    <span>Shows estimated costs for AI context</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-accent-text">●</span>
                    <span>Works 100% locally - no data leaves your machine</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 rounded-lg border border-border p-4">
                <p className="text-sm text-secondary">
                  <strong className="text-foreground">Pro tip:</strong> Use <kbd className="rounded border border-border bg-code-bg px-1 text-xs font-mono">Cmd+Shift+P</kbd> and type "Prune" to see all available commands.
                </p>
              </div>

              <button
                onClick={handleOpenDashboard}
                className="mt-6 w-full rounded bg-foreground px-4 py-3 font-medium text-background transition hover:opacity-90"
              >
                Open Dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
