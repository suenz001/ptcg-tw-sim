// 重抽動畫優化：莉莉艾的決意/裁判/不公印章 等「手牌洗回牌庫重抽」時，
//   洗回的手牌卡必須換新 iid → 即使抽回相同卡，新手牌 iid 也與原手牌不同 → UI 抽牌動畫必跑。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-rr.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-rr.ts'); const O = join(ROOT, '.ent-rr.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nexport { returnHandToDeck } from './src/lib/game/effects/_shared';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, returnHandToDeck } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const LILLIE='14019' /*莉莉艾的決意*/, BASIC='14129'/*鬼斯 基礎*/, EN='18520';
let iid=0; const inst=(cid,e={})=>({iid:`a${++iid}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('① returnHandToDeck：洗回的手牌卡換新 iid（原 iid 不再出現在牌庫）',()=>{
  const s=createGame({name:'P1',entries:[{cardId:BASIC,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  const handCards=[inst(EN),inst(EN),inst(BASIC)]; // h iids
  const oldHandIids=new Set(handCards.map(c=>c.iid));
  const deckCards=[inst(EN),inst(BASIC)]; const oldDeckIids=deckCards.map(c=>c.iid);
  const st={...s,players:[{...s.players[0],hand:handCards,deck:deckCards},s.players[1]]};
  const n=returnHandToDeck(st,0);
  assert.equal(n.players[0].hand.length,0,'手牌應清空');
  assert.equal(n.players[0].deck.length,5,'牌庫應 3+2=5 張');
  const newDeckIids=new Set(n.players[0].deck.map(c=>c.iid));
  for(const oi of oldHandIids) assert(!newDeckIids.has(oi),'原手牌 iid '+oi+' 不該出現在牌庫(應已 re-id)');
  for(const di of oldDeckIids) assert(newDeckIids.has(di),'原牌庫 iid '+di+' 應保留(不 re-id)');
  // cardId 內容守恆
  const cnt=n.players[0].deck.filter(c=>c.cardId===EN).length; assert.equal(cnt,3,'能量 cardId 應守恆(2手+1庫=3)');
});

T('② 整合 莉莉艾的決意：小牌庫強制抽回原手牌卡 → 新手牌 iid 全與原手牌不同(動畫必跑)',()=>{
  const s=createGame({name:'P1',entries:[{cardId:LILLIE,count:1}]},{name:'P2',entries:[{cardId:BASIC,count:1}]},pool);
  // 手牌 3 張(含莉莉艾的決意要打的那張) + 牌庫 3 張 → 打掉決意後洗回手牌(剩2)+牌庫3 抽6 → 全抽回
  const lillie=inst(LILLIE); const h2=inst(EN); const h3=inst(BASIC);
  const oldHandIids=new Set([lillie.iid,h2.iid,h3.iid]);
  const deck=[inst(EN),inst(BASIC),inst(EN)];
  const st={...s,phase:'playing',turnPhase:'main',turn:2,activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,
    setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],supporterPlayedThisTurn:false,
    players:[{...s.players[0],hand:[lillie,h2,h3],deck,discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC,{energyAttached:[inst(EN)]})},
             {...s.players[1],hand:[],deck:[inst(BASIC)],discard:[],prizes:Array.from({length:6},()=>inst(BASIC)),bench:[],active:inst(BASIC)}]};
  const n=applyAction(st,{type:'PLAY_TRAINER',iid:lillie.iid},pool);
  const newHand=n.players[0].hand;
  assert(newHand.length>=4,'莉莉艾的決意抽後手牌應≥4(洗回2+庫3=5抽到滿)，實際'+newHand.length);
  for(const c of newHand) assert(!oldHandIids.has(c.iid),'新手牌不該有任何原手牌 iid('+c.iid+') → 否則該卡動畫不跑');
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
