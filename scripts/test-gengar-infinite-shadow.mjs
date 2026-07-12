import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-s.js'), E = join(ROOT, '.x-e.ts'), O = join(ROOT, '.x-o.mjs');
process.on('exit', () => { for (const p of [S,E,O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if (c?.id!=null) pool.set(String(c.id), c); }
const GENGAR='18026', HAUNTER='18025', GHASTLY='18024', ATK='18508', EN='17220', W='17221', REGI='16662', LAND='16869';
let _iid=0; const nid=()=>'i'+(++_iid);
function inst(cardId, extra={}) { return { iid:nid(), cardId, damage:0, energyAttached:[], toolAttached:undefined, extraTools:[], evolvedFromStack:undefined, ...extra }; }
function gengar(evoStack, dmg) { return inst(GENGAR, { damage:dmg, energyAttached:[inst(EN)],
  evolvedFromStack: evoStack.map(id=>({iid:nid(),cardId:id,damage:0,energyAttached:[],toolAttached:undefined,extraTools:[],evolvedFromStack:undefined})) }); }
const base = () => ({ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true] });

// 1+2 active KO (小獅獅撞擊10) —— 正常進化 / 糖果
function activeCase(label, evoStack, expect) {
  let st = { ...base(), players:[
    { name:'A', active:inst(ATK,{energyAttached:[inst(EN)]}), bench:[], hand:[], deck:[inst(EN)], discard:[], prizes:[1,1,1,1,1,1] },
    { name:'B', active:gengar(evoStack,120), bench:[inst(ATK)], hand:[], deck:[inst(EN)], discard:[], prizes:[1,1,1,1,1,1] } ] };
  st = mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  const ids=st.players[1].hand.map(c=>c.cardId).sort();
  const iids=st.players[1].hand.map(c=>c.iid);
  assert.deepStrictEqual(ids, expect.slice().sort(), `${label} 手牌=${st.players[1].hand.map(c=>pool.get(c.cardId)?.name)}`);
  assert.ok(iids.length===new Set(iids).size, `${label} 無 dup iid`);
  assert.ok(st.players[1].discard.some(c=>c.cardId===EN), `${label} 能量進棄牌`);
  console.log(`✓ [active] ${label}: ${st.players[1].hand.map(c=>pool.get(c.cardId)?.name).join(',')}`);
}
activeCase('正常進化', [GHASTLY,HAUNTER], [GENGAR,HAUNTER,GHASTLY]);
activeCase('神奇糖果', [GHASTLY], [GENGAR,GHASTLY]);

// 3 bench 對手擴散 KO (雷吉艾斯 暴風雪) → 回手
{
  const ai = pool.get(REGI).attacks.findIndex(a=>a.name==='暴風雪');
  let st = { ...base(), players:[
    { name:'A', active:inst(REGI,{energyAttached:[inst(W),inst(EN),inst(EN)]}), bench:[], hand:[], deck:[inst(EN)], discard:[], prizes:[1,1,1,1,1,1] },
    { name:'B', active:inst(ATK,{damage:0}), bench:[gengar([GHASTLY,HAUNTER],120)], hand:[], deck:[inst(EN)], discard:[], prizes:[1,1,1,1,1,1] } ] };
  st = mod.applyAction(st,{type:'ATTACK',attackIndex:ai,actorIdx:0},pool);
  const ids=st.players[1].hand.map(c=>c.cardId).sort();
  assert.deepStrictEqual(ids,[GENGAR,GHASTLY,HAUNTER].sort(), `備戰擴散KO 手牌=${st.players[1].hand.map(c=>pool.get(c.cardId)?.name)}`);
  console.log(`✓ [bench對手擴散] 暴風雪: ${st.players[1].hand.map(c=>pool.get(c.cardId)?.name).join(',')}`);
}

// 4 自傷 gate:自己地震 KO 自己備戰耿鬼 → 應丟棄不回手
{
  const ai = pool.get(LAND).attacks.findIndex(a=>a.name==='地震');
  let st = { ...base(), players:[
    { name:'A', active:inst(LAND,{energyAttached:[inst('17215'),inst(EN),inst(EN)]}), bench:[gengar([GHASTLY,HAUNTER],120)], hand:[], deck:[inst(EN)], discard:[], prizes:[1,1,1,1,1,1] },
    { name:'B', active:inst(GENGAR,{damage:0}), bench:[inst(ATK)], hand:[], deck:[inst(EN)], discard:[], prizes:[1,1,1,1,1,1] } ] };
  st = mod.applyAction(st,{type:'ATTACK',attackIndex:ai,actorIdx:0},pool);
  const p0hand=st.players[0].hand.map(c=>c.cardId);
  const p0disc=st.players[0].discard.map(c=>c.cardId);
  assert.ok(!p0hand.includes(GENGAR), `自傷不應回手 手牌=${st.players[0].hand.map(c=>pool.get(c.cardId)?.name)}`);
  assert.ok(p0disc.includes(GENGAR), `自傷應進棄牌`);
  console.log(`✓ [自傷gate] 地震自KO耿鬼→丟棄不回手(棄牌:${st.players[0].discard.map(c=>pool.get(c.cardId)?.name).join(',')})`);
}
console.log('\n✅ 無限之影全部 PASS');
