#!/usr/bin/env node
/**
 * v6.172 守衛：兩個「我們自己造成」的回歸
 *   ① 拖曳被 `actionBusy` 鎖死最長 33 秒（v6.147 引入、v6.170 的重送窗放大）
 *   ② 「與伺服器失聯 xx 秒」誤報（動作往返成功不算存活；長輪詢掛起被當成失聯）
 *
 * ⚠⚠ 這份守衛刻意**不只驗字串存在**（v6.154 的教訓：22 條守衛全綠、分頁卻打不開）：
 *   ・佇列狀態機是把 +page.svelte 裡那幾支函式**抽出來真的跑**（含 tournamentDispatch 本人）；
 *   ・`actionBusy` / `tOfflineSec` / `tNetBannerOn` 是把 **$derived 的原始運算式抽出來求值**，
 *     不是比對字串 —— 運算式改壞了這裡就會紅；
 *   ・手牌 `onpointerdown` 是把**模板裡那一行 handler 本人**抽出來執行，斷言的是
 *     「startDrag 有沒有被呼叫」「玩家有沒有被告知」，不是「原始碼裡有這行字」；
 *   ・`tApi` 也是真的跑（假 fetch），斷言「連線健康錨點真的前進了」。
 *   ・每一條關鍵斷言都配一個**變異對照**（把 v6.171 的舊寫法拿來跑，確認守衛真的會紅）。
 *
 * Run: node scripts/test-v6172-action-queue-and-conn-health.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';
import { compile } from 'svelte/compiler';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const MOB = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 從原始碼抽一支函式（簽章可能含 `{}` 型別 ⇒ 從簽章那一行的最後一個 `{` 開始配對）。 */
function grabFn(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  // 簽章的括號配對（參數可能含 `{}` 型別）→ 再往後找**第一個** `{` 當 body 起點。
  // ⚠ 不可以用「簽章那一行的最後一個 `{`」：單行函式（body 與簽章同一行）會抓到 body 內部的括號。
  let k = src.indexOf('(', i), d = 0;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '(') d++;
    else if (c === ')') { d--; if (d === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return null;
  d = 0;
  let j = open;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) break; }
  }
  return src.slice(i, j + 1);
}
/** 抽出 `const NAME = $derived( … )` 括號內的**原始運算式**（多行、含 TS as 型別都可以）。 */
function grabDerived(src, name) {
  const key = 'const ' + name + ' = $derived(';
  const i = src.indexOf(key);
  if (i < 0) return null;
  let d = 1, j = i + key.length;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '(') d++;
    else if (c === ')') { d--; if (d === 0) break; }
  }
  return src.slice(i + key.length, j).replace(/,\s*$/, '');
}
const num = (src, name) => {
  const m = src.match(new RegExp('(?:const|let)\\s+' + name + '\\s*=\\s*(\\d+)'));
  return m ? Number(m[1]) : null;
};

// ══════════════════════════════════════════════════════════════════════════
console.log('① 「這一下能不能做」的述詞：actionBusy 不再等於「有動作在途」（**求值**，不是比字串）');
// ══════════════════════════════════════════════════════════════════════════
let evalBusy = null, evalSending = null;
try {
  const busyExpr = grabDerived(PAGE, 'actionBusy');
  const sendExpr = grabDerived(PAGE, 'actionSending');
  ok('★兩個述詞都抽得到（抽不到 ⇒ 下面全部無效，先擋在這裡）', !!busyExpr && !!sendExpr, String(busyExpr));
  const QMAX = num(PAGE, 'TACT_QUEUE_MAX');
  ok('★★佇列上限讀得到且 ≥1', typeof QMAX === 'number' && QMAX >= 1, String(QMAX));
  const mk = (expr) => new Function('isTournament', 'tInFlight', 'tActQueue', 'TACT_QUEUE_MAX',
    'return (' + expr + ');');
  evalBusy = mk(busyExpr); evalSending = mk(sendExpr);

  ok('★★★動作在途、佇列是空的 ⇒ **不擋**（v6.171 這裡是 true，玩家的拖曳最長被吃掉 33 秒）',
    evalBusy(true, true, [], QMAX) === false);
  ok('★★★動作在途、佇列還沒滿 ⇒ 仍然不擋',
    evalBusy(true, true, new Array(QMAX - 1).fill(0), QMAX) === false);
  ok('★★★只有「佇列已滿」才擋 —— 這就是「拖曳在什麼情況下才會被擋」的唯一答案',
    evalBusy(true, true, new Array(QMAX).fill(0), QMAX) === true);
  ok('★沒有動作在途 ⇒ 永遠不擋', evalBusy(true, false, new Array(QMAX + 5).fill(0), QMAX) === false);
  ok('★非錦標賽（本機／休閒）完全不受影響', evalBusy(false, true, new Array(QMAX).fill(0), QMAX) === false);
  ok('★★actionSending 只回答「有沒有在送」⇒ 純視覺用，佇列空的時候仍為 true',
    evalSending(true, true, [], QMAX) === true && evalSending(true, false, [], QMAX) === false);
  // 變異對照：v6.171 的寫法
  const old = mk('isTournament && tInFlight');
  ok('★掃描器自我驗證：v6.171 的舊寫法在「動作在途、佇列空」時會回 true（＝這條斷言真的有鑑別度）',
    old(true, true, [], QMAX) === true);
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('② 佇列狀態機（**實跑** tournamentDispatch 本人）');
// ══════════════════════════════════════════════════════════════════════════
try {
  const names = ['_tActSig', 'tActSay', '_tRestorePrediction', '_tActDone', '_tActClearQueue',
    'tActAbortAll', '_tActDrain', '_tActCanRetry', '_tActSchedule', '_tActAttempt', 'tActCancel', 'tournamentDispatch'];
  const parts = names.map((n) => grabFn(PAGE, n));
  ok('★佇列＋重送狀態機各支函式都抽得到', parts.every(Boolean),
    names.filter((n, i) => !parts[i]).join(','));
  const out = await transform(parts.join('\n'), { loader: 'ts' });
  const QMAX = num(PAGE, 'TACT_QUEUE_MAX');
  const blockedMsg = /const TACT_BLOCKED_MSG = ([^;]+);/.exec(PAGE)[1];

  function build2(net, opts = {}) {
    const log = { sent: [], ids: [], maxConcurrent: 0, cur: 0, resync: 0 };
    const pre = `
      const TACT_RETRY_MAX = ${num(PAGE, 'TACT_RETRY_MAX')};
      const TACT_RETRY_MS = ${opts.windowMs ?? 25000};
      const TACT_POST_TIMEOUT = 8000;
      const TACT_QUEUE_MAX = ${QMAX};
      const TACT_BLOCKED_MSG = ${blockedMsg};
      let _actCtx = null, _actRetryTimer = null, tActRetry = null, tInFlight = false;
      let tActQueue = [], tActNotice = '', _tActNoticeTimer = null;
      let game = ${JSON.stringify(opts.game ?? { phase: 'playing', n: 0 })};
      let tError = '', tActiveRoom = 'R', _tActionAuthErr = false, _tActionAuthErrAt = 0, _actionAuthDiagSent = false;
      let tStep = 'playing';
      let tVersion = 0;   // ⭐v6.180 ctx 帶 baseV = 預測當下的伺服器版本（回滾判準）
      const poolReady = false, pool = null, OPTIMISTIC_ACTION_TYPES = [];
      const tryPredictAction = () => ({ ok: false });
      const tPlayerId = () => 'me';
      const _newActId = () => 'ID-' + (__seq++);
      const _tRecordRtt = () => {};
      const _tSendClientDiag = () => {};
      const tForceResync = () => { __log.resync++; };
      const dispatchSfxForAction = () => {};
      const tAdopt = (s) => { game = s; };
      const tApi = async (path, body) => {
        __log.sent.push(body); __log.ids.push(body.actId);
        __log.cur++; if (__log.cur > __log.maxConcurrent) __log.maxConcurrent = __log.cur;
        try { return await __net(__log.sent.length, body); } finally { __log.cur--; }
      };
    `;
    const post = `
      return {
        dispatch: (a) => tournamentDispatch(a),
        cancel: tActCancel,
        get busy() { return tInFlight; },
        get queue() { return tActQueue.slice(); },
        get notice() { return tActNotice; },
        get err() { return tError; },
        get game() { return game; },
        setGame(g) { game = g; },
        abort: tActAbortAll,
        setStep(v) { tStep = v; },
      };
    `;
    const m = new Function('__net', '__log', 'isTournament', 'isTournSpectator',
      'let __seq = 1;' + pre + out.code + post)(net, log, true, false);
    return { m, log };
  }

  const netErr = () => Promise.reject(new Error('連線逾時（8 秒沒有回應）'));
  const netOk = (v) => Promise.resolve({ gameState: { phase: 'playing', n: v }, version: v });

  // ── ②-1 核心①：重送期間玩家仍可操作，手勢進佇列（不是靜默丟棄）────────
  {
    const { m } = build2(async () => netErr());
    m.dispatch({ type: 'attach', iid: 'e1' });
    await sleep(40);
    ok('★★★第一發卡住（重送中）⇒ 仍然 tInFlight，但玩家可以繼續操作', m.busy === true);
    ok('★★★重送期間 actionBusy 為 false（拿真的運算式求值，不是看註解）',
      evalBusy(true, m.busy, m.queue, QMAX) === false);
    await m.dispatch({ type: 'play-basic', iid: 'p1' });
    ok('★★★重送期間的新手勢**被收下**排進佇列（v6.171 是丟掉 + 一行紅字）', m.queue.length === 1,
      JSON.stringify(m.queue));
    ok('★★★而且畫面上講得出來（絕不靜默）', /已排隊/.test(m.notice), m.notice);
    m.cancel();
  }
  // ── ②-2 核心②：不會重複套用 —— 單發鎖仍在、每個手勢自己的 actId ──────
  {
    let n = 0;
    const { m, log } = build2(async (i, body) => {
      n++;
      if (body.action.type === 'A' && n < 3) return netErr();       // 前兩發逾時
      return netOk(n);
    });
    m.dispatch({ type: 'A' });
    await sleep(40);
    await m.dispatch({ type: 'B' });
    ok('★B 已排隊', m.queue.length === 1);
    await sleep(2600);
    const aIds = log.sent.filter((b) => b.action.type === 'A').map((b) => b.actId);
    const bIds = log.sent.filter((b) => b.action.type === 'B').map((b) => b.actId);
    ok('★★★A 的所有重送 attempt 共用**同一個** actId（換了鍵冪等就完全失效）',
      aIds.length >= 2 && aIds.every((x) => x === aIds[0]), JSON.stringify(aIds));
    ok('★★★B 拿到**自己的** actId（與 A 不同）—— 共用鍵會被伺服器誤判成重複而**吞掉**（動作遺失）',
      bIds.length === 1 && bIds[0] !== aIds[0], JSON.stringify(bIds));
    ok('★★★全程網路上同時只有一個 /action 在途 ⇒ 伺服器不可能亂序套用',
      log.maxConcurrent === 1, String(log.maxConcurrent));
    ok('★★★A 成功之後 B 才被送出（嚴格照玩家做的順序）',
      log.sent.map((b) => b.action.type).join('') === 'AAAB', log.sent.map((b) => b.action.type).join(''));
    ok('★★佇列排空後解鎖', m.busy === false && m.queue.length === 0);
  }
  // ── ②-3 核心③：被擋下的手勢絕不靜默消失 ────────────────────────────
  {
    const { m } = build2(async () => netErr());
    m.dispatch({ type: 'A' });
    await sleep(20);
    for (let k = 0; k < QMAX; k++) await m.dispatch({ type: 'Q' + k });
    ok('★佇列填滿', m.queue.length === QMAX);
    ok('★★★佇列滿了 ⇒ actionBusy 變 true（這時才真的擋）', evalBusy(true, m.busy, m.queue, QMAX) === true);
    await m.dispatch({ type: 'OVERFLOW' });
    ok('★★★滿了之後的手勢沒有被收下，但**畫面明講「沒有生效」**（靜默丟棄是最糟的）',
      m.queue.length === QMAX && /沒有生效/.test(m.notice), m.notice);
    m.cancel();
    ok('★★★按「停止重送」⇒ 排隊中的動作一併取消，而且說得出「沒有送出、請以畫面為準重做」',
      m.queue.length === 0 && /已取消/.test(m.notice) && /沒有送出/.test(m.notice), m.notice);
  }
  // ── ②-4 同一個手勢連點不會排兩份（否則等於幫玩家送兩次）──────────────
  {
    const { m } = build2(async () => netErr());
    m.dispatch({ type: 'END_TURN' });
    await sleep(20);
    await m.dispatch({ type: 'END_TURN' });
    ok('★★★連點同一個動作 ⇒ **不排第二份**，並明講「不會重複送出」',
      m.queue.length === 0 && /不會重複送出/.test(m.notice), m.notice);
    await m.dispatch({ type: 'X' });
    await m.dispatch({ type: 'X' });
    ok('★★佇列裡已有的同一個動作也不會再排一份', m.queue.length === 1, JSON.stringify(m.queue));
    m.cancel();
  }
  // ── ②-5 前一個動作最終失敗 ⇒ 佇列丟棄並說明（不可以照送）──────────────
  {
    const { m, log } = build2(async () => netErr(), { windowMs: 900 });
    m.dispatch({ type: 'A' });
    await sleep(30);
    await m.dispatch({ type: 'B' });
    await sleep(3500);
    ok('★★★前一個動作送不出去、畫面已還原 ⇒ 排在後面的手勢**不照送**（它是依據已被還原的盤面做的）',
      log.sent.every((b) => b.action.type === 'A'), log.sent.map((b) => b.action.type).join(''));
    ok('★★★而且有講清楚那些動作沒有送出', /已取消/.test(m.notice) && /沒有送出/.test(m.notice), m.notice);
    ok('★★最終一定解鎖（UI 不會永久鎖死）', m.busy === false && m.queue.length === 0);
  }
  // ── ②-6 對局已結束 ⇒ 佇列不再送出去 ─────────────────────────────────
  {
    let sent = 0;
    const { m } = build2(async (i, body) => { sent++; if (body.action.type === 'A') return netOk(1); return netOk(2); });
    // A 在途時排一個 B，A 回來時盤面已是 game-over
    const netGameOver = async () => ({ gameState: { phase: 'game-over' }, version: 9 });
    const { m: m2, log: log2 } = build2(async (i, body) => (body.action.type === 'A' ? netGameOver() : netOk(2)));
    const p = m2.dispatch({ type: 'A' });
    await m2.dispatch({ type: 'B' });
    await p;
    await sleep(50);
    ok('★★★對局已結束（判負／投降／時限）⇒ 排隊中的動作不再送出，並顯示已取消',
      log2.sent.every((b) => b.action.type === 'A') && /已取消/.test(m2.notice), m2.notice);
    void m; void sent;
  }
  // ── ②-7 沒有動作在途時，dispatch 一律直送（正常路徑完全沒變慢）────────
  {
    const { m, log } = build2(async () => netOk(1));
    await m.dispatch({ type: 'A' });
    ok('★★正常情況（沒有東西在途）⇒ 直接送出，不經過佇列', log.sent.length === 1 && m.queue.length === 0);
    ok('★★正常情況不會跳任何提示（不吵）', m.notice === '', m.notice);
  }
  // ── ②-8【Fable 5 審查】伺服器「沒有套用」⇒ 佇列不可以照送 ─────────────
  {
    const { m, log } = build2(async (i, body) => (body.action.type === 'A'
      ? { error: '動作無效：測試', gameState: { phase: 'playing', n: 1 }, version: 2 }
      : { gameState: { phase: 'playing', n: 2 }, version: 3 }));
    const p = m.dispatch({ type: 'A' });
    await m.dispatch({ type: 'END_TURN' });
    await p; await sleep(40);
    ok('★★★伺服器回 error（那一發根本沒套用）⇒ 排在後面的手勢**不照送**（最糟是自動結束回合被送出去）',
      log.sent.every((x) => x.action.type === 'A') && m.queue.length === 0,
      log.sent.map((x) => x.action.type).join(''));
    ok('★★★而且講清楚那些動作沒有送出', /已取消/.test(m.notice) && /沒有送出/.test(m.notice), m.notice);
  }
  {
    const { m, log } = build2(async (i, body) => (body.action.type === 'A'
      ? { rejected: true, gameState: { phase: 'playing', n: 1 }, version: 2 }
      : { gameState: { phase: 'playing', n: 2 }, version: 3 }));
    const p = m.dispatch({ type: 'A' });
    await m.dispatch({ type: 'B' });
    await p; await sleep(40);
    ok('★★★伺服器回 rejected（引擎拒絕／stale 用完預算）⇒ 同樣不放行佇列',
      log.sent.every((x) => x.action.type === 'A') && m.queue.length === 0);
  }
  {
    const { m, log } = build2(async () => ({ duplicate: true, gameState: { phase: 'playing', n: 1 }, version: 2 }));
    const p = m.dispatch({ type: 'A' });
    await m.dispatch({ type: 'B' });
    await p; await sleep(60);
    ok('★★★duplicate（重送被伺服器認出來）**不算沒套用** ⇒ 佇列照常放行，動作不會遺失',
      log.sent.map((x) => x.action.type).join('') === 'AB', log.sent.map((x) => x.action.type).join(''));
  }
  // ── ②-9【Fable 5 審查】離開對戰 ⇒ 在途動作＋佇列一律作廢 ───────────────
  {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { m, log } = build2(async () => { await gate; return { gameState: { phase: 'playing', n: 99 }, version: 9 }; });
    const p = m.dispatch({ type: 'A' });
    await m.dispatch({ type: 'B' });
    ok('★在途 1 個、排隊 1 個', m.queue.length === 1);
    const before = m.game;
    m.abort('已離開對戰');
    ok('★★★離開對戰 ⇒ 佇列清空、旗標放掉', m.queue.length === 0 && m.busy === false);
    release(); await p; await sleep(60);
    ok('★★★在途那一發回來時**不會 tAdopt**（否則會把盤面／tStep 復活，讓舊手勢打進下一場）',
      m.game === before, JSON.stringify(m.game));
    ok('★★★而且排隊中的手勢絕不會事後偷送出去', log.sent.length === 1, log.sent.map((x) => x.action.type).join(''));
  }
  // ── ②-10 已經離開對戰時，drain 自己也要擋 ───────────────────────────────
  {
    const { m, log } = build2(async () => ({ gameState: { phase: 'playing', n: 1 }, version: 2 }));
    const p = m.dispatch({ type: 'A' });
    await m.dispatch({ type: 'B' });
    m.setStep('lobby');
    await p; await sleep(60);
    ok('★★★drain 自己也有「已離開對戰」防線（tStep 不是 playing 就整批丟棄）',
      log.sent.length === 1 && m.queue.length === 0, log.sent.map((x) => x.action.type).join(''));
  }
  ok('★★★三條離開路徑都有呼叫 tActAbortAll（只清佇列不夠 —— 在途回應會 tAdopt 把盤面復活）',
    /tActAbortAll\('已離開對戰'\)/.test(PAGE) && /tActAbortAll\('已離開觀戰'\)/.test(PAGE)
    && /tActAbortAll\('房間已重置'\)/.test(PAGE));
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('③ 手牌拖曳：模板裡那一行 handler **本人**被執行（不是驗原始碼有這行字）');
// ══════════════════════════════════════════════════════════════════════════
try {
  const line = PAGE.split('\n').find((l) => l.includes('onpointerdown={(e)=>{leaveHandCard()'));
  ok('★抓得到手牌的 onpointerdown', !!line);
  const body = line.trim().slice('onpointerdown={'.length, -1);
  const mk = () => {
    const calls = { drag: 0, say: [] };
    const fn = new Function('leaveHandCard', 'dragKind', 'actionBusy', 'startDrag', 'tActSay',
      'TACT_BLOCKED_MSG', 'inst', 'c', 'return (' + body + ');');
    return { calls, run: (busy) => fn(() => {}, 'energy', busy, () => { calls.drag++; },
      (msg) => calls.say.push(msg), '⚠ 佇列已滿：這一下沒有生效', {}, {})({}) };
  };
  const a = mk(); a.run(false);
  ok('★★★動作在途但佇列沒滿（actionBusy=false）⇒ 拖曳**真的啟動**（v6.171 這裡是靜默丟棄）',
    a.calls.drag === 1 && a.calls.say.length === 0);
  const b = mk(); b.run(true);
  ok('★★★真的擋下來時，不啟動拖曳、但**一定告訴玩家**（絕不靜默 return）',
    b.calls.drag === 0 && b.calls.say.length === 1, JSON.stringify(b.calls));
  // 變異對照：v6.171 的寫法
  const oldFn = new Function('leaveHandCard', 'dragKind', 'actionBusy', 'startDrag', 'tActSay', 'inst', 'c',
    'return ((e)=>{leaveHandCard(); if(dragKind && !actionBusy)startDrag(e, inst, dragKind, c);});');
  let oldDrag = 0, oldSay = 0;
  oldFn(() => {}, 'energy', true, () => { oldDrag++; }, () => { oldSay++; }, {}, {})({});
  ok('★掃描器自我驗證：v6.171 的舊寫法被擋時**既不拖曳也不出聲**（＝這條斷言真的有鑑別度）',
    oldDrag === 0 && oldSay === 0);

  // 全檔掃描：不可以再有「靜默 return」的 actionBusy gate（自動計時器例外，它會自己再排）
  const allLines = PAGE.split('\n');
  const bareIdx = allLines.map((l, i) => (/if \(actionBusy\) return;/.test(l) ? i : -1)).filter((i) => i >= 0);
  // 每一處都要在上下 5 行內講明「這是自動計時器、不是玩家手勢」——
  // 玩家手勢一律不可以靜默 return（要嘛排隊、要嘛 tActSay 講出來）。
  ok('★★★全檔**沒有任何**「靜默 return」的 actionBusy gate（玩家手勢一律要嘛排隊、要嘛講出來）',
    bareIdx.length === 0, JSON.stringify(bareIdx));
  // ⭐⭐【Fable 5 審查】兩個自動計時器必須守 actionSending 而不是 actionBusy：
  //   actionBusy 的語義已改成「佇列已滿」，繼續守它 ⇒ 自動動作也會被排進佇列，
  //   最糟是自動結束回合在網路恢復後被補送出去（玩家還沒攻擊就換手）。
  const autoIdx = allLines.map((l, i) => (/if \(actionSending\) return;/.test(l) ? i : -1)).filter((i) => i >= 0);
  const autoOk = autoIdx.every((i) => /自動|計時器/.test(allLines.slice(Math.max(0, i - 6), i + 1).join('\n')));
  ok('★★★兩個自動計時器（自動取獎／自動結束回合）改守 actionSending，且都註明是自動計時器',
    autoIdx.length === 2 && autoOk, JSON.stringify(autoIdx));
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('④ 失聯判準：單一中央述詞（**求值**：長輪詢掛起不算失聯、真斷線仍要跳）');
// ══════════════════════════════════════════════════════════════════════════
let evalConn = null;
try {
  const e1 = grabDerived(PAGE, 'tConnStaleMs');
  const e2 = grabDerived(PAGE, 'tOfflineSec');
  const e3 = grabDerived(PAGE, 'tNetBannerOn');
  ok('★三個述詞都抽得到', !!e1 && !!e2 && !!e3);
  const LPTO = num(PAGE, 'T_LP_CLIENT_TIMEOUT_MS');
  const BSEC = num(PAGE, 'T_OFFLINE_BANNER_SEC');
  ok('★★長輪詢 client 逾時與橫幅門檻都是具名常數（不是散落的字面量）',
    LPTO === 30000 && BSEC === 10, LPTO + '/' + BSEC);
  ok('★★★輪詢真的用同一個常數當 timeoutMs（寫死 30000 會與掛起窗漂移）',
    /timeoutMs: T_LP_CLIENT_TIMEOUT_MS/.test(PAGE));

  const src = `
    function __conn(env) {
      const { isTournament, tStep, game, isTournSpectator, tNow, tClockOffset,
        _tLastServerOkAt, _tLpHangUntil, _tNetBannerDismissAt, _tActionAuthErr, _tActionAuthErrAt } = env;
      const T_OFFLINE_BANNER_SEC = ${BSEC};
      const tConnStaleMs = ${e1};
      const tOfflineSec = ${e2};
      const tNetBannerOn = ${e3};
      return { tConnStaleMs, tOfflineSec, tNetBannerOn };
    }
    return __conn;
  `;
  const js = (await transform(src, { loader: 'ts' })).code;
  evalConn = new Function(js)();

  const T0 = 1_000_000_000;
  const base = { isTournament: true, tStep: 'playing', game: { phase: 'playing' }, isTournSpectator: false,
    tClockOffset: 0, _tLastServerOkAt: T0, _tLpHangUntil: 0, _tNetBannerDismissAt: 0,
    _tActionAuthErr: false, _tActionAuthErrAt: 0 };

  // ④-1【核心④】長輪詢掛起期間 —— 伺服器 by design 掛住，不可以算失聯
  {
    const env = { ...base, _tLpHangUntil: T0 + LPTO, tNow: T0 + 25000 };
    const r = evalConn(env);
    ok('★★★長輪詢掛起 25 秒（伺服器 by design）⇒ 失聯秒數 0、橫幅不跳',
      r.tOfflineSec === 0 && r.tNetBannerOn === false, JSON.stringify(r));
    const r2 = evalConn({ ...env, tNow: T0 + 29999 });
    ok('★★★掛起窗到期前的最後一刻仍然不跳（門檻與 client 逾時對齊，不會差幾秒就誤報）',
      r2.tOfflineSec === 0 && r2.tNetBannerOn === false);
  }
  // ④-1b 變異對照：v6.171 的舊式子在同一情境會誤報
  {
    const oldSec = Math.max(0, Math.floor(((T0 + 25000) - T0) / 1000));
    ok('★★★掃描器自我驗證：v6.171 的舊式子在同一情境算出 25 秒 ⇒ 橫幅常駐（就是玩家回報的誤報）',
      oldSec === 25 && oldSec >= BSEC);
  }
  // ④-2【核心⑥ 正對照】真的斷線 —— 橫幅仍然要跳
  {
    // (a) 掛起窗已過期、還沒被 finally 清掉
    const a = evalConn({ ...base, _tLpHangUntil: T0 + LPTO, tNow: T0 + LPTO + 12000 });
    ok('★★★真的斷線（掛起窗過期後又 12 秒沒有任何回應）⇒ 橫幅照跳',
      a.tOfflineSec >= BSEC && a.tNetBannerOn === true, JSON.stringify(a));
    // (b) 長輪詢逾時 → finally 清掉掛起窗 ⇒ 立刻從「上次成功往返」起算
    const b = evalConn({ ...base, _tLpHangUntil: 0, tNow: T0 + LPTO });
    ok('★★★長輪詢逾時後掛起窗歸零 ⇒ 秒數立刻 =30、橫幅**馬上**跳（比 v6.171 更早發現斷線）',
      b.tOfflineSec === 30 && b.tNetBannerOn === true, JSON.stringify(b));
    // (c) 短輪詢模式（站長把長輪詢關掉）行為與過去一致
    const c = evalConn({ ...base, _tLpHangUntil: 0, tNow: T0 + 12000 });
    ok('★★★長輪詢關閉時（掛起窗恆為 0）⇒ 12 秒沒回應照樣跳，行為與過去一致',
      c.tOfflineSec === 12 && c.tNetBannerOn === true);
  }
  // ④-2b【Fable 5 審查】長輪詢「黑洞式斷線」：掛起窗會壓住橫幅最長 30 秒 ⇒ 探針把偵測補回來
  {
    ok('★★★有長輪詢黑洞探針（12 秒沒有任何成功往返就送一發便宜的 /state）',
      /const T_CONN_PROBE_AFTER_MS = 12000;/.test(PAGE) && /const T_CONN_PROBE_THROTTLE_MS = 15000;/.test(PAGE)
      && /_tConnProbeAt = Date\.now\(\);/.test(PAGE));
    ok('★★★探針帶目前版本（精簡 unchanged 回應），**不是** v=-1 全量 —— v6.155 的教訓',
      /await tApi\(`\/state\?room=\$\{tActiveRoom\}&v=\$\{tVersion\}`, undefined, \{ timeoutMs: 5000 \}\);/.test(PAGE));
    ok('★★★探針失敗 ⇒ 撤銷掛起窗（否則黑洞斷線要 30 秒才看得到橫幅）',
      /catch \{ _tLpHangUntil = 0; \}/.test(PAGE));
    const envHang = { ...base, _tLpHangUntil: T0 + LPTO, tNow: T0 + 17000 };
    ok('★★★（探針失敗前）掛起窗還在 ⇒ 不亮', evalConn(envHang).tNetBannerOn === false);
    ok('★★★（探針失敗後）掛起窗撤銷 ⇒ 同一秒立刻亮，約 17 秒就發現黑洞斷線',
      evalConn({ ...envHang, _tLpHangUntil: 0 }).tNetBannerOn === true);
  }
  // ④-3 掛起窗真的有被 finally 關掉（否則正對照失效）
  ok('★★★長輪詢送出時開掛起窗、finally 一定關掉（不關 ⇒ 真斷線也不會跳＝修成永遠不跳）',
    /_tLpHangUntil = Date\.now\(\) \+ T_LP_CLIENT_TIMEOUT_MS/.test(PAGE)
    && /finally \{ _pollBusy = false; _tLongPollAt = 0; _tLpHangUntil = 0; \}/.test(PAGE));
  // ④-4 其他 gate 不變（觀戰／大廳／對局結束不跳）
  {
    ok('★觀戰者不跳', evalConn({ ...base, isTournSpectator: true, _tLpHangUntil: 0, tNow: T0 + 99000 }).tOfflineSec === 0);
    ok('★對局已結束不跳', evalConn({ ...base, game: { phase: 'game-over' }, _tLpHangUntil: 0, tNow: T0 + 99000 }).tOfflineSec === 0);
    ok('★還沒有過任何一次成功往返（剛進場）不跳',
      evalConn({ ...base, _tLastServerOkAt: 0, _tLpHangUntil: 0, tNow: T0 + 99000 }).tOfflineSec === 0);
  }
  // ④-5 伺服器時鐘偏移不可以被算成失聯
  {
    const r = evalConn({ ...base, tClockOffset: 40000, _tLpHangUntil: 0, tNow: T0 + 40000 + 2000 });
    ok('★★伺服器時鐘比本機快 40 秒 ⇒ 失聯秒數仍是 2（舊式子會算成 42 秒＝直接誤報）',
      r.tOfflineSec === 2 && r.tNetBannerOn === false, JSON.stringify(r));
  }
  // ④-6 判準只有一份
  const codeLines = PAGE.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });
  ok('★★★「失聯秒數」只有一份定義（舊式子 `tNow - _tLastPollOkAt` 只剩註解裡的說明，程式碼一處都沒有）',
    codeLines.filter((l) => l.includes('tNow - _tLastPollOkAt')).length === 0
    && (PAGE.match(/const tOfflineSec = \$derived/g) || []).length === 1);
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('⑤ 連線健康的**唯一寫入點**：成功的 POST /action 真的會讓橫幅收掉（實跑 tApi）');
// ══════════════════════════════════════════════════════════════════════════
try {
  const src = [grabFn(PAGE, '_tMarkServerAlive'), grabFn(PAGE, 'tApi')].join('\n');
  ok('★tApi 與 _tMarkServerAlive 都抽得到', /function _tMarkServerAlive/.test(src) && /function tApi/.test(src));
  const out = await transform(src, { loader: 'ts' });
  function mk(fetchImpl) {
    const pre = `
      let _tLastServerOkAt = 0;
      const T_API = 'https://x/api/tournament';
      const _pnow = () => Date.now();
      const _tRecordApiSegments = () => {};
      // ⭐v6.179 tApi 多了「開一個 fetch 時間窗」的量測呼叫（回 null ＝ 這台機器不對齊）。
      //   本節只驗連線健康錨點，對齊行為由 test-v6179 守。
      const _tResWinOpen = () => null;
      const firebaseUser = null;
      const fetch = __fetch;
    `;
    return new Function('__fetch', pre + out.code
      + '; return { tApi, get alive() { return _tLastServerOkAt; } };')(fetchImpl);
  }
  const okFetch = async () => ({ ok: true, text: async () => '{"gameState":{"phase":"playing"},"version":3}' });
  const A = mk(okFetch);
  ok('★起始狀態：還沒有任何成功往返', A.alive === 0);
  await A.tApi('/action', { room: 'R', action: { type: 'attach' }, actId: 'a1' });
  ok('★★★成功的 POST /action ⇒ 連線健康錨點**真的前進了**（v6.171 只有 /state 會動它）',
    A.alive > 0, String(A.alive));

  // 接起來：動作成功之後，橫幅必須是關的（這才是玩家看得到的那件事）
  if (evalConn) {
    const now = A.alive + 3000;
    const r = evalConn({ isTournament: true, tStep: 'playing', game: { phase: 'playing' },
      isTournSpectator: false, tNow: now, tClockOffset: 0,
      _tLastServerOkAt: A.alive, _tLpHangUntil: 0, _tNetBannerDismissAt: 0,
      _tActionAuthErr: false, _tActionAuthErrAt: 0 });
    ok('★★★動作往返成功之後 3 秒 ⇒ 橫幅是關的（「動作全部成功卻說失聯」不會再發生）',
      r.tOfflineSec === 3 && r.tNetBannerOn === false, JSON.stringify(r));
    // 變異對照：舊錨點（只有輪詢會動）在同一情境
    const oldAnchor = A.alive - 40000;   // 上次輪詢是 40 秒前（長輪詢掛著）
    const r2 = evalConn({ isTournament: true, tStep: 'playing', game: { phase: 'playing' },
      isTournSpectator: false, tNow: now, tClockOffset: 0,
      _tLastServerOkAt: oldAnchor, _tLpHangUntil: 0, _tNetBannerDismissAt: 0,
      _tActionAuthErr: false, _tActionAuthErrAt: 0 });
    ok('★掃描器自我驗證：若錨點沒有被動作往返推進（v6.171 的情況）⇒ 橫幅就會跳', r2.tNetBannerOn === true);
  }
  // 失敗的往返不可以算存活
  const B = mk(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
  try { await B.tApi('/action', { a: 1 }); } catch { /* expected */ }
  ok('★★★伺服器回 5xx（或 401/403）**不算**連線健康（否則真出事會被自己安撫掉）', B.alive === 0);

  ok('★★★連線健康只有一個寫入點（全檔 `_tMarkServerAlive()` 只被呼叫 1 次，就在 tApi 成功出口）',
    (PAGE.match(/_tMarkServerAlive\(\);/g) || []).length === 1);
  ok('★★`_tLastPollOkAt` 的語義刻意沒動（仍只給「輪詢停擺看門狗」用 —— 若被任何成功往返推進，看門狗就再也偵測不到輪詢 timer 死掉）',
    /\*\*只給輪詢停擺看門狗用\*\*/.test(PAGE) && /_tLastPollOkAt = Date\.now\(\);/.test(PAGE));
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('⑥ 接線：模板／子元件真的接上了（編譯產物，不是原始檔有這行字）');
// ══════════════════════════════════════════════════════════════════════════
try {
  const js = compile(PAGE, { filename: '+page.svelte', generate: 'client' }).js.code;
  ok('★★★排隊橫幅真的編譯進 render 程式碼（不是躺在註解裡）', js.includes('已排隊'));
  ok('★★★「剛剛那一下怎麼了」的說明也編譯進 render 程式碼', js.includes('tActNotice'));
  const mobIdx = PAGE.indexOf('{#if isPortraitMobile && game}');
  ok('★★兩則都在 isPortraitMobile 分支**之外**（否則手機直式玩家看不到 —— v6.149 的教訓）',
    mobIdx > 0 && PAGE.indexOf('act-queue-banner') > 0 && PAGE.indexOf('act-notice-banner') > 0
    && PAGE.indexOf('act-queue-banner') < mobIdx && PAGE.indexOf('act-notice-banner') < mobIdx);
  ok('★★★手機直式收得到「送出中／已排隊」（v6.172 前它綁的是 actionBusy，會跟著一起消失）',
    /actionSending=\{actionSending\}/.test(PAGE) && /actionQueued=\{tActQueue\.length\}/.test(PAGE)
    && /actionSending\?: boolean;/.test(MOB) && /actionQueued\?: number;/.test(MOB)
    && /\{#if actionSending\}/.test(MOB) && /\{#if actionQueued\}/.test(MOB));
  const mjs = compile(MOB, { filename: 'MobilePortraitBattle.svelte', generate: 'client' }).js.code;
  ok('★★手機直式的「已排隊」真的編譯進 render 程式碼', mjs.includes('已排隊'));
  ok('★★桌機的 ⏳ 送出中改綁 actionSending（綁 actionBusy 的話「在送出」時反而看不到提示）',
    /\{#if actionSending\}<span class="chip syncing-chip">/.test(PAGE));
  ok('★★舊的「丟掉手勢 + 一行紅字」單發路徑已移除（不可與佇列並存）',
    !/tError = '上一個動作還在送出中/.test(PAGE)
    && /tActQueue = \[\.\.\.tActQueue, \{ action, sig: _sig \}\];/.test(PAGE));
  const ver = /export const VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'));
  const hint = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(ADMIN);
  ok('★版本已 bump（≥ 6.172）且 admin 對照值一致',
    !!ver && !!hint && ver[1] === hint[1] && parseFloat(ver[1]) >= 6.172, (ver && ver[1]) + '/' + (hint && hint[1]));
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

console.log('\nv6.172 動作佇列＋連線健康守衛：' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
