#!/usr/bin/env node
// v6.276 守衛 —— 套牌戰績【伺服器端 P3a：錦標賽勝率】
//
// 這一版做三件事，每一件都各自有 HEAD-FAIL 斷言（BASE v6.275 上必須各自紅，見【H】）：
//   ① TREGS 報名寫入（/register、/register-and-checkin、/propose）條件式收 deckId
//   ② recordTournamentArchive 的 players[] 帶 deckId（reg 有才帶，絕不寫 null）
//   ③ /api/deck-stats 的 tournament 欄從 not-collected 變成真數字（tournamentArchives ＋
//      sparse 索引 {players.deckId:1} ＋ 索引自驗 fail-closed ＋ cap ＋ 中央讓路）
//
// ⚠⚠ 本輪最高風險＝「動到錦標賽寫入路徑」。兩層互補證明：
//   【B】revert-diff：現行錦標賽區塊逐字還原本版 6 處插入後，sha256 必須回到
//        v6.265~v6.275 一路未動的 54cd1226…／34a8448b… ⇒ 證明「只有那 6 處改動」。
//   【C】【D】行為端：把出貨端點／函式抽出來接假 mongo 真的跑，舊 payload 產出的
//        TREGS doc／歸檔 doc 與 BASE **逐位元相同**（JSON.stringify 含 key 順序）；
//        有 git 歷史時再拿 BASE blob 的同一支函式跑同一份 fixture 對照（deepStrictEqual）。
//
// ⚠⚠ 反安慰劑（已踩十種）：只捕捉 assert.AssertionError；每個突變都必須紅在預期那條；
//   行為斷言一律抽出貨碼本尊來跑；正對照 history-free（內嵌快照）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '4ce276453c998058f70a35778a6ab262fa679921';   // v6.275
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const body = pat.split('\n').slice(1).join('\n');   // 第 1 行是版本沿革註解，一律先切掉

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  PASS ' + n); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + n + '\n        ' + e.message); fail++; }
    else throw e;                                    // ⚠ 非斷言例外一律往外炸，不吞
  }
};
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ══ 抽取器（Rule 25：掃描器自己要先驗）══════════════════════════════════════
function braceEnd(s, i) { let d = 0; for (let k = i; k < s.length; k++) { const c = s[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return k + 1; } } return s.length; }
function extractFn(src, name, minLen) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, '抽不到 function ' + name);
  const txt = src.slice(i, braceEnd(src, src.indexOf('{', i)));
  assert.ok(txt.length > minLen, name + ' 抽太短（抽取器壞了？）：' + txt.length);
  return txt;
}
function epSrc(src, route) {
  const head = "app.post('" + route + "', async";
  const i = src.indexOf(head);
  assert.ok(i >= 0, '找不到端點 ' + route);
  const j = src.indexOf('\n    });\n', i);
  assert.ok(j > i, '抓不到端點 ' + route + ' 的結尾');
  return src.slice(i, j + 8);
}
function fnAsync(src, name) {
  const i = src.indexOf('    async function ' + name + '(');
  assert.ok(i >= 0, '找不到 async function ' + name);
  const j = src.indexOf('\n    }\n', i);
  assert.ok(j > i, '抓不到 ' + name + ' 的結尾');
  return src.slice(i, j + 6);
}
function extractSanitizeDeckId(src) {
  const i = src.indexOf('const DECK_ID_RE = ');
  assert.ok(i > 0, '抽不到 DECK_ID_RE');
  const j = src.indexOf('function sanitizeDeckId(', i);
  assert.ok(j > i && j - i < 200, 'DECK_ID_RE 與 sanitizeDeckId 沒有相鄰');
  return src.slice(i, braceEnd(src, src.indexOf('{', j)));
}
function extractDeckStatsSection(src) {
  const i = src.indexOf('    const DECK_STATS_SCAN_CAP =');
  assert.ok(i >= 0, '抽不到 deck-stats 區段');
  const j = src.indexOf("app.get('/api/rooms-archetypes'", i);
  assert.ok(j > i, 'deck-stats 區段後面找不到界標');
  const txt = src.slice(i, j);
  assert.ok(txt.length > 5000, 'deck-stats 區段抽太短：' + txt.length);
  return txt;
}
function extractYield(src) {
  const i = src.indexOf('const ADMIN_SCAN_YIELD_EVERY =');
  assert.ok(i > 0, '找不到中央讓路節拍');
  const j = src.indexOf('\n  }', src.indexOf('function adminScanYield', i));
  return src.slice(i, j + 4);
}

// ══ 本版 6 處插入的逐字快照（revert-diff 的資料；⚠ 這些是【資料】不是【出貨碼】）══
const INS_E5_PRE = "        // ⭐v6.276 套牌戰績（P3a）：client（v6.277+）報名可附 deckId。⚠⚠ 純 additive ——\n        //   沒送／不合格／淨化 helper 取不到（跨 IIFE：v0.94/v1.01/v6.269 教訓，handler 執行時\n        //   才從 app.locals 取）⇒ **欄位缺席**（絕不寫 null；缺席才是「舊 client」的唯一表示法，\n        //   也才不會被歸檔側的 sparse 索引收進去）。既有欄位一個字都不動、絕不因 deckId 擋報名。\n        const _sanDid = (app.locals && app.locals._sanitizeDeckId) || null;\n        const _deckId = _sanDid ? _sanDid(req.body && req.body.deckId) : null;\n";
const INS_E5_LINE_HEAD = "        await TREGS.insertOne({ _id: regId, eventId: ev._id, uid: id.uid, email: id.email || null, name: nickname, deckName, deckEntries, coinPref, checkedIn: false, registeredAt: Date.now()";
const INS_E5_TAIL_NEW = ", ...(_deckId ? { deckId: _deckId } : {}) });\n";
const INS_E5_TAIL_OLD = " });\n";
const INS_E6A_PRE = "        // ⭐v6.276：deckId 同 /register（純 additive；沒送／不合格／取不到 helper ⇒ 欄位缺席）。\n        const _sanDid = (app.locals && app.locals._sanitizeDeckId) || null;\n        const _deckId = _sanDid ? _sanDid(req.body && req.body.deckId) : null;\n";
const INS_E6B = "            ...(_deckId ? { deckId: _deckId } : {}),\n";
const INS_E7_PRE = "        // ⭐v6.276：發起者自動報名同樣可附 deckId（純 additive；規則同 /register）。\n        const _sanDid = (app.locals && app.locals._sanitizeDeckId) || null;\n        const _deckId = _sanDid ? _sanDid(b.deckId) : null;\n";
const INS_E7B_NEW = "coinPref: (cp0 === 'first' || cp0 === 'second') ? cp0 : 'random', checkedIn: false, registeredAt: now, ...(_deckId ? { deckId: _deckId } : {}) });\n";
const INS_E7B_OLD = "coinPref: (cp0 === 'first' || cp0 === 'second') ? cp0 : 'random', checkedIn: false, registeredAt: now });\n";
const INS_E8_CMT = "          // ⭐v6.276 套牌戰績（P3a）：報名有帶 deckId 的玩家，歸檔也帶下去（/api/deck-stats 的\n          //   錦標賽勝率從歸檔算）。⚠⚠ 純 additive：reg 沒有 deckId ⇒ 欄位缺席（絕不寫 null，\n          //   sparse 索引 {'players.deckId':1} 才不會把舊形狀收進去）；其餘欄位逐字不動。\n";
const INS_E8_NEW = "          players: regs.map((r) => ({ uid: r.uid, name: r.name, email: r.email || null, deckName: r.deckName || '', coinPref: r.coinPref || 'random', dropped: !!r.dropped, droppedAt: r.droppedAt || null, lateJoin: !!r.lateJoin, deckEntries: r.deckEntries || [], ...(typeof r.deckId === 'string' && r.deckId ? { deckId: r.deckId } : {}) })),\n";
const INS_E8_OLD = "          players: regs.map((r) => ({ uid: r.uid, name: r.name, email: r.email || null, deckName: r.deckName || '', coinPref: r.coinPref || 'random', dropped: !!r.dropped, droppedAt: r.droppedAt || null, lateJoin: !!r.lateJoin, deckEntries: r.deckEntries || [] })),\n";

// 錦標賽區塊指紋（v6.265 起至 v6.275 逐位元未動的值 ＋ 本版重釘的新值）
const TAIL_ANCHOR = "app.get('/api/tournament";
const TEV_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
const OLD_TAIL_SHA = '34a8448b7de92a1f9a3a30c02c01ecd274409e1520fcc73fe5e92d6da47cc12c';
const OLD_TEV_SHA = '54cd122681c99f050eadf22e7823159bc5f40ecbc88118f49e5de88cb683b196';
const OLD_TEV_LEN = 218193;
const NEW_TAIL_SHA = '495221f1dbf51dea9020284147fcf9b271d2baeccdac8d3b4745110c409dca02';
const NEW_TEV_SHA = '93d29a7d68b1508c9201b660ef38f06418fc5760606bb87798f8bdd5f5ed9fdd';

console.log('\n══ 【A】結構（每一條在 BASE v6.275 上都必須紅，見【H】）═══════════════════');

await T('A1 tournamentArchives 的 sparse 索引存在、在服務啟動段、且沒被 await', () => {
  assert.ok(/createIndex\(\{ 'players\.deckId': 1 \}, \{ sparse: true \}\)/.test(body),
    'HEAD-FAIL：缺 players.deckId 的 sparse 索引');
  const at = body.indexOf("createIndex({ 'players.deckId': 1 }");
  const firstIife = body.indexOf('(function registerMatchRecords()');
  assert.ok(at > 0 && at < firstIife, '索引不是在服務啟動段建的');
  assert.ok(!/await\s+db\.collection\('tournamentArchives'\)\.createIndex/.test(body), '索引被 await 了');
});

await T('A2 三個報名寫入點都收 deckId：app.locals 取淨化 helper ×3、條件式 spread ×3', () => {
  const tail = pat.slice(pat.indexOf(TAIL_ANCHOR));
  const nHelper = tail.split('app.locals && app.locals._sanitizeDeckId').length - 1;
  assert.strictEqual(nHelper, 3, 'HEAD-FAIL：錦標賽區塊內 app.locals._sanitizeDeckId 消費點 ' + nHelper + ' 處（應 3：register/register-and-checkin/propose）');
  const nSpread = tail.split('...(_deckId ? { deckId: _deckId } : {})').length - 1;
  assert.strictEqual(nSpread, 3, 'HEAD-FAIL：條件式 deckId spread ' + nSpread + ' 處（應 3）');
  // ⚠ 絕不可以有「一律寫」或「寫 null」的形狀（剝註解後掃）
  const nc = tail.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/deckId: _deckId \|\| null/.test(nc) && !/deckId: null/.test(nc), '出現了 deckId:null 的寫法');
});

await T('A3 歸檔 players[] 帶 deckId（條件式；其餘欄位逐字不動）', () => {
  assert.ok(body.includes("...(typeof r.deckId === 'string' && r.deckId ? { deckId: r.deckId } : {})"),
    'HEAD-FAIL：recordTournamentArchive 沒有帶 deckId');
  assert.ok(body.includes(INS_E8_NEW.trim()), '歸檔 players map 的形狀與本守衛的快照不符');
});

await T('A4 deck-stats 的錦標賽段：索引自驗＋cap＋讓路＋中央分類＋不整包讀', () => {
  const sec = extractDeckStatsSection(body);
  assert.ok(/deckStatsTarchIndexReady/.test(sec), 'HEAD-FAIL：沒有 tarch 索引自驗');
  assert.ok(/const DECK_STATS_TARCH_CAP = 300;/.test(sec), 'HEAD-FAIL：沒有 300 場歸檔上限');
  assert.ok(sec.includes('tournament: _tourn,'), 'HEAD-FAIL：tournament 欄還是寫死 not-collected');
  assert.ok(sec.includes("since: 'v6.276'"), 'HEAD-FAIL：tournament.since 不是 v6.276');
  assert.ok(/for await \(const _ta of _tc\)/.test(sec), 'HEAD-FAIL：tarch 不是 cursor 逐筆');
  assert.strictEqual(sec.split('adminScanYield(_tn)').length - 1, 2, '讓路節拍應在 players 與 matches 兩個迴圈都掛');
  assert.ok(!/\.toArray\(\)/.test(sec), 'deck-stats 區段出現整包讀取（v6.240 的 1.1GB 事故形狀）');
  assert.ok(/archetypeNameOf\(_oppEntries, nameMap, rules\)/.test(sec), '對手原型沒走中央 archetypeNameOf');
  assert.strictEqual((sec.match(/classifyDeck\(/g) || []).length, 0, 'deck-stats 區段抄了第二份分類語義');
  assert.ok(/'players\.deckId': deckId/.test(sec), '查詢不是走 players.deckId 索引形狀');
  assert.deepStrictEqual(
    /projection: (\{[^}]*\})/.exec(sec.slice(sec.indexOf('_tc'))) && true, true, 'x');
});

await T('A5 app.locals._sanitizeDeckId 的掛載點在所有 IIFE 之外（跨 IIFE 教訓 v0.94/v1.01/v6.269）', () => {
  const at = body.indexOf('app.locals._sanitizeDeckId = sanitizeDeckId');
  assert.ok(at > 0, 'HEAD-FAIL：沒有掛 app.locals._sanitizeDeckId');
  const firstIife = body.indexOf('(function registerMatchRecords()');
  assert.ok(at < firstIife, '掛載點在 IIFE 內 ⇒ 錦標賽 IIFE 可能取不到');
});

console.log('\n══ 【B】⭐⭐⭐ revert-diff：錦標賽區塊＝v6.265 ＋ 恰好這 6 處插入 ═══════════');

function revertTail(tail) {
  let r = tail;
  const rem = (needle, tag) => {
    const n = r.split(needle).length - 1;
    assert.strictEqual(n, 1, 'revert-diff：' + tag + ' 出現 ' + n + ' 次（應恰 1）—— 區塊被動了不只宣告的那幾處');
    r = r.replace(needle, '');
  };
  const swap = (a, b, tag) => {
    const n = r.split(a).length - 1;
    assert.strictEqual(n, 1, 'revert-diff：' + tag + ' 出現 ' + n + ' 次（應恰 1）');
    r = r.replace(a, b);
  };
  rem(INS_E5_PRE, 'E5 /register 前置段');
  swap(INS_E5_LINE_HEAD + INS_E5_TAIL_NEW, INS_E5_LINE_HEAD + INS_E5_TAIL_OLD, 'E5 /register insertOne 尾巴');
  rem(INS_E6A_PRE, 'E6a /register-and-checkin 前置段');
  rem(INS_E6B, 'E6b /register-and-checkin insertOne 欄位');
  rem(INS_E7_PRE, 'E7a /propose 前置段');
  swap(INS_E7B_NEW, INS_E7B_OLD, 'E7b /propose insertOne 尾巴');
  rem(INS_E8_CMT, 'E8 歸檔註解');
  swap(INS_E8_NEW, INS_E8_OLD, 'E8 歸檔 players map');
  return r;
}

await T('B1 ⭐⭐⭐ 逐字還原 6 處插入後，區塊尾 sha256 回到 v6.275 的 34a8448b…（逐位元）', () => {
  const ti = pat.indexOf(TAIL_ANCHOR);
  assert.ok(ti > 0, '找不到錦標賽區塊錨點');
  const reverted = revertTail(pat.slice(ti));
  assert.strictEqual(sha256(reverted), OLD_TAIL_SHA,
    '還原後 sha=' + sha256(reverted) + ' ≠ v6.275 的 ' + OLD_TAIL_SHA + ' —— 區塊有「宣告之外」的改動');
});

await T('B2 同上以 TEVENTS 錨點驗（v6.265 的 54cd1226…／長度 218193）', () => {
  const ti = pat.indexOf(TAIL_ANCHOR);
  const reverted = revertTail(pat.slice(ti));
  const tev = reverted.slice(reverted.indexOf(TEV_ANCHOR));
  assert.strictEqual(tev.length, OLD_TEV_LEN, '長度 ' + tev.length + ' ≠ ' + OLD_TEV_LEN);
  assert.strictEqual(sha256(tev), OLD_TEV_SHA, 'TEVENTS 區塊還原後 sha 不符');
});

await T('B3 突變【M6】revert-diff 不是恆真：區塊內改一個字元 ⇒ B1 必須翻紅', () => {
  const ti = pat.indexOf(TAIL_ANCHOR);
  const mutated = pat.slice(ti).replace('tournamentEvents', 'tournamentEventsX');
  assert.notStrictEqual(sha256(revertTail(mutated)), OLD_TAIL_SHA, 'revert-diff 抓不到差異 —— B1 是安慰劑');
});

await T('B4 現行區塊的新指紋與重釘後的 4 支既有守衛一致（防釘錯值）', () => {
  const tail = pat.slice(pat.indexOf(TAIL_ANCHOR));
  assert.strictEqual(sha256(tail), NEW_TAIL_SHA, '現行 tail sha 與本守衛內嵌的新值不符');
  const tev = pat.slice(pat.indexOf(TEV_ANCHOR));
  assert.strictEqual(sha256(tev), NEW_TEV_SHA, '現行 TEVENTS sha 與本守衛內嵌的新值不符');
  for (const [f, v] of [
    ['scripts/test-v6265-phantom-start-race.mjs', NEW_TAIL_SHA],
    ['scripts/test-v6272-firestore-read-reduction.mjs', NEW_TAIL_SHA],
    ['scripts/test-v6275-usersall-scan-guard.mjs', NEW_TAIL_SHA],
    ['scripts/test-v6266-deck-stats-server.mjs', NEW_TEV_SHA],
    ['scripts/test-v6268-delta-put-server.mjs', NEW_TEV_SHA],
  ]) {
    assert.ok(readFileSync(join(ROOT, f), 'utf8').includes(v), f + ' 沒有重釘到新的 sha（它現在守的是錯的值）');
  }
});

console.log('\n══ 【C】⭐⭐⭐ 報名行為：舊 payload 產出的 TREGS doc 與 BASE 逐位元相同 ═══════');

const FROZEN_NOW = 1756500000000;
const FakeDate = { now: () => FROZEN_NOW };
const realSanitize = new Function(extractSanitizeDeckId(pat) + '\nreturn sanitizeDeckId;')();
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DECK60 = [{ cardId: 'c1', count: 60 }];

function runRegister(src, payload, opts) {
  const o = opts || {};
  const captured = [];
  const env = {
    app: { post: () => {}, locals: o.noHelper ? {} : { _sanitizeDeckId: realSanitize } },
    tournIdentity: async () => ({ uid: 'u1', email: 'a@b.tw' }),
    resolveEventFromReq: async () => ({ _id: 'EV', status: 'registration', maxPlayers: null }),
    deckCount: (d) => (Array.isArray(d) ? d.reduce((a, e) => a + (e.count || 0), 0) : 0),
    TREGS: { findOne: async () => null, countDocuments: async () => 0, insertOne: async (d) => { captured.push(d); }, deleteOne: async () => {} },
    Date: FakeDate,
  };
  let handler = null;
  env.app.post = (p, h) => { handler = h; };
  new Function(...Object.keys(env), '"use strict";\n' + src + '\n')(...Object.values(env));
  assert.ok(handler, 'register handler 沒抽到');
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  return handler({ body: payload }, res).then(() => ({ res, captured }));
}

const REG_SRC = epSrc(pat, '/api/tournament/register');
const OLD_REG_PAYLOAD = { deckEntries: DECK60, name: '暱稱', deckName: 'DN', coinPref: 'first' };
// BASE（v6.275）/register 寫入的 doc（欄位與順序逐字轉錄自 BASE 原始碼那一行；history-free 快照）
const EXPECTED_BASE_REG = '{"_id":"EV__u1","eventId":"EV","uid":"u1","email":"a@b.tw","name":"暱稱","deckName":"DN","deckEntries":[{"cardId":"c1","count":60}],"coinPref":"first","checkedIn":false,"registeredAt":1756500000000}';

await T('C1 ⭐⭐ /register 舊 payload（沒有 deckId）⇒ doc 與 BASE 逐位元相同（含 key 順序）', async () => {
  const { res, captured } = await runRegister(REG_SRC, OLD_REG_PAYLOAD);
  assert.strictEqual(res.code, 200, '報名應成功，實得 ' + res.code + ' ' + JSON.stringify(res.body));
  assert.strictEqual(captured.length, 1, '應寫入恰 1 筆');
  assert.strictEqual(JSON.stringify(captured[0]), EXPECTED_BASE_REG,
    'doc 變了！\n        BASE   =' + EXPECTED_BASE_REG + '\n        SHIPPED=' + JSON.stringify(captured[0]));
});

await T('C2 /register 帶合格 deckId ⇒ 同一份 doc ＋ 僅多一個 deckId（附加在最後）', async () => {
  const { captured } = await runRegister(REG_SRC, { ...OLD_REG_PAYLOAD, deckId: UUID });
  assert.strictEqual(JSON.stringify(captured[0]),
    EXPECTED_BASE_REG.slice(0, -1) + ',"deckId":"' + UUID + '"}', 'doc=' + JSON.stringify(captured[0]));
});

await T('C3 不合格 deckId／helper 取不到（fail-closed）⇒ doc 與 BASE 逐位元相同、絕不擋報名', async () => {
  for (const bad of [null, 123, {}, [], '', 'short', 'x'.repeat(65), 'has space', { $ne: 1 }]) {
    const { res, captured } = await runRegister(REG_SRC, { ...OLD_REG_PAYLOAD, deckId: bad });
    assert.strictEqual(res.code, 200, 'deckId=' + JSON.stringify(bad) + ' 竟然擋了報名');
    assert.strictEqual(JSON.stringify(captured[0]), EXPECTED_BASE_REG, 'deckId=' + JSON.stringify(bad) + ' 影響了 doc');
  }
  const { res, captured } = await runRegister(REG_SRC, { ...OLD_REG_PAYLOAD, deckId: UUID }, { noHelper: true });
  assert.strictEqual(res.code, 200, 'helper 缺席竟然擋了報名');
  assert.strictEqual(JSON.stringify(captured[0]), EXPECTED_BASE_REG, 'helper 缺席仍寫入了 deckId？');
});

await T('C4 突變【M3】把 deckId 改成一律寫 ⇒ C1 必須翻紅', async () => {
  const MUT = REG_SRC.replace(', ...(_deckId ? { deckId: _deckId } : {}) });', ', deckId: _deckId });');
  assert.notStrictEqual(MUT, REG_SRC, '突變錨點對不上');
  const { captured } = await runRegister(MUT, OLD_REG_PAYLOAD);
  assert.notStrictEqual(JSON.stringify(captured[0]), EXPECTED_BASE_REG, '突變後 doc 竟然沒變 —— C1 沒有在守');
  assert.ok('deckId' in captured[0] && captured[0].deckId === null, '突變應寫入 deckId:null');
});

function runRac(src, payload, opts) {
  const o = opts || {};
  const captured = [];
  const env = {
    app: { post: () => {}, locals: { _sanitizeDeckId: realSanitize } },
    tournIdentity: async () => ({ uid: 'u1', email: 'a@b.tw' }),
    resolveEventFromReq: async () => ({ _id: 'EV', status: 'checkin', maxPlayers: null }),
    deckCount: (d) => (Array.isArray(d) ? d.reduce((a, e) => a + (e.count || 0), 0) : 0),
    TREGS: { findOne: async () => null, countDocuments: async () => 0, insertOne: async (d) => { captured.push(d); }, deleteOne: async () => {} },
    TEVENTS: { findOne: async () => ({ _id: 'EV', status: 'checkin' }) },
    runInSeedChain: (fn) => fn(),
    TMINVER_RE: /^\d+(?:\.\d+)?$/,
    Date: FakeDate,
  };
  let handler = null;
  env.app.post = (p, h) => { handler = h; };
  new Function(...Object.keys(env), '"use strict";\n' + src + '\n')(...Object.values(env));
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  return handler({ body: payload }, res).then(() => ({ res, captured }));
}

const RAC_SRC = epSrc(pat, '/api/tournament/register-and-checkin');
const EXPECTED_BASE_RAC = '{"_id":"EV__u1","eventId":"EV","uid":"u1","email":"a@b.tw","name":"暱稱","deckName":"DN","deckEntries":[{"cardId":"c1","count":60}],"coinPref":"first","checkedIn":true,"lateJoin":true,"registeredAt":1756500000000,"checkedInAt":1756500000000,"clientVer":"pre-gate"}';

await T('C5 /register-and-checkin：舊 payload doc 與 BASE 逐位元相同；帶 deckId 只多一欄', async () => {
  const a = await runRac(RAC_SRC, OLD_REG_PAYLOAD);
  assert.strictEqual(a.res.code, 200, '補報應成功 ' + JSON.stringify(a.res.body));
  assert.strictEqual(JSON.stringify(a.captured[0]), EXPECTED_BASE_RAC,
    '\n        BASE   =' + EXPECTED_BASE_RAC + '\n        SHIPPED=' + JSON.stringify(a.captured[0]));
  const b = await runRac(RAC_SRC, { ...OLD_REG_PAYLOAD, deckId: UUID });
  assert.strictEqual(JSON.stringify(b.captured[0]),
    EXPECTED_BASE_RAC.slice(0, -1) + ',"deckId":"' + UUID + '"}', 'doc=' + JSON.stringify(b.captured[0]));
});

function runPropose(src, payload) {
  const capReg = [], capEv = [];
  const env = {
    app: { post: () => {}, locals: { _sanitizeDeckId: realSanitize } },
    tournIdentity: async () => ({ uid: 'u1', email: 'a@b.tw' }),
    deckCount: (d) => (Array.isArray(d) ? d.reduce((a, e) => a + (e.count || 0), 0) : 0),
    TEVENTS: { findOne: async () => null, insertOne: async (d) => { capEv.push(d); } },
    TREGS: { insertOne: async (d) => { capReg.push(d); } },
    postSystemChat: async () => {},
    getBusyUids: async () => [],
    broadcastPush: async () => {},
    sendPushToUids: async () => {},
    Date: FakeDate,
    Math: { random: () => 0.5, floor: Math.floor, max: Math.max, min: Math.min, ceil: Math.ceil },
  };
  let handler = null;
  env.app.post = (p, h) => { handler = h; };
  new Function(...Object.keys(env), '"use strict";\n' + src + '\n')(...Object.values(env));
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  return handler({ body: payload }, res).then(() => ({ res, capReg, capEv }));
}

const PROPOSE_SRC = epSrc(pat, '/api/tournament/propose');
const PROPOSE_PAYLOAD = { deckEntries: DECK60, nickname: '暱稱', deckName: 'DN', coinPref: 'second', format: 'single-elim', rallyMin: 30 };

await T('C6 /propose：發起者自動報名的 doc —— 舊 payload 與 BASE 同形；帶 deckId 只多一欄；賽事 doc 零改變', async () => {
  const a = await runPropose(PROPOSE_SRC, PROPOSE_PAYLOAD);
  assert.strictEqual(a.res.code, 200, '發起應成功 ' + JSON.stringify(a.res.body));
  assert.strictEqual(a.capReg.length, 1, '應自動報名 1 筆');
  const oldJson = JSON.stringify(a.capReg[0]);
  assert.ok(!oldJson.includes('deckId'), '舊 payload 竟然寫入 deckId：' + oldJson);
  const b = await runPropose(PROPOSE_SRC, { ...PROPOSE_PAYLOAD, deckId: UUID });
  assert.strictEqual(JSON.stringify(b.capReg[0]), oldJson.slice(0, -1) + ',"deckId":"' + UUID + '"}',
    'doc=' + JSON.stringify(b.capReg[0]));
  assert.strictEqual(JSON.stringify(a.capEv[0]), JSON.stringify(b.capEv[0]), '賽事 doc 竟然因 deckId 而不同');
});

console.log('\n══ 【D】⭐⭐⭐ 歸檔行為：players[] 與 BASE 同形，只有帶 deckId 的 reg 多一欄 ══');

function runArchive(src, regs, matches) {
  const captured = [];
  const env = {
    TREGS: { find: () => ({ toArray: async () => JSON.parse(JSON.stringify(regs)) }) },
    TMATCH: { find: () => ({ sort: () => ({ toArray: async () => JSON.parse(JSON.stringify(matches)) }) }) },
    TARCHIVE: { updateOne: async (q, u) => { captured.push(u.$set); } },
    Date: FakeDate,
  };
  const code = src + '\nreturn recordTournamentArchive;';
  const fn = new Function(...Object.keys(env), '"use strict";\n' + code)(...Object.values(env));
  return fn({ _id: 'EV', name: '測試賽', createdAt: 1, startedAt: 2, format: 'swiss-then-cut', bestOf: 1, championUid: 'u1', championName: '甲', createdByPlayer: false }).then(() => captured);
}

const ARCH_SRC = fnAsync(pat, 'recordTournamentArchive');
const REG_A = { _id: 'EV__u1', eventId: 'EV', uid: 'u1', email: 'a@b.tw', name: '甲', deckName: 'D1', deckEntries: DECK60, coinPref: 'first', checkedIn: true, registeredAt: 1, deckId: UUID };
const REG_B = { _id: 'EV__u2', eventId: 'EV', uid: 'u2', email: null, name: '乙', deckName: '', deckEntries: [], coinPref: 'random', checkedIn: true, registeredAt: 1, dropped: true, droppedAt: 9, lateJoin: true };
const MATCHES = [{ _id: 'm0', round: 1, idx: 0, p1uid: 'u1', p1name: '甲', p2uid: 'u2', p2name: '乙', winnerUid: 'u1', winnerName: '甲', status: 'done', bye: false }];
// BASE players map 的輸出形狀（逐字轉錄自 BASE 原始碼；history-free 快照）
const EXPECTED_BASE_PLAYER_B = '{"uid":"u2","name":"乙","email":null,"deckName":"","coinPref":"random","dropped":true,"droppedAt":9,"lateJoin":true,"deckEntries":[]}';

await T('D1 ⭐⭐ 沒有 deckId 的 reg ⇒ 歸檔 player 與 BASE 逐位元相同；有 deckId 的只多一欄', async () => {
  const [setDoc] = await runArchive(ARCH_SRC, [REG_A, REG_B], MATCHES);
  assert.strictEqual(setDoc.players.length, 2);
  assert.strictEqual(JSON.stringify(setDoc.players[1]), EXPECTED_BASE_PLAYER_B,
    '\n        BASE   =' + EXPECTED_BASE_PLAYER_B + '\n        SHIPPED=' + JSON.stringify(setDoc.players[1]));
  const pa = setDoc.players[0];
  assert.strictEqual(pa.deckId, UUID, '有 deckId 的 reg 沒帶進歸檔');
  const { deckId: _drop, ...rest } = pa;
  assert.ok(!JSON.stringify(rest).includes('deckId'), 'x');
  assert.ok(JSON.stringify(pa).endsWith(',"deckId":"' + UUID + '"}'), 'deckId 應附加在最後：' + JSON.stringify(pa));
  // matches 一個字都不動
  assert.strictEqual(JSON.stringify(setDoc.matches),
    '[{"round":1,"idx":0,"p1uid":"u1","p1name":"甲","p2uid":"u2","p2name":"乙","winnerUid":"u1","winnerName":"甲","status":"done","bye":false,"noShow":false,"doubleNoShow":false,"draw":false,"deadlockDraw":false,"forfeit":false,"idleForfeit":false,"timeLimit":false,"adminResolved":false,"doubleDrop":false,"dropForfeit":false}]',
    'matches 映射被動到了：' + JSON.stringify(setDoc.matches));
});

await T('D2 突變【M4】歸檔改成一律寫 deckId ⇒ D1 必須翻紅', async () => {
  const MUT = ARCH_SRC.replace("...(typeof r.deckId === 'string' && r.deckId ? { deckId: r.deckId } : {})", 'deckId: r.deckId || null');
  assert.notStrictEqual(MUT, ARCH_SRC, '突變錨點對不上');
  const [setDoc] = await runArchive(MUT, [REG_A, REG_B], MATCHES);
  assert.notStrictEqual(JSON.stringify(setDoc.players[1]), EXPECTED_BASE_PLAYER_B, '突變後竟然沒差 —— D1 沒有在守');
  assert.strictEqual(setDoc.players[1].deckId, null, '突變應寫 deckId:null（sparse 索引會被它收進去）');
});

console.log('\n══ 【E】deck-stats 錦標賽段行為（出貨碼本尊＋假 mongo 實跑）═══════════════');

const NAMES = new Map([['c1', '皮卡丘'], ['c2', '老大的指令'], ['c3', '烈咬陸鯊']]);
const RULE_PIKA = { _id: 'R1', name: '皮卡丘', includes: ['皮卡丘'] };
const IDX_MR = [{ key: { _id: 1 } }, { key: { 'p1.deckId': 1 }, sparse: true }, { key: { 'p2.deckId': 1 }, sparse: true }];
const IDX_TARCH = [{ key: { _id: 1 } }, { key: { 'players.deckId': 1 }, sparse: true }];
const IDX_TARCH_MISSING = [{ key: { _id: 1 } }];

function makeColl(docs, spy, batchSize, indexes) {
  return {
    indexes: async () => { spy.indexCalls++; if (indexes === 'throw') throw new Error('listIndexes failed'); return indexes; },
    find(filter, opts) {
      spy.filters.push(filter);
      spy.projection = opts && opts.projection;
      const cur = {};
      cur.sort = () => cur; cur.skip = () => cur; cur.batchSize = () => cur; cur.limit = () => cur;
      cur.toArray = async () => { spy.toArray += docs.length; return JSON.parse(JSON.stringify(docs)); };
      cur[Symbol.asyncIterator] = async function* () {
        for (let i = 0; i < docs.length; i += (batchSize || 8000)) {
          await new Promise((r) => setTimeout(r, 0));           // 批間網路往返（真 macrotask）
          const end = Math.min(i + (batchSize || 8000), docs.length);
          for (let k = i; k < end; k++) { spy.iter++; yield JSON.parse(JSON.stringify(docs[k])); }
        }
      };
      return cur;
    },
  };
}
function mkArchetypeNameOf(classifyDeck, deckToSets) {
  return new Function('classifyDeck', 'deckToSets',
    extractFn(pat, 'archetypeNameOf', 150) + '\nreturn archetypeNameOf;')(classifyDeck, deckToSets);
}
function buildDS(sectionSrc, mrDocs, tarchDocs, opts) {
  const o = opts || {};
  const mrSpy = { toArray: 0, iter: 0, projection: null, filters: [], indexCalls: 0 };
  const taSpy = { toArray: 0, iter: 0, projection: null, filters: [], indexCalls: 0 };
  const mr = makeColl(mrDocs, mrSpy, o.batchSize, o.mrIndexes === undefined ? IDX_MR : o.mrIndexes);
  const ta = makeColl(tarchDocs, taSpy, o.batchSize, o.taIndexes === undefined ? IDX_TARCH : o.taIndexes);
  const db = { collection: (n) => (n === 'tournamentArchives' ? ta : mr) };
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; } };
  const Y = new Function(extractYield(pat) + '\nreturn adminScanYield;')();
  const env = {
    app, db, console,
    adminScanYield: Y,
    sanitizeDeckId: realSanitize,
    getCardNameMap: async () => NAMES,
    getEnabledRulesCached: async () => [RULE_PIKA],
    buildCasualCleanFilter: (x) => ({ roomCode: { $type: 'string' }, $or: [{ a: 1 }, { b: 2 }], _o: x }),
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
  env.tournSideResult = new Function(extractFn(pat, 'tournSideResult', 40) + '\nreturn tournSideResult;')();
  env.archetypeNameOf = mkArchetypeNameOf(env.classifyDeck, env.deckToSets);
  new Function(...Object.keys(env), '"use strict";\n' + sectionSrc + '\n')(...Object.values(env));
  assert.ok(routes['/api/deck-stats'], '區段沒有註冊 /api/deck-stats');
  return { h: routes['/api/deck-stats'], mrSpy, taSpy };
}
let _ipSeq = 0;
const callDS = async (h, deckId) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  _ipSeq++;
  await h({ query: { deckId }, headers: { 'x-forwarded-for': '10.1.' + Math.floor(_ipSeq / 200) + '.' + (_ipSeq % 200) } }, res);
  return res;
};

const SEC = extractDeckStatsSection(pat);
const MY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER = 'ffffffff-0000-1111-2222-333333333333';
const mkEntries = (id) => [{ cardId: id, count: 60 }];
const MR_DOCS = [
  { _id: 'r1', winner: 0, p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { deckId: OTHER, cardCounts: { c1: 4 } } },
  { _id: 'r2', winner: 1, p1: { deckId: MY, cardCounts: { c3: 4 } }, p2: { cardCounts: { c1: 4 } } },
];
const TARCH_DOCS = [
  { _id: 'arch_E1', eventId: 'E1', finishedAt: 100,
    players: [
      { uid: 'u1', deckId: MY, deckEntries: mkEntries('c3') },
      { uid: 'u2', deckEntries: mkEntries('c1') },                       // 皮卡丘
      { uid: 'u3', deckEntries: mkEntries('c2') },                       // 未分類
      { uid: 'u4' },                                                     // 沒牌表 ⇒ 還不知道
    ],
    matches: [
      { round: 1, idx: 0, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1', status: 'done', bye: false },  // 勝，對皮卡丘
      { round: 1, idx: 1, p1uid: 'u3', p2uid: 'u1', winnerUid: 'u3', status: 'done', bye: false },  // 敗，對未分類
      { round: 2, idx: 0, p1uid: 'u1', p2uid: null, winnerUid: 'u1', status: 'done', bye: true },   // 輪空 ⇒ 不計
      { round: 3, idx: 0, p1uid: 'u1', p2uid: 'u4', winnerUid: null, status: 'done', draw: true },  // 平手（無勝方）⇒ 不計
      { round: 4, idx: 0, p1uid: 'u1', p2uid: 'u4', winnerUid: null, status: 'pending' },           // 沒打完 ⇒ 不計
    ] },
  { _id: 'arch_E2', eventId: 'E2', finishedAt: 90,
    players: [{ uid: 'x1', deckId: MY, deckEntries: [] }, { uid: 'x2' }],
    matches: [{ round: 1, idx: 0, p1uid: 'x1', p2uid: 'x2', winnerUid: 'x1', status: 'done', bye: false }] },  // 勝，對手沒牌表
];

await T('E1 ⭐⭐ 錦標賽勝率：2 場歸檔 ⇒ 3 計 2 勝 1 敗；對原型分帳走中央分類；draws 恆 0', async () => {
  const { h, taSpy } = buildDS(SEC, MR_DOCS, TARCH_DOCS);
  const b = (await callDS(h, MY)).body;
  assert.strictEqual(b.tournament.status, 'ok', 'status=' + b.tournament.status);
  assert.strictEqual(b.tournament.games, 3, 'games=' + b.tournament.games);
  assert.strictEqual(b.tournament.wins, 2, 'wins=' + b.tournament.wins);
  assert.strictEqual(b.tournament.losses, 1, 'losses=' + b.tournament.losses);
  assert.strictEqual(b.tournament.draws, 0, 'draws=' + b.tournament.draws);
  assert.strictEqual(b.tournament.winRate, 2 / 3, 'winRate=' + b.tournament.winRate);
  assert.strictEqual(b.tournament.events, 2, 'events=' + b.tournament.events);
  assert.strictEqual(b.tournament.since, 'v6.276', 'since=' + b.tournament.since);
  const byName = Object.fromEntries(b.tournament.vsArchetype.map((r) => [r.name, r]));
  assert.deepStrictEqual(byName['皮卡丘'], { name: '皮卡丘', games: 1, wins: 1, losses: 0, draws: 0, winRate: 1 }, JSON.stringify(byName));
  assert.deepStrictEqual(byName['未分類'], { name: '未分類', games: 1, wins: 0, losses: 1, draws: 0, winRate: 0 }, JSON.stringify(byName));
  assert.strictEqual(b.tournament.vsArchetype.length, 2, '對手沒牌表的那 1 場不可以進原型表');
  // 休閒段不受影響
  assert.strictEqual(b.casual.games, 2, 'casual games=' + b.casual.games);
  // 查詢形狀與 projection 白名單
  assert.deepStrictEqual(taSpy.filters[0], { 'players.deckId': MY }, 'tarch 查詢形狀不對');
  assert.deepStrictEqual(taSpy.projection,
    { 'players.uid': 1, 'players.deckId': 1, 'players.deckEntries': 1, matches: 1 },
    'tarch projection 被動過');
  assert.strictEqual(taSpy.toArray, 0, 'tarch 竟然整包讀了 ' + taSpy.toArray + ' 筆');
});

await T('E2 ⭐⭐ 舊 client 契約：查無錦標賽資料 ⇒ tournament 前六個 key 與 BASE 逐位元相同', async () => {
  const { h } = buildDS(SEC, MR_DOCS, []);
  const b = (await callDS(h, MY)).body;
  // BASE（v6.266~v6.275）的字面量：{ status:'not-collected', games:0, wins:0, losses:0, draws:0, winRate:null }
  assert.ok(JSON.stringify(b.tournament).startsWith(
    '{"status":"not-collected","games":0,"wins":0,"losses":0,"draws":0,"winRate":null'),
    '前六個 key（值與順序）變了：' + JSON.stringify(b.tournament).slice(0, 140));
  // 其餘欄位（哨兵/casual/vsArchetype/since）逐一維持 BASE 語義
  assert.strictEqual(b.deckStatsApi, 1, '哨兵不見了');
  assert.strictEqual(b.since, 'v6.266', '頂層 since 應維持 v6.266（休閒口徑），實得 ' + b.since);
  assert.strictEqual(b.casual.games, 2, 'casual 不應受影響');
});

await T('E3 ⚠⚠ tarch 索引缺席 ⇒ 錦標賽段 fail-closed（not-collected）、零查詢；休閒照常', async () => {
  const { h, taSpy } = buildDS(SEC, MR_DOCS, TARCH_DOCS, { taIndexes: IDX_TARCH_MISSING });
  const r = await callDS(h, MY);
  assert.strictEqual(r.code, 200, '索引缺席不該 503（只有 matchRecords 索引缺席才 503）');
  assert.strictEqual(r.body.tournament.status, 'not-collected', '缺索引竟然還算出了數字');
  assert.strictEqual(taSpy.filters.length, 0, '⚠⚠ 缺索引竟然發了 tarch 查詢（COLLSCAN）！');
  assert.strictEqual(r.body.casual.games, 2, '休閒段不該受影響');
  const { h: h2, taSpy: s2 } = buildDS(SEC, MR_DOCS, TARCH_DOCS, { taIndexes: 'throw' });
  const r2 = await callDS(h2, MY);
  assert.strictEqual(r2.body.tournament.status, 'not-collected', 'listIndexes 掛掉時應 fail-closed');
  assert.strictEqual(s2.filters.length, 0, 'listIndexes 掛掉竟然還查');
});

await T('E4 突變【M5】拿掉索引自驗 gate ⇒ E3 必須翻紅（缺索引也照查）', async () => {
  const MUT = SEC.replace('if (await deckStatsTarchIndexReady()) {', 'if (true) {');
  assert.notStrictEqual(MUT, SEC, '突變錨點對不上');
  const { h, taSpy } = buildDS(MUT, MR_DOCS, TARCH_DOCS, { taIndexes: IDX_TARCH_MISSING });
  const r = await callDS(h, MY);
  assert.strictEqual(r.body.tournament.status, 'ok', '突變後應照算（實得 ' + r.body.tournament.status + '）');
  assert.ok(taSpy.filters.length >= 1, '突變後竟然沒查 —— E3 的斷言沒有在守');
});

await T('E5 掃描上限 300 場歸檔＋truncated 誠實回報；突變【M2】拿掉上限必須翻紅', async () => {
  const many = Array.from({ length: 350 }, (_, i) => ({
    _id: 'arch_M' + i, finishedAt: i,
    players: [{ uid: 'u' + i, deckId: MY, deckEntries: [] }],
    matches: [{ p1uid: 'u' + i, p2uid: 'z', winnerUid: 'u' + i, bye: false }],
  }));
  const b = (await callDS(buildDS(SEC, MR_DOCS, many).h, MY)).body;
  assert.strictEqual(b.tournament.events, 300, 'events=' + b.tournament.events + '（上限應 300）');
  assert.strictEqual(b.tournament.truncated, true, '超過上限沒有誠實回報');
  assert.strictEqual(b.tournament.scanCap, 300, 'scanCap 欄位不對');
  const b2 = (await callDS(buildDS(SEC, MR_DOCS, TARCH_DOCS).h, MY)).body;
  assert.strictEqual(b2.tournament.truncated, false, '沒超過上限卻 truncated:true（恆真旗標＝安慰劑）');
  const MUT = SEC.replace('const DECK_STATS_TARCH_CAP = 300;', 'const DECK_STATS_TARCH_CAP = Infinity;');
  assert.notStrictEqual(MUT, SEC, '突變錨點對不上');
  const bm = (await callDS(buildDS(MUT, MR_DOCS, many).h, MY)).body;
  assert.strictEqual(bm.tournament.events, 350, '突變後應掃滿 350（實得 ' + bm.tournament.events + '）');
});

await T('E6 ⚠ 白名單：回應沒有對手 uid／email／暱稱／牌表 cardId（一個位元都不出去）', async () => {
  const leaky = JSON.parse(JSON.stringify(TARCH_DOCS));
  leaky[0].players[1].email = 'opp@x.tw'; leaky[0].players[1].name = '對手甲';
  const s = JSON.stringify((await callDS(buildDS(SEC, MR_DOCS, leaky).h, MY)).body);
  for (const leak of ['u1', 'u2', 'u3', 'x1', 'opp@x.tw', '對手甲', '"c1"', '"c3"', 'arch_E1']) {
    assert.ok(!s.includes(leak), '回應洩漏了：' + leak + '\n        body=' + s.slice(0, 300));
  }
});

console.log('\n══ 【F】⭐⭐ 事件迴圈實測（絕不拖累錦標賽；pm2 fork_mode 單 instance）════════');

function probe() {
  const lat = []; let last = process.hrtime.bigint();
  const t = setInterval(() => { const now = process.hrtime.bigint(); lat.push(Number(now - last) / 1e6 - 5); last = now; }, 5);
  if (t.unref) t.unref();
  return { stop: () => { clearInterval(t); lat.sort((a, b) => a - b); return lat; } };
}
async function measure(sectionSrc, tarchDocs) {
  const p = probe();
  await new Promise((r) => setTimeout(r, 60));
  const t0 = process.hrtime.bigint();
  const { h } = buildDS(sectionSrc, MR_DOCS, tarchDocs, { batchSize: 1000000 });
  const res = await callDS(h, MY);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  await new Promise((r) => setTimeout(r, 30));
  const lat = p.stop();
  const q = (f) => lat[Math.min(lat.length - 1, Math.floor(lat.length * f))] || 0;
  return { ms, max: lat[lat.length - 1] || 0, p99: q(0.99), res };
}
// fixture 要像線上：每場歸檔 24 位玩家（各 60 種卡的 deckEntries）＋ 24 場對局
const N_ARCH = 300;
const BIGARCH = Array.from({ length: N_ARCH }, (_, i) => {
  const players = [{ uid: 'me' + i, deckId: MY, deckEntries: mkEntries('c3') }];
  for (let j = 1; j < 24; j++) {
    const de = []; for (let k = 0; k < 60; k++) de.push({ cardId: 'sv' + ((i + j * 7 + k) % 900), count: 1 });
    players.push({ uid: 'p' + i + '_' + j, deckEntries: de });
  }
  const matches = [];
  for (let j = 1; j < 24; j++) matches.push({ p1uid: 'me' + i, p2uid: 'p' + i + '_' + j, winnerUid: (j % 2 ? 'me' + i : 'p' + i + '_' + j), bye: false });
  return { _id: 'arch_B' + i, finishedAt: i, players, matches };
});

await T('F1 ⭐⭐ 300 場大歸檔連打：讓路有效；突變【M1】拿掉讓路必須明顯更糟', async () => {
  console.log('        ⚠ 沙盒 CPU 約為正式 VM 的 10 倍慢 ⇒ 絕對值除以 10 才是線上量級。');
  await measure(SEC, BIGARCH.slice(0, 30));                     // 暖機
  const shipped = await measure(SEC, BIGARCH);
  const MUT = SEC
    .split('              _tn++; const _y1 = adminScanYield(_tn); if (_y1) await _y1;   // ⚠ 每 200 個元素讓路（v6.242）\n').join('              _tn++;\n')
    .split('              _tn++; const _y2 = adminScanYield(_tn); if (_y2) await _y2;   // ⚠ 每 200 個元素讓路（v6.242）\n').join('              _tn++;\n');
  assert.notStrictEqual(MUT, SEC, '突變【M1】錨點對不上（讓路那兩行寫法改了？）');
  const bare = await measure(MUT, BIGARCH);
  console.log('        出貨碼（cursor＋每 200 元素讓路）：' + shipped.ms.toFixed(0) + ' ms，被擋 max '
    + shipped.max.toFixed(1) + ' ms／p99 ' + shipped.p99.toFixed(1) + ' ms（events=' + shipped.res.body.tournament.events + '）');
  console.log('        突變 M1（拿掉讓路）        ：' + bare.ms.toFixed(0) + ' ms，被擋 max '
    + bare.max.toFixed(1) + ' ms／p99 ' + bare.p99.toFixed(1) + ' ms');
  assert.ok(bare.max > 20, '突變 M1 只量到 ' + bare.max.toFixed(1) + ' ms —— 探針壓根沒量到阻塞，儀器壞了（Rule 33）');
  assert.ok(shipped.max < bare.max / 2, '出貨碼被擋 ' + shipped.max.toFixed(1) + ' ms，沒有比不讓路的 '
    + bare.max.toFixed(1) + ' ms 明顯改善 —— 讓路沒生效');
  assert.ok(shipped.max < 60, '出貨碼仍被擋 max ' + shipped.max.toFixed(1) + ' ms（沙盒上限 60 ⇒ VM 約 6ms）');
  assert.ok(shipped.p99 < 25, '出貨碼 p99 被擋 ' + shipped.p99.toFixed(1) + ' ms（沙盒上限 25 ⇒ VM 約 2.5ms）');
});

console.log('\n══ 【G】舊 client（v6.267）不會壞的證明 ═══════════════════════════════════');

await T('G1 v6.267 client 的錦標賽欄寫死「累積中」＝不讀新欄位；normalize 對新 status 容忍', () => {
  const page = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
  assert.ok(page.includes('<div class="ds-rate ds-pending">累積中</div>'),
    'v6.267 的錦標賽欄不再是寫死的「累積中」—— 那 client 檔案被動過，本版宣稱「玩家端零改動」不成立');
  const dsTs = readFileSync(join(ROOT, 'src/lib/decks/deck-stats.ts'), 'utf8');
  assert.ok(dsTs.includes("status: toStr(t.status, 'not-collected')"),
    'deck-stats.ts 的 normalize 形狀變了');
  // normalize 抽出來實跑：伺服器回新形狀（status:ok＋新欄位）時，舊 client 的產物仍是合法形狀
  const i = dsTs.indexOf('function normalize(');
  const fnTxt = dsTs.slice(i, braceEnd(dsTs, dsTs.indexOf('{', i)))
    .replace(/: Record<string, unknown>/g, '').replace(/: DeckStats/g, '')
    .replace(/ as Record<string, unknown>\[\]/g, '').replace(/ as Record<string, unknown>/g, '');
  const helpers = 'const toInt=(v)=>{const n=Number(v);return Number.isFinite(n)?Math.trunc(n):0;};'
    + 'const toRate=(v)=>{if(v===null||v===undefined)return null;const n=Number(v);return Number.isFinite(n)?n:null;};'
    + "const toStr=(v,f)=>(typeof v==='string'&&v?v:f);";
  const normalize = new Function(helpers + '\n' + fnTxt + '\nreturn normalize;')();
  const newResp = { deckStatsApi: 1, deckId: 'd', casual: { scope: 'online-only', games: 2, wins: 1, losses: 1, draws: 0, winRate: 0.5 },
    vsArchetype: [], tournament: { status: 'ok', games: 3, wins: 2, losses: 1, draws: 0, winRate: 2 / 3, since: 'v6.276', vsArchetype: [], events: 2, scanned: 9, truncated: false, scanCap: 300 },
    since: 'v6.266', scanned: 2, truncated: false, scanCap: 5000 };
  const out = normalize(newResp);
  assert.strictEqual(out.tournament.status, 'ok');
  assert.strictEqual(out.tournament.games, 3);
  assert.strictEqual(out.since, 'v6.266');
  // 查無資料時（status not-collected）舊 client 拿到的六個欄位與 BASE 一模一樣
  const oldShape = normalize({ deckStatsApi: 1, deckId: 'd', casual: {}, vsArchetype: [],
    tournament: { status: 'not-collected', games: 0, wins: 0, losses: 0, draws: 0, winRate: null, since: 'v6.276', vsArchetype: [], events: 0, scanned: 0, truncated: false, scanCap: 300 }, since: 'v6.266' });
  // ⚠⚠ v6.277 起 client 會在 tournament 底下**附加**新欄位（since／vsArchetype／events…），
  //   所以不可以再用「整包 deepStrictEqual」——那等於把斷言 pin 在某一版的 client 形狀上
  //   （Rule E：pin 死版本的斷言不是保護，是路障）。改成**契約式**斷言，而且比原本更嚴：
  //     ① 伺服器契約的六個欄位其值逐一相同；
  //     ② 它們必須仍然排在**最前面**（新欄位只准附加在後 —— 這一條原本沒有在守）。
  const SIX = ['status', 'games', 'wins', 'losses', 'draws', 'winRate'];
  const six = {};
  for (const k of SIX) six[k] = oldShape.tournament[k];
  assert.deepStrictEqual(six, { status: 'not-collected', games: 0, wins: 0, losses: 0, draws: 0, winRate: null },
    '舊 client normalize 後的 tournament 前六個欄位與 BASE 不同：' + JSON.stringify(oldShape.tournament));
  assert.deepStrictEqual(Object.keys(oldShape.tournament).slice(0, 6), SIX,
    'tournament 的前六個 key 不再是伺服器契約的那六個（新欄位一律附加在後）：'
    + Object.keys(oldShape.tournament).join(','));
});

console.log('\n══ 【H】HEAD-FAIL（對真 BASE blob；淺複製時由【B】revert-diff 涵蓋同一件事）══');

await T('H1 對 BASE v6.275：A1~A5 的每一條各自紅', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('test-v6276 【H】HEAD-FAIL（需要 BASE blob）',
      '同一件事由【B】的 revert-diff（內嵌 sha256）涵蓋，那一段不需要歷史');
    return;
  }
  const r = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  assert.ok(r.ok, '拿得到 commit 卻讀不到 blob');
  const b = r.out;
  const reds = [];
  const chk = (n, f) => { let red = false; try { f(); } catch (e) { if (e instanceof assert.AssertionError) red = true; else throw e; } if (red) reds.push(n); };
  chk('A1 tarch sparse 索引', () => assert.ok(/createIndex\(\{ 'players\.deckId': 1 \}, \{ sparse: true \}\)/.test(b), 'x'));
  chk('A2 報名收 deckId', () => assert.strictEqual(b.split('app.locals && app.locals._sanitizeDeckId').length - 1, 3, 'x'));
  chk('A3 歸檔帶 deckId', () => assert.ok(b.includes("...(typeof r.deckId === 'string' && r.deckId"), 'x'));
  chk('A4 錦標賽段', () => assert.ok(b.includes('deckStatsTarchIndexReady'), 'x'));
  chk('A4b tournament: _tourn', () => assert.ok(b.includes('tournament: _tourn,'), 'x'));
  chk('A5 app.locals 掛載', () => assert.ok(b.includes('app.locals._sanitizeDeckId = sanitizeDeckId'), 'x'));
  assert.strictEqual(reds.length, 6, 'BASE 上只有 ' + reds.length + '/6 條紅（' + reds.join('、') + '）');
  console.log('        BASE 上 6/6 條各自紅：' + reds.join('、'));
});

await T('H2 ⭐⭐⭐ BASE 的 /register／歸檔函式跑同一份 fixture ⇒ 與修後（不帶 deckId）deepStrictEqual', async () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('test-v6276 【H2】BASE 行為對照', '由【C】【D】的內嵌 BASE 快照涵蓋'); return;
  }
  const r = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  assert.ok(r.ok, '讀不到 BASE blob');
  const basePat = r.out;
  // /register：BASE 端點沒有 app.locals 依賴，runRegister 的 env 對它同樣成立
  const a = await runRegister(epSrc(basePat, '/api/tournament/register'), OLD_REG_PAYLOAD);
  const c = await runRegister(REG_SRC, OLD_REG_PAYLOAD);
  assert.deepStrictEqual(c.captured[0], a.captured[0], 'BASE vs 修後（舊 payload）TREGS doc 不同');
  assert.strictEqual(JSON.stringify(c.captured[0]), JSON.stringify(a.captured[0]), 'key 順序不同');
  // register-and-checkin
  const a2 = await runRac(epSrc(basePat, '/api/tournament/register-and-checkin'), OLD_REG_PAYLOAD);
  const c2 = await runRac(RAC_SRC, OLD_REG_PAYLOAD);
  assert.strictEqual(JSON.stringify(c2.captured[0]), JSON.stringify(a2.captured[0]), 'rac doc 不同');
  // propose
  const a3 = await runPropose(epSrc(basePat, '/api/tournament/propose'), PROPOSE_PAYLOAD);
  const c3 = await runPropose(PROPOSE_SRC, PROPOSE_PAYLOAD);
  assert.strictEqual(JSON.stringify(c3.capReg[0]), JSON.stringify(a3.capReg[0]), 'propose reg doc 不同');
  assert.strictEqual(JSON.stringify(c3.capEv[0]), JSON.stringify(a3.capEv[0]), 'propose 賽事 doc 不同');
  // 歸檔
  const a4 = await runArchive(fnAsync(basePat, 'recordTournamentArchive'), [REG_B], MATCHES);
  const c4 = await runArchive(ARCH_SRC, [REG_B], MATCHES);
  assert.deepStrictEqual(c4[0], a4[0], 'BASE vs 修後 歸檔 $set doc 不同');
  assert.strictEqual(JSON.stringify(c4[0]), JSON.stringify(a4[0]), '歸檔 doc key 順序不同');
  console.log('        BASE vs 修後：register／register-and-checkin／propose／歸檔 4 條路徑 deepStrictEqual ＋ JSON 逐位元相同');
});

console.log('\n══ 【I】伺服器契約的 client 端退路（不綁版本；原「零改動」快照已退役）═══════');

await T('I1 ⭐ 伺服器 v6.276 契約的 client 端退路仍在（行為端；**不 pin 任何一版的 diff**）', () => {
  // ⚠⚠ 這一條原本是「git ls-tree 逐檔比對：src/ 與 static/ 相對 BASE 只有 version.ts 不同」。
  //   那是**對 v6.276 那一版 diff 的快照**：它宣告的是「本版是純伺服器端」這個**歷史事實**，
  //   一旦有任何後續版本動到玩家端（v6.277 套牌戰績 client 端 P3b 就是）就必然紅，
  //   而它擋下來的並不是任何真正的風險（Rule E：pin 死版本／pin 死 diff 的斷言是路障不是保護）。
  // ⇒ 改成**不綁版本的行為端等價條件**：v6.276 的伺服器契約其實只依賴下面兩件事，
  //   而這兩件事與「client 改了幾個檔」完全無關，可以一路守下去。
  const dsTs = readFileSync(join(ROOT, 'src/lib/decks/deck-stats.ts'), 'utf8');
  const i0 = dsTs.indexOf('function normalize(');
  assert.ok(i0 > 0, '抽不到 deck-stats.ts 的 normalize（掃描器壞了？）');
  const fnTxt = dsTs.slice(i0, braceEnd(dsTs, dsTs.indexOf('{', i0)))
    .replace(/: Record<string, unknown>/g, '').replace(/: DeckStats/g, '')
    .replace(/ as Record<string, unknown>\[\]/g, '').replace(/ as Record<string, unknown>/g, '');
  assert.ok(fnTxt.length > 400, 'normalize 抽太短：' + fnTxt.length);
  const helpers = 'const toInt=(v)=>{const n=Number(v);return Number.isFinite(n)?Math.trunc(n):0;};'
    + 'const toRate=(v)=>{if(v===null||v===undefined)return null;const n=Number(v);return Number.isFinite(n)?n:null;};'
    + "const toStr=(v,f)=>(typeof v==='string'&&v?v:f);";
  const normalize = new Function(helpers + '\n' + fnTxt + '\nreturn normalize;')();
  // ①【舊伺服器 fail-open】伺服器回應**完全沒有 tournament 這個 key** ⇒ 不可以丟例外，
  //   而且必須落回 not-collected（畫面顯示「累積中」），絕不可以變成 0 勝 0 敗的假數字。
  const noTourn = normalize({ deckStatsApi: 1, deckId: 'd', casual: {}, vsArchetype: [], since: 'v6.266' });
  assert.strictEqual(noTourn.tournament.status, 'not-collected',
    '伺服器沒回 tournament 時 client 沒有落回 not-collected（實得 ' + noTourn.tournament.status + '）');
  assert.strictEqual(noTourn.tournament.games, 0);
  assert.strictEqual(noTourn.tournament.winRate, null, 'winRate 被誤轉成 0 ⇒ 畫面會顯示 0.0% 騙玩家');
  // ②【UI 退路】/decks 一定要留著「累積中」這個 fallback（三態的第二、三態都靠它）。
  const page2 = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
  assert.ok(page2.includes('<div class="ds-rate ds-pending">累積中</div>'),
    '/decks 的「累積中」退路不見了 ⇒ 查無資料／舊伺服器時畫面會空掉或顯示假數字');
  // ── 診斷（**不當判準**）：印出玩家端相對 BASE 有哪些檔不同，讓改動仍然看得見。
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('test-v6276 【I1】的 diff 診斷（需要 BASE commit）', '兩條行為端斷言不需要歷史，仍在守');
    return;
  }
  const out = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', BASE_SHA, '--', 'src', 'static'],
    { maxBuffer: 1 << 26 }).toString('utf8');
  const diffs = [];
  let checked = 0;
  for (const line of out.split('\n')) {
    if (!line) continue;
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!m) continue;
    const [, hash, p] = m;
    let bytes;
    try { bytes = readFileSync(join(ROOT, p)); } catch { diffs.push(p + '（檔案不見了）'); continue; }
    const h1 = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (h1 !== hash) {
      const lf = Buffer.from(bytes.toString('latin1').split('\r\n').join('\n'), 'latin1');
      const h2 = createHash('sha1').update('blob ' + lf.length + '\0').update(lf).digest('hex');
      if (h2 !== hash) diffs.push(p);
    }
    checked++;
  }
  assert.ok(checked > 200, '只掃到 ' + checked + ' 個檔（掃描器壞了？）');
  console.log('        [診斷] 掃描 ' + checked + ' 檔，相對 v6.275 的玩家端差異：' + JSON.stringify(diffs));
});

console.log('\n══ 【J】版本／文件 ═══════════════════════════════════════════════════════');

await T('J1 version.ts ≥ 6.276、admin.html SITE_VERSION_HINT 同步且維持 LF；內部 changelog 有本版；首頁沒有', () => {
  const v = /VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'))[1];
  assert.ok(parseFloat(v) >= 6.276, 'VERSION=' + v);
  const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'latin1');
  assert.ok(adm.includes("window.SITE_VERSION_HINT = '" + v + "';"), 'SITE_VERSION_HINT 沒同步');
  assert.ok(!adm.includes('\r\n'), 'admin.html 出現 CRLF');
  const internal = readFileSync(join(ROOT, 'docs/changelog-internal.md'), 'utf8');
  assert.ok(/^## v6\.276 /m.test(internal), 'docs/changelog-internal.md 沒有 v6.276 段落');
  const home = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');
  assert.ok(!/v6\.276/.test(home), '首頁 changelog 竟然有 v6.276 —— 純伺服器端不寫首頁');
});

console.log('\n' + (fail === 0 ? '✅ ' : '❌ ') + 'v6.276 守衛：' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
