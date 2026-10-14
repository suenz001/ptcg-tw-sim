#!/usr/bin/env node
/**
 * v6.568 守衛：休閒房間已不存在（輪詢回 404）時不再全速一直打（站長 2026-10-14 交辦「現在就修第 2 項」）。
 *   背景：主機檢查報告——單一已刪除房間 VHCS 5 分鐘被 GET 479 次（≈1.6 次／秒），8 月 JKJ4 同型。
 *   原因（程式碼查證）：oraclePollRoom 收到 404 只 callback(null) 一次，計時器照原節奏一直排；對戰頁只把 onlineError
 *   設成「房間不存在或連線中斷」（那行字只在大廳畫面），聊天輪詢照打；等對手時的「卡住自癒」每 8～20 秒還會重訂閱（輪詢從頭全速）。
 *
 *   A：roomGonePollDelayMs 純函式（3→6→12→24→30 秒封頂；不會比原節奏更快）
 *   B：oraclePollRoom 實跑（假 GET＋假 setTimeout）：404 連續退避；逾時不算 404；房間回來立刻恢復原節奏並 callback
 *   C：對戰頁 _setRoomGone 實跑：停聊天輪詢／房間回來恢復；同一狀態重複呼叫不重訂閱
 *   D：對戰頁接線：handleRoomUpdate、卡住自癒在 roomGone 時不重訂閱、換房重設、提示列＋【回大廳】
 *   【H】BASE（v6.567）逐條紅
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { transformSync } from 'esbuild';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.567。
const BASE_SHA = 'c580331d425f5bd6e45173ff92605f0e293a1a3e';
const OC_P = 'src/lib/game/oracle-client.ts', PG_P = 'src/routes/game/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const ts = (s) => transformSync(s, { loader: 'ts' }).code;
const slice = (src, from, to) => { const i = src.indexOf(from); if (i < 0) return null; const j = src.indexOf(to, i); return j < 0 ? null : src.slice(i, j + to.length); };

function helperOf(OC) {
  const h = slice(OC, 'export function roomGonePollDelayMs(', '\n}\n');
  return h ? new Function(ts(h).replace(/export\s+/g, '') + '\nreturn roomGonePollDelayMs;')() : null;
}

function scenA(OC) {
  const f = helperOf(OC);
  if (!f) return {};
  const seq = [0, 1, 2, 3, 4, 5, 9, 50].map((n) => f(n, 500));
  return {
    A1: JSON.stringify(seq) === JSON.stringify([500, 3000, 6000, 12000, 24000, 30000, 30000, 30000]),
    A1n: JSON.stringify(seq),
    A2: f(1, 6000) === 6000 && f(0, 4000) === 4000 && f(-1, 800) === 800 && f(NaN, 800) === 800 && f(3, 20000) === 20000,
  };
}

// B：oraclePollRoom 實跑。腳本：[{kind:'room',v,c}|{kind:'404'}|{kind:'timeout'}]，每一發取一個；記錄每次排程的延遲與 callback。
async function runPoll(OC, script, normal = 500) {
  const poll = slice(OC, 'export function oraclePollRoom(', '\n}\n');
  const sdr = slice(OC, 'export function shouldDeliverRoomPoll(', '\n}\n');
  const gone = slice(OC, 'export function roomGonePollDelayMs(', '\n}\n') || '';
  if (!poll || !sdr) return null;
  const ROOM_UNCHANGED = Symbol('u');
  let k = 0;
  const next = async () => {
    const s = script[Math.min(k++, script.length - 1)];
    if (s.kind === 'timeout') throw Object.assign(new Error('連線逾時'), { timeout: true });
    if (s.kind === '404') return null;
    if (s.kind === 'same') return ROOM_UNCHANGED;
    return { _version: s.v, createdAt: s.c };
  };
  const delays = []; const got = []; let pending = null;
  const fakeSetTimeout = (fn, ms) => { delays.push(ms); pending = fn; return 1; };
  const mk = new Function('oracleGetRoom', 'oracleGetRoomDelta', 'logChainHash', 'mergePolledRoomLog', 'ROOM_UNCHANGED', 'setTimeout', 'clearTimeout', 'console',
    ts(sdr + '\n' + gone + '\n' + poll).replace(/export\s+/g, '') + '\nreturn oraclePollRoom;');
  const pollRoom = mk(next, async () => { const r = await next(); return r && r !== ROOM_UNCHANGED ? { room: r } : r; }, () => 'h',
    (_l, room) => ({ ok: true, room, nextLog: null }), ROOM_UNCHANGED, fakeSetTimeout, () => {}, { warn: () => {} });
  const unsub = pollRoom('ABCD', (r) => got.push(r ? r._version : null), normal);
  for (let i = 0; i < script.length; i++) {
    await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
    if (i < script.length - 1 && pending) { const f = pending; pending = null; f(); }
  }
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  unsub();
  return { delays, got };
}

async function scenB(OC) {
  const r = {};
  const R = (v, c = 1) => ({ kind: 'room', v, c });
  const N = { kind: '404' }, T = { kind: 'timeout' };
  const a = await runPoll(OC, [R(5), N, N, N, N, N, N]);
  if (!a) return r;
  r.B1 = JSON.stringify(a.delays) === JSON.stringify([500, 3000, 6000, 12000, 24000, 30000, 30000]) && JSON.stringify(a.got) === JSON.stringify([5, null]);
  r.B1n = JSON.stringify(a);
  const b = await runPoll(OC, [R(5), N, T, T, N]);
  r.B2 = JSON.stringify(b.delays) === JSON.stringify([500, 3000, 3000, 3000, 6000]);   // 逾時不算 404、也不歸零
  r.B2n = JSON.stringify(b);
  const c = await runPoll(OC, [R(5), N, N, R(1, 2), { kind: 'same' }]);   // 同房號被重建（createdAt 變）
  r.B3 = JSON.stringify(c.delays) === JSON.stringify([500, 3000, 6000, 500, 500]) && JSON.stringify(c.got) === JSON.stringify([5, null, 1]);
  r.B3n = JSON.stringify(c);
  const d = await runPoll(OC, [R(5), R(5), R(6), R(7)]);   // 健康房間：節奏逐字不變（零回歸）
  r.B4 = JSON.stringify(d.delays) === JSON.stringify([500, 500, 500, 500]) && JSON.stringify(d.got) === JSON.stringify([5, 6, 7]);
  r.B4n = JSON.stringify(d);
  return r;
}

function scenC(PG) {
  const blk = slice(PG, '  // >>> v6568-room-gone\n', '  // <<< v6568-room-gone\n');
  if (!blk) return {};
  const log = [];
  const code = ts(blk.replace('$state(false)', 'false'));
  const mk = new Function('subscribeMessages', 'env', `
    let unsubMessages = env.unsub0; let chatMessages = []; let chatScrollEl = null; let roomCode = env.code;
    ${code}
    return { set: _setRoomGone, gone: () => roomGone, unsub: () => unsubMessages, setCode: (c) => { roomCode = c; } };`);
  let subs = 0;
  const fakeSub = (c) => { subs++; log.push('sub:' + c); return () => log.push('unsub:' + c); };
  const h = mk(fakeSub, { unsub0: () => log.push('unsub:orig'), code: 'ABCD' });
  h.set(true);
  const afterGone = { gone: h.gone(), unsub: h.unsub(), log: log.slice() };
  h.set(true);   // 重複
  const afterRepeat = log.length;
  h.set(false);
  const afterBack = { gone: h.gone(), hasUnsub: typeof h.unsub() === 'function', subs };
  h.set(false);   // 重複 ⇒ 不再重訂閱
  return {
    C1: afterGone.gone === true && afterGone.unsub === null && JSON.stringify(afterGone.log) === '["unsub:orig"]' && afterRepeat === 1,
    C2: afterBack.gone === false && afterBack.hasUnsub && afterBack.subs === 1 && subs === 1 && log.join(',') === 'unsub:orig,sub:ABCD',
    Cn: JSON.stringify({ afterGone: { ...afterGone, unsub: String(afterGone.unsub) }, afterRepeat, afterBack, log }),
  };
}

function scenD(PG) {
  const iv = slice(PG, '      if (!roomCode) { oppInactivityWarn = false; return; }\n', '_resyncStreak++;') || '';
  return {
    D1: PG.includes("    if (!room) { onlineError = '房間不存在或連線中斷'; if (typeof _setRoomGone === 'function') _setRoomGone(true); return; }\n    if (typeof _setRoomGone === 'function') _setRoomGone(false);"),
    D2: /^      if \(typeof roomGone !== 'undefined' && roomGone\) \{ oppInactivityWarn = false; return; \}$/m.test(iv)
      && iv.indexOf('roomGone) { oppInactivityWarn = false; return; }') < iv.indexOf('_lastResyncAt = Date.now();'),
    D3: /    if \(typeof roomGone !== 'undefined'\) roomGone = false;[^\n]*\n    unsubRoom\?\.\(\);\n    unsubRoom = subscribeRoom\(roomCode, handleRoomUpdate/.test(PG)
      && /    _subscribeChatFor\(roomCode\);\n  \}/.test(PG) && (PG.match(/subscribeMessages\(/g) || []).length === 1,
    D4: /\{#if !isTournament && roomGone && roomCode\}<div class="room-gone-bar" role="alert">[^\n]*<button class="room-gone-btn" onclick=\{leaveOnlineGame\}>回大廳<\/button><\/div>\{\/if\}/.test(PG)
      && PG.includes('<span>⚠️ 房間已不存在</span>') && /    if \(typeof roomGone !== 'undefined'\) roomGone = false;[^\n]*\n    if \(_leavingRoomCode\) \{/.test(PG)
      && /\.room-gone-bar \{ position: fixed;[^}]*max-width: calc\(100vw - 32px\)/.test(PG),
  };
}

const LABEL = {
  A1: '★★★ A1 404 退避：3 → 6 → 12 → 24 → 30 秒封頂；沒有 404 時就是原本的間隔',
  A2: '★★ A2 退避絕不比原節奏快（觀戰／背景的慢檔照用）；怪值一律當 0',
  B1: '★★★ B1 oraclePollRoom 實跑：房間被刪後連續 404 ⇒ 間隔逐步拉長；callback(null) 只通知一次',
  B2: '★★★ B2 逾時不算 404（v6.246）：不會加速退避、也不會把退避歸零',
  B3: '★★★ B3 同房號重建（200 回來）⇒ 立刻回到原節奏並交給畫面；之後 204 照常',
  B4: '★★ B4 零回歸：健康房間的輪詢節奏與 callback 逐字不變',
  C1: '★★★ C1 對戰頁 _setRoomGone(true) 實跑：停掉聊天輪詢；重複呼叫不重做',
  C2: '★★★ C2 房間回來 _setRoomGone(false)：恢復聊天輪詢（恰好一次）',
  D1: '★★ D1 handleRoomUpdate：收到 null ⇒ 標記房間不存在；收到房間 ⇒ 取消標記',
  D2: '★★★ D2 卡住自癒：房間不存在時不重訂閱（否則每 8～20 秒把輪詢重置成全速）',
  D3: '★★ D3 換房重設 roomGone；聊天訂閱只剩 _subscribeChatFor 一份（Rule 38）',
  D4: '★★ D4 提示列＋【回大廳】（休閒房、對戰畫面與大廳都看得到；手機寬度不超出）',
};

const OC = normEol(readFileSync(join(ROOT, OC_P), 'utf8'));
const PG = normEol(readFileSync(join(ROOT, PG_P), 'utf8'));
const all = async (oc, pg) => {
  const g = async (fn) => { try { return (await fn()) || {}; } catch (e) { return { _err: String(e && e.message) }; } };
  return { ...(await g(() => scenA(oc))), ...(await g(() => scenB(oc))), ...(await g(() => scenC(pg))), ...(await g(() => scenD(pg))) };
};
const R = await all(OC, PG);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n'] ?? R[k[0] + 'n'] ?? R._err);

console.log('【H】HEAD-FAIL（BASE v6.567）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6568 HEAD-FAIL', '需要歷史 commit');
else {
  const bo = readBaseBlob(ROOT, BASE_SHA, OC_P), bp = readBaseBlob(ROOT, BASE_SHA, PG_P);
  ok('[前提] 讀得到 BASE 的兩個檔', bo.ok && bp.ok);
  const B = await all(normEol(bo.out || ''), normEol(bp.out || ''));
  for (const k of Object.keys(LABEL)) {
    if (k === 'B4') continue;   // 零回歸條目：BASE 上本來就該綠，由下方正對照另驗（不計入 HEAD-FAIL）
    ok(`★★★[H] v6.567：${k} 紅`, B[k] !== true, String(B[k]));
  }
  // B4 正對照：同一套實跑在 BASE 上也是綠（證明 B4 量的是「健康節奏不變」，不是「有沒有新 helper」）
  const b4 = await scenB(normEol(bo.out || ''));
  ok('★★[正對照] B4 在 BASE 上也是綠（健康房間節奏本來就是這樣）', b4.B4 === true, b4.B4n);
  ok('★★[正對照] B1 在 BASE 上紅的原因是「404 之後仍 500ms 全速」', /"delays":\[500,500,500/.test(b4.B1n || ''), b4.B1n);
}
console.log(`\n=== v6.568 房間不存在時停止全速輪詢：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
