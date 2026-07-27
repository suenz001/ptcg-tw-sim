// 守衛：AI 解「撤退費能量丟棄 picker」時必須用**單位數**而非張數（v6.039）。
//
// 【為什麼這是潛伏 bug】
// 撤退的 picker（effectKey='retreat-energy-discard'）在 resolver 端驗的是
//   `totalEnergyUnits(選中的能量) >= retreatCost`
// 也就是**單位數**。而 AI 的 active-energy-discard 分支對「自己的能量（成本）」
// 一律只取 minCount(=1) 張 —— 撤退費 2 而選中那張只有 1 unit 時，resolver 直接
// `return state`（動作被拒絕），AI 會對同一個動作無限重試而卡死。
//
// 這個 bug 在 v6.039 之前**永遠碰不到**，因為 AI 根本不會撤退（canRetreat 被 import
// 進 ai.ts 卻從未使用）。所以「教 AI 撤退」之前必須先補這裡，否則第一次撤退就卡死。
//
// ⚠反向也要釘：不能改成「一律取 maxCount」——火箭隊能量 1 張 = 2 units，撤退費 2 時
//   只該丟 1 張。丟多了是白白損失資源，而且不會有任何錯誤訊息。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-reu-s.js'), E = join(ROOT, '.x-reu-e.ts'), O = join(ROOT, '.x-reu-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, totalEnergyUnits } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, totalEnergyUnits, getAIAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const liveC = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveC.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// 卡面查證自 static/cards（台灣官方中文卡面）：
//   14085 拉普拉斯ex — 基礎 / HP210 / 撤退費 2
//   14086 願增猿     — 基礎 / HP110 / 撤退費 1（撤退後換上的那隻）
//   14102 基本【草】能量、14428 基本【火】能量、18519 基本【水】能量 = 各 1 unit
//   14853 火箭隊能量（特殊）— 卡面：「這張卡只可附於『火箭隊的寶可夢』身上…
//         只要這張卡附於寶可夢身上，視為提供2個【超】【惡】2種屬性的能量」= 2 units
//   12790 火箭隊的果然翁 — 基礎 / HP110 / 撤退費 2（火箭隊能量的**合法**宿主）
//   ⚠不可拿拉普拉斯ex 當火箭隊能量的宿主 —— 卡面明文禁止，那種場面本身不合法，
//     測出來的「單位數不足」是測試前提錯，不是程式碼錯。
const CID = { lapras: '14085', yaruki: '14086', grass: '14102', fire: '14428', water: '18519',
              rocket: '14853', wobb: '12790', def: '13163' };

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const base = () => createGame({ name: 'P1', entries: [{ cardId: CID.def, count: 1 }] },
                              { name: 'P2', entries: [{ cardId: CID.def, count: 1 }] }, pool);
function mk(activeInst, bench) {
  const s = base();
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(CID.def)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(CID.def)),
        active: activeInst, bench, retreatedThisTurn: false },
      { ...s.players[1], hand: [], deck: [inst(CID.def)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(CID.def)),
        active: inst(CID.def), bench: [] }] };
}

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：拉普拉斯ex 撤退費 2，且三種屬性能量會開 picker（不開就測不到東西）', () => {
  const promote = inst(CID.yaruki);
  const st = mk(inst(CID.lapras, [en(CID.grass), en(CID.fire), en(CID.water)]), [promote]);
  const after = applyAction(st, { type: 'RETREAT', newActiveIid: promote.iid }, pool);
  assert.ok(after.pendingSelection, '多屬性能量撤退應開 picker');
  assert.equal(after.pendingSelection.effectKey, 'retreat-energy-discard');
  assert.equal(after.pendingSelection.params?.retreatCost, 2, '撤退費應為 2');
  assert.equal(after.pendingSelection.minCount, 1, 'minCount 是 1 —— 正是這個 bug 的來源');
});

T('⭐⭐撤退費 2、每張 1 unit：AI 必須選到單位數達標，撤退要真的完成', () => {
  const promote = inst(CID.yaruki);
  const st = mk(inst(CID.lapras, [en(CID.grass), en(CID.fire), en(CID.water)]), [promote]);
  const opened = applyAction(st, { type: 'RETREAT', newActiveIid: promote.iid }, pool);
  const act = getAIAction(opened, pool, 0);
  assert.equal(act?.type, 'RESOLVE_SELECTION', 'AI 應回 RESOLVE_SELECTION');

  const picked = opened.players[0].active.energyAttached.filter((e) => act.selectedIids.includes(e.iid));
  const units = totalEnergyUnits(picked, pool, opened, 0, opened.players[0].active);
  assert.ok(units >= 2,
    `AI 只選了 ${act.selectedIids.length} 張共 ${units} 單位，不足撤退費 2 —— `
    + 'resolver 會 return state 把動作打回，AI 將對同一動作無限重試而卡死');

  const done = applyAction(opened, act, pool);
  assert.notEqual(done, opened, '動作不可被引擎拒絕（回傳同一個 state 就是被拒）');
  assert.equal(done.players[0].active?.iid, promote.iid, '撤退應真的完成，願增猿要上場');
  assert.equal(done.players[0].retreatedThisTurn, true);
  assert.equal(done.players[0].discard.length, act.selectedIids.length, '選中的能量應進棄牌區');
});

T('⭐⭐反向：火箭隊能量 1 張 = 2 單位 → 撤退費 2 只該丟 1 張（不可一律取滿）', () => {
  // 若把修法寫成「自方能量也取 maxCount」，這條會失敗 —— 多丟的能量是白白損失，
  // 而且畫面上不會有任何錯誤，只會讓 AI 顯得更笨。
  const promote = inst(CID.yaruki);
  const st = mk(inst(CID.wobb, [en(CID.grass), en(CID.rocket)]), [promote]);
  const opened = applyAction(st, { type: 'RETREAT', newActiveIid: promote.iid }, pool);
  assert.ok(opened.pendingSelection, '基本+特殊能量 signature 不同，應開 picker');
  const act = getAIAction(opened, pool, 0);
  const picked = opened.players[0].active.energyAttached.filter((e) => act.selectedIids.includes(e.iid));
  const units = totalEnergyUnits(picked, pool, opened, 0, opened.players[0].active);
  assert.ok(units >= 2, `單位數 ${units} 不足 2`);
  assert.equal(act.selectedIids.length, 1,
    `火箭隊能量 1 張就抵 2 單位，只該丟 1 張，實際丟了 ${act.selectedIids.length} 張`);
  const done = applyAction(opened, act, pool);
  assert.equal(done.players[0].active?.iid, promote.iid, '撤退應完成');
});

T('⭐AI 不會卡死：連續要它做決定，撤退流程能走完而不是反覆回同一個動作', () => {
  // 直接模擬「AI 自己驅動」的迴圈——這是真實對戰頁的行為。
  // 修正前這裡會一直停在同一個 pendingSelection 上（動作被拒 → state 不變 → 再問又是同一個）。
  const promote = inst(CID.yaruki);
  let st = applyAction(
    mk(inst(CID.lapras, [en(CID.grass), en(CID.fire), en(CID.water)]), [promote]),
    { type: 'RETREAT', newActiveIid: promote.iid }, pool);
  let guard = 0, stuck = 0;
  while (st.pendingSelection && guard++ < 10) {
    const act = getAIAction(st, pool, st.pendingSelection.actorIdx);
    if (!act) break;
    const next = applyAction(st, act, pool);
    if (next === st) { stuck++; if (stuck > 2) break; } else { stuck = 0; st = next; }
  }
  assert.equal(st.pendingSelection, null, `picker 未被解掉（迴圈 ${guard} 次）—— AI 卡死`);
  assert.equal(st.players[0].active?.iid, promote.iid);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
