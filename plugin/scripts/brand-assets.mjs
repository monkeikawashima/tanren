#!/usr/bin/env node
// 参考サイト（依頼者の既存サイトなど）から、案件の最初に素材と事実の出典を集める。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/brand-assets.mjs --url https://example.com --out jobs/<id>/<媒体>/references/site
// 出力（--out の中）:
//   text.txt              ページの全文（下までスクロールして遅延表示も出してから取る）。コピーと事実の出典にする
//   fv@1440.png・fv@390.png・full@1440.png   ファーストビューとページ全体
//   style.json            本文と見出しの書体、文字色・背景色・よく使われる色の上位
//   logo-N.svg            ヘッダーのロゴ（インラインの SVG なら、そのまま取り出す）
//   graphics/g-NN.png（.svg）  キャラクター・図・イラストなど、ページ固有の絵。背景を透過して切り出す
//                          （小さな SVG を並べたドット絵や canvas も、親ごと1枚にする）
//   index.md              何を取ったかの一覧。director と designer が読む
// 依頼者自身のブランド資産（ロゴ・キャラクター）を最初から使えるようにして、
// 「本家の縮小版に見える」まま磨きが止まるのを防ぐ。他社のサイトから取ったものは参考にだけ使い、成果物に載せない。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = (() => {
  try { return projectRequire('playwright'); } catch {
    console.error('playwright がこのリポジトリに入っていません。tanren の studio-init を実行するか、playwright を devDependencies に入れてください。');
    process.exit(1);
  }
})();

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt('--url');
const out = opt('--out');
if (!url || !out) { console.error('使い方: node brand-assets.mjs --url <URL> --out <保存先フォルダ>'); process.exit(1); }
const outDir = path.resolve(out);
fs.mkdirSync(path.join(outDir, 'graphics'), { recursive: true });

const browser = await chromium.launch();
const open = async (w, h, scale = 1) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  try { await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch { await page.waitForLoadState('load').catch(() => {}); }
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(1200);
  return { ctx, page };
};
const lines = [`# 参考サイトの素材（${url}）`, '', `取得：${new Date().toISOString()}`, ''];

// 1. ファーストビュー（390 と 1440）
{
  const { ctx, page } = await open(390, 844);
  await page.screenshot({ path: path.join(outDir, 'fv@390.png') });
  await ctx.close();
}
const { ctx, page } = await open(1440, 900);
await page.screenshot({ path: path.join(outDir, 'fv@1440.png') });

// 2. 下までスクロールして遅延表示を出し、全文と全体を取る
await page.evaluate(async () => {
  for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(600);
const text = await page.evaluate(() => document.body.innerText);
fs.writeFileSync(path.join(outDir, 'text.txt'), text);
await page.screenshot({ path: path.join(outDir, 'full@1440.png'), fullPage: true }).catch(() => {});
lines.push('- text.txt：ページの全文（コピーと事実はここにあるものだけ使う）', '- fv@1440.png・fv@390.png・full@1440.png：見た目の出典');

// 3. 書体と色
const style = await page.evaluate(() => {
  const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const c = getComputedStyle(el); return { font: c.fontFamily, size: c.fontSize, weight: c.fontWeight, color: c.color }; };
  const count = new Map();
  for (const el of document.querySelectorAll('body *')) {
    const c = getComputedStyle(el);
    for (const v of [c.color, c.backgroundColor, c.borderTopColor]) if (v && !/rgba\(0, 0, 0, 0\)|transparent/.test(v)) count.set(v, (count.get(v) || 0) + 1);
  }
  return { body: pick('body'), h1: pick('h1'), h2: pick('h2'), button: pick('a[class*=button], button, [class*=cta]'), background: getComputedStyle(document.body).backgroundColor, colors: [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) };
});
fs.writeFileSync(path.join(outDir, 'style.json'), JSON.stringify(style, null, 2) + '\n');
lines.push('- style.json：本文・見出し・ボタンの書体と色、よく使われる色の上位');

// 4. ロゴ（ヘッダーの中の最初の SVG・画像）
const logos = await page.evaluate(() => {
  const head = document.querySelector('header') || document.body;
  const out = [];
  for (const el of head.querySelectorAll('a svg, svg, a img, img')) {
    const r = el.getBoundingClientRect();
    if (r.top > 160 || r.width < 16 || r.height < 8) continue;
    if (el.tagName.toLowerCase() === 'svg') {
      const c = el.cloneNode(true);
      c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const color = getComputedStyle(el).color;
      out.push({ svg: c.outerHTML.replace(/currentColor/g, color) });
    } else out.push({ src: el.currentSrc || el.src });
    if (out.length >= 2) break;
  }
  return out;
});
logos.forEach((l, i) => {
  if (l.svg) { fs.writeFileSync(path.join(outDir, `logo-${i + 1}.svg`), l.svg); lines.push(`- logo-${i + 1}.svg：ヘッダーのロゴ`); }
  else if (l.src) lines.push(`- ロゴは画像（${l.src}）。必要なら支給を頼む`);
});
await ctx.close();

// 5. ページ固有の絵（キャラクター・図・イラスト）。高解像度で開き直して、背景を透過して切り出す
{
  const { ctx: c2, page: p2 } = await open(1440, 900, 3);
  await p2.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  });
  const found = await p2.evaluate(() => {
    const seen = new Set();
    const items = [];
    const big = (r) => r.width >= 24 && r.height >= 24 && r.width <= 1600 && r.height <= 1600;
    const inHeader = (el) => !!el.closest('header, nav, footer, button, a[class*=button]');
    // 小さな SVG を並べた絵（ドット絵など）は親ごと1枚にする
    for (const svg of document.querySelectorAll('svg')) {
      const parent = svg.parentElement;
      if (!parent || seen.has(parent)) continue;
      const kids = [...parent.children];
      if (kids.length >= 4 && kids.every((k) => k.tagName.toLowerCase() === 'svg')) {
        seen.add(parent);
        const r = parent.getBoundingClientRect();
        if (big(r) && !inHeader(parent)) items.push({ el: parent, kind: 'group', r });
      }
    }
    for (const el of document.querySelectorAll('svg, canvas')) {
      if ([...seen].some((g) => g.contains(el)) || inHeader(el)) continue;
      const r = el.getBoundingClientRect();
      if (!big(r)) continue;
      // アイコン（単色の小さな線画）は飛ばす：48px 未満でパスが少ないもの
      if (el.tagName.toLowerCase() === 'svg' && r.width < 48 && el.querySelectorAll('path, rect, circle').length < 3) continue;
      items.push({ el, kind: el.tagName.toLowerCase(), r });
    }
    return items.slice(0, 40).map((it, i) => {
      it.el.setAttribute('data-brand-asset', String(i));
      const svg = it.kind === 'svg' ? (() => { const c = it.el.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); return c.outerHTML.replace(/currentColor/g, getComputedStyle(it.el).color); })() : null;
      const label = it.el.getAttribute('aria-label') || it.el.closest('[aria-label]')?.getAttribute('aria-label') || it.el.querySelector('title')?.textContent || '';
      return { i, kind: it.kind, w: Math.round(it.r.width), h: Math.round(it.r.height), y: Math.round(it.r.top + window.scrollY), svg, label: label.slice(0, 80) };
    });
  });
  // 背景を透過して絵だけを切り出す（ページや区画の地色を外す。svg の塗りと canvas はそのまま）
  await p2.addStyleTag({ content: 'html,body,body *:not(svg):not(svg *){background:transparent!important;box-shadow:none!important}' });
  const hashes = new Set();
  let k = 0;
  for (const g of found) {
    const loc = p2.locator(`[data-brand-asset="${g.i}"]`).first();
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
      const buf = await loc.screenshot({ omitBackground: true, timeout: 5000 });
      // 何も描かれていない（アニメーションの非表示のコマなど）・同じ絵の重複は捨てる
      const key = crypto.createHash('sha1').update(buf).digest('hex');
      if (buf.length < 600 || hashes.has(key)) continue;
      hashes.add(key);
      const n = String(++k).padStart(2, '0');
      fs.writeFileSync(path.join(outDir, 'graphics', `g-${n}.png`), buf);
      if (g.svg && g.svg.length < 400000) fs.writeFileSync(path.join(outDir, 'graphics', `g-${n}.svg`), g.svg);
      lines.push(`- graphics/g-${n}.png${g.svg ? '（.svg も）' : ''}：${g.kind}、${g.w}x${g.h}px、ページの上から ${g.y}px${g.label ? `、「${g.label}」` : ''}`);
    } catch {}
  }
  await c2.close();
}

await browser.close();
lines.push('', '依頼者自身のサイトなら、ロゴとキャラクターは支給素材として使ってよい（元データの支給があれば差し替える）。他社のサイトなら参考にだけ使い、成果物に載せない。');
fs.writeFileSync(path.join(outDir, 'index.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
