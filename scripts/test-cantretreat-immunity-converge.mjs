/** v5.802 defCantRetreatNextPost 本地版收斂中央(含免疫gate)
 *  化隱對手 → 禁撤退招式不應施加 cantRetreatNextTurn。
 *  v5.840 追加:Check H 抓出另一批 inline 漏 gate 生效版(v2359 cantRetreatNextFn 6招/
 *  伊裴爾塔爾緊抓/v2750 破破舵輪束縛+帕底亞土王ex毒陣)全收斂中央;HEAD 這批漏 gate → FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.cr-s.js'),E=join(ROOT,'.cr-e.ts'),O=join(ROOT,'.cr-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const POKE='14443', HIDDEN='19149'/*斯魔茶 化隱*/;
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const mk=(oppCid)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:inst(oppCid),bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});
// 各 wave 一張代表卡
const CASES=[['流氓鱷ex|窮追不捨','v2550'],['赫普的朽木妖|窮追不捨','v2580'],['烈箭鷹|緊抓','v3700'],
  // v5.840 Check H 抓出的漏 gate 生效版(收斂 defCantRetreatNextPost 後應免疫)
  ['莉佳的蔓藤怪|綁緊','v2359'],['泥巴魚ex|咬緊','v2359'],['青木的勇士雄鷹|緊抓','v2359'],
  ['伊裴爾塔爾|緊抓','effects'],['破破舵輪|束縛','v2750'],['帕底亞 土王ex|毒陣','v2750']];
for(const [key,wave] of CASES){
  T(`★${key}(${wave}):化隱對手不應被禁撤退`, () => {
    const out=ATTACK_POST.get(key)(mk(HIDDEN),0,pool);
    assert.ok(!out.players[1].active.cantRetreatNextTurn, `化隱應免疫,實得 cantRetreatNextTurn=${out.players[1].active.cantRetreatNextTurn}`);
  });
}
// 對照:普通對手應正常被禁撤退
T('對照:普通對手→窮追不捨正常禁撤退', () => {
  const out=ATTACK_POST.get('流氓鱷ex|窮追不捨')(mk(POKE),0,pool);
  assert.ok(out.players[1].active.cantRetreatNextTurn, '普通對手應被禁撤退');
});
console.log('\n禁撤退免疫收斂(v5.802):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
