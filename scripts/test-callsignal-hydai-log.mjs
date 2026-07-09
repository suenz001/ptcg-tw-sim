// v5.911 ①奇魯莉安|呼喚信號(卡面「給對手看過」)→ 加手牌時公開揭示卡名(log message 含卡名,非私訊)。
//   ②海岱(卡面無「給對手看過」,放回牌庫底=私密手牌資訊)→ 放牌庫底 2 張改私訊(對手看不到卡名)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ch-s.js'), E = join(ROOT, '.ch-e.ts'), O = join(ROOT, '.ch-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { TRAINER_EFFECTS, RESOLVERS } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const KIRLIA='14061'/*奇魯莉安 呼喚信號*/, HYDAI=[...pool].find(([id,c])=>c.name==='海岱')?.[0], RALTS='14060', W='18519', ODDISH='14319';
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
const lastLog=st=>st.log[st.log.length-1];
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('①呼喚信號:選寶可夢加手牌 → log 公開揭示卡名(含「走路草」,非私訊)', () => {
  const s=mod.RESOLVERS.get('wave5-add-pokemon-to-hand');
  const oddish=inst(ODDISH), ralts=inst(RALTS);
  const st={ id:'t', turn:3, log:[], players:[{name:'ME',active:inst(KIRLIA),bench:[],hand:[],deck:[oddish,ralts],discard:[],prizes:[]},{name:'OP',active:inst(ODDISH),bench:[],hand:[],deck:[],discard:[],prizes:[]}] };
  const out=s(st,0,[oddish.iid],{},pool);
  const l=lastLog(out);
  assert(l.message.includes('走路草'),'log message 應公開含卡名「走路草」;實際 '+l.message);
  assert(l.message.includes('給對手看過'),'應標示給對手看過');
  assert(!l.privateMessage || l.privateMessage.includes('走路草'),'不應把卡名藏在私訊');
});
T('②海岱:放牌庫底 2 張 → 私訊(對手看到的 public message 不含卡名)', () => {
  assert.ok(HYDAI,'找到海岱');
  const fn=mod.TRAINER_EFFECTS.get('海岱');
  const c1=inst(ODDISH), c2=inst(RALTS), extra=[inst(W),inst(W),inst(W),inst(W)];
  const st={ id:'t', turn:3, log:[], players:[{name:'ME',active:inst(ODDISH),bench:[],hand:[c1,c2,inst(W)],deck:extra,discard:[],prizes:[]},{name:'OP',active:inst(ODDISH),bench:[],hand:[],deck:[],discard:[],prizes:[]}] };
  let out=fn(st,0,pool);
  // 走 pending → resolve hydai-bottom-draw4
  const r=mod.RESOLVERS.get('hydai-bottom-draw4');
  out=r(out,0,[c1.iid,c2.iid],{},pool);
  const koLog=out.log.find(l=>((l.message||'').includes('放到牌庫底')||(l.privateMessage||'').includes('放到牌庫底')));
  assert(koLog,'應有海岱「放到牌庫底」log');
  assert(koLog.privateMessage && koLog.privateMessage.includes('走路草'),'私訊(自己)應含卡名;實際 priv='+koLog.privateMessage);
  assert(!koLog.message.includes('走路草') && !koLog.message.includes('拉魯拉絲'),'公開訊息(對手看)不應含卡名;實際 pub='+koLog.message);
});
console.log(`\n=== 呼喚信號公開/海岱私訊(v5.911): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
