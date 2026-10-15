#!/usr/bin/env node
/**
 * v6.570 守衛：暱稱與某張卡名「一字不差」時，退回舊行為——照樣是卡片連結（站長 2026-10-15 裁定：
 *   「第 1 項改 一字不差時退回舊行為」）。
 *   背景：v6.569 讓暱稱不拆成卡片連結；但紀錄裡大部分卡名是純文字（帶 iid 標記的只有少數），
 *   暱稱＝卡名（例：「噴火龍ex」）時分不出哪一處是人、哪一處是卡 ⇒ 那張卡在紀錄裡會點不開。
 *   取捨：寧可玩家名稱也能點（舊行為），也不要讓卡片點不開。暱稱「含」卡名（我的噴火龍）仍照 v6.569 保護。
 *
 *   X1 一字不差 ⇒ 兩處都是連結（舊行為）
 *   X2 含卡名的暱稱仍保護（v6.569 行為不退）
 *   X3 一位一字不差、一位只是含卡名 ⇒ 各自照規則
 *   X4 卡名集合快取：同一份清單只建一次 Set；換一份清單（例：卡池載入完）立刻用新的
 *   【H】BASE（v6.569）：X1、X3 紅；X2 零回歸綠
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.569。
const BASE_SHA = '270303c095bb725c0b9883ee235b17b315322a67';
const LF = 'src/lib/game/log_format.ts';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

async function loadLib(src) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6570-'));
  try {
    const f = join(tmp, 'lf.ts'); writeFileSync(f, src);
    const o = join(tmp, 'o.mjs');
    await build({ entryPoints: [f], outfile: o, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    return await import(pathToFileURL(o).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
const CARDS = ['噴火龍ex', '皮卡丘ex', '噴火龍', '皮卡丘', '伊布'].sort((a, b) => b.length - a.length);
const links = (toks) => toks.filter((t) => t.cls === 'log-card-link').map((t) => t.text);

function scen(L) {
  const r = {};
  if (!L || typeof L.tokenizeLogMessage !== 'function') return r;
  const tk = (m, names, cards = CARDS) => L.tokenizeLogMessage(m, cards, names);
  const a = tk('噴火龍ex 派出了 噴火龍ex', ['噴火龍ex', '小明']);
  r.X1 = JSON.stringify(links(a)) === '["噴火龍ex","噴火龍ex"]';
  r.X1n = JSON.stringify(links(a));
  const b = tk('我的噴火龍 派出了 噴火龍', ['我的噴火龍', '小明']);
  r.X2 = JSON.stringify(links(b)) === '["噴火龍"]';
  r.X2n = JSON.stringify(links(b));
  const c = tk('伊布 對 我的皮卡丘 使用 皮卡丘ex', ['伊布', '我的皮卡丘']);
  r.X3 = JSON.stringify(links(c)) === '["伊布","皮卡丘ex"]';
  r.X3n = JSON.stringify(links(c));
  // X4：同一份清單重複呼叫結果一致；換一份清單（多了「阿響」這張卡）⇒ 暱稱「阿響」此時一字不差 ⇒ 必須是連結
  //   （快取若黏住第一份清單，阿響 會被當成一般暱稱保護 ⇒ 紅）
  const c2 = tk('伊布 對 我的皮卡丘 使用 皮卡丘ex', ['伊布', '我的皮卡丘']);
  const other = ['皮卡丘ex', '阿響'];
  const d = tk('阿響 使用 皮卡丘ex', ['阿響', '小明'], other);
  r.X4 = JSON.stringify(links(c2)) === JSON.stringify(links(c)) && JSON.stringify(links(d)) === '["阿響","皮卡丘ex"]';
  r.X4n = JSON.stringify({ c2: links(c2), d: links(d) });
  // X5（審查 P3-1）：暱稱存成帶空白的「 噴火龍ex 」⇒ 去空白後一字不差 ⇒ 照樣是連結（不可以拿去空白前的字串比卡名）
  const e = tk('噴火龍ex 派出了 噴火龍ex', [' 噴火龍ex ', '小明']);
  r.X5 = JSON.stringify(links(e)) === '["噴火龍ex","噴火龍ex"]';
  r.X5n = JSON.stringify(links(e));
  return r;
}
const LABEL = {
  X1: '★★★ X1 暱稱與卡名一字不差（噴火龍ex）：紀錄裡兩處都是卡片連結（站長裁定：退回舊行為）',
  X2: '★★★ X2 暱稱只是含卡名（我的噴火龍）：仍照 v6.569 不拆成連結（零回歸）',
  X3: '★★ X3 兩位玩家各自照規則（一位一字不差、一位含卡名）',
  X4: '★★ X4 卡名集合依清單建立：同清單結果一致、換清單立刻生效（快取不會黏住舊清單）',
  X5: '★★ X5 帶前後空白的暱稱去空白後一字不差 ⇒ 照樣是連結',
};
const ZERO = new Set(['X2']);
const R = scen(await loadLib(normEol(readFileSync(join(ROOT, LF), 'utf8'))));
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);

console.log('【H】HEAD-FAIL（BASE v6.569）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6570 HEAD-FAIL', '需要歷史 commit');
else {
  const bb = readBaseBlob(ROOT, BASE_SHA, LF);
  const B = scen(await loadLib(bb.ok ? normEol(bb.out) : ''));
  for (const k of Object.keys(LABEL)) {
    if (ZERO.has(k)) ok(`★★[正對照] v6.569：${k} 在 BASE 上也是綠`, B[k] === true, B[k + 'n']);
    else ok(`★★★[H] v6.569：${k} 紅`, B[k] !== true, B[k + 'n']);
  }
}
console.log(`\n=== v6.570 暱稱與卡名一字不差時照樣是卡片連結：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
