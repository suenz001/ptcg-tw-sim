// 豪邁炸彈（M5 PokemonTool）受傷反擊：holder（非Mega ex）在戰鬥場被對手 Mega ex 240+ 招式傷害
//   → 攻擊方放 12 個指示物(+120) + 道具丟棄。核心修正：holder 被 KO 時仍要觸發（v5.080/v5.494 同類）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-lb.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-lb.ts'); const O = join(ROOT, '.ent-lb.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';
export { TOOL_ON_DAMAGED, TOOL_ON_KO } from './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, TOOL_ON_DAMAGED, TOOL_ON_KO } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const BOMB='19217', ELE='17975' /*超級艾路雷朵ex 非凡刀鋒#1 240*/, GENE='14326' /*蓋諾賽克特 hp120*/,
      WAIL='19159' /*吼鯨王ex hp380 非Mega*/,      EMBO='16584' /*超級炎武王ex hp380 Mega*/, RAKI='14335' /*萊希拉姆 非Mega 燃燒閃焰240*/, FIG='11178', FIRE='18518';
for (const [id,nm] of [[BOMB,'豪邁炸彈'],[ELE,'超級艾路雷朵ex'],[GENE,'蓋諾賽克特'],[WAIL,'吼鯨王ex'],[RAKI,'萊希拉姆'],[EMBO,'超級炎武王ex']])
  assert(pool.get(id)?.name===nm, `卡資料缺 ${nm}(${id})=${pool.get(id)?.name}`);

let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const prizeOf=n=>Array.from({length:n},()=>inst(GENE));
// P0=攻擊方, P1=防守方(holder, 附豪邁炸彈)
function mk(attackerId, energyId, energyN, defenderId, defDamage=0, defMegaTool=true){
  const s=createGame({name:'P1',entries:[{cardId:attackerId,count:1}]},{name:'P2',entries:[{cardId:defenderId,count:1}]},pool);
  const attacker=inst(attackerId,{energyAttached:Array.from({length:energyN},()=>inst(energyId))});
  const defender=inst(defenderId,{damage:defDamage, toolAttached: defMegaTool?inst(BOMB):undefined});
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[
      {...s.players[0],hand:[],deck:[inst(attackerId)],discard:[],prizes:prizeOf(6),bench:[inst(attackerId)],active:attacker},
      {...s.players[1],hand:[],deck:[inst(defenderId)],discard:[],prizes:prizeOf(6),bench:[inst(defenderId)],active:defender},
    ]};
}
const atkDmg = s => s.players[0].active?.damage ?? -1;
const defGone = (s,id) => !s.players[1].active || s.players[1].active.cardId!==id;
const bombInDiscard = s => s.players[1].discard.some(c=>c.cardId===BOMB) || s.players[1].discard.some(c=>pool.get(c.cardId)?.name==='豪邁炸彈');

let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① TOOL_ON_DAMAGED 含豪邁炸彈，TOOL_ON_KO 不含（故需 KO 分支補觸發）',()=>{
  assert(TOOL_ON_DAMAGED.has('豪邁炸彈'),'豪邁炸彈應在 TOOL_ON_DAMAGED');
  assert(!TOOL_ON_KO.has('豪邁炸彈'),'豪邁炸彈不應在 TOOL_ON_KO（依賴真實傷害值）');
});
T('② 非KO：超級艾路雷朵ex 非凡刀鋒240 打 吼鯨王ex(380,holder) → 存活 + 攻擊方+120 + 道具丟棄',()=>{
  const n=applyAction(mk(ELE,FIG,3,WAIL,0), {type:'ATTACK',attackIndex:1}, pool);
  assert(!defGone(n,WAIL),'吼鯨王ex應存活');
  assert.equal(atkDmg(n),120,'攻擊方應+120，實際'+atkDmg(n));
  assert(bombInDiscard(n),'豪邁炸彈應已丟棄');
});
T('③★ KO：非凡刀鋒240 打 蓋諾賽克特(120,holder) → 被KO，攻擊方仍應+120（核心修正）',()=>{
  const n=applyAction(mk(ELE,FIG,3,GENE,0), {type:'ATTACK',attackIndex:1}, pool);
  assert(defGone(n,GENE),'蓋諾賽克特應被KO移除');
  assert.equal(atkDmg(n),120,'KO情境攻擊方仍應+120，實際'+atkDmg(n));
});
T('④ gate dmg<240：超級艾路雷朵ex 快手斬#0(50) 打 吼鯨王ex(holder) → 不觸發(攻擊方+0)',()=>{
  const n=applyAction(mk(ELE,FIG,3,WAIL,0), {type:'ATTACK',attackIndex:0}, pool);
  assert.equal(atkDmg(n),0,'dmg<240不應反擊，實際'+atkDmg(n));
});
T('⑤ gate 攻擊方非Mega ex：萊希拉姆 燃燒閃焰240 打 吼鯨王ex(380,holder,存活) → 不觸發',()=>{
  const n=applyAction(mk(RAKI,FIRE,4,WAIL,0), {type:'ATTACK',attackIndex:1}, pool);
  assert(!defGone(n,WAIL),'吼鯨王ex應存活(240<380)');
  assert(!n.log.some(l=>String(l.message).includes('豪邁炸彈')),'攻擊方非Mega ex不應觸發豪邁炸彈');
});
T('⑥ gate 防守方是Mega ex：非凡刀鋒240 打 超級炎武王ex(380,holder Mega) → 不觸發',()=>{
  const n=applyAction(mk(ELE,FIG,3,EMBO,0), {type:'ATTACK',attackIndex:1}, pool);
  assert.equal(atkDmg(n),0,'holder為Mega ex不應反擊，實際'+atkDmg(n));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
