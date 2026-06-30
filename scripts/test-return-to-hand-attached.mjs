/**
 * 「將寶可夢與附加的卡全部放回手牌」=附加卡(能量/道具/進化棧)一併回手牌,非丟棄(v5.792)
 * 莉莉艾花療憑空消失/隨風球氣球迴旋 原誤用「丟棄版」helper→能量道具進棄牌。
 * 心蝙蝠幸福迴旋(bench)原手刻只取 toolAttached→漏 extraTools/進化棧。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rh-s.js'), E = join(ROOT, '.rh-e.ts'), O = join(ROOT, '.rh-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const LILLIE='16811', BALLOON='12569', SWOOBAT='13391', BIG='14335', POKE='14086', TOOL_A='14089', TOOL_B='14467', ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
function mkActive(cid) {
  const eC={iid:'eC',cardId:ENERGY,damage:0,energyAttached:[]};
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
    players:[{name:'P1',active:inst(cid,{toolAttached:{iid:'tA',cardId:TOOL_A},energyAttached:[eC]}),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
             {name:'P2',active:inst(BIG),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}]};
}
function mkBench(cid) {
  const eC={iid:'eC',cardId:ENERGY,damage:0,energyAttached:[]};
  const target=inst(POKE,{toolAttached:{iid:'tA',cardId:TOOL_A},extraTools:[{iid:'tB',cardId:TOOL_B}],energyAttached:[eC]});
  return {phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[{name:'P1',active:inst(cid),bench:[target],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]},
             {name:'P2',active:inst(BIG),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:[]}], _benchIid:target.iid};
}
const RESOLVE=(iids)=>({type:'RESOLVE_SELECTION',selectedIids:iids});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

for (const [key,cid] of [['莉莉艾的花療環環|憑空消失',LILLIE],['隨風球|氣球迴旋',BALLOON]]) {
  T(`★${key}:能量+道具回手牌(非丟棄)`, () => {
    const out=ATTACK_POST.get(key)(mkActive(cid),0,pool,{});
    const handIids=new Set(out.players[0].hand.map(c=>c.iid));
    const discIids=new Set(out.players[0].discard.map(c=>c.iid));
    assert.ok(handIids.has('eC'), '能量應回手牌(HEAD→棄牌)');
    assert.ok(handIids.has('tA'), '道具應回手牌(HEAD→棄牌)');
    assert.ok(!discIids.has('eC') && !discIids.has('tA'), '不應在棄牌');
  });
}
T('★心蝙蝠|幸福迴旋:備戰回手含 extraTools', () => {
  const st=mkBench(SWOOBAT);
  const opened=ATTACK_POST.get('心蝙蝠|幸福迴旋')(st,0,pool,{});
  assert.ok(opened.pendingSelection,'應開 bench-choose');
  const out=applyAction(opened, RESOLVE([st._benchIid]), pool);
  const handIids=new Set(out.players[0].hand.map(c=>c.iid));
  assert.ok(handIids.has('tA'), '主道具回手');
  assert.ok(handIids.has('tB'), 'extraTools 應回手(HEAD 漏)');
  assert.ok(handIids.has('eC'), '能量回手');
});
console.log('\n寶可夢連附加卡回手牌(v5.792):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
