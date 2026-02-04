import { NextRequest, NextResponse } from "next/server";

// Mock settings data
const MOCK_SETTINGS = {
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
      envVar: "ANTHROPIC_BASE_URL",
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

export async function GET() {
  // In production, this would:
  // 1. Verify auth
  // 2. Fetch user settings from database
  // 3. Fetch connected tool status
  // 4. Return settings

  return NextResponse.json(MOCK_SETTINGS);
}

export async function PATCH(request: NextRequest) {
  // In production, this would update user settings
  const body = await request.json();

  // Validate and update settings
  console.log("Updating settings:", body);

  return NextResponse.json({ success: true, ...MOCK_SETTINGS, ...body });
}
