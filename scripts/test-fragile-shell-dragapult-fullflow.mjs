// v5.910 守衛(完整流程):脫殼忍者|脆弱蛻殼(卡面「受到對手寶可夢【ex】招式的『傷害』而昏厥,對手無法獲得
//   獎賞卡」)——只擋「招式傷害」KO,不擋「效果」KO。多龍巴魯托ex|幻影奇襲=對備戰放6指示物(attack-effect)。
//   ① 脫殼忍者在【備戰】被 6 指示物 KO(效果) → 對手正常拿 1 張獎賞(脆弱蛻殼不擋)。
//   ② 脫殼忍者在【戰鬥位】被 幻影奇襲 200 傷害(ex招式傷害)KO → 對手 0 張獎賞(脆弱蛻殼擋)。
//   走完整 applyAction ATTACK→RESOLVE_SELECTION 流程(非只 koPrizesAdjusted 單元)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.fsd-s.js'), E = join(ROOT, '.fsd-e.ts'), O = join(ROOT, '.fsd-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const DRAGA='14794'/*多龍巴魯托ex 幻影奇襲(idx1) 200+6指示物*/, SHED='14063'/*脫殼忍者 HP60 脆弱蛻殼*/, HIGHHP='14794'/*HP320*/, GRASS='14319', PSY='11177', FIRE='18518';
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
function mk(oppActiveCid, benchCids){
  const s=createGame({name:'A',entries:[{cardId:DRAGA,count:1}]},{name:'B',entries:[{cardId:SHED,count:1}]},pool);
  return {...s,phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,isFirstTurn:false,setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],activeStadium:null,
    players:[{...s.players[0],hand:[],deck:[],discard:[],prizes:Array.from({length:6},()=>inst(DRAGA)),bench:[],active:inst(DRAGA,{energyAttached:[inst(FIRE),inst(PSY),inst(PSY)]})},
             {...s.players[1],hand:[],deck:[inst(SHED)],discard:[],prizes:Array.from({length:6},()=>inst(SHED)),bench:benchCids.map(c=>inst(c)),active:inst(oppActiveCid)}]};
}
T('① 脫殼忍者在備戰被幻影奇襲6指示物KO(效果) → 對手拿 1 張獎賞', () => {
  let r=applyAction(mk(HIGHHP,[SHED]),{type:'ATTACK',attackIndex:1},pool); // active HP320 存活,只備戰脫殼忍者
  assert.equal(r.pendingSelection?.effectKey,'dragapult-snipe','應開幻影奇襲指示物分配');
  const shedIid=r.players[1].bench[0].iid;
  r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:r.pendingSelection.effectKey,selectedIids:Array.from({length:6},()=>shedIid),actorIdx:0},pool);
  assert(!r.players[1].bench.find(c=>c.cardId===SHED),'脫殼忍者應被KO');
  assert.equal(r.players[0].prizes.length,5,'效果KO脆弱蛻殼不擋→對手應拿1張(6→5);實際剩'+r.players[0].prizes.length);
});
T('② 脫殼忍者在戰鬥位被幻影奇襲200傷害(ex招式傷害)KO → 對手 0 張獎賞', () => {
  let r=applyAction(mk(SHED,[GRASS]),{type:'ATTACK',attackIndex:1},pool); // active=脫殼忍者(HP60)被200打死
  // 幻影奇襲同時放6指示物到備戰(走路草),需 RESOLVE
  if(r.pendingSelection){ const b=r.players[1].bench[0]?.iid; r=applyAction(r,{type:'RESOLVE_SELECTION',effectKey:r.pendingSelection.effectKey,selectedIids:b?[b]:[],actorIdx:0},pool); }
  assert(!r.players[1].active || r.players[1].active.cardId!==SHED,'脫殼忍者(active)應被200傷害KO');
  // active 脫殼忍者被 ex 招式傷害 KO → 脆弱蛻殼擋 → 該 KO 不給獎賞(備戰走路草若也死另計,故只驗脫殼忍者這份)
  // 用 log 驗:不應有「脫殼忍者 被擊倒 A 取得 X 張」的獎賞(脆弱蛻殼=0)
  const shedKoLog=(r.log||[]).map(l=>typeof l==='string'?l:(l?.message??'')).find(t=>t.includes('脫殼忍者')&&t.includes('擊倒'));
  assert(!shedKoLog || !/取得\s*[1-9]/.test(shedKoLog),'脫殼忍者被ex傷害KO不應給獎賞(脆弱蛻殼);log='+shedKoLog);
});
console.log(`\n=== 脆弱蛻殼x幻影奇襲完整流程(v5.910): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
