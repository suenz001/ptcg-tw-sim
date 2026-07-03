// v5.854 美納斯ex｜璀璨鱗片 — 卡面「不受對手『太晶』寶可夢招式的【傷害與效果】的影響」。
//   HEAD 只在 PASSIVE_IMMUNITY(傷害)註冊、漏 ATTACK_EFFECT_IMMUNITY(效果)→ 太晶攻擊者的招式效果
//   (施狀態/丟能量/移指示物等)照樣生效(v2.267 註解自承「效果暫不處理」)。補效果側,鏡射傷害側太晶條件。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x-s.js'),E=join(ROOT,'.x-e.ts'),O=join(ROOT,'.x-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { canApplyEffectToTarget } from './src/lib/game/defense';\nexport { passiveImmunityDamageBlock } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { canApplyEffectToTarget, passiveImmunityDamageBlock } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],extraTools:[],...e});
const MENAS='11484', TERA='14677', NONTERA='14086'; // 美納斯ex / 太晶寶可夢 / 非太晶
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
function st(attCid){ return { phase:'playing', turnPhase:'main', activePlayerIndex:0, players:[
  { name:'A', active:inst(attCid), bench:[], hand:[], deck:[], discard:[], prizes:[] },
  { name:'B', active:inst(MENAS), bench:[], hand:[], deck:[], discard:[], prizes:[] } ]}; }
const tc=pool.get(MENAS);

T('太晶攻擊者 → 招式效果 被璀璨鱗片免疫 [HEAD FAIL:HEAD漏效果側]', ()=>{
  const s=st(TERA); const r=canApplyEffectToTarget(s,0,s.players[1].active,tc,'attack-effect',pool);
  assert.equal(r.blocked,true,'太晶攻擊者招式效果應被擋');
});
T('太晶攻擊者 → 招式傷害 被璀璨鱗片免疫(傷害側 passiveImmunityDamageBlock,原本就對)', ()=>{
  const s=st(TERA); const r=passiveImmunityDamageBlock(s,0,tc,pool);
  assert.equal(r.blocked,true,'太晶攻擊者招式傷害應被擋');
});
T('控制:非太晶攻擊者 → 招式效果 不免疫(卡面只免疫太晶)', ()=>{
  const s=st(NONTERA); const r=canApplyEffectToTarget(s,0,s.players[1].active,tc,'attack-effect',pool);
  assert.equal(r.blocked,false,'非太晶攻擊者不應被擋');
});
T('控制:非太晶攻擊者 → 招式傷害 不免疫', ()=>{
  const s=st(NONTERA); const r=passiveImmunityDamageBlock(s,0,tc,pool);
  assert.equal(r.blocked,false,'非太晶攻擊者傷害不應被擋');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`); process.exit(fail?1:0);
