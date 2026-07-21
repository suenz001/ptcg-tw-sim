// v5.999:被動「最大HP」特性(雜草魂/生機森巴/大師工藝/腎上腺力量/暴龍根性)被 振翼髮|暗夜羽擊
//   (對手戰鬥場特性消除)壓制時,getEffectiveHP 應不套用其加成→最大HP下降,若傷害≥新HP由既有雙邊
//   sanityKOSweep 昏厥。玩家報:怖納噬草200/200受170傷→對手出振翼髮暗夜羽擊仍顯示30/200(應昏厥)。
//   HEAD(只判特性存在沒判有效性)→仍加成→FAIL。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.stub-mh.js'); writeFileSync(S,'export const base="";');
const E=join(ROOT,'.ent-mh.ts'); const O=join(ROOT,'.ent-mh.mjs');
writeFileSync(E,`export { createGame, applyAction, getEffectiveHP } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, getEffectiveHP }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const PECHA='16544',FLOR='16826',FLOR_NOAB='11239',SAMBA='16648',CRAFT='13738',CHIEN='18071',DOG='10478';
const PSY='14103',DARK='14430',SPECIAL='14851',FIGHT=(()=>{for(const[id,c]of pool)if(c.supertype==='Energy'&&c.subtype==='Basic'&&/【鬥】/.test(c.name))return id;return '14102';})();
let iid=0;const inst=(cid,e={})=>({iid:'m'+(++iid),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
// 建 state:P0=玩家A(active由參數,取2獎prizes剩4); P1=對手(active=pecha 170傷 雜草魂)
function mk(p0active,p1active,p1bench=[]){
  const s=createGame({name:'A',entries:[{cardId:FLOR,count:1}]},{name:'B',entries:[{cardId:PECHA,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:6,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck:[inst(FLOR)],discard:[],prizes:Array.from({length:4},()=>inst(PECHA)),bench:[],active:p0active},
             {...s.players[1],hand:[],deck:[inst(PECHA)],discard:[],prizes:Array.from({length:6},()=>inst(PECHA)),bench:p1bench,active:p1active}]};
}

T('① getEffectiveHP: 怖納噬草(雜草魂,對手取2獎) 對手active=振翼髮暗夜羽擊 → 100(壓制);非振翼髮 → 200',()=>{
  const pecha=inst(PECHA,{damage:170});
  const stSup=mk(inst(FLOR),pecha);           // 玩家A出振翼髮暗夜羽擊
  const stCtl=mk(inst(FLOR_NOAB),pecha);       // 玩家A出無特性振翼髮
  const hpSup=getEffectiveHP(pecha,pool,stSup), hpCtl=getEffectiveHP(pecha,pool,stCtl);
  console.log('   壓制時=',hpSup,' 對照(非振翼髮)=',hpCtl);
  assert.equal(hpSup,100,'暗夜羽擊壓制雜草魂→應base100,實際='+hpSup);
  assert.equal(hpCtl,200,'非振翼髮→應200,實際='+hpCtl);
});

T('② 全流程: 對手出振翼髮暗夜羽擊那個action結束 → 怖納噬草(170傷)由sanityKOSweep昏厥',()=>{
  // P0 active先放無特性振翼髮, bench放暗夜羽擊振翼髮; P0 撤退換上暗夜羽擊 → 觸發雙邊sweep
  const pecha=inst(PECHA,{damage:170});
  const p0active=inst(FLOR_NOAB,{energyAttached:[inst(PSY),inst(PSY),inst(PSY)]}); // 足夠撤退費
  const florAb=inst(FLOR);
  let st=mk(p0active,pecha,[]); st={...st,players:[{...st.players[0],bench:[florAb]},st.players[1]]};
  const r=applyAction(st,{type:'RETREAT',newActiveIid:florAb.iid},pool);
  const oppActive=r.players[1].active;
  console.log('   撤退換暗夜羽擊後: P0 active=',r.players[0].active?.cardId,' 對手active=',oppActive?.cardId??'null(已昏厥)',' 對手待補位pending=',r.pendingSelection?.type);
  const fainted = !oppActive || oppActive.iid!==pecha.iid;
  assert.ok(fainted,'怖納噬草應昏厥(active清空或換人),實際仍在='+JSON.stringify(oppActive));
});

T('③ state-optional 回歸守衛: getEffectiveHP(修建老匠+2鬥能量) 不傳state → 仍+80(140+40×2=220,不被誤扣)',()=>{
  const craft=inst(CRAFT,{energyAttached:[inst(FIGHT),inst(FIGHT)]});
  const hp=getEffectiveHP(craft,pool,undefined);
  console.log('   修建老匠無state getEffectiveHP=',hp,'(FIGHT id='+FIGHT+')');
  assert.equal(hp,140+80,'無state應維持現行+40×2=220,實際='+hp);
});

T('④ 暴龍根性: 怪顎龍(附特殊能量)對手active=振翼髮 → 180(壓制);非振翼髮 → 330',()=>{
  const chien=inst(CHIEN,{energyAttached:[inst(SPECIAL)]});
  // 對手(P1)active=怪顎龍, 玩家A(P0)active=振翼髮暗夜羽擊 / 對照無特性
  const stSup=mk(inst(FLOR),chien), stCtl=mk(inst(FLOR_NOAB),chien);
  const a=getEffectiveHP(chien,pool,stSup), b=getEffectiveHP(chien,pool,stCtl);
  console.log('   壓制時=',a,' 對照=',b);
  assert.equal(a,180,'暗夜羽擊壓制暴龍根性→180,實際='+a);
  assert.equal(b,330,'非振翼髮→180+150=330,實際='+b);
});

T('⑤ 生機森巴 holder在bench不受暗夜羽擊壓制: 樂天河童bench + 對手active振翼髮 → 受益寶可夢仍+40',()=>{
  // P1(對手)active=夠讚狗(受益), bench=樂天河童(生機森巴); P0(玩家A)active=振翼髮暗夜羽擊
  const dog=inst(DOG), samba=inst(SAMBA);
  const st=mk(inst(FLOR),dog,[samba]);
  const hp=getEffectiveHP(dog,pool,st);
  console.log('   夠讚狗(有bench樂天河童+40)對手振翼髮 getEffectiveHP=',hp);
  assert.equal(hp,130+40,'bench生機森巴不被暗夜羽擊壓制(只壓active)→仍+40=170,實際='+hp);
});

T('⑥ 腎上腺力量傷害gate: 夠讚狗(附惡能量)攻擊,對手active=振翼髮暗夜羽擊 → 招式傷害不+100',()=>{
  // P0(玩家A)active=夠讚狗(2鬥+1惡, 好拳70). 對手active=振翼髮暗夜羽擊(90HP) → 腎上腺被壓制→70(振翼髮存活)
  const dog=inst(DOG,{energyAttached:[inst(FIGHT),inst(FIGHT),inst(DARK)]});
  const s=createGame({name:'A',entries:[{cardId:DOG,count:1}]},{name:'B',entries:[{cardId:FLOR,count:1}]},pool);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,turn:6,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{...s.players[0],hand:[],deck:[inst(DOG)],discard:[],prizes:Array.from({length:6},()=>inst(DOG)),bench:[],active:dog},
             {...s.players[1],hand:[],deck:[inst(FLOR)],discard:[],prizes:Array.from({length:6},()=>inst(FLOR)),bench:[],active:inst(FLOR)}]};
  const r=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  const opp=r.players[1].active;
  console.log('   對手振翼髮(90HP)受傷=',opp?.damage,' active存活=',!!opp,'(壓制→70存活;HEAD+100=170→KO null)');
  assert.ok(opp,'腎上腺被壓制傷害應為70,振翼髮(90HP)應存活;HEAD +100=170會KO致null');
  assert.equal(opp?.damage,70,'招式傷害應=70(腎上腺被壓制不+100),實際='+opp?.damage);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
