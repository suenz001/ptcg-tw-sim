/**
 * v5.765 §17.39.D:field-wide 減傷特性(齒輪塗層/守護之鐘)只計「處於有效狀態」的持有者。
 * 對手振翼髮(暗夜羽擊)消除對手戰鬥位特性 → 唯一持有者(active 齒輪怪)失效 → 不減傷。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.gc-s.js'), E = join(ROOT, '.gc-e.ts'), O = join(ROOT, '.gc-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { gearCoatingReduce } from './src/lib/game/effects/cards/v2999_g3_wave1';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { gearCoatingReduce } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
let GEAR=null, METAL=null;
for (const [id,c] of pool) {
  if (!GEAR && c.abilities?.some(a=>a.name==='齒輪塗層')) GEAR=id;
  if (!METAL && c.supertype==='Energy' && c.subtype==='Basic' && (c.pokemonType==='Metal' || /【鋼】/.test(c.name||''))) METAL=id;
}
const BRAMBLE='16826', OTHER='18519';
let nn=0; const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const mkState=(p0)=>({ players:[ { active: inst(p0), bench: [] }, { active: inst(GEAR, { energyAttached:[inst(METAL)] }), bench: [] } ] });
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
T('無回歸:對手非振翼髮 → 齒輪塗層有效 → -20', ()=>{
  const st=mkState(OTHER); const r=gearCoatingReduce(st,1,st.players[1].active,pool);
  assert.equal(r,20,'應 -20,實得 '+r);
});
T('★gate:對手振翼髮暗夜羽擊 → 唯一持有者(active齒輪怪)被消除 → 0', ()=>{
  const st=mkState(BRAMBLE); const r=gearCoatingReduce(st,1,st.players[1].active,pool);
  assert.equal(r,0,'暗夜羽擊下應 0(HEAD 會是 20),實得 '+r);
});
console.log('\n齒輪塗層 holder-effective gate:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
