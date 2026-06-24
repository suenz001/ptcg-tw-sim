/**
 * 官方 QA：振翼髮｜暗夜羽擊 對 裹蜜蟲｜祭典樂舞 / 啪咚猴｜衝衝鼓 的互動（v5.447 / v5.456）
 * Q1 朋友之環 KO 對手場上的振翼髮(暗夜羽擊)，對手補非暗夜羽擊 → 可使用第2次招式（可）。
 * Q2 朋友之環 KO 對手 active，對手補振翼髮(暗夜羽擊) → 不可使用第2次招式（不可）。
 * Q3 對手 active 為暗夜羽擊振翼髮 → 裹蜜蟲祭典樂舞被消除 → 啪咚猴衝衝鼓也不可用（不行）。
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.mq-s.mjs'), E=join(ROOT,'.mq-e.ts'), O=join(ROOT,'.mq-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { createGame, applyAction, getUsableAbilities } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction, getUsableAbilities } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))pool.set(String(c.id),c);}

const APPLIN='10426'/*裹蜜蟲 祭典樂舞/朋友之環*/, YANMA='12854'/*振翼髮 暗夜羽擊 HP90*/,
      GOLDEEN='10440'/*角金魚 HP50 無暗夜羽擊*/, SWIRLIX='10465'/*綿綿泡芙*/, PUNK='10423'/*啪咚猴 衝衝鼓*/,
      STADIUM='10513'/*祭典會場*/, GRASS='17217';
let n=0;const inst=(cid,x={})=>({iid:'t'+(++n),cardId:cid,damage:0,energyAttached:[],...x});
function mk({p0active,p0bench,p1active,p1bench}){
  let s=createGame({name:'P1',entries:[{cardId:APPLIN,count:1}]},{name:'P2',entries:[{cardId:GOLDEEN,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:1,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:0,
    activeStadium:inst(STADIUM),activeStadiumOwnerIdx:0,festivalDanceUsedThisTurn:[false,false],
    players:[
      {...s.players[0],active:p0active,bench:p0bench,hand:[],deck:[inst(GRASS),inst(GRASS)],discard:[],prizes:Array.from({length:6},()=>inst(GRASS))},
      {...s.players[1],active:p1active,bench:p1bench,hand:[],deck:[inst(GRASS)],discard:[],prizes:Array.from({length:6},()=>inst(GRASS))}]};
}
let pass=0,fail=0;
const T=(nm,f)=>{try{f();console.log('  OK',nm);pass++;}catch(e){console.log('  FAIL',nm,'::',e.message);fail++;}};

// ── Q1：KO 對手暗夜羽擊振翼髮，補非暗夜羽擊 → 可第2次 ──
T('★Q1 KO振翼髮後補角金魚 → 祭典樂舞第2次可用(turnPhase=main)', () => {
  let st=mk({p0active:inst(APPLIN,{energyAttached:[inst(GRASS)]}),p0bench:[inst(SWIRLIX),inst(SWIRLIX),inst(SWIRLIX)],
             p1active:inst(YANMA,{damage:40}),p1bench:[inst(GOLDEEN)]}); // 朋友之環=3×20=60, +40=100≥90 KO
  st=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(st.players[1].active,null,'振翼髮應被KO');
  st=applyAction(st,{type:'TAKE_PRIZES',count:1},pool);
  const newIid=st.players[1].bench[0].iid;
  st=applyAction(st,{type:'SEND_NEW_ACTIVE',iid:newIid,senderIdx:1},pool);
  assert.equal(st.turnPhase,'main','補非暗夜羽擊→應回main準備第2次');
  assert.ok(st.festivalDancePendingSecondAttack,'第2次pending應仍在');
});

// ── Q2：KO 對手 active，補振翼髮(暗夜羽擊) → 不可第2次 ──
T('★Q2 KO後補振翼髮(暗夜羽擊) → 第2次中斷(turnPhase=end)', () => {
  let st=mk({p0active:inst(APPLIN,{energyAttached:[inst(GRASS)]}),p0bench:[inst(SWIRLIX),inst(SWIRLIX),inst(SWIRLIX)],
             p1active:inst(GOLDEEN),p1bench:[inst(YANMA)]}); // 60≥50 KO 角金魚
  st=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(st.players[1].active,null,'角金魚應被KO');
  st=applyAction(st,{type:'TAKE_PRIZES',count:1},pool);
  const newIid=st.players[1].bench[0].iid;
  st=applyAction(st,{type:'SEND_NEW_ACTIVE',iid:newIid,senderIdx:1},pool);
  assert.equal(st.turnPhase,'end','補暗夜羽擊→第2次應中斷、回合結束');
  assert.equal(st.festivalDancePendingSecondAttack,null,'pending應清除');
});

// ── Q3：對手暗夜羽擊 active 時，衝衝鼓不可用；移除振翼髮則可用(對照) ──
T('★Q3 對手暗夜羽擊在場 → 衝衝鼓不在可用特性清單', () => {
  const st=mk({p0active:inst(APPLIN,{energyAttached:[inst(GRASS)]}),p0bench:[inst(PUNK)],
               p1active:inst(YANMA),p1bench:[]});
  const ab=getUsableAbilities(st,pool).map(a=>a.abilityName);
  assert.ok(!ab.includes('衝衝鼓'),'暗夜羽擊壓制祭典樂舞→衝衝鼓不可用 實際='+JSON.stringify(ab));
});
T('對照 Q3 對手非暗夜羽擊(角金魚) → 衝衝鼓可用', () => {
  const st=mk({p0active:inst(APPLIN,{energyAttached:[inst(GRASS)]}),p0bench:[inst(PUNK)],
               p1active:inst(GOLDEEN),p1bench:[]});
  const ab=getUsableAbilities(st,pool).map(a=>a.abilityName);
  assert.ok(ab.includes('衝衝鼓'),'無暗夜羽擊→衝衝鼓應可用 實際='+JSON.stringify(ab));
});

console.log('\n暗夜羽擊×祭典樂舞×衝衝鼓 官方QA:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
