// ⭐⭐⭐v6.177 守衛：「重新抓取／抓取失敗時，不清空已經顯示過的資料」
//   跑法：node scripts/test-v6177-keep-last-good.mjs
//
// 事故：賽事進行中「📊 瑞士制排名／📋 賽程表」偶爾整區消失、要好幾秒才回來。
// 真因：tBracketLoad 的 `tBrackets = rs.filter(...)` 是清空型——任一支 /bracket 失敗
//   （.catch(() => null)）或伺服器回 {event:null} 就把那場賽程從陣列裡拿掉；
//   `{#each tBrackets}` 一筆都不畫 ⇒ 整區消失。空白期還被 v6.161 的大廳降頻放大
//   （/bracket = /event × 3 ⇒ 9s / 27s / 63s）。
//
// ⚠⚠ 這支刻意**不是**只驗字串存在（本專案反覆踩「斷言有呼叫某函式 ≠ 那件事發生了」）：
//   把 stale-keep.ts、tBracketLoad、subscribeOpenRooms 三段**實際會被打包出去的原始碼**
//   切出來、esbuild 剝掉 TS 型別後**真的跑起來**，斷言合併後的清單內容。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const KEEP = readFileSync(join(ROOT, 'src/lib/ui/stale-keep.ts'), 'utf8');
const ROOM = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');

let pass = 0; const fails = [];
const T = (name, fn) => { try { fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };
const TA = async (name, fn) => { try { await fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };

const ts = (s) => transformSync(s, { loader: 'ts' }).code;
function slice(src, from, to, label) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, '找不到錨點（守衛需同步更新）：' + label);
  const j = src.indexOf(to, i + from.length);
  assert.ok(j > i, '找不到結束錨點：' + label);
  return src.slice(i, j);
}
/** 剝掉註解 —— 否定型斷言一律先剝，否則「註解裡提到舊寫法」會被誤判成還在用（本專案教訓） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── 0) 剝註解器自我驗證 ────────────────────────────────────────────────
T('0a 剝註解器：行註解真的被剝掉', () => {
  assert.equal(stripComments('a = 1; // tBrackets = []\nb = 2;').includes('tBrackets = []'), false);
});
T('0b 剝註解器：不會誤剝 https:// 這種 URL 之外的程式碼', () => {
  assert.ok(stripComments('const x = [1,2];\nconst y = 3;').includes('const y = 3'));
});
T('0c 剝註解器：區塊註解真的被剝掉', () => {
  assert.equal(stripComments('/* tBrackets = [] */ const z = 1;').includes('tBrackets = []'), false);
});

// ── 1) 中央述詞 stale-keep.ts：實跑求值 ───────────────────────────────
let KEEPMOD = null;
T('1a 中央模組可載入且匯出兩支述詞', () => {
  const body = ts(KEEP).replace(/export\s+/g, '') + '\n; return { adoptOrKeep, mergeKeyedOrKeep };';
  KEEPMOD = new Function(body)();
  assert.equal(typeof KEEPMOD.adoptOrKeep, 'function');
  assert.equal(typeof KEEPMOD.mergeKeyedOrKeep, 'function');
});
T('1b adoptOrKeep：next 為 null ⇒ 沿用 prev 且標 stale', () => {
  const r = KEEPMOD.adoptOrKeep(['old'], null);
  assert.deepEqual(r.data, ['old']); assert.equal(r.stale, true);
});
T('1c adoptOrKeep：next 是空陣列（伺服器權威地說沒有）⇒ 採納空的、不算 stale', () => {
  const r = KEEPMOD.adoptOrKeep(['old'], []);
  assert.deepEqual(r.data, []); assert.equal(r.stale, false);
});
T('1d mergeKeyedOrKeep：失敗的那一筆沿用舊的、成功的用新的', () => {
  const prev = [{ id: 'A', v: 1 }, { id: 'B', v: 1 }];
  const r = KEEPMOD.mergeKeyedOrKeep(prev, (x) => x.id, [
    { key: 'A', value: { id: 'A', v: 2 } },
    { key: 'B', value: null },
  ]);
  assert.deepEqual(r.list.map((x) => x.id + ':' + x.v), ['A:2', 'B:1']);
  assert.equal(r.stale, true);
});
T('1e mergeKeyedOrKeep：incoming 沒提到的 key 一律移除（賽事真的結束就要消失，不能永遠留著）', () => {
  const r = KEEPMOD.mergeKeyedOrKeep([{ id: 'A' }, { id: 'GONE' }], (x) => x.id, [{ key: 'A', value: { id: 'A' } }]);
  assert.deepEqual(r.list.map((x) => x.id), ['A']);
});
T('1f mergeKeyedOrKeep：第一次載入就失敗且沒有舊資料 ⇒ 略過（交給空狀態），仍標 stale', () => {
  const r = KEEPMOD.mergeKeyedOrKeep([], (x) => x.id, [{ key: 'A', value: null }]);
  assert.deepEqual(r.list, []); assert.equal(r.stale, true);
});

// ── 2) tBracketLoad 行為端實跑 ────────────────────────────────────────
const FN_BRACKET = slice(PAGE, '  async function tBracketLoad() {', '\n  // 進入我本輪的對戰', 'tBracketLoad');
function makeBracket(prev) {
  const st = { mode: 'ok', round: 1, resumes: 0, lobbyResumeAt: 0, now: 5_000_000, evs: [{ _id: 'E1' }, { _id: 'E2' }] };
  const body = `
    var Date = { now: function () { return st.now; } };
    var tBrackets = ${JSON.stringify(prev || [])};
    var tBracketsStale = false, tBracketsEverOk = ${prev && prev.length ? 'true' : 'false'};
    Object.defineProperty(this, '_x', { value: 1 });
    var _tLobbyResumeAt = st.lobbyResumeAt;
    var _tTabHidden = false, _tBracketSeq = 0, _tBracketFailStreak = 0;
    function tLobbyResume() { st.resumes++; _tLobbyResumeAt = Date.now(); }
    var tRunningEvents = st.evs;
    async function tApi(p) {
      if (st.gate) { var g = st.gate; st.gate = null; await g; }   // 測試可控的「這一發很慢」
      if (st.mode === 'fail') throw new Error('boom');
      if (st.mode === 'failE2' && p.indexOf('E2') >= 0) throw new Error('boom');
      if (st.mode === 'noevent') return { event: null, matches: [] };
      var id = p.indexOf('E2') >= 0 ? 'E2' : 'E1';
      return { event: { _id: id, name: id, currentRound: st.round }, matches: [{ round: st.round, idx: 0 }], standings: [{ rank: 1, name: 'A' }] };
    }
    ${ts(FN_BRACKET)}
    return {
      load: tBracketLoad,
      snap: function () { return { list: tBrackets, stale: tBracketsStale, everOk: tBracketsEverOk }; },
      setResumeAt: function (v) { _tLobbyResumeAt = v; },
      setHidden: function (v) { _tTabHidden = v; },
    };
  `;
  const h = new Function('mergeKeyedOrKeep', 'st', body)(KEEPMOD.mergeKeyedOrKeep, st);
  h.st = st;
  return h;
}
const ids = (h) => h.snap().list.map((b) => b.event._id + '@r' + b.event.currentRound).join(',');

await TA('2a 正常抓取 ⇒ 兩場賽程都在', async () => {
  const h = makeBracket([]); await h.load();
  assert.equal(ids(h), 'E1@r1,E2@r1'); assert.equal(h.snap().stale, false);
});
await TA('⭐2b 兩支 /bracket 都失敗 ⇒ **賽程不被清空**（舊版會變成 0 筆＝整區消失）', async () => {
  const h = makeBracket([]); await h.load();
  h.st.mode = 'fail'; h.st.now += 60000; await h.load();
  assert.equal(h.snap().list.length, 2, '抓取失敗後賽程被清空了');
  assert.equal(ids(h), 'E1@r1,E2@r1');
  assert.equal(h.snap().stale, true, '沿用舊資料時必須標 stale 以便掛「更新中」提示');
});
await TA('⭐2c 只有一場失敗 ⇒ 成功那場更新、失敗那場沿用（不會連坐消失）', async () => {
  const h = makeBracket([]); await h.load();
  h.st.round = 2; h.st.mode = 'failE2'; h.st.now += 60000; await h.load();
  assert.equal(ids(h), 'E1@r2,E2@r1');
});
await TA('⭐2d 伺服器回 {event:null}（查不到賽事的瞬間）⇒ 沿用，不清空', async () => {
  const h = makeBracket([]); await h.load();
  h.st.mode = 'noevent'; h.st.now += 60000; await h.load();
  assert.equal(h.snap().list.length, 2);
  assert.equal(h.snap().stale, true);
});
await TA('2e 恢復成功 ⇒ stale 解除、資料換成新的', async () => {
  const h = makeBracket([]); await h.load();
  h.st.mode = 'fail'; h.st.now += 60000; await h.load();
  h.st.mode = 'ok'; h.st.round = 3; h.st.now += 60000; await h.load();
  assert.equal(ids(h), 'E1@r3,E2@r3'); assert.equal(h.snap().stale, false);
});
await TA('⭐2f 核心②：第一次載入就失敗 ⇒ 清單是空的但 stale=true（由空狀態顯示「載入中」）', async () => {
  const h = makeBracket([]); h.st.mode = 'fail'; await h.load();
  assert.equal(h.snap().list.length, 0);
  assert.equal(h.snap().stale, true);
  assert.equal(h.snap().everOk, false, '沒成功過就不能宣稱曾經有資料');
});
await TA('⭐2g 保留舊資料不可變成「永遠留著已結束的賽事」：/event 權威地說沒有進行中賽事 ⇒ 清空', async () => {
  const h = makeBracket([]); await h.load();
  h.st.evs.length = 0; h.st.now += 60000; await h.load();
  assert.equal(h.snap().list.length, 0);
  assert.equal(h.snap().stale, false, '權威的空不是 stale');
});
await TA('⭐2h 核心③：輪次推進（r1→r2→r3）連續載入，每一次之後都畫得出賽程（不出現空白）', async () => {
  const h = makeBracket([]);
  for (const r of [1, 2, 3]) {
    h.st.round = r; h.st.now += 10000; await h.load();
    assert.ok(h.snap().list.length > 0, '第 ' + r + ' 輪出現空白');
  }
  assert.equal(ids(h), 'E1@r3,E2@r3');
});
await TA('⭐2i 資料過期時**立刻拉回正常頻率**：沿用既有的 tLobbyResume（不另寫一份）', async () => {
  const h = makeBracket([]); await h.load();
  assert.equal(h.st.resumes, 0, '正常成功時不該亂拉頻率');
  h.st.mode = 'fail'; h.st.now += 60000; await h.load();
  assert.equal(h.st.resumes, 1, 'stale 之後沒有拉回正常頻率 ⇒ 空白期會被 v6.161 降頻放大到 27~63 秒');
});
await TA('⭐2j 自我重呼叫要有上限：**每一段連續失敗期只加速一次**（避免越 500 越加速的正回饋）', async () => {
  const h = makeBracket([]); await h.load();
  h.st.mode = 'fail';
  for (let i = 0; i < 30; i++) { h.st.now += 3000; await h.load(); }
  assert.equal(h.st.resumes, 1, '連續失敗仍反覆加速 ⇒ 伺服器噴 500 時會被重試風暴推倒');
});
await TA('2k 恢復後再失敗 ⇒ 可以再加速一次（不是永久熄火）', async () => {
  const h = makeBracket([]); await h.load();
  h.st.mode = 'fail'; h.st.now += 3000; await h.load();
  assert.equal(h.st.resumes, 1);
  h.st.mode = 'ok'; h.st.now += 3000; await h.load();     // 恢復 → 重置連續失敗計數
  h.st.mode = 'fail'; h.st.now += 3000; await h.load();
  assert.equal(h.st.resumes, 2);
});
await TA('2l 背景分頁不加速（那正是 v6.161 要省的人口，而且他看不到畫面）', async () => {
  const h = makeBracket([]); await h.load();
  h.setHidden(true); h.st.mode = 'fail'; h.st.now += 60000; await h.load();
  assert.equal(h.st.resumes, 0);
  assert.equal(h.snap().list.length, 2, '背景分頁一樣不可以被清空');
});
await TA('⭐2m 亂序守衛：晚到的舊回應不得覆蓋較新的合併結果', async () => {
  const h = makeBracket([]); await h.load();
  let release; h.st.gate = new Promise((r) => { release = r; });
  h.st.round = 1;
  const slow = h.load();                 // 這一發被 gate 卡住（＝還在路上）
  await new Promise((r) => setTimeout(r, 5));
  h.st.round = 9; await h.load();        // 更新的一發先完成
  assert.equal(ids(h), 'E1@r9,E2@r9');
  release(); await slow;                 // 舊的後到
  assert.equal(ids(h), 'E1@r9,E2@r9', '晚到的舊回應把新資料蓋回去了');
});

// ── 3) tournLoadEvent：壞回應不得清空大廳賽事清單 ─────────────────────
T('⭐3a 否定型：tournLoadEvent 不得再用 `Array.isArray(r.events) ? r.events : []` 把大廳清空', () => {
  const body = stripComments(slice(PAGE, '  async function tournLoadEvent() {', '\n  // 載入賽程表', 'tournLoadEvent'));
  assert.equal(/tEvents\s*=\s*Array\.isArray\(r\.events\)\s*\?\s*r\.events\s*:\s*\[\]/.test(body), false,
    '壞回應會把整個大廳賽事卡清空');
  assert.ok(/if\s*\(!r\s*\|\|\s*!Array\.isArray\(r\.events\)\)\s*return;/.test(body), '缺少「回應形狀不對就整發不採納」的守門');
});

// ── 4) 同型：休閒大廳房間列表（room-oracle.ts）行為端實跑 ──────────────
const FN_ROOMS = slice(ROOM, 'export function subscribeOpenRooms(', '\n// ── Heartbeat', 'subscribeOpenRooms');
function makeRooms() {
  const st = { mode: 'ok', calls: 0, cbs: [], pending: [] };
  const body = `
    var SEAT_LAYOUT_VERSION = 1;
    function isLobbyHostDead() { return false; }
    function isLobbyTooOld() { return false; }
    async function oracleListRooms(kind) {
      st.calls++;
      if (st.mode === 'fail') throw new Error('boom');
      if (st.mode === 'failLobby' && kind === 'lobby') throw new Error('boom');
      if (st.mode === 'empty') return [];
      return [{ _id: kind + '1', status: kind, schemaVersion: 9, createdAt: 1 }];
    }
    // 由測試自己驅動下一發：把排程的 callback 收起來，不真的等 2 秒
    var setTimeout = function (fn) { st.pending.push(fn); return 0; };
    var clearTimeout = function () {};
    ${ts(FN_ROOMS.replace('export function', 'function').replace(/^import .*$/gm, ''))}
    return subscribeOpenRooms;
  `;
  const sub = new Function('st', 'adoptOrKeep', body)(st, KEEPMOD.adoptOrKeep);
  const settle = () => new Promise((r) => setTimeout(r, 15));
  return {
    st,
    start: async (cb) => { const un = sub(cb); await settle(); return un; },
    next: async () => { const fns = st.pending.splice(0); for (const f of fns) f(); await settle(); },
  };
}
await TA('⭐4a 同型：從未成功過且兩支都失敗 ⇒ **不 callback**（不填成假的「目前沒有公開房間」）', async () => {
  const h = makeRooms(); h.st.mode = 'fail';
  await h.start((rooms) => h.st.cbs.push(rooms));
  assert.equal(h.st.cbs.length, 0, '失敗卻 callback([]) ⇒ 房間列表被清空成假空狀態');
});
await TA('⭐4b 同型：成功過之後某一支失敗 ⇒ 沿用那一支的上一份好資料（房間不會憑空變少）', async () => {
  const h = makeRooms();
  await h.start((rooms) => h.st.cbs.push(rooms));
  assert.equal(h.st.cbs.length, 1); assert.equal(h.st.cbs[0].length, 2);
  h.st.mode = 'failLobby';
  await h.next();
  assert.equal(h.st.cbs.length, 2);
  assert.equal(h.st.cbs[1].length, 2, 'lobby 那一支失敗就把房間清掉了');
  assert.ok(h.st.cbs[1].some((r) => r.roomId === 'lobby1'));
});
await TA('⭐4c 同型：成功過之後兩支都失敗 ⇒ 整份沿用（大廳不消失）', async () => {
  const h = makeRooms();
  await h.start((rooms) => h.st.cbs.push(rooms));
  h.st.mode = 'fail';
  await h.next();
  assert.equal(h.st.cbs.length, 2);
  assert.equal(h.st.cbs[1].length, 2);
});
await TA('4d 同型：伺服器權威地回空清單 ⇒ 照樣 callback([])（真的沒有房間要顯示空狀態）', async () => {
  const h = makeRooms(); h.st.mode = 'empty';
  await h.start((rooms) => h.st.cbs.push(rooms));
  assert.equal(h.st.cbs.length, 1);
  assert.deepEqual(h.st.cbs[0], []);
});
await TA('4e 同型：正常時仍照舊回傳房間', async () => {
  const h = makeRooms();
  await h.start((rooms) => h.st.cbs.push(rooms));
  assert.equal(h.st.cbs.length, 1);
  assert.equal(h.st.cbs[0].length, 2);
});

// ── 5) 排行榜 / 個人資料 / 名人堂：抓失敗不得指回 null / [] ────────────
T('⭐5a 否定型：tLeaderboardLoad 不得再 `catch { tLeaderboard = null }`', () => {
  const body = stripComments(slice(PAGE, '  async function tLeaderboardLoad() {', '\n  async function tProfileLoad', 'tLeaderboardLoad'));
  assert.equal(/tLeaderboard\s*=\s*null/.test(body), false);
  assert.ok(body.includes('adoptOrKeep'), '未收斂到中央述詞');
});
T('⭐5b 否定型：tProfileLoad 不得再 `catch { tProfile = null }`', () => {
  const body = stripComments(slice(PAGE, '  async function tProfileLoad() {', '\n  function tSwitchTab', 'tProfileLoad'));
  assert.equal(/tProfile\s*=\s*null/.test(body), false);
  assert.ok(body.includes('adoptOrKeep'));
});
T('⭐5c 否定型：tChampionsLoad / tSpectateLoad 不得再把壞回應寫成空陣列', () => {
  const a = stripComments(slice(PAGE, '  async function tChampionsLoad() {', '\n  // v5.691', 'tChampionsLoad'));
  const b = stripComments(slice(PAGE, '  async function tSpectateLoad() {', '\n  // 觀戰：進入某場對戰', 'tSpectateLoad'));
  assert.equal(/:\s*\[\]\s*;/.test(a), false, 'tChampionsLoad 仍會被壞回應清空');
  assert.equal(/:\s*\[\]\s*;/.test(b), false, 'tSpectateLoad 仍會被壞回應清空');
  assert.ok(a.includes('adoptOrKeep') && b.includes('adoptOrKeep'));
});
T('⭐5d 已有資料時，「載入中」不得整塊蓋掉排行榜／個人資料', () => {
  const tpl = stripComments(PAGE);
  assert.ok(tpl.includes('{#if tLbLoading && !tLeaderboard}'), '排行榜的載入中仍會蓋掉已顯示的資料');
  assert.ok(tpl.includes('{#if tProfileLoading && !tProfile}'), '個人資料的載入中仍會蓋掉已顯示的資料');
});

// ── 6) 版面：輕量提示 + 空狀態 + 穩定 key ──────────────────────────────
T('⭐6a 核心②：賽程真的沒有資料時有空狀態容器（舊版是什麼都不畫）', () => {
  const tpl = stripComments(PAGE);
  assert.ok(tpl.includes('{#if tBrackets.length === 0 && tRunningEvents.length > 0}'), '缺少賽程空狀態');
  assert.ok(tpl.includes('賽程載入中…'));
});
T('6b 輕量提示：stale 時掛 .tourn-stale，且該 class 有對應 CSS（否則是看不見的死標記）', () => {
  const tpl = stripComments(PAGE);
  assert.ok((tpl.match(/\{#if tBracketsStale\}/g) || []).length >= 2, '排名與賽程表兩個標題列都要掛');
  assert.ok(/\.tourn-stale\s*\{/.test(tpl), '.tourn-stale 沒有 CSS 定義');
});
T('6c 輕量提示不得用會造成版面跳動的方式（不得是 block / 不得帶 height）', () => {
  const css = /\.tourn-stale\s*\{([^}]*)\}/.exec(stripComments(PAGE));
  assert.ok(css, '找不到 .tourn-stale CSS');
  assert.equal(/display\s*:\s*block/.test(css[1]), false);
  assert.equal(/height\s*:/.test(css[1]), false);
});
T('6d 賽程每一場要有穩定 key（無 key 的 each 會在輪次推進時整排重畫造成閃爍）', () => {
  const tpl = stripComments(PAGE);
  assert.equal(tpl.includes('{#each _roundMatches as m}'), false, '_roundMatches 的 each 仍沒有 key');
  assert.ok(tpl.includes("{#each _roundMatches as m (m.round + '_' + m.idx)}"));
});

// ── 7) 保留舊資料不得誤導：輪次號碼用權威值 + 排名表穩定 key ────────────
// ⚠ 錨點找不到時不可以在模組頂層炸掉整支測試（會蓋掉其他失敗項），改成一條可讀的 FAIL。
let HELPERS = null;
T('7-0 liveRoundOf / standingsKeyed 兩支輔助函式存在（保留舊資料時不誤導玩家的關鍵）', () => {
  const a = slice(PAGE, '  function liveRoundOf(brk: any): number {', '\n  // ⭐v6.177 排名表的穩定 key', 'liveRoundOf');
  const b = slice(PAGE, '  function standingsKeyed(rows: any[]): any[] {', '\n  // v5.937 賽程翻頁改 per-event', 'standingsKeyed');
  HELPERS = new Function('st', `
    var tEvents = st.tEvents;
    ${ts(a)}
    ${ts(b)}
    return { liveRoundOf: liveRoundOf, standingsKeyed: standingsKeyed };
  `)({ tEvents: [{ _id: 'E1', currentRound: 4 }] });
});
const H7 = () => { assert.ok(HELPERS, '前置的 7-0 已失敗'); return HELPERS; };

T('⭐7a 保留的賽程是舊輪時，輪次號碼一律顯示 /event 的權威值（否則玩家會以為還在上一輪）', () => {
  assert.equal(H7().liveRoundOf({ event: { _id: 'E1', currentRound: 2 } }), 4);
});
T('7b /event 沒有這場（例如剛結束）⇒ 退回 bracket 自己的輪次，不會變 undefined', () => {
  assert.equal(H7().liveRoundOf({ event: { _id: 'ZZ', currentRound: 7 } }), 7);
});
T('7c 賽程翻頁 pageOf/setBracketPage 必須與標題用同一個輪次來源', () => {
  const body = stripComments(slice(PAGE, '  function pageOf(brk: any, rounds: number): number {', '\n  let tActiveRoom', 'pageOf'));
  assert.equal((body.match(/liveRoundOf\(brk\)/g) || []).length, 2, 'pageOf 與 setBracketPage 都要用 liveRoundOf');
  assert.equal(/brk\?\.event\?\.currentRound/.test(body), false);
});
T('⭐7d 排名表的 key 不得含每輪都會變的 rank（結算洗牌時整張表會被拆掉重建＝閃爍）', () => {
  const tpl = stripComments(PAGE);
  assert.equal(tpl.includes("{#each brk.standings as s (s.name + '_' + s.rank)}"), false);
  assert.ok(tpl.includes('{#each standingsKeyed(brk.standings) as s (s._k)}'));
});
T('7e standingsKeyed：名次洗牌時同一位玩家的 key 不變', () => {
  const a = H7().standingsKeyed([{ name: '阿明', rank: 1 }, { name: '小華', rank: 2 }]);
  const b = H7().standingsKeyed([{ name: '小華', rank: 1 }, { name: '阿明', rank: 2 }]);
  assert.equal(a.find((x) => x.name === '阿明')._k, b.find((x) => x.name === '阿明')._k);
});
T('7f standingsKeyed：同名玩家的 key 仍唯一（重複 key 會讓 Svelte 拋 each_key_duplicate）', () => {
  const r = H7().standingsKeyed([{ name: '阿明' }, { name: '阿明' }, { name: '阿明' }]);
  assert.equal(new Set(r.map((x) => x._k)).size, 3);
});

// ── 結果 ──────────────────────────────────────────────────────────────
if (fails.length) {
  console.error('v6.177 保留上一份好資料守衛：PASS ' + pass + ' / FAIL ' + fails.length);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('v6.177 保留上一份好資料守衛：PASS ' + pass + ' / FAIL 0');
