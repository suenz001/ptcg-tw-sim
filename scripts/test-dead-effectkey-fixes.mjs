/** v5.881 修死 effectKey(picker 開了但無 resolver→選完靜默無效果):
 *  ①長毛狗|氣味偵測 擲3幣→從棄牌選≤正面數加手牌(原 wave17-pickup-energy-to-hand 死 key→discard-to-hand)。
 *  ②火箭隊的瓦斯彈|警備濁霧(特性,受傷時)搜「名稱含瓦斯彈」放備戰(原 search-bench-reshuffle 死 key→
 *    bench-named-basic-from-deck+nameContains)。
 *  anti-pattern-lint Check N 一勞永逸守衛。HEAD-FAIL:HEAD 選完卡沒進手牌/沒放備戰。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dk-s.js'), E = join(ROOT, '.dk-e.ts'), O = join(ROOT, '.dk-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { PASSIVE_ON_DAMAGED } from './src/lib/game/effects';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

// 找卡 id
function findId(name, opt={}) { for (const [id,c] of pool) { if (c.name===name && (!opt.basic || c.subtype==='Basic')) return id; } return null; }
const STOUTLAND = findId('長毛狗'), GASSY = findId('火箭隊的瓦斯彈'), POKE='14319', W='18519';
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
const pub = (l) => (typeof l === 'string' ? l : (l?.message || ''));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const forceHeads = () => { const o=Math.random; Math.random=()=>0; return ()=>{Math.random=o;}; };

// 1) 氣味偵測:擲3幣(全正)→棄牌區有3張→picker→選2張→進手牌(公開log)
T('★氣味偵測 擲幣後棄牌→手牌(discard-to-hand,非死key)', () => {
  assert.ok(STOUTLAND, '找到長毛狗');
  const active = inst(STOUTLAND); active.energyAttached = [inst(W), inst(W)];
  const st = { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ME',active,bench:[],hand:[],deck:[inst(POKE)],discard:[inst(W),inst(W),inst(POKE)],prizes:[inst(POKE)]},
             {name:'OP',active:inst(POKE),bench:[inst(POKE)],hand:[],deck:[inst(POKE)],discard:[],prizes:[inst(POKE)]}] };
  const atkIdx = pool.get(STOUTLAND).attacks.findIndex(a=>a.name==='氣味偵測');
  const restore = forceHeads();
  let out = mod.applyAction(st, { type:'ATTACK', attackIndex: atkIdx }, pool);
  restore();
  assert.ok(out.pendingSelection, '擲幣後開 discard-search picker');
  assert.equal(out.pendingSelection.effectKey, 'discard-to-hand', '用 discard-to-hand(非死 key wave17-...)');
  const iids = out.players[0].discard.slice(0,2).map(c=>c.iid);
  out = mod.applyAction(out, { type:'RESOLVE_SELECTION', selectedIids: iids }, pool);
  assert.equal(out.players[0].hand.length, 2, '選的 2 張進手牌');
  assert.ok(out.log.some(l => pub(l).includes('從棄牌取回')), '公開 log 記錄取回卡名(棄牌區公開)');
});

// 2) 警備濁霧:受傷時搜「瓦斯彈」放備戰+重洗
T('★警備濁霧 搜瓦斯彈放備戰(bench-named-basic-from-deck+nameContains,非死key)', () => {
  assert.ok(GASSY, '找到火箭隊的瓦斯彈');
  const fn = mod.PASSIVE_ON_DAMAGED.get('警備濁霧');
  assert.ok(fn, '有 警備濁霧 hook');
  const st = { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:1, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ATK',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[inst(POKE)]},
             {name:'ME',active:inst(GASSY),bench:[],hand:[],deck:[inst(GASSY),inst(GASSY),inst(POKE)],discard:[],prizes:[inst(POKE)]}] };
  let out = fn(st, 1, 0, pool, pool.get(GASSY));
  assert.ok(out.pendingSelection, '開 deck-search picker');
  assert.equal(out.pendingSelection.effectKey, 'bench-named-basic-from-deck', '用 bench-named-basic-from-deck(非死 key)');
  const gassyIids = out.players[1].deck.filter(c=>c.cardId===String(GASSY)).slice(0,2).map(c=>c.iid);
  out = mod.applyAction(out, { type:'RESOLVE_SELECTION', selectedIids: gassyIids }, pool);
  assert.equal(out.players[1].bench.length, 2, '2 張瓦斯彈放備戰');
  assert.ok(out.players[1].bench.every(b=>b.cardId===String(GASSY)), '備戰是瓦斯彈');
  assert.ok(out.log.some(l => pub(l).includes('放到備戰區')), '公開 log 放備戰');
});

console.log('\n死 effectKey 修正(v5.881):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
