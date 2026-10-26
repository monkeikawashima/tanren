#!/usr/bin/env node
// 関門 hook（Stop）。/goal の代わりに、常に合否を判定して差し戻す。
// .loop/state.json の status が running / delivering のときだけ動く。
//
//   build     撮影 → 機械チェック（落ちたら LLM を回さず差し戻し）→ critic（別プロセス）
//   usertest  user-tester（別プロセス）がプロトタイプを操作。詰まりがあれば build に戻す
//   figma     figma-critic（セッション内サブエージェント）が書いた verdicts/figma-NN.md を読む
//   delivering PR 作成と通知をさせたあと、done にして止める
//
// 上限に達しても止めずに納品へ進め、PR に「未合格」と書かせる（人間が判断できるように）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.DESIGN_LOOP_EVALUATOR === '1') process.exit(0);

// root は案件を持つリポジトリ、plugin はエンジン（agents・scripts・採点基準）の置き場所
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const plugin = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R = (...xs) => path.join(root, ...xs);
const P = (...xs) => path.join(plugin, ...xs);
const stateFile = R('.loop', 'state.json');
try { fs.readFileSync(0, 'utf8'); } catch {}
if (!fs.existsSync(stateFile)) process.exit(0);

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
if (!['running', 'delivering'].includes(state.status)) process.exit(0);

const config = (() => { try { return JSON.parse(fs.readFileSync(R('studio', 'config.json'), 'utf8')); } catch { return {}; } })();
const job = state.job;
const J = (...xs) => R(job, ...xs);
const pass = state.pass_score ?? config.defaults?.pass_score ?? 8;
const interactive = (config.interactive_media || ['ui', 'web', 'prototype', 'renewal', 'email']).includes(state.medium);
const pad = (n) => String(n).padStart(2, '0');
const now = () => new Date().toISOString();

// ---------- helpers ----------
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
const log = (s) => fs.appendFileSync(J('progress.md'), s + '\n');

function block(reason) {
  save();
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function parseScores(text) {
  const line = (text.match(/^SCORES:\s*(.*)$/m) || [, ''])[1].trim();
  const obj = {};
  for (const [, k, v] of line.matchAll(/(\w+)=([\d.]+)/g)) obj[k] = Number(v);
  return { line, obj };
}

function record(phase, iter, verdict, scores, extra = {}) {
  fs.mkdirSync(R('studio', 'metrics'), { recursive: true });
  fs.appendFileSync(R('studio', 'metrics', 'runs.jsonl'), JSON.stringify({
    ts: now(), job, medium: state.medium, phase, iter, verdict, scores, ...extra,
  }) + '\n');
}

function commit(msg) {
  if (state.git === false || !fs.existsSync(R('.git'))) return;
  spawnSync('git', ['add', job, 'studio/metrics/runs.jsonl'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', `tanren: ${path.basename(job)} ${msg}`], { cwd: root });
}

function writeVerdict(name, text) {
  fs.mkdirSync(J('verdicts'), { recursive: true });
  fs.writeFileSync(J('verdicts', `${name}.md`), text.trim() + '\n');
}

function runAgent(agent, prompt, tools) {
  // --plugin-dir で、この hook と同じ版のプラグインを採点プロセスにも読ませる
  const args = ['-p', prompt, '--agent', `tanren:${agent}`, '--plugin-dir', plugin,
    '--allowedTools', tools, '--output-format', 'text',
    '--mcp-config', P('mcp', 'playwright.json'), '--strict-mcp-config'];
  const budget = state.critic_budget_usd ?? config.budget?.critic_usd_per_run;
  if (budget) args.push('--max-budget-usd', String(budget));
  const r = spawnSync('claude', args, {
    cwd: root, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, DESIGN_LOOP_EVALUATOR: '1' },
  });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: ((r.stderr || '') + (r.error ? String(r.error) : '')).slice(-1000) };
}

function evalError(label, err) {
  state.errors = (state.errors || 0) + 1;
  log(`\n## ${label} 採点エラー（${state.errors} 回目）\n${err}\n`);
  if (state.errors >= 3) {
    state.result = 'error';
    toDelivering(`採点が3回続けて失敗したため、ここまでの状態で納品します（${label}）。`);
  }
  block('採点プロセスが失敗しました。何も変更せずにもう一度ターンを終えてください（hook が再採点します）。');
}

function toDelivering(note) {
  state.phase = 'delivering';
  state.status = 'delivering';
  state.delivery_note = note;
  log(`\n## 納品へ（${now()}）\n${note}\n`);
  commit(`deliver: ${note.slice(0, 60)}`);
  block(`${note}\ndesign-job スキルの「4. 納品」に従って PR を作成し（未合格の工程があれば PR の表にそのまま書く）、通知してからターンを終えてください。`);
}

function nextAfterBuild() {
  if (interactive && !state.usertest?.done) {
    state.phase = 'usertest';
    block('HTML の採点に合格しました。続けてユーザーテストを行うので、何も変更せずにすぐターンを終えてください。');
  }
  return nextAfterUsertest();
}

function nextAfterUsertest() {
  if (state.figma?.enabled && !state.figma.done) {
    const f = state.figma;
    f.iteration = (f.iteration || 0) + 1;
    f.iter_started_at = Date.now();
    state.phase = 'figma';
    const vpath = path.join(job, 'verdicts', `figma-${pad(f.iteration)}.md`);
    const first = f.iteration === 1 && !fs.existsSync(J('figma', 'nodes.json'));
    block(`${first ? 'ここまでの工程に合格しました。Figma フェーズに入ります。' : ''}figma-builder サブエージェントを新しく呼び、${first ? '「Figma フェーズ初回。nodes.json はまだない」' : '「修正回。最新の verdicts/figma-*.md を上から全部直す」'}と伝えてください。終わったら figma-critic サブエージェントを呼び、判定を ${vpath} に書かせてから、2行で要約してターンを終えてください。`);
  }
  toDelivering(state.result === 'max_reached' ? '上限回数に達しました。' : '全工程に合格しました。');
}

// ---------- delivering → done ----------
if (state.phase === 'delivering') {
  state.status = 'done';
  state.finished_at = now();
  const summary = {
    job, medium: state.medium, result: state.result || 'passed', finished_at: state.finished_at,
    build: state.build, usertest: state.usertest, figma: state.figma,
  };
  fs.writeFileSync(J('summary.json'), JSON.stringify(summary, null, 2) + '\n');
  record('done', 0, summary.result, {});
  commit(`done ${summary.result}`);
  save();
  if (os.platform() === 'darwin') {
    spawnSync('osascript', ['-e', `display notification "${path.basename(job)} を納品しました" with title "tanren" sound name "Glass"`]);
  }
  process.exit(0);
}

// ---------- build ----------
if (state.phase === 'build') {
  const b = (state.build ||= { iteration: 0, max: config.defaults?.build_max ?? 10 });
  b.iteration += 1;
  const n = pad(b.iteration);
  if (b.iteration > b.max) {
    b.iteration -= 1;
    state.result = 'max_reached';
    log(`\n## build が上限 ${b.max} 回に到達\n`);
    toDelivering(`HTML の採点が上限 ${b.max} 回で合格しませんでした。最後の講評は ${job}/verdicts/ の最新です。`);
  }

  const shots = `shots/build-${n}`;
  const s = spawnSync('node', [P('scripts', 'shoot.mjs'), '--job', job, '--out', shots], { cwd: root, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  if (s.status !== 0) {
    b.iteration -= 1;
    block(`撮影に失敗しました。${job}/manifest.json と各 HTML を直してから止まってください。\n${(s.stderr || s.stdout || '').slice(-1500)}`);
  }

  const checks = JSON.parse(fs.readFileSync(J(shots, 'checks.json'), 'utf8'));
  const hard = [...checks.overflow, ...checks.contrast, ...checks.minFont, ...checks.brokenLinks, ...(checks.fonts || []), ...(checks.type || []), ...(checks.brand || [])];
  if (hard.length) {
    writeVerdict(`build-${n}`, `VERDICT: FAIL\nSCORES: machine=${hard.length}\n\n## ハードフェイル（機械チェック）\n${hard.map((x) => `- ${x}`).join('\n')}\n\n## 修正リスト（優先度順）\n${hard.map((x, i) => `${i + 1}. ${x} → 解消する`).join('\n')}`);
    record('build', b.iteration, 'FAIL', { machine: hard.length }, { machine: true });
    log(`\n## build ${n} — FAIL（機械チェック ${hard.length} 件。LLM 採点は省略）\n- スクショ: ${shots}/\n`);
    commit(`build ${n} FAIL machine=${hard.length}`);
    block(`build ${n}/${b.max}：機械チェックで ${hard.length} 件落ちました。designer サブエージェントを新しく呼び、「修正モード。${job}/verdicts/build-${n}.md を全部直す」と伝えてください。終わったら2行で要約してターンを終えてください。`);
  }

  const e = runAgent('critic',
    `案件 ${job} の build ${n} を採点してください。媒体は ${state.medium}、合格点は ${pass}。スクショは ${job}/${shots}/（機械チェックは同じフォルダの index.md）。`,
    'Read,Glob,Grep,mcp__playwright');
  const m = e.out.match(/^VERDICT:\s*(PASS|FAIL)/m);
  if (!e.ok || !m) { b.iteration -= 1; evalError(`build ${n}`, e.err || e.out.slice(0, 500)); }
  state.errors = 0;
  writeVerdict(`build-${n}`, e.out);
  const sc = parseScores(e.out);
  record('build', b.iteration, m[1], sc.obj);
  log(`\n## build ${n} — ${m[1]} — ${sc.line}\n- スクショ: ${shots}/\n- 講評: verdicts/build-${n}.md\n`);
  commit(`build ${n} ${m[1]} ${sc.line}`);

  if (m[1] === 'FAIL') {
    block(`build ${n}/${b.max} は不合格でした（${sc.line}）。designer サブエージェントを新しく呼び、「修正モード。${job}/verdicts/build-${n}.md の修正リストを上から全部直す」と伝えてください。終わったら2行で要約してターンを終えてください。`);
  }

  fs.rmSync(J('shots', 'final'), { recursive: true, force: true });
  fs.cpSync(J(shots), J('shots', 'final'), { recursive: true });
  b.passed = sc.line;
  b.passed_at = b.iteration;
  nextAfterBuild();
}

// ---------- usertest ----------
if (state.phase === 'usertest') {
  const u = (state.usertest ||= { iteration: 0, max: config.defaults?.usertest_max ?? 3 });
  u.iteration += 1;
  const n = pad(u.iteration);
  const e = runAgent('user-tester',
    `案件 ${job} のユーザーテスト ${n} 回目を行ってください。contract.md の主要タスクを、ペルソナになりきって操作してください。`,
    'Read,Glob,Grep,mcp__playwright');
  const m = e.out.match(/^VERDICT:\s*(PASS|FAIL)/m);
  if (!e.ok || !m) { u.iteration -= 1; evalError(`usertest ${n}`, e.err || e.out.slice(0, 500)); }
  state.errors = 0;
  writeVerdict(`usertest-${n}`, e.out);
  const sc = parseScores(e.out);
  record('usertest', u.iteration, m[1], sc.obj);
  log(`\n## usertest ${n} — ${m[1]} — ${sc.line}\n- 記録: verdicts/usertest-${n}.md\n`);
  commit(`usertest ${n} ${m[1]} ${sc.line}`);

  if (m[1] === 'PASS' || u.iteration >= u.max) {
    u.done = true;
    u.result = m[1] === 'PASS' ? sc.line : `上限到達（${sc.line}）`;
    if (m[1] !== 'PASS') state.result = 'max_reached';
    nextAfterUsertest();
  }
  state.phase = 'build';
  block(`ユーザーテスト ${n} で詰まりがありました（${sc.line}）。designer サブエージェントを新しく呼び、「修正モード。${job}/verdicts/usertest-${n}.md の『詰まった箇所』を全部直す」と伝えてください。終わったら2行で要約してターンを終えてください（見た目の再採点とユーザーテストをもう一度行います）。`);
}

// ---------- figma ----------
if (state.phase === 'figma') {
  const f = state.figma;
  const n = pad(f.iteration);
  const vfile = J('verdicts', `figma-${n}.md`);
  const fresh = fs.existsSync(vfile) && fs.statSync(vfile).mtimeMs >= (f.iter_started_at || 0);
  if (!fresh) {
    f.misses = (f.misses || 0) + 1;
    if (f.misses >= 3) { state.result = 'figma_unverified'; toDelivering('Figma の判定ファイルが3回続けて作られませんでした。Figma は未検品のまま納品します。'); }
    block(`${path.join(job, 'verdicts', `figma-${n}.md`)} がありません。figma-critic サブエージェントを呼び、このパスに判定を書かせてから止まってください（figma-builder の作業がまだなら先に終わらせる）。`);
  }
  f.misses = 0;
  const text = fs.readFileSync(vfile, 'utf8');
  const m = text.match(/^VERDICT:\s*(PASS|FAIL)/m);
  if (!m) block(`${vfile} の1行目が「VERDICT: PASS または FAIL」になっていません。figma-critic に形式どおり書き直させてください。`);
  const sc = parseScores(text);
  record('figma', f.iteration, m[1], sc.obj);
  log(`\n## figma ${n} — ${m[1]} — ${sc.line}\n- 講評: verdicts/figma-${n}.md\n`);
  commit(`figma ${n} ${m[1]} ${sc.line}`);

  if (m[1] === 'PASS') { f.passed = sc.line; f.done = true; toDelivering(state.result === 'max_reached' ? '上限回数に達した工程があります。' : '全工程に合格しました。'); }
  if (f.iteration >= f.max) { state.result = 'max_reached'; f.passed = `上限到達（${sc.line}）`; toDelivering(`Figma が上限 ${f.max} 回で合格しませんでした。`); }
  nextAfterUsertest(); // iteration を進めて figma-builder の修正回へ
}

process.exit(0);
