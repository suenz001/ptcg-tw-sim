/**
 * 流氓熊貓|無理取鬧「選擇1個對手戰鬥寶可夢持有的招式→下回合無法使用」=玩家選(v5.793)
 * 原自動挑最高傷害,違卡面「選擇」+ 與火箭隊黑暗鴉不一致。改用中央 lockOppChosenAttackPost。
 * 驗:對手多招→開 modal(玩家選);HEAD→自動鎖(無 modal,直接設 blockedAttackNamesNextTurn)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ul-s.js'), E = join(ROOT, '.ul-e.ts'), O = join(ROOT, '.ul-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const PANCHAM='16950', TWO='14321'/*霸王花 2招*/, ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const mk=(defCid)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(PANCHAM),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
           {name:'P2',active:inst(defCid),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}]});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★對手多招→開 modal 讓玩家選(非自動鎖)', () => {
  const out=ATTACK_POST.get('流氓熊貓|無理取鬧')(mk(TWO),0,pool,{});
  assert.ok(out.pendingSelection, '多招應開 modal 讓玩家選(HEAD 自動鎖,無 pending)');
  assert.equal(out.pendingSelection.effectKey, 'unreasonable-lock-attack', '應走中央 lock resolver');
  // 尚未鎖(等玩家選)
  assert.ok(!(out.players[1].active.blockedAttackNamesNextTurn?.length), '選之前不該已鎖招');
});
console.log('\n無理取鬧玩家選招(v5.793):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
