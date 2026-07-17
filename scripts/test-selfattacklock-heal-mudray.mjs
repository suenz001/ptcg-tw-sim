// 回歸測試 v5.982：declarative table 單效果 helper vs 多效果卡面 三組 outlier
// A 全鎖(無法使用招式)誤用單鎖 rechargePost → selfCantAttackNextPost
// B 吸血「恢復造成傷害相同HP」誤用固定值 → selfHealByDealtPost(讀 lastDealtDamage)
// C 泥巴魚|劈啪麻痺 漏「正面丟1能量」副作用
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-s-sl.js'), E = join(ROOT, '.x-e-sl.ts'), O = join(ROOT, '.x-o-sl.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { ATTACK_POST, ATTACK_PRE } from './src/lib/game/effects/_shared';\n" +
  "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
function idByName(n){ for (const [id,c] of pool) if (c.name===n) return id; return null; }
function mk(cardId, over={}) {
  return { iid: over.iid ?? ('i'+cardId), cardId: String(cardId), damage:0, energyAttached:[],
    status:null, secondaryStatus:null, tertiaryStatus:null, toolAttached:null, extraTools:[], ...over };
}
function st(p0active, p1active, extra={}) {
  return { phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5,
    isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], lastDealtDamage:0,
    players:[
      { name:'A', active:p0active, bench:[], hand:[], deck:[], discard:[], prizes:[1,1,1,1,1,1] },
      { name:'B', active:p1active, bench:[], hand:[], deck:[], discard:[], prizes:[1,1,1,1,1,1] },
    ], ...extra };
}
let pass=0, fail=0;
const ck=(n,c)=>{ if(c) pass++; else { fail++; console.log('  ✗',n); } };

// ---- Bug A: 全鎖 vs 單鎖 ----
const bilijian=idByName('畢力吉翁'); const oppId=idByName('派拉斯')||idByName('妙蛙種子');
{
  const post=mod.ATTACK_POST.get('畢力吉翁|綠寶石利刃');
  ck('A 畢力吉翁|綠寶石利刃 有註冊', !!post);
  if(post){
    const out=post(st(mk(bilijian,{iid:'atk'}), mk(oppId,{iid:'d'})),0,pool,{});
    const a=out.players[0].active;
    ck('A 全鎖→cantAttackPending=true', a.cantAttackPending===true);
    ck('A 全鎖→未用單鎖 blockedAttackNamesNextTurn', !a.blockedAttackNamesNextTurn || a.blockedAttackNamesNextTurn.length===0);
  }
}
// 單鎖無回歸：密勒頓ex|異度猛衝 仍 blockedAttackNamesNextTurn
{
  const mid=idByName('密勒頓ex');
  const post=mod.ATTACK_POST.get('密勒頓ex|異度猛衝');
  ck('A 單鎖 密勒頓ex|異度猛衝 有註冊', !!post);
  if(post && mid){
    const out=post(st(mk(mid,{iid:'atk'}), mk(oppId,{iid:'d'})),0,pool,{});
    const a=out.players[0].active;
    ck('A 單鎖→blockedAttackNamesNextTurn含異度猛衝', (a.blockedAttackNamesNextTurn||[]).includes('異度猛衝'));
    ck('A 單鎖→不設全鎖 cantAttackPending', !a.cantAttackPending);
  }
}

// ---- Bug B: 吸血=實際造成傷害 ----
{
  const paras=idByName('派拉斯');
  const post=mod.ATTACK_POST.get('派拉斯|吸血');
  ck('B 派拉斯|吸血 有註冊', !!post);
  if(post){
    // 自身已受 30 傷，本招實際造成 20（lastDealtDamage=20）→ 應回 20（damage 30→10），非固定10
    const state=st(mk(paras,{iid:'atk',damage:30}), mk(oppId,{iid:'d'}), {lastDealtDamage:20});
    const out=post(state,0,pool,{});
    ck('B 回血=實際傷害20(damage 30→10)', out.players[0].active.damage===10);
  }
}

// ---- Bug C: 泥巴魚|劈啪麻痺 正面→麻痺+丟能量 ----
{
  const mud=idByName('泥巴魚');
  const post=mod.ATTACK_POST.get('泥巴魚|劈啪麻痺');
  ck('C 泥巴魚|劈啪麻痺 有註冊', !!post);
  if(post){
    // 對手2異質能量 + 強制正面
    const opp=mk(oppId,{iid:'d', energyAttached:[{id:'e1',cardId:'99991'},{id:'e2',cardId:'99992'}]});
    const orig=Math.random; Math.random=()=>0.01; // 正面
    const out=post(st(mk(mud,{iid:'atk'}), opp),0,pool,{});
    Math.random=orig;
    const d=out.players[1].active;
    const para = d.status==='paralyzed'||d.secondaryStatus==='paralyzed'||d.tertiaryStatus==='paralyzed';
    ck('C 正面→對手【麻痺】', para);
    ck('C 正面→開丟能量 picker(pendingSelection)', !!out.pendingSelection);
    // 反面→無麻痺無pending
    const orig2=Math.random; Math.random=()=>0.99;
    const out2=post(st(mk(mud,{iid:'atk'}), mk(oppId,{iid:'d',energyAttached:[{id:'e1',cardId:'99991'}]})),0,pool,{});
    Math.random=orig2;
    const d2=out2.players[1].active;
    ck('C 反面→無麻痺', d2.status!=='paralyzed');
    ck('C 反面→無 pending', !out2.pendingSelection);
  }
}

console.log(`\nv5.982 table-outlier 三組測試：PASS ${pass} / FAIL ${fail}`);
if(fail>0) process.exit(1);
