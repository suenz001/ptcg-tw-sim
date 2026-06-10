// v5.520：「直接昏厥/招式效果KO」收斂中央 markFaintByEffect（取代 +9999/=99999 假傷害）。
//   驗 死亡靈魂(伊裴爾塔爾ex) 對剩餘HP≤50 的對手寶可夢效果KO：對手寶可夢被移除、攻擊方取獎賞。
//   markFaintByEffect 把 damage 設為「有效maxHP」剛好昏厥(非 99999)，KO 被擋時不殘留負HP。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-efko.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-efko.ts'); const O = join(ROOT, '.ent-efko.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const YVELTAL='18029', DARK='14430';
// 找乾淨基礎目標：hp 60~90、無特性、無弱點干擾
let TGT=null;
for (const [id,c] of pool){ if(c.supertype==='Pokemon'&&c.stage==='Basic'&&c.subtype!=='ex'&&(c.hp>=60&&c.hp<=90)&&!(c.abilities||[]).length){TGT=id;break;} }
assert(TGT,'找不到乾淨基礎目標');
const tgtHp = pool.get(TGT).hp;
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 死亡靈魂效果KO 剩餘HP≤50 的對手戰鬥寶可夢（markFaintByEffect 非 99999）',()=>{
  const s=createGame({name:'P1',entries:[{cardId:YVELTAL,count:1}]},{name:'P2',entries:[{cardId:TGT,count:1}]},pool);
  // 攻擊方=伊裴爾塔爾ex 附 DDD(滿足 DDC) ；對手 active 預傷使剩餘=tgtHp-(tgtHp-40)=40 ≤50
  const preDmg = tgtHp - 40;
  const attacker=inst(YVELTAL,{energyAttached:[inst(DARK),inst(DARK),inst(DARK)]});
  const victim=inst(TGT,{damage:preDmg});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(YVELTAL)],discard:[],prizes:Array.from({length:6},()=>inst(YVELTAL)),bench:[],active:attacker},
             {...s.players[1],hand:[],deck:[inst(TGT)],discard:[],prizes:Array.from({length:6},()=>inst(TGT)),bench:[inst(TGT)],active:victim}]};
  const n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  // 對手原 active(victim) 應已昏厥離場：要嘛 active 換成備戰補位、要嘛進棄牌
  const oppActiveIid = n.players[1].active?.iid;
  assert(oppActiveIid !== victim.iid, '對手戰鬥寶可夢應被效果KO離場（active 不再是 victim）');
  const discardIds = n.players[1].discard.map(c=>c.cardId);
  assert(discardIds.includes(TGT), '被KO的寶可夢應進棄牌區');
  // 攻擊方取獎賞（基礎非ex=1張：6→5）
  assert.equal(n.players[0].prizes.length, 5, '攻擊方應取1張獎賞(6→5)，實際'+n.players[0].prizes.length);
  // 全場無殘留 99999/負HP
  const allInsts=[...n.players[0].bench,n.players[0].active,...n.players[1].bench,n.players[1].active].filter(Boolean);
  for(const c of allInsts) assert((c.damage??0)<90000, '不應殘留 99999 假傷害，'+c.cardId+' damage='+c.damage);
});

T('② 對手無剩餘HP≤50 的寶可夢 → 死亡靈魂不KO任何寶可夢',()=>{
  const s=createGame({name:'P1',entries:[{cardId:YVELTAL,count:1}]},{name:'P2',entries:[{cardId:TGT,count:1}]},pool);
  const attacker=inst(YVELTAL,{energyAttached:[inst(DARK),inst(DARK),inst(DARK)]});
  const victim=inst(TGT,{damage:0}); // 滿血 tgtHp(>50) → 不符合昏厥條件
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(YVELTAL)],discard:[],prizes:Array.from({length:6},()=>inst(YVELTAL)),bench:[],active:attacker},
             {...s.players[1],hand:[],deck:[inst(TGT)],discard:[],prizes:Array.from({length:6},()=>inst(TGT)),bench:[],active:victim}]};
  const n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(n.players[1].active?.iid, victim.iid, '滿血(>50HP)對手不該被效果KO');
  assert.equal(n.players[0].prizes.length, 6, '沒KO→不取獎賞(維持6)');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
