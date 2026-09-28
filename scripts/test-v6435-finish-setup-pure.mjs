// 守衛 v6.435：FINISH_SETUP（放獎賞卡）不可以改到「傳進去的舊 state」（引擎是純函式）
//
// 【bug】engine.ts 的 FINISH_SETUP：`const player = { ...state.players[pIdx] }` 只是淺拷貝，
//   接著 `player.deck.shift()` 取 6 張當獎賞卡 ⇒ **舊 state 的牌庫陣列被一起改掉**：
//   舊 state 牌庫少 6 張、獎賞卡卻還是空的 ⇒ 6 張卡從舊 state 憑空消失。
//   任何拿舊 state 的地方（AI 試打、回放、錦標賽樂觀更新回滾）都會讀到壞資料。
//   臨時診斷（30 局 AI 對 AI、5,146 次 applyAction，逐次比對呼叫前後的舊 state）：FINISH_SETUP 60 次全中。
// 【修法】改用 slice 產生新陣列；取牌順序（牌庫最上方依序 6 張）不變。
//
// HEAD-FAIL（BASE＝v6.434 8f9f7ea9，engine.ts 換回 BASE blob 實跑）：P1、P2 紅；P3（取牌順序）綠 —— 本版不改順序。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6435f-s.js'), E = join(ROOT, '.x-v6435f-e.ts'), O = join(ROOT, '.x-v6435f-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const BASIC = '17038';   // 卡比獸（基礎）——整副都是基礎寶可夢，開局一定有可上場的卡
assert.equal(pool.get(BASIC)?.stage ?? 'Basic', 'Basic');

let pass = 0, fail = 0;
const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n); } };

/** 開一局、雙方都放好戰鬥寶可夢（還沒按 FINISH_SETUP） */
function readyToFinish(seed) {
  const orig = Math.random; let x = seed;
  Math.random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  try {
    let st = createGame({ name: 'A', entries: [{ cardId: BASIC, count: 60 }] }, { name: 'B', entries: [{ cardId: BASIC, count: 60 }] }, pool);
    for (const p of [0, 1]) {
      const iid = st.players[p].hand[0].iid;
      const nx = applyAction(st, { type: 'PLACE_ACTIVE', iid, senderIdx: p, playerIdx: p }, pool);
      assert.ok(nx !== st && nx.players[p].active, '前提：PLACE_ACTIVE 沒成功（動作格式變了？）');
      st = nx;
    }
    return st;
  } finally { Math.random = orig; }
}
function finish(st, p) {
  return applyAction(st, { type: 'FINISH_SETUP', senderIdx: p, playerIdx: p }, pool);
}

T('P1 ⭐ FINISH_SETUP 之後，傳進去的舊 state 逐字不變（牌庫、獎賞卡都沒被改）', () => {
  const st = readyToFinish(11);
  for (const p of [0, 1]) {
    const snap = JSON.stringify(st);
    const nx = finish(st, p);
    assert.ok(nx !== st, '前提：FINISH_SETUP 被拒絕');
    assert.equal(JSON.stringify(st), snap, `玩家 ${p} 按 FINISH_SETUP 改到了舊 state`);
  }
});
T('P2 ⭐ 舊 state 的牌庫張數＋獎賞卡張數守恆（不會有 6 張卡憑空消失）', () => {
  const st = readyToFinish(23);
  const before = st.players[0].deck.length + st.players[0].prizes.length;
  finish(st, 0);
  assert.equal(st.players[0].deck.length + st.players[0].prizes.length, before, '舊 state 少了卡');
});
T('P3 取牌順序不變：獎賞卡＝按下前牌庫最上方依序 6 張，新牌庫＝其餘依序', () => {
  const st = readyToFinish(37);
  const deckBefore = st.players[1].deck.map((c) => c.iid);
  const nx = finish(st, 1);
  assert.deepEqual(nx.players[1].prizes.map((c) => c.iid), deckBefore.slice(0, 6));
  assert.deepEqual(nx.players[1].deck.map((c) => c.iid), deckBefore.slice(6));
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail) { console.log('紅：' + failed.join('、')); process.exit(1); }
