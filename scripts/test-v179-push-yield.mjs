#!/usr/bin/env node
/**
 * server_admin_patch v1.79 守衛：推播排隊送出，不讓「推播給全站」卡住整台伺服器
 *
 * 背景（主機檢查 2026-11-06）：11/5 三次 POST /api/tournament/propose（玩家發起社群賽）之後 1 秒內，
 *   全站 30～70 個平常 1～10ms 的請求同一秒卡約 1.1 秒。broadcastPush 一口氣對 427 個訂閱者呼叫
 *   web-push 的 sendNotification，而它在發出 HTTPS 前要同步做完加密與簽章（VM 實測每筆約 0.75ms）。
 *   站長 2026-11-06：「好的請修正」。
 *
 * 【A】排隊包裝本身（抽出哨兵區塊、注入假 web-push 實跑）
 *   A1 400 筆：全部送達、成功值原封轉交；同時在路上的筆數 ≤ 上限
 *   A2 錯誤原封轉交（statusCode 410 物件、同步 throw）
 *   A3 卡住的推播服務：那一格逾時後讓出，其他推播照常送完；卡住那筆之後回應時結果仍轉交
 *   A4 重複執行不會重複包裝；require 失敗時走 import()；兩者都沒有就不安裝、不 throw
 *   A5 時效性推播（小批）排在全站廣播（大批）前面（審查 P2-1）
 * 【B】真的 broadcastPush（從錦標賽區塊抽出原樣執行；假 TPUSH、假 web-push 每筆同步佔 1.5ms）
 *   B1 400 個訂閱：事件迴圈最長一次被佔用 < 60ms（未修前約 600ms），且 400 筆全部送出、404／410 照樣清除
 * 【C】靜態：區塊在錦標賽區塊（第一支 /api/tournament 端點）之前；錦標賽區塊逐位元未動（與 BASE 相同）
 * 【H】HEAD-FAIL：BASE（沒有排隊）跑同一個 B1 ⇒ 最長佔用 ≥ 400ms
 */
import { revertAdminV180IfPresent } from './lib/sap-revert-admin-v180.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '2a96696e';   // v6.630 時的 origin/main（本版的上一版）
const P = 'oracle-admin/server_admin_patch.js';
const TAIL_ANCHOR = "app.get('/api/tournament";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const SRC = readFileSync(join(ROOT, P), 'utf8').replace(/\r\n/g, '\n');

function block(src) {
  const a = src.indexOf('  // >>> v179-push-yield\n'), b = src.indexOf('  // <<< v179-push-yield\n');
  if (a < 0 || b < 0 || b < a) return null;
  const s = src.slice(a, b);
  if (s.length < 1500 || s.length > 8000) return null;   // 抽錯段落的護欄
  return s;
}
// 抽出某個 function 宣告（大括號配對，略過字串）
function fnSrc(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let j = src.indexOf(') {', i) + 2, d = 0, q = null;   // 函式本體的大括號（參數的解構大括號不算）
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); continue; }          // 行註解（註解裡的引號不算）
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }     // 區塊註解
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 安裝區塊：傳入假模組（require 成功或失敗、import 成功或失敗）
async function install(code, fake, { requireFails = false, importFails = false } = {}) {
  const req = (n) => { if (requireFails || n !== 'web-push') throw new Error('no require'); return fake; };
  const imp = async (n) => { if (importFails || n !== 'web-push') throw new Error('no import'); return { default: fake }; };
  const body = code.replace(/await import\('web-push'\)/g, "await __imp('web-push')");
  const f = new Function('require', '__imp', 'console', `return (async () => { ${body}\n })();`);
  await f(req, imp, { log() {}, warn() {} });
  for (let i = 0; i < 5; i++) await tick();   // 讓區塊裡的 async IIFE 跑完
}
const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* 模擬同步加密 */ } };
function fakeWebPush({ syncMs = 0.2, netMs = 5, hangSet = new Set(), failMap = new Map() } = {}) {
  const st = { calls: 0, inflight: 0, peak: 0 };
  const wp = {
    st,
    sendNotification(sub, body) {
      st.calls++;
      busy(syncMs);
      if (failMap.get(sub.endpoint) === 'sync') throw Object.assign(new Error('bad sub'), { statusCode: 400 });
      st.inflight++; st.peak = Math.max(st.peak, st.inflight);
      return new Promise((res, rej) => {
        const done = () => { st.inflight--; const f = failMap.get(sub.endpoint); if (f) rej(Object.assign(new Error('gone'), { statusCode: f })); else res({ statusCode: 201, ep: sub.endpoint }); };
        setTimeout(done, hangSet.has(sub.endpoint) ? 400 : netMs);
      });
    },
  };
  return wp;
}

const code = block(SRC);
console.log('【A】排隊包裝');
ok('★ A0 抽得到 v179 哨兵區塊', !!code);
if (code) {
  // A1
  { const wp = fakeWebPush(); await install(code, wp);
    const subs = Array.from({ length: 400 }, (_, i) => ({ endpoint: 'e' + i }));
    const rs = await Promise.all(subs.map((s) => wp.sendNotification(s, 'x')));
    const q = wp.__ptcgPushQueue;
    ok('★★★ A1 400 筆全部送達、成功值原封轉交、同時在路上 ≤ 上限（16）', rs.length === 400 && rs.every((r, i) => r.ep === 'e' + i) && wp.st.peak <= 16 && wp.st.peak >= 8 && q && q.stats().doneTotal === 400,
      JSON.stringify({ peak: wp.st.peak, stats: q && q.stats() })); }
  // A2
  { const failMap = new Map([['e1', 410], ['e2', 'sync']]); const wp = fakeWebPush({ failMap }); await install(code, wp);
    const out = await Promise.allSettled(['e0', 'e1', 'e2', 'e3'].map((e) => wp.sendNotification({ endpoint: e }, 'x')));
    ok('★★ A2 錯誤原封轉交（410 物件、同步 throw 400），其他照常', out[0].status === 'fulfilled' && out[1].status === 'rejected' && out[1].reason.statusCode === 410
      && out[2].status === 'rejected' && out[2].reason.statusCode === 400 && out[3].status === 'fulfilled', JSON.stringify(out.map((o) => o.status))); }
  // A3
  { const hang = new Set(Array.from({ length: 16 }, (_, i) => 'h' + i)); const wp = fakeWebPush({ hangSet: hang }); await install(code, wp);
    wp.__ptcgPushQueue.cfg.slotTimeoutMs = 50;
    const hangs = [...hang].map((e) => wp.sendNotification({ endpoint: e }, 'x'));
    const t0 = performance.now();
    const rest = await Promise.all(Array.from({ length: 20 }, (_, i) => wp.sendNotification({ endpoint: 'n' + i }, 'x')));
    const dt = performance.now() - t0;
    const hr = await Promise.all(hangs);
    await sleep(20);
    const st1 = wp.__ptcgPushQueue.stats();
    // 卡住那幾筆之後回應時不可以再讓出一次（inflight 變負 ⇒ 之後同時在路上會超過上限）
    wp.st.peak = 0;
    await Promise.all(Array.from({ length: 60 }, (_, i) => wp.sendNotification({ endpoint: 'm' + i }, 'x')));
    const st2 = wp.__ptcgPushQueue.stats();
    ok('★★ A3 16 個卡住的服務佔滿格子：50ms 後讓出、其他 20 筆在 400ms 內送完；卡住的那幾筆之後回應仍轉交；之後 inflight 歸 0、同時在路上仍 ≤ 16',
      rest.length === 20 && dt < 300 && hr.every((r) => r.statusCode === 201) && st1.inflight === 0 && st2.inflight === 0 && wp.st.peak <= 16,
      JSON.stringify({ dt: Math.round(dt), st1, st2, peak: wp.st.peak })); }
  // A5 時效性推播優先：先丟一批 300 筆廣播，下一段程式再送 3 筆（報到之類）⇒ 這 3 筆要排在廣播前面
  { const wp = fakeWebPush({ netMs: 10 }); await install(code, wp);
    const order = [];
    const big = Array.from({ length: 300 }, (_, i) => wp.sendNotification({ endpoint: 'b' + i }, 'x').then(() => order.push('b')));
    await Promise.resolve(); await Promise.resolve();
    const small = ['s0', 's1', 's2'].map((e) => wp.sendNotification({ endpoint: e }, 'x').then(() => order.push('s')));
    await Promise.all([...big, ...small]);
    const lastS = order.lastIndexOf('s');
    ok('★★ A5 小批（報到、進場、判負警告）插到大批廣播前面：3 筆在前 40 筆內送達', lastS >= 0 && lastS < 40, JSON.stringify({ lastS })); }
  // A4
  { const wp = fakeWebPush(); await install(code, wp, { requireFails: true });
    const f1 = wp.sendNotification; await install(code, wp, { requireFails: true });
    const none = fakeWebPush(); let threw = false; try { await install(code, none, { requireFails: true, importFails: true }); } catch { threw = true; }
    ok('★ A4 require 失敗改走 import()；重複執行不重複包裝；兩者都失敗不安裝也不 throw', !!wp.__ptcgPushQueue && wp.sendNotification === f1 && !none.__ptcgPushQueue && !threw); }
}

// ── B：真的 broadcastPush ──
async function broadcastLag(src, withQueue) {
  const bp = fnSrc(src, '    async function broadcastPush(');
  if (!bp) return { err: '抽不到 broadcastPush' };
  const N = 400;
  const failMap = new Map([['e7', 410], ['e9', 404]]);
  const wp = fakeWebPush({ syncMs: 1.5, netMs: 20, failMap });
  if (withQueue) await install(block(src), wp);
  const rows = Array.from({ length: N }, (_, i) => ({ _id: 'r' + i, uid: 'u' + i, sub: { endpoint: 'e' + i }, notifyCommunity: true }));
  const deleted = [];
  const TPUSH = {
    find: (q) => ({ limit: () => ({ toArray: async () => (q && q.notifyCommunity === false ? [] : rows.slice()) }) }),
    deleteOne: async (f) => { deleted.push(f._id); },
  };
  const fn = new Function('_webpush', 'TPUSH', 'console', `${bp}\nreturn broadcastPush;`)(wp, TPUSH, { warn() {}, log() {} });
  // 量事件迴圈：每 2ms 一個計時器，記錄最長的遲到
  let maxGap = 0, last = performance.now(), on = true;
  const probe = () => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; if (on) setTimeout(probe, 2); };
  setTimeout(probe, 2);
  await sleep(10);
  const r = await fn({ title: 't' }, { prefKey: 'notifyCommunity' });
  await sleep(30);
  on = false;
  return { maxGap: Math.round(maxGap), sent: r && r.sent, calls: wp.st.calls, deleted: deleted.sort() };
}
console.log('【B】真的 broadcastPush（400 個訂閱、每筆同步 1.5ms）');
const B = await broadcastLag(SRC, true); console.log("    B1 實測", JSON.stringify(B));
ok('★★★ B1 事件迴圈最長一次被佔用 < 150ms（實測約 27ms；平行跑全套時留餘裕，BASE 約 600ms）；400 筆全部送出；404／410 的訂閱照樣清除', !B.err && B.maxGap < 150 && B.sent === 400 && B.calls === 400 && JSON.stringify(B.deleted) === JSON.stringify(['r7', 'r9']), JSON.stringify(B));

console.log('【C】靜態');
{
  const ia = SRC.indexOf('  // >>> v179-push-yield\n'), it = SRC.indexOf(TAIL_ANCHOR);
  ok('★★ C1 排隊區塊在錦標賽區塊（第一支 /api/tournament 端點）之前', ia > 0 && it > 0 && ia < it);
  // C4（審查 P3-3）：排隊之所以生效，是因為所有呼叫都「在呼叫當下」讀 _webpush.sendNotification ⇒ 不可以有人先解構存起來繞過排隊
  { const outside = SRC.replace(/  \/\/ >>> v179-push-yield\n[\s\S]*?  \/\/ <<< v179-push-yield\n/, '');
    const calls = outside.match(/[\w$.]*sendNotification\s*\(/g) || [];
    const bad = calls.filter((c) => c !== '_webpush.sendNotification(');
    const destr = /\{[^}]*\bsendNotification\b[^}]*\}\s*=/.test(outside) || /=\s*[\w$.]*\.sendNotification\s*[;,)]/.test(outside);
    ok('★★ C4 區塊外的推播呼叫全部是 _webpush.sendNotification(（至少 3 處），沒有先解構或另存函式', calls.length >= 3 && bad.length === 0 && !destr, JSON.stringify({ n: calls.length, bad, destr })); }
  if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('C2／H（缺 BASE ' + BASE_SHA + '）');
  else {
    const base = readBaseBlob(ROOT, BASE_SHA, P).out.replace(/\r\n/g, '\n');
    // ⭐v1.80（Rule 40）：後續版本的合法改動先用該版的單一還原表逐位元退回，意圖（v1.79 本身沒動錦標賽區塊、沒有別的改動）不變。
    //   v1.80 在本版哨兵內加了 requestTimeoutMs，C3 剝哨兵時一起剝掉；錦標賽區塊的 broadcastPush 由 PAIRS_V180 退回。
    const SRCB = revertAdminV180IfPresent(SRC);
    ok('★★★ C2 錦標賽區塊逐位元未動（從第一支 /api/tournament 端點到檔尾與 BASE 相同）', SRCB.slice(SRCB.indexOf(TAIL_ANCHOR)) === base.slice(base.indexOf(TAIL_ANCHOR)));
    const stripped = SRCB.replace(/  \/\/ >>> v179-push-yield\n[\s\S]*?  \/\/ <<< v179-push-yield\n/, '');
    ok('★★ C3 剝掉本版哨兵區塊後整檔與 BASE 逐位元相同（本版沒有別的改動）', stripped === base && stripped !== SRC);
    console.log('【H】HEAD-FAIL');
    const H = await broadcastLag(base, false); console.log("    BASE 實測", JSON.stringify({ maxGap: H.maxGap, sent: H.sent }));
    ok('★★★ HEAD-FAIL：BASE（沒有排隊）同一個情境事件迴圈被佔用 ≥ 400ms', !H.err && H.maxGap >= 400 && H.sent === 400, JSON.stringify(H));
  }
}

console.log(`\n=== v1.79 推播排隊送出：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
