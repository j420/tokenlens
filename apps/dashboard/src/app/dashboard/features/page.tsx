"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePreferredIDE, getIDEUri, type IDEType } from "@/components/ide-selector";

interface Feature {
  id: string;
  command: string;
  title: string;
  description: string;
  aiContext: string; // Plain language explanation of the benefit
  keybinding?: { windows: string; mac: string };
  category: "token-saver" | "analysis" | "utility";
  icon: string;
}

const FEATURES: Feature[] = [
  // Token Saver Commands
  {
    id: "smartCopy",
    command: "prune.smartCopy",
    title: "Smart Copy",
    description:
      "Copy files optimized for AI. Generates signatures-only format instead of full code. Typical savings: 70-90%.",
    aiContext: "Paste into AI chat and get better answers with less cost",
    keybinding: { windows: "Ctrl+Alt+C", mac: "Cmd+Alt+C" },
    category: "token-saver",
    icon: "📋",
  },
  {
    id: "preflight",
    command: "prune.preflight",
    title: "Pre-flight Optimizer",
    description:
      "Analyze context before sending to AI. Shows current vs. recommended token usage with potential savings.",
    aiContext: "Know the exact cost before you send your request",
    keybinding: { windows: "Ctrl+Alt+P", mac: "Cmd+Alt+P" },
    category: "token-saver",
    icon: "⚡",
  },
  {
    id: "sessionStats",
    command: "prune.sessionStats",
    title: "Session Memory Stats",
    description:
      "View deduplication stats showing files tracked and tokens saved from avoiding re-reads.",
    aiContext: "AI remembers what it already read so it doesn't read again",
    category: "token-saver",
    icon: "📊",
  },
  {
    id: "compactionCheck",
    command: "prune.compactionCheck",
    title: "Compaction Recovery",
    description:
      "Check for architectural decisions at risk of being forgotten during context compaction.",
    aiContext: "Keep important decisions from getting lost in long conversations",
    category: "token-saver",
    icon: "🔄",
  },
  {
    id: "trackDecision",
    command: "prune.trackDecision",
    title: "Track Decision",
    description:
      "Manually record an important architectural decision to protect it from context loss.",
    aiContext: "Bookmark key decisions so they don't get forgotten",
    category: "token-saver",
    icon: "📌",
  },
  {
    id: "resetSession",
    command: "prune.resetSession",
    title: "Reset Session",
    description:
      "Clear session memory including file tracking and decision history. Start fresh.",
    aiContext: "Clear everything and start a new conversation",
    category: "token-saver",
    icon: "🗑️",
  },

  // Analysis Commands
  {
    id: "analyzeFile",
    command: "prune.analyzeFile",
    title: "Analyze Current File",
    description:
      "Show token count and estimated cost for the currently open file.",
    aiContext: "Know the cost before asking AI",
    keybinding: { windows: "Ctrl+Alt+T", mac: "Cmd+Alt+T" },
    category: "analysis",
    icon: "📄",
  },
  {
    id: "analyzeSelection",
    command: "prune.analyzeSelection",
    title: "Analyze Selection",
    description: "Count tokens for the selected text in the editor.",
    aiContext: "Count tokens in just the text you select",
    category: "analysis",
    icon: "✂️",
  },
  {
    id: "analyzeContext",
    command: "prune.analyzeContext",
    title: "Smart Context Analysis",
    description:
      "Analyze workspace files for relevance to a given task. Recommends which files to include.",
    aiContext: "Find the most relevant files for your task",
    keybinding: { windows: "Ctrl+Alt+A", mac: "Cmd+Alt+A" },
    category: "analysis",
    icon: "🎯",
  },
  {
    id: "smartContext",
    command: "prune.smartContext",
    title: "Intelligent Context (v2)",
    description:
      "Automatically picks the right code based on what you're asking. The most advanced context selection.",
    aiContext: "AI understands your question and selects relevant code for you",
    category: "analysis",
    icon: "🧠",
  },
  {
    id: "squeezeFile",
    command: "prune.squeezeFile",
    title: "Squeeze File",
    description:
      "Compress code while keeping it readable. Choose from light (~15%), medium (~40%), or heavy (~70%) compression.",
    aiContext: "Shrink your code while AI can still understand it",
    category: "analysis",
    icon: "🗜️",
  },

  // Utility Commands
  {
    id: "checkCursorUsage",
    command: "prune.checkCursorUsage",
    title: "Check Cursor Usage",
    description:
      "Read Cursor's local SQLite database to show usage stats. Zero API keys required.",
    aiContext: "See how many requests you've used this month",
    category: "utility",
    icon: "🔷",
  },
  {
    id: "runTests",
    command: "prune.runTests",
    title: "Run Intelligence Tests",
    description:
      "Run the built-in test suite (107+ tests) to verify the intelligence engine.",
    aiContext: "Make sure everything is working correctly",
    category: "utility",
    icon: "🧪",
  },
];

type CategoryFilter = "all" | "token-saver" | "analysis" | "utility";


function KeybindingBadge({ keybinding }: { keybinding: Feature["keybinding"] }) {
  if (!keybinding) return null;

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");

  return (
    <kbd className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-secondary">
      {isMac ? keybinding.mac : keybinding.windows}
    </kbd>
  );
}

function FeatureCard({ feature, ide }: { feature: Feature; ide: IDEType }) {
  const uri = getIDEUri(ide, feature.id);
  const ideName = ide === "cursor" ? "Cursor" : ide === "vscode" ? "Claude Code" : "Codex";

  return (
    <div className="group rounded-lg border border-border bg-card p-6 transition hover:border-secondary hover:shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-2xl">{feature.icon}</span>
        <div>
          <h3 className="font-semibold text-foreground">{feature.title}</h3>
          <code className="text-xs text-secondary">{feature.command}</code>
        </div>
      </div>

      <p className="mb-2 text-sm text-secondary">{feature.description}</p>
      <p className="mb-4 text-xs text-secondary">{feature.aiContext}</p>

      <div className="flex items-center justify-between">
        <KeybindingBadge keybinding={feature.keybinding} />

        <a
          href={uri}
          className="inline-flex items-center gap-1.5 rounded-md bg-card-hover px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-border group-hover:bg-prune-green group-hover:text-white"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
          Open in {ideName}
        </a>
      </div>
    </div>
  );
}

export default function FeaturesPage() {
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [preferredIDE] = usePreferredIDE();

  const filteredFeatures =
    filter === "all"
      ? FEATURES
      : FEATURES.filter((f) => f.category === filter);

  const categoryStats = {
    all: FEATURES.length,
    "token-saver": FEATURES.filter((f) => f.category === "token-saver").length,
    analysis: FEATURES.filter((f) => f.category === "analysis").length,
    utility: FEATURES.filter((f) => f.category === "utility").length,
  };

  const ideName = preferredIDE === "cursor" ? "Cursor" : preferredIDE === "vscode" ? "Claude Code" : "Codex";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Extension Features</h1>
        <p className="mt-1 text-secondary">
          All Prune commands available in your editor. Click &quot;Open in {ideName}&quot; to run
          any command directly from here.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex gap-2">
        {(
          [
            { key: "all", label: "All Features" },
            { key: "token-saver", label: "Token Savers" },
            { key: "analysis", label: "Analysis" },
            { key: "utility", label: "Utility" },
          ] as { key: CategoryFilter; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition",
              filter === key
                ? "bg-prune-green text-white"
                : "bg-card-hover text-secondary hover:bg-border"
            )}
          >
            {label}
            <span
              className={cn(
                "ml-2 rounded-full px-2 py-0.5 text-xs",
                filter === key ? "bg-white/20" : "bg-border"
              )}
            >
              {categoryStats[key]}
            </span>
          </button>
        ))}
      </div>

      {/* How it works notice */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex gap-3">
          <span className="text-xl">💡</span>
          <div>
            <h3 className="font-medium text-blue-900">Dashboard → IDE Integration</h3>
            <p className="mt-1 text-sm text-blue-800">
              Clicking &quot;Open in {ideName}&quot; will launch your editor and execute the
              command. Make sure the Prune extension is installed. You can change your preferred IDE using the selector in the header.
            </p>
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {filteredFeatures.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} ide={preferredIDE} />
        ))}
      </div>

      {/* Quick actions */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">
          Quick Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          <a
            href={getIDEUri(preferredIDE, "smartCopy")}
            className="inline-flex items-center gap-2 rounded-lg bg-prune-green px-4 py-2 font-medium text-white transition hover:bg-emerald-600"
          >
            📋 Smart Copy
          </a>
          <a
            href={getIDEUri(preferredIDE, "preflight")}
            className="inline-flex items-center gap-2 rounded-lg bg-prune-green px-4 py-2 font-medium text-white transition hover:bg-emerald-600"
          >
            ⚡ Pre-flight
          </a>
          <a
            href={getIDEUri(preferredIDE, "compactionCheck")}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600"
          >
            🔄 Check Compaction
          </a>
          <a
            href={getIDEUri(preferredIDE, "sessionStats")}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-600 px-4 py-2 font-medium text-white transition hover:bg-gray-700"
          >
            📊 Session Stats
          </a>
        </div>
      </div>
    </div>
  );
}
