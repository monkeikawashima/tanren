#!/usr/bin/env node
// 案件の成果物を撮影し、機械チェックをかける。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs --out shots/draft                          … 案件は .loop/state.json の job
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs --job jobs/20261023-x --out shots/build-01
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs --from explore/d2 --only key --out shots/explore-r01/d2
// --out と --from は案件フォルダからの相対パス。
// 出力: <out>/<id>@<w>x<h>.png（モーションは -t<ms>）、印刷は <id>.pdf、index.md、checks.json
// checks.json の overflow / contrast / minFont / brokenLinks / fonts / type / brand が1件でもあれば、関門 hook は LLM 採点を回さず差し戻す。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// playwright と axe は使う側のリポジトリに入れたものを読む（プラグインの置き場所には node_modules がない）
const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = (() => {
  try { return projectRequire('playwright'); } catch {
    console.error('playwright がこのリポジトリに入っていません。tanren の studio-init を実行するか、playwright と @axe-core/playwright を devDependencies に入れてください。');
    process.exit(1);
  }
})();

let AxeBuilder = null;
try { const m = projectRequire('@axe-core/playwright'); AxeBuilder = m.default ?? m.AxeBuilder ?? m; } catch {}

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const root = process.cwd();
const state = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, '.loop', 'state.json'), 'utf8')); } catch { return {}; } })();
const job = opt('--job', state.job);
if (!job) { console.error('案件が分かりません。--job jobs/<id> を付けるか、.loop/state.json に job を書いてください。'); process.exit(1); }
const jobDir = path.resolve(root, job);
const out = path.join(jobDir, opt('--out', 'shots/draft'));
const from = opt('--from', null);
const only = opt('--only', null);

const manifestPath = path.join(jobDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) { console.error(`${job}/manifest.json がありません。director が作成します。`); process.exit(1); }
let { items = [] } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (only === 'key') items = items.some((x) => x.key) ? items.filter((x) => x.key) : items.slice(0, 1);
if (!items.length) { console.error('撮影対象がありません。'); process.exit(1); }

const medium = state.medium;
// 媒体ごとの最小文字サイズ（CSS px）。print は 6pt ≒ 8px（注釈の下限）。
const MIN_FONT = { banner: 10, social: 14, print: 8, slide: 16, email: 14, ui: 11, web: 12, prototype: 11, renewal: 12, infographic: 11, motion: 10, identity: 0 };
const minFont = MIN_FONT[medium] ?? 10;
const fullA11y = ['ui', 'web', 'prototype', 'renewal', 'email'].includes(medium);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const lines = [`# shots ${path.relative(jobDir, out)} (${new Date().toISOString()})`, ''];
const checks = { missing: [], overflow: [], contrast: [], minFont: [], brokenLinks: [], fonts: [], type: [], brand: [], style: [], provisional: [], a11y: [], jsErrors: [] };

// トークンの色。tokens.json と、デザインシステム（assets/ds/ の JSON・CSS）の中の色の値を全部拾う
// （構造は案件ごとに違うので、値だけを見る）。デザインシステムの色に確定（confirmed）のものがある案件では、
// ここにない色は不合格にする。色が推定（inferred）だけなら参考に留める
const dsDir = path.join(jobDir, 'assets', 'ds');
const dsStrict = (() => {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(dsDir, 'tokens.json'), 'utf8'));
    return Object.values(t.color || {}).some((c) => c.status === 'confirmed');
  } catch { return false; }
})();
const tokenColors = (() => {
  const files = [path.join(jobDir, 'tokens.json')];
  if (fs.existsSync(dsDir)) files.push(...fs.readdirSync(dsDir, { recursive: true }).filter((f) => /\.(css|json)$/.test(f)).map((f) => path.join(dsDir, f)));
  const raw = files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
  return [...new Set(raw.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) || [])];
})();

// 文字組み（playbook の「文字組み」を機械で測れる分だけ）。hard は不合格、style は参考
async function typeCheck(page, ui) {
  return page.evaluate(({ ui, tokenColors }) => {
    const hard = [], style = [];
    const JP = /[぀-ヿ㐀-鿿]/;
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const sizes = new Set();
    const minLh = ui ? 1.5 : 1.6;
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const t = ownText(el);
      if (!t || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('svg, [aria-hidden="true"], [data-provisional="image"], [data-provisional="copy-needed"]')) continue;
      const size = parseFloat(cs.fontSize);
      sizes.add(Math.round(size * 2) / 2);
      if (!JP.test(t) || cs.display.startsWith('inline')) continue;
      const all = el.textContent.replace(/\s+/g, '');
      const r = el.getBoundingClientRect();
      const label = `「${t.slice(0, 16)}」`;
      // 本文：20px 以下・30字以上・2行以上の段落
      if (size <= 20 && all.length >= 30 && r.height > size * 2.2) {
        const lh = cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight) / size;
        if (lh === null || lh < minLh) hard.push(`${label} 本文の行間が ${lh === null ? 'normal' : lh.toFixed(2)}（${minLh} 以上。playbook は 1.7〜1.9）`);
        const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const perLine = inner / (size * (1 + (parseFloat(cs.letterSpacing) || 0) / size));
        if (perLine > 45) hard.push(`${label} 1行が約 ${Math.round(perLine)} 字（本文は 40 字まで）`);
      }
      // 見出し：24px 以上の和文で、最後の行が1〜2文字だけ
      if (size >= 24 && all.length >= 4) {
        const tops = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const n = walker.currentNode;
          for (let i = 0; i < n.textContent.length; i++) {
            if (!n.textContent[i].trim()) continue;
            const range = document.createRange();
            range.setStart(n, i); range.setEnd(n, i + 1);
            const rr = range.getBoundingClientRect();
            if (rr.width) tops.push(rr.top);
          }
        }
        const lines = [];
        for (const top of tops) {
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.top - top) < size * 0.5) last.n += 1; else lines.push({ top, n: 1 });
        }
        if (lines.length >= 2 && lines[lines.length - 1].n <= 2) hard.push(`${label} 見出しの最後の行が ${lines[lines.length - 1].n} 文字だけ（文節で改行する）`);
      }
    }
    if (sizes.size > 7) hard.push(`文字サイズが ${sizes.size} 種類（${[...sizes].sort((a, b) => a - b).join(', ')}px）。段階を 5〜6 に絞る`);

    // トークンにない色（参考）
    if (tokenColors.length) {
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      const normColor = (c) => { probe.style.color = ''; probe.style.color = c; return getComputedStyle(probe).color; };
      const allowed = new Set(tokenColors.map(normColor));
      allowed.add('rgb(0, 0, 0)'); allowed.add('rgb(255, 255, 255)');
      const off = new Map();
      for (const el of document.body.querySelectorAll('*')) {
        if (el === probe) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const used = [];
        if (ownText(el)) used.push(cs.color);
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) used.push(cs.backgroundColor);
        if (parseFloat(cs.borderTopWidth) > 0) used.push(cs.borderTopColor);
        for (const c of used) if (!allowed.has(c) && !off.has(c)) off.set(c, el.tagName.toLowerCase());
      }
      probe.remove();
      for (const [c, tag] of [...off].slice(0, 5)) style.push(`トークンにない色 ${c}（${tag} など）`);
    }

    // 仮の画像・仮のコピー・要コピー（納品時に一覧にする）。仮素材の部品は data-label に中身を書く
    const KIND = { image: '仮の画像', copy: '仮のコピー', 'copy-needed': '要コピー' };
    const provisional = [...document.querySelectorAll('[data-provisional]')].map((el) =>
      `${KIND[el.dataset.provisional] || '仮'}：${(el.dataset.label || el.getAttribute('alt') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}`);
    return { hard: [...new Set(hard)].slice(0, 8), style, provisional };
  }, { ui, tokenColors });
}

// 書体の置き換わり。指定した書体で実際に描かれているかを、Chromium が使ったフォント（CDP）で確かめる。
// 指定が総称（sans-serif など）だけのもの、指定にない書体で描かれた文字が多いものを拾う。
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont']);
const norm = (s) => s.toLowerCase().replace(/["'\s_-]/g, '');
async function fontCheck(context, page) {
  const targets = await page.evaluate(() => {
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    const res = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const t = ownText(el);
      if (!t || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('svg, [aria-hidden="true"], [data-provisional="image"], [data-provisional="copy-needed"]')) continue;
      el.setAttribute('data-fontcheck', String(res.length));
      res.push({ text: t.slice(0, 16), family: cs.fontFamily });
      if (res.length >= 150) break;
    }
    return res;
  });
  if (!targets.length) return [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-fontcheck]' });
  const res = new Map();
  for (const nodeId of nodeIds) {
    const { attributes = [] } = await cdp.send('DOM.getAttributes', { nodeId });
    const t = targets[Number(attributes[attributes.indexOf('data-fontcheck') + 1])];
    if (!t) continue;
    const named = t.family.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter((s) => s && !GENERIC.has(s.toLowerCase()));
    if (!named.length) { if (!res.has(`generic:${t.family}`)) res.set(`generic:${t.family}`, `「${t.text}」の書体が総称だけ（font-family: ${t.family}）。書体名を指定する`); continue; }
    const { fonts = [] } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const total = fonts.reduce((n, f) => n + f.glyphCount, 0);
    const matches = (f) => f.isCustomFont || named.some((d) => norm(f.familyName).includes(norm(d)) || norm(d).includes(norm(f.familyName)) || norm(f.postScriptName || '').startsWith(norm(d)));
    for (const f of fonts) {
      if (matches(f) || /emoji/i.test(f.familyName)) continue;
      // 記号が数文字だけ別の書体になるのは許す。目に見える量が置き換わったものだけ拾う
      if (f.glyphCount < 3 && f.glyphCount / total < 0.2) continue;
      if (!res.has(`${t.family}>${f.familyName}`)) res.set(`${t.family}>${f.familyName}`, `「${t.text}」の ${f.glyphCount}/${total} 文字が指定外の ${f.familyName} で表示（指定：${named.join(', ')}）`);
    }
  }
  await page.evaluate(() => document.querySelectorAll('[data-fontcheck]').forEach((el) => el.removeAttribute('data-fontcheck')));
  await cdp.detach();
  return [...res.values()].slice(0, 6);
}

for (const item of items) {
  const rel = from ? item.file.replace(/^work\//, `${from}/`) : item.file;
  const file = path.join(jobDir, rel);
  if (!fs.existsSync(file)) { checks.missing.push(`${item.id}: ${rel} がありません`); continue; }
  const url = pathToFileURL(file).href;
  const viewports = item.viewports?.length ? item.viewports : [{ w: 1440, h: 900 }];

  for (const [vi, vp] of viewports.entries()) {
    const tag = `${item.id}@${vp.w}x${vp.h}`;
    const context = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: item.scale ?? 2,
      colorScheme: item.colorScheme ?? 'light',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (item.frames?.length) {
      const last = item.frames[item.frames.length - 1];
      await page.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, last);
    }

    // はみ出し・文字切れ
    const ov = await page.evaluate((fixed) => {
      const res = [];
      const sw = document.documentElement.scrollWidth - window.innerWidth;
      if (sw > 1) res.push(`横に ${sw}px はみ出し`);
      const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      for (const el of document.body.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (fixed && r.width && ownText(el)
            && (r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1 || r.left < -1 || r.top < -1)) {
          res.push(`「${el.textContent.trim().slice(0, 20)}」が枠外`);
        }
        if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && ownText(el)
            && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
          res.push(`「${el.textContent.trim().slice(0, 20)}」が切れている`);
        }
      }
      return [...new Set(res)].slice(0, 8);
    }, !item.fullPage);
    ov.forEach((x) => checks.overflow.push(`${tag}: ${x}`));

    // 最小文字サイズ
    if (minFont > 0) {
      const small = await page.evaluate((min) => {
        const res = [];
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) {
          const t = w.currentNode.textContent.trim();
          const el = w.currentNode.parentElement;
          if (!t || !el) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[aria-hidden="true"], [data-provisional="image"], [data-provisional="copy-needed"]')) continue;
          const size = parseFloat(cs.fontSize);
          if (size < min) res.push(`「${t.slice(0, 16)}」が ${size}px（下限 ${min}px）`);
        }
        return res.slice(0, 5);
      }, minFont);
      small.forEach((x) => checks.minFont.push(`${tag}: ${x}`));
    }

    // リンク切れ（相対リンクの先のファイルがない）。ビューポートごとに同じなので最初の1回だけ
    if (vi === 0) {
      const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
      for (const h of new Set(hrefs)) {
        if (!h || /^(https?:|mailto:|tel:|#|javascript:|data:)/i.test(h)) continue;
        const target = new URL(h, url);
        if (target.protocol !== 'file:') continue;
        const p = fileURLToPath(target);
        const exists = fs.existsSync(p) && (fs.statSync(p).isFile() || fs.existsSync(path.join(p, 'index.html')));
        if (!exists) checks.brokenLinks.push(`${item.id}: リンク先 ${h} がありません`);
      }
      // 書体はビューポートで変わらないので、ここも最初の1回だけ
      try {
        (await fontCheck(context, page)).forEach((x) => checks.fonts.push(`${item.id}: ${x}`));
      } catch (e) { checks.a11y.push(`${tag}: 書体の確認でエラー ${String(e.message).slice(0, 80)}`); }
    }

    // 文字組み（行長は幅で変わるので、ビューポートごとに見る）
    try {
      const tc = await typeCheck(page, ['ui', 'prototype'].includes(medium));
      tc.hard.forEach((x) => checks.type.push(`${tag}: ${x}`));
      if (vi === 0) {
        tc.style.forEach((x) => (dsStrict ? checks.brand : checks.style).push(`${item.id}: ${x}`));
        tc.provisional.forEach((x) => checks.provisional.push(`${item.id}: ${x}`));
      }
    } catch (e) { checks.a11y.push(`${tag}: 文字組みの確認でエラー ${String(e.message).slice(0, 80)}`); }

    // コントラストとアクセシビリティ（axe-core）
    if (AxeBuilder) {
      try {
        const builder = new AxeBuilder({ page });
        if (fullA11y) builder.withTags(['wcag2a', 'wcag2aa']); else builder.withRules(['color-contrast']);
        const res = await builder.analyze();
        for (const v of res.violations) {
          for (const node of v.nodes.slice(0, 5)) {
            const why = (node.failureSummary || '').split('\n').slice(1, 2).join('').trim();
            (v.id === 'color-contrast' ? checks.contrast : checks.a11y).push(`${tag}: [${v.id}] ${node.target.join(' ')} ${why}`);
          }
        }
      } catch (e) { checks.a11y.push(`${tag}: axe 実行エラー ${String(e.message).slice(0, 80)}`); }
    }

    // 撮影
    if (item.frames?.length) {
      for (const t of item.frames) {
        await page.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, t);
        const f = `${tag}-t${t}.png`;
        await page.screenshot({ path: path.join(out, f) });
        lines.push(`- ${f}`);
      }
    } else {
      const f = `${tag}.png`;
      await page.screenshot({ path: path.join(out, f), fullPage: !!item.fullPage });
      lines.push(`- ${f}`);
    }
    if (errors.length) checks.jsErrors.push(`${tag}: ${errors.slice(0, 3).join(' / ')}`);
    await context.close();
  }

  if (item.pdf && !from) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const f = `${item.id}.pdf`;
    await page.pdf({ path: path.join(out, f), width: item.pdf.width, height: item.pdf.height, printBackground: true });
    lines.push(`- ${f}`);
    await context.close();
  }
}

await browser.close();

checks.brokenLinks = [...new Set(checks.brokenLinks)];
if (!AxeBuilder) checks.a11y.push('（@axe-core/playwright が未インストールのためコントラスト検査を省略。pnpm run setup を実行）');
fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2) + '\n');
const section = (title, xs) => `### ${title}\n${xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- なし'}`;
lines.push('', '## 機械チェック（上の7つは1件でもあれば不合格）',
  section('はみ出し・文字切れ', checks.overflow), section('コントラスト不足', checks.contrast),
  section('最小文字サイズ違反', checks.minFont), section('リンク切れ', checks.brokenLinks),
  section('書体の置き換わり・未指定', checks.fonts), section('文字組み', checks.type),
  section('デザインシステムにない色', checks.brand),
  section('トークンにない値（参考）', checks.style), section('仮の画像・仮のコピー・要コピー（納品時に一覧にする）', checks.provisional),
  section('欠落', checks.missing), section('アクセシビリティ（参考）', checks.a11y), section('JS エラー（参考）', checks.jsErrors));
fs.writeFileSync(path.join(out, 'index.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));

if (checks.missing.length) process.exit(1);
