// v6.416 守衛：①「昏厥時觸發」特性的 gate 診斷 log；② client 引擎版本蓋章。
//
// 【由來】2026-09-20 玩家回報「耿鬼ex｜死亡宣告被破破舵輪｜悔念錨打死時沒有觸發」。
//   逐版重現的結論是**引擎沒有 bug**：v6.415 與 v6.408a 都正常觸發，而 v6.354
//   （死亡宣告實裝的前一版）跑同一個盤面，log 與玩家截圖**逐字相同**。
//   根因是休閒線上對戰**不是伺服器權威** —— 誰做動作、誰的瀏覽器就跑 applyAction，
//   再 pushGameState 推整份盤面 ⇒ 那一手是攻擊方算的，他那台停在舊 bundle。
//   要靠逐版重現才能定案，是因為：
//     (a) `firePassiveOnKoAfterPrize` 的四道 gate **一個字都不寫 log**
//         ⇒ 分不出「被規則正確擋掉」與「這台根本沒有這張卡的實作」。
//     (b) 對戰記錄裡**沒有任何版本資訊** ⇒ 看不出每一手是誰的哪一版算的。
//   站長裁示兩項都排進 v6.416。
//
// 【卡面（逐字，static/cards 台灣官方）】
//   耿鬼ex｜死亡宣告：「這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，自己擲1次硬幣。
//   若為正面，則將使用招式的寶可夢【昏厥】。」
//
// 【HEAD-FAIL】BASE（v6.415）上 A1／C2／C3／D1／D2 紅。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x416-s.js'), E = join(ROOT, '.x416-e.ts'), O = join(ROOT, '.x416-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export * as EFF from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
const { applyAction } = M;
const HAS = (n) => typeof M.EFF?.[n] === 'function';

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const cards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) cards.push(c);
  }
}
const byAb = (n) => cards.find((c) => (c.abilities || []).some((x) => x.name === n));
const byName = (n) => cards.find((c) => c.name === n);
const GENGAR = byAb('死亡宣告');
const CAVE = byName('傳說的熔岩洞');
const PLAIN = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 100
  && !(c.abilities || []).length && !c.name.includes('超級'));
assert.ok(GENGAR && PLAIN, `測試用卡沒挑齊：耿鬼ex=${!!GENGAR} 無特性卡=${!!PLAIN}`);

let n = 0, pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const mkState = (extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
  players: [
    { name: '路邊的訓練家', active: inst(PLAIN.id), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [], prizes: [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)] },
    { name: 'hhhan', active: inst(GENGAR.id), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [], prizes: [inst(PLAIN.id), inst(PLAIN.id)] },
  ],
  ...extra,
});
const msgs = (st) => (st.log || []).map((l) => (typeof l === 'string' ? l : l.message));

// ══════════════════════════════════════════════════════════════════════════════
// 【A】HEAD-FAIL 哨兵
// ══════════════════════════════════════════════════════════════════════════════
T('A1. `stampClientVersion` 已 export（版本蓋章的唯一寫入點）', () => {
  assert.ok(HAS('stampClientVersion'), 'v6.416 之前不存在 ⇒ 本條必紅');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】行為端：版本蓋章
// ══════════════════════════════════════════════════════════════════════════════
const stamp = HAS('stampClientVersion') ? M.EFF.stampClientVersion : null;
T('B1. 第一次蓋章：欄位寫入＋log 一行（帶玩家名與版本）', () => {
  assert.ok(stamp, 'helper 不存在');
  const out = stamp(mkState(), 1, '6.416');
  assert.strictEqual(out._clientVerP1, '6.416', '欄位沒寫進去');
  assert.strictEqual(out._clientVerP0, undefined, '不該動到另一座');
  const L = msgs(out);
  assert.strictEqual(L.length, 1, `應該剛好一行 log，實得 ${L.length}`);
  assert.ok(L[0].includes('hhhan') && L[0].includes('6.416'), `log 內容不對：${L[0]}`);
});
T('B2. ⭐ 同版本重複蓋章是 no-op（不會每一手刷一行）', () => {
  const a = stamp(mkState(), 1, '6.416');
  const b = stamp(a, 1, '6.416');
  assert.strictEqual(b, a, '同版本竟然回了新物件（會每一手刷 log）');
  assert.strictEqual(msgs(b).length, 1, 'log 被重複寫了');
});
T('B3. ⭐⭐ 版本改變時再寫一行，而且要寫出「原本記錄的是」（混版的關鍵線索）', () => {
  const a = stamp(mkState(), 1, '6.354');
  const b = stamp(a, 1, '6.416');
  const L = msgs(b);
  assert.strictEqual(L.length, 2, `應該兩行，實得 ${L.length}`);
  assert.ok(L[1].includes('6.416') && L[1].includes('6.354'),
    `版本變更那一行沒有寫出前後版本：${L[1]}`);
  assert.strictEqual(b._clientVerP1, '6.416');
});
T('B4. 兩座各自獨立（一座蓋章不影響另一座）', () => {
  const a = stamp(mkState(), 0, '6.354');
  const b = stamp(a, 1, '6.416');
  assert.strictEqual(b._clientVerP0, '6.354');
  assert.strictEqual(b._clientVerP1, '6.416');
});
T('B5. ⭐⭐ 欄位必須是**純量**（Firestore 禁巢狀陣列 —— v6.056／v6.359／v6.361 同一條）', () => {
  const b = stamp(stamp(mkState(), 0, '6.415'), 1, '6.416');
  assert.strictEqual(typeof b._clientVerP0, 'string', '_clientVerP0 不是字串');
  assert.strictEqual(typeof b._clientVerP1, 'string', '_clientVerP1 不是字串');
  const TY = normEol(readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8'));
  assert.ok(!/_clientVer\??:\s*\[/.test(TY) && !/_clientVer\??:\s*string\[\]/.test(TY),
    'types.ts 出現了陣列型的版本欄位 —— Firestore 存不了巢狀陣列');
});
T('B6.【負對照】空版本字串不得寫入（避免把欄位污染成空字串）', () => {
  const out = stamp(mkState(), 1, '');
  assert.strictEqual(out._clientVerP1, undefined, '空版本竟然寫進去了');
  assert.strictEqual(msgs(out).length, 0, '空版本竟然寫了 log');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】行為端：gate 診斷 log（純 log，行為必須零改變）
// ══════════════════════════════════════════════════════════════════════════════
const fire = HAS('firePassiveOnKoAfterPrize') ? M.EFF.firePassiveOnKoAfterPrize : null;
const qlen = (st) => (st._onKoAfterPrize || []).length;
T('C0. 基準：耿鬼ex 在戰鬥位因招式傷害昏厥 ⇒ 入列 1 筆，且**不寫**診斷 log', () => {
  assert.ok(fire, 'firePassiveOnKoAfterPrize 不存在');
  const st = mkState();
  const out = fire(st, 1, 0, pool, st.players[1].active, true, true);
  assert.strictEqual(qlen(out), 1, `應該入列 1 筆，實得 ${qlen(out)}`);
  assert.strictEqual(msgs(out).length, 0, `正常觸發時不該寫診斷 log：${msgs(out).join(' / ')}`);
});
T('C1.【負對照】沒印本家族特性的卡昏厥 ⇒ 一行都不寫（不製造噪音）', () => {
  const st = mkState();
  for (const byDmg of [true, false]) {
    const out = fire(st, 1, 0, pool, st.players[1].bench[0], false, byDmg);
    assert.strictEqual(qlen(out), 0, '不該入列');
    assert.strictEqual(msgs(out).length, 0,
      `無關的卡竟然寫了診斷 log（byDmg=${byDmg}）：${msgs(out).join(' / ')}`);
  }
});
T('C2. ⭐⭐⭐【HEAD-FAIL】特性被消除（傳說的熔岩洞）⇒ 要寫清楚是被消除擋掉的', () => {
  assert.ok(CAVE, '找不到傳說的熔岩洞（卡池變了？）');
  const st = mkState({ activeStadium: inst(CAVE.id) });
  const out = fire(st, 1, 0, pool, st.players[1].active, true, true);
  assert.strictEqual(qlen(out), 0, '熔岩洞在場時不該入列（行為必須與 BASE 相同）');
  const L = msgs(out);
  assert.strictEqual(L.length, 1, `應該剛好一行診斷 log，實得 ${L.length}：${L.join(' / ')}`);
  assert.ok(/死亡宣告/.test(L[0]) && /消除/.test(L[0]), `診斷 log 內容不對：${L[0]}`);
});
T('C3. ⭐⭐⭐【HEAD-FAIL】不是傷害造成的昏厥 ⇒ 要寫清楚卡面是「受到…傷害而昏厥」', () => {
  const st = mkState();
  const out = fire(st, 1, 0, pool, st.players[1].active, true, false);
  assert.strictEqual(qlen(out), 0, '非傷害昏厥不該入列（行為必須與 BASE 相同）');
  const L = msgs(out);
  assert.strictEqual(L.length, 1, `應該剛好一行診斷 log，實得 ${L.length}`);
  assert.ok(/死亡宣告/.test(L[0]) && /傷害/.test(L[0]), `診斷 log 內容不對：${L[0]}`);
});
T('C4.【零回歸】備戰昏厥仍然照舊入列（死亡宣告卡面沒有「在戰鬥場」）', () => {
  // ⚠ 誠實標記：`PASSIVE_ON_KO_AFTER_PRIZE` 目前只有「死亡宣告」一個成員，而它在
  //   `PASSIVE_ON_KO_BENCH_ALSO` 裡 ⇒ 「卡面寫在戰鬥場」那一道 gate **行為端測不到**，
  //   只能由 D 段的靜態斷言釘住它還在。這裡守的是反向：備戰不得被誤擋。
  const st = mkState();
  const g = inst(GENGAR.id);
  const st2 = { ...st, players: [st.players[0], { ...st.players[1], bench: [g] }] };
  const out = fire(st2, 1, 0, pool, g, false, true);
  assert.strictEqual(qlen(out), 1, `備戰的耿鬼ex 應該照樣入列，實得 ${qlen(out)}`);
  assert.strictEqual(msgs(out).length, 0, `不該寫診斷 log：${msgs(out).join(' / ')}`);
});
T('C5. ⭐⭐ 端到端：診斷 log 不得改變「擋不擋」（四種組合的入列數與 BASE 相同）', () => {
  const st = mkState();
  const cave = mkState({ activeStadium: inst(CAVE.id) });
  const g = st.players[1].active;
  assert.strictEqual(qlen(fire(st, 1, 0, pool, g, true, true)), 1, '① 傷害＋戰鬥位＋無消除 ⇒ 1');
  assert.strictEqual(qlen(fire(st, 1, 0, pool, g, true, false)), 0, '② 非傷害 ⇒ 0');
  assert.strictEqual(qlen(fire(cave, 1, 0, pool, cave.players[1].active, true, true)), 0, '③ 特性被消除 ⇒ 0');
  assert.strictEqual(qlen(fire(st, 1, 0, pool, st.players[1].bench[0], false, true)), 0, '④ 無關的卡 ⇒ 0');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】靜態（Rule 38：寫入點只能有一份）
// ══════════════════════════════════════════════════════════════════════════════
const EFF = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')), 'effects.ts');
const srcFiles = [];
(function walk(d) {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    if (f.isDirectory()) walk(join(d, f.name));
    else if (/\.(ts|svelte)$/.test(f.name)) srcFiles.push(join(d, f.name));
  }
})(join(ROOT, 'src'));
assert.ok(srcFiles.length > 100, `只掃到 ${srcFiles.length} 個檔，掃描器壞了？`);

/** ⭐ 「寫入 _clientVerP0/P1」的唯一判準（D 段與 E 段自檢共用）。 */
const verWrites = (src) => src.split('\n').filter((line) =>
  /_clientVerP[01]\s*:/.test(line) && !/_clientVerP[01]\??\s*:\s*string/.test(line));

T('D1. ⭐⭐⭐ `_clientVerP0/P1` 的寫入只准在中央 helper 裡（＋下限斷言）', () => {
  const hits = [];
  for (const p of srcFiles) {
    const rel = p.replace(ROOT, '').replace(/\\/g, '/');
    if (/game\/types\.ts$/.test(rel)) continue;   // 型別宣告
    const src = stripCommentsBlankChecked(normEol(readFileSync(p, 'utf8')), p);
    for (const line of verWrites(src)) hits.push(rel + ' :: ' + line.trim());
  }
  assert.ok(hits.length >= 1, '一個寫入點都沒掃到 ⇒ 掃描器壞了（空集合空真）');
  const outside = hits.filter((h) => !/game\/effects\.ts/.test(h));
  assert.deepStrictEqual(outside, [],
    '中央 helper 以外還有人寫版本欄位（判準兩份）：\n  ' + outside.join('\n  '));
});
T('D2. ⭐⭐ 對戰頁真的有接上中央 helper（沒接＝這個診斷等於不存在）', () => {
  const page = normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
  assert.ok(/import \{[^}]*stampClientVersion[^}]*\} from '\$lib\/game\/effects'/.test(page),
    '+page.svelte 沒有 import 中央 helper');
  assert.ok(/stampClientVersion\(newState,\s*mySeatIdx as 0 \| 1,\s*VERSION\)/.test(page),
    '+page.svelte 沒有在 dispatch 裡蓋章（或改了呼叫形狀）');
});
T('D3. ⭐⭐ 四道 gate 的診斷 log 都還在（含行為端測不到的那一道）', () => {
  const i = EFF.indexOf('export function firePassiveOnKoAfterPrize(');
  assert.ok(i >= 0, 'anchor 失效');
  const blk = EFF.slice(i, i + 3500);
  assert.ok(/^\s*\}/m.test(blk), '切片內沒有函式收尾');
  for (const [nm, re] of [
    ['非傷害昏厥', /不是傷害造成的昏厥/],
    ['卡面限戰鬥場', /在備戰區昏厥不算/],
    ['特性被消除', /特性此刻被消除/],
    ['卡片資料缺失', /找不到昏厥寶可夢的卡片資料/],
  ]) {
    assert.ok(re.test(blk), `「${nm}」那一道 gate 的診斷 log 不見了`);
  }
});
T('D4. ⭐ 診斷 log 不得寫在「沒印本家族特性」的情形（噪音防線）', () => {
  const i = EFF.indexOf('export function firePassiveOnKoAfterPrize(');
  const blk = EFF.slice(i, i + 3500);
  assert.ok(/_famNames\.length === 0/.test(blk),
    '沒有「這張卡沒印本家族特性就直接 return」的早退 ⇒ 每一次昏厥都會噴 log');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【E】反安慰劑自檢（與 D 段呼叫同一支判準）
// ══════════════════════════════════════════════════════════════════════════════
T('E1. D1 的判準抓得到「別的檔自己寫版本欄位」的違規樣本', () => {
  assert.strictEqual(verWrites('  return { ...s, _clientVerP0: ver };').length, 1,
    'D1 的判準抓不到已知違規樣本＝安慰劑');
});
T('E2. D1 的判準不誤殺型別宣告', () => {
  assert.strictEqual(verWrites('  _clientVerP0?: string;').length, 0, '誤殺型別宣告');
  assert.strictEqual(verWrites('  _clientVerP1?: string;').length, 0, '誤殺型別宣告');
});

console.log(`\n=== v6.416 昏厥特性 gate 診斷／client 版本蓋章：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
