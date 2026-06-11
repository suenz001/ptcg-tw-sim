// v5.574：夜間學院（Stadium）— 選 1 張手牌放回牌庫上方。
//   玩家回報：①無法開效果 ②沒顯示放什麼牌回去、好像手牌也沒放回去。
//   查證：resolver 有移卡但「完全沒 addLog」→ 玩家看不到。補私密 log。本網驗證整個 USE_STADIUM→RESOLVE 確實移卡 + 有 log。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.na-e.ts'), O = join(ROOT, '.na-o.mjs'), S = join(ROOT, '.na-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const NIGHT_ACADEMY = '10646', ODDISH = '14319', PSY = '14103', POKEBALL_GUESS = '14319';
let iid = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++iid), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++iid), cardId: String(cid), damage: 0, energyAttached: [] });

function mk(handCards) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null,
    activeStadium: inst(NIGHT_ACADEMY), activeStadiumOwnerIdx: 0, stadiumUsedThisTurn: [false, false],
    setupDone: [true, true],
    players: [
      { active: inst(ODDISH), bench: [], hand: handCards, deck: [en(PSY), en(PSY)], discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: 'P0' },
      { active: inst(ODDISH), bench: [], hand: [], deck: Array.from({ length: 8 }, () => en(PSY)), discard: [], prizes: Array.from({ length: 6 }, () => en(PSY)), name: 'P1' },
    ],
  };
}
let pass = 0, fail = 0;
const ck = (label, cond, extra) => { if (cond) { pass++; console.log('  PASS', label); } else { fail++; console.log('  FAIL', label, extra || ''); } };
const hasLog = (s, kw) => s.log.some(l => (typeof l === 'string' ? l : (l.message || l.privateMessage || '')).includes(kw));

console.log('1) USE_STADIUM 夜間學院（手牌非空）→ 開 hand-choose picker（可開效果）');
let s = applyAction(mk([inst('19176'), inst(PSY)]), { type: 'USE_STADIUM' }, pool);
ck('應開 pendingSelection night-academy-top', s.pendingSelection && s.pendingSelection.effectKey === 'night-academy-top', 'pending=' + JSON.stringify(s.pendingSelection?.effectKey));

console.log('2) RESOLVE 選 1 張手牌 → 該卡移到牌庫上方 + 手牌 -1 + 有 log');
{
  const chosenIid = s.players[0].hand[0].iid;
  const chosenCardId = s.players[0].hand[0].cardId;
  const handBefore = s.players[0].hand.length, deckBefore = s.players[0].deck.length;
  const s2 = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [chosenIid] }, pool);
  ck('手牌 -1', s2.players[0].hand.length === handBefore - 1, `${handBefore}→${s2.players[0].hand.length}`);
  ck('牌庫 +1', s2.players[0].deck.length === deckBefore + 1, `${deckBefore}→${s2.players[0].deck.length}`);
  ck('選的卡移到牌庫「上方」(deck[0])', s2.players[0].deck[0] && s2.players[0].deck[0].iid === chosenIid, 'deck[0]=' + (s2.players[0].deck[0]?.cardId));
  ck('該卡已離開手牌', !s2.players[0].hand.some(c => c.iid === chosenIid));
  ck('有「夜間學院」log（先前完全沒 log）', hasLog(s2, '夜間學院'));
}

console.log('3) 手牌為空 → 不開 picker + 「手牌為空」log（不浪費使用次數）');
{
  const s3 = applyAction(mk([]), { type: 'USE_STADIUM' }, pool);
  ck('不開 pendingSelection', !s3.pendingSelection);
  ck('stadiumUsedThisTurn 未消耗（仍 false）', !(s3.stadiumUsedThisTurn ?? [false, false])[0]);
}

console.log('4) 已用過本回合 → 再按無效（不重複開）');
{
  const used = mk([inst(PSY)]); used.stadiumUsedThisTurn = [true, false];
  const s4 = applyAction(used, { type: 'USE_STADIUM' }, pool);
  ck('已用過 → 不開 picker', !s4.pendingSelection);
}

console.log('\n夜間學院 PASS ' + pass + ' / FAIL ' + fail);
process.exitCode = fail ? 1 : 0;
