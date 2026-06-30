/** v5.818 防具道具減傷(果實/渾厚鱗片/神聖護符)也套到備戰寶可夢;果實觸發後丟棄。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.dt-s.js'),E=join(ROOT,'.dt-e.ts'),O=join(ROOT,'.dt-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { dealAttackDamageToTarget } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { dealAttackDamageToTarget }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const PSY='14086'/*願增猿 超 attacker*/, GRASS='14443', LAP='14085'/*拉普拉斯ex HP210*/, DRA='14069'/*超級拉帝亞斯ex 龍 HP280*/;
const BERRY='17148'/*福祿果 對超-60丟棄*/, SCALE='14824'/*渾厚鱗片 龍holder對草火水雷-50不丟*/, AMULET='14393'/*神聖護符*/;
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
// attacker=P0 active(指定屬性); P1 備戰 holder 帶道具; 狙擊 dmg
const run=(atkCard, holderCard, tool, dmg)=>{
  const benchT=inst(holderCard,{iid:'bt', toolAttached: tool ? inst(tool) : undefined});
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(atkCard,{iid:'atk'}),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
             {name:'P2',active:inst(GRASS,{iid:'oppAct'}),bench:[benchT],hand:[],deck:[],discard:[],prizes:[1]}]};
  const r=dealAttackDamageToTarget(st,0,'bt',dmg,pool,{kind:'attack-damage',label:'狙擊',noWeakness:true});
  const b=r.players[1].bench.find(x=>x.iid==='bt');
  return { dmg: b?.damage ?? -1, hasTool: !!(b && (b.toolAttached || (b.extraTools&&b.extraTools.length))), inDiscard: r.players[1].discard.some(d=>String(d.cardId)===String(tool)), benchGone: !b };
};
T('★福祿果(超attacker):備戰受50→-60=0,且果實丟棄', () => {
  const o=run(PSY, LAP, BERRY, 50);
  assert.strictEqual(o.dmg,0,`傷害應0,實際${o.dmg}`);
  assert.ok(!o.hasTool,'果實應從備戰移除');
  assert.ok(o.inDiscard,'果實應進棄牌堆');
});
T('★福祿果 非超attacker(草):不減傷、不丟棄', () => {
  const o=run(GRASS, LAP, BERRY, 50);
  assert.strictEqual(o.dmg,50,`應50,實際${o.dmg}`);
  assert.ok(o.hasTool,'未觸發不應丟棄');
  assert.ok(!o.inDiscard,'未觸發不應進棄牌');
});
T('★渾厚鱗片(龍holder,草attacker):-50且不丟棄', () => {
  const o=run(GRASS, DRA, SCALE, 100);
  assert.strictEqual(o.dmg,50,`應50(100-50),實際${o.dmg}`);
  assert.ok(o.hasTool,'渾厚鱗片不丟棄應留');
});
T('★福祿果觸發致KO:備戰移除且果實在棄牌', () => {
  // 拉普拉斯ex HP210; 用低HP草holder讓 100-60=40 仍不KO → 改:夢幻ex? 用 GRASS(含羞苞HP30) holder,超attacker,dmg100→100-60=40>=30 KO
  const o=run(PSY, GRASS, BERRY, 100);
  assert.ok(o.benchGone,'應被KO移出備戰');
  assert.ok(o.inDiscard,'KO時果實也應在棄牌堆');
});
console.log('\nbench防具道具(v5.818):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
