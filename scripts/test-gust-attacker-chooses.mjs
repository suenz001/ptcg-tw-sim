/**
 * gust「選擇1隻對手的備戰寶可夢與戰鬥位互換」= 攻擊方選(v5.788)
 * 派帕陸地水母拉扯/火爆猴拖出/幾何雪花拖出/飄飄球拉扯 原誤用 force-opp-swap(對手選)。
 * 驗:regPost 開的 picker actorIdx=攻擊方(0)、sourcePlayerIdx=對手(1)、effectKey='opp-swap-dmg'。
 * HEAD:actorIdx=對手(1)、effectKey='wave4-force-opp-swap-dmg'/'force-opp-swap'。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.gu-s.js'), E = join(ROOT, '.gu-e.ts'), O = join(ROOT, '.gu-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const BIG='14335', ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
function mk(attackerCid){ return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(attackerCid),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
           {name:'P2',active:inst(BIG),bench:[inst(BIG),inst(BIG)],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}]}; }
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const orig=Math.random;

function checkGust(key, attackerCid, coin) {
  let st=mk(attackerCid);
  if (coin) Math.random=()=>0.1; // 正面
  try {
    const out=ATTACK_POST.get(key)(st,0,pool,{});
    assert.ok(out.pendingSelection, 'gust 應開 picker(對手有備戰)');
    assert.equal(out.pendingSelection.actorIdx, 0, '應由攻擊方(0)選(HEAD=對手1)');
    assert.equal(out.pendingSelection.sourcePlayerIdx, 1, '從對手(1)備戰選');
    assert.equal(out.pendingSelection.effectKey, 'opp-swap-dmg', "effectKey 應 opp-swap-dmg(HEAD=force-opp-swap/wave4)");
  } finally { if (coin) Math.random=orig; }
}

T('★派帕的陸地水母|拉扯 → 攻擊方選', () => checkGust('派帕的陸地水母|拉扯','16891',false));
T('★火爆猴|拖出 → 攻擊方選', () => checkGust('火爆猴|拖出','12796',false));
T('★幾何雪花|拖出 → 攻擊方選', () => checkGust('幾何雪花|拖出','13720',false));
T('★飄飄球|拉扯(正面) → 攻擊方選', () => checkGust('飄飄球|拉扯','12568',true));
T('對照:皮皮|看我嘛 一向攻擊方選(不變)', () => checkGust('皮皮|看我嘛','18064',false));

console.log('\ngust 攻擊方選對手備戰(v5.788):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
