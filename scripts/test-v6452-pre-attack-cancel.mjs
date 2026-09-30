#!/usr/bin/env node
/**
 * v6.452 守衛：攻擊前的「數字」與「是／否」視窗補上「取消出招」（站長 2026-09-30 裁定：採用建議）
 *
 *   按了回到出招前（這回合還能做別的事），與攻擊前選能量的視窗一致；避免手滑按錯招式就非出不可。
 *   ① 兩個視窗各有一顆「取消出招」，呼叫既有的 cancelPreAttackDiscard（只清掉 preAttackDiscard，不送任何動作）
 *   ② 排在按鈕列最左（「否」是招式的一個選項、會照樣出招，排在它右邊）
 *
 * 每條判準寫成 (src) => boolean，同時餵目前原始碼（必須全成立）與 v6.451（標 headFail 的必須不成立）。
 * Run: node scripts/test-v6452-pre-attack-cancel.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleBlockOf } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.451。
const BASE_SHA = '59b1a4fa3e26fb8fa81a82a32934ceca4b3f70fb';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const css = (src) => { try { return styleBlockOf(src).replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
function between(src, a, b) { const i = src.indexOf(a); if (i < 0) return ''; const j = src.indexOf(b, i + a.length); return j > i ? src.slice(i, j) : ''; }
const preStepper = (p) => between(p, "{#if preAttackDiscard && game && preDiscardModalKind(preAttackDiscard.spec.scope) === 'stepper'}", '\n  {/if}\n');
const preBinary = (p) => between(p, "{#if preAttackDiscard && game && preDiscardModalKind(preAttackDiscard.spec.scope) === 'binary'}", '\n  {/if}\n');
const CANCEL = '<button class="btn-act secondary pre-attack-cancel" title="不使用這個招式，回到出招前（這回合還能做別的事）" onclick={cancelPreAttackDiscard}>取消出招</button>';

const CHECKS = [
  ['★★★[①stepper] 攻擊前數字視窗有「取消出招」（在按鈕列裡）', true, (p) => {
    const b = preStepper(p); return b.includes('<div class="sel-footer">\n          ' + CANCEL);
  }],
  ['★★★[①是否] 攻擊前是否視窗有「取消出招」（與是／否同一個按鈕列）', true, (p) => {
    const b = preBinary(p); const f = b.indexOf('<div class="sel-footer">');
    return f > 0 && b.indexOf(CANCEL, f) > f && (b.match(/pre-attack-cancel/g) || []).length === 1;
  }],
  ['★★[①行為] cancelPreAttackDiscard 只清掉 preAttackDiscard、不送出任何動作', false, (p) =>
    /  function cancelPreAttackDiscard\(\) \{\n    preAttackDiscard = null;\n  \}\n/.test(p)],
  ['★★[②排序] 「取消出招」排在最左（特異度要贏過次要鈕的 order:-1）；警告列仍獨佔第一行', true, (p) => {
    const c = css(p);
    return /\.sel-footer > \.btn-act\.secondary\.pre-attack-cancel\{ order:-3; \}/.test(c) && /\.sel-footer > \.sel-hint-warn\{ order:-4;/.test(c);
  }],
  ['[前提] 「否」仍然照樣出招（送空陣列），「是」仍送 yes-token', false, (p) => {
    const b = preBinary(p);
    return b.includes('dispatch(GameActions.attack(ai, [], cc, ccChain));') && b.includes("dispatch(GameActions.attack(ai, ['yes-token'], cc, ccChain));");
  }],
  ['[前提] 攻擊前選能量的視窗本來就有取消（這次是補齊另外兩種）', false, (p) =>
    p.includes('<button class="btn-act secondary" onclick={cancelPreAttackDiscard}>取消</button>')],
];

function runAll(src) { return CHECKS.map(([name, headFail, fn]) => { let r = false; try { r = !!fn(src); } catch { r = false; } return { name, headFail, r }; }); }

console.log('A) 目前的原始碼：每一條判準都成立');
ok('[前提] 讀得到對戰頁、抓得到兩個攻擊前視窗', SRC.length > 900000 && preStepper(SRC).length > 800 && preBinary(SRC).length > 1500);
for (const c of runAll(SRC)) ok(c.name, c.r);

console.log('\nB) HEAD-FAIL：同一批判準餵 v6.451');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6452 B：HEAD-FAIL 比對', '需要 v6.451 commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 v6.451 的對戰頁', r.ok);
  if (r.ok) {
    const base = runAll(r.out.replace(/\r\n/g, '\n'));
    const wrongPass = base.filter((c) => c.headFail && c.r).map((c) => c.name);
    ok('★★★[HEAD-FAIL] 標 headFail 的判準在 v6.451 全部不成立', wrongPass.length === 0, wrongPass.join(' ｜ '));
    const ctlFail = base.filter((c) => !c.headFail && !c.r).map((c) => c.name);
    ok('[正對照] 非 headFail 的結構前提在 v6.451 就成立', ctlFail.length === 0, ctlFail.join(' ｜ '));
  }
}

console.log('\nC) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot') && !SRC.includes('__devUI') && !SRC.includes('__devPre'));

console.log(`\n=== v6.452 攻擊前視窗補取消: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6452-pre-attack-cancel ===');
process.exit(fail ? 1 : 0);
