#!/usr/bin/env node
// リニューアル案件の棚卸し。既存サイトを同じドメインの中だけ巡回し、ページごとに撮影と計測をする。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/crawl.mjs --job jobs/<id> --url https://example.com --max 30
// 出力: jobs/<id>/renewal/inventory.json、inventory.md、shots/<n>-<slug>@{1440,390}.png
// クラウド環境では、対象ドメインをネットワーク許可に入れておく必要がある。

import fs from 'node:fs';
import path from 'node:path';
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
const job = opt('--job');
const start = opt('--url');
const max = Number(opt('--max', 30));
if (!job || !start) { console.error('使い方: node ${CLAUDE_PLUGIN_ROOT}/scripts/crawl.mjs --job jobs/<id> --url <URL> [--max 30]'); process.exit(1); }

const outDir = path.join(process.cwd(), job, 'renewal');
const shotDir = path.join(outDir, 'shots');
fs.mkdirSync(shotDir, { recursive: true });

const origin = new URL(start).origin;
const norm = (u) => { const x = new URL(u); x.hash = ''; x.search = ''; return x.href.replace(/\/$/, ''); };
const skip = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|docx?|xlsx?|pptx?)$/i;

const browser = await chromium.launch();
const queue = [{ url: norm(start), depth: 0 }];
const seen = new Set([norm(start)]);
const pages = [];

while (queue.length && pages.length < max) {
  const { url, depth } = queue.shift();
  const n = String(pages.length + 1).padStart(2, '0');
  const slug = (new URL(url).pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'top').slice(0, 40);
  const rec = { n, url, depth, slug };
  try {
    for (const w of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 } });
      const page = await ctx.newPage();
      const t0 = Date.now();
      const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      rec[`load_ms_${w}`] = Date.now() - t0;
      rec.status = res?.status();
      await page.waitForTimeout(800);
      if (w === 1440) {
        Object.assign(rec, await page.evaluate(() => ({
          title: document.title,
          h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).slice(0, 3),
          headings: [...document.querySelectorAll('h2,h3')].map((h) => `${h.tagName}: ${h.textContent.trim().slice(0, 60)}`).slice(0, 30),
          chars: document.body.innerText.length,
          images: document.images.length,
          imagesNoAlt: [...document.images].filter((i) => !i.getAttribute('alt')).length,
          forms: document.forms.length,
          links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
          height: document.documentElement.scrollHeight,
        })));
        if (AxeBuilder) {
          try {
            const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
            rec.a11y = Object.fromEntries(r.violations.map((v) => [v.id, v.nodes.length]));
          } catch {}
        }
        for (const l of rec.links) {
          try {
            const u = norm(l);
            if (u.startsWith(origin) && !skip.test(u) && !seen.has(u) && depth < 3) { seen.add(u); queue.push({ url: u, depth: depth + 1 }); }
          } catch {}
        }
        rec.internalLinks = new Set(rec.links.filter((l) => l.startsWith(origin))).size;
        delete rec.links;
      } else {
        rec.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      }
      await page.screenshot({ path: path.join(shotDir, `${n}-${slug}@${w}.png`), fullPage: true, timeout: 60000 }).catch(() => {});
      await ctx.close();
    }
  } catch (e) {
    rec.error = String(e.message).slice(0, 120);
  }
  pages.push(rec);
  console.log(`${n} ${url} ${rec.error ? 'ERROR ' + rec.error : 'ok'}`);
}
await browser.close();

fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify({ origin, crawled_at: new Date().toISOString(), pages }, null, 2) + '\n');
const md = [
  `# 棚卸し：${origin}`,
  `巡回 ${pages.length} ページ（上限 ${max}、深さ 3 まで）。スクショは renewal/shots/。`,
  '',
  '| # | パス | タイトル | 深さ | 文字数 | 画像（alt なし） | 読込 ms | スマホはみ出し px | a11y 違反 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...pages.map((p) => `| ${p.n} | ${new URL(p.url).pathname} | ${(p.title || p.error || '').slice(0, 30)} | ${p.depth} | ${p.chars ?? ''} | ${p.images ?? ''}（${p.imagesNoAlt ?? ''}） | ${p.load_ms_1440 ?? ''} | ${p.mobileOverflow ?? ''} | ${p.a11y ? Object.values(p.a11y).reduce((a, b) => a + b, 0) : ''} |`),
];
fs.writeFileSync(path.join(outDir, 'inventory.md'), md.join('\n') + '\n');
console.log(`\n${path.join(job, 'renewal', 'inventory.md')} を書きました。`);
