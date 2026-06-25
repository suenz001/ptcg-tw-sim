// 特性可用性 gate 雙向一致性實證:getUsableAbilities 條件不符排除 / 條件符合列出。
// 驗證 v4.4997/v5.519/v5.702 收斂後的 UI 側 gate 健全(碧綠之舞=手牌基本草 / 充能=棄牌基本能量)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-ag.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-ag.ts'); const O = join(ROOT, '.ent-ag.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { getUsableAbilities } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { getUsableAbilities } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const OGERPON = '16553', SPIDER = '14676';   // 厄鬼椪碧草面具ex(碧綠之舞) / 火箭隊操陷蛛(充能)
const GRASS = '11173', FIRE = '18518';
let nn = 0;
const inst = (cid, e = []) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e });
const card = (cid) => ({ iid: 'c' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkState = (active, hand = [], discard = [], deck = []) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false, log: [],
  pendingSelection: null, festivalDancePendingSecondAttack: undefined, activeStadium: null,
  players: [
    { name: 'P1', active, bench: [], hand, deck, discard, prizes: [], abilityNamesUsedThisTurn: [] },
    { name: 'P2', active: inst(OGERPON), bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
  ],
});
const hasAbility = (state, name) => getUsableAbilities(state, pool).some(a => a.abilityName === name);

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// 碧綠之舞:手牌有基本草→列出;無→排除
T('碧綠之舞:手牌有基本草能量 → 列出(可用)', () => {
  const st = mkState(inst(OGERPON), [card(GRASS)]);
  assert(hasAbility(st, '碧綠之舞'), '應列出');
});
T('碧綠之舞:手牌無基本草能量 → 排除(UI gate 生效)', () => {
  const st = mkState(inst(OGERPON), [card(FIRE)]);  // 只有火,無草
  assert(!hasAbility(st, '碧綠之舞'), '應排除');
});
// 充能:棄牌有基本能量→列出;無→排除
T('充能:棄牌有基本能量 → 列出(可用)', () => {
  const st = mkState(inst(SPIDER), [], [card(FIRE)]);
  assert(hasAbility(st, '充能'), '應列出');
});
T('充能:棄牌無基本能量 → 排除(UI gate 生效)', () => {
  const st = mkState(inst(SPIDER), [], []);  // 棄牌空
  assert(!hasAbility(st, '充能'), '應排除');
});
// 一回一次:abilityUsedThisTurn → 排除
T('一回一次:abilityUsedThisTurn=true → 排除', () => {
  const a = inst(OGERPON); a.abilityUsedThisTurn = true;
  const st = mkState(a, [card(GRASS)]);
  assert(!hasAbility(st, '碧綠之舞'), '已用應排除');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
