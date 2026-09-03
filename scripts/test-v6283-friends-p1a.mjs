// v6.283 守衛：好友功能 P1a（client 端）—— src/lib/friends/friends-api.ts ＋ src/routes/friends/ ＋
//   線上大廳的一顆入口鈕（src/routes/game/+page.svelte 三行）。
//
// 守什麼（能行為端就行為端；靜態只用在行為端測不到的地方）：
//   【A】friends-api.ts 用 esbuild 轉 CJS **實跑**：假 fetch 回七組回應（帶哨兵成功／404 HTML／
//        503 disabled／503 helper-missing／401／429／網路錯）⇒ 斷言可用性三態與入口顯示；
//        ⚠ 401 與 429 與暫時性 5xx **不得**被判成「不支援」（誤判＝把功能誤殺，而且本次載入不可逆）。
//        另：沒有 Oracle API 的 build 零請求、沒有 token 零請求、匿名一律藏、負向快取 TTL 過期會再試、
//        正向快取跨模組實例（localStorage）保留、404 但帶 friends- 錯誤碼（查無此帳號）＝伺服器認得端點。
//   【B】靜態：原始碼零 `setInterval`／零 `setTimeout`（零輪詢）；每個 `{#each}` 都用 fid 當 key；
//        全頁零 `{@html}`；回應處理不讀 email 欄位。
//   【C】⭐⭐ 框架安全：game/+page.svelte 的手機／桌機兩套對戰版面分支區間**零 `friend` 字樣**
//        （⚠ 正對照：/friends 路由檔必有；桌機入口那一行必須落在「線上 Lobby」區塊、且只有一處；
//        v6.284 起 friendsEntryOn 共 3 處：$derived／桌機入口／手機入口，各自釘住；v6.285 起 4 處：＋設定 modal 尾端的好友 section）；
//        MobilePortraitBattle.svelte 零 `friend`；`.auth-user` 仍是三份、CSS 逐字未動。
//   【D】錦標賽區塊 sha256 逐位元未動（與 test-v6278 I1／test-v6282 A2 同一把，凍結區塊不是版本 pin）。
//   【E】突變測試：每一條只捕 AssertionError，且斷言紅在**預期那一條**。
//   【F】HEAD-FAIL：BASE（v6.282）沒有 friends-api.ts ⇒ A0 必紅並中止（history-free）。
//
// ⚠ 守衛安慰劑型態逐一避開：不 pin 版本號；斷言全部求值不比字面；mutantMustBreak 只捕 AssertionError
//   並比對訊息片段；掃描器有下限斷言（區間長度、each 數、.auth-user 數）與正對照。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_PAGE = join(ROOT, 'src/routes/friends/+page.svelte');
// ⭐⭐ v6.296：好友名單的**本體**搬到共用元件（/friends 頁與線上大廳第二個分頁共用同一份）。
//   底下原本掃 `/friends` 頁的結構斷言全部改掃這一份 —— 守護意圖不變（零 {@html}／each 穩定 key／
//   四區都在／二次確認），只是「那份唯一的名單 UI」現在住在這裡；另加「/friends 路由仍掛得起它」的正對照。
const P_PANEL = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
const P_PAGE_TS = join(ROOT, 'src/routes/friends/+page.ts');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_MPB = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');

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

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】HEAD-FAIL 錨點');
let API = '', PAGE = '', PAGE_TS = '', GAME = '', MPB = '', SRV = '', PANEL = '';
await T('F0 HEAD-FAIL：friends-api.ts／routes/friends/+page.svelte／+page.ts 三個新檔都存在（BASE v6.282 沒有 ⇒ 這一條必紅）', () => {
  assert.ok(existsSync(P_API), '缺 ' + P_API);
  assert.ok(existsSync(P_PAGE), '缺 ' + P_PAGE);
  assert.ok(existsSync(P_PAGE_TS), '缺 ' + P_PAGE_TS);
  assert.ok(existsSync(P_PANEL), '缺 ' + P_PANEL);
  PANEL = readFileSync(P_PANEL, 'utf8');
  assert.ok(PANEL.length > 3000, 'FriendsPanel.svelte 只有 ' + PANEL.length + ' 字元 —— 被掏空');
  API = readFileSync(P_API, 'utf8'); PAGE = readFileSync(P_PAGE, 'utf8'); PAGE_TS = readFileSync(P_PAGE_TS, 'utf8');
  GAME = readFileSync(P_GAME, 'utf8'); MPB = readFileSync(P_MPB, 'utf8'); SRV = readFileSync(P_SRV, 'utf8');
  assert.ok(API.length > 3000, 'friends-api.ts 只有 ' + API.length + ' 字元 —— 被掏空');
  assert.ok(PAGE.length > 3000, '+page.svelte 只有 ' + PAGE.length + ' 字元 —— 被掏空');
});
if (fail) { console.log('\n══ v6.283 好友 P1a 守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新檔不存在，後續斷言無法進行）══'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════════════
// 【A】friends-api.ts 行為端
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】friends-api.ts 實跑：七組回應 ⇒ 三態');
const API_MARKER = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
/** 假 localStorage（可跨模組實例共用，模擬「重新整理後」）。 */
function makeLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m }; }
function loadApi(src, { apiUrl = 'http://t.local', ls = makeLS() } = {}) {
  assert.ok(src.includes(API_MARKER), 'friends-api.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  const prepped = src.replace(API_MARKER, JSON.stringify(apiUrl));
  assert.ok(!prepped.includes('import.meta'), '還有 import.meta 沒換掉');
  const js = esbuild.transformSync(prepped, { loader: 'ts', format: 'cjs' }).code;
  const m = { exports: {} };
  return { m, ls, load: (fetchImpl) => { new Function('module', 'exports', 'fetch', 'localStorage', js)(m, m.exports, fetchImpl, ls); return m.exports; } };
}
const mkFetch = (respFn) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return respFn(calls.length, url, init); }; f.calls = calls; return f; };
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) }, json: async () => body });
const htmlRes = (status) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) }, json: async () => { throw new SyntaxError('Unexpected token <'); } });
const listBody = () => ({ friendsApi: 1, me: { uid: 'FU', nick: '我' }, friends: [{ fid: 'f1', status: 'accepted', nick: '小明', uid: 'u1', uids: ['u1', 'u0'], requestedByMe: true, blockedByMe: false, via: 'email', at: 1 }], incoming: [], outgoing: [], blocked: [], limit: 100, truncated: false });
const CTX = { uid: 'FU', token: 'TOK' };

/** 七組情境共用：載入模組 → 打一發 list → 回 {mod, r, f}。 */
async function scenario(src, respFn, opts = {}) {
  const box = loadApi(src, opts);
  const f = mkFetch(respFn);
  const mod = box.load(f);
  const r = await mod.fetchFriendsList({ ...CTX, ...(opts.ctx || {}) });
  return { mod, r, f, ls: box.ls };
}
/** 七組情境的斷言本體（突變測試會拿同一份對突變體跑）。 */
async function assertSeven(src) {
  // ① 帶哨兵成功
  {
    const { mod, r, f, ls } = await scenario(src, () => jsonRes(200, listBody()));
    assert.strictEqual(r.ok, true, '①成功回應應該 ok，實得 ' + JSON.stringify(r));
    assert.strictEqual(r.data.friends[0].nick, '小明');
    assert.deepStrictEqual(r.data.friends[0].uids, ['u1', 'u0']);
    assert.strictEqual(mod.friendsAvailability('FU'), 'on', '①哨兵成功後可用性應為 on');
    assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '①哨兵成功後入口應顯示');
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].url, 'http://t.local/api/friends/list', '打錯端點：' + f.calls[0].url);
    assert.strictEqual(f.calls[0].init.headers.Authorization, 'Bearer TOK', '沒帶 Firebase ID token');
    assert.ok(String(ls.getItem('ptcg_friends_avail:FU')).includes('"on"'), '①正向快取沒寫進 localStorage');
  }
  // ② 404 HTML（伺服器未部署／測試站靜態 404 頁）
  {
    const { mod, r } = await scenario(src, () => htmlRes(404));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.kind, 'unsupported', '②404 HTML 應判 unsupported，實得 ' + r.kind);
    assert.strictEqual(mod.friendsAvailability('FU'), 'unsupported');
    assert.strictEqual(mod.friendsEntryVisible('FU', false), false, '②不支援時入口必須藏');
  }
  // ③ 503 friends-disabled（開關關著）
  {
    const { mod, r } = await scenario(src, () => jsonRes(503, { error: '好友功能尚未開放', code: 'friends-disabled' }));
    assert.strictEqual(r.kind, 'disabled', '③503 friends-disabled 應判 disabled，實得 ' + r.kind);
    assert.strictEqual(mod.friendsAvailability('FU'), 'disabled');
    assert.strictEqual(mod.friendsEntryVisible('FU', false), false, '③尚未開放時入口必須藏');
  }
  // ④ 503 friends-helper-missing（跨 IIFE helper 未掛載＝暫時性）
  {
    const { mod, r } = await scenario(src, () => jsonRes(503, { error: 'x', code: 'friends-helper-missing' }));
    assert.strictEqual(r.kind, 'transient', '④helper-missing 應判 transient，實得 ' + r.kind);
    assert.notStrictEqual(mod.friendsAvailability('FU'), 'unsupported', '④暫時性 503 不得判成不支援');
    assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '④暫時性 503 不得把入口藏起來');
  }
  // ⑤ 401（token 過期／匿名）
  {
    const { mod, r } = await scenario(src, () => jsonRes(401, { error: '好友功能需要以 email 帳號登入', code: 'friends-auth-required' }));
    assert.strictEqual(r.kind, 'auth', '⑤401 應判 auth，實得 ' + r.kind);
    assert.notStrictEqual(mod.friendsAvailability('FU'), 'unsupported', '⑤401 不得判成不支援');
    assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '⑤401 不得把入口藏起來');
  }
  // ⑥ 429（限流／冷卻）
  {
    const { mod, r } = await scenario(src, () => jsonRes(429, { error: '太頻繁', code: 'friends-rate-limited', friendsApi: 1 }));
    assert.strictEqual(r.kind, 'busy', '⑥429 應判 busy，實得 ' + r.kind);
    assert.notStrictEqual(mod.friendsAvailability('FU'), 'unsupported', '⑥429 不得判成不支援');
    assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '⑥429 不得把入口藏起來');
  }
  // ⑦ 網路錯誤
  {
    const { mod, r } = await scenario(src, () => { throw new TypeError('Failed to fetch'); });
    assert.strictEqual(r.kind, 'network', '⑦網路錯應判 network，實得 ' + r.kind);
    assert.strictEqual(mod.friendsAvailability('FU'), 'unknown', '⑦網路錯不得寫任何快取');
    assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '⑦網路錯不得把入口藏起來');
  }
}
await T('A1 ⭐⭐ 七組回應 ⇒ 三態正確（①支援 ②404 不支援 ③disabled ④helper-missing ⑤401 ⑥429 ⑦網路錯）', () => assertSeven(API));
await T('A2 非 JSON 的 5xx（tunnel／nginx 錯誤頁）⇒ transient，不是 unsupported', async () => {
  const { mod, r } = await scenario(API, () => htmlRes(502));
  assert.strictEqual(r.kind, 'transient', '實得 ' + r.kind);
  assert.strictEqual(mod.friendsEntryVisible('FU', false), true);
});
await T('A3 沒有 Oracle API 的 build（GitHub Pages 測試站）⇒ unsupported、入口藏、**零請求**', async () => {
  const box = loadApi(API, { apiUrl: '' });
  const f = mkFetch(() => { throw new assert.AssertionError({ message: '不該發任何請求' }); });
  const mod = box.load(f);
  assert.strictEqual(mod.friendsAvailability('FU'), 'unsupported');
  assert.strictEqual(mod.friendsEntryVisible('FU', false), false);
  const r = await mod.fetchFriendsList(CTX);
  assert.strictEqual(r.kind, 'unsupported');
  assert.strictEqual(f.calls.length, 0, '發了 ' + f.calls.length + ' 發');
});
await T('A4 匿名一律藏（即使正向快取已存在）；沒有 token ⇒ auth 且零請求', async () => {
  const ls = makeLS();
  ls.setItem('ptcg_friends_avail:FU', JSON.stringify({ v: 'on', at: Date.now() }));
  const box = loadApi(API, { ls });
  const f = mkFetch(() => jsonRes(200, listBody()));
  const mod = box.load(f);
  assert.strictEqual(mod.friendsEntryVisible('FU', true), false, '匿名還顯示入口');
  assert.strictEqual(mod.friendsEntryVisible(null, false), false, '沒 uid 還顯示入口');
  assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '正向快取在，非匿名應顯示');
  const r = await mod.fetchFriendsList({ uid: 'FU', token: null });
  assert.strictEqual(r.kind, 'auth');
  assert.strictEqual(f.calls.length, 0, '沒 token 還發了請求');
});
await T('A5 入口是純函式：呼叫 200 次零請求（大廳載入不多打一發）', async () => {
  const box = loadApi(API);
  const f = mkFetch(() => { throw new assert.AssertionError({ message: '入口判定發了請求' }); });
  const mod = box.load(f);
  for (let i = 0; i < 200; i++) { mod.friendsEntryVisible('FU', false); mod.friendsAvailability('FU'); }
  assert.strictEqual(f.calls.length, 0);
});
await T('A6 負向快取有 TTL：過期 ⇒ unknown ⇒ 入口重新出現；正向快取跨模組實例（模擬重新整理）保留', async () => {
  const ls = makeLS();
  const a = loadApi(API, { ls }).load(mkFetch(() => jsonRes(503, { code: 'friends-disabled', error: 'x' })));
  await a.fetchFriendsList(CTX);
  assert.strictEqual(a.friendsAvailability('FU'), 'disabled');
  // v6.290：負向快取 TTL 依快取值分流（disabled 5 分鐘／unsupported 1 小時）；這一組是 disabled ⇒ 用 disabled 的門檻
  const later = Date.now() + a.FRIENDS_DISABLED_CACHE_TTL_MS + 1000;
  const b = loadApi(API, { ls }).load(mkFetch(() => jsonRes(200, listBody())));   // 新實例＝重新整理
  assert.strictEqual(b.friendsAvailability('FU'), 'disabled', '重新整理後負向快取應仍在（TTL 內）');
  assert.strictEqual(b.friendsAvailability('FU', later), 'unknown', 'TTL 過期應回 unknown');
  assert.strictEqual(b.friendsEntryVisible('FU', false, later), true, 'TTL 過期入口應重新出現');
  await b.fetchFriendsList(CTX);
  const c = loadApi(API, { ls }).load(mkFetch(() => { throw new Error('no'); }));
  assert.strictEqual(c.friendsAvailability('FU'), 'on', '正向快取沒有跨實例保留');
  assert.strictEqual(c.friendsAvailability('OTHER'), 'unknown', '快取沒有綁 uid');
});
await T('A7 {email} 入口：404 但帶 friends-no-such-account（伺服器**認得**端點）⇒ rejected＋伺服器訊息，不是 unsupported', async () => {
  const box = loadApi(API);
  const f = mkFetch(() => jsonRes(404, { error: '查無此 email 的帳號', code: 'friends-no-such-account' }));
  const mod = box.load(f);
  const r = await mod.requestFriendByEmail(CTX, '  Nobody@Example.com ');
  assert.strictEqual(r.kind, 'rejected', '實得 ' + r.kind);
  assert.strictEqual(r.message, '查無此 email 的帳號', '要把伺服器的話原樣給玩家（站長裁定：查無此帳號明講）');
  assert.strictEqual(mod.friendsAvailability('FU'), 'on', '伺服器認得端點 ⇒ 應記正向');
  assert.strictEqual(f.calls[0].url, 'http://t.local/api/friends/request');
  assert.deepStrictEqual(JSON.parse(f.calls[0].init.body), { email: 'Nobody@Example.com' });
  assert.strictEqual(f.calls[0].init.headers['Content-Type'], 'application/json', '漏帶 Content-Type（v1.02 事故：express.json 不解析 body）');
  const ok = await box.load(mkFetch(() => jsonRes(200, { ok: true, friendsApi: 1, status: 'pending', fid: 'abc' }))).requestFriendByEmail(CTX, 'a@b.c');
  assert.deepStrictEqual(ok, { ok: true, data: { status: 'pending', fid: 'abc', already: false } });
});
await T('A8 五個動作各打對端點且 body 只有 {fid}；429 friends-cooldown（帶哨兵）⇒ busy', async () => {
  const box = loadApi(API);
  const f = mkFetch(() => jsonRes(200, { ok: true, friendsApi: 1 }));
  const mod = box.load(f);
  for (const a of ['accept', 'reject', 'remove', 'block', 'unblock']) {
    const r = await mod.friendsAction(CTX, a, 'fid1');
    assert.strictEqual(r.ok, true, a);
    const last = f.calls[f.calls.length - 1];
    assert.strictEqual(last.url, 'http://t.local/api/friends/' + a);
    assert.deepStrictEqual(JSON.parse(last.init.body), { fid: 'fid1' });
  }
  const r2 = await box.load(mkFetch(() => jsonRes(429, { error: '24 小時後才能再送出', code: 'friends-cooldown', friendsApi: 1 }))).requestFriendByEmail(CTX, 'a@b.c');
  assert.strictEqual(r2.kind, 'busy');
});
await T('A9 正規化：伺服器少給欄位不炸、非陣列補空；回應裡即使夾帶 email 也**不會**進到 FriendRow 的欄位', async () => {
  const body = { friendsApi: 1, friends: [{ fid: 'x', nick: 'n', email: 'leak@x.com', uids: 'oops' }], incoming: null, blocked: 'no' };
  const { r } = await scenario(API, () => jsonRes(200, body));
  assert.strictEqual(r.ok, true);
  // v6.296：多了 alias（我給的備註名；伺服器不合併，UI 才能同時顯示原暱稱）。這一條的守護意圖是「email 絕不進到 FriendRow」⇒ 白名單逐字列
  assert.deepStrictEqual(Object.keys(r.data.friends[0]).sort(), ['alias', 'at', 'blockedByMe', 'fid', 'nick', 'requestedByMe', 'status', 'uid', 'uids', 'via']);
  assert.strictEqual(r.data.friends[0].alias, null, '伺服器沒給 alias 時必須補 null');
  assert.deepStrictEqual(r.data.friends[0].uids, []);
  assert.deepStrictEqual(r.data.incoming, []); assert.deepStrictEqual(r.data.blocked, []);
  assert.strictEqual(r.data.limit, 100);
});

// ═══════════════════════════════════════════════════════════════════════════
// 【B】靜態：零輪詢／each key／零 {@html}
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】靜態：零輪詢、each 穩定 key、零 {@html}');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}
await T('B1 friends-api.ts 與 /friends 頁原始碼零 setInterval／零 setTimeout（零輪詢；剝註解後數）', () => {
  for (const [n, s] of [['friends-api.ts', API], ['+page.svelte', PAGE], ['+page.ts', PAGE_TS]]) {
    const c = stripComments(s);
    assert.strictEqual((c.match(/setInterval\s*\(/g) || []).length, 0, n + ' 有 setInterval');
    assert.strictEqual((c.match(/setTimeout\s*\(/g) || []).length, 0, n + ' 有 setTimeout');
    assert.strictEqual((c.match(/requestAnimationFrame\s*\(/g) || []).length, 0, n + ' 有 rAF 迴圈');
  }
});
await T('B2 好友名單（v6.296 起在共用元件內）每個 {#each} 都用 (r.fid) 當 key（掃描器下限：恰好四區 ⇒ ≥4 個 each）', () => {
  const eaches = PANEL.match(/\{#each[^}]*\}/g) || [];
  assert.ok(eaches.length >= 4, '只找到 ' + eaches.length + ' 個 each —— 四區不見了？');
  for (const e of eaches) assert.ok(/\(r\.fid\)\}$/.test(e), 'each 沒有用 fid 當 key：' + e);
});
await T('B3 好友名單零 {@html}（含 /friends 頁）；四區標題都在；匿名說明在；unsupported／disabled 兩種說明在；⭐ /friends 路由仍然掛得起共用元件', () => {
  assert.ok(!stripComments(PANEL).includes('{@html'), '共用元件出現 {@html}');
  assert.ok(!stripComments(PAGE).includes('{@html'), '/friends 頁出現 {@html}');
  for (const h of ['<h2>好友 ', '<h2>待我確認 ', '<h2>我送出的邀請 ', '<h2>已封鎖 ']) assert.ok(PANEL.includes(h), '缺區塊標題 ' + h);
  assert.ok(/failKind === 'unsupported'/.test(PANEL) && /failKind === 'disabled'/.test(PANEL), '缺不支援／尚未開放分支');
  assert.ok(/\{:else if !canUse\}/.test(PANEL), '缺匿名分支');
  assert.ok(/'remove'\)/.test(PANEL) && /askConfirm\(r\.fid, 'remove'\)/.test(PANEL), '解除好友沒有走二次確認');
  assert.ok(/askConfirm\(r\.fid, 'unblock'\)/.test(PANEL), '解除封鎖沒有走二次確認');
  // ⭐ 正對照：元件抽出來之後，/friends 這條獨立路由**還是得掛得起來**（不然抽出來就等於把頁面弄壞了）
  assert.ok(/import FriendsPanel from '\$lib\/friends\/FriendsPanel\.svelte';/.test(PAGE), '/friends 頁沒有 import 共用元件');
  assert.ok(/<FriendsPanel /.test(PAGE), '/friends 頁沒有渲染共用元件');
});
await T('B4 +page.ts：prerender=true、ssr=false（與 /decks 同一套）', () => {
  assert.ok(/export const prerender = true;/.test(PAGE_TS) && /export const ssr = false;/.test(PAGE_TS));
});
await T('B5 friends-api.ts 不 import 任何模組（守衛才能單獨載入實跑）', () => {
  assert.strictEqual((stripComments(API).match(/^\s*import\s/gm) || []).length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 【C】⭐⭐ 框架安全：對戰版面分支零 friend；入口只在線上大廳一處
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】框架安全：對戰版面分支零 friend ／ 入口只有大廳一處');
const BATTLE_START = '  {#if isPortraitMobile && game}\n';
const BATTLE_END = '{/if}<!-- /isPortraitMobile && playing -->';
function battleRegion(game) {
  const s = game.indexOf(BATTLE_START);
  const e = game.indexOf(BATTLE_END, s);
  assert.ok(s > 0 && e > s, '找不到對戰版面分支的起訖錨點');
  return game.slice(s, e + BATTLE_END.length);
}
function assertBattleRegionClean(game) {
  const region = battleRegion(game);
  assert.ok(region.length > 20000, '對戰版面區間只有 ' + region.length + ' 字元 —— 錨點抓錯？');
  assert.ok(region.includes('<MobilePortraitBattle') && region.includes('{:else}'), '區間內看不到手機／桌機兩套分支');
  const hits = region.match(/friend/gi) || [];
  assert.strictEqual(hits.length, 0, '⚠⚠ 對戰版面分支出現 ' + hits.length + ' 個 friend 字樣');
}
await T('C1 ⭐⭐ 手機／桌機兩套對戰版面分支區間零 `friend`（不分大小寫；區間 >20000 字元且含兩套分支）', () => assertBattleRegionClean(GAME));
await T('C1b 掃描器正對照：把 friend 塞進區間 ⇒ 必紅', () => {
  const s = GAME.indexOf(BATTLE_START);
  const mutated = GAME.slice(0, s + BATTLE_START.length) + '<!-- friend -->' + GAME.slice(s + BATTLE_START.length);
  let err = null; try { assertBattleRegionClean(mutated); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err && /friend 字樣/.test(err.message), '掃描器抓不到塞進去的 friend');
});
await T('C2 MobilePortraitBattle.svelte 零 `friend`；正對照：/friends 路由檔必有', () => {
  assert.strictEqual((MPB.match(/friend/gi) || []).length, 0);
  assert.ok((PAGE.match(/friend/gi) || []).length > 10);
});
await T('C3 ⭐⭐ 大廳分頁列（v6.296 取代 v6.283／v6.284 的兩個舊入口）：剝註解後 `friendsEntryOn` 恰 4 處（$derived ／ lobbyTab 的 $derived ／ 分頁列 ／ v6.285 設定 modal 好友 section）；分頁列落在「線上 Lobby」區塊、`<h1>🌐 線上連線對戰` 之後、`.lobby-unified` 之前；兩個舊入口不得復活', () => {
  // ⚠ 用剝過註解的原始碼計數：註解裡提到變數名不該影響「有幾個真正的使用點」（否則改一句註解就會紅＝安慰劑的反面）
  const G = stripComments(GAME);
  assert.strictEqual((G.match(/friendsEntryOn/g) || []).length, 4, 'friendsEntryOn 的實際使用點不是 4 處');
  assert.strictEqual((G.match(/\{#if friendsEntryOn && !isPortraitMobile\}/g) || []).length, 0, 'v6.283 桌機那份舊入口復活了（本版改用分頁列）');
  assert.strictEqual((G.match(/\{#if friendsEntryOn && isPortraitMobile\}/g) || []).length, 0, 'v6.284 手機那份舊入口復活了（本版改用分頁列）');
  const sm = GAME.indexOf('<!-- Settings Modal (Audio & BGM) -->'), smEnd = GAME.indexOf('<!-- v4.60 對方提議 modal -->', sm);
  assert.ok(sm > 0 && smEnd > sm, '找不到設定 modal 錨點');
  assert.strictEqual((GAME.slice(sm, smEnd).match(/\{#if friendsEntryOn\}/g) || []).length, 1, '設定 modal 內的 {#if friendsEntryOn} 不是恰一處');
  // 位置：線上 Lobby 區塊 → h1 → 分頁列 → 統一大廳表單
  const lobby = GAME.indexOf('<!-- ─── 線上 Lobby ─── -->');
  const h1 = GAME.indexOf('<h1>🌐 線上連線對戰</h1>');
  const tabs = GAME.indexOf("{#if friendsEntryOn && onlineStep !== 'room'}");
  const form = GAME.indexOf('<div class="online-form lobby-unified">');
  assert.ok(lobby > 0 && h1 > lobby, '找不到線上 Lobby／h1 錨點');
  assert.ok(tabs > h1, '分頁列不在 h1 之後：' + [h1, tabs].join(','));
  assert.ok(form > tabs, '分頁列不在統一大廳表單之前：' + [tabs, form].join(','));
  // v6.284 起 script 區多了賽後／設定用的一組狀態與函式，所以「零 friend」只掃 **markup**（</script> 之後到 lobby 錨點）：
  //   主選單與本機模式那兩份 .auth-user 都在這一段 ⇒ 必須零 friend（那兩份刻意不放入口）。
  const scriptEnd = GAME.indexOf('</script>');
  assert.ok(scriptEnd > 0 && scriptEnd < lobby, '找不到 </script> 或它在 lobby 之後');
  const lines = GAME.slice(0, scriptEnd).split('\n');
  const derivedLines = lines.filter((l) => /^  const friendsEntryOn = \$derived\(friendsEntryVisible\(/.test(l));
  const importLines = lines.filter((l) => /^  import \{ friendsEntryVisible(, [^}]*)? \} from '\$lib\/friends\/friends-api';/.test(l));
  assert.strictEqual(derivedLines.length, 1, '$derived 行數不對'); assert.strictEqual(importLines.length, 1, 'import 行數不對');
  const markupBefore = GAME.slice(scriptEnd, lobby);
  assert.ok(markupBefore.includes('class="auth-user"'), '主選單／本機那兩份 .auth-user 不在 </script>～lobby 之間？錨點抓錯');
  assert.strictEqual((markupBefore.match(/friend/gi) || []).length, 0, 'lobby 之前的 markup 多出不明的 friend 字樣（主選單／本機那兩份 .auth-user 不該有入口）');
  assert.strictEqual((GAME.match(/class="auth-user"/g) || []).length, 3, '.auth-user 份數變了');
});
/** 把 `const lobbyTab = $derived(…);` 的運算式抽出來求值（不比字面）。 */
function lobbyTabOf(game, friendsEntryOn, raw) {
  const m = /const lobbyTab = \$derived\(([^;]*)\);/.exec(game);
  assert.ok(m, '找不到 lobbyTab 的 $derived');
  return new Function('friendsEntryOn', 'lobbyTabRaw', 'return (' + m[1] + ');')(friendsEntryOn, raw);
}
await T('C4 ⭐⭐⭐ 匿名玩家看不到分頁列，而且 lobbyTab 被 $derived **鎖回** online（求值，不比字面）：friendsEntryOn=false 時無論 lobbyTabRaw 是什麼都得到 online；分頁列的 {#if} 也含 friendsEntryOn ＋ onlineStep !== room', () => {
  assert.strictEqual(lobbyTabOf(GAME, false, 'friends'), 'online', '⚠⚠ friendsEntryOn=false 時 lobbyTab 沒有被鎖回 online ⇒ 匿名玩家的大廳可能被換掉');
  assert.strictEqual(lobbyTabOf(GAME, false, 'online'), 'online');
  assert.strictEqual(lobbyTabOf(GAME, true, 'friends'), 'friends', '正對照：非匿名時切得過去（否則上一條是恆真式）');
  assert.strictEqual(lobbyTabOf(GAME, true, 'online'), 'online');
  const cond = /\{#if (friendsEntryOn[^}]*onlineStep[^}]*)\}/.exec(GAME);
  assert.ok(cond, '找不到分頁列的 {#if}');
  const ev = (fe, st) => new Function('friendsEntryOn', 'onlineStep', 'return (' + cond[1] + ');')(fe, st);
  assert.strictEqual(ev(true, 'join'), true, '非匿名＋大廳 ⇒ 分頁列要顯示');
  assert.strictEqual(ev(true, 'room'), false, '⚠ 進了等待室不該再有分頁列');
  assert.strictEqual(ev(false, 'join'), false, '⚠⚠ 匿名玩家不該看到分頁列');
  // 兩顆分頁鈕的形狀（role=tab、class:active 綁 lobbyTab、onclick 走 lobbySwitchTab）
  // ⚠ 不能用 [^>]* 抓 ——「() =>」裡就有一個 `>`，會把屬性截斷（第一版就是這樣誤紅的）
  const btns = GAME.match(/<button class="lobby-tab"[\s\S]*?<\/button>/g) || [];
  assert.strictEqual(btns.length, 2, '分頁鈕不是恰兩顆：' + btns.length);
  for (const b of btns) {
    assert.ok(/role="tab"/.test(b) && /aria-selected=\{lobbyTab === '(online|friends)'\}/.test(b), '分頁鈕缺 role/aria-selected：' + b.slice(0, 120));
    assert.ok(/class:active=\{lobbyTab === '(online|friends)'\}/.test(b), '分頁鈕的 active 沒有綁 lobbyTab：' + b.slice(0, 120));
    assert.ok(/onclick=\{\(\) => lobbySwitchTab\('(online|friends)'\)\}/.test(b), '分頁鈕沒有走 lobbySwitchTab：' + b.slice(0, 120));
  }
  assert.ok(/<div class="lobby-tabs" role="tablist"/.test(GAME), '分頁列容器缺 role="tablist"');
});
await T('C5 .auth-user 的 CSS 逐字未動（新增節點只靠既有 flex-wrap 折行，沒有新 CSS）', () => {
  const css = GAME.slice(GAME.lastIndexOf('<style'));
  const want = '  .auth-user {\n    display: flex;\n    align-items: center;\n    gap: 0.5rem;\n    flex-wrap: wrap;\n  }\n';
  assert.ok(css.includes(want), '.auth-user 的 CSS 變了');
  assert.strictEqual((css.match(/friend/gi) || []).length, 0, 'style 區出現 friend（本版不該加任何 CSS）');
});

// ═══════════════════════════════════════════════════════════════════════════
// 【D】錦標賽區塊逐位元未動
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】錦標賽區塊 sha256');
const TOURN_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
const TOURN_SHA = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40';   // 與 test-v6278 I1／test-v6282 A2 同一把（凍結區塊）
await T('D1 ⚠⚠ 錦標賽區塊（錨點至檔尾）sha256 未變', () => {
  const i = SRV.indexOf(TOURN_ANCHOR);
  assert.ok(i > 0, '找不到錦標賽區塊錨點');
  assert.strictEqual(createHash('sha256').update(SRV.slice(i), 'utf8').digest('hex'), TOURN_SHA, '⚠⚠ 錦標賽區塊被動到了!');
});
await T('D2 掃描器自驗：差一個字元就抓得到', () => {
  const i = SRV.indexOf(TOURN_ANCHOR);
  assert.notStrictEqual(createHash('sha256').update(SRV.slice(i) + ' ', 'utf8').digest('hex'), TOURN_SHA);
});

// ═══════════════════════════════════════════════════════════════════════════
// 【E】突變測試
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】突變測試（每一條只捕 AssertionError，且要紅在預期那一條）');
const mut = (a, b) => { assert.strictEqual(API.split(a).length - 1, 1, '突變錨點不唯一：' + a); return API.replace(a, b); };
await T('E1 突變：429 也記 unsupported ⇒ A1 ⑥ 必紅', () =>
  mutantMustBreak('429→unsupported', () => assertSeven(mut("if (status === 429) return fail('busy', serverMsg || FRIENDS_BUSY_MSG, code, status);", "if (status === 429) { remember(ctx.uid, 'unsupported'); return fail('unsupported', FRIENDS_BUSY_MSG, code, status); }")), '⑥'));
await T('E2 突變：401 也記 unsupported ⇒ A1 ⑤ 必紅', () =>
  mutantMustBreak('401→unsupported', () => assertSeven(mut("if (status === 401 || code === 'friends-auth-required') return fail('auth', serverMsg || FRIENDS_AUTH_MSG, code, status);", "if (status === 401 || code === 'friends-auth-required') { remember(ctx.uid, 'unsupported'); return fail('unsupported', FRIENDS_AUTH_MSG, code, status); }")), '⑤'));
await T('E3 突變：拿掉 friends-disabled 的分支 ⇒ A1 ③ 必紅', () =>
  mutantMustBreak('no-disabled', () => assertSeven(mut("if (knowsEndpoint && code === 'friends-disabled') {", "if (false) {")), '③'));
await T('E4 突變：暫時性 5xx 也記 unsupported ⇒ A1 ④ 必紅', () =>
  mutantMustBreak('5xx→unsupported', () => assertSeven(mut("if (status >= 500) return fail('transient', serverMsg || FRIENDS_TRANSIENT_MSG, code, status);", "if (status >= 500) { remember(ctx.uid, 'unsupported'); return fail('unsupported', FRIENDS_TRANSIENT_MSG, code, status); }")), '④'));
await T('E5 突變：網路錯也寫負向快取 ⇒ A1 ⑦ 必紅', () =>
  mutantMustBreak('network→cache', () => assertSeven(mut("return fail('network', FRIENDS_NETWORK_MSG, 'network', 0);", "remember(ctx.uid, 'unsupported'); return fail('network', FRIENDS_NETWORK_MSG, 'network', 0);")), '⑦'));
await T('E6 突變：入口不看匿名 ⇒ A4 必紅', async () => {
  // v6.284：friendsBattleEntryVisible 也有同一行 ⇒ 錨點連下一行（friendsAvailability 那行）才唯一
  const m = mut('if (anonymous || !uid) return false;\n  const a = friendsAvailability(uid, now);', 'if (!uid) return false;\n  const a = friendsAvailability(uid, now);');
  await mutantMustBreak('ignore-anonymous', async () => {
    const ls = makeLS(); ls.setItem('ptcg_friends_avail:FU', JSON.stringify({ v: 'on', at: Date.now() }));
    const mod = loadApi(m, { ls }).load(mkFetch(() => jsonRes(200, listBody())));
    assert.strictEqual(mod.friendsEntryVisible('FU', true), false, '匿名還顯示入口');
  }, '匿名還顯示入口');
});
await T('E7 突變：負向快取沒有 TTL ⇒ A6 必紅', async () => {
  // v6.290：TTL 判斷收斂到 aliveAvail（session 記憶與 localStorage 共用）⇒ 突變體＝把「now - at < ttl」拿掉（兩邊一起失去 TTL）
  const m = mut("if (ttl !== null && typeof at === 'number' && now - at < ttl) return v as FriendsAvailability;", 'if (ttl !== null) return v as FriendsAvailability;');
  await mutantMustBreak('no-ttl', async () => {
    const ls = makeLS();
    const a = loadApi(m, { ls }).load(mkFetch(() => jsonRes(503, { code: 'friends-disabled', error: 'x' })));
    await a.fetchFriendsList(CTX);
    const later = Date.now() + a.FRIENDS_DISABLED_CACHE_TTL_MS + 1000;
    const b = loadApi(m, { ls }).load(mkFetch(() => jsonRes(200, listBody())));
    assert.strictEqual(b.friendsAvailability('FU', later), 'unknown', 'TTL 過期應回 unknown');
  }, 'TTL 過期應回 unknown');
});

console.log('\n══ v6.283 好友 P1a 守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
