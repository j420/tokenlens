/**
 * Renders a self-contained HTML report (inline CSS, no external assets) that
 * combines (1) the vitest pass/fail results and (2) the narrated scenario
 * walkthrough with real outputs + the dashboard feature-card grid. Pure string
 * building — open the file in any browser.
 */

import type { ScenarioResult, StepStatus } from "./types";

export interface VitestAssertion {
  title: string;
  status: string; // "passed" | "failed" | "skipped"
  duration?: number;
  failureMessages?: string[];
}
export interface VitestFile {
  name: string;
  status: string;
  assertionResults: VitestAssertion[];
}
export interface VitestSummary {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: VitestFile[];
}

const STATUS_COLOR: Record<StepStatus, string> = {
  ok: "#1a7f37",
  warn: "#9a6700",
  block: "#cf222e",
  info: "#57606a",
};
const STATUS_GLYPH: Record<StepStatus, string> = {
  ok: "✓",
  warn: "⚠",
  block: "⛔",
  info: "•",
};

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shortName(path: string): string {
  const m = path.split("/");
  return m[m.length - 1] || path;
}

export function renderHtml(results: ScenarioResult[], vitest: VitestSummary | null): string {
  const totalSteps = results.reduce((n, r) => n + r.steps.length, 0);
  const blocks = results.flatMap((r) => r.steps).filter((s) => s.status === "block").length;
  const generatedAt = new Date().toISOString();

  const testsBadge = vitest
    ? `${vitest.numPassedTests}/${vitest.numTotalTests} passed`
    : "not captured";
  const testsOk = vitest ? vitest.numFailedTests === 0 : false;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Prune — E2E Harness Report</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --line:#30363d; --fg:#e6edf3; --muted:#8b949e;
          --ok:#3fb950; --warn:#d29922; --block:#f85149; --info:#8b949e; --accent:#58a6ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  header { padding:24px 28px; border-bottom:1px solid var(--line); background:var(--panel); }
  h1 { margin:0 0 6px; font-size:20px; }
  .sub { color:var(--muted); font-size:13px; }
  .badges { margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; }
  .badge { padding:6px 12px; border-radius:999px; border:1px solid var(--line);
           background:#0d1117; font-size:12px; font-weight:600; }
  .badge.pass { color:var(--ok); border-color:#238636; }
  .badge.fail { color:var(--block); border-color:#da3633; }
  .badge.neutral { color:var(--accent); }
  main { padding:24px 28px; max-width:1100px; margin:0 auto; }
  section { margin-bottom:28px; }
  h2 { font-size:16px; margin:0 0 4px; border-left:3px solid var(--accent); padding-left:10px; }
  .flowsub { color:var(--muted); font-size:12px; margin:0 0 12px; padding-left:13px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line);
          border-radius:8px; overflow:hidden; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:#0d1117; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  tr:last-child td { border-bottom:none; }
  .st { font-weight:700; white-space:nowrap; }
  .st.passed,.st.ok { color:var(--ok); }
  .st.failed,.st.block { color:var(--block); }
  .st.warn { color:var(--warn); }
  .st.info,.st.skipped { color:var(--info); }
  .detail { color:var(--fg); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
  .fail-msg { color:var(--block); font-family:ui-monospace,monospace; font-size:11.5px; white-space:pre-wrap;
              margin-top:4px; opacity:.9; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:10px; }
  .card { border:1px solid var(--line); border-radius:8px; padding:10px 12px; background:var(--panel); }
  .card.lit { border-color:#238636; }
  .card .fid { font-weight:700; }
  .card .fname { color:var(--muted); font-size:11px; }
  .card .metric { margin-top:6px; font-family:ui-monospace,monospace; font-size:11.5px; }
  .card.dim { opacity:.5; }
  footer { color:var(--muted); font-size:12px; padding:18px 28px; border-top:1px solid var(--line); }
  code { background:#0d1117; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<header>
  <h1>Prune — End-to-End Harness Report</h1>
  <div class="sub">One synthetic session (“fix the login bug”) driven through every product face. Generated ${esc(generatedAt)}.</div>
  <div class="badges">
    <span class="badge ${testsOk ? "pass" : "fail"}">Tests: ${esc(testsBadge)}</span>
    <span class="badge neutral">${results.length} flows</span>
    <span class="badge neutral">${totalSteps} steps</span>
    <span class="badge neutral">${blocks} security block(s)</span>
  </div>
</header>
<main>
  ${vitest ? renderTests(vitest) : ""}
  ${results.map(renderFlow).join("\n")}
</main>
<footer>
  Private dev-only harness (<code>@prune/e2e-harness</code>) — not shipped, not in the VSIX.
  Every hop runs real product code; numbers come from real cores (absent data shown as null / “insufficient_data”).
</footer>
</body>
</html>`;
}

function renderTests(v: VitestSummary): string {
  const rows = v.testResults
    .map((f) => {
      const inner = f.assertionResults
        .map(
          (a) =>
            `<tr><td class="st ${esc(a.status)}">${a.status === "passed" ? "✓" : a.status === "failed" ? "✗" : "•"} ${esc(a.status)}</td>` +
            `<td class="detail">${esc(a.title)}${a.failureMessages && a.failureMessages.length ? `<div class="fail-msg">${esc(a.failureMessages[0].split("\n").slice(0, 4).join("\n"))}</div>` : ""}</td>` +
            `<td class="detail">${a.duration != null ? esc(Math.round(a.duration)) + "ms" : ""}</td></tr>`
        )
        .join("");
      return `<tr><th colspan="3">${esc(shortName(f.name))}</th></tr>${inner}`;
    })
    .join("");
  return `<section>
    <h2>Test suites</h2>
    <p class="flowsub">vitest run — ${v.numPassedTests}/${v.numTotalTests} passed, ${v.numFailedTests} failed</p>
    <table><thead><tr><th>Result</th><th>Assertion</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

function renderFlow(r: ScenarioResult): string {
  const stepRows = r.steps
    .map(
      (s) =>
        `<tr><td class="st ${s.status}" style="color:${STATUS_COLOR[s.status]}">${STATUS_GLYPH[s.status]} ${esc(s.status)}</td>` +
        `<td><strong>${esc(s.name)}</strong></td>` +
        `<td class="detail">${esc(s.detail)}</td></tr>`
    )
    .join("");

  const rollup = r.steps.find((s) => s.name === "dashboard rollup");
  let grid = "";
  if (rollup?.data?.features) {
    const feats = rollup.data.features as Array<{
      featureId: string;
      featureName: string;
      eventCount: number;
      seeded: boolean;
      summary: Record<string, unknown>;
    }>;
    grid =
      `<div style="margin-top:14px"><div class="flowsub">dashboard /telemetry rollup (13 feature cards)</div><div class="grid">` +
      feats
        .map((f) => {
          const lit = f.eventCount > 0;
          const summary = (f.summary?.data ?? f.summary ?? {}) as Record<string, unknown>;
          const metric = lit
            ? Object.entries(summary)
                .filter(([k, val]) => k !== "kind" && val !== null && typeof val !== "object")
                .slice(0, 3)
                .map(([k, val]) => `${esc(k)}=${esc(val)}`)
                .join("<br/>")
            : "no telemetry yet";
          return `<div class="card ${lit ? "lit" : "dim"}">
            <div class="fid">${esc(f.featureId)} <span class="fname">${esc(f.featureName)}</span></div>
            <div class="metric">${lit ? `events=${f.eventCount}<br/>${metric}` : metric}</div>
          </div>`;
        })
        .join("") +
      `</div></div>`;
  }

  return `<section>
    <h2>Flow: ${esc(r.flow)}</h2>
    <p class="flowsub">${esc(r.summary)}</p>
    <table><tbody>${stepRows}</tbody></table>
    ${grid}
  </section>`;
}
