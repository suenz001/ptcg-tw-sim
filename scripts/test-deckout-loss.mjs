/**
 * 核心規則回歸:回合開始時牌庫為空、必須抽牌卻抽不到 → 該玩家判負(對手獲勝)。
 *  (1) 後攻方(B)牌庫空,先攻方(A)END_TURN → 換 B 抽牌 → B 牌庫空 → game-over winner=A。
 *  (2) 無回歸:B 牌庫尚有 1 張 → END_TURN 後 B 正常抽到、不判負、進入 B 的回合。
 * applyAutoDraw 於 tryAdvanceToPlaying(開局首抽)與 END_TURN(換手)兩處呼叫;此測試鎖住換手路徑。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.do-s.js'), E = join(ROOT, '.do-e.ts'), O = join(ROOT, '.do-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const BASIC = '18519'; // 任意基礎寶可夢/填充
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
function mkState(bDeck) {
  const s = createGame({ name: 'A', entries: [{ cardId: BASIC, count: 1 }] }, { name: 'B', entries: [{ cardId: BASIC, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 3,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(BASIC), inst(BASIC)], discard: [], prizes: Array.from({length:6},()=>inst(BASIC)), bench: [], active: inst(BASIC) },
      { ...s.players[1], hand: [], deck: bDeck, discard: [], prizes: Array.from({length:6},()=>inst(BASIC)), bench: [], active: inst(BASIC) }] };
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★B 牌庫空 → A END_TURN 後 B 抽不到 → game-over,winner=A(0)', () => {
  const out = applyAction(mkState([]), { type: 'END_TURN' }, pool);
  assert.equal(out.phase, 'game-over', 'phase 應 game-over,實得 ' + out.phase);
  assert.equal(out.winner, 0, 'winner 應為 A(0),實得 ' + out.winner);
});
T('無回歸:B 牌庫有 1 張 → END_TURN 後正常抽到、不判負', () => {
  const out = applyAction(mkState([inst(BASIC)]), { type: 'END_TURN' }, pool);
  assert.notEqual(out.phase, 'game-over', '不該 game-over');
  assert.equal(out.activePlayerIndex, 1, '應換到 B 的回合');
  assert.equal(out.players[1].deck.length, 0, 'B 應抽掉那 1 張(deck=0)');
});
console.log('\ndeck-out 判負規則:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
