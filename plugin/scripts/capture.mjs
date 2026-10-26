#!/usr/bin/env node
// 参考にする Web ページのファーストビューを撮る。審美眼の種まき（studio-init）で使う。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs --url https://example.com --out .loop/taste-seed/refs/example
// 出力: <out>@1440.png（1440x900）と <out>@390.png（390x844）。--full を付けるとページ全体。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// playwright は使う側のリポジトリに入れたものを読む（プラグインの置き場所には node_modules がない）
const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = (() => {
  try { return projectRequire('playwright'); } catch {
    console.error('playwright がこのリポジトリに入っていません。tanren の studio-init を実行するか、playwright と @axe-core/playwright を devDependencies に入れてください。');
    process.exit(1);
  }
})();

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt('--url', null);
const out = opt('--out', null);
if (!url || !out) { console.error('使い方: node ${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs --url <URL> --out <保存先（拡張子なし）> [--full]'); process.exit(1); }
const full = args.includes('--full');

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const browser = await chromium.launch();
const done = [];
for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  } catch {
    // networkidle にならないサイトもあるので、読み込みが終わっていれば撮る
    await page.waitForLoadState('load').catch(() => {});
  }
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(800);
  const file = `${out}@${vp.w}.png`;
  await page.screenshot({ path: file, fullPage: full });
  done.push(file);
  await context.close();
}
await browser.close();
console.log(done.join('\n'));
