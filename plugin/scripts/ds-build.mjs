#!/usr/bin/env node
// デザインシステム（studio/design-system/<名前>/）の検査・合成・選択。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs                      登録済みの全デザインシステムを検査し、tokens.css を作る
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --dir <フォルダ>       1つだけ検査し、tokens.css を作る
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --select <medium> [--override <名前>]
//                                                                      その媒体で使うデザインシステムの名前を出す（none / unset もある）
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --resolve <名前> --out <フォルダ>
//                                                                      extends をたどって合成し、1つのデザインシステムとして書き出す
// 形と設定は ${CLAUDE_PLUGIN_ROOT}/studio/design-system-format.md。検査に落ちたら終了コード 1。

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const root = process.cwd();
const dsRoot = path.join(root, 'studio', 'design-system');
const GROUPS = ['color', 'font', 'fontSize', 'lineHeight', 'space', 'radius', 'shadow'];
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// 設定を読む。古い形（design_system.sources が1つだけ）は、default という名前のデザインシステムが1つある状態として読む
function loadConfig() {
  const cfg = readJson(path.join(root, 'studio', 'config.json'), {});
  if (cfg.design_systems) return { status: 'unset', default: null, by_medium: {}, systems: {}, ...cfg.design_systems };
  const legacy = cfg.design_system?.sources || [];
  if (legacy.length) return { status: 'set', default: 'default', by_medium: {}, systems: { default: { sources: legacy } }, legacy: true };
  return { status: 'unset', default: null, by_medium: {}, systems: {} };
}

// 名前 → フォルダ。共通の登録から取り込んだもの（shared:<id>）は shared-<id>。古い形は studio/design-system 直下
function dirOf(name, cfg) {
  if (cfg.legacy && name === 'default' && fs.existsSync(path.join(dsRoot, 'tokens.json'))) return dsRoot;
  return path.join(dsRoot, name.replace(/^shared:/, 'shared-'));
}

function check(dir) {
  const tokens = readJson(path.join(dir, 'tokens.json'), null);
  if (!tokens) return { errors: [`${path.relative(root, dir)}/tokens.json が読めません`] };
  const source = readJson(path.join(dir, 'source.json'), { sources: [] });
  const ids = new Set((source.sources || []).map((s) => s.id));
  const errors = [];
  const count = { confirmed: 0, inferred: 0 };
  if (tokens.$format !== 'tanren/tokens@1') errors.push('$format が "tanren/tokens@1" ではありません');
  for (const key of Object.keys(tokens)) {
    if (key.startsWith('$')) continue;
    if (!GROUPS.includes(key)) { errors.push(`知らないグループ「${key}」（使えるのは ${GROUPS.join(', ')}）`); continue; }
    for (const [name, t] of Object.entries(tokens[key] || {})) {
      const at = `${key}.${name}`;
      if (!/^[A-Za-z0-9-]+$/.test(name)) errors.push(`${at}：名前は英数字と - だけ`);
      if (!t || typeof t.value !== 'string' || !t.value.trim()) { errors.push(`${at}：value がない`); continue; }
      if (!['confirmed', 'inferred'].includes(t.status)) errors.push(`${at}：status は confirmed か inferred`);
      else count[t.status] += 1;
      if (ids.size && t.source && !ids.has(t.source)) errors.push(`${at}：source「${t.source}」が source.json にない`);
      if (/[;{}]/.test(t.value)) errors.push(`${at}：value に ; { } は書けない`);
    }
  }
  return { errors, tokens, count };
}

function cssOf(tokens, label) {
  const vars = [];
  for (const key of GROUPS) {
    for (const [name, t] of Object.entries(tokens[key] || {})) {
      vars.push(`  --ds-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}-${name}: ${t.value};${t.status === 'inferred' ? ' /* 推定 */' : ''}`);
    }
  }
  return { css: `/* ${label} の tokens.json から ds-build.mjs が作った。手で直さず tokens.json を直す */\n:root {\n${vars.join('\n')}\n}\n`, n: vars.length };
}

function build(dir) {
  const r = check(dir);
  const label = path.relative(root, dir) || '.';
  if (r.errors.length) {
    console.error(`${label}：tokens.json の検査で ${r.errors.length} 件\n${r.errors.map((x) => `- ${x}`).join('\n')}`);
    return false;
  }
  const { css, n } = cssOf(r.tokens, label);
  fs.writeFileSync(path.join(dir, 'tokens.css'), css);
  console.log(`${label}：tokens.css を作りました（${n} 個。確定 ${r.count.confirmed}・推定 ${r.count.inferred}）`);
  return true;
}

// extends を土台から順に並べる（循環は止める）
function chainOf(name, cfg) {
  const chain = [];
  for (let n = name; n; n = cfg.systems[n]?.extends || null) {
    if (chain.includes(n)) { console.error(`extends が循環しています：${[...chain, n].join(' → ')}`); process.exit(1); }
    if (!cfg.systems[n] && !n.startsWith('shared:')) { console.error(`デザインシステム「${n}」が studio/config.json の design_systems.systems にありません`); process.exit(1); }
    chain.push(n);
  }
  return chain.reverse();
}

const copyTree = (from, to, skip) => {
  if (!fs.existsSync(from)) return;
  for (const f of fs.readdirSync(from, { recursive: true })) {
    const src = path.join(from, f);
    if (skip.has(f) || fs.statSync(src).isDirectory()) continue;
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(src, path.join(to, f));
  }
};

const cfg = loadConfig();

if (opt('--select')) {
  // 選び方：案件の指定 → 媒体の割り当て（null は「使わない」）→ 既定 → 未設定
  const medium = opt('--select');
  const override = opt('--override');
  if (override) { console.log(override === 'none' ? 'none' : override); process.exit(0); }
  if (cfg.status === 'none') { console.log('none'); process.exit(0); }
  if (Object.prototype.hasOwnProperty.call(cfg.by_medium || {}, medium)) { console.log(cfg.by_medium[medium] ?? 'none'); process.exit(0); }
  console.log(cfg.default || (cfg.status === 'set' ? 'none' : 'unset'));
  process.exit(0);
}

if (opt('--resolve')) {
  const name = opt('--resolve');
  const out = opt('--out');
  if (!out) { console.error('--resolve には --out <フォルダ> が要ります'); process.exit(1); }
  const chain = chainOf(name, cfg);
  const merged = { $format: 'tanren/tokens@1' };
  const readmes = [];
  const sources = {};
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const n of chain) {
    const dir = dirOf(n, cfg);
    const r = check(dir);
    if (r.errors.length) { console.error(`${n}：tokens.json の検査で ${r.errors.length} 件。先に取り込みを直してください\n${r.errors.map((x) => `- ${x}`).join('\n')}`); process.exit(1); }
    // 上に重ねる方（子）の値で上書きする。確定・推定も上書きした側のもの
    for (const key of GROUPS) if (r.tokens[key]) merged[key] = { ...(merged[key] || {}), ...r.tokens[key] };
    copyTree(dir, out, new Set(['tokens.json', 'tokens.css', 'README.md', 'source.json']));
    const readme = fs.existsSync(path.join(dir, 'README.md')) ? fs.readFileSync(path.join(dir, 'README.md'), 'utf8') : '（README なし）\n';
    readmes.push(`<!-- ここから：${n} -->\n${readme.trim()}\n`);
    sources[n] = readJson(path.join(dir, 'source.json'), {});
  }
  const head = chain.length > 1
    ? `# ${name}（${chain.join(' → ')} を重ねたもの）\n\n下に行くほど後から重ねた決まり。食い違うときは下（${name}）を優先する。\n\n`
    : '';
  fs.writeFileSync(path.join(out, 'README.md'), head + readmes.join('\n'));
  fs.writeFileSync(path.join(out, 'tokens.json'), JSON.stringify(merged, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'source.json'), JSON.stringify({ name, chain, resolved_at: new Date().toISOString(), systems: sources }, null, 2) + '\n');
  const { css, n } = cssOf(merged, name);
  fs.writeFileSync(path.join(out, 'tokens.css'), css);
  console.log(`${name} を ${chain.join(' → ')} から合成し、${path.relative(root, out) || out} に書き出しました（トークン ${n} 個）`);
  process.exit(0);
}

if (opt('--dir')) process.exit(build(path.resolve(opt('--dir'))) ? 0 : 1);

// 引数なし：登録済みの全デザインシステムを検査する
const names = Object.keys(cfg.systems || {});
const dirs = new Set(names.map((n) => dirOf(n, cfg)));
for (const n of names) for (const c of chainOf(n, cfg)) dirs.add(dirOf(c, cfg));
const targets = [...dirs].filter((d) => fs.existsSync(path.join(d, 'tokens.json')));
if (!targets.length) { console.log('検査するデザインシステムがありません（studio/config.json の design_systems.systems）'); process.exit(0); }
const ok = targets.map(build).every(Boolean);
process.exit(ok ? 0 : 1);
