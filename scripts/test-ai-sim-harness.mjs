// 守衛：AI 對戰量尺（scripts/lib/ai-sim-harness.mjs）本身不可以量錯（批次 A，2026-09-26）。
//
// 為什麼要守量尺：之後每一批 AI 改動都拿這把尺當否決依據。尺歪了，否決就失效，而且不會有人發現。
//   ① 勝負原因分類：平手一律以 winner 判定。引擎有兩種平手字串含「取得所有獎賞卡」子字串，
//      只比字串會把平手算成「取得所有獎賞卡」（批次 A 初版真的踩到）。
//   ② 掃描 engine.ts 所有 winReason 字面：每一種有勝負的原因都必須落在已知分類，
//      不可以默默掉進「其他」——新增一種終局原因時這條會紅，逼人回來更新量尺。
//   ③ nextAction：setup 階段優先者回 null 時必須改問另一方（舊版固定問 0 ⇒ 約 25% 局被誤判卡住）。
//   ④ Wilson 區間與兩比例 z 的數值正確（對照手算值）。
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReason, nextAction, wilson, twoPropZ, REASON_CLASSES } from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// ── ① 平手判定以 winner 為準 ────────────────────────────────────────────────
const ended = (reason, winner) => ({ outcome: 'ended', reason, winner });
ok(classifyReason(ended('雙方同時取得所有獎賞卡，且雙方皆可放置戰鬥寶可夢', null)) === 'draw',
  '① 「雙方同時取得所有獎賞卡」是平手，不可以算成取得所有獎賞卡');
ok(classifyReason(ended('A 取得所有獎賞卡，但同時沒有可上場的寶可夢', null)) === 'draw',
  '① 「取得所有獎賞卡，但同時沒有可上場的寶可夢」是平手');
ok(classifyReason(ended('雙方皆沒有可上場的寶可夢', null)) === 'draw', '① 雙方皆沒有寶可夢是平手');
ok(classifyReason(ended('A 取得所有獎賞卡', 0)) === 'prizes', '① 正對照：有勝方的取完獎賞');
ok(classifyReason(ended('B 沒有可上場的寶可夢', 0)) === 'no-pokemon', '① 正對照：沒有可上場的寶可夢');
ok(classifyReason(ended('B 牌組耗盡，無法抽牌', 0)) === 'deck-out', '① 正對照：牌組耗盡');
ok(classifyReason({ outcome: 'stuck_loop', reason: null, winner: null }) === 'unfinished', '① 未結束');
ok(new Set(REASON_CLASSES.map(([k]) => k)).size === REASON_CLASSES.length, '① 分類鍵不可重複');

// ── ② engine.ts 的每一種有勝負終局原因都要落在已知分類 ─────────────────────
// 只取 winReason: `...` 與 reason: `...`／'...' 裡含「寶可夢／獎賞／牌組／棄權／離開」的字面
// （engine 的 reason 欄位也用在免疫原因，那些不是終局，用關鍵字排除）。
const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
const lits = new Set();
for (const m of src.matchAll(/\b(?:winReason|reason):\s*(`[^`]*`|'[^']*')/g)) {
  const raw = m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, 'X');
  if (/可上場的寶可夢|取得所有獎賞卡|牌組耗盡|棄權|先行離開/.test(raw)) lits.add(raw);
}
ok(lits.size >= 4, `② 掃描器下限：只掃到 ${lits.size} 種終局字串，掃描器可能壞了`);
// 線上限定（AI 對 AI 模擬不會出現），允許歸「其他」
const ONLINE_ONLY = /棄權|先行離開/;
const DRAW_LITERALS = new Set([
  '雙方皆沒有可上場的寶可夢',
  '雙方同時取得所有獎賞卡，且雙方皆可放置戰鬥寶可夢',
  'X 取得所有獎賞卡，但同時沒有可上場的寶可夢',
]);
for (const r of lits) {
  if (DRAW_LITERALS.has(r)) { ok(classifyReason(ended(r, null)) === 'draw', `② 平手字串 ${r}`); continue; }
  if (ONLINE_ONLY.test(r)) continue;
  const c = classifyReason(ended(r, 0));
  ok(c !== 'other', `② 終局原因「${r}」落進「其他」——量尺要新增這一類（或它其實是平手，請加進 DRAW_LITERALS）`);
}
// 已知三種平手字串要真的還在 engine 裡（否則 DRAW_LITERALS 是死條目）
for (const d of DRAW_LITERALS) ok(lits.has(d), `② 平手字串「${d}」已不在 engine.ts，請更新本守衛`);

// ── ③ setup 階段的行動者退路 ────────────────────────────────────────────────
const setupSt = { phase: 'setup', pendingMulliganDraw: [0, 0], setupDone: [true, true],
  players: [{ active: {} }, { active: {} }] };
const calls = [];
const agents = [
  (st, i) => { calls.push(i); return null; },                          // 0 已無事可做
  (st, i) => { calls.push(i); return { type: 'CONFIRM_MULLIGAN_REVEAL', senderIdx: 1 }; },
];
const r3 = nextAction(setupSt, agents);
ok(r3.actor === 1 && r3.act?.type === 'CONFIRM_MULLIGAN_REVEAL', '③ 0 回 null 時必須改問 1');
ok(calls.join(',') === '0,1', '③ 先問優先者（0），再問另一方');
// 反面：playing 階段回 null 不可以亂改問另一方（那是真的卡住，要被偵測到）
const playSt = { phase: 'playing', pendingSelection: null, activePlayerIndex: 0,
  players: [{ active: {}, bench: [] }, { active: {}, bench: [] }] };
const r3b = nextAction(playSt, [() => null, () => ({ type: 'END_TURN' })]);
ok(r3b.act === null && r3b.actor === 0, '③ playing 階段回 null 要原樣回報（不可掩蓋卡住）');

// ── ④ 數值 ───────────────────────────────────────────────────────────────────
// 手算：w=50, n=100 ⇒ Wilson 95% = [0.4038, 0.5962]
const [lo, hi] = wilson(50, 100);
ok(Math.abs(lo - 0.4038) < 1e-3 && Math.abs(hi - 0.5962) < 1e-3, `④ Wilson(50,100) = [${lo}, ${hi}]`);
// 手算：60/100 → 40/100，合併 p=0.5，se=√(0.25×0.02)=0.0707 ⇒ z=−2.828
ok(Math.abs(twoPropZ(60, 100, 40, 100) + 2.828) < 1e-2, '④ twoPropZ 顯著下降');
ok(twoPropZ(50, 100, 50, 100) === 0, '④ 相同比例 z=0');

console.log(`✅ test-ai-sim-harness：${pass} 條全數通過（掃到 ${lits.size} 種終局字串）`);
