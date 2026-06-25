// v5.720 回歸:呆呆王耀閃挑戰借巨金怪金屬之錘(binary-yes-no「若希望丟3鋼+150」)。
//   玩家報「無法選不希望」。根因:effects 無條件強制 sentinel yes,覆蓋玩家選擇。
//   修:只在 action 無 discardedEnergyIids(AI/fallback)才預設 yes;玩家選了(含否=空陣列)就尊重。
//   官方判例:借者選希望→+150(有鋼則丟,沒鋼也+150);選不希望→base 150。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-bb.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-bb.ts'); const O = join(ROOT, '.ent-bb.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { ATTACK_PRE } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const SLOWKING='10934', METAGROSS='18479', METAL='11180', BUD='14443';
let nn=0;
const inst=(cid,e=[])=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
const mkState=(slowkingEnergies)=>{
  const metagross=inst(METAGROSS);
  return {
    state:{ phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
      players:[
        { name:'P1', active:inst(SLOWKING, slowkingEnergies), bench:[], hand:[], deck:[metagross,inst(BUD)], discard:[], prizes:[] },
        { name:'P2', active:inst(BUD), bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[] },
      ],
    }, metagrossIid: metagross.iid };
};
const fn = ATTACK_PRE.get('呆呆王|耀閃挑戰');
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

T('選不希望(discardedEnergyIids=[])→base 150 [驗HEAD強制sentinel→300 FAIL]', () => {
  const {state, metagrossIid} = mkState([en(METAL)]);
  const out = fn(state, 0, pool, { type:'ATTACK', attackIndex:0, copyAttackChoice:{pokeIid:metagrossIid, attackIndex:1}, discardedEnergyIids:[] });
  assert.equal(out.damage, 150, `選否應 150,實 ${out.damage}`);
});
T('選希望+呆呆王有1鋼(discardedEnergyIids=[鋼iid])→丟鋼+150=300', () => {
  const metalE = en(METAL);
  const {state, metagrossIid} = mkState([metalE]);
  const out = fn(state, 0, pool, { type:'ATTACK', attackIndex:0, copyAttackChoice:{pokeIid:metagrossIid, attackIndex:1}, discardedEnergyIids:[metalE.iid] });
  assert.equal(out.damage, 300, `選是+鋼應 300,實 ${out.damage}`);
  // 呆呆王身上鋼能量應被丟
  const slow = out.state.players[0].active;
  assert.equal(slow.energyAttached.length, 0, '呆呆王鋼能量應被丟棄');
});
T('AI/fallback(無 discardedEnergyIids)→預設希望 sentinel +150=300', () => {
  const {state, metagrossIid} = mkState([]);
  const out = fn(state, 0, pool, { type:'ATTACK', attackIndex:0, copyAttackChoice:{pokeIid:metagrossIid, attackIndex:1} });
  assert.equal(out.damage, 300, `fallback 應 300,實 ${out.damage}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
