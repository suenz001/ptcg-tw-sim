/** 神奇糖果進化後特性可用(黑夜魔靈咒詛炸彈) — 對比一般 EVOLVE v5.796 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.rc-s.js'), E = join(ROOT,'.rc-e.ts'), O = join(ROOT,'.rc-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, getUsableAbilities } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, getUsableAbilities } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const YOMAWARU='14732'/*夜巡靈 Basic*/, SAMAYOURU='14733'/*彷徨夜靈 Stage1*/, YONOWARU='14734'/*黑夜魔靈 Stage2 咒詛炸彈*/, KADABRA='15309';
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// 取一隻對手作目標(咒詛炸彈需對手寶可夢)
const oppActive = () => inst(YOMAWARU,{iid:'opp1'});
const baseState = (myBench) => ({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,activeStadium:null,
  players:[{name:'P1',active:inst(YOMAWARU,{iid:'myact'}),bench:myBench,hand:[],deck:[inst(YOMAWARU)],discard:[],prizes:[1,2,3]},
           {name:'P2',active:oppActive(),bench:[],hand:[],deck:[inst(YOMAWARU)],discard:[],prizes:[1,2,3]}]});

T('★神奇糖果進化黑夜魔靈後,咒詛炸彈應出現在 getUsableAbilities', () => {
  // 夜巡靈在備戰 iid=base1; 黑夜魔靈在手牌 iid=hand1
  const base1 = inst(YOMAWARU,{iid:'base1'});
  const hand1 = inst(YONOWARU,{iid:'hand1'});
  let st = baseState([base1]);
  st.players[0].hand=[hand1];
  // 設 rare-candy-evolve pending,resolve 目標 base1
  st.pendingSelection = { type:'heal-target', actorIdx:0, sourcePlayerIdx:0, minCount:1, maxCount:1, filter:'', effectKey:'rare-candy-evolve', params:{ stage2Iid:'hand1', validIids:['base1'] } };
  st = applyAction(st, { type:'RESOLVE_SELECTION', selectedIids:['base1'] }, pool);
  // 進化後 bench 應有黑夜魔靈
  const ev = st.players[0].bench.find(b=>b.cardId===YONOWARU);
  assert.ok(ev, '進化後 bench 應有黑夜魔靈');
  console.log('    進化體 iid =', ev.iid, '(base1=保留場上身份 / hand1=沿用手牌 bug)');
  // 根因:進化體必須【保留場上 base 的 iid】(穩定身份),否則前端用原 slot iid 對應斷裂→特性點不出
  assert.equal(ev.iid, 'base1', `進化體應保留場上 iid 'base1'(同 engine EVOLVE),HEAD 沿用手牌 iid '${ev.iid}'→前端對應斷裂`);
  const usable = getUsableAbilities(st, pool);
  const has = usable.some(u => u.iid === ev.iid && /咒詛炸彈/.test(JSON.stringify(u)));
  assert.ok(has, `咒詛炸彈 應可用且 iid 對得上(getUsableAbilities 含進化體 iid=${ev.iid})`);
});

console.log('\n神奇糖果進化特性(v5.796):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
