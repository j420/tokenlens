"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { cn, formatCurrency, formatTokens, getRoiColor } from "@/lib/utils";

interface Turn {
  number: number;
  time: string;
  prompt: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  roi: number;
  status: "clean" | "loop_start" | "loop_continued";
  wasteAlert?: string;
  note?: string;
}

interface Compaction {
  turn: number;
  time: string;
  tokensBefore: number;
  tokensAfter: number;
  lostReferences: Array<{ item: string; originalTurn: number }>;
}

interface SessionDetail {
  id: string;
  tool: string;
  model: string;
  taskDescription: string;
  startTime: string;
  endTime: string;
  totalTokens: number;
  totalCost: number;
  roi: number;
  productiveCost: number;
  wastedCost: number;
  wasteBreakdown: Array<{ pattern: string; file?: string; cost: number }>;
  pruneInterventions: { burnAlerts: number; compactionNotices: number };
  estimatedSavings: number;
  turns: Turn[];
  compactions: Compaction[];
}

function TurnCard({ turn }: { turn: Turn }) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(turn.time));

  const isWaste = turn.status !== "clean";
  const statusBg = !isWaste
    ? "bg-white border-gray-200"
    : turn.status === "loop_start"
    ? "bg-amber-50 border-amber-300"
    : "bg-red-50 border-red-300";

  const statusIcon = !isWaste ? "✅" : turn.status === "loop_start" ? "⚠️" : "🔴";

  // Truncate prompt to ~80 chars for display
  const promptDisplay =
    turn.prompt.length > 80 ? turn.prompt.slice(0, 77) + "..." : turn.prompt;

  return (
    <div className={cn("rounded-lg border p-4", statusBg)}>
      {/* Header row */}
      <div className="flex items-center justify-between border-b border-gray-200/50 pb-2">
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-700">Turn {turn.number}</span>
          <span className="text-gray-400">·</span>
          <span className="text-sm text-gray-500">{time}</span>
          {turn.status === "loop_start" && (
            <span className="rounded bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
              LOOP START
            </span>
          )}
          {turn.status === "loop_continued" && (
            <span className="rounded bg-red-200 px-2 py-0.5 text-xs font-semibold text-red-800">
              LOOP CONTINUED
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">{formatCurrency(turn.cost)}</span>
          <span>{statusIcon}</span>
        </div>
      </div>

      {/* Prompt */}
      <p className="mt-3 text-gray-900">"{promptDisplay}"</p>

      {/* Stats row */}
      <p className="mt-2 text-sm text-gray-600">
        {formatTokens(turn.tokensIn)} tokens in · {formatTokens(turn.tokensOut)} out ·{" "}
        <span className={cn("font-medium", getRoiColor(turn.roi))}>
          ROI: {Math.round(turn.roi * 100)}%
        </span>
      </p>

      {/* Waste alert inline */}
      {turn.wasteAlert && (
        <div className="mt-3 rounded bg-amber-100 px-3 py-2 text-sm text-amber-800">
          ⚠ {turn.wasteAlert}
        </div>
      )}

      {/* Positive note */}
      {turn.note && (
        <div className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ {turn.note}
        </div>
      )}
    </div>
  );
}

function CompactionCard({ compaction }: { compaction: Compaction }) {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(compaction.time));

  const tokensRemoved = compaction.tokensBefore - compaction.tokensAfter;

  return (
    <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-blue-200 pb-2">
        <span className="text-lg">📋</span>
        <span className="font-semibold text-blue-900">COMPACTION</span>
        <span className="text-blue-600">·</span>
        <span className="text-sm text-blue-600">{time}</span>
      </div>

      {/* Stats */}
      <p className="mt-3 text-sm text-blue-800">
        Context reduced from{" "}
        <span className="font-medium">{formatTokens(compaction.tokensBefore)}</span> →{" "}
        <span className="font-medium">{formatTokens(compaction.tokensAfter)}</span> tokens
        <span className="text-blue-600"> ({formatTokens(tokensRemoved)} removed)</span>
      </p>

      {/* Lost references */}
      {compaction.lostReferences.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-blue-800">Lost references:</p>
          <ul className="mt-1 space-y-1">
            {compaction.lostReferences.map((ref, i) => (
              <li key={i} className="text-sm text-blue-700">
                • {ref.item} (turn {ref.originalTurn})
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="mt-3 text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline">
        [View full diff]
      </button>
    </div>
  );
}

function formatPatternName(pattern: string): string {
  const names: Record<string, string> = {
    circular_loop: "Loop",
    redundant_reads: "Redundant file read",
    compaction_storm: "Compaction storm",
    compaction_overhead: "Compaction overhead",
    zero_acceptance: "Zero acceptance",
    mcp_bloat: "MCP overhead",
    cost_anomaly: "Cost anomaly",
  };
  return names[pattern] || pattern.replace(/_/g, " ");
}

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`/api/dashboard/session/${id}`);
        if (response.ok) {
          const data = await response.json();
          setSession(data);
        }
      } catch (error) {
        console.error("Failed to fetch session:", error);
      }
      setLoading(false);
    };

    fetchSession();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-prune-green" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900">Session not found</h1>
        <Link href="/dashboard" className="mt-4 inline-block text-prune-green hover:underline">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const startTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(session.startTime));

  const endTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(session.endTime));

  const toolName =
    session.tool === "claude-code"
      ? "Claude Code"
      : session.tool === "cursor"
      ? "Cursor"
      : "Codex CLI";

  // Merge turns and compactions into a timeline
  const timeline: Array<{ type: "turn" | "compaction"; data: Turn | Compaction; sortTime: Date }> = [];
  session.turns.forEach((turn) => {
    timeline.push({ type: "turn", data: turn, sortTime: new Date(turn.time) });
  });
  session.compactions.forEach((compaction) => {
    timeline.push({ type: "compaction", data: compaction, sortTime: new Date(compaction.time) });
  });
  timeline.sort((a, b) => a.sortTime.getTime() - b.sortTime.getTime());

  const productivePercent = session.totalCost > 0
    ? Math.round((session.productiveCost / session.totalCost) * 100)
    : 100;
  const wastedPercent = session.totalCost > 0
    ? Math.round((session.wastedCost / session.totalCost) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center text-gray-500 transition hover:text-gray-700"
      >
        ← Back to Dashboard
      </Link>

      {/* Session header */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Session: {session.taskDescription || "Untitled Session"}
        </h1>
        <p className="mt-2 text-gray-600">
          {toolName} · {session.model} · {startTime} - {endTime}
        </p>
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Total:</span>
            <span className="font-bold text-gray-900">{formatTokens(session.totalTokens)} tokens</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Cost:</span>
            <span className="font-bold text-gray-900">{formatCurrency(session.totalCost)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">ROI:</span>
            <span className={cn("font-bold", getRoiColor(session.roi))}>
              {Math.round(session.roi * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* Turn-by-turn timeline */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
          <span>Turn-by-Turn Timeline</span>
          <span className="text-sm font-normal text-gray-500">
            ({session.turns.length} turn{session.turns.length !== 1 ? "s" : ""})
          </span>
        </h2>
        <div className="space-y-3">
          {timeline.length > 0 ? (
            timeline.map((item, i) =>
              item.type === "turn" ? (
                <TurnCard key={`turn-${i}`} turn={item.data as Turn} />
              ) : (
                <CompactionCard key={`compaction-${i}`} compaction={item.data as Compaction} />
              )
            )
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
              No turns recorded for this session
            </div>
          )}
        </div>
      </div>

      {/* Session summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Session Summary</h2>
        <div className="space-y-4">
          {/* Cost breakdown */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total cost:</span>
              <span className="font-semibold">{formatCurrency(session.totalCost)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Productive cost:</span>
              <span className="font-semibold text-prune-green">
                {formatCurrency(session.productiveCost)} ({productivePercent}%)
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Wasted cost:</span>
              <span className="font-semibold text-prune-red">
                {formatCurrency(session.wastedCost)} ({wastedPercent}%)
              </span>
            </div>
          </div>

          {/* Waste breakdown */}
          {session.wasteBreakdown.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <p className="mb-2 text-sm font-medium text-gray-700">Waste breakdown:</p>
              <ul className="space-y-1 pl-4">
                {session.wasteBreakdown.map((waste, i) => (
                  <li key={i} className="text-sm text-gray-600">
                    {formatPatternName(waste.pattern)}
                    {waste.file && ` on ${waste.file}`}: {formatCurrency(waste.cost)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Prune interventions */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Prune interventions:</span>
              <span>
                {session.pruneInterventions.burnAlerts} burn alert
                {session.pruneInterventions.burnAlerts !== 1 ? "s" : ""},{" "}
                {session.pruneInterventions.compactionNotices} compaction notice
                {session.pruneInterventions.compactionNotices !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Estimated savings */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Estimated savings from Prune:</span>
              <span className="font-semibold text-prune-green">
                {formatCurrency(session.estimatedSavings)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
