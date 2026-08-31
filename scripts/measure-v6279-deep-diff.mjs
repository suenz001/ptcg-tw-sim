#!/usr/bin/env node
/**
 * v6.279 client 深層 diff — 量測腳本（Rule 32：效能／成本數字必須附量測腳本）
 *
 * 做什麼：跑 **AI vs AI 真對局**，把每一次盤面變化包成真實房間 doc（seats／log／
 * gameState 全都在），對每一個動作量三種上行 body 的位元組數：
 *   A) FULL  ＝ v6.267 以前的全量 PUT（{data,expectedVersion}）
 *   B) TWO   ＝ v6.270 的兩層 patch（buildRoomPatch(base,next,false)）
 *   C) DEEP  ＝ v6.279 的深層 patch（buildRoomPatch(base,next,true)）
 * 三者都套用出貨端**同一份** 60% 門檻（patch 比全量的 60% 還大 ⇒ 送全量），
 * 所以印出來的數字就是玩家實際會送出去的位元組數。
 * 另外量 client 端 diff＋hash＋序列化的耗時（p50/p95/p99）。
 *
 * ⚠ 用的是 src/lib/game/oracle-client.ts 的**出貨函式**，不是另抄一份。
 * 用法：node scripts/measure-v6279-deep-diff.mjs [對局數，預設 3]
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.tmp-v6279-bundle.mjs');
const ENTRY = join(ROOT, '.tmp-v6279-entry.ts');
writeFileSync(ENTRY, `
  export { createGame, applyAction } from './src/lib/game/engine';
  export { getAIAction } from './src/lib/game/ai';
  export { buildRoomPatch, deltaPutCanonHash } from './src/lib/game/oracle-client';
`);
await build({ entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm',
  platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': join(ROOT, 'scripts/shim-app-paths.mjs') },
  logLevel: 'error' });
unlinkSync(ENTRY);
const M = await import(pathToFileURL(OUT).href + '?t=' + Date.now());
unlinkSync(OUT);

const pool = new Map();
const cardsDir = join(ROOT, 'static/cards');
for (const f of readdirSync(cardsDir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(cardsDir, f), 'utf8'))) pool.set(String(c.id), c);
}
const PRESETS = {
  MBG: { name: '超級耿鬼ex', entries: [['14129',4],['14130',2],['14151',1],['14131',2],['14132',2],['14133',1],['14134',2],['14135',1],['14136',1],['14137',1],['14138',1],['14139',3],['14140',4],['14141',3],['14142',1],['14143',1],['14144',1],['14145',1],['14146',2],['14147',2],['14148',4],['14149',2],['14150',4],['14152',14]].map(([cardId,count])=>({cardId,count})) },
  MBD: { name: '超級蒂安希ex', entries: [['14105',2],['14106',1],['14107',1],['14108',1],['14109',1],['14127',1],['14110',2],['14111',1],['14112',3],['14113',3],['14114',1],['14115',1],['14116',1],['14117',3],['14118',4],['14119',1],['14120',1],['14121',4],['14122',2],['14123',4],['14124',2],['14125',4],['14126',2],['14128',14]].map(([cardId,count])=>({cardId,count})) },
};

const U8 = (s) => Buffer.byteLength(s, 'utf8');
const FULL_RATIO = 0.6;

/** 真實房間 doc 的外殼（欄位取自 room-oracle.ts 的 RoomData／emptySeats）。 */
function wrapRoom(gs, ver) {
  const seats = [
    { role: 'p1', uid: 'uid-p1', name: '玩家一', deckEntries: null, deckId: 'd1', ready: true, firstChoicePreference: 'random' },
    { role: 'p2', uid: 'uid-p2', name: '玩家二', deckEntries: null, deckId: 'd2', ready: true, firstChoicePreference: 'random' },
  ];
  for (let i = 0; i < 8; i++) seats.push({ role: 'spectator', uid: null, name: null, deckEntries: null, deckId: null, ready: false, firstChoicePreference: 'random' });
  return { _id: 'AB12', _version: ver, status: 'playing', name: '練習房', createdAt: 1756000000000,
    updatedAt: 1756000000000 + ver * 1000, hostUid: 'uid-p1', memberUids: ['uid-p1', 'uid-p2'],
    heartbeats: { 'uid-p1': 1756000000000 + ver * 1000, 'uid-p2': 1756000000000 + ver * 900 },
    seatLayoutVersion: 1, idleTimeoutSec: 180, seats, gameState: gs };
}

/** 出貨端的三選一：patch 超過全量 60% ⇒ 退全量。回 [bytes, kind]。 */
function bodyBytesOf(base, next, ev, deep) {
  const fullStr = JSON.stringify(next);
  const fullBytes = U8(fullStr) + 28 + String(ev).length;
  let patch = null;
  try { patch = M.buildRoomPatch(base, JSON.parse(fullStr), deep); } catch { patch = null; }
  if (!patch) return [fullBytes, 'full'];
  const body = { patchProto: 1, patch, fullHash: M.deltaPutCanonHash(JSON.parse(fullStr)), expectedVersion: ev };
  const s = JSON.stringify(body);
  if (s.length > fullStr.length * FULL_RATIO) return [fullBytes, 'full'];
  return [U8(s), deep ? 'deep' : 'two'];
}

const games = Number(process.argv[2] || 3);
const rowsFull = [], rowsTwo = [], rowsDeep = [], tDeep = [], tTwo = [];
let kinds = { deep: 0, two: 0, full: 0 };
const J = (x) => JSON.stringify(x);

for (let g = 0; g < games; g++) {
  let state = M.createGame({ name: PRESETS.MBG.name, entries: PRESETS.MBG.entries },
                           { name: PRESETS.MBD.name, entries: PRESETS.MBD.entries }, pool);
  let ver = 1, iter = 0, stuck = 0, lastRej = '';
  let prevRoom = JSON.parse(J(wrapRoom(state, ver)));
  while (state.phase !== 'game-over' && iter < 4000) {
    iter++;
    let actorIdx;
    if (state.phase === 'setup') {
      const mul = state.pendingMulliganDraw ?? [0, 0];
      if (mul[0] > 0) actorIdx = 0; else if (mul[1] > 0) actorIdx = 1;
      else actorIdx = !state.setupDone[0] ? 0 : (!state.setupDone[1] ? 1 : 0);
    } else if (state.pendingSelection) actorIdx = state.pendingSelection.actorIdx;
    else if (state.players[0].active === null && state.players[0].bench.length > 0) actorIdx = 0;
    else if (state.players[1].active === null && state.players[1].bench.length > 0) actorIdx = 1;
    else actorIdx = state.activePlayerIndex;
    const action = M.getAIAction(state, pool, actorIdx);
    if (!action) break;
    let next; try { next = M.applyAction(state, action, pool); } catch { break; }
    if (J(next) === J(state)) { const h = J(action); stuck = (h === lastRej) ? stuck + 1 : 1; lastRej = h; if (stuck > 30) break; state = next; continue; }
    stuck = 0; state = next; ver++;
    const nextRoom = JSON.parse(J(wrapRoom(state, ver - 1)));   // ⚠ PUT 送的是 expectedVersion=舊版本
    const [bF] = [J(nextRoom).length + 28 + String(ver - 1).length];
    const t1 = process.hrtime.bigint(); const [bT] = bodyBytesOf(prevRoom, nextRoom, ver - 1, false); tTwo.push(Number(process.hrtime.bigint() - t1) / 1e6);
    const t2 = process.hrtime.bigint(); const [bD, kD] = bodyBytesOf(prevRoom, nextRoom, ver - 1, true); tDeep.push(Number(process.hrtime.bigint() - t2) / 1e6);
    rowsFull.push(U8(J(nextRoom)) + 28 + String(ver - 1).length); rowsTwo.push(bT); rowsDeep.push(bD);
    kinds[kD]++;
    prevRoom = nextRoom;
  }
  process.stderr.write(`  對局 ${g + 1}：${iter} 動作，phase=${state.phase}\n`);
}

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log('\n═══ v6.279 深層 diff：真對局上行位元組實測（n=' + rowsFull.length + ' 次 PUT） ═══');
const fmt = (a) => `p50=${q(a,.5).toLocaleString()}  p90=${q(a,.9).toLocaleString()}  p99=${q(a,.99).toLocaleString()}  總計=${(sum(a)/1024/1024).toFixed(2)}MB`;
console.log('A) 全量 (v6.267-)   ' + fmt(rowsFull));
console.log('B) 兩層 (v6.270)    ' + fmt(rowsTwo)  + `   總量省 ${(100 - sum(rowsTwo) / sum(rowsFull) * 100).toFixed(1)}%`);
console.log('C) 深層 (v6.279)    ' + fmt(rowsDeep) + `   總量省 ${(100 - sum(rowsDeep) / sum(rowsFull) * 100).toFixed(1)}%`);
console.log('   深層相對兩層再省 ' + (100 - sum(rowsDeep) / sum(rowsTwo) * 100).toFixed(1) + '%');
console.log('   深層送出的種類：deep=' + kinds.deep + ' two=' + kinds.two + ' full=' + kinds.full + '（full＝60% 門檻退回全量）');
console.log('\n─ client 端 diff＋hash＋序列化耗時（沙盒 CPU，正式裝置更快）─');
console.log('   兩層 p50=' + q(tTwo, .5).toFixed(2) + 'ms  p95=' + q(tTwo, .95).toFixed(2) + 'ms  p99=' + q(tTwo, .99).toFixed(2) + 'ms  max=' + Math.max(...tTwo).toFixed(2) + 'ms');
console.log('   深層 p50=' + q(tDeep, .5).toFixed(2) + 'ms  p95=' + q(tDeep, .95).toFixed(2) + 'ms  p99=' + q(tDeep, .99).toFixed(2) + 'ms  max=' + Math.max(...tDeep).toFixed(2) + 'ms');
