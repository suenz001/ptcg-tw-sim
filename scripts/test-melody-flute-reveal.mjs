// v5.719 回歸:配樂之笛卡面「將對手牌庫頂5張翻到正面,選任意數量基礎寶可夢放對手備戰」。
//   玩家報:(1)未顯示沒翻到的卡(2)誤以為只能選1。修:revealTopCardsLog 公開揭示全部5張卡名
//   (含非基礎/沒被選的);maxCount=placeableN(多基礎可多選,本就正確)。同類貓老大ex/鐵荊棘共用 helper。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-mf.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-mf.ts'); const O = join(ROOT, '.ent-mf.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { TRAINER_EFFECTS } from './src/lib/game/effects';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { TRAINER_EFFECTS } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool = new Map();
for (const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const B1='14319',B2='14323',B3='14326', E1='14320',E2='14321';
let nn=0; const inst=(cid)=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});
let pass=0,fail=0; const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

const mkState = () => ({
  phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
  players:[
    { name:'P1', active:inst(B1), bench:[], hand:[], deck:[inst(B1)], discard:[], prizes:[] },
    { name:'P2', active:inst(B1), bench:[], hand:[], deck:[inst(B1),inst(B2),inst(B3),inst(E1),inst(E2),inst(B1)], discard:[], prizes:[] },
  ],
});

T('配樂之笛:公開揭示全部5張卡名(含非基礎,玩家看得到沒翻到的) [驗HEAD無揭示FAIL]', () => {
  const out = TRAINER_EFFECTS.get('配樂之笛')(mkState(), 0, pool);
  const logs = out.log.map(l => l.message).join('\n');
  assert(/翻到正面的 5 張/.test(logs), '應有「翻到正面的 5 張」揭示');
  // 全部5張卡名(含非基礎進化卡)都要出現
  for (const cid of [B1,B2,B3,E1,E2]) {
    const nm = pool.get(cid)?.name;
    assert(logs.includes(nm), `揭示應含 ${nm}(${cid})`);
  }
});
T('配樂之笛:maxCount=任意數量(對手備戰空+top5有3基礎→3,非限1)', () => {
  const out = TRAINER_EFFECTS.get('配樂之笛')(mkState(), 0, pool);
  assert.equal(out.pendingSelection.maxCount, 3, `maxCount 應 3,實 ${out.pendingSelection.maxCount}`);
  assert.equal(out.pendingSelection.minCount, 0, 'minCount 應 0(任意數量,可選0)');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
