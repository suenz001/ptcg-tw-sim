// ⭐⭐⭐ v6.418 守衛：「取獎賞」的 picker 必須**排隊**，不得因為已有 pending 就自動取。
//
// 【修的是什麼實害】
//   v5.889 起 `addPendingPrize` 的條件是 `prizes.some(faceUp) && !state.pendingSelection`
//   ⇒ 只要當下已經有別的 picker 開著，就走自動取（front N 張）。
//   實測情境（站長回報的耿鬼ex｜死亡宣告那一局的延伸）：
//     雙方獎賞區都有正面朝上的卡（克雷色利亞｜弦月光芒／火箭隊的妨礙機器人翻開的）
//     → 攻擊方打死耿鬼ex，攻擊方的 take-prize-choose picker 開著
//     → 死亡宣告正面，攻擊方的寶可夢也昏厥，耿鬼方也要取獎賞
//     → 此時已有 pending ⇒ **耿鬼方被自動取**，明明看得到那張翻正面的卡卻選不了。
//   ⇒ v6.418 改走中央 `withPending`（v4.933 起就是全站 picker 排隊的唯一機制），
//     已有 pending 時排進 `pendingChainQueue`，兩個 picker 依序解，誰都不被吃掉。
//
// 【時序沒有改】死亡宣告仍在「獎賞排隊但還沒發」時結算 —— 官方規則（PTCG RULES/PTCG_RULES.md §12）
//   對「昏厥時觸發的特性」與「取獎賞」誰先**沒有明文**，站長裁示維持現況
//   ⇒ 那一段由 test-v6417 的【D】段列管，本檔不重複。
//
// 【HEAD-FAIL】BASE（v6.417）上 A3／A3b／B0～B4／C1～C3 紅。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x418-s.js'), E = join(ROOT, '.x418-e.ts'), O = join(ROOT, '.x418-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export { addPendingPrize, PENDING_REFRESH_ON_POP } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
// ⚠ Rule 41：BASE 上不存在的東西用哨兵包起來，讓每一條各自誠實翻紅（不要整支 throw）。
const MISSING = Symbol('missing');
const addPendingPrize = typeof M.addPendingPrize === 'function' ? M.addPendingPrize : () => MISSING;
const REFRESH = M.PENDING_REFRESH_ON_POP instanceof Map ? M.PENDING_REFRESH_ON_POP : new Map();

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
const GENGAR = byAb('死亡宣告');
const HIDE = byAb('化隱');
const WHEEL = cards.find((c) => c.name === '破破舵輪' && (c.attacks || []).some((a) => a.name === '悔念錨'));
const PLAIN = cards.find((c) => c.supertype === 'Pokemon' && Number(c.hp) >= 100
  && !(c.abilities || []).length && !c.name.includes('超級'));
assert.ok(GENGAR && WHEEL && HIDE && PLAIN,
  `測試用卡沒挑齊：耿鬼ex=${!!GENGAR} 破破舵輪=${!!WHEEL} 化隱=${!!HIDE} 無特性卡=${!!PLAIN}`);

let n = 0, pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + (e && e.message)); } };
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const KANJI = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const en = (t = 'Colorless') => {
  const e = cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic'
    && (c.energyType === t || (c.name || '').includes(KANJI[t] || '草')))
    || cards.find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');
  return { iid: 'e' + (++n), cardId: String(e.id), damage: 0, energyAttached: [] };
};

// ══════════════════════════════════════════════════════════════════════════════
// 【A】單元：addPendingPrize 的四種組合（faceUp × 已有 pending）
// ══════════════════════════════════════════════════════════════════════════════
/** 乾淨盤面：owner 側 3 張獎賞（第 1 張可指定 faceUp）；`busy` 代表當下已經有別人的 picker 開著。 */
function mk(faceUp, busy) {
  const mkP = (fu) => ({
    name: 'P', active: inst(PLAIN.id), bench: [], hand: [], deck: [], discard: [],
    prizes: [inst(PLAIN.id, [], fu ? { faceUp: true } : {}), inst(PLAIN.id), inst(PLAIN.id)],
  });
  const busySel = {
    type: 'modal-choice', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1,
    effectKey: '__busy_other_picker__', params: { options: [{ id: 'a', text: 'a' }] },
  };
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], activeStadium: null,
    pendingSelection: busy ? busySel : null,
    players: [mkP(faceUp), mkP(faceUp)],
  };
}
/**
 * ⭐ 判準只寫**一份**（Rule 38 / 安慰劑型態 11）：A3 的正式斷言與 A3b 的反安慰劑共用它。
 * 回傳「這個結果算不算『被排隊、且獎賞一張都還沒被動』」。
 */
function queuedVerdict(before, after, owner) {
  if (after === MISSING || !after) return { ok: false, why: 'addPendingPrize 不存在（BASE）' };
  const q = after.pendingChainQueue ?? [];
  const keptTop = after.pendingSelection?.effectKey === before.pendingSelection?.effectKey;
  const queued = q.filter((s) => s.effectKey === 'take-prize-choose' && s.actorIdx === owner);
  const untouched = after.players[owner].prizes.length === before.players[owner].prizes.length
    && after.players[owner].hand.length === before.players[owner].hand.length;
  return {
    ok: keptTop && queued.length === 1 && untouched,
    why: `keptTop=${keptTop} queued=${queued.length} untouched=${untouched}`
      + ` prizes=${after.players[owner].prizes.length}/${before.players[owner].prizes.length}`
      + ` hand=${after.players[owner].hand.length}/${before.players[owner].hand.length}`,
  };
}

T('A0. 前置：本盤面真的有正面朝上的獎賞（否則下面全是空真）', () => {
  assert.ok(mk(true, false).players[1].prizes.some((c) => c.faceUp), '盤面建構壞了');
  assert.ok(!mk(false, false).players[1].prizes.some((c) => c.faceUp), '對照盤面建構壞了');
});
T('A1.【零回歸】無 faceUp、無 pending ⇒ 當場自動取（v5.466 行為不得改）', () => {
  const b = mk(false, false);
  const a = addPendingPrize(b, 1, 1, pool);
  assert.notStrictEqual(a, MISSING, 'addPendingPrize 不存在');
  assert.strictEqual(a.pendingSelection, null, '不該開 picker');
  assert.strictEqual(a.players[1].prizes.length, 2, `獎賞應該少一張，實得 ${a.players[1].prizes.length}`);
  assert.strictEqual(a.players[1].hand.length, 1, '獎賞沒有進手牌');
});
T('A2.【零回歸】有 faceUp、無 pending ⇒ 開 take-prize-choose picker（v5.880 行為不得改）', () => {
  const b = mk(true, false);
  const a = addPendingPrize(b, 1, 1, pool);
  assert.notStrictEqual(a, MISSING, 'addPendingPrize 不存在');
  assert.strictEqual(a.pendingSelection?.effectKey, 'take-prize-choose', '沒開 picker');
  assert.strictEqual(a.pendingSelection?.actorIdx, 1, 'picker 開給錯的人');
  assert.strictEqual(a.players[1].prizes.length, 3, '獎賞不該先被取走');
  assert.strictEqual((a.pendingChainQueue ?? []).length, 0, '沒有別的 pending 時不該排隊');
});
T('A3. ⭐⭐⭐【HEAD-FAIL】有 faceUp、**已有別人的 pending** ⇒ 排進佇列，獎賞一張都不准動', () => {
  const b = mk(true, true);
  const a = addPendingPrize(b, 1, 1, pool);
  const v = queuedVerdict(b, a, 1);
  assert.ok(v.ok, '沒有排隊（BASE 會直接自動取走，玩家失去指定權）：' + v.why);
});
T('A3b.【反安慰劑】A3 的判準抓得到「模擬 BASE 自動取」的樣本（不是恆真）', () => {
  const b = mk(true, true);
  // 模擬 BASE：pendingSelection 原封不動，但獎賞被 front 自動取走一張、佇列沒變
  const p = { ...b.players[1] };
  p.hand = [...p.hand, p.prizes[0]];
  p.prizes = p.prizes.slice(1);
  const bad = { ...b, players: [b.players[0], p] };
  const v = queuedVerdict(b, bad, 1);
  assert.ok(!v.ok, 'A3 的判準壞了：自動取的樣本竟然也算「排隊」');
  // 另一個反例：排隊了，但獎賞也被動過
  const bad2 = { ...bad, pendingChainQueue: [{ effectKey: 'take-prize-choose', actorIdx: 1 }] };
  assert.ok(!queuedVerdict(b, bad2, 1).ok, 'A3 的判準壞了：排隊卻順手把獎賞取走也算過');
});
T('A4.【零回歸】無 faceUp、已有 pending ⇒ 仍然自動取（蓋著的沒有指定權，不要多開視窗打擾）', () => {
  const b = mk(false, true);
  const a = addPendingPrize(b, 1, 1, pool);
  assert.notStrictEqual(a, MISSING, 'addPendingPrize 不存在');
  assert.strictEqual((a.pendingChainQueue ?? []).length, 0, '蓋著的獎賞不該排隊（會白白多一個視窗）');
  assert.strictEqual(a.players[1].prizes.length, 2, '獎賞應該當場就發');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【B】refresher：從佇列取出時重算（v6.215 契約）
// ══════════════════════════════════════════════════════════════════════════════
/** 依盤面現況組出「可按」的取獎賞候選（與 addPendingPrize 同一套語意，只用在測試盤面建構）。 */
const buildTopOptions = (st, owner) => {
  const opts = st.players[owner].prizes.filter((c) => c.faceUp).map((c) => ({ id: c.iid, text: 'face' }));
  if (st.players[owner].prizes.some((c) => !c.faceUp)) opts.push({ id: '__prize_random_facedown__', text: 'back' });
  return opts;
};
const mkSel = (owner, remaining) => ({
  type: 'modal-choice', actorIdx: owner, sourcePlayerIdx: owner, minCount: 1, maxCount: 1,
  effectKey: 'take-prize-choose', params: { remaining, titleOverride: '舊標題', options: [{ id: 'stale', text: '過期選項' }] },
});
T('B0. ⭐【HEAD-FAIL】take-prize-choose 有登記 PENDING_REFRESH_ON_POP', () => {
  assert.ok(typeof REFRESH.get('take-prize-choose') === 'function', '沒登記 refresher ⇒ 排隊取出時會拿過期的候選');
});
T('B1. 獎賞已經被取光 ⇒ 這一筆直接丟掉（sel: null）', () => {
  const fn = REFRESH.get('take-prize-choose'); assert.ok(fn, 'refresher 不存在');
  const st = mk(true, false); st.players[1] = { ...st.players[1], prizes: [] };
  const r = fn(st, mkSel(1, 2), pool);
  assert.strictEqual(r.sel, null, '沒有獎賞可取還把 picker 浮上來');
});
T('B2. remaining 被夾制到現有張數（否則 resolver 會一直續開到空轉）', () => {
  const fn = REFRESH.get('take-prize-choose'); assert.ok(fn, 'refresher 不存在');
  const st = mk(true, false);
  st.players[1] = { ...st.players[1], prizes: st.players[1].prizes.slice(0, 2) };   // 只剩 2 張（含 faceUp）
  const r = fn(st, mkSel(1, 5), pool);
  assert.ok(r.sel, 'picker 不該被丟掉');
  assert.strictEqual(r.sel.params.remaining, 2, `remaining 應被夾到 2，實得 ${r.sel.params.remaining}`);
});
T('B3. 排隊期間翻正面的那張已經沒了 ⇒ 問也沒意義，直接自動取完並丟掉這一筆', () => {
  const fn = REFRESH.get('take-prize-choose'); assert.ok(fn, 'refresher 不存在');
  const st = mk(false, false);   // 全部蓋著
  const r = fn(st, mkSel(1, 2), pool);
  assert.strictEqual(r.sel, null, '沒有 faceUp 還開 picker（蓋著的彼此無差異）');
  assert.strictEqual(r.state.players[1].prizes.length, 1, `應該自動取掉 2 張，實得剩 ${r.state.players[1].prizes.length}`);
  assert.strictEqual(r.state.players[1].hand.length, 2, '取走的獎賞沒有進手牌');
});
T('B4. ⭐ 正常情形：候選重算，且 v6.215 契約只准改 params', () => {
  const fn = REFRESH.get('take-prize-choose'); assert.ok(fn, 'refresher 不存在');
  const st = mk(true, false);
  const sel = mkSel(1, 1);
  const r = fn(st, sel, pool);
  assert.ok(r.sel, 'picker 不該被丟掉');
  const opts = r.sel.params.options || [];
  assert.ok(!opts.some((o) => o.id === 'stale'), '候選沒有重算（還留著過期選項）');
  const faceUpIid = st.players[1].prizes.find((c) => c.faceUp).iid;
  assert.ok(opts.some((o) => o.id === faceUpIid), `重算後的候選沒有含現在翻正面的那張（${faceUpIid}）`);
  assert.ok(opts.some((o) => o.id === '__prize_random_facedown__'), '少了「隨機取一張蓋著的」出口');
  for (const k of ['type', 'effectKey', 'actorIdx', 'sourcePlayerIdx', 'minCount', 'maxCount']) {
    assert.strictEqual(r.sel[k], sel[k], `refresher 改了不准改的欄位：${k}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】端到端：站長回報情境的延伸（雙方獎賞區都有正面朝上的卡）
// ══════════════════════════════════════════════════════════════════════════════
const ai = (WHEEL.attacks || []).findIndex((a) => a.name === '悔念錨');
/** 破破舵輪｜悔念錨打死耿鬼ex（240 傷 + 170）；死亡宣告擲到正面為止（最多 40 次）。 */
function fireHeads() {
  for (let k = 0; k < 40; k++) {
    const es = (WHEEL.attacks[ai].cost || []).map((t) => en(t));
    for (let j = 0; j < 3; j++) es.push(en());
    const discard = [inst(HIDE.id), inst(HIDE.id), inst(HIDE.id), inst(HIDE.id)];
    const P0 = { name: '路邊的訓練家', active: inst(WHEEL.id, es), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id), inst(PLAIN.id)], discard, prizes: [inst(PLAIN.id, [], { faceUp: true }), inst(PLAIN.id), inst(PLAIN.id)] };
    const P1 = { name: 'hhhan', active: inst(GENGAR.id, [en('Darkness')], { damage: 240 }), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [], prizes: [inst(PLAIN.id, [], { faceUp: true }), inst(PLAIN.id)] };
    let st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players: [P0, P1],
    };
    const o = M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
    st = o?.state ?? o;
    const logs = (st.log || []).map((l) => (typeof l === 'string' ? l : l.message));
    if (logs.some((L) => /死亡宣告/.test(L) && /正面/.test(L))) return { after: st, logs, tries: k + 1 };
  }
  return null;
}
const E2E = fireHeads();
T('C0. 前置：死亡宣告擲到正面、破破舵輪確實昏厥（否則下面是空真）', () => {
  assert.ok(E2E, '40 次都沒擲到正面（亂數或卡片挑選壞了）');
  assert.ok(E2E.logs.some((L) => /死亡宣告/.test(L) && /昏厥/.test(L)), '死亡宣告沒有讓攻擊方昏厥');
});
T('C1. ⭐⭐⭐【HEAD-FAIL】攻擊方的 picker 在最上面，耿鬼方的 picker **排在佇列裡**', () => {
  assert.ok(E2E, '前置不成立');
  assert.strictEqual(E2E.after.pendingSelection?.effectKey, 'take-prize-choose', '最上面不是取獎賞 picker');
  assert.strictEqual(E2E.after.pendingSelection?.actorIdx, 0, '最上面的 picker 不是攻擊方的');
  const q = (E2E.after.pendingChainQueue ?? []).filter((s) => s.effectKey === 'take-prize-choose' && s.actorIdx === 1);
  assert.strictEqual(q.length, 1, `耿鬼方的 picker 沒有排進佇列（queue=${JSON.stringify((E2E.after.pendingChainQueue ?? []).map((s) => s.effectKey + '@' + s.actorIdx))}）`);
});
T('C2. ⭐⭐⭐【HEAD-FAIL】耿鬼方的獎賞在輪到他選之前，一張都不准被自動取走', () => {
  assert.ok(E2E, '前置不成立');
  assert.strictEqual(E2E.after.players[1].prizes.length, 2,
    `耿鬼方的獎賞被提前取走了（剩 ${E2E.after.players[1].prizes.length}，應為 2）—— 這正是 v6.418 修的實害`);
});
T('C3. ⭐ 解掉攻擊方那個 picker 之後，耿鬼方的 picker 會浮上來', () => {
  assert.ok(E2E, '前置不成立');
  const top = E2E.after.pendingSelection;
  const pickId = (top.params?.options ?? [])[0]?.id;
  assert.ok(pickId, 'picker 沒有候選可選');
  const o = M.applyAction(E2E.after, { type: 'RESOLVE_SELECTION', selectedIids: [pickId] }, pool);
  const st2 = o?.state ?? o;
  assert.strictEqual(st2.pendingSelection?.effectKey, 'take-prize-choose', '第二個 picker 沒有浮上來');
  assert.strictEqual(st2.pendingSelection?.actorIdx, 1, `浮上來的不是耿鬼方的 picker（actorIdx=${st2.pendingSelection?.actorIdx}）`);
  assert.ok((st2.pendingSelection.params?.options ?? []).some((x) => x.id !== '__prize_random_facedown__'),
    '耿鬼方的 picker 沒有可指定的正面朝上選項');
});

T('C4. ⭐⭐【反安慰劑：型態 12】engine 從佇列取出時**真的**呼叫了 refresher', () => {
  // ⚠ C3 分不出「有沒有重算」—— 那個情境裡入列當下算好的 options 與重算後**恰好同值**
  //   （審查者實測：把 engine 的 `PENDING_REFRESH_ON_POP.get(...)` 短路掉，C1～C3 照樣全綠）。
  //   ⇒ 這裡刻意讓佇列裡那一筆帶**明顯過期**的 params，重算與不重算的答案才會不同。
  const st = mk(true, false);
  const stale = mkSel(1, 1);                       // params.options = [{id:'stale'}]、titleOverride='舊標題'
  const top = { ...mkSel(0, 1), params: { remaining: 1, options: buildTopOptions(st, 0) } };
  const s0 = { ...st, pendingSelection: top, pendingChainQueue: [stale] };
  const pick = (top.params.options || [])[0]?.id;
  assert.ok(pick, '第一個 picker 沒有候選');
  const o = M.applyAction(s0, { type: 'RESOLVE_SELECTION', selectedIids: [pick] }, pool);
  const s1 = o?.state ?? o;
  assert.strictEqual(s1.pendingSelection?.effectKey, 'take-prize-choose', '第二個 picker 沒有浮上來');
  const opts = s1.pendingSelection.params?.options || [];
  assert.ok(!opts.some((x) => x.id === 'stale'),
    'engine 把佇列裡的過期 params 原封浮上來了 ⇒ PENDING_REFRESH_ON_POP 沒有被呼叫');
  assert.ok(opts.length > 0, '重算後候選是空的');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】靜態：判準只准一份，且不得留著「已有 pending 就自動取」的短路
// ══════════════════════════════════════════════════════════════════════════════
const SH = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8')), '_shared.ts');
/**
 * ⭐ 用**結構 anchor** 截出 addPendingPrize 的函式體（禁寫死行數／長度：Rule 25-8）。
 *   從宣告開始，到下一個行首的 `export ` 之前為止；並斷言切片真的含有該有的特徵。
 */
function addPendingPrizeBlock() {
  const i = SH.indexOf('export function addPendingPrize(');
  assert.ok(i >= 0, 'anchor 失效（addPendingPrize 改名了？）');
  const rest = SH.slice(i + 10);
  const j = rest.search(/\nexport /);
  const blk = j >= 0 ? SH.slice(i, i + 10 + j) : SH.slice(i);
  assert.ok(blk.length > 200 && blk.length < 4000, `切片長度異常（${blk.length}）⇒ anchor 可能失效`);
  assert.ok(/prizes\.some\(/.test(blk), '切片抓錯了：裡面沒有 faceUp 判斷');
  assert.ok(/\n\}/.test(blk), '切片內沒有函式收尾 ⇒ 視窗抓錯');
  return blk;
}
/** ⭐ 判準只寫一份（Rule 38）：D1（正式斷言）與 D3（正對照）共用它。 */
const hasAutoTakeShortcut = (blk) => /!\s*state\.pendingSelection/.test(blk);
T('D1. ⭐⭐【HEAD-FAIL】addPendingPrize 不得再用 `!state.pendingSelection` 當閘', () => {
  const blk = addPendingPrizeBlock();
  assert.ok(!hasAutoTakeShortcut(blk),
    '又把「已有 pending 就自動取」的短路加回來了 —— 玩家會失去指定獎賞的權利');
});
T('D2. ⭐ addPendingPrize 走中央 withPending（不得自己組 pendingSelection）', () => {
  const blk = addPendingPrizeBlock();
  assert.ok(/withPending\(/.test(blk), '沒有走中央 withPending ⇒ 不會排隊');
  assert.ok(!/pendingSelection:\s*\{/.test(blk), '就地組了 pendingSelection（繞過排隊機制）');
});
T('D3.【正對照】D1 的判準抓得到 BASE 的寫法（不是恆真）', () => {
  const sample = 'if (takerPeek.prizes.some(c => c.faceUp) && !state.pendingSelection) { return 1; }';
  assert.ok(hasAutoTakeShortcut(sample), 'D1 的判準壞了：BASE 的寫法竟然抓不到');
  assert.ok(!hasAutoTakeShortcut('if (takerPeek.prizes.some(c => c.faceUp)) { return 1; }'),
    'D1 的判準壞了：本版的寫法竟然被誤判');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【E】⚠⚠ 列管（**不是斷言「正確」，是把現況釘住等站長裁定**）
//   ——「雙方同時取完最後一張獎賞」時，有沒有 picker 會影響勝負。
//
// 情境：P0 剩 2 張獎賞、打死耿鬼ex（ex ⇒ 2 張）；死亡宣告正面 ⇒ P0 的破破舵輪昏厥、
//       P1 剩 1 張獎賞也取完 ⇒ **雙方同時取得所有獎賞卡**。
//
//   ・雙方都**沒有** faceUp（不開 picker，兩邊同步自動取）
//       ⇒ 走中央 `judgeEndgameV6361` ⇒ **平手**（v6.361 站長裁定 D-10／D-11）。✅
//   ・雙方都**有** faceUp（開 picker）
//       ⇒ `takeSpecificPrizes` 自己就寫死 `winner: ownerIdx`、繞過中央判定
//       ⇒ **先取完的那一方獲勝**，對手排在佇列裡的那一筆永遠不會被兌現。❌
//
// ⚠⚠ **這是既有 bug，不是 v6.418 引入的**（已實測 BASE v6.417：同一個盤面判 winner=1
//   ——「自動取」的那一方先取完先贏；本版改成排隊之後變成先解 picker 的 winner=0）。
//   ⇒ 本版**刻意不修**：它牽涉終局判定與錦標賽勝負，屬於站長裁定範圍（要平手還是先取者勝），
//     而且與本版要修的「指定權被剝奪」是兩件事。這一段先把現況釘住，避免無聲漂移。
// ══════════════════════════════════════════════════════════════════════════════
/** 打造「雙方同時取完」的終局盤面；`faceUp` 決定會不會開 picker。 */
function fireEndgame(faceUp) {
  for (let k = 0; k < 40; k++) {
    const es = (WHEEL.attacks[ai].cost || []).map((t) => en(t));
    for (let j = 0; j < 3; j++) es.push(en());
    const discard = [inst(HIDE.id), inst(HIDE.id), inst(HIDE.id), inst(HIDE.id)];
    const fu = faceUp ? { faceUp: true } : {};
    const P0 = { name: 'ATK', active: inst(WHEEL.id, es), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard, prizes: [inst(PLAIN.id, [], fu), inst(PLAIN.id)] };
    const P1 = { name: 'GEN', active: inst(GENGAR.id, [en('Darkness')], { damage: 240 }), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [], prizes: [inst(PLAIN.id, [], fu)] };
    let st = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players: [P0, P1],
    };
    const o = M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
    st = o?.state ?? o;
    const logs = (st.log || []).map((l) => (typeof l === 'string' ? l : l.message));
    if (!logs.some((L) => /死亡宣告/.test(L) && /正面/.test(L))) continue;
    // 有 picker 的話解到底
    for (let step = 0; step < 4 && st.pendingSelection && st.phase === 'playing'; step++) {
      const opt = (st.pendingSelection.params?.options ?? [])[0]?.id;
      if (!opt) break;
      const r = M.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [opt] }, pool);
      st = r?.state ?? r;
    }
    return st;
  }
  return null;
}
T('E1.【對照】雙方都沒有正面朝上的獎賞（不開 picker）⇒ 中央判定給**平手**', () => {
  const st = fireEndgame(false);
  assert.ok(st, '40 次都沒擲到正面');
  assert.strictEqual(st.phase, 'game-over', '沒有終局');
  assert.ok(st.winner === null || st.winner === undefined,
    `應該平手，實得 winner=${st.winner}（現況變了 ⇒ 這一段的列管描述要重寫）`);
});
T('E2. ⚠⚠【列管・待站長裁定】雙方都有正面朝上的獎賞（開 picker）⇒ 現況是「先解的那一方獲勝」', () => {
  const st = fireEndgame(true);
  assert.ok(st, '40 次都沒擲到正面');
  assert.strictEqual(st.phase, 'game-over', '沒有終局');
  assert.strictEqual(st.winner, 0,
    `現況是 winner=0（先解 picker 的 ATK）。實得 ${st.winner}`
    + ' —— 若這一條紅了，代表有人改了終局判定，請回來確認是不是站長裁定要改成平手');
  assert.strictEqual(st.players[1].prizes.length, 1,
    '現況：對手排在佇列裡的那一筆沒有被兌現（獎賞還留著）');
});

console.log(`\n=== v6.418 取獎賞 picker 排隊：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
