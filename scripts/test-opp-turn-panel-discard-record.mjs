/** v5.892 對手回合面板(turnActionsLog)的棄牌記錄由中央 recordDiscardDiff 自動偵測。
 *  修:dedup 改用 iid(當前 action 剛打出的那張),取代原「cardId 跨整回合去重」——
 *  原本會誤抑制「本回合打過某 cardId 後、之後真的又棄掉另一張同 cardId 卡」的棄牌顯示。
 *  HEAD-FAIL:HEAD 用 cardId 去重 → 稜鏡塔棄的水能量(本回合已附過另一張水能量)被誤吞。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.op-s.js'), E = join(ROOT, '.op-e.ts'), O = join(ROOT, '.op-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const PRISM='18500', POKE='14319', W='18519', GUY='17173'; // 蓋伊(Supporter,抽3,打出自棄)
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const discIds = (s,i)=>(s.players[i].currentTurnActions??[]).filter(a=>a.type==='discard').map(a=>a.cardId);
const recTypes = (s,i)=>(s.players[i].currentTurnActions??[]).map(a=>a.type+':'+a.cardId);

T('★本回合附過水能量後,稜鏡塔棄「另一張水能量」仍記錄 discard(HEAD-FAIL:被cardId去重誤吞)', () => {
  const attachW = inst(W), hW2 = inst(W), hPoke = inst(POKE);
  let s = {
    id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0], stadiumUsedThisTurn:[false,false], activeStadium:inst(PRISM),
    players:[
      { name:'ME', active:inst(POKE), bench:[], hand:[attachW, hW2, hPoke], deck:[inst(POKE),inst(POKE)], discard:[], prizes:[inst(POKE)], currentTurnActions:[], turnActionsLog:[] },
      { name:'OP', active:inst(POKE), bench:[], hand:[], deck:[inst(POKE)], discard:[], prizes:[inst(POKE)], currentTurnActions:[], turnActionsLog:[] },
    ],
  };
  s = mod.applyAction(s, { type:'ATTACH_ENERGY', energyIid:attachW.iid, targetIid:s.players[0].active.iid }, pool);
  s = mod.applyAction(s, { type:'USE_STADIUM' }, pool);
  s = mod.applyAction(s, { type:'RESOLVE_SELECTION', selectedIids:[hW2.iid, hPoke.iid] }, pool);
  const ids = discIds(s, 0);
  assert.ok(ids.includes(W), '棄的水能量有記錄(面板顯示)');
  assert.ok(ids.includes(POKE), '棄的普通卡有記錄');
  assert.equal(ids.length, 2, '剛好 2 筆 discard');
});

T('regression:打出即自棄的 Supporter(蓋伊) 只記 play_hand、不重複記 discard', () => {
  const guy = inst(GUY);
  let s = {
    id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    supporterUsedThisTurn:[false,false],
    players:[
      { name:'ME', active:inst(POKE), bench:[], hand:[guy], deck:[inst(POKE),inst(POKE),inst(POKE),inst(POKE)], discard:[], prizes:[inst(POKE)], currentTurnActions:[], turnActionsLog:[] },
      { name:'OP', active:inst(POKE), bench:[], hand:[], deck:[inst(POKE)], discard:[], prizes:[inst(POKE)], currentTurnActions:[], turnActionsLog:[] },
    ],
  };
  s = mod.applyAction(s, { type:'PLAY_TRAINER', iid:guy.iid }, pool);
  const recs = recTypes(s, 0);
  const guyPlay = recs.filter(r => r === 'play_hand:'+GUY).length;
  const guyDisc = recs.filter(r => r === 'discard:'+GUY).length;
  assert.equal(guyPlay, 1, '蓋伊記 1 筆 play_hand');
  assert.equal(guyDisc, 0, '蓋伊自棄不重複記 discard(dedup by iid 仍生效)');
});

console.log('\n對手回合面板棄牌記錄(v5.892):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
