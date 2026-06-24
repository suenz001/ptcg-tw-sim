/**
 * 「依對手撤退費×N」傷害 — 用有效撤退費（v5.690）
 * 影繩結(瑪夏多/長毛巨魔)、幻影迷宮 早已用 computeActiveRetreatCostFor(v5.082/v5.362)，
 * 但 阿利多斯|線帶纏繞、鐵包袱|瞬風衝激、投摔鬼|背負上投 仍硬讀 base retreatCost.length，
 * 漏算咒縛火焰(+1)/重力之玉/磁鐵能量/浮遊/鼓擊(retreatCostIncreaseThisTurn)等修正。
 * 修：三招改用中央 computeActiveRetreatCostFor。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.rc-s.mjs'), E=join(ROOT,'.rc-e.ts'), O=join(ROOT,'.rc-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,"export { createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE } from './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame, ATTACK_PRE } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const DEF='14705'/*小磁怪 base撤退1*/;
let n=0;const inst=(cid,x={})=>({iid:'t'+(++n),cardId:cid,damage:0,energyAttached:[],...x});
// 對手 active = 小磁怪(base撤退1) + retreatCostIncreaseThisTurn:2 → 有效撤退=3
function dmg(atkCid,key,incr){
  const s=createGame({name:'P1',entries:[{cardId:atkCid,count:1}]},{name:'P2',entries:[{cardId:DEF,count:1}]},pool);
  const oppActive=inst(DEF, incr?{retreatCostIncreaseThisTurn:incr}:{});
  const st={...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,
    players:[{...s.players[0],active:inst(atkCid),bench:[]},{...s.players[1],active:oppActive,bench:[]}]};
  return ATTACK_PRE.get(key)(st,0,pool).damage;
}
let pass=0,fail=0;
const T=(nm,f)=>{try{f();console.log('  OK',nm);pass++;}catch(e){console.log('  FAIL',nm,'::',e.message);fail++;}};

// base撤退1 + 增2 = 有效3
T('★阿利多斯|線帶纏繞：有效撤退3 → 10+3×30=100 (HEAD base1→40)', () =>
  assert.equal(dmg('10252','阿利多斯|線帶纏繞',2), 100));
T('★鐵包袱|瞬風衝激：有效撤退3 → 200-3×50=50 (HEAD base1→150)', () =>
  assert.equal(dmg('11211','鐵包袱|瞬風衝激',2), 50));
T('★投摔鬼|背負上投：有效撤退3 → 120-3×30=30 (HEAD base1→90)', () =>
  assert.equal(dmg('13739','投摔鬼|背負上投',2), 30));
// baseline 無修正：有效=base 1
T('baseline 線帶纏繞 無修正 → 10+1×30=40', () => assert.equal(dmg('10252','阿利多斯|線帶纏繞',0), 40));
T('baseline 背負上投 無修正 → 120-1×30=90', () => assert.equal(dmg('13739','投摔鬼|背負上投',0), 90));

console.log('\n依對手撤退費×N 有效撤退費:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
