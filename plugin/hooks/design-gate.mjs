#!/usr/bin/env node
// 関門 hook（Stop）。/goal の代わりに、常に合否を判定して差し戻す。
// .loop/state.json の status が running / delivering のときだけ動く。
//
//   build     撮影 → 機械チェック（落ちたら LLM を回さず差し戻し）→ critic（別プロセス）
//   usertest  user-tester（別プロセス）がプロトタイプを操作。詰まりがあれば build に戻す
//   figma     figma-critic（セッション内サブエージェント）が書いた verdicts/figma-NN.md を読む
//   delivering PR 作成と通知をさせたあと、PR があるかを確かめてから done にして止める
//
// 媒体が複数ある依頼（state.parts）は、媒体のフォルダ jobs/<id>/<媒体>/ ごとに build〜figma を順に回し、
// 全部の媒体が終わってから1回だけ納品する（1件の依頼 = 1ブランチ = 1 PR）。state.job は今の媒体のフォルダ。
// 上限に達しても止めずに納品へ進め、PR に「未合格」と書かせる（人間が判断できるように）。
// 差し戻しはどれも回数を数え、終わらなくなる経路を作らない。hook 自体が落ちたときも数えて、続けば納品か停止に回す。

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
const crashFile = R('.loop', 'gate-crash.json');
try { fs.readFileSync(0, 'utf8'); } catch {}
if (!fs.existsSync(stateFile)) process.exit(0);

const pad = (n) => String(n).padStart(2, '0');
const now = () => new Date().toISOString();
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const RESULT_LABEL = {
  passed: '全工程に合格',
  max_reached: '上限回数に達した工程あり（未合格）',
  error: '採点エラーで打ち切り（未合格）',
  shoot_failed: '撮影できずに打ち切り（未合格）',
  figma_unverified: 'Figma は未検品',
};

let state, config, job, request, J, pass, interactive;

// ---------- helpers ----------
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
const log = (s) => fs.appendFileSync(J('progress.md'), s + '\n');
const label = () => RESULT_LABEL[state.result || 'passed'] || state.result;

function block(reason) {
  save();
  fs.rmSync(crashFile, { force: true });
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function notify(msg) {
  if (os.platform() !== 'darwin') return;
  spawnSync('osascript', ['-e', `display notification "${msg.replace(/["\\]/g, '')}" with title "tanren" sound name "Glass"`]);
}

function gitOut(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
const useGit = () => state.git !== false && fs.existsSync(R('.git'));

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

// 案件フォルダと採点ログだけを commit する（利用者が stage している別の変更を巻き込まない）
function commit(msg) {
  if (!useGit()) return;
  const paths = [request, 'studio/metrics/runs.jsonl'].filter((p) => fs.existsSync(R(p)));
  const name = path.basename(request) + (job !== request ? `/${path.basename(job)}` : '');
  spawnSync('git', ['add', ...paths], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', `tanren: ${name} ${msg}`, '--', ...paths], { cwd: root });
}

function writeVerdict(name, text) {
  fs.mkdirSync(J('verdicts'), { recursive: true });
  fs.writeFileSync(J('verdicts', `${name}.md`), text.trim() + '\n');
}

// summary.json は納品に入る時点で書く（PR に載せるため）。done のときに PR の URL を足す
function writeSummary(extra = {}) {
  const prev = readJson(J('summary.json')) || {};
  const summary = {
    ...prev, job, medium: state.medium, result: state.result || 'passed',
    build: state.build, usertest: state.usertest, figma: state.figma, ...extra,
  };
  fs.writeFileSync(J('summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

// 依頼全体の summary.json（jobs/<id>/summary.json）。媒体が1つだけの昔の形では、媒体の summary.json と同じもの
function writeRequestSummary(extra = {}) {
  if (!state.parts) return writeSummary(extra);
  const f = R(request, 'summary.json');
  const prev = readJson(f) || {};
  // 修正回で一部の媒体だけ回したときは、回さなかった媒体の結果を残す
  const parts = [...(prev.parts || [])];
  for (const r of (state.part_results || []).filter(Boolean)) {
    const i = parts.findIndex((x) => x.path === r.path);
    if (i >= 0) parts[i] = r; else parts.push(r);
  }
  const summary = {
    ...prev, job: request, media: parts.map((p) => p.medium),
    result: parts.map((r) => r.result).find((r) => r !== 'passed') || 'passed', parts, ...extra,
  };
  fs.writeFileSync(f, JSON.stringify(summary, null, 2) + '\n');
  return summary;
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

function evalError(lbl, err) {
  state.errors = (state.errors || 0) + 1;
  log(`\n## ${lbl} 採点エラー（${state.errors} 回目）\n${err}\n`);
  if (state.errors >= 3) {
    state.result = 'error';
    endPart(`採点が3回続けて失敗したため、ここまでの状態で打ち切ります（${lbl}）。`);
  }
  block('採点プロセスが失敗しました。何も変更せずにもう一度ターンを終えてください（hook が再採点します）。');
}

// 既にある PR（修正回）。delivery.json は designer ではなくメインの会話が書く
function knownPr() {
  const rec = readJson(R(request, 'delivery.json')) || {};
  const url = rec.pr || readJson(R(request, 'summary.json'))?.pr;
  return typeof url === 'string' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url) ? url : null;
}

// verdicts/<kind>-NN.md の最大の NN（修正回で番号を続けるため）
function lastIter(dir, kind) {
  let max = 0;
  try {
    for (const f of fs.readdirSync(R(dir, 'verdicts'))) {
      const m = f.match(new RegExp(`^${kind}-(\\d+)\\.md$`));
      if (m) max = Math.max(max, Number(m[1]));
    }
  } catch {}
  return max;
}

// 次の媒体に移る。前の媒体の結果とカウンタは持ち越さない
function startPart(p) {
  const d = config.defaults || {};
  const bi = lastIter(p.path, 'build'), ui = lastIter(p.path, 'usertest'), fi = lastIter(p.path, 'figma');
  state.job = job = p.path;
  state.medium = p.medium;
  state.phase = 'build';
  state.build = { iteration: bi, max: bi + (bi ? 5 : d.build_max ?? 10) };
  state.usertest = { iteration: ui, max: ui + (d.usertest_max ?? 3) };
  state.figma = { enabled: !!state.figma?.enabled, iteration: fi, max: fi + (d.figma_max ?? 5) };
  for (const k of ['result', 'errors', 'shoot_failures', 'delivery_note']) delete state[k];
}

// この媒体の工程を終える（合格・上限・打ち切りのどれでも）。次の媒体があればそちらへ、なければ納品へ
function endPart(note) {
  if (!state.parts) return deliver(note);
  const i = state.current ?? 0;
  (state.part_results ||= [])[i] = { path: job, medium: state.medium, result: state.result || 'passed', note };
  log(`\n## この媒体の工程を終了（${now()}）\n${note}\n`);
  writeSummary({ note });
  const next = state.parts[i + 1];
  if (!next) return deliver(note);
  commit(`${state.medium} 終了: ${label()}`);
  const finished = `${state.medium}（${job}）の工程が終わりました（${label()}）。${note}`;
  state.current = i + 1;
  startPart(next);
  block(`${finished}\n次は ${next.medium}（${next.path}）を採点します。${next.path}/work/ がまだ空なら、designer サブエージェントを新しく呼んで design-job の「3. 磨き」の 2 のとおり展開させ、終わったら2行で要約してターンを終えてください。展開済みなら、何も変更せずにターンを終えてください。`);
}

function deliver(note) {
  if (state.parts) {
    const rs = (state.part_results || []).filter(Boolean);
    state.result = rs.map((r) => r.result).find((r) => r !== 'passed') || 'passed';
    note = rs.map((r) => `${r.medium}：${RESULT_LABEL[r.result] || r.result}`).join(' ／ ');
  }
  state.phase = 'delivering';
  state.status = 'delivering';
  state.delivery_note = note;
  state.pr_checks = 0;
  log(`\n## 納品へ（${now()}）\n${note}\n`);
  writeRequestSummary();
  commit(`deliver: ${note.slice(0, 60)}`);
  const existing = knownPr();
  const how = existing
    ? `新しい PR は作らず、ブランチを push して既存の PR（${existing}）を更新し、PR にコメントで今回の結果を返し`
    : `ブランチを push して PR を${state.parts ? '1つ' : ''}作成し`;
  const unpassed = state.result && state.result !== 'passed'
    ? `結果は「${label()}」です。PR の冒頭の注意書きと結果の表に、そのまま書いてください。` : '';
  block(`${note}\ndesign-job スキルの「4. 納品」に従って、${how}、PR の URL を ${request}/delivery.json の "pr" に書いて、通知してからターンを終えてください。${unpassed}次に止まったとき、hook が PR があるかを確かめます。`);
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
    f.max ??= config.defaults?.figma_max ?? 5;
    f.iteration = (f.iteration || 0) + 1;
    f.iter_started_at = Date.now();
    state.phase = 'figma';
    const vpath = path.join(job, 'verdicts', `figma-${pad(f.iteration)}.md`);
    const first = f.iteration === 1 && !fs.existsSync(J('figma', 'nodes.json'));
    block(`${first ? 'ここまでの工程に合格しました。Figma フェーズに入ります。' : ''}figma-builder サブエージェントを新しく呼び、${first ? '「Figma フェーズ初回。nodes.json はまだない」' : '「修正回。最新の verdicts/figma-*.md を上から全部直す」'}と伝えてください。終わったら figma-critic サブエージェントを呼び、判定を ${vpath} に書かせてから、2行で要約してターンを終えてください。`);
  }
  endPart(state.result === 'max_reached' ? '上限回数に達した工程があります。' : '全工程に合格しました。');
}

// 案件の commit を既定のブランチに直接入れない。直らなければ2回で諦めて、そのまま進める
function checkBranch() {
  if (!useGit()) return;
  const cur = gitOut(['branch', '--show-current']);
  const def = (gitOut(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']) || 'origin/main').replace(/^origin\//, '');
  if (cur && cur !== def && (!state.branch || state.branch === cur)) { state.branch ||= cur; return; }
  state.branch_warnings = (state.branch_warnings || 0) + 1;
  const want = state.branch || `design/${path.basename(request)}`;
  if (state.branch_warnings <= 2) {
    const where = !cur ? 'ブランチにいません（detached HEAD）' : cur === def ? `既定のブランチ ${def} にいます` : `案件のブランチ ${state.branch} ではなく ${cur} にいます`;
    block(`${where}。このままだと案件の commit が ${cur || 'どこにも属さない状態'} に入ります。design-job の「0. 案件を作る」の 1 に従って ${want} に切り替え、何も変更せずにターンを終えてください。切り替えられない事情があるなら、理由を ${request}/progress.md に書いてターンを終えてください（あと ${3 - state.branch_warnings} 回でこのまま進めます）。`);
  }
  if (state.branch_warnings === 3) log(`\n## 注意：案件用のブランチに切り替えられないまま進めた（${cur || 'detached'}）\n`);
}

// PR があるかを gh で確かめる。gh がない環境では、delivery.json に書かれた URL を信じる（verified: false）
function findPr() {
  const recorded = knownPr();
  const target = recorded || state.branch || gitOut(['branch', '--show-current']);
  if (!target) return { ok: false, why: 'ブランチも PR の URL も分からない' };
  const r = spawnSync('gh', ['pr', 'view', target, '--json', 'url,state,headRefOid'], { cwd: root, encoding: 'utf8', timeout: 60 * 1000 });
  if (r.error?.code === 'ENOENT') {
    return recorded ? { ok: true, url: recorded, verified: false } : { ok: false, why: `gh がなく、${request}/delivery.json にも PR の URL がない` };
  }
  if (r.status === 0) {
    const pr = readJsonText(r.stdout);
    if (pr?.url) {
      if (pr.state === 'CLOSED') return { ok: false, why: `PR が閉じられている（${pr.url}）` };
      const head = gitOut(['rev-parse', 'HEAD']);
      if (head && pr.headRefOid && head !== pr.headRefOid && pr.state === 'OPEN') {
        return { ok: false, why: `ローカルの最新の commit が PR に push されていない（${pr.url}）` };
      }
      return { ok: true, url: pr.url, verified: true };
    }
  }
  const err = ((r.stderr || '').trim().split('\n').pop() || 'gh pr view が失敗').slice(0, 200);
  if (recorded && /auth|login|token/i.test(err)) return { ok: true, url: recorded, verified: false };
  return { ok: false, why: err };
}
function readJsonText(s) { try { return JSON.parse(s); } catch { return null; } }

// hook 自体が落ちた（state.json が壊れている、案件フォルダが欠けている等）。数えて、3回で納品か停止に回す
function crashed(err) {
  const c = (readJson(crashFile)?.count || 0) + 1;
  const msg = String(err?.message || err).split('\n')[0].slice(0, 300);
  fs.mkdirSync(path.dirname(crashFile), { recursive: true });
  fs.writeFileSync(crashFile, JSON.stringify({ count: c, at: now(), error: String(err?.stack || err).slice(0, 2000) }, null, 2) + '\n');
  if (c < 3) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: `関門 hook がエラーで止まりました（${c} 回目）：${msg}\n.loop/state.json が JSON として読めるか、案件フォルダ（manifest.json など）がそろっているかを確かめて直し、ターンを終えてください（hook がもう一度判定します。3回続くと打ち切ります）。` }));
    process.exit(0);
  }
  fs.rmSync(crashFile, { force: true });
  if (state && job && request && state.phase !== 'delivering') {
    try { state.result = 'error'; endPart(`関門 hook が3回続けて失敗したため、ここまでの状態で打ち切ります：${msg}`); } catch {}
  }
  try { if (state) { state.status = state.phase === 'delivering' ? 'done' : 'stopped'; state.stopped_reason = msg; save(); } } catch {}
  notify(`関門 hook が3回続けて失敗したため止めました：${msg}`);
  process.exit(0);
}

function main() {
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!['running', 'delivering'].includes(state.status)) process.exit(0);
  config = readJson(R('studio', 'config.json')) || {};
  job = state.job;
  request = state.request || job;
  if (!job || !fs.existsSync(R(job))) throw new Error(`state.json の job（${job}）のフォルダがない`);
  J = (...xs) => R(job, ...xs);
  pass = state.pass_score ?? config.defaults?.pass_score ?? 8;
  interactive = (config.interactive_media || ['ui', 'web', 'prototype', 'renewal', 'email']).includes(state.medium);

  // ---------- delivering → done ----------
  if (state.phase === 'delivering') {
    const pr = findPr();
    if (!pr.ok) {
      state.pr_checks = (state.pr_checks || 0) + 1;
      if (state.pr_checks < 3) {
        block(`PR を確認できませんでした（${pr.why}）。design-job の「4. 納品」の 2 に従って、ブランチ ${state.branch || ''} を push し、PR を作って（既にあれば同じ PR に push して）、URL を ${request}/delivery.json の "pr" に書いてからターンを終えてください。gh が使えない・リモートがないなどで作れないときは、理由を ${request}/progress.md に書いてターンを終えてください（あと ${3 - state.pr_checks} 回で、PR なしとして止めます）。`);
      }
      log(`\n## PR を確認できないまま止めた（${pr.why}）\n`);
    }
    state.status = 'done';
    state.finished_at = now();
    const summary = writeRequestSummary({
      finished_at: state.finished_at, pr: pr.url || null, pr_verified: !!pr.verified,
      ...(pr.ok ? { pr_missing: undefined } : { pr_missing: pr.why }),
    });
    record('done', 0, summary.result, {}, { pr: summary.pr });
    commit(`done ${summary.result}`);
    // summary.json の更新（PR の URL）を PR に載せる。upstream がなければ何もしない
    if (pr.verified && useGit() && gitOut(['rev-parse', '--abbrev-ref', '@{u}'])) {
      spawnSync('git', ['push', '-q'], { cwd: root, timeout: 60 * 1000 });
    }
    save();
    fs.rmSync(crashFile, { force: true });
    const name = path.basename(request);
    notify(pr.ok ? `${name} を納品しました（${label()}）` : `${name}：PR を確認できませんでした（${pr.why}）`);
    process.exit(0);
  }

  // ---------- build ----------
  if (state.phase === 'build') {
    checkBranch();
    const b = (state.build ||= { iteration: 0, max: config.defaults?.build_max ?? 10 });
    b.max ??= config.defaults?.build_max ?? 10;
    b.iteration += 1;
    const n = pad(b.iteration);
    if (b.iteration > b.max) {
      b.iteration -= 1;
      state.result = 'max_reached';
      log(`\n## build が上限 ${b.max} 回に到達\n`);
      endPart(`HTML の採点が上限 ${b.max} 回で合格しませんでした。最後の講評は ${job}/verdicts/ の最新です。`);
    }

    const shots = `shots/build-${n}`;
    const s = spawnSync('node', [P('scripts', 'shoot.mjs'), '--job', job, '--out', shots], { cwd: root, encoding: 'utf8', timeout: 5 * 60 * 1000 });
    if (s.status !== 0) {
      b.iteration -= 1;
      state.shoot_failures = (state.shoot_failures || 0) + 1;
      const detail = (s.stderr || s.stdout || (s.error ? String(s.error) : '')).slice(-1500);
      log(`\n## build 撮影に失敗（${state.shoot_failures} 回目）\n${detail}\n`);
      if (state.shoot_failures >= 3) {
        state.result = 'shoot_failed';
        endPart(`撮影が3回続けて失敗したため、ここまでの状態で打ち切ります。最後のエラーは ${job}/progress.md にあります。`);
      }
      block(`撮影に失敗しました（${state.shoot_failures} 回目。3回続くと打ち切ります）。${job}/manifest.json と各 HTML を直してから止まってください。\n${detail}`);
    }
    state.shoot_failures = 0;

    const checks = JSON.parse(fs.readFileSync(J(shots, 'checks.json'), 'utf8'));
    const hard = ['overflow', 'contrast', 'minFont', 'brokenLinks', 'fonts', 'type', 'brand'].flatMap((k) => checks[k] || []);
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
    u.max ??= config.defaults?.usertest_max ?? 3;
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
    f.max ??= config.defaults?.figma_max ?? 5;
    const n = pad(f.iteration);
    const vfile = J('verdicts', `figma-${n}.md`);
    const missOut = () => {
      f.misses = (f.misses || 0) + 1;
      if (f.misses >= 3) { state.result = 'figma_unverified'; endPart('Figma の判定が3回続けて読めませんでした（ファイルがない、または形式が違う）。Figma は未検品のまま進めます。'); }
    };
    const fresh = fs.existsSync(vfile) && fs.statSync(vfile).mtimeMs >= (f.iter_started_at || 0);
    if (!fresh) {
      missOut();
      block(`${path.join(job, 'verdicts', `figma-${n}.md`)} がありません。figma-critic サブエージェントを呼び、このパスに判定を書かせてから止まってください（figma-builder の作業がまだなら先に終わらせる。3回続くと Figma は未検品で納品します）。`);
    }
    const text = fs.readFileSync(vfile, 'utf8');
    const m = text.match(/^VERDICT:\s*(PASS|FAIL)/m);
    if (!m) {
      missOut();
      block(`${vfile} の1行目が「VERDICT: PASS または FAIL」になっていません。figma-critic に形式どおり書き直させてください（3回続くと Figma は未検品で納品します）。`);
    }
    f.misses = 0;
    const sc = parseScores(text);
    record('figma', f.iteration, m[1], sc.obj);
    log(`\n## figma ${n} — ${m[1]} — ${sc.line}\n- 講評: verdicts/figma-${n}.md\n`);
    commit(`figma ${n} ${m[1]} ${sc.line}`);

    if (m[1] === 'PASS') { f.passed = sc.line; f.done = true; endPart(state.result === 'max_reached' ? '上限回数に達した工程があります。' : '全工程に合格しました。'); }
    if (f.iteration >= f.max) { state.result = 'max_reached'; f.passed = `上限到達（${sc.line}）`; endPart(`Figma が上限 ${f.max} 回で合格しませんでした。`); }
    nextAfterUsertest(); // iteration を進めて figma-builder の修正回へ
  }

  fs.rmSync(crashFile, { force: true });
  process.exit(0);
}

try { main(); } catch (err) { crashed(err); }
