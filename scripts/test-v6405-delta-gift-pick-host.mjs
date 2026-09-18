#!/usr/bin/env node
/**
 * v6.405 守衛：超級烈空坐帽子｜德爾塔之禮 —— 先選寶可夢、再選能量。
 *
 * 【站長轉述的玩家建議】
 *   ①「先顯示選擇要填給哪隻，再選擇能量」——舊流程照「戰鬥場 → 備戰」的固定順序逐隻問，
 *      玩家只能一路按下去，按太快就附到不想附的那一隻。
 *   ②「牌組能量數小於場上有帽子的數量時，應該可以選要填給哪隻」——舊流程等於系統預設先給戰鬥場。
 *
 * 【卡面逐字】（static/cards M6 #19616，J 標，PokemonTool）
 *   「附有這張卡的寶可夢，可使用這張卡上寫的招式。[需要有足夠使用招式的能量。]
 *     從牌庫附給自己的所有身上附有「超級烈空坐帽子」的寶可夢各1張基本能量卡。並且重洗牌庫。」
 *   ⇒「**所有**…**各1張**」是**強制全部**，玩家能決定的只有**順序**
 *     ⇒ 選寶可夢那一步 minCount=1（不可跳過）；選能量那一步維持 minCount=0
 *       （牌庫搜尋的 fail-to-find，官方判準②，v6.081 既有行為不動）。
 *
 * 【HEAD-FAIL】BASE（v6.404）上沒有 `m6-delta-gift-pick-host` 這個 resolver，
 *   第一步的 effectKey 也還是 `m6-delta-gift-step` ⇒ A／B／C 各組都會各自翻紅。
 *   缺席的東西一律用哨兵包起來（IRON_RULES Rule 41），讓每一條**各自誠實翻紅**。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-6405-s.js'), E = join(ROOT, '.x-6405-e.ts'), O = join(ROOT, '.x-6405-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { ATTACK_POST, RESOLVERS } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m}（實得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`);

// ─── 卡池 ───────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
const HAT = '19616';

console.log('\n=== A 組：卡面事實（判準的依據不能漂走）===');
{
  const hat = pool.get(HAT);
  ok(!!hat, 'A0 超級烈空坐帽子（M6 #19616）在 live 卡池裡');
  eq(hat?.subtype, 'PokemonTool', 'A1 它是寶可夢道具');
  eq(hat?.regulationMark, 'J', 'A2 J 標（在 H/I/J 標準賽範圍內）');
  const t = String(hat?.rulesText ?? '');
  ok(t.includes('所有身上附有「超級烈空坐帽子」的寶可夢各1張基本能量卡'),
    'A3 ⭐卡面逐字含「所有…各1張基本能量卡」⇒ 是**強制全部**，玩家只決定順序');
  ok(t.includes('並且重洗牌庫'), 'A4 卡面最後一句是「並且重洗牌庫」');
  ok(!/若希望|可以選擇/.test(t), 'A5 ★反面：卡面沒有「若希望」之類的可選字眼（所以選寶可夢不可跳過）');
}

// ─── fixture ────────────────────────────────────────────────────────────────
let E1 = null, E2 = null, BASIC = null, ITEM = null;
for (const c of all) {
  if (!HIJ(c)) continue;
  const id = String(c.id);
  if (c.supertype === 'Energy' && c.subtype === 'Basic') { if (!E1) E1 = id; else if (!E2 && id !== E1) E2 = id; }
  if (!BASIC && c.supertype === 'Pokemon' && c.stage === 'Basic') BASIC = id;
  if (!ITEM && c.supertype === 'Trainer' && c.subtype === 'Item') ITEM = id;
}
let n = 0;
const I = (cid, x = {}) => ({ iid: 'g' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...x });
/** act 與 bench[0] 都附帽子（bench[0] 走 extraTools＝多重轉接），bench[1] 沒帽子。 */
function mk(deckEnergies) {
  const act = I(BASIC, { toolAttached: I(HAT) });
  const b0 = I(BASIC, { extraTools: [I(HAT)] });
  const b1 = I(BASIC);
  const deck = [...deckEnergies.map((e) => I(e)), I(ITEM)];
  return { state: {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, pendingSelection: null, log: [],
    players: [
      { name: 'A', active: act, bench: [b0, b1], hand: [], deck, discard: [], prizes: [] },
      { name: 'B', active: I(BASIC), bench: [], hand: [], deck: [], discard: [], prizes: [] }],
  }, act, b0, b1, deck };
}
const nm = (s) => (s?.log ?? []).map((l) => String(l?.message ?? l));
/** ⚠ engine 在呼叫 resolver **之前**就把 pendingSelection 清掉（不清的話 withPending 會排進
 *   pendingChainQueue 而不是覆蓋）——harness 必須照做，否則測到的是「鏈尾排隊」不是真實流程。 */
const MISSING = Symbol('MISSING');
const RES = (key, st, iids) => {
  // ⚠ Rule 41：BASE 上這支 resolver 不存在、或上一步已經回 MISSING 時，一路把 MISSING 傳下去，
  //   **不可以**讓後面的 `s.players[0]` 直接 throw —— 整支爆掉就只證明了第一條。
  if (st === MISSING || !st || typeof st !== 'object') return MISSING;
  const fn = M.RESOLVERS?.get(key);
  if (typeof fn !== 'function') return MISSING;
  try {
    return fn({ ...st, pendingSelection: null }, 0, iids, st.pendingSelection?.params, pool);
  } catch { return MISSING; }
};
const POST = () => M.ATTACK_POST?.get('超級烈空坐帽子|德爾塔之禮');
const ps = (s) => (s && s !== MISSING && typeof s === 'object' ? s.pendingSelection : null);
/** 取「某一側某個位置的能量張數」；state 缺席（BASE 上 MISSING）時回 -1 ⇒ 斷言誠實翻紅而不是 throw。 */
const eLen = (s, where, i) => {
  if (!s || s === MISSING || typeof s !== 'object') return -1;
  const p = s.players?.[0];
  const c = where === 'active' ? p?.active : p?.bench?.[i];
  return c ? (c.energyAttached ?? []).length : -1;
};

console.log('\n=== B 組：第一步必須是「選要附給哪一隻」（BASE 上是能量 picker ⇒ HEAD-FAIL）===');
{
  ok(typeof POST() === 'function', 'B0 德爾塔之禮有註冊');
  ok(typeof M.RESOLVERS?.get('m6-delta-gift-pick-host') === 'function',
    'B1 ⭐有 m6-delta-gift-pick-host resolver（BASE 上不存在 ⇒ HEAD-FAIL）');
  const { state, act, b0, b1 } = mk([E1, E2]);
  const s1 = POST()?.(state, 0, pool);
  eq(ps(s1)?.effectKey, 'm6-delta-gift-pick-host', 'B2 ⭐第一步是「選寶可夢」，不是直接問能量');
  eq(ps(s1)?.type, 'bench-choose', 'B3 ⭐用**既有**的 bench-choose 型別（站長：優先用既有 picker UI）');
  eq(ps(s1)?.params?.includeActive, true, 'B4 includeActive=true ⇒ 戰鬥場那隻也選得到');
  eq(ps(s1)?.minCount, 1, 'B5 minCount=1（卡面「所有…各1張」是強制，不可跳過）');
  eq(ps(s1)?.maxCount, 1, 'B6 maxCount=1（一次只決定一隻）');
  const v = ps(s1)?.params?.validIids ?? [];
  ok(v.length === 2 && v.includes(act.iid) && v.includes(b0.iid),
    'B7 候選恰好是 2 隻附帽子的（含道具在 extraTools 的那隻 —— 多重轉接）');
  ok(!v.includes(b1.iid), 'B8 ★反面：沒附帽子的那隻不在候選裡');
  ok(typeof ps(s1)?.params?.titleOverride === 'string', 'B9 有 titleOverride（UI 標題講清楚在選什麼）');
}

console.log('\n=== C 組：玩家的選擇被尊重（舊流程做不到）===');
{
  const { state, act, b0, b1 } = mk([E1, E2]);
  const s1 = POST()?.(state, 0, pool);
  const s2 = RES('m6-delta-gift-pick-host', s1, [b0.iid]);          // ⭐先選備戰那隻
  eq(ps(s2)?.effectKey, 'm6-delta-gift-step', 'C1 選完寶可夢才問能量');
  eq(ps(s2)?.params?.hostIid, b0.iid, 'C2 ⭐要附的是玩家選的那一隻（備戰），不是戰鬥場');
  eq(ps(s2)?.minCount, 0, 'C3 能量那一步維持 minCount=0（牌庫搜尋的 fail-to-find，官方判準②）');
  const eIids = ps(s2)?.params?.validIids ?? [];
  eq(eIids.length, 2, 'C4 能量候選只有 2 張基本能量（物品卡不在內）');
  const s3 = RES('m6-delta-gift-step', s2, [eIids[0]]);
  eq(eLen(s3, 'bench', 0), 1, 'C5 ⭐備戰那隻拿到能量');
  eq(eLen(s3, 'active'), 0, 'C6 ⭐戰鬥場那隻此時還沒拿到');
  eq(ps(s3)?.effectKey, 'm6-delta-gift-step', 'C7 只剩 1 隻 ⇒ 不再問「選哪隻」（少一次點擊）');
  eq(ps(s3)?.params?.hostIid, act.iid, 'C8 剩下的那一隻是戰鬥場');
  const s4 = RES('m6-delta-gift-step', s3, [(ps(s3)?.params?.validIids ?? [])[0]]);
  eq(eLen(s4, 'active'), 1, 'C9 戰鬥場那隻也拿到了');
  eq(eLen(s4, 'bench', 1), 0, 'C10 ★沒附帽子的那隻始終沒拿到');
  ok(s4 !== MISSING && !s4.pendingSelection, 'C11 兩隻都處理完 ⇒ picker 收掉');
  ok(nm(s4).some((l) => l.includes('重洗牌庫')), 'C12 卡面最後一句「並且重洗牌庫」有執行');
}

console.log('\n=== D 組：站長點名的情境 —— 牌庫基本能量少於帽子數 ===');
{
  const { state, b0 } = mk([E1]);                                   // 只有 1 張基本能量、2 隻帽子
  const s1 = POST()?.(state, 0, pool);
  eq(ps(s1)?.effectKey, 'm6-delta-gift-pick-host', 'D1 ⭐仍然先問「要給誰」（不再預設先給戰鬥場）');
  const s2 = RES('m6-delta-gift-pick-host', s1, [b0.iid]);
  const s3 = RES('m6-delta-gift-step', s2, [(ps(s2)?.params?.validIids ?? [])[0]]);
  eq(eLen(s3, 'bench', 0), 1, 'D2 ⭐⭐能量給了玩家選的備戰那隻');
  eq(eLen(s3, 'active'), 0, 'D3 ⭐⭐戰鬥場那隻沒拿到（玩家的選擇被尊重）');
  ok(s3 !== MISSING && !s3.pendingSelection, 'D4 牌庫沒有基本能量了 ⇒ 直接結束，不會卡住');
  ok(nm(s3).some((l) => l.includes('牌庫已無基本能量')), 'D5 有說明為什麼還有一隻沒拿到');
  ok(nm(s3).some((l) => l.includes('重洗牌庫')), 'D6 這條路徑也有重洗牌庫（卡面最後一句）');
}

console.log('\n=== E 組：不可軟鎖（加防護閘之前先問「被擋下來的人還有沒有出口」）===');
{
  const { state } = mk([E1, E2]);
  const s1 = POST()?.(state, 0, pool);
  const s2 = RES('m6-delta-gift-pick-host', s1, ['不存在的iid']);
  eq(ps(s2)?.effectKey, 'm6-delta-gift-step',
    'E1 ⭐送不存在的 iid ⇒ 退回照原順序取第一隻（一定有進展，不重問、不軟鎖）');
  const s3 = RES('m6-delta-gift-step', s2, []);
  eq(ps(s3)?.effectKey, 'm6-delta-gift-step', 'E2 能量選 0 張（fail-to-find）⇒ 換下一隻');
  // ⚠ 這一條原本只寫「兩邊 hostIid 不同」—— 突變測試 W5 顯示那是**弱斷言**：
  //   若流程整個走歪（pending 變成別的型別），兩邊都是 undefined 也會「不同」而誤 PASS。
  //   必須同時釘住「仍在能量那一步」與「hostIid 真的存在」。
  ok(ps(s3)?.effectKey === 'm6-delta-gift-step'
    && !!ps(s3)?.params?.hostIid
    && ps(s3)?.params?.hostIid !== ps(s2)?.params?.hostIid,
    'E3 ⭐那一隻仍算處理過，換到**另一隻**（不會無限重問同一隻）');
  const s4 = RES('m6-delta-gift-step', s3, []);
  ok(s4 !== MISSING && !s4.pendingSelection, 'E4 兩隻都宣告找不到 ⇒ 收掉 picker（不卡住）');
}

console.log('\n=== F 組：零回歸（只剩 1 隻 / 完全沒有 host）===');
{
  const { state } = mk([E1]);
  const one = { ...state, players: [{ ...state.players[0], bench: [state.players[0].bench[1]] }, state.players[1]] };
  eq(ps(POST()?.(one, 0, pool))?.effectKey, 'm6-delta-gift-step', 'F1 只有 1 隻附帽子 ⇒ 直接問能量（不多問）');
  const none = { ...state, players: [
    { ...state.players[0], active: I(BASIC), bench: [] }, state.players[1]] };
  const r = POST()?.(none, 0, pool);
  ok(r && !r.pendingSelection, 'F2 場上沒人附帽子 ⇒ 不開 picker');
  ok(nm(r).some((l) => l.includes('沒有附有「超級烈空坐帽子」')), 'F3 有說明原因');
  ok(nm(r).some((l) => l.includes('重洗牌庫')), 'F4 ★這條路徑也要重洗牌庫（卡面最後一句，三個結束分支共用同一支）');
}

console.log('\n=== G 組：host 中途離場（不可以還把它列成候選）===');
{
  // ⚠ 為什麼要有這一組：B7 的 fixture 裡兩隻 host 都在場上 ⇒ 「有沒有過濾還在不在場上」
  //   兩種寫法給出同一個答案（安慰劑型態 12：餵了碰巧同值的輸入）。突變測試 W8 就是這樣活下來的。
  //   這裡刻意讓第二隻在中途離場，兩種寫法才會分岔。
  const { state, act, b0 } = mk([E1, E2]);
  const s1 = POST()?.(state, 0, pool);
  const s2 = RES('m6-delta-gift-pick-host', s1, [act.iid]);           // 先處理戰鬥場那隻
  eq(ps(s2)?.params?.hostIid, act.iid, 'G1 前提：這一步處理的是戰鬥場那隻');
  // ⭐ 在解能量之前，把備戰那隻（b0）從場上移走（被擊倒／回手等）
  const gone = (st) => (st === MISSING ? st : { ...st, players: [
    { ...st.players[0], bench: st.players[0].bench.filter((c) => c.iid !== b0.iid) }, st.players[1]] });
  const s3 = RES('m6-delta-gift-step', gone(s2), [(ps(s2)?.params?.validIids ?? [])[0]]);
  eq(eLen(s3, 'active'), 1, 'G2 戰鬥場那隻照樣拿到能量');
  ok(s3 !== MISSING && !s3.pendingSelection,
    'G3 ⭐已離場的那一隻不再被問（若沒過濾「還在場上」，這裡會多開一個選不到東西的 picker）');
  ok(nm(s3).some((l) => l.includes('重洗牌庫')), 'G4 仍然有重洗牌庫');
}

console.log(`\n=== v6.405 德爾塔之禮 picker 順序守衛：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
