/** v6.638：元素爆破必須保留後續屬性可丟棄的能量；直接官方QA＋同措辭古舊能量類推。 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractBaseArchive } from './lib/base-archive.mjs';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = '31f2a0ae7a6beebcb894b9ffb18cf39428098f18';
const dirs = [];
process.on('exit', () => { for (const d of dirs) rmSync(d, {recursive:true,force:true}); });
let passed=0,failed=0;
const check=(name,ok)=>{ console.log(`${ok?'PASS':'FAIL'} ${name}`);ok?passed++:failed++; };
async function load(src) {
 const dir=mkdtempSync(join(tmpdir(),'v6638-'));dirs.push(dir);const out=join(dir,'engine.mjs');
 await build({stdin:{contents:`export {applyAction,createGame,getEffectiveAttacks} from '${src.replaceAll('\\','/')}/src/lib/game/engine';export * as Effects from '${src.replaceAll('\\','/')}/src/lib/game/effects';`,resolveDir:ROOT,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'esm',target:'node20',logLevel:'error',nodePaths:[join(ROOT,'node_modules')],alias:{$lib:join(src,'src/lib')},plugins:[{name:'paths',setup(b){b.onResolve({filter:/^\$app\/paths$/},()=>({path:'paths',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const base="";export const assets="";',loader:'js'}));}}]});
 return import(pathToFileURL(out).href);
}
const pool=new Map();
for(const x of JSON.parse(readFileSync(join(ROOT,'static/cards/index.json'),'utf8'))) for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',x.code+'.json'),'utf8')))pool.set(String(c.id),{...c,name:c.name?.replace(/[<>＜＞‌]/g,'')});
const all=[...pool.values()];const basic=t=>all.find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【'+t+'】'));
const ids={F:basic('火').id,W:basic('水').id,L:basic('雷').id,P:'13028',A:'17212',C:'17211',R:'18057'};
const target=all.find(c=>['H','I','J'].includes(c.regulationMark)&&c.supertype==='Pokemon'&&c.stage==='Basic'&&!c.abilities?.length&&c.hp>=300);
const lugias=all.filter(c=>['H','I','J'].includes(c.regulationMark)&&c.name==='洛奇亞'&&c.attacks?.some(a=>a.name==='元素爆破'));
let seq=0;const inst=(id,x={})=>({iid:'t6638-'+(++seq),cardId:String(id),damage:0,energyAttached:[],...x});
function scenarios(M) {
 const r={};
 const act=(s,a)=>M.applyAction(s,a,pool);
 const pending=s=>s.pendingSelection;
 const valid=s=>pending(s)?.params?.validIids??[];
 const attached=s=>s.players[0].active?.energyAttached??[];
 const pick=(s,iid)=>act(s,{type:'RESOLVE_SELECTION',selectedIids:[iid],actorIdx:pending(s)?.actorIdx??0,pendingToken:pending(s)?.token,effectKey:pending(s)?.effectKey});
 const finish=s=>{for(let n=0;n<8&&pending(s)?.effectKey==='discard-one-each-type';n++)s=pick(s,valid(s)[0]);return s;};
 const start=(codes,id='20009',damage=0)=>{
  const es=codes.map(c=>inst(ids[c]));let s=M.createGame({name:'A',entries:[{cardId:target.id,count:60}]},{name:'B',entries:[{cardId:target.id,count:60}]},pool);
  s={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:7,isFirstTurn:false,setupDone:[true,true],pendingSelection:null,pendingPrizes:[0,0],log:[],players:s.players.map((p,i)=>({...p,active:i===0?inst(id,{energyAttached:es}):inst(target.id,{damage}),bench:[inst('20009')],hand:[],deck:Array.from({length:20},()=>inst(target.id)),discard:[],prizes:Array.from({length:6},()=>inst(target.id))}))};
  const before=JSON.stringify(s);const ai=M.getEffectiveAttacks(s,s.players[0].active,pool).findIndex(x=>x.atk.name==='元素爆破');
  const out=act(s,{type:'ATTACK',attackIndex:ai});return {s:out,es,initial:s,unchanged:JSON.stringify(s)===before};
 };
 const exact=start(['F','W','P']);r.exactForced=!pending(exact.s)&&attached(exact.s).length===0&&exact.s.players[0].discard.length===3;
 r.damage=exact.s.players[1].active?.damage===250;r.inputUnchanged=exact.unchanged;
 const more=start(['F','F','W','P']);const prism=more.es[3];
 r.prismReservedForLightning=pending(more.s)?.effectKey==='discard-one-each-type'&&valid(more.s).length===2&&!valid(more.s).includes(prism.iid);
 const bad=pick(more.s,prism.iid);r.invalidPrismBlocked=attached(bad).length===4&&valid(bad).length===2&&!valid(bad).includes(prism.iid);
 const empty=act(more.s,{type:'RESOLVE_SELECTION',selectedIids:[],actorIdx:0,pendingToken:pending(more.s)?.token});
 r.emptyCannotSkip=attached(empty).length===4&&pending(empty)?.effectKey==='discard-one-each-type'&&finish(empty).players[0].discard.length===3;
 const foreign=pick(more.s,more.s.players[1].active.iid);r.foreignCannotSkip=attached(foreign).length===4&&finish(foreign).players[0].discard.length===3;
 const done=finish(more.s);r.extraFireChoice=attached(done).length===1&&attached(done)[0].cardId===String(ids.F)&&done.players[0].discard.length===3&&!pending(done);
 const second=start(['F','W','W','P']);r.waterStepReservesPrism=String(pending(second.s)?.params?.titleOverride).includes('【水】')&&valid(second.s).length===2&&!valid(second.s).includes(second.es[3].iid);
 const waterBad=pick(second.s,second.es[3].iid);r.invalidWaterPrismBlocked=attached(waterBad).length===3&&waterBad.players[0].discard.length===1&&attached(waterBad).some(e=>e.iid===second.es[3].iid);
 const extra=start(['F','W','L','P']);r.legalPrismCanBeChosen=valid(extra.s).includes(extra.es[3].iid);
 const extraDone=finish(pick(extra.s,extra.es[3].iid));r.legalPrismFinal=attached(extraDone).length===1&&attached(extraDone)[0].iid===extra.es[0].iid&&extraDone.players[0].discard.length===3&&!pending(extraDone);
 const two=start(['F','W','P','P']);const twoFirst=pick(two.s,two.es[2].iid);
 r.twoPrismsSecondReserved=!pending(twoFirst)&&attached(twoFirst).length===1&&attached(twoFirst)[0].iid===two.es[0].iid&&twoFirst.players[0].discard.length===3;
 const ancient=start(['F','W','A']);r.ancientSameWording=!pending(ancient.s)&&attached(ancient.s).length===0&&ancient.s.players[0].discard.length===3;
 const irrelevant=start(['F','F','W','P','C','R']);r.irrelevantNotCandidates=valid(irrelevant.s).length===2&&[irrelevant.es[4].iid,irrelevant.es[5].iid].every(x=>!valid(irrelevant.s).includes(x));
 const legacy=start(['F','F','W','P']);let old=structuredClone(legacy.s);
 old.pendingSelection ??= {type:'active-energy-discard',effectKey:'discard-one-each-type',actorIdx:0,minCount:1,maxCount:1,params:{restTypes:['Water','Lightning'],titleOverride:'元素爆破：選擇 1 個【火】能量丟棄'}};
 old.pendingSelection.params.validIids=[legacy.es[0].iid,legacy.es[1].iid,legacy.es[3].iid];delete old.pendingSelection.params.energyType;
 const oldBefore=JSON.stringify(old);const repaired=pick(old,legacy.es[3].iid);
 r.legacyPendingRevalidated=attached(repaired).length===4&&valid(repaired).length===2&&!valid(repaired).includes(legacy.es[3].iid);
 r.resolveInputUnchanged=JSON.stringify(old)===oldBefore;
 r.legacyCanFinish=finish(repaired).players[0].discard.length===3&&!pending(finish(repaired));
 const basic3=start(['F','W','L']);r.basicOnly=attached(basic3.s).length===0&&basic3.s.players[0].discard.length===3&&!pending(basic3.s);
 const duplicates=start(['F','F','W','W','L','L']);r.basicDuplicates=valid(duplicates.s).length===2&&attached(finish(duplicates.s)).length===3;
 const shortage=start(['F','W','L']).initial;shortage.players[0].active.energyAttached=shortage.players[0].active.energyAttached.slice(0,2);
 const partial=M.Effects.discardOneEnergyOfEachTypePost(['Fire','Water','Lightning'],'元素爆破')(shortage,0,pool);
 r.genuinelyMissingTypeNoLock=!pending(partial)&&attached(partial).length===0&&partial.players[0].discard.length===2;
 const mew=start(['F','W','P'],'19969');r.memorySpiralSamePost=!pending(mew.s)&&attached(mew.s).length===0&&mew.s.players[1].active?.damage===250;
 r.allPrintings=lugias.length>0&&lugias.every(c=>{const x=start(['F','W','P'],String(c.id));return !pending(x.s)&&attached(x.s).length===0&&x.s.players[0].discard.length===3;});
 // 任何合法分支走到底，都應丟三張；取九種有多色能量的配置，避免只守第一個候選。
 let terminals=0,ok=true;
 for(const codes of [['F','W','P'],['F','F','W','P'],['F','W','W','P'],['F','W','L','P'],['F','W','P','P'],['F','P','P'],['W','P','P'],['P','P','P'],['F','W','L','A']]){
  const x=start(codes);const stack=[x.s];let localTerminals=0;
  let visits=0;while(stack.length&&++visits<=64){const s=stack.pop();if(pending(s)?.effectKey==='discard-one-each-type'){if(!valid(s).length)ok=false;for(const iid of valid(s))stack.push(pick(s,iid));}else{terminals++;localTerminals++;if(s.players[0].discard.length!==3||attached(s).length!==codes.length-3)ok=false;}}
  if(stack.length||localTerminals===0)ok=false; // 每組都要走完；循環、空候選不能被其他配置的終局數掩蓋。
 }
 r.everyLegalBranch=ok&&terminals>=12;
 return r;
}
const srcArg=process.argv.find(x=>x.startsWith('--src-root='));
const current=scenarios(await load(srcArg?srcArg.slice(11):ROOT));for(const [k,v]of Object.entries(current))check(k,v);
if(!process.argv.includes('--no-base')){
 if(hasBaseCommit(ROOT,BASE)){
  const base=mkdtempSync(join(tmpdir(),'v6638-base-'));dirs.push(base);extractBaseArchive(ROOT,BASE,['src'],base);const old=scenarios(await load(base));
  for(const k of ['exactForced','prismReservedForLightning','invalidPrismBlocked','waterStepReservesPrism','invalidWaterPrismBlocked','twoPrismsSecondReserved','ancientSameWording','legacyPendingRevalidated','allPrintings','everyLegalBranch'])check('HEAD-FAIL '+k,old[k]===false&&current[k]===true);
  for(const k of ['damage','inputUnchanged','extraFireChoice','legalPrismCanBeChosen','legalPrismFinal','basicOnly','basicDuplicates','genuinelyMissingTypeNoLock','resolveInputUnchanged'])check('正對照 BASE/HEAD '+k,old[k]===true&&current[k]===true);
 }else shallowSkip('v6638 HEAD-FAIL','需要v6.637 BASE');
}
console.log(`v6.638 元素爆破：${passed} PASS / ${failed} FAIL`);if(failed)process.exitCode=1;
