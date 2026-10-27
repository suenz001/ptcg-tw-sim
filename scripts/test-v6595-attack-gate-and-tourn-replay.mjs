#!/usr/bin/env node
/**
 * v6.595 守衛：出招前的擲硬幣判定照官方順序（混亂／招式失敗）＋兩步出招；錦標賽對戰結束下載復盤檔
 *
 *   站長 2026-10-23（玩家回報超級甲賀忍蛙ex 混亂時「忍者飛旋」先選放回能量才判斷混亂）：核對官方《進階玩家規則教學手冊》
 *   「使出招式的順序」後裁定照官方修正 A＋B＋C（v6.595）：
 *     A 先擲「招式失敗」類硬幣（潑沙／墨汁噴射）、正面才擲【混亂】（Q&A L604 潑油、L1121 潑膠）
 *     B 不能宣告的招式（本回合無法使用招式、招式被鎖、冷卻、使用條件、能量不足…）不擲任何硬幣
 *     C 招式的「若希望…／借哪一招」選擇在擲幣正面之後才問；選擇視窗不能取消（宣告了就要出招）
 *   D 玩家建議（站長 2026-10-23）：錦標賽對戰結束時立即下載自己那一場的復盤檔（跟一般對戰的下載方式一樣）。
 *
 *   U：$lib/game/attack-gate.ts 純函式（判準唯一一份）
 *   E：真引擎（esbuild 打包 engine＋effects，真卡資料）：A／B／兩步出招／AI 一次送出不變
 *   T：錦標賽逾時收尾：停在「已通過擲幣」時用預設選擇把招式打完（不是結束回合）
 *   R：錦標賽回放 → 復盤檔（格式驗證、gzip 來回、壞資料回 null）
 *   S：接線（引擎宣告檢查都在擲幣之前、2a 在混亂之前；對戰頁呼叫中央判準、取消鈕鎖住、下載鈕兩個結算視窗都有）
 *   H：HEAD-FAIL（BASE v6.594：沒有模組；引擎 A／B／C 逐條紅）
 *
 * Run: node scripts/test-v6595-attack-gate-and-tourn-replay.mjs
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須留在 main 上（IRON_RULES Rule 45）：v6.594
const BASE_SHA = '63787814';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));

// ── 卡池 ──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const GREN = '18442';   // 超級甲賀忍蛙ex（忍者飛旋：若希望，將 1 個【水】能量放回手牌，+80）
const WATER = [...pool.values()].find((c) => c.supertype === 'Energy' && c.name === '基本【水】能量')?.id;
const DEF = '14705';
ok('★ 前置：卡片在卡池裡（超級甲賀忍蛙ex、基本【水】能量、對手）', pool.get(GREN)?.attacks?.[0]?.name === '忍者飛旋' && !!WATER && !!pool.get(DEF));

// ── 打包（srcRoot 可以是 BASE 解開的目錄） ──
async function loadMods(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6595-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const assets="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  const has = (x) => existsSync(join(srcRoot, x));
  writeFileSync(E, [
    `export { createGame, applyAction } from '${p('src/lib/game/engine')}';`,
    `import '${p('src/lib/game/effects')}';`,
    `export { timeoutAction } from '${p('src/lib/game/timeout-action')}';`,
    has('src/lib/game/attack-gate.ts') ? `export * as GATE from '${p('src/lib/game/attack-gate')}';` : 'export const GATE = null;',
    `export * as TOURN from '${p('src/lib/game/replay-tourn')}';`,
    `export * as STORE from '${p('src/lib/game/replay-store')}';`,
    `export { computeSfxEvents } from '${p('src/lib/audio/sfx-events')}';`,
  ].join('\n'));
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return { ...(await import(pathToFileURL(O).href)) };
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

const H = 0.01, T = 0.99;   // Math.random() < 0.5 ＝正面
function withCoins(seq, fn) {
  const o = Math.random; let i = 0, calls = 0;
  Math.random = () => { calls++; return i < seq.length ? seq[i++] : H; };
  try { return { out: fn(), calls }; } finally { Math.random = o; }
}

async function engineChecks(M) {
  const r = {};
  if (!M?.createGame) return r;
  let nn = 0; const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const mk = (extra = {}, energies = [WATER, WATER]) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: GREN, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 1, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, log: [],
      players: [{ ...s.players[0], hand: [], active: inst(GREN, { status: 'confused', energyAttached: energies.map((e) => inst(e)), ...extra }), bench: [inst(DEF)], deck: [inst(DEF), inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)) },
        { ...s.players[1], active: inst(DEF), bench: [inst(DEF)], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)) }] };
  };
  const msgs = (o) => (o.log || []).map((l) => l.message);
  const ATK = (extra = {}) => ({ type: 'ATTACK', attackIndex: 0, discardedEnergyIids: [], ...extra });
  // A1：招式失敗擲幣反面 ⇒ 不擲混亂、不自傷（只擲 1 枚）
  { const st = mk({ attackFailureFlipCountThisTurn: 1 }); const { out, calls } = withCoins([T, T], () => M.applyAction(st, ATK(), pool));
    r.A1 = out.players[0].active.damage === 0 && calls === 1 && msgs(out).some((m) => m.includes('招式失敗')) && !msgs(out).some((m) => m.startsWith('混亂')) && out.players[1].active.damage === 0;
    r.A1n = JSON.stringify({ self: out.players[0].active.damage, calls, log: msgs(out).slice(-3) }); }
  // A2：招式失敗正面、混亂反面 ⇒ 30 自傷；log 順序：招式失敗的硬幣在混亂之前；旗標清掉不會留到之後
  { const st = mk({ attackFailureFlipCountThisTurn: 1 }); const { out } = withCoins([H, T], () => M.applyAction(st, ATK(), pool));
    const L = msgs(out); const i2a = L.findIndex((m) => m.includes('干擾命中判定')), iC = L.findIndex((m) => m.startsWith('混亂'));
    r.A2 = out.players[0].active.damage === 30 && i2a >= 0 && iC > i2a && out.players[0].active.attackFailureFlipCountThisTurn === undefined;
    r.A2n = JSON.stringify({ self: out.players[0].active.damage, L: L.slice(-4), flag: out.players[0].active.attackFailureFlipCountThisTurn }); }
  // B1：本回合無法使用招式 ⇒ 不擲任何硬幣（原本先擲混亂、反面吃 30）
  { const st = mk({ cantAttackThisTurn: true }); const { out, calls } = withCoins([T], () => M.applyAction(st, ATK(), pool));
    r.B1 = calls === 0 && out.players[0].active.damage === 0; r.B1n = JSON.stringify({ calls, self: out.players[0].active.damage }); }
  // B2：能量不足 ⇒ 盤面原封不動、不擲硬幣
  { const st = mk({}, [WATER]); const { out, calls } = withCoins([T], () => M.applyAction(st, ATK(), pool));
    r.B2 = out === st && calls === 0; r.B2n = JSON.stringify({ same: out === st, calls }); }
  // B3：這一招被鎖（下回合不能使用「忍者飛旋」）⇒ 不擲硬幣
  { const st = mk({ blockedAttackNamesThisTurn: ['忍者飛旋'] }); const { out, calls } = withCoins([T], () => M.applyAction(st, ATK(), pool));
    r.B3 = calls === 0 && out.players[0].active.damage === 0; r.B3n = JSON.stringify({ calls, self: out.players[0].active.damage, L: msgs(out).slice(-1) }); }
  // C1：兩步出招第一步 正面 ⇒ 記下、不出招；END_TURN／別招／再送一次第一步都被擋；第二步不重擲、照選擇付能量
  { const st = mk(); const r1 = withCoins([H], () => M.applyAction(st, { type: 'ATTACK', attackIndex: 0, _gateOnly: true }, pool)); const g = r1.out;
    const gate = g.attackGatePassed;
    const blocked = M.applyAction(g, { type: 'END_TURN' }, pool) === g && M.applyAction(g, { type: 'ATTACK', attackIndex: 1 }, pool) === g && M.applyAction(g, { type: 'ATTACK', attackIndex: 0, _gateOnly: true }, pool) === g;
    const pay = g.players[0].active.energyAttached[0].iid;
    const r2 = withCoins([T, T, T], () => M.applyAction(g, ATK({ discardedEnergyIids: [pay] }), pool));
    r.C1 = !!gate && gate.idx === 0 && gate.attackIndex === 0 && g.players[1].active.damage === 0 && g.turnPhase === 'main' && r1.calls === 1 && blocked
      && r2.calls === 0 && r2.out.attackGatePassed == null && r2.out.players[0].hand.some((c) => c.iid === pay) && r2.out.players[0].active.damage === 0
      && !msgs(r2.out).slice(msgs(g).length).some((m) => m.startsWith('混亂'));
    r.C1n = JSON.stringify({ gate, phase: g.turnPhase, c1: r1.calls, blocked, c2: r2.calls, hand: r2.out.players[0].hand.map((c) => c.iid), pay });
    // C4（審查 P2-1／P3-3）：對手回合面板只記一筆「攻擊」（第一步不記、第二步記）；第一步不播攻擊音
    const atkRecs = (s0) => (s0.players[0].currentTurnActions ?? []).filter((x) => x.type === 'attack').length;
    const sfxNames = (a, b, act) => (typeof M.computeSfxEvents === 'function' ? M.computeSfxEvents(a, b, act, pool, { mode: 'local', myPlayerIndex: 0, aiPlayerIndex: 1 }) : []).map((x) => x.name);
    const s1 = sfxNames(st, g, { type: 'ATTACK', attackIndex: 0, _gateOnly: true }), s2 = sfxNames(g, r2.out, ATK({ discardedEnergyIids: [pay] }));
    r.C4 = atkRecs(st) === 0 && atkRecs(g) === 0 && atkRecs(r2.out) === 1 && !s1.some((n) => n.startsWith('attack')) && s2.some((n) => n.startsWith('attack'));
    r.C4n = JSON.stringify({ rec: [atkRecs(st), atkRecs(g), atkRecs(r2.out)], s1, s2 });
    // C5：混亂反面的第一步照記一筆（招式宣告了、只是失敗）
    const rt = withCoins([T], () => M.applyAction(st, { type: 'ATTACK', attackIndex: 0, _gateOnly: true }, pool)).out;
    r.C5 = atkRecs(rt) === 1 && rt.attackGatePassed == null;
    // C6（審查 P2-2）：通過時記下 log 長度 ⇒ 同一回合同一招第二次通過是新的 tag
    r.C6 = !!gate && typeof gate.at === 'number' && gate.at >= (st.log ?? []).length && gate.at < (g.log ?? []).length;
  }
  // C2：第一步反面 ⇒ 照常失敗（30 自傷、回合結束），不留下記號
  { const st = mk(); const { out } = withCoins([T], () => M.applyAction(st, { type: 'ATTACK', attackIndex: 0, _gateOnly: true }, pool));
    r.C2 = out.players[0].active.damage === 30 && out.turnPhase === 'end' && out.attackGatePassed == null; r.C2n = JSON.stringify({ self: out.players[0].active.damage, phase: out.turnPhase, gate: out.attackGatePassed }); }
  // C3：AI／一般一次送出（沒有 _gateOnly）行為不變：正面就照打、放回選的能量
  { const st = mk(); const pay = st.players[0].active.energyAttached[1].iid; const { out } = withCoins([H, T, T], () => M.applyAction(st, ATK({ discardedEnergyIids: [pay] }), pool));
    r.C3 = out.players[0].hand.some((c) => c.iid === pay) && out.attackGatePassed == null && out.players[0].active.damage === 0; }
  // T1：錦標賽逾時收尾：停在已通過擲幣 ⇒ 用預設選擇把同一招打完（不是 END_TURN），套用後不再重擲
  if (typeof M.timeoutAction === 'function') {
    const st = mk(); const g = withCoins([H], () => M.applyAction(st, { type: 'ATTACK', attackIndex: 0, _gateOnly: true }, pool)).out;
    const a = M.timeoutAction(g, pool, 0);
    const after = a ? withCoins([T, T], () => M.applyAction(g, a, pool)) : null;
    r.T1 = !!a && a.type === 'ATTACK' && a.attackIndex === 0 && !!after && after.out !== g && after.out.attackGatePassed == null && after.calls === 0 && after.out.turnPhase === 'end';
    r.T1n = JSON.stringify({ a, calls: after?.calls, phase: after?.out?.turnPhase });
  }
  return r;
}

function gateUnit(G) {
  const r = {};
  if (!G) return r;
  const S0 = { attackGatePassed: null, activePlayerIndex: 0, turn: 3, id: 'g1' };
  const S1 = { attackGatePassed: { idx: 0, attackIndex: 1, turn: 3, at: 5 }, activePlayerIndex: 0, turn: 3, id: 'g1' };
  const S1b = { ...S1, attackGatePassed: { ...S1.attackGatePassed, at: 9 } };   // 同回合同招第二次通過（祭典樂舞）
  const STALE_T = { ...S1, turn: 4 }, STALE_P = { ...S1, activePlayerIndex: 1 };   // 過期：別的回合／輪到對手
  r.U1 = G.attackNeedsGateFlip({ status: 'confused' }) && G.attackNeedsGateFlip({ attackFailureFlipCountThisTurn: 2 }) && !G.attackNeedsGateFlip({ status: 'poisoned' }) && !G.attackNeedsGateFlip({}) && !G.attackNeedsGateFlip(null);
  r.U2 = G.uiAttackStep(S0, { status: 'confused' }, 1, true) === 'gate' && G.uiAttackStep(S0, { status: 'confused' }, 1, false) === 'normal'
    && G.uiAttackStep(S0, {}, 1, true) === 'normal' && G.uiAttackStep(S1, { status: 'confused' }, 1, true) === 'normal' && G.uiAttackStep(S1, { status: 'confused' }, 0, true) === 'gate';
  r.U3 = G.gateReopenTarget(S1, { canAct: true, myIdx: 0 }, '', false)?.attackIndex === 1 && G.gateReopenTarget(S1, { canAct: true, myIdx: 0 }, 'g1|3|1|5', false) === null
    && G.gateReopenTarget(S1b, { canAct: true, myIdx: 0 }, 'g1|3|1|5', false)?.attackIndex === 1
    && G.gateReopenTarget(S1, { canAct: true, myIdx: 0 }, '', true) === null && G.gateReopenTarget(S1, { canAct: false, myIdx: 0 }, '', false) === null
    && G.gateReopenTarget(S1, { canAct: true, myIdx: 1 }, '', false) === null && G.gateReopenTarget(S0, { canAct: true, myIdx: 0 }, '', false) === null;
  r.U4 = G.attackGateAllows(S0, { type: 'END_TURN' }) && !G.attackGateAllows(S1, { type: 'END_TURN' }) && !G.attackGateAllows(S1, { type: 'ATTACK', attackIndex: 0 })
    && G.attackGateAllows(S1, { type: 'ATTACK', attackIndex: 1 }) && !G.attackGateAllows(S1, { type: 'ATTACK', attackIndex: 1, _gateOnly: true })
    && G.attackGateMatches(S1, 0, 1) && !G.attackGateMatches({ ...S1, turn: 4 }, 0, 1) && !G.attackGateMatches(S1, 1, 1);
  // U5（審查 P3-1）：過期的紀錄（別的回合、或輪到對手）一律當作不存在：不鎖任何動作、不算等待中、不重開視窗
  r.U5 = typeof G.liveAttackGate === 'function'
    && [STALE_T, STALE_P].every((x) => G.attackGateAllows(x, { type: 'END_TURN' }) && G.attackGatePendingFor(x, 0) === null
      && G.gateReopenTarget(x, { canAct: true, myIdx: x.activePlayerIndex }, '', false) === null && G.uiAttackStep(x, { status: 'confused' }, 1, true) === 'gate')
    && G.liveAttackGate(S1) === S1.attackGatePassed;
  return r;
}

async function tournReplayChecks(M) {
  const r = {};
  if (typeof M?.TOURN?.tournReplayToData !== 'function') return r;
  const st = { players: [{ name: 'A' }, { name: 'B' }], log: [] };
  const server = { meta: { matchId: 'E1_r2_m0', p1name: '阿明', p2name: '小強', winnerName: '阿明', finalTurn: 9, endedAt: 1761000000000 },
    finalLog: [{ turn: 1, playerIndex: 0, message: 'x' }], finalState: { ...st },
    snapshots: [{ turn: 1, activePlayerIndex: 0, logLen: 3, state: st, at: 5 }, { turn: 1, activePlayerIndex: 1, logLen: null, state: st }, { turn: 2, activePlayerIndex: 0, logLen: 9, state: null }] };
  const d = M.TOURN.tournReplayToData(server, { matchId: 'E1_r2_m0', viewerSeat: 1, appVersion: 'T', now: 7 });
  r.R1 = !!d && d.meta.kind === 'tournament' && d.meta.revealed === true && d.meta.viewerSeat === 1 && d.meta.gameId === 'E1_r2_m0' && d.meta.p1name === '阿明' && d.meta.winnerName === '阿明'
    && d.meta.savedAt === 1761000000000 && d.snapshots.length === 2 && d.snapshots[1].logLen === 1 && d.snapshots[0].at === 5 && d.finalLog.length === 1;
  r.R1n = JSON.stringify(d && { meta: d.meta, n: d.snapshots.length, l: d.snapshots.map((s) => s.logLen) });
  r.R2 = M.TOURN.tournReplayToData({ meta: {}, snapshots: [], finalState: null }, { matchId: 'x', viewerSeat: null, appVersion: 'T', now: 1 }) === null && M.TOURN.tournReplayToData(null, { matchId: 'x', viewerSeat: null, appVersion: 'T', now: 1 }) === null
    && M.TOURN.matchIdOfTournRoom('mr_E1_r2_m0') === 'E1_r2_m0' && M.TOURN.matchIdOfTournRoom('TOURNAMENT-TEST') === null && M.TOURN.matchIdOfTournRoom('mr_') === null;
  // R3 下載的檔案（gzip）用一般對戰的匯入流程讀得回來
  if (typeof CompressionStream !== 'undefined' && d) {
    const bytes = await M.STORE.gzipText(JSON.stringify(d));
    const back = await M.STORE.parseReplayBytes(bytes);
    r.R3 = !('error' in back) && back.data.meta.kind === 'tournament' && back.data.snapshots.length === 2;
  } else r.R3 = 'skip';
  return r;
}

function staticChecks(ENG, PAGE, TO) {
  const r = {};
  const e = stripCommentsBlank(ENG), p = stripCommentsBlank(PAGE);
  const a0 = e.indexOf("if (action.type === 'ATTACK') {\n    if (state.turnPhase !== 'main') return state;");
  const g0 = e.indexOf('const _gatePassedBefore = attackGateMatches(state, aIdx, action.attackIndex);', a0);
  const pos = (needle) => e.indexOf(needle, a0);
  const iFail = pos('attacker.active.attackFailureFlipCountThisTurn &&'), iConf = pos("if (attacker.active.status === 'confused') {"), iSnap = pos('const preAttackStateForRetry: GameState = state;');
  const decl = ['if (attacker.active.cantAttackThisTurn) {', 'isAttackNameBlocked(attacker.active, attackName)', 'isPlayerLevelAttackOnCooldown(state, aIdx, attackName)', 'if (attacker.noAttacksThisTurn) {', 'selfAttackPreconditionBlock(state, aIdx, pool)', 'if (!canAffordAttack(attacker.active, attack.cost, pool, state, aIdx, attack.name)) return state;'].map(pos);
  r.S1 = a0 > 0 && g0 > a0 && decl.every((x) => x > a0 && x < g0) && iFail > g0 && iConf > iFail && iSnap > iConf
    && (e.slice(a0, g0).match(/status === 'confused'/g) || []).length === 0;
  r.S1n = JSON.stringify({ a0, g0, decl, iFail, iConf, iSnap });
  r.S2 = /if \(!attackGateAllows\(state, action\)\) return state;\s*\n\s*let raw = applyActionImpl\(state, action, pool\);/.test(e);
  // 對戰頁：中央判準、取消鎖、下載鈕
  const cancels = ['cancelPreAttackDiscard', 'cancelCopyAttack', 'cancelPersonateAttack', 'cancelBrightChallenge', 'cancelRocketCommand'];
  r.S3 = /uiAttackStep\(game, activePlayer\.active, attackIndex, _needsChoice\) === 'gate'/.test(p) && /dispatch\(\{ type: 'ATTACK', attackIndex, _gateOnly: true \}\)/.test(p)
    && /gateReopenTarget\(game, \{ canAct, myIdx \}, _gateOpenedFor,/.test(p)
    && cancels.every((f) => new RegExp('function ' + f + '\\(\\) \\{\\s*if \\(attackGateLocked\\) return;').test(p))
    && (p.match(/disabled=\{attackGateLocked\} onclick=\{cancel/g) || []).length >= 6;
  r.S4 = (p.match(/\{#if tournReplayMatchId\}<button class="btn-secondary" disabled=\{tournReplayDl\.busy\} onclick=\{downloadTournReplay\}/g) || []).length === 2
    && /matchIdOfTournRoom\(tActiveRoom\)/.test(p) && /tournReplayToData\(j, \{ matchId: mid/.test(p) && /await downloadReplayFile\(data\);/.test(p.slice(p.indexOf('async function downloadTournReplay')));
  // S6（審查 P2-2）：接回只在出招那張卡已經載入時才試；真的開了視窗或送出動作才記「開過了」
  const _e0 = p.indexOf('let _gateOpenedFor = '), eff = _e0 > 0 ? p.slice(_e0, p.indexOf('function handleProposeRestartButton', _e0)) : '';   // p 已剝註解 ⇒ 用程式碼當錨點
  // ⭐v6.596（Rule 40）：同一個判準抽成 attack-gate.ts 的 gateFieldCardsLoaded（接回與提示列按鈕共用）⇒ 舊寫法（就地 _field.every）與新寫法擇一；判準本身由 test-v6596 U2 守
  const s6Old = /if \(!_act \|\| !_field\.every\(\(c\) => !c \|\| _pool\.has\(c\.cardId\)\)\) return;/.test(eff) && /game\.players\.flatMap\(\(pl\) => \[pl\.active, \.\.\.\(pl\.bench \?\? \[\]\)\]\)/.test(eff);
  const s6New = /if \(!game \|\| !gateFieldCardsLoaded\(game, game\.activePlayerIndex, \(id\) => _pool\.has\(id\)\)\) return;/.test(eff);
  r.S6 = eff.length > 200 && eff.length < 4000 && (s6Old || s6New)
    && /initiateAttack\(t\.attackIndex\);\s*\n[^\n]*\n\s*if \(game !== _g0 \|\| preAttackDiscard[^\n]*\) _gateOpenedFor = t\.tag;/.test(eff)
    && !/_gateOpenedFor = t\.tag;\s*\n\s*untrack/.test(eff);
  // S7：錦標賽 /replay 只有一個網路呼叫點（回放與下載共用）
  r.S7 = (p.match(/fetch\(T_API \+ '\/replay\?matchId='/g) || []).length === 1 && (p.match(/await fetchTournReplay\(/g) || []).length === 2;
  r.S5 = /attackGatePendingFor\(g, seat\)/.test(stripCommentsBlank(TO)) && stripCommentsBlank(TO).indexOf('attackGatePendingFor(g, seat)') < stripCommentsBlank(TO).lastIndexOf("{ type: 'END_TURN' }");
  return r;
}

// ── 現版 ──
const M = await loadMods(ROOT);
const U = gateUnit(M.GATE);
ok('★★ U1 判準：混亂或「招式失敗」旗標 ⇒ 要擲幣；其他狀態不用', U.U1 === true);
ok('★★★ U2 對戰頁按招式：要選擇＋要擲幣 ⇒ 先送第一步；已通過同一招 ⇒ 直接開選擇；不用選擇或不用擲幣 ⇒ 原流程', U.U2 === true);
ok('★★★ U3 已通過擲幣 ⇒ 輪到自己、可操作、還沒開過、沒有其他視窗才打開；重新整理後會接回來', U.U3 === true);
ok('★★★ U4 已通過擲幣時引擎只接受同一招的一般 ATTACK（不能結束回合、改出別招、再送第一步）', U.U4 === true);
ok('★★★ U5 過期的紀錄（別的回合、輪到對手）一律當作不存在：不鎖動作、不算等待中、不重開視窗（審查 P3-1）', U.U5 === true);
const E = await engineChecks(M);
const EL = {
  A1: '★★★ A1 招式失敗擲幣（潑沙類）反面 ⇒ 不擲混亂、不自傷（官方：先擲招式失敗、正面才擲混亂）',
  A2: '★★★ A2 招式失敗正面、混亂反面 ⇒ 30 自傷；log 順序是招式失敗的硬幣在前；旗標不會被寫回',
  B1: '★★★ B1 本回合無法使用招式 ⇒ 不擲任何硬幣（原本先擲混亂、反面吃 30）',
  B2: '★★ B2 能量不足 ⇒ 盤面原封不動、不擲硬幣',
  B3: '★★ B3 這一招被鎖 ⇒ 不擲硬幣',
  C1: '★★★ C1 兩步出招：第一步正面只記下不出招、其他動作都被擋；第二步不重擲、照選擇放回能量',
  C2: '★★★ C2 兩步出招：第一步反面 ⇒ 照常 30 自傷、回合結束、不留下記號',
  C3: '★★ C3 AI／一般一次送出不變（正面照打、照選擇付能量）',
  C4: '★★★ C4 對手回合面板只記一筆「攻擊」（第一步不記、第二步記）；第一步不播攻擊音（審查 P2-1／P3-3）',
  C5: '★★ C5 混亂反面的第一步照記一筆攻擊（宣告了、只是失敗）',
  C6: '★★ C6 通過擲幣時記下當下的 log 位置（同回合同招第二次通過是新的接回 tag，審查 P2-2）',
  T1: '★★★ T1 錦標賽逾時收尾：停在已通過擲幣 ⇒ 用預設選擇把同一招打完（不是結束回合），不再重擲',
};
for (const k of Object.keys(EL)) ok(EL[k], E[k] === true, E[k + 'n']);
const RR = await tournReplayChecks(M);
ok('★★★ R1 錦標賽回放 → 復盤檔：kind tournament、攤開、下載者座位、名字與勝者、時間、缺 logLen 補順序、壞格子略過', RR.R1 === true, RR.R1n);
ok('★★ R2 沒有任何盤面 ⇒ null；對戰房 id 只認 mr_<matchId>', RR.R2 === true);
if (RR.R3 === 'skip') shallowSkip('R3（Node 沒有 CompressionStream）'); else ok('★★★ R3 下載的檔案用一般對戰的匯入流程（parseReplayBytes）讀得回來', RR.R3 === true);
const S = staticChecks(R('src/lib/game/engine.ts'), R('src/routes/game/+page.svelte'), R('src/lib/game/timeout-action.ts'));
ok('★★★ S1 引擎：所有宣告檢查（無法使用招式、招式被鎖、冷卻、雷電在地、使用條件、能量）都在擲幣之前；招式失敗在混亂之前；混亂在重試徽章快照之前', S.S1 === true, S.S1n);
ok('★★ S2 引擎入口：已通過擲幣時其他動作原樣不動（attackGateAllows）', S.S2 === true);
ok('★★★ S3 對戰頁：按招式走 uiAttackStep、接回走 gateReopenTarget；五個取消函式與 6 顆取消鈕都被鎖住', S.S3 === true);
ok('★★ S4 錦標賽兩個結算視窗（勝負、平手）都有「下載復盤檔」，走 mr_<matchId>、轉檔後用一般對戰的下載函式', S.S4 === true);
ok('★★ S5 逾時收尾在結束回合之前先處理「已通過擲幣」', S.S5 === true);
ok('★★★ S6 對戰頁接回：雙方場上（含借招來源）的卡還沒全部載進卡池就先不試；真的開了視窗才記下（審查 P2-2）', S.S6 === true);
ok('★★ S7 錦標賽 /replay 只有一個網路呼叫點（回放與結束時下載共用，不多一個呼叫點）', S.S7 === true);

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6595b-'));
  try {
    const { execFileSync } = await import('node:child_process');
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const bM = await loadMods(tmp);
    const bU = gateUnit(bM.GATE), bE = await engineChecks(bM), bR = await tournReplayChecks(bM);
    const bS = staticChecks(normEol(readFileSync(join(tmp, 'src/lib/game/engine.ts'), 'utf8')), normEol(readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8')), normEol(readFileSync(join(tmp, 'src/lib/game/timeout-action.ts'), 'utf8')));
    const red = [...['U1', 'U2', 'U3', 'U4', 'U5'].filter((k) => bU[k] !== true), ...['A1', 'B1', 'B2', 'B3', 'C1', 'C4', 'C6', 'T1'].filter((k) => bE[k] !== true),
      ...['R1', 'R2'].filter((k) => bR[k] !== true), ...['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].filter((k) => bS[k] !== true)];
    ok('★★★ HEAD-FAIL：BASE（v6.594）上 U1-U5、A1、B1、B2、B3、C1、C4、C6、T1、R1、R2、S1-S7 逐條紅', red.length === 22, red.join(','));
    ok('★ HEAD-FAIL 正對照：BASE 上 C2（反面照常 30 自傷）、C3（一般一次送出）、C5（反面記一筆攻擊）本來就對（舊版不認得第一步，整招擲反面結果相同）', bE.C2 === true && bE.C3 === true && bE.C5 === true, JSON.stringify({ C2: bE.C2n, C3: bE.C3, C5: bE.C5 }));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.595 出招前擲幣順序／兩步出招／錦標賽復盤下載：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
