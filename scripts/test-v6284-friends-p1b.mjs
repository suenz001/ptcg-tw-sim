// v6.284 守衛：好友功能 P1b —— 手機直式大廳入口（零位移）／賽後「將對手加為好友」鈕／`goto` 未 import 修正。
//
// 守什麼（能行為端就行為端；靜態只用在行為端測不到的地方）：
//   【F】HEAD-FAIL 錨點：friends-api.ts 用 esbuild 轉 CJS 實跑，三個新 export（friendsBattleEntryVisible／
//        requestFriendFromBattle／friendsRequestReplyText）BASE（v6.283）沒有 ⇒ F0 必紅並中止。
//   【A】friends-api.ts 行為端：賽後鈕的顯示判定（v6.285 起與大廳入口同一條：未知也顯示，匿名／disabled／unsupported 藏）；{roomCode}／{matchId} 各打對
//        端點、body 只有那一個 key、永遠沒有 email；空目標零請求；403／409（帶 friends- 錯誤碼）⇒ rejected＋伺服器原話；
//        {email} 入口重構後行為不變；回應文案四態。
//   【B】靜態：friends-api.ts 零 setInterval／setTimeout／rAF、零 import（沿用 v6.283 B1/B5）。
//   【C】⭐⭐ 框架安全（game/+page.svelte）：
//        C1 對戰版面分支區間零 `friend`（＋塞字正對照）；C2 賽後鈕落在 `{/if}<!-- /isPortraitMobile && playing -->` **之後**、
//        `.gameover-modal` 區塊內、且是該區塊最後一個節點（既有四顆鈕之後）；C3 大廳兩份入口以 isPortraitMobile **互斥**
//        （把兩個條件抽出來**求值**：手機只渲染尾端那份、桌機只渲染 .auth-user 那份）；C4 `friendsBattleTarget` 的推導
//        抽出來**實跑**（正式賽 mr_ 前綴 → matchId；測試房／觀戰／本機 ⇒ null；休閒 ⇒ roomCode）；C5 零新 CSS、
//        `.auth-user` CSS 逐字未動；C6 三種桌機對戰版面沒有任何 selector 碰 .gameover-modal（三版面共用同一份）；
//        C7 設定 modal 區塊的 friend 全落在尾端好友 section 內（v6.285 接上；原「零 friend」停手條款已解除）。
//   【D】goto：import 恰一行；⭐ 行為端＝把 initNotifyNav 的回呼從檔案抽出來實跑（有 goto 綁定 ⇒ 導頁；沒有 ⇒ 靜默不導頁
//        ＝BASE 的症狀），並把 notify.ts bundle 起來走完整條「SW message → onNavigate → goto」。
//   【E】錦標賽區塊 sha256 逐位元未動（與 v6.278 I1 同一把）。
//   【M】突變測試：每一條只捕 AssertionError，且斷言紅在**預期那一條**。
//
// ⚠ 守衛安慰劑型態逐一避開：不 pin 版本號；斷言全部求值不比字面；mutantMustBreak 只捕 AssertionError 並比對訊息片段；
//   掃描器有下限斷言與正對照。零位移的 DOM 量測不在這裡（CI 沒有瀏覽器）：見 scripts/measure-v6284-friends-layout.mjs。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_MPB = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const P_NOTIFY = join(ROOT, 'src/lib/notify.ts');
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + e.message); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, expectFrag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + err.message + '（預期含「' + expectFrag + '」）');
};

// ── friends-api.ts 載入器（與 test-v6283 同一套手法）────────────────────────────
const API_MARKER = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
function makeLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; }
function loadApi(src, { apiUrl = 'http://t.local', ls = makeLS() } = {}) {
  assert.ok(src.includes(API_MARKER), 'friends-api.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  const js = esbuild.transformSync(src.replace(API_MARKER, JSON.stringify(apiUrl)), { loader: 'ts', format: 'cjs' }).code;
  const m = { exports: {} };
  return { ls, load: (fetchImpl) => { new Function('module', 'exports', 'fetch', 'localStorage', js)(m, m.exports, fetchImpl, ls); return m.exports; } };
}
const mkFetch = (respFn) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return respFn(calls.length, url, init); }; f.calls = calls; return f; };
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) }, json: async () => body });
const listBody = () => ({ friendsApi: 1, me: { uid: 'FU', nick: '我' }, friends: [], incoming: [], outgoing: [], blocked: [], limit: 100, truncated: false });
const CTX = { uid: 'FU', token: 'TOK' };

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】HEAD-FAIL 錨點');
let API = '', GAME = '', MPB = '', NOTIFY = '', SRV = '';
await T('F0 HEAD-FAIL：friends-api.ts 匯出 friendsBattleEntryVisible／requestFriendFromBattle／friendsRequestReplyText（BASE v6.283 沒有 ⇒ 這一條必紅）', () => {
  for (const p of [P_API, P_GAME, P_MPB, P_NOTIFY, P_SRV]) assert.ok(existsSync(p), '缺 ' + p);
  API = readFileSync(P_API, 'utf8'); GAME = readFileSync(P_GAME, 'utf8'); MPB = readFileSync(P_MPB, 'utf8'); NOTIFY = readFileSync(P_NOTIFY, 'utf8'); SRV = readFileSync(P_SRV, 'utf8');
  const mod = loadApi(API).load(mkFetch(() => jsonRes(200, listBody())));
  for (const k of ['friendsBattleEntryVisible', 'requestFriendFromBattle', 'friendsRequestReplyText', 'friendsEntryVisible', 'requestFriendByEmail']) assert.strictEqual(typeof mod[k], 'function', 'friends-api.ts 沒有匯出 ' + k);
  assert.ok(GAME.length > 900000, 'game/+page.svelte 只有 ' + GAME.length + ' 字元 —— 被截斷？');
});
if (fail) { console.log('\n══ v6.284 好友 P1b 守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新 export 不存在，後續斷言無法進行）══'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】friends-api.ts 行為端');
async function assertBattleVisible(src) {
  const ls = makeLS();
  const box = loadApi(src, { ls });
  const mod = box.load(mkFetch(() => jsonRes(200, listBody())));
  // v6.285 站長裁定：賽後鈕改成與大廳入口一致（未知也顯示；只有確定不支援才藏）—— 反向斷言（disabled／unsupported 必須藏）在下面與 test-v6285 B1
  assert.strictEqual(mod.friendsBattleEntryVisible('FU', false), true, '未知（沒問過伺服器）時賽後鈕沒顯示 —— v6.285 裁定「未知也顯示」（與大廳入口一致）');
  assert.strictEqual(mod.friendsEntryVisible('FU', false), true, '（對照）大廳入口在未知時應顯示');
  await mod.fetchFriendsList(CTX);
  assert.strictEqual(mod.friendsBattleEntryVisible('FU', false), true, '哨兵成功後賽後鈕應顯示');
  assert.strictEqual(mod.friendsBattleEntryVisible('FU', true), false, '匿名還顯示賽後鈕');
  assert.strictEqual(mod.friendsBattleEntryVisible(null, false), false, '沒 uid 還顯示賽後鈕');
  assert.strictEqual(mod.friendsBattleEntryVisible('OTHER', false), true, '（別的 uid 是 unknown ⇒ v6.285 起未知也顯示）');
  const b = loadApi(src, { ls }).load(mkFetch(() => jsonRes(503, { code: 'friends-disabled', error: 'x' })));
  assert.strictEqual(b.friendsBattleEntryVisible('FU', false), true, '重新整理後正向快取應保留');
  await b.fetchFriendsList(CTX);
  assert.strictEqual(b.friendsBattleEntryVisible('FU', false), false, 'disabled 之後還顯示賽後鈕');
}
await T('A1 ⭐ 賽後鈕顯示判定（v6.285 起與大廳入口同一條規則）：未知 true、哨兵成功 true、匿名／無 uid false、disabled false（反向：確定不支援必藏）、正向快取跨實例', () => assertBattleVisible(API));
await T('A2 賽後鈕判定是純函式：呼叫 200 次零請求', async () => {
  const f = mkFetch(() => { throw new assert.AssertionError({ message: '判定發了請求' }); });
  const mod = loadApi(API).load(f);
  for (let i = 0; i < 200; i++) mod.friendsBattleEntryVisible('FU', false);
  assert.strictEqual(f.calls.length, 0);
});
async function assertBattleRequest(src) {
  const f = mkFetch(() => jsonRes(200, { ok: true, friendsApi: 1, status: 'pending', fid: 'f1' }));
  const mod = loadApi(src).load(f);
  const r1 = await mod.requestFriendFromBattle(CTX, { roomCode: ' abcd ' });
  assert.deepStrictEqual(r1, { ok: true, data: { status: 'pending', fid: 'f1', already: false } });
  assert.strictEqual(f.calls[0].url, 'http://t.local/api/friends/request', '打錯端點：' + f.calls[0].url);
  assert.strictEqual(f.calls[0].init.method, 'POST');
  assert.ok(!/email/i.test(f.calls[0].init.body), '賽後入口的 body 出現 email：' + f.calls[0].init.body);
  assert.deepStrictEqual(JSON.parse(f.calls[0].init.body), { roomCode: 'ABCD' }, '休閒 body 不是只有 roomCode（大寫、去空白）');
  assert.strictEqual(f.calls[0].init.headers['Content-Type'], 'application/json', '漏帶 Content-Type');
  assert.strictEqual(f.calls[0].init.headers.Authorization, 'Bearer TOK');
  const r2 = await mod.requestFriendFromBattle(CTX, { matchId: 'ev1_r2_m3' });
  assert.strictEqual(r2.ok, true);
  assert.deepStrictEqual(JSON.parse(f.calls[1].init.body), { matchId: 'ev1_r2_m3' }, '錦標賽 body 不是只有 matchId');
  for (const c of f.calls) assert.ok(!/email/i.test(c.init.body), '賽後入口的 body 出現 email：' + c.init.body);
  // 空目標：零請求、rejected
  const n0 = f.calls.length;
  const r3 = await mod.requestFriendFromBattle(CTX, { roomCode: '  ' });
  const r4 = await mod.requestFriendFromBattle(CTX, { matchId: '' });
  assert.strictEqual(f.calls.length, n0, '空目標還發了請求');
  assert.strictEqual(r3.ok, false); assert.strictEqual(r3.kind, 'rejected'); assert.strictEqual(r4.kind, 'rejected');
  // 沒 token 零請求
  const r5 = await mod.requestFriendFromBattle({ uid: 'FU', token: null }, { roomCode: 'ABCD' });
  assert.strictEqual(r5.kind, 'auth'); assert.strictEqual(f.calls.length, n0, '沒 token 還發了請求');
}
await T('A3 ⭐ {roomCode}／{matchId} 各打 POST /api/friends/request、body 只有那一個 key、永遠沒有 email；空目標／沒 token 零請求', () => assertBattleRequest(API));
await T('A4 伺服器拒絕（403 friends-not-in-room／409 friends-opponent-anonymous／409 friends-limit-reached，皆帶 friends- 碼）⇒ rejected＋伺服器原話，且記正向', async () => {
  for (const [st, code, msg] of [[403, 'friends-not-in-room', '只能對自己對戰過的對手送出好友邀請'], [409, 'friends-opponent-anonymous', '對方沒有以 email 帳號登入，無法加為好友'], [409, 'friends-limit-reached', '好友已達上限（100 人）']]) {
    const mod = loadApi(API).load(mkFetch(() => jsonRes(st, { error: msg, code })));
    const r = await mod.requestFriendFromBattle(CTX, { roomCode: 'ABCD' });
    assert.strictEqual(r.kind, 'rejected', code + ' 實得 ' + r.kind);
    assert.strictEqual(r.message, msg, code + ' 沒把伺服器的話原樣給玩家');
    assert.strictEqual(mod.friendsAvailability('FU'), 'on', code + '：伺服器認得端點 ⇒ 應記正向');
  }
  // 429 cooldown ⇒ busy；404 HTML ⇒ unsupported（賽後鈕之後就藏）
  const m2 = loadApi(API).load(mkFetch(() => jsonRes(429, { error: '24 小時後才能再送出', code: 'friends-cooldown', friendsApi: 1 })));
  assert.strictEqual((await m2.requestFriendFromBattle(CTX, { matchId: 'x' })).kind, 'busy');
  const m3 = loadApi(API).load(mkFetch(() => ({ status: 404, ok: false, headers: { get: () => 'text/html' }, json: async () => { throw new SyntaxError('x'); } })));
  assert.strictEqual((await m3.requestFriendFromBattle(CTX, { matchId: 'x' })).kind, 'unsupported');
  assert.strictEqual(m3.friendsBattleEntryVisible('FU', false), false);
});
function assertReplyText(mod) {
  assert.strictEqual(mod.friendsRequestReplyText({ status: 'pending', fid: 'x', already: false }), '✅ 邀請已送出，等待對方確認');
  assert.strictEqual(mod.friendsRequestReplyText({ status: 'pending', fid: 'x', already: true }), '⏳ 已邀請過，等待對方確認');
  assert.strictEqual(mod.friendsRequestReplyText({ status: 'accepted', fid: 'x', already: false }), '✅ 雙方已成為好友');
  assert.strictEqual(mod.friendsRequestReplyText({ status: 'accepted', fid: 'x', already: true }), '✅ 對方已經是好友');
}
await T('A5 回應文案四態（pending／pending-already／accepted／accepted-already）各不相同且含關鍵字', () => { const mod = loadApi(API).load(mkFetch(() => jsonRes(200, {}))); assertReplyText(mod); });
await T('A6 重構後 {email} 入口行為不變：body 只有 {email}（trim）、404 friends-no-such-account ⇒ rejected＋原話', async () => {
  const f = mkFetch(() => jsonRes(404, { error: '查無此 email 的帳號', code: 'friends-no-such-account' }));
  const mod = loadApi(API).load(f);
  const r = await mod.requestFriendByEmail(CTX, '  Nobody@Example.com ');
  assert.strictEqual(r.kind, 'rejected'); assert.strictEqual(r.message, '查無此 email 的帳號');
  assert.deepStrictEqual(JSON.parse(f.calls[0].init.body), { email: 'Nobody@Example.com' });
  assert.strictEqual(f.calls[0].url, 'http://t.local/api/friends/request');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】靜態：零輪詢、零 import');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}
await T('B1 friends-api.ts 仍零 setInterval／setTimeout／rAF（剝註解後數；沿用 v6.283 B1）', () => {
  const c = stripComments(API);
  assert.strictEqual((c.match(/setInterval\s*\(/g) || []).length, 0, '有 setInterval');
  assert.strictEqual((c.match(/setTimeout\s*\(/g) || []).length, 0, '有 setTimeout');
  assert.strictEqual((c.match(/requestAnimationFrame\s*\(/g) || []).length, 0, '有 rAF');
  assert.strictEqual((c.match(/^\s*import\s/gm) || []).length, 0, 'friends-api.ts 開始 import 東西了（守衛就載不動了）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】框架安全：game/+page.svelte');
const BATTLE_START = '  {#if isPortraitMobile && game}\n';
const BATTLE_END = '{/if}<!-- /isPortraitMobile && playing -->';
function battleRegion(game) {
  const s = game.indexOf(BATTLE_START); const e = game.indexOf(BATTLE_END, s);
  assert.ok(s > 0 && e > s, '找不到對戰版面分支的起訖錨點');
  return { s, e: e + BATTLE_END.length, text: game.slice(s, e + BATTLE_END.length) };
}
function assertBattleRegionClean(game) {
  const r = battleRegion(game);
  assert.ok(r.text.length > 20000, '對戰版面區間只有 ' + r.text.length + ' 字元 —— 錨點抓錯？');
  assert.ok(r.text.includes('<MobilePortraitBattle') && r.text.includes('{:else}'), '區間內看不到手機／桌機兩套分支');
  const hits = r.text.match(/friend/gi) || [];
  assert.strictEqual(hits.length, 0, '⚠⚠ 對戰版面分支出現 ' + hits.length + ' 個 friend 字樣');
}
await T('C1 ⭐⭐ 手機／桌機兩套對戰版面分支區間零 `friend`（正對照：勝負 modal 區間必須有）；MobilePortraitBattle.svelte 零 friend', () => {
  assertBattleRegionClean(GAME);
  const s = GAME.indexOf(BATTLE_START);
  const mutated = GAME.slice(0, s + BATTLE_START.length) + '<!-- friend -->' + GAME.slice(s + BATTLE_START.length);
  let err = null; try { assertBattleRegionClean(mutated); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err && /friend 字樣/.test(err.message), '掃描器抓不到塞進去的 friend');
  assert.strictEqual((MPB.match(/friend/gi) || []).length, 0, 'MobilePortraitBattle.svelte 出現 friend');
  const go = gameoverBlock(GAME);
  assert.ok((go.text.match(/friend/gi) || []).length >= 4, '正對照：勝負 modal 區間應有 friend 字樣');
});
function gameoverBlock(game) {
  const s = game.indexOf('<div class="gameover-modal"');
  const e = game.indexOf('<!-- ── v4.913 Auth modal', s);
  assert.ok(s > 0 && e > s, '找不到勝負 modal 區塊錨點');
  return { s, e, text: game.slice(s, e) };
}
await T('C2 ⭐ 賽後鈕：勝負 modal 內恰一處（v6.285 起全檔兩處：＋設定 modal）、落在 `{/if}<!-- /isPortraitMobile && playing -->` 之後、勝負 modal 區塊內、且在既有按鈕分支 {/if} 之後（＝最後一個節點）', () => {
  const MK = '{#if friendsBattleOn && friendsBattleTarget}';
  assert.strictEqual(GAME.split(MK).length - 1, 2, '賽後鈕 markup 出現次數不是 2（v6.285 起：勝負 modal ＋ 設定 modal 好友 section，各恰一處）');
  const go = gameoverBlock(GAME);
  assert.strictEqual(go.text.split(MK).length - 1, 1, '勝負 modal 區塊內的賽後鈕不是恰一處');
  const mk = GAME.indexOf(MK, go.s);
  const br = battleRegion(GAME);
  assert.ok(mk > br.e, '賽後鈕落在對戰版面分支之前／之內');
  assert.ok(mk > go.s && mk < go.e, '賽後鈕不在勝負 modal 區塊內');
  const body = go.text;
  const lastBranchEnd = body.lastIndexOf('{/if}', body.indexOf(MK));
  const lastExisting = body.lastIndexOf('<a href="{base}/" class="btn-secondary">回首頁</a>');
  assert.ok(lastExisting > 0 && lastBranchEnd > lastExisting && body.indexOf(MK) > lastBranchEnd, '賽後鈕沒有放在既有按鈕分支（tournament／online／local）的 {/if} 之後');
  const tail = body.slice(body.indexOf(MK));
  const closeIdx = tail.indexOf('{/if}\n      </div>\n    </div>\n  {/if}');
  assert.ok(closeIdx > 0, '賽後鈕之後不是直接收 .gameover-modal-body（它必須是最後一個節點）');
  const inner = tail.slice(0, closeIdx);
  assert.ok(/<button class="btn-secondary" onclick=\{addOpponentAsFriend\} disabled=\{friendReqState === 'busy' \|\| friendReqState === 'done'\}/.test(inner), '按鈕形狀不對（要 btn-secondary、busy／done 停用）');
  assert.ok(/\{#if friendReqState === 'idle'\}👥 將對手加為好友\{:else if friendReqState === 'busy'\}⏳ 送出中…\{:else\}\{friendReqMsg\}\{\/if\}/.test(inner), '同一顆鈕的三態文字不對（送出後要換成狀態文字、同高）');
  assert.strictEqual((inner.match(/<button/g) || []).length, 1, '賽後新增了不只一顆按鈕（會二次位移）');
});
/** 把 svelte 檔裡 `{#if COND}` 的 COND 抽出來，用指定的變數求值。 */
function evalCond(cond, vars) { return new Function(...Object.keys(vars), 'return (' + cond + ');')(...Object.values(vars)); }
function lobbyEntryConds(game) {
  const lobby = game.indexOf('<!-- ─── 線上 Lobby ─── -->');
  const roomStep = game.indexOf("{:else if onlineStep === 'room'}", lobby);
  assert.ok(lobby > 0 && roomStep > lobby, '找不到線上大廳錨點');
  const seg = game.slice(lobby, roomStep);
  const conds = [...seg.matchAll(/\{#if ([^}]*friendsEntryOn[^}]*)\}/g)].map((m) => ({ cond: m[1], idx: m.index }));
  assert.strictEqual(conds.length, 2, '線上大廳（join 步驟）內 friendsEntryOn 的 {#if} 不是恰 2 個：' + JSON.stringify(conds.map((c) => c.cond)));
  return { seg, conds, h1: seg.indexOf('<h1>🌐 線上連線對戰</h1>'), formEnd: seg.indexOf("{#if onlineError && !showCreateForm}<p class=\"warn\">{onlineError}</p>{/if}\n      </div>") };
}
function assertLobbyMutex(game) {
  const { seg, conds, h1, formEnd } = lobbyEntryConds(game);
  for (const pm of [true, false]) {
    const on = conds.filter((c) => evalCond(c.cond, { friendsEntryOn: true, isPortraitMobile: pm }));
    assert.strictEqual(on.length, 1, 'isPortraitMobile=' + pm + ' 時渲染了 ' + on.length + ' 份入口（必須恰一份）');
    const off = conds.filter((c) => evalCond(c.cond, { friendsEntryOn: false, isPortraitMobile: pm }));
    assert.strictEqual(off.length, 0, 'friendsEntryOn=false 時還有入口');
    if (pm) assert.ok(on[0].idx > formEnd && formEnd > 0, '手機那份入口沒有在 .lobby-unified 之後');
    else assert.ok(on[0].idx < h1 && h1 > 0, '桌機那份入口不在 h1 之前（.auth-user 內）');
  }
  const mobileLine = seg.split('\n').find((l) => l.includes('{#if friendsEntryOn && isPortraitMobile}'));
  assert.ok(mobileLine, '找不到手機入口行');
  const next = seg.slice(seg.indexOf(mobileLine) + mobileLine.length);   // seg 在 {:else if onlineStep === 'room'} 之前截止
  assert.ok(/^\s*<a class="back" href="\{base\}\/friends"/.test(next), '手機入口不是沿用 .back 樣式的 <a>：' + next.trim().slice(0, 80));
  const restLines = next.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepStrictEqual(restLines.slice(1), ['{/if}'], '手機入口不是 join 步驟的最後一個節點（後面還有既有元素會被推下去）：' + JSON.stringify(restLines.slice(1, 4)));
}
await T('C3 ⭐ 大廳兩份入口以 isPortraitMobile 互斥（條件抽出求值：手機只渲染尾端那份、桌機只渲染 .auth-user 那份；手機那份是 join 步驟最後一個節點、沿用 .back）', () => assertLobbyMutex(GAME));
/** 把 `const friendsBattleTarget = $derived.by((): FriendsBattleTarget | null => { … });` 的函式本體抽出來實跑。 */
function extractTargetFn(game) {
  const head = 'const friendsBattleTarget = $derived.by((): FriendsBattleTarget | null => {';
  const s = game.indexOf(head);
  assert.ok(s > 0, '找不到 friendsBattleTarget 的 $derived.by');
  let i = s + head.length - 1, d = 0, j = i;
  for (; j < game.length; j++) { if (game[j] === '{') d++; else if (game[j] === '}') { d--; if (d === 0) break; } }
  const body = game.slice(s + head.length, j);
  return (vars) => new Function(...Object.keys(vars), body)(...Object.values(vars));
}
function assertTargetTable(game) {
  const fn = extractTargetFn(game);
  const base = { mode: 'online', isSpectator: false, isTournament: false, tActiveRoom: 'TOURNAMENT-TEST', roomCode: '' };
  assert.deepStrictEqual(fn({ ...base, isTournament: true, tActiveRoom: 'mr_ev1_r2_m3' }), { matchId: 'ev1_r2_m3' }, '正式賽：mr_ 前綴應剝掉成 matchId');
  assert.strictEqual(fn({ ...base, isTournament: true, tActiveRoom: 'TOURNAMENT-TEST' }), null, '測試房沒有場次 ⇒ null');
  assert.strictEqual(fn({ ...base, isTournament: true, tActiveRoom: 'mr_' }), null, '只有前綴 ⇒ null');
  assert.strictEqual(fn({ ...base, isTournament: true, tActiveRoom: 'mr_x', isSpectator: true }), null, '觀戰 ⇒ null');
  assert.deepStrictEqual(fn({ ...base, roomCode: 'ABCD' }), { roomCode: 'ABCD' }, '休閒 ⇒ roomCode');
  assert.strictEqual(fn({ ...base, roomCode: '' }), null, '沒房號 ⇒ null');
  assert.strictEqual(fn({ ...base, roomCode: 'ABCD', mode: 'local' }), null, '本機對戰 ⇒ null');
  assert.strictEqual(fn({ ...base, roomCode: 'ABCD', isSpectator: true }), null, '休閒觀戰 ⇒ null');
  assert.strictEqual(fn({ ...base, mode: null }), null, '沒 mode ⇒ null');
}
await T('C4 ⭐ friendsBattleTarget 推導實跑：正式賽 mr_ 前綴 → matchId；測試房／只剩前綴／觀戰／本機／沒房號 ⇒ null；休閒 ⇒ roomCode', () => assertTargetTable(GAME));
await T('C5 零新 CSS（style 區零 friend）；.auth-user 的 CSS 逐字未動；.auth-user 仍三份', () => {
  const css = GAME.slice(GAME.lastIndexOf('<style'));
  assert.strictEqual((css.match(/friend/gi) || []).length, 0, 'style 區出現 friend');
  assert.ok(css.includes('  .auth-user {\n    display: flex;\n    align-items: center;\n    gap: 0.5rem;\n    flex-wrap: wrap;\n  }\n'), '.auth-user 的 CSS 變了');
  assert.strictEqual((GAME.match(/class="auth-user"/g) || []).length, 3, '.auth-user 份數變了');
});
await T('C6 三種桌機對戰版面共用同一份勝負 modal：CSS 內所有含 gameover-modal 的規則都沒有 tablet-layout／tabletop／fable／classic；modal 是 fixed＋max-height＋overflow-y:auto', () => {
  const css = GAME.slice(GAME.lastIndexOf('<style'));
  const lines = css.split('\n').filter((l) => l.includes('gameover-modal'));
  assert.ok(lines.length >= 8, '含 gameover-modal 的 CSS 行只有 ' + lines.length + ' 行 —— 掃描器壞了？');
  for (const l of lines) assert.ok(!/tablet-layout|tabletop|fable|classic/.test(l), '勝負 modal 有版面專屬 selector：' + l.trim());
  const block = css.slice(css.indexOf('  .gameover-modal {'), css.indexOf('  .gameover-modal-header {'));
  assert.ok(/position: fixed;/.test(block) && /max-height: 88vh;/.test(block) && /overflow-y: auto;/.test(block), '.gameover-modal 的 fixed／max-height／overflow-y 變了');
});
await T('C7 設定 modal 區塊的 `friend` 全部落在尾端 {#if friendsEntryOn} 好友 section 內（v6.285 接上；捲動修正與位置細節由 test-v6285 釘住）', () => {
  const s = GAME.indexOf('<!-- Settings Modal (Audio & BGM) -->');
  const e = GAME.indexOf('<!-- v4.60 對方提議 modal -->', s);
  assert.ok(s > 0 && e > s, '找不到設定 modal 錨點');
  const seg = GAME.slice(s, e).replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(seg.includes('settings-section') && seg.length > 5000, '設定 modal 區塊抓錯');
  const at = seg.lastIndexOf('{#if friendsEntryOn}');
  assert.ok(at > 0, '設定 modal 內找不到 {#if friendsEntryOn} 好友 section');
  assert.strictEqual((seg.slice(0, at).match(/friend/gi) || []).length, 0, '設定 modal 內有 friend 字樣落在好友 section 之前（會推動既有 section）');
  assert.ok((seg.slice(at).match(/friend/gi) || []).length >= 4, '好友 section 內的 friend 字樣太少 —— 區塊抓錯？');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】goto 未 import 修正（行為端）');
const NAV_LINE_RE = /initNotifyNav\((\(url\) => \{ try \{[^\n]*?\} catch \{[^}]*\} \})\);/;   // 回呼本體整段抓出來（內容不比字面，交給實跑）
function extractNavCallback(game) {
  const m = game.match(NAV_LINE_RE);
  assert.ok(m, '找不到 initNotifyNav 的回呼（形狀變了就更新這條 regex）');
  return m[1];
}
/** 用指定的綁定跑那段回呼原始碼：goto 有綁 ⇒ 回傳呼叫紀錄；沒綁 ⇒ ReferenceError 會被回呼自己的 try/catch 吞掉。 */
function runNavCallback(cbSrc, { withGoto, href }) {
  const calls = [];
  const location = { href };
  const args = withGoto ? ['goto', 'location'] : ['location'];
  const vals = withGoto ? [(u) => calls.push(u), location] : [location];
  const cb = new Function(...args, 'return (' + cbSrc + ');')(...vals);
  cb('https://www.ptcg-tw-sim.com/tournament?ev=1');
  return calls;
}
function assertGoto(game) {
  const imports = game.match(/^  import \{ goto \} from '\$app\/navigation';/gm) || [];
  assert.strictEqual(imports.length, 1, "import { goto } from '$app/navigation' 不是恰一行（實得 " + imports.length + '）');
  const cb = extractNavCallback(game);
  assert.deepStrictEqual(runNavCallback(cb, { withGoto: true, href: 'https://www.ptcg-tw-sim.com/game' }), ['https://www.ptcg-tw-sim.com/tournament?ev=1'], '有 goto 綁定時回呼沒有導頁');
  assert.deepStrictEqual(runNavCallback(cb, { withGoto: true, href: 'https://www.ptcg-tw-sim.com/tournament?ev=1&x=1' }), [], '已在目標頁還導頁');
  // BASE 的症狀：goto 沒綁定 ⇒ ReferenceError 被回呼的 try/catch 吞掉 ⇒ 靜默不導頁、也不丟例外
  assert.deepStrictEqual(runNavCallback(cb, { withGoto: false, href: 'https://www.ptcg-tw-sim.com/game' }), [], '（症狀重現）goto 未綁定時應靜默');
  const gotoCalls = (stripComments(game.slice(0, game.indexOf('</script>'))).match(/\bgoto\(/g) || []);
  assert.ok(gotoCalls.length >= 1, 'script 區沒有任何 goto( 呼叫 —— 修的東西不見了？');
}
await T('D1 ⭐ goto：import 恰一行；回呼抽出實跑 —— 有 goto ⇒ 導頁、已在目標頁 ⇒ 不導、goto 未綁定（BASE）⇒ 靜默不導（症狀重現）', () => assertGoto(GAME));
await T('D2 ⭐ 整條鏈實跑：notify.ts bundle → SW message {type:ptcg-notify-nav,url} → onNavigate → 頁面回呼 → goto', () => {
  const js = esbuild.buildSync({ entryPoints: [P_NOTIFY], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' }).outputFiles[0].text;
  const listeners = [];
  const navigator = { serviceWorker: { addEventListener: (t, fn) => listeners.push({ t, fn }) } };
  const localStorage = makeLS();
  const window = {};
  const m = { exports: {} };
  new Function('module', 'exports', 'window', 'navigator', 'localStorage', js)(m, m.exports, window, navigator, localStorage);
  const calls = [];
  const cb = new Function('goto', 'location', 'return (' + extractNavCallback(GAME) + ');')((u) => calls.push(u), { href: 'https://www.ptcg-tw-sim.com/game' });
  m.exports.initNotifyNav(cb);
  const l = listeners.find((x) => x.t === 'message');
  assert.ok(l, 'initNotifyNav 沒有掛 serviceWorker message 監聽');
  l.fn({ data: { type: 'other', url: 'x' } });
  assert.deepStrictEqual(calls, [], '非 ptcg-notify-nav 訊息也導頁');
  l.fn({ data: { type: 'ptcg-notify-nav', url: 'https://www.ptcg-tw-sim.com/tournament' } });
  assert.deepStrictEqual(calls, ['https://www.ptcg-tw-sim.com/tournament'], 'SW 訊息沒有走到 goto');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】錦標賽區塊 sha256');
const TOURN_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
const TOURN_SHA = 'e7c15148d4bc39ea62682b735625b9fddf6b960369f20d9e339158c090075f40';   // 與 test-v6278 I1／test-v6283 D1 同一把（凍結區塊）
await T('E1 ⚠⚠ 錦標賽區塊（錨點至檔尾）sha256 未變（本版不動 server_admin_patch.js）', () => {
  const i = SRV.indexOf(TOURN_ANCHOR);
  assert.ok(i > 0, '找不到錦標賽區塊錨點');
  assert.strictEqual(createHash('sha256').update(SRV.slice(i), 'utf8').digest('hex'), TOURN_SHA, '⚠⚠ 錦標賽區塊被動到了!');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【M】突變測試（每一條只捕 AssertionError，且要紅在預期那一條）');
const mutA = (a, b) => { assert.strictEqual(API.split(a).length - 1, 1, '突變錨點不唯一：' + a); return API.replace(a, b); };
const mutG = (a, b) => { assert.strictEqual(GAME.split(a).length - 1, 1, '突變錨點不唯一：' + a.slice(0, 60)); return GAME.replace(a, b); };
await T('M1 突變：賽後鈕判定改回只認 on（＝v6.284）⇒ A1 必紅在「未知」那條', () =>
  mutantMustBreak('battle=on-only', () => assertBattleVisible(mutA("  return friendsEntryVisible(uid, anonymous, now);\n}", "  if (anonymous || !uid) return false;\n  return friendsAvailability(uid, now) === 'on';\n}")), '未知（沒問過伺服器）時賽後鈕沒顯示'));
await T('M2 突變：賽後鈕判定不看匿名 ⇒ A1 必紅', () =>
  mutantMustBreak('ignore-anon', () => assertBattleVisible(mutA("  return friendsEntryVisible(uid, anonymous, now);\n}", "  return friendsEntryVisible(uid, false, now);\n}")), '匿名還顯示賽後鈕'));
await T('M3 突變：休閒 body 多帶 email 欄位 ⇒ A3 必紅', () =>
  mutantMustBreak('body+email', () => assertBattleRequest(mutA("return postFriendRequest(ctx, { roomCode: code });", "return postFriendRequest(ctx, { roomCode: code, email: 'leak@x.com' });")), '出現 email'));
await T('M4 突變：空 roomCode 也照發 ⇒ A3 必紅', () =>
  mutantMustBreak('empty-send', () => assertBattleRequest(mutA("  if (!code) return fail('rejected', '找不到這場對戰的房號。', 'no-target', 0);\n", '')), '空目標還發了請求'));
await T('M5 突變：把賽後鈕搬進對戰版面分支（桌機 {:else} 之後）⇒ C1 必紅', () => {
  const MK = '        {#if friendsBattleOn && friendsBattleTarget}';
  const s = GAME.indexOf(MK, gameoverBlock(GAME).s);   // v6.285 起設定 modal 也有一份（縮排不同），取勝負 modal 內那份
  const e = GAME.indexOf('        {/if}\n', s) + '        {/if}\n'.length;
  const block = GAME.slice(s, e);
  const removed = GAME.slice(0, s) + GAME.slice(e);
  const anchor = '  {/if}<!-- /isPortraitMobile && playing -->';
  const br = battleRegion(removed);
  const insertAt = removed.lastIndexOf('{:else}', br.e) + '{:else}\n'.length;
  const mutated = removed.slice(0, insertAt) + block + removed.slice(insertAt);
  assert.ok(mutated.includes(anchor));
  return mutantMustBreak('btn-into-battle', () => assertBattleRegionClean(mutated), 'friend 字樣');
});
await T('M6 突變：賽後鈕搬到匯出鈕之前（既有鈕會被推下去）⇒ C2 必紅', async () => {
  const MK = '        {#if friendsBattleOn && friendsBattleTarget}';
  const s = GAME.indexOf(MK, gameoverBlock(GAME).s);   // 同 M5：取勝負 modal 內那份
  const e = GAME.indexOf('        {/if}\n', s) + '        {/if}\n'.length;
  const block = GAME.slice(s, e);
  const removed = GAME.slice(0, s) + GAME.slice(e);
  const at = removed.indexOf('        <div class="lobby-btns export-btns">');
  const mutated = removed.slice(0, at) + block + removed.slice(at);
  await mutantMustBreak('btn-before-export', () => {
    const go = gameoverBlock(mutated); const body = go.text; const mk = body.indexOf(MK.trim());
    const lastBranchEnd = body.lastIndexOf('{/if}', mk);
    const lastExisting = body.lastIndexOf('<a href="{base}/" class="btn-secondary">回首頁</a>');
    assert.ok(lastExisting > 0 && lastBranchEnd > lastExisting && mk > lastBranchEnd, '賽後鈕沒有放在既有按鈕分支（tournament／online／local）的 {/if} 之後');
  }, '沒有放在既有按鈕分支');
});
await T('M7 突變：桌機那份入口拿掉 !isPortraitMobile（手機會渲染兩份）⇒ C3 必紅', () =>
  mutantMustBreak('lobby-both', () => assertLobbyMutex(mutG('{#if friendsEntryOn && !isPortraitMobile}', '{#if friendsEntryOn}')), '渲染了 2 份入口'));
await T('M8 突變：手機那份入口搬到 .lobby-unified 內（容器會長高）⇒ C3 必紅', async () => {
  const line = '      {#if friendsEntryOn && isPortraitMobile}\n        <a class="back" href="{base}/friends" title="好友名單" style="margin-top:.6rem">👥 好友名單</a>\n      {/if}\n';
  assert.strictEqual(GAME.split(line).length - 1, 1, '手機入口三行形狀變了');
  const removed = GAME.replace(line, '');
  const at = removed.indexOf("{#if onlineError && !showCreateForm}<p class=\"warn\">{onlineError}</p>{/if}\n      </div>");
  const mutated = removed.slice(0, at) + line + removed.slice(at);
  await mutantMustBreak('mobile-inside-form', () => assertLobbyMutex(mutated), '.lobby-unified 之後');
});
await T('M9 突變：matchId 不剝 mr_ 前綴 ⇒ C4 必紅', () =>
  mutantMustBreak('keep-prefix', () => assertTargetTable(mutG("? { matchId: r.slice(3) } : null;", "? { matchId: r } : null;")), 'mr_ 前綴應剝掉'));
await T('M10 突變：觀戰也給目標 ⇒ C4 必紅', () =>
  mutantMustBreak('spectator-target', () => assertTargetTable(mutG("    if (mode !== 'online' || isSpectator) return null;\n    if (isTournament) {", "    if (mode !== 'online') return null;\n    if (isTournament) {")), '觀戰 ⇒ null'));
await T('M11 突變：拿掉 goto 的 import（＝BASE）⇒ D1 必紅在 import 那條', () =>
  mutantMustBreak('no-goto-import', () => assertGoto(mutG("  import { goto } from '$app/navigation';", '')), '不是恰一行'));
await T('M12 突變：回呼改成永遠不呼叫 goto（try 內拿掉）⇒ D1 必紅在導頁那條', () =>
  mutantMustBreak('no-goto-call', () => assertGoto(mutG('if (!location.href.startsWith(url)) goto(url);', 'if (!location.href.startsWith(url)) void url;')), '沒有導頁'));

console.log('\n══ v6.284 好友 P1b 守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
