#!/usr/bin/env node
// 合格した HTML を、Figma の html_to_figma にそのまま渡せる「1ファイル・ビューポート固定」の HTML に変換する。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/export-for-figma.mjs                 … 案件は .loop/state.json の job
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/export-for-figma.mjs --job jobs/<id>
// 出力: jobs/<id>/figma/export/<id>@<w>x<h>.html
//
// html_to_figma は外部リソースを取りに行かず、メディアクエリも書き出し側の幅で判定できないため、
//   - ビューポートごとにメディアクエリを解決して平らな CSS にする
//   - 画像と CSS 背景画像を data URI に埋め込む
//   - アニメーションは最終フレーム（manifest.frames の最後）で止めて、値をインラインに書き込む
//   - script タグを外す（見た目は DOM に焼き込み済み）

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// playwright と axe は使う側のリポジトリに入れたものを読む（プラグインの置き場所には node_modules がない）
const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = (() => {
  try { return projectRequire('playwright'); } catch {
    console.error('playwright がこのリポジトリに入っていません。tanren の studio-init を実行するか、playwright と @axe-core/playwright を devDependencies に入れてください。');
    process.exit(1);
  }
})();

const cwd = process.cwd();
const args = process.argv.slice(2);
const ji = args.indexOf('--job');
const state = (() => { try { return JSON.parse(fs.readFileSync(path.join(cwd, '.loop', 'state.json'), 'utf8')); } catch { return {}; } })();
const job = ji >= 0 ? args[ji + 1] : state.job;
if (!job) { console.error('案件が分かりません。--job jobs/<id> を付けてください。'); process.exit(1); }
const root = path.resolve(cwd, job); // 以降のパスは案件フォルダ基準
const { items = [] } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'figma', 'export');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const written = [];

for (const item of items) {
  const file = path.join(root, item.file);
  if (!fs.existsSync(file)) { console.error(`なし: ${item.file}`); process.exitCode = 1; continue; }
  const viewports = item.viewports?.length ? item.viewports : [{ w: 1440, h: 900 }];

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: item.colorScheme ?? 'light' });
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const lastFrame = item.frames?.length ? item.frames[item.frames.length - 1] : null;

    const html = await page.evaluate(async ({ w, h, fullPage, lastFrame }) => {
      const toDataURL = async (url) => {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
        } catch { return url; }
      };

      // 1. アニメーションを止め、動いているプロパティの現在値をインラインに焼き込む
      if (lastFrame !== null) {
        for (const a of document.getAnimations()) { a.pause(); a.currentTime = lastFrame; }
      }
      for (const a of document.getAnimations()) {
        const el = a.effect?.target;
        if (!el) continue;
        const cs = getComputedStyle(el);
        const props = new Set();
        for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) {
          if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p);
        }
        for (const p of props) el.style[p] = cs[p];
      }

      // 2. CSS をビューポートで解決して平らにする（同一オリジン分だけ。Google Fonts などの外部 link は残す）
      const flatten = (rules) => {
        let out = '';
        for (const r of rules) {
          if (r instanceof CSSMediaRule) { if (matchMedia(r.media.mediaText).matches) out += flatten(r.cssRules); }
          else if (r instanceof CSSSupportsRule) { if (CSS.supports(r.conditionText)) out += flatten(r.cssRules); }
          else if (r instanceof CSSImportRule) { try { out += flatten(r.styleSheet.cssRules); } catch {} }
          else out += r.cssText + '\n';
        }
        return out;
      };
      let css = '';
      const keepLinks = [];
      for (const s of [...document.styleSheets]) {
        try { css += flatten(s.cssRules); }
        catch { if (s.href) keepLinks.push(s.href); }
      }
      // CSS 内の url() を data URI に
      const urls = [...new Set([...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:') && !u.startsWith('#')))];
      for (const u of urls) {
        const abs = new URL(u, document.baseURI).href;
        if (!abs.startsWith('file:')) continue; // 外部フォント等はそのまま
        css = css.split(u).join(await toDataURL(abs));
      }

      // 3. img を data URI に
      for (const img of document.querySelectorAll('img')) {
        if (img.src && !img.src.startsWith('data:')) img.src = await toDataURL(img.src);
        img.removeAttribute('srcset');
      }

      // 4. 元のスタイルと script を外して、平らにした CSS を1つだけ入れる
      document.querySelectorAll('style, link[rel="stylesheet"], script').forEach((n) => n.remove());
      for (const href of keepLinks) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
      }
      const freeze = `
*,*::before,*::after{animation:none!important;transition:none!important}
html,body{width:${w}px!important;min-width:${w}px!important}
${fullPage ? '' : `html,body{height:${h}px!important;overflow:hidden!important}`}`;
      const st = document.createElement('style');
      st.textContent = css + freeze;
      document.head.appendChild(st);
      if (!document.querySelector('meta[charset]')) {
        const m = document.createElement('meta'); m.setAttribute('charset', 'utf-8'); document.head.prepend(m);
      }
      return '<!doctype html>\n' + document.documentElement.outerHTML;
    }, { w: vp.w, h: vp.h, fullPage: !!item.fullPage, lastFrame });

    const name = `${item.id}@${vp.w}x${vp.h}.html`;
    fs.writeFileSync(path.join(outDir, name), html);
    const kb = Math.round(Buffer.byteLength(html) / 1024);
    written.push(`- ${path.relative(cwd, path.join(outDir, name))}（${kb} KB）`);
    if (kb > 45 * 1024) console.error(`注意: ${name} が 45MB を超えています（html_to_figma の上限は 50MB）`);
    await context.close();
  }
}

await browser.close();
console.log(written.join('\n'));
