"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { IDESelector, usePreferredIDE, getIDEUri, type IDEType } from "@/components/ide-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast, toast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { FeatureSimulation } from "@/components/feature-simulation";
import { TcrpCatalog } from "@/components/tcrp-catalog";
import { TCRP_COUNT } from "@/lib/tcrp-catalog";

type OnboardStep = 1 | 2 | 3;

interface Feature {
  id: string;
  command: string;
  title: string;
  description: string;
  aiContext: string; // Plain language explanation of the benefit
  keybinding?: { windows: string; mac: string };
  icon: React.ReactNode;
}

const FEATURES: Feature[] = [
  // Token Savers
  {
    id: "smartCopy",
    command: "prune.smartCopy",
    title: "Smart Copy",
    description: "Copy files as signatures instead of full code. 70-90% token reduction.",
    aiContext: "Paste into AI chat and get better answers with less cost",
    keybinding: { windows: "Ctrl+Alt+C", mac: "Cmd+Alt+C" },
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: "preflight",
    command: "prune.preflight",
    title: "Pre-flight Optimizer",
    description: "See what you're about to spend vs what you could spend with optimization.",
    aiContext: "Know the exact cost before you send your request",
    keybinding: { windows: "Ctrl+Alt+P", mac: "Cmd+Alt+P" },
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: "smartContext",
    command: "prune.smartContext",
    title: "Intelligent Context",
    description: "Automatically picks the right code to include based on what you're asking.",
    aiContext: "AI understands your question and selects relevant code for you",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    id: "compactionCheck",
    command: "prune.compactionCheck",
    title: "Compaction Recovery",
    description: "Tracks architectural decisions. Shows what may be forgotten on context compaction.",
    aiContext: "Keep important decisions from getting lost in long conversations",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    id: "analyzeContext",
    command: "prune.analyzeContext",
    title: "Context Analysis",
    description: "Score workspace files by relevance to your task. Know what to include.",
    aiContext: "Find the most relevant files for your task",
    keybinding: { windows: "Ctrl+Alt+A", mac: "Cmd+Alt+A" },
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  // Session & Analysis
  {
    id: "sessionStats",
    command: "prune.sessionStats",
    title: "Session Memory",
    description: "Tracks files already in context. Prevents re-reading the same files.",
    aiContext: "AI remembers what it already read so it doesn't read again",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: "squeezeFile",
    command: "prune.squeezeFile",
    title: "Code Squeezer",
    description: "Compress code while keeping it readable. Choose from light, medium, or heavy compression.",
    aiContext: "Shrink your code while AI can still understand it",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
      </svg>
    ),
  },
  {
    id: "trackDecision",
    command: "prune.trackDecision",
    title: "Track Decision",
    description: "Record architectural decisions to protect them from context loss.",
    aiContext: "Bookmark key decisions so they don't get forgotten",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
  },
  {
    id: "analyzeFile",
    command: "prune.analyzeFile",
    title: "Token Counter",
    description: "Real-time token count and cost estimation for any file or selection.",
    aiContext: "Know the cost before asking AI",
    keybinding: { windows: "Ctrl+Alt+T", mac: "Cmd+Alt+T" },
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
      </svg>
    ),
  },
  // Utility
  {
    id: "checkCursorUsage",
    command: "prune.checkCursorUsage",
    title: "Usage Tracking",
    description: "Monitor your AI coding assistant usage. Zero-key local database access.",
    aiContext: "See how many requests you've used this month",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
];


function FeatureCard({ feature, ide }: { feature: Feature; ide: IDEType }) {
  const uri = getIDEUri(ide, feature.id);
  const ideName = ide === "cursor" ? "Cursor" : ide === "vscode" ? "Claude Code" : "Codex";

  return (
    <a
      href={uri}
      className={cn(
        "group block rounded-lg border border-border bg-card p-5",
        "transition-all duration-200",
        "hover:border-secondary hover:shadow-md hover:-translate-y-0.5",
        "focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-2"
      )}
      aria-label={`${feature.title}: ${feature.description}. Open in ${ideName}`}
    >
      <div className="mb-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card-hover text-secondary transition-colors duration-200 group-hover:bg-status-green/10 group-hover:text-status-green">
          {feature.icon}
        </div>
      </div>
      <h3 className="font-semibold text-foreground">{feature.title}</h3>
      <p className="mt-2 text-sm text-secondary">{feature.description}</p>
      <p className="mt-1.5 text-xs text-secondary">{feature.aiContext}</p>
      <div className="mt-4 flex items-center justify-between">
        {feature.keybinding ? (
          <kbd className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-secondary">
            {feature.keybinding.mac}
          </kbd>
        ) : (
          <span />
        )}
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary transition-colors duration-200 group-hover:text-status-green">
          Open in {ideName}
          <svg className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </span>
      </div>
    </a>
  );
}

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [signupState, setSignupState] = useState<"idle" | "loading" | "success">("idle");
  const [showOnboard, setShowOnboard] = useState(false);
  const [onboardStep, setOnboardStep] = useState<OnboardStep>(1);
  const [copied, setCopied] = useState(false);
  const [preferredIDE, setPreferredIDE] = usePreferredIDE();
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
      // Simulate signup - in production, this would call an API
      await new Promise((resolve) => setTimeout(resolve, 800));
      setSignupState("success");
      setShowOnboard(true);
      toastHelpers.success("Welcome!", "Let's get you set up with TokenLens.");
    } catch {
      setSignupState("idle");
      toastHelpers.error("Signup failed", "Please try again later.");
    }
  };

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toastHelpers.success("Copied!", "Command copied to clipboard.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastHelpers.error("Copy failed", "Could not copy to clipboard.");
    }
  }, [toastHelpers]);

  const handleOpenDashboard = () => {
    router.push("/dashboard");
  };

  const ideName = preferredIDE === "cursor" ? "Cursor" : preferredIDE === "vscode" ? "Claude Code" : "Codex";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-foreground text-background text-sm font-bold">
              TL
            </div>
            <span className="font-semibold text-foreground">TokenLens</span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#get-started" className="rounded-md px-2 py-1.5 text-secondary transition hover:bg-card-hover hover:text-foreground focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-1">Get Started</a>
            <a href="#features" className="rounded-md px-2 py-1.5 text-secondary transition hover:bg-card-hover hover:text-foreground focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-1">Features</a>
            <a href="#program" className="rounded-md px-2 py-1.5 text-secondary transition hover:bg-card-hover hover:text-foreground focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-1">Program</a>
            <a href="#setup" className="rounded-md px-2 py-1.5 text-secondary transition hover:bg-card-hover hover:text-foreground focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-1">Setup</a>
            <IDESelector value={preferredIDE} onChange={setPreferredIDE} compact />
            <ThemeToggle compact />
            <a href="/dashboard" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-foreground focus:ring-offset-1">Dashboard</a>
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
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-prune-green"></span>
                  <span>Real-time token counting in your status bar</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-prune-green"></span>
                  <span>70-90% token reduction with Smart Copy</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-prune-green"></span>
                  <span>Pre-flight optimizer shows spend before you send</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-prune-green"></span>
                  <span>Works with Cursor, Claude Code, OpenAI Codex</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-prune-green"></span>
                  <span>{TCRP_COUNT} deterministic cost-reduction levers (MCP tools + hooks)</span>
                </div>
              </div>
            </div>

            {/* Right: Feature Animation */}
            <div className="flex items-center justify-center">
              <FeatureSimulation autoPlay intervalMs={5000} />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="border-b border-border py-16">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">Features</h2>
              <p className="mt-2 text-secondary">
                Reduce token consumption while maintaining context quality. Click any feature to open it in {ideName}.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted">
              <span>Select IDE:</span>
              <IDESelector value={preferredIDE} onChange={setPreferredIDE} compact />
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <FeatureCard key={feature.id} feature={feature} ide={preferredIDE} />
            ))}
          </div>
        </div>
      </section>

      {/* Token-Cost Reduction Program Section */}
      <section id="program" className="border-b border-border py-16">
        <div className="mx-auto max-w-5xl px-4">
          <TcrpCatalog />
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
                  <div className="mt-2 rounded border border-border bg-card-hover px-3 py-2">
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
                  <div className="mt-2 rounded border border-border bg-card-hover px-3 py-2">
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
                  <div className="mt-2 rounded border border-border bg-card-hover px-3 py-2">
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

      {/* Get Started Section */}
      <section id="get-started" className="border-b border-border bg-card-hover/30 py-16">
        <div className="mx-auto max-w-xl px-4">
          <div className="rounded-lg border border-border bg-card p-6">
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
                      "mt-2 w-full rounded-lg border bg-card px-3 py-2.5 text-foreground transition",
                      "placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-offset-1",
                      emailError
                        ? "border-status-red focus:border-status-red focus:ring-status-red"
                        : "border-border focus:border-status-green focus:ring-status-green"
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
                      "mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-status-green px-4 py-2.5 text-sm font-medium text-white transition",
                      "hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-1",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    {signupState === "loading" && (
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
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
                            ? "bg-prune-green text-white"
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
                        <div className={`h-px w-8 ${onboardStep > s ? "bg-prune-green" : "bg-border"}`} />
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
                            <kbd className="rounded border border-border bg-card-hover px-1.5 py-0.5 font-mono text-xs">Cmd+Shift+X</kbd>
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
                      <div className="mt-2 flex items-center gap-2 rounded border border-border bg-card-hover px-3 py-2">
                        <code className="flex-1 text-xs text-foreground">code --install-extension prune-0.1.0.vsix</code>
                        <button
                          onClick={() => handleCopy("code --install-extension prune-0.1.0.vsix")}
                          className="shrink-0 rounded border border-border px-2 py-1 text-xs text-secondary hover:bg-border hover:text-foreground"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => setOnboardStep(2)}
                      className={cn(
                        "mt-5 w-full rounded-lg bg-status-green px-4 py-2.5 text-sm font-medium text-white transition-all duration-200",
                        "hover:bg-emerald-600 hover:shadow-md",
                        "focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-2"
                      )}
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
                          <kbd className="rounded border border-border bg-card-hover px-1 py-0.5 font-mono text-xs">Ctrl+Alt+P</kbd> to analyze before sending
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 flex gap-3">
                      <button
                        onClick={() => setOnboardStep(1)}
                        className={cn(
                          "flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-all duration-200",
                          "hover:bg-card-hover",
                          "focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-2"
                        )}
                      >
                        Back
                      </button>
                      <button
                        onClick={() => setOnboardStep(3)}
                        className={cn(
                          "flex-1 rounded-lg bg-status-green px-4 py-2.5 text-sm font-medium text-white transition-all duration-200",
                          "hover:bg-emerald-600 hover:shadow-md",
                          "focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-2"
                        )}
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}

                {onboardStep === 3 && (
                  <>
                    <div className="flex justify-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-prune-green text-white">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>

                    <h2 className="mt-4 text-center text-lg font-semibold text-foreground">You're all set</h2>
                    <p className="mt-2 text-center text-sm text-secondary">
                      TokenLens is now running locally in your editor.
                    </p>

                    <div className="mt-5 rounded border border-border bg-card-hover p-4">
                      <p className="text-xs font-medium text-foreground">What happens next:</p>
                      <ul className="mt-2 space-y-1.5 text-xs text-secondary">
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 text-prune-green">●</span>
                          <span>Token count shows in status bar</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 text-prune-green">●</span>
                          <span>Smart Copy reduces tokens by 70-90%</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 text-prune-green">●</span>
                          <span>Pre-flight shows spend before you send</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 text-prune-green">●</span>
                          <span>All processing stays on your machine</span>
                        </li>
                      </ul>
                    </div>

                    <button
                      onClick={handleOpenDashboard}
                      className={cn(
                        "mt-5 w-full rounded-lg bg-status-green px-4 py-2.5 text-sm font-medium text-white transition-all duration-200",
                        "hover:bg-emerald-600 hover:shadow-md",
                        "focus:outline-none focus:ring-2 focus:ring-status-green focus:ring-offset-2"
                      )}
                    >
                      Open Dashboard
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-8">
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
