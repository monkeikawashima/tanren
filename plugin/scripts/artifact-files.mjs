#!/usr/bin/env node
// Artifact で公開する前に、一覧ページから参照されているファイルを集め、リンク切れがないかを確かめる。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-files.mjs --root <公開の根のフォルダ> --page <一覧ページ>
//
// Artifact は一覧ページを公開物のいちばん上（index.html）に置き、ほかのファイルは root からの相対パスで置く。
// 一覧ページが root より下のフォルダにあると、ページの中の相対リンクが公開後にずれて「This content is unavailable」になる。
// そのため一覧ページは root の直下に置くことを求め、ページ・HTML・CSS・JS の中の相対参照をたどって、
// 全部のファイルが root の中にあることを確かめる。
// 出力（標準出力の JSON）：{ "file_path": <ページ>, "root": <root>, "files": { "<公開のパス>": "<root からのパス>" } }
// そのまま Artifact の publish に渡す。リンク切れ・root の外・絶対パスの参照があれば、一覧を出して exit 1。

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const rootArg = opt('--root');
const pageArg = opt('--page');
if (!rootArg || !pageArg) {
  console.error('使い方: node artifact-files.mjs --root <公開の根のフォルダ> --page <一覧ページ>');
  process.exit(2);
}

const root = path.resolve(rootArg);
const page = path.resolve(pageArg);
const problems = [];
if (!fs.existsSync(page)) { console.error(`一覧ページがありません：${pageArg}`); process.exit(1); }
if (path.dirname(page) !== root) {
  console.error(`一覧ページは root の直下に置いてください（今は ${path.relative(process.cwd(), page)}、root は ${path.relative(process.cwd(), root) || '.'}）。` +
    'Artifact は一覧ページを公開物のいちばん上に置くので、下のフォルダにあると中のリンクがずれて開けなくなります。');
  process.exit(1);
}

const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
const isExternal = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);

// 参照を取り出す（HTML の属性・srcset・style の url()、CSS の url() と @import、JS の import と fetch の相対パス）
function refsOf(file, text) {
  const ext = path.extname(file).toLowerCase();
  const out = [];
  const cssUrls = (s) => { for (const m of s.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) out.push(m[2]); for (const m of s.matchAll(/@import\s+(['"])([^'"]+)\1/g)) out.push(m[2]); };
  if (ext === '.html' || ext === '.htm') {
    const noComments = text.replace(/<!--[\s\S]*?-->/g, '');
    for (const m of noComments.matchAll(/\s(?:href|src|poster|data-src)\s*=\s*(["'])(.*?)\1/gi)) out.push(m[2]);
    for (const m of noComments.matchAll(/\s(?:href|src|poster|data-src)\s*=\s*([^\s"'>]+)/gi)) out.push(m[1]);
    for (const m of noComments.matchAll(/\ssrcset\s*=\s*(["'])(.*?)\1/gi)) {
      for (const part of m[2].split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) out.push(u); }
    }
    cssUrls(noComments);
  } else if (ext === '.css') {
    cssUrls(text);
  } else if (ext === '.js' || ext === '.mjs') {
    for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)) out.push(m[2]);
    for (const m of text.matchAll(/import\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) out.push(m[2]);
    for (const m of text.matchAll(/fetch\s*\(\s*(['"])(\.{0,2}\/?[^'":]+\.[a-z0-9]+)\1/gi)) out.push(m[2]);
  }
  return out.map((u) => u.trim()).filter((u) => u && !u.startsWith('{{') && !/^javascript:/i.test(u));
}

const files = new Map(); // 公開のパス → root からのパス
const seen = new Set();
const queue = [page];
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  if (file !== page) files.set(rel(file), rel(file));
  const ext = path.extname(file).toLowerCase();
  if (!['.html', '.htm', '.css', '.js', '.mjs'].includes(ext)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const u of refsOf(file, text)) {
    if (isExternal(u)) continue;
    const from = file === page ? 'ページ' : rel(file);
    if (u.startsWith('/')) { problems.push(`${from}：絶対パス ${u} は公開後に開けない（相対パスにする）`); continue; }
    const clean = decodeURI(u.split(/[?#]/)[0]);
    if (!clean) continue;
    let target = path.resolve(path.dirname(file), clean);
    if (target !== root && !target.startsWith(root + path.sep)) { problems.push(`${from}：${u} は root の外を指している`); continue; }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) { problems.push(`${from}：${u} がない（${rel(target)}）`); continue; }
    if (target === page) continue;
    queue.push(target);
  }
}

if (problems.length) {
  console.error(`公開できません。リンク切れなどが ${problems.length} 件あります：\n${problems.map((p) => `- ${p}`).join('\n')}`);
  process.exit(1);
}
let bytes = fs.statSync(page).size;
for (const f of files.values()) bytes += fs.statSync(path.join(root, f)).size;
if (bytes > 60 * 1024 * 1024) console.error(`注意：合計 ${(bytes / 1048576).toFixed(1)}MB。1回の公開は 64MB まで。画像を小さくするか、分けて公開する。`);
process.stdout.write(JSON.stringify({ file_path: rel(page), root: path.relative(process.cwd(), root) || '.', files: Object.fromEntries([...files].sort()) }, null, 2) + '\n');
