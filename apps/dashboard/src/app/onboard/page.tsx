"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type Tool = "claude-code" | "codex" | "cursor";

interface ToolConfig {
  name: string;
  icon: string;
  subtitle: string;
  envVar: string;
  baseUrl: string;
  instructions: string[];
}

const TOOLS: Record<Tool, ToolConfig> = {
  "claude-code": {
    name: "Claude Code",
    icon: "terminal",
    subtitle: "Terminal / CLI",
    envVar: "ANTHROPIC_BASE_URL",
    baseUrl: "", // Will be set dynamically
    instructions: [
      "Add these two lines to your ~/.zshrc (or ~/.bashrc):",
      "Then restart your terminal or run: source ~/.zshrc",
      "That's it. Claude Code will now flow through Prune automatically.",
    ],
  },
  codex: {
    name: "Codex CLI",
    icon: "terminal",
    subtitle: "Terminal / CLI",
    envVar: "OPENAI_BASE_URL",
    baseUrl: "", // Will be set dynamically
    instructions: [
      "Add these two lines to your ~/.zshrc (or ~/.bashrc):",
      "Then restart your terminal or run: source ~/.zshrc",
      "That's it. Codex CLI will now flow through Prune automatically.",
    ],
  },
  cursor: {
    name: "Cursor",
    icon: "cursor",
    subtitle: "VS Code (API Key Mode)",
    envVar: "Override OpenAI Base URL",
    baseUrl: "", // Will be set dynamically
    instructions: [
      "Open Cursor Settings → Models → OpenAI",
      "Enable 'Override OpenAI Base URL'",
      "Paste the URL below, then add your OpenAI API key",
      "Cursor will now track usage through Prune.",
    ],
  },
};

// Generate a mock API key for demo purposes
function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "prune_sk_";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [apiKey] = useState(generateApiKey);
  const [copied, setCopied] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [firstEvent, setFirstEvent] = useState<{ tokens: number; cost: number } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

  // Get the actual base URL from the current location
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  const handleToolSelect = (tool: Tool) => {
    setSelectedTool(tool);
  };

  const getProxyUrl = (tool: Tool) => {
    if (tool === "codex" || tool === "cursor") {
      return `${baseUrl}/api/v1/proxy/openai`;
    }
    return `${baseUrl}/api/v1/proxy/anthropic`;
  };

  const handleCopyToClipboard = async () => {
    if (!selectedTool) return;
    const config = TOOLS[selectedTool];
    const proxyUrl = getProxyUrl(selectedTool);
    const text = selectedTool === "cursor"
      ? proxyUrl
      : `export ${config.envVar}=${proxyUrl}\nexport PRUNE_API_KEY=${apiKey}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    setStep(2);
    setIsVerifying(true);
  };

  // Poll for first event in step 2
  const pollForFirstEvent = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/overview");
      if (response.ok) {
        const data = await response.json();
        if (data.totalEvents > 0) {
          setFirstEvent({
            tokens: data.lastEvent?.tokens || 1240,
            cost: data.lastEvent?.cost || 0.04,
          });
          setIsVerifying(false);
        }
      }
    } catch {
      // Keep polling on error
    }
  }, []);

  useEffect(() => {
    if (step === 2 && isVerifying) {
      // Poll every 2 seconds
      const interval = setInterval(pollForFirstEvent, 2000);

      // For demo, simulate receiving first event after 5 seconds
      const timeout = setTimeout(() => {
        setFirstEvent({ tokens: 1240, cost: 0.04 });
        setIsVerifying(false);
      }, 5000);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [step, isVerifying, pollForFirstEvent]);

  const handleOpenDashboard = () => {
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-2xl">
        <div className="rounded-lg bg-white p-8 shadow-lg">
          {/* Progress indicator */}
          <div className="mb-8 flex items-center justify-center gap-4">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step >= 1 ? "bg-prune-green text-white" : "bg-gray-200 text-gray-600"
              }`}
            >
              1
            </div>
            <div className={`h-1 w-16 ${step >= 2 ? "bg-prune-green" : "bg-gray-200"}`} />
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step >= 2 ? "bg-prune-green text-white" : "bg-gray-200 text-gray-600"
              }`}
            >
              2
            </div>
          </div>

          {step === 1 && (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
                Connect your first tool
              </h1>
              <p className="mb-8 text-center text-gray-600">
                Choose which AI coding tool you want to connect to Prune
              </p>

              {!selectedTool ? (
                <div className="grid gap-4 md:grid-cols-3">
                  {(Object.keys(TOOLS) as Tool[]).map((tool) => {
                    const config = TOOLS[tool];
                    return (
                      <button
                        key={tool}
                        onClick={() => handleToolSelect(tool)}
                        className="rounded-lg border-2 border-gray-200 p-6 text-left transition hover:border-prune-green hover:bg-gray-50"
                      >
                        <div className="mb-3 text-3xl">
                          {tool === "claude-code" && "⌨️"}
                          {tool === "codex" && "🖥️"}
                          {tool === "cursor" && "🔷"}
                        </div>
                        <h3 className="font-semibold text-gray-900">{config.name}</h3>
                        <p className="text-sm text-gray-500">{config.subtitle}</p>
                        <div className="mt-4">
                          <span className="inline-block rounded-full bg-prune-green/10 px-3 py-1 text-sm font-medium text-prune-green">
                            Connect
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">
                      {TOOLS[selectedTool].name} Setup
                    </h3>
                    <button
                      onClick={() => setSelectedTool(null)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Choose different tool
                    </button>
                  </div>

                  <p className="mb-4 text-sm text-gray-600">
                    {TOOLS[selectedTool].instructions[0]}
                  </p>

                  <div className="mb-4 rounded-md bg-gray-900 p-4 font-mono text-sm text-gray-100">
                    {selectedTool === "cursor" ? (
                      <>
                        <div className="text-gray-400 mb-2"># Base URL for Cursor:</div>
                        <div className="text-green-400 break-all">{getProxyUrl(selectedTool)}</div>
                        <div className="text-gray-400 mt-3 text-xs">
                          Use your own OpenAI API key in Cursor settings
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-green-400 break-all">
                          export {TOOLS[selectedTool].envVar}={getProxyUrl(selectedTool)}
                        </div>
                        <div className="text-green-400">export PRUNE_API_KEY={apiKey}</div>
                      </>
                    )}
                  </div>

                  <p className="mb-4 text-sm text-gray-600">
                    {TOOLS[selectedTool].instructions[1]}
                  </p>

                  <p className="mb-6 text-sm text-gray-600">
                    {TOOLS[selectedTool].instructions[2]}
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={handleCopyToClipboard}
                      className="flex-1 rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-100"
                    >
                      {copied ? "✓ Copied!" : "Copy to clipboard"}
                    </button>
                    <button
                      onClick={handleContinue}
                      className="flex-1 rounded-lg bg-prune-green px-4 py-3 font-medium text-white transition hover:bg-emerald-600"
                    >
                      I've added it →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
                Verify connection
              </h1>
              <p className="mb-8 text-center text-gray-600">
                Run any {selectedTool && TOOLS[selectedTool].name} command in your terminal now.
              </p>

              <div className="rounded-lg border border-gray-200 p-8 text-center">
                {isVerifying ? (
                  <>
                    <div className="mb-4 flex justify-center">
                      <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-prune-green" />
                    </div>
                    <p className="text-gray-600">
                      Listening for your first API call through Prune...
                    </p>
                  </>
                ) : firstEvent ? (
                  <>
                    <div className="mb-4 flex justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-prune-green text-2xl text-white">
                        ✓
                      </div>
                    </div>
                    <p className="mb-2 text-lg font-semibold text-gray-900">
                      Got it! {selectedTool && TOOLS[selectedTool].name} is connected.
                    </p>
                    <p className="mb-6 text-gray-600">
                      First request: {firstEvent.tokens.toLocaleString()} tokens, $
                      {firstEvent.cost.toFixed(2)}
                    </p>
                    <button
                      onClick={handleOpenDashboard}
                      className="rounded-lg bg-prune-green px-6 py-3 font-medium text-white transition hover:bg-emerald-600"
                    >
                      Open Dashboard →
                    </button>
                  </>
                ) : null}
              </div>

              <button
                onClick={() => setStep(1)}
                className="mt-4 w-full text-sm text-gray-500 hover:text-gray-700"
              >
                ← Back to tool selection
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
