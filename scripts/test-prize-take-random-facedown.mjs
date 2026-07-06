/** v5.890 取獎 picker 只讓玩家決定要不要取「翻正面」的獎賞;蓋著的彼此無差異→不逐張列 #1/#2/#3,
 *  改一個「隨機取一張蓋著的」彙總選項(系統代抽)。
 *  HEAD-FAIL:HEAD 逐張列蓋著獎賞(options 數 = prizes 數,無 __prize_random_facedown__ 選項)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rf-s.js'), E = join(ROOT, '.rf-e.ts'), O = join(ROOT, '.rf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const CR = '16788', POKE = '14319', W = '18519';
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// 中毒檢查致死開 picker,對手(idx1)有 1 張正面 + 3 張蓋著
function st(oppPrizes) {
  const active = inst(CR, { status: 'poisoned', damage: 115 });
  return {
    id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    endTurnSkipCheckup:false, endTurnCheckupAbilitiesDone:false,
    players:[
      { name:'ME', active, bench:[inst(POKE)], hand:[], deck:[inst(POKE)], discard:[], prizes:[inst(POKE)] },
      { name:'OP', active:inst(POKE), bench:[inst(POKE)], hand:[], deck:[inst(POKE)], discard:[], prizes: oppPrizes },
    ],
  };
}

T('★picker 選項 = 1 個正面 + 1 個「隨機取蓋著」,不逐張列蓋著(HEAD-FAIL:逐張4個)', () => {
  const out = mod.applyAction(st([inst(W,{faceUp:true}), inst(POKE), inst(POKE), inst(POKE)]), { type:'END_TURN' }, pool);
  assert.ok(out.pendingSelection, '開 picker');
  const opts = out.pendingSelection.params.options;
  const faceUpOpts = opts.filter(o => o.text.includes('正面朝上'));
  const randOpts = opts.filter(o => o.id === '__prize_random_facedown__');
  assert.equal(faceUpOpts.length, 1, '1 個正面選項');
  assert.equal(randOpts.length, 1, '1 個「隨機取蓋著」選項');
  assert.equal(opts.length, 2, '共 2 個選項(不逐張列 4 張蓋著)');
});

T('選「隨機取蓋著」→ 取到一張蓋著的(正面獎賞留著,只 owed 1 張→取完)', () => {
  let out = mod.applyAction(st([inst(W,{faceUp:true}), inst(POKE), inst(POKE), inst(POKE)]), { type:'END_TURN' }, pool);
  out = mod.applyAction(out, { type:'RESOLVE_SELECTION', selectedIids:['__prize_random_facedown__'] }, pool);
  assert.equal(out.players[1].prizes.length, 3, '取走 1 張(4→3)');
  assert.ok(out.players[1].prizes.some(c => c.faceUp), '正面獎賞仍在(沒被拿走)');
  assert.ok(!out.pendingSelection, 'owed 1 張已取完 → picker 關閉');
  assert.ok(out.players[1].hand.every(c => !c.faceUp), '取到的蓋著卡進手牌');
});

T('選正面獎賞 → 取走那張正面卡進手牌(剝 faceUp)', () => {
  let out = mod.applyAction(st([inst(W,{faceUp:true}), inst(POKE), inst(POKE), inst(POKE)]), { type:'END_TURN' }, pool);
  const fu = out.pendingSelection.params.options.find(o => o.text.includes('正面朝上'));
  out = mod.applyAction(out, { type:'RESOLVE_SELECTION', selectedIids:[fu.id] }, pool);
  assert.equal(out.players[1].prizes.length, 3, '取走 1 張');
  assert.ok(out.players[1].hand.some(c => c.cardId === W), '取走的是正面的水能量');
  assert.ok(out.players[1].prizes.every(c => !c.faceUp), '正面獎賞已被取走,剩下全蓋著');
});

console.log('\n取獎 picker 隨機蓋著選項(v5.890):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
