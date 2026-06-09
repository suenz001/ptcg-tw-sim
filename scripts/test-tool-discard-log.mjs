// 道具因效果觸發被丟棄要在對戰 log 顯示(中央 addToolDiscardLog)。
//   倖存鍛鍊器:滿血被招式KO→留HP10→道具丟棄→log顯示。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-td.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-td.ts'); const O = join(ROOT, '.ent-td.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const ATK='14352'/*巴布土撥 怒氣拳130*/, DEF='14323'/*蓮葉童子 hp70*/, BADGE='10306'/*倖存鍛鍊器*/, EN='18520';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
const logStr=n=>(n.log||[]).map(l=>typeof l==='string'?l:(l.message||'')).join('\n');
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('①★ 倖存鍛鍊器:滿血被招式KO→留HP10+道具進棄牌+log顯示丟棄道具名',()=>{
  const s=createGame({name:'P1',entries:[{cardId:ATK,count:1}]},{name:'P2',entries:[{cardId:DEF,count:1}]},pool);
  const badge=inst(BADGE);
  const def=inst(DEF,{damage:0,toolAttached:badge}); // 滿血 + 附倖存鍛鍊器
  const st={...s,phase:'playing',turnPhase:'main',turn:2,activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],
    players:[{...s.players[0],hand:[],deck:[inst(ATK)],discard:[],prizes:Array.from({length:6},()=>inst(ATK)),bench:[],active:inst(ATK,{energyAttached:[inst(EN),inst(EN)]})},
             {...s.players[1],hand:[],deck:[inst(DEF)],discard:[],prizes:Array.from({length:6},()=>inst(DEF)),bench:[inst(DEF)],active:def}]};
  const n=applyAction(st,{type:'ATTACK',attackIndex:0},pool);
  const lg=logStr(n);
  assert(n.players[1].active,'防守方應未昏厥(留場上)');
  assert.equal(n.players[1].active.damage,60,'應留 HP10(70hp→damage60)，實際 '+n.players[1].active.damage);
  assert(n.players[1].active.toolAttached==null || n.players[1].active.toolAttached?.cardId!==BADGE,'倖存鍛鍊器應已從寶可夢移除');
  assert(n.players[1].discard.some(c=>c.cardId===BADGE),'倖存鍛鍊器應進棄牌區');
  assert(/倖存鍛鍊器/.test(lg) && /丟棄/.test(lg),'log 應顯示倖存鍛鍊器被丟棄，log尾='+lg.split('\n').slice(-3).join(' | '));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
