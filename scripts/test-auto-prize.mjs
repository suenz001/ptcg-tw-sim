// 回歸測試網：自動給獎賞（v5.466）— KO 當下立即發牌+私密log，取代手動【取得】鈕。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.ap-e.ts'),O=join(ROOT,'.ap-o.mjs'),S=join(ROOT,'.ap-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame, applyAction } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const CID={onix:'13979',dra:'14794',ubo:'17976',fireE:'14428',psyE:'14103',def:'13163',zaruEx:'10619',momoEx:'14137',olive:'16542',anc:'17212',grass:'14102'};
let iid=0;const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const base=()=>createGame({name:'P1',entries:[{cardId:CID.def,count:1}]},{name:'P2',entries:[{cardId:CID.def,count:1}]},pool);
const guai=pool.get(CID.onix).attacks.findIndex(a=>a.name==='怪力');
const phan=pool.get(CID.dra).attacks.findIndex(a=>a.name==='幻影奇襲');
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('  ✅',n);pass++;}catch(e){console.log('  ❌',n+':',e.message);fail++;}};
const prizeOf=n=>Array.from({length:n},()=>inst(CID.ubo));
function mk(opts={}){
  const s=base();
  const atkActive=opts.atk||inst(CID.onix,{energyAttached:[inst(CID.fireE),inst(CID.fireE),inst(CID.fireE),inst(CID.fireE)]});
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(CID.def)],discard:[],prizes:prizeOf(opts.atkPrizes??6),bench:[],active:atkActive},
             {...s.players[1],hand:[],deck:[inst(CID.def)],discard:[],prizes:prizeOf(6),bench:opts.defBench||[],active:opts.defActive||inst(CID.ubo)}]};
}

T('單KO：攻擊方獎賞6→5、卡進手牌、pendingPrizes恆0、私密log有卡名', ()=>{
  const st=mk();
  const n=applyAction(st,{type:'ATTACK',attackIndex:guai},pool);
  assert.equal(n.players[0].prizes.length,5,'獎賞6→5（已自動取1）');
  assert.equal(n.players[0].hand.filter(c=>String(c.cardId)===CID.ubo).length,1,'1張獎賞進手牌');
  assert.deepEqual(n.pendingPrizes,[0,0],'pendingPrizes 恆0（無待領）');
  const plog=n.log.filter(l=>l.privateMessage&&l.privateMessage.includes('取得了')&&l.playerIndex===0);
  assert.equal(plog.length,1,'有1筆私密取獎賞log給攻擊方 實際'+plog.length);
  assert.ok(/烏波|帕底亞/.test(plog[0].privateMessage),'私密log見卡名');
  assert.ok(plog[0].message.includes('取得了')&&!/帕底亞|烏波/.test(plog[0].message),'公開log只見張數不見卡名');
});
T('幻影奇襲多重KO：active+1備戰→自動取2獎賞(6→4)', ()=>{
  const st=mk({atk:inst(CID.dra,{energyAttached:[inst(CID.fireE),inst(CID.psyE)]}),defBench:[inst(CID.ubo),inst(CID.ubo)]});
  let n=applyAction(st,{type:'ATTACK',attackIndex:phan},pool);
  const b0=n.players[1].bench[0].iid;
  let m=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'dragapult-snipe',selectedIids:Array.from({length:6},()=>b0),actorIdx:0},pool);
  assert.equal(m.players[0].prizes.length,4,'自動取2獎賞 6→4 實際'+m.players[0].prizes.length);
  assert.deepEqual(m.pendingPrizes,[0,0],'無待領');
});
T('終局：攻擊方剩1獎賞→KO→取最後一張→game-over', ()=>{
  const st=mk({atkPrizes:1});
  const n=applyAction(st,{type:'ATTACK',attackIndex:guai},pool);
  assert.equal(n.phase,'game-over','取完最後獎賞→終局');
  assert.equal(n.winner,0,'攻擊方獲勝');
});
T('防守方補位：KO後無獎賞gate阻擋，可直接補位', ()=>{
  const st=mk({defBench:[inst(CID.ubo)]});
  const n=applyAction(st,{type:'ATTACK',attackIndex:guai},pool);
  assert.equal(n.players[1].active,null,'我active被KO');
  assert.deepEqual(n.pendingPrizes,[0,0],'無待領(已自動發)');
  const m=applyAction(n,{type:'SEND_NEW_ACTIVE',iid:n.players[1].bench[0].iid,senderIdx:1},pool);
  assert.ok(m.players[1].active,'補位成功');
});
T('幻影奇襲根治：僅1備戰被6指示物KO + active被200KO → game-over不卡', ()=>{
  const st=mk({atk:inst(CID.dra,{energyAttached:[inst(CID.fireE),inst(CID.psyE)]}),defBench:[inst(CID.ubo)]});
  let n=applyAction(st,{type:'ATTACK',attackIndex:phan},pool);
  const b0=n.players[1].bench[0].iid;
  let m=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'dragapult-snipe',selectedIids:Array.from({length:6},()=>b0),actorIdx:0},pool);
  assert.equal(m.phase,'game-over','終局不卡');
  assert.deepEqual(m.pendingPrizes,[0,0],'無殘留待領');
});
T('鬆口氣claw-back：KO願增猿ex(2獎賞)但防守方有桃歹郎ex → 攻擊方淨拿1(6→5)', ()=>{
  const st=mk({defActive:inst(CID.zaruEx,{damage:120}),defBench:[inst(CID.momoEx)]});
  const n=applyAction(st,{type:'ATTACK',attackIndex:guai},pool);
  assert.equal(n.players[0].prizes.length,5,'2獎賞-1鬆口氣=淨拿1 (6→5) 實際'+n.players[0].prizes.length);
});
T('對照組：KO願增猿ex無桃歹郎ex → 攻擊方拿2(6→4)', ()=>{
  const st=mk({defActive:inst(CID.zaruEx,{damage:120}),defBench:[inst(CID.ubo)]});
  const n=applyAction(st,{type:'ATTACK',attackIndex:guai},pool);
  assert.equal(n.players[0].prizes.length,4,'ex 2獎賞 (6→4) 實際'+n.players[0].prizes.length);
});

T('油之機關槍 KO 古舊能量基礎(1獎賞)→koPrizesAdjusted -1→攻擊方拿0(6→6)', ()=>{
  const s=base();
  const olAtk=pool.get(CID.olive).attacks.findIndex(a=>a.name==='油之機關槍');
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],ancientEnergyMinusOneUsed:[false,false],
    players:[{...s.players[0],hand:[],deck:[inst(CID.def)],discard:[],prizes:prizeOf(6),bench:[],active:inst(CID.olive,{energyAttached:[inst(CID.grass)]})},
             {...s.players[1],hand:[],deck:[inst(CID.def)],discard:[],prizes:prizeOf(6),bench:[],active:inst(CID.ubo,{energyAttached:[inst(CID.anc)]})}]};
  let n=applyAction(st,{type:'ATTACK',attackIndex:olAtk},pool);
  const a=n.players[1].active.iid;
  let m=applyAction(n,{type:'RESOLVE_SELECTION',effectKey:'olive-oil-distribute',selectedIids:Array.from({length:6},()=>a),actorIdx:0},pool);
  assert.equal(m.players[0].prizes.length,6,'古舊能量-1：1-1=0 攻擊方獎賞不變 實際'+m.players[0].prizes.length);
});

console.log(`\n結果：${pass} pass / ${fail} fail`);
process.exit(fail?1:0);
