#!/usr/bin/env node
// 採点役（critic）の検証。人間の判定が分かっている過去案件で critic を走らせ、一致率を出す。
// critic・rubrics・taste を変える前後で走らせ、一致率が下がる変更は採用しない。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/bench.mjs [--limit 5] [--no-starter] [--dry]
// ケースは2種類：このリポジトリの studio/benchmark/cases/（人間の判定）と、plugin 同梱の benchmark-starter/cases/
// （作り手が良し悪しを決めた初期分。人間の判定ではないので、明らかに悪いものを通さないかの確認にだけ使う）。
// --dry は対象のケースを並べるだけで critic を走らせない。
// 出力: studio/benchmark/results/<日時>.json と標準出力の要約

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const plugin = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const limit = li >= 0 ? Number(args[li + 1]) : Infinity;
const list = (dir, source) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'outcome.json')))
    .map((d) => ({ name: d, source, dir: path.relative(root, path.join(dir, d)) || '.' }))
  : []);
const cases = [
  ...list(path.join(root, 'studio', 'benchmark', 'cases'), 'human'),
  ...(args.includes('--no-starter') ? [] : list(path.join(plugin, 'benchmark-starter', 'cases'), 'starter')),
].slice(0, limit);

if (cases.length === 0) {
  console.log('検証ケースがありません（studio/benchmark/cases/<job>/outcome.json）。librarian がレビュー時に追加します。');
  process.exit(0);
}
if (args.includes('--dry')) {
  for (const c of cases) console.log(`${c.source}\t${c.name}\t${c.dir}`);
  process.exit(0);
}

const stateFile = path.join(root, '.loop', 'state.json');
const backup = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : null;
fs.mkdirSync(path.dirname(stateFile), { recursive: true });

const results = [];
for (const { name: c, source, dir } of cases) {
  const outcome = JSON.parse(fs.readFileSync(path.join(root, dir, 'outcome.json'), 'utf8'));
  // critic は .loop/state.json の job を読むので、一時的にケースを指す
  fs.writeFileSync(stateFile, JSON.stringify({ status: 'bench', job: dir, medium: outcome.medium, pass_score: outcome.pass_score ?? 8 }));
  const r = spawnSync('claude', [
    '-p', `検証ケース ${dir} を採点してください。媒体は ${outcome.medium}。スクショは ${dir}/shots/ にあります。HTML は無いので Playwright は使わず、スクショだけで判断してください。`,
    '--agent', 'tanren:critic', '--plugin-dir', plugin, '--allowedTools', 'Read,Glob,Grep', '--output-format', 'text',
  ], { cwd: root, encoding: 'utf8', timeout: 15 * 60 * 1000, env: { ...process.env, DESIGN_LOOP_EVALUATOR: '1' } });
  const verdict = ((r.stdout || '').match(/^VERDICT:\s*(PASS|FAIL)/m) || [])[1] || 'ERROR';
  const expected = outcome.human_outcome === 'accepted' ? 'PASS' : outcome.human_outcome === 'major' ? 'FAIL' : null;
  const agree = expected ? verdict === expected : null;
  results.push({ case: c, source, medium: outcome.medium, human: outcome.human_outcome, expected, verdict, agree });
  console.log(`${source === 'starter' ? '[初期分] ' : ''}${c}: 期待=${outcome.human_outcome} critic=${verdict} ${agree === null ? '（対象外）' : agree ? '一致' : '不一致'}`);
}

if (backup !== null) fs.writeFileSync(stateFile, backup); else fs.rmSync(stateFile, { force: true });

// 人間の判定と初期分は混ぜずに数える（一致率は人間の判定のケースだけ）
const stat = (xs) => {
  const scored = xs.filter((x) => x.agree !== null);
  return {
    scored: scored.length,
    agreement: scored.length ? scored.filter((x) => x.agree).length / scored.length : null,
    lenient: scored.filter((x) => x.expected === 'FAIL' && x.verdict === 'PASS').length,
  };
};
const human = stat(results.filter((x) => x.source === 'human'));
const starter = stat(results.filter((x) => x.source === 'starter'));
const agreement = human.agreement;
const lenient = human.lenient;
const summary = {
  at: new Date().toISOString(), cases: results.length, scored: human.scored,
  agreement, lenient_passes: lenient, starter, results,
};
const resDir = path.join(root, 'studio', 'benchmark', 'results');
fs.mkdirSync(resDir, { recursive: true });
const file = path.join(resDir, `${summary.at.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
console.log(`\n一致率 ${agreement === null ? '-' : Math.round(agreement * 100) + '%'}（人間の判定 ${human.scored} 件、甘い合格 ${lenient} 件）`);
if (starter.scored) console.log(`初期分 ${starter.scored} 件：一致 ${Math.round(starter.agreement * 100)}%、甘い合格 ${starter.lenient} 件（甘い合格が1件でもあれば、その変更は採用しない）`);
console.log(`保存: ${path.relative(root, file)}`);
if (human.scored < 10) console.log('注意: 判定対象が10件未満のため、この一致率は参考値です。');
