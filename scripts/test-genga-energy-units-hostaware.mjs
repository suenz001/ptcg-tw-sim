/** v5.862 超級龍頭地鼠ex|極限鑽「若身上附加的能量數比所需多 2 個以上 → +130」
 *  「能量數」須 host-aware:燃火能量(進化=3單位)/新衝天(Stage2=2)/火箭隊(=2)/大竺葵繁茂(基本草=2)。
 *  原用 host-unaware 的 getEnergyUnits 逐張加總 → 燃火只算 1,少算能量單位。
 *
 *  HEAD-FAIL:超級龍頭地鼠ex(Stage1 進化)附 燃火能量 + 2 基本 = host-aware 3+2=5 單位 ≥ 5(cost3+2)→+130→330；
 *           HEAD host-unaware:燃火算 1 → 1+2=3 < 5 → 無 bonus → 200。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ge-s.js'), E = join(ROOT, '.ge-e.ts'), O = join(ROOT, '.ge-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const EXCADRILL='19207' /*超級龍頭地鼠ex Stage1*/, FUEL='14851' /*燃火能量*/, FIGHT='14104' /*基本鬥*/;
let nn=0;
const inst=(cid)=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null});
function mk(energyIds){
  const att={iid:'atk',cardId:EXCADRILL,damage:0,energyAttached:energyIds.map(inst),status:null,secondaryStatus:null,tertiaryStatus:null};
  return { phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[
      {name:'P1',active:att,bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
      {name:'P2',active:inst(FIGHT),bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
    ]};
}
const run=(energyIds)=>{ const pre=ATTACK_PRE.get('超級龍頭地鼠ex|極限鑽'); return pre(mk(energyIds),0,pool,{}).damage; };
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// 燃火(進化=3) + 2 基本 = 5 單位 ≥ 5 → +130
T('★燃火能量(進化host=3單位)+2基本=5單位 → 200+130=330', () => {
  const d=run([FUEL, FIGHT, FIGHT]); assert.strictEqual(d, 330, `應330(host-aware 5單位),實際${d}(HEAD host-unaware=200)`);
});
// 對照:4 基本 = 4 單位 < 5 → 無 bonus
T('4 基本 = 4 單位 < 5 → 200(不加)', () => {
  const d=run([FIGHT, FIGHT, FIGHT, FIGHT]); assert.strictEqual(d, 200, `應200,實際${d}`);
});
// 對照:5 基本 = 5 單位 ≥ 5 → 330
T('5 基本 = 5 單位 ≥ 5 → 330', () => {
  const d=run([FIGHT, FIGHT, FIGHT, FIGHT, FIGHT]); assert.strictEqual(d, 330, `應330,實際${d}`);
});

console.log('\n極限鑽 能量數 host-aware(v5.862):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
