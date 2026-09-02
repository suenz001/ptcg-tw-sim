// v6.286 守衛：好友功能對抗性審查六修 ＋ 八條守衛補強（HEAD-FAIL：BASE v6.285 上每一節都紅）
//
// 守什麼（全部行為端；伺服器區塊用 scripts/lib/friends-harness-v6282.mjs 抽出來實跑）：
//   【1】admin.html 有好友開關 UI，且 loadMonitor 真的打 GET /api/friends/admin/config、monSetFriends 真的 POST 同一支端點；
//        再把 UI 送出的 (method, path, body) 原封餵進伺服器區塊的 routes 表 ⇒ 開關真的切換（兩端接線）。
//   【2】偽造 rooms.seats[].email ＋ POST /api/match-result 的 enrich 段實跑 ⇒ 改不動別人在好友名單裡的 nick；
//        playerIdentity 不再落地 nick；uid/uids 仍回（大廳提示用）。正對照＝突變體回 BASE 寫法 ⇒ 必紅。
//   【3】remove 對 rejected 列 409 且列仍在；兩步攻擊（remove→request、block→unblock→request）實跑都 429。
//   【4】七支端點＋admin 兩支：丟一個帶兩個 email 的 Mongo E11000 例外 ⇒ 回應掃不到 `@`、code 固定；原文只進 log。
//   【5】拒絕方自己邀回去 ⇒ 200 pending（requester 換人）；被拒方 ⇒ 429。
//   【6】設定 modal 的 ✕ 進 sticky dock：CSS 級聯（CI）＋ Playwright DOM 量測（七種尺寸；沙盒）：
//        scrollTop=0 零位移、捲到底仍在畫面內且 elementFromPoint 命中；其他三個 zoom modal 全元素 rect 全等。
//   【7】八條突變各自有守衛打紅：fid 越權／gate 順序／開關 TTL／半個 email／createIndex／讓路節拍（500 筆）／
//        /friends 頁匿名不發 list／game/+page.svelte 的 $effect／onMount 內零好友請求。
//   【8】錦標賽區塊 sha256（與 test-v6272 ⑨／test-v6283 D1 同兩把）。
//
// ⚠ 紀律：只捕 AssertionError；突變體必須紅在**預期那一條**；不 pin 版本號／sha 當唯一判準（BASE 對照用突變體做，history-free）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import {
  readPatch, extractBlock, FR_START, FR_END, ID_START, ID_END, EN_START, EN_END,
  buildFriends, makeFakeDb, asUser, findEmails, makeYield,
} from './lib/friends-harness-v6282.mjs';
import { extractCss, settingsMarkup, zoomModalFixtures, VIEWPORTS, pageHtml } from './lib/zoom-modal-fixture.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');
const P_ADMIN = join(ROOT, 'oracle-admin/admin.html');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_FRPAGE = join(ROOT, 'src/routes/friends/+page.svelte');
const P_PKG = join(ROOT, 'package.json');
const PATCH = readPatch(P_SRV);
const ADMIN = readFileSync(P_ADMIN, 'utf8');
const GAME = readFileSync(P_GAME, 'utf8').replace(/\r\n/g, '\n');
const FRPAGE = readFileSync(P_FRPAGE, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0; const skipped = [];
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 600)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, expectFrag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 200) + '（預期含「' + expectFrag + '」）');
};
const mutate = (src, a, b) => { const n = src.split(a).length - 1; assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 80)); return src.replace(a, b); };
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const U = {
  A: { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' },
  B: { uid: 'fB', email: 'bob@example.com', name: '鮑伯' },
  C: { uid: 'fC', email: 'carol@example.com', name: '卡蘿' },
};
const ROOM = { _id: 'AB12', status: 'ended', seats: [{ uid: 'o-alice', email: 'alice@example.com', name: '愛麗絲' }, { uid: 'o-bob', email: 'bob@example.com', name: '鮑伯' }] };
const seedBase = () => ({ tournamentConfig: [{ _id: 'friendsConfig', enabled: true }], rooms: [structuredClone(ROOM)] });
const mkRow = (a, b, requester, extra) => {
  const [x, y] = a < b ? [a, b] : [b, a]; const _id = x + '|' + y;
  return Object.assign({ _id, fid: 'f' + createHash('sha1').update(_id).digest('hex').slice(0, 20), a: x, b: y, status: 'pending', requester, blockedBy: null, nickA: '快照A', nickB: '快照B', addedVia: 'battle', createdAt: 1, updatedAt: 1 }, extra || {});
};
const ALL_EPS = [['get', '/api/friends/list'], ['post', '/api/friends/request'], ['post', '/api/friends/accept'], ['post', '/api/friends/reject'], ['post', '/api/friends/remove'], ['post', '/api/friends/block'], ['post', '/api/friends/unblock']];

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】抽取器 ＋ 錦標賽區塊 sha256');
let FR = '', IDB = '', ENRICH = '';
await T('A0 三個伺服器區塊抽得到（掃描器下限）', () => {
  FR = extractBlock(PATCH, FR_START, FR_END, 15000);
  IDB = extractBlock(PATCH, ID_START, ID_END, 800);
  ENRICH = extractBlock(PATCH, EN_START, EN_END, 800);
  assert.ok(FR.includes('function _frFail('), 'HEAD-FAIL：friends 區塊沒有 v1.37 的 _frFail（BASE v6.285 ⇒ 這一條必紅）');
});
if (!FR) { console.log('\n══ v6.286 守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：區塊抽不到，後續無法進行）══'); process.exit(1); }
const TOURN_TAIL_SHA256 = 'c0891b6f200ab4e3898c50aa77365458d2207870e828dc28bbfb44df81ddcda3';   // 與 test-v6272 ⑨ 同一把（第一支 /api/tournament 端點至檔尾）
const TOURN_ANCHOR_SHA256 = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40'; // 與 test-v6278 I1／test-v6283 D1 同一把（TEVENTS 錨點至檔尾）
await T('A1 ⚠⚠ 錦標賽區塊逐位元未動（兩把既有 sha256 都相同；friends 區塊整段在它之前）', () => {
  const first = PATCH.indexOf("app.get('/api/tournament");   // 與 test-v6272 tournTail 同一個錨點
  assert.ok(first > 0, '找不到第一支 /api/tournament 端點');
  assert.strictEqual(createHash('sha256').update(PATCH.slice(first), 'utf8').digest('hex'), TOURN_TAIL_SHA256, '⚠⚠ 錦標賽區塊（第一支端點至檔尾）被動到了');
  const k = PATCH.indexOf("const TEVENTS = db.collection('tournamentEvents');");
  assert.strictEqual(createHash('sha256').update(PATCH.slice(k), 'utf8').digest('hex'), TOURN_ANCHOR_SHA256, '⚠⚠ 錦標賽區塊（TEVENTS 錨點至檔尾）被動到了');
  assert.ok(PATCH.indexOf(FR_END) < first, 'friends 區塊必須整段在錦標賽區塊之前');
  assert.notStrictEqual(createHash('sha256').update(PATCH.slice(first) + ' ', 'utf8').digest('hex'), TOURN_TAIL_SHA256, '掃描器自驗');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【1】admin.html 好友開關 UI（DOM／行為層；兩端接線）');
function fnSrc(src, anchor) {
  const i = src.indexOf(anchor);
  if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  let d = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    const c = src[k];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new assert.AssertionError({ message: '括號沒配對：' + anchor });
}
function blockSrc(src, anchor, endMark) {
  const i = src.indexOf(anchor); if (i < 0) throw new assert.AssertionError({ message: '找不到錨點：' + anchor });
  const j = src.indexOf(endMark, i); if (j < 0) throw new assert.AssertionError({ message: '找不到結尾：' + endMark });
  return src.slice(i, j + endMark.length);
}
/** 把 admin.html 的 loadMonitor／monSetFriends 抽出來、用假 api()／假 document 真的跑。 */
function adminHarness(admin, opts) {
  const o = opts || {};
  const parts = [
    'const window = { monHours: 24, SITE_VERSION_HINT: "0.0" };',
    fnSrc(admin, 'function escapeHtml(s) {'),
    blockSrc(admin, 'const MON_REASON_INFO = {', '\n};\n'),
    fnSrc(admin, 'function monReasonInfo(reason) {'),
    fnSrc(admin, 'function monMs(v) {'),
    fnSrc(admin, 'function monStat(st, key) {'),
    fnSrc(admin, 'function monPerfCells(r) {'),
    fnSrc(admin, 'function monStaleBadge(r) {'),
    fnSrc(admin, 'function monSampleBlock(dg) {'),
    fnSrc(admin, 'function monCasualBlock(cg) {'),
    fnSrc(admin, 'window.verLE = function (a, b) {') + ';',
    'const verLE = window.verLE;',
  ].join('\n');
  const src = [
    'const __el = { innerHTML: "" }; const __calls = []; const __alerts = []; let __confirm = true;',
    'const document = { getElementById: (id) => (id === "tab-monitor" ? __el : null) };',
    'const alert = (m) => __alerts.push(m); const confirm = () => __confirm;',
    'let __resp = {};',
    'async function api(u, options) { __calls.push({ url: u, method: (options && options.method) || "GET", body: options && options.body }); const k = Object.keys(__resp).find((x) => u.includes(x)); return k ? __resp[k] : { error: "404" }; }',
    parts,
    fnSrc(admin, 'async function loadMonitor() {'),
    fnSrc(admin, 'window.monSetFriends = async function (enabled, btn) {') + ';',
    'return { loadMonitor, monSetFriends: window.monSetFriends, html: () => __el.innerHTML, calls: () => __calls.slice(), alerts: () => __alerts.slice(),',
    '  setResp: (r) => { __resp = r; }, setConfirm: (v) => { __confirm = v; } };',
  ].join('\n');
  return new Function(src)();
}
const BASE_RESP = { longpoll: { config: {} }, redact: { enabled: false }, 'clientdiag?hours': { hours: 24, byReason: [], rows: [] }, 'clientdiag?mode=casual': { hours: 24, byReason: [], rows: [] } };
await T('1a ⭐⭐ admin 📡 分頁：loadMonitor 真的多打一發 GET /api/friends/admin/config，且渲染出 #mon-friends（已啟用／關閉／讀不到 三態都畫得出來）', async () => {
  for (const [why, fc, expectTxt] of [['已啟用', { enabled: true, friendsApi: 1, maxFriends: 100 }, '已啟用'], ['關閉', { enabled: false, friendsApi: 1, maxFriends: 100 }, '關閉'], ['舊伺服器 404', null, '讀不到']]) {
    const h = adminHarness(ADMIN);
    h.setResp(Object.assign({}, BASE_RESP, fc ? { 'friends/admin/config': fc } : {}));
    await h.loadMonitor();
    const gets = h.calls().filter((c) => c.url === '/api/friends/admin/config' && c.method === 'GET');
    assert.strictEqual(gets.length, 1, why + '：loadMonitor 沒有打 GET /api/friends/admin/config（打了：' + h.calls().map((c) => c.url).join(',') + '）');
    const $ = cheerio.load(h.html());
    assert.strictEqual($('#mon-friends').length, 1, why + '：渲染結果裡沒有 #mon-friends 區塊');
    assert.ok($('#mon-friends-state').text().includes(expectTxt), why + '：狀態字樣不對：' + $('#mon-friends-state').text());
    const btns = $('#mon-friends button');
    if (fc) { assert.strictEqual(btns.length, 2, why + '：應有「啟用／關閉」兩顆按鈕'); assert.ok(btns.toArray().every((b) => /monSetFriends\((true|false), this\)/.test($(b).attr('onclick') || '')), why + '：按鈕沒接 monSetFriends'); }
    else assert.strictEqual(btns.length, 0, '讀不到時不該畫按鈕（按了也沒用）');
  }
});
await T('1b ⭐⭐ monSetFriends(true/false) 真的 POST /api/friends/admin/config、body 只有 {enabled}、成功後重讀；失敗時 alert 且按鈕文字還原；true 走 confirm（取消 ⇒ 零請求）', async () => {
  const h = adminHarness(ADMIN);
  h.setResp(Object.assign({}, BASE_RESP, { 'friends/admin/config': { ok: true, enabled: true, friendsApi: 1 } }));
  const btn = { textContent: '啟用好友功能', disabled: false };
  await h.monSetFriends(true, btn);
  const posts = h.calls().filter((c) => c.method === 'POST');
  assert.strictEqual(posts.length, 1, 'POST 次數'); assert.strictEqual(posts[0].url, '/api/friends/admin/config', '打錯端點：' + posts[0].url);
  assert.deepStrictEqual(JSON.parse(posts[0].body), { enabled: true }, 'body 形狀');
  assert.ok(h.calls().some((c) => c.method === 'GET' && c.url === '/api/friends/admin/config'), '成功後沒有重讀（loadMonitor）');
  await h.monSetFriends(false, btn);
  assert.deepStrictEqual(JSON.parse(h.calls().filter((c) => c.method === 'POST')[1].body), { enabled: false });
  // 失敗路徑
  const h2 = adminHarness(ADMIN); h2.setResp(BASE_RESP);
  const btn2 = { textContent: '關閉', disabled: false };
  await h2.monSetFriends(false, btn2);
  assert.strictEqual(h2.alerts().length, 1, '失敗要 alert'); assert.strictEqual(btn2.disabled, false); assert.strictEqual(btn2.textContent, '關閉', '按鈕文字沒還原');
  // confirm 取消
  const h3 = adminHarness(ADMIN); h3.setResp(BASE_RESP); h3.setConfirm(false);
  await h3.monSetFriends(true, { textContent: 'x' });
  assert.strictEqual(h3.calls().length, 0, '取消 confirm 後不可發任何請求');
});
await T('1c ⭐⭐⭐ 兩端接線：把 admin UI 送出的 (method,path,body) 原封餵進伺服器區塊 ⇒ 開關真的從 false 變 true 再變 false；非 admin ⇒ 403 且開關不動', async () => {
  const h = adminHarness(ADMIN);
  h.setResp(Object.assign({}, BASE_RESP, { 'friends/admin/config': { ok: true, enabled: true, friendsApi: 1 } }));
  await h.monSetFriends(true, { textContent: 'x' }); await h.monSetFriends(false, { textContent: 'x' });
  const sent = h.calls().filter((c) => c.method === 'POST');
  const seed = seedBase(); seed.tournamentConfig = [];   // 開關文件不存在 ⇒ 預設關
  const S = buildFriends(FR, { seed });
  const admin = asUser({ uid: 'fAd', email: 'admin@example.com', name: '管理員' });
  let g = await S.call('get', sent[0].url, admin); assert.strictEqual(g.code, 200); assert.strictEqual(g.body.enabled, false, '初始應為關');
  let r = await S.call('post', sent[0].url, admin, JSON.parse(sent[0].body)); assert.strictEqual(r.code, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.enabled, true);
  const lst = await S.call('get', '/api/friends/list', asUser(U.A)); assert.strictEqual(lst.code, 200, '開了之後玩家端點應可用：' + JSON.stringify(lst.body));
  r = await S.call('post', sent[1].url, admin, JSON.parse(sent[1].body)); assert.strictEqual(r.body.enabled, false);
  const lst2 = await S.call('get', '/api/friends/list', asUser(U.A)); assert.strictEqual(lst2.code, 503, '關了之後應 503');
  const bad = await S.call('post', sent[0].url, asUser(U.A), { enabled: true }); assert.strictEqual(bad.code, 403);
  g = await S.call('get', sent[0].url, admin); assert.strictEqual(g.body.enabled, false, '非 admin 的 POST 不可改到開關');
});
await T('1d admin 那一發經過 _ok() 包裝（舊伺服器 404 不會被當成「關閉」）；SITE_VERSION_HINT 與 version.ts 一致（不 pin 版本）', () => {
  const lm = fnSrc(ADMIN, 'async function loadMonitor() {');
  assert.ok(/fc = _ok\(_r\[6\]\)/.test(lm), 'fc 沒經過 _ok()');
  const V = /VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(ADMIN)[1];
  assert.strictEqual(H, V, 'hint ' + H + ' ≠ version.ts ' + V);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【2】nick 冒名：偽造 seat.email ＋ /api/match-result enrich 段實跑 ⇒ 改不動別人的 nick');
const extractSanitize = () => {
  const i = PATCH.indexOf('const DECK_ID_RE = '); const j = PATCH.indexOf('function sanitizeDeckId(', i);
  let d = 0, k = PATCH.indexOf('{', j);
  for (; k < PATCH.length; k++) { if (PATCH[k] === '{') d++; else if (PATCH[k] === '}') { d--; if (!d) break; } }
  return new Function(PATCH.slice(i, k + 1) + '\nreturn sanitizeDeckId;')();
};
/** 完整模擬攻擊：攻擊者在「自己的房」把 seats[1].email 填成受害者，然後 POST /api/match-result（沒有任何身分驗證）帶任意 p2.name。 */
async function runImpersonation(frSrc, idbSrc, enrichSrc) {
  const seed = seedBase();
  seed.friendships = [mkRow('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'accepted', nickA: '愛麗絲', nickB: '鮑伯' })];
  seed.playerIdentity = [{ _id: 'bob@example.com', uid: 'o-bob', uids: [{ uid: 'o-bob', at: 1 }], nick: '鮑伯' }];
  seed.rooms.push({ _id: 'EVIL', status: 'ended', seats: [{ uid: 'o-evil', email: 'evil@example.com', name: '攻擊者' }, { uid: 'o-evil2', email: 'bob@example.com', name: '被冒名的鮑伯' }] });
  const H = buildFriends(frSrc, { seed });
  const RPI = new Function('"use strict";\n' + idbSrc + '\nreturn recordPlayerIdentity;')();
  const doc = { roomCode: 'EVIL', p1: { email: null, name: '攻擊者' }, p2: { email: null, name: '★冒名字串★' } };
  await new Function('db', 'doc', 'sanitizeDeckId', 'recordPlayerIdentity', '"use strict"; return (async () => {\n' + enrichSrc + '\n})();')(H.db, doc, extractSanitize(), RPI);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  const la = await H.call('get', '/api/friends/list', asUser(U.A));
  return { H, la, idn: H.db.snapshot('playerIdentity').find((x) => x._id === 'bob@example.com') };
}
await T('2a ⭐⭐⭐ 攻擊後 A 的好友名單裡 bob 的 nick 仍是 friendships 快照（不是攻擊者送的字串）；playerIdentity 沒有落地新 nick', async () => {
  const { la, idn } = await runImpersonation(FR, IDB, ENRICH);
  assert.strictEqual(la.code, 200);
  const bob = la.body.friends[0];
  assert.strictEqual(bob.nick, '鮑伯', 'nick 被冒名改掉了：' + JSON.stringify(la.body.friends));
  assert.ok(!JSON.stringify(la.body).includes('冒名字串'), '回應裡出現攻擊者送的字串');
  assert.strictEqual(idn.nick, '鮑伯', 'playerIdentity.nick 被 match-result 路徑改寫（應不再寫 nick）');
});
await T('2b ⭐ 正對照（history-free）：把 _frPublic 與 recordPlayerIdentity 改回 v6.285 寫法 ⇒ 2a 必紅（證明攻擊在 BASE 真的成立）', async () => {
  const FRb = mutate(FR, "nick: _frNick(otherNick) || '玩家',", "nick: _frNick(idn && idn.nick) || _frNick(otherNick) || '玩家',");
  const FRb2 = mutate(FRb, "{ projection: { _id: 1, uid: 1, uids: 1 } }", "{ projection: { _id: 1, uid: 1, uids: 1, nick: 1 } }");
  const IDBb = mutate(IDB, "const $set = { uid, uidAt: now, updatedAt: now };   // v1.37：不再寫 nick（理由見上）",
    "const nick = (Array.isArray(_namesIgnored) && typeof _namesIgnored[i] === 'string' && _namesIgnored[i].trim()) ? _namesIgnored[i].trim().slice(0, 40) : null;\n          const $set = { uid, uidAt: now, updatedAt: now };\n          if (nick) $set.nick = nick;");
  await mutantMustBreak('BASE 寫法', async () => {
    const { la } = await runImpersonation(FRb2, IDBb, ENRICH);
    assert.strictEqual(la.body.friends[0].nick, '鮑伯', 'nick 被冒名改掉了');
  }, 'nick 被冒名改掉了');
});
await T('2c uid／uids 仍回（大廳「好友的房」提示用；⚠ 來源同一條未驗證路徑，只能當提示）；{email} 入口不再拿 playerIdentity.nick、Auth displayName 等於 email 前綴時也不用', async () => {
  const { la } = await runImpersonation(FR, IDB, ENRICH);
  assert.strictEqual(la.body.friends[0].uid, 'o-evil2', '攻擊後 uid 會被改（這是已知、明講的限制）—— 但欄位要在');
  assert.deepStrictEqual(la.body.friends[0].uids, ['o-bob', 'o-evil2']);
  // {email} 入口
  const seed = seedBase(); seed.playerIdentity = [{ _id: 'known@example.com', uid: 'o-k', nick: '★被竄改的暱稱★' }];
  const TADMIN = { apps: [1], auth: () => ({ getUserByEmail: async (e) => { if (e === 'pref@example.com') return { uid: 'x', displayName: 'pref' }; if (e === 'nice@example.com') return { uid: 'y', displayName: '好人' }; const err = new Error('no user'); err.code = 'auth/user-not-found'; throw err; } }) };
  const H = buildFriends(FR, { seed, TADMIN });
  let r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'known@example.com' }); assert.strictEqual(r.code, 200, JSON.stringify(r.body));
  let d = H.db.snapshot('friendships').find((x) => x.b === 'known@example.com'); assert.strictEqual(d.nickB, null, '{email} 入口不得拿 playerIdentity.nick：' + d.nickB);
  r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'pref@example.com' }); assert.strictEqual(r.code, 200);
  d = H.db.snapshot('friendships').find((x) => x.b === 'pref@example.com'); assert.strictEqual(d.nickB, null, 'displayName＝email 前綴＝半個 email，不得當快照');
  r = await H.call('post', '/api/friends/request', asUser(U.A), { email: 'nice@example.com' }); assert.strictEqual(r.code, 200);
  d = H.db.snapshot('friendships').find((x) => x.b === 'nice@example.com'); assert.strictEqual(d.nickB, '好人', 'Auth displayName 是可信來源，照用');
  const l = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.deepStrictEqual(l.body.outgoing.map((x) => x.nick).sort(), ['好人', '玩家', '玩家']);
});
await T('2d /api/match-result 路徑查證：沒有任何 tournIdentity／requireFirebaseAdmin／Bearer 驗證（只有 IP 限流＋形狀檢查）⇒ 這條路徑寫進 playerIdentity 的東西一律當不可信', () => {
  const i = PATCH.indexOf("app.post('/api/match-result'"); assert.ok(i > 0);
  const j = PATCH.indexOf('\n    app.', i + 10); const body = PATCH.slice(i, j);
  assert.ok(body.length > 2000 && body.includes('mrRateLimitCheck') && body.includes('mrValidateRecord'), '抽錯 handler');
  assert.ok(!/tournIdentity|requireFirebaseAdmin|verifyIdToken|authorization/i.test(stripJs(body)), '如果哪天 match-result 加了身分驗證，這條守衛（與 recordPlayerIdentity 的註解）要一起改');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【3】【5】冷卻：rejected 列不可 remove；兩步攻擊實跑；冷卻只擋被拒方');
/** B 拒絕 A 之後的狀態（用真流程建：A 邀 → B 拒）。 */
async function afterReject(frSrc) {
  const H = buildFriends(frSrc, { seed: seedBase() });
  const r1 = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' }); assert.strictEqual(r1.code, 200);
  const fid = r1.body.fid;
  const lb = await H.call('get', '/api/friends/list', asUser(U.B));
  const rj = await H.call('post', '/api/friends/reject', asUser(U.B), { fid: lb.body.incoming[0].fid }); assert.strictEqual(rj.code, 200);
  return { H, fid };
}
await T('3a ⭐⭐ 兩步攻擊①：被拒方 A 拿 request 回應裡的 fid 打 remove ⇒ 409 friends-not-removable、rejected 列仍在；接著 request ⇒ 仍 429', async () => {
  const { H, fid } = await afterReject(FR);
  const rm = await H.call('post', '/api/friends/remove', asUser(U.A), { fid });
  assert.strictEqual(rm.code, 409, 'remove 應 409：' + JSON.stringify(rm.body)); assert.strictEqual(rm.body.code, 'friends-not-removable');
  assert.strictEqual(H.db.snapshot('friendships').length, 1, 'rejected 列被刪了'); assert.strictEqual(H.db.snapshot('friendships')[0].status, 'rejected');
  const again = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  assert.strictEqual(again.code, 429, '冷卻被繞過：' + JSON.stringify(again.body)); assert.strictEqual(again.body.code, 'friends-cooldown');
  assert.ok(!H.db._log.some((x) => x.op === 'deleteOne'), '不可有任何 deleteOne');
  // 冷卻已過 ⇒ remove 放行（真刪除；那時本來就可以重送）
  H.db._store.get('friendships').get('alice@example.com|bob@example.com').rejectedAt = Date.now() - 25 * 3600 * 1000;
  const rm2 = await H.call('post', '/api/friends/remove', asUser(U.A), { fid });
  assert.strictEqual(rm2.code, 200, '冷卻已過的 rejected 列應可 remove：' + JSON.stringify(rm2.body)); assert.strictEqual(H.db.snapshot('friendships').length, 0, '冷卻已過 remove 應真刪除');
});
await T('3b ⭐⭐ 兩步攻擊②：被拒方 A block（fid）再 unblock ⇒ 列還原成 rejected（rejectedAt 保留、不刪）⇒ request 仍 429；拒絕方 B 這時也不受影響', async () => {
  const { H, fid } = await afterReject(FR);
  const bl = await H.call('post', '/api/friends/block', asUser(U.A), { fid }); assert.strictEqual(bl.code, 200); assert.strictEqual(bl.body.status, 'blocked');
  const ub = await H.call('post', '/api/friends/unblock', asUser(U.A), { fid }); assert.strictEqual(ub.code, 200);
  const rows = H.db.snapshot('friendships');
  assert.strictEqual(rows.length, 1, 'unblock 在冷卻期內不可刪列'); assert.strictEqual(rows[0].status, 'rejected'); assert.strictEqual(typeof rows[0].rejectedAt, 'number'); assert.strictEqual(rows[0].requester, 'alice@example.com');
  const again = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' });
  assert.strictEqual(again.code, 429, '冷卻被 block→unblock 繞過：' + JSON.stringify(again.body));
  // 也用 roomCode 入口 block（不靠 fid）再 unblock
  const bl2 = await H.call('post', '/api/friends/block', asUser(U.A), { roomCode: 'AB12' }); assert.strictEqual(bl2.code, 200, JSON.stringify(bl2.body));
  await H.call('post', '/api/friends/unblock', asUser(U.A), { fid: bl2.body.fid });
  assert.strictEqual(H.db.snapshot('friendships')[0].status, 'rejected');
  assert.strictEqual((await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' })).code, 429);
  // B（拒絕方）側：B block（roomCode）→ unblock ⇒ 列還原 rejected、requester **仍是 A**（不是解封者）、rejectedAt 保留；A 仍 429、B 仍可邀回
  const rowBefore = H.db.snapshot('friendships')[0];
  const blB = await H.call('post', '/api/friends/block', asUser(U.B), { roomCode: 'AB12' }); assert.strictEqual(blB.code, 200, JSON.stringify(blB.body));
  assert.strictEqual((await H.call('post', '/api/friends/unblock', asUser(U.B), { fid: blB.body.fid })).code, 200);
  const rowAfter = H.db.snapshot('friendships')[0];
  assert.strictEqual(rowAfter.status, 'rejected'); assert.strictEqual(rowAfter.requester, 'alice@example.com', 'unblock 還原後 requester 被改成解封者：' + rowAfter.requester);
  assert.strictEqual(rowAfter.rejectedAt, rowBefore.rejectedAt, 'rejectedAt 被動了'); assert.strictEqual(rowAfter.blockedBy, null);
  assert.strictEqual((await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' })).code, 429, 'B 側 block→unblock 後 A 仍應 429');
  // 冷卻過期後 unblock ⇒ 照舊真刪除
  H.db._store.get('friendships').get('alice@example.com|bob@example.com').rejectedAt = Date.now() - 25 * 3600 * 1000;
  const bl3 = await H.call('post', '/api/friends/block', asUser(U.A), { roomCode: 'AB12' });
  await H.call('post', '/api/friends/unblock', asUser(U.A), { fid: bl3.body.fid });
  assert.strictEqual(H.db.snapshot('friendships').length, 0, '冷卻已過 ⇒ unblock 應真刪除');
});
await T('5a ⭐ 冷卻方向：B（拒絕方）自己邀回去 ⇒ 200 pending 且 requester 換成 B；A（被拒方）⇒ 429；B 的新邀請被 A accept ⇒ accepted', async () => {
  const { H } = await afterReject(FR);
  const a = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' }); assert.strictEqual(a.code, 429, '被拒方應 429');
  const b = await H.call('post', '/api/friends/request', asUser(U.B), { roomCode: 'AB12' });
  assert.strictEqual(b.code, 200, '拒絕方自己邀回去應放行：' + JSON.stringify(b.body)); assert.strictEqual(b.body.status, 'pending');
  const row = H.db.snapshot('friendships')[0]; assert.strictEqual(row.status, 'pending'); assert.strictEqual(row.requester, 'bob@example.com');
  const la = await H.call('get', '/api/friends/list', asUser(U.A)); assert.strictEqual(la.body.incoming.length, 1);
  const ac = await H.call('post', '/api/friends/accept', asUser(U.A), { fid: la.body.incoming[0].fid }); assert.strictEqual(ac.code, 200); assert.strictEqual(ac.body.status, 'accepted');
  // 【2】之後 nickA/nickB 是唯一暱稱來源 ⇒ accept 必須把驗過的暱稱寫到**自己那一邊**（a=alice ⇒ nickA），另一邊不動
  const fin = H.db.snapshot('friendships')[0];
  assert.strictEqual(fin.nickA, '愛麗絲', 'accept 沒把驗過的暱稱寫到自己那一邊（nickA）：' + JSON.stringify(fin));
  assert.strictEqual(fin.nickB, '鮑伯', 'accept 動到了對方那一邊（nickB）：' + JSON.stringify(fin));
  const lb2 = await H.call('get', '/api/friends/list', asUser(U.B)); assert.strictEqual(lb2.body.friends[0].nick, '愛麗絲', 'B 看到的 A 暱稱應是 A 驗過的暱稱');
  const la2 = await H.call('get', '/api/friends/list', asUser(U.A)); assert.strictEqual(la2.body.friends[0].nick, '鮑伯');
});
await T('5b 冷卻對被拒方仍完整：24 小時內 429、過期後 200（重用同一列）；rejected 列 list 不回、accept/reject 對它 409', async () => {
  const { H, fid } = await afterReject(FR);
  const la = await H.call('get', '/api/friends/list', asUser(U.A)); assert.strictEqual(la.body.outgoing.length + la.body.incoming.length + la.body.friends.length, 0, 'rejected 不該出現在 list');
  assert.strictEqual((await H.call('post', '/api/friends/accept', asUser(U.B), { fid })).code, 409);
  assert.strictEqual((await H.call('post', '/api/friends/reject', asUser(U.B), { fid })).code, 409);
  H.db._store.get('friendships').get('alice@example.com|bob@example.com').rejectedAt = Date.now() - 25 * 3600 * 1000;
  const ok = await H.call('post', '/api/friends/request', asUser(U.A), { roomCode: 'AB12' }); assert.strictEqual(ok.code, 200); assert.strictEqual(ok.body.status, 'pending');
  assert.strictEqual(H.db.snapshot('friendships').length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【4】500 路徑不含 email');
const E11000 = 'E11000 duplicate key error collection: ptcg.friendships index: _id_ dup key: { _id: "alice@example.com|bob@example.com" }';
await T('4a ⭐⭐ 七支端點：friendships 任何操作丟 E11000（訊息帶兩個 email）⇒ 500、code=friends-error、序列化掃不到 `@` 也掃不到 local-part；原文進伺服器 log（不是吞掉）', async () => {
  for (const [m, p] of ALL_EPS) {
    const seed = seedBase();
    seed.friendships = [mkRow('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'pending' })];
    const inner = makeFakeDb(seed);
    const boom = () => { throw new Error(E11000); };
    const db = { _store: inner._store, _log: inner._log, snapshot: (n) => inner.snapshot(n), collection: (n) => (n === 'friendships'
      ? { createIndex: () => Promise.reject(new Error(E11000)), findOne: boom, find: boom, countDocuments: boom, updateOne: boom, replaceOne: boom, deleteOne: boom }
      : inner.collection(n)) };
    const H = buildFriends(FR, { db });
    const r = await H.call(m, p, asUser(U.A), { roomCode: 'AB12', fid: seed.friendships[0].fid, email: 'bob@example.com' });
    assert.strictEqual(r.code, 500, p + ' 應 500：' + JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'friends-error', p);
    assert.deepStrictEqual(findEmails(r.body), [], p + ' 回應含 email：' + JSON.stringify(r.body));
    const s = JSON.stringify(r.body);
    for (const lp of ['alice', 'bob', 'E11000', 'dup key']) assert.ok(!s.includes(lp), p + ' 回應洩漏「' + lp + '」：' + s);
    assert.ok(H.logs.some((l) => l.includes('E11000') && l.includes('[friends]')), p + ' 原始錯誤沒進伺服器 log');
  }
});
await T('4b admin 兩支：tournamentConfig 操作丟例外 ⇒ 500 固定文案、不含原始訊息', async () => {
  const seed = seedBase();
  const H = buildFriends(FR, { seed, dbOpts: { throwOn: (name, op) => name === 'tournamentConfig' && op === 'updateOne' } });
  const admin = asUser({ uid: 'fAd', email: 'admin@example.com', name: '管理員' });
  const r = await H.call('post', '/api/friends/admin/config', admin, { enabled: true });
  assert.strictEqual(r.code, 500); assert.ok(!String(r.body.error).includes('db down'), '原始訊息外洩：' + r.body.error); assert.strictEqual(r.body.code, 'friends-error');
  const src = stripJs(FR);
  assert.strictEqual((src.match(/res\.status\(500\)/g) || []).length, 1, '區塊內 500 出口必須只有 _frFail 一處');
  assert.ok(!/status\(500\)\.json\(\{ error: e\.message/.test(src), '仍有回原始 e.message 的 500');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【6】設定 modal 的 ✕：sticky dock（CSS 級聯 ＋ DOM 量測）');
const CSS = extractCss(GAME);
const DOCK_SEL = '.zoom-modal.settings-modal > .settings-close-dock';
function dockRules(css) {
  const out = []; const re = /\.zoom-modal\.settings-modal > \.settings-close-dock(?: > \.zoom-close)?\{([^}]*)\}/g; let m;
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((m = re.exec(src))) out.push({ sel: m[0].slice(0, m[0].indexOf('{')), body: m[1], pos: m.index });
  return out;
}
/** 不含 dock 的等價版本（＝v6.285 的 markup／CSS）：拿掉 dock 規則、把 ✕ 從 dock 解包。history-free 的 BASE 對照。 */
const cssWithoutDock = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.zoom-modal\.settings-modal > \.settings-close-dock(?: > \.zoom-close)?\{[^}]*\}/g, '');
const markupWithoutDock = (html) => html.replace(/<div class="settings-close-dock">(<button class="zoom-close">✕<\/button>)<\/div>/, '$1');
await T('6a 靜態：dock 規則存在於三個 @media（桌機／手機直式／手機橫式）且 position:sticky、height 0、z-index；selector 只匹配 .settings-modal 底下的 dock；.zoom-close 本身的規則逐字未動且只有一條', () => {
  const rules = dockRules(CSS);
  assert.ok(rules.length >= 6, 'HEAD-FAIL：找不到 v6.286 的 dock 規則（' + rules.length + '）');
  const base = rules.find((r) => r.sel === DOCK_SEL && /position:\s*sticky/.test(r.body));
  assert.ok(base, '桌機 dock 規則缺 position:sticky');
  assert.ok(/top:\s*0\b/.test(base.body) && /height:\s*0\b/.test(base.body) && /z-index:\s*1[1-9]/.test(base.body) && /margin:\s*0 -1\.44rem -\.9rem/.test(base.body), '桌機 dock 規則形狀：' + base.body);
  assert.ok(rules.some((r) => /margin:\s*0 -1rem -\.55rem/.test(r.body)), '手機直式 dock 規則（padding 1rem／gap .55rem）缺');
  assert.ok(rules.some((r) => /margin:\s*0 -0\.5rem -0\.4rem/.test(r.body)), '手機橫式 dock 規則（padding .5rem／gap .4rem）缺');
  assert.ok(rules.some((r) => r.sel.endsWith('> .zoom-close') && /top:\s*calc\(1rem - 1\.44rem\)/.test(r.body)), '桌機 ✕ 的 top 校正缺');
  for (const r of rules) assert.ok(r.sel.startsWith(DOCK_SEL), '新規則 selector 必須以 ' + DOCK_SEL + ' 開頭：' + r.sel);
  // ⚠ CI 沒有 Playwright ⇒ 手機兩組 ✕ 的 top 與 dock 的位置只能靠靜態釘住（審查者突變：橫式 top 2.5rem／直式 top −2rem／dock overflow:hidden／dock 搬到 h3 之後 —— 6a 原本全綠）
  const xRules = rules.filter((r) => r.sel.endsWith('> .zoom-close'));
  assert.strictEqual(xRules.length, 3, '✕ 校正規則應恰三條（桌機／直式／橫式）：' + xRules.length);
  assert.ok(xRules.some((r) => /^\s*top:\s*0;?\s*$/.test(r.body)), '手機直式 ✕ top 應為 0（padding 1rem − 1rem）：' + xRules.map((r) => r.body).join('|'));
  assert.ok(xRules.some((r) => /^\s*top:\s*0?\.5rem;?\s*$/.test(r.body)), '手機橫式 ✕ top 應為 .5rem（貼齊 modal padding）：' + xRules.map((r) => r.body).join('|'));
  for (const r of xRules) assert.ok(!/(?:right|left|bottom|width|height|position|display|overflow)\s*:/.test(r.body), '✕ 校正規則只准動 top：' + r.body);
  for (const r of rules) assert.ok(!/overflow\s*:/.test(r.body) && !/display\s*:\s*none/.test(r.body), 'dock 規則不得有 overflow／display:none（✕ 溢出 dock 的零高度，overflow:hidden 會把它切成 0）：' + r.body);
  // dock 的 @media 歸屬：直式那組在 (max-width: 600px) and (orientation: portrait)、橫式那組在 (max-width: 950px) and (orientation: landscape)
  const mediaOf = (pos) => { const before = CSS.replace(/\/\*[\s\S]*?\*\//g, '').slice(0, pos); const m = before.match(/@media[^{]*\{(?![\s\S]*\n  \}\n)/g); return m ? m[m.length - 1] : ''; };
  const portrait = rules.find((r) => /margin:\s*0 -1rem -\.55rem/.test(r.body)), landscape = rules.find((r) => /margin:\s*0 -0\.5rem -0\.4rem/.test(r.body));
  assert.ok(/max-width: 600px\) and \(orientation: portrait/.test(mediaOf(portrait.pos)), '直式 dock 規則不在手機直式 @media 內：' + mediaOf(portrait.pos));
  assert.ok(/max-width: 950px\) and \(orientation: landscape/.test(mediaOf(landscape.pos)), '橫式 dock 規則不在手機橫式 @media 內：' + mediaOf(landscape.pos));
  const zc = CSS.match(/^\s*\.zoom-close\{[^}]*\}/gm) || [];
  assert.strictEqual(zc.length, 1, '.zoom-close 規則應只有一條'); assert.ok(zc[0].includes('position:absolute; top:1rem; right:1rem;'), '.zoom-close 原規則被動了：' + zc[0].slice(0, 80));
  const mk = settingsMarkup(GAME);
  assert.ok(/<div class="settings-close-dock"><button class="zoom-close">✕<\/button><\/div>/.test(mk), '設定 modal 的 ✕ 沒有包在 dock 裡：' + mk.slice(0, 200));
  // dock 必須是 .settings-modal 的**第一個**子元素（sticky 的 flow 位置＝content 頂；搬到 h3 之後就會從標題底下才開始釘）
  const inner = mk.slice(mk.indexOf('<div class="zoom-modal settings-modal"')); const firstChild = inner.slice(inner.indexOf('>') + 1).trimStart();
  assert.ok(firstChild.startsWith('<div class="settings-close-dock">'), 'dock 不是設定 modal 的第一個子元素：' + firstChild.slice(0, 80));
  const noCmt = GAME.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.strictEqual((noCmt.match(/settings-close-dock/g) || []).length, 1 + rules.length, 'dock class 只准出現在設定 modal 的 markup（1 處）與 dock 的 CSS 規則（' + rules.length + ' 條）');
  // 其他三個 zoom modal 的 ✕ 仍是 modal 的直接子元素（沒有被包進 dock）
  for (const anchor of ['<div class="zoom-modal discard-modal" onclick', '<div class="zoom-modal discard-modal prize-view-modal" onclick', '<div class="zoom-modal" onclick']) {
    const i = GAME.indexOf(anchor); assert.ok(i > 0, '找不到 ' + anchor);
    const seg = GAME.slice(i, GAME.indexOf('</div>', i));
    assert.ok(seg.includes('<button class="zoom-close"') && !seg.includes('settings-close-dock'), anchor + ' 的 ✕ 被動到了');
  }
});
let chromium = null;
try { chromium = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium; } catch { chromium = null; }
const VP7 = VIEWPORTS.concat([{ w: 812, h: 375, mobile: true }, { w: 667, h: 375, mobile: true }]);   // 五種既有 ＋ 兩種手機橫式（審查者指出橫式 modal 蓋滿 overlay）
if (!chromium) {
  skipped.push('【6】DOM 量測（沒有 playwright 模組）');
  console.log('  ⚠⚠ SKIP 【6-DOM】：這台機器沒有 Playwright，DOM 量測沒有跑（核心由 6a 的 CSS 級聯守；沙盒證據見 docs/changelog-internal.md v6.286）');
} else {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
  try {
    const R = (o) => [o.x, o.y, o.w, o.h].map((v) => +v.toFixed(1)).join(',');
    const mkH = settingsMarkup(GAME), mkB = markupWithoutDock(mkH), cssB = cssWithoutDock(CSS);
    const unwrapOk = () => { assert.notStrictEqual(mkH, mkB, 'HEAD-FAIL：解包器沒動到東西（markup 沒有 dock）'); assert.notStrictEqual(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), cssB, 'HEAD-FAIL：解包器沒動到東西（css 沒有 dock 規則）'); };
    const probeSettings = async (pg, css, html) => { await pg.setContent(pageHtml(css, html), { waitUntil: 'load' }); return pg.evaluate(() => {
      const m = document.querySelector('.settings-modal'); for (const d of m.querySelectorAll('details')) d.open = true;
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const x = m.querySelector('.zoom-close'); const secs = [...m.querySelectorAll('details.settings-section')].map((d) => rect(d));
      const c0 = rect(x), t0 = rect(m.querySelector('.settings-title')), mr = rect(m);
      m.scrollTop = 1e6; const st = m.scrollTop; const c1 = rect(x);
      const hit = document.elementFromPoint(c1.x + c1.w / 2, c1.y + c1.h / 2);
      m.scrollTop = 0;
      return { mr, c0, t0, secs, st, c1, hit: hit ? hit.className : null };
    }); };
    await T('6b ⭐⭐ 七種尺寸（五種既有＋兩種手機橫式）：scrollTop=0 時 ✕／標題／每個 section 的 rect 與「無 dock 版」全等（零位移）；捲到底後 ✕ 仍在畫面內、在 modal 內、elementFromPoint 命中 ✕（無 dock 版 ✕ 被捲出畫面＝正對照）', async () => {
      unwrapOk();
      for (const vp of VP7) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
        const pg = await ctx.newPage();
        const b = await probeSettings(pg, cssB, mkB), h = await probeSettings(pg, CSS, mkH);
        const key = vp.w + '×' + vp.h + (vp.mobile ? (vp.w > vp.h ? ' 手機橫式' : ' 手機直式') : ' 桌機');
        assert.ok(h.st > 0, key + '：設定 modal 沒有捲動量（fixture 壞了？）');
        assert.strictEqual(R(h.c0), R(b.c0), key + '：scrollTop=0 的 ✕ 位移：' + R(b.c0) + ' → ' + R(h.c0));
        assert.strictEqual(R(h.t0), R(b.t0), key + '：標題位移'); assert.strictEqual(h.secs.map(R).join('|'), b.secs.map(R).join('|'), key + '：section 位移');
        const inView = (c) => c.y >= 0 && c.y + c.h <= vp.h && c.x >= 0 && c.x + c.w <= vp.w;
        assert.ok(!inView(b.c1), key + '：正對照失效 —— 無 dock 版捲到底 ✕ 竟然還在畫面內 ' + R(b.c1));
        assert.ok(inView(h.c1), key + '：捲到底 ✕ 不在畫面內 ' + R(h.c1));
        assert.ok(h.c1.y >= h.mr.y && h.c1.y + h.c1.h <= h.mr.y + h.mr.h, key + '：捲到底 ✕ 不在 modal 內');
        assert.strictEqual(h.hit, 'zoom-close', key + '：捲到底後 ✕ 中心點被別的元素蓋住：' + h.hit);
        console.log('      ' + key.padEnd(18) + ' ✕ scrollTop=0 ' + R(h.c0) + '（無 dock 版 ' + R(b.c0) + '）｜捲到底 scrollTop=' + h.st + ' ✕ ' + R(h.c1) + '（無 dock 版 ' + R(b.c1) + ' 出界）｜命中=' + h.hit);
        await ctx.close();
      }
    });
    await T('6c ⭐⭐ 其他三個 zoom modal（discard／prize-view／zoom）× 七種尺寸：完整 CSS vs 無 dock CSS，**同一份 markup**，全部元素 rect 全等（含 ✕ 的 rect）', async () => {
      unwrapOk();
      for (const [name, html] of Object.entries(zoomModalFixtures())) for (const vp of VP7) {
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
        const pg = await ctx.newPage();
        const probe = async (css) => { await pg.setContent(pageHtml(css, html), { waitUntil: 'load' }); return pg.evaluate(() => { const o = {}; for (const el of document.querySelectorAll('[id]')) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); o[el.id] = [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(2)).join(',') + '|' + cs.position + '|' + cs.overflowY; } return o; }); };
        const b = await probe(cssB), h = await probe(CSS);
        const ids = Object.keys(b); assert.ok(ids.length >= 18, name + '：fixture 元素太少');
        const diffs = ids.filter((id) => b[id] !== h[id]);
        assert.deepStrictEqual(diffs, [], name + ' ' + vp.w + '×' + vp.h + ' 有差異：' + diffs.map((d) => d + ' ' + b[d] + ' → ' + h[d]).join('；'));
        assert.strictEqual(b['z-close'], h['z-close'], name + ' ✕ rect 不全等');
        console.log('      ' + (name + ' ' + vp.w + '×' + vp.h).padEnd(20) + ' ✕=' + h['z-close'].split('|')[0] + '  全等（' + ids.length + ' 元素）');
        await ctx.close();
      }
    });
  } finally { await browser.close(); }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【7】八條守衛補強（每一條配自己的突變體，且要紅在預期那一條）');
// 7-1 fid 不是憑證：C 拿 A-B 的 fid 打 accept／reject／remove／block／unblock 一律 404，DB 零寫入
async function assertFidNotCredential(frSrc) {
  const seed = seedBase();
  seed.friendships = [mkRow('alice@example.com', 'bob@example.com', 'alice@example.com', { status: 'pending' })];
  const fid = seed.friendships[0].fid;
  for (const p of ['/api/friends/accept', '/api/friends/reject', '/api/friends/remove', '/api/friends/unblock', '/api/friends/block']) {
    const H = buildFriends(frSrc, { seed: structuredClone(seed) });
    const before = JSON.stringify(H.db.snapshot('friendships'));
    const r = await H.call('post', p, asUser(U.C), { fid });
    assert.strictEqual(r.code, 404, 'fid 越權：C 拿 A-B 的 fid 打 ' + p + ' 竟然回 ' + r.code + ' ' + JSON.stringify(r.body));
    assert.strictEqual(JSON.stringify(H.db.snapshot('friendships')), before, 'fid 越權：' + p + ' 改動了 DB');
    assert.ok(!H.db._log.some((x) => ['updateOne', 'replaceOne', 'deleteOne'].includes(x.op)), 'fid 越權：' + p + ' 有寫入操作');
  }
}
await T('7-1 ⭐⭐ fid 不是憑證：外人拿別人的 fid 打五支端點一律 404 且零寫入', () => assertFidNotCredential(FR));
await T('7-1m 突變：_frFindMine 拿掉 $or a/b=me ⇒ 7-1 紅在「fid 越權」', () =>
  mutantMustBreak('findMine 無 $or', () => assertFidNotCredential(mutate(FR, "return await c.findOne({ fid, $or: [{ a: me }, { b: me }] });", "return await c.findOne({ fid });")), 'fid 越權'));

// 7-2 gate 順序：開關關閉時**不得**呼叫 tournIdentity（verifyIdToken 打 Firebase，是最慢的一段）
async function assertGateOrder(frSrc) {
  const seed = seedBase(); seed.tournamentConfig = [{ _id: 'friendsConfig', enabled: false }];
  let n = 0;
  const H = buildFriends(frSrc, { seed, tournIdentity: async () => { n++; return { uid: 'fA', email: 'alice@example.com', name: 'A', verified: true }; } });
  for (const [m, p] of ALL_EPS) { const r = await H.call(m, p, asUser(U.A), { roomCode: 'AB12' }); assert.strictEqual(r.code, 503, p); }
  assert.strictEqual(n, 0, 'gate 順序：開關關閉時仍呼叫了 tournIdentity ' + n + ' 次（白耗 Firebase 驗證）');
}
await T('7-2 ⭐ gate 順序：開關關閉 ⇒ 七支端點 503 且 tournIdentity 零呼叫', () => assertGateOrder(FR));
await T('7-2m 突變：先驗 token 再查開關 ⇒ 7-2 紅在「gate 順序」', () =>
  mutantMustBreak('gate 反序', () => assertGateOrder(mutate(FR,
    "      if (!(await friendsEnabled())) { res.status(503).json({ error: '好友功能尚未開放', code: 'friends-disabled' }); return null; }\n      const me = await _frAuth(req, res);\n      if (!me) return null;",
    "      const me = await _frAuth(req, res);\n      if (!me) return null;\n      if (!(await friendsEnabled())) { res.status(503).json({ error: '好友功能尚未開放', code: 'friends-disabled' }); return null; }")), 'gate 順序'));

// 7-3 開關 TTL：50 發 list 只讀 1 次 tournamentConfig
async function assertCfgTtl(frSrc) {
  const H = buildFriends(frSrc, { seed: seedBase() });
  for (let i = 0; i < 50; i++) { const r = await H.call('get', '/api/friends/list', asUser(U.A)); assert.strictEqual(r.code, 200); }
  const reads = H.db._log.filter((x) => x.name === 'tournamentConfig').length;
  assert.strictEqual(reads, 1, '開關 TTL：50 發 list 讀了 tournamentConfig ' + reads + ' 次（每發都打 DB）');
}
await T('7-3 ⭐ 開關快取：50 發 list 只讀 tournamentConfig 1 次', () => assertCfgTtl(FR));
await T('7-3m 突變：TTL 10s → 0 ⇒ 7-3 紅在「開關 TTL」', () =>
  mutantMustBreak('TTL=0', () => assertCfgTtl(mutate(FR, 'const FR_CFG_TTL_MS = 10000;', 'const FR_CFG_TTL_MS = 0;')), '開關 TTL'));

// 7-4 半個 email：nick 沒快照、對照表也沒有 ⇒ 一律「玩家」；回應掃 local-part
async function assertNoHalfEmail(frSrc) {
  const seed = seedBase();
  const emails = ['alice@example.com', 'zed.player@example.com', 'mr_secret.name@corp.example'];
  seed.friendships = [
    mkRow('alice@example.com', 'zed.player@example.com', 'alice@example.com', { status: 'accepted', nickA: null, nickB: null }),
    mkRow('alice@example.com', 'mr_secret.name@corp.example', 'mr_secret.name@corp.example', { status: 'pending', nickA: null, nickB: null }),
  ];
  const H = buildFriends(frSrc, { seed });
  const r = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 200);
  const rows = [...r.body.friends, ...r.body.incoming, ...r.body.outgoing];
  assert.strictEqual(rows.length, 2);
  const s = JSON.stringify(r.body);
  for (const e of emails) { const lp = e.split('@')[0]; assert.ok(!s.includes(lp), '半個 email 外洩：回應含「' + lp + '」：' + s); }
  for (const x of rows) assert.strictEqual(x.nick, '玩家', 'nick fallback 應為「玩家」：' + x.nick);
}
await T('7-4 ⭐ 沒有暱稱快照時 nick 一律「玩家」，回應掃不到任何 email 的 local-part（不只掃完整 x@y）', () => assertNoHalfEmail(FR));
await T('7-4m 突變：nick fallback 改成 otherEmail.split(\'@\')[0] ⇒ 7-4 紅在「半個 email 外洩」', () =>
  mutantMustBreak('半個 email', () => assertNoHalfEmail(mutate(FR, "nick: _frNick(otherNick) || '玩家',", "nick: _frNick(otherNick) || otherEmail.split('@')[0],")), '半個 email 外洩'));

// 7-5 createIndex 真的被呼叫（行為端：假 db 記錄）
function assertIndexesCreated(frSrc) {
  const H = buildFriends(frSrc, { seed: seedBase() });
  const idx = H.db._log.filter((x) => x.op === 'createIndex' && x.name === 'friendships').map((x) => JSON.stringify(x.keys));
  assert.ok(idx.includes(JSON.stringify({ a: 1, status: 1 })) && idx.includes(JSON.stringify({ b: 1, status: 1 })), 'createIndex：啟動時沒有建 {a,status}／{b,status} 兩個索引（實際：' + idx.join(' ') + '）');
}
await T('7-5 ⭐ 啟動時真的對 friendships 呼叫 createIndex({a,status})／({b,status})（不是只驗查詢形狀）', () => assertIndexesCreated(FR));
await T('7-5m 突變：刪掉兩行 createIndex ⇒ 7-5 紅在「createIndex」', () =>
  mutantMustBreak('無索引', () => assertIndexesCreated(FR.replace(/\s*db\.collection\(FR_COLL\)\.createIndex\(\{ [ab]: 1, status: 1 \}\)\.catch\(\(\) => \{[^}]*\}\);/g, '')), 'createIndex'));

// 7-6 讓路節拍：500 筆 incoming（超過 FR_LIST_CAP=250 ⇒ 兩個迴圈各 250 筆 ⇒ 各觸發一次 200 筆節拍）
async function assertYieldTicks(frSrc) {
  const seed = seedBase();
  seed.friendships = Array.from({ length: 500 }, (_, i) => mkRow('alice@example.com', 'p' + String(i).padStart(3, '0') + '@example.com', 'p' + String(i).padStart(3, '0') + '@example.com'));
  seed.playerIdentity = Array.from({ length: 500 }, (_, i) => ({ _id: 'p' + String(i).padStart(3, '0') + '@example.com', uid: 'o' + i, uids: [{ uid: 'o' + i, at: i }] }));
  const yc = { ticks: 0 };
  const H = buildFriends(frSrc, { seed, yieldCounter: yc, dbOpts: { ioDelay: true } });
  const r = await H.call('get', '/api/friends/list', asUser(U.A));
  assert.strictEqual(r.code, 200); assert.strictEqual(r.body.truncated, true, '500 筆應被 cap 截斷');
  assert.strictEqual(r.body.incoming.length, 250);
  assert.strictEqual(yc.ticks, 2, '讓路節拍：docs 迴圈與 ident 迴圈各應讓路 1 次（250 筆過 200），實得 ' + yc.ticks);
}
await T('7-6 ⭐ 讓路節拍真的會觸發：500 筆 incoming ⇒ 兩個迴圈各讓路一次（G1 的 130 筆永遠觸發不到）', () => assertYieldTicks(FR));
await T('7-6m 突變：拿掉 docs 迴圈的 yield ⇒ 7-6 紅；拿掉 ident 迴圈的 yield ⇒ 也紅', async () => {
  await mutantMustBreak('docs 無讓路', () => assertYieldTicks(mutate(FR, "          const y = me.yield(++n); if (y) await y;\n", "          ++n;\n")), '讓路節拍');
  await mutantMustBreak('ident 無讓路', () => assertYieldTicks(mutate(FR, "for await (const d of ic) { ident.set(d._id, d); const y = me.yield(++k); if (y) await y; }", "for await (const d of ic) { ident.set(d._id, d); ++k; }")), '讓路節拍');
});

// 7-7 /friends 頁：匿名／未登入不得發 list（兩道閘：onAuthStateChanged 只在 !isAnonymous 才 load；ctx() 匿名回 null）
function assertFriendsPageAnonGate(src) {
  const s = stripJs(src.slice(src.indexOf('<script'), src.indexOf('</script>')));
  const cb = fnSrc(s, 'onAuthStateChanged(auth, (u) => {');
  assert.ok(/if \(u && !u\.isAnonymous\) void load\(\);/.test(cb), '/friends 頁匿名閘①：onAuthStateChanged 內的 load() 沒有被「u && !u.isAnonymous」守住：' + cb.slice(0, 200));
  const ctx = fnSrc(s, 'async function ctx()');
  assert.ok(/if \(!u \|\| u\.isAnonymous\) return null;/.test(ctx), '/friends 頁匿名閘②：ctx() 沒有對匿名回 null');
  const loads = (s.match(/\bload\(\)/g) || []).length; assert.ok(loads >= 2, '掃描器下限：load() 呼叫太少');
  assert.ok(!/onMount\([\s\S]*?void load\(\)[\s\S]*?\}\);/.test(s.replace(cb, '')), 'onMount 裡在 auth callback 之外直接 load()');
}
await T('7-7 ⭐ /friends 頁：匿名不發 list 的兩道閘都在（onAuthStateChanged 守 isAnonymous；ctx() 匿名回 null）', () => assertFriendsPageAnonGate(FRPAGE));
await T('7-7m 突變：拿掉 isAnonymous 判斷（任一道）⇒ 7-7 紅在對應那道', () => {
  mutantMustBreak('閘①', () => assertFriendsPageAnonGate(mutate(FRPAGE, 'if (u && !u.isAnonymous) void load();', 'if (u) void load();')), '匿名閘①');
  mutantMustBreak('閘②', () => assertFriendsPageAnonGate(mutate(FRPAGE, 'if (!u || u.isAnonymous) return null;', 'if (!u) return null;')), '匿名閘②');
});

// 7-8 ⚠⚠ game/+page.svelte：任何自動觸發的區塊（$effect／$effect.pre／onMount／$derived）內不得發好友請求 —— 大廳每次載入多一發固定請求＝v6.272 Firestore 災難的型態
const FR_API_NET = ['fetchFriendsList', 'requestFriendByEmail', 'requestFriendFromBattle', 'friendsAction', 'addOpponentAsFriend'];
function autoBlocks(src) {
  const s = stripJs(src.slice(src.indexOf('<script'), src.indexOf('</script>')));
  const out = [];
  const re = /\$effect(?:\.pre)?\(|onMount\(|\$derived(?:\.by)?\(/g; let m;
  while ((m = re.exec(s))) {
    let d = 0, k = m.index + m[0].length - 1;
    for (; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (!d) break; } }
    out.push({ kind: m[0], body: s.slice(m.index, k + 1) });
  }
  return { s, out };
}
function assertGameNoAutoFriendsFetch(src) {
  const { s, out } = autoBlocks(src);
  assert.ok(out.length >= 40, '掃描器下限：只抓到 ' + out.length + ' 個自動觸發區塊（$effect／onMount／$derived）');
  assert.ok(!s.includes('/api/friends'), 'game/+page.svelte 出現 /api/friends 字面（好友請求一律走 friends-api.ts 且只由使用者動作觸發）');
  for (const b of out) {
    for (const fn of FR_API_NET) assert.ok(!new RegExp('\\b' + fn + '\\s*\\(').test(b.body), '⚠⚠ 自動觸發區塊 ' + b.kind + ' 內呼叫了 ' + fn + '（大廳每次載入多一發固定請求）：' + b.body.slice(0, 120));
    assert.ok(!/fetch\([^)]*friends/.test(b.body), '⚠⚠ 自動觸發區塊 ' + b.kind + ' 內對 friends 端點 fetch');
  }
  const imp = /import \{([^}]*)\} from '\$lib\/friends\/friends-api'/.exec(s); assert.ok(imp, '找不到 friends-api 的 import');
  const names = imp[1].split(',').map((x) => x.trim().replace(/^type /, '')).filter(Boolean);
  for (const n of names) if (FR_API_NET.includes(n)) { const uses = (s.match(new RegExp('\\b' + n + '\\(', 'g')) || []).length; assert.ok(uses >= 1, n + ' 匯入了卻沒用'); }
}
await T('7-8 ⭐⭐⭐ game/+page.svelte：零 /api/friends 字面；所有 $effect／$effect.pre／onMount／$derived 區塊內零好友請求（只准使用者動作觸發）', () => assertGameNoAutoFriendsFetch(GAME));
await T('7-8m 突變：在某個 $effect 內塞 fetch(\'/api/friends/list\')／fetchFriendsList()／requestFriendFromBattle() ⇒ 7-8 各自紅', () => {
  const i = GAME.indexOf('$effect(() => {'); assert.ok(i > 0, '找不到 $effect');
  const ins = (code) => GAME.slice(0, i + '$effect(() => {'.length) + '\n    ' + code + '\n' + GAME.slice(i + '$effect(() => {'.length);
  mutantMustBreak('fetch 字面', () => assertGameNoAutoFriendsFetch(ins("void fetch(apiBase + '/api/friends/list');")), '/api/friends 字面');
  mutantMustBreak('fetchFriendsList', () => assertGameNoAutoFriendsFetch(ins("void fetchFriendsList(ctx);")), '自動觸發區塊');
  mutantMustBreak('requestFriendFromBattle', () => assertGameNoAutoFriendsFetch(ins("void requestFriendFromBattle(ctx, { roomCode });")), '自動觸發區塊');
  mutantMustBreak('addOpponentAsFriend', () => assertGameNoAutoFriendsFetch(ins("void addOpponentAsFriend();")), '自動觸發區塊');
  const j = GAME.indexOf('onMount(');
  mutantMustBreak('onMount', () => assertGameNoAutoFriendsFetch(GAME.slice(0, j + 'onMount('.length) + "() => { void fetchFriendsList(c); }); onMount(" + GAME.slice(j + 'onMount('.length)), 'onMount(');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【8】test chain');
await T('8a 本守衛在 package.json 的 test chain（只加進 iron-rules-audit 等於沒加）', () => {
  const pk = JSON.parse(readFileSync(P_PKG, 'utf8'));
  assert.ok(pk.scripts.test.includes('node scripts/test-v6286-friends-hardening.mjs'), 'package.json test 沒有本守衛');
});

console.log('\n══ v6.286 好友對抗性審查六修守衛：' + pass + ' PASS / ' + fail + ' FAIL' + (skipped.length ? '；⚠⚠ SKIP ' + skipped.length + ' 段（' + skipped.join('；') + '）—— 這幾段在這台機器上沒有在守' : '') + ' ══');
process.exit(fail ? 1 : 0);
