/**
 * 「依【水】能量數量×N」傷害必須 host-aware 計數(古舊能量視為提供所有屬性各1) v5.795
 * 櫻花魚|漸強波(水×30)原 regPost 用 countOneEnergy('Water')(energyMatchesType 靜態)→ 漏古舊能量。
 * 應走中央 countEnergyTypeHostAware(同 selfEnergyCountPre / 哥達鴨水炮 v2640 生效版)。
 * HEAD:countOneEnergy 把古舊算 0 → 漸強波 0 傷(少算)。
 * 哥達鴨|水炮已由 v2640 selfEnergyCountPre 生效(host-aware),此處附帶驗證其正確(古舊算1→80)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.te-s.js'), E = join(ROOT, '.te-e.ts'), O = join(ROOT, '.te-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE, ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_PRE, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GODUCK='14693'/*哥達鴨 Stage1 水*/, SAKURA='12775'/*櫻花魚 Stage1 水*/, ANCIENT='17212'/*古舊能量*/;
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const mk=(atkActive)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:atkActive,bench:[],hand:[],deck:[],discard:[],prizes:[]},
           {name:'P2',active:inst(GODUCK,{damage:0}),bench:[],hand:[],deck:[],discard:[],prizes:[]}]});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★櫻花魚|漸強波:附1古舊能量+空手牌 → 對手受 1×30=30(HEAD漏古舊→0傷)', () => {
  const a=inst(SAKURA,{energyAttached:[inst(ANCIENT)]});
  const st=mk(a);
  const out=ATTACK_POST.get('櫻花魚|漸強波')(st,0,pool);
  const def=out.players[1].active;
  assert.equal(def.damage, 30, `古舊應算1個水→30傷,實得 ${def.damage}`);
});

T('哥達鴨|水炮:附1古舊能量 → 60+1×20=80(v2640 host-aware 生效版)', () => {
  const a=inst(GODUCK,{energyAttached:[inst(ANCIENT)]});
  const out=ATTACK_PRE.get('哥達鴨|水炮')(mk(a),0,pool);
  assert.equal(out.damage, 80, `古舊應算1個水→80,實得 ${out.damage}`);
});

console.log('\ntyped能量計數host-aware(v5.795):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
