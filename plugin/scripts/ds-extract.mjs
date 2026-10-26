#!/usr/bin/env node
// 既存の Web サイトで実際に使われている色・書体・文字サイズ・角丸を数える。デザインシステムの取り込み（website）で使う。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-extract.mjs --url https://example.com [--url …] --out .loop/ds-import/website.json
// 出力の値は、サイトから読み取った推定（inferred）として扱う。多く使われている順に並ぶ。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// playwright は使う側のリポジトリに入れたものを読む（プラグインの置き場所には node_modules がない）
const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = (() => {
  try { return projectRequire('playwright'); } catch {
    console.error('playwright がこのリポジトリに入っていません。tanren の studio-init を実行するか、playwright を devDependencies に入れてください。');
    process.exit(1);
  }
})();

const args = process.argv.slice(2);
const urls = args.flatMap((a, i) => (a === '--url' ? [args[i + 1]] : []));
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : null;
if (!urls.length || !out) { console.error('使い方: node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-extract.mjs --url <URL> [--url <URL>] --out <保存先.json>'); process.exit(1); }

const total = { text: {}, background: {}, border: {}, font: {}, fontSize: {}, radius: {} };
const add = (bucket, k, n) => { if (k) total[bucket][k] = (total[bucket][k] || 0) + n; };

const browser = await chromium.launch();
for (const url of urls) {
  for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try { await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }); } catch { await page.waitForLoadState('load').catch(() => {}); }
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const r = await page.evaluate(() => {
      const res = [];
      const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      // ページの地の色は html と body にあることが多いので、それも数える
      for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll('*')]) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const t = ownText(el);
        res.push({
          chars: t.length,
          area: Math.round(b.width * b.height),
          color: cs.color,
          bg: /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) ? null : cs.backgroundColor,
          border: parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : null,
          font: cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''),
          size: cs.fontSize,
          radius: parseFloat(cs.borderTopLeftRadius) > 0 ? cs.borderTopLeftRadius : null,
        });
      }
      return res;
    });
    for (const x of r) {
      if (x.chars) { add('text', x.color, x.chars); add('font', x.font, x.chars); add('fontSize', x.size, x.chars); }
      add('background', x.bg, x.area);
      add('border', x.border, 1);
      add('radius', x.radius, 1);
    }
    await context.close();
  }
}
await browser.close();

const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, weight]) => ({ value, weight }));
const result = {
  urls, extracted_at: new Date().toISOString(), status: 'inferred',
  text: top(total.text, 8), background: top(total.background, 8), border: top(total.border, 6),
  font: top(total.font, 5), fontSize: top(total.fontSize, 12), radius: top(total.radius, 6),
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(`保存: ${out}\n文字色 ${result.text.length}・背景 ${result.background.length}・書体 ${result.font.map((f) => f.value).join(' / ')}`);
