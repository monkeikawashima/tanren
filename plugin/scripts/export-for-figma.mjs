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
//   - ブラウザが実際に折り返している位置に <br> を入れる（html_to_figma は文節改行・<wbr> を再現しないため）
//   - <select> を、閉じた状態の見た目の箱に置き換える（Figma で中身が崩れるため）
//   - file:// の画像と CSS は、ブラウザ側で読めなかった分も最後に Node 側で data URI に埋め込む

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

// file:// のページから、同じフォルダの CSS（cssRules）と画像（fetch）を読めるようにする
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
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

      // 1.5 折り返しを <br> で焼き込む。改行の入る要素は幅を固定して、Figma で縮んで折り返し位置が変わらないようにする
      {
        const isBlock = (el) => { const dsp = getComputedStyle(el).display; return !dsp.startsWith('inline') || ['inline-block', 'inline-flex', 'inline-grid'].includes(dsp); };
        const blockOf = (n) => { let e = n.parentElement; while (e && !isBlock(e)) e = e.parentElement; return e; };
        const last = new Map();
        const inserts = [];
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        let n;
        while ((n = tw.nextNode())) {
          if (n.nodeType === 1) { if (n.tagName === 'BR') last.set(blockOf(n), null); continue; }
          const pe = n.parentElement;
          if (!pe || pe.closest('script,style,textarea,select,option,svg,[aria-hidden="true"]')) continue;
          if (getComputedStyle(pe).whiteSpace.startsWith('pre')) continue;
          const blk = blockOf(n);
          const r = document.createRange();
          for (let i = 0; i < n.data.length; i++) {
            r.setStart(n, i); r.setEnd(n, i + 1);
            const rc = r.getClientRects()[0];
            if (!rc || (rc.width === 0 && /\s/.test(n.data[i]))) continue;
            const prev = last.get(blk);
            if (prev && rc.top > prev.top + rc.height * 0.5 && rc.left < prev.left) inserts.push([n, i]);
            last.set(blk, { top: rc.top, left: rc.left });
          }
        }
        const frozen = new Map();
        for (const [node] of inserts) { const bl = blockOf(node); if (bl && !frozen.has(bl)) frozen.set(bl, bl.getBoundingClientRect().width); }
        for (const [bl, wd] of frozen) Object.assign(bl.style, { boxSizing: 'border-box', width: `${wd}px`, maxWidth: 'none', flexShrink: '0' });
        for (let k = inserts.length - 1; k >= 0; k--) {
          const [node, i] = inserts[k];
          const br = document.createElement('br');
          if (i === 0) node.parentNode.insertBefore(br, node); else { const tail = node.splitText(i); tail.parentNode.insertBefore(br, tail); }
        }
        document.querySelectorAll('wbr').forEach((e) => e.remove());
        document.body.normalize();
        // <select> を閉じた見た目の箱に
        document.querySelectorAll('select').forEach((sel) => {
          const cs = getComputedStyle(sel);
          const box = document.createElement('div');
          box.className = sel.className;
          box.setAttribute('role', 'combobox');
          for (const pr of ['width', 'height', 'padding-left', 'padding-top', 'padding-bottom', 'border', 'border-radius', 'background-color', 'color', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'font-family', 'box-sizing']) box.style.setProperty(pr, cs.getPropertyValue(pr));
          Object.assign(box.style, { backgroundImage: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '16px' });
          const label = document.createElement('span');
          label.textContent = sel.options[sel.selectedIndex]?.text ?? '';
          box.appendChild(label);
          box.insertAdjacentHTML('beforeend', `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${cs.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`);
          sel.replaceWith(box);
        });
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
    fs.writeFileSync(path.join(outDir, name), inlineLeftovers(html));
    const kb = Math.round(Buffer.byteLength(html) / 1024);
    written.push(`- ${path.relative(cwd, path.join(outDir, name))}（${kb} KB）`);
    if (kb > 45 * 1024) console.error(`注意: ${name} が 45MB を超えています（html_to_figma の上限は 50MB）`);
    await context.close();
  }
}

await browser.close();
console.log(written.join('\n'));

// ブラウザ側で埋め込めなかった file:// の CSS と画像を、Node 側で埋め込む（Figma は file:// を読めない）
function inlineLeftovers(html) {
  const mime = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  const local = (href) => { try { const p = fileURLToPath(href); return fs.existsSync(p) ? p : null; } catch { return null; } };
  html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="(file:\/\/[^"]+)"[^>]*>/g, (m, href) => {
    const p = local(href);
    return p ? `<style data-inlined="${path.basename(p)}">${fs.readFileSync(p, 'utf8')}</style>` : m;
  });
  return html.replace(/(src|href)="(file:\/\/[^"]+)"|url\(\s*['"]?(file:\/\/[^'")]+)['"]?\s*\)/g, (m, attr, a, u) => {
    const p = local(a || u);
    const type = p && mime[path.extname(p).toLowerCase()];
    if (!type) return m;
    const data = `data:${type};base64,${fs.readFileSync(p).toString('base64')}`;
    return attr ? `${attr}="${data}"` : `url("${data}")`;
  });
}
