"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useToast, toast } from "@/components/toast";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

interface ConnectedTool {
  id: string;
  name: string;
  envVar: string;
  connected: boolean;
  lastSeen: string | null;
}

interface AlertPreferences {
  pruneSuggestions: boolean;
  confidenceThreshold: number;
  burnAlerts: boolean;
  burnCooldownMinutes: number;
  compactionNotices: boolean;
  greenToAmberThreshold: number;
  amberToRedThreshold: number;
}

interface AutoTrimRule {
  id: string;
  repo: string;
  description: string;
}

interface Settings {
  tools: ConnectedTool[];
  apiKey: {
    prefix: string;
    fullKey: string;
  };
  alertPreferences: AlertPreferences;
  autoTrimRules: AutoTrimRule[];
  plan: {
    tier: "free" | "pro" | "team";
    name: string;
  };
}

// Mock settings data
const MOCK_SETTINGS: Settings = {
  tools: [
    {
      id: "claude-code",
      name: "Claude Code",
      envVar: "ANTHROPIC_BASE_URL",
      connected: true,
      lastSeen: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
    },
    {
      id: "codex",
      name: "Codex CLI",
      envVar: "OPENAI_BASE_URL",
      connected: true,
      lastSeen: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
    },
    {
      id: "cursor",
      name: "Cursor",
      envVar: "Override OpenAI Base URL",
      connected: false,
      lastSeen: null,
    },
  ],
  apiKey: {
    prefix: "prune_sk_abc123xyz",
    fullKey: "prune_sk_abc123xyz789def456ghi012jkl345mno",
  },
  alertPreferences: {
    pruneSuggestions: true,
    confidenceThreshold: 75,
    burnAlerts: true,
    burnCooldownMinutes: 5,
    compactionNotices: true,
    greenToAmberThreshold: 2,
    amberToRedThreshold: 5,
  },
  autoTrimRules: [
    {
      id: "rule-1",
      repo: "my-app",
      description: "CSS questions → only include /styles/ + component file",
    },
    {
      id: "rule-2",
      repo: "api-server",
      description: "test questions → only include test file + source",
    },
  ],
  plan: {
    tier: "free",
    name: "Free",
  },
};

function Toggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-2"
      type="button"
    >
      <div
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors",
          enabled ? "bg-prune-green" : "bg-border"
        )}
      >
        <div
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform",
            enabled ? "translate-x-5" : "translate-x-0.5"
          )}
        />
      </div>
      <span className="text-sm text-foreground">{label}</span>
    </button>
  );
}

function formatRelativeTime(isoString: string): string {
  const now = new Date();
  const date = new Date(isoString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}

function SettingsSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-8 w-32" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-6">
          <Skeleton className="mb-4 h-6 w-40" />
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [showFullApiKey, setShowFullApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();
  const toastHelpers = toast(addToast);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/dashboard/settings");
        if (response.ok) {
          const data = await response.json();
          setSettings(data);
        } else {
          setSettings(MOCK_SETTINGS);
        }
      } catch {
        setSettings(MOCK_SETTINGS);
      }
      setLoading(false);
    };

    fetchSettings();
  }, []);

  const handleCopyApiKey = useCallback(async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.apiKey.fullKey);
      setApiKeyCopied(true);
      toastHelpers.success("API key copied", "The API key has been copied to your clipboard.");
      setTimeout(() => setApiKeyCopied(false), 2000);
    } catch {
      toastHelpers.error("Failed to copy", "Could not copy the API key to clipboard.");
    }
  }, [settings, toastHelpers]);

  const handleRegenerateApiKey = useCallback(async () => {
    if (!confirm("Are you sure? This will invalidate your current API key.")) return;
    toastHelpers.warning("Not available", "API key regeneration is not available in demo mode.");
  }, [toastHelpers]);

  const handleDeleteRule = useCallback((ruleId: string) => {
    if (!settings) return;
    setSettings({
      ...settings,
      autoTrimRules: settings.autoTrimRules.filter((r) => r.id !== ruleId),
    });
    toastHelpers.success("Rule deleted", "The auto-trim rule has been removed.");
  }, [settings, toastHelpers]);

  const handlePreferenceChange = useCallback(<K extends keyof AlertPreferences>(
    key: K,
    value: AlertPreferences[K]
  ) => {
    if (!settings) return;
    setSettings({
      ...settings,
      alertPreferences: {
        ...settings.alertPreferences,
        [key]: value,
      },
    });
  }, [settings]);

  const handleSavePreferences = useCallback(async () => {
    setSaving(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500));
    setSaving(false);
    toastHelpers.success("Settings saved", "Your preferences have been updated.");
  }, [toastHelpers]);

  if (loading || !settings) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <Button onClick={handleSavePreferences} loading={saving}>
          Save Changes
        </Button>
      </div>

      {/* Appearance */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Appearance</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-foreground">Theme</p>
            <p className="text-sm text-muted">Select your preferred color scheme</p>
          </div>
          <ThemeToggle />
        </div>
      </section>

      {/* Connected Tools */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Connected Tools</h2>
        <div className="space-y-4">
          {settings.tools.map((tool) => (
            <div
              key={tool.id}
              className="flex items-start justify-between border-b border-border pb-4 last:border-0 last:pb-0"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-xl">
                  {tool.connected ? "✅" : "❌"}
                </span>
                <div>
                  <p className="font-medium text-foreground">{tool.name}</p>
                  <p className="text-sm text-muted">
                    {tool.connected ? (
                      <>
                        <code className="rounded bg-card-hover px-1 py-0.5 text-xs">
                          {tool.envVar}
                        </code>{" "}
                        configured
                      </>
                    ) : (
                      "Not connected"
                    )}
                  </p>
                  {tool.connected && tool.lastSeen && (
                    <p className="text-sm text-muted">
                      Last seen: {formatRelativeTime(tool.lastSeen)}
                    </p>
                  )}
                </div>
              </div>
              {!tool.connected && (
                <button className="text-sm font-medium text-prune-green hover:underline">
                  [Setup instructions]
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* API Key */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">API Key</h2>
        <div className="flex items-center gap-4">
          <code className="flex-1 rounded bg-card-hover px-3 py-2 font-mono text-sm">
            {showFullApiKey ? settings.apiKey.fullKey : `${settings.apiKey.prefix}...`}
          </code>
          <button
            onClick={() => setShowFullApiKey(!showFullApiKey)}
            className="text-sm text-muted hover:text-foreground"
          >
            {showFullApiKey ? "Hide" : "Show"}
          </button>
          <button
            onClick={handleCopyApiKey}
            className="rounded-md bg-card-hover px-3 py-2 text-sm font-medium text-foreground hover:bg-border"
          >
            {apiKeyCopied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={handleRegenerateApiKey}
            className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100"
          >
            Regenerate
          </button>
        </div>
      </section>

      {/* Alert Preferences */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Alert Preferences</h2>
        <div className="space-y-6">
          {/* Prune suggestions */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">Prune suggestions</p>
              <p className="text-sm text-muted">
                Get suggestions for context trimming
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Toggle
                enabled={settings.alertPreferences.pruneSuggestions}
                onChange={(v) => handlePreferenceChange("pruneSuggestions", v)}
                label={settings.alertPreferences.pruneSuggestions ? "On" : "Off"}
              />
              {settings.alertPreferences.pruneSuggestions && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">Confidence:</span>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={settings.alertPreferences.confidenceThreshold}
                    onChange={(e) =>
                      handlePreferenceChange(
                        "confidenceThreshold",
                        parseInt(e.target.value, 10)
                      )
                    }
                    className="w-16 rounded border border-border px-2 py-1 text-sm"
                  />
                  <span className="text-sm text-muted">%</span>
                </div>
              )}
            </div>
          </div>

          {/* Burn alerts */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <p className="font-medium text-foreground">Burn alerts</p>
              <p className="text-sm text-muted">
                Get notified when waste patterns are detected
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Toggle
                enabled={settings.alertPreferences.burnAlerts}
                onChange={(v) => handlePreferenceChange("burnAlerts", v)}
                label={settings.alertPreferences.burnAlerts ? "On" : "Off"}
              />
              {settings.alertPreferences.burnAlerts && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted">Cooldown:</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.alertPreferences.burnCooldownMinutes}
                    onChange={(e) =>
                      handlePreferenceChange(
                        "burnCooldownMinutes",
                        parseInt(e.target.value, 10)
                      )
                    }
                    className="w-16 rounded border border-border px-2 py-1 text-sm"
                  />
                  <span className="text-sm text-muted">min</span>
                </div>
              )}
            </div>
          </div>

          {/* Compaction notices */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              <p className="font-medium text-foreground">Compaction notices</p>
              <p className="text-sm text-muted">
                Get notified when context is compacted
              </p>
            </div>
            <Toggle
              enabled={settings.alertPreferences.compactionNotices}
              onChange={(v) => handlePreferenceChange("compactionNotices", v)}
              label={settings.alertPreferences.compactionNotices ? "On" : "Off"}
            />
          </div>

          {/* Cost meter thresholds */}
          <div className="border-t border-border pt-4">
            <p className="mb-3 font-medium text-foreground">Cost meter color thresholds</p>
            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded bg-prune-green" />
                <span className="text-sm text-muted">→</span>
                <span className="inline-block h-3 w-3 rounded bg-amber-500" />
                <span className="text-sm text-muted">at $</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={settings.alertPreferences.greenToAmberThreshold}
                  onChange={(e) =>
                    handlePreferenceChange(
                      "greenToAmberThreshold",
                      parseFloat(e.target.value)
                    )
                  }
                  className="w-20 rounded border border-border px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded bg-amber-500" />
                <span className="text-sm text-muted">→</span>
                <span className="inline-block h-3 w-3 rounded bg-prune-red" />
                <span className="text-sm text-muted">at $</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={settings.alertPreferences.amberToRedThreshold}
                  onChange={(e) =>
                    handlePreferenceChange(
                      "amberToRedThreshold",
                      parseFloat(e.target.value)
                    )
                  }
                  className="w-20 rounded border border-border px-2 py-1 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Auto-Trim Rules */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Auto-Trim Rules</h2>
        {settings.autoTrimRules.length > 0 ? (
          <div className="space-y-3">
            {settings.autoTrimRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-lg bg-card-hover p-3"
              >
                <div>
                  <span className="font-medium text-foreground">{rule.repo}:</span>{" "}
                  <span className="text-secondary">{rule.description}</span>
                </div>
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="text-sm text-status-red hover:text-status-red/80"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No auto-trim rules configured</p>
        )}
        <button className="mt-4 text-sm font-medium text-prune-green hover:underline">
          [+ Add rule manually]
        </button>
      </section>

      {/* Plan */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Plan</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-foreground">
              Current: <span className="font-semibold">{settings.plan.name}</span>
            </p>
          </div>
          {settings.plan.tier === "free" && (
            <button className="rounded-lg bg-prune-green px-4 py-2 font-medium text-white hover:bg-emerald-600">
              Upgrade to Pro — $9/month
            </button>
          )}
          {settings.plan.tier === "pro" && (
            <button className="rounded-lg bg-foreground px-4 py-2 font-medium text-background hover:bg-secondary">
              Upgrade to Team — $29/seat/month
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
