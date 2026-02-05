"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type Tool = "claude-code" | "codex" | "cursor";
type CursorProvider = "openai" | "anthropic";

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

const CURSOR_PROVIDERS: Record<CursorProvider, { name: string; icon: string; apiKeyUrl: string; settingsPath: string }> = {
  openai: {
    name: "OpenAI",
    icon: "🟢",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    settingsPath: "Models → OpenAI API Key",
  },
  anthropic: {
    name: "Anthropic",
    icon: "🟠",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    settingsPath: "Models → Anthropic API Key",
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
  const [cursorProvider, setCursorProvider] = useState<CursorProvider>("openai");
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

  const getProxyUrl = (tool: Tool, provider?: CursorProvider) => {
    if (tool === "codex") {
      return `${baseUrl}/api/v1/proxy/openai`;
    }
    if (tool === "cursor") {
      return provider === "anthropic"
        ? `${baseUrl}/api/v1/proxy/anthropic`
        : `${baseUrl}/api/v1/proxy/openai`;
    }
    return `${baseUrl}/api/v1/proxy/anthropic`;
  };

  const handleCopyToClipboard = async () => {
    if (!selectedTool) return;
    const config = TOOLS[selectedTool];
    const proxyUrl = getProxyUrl(selectedTool, cursorProvider);
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
              ) : selectedTool === "cursor" ? (
                /* Detailed Cursor Setup Instructions */
                <div className="rounded-lg bg-gray-50 p-6">
                  <div className="mb-6 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Cursor Setup Guide
                    </h3>
                    <button
                      onClick={() => setSelectedTool(null)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Choose different tool
                    </button>
                  </div>

                  {/* Provider Selection */}
                  <div className="mb-6">
                    <p className="mb-3 text-sm font-medium text-gray-700">Which AI provider do you want to use?</p>
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.keys(CURSOR_PROVIDERS) as CursorProvider[]).map((provider) => {
                        const config = CURSOR_PROVIDERS[provider];
                        const isSelected = cursorProvider === provider;
                        return (
                          <button
                            key={provider}
                            onClick={() => setCursorProvider(provider)}
                            className={`rounded-lg border-2 p-4 text-left transition ${
                              isSelected
                                ? "border-prune-green bg-prune-green/5"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xl">{config.icon}</span>
                              <span className={`font-medium ${isSelected ? "text-prune-green" : "text-gray-900"}`}>
                                {config.name}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                              {provider === "openai" ? "GPT-4o, o1, o3-mini" : "Claude Sonnet, Opus, Haiku"}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Step 1 */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-prune-green text-sm font-bold text-white">1</span>
                      <h4 className="font-medium text-gray-900">Open Cursor Settings</h4>
                    </div>
                    <div className="ml-10 space-y-2 text-sm text-gray-600">
                      <p>Press <kbd className="rounded bg-gray-200 px-2 py-0.5 font-mono text-xs">Cmd + ,</kbd> (Mac) or <kbd className="rounded bg-gray-200 px-2 py-0.5 font-mono text-xs">Ctrl + ,</kbd> (Windows/Linux)</p>
                      <p className="text-gray-500">Or click the gear icon in the bottom-left corner of Cursor</p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-prune-green text-sm font-bold text-white">2</span>
                      <h4 className="font-medium text-gray-900">Navigate to Models Settings</h4>
                    </div>
                    <div className="ml-10 space-y-2 text-sm text-gray-600">
                      <p>In the Settings sidebar, click on <strong>"Models"</strong></p>
                      <p>Then scroll down to find the <strong>"{CURSOR_PROVIDERS[cursorProvider].settingsPath}"</strong> section</p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-prune-green text-sm font-bold text-white">3</span>
                      <h4 className="font-medium text-gray-900">Enter Your {CURSOR_PROVIDERS[cursorProvider].name} API Key</h4>
                    </div>
                    <div className="ml-10 space-y-2 text-sm text-gray-600">
                      <p>Paste your {CURSOR_PROVIDERS[cursorProvider].name} API key in the input field</p>
                      <p className="text-gray-500">
                        Get your API key from{" "}
                        <a
                          href={CURSOR_PROVIDERS[cursorProvider].apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-prune-green hover:underline"
                        >
                          {cursorProvider === "openai" ? "platform.openai.com/api-keys" : "console.anthropic.com/settings/keys"}
                        </a>
                      </p>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-prune-green text-sm font-bold text-white">4</span>
                      <h4 className="font-medium text-gray-900">Enable Base URL Override</h4>
                    </div>
                    <div className="ml-10 space-y-2 text-sm text-gray-600">
                      <p>Check the box that says <strong>"Override {CURSOR_PROVIDERS[cursorProvider].name} Base URL"</strong></p>
                      <p>A new input field will appear below</p>
                    </div>
                  </div>

                  {/* Step 5 */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-prune-green text-sm font-bold text-white">5</span>
                      <h4 className="font-medium text-gray-900">Paste the Prune Proxy URL</h4>
                    </div>
                    <div className="ml-10 space-y-3">
                      <p className="text-sm text-gray-600">Copy this URL and paste it in the Base URL field:</p>
                      <div className="rounded-md bg-gray-900 p-4 font-mono text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-green-400 break-all">{getProxyUrl("cursor", cursorProvider)}</code>
                          <button
                            onClick={handleCopyToClipboard}
                            className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs text-white hover:bg-gray-600"
                          >
                            {copied ? "✓" : "Copy"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 6 */}
                  <div className="mb-8">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-prune-green text-sm font-bold text-white">6</span>
                      <h4 className="font-medium text-gray-900">Save and Test</h4>
                    </div>
                    <div className="ml-10 space-y-2 text-sm text-gray-600">
                      <p>Click <strong>"Verify"</strong> button in Cursor to test the connection</p>
                      <p>If successful, all your Cursor AI requests will now flow through Prune!</p>
                    </div>
                  </div>

                  {/* Info box - API Key Explanation */}
                  <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex gap-3">
                      <span className="text-blue-500">ℹ️</span>
                      <div className="text-sm text-blue-800">
                        <p className="font-medium">How it works:</p>
                        <ul className="mt-2 space-y-1 list-disc list-inside">
                          <li><strong>You use your own API key</strong> — Prune does not provide or store API keys</li>
                          <li>Cursor sends requests to Prune, which forwards them to {CURSOR_PROVIDERS[cursorProvider].name}</li>
                          <li>Your API key is passed through transparently and never stored by Prune</li>
                          <li>Prune only captures usage metrics (tokens, cost) before forwarding the request</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Security note */}
                  <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex gap-3">
                      <span className="text-amber-500">🔒</span>
                      <div className="text-sm text-amber-800">
                        <p className="font-medium">Security Note:</p>
                        <p className="mt-1">The URL override only changes where requests are routed. Your API key remains secure and is passed directly to {CURSOR_PROVIDERS[cursorProvider].name}'s API servers after Prune logs the usage metrics.</p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleContinue}
                    className="w-full rounded-lg bg-prune-green px-4 py-3 font-medium text-white transition hover:bg-emerald-600"
                  >
                    I've completed the setup →
                  </button>
                </div>
              ) : (
                /* Other tools (Claude Code, Codex) setup */
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
                    <div className="text-green-400 break-all">
                      export {TOOLS[selectedTool].envVar}={getProxyUrl(selectedTool)}
                    </div>
                    <div className="text-green-400">export PRUNE_API_KEY={apiKey}</div>
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
