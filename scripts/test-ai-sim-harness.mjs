// 守衛：AI 對戰量尺（scripts/lib/ai-sim-harness.mjs）本身不可以量錯（批次 A，2026-09-26）。
//
// 為什麼要守量尺：之後每一批 AI 改動都拿這把尺當否決依據。尺歪了，否決就失效，而且不會有人發現。
//   ① 勝負原因分類：平手一律以 winner 判定。引擎有兩種平手字串含「取得所有獎賞卡」子字串，
//      只比字串會把平手算成「取得所有獎賞卡」（批次 A 初版真的踩到）。
//   ② 掃描 engine.ts 所有 winReason 字面：每一種有勝負的原因都必須落在已知分類，
//      不可以默默掉進「其他」——新增一種終局原因時這條會紅，逼人回來更新量尺。
//   ③ nextAction：setup 階段優先者回 null 時必須改問另一方（舊版固定問 0 ⇒ 約 25% 局被誤判卡住）。
//   ④ Wilson 區間與兩比例 z 的數值正確（對照手算值）。
//   ⑤ 可重現性（每局歸零 ai-eval 的 _simSeed）與指定先攻真的生效（fable 複審追加）。
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReason, nextAction, wilson, twoPropZ, REASON_CLASSES, buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

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
ok(classifyReason(ended('勝利象徵特殊勝利條件達成', 1)) === 'special', '① 正對照：特殊勝利條件');
ok(classifyReason({ outcome: 'stuck_loop', reason: null, winner: null }) === 'unfinished', '① 未結束');
ok(new Set(REASON_CLASSES.map(([k]) => k)).size === REASON_CLASSES.length, '① 分類鍵不可重複');

// ── ② 引擎所有終局原因字面都要落在已知分類（不預先用關鍵字過濾）────────────────
// ⚠ fable 審查：初版先用「可上場的寶可夢|取得所有獎賞卡|…」關鍵字過濾才檢查 ⇒ 新增一種**不含這些字**的
//   終局原因根本不會被掃到（實測把「牌組耗盡」改成「超時判負」守衛照樣全綠）＝安慰劑。
//   現在掃 src/lib/game 底下所有 .ts 的 `winReason: <字面>` 與終局判定物件 `over: true, winner: X, reason: <字面>`，
//   不過濾；只有線上限定的字面（AI 對 AI 模擬不會出現）以**完整字面**列白名單。
import { readdirSync as _rd, statSync as _st } from 'node:fs';
const GAME_DIR = join(ROOT, 'src/lib/game');
const tsFiles = [];
(function walk(d) { for (const n of _rd(d)) { const p = join(d, n); if (_st(p).isDirectory()) walk(p); else if (n.endsWith('.ts')) tsFiles.push(p); } })(GAME_DIR);
const LIT = String.raw`(\`[^\`]*\`|'[^'\n]*'|"[^"\n]*")`;
const norm = (lit) => lit.slice(1, -1).replace(/\$\{[^}]*\}/g, 'X');
const winLits = new Map();      // 字面 → 出處
const drawLits = new Map();
const nonLiteral = new Map();   // 非字面的 winReason 運算式 → 出處
for (const f of tsFiles) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(ROOT, f);
  for (const m of src.matchAll(new RegExp(String.raw`\bwinReason:\s*` + LIT, 'g'))) winLits.set(norm(m[1]), rel);
  // ⚠ lookahead 要連空白一起排除，否則 `\s*` 退回 0 個空白後 lookahead 看到空白就放行（fable 複審實測全部被算成非字面）
  for (const m of src.matchAll(/\bwinReason:\s*(?![\s`'"])([^,}\n]+)/g)) nonLiteral.set(m[1].trim(), rel);
  for (const m of src.matchAll(new RegExp(String.raw`over:\s*true,\s*winner:\s*([^,]+?),\s*reason:\s*` + LIT, 'g'))) {
    const lit = norm(m[2]);
    if (m[1].trim() === 'null') drawLits.set(lit, rel); else winLits.set(lit, rel);
  }
}
ok(winLits.size >= 5, `② 掃描器下限：有勝負的終局字面只掃到 ${winLits.size} 種，掃描器可能壞了`);
ok(drawLits.size >= 3, `② 掃描器下限：平手字面只掃到 ${drawLits.size} 種（v6.361／v6.420 至少 3 種）`);
// 線上限定（對方離開／棄權），AI 對 AI 模擬不會出現 ⇒ 允許歸「其他」。⚠ 必須是完整字面，不可以用關鍵字。
const ONLINE_ONLY = new Set(['對手承認技不如人，先行離開了', 'X 3 分鐘無回應，被宣告棄權']);
for (const [r, where] of winLits) {
  if (ONLINE_ONLY.has(r)) continue;
  const c = classifyReason(ended(r, 0));
  ok(c !== 'other', `② 終局原因「${r}」（${where}）落進「其他」——量尺要新增這一類`);
}
for (const [r, where] of drawLits) ok(classifyReason(ended(r, null)) === 'draw', `② 平手字面「${r}」（${where}）`);
for (const o of ONLINE_ONLY) ok([...winLits.keys()].includes(o), `② 白名單「${o}」已不在引擎裡，請刪掉這條（死條目）`);
// 非字面的 winReason（字串相加、變數）掃不到內容 ⇒ 一律列白名單；新增一處就紅，逼人改寫成字面或回來登記
//   ⚠ fable 複審：初版只計數不斷言，`winReason: player.name + ' 超時判負'` 會漏掉。
const NON_LITERAL_OK = new Map([
  ['v.reason', '中央終局判定的轉傳；內容由上面的 over:true 物件掃描涵蓋'],
  ["oppName + ' 長時間無回應，被宣告棄權'", '線上限定（room-oracle.ts），AI 對 AI 模擬不會出現'],
]);
ok(nonLiteral.size >= 1, '② 掃描器下限：非字面 winReason 一個都沒掃到（至少有 v.reason），掃描器可能壞了');
for (const [expr, where] of nonLiteral) ok(NON_LITERAL_OK.has(expr), `② 非字面的 winReason「${expr}」（${where}）不在白名單——改寫成字面，或確認分類後登記`);
for (const k of NON_LITERAL_OK.keys()) ok(nonLiteral.has(k), `② 非字面白名單「${k}」已不存在，請刪掉（死條目）`);
const lits = new Set([...winLits.keys(), ...drawLits.keys()]);

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

// ── ⑤ 可重現性與先攻（fable 複審：這兩個機制沒有守衛，誤刪不會有人發現）──────────
{
  const mod = await buildAiBundle(ROOT, { extraExports: ["export { withIsolatedRandom } from './src/lib/game/ai-eval';"] });
  const pool = loadLivePool(ROOT);
  // ⑤-1 reset 真的把 ai-eval 的 _simSeed 歸零（同一個模組實例）
  ok(typeof mod.__resetNew === 'function', '⑤ 打包裡沒有 __resetNew（onLoad 附加失效？）');
  mod.__resetNew();
  const x1 = mod.withIsolatedRandom(() => Math.random());
  const x2 = mod.withIsolatedRandom(() => Math.random());
  mod.__resetNew();
  const x3 = mod.withIsolatedRandom(() => Math.random());
  ok(x1 !== x2, '⑤ 正對照：不歸零時連續兩次的起點應該不同');
  ok(x1 === x3, '⑤ 歸零後的第一個亂數必須與上次歸零後相同');
  // ⑤-2 playGame 每局開始都會呼叫 reset（新舊各一次）
  let calls = 0;
  const spy = { ...mod, __resetNew: () => { calls++; }, __resetOld: () => { calls += 10; } };
  const deck = presetById(mod, '__preset_mega_lucario__');
  const ai = (st, i) => mod.aiNew(st, pool, i);
  const r0 = playGame({ mod: spy, pool, decks: [deck, deck], agents: [ai, ai], seed: 7, firstPlayer: 0 });
  ok(calls === 11, `⑤ playGame 每局應呼叫 __resetNew 與 __resetOld 各一次，實際 calls=${calls}`);
  // ⑤-3 指定先攻真的生效（兩個值都要驗，避免碰巧同值）
  const r1 = playGame({ mod, pool, decks: [deck, deck], agents: [ai, ai], seed: 7, firstPlayer: 1 });
  ok(r0.firstPlayerIdx === 0 && r1.firstPlayerIdx === 1, `⑤ firstPlayer 沒有生效：${r0.firstPlayerIdx}／${r1.firstPlayerIdx}`);
  ok(firstPlayerOf(12345) === firstPlayerOf(12345), '⑤ firstPlayerOf 必須是 seed 的純函式');
  const fps = new Set(Array.from({ length: 16 }, (_, i) => firstPlayerOf(1000 + i)));
  ok(fps.size === 2, '⑤ firstPlayerOf 應該兩種值都會出現');
}

console.log(`✅ test-ai-sim-harness：${pass} 條全數通過（掃到 ${lits.size} 種終局字面；非字面的 winReason ${nonLiteral.size} 種）`);
