"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { cn, formatCurrency, formatTokens, getRoiColor } from "@/lib/utils";

interface Session {
  id: string;
  tool: string;
  model: string;
  taskDescription: string;
  tokens: number;
  cost: number;
  roi: number;
  wasteEvents: number;
  compactions: number;
  startTime: string;
  endTime: string;
  turns: number;
}

function SessionCard({ session }: { session: Session }) {
  const startTime = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(session.startTime));

  const toolName =
    session.tool === "claude-code"
      ? "Claude Code"
      : session.tool === "cursor"
      ? "Cursor"
      : "Codex CLI";

  const hasWaste = session.wasteEvents > 0;

  return (
    <Link
      href={`/dashboard/session/${session.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">
            {session.taskDescription || "Untitled Session"}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {toolName} · {session.model} · {startTime}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-gray-900">{formatCurrency(session.cost)}</p>
          <p className={cn("text-sm font-medium", getRoiColor(session.roi))}>
            {Math.round(session.roi * 100)}% ROI
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm text-gray-600">
        <span>{formatTokens(session.tokens)} tokens</span>
        <span>{session.turns} turns</span>
        {session.compactions > 0 && (
          <span className="text-blue-600">{session.compactions} compaction{session.compactions !== 1 ? "s" : ""}</span>
        )}
        {hasWaste && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {session.wasteEvents} waste event{session.wasteEvents !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function SessionsListPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch("/api/dashboard/sessions");
        if (response.ok) {
          const data = await response.json();
          setSessions(data.sessions);
          setTotal(data.total);
        }
      } catch (error) {
        console.error("Failed to fetch sessions:", error);
      }
      setLoading(false);
    };

    fetchSessions();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-prune-green" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sessions</h1>
          <p className="mt-1 text-gray-500">
            {total} session{total !== 1 ? "s" : ""} recorded
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 transition hover:text-gray-700"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {sessions.length > 0 ? (
        <div className="space-y-3">
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <p className="text-gray-500">No sessions recorded yet</p>
          <p className="mt-2 text-sm text-gray-400">
            Sessions will appear here as you use AI coding tools
          </p>
        </div>
      )}
    </div>
  );
}
