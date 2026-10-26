#!/usr/bin/env node
// html_to_figma が返した1回限りのアップロード URL に、書き出した HTML を POST する。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/post-to-figma.mjs <upload-url> jobs/<id>/figma/export/<id>@<w>x<h>.html
// レスポンス（ファイル URL と作成されたノード ID）を表示し、同じ案件の figma/receipts/ に保存する。

import fs from 'node:fs';
import path from 'node:path';

const [url, file] = process.argv.slice(2);
if (!url || !file) {
  console.error('使い方: node ${CLAUDE_PLUGIN_ROOT}/scripts/post-to-figma.mjs <upload-url> <html-file>');
  process.exit(1);
}
if (!/^https:\/\/([a-z0-9-]+\.)*figma\.com\//.test(url)) {
  console.error(`figma.com 以外の URL には送りません: ${url}`);
  process.exit(1);
}

const body = fs.readFileSync(file);
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body });
const text = await res.text();

const receiptsDir = path.join(path.dirname(path.dirname(file)), 'receipts'); // jobs/<id>/figma/receipts
fs.mkdirSync(receiptsDir, { recursive: true });
const receipt = path.join(receiptsDir, path.basename(file, '.html') + '.json');
fs.writeFileSync(receipt, text);

console.log(`HTTP ${res.status}`);
console.log(text.slice(0, 4000));
console.log(`保存: ${receipt}`);
if (!res.ok) process.exit(1);
