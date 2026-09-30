#!/usr/bin/env node
/**
 * v6.451 守衛：picker／UI 統一化第 5 步——重複的程式合併（站長 2026-09-30 裁定）
 *
 *   ① 撤退選單改用補位的 promoteGrid（原本各抄一份一模一樣的卡片格子）
 *   ② 三套 stepper 合一：攻擊前 stepper、重抽補抽 stepper 都用 modal-choice 的 stepper class
 *   ③ 攻擊前的 stepper／是否視窗不再用 inline style，按鈕走共用樣式與共用按鈕列
 *   ④ 賽事通知詢問與悔棋請求共用一份系統視窗外框（只留強調色不同）
 *   ⑤ 手機不再有自己的棄牌 sheet，改用父層共用的棄牌區視窗（手機直式時是底部 sheet）
 *
 * 每條判準寫成 (src) => boolean，同時餵目前原始碼（必須全成立）與 v6.450（標 headFail 的必須不成立）。
 * Run: node scripts/test-v6451-picker-dedupe.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleBlockOf } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const REL_M = 'src/routes/game/MobilePortraitBattle.svelte';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
const CUR = { p: rd(REL), m: rd(REL_M) };
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.450。
const BASE_SHA = 'bf19000c280108c4e6ad3bafd1b121f1f8b6656e';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const css = (src) => { try { return styleBlockOf(src).replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
function between(src, a, b) { const i = src.indexOf(a); if (i < 0) return ''; const j = src.indexOf(b, i + a.length); return j > i ? src.slice(i, j) : ''; }
const preStepper = (p) => between(p, "{#if preAttackDiscard && game && preDiscardModalKind(preAttackDiscard.spec.scope) === 'stepper'}", '{/if}\n\n');
const preBinary = (p) => between(p, "{#if preAttackDiscard && game && preDiscardModalKind(preAttackDiscard.spec.scope) === 'binary'}", '\n  {/if}\n');
const retreatMenu = (p) => between(p, '<h3>🔄 選擇換入的寶可夢</h3>', '<div class="sel-footer">');

const CHECKS = [
  ['★★★[①撤退] 撤退選單改用 promoteGrid（送出中不能按）', true, ({ p }) =>
    /\{@render promoteGrid\(myPlayer\.bench, null, \(iid\) => \{ dispatch\(GameActions\.retreat\(iid\)\); floatingRetreatMenu = null; \}, actionBusy\)\}/.test(retreatMenu(p))
    && !/\{#each myPlayer\.bench as b\}/.test(retreatMenu(p))],
  ['★★[①撤退] promoteGrid 多一個 busy 參數（預設 false ⇒ 補位行為不變）', true, ({ p }) =>
    p.includes('{#snippet promoteGrid(bench: any[], pick: string | null, onPick: (iid: string) => void, busy: boolean = false)}')
    && p.includes('<button class="retreat-pick" disabled={busy} onclick={(e)=>{e.stopPropagation();onPick(b.iid);}}>')],
  ['★★★[②stepper] 攻擊前 stepper 用共用 class（modal-choice-stepper／stepper-btn／stepper-value／stepper-confirm）', true, ({ p }) => {
    const b = preStepper(p);
    return b.includes('<div class="modal-choice-stepper">') && (b.match(/class="stepper-btn stepper-(minus|plus)"/g) || []).length === 2
      && b.includes('<div class="stepper-value">{currentN}</div>') && b.includes('<button class="btn-act primary stepper-confirm"');
  }],
  ['★★[②stepper] 重抽補抽 stepper 也用共用 class，.mulligan-stepper 規則移除', true, ({ p }) =>
    !p.includes('class="mulligan-stepper"') && !/\.mulligan-stepper/.test(css(p))
    && /<div class="modal-choice-stepper">\n\s*<button class="stepper-btn stepper-minus"\n\s*disabled=\{pickCount <= 0\}/.test(p)],
  ['★★★[③inline] 攻擊前 stepper／是否視窗沒有任何 inline style、沒有 sel-actions、沒有 btn-ghost', true, ({ p }) => {
    const s = preStepper(p) + preBinary(p);
    return s.length > 2000 && !/ style="/.test(s) && !s.includes('sel-actions') && !s.includes('btn-ghost');
  }],
  ['★★[③按鈕列] 是否視窗：是＝主要、否＝次要，放在共用按鈕列', true, ({ p }) => {
    const b = preBinary(p);
    return b.includes('<div class="sel-footer">\n          <button class="btn-act primary"\n') && b.includes('<button class="btn-act secondary"\n');
  }],
  ['[③前提] 是否視窗的兩顆按鈕仍各自送出 yes-token／空陣列（行為沒變）', false, ({ p }) => {
    const b = preBinary(p);
    return b.includes("dispatch(GameActions.attack(ai, ['yes-token'], cc, ccChain));") && b.includes('dispatch(GameActions.attack(ai, [], cc, ccChain));');
  }],
  ['★★[④系統視窗] 通知詢問與悔棋請求共用一份外框，悔棋只改強調色', true, ({ p }) => {
    const c = css(p);
    return /\.notify-prompt-modal,\s*\.undo-request-modal\s*\{[^}]*border: 2px solid var\(--sys-accent\)/.test(c)
      && /\.notify-prompt-overlay,\s*\.undo-modal-overlay\s*\{/.test(c)
      && /\.undo-request-modal \{ --sys-accent: #f59e0b;/.test(c)
      && !/border: 2px solid #f59e0b/.test(c) && !/border: 2px solid #4a9eff/.test(c);
  }],
  ['★★★[⑤棄牌區] 手機元件沒有自己的棄牌清單，兩顆棄牌按鈕接到父層共用視窗', true, ({ p, m }) =>
    !/groupDiscardList|sheet\.type === 'discard'|mp-discard/.test(m.replace(/\/\*[\s\S]*?\*\//g, ''))
    && m.includes("onclick={() => onOpenDiscard('opp')}") && m.includes("onclick={() => onOpenDiscard('me')}")
    && p.includes("onOpenDiscard={(who) => { viewDiscardFor = who === 'me' ? myIdx : oppIdx; }}")],
  ['[⑤前提] 父層棄牌區視窗仍在（手機直式時由 v6450-picker-sheet 變成底部 sheet）', false, ({ p }) =>
    p.includes('<div class="zoom-modal discard-modal" use:modalDrag={{ resetKey: viewDiscardFor }}')],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁與手機元件', CUR.p.length > 900000 && CUR.m.length > 50000);
for (const c of runAll(CUR)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.450');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6451 B：HEAD-FAIL 比對', '需要 v6.450 commit');
} else {
  const rp = readBaseBlob(ROOT, BASE_SHA, REL), rm = readBaseBlob(ROOT, BASE_SHA, REL_M);
  ok('[前提] 讀得到 v6.450 的兩個檔案', rp.ok && rm.ok);
  if (rp.ok && rm.ok) {
    const base = runAll({ p: rp.out.replace(/\r\n/g, '\n'), m: rm.out.replace(/\r\n/g, '\n') });
    const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.450 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
    const ctlFail = base.filter((c) => !c.headFail && !c.r).map((c) => c.name);
    ok('[正對照] 非 headFail 的結構前提在 v6.450 就成立', ctlFail.length === 0, ctlFail.join(' ｜ '));
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !CUR.p.includes('DEV-SHOT-HOOK') && !CUR.p.includes('__devShot') && !CUR.p.includes('__devUI'));

console.log(`\n=== v6.451 picker 重複程式合併: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6451-picker-dedupe ===');
process.exit(fail ? 1 : 0);
