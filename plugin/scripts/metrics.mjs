#!/usr/bin/env node
// スタジオの成績表。runs.jsonl・各案件の summary.json / review.json・calibration.csv から指標を出し、
// studio/metrics/dashboard.html を作る。「使うほど賢くなっているか」を数字で見るためのもの。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.mjs

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p, d) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return d; } };
const runs = read('studio/metrics/runs.jsonl', '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// 媒体ごとのフォルダ（jobs/<id>/<媒体>/）に分かれた案件は、媒体ごとに1行にする
const jobs = [];
for (const d of fs.existsSync(path.join(root, 'jobs')) ? fs.readdirSync(path.join(root, 'jobs')) : []) {
  const s = JSON.parse(read(`jobs/${d}/summary.json`, 'null'));
  if (!s) continue;
  if (s.parts?.length) for (const p of s.parts) jobs.push({ dir: p.path, name: `${d}/${path.basename(p.path)}`, finished: s.finished_at });
  else jobs.push({ dir: `jobs/${d}`, name: d, finished: s.finished_at });
}

const month = (ts) => ts.slice(0, 7);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const mean4 = (s) => { const v = ['design', 'originality', 'craft', 'function'].map((k) => s?.[k]).filter((x) => typeof x === 'number'); return v.length === 4 ? avg(v) : null; };

// 案件ごと
const perJob = jobs.map(({ dir, name, finished }) => {
  const summary = JSON.parse(read(`${dir}/summary.json`, '{}'));
  const review = JSON.parse(read(`${dir}/review.json`, '{"rounds":[]}'));
  const jr = runs.filter((r) => r.job === dir && r.phase === 'build');
  const first = jr.find((r) => !r.machine && r.scores && mean4(r.scores) !== null);
  const outcome = review.rounds?.length ? review.rounds[review.rounds.length - 1].outcome : null;
  return {
    job: name, medium: summary.medium, month: month(summary.finished_at || finished || new Date().toISOString()),
    result: summary.result, buildIterations: summary.build?.passed_at ?? summary.build?.iteration ?? null,
    firstScore: first ? mean4(first.scores) : null,
    firstPass: jr.length ? jr[0].verdict === 'PASS' : null,
    machineFails: jr.filter((r) => r.machine).length,
    outcome,
  };
});

// 月ごと
const months = [...new Set(perJob.map((j) => j.month))].sort();
const byMonth = months.map((m) => {
  const js = perJob.filter((j) => j.month === m);
  const reviewed = js.filter((j) => j.outcome);
  return {
    month: m, jobs: js.length,
    firstScore: avg(js.map((j) => j.firstScore).filter((x) => x !== null)),
    iterations: avg(js.map((j) => j.buildIterations).filter((x) => x !== null)),
    accepted: reviewed.length ? reviewed.filter((j) => j.outcome === 'accepted').length / reviewed.length : null,
    major: reviewed.length ? reviewed.filter((j) => j.outcome === 'major').length / reviewed.length : null,
  };
});

// 採点役のズレ
const cal = read('studio/taste/calibration.csv', '').split('\n').slice(1).filter(Boolean).map((l) => l.split(','));
const lenient = cal.filter((c) => c[3] === 'PASS' && c[5] === 'major').length;

const fmt = (x, d = 1) => (x === null || x === undefined ? '—' : typeof x === 'number' ? x.toFixed(d) : x);
const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

const latest = byMonth[byMonth.length - 1] || {};
const prev = byMonth[byMonth.length - 2] || {};
console.log(`案件 ${perJob.length} 件 ／ 直近月 ${latest.month || '—'}`);
console.log(`一発目の平均点 ${fmt(latest.firstScore)}（前月 ${fmt(prev.firstScore)}）`);
console.log(`合格までの回数 ${fmt(latest.iterations)}（前月 ${fmt(prev.iterations)}）`);
console.log(`手直しなしで通った割合 ${pct(latest.accepted)}（前月 ${pct(prev.accepted)}）`);
console.log(`critic が合格にしたのに作り直しになった件数（累計） ${lenient}`);

const rows = (arr, cols) => arr.map((r) => `<tr>${cols.map(([, f]) => `<td>${f(r)}</td>`).join('')}</tr>`).join('');
const head = (cols) => `<tr>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr>`;
const monthCols = [
  ['月', (r) => r.month], ['案件', (r) => r.jobs], ['一発目の平均点', (r) => fmt(r.firstScore)],
  ['合格までの回数', (r) => fmt(r.iterations)], ['手直しなしで通過', (r) => pct(r.accepted)], ['作り直し', (r) => pct(r.major)],
];
const jobCols = [
  ['案件', (r) => r.job], ['媒体', (r) => r.medium], ['結果', (r) => r.result], ['一発目', (r) => fmt(r.firstScore)],
  ['合格まで', (r) => fmt(r.buildIterations, 0)], ['機械チェック落ち', (r) => r.machineFails], ['人間の判定', (r) => r.outcome || '未レビュー'],
];

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tanren Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--fg:#111;--muted:#666;--line:#e5e5e5;--soft:#f5f5f5}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 "Noto Sans JP",sans-serif}
main{max-width:1100px;margin:0 auto;padding:48px 16px}
h1{font-size:28px;font-weight:500;margin:0 0 8px}h2{font-size:18px;font-weight:500;margin:48px 0 16px}
p{color:var(--muted);margin:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:32px}
.kpi{background:var(--soft);padding:24px}.kpi b{display:block;font-size:32px;font-weight:500}.kpi span{color:var(--muted);font-size:13px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:640px}
th,td{padding:24px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}th{font-weight:500;color:var(--muted)}
</style></head><body><main>
<h1>tanren Dashboard</h1>
<p>${new Date().toISOString().slice(0, 10)} 更新 ／ 案件 ${perJob.length} 件</p>
<div class="kpis">
<div class="kpi"><span>一発目の平均点（直近月）</span><b>${fmt(latest.firstScore)}</b><span>前月 ${fmt(prev.firstScore)}</span></div>
<div class="kpi"><span>合格までの回数</span><b>${fmt(latest.iterations)}</b><span>前月 ${fmt(prev.iterations)}</span></div>
<div class="kpi"><span>手直しなしで通った割合</span><b>${pct(latest.accepted)}</b><span>前月 ${pct(prev.accepted)}</span></div>
<div class="kpi"><span>critic の甘い合格（累計）</span><b>${lenient}</b><span>合格判定のあと人間が作り直させた件数</span></div>
</div>
<h2>月ごとの推移</h2><div class="wrap"><table>${head(monthCols)}${rows(byMonth, monthCols)}</table></div>
<h2>案件</h2><div class="wrap"><table>${head(jobCols)}${rows([...perJob].reverse(), jobCols)}</table></div>
</main></body></html>
`;
fs.mkdirSync(path.join(root, 'studio', 'metrics'), { recursive: true });
fs.writeFileSync(path.join(root, 'studio', 'metrics', 'dashboard.html'), html);
console.log('studio/metrics/dashboard.html を更新しました。');
