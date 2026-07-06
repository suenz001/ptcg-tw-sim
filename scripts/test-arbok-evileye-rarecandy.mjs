/** v5.887 火箭隊的阿柏怪|瞪眼效用「對手不可從手牌將擁有特性的寶可夢(火箭隊除外)放置於場上」。
 *  engine PLAY_BASIC/EVOLVE 已 gate,但神奇糖果(rare-candy 獨立 resolver)繞過→玩家回報仍能用糖果進化到有特性S2。
 *  修:神奇糖果 validIids 過濾 + rare-candy-evolve server guard(中央 isOppEvilEyeBlocking)。
 *  HEAD-FAIL:HEAD 神奇糖果不理瞪眼效用,有特性S2仍可選/進化。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ar-s.js'), E = join(ROOT, '.ar-e.ts'), O = join(ROOT, '.ar-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const ARBOK='12807', LOMBRE_BASE='14323', LUDICOLO='14325', ODDISH='14319', VILEPLUME='14321', W='18519';
const candyId = [...pool].find(([id,c])=>c.name==='神奇糖果')?.[0];
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
const pub = l => (typeof l==='string'?l:(l?.message||''));
let pass=0, fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// 玩家(idx0) 場上 basic + 手牌 S2;對手(idx1) active=阿柏怪(瞪眼效用)
function mk(basicCid, s2Cid) {
  return { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ME',active:inst(basicCid),bench:[],hand:[inst(s2Cid)],deck:[],discard:[],prizes:[inst(W)]},
             {name:'OP',active:inst(ARBOK),bench:[],hand:[],deck:[],discard:[],prizes:[inst(W)]}] };
}
T('★對手瞪眼效用 → 神奇糖果不能進化到「有特性」S2(樂天河童)', () => {
  assert.ok(candyId,'找到神奇糖果');
  const fn = mod.TRAINER_EFFECTS.get('神奇糖果');
  const out = fn(mk(LOMBRE_BASE, LUDICOLO), 0, pool);
  // 有特性 S2 被過濾 → 無可進化 → 不開 picker(或 validIids 空)
  const noValid = !out.pendingSelection || (out.pendingSelection.params?.validIids?.length ?? 0) === 0;
  assert.ok(noValid, '有特性 S2 被瞪眼效用擋(validIids 空/不開 picker)');
});
T('★對照:無特性 S2(霸王花) → 神奇糖果照常可進化', () => {
  const fn = mod.TRAINER_EFFECTS.get('神奇糖果');
  const out = fn(mk(ODDISH, VILEPLUME), 0, pool);
  assert.ok(out.pendingSelection, '無特性 S2 → 開 picker');
  assert.ok((out.pendingSelection.params?.validIids?.length ?? 0) >= 1, '霸王花可選');
});
T('對照:對手 active 非阿柏怪(無瞪眼效用) → 有特性S2照常可進化', () => {
  const fn = mod.TRAINER_EFFECTS.get('神奇糖果');
  const st = mk(LOMBRE_BASE, LUDICOLO); st.players[1].active = inst(ODDISH);  // 對手改走路草(無特性)
  const out = fn(st, 0, pool);
  assert.ok(out.pendingSelection && (out.pendingSelection.params?.validIids?.length ?? 0) >= 1, '無瞪眼效用時樂天河童可選');
});
console.log('\n阿柏怪瞪眼效用×神奇糖果(v5.887):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
