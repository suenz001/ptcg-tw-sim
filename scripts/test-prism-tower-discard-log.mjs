/** v5.891 稜鏡塔(Stadium)棄 2 張手牌抽 1 張 → 棄牌屬公開資訊,需公開 log 丟棄的卡名。
 *  原 prism-tower-draw1 resolver 完全無 log → 玩家看不到對手用稜鏡塔丟了什麼。
 *  HEAD-FAIL:HEAD resolver 無任何 addLog。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pt-s.js'), E = join(ROOT, '.pt-e.ts'), O = join(ROOT, '.pt-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const PRISM = '18500', POKE = '14319', W = '18519', FIRE = '18518';
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const logText = (s) => s.log.map(l => typeof l === 'string' ? l : (l?.message ?? l?.text ?? JSON.stringify(l))).join('\n');

function st() {
  const hW = inst(W), hFire = inst(FIRE);   // 兩張要丟的手牌:水能量 + 火能量
  return {
    id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    stadiumUsedThisTurn:[false,false],
    activeStadium: inst(PRISM),
    players:[
      { name:'ME', active:inst(POKE), bench:[], hand:[hW, hFire, inst(POKE)], deck:[inst(POKE), inst(POKE)], discard:[], prizes:[inst(POKE)] },
      { name:'OP', active:inst(POKE), bench:[], hand:[], deck:[inst(POKE)], discard:[], prizes:[inst(POKE)] },
    ],
    _hW: hW, _hFire: hFire,
  };
}

T('★稜鏡塔棄 2 張手牌 → 公開 log 揭示丟棄卡名(水/火能量)', () => {
  const s0 = st();
  const afterUse = mod.applyAction(s0, { type:'USE_STADIUM' }, pool);
  assert.ok(afterUse.pendingSelection, 'USE_STADIUM → 開 hand-discard picker');
  assert.equal(afterUse.pendingSelection.effectKey, 'prism-tower-draw1');
  const out = mod.applyAction(afterUse, { type:'RESOLVE_SELECTION', selectedIids:[s0._hW.iid, s0._hFire.iid] }, pool);
  // 棄牌實際發生
  assert.equal(out.players[0].discard.length, 2, '丟棄 2 張到棄牌區');
  assert.equal(out.players[0].hand.length, 2, '手牌 3-2+1(抽) = 2');
  // 公開 log 含兩張卡名
  const txt = logText(out);
  assert.ok(txt.includes('稜鏡塔'), 'log 有稜鏡塔字樣 (HEAD-FAIL:HEAD 無任何 log)');
  assert.ok(txt.includes(pool.get(W).name), 'log 揭示水能量卡名');
  assert.ok(txt.includes(pool.get(FIRE).name), 'log 揭示火能量卡名');
});

console.log('\n稜鏡塔棄牌公開 log(v5.891):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
