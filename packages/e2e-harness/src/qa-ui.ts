/**
 * Renders the interactive QA UI — a single self-contained HTML file (inline CSS,
 * embedded run JSON, vanilla-JS controller; no server, no framework). Shows, per
 * test/feature: what ran, real input→output (expandable), a quality/degradation
 * badge, and an efficacy meter (did it do its job 100% = all checks passed),
 * plus a repo-health panel. Filter + search + tabs are all client-side.
 */

import type { ScenarioResult } from "./types";
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

/** Embed JSON safely inside a <script> (escape the only sequence that can break out). */
function embed(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function renderUi(run: RunData): string {
  const data = embed(run);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Prune — QA / Test Explorer</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--panel2:#10151c;--line:#30363d;--fg:#e6edf3;--muted:#8b949e;
--ok:#3fb950;--warn:#d29922;--block:#f85149;--info:#8b949e;--accent:#58a6ff;--chipbg:#0d1117;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--line);background:var(--panel)}
h1{margin:0;font-size:18px}.sub{color:var(--muted);font-size:12px;margin-top:4px}
.cards{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.metric{border:1px solid var(--line);border-radius:10px;padding:10px 14px;background:var(--panel2);min-width:120px}
.metric .v{font-size:20px;font-weight:700}.metric .k{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.metric.good .v{color:var(--ok)}.metric.bad .v{color:var(--block)}
.tabs{display:flex;gap:6px;padding:12px 24px 0;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
.tab{padding:8px 14px;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;cursor:pointer;color:var(--muted);font-weight:600}
.tab.active{background:var(--bg);color:var(--fg);border-color:var(--line)}
main{padding:18px 24px;max-width:1200px;margin:0 auto}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
input,select{background:var(--chipbg);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
input.search{flex:1;min-width:220px}
.flow-h{font-size:14px;margin:18px 0 8px;border-left:3px solid var(--accent);padding-left:10px}
.flow-sub{color:var(--muted);font-size:12px;margin:0 0 8px;padding-left:13px}
.row{border:1px solid var(--line);border-radius:10px;margin-bottom:8px;background:var(--panel);overflow:hidden}
.rowhead{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer}
.rowhead:hover{background:var(--panel2)}
.glyph{font-weight:800;width:16px;text-align:center}
.glyph.ok{color:var(--ok)}.glyph.warn{color:var(--warn)}.glyph.block{color:var(--block)}.glyph.info{color:var(--info)}
.rname{font-weight:600;flex:1}
.chip{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.chip.eff100{color:var(--ok);border-color:#238636}.chip.efflow{color:var(--warn);border-color:#9e6a03}.chip.effna{color:var(--muted)}
.chip.qok{color:var(--ok);border-color:#238636}.chip.qbad{color:var(--block);border-color:#da3633}.chip.qna{color:var(--muted)}
.flowtag{color:var(--muted);font-size:11px}
.body{display:none;border-top:1px solid var(--line);padding:12px;background:var(--panel2)}
.row.open .body{display:block}
.detail{color:var(--muted);font-size:12.5px;margin:0 12px 10px;font-family:ui-monospace,Menlo,monospace}
.io{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:760px){.io{grid-template-columns:1fr}}
.io h4,.checks h4,.q h4{margin:0 0 6px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
pre{margin:0;background:#0a0e14;border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;max-height:280px;
font:11.5px/1.5 ui-monospace,Menlo,monospace;color:#cdd9e5;white-space:pre-wrap;word-break:break-word}
.checks{margin-top:12px}.check{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;padding:2px 0}
.check .m{font-weight:800}.check.pass .m{color:var(--ok)}.check.fail .m{color:var(--block)}
.q{margin-top:12px;font-size:12.5px}
.q .badge{font-weight:700}.q.ok .badge{color:var(--ok)}.q.bad .badge{color:var(--block)}.q.na .badge{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.fcard{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel)}
.fcard.lit{border-color:#238636}.fcard.dim{opacity:.5}
.tile{border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel);margin-bottom:10px;display:flex;gap:12px;align-items:center}
.tile .dot{width:12px;height:12px;border-radius:50%}.tile.ok .dot{background:var(--ok)}.tile.bad .dot{background:var(--block)}
.tile .t{font-weight:700}.tile .d{color:var(--muted);font-size:12px;font-family:ui-monospace,monospace}
.tbl{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.tbl th,.tbl td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);font-size:12.5px;vertical-align:top}
.tbl th{background:var(--panel2);color:var(--muted);font-size:11px;text-transform:uppercase}
.st.passed{color:var(--ok);font-weight:700}.st.failed{color:var(--block);font-weight:700}.st.skipped{color:var(--muted)}
.hidden{display:none}
footer{color:var(--muted);font-size:11.5px;padding:16px 24px;border-top:1px solid var(--line)}
code{background:#0a0e14;padding:1px 5px;border-radius:4px}
</style></head>
<body>
<header>
  <h1>Prune — QA / Test Explorer</h1>
  <div class="sub">One synthetic session (“fix the login bug”) driven through every product face. Every hop runs real code.</div>
  <div class="cards" id="metrics"></div>
</header>
<div class="tabs" id="tabs"></div>
<main id="main"></main>
<footer>Private dev-only harness — not shipped, not in the VSIX. Numbers come from real cores; absent data shown as <code>null</code>/insufficient_data. <span id="genat"></span></footer>

<script type="application/json" id="run">${data}</script>
<script>
const RUN = JSON.parse(document.getElementById('run').textContent);
const GLYPH = {ok:'✓',warn:'⚠',block:'⛔',info:'•'};
const $ = (s,el=document)=>el.querySelector(s);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pretty = v => { try { let s=JSON.stringify(v,null,2); if(s&&s.length>6000)s=s.slice(0,6000)+'\\n… (truncated)'; return s===undefined?'undefined':s; } catch { return String(v); } };

function efficacy(step){ const c=step.checks||[]; if(!c.length) return null; return c.filter(x=>x.passed).length/c.length; }
const allSteps = RUN.flows.flatMap(f=>f.steps.map(s=>({...s,flow:f.flow})));
const totalChecks = allSteps.reduce((n,s)=>n+((s.checks||[]).length),0);
const passedChecks = allSteps.reduce((n,s)=>n+((s.checks||[]).filter(c=>c.passed).length),0);
const degraded = allSteps.filter(s=>s.quality && s.quality.preserved===false);
const fullEff = allSteps.filter(s=>(s.checks||[]).length && (s.checks||[]).every(c=>c.passed)).length;
const withChecks = allSteps.filter(s=>(s.checks||[]).length).length;

// ---- metrics ----
function metric(k,v,cls=''){return '<div class="metric '+cls+'"><div class="v">'+v+'</div><div class="k">'+k+'</div></div>';}
const vt = RUN.vitest;
$('#metrics').innerHTML =
  (vt?metric('Tests', vt.numPassedTests+'/'+vt.numTotalTests, vt.numFailedTests===0?'good':'bad'):'') +
  metric('Checks', passedChecks+'/'+totalChecks, passedChecks===totalChecks?'good':'bad') +
  metric('Features 100%', fullEff+'/'+withChecks, fullEff===withChecks?'good':'') +
  metric('Degradations', degraded.length, degraded.length===0?'good':'bad') +
  metric('Repo health', RUN.health.allGreen?'green':'red', RUN.health.allGreen?'good':'bad');
$('#genat').textContent = 'Generated '+RUN.generatedAt;

// ---- tabs ----
const TABS = ['Explorer','Tests','Repo Health','Raw'];
let active='Explorer';
const tabsEl=$('#tabs');
function renderTabs(){ tabsEl.innerHTML = TABS.map(t=>'<div class="tab'+(t===active?' active':'')+'" data-t="'+t+'">'+t+'</div>').join(''); }
tabsEl.addEventListener('click',e=>{ const t=e.target.closest('.tab'); if(!t)return; active=t.dataset.t; renderTabs(); render(); });

// ---- explorer ----
function effChip(step){ const e=efficacy(step); if(e===null) return '<span class="chip effna">— no checks</span>';
  const cls=e===1?'eff100':'efflow'; const c=(step.checks||[]); return '<span class="chip '+cls+'">'+Math.round(e*100)+'% ('+c.filter(x=>x.passed).length+'/'+c.length+')</span>'; }
function qChip(step){ const q=step.quality; if(!q) return ''; if(q.preserved===null) return '<span class="chip qna">quality n/a</span>';
  return q.preserved?'<span class="chip qok">preserved</span>':'<span class="chip qbad">DEGRADED</span>'; }

function rowHtml(step,idx){
  const checks=(step.checks||[]).map(c=>'<div class="check '+(c.passed?'pass':'fail')+'"><span class="m">'+(c.passed?'✓':'✗')+'</span><span>'+esc(c.label)+'</span></div>').join('')||'<div class="flow-sub">no checks</div>';
  const q=step.quality?('<div class="q '+(step.quality.preserved===null?'na':step.quality.preserved?'ok':'bad')+'"><h4>Code-quality gate</h4><span class="badge">'+(step.quality.preserved===null?'N/A':step.quality.preserved?'PRESERVED':'DEGRADED')+'</span> — '+esc(step.quality.label)+(step.quality.detail?'<div class="flow-sub" style="padding-left:0;margin-top:4px">'+esc(step.quality.detail)+'</div>':'')+'</div>'):'';
  return '<div class="row" data-i="'+idx+'">'+
    '<div class="rowhead"><span class="glyph '+step.status+'">'+GLYPH[step.status]+'</span>'+
      '<span class="rname">'+esc(step.name)+'</span>'+effChip(step)+qChip(step)+'<span class="flowtag">'+esc(step.flow)+'</span></div>'+
    '<div class="body">'+
      '<div class="detail">'+esc(step.detail)+'</div>'+
      '<div class="io"><div><h4>Input</h4><pre>'+esc(pretty(step.input))+'</pre></div><div><h4>Output</h4><pre>'+esc(pretty(step.output))+'</pre></div></div>'+
      '<div class="checks"><h4>Checks (efficacy)</h4>'+checks+'</div>'+q+
    '</div></div>';
}

function renderExplorer(main){
  main.innerHTML =
    '<div class="toolbar">'+
      '<input class="search" id="q" placeholder="search test / feature / detail…"/>'+
      '<select id="fstatus"><option value="">all status</option><option>ok</option><option>warn</option><option>block</option><option>info</option></select>'+
      '<select id="fqual"><option value="">all quality</option><option value="preserved">preserved</option><option value="degraded">degraded</option><option value="na">n/a</option></select>'+
      '<select id="feff"><option value="">all efficacy</option><option value="full">100% only</option><option value="part">&lt;100%</option></select>'+
    '</div><div id="list"></div>';
  const list=$('#list',main);
  function draw(){
    const q=($('#q',main).value||'').toLowerCase();
    const fs=$('#fstatus',main).value, fq=$('#fqual',main).value, fe=$('#feff',main).value;
    let html='';
    for(const flow of RUN.flows){
      const steps=flow.steps.map(s=>({...s,flow:flow.flow})).filter(s=>{
        if(q && !(s.name+' '+s.detail+' '+s.flow).toLowerCase().includes(q)) return false;
        if(fs && s.status!==fs) return false;
        if(fq){ const p=s.quality?s.quality.preserved:undefined; if(fq==='preserved'&&p!==true)return false; if(fq==='degraded'&&p!==false)return false; if(fq==='na'&&!(s.quality&&p===null))return false; }
        if(fe){ const e=efficacy(s); if(fe==='full'&&e!==1)return false; if(fe==='part'&&!(e!==null&&e<1))return false; }
        return true;
      });
      if(!steps.length) continue;
      html+='<div class="flow-h">'+esc(flow.flow)+'</div><div class="flow-sub">'+esc(flow.summary)+'</div>';
      html+=steps.map((s)=>rowHtml(s,allSteps.indexOf(allSteps.find(x=>x.name===s.name&&x.flow===s.flow)))).join('');
    }
    list.innerHTML=html||'<div class="flow-sub">no matching steps</div>';
  }
  list.addEventListener('click',e=>{ const r=e.target.closest('.row'); if(r) r.classList.toggle('open'); });
  ['q','fstatus','fqual','feff'].forEach(id=>$('#'+id,main).addEventListener('input',draw));
  draw();
}

function renderTests(main){
  if(!RUN.vitest){ main.innerHTML='<div class="flow-sub">No vitest results captured. Run via <code>npm run ui</code>.</div>'; return; }
  let rows='';
  for(const f of RUN.vitest.testResults){
    rows+='<tr><th colspan="3">'+esc(f.name.split('/').pop())+'</th></tr>';
    for(const a of f.assertionResults){
      const msg=a.failureMessages&&a.failureMessages.length?'<div class="flow-sub" style="padding-left:0;color:var(--block)">'+esc(a.failureMessages[0].split('\\n').slice(0,3).join('\\n'))+'</div>':'';
      rows+='<tr><td class="st '+esc(a.status)+'">'+(a.status==='passed'?'✓':a.status==='failed'?'✗':'•')+' '+esc(a.status)+'</td><td>'+esc(a.title)+msg+'</td><td>'+(a.duration!=null?Math.round(a.duration)+'ms':'')+'</td></tr>';
    }
  }
  main.innerHTML='<div class="flow-sub" style="padding-left:0">vitest — '+RUN.vitest.numPassedTests+'/'+RUN.vitest.numTotalTests+' passed</div><table class="tbl"><thead><tr><th>Result</th><th>Assertion</th><th>Time</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function renderHealth(main){
  let h=RUN.health.items.map(i=>'<div class="tile '+(i.ok?'ok':'bad')+'"><span class="dot"></span><div><div class="t">'+esc(i.label)+'</div><div class="d">'+esc(i.detail)+'</div></div></div>').join('');
  // Feature-card grid from the dashboard rollup, if present.
  const dash=RUN.flows.find(f=>f.flow==='Dashboard');
  const rollup=dash&&dash.steps.find(s=>s.name==='dashboard rollup');
  if(rollup&&rollup.data&&rollup.data.features){
    h+='<div class="flow-h">Dashboard /telemetry rollup</div><div class="grid">'+rollup.data.features.map(f=>{
      const lit=f.eventCount>0; const sum=(f.summary&&(f.summary.data||f.summary))||{};
      const m=lit?Object.entries(sum).filter(([k,v])=>k!=='kind'&&v!==null&&typeof v!=='object').slice(0,3).map(([k,v])=>esc(k)+'='+esc(v)).join('<br/>'):'no telemetry yet';
      return '<div class="fcard '+(lit?'lit':'dim')+'"><div><b>'+esc(f.featureId)+'</b> <span class="flowtag">'+esc(f.featureName)+'</span></div><div class="d" style="margin-top:6px;font-family:ui-monospace,monospace;font-size:11.5px">'+(lit?'events='+f.eventCount+'<br/>'+m:m)+'</div></div>';
    }).join('')+'</div>';
  }
  main.innerHTML=h;
}

function renderRaw(main){ main.innerHTML='<pre style="max-height:none">'+esc(JSON.stringify(RUN,null,2))+'</pre>'; }

function render(){
  const main=$('#main');
  if(active==='Explorer') renderExplorer(main);
  else if(active==='Tests') renderTests(main);
  else if(active==='Repo Health') renderHealth(main);
  else renderRaw(main);
}
renderTabs(); render();
</script>
</body></html>`;
}
