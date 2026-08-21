#!/usr/bin/env node
/**
 * v6.184 守衛：玩家端診斷回報不再被**靜默**截斷
 *
 * 事故（2026-08-13 dump）：`/api/tournament/clientdiag` 寫入時做
 *   `JSON.stringify(req.body).slice(0, 2048)`，v6.179 拆出 `perf.res.seg` 之後
 *   993 筆裡有 16 筆剛好卡在 2048 —— 全部集中在 v6.179/180/182。
 *   被切掉的一定是尾端（perf → svelteWarn → env），而切過的字串**不再是合法 JSON**；
 *   `/api/tournament/admin/clientdiag` 對 JSON.parse 失敗的列是「直接略過」
 *   ⇒ 那幾列在 admin 📡 分頁上完全看不到，剛好毀掉尾巴最重那位玩家的全部四段資料。
 *
 * ⚠⚠ 這份守衛**刻意不只驗字串**（v6.154 的教訓：22 條字串守衛全綠，分頁還是打不開）：
 *   ①`_cdiagPack` 從原始碼抽出來**真的執行**，餵超大／正常兩種 payload 比對輸出；
 *   ②整支 `/clientdiag` handler 也抽出來**真的執行**（注入假的 tournIdentity / 節流 Map /
 *     假 collection），斷言到「寫進 DB 的那份 doc」——「有呼叫 _cdiagPack」不等於
 *     「那個旗標真的被寫進去了」；
 *   ③dump 腳本直接 `require` 進來跑 `truncSummary`，斷言它數得出截斷筆數。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAP_PATH = join(ROOT, 'oracle-admin/server_admin_patch.js');
const SRC = readFileSync(SAP_PATH, 'utf8');
const DUMP_PATH = join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs');
const DUMP_SRC = readFileSync(DUMP_PATH, 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ── ⚠ 否定型斷言前一律**先剝註解**（既有紀律）：註解裡寫「v6.184 之前是 2048」
//   會讓「2048 已經消失」這種斷言假紅。剝完再驗，而且剝法自己要先自我驗證。
function stripComments(src) {
  let out = '';
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += c;
      for (k++; k < src.length; k++) { out += src[k]; if (src[k] === '\\') { k++; out += src[k]; continue; } if (src[k] === q) break; }
      continue;
    }
    if (c === '/' && src[k + 1] === '/') { const e = src.indexOf('\n', k); if (e < 0) break; k = e; out += '\n'; continue; }
    if (c === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k); if (e < 0) break; k = e + 1; continue; }
    out += c;
  }
  return out;
}

// ── 小工具：從某個 index 起抓出成對的括號區段（含字串／註解的粗略跳過）────────
function balanced(src, from, open = '{', close = '}') {
  const i = src.indexOf(open, from);
  if (i < 0) return null;
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '\\') { k++; continue; }
    if (c === "'" || c === '"' || c === '`') {   // 跳過字串常值
      const q = c;
      for (k++; k < src.length; k++) { if (src[k] === '\\') { k++; continue; } if (src[k] === q) break; }
      continue;
    }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) break; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { start: i, end: k + 1, text: src.slice(i, k + 1) }; }
  }
  return null;
}

// ══ ① 上限確實是 8192（不是還停在 2048）══════════════════════════════════
let packFn = null;
{
  const i = SRC.indexOf('function _cdiagPack(body)');
  ok('★_cdiagPack 存在（截斷邏輯已收斂成一個可測的函式）', i > 0);
  if (i > 0) {
    const body = balanced(SRC, i);
    const text = SRC.slice(i, body.end);
    const code = stripComments(text);
    ok('★①上限是 8192（不是 2048）', /const LIMIT = 8192;/.test(code), code.slice(0, 200));
    ok('★①程式碼裡不再有 2048（註解可以提，程式不行）', !/2048/.test(code), code);
    // 掃描器自我驗證：剝註解的實作必須「只剝註解、不剝字串」，而且真的剝得掉
    ok('★掃描器自我驗證：stripComments 剝得掉註解',
      stripComments('const a = 1; // 2048\n').indexOf('2048') < 0);
    ok('★掃描器自我驗證：stripComments 不會誤剝字串裡的內容',
      stripComments("const a = '// 2048';").indexOf('2048') >= 0);
    try { packFn = new Function('return (' + text + ')')(); } catch (e) { ok('_cdiagPack 可執行', false, e.message); }
  }
}

// ── 行為端實跑：正常大小 vs 超大 ─────────────────────────────────────────
if (packFn) {
  // ③ 正對照：正常大小的 payload 行為不變 —— 原文照存、不標旗標
  const small = { reason: 'slow-rtt', ver: '6.184', poll: { rtt: { n: 30, p50: 1, p95: 2, max: 3 } } };
  const rs = packFn(small);
  ok('★③正常大小：原文完整存下（一個字元都沒少）', rs.s === JSON.stringify(small));
  ok('★③正常大小：truncated 為 false', rs.truncated === false);
  ok('★③正常大小：rawLen ＝實際長度', rs.rawLen === JSON.stringify(small).length);

  // ② 超大 payload：切到 8192、而且**留下痕跡**
  const big = { reason: 'stale-version', pad: 'x'.repeat(30000) };
  const rawLen = JSON.stringify(big).length;
  const rb = packFn(big);
  ok('★②超大：確實切到 8192 字元', rb.s.length === 8192, 'got ' + rb.s.length);
  ok('★★②超大：留下 truncated: true 的痕跡（不是靜默丟棄）', rb.truncated === true);
  ok('★★②超大：rawLen 記下「原本有多長」（8192 夠不夠用靠它判斷）', rb.rawLen === rawLen, 'got ' + rb.rawLen);

  // 邊界：剛好 8192 不算截斷（off-by-one）
  const padLen = 8192 - JSON.stringify({ p: '' }).length;
  const exact = { p: 'y'.repeat(padLen) };
  const re = packFn(exact);
  ok('★②邊界：剛好 8192 字元不算截斷', JSON.stringify(exact).length === 8192 && re.truncated === false && re.s.length === 8192);

  // 壞輸入不可以炸（診斷絕不影響對戰路徑）
  const cyc = {}; cyc.self = cyc;
  let cycOk = false; try { const rc = packFn(cyc); cycOk = (rc.s === '{}' && rc.truncated === false); } catch { cycOk = false; }
  ok('★循環參照不會 throw（會退回 {}）', cycOk);
  let undOk = false; try { const ru = packFn(undefined); undOk = (ru.s === '{}' && typeof ru.rawLen === 'number'); } catch { undOk = false; }
  ok('★undefined body 不會炸（JSON.stringify 會回 undefined 不是字串）', undOk);

  // ⚠⚠ surrogate pair（Fable 5 審查提出）：slice 切的是 UTF-16 code unit，
  //   emoji 可能被切成兩半 ⇒ 寫進 mongo 的字串會含孤兒 surrogate。
  //   先自行查證前提：JSON.stringify 從 ES2019 起是 well-formed（孤兒會被跳脫成 \udXXX），
  //   所以孤兒**只可能**由這一刀製造，而且只會在最後一個 code unit。
  ok('★前提查證：JSON.stringify 對孤兒 surrogate 會跳脫（well-formed）',
    JSON.stringify({ a: 'x\uD83D' }) === '{"a":"x\\ud83d"}', JSON.stringify(JSON.stringify({ a: 'x\uD83D' })));
  {
    // 逐位移一格地掃，確保**任何**對齊下都不會留下尾端孤兒高位 surrogate。
    let worst = null;
    for (let pad = 0; pad < 4 && worst === null; pad++) {
      const o = { p: 'a'.repeat(pad) + '\u{1F600}'.repeat(6000) };
      const r = packFn(o);
      const lastCu = r.s.charCodeAt(r.s.length - 1);
      if (lastCu >= 0xD800 && lastCu <= 0xDBFF) worst = pad;
      // 切完仍必須是「合法的 UTF-16」⇒ 轉 Buffer 再轉回來不可以出現 U+FFFD 替換字元
      if (Buffer.from(r.s, 'utf8').toString('utf8').indexOf('\uFFFD') >= 0 && o.p.indexOf('\uFFFD') < 0) worst = pad;
      if (r.truncated !== true) worst = pad;
    }
    ok('★★②surrogate pair 不會被切一半（任何對齊下尾端都不是孤兒高位 surrogate）', worst === null, 'pad=' + worst);
    const rr = packFn({ p: '\u{1F600}'.repeat(6000) });
    ok('★②surrogate 退一格後長度是 8191 或 8192（不會超出上限）', rr.s.length === 8192 || rr.s.length === 8191, String(rr.s.length));
  }

  // 掃描器自我驗證：把上限改回 2048 的樣本必須被 ①②抓到
  const stale = new Function('return (' + 'function _cdiagPack(body){ let raw="{}"; try{raw=JSON.stringify(body||{});}catch(e){} const LIMIT=2048; return raw.length<=LIMIT?{s:raw,truncated:false,rawLen:raw.length}:{s:raw.slice(0,LIMIT),truncated:true,rawLen:raw.length}; }' + ')')();
  ok('★掃描器自我驗證：停在 2048 的版本會被判不合格', stale(big).s.length === 2048 && stale(big).s.length !== 8192);
}

// ══ ② 接線：handler 真的把痕跡寫進 DB doc ════════════════════════════════
// ⚠ 這一段是本檔的重點。「insertOne 那行有 truncated 這個字」證明不了任何事 ——
//   下面把整個 handler 抽出來**實跑**，斷言到假 collection 收到的那份 doc。
{
  const i = SRC.indexOf("app.post('/api/tournament/clientdiag'");
  ok('/clientdiag 端點存在', i > 0);
  const arrowAt = SRC.indexOf('async (req, res) =>', i);
  const body = arrowAt > 0 ? balanced(SRC, arrowAt) : null;
  ok('抽得出 handler 主體', !!body);
  if (body) {
    const handlerSrc = 'async (req, res) => ' + body.text;
    // ★① 直接對 handler 原文斷言：舊的 inline `slice(0, 2048)` 必須整個消失。
    ok('★①handler 內不再有寫死的 slice(0, 2048)', !/slice\(0,\s*2048\)/.test(body.text));
    ok('★①handler 走 _cdiagPack（截斷邏輯只有一份）', /_cdiagPack\(req\.body\)/.test(body.text));
    // ⚠ 這裡**刻意**在 _cdiagPack 不存在時也照跑：注入一個「絕不標旗標」的替身。
    //   舊版 handler 根本不呼叫它（自己做 inline slice）⇒ 下面 ②的斷言會直接 FAIL，
    //   而不是因為 packFn 是 null 就整段被跳過（跳過＝假綠，那正是 v6.154 的教訓）。
    const packForHandler = packFn || function (b) {
      let r = '{}'; try { r = JSON.stringify(b || {}); } catch (e) { /* */ }
      if (typeof r !== 'string') r = '{}';
      return { s: r, truncated: false, rawLen: r.length };
    };
    let inserted = null;
    const TCDIAG = { insertOne: async (doc) => { inserted = doc; return { acknowledged: true }; } };
    const tournIdentity = async () => ({ uid: 'u1', email: 'a@b.c', verified: true });
    const handler = new Function('tournIdentity', '_cdiagThrottle', 'TCDIAG', '_cdiagPack',
      'return (' + handlerSrc + ');')(tournIdentity, new Map(), TCDIAG, packForHandler);
    const mkRes = () => { const o = { body: null }; o.json = (b) => { o.body = b; return o; }; o.status = () => o; return o; };

    // (a) 正常大小 ⇒ 原文照存、truncated 為 false
    const smallBody = { reason: 'r-small', room: 'R1', ver: '6.184', state: { a: 1 } };
    await handler({ body: smallBody }, mkRes());
    ok('★★②接線：正常大小有寫進 DB', !!inserted && inserted.reason === 'r-small');
    ok('★★③接線：正常大小 diag 是完整原文', !!inserted && inserted.diag === JSON.stringify(smallBody));
    ok('★★②接線：正常大小 truncated 欄位為 false（一律寫入，不是只有被切才寫）',
      !!inserted && inserted.truncated === false, JSON.stringify(inserted && inserted.truncated));
    ok('★★②接線：rawLen 一律寫入', !!inserted && inserted.rawLen === JSON.stringify(smallBody).length);

    // (b) 超大 ⇒ 切到 8192 且旗標為 true
    inserted = null;
    const hugeBody = { reason: 'r-huge', room: 'R2', pad: 'z'.repeat(40000) };
    const hugeRaw = JSON.stringify(hugeBody).length;
    await handler({ body: hugeBody }, mkRes());
    ok('★★②接線：超大 payload 有寫進 DB（不是被丟掉）', !!inserted && inserted.reason === 'r-huge');
    ok('★★★②接線：DB doc 上留下 truncated: true —— 這就是「不再靜默失敗」', !!inserted && inserted.truncated === true);
    ok('★★★②接線：DB doc 上留下 rawLen（原本多長）', !!inserted && inserted.rawLen === hugeRaw, String(inserted && inserted.rawLen));
    ok('★★②接線：diag 確實被切到 8192', !!inserted && inserted.diag.length === 8192);
    ok('★②接線：room / reason 仍照舊存（既有欄位沒被動到）',
      !!inserted && inserted.room === 'R2' && inserted.uid === 'u1' && inserted.email === 'a@b.c');

    // (c) 節流仍然有效（同一個 uid|reason 60 秒內第二發不寫）
    const th = new Map();
    let n = 0;
    const TC2 = { insertOne: async () => { n++; } };
    const h2 = new Function('tournIdentity', '_cdiagThrottle', 'TCDIAG', '_cdiagPack',
      'return (' + handlerSrc + ');')(tournIdentity, th, TC2, packForHandler);
    await h2({ body: { reason: 'dup' } }, mkRes());
    await h2({ body: { reason: 'dup' } }, mkRes());
    await h2({ body: { reason: 'other' } }, mkRes());
    ok('★③既有的 per-(uid,reason) 60 秒節流沒有被這一版改壞', n === 2, 'writes=' + n);
  }
}

// ══ ②-b 讀出端：/admin/clientdiag 與 admin.html 也要看得見痕跡 ═══════════
//   ⚠ Fable 5 審查抓到的殘餘缺口：就算寫入端留了痕跡，讀出端沒帶出來的話，
//     未來真的有 >8KB 的 payload 時，它在 📡 分頁上仍然是「一串壞掉的 JSON」而沒有任何標示。
{
  const i = SRC.indexOf("app.get('/api/tournament/admin/clientdiag'");
  // ⚠⚠ v6.213：原本是 `SRC.slice(i, i + 4200)` 的**魔術數字切窗**。這支端點中間插進了
  //   「取樣 vs 異常」的分帳，4200 字元已經切不到 `rows: rows.map` ⇒ 會變成假紅。
  //   ⇒ 但**不改成更大的魔術數字**（那只是把假綠往後延：切窗一旦超過端點尾巴，
  //     下一支端點的內容會被誤算成這一支的）。改成**大括號配對**取這支端點的本體，
  //     切窗從此自動跟著程式碼長度走。
  const seg = i > 0 ? (function () {
    const open = SRC.indexOf('{', i);
    let d = 0;
    for (let k = open; k < SRC.length; k++) {
      if (SRC[k] === '{') d++;
      else if (SRC[k] === '}') { d--; if (d === 0) return SRC.slice(i, k + 1); }
    }
    return '';
  })() : '';
  ok('[自我驗證] 端點本體切得出來，而且沒有多切到下一支端點',
    seg.length > 3000 && seg.length < 12000 && !seg.includes("app.get('/api/tournament/admin/longpoll")
    && !/const TEVENTS = db\.collection/.test(seg), 'len=' + seg.length);
  ok('★★②讀出端 rows 帶出 truncated（且正規化成布林，不是 undefined）',
    /truncated: r\.truncated === true/.test(seg));
  ok('★★②讀出端 rows 帶出 rawLen（缺席時回 null 不是 undefined）',
    /rawLen: \(typeof r\.rawLen === 'number' && isFinite\(r\.rawLen\)\) \? r\.rawLen : null/.test(seg));
  // 行為端：把 rows.map 的回呼抽出來實跑，斷言舊列（無欄位）不會被誤標
  const mapAt = seg.indexOf('rows: rows.map(function (r) {');
  const fnSrc = mapAt >= 0 ? balanced(seg, seg.indexOf('{', mapAt + 'rows: rows.map(function (r) '.length - 1)) : null;
  if (fnSrc) {
    const mapper = new Function('return (function (r) ' + fnSrc.text + ');')();
    const oldRow = mapper({ ts: 1, email: null, room: '', reason: 'x', diag: '{"a"' });
    ok('★★②舊列（沒有欄位）一律回 truncated:false / rawLen:null，不會被誤標也不會是 undefined',
      oldRow.truncated === false && oldRow.rawLen === null);
    const newRow = mapper({ ts: 1, email: null, room: '', reason: 'x', diag: 'y', truncated: true, rawLen: 9999 });
    ok('★★②新列的旗標會原樣帶到畫面', newRow.truncated === true && newRow.rawLen === 9999);
  } else { ok('抽得出 rows.map 回呼', false); }
  ok('★②admin 明細列會標出「⚠ 已截斷」', ADMIN.includes("r.truncated ? '　<span style=\"color:#c62828;font-weight:700;\">⚠ 已截斷'"));
  // ⚠v6.185 這條原本寫死 '6.184'，下一次 bump 就必紅。改成比照 v6.160／v6.180 既有作法：
  //   admin 的提示必須**與 src/lib/version.ts 的 VERSION 一致**（這才是它真正要防的事 ——
  //   出新版時忘了同步改 admin.html，站長端的版本紅字警告就會誤發）。
  ok('★②admin 版本提示與 src/lib/version.ts 一致（出新版時兩邊都要改）', (() => {
    const a = (ADMIN.match(/window\.SITE_VERSION_HINT = '([\d.]+)';/) || [])[1];
    const v = (readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8').match(/VERSION = '([\d.]+)'/) || [])[1];
    return !!a && !!v && a === v;
  })());
}

// ══ ④ dump 腳本能正確報出截斷筆數與旗標 ═══════════════════════════════════
{
  const req = createRequire(import.meta.url);
  let mod = null;
  try { mod = req(DUMP_PATH); } catch (e) { ok('dump 腳本可被 require（不需要 mongodb 模組）', false, e.message); }
  ok('★dump 腳本可被 require（loadMongo 已延後到 main）', !!mod);
  if (mod) {
    ok('★④DIAG_CAP 與伺服器同步為 8192', mod.DIAG_CAP === 8192, String(mod.DIAG_CAP));
    // 四種列：新列被切／新列沒被切／舊列被切（只能推論）／舊列正常
    const rows = [
      { truncated: true, rawLen: 12345, diag: '{"ver":"6.184","perf":{"api"' },   // 新列被切
      { truncated: false, rawLen: 42, diag: '{"ver":"6.184"}' },                   // 新列正常
      { diag: '{"ver":"6.180","perf":{"api"' },                                    // 舊列被切（無旗標）
      { diag: '{"ver":"6.180"}' },                                                 // 舊列正常
    ];
    const sum = mod.truncSummary(rows);
    ok('★★④截斷總數＝2（新列 1 + 舊列 1）', sum.total === 2, JSON.stringify(sum));
    ok('★★④伺服器明確標記的筆數＝1', sum.srv === 1, JSON.stringify(sum));
    ok('★★④只能推論的舊列筆數＝1（欄位缺席不可以被當成「沒被切」）', sum.legacy === 1, JSON.stringify(sum));
    ok('★④maxRawLen 抓得到「截斷前有多長」', sum.maxRawLen === 12345, JSON.stringify(sum));
    // ⚠ Fable 5 抓到的語義陷阱：舊列卡的是 2048，永遠不會 >= 8192。
    //   兩個上限必須各數一欄，否則「舊列 N 筆」與「卡在上限 0 筆」會自相矛盾。
    const capRows = [
      { diag: 'q'.repeat(mod.LEGACY_DIAG_CAP) },   // 舊列頂到 2048
      { diag: 'q'.repeat(mod.DIAG_CAP), truncated: true, rawLen: 30000 },   // 新列頂到 8192
      { diag: '{"ver":"6.184"}' },
    ];
    const cs = mod.truncSummary(capRows);
    ok('★★④「頂到目前上限 8192」只數新列（＝1）', cs.capped === 1, JSON.stringify(cs));
    ok('★★④「卡在舊上限 2048」單獨一欄（＝1，不會被誤報成 0）', cs.legacyCapped === 1, JSON.stringify(cs));
    ok('★④LEGACY_DIAG_CAP 是 2048', mod.LEGACY_DIAG_CAP === 2048);
    // classifyTrunc 逐列語義
    const c0 = mod.classifyTrunc(rows[0], mod.parseDiag(rows[0].diag));
    ok('★④classifyTrunc：新列被切 ⇒ srvFlag true / legacy false', c0.srvFlag === true && c0.legacy === false && c0.truncated === true);
    const c2 = mod.classifyTrunc(rows[2], mod.parseDiag(rows[2].diag));
    ok('★④classifyTrunc：舊列被切 ⇒ srvFlag false / legacy true', c2.srvFlag === false && c2.legacy === true && c2.truncated === true);
    const c3 = mod.classifyTrunc(rows[3], mod.parseDiag(rows[3].diag));
    ok('★④classifyTrunc：正常列一律 false', c3.truncated === false && c3.legacy === false);
    // 既有的「用文字比對盡量救回」必須還能用（截斷列仍抽得到 ver / rtt）
    const cut = '{"reason":"slow-rtt","room":"R","ts":1,"ver":"6.180","state":{},"poll":{"rtt":{"n":30,"p50":100,"p95":3000,"max":9000}},"perf":{"api":{"ne';
    const d = mod.parseDiag(cut);
    ok('★④救回邏輯仍相容：截斷列抽得到 ver', d.truncated === true && d.ver === '6.180');
    ok('★④救回邏輯仍相容：截斷列抽得到 poll.rtt', !!d.rtt && d.rtt.p95 === 3000);
    // 掃描器自我驗證：如果 truncSummary 只認 parse 失敗（＝沒接伺服器旗標），srv 會是 0
    const naive = (rr) => rr.filter((r) => { try { JSON.parse(r.diag); return false; } catch { return true; } }).length;
    ok('★掃描器自我驗證：只靠 parse 失敗的舊做法數不出「伺服器旗標」', naive(rows) === 2 && sum.srv === 1);
  }
  // 報表要真的把新數字印出來（不是只算不印）
  ok('★④摘要 ⑥ 有印出伺服器旗標筆數', DUMP_SRC.includes("'    ・伺服器明確標記被切：' + trunc.srv"));
  ok('★④摘要 ⑥ 兩個上限分開印（不會出現「舊列 16 筆但卡在上限 0 筆」的矛盾）',
    DUMP_SRC.includes('長度已頂到目前上限') && DUMP_SRC.includes('長度卡在舊上限'));
  ok('★④摘要 ⑥ 有印出「截斷前最長一筆 / 上限用掉幾 %」', DUMP_SRC.includes('用掉 ') && DUMP_SRC.includes('trunc.maxRawLen * 100 / DIAG_CAP'));
  ok('★④JSON totals 帶出三個新欄位', /truncatedFlaggedByServer: trunc\.srv/.test(DUMP_SRC)
    && /truncatedLegacyGuess: trunc\.legacy/.test(DUMP_SRC) && /diagCap: DIAG_CAP/.test(DUMP_SRC));
  ok('★dump 直接執行的行為不變（require.main 分支）', /if \(require\.main === module\) \{/.test(DUMP_SRC) && /main\(\)\.catch\(/.test(DUMP_SRC));
}

console.log('\nv6.184 clientdiag cap: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
