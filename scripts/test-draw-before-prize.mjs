// 螺旋俯衝/報恩 等「抽到手牌滿N」攻擊：抽牌須在「氣絕拿獎(自動進手牌)」之前(v5.509移到regPre)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-dp.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-dp.ts'); const O = join(ROOT, '.ent-dp.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GARC='12702', ODDISH='14319' /*50hp*/, WAIL='19159' /*380hp*/, FIG='11178', ROS='16504' /*羅絲雷朵+30*/, FILL='14319';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(defId, handN, benchExtra=[]){
  const s=createGame({name:'P1',entries:[{cardId:GARC,count:1}]},{name:'P2',entries:[{cardId:defId,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:Array.from({length:handN},()=>inst(FILL)),deck:Array.from({length:12},()=>inst(FILL)),discard:[],prizes:Array.from({length:6},()=>inst(GARC)),bench:[inst(GARC),...benchExtra],active:inst(GARC,{energyAttached:[inst(FIG)]})},
             {...s.players[1],hand:[],deck:[inst(defId)],discard:[],prizes:Array.from({length:6},()=>inst(defId)),bench:[inst(defId)],active:inst(defId)}]};
}
const atk=(st,extra={})=>applyAction(st,{type:'ATTACK',attackIndex:0,...extra},pool);
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ KO情境：手牌3 → 螺旋俯衝(抽到6)KO走路草 → 先抽滿(6)再拿獎(+1) → 手牌7(舊bug=6)',()=>{
  const n=atk(mk(ODDISH,3));
  assert(!n.players[1].active || n.players[1].active.cardId!==ODDISH,'走路草應被KO');
  assert.equal(n.players[0].hand.length,7,'應抽滿6再拿1獎=7，實際'+n.players[0].hand.length);
  assert.equal(n.players[0].prizes.length,5,'應取1獎賞(6→5)，實際'+n.players[0].prizes.length);
});
T('② 非KO：手牌3 → 打吼鯨王ex(存活) → 抽到6、無獎賞 → 手牌6',()=>{
  const n=atk(mk(WAIL,3));
  assert(n.players[1].active?.cardId===WAIL && n.players[1].active.damage===100,'吼鯨王ex存活受100，實際dmg='+n.players[1].active?.damage);
  assert.equal(n.players[0].hand.length,6,'應抽到6，實際'+n.players[0].hand.length);
});
T('③ 羅絲雷朵+30 加成未因 regPre 改動而丟失：螺旋俯衝 100+30=130',()=>{
  const n=atk(mk(WAIL,3,[inst(ROS)]));
  assert.equal(n.players[1].active?.damage,130,'有羅絲雷朵應130，實際'+n.players[1].active?.damage);
});
T('④ 選「否」(discardedEnergyIids:[]) → 跳過抽牌，手牌維持3',()=>{
  const n=atk(mk(WAIL,3),{discardedEnergyIids:[]});
  assert.equal(n.players[0].hand.length,3,'選否不抽，手牌應3，實際'+n.players[0].hand.length);
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
