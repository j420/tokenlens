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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-2xl">
        <div className="rounded-lg bg-white p-8 shadow-lg">
          {/* Progress indicator */}
          <div className="mb-8 flex items-center justify-center gap-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-4">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                    step >= s ? "bg-prune-green text-white" : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {s}
                </div>
                {s < 3 && (
                  <div className={`h-1 w-12 ${step > s ? "bg-prune-green" : "bg-gray-200"}`} />
                )}
              </div>
            ))}
          </div>

          {step === 1 && (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
                Install the Prune Extension
              </h1>
              <p className="mb-8 text-center text-gray-600">
                Prune runs locally in your editor. No cloud, no API keys required.
              </p>

              <div className="rounded-lg bg-gray-50 p-6">
                <div className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-prune-green text-sm text-white">1</span>
                    Open Extensions in VS Code / Cursor
                  </h3>
                  <p className="ml-8 text-sm text-gray-600">
                    Press <kbd className="rounded bg-gray-200 px-2 py-0.5 font-mono text-xs">Cmd+Shift+X</kbd> (Mac) or{" "}
                    <kbd className="rounded bg-gray-200 px-2 py-0.5 font-mono text-xs">Ctrl+Shift+X</kbd> (Windows/Linux)
                  </p>
                </div>

                <div className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-prune-green text-sm text-white">2</span>
                    Search for "Prune"
                  </h3>
                  <p className="ml-8 text-sm text-gray-600">
                    Or install from VSIX file if you have it locally
                  </p>
                </div>

                <div className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-prune-green text-sm text-white">3</span>
                    Click Install
                  </h3>
                  <p className="ml-8 text-sm text-gray-600">
                    That's it! Prune will automatically track tokens in your status bar.
                  </p>
                </div>

                {/* Alternative: Install from terminal */}
                <div className="mt-6 border-t border-gray-200 pt-6">
                  <p className="mb-3 text-sm font-medium text-gray-700">Or install via command line:</p>
                  <div className="rounded-md bg-gray-900 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-sm text-green-400">code --install-extension prune-0.1.0.vsix</code>
                      <button
                        onClick={() => handleCopy("code --install-extension prune-0.1.0.vsix")}
                        className="shrink-0 rounded bg-gray-700 px-2 py-1 text-xs text-white hover:bg-gray-600"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                className="mt-6 w-full rounded-lg bg-prune-green px-4 py-3 font-medium text-white transition hover:bg-emerald-600"
              >
                I've installed the extension
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
                Try Prune Commands
              </h1>
              <p className="mb-8 text-center text-gray-600">
                Open a code file and try these commands
              </p>

              <div className="space-y-4">
                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900">Analyze Selection</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Select some code, right-click, then select "Prune: Analyze Selection"
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    Shows token count and estimated cost
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900">Squeeze Selection</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Select some code, right-click, then select "Prune: Squeeze Selection"
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    Compresses code to reduce tokens by 15-70%
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900">Check Status Bar</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Look at the bottom-left corner of VS Code / Cursor
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    Shows real-time token count for current file
                  </p>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 rounded-lg bg-prune-green px-4 py-3 font-medium text-white transition hover:bg-emerald-600"
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-prune-green text-3xl text-white">
                  ✓
                </div>
              </div>

              <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
                You're all set!
              </h1>
              <p className="mb-8 text-center text-gray-600">
                Prune is now running locally in your editor
              </p>

              <div className="rounded-lg bg-emerald-50 p-6">
                <h3 className="mb-4 font-semibold text-emerald-900">What Prune does:</h3>
                <ul className="space-y-2 text-sm text-emerald-800">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5">✓</span>
                    <span>Counts tokens in real-time (status bar)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5">✓</span>
                    <span>Compresses code to save tokens (squeeze)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5">✓</span>
                    <span>Shows estimated costs for AI context</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5">✓</span>
                    <span>Works 100% locally - no data leaves your machine</span>
                  </li>
                </ul>
              </div>

              <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm text-blue-800">
                  <strong>Pro tip:</strong> Use <kbd className="rounded bg-blue-200 px-1 text-xs">Cmd+Shift+P</kbd> and type "Prune" to see all available commands.
                </p>
              </div>

              <button
                onClick={handleOpenDashboard}
                className="mt-6 w-full rounded-lg bg-prune-green px-4 py-3 font-medium text-white transition hover:bg-emerald-600"
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
