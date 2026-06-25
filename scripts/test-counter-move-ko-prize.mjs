// 鎖住:傷害指示物移到對手致對手 KO 時(resolver 路徑 RESOLVE_SELECTION),
//   攻擊方正確取獎賞(applyAction 末尾雙邊 sweep 兜底,與 ATTACK 路徑互補)。
//   九尾(18429)九尾狐搬動:選自方備戰傷害全移對手戰鬥位。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-cm.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-cm.ts'); const O = join(ROOT, '.ent-cm.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

const KITSUNE='18429', DEWGONG='16661', BUD='14443', FIRE='18518';
let nn=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});

let pass=0, fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

T('九尾狐搬動:備戰帝牙海獅damage100全移→對手含羞苞(HP30)KO→攻擊方取獎賞', () => {
  const source = inst(DEWGONG); source.damage = 100;  // 備戰來源,移100到對手
  const oppActive = inst(BUD);  // 含羞苞 HP30, 受100→KO
  const st = {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
    players:[
      { name:'P1', active:inst(KITSUNE,[en(FIRE)]), bench:[source], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD),inst(BUD)] },
      { name:'P2', active:oppActive, bench:[inst(BUD)], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD),inst(BUD)] },
    ],
  };
  // 1. ATTACK atk[0] 九尾狐搬動 → 開 bench-choose 選來源
  let out = applyAction(st, { type:'ATTACK', attackIndex:0 }, pool);
  assert(out.pendingSelection, `ATTACK 後應開 picker(實 ${out.pendingSelection?.type})`);
  const prizesBefore = out.players[0].prizes.length;
  // 2. RESOLVE_SELECTION 選帝牙海獅來源 → 移100到對手含羞苞 → KO
  out = applyAction(out, { type:'RESOLVE_SELECTION', selectedIids:[source.iid] }, pool);
  // 對手含羞苞應 KO(active 變 null 待 promote, 或已 promote bench)
  const oppActiveKO = !out.players[1].active || out.players[1].active.cardId !== BUD || out.players[1].active.iid !== oppActive.iid;
  console.log('   對手 active:', out.players[1].active ? `${out.players[1].active.cardId}(iid ${out.players[1].active.iid})` : 'null',
    '| P1 獎賞:', prizesBefore, '→', out.players[0].prizes.length, '| P2 discard 含羞苞數:', out.players[1].discard.filter(c=>c.cardId===BUD).length);
  // 攻擊方取獎賞(prizes 減少)
  assert(out.players[0].prizes.length < prizesBefore, `攻擊方應取獎賞(${prizesBefore}→${out.players[0].prizes.length})`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
