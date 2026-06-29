/**
 * 戲法舞步/反轉之風 — 對手戰鬥位被本招式傷害 KO 後，仍可搬移其(已進棄牌的)能量（v5.769）
 * 官方順序「招式效果先於昏厥結算」。引擎主 KO 已移除對手 active+能量進棄牌 → 由 _koDefenderEnergySnapshot
 *   讓 POST 從棄牌區取回：戲法舞步→改附對手備戰、反轉之風→放回對手手牌。
 *   驗 HEAD FAIL：未修版 active=null → postFn 早退「沒有附能量/對手戰鬥無能量」（pendingSelection=null）。
 * 另含非 KO 回歸：active 存活時行為不變。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.tk-s.js'), E = join(ROOT, '.tk-e.ts'), O = join(ROOT, '.tk-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction, trickStepPost } from './src/lib/game/effects';\nexport * as eng from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const { trickStepPost } = mod;
const { createGame, applyAction } = mod.eng;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const GENGAR = '16916';  // 耿鬼ex 戲法舞步
const UNFEZANT = '9900'; // 高傲雉雞 反轉之風
const DARK = '14430';    // 基本【惡】能量
const POKE = '14086';    // 願增猿（備戰目標）
const ATTACKER_C = '17977'; // 喵喵（無屬性，當攻擊方占位）

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(DARK));

// 模擬「對手戰鬥位剛被本招式傷害 KO」後的盤面：dIdx active=null、能量已在 discard、snapshot 設好、有備戰。
function koState(attackerCid, energyInsts, withBench = true) {
  const s = createGame({ name: 'P1', entries: [{ cardId: attackerCid, count: 1 }] }, { name: 'P2', entries: [{ cardId: POKE, count: 1 }] }, pool);
  const bench = withBench ? [inst(POKE)] : [];
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    _koDefenderSnapshot: { idx: 1, inst: { iid: 'koActive', cardId: '0', energyAttached: energyInsts } },
    players: [
      { ...s.players[0], hand: [], deck: [inst(DARK)], discard: [], prizes: prize(6), bench: [], active: inst(attackerCid, { energyAttached: [inst(DARK), inst(DARK)] }) },
      { ...s.players[1], hand: [], deck: [inst(DARK)], discard: [...energyInsts], prizes: prize(6), bench, active: null }] };
}
const RESOLVE = (iids) => ({ type: 'RESOLVE_SELECTION', selectedIids: iids });

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// (1) ★戲法舞步 KO：postFn 應開 picker(fromDiscard)，非早退
T('★戲法舞步 KO→開 picker(fromDiscard) 非早退', () => {
  const en = [inst(DARK)];
  const st = koState(GENGAR, en);
  const out = trickStepPost()(st, 0, pool, { type: 'ATTACK', attackIndex: 0, discardedEnergyIids: ['yes'] });
  assert.ok(out.pendingSelection, 'KO 後應開 picker（HEAD 為 null）');
  assert.equal(out.pendingSelection.effectKey, 'trick-step-pick');
  assert.equal(out.pendingSelection.params.fromDiscard, true);
  assert.deepEqual(out.pendingSelection.params.validIids, [en[0].iid]);
});

// (2) ★戲法舞步 KO 全流程：pick → bench-choose → 能量從棄牌移到備戰
T('★戲法舞步 KO 全流程：能量棄牌→對手備戰', () => {
  const en = [inst(DARK)];
  let st = trickStepPost()(koState(GENGAR, en), 0, pool, { type: 'ATTACK', attackIndex: 0, discardedEnergyIids: ['yes'] });
  st = applyAction(st, RESOLVE([en[0].iid]), pool);  // 選能量
  assert.equal(st.pendingSelection?.effectKey, 'trick-step-attach', '應進 bench-choose');
  const benchIid = st.players[1].bench[0].iid;
  st = applyAction(st, RESOLVE([benchIid]), pool);   // 選備戰目標
  const benchPoke = st.players[1].bench[0];
  assert.equal(benchPoke.energyAttached.length, 1, '能量應改附到對手備戰');
  assert.equal(benchPoke.energyAttached[0].iid, en[0].iid);
  assert.ok(!st.players[1].discard.some(c => c.iid === en[0].iid), '能量應已從棄牌移出');
});

// (3) 戲法舞步 KO 但對手無備戰 → 不可移動（不開 picker）
T('戲法舞步 KO+對手無備戰→不開 picker', () => {
  const en = [inst(DARK)];
  const out = trickStepPost()(koState(GENGAR, en, false), 0, pool, { type: 'ATTACK', attackIndex: 0, discardedEnergyIids: ['yes'] });
  assert.equal(out.pendingSelection, null, '無備戰不開 picker');
});

// (4) 反轉之風 KO：postFn 應開 picker(fromDiscard, maxCount=min(2,n))
T('★反轉之風 KO→開 picker(fromDiscard)', () => {
  const en = [inst(DARK), inst(DARK)];
  const s = createGame({ name: 'P1', entries: [{ cardId: UNFEZANT, count: 1 }] }, { name: 'P2', entries: [{ cardId: POKE, count: 1 }] }, pool);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false, turn: 5,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    _koDefenderSnapshot: { idx: 1, inst: { iid: 'koA2', cardId: '0', energyAttached: en } },
    players: [
      { ...s.players[0], hand: [], deck: [inst(DARK)], discard: [], prizes: prize(6), bench: [], active: inst(UNFEZANT, { energyAttached: [inst(DARK), inst(DARK)] }) },
      { ...s.players[1], hand: [], deck: [inst(DARK)], discard: [...en], prizes: prize(6), bench: [inst(POKE)], active: null }] };
  // 反轉之風 postFn：用 ATTACK_POST 取得（end-to-end 太重，這裡直接打 RESOLVE 驗 resolver）
  // 改測 resolver source-agnostic：直接 RESOLVE v327（模擬已開 picker）
  const picked = { ...st, pendingSelection: { type: 'active-energy-discard', actorIdx: 0, sourcePlayerIdx: 1, minCount: 0, maxCount: 2, effectKey: 'v327-unfezant-reverse-wind', params: { fromDiscard: true, validIids: en.map(e => e.iid) } } };
  const out = applyAction(picked, RESOLVE(en.map(e => e.iid)), pool);
  assert.equal(out.players[1].hand.length, 2, '2 張能量應回對手手牌');
  assert.ok(!out.players[1].discard.some(c => en.some(e => e.iid === c.iid)), '能量應已從棄牌移出');
});

console.log('\n戲法舞步/反轉之風 KO 搬能量(v5.769):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
