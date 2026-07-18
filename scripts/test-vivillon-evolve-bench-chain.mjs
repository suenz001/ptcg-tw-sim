// 回歸測試 v5.983：彩粉蝶|進化粉 應走「逐備戰選進化卡→直接進化」chain(同人造細胞卵|細胞覺醒)，
// 非泛用 deck-search「拿任意寶可夢加手牌」(原簡化=可利用漏洞)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-s-vv.js'), E = join(ROOT, '.x-e-vv.ts'), O = join(ROOT, '.x-o-vv.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { ATTACK_POST, ATTACK_PRE, RESOLVERS } from './src/lib/game/effects/_shared';\n" +
  "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const liveCodes = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
// 找一組 base(基礎) + evo(evolvesFrom=base) 都在 live pool
let baseId=null, evoId=null, baseName=null;
for (const [id,c] of pool) {
  if ((c.supertype==='Pokemon'||c.supertype==='Pokémon') && c.evolvesFrom) {
    // 找 base 卡
    for (const [bid,bc] of pool) {
      if ((bc.supertype==='Pokemon'||bc.supertype==='Pokémon') && bc.name===c.evolvesFrom) {
        baseId=bid; evoId=id; baseName=bc.name; break;
      }
    }
    if (baseId) break;
  }
}
assert(baseId&&evoId, '找不到 base+evo 對');
let vivId=null; for (const [id,c] of pool) if (c.name==='彩粉蝶') { vivId=id; break; }
assert(vivId,'找不到彩粉蝶');

function mk(cardId, over={}) {
  return { iid: over.iid ?? ('i'+cardId+Math.random().toString(36).slice(2,6)), cardId:String(cardId), damage:0,
    energyAttached:[], status:null, secondaryStatus:null, tertiaryStatus:null, toolAttached:null, extraTools:[], ...over };
}
function st() {
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true],
    players:[
      { name:'A', active:mk(vivId,{iid:'atk'}), bench:[mk(baseId,{iid:'base0'})],
        hand:[], deck:[mk(evoId,{iid:'evo0'})], discard:[], prizes:[1,1,1,1,1,1] },
      { name:'B', active:mk(baseId,{iid:'d'}), bench:[], hand:[], deck:[], discard:[], prizes:[1,1,1,1,1,1] },
    ] };
}
let pass=0, fail=0; const ck=(n,c)=>{ if(c) pass++; else { fail++; console.log('  ✗',n); } };

const post = mod.ATTACK_POST.get('彩粉蝶|進化粉');
ck('彩粉蝶|進化粉 有註冊', !!post);
if (post) {
  const out = post(st(), 0, pool, {});
  const ps = out.pendingSelection;
  ck('開啟 pendingSelection', !!ps);
  if (ps) {
    ck('走進化 chain(effectKey=cell-awaken-evolve-step)', ps.effectKey==='cell-awaken-evolve-step');
    ck('filter=EvilAwakening:EvolveFrom(非泛用Pokemon)', ps.filter==='EvilAwakening:EvolveFrom');
    ck('params.baseName=備戰base名', ps.params?.baseName===baseName);
    ck('params.label=進化粉', ps.params?.label==='進化粉');
    ck('非 wave13-deck-take-any(加手牌漏洞)', ps.effectKey!=='wave13-deck-take-any');
    ck('maxCount=1(單張進化卡非N張任意)', ps.maxCount===1);
  }
}
// --- 人造細胞卵|細胞覺醒 未回歸(label 預設細胞覺醒) ---
let cellId=null; for(const [id,c] of pool) if(c.name==='人造細胞卵'&&(c.attacks||[]).some(a=>a.name==='細胞覺醒')){cellId=id;break;}
if(cellId){
  const post2=mod.ATTACK_POST.get('人造細胞卵|細胞覺醒');
  ck('人造細胞卵|細胞覺醒 有註冊', !!post2);
  if(post2){
    const s2={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],players:[{name:'A',active:mk(cellId,{iid:'atk2'}),bench:[mk(baseId,{iid:'cb0'})],hand:[],deck:[mk(evoId,{iid:'ce0'})],discard:[],prizes:[1,1,1,1,1,1]},{name:'B',active:mk(baseId,{iid:'d2'}),bench:[],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]};
    const o2=post2(s2,0,pool,{});
    ck('人造細胞卵 走同 chain', o2.pendingSelection?.effectKey==='cell-awaken-evolve-step');
    ck('人造細胞卵 label 預設=細胞覺醒(未回歸)', o2.pendingSelection?.params?.label==='細胞覺醒');
  }
}

console.log(`\n彩粉蝶進化chain測試：PASS ${pass} / FAIL ${fail}`);
if (fail>0) process.exit(1);
