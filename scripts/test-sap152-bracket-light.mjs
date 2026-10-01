#!/usr/bin/env node
/**
 * server patch v1.52 守衛：/api/tournament/bracket 只讀用得到的欄位＋in-flight 合併
 *
 * 起因（2026-10-01，站長同意對正式 node 行程做 80 秒 CPU 取樣）：
 *   9/28 起本機探針每分鐘第 16 秒附近慢 0.3～1.2 秒；取樣抓到那一刻整整 0.6 秒都在解 BSON，
 *   來源是 /bracket 快取過期時 `TMATCH.find({ eventId })` 沒有 projection —— 打完的對戰紀錄含
 *   finalState（整份最終盤面）＋finalLog（整份對戰紀錄）。大廳輪詢被同步到同一秒時，好幾發同時過期各自去讀。
 *
 * 【B】行為（抽出真的 handler 與哨兵區塊，餵假 DB 實跑；同一份資料也跑 v1.51 的 handler 當對照）
 *   B1 回應內容與 v1.51 逐欄位相同（單敗＋瑞士兩種賽事、mine/viewers 每人不同的欄位也一樣）
 *   B2 TMATCH.find 帶 projection、而且投影裡沒有 finalState／finalLog（瑞士制的 TREGS.find 也帶 projection、不含 deckEntries）
 *   B3 ⭐快取同時過期時 6 發並行請求 ⇒ TMATCH.find 只打 1 次（v1.51 打 6 次 ＝ 正對照）
 *   B4 合併只在「路上」生效：第一批結束、快取過期後再來一發 ⇒ 會重新讀（不會被舊 Promise 卡住）
 *   B5 查詢失敗 ⇒ 該批回 500、in-flight 也清掉；下一發照常重讀成功
 * 【D】28 把鎖的重釘（照 v1.50 的 D 組）
 *
 * Run: node scripts/test-sap152-bracket-light.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import {
  TAIL_ANCHOR, TEV_ANCHOR, revertV152,
  NEW_TAIL_SHA_V152, NEW_TEV_SHA_V152, NEW_TEV_LEN_V152, OLD_TAIL_SHA_V150, OLD_TEV_SHA_V150, OLD_TEV_LEN_V150,
} from './lib/tourn-revert-v152.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.459（server patch v1.51）。
const BASE_SHA = '8bd9453f0efdd789bc27badf6e4401b064de40dc';
const SAP = 'oracle-admin/server_admin_patch.js';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

/** 從 start 起抽出 `app.get(...)` 整支（括號配對到 `});`）。抽不到就 throw。 */
function handlerSrc(src, head) {
  const a = src.indexOf(head);
  if (a < 0 || src.indexOf(head, a + 1) >= 0) throw new Error('端點不是恰好一支：' + head);
  let depth = 0, i = src.indexOf('(', a);
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) break; }
    else if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
  }
  if (depth !== 0) throw new Error('括號配對失敗');
  const out = src.slice(a, i + 2);
  if (!out.endsWith(');')) throw new Error('端點結尾不是 );');
  return out;
}
function sentinel(src, tag) {
  const O = '    // >>> ' + tag + '\n', C = '    // <<< ' + tag + '\n';
  if (src.split(O).length !== 2 || src.split(C).length !== 2) throw new Error('哨兵不是恰好一對：' + tag);
  return src.slice(src.indexOf(O), src.indexOf(C) + C.length);
}

// ── 假 DB：記錄每次 find 的 filter／projection，toArray 可延遲、可失敗 ─────────────
function fakeColl(name, docs, log, opts = {}) {
  return {
    find(filter, o) {
      const proj = o && o.projection ? o.projection : null;
      log.push({ name, filter, proj });
      let sortSpec = null;
      const cur = {
        sort(s) { sortSpec = s; return cur; },
        async toArray() {
          await new Promise((r) => setTimeout(r, opts.delay || 5));
          if (opts.fail && opts.fail()) throw new Error('fake db down');
          let out = docs.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
          if (sortSpec) out = out.slice().sort((x, y) => (x.round - y.round) || (x.idx - y.idx));
          // 模擬 Mongo 投影：只留投影鍵＋_id
          if (proj) out = out.map((d) => { const r = { _id: d._id }; for (const k of Object.keys(proj)) if (k in d) r[k] = d[k]; return r; });
          return JSON.parse(JSON.stringify(out));   // 每次給新物件（真 driver 也是）
        },
      };
      return cur;
    },
  };
}
const BIG = { players: [{ hand: Array.from({ length: 50 }, (_, i) => ({ iid: 'x' + i, cardId: '123' })) }] };
function makeData(format) {
  const ev = { _id: 'evt_1', name: '網站賽-99', status: 'running', currentRound: 2, rounds: 3, format, phase: format === 'swiss-then-cut' ? 'swiss' : null, swissRounds: 3, topCut: 4 };
  const matches = [];
  const uids = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
  for (let r = 1; r <= 2; r++) for (let k = 0; k < 3; k++) {
    const p1 = uids[(k * 2 + r) % 6], p2 = uids[(k * 2 + r + 1) % 6];
    const done = r === 1;
    matches.push({ _id: 'm' + r + k, eventId: 'evt_1', round: r, idx: k, phase: format === 'swiss-then-cut' ? 'swiss' : undefined,
      p1uid: p1, p2uid: p2, p1name: 'N' + p1, p2name: 'N' + p2, status: done ? 'done' : 'playing', bye: false,
      winnerUid: done ? p1 : undefined, winnerName: done ? 'N' + p1 : undefined, roomId: done ? 'R' + r + k : 'RP' + k,
      finalState: done ? BIG : undefined, finalLog: done ? Array.from({ length: 200 }, (_, i) => 'log ' + i) : undefined });
  }
  const regs = uids.map((u, i) => ({ _id: 'r' + i, eventId: 'evt_1', uid: u, name: 'N' + u, checkedIn: true, dropped: i === 5, deckEntries: Array.from({ length: 20 }, () => ({ cardId: '1', count: 3 })) }));
  return { ev, matches, regs };
}
const TENG = {
  buildSwissPlayersFromMatches: (ms, regs) => regs.map((r) => ({ uid: r.uid, name: r.name, dropped: r.dropped,
    results: ms.filter((m) => m.p1uid === r.uid || m.p2uid === r.uid).map((m) => (m.winnerUid === r.uid ? 'W' : m.status === 'done' ? 'L' : 'P')) })),
  computeStandings: (ps) => ps.map((p, i) => ({ ...p, rank: i + 1, matchPoints: p.results.filter((x) => x === 'W').length * 3, owp: 0.5, oowp: 0.5 })),
};

/** 把 handler（＋本版哨兵區塊）組成可執行的端點。回 { call(uid), log }。 */
function buildEndpoint(src, withSentinel, data, opts = {}) {
  const block = withSentinel ? sentinel(src, 'v152-bracket-light') : '';
  const ep = handlerSrc(src, "app.get('/api/tournament/bracket',");
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  const log = [];
  const TMATCH = fakeColl('TMATCH', data.matches, log, opts);
  const TREGS = fakeColl('TREGS', data.regs, log, opts);
  const fn = new Function('app', 'TMATCH', 'TREGS', 'TENG', 'tournIdentity', 'resolveEventFromReq', 'countSpectators',
    'const _bracketCache = new Map();\n' + block + '    const BRACKET_TTL_MS = 3000;\n' + ep);   // 哨兵區塊之後緊接著就是這一行（原檔順序）
  fn(app, TMATCH, TREGS, TENG, async (req) => ({ uid: req.uid }), async () => data.ev, (room) => (room === 'RP1' ? 2 : 0));
  const h = routes['/api/tournament/bracket'];
  if (typeof h !== 'function') throw new Error('handler 沒註冊');
  const call = (uid) => new Promise((resolve) => {
    const res = { _s: 200, status(c) { this._s = c; return this; }, json(b) { resolve({ status: this._s, body: b }); } };
    h({ uid, query: {}, body: {} }, res);
  });
  return { call, log };
}

const CUR = rd(SAP);
let BASE = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, SAP); BASE = r.ok ? r.out.replace(/\r\n/g, '\n') : null; }

console.log('【B】行為（真 handler × 假 DB）');
for (const format of ['single-elim', 'swiss-then-cut']) {
  const d = makeData(format);
  const cur = buildEndpoint(CUR, true, d);
  const a = await cur.call('u1'), b = await cur.call('u4');
  const mq = cur.log.find((x) => x.name === 'TMATCH');
  ok(`B2 [${format}] TMATCH.find 帶 projection、不含 finalState／finalLog`,
    !!mq && !!mq.proj && !('finalState' in mq.proj) && !('finalLog' in mq.proj) && Object.values(mq.proj).every((v) => v === 1), JSON.stringify(mq));
  if (format === 'swiss-then-cut') {
    const rq = cur.log.find((x) => x.name === 'TREGS');
    ok('B2b [swiss] TREGS.find 帶 projection、不含 deckEntries', !!rq && !!rq.proj && !('deckEntries' in rq.proj), JSON.stringify(rq));
  }
  if (BASE) {
    const old = buildEndpoint(BASE, false, makeData(format));
    const a0 = await old.call('u1'), b0 = await old.call('u4');
    ok(`B1 [${format}] 回應內容與 v1.51 逐欄位相同（兩位不同玩家：mine／viewers 也一樣）`,
      JSON.stringify(a) === JSON.stringify(a0) && JSON.stringify(b) === JSON.stringify(b0) && a.status === 200 && a.body.matches.length === 6,
      (() => { const x = JSON.stringify([a, b]), y = JSON.stringify([a0, b0]); let i = 0; while (i < x.length && x[i] === y[i]) i++; return '第一個差異：' + x.slice(Math.max(0, i - 80), i + 80) + ' ⟂ ' + y.slice(Math.max(0, i - 80), i + 80); })());
    ok(`B1 前提 [${format}] v1.51 的 handler 確實讀了完整文件（沒有 projection）`, old.log.some((x) => x.name === 'TMATCH' && !x.proj));
  }
}
{
  const d = makeData('swiss-then-cut');
  const cur = buildEndpoint(CUR, true, d, { delay: 30 });
  const rs = await Promise.all(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((u) => cur.call(u)));
  const nM = cur.log.filter((x) => x.name === 'TMATCH').length, nR = cur.log.filter((x) => x.name === 'TREGS').length;
  ok('B3 ⭐快取空、6 發並行 ⇒ TMATCH.find 只 1 次、TREGS.find 只 1 次，6 發都 200', nM === 1 && nR === 1 && rs.every((r) => r.status === 200), JSON.stringify({ nM, nR }));
  ok('B3b 合併後每個人拿到自己的 mine（共用的是底層資料，不是回應）', rs[0].body.matches.some((m) => m.mine) && JSON.stringify(rs[0]) !== JSON.stringify(rs[2]));
  if (BASE) {
    const old = buildEndpoint(BASE, false, makeData('swiss-then-cut'), { delay: 30 });
    await Promise.all(['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((u) => old.call(u)));
    ok('B3 正對照：v1.51 同樣 6 發並行 ⇒ TMATCH.find 打了 6 次（證明 B3 的 1 次是合併造成的）',
      old.log.filter((x) => x.name === 'TMATCH').length === 6);
  }
  // B4：快取過期後再來 ⇒ 重新讀
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 10000;
    await cur.call('u1');
  } finally { Date.now = realNow; }
  ok('B4 第一批結束、快取過期後再來一發 ⇒ 重新讀（不被舊 Promise 卡住）', cur.log.filter((x) => x.name === 'TMATCH').length === 2);
}
{
  const d = makeData('single-elim');
  let down = true;
  const cur = buildEndpoint(CUR, true, d, { fail: () => down, delay: 10 });
  const rs = await Promise.all(['u1', 'u2', 'u3'].map((u) => cur.call(u)));
  down = false;
  const r2 = await cur.call('u1');
  ok('B5 查詢失敗 ⇒ 那一批都回 500；下一發 in-flight 已清掉、重讀成功 200',
    rs.every((r) => r.status === 500) && r2.status === 200 && cur.log.filter((x) => x.name === 'TMATCH').length === 2,
    JSON.stringify(rs.map((r) => r.status)) + ' / ' + r2.status);
}

console.log('\n【D】錦標賽區塊 28 把鎖重釘');
{
  const tail = CUR.slice(CUR.indexOf(TAIL_ANCHOR)), tev = CUR.slice(CUR.indexOf(TEV_ANCHOR));
  ok('D1 現行區塊指紋 ＝ NEW_*_V152（tail／tev／len）', sha(tail) === NEW_TAIL_SHA_V152 && sha(tev) === NEW_TEV_SHA_V152 && tev.length === NEW_TEV_LEN_V152);
  const rt = revertV152(tail), rv = revertV152(tev);
  ok('D2 revertV152 之後逐位元回到 v1.50／v1.51 的值', sha(rt) === OLD_TAIL_SHA_V150 && sha(rv) === OLD_TEV_SHA_V150 && rv.length === OLD_TEV_LEN_V150);
  const mut = tail.replace('BRACKET_TTL_MS = 3000', 'BRACKET_TTL_MS = 3001');
  ok('D3 自驗：本版區塊改一個字元 ⇒ 指紋對不上（D1 不是恆真式）', mut !== tail && sha(mut) !== NEW_TAIL_SHA_V152);
  if (BASE) {
    const bt = BASE.slice(BASE.indexOf(TAIL_ANCHOR));
    ok('D3b HEAD-FAIL：v1.51 的區塊指紋 ≠ 新值、＝ 舊值', sha(bt) === OLD_TAIL_SHA_V150 && sha(bt) !== NEW_TAIL_SHA_V152);
  }
  const CONSUMERS = ['scripts/test-v6276-deck-tournament-stats.mjs', 'scripts/test-v6291-tourn-verified-gate.mjs', 'scripts/test-v6292-tourn-verified-gate2.mjs',
    'scripts/test-v6303-ui-batch.mjs', 'scripts/test-v6381-archive-gamedraw-and-swiss-note.mjs'];
  const bad = CONSUMERS.filter((f) => { const s = rd(f); return !(s.includes("from './lib/tourn-revert-v152.mjs'") && s.includes('revertV152(')); });
  ok('D5 五支消費者都 import 新 lib 且呼叫 revertV152(', bad.length === 0, bad.join(', '));
  ok('D5b test-v6303 的 SAP 還原鏈最內層是 revertAdminV152', /revertAdminV150\(revertAdminV152\(SAP_RAW\)\)/.test(rd('scripts/test-v6303-ui-batch.mjs')));
}
if (!BASE) shallowSkip('sap152 B1／B3 正對照／D3b', '需要 v6.459 commit');

console.log(`\n=== server patch v1.52 /bracket 輕量化：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
