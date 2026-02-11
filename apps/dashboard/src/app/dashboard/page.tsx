"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn, formatCurrency, formatTokens, getSpendColor, getRoiColor, getRoiBgColor } from "@/lib/utils";
import { usePreferredIDE, getIDEUri, type IDEType } from "@/components/ide-selector";

// ============================================================================
// Types
// ============================================================================

type TimePeriod = "today" | "week" | "month";
type DashboardTab = "overview" | "features" | "setup";

interface Session {
  id: string;
  tool: "claude-code" | "cursor" | "codex";
  taskDescription: string;
  tokens: number;
  cost: number;
  roi: number;
  wasteEvents: number;
  compactions: number;
  startTime: string | Date;
}

interface OverviewData {
  todaySpend: number;
  dailyAverage: number;
  sessions: number;
  productiveRoi: number;
  pruneSaved: number;
  pruneSavedDetails: { trims: number; alerts: number };
  recentSessions: Session[];
  chartData: Array<{
    date: string;
    productive: number;
    waste: number;
  }>;
}

interface Feature {
  id: string;
  command: string;
  title: string;
  description: string;
  keybinding?: { windows: string; mac: string };
  category: "token-saver" | "analysis" | "utility";
  impact: "high" | "medium" | "low";
  icon: string;
}

// ============================================================================
// Data
// ============================================================================

const EMPTY_DATA: OverviewData = {
  todaySpend: 0,
  dailyAverage: 0,
  sessions: 0,
  productiveRoi: 0,
  pruneSaved: 0,
  pruneSavedDetails: { trims: 0, alerts: 0 },
  recentSessions: [],
  chartData: [
    { date: "Mon", productive: 0, waste: 0 },
    { date: "Tue", productive: 0, waste: 0 },
    { date: "Wed", productive: 0, waste: 0 },
    { date: "Thu", productive: 0, waste: 0 },
    { date: "Fri", productive: 0, waste: 0 },
    { date: "Sat", productive: 0, waste: 0 },
    { date: "Sun", productive: 0, waste: 0 },
  ],
};

const FEATURES: Feature[] = [
  // Token Saver Commands (High Impact)
  {
    id: "smartCopy",
    command: "prune.smartCopy",
    title: "Smart Copy",
    description:
      "Copy files optimized for AI. Generates signatures-only format instead of full code. Typical savings: 70-90%.",
    keybinding: { windows: "Ctrl+Alt+C", mac: "Cmd+Alt+C" },
    category: "token-saver",
    impact: "high",
    icon: "copy",
  },
  {
    id: "preflight",
    command: "prune.preflight",
    title: "Pre-flight Optimizer",
    description:
      "Analyze context before sending to AI. Shows current vs. recommended token usage with potential savings.",
    keybinding: { windows: "Ctrl+Alt+P", mac: "Cmd+Alt+P" },
    category: "token-saver",
    impact: "high",
    icon: "zap",
  },
  {
    id: "sessionStats",
    command: "prune.sessionStats",
    title: "Session Memory Stats",
    description:
      "View deduplication stats showing files tracked and tokens saved from avoiding re-reads.",
    category: "token-saver",
    impact: "medium",
    icon: "chart",
  },
  {
    id: "compactionCheck",
    command: "prune.compactionCheck",
    title: "Compaction Recovery",
    description:
      "Check for architectural decisions at risk of being forgotten during context compaction.",
    category: "token-saver",
    impact: "high",
    icon: "refresh",
  },
  {
    id: "trackDecision",
    command: "prune.trackDecision",
    title: "Track Decision",
    description:
      "Manually record an important architectural decision to protect it from context loss.",
    category: "token-saver",
    impact: "medium",
    icon: "pin",
  },
  {
    id: "resetSession",
    command: "prune.resetSession",
    title: "Reset Session",
    description:
      "Clear session memory including file tracking and decision history. Start fresh.",
    category: "token-saver",
    impact: "low",
    icon: "trash",
  },
  // Analysis Commands
  {
    id: "analyzeFile",
    command: "prune.analyzeFile",
    title: "Analyze Current File",
    description:
      "Show token count and estimated cost for the currently open file.",
    keybinding: { windows: "Ctrl+Alt+T", mac: "Cmd+Alt+T" },
    category: "analysis",
    impact: "medium",
    icon: "file",
  },
  {
    id: "analyzeSelection",
    command: "prune.analyzeSelection",
    title: "Analyze Selection",
    description: "Count tokens for the selected text in the editor.",
    category: "analysis",
    impact: "low",
    icon: "scissors",
  },
  {
    id: "analyzeContext",
    command: "prune.analyzeContext",
    title: "Smart Context Analysis",
    description:
      "Analyze workspace files for relevance to a given task. Recommends which files to include.",
    keybinding: { windows: "Ctrl+Alt+A", mac: "Cmd+Alt+A" },
    category: "analysis",
    impact: "high",
    icon: "target",
  },
  {
    id: "smartContext",
    command: "prune.smartContext",
    title: "Intelligent Context (v2)",
    description:
      "Symbol-level DAG analysis with relevance categorization. The most advanced context selection.",
    category: "analysis",
    impact: "high",
    icon: "brain",
  },
  {
    id: "squeezeFile",
    command: "prune.squeezeFile",
    title: "Squeeze File",
    description:
      "Compress file using tree-sitter AST. Three tiers: lossless (~15%), structural (~40%), telegraphic (~70%).",
    category: "analysis",
    impact: "medium",
    icon: "compress",
  },
  // Utility Commands
  {
    id: "checkCursorUsage",
    command: "prune.checkCursorUsage",
    title: "Check Cursor Usage",
    description:
      "Read Cursor's local SQLite database to show usage stats. Zero API keys required.",
    category: "utility",
    impact: "medium",
    icon: "cursor",
  },
  {
    id: "runTests",
    command: "prune.runTests",
    title: "Run Intelligence Tests",
    description:
      "Run the built-in test suite (107+ tests) to verify the intelligence engine.",
    category: "utility",
    impact: "low",
    icon: "flask",
  },
];

// ============================================================================
// Icons
// ============================================================================

function FeatureIcon({ icon, className }: { icon: string; className?: string }) {
  const iconClass = cn("h-5 w-5", className);

  switch (icon) {
    case "copy":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    case "zap":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case "chart":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      );
    case "refresh":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      );
    case "pin":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      );
    case "trash":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      );
    case "file":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "scissors":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
        </svg>
      );
    case "target":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth={2} />
          <circle cx="12" cy="12" r="6" strokeWidth={2} />
          <circle cx="12" cy="12" r="2" strokeWidth={2} />
        </svg>
      );
    case "brain":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      );
    case "compress":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      );
    case "cursor":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
        </svg>
      );
    case "flask":
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
  }
}

// ============================================================================
// Overview Components
// ============================================================================

function ToolIcon({ tool }: { tool: "claude-code" | "cursor" | "codex" }) {
  const iconClass = "h-4 w-4";
  switch (tool) {
    case "claude-code":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l2.5 2.5" strokeLinecap="round" />
        </svg>
      );
    case "cursor":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" opacity="0.2" />
          <path d="M7 7l10 5-10 5V7z" fill="currentColor" />
        </svg>
      );
    case "codex":
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" opacity="0.2" />
          <path d="M8 12h8M8 8h8M8 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

function StatCard({
  title,
  value,
  subtitle,
  bar,
}: {
  title: string;
  value: string;
  subtitle?: string;
  bar?: { value: number; color: string };
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="text-sm font-medium text-muted">{title}</h3>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      {bar && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-border">
          <div
            className={cn("h-full rounded-full", bar.color)}
            style={{ width: `${bar.value * 100}%` }}
          />
        </div>
      )}
      {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  const startDate = typeof session.startTime === "string" ? new Date(session.startTime) : session.startTime;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(startDate);

  const toolName =
    session.tool === "claude-code"
      ? "Claude Code"
      : session.tool === "cursor"
      ? "Cursor"
      : "Codex CLI";

  return (
    <Link
      href={`/dashboard/session/${session.id}`}
      className="block rounded-lg border border-border bg-card p-4 transition hover:border-secondary hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between text-sm text-muted">
        <span className="flex items-center gap-2">
          <ToolIcon tool={session.tool} />
          {time} · {toolName}
        </span>
      </div>
      <h4 className="font-medium text-foreground">{session.taskDescription}</h4>
      <p className="mt-1 text-sm text-secondary">
        {formatTokens(session.tokens)} tokens · {formatCurrency(session.cost)}
      </p>
      <div className="mt-3 flex items-center gap-4 text-sm">
        <span className={cn("font-medium", getRoiColor(session.roi))}>
          ROI: {Math.round(session.roi * 100)}%
        </span>
        {session.wasteEvents > 0 ? (
          <span className="text-amber-600">⚠ {session.wasteEvents} waste event{session.wasteEvents > 1 ? "s" : ""}</span>
        ) : (
          <span className="text-prune-green">Clean session</span>
        )}
      </div>
    </Link>
  );
}

// ============================================================================
// Features Components
// ============================================================================

type CategoryFilter = "all" | "token-saver" | "analysis" | "utility";

function ImpactBadge({ impact }: { impact: Feature["impact"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        impact === "high" && "bg-status-green/10 text-status-green",
        impact === "medium" && "bg-status-amber/10 text-status-amber",
        impact === "low" && "bg-card-hover text-secondary"
      )}
    >
      {impact === "high" && "High Impact"}
      {impact === "medium" && "Medium"}
      {impact === "low" && "Utility"}
    </span>
  );
}

function KeybindingBadge({ keybinding }: { keybinding: Feature["keybinding"] }) {
  if (!keybinding) return null;

  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

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
    <div className="group rounded-lg border border-border bg-card p-5 transition hover:border-secondary hover:shadow-sm">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card-hover text-secondary group-hover:bg-prune-green/10 group-hover:text-prune-green">
            <FeatureIcon icon={feature.icon} />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{feature.title}</h3>
            <code className="text-xs text-muted">{feature.command}</code>
          </div>
        </div>
        <ImpactBadge impact={feature.impact} />
      </div>

      <p className="mb-4 text-sm text-secondary">{feature.description}</p>

      <div className="flex items-center justify-between">
        <KeybindingBadge keybinding={feature.keybinding} />

        <a
          href={uri}
          className="inline-flex items-center gap-1.5 rounded-md bg-card-hover px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-border group-hover:bg-prune-green group-hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Open in {ideName}
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Tab Sections
// ============================================================================

function OverviewSection({ period, data }: { period: TimePeriod; data: OverviewData }) {
  const spendDiff = data.todaySpend - data.dailyAverage;
  const spendDiffText =
    spendDiff > 0
      ? `+${formatCurrency(spendDiff)} vs. avg`
      : spendDiff < 0
      ? `${formatCurrency(spendDiff)} vs. avg`
      : "Same as avg";

  return (
    <div className="space-y-6">
      {/* Big number + Stat cards in a grid */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-6 md:col-span-1">
          <h2 className="text-sm font-medium text-muted">
            {period === "today" ? "Today" : period === "week" ? "This Week" : "This Month"}
          </h2>
          <p className={cn("mt-2 text-3xl font-bold", getSpendColor(data.todaySpend))}>
            {formatCurrency(data.todaySpend)}
          </p>
          <p className="mt-1 text-xs text-muted">{spendDiffText}</p>
        </div>
        <StatCard title="Sessions" value={data.sessions.toString()} subtitle={period} />
        <StatCard
          title="Productive"
          value={`${Math.round(data.productiveRoi * 100)}%`}
          bar={{ value: data.productiveRoi, color: getRoiBgColor(data.productiveRoi) }}
        />
        <StatCard
          title="Prune Saved"
          value={formatCurrency(data.pruneSaved)}
          subtitle={`${data.pruneSavedDetails.trims} trims`}
        />
      </div>

      {/* Chart and Sessions side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sessions list */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Sessions</h3>
          <div className="space-y-2">
            {data.recentSessions.slice(0, 4).map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
          {data.recentSessions.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted">No sessions yet. Start using your AI coding tool!</p>
            </div>
          )}
          {data.recentSessions.length > 4 && (
            <Link href="/dashboard/session" className="mt-3 block text-center text-sm text-prune-green hover:underline">
              View all sessions →
            </Link>
          )}
        </div>

        {/* Chart */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">7-Day Trend</h3>
          <div className="rounded-lg border border-border bg-card p-4">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" stroke="#6b7280" fontSize={11} />
                <YAxis stroke="#6b7280" fontSize={11} tickFormatter={(value) => `$${value}`} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatCurrency(value),
                    name === "productive" ? "Productive" : "Waste",
                  ]}
                  contentStyle={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                />
                <Area type="monotone" dataKey="productive" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                <Area type="monotone" dataKey="waste" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 flex justify-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-sm bg-prune-green" />
                <span className="text-secondary">Productive</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                <span className="text-secondary">Waste</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturesSection({ ide }: { ide: IDEType }) {
  const [filter, setFilter] = useState<CategoryFilter>("all");

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

  const ideName = ide === "cursor" ? "Cursor" : ide === "vscode" ? "Claude Code" : "Codex";

  return (
    <div className="space-y-6">
      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "all", label: "All" },
            { key: "token-saver", label: "Token Savers" },
            { key: "analysis", label: "Analysis" },
            { key: "utility", label: "Utility" },
          ] as { key: CategoryFilter; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              filter === key
                ? "bg-prune-green text-white"
                : "bg-card-hover text-secondary hover:bg-border"
            )}
          >
            {label}
            <span
              className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-xs",
                filter === key ? "bg-white/20" : "bg-border"
              )}
            >
              {categoryStats[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <a
            href={getIDEUri(ide, "smartCopy")}
            className="inline-flex items-center gap-2 rounded-lg bg-prune-green px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
          >
            <FeatureIcon icon="copy" className="h-4 w-4" />
            Smart Copy
          </a>
          <a
            href={getIDEUri(ide, "preflight")}
            className="inline-flex items-center gap-2 rounded-lg bg-prune-green px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
          >
            <FeatureIcon icon="zap" className="h-4 w-4" />
            Pre-flight
          </a>
          <a
            href={getIDEUri(ide, "compactionCheck")}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600"
          >
            <FeatureIcon icon="refresh" className="h-4 w-4" />
            Check Compaction
          </a>
          <a
            href={getIDEUri(ide, "sessionStats")}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            <FeatureIcon icon="chart" className="h-4 w-4" />
            Session Stats
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">
          Buttons open commands in {ideName}. Select your IDE using the dropdown in the header.
        </p>
      </div>

      {/* Feature grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {filteredFeatures.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} ide={ide} />
        ))}
      </div>
    </div>
  );
}

function SetupSection({ ide }: { ide: IDEType }) {
  const ideName = ide === "cursor" ? "Cursor" : ide === "vscode" ? "Claude Code" : "Codex";
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (step: number) => {
    const newCompleted = new Set(completedSteps);
    if (newCompleted.has(step)) {
      newCompleted.delete(step);
    } else {
      newCompleted.add(step);
    }
    setCompletedSteps(newCompleted);
  };

  const steps = [
    {
      title: "Install the Prune Extension",
      description: `Install the extension in ${ideName} to enable token tracking.`,
      action: (
        <a
          href="vscode:extension/delimit.prune"
          className="inline-flex items-center gap-2 rounded-md bg-prune-green px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
        >
          Install Extension
        </a>
      ),
      code: "ext install delimit.prune",
    },
    {
      title: "Open a Code File",
      description: "Open any code file in your workspace. The status bar will show token count.",
      action: null,
      tip: "Look for the token count in the bottom status bar",
    },
    {
      title: "Try Smart Copy",
      description: "Select files in the explorer, right-click, and choose 'Copy for AI (Optimized)'.",
      action: (
        <a
          href={getIDEUri(ide, "smartCopy")}
          className="inline-flex items-center gap-2 rounded-md bg-card-hover px-3 py-1.5 text-sm font-medium text-foreground hover:bg-border"
        >
          Try Smart Copy
        </a>
      ),
      keybinding: "Ctrl+Alt+C / Cmd+Alt+C",
    },
    {
      title: "Run Pre-flight Check",
      description: "Before sending a prompt to AI, run pre-flight to see potential savings.",
      action: (
        <a
          href={getIDEUri(ide, "preflight")}
          className="inline-flex items-center gap-2 rounded-md bg-card-hover px-3 py-1.5 text-sm font-medium text-foreground hover:bg-border"
        >
          Try Pre-flight
        </a>
      ),
      keybinding: "Ctrl+Alt+P / Cmd+Alt+P",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Setup Progress</h3>
          <span className="text-sm text-muted">
            {completedSteps.size} of {steps.length} completed
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-prune-green transition-all"
            style={{ width: `${(completedSteps.size / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, index) => (
          <div
            key={index}
            className={cn(
              "rounded-lg border bg-card p-5 transition",
              completedSteps.has(index) ? "border-prune-green/50 bg-prune-green/5" : "border-border"
            )}
          >
            <div className="flex items-start gap-4">
              <button
                onClick={() => toggleStep(index)}
                className={cn(
                  "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition",
                  completedSteps.has(index)
                    ? "border-prune-green bg-prune-green text-white"
                    : "border-border hover:border-secondary"
                )}
              >
                {completedSteps.has(index) && (
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className={cn("font-medium", completedSteps.has(index) ? "text-prune-green" : "text-foreground")}>
                    {index + 1}. {step.title}
                  </h4>
                  {step.action}
                </div>
                <p className="mt-1 text-sm text-secondary">{step.description}</p>
                {step.code && (
                  <code className="mt-2 block rounded bg-card-hover px-3 py-2 font-mono text-xs text-foreground">
                    {step.code}
                  </code>
                )}
                {step.keybinding && (
                  <p className="mt-2 text-xs text-muted">
                    Keybinding: <kbd className="rounded bg-card-hover px-1.5 py-0.5 font-mono">{step.keybinding}</kbd>
                  </p>
                )}
                {step.tip && (
                  <p className="mt-2 text-xs text-status-amber">Tip: {step.tip}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Additional resources */}
      <div className="rounded-lg border border-status-amber/30 bg-status-amber/10 p-4">
        <div className="flex gap-3">
          <span className="text-xl">📚</span>
          <div>
            <h3 className="font-medium text-foreground">Need more help?</h3>
            <p className="mt-1 text-sm text-secondary">
              Check out our{" "}
              <a href="https://docs.delimit.dev" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
                documentation
              </a>{" "}
              or visit the{" "}
              <Link href="/onboard" className="underline hover:no-underline">
                full onboarding guide
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function DashboardPage() {
  const [period, setPeriod] = useState<TimePeriod>("today");
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferredIDE] = usePreferredIDE();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/dashboard/overview?period=${period}`);
        if (response.ok) {
          const result = await response.json();
          setData(result);
        } else {
          setData(EMPTY_DATA);
        }
      } catch {
        setData(EMPTY_DATA);
      }
      setLoading(false);
    };

    fetchData();
  }, [period]);

  const hasData = data && (data.sessions > 0 || data.todaySpend > 0);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-prune-green" />
      </div>
    );
  }

  const tabs: { id: DashboardTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "overview",
      label: "Overview",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: "features",
      label: "Features",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      id: "setup",
      label: "Setup",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page header with tabs and period selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Tabs */}
        <div className="flex rounded-lg border border-border bg-card p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
                activeTab === tab.id
                  ? "bg-card-hover text-foreground"
                  : "text-muted hover:text-foreground"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Period selector (only show on overview) */}
        {activeTab === "overview" && (
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            {(["today", "week", "month"] as TimePeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  period === p
                    ? "bg-card-hover text-foreground"
                    : "text-muted hover:text-foreground"
                )}
              >
                {p === "today" ? "Today" : p === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Empty state for new users */}
      {!hasData && activeTab === "overview" && (
        <div className="rounded-lg border-2 border-dashed border-border bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-prune-green/10 text-2xl">
            🌱
          </div>
          <h2 className="mb-2 text-lg font-semibold text-foreground">Welcome to Prune!</h2>
          <p className="mb-4 text-sm text-secondary">
            Connect your AI coding tool to start tracking usage and costs.
          </p>
          <button
            onClick={() => setActiveTab("setup")}
            className="inline-flex items-center rounded-lg bg-prune-green px-4 py-2 font-medium text-white transition hover:bg-emerald-600"
          >
            Get Started →
          </button>
        </div>
      )}

      {/* Tab content */}
      {activeTab === "overview" && hasData && <OverviewSection period={period} data={data} />}
      {activeTab === "features" && <FeaturesSection ide={preferredIDE} />}
      {activeTab === "setup" && <SetupSection ide={preferredIDE} />}
    </div>
  );
}
