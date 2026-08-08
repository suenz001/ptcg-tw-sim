/** v5.861 ACE SPEC「重新啟動箱」— 從棄牌區附給自己所有「未來」寶可夢各1張基本能量。
 *  Wilson 回報 bug：原自動 picked[i]→future[i] 固定分配(「自動亂填」)，應由玩家選哪張能量給哪隻。
 *
 *  修後：玩家選能量後，逐張開 heal-target picker(validIids=未來寶可夢)讓玩家分配，每隻上限1張。
 *  HEAD-FAIL：修前選完能量即自動附完、無 picker(pendingSelection=null)；
 *            修後選完能量應開 restart-box-chain-attach picker(玩家分配)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.rb-s.js'), E = join(ROOT, '.rb-e.ts'), O = join(ROOT, '.rb-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { TRAINER_EFFECTS } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, TRAINER_EFFECTS } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const FUTURE_A='16751' /*鐵臂膀*/, FUTURE_B='16752' /*鐵荊棘*/, GRASS='14102' /*基本草能量*/;
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...e});
const prize=n=>Array.from({length:n},()=>inst(GRASS));
function mk() {
  const fa=inst(FUTURE_A), fb=inst(FUTURE_B), e1=inst(GRASS,{iid:'e1'}), e2=inst(GRASS,{iid:'e2'});
  return { st:{ phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {name:'P1',active:fa,bench:[fb],hand:[],deck:[],discard:[e1,e2],prizes:prize(6)},
      {name:'P2',active:inst(FUTURE_A),bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:prize(6)},
    ]}, fa, fb };
}
const RESOLVE=(iids)=>({type:'RESOLVE_SELECTION',selectedIids:iids});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★選能量後開「玩家分配」picker(非自動亂填)', () => {
  const { st }=mk();
  const opened=TRAINER_EFFECTS.get('重新啟動箱')(st,0,pool);
  assert.equal(opened.pendingSelection?.type,'discard-search','先開 discard-search 選能量');
  // 選 2 張基本能量
  const afterEnergy=applyAction(opened, RESOLVE(['e1','e2']), pool);
  assert.ok(afterEnergy.pendingSelection, '選完能量應開「分配」picker(非自動附完)');
  assert.equal(afterEnergy.pendingSelection.type,'heal-target','應為 heal-target 分配 picker');
  assert.equal(afterEnergy.pendingSelection.effectKey,'restart-box-chain-attach','玩家逐張分配');
  // v6.129：改讀 params.validIids —— 型別沒有頂層 validIids 欄位，三端也只讀 params。
  assert.equal(afterEnergy.pendingSelection.params.validIids.length, 2, '候選=2隻未來寶可夢');
});

T('★玩家逐張分配:各隻未來寶可夢各得1張(各1張上限)', () => {
  const { st, fa, fb }=mk();
  let s=TRAINER_EFFECTS.get('重新啟動箱')(st,0,pool);
  s=applyAction(s, RESOLVE(['e1','e2']), pool); // 選 2 能量 → 開第1張 picker
  // 第1張 → 附給 fa
  s=applyAction(s, RESOLVE([fa.iid]), pool);
  // fa 已滿額,候選剩 fb → 只剩1隻自動附 or 再開 picker;最終 fb 也應各1張
  const active=s.players[0].active, bench=s.players[0].bench[0];
  assert.equal(active.energyAttached.length, 1, `fa(戰鬥位)應得1張,實際${active.energyAttached.length}`);
  assert.equal(bench.energyAttached.length, 1, `fb(備戰)應得1張,實際${bench.energyAttached.length}`);
  assert.equal(s.pendingSelection, null, '分配完畢無殘留 pending');
});

console.log('\n重新啟動箱 玩家分配(v5.861):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
