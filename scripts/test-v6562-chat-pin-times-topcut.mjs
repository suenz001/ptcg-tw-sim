#!/usr/bin/env node
/**
 * v6.562 守衛（站長 2026-10-13 三項）：
 *   ① 錦標賽大廳聊天室的置頂公告（admin 賽事分頁設定、玩家可按 X 隱藏）
 *   ② 賽程表／名人堂賽程每一場的「對局總時間」（找拖時間的對局）
 *   ③ Top Cut 自動規則：出賽 64 人以上取 16 強（站長：用 2 的次方分段）；一鍵建立只沿用手填的 Top Cut
 *
 *   P／T：伺服器 v1.65 哨兵區塊 v165-chat-pin-and-times 抽出來接假 Mongo／假 app **實跑**。
 *   C：前端兩支 leaf（chat-pin.ts／match-times.ts）實跑。
 *   W：對戰頁 v6562 哨兵區塊（tPinRefresh／tPinDismiss／tMatchTimesLoad）用 esbuild 轉成 JS 後注入假 fetch **實跑**；
 *      模板接線（兩個聊天室都有公告、兩個賽程列表都有時間欄）。
 *   A：admin 面板（tevPinPanelHtml 實跑、tevPinSave／tevPinClear 注入假 api 實跑）。
 *   X：swiss.ts 新規則對照表；seedEventBracket（錦標賽區塊內）實跑：自動時依人數取 16 強、記 topCutAuto；
 *      dailySettingsFrom 實跑：只沿用 topCutAuto===false 的 Top Cut。
 * 【H】BASE（v6.561）：P／T／C／W／A／X 全紅（X0 舊表的 ≤16→4／17→8 在 BASE 也成立，不列）。
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.561。
const BASE_SHA = '7b88d581';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const safe = async (fn) => { try { return await fn(); } catch (e) { return { __err: String(e && e.message || e) }; } };

// ── 假 Mongo（只做用到的）──────────────────────────────────────────────
const clone = (o) => JSON.parse(JSON.stringify(o));
function matchOne(doc, q) {
  for (const k of Object.keys(q || {})) {
    const c = q[k], v = doc[k];
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      if ('$ne' in c && v === c.$ne) return false;
      if ('$in' in c && !c.$in.includes(v)) return false;
      if ('$exists' in c && (v !== undefined) !== c.$exists) return false;
      continue;
    }
    if (v !== c) return false;
  }
  return true;
}
function Col(rows = []) {
  const calls = { find: 0, findOne: 0 };
  return {
    rows, calls,
    async findOne(q) { calls.findOne++; const r = rows.find((d) => matchOne(d, q)); return r ? clone(r) : null; },
    find(q) {
      calls.find++;
      let sel = rows.filter((d) => matchOne(d, q || {})).map(clone);
      const cur = { sort: () => cur, limit: (n) => { sel = sel.slice(0, n); return cur; }, toArray: async () => sel };
      return cur;
    },
    async insertOne(d) { rows.push(clone(d)); return { insertedId: d._id }; },
    async insertMany(arr) { if (!arr.length) throw new Error('Batch cannot be empty'); for (const d of arr) rows.push(clone(d)); return { insertedCount: arr.length }; },
    async updateOne(q, u, o) {
      let d = rows.find((x) => matchOne(x, q));
      if (!d) { if (!(o && o.upsert)) return { matchedCount: 0 }; d = {}; for (const k of Object.keys(q)) if (typeof q[k] !== 'object') d[k] = q[k]; rows.push(d); }
      if (u.$set) Object.assign(d, clone(u.$set));
      return { matchedCount: 1 };
    },
    async deleteMany(q) { for (let i = rows.length - 1; i >= 0; i--) if (matchOne(rows[i], q)) rows.splice(i, 1); return {}; },
    async countDocuments(q) { return rows.filter((d) => matchOne(d, q || {})).length; },
  };
}
function sentinel(src, tag) {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  if (a < 0 || b < a) return null;
  return src.slice(src.lastIndexOf('\n', a) + 1, src.indexOf('\n', b) + 1);
}
function fnSrc(P, name) {
  for (const head of ['    async function ' + name + '(', '    function ' + name + '(']) {
    const i = P.indexOf(head);
    if (i < 0) continue;
    const j = P.indexOf('\n    }\n', i);
    return j > i ? P.slice(i, j + 6) : null;
  }
  return null;
}
async function call(h, req) {
  let status = 200, body = null;
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; }, set() { return res; } };
  await h(req, res);
  return { status, body };
}

// ═══ P／T：伺服器區塊 ═════════════════════════════════════════════════
async function serverScenarios(P) {
  const r = {};
  const blk = sentinel(P, 'v165-chat-pin-and-times');
  if (!blk) return r;
  const cfg = Col(), TMATCH = Col();
  const routes = {};
  const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  const db = { collection: (n) => (n === 'tournamentConfig' ? cfg : Col()) };
  let ident = { uid: 'x', email: 'a@x', verified: true }, admin = false;
  const TARCHIVE = Col();
  const built = new Function('db', 'app', 'TMATCH', 'TARCHIVE', 'tournIdentity', 'isTournAdmin', 'return (async () => {\n' + blk + '\nreturn {};\n})();');
  await built(db, app, TMATCH, TARCHIVE, async () => ident, () => admin);
  const realNow = Date.now; let clock = 1_000_000; Date.now = () => clock;
  try {
    const G = () => call(routes['GET /api/tourn-chat-pin'], { query: {} });
    const S = (text) => call(routes['POST /api/tourn-chat-pin'], { body: { text } });
    // P1：沒有公告 ⇒ pinApi:1、pin:null
    const g0 = await G();
    r.P1 = g0.status === 200 && g0.body.pinApi === 1 && g0.body.pin === null;
    // P2：非管理員 403；管理員發布 ⇒ 立刻讀得到（不等 15 秒快取）、id＝更新時間
    const s403 = await S('不可以');
    admin = true; clock += 1000;
    const s1 = await S('  ⚠ 請勿拖延時間\r\n第 3 輪 A 玩家  ');
    const g1 = await G();
    r.P2 = s403.status === 403 && cfg.rows.length === 1 && s1.status === 200
      && g1.body.pin && g1.body.pin.text === '⚠ 請勿拖延時間\n第 3 輪 A 玩家' && g1.body.pin.id === String(clock) && cfg.rows[0].updatedBy === 'a@x';
    r.P2n = JSON.stringify(g1.body);
    // P3：超過 500 字 400；非字串 400；空字串＝取消置頂
    const big = await S('字'.repeat(501));
    const bad = await call(routes['POST /api/tourn-chat-pin'], { body: { text: 123 } });
    const ok500 = await S('字'.repeat(500));
    clock += 1000; const clr = await S('');
    const g3 = await G();
    r.P3 = big.status === 400 && bad.status === 400 && ok500.status === 200 && clr.status === 200 && g3.body.pin === null;
    // P4：快取 15 秒內不重查；過了才重查
    const before = cfg.calls.findOne;
    await G(); await G();
    const mid = cfg.calls.findOne;
    clock += 16000; await G();
    r.P4 = mid === before && cfg.calls.findOne === before + 1;
    r.P4n = JSON.stringify({ before, mid, after: cfg.calls.findOne });

    // T：對局時間
    const M = (round, idx, extra) => ({ _id: 'E_r' + round + '_m' + idx, eventId: 'E', round, idx, ...extra });
    TMATCH.rows.push(
      M(1, 0, { status: 'done', gameStartedAt: 100000, endedAt: 100000 + 23 * 60000 + 5000 }),   // 23:05
      M(1, 1, { status: 'done', bye: true, gameStartedAt: 100000, endedAt: 100001 }),           // 輪空：不回
      M(1, 2, { status: 'done', gameStartedAt: 100000 }),                                         // 沒有 endedAt：不回
      M(1, 3, { status: 'done', gameStartedAt: 500000, endedAt: 400000 }),                        // 負值：不回
      M(1, 4, { status: 'done', gameStartedAt: 100000, endedAt: 100000 + 13 * 3600000 }),         // 超過 12 小時：不回
      M(2, 0, { status: 'playing', gameStartedAt: clock - 7 * 60000 }),                           // 進行中 7 分
      M(2, 1, { status: 'pending' }),                                                              // 還沒開打：不回
      { _id: 'F_r1_m0', eventId: 'F', round: 1, idx: 0, status: 'done', gameStartedAt: 1, endedAt: 2 },
    );
    const T = (eventId) => call(routes['GET /api/tourn-match-times'], { query: { eventId } });
    const t1 = await T('E');
    const by = Object.fromEntries((t1.body.times || []).map((x) => [x.r + '_' + x.i, x]));
    r.T1 = t1.status === 200 && t1.body.matchTimesApi === 1 && Object.keys(by).sort().join() === '1_0,2_0'
      && by['1_0'].ms === 23 * 60000 + 5000 && by['1_0'].live === false && by['2_0'].ms === 7 * 60000 && by['2_0'].live === true;
    r.T1n = JSON.stringify(t1.body);
    // T2：沒帶 eventId 400；不同賽事互不混
    const t400 = await T('');
    const tF = await T('F');
    r.T2 = t400.status === 400 && tF.body.times.length === 1 && tF.body.times[0].ms === 1;
    // T3：同時 3 個請求只查一次；15 秒內不重查；進行中的時間每次照現在重算
    const T3col = Col([...TMATCH.rows]);
    const routes3 = {};
    await new Function('db', 'app', 'TMATCH', 'TARCHIVE', 'tournIdentity', 'isTournAdmin', 'return (async () => {\n' + blk + '\nreturn {};\n})();')(
      db, { get: (p, h) => { routes3['GET ' + p] = h; }, post: () => {} }, T3col, Col(), async () => ident, () => admin);
    const q = () => call(routes3['GET /api/tourn-match-times'], { query: { eventId: 'E' } });
    await Promise.all([q(), q(), q()]);
    const n1 = T3col.calls.find;
    clock += 10000; const later = await q();
    const live = later.body.times.find((x) => x.live);
    r.T3 = n1 === 1 && T3col.calls.find === 1 && live && live.ms === 7 * 60000 + 10000;
    r.T3n = JSON.stringify({ n1, n2: T3col.calls.find, live });
    // T4（Fable P2-2）：賽事被刪掉（TMATCH 沒有了）⇒ 改讀永久歸檔的同一份欄位
    TARCHIVE.rows.push({ _id: 'arch_G', matches: [{ round: 1, idx: 0, status: 'done', gameStartedAt: 1000, endedAt: 61000 }, { round: 1, idx: 1, status: 'done', bye: true, gameStartedAt: 1, endedAt: 2 }] });
    const tG = await T('G');
    r.T4 = tG.status === 200 && tG.body.times.length === 1 && tG.body.times[0].ms === 60000 && (await T('H')).body.times.length === 0;
  } finally { Date.now = realNow; }
  return r;
}

// ═══ C：前端 leaf ═════════════════════════════════════════════════════
async function loadLeaves(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/tournament/chat-pin.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6562-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export * as CP from '${p('src/lib/tournament/chat-pin')}';\nexport * as MT from '${p('src/lib/tournament/match-times')}';\nexport * as SW from '${p('src/lib/tournament/swiss')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
function leafScenarios(L) {
  const r = {};
  if (!L) return r;
  const { CP, MT } = L;
  r.C1 = CP.parseChatPin({ pinApi: 1, pin: { id: '5', text: ' 嗨 ', at: 5 } })?.text === '嗨'
    && CP.parseChatPin({ pinApi: 1, pin: null }) === null && CP.parseChatPin({ pin: { id: '5', text: 'x' } }) === null
    && CP.parseChatPin({ pinApi: 1, pin: { id: '', text: 'x' } }) === null && CP.parseChatPin(null) === null;
  const pin = { id: '9', text: 't', at: 9 };
  r.C2 = CP.chatPinVisible(pin, null) && !CP.chatPinVisible(pin, '9') && CP.chatPinVisible(pin, '8') && !CP.chatPinVisible(null, null);
  // C3：隱藏紀錄存在 localStorage；讀寫失敗不丟例外
  const store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  CP.saveDismissedPinId('9');
  const got = CP.loadDismissedPinId();
  globalThis.localStorage = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  let threw = false; try { CP.saveDismissedPinId('1'); CP.loadDismissedPinId(); } catch { threw = true; }
  delete globalThis.localStorage;
  r.C3 = got === '9' && store[CP.CHAT_PIN_DISMISS_KEY] === '9' && !threw;
  // C4：對局時間解析與格式
  const t = MT.parseMatchTimes({ matchTimesApi: 1, times: [{ r: 1, i: 0, ms: 65000, live: false }, { r: 2, i: 3, ms: 3725000, live: true }, { r: 'x', i: 0, ms: 1 }, { r: 1, i: 1, ms: -5 }] });
  r.C4 = t && Object.keys(t).sort().join() === '1_0,2_3' && t['2_3'].live === true && MT.parseMatchTimes({ times: [] }) === null
    && MT.fmtMatchDuration(0) === '0:00' && MT.fmtMatchDuration(65000) === '1:05' && MT.fmtMatchDuration(3725000) === '1:02:05' && MT.fmtMatchDuration(59999) === '0:59'
    && /進行中/.test(MT.matchTimeTitle({ ms: 1000, live: true })) && /對局總時間/.test(MT.matchTimeTitle({ ms: 1000, live: false }));
  return r;
}

// ═══ W：對戰頁接線 ══════════════════════════════════════════════════════
async function pageScenarios(PAGE, L) {
  const r = {};
  const blk = sentinel(PAGE, 'v6562-chat-pin-and-times');
  if (!blk || !L) return r;
  const js = (await transform(blk, { loader: 'ts' })).code;   // $state／$derived 由下面注入成同名參數（JS 識別字可以有 $）
  let fetched = [];
  let respond = () => ({ ok: true, json: async () => ({}) });
  const fakeFetch = async (u) => { fetched.push(u); return respond(u); };
  const realNow = Date.now; let clock = 5_000_000; Date.now = () => clock;
  const store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  try {
    const env = { ...L.CP, ...L.MT, fetch: fakeFetch, $state: (v) => v, $derived: (v) => v };
    const names = Object.keys(env);
    const S = new Function(...names, js + '\nreturn { tPinRefresh, tPinDismiss, tMatchTimesLoad, get tPin() { return tPin; }, get tPinDismissed() { return tPinDismissed; }, get tMatchTimes() { return tMatchTimes; } };')(...names.map((n) => env[n]));
    // W1：公告：抓一次、30 秒內不重抓、force 可重抓；X 隱藏後記住 id；舊伺服器 404 不改動
    respond = () => ({ ok: true, json: async () => ({ pinApi: 1, pin: { id: '77', text: '公告', at: 77 } }) });
    await S.tPinRefresh(); await S.tPinRefresh();
    const n1 = fetched.length;
    clock += 31000; await S.tPinRefresh();
    const n2 = fetched.length;
    S.tPinDismiss();
    respond = () => ({ ok: false, json: async () => ({}) });
    await S.tPinRefresh(true);
    r.W1 = n1 === 1 && n2 === 2 && fetched[0] === L.CP.CHAT_PIN_URL && S.tPin && S.tPin.id === '77' && S.tPinDismissed === '77' && store[L.CP.CHAT_PIN_DISMISS_KEY] === '77';
    r.W1n = JSON.stringify({ n1, n2, pin: S.tPin, d: S.tPinDismissed });
    // W2：對局時間：每個賽事各自節流 30 秒；網址編碼；結果存在 tMatchTimes[eventId]
    fetched = [];
    respond = () => ({ ok: true, json: async () => ({ matchTimesApi: 1, times: [{ r: 1, i: 0, ms: 60000, live: false }] }) });
    await S.tMatchTimesLoad('E 1'); await S.tMatchTimesLoad('E 1'); await S.tMatchTimesLoad('F');
    const a = fetched.slice();
    clock += 31000; await S.tMatchTimesLoad('E 1');
    await S.tMatchTimesLoad('F', true);
    r.W2 = a.length === 2 && a[0] === L.MT.MATCH_TIMES_URL + '?eventId=E%201' && fetched.length === 4
      && !!S.tMatchTimes['E 1'] && S.tMatchTimes['E 1']['1_0'].ms === 60000 && !!S.tMatchTimes.F;
    r.W2n = JSON.stringify({ a, n: fetched.length, mt: S.tMatchTimes });
  } finally { Date.now = realNow; delete globalThis.localStorage; }
  // W3：接線：聊天室輪詢會帶公告、賽程表載入會帶時間、名人堂賽程打開時抓時間
  const chatLoad = PAGE.match(/async function tChatLoad\(\) \{[\s\S]*?\n  \}/);
  const brk = PAGE.match(/async function tBracketLoad\(\) \{[\s\S]*?\n  \}/);
  const hof = PAGE.match(/async function tHofOpen\(c: any\) \{[\s\S]*?\n  \}/);
  r.W3 = !!chatLoad && /void tPinRefresh\(\)/.test(chatLoad[0]) && !!brk && /for \(const ev of evs\) void tMatchTimesLoad\(String\(ev && ev\._id\)\)/.test(brk[0])
    && !!hof && /void tMatchTimesLoad\(String\(c\.eventId\), true\)/.test(hof[0]);
  // W4：模板：兩個聊天室（大廳、浮動面板）都有公告與 X；兩個賽程列表都有時間欄（有時間才多一欄）
  const pins = PAGE.match(/<div class="tchat-pin" role="note">[\s\S]*?onclick=\{tPinDismiss\}[\s\S]*?<\/div>\{\/if\}/g) || [];
  const times = PAGE.match(/\{#if _mt\}<span class="tm-time" class:live=\{_mt\.live\} title=\{matchTimeTitle\(_mt\)\}>⏱ \{fmtMatchDuration\(_mt\.ms\)\}<\/span>\{\/if\}/g) || [];
  // 兩個顯示條件逐字釘住（條件被改成 false ＆＆… 之類就紅）；大廳那一則必須緊接在訊息區之前（不在捲動區裡，捲上去也看得到）
  const lobbyPin = /\n        \{#if tPinShown && tPin\}<div class="tchat-pin" role="note">[^\n]*\{\/if\}\n        <div class="tourn-chat-msgs"/.test(PAGE);
  const floatPin = /\n        \{#if isTournament && tPinShown && tPin\}<div class="tchat-pin" role="note">[^\n]*\{\/if\}\n        <div class="chat-panel-messages"/.test(PAGE);
  r.W4 = pins.length === 2 && lobbyPin && floatPin && times.length === 2
    && (PAGE.match(/class:has-time=\{!!_mt\}/g) || []).length === 2 && /\.tourn-match\.has-time \{ grid-template-columns: 1fr auto 1fr auto; \}/.test(PAGE);
  r.W4n = JSON.stringify({ pins: pins.length, times: times.length, lobbyPin, floatPin });
  return r;
}

// ═══ A：admin 面板 ═══════════════════════════════════════════════════════
function adminScenarios(H) {
  const r = {};
  const i = H.indexOf('function tevPinPanelHtml(');
  const j = H.indexOf('function tevDailyPanelHtml(');
  if (i < 0 || j < i) return r;
  const body = H.slice(i, j);
  const calls = []; let alerts = [], confirmAns = true, reloads = 0;
  const win = {};
  const api = async (path, opt) => { calls.push([path, opt && JSON.parse(opt.body), opt && opt.method]); return {}; };
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const elVal = { v: '' };
  const document = { getElementById: (id) => (id === 'tev-pin-text' ? { value: elVal.v } : null) };
  const F = new Function('window', 'api', 'escapeHtml', 'document', 'confirm', 'alert', 'loadTournamentAdmin', body + '\nreturn { tevPinPanelHtml };')(
    win, api, escapeHtml, document, () => confirmAns, (m) => alerts.push(m), () => { reloads++; });
  const off = F.tevPinPanelHtml(null, '', '');
  const empty = F.tevPinPanelHtml({ pinApi: 1, pin: null }, '', '');
  const has = F.tevPinPanelHtml({ pinApi: 1, pin: { text: '<b>警告</b>' } }, '', '');
  r.A1 = off === '' && /tevPinSave/.test(empty) && !/tevPinClear/.test(empty) && /tevPinClear/.test(has) && has.includes('&lt;b&gt;警告&lt;/b&gt;') && !has.includes('<b>警告');
  return (async () => {
    elVal.v = '  第 3 輪請加快  ';
    await win.tevPinSave(null);
    elVal.v = '   ';
    await win.tevPinSave(null);   // 空白 ⇒ 不送
    confirmAns = false; elVal.v = 'x'; await win.tevPinSave(null);   // 取消 ⇒ 不送
    confirmAns = true; await win.tevPinClear(null);
    r.A2 = calls.length === 2 && calls[0][0] === '/api/tourn-chat-pin' && calls[0][2] === 'POST' && calls[0][1].text === '第 3 輪請加快'
      && calls[1][1].text === '' && reloads === 2 && alerts.length === 1;
    r.A2n = JSON.stringify({ calls, alerts, reloads });
    // A3（Opus 複審 P2-A）：編輯表單只回填手填的輪數／Top Cut；狀態列在開賽前的自動賽事標「自動」
    const hs = H.indexOf('function tevManualVal('), he = H.indexOf('function tevPinPanelHtml(');
    if (hs >= 0 && he > hs) {
      const G2 = new Function(H.slice(hs, he) + '\nreturn { tevManualVal, tevSwissLabel };')();
      const legacy = { status: 'registration', swissRounds: 6, topCut: 8 };
      const manual = { status: 'registration', swissRounds: 6, topCut: 8, swissRoundsAuto: false, topCutAuto: false };
      const run2 = { status: 'running', currentRound: 2, swissRounds: 5, topCut: 16, swissRoundsAuto: true, topCutAuto: true };
      r.A3 = G2.tevManualVal(legacy, 'swissRounds') === '' && G2.tevManualVal(legacy, 'topCut') === '' && G2.tevManualVal(manual, 'swissRounds') === '6' && G2.tevManualVal(manual, 'topCut') === '8'
        && G2.tevSwissLabel(legacy) === '（輪數自動→Top Cut 自動）' && G2.tevSwissLabel(manual) === '（6輪→前8）' && G2.tevSwissLabel(run2) === '（5輪→前16）'
        && /id="tev-e-swissrounds" value="' \+ escapeHtml\(tevManualVal\(ev, 'swissRounds'\)\)/.test(H) && /id="tev-e-topcut" value="' \+ escapeHtml\(tevManualVal\(ev, 'topCut'\)\)/.test(H)
        && /瑞士制\+TopCut Bo1' \+ tevSwissLabel\(ev\)/.test(H);
    }
    return r;
  })();
}

// ═══ X：Top Cut 規則 ═════════════════════════════════════════════════════
async function topCutScenarios(P, L) {
  const r = {};
  if (!L) return r;
  const f = L.SW.topCutSizeForCount;
  // X1：新規則對照表（第二參數＝瑞士輪數；省略＝依人數自動輪數）
  const cases = [[3, undefined, 2], [4, undefined, 4], [16, undefined, 4], [17, undefined, 8], [60, undefined, 8], [63, undefined, 8], [64, undefined, 16], [88, undefined, 16], [128, undefined, 16], [88, 5, 16], [88, 6, 8], [64, 7, 8], [88, 4, 16]];   // 站長 17:18／17:20：≥64→16，但瑞士超過 5 輪維持 8
  const bad = cases.filter(([n, rr, want]) => f(n, rr) !== want);
  r.X1 = bad.length === 0;
  r.X1n = JSON.stringify(bad.map(([n, rr, want]) => [n, rr, want, f(n, rr)]));
  // X1b：自動輪數配合 Top Cut —— 33～128 人一律 5 輪；整個自動範圍內「16 強」時輪數一定 ≤5（不會輪數變多又打 16 強）
  const sr = L.SW.swissRoundsForCount;
  let worst = null;
  for (let n = 2; n <= 300; n++) { const rr = sr(n); if (f(n, rr) === 16 && rr > 5) { worst = [n, rr]; break; } }
  r.X1b = sr(16) === 3 && sr(17) === 4 && sr(32) === 4 && sr(33) === 5 && sr(64) === 5 && sr(96) === 5 && sr(128) === 5 && sr(129) === 6 && worst === null && f(130) === 8;
  r.X1bn = JSON.stringify({ worst, r96: sr(96), r129: sr(129) });
  // X2：seedEventBracket 實跑（錦標賽區塊內）：自動 ⇒ 依人數＋輪數；手填 ⇒ 照手填；都記 topCutAuto
  const parts = ['_seedEventBracketImpl', 'buildRoundMatches', 'postSystemChat'].map((n) => fnSrc(P, n));
  const chainA = P.indexOf('    let _seedChain = Promise.resolve();'), chainB = P.indexOf('\n    async function _seedEventBracketImpl(');
  if (parts.every(Boolean) && chainA > 0 && chainB > chainA) {
    const run = async (n, ev) => {
      const TEVENTS = Col([{ _id: 'EV', ...ev }]), TREGS = Col(), TMATCH = Col(), TCHAT = Col();
      for (let k = 0; k < n; k++) TREGS.rows.push({ _id: 'EV__u' + k, eventId: 'EV', uid: 'u' + k, name: 'u' + k, checkedIn: true, deckEntries: [] });
      const env = { TEVENTS, TREGS, TMATCH, TCHAT, TROOMS: Col(), TENG: L.SW, console: { warn() {}, log() {} } };
      const code = P.slice(chainA, chainB) + '\n' + parts.join('\n') + '\nreturn { seedEventBracket };';
      const names = Object.keys(env);
      const S = new Function(...names, code)(...names.map((x) => env[x]));
      const out = await S.seedEventBracket({ _id: 'EV', name: '測試', format: 'swiss-then-cut', roundCountdownMin: 3, ...ev }, { checkedInOnly: true });
      return { out, ev: TEVENTS.rows[0], chat: TCHAT.rows.map((c) => c.text).join('\n') };
    };
    const a = await safe(() => run(88, { swissRounds: 5, topCut: 0, swissRoundsAuto: false, topCutAuto: true }));
    const b = await safe(() => run(88, { swissRounds: 5, topCut: 8, swissRoundsAuto: false, topCutAuto: false }));
    // g（Fable P1-1）：v1.64 一鍵建立沿用來的「6 輪／8 強」、沒有旗標 ⇒ 視為自動、依人數重算 ⇒ 5 輪＋16 強，並記成自動（隔天不會被沿用）
    const g = await safe(() => run(88, { swissRounds: 6, topCut: 8 }));
    const c = await safe(() => run(30, { swissRounds: 0, topCut: 0 }));
    // e：88 人但站長手填 6 輪 ⇒ 不取 16 強（維持 8）；f：88 人自動 ⇒ 5 輪 16 強、記 swissRoundsAuto
    const e = await safe(() => run(88, { swissRounds: 6, topCut: 0, swissRoundsAuto: false, topCutAuto: true }));
    const f2 = await safe(() => run(88, { swissRounds: 0, topCut: 0 }));
    // d：63 人仍是 8 強（邊界）
    const d = await safe(() => run(63, { swissRounds: 5, topCut: 0 }));
    r.X2 = !a.__err && a.ev.topCut === 16 && a.ev.topCutAuto === true && a.ev.swissRounds === 5 && /取前 16 名/.test(a.chat)
      && !b.__err && b.ev.topCut === 8 && b.ev.topCutAuto === false
      && !c.__err && c.ev.topCut === 8 && c.ev.topCutAuto === true && c.ev.swissRounds === 4
      && !d.__err && d.ev.topCut === 8 && d.ev.topCutAuto === true
      && !e.__err && e.ev.topCut === 8 && e.ev.swissRoundsAuto === false
      && !g.__err && g.ev.swissRounds === 5 && g.ev.topCut === 16 && g.ev.swissRoundsAuto === true && g.ev.topCutAuto === true
      && !f2.__err && f2.ev.swissRounds === 5 && f2.ev.topCut === 16 && f2.ev.swissRoundsAuto === true && a.ev.swissRoundsAuto === false;
    r.X2n = JSON.stringify({ a: a.__err || [a.ev.topCut, a.ev.topCutAuto], b: b.__err || [b.ev.topCut, b.ev.topCutAuto], c: c.__err || [c.ev.topCut, c.ev.topCutAuto, c.ev.swissRounds], d: d.__err || d.ev.topCut, g: g.__err || [g.ev.swissRounds, g.ev.topCut, g.ev.swissRoundsAuto, g.ev.topCutAuto], e: e.__err || [e.ev.topCut, e.ev.swissRoundsAuto], f: f2.__err || [f2.ev.swissRounds, f2.ev.topCut, f2.ev.swissRoundsAuto] });
  }
  // X3：dailySettingsFrom 實跑：只沿用 topCutAuto===false 的 Top Cut；其餘欄位照樣沿用
  const ds = fnSrc(P, 'dailySettingsFrom'), dn = fnSrc(P, 'dailyNoOf');
  const reAt = P.indexOf('    const TDAILY_NAME_RE = ');
  if (ds && dn && reAt > 0) {
    const reLine = P.slice(reAt, P.indexOf('\n', reAt) + 1);
    const F = new Function(reLine + dn + ds + '\nreturn dailySettingsFrom;')();
    const mk = (extra) => [{ name: '網站賽-9【21:00 瑞士制】', format: 'swiss-then-cut', swissRounds: 5, topCut: 8, roundLimitMin: 25, ...extra }];
    const s1 = F(mk({ topCutAuto: false, swissRoundsAuto: false }), 'swiss'), s2 = F(mk({ topCutAuto: true, swissRoundsAuto: true }), 'swiss'), s3 = F(mk({}), 'swiss');
    r.X3 = s1.topCut === 8 && s2.topCut === '' && s3.topCut === '' && s1.swissRounds === 5 && s2.swissRounds === '' && s3.swissRounds === '' && s3.roundLimitMin === 25;
    r.X3n = JSON.stringify([s1.topCut, s2.topCut, s3.topCut, s1.swissRounds, s2.swissRounds, s3.swissRounds]);
    // X3b：一鍵建立掃描的欄位有讀 topCutAuto（沒讀 ⇒ X3 在真的資料上永遠走「沒有旗標」那條）
    const scan = fnSrc(P, 'dailyScanSources') || '';
    r.X3b = /topCut: 1, topCutAuto: 1, swissRoundsAuto: 1 \}/.test(scan);
  }
  // X4（Fable P1-1）：建立賽事（insertTournamentEvent 實跑，一鍵建立與手動建立共用）當下就記下是不是手填；編輯賽事同理
  const ins = fnSrc(P, 'insertTournamentEvent');
  if (ins) {
    const TEVENTS = Col();
    const F = new Function('TEVENTS', ins + '\nreturn insertTournamentEvent;')(TEVENTS);
    const e1 = await F({ name: 'a', format: 'swiss', swissRounds: '', topCut: '' }, { email: 'x' });
    const e2 = await F({ name: 'b', format: 'swiss', swissRounds: '5', topCut: '8' }, { email: 'x' }, 2);
    const e3 = await F({ name: 'c', format: 'single-elim' }, { email: 'x' }, 3);
    // 編輯端（Opus 複審 P3-A：原本只比字面，註解掉也會綠）⇒ 把 /event/update handler 抽出來實跑
    let upd = false;
    const ui = P.indexOf("    app.post('/api/tournament/admin/event/update'");
    const uj = ui >= 0 ? P.indexOf('\n    });\n', ui) : -1;
    if (ui >= 0 && uj > ui) {
      const runUpd = async (ev0, body) => {
        const TE = Col([{ _id: 'EV', ...ev0 }]); const hs = {};
        new Function('app', 'tournIdentity', 'isTournAdmin', 'resolveEventFromReq', 'TEVENTS', P.slice(ui, uj + 8))(
          { post: (p, h) => { hs[p] = h; } }, async () => ({ uid: 'a', email: 'a', verified: true }), () => true, async () => clone(TE.rows[0]), TE);
        await call(hs['/api/tournament/admin/event/update'], { body });
        return TE.rows[0];
      };
      const u1 = await runUpd({ status: 'registration', format: 'swiss-then-cut', swissRounds: 6, topCut: 8 }, { name: 'n', format: 'swiss', swissRounds: '', topCut: '' });
      const u2 = await runUpd({ status: 'registration', format: 'swiss-then-cut' }, { format: 'swiss', swissRounds: '5', topCut: '16' });
      const u3 = await runUpd({ status: 'running', format: 'swiss-then-cut', swissRounds: 5, topCut: 16, swissRoundsAuto: true, topCutAuto: true }, { format: 'swiss', swissRounds: '7', topCut: '8', name: 'x' });
      upd = u1.swissRoundsAuto === true && u1.topCutAuto === true && u1.swissRounds === 0
        && u2.swissRoundsAuto === false && u2.topCutAuto === false && u2.swissRounds === 5 && u2.topCut === 16
        && u3.swissRounds === 5 && u3.swissRoundsAuto === true;   // 開賽後不可改瑞士欄位
    }
    r.X4 = e1.swissRoundsAuto === true && e1.topCutAuto === true && e2.swissRoundsAuto === false && e2.topCutAuto === false && e2.swissRounds === 5 && e3.swissRoundsAuto === undefined && upd;
    r.X4n = JSON.stringify([e1.swissRoundsAuto, e1.topCutAuto, e2.swissRoundsAuto, e2.topCutAuto, e3.swissRoundsAuto, upd]);
  }
  // X5（Fable P2-1）：投降／中途棄賽（兩種）／管理員裁定／閒置判負也記 endedAt（賽程表才看得到拖很久後投降的那幾場）；未進場不記（沒有對局）
  const ended = (P.match(/status: 'done', (?:forfeit: true|adminResolved: true|idleForfeit: true|forfeit: true, dropForfeit: true)[^}]*endedAt: Date\.now\(\) \} \}\);/g) || []).length
    + (P.match(/doubleDrop: true, endedAt: Date\.now\(\) \} \}\);/g) || []).length;
  const noShowEnded = /noShow: true, endedAt/.test(P);
  const archTimes = /dropForfeit: !!m\.dropForfeit, gameStartedAt: m\.gameStartedAt \|\| null, endedAt: m\.endedAt \|\| null \}\)\),/.test(fnSrc(P, 'recordTournamentArchive') || '');
  r.X5 = ended === 5 && !noShowEnded && archTimes;
  r.X5n = String(ended);
  return r;
}

const LABEL = {
  P1: '★★ P1 沒有公告 ⇒ pinApi:1、pin:null', P2: '★★★ P2 非管理員 403；管理員發布後立刻讀得到（換行正規化、去頭尾空白、id＝更新時間、記發布者）',
  P3: '★★ P3 超過 500 字／非字串 ⇒ 400；空字串＝取消置頂', P4: '★★ P4 讀取快取 15 秒（期間不重查 DB）',
  T1: '★★★ T1 對局時間：已結束＝endedAt−gameStartedAt；進行中＝到現在（live）；輪空／沒有 endedAt／負值／超過 12 小時／還沒開打都不回',
  T2: '★★ T2 沒帶 eventId 400；不同賽事互不混', T4: '★★ T4 賽事被刪掉 ⇒ 改讀永久歸檔的對局時間（輪空照樣不回）', T3: '★★ T3 同時多個請求只查一次；15 秒快取；進行中的時間每次照現在重算',
  C1: '★★ C1 parseChatPin：要 pinApi 哨兵、要 id 與內容', C2: '★★★ C2 已隱藏的那一則不顯示，新的一則（id 不同）會再出現',
  C3: '★★ C3 隱藏紀錄存 localStorage；讀寫失敗不丟例外', C4: '★★ C4 parseMatchTimes 過濾壞資料；時間格式 m:ss／h:mm:ss；提示文字分進行中／已結束',
  W1: '★★★ W1 對戰頁 tPinRefresh 實跑：30 秒節流、force 重抓、按 X 記住這一則、舊伺服器 404 不清掉', W2: '★★★ W2 tMatchTimesLoad 實跑：每個賽事各自 30 秒節流、網址編碼、結果依賽事存放',
  W3: '★★ W3 接線：聊天室輪詢帶公告、賽程表載入帶時間、名人堂賽程打開時抓時間', W4: '★★ W4 模板：大廳與浮動聊天室都有公告＋X；即時賽程與名人堂賽程都有時間欄（有時間才多一欄）',
  A3: '★★★ A3 admin 編輯表單只回填手填的輪數／Top Cut（v1.64 沿用來的數字留空，按更新不會變成手填）；狀態列開賽前標自動',
  A1: '★★ A1 admin 面板：舊伺服器不顯示、沒有公告時沒有「取消置頂」、內容有跳脫', A2: '★★★ A2 admin 發布／取消：只送 text、空白不送、取消確認不送、完成後重新載入',
  X1: '★★★ X1 Top Cut 新規則對照表（2 的次方分段：≤16→4、17～63→8、≥64→16）',
  X4: '★★★ X4 建立／編輯賽事當下記下是否手填（insertTournamentEvent 與 /event/update 都實跑；開賽後編輯不改瑞士欄位）', X5: '★★ X5 投降／棄賽／管理員裁定／閒置判負也記 endedAt（未進場不記）；永久歸檔也帶對局時間',
  X1b: '★★★ X1b 自動輪數：≤16→3、17～32→4、33～128→5；自動範圍內取 16 強時瑞士一定 ≤5 輪（站長：不可以輪數變多又打 16 強）',
  X2: '★★★ X2 開賽（seedEventBracket 實跑）：88 人自動 ⇒ 5 輪 16 強並公告、記兩個 Auto 旗標；手填 6 輪 ⇒ 8 強；63 人 ⇒ 8 強；手填 8 照 8；30 人 ⇒ 4 輪 8 強',
  X3: '★★★ X3 一鍵建立只沿用手填的瑞士輪數與 Top Cut（自動算的、舊賽事沒有旗標的都不沿用）；其他欄位照樣沿用', X3b: '★★ X3b 一鍵建立的掃描有讀兩個 Auto 旗標',
};

const P = normEol(readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8'));
const PAGE = normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
const ADMIN = normEol(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'));
const L = await loadLeaves(ROOT);
async function all(P0, PAGE0, ADMIN0, L0) {
  // ⚠ 每一節各自包 try（Rule 41：BASE 缺東西時逐條紅，不整支 throw）
  const g = async (fn) => { try { const x = await fn(); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
  return { ...(await g(() => serverScenarios(P0))), ...(await g(() => leafScenarios(L0))), ...(await g(() => pageScenarios(PAGE0, L0))), ...(await g(() => adminScenarios(ADMIN0))), ...(await g(() => topCutScenarios(P0, L0))) };
}
const R = await all(P, PAGE, ADMIN, L);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);

console.log('【H】HEAD-FAIL（BASE v6.561）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6562 HEAD-FAIL', '需要歷史 commit');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6562b-'));
  try {
    const rd = (p) => { const x = readBaseBlob(ROOT, BASE_SHA, p); return x.ok ? normEol(x.out) : ''; };
    // BASE 沒有兩支 leaf ⇒ 只有 swiss.ts；另外 bundle 一份 BASE 的 swiss 給 X 用
    const { execFileSync } = await import('node:child_process');
    extractBaseArchive(ROOT, BASE_SHA, ["src/lib/tournament"], tmp);
    const LB = await loadLeaves(tmp);
    let LBs = null;
    try {
      const E = join(tmp, 'e2.ts'), O = join(tmp, 'o2.mjs');
      writeFileSync(E, `export * as SW from '${join(tmp, 'src/lib/tournament/swiss').replace(/\\/g, '/')}';`);
      await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent' });
      LBs = await import(pathToFileURL(O).href);
    } catch { LBs = null; }
    const B = { ...(await all(rd('oracle-admin/server_admin_patch.js'), rd('src/routes/game/+page.svelte'), rd('oracle-admin/admin.html'), LB)),
      ...(await (async () => { try { return await topCutScenarios(rd('oracle-admin/server_admin_patch.js'), LBs); } catch { return {}; } })()) };
    for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.561：${k} 紅`, B[k] !== true, String(B[k]));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.562 置頂公告／對局時間／Top Cut：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
