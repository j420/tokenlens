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

  const statusBg =
    turn.status === "clean"
      ? "bg-white"
      : turn.status === "loop_start"
      ? "bg-amber-50 border-amber-200"
      : "bg-red-50 border-red-200";

  const statusIcon =
    turn.status === "clean" ? "✅" : turn.status === "loop_start" ? "⚠️" : "🔴";

  return (
    <div className={cn("rounded-lg border p-4", statusBg)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">
          Turn {turn.number} · {time}
        </span>
        <span className="flex items-center gap-2 text-sm">
          <span className={cn("font-medium", getRoiColor(turn.roi))}>
            ROI: {Math.round(turn.roi * 100)}%
          </span>
          <span>{statusIcon}</span>
          <span className="font-medium">{formatCurrency(turn.cost)}</span>
        </span>
      </div>
      <p className="text-gray-900">"{turn.prompt}"</p>
      <p className="mt-1 text-sm text-gray-600">
        {formatTokens(turn.tokensIn)} in · {formatTokens(turn.tokensOut)} out
      </p>
      {turn.wasteAlert && (
        <p className="mt-2 text-sm text-amber-700">⚠ {turn.wasteAlert}</p>
      )}
      {turn.note && <p className="mt-2 text-sm text-prune-green">✅ {turn.note}</p>}
      {turn.status === "loop_start" && (
        <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          LOOP START
        </span>
      )}
      {turn.status === "loop_continued" && (
        <span className="mt-2 inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
          LOOP CONTINUED
        </span>
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

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">📋</span>
        <span className="font-medium text-blue-900">COMPACTION · {time}</span>
      </div>
      <p className="text-sm text-blue-800">
        Context reduced from {formatTokens(compaction.tokensBefore)} →{" "}
        {formatTokens(compaction.tokensAfter)} tokens
      </p>
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
      <button className="mt-3 text-sm font-medium text-blue-700 hover:underline">
        View full diff
      </button>
    </div>
  );
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
        <Link href="/dashboard" className="mt-4 text-prune-green hover:underline">
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
  const timeline: Array<{ type: "turn" | "compaction"; data: Turn | Compaction; sortTime: Date }> =
    [];
  session.turns.forEach((turn) => {
    timeline.push({ type: "turn", data: turn, sortTime: new Date(turn.time) });
  });
  session.compactions.forEach((compaction) => {
    timeline.push({ type: "compaction", data: compaction, sortTime: new Date(compaction.time) });
  });
  timeline.sort((a, b) => a.sortTime.getTime() - b.sortTime.getTime());

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link href="/dashboard" className="inline-flex items-center text-gray-500 hover:text-gray-700">
        ← Back to Dashboard
      </Link>

      {/* Session header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Session: {session.taskDescription}
        </h1>
        <p className="mt-1 text-gray-600">
          {toolName} · {session.model} · {startTime} - {endTime}
        </p>
        <div className="mt-4 flex gap-6 text-sm">
          <span>
            Total: <strong>{formatTokens(session.totalTokens)}</strong> tokens
          </span>
          <span>
            Cost: <strong>{formatCurrency(session.totalCost)}</strong>
          </span>
          <span className={getRoiColor(session.roi)}>
            ROI: <strong>{Math.round(session.roi * 100)}%</strong>
          </span>
        </div>
      </div>

      {/* Turn-by-turn timeline */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Turn-by-Turn Timeline</h2>
        <div className="space-y-3">
          {timeline.map((item, i) =>
            item.type === "turn" ? (
              <TurnCard key={`turn-${i}`} turn={item.data as Turn} />
            ) : (
              <CompactionCard key={`compaction-${i}`} compaction={item.data as Compaction} />
            )
          )}
        </div>
      </div>

      {/* Session summary */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Session Summary</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Total cost:</span>
            <span className="font-medium">{formatCurrency(session.totalCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Productive cost:</span>
            <span className="font-medium text-prune-green">
              {formatCurrency(session.productiveCost)} ({Math.round((session.productiveCost / session.totalCost) * 100)}%)
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Wasted cost:</span>
            <span className="font-medium text-prune-red">
              {formatCurrency(session.wastedCost)} ({Math.round((session.wastedCost / session.totalCost) * 100)}%)
            </span>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="mb-2 font-medium text-gray-700">Waste breakdown:</p>
            <ul className="space-y-1 pl-4">
              {session.wasteBreakdown.map((waste, i) => (
                <li key={i} className="text-gray-600">
                  {waste.pattern.replace(/_/g, " ")}
                  {waste.file && ` (${waste.file})`}: {formatCurrency(waste.cost)}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Prune interventions:</span>
              <span>
                {session.pruneInterventions.burnAlerts} burn alert
                {session.pruneInterventions.burnAlerts !== 1 ? "s" : ""},{" "}
                {session.pruneInterventions.compactionNotices} compaction notice
                {session.pruneInterventions.compactionNotices !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-3">
            <span className="text-gray-600">Estimated savings from Prune:</span>
            <span className="font-medium text-prune-green">
              {formatCurrency(session.estimatedSavings)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
