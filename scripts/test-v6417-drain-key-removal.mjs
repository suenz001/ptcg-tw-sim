// v6.417 守衛：`drainOnKoAfterPrize` 必須**移除** `_onKoAfterPrize` 這個 key，
//              而不是把它設成 `undefined`；並列管「正面朝上獎賞」的 drain 時機。
//
// 【為什麼】`{ ...state, _onKoAfterPrize: undefined }` 會讓 key **仍然存在**
//   （`'_onKoAfterPrize' in obj === true`）。而 delta patch 的差分判準
//   （`oracle-client.ts` 的 `buildRoomPatch`）是：
//       if (!(k2 in ns)) { if (k2 in bs) del.push(p); continue; }
//       ...
//       if (!_dpEq(bs[k2], ns[k2])) set[p] = ns[k2];
//   ⇒ 留著 key 就走 `set[p] = undefined`，而那個 patch 一旦被 `JSON.stringify`
//   送上線，`undefined` 會被整個丟掉 ⇒ **伺服器端的舊佇列永遠刪不掉**。
//
// ⚠⚠ **誠實標記：這不是在修一個現行 bug。** 已自行查證 `oracleUpsertRoomDelta` 的
//   `next = JSON.parse(JSON.stringify(data))` 會先把 undefined 的 key 抹掉
//   ⇒ 實際走的是 `del`、行為正確。本版拆的是「只要有人改動推送順序就會引爆」的地雷。
//   ⇒ 所以 B 段既要證明「現在 key 真的不見了」，也要證明「行為逐位元不變」。
//
// 【HEAD-FAIL】BASE（v6.416）上 B1／B2／C1 紅。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x417-s.js'), E = join(ROOT, '.x417-e.ts'), O = join(ROOT, '.x417-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export * as EFF from './src/lib/game/effects';\n"
  + "export { buildRoomPatch } from './src/lib/game/oracle-client';\n"
  + "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);
const { applyAction, buildRoomPatch } = M;

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
const WHEEL = cards.find((c) => c.name === '破破舵輪' && (c.attacks || []).some((a) => a.name === '悔念錨'));
const HIDE = byAb('化隱');
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
const ai = (WHEEL.attacks || []).findIndex((a) => a.name === '悔念錨');

/** 耿鬼ex（已受 240 傷）被破破舵輪｜悔念錨（170）打死。`faceUpPrize` 讓攻擊方的獎賞區有正面朝上的卡。 */
function fire(faceUpPrize = false) {
  const es = (WHEEL.attacks[ai].cost || []).map((t) => en(t));
  for (let k = 0; k < 3; k++) es.push(en());
  const discard = [inst(HIDE.id), inst(HIDE.id), inst(HIDE.id), inst(HIDE.id)];
  const prizes = [inst(PLAIN.id, [], faceUpPrize ? { faceUp: true } : {}), inst(PLAIN.id), inst(PLAIN.id)];
  const P0 = { name: '路邊的訓練家', active: inst(WHEEL.id, es), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id), inst(PLAIN.id)], discard, prizes };
  const P1 = { name: 'hhhan', active: inst(GENGAR.id, [en('Darkness')], { damage: 240 }), bench: [inst(PLAIN.id)], hand: [], deck: [inst(PLAIN.id)], discard: [], prizes: [inst(PLAIN.id), inst(PLAIN.id)] };
  let st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players: [P0, P1],
  };
  const before = st;
  const o = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
  st = o?.state ?? o;
  return { before, after: st, logs: (st.log || []).map((l) => (typeof l === 'string' ? l : l.message)) };
}

// ══════════════════════════════════════════════════════════════════════════════
// 【B】行為端：drain 之後 key 必須整個不見（而不是留著一個 undefined）
// ══════════════════════════════════════════════════════════════════════════════
T('B0. 基準盤面成立：死亡宣告真的入列並被 drain（否則下面是空真）', () => {
  const r = fire();
  assert.ok(r.logs.some((L) => /死亡宣告/.test(L) && /擲硬幣/.test(L)),
    `死亡宣告沒有被 drain：\n    ${r.logs.slice(-6).join('\n    ')}`);
});
T('B1. ⭐⭐⭐【HEAD-FAIL】drain 之後 `_onKoAfterPrize` 這個 key 必須**不存在**', () => {
  const r = fire();
  assert.ok(!('_onKoAfterPrize' in r.after),
    "drain 之後 key 還在（值是 " + String(r.after._onKoAfterPrize) + "）"
    + ' —— delta patch 的差分判準是 `k in ns`，留著 key 就不會走 del');
});
T('B2. ⭐⭐⭐【HEAD-FAIL】delta patch 必須把它列進 `del`（而不是 set 成 undefined）', () => {
  const r = fire();
  // ⚠ 這裡**刻意不做** JSON round-trip：正式路徑（oracleUpsertRoomDelta）會先 round-trip，
  //   兩種寫法都會正確；本條守的正是「如果哪天少了那道 round-trip，會怎樣」。
  const base = { gameState: { ...r.before, _onKoAfterPrize: [{ ability: '死亡宣告' }] } };
  const next = { gameState: r.after };
  const patch = buildRoomPatch(base, next, false);
  assert.ok(patch, 'buildRoomPatch 回 null（結構變了？）');
  const key = 'gameState._onKoAfterPrize';
  assert.ok((patch.del || []).includes(key),
    `patch 沒有把它列進 del：del=${JSON.stringify(patch.del)} set 裡有沒有它=${key in (patch.set || {})}`);
  assert.ok(!(key in (patch.set || {})), 'patch 把它放進 set（值會被 JSON.stringify 丟掉 ⇒ 伺服器端刪不掉）');
});
T('B3. ⭐⭐【行為零改變】走正式路徑（JSON round-trip）時，兩種寫法的結果逐位元相同', () => {
  // ⚠ 這一條是**誠實標記**：本版不是在修現行 bug。
  //   `oracleUpsertRoomDelta` 的 `next = JSON.parse(JSON.stringify(data))` 會先抹掉
  //   undefined 的 key ⇒ 舊寫法在正式路徑上本來就走 del。這裡把那個事實釘住。
  const r = fire();
  const oldStyle = { ...r.after, _onKoAfterPrize: undefined };   // 模擬 BASE 的寫法
  const rt = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(rt(oldStyle), rt(r.after),
    'round-trip 之後兩種寫法竟然不同 ⇒ 本版不是「行為零改變」，必須重新評估');
  const base = { gameState: { ...r.before, _onKoAfterPrize: [{ ability: '死亡宣告' }] } };
  const pOld = buildRoomPatch(rt(base), rt({ gameState: oldStyle }), false);
  const pNew = buildRoomPatch(rt(base), rt({ gameState: r.after }), false);
  assert.deepStrictEqual(pOld, pNew, '正式路徑（round-trip 後）的 patch 竟然不同');
});
T('B4.【正對照】B2 的判準抓得到「留著 undefined」的樣本（不是恆真）', () => {
  const r = fire();
  const base = { gameState: { ...r.before, _onKoAfterPrize: [{ ability: '死亡宣告' }] } };
  const bad = { gameState: { ...r.after, _onKoAfterPrize: undefined } };
  const patch = buildRoomPatch(base, bad, false);
  const key = 'gameState._onKoAfterPrize';
  assert.ok(patch, 'buildRoomPatch 回 null');
  assert.ok(!(patch.del || []).includes(key),
    'B2 的判準壞了：留著 undefined 的樣本竟然也走 del');
  assert.ok(key in (patch.set || {}), 'B2 的判準壞了：留著 undefined 的樣本沒進 set');
});

// ══════════════════════════════════════════════════════════════════════════════
// 【C】靜態
// ══════════════════════════════════════════════════════════════════════════════
const EFF = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')), 'effects.ts');
T('C1. ⭐⭐【HEAD-FAIL】drainOnKoAfterPrize 不得再用 `_onKoAfterPrize: undefined`', () => {
  const i = EFF.indexOf('export function drainOnKoAfterPrize(');
  assert.ok(i >= 0, 'anchor 失效');
  const blk = EFF.slice(i, i + 1600);
  assert.ok(/^\s*\}/m.test(blk), '切片內沒有函式收尾');
  assert.ok(!/_onKoAfterPrize:\s*undefined/.test(blk),
    '又改回 `_onKoAfterPrize: undefined` 了 —— delta patch 會走 set 而不是 del');
  assert.ok(/delete\s+\w+\._onKoAfterPrize/.test(blk), '沒有用 delete 移除 key');
});
T('C2. ⭐ 全站只有一個 drain 呼叫點（v6.355 的架構不得被動）', () => {
  const eng = stripCommentsBlankChecked(normEol(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8')), 'engine.ts');
  const calls = (eng.match(/drainOnKoAfterPrize\(/g) || []).length;
  assert.strictEqual(calls, 1, `engine.ts 有 ${calls} 個 drain 呼叫點（應為 1）`);
});

// ══════════════════════════════════════════════════════════════════════════════
// 【D】列管：正面朝上的獎賞 ⇒ 「獎賞排隊了但還沒發」時 drain 就跑了
//   ⚠⚠ **這一段不是在斷言「正確」，是把現況釘住**，等站長裁定後再改。
//   官方規則（PTCG RULES/PTCG_RULES.md §12）只寫「昏厥 → 丟棄 → 抽獎賞卡 → 補位」，
//   **沒有**明文規定「昏厥時觸發的特性」與「取獎賞」誰先 ⇒ 這是設計裁定，不是規則事實。
// ══════════════════════════════════════════════════════════════════════════════
T('D1. 列管：攻擊方獎賞區有正面朝上的卡時，會開 take-prize-choose picker 且獎賞**還沒發**', () => {
  const r = fire(true);
  assert.strictEqual(r.after.pendingSelection?.effectKey, 'take-prize-choose',
    `應該開 take-prize-choose picker，實得 ${r.after.pendingSelection?.effectKey}`);
  assert.strictEqual(r.after.players[0].prizes.length, 3,
    `獎賞應該還沒發（仍是 3 張），實得 ${r.after.players[0].prizes.length}`);
});
T('D2. 列管：即使獎賞還沒發，死亡宣告仍然已經結算（現況；待站長裁定是否要改）', () => {
  const r = fire(true);
  assert.ok(r.logs.some((L) => /死亡宣告/.test(L) && /擲硬幣/.test(L)),
    '死亡宣告沒有結算 —— 現況變了，這一條的列管描述需要重寫');
  assert.strictEqual((r.after._onKoAfterPrize || []).length, 0, '佇列沒有被清空');
});
T('D3.【對照】獎賞全部蓋著時：獎賞當場就發、死亡宣告也結算（兩者都完成）', () => {
  const r = fire(false);
  assert.strictEqual(r.after.pendingSelection, null, '不該開 picker');
  assert.strictEqual(r.after.players[0].prizes.length, 1,
    `獎賞應該已經發掉 2 張（剩 1），實得 ${r.after.players[0].prizes.length}`);
  assert.ok(r.logs.some((L) => /死亡宣告/.test(L) && /擲硬幣/.test(L)), '死亡宣告沒有結算');
});

console.log(`\n=== v6.417 drain key 移除／正面朝上獎賞列管：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
