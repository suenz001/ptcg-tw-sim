// 守衛:v6.278 休閒 PUT 上行增量【伺服器端 3a:深路徑】— PTCG-DELTA-PUT 區塊
//
// 這一版做了什麼:_dpApplyPatch 的 splitPath 由「最多兩段」放寬到最多 8 段,並支援**陣列索引**
//   (gameState.players.0.hand / gameState.players.1.active.damage)。
//   ⚠⚠ client 這一版不會送深路徑 ⇒ 玩家完全無感(站長裁定 server 先上)。
//   ⚠⚠ 最高風險=**寫壞玩家盤面** ⇒ 本檔的重心全在「六道防護」與「向後相容逐位元不變」。
//
// 條目總覽:
//   【A】接線(掛載+hoist+deep 旗標,行為端不是 grep)
//   【B】⭐⭐ 向後相容:把 **BASE(v6.277) 的 _dpApplyPatch 原始碼**嵌進本檔實跑,
//        與修後版本對同一批兩層 patch 逐位元對照(含 fuzz 6,000 次);
//        並自驗嵌入的快照真的是「只支援兩層」的舊版(正對照)
//   【C】深路徑支援範圍(幾層、陣列索引怎麼判)
//   【D】⭐⭐ 六道防護逐條行為端:①陣列不變物件 ②不 sparse ③索引範圍/禁擴張
//        ④原型污染三個名字 ⑤深度與筆數上限 ⑥中間節點 null/缺席 一律 deltaReject
//   【E】⭐ 惡意 patch 六種:全部 deltaReject 且**沒有流進核心 PUT、DB doc 一個位元沒動**
//   【F】哨兵:deltaPut 維持 1 + 新增 deltaPutDeep:1;⭐ 抽 v6.270 client 的判斷式**實跑**
//        證明舊 client 讀到新哨兵不會壞;kill switch 兩個哨兵一起消失
//   【G】⭐⭐⭐ round-trip fuzz 20,000 次:含陣列(索引越界/長度變動/null 中間節點/中文/刪欄)
//   【H】⭐⭐ 事件迴圈:深路徑 apply 的阻塞 p50/p99(附量測數字,Rule 32)
//   【I】⭐⭐ 錦標賽零接觸(內嵌 sha256)＋玩家端零改動(逐檔 blob;淺複製時 shallowSkip)
//   【J】突變測試 8 條 — 每一條必須紅在**預期的那條斷言**(只捕捉 AssertionError)
//   【K】HEAD-FAIL:對 BASE(v6.277) blob 跑,各項各自紅
//   【L】自查:在 package.json test chain 裡/版本字串一致/不得 pin 死版本號
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as CP from 'node:child_process';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = '54e7a3c68892f5d8ee7146181c7481549b26e177';   // v6.277
const PATCH = readFileSync(path.join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

let pass = 0, fail = 0;
async function T(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;   // 只捕捉 AssertionError(守衛安慰劑鐵律)
    fail++; console.log('  ✗ ' + name + '\n    ' + String(e.message).slice(0, 500));
  }
}

// ── 區塊抽取(同 test-v6220/v6268 手法) ────────────────────────────────────
function extractBlock(src, sentS, sentE) {
  const si = src.indexOf(sentS), ei = src.indexOf(sentE);
  if (si < 0 || ei <= si) return null;
  return src.slice(src.indexOf('\n', si) + 1, ei);
}
const DP_S = '// >>> PTCG-DELTA-PUT-BLOCK-START';
const DP_E = '// <<< PTCG-DELTA-PUT-BLOCK-END';
const DPBLOCK = extractBlock(PATCH, DP_S, DP_E);

function makeApp() {
  const stack = [
    { handle: function query() {} },
    { handle: function expressInit() {} },
    { handle: function corsMiddleware() {} },
    { handle: function jsonParser() {} },
    { route: { path: '/api/health' } },
    { route: { path: '/api/rooms' } },
    { route: { path: '/api/rooms/:code' } },
  ];
  const app = { use(fn) { stack.push({ handle: fn }); } };
  app._router = { stack };
  Object.defineProperty(app, 'router', { get() { throw new Error("'app.router' is deprecated!"); } });
  app.__stack = stack;
  return app;
}
function fakeReq(method, url, body) { return { method, originalUrl: url, url, headers: {}, body }; }
function fakeRes() {
  const r = { statusCode: 200, body: undefined, ended: false, jsonCalled: false, headersSent: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.jsonCalled = true; r.headersSent = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
// db holder:findOne 回 structuredClone(模擬 driver 給新物件),並記錄「原始 doc 有沒有被動到」
function makeCtxFactory(blockText) {
  return async (holder) => {
    const logs = [];
    const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')) };
    const db = { collection: (n) => ({ findOne: async (q) => {
      const d = holder.docs[q && q._id];
      return d === undefined ? null : structuredClone(d);
    } }) };
    const app = makeApp();
    const before = new Set(app.__stack.map((l) => l.handle));
    await new Function('app', 'db', 'console',
      '"use strict"; return (async () => {\n' + blockText + '\n})();')(app, db, fakeConsole);
    const news = app.__stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle);
    assert.equal(news.length, 1, '應恰好掛上 1 支 middleware,實得 ' + news.length);
    return { mw: news[0], logs, app };
  };
}
const mkCtx = makeCtxFactory(DPBLOCK);
async function callMw(mw, req) {
  const res = fakeRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  return { res, nexted };
}

// ── 參照實作(與伺服器區塊**獨立**;canonical hash 先組字串再 FNV,寫法不同輸出必須相同) ──
function refCanonStr(x, d = 0) {
  if (d > 32) throw new Error('ref-too-deep');
  if (x === null || x === undefined) return 'n';
  const t = typeof x;
  if (t === 'boolean') return x ? 't' : 'f';
  if (t === 'number') return Number.isFinite(x) ? 'd' + String(x) : 'n';
  if (t === 'string') return 's' + JSON.stringify(x);
  if (Array.isArray(x)) { let s = '['; for (const it of x) s += refCanonStr(it, d + 1) + ','; return s + ']'; }
  if (t === 'object') {
    let s = '{';
    for (const k of Object.keys(x).sort()) { if (x[k] === undefined) continue; s += JSON.stringify(k) + ':' + refCanonStr(x[k], d + 1) + ','; }
    return s + '}';
  }
  return 'n';
}
function refCanonHash(v) {
  const str = refCanonStr(v);
  let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
  }
  return h1.toString(16) + '-' + h2.toString(16);
}
const isPlainObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
function stripEmails(room) {
  if (!room || typeof room !== 'object' || !Array.isArray(room.seats)) return room;
  return { ...room, seats: room.seats.map((s) => (s && typeof s === 'object' && s.email != null) ? { ...s, email: null } : s) };
}
function clientView(doc) { return JSON.parse(JSON.stringify(stripEmails(doc))); }
function simKeepEmail(data, doc) {
  const d = structuredClone(data);
  if (Array.isArray(d.seats) && Array.isArray(doc.seats)) {
    for (let i = 0; i < d.seats.length; i++) {
      const s = d.seats[i], o = doc.seats[i];
      if (s && typeof s === 'object' && s.uid && s.email == null && o && o.uid === s.uid && o.email != null) s.email = o.email;
    }
  }
  return d;
}

// ── 參照 diff ①:v6.270 client 的**兩層**規格(向後相容用) ──────────────────
function refDiff2(prev, next) {
  const patch = { set: {}, del: [] };
  let logAppend = null;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (!(k in next)) { if (k in prev) patch.del.push(k); continue; }
    if (!(k in prev)) { patch.set[k] = next[k]; continue; }
    if (k === 'gameState' && isPlainObj(prev[k]) && isPlainObj(next[k])) {
      const sub = new Set([...Object.keys(prev[k]), ...Object.keys(next[k])]);
      for (const k2 of sub) {
        const p = 'gameState.' + k2;
        if (!(k2 in next[k])) { if (k2 in prev[k]) patch.del.push(p); continue; }
        if (!(k2 in prev[k])) { patch.set[p] = next[k][k2]; continue; }
        if (k2 === 'log' && Array.isArray(prev[k][k2]) && Array.isArray(next[k][k2])
            && next[k][k2].length >= prev[k][k2].length
            && refCanonStr(next[k][k2].slice(0, prev[k][k2].length)) === refCanonStr(prev[k][k2])) {
          if (next[k][k2].length > prev[k][k2].length) logAppend = next[k][k2].slice(prev[k][k2].length);
          continue;
        }
        if (refCanonStr(prev[k][k2]) !== refCanonStr(next[k][k2])) patch.set[p] = next[k][k2];
      }
      continue;
    }
    if (refCanonStr(prev[k]) !== refCanonStr(next[k])) patch.set[k] = next[k];
  }
  if (logAppend) patch.logAppend = logAppend;
  return patch;
}

// ── 參照 diff ②:**下一版 client 的深層規格**(本檔是它的第一個對跑對象) ────────
//   規則(與伺服器的六道防護逐條對齊,故意寫成「絕不製造伺服器會拒絕的路徑」):
//   ・只在「兩邊都是純物件」時往下鑽;
//   ・陣列只在**長度相同**時往下鑽(長度變了 ⇒ 整個陣列當一個值 set 給父物件)⇒ 永遠不擴張;
//   ・任何一段是壞 segment('' / 帶 '.' / __proto__ / constructor / prototype)⇒ 該層整包 set;
//   ・路徑段數上限 MAXSEGS;set/del 超過 256 ⇒ 回 null(=送全量)。
const REF_MAXSEGS = 8;
const BADSEG = (s) => (typeof s !== 'string' || s === '' || s.length > 256 || s.indexOf('.') >= 0
  || s === '__proto__' || s === 'constructor' || s === 'prototype');
function refDiffDeep(prev, next) {
  const set = {}, del = [];
  let logAppend = null;
  let bail = false;
  const walk = (bp, np, prefix, segs) => {
    if (bail) return;
    const keys = new Set([...Object.keys(bp), ...Object.keys(np)]);
    for (const k of keys) {
      if (BADSEG(k)) { bail = true; return; }
      const p = prefix ? prefix + '.' + k : k;
      if (!(k in np)) { if (k in bp) del.push(p); continue; }
      if (!(k in bp)) { set[p] = np[k]; continue; }
      const a = bp[k], b = np[k];
      if (prefix === 'gameState' && k === 'log' && Array.isArray(a) && Array.isArray(b) && b.length >= a.length
          && refCanonStr(b.slice(0, a.length)) === refCanonStr(a)) {
        if (b.length > a.length) logAppend = b.slice(a.length);
        continue;
      }
      if (refCanonStr(a) === refCanonStr(b)) continue;
      const canDeeper = segs + 1 < REF_MAXSEGS;
      if (canDeeper && isPlainObj(a) && isPlainObj(b)) { walk(a, b, p, segs + 1); continue; }
      if (canDeeper && Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
        // ⭐ 只在長度相同時鑽進陣列 ⇒ 永遠不會產生「擴張」或「刪元素」的路徑
        for (let i = 0; i < a.length; i++) {
          if (refCanonStr(a[i]) === refCanonStr(b[i])) continue;
          const pi = p + '.' + i;
          if (segs + 2 < REF_MAXSEGS && isPlainObj(a[i]) && isPlainObj(b[i])) walk(a[i], b[i], pi, segs + 2);
          else set[pi] = b[i];
          if (bail) return;
        }
        continue;
      }
      set[p] = b;
    }
  };
  walk(prev, next, '', 1);
  if (bail) return null;
  if (Object.keys(set).length > 256 || del.length > 256) return null;
  const patch = { set, del };
  if (logAppend && logAppend.length > 0) patch.logAppend = logAppend;
  return patch;
}
function makeBody(patch, next, ev) {
  return { patchProto: 1, expectedVersion: ev, fullHash: refCanonHash(next), patch };
}

// ══════════════════════════════════════════════════════════════════════════
// ⭐⭐ BASE(v6.277) 的「純函式段」原始碼快照 —— **內嵌**,不依賴 git 歷史(淺複製也在守)。
//   【K0】在有歷史時會逐位元比對它確實是 BASE 的原文;【B0】用行為端證明它真的只支援兩層。
// ══════════════════════════════════════════════════════════════════════════
const BASE_PURE_SRC = "      const _DP_MAX_SET = 256, _DP_MAX_DEL = 256, _DP_MAX_LOGAPPEND = 512;   // patch 條數上限\n      const _DP_MAX_MIX = 1000000;       // canonical hash 工作量上限(字元數;實測 48KB doc 約 5 萬字元)\n      const _DP_MAX_DEPTH = 32;          // 遞迴深度上限\n      const _dpBadSeg = (s) => (typeof s !== 'string' || s === '' || s.length > 256\n        || s === '__proto__' || s === 'constructor' || s === 'prototype');\n      // 純函式:seats[].email -> null(與 v1.20 _stripSeatEmails 同款;算 client 視角基底用)\n      const _dpStripSeatEmails = (room) => {\n        if (!room || typeof room !== 'object' || !Array.isArray(room.seats)) return room;\n        let _has = false;\n        for (const s of room.seats) { if (s && typeof s === 'object' && s.email != null) { _has = true; break; } }\n        if (!_has) return room;\n        return { ...room, seats: room.seats.map((s) => (s && typeof s === 'object' && s.email != null) ? { ...s, email: null } : s) };\n      };\n      // 純函式:canonical hash(FNV-1a 雙 32bit)。物件鍵**遞迴排序**後才餵進雜湊 =>\n      //   MongoDB 回傳的鍵序(BSON 插入序)與 client 端物件鍵序不同也得同雜湊;陣列保序。\n      //   超過 _DP_MAX_MIX 字元或 _DP_MAX_DEPTH 層 -> throw(呼叫端接住回 deltaReject)。\n      const _dpCanonHash = (v) => {\n        let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0, n = 0;\n        const mix = (s) => {\n          n += s.length;\n          if (n > _DP_MAX_MIX) throw new Error('dp-hash-too-big');\n          for (let i = 0; i < s.length; i++) {\n            const c = s.charCodeAt(i);\n            h1 = Math.imul(h1 ^ c, 16777619) >>> 0;\n            h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;\n          }\n        };\n        const ser = (x, d) => {\n          if (d > _DP_MAX_DEPTH) throw new Error('dp-hash-too-deep');\n          if (x === null || x === undefined) { mix('n'); return; }\n          const t = typeof x;\n          if (t === 'boolean') { mix(x ? 't' : 'f'); return; }\n          if (t === 'number') { mix(Number.isFinite(x) ? 'd' + String(x) : 'n'); return; }\n          if (t === 'string') { mix('s' + JSON.stringify(x)); return; }\n          if (Array.isArray(x)) { mix('['); for (const it of x) { ser(it, d + 1); mix(','); } mix(']'); return; }\n          if (t === 'object') {\n            const ks = Object.keys(x).sort();\n            mix('{');\n            for (const k of ks) {\n              if (x[k] === undefined) continue;   // JSON.stringify 會丟掉 undefined 欄位 => 兩端視角一致\n              mix(JSON.stringify(k) + ':'); ser(x[k], d + 1); mix(',');\n            }\n            mix('}');\n            return;\n          }\n          mix('n');   // function/symbol 等不該出現的型別 -> 當 null(JSON 視角)\n        };\n        ser(v, 0);\n        return h1.toString(16) + '-' + h2.toString(16);\n      };\n      // 純函式:把 patch 套在 base 上(就地改;base 必須是私有 clone)。\n      //   路徑最多兩層(top 或 top.sub);任何不合法 -> throw(呼叫端回 deltaReject)。\n      const _dpApplyPatch = (base, patch) => {\n        const set = patch && typeof patch === 'object' ? patch.set : null;\n        const del = patch && typeof patch === 'object' ? patch.del : null;\n        const logAppend = patch && typeof patch === 'object' ? patch.logAppend : null;\n        if (set != null && (typeof set !== 'object' || Array.isArray(set))) throw new Error('dp-bad-set');\n        if (del != null && !Array.isArray(del)) throw new Error('dp-bad-del');\n        if (logAppend != null && !Array.isArray(logAppend)) throw new Error('dp-bad-logappend');\n        const delArr = del || [], setKeys = set ? Object.keys(set) : [], appendArr = logAppend || [];\n        if (setKeys.length > _DP_MAX_SET || delArr.length > _DP_MAX_DEL || appendArr.length > _DP_MAX_LOGAPPEND) throw new Error('dp-too-many');\n        const splitPath = (p) => {\n          if (typeof p !== 'string') throw new Error('dp-bad-path');\n          const i = p.indexOf('.');\n          const segs = i < 0 ? [p] : [p.slice(0, i), p.slice(i + 1)];\n          for (const s of segs) { if (_dpBadSeg(s) || s.indexOf('.') >= 0) throw new Error('dp-bad-path'); }\n          return segs;\n        };\n        for (const p of delArr) {\n          const segs = splitPath(p);\n          if (segs.length === 1) { delete base[segs[0]]; continue; }\n          const o = base[segs[0]];\n          if (o && typeof o === 'object' && !Array.isArray(o)) delete o[segs[1]];\n        }\n        for (const p of setKeys) {\n          const segs = splitPath(p);\n          if (segs.length === 1) { base[segs[0]] = set[p]; continue; }\n          let o = base[segs[0]];\n          if (o === undefined || o === null) { o = {}; base[segs[0]] = o; }\n          if (typeof o !== 'object' || Array.isArray(o)) throw new Error('dp-set-into-nonobject');\n          o[segs[1]] = set[p];\n        }\n        if (appendArr.length > 0) {\n          const gs = base.gameState;\n          if (!gs || typeof gs !== 'object' || !Array.isArray(gs.log)) throw new Error('dp-no-log');\n          gs.log = gs.log.concat(appendArr);\n        }\n        return base;\n      };\n";
const BASE_PURE_SHA = 'e9c080c9f4b3a4750547676fd59fe90e74a7658a7d8ecb0d6cfefa5f866409ce';

// ── fixtures ──────────────────────────────────────────────────────────────
function makeDoc() {   // v6.268 守衛的同款代表性房 doc(兩層形狀)
  return {
    _id: 'ROOM',
    gameState: {
      log: [{ t: 1, msg: '甲 使用了「振翅高飛」' }, { t: 2, msg: '乙 對戰鬥場造成 120 點傷害' }],
      turn: 3, phase: 'playing', pendingSelection: null,
      p1: { hand: 5, prizes: 4 }, p2: { hand: 6, prizes: 5 },
    },
    updatedAt: 111, createdAt: 100,
    seats: [
      { role: 'p1', uid: 'u1', email: 'a@b.c', name: '甲', ready: true },
      { role: 'p2', uid: 'u2', email: null, name: '乙', ready: true },
    ],
    status: 'playing', heartbeats: { p1: 11, p2: 22 }, _version: 7,
  };
}
// ⭐ 真正的形狀:GameState.players 是**長度 2 的陣列**(src/lib/game/types.ts:766)
//   p1 的 active 刻意是 null —— 「中間節點是 null」是本版最重要的一種拒收情境。
function makeGameDoc() {
  return {
    _id: 'ROOM', status: 'playing', updatedAt: 111, createdAt: 100, _version: 7,
    seats: [{ role: 'p1', uid: 'u1', email: 'a@b.c', name: '甲' }, { role: 'p2', uid: 'u2', email: null, name: '乙' }],
    gameState: {
      turn: 3, phase: 'playing', firstPlayerIdx: 0, isFirstTurn: false,
      setupDone: [true, true], mulliganCounts: [0, 1],
      log: [{ t: 1, msg: '甲 使用了「振翅高飛」' }, { t: 2, msg: '乙 對戰鬥場造成 120 點傷害' }],
      pendingSelection: null,
      players: [
        { name: '甲', active: null, bench: [{ id: 'b1' }, { id: 'b2' }],
          hand: ['c1', 'c2', 'c3'], deck: [{ iid: 'd1' }, { iid: 'd2' }], discard: [], prizes: 6,
          flags: { energyAttachedThisTurn: false } },
        { name: '乙', active: { iid: 'a2', cardId: 'sv123', damage: 30, tools: [], status: null },
          bench: [{ id: 'b3' }], hand: ['c4'], deck: [{ iid: 'd3' }], discard: [{ iid: 'x1' }], prizes: 5,
          flags: { energyAttachedThisTurn: true } },
      ],
    },
  };
}
function requireChildProcess() { return CP; }

// ══════════════════════════════════════════════════════════════════════════
// 抽出「純函式段」實跑:修後版 vs BASE(v6.277)版
// ══════════════════════════════════════════════════════════════════════════
const PURE_S = '      const _DP_MAX_SET = 256, _DP_MAX_DEL = 256';
const PURE_E = '        return base;\n      };\n';
function extractPure(block) {
  const i = block.indexOf(PURE_S);
  if (i < 0) return null;
  const j = block.indexOf(PURE_E, i);
  if (j < 0) return null;
  return block.slice(i, j + PURE_E.length);
}
const PURE_NEW = extractPure(DPBLOCK || '');
function loadPure(src) {
  return new Function('"use strict";' + src
    + ';return { _dpApplyPatch, _dpCanonHash, _dpBadSeg,'
    + ' _dpArrIdx: (typeof _dpArrIdx === "function" ? _dpArrIdx : null),'
    + ' _DP_MAX_PATH_SEGS: (typeof _DP_MAX_PATH_SEGS === "number" ? _DP_MAX_PATH_SEGS : null) };')();
}
const NEWP = PURE_NEW ? loadPure(PURE_NEW) : null;
const OLDP = loadPure(BASE_PURE_SRC);

console.log('══ 【A】接線(行為端) ═══════════════════════════════════════════');
let CTX = null;
await T('A1 掛上 1 支 mw、hoisted=true、enabled=true、deepSegs 旗標可觀測', async () => {
  CTX = await mkCtx({ docs: { ROOM: makeDoc() } });
  const line = CTX.logs.find((l) => l.includes('delta-put middleware'));
  assert.ok(line, '沒有啟動 log: ' + CTX.logs.join(' | '));
  assert.ok(line.includes('hoisted=true') && line.includes('enabled=true'), '啟動 log 不對: ' + line);
  const m = /deepSegs=(\d+)/.exec(line);
  assert.ok(m, '啟動 log 沒有 deepSegs 旗標(伺服器沒宣告深路徑能力): ' + line);
  assert.ok(Number(m[1]) >= 3, 'deepSegs=' + m[1] + ' — 沒有比兩層更深就等於這一版沒做事');
  const st = CTX.app.__stack;
  const mwIdx = st.findIndex((l) => l.handle === CTX.mw);
  const firstRoute = st.findIndex((l) => !!l.route);
  assert.ok(mwIdx >= 0 && firstRoute > mwIdx, 'mw(' + mwIdx + ') 必須在第一個 route(' + firstRoute + ')之前');
});
await T('A2 純函式段抽得出來,且 _dpArrIdx / _DP_MAX_PATH_SEGS 真的存在', () => {
  assert.ok(PURE_NEW && PURE_NEW.length > 3000, '純函式段抽不出來');
  assert.equal(typeof NEWP._dpArrIdx, 'function', '沒有 _dpArrIdx(陣列索引判定)');
  assert.ok(typeof NEWP._DP_MAX_PATH_SEGS === 'number' && NEWP._DP_MAX_PATH_SEGS >= 3,
    '_DP_MAX_PATH_SEGS 不存在或沒放寬');
});

console.log('\n══ 【B】⭐⭐ 向後相容:兩層 patch 在 BASE 與修後**逐位元相同** ═════════');
await T('B0 嵌入的 BASE 快照真的是「只支援兩層」的舊版(正對照,不是恆真)', () => {
  const doc = { a: { b: { c: 1 } } };
  let oldThrew = false;
  try { OLDP._dpApplyPatch(structuredClone(doc), { set: { 'a.b.c': 2 }, del: [] }); }
  catch { oldThrew = true; }
  assert.ok(oldThrew, '嵌入的快照竟然吃得下三段路徑 ⇒ 那不是 BASE 的程式碼,B1/B2 全是安慰劑');
  const out = NEWP._dpApplyPatch(structuredClone(doc), { set: { 'a.b.c': 2 }, del: [] });
  assert.equal(out.a.b.c, 2, '修後版應該吃得下三段路徑');
});
await T('B0b BASE 快照 sha256 鎖住(內嵌,history-free)', () => {
  const sha = createHash('sha256').update(BASE_PURE_SRC, 'utf8').digest('hex');
  assert.equal(sha, BASE_PURE_SHA, '嵌入的 BASE 快照被改過了');
});
await T('B1 固定案例:BASE 與修後對同一批兩層 patch 產出逐位元相同的 doc', () => {
  const cases = [
    { set: { status: 'x' }, del: [] },
    { set: { 'gameState.turn': 9 }, del: [] },
    { set: {}, del: ['heartbeats'] },
    { set: {}, del: ['gameState.pendingSelection'] },
    { set: {}, del: ['gameState.nope', 'nope2'] },                     // 不存在的鍵
    { set: { 'gameState.p1': { hand: 1 } }, del: ['gameState.p2'] },
    { set: { newTop: { a: [1, 2, { z: '中文' }] } }, del: [] },
    { set: { 'seats.0': { uid: 'x' } }, del: [] },                     // ⚠ 父是陣列:BASE 會 throw
    { set: { 'missing.sub': 1 }, del: [] },                            // ⚠ BASE 的「自動建物件」舊語義
    { set: { 'status.sub': 1 }, del: [] },                             // ⚠ 父是字串:BASE 會 throw
    { set: {}, del: ['seats.0'] },                                     // ⚠ 父是陣列:BASE 靜默略過
    { set: { 'gameState.log': [{ t: 9 }] }, del: [] },
    { set: {}, del: [], logAppend: [{ t: 5, msg: '追加' }] },
  ];
  for (const p of cases) {
    const d1 = clientView(makeDoc()), d2 = clientView(makeDoc());
    let r1, r2, e1 = null, e2 = null;
    try { r1 = JSON.stringify(OLDP._dpApplyPatch(d1, structuredClone(p))); } catch (e) { e1 = e.message; }
    try { r2 = JSON.stringify(NEWP._dpApplyPatch(d2, structuredClone(p))); } catch (e) { e2 = e.message; }
    assert.equal(e2, e1, '例外行為不同(' + JSON.stringify(p).slice(0, 70) + '): BASE=' + e1 + ' 新=' + e2);
    assert.equal(r2, r1, '產出不同(' + JSON.stringify(p).slice(0, 70) + ')');
  }
});
await T('B2 fuzz 6,000 次兩層 patch:BASE 與修後產出的 JSON 字串逐位元相同', () => {
  let s = 62780001;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rv = (d) => {
    const r = rnd();
    if (d > 2 || r < 0.3) return pick([1, 0, -3.5, 'x', '中文字串', true, false, null, 42.25]);
    if (r < 0.55) { const n = Math.floor(rnd() * 3); const a = []; for (let i = 0; i < n; i++) a.push(rv(d + 1)); return a; }
    const o = {}; const n = Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) o['k' + Math.floor(rnd() * 5)] = rv(d + 1);
    return o;
  };
  const TOPS = ['status', 'seats', 'heartbeats', 'winner', 'missingA'];
  const SUBS = ['turn', 'phase', 'p1', 'p2', 'log', 'missingB'];
  let ran = 0, diffs = 0;
  for (let it = 0; it < 6000; it++) {
    const doc = clientView(makeDoc());
    if (rnd() < 0.4) doc.blob = rv(0);
    const patch = { set: {}, del: [] };
    const nOps = 1 + Math.floor(rnd() * 5);
    for (let i = 0; i < nOps; i++) {
      const r = rnd();
      if (r < 0.25) patch.set[pick(TOPS)] = rv(0);
      else if (r < 0.45) patch.set['gameState.' + pick(SUBS)] = rv(0);
      else if (r < 0.6) patch.del.push(pick(TOPS));
      else if (r < 0.75) patch.del.push('gameState.' + pick(SUBS));
      else if (r < 0.85) patch.set[pick(TOPS) + '.' + pick(SUBS)] = rv(0);   // 任意兩層(含父是陣列/字串)
      else patch.del.push(pick(TOPS) + '.' + pick(SUBS));
    }
    if (rnd() < 0.2) patch.logAppend = [{ t: it, m: '第' + it + '筆' }];
    let r1, r2, e1 = null, e2 = null;
    try { r1 = JSON.stringify(OLDP._dpApplyPatch(structuredClone(doc), structuredClone(patch))); } catch (e) { e1 = e.message; }
    try { r2 = JSON.stringify(NEWP._dpApplyPatch(structuredClone(doc), structuredClone(patch))); } catch (e) { e2 = e.message; }
    if (e1 !== e2 || r1 !== r2) { diffs++; assert.fail('fuzz #' + it + ' 兩層 patch 行為不同: BASE=' + (e1 || r1 || '').slice(0, 200) + ' / 新=' + (e2 || r2 || '').slice(0, 200)); }
    ran++;
  }
  assert.equal(ran, 6000);
  assert.equal(diffs, 0);
  console.log('        兩層 patch 對跑 6,000 次:BASE 與修後**零差異**');
});
await T('B3 端到端:v6.270 規格的兩層 patch 走真 middleware 仍然成功', async () => {
  const doc = makeDoc();
  const prev = clientView(doc);
  const next = structuredClone(prev);
  next.gameState.turn = 4;
  next.gameState.log = next.gameState.log.concat([{ t: 3, msg: '丙 放置了傷害指示物' }]);
  next.seats[0].ready = false;
  const req = fakeReq('PUT', '/api/rooms/ROOM', makeBody(refDiff2(prev, next), next, 7));
  const { res, nexted } = await callMw(CTX.mw, req);
  assert.ok(nexted, '兩層 patch 被拒: ' + JSON.stringify(res.body ?? null).slice(0, 200));
  assert.equal(refCanonHash(req.body.data), refCanonHash(simKeepEmail(next, doc)), '重建結果不一致');
  assert.equal(req.body.data.seats[0].email, 'a@b.c', 'v1.20 email 回填被破壞');
});
await T('B4 舊 client 的**全量** PUT 仍逐位元原樣通過', async () => {
  const body = { data: clientView(makeDoc()), expectedVersion: 7 };
  const snap = JSON.stringify(body);
  const req = fakeReq('PUT', '/api/rooms/ROOM', body);
  const { res, nexted } = await callMw(CTX.mw, req);
  assert.ok(nexted && !res.jsonCalled, '全量 PUT 必須 next()');
  assert.ok(req.body === body && JSON.stringify(req.body) === snap, 'body 被動到了');
});

console.log('\n══ 【C】深路徑支援範圍 ═════════════════════════════════════════');
await T('C1 3~8 段路徑都可用;9 段一律拒(段數上限)', async () => {
  assert.equal(NEWP._DP_MAX_PATH_SEGS, 8, '本版宣告的段數上限是 8');
  for (let n = 3; n <= 8; n++) {
    const doc = {}; let cur = doc;
    for (let i = 0; i < n - 1; i++) { cur['s' + i] = {}; cur = cur['s' + i]; }
    cur.leaf = 0;
    const p = Array.from({ length: n - 1 }, (_, i) => 's' + i).concat(['leaf']).join('.');
    const out = NEWP._dpApplyPatch(structuredClone(doc), { set: { [p]: n }, del: [] });
    let v = out; for (let i = 0; i < n - 1; i++) v = v['s' + i];
    assert.equal(v.leaf, n, n + ' 段路徑失敗');
  }
  const doc9 = {}; let c9 = doc9;
  for (let i = 0; i < 8; i++) { c9['s' + i] = {}; c9 = c9['s' + i]; }
  c9.leaf = 0;
  assert.throws(() => NEWP._dpApplyPatch(structuredClone(doc9),
    { set: { 's0.s1.s2.s3.s4.s5.s6.s7.leaf': 1 }, del: [] }), /dp-bad-path/, '9 段必須拒');
});
await T('C2 陣列索引判定 _dpArrIdx:只認規範的十進位非負整數字串', () => {
  const f = NEWP._dpArrIdx;
  for (const [s, want] of [['0', 0], ['1', 1], ['12', 12], ['999999999', 999999999]]) {
    assert.equal(f(s), want, '應接受 ' + JSON.stringify(s));
  }
  for (const s of ['', '01', '007', '-1', '+1', '1.5', '1e3', ' 1', '1 ', 'a', '0x1', '1234567890',
                   '١', 'Infinity', 'NaN', '.0', '-0']) {
    assert.equal(f(s), -1, '應拒絕 ' + JSON.stringify(s));
  }
});
await T('C3 真實形狀:gameState.players.0.hand 與 gameState.players.1.active.damage 都寫得進去', () => {
  const doc = makeGameDoc();
  const out = NEWP._dpApplyPatch(structuredClone(doc), {
    set: { 'gameState.players.0.hand': ['c9', 'c10'], 'gameState.players.1.active.damage': 70 }, del: [] });
  assert.deepEqual(out.gameState.players[0].hand, ['c9', 'c10']);
  assert.equal(out.gameState.players[1].active.damage, 70);
  assert.ok(Array.isArray(out.gameState.players), 'players 不再是陣列!');
  assert.equal(out.gameState.players.length, 2, 'players 長度變了');
});

console.log('\n══ 【D】⭐⭐ 六道防護(逐條行為端) ═══════════════════════════════');
const bad = (doc, patch, re, why) => {
  assert.throws(() => NEWP._dpApplyPatch(structuredClone(doc), patch), re, why);
};
await T('D1 ①陣列**永遠不會被寫成物件**:越界索引一律 throw,而不是 arr["5"]=…', () => {
  const doc = makeGameDoc();
  bad(doc, { set: { 'gameState.players.2.hand': [] }, del: [] }, /dp-bad-index/, '越界索引必須拒');
  bad(doc, { set: { 'gameState.players.2': {} }, del: [] }, /dp-bad-index/, '越界索引(葉節點)必須拒');
  // 正對照:合法索引真的寫得進去(證明上面不是「什麼都拒」)
  const ok = NEWP._dpApplyPatch(structuredClone(doc), { set: { 'gameState.players.1.hand': ['z'] }, del: [] });
  assert.deepEqual(ok.gameState.players[1].hand, ['z']);
});
await T('D2 ②**永不 sparse**:對陣列 del 一律 throw;越界 set 也不會挖洞', () => {
  const doc = makeGameDoc();
  bad(doc, { set: {}, del: ['gameState.players.0'] }, /dp-del-into-array/, '刪陣列元素必須拒');
  bad(doc, { set: {}, del: ['gameState.players.0.hand.0'] }, /dp-del-into-array/, '刪陣列元素必須拒');
  bad(doc, { set: { 'gameState.players.0.hand.9': 'x' }, del: [] }, /dp-bad-index/, '越界寫入必須拒');
  const out = NEWP._dpApplyPatch(structuredClone(doc), { set: { 'gameState.players.0.hand.0': 'q' }, del: [] });
  assert.deepEqual(out.gameState.players[0].hand, ['q', 'c2', 'c3'], '合法索引寫入結果不對');
  assert.equal(JSON.stringify(out.gameState.players[0].hand).indexOf('null'), -1, '出現了洞');
});
await T('D3 ③索引必須合法且在既有長度內(**禁擴張**);長度要變就整個陣列當一個值 set', () => {
  const doc = makeGameDoc();
  for (const p of ['gameState.players.-1.hand', 'gameState.players.01.hand',
                   'gameState.players.1.5.hand', 'gameState.players. 0.hand']) {
    bad(doc, { set: { [p]: 1 }, del: [] }, /dp-bad-index|dp-bad-path|dp-missing-node/, p + ' 必須拒');
  }
  bad(doc, { set: { 'gameState.players.0.bench.2': { id: 'x' } }, del: [] }, /dp-bad-index/,
    'bench 只有 2 隻,寫 index 2 = 擴張,必須拒');
  // ⭐ 合法做法:整個 bench 陣列當**一個值** set 給父物件(這才是 client 加一隻備戰的送法)
  const out = NEWP._dpApplyPatch(structuredClone(doc),
    { set: { 'gameState.players.0.bench': [{ id: 'b1' }, { id: 'b2' }, { id: 'x' }] }, del: [] });
  assert.equal(out.gameState.players[0].bench.length, 3, '整包 set 才是擴張的正確路徑');
});
await T('D4 ④原型污染:__proto__ / constructor / prototype 三個名字在**任何位置**都被拒', () => {
  const doc = makeGameDoc();
  try {
    for (const seg of ['__proto__', 'constructor', 'prototype']) {
      for (const p of [seg, 'gameState.' + seg, 'gameState.players.0.' + seg,
                       'gameState.' + seg + '.x.y', seg + '.a.b.c']) {
        bad(doc, { set: { [p]: { dpPolluted6278: 1 } }, del: [] }, /dp-bad-path/, 'set ' + p + ' 必須拒');
        bad(doc, { set: {}, del: [p] }, /dp-bad-path/, 'del ' + p + ' 必須拒');
      }
    }
    assert.equal(({}).dpPolluted6278, undefined, 'Object.prototype 被污染了!');
    assert.equal([].dpPolluted6278, undefined, 'Array.prototype 被污染了!');
  } finally { delete Object.prototype.dpPolluted6278; }
});
await T('D4b 不沿原型鏈走:中間節點寫 toString/valueOf 一律當「不存在」', () => {
  const doc = makeGameDoc();
  bad(doc, { set: { 'gameState.toString.x': 1 }, del: [] }, /dp-missing-node/, '原型上的方法不得當中間節點');
  bad(doc, { set: { 'gameState.players.0.valueOf.x': 1 }, del: [] }, /dp-missing-node/, '同上');
});
await T('D5 ⑤上限:set/del 256、logAppend 512、路徑總長、hash 工作量 全部保留', () => {
  const doc = makeGameDoc();
  const set = {}; for (let i = 0; i < 257; i++) set['gameState.players.0.f' + i] = i;
  bad(doc, { set, del: [] }, /dp-too-many/, 'set 257 條必須拒');
  const del = []; for (let i = 0; i < 257; i++) del.push('gameState.players.0.f' + i);
  bad(doc, { set: {}, del }, /dp-too-many/, 'del 257 條必須拒');
  const la = []; for (let i = 0; i < 513; i++) la.push({ t: i });
  bad(doc, { set: {}, del: [], logAppend: la }, /dp-too-many/, 'logAppend 513 條必須拒');
  bad(doc, { set: { ['a.' + 'x'.repeat(300) + '.b']: 1 }, del: [] }, /dp-bad-path/, '單段超過 256 字元必須拒');
  bad(doc, { set: { [Array.from({ length: 40 }, () => 'seg').join('.')]: 1 }, del: [] }, /dp-bad-path/, '超長路徑必須拒');
  // 正對照:剛好 256 條深路徑要能過(證明上面不是「都拒」)
  const ok = {}; for (let i = 0; i < 256; i++) ok['gameState.players.0.f' + i] = i;
  const out = NEWP._dpApplyPatch(structuredClone(doc), { set: ok, del: [] });
  assert.equal(out.gameState.players[0].f255, 255, '256 條深路徑應該要過');
});
await T('D6 ⑥中間節點 null / 缺席 / 不是物件 ⇒ 一律 throw(絕不自動建物件)', () => {
  const doc = makeGameDoc();
  assert.equal(doc.gameState.players[0].active, null, 'fixture 前提:p1 的 active 是 null');
  bad(doc, { set: { 'gameState.players.0.active.damage': 10 }, del: [] }, /dp-set-into-nonobject/,
    'active 是 null 時寫 .damage 必須拒(不可憑空生出一隻寶可夢)');
  bad(doc, { set: { 'gameState.nope.a.b': 1 }, del: [] }, /dp-missing-node/, '中間節點缺席必須拒');
  bad(doc, { set: { 'gameState.phase.a.b': 1 }, del: [] }, /dp-set-into-nonobject/, '中間節點是字串必須拒');
  bad(doc, { set: {}, del: ['gameState.nope.a.b'] }, /dp-missing-node/, 'del 的中間節點缺席也必須拒');
  bad(doc, { set: { 'gameState.players.0.active.x.y': 1 }, del: [] }, /dp-set-into-nonobject/, 'null 中間節點(更深)');
  // ⚠ 兩層的「自動建物件」舊語義**刻意保留**(向後相容),這裡明確釘住它沒被順手改掉
  const out = NEWP._dpApplyPatch({ a: 1 }, { set: { 'zz.k': 5 }, del: [] });
  assert.deepEqual(out.zz, { k: 5 }, '兩層的舊語義被改掉了 ⇒ 舊 client 行為會變');
});

console.log('\n══ 【E】⭐ 惡意 patch 六種:deltaReject 且 DB 一個位元沒動 ═══════════');
await T('E1 六種惡意深路徑全部 422 error、不 next()、DB doc 未被寫入', async () => {
  const evil = [
    ['__proto__', { set: { '__proto__.dpEvil': 1 }, del: [] }],
    ['constructor', { set: { 'constructor.prototype.dpEvil': 1 }, del: [] }],
    ['prototype', { set: { 'gameState.prototype.dpEvil': 1 }, del: [] }],
    ['players.5.hand(越界)', { set: { 'gameState.players.5.hand': [] }, del: [] }],
    ['players.-1.hand(負索引)', { set: { 'gameState.players.-1.hand': [] }, del: [] }],
    ['players.0.1.2(過深/中間節點不存在)', { set: { 'gameState.players.0.1.2': 1 }, del: [] }],
  ];
  try {
    for (const [label, patch] of evil) {
      const doc = makeGameDoc();
      const holder = { docs: { ROOM: doc } };
      const snap = JSON.stringify(doc);
      const ctx = await mkCtx(holder);
      const body = { patchProto: 1, expectedVersion: doc._version, fullHash: refCanonHash(clientView(doc)), patch };
      const { res, nexted } = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', body));
      assert.ok(!nexted, label + ':惡意 patch 竟然流進核心 PUT!');
      assert.equal(res.statusCode, 422, label + ' 狀態碼');
      assert.equal(res.body.deltaReject, 1, label + ' 沒有 deltaReject');
      assert.equal(res.body.deltaReason, 'error', label + ' deltaReason');
      assert.equal(JSON.stringify(holder.docs.ROOM), snap, label + ':DB doc 被動到了!');
      assert.equal(({}).dpEvil, undefined, label + ':Object.prototype 被污染!');
      assert.equal([].dpEvil, undefined, label + ':Array.prototype 被污染!');
    }
  } finally { delete Object.prototype.dpEvil; }
});
await T('E2 「看起來合法但改壞盤面」的 patch 被 canonical hash 複驗擋下(最後防線還在)', async () => {
  const doc = makeGameDoc();
  const ctx = await mkCtx({ docs: { ROOM: doc } });
  const prev = clientView(doc);
  const next = structuredClone(prev);
  next.gameState.players[0].prizes = 1;                     // client 宣告的 newData
  const patch = refDiffDeep(prev, next);
  assert.ok(patch, 'refDiffDeep 應產得出 patch');
  patch.set['gameState.players.0.prizes'] = 0;              // ⚠ 偷改成別的值(hash 對不上)
  const { res, nexted } = await callMw(ctx.mw,
    fakeReq('PUT', '/api/rooms/ROOM', makeBody(patch, next, doc._version)));
  assert.ok(!nexted, '與 fullHash 不符的深路徑 patch 竟然過了 ⇒ 最後防線失效');
  assert.equal(res.body.deltaReason, 'hash');
});

console.log('\n══ 【F】哨兵:deltaPut 維持 1 + deltaPutDeep:1 ═════════════════════');
await T('F1 GET {room} 回應同時帶 deltaPut:1 與 deltaPutDeep:1;404/list 都不加', async () => {
  const res = fakeRes();
  await CTX.mw(fakeReq('GET', '/api/rooms/ROOM?since=3'), res, () => {});
  const room = makeDoc();
  res.json({ room });
  assert.equal(res.body.deltaPut, 1, '⚠⚠ deltaPut 必須維持 1(v6.270 client 是嚴格比較)');
  assert.equal(res.body.deltaPutDeep, 1, '沒有深路徑哨兵 ⇒ 下一版 client 認不出伺服器支援');
  assert.ok(res.body.room === room, 'room 本體不得被動');
  const r2 = fakeRes();
  await CTX.mw(fakeReq('GET', '/api/rooms/NOPE'), r2, () => {});
  r2.json({ error: 'room not found' });
  assert.ok(!('deltaPut' in r2.body) && !('deltaPutDeep' in r2.body), '404 不該有哨兵');
  const r3 = fakeRes();
  await CTX.mw(fakeReq('GET', '/api/rooms?status=lobby'), r3, () => {});
  r3.json({ rooms: [] });
  assert.ok(!('deltaPut' in r3.body) && !('deltaPutDeep' in r3.body), '列表不該有哨兵');
});
await T('F2 ⭐⭐ 舊 client 讀到新哨兵不會壞:抽 oracle-client.ts 的判斷式**實跑**', async () => {
  // ⚠ 工作樹可能是 CRLF(Windows checkout)⇒ 先正規化,否則抽取器會在沙盒假紅
  const OC = readFileSync(path.join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8').replace(/\r\n/g, '\n');
  const i = OC.indexOf('function _noteDeltaPutSentinel(');
  assert.ok(i > 0, '抽不到 v6.270 的哨兵判斷式(掃描器壞了?)');
  const j = OC.indexOf('\n}\n', i);
  assert.ok(j > i, '抽不到函式結尾');
  const src = OC.slice(i, j + 3);
  // 只把型別註記剝掉(這段沒有其他 TS 語法);剝完必須還看得到 === 1 才算抽對
  const js = src.replace(/: unknown/g, '').replace(/: void/g, '')
    .replace(/ as \{[^}]*\}( \| null \| undefined)?/g, '');
  assert.ok(js.includes('=== 1'), '剝型別後判斷式不見了 ⇒ 抽取器壞了(這是掃描器自驗)');
  const run = new Function('"use strict"; let _dpSentinel = false;' + js
    + ';return (b) => { _dpSentinel = false; _noteDeltaPutSentinel(b); return _dpSentinel; };')();
  // 正對照:BASE 的舊回應(只有 deltaPut:1)
  assert.equal(run({ room: {}, deltaPut: 1 }), true, '正對照壞了');
  // ⭐ 本版新回應:多一個 deltaPutDeep,舊 client 仍必須判成「支援」
  assert.equal(run({ room: {}, deltaPut: 1, deltaPutDeep: 1 }), true,
    '⚠⚠ 舊 client 讀到新哨兵會退回全量 ⇒ 上行倒退');
  // ⚠ 反證:若把 deltaPut 改成 2,舊 client 會判成「不支援」 ⇒ 這就是不能改成 2 的理由
  assert.equal(run({ room: {}, deltaPut: 2, deltaPutDeep: 1 }), false,
    'deltaPut:2 竟然還被舊 client 接受? 那 F2 的反證失效了');
  // 伺服器實際送出的那顆 body 直接餵進去(端到端,不是手寫的假 body)
  const res = fakeRes();
  await CTX.mw(fakeReq('GET', '/api/rooms/ROOM'), res, () => {});
  res.json({ room: makeDoc() });
  assert.equal(run(res.body), true, '伺服器實際回應讓舊 client 退回全量了');
});
await T('F3 kill switch:_DELTA_PUT_ENABLED=false ⇒ **兩個**哨兵一起消失、深 patch 回 422 disabled', async () => {
  const off = DPBLOCK.replace('const _DELTA_PUT_ENABLED = true;', 'const _DELTA_PUT_ENABLED = false;');
  assert.notEqual(off, DPBLOCK, 'kill switch 出貨值不是 true?');
  const ctx = await makeCtxFactory(off)({ docs: { ROOM: makeGameDoc() } });
  const res = fakeRes();
  await ctx.mw(fakeReq('GET', '/api/rooms/ROOM'), res, () => {});
  res.json({ room: makeDoc() });
  assert.ok(!('deltaPut' in res.body), '停用後 deltaPut 必須消失');
  assert.ok(!('deltaPutDeep' in res.body), '停用後 deltaPutDeep 必須消失');
  const doc = makeGameDoc();
  const prev = clientView(doc); const next = structuredClone(prev); next.gameState.players[0].prizes = 2;
  const r2 = await callMw(ctx.mw, fakeReq('PUT', '/api/rooms/ROOM', makeBody(refDiffDeep(prev, next), next, doc._version)));
  assert.ok(!r2.nexted && r2.res.statusCode === 422 && r2.res.body.deltaReason === 'disabled',
    '停用後深 patch 必須 422 disabled(絕不可流進核心 PUT)');
});
await T('F4 出貨值必須是啟用', () => {
  assert.ok(DPBLOCK.includes('const _DELTA_PUT_ENABLED = true;'), 'kill switch 出貨值不是 true');
});

console.log('\n══ 【G】⭐⭐⭐ round-trip fuzz 20,000 次(重點:陣列) ═══════════════');
await T('G1 深層 diff → 真 middleware apply → canonical hash 與 client newData 逐位元相同', async () => {
  let s = 62782026;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ri = (n) => Math.floor(rnd() * n);
  const card = () => ({ iid: 'i' + ri(999), cardId: 'sv' + ri(300), damage: ri(30) * 10,
    tools: rnd() < 0.3 ? [{ iid: 't' + ri(9) }] : [], status: rnd() < 0.2 ? pick(['中毒', '灼傷', '麻痺']) : null });
  const zone = (n) => Array.from({ length: n }, card);
  const mkPlayer = (i) => ({
    name: pick(['甲', '乙', '小明', 'Wilson']),
    active: rnd() < 0.25 ? null : card(),
    bench: zone(ri(6)), hand: zone(ri(8)), deck: zone(ri(12)), discard: zone(ri(6)),
    prizes: ri(7), energyAttachedThisTurn: rnd() < 0.5, flags: { a: ri(3), b: rnd() < 0.5 ? undefined : '值' },
  });
  const mkDoc = () => ({
    _id: 'F', _version: 1 + ri(5), status: 'playing', updatedAt: 5, createdAt: 1,
    gameState: { turn: 1 + ri(20), phase: pick(['setup', 'playing', 'game-over']),
      players: [mkPlayer(0), mkPlayer(1)], log: [{ t: 1, m: '開局' }],
      pendingSelection: rnd() < 0.3 ? { effectKey: '振翅高飛', iids: ['i1', 'i2'] } : null },
  });
  let ran = 0, deepPaths = 0, arrPaths = 0, fullFallback = 0, maxSegs = 0;
  const holder = { docs: {} };
  const ctx = await mkCtx(holder);
  for (let it = 0; it < 20000; it++) {
    const doc = mkDoc();
    holder.docs.F = doc;
    const prev = clientView(doc);
    const next = structuredClone(prev);
    const nOps = 1 + ri(5);
    for (let o = 0; o < nOps; o++) {
      const pi = ri(2), P = next.gameState.players[pi];
      const r = rnd();
      if (r < 0.14) { if (P.hand.length) P.hand[ri(P.hand.length)] = card(); else P.hand.push(card()); }   // 同長度改元素
      else if (r < 0.24) P.hand = zone(ri(9));                    // ⚠ 陣列長度變動
      else if (r < 0.32) P.bench = zone(ri(6));                   // ⚠ 陣列長度變動(備戰加/減)
      else if (r < 0.40) { if (P.bench.length) P.bench[ri(P.bench.length)].damage = ri(30) * 10; }
      else if (r < 0.48) P.active = rnd() < 0.35 ? null : card(); // ⚠ 中間節點變 null / 由 null 變物件
      else if (r < 0.55) { if (P.active) P.active.damage = ri(30) * 10; }
      else if (r < 0.62) P.prizes = ri(7);
      else if (r < 0.68) { if (P.deck.length) P.deck.splice(0, 1 + ri(2)); }   // ⚠ 長度變動
      else if (r < 0.74) delete P.flags;                          // ⚠ 深層刪欄
      else if (r < 0.79) P.flags = { a: ri(3), c: '新欄位' };
      else if (r < 0.84) next.gameState.turn = ri(30);
      else if (r < 0.88) next.gameState.pendingSelection = rnd() < 0.5 ? null : { effectKey: '沸騰鬥志', iids: [] };
      else if (r < 0.92) { next.gameState.players = [mkPlayer(0), mkPlayer(1)]; }   // ⚠ 整個 players 換掉
      else if (r < 0.96) next.gameState.log = next.gameState.log.concat([{ t: 2 + o, m: '第' + it + '筆中文紀錄' }]);
      else next.status = pick(['playing', 'ended', 'lobby']);
    }
    const patch = refDiffDeep(prev, next);
    if (!patch) { fullFallback++; continue; }
    for (const k of Object.keys(patch.set).concat(patch.del)) {
      const n = k.split('.').length;
      if (n > maxSegs) maxSegs = n;
      if (n >= 3) deepPaths++;
      if (/\.\d+(\.|$)/.test(k)) arrPaths++;
    }
    const req = fakeReq('PUT', '/api/rooms/F', makeBody(patch, next, doc._version));
    const { res, nexted } = await callMw(ctx.mw, req);
    assert.ok(nexted, 'fuzz #' + it + ' 被拒: ' + JSON.stringify(res.body ?? null).slice(0, 150)
      + ' patch=' + JSON.stringify(patch).slice(0, 300));
    const got = req.body.data;
    assert.equal(refCanonHash(got), refCanonHash(next), 'fuzz #' + it + ' 重建結果與 client newData 不一致');
    // ⭐ players 永遠是長度 2 的陣列、永遠不是物件、永遠不 sparse
    const pl = got.gameState.players;
    assert.ok(Array.isArray(pl), 'fuzz #' + it + ' players 變成物件了!');
    assert.equal(pl.length, 2, 'fuzz #' + it + ' players 長度不是 2');
    assert.equal(JSON.stringify(pl).includes('null,null'), JSON.stringify(next.gameState.players).includes('null,null'),
      'fuzz #' + it + ' 出現了非預期的洞');
    for (const P of pl) {
      for (const z of ['bench', 'hand', 'deck', 'discard']) {
        assert.ok(Array.isArray(P[z]), 'fuzz #' + it + ' ' + z + ' 不是陣列');
        for (let i = 0; i < P[z].length; i++) {
          assert.ok(Object.prototype.hasOwnProperty.call(P[z], i), 'fuzz #' + it + ' ' + z + ' 出現 sparse 洞');
        }
      }
    }
    ran++;
  }
  assert.ok(ran + fullFallback === 20000, '跑的次數不對');
  assert.ok(ran >= 19000, '成功套用的只有 ' + ran + ' 次(退全量 ' + fullFallback + ' 次)— fuzz 產能太低');
  assert.ok(deepPaths > 20000, '深路徑只產生 ' + deepPaths + ' 條 — fuzz 沒有真的在測深路徑');
  assert.ok(arrPaths > 3000, '陣列索引路徑只產生 ' + arrPaths + ' 條 — fuzz 沒有真的在測陣列');
  assert.ok(maxSegs >= 5, '最深只到 ' + maxSegs + ' 段 — fuzz 沒有壓到深處');
  console.log('        fuzz 20,000 次:成功 ' + ran + ' / 退全量 ' + fullFallback
    + ';深路徑 ' + deepPaths + ' 條、其中陣列索引 ' + arrPaths + ' 條、最深 ' + maxSegs + ' 段');
});

console.log('\n══ 【H】⭐⭐ 事件迴圈:深路徑 apply 的阻塞(Rule 32:附量測腳本) ═══════');
await T('H1 48KB 代表性房 doc + 深路徑 patch:一輪(clone+apply+hash+回填)p50/p99 上限', async () => {
  const doc = makeGameDoc();
  const pad = [];
  for (let i = 0; i < 450; i++) pad.push({ t: i, msg: '第 ' + i + ' 手:對戰紀錄中文填充字串,約一百位元組長度的樣板文字內容補齊補齊補齊' });
  doc.gameState.log = pad;
  for (const P of doc.gameState.players) {
    P.deck = Array.from({ length: 60 }, (_, i) => ({ iid: 'd' + i, cardId: 'sv' + i, note: '牌庫卡片填充文字'.repeat(10) }));
    P.discard = Array.from({ length: 20 }, (_, i) => ({ iid: 'x' + i, cardId: 'sv' + i, note: '棄牌區填充文字'.repeat(10) }));
  }
  const bytes = JSON.stringify(doc).length;
  assert.ok(bytes > 40000, '代表性 doc 應大於 40KB,實得 ' + bytes);
  const holder = { docs: { ROOM: doc } };
  const ctx = await mkCtx(holder);
  const prev = clientView(doc);
  const run = async (mkPatch, label) => {
    const times = [];
    for (let i = 0; i < 300; i++) {
      const next = structuredClone(prev);
      const patch = mkPatch(next, i);
      const req = fakeReq('PUT', '/api/rooms/ROOM', makeBody(patch, next, doc._version));
      const t0 = process.hrtime.bigint();
      const { res, nexted } = await callMw(ctx.mw, req);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      assert.ok(nexted, label + ' 第 ' + i + ' 輪被拒: ' + JSON.stringify(res.body ?? null).slice(0, 150));
    }
    times.sort((a, b) => a - b);
    return { p50: times[Math.floor(times.length * 0.5)], p99: times[Math.floor(times.length * 0.99)],
      max: times[times.length - 1] };
  };
  // ①兩層 patch(=今天線上跑的形狀)
  const two = await run((next, i) => {
    next.gameState.turn = i;
    next.gameState.log = next.gameState.log.concat([{ t: 9000 + i, msg: '新事件' + i }]);
    return refDiff2(prev, next);
  }, '兩層');
  // ②深路徑 patch(=下一版 client 的形狀)
  const deep = await run((next, i) => {
    next.gameState.turn = i;
    next.gameState.players[0].prizes = i % 7;
    if (next.gameState.players[1].active) next.gameState.players[1].active.damage = (i % 20) * 10;
    next.gameState.players[0].hand[0] = { iid: 'n' + i, cardId: 'sv1', damage: 0, tools: [], status: null };
    next.gameState.log = next.gameState.log.concat([{ t: 9000 + i, msg: '新事件' + i }]);
    return refDiffDeep(prev, next);
  }, '深路徑');
  // ③最壞情況:256 條深路徑 set(上限值)
  const worst = await run((next) => {
    const set = {};
    for (let k = 0; k < 256; k++) set['gameState.players.' + (k % 2) + '.deck.' + (k % 40) + '.note'] = 'w' + k;
    for (const k of Object.keys(set)) {
      const segs = k.split('.');
      next.gameState.players[Number(segs[2])].deck[Number(segs[4])].note = set[k];
    }
    return { set, del: [] };
  }, '256 條深路徑');
  console.log('        doc=' + (bytes / 1024).toFixed(1) + 'KB(沙盒;正式 VM 實測約快 10 倍)');
  console.log('        ①兩層     p50=' + two.p50.toFixed(2) + 'ms p99=' + two.p99.toFixed(2) + 'ms max=' + two.max.toFixed(2) + 'ms');
  console.log('        ②深路徑   p50=' + deep.p50.toFixed(2) + 'ms p99=' + deep.p99.toFixed(2) + 'ms max=' + deep.max.toFixed(2) + 'ms');
  console.log('        ③256 條   p50=' + worst.p50.toFixed(2) + 'ms p99=' + worst.p99.toFixed(2) + 'ms max=' + worst.max.toFixed(2) + 'ms');
  // 驗收標準(沙盒值;VM 約 1/10)
  assert.ok(deep.p99 < 40, '深路徑 p99=' + deep.p99.toFixed(2) + 'ms 超過 40ms(沙盒;≈VM 4ms)');
  assert.ok(worst.p99 < 60, '上限筆數 p99=' + worst.p99.toFixed(2) + 'ms 超過 60ms(沙盒;≈VM 6ms)');
  // ⭐ 相對量級:深路徑不得比兩層慢一個數量級(成本主體是 clone+hash,與路徑深度無關)
  assert.ok(deep.p99 < two.p99 * 3 + 5,
    '深路徑 p99(' + deep.p99.toFixed(2) + ') 相對兩層(' + two.p99.toFixed(2) + ') 退化超過 3 倍');
  assert.ok(worst.p99 < two.p99 * 4 + 5,
    '256 條 p99(' + worst.p99.toFixed(2) + ') 相對兩層(' + two.p99.toFixed(2) + ') 退化超過 4 倍');
});
await T('H2 突變自驗:拿掉 set 條數上限後,「1 萬條深路徑」會把事件迴圈抱住 ⇒ 上限確實在讓路', async () => {
  const noCap = DPBLOCK.replace('setKeys.length > _DP_MAX_SET', 'false');
  assert.notEqual(noCap, DPBLOCK, '突變沒套上');
  const doc = makeGameDoc();
  for (const P of doc.gameState.players) P.deck = Array.from({ length: 40 }, (_, i) => ({ iid: 'd' + i, note: 'x' }));
  const set = {};
  for (let k = 0; k < 10000; k++) set['gameState.players.' + (k % 2) + '.deck.' + (k % 40) + '.n' + k] = k;
  const body = { patchProto: 1, expectedVersion: doc._version, fullHash: 'ffffffff-ffffffff', patch: { set, del: [] } };
  const ctxOK = await mkCtx({ docs: { ROOM: doc } });
  const r1 = await callMw(ctxOK.mw, fakeReq('PUT', '/api/rooms/ROOM', structuredClone(body)));
  assert.ok(!r1.nexted && r1.res.body.deltaReason === 'error', '出貨碼必須用條數上限擋掉 1 萬條');
  const ctxBad = await makeCtxFactory(noCap)({ docs: { ROOM: doc } });
  const t0 = process.hrtime.bigint();
  const r2 = await callMw(ctxBad.mw, fakeReq('PUT', '/api/rooms/ROOM', structuredClone(body)));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(!r2.nexted, '突變體仍會被 hash 擋(這是預期);重點是它花的時間');
  console.log('        突變體(無條數上限)處理 1 萬條深路徑耗時 ' + ms.toFixed(1) + 'ms — 出貨碼直接拒收(<1ms)');
  assert.ok(ms > 3, '突變體只花 ' + ms.toFixed(2) + 'ms ⇒ 這個上限沒有在防什麼,H1/H2 是安慰劑');
});

console.log('\n══ 【I】⭐⭐ 錦標賽零接觸 ＋ 玩家端零改動 ═══════════════════════');
const TOURN_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
const TOURN_SHA = '93d29a7d68b1508c9201b660ef38f06418fc5760606bb87798f8bdd5f5ed9fdd';
const TOURN_LEN = 219484;
await T('I1 錦標賽區塊逐位元未動(內嵌 sha256,history-free)', () => {
  const i = PATCH.indexOf(TOURN_ANCHOR);
  assert.ok(i > 0, '找不到錦標賽區塊錨點');
  const blk = PATCH.slice(i);
  assert.equal(blk.length, TOURN_LEN, '錦標賽區塊長度變了: ' + blk.length);
  assert.equal(createHash('sha256').update(blk, 'utf8').digest('hex'), TOURN_SHA, '⚠⚠ 錦標賽區塊被動到了!');
});
await T('I2 掃描器自驗:sha 比對抓得到一個字元的差異', () => {
  const i = PATCH.indexOf(TOURN_ANCHOR);
  const mutated = PATCH.slice(i).replace('tournamentEvents', 'tournamentEventsX');
  assert.notEqual(createHash('sha256').update(mutated, 'utf8').digest('hex'), TOURN_SHA, 'I1 是安慰劑');
});
await T('I3 delta-put 區塊整段落在錦標賽區塊之前(位置證明)', () => {
  const t = PATCH.indexOf(TOURN_ANCHOR), s = PATCH.indexOf(DP_S), e = PATCH.indexOf(DP_E);
  assert.ok(s > 0 && e > s && e < t, '區塊位置不對');
});
await T('I4 ⭐ 玩家端零改動:src/ + static/ 逐檔 blob 比對上一版,只准 version.ts 不同', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('test-v6278 I4 玩家端逐檔 blob 比對', '需要歷史 commit;同一件事 test-v6272 ⑩ 也在守');
    return;
  }
  const r = readBaseBlob(ROOT, BASE_SHA, 'package.json');
  assert.ok(r.ok, '讀不到 BASE blob');
  const { execFileSync } = requireChildProcess();
  const ls = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', BASE_SHA, '--', 'src', 'static'],
    { maxBuffer: 1 << 28 }).toString('utf8').trim().split('\n');
  const base = new Map(ls.map((l) => { const [meta, p] = l.split('\t'); return [p, meta.split(' ')[2]]; }));
  assert.ok(base.size > 100, '掃描器壞了?只列到 ' + base.size + ' 個玩家端檔案');
  const diff = [];
  let crlf = 0;
  for (const [p, sha] of base) {
    let buf;
    try { buf = readFileSync(path.join(ROOT, p)); } catch { diff.push(p + '(刪除)'); continue; }
    const cur = createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
    if (cur === sha) continue;
    // ⚠ Windows 工作樹(autocrlf)會讓每一個檔的 blob 都不同 ⇒ 那是**環境**不是改動。
    //   把 CRLF 正規化後再比一次;仍不同才算真的被動到。
    const lf = buf.toString('latin1').replace(/\r\n/g, '\n');
    const cur2 = createHash('sha1').update('blob ' + Buffer.byteLength(lf, 'latin1') + '\0')
      .update(Buffer.from(lf, 'latin1')).digest('hex');
    if (cur2 === sha) { crlf++; continue; }
    diff.push(p);
  }
  if (crlf > 0) console.log('        (工作樹有 ' + crlf + ' 個檔是 CRLF 行尾 —— 已正規化後比對;CI 是 LF)');
  assert.deepStrictEqual(diff.sort(), ['src/lib/version.ts'], '玩家端被動到了: ' + diff.join(', '));
});
await T('I5 admin.html 維持 LF', () => {
  const raw = readFileSync(path.join(ROOT, 'oracle-admin/admin.html'));
  assert.equal(raw.includes(Buffer.from('\r\n')), false, 'admin.html 出現 CRLF');
});

console.log('\n══ 【J】突變測試(每條必須紅在預期的那條斷言) ═══════════════════');
async function expectRed(name, mutated, fn) {
  await T(name, async () => {
    let red = null;
    try { await fn(mutated); }
    catch (e) { if (!(e instanceof assert.AssertionError)) throw e; red = e.message; }
    assert.ok(red !== null, '突變沒有翻紅 — 守衛是安慰劑!');
    console.log('     └ 紅在:' + String(red).split('\n')[0].slice(0, 110));
  });
}
function mutate(find, replace) {
  const m = DPBLOCK.replace(find, replace);
  assert.notEqual(m, DPBLOCK, '突變沒套上: ' + String(find).slice(0, 70));
  return m;
}
const pureOf = (blk) => loadPure(extractPure(blk));
await expectRed('J1 索引改成「只要是數字就放行」(不檢查長度)⇒ D1/D3 越界必紅',
  mutate('if (idx < 0 || idx >= par.length) throw new Error(\'dp-bad-index\');',
         'if (idx < 0) throw new Error(\'dp-bad-index\');'),
  (blk) => {
    const P = pureOf(blk);
    const doc = makeGameDoc();
    assert.throws(() => P._dpApplyPatch(structuredClone(doc), { set: { 'gameState.players.0.bench.9': { id: 'x' } }, del: [] }),
      /dp-bad-index/, '越界索引必須拒');
  });
await expectRed('J2 索引改用 Number()(接受 "01"/"-0"/" 1")⇒ C2 規範性必紅',
  mutate("        if (typeof s !== 'string' || s.length === 0 || s.length > 9) return -1;",
         '        if (typeof s !== \'string\') return -1;\n        return Number(s);\n        // eslint-disable-next-line'),
  (blk) => {
    const P = pureOf(blk);
    for (const s of ['01', '-0', ' 1', '1.5']) assert.equal(P._dpArrIdx(s), -1, '應拒絕 ' + JSON.stringify(s));
  });
await expectRed('J3 允許對陣列 del ⇒ D2「永不 sparse」必紅',
  mutate("if (Array.isArray(par)) throw new Error('dp-del-into-array');",
         'if (false) throw new Error(\'dp-del-into-array\');'),
  (blk) => {
    const P = pureOf(blk);
    assert.throws(() => P._dpApplyPatch(makeGameDoc(), { set: {}, del: ['gameState.players.0.hand.0'] }),
      /dp-del-into-array/, '刪陣列元素必須拒');
  });
await expectRed('J4 中間節點不存在就自動建物件 ⇒ D6「絕不憑空生盤面」必紅',
  mutate("              if (!Object.prototype.hasOwnProperty.call(cur, s)) throw new Error('dp-missing-node');",
         '              if (!Object.prototype.hasOwnProperty.call(cur, s)) cur[s] = {};'),
  (blk) => {
    const P = pureOf(blk);
    assert.throws(() => P._dpApplyPatch(makeGameDoc(), { set: { 'gameState.nope.a.b': 1 }, del: [] }),
      /dp-missing-node/, '中間節點缺席必須拒');
  });
await expectRed('J5 拿掉「深路徑走新分支」的界線,把兩層也丟進深走訪器 ⇒ B1/B2 向後相容必紅',
  mutate("          if (segs.length === 2) {   // ⚠ 兩層:與 v1.29 逐字相同(含 undefined/null 自動建物件的舊語義)",
         '          if (false) {   // 突變:兩層改走深走訪器'),
  (blk) => {
    const P = pureOf(blk);
    let r1, e1 = null, r2, e2 = null;
    try { r1 = JSON.stringify(OLDP._dpApplyPatch({ a: 1 }, { set: { 'zz.k': 5 }, del: [] })); } catch (e) { e1 = e.message; }
    try { r2 = JSON.stringify(P._dpApplyPatch({ a: 1 }, { set: { 'zz.k': 5 }, del: [] })); } catch (e) { e2 = e.message; }
    assert.equal(e2, e1, '兩層語義變了: BASE=' + e1 + ' 新=' + e2);
    assert.equal(r2, r1, '兩層產出變了');
  });
await expectRed('J6 段數上限放到 999 ⇒ C1「9 段必須拒」必紅',
  mutate('const _DP_MAX_PATH_SEGS = 8, _DP_MAX_PATH_LEN = 2100;',
         'const _DP_MAX_PATH_SEGS = 999, _DP_MAX_PATH_LEN = 2100;'),
  (blk) => {
    const P = pureOf(blk);
    const doc = {}; let c = doc;
    for (let i = 0; i < 8; i++) { c['s' + i] = {}; c = c['s' + i]; }
    c.leaf = 0;
    assert.throws(() => P._dpApplyPatch(structuredClone(doc), { set: { 's0.s1.s2.s3.s4.s5.s6.s7.leaf': 1 }, del: [] }),
      /dp-bad-path/, '9 段必須拒');
  });
await expectRed('J7 拿掉 constructor/prototype gate ⇒ D4 原型污染必紅',
  mutate("|| s === 'constructor' || s === 'prototype'", ''),
  (blk) => {
    const P = pureOf(blk);
    try {
      assert.throws(() => P._dpApplyPatch(makeGameDoc(),
        { set: { 'constructor.prototype.dpEvilM': 1 }, del: [] }), /dp-bad-path/, 'constructor 路徑必須拒');
    } finally { delete Object.prototype.dpEvilM; }
  });
await expectRed('J8 哨兵改成 deltaPut:2 ⇒ F1/F2「舊 client 不會壞」必紅',
  mutate('_oj({ ...body, deltaPut: 1, deltaPutDeep: 1 })', '_oj({ ...body, deltaPut: 2, deltaPutDeep: 1 })'),
  async (blk) => {
    const ctx = await makeCtxFactory(blk)({ docs: { ROOM: makeDoc() } });
    const res = fakeRes();
    await ctx.mw(fakeReq('GET', '/api/rooms/ROOM'), res, () => {});
    res.json({ room: makeDoc() });
    assert.equal(res.body.deltaPut, 1, '⚠⚠ deltaPut 必須維持 1(v6.270 client 是嚴格比較)');
  });

console.log('\n══ 【K】HEAD-FAIL(對 BASE v6.277 blob,各項各自紅) ═══════════════');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('test-v6278 【K】HEAD-FAIL(需要 BASE blob)',
    '本檔 A~J 全部 history-free(BASE 的 _dpApplyPatch 以 sha256 內嵌快照對跑),守備面不受淺複製影響');
} else {
  const bp = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  const bv = readBaseBlob(ROOT, BASE_SHA, 'src/lib/version.ts');
  const bk = readBaseBlob(ROOT, BASE_SHA, 'package.json');
  const baseBlock = bp.ok ? extractBlock(bp.out, DP_S, DP_E) : null;
  await T('K0 內嵌的 BASE 快照與真 BASE blob 逐位元相同(快照不得漂移/造假)', () => {
    assert.ok(bp.ok && baseBlock, '讀不到 BASE 區塊');
    assert.ok(baseBlock.includes(BASE_PURE_SRC), '⚠ 內嵌快照不是 BASE 的原文 ⇒ 【B】全部失效');
  });
  await T('K1 BASE 沒有 _dpArrIdx / _DP_MAX_PATH_SEGS(=A2 在 BASE 必紅)', () => {
    assert.ok(!baseBlock.includes('_dpArrIdx'), 'BASE 不該有 _dpArrIdx');
    assert.ok(!baseBlock.includes('_DP_MAX_PATH_SEGS'), 'BASE 不該有 _DP_MAX_PATH_SEGS');
  });
  await T('K2 BASE 的深路徑一律 dp-bad-path(=C1/C3/D1~D3 在 BASE 全紅)', () => {
    for (const p of ['gameState.players.0.hand', 'gameState.players.1.active.damage', 'a.b.c']) {
      assert.throws(() => OLDP._dpApplyPatch(makeGameDoc(), { set: { [p]: 1 }, del: [] }), /dp-bad-path/, p);
    }
  });
  await T('K3 BASE 的哨兵沒有 deltaPutDeep(=F1 在 BASE 必紅)', () => {
    assert.ok(baseBlock.includes('deltaPut: 1 }'), 'BASE 哨兵格式變了?');
    assert.ok(!baseBlock.includes('deltaPutDeep'), 'BASE 不該有 deltaPutDeep');
  });
  await T('K4 BASE 的啟動 log 沒有 deepSegs(=A1 在 BASE 必紅)', () => {
    assert.ok(!baseBlock.includes('deepSegs'), 'BASE 不該有 deepSegs 旗標');
  });
  await T('K5 BASE 的 test chain 沒有本守衛、版本是 6.277(=L1/L2 在 BASE 必紅)', () => {
    assert.ok(bk.ok && !bk.out.includes('test-v6278-delta-put-deep-path'), 'BASE 不該掛本守衛');
    assert.ok(bv.ok && bv.out.includes("'6.277'"), 'BASE 版本異常');
  });
  await T('K6 對 BASE 真的跑一次 A2 → 確實紅(不是恆綠)', () => {
    let red = false;
    try {
      const P = loadPure(extractPure(baseBlock));
      assert.equal(typeof P._dpArrIdx, 'function', '沒有 _dpArrIdx');
    } catch (e) { if (!(e instanceof assert.AssertionError)) throw e; red = true; }
    assert.ok(red, 'A2 對 BASE 應該紅');
  });
}

console.log('\n══ 【L】自查 ═══════════════════════════════════════════════');
await T('L1 守衛在 package.json 的 test chain 裡(CI 的 iron-rules-audit 是 continue-on-error,不算數)', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(String(pkg.scripts.test).includes('node scripts/test-v6278-delta-put-deep-path.mjs'),
    '本守衛沒進 npm test chain');
});
await T('L2 版本一致(version.ts ＝ admin.html hint);patch 檔頭已 bump 且 v1.29/v1.33 舊紀錄還在', () => {
  const ver = readFileSync(path.join(ROOT, 'src/lib/version.ts'), 'utf8');
  const mv = /export const VERSION = '([\d.]+)';/.exec(ver);
  assert.ok(mv, 'version.ts 讀不到 VERSION');
  const adm = readFileSync(path.join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const ma = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(adm);
  assert.ok(ma && ma[1] === mv[1], 'admin.html hint 沒跟著 version.ts 同步');
  const mp = /^\/\/ === ORACLE ADMIN ENDPOINTS === v1\.(\d+) \(/.exec(PATCH);
  assert.ok(mp, 'patch 檔頭格式不對');
  assert.ok(Number(mp[1]) >= 34, 'patch 檔頭版本倒退了(' + mp[1] + ' < 34)');
  assert.ok(PATCH.includes('v1.29 (v6.268 休閒 PUT 上行增量'), 'v1.29 檔頭紀錄被洗掉了');
  assert.ok(PATCH.includes('前版 v1.33 (v6.276 '), 'v1.33 檔頭紀錄被洗掉了');
});
await T('L3 ⚠ 本守衛沒有 pin 死任何 v6.xxx 版本號(第九種安慰劑)', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const body = self.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const hits = body.match(/['"]6\.\d{3}['"]/g) || [];
  // ⭐ 唯一允許的版本字面量是「HEAD-FAIL 用來確認 BASE 是哪一版」的那一個(＝BASE_SHA 對應的版本)。
  //   任何**其他**版本號字面量都會讓守衛在下一版靜默失效(第九種安慰劑)。
  const bad = hits.filter((h) => h !== "'6.277'");
  assert.deepStrictEqual(bad, [], '出現不該寫死的版本號字面量: ' + bad.join(','));
  assert.ok(hits.length > 0, 'HEAD-FAIL 的 BASE 版本斷言不見了(掃描器自驗)');
});

console.log('\n────────────────────────────────');
console.log('test-v6278-delta-put-deep-path: ' + pass + ' pass, ' + fail + ' fail');
if (fail > 0) process.exit(1);
