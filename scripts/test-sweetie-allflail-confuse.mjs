/**
 * 胖甜妮|甜甜你 — 擲2次硬幣傷害；若「全部為反面」(0 正面)則對手【混亂】(v5.786)
 * HEAD:regPost 只 return state(混亂完全沒實作)。修:coinHeadsMultiplyPre 存 _lastCoinHeads,
 *   POST 讀 heads===0 才混亂。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.sw-s.js'), E = join(ROOT, '.sw-e.ts'), O = join(ROOT, '.sw-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE, ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const SWEETIE='10466', BIG='14335', ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const mk=()=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(SWEETIE),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
           {name:'P2',active:inst(BIG),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}]});
const run=()=>{ // 跑 PRE→POST 串接(_lastCoinHeads 透傳)
  let st=mk();
  const pre=ATTACK_PRE.get('胖甜妮|甜甜你')(st,0,pool,{});
  st=pre.state;
  const post=ATTACK_POST.get('胖甜妮|甜甜你')(st,0,pool,{});
  return {pre,post};
};
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const orig=Math.random;

T('★全反面(0正面)→對手混亂', () => {
  Math.random=()=>0.9; // ≥0.5 = 反面
  try { const {pre,post}=run();
    assert.equal(pre.state._lastCoinHeads,0,'應 0 正面');
    assert.equal(pre.damage,0,'0 正面→0 傷害');
    assert.equal(post.players[1].active.status,'confused','全反面應混亂(HEAD 無此實作)');
  } finally { Math.random=orig; }
});
T('★有正面(2正面)→不混亂', () => {
  Math.random=()=>0.1; // <0.5 = 正面
  try { const {pre,post}=run();
    assert.equal(pre.state._lastCoinHeads,2,'應 2 正面');
    assert.equal(pre.damage,180,'2 正面→180');
    assert.notEqual(post.players[1].active.status,'confused','有正面不應混亂');
  } finally { Math.random=orig; }
});

console.log('\n甜甜你全反面才混亂(v5.786):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
