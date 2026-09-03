// v6.296 守衛：線上大廳的**真分頁**（🌐 線上連線對戰 ／ 👥 好友名單）＋ 好友「備註名」UI。
//
// 守什麼（能行為端就行為端；靜態只用在行為端測不到的地方）：
//   【A】HEAD-FAIL 錨點：共用元件 $lib/friends/FriendsPanel.svelte、共用取身分 $lib/friends/auth-ctx.ts、
//        friends-api 的 setFriendAlias／FRIENDS_ALIAS_MAX_LEN／clampAlias 都存在（BASE v6.295 一個都沒有 ⇒ A0 必紅並中止）。
//   【B】備註名的資料出口（esbuild 轉 CJS **實跑**）：打對端點、body 只有 {fid, alias}、永遠沒有 email；
//        clampAlias 以**碼位**截 20（emoji 不切半）、剝零寬字元／控制字元、合併空白；
//        **空字串送得出去**（＝清除）；回應 alias 為空 ⇒ 正規化成 null；toRow 對缺欄位補 null。
//        ⚠ 上限必須與伺服器 FR_ALIAS_MAX_LEN **同一個數字**（從 server_admin_patch.js 抽出來比）。
//   【C】備註名 UI（共用元件原始碼；條件一律**求值**不比字面）：顯示優先序 alias || nick、有 alias 才多一行原暱稱、
//        編輯入口只在 status === 'accepted' 的列、輸入框 maxlength 綁常數、空字串時「儲存」不得停用、
//        整檔零 {@html}、每個 each 都有穩定 key。
//   【D】⭐⭐⭐ 框架安全：把大廳 markup 在「匿名」這組變數下**剪枝求值**，NEW 與 BASE **逐字相同**
//        （scripts/lib/svelte-if-prune.mjs；⚠ 附兩個正對照：改動被保護區塊一個位元必須翻紅、
//        非匿名時兩邊必須不同）；分頁切換**不動 onlineStep**（房間輪詢照常）。
//   【E】⭐⭐ 行為端（playwright；沒有瀏覽器就 SHALLOW-SKIP 並在結尾列出）：把共用元件真的掛起來，
//        證明「掛載前 /api/friends/* 零請求、掛載後恰一發 list」、備註名顯示與編輯的完整互動。
//   【F】回歸不變量：主檔零 DmPanel（v6.288 F1 的不變量）／對戰版面分支零好友字樣／`/friends` 路由仍掛得起共用元件。
//   【G】test chain ／版本一致（不 pin 版本號）。
//   【H】八個突變，每個都必須紅在**預期那一條**。
//
// ⚠ 紀律：只捕 assert.AssertionError；突變體必須紅在預期斷言；不 pin 死版本號／整檔 sha256；
//   掃描器一律有下限斷言與正對照。
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { pruneIfs, normalizeMarkup } from './lib/svelte-if-prune.mjs';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_FRP = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
const P_CTX = join(ROOT, 'src/lib/friends/auth-ctx.ts');
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_PAGE = join(ROOT, 'src/routes/friends/+page.svelte');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_MPB = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const P_SRV = join(ROOT, 'oracle-admin/server_admin_patch.js');
const P_PKG = join(ROOT, 'package.json');
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0; const skipped = [];
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 800)); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, frag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(frag),
    '突變體「' + name + '」紅在別條：' + String(err.message).slice(0, 300) + '（預期含「' + frag + '」）');
};
const mutate = (src, a, b) => {
  const n = src.split(a).length - 1;
  assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90));
  return src.replace(a, b);
};
const stripCmt = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點');
let FRP = '', CTX = '', API = '', PAGE = '', GAME = '', MPB = '', SRV = '', PKG = '';
await T('A0 HEAD-FAIL：FriendsPanel.svelte／auth-ctx.ts 存在且非空；friends-api 有 setFriendAlias／clampAlias／FRIENDS_ALIAS_MAX_LEN（BASE v6.295 一個都沒有 ⇒ 這一條必紅）', () => {
  assert.ok(existsSync(P_FRP), '缺共用元件 ' + P_FRP);
  assert.ok(existsSync(P_CTX), '缺共用取身分 ' + P_CTX);
  FRP = rd(P_FRP); CTX = rd(P_CTX); API = rd(P_API); PAGE = rd(P_PAGE);
  GAME = rd(P_GAME); MPB = rd(P_MPB); SRV = rd(P_SRV); PKG = rd(P_PKG);
  assert.ok(FRP.length > 8000, 'FriendsPanel.svelte 只有 ' + FRP.length + ' 字元 —— 被掏空');
  for (const k of ['export async function setFriendAlias(', 'export function clampAlias(', 'export const FRIENDS_ALIAS_MAX_LEN'])
    assert.ok(API.includes(k), 'friends-api.ts 缺 ' + k);
});
if (fail) { console.log('\n══ v6.296 大廳分頁＋備註名守衛：' + pass + ' PASS / ' + fail + ' FAIL（HEAD-FAIL：新東西不存在，後續斷言無法進行）══'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】備註名的資料出口：esbuild 轉 CJS 實跑');
const API_MARKER = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
async function loadApi(src, fetchImpl) {
  assert.ok(src.includes(API_MARKER), 'friends-api.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  const patched = src.replace(API_MARKER, "'http://t.local'");
  const out = await esbuild.transform(patched, { loader: 'ts', format: 'cjs', target: 'es2020' });
  const calls = [];
  const store = new Map();
  const sandbox = {
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return fetchImpl(); },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'fetch', 'localStorage', out.code)(module, module.exports, sandbox.fetch, sandbox.localStorage);
  return { mod: module.exports, calls };
}
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const CTX_OBJ = { uid: 'me', token: 'tok' };

await T('B1 ⭐ setFriendAlias 打 POST /api/friends/alias、body 只有 {fid, alias} 兩個 key、永遠沒有 email；回應正規化（空字串 ⇒ null）', async () => {
  const { mod, calls } = await loadApi(API, () => jsonRes(200, { ok: true, friendsApi: 1, fid: 'f1', alias: '大學同學' }));
  const r = await mod.setFriendAlias(CTX_OBJ, 'f1', '大學同學');
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(calls.length, 1, '請求數不是 1：' + calls.length);
  assert.strictEqual(calls[0].url, 'http://t.local/api/friends/alias', '打錯端點：' + calls[0].url);
  assert.strictEqual(calls[0].init.method, 'POST');
  const body = JSON.parse(calls[0].init.body);
  assert.deepStrictEqual(Object.keys(body).sort(), ['alias', 'fid'], 'body 的 key 不對：' + JSON.stringify(body));
  assert.ok(!JSON.stringify(body).includes('@'), 'body 夾帶了 email');
  assert.strictEqual(r.data.alias, '大學同學');
  const b2 = await loadApi(API, () => jsonRes(200, { ok: true, friendsApi: 1, fid: 'f1', alias: null }));
  const r2 = await b2.mod.setFriendAlias(CTX_OBJ, 'f1', '');
  assert.strictEqual(r2.data.alias, null, '清除後 alias 應為 null');
});
await T('B2 ⭐⭐ **空字串送得出去**（＝清除）：body 的 alias 是空字串、仍然發出請求（不可被前端擋掉）', async () => {
  for (const v of ['', '   ', '​']) {
    const { mod, calls } = await loadApi(API, () => jsonRes(200, { ok: true, friendsApi: 1, fid: 'f1', alias: null }));
    await mod.setFriendAlias(CTX_OBJ, 'f1', v);
    assert.strictEqual(calls.length, 1, '輸入「' + JSON.stringify(v) + '」時沒有發出清除請求');
    assert.strictEqual(JSON.parse(calls[0].init.body).alias, '', '輸入「' + JSON.stringify(v) + '」沒有正規化成空字串');
  }
});
await T('B3 ⭐ clampAlias 以**碼位**截斷（emoji 不切半）、剝零寬字元與控制字元、合併空白；上限與伺服器 FR_ALIAS_MAX_LEN 同一個數字', async () => {
  const { mod } = await loadApi(API, () => jsonRes(200, {}));
  const N = mod.FRIENDS_ALIAS_MAX_LEN;
  const m = /const FR_ALIAS_MAX_LEN = (\d+);/.exec(SRV);
  assert.ok(m, '伺服器的 FR_ALIAS_MAX_LEN 抽不到（寫法變了？）');
  assert.strictEqual(N, Number(m[1]), '前端上限 ' + N + ' ≠ 伺服器 ' + m[1]);
  assert.strictEqual(N, 20, '站長裁定的上限是 20');
  assert.strictEqual(Array.from(mod.clampAlias('あ'.repeat(30))).length, N, '沒有截到上限');
  const emo = mod.clampAlias('😀'.repeat(30));
  assert.strictEqual(Array.from(emo).length, N, 'emoji 沒有以碼位計數');
  assert.ok(!/\uD800-\uDBFF$/.test(emo), 'emoji 被從中間切成半個');
  assert.strictEqual(mod.clampAlias('a​b'), 'ab', '零寬字元沒剝掉（會讓伺服器與畫面對不上）');
  assert.strictEqual(mod.clampAlias('  a   b  '), 'a b', '空白沒有合併／trim');
  assert.strictEqual(mod.clampAlias('ab'), 'a b', '控制字元沒有換成空白');
  assert.strictEqual(mod.clampAlias(null), '', '非字串要回空字串');
});
await T('B4 ⭐ toRow：伺服器有給 alias ⇒ 帶進來；沒給／空字串 ⇒ null（舊伺服器不可以讓畫面壞掉）', async () => {
  const rows = [{ fid: 'a', status: 'accepted', nick: 'A', alias: '小A' }, { fid: 'b', status: 'accepted', nick: 'B' }, { fid: 'c', status: 'accepted', nick: 'C', alias: '' }];
  const { mod } = await loadApi(API, () => jsonRes(200, { friendsApi: 1, me: { uid: 'me' }, friends: rows, incoming: [], outgoing: [], blocked: [] }));
  const r = await mod.fetchFriendsList(CTX_OBJ);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.friends.map((x) => x.alias), ['小A', null, null]);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】備註名 UI（共用元件；條件一律求值）');
const evalExpr = (expr, vars) => new Function(...Object.keys(vars), 'return (' + expr + ');')(...Object.values(vars));
function aliasRowShapes(src) {
  const rows = [...src.matchAll(/<span class="nick">\{([^}]*)\}<\/span>\s*\n\s*\{#if ([^}]*)\}<span class="orig-nick">([^<]*)\{([^}]*)\}<\/span>\{\/if\}/g)];
  return rows.map((m) => ({ nickExpr: m[1], cond: m[2], label: m[3], origExpr: m[4] }));
}
await T('C1 ⭐⭐ 顯示優先序：四個區塊的主標題都是 `r.alias || r.nick`（求值：有 alias 顯示 alias、alias 為 null 顯示 nick），且**只有**有 alias 時才多一行「原暱稱：nick」', () => {
  const shapes = aliasRowShapes(stripCmt(FRP));
  assert.strictEqual(shapes.length, 4, '四個區塊的列不是各一組 alias/原暱稱：抽到 ' + shapes.length + ' 組 ⇒ 掃描器壞了或漏掉某一區');
  for (const s of shapes) {
    assert.strictEqual(evalExpr(s.nickExpr, { r: { alias: '備註', nick: '暱稱' } }), '備註', '有 alias 時沒有優先顯示 alias：' + s.nickExpr);
    assert.strictEqual(evalExpr(s.nickExpr, { r: { alias: null, nick: '暱稱' } }), '暱稱', 'alias 為 null 時沒有退回 nick：' + s.nickExpr);
    assert.strictEqual(evalExpr(s.nickExpr, { r: { alias: '', nick: '暱稱' } }), '暱稱', 'alias 為空字串時沒有退回 nick：' + s.nickExpr);
    assert.ok(!!evalExpr(s.cond, { r: { alias: '備註', nick: '暱稱' } }), '有 alias 時沒有顯示原暱稱：' + s.cond);
    assert.ok(!evalExpr(s.cond, { r: { alias: null, nick: '暱稱' } }), '⚠ 沒有 alias 卻顯示「原暱稱」那一行：' + s.cond);
    assert.ok(s.label.includes('原暱稱'), '小字那一行沒有寫「原暱稱」：' + s.label);
    assert.strictEqual(evalExpr(s.origExpr, { r: { alias: '備註', nick: '暱稱' } }), '暱稱', '小字顯示的不是原暱稱：' + s.origExpr);
  }
});
await T('C2 ⭐⭐ 編輯入口只在 status === accepted 的列（canAlias 抽出來求值）；且真的掛在 {#if canAlias(r)} 上', () => {
  const m = /function canAlias\(r: FriendRow\): boolean \{ return ([^;]*); \}/.exec(FRP);
  assert.ok(m, '抽不到 canAlias（寫法變了？）');
  const fn = (st) => evalExpr(m[1], { r: { status: st } });
  assert.strictEqual(fn('accepted'), true, 'accepted 應該可以設備註名');
  for (const st of ['pending', 'blocked', 'rejected', '']) assert.strictEqual(fn(st), false, '⚠ status=' + st + ' 也給了編輯入口（伺服器會回 409）');
  assert.ok(/\{#if canAlias\(r\)\}<button class="small"[^\n]*startAlias\(r\)/.test(FRP), '編輯入口沒有掛在 {#if canAlias(r)} 上');
  assert.strictEqual((stripCmt(FRP).match(/startAlias\(r\)/g) || []).length, 1, '編輯入口不是恰一處');
});
await T('C3 ⭐⭐ 輸入框上限綁常數（不是硬寫的數字）、type=text；⭐ **空字串時「儲存」不得停用**（空＝清除）；取消鈕不送出', () => {
  const inp = /<input class="alias-input"([^>]*)\/>/.exec(FRP);
  assert.ok(inp, '抽不到備註名輸入框');
  assert.ok(/maxlength=\{FRIENDS_ALIAS_MAX_LEN\}/.test(inp[1]), 'maxlength 沒有綁 FRIENDS_ALIAS_MAX_LEN：' + inp[1]);
  assert.ok(/type="text"/.test(inp[1]) && /bind:value=\{aliasDraft\}/.test(inp[1]), '輸入框形狀不對：' + inp[1]);
  const save = /<button class="small primary" type="submit" disabled=\{([^}]*)\}>/.exec(FRP);
  assert.ok(save, '抽不到「儲存」鈕');
  assert.strictEqual(evalExpr(save[1], { aliasBusy: false, aliasDraft: '' }), false, '⚠⚠ 輸入框空著時「儲存」被停用了 ⇒ 玩家清不掉備註名');
  assert.strictEqual(evalExpr(save[1], { aliasBusy: true, aliasDraft: 'x' }), true, '送出中沒有停用（會連點兩次）');
  assert.ok(/<button class="small" type="button"[^>]*onclick=\{cancelAlias\}/.test(FRP), '取消鈕不是 type="button"（會變成送出）');
  // 送出的路徑：submitAlias 一定要走 setFriendAlias，且允許空字串
  const sa = FRP.slice(FRP.indexOf('async function submitAlias('), FRP.indexOf('function fmtDate('));
  assert.ok(/setFriendAlias\(c, aliasFid, aliasDraft\)/.test(sa), 'submitAlias 沒有走 setFriendAlias：' + sa.slice(0, 200));
  assert.ok(!/aliasDraft\.trim\(\)\s*(===|!==|\?|&&|\|\|)/.test(sa), '⚠ submitAlias 裡對空字串做了額外攔截（會擋掉「清除」）');
});
await T('C4 共用元件零 {@html}；每個 {#each} 都用 (r.fid) 當穩定 key；掃描器下限：四區各一個 each', () => {
  assert.ok(!stripCmt(FRP).includes('{@html'), '⚠⚠ 共用元件出現 {@html}（暱稱／備註名都是玩家自由輸入 ⇒ 紅線）');
  const eaches = stripCmt(FRP).match(/\{#each[^}]*\}/g) || [];
  assert.strictEqual(eaches.length, 4, 'each 不是四個（四區）：' + eaches.length);
  for (const e of eaches) assert.ok(/\(r\.fid\)\}$/.test(e), 'each 沒用 fid 當 key：' + e);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐⭐ 框架安全：匿名玩家的大廳與 BASE 逐字相同');
const BASE_SHA = 'db414686d214dfff468dc3b7613368fae6971b21';   // v6.295（本版的 BASE）
const LOBBY_A = '<!-- ─── 線上 Lobby ─── -->';
const LOBBY_B = "{:else if onlineStep === 'room'}";
function lobbyRegion(s) {
  const a = s.indexOf(LOBBY_A), b = s.indexOf(LOBBY_B, a);
  assert.ok(a > 0 && b > a, '找不到線上大廳的起訖錨點');
  const r = s.slice(a, b);
  assert.ok(r.length > 4000, '大廳區間只有 ' + r.length + ' 字元 ⇒ 錨點抓錯');
  return r;
}
/** 匿名玩家：friendsEntryOn=false（friendsEntryVisible 對匿名一律 false），lobbyTab 被 $derived 鎖回 'online'。 */
const ANON = (pm) => ({ friendsEntryOn: false, lobbyTab: 'online', isPortraitMobile: pm, onlineStep: 'join' });
const asAnon = (src, pm) => normalizeMarkup(pruneIfs(lobbyRegion(src), ANON(pm)));
let BASE_GAME = null;
await T('D1 ⭐⭐⭐ 匿名玩家的大廳（把 {#if} 依「匿名」求值剪枝後）與 BASE **逐字相同** —— 手機直式與桌機各驗一次', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('v6296 D1 匿名大廳與 BASE 逐字比對', 'D2/D3 的結構斷言不需要歷史，仍在守'); skipped.push('D1（淺複製）'); return; }
  BASE_GAME = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE_SHA + ':src/routes/game/+page.svelte'], { maxBuffer: 1 << 28 }).toString('utf8');
  for (const pm of [false, true]) {
    const a = asAnon(GAME, pm), b = asAnon(BASE_GAME, pm);
    assert.ok(a.length > 3000, '剪枝後只剩 ' + a.length + ' 字元 ⇒ 剪枝器把東西吃掉了');
    if (a !== b) {
      const la = a.split('\n'), lb = b.split('\n');
      let i = 0; while (i < Math.max(la.length, lb.length) && la[i] === lb[i]) i++;
      assert.fail('⚠⚠⚠ 匿名玩家的大廳與 BASE 不同（isPortraitMobile=' + pm + '）第 ' + i + ' 行：\n NEW : ' + la[i] + '\n BASE: ' + lb[i]);
    }
  }
});
await T('D2 ⭐ 正對照①：把既有大廳表單（.lobby-unified）改一個位元 ⇒ D1 必紅（證明它不是恆真式）', () => {
  if (!BASE_GAME) { skipped.push('D2（需要 D1 的 BASE）'); return; }
  const bad = mutate(GAME, '<div class="online-form lobby-unified">', '<div class="online-form lobby-unified" >');
  assert.notStrictEqual(asAnon(bad, false), asAnon(BASE_GAME, false), '改動既有大廳表單竟然沒有讓比對翻紅 ⇒ D1 是恆真式');
});
await T('D3 ⭐ 正對照②：非匿名時 NEW 與 BASE **必須不同**（否則代表分頁列根本沒接上）', () => {
  if (!BASE_GAME) { skipped.push('D3（需要 D1 的 BASE）'); return; }
  const V = { friendsEntryOn: true, lobbyTab: 'online', isPortraitMobile: false, onlineStep: 'join' };
  const a = normalizeMarkup(pruneIfs(lobbyRegion(GAME), V));
  const b = normalizeMarkup(pruneIfs(lobbyRegion(BASE_GAME), V));
  assert.notStrictEqual(a, b, '非匿名時 NEW 與 BASE 一樣 ⇒ 分頁列沒有真的接進大廳');
  assert.ok(a.includes('class="lobby-tabs"'), '非匿名時剪枝結果裡沒有分頁列');
  assert.ok(!asAnon(GAME, false).includes('lobby-tab'), '⚠⚠ 匿名玩家的剪枝結果裡竟然出現分頁列');
});
await T('D4 ⭐⭐ 切分頁**不動 onlineStep**（房間列表訂閱／輪詢照常）：lobbySwitchTab 只改 lobbyTabRaw；本版新增的三個區塊零 `onlineStep =`', () => {
  const m = /function lobbySwitchTab\(tab: 'online' \| 'friends'\) \{([^}]*)\}/.exec(GAME);
  assert.ok(m, '抽不到 lobbySwitchTab');
  const body = m[1];
  assert.ok(!/onlineStep\s*=[^=]/.test(body), '⚠⚠ 切分頁竟然動了 onlineStep（房間輪詢會停）：' + body);
  // 實跑：把函式體跑起來，確認只有 lobbyTabRaw 被改
  const state = { lobbyTabRaw: 'online', onlineStep: 'join', showCreateForm: false, mode: 'online' };
  const run = new Function('S', 'tab', 'with (S) {' + body + '} return S;');
  const after = run({ ...state }, 'friends');
  assert.strictEqual(after.lobbyTabRaw, 'friends', 'lobbySwitchTab 沒有把分頁切過去');
  assert.strictEqual(after.onlineStep, 'join', '⚠⚠ onlineStep 被改掉了');
  assert.strictEqual(after.mode, 'online', 'mode 被改掉了');
  // 大廳輪詢的閘仍然只看 mode／onlineStep，沒有把 lobbyTab 加進去
  const gate = /if \(!isTournament && mode === 'online' && onlineStep === 'join' && myUid\) \{/.exec(GAME);
  assert.ok(gate, '大廳房間訂閱的閘抽不到（寫法變了？）');
  assert.ok(!/lobbyTab/.test(GAME.slice(gate.index - 400, gate.index + 400)), '⚠⚠ 房間訂閱的閘被加上了 lobbyTab（切到好友分頁時房間會停止更新）');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】行為端：把共用元件真的掛起來（playwright）');
let chromium = null;
try { chromium = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium; } catch { chromium = null; }
if (!chromium) {
  skipped.push('【E】行為端 DOM 掛載（沒有 playwright 模組）');
  console.log('  ⚠⚠ SKIP 【E】：這台機器沒有 Playwright ⇒ 掛載行為沒有跑（【C】的求值斷言仍在守）');
} else {
  const { compile } = await import('svelte/compiler');
  const dir = mkdtempSync(join(tmpdir(), 'v6296-'));
  try {
    writeFileSync(join(dir, 'FriendsPanel.js'), compile(FRP, { generate: 'client', filename: 'FriendsPanel.svelte', runes: true, css: 'injected' }).js.code);
    writeFileSync(join(dir, 'fb.js'), 'export const auth = globalThis.__auth;\n');
    writeFileSync(join(dir, 'fbauth.js'), 'export function onAuthStateChanged(a, cb){ setTimeout(()=>cb(globalThis.__auth.currentUser),0); return ()=>{}; }\n');
    writeFileSync(join(dir, 'entry.js'), "import { mount, flushSync } from 'svelte';\nimport P from './FriendsPanel.js';\nglobalThis.__mountPanel = (t, p) => mount(P, { target: t, props: p });\nglobalThis.__flush = flushSync;\n");
    await esbuild.build({
      entryPoints: [join(dir, 'entry.js')], bundle: true, format: 'iife', outfile: join(dir, 'bundle.js'), logLevel: 'silent',
      alias: {
        '$lib/firebase': join(dir, 'fb.js'), 'firebase/auth': join(dir, 'fbauth.js'),
        '$lib/friends/friends-api': P_API, '$lib/friends/auth-ctx': P_CTX, '$lib/ui/stale-keep': join(ROOT, 'src/lib/ui/stale-keep.ts'),
        // v6.301：共用元件多 import 了「好友在哪一間房」的純函式模組（本節不傳 rooms ⇒ 整組按鈕不渲染，行為與本版無關）
        '$lib/friends/friend-rooms': join(ROOT, 'src/lib/friends/friend-rooms.ts'),
      },
      nodePaths: [join(ROOT, 'node_modules')], loader: { '.ts': 'ts' },
      define: { 'import.meta.env': JSON.stringify({ VITE_ORACLE_API_URL: 'https://t.local' }) },
    });
    const bundle = readFileSync(join(dir, 'bundle.js'), 'utf8');
    const LIST = {
      friendsApi: 1, me: { uid: 'me', nick: '我' },
      friends: [
        { fid: 'f1', status: 'accepted', nick: '小明', alias: '大學同學', uid: null, uids: [], requestedByMe: true, blockedByMe: false, via: 'email', at: 1 },
        { fid: 'f2', status: 'accepted', nick: '阿華', alias: null, uid: null, uids: [], requestedByMe: false, blockedByMe: false, via: 'battle', at: 2 },
      ],
      incoming: [{ fid: 'f3', status: 'pending', nick: '路人甲', alias: null, uid: null, uids: [], requestedByMe: false, blockedByMe: false, via: 'email', at: 3 }],
      outgoing: [],
      blocked: [{ fid: 'f4', status: 'blocked', nick: '壞人', alias: null, uid: null, uids: [], requestedByMe: true, blockedByMe: true, via: null, at: 4 }],
      limit: 100, truncated: false,
    };
    const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
    try {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
      const pg = await ctx.newPage();
      await pg.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>' }));
      await pg.goto('https://t.local/');
      await pg.evaluate((LIST) => {
        window.__calls = [];
        window.fetch = async (url, init) => {
          window.__calls.push({ url: String(url), method: init && init.method, body: init && init.body });
          const alias = init && init.body ? JSON.parse(init.body).alias : null;
          if (String(url).includes('/alias')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, friendsApi: 1, fid: 'f1', alias: alias || null }) };
          return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => LIST };
        };
        window.__auth = { currentUser: { uid: 'me', isAnonymous: false, getIdToken: async () => 'tok' } };
      }, LIST);
      await pg.addScriptTag({ content: bundle });
      const before = await pg.evaluate(() => window.__calls.length);
      await T('E1 ⭐⭐ 載入元件（尚未掛載）⇒ /api/friends/* **零請求**（切到好友分頁之前不會打伺服器）', () => {
        assert.strictEqual(before, 0, '元件還沒掛載就發了 ' + before + ' 發請求');
      });
      await pg.evaluate(() => window.__mountPanel(document.getElementById('app'), { embedded: true }));
      await pg.waitForTimeout(250);
      const st = await pg.evaluate(() => ({
        calls: window.__calls.map((c) => c.url),
        nicks: [...document.querySelectorAll('.nick')].map((e) => e.textContent),
        origs: [...document.querySelectorAll('.orig-nick')].map((e) => e.textContent),
        aliasBtnRows: [...document.querySelectorAll('.row')].map((r) => [...r.querySelectorAll('button')].some((b) => b.textContent.includes('備註名'))),
        rows: document.querySelectorAll('.row').length,
      }));
      await T('E2 ⭐⭐ 掛載後恰**一發** GET /api/friends/list（零輪詢）', () => {
        assert.deepStrictEqual(st.calls, ['https://t.local/api/friends/list'], '掛載後的請求不對：' + JSON.stringify(st.calls));
      });
      await T('E3 ⭐⭐ 顯示：有備註名的列顯示備註名＋小字原暱稱；沒有備註名的列只顯示暱稱（DOM 實測）', () => {
        assert.strictEqual(st.rows, 4, '列數不對：' + st.rows);
        assert.deepStrictEqual(st.nicks, ['大學同學', '阿華', '路人甲', '壞人'], '主標題不對：' + JSON.stringify(st.nicks));
        assert.deepStrictEqual(st.origs, ['原暱稱：小明'], '小字原暱稱不對（應該只有有備註名的那一列有）：' + JSON.stringify(st.origs));
      });
      await T('E4 ⭐⭐ 編輯入口只出現在 accepted 的兩列（待確認／已封鎖那兩列沒有）', () => {
        assert.deepStrictEqual(st.aliasBtnRows, [true, true, false, false], '編輯入口出現在錯的列：' + JSON.stringify(st.aliasBtnRows));
      });
      const edit = await pg.evaluate(async () => {
        const row = document.querySelectorAll('.row')[0];
        [...row.querySelectorAll('button')].find((b) => b.textContent.includes('備註名')).click();
        await new Promise((r) => setTimeout(r, 60));
        const inp = document.querySelector('.alias-input');
        const save = [...document.querySelectorAll('.alias-form button')].find((b) => b.textContent.includes('儲存'));
        return { maxlength: inp.getAttribute('maxlength'), value: inp.value, saveDisabledWhenEmpty: (() => { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); return save.disabled; })() };
      });
      await T('E5 ⭐⭐ 點「備註名」⇒ 開出輸入框，maxlength=20、預填目前的備註名；把它清空之後「儲存」仍可按（＝清除）', () => {
        assert.strictEqual(edit.maxlength, '20', 'maxlength 不是 20：' + edit.maxlength);
        assert.strictEqual(edit.value, '大學同學', '沒有預填目前的備註名：' + edit.value);
        assert.strictEqual(edit.saveDisabledWhenEmpty, false, '⚠⚠ 清空之後「儲存」被停用 ⇒ 玩家清不掉備註名');
      });
      const sent = await pg.evaluate(async () => {
        const inp = document.querySelector('.alias-input');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(inp, '同事'); inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('.alias-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 250));
        const c = window.__calls.filter((x) => x.url.includes('/alias'));
        return { n: c.length, url: c[0] && c[0].url, method: c[0] && c[0].method, body: c[0] && c[0].body, stillOpen: !!document.querySelector('.alias-input') };
      });
      await T('E6 ⭐⭐ 輸入後送出 ⇒ 恰一發 POST /api/friends/alias，body 只有 {fid, alias}；成功後關掉編輯框並重讀名單', () => {
        assert.strictEqual(sent.n, 1, '送出的 alias 請求數不對：' + sent.n);
        assert.strictEqual(sent.url, 'https://t.local/api/friends/alias');
        assert.strictEqual(sent.method, 'POST');
        assert.deepStrictEqual(JSON.parse(sent.body), { fid: 'f1', alias: '同事' }, 'body 不對：' + sent.body);
        assert.strictEqual(sent.stillOpen, false, '成功後沒有關掉編輯框');
      });
      const cleared = await pg.evaluate(async () => {
        const row = document.querySelectorAll('.row')[0];
        [...row.querySelectorAll('button')].find((b) => b.textContent.includes('備註名')).click();
        await new Promise((r) => setTimeout(r, 60));
        const inp = document.querySelector('.alias-input');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(inp, ''); inp.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 40));
        document.querySelector('.alias-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 250));
        const c = window.__calls.filter((x) => x.url.includes('/alias'));
        return JSON.parse(c[c.length - 1].body);
      });
      await T('E7 ⭐⭐⭐ 清空後送出 ⇒ 真的送出 alias:""（伺服器據此 $unset ＝ 清除）', () => {
        assert.deepStrictEqual(cleared, { fid: 'f1', alias: '' }, '清除時送出的 body 不對：' + JSON.stringify(cleared));
      });
      const xss = await pg.evaluate(async () => {
        const el = document.querySelectorAll('.nick')[0];
        return { html: document.querySelector('#app').innerHTML.includes('<img'), text: el.textContent };
      });
      await T('E8 ⭐ 純文字渲染：畫面裡沒有從資料長出來的標籤（本頁到處是玩家自由輸入）', () => {
        assert.strictEqual(xss.html, false, '資料被當成 HTML 渲染了');
      });
      await ctx.close();
    } finally { await browser.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】回歸不變量');
// ⭐⭐⭐ v6.297 改寫（**不是放寬**）：私聊改成內嵌，主檔一定會出現 DmPanel 這個字串。
//   守護意圖（私聊不可以被打包進對戰頁）改由「靜態 import 零私聊」＋「對戰版面分支零 Dm」接手，
//   完整版（走整張靜態相依圖、擋得住 wrapper 繞道）在 scripts/test-v6297-tourn-friends-tab.mjs【D】。
await T('F1 ⭐⭐ 私聊不進對戰頁主 chunk：主檔的靜態 import 零私聊模組（動態 import() 才是入口）；MobilePortraitBattle 零私聊；共用元件本身不 import 私聊面板', () => {
  const importLines = stripCmt([...GAME.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'))
    .split('\n').filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l));
  assert.ok(importLines.length > 10, '掃描器下限：只抽到 ' + importLines.length + ' 行靜態 import');
  for (const l of importLines) for (const k of ['DmPanel', 'dm-session', 'dm-poller'])
    assert.ok(!l.includes(k), '⚠⚠ 主檔用靜態 import 引用了私聊模組：' + l.trim());
  for (const k of ['DmPanel', 'dm-session', 'dm-poller', 'createDmSession'])
    assert.strictEqual((MPB.match(new RegExp(k, 'g')) || []).length, 0, 'MobilePortraitBattle.svelte 出現 ' + k);
  // ⭐ 共用元件本身也不可以 import 私聊面板（不然它會被靜態拉進對戰頁）
  assert.strictEqual((stripCmt(FRP).match(/DmPanel/g) || []).length, 0, '共用元件 import 了 DmPanel ⇒ 會被打包進對戰頁');
  // 正對照：/friends 頁必須有（否則上面幾條是恆真式）
  assert.ok((PAGE.match(/DmPanel/g) || []).length >= 2, '正對照失效：/friends 頁應該還是掛著私聊面板');
});
await T('F2 ⭐⭐ 大廳的私聊入口改成**就地開面板**（v6.297；舊的開新分頁不得復活）；且共用元件在大廳仍是 embedded', () => {
  const i = GAME.indexOf('<FriendsPanel embedded ');
  assert.ok(i > 0, '大廳沒有用 embedded 模式掛共用元件');
  const line = GAME.slice(i, GAME.indexOf('\n', i));
  assert.ok(/ondm=\{openDm\}/.test(line), '大廳的 ondm 不是就地開面板：' + line.slice(0, 220));
  assert.ok(/foot=\{dmFoot\}/.test(line), '大廳沒有把私聊面板接到 foot snippet（色票靠繼承）：' + line.slice(0, 220));
  assert.strictEqual((GAME.match(/window\.open\(base \+ '\/friends'/g) || []).length, 0, '舊的「開新分頁到 /friends」復活了');
});
await T('F3 ⭐⭐ /friends 這條獨立路由仍然可用：import 共用元件、head／foot snippet 都接上、匿名閘走共用 friendsCtxFromAuth', () => {
  assert.ok(/import FriendsPanel from '\$lib\/friends\/FriendsPanel\.svelte';/.test(PAGE), '/friends 頁沒有 import 共用元件');
  assert.ok(/<FriendsPanel \{head\} \{foot\} ondm=\{openDm\}/.test(PAGE), '/friends 頁沒有把 head／foot／ondm 接上：');
  assert.ok(/friendsCtxFromAuth/.test(PAGE) && /friendsCtxFromAuth/.test(FRP), '兩邊沒有共用取身分出口');
  assert.ok(/if \(!u \|\| u\.isAnonymous\) return null;/.test(CTX), '共用取身分的匿名閘不見了');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】test chain ／版本一致');
await T('G1 本守衛在 package.json 的 test chain；version.ts 與 admin.html SITE_VERSION_HINT 一致（不 pin 版本號）', () => {
  assert.ok(JSON.parse(PKG).scripts.test.includes('node scripts/test-v6296-lobby-friends-tab.mjs'), '本守衛沒進 test chain');
  const V = /VERSION = '([\d.]+)'/.exec(rd(join(ROOT, 'src/lib/version.ts')))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(rd(join(ROOT, 'oracle-admin/admin.html')))[1];
  assert.strictEqual(H, V, 'admin.html hint ' + H + ' ≠ version.ts ' + V);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【H】突變（每個都必須紅在預期那一條）');
await T('H1 突變：四區的顯示全改回只看 nick（備註名等於沒做）⇒ C1 紅在「沒有優先顯示 alias」', () =>
  mutantMustBreak('只看 nick', () => {
    const n = FRP.split('<span class="nick">{r.alias || r.nick}</span>').length - 1;
    assert.strictEqual(n, 4, '突變錨點數不是 4（四區）：' + n);
    const bad = FRP.split('<span class="nick">{r.alias || r.nick}</span>').join('<span class="nick">{r.nick}</span>');
    const shapes = aliasRowShapes(stripCmt(bad));
    assert.strictEqual(shapes.length, 4, '四個區塊的列不是各一組');
    for (const s of shapes) assert.strictEqual(evalExpr(s.nickExpr, { r: { alias: '備註', nick: '暱稱' } }), '備註', '有 alias 時沒有優先顯示 alias：' + s.nickExpr);
  }, '沒有優先顯示 alias'));
await T('H2 突變：沒有 alias 也顯示「原暱稱」那一行 ⇒ C1 紅在「沒有 alias 卻顯示」', () =>
  mutantMustBreak('原暱稱永遠顯示', () => {
    const bad = mutate(FRP, '{#if r.alias}<span class="orig-nick">原暱稱：{r.nick}</span>{/if}\n                <span class="meta">{viaLabel(r)}{r.at ? \'・\' + fmtDate(r.at) : \'\'}</span>\n                <span class="spacer"></span>\n                {#if confirmFid === r.fid && confirmKind === \'remove\'}',
      '{#if true || r.alias}<span class="orig-nick">原暱稱：{r.nick}</span>{/if}\n                <span class="meta">{viaLabel(r)}{r.at ? \'・\' + fmtDate(r.at) : \'\'}</span>\n                <span class="spacer"></span>\n                {#if confirmFid === r.fid && confirmKind === \'remove\'}');
    const shapes = aliasRowShapes(stripCmt(bad));
    for (const s of shapes) assert.ok(!evalExpr(s.cond, { r: { alias: null, nick: '暱稱' } }), '⚠ 沒有 alias 卻顯示「原暱稱」那一行：' + s.cond);
  }, '沒有 alias 卻顯示'));
await T('H3 突變：canAlias 放行所有狀態（非好友也給編輯入口 ⇒ 伺服器 409）⇒ C2 紅在「也給了編輯入口」', () =>
  mutantMustBreak('canAlias 放行', () => {
    const bad = mutate(FRP, "function canAlias(r: FriendRow): boolean { return r.status === 'accepted'; }", 'function canAlias(r: FriendRow): boolean { return !!r; }');
    const m = /function canAlias\(r: FriendRow\): boolean \{ return ([^;]*); \}/.exec(bad);
    assert.ok(m, '抽不到 canAlias');
    for (const st of ['pending', 'blocked']) assert.strictEqual(evalExpr(m[1], { r: { status: st } }), false, '⚠ status=' + st + ' 也給了編輯入口（伺服器會回 409）');
  }, '也給了編輯入口'));
await T('H4 突變：輸入框空著時停用「儲存」（清不掉備註名）⇒ C3 紅在「玩家清不掉備註名」', () =>
  mutantMustBreak('空字串被擋', () => {
    const bad = mutate(FRP, '<button class="small primary" type="submit" disabled={aliasBusy}>', '<button class="small primary" type="submit" disabled={aliasBusy || !aliasDraft.trim()}>');
    const save = /<button class="small primary" type="submit" disabled=\{([^}]*)\}>/.exec(bad);
    assert.strictEqual(evalExpr(save[1], { aliasBusy: false, aliasDraft: '' }), false, '⚠⚠ 輸入框空著時「儲存」被停用了 ⇒ 玩家清不掉備註名');
  }, '玩家清不掉備註名'));
await T('H5 突變：maxlength 硬寫成 50（與伺服器不一致）⇒ C3 紅在「沒有綁 FRIENDS_ALIAS_MAX_LEN」', () =>
  mutantMustBreak('maxlength 硬寫', () => {
    const bad = mutate(FRP, 'maxlength={FRIENDS_ALIAS_MAX_LEN}', 'maxlength="50"');
    const inp = /<input class="alias-input"([^>]*)\/>/.exec(bad);
    assert.ok(/maxlength=\{FRIENDS_ALIAS_MAX_LEN\}/.test(inp[1]), 'maxlength 沒有綁 FRIENDS_ALIAS_MAX_LEN：' + inp[1]);
  }, '沒有綁 FRIENDS_ALIAS_MAX_LEN'));
await T('H6 ⭐⭐⭐ 突變：分頁列忘了包在 {#if friendsEntryOn ...} 裡（匿名玩家也會看到）⇒ D1 紅在「與 BASE 不同」', () => {
  if (!BASE_GAME) { skipped.push('H6（需要 BASE）'); return; }
  return mutantMustBreak('匿名看得到分頁列', () => {
    const bad = mutate(GAME, "{#if friendsEntryOn && onlineStep !== 'room'}", "{#if onlineStep !== 'room'}");
    const a = asAnon(bad, false), b = asAnon(BASE_GAME, false);
    assert.ok(a === b, '⚠⚠⚠ 匿名玩家的大廳與 BASE 不同');
  }, '與 BASE 不同');
});
await T('H7 ⭐⭐ 突變：lobbyTab 的 $derived 拿掉匿名鎖（lobbyTabRaw 直通）⇒ 大廳可能被換掉；由 test-v6283 C4 的求值斷言接住', () =>
  mutantMustBreak('拿掉匿名鎖', () => {
    const bad = mutate(GAME, 'const lobbyTab = $derived(friendsEntryOn ? lobbyTabRaw : \'online\');', 'const lobbyTab = $derived(lobbyTabRaw);');
    const m = /const lobbyTab = \$derived\(([^;]*)\);/.exec(bad);
    assert.strictEqual(new Function('friendsEntryOn', 'lobbyTabRaw', 'return (' + m[1] + ');')(false, 'friends'), 'online',
      '⚠⚠ friendsEntryOn=false 時 lobbyTab 沒有被鎖回 online ⇒ 匿名玩家的大廳可能被換掉');
  }, '沒有被鎖回 online'));
await T('H8 ⭐⭐ 突變：切分頁時順手把 onlineStep 改掉（房間輪詢會停）⇒ D4 紅在「onlineStep 被改掉了」', () =>
  mutantMustBreak('切分頁動 onlineStep', () => {
    const bad = mutate(GAME, "function lobbySwitchTab(tab: 'online' | 'friends') { lobbyTabRaw = tab; }",
      "function lobbySwitchTab(tab: 'online' | 'friends') { lobbyTabRaw = tab; onlineStep = 'choose'; }");
    const m = /function lobbySwitchTab\(tab: 'online' \| 'friends'\) \{([^}]*)\}/.exec(bad);
    const run = new Function('S', 'tab', 'with (S) {' + m[1] + '} return S;');
    const after = run({ lobbyTabRaw: 'online', onlineStep: 'join' }, 'friends');
    assert.strictEqual(after.onlineStep, 'join', '⚠⚠ onlineStep 被改掉了');
  }, 'onlineStep 被改掉了'));
await T('H9 ⭐⭐ 突變：把私聊面板改成**靜態** import（會把 DM 打包進對戰頁）⇒ F1 紅在「主檔用靜態 import 引用了私聊模組」', () =>
  mutantMustBreak('主檔靜態 import 私聊', () => {
    const bad = mutate(GAME, '<script lang="ts">', '<script lang="ts">\n  import DmPanel from \'../friends/DmPanel.svelte\';');
    const importLines = stripCmt([...bad.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n'))
      .split('\n').filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l));
    for (const l of importLines) for (const k of ['DmPanel', 'dm-session', 'dm-poller'])
      assert.ok(!l.includes(k), '⚠⚠ 主檔用靜態 import 引用了私聊模組：' + l.trim());
  }, '主檔用靜態 import 引用了私聊模組'));

// ═══════════════════════════════════════════════════════════════════════════
if (skipped.length) console.log('\n⚠⚠ 本次 SKIP：' + skipped.join('；') + ' —— 這幾段在這台機器上沒有在守');
console.log('\n══ v6.296 大廳分頁＋備註名守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
process.exit(fail ? 1 : 0);
