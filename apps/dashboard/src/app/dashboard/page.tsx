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

type TimePeriod = "today" | "week" | "month";

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

// Empty data for initial state
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

function ToolIcon({ tool }: { tool: "claude-code" | "cursor" | "codex" }) {
  switch (tool) {
    case "claude-code":
      return <span title="Claude Code">⌨️</span>;
    case "cursor":
      return <span title="Cursor">🔷</span>;
    case "codex":
      return <span title="Codex CLI">🖥️</span>;
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
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {bar && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={cn("h-full rounded-full", bar.color)}
            style={{ width: `${bar.value * 100}%` }}
          />
        </div>
      )}
      {subtitle && <p className="mt-2 text-sm text-gray-500">{subtitle}</p>}
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
      className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between text-sm text-gray-500">
        <span className="flex items-center gap-2">
          <ToolIcon tool={session.tool} />
          {time} · {toolName}
        </span>
      </div>
      <h4 className="font-medium text-gray-900">{session.taskDescription}</h4>
      <p className="mt-1 text-sm text-gray-600">
        {formatTokens(session.tokens)} tokens · {formatCurrency(session.cost)}
      </p>
      <div className="mt-3 flex items-center gap-4 text-sm">
        <span className={cn("font-medium", getRoiColor(session.roi))}>
          ROI: {Math.round(session.roi * 100)}%
        </span>
        {session.wasteEvents > 0 ? (
          <span className="text-amber-600">⚠ {session.wasteEvents} waste event{session.wasteEvents > 1 ? "s" : ""}</span>
        ) : (
          <span className="text-prune-green">✅ Clean session</span>
        )}
        {session.compactions > 0 && (
          <span className="text-gray-500">· {session.compactions} compaction{session.compactions > 1 ? "s" : ""}</span>
        )}
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<TimePeriod>("today");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Check if we have real data
  const hasData = data && (data.sessions > 0 || data.todaySpend > 0);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-prune-green" />
      </div>
    );
  }

  const spendDiff = data.todaySpend - data.dailyAverage;
  const spendDiffText =
    spendDiff > 0
      ? `▲ ${formatCurrency(spendDiff)} more than your daily average`
      : spendDiff < 0
      ? `▼ ${formatCurrency(Math.abs(spendDiff))} less than your daily average`
      : "Same as your daily average";

  // Empty state - no data yet
  if (!hasData) {
    return (
      <div className="space-y-8">
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-prune-green/10 text-3xl">
            🌱
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Welcome to Prune!</h2>
          <p className="mb-6 text-gray-600">
            Connect your AI coding tool to start tracking usage and costs.
          </p>

          <div className="mx-auto max-w-md rounded-lg bg-gray-50 p-6 text-left">
            <h3 className="mb-3 font-medium text-gray-900">Quick Setup:</h3>
            <ol className="space-y-2 text-sm text-gray-600">
              <li className="flex gap-2">
                <span className="font-semibold text-prune-green">1.</span>
                Install the Prune extension in VS Code / Cursor
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-prune-green">2.</span>
                Open any code file
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-prune-green">3.</span>
                Check the status bar for token counts
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-prune-green">4.</span>
                Right-click to access Prune commands
              </li>
            </ol>
          </div>

          <div className="mt-6">
            <Link
              href="/onboard"
              className="inline-flex items-center rounded-lg bg-prune-green px-6 py-3 font-medium text-white transition hover:bg-emerald-600"
            >
              Full Setup Guide →
            </Link>
          </div>
        </div>

        {/* Still show the chart area but empty */}
        <div>
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Spend Over Time (7 days)</h3>
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex h-[300px] items-center justify-center text-gray-400">
              Usage data will appear here once you start using the Prune extension
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Time period selector */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {(["today", "week", "month"] as TimePeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-medium transition",
                period === p
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {p === "today" ? "Today" : p === "week" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {/* Big number - Today's spend */}
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <h2 className="text-sm font-medium text-gray-500">
          {period === "today" ? "Today's" : period === "week" ? "This Week's" : "This Month's"} Spend
        </h2>
        <p className={cn("mt-2 text-5xl font-bold", getSpendColor(data.todaySpend))}>
          {formatCurrency(data.todaySpend)}
        </p>
        <p className="mt-2 text-sm text-gray-500">{spendDiffText}</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Sessions" value={data.sessions.toString()} subtitle="today" />
        <StatCard
          title="Productive"
          value={`${Math.round(data.productiveRoi * 100)}%`}
          bar={{ value: data.productiveRoi, color: getRoiBgColor(data.productiveRoi) }}
        />
        <StatCard
          title="Prune Saved"
          value={formatCurrency(data.pruneSaved)}
          subtitle={`${data.pruneSavedDetails.trims} trims, ${data.pruneSavedDetails.alerts} alert${data.pruneSavedDetails.alerts !== 1 ? "s" : ""}`}
        />
      </div>

      {/* Sessions list */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {period === "today" ? "Today's" : period === "week" ? "This Week's" : "This Month's"} Sessions
        </h3>
        <div className="space-y-3">
          {data.recentSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
        {data.recentSessions.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-gray-500">No sessions yet. Start using your AI coding tool!</p>
          </div>
        )}
      </div>

      {/* 7-day spend chart */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Spend Over Time (7 days)</h3>
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" stroke="#6b7280" fontSize={12} />
              <YAxis
                stroke="#6b7280"
                fontSize={12}
                tickFormatter={(value) => `$${value}`}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatCurrency(value),
                  name === "productive" ? "Productive" : "Waste",
                ]}
                labelStyle={{ color: "#374151" }}
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.5rem",
                }}
              />
              <Area
                type="monotone"
                dataKey="productive"
                stackId="1"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.6}
              />
              <Area
                type="monotone"
                dataKey="waste"
                stackId="1"
                stroke="#ef4444"
                fill="#ef4444"
                fillOpacity={0.6}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div className="mt-4 flex justify-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm bg-prune-green" />
              <span className="text-gray-600">Productive spend</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm bg-prune-red" />
              <span className="text-gray-600">Waste spend</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
