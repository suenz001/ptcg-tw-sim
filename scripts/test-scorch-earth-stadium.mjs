// v5.644 古玉魚|燒灼大地：只丟「對手的」競技場(自己的不丟),有丟棄才設對手下回合禁出競技場 flag
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.stub-paths.js'); writeFileSync(S,'export const base="";');
const E = join(ROOT,'.ent-se.ts'); const O = join(ROOT,'.ent-se.mjs');
writeFileSync(E, `export { createGame } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20',
  alias:{ '$lib': join(ROOT,'src/lib'), '$app/paths': S }, logLevel:'error' });
const { createGame, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const STAD='14020', VAN='14443';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};
const scorch=ATTACK_POST.get('古玉魚|燒灼大地');
assert(scorch,'找不到 燒灼大地 ATTACK_POST');

function mk(owner){ // owner = activeStadiumOwnerIdx (或 undefined=無競技場)
  const s=createGame({name:'P1',entries:[{cardId:VAN,count:1}]},{name:'P2',entries:[{cardId:VAN,count:1}]},pool);
  const st={ ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0,
    players:[{ ...s.players[0], active:inst(VAN), discard:[] },{ ...s.players[1], active:inst(VAN), discard:[] }] };
  if (owner !== undefined) { st.activeStadium = inst(STAD); st.activeStadiumOwnerIdx = owner; }
  return st;
}
// aIdx=0 攻擊,對手=1
T('競技場是【對手(1)】的 → 丟棄 + 對手下回合禁出競技場', ()=>{
  const out=scorch(mk(1), 0, pool);
  assert(!out.activeStadium, '對手競技場應被丟棄');
  assert.equal(out.players[1].cantPlayStadiumNextTurn, true, '對手應被設下回合禁出競技場');
});
T('競技場是【自己(0)】的 → 不丟、不設旗標', ()=>{
  const out=scorch(mk(0), 0, pool);
  assert(out.activeStadium, '自己的競技場不應被丟');
  assert(!out.players[1].cantPlayStadiumNextTurn, '沒丟棄就不該設禁用旗標');
});
T('場上無競技場 → 不設旗標、不崩', ()=>{
  const out=scorch(mk(undefined), 0, pool);
  assert(!out.players[1].cantPlayStadiumNextTurn, '無競技場不設旗標');
});
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
