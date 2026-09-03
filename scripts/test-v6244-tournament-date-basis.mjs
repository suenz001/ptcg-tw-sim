// v6.244 守衛 —— 賽事日期的時間基準：**開賽時間** 取代「冠軍產生時間」
//
// 站長 2026-08-27 回報：網站賽-95【21:00 瑞士制】在台灣時間 8/26 21:00 開打，
// 胡說樹-史小寶奪冠卻顯示成 2026/08/27 —— 因為名人堂拿「冠軍誕生那一刻」當賽事日期，
// 而決賽經常打過台灣的午夜。
//
// ⚠⚠ 本檔的每一條都斷言到**輸出字串／實際查詢行為**，不是「原始碼裡有沒有出現某個字」：
//   ① 把出貨端**真正那一行顯示運算式**用 regex 抽出來，接上真的 helper **求值**，
//      比對輸出字串（BASE 上會得到 2026/8/27 ⇒ 紅）。
//   ② 伺服器端把 `/api/tournament/champions` 的 handler 抽出來**真的跑**，
//      用假的 mongo collection 當儀器（順便量它發了幾發查詢）。
//   ③ 時區突變：整包 fixture 在 TZ=UTC 與 TZ=America/Los_Angeles 的**子行程**各跑一次，
//      輸出必須一模一樣（會變就代表還在吃執行環境時區）。
//   ④ 突變測試：把中央 helper 改回吃 finishedAt ⇒ ①②③ 必須翻紅。
//   ⑤ 正對照：另一組「沒有跨午夜」的賽事，修前修後都必須是 8/26
//      —— 證明不是把全站日期整批往前推一天。
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const EVDATE_SRC = rd('src/lib/tournament/event-date.ts');
const GAME = rd('src/routes/game/+page.svelte');
const ADMIN = rd('oracle-admin/admin.html');
const PAT = rd('oracle-admin/server_admin_patch.js');
const INTERNAL = rd('docs/changelog-internal.md');
const CHANGELOG = rd('static/changelog.html');

// ══ fixture：站長回報的那一場 ═══════════════════════════════════════════════
//   開賽    2026-08-26 21:00 台灣時間 = 2026-08-26 13:00 UTC
//   冠軍產生 2026-08-27 00:30 台灣時間 = 2026-08-26 16:30 UTC
const START_TW = Date.UTC(2026, 7, 26, 13, 0, 0);
const FINISH_TW = Date.UTC(2026, 7, 26, 16, 30, 0);
const CASE_CROSS = { eventId: 'ev95', eventName: '網站賽-95【21:00 瑞士制】',
                     championName: '胡說樹-史小寶', playerCount: 12,
                     startedAt: START_TW, finishedAt: FINISH_TW };
// 正對照：14:00 開打、16:00 結束，完全沒有跨午夜 ⇒ 兩邊都該是 8/26
const NOON_START = Date.UTC(2026, 7, 26, 6, 0, 0);   // 8/26 14:00 TW
const NOON_FINISH = Date.UTC(2026, 7, 26, 8, 0, 0);  // 8/26 16:00 TW
const CASE_SAME_DAY = { eventId: 'evX', eventName: '網站賽-94【14:00】', championName: 'A',
                        playerCount: 8, startedAt: NOON_START, finishedAt: NOON_FINISH };

// ══ 把 event-date.ts 剝型別後真的載進來 ════════════════════════════════════
const TMP = mkdtempSync(join(tmpdir(), 'v6244-'));
function loadHelper(src) {
  const f = join(TMP, 'ed-' + Math.random().toString(36).slice(2) + '.mjs');
  writeFileSync(f, transformSync(src, { loader: 'ts' }).code, 'utf8');
  return import(pathToFileURL(f).href);
}
const ED = await loadHelper(EVDATE_SRC);

// ══ 抽取器（Rule 25：抽不到就大聲失敗，不可以靜默通過）════════════════════
function braceEnd(s, i) { let d = 0; for (let k = i; k < s.length; k++) { const c = s[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return k + 1; } } return s.length; }

/** 從 +page.svelte 的名人堂那一列抽出「日期」那段模板運算式。 */
function extractHofDateExpr() {
  const rows = [...GAME.matchAll(/\{#if c\.playerCount\} ｜ \{c\.playerCount\} 人\{\/if\}\{#if ([^}]+)\} ｜ \{([^}]+)\}\{\/if\}/g)];
  assert.ok(rows.length === 2, '名人堂日期模板應抽到 2 列（官方＋社群），實際 ' + rows.length + ' —— 抽取器壞了？');
  assert.strictEqual(rows[0][2], rows[1][2], '官方與社群兩列的日期寫法必須一致（漂移就是下一個 bug）');
  return { cond: rows[0][1], expr: rows[0][2] };
}
/** 從 admin.html 名人堂管理抽出 dateStr 的運算式。 */
function extractAdminHofExpr() {
  const m = ADMIN.match(/var dateStr = ([^\n]+?);\n/);
  assert.ok(m, 'admin.html 抽不到名人堂的 dateStr —— 抽取器壞了？');
  return m[1];
}
/** 從 admin.html 奪冠報告圖抽出 datePre 的運算式（單頁版與完整版各一）。 */
function extractReportDateExprs() {
  const ms = [...ADMIN.matchAll(/const datePre = ([^\n]+?) \+ '　';/g)].map((m) => m[1]);
  assert.ok(ms.length === 2, '報告圖日期應抽到 2 處（單頁版＋完整版），實際 ' + ms.length);
  return ms;
}
/** 抽出 server_admin_patch.js 裡某個 app.get 端點的 handler 原始碼。 */
function extractHandler(anchor) {
  const i = PAT.indexOf(anchor);
  assert.ok(i >= 0, '找不到端點錨點：' + anchor);
  const a = PAT.indexOf('async (req, res) => {', i);
  assert.ok(a > i && a - i < 200, '端點錨點後找不到 handler');
  const txt = PAT.slice(a, braceEnd(PAT, PAT.indexOf('{', a)));
  assert.ok(txt.length > 500, 'handler 抽太短（抽取器壞了？）：' + txt.length);
  return txt;
}
function extractAggregateArchives(src) {
  const i = src.indexOf('function _aggregateArchives(archives) {');
  assert.ok(i >= 0, '找不到 _aggregateArchives');
  const txt = src.slice(i, braceEnd(src, src.indexOf('{', i)));
  assert.ok(txt.length > 2000, '_aggregateArchives 抽太短：' + txt.length);
  return txt;
}

// ══ 求值器：把抽出來的「一行運算式」接上真 helper 跑 ═══════════════════════
function evalSvelteExpr(expr, c, helper) {
  // eslint-disable-next-line no-new-func
  return Function('c', 'tournamentDateTW', 'tournamentStartMs', 'formatDateTW', 'return (' + expr + ');')(
    c, helper.tournamentDateTW, helper.tournamentStartMs, helper.formatDateTW);
}
function evalAdminExpr(expr, c) {
  const helpers = ADMIN.slice(ADMIN.indexOf('function twOffsetMs()'), ADMIN.indexOf('function _tsFmtDate(ms) {'));
  assert.ok(helpers.includes('function tournDateTW'), 'admin.html 的中央日期 helper 抽不到');
  const miDateSrc = ADMIN.match(/function miDate\(ms\) \{[^\n]*\}/);
  assert.ok(miDateSrc, 'admin.html 抽不到 miDate');
  // eslint-disable-next-line no-new-func
  return Function('c', helpers + '\n' + miDateSrc[0] + '\nreturn (' + expr + ');')(c);
}

// ══ ① 玩家端名人堂：HEAD-FAIL ══════════════════════════════════════════════
await T('① 名人堂（玩家端）：8/26 21:00 開打、8/27 00:30 產生冠軍 ⇒ 必須顯示 2026/08/26', () => {
  const { cond, expr } = extractHofDateExpr();
  const out = evalSvelteExpr(expr, CASE_CROSS, ED);
  assert.strictEqual(out, '2026/08/26',
    '實際顯示「' + out + '」—— 這就是站長回報的 bug（BASE 上會是 2026/8/27）');
  assert.strictEqual(evalSvelteExpr(cond, CASE_CROSS, ED) ? true : false, true, '有日期時必須顯示');
  // 舊資料（只有 finishedAt、沒有 startedAt）不可以變空白 —— fail-open
  const legacy = { finishedAt: FINISH_TW };
  assert.strictEqual(evalSvelteExpr(expr, legacy, ED), '2026/08/27',
    '只有 finishedAt 的舊紀錄應退回冠軍產生時間（fail-open），不可以變空白');
});

await T('② 正對照：8/26 14:00 開打、16:00 結束（沒跨午夜）⇒ 修前修後都必須是 8/26', () => {
  // ⚠ 這一條刻意**只比年月日、不比零填充**：BASE 的輸出是 '2026/8/26'、本版是 '2026/08/26'，
  //   兩者是同一天。要證明的是「沒有把日期整批往前推一天」，不是格式有沒有變。
  const ymd = (s) => String(s).split('/').map((x) => Number(x)).join('-');
  const { expr } = extractHofDateExpr();
  assert.strictEqual(ymd(evalSvelteExpr(expr, CASE_SAME_DAY, ED)), '2026-8-26',
    '沒跨午夜的賽事日期被改動了 —— 代表這一版把日期整批往前推了一天');
  // 反面：這一組拿 finishedAt 去算**也**是 8/26 ⇒ 它抓不到 bug，所以 ① 才是真正的 HEAD-FAIL
  assert.strictEqual(ymd(ED.formatDateTW(NOON_FINISH)), '2026-8-26');
});

// ══ ③ admin 名人堂管理 ═════════════════════════════════════════════════════
await T('③ admin 名人堂管理列：同一組 fixture 也必須顯示 2026/08/26', () => {
  const out = evalAdminExpr(extractAdminHofExpr(), CASE_CROSS);
  assert.strictEqual(out, '2026/08/26', '實際「' + out + '」');
  assert.strictEqual(evalAdminExpr(extractAdminHofExpr(), { finishedAt: FINISH_TW }), '2026/08/27',
    '舊紀錄 fail-open');
  assert.strictEqual(evalAdminExpr(extractAdminHofExpr(), {}), '', '沒有任何時間欄位要回空字串');
});

// ══ ④ 奪冠報告圖（版面不可回退，只換日期來源）═══════════════════════════════
await T('④ 奪冠報告圖（單頁版＋完整版）：日期印 8/26 而不是 8/27', () => {
  const row = { startedAt: START_TW, finishedAt: FINISH_TW };
  for (const expr of extractReportDateExprs()) {
    const out = evalAdminExpr(expr, row);
    assert.strictEqual(out, '8/26', '報告圖印出「' + out + '」');
  }
  // v6.110/111 的長名截斷修正不可回退（版面計算仍以 datePre 的實際寬度扣掉）
  assert.ok(ADMIN.includes("ctx.measureText(datePre).width"),
    '報告圖的賽事名可用寬必須仍然扣掉日期實際寬度（v6.110/111 長名截斷修正）');
  assert.strictEqual((ADMIN.match(/ctx\.measureText\(datePre\)\.width/g) || []).length, 2,
    '單頁版與完整版都要保留寬度計算');
});

// ══ ⑤ 伺服器：champions 端點真的跑一次 ═════════════════════════════════════
function makeChampionsHandler() {
  const src = extractHandler("app.get('/api/tournament/champions'");
  // eslint-disable-next-line no-new-func
  return Function('TCHAMPS', 'TARCHIVE', 'return (' + src + ');');
}
function fakeCursor(docs) {
  return { sort() { return this; }, limit() { return this; }, async toArray() { return docs; } };
}
await T('⑤ /api/tournament/champions：舊紀錄（無 startedAt）由歸檔補上開賽時間', async () => {
  const champDoc = { _id: 'champ_ev95', eventId: 'ev95', eventName: '網站賽-95【21:00 瑞士制】',
                     championName: '胡說樹-史小寶', deckName: '胡說樹', playerCount: 12,
                     finishedAt: FINISH_TW };   // ⚠ 故意沒有 startedAt＝874 筆既有資料的樣子
  let arcQueries = 0, lastQuery = null, lastProjection = null;
  const TCHAMPS = { find(q) { return fakeCursor(q && q.communityEvent && q.communityEvent.$ne === true ? [champDoc] : []); } };
  const TARCHIVE = { find(q, opt) { arcQueries++; lastQuery = q; lastProjection = opt && opt.projection;
    return fakeCursor([{ _id: 'arch_ev95', eventId: 'ev95', startedAt: START_TW, createdAt: START_TW - 86400000 }]); } };
  let out = null;
  const res = { json(b) { out = b; return b; }, status() { return this; } };
  await makeChampionsHandler()(TCHAMPS, TARCHIVE)({ query: {} }, res);
  assert.ok(out && out.champions && out.champions.length === 1, '端點沒有回冠軍：' + JSON.stringify(out));
  const c = out.champions[0];
  assert.strictEqual(c.startedAt, START_TW, '回應缺少（或補錯）開賽時間');
  assert.strictEqual(c.finishedAt, FINISH_TW, 'finishedAt 不可以被拿掉或改掉');
  assert.strictEqual(ED.tournamentDateTW(c), '2026/08/26', '端到端：玩家最後看到的日期');
  assert.strictEqual(arcQueries, 1, '補欄應該只發一發查詢，實際 ' + arcQueries);
  assert.ok(lastQuery && lastQuery._id && Array.isArray(lastQuery._id.$in) && lastQuery._id.$in[0] === 'arch_ev95',
    '補欄查詢必須走 _id 的 $in（吃主鍵索引），實際 ' + JSON.stringify(lastQuery));
  assert.ok(lastProjection && !('players' in lastProjection) && !('matches' in lastProjection),
    'projection 不可以把 players／matches 這兩個大欄位讀回來：' + JSON.stringify(lastProjection));
});
await T('⑥ 效能：所有紀錄都已有 startedAt 時，完全不發那一發補欄查詢', async () => {
  const champDoc = { _id: 'champ_ev96', eventId: 'ev96', eventName: 'E', championName: 'B',
                     playerCount: 8, startedAt: START_TW, finishedAt: FINISH_TW };
  let arcQueries = 0;
  const TCHAMPS = { find(q) { return fakeCursor(q && q.communityEvent && q.communityEvent.$ne === true ? [champDoc] : []); } };
  const TARCHIVE = { find() { arcQueries++; return fakeCursor([]); } };
  let out = null;
  await makeChampionsHandler()(TCHAMPS, TARCHIVE)({ query: {} }, { json(b) { out = b; }, status() { return this; } });
  assert.strictEqual(arcQueries, 0, '不該再發補欄查詢，實際發了 ' + arcQueries + ' 發');
  assert.strictEqual(out.champions[0].startedAt, START_TW);
});

// ══ ⑦ 伺服器：個人參賽紀錄的 date ═════════════════════════════════════════
await T('⑦ _aggregateArchives：個人參賽紀錄的 date ＝ 開賽時間', () => {
  const src = extractAggregateArchives(PAT);
  // eslint-disable-next-line no-new-func
  const fn = Function('_detectCutPlacements', src + '\nreturn _aggregateArchives;')(
    () => ({ finals: new Set(), top4: new Set(), top8: new Set() }));
  const archive = {
    eventId: 'ev95', eventName: '網站賽-95【21:00 瑞士制】', communityEvent: false,
    startedAt: START_TW, createdAt: START_TW - 3600000, finishedAt: FINISH_TW,
    players: [{ uid: 'u1', email: 'a@b.c', name: '史小寶' }, { uid: 'u2', email: 'd@e.f', name: '對手' }],
    matches: [{ round: 1, idx: 0, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1', status: 'done' }],
    championUid: 'u1',
  };
  const s = fn([archive]).get('a@b.c');
  assert.ok(s && s.events.length === 1, '聚合不出參賽紀錄');
  assert.strictEqual(ED.formatDateTW(s.events[0].date), '2026/08/26',
    '個人參賽紀錄顯示「' + ED.formatDateTW(s.events[0].date) + '」');
  // ⚠ 排行榜的近期性 tie-break 必須仍然是「冠軍產生時間」，不可以被一起改掉
  assert.strictEqual(s.champOfficialAt, FINISH_TW, 'champOfficialAt 是榜單 tie-break，不該改成開賽時間');
  assert.strictEqual(s.winsAt, FINISH_TW, 'winsAt 是榜單 tie-break，不該改成開賽時間');
  assert.strictEqual(s.lastFinishedAt, FINISH_TW, 'lastFinishedAt 是榜單 tie-break，不該改成開賽時間');
});

// ══ ⑧ 時區突變測試 ════════════════════════════════════════════════════════
await T('⑧ 時區突變：TZ=UTC 與 TZ=America/Los_Angeles 的輸出必須完全相同', () => {
  const modFile = join(TMP, 'ed-tz.mjs');
  writeFileSync(modFile, transformSync(EVDATE_SRC, { loader: 'ts' }).code, 'utf8');
  const script = "import('" + pathToFileURL(modFile).href + "').then((m)=>{"
    + 'process.stdout.write(JSON.stringify(['
    + 'm.tournamentDateTW(' + JSON.stringify(CASE_CROSS) + '),'
    + 'm.tournamentDateTW(' + JSON.stringify(CASE_SAME_DAY) + '),'
    + 'm.formatDateTW(' + FINISH_TW + '),'
    + 'm.formatShortDateTW(' + START_TW + ')]));});';
  const run = (tz) => execFileSync(process.execPath, ['-e', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  const zones = ['UTC', 'America/Los_Angeles', 'Asia/Taipei', 'Pacific/Kiritimati'];
  const outs = zones.map(run);
  const expect = JSON.stringify(['2026/08/26', '2026/08/26', '2026/08/27', '8/26']);
  outs.forEach((o, i) => assert.strictEqual(o, expect, 'TZ=' + zones[i] + ' 的輸出是 ' + o + ' ⇒ 還在吃執行環境時區'));
  // 正對照：確認子行程的 TZ 真的有生效（否則這條是安慰劑）
  const probe = (tz) => execFileSync(process.execPath,
    ['-e', 'process.stdout.write(String(new Date(' + FINISH_TW + ').getDate()))'],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.notStrictEqual(probe('UTC'), probe('Pacific/Kiritimati'),
    '正對照失效：子行程的 TZ 根本沒生效，⑧ 等於沒測');
});

// ══ ⑨ 突變測試：把中央 helper 改回吃 finishedAt ⇒ 必須翻紅 ═══════════════
await T('⑨ 突變：中央 helper 改回「冠軍產生時間」⇒ ①③⑤⑦ 的斷言必須翻紅', async () => {
  const mutated = EVDATE_SRC.replace(
    'return Number(rec.startedAt) || Number(rec.createdAt) || Number(rec.finishedAt) || 0;',
    'return Number(rec.finishedAt) || 0;');
  assert.notStrictEqual(mutated, EVDATE_SRC, '突變沒套用（原始碼變了？）');
  const M = await loadHelper(mutated);
  assert.strictEqual(M.tournamentDateTW(CASE_CROSS), '2026/08/27', '突變體應該回到錯誤行為');
  let caught = false;
  try {
    const { expr } = extractHofDateExpr();
    assert.strictEqual(evalSvelteExpr(expr, CASE_CROSS, M), '2026/08/26');
  } catch { caught = true; }
  assert.ok(caught, '突變後 ① 沒有翻紅 ⇒ 這條守衛是安慰劑');
  // 正對照：沒跨午夜那一組即使突變也仍然是 8/26（所以只靠②抓不到 bug）
  assert.strictEqual(M.tournamentDateTW(CASE_SAME_DAY), '2026/08/26');
});

// ══ ⑩ 全站沒有殘留「拿冠軍產生時間當賽事日期」的顯示點 ══════════════════
await T('⑩ 枚舉：顯示端不得再有 finishedAt 直接餵進日期格式化的寫法', () => {
  const bad = [];
  const scan = (name, src, res) => { for (const re of res) for (const m of src.matchAll(re)) bad.push(name + ' :: ' + m[0].slice(0, 90)); };
  scan('src/routes/game/+page.svelte', GAME, [/new Date\(c\.finishedAt\)\.toLocale/g]);
  scan('oracle-admin/admin.html', ADMIN, [/miDate\(c\.finishedAt\)/g, /new Date\(c\.finishedAt\)\.toLocale/g]);
  assert.strictEqual(bad.length, 0, '仍在用冠軍產生時間當賽事日期：\n      ' + bad.join('\n      '));
  // 正對照：這個掃描器抓得到（拿 BASE 的寫法當樣本）
  const probe = "｜ {new Date(c.finishedAt).toLocaleDateString('zh-TW')}";
  assert.ok(/new Date\(c\.finishedAt\)\.toLocale/.test(probe), '掃描器壞了：連 BASE 的原始寫法都抓不到');
});

// ══ ⑪ 名詞：兩個時間的語義必須在註解裡寫明（站長要求「更正時間的註記邏輯」）══
await T('⑪ 註記邏輯：開賽時間／冠軍產生時間在三份出貨檔裡都寫明了', () => {
  for (const [n, s] of [['event-date.ts', EVDATE_SRC], ['admin.html', ADMIN], ['server_admin_patch.js', PAT]]) {
    assert.ok(s.includes('開賽時間') && s.includes('冠軍產生時間'),
      n + ' 沒有寫明「開賽時間」與「冠軍產生時間」的差別');
  }
  // ⚠ 只改註解不改行為的地方要標明：admin 的「完賽時間」欄位語義本來就對，只釘死時區
  assert.ok(ADMIN.includes("toLocaleString('zh-TW', { timeZone: 'Asia/Taipei'"),
    '賽事歸檔列表的完賽時間必須釘死 Asia/Taipei（那一欄語義本來就對，只是時區沒釘）');
});

// ══ ⑫ 資料保全 ════════════════════════════════════════════════════════════
await T('⑫ ⚠ 本版沒有新增任何刪除／改寫既有名人堂或歸檔資料的路徑', () => {
  const DANGER = [/TCHAMPS\.deleteMany/g, /TARCHIVE\.deleteMany/g, /TCHAMPS\.updateMany/g,
                  /TARCHIVE\.updateMany/g, /TARCHIVE\.drop\(/g, /TCHAMPS\.drop\(/g];
  const hit = [];
  for (const re of DANGER) for (const m of PAT.matchAll(re)) hit.push(m[0]);
  assert.strictEqual(hit.length, 0, '出現危險寫入：' + hit.join('、'));
  // $unset 全站只允許出現在：① TMATCH（v6.188 的 rematch 清旗標）
  //   ② ⭐v6.295 friendships 的備註名清除 —— **行為端證明**在 test-v6295 B5：
  //      只 $unset 我自己那一側（aliasByA／aliasByB 依 a/b 決定），並逐欄斷言其餘 11 個欄位一個位元都沒動。
  //   ⚠ 兩者都一律不得沾到名人堂／歸檔（下面多加一條直接禁 TCHAMPS／TARCHIVE，比原本更嚴）。
  for (const m of PAT.matchAll(/\$unset/g)) {
    const line = PAT.slice(PAT.lastIndexOf('\n', m.index) + 1, PAT.indexOf('\n', m.index));
    const t = line.trim();
    const isComment = t.startsWith('//') || t.startsWith('*');
    const isFriendsAlias = /\{ _id: cur\._id, status: 'accepted' \}, \{ \$unset: \{ \[field\]: '' \}/.test(line);
    assert.ok(/TMATCH\.updateOne/.test(line) || isFriendsAlias || isComment,
      '$unset 出現在非 TMATCH／非好友備註名的地方：' + t.slice(0, 120));
    assert.ok(!/TCHAMPS|TARCHIVE/.test(line), '$unset 沾到名人堂／歸檔：' + t.slice(0, 120));
  }
  // 正對照：確認上面那個掃描真的走得到（BASE 就有兩處 $unset）
  assert.ok((PAT.match(/\$unset/g) || []).length >= 2, '掃描器壞了：連既有的 $unset 都找不到');
  // recordChampion 只 $set 新欄位；restore 只 $setOnInsert
  const rc = PAT.slice(PAT.indexOf('async function recordChampion('), PAT.indexOf('async function recordTournamentArchive('));
  assert.ok(rc.includes('startedAt: ev.startedAt || ev.createdAt || null'), 'recordChampion 沒有寫入開賽時間');
  assert.ok(!rc.includes('deleteOne') && !rc.includes('deleteMany'), 'recordChampion 不該有刪除');
  const rs = PAT.slice(PAT.indexOf("app.post('/api/tournament/admin/champions/restore-from-archive'"));
  assert.ok(rs.slice(0, 1400).includes('$setOnInsert'), '還原端點必須維持 $setOnInsert（不覆蓋既有）');
});

// ══ ⑬ 版本／文件 ══════════════════════════════════════════════════════════
await T('⑬ 版本一致：version.ts ≥ 6.244、admin.html SITE_VERSION_HINT 同步、admin.html 維持 LF', () => {
  // ⚠v6.245：原本寫死 '6.244'，**每一次** bump 都會假 FAIL（v6.171 對 v6.170 守衛修過同一個病）。
  //   要釘的本來就是「這一版之後版本沒有倒退」與「admin 對照值沒忘記跟上」這兩件事。
  const v = rd('src/lib/version.ts').match(/VERSION = '([\d.]+)'/)[1];
  assert.ok(parseFloat(v) >= 6.244, 'version.ts 版本倒退了：' + v);
  assert.ok(ADMIN.includes("window.SITE_VERSION_HINT = '" + v + "';"),
    'SITE_VERSION_HINT 沒同步（version.ts=' + v + '）');
  assert.ok(!readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'latin1').includes('\r\n'),
    'admin.html 必須維持 LF 行尾');
  // ⭐v6.261 原本寫死 'v1.26' ⇒ 每 bump 一次就會無故翻紅（接著就會有人去 skip 它）。
  //   判準沒有放寬：仍要求「有版本號」而且「不得倒退到 v1.26 以下」（v6.244 的那一版）。
  const _pv = /^\/\/ === ORACLE ADMIN ENDPOINTS === v(\d+)\.(\d+) /.exec(PAT);
  assert.ok(_pv, 'server patch 檔頭抓不到版本號');
  assert.ok(Number(_pv[1]) * 1000 + Number(_pv[2]) >= 1026,
    'server patch 檔頭版本倒退了（' + _pv[0].trim() + '，v6.244 當時是 v1.26）');
});
await T('⑭ 文件：首頁 changelog 有這一則、內部文件寫了枚舉與回填裁定', () => {
  const _i244 = CHANGELOG.indexOf('v6.244');
  assert.ok(_i244 >= 0, '首頁 changelog 少了 v6.244（這是玩家看得到的顯示錯誤，要寫）');
  // ⚠v6.245：原本用 slice(0,900) 假設 v6.244 永遠是第一則 —— 之後每加一則就會往後推。
  //   改成從 v6.244 那一則自己的位置往後找。
  assert.ok(/開賽/.test(CHANGELOG.slice(_i244, _i244 + 900)), '首頁那一則要講清楚改以開賽日為準');
  assert.ok(INTERNAL.includes('## v6.244'), 'docs/changelog-internal.md 少了 v6.244');
  assert.ok(INTERNAL.includes('startedAt') && INTERNAL.includes('零資料遷移'),
    '內部文件要寫明欄位與「不需要回填」的裁定');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
