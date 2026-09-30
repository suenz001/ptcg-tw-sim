#!/usr/bin/env node
/**
 * v6.447 守衛：新版桌墊（blue）裡所有卡背統一成藍色（站長回報：發牌動畫是紅色卡背）
 *
 *   抽牌／發牌飛卡（.draw-fly-back）、取獎賞動畫（.prize-pick-back）、獎賞檢視、觀戰手牌、setup 蓋牌
 *   都是同一個 .card-back（v6.420 站長裁定「唯一一份紅色圓形卡背」）；新版桌墊把牌庫／獎賞都畫成藍色卡背，
 *   所以在新版桌墊裡整個 .battle-root 的 .card-back 改藍、不畫「?」。其他版面仍是紅色。
 *   （另有雲端 Playwright 實測：開局發牌時 .draw-fly-card .card-back 的背景＝藍色條紋、? 為 display:none。）
 *
 * Run: node scripts/test-v6447-blue-card-back-everywhere.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.446。
const BASE_SHA = '63b9548910c4296c5a95c669f2552e626f14b597';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function blueCss(src) {
  const m = /\/\* >>> v6441-blue-css \*\/([\s\S]*?)\/\* <<< v6441-blue-css \*\//.exec(src);
  return (m ? m[1] : '').replace(/\/\*[\s\S]*?\*\//g, '');
}
function declsOf(css, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) if (m[1].split(',').map((x) => x.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
}
function peekCode(src) {
  const m = /    \/\/ >>> v6443-blue-peek\n([\s\S]*?)    \/\/ <<< v6443-blue-peek\n/.exec(src);
  return m ? m[1].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n') : '';
}
function enterAttCardBody(src) {
  const i = src.indexOf('  function enterAttCard(');
  const j = src.indexOf('  function leaveAttCard(', i);
  return i > 0 && j > i ? src.slice(i, j) : '';
}

const CHECKS = [
  ['★★★ 新版桌墊整個 .battle-root 的 .card-back 都用藍色卡背（含 playmat 外的發牌／取獎賞浮層）', true, (src) =>
    /#2a57c4/.test(declsOf(blueCss(src), '.battle-root:has(.playmat.layout-blue) .card-back'))],
  ['★★ 新版桌墊整個 .battle-root 的卡背都不畫「?」', true, (src) =>
    /display:none/.test(declsOf(blueCss(src), '.battle-root:has(.playmat.layout-blue) .card-back .card-back-mark'))],
  ['[特異度] 前提：發牌／取獎賞卡背的紅色背景規則是單一 class（0,1,0），低於 .battle-root:has(.playmat.layout-blue) .card-back（0,4,0）', false, (src) =>
    /\n  \.draw-fly-back\{/.test(src) && /\n  \.prize-pick-back\{/.test(src)],
  ['[前提] 發牌飛卡浮層用的是 .card-back（且在 .battle-root 內，已由雲端實測確認）', false, (src) =>
    src.includes('<div class="card-back draw-fly-back"><span class="card-back-mark">?</span></div>') && src.includes('<div class="card-back prize-pick-back"><span class="card-back-mark">?</span></div>')],
  ['[範圍] 其他版面的紅色卡背規則仍在（.card-back 全域紅色圓形卡背未動）', false, (src) =>
    src.includes('  .card-back{ background:radial-gradient(circle at 50% 50%, #f0f4ff 0 12%, #ffffff 12% 14%, #1a1a1a 14% 18%, #c0392b 18% 50%, #922b21 50% 100%);')],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、找得到藍桌墊 CSS', SRC.length > 900000 && blueCss(SRC).length > 5000);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.446');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6447 B：HEAD-FAIL 比對', '需要 v6.446 commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.446 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    const base = runAll(r.out.replace(/\r\n/g, '\n'));
    const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.446 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
    const ctlFail = base.filter((c) => !c.headFail && !c.r && !/哨兵內只有/.test(c.name)).map((c) => c.name);
    ok('[正對照] 非 headFail 的結構前提在 v6.446 就成立（markup 沒被本版動到）', ctlFail.length === 0, ctlFail.join(' ｜ '));
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot'));

console.log(`\n=== v6.447 新版桌墊卡背統一: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6447-blue-card-back-everywhere ===');
process.exit(fail ? 1 : 0);
