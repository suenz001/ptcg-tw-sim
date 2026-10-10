#!/usr/bin/env node
/**
 * v6.518 守衛：一般對戰「雙方都準備好，對戰卻不會開始」（站長 2026-10-10 轉述玩家回報＋截圖：
 *   畫面停在「⏳ 雙方已準備，遊戲即將開始⋯」，12 秒後出現「建局逾時診斷 → 我的座位=1｜卡池已載入=true｜…｜卡池缺卡=0」）。
 *
 * 真因：seat 1（P2）在「雙方就緒滿 6 秒」後才接手建局，但重新判斷的 checkAndStartOnlineGame() 只在收到房間更新時被呼叫，
 *   而房間輪詢在版本沒變時不回呼 ⇒ 6 秒到了沒人再問一次，要等到下一次心跳（每 60 秒）才會再判斷。
 *   截圖裡「我的座位=1、卡池全齊、沒有任何錯誤」正是 P2 從來沒有嘗試建局的樣子（嘗試過的話會顯示 createGame／startGame 的錯誤）。
 *
 * 【P】中央述詞 startGraceRecheckDelayMs：逐組合（座位 × 四個前提 × 經過時間）斷言
 *      回數字 ⇒ 現在 shouldAttemptStartGame 是 false、等這麼久之後是 true；其餘回 null
 * 【B】行為端：把 handleRoomUpdate 尾段＋checkAndStartOnlineGame 原文抽出來、配可前進的假計時器真的執行
 *      B1 P2、房主沒建局、之後完全沒有房間更新 ⇒ 6 秒多一點就自己建局（不必等心跳）
 *      B2 房主在計時器到之前已建好（房間有盤面）⇒ 計時器醒來也不會再建（不會重複建局）
 *      B3 正對照：seat 0 立刻建局、不排計時器
 *      B4 多次房間更新只會留一個計時器（不會排出好幾次建局）
 * 【S】接線：onDestroy 清掉計時器
 * 【H】HEAD-FAIL：同一個 B1 情境餵 v6.517 的 +page.svelte／sync-guards.ts ⇒ 60 秒內都不會建局
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：admin v1.80（玩家端＝v6.517）。
const BASE_SHA = 'b963f3f3';
const PAGE_PATH = 'src/routes/game/+page.svelte', SG_PATH = 'src/lib/game/sync-guards.ts';
const rd = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ── 抽取器（與 test-v6274 同一組錨點；抽不到就回 null，各條自己翻紅，不整支 throw — Rule 41）──
const A_LOBBY_RESET = "    // v3.96 房間 status 從 'playing'/'ended' → 'lobby' + game=null：雙方都 ready 後 reset 的同步點";
const A_V272 = '    // v2.72：雙方 P1/P2 都 ready → P1 或 P2 任一 client 都可觸發 startGame';
const A_HRU_END = '\n  }\n\n  // v5.894：對戰按牌組載入';
const A_CSG = '  function checkAndStartOnlineGame() {';
const A_CSG_END = '\n  }\n\n  /**\n   * v6.055 建局逾時看門狗。';
const balanced = (s) => { let d = 0; for (const c of s) { if (c === '{') d++; else if (c === '}') d--; } return d; };
function extract(src) {
  const i0 = src.indexOf(A_LOBBY_RESET); if (i0 < 0) return null;
  const j0 = src.indexOf('\n    }\n', i0); const lobby = src.slice(i0, j0 + 7);
  const end = src.indexOf(A_HRU_END); const v272 = src.lastIndexOf(A_V272, end);
  if (end < 0 || v272 < 0) return null;
  const g = src.lastIndexOf('shouldResetStartGrace(', end);
  let start = v272; if (g > 0 && g < v272) start = src.lastIndexOf('\n', g) + 1;
  const tail = src.slice(start, end);
  const i = src.indexOf(A_CSG), j = src.indexOf(A_CSG_END, i);
  if (i < 0 || j < 0) return null;
  const csg = src.slice(i, j + 5);
  if (balanced(lobby) || balanced(tail) || balanced(csg)) return null;
  return { lobby, tail, csg };
}
function loadSG(text) {
  const code = transformSync(text, { loader: 'ts', format: 'cjs', target: 'node18' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({}));
  return mod.exports;
}

/** 組 harness：可前進的假時鐘＋假計時器（setTimeout 真的會在 adv 時觸發）。 */
function makeSim(src, sg, myUid) {
  const ex = extract(src);
  if (!ex) return null;
  const frag = ['function onRoom(room) {', '  roomData = room;',
    '  const idx = room.seats.findIndex((s) => !!s.uid && s.uid === myUid);',
    ex.lobby, '  if (room.gameState && !game) { game = { id: room.gameState.id }; }', ex.tail, '}', ex.csg].join('\n');
  const js = transformSync(frag, { loader: 'ts', target: 'node18' }).code;
  const env = { myUid, seq: 0, built: [], t: 1000000, timers: [], tid: 0, sg };
  const prologue = `
  let _onlineReadyAt = 0, game = null, roomData = null, mySeatIdx = -1;
  let _poolRetry = 0, onlineError = '', _startGameWon = null, _startGameReadyMs = -1, _startGameCalls = 0;
  let _startGraceTimer = null;
  const poolReady = true, roomCode = 'ROOM', forceLegacyOpeningParam = false;
  const myUid = env.myUid, pool = new Map();
  const { shouldAttemptStartGame, shouldResetStartGrace } = env.sg;
  const startGraceRecheckDelayMs = env.sg.startGraceRecheckDelayMs || (() => null);
  const bothPlayersReady = (seats) => !!(seats[0].uid && seats[1].uid && seats[0].ready && seats[1].ready);
  const Date = { now: () => env.t };
  const deckEntriesAllInPool = () => true;
  const ensurePoolForDeckEntries = async () => {};
  const createGame = () => ({ id: 'G' + (++env.seq) });
  const startGame = (rc, g) => { env.built.push({ t: env.t, id: g.id, readyMs: _startGameReadyMs }); return Promise.resolve(true); };
  const playSfx = () => {}, staggerSfx = () => {};
  const setTimeout = (fn, ms) => { const id = ++env.tid; env.timers.push({ id, at: env.t + ms, fn }); return id; };
  const clearTimeout = (id) => { env.timers = env.timers.filter((x) => x.id !== id); };
  const console = { log() {}, warn() {}, error() {} };`;
  const api = new Function('env', prologue + js + '\nreturn { onRoom, setRoomSilently: (r) => { roomData = r; } };')(env);
  const adv = (ms) => {
    const until = env.t + ms;
    for (;;) {
      env.timers.sort((a, b) => a.at - b.at);
      const nx = env.timers[0];
      if (!nx || nx.at > until) break;
      env.timers.shift(); env.t = nx.at; nx.fn();
    }
    env.t = until;
  };
  return { ...api, env, adv };
}
const DECK = Array.from({ length: 60 }, (_, i) => ({ cardId: 'c' + i, count: 1 }));
const seat = (uid, ready) => ({ uid, ready, deckEntries: DECK, name: uid });
const R = (ready, gs) => ({ status: 'lobby', gameState: gs ?? null, seats: [seat('U1', ready), seat('U2', ready), {}, {}] });

function scenarioP2NoHost(src, sg, waitMs) {
  const sim = makeSim(src, sg, 'U2');
  if (!sim) return null;
  sim.onRoom(R(false)); sim.onRoom(R(true));     // 雙方就緒；房主沒有建局，之後房間完全不再變動
  const atReady = sim.env.built.length;
  sim.adv(waitMs);
  return { atReady, built: sim.env.built.slice(), timers: sim.env.timers.length };
}

const PAGE = rd(PAGE_PATH), SGSRC = rd(SG_PATH);
let SG = null;
try { SG = loadSG(SGSRC); } catch (e) { console.log('  sync-guards 載入失敗：' + e.message); }

console.log('【P】中央述詞 startGraceRecheckDelayMs');
{
  const f = SG && SG.startGraceRecheckDelayMs;
  ok('[P0] 有 startGraceRecheckDelayMs', typeof f === 'function');
  if (typeof f === 'function') {
    let n = 0, numbers = 0; const bad = [];
    for (const mySeat of [-1, 0, 1, 2]) for (const bothReady of [true, false]) for (const roomStatus of ['lobby', 'playing'])
      for (const hasGameState of [false, true]) for (const haveLocalGame of [false, true]) for (const el of [0, 1, 3000, 5999, 6000, 6001, 999999]) {
        n++;
        const o = { mySeat, bothReady, roomStatus, hasGameState, haveLocalGame, readyElapsedMs: el };
        const d = f(o);
        const now = SG.shouldAttemptStartGame(o);
        if (d === null) {
          // 回 null：要嘛現在就會建（不必等）、要嘛永遠不會因為等待而建
          const later = SG.shouldAttemptStartGame({ ...o, readyElapsedMs: el + 10 ** 7 });
          if (!now && later) bad.push('漏排：' + JSON.stringify(o));
        } else {
          numbers++;
          if (!(d > 0) || now || !SG.shouldAttemptStartGame({ ...o, readyElapsedMs: el + d })) bad.push('錯排：' + JSON.stringify(o) + ' d=' + d);
          if (d > 6500) bad.push('等太久：' + d);
        }
      }
    ok('★★★[P1] ' + n + ' 種組合：回數字 ⇒ 現在不建、等完一定建；回 null ⇒ 等再久也不會因為時間而變成要建', bad.length === 0 && numbers === 4, bad.slice(0, 3).join('｜') + ' numbers=' + numbers);
    ok('[P2] seat 1 剛就緒 ⇒ 約 6 秒後再判斷；seat 0 ⇒ null（立刻建）',
      f({ mySeat: 1, bothReady: true, roomStatus: 'lobby', hasGameState: false, haveLocalGame: false, readyElapsedMs: 0 }) === 6250
      && f({ mySeat: 0, bothReady: true, roomStatus: 'lobby', hasGameState: false, haveLocalGame: false, readyElapsedMs: 0 }) === null);
  }
}

console.log('\n【B】行為端（handleRoomUpdate 尾段＋checkAndStartOnlineGame 原文、假計時器）');
{
  const b1 = SG ? scenarioP2NoHost(PAGE, SG, 7000) : null;
  ok('★★★[B1] P2、房主沒建局、之後沒有任何房間更新 ⇒ 6 秒多一點自己建局（不必等 60 秒心跳）',
    !!b1 && b1.atReady === 0 && b1.built.length === 1 && b1.built[0].readyMs >= 6000 && b1.built[0].readyMs <= 6500 && b1.timers === 0, JSON.stringify(b1));
  // B2：房主在計時器到之前已建好
  const s2 = SG && makeSim(PAGE, SG, 'U2');
  if (s2) {
    s2.onRoom(R(false)); s2.onRoom(R(true));
    s2.adv(2000); s2.onRoom(R(true, { id: 'HOST-GAME' }));   // 房主建好了（盤面到了）
    s2.adv(10000);
    ok('★★[B2] 房主先建好 ⇒ 計時器醒來不再建局（不會兩邊都建）', s2.env.built.length === 0, JSON.stringify(s2.env.built));
  } else ok('★★[B2] 房主先建好', false, '抽取失敗');
  // B3：seat 0
  const s3 = SG && makeSim(PAGE, SG, 'U1');
  if (s3) {
    s3.onRoom(R(false)); s3.onRoom(R(true));
    ok('[B3] 正對照：seat 0 立刻建局、不排計時器', s3.env.built.length === 1 && s3.env.timers.length === 0, JSON.stringify({ b: s3.env.built, t: s3.env.timers.length }));
  } else ok('[B3] seat 0', false, '抽取失敗');
  // B4：多次房間更新只留一個計時器、只建一次
  const s4 = SG && makeSim(PAGE, SG, 'U2');
  if (s4) {
    s4.onRoom(R(false)); s4.onRoom(R(true));
    s4.adv(1000); s4.onRoom(R(true)); s4.adv(1000); s4.onRoom(R(true));
    const pending = s4.env.timers.length;
    s4.adv(10000);
    ok('★★[B4] 多次房間更新只留一個計時器、只建一次局', pending === 1 && s4.env.built.length === 1, JSON.stringify({ pending, built: s4.env.built.length }));
  } else ok('★★[B4] 單一計時器', false, '抽取失敗');
}

console.log('\n【S】接線');
{
  // 主對戰頁的 onDestroy（含 v6467-destroy-timers 那一段的那一支；頁面上有好幾個 onDestroy）
  const anchor = PAGE.indexOf('    // >>> v6467-destroy-timers');
  const od = anchor > 0 ? PAGE.lastIndexOf('  onDestroy(() => {\n', anchor) : -1;
  const blk = od >= 0 ? PAGE.slice(od, anchor) : '';
  ok('★[S1] 離開頁面時清掉重新判斷計時器', /if \(_startGraceTimer !== null\) \{ clearTimeout\(_startGraceTimer\); _startGraceTimer = null; \}/.test(blk));
  ok('[S2] 只在 seat 1 的等待期排計時器，判準走中央 startGraceRecheckDelayMs（頁面沒有自己算 6000）',
    PAGE.includes('const _recheck = startGraceRecheckDelayMs(_startOpts);') && !/6000\s*-\s*\(?Date\.now\(\)/.test(PAGE));
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bp = readBaseBlob(ROOT, BASE_SHA, PAGE_PATH), bs = readBaseBlob(ROOT, BASE_SHA, SG_PATH);
  if (bp.ok && bs.ok) {
    let r = null, err = '';
    try { r = scenarioP2NoHost(bp.out.replace(/\r\n/g, '\n'), loadSG(bs.out), 60000); } catch (e) { err = e.message; }
    ok('★★★[H1] v6.517：同一情境等 60 秒都不會建局（原 bug 重現，而且不是因為例外）', !!r && r.built.length === 0 && !err, err || JSON.stringify(r));
    let bsg = null; try { bsg = loadSG(bs.out); } catch { /* */ }
    ok('★★[H2] v6.517 沒有 startGraceRecheckDelayMs', !!bsg && typeof bsg.startGraceRecheckDelayMs !== 'function');
  } else shallowSkip('v6518 H', '讀不到 BASE blob');
} else shallowSkip('v6518 H', '需要 b963f3f3 commit');

console.log(`\n=== v6.518 P2 接手建局計時器：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
