// v6.266 守衛 —— 套牌戰績【伺服器端 P1】
//
// 這一版做三件事，每一件都各自有 HEAD-FAIL 斷言（BASE v6.265 上必須各自紅）：
//   ① makePlayerDoc 白名單收 deckId（⚠⚠ 沒送就一個位元都不動）
//   ② /api/match-result 從房間 seat enrich deckId（併進既有那一發 findOne）
//   ③ 新端點 GET /api/deck-stats + 兩支 sparse 索引 + 索引自驗自我停用
//
// ⚠⚠ 站長的紅線是「絕不可拖累已經穩定的錦標賽伺服」。pm2 是 fork_mode 單 instance
//   ⇒ 錦標賽與休閒跑在**同一個 node 行程** ⇒ 任何連續阻塞事件迴圈的查詢都會變成
//   錦標賽的 lag。本守衛因此有兩塊「行為端」的證明，缺一不可：
//     ・【E】事件迴圈實測（20 萬筆假資料）＋ 拿掉讓路的正對照必須翻紅
//     ・【F】錦標賽區塊 **逐位元** 未動（內嵌 sha256，history-free ⇒ CI 淺複製下照樣在守）
//
// ⚠⚠ 反安慰劑（我們已連續踩到八次）：
//   ・只捕捉 assert.AssertionError，其他例外一律往外炸（不做無差別 try/catch）
//   ・每一個突變都必須真的翻紅；沒紅一律先假設「守衛沒測到」
//   ・所有「行為」斷言都把**出貨碼本尊**抽出來真的跑（不是在測試裡另寫一份）
//   ・正對照一律 history-free（內嵌 BASE 片段快照），CI 淺複製下不會靜默掏空
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'cef06975e99502eb8eb20f26e07ac713267f41b3';   // v6.265
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const verTs = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
// ⚠ 第 1 行是版本沿革註解（裡面什麼字都有）⇒ 所有「全檔掃描」一律先切掉它，
//   否則註解裡寫到的字串會被當成程式碼掃到（v6.242 ⑨ 的先例）。
const body = pat.split('\n').slice(1).join('\n');

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  PASS ' + n); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + n + '\n        ' + e.message); fail++; }
    else throw e;                                    // ⚠ 非斷言例外一律往外炸，不吞
  }
};

// ══ 抽取器（Rule 25：掃描器自己要先驗，抽壞了不可以靜默全綠）══════════════
function braceEnd(s, i) { let d = 0; for (let k = i; k < s.length; k++) { const c = s[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return k + 1; } } return s.length; }
function extractFn(src, name, minLen) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, '抽不到 function ' + name);
  const txt = src.slice(i, braceEnd(src, src.indexOf('{', i)));
  assert.ok(txt.length > minLen, name + ' 抽太短（抽取器壞了？）：' + txt.length);
  return txt;
}
/** ⚠ 否定型斷言（「不可以出現 X」）一律先剔掉整行註解 —— 否則註解裡寫「絕不寫 X」
 *  本身就會讓斷言誤紅／誤綠（八種守衛安慰劑之一：lint 視窗含註解）。 */
function stripLineComments(s) {
  return s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}
/** sanitizeDeckId 依賴模組層級的 DECK_ID_RE ⇒ 兩個一起抽，否則跑起來 ReferenceError。 */
function extractSanitizeDeckId(src) {
  const i = src.indexOf('const DECK_ID_RE = ');
  assert.ok(i > 0, '抽不到 DECK_ID_RE');
  const j = src.indexOf('function sanitizeDeckId(', i);
  assert.ok(j > i && j - i < 200, 'DECK_ID_RE 與 sanitizeDeckId 沒有相鄰');
  const txt = src.slice(i, braceEnd(src, src.indexOf('{', j)));
  assert.ok(txt.length > 100, 'sanitizeDeckId 抽太短：' + txt.length);
  return txt;
}
function extractBlock(src, sentS, sentE) {
  const si = src.indexOf(sentS), ei = src.indexOf(sentE);
  assert.ok(si >= 0 && ei > si, '抽不到區塊 ' + sentS);
  return src.slice(src.indexOf('\n', si) + 1, ei);
}
/** 從「const DECK_STATS_SCAN_CAP」到「app.get('/api/rooms-archetypes'」之前的整段出貨碼。
 *  ⭐ 刻意連 rate limit／索引自驗／快取一起抽 —— 那些才是「不拖累錦標賽」的防線本體。 */
function extractDeckStatsSection(src) {
  const i = src.indexOf('    const DECK_STATS_SCAN_CAP =');
  assert.ok(i >= 0, "抽不到 deck-stats 區段（DECK_STATS_SCAN_CAP 不存在？）");
  const j = src.indexOf("app.get('/api/rooms-archetypes'", i);
  assert.ok(j > i, 'deck-stats 區段後面找不到 /api/rooms-archetypes 界標');
  const txt = src.slice(i, j);
  assert.ok(txt.length > 3000, 'deck-stats 區段抽太短（抽取器壞了？）：' + txt.length);
  assert.ok(txt.includes("app.get('/api/deck-stats'"), 'deck-stats 區段裡沒有端點註冊');
  return txt;
}
function extractYield(src) {
  const i = src.indexOf('const ADMIN_SCAN_YIELD_EVERY =');
  assert.ok(i > 0, '找不到 ADMIN_SCAN_YIELD_EVERY —— v6.242 的中央讓路節拍不見了');
  const j = src.indexOf('\n  }', src.indexOf('function adminScanYield', i));
  const s = src.slice(i, j + 4);
  assert.ok(/setImmediate/.test(s), '讓路沒有用 setImmediate（microtask 對 I/O 沒有幫助）');
  return s;
}

// ══ 共用 stub ═════════════════════════════════════════════════════════════
const NAMES = new Map([['c1', '皮卡丘'], ['c2', '老大的指令'], ['c3', '烈咬陸鯊']]);
const RULE_PIKA = { _id: 'R1', name: '皮卡丘', includes: ['皮卡丘'] };
const mkRes = () => {
  const r = { body: null, code: 200 };
  r.json = (o) => { r.body = o; return r; };
  r.status = (c) => { r.code = c; return r; };
  return r;
};
/** 假 mongo：真 driver 是「一批進記憶體 → 批內逐筆反序列化」，批內 next() 是**已解決**的
 *  promise。模擬這一點才量得出「純 cursor 仍會整批阻塞」——否則探針會假裝一切安好。 */
function makeMatchRecordsColl(docs, spy, batchSize, indexes) {
  return {
    indexes: async () => { spy.indexCalls++; if (indexes === 'throw') throw new Error('listIndexes failed'); return indexes; },
    find(filter, opts) {
      spy.filters.push(filter);
      spy.projection = opts && opts.projection;
      const cur = { _limit: Infinity };
      cur.sort = () => cur; cur.skip = () => cur; cur.batchSize = () => cur;
      cur.limit = (n) => { cur._limit = n; return cur; };
      const rows = () => (cur._limit === Infinity ? docs : docs.slice(0, cur._limit));
      cur.toArray = async () => { const o = rows().map((d) => JSON.parse(JSON.stringify(d))); spy.toArray += o.length; return o; };
      cur[Symbol.asyncIterator] = async function* () {
        const r = rows();
        for (let i = 0; i < r.length; i += (batchSize || 8000)) {
          await new Promise((res) => setTimeout(res, 0));           // 批間網路往返（真 macrotask）
          const end = Math.min(i + (batchSize || 8000), r.length);
          for (let k = i; k < end; k++) { spy.iter++; yield JSON.parse(JSON.stringify(r[k])); }
        }
      };
      return cur;
    },
  };
}
/** v6.229 的中央 archetypeNameOf（出貨碼本尊），注入它依賴的兩支純函式。 */
function mkArchetypeNameOf(classifyDeck, deckToSets) {
  return new Function('classifyDeck', 'deckToSets',
    extractFn(pat, 'archetypeNameOf', 150) + '\nreturn archetypeNameOf;')(classifyDeck, deckToSets);
}
const IDX_OK = [{ key: { _id: 1 } }, { key: { 'p1.deckId': 1 }, sparse: true }, { key: { 'p2.deckId': 1 }, sparse: true }];
const IDX_MISSING = [{ key: { _id: 1 } }];

/** 把 deck-stats 區段（出貨碼本尊）跑起來，回 { handler, spy }。 */
function buildDeckStats(sectionSrc, docs, opts) {
  const o = opts || {};
  const spy = { toArray: 0, iter: 0, projection: null, filters: [], indexCalls: 0 };
  const coll = makeMatchRecordsColl(docs, spy, o.batchSize, o.indexes === undefined ? IDX_OK : o.indexes);
  const db = { collection: () => coll };
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  const Y = new Function(extractYield(pat) + '\nreturn adminScanYield;')();
  const sanitizeDeckId = new Function(extractSanitizeDeckId(pat) + '\nreturn sanitizeDeckId;')();
  const env = {
    app, db, console,
    adminScanYield: o.noYield ? () => null : Y,
    sanitizeDeckId,
    getCardNameMap: async () => (o.emptyNames ? new Map() : NAMES),
    getEnabledRulesCached: async () => (o.noRules ? [] : [RULE_PIKA]),
    buildCasualCleanFilter: (x) => ({ roomCode: { $type: 'string' }, $or: [{ winReason: { $not: /X/ } }, { finalTurn: { $gte: 3 } }], _opts: x }),
    deckToSets: (cc) => {
      const keys = Array.isArray(cc) ? cc.map((e) => e && e.cardId) : Object.keys(cc || {});
      const names = new Set(), ids = new Set();
      for (const k of keys) { if (k == null) continue; ids.add(String(k)); const n = NAMES.get(String(k)); if (n) names.add(n); }
      return { ids, names };
    },
    classifyDeck: (sets, rules) => {
      for (const r of rules) if ((r.includes || []).every((n) => sets.names.has(n))) return { rule: r, all: [r] };
      return { rule: null, all: [] };
    },
    casualSideResult: (w, isP1) => (w !== 0 && w !== 1 ? 'draw' : (((isP1 && w === 0) || (!isP1 && w === 1)) ? 'win' : 'loss')),
  };
  // ⭐ archetypeNameOf 用**出貨碼本尊**（v6.229 的中央分類出口），不是在測試裡另寫一份 ——
  //   D5 的突變要證明「把 cardCounts 物件直接丟給它會整張表靜默全空」，
  //   用假的就證明不了任何事（那正是安慰劑）。
  env.archetypeNameOf = mkArchetypeNameOf(env.classifyDeck, env.deckToSets);
  const names = Object.keys(env), vals = Object.values(env);
  new Function(...names, '"use strict";\n' + sectionSrc + '\n')(...vals);
  assert.ok(routes['/api/deck-stats'], "deck-stats 區段沒有註冊 app.get('/api/deck-stats')");
  return { h: routes['/api/deck-stats'], spy };
}
const callDS = async (h, query, headers) => {
  const res = mkRes();
  await h({ query: query || {}, headers: headers || { 'x-forwarded-for': '1.2.3.4' } }, res);
  return res;
};

// ══ BASE (v6.265) 片段快照 —— ⭐ history-free 正對照 ══════════════════════
//   ⚠ CI 是 fetch-depth:1 淺複製，靠 git 讀歷史的斷言會靜默掏空（v6.263 教訓）
//   ⇒ 把 BASE 的兩支函式**逐字內嵌**在這裡，比對永遠跑得起來。
//   ⚠ 這兩段是【資料】不是【出貨碼】：它們只在本守衛內被 new Function 執行。
const BASE_MAKE_PLAYER_DOC_SRC = "function makePlayerDoc(p) {\n      const doc = {\n        name: String(p.name).substring(0, 60),\n        email: p.email ? String(p.email).substring(0, 120) : null,\n        cardCounts: {},\n      };\n      if (p.cardCounts && typeof p.cardCounts === 'object' && !Array.isArray(p.cardCounts)) {\n        // 直接 sanitize cardCounts\n        const keys = Object.keys(p.cardCounts).slice(0, 100);\n        for (const k of keys) {\n          const v = Number(p.cardCounts[k]);\n          if (Number.isFinite(v) && v > 0 && v <= 60) {\n            doc.cardCounts[String(k)] = Math.floor(v);\n          }\n        }\n      } else if (Array.isArray(p.cardIds)) {\n        // 舊客戶端 fallback：cardIds[] → cardCounts (每張視為 1)\n        for (const id of p.cardIds.slice(0, 100)) {\n          doc.cardCounts[String(id)] = 1;\n        }\n      }\n      return doc;\n    }";
const BASE_MR_VALIDATE_SRC = "function mrValidateRecord(rec) {\n      if (!rec || typeof rec !== 'object') return 'payload not object';\n      if (typeof rec.matchId !== 'string' || !rec.matchId) return 'matchId required';\n      if (typeof rec.endedAt !== 'number' || rec.endedAt < 0) return 'endedAt required';\n      if (rec.winner !== null && rec.winner !== 0 && rec.winner !== 1) return 'winner must be 0|1|null';\n      if (typeof rec.finalTurn !== 'number') return 'finalTurn required';\n      if (!rec.p1 || !rec.p2) return 'p1/p2 required';\n      for (const side of ['p1', 'p2']) {\n        const s = rec[side];\n        if (typeof s.name !== 'string') return side + '.name required';\n        const hasCounts = s.cardCounts && typeof s.cardCounts === 'object' && !Array.isArray(s.cardCounts);\n        const hasIds = Array.isArray(s.cardIds);\n        if (!hasCounts && !hasIds) return side + '.cardCounts or .cardIds required';\n        if (hasCounts) {\n          const keys = Object.keys(s.cardCounts);\n          if (keys.length > 100) return side + '.cardCounts has too many keys';\n          for (const k of keys) {\n            if (typeof s.cardCounts[k] !== 'number' || s.cardCounts[k] < 0 || s.cardCounts[k] > 60) {\n              return side + '.cardCounts[' + k + '] out of range (0-60)';\n            }\n          }\n        }\n        if (hasIds && s.cardIds.length > 100) return side + '.cardIds too long';\n      }\n      if (rec.mode !== 'local' && rec.mode !== 'online') return 'mode must be local|online';\n      return null;\n    }";

console.log('\n══ 【A】結構與 HEAD-FAIL（BASE v6.265 上每一條都必須各自紅）══════════════');

await T('A1 sanitizeDeckId 存在，且定義在**所有 IIFE 之外**（v0.94／v1.01 兩次線上事故）', () => {
  const i = body.indexOf('function sanitizeDeckId(');
  assert.ok(i >= 0, 'HEAD-FAIL：沒有 sanitizeDeckId');
  // 消費端分屬兩個不同 IIFE：registerMatchRecords（makePlayerDoc）與 registerStatsEndpoints（deck-stats）
  const iifeMR = body.indexOf('(function registerMatchRecords()');
  const iifeST = body.indexOf('(function registerStatsEndpoints()');
  assert.ok(iifeMR > 0 && iifeST > iifeMR, '兩個 IIFE 的錨點對不上（掃描器壞了？）');
  assert.ok(i < iifeMR, 'sanitizeDeckId 定義在 registerMatchRecords 之後 ⇒ 另一個 IIFE 會 ReferenceError');
  assert.ok(body.indexOf('function makePlayerDoc(') > iifeMR, 'makePlayerDoc 不在 registerMatchRecords 內（掃描器壞了？）');
  assert.ok(body.indexOf("app.get('/api/deck-stats'") > iifeST, 'deck-stats 端點不在 registerStatsEndpoints 內');
});

await T('A2 兩支索引存在、而且是 **sparse**（18.5 萬筆舊列沒有這個欄位）', () => {
  for (const f of ['p1.deckId', 'p2.deckId']) {
    const re = new RegExp("createIndex\\(\\{ '" + f.replace('.', '\\.') + "': 1 \\}, \\{ sparse: true \\}\\)");
    assert.ok(re.test(body), 'HEAD-FAIL：缺少 sparse 索引 ' + f);
  }
  // ⚠ 一定要在 request handler 之外（比照 v6.240 的 rooms 索引：服務啟動時建一次）
  const idxAt = body.indexOf("createIndex({ 'p1.deckId': 1 }");
  const firstIife = body.indexOf('(function registerMatchRecords()');
  assert.ok(idxAt > 0 && idxAt < firstIife, '索引不是在服務啟動段建的');
  assert.ok(!/await\s+db\.collection\('matchRecords'\)\.createIndex/.test(body),
    'createIndex 被 await 了 —— 不可以擋住啟動流程');
});

await T('A3 makePlayerDoc 白名單收 deckId，且走中央 sanitizeDeckId', () => {
  const src = extractFn(body, 'makePlayerDoc', 400);
  assert.ok(/sanitizeDeckId\(/.test(src), 'HEAD-FAIL：makePlayerDoc 沒有收 deckId');
  assert.ok(/if \(_did\) doc\.deckId = _did;/.test(src),
    'HEAD-FAIL：deckId 不是「有值才寫」—— 寫成 doc.deckId = x || null 會被 sparse 索引收進去');
  assert.ok(!/doc\.deckId = null/.test(stripLineComments(src)), 'makePlayerDoc 竟然會寫 deckId: null');
});

await T('A4 seat enrich：projection 加了 seats.deckId，且併在**同一發** findOne（零額外查詢）', () => {
  const blk = extractBlock(body, '// >>> PTCG-MATCH-EMAIL-ENRICH-START', '// <<< PTCG-MATCH-EMAIL-ENRICH-END');
  assert.ok(/'seats\.deckId': 1/.test(blk), 'HEAD-FAIL：projection 沒有 seats.deckId');
  assert.strictEqual((blk.match(/findOne\(/g) || []).length, 1,
    'enrich 區塊有超過一發 findOne —— deckId 必須併進既有那一發，不可以多打一次 mongo');
  assert.ok(/sanitizeDeckId\(_st\[0\]\.deckId\)/.test(blk) && /sanitizeDeckId\(_st\[1\]\.deckId\)/.test(blk),
    '從 seat 補來的 deckId 沒有走淨化');
});

await T('A5 /api/deck-stats 端點存在，免登入（沒有 requireFirebaseAdmin）且帶哨兵', () => {
  const sec = extractDeckStatsSection(body);
  assert.ok(/app\.get\('\/api\/deck-stats', async \(req, res\)/.test(sec),
    'HEAD-FAIL：deck-stats 不是免登入形狀（或不存在）');
  assert.ok(!/\/api\/deck-stats'\s*,\s*requireFirebaseAdmin/.test(body), 'deck-stats 掛了 admin 驗證（玩家會打不到）');
  assert.ok(/deckStatsApi: 1/.test(sec), 'HEAD-FAIL：回應沒有 deckStatsApi 哨兵，client 分不出新舊伺服器');
  assert.ok(/adminScanYield\(/.test(sec), 'HEAD-FAIL：沒有讓路節拍 ⇒ 全量掃描會整批擋住錦標賽');
  assert.ok(/for await \(const m of _cursor\)/.test(sec), 'HEAD-FAIL：沒有走 cursor 逐筆');
  assert.ok(!/\.toArray\(\)/.test(sec), 'deck-stats 竟然有 toArray（那是 v6.240 的 1.1GB 事故）');
  assert.ok(/deckStatsIndexReady/.test(sec), 'HEAD-FAIL：沒有索引自驗 ⇒ 無索引時會 COLLSCAN 18.5 萬筆');
});

console.log('\n══ 【B】⭐⭐ 正對照：舊 payload 產出的 doc 與 BASE **逐位元相同** ═══════════');
//   ⭐ 用「內嵌的 BASE 片段快照」比對 —— history-free，CI 淺複製下照樣在守
//     （v6.263 的教訓：靠 git 讀歷史的斷言在 CI 上會靜默掏空）。

const runMakePlayerDoc = (src, needSanitize) => {
  const sanitizeDeckId = new Function(extractSanitizeDeckId(pat) + '\nreturn sanitizeDeckId;')();
  const args = needSanitize ? ['sanitizeDeckId'] : [];
  const vals = needSanitize ? [sanitizeDeckId] : [];
  return new Function(...args, '"use strict";\n' + src + '\nreturn makePlayerDoc;')(...vals);
};
const SHIPPED_MPD = extractFn(pat, 'makePlayerDoc', 400);
const BASE_MPD = runMakePlayerDoc(BASE_MAKE_PLAYER_DOC_SRC, false);
const SHIPPED = runMakePlayerDoc(SHIPPED_MPD, true);

// 舊 payload（v6.265 以前的 client 一定送這幾種形狀，一個 deckId 欄位都沒有）
const OLD_PAYLOADS = [
  { name: 'P1', email: 'a@b.tw', cardCounts: { c1: 4, c2: 2, c3: 1 } },
  { name: 'P2', email: null, cardCounts: {} },
  { name: '很長的名字'.repeat(30), email: 'x'.repeat(200), cardCounts: { c1: 61, c2: 0, c3: -3, c4: 2.7 } },
  { name: 'legacy', cardIds: ['c1', 'c1', 'c2'] },                        // 舊格式 cardIds[]
  { name: 'noDeck' },                                                     // 兩種都沒有
  { name: 'arrCC', email: 'e@f.g', cardCounts: ['c1', 'c2'] },            // 陣列（會走 cardIds 分支？→ 兩邊必須一致）
];

await T('B1 ⭐⭐ 舊 payload：出貨版 makePlayerDoc 與 BASE 逐位元相同（JSON.stringify 含 key 順序）', () => {
  for (const p of OLD_PAYLOADS) {
    const a = JSON.stringify(BASE_MPD(structuredClone(p)));
    const b = JSON.stringify(SHIPPED(structuredClone(p)));
    assert.strictEqual(b, a, '舊 payload 產出的 doc 變了！\n        payload=' + JSON.stringify(p).slice(0, 120)
      + '\n        BASE   =' + a + '\n        SHIPPED=' + b);
  }
  console.log('        （正對照樣本 ' + OLD_PAYLOADS.length + ' 組，逐字元相同）');
});

await T('B2 突變【M3】把 deckId 改成「一律寫」（doc.deckId = _did）⇒ B1 必須翻紅', () => {
  const MUT = SHIPPED_MPD.replace('if (_did) doc.deckId = _did;', 'doc.deckId = _did;');
  assert.notStrictEqual(MUT, SHIPPED_MPD, '突變錨點對不上（寫法改了？）');
  const mutFn = runMakePlayerDoc(MUT, true);
  let red = 0;
  for (const p of OLD_PAYLOADS) {
    if (JSON.stringify(mutFn(structuredClone(p))) !== JSON.stringify(BASE_MPD(structuredClone(p)))) red++;
  }
  assert.strictEqual(red, OLD_PAYLOADS.length,
    '突變後只有 ' + red + '/' + OLD_PAYLOADS.length + ' 組翻紅 —— B1 的比對沒有在守');
});

await T('B3 新 payload：合格 deckId 才寫；不合格／缺席一律**欄位缺席**（不是 null）', () => {
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.strictEqual(SHIPPED({ name: 'a', cardCounts: {}, deckId: uuid }).deckId, uuid, '合格 UUID 沒收進來');
  assert.strictEqual(SHIPPED({ name: 'a', cardCounts: {}, deckId: '  ' + uuid + ' ' }).deckId, uuid, '沒有 trim');
  assert.strictEqual(SHIPPED({ name: 'a', cardCounts: {}, deckId: 'd_m1x2y3_ab12cd' }).deckId, 'd_m1x2y3_ab12cd',
    'crypto.randomUUID 不存在時的 fallback id（d_<base36>_<base36>）被擋掉了');
  for (const bad of [null, undefined, 123, {}, [], '', 'short', 'x'.repeat(65), 'has space here', '../../etc/passwd', '{"$ne":1}']) {
    const d = SHIPPED({ name: 'a', cardCounts: {}, deckId: bad });
    assert.ok(!('deckId' in d), '不合格的 deckId 竟然寫進 doc：' + JSON.stringify(bad) + ' → ' + JSON.stringify(d.deckId));
  }
});

await T('B4 mrValidateRecord **一個字都沒動**（新欄位壞掉絕不可以擋掉整場戰績）', () => {
  const shipped = extractFn(pat, 'mrValidateRecord', 800);
  assert.ok(!/deckId/.test(shipped), 'mrValidateRecord 竟然開始檢查 deckId —— 那會讓格式不對的 payload 整場戰績寫不進去');
  assert.strictEqual(shipped, BASE_MR_VALIDATE_SRC, 'mrValidateRecord 與 BASE 不是逐位元相同');
});

console.log('\n══ 【C】seat enrich 行為（把出貨碼區塊抽出來真的跑）══════════════════════');

const ENRICH = extractBlock(pat, '// >>> PTCG-MATCH-EMAIL-ENRICH-START', '// <<< PTCG-MATCH-EMAIL-ENRICH-END');
const runEnrich = (src, db, doc) => {
  const sanitizeDeckId = new Function(extractSanitizeDeckId(pat) + '\nreturn sanitizeDeckId;')();
  return new Function('db', 'doc', 'sanitizeDeckId',
    '"use strict"; return (async () => {\n' + src + '\n})();')(db, doc, sanitizeDeckId);
};
const mkRoomDb = (seats, calls, throws) => ({
  collection: () => ({
    findOne: async (q, o) => { calls.push({ q, o }); if (throws) throw new Error('db down'); return seats === null ? null : { seats }; },
  }),
});
const DID1 = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
const DID2 = 'aaaaaaaa-bbbb-cccc-dddd-222222222222';

await T('C1 既有 email 行為**四個案例逐一維持**（v6.220 的斷言不可以被我改壞）', async () => {
  const seats = [{ uid: 'u1', email: 'alice@example.com' }, { uid: 'u2', email: 'bob@example.com' }];
  let calls = [];
  let doc = { roomCode: 'ab12', p1: { email: null }, p2: { email: null } };
  await runEnrich(ENRICH, mkRoomDb(seats, calls), doc);
  assert.strictEqual(calls.length, 1, '應以大寫房號查一次 rooms');
  assert.strictEqual(calls[0].q._id, 'AB12', '房號沒有轉大寫');
  assert.ok(doc.p1.email === 'alice@example.com' && doc.p2.email === 'bob@example.com', '沒補到 email');
  calls = [];
  doc = { roomCode: 'AB12', p1: { email: 'from-client@x.tw' }, p2: { email: null } };
  await runEnrich(ENRICH, mkRoomDb(seats, calls), doc);
  assert.ok(doc.p1.email === 'from-client@x.tw' && doc.p2.email === 'bob@example.com', 'client 送的值被蓋掉／另一邊沒補');
  calls = [];
  doc = { roomCode: null, p1: { email: 'me@x.tw' }, p2: { email: null } };
  await runEnrich(ENRICH, mkRoomDb(seats, calls), doc);
  assert.ok(calls.length === 0 && doc.p2.email === null, '無房號（本機對戰）竟然去查 DB');
  doc = { roomCode: 'AB12', p1: { email: null }, p2: { email: null } };
  await runEnrich(ENRICH, mkRoomDb(seats, [], true), doc);
  assert.strictEqual(doc.p1.email, null, 'DB 掛時應維持 null 且不拋例外');
});

await T('C2 ⭐ deckId 從 seat 補：雙方都補得到（這是 $setOnInsert 下唯一補得到對手的路徑）', async () => {
  const seats = [{ uid: 'u1', email: null, deckId: DID1 }, { uid: 'u2', email: null, deckId: DID2 }];
  const calls = [];
  const doc = { roomCode: 'AB12', p1: { email: null }, p2: { email: null } };
  await runEnrich(ENRICH, mkRoomDb(seats, calls), doc);
  assert.strictEqual(calls.length, 1, 'deckId 不可以多打一發 findOne（要併進 email 那一發）');
  assert.deepStrictEqual(calls[0].o.projection, { 'seats.uid': 1, 'seats.email': 1, 'seats.deckId': 1 }, 'projection 不對');
  assert.strictEqual(doc.p1.deckId, DID1, 'p1 沒補到 deckId');
  assert.strictEqual(doc.p2.deckId, DID2, 'p2 沒補到 deckId');
});

await T('C3 client 有送就以 client 為準（它才知道自己按了哪一副）', async () => {
  const seats = [{ uid: 'u1', deckId: DID2 }, { uid: 'u2', deckId: DID2 }];
  const doc = { roomCode: 'AB12', p1: { email: null, deckId: DID1 }, p2: { email: null } };
  await runEnrich(ENRICH, mkRoomDb(seats, []), doc);
  assert.strictEqual(doc.p1.deckId, DID1, 'client 送的 deckId 被房間 seat 蓋掉了');
  assert.strictEqual(doc.p2.deckId, DID2, 'p2 沒補到');
});

await T('C4 ⚠ 補不到就**什麼都不寫**（本版 client 還沒有寫 seats[].deckId ⇒ 線上一定是這條路）', async () => {
  for (const seats of [[{ uid: 'u1' }, { uid: 'u2' }], [{ uid: 'u1', deckId: 'bad' }, { uid: 'u2', deckId: 123 }], [], null]) {
    const doc = { roomCode: 'AB12', p1: { email: null }, p2: { email: null } };
    await runEnrich(ENRICH, mkRoomDb(seats, []), doc);
    assert.ok(!('deckId' in doc.p1) && !('deckId' in doc.p2),
      '補不到卻憑空生了欄位：' + JSON.stringify({ p1: doc.p1.deckId, p2: doc.p2.deckId }));
  }
  // DB 掛也一樣
  const doc = { roomCode: 'AB12', p1: { email: null }, p2: { email: null } };
  await runEnrich(ENRICH, mkRoomDb([], [], true), doc);
  assert.ok(!('deckId' in doc.p1), 'DB 掛時竟然寫了 deckId');
});

await T('C5 成本：雙方 email 與 deckId 都已齊全時，**完全不查** DB', async () => {
  const calls = [];
  const doc = { roomCode: 'AB12', p1: { email: 'a@x', deckId: DID1 }, p2: { email: 'b@x', deckId: DID2 } };
  await runEnrich(ENRICH, mkRoomDb([], calls), doc);
  assert.strictEqual(calls.length, 0, '什麼都不缺卻還是查了 DB（白白多一發）');
});

console.log('\n══ 【D】/api/deck-stats 行為（出貨碼本尊 ＋ 假 mongo）════════════════════');

const MY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER = 'ffffffff-0000-1111-2222-333333333333';
//  8 場：我方 4 勝 3 敗 1 平；對手原型 皮卡丘×3（2勝1敗）／未分類×3（1勝2敗）／不知道×2
const DOCS = [
  { _id: 'm1', p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c1: 4 } }, winner: 0 },  // 皮卡丘 win
  { _id: 'm2', p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c1: 4 } }, winner: 0 },  // 皮卡丘 win
  { _id: 'm3', p1: { deckId: OTHER, cardCounts: { c1: 4 } }, p2: { deckId: MY, cardCounts: { c3: 4 } }, winner: 0 },  // 我在 p2、皮卡丘 loss
  { _id: 'm4', p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c2: 4 } }, winner: 0 },  // 未分類 win
  { _id: 'm5', p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c2: 4 } }, winner: 1 },  // 未分類 loss
  { _id: 'm6', p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c2: 4 } }, winner: 1 },  // 未分類 loss
  { _id: 'm7', p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: {} }, winner: 0 },         // 不知道 win
  { _id: 'm8', p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER }, winner: null },                       // 不知道 draw
];
const SEC = extractDeckStatsSection(pat);

await T('D1 休閒勝率：只算線上（沿用中央 buildCasualCleanFilter）＋ 勝負平正確', async () => {
  const { h, spy } = buildDeckStats(SEC, DOCS);
  const res = await callDS(h, { deckId: MY });
  assert.strictEqual(res.code, 200, '回了 ' + res.code + '：' + JSON.stringify(res.body));
  const b = res.body;
  assert.strictEqual(b.deckStatsApi, 1, '哨兵不見了');
  assert.strictEqual(b.casual.scope, 'online-only', '口徑欄位不是 online-only');
  assert.strictEqual(b.casual.games, 8, 'games=' + b.casual.games);
  assert.strictEqual(b.casual.wins, 4, 'wins=' + b.casual.wins);
  assert.strictEqual(b.casual.losses, 3, 'losses=' + b.casual.losses);
  assert.strictEqual(b.casual.draws, 1, 'draws=' + b.casual.draws);
  assert.ok(Math.abs(b.casual.winRate - 4 / 7) < 1e-9, 'winRate=' + b.casual.winRate);
  assert.strictEqual(b.tournament.status, 'not-collected', '錦標賽應誠實標記「還沒收」');
  assert.strictEqual(b.since, 'v6.266', '沒有標明統計起算版本');
});

await T('D2 ⚠⚠ 查詢用 $and 併，**沒有覆蓋掉** buildCasualCleanFilter 自帶的 $or', async () => {
  const { h, spy } = buildDeckStats(SEC, DOCS);
  await callDS(h, { deckId: MY });
  const q = spy.filters[0];
  assert.ok(Array.isArray(q.$and) && q.$and.length === 2, '查詢不是 $and 兩段：' + JSON.stringify(q).slice(0, 200));
  const clean = q.$and.find((x) => x.roomCode);
  assert.ok(clean, '第一段不是淨化 filter —— 休閒口徑（只算線上）沒有生效');
  assert.deepStrictEqual(clean.roomCode, { $type: 'string' }, 'roomCode 條件不見了 ⇒ vsAI／本機會被算進來');
  assert.ok(Array.isArray(clean.$or) && clean.$or.length === 2, '淨化 filter 自帶的 $or（離開場規則）被覆蓋掉了');
  const or = q.$and.find((x) => x.$or && x.$or.some((c) => c['p1.deckId']));
  assert.ok(or, 'deckId 的 $or 不見了');
  assert.deepStrictEqual(or.$or, [{ 'p1.deckId': MY }, { 'p2.deckId': MY }], 'deckId $or 形狀不對（索引會用不到）');
});

await T('D3 突變【M4】把 deckId 的 $or 直接塞同一層（覆蓋淨化的 $or）⇒ D2 必須翻紅', async () => {
  const MUT = SEC.replace(
    "const q = { $and: [buildCasualCleanFilter({}), { $or: [{ 'p1.deckId': deckId }, { 'p2.deckId': deckId }] }] };",
    "const q = { ...buildCasualCleanFilter({}), $or: [{ 'p1.deckId': deckId }, { 'p2.deckId': deckId }] };");
  assert.notStrictEqual(MUT, SEC, '突變錨點對不上');
  const { h, spy } = buildDeckStats(MUT, DOCS);
  await callDS(h, { deckId: MY });
  assert.ok(!spy.filters[0].$and, '突變後竟然還是 $and —— D2 的斷言沒有在守');
});

await T('D4 ⭐ 對各原型的勝率（走 v6.229 的**中央** archetypeNameOf，與 admin 統計同一份分類）', async () => {
  const { h } = buildDeckStats(SEC, DOCS);
  const b = (await callDS(h, { deckId: MY })).body;
  const byName = Object.fromEntries(b.vsArchetype.map((r) => [r.name, r]));
  assert.ok(byName['皮卡丘'], 'vsArchetype 沒有「皮卡丘」這一列');
  assert.strictEqual(byName['皮卡丘'].games, 3, '皮卡丘 games=' + byName['皮卡丘'].games);
  assert.strictEqual(byName['皮卡丘'].wins, 2, '皮卡丘 wins=' + byName['皮卡丘'].wins);
  assert.strictEqual(byName['皮卡丘'].losses, 1, '皮卡丘 losses=' + byName['皮卡丘'].losses);
  assert.strictEqual(byName['未分類'].games, 3, '未分類 games=' + byName['未分類'].games);
  assert.strictEqual(byName['未分類'].wins, 1, '未分類 wins=' + byName['未分類'].wins);
  // ⚠ 「還不知道」（對手沒牌表）一律不記帳，絕不可以混進「未分類」
  const sum = b.vsArchetype.reduce((a, r) => a + r.games, 0);
  assert.strictEqual(sum, 6, '原型分帳總數 ' + sum + ' ≠ 6 —— 對手沒牌表的 2 場被算進去了');
  assert.ok(b.vsArchetype[0].games >= b.vsArchetype[b.vsArchetype.length - 1].games, '沒有依場次排序');
  // ⭐ 分類語義只能有一份：必須走 v6.229 的中央出口，不可以在這裡抄一份 classifyDeck
  assert.ok(/archetypeNameOf\(ccToEntries\(cc\), nameMap, rules\)/.test(SEC),
    'deck-stats 沒有走中央 archetypeNameOf（抄第二份會讓同一副牌在不同畫面被分到不同原型）');
  assert.strictEqual((SEC.match(/classifyDeck\(/g) || []).length, 0,
    'deck-stats 區段自己呼叫了 classifyDeck —— 那就是第二份分類語義');
});

await T('D5 突變【M5】把 cardCounts 物件直接丟給 archetypeNameOf ⇒ vsArchetype **整張表靜默全空**', async () => {
  // ⚠⚠ 這正是本版最容易踩的坑：archetypeNameOf 第一行是 `if (!entries || !entries.length) return null`，
  //   那是為 deckEntries **陣列**寫的；cardCounts 是物件、.length 恆為 undefined ⇒ 每筆都回 null。
  //   它不會報錯、不會 500 —— 只會永遠沒有資料。
  const MUT = SEC.replace(
    'const oppArchetypeOf = (cc) => archetypeNameOf(ccToEntries(cc), nameMap, rules);',
    'const oppArchetypeOf = (cc) => archetypeNameOf(cc, nameMap, rules);');
  assert.notStrictEqual(MUT, SEC, '突變錨點對不上（寫法改了？）');
  const { h } = buildDeckStats(MUT, DOCS);
  const b = (await callDS(h, { deckId: MY })).body;
  assert.strictEqual(b.vsArchetype.length, 0,
    '突變後 vsArchetype 竟然還有 ' + b.vsArchetype.length + ' 列 —— D4 的斷言沒有在守（或 stub 太寬鬆）');
  assert.strictEqual(b.casual.games, 8, '突變不應該影響總勝率（只影響分原型那張表）');
});

await T('D6 ⚠⚠ 無索引 ⇒ **自我停用**（503 且不帶哨兵）；有索引才查（行為端）', async () => {
  const { h, spy } = buildDeckStats(SEC, DOCS, { indexes: IDX_MISSING });
  const res = await callDS(h, { deckId: MY });
  assert.strictEqual(res.code, 503, '缺索引卻回了 ' + res.code + ' —— 那就是對 18.5 萬筆 COLLSCAN');
  assert.ok(!res.body.deckStatsApi, '停用時竟然還帶哨兵，client 會以為伺服器支援');
  assert.strictEqual(spy.filters.length, 0, '⚠⚠ 缺索引竟然還是發了查詢！（' + spy.filters.length + ' 發）');
  // listIndexes 本身掛掉也一樣停用
  const r2 = await callDS(buildDeckStats(SEC, DOCS, { indexes: 'throw' }).h, { deckId: MY });
  assert.strictEqual(r2.code, 503, 'listIndexes 掛掉時應停用');
});

await T('D7 突變【M6】拿掉索引自驗 ⇒ D6 必須翻紅（缺索引也照查）', async () => {
  const MUT = SEC.replace(
    "      if (!(await deckStatsIndexReady())) return res.status(503).json({ error: 'deck-stats 尚未就緒（索引未建立）' });\n", '');
  assert.notStrictEqual(MUT, SEC, '突變錨點對不上');
  const { h, spy } = buildDeckStats(MUT, DOCS, { indexes: IDX_MISSING });
  const res = await callDS(h, { deckId: MY });
  assert.strictEqual(res.code, 200, '突變後應該會照查（實得 ' + res.code + '）');
  assert.ok(spy.filters.length >= 1, '突變後竟然沒發查詢 —— D6 的斷言沒有在守');
});

await T('D8 掃描上限 5000 ＋ truncated；cursor 逐筆、一筆都沒 toArray；projection 是白名單', async () => {
  const many = Array.from({ length: 5600 }, (_, i) => ({
    _id: 'x' + i, winner: i % 2, p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c1: 4 } },
  }));
  const { h, spy } = buildDeckStats(SEC, many);
  const b = (await callDS(h, { deckId: MY })).body;
  assert.strictEqual(b.scanned, 5000, 'scanned=' + b.scanned + '（上限應為 5000）');
  assert.strictEqual(b.truncated, true, '超過上限沒有誠實回報 truncated');
  assert.strictEqual(b.scanCap, 5000, 'scanCap 欄位不對');
  assert.strictEqual(spy.toArray, 0, '竟然 toArray 了 ' + spy.toArray + ' 筆');
  assert.deepStrictEqual(spy.projection,
    { 'p1.deckId': 1, 'p2.deckId': 1, 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 },
    'projection 被動過（多讀欄位＝多傳資料、多反序列化）');
  // 沒超過上限時 truncated 必須是 false（否則這個旗標是恆真的安慰劑）
  const b2 = (await callDS(buildDeckStats(SEC, DOCS).h, { deckId: MY })).body;
  assert.strictEqual(b2.truncated, false, '沒超過上限卻回 truncated:true');
});

await T('D9 突變【M7】把上限改成 Infinity ⇒ D8 必須翻紅', async () => {
  const MUT = SEC.replace('const DECK_STATS_SCAN_CAP = 5000;', 'const DECK_STATS_SCAN_CAP = Infinity;');
  assert.notStrictEqual(MUT, SEC, '突變錨點對不上');
  const many = Array.from({ length: 5600 }, (_, i) => ({
    _id: 'x' + i, winner: i % 2, p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c1: 4 } },
  }));
  const b = (await callDS(buildDeckStats(MUT, many).h, { deckId: MY })).body;
  assert.strictEqual(b.scanned, 5600, '突變後應掃滿 5600（實得 ' + b.scanned + '）');
  assert.strictEqual(b.truncated, false, '突變後不應 truncated');
});

await T('D10 參數驗證、限流、快取（60s）', async () => {
  const { h, spy } = buildDeckStats(SEC, DOCS);
  assert.strictEqual((await callDS(h, {})).code, 400, '沒帶 deckId 應回 400');
  assert.strictEqual((await callDS(h, { deckId: 'x' })).code, 400, '不合格 deckId 應回 400');
  assert.strictEqual((await callDS(h, { deckId: { $ne: 1 } })).code, 400, '物件型 deckId（NoSQL 注入嘗試）應回 400');
  const n0 = spy.filters.length;
  await callDS(h, { deckId: MY });
  const n1 = spy.filters.length;
  assert.strictEqual(n1, n0 + 1, '第一發應該真的查');
  const r = await callDS(h, { deckId: MY });
  assert.strictEqual(spy.filters.length, n1, '第二發沒吃到快取（又查了一次）');
  assert.strictEqual(r.body.cached, true, 'cached 旗標沒有標示');
  // 限流：同一個 IP 連打
  const { h: h2 } = buildDeckStats(SEC, DOCS);
  let got429 = 0;
  for (let i = 0; i < 40; i++) {
    const rr = await callDS(h2, { deckId: MY.slice(0, 35) + (i % 10) }, { 'x-forwarded-for': '9.9.9.9' });
    if (rr.code === 429) got429++;
  }
  assert.ok(got429 >= 8, '連打 40 發只有 ' + got429 + ' 發被限流（上限應為 30/min）');
});

await T('D11 ⚠ 白名單：回應裡沒有對手的 email／暱稱／房號／牌表（一個位元都不出去）', async () => {
  const leaky = DOCS.map((d) => ({ ...d,
    roomCode: 'SECRET1', ip: '1.2.3.4',
    p1: { ...d.p1, email: 'me@x.tw', name: '我' }, p2: { ...d.p2, email: 'opp@x.tw', name: '對手' } }));
  const b = (await callDS(buildDeckStats(SEC, leaky).h, { deckId: MY })).body;
  const s = JSON.stringify(b);
  for (const leak of ['opp@x.tw', 'me@x.tw', 'SECRET1', '對手', '1.2.3.4', OTHER, '"c1"', '"c3"']) {
    assert.ok(!s.includes(leak), '回應洩漏了：' + leak + '\n        body=' + s.slice(0, 400));
  }
});

await T('D12 規則庫沒載入 ⇒ 原型表「還不知道」（空表），但總勝率照算（fail-open 不說謊）', async () => {
  const b = (await callDS(buildDeckStats(SEC, DOCS, { noRules: true }).h, { deckId: MY })).body;
  assert.strictEqual(b.vsArchetype.length, 0, '規則庫沒載入卻硬給了原型名稱');
  assert.strictEqual(b.casual.games, 8, '總勝率不應受規則庫影響');
});

console.log('\n══ 【E】⭐⭐ 事件迴圈實測（站長最在意的紅線：絕不可拖累錦標賽）════════════');
//   ⚠ pm2 是 fork_mode 單 instance ⇒ 錦標賽的 /state、/action 與這支端點跑在**同一個
//     node 行程**。只要 deck-stats 連續同步佔住事件迴圈，錦標賽的請求就會排在後面。
//   ⚠ monitorEventLoopDelay 在完全同步的區段量不到東西（迴圈根本沒轉），
//     「沒東西」與「儀器壞了」長得一模一樣 ⇒ 改用並行 setInterval 探針，
//     並在 handler 結束後多轉一次迴圈，否則被擋住的那一發永遠不會被記錄到。

function probe() {
  const lat = []; let last = process.hrtime.bigint();
  const t = setInterval(() => { const now = process.hrtime.bigint(); lat.push(Number(now - last) / 1e6 - 5); last = now; }, 5);
  if (t.unref) t.unref();
  return { stop: () => { clearInterval(t); lat.sort((a, b) => a - b); return lat; } };
}
async function measure(sectionSrc, docs, opts) {
  const p = probe();
  await new Promise((r) => setTimeout(r, 60));                 // 讓探針先跑穩
  const t0 = process.hrtime.bigint();
  const { h, spy } = buildDeckStats(sectionSrc, docs, opts);
  const res = await callDS(h, { deckId: MY }, { 'x-forwarded-for': '10.0.0.' + Math.floor(Math.random() * 250) });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  await new Promise((r) => setTimeout(r, 30));                 // ⚠ 補跑被擋住的那一發
  const lat = p.stop();
  const q = (f) => lat[Math.min(lat.length - 1, Math.floor(lat.length * f))] || 0;
  return { ms, max: lat[lat.length - 1] || 0, p99: q(0.99), res, spy };
}

// ⚠ fixture 要像線上資料：projection 之後每筆仍有雙方各約 22 種卡
//   （拿小 doc 量會低估反序列化成本，數字會漂亮得不像話）。
const N_BIG = 200000;
const BIG = Array.from({ length: N_BIG }, (_, i) => {
  const cc = () => { const o = {}; for (let j = 0; j < 22; j++) o['sv' + ((i + j) % 900)] = 1 + (j % 4); return o; };
  return { _id: 'b' + i, winner: i % 2, p1: { deckId: MY, cardCounts: cc() }, p2: { deckId: OTHER, cardCounts: cc() } };
});

await T('E1 ⭐⭐ 20 萬筆假資料連打 deck-stats：玩家／錦標賽探針不得被連續擋住', async () => {
  console.log('        ⚠ classifyDeck 在本守衛是 stub（比線上便宜）⇒ 阻塞數字是**下界**；'
    + '但讓路節拍是「每 N 筆」不是「每 N 毫秒」，比例關係不變。');
  console.log('        ⚠ 沙盒 CPU 約為正式 VM 的 10 倍慢 ⇒ 這裡的絕對值除以 10 才是線上量級。');
  await measure(SEC, BIG.slice(0, 12000));                     // 暖機（JIT/GC 不算在被測對象頭上）
  const shipped = await measure(SEC, BIG);
  // 正對照：把讓路整行拿掉 ⇒ 必須明顯更糟（否則代表探針壓根量不到東西＝儀器壞了）
  const MUT_NOYIELD = SEC.replace(
    '          const _y = adminScanYield(scanned); if (_y) await _y;   // ⚠ 每 200 筆讓路（v6.242）\n', '');
  assert.notStrictEqual(MUT_NOYIELD, SEC, '突變【M1】錨點對不上（讓路那行寫法改了？）');
  const bare = await measure(MUT_NOYIELD, BIG);

  console.log('        fixture ' + N_BIG + ' 筆／mongo 一批 8000 筆');
  console.log('        出貨碼（cursor＋每 200 筆讓路）：實掃 ' + shipped.res.body.scanned + ' 筆、'
    + shipped.ms.toFixed(0) + ' ms，⭐錦標賽被擋 max ' + shipped.max.toFixed(1) + ' ms／p99 ' + shipped.p99.toFixed(1) + ' ms');
  console.log('        突變 M1（拿掉讓路）        ：實掃 ' + bare.res.body.scanned + ' 筆、'
    + bare.ms.toFixed(0) + ' ms，⭐錦標賽被擋 max ' + bare.max.toFixed(1) + ' ms／p99 ' + bare.p99.toFixed(1) + ' ms');

  // ① 儀器自驗（Rule 33）：沒有讓路時一定要量得到明顯的連續阻塞，否則探針壞了
  assert.ok(bare.max > 25, '突變 M1 只量到 ' + bare.max.toFixed(1) + ' ms —— 探針壓根沒量到阻塞，儀器壞了');
  // ② 出貨碼：必須明顯優於「沒讓路」
  assert.ok(shipped.max < bare.max / 2, '出貨碼被擋 ' + shipped.max.toFixed(1)
    + ' ms，沒有比「不讓路」的 ' + bare.max.toFixed(1) + ' ms 明顯改善 —— 讓路沒生效');
  // ③ 絕對值。⚠ 門檻取沙盒值，除以 10 才是正式 VM 的量級；
  //    抓太緊會變成隨機翻紅的守衛（而隨機紅的守衛下一步就是被人加 skip）。
  assert.ok(shipped.max < 60, '出貨碼仍被擋 max ' + shipped.max.toFixed(1) + ' ms（沙盒上限 60 ⇒ VM 約 6ms）');
  assert.ok(shipped.p99 < 25, '出貨碼 p99 被擋 ' + shipped.p99.toFixed(1) + ' ms（沙盒上限 25 ⇒ VM 約 2.5ms）');
  // ④ ⭐ 上限本身就是最後一道保險：20 萬筆進來也只掃 5000 筆
  assert.strictEqual(shipped.res.body.scanned, 5000, '上限沒有生效（掃了 ' + shipped.res.body.scanned + ' 筆）');
  assert.strictEqual(shipped.res.body.truncated, true, '掃到上限卻沒回 truncated');
});

await T('E2 讓路 helper 用的是 v6.242 的**中央** adminScanYield（不是自己另寫一份）', () => {
  assert.ok(/adminScanYield\(scanned\)/.test(SEC), 'deck-stats 沒有呼叫中央 adminScanYield');
  assert.strictEqual((SEC.match(/function adminScanYield/g) || []).length, 0, 'deck-stats 區段裡自己又定義了一份讓路');
  const Y = new Function(extractYield(pat) + '\nreturn { adminScanYield, ADMIN_SCAN_YIELD_EVERY };')();
  assert.strictEqual(Y.adminScanYield(1), null, '不到節拍應回 null');
  assert.ok(Y.adminScanYield(Y.ADMIN_SCAN_YIELD_EVERY) instanceof Promise, '到節拍應回 Promise');
});

await T('E3 突變【M2】把 sparse 拿掉 ⇒ A2 必須翻紅（非 sparse 會把 18.5 萬筆舊列都收進索引）', () => {
  const MUT = body.replace("createIndex({ 'p1.deckId': 1 }, { sparse: true })", "createIndex({ 'p1.deckId': 1 })");
  assert.notStrictEqual(MUT, body, '突變錨點對不上');
  assert.ok(!/createIndex\(\{ 'p1\.deckId': 1 \}, \{ sparse: true \}\)/.test(MUT),
    '突變後仍然驗得到 sparse —— A2 的斷言沒有在守');
});

console.log('\n══ 【F】⭐⭐ 錦標賽零接觸（站長硬約束）══════════════════════════════════');
//   ⭐ 內嵌 sha256 ⇒ **history-free**：CI 淺複製（fetch-depth:1）下照樣在守，
//     不會像 v6.224/v6.230 那樣靜默掏空（v6.263 的教訓）。

const TOURN_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
// ⚠ v6.276 起錦標賽區塊含 6 處 additive 的 deckId 插入（報名×3＋歸檔×1 等；
//   「只有那 6 處、其餘逐位元同 v6.265」由 test-v6276 的 revert-diff 證明）。
const TOURN_SHA_V6265 = '93d29a7d68b1508c9201b660ef38f06418fc5760606bb87798f8bdd5f5ed9fdd';
// ⚠ 這是 **JS 字串長度（UTF-16 code units）**：區塊內有 emoji（surrogate pair 各算 2），
//   所以它比 Python／code-point 的 218,164 多 29。判準是下面的 sha256（對 UTF-8 bytes 算），
//   長度只是讓失敗訊息好讀；兩個值都是從 **BASE v6.265 的 blob** 算出來的，不是從出貨檔。
const TOURN_LEN_V6265 = 219484;

await T('F1 ⭐⭐ 錦標賽區塊與 v6.265 **逐位元相同**（sha256 內嵌快照，不需要 git 歷史）', () => {
  const i = pat.indexOf(TOURN_ANCHOR);
  assert.ok(i > 0, '找不到錦標賽區塊錨點（' + TOURN_ANCHOR + '）—— 掃描器壞了或檔案被大改');
  const blk = pat.slice(i);
  assert.strictEqual(blk.length, TOURN_LEN_V6265,
    '錦標賽區塊長度變了：' + blk.length + '（v6.265 是 ' + TOURN_LEN_V6265 + '）');
  const sha = createHash('sha256').update(blk, 'utf8').digest('hex');
  assert.strictEqual(sha, TOURN_SHA_V6265,
    '⚠⚠ 錦標賽區塊被動到了！sha256=' + sha + '（v6.265 是 ' + TOURN_SHA_V6265 + '）');
  console.log('        錦標賽區塊 ' + blk.length + ' 字元，sha256 與 v6.265 一致（含 TEVENTS／TREGS／TMATCH／'
    + 'TCHAT／TARCHIVE／TCHAMPS／scheduler／/state／/action／判負／瑞士制全部在內）');
});

await T('F2 掃描器自驗：F1 的 sha 比對真的抓得到一個字元的差異（否則它是安慰劑）', () => {
  const i = pat.indexOf(TOURN_ANCHOR);
  const mutated = pat.slice(i).replace('tournamentEvents', 'tournamentEventsX');
  assert.notStrictEqual(mutated, pat.slice(i), '突變錨點對不上');
  const sha = createHash('sha256').update(mutated, 'utf8').digest('hex');
  assert.notStrictEqual(sha, TOURN_SHA_V6265, 'sha 比對抓不到差異 —— F1 是安慰劑');
});

await T('F3 本版的所有改動都落在錦標賽區塊**之前**（位置證明）', () => {
  const tournAt = pat.indexOf(TOURN_ANCHOR);
  for (const [what, needle] of [
    ['sparse 索引', "createIndex({ 'p1.deckId': 1 }, { sparse: true })"],
    ['sanitizeDeckId', 'function sanitizeDeckId('],
    ['makePlayerDoc 的 deckId', 'if (_did) doc.deckId = _did;'],
    ['seat enrich 的 deckId', "'seats.deckId': 1"],
    ['deck-stats 端點', "app.get('/api/deck-stats'"],
  ]) {
    const at = pat.indexOf(needle);
    assert.ok(at > 0, '找不到本版改動：' + what);
    assert.ok(at < tournAt, what + ' 落在錦標賽區塊裡面（位置 ' + at + ' > ' + tournAt + '）');
  }
});

await T('F4 行為端：deck-stats 只碰 matchRecords＋tournamentArchives（v6.276 起錦標賽勝率讀歸檔），不碰 TROOMS/TMATCH/TEVENTS/TREGS', async () => {
  const touched = [];
  const spy = { toArray: 0, iter: 0, projection: null, filters: [], indexCalls: 0 };
  const coll = makeMatchRecordsColl(DOCS, spy, 8000, IDX_OK);
  const db = { collection: (n) => { touched.push(n); return coll; } };
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  const Y = new Function(extractYield(pat) + '\nreturn adminScanYield;')();
  const sanitizeDeckId = new Function(extractSanitizeDeckId(pat) + '\nreturn sanitizeDeckId;')();
  const env = {
    app, db, console, adminScanYield: Y, sanitizeDeckId,
    getCardNameMap: async () => NAMES, getEnabledRulesCached: async () => [RULE_PIKA],
    buildCasualCleanFilter: () => ({ roomCode: { $type: 'string' }, $or: [{ a: 1 }, { b: 2 }] }),
    deckToSets: () => ({ ids: new Set(), names: new Set() }), classifyDeck: () => ({ rule: null, all: [] }),
    casualSideResult: () => 'win',
  };
  env.archetypeNameOf = mkArchetypeNameOf(env.classifyDeck, env.deckToSets);
  new Function(...Object.keys(env), '"use strict";\n' + SEC + '\n')(...Object.values(env));
  await callDS(routes['/api/deck-stats'], { deckId: MY });
  assert.ok(touched.length > 0, '一個 collection 都沒碰（測試壞了？）');
  // ⭐v6.276：錦標賽勝率的資料來源＝tournamentArchives（唯讀、有 sparse 索引自驗）。
  //   仍然絕不容許碰 TROOMS／TMATCH／TEVENTS／TREGS（那些才是對戰熱路徑）。
  const bad = touched.filter((n) => n !== 'matchRecords' && n !== 'tournamentArchives');
  assert.strictEqual(bad.length, 0, 'deck-stats 竟然碰了：' + [...new Set(bad)].join(', '));
});

console.log('\n══ 【G】資料保全、版本、既有守衛不回退 ══════════════════════════════════');

await T('G1 ⚠ 本版沒有新增任何刪除／改寫 matchRecords 既有資料的路徑', () => {
  const bulk = [...body.matchAll(/collection\('matchRecords'\)\s*\.?\s*\n?\s*\.(deleteMany|drop|updateMany)\b/g)];
  assert.strictEqual(bulk.length, 0, 'matchRecords 出現批次刪除／改寫：' + bulk.map((x) => x[0]).join(', '));
  assert.strictEqual([...body.matchAll(/collection\('matchRecords'\)\.deleteOne\b/g)].length, 1,
    'matchRecords 的 deleteOne 呼叫點應剛好 1 處（admin 手按的）');
  assert.ok(!/matchRecords[^\n]*expireAfterSeconds/.test(body), 'matchRecords 竟然有 TTL 索引');
  // 寫入仍是 $setOnInsert（絕不可以改成 $set，那會覆寫既有列）
  const mr = body.slice(body.indexOf("app.post('/api/match-result'"));
  assert.ok(/\{ \$setOnInsert: doc \}/.test(mr.slice(0, 6000)), '/api/match-result 不再是 $setOnInsert');
});

await T('G2 v6.240~v6.243 的 admin 全量掃描不回退（cursor／adminScanYield 都還在）', () => {
  assert.ok(/const ADMIN_SCAN_YIELD_EVERY = 200;/.test(body), 'adminScanYield 節拍被動過');
  assert.strictEqual([...body.matchAll(/\.limit\(20000\)/g)].length, 0, 'limit(20000) 又回來了（v6.242 回退）');
  assert.strictEqual([...body.matchAll(/for await \(const m of _cursor\)/g)].length, 3,
    'cursor 逐筆的地方應有 3 處（v6.242 的兩支 ＋ 本版 deck-stats）');
});

await T('G3 版本一致：version.ts ≥ 6.266，admin.html SITE_VERSION_HINT 同步，且維持 LF', () => {
  const m = /export const VERSION = '([\d.]+)';/.exec(verTs);
  assert.ok(m, '抓不到 VERSION');
  assert.ok(parseFloat(m[1]) >= 6.266, 'VERSION 是 ' + m[1] + '，應 ≥ 6.266');
  const h = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(adm);
  assert.ok(h, '抓不到 SITE_VERSION_HINT');
  assert.strictEqual(h[1], m[1], 'admin.html 的 SITE_VERSION_HINT (' + h[1] + ') 與 version.ts (' + m[1] + ') 不同步');
  assert.ok(!adm.includes('\r\n'), 'admin.html 出現 CRLF（必須維持 LF）');
});

await T('G4 內部 changelog 有本版（純伺服器端 ⇒ 刻意**不寫**首頁 changelog）', () => {
  const internal = readFileSync(join(ROOT, 'docs/changelog-internal.md'), 'utf8');
  assert.ok(/^## v6\.266 /m.test(internal), 'docs/changelog-internal.md 沒有 v6.266 段落');
  const home = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');
  assert.ok(!/v6\.266/.test(home), '首頁 changelog 竟然有 v6.266 —— 本版玩家看不到任何東西，不該寫首頁');
});

// ── HEAD-FAIL（有 git 歷史時）：對真 BASE blob 跑，每一條都必須紅 ──────────────
console.log('\n══ 【H】HEAD-FAIL（對真 BASE blob；淺複製時由 B／F 的內嵌快照涵蓋）════════');
await T('H1 對 BASE v6.265 的 server_admin_patch.js：A1~A5 的每一條各自紅', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('test-v6266 【H】HEAD-FAIL（需要 BASE blob）',
      '同一件事已由【B】的內嵌 BASE 片段與【F】的內嵌 sha256 涵蓋，那兩段不需要歷史');
    return;
  }
  const r = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  assert.ok(r.ok, '拿得到 commit 卻讀不到 blob');
  const b = r.out.split('\n').slice(1).join('\n');
  const reds = [];
  const chk = (n, f) => { let red = false; try { f(); } catch (e) { if (e instanceof assert.AssertionError) red = true; else throw e; } if (red) reds.push(n); };
  chk('A1 sanitizeDeckId', () => { assert.ok(b.includes('function sanitizeDeckId('), 'x'); });
  chk('A2 sparse 索引', () => { assert.ok(/createIndex\(\{ 'p1\.deckId': 1 \}, \{ sparse: true \}\)/.test(b), 'x'); });
  chk('A3 makePlayerDoc deckId', () => { assert.ok(/if \(_did\) doc\.deckId = _did;/.test(b), 'x'); });
  chk('A4 seat enrich deckId', () => { assert.ok(/'seats\.deckId': 1/.test(b), 'x'); });
  chk('A5 deck-stats 端點', () => { assert.ok(b.includes("app.get('/api/deck-stats'"), 'x'); });
  assert.strictEqual(reds.length, 5, 'BASE 上只有 ' + reds.length + '/5 條紅（' + reds.join('、') + '）—— 其餘那幾條不是 HEAD-FAIL');
  console.log('        BASE 上 5/5 條各自紅：' + reds.join('、'));
});

console.log('\n' + (fail === 0 ? '✅ ' : '❌ ') + 'v6.266 守衛：' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
