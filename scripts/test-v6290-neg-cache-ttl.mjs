// v6.290 守衛：好友功能的負向快取 TTL 依快取值分成兩種（src/lib/friends/friends-api.ts）。
//
// 背景（線上實際發生）：站長在 admin 開啟好友功能之前點過一次大廳入口 ⇒ client 記下 `disabled`
//   負向快取（1 小時）⇒ 開啟之後入口按鈕 1 小時內都不出現，畫面上也沒有重試的逃生口。
//   每天數百名玩家在開放前進過站的都會被卡同樣久。
// 站長裁定：
//   ・`disabled`（503 friends-disabled）＝伺服器有端點、只是開關關著 ⇒ 站長隨時會切換 ⇒ **5 分鐘**
//   ・`unsupported`（404／非 JSON）＝伺服器根本沒有端點 ⇒ 不會突然變 ⇒ 維持 **1 小時**
//   ⭐⭐ 判定依「快取值」分流 ⇒ 舊版 client 已寫進 localStorage 的 `disabled` 條目換新版後立刻用 5 分鐘門檻
//      ⇒ 玩家不必手動清快取（本檔 A3 是站長最在意的那一條）。
//
// 守什麼（全部行為端：esbuild 抽模組實跑、假 localStorage、可控 `now`；靜態只用在零 timer 那一條）：
//   【A】A0 兩個常數實際求值（5 分鐘／1 小時；禁比字面量）、舊的共用常數必須不存在；
//        A1 disabled：寫入後 4 分鐘仍藏、6 分鐘重新探測（同一次載入＋重新整理後兩條路徑都要）；
//        A2 unsupported：59 分鐘仍藏、61 分鐘重新探測（兩條路徑）；
//        A3 ⭐⭐ 舊條目自動修復：模擬 v6.289 寫的 `{v:'disabled', at: 10 分鐘前}` ⇒ 新版必須判過期；
//           正對照：同樣 10 分鐘前的 `unsupported` 仍藏、4 分鐘前的 `disabled` 仍藏（證明是依值分流、不是一律忽略）；
//        A4 私聊那條 60 秒負向的既有行為不變（常數求值＋行為端），且不碰好友功能的快取；
//        A5 原始碼仍零 `setInterval`／零 `setTimeout`。
//   【B】突變測試（只捕 AssertionError，且要紅在預期那一條）：兩種 TTL 互換／共用 1 小時／共用 5 分鐘／
//        依 `at`（寫入時間）而非 `o.v` 分流／5 分鐘寫成 5 秒／本次載入的記憶不套 TTL／整個 TTL 拿掉／readCache 繞過分流。
//   【C】test chain；version.ts 與 admin.html 一致（不 pin 版本）。
//   HEAD-FAIL：BASE（v6.289）的 friends-api.ts 沒有這兩個常數、兩種共用 1 小時 ⇒ A0／A1／A3 必紅，【B】的錨點全部找不到也紅。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const API = readFileSync(P_API, 'utf8');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + e.message); fail++; }
    else throw e;   // 非斷言例外一律往外炸，不吞
  }
};
const mutantMustBreak = async (name, run, expectFrag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + err.message + '（預期含「' + expectFrag + '」）');
};

// ── 載入器（與 test-v6283 同一套：esbuild 轉 CJS、注入假 fetch／localStorage）────────
const API_MARKER = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
function makeLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m }; }
function loadApi(src, { apiUrl = 'http://t.local', ls = makeLS() } = {}) {
  assert.ok(src.includes(API_MARKER), 'friends-api.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  const prepped = src.replace(API_MARKER, JSON.stringify(apiUrl));
  const js = esbuild.transformSync(prepped, { loader: 'ts', format: 'cjs' }).code;
  const m = { exports: {} };
  return { m, ls, load: (fetchImpl) => { new Function('module', 'exports', 'fetch', 'localStorage', js)(m, m.exports, fetchImpl, ls); return m.exports; } };
}
const mkFetch = (respFn) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return respFn(calls.length, url, init); }; f.calls = calls; return f; };
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) }, json: async () => body });
const htmlRes = (status) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) }, json: async () => { throw new SyntaxError('Unexpected token <'); } });
const listBody = () => ({ friendsApi: 1, me: { uid: 'FU', nick: '我' }, friends: [], incoming: [], outgoing: [], blocked: [], limit: 100, truncated: false });
const CTX = { uid: 'FU', token: 'TOK' };
const LS_KEY = 'ptcg_friends_avail:FU';
const MIN = 60 * 1000;
/** 「不該再發請求」的 fetch：入口判定與可用性都是純函式，任何一發都是 bug。 */
const noFetch = () => mkFetch(() => { throw new assert.AssertionError({ message: '純函式判定發了請求' }); });

/** 三個純函式一起看：可用性 ＋ 大廳入口 ＋ 賽後鈕（後者委派前者，但這裡一併釘住，免得將來分家）。 */
function hidden(mod, now, tag) {
  assert.strictEqual(mod.friendsEntryVisible('FU', false, now), false, tag + '：入口應仍藏');
  assert.strictEqual(mod.friendsBattleEntryVisible('FU', false, now), false, tag + '：賽後鈕應仍藏');
}
function reprobe(mod, now, tag) {
  assert.strictEqual(mod.friendsAvailability('FU', now), 'unknown', tag + '：可用性應回 unknown（重新探測）');
  assert.strictEqual(mod.friendsEntryVisible('FU', false, now), true, tag + '：入口應重新出現');
  assert.strictEqual(mod.friendsBattleEntryVisible('FU', false, now), true, tag + '：賽後鈕應重新出現');
}

/** A1／A2 的斷言本體（突變測試拿同一份對突變體跑）。kind：'disabled'（503）或 'unsupported'（404 HTML）。 */
async function assertKindTtl(src, kind, keepMin, expireMin) {
  const ls = makeLS();
  const resp = kind === 'disabled' ? () => jsonRes(503, { error: '好友功能尚未開放', code: 'friends-disabled' }) : () => htmlRes(404);
  const a = loadApi(src, { ls }).load(mkFetch(resp));
  const t0 = Date.now();
  const r = await a.fetchFriendsList(CTX);
  assert.strictEqual(r.kind, kind, '前置：回應應判成 ' + kind + '，實得 ' + r.kind);
  assert.strictEqual(a.friendsAvailability('FU', t0), kind, '前置：寫入後立刻應為 ' + kind);
  const wrote = JSON.parse(ls.getItem(LS_KEY));
  assert.deepStrictEqual(Object.keys(wrote).sort(), ['at', 'v'], 'localStorage 條目形狀必須仍是 {v, at}（舊條目才能被新門檻直接判讀），實得 ' + ls.getItem(LS_KEY));
  assert.strictEqual(wrote.v, kind);
  assert.ok(typeof wrote.at === 'number' && wrote.at >= t0 && wrote.at <= Date.now(), 'at 應是寫入當下的時間戳');
  // ① 同一次載入（session 記憶）：PWA 玩家整天不重載，這條路徑不套 TTL 的話 5 分鐘門檻是安慰劑
  assert.strictEqual(a.friendsAvailability('FU', t0 + keepMin * MIN), kind, '同一次載入：' + kind + ' ' + keepMin + ' 分鐘後應仍為 ' + kind);
  hidden(a, t0 + keepMin * MIN, '同一次載入：' + kind + ' ' + keepMin + ' 分鐘');
  reprobe(a, t0 + expireMin * MIN, '同一次載入：' + kind + ' ' + expireMin + ' 分鐘');
  // ② 重新整理後（新模組實例，只剩 localStorage）
  const b = loadApi(src, { ls }).load(noFetch());
  assert.strictEqual(b.friendsAvailability('FU', t0 + keepMin * MIN), kind, '重新整理後：' + kind + ' ' + keepMin + ' 分鐘後應仍為 ' + kind);
  hidden(b, t0 + keepMin * MIN, '重新整理後：' + kind + ' ' + keepMin + ' 分鐘');
  reprobe(b, t0 + expireMin * MIN, '重新整理後：' + kind + ' ' + expireMin + ' 分鐘');
}
async function assertDisabled(src) { await assertKindTtl(src, 'disabled', 4, 6); }
async function assertUnsupported(src) { await assertKindTtl(src, 'unsupported', 59, 61); }

/** A3 的斷言本體：模擬「v6.289 寫進 localStorage 的條目」（同樣的 {v, at} 形狀），新版 client（新實例）讀到的判定。 */
function assertOldEntries(src) {
  const now = Date.now();
  const mk = (v, agoMin) => { const ls = makeLS(); ls.setItem(LS_KEY, JSON.stringify({ v, at: now - agoMin * MIN })); return loadApi(src, { ls }).load(noFetch()); };
  // ⭐⭐ 站長最在意的那一條：舊版寫的 disabled、10 分鐘前 ⇒ 新版必須判定為過期（不必清快取）
  const old = mk('disabled', 10);
  assert.strictEqual(old.friendsAvailability('FU', now), 'unknown', '舊條目自動修復：v6.289 寫的 disabled（10 分鐘前）必須判定為過期，實得 ' + old.friendsAvailability('FU', now));
  assert.strictEqual(old.friendsEntryVisible('FU', false, now), true, '舊條目自動修復：入口應重新出現');
  assert.strictEqual(old.friendsBattleEntryVisible('FU', false, now), true, '舊條目自動修復：賽後鈕應重新出現');
  // 正對照 ①：同樣 10 分鐘前的 unsupported 仍在 1 小時內 ⇒ 仍藏（證明是依「值」分流，不是一律忽略舊條目）
  const oldU = mk('unsupported', 10);
  assert.strictEqual(oldU.friendsAvailability('FU', now), 'unsupported', '正對照：10 分鐘前的 unsupported 應仍為 unsupported（1 小時內）');
  hidden(oldU, now, '正對照：10 分鐘前的 unsupported');
  // 正對照 ②：4 分鐘前的 disabled 仍在 5 分鐘內 ⇒ 仍藏
  const recent = mk('disabled', 4);
  assert.strictEqual(recent.friendsAvailability('FU', now), 'disabled', '正對照：4 分鐘前的 disabled 應仍為 disabled（5 分鐘內）');
  hidden(recent, now, '正對照：4 分鐘前的 disabled');
  // 缺 at／壞 JSON 的舊條目 ⇒ 當作沒有（unknown），不可炸也不可藏
  const noAt = (() => { const ls = makeLS(); ls.setItem(LS_KEY, JSON.stringify({ v: 'disabled' })); return loadApi(src, { ls }).load(noFetch()); })();
  assert.strictEqual(noAt.friendsAvailability('FU', now), 'unknown', '缺 at 的負向條目應當作沒有');
  const broken = (() => { const ls = makeLS(); ls.setItem(LS_KEY, '{not json'); return loadApi(src, { ls }).load(noFetch()); })();
  assert.strictEqual(broken.friendsAvailability('FU', now), 'unknown', '壞 JSON 應當作沒有');
  // 正向條目不受 TTL 影響（就算很舊）
  const on = mk('on', 24 * 60 * 30);
  assert.strictEqual(on.friendsAvailability('FU', now), 'on', '正向快取不該有 TTL');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】friends-api.ts 實跑：兩種負向 TTL');
await T('A0 HEAD-FAIL 錨點：FRIENDS_DISABLED_CACHE_TTL_MS＝5 分鐘、FRIENDS_UNSUPPORTED_CACHE_TTL_MS＝1 小時（實際求值）；舊的共用常數 FRIENDS_NEG_CACHE_TTL_MS 不存在', () => {
  const mod = loadApi(API).load(noFetch());
  assert.strictEqual(typeof mod.FRIENDS_DISABLED_CACHE_TTL_MS, 'number', '缺 FRIENDS_DISABLED_CACHE_TTL_MS（BASE v6.289 沒有 ⇒ 這一條必紅）');
  assert.strictEqual(typeof mod.FRIENDS_UNSUPPORTED_CACHE_TTL_MS, 'number', '缺 FRIENDS_UNSUPPORTED_CACHE_TTL_MS');
  assert.strictEqual(mod.FRIENDS_DISABLED_CACHE_TTL_MS, 5 * MIN, 'disabled 的 TTL 應為 5 分鐘，實得 ' + mod.FRIENDS_DISABLED_CACHE_TTL_MS);
  assert.strictEqual(mod.FRIENDS_UNSUPPORTED_CACHE_TTL_MS, 60 * MIN, 'unsupported 的 TTL 應為 1 小時，實得 ' + mod.FRIENDS_UNSUPPORTED_CACHE_TTL_MS);
  assert.ok(mod.FRIENDS_DISABLED_CACHE_TTL_MS < mod.FRIENDS_UNSUPPORTED_CACHE_TTL_MS, 'disabled（站長隨時會切）必須比 unsupported 短');
  assert.ok(!('FRIENDS_NEG_CACHE_TTL_MS' in mod), '舊的共用常數 FRIENDS_NEG_CACHE_TTL_MS 還在 —— 兩種語義不可再共用一個門檻');
});
await T('A1 ⭐ disabled（503 friends-disabled）：4 分鐘仍藏、6 分鐘重新探測 —— 同一次載入與重新整理後兩條路徑', () => assertDisabled(API));
await T('A2 unsupported（404 HTML）：59 分鐘仍藏、61 分鐘重新探測 —— 兩條路徑', () => assertUnsupported(API));
await T('A3 ⭐⭐ 舊條目自動修復：v6.289 寫的 {v:disabled, at:10 分鐘前} 在新版必判過期；正對照 unsupported 10 分鐘／disabled 4 分鐘仍藏', () => assertOldEntries(API));
await T('A4 私聊那條 60 秒負向的既有行為不變（常數求值＋行為端：59 秒仍 disabled、61 秒 unknown），且不碰好友功能的快取', async () => {
  const ls = makeLS();
  const mod = loadApi(API, { ls }).load(mkFetch(() => jsonRes(503, { error: '好友私聊尚未開放', code: 'friends-dm-disabled' })));
  assert.strictEqual(mod.FRIENDS_DM_NEG_CACHE_TTL_MS, 60 * 1000, '私聊負向 TTL 應仍為 60 秒，實得 ' + mod.FRIENDS_DM_NEG_CACHE_TTL_MS);
  const t0 = Date.now();
  const r = await mod.fetchDmMessages(CTX, 'abcdef12', { since: 0 });
  assert.strictEqual(r.kind, 'dm-disabled', '實得 ' + r.kind);
  assert.strictEqual(mod.friendsDmAvailability(t0 + 59 * 1000), 'disabled', '私聊 59 秒後應仍為 disabled');
  assert.strictEqual(mod.friendsDmAvailability(t0 + 61 * 1000), 'unknown', '私聊 61 秒後應回 unknown');
  assert.strictEqual(mod.friendsDmAvailability(t0 + 4 * MIN), 'unknown', '私聊的負向不可被好友的 5 分鐘門檻拉長');
  // 私聊沒開 ⇒ 好友功能仍是 on（v6.288 規則），且 localStorage 的好友快取是 on、永不過期
  assert.strictEqual(mod.friendsAvailability('FU', t0 + 24 * 60 * MIN), 'on', '私聊沒開不可把好友功能判成負向');
  assert.ok(String(ls.getItem(LS_KEY)).includes('"on"'), 'localStorage 的好友快取被改寫：' + ls.getItem(LS_KEY));
});
await T('A5 原始碼零 setInterval／零 setTimeout（零輪詢，v6.283 紅線）', () => {
  const stripped = API.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.strictEqual((stripped.match(/setInterval/g) || []).length, 0, 'friends-api.ts 出現 setInterval');
  assert.strictEqual((stripped.match(/setTimeout/g) || []).length, 0, 'friends-api.ts 出現 setTimeout');
  assert.ok(API.length > 3000, '掃描器壞了？friends-api.ts 只有 ' + API.length + ' 字元');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】突變測試（每一條只捕 AssertionError，且要紅在預期那一條）');
const mut = (a, b) => { assert.strictEqual(API.split(a).length - 1, 1, '突變錨點不唯一：' + a); return API.replace(a, b); };
const BRANCH = "  if (v === 'disabled') return FRIENDS_DISABLED_CACHE_TTL_MS;\n  if (v === 'unsupported') return FRIENDS_UNSUPPORTED_CACHE_TTL_MS;\n";
const ALIVE = "  if (ttl !== null && typeof at === 'number' && now - at < ttl) return v as FriendsAvailability;\n";
const SESSION = "  if (s) { const a = aliveAvail(s.v, s.at, now); if (a) return a; }\n";
const READ = "    return aliveAvail(o.v, o.at, now) ?? 'unknown';\n";
await T('B1 突變：兩種 TTL 互換（disabled 1 小時／unsupported 5 分鐘）⇒ A1 紅在「disabled 6 分鐘」', () =>
  mutantMustBreak('swap', () => assertDisabled(mut(BRANCH, "  if (v === 'disabled') return FRIENDS_UNSUPPORTED_CACHE_TTL_MS;\n  if (v === 'unsupported') return FRIENDS_DISABLED_CACHE_TTL_MS;\n")), 'disabled 6 分鐘'));
await T('B1b 同一突變體對 A2 ⇒ 紅在「unsupported 59 分鐘」', () =>
  mutantMustBreak('swap', () => assertUnsupported(mut(BRANCH, "  if (v === 'disabled') return FRIENDS_UNSUPPORTED_CACHE_TTL_MS;\n  if (v === 'unsupported') return FRIENDS_DISABLED_CACHE_TTL_MS;\n")), 'unsupported 59 分鐘'));
await T('B2 突變：兩種共用同一個 1 小時（v6.289 的行為）⇒ A1 紅在「disabled 6 分鐘」', () =>
  mutantMustBreak('share-1h', () => assertDisabled(mut(BRANCH, "  if (v === 'disabled' || v === 'unsupported') return FRIENDS_UNSUPPORTED_CACHE_TTL_MS;\n")), 'disabled 6 分鐘'));
await T('B3 突變：兩種共用同一個 5 分鐘 ⇒ A2 紅在「unsupported 59 分鐘」', () =>
  mutantMustBreak('share-5m', () => assertUnsupported(mut(BRANCH, "  if (v === 'disabled' || v === 'unsupported') return FRIENDS_DISABLED_CACHE_TTL_MS;\n")), 'unsupported 59 分鐘'));
await T('B4 突變：依「寫入時間」而非 o.v 分流（模組載入前寫的一律 1 小時）⇒ A3 紅在「舊條目自動修復」', () =>
  mutantMustBreak('by-at', () => assertOldEntries(mut(ALIVE,
    "  const ttl2 = (typeof at === 'number' && at >= MODULE_LOADED_AT) ? ttl : FRIENDS_UNSUPPORTED_CACHE_TTL_MS;\n  if (ttl2 !== null && typeof at === 'number' && now - at < ttl2) return v as FriendsAvailability;\n")
    .replace("const LS_PREFIX = 'ptcg_friends_avail:';", "const LS_PREFIX = 'ptcg_friends_avail:';\nconst MODULE_LOADED_AT = Date.now();")), '舊條目自動修復'));
await T('B5 突變：5 分鐘寫成 5 秒 ⇒ A1 紅在「disabled 4 分鐘」', () =>
  mutantMustBreak('5s', () => assertDisabled(mut('export const FRIENDS_DISABLED_CACHE_TTL_MS = 5 * 60 * 1000;', 'export const FRIENDS_DISABLED_CACHE_TTL_MS = 5 * 1000;')), 'disabled 4 分鐘'));
await T('B6 突變：本次載入的記憶不套 TTL（v6.289 的 sessionAvail 行為）⇒ A1 紅在「同一次載入：disabled 6 分鐘」', () =>
  mutantMustBreak('session-no-ttl', () => assertDisabled(mut(SESSION, '  if (s) return s.v;\n')), '同一次載入：disabled 6 分鐘'));
await T('B7 突變：整個 TTL 拿掉（負向永久）⇒ A1 紅在「disabled 6 分鐘」', () =>
  mutantMustBreak('no-ttl', () => assertDisabled(mut(ALIVE, '  if (ttl !== null) return v as FriendsAvailability;\n')), 'disabled 6 分鐘'));
await T('B8 突變：readCache 繞過分流、直接回 o.v ⇒ A3 紅在「舊條目自動修復」', () =>
  mutantMustBreak('read-bypass', () => assertOldEntries(mut(READ, "    if (o.v === 'on' || o.v === 'disabled' || o.v === 'unsupported') return o.v;\n    return 'unknown';\n")), '舊條目自動修復'));
await T('B9 突變：私聊負向改用好友的 5 分鐘 ⇒ A4 紅在「私聊 61 秒」', async () => {
  const m = mut("if ((dmAvail.v === 'disabled' || dmAvail.v === 'unsupported') && now - dmAvail.at < FRIENDS_DM_NEG_CACHE_TTL_MS) return dmAvail.v;", "if ((dmAvail.v === 'disabled' || dmAvail.v === 'unsupported') && now - dmAvail.at < FRIENDS_DISABLED_CACHE_TTL_MS) return dmAvail.v;");
  await mutantMustBreak('dm-5m', async () => {
    const mod = loadApi(m).load(mkFetch(() => jsonRes(503, { error: 'x', code: 'friends-dm-disabled' })));
    const t0 = Date.now();
    await mod.fetchDmMessages(CTX, 'abcdef12', { since: 0 });
    assert.strictEqual(mod.friendsDmAvailability(t0 + 59 * 1000), 'disabled', '私聊 59 秒後應仍為 disabled');
    assert.strictEqual(mod.friendsDmAvailability(t0 + 61 * 1000), 'unknown', '私聊 61 秒後應回 unknown');
  }, '私聊 61 秒');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】test chain／版本');
await T('C1 本守衛在 package.json 的 test chain；version.ts 與 admin.html SITE_VERSION_HINT 一致（不 pin 版本）', () => {
  const pk = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pk.scripts.test.includes('node scripts/test-v6290-neg-cache-ttl.mjs'), '沒進 test chain');
  const V = /VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'))[1];
  assert.strictEqual(H, V, 'admin.html SITE_VERSION_HINT=' + H + ' 與 version.ts=' + V + ' 不同步');
});

console.log('\n══ v6.290 好友負向快取 TTL 守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
