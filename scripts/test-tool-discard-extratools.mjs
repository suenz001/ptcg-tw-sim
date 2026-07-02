/** v5.841 丟/移除對手或自身道具含 extraTools(多重轉接洛托姆) + 掃除化隱免疫
 *  腐蝕液/刺殺迴旋/掃除 原只讀 toolAttached 漏 extraTools;掃除另漏化隱 gate。
 *  HEAD:extraTools 殘留(未丟) / 掃除對化隱對手仍丟道具 → FAIL。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.td-s.js'),E=join(ROOT,'.td-e.ts'),O=join(ROOT,'.td-o.mjs');
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
let nn=0;
const tool=(nm)=>({iid:'tool_'+(++nn),cardId:'90000',damage:0,energyAttached:[],_nm:nm});
// 2 道具寶可夢:toolAttached + extraTools[1]
const twoTool=(cid)=>({iid:'p'+(++nn),cardId:String(cid),damage:0,energyAttached:[],toolAttached:tool('T1'),extraTools:[tool('T2')]});
const plain=(cid)=>({iid:'a'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
const mk=(oppActive)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:plain(POKE),bench:[],hand:[],deck:[],discard:[],prizes:[1]},
           {name:'P2',active:oppActive,bench:[],hand:[],deck:[],discard:[],prizes:[1]}]});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('腐蝕液:丟對手 2 道具(含 extraTools)', () => {
  const out=ATTACK_POST.get('超級毒藻龍ex|腐蝕液')(mk(twoTool(POKE)),0,pool);
  const a=out.players[1].active;
  assert.ok(!a.toolAttached, 'toolAttached 應清空');
  assert.equal((a.extraTools??[]).length, 0, `extraTools 應清空,實得 ${(a.extraTools??[]).length}`);
  assert.equal(out.players[1].discard.length, 2, `對手棄牌應 2 張道具,實得 ${out.players[1].discard.length}`);
});
// v5.849：掃除改玩家 picker(選對手道具)→ picker+extraTools+化隱免疫改由 test-scavenge-tool-picker 覆蓋。
T('刺殺迴旋:自身回手,2 道具(含 extraTools)入棄牌', () => {
  const st=mk(plain(POKE));
  st.players[0].active=twoTool(POKE);   // 攻擊者自身帶 2 道具
  const out=ATTACK_POST.get('火箭隊的叉字蝠ex|刺殺迴旋')(st,0,pool,{discardedEnergyIids:undefined});
  assert.equal(out.players[0].active, null, '自身應回手(active=null)');
  const tools=out.players[0].discard.filter(c=>c.cardId==='90000');
  assert.equal(tools.length, 2, `自身 2 道具應入棄牌,實得 ${tools.length}`);
});
console.log('\n丟道具 extraTools + 掃除免疫(v5.841):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
