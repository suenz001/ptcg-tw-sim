/** v5.870 修 6/7 張牌庫搜尋訓練家的可用性 guard 註冊在空字串 key(死碼)。
 *  regG('') → TRAINER_GUARDS.set('',fn),互相覆蓋 → 訂購盒/招式學習器機/派帕/吹火人/赤松/
 *  珍寶配件/能量輸送PRO 全失去「牌庫非空才可用」gate(canPlayTrainer.get(卡名)=undefined→回 true)
 *  → 牌庫空仍可使用(浪費/訂購盒空牌庫還結束回合)。修:補正確卡名。加 anti-pattern-lint Check M。
 *
 *  HEAD-FAIL:HEAD 這些卡 canPlayTrainer(空牌庫)=true(無 guard);修後=false。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.du-s.js'), E = join(ROOT, '.du-e.ts'), O = join(ROOT, '.du-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { canPlayTrainer } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { canPlayTrainer } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const FILLER = '18519';
let nn = 0;
const inst = (cid) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], status: null, secondaryStatus: null, tertiaryStatus: null });
function mk(deckN) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    players: [
      { name: 'P1', active: inst(FILLER), bench: [], hand: [], deck: Array.from({length:deckN},()=>inst(FILLER)), discard: [], prizes: [1,1,1,1,1,1] },
      { name: 'P2', active: inst(FILLER), bench: [], hand: [], deck: [inst(FILLER)], discard: [], prizes: [1,1,1,1,1,1] },
    ],
  };
}
const CARDS = ['訂購盒','招式學習器機','派帕','吹火人','赤松','珍寶配件','能量輸送PRO'];
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

for (const nm of CARDS) {
  T(`★${nm}：牌庫空 → 不可使用(guard 生效)`, () => {
    assert.strictEqual(canPlayTrainer(nm, mk(0), 0, pool), false, `${nm} 空牌庫應不可用(HEAD 因空 key 死碼→true)`);
  });
  T(`${nm}：牌庫非空 → 可使用`, () => {
    assert.strictEqual(canPlayTrainer(nm, mk(5), 0, pool), true, `${nm} 有牌庫應可用`);
  });
}

console.log('\n牌庫搜尋訓練家可用性 guard(v5.870):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
