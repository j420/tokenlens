"use client";

import { useState, useEffect } from "react";
import { cn, formatCurrency, getRoiColor, getRoiBgColor } from "@/lib/utils";

interface DeveloperStats {
  id: string;
  name: string;
  email: string;
  spend: number;
  roi: number;
  waste: number;
  sessions: number;
  toolMix: Record<string, number>;
}

interface ProjectStats {
  id: string;
  name: string;
  spend: number;
  roi: number;
  topWastePattern: string | null;
  topWasteAmount: number;
}

interface BudgetRule {
  id: string;
  type: "daily_developer" | "monthly_project" | "monthly_team";
  targetId: string | null;
  targetName: string | null;
  limitUsd: number;
  action: "block" | "warn" | "downgrade";
  currentUsage: number;
}

interface PredictionAccuracy {
  week: string;
  totalPredictions: number;
  avgPredictedCost: number;
  avgActualCost: number;
  meanAbsoluteError: number;
  accuracyPercent: number;
}

interface TeamDashboardData {
  team: {
    id: string;
    name: string;
    slackWebhookUrl: string | null;
  };
  monthlySpend: number;
  monthlyBudget: number | null;
  daysRemaining: number;
  teamRoi: number;
  totalWaste: number;
  pruneSaved: number;
  developers: DeveloperStats[];
  projects: ProjectStats[];
  budgetRules: BudgetRule[];
  predictionAccuracy?: PredictionAccuracy[];
}

// Mock data for demo
const MOCK_DATA: TeamDashboardData = {
  team: {
    id: "team-1",
    name: "Acme Engineering",
    slackWebhookUrl: null,
  },
  monthlySpend: 4200,
  monthlyBudget: 5000,
  daysRemaining: 12,
  teamRoi: 0.64,
  totalWaste: 1430,
  pruneSaved: 820,
  developers: [
    {
      id: "dev-1",
      name: "Alice K.",
      email: "alice@acme.com",
      spend: 620,
      roi: 0.82,
      waste: 112,
      sessions: 42,
      toolMix: { "claude-code": 80, cursor: 15, codex: 5 },
    },
    {
      id: "dev-2",
      name: "Bob M.",
      email: "bob@acme.com",
      spend: 840,
      roi: 0.51,
      waste: 412,
      sessions: 38,
      toolMix: { "claude-code": 60, cursor: 30, codex: 10 },
    },
    {
      id: "dev-3",
      name: "Charlie R.",
      email: "charlie@acme.com",
      spend: 580,
      roi: 0.74,
      waste: 151,
      sessions: 29,
      toolMix: { cursor: 90, "claude-code": 10 },
    },
    {
      id: "dev-4",
      name: "Diana P.",
      email: "diana@acme.com",
      spend: 420,
      roi: 0.88,
      waste: 50,
      sessions: 31,
      toolMix: { codex: 70, "claude-code": 30 },
    },
  ],
  projects: [
    {
      id: "proj-1",
      name: "auth-service",
      spend: 1200,
      roi: 0.58,
      topWastePattern: "Circular loops",
      topWasteAmount: 340,
    },
    {
      id: "proj-2",
      name: "payment-api",
      spend: 800,
      roi: 0.71,
      topWastePattern: "Compaction storms",
      topWasteAmount: 120,
    },
    {
      id: "proj-3",
      name: "frontend",
      spend: 600,
      roi: 0.84,
      topWastePattern: null,
      topWasteAmount: 0,
    },
  ],
  budgetRules: [
    {
      id: "rule-1",
      type: "daily_developer",
      targetId: null,
      targetName: null,
      limitUsd: 30,
      action: "block",
      currentUsage: 0.65,
    },
    {
      id: "rule-2",
      type: "monthly_project",
      targetId: "proj-1",
      targetName: "auth-service",
      limitUsd: 1500,
      action: "warn",
      currentUsage: 0.82,
    },
    {
      id: "rule-3",
      type: "monthly_project",
      targetId: "proj-2",
      targetName: "payment-api",
      limitUsd: 1000,
      action: "downgrade",
      currentUsage: 0.8,
    },
  ],
  predictionAccuracy: [
    {
      week: "Jan 20-26",
      totalPredictions: 245,
      avgPredictedCost: 0.42,
      avgActualCost: 0.48,
      meanAbsoluteError: 0.12,
      accuracyPercent: 75,
    },
    {
      week: "Jan 27-Feb 2",
      totalPredictions: 312,
      avgPredictedCost: 0.38,
      avgActualCost: 0.41,
      meanAbsoluteError: 0.09,
      accuracyPercent: 82,
    },
    {
      week: "Feb 3-9",
      totalPredictions: 289,
      avgPredictedCost: 0.45,
      avgActualCost: 0.47,
      meanAbsoluteError: 0.08,
      accuracyPercent: 85,
    },
  ],
};

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
            style={{ width: `${Math.min(bar.value * 100, 100)}%` }}
          />
        </div>
      )}
      {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

function ToolMixBadge({ toolMix }: { toolMix: Record<string, number> }) {
  const primary = Object.entries(toolMix).sort((a, b) => b[1] - a[1])[0];
  if (!primary) return null;

  const toolLabels: Record<string, string> = {
    "claude-code": "CC",
    cursor: "Cursor",
    codex: "Codex",
  };

  return (
    <span className="text-sm text-secondary">
      {toolLabels[primary[0]] || primary[0]} {primary[1]}%
    </span>
  );
}

function BudgetRuleRow({ rule, onEdit }: { rule: BudgetRule; onEdit: () => void }) {
  const typeLabels: Record<string, string> = {
    daily_developer: "Per-developer daily cap",
    monthly_project: rule.targetName || "Project monthly",
    monthly_team: "Team monthly",
  };

  const actionLabels: Record<string, string> = {
    block: "Block",
    warn: "Warn",
    downgrade: "Downgrade",
  };

  const usagePercent = Math.round(rule.currentUsage * 100);
  const usageColor =
    rule.currentUsage >= 0.9
      ? "text-prune-red"
      : rule.currentUsage >= 0.7
      ? "text-status-amber"
      : "text-secondary";

  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-b-0">
      <div>
        <span className="font-medium text-foreground">{typeLabels[rule.type]}:</span>
        <span className="ml-2 text-secondary">
          {formatCurrency(rule.limitUsd)}/{rule.type.includes("daily") ? "day" : "mo"}
        </span>
        <span className="ml-2 text-xs text-muted">({actionLabels[rule.action]})</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={cn("text-sm", usageColor)}>{usagePercent}% used</span>
        <button
          onClick={onEdit}
          className="text-sm text-prune-green hover:text-prune-green/80"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

export default function TeamDashboardPage() {
  const [data, setData] = useState<TeamDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [savingSlack, setSavingSlack] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // In production, fetch from /api/v1/team/{teamId}/dashboard
        const response = await fetch("/api/team/dashboard");
        if (response.ok) {
          const result = await response.json();
          setData(result);
          setSlackWebhook(result.team.slackWebhookUrl || "");
        } else {
          setData(MOCK_DATA);
          setSlackWebhook(MOCK_DATA.team.slackWebhookUrl || "");
        }
      } catch {
        setData(MOCK_DATA);
        setSlackWebhook(MOCK_DATA.team.slackWebhookUrl || "");
      }
      setLoading(false);
    };

    fetchData();
  }, []);

  const handleSaveSlack = async () => {
    if (!data) return;
    setSavingSlack(true);
    try {
      await fetch(`/api/team/${data.team.id}/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackWebhookUrl: slackWebhook }),
      });
    } catch {
      // Handle error
    }
    setSavingSlack(false);
  };

  const handleExport = (format: "pdf" | "csv") => {
    // In production, trigger download from API
    window.open(`/api/team/export?format=${format}`, "_blank");
  };

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-prune-green" />
      </div>
    );
  }

  const budgetUsed = data.monthlyBudget
    ? data.monthlySpend / data.monthlyBudget
    : 0;
  const budgetPercent = Math.round(budgetUsed * 100);
  const budgetBarColor =
    budgetUsed >= 0.9
      ? "bg-prune-red"
      : budgetUsed >= 0.7
      ? "bg-amber-500"
      : "bg-prune-green";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Dashboard</h1>
          <p className="text-secondary">Team: {data.team.name}</p>
        </div>
      </div>

      {/* Big number - Monthly spend with budget */}
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-sm font-medium text-muted">This Month&apos;s Spend</h2>
        <p className="mt-2 text-5xl font-bold text-foreground">
          {formatCurrency(data.monthlySpend)}
        </p>
        {data.monthlyBudget && (
          <>
            <p className="mt-2 text-sm text-muted">
              Budget: {formatCurrency(data.monthlyBudget)} · {budgetPercent}% used ·{" "}
              {data.daysRemaining} days remaining
            </p>
            <div className="mx-auto mt-4 h-3 w-full max-w-md overflow-hidden rounded-full bg-border">
              <div
                className={cn("h-full rounded-full transition-all", budgetBarColor)}
                style={{ width: `${Math.min(budgetPercent, 100)}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        <StatCard
          title="Team ROI"
          value={`${Math.round(data.teamRoi * 100)}%`}
          subtitle="productive"
          bar={{ value: data.teamRoi, color: getRoiBgColor(data.teamRoi) }}
        />
        <StatCard
          title="Total Waste"
          value={formatCurrency(data.totalWaste)}
          subtitle="this month"
        />
        <StatCard
          title="Prune Saved"
          value={formatCurrency(data.pruneSaved)}
          subtitle="this month"
        />
      </div>

      {/* Prediction Accuracy */}
      {data.predictionAccuracy && data.predictionAccuracy.length > 0 && (
        <div>
          <h3 className="mb-4 text-lg font-semibold text-foreground">Predicted vs Actual</h3>
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="mb-4 text-sm text-secondary">
              Comparing cost predictions to actual costs over recent weeks. Higher accuracy means better budget planning.
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Week
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Predictions
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Avg Predicted
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Avg Actual
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      MAE
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Accuracy
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.predictionAccuracy.map((week, idx) => (
                    <tr key={idx} className="hover:bg-card-hover">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">
                        {week.week}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-secondary">
                        {week.totalPredictions}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-secondary">
                        {formatCurrency(week.avgPredictedCost)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-secondary">
                        {formatCurrency(week.avgActualCost)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-secondary">
                        {formatCurrency(week.meanAbsoluteError)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span
                          className={cn(
                            "font-medium",
                            week.accuracyPercent >= 80
                              ? "text-prune-green"
                              : week.accuracyPercent >= 60
                              ? "text-status-amber"
                              : "text-prune-red"
                          )}
                        >
                          {week.accuracyPercent}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-muted">
              MAE = Mean Absolute Error (average difference between predicted and actual cost per request)
            </p>
          </div>
        </div>
      )}

      {/* By Developer table */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">By Developer</h3>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-card-hover">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Developer
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Spend
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  ROI
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Waste
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Sessions
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Tool Mix
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {data.developers.map((dev) => (
                <tr key={dev.id} className="hover:bg-card-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="font-medium text-foreground">{dev.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-foreground">
                    {formatCurrency(dev.spend)}
                  </td>
                  <td className={cn("whitespace-nowrap px-6 py-4 text-right font-medium", getRoiColor(dev.roi))}>
                    {Math.round(dev.roi * 100)}%
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-secondary">
                    {formatCurrency(dev.waste)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-secondary">
                    {dev.sessions}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <ToolMixBadge toolMix={dev.toolMix} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* By Project table */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">By Project</h3>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-card-hover">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Project
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Spend
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  ROI
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Top Waste Pattern
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {data.projects.map((project) => (
                <tr key={project.id} className="hover:bg-card-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="font-medium text-foreground">{project.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-foreground">
                    {formatCurrency(project.spend)}
                  </td>
                  <td className={cn("whitespace-nowrap px-6 py-4 text-right font-medium", getRoiColor(project.roi))}>
                    {Math.round(project.roi * 100)}%
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {project.topWastePattern ? (
                      <span className="text-status-amber">
                        {project.topWastePattern} ({formatCurrency(project.topWasteAmount)})
                      </span>
                    ) : (
                      <span className="text-prune-green">Clean</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Budget Rules */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">Budget Rules</h3>
        <div className="rounded-lg border border-border bg-card p-6">
          {data.budgetRules.length > 0 ? (
            <div className="space-y-1">
              {data.budgetRules.map((rule) => (
                <BudgetRuleRow
                  key={rule.id}
                  rule={rule}
                  onEdit={() => {
                    // Open edit modal
                    console.log("Edit rule", rule.id);
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted">No budget rules configured.</p>
          )}
          <button className="mt-4 text-sm font-medium text-prune-green hover:text-prune-green/80">
            + Add budget rule
          </button>
        </div>
      </div>

      {/* Alert Channel Configuration */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-foreground">Alert Channel</h3>
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="block text-sm font-medium text-foreground">
            Slack Webhook URL
          </label>
          <p className="mt-1 text-sm text-muted">
            Budget alerts will be sent to this Slack channel.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm focus:border-prune-green focus:outline-none focus:ring-1 focus:ring-prune-green"
            />
            <button
              onClick={handleSaveSlack}
              disabled={savingSlack}
              className="w-full rounded-md bg-prune-green px-4 py-2 text-sm font-medium text-white hover:bg-prune-green/90 disabled:opacity-50 sm:w-auto"
            >
              {savingSlack ? "Saving..." : "Configure"}
            </button>
          </div>
          <div className="mt-4 space-y-2 text-sm text-secondary">
            <p className="font-medium text-foreground">Alert rules:</p>
            <ul className="list-inside list-disc space-y-1">
              <li>Notify when any developer exceeds $20 in one session</li>
              <li>Notify when project hits 80% of monthly budget</li>
              <li>Block requests when developer hits daily cap</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Export Buttons */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          onClick={() => handleExport("pdf")}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-card-hover"
        >
          Export Monthly Report (PDF)
        </button>
        <button
          onClick={() => handleExport("csv")}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-card-hover"
        >
          Export Raw Data (CSV)
        </button>
      </div>
    </div>
  );
}
