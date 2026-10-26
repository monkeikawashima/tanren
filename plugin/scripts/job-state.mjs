#!/usr/bin/env node
// 修正回（design-feedback）の .loop/state.json を作り直す。
//   node job-state.mjs --revise jobs/<id> [--parts lp,banner] [--branch <name>] [--medium <medium>] [--figma on|off]
//
// 案件が媒体ごとのフォルダ（jobs/<id>/<媒体>/）に分かれていれば、--parts で直す媒体を選ぶ（省略すると全部）。
// 関門 hook は選んだ媒体を順に回し、最後に1回だけ納品する（同じ PR）。
// 前の回の結果・エラーの回数・差し戻しの回数は消し、各工程の上限は「今の回数 + 既定の上限」にする。
// .loop/ は git に入らないので、別の環境（クラウドのスレッドなど）で始まった修正回でも、
// 案件フォルダ（verdicts/・summary.json・delivery.json）から作り直せるようにしてある。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const job = opt('--revise')?.replace(/\/$/, '');
if (!job) { console.error('使い方: node job-state.mjs --revise jobs/<id> [--parts lp,banner] [--branch <name>] [--medium <medium>] [--figma on|off]'); process.exit(2); }

const root = process.cwd();
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
if (!fs.existsSync(path.join(root, job))) { console.error(`${job} がありません`); process.exit(1); }

const stateFile = path.join(root, '.loop', 'state.json');
const prevAll = readJson(stateFile);
const prev = (prevAll?.request || prevAll?.job) === job ? prevAll : {};
const summary = readJson(path.join(root, job, 'summary.json')) || {};
const config = readJson(path.join(root, 'studio', 'config.json')) || {};
const d = config.defaults || {};

// verdicts/<kind>-NN.md の最大の NN
const lastIter = (dir, kind) => {
  let max = 0;
  try {
    for (const f of fs.readdirSync(path.join(root, dir, 'verdicts'))) {
      const m = f.match(new RegExp(`^${kind}-(\\d+)\\.md$`));
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {}
  return max;
};

// 媒体のフォルダ（manifest.json を持つ直下のフォルダ）。名前は <媒体> か <媒体>-<番号>
const allParts = fs.readdirSync(path.join(root, job), { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, job, e.name, 'manifest.json')))
  .map((e) => ({
    path: `${job}/${e.name}`,
    medium: readJson(path.join(root, job, e.name, 'summary.json'))?.medium || e.name.replace(/-\d+$/, ''),
  }));
const want = opt('--parts')?.split(',').map((x) => x.trim()).filter(Boolean);
const parts = want ? allParts.filter((p) => want.includes(path.basename(p.path))) : allParts;
if (want && parts.length !== want.length) {
  console.error(`媒体のフォルダが見つかりません：${want.filter((w) => !parts.some((p) => path.basename(p.path) === w)).join(', ')}（あるもの：${allParts.map((p) => path.basename(p.path)).join(', ') || 'なし'}）`);
  process.exit(1);
}

const first = parts[0] || { path: job, medium: opt('--medium') || prev.medium || summary.medium };
if (!first.medium) { console.error('媒体が分かりません。--medium で渡してください'); process.exit(1); }

const git = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' });
const branch = opt('--branch') || (git.status === 0 ? git.stdout.trim() : '') || prev.branch;

const bi = lastIter(first.path, 'build');
const ui = lastIter(first.path, 'usertest');
const fi = lastIter(first.path, 'figma');
const figmaFlag = opt('--figma');
const partSummary = readJson(path.join(root, first.path, 'summary.json')) || {};
const figmaEnabled = figmaFlag ? figmaFlag === 'on' : (prev.figma?.enabled ?? partSummary.figma?.enabled ?? summary.figma?.enabled ?? false);

const state = {
  status: 'running',
  job: first.path,
  ...(parts.length ? { request: job, parts, current: 0 } : {}),
  medium: first.medium,
  phase: 'build',
  pass_score: prev.pass_score ?? d.pass_score ?? 8,
  ...(branch ? { branch } : {}),
  revision: (prev.revision || 0) + 1,
  build: { iteration: bi, max: bi + 5 },
  usertest: { iteration: ui, max: ui + (d.usertest_max ?? 3) },
  figma: { enabled: figmaEnabled, iteration: fi, max: fi + (d.figma_max ?? 5) },
};
if (prev.critic_budget_usd) state.critic_budget_usd = prev.critic_budget_usd;
if (prev.git === false) state.git = false;

fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
fs.rmSync(path.join(root, '.loop', 'gate-crash.json'), { force: true });
const list = parts.length ? `媒体 ${parts.map((p) => path.basename(p.path)).join(' → ')}、` : '';
console.log(`修正回 ${state.revision}：${job}（${list}最初は ${first.medium}）ブランチ ${branch || 'なし'}、build ${bi}/${state.build.max}、usertest ${ui}/${state.usertest.max}、figma ${figmaEnabled ? `${fi}/${state.figma.max}` : '使わない'}`);
