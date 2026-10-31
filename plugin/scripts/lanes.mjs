#!/usr/bin/env node
// レーン（媒体 × 上位案を並列に磨く単位）を作る・最後の確認を反映する・何案磨くかを決める。
//
//   node lanes.mjs count
//     … 何案を並列に磨くか（studio/config.json の defaults.finalists。"auto" なら審査と依頼者の一致率で 1 か 2）を JSON で出す
//   node lanes.mjs start --request jobs/<id> --part jobs/<id>/web=d3,d1 [--part jobs/<id>/banner=d2] [--branch <name>]
//     … 媒体フォルダごとに、選んだ方向性をレーンにする。1案だけなら媒体フォルダそのもの、2案以上なら <媒体フォルダ>-<dN> を作る。
//       どのレーンも explore/<dN>/ を work/ に写す。.loop/lanes/<名前>.json と、レーンを束ねた .loop/state.json を書く
//   node lanes.mjs finish --request jobs/<id> --pick <レーン名>[,<レーン名>] [--fix <レーン名>,...] [--figma on|off] [--reason "<依頼者の言葉>"]
//     … 最後の確認で選んだレーンを、普通の状態（parts）に戻す。直しのあるレーンは build から、ないレーンは finish から。
//       選ばなかったレーンは archived にする。審査の1位と依頼者の選択の一致を studio/metrics/runs.jsonl に積む
//
// 関門 hook（design-gate.mjs）が .loop/state.json の lanes を見て、レーンを同時に採点する。

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0];
const opts = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : [])).filter(Boolean);
const opt = (k) => opts(k)[0];
const root = process.cwd();
const R = (...xs) => path.join(root, ...xs);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const now = () => new Date().toISOString();
const config = readJson(R('studio', 'config.json')) || {};
const d = config.defaults || {};
const die = (m) => { console.error(m); process.exit(1); };

// verdicts/<kind>-NN.md の最大の NN
function lastIter(dir, kind) {
  let max = 0;
  try { for (const f of fs.readdirSync(R(dir, 'verdicts'))) { const m = f.match(new RegExp(`^${kind}-(\\d+)\\.md$`)); if (m) max = Math.max(max, Number(m[1])); } } catch {}
  return max;
}

// explore/<dN>/ は work/ より1階層深い。媒体フォルダ（assets/ など）を指す相対パスを1段浅くする
function fixDepth(dir) {
  const walk = (d, depth) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { walk(p, depth + 1); continue; }
      if (!/\.(html?|css|js|svg)$/i.test(f.name)) continue;
      const from = '../'.repeat(depth + 2), to = '../'.repeat(depth + 1);
      const text = fs.readFileSync(p, 'utf8');
      const next = text.replace(new RegExp(`(["'(\\s])${from.replace(/\./g, '\\.')}(?!\\.\\./)`, 'g'), `$1${to}`);
      if (next !== text) fs.writeFileSync(p, next);
    }
  };
  walk(dir, 0);
}

// 探索の最新の判定（verdicts/explore-rNN.md）の RANKING
function ranking(part) {
  let best = null;
  try {
    for (const f of fs.readdirSync(R(part, 'verdicts'))) {
      const m = f.match(/^explore-r(\d+)\.md$/);
      if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), f };
    }
  } catch {}
  if (!best) return { round: null, order: [] };
  const text = fs.readFileSync(R(part, 'verdicts', best.f), 'utf8');
  const line = (text.match(/^RANKING:\s*(.*)$/m) || [, ''])[1];
  return { round: `r${String(best.n).padStart(2, '0')}`, order: line.split('>').map((x) => x.trim()).filter(Boolean) };
}

// ---------- count ----------
if (cmd === 'count') {
  const v = d.finalists ?? 'auto';
  if (v !== 'auto') { console.log(JSON.stringify({ finalists: Number(v) || 1, reason: `studio/config.json の defaults.finalists が ${v}` })); process.exit(0); }
  const picks = [];
  try {
    for (const line of fs.readFileSync(R('studio', 'metrics', 'runs.jsonl'), 'utf8').split('\n')) {
      const j = line.trim() && (() => { try { return JSON.parse(line); } catch { return null; } })();
      if (j?.phase === 'pick' && j.judge && j.human) picks.push(j);
    }
  } catch {}
  const recent = picks.slice(-5);
  const hit = recent.filter((p) => p.match).length;
  // 直近5件のうち4件以上で審査の1位を依頼者が選んでいれば、1案だけ磨く（費用を半分にする）
  const finalists = recent.length >= 5 && hit >= 4 ? 1 : 2;
  console.log(JSON.stringify({ finalists, reason: `直近 ${recent.length} 件で審査の1位と依頼者の選択が一致したのは ${hit} 件`, agreement: recent.length ? hit / recent.length : null }));
  process.exit(0);
}

// ---------- start ----------
if (cmd === 'start') {
  const request = opt('--request')?.replace(/\/$/, '');
  if (!request || !fs.existsSync(R(request))) die('使い方: node lanes.mjs start --request jobs/<id> --part jobs/<id>/<媒体>=dA,dB [--part ...] [--branch <name>]');
  const prevTop = readJson(R('.loop', 'state.json')) || {};
  const branch = opt('--branch') || prevTop.branch || null;
  const lanes = [];
  const SKIP = new Set(['explore', 'shots', 'work', 'alt', 'figma', 'artifact.json', 'summary.json']);
  for (const spec of opts('--part')) {
    const [partRaw, list] = spec.split('=');
    const part = partRaw.replace(/\/$/, '');
    const picks = (list || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!fs.existsSync(R(part))) die(`${part} がありません`);
    if (!picks.length) die(`${spec}：方向性（dN）がありません`);
    const medium = readJson(R(part, 'lane.json'))?.medium || prevTop.parts?.find((p) => p.path === part)?.medium || path.basename(part).replace(/-\d+$/, '');
    for (const dn of picks) {
      if (!fs.existsSync(R(part, 'explore', dn))) die(`${part}/explore/${dn} がありません`);
      const lanePath = picks.length === 1 ? part : `${part}-${dn}`;
      if (lanePath !== part) {
        fs.rmSync(R(lanePath), { recursive: true, force: true });
        fs.mkdirSync(R(lanePath), { recursive: true });
        for (const f of fs.readdirSync(R(part))) {
          if (SKIP.has(f) || /^explore-.*\.html$/.test(f)) continue;
          if (f === 'verdicts') {
            fs.mkdirSync(R(lanePath, 'verdicts'), { recursive: true });
            for (const v of fs.readdirSync(R(part, 'verdicts'))) if (v.startsWith('explore-')) fs.cpSync(R(part, 'verdicts', v), R(lanePath, 'verdicts', v));
            continue;
          }
          fs.cpSync(R(part, f), R(lanePath, f), { recursive: true });
        }
      }
      fs.rmSync(R(lanePath, 'work'), { recursive: true, force: true });
      fs.cpSync(R(part, 'explore', dn), R(lanePath, 'work'), { recursive: true });
      fixDepth(R(lanePath, 'work'));
      const name = path.basename(lanePath);
      writeJson(R(lanePath, 'lane.json'), { name, base: part, medium, direction: dn, created_at: now() });
      fs.appendFileSync(R(lanePath, 'progress.md'), `\n## レーン ${name}（${now()}）\n- 方向性 ${dn} を ${part}/explore/${dn}/ から work/ に写した。最後の確認まで止まらずに磨く\n`);
      const bi = lastIter(lanePath, 'build'), ui = lastIter(lanePath, 'usertest');
      const st = `.loop/lanes/${name}.json`;
      writeJson(R(st), {
        status: 'running', request, job: lanePath, medium, phase: 'build', branch, direction: dn,
        pass_score: d.pass_score ?? 8, review_stop: true, started_at: now(),
        build: { iteration: bi, max: bi + (d.build_max ?? 10) }, usertest: { iteration: ui, max: ui + (d.usertest_max ?? 3) },
        figma: { enabled: false, iteration: 0, max: d.figma_max ?? 5 },
      });
      lanes.push({ name, path: lanePath, medium, direction: dn, base: part, state: st });
    }
  }
  if (!lanes.length) die('--part がありません');
  writeJson(R('.loop', 'state.json'), {
    status: 'running', mode: 'lanes', request, branch, lanes, started_at: prevTop.started_at || now(),
    ...(prevTop.git === false ? { git: false } : {}),
  });
  console.log(JSON.stringify({ lanes: lanes.map(({ name, path: p, medium, direction }) => ({ name, path: p, medium, direction })) }, null, 2));
  process.exit(0);
}

// ---------- finish ----------
if (cmd === 'finish') {
  const request = opt('--request')?.replace(/\/$/, '');
  const top = readJson(R('.loop', 'state.json'));
  if (!request || !top?.lanes) die('使い方: node lanes.mjs finish --request jobs/<id> --pick <レーン名>[,...] [--fix <レーン名>,...] [--figma on|off] [--reason "..."]（.loop/state.json にレーンがありません）');
  const pickNames = (opt('--pick') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const fixNames = new Set((opt('--fix') || '').split(',').map((x) => x.trim()).filter(Boolean));
  const figma = opt('--figma') === 'on';
  const reason = opt('--reason') || '';
  const picked = pickNames.map((n) => top.lanes.find((l) => l.name === n) || die(`レーン ${n} がありません（${top.lanes.map((l) => l.name).join(', ')}）`));
  if (!picked.length) die('--pick がありません');

  // 審査の1位と依頼者の選択の一致を積む（何案磨くかの auto に使う）。探索した媒体フォルダに、依頼者の選択の記録を残す（librarian が二択として積む）
  fs.mkdirSync(R('studio', 'metrics'), { recursive: true });
  for (const l of picked) {
    const base = l.base || l.path;
    const { round, order } = ranking(base);
    const others = top.lanes.filter((x) => (x.base || x.path) === base && x.name !== l.name).map((x) => x.direction);
    if (order.length && others.length) {
      fs.appendFileSync(R('studio', 'metrics', 'runs.jsonl'), JSON.stringify({ ts: now(), job: base, medium: l.medium, phase: 'pick', judge: order[0], human: l.direction, match: order[0] === l.direction, finalists: others.length + 1 }) + '\n');
    }
    if (round) {
      fs.writeFileSync(R(base, 'verdicts', `explore-${round}-human.md`), `PICK: ${l.direction}\nOTHERS: ${[...new Set([...others, ...order.filter((x) => x !== l.direction)])].join(' ')}\nREASON: ${reason}\n`);
    }
  }
  for (const l of top.lanes) {
    if (picked.includes(l)) continue;
    const s = readJson(R(l.state));
    if (s) { s.status = 'archived'; s.archived_at = now(); writeJson(R(l.state), s); }
  }

  const parts = picked.map((l) => ({ path: l.path, medium: l.medium, phase: fixNames.has(l.name) ? 'build' : 'finish' }));
  const first = picked[0];
  const ls = readJson(R(first.state)) || {};
  const sum = readJson(R(first.path, 'summary.json')) || {};
  const bi = lastIter(first.path, 'build'), ui = lastIter(first.path, 'usertest'), fi = lastIter(first.path, 'figma');
  const fixing = parts[0].phase === 'build';
  const state = {
    status: 'running', request, job: first.path, medium: first.medium, parts, current: 0, phase: parts[0].phase,
    branch: top.branch, direction: first.direction, pass_score: ls.pass_score ?? d.pass_score ?? 8, finishing: true,
    started_at: top.started_at, cost_usd: top.lanes.reduce((a, l) => a + (readJson(R(l.state))?.cost_usd || 0), 0),
    build: { ...(sum.build || ls.build || {}), iteration: bi, max: bi + (fixing ? 5 : 0) },
    usertest: { ...(sum.usertest || ls.usertest || {}), iteration: ui, max: ui + (d.usertest_max ?? 3), done: !fixing && !!(sum.usertest || ls.usertest)?.done },
    figma: { enabled: figma, iteration: fi, max: fi + (d.figma_max ?? 5) },
    ...(top.git === false ? { git: false } : {}),
  };
  writeJson(R('.loop', 'state.json'), state);
  console.log(JSON.stringify({ parts, figma, next: fixing ? 'build（直しを designer に渡してからターンを終える）' : 'finish（何も変更せずにターンを終える）' }, null, 2));
  process.exit(0);
}

die('使い方: node lanes.mjs count | start ... | finish ...');
