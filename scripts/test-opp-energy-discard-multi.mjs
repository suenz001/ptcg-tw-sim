// v5.974 HEAD-FAIL:多張型「擲幣N次丟=正面數」+ 盾甲龍 收斂中央 count 參數(picker 選 N 張/全丟/免疫 gate)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.xm-s.js'), E = join(ROOT,'.xm-e.ts'), O = join(ROOT,'.xm-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const orig=Math.random;
function inst(cid,ex={}){return{iid:'p'+Math.random().toString(36).slice(2),cardId:String(cid),energyAttached:[],damage:0,...ex};}
function en(n){return Array.from({length:n},(_,i)=>({iid:'e'+i,cardId:'90000'+i,energyAttached:[],damage:0}));}
function mk(att,defE){return{phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'P0',active:inst(att),bench:[],hand:[],deck:[],discard:[],prizes:[]},{name:'P1',active:inst('16912',{energyAttached:defE}),bench:[],hand:[],deck:[],discard:[],prizes:[]}]};}
let pass=0;
// ① 焚焰蚣 2正面,對手3能量→picker 選2/3
{
  const st=mk('14033',en(3)); Math.random=()=>0.1; let a; try{a=mod.ATTACK_POST.get('焚焰蚣|緊束粉碎')(st,0,pool,{});}finally{Math.random=orig;}
  const ps=a.pendingSelection;
  assert.ok(ps&&ps.type==='active-energy-discard','焚焰蚣2正面應開picker,實得'+(ps&&ps.type));
  assert.strictEqual(ps.minCount,2,'應選2張'); assert.strictEqual(ps.maxCount,2);
  assert.strictEqual((ps.params?.validIids||[]).length,3,'3張皆候選');
  assert.strictEqual(a.players[1].active.energyAttached.length,3,'picker開啟時尚未丟');
  console.log('  ✅ ① 焚焰蚣 2正面+對手3能量→picker選2/3'); pass++;
}
// ② 焚焰蚣 2正面,對手剛好2能量→全丟(無picker)
{
  const st=mk('14033',en(2)); Math.random=()=>0.1; let a; try{a=mod.ATTACK_POST.get('焚焰蚣|緊束粉碎')(st,0,pool,{});}finally{Math.random=orig;}
  assert.strictEqual(a.pendingSelection,null,'剛好2張=要丟數→全丟不開picker');
  assert.strictEqual(a.players[1].active.energyAttached.length,0,'2張全丟');
  assert.strictEqual(a.players[1].discard.length,2,'2張進棄牌');
  console.log('  ✅ ② 焚焰蚣 2正面+對手2能量→全丟(無picker)'); pass++;
}
// ③ 盾甲龍|碎 收斂中央,對手2能量→picker選1
{
  const st=mk('19203',en(2)); let a=mod.ATTACK_POST.get('盾甲龍|碎')(st,0,pool,{});
  const ps=a.pendingSelection;
  assert.ok(ps&&ps.type==='active-energy-discard'&&ps.effectKey==='discard-opp-active-energy-pick','盾甲龍應走中央effectKey,實得'+(ps&&ps.effectKey));
  assert.strictEqual(ps.minCount,1); assert.strictEqual((ps.params?.validIids||[]).length,2);
  console.log('  ✅ ③ 盾甲龍|碎 收斂中央 picker(effectKey=discard-opp-active-energy-pick)'); pass++;
}
console.log(`\nPASS ${pass}/3 — opp-energy-discard-multi`);
