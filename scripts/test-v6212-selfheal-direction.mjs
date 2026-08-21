#!/usr/bin/env node
/**
 * v6.212 守衛：①休閒線上「跳回上一手」的自癒方向 ②輪詢版本閘單調
 *                ③賽程 game-over 對帳（level-triggered）
 *
 * ── 這一版在修什麼 ────────────────────────────────────────────────────────
 * A. `pushGameState` 失敗只 console.error、不重試（+page.svelte BASE:6552-6555）
 *    ⇒ 伺服器停在攻擊前、本地領先 ⇒ isWaitingOnOpponent 為真 ⇒ 25 秒後
 *    `_forceAdoptNext = true`（BASE:7527）⇒ handleRoomUpdate（BASE:7685）**繞過全部
 *    stale 守衛**直接採用伺服器那份 ＝ 玩家看到回合被退回攻擊前。
 *    v5.587 的註解假設「我方沒有未推送的手」，在 push 失敗／在途時不成立。
 *    ⇒ 方向反過來：本地領先時**先重推**，重推仍卡住（或達上限）才 force-adopt。
 * B. 輪詢版本閘是 `!==` 不是 `>`（oracle-client BASE:257）⇒ 較舊的 _version 照樣遞送。
 * C. `/action` 的 onMatchGameOver 拋錯被吞掉（server_admin_patch BASE:3914，edge-triggered）
 *    ⇒ TMATCH 永遠停在 playing ⇒ /event（BASE:4275 用 status:{$ne:'done'} 濾）一直回傳
 *    myMatch ⇒ 大廳一直畫「回到對戰」，下一輪也排不出來。
 *    ⇒ 閒置掃描加 level-triggered 對帳，補跑一次 onMatchGameOver。
 *
 * ── 哪些是真的 HEAD-FAIL ──────────────────────────────────────────────────
 *   [HEAD-FAIL] 標記的條目：還原成 v6.211 重跑會 FAIL。
 *   [自我驗證] / [正對照] 是用來證明「這些斷言不是恆真式、抓得到東西」的。
 *   第 2 節是**行為端模擬**：用真的純函式串起 push→自癒→收端，直接看盤面有沒有回捲；
 *   並且同一支模擬用 oldBehavior 跑一次證明它**真的抓得到**那個 bug
 *   （不然就是 placebo —— 一支永遠綠的模擬什麼都證明不了）。
 *
 * Run: node scripts/test-v6212-selfheal-direction.mjs
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const GP = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══════════════════════════════════════════════════════════════════════════
// 0. 保長度的註解剝除器（沿用 v6.157 的做法）＋ 它自己的自我驗證
//    ⚠ 否定型斷言（「不存在某 pattern」）若沒剝註解，註解裡的字面量會讓它誤判。
// ══════════════════════════════════════════════════════════════════════════
function stripJs(s, mode = 'comments') {
  const out = s.split('');
  const wipeStrings = mode === 'all';
  const n = s.length;
  let i = 0, prev = '';
  const REGEX_PREV = '(,=:[!&|?{};+-*%~^<>';
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && s[i + 1] === '*') {
      let j = i + 2;
      while (j + 1 < n && !(s[j] === '*' && s[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      for (let k = i; k < j; k++) if (s[k] !== '\n') out[k] = ' ';
      i = j; continue;
    }
    if (c === '/' && REGEX_PREV.includes(prev)) {
      let j = i + 1, ok = false;
      while (j < n) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '\n') break;
        if (s[j] === '/') { ok = true; break; }
        j++;
      }
      if (ok) { for (let k = i; k <= j; k++) out[k] = ' '; i = j + 1; prev = '/'; continue; }
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1;
      while (j < n) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === q) break; j++; }
      if (wipeStrings) for (let k = i + 1; k < Math.min(j, n); k++) if (s[k] !== '\n') out[k] = '.';
      i = Math.min(j, n - 1) + 1; prev = '"'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}
T('[自我驗證] 剝除器：行註解裡的假錨點被剝掉、真程式碼留著', () => {
  assert.ok(!stripJs('// onMatchGameOver(x)\nREAL').includes('onMatchGameOver'));
  assert.ok(stripJs('// onMatchGameOver(x)\nREAL').includes('REAL'));
  assert.ok(!stripJs('a/*\nonMatchGameOver(\n*/b').includes('onMatchGameOver'));
  assert.ok(stripJs("s='http://z'; REAL2").includes('REAL2'));
});
T('[自我驗證] 剝除器：保長度（位置關係斷言的前提）', () => {
  assert.equal(stripJs(SRC).length, SRC.length);
  assert.equal(stripJs(SRC, 'all').length, SRC.length);
  assert.equal(stripJs(GP).length, GP.length);
});
const S = stripJs(SRC);
const SALL = stripJs(SRC, 'all');
const G = stripJs(GP);
T('[自我驗證/正對照] 剝除後既有真程式碼仍在（不是把檔案剝爆）', () => {
  for (const a of ['async function onMatchGameOver(doc, gs) {', 'function currentActorSeat(gs) {', 'async function maybeIdleWarn60(']) {
    assert.ok(S.includes(a), '剝除後找不到: ' + a);
  }
  assert.ok(G.includes('function isWaitingOnOpponent('), '+page.svelte 剝爆了');
  assert.ok(S.length > SRC.length * 0.5 && G.length > GP.length * 0.5);
});

// ══════════════════════════════════════════════════════════════════════════
// 1. 純函式：decideStuckSelfHeal / shouldDeliverRoomPoll
// ══════════════════════════════════════════════════════════════════════════
const SHIM = join(ROOT, '.x-v6212-shim.mjs');
const ENTRY = join(ROOT, '.x-v6212-entry.ts');
const OUT = join(ROOT, '.x-v6212-out.mjs');
process.on('exit', () => { for (const p of [SHIM, ENTRY, OUT]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY,
  "export { shouldSkipStalePush, resolveRoomUpdate, decideStuckSelfHeal } from './src/lib/game/sync-guards';\n"
  + "export { shouldDeliverRoomPoll } from './src/lib/game/oracle-client';");
await build({ entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': SHIM }, logLevel: 'error' });
const { shouldSkipStalePush, resolveRoomUpdate, decideStuckSelfHeal, shouldDeliverRoomPoll } =
  await import(pathToFileURL(OUT).href);

T('[HEAD-FAIL①a] 本地有未推送的手 ⇒ 先重推（不是 force-adopt）', () => {
  assert.deepEqual(decideStuckSelfHeal({ hasUnpushedLocal: true, repushAttempts: 0 }), { kind: 'repush' });
  assert.deepEqual(decideStuckSelfHeal({ hasUnpushedLocal: true, repushAttempts: 1 }), { kind: 'repush' });
});
T('[HEAD-FAIL①b/正對照②] 本地沒有未推送的手 ⇒ 照舊 force-adopt（自癒不可被改成永遠不自癒）', () => {
  assert.deepEqual(decideStuckSelfHeal({ hasUnpushedLocal: false, repushAttempts: 0 }), { kind: 'force-adopt' });
});
T('[HEAD-FAIL①c] 重推有上限：達上限後交還 force-adopt（否則伺服器合法拒收時會永遠不同步）', () => {
  assert.deepEqual(decideStuckSelfHeal({ hasUnpushedLocal: true, repushAttempts: 2 }), { kind: 'force-adopt' });
  assert.deepEqual(decideStuckSelfHeal({ hasUnpushedLocal: true, repushAttempts: 9 }), { kind: 'force-adopt' });
  assert.deepEqual(decideStuckSelfHeal({ hasUnpushedLocal: true, repushAttempts: 0, maxRepushAttempts: 0 }), { kind: 'force-adopt' });
});
T('[HEAD-FAIL③a] 輪詢版本閘單調：較舊 _version 不遞送、較新照常', () => {
  const last = { version: 10, createdAt: 1000 };
  assert.equal(shouldDeliverRoomPoll({ _version: 9, createdAt: 1000 }, last), false, '較舊竟然遞送');
  assert.equal(shouldDeliverRoomPoll({ _version: 10, createdAt: 1000 }, last), false, '同版竟然遞送');
  assert.equal(shouldDeliverRoomPoll({ _version: 11, createdAt: 1000 }, last), true, '較新竟然被擋（會整個不同步）');
});
T('[HEAD-FAIL③b] 房號被刪後重建（_version 從 1 重來）不可被永遠擋掉', () => {
  assert.equal(shouldDeliverRoomPoll({ _version: 1, createdAt: 2000 }, { version: 30, createdAt: 1000 }), true);
  assert.equal(shouldDeliverRoomPoll({ _version: 1, createdAt: 1000 }, { version: -1, createdAt: -1 }), true, '第一次輪詢就被擋');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. ⭐行為端模擬：push 失敗 → 25 秒自癒 → 收端。看盤面到底有沒有回捲。
//    用真的 shouldSkipStalePush / resolveRoomUpdate / decideStuckSelfHeal /
//    shouldDeliverRoomPoll 串起來；oldBehavior=true 時只把「自癒方向」換回 v6.211。
// ══════════════════════════════════════════════════════════════════════════
const clone = (x) => JSON.parse(JSON.stringify(x));
function mkGS(o = {}) {
  return {
    id: o.id ?? 'G1', createdAt: o.createdAt ?? 1000, phase: o.phase ?? 'playing',
    log: Array.from({ length: o.logLen ?? 5 }, (_, i) => ({ msg: 'l' + i })),
    setupDone: [true, true], mulliganRevealConfirmed: [true, true],
    pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, false],
    pendingPrizes: [0, 0], firstPlayerIdx: 0, activePlayerIndex: 0,
    players: [
      { name: 'P0', prizes: Array.from({ length: 6 }, () => ({})), deck: [] },
      { name: 'P1', prizes: Array.from({ length: 6 }, () => ({})), deck: [] },
    ],
  };
}
const CTX = { myPlayerIndex: 0, roomLastUndoApplyAt: 0, lastSeenUndoApplyAt: 0, roomRestartCount: 0, lastAdoptedRestartCount: 0 };

/**
 * @param opts.oldBehavior  true = v6.211 的自癒（無條件 force-adopt）
 * @param opts.netDownForever true = 網路一直不通（重推也會失敗）
 * @param opts.heals        自癒觸發次數
 */
function simulate(opts = {}) {
  const { oldBehavior = false, netDownForever = false, heals = 1 } = opts;
  let server = { gs: mkGS({ logLen: 10 }), version: 5, createdAt: 1000 };
  let local = mkGS({ logLen: 10 });
  let unpushed = null, repushAttempts = 0, forceAdoptNext = false;
  let lastVersion = -1, lastCreatedAt = -1;
  let netDown = true;
  let pushCalls = 0, adoptCalls = 0;

  const doPush = (st) => {
    pushCalls++;
    if (netDown) throw new Error('network');
    if (shouldSkipStalePush(st, server.gs)) return;            // 推端守衛（真的）
    server = { gs: clone(st), version: server.version + 1, createdAt: server.createdAt };
  };
  const pushWithRetry = (st) => {                              // 對應 +page.svelte 的 pushWithRetry
    for (let i = 0; i < 3; i++) {
      try { doPush(st); unpushed = null; repushAttempts = 0; return true; } catch { /* retry */ }
    }
    unpushed = clone(st);
    return false;
  };
  const pollOnce = () => {                                     // 對應 oraclePollRoom + handleRoomUpdate
    const room = { _version: server.version, createdAt: server.createdAt, gameState: server.gs };
    if (!shouldDeliverRoomPoll(room, { version: lastVersion, createdAt: lastCreatedAt })) return;
    lastVersion = room._version; lastCreatedAt = room.createdAt;
    const inc = room.gameState;
    if (forceAdoptNext) {                                      // BASE:7685 的繞閘路徑
      forceAdoptNext = false; adoptCalls++;
      if (inc.phase !== 'setup' && (!local || local.id === inc.id)) { local = clone(inc); return; }
    }
    const d = resolveRoomUpdate(local, inc, CTX);
    if (d.kind === 'adopt' || d.kind === 'apply-undo' || d.kind === 'merge-prize' || d.kind === 'merge-setup') local = clone(d.game);
  };

  // ① 玩家攻擊 → 本地前進到 12 → push 失敗（網路不通）
  local = mkGS({ logLen: 12 });
  pushWithRetry(local);
  // ② 25 秒卡住 → 自癒（可能發生多次）
  for (let h = 0; h < heals; h++) {
    if (!netDownForever) netDown = false;                       // 網路恢復（最常見的 transient）
    if (oldBehavior) {
      forceAdoptNext = true;                                    // ← v6.211：無條件
    } else {
      const a = decideStuckSelfHeal({
        hasUnpushedLocal: !!(unpushed && local && unpushed.id === local.id),
        repushAttempts,
      });
      if (a.kind === 'repush') {
        repushAttempts++;
        try { doPush(unpushed); unpushed = null; repushAttempts = 0; } catch { /* 下一輪再說 */ }
      } else {
        forceAdoptNext = true;
      }
    }
    // ⚠ 真實碼在設完旗標後會 unsubRoom()+subscribeRoom()（+page.svelte 的 8 秒自癒）
    //   ⇒ 換一個全新的 poller，lastVersion 從 -1 重來。模擬必須照做，否則單調閘會讓
    //   force-adopt 永遠等不到 snapshot（那是模擬失真，不是產品行為）。
    lastVersion = -1; lastCreatedAt = -1;
    pollOnce();                                                 // 重訂閱後收到伺服器那份
  }
  return { localLen: local.log.length, serverLen: server.gs.log.length, pushCalls, adoptCalls, unpushed };
}

T('[自我驗證/反對照] 同一支模擬用 v6.211 的自癒方向跑 ⇒ 真的重現回捲（模擬不是 placebo）', () => {
  const r = simulate({ oldBehavior: true });
  assert.equal(r.localLen, 10, '舊行為下本地應被拉回 10（攻擊前），實際 ' + r.localLen);
  assert.equal(r.serverLen, 10, '舊行為下伺服器仍停在 10');
  assert.ok(r.adoptCalls >= 1, '舊行為應走過 force-adopt');
});
T('[HEAD-FAIL②a／核心①] 修好後：push 失敗＋本地領先 ⇒ 先重推，盤面不回捲，伺服器追上', () => {
  const r = simulate({ oldBehavior: false });
  assert.equal(r.localLen, 12, '本地被回捲了（實際 ' + r.localLen + '）');
  assert.equal(r.serverLen, 12, '伺服器沒有被重推追上（實際 ' + r.serverLen + '）');
  assert.equal(r.adoptCalls, 0, '不該走 force-adopt');
});
T('[HEAD-FAIL②b] 網路一直不通：重推失敗也不回捲（本地保住玩家的手）', () => {
  const r = simulate({ oldBehavior: false, netDownForever: true, heals: 1 });
  assert.equal(r.localLen, 12, '重推失敗竟然還是回捲了');
  assert.ok(r.unpushed, '未推送盤面應保留著等下一次重推');
});
T('[正對照②] 重推上限用完後仍會 force-adopt（不會變成永遠不同步）', () => {
  const r = simulate({ oldBehavior: false, netDownForever: true, heals: 4 });
  assert.ok(r.adoptCalls >= 1, '重推上限用完後應交還 force-adopt，實際 adoptCalls=' + r.adoptCalls);
  assert.equal(r.localLen, 10, '交還 force-adopt 後應該真的同步到伺服器那份');
});
T('[正對照②b] 沒有未推送的手時，force-adopt 照舊繞過 stale 守衛完成自癒', () => {
  // 本地 15 / 伺服器 12（伺服器權威），resolveRoomUpdate 會判 stale-snapshot 拒收
  assert.equal(resolveRoomUpdate(mkGS({ logLen: 15 }), mkGS({ logLen: 12 }), CTX).reason, 'stale-snapshot',
    '前提：一般路徑本來就會拒收這種較短的 snapshot');
  const a = decideStuckSelfHeal({ hasUnpushedLocal: false, repushAttempts: 0 });
  assert.equal(a.kind, 'force-adopt', '沒有未推送的手就該照舊 force-adopt');
});
T('[HEAD-FAIL③c／核心③] 收端模擬：較舊 _version 不再被遞送，較新的仍照常', () => {
  const seen = [];
  let lastVersion = -1, lastCreatedAt = -1;
  const feed = (v) => {
    const room = { _version: v, createdAt: 1000 };
    if (shouldDeliverRoomPoll(room, { version: lastVersion, createdAt: lastCreatedAt })) {
      lastVersion = room._version; lastCreatedAt = room.createdAt; seen.push(v);
    }
  };
  [5, 6, 4, 7, 3, 8].forEach(feed);
  assert.deepEqual(seen, [5, 6, 7, 8], '實際遞送序列 ' + JSON.stringify(seen));
  // 反對照：舊的 `!==` 判法會把 4 和 3 也遞送出去
  const seenOld = []; let lv = -1;
  [5, 6, 4, 7, 3, 8].forEach((v) => { if (v !== lv) { lv = v; seenOld.push(v); } });
  assert.deepEqual(seenOld, [5, 6, 4, 7, 3, 8], '反對照失效：舊判法本來就會遞送較舊版本');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. [HEAD-FAIL] +page.svelte 接線 —— 「有寫」不等於「接上了」，用位置關係釘住
// ══════════════════════════════════════════════════════════════════════════
T('[HEAD-FAIL④a] import 了 decideStuckSelfHeal', () => {
  assert.ok(/import\s*\{[^}]*\bdecideStuckSelfHeal\b[^}]*\}\s*from\s*'\$lib\/game\/sync-guards'/.test(G),
    '沒 import ⇒ runtime ReferenceError（TS2304 型的 runtime 炸彈）');
});
T('[HEAD-FAIL④b] dispatch 的 push 路徑改走 pushWithRetry，且舊的「只 console.error 不重試」已消失', () => {
  assert.ok(G.includes('await pushWithRetry(roomCode, newState);'), 'dispatch 沒有改走 pushWithRetry');
  assert.ok(G.includes('async function pushWithRetry('), '沒有定義 pushWithRetry');
  assert.ok(!G.includes("catch (e) { console.error('[Online] push failed:', e); }"),
    '舊的「失敗只印一行就算了」還在');
});
T('[正對照] pushWithRetry 真的會重試（有迴圈 + 上限 + 失敗到底才記錄未推送盤面）', () => {
  const i = G.indexOf('async function pushWithRetry(');
  const body = G.slice(i, i + 1200);
  assert.ok(/for\s*\(let i = 0; i < PUSH_RETRY_MAX; i\+\+\)/.test(body), '沒有重試迴圈');
  assert.ok(/const PUSH_RETRY_MAX = \d+;/.test(G), '沒有重試上限常數');
  assert.ok(/_unpushedState = st;/.test(body), '失敗到底沒有記下「本地領先」的證據');
  assert.ok(/_unpushedState = null;/.test(body), '成功時沒有清掉');
});
// ⚠ marker 寫在註解裡，剝除後就不見了 ⇒ 位置要在**原始字串**找；
//   stripJs 保長度，所以索引可以直接拿去切剝除後的字串。
const B0 = GP.indexOf('v6.212 SELFHEAL DIRECTION BLOCK BEGIN');
const B1 = GP.indexOf('v6.212 SELFHEAL DIRECTION BLOCK END');
T('[HEAD-FAIL④c] 自癒方向區塊可定位', () => { assert.ok(B0 > 0 && B1 > B0, 'B0=' + B0 + ' B1=' + B1); });
function blockRange(str, openIdx) {
  let d = 0;
  for (let k = openIdx; k < str.length; k++) {
    if (str[k] === '{') d++;
    else if (str[k] === '}') { d--; if (d === 0) return [openIdx, k + 1]; }
  }
  return [openIdx, -1];
}
T('[HEAD-FAIL④d] repush 分支內**不得**設 _forceAdoptNext（設了就等於沒修，照樣回捲）', () => {
  const iIf = G.indexOf("if (_healAction.kind === 'repush') {", B0);
  assert.ok(iIf > 0 && iIf < B1, '找不到 repush 分支');
  const [a, b] = blockRange(G, G.indexOf('{', iIf + 30));
  assert.ok(b > a, '切不出 repush 分支區塊');
  const branch = G.slice(a, b);
  assert.ok(!/_forceAdoptNext\s*=\s*true/.test(branch), 'repush 分支裡竟然還設了 _forceAdoptNext');
  assert.ok(/pushGameState\(/.test(branch), 'repush 分支沒有真的重推');
  assert.ok(/_repushAttempts\+\+/.test(branch), 'repush 沒有計次 ⇒ 上限形同虛設、會無限重推');
});
T('[HEAD-FAIL④e] 25 秒之後的 _forceAdoptNext 只剩「決策說 force-adopt」那一條路徑', () => {
  const seg = G.slice(B0, B1);
  const hits = (seg.match(/_forceAdoptNext\s*=\s*true/g) || []).length;
  assert.equal(hits, 1, '區塊內 _forceAdoptNext = true 出現 ' + hits + ' 次（應只在 else 分支一次）');
  assert.ok(/decideStuckSelfHeal\(\{/.test(seg), '沒有呼叫中央決策 ⇒ 判準又被複製一份出去');
  assert.ok(/hasUnpushedLocal:/.test(seg) && /repushAttempts:/.test(seg), '沒有把兩個判準傳進去');
});
T('[正對照] 25 秒門檻與 8 秒重訂閱這兩個既有行為沒被動到', () => {
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 25000/.test(G), '25 秒門檻不見了');
  assert.ok(/\(Date\.now\(\) - _lastSyncAt\) >= 8000/.test(G), '8 秒重訂閱門檻不見了');
  assert.ok(/unsubRoom = subscribeRoom\(roomCode, handleRoomUpdate/.test(G), '重訂閱不見了');
});
T('[HEAD-FAIL④g／審查回饋] 悔棋 rollback 也要清掉未推送殘留', () => {
  // ⚠ 不清的話：push 失敗留下「悔棋前」的快照（log 較長）→ 悔棋套用 → 25 秒自癒把它重推上去。
  //   shouldSkipStalePush 只擋**嚴格較短**的 log ⇒ 擋不住 ⇒ 已經悔掉的那一手被復活。
  const i = G.indexOf("case 'apply-undo':");
  assert.ok(i > 0, '找不到 apply-undo 分支');
  const seg = G.slice(i, G.indexOf("case 'merge-setup':", i));
  assert.ok(seg.length > 100 && seg.length < 3000, 'apply-undo 分支切得不對（' + seg.length + '）');
  assert.ok(/_unpushedState = null/.test(seg), '悔棋沒清 _unpushedState');
  assert.ok(/_repushAttempts = 0/.test(seg), '悔棋沒清 _repushAttempts');
  // 正對照：這條斷言抓得到東西 —— 同樣的判法在 merge-setup 分支不成立
  const seg2 = G.slice(G.indexOf("case 'merge-setup':"), G.indexOf("case 'merge-setup':") + 600);
  assert.ok(!/_unpushedState = null/.test(seg2), '正對照失效：到處都有這行 ⇒ 上面那條等於恆真');
});
T('[HEAD-FAIL④h／審查回饋] 重推額度是「這一次卡住」的額度，且放棄本地時要清乾淨', () => {
  const i = G.indexOf('async function pushWithRetry(');
  const [a, b] = blockRange(G, G.indexOf('{', i + 40));
  const body = G.slice(a, b);
  const iSet = body.indexOf('_unpushedState = st;');
  assert.ok(iSet > 0, '找不到記錄未推送盤面');
  assert.ok(/_repushAttempts = 0;/.test(body.slice(iSet, iSet + 300)),
    '新的一次 push 失敗沒有把重推額度歸零 ⇒ 保護只有第一次卡住有效');
  // force-adopt 分支：放棄本地那份時要一起清掉，免得殘留影響下一次判斷
  const iElse = G.indexOf('} else {', G.indexOf("if (_healAction.kind === 'repush') {", B0));
  const elseSeg = G.slice(iElse, G.indexOf('_forceAdoptNext = true;', iElse) + 40);
  assert.ok(/_unpushedState = null/.test(elseSeg) && /_repushAttempts = 0/.test(elseSeg),
    'force-adopt 分支沒有清掉未推送殘留');
});
T('[HEAD-FAIL④f] 換局時要清掉未推送殘留（否則新局會被誤判成「本地領先」）', () => {
  const i = G.indexOf('if (gid !== _prevGameId) {');
  assert.ok(i > 0);
  const [a, b] = blockRange(G, G.indexOf('{', i + 20));
  const body = G.slice(a, b);
  assert.ok(/_unpushedState = null/.test(body), '換局沒清 _unpushedState');
  assert.ok(/_repushAttempts = 0/.test(body), '換局沒清 _repushAttempts');
});

// ══════════════════════════════════════════════════════════════════════════
// 4. [HEAD-FAIL] 賽程「回到對戰」按鈕保險 —— 抽真函式實跑
// ══════════════════════════════════════════════════════════════════════════
const iFn = GP.indexOf('function tMatchAlreadyDone(brk: any, mm: any): boolean {');
let tMatchAlreadyDone = null;
await TA('[HEAD-FAIL⑤a] tMatchAlreadyDone 存在且可抽出實跑', async () => {
  assert.ok(iFn > 0, '找不到 tMatchAlreadyDone');
  const [a, b] = blockRange(GP, GP.indexOf('{', iFn + 40));
  assert.ok(b > a, '切不出函式本體');
  const { code } = await import('esbuild').then((m) => m.transform(
    'export const f = (' + GP.slice(iFn, b).replace(/^function\s+tMatchAlreadyDone/, 'function') + ');',
    { loader: 'ts', format: 'esm' }));
  const F = join(ROOT, '.x-v6212-fn.mjs');
  writeFileSync(F, code);
  process.on('exit', () => { try { unlinkSync(F); } catch {} });
  ({ f: tMatchAlreadyDone } = await import(pathToFileURL(F).href + '?t=' + Date.now()));
});
T('[HEAD-FAIL⑤b] 賽程表標了「我這輪已完成」⇒ 判 true（按鈕會被藏起來）', () => {
  const brk = { matches: [{ mine: true, round: 3, status: 'done' }, { mine: false, round: 3, status: 'playing' }] };
  assert.equal(tMatchAlreadyDone(brk, { round: 3 }), true);
});
T('[正對照] 這一輪還沒打完 / 是別人的場 / 賽程沒載到 ⇒ 一律照畫按鈕（進場鈕消失會吃未進場判負）', () => {
  assert.equal(tMatchAlreadyDone({ matches: [{ mine: true, round: 3, status: 'playing' }] }, { round: 3 }), false, '進行中竟然被藏');
  assert.equal(tMatchAlreadyDone({ matches: [{ mine: false, round: 3, status: 'done' }] }, { round: 3 }), false, '別人的場不該影響我');
  assert.equal(tMatchAlreadyDone({ matches: [{ mine: true, round: 2, status: 'done' }] }, { round: 3 }), false, '上一輪打完不該藏這一輪');
  assert.equal(tMatchAlreadyDone({ matches: [] }, { round: 3 }), false);
  assert.equal(tMatchAlreadyDone({}, { round: 3 }), false, '賽程沒載到必須照畫');
  assert.equal(tMatchAlreadyDone(null, { round: 3 }), false);
  assert.equal(tMatchAlreadyDone({ matches: [{ mine: true, round: 3, status: 'done' }] }, null), false);
});
T('[HEAD-FAIL⑤c] template 真的接上了（不是寫了一個沒人呼叫的函式）', () => {
  assert.ok(GP.includes("{#if tMyMatch && tMyMatch.eventId === brk.event?._id && !tMatchAlreadyDone(brk, tMyMatch)}"),
    'bracket 內的進場鈕條件沒接上保險');
});
T('[回歸] v5.937 的「賽程沒載到就頂層獨立渲染進場鈕」保底一字未動', () => {
  assert.ok(GP.includes('{#if tMyMatch && !tBrackets.some((b) => b.event?._id === tMyMatch.eventId)}'),
    'v5.937 保底不見了 ⇒ 賽程載不到時進場鈕會消失、直接吃未進場判負');
});

// ══════════════════════════════════════════════════════════════════════════
// 5. [HEAD-FAIL] 伺服器 game-over 對帳 —— 把真程式碼切出來配假 DB 實跑
// ══════════════════════════════════════════════════════════════════════════
const R0 = SRC.indexOf('v6.212 GAMEOVER RECONCILE BLOCK BEGIN');
const R1 = SRC.indexOf('v6.212 GAMEOVER RECONCILE BLOCK END');
T('[HEAD-FAIL⑥a] 對帳區塊可定位', () => { assert.ok(R0 > 0 && R1 > R0, 'R0=' + R0 + ' R1=' + R1); });
const rBeginLine = R0 > 0 ? SRC.lastIndexOf('\n', R0) + 1 : -1;
const rEndLine = R1 > 0 ? SRC.indexOf('\n', R1) : -1;
const BLOCK_RAW = rBeginLine >= 0 && rEndLine > rBeginLine ? SRC.slice(rBeginLine, rEndLine) : '';
const BLOCK = stripJs(BLOCK_RAW);
const BLOCK_ALL = stripJs(BLOCK_RAW, 'all');

T('[HEAD-FAIL⑥b] 輕量讀的 projection 有帶 gameState.phase（沒帶的話對帳永遠看不到 game-over）', () => {
  const i = S.indexOf("const _light = await TROOMS.findOne({ _id: m.roomId }, { projection: {");
  assert.ok(i > 0, '找不到輕量讀');
  const line = S.slice(i, S.indexOf('\n', i));
  assert.ok(line.includes("'gameState.phase': 1"), '輕量讀沒帶 gameState.phase：' + line.trim());
  assert.ok(line.includes('lastActionAt: 1') && line.includes('updatedAt: 1'), 'v6.119 原有欄位不可被拿掉');
  assert.ok(i < R0, '輕量讀應在對帳區塊之前');
});
T('[HEAD-FAIL⑥c] 對帳在「閒置門檻早退」之前 —— 寫在後面就要等 3 分鐘才對得上帳', () => {
  const iEarly = S.indexOf('if (now <= _lastLight + idleMin * 60000) continue;');
  assert.ok(iEarly > 0, '找不到閒置門檻早退');
  assert.ok(R1 < iEarly, '對帳區塊寫在閒置門檻早退之後');
});
T('[HEAD-FAIL⑥d] 對帳**真的呼叫** onMatchGameOver（剝除註解後仍在）', () => {
  assert.ok(/await onMatchGameOver\(/.test(BLOCK), '剝除註解後找不到呼叫');
});
T('[否定型] 對帳區塊不得自作主張判勝負／推輪次', () => {
  for (const bad of ['advanceOrFinish', 'checkRoundAdvance', 'winnerUid', 'idleForfeit', 'TROOMS.updateOne', 'TMATCH.updateOne']) {
    assert.ok(!BLOCK.includes(bad), '對帳區塊內不該有：' + bad);
    assert.ok(!BLOCK_ALL.includes(bad), '（連字串一起抹）對帳區塊內不該有：' + bad);
  }
});
T('[自我驗證] 上一條否定型不是恆真（同樣的字串在整份檔案確實找得到）', () => {
  for (const bad of ['advanceOrFinish', 'checkRoundAdvance', 'winnerUid', 'idleForfeit', 'TROOMS.updateOne', 'TMATCH.updateOne']) {
    assert.ok(S.includes(bad), '整份檔案找不到 ' + bad + ' ⇒ 否定型斷言恆真、擋不住任何東西');
  }
});
function inScope(declAnchor, useIdx) {
  const iDecl = S.indexOf(declAnchor);
  if (iDecl < 0) return { ok: false, why: '找不到宣告 ' + declAnchor };
  let d0 = 0;
  for (let k = 0; k < iDecl; k++) { if (S[k] === '{') d0++; else if (S[k] === '}') d0--; }
  let d = d0, min = Infinity;
  for (let k = iDecl; k < useIdx; k++) {
    if (S[k] === '{') d++;
    else if (S[k] === '}') { d--; if (d < min) min = d; }
  }
  return { ok: min >= d0, why: 'declDepth=' + d0 + ' minBetween=' + min };
}
T('[結構] onMatchGameOver 在對帳區塊的作用域內（跨 IIFE 就是 ReferenceError，node --check 抓不到）', () => {
  const r = inScope('async function onMatchGameOver(doc, gs) {', S.indexOf('await onMatchGameOver(', R0));
  assert.ok(r.ok, r.why);
});
T('[回歸⑤] /action 的正常結算路徑一字未動（edge-triggered 那條仍在，對帳只是補網）', () => {
  assert.ok(S.includes("if (newGs.phase === 'game-over' && doc.matchId) { try { await onMatchGameOver(doc, newGs); }"),
    '/action 的原結算呼叫被動到了');
  assert.ok(S.includes("if (!m || m.status === 'done') return;"), 'onMatchGameOver 的冪等早退不見了');
});

// ── 實跑：把區塊包成 for 迴圈的一圈（continue ⇒ 不往下判負）─────────────────
const RUNNER = new Function('_light', 'TROOMS', 'm', 'onMatchGameOver',
  'return (async function () { for (let _once = 0; _once < 1; _once++) {\n'
  + BLOCK_RAW + '\n return { continued: false }; } return { continued: true }; })();');
async function runReconcile(o) {
  const calls = [], warns = [];
  const room = o.room === undefined
    ? { _id: 'R1', matchId: 'M1', eventId: 'E1', seats: ['u0', 'u1'], names: ['小明', '小華'], gameState: o.gs }
    : o.room;
  const TROOMS = { async findOne() { return room; } };
  const onMatchGameOver = async (doc, gs) => {
    calls.push({ matchId: doc && doc.matchId, winner: gs && gs.winner });
    if (o.throws) throw new Error('boom');
  };
  const _light = o.light === undefined ? { lastActionAt: 1, gameState: o.gs ? { phase: o.gs.phase } : undefined } : o.light;
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const r = await RUNNER(_light, TROOMS, { _id: 'M1', roomId: 'R1' }, onMatchGameOver);
    return { ...r, calls, warns };
  } finally { console.warn = origWarn; }
}
const GO = (w) => ({ phase: 'game-over', winner: w, log: [] });

await TA('[HEAD-FAIL⑦a／核心④] 房間已 game-over 而對戰仍 playing ⇒ 真的補跑 onMatchGameOver 並跳過閒置判定', async () => {
  const r = await runReconcile({ gs: GO(1) });
  assert.equal(r.calls.length, 1, '沒有補跑（實際 ' + r.calls.length + ' 次）');
  assert.equal(r.calls[0].matchId, 'M1', '傳進去的不是房間 doc（onMatchGameOver 要讀 doc.matchId/seats/names）');
  assert.equal(r.calls[0].winner, 1);
  assert.equal(r.continued, true, '對帳完必須 continue，不可往下走閒置判負');
});
await TA('[HEAD-FAIL⑦b] 補跑本身拋錯：不可讓整個掃描崩掉，仍要 continue 並出聲', async () => {
  const r = await runReconcile({ gs: GO(0), throws: true });
  assert.equal(r.calls.length, 1);
  assert.equal(r.continued, true);
  assert.ok(r.warns.some((w) => w.includes('M1')), '失敗沒有留下任何訊號');
});
await TA('[HEAD-FAIL⑦c] game-over 但無勝方（平手／系統死角）：不自作主張，只 warn 一次', async () => {
  delete global.__ptcgReconcileNoWinnerWarned;
  const r1 = await runReconcile({ gs: { phase: 'game-over', winner: null, log: [] } });
  assert.equal(r1.calls.length, 0, '無勝方竟然還去結算');
  assert.equal(r1.warns.length, 1, '應 warn 一次，實際 ' + r1.warns.length);
  const r2 = await runReconcile({ gs: { phase: 'game-over', winner: null, log: [] } });
  assert.equal(r2.warns.length, 0, '第二次不該再 warn（每 30 秒每場印一行會灌爆 log）');
  delete global.__ptcgReconcileNoWinnerWarned;
});
await TA('[正對照⑤] 正常進行中的房間：對帳完全不介入，照舊往下走閒置判定', async () => {
  const r = await runReconcile({ gs: { phase: 'playing', log: [] } });
  assert.equal(r.calls.length, 0);
  assert.equal(r.continued, false, '進行中的房間被對帳攔下來了 ⇒ 閒置判負整條失效');
});
await TA('[正對照] setup 房：不介入（v6.157 的補推路徑不可被搶走）', async () => {
  const r = await runReconcile({ gs: { phase: 'setup', log: [] } });
  assert.equal(r.calls.length, 0);
  assert.equal(r.continued, false);
});
await TA('[防呆] 輕量讀說 game-over、完整讀卻不是（剛好被覆蓋）⇒ 不結算', async () => {
  const r = await runReconcile({ light: { lastActionAt: 1, gameState: { phase: 'game-over' } }, gs: { phase: 'playing', log: [] } });
  assert.equal(r.calls.length, 0, '以輕量讀當真相去結算了');
  assert.equal(r.continued, true, '輕量讀說已結束就不該再走閒置判負');
});
await TA('[防呆] 房間不見了 / 沒有盤面：不介入也不崩', async () => {
  const r1 = await runReconcile({ light: { lastActionAt: 1 } });
  assert.equal(r1.calls.length, 0); assert.equal(r1.continued, false);
  const r2 = await runReconcile({ light: { lastActionAt: 1, gameState: { phase: 'game-over' } }, room: null });
  assert.equal(r2.calls.length, 0); assert.equal(r2.continued, true);
  const r3 = await runReconcile({ light: null });
  assert.equal(r3.calls.length, 0); assert.equal(r3.continued, false);
});

console.log('\n=== v6.212 自癒方向／版本閘／賽程對帳: ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
