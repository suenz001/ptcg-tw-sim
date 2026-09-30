#!/usr/bin/env node
/**
 * v6.453 守衛：picker／UI 統一化的剩餘項目（站長 2026-09-30：「還沒做的進行處理」）
 *
 *   ① 手機撤退改開父層共用的「選擇換入的寶可夢」（與補位同一種卡片格子）——手機不再有自己的一份撤退 sheet
 *   ② 宣告對手棄權的確認視窗：全站唯一的白底 ⇒ 改成深色系統視窗；點遮罩不關閉；「再等等」在左、「確定獲勝」在右
 *   ③ 設定面板：寫了沒生效的 500px ⇒ 收進三級寬度的 M（760）
 *   ④ 視窗層級（z-index）刻度寫成單一說明表（盤點無倒置）
 *   ⑤ mutcheck-v6390 M16 錨點修好（lib 重構後突變打不到）
 *
 * 每條判準寫成 (src) => boolean，同時餵目前原始碼（必須全成立）與 v6.452（標 headFail 的必須不成立）。
 * Run: node scripts/test-v6453-picker-leftovers.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleBlockOf } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = { p: 'src/routes/game/+page.svelte', m: 'src/routes/game/MobilePortraitBattle.svelte', mc: 'scripts/mutcheck-v6390-scroll-list.mjs' };
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
const CUR = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, rd(f)]));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.452。
const BASE_SHA = '058174820badce141d22e589658450cfb97a9dab';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const css = (src) => { try { return styleBlockOf(src).replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
function declsOf(c, sel) {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(c))) if (m[1].split(',').map((x) => x.trim()).includes(sel)) out.push(m[2]);
  return out.join(';');
}

const CHECKS = [
  ['★★★[①撤退] 手機的撤退鈕改開父層共用撤退選單；手機元件沒有自己的撤退 sheet', true, ({ p, m }) =>
    m.includes('action: () => { closeSheet(); onOpenRetreat(); },') && !/pick-retreat-target|retreatTo\(/.test(m)
    && p.includes('onOpenRetreat={() => { floatingRetreatMenu = { x: innerWidth / 2, y: innerHeight / 2 }; }}')],
  ['[①前提] 父層撤退選單就是 promoteGrid 那一份（v6.451），送出中不能按', false, ({ p }) =>
    p.includes('{@render promoteGrid(myPlayer.bench, null, (iid) => { dispatch(GameActions.retreat(iid)); floatingRetreatMenu = null; }, actionBusy)}')],
  ['[①前提] 手機的附能量／進化目標 sheet 照舊（mp-pick-card 仍在用）', false, ({ m }) =>
    (m.match(/<div class="mp-pick-card">/g) || []).length >= 2],
  ['★★★[②棄權] 棄權確認改深色系統視窗（不再白底）', true, ({ p }) => {
    const d = declsOf(css(p), '.forfeit-modal');
    return /background: #1a1a2e/.test(d) && /border: 2px solid #dc2626/.test(d) && !/background: #fff/.test(d);
  }],
  ['★★[②棄權] 點遮罩不關閉；「再等等」在左、「確定獲勝」在右', true, ({ p }) =>
    p.includes('<div class="forfeit-modal-backdrop" role="presentation">') && !p.includes('<div class="forfeit-modal-backdrop" onclick=')
    && /order: -1/.test(declsOf(css(p), '.forfeit-cancel')) && /justify-content: space-between/.test(declsOf(css(p), '.forfeit-actions'))],
  ['[②前提] 兩顆按鈕的行為沒變（確定＝confirmClaimForfeit、再等等＝關閉）', false, ({ p }) =>
    p.includes('<button class="forfeit-confirm" onclick={confirmClaimForfeit}>確定獲勝</button>') && p.includes('<button class="forfeit-cancel" onclick={() => showForfeitConfirm = false}>再等等</button>')],
  ['★★[③設定] 設定面板收進 M（760）（原本寫了沒生效的 500px 保留原狀，test-v6285 在守）', true, ({ p }) => {
    const d = declsOf(css(p), ':where(.zoom-modal).settings-modal');
    return /--pk-w:var\(--pk-m\)/.test(d) && /max-width:min\(var\(--pk-w\), calc\(100vw - 32px\)\)/.test(d);
  }],
  ['★[④層級] 視窗層級刻度說明表在 v6449-picker-shell 裡', true, ({ p }) =>
    /視窗層級（z-index）刻度[\s\S]{0,600}＜ 100 選擇視窗[\s\S]{0,200}＜ 200 檢視視窗[\s\S]{0,300}＜ 10000 系統詢問/.test(p)],
  ['[④前提] 選擇視窗 100 ＜ 檢視視窗 200 ＜ 棄權確認 2000 ＜ 系統詢問 10000（刻度描述與實際一致）', false, ({ p }) => {
    const c = css(p);
    const z = (sel) => Number((/z-index:\s*(\d+)/.exec(declsOf(c, sel)) || [])[1]);
    return z('.selection-overlay') === 100 && z('.zoom-overlay') === 200 && z('.forfeit-modal-backdrop') === 2000
      && z('.notify-prompt-overlay') === 10000;
  }],
  ['★★[⑤突變] mutcheck-v6390 M16 改突變 svelte-style-block.mjs 的 styleTagIndex（錨點存在）', true, ({ mc }) =>
    mc.includes("S: join(ROOT, 'scripts/lib/svelte-style-block.mjs'),") && mc.includes("{ S: (s) => s.replace('  const i = s.lastIndexOf(OPEN);', '  const i = s.indexOf(OPEN);') },")
    && rd('scripts/lib/svelte-style-block.mjs').includes('  const i = s.lastIndexOf(OPEN);')],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到三個檔案', CUR.p.length > 900000 && CUR.m.length > 50000 && CUR.mc.length > 3000);
for (const c of runAll(CUR)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.452');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6453 B：HEAD-FAIL 比對', '需要 v6.452 commit');
} else {
  const base = {}; let allOk = true;
  for (const [k, f] of Object.entries(FILES)) { const r = readBaseBlob(ROOT, BASE_SHA, f); if (!r.ok) allOk = false; else base[k] = r.out.replace(/\r\n/g, '\n'); }
  ok('[前提] 讀得到 v6.452 的三個檔案', allOk);
  if (allOk) {
    const res = runAll(base);
    const wrongPass = res.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.452 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
    const ctlFail = res.filter((c) => !c.headFail && !c.r).map((c) => c.name);
    ok('[正對照] 非 headFail 的結構前提在 v6.452 就成立', ctlFail.length === 0, ctlFail.join(' ｜ '));
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !CUR.p.includes('DEV-SHOT-HOOK') && !CUR.p.includes('__devShot') && !CUR.p.includes('__devUI') && !CUR.p.includes('__devPre'));

console.log(`\n=== v6.453 picker 剩餘項目: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6453-picker-leftovers ===');
process.exit(fail ? 1 : 0);
