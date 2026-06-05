/**
 * Renders the QA UI as a SINGLE self-contained HTML file whose content is fully
 * server-side rendered — every test, its input/output, the code-quality gate, and
 * the efficacy meter are real DOM, visible even if the viewer never runs
 * JavaScript (native <details> drives expand/collapse). A small progressive-
 * enhancement script adds live filter/search on top; nothing depends on it.
 */

import type { ScenarioResult, Step } from "./types";
import type { RepoHealth } from "./repo-health";

export interface VitestAssertion { title: string; status: string; duration?: number; failureMessages?: string[]; }
export interface VitestFile { name: string; status: string; assertionResults: VitestAssertion[]; }
export interface VitestSummary { numTotalTests: number; numPassedTests: number; numFailedTests: number; testResults: VitestFile[]; }

export interface RunData {
  generatedAt: string;
  flows: ScenarioResult[];
  vitest: VitestSummary | null;
  health: RepoHealth;
}

const GLYPH: Record<string, string> = { ok: "✓", warn: "⚠", block: "⛔", info: "•" };

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function pretty(v: unknown): string {
  if (v === undefined) return "—";
  let s: string;
  try { s = JSON.stringify(v, null, 2); } catch { s = String(v); }
  if (s === undefined) return "—";
  return s.length > 4000 ? s.slice(0, 4000) + "\n… (truncated)" : s;
}
function effOf(s: Step): number | null {
  const c = s.checks ?? [];
  if (!c.length) return null;
  return c.filter((x) => x.passed).length / c.length;
}

export function renderUi(run: RunData): string {
  const steps = run.flows.flatMap((f) => f.steps.map((s) => ({ s, flow: f.flow })));
  const totalChecks = steps.reduce((n, { s }) => n + (s.checks?.length ?? 0), 0);
  const passedChecks = steps.reduce((n, { s }) => n + (s.checks?.filter((c) => c.passed).length ?? 0), 0);
  const withChecks = steps.filter(({ s }) => (s.checks?.length ?? 0) > 0).length;
  const full = steps.filter(({ s }) => (s.checks?.length ?? 0) > 0 && s.checks!.every((c) => c.passed)).length;
  const degraded = steps.filter(({ s }) => s.quality?.preserved === false);
  const vt = run.vitest;

  const metric = (k: string, v: string, cls = "") =>
    `<div class="metric ${cls}"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`;

  const metrics =
    (vt ? metric("Tests", `${vt.numPassedTests}/${vt.numTotalTests}`, vt.numFailedTests === 0 ? "good" : "bad") : "") +
    metric("Checks passed", `${passedChecks}/${totalChecks}`, passedChecks === totalChecks ? "good" : "bad") +
    metric("Features @100%", `${full}/${withChecks}`, full === withChecks ? "good" : "") +
    metric("Degradations", `${degraded.length}`, degraded.length === 0 ? "good" : "bad") +
    metric("Repo health", run.health.allGreen ? "GREEN" : "RED", run.health.allGreen ? "good" : "bad");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Prune — QA / Test Explorer</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--panel2:#10151c;--line:#30363d;--fg:#e6edf3;--muted:#8b949e;
--ok:#3fb950;--warn:#d29922;--block:#f85149;--info:#8b949e;--accent:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--accent)}
header{padding:20px 22px;border-bottom:1px solid var(--line);background:var(--panel)}
h1{margin:0;font-size:18px}.sub{color:var(--muted);font-size:12px;margin-top:4px}
.cards{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.metric{border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:var(--panel2);min-width:120px}
.metric .v{font-size:20px;font-weight:700}.metric .k{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.metric.good .v{color:var(--ok)}.metric.bad .v{color:var(--block)}
nav{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:10px 22px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
nav a{font-weight:600;text-decoration:none;color:var(--muted)} nav a:hover{color:var(--fg)}
nav input{margin-left:auto;background:#0d1117;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;min-width:200px}
main{padding:18px 22px;max-width:1180px;margin:0 auto}
section{margin-bottom:26px}
h2{font-size:15px;margin:0 0 4px;border-left:3px solid var(--accent);padding-left:10px}
.flow-sub{color:var(--muted);font-size:12px;margin:0 0 10px;padding-left:13px}
details.row{border:1px solid var(--line);border-radius:10px;margin-bottom:8px;background:var(--panel);overflow:hidden}
details.row[open]{border-color:#3a4351}
summary{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
.glyph{font-weight:800;width:16px;text-align:center}
.glyph.ok{color:var(--ok)}.glyph.warn{color:var(--warn)}.glyph.block{color:var(--block)}.glyph.info{color:var(--info)}
.rname{font-weight:600;flex:1}
.chip{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.chip.eff100{color:var(--ok);border-color:#238636}.chip.efflow{color:var(--warn);border-color:#9e6a03}.chip.effna{color:var(--muted)}
.chip.qok{color:var(--ok);border-color:#238636}.chip.qbad{color:var(--block);border-color:#da3633}.chip.qna{color:var(--muted)}
.flowtag{color:var(--muted);font-size:11px}
.bodywrap{border-top:1px solid var(--line);padding:12px;background:var(--panel2)}
.detail{color:var(--muted);font-size:12.5px;margin:0 0 10px;font-family:ui-monospace,Menlo,monospace}
.io{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:760px){.io{grid-template-columns:1fr}}
h4{margin:0 0 6px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
pre{margin:0;background:#0a0e14;border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;max-height:300px;
font:11.5px/1.5 ui-monospace,Menlo,monospace;color:#cdd9e5;white-space:pre-wrap;word-break:break-word}
.checks{margin-top:12px}.check{display:flex;gap:8px;font-size:12.5px;padding:2px 0}
.check .m{font-weight:800}.check.pass .m{color:var(--ok)}.check.fail .m{color:var(--block)}
.q{margin-top:12px;font-size:12.5px}.q .badge{font-weight:800}
.q.ok .badge{color:var(--ok)}.q.bad .badge{color:var(--block)}.q.na .badge{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.fcard{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel)}
.fcard.lit{border-color:#238636}.fcard.dim{opacity:.5}
.tile{border:1px solid var(--line);border-radius:10px;padding:13px;background:var(--panel);margin-bottom:10px;display:flex;gap:12px;align-items:center}
.tile .dot{width:12px;height:12px;border-radius:50%;flex:none}.tile.ok .dot{background:var(--ok)}.tile.bad .dot{background:var(--block)}
.tile .t{font-weight:700}.tile .d{color:var(--muted);font-size:12px;font-family:ui-monospace,monospace}
table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);font-size:12.5px;vertical-align:top}
th{background:var(--panel2);color:var(--muted);font-size:11px;text-transform:uppercase}
.st.passed{color:var(--ok);font-weight:700}.st.failed{color:var(--block);font-weight:700}.st.skipped{color:var(--muted)}
.banner{padding:10px 14px;border-radius:10px;margin-bottom:14px;font-weight:600;border:1px solid}
.banner.ok{border-color:#238636;color:var(--ok);background:rgba(35,134,54,.08)}
.banner.bad{border-color:#da3633;color:var(--block);background:rgba(218,54,51,.08)}
footer{color:var(--muted);font-size:11.5px;padding:16px 22px;border-top:1px solid var(--line)}
code{background:#0a0e14;padding:1px 5px;border-radius:4px}
.nomatch{color:var(--muted);font-size:12px}
</style></head>
<body>
<header>
  <h1>Prune — QA / Test Explorer</h1>
  <div class="sub">One synthetic session (“fix the login bug”) driven through every product face — every hop runs real code. Generated ${esc(run.generatedAt)}.</div>
  <div class="cards">${metrics}</div>
</header>
<nav>
  <a href="#explorer">Explorer</a><a href="#tests">Tests</a><a href="#health">Repo health</a>
  <input id="q" type="search" placeholder="filter tests / features / detail…" oninput="window.__pruneFilter&&window.__pruneFilter(this.value)"/>
</nav>
<main>
  <div class="banner ${degraded.length === 0 ? "ok" : "bad"}">${degraded.length === 0
    ? "✓ No code-quality degradation detected — every transform preserved correctness (feature gates + independent @prune/equivalence proofs)."
    : `⛔ ${degraded.length} degradation(s) detected: ${esc(degraded.map((d) => d.s.name).join(", "))}`}</div>

  <section id="explorer">
    ${run.flows.map(renderFlow).join("\n")}
  </section>

  ${renderTests(run.vitest)}
  ${renderHealth(run)}
</main>
<footer>Private dev-only harness — not shipped, not in the VSIX. Numbers come from real cores; absent data is shown as <code>null</code>/insufficient_data. Content is fully rendered server-side (works without JavaScript); the filter box is an optional enhancement.</footer>

<script>
// Progressive enhancement only — the page is fully usable without this.
window.__pruneFilter = function(q){
  q = (q||"").toLowerCase();
  document.querySelectorAll("details.row").forEach(function(d){
    var hay = (d.getAttribute("data-search")||"").toLowerCase();
    d.style.display = (!q || hay.indexOf(q) !== -1) ? "" : "none";
  });
  document.querySelectorAll("section[data-flow]").forEach(function(sec){
    var any = Array.prototype.some.call(sec.querySelectorAll("details.row"), function(d){ return d.style.display !== "none"; });
    var nm = sec.querySelector(".nomatch"); if(nm) nm.style.display = any ? "none" : "";
  });
};
</script>
</body></html>`;
}

function effChip(s: Step): string {
  const e = effOf(s);
  if (e === null) return `<span class="chip effna">no checks</span>`;
  const c = s.checks!;
  const cls = e === 1 ? "eff100" : "efflow";
  return `<span class="chip ${cls}">${Math.round(e * 100)}% (${c.filter((x) => x.passed).length}/${c.length})</span>`;
}
function qChip(s: Step): string {
  const q = s.quality;
  if (!q) return "";
  if (q.preserved === null) return `<span class="chip qna">quality n/a</span>`;
  return q.preserved ? `<span class="chip qok">preserved</span>` : `<span class="chip qbad">DEGRADED</span>`;
}

function renderStep(s: Step, flow: string): string {
  const e = effOf(s);
  const search = esc(`${s.name} ${s.detail} ${flow}`);
  const checks =
    (s.checks ?? [])
      .map((c) => `<div class="check ${c.passed ? "pass" : "fail"}"><span class="m">${c.passed ? "✓" : "✗"}</span><span>${esc(c.label)}</span></div>`)
      .join("") || `<div class="flow-sub" style="padding-left:0">no checks</div>`;
  const q = s.quality
    ? `<div class="q ${s.quality.preserved === null ? "na" : s.quality.preserved ? "ok" : "bad"}"><h4>Code-quality gate</h4><span class="badge">${
        s.quality.preserved === null ? "N/A" : s.quality.preserved ? "PRESERVED" : "DEGRADED"
      }</span> — ${esc(s.quality.label)}${s.quality.detail ? `<div class="flow-sub" style="padding-left:0;margin-top:4px">${esc(s.quality.detail)}</div>` : ""}</div>`
    : "";
  return `<details class="row" data-search="${search}" data-status="${s.status}" data-eff="${e === null ? "na" : e === 1 ? "full" : "part"}">
  <summary><span class="glyph ${s.status}">${GLYPH[s.status] ?? "•"}</span><span class="rname">${esc(s.name)}</span>${effChip(s)}${qChip(s)}<span class="flowtag">${esc(flow)}</span></summary>
  <div class="bodywrap">
    <div class="detail">${esc(s.detail)}</div>
    <div class="io"><div><h4>Input</h4><pre>${esc(pretty(s.input))}</pre></div><div><h4>Output</h4><pre>${esc(pretty(s.output))}</pre></div></div>
    <div class="checks"><h4>Checks — did it do its job 100%?</h4>${checks}</div>
    ${q}
  </div></details>`;
}

function renderFlow(f: ScenarioResult): string {
  return `<div data-flow="${esc(f.flow)}" class="flowblock"><h2>Flow: ${esc(f.flow)}</h2><p class="flow-sub">${esc(f.summary)}</p>${f.steps
    .map((s) => renderStep(s, f.flow))
    .join("")}<div class="nomatch" style="display:none">no matching steps in this flow</div></div>`;
}

function renderTests(vt: VitestSummary | null): string {
  if (!vt) return `<section id="tests"><h2>Test suites</h2><p class="flow-sub">no vitest results captured — run via <code>npm run ui</code></p></section>`;
  const rows = vt.testResults
    .map((f) => {
      const inner = f.assertionResults
        .map((a) => {
          const msg = a.failureMessages?.length ? `<div class="flow-sub" style="padding-left:0;color:var(--block)">${esc(a.failureMessages[0].split("\n").slice(0, 3).join("\n"))}</div>` : "";
          return `<tr><td class="st ${esc(a.status)}">${a.status === "passed" ? "✓" : a.status === "failed" ? "✗" : "•"} ${esc(a.status)}</td><td>${esc(a.title)}${msg}</td><td>${a.duration != null ? Math.round(a.duration) + "ms" : ""}</td></tr>`;
        })
        .join("");
      return `<tr><th colspan="3">${esc(f.name.split("/").pop())}</th></tr>${inner}`;
    })
    .join("");
  return `<section id="tests"><h2>Test suites</h2><p class="flow-sub">vitest — ${vt.numPassedTests}/${vt.numTotalTests} passed, ${vt.numFailedTests} failed</p><table><thead><tr><th>Result</th><th>Assertion</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderHealth(run: RunData): string {
  const tiles = run.health.items
    .map((i) => `<div class="tile ${i.ok ? "ok" : "bad"}"><span class="dot"></span><div><div class="t">${esc(i.label)}</div><div class="d">${esc(i.detail)}</div></div></div>`)
    .join("");
  const dash = run.flows.find((f) => f.flow === "Dashboard");
  const rollup = dash?.steps.find((s) => s.name === "dashboard rollup");
  let grid = "";
  if (rollup?.data?.features) {
    const feats = rollup.data.features as Array<{ featureId: string; featureName: string; eventCount: number; seeded: boolean; summary: Record<string, unknown> }>;
    grid =
      `<h2 style="margin-top:18px">Dashboard /telemetry rollup</h2><div class="grid">` +
      feats
        .map((f) => {
          const lit = f.eventCount > 0;
          const sum = (f.summary?.data ?? f.summary ?? {}) as Record<string, unknown>;
          const m = lit
            ? Object.entries(sum)
                .filter(([k, v]) => k !== "kind" && v !== null && typeof v !== "object")
                .slice(0, 3)
                .map(([k, v]) => `${esc(k)}=${esc(v)}`)
                .join("<br/>")
            : "no telemetry yet";
          return `<div class="fcard ${lit ? "lit" : "dim"}"><div><b>${esc(f.featureId)}</b> <span class="flowtag">${esc(f.featureName)}</span></div><div class="d" style="margin-top:6px;font-family:ui-monospace,monospace;font-size:11.5px">${lit ? `events=${f.eventCount}<br/>${m}` : m}</div></div>`;
        })
        .join("") +
      `</div>`;
  }
  return `<section id="health"><h2>Repo health</h2><p class="flow-sub">captured live — exit 0 = no regression</p>${tiles}${grid}</section>`;
}
