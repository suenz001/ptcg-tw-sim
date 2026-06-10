// v5.523：普隆隆姆ex|高速破壞「將這隻寶可夢與附加的卡全部丟棄」=丟棄(非昏厥)→對手【不取獎賞卡】。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-hsd.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-hsd.ts'); const O = join(ROOT, '.ent-hsd.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const REVA='10597', METAL='14434';
// 隨便找一張對手基礎當 active + 攻擊方備戰補位
const BASIC=REVA; // 用高HP普隆隆姆ex(hp280)當對手戰鬥位，250傷害打不死→隔離自身丟棄行為（不觸發對手KO/game-over）
// metal 能量 id fallback
let MET=METAL; if(!pool.has(MET)){ for(const[id,c]of pool){if(c.supertype==='Energy'&&c.subtype==='Basic'&&/鋼|Metal/.test(c.name)){MET=id;break;}} }
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 高速破壞：自身與附加卡進棄牌、active清空、對手獎賞【不變】(6→6)',()=>{
  const s=createGame({name:'P1',entries:[{cardId:REVA,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  const energies=[inst(MET),inst(MET),inst(MET)];
  const attacker=inst(REVA,{energyAttached:energies});
  const benchSurvivor=inst(REVA);
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(REVA)],discard:[],prizes:Array.from({length:6},()=>inst(REVA)),bench:[benchSurvivor],active:attacker},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
  const n=applyAction(st,{type:'ATTACK',attackIndex:1},pool);
  // 攻擊方自身寶可夢進棄牌
  const myDisc=n.players[0].discard.map(c=>c.iid);
  assert(myDisc.includes(attacker.iid),'高速破壞寶可夢本體應進攻擊方棄牌，棄牌='+myDisc);
  for(const e of energies) assert(myDisc.includes(e.iid),'附加能量應一起進棄牌');
  // 攻擊方 active 清空(待補位 benchSurvivor 還在)
  assert(n.players[0].active===null || n.players[0].active?.iid===benchSurvivor.iid,'攻擊方 active 應清空或已補位');
  assert([n.players[0].active,...n.players[0].bench].filter(Boolean).some(c=>c.iid===benchSurvivor.iid),'備戰存活者應仍在');
  // ★ 對手獎賞不變（丟棄非昏厥）
  assert.equal(n.players[1].prizes.length,6,'對手不該取獎賞(維持6)，實際'+n.players[1].prizes.length);
  assert.equal(n.players[0].prizes.length,6,'攻擊方也沒KO對手→自己獎賞不變(6)，實際'+n.players[0].prizes.length);
  // 對手 active 安然無恙
  assert(n.players[1].active,'對手戰鬥位不受影響');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
