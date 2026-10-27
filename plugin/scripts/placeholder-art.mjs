#!/usr/bin/env node
// 仮の画像を作る。色面を貼り合わせ、紙の質感と線画・点描・格子などを重ねた抽象のコラージュを SVG で描く。
// 何が写っているかを想像させない絵なので、本物の写真と誤解されない。支給素材が届くまでの仮置きに使う。
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/placeholder-art.mjs --part jobs/<id>/<媒体>
//     <part>/images.json の画像ごとに <part>/assets/placeholders/art/<id>.svg を作る（あるものは作り直さない）
//   node ${CLAUDE_PLUGIN_ROOT}/scripts/placeholder-art.mjs --part jobs/<id>/<媒体> --id card-3 --ratio 4:3
//     1枚だけ足す
// 同じ媒体フォルダの中では、構図・色の組・主役の模様が重ならないように選ぶ（使ったものは art/index.json に残る）。
// --force で作り直す。--seed <数> で同じ絵を再現する。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const part = opt('--part');
if (!part) {
  console.error('使い方: placeholder-art.mjs --part <媒体フォルダ> [--id <名前> --ratio 16:9] [--force] [--seed <数>]');
  process.exit(1);
}
const force = args.includes('--force');
const outDir = path.join(part, 'assets', 'placeholders', 'art');
const indexPath = path.join(outDir, 'index.json');
fs.mkdirSync(outDir, { recursive: true });
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : { images: [] };

// 作るものの一覧
let todo;
if (opt('--id')) todo = [{ id: opt('--id'), ratio: opt('--ratio', '16:9') }];
else {
  const p = path.join(part, 'images.json');
  if (!fs.existsSync(p)) { console.error(`${p} がありません。--id と --ratio で1枚ずつ作れます。`); process.exit(1); }
  todo = (JSON.parse(fs.readFileSync(p, 'utf8')).images || []).map((im) => ({ id: im.id, ratio: im.ratio || '16:9' }));
}

// 乱数（シードから再現できるもの）
function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(r.range(lo, hi + 1));
  r.pick = (xs) => xs[Math.floor(r() * xs.length)];
  r.shuffle = (xs) => { const ys = [...xs]; for (let i = ys.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ys[i], ys[j]] = [ys[j], ys[i]]; } return ys; };
  return r;
}

// 色。くすんだ紙の色と、はっきりした色面と、墨
const PAPER = ['#f1e9d6', '#f6f1e7', '#e6dcc6', '#d9c59b', '#cfc8bb'];
const FIELD = ['#c9b8cf', '#7f9466', '#f3d65b', '#f7ec6e', '#d9764e', '#ead2d0', '#a9c0e0', '#7c9fd3', '#22386a', '#5cba5f',
  '#bcd3c9', '#d96a5d', '#1b1b1b', '#e7a9c2', '#e9a94f', '#8a857b'];
const INK = '#1a1a1a';
const DARK = new Set(['#22386a', '#1b1b1b', '#7f9466', '#8a857b']);
const ACCENT = ['#d9453a', '#3fa34d', '#e9b23a', '#2f5fb3'];

const LAYOUTS = ['split', 'split-wide', 'strip', 'quad', 'full', 'hsplit', 'tri'];
const MOTIFS = ['scribble', 'stipple', 'polyhedron', 'dial', 'cells', 'dots', 'cutout', 'arcs', 'shutter', 'stars'];

const f = (n) => Math.round(n * 10) / 10;

// 点を滑らかにつなぐ（Catmull-Rom を3次ベジェにする）
function smooth(pts, closed) {
  const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${f(P[1][0])} ${f(P[1][1])}`;
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

function blobPath(r, cx, cy, rad, n = 9, wobble = 0.35) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = rad * (1 - wobble / 2 + r() * wobble);
    pts.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
  }
  return smooth(pts, true);
}

// 面の分け方
function panels(layout, W, H, r) {
  const t = r.range(0.42, 0.58);
  switch (layout) {
    case 'split': return [[0, 0, W * 0.5, H], [W * 0.5, 0, W * 0.5, H]];
    case 'split-wide': return [[0, 0, W * t, H], [W * t, 0, W * (1 - t), H]];
    case 'strip': { const s = W * r.range(0.74, 0.82); const h = H * r.range(0.35, 0.65); return [[0, 0, s, H], [s, 0, W - s, h], [s, h, W - s, H - h]]; }
    case 'quad': return [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]];
    case 'hsplit': return [[0, 0, W, H * t], [0, H * t, W, H * (1 - t)]];
    case 'tri': return [[0, 0, W / 3, H], [W / 3, 0, W / 3, H], [(W * 2) / 3, 0, W / 3, H]];
    default: return [[0, 0, W, H]];
  }
}

// 模様。どれも抽象で、写真に見えない
function motif(name, r, W, H, ctx) {
  const M = Math.min(W, H);
  const ink = ctx.onDark ? '#f6f1e7' : INK;
  switch (name) {
    case 'scribble': {
      const pts = [];
      let x = r.range(W * 0.2, W * 0.8), y = r.range(H * 0.15, H * 0.4);
      for (let i = 0; i < r.int(9, 14); i++) {
        pts.push([x, y]);
        x = Math.min(W * 1.05, Math.max(-W * 0.05, x + r.range(-M * 0.35, M * 0.35)));
        y = Math.min(H * 1.05, Math.max(-H * 0.05, y + r.range(-M * 0.25, M * 0.3)));
      }
      return `<path d="${smooth(pts, false)}" fill="none" stroke="${ctx.scribbleInk}" stroke-width="${f(M * 0.006)}" stroke-linecap="round"/>`;
    }
    case 'stipple': {
      let s = '';
      for (let b = 0; b < r.int(3, 6); b++) {
        const cx = r.range(W * 0.1, W * 0.9), cy = r.range(H * 0.1, H * 0.9), rad = r.range(M * 0.07, M * 0.16);
        for (let i = 0; i < r.int(140, 260); i++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad * (0.55 + 0.45 * Math.sin(a * 3 + b));
          s += `<circle cx="${f(cx + Math.cos(a) * d * 1.4)}" cy="${f(cy + Math.sin(a) * d)}" r="${f(r.range(M * 0.005, M * 0.011))}"/>`;
        }
      }
      return `<g fill="${ink}">${s}</g>`;
    }
    case 'polyhedron': {
      const cx = r.range(W * 0.3, W * 0.7), cy = r.range(H * 0.35, H * 0.65), rad = M * r.range(0.25, 0.36);
      const n = r.int(9, 14), rx = r.range(0, Math.PI), ry = r.range(0, Math.PI);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, q = Math.sqrt(1 - u * u);
        let [x, y, z] = [q * Math.cos(th), q * Math.sin(th), u];
        [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
        [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
        pts.push([cx + x * rad, cy + y * rad * 0.9, z]);
      }
      let s = '';
      const edges = new Set();
      pts.forEach((p, i) => {
        pts.map((q, j) => [j, Math.hypot(p[0] - q[0], p[1] - q[1])]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 3)
          .forEach(([j]) => edges.add(i < j ? `${i}-${j}` : `${j}-${i}`));
      });
      // 手前の三角を何枚か塗って、立体に見せる
      const front = pts.map((p, i) => [i, p[2]]).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([i]) => i);
      for (let k = 0; k + 2 < front.length; k++) {
        const [a, b, c] = [pts[front[k]], pts[front[k + 1]], pts[front[k + 2]]];
        s += `<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}L${f(c[0])} ${f(c[1])}Z" fill="${k % 3 === 2 ? ink : ctx.onDark ? 'url(#hatch-light)' : 'url(#hatch)'}" opacity="${k % 3 === 2 ? 0.85 : 0.9}"/>`;
      }
      for (const e of edges) { const [i, j] = e.split('-').map(Number); s += `<line x1="${f(pts[i][0])}" y1="${f(pts[i][1])}" x2="${f(pts[j][0])}" y2="${f(pts[j][1])}"/>`; }
      return `<g stroke="${ink}" stroke-width="${f(M * 0.003)}" stroke-linecap="round">${s}</g>`;
    }
    case 'dial': {
      const cx = r.range(W * 0.3, W * 0.7), cy = r.pick([H * 1.05, H * 0.5, H * 0.9]), R = M * r.range(0.45, 0.7);
      let s = '';
      for (const k of [1, 0.86, 0.72, 0.4]) s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * k)}" fill="none"/>`;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2, l = i % 8 === 0 ? 0.72 : i % 4 === 0 ? 0.8 : 0.93;
        s += `<line x1="${f(cx + Math.cos(a) * R * l)}" y1="${f(cy + Math.sin(a) * R * l)}" x2="${f(cx + Math.cos(a) * R)}" y2="${f(cy + Math.sin(a) * R)}"/>`;
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, w = i % 2 ? 0.05 : 0.1;
        s += `<path d="M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a - w) * R * 0.3)} ${f(cy + Math.sin(a - w) * R * 0.3)}L${f(cx + Math.cos(a) * R * 0.72)} ${f(cy + Math.sin(a) * R * 0.72)}Z" fill="${i % 2 ? 'none' : ink}"/>`;
      }
      return `<g stroke="${ink}" stroke-width="${f(M * 0.0025)}">${s}</g>`;
    }
    case 'cells': {
      const [px, py, pw, ph] = ctx.panel, step = M * r.range(0.06, 0.09);
      let s = '';
      for (let x = px + step / 2; x < px + pw; x += step) s += `<line x1="${f(x)}" y1="${py}" x2="${f(x)}" y2="${py + ph}"/>`;
      for (let y = py + step / 2; y < py + ph; y += step) s += `<line x1="${px}" y1="${f(y)}" x2="${px + pw}" y2="${f(y)}"/>`;
      let fills = '';
      const cols = Math.floor(pw / step), rows = Math.floor(ph / step);
      for (let i = 0; i < r.int(1, 4); i++) {
        fills += `<rect x="${f(px + step / 2 + r.int(0, cols - 2) * step)}" y="${f(py + step / 2 + r.int(0, rows - 2) * step)}" width="${f(step)}" height="${f(step)}" fill="${r.pick(ACCENT)}"/>`;
      }
      return `<g stroke="${ink}" stroke-opacity="0.75" stroke-width="${f(M * 0.0018)}">${s}</g>${fills}`;
    }
    case 'dots': {
      const n = r.int(3, 4), y = r.range(H * 0.4, H * 0.6), rad = M * r.range(0.05, 0.07), gap = rad * r.range(2.6, 3.4);
      const x0 = r.range(W * 0.1, W * 0.25), odd = r.int(0, n - 1), base = r.pick(ACCENT);
      let other = r.pick(ACCENT);
      while (other === base) other = r.pick(ACCENT);
      return Array.from({ length: n }, (_, i) => `<circle cx="${f(x0 + i * gap)}" cy="${f(y)}" r="${f(rad)}" fill="${i === odd ? other : base}"/>`).join('');
    }
    case 'cutout': {
      const cx = r.range(W * 0.45, W * 0.75), cy = r.range(H * 0.4, H * 0.6), rad = M * r.range(0.32, 0.45);
      const crack = [];
      let x = cx + rad * 0.5, y = -10;
      while (y < H + 10) { crack.push([x, y]); x += r.range(-M * 0.03, M * 0.03); y += r.range(M * 0.03, M * 0.07); }
      return `<path d="${blobPath(r, cx, cy, rad, 7, 0.45)}" fill="#fbf8f1"/>`
        + `<path d="${blobPath(r, cx - rad * 0.15, cy, rad * 0.42, 6, 0.3)}" fill="${ctx.color}"/>`
        + `<path d="M${crack.map(([a, b]) => `${f(a)} ${f(b)}`).join('L')}" fill="none" stroke="${INK}" stroke-width="${f(M * 0.003)}"/>`;
    }
    case 'arcs': {
      let s = '';
      for (let i = 0; i < r.int(2, 3); i++) {
        s += `<circle cx="${f(r.range(-W * 0.1, W * 1.1))}" cy="${f(r.range(H * 0.2, H * 0.8))}" r="${f(M * r.range(0.35, 0.6))}" fill="none"/>`;
      }
      return `<g stroke="${ink}" stroke-width="${f(M * 0.003)}">${s}</g>`;
    }
    case 'shutter': {
      const [px, py, pw, ph] = ctx.panel, gap = M * r.range(0.018, 0.03);
      const x1 = px + pw * 0.12, x2 = px + pw * 0.88;
      let s = `<rect x="${f(x1)}" y="${f(py + ph * 0.1)}" width="${f(x2 - x1)}" height="${f(ph * 0.8)}" fill="#f3f1ec"/>`;
      for (let y = py + ph * 0.12; y < py + ph * 0.88; y += gap) s += `<line x1="${f(x1)}" y1="${f(y)}" x2="${f(x2)}" y2="${f(y)}" stroke="#9a978f" stroke-width="${f(gap * 0.35)}"/>`;
      return s;
    }
    case 'stars': {
      let s = '';
      for (let i = 0; i < r.int(8, 14); i++) {
        const cx = r.range(0, W), cy = r.range(0, H), R = M * r.range(0.015, 0.06);
        s += `<path d="M${f(cx)} ${f(cy - R)}Q${f(cx)} ${f(cy)} ${f(cx + R)} ${f(cy)}Q${f(cx)} ${f(cy)} ${f(cx)} ${f(cy + R)}Q${f(cx)} ${f(cy)} ${f(cx - R)} ${f(cy)}Q${f(cx)} ${f(cy)} ${f(cx)} ${f(cy - R)}Z"/>`;
      }
      return `<g fill="${ink}">${s}</g>`;
    }
    default: return '';
  }
}

// 1枚描く。sig は「構図・色の組・主役の模様」。同じ媒体フォルダで重ならないように選ぶ
function compose(seed, W, H, used) {
  const r = rng(seed);
  const usedMotifs = used.map((u) => u.motif);
  const fresh = MOTIFS.filter((m) => !usedMotifs.includes(m));
  const main = r.pick(fresh.length ? fresh : MOTIFS);
  const lastLayout = used.length ? used[used.length - 1].layout : null;
  const layout = r.pick(LAYOUTS.filter((l) => l !== lastLayout && (l !== 'tri' || W >= H * 1.2)));
  const ps = panels(layout, W, H, r);
  const colors = [];
  const pool = r.shuffle([...FIELD, ...PAPER]);
  for (const p of ps) colors.push(pool.find((c) => !colors.includes(c)) || r.pick(FIELD));
  if (!colors.some((c) => PAPER.includes(c)) && r() < 0.6) colors[r.int(0, colors.length - 1)] = r.pick(PAPER);
  const big = ps.reduce((a, p, i) => (p[2] * p[3] > ps[a][2] * ps[a][3] ? i : a), 0);
  // 主役の面が小さい構図（4分割・3分割）で暗い色だと、模様が面に押し込まれて小さく窮屈になる。明るい面と入れ替える
  if (ps[big][2] * ps[big][3] < W * H * 0.4 && DARK.has(colors[big])) {
    const j = colors.findIndex((c) => !DARK.has(c));
    if (j >= 0) [colors[big], colors[j]] = [colors[j], colors[big]];
    else colors[big] = r.pick(PAPER.filter((c) => !colors.includes(c)));
  }
  const sig = `${layout}|${[...colors].sort().join(',')}|${main}`;

  const tex = ['none', 'mottle', 'halftone', 'grid', 'dotgrid'];
  let body = '';
  ps.forEach(([x, y, w, h], i) => {
    body += `<rect x="${f(x)}" y="${f(y)}" width="${f(w + 1)}" height="${f(h + 1)}" fill="${colors[i]}"/>`;
    const t = i === big ? r.pick(['none', 'mottle']) : r.pick(tex);
    if (t === 'mottle') body += `<rect x="${f(x)}" y="${f(y)}" width="${f(w + 1)}" height="${f(h + 1)}" filter="url(#mottle)" opacity="0.55"/>`;
    else if (t !== 'none') body += `<rect x="${f(x)}" y="${f(y)}" width="${f(w + 1)}" height="${f(h + 1)}" fill="url(#${t})"/>`;
  });
  const onDark = DARK.has(colors[big]);
  const ctx = { panel: ps[big], color: colors[big], onDark, scribbleInk: onDark ? '#f6f1e7' : PAPER.includes(colors[big]) ? INK : r.pick([INK, '#fbf8f1']) };
  // 暗い面に明るい線で描くときは、その面を1枚の画面とみなして中に収める（明るい面で消えず、面の境目で切れないように）
  // 明るい面に描いた墨の線が、脇の暗い面にかかるところは、同じ形を明るい色に置き換えて重ねる
  const [bx, by, bw, bh] = ps[big];
  const darkSide = ps.filter((_, i) => DARK.has(colors[i]));
  const lighten = (s) => s.replaceAll(INK, '#f6f1e7').replaceAll('url(#hatch)', 'url(#hatch-light)');
  const draw = (name) => {
    if (onDark) return `<g clip-path="url(#big)"><g transform="translate(${f(bx)} ${f(by)})">${motif(name, r, bw, bh, { ...ctx, panel: [0, 0, bw, bh] })}</g></g>`;
    const m = motif(name, r, W, H, ctx);
    return darkSide.length ? `<g clip-path="url(#lit)">${m}</g><g clip-path="url(#unlit)">${lighten(m)}</g>` : m;
  };
  body += draw(main);
  // 脇役を1つ足すことがある。主役が軽いときは、描き込みの多いものを必ず足して、間が抜けないようにする
  const light = ['stars', 'arcs', 'dots'].includes(main);
  if (light) body += draw(r.pick(['stipple', 'dial', 'polyhedron']));
  else if (r() < 0.45 && !['scribble', 'cells', 'shutter'].includes(main)) {
    body += draw(r.pick(['scribble', 'arcs', 'stars', 'stipple'].filter((m) => m !== main)));
  }

  const M = Math.min(W, H);
  const hatchTurn = r.int(20, 70);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<clipPath id="lit">${ps.filter((_, i) => !DARK.has(colors[i])).map(([x, y, w, h]) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w + 1)}" height="${f(h + 1)}"/>`).join('')}</clipPath>
<clipPath id="unlit">${darkSide.map(([x, y, w, h]) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w + 1)}" height="${f(h + 1)}"/>`).join('')}</clipPath>
<clipPath id="big"><rect x="${f(ps[big][0])}" y="${f(ps[big][1])}" width="${f(ps[big][2])}" height="${f(ps[big][3])}"/></clipPath>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 1000}"/><feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 0 0.07  0 0 0 0.55 -0.18"/></filter>
<filter id="mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${f((0.004 + r() * 0.01) * 1000) / 1000}" numOctaves="4" seed="${(seed >> 3) % 1000}"/><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.22  0 0 0 0 0.18  0 0 0 0.9 -0.35"/></filter>
<pattern id="halftone" width="${f(M * 0.016)}" height="${f(M * 0.016)}" patternUnits="userSpaceOnUse"><circle cx="${f(M * 0.008)}" cy="${f(M * 0.008)}" r="${f(M * 0.004)}" fill="${INK}" opacity="0.35"/></pattern>
<pattern id="dotgrid" width="${f(M * 0.03)}" height="${f(M * 0.03)}" patternUnits="userSpaceOnUse"><circle cx="${f(M * 0.015)}" cy="${f(M * 0.015)}" r="${f(M * 0.0022)}" fill="${INK}" opacity="0.45"/></pattern>
<pattern id="grid" width="${f(M * 0.05)}" height="${f(M * 0.05)}" patternUnits="userSpaceOnUse"><path d="M${f(M * 0.05)} 0V${f(M * 0.05)}H0" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="${f(M * 0.0015)}"/></pattern>
<pattern id="hatch" width="${f(M * 0.012)}" height="${f(M * 0.012)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${hatchTurn})"><line x1="0" y1="0" x2="0" y2="${f(M * 0.012)}" stroke="${INK}" stroke-width="${f(M * 0.004)}"/></pattern>
<pattern id="hatch-light" width="${f(M * 0.012)}" height="${f(M * 0.012)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${hatchTurn})"><line x1="0" y1="0" x2="0" y2="${f(M * 0.012)}" stroke="#f6f1e7" stroke-width="${f(M * 0.004)}"/></pattern>
</defs>
${body}
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.6"/>
</svg>
`;
  return { svg, sig, layout, motif: main };
}

function size(ratio) {
  const [a, b] = String(ratio).split(/[:/x]/).map(Number);
  if (!(a > 0 && b > 0)) return [1600, 900];
  return a >= b ? [1600, Math.round((1600 * b) / a)] : [Math.round((1600 * a) / b), 1600];
}

const made = [];
for (const { id, ratio } of todo) {
  const file = path.join(outDir, `${id}.svg`);
  if (fs.existsSync(file) && !force) continue;
  index.images = index.images.filter((u) => u.id !== id);
  const [W, H] = size(ratio);
  let pick;
  for (let tries = 0; tries < 60; tries++) {
    const seed = opt('--seed') ? Number(opt('--seed')) : crypto.randomInt(1, 2 ** 31);
    pick = { seed, ...compose(seed, W, H, index.images) };
    if (opt('--seed') || !index.images.some((u) => u.sig === pick.sig)) break;
  }
  fs.writeFileSync(file, pick.svg);
  index.images.push({ id, ratio, seed: pick.seed, sig: pick.sig, layout: pick.layout, motif: pick.motif });
  made.push(`${id}.svg（${ratio}、${pick.layout} / ${pick.motif}）`);
}
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(made.length ? `仮の画像を作りました（${outDir}）:\n- ${made.join('\n- ')}` : '作るものはありませんでした（作り直すときは --force）');
