// v6.301 守衛：好友列的【🚪 加入房間 / 👁 觀戰】按鈕
//
// 站長的需求：好友剛好在一般對戰房間時（錦標賽除外），可以從好友名單一鍵加入或觀戰；
//   好友不在房間時按鈕不能按；好友在錦標賽對戰時要能提示「錦標賽對戰中」。
//
// ⚠⚠⚠ 這一版最大的風險不是功能不對，是**效能**：
//   `src/routes/game/+page.svelte` 大廳房間訂閱那個 $effect 的 `!isTournament` 是 v6.118 的
//   效能事故修正（每個開著錦標賽頁的玩家整場每 2 秒打兩支 /api/rooms，30 人賽 ≈ 每秒 30 個
//   純浪費的請求打進 Oracle 的單執行緒 ＝ 玩家回報的「人一多就很 lag」）。
//   ⇒ 本版**零新請求**：只把大廳本來就在跑的 `openRooms` 再用一次。
//   ⇒ 錦標賽頁的好友分頁與 `/friends` 獨立頁**不傳 rooms ⇒ 整組按鈕不渲染**。
//   【D】用假 fetch 計數 200 次房間更新、【F】兩個掛載點各驗一次，就是在釘這兩條。
//
// 章節：
//   【A】HEAD-FAIL 錨點（對 BASE 樹跑一定紅）
//   【B】純函式行為（esbuild 轉譯 friend-rooms.ts **實跑**，不是字串比對）
//   【C】比對複雜度 O(房間數)＋巢狀迴圈正對照（Rule 32：效能數字附量測）
//   【D】零新請求：真的掛起來、200 次房間更新 ⇒ 對 /api/rooms、/api/friends 零額外請求
//   【E】四種狀態各自實跑（DOM）＋ 點下去真的走既有流程
//   【F】沒傳 rooms ⇒ 整組按鈕不渲染（錦標賽分頁與 /friends 各驗一次；靜態＋行為端）
//   【G】大廳輪詢在好友分頁照跑（求值＋正對照）
//   【H】三尺寸框架安全 ＋ **新舊元素對齊**（v6.298 的教訓：只驗零位移會漏掉整條右移）
//   【I】回歸不變量：零 {@html}、each 穩定 key、零 timer／零 fetch（friend-rooms.ts）
//   【J】突變測試（沒紅 ＝ 守衛是安慰劑）
//
// ⚠ 不 pin 任何版本號／sha：斷言的都是不綁版本的等價條件。
import assert from 'node:assert';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_FR = join(ROOT, 'src/lib/friends/friend-rooms.ts');
const P_FRP = join(ROOT, 'src/lib/friends/FriendsPanel.svelte');
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_CTX = join(ROOT, 'src/lib/friends/auth-ctx.ts');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_FRIENDS_PAGE = join(ROOT, 'src/routes/friends/+page.svelte');

let pass = 0, fail = 0;
const skipped = [];
async function T(name, fn) {
  try { await fn(); console.log('  OK  ', name); pass++; }
  catch (e) { console.log('  FAIL', name, '::', e && e.message); fail++; }
}
const stripCmt = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
/** ⚠ 掃「原始碼裡有沒有 setInterval／{@html}」時**連 `//` 行註解也要剝** ——
 *  這兩個字在註解裡本來就寫得到（本專案的註解會明講「本檔零 setInterval」），
 *  只剝區塊註解會產生假紅。`://`（網址）不算註解。 */
const stripAllCmt = (s) => stripCmt(s).replace(/(^|[^:])\/\/.*$/gm, '$1');
/** 突變：確認錨點真的存在（找不到就是掃描器瞎了，不是「突變沒生效」）。 */
function mutate(src, from, to) {
  assert.ok(src.includes(from), '突變錨點不存在：' + from.slice(0, 80));
  return src.replace(from, to);
}

/** 「房名（房主：X）」那一行的模板形狀 —— ⚠ 只比字串 'fr-room' 會被 CSS 規則餵飽（安慰劑）。 */
const RE_FR_ROOM = /<span class="fr-room">🎮 \{_rs\.room\.roomName\}（房主：\{_rs\.room\.hostName\}）<\/span>/;
const FR = existsSync(P_FR) ? readFileSync(P_FR, 'utf8') : '';
const FRP = readFileSync(P_FRP, 'utf8');
const GAME = readFileSync(P_GAME, 'utf8');
const FRIENDS_PAGE = readFileSync(P_FRIENDS_PAGE, 'utf8');

// ══════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL 錨點');
await T('A0 ⭐⭐⭐ 共用模組 friend-rooms.ts 存在且非空；FriendsPanel 有 rooms／onjoinroom prop；大廳掛載點有傳 rooms（BASE 一個都沒有）', () => {
  assert.ok(existsSync(P_FR), '缺 src/lib/friends/friend-rooms.ts');
  assert.ok(FR.length > 2000, 'friend-rooms.ts 只有 ' + FR.length + ' 字元 —— 被掏空');
  for (const k of ['buildFriendRoomIndex', 'friendRoomState', 'friendRoomLabel', 'friendRoomClickable', 'FRIEND_SEAT_SLOTS']) {
    assert.ok(FR.includes('export ') && FR.includes(k), 'friend-rooms.ts 缺 ' + k);
  }
  for (const k of ['rooms', 'onjoinroom', 'joinBlockedMsg', 'showRoomBtn', 'roomIndex', 'fr-join', 'fr-room']) {
    assert.ok(FRP.includes(k), 'FriendsPanel.svelte 缺「' + k + '」');
  }
  assert.ok(RE_FR_ROOM.test(FRP),
    '⚠⚠ 模板裡沒有「房名＋房主名」那一行 —— uid 來源未經驗證，一定要顯示出來讓玩家自己判斷');
  assert.ok(GAME.includes('rooms={openRooms}'), 'game/+page.svelte 的大廳掛載點沒有傳 rooms={openRooms}');
  assert.ok(GAME.length > 500000, 'game/+page.svelte 只讀到 ' + GAME.length + ' 字元 —— 讀錯檔？');
});
await T('A1 ⭐ friends-api 的 FriendRow 有 inTournament，而且 toRow 用 `=== true` 正規化（舊伺服器沒有 ⇒ false）', () => {
  const API = readFileSync(P_API, 'utf8');
  assert.ok(/inTournament\?: boolean;/.test(API), 'FriendRow 沒有 inTournament 欄位');
  assert.ok(/inTournament: r\.inTournament === true,/.test(API),
    'toRow 沒有把 inTournament 正規化成布林（舊伺服器少欄位時會變 undefined 漏到畫面）');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【B】純函式行為（esbuild 轉譯 friend-rooms.ts 實跑）');
const require_ = createRequire(import.meta.url);
let esbuild = null;
try { esbuild = require_('esbuild'); } catch { esbuild = null; }
let LIB = null, libErr = '';
if (!esbuild) {
  skipped.push('【B】【C】純函式實跑（沒有 esbuild）');
  console.log('  ⚠⚠ SKIP：這台機器沒有 esbuild');
} else {
  // ⚠⚠ HEAD-FAIL 紀律：對 BASE 樹跑時 friend-rooms.ts 根本不存在 —— 這裡**不可以讓整支 crash**，
  //   否則後面每一條斷言都不會被執行，看起來像「只紅了兩條」。改成記下錯誤、逐條紅。
  try {
    const dir = mkdtempSync(join(tmpdir(), 'v6301-'));
    await esbuild.build({ entryPoints: [P_FR], bundle: true, format: 'cjs', platform: 'node', outfile: join(dir, 'fr.cjs'), logLevel: 'silent' });
    LIB = require_(join(dir, 'fr.cjs'));
  } catch (e) { LIB = null; libErr = String((e && e.message) || e).slice(0, 160); }
}
/** friend-rooms.ts 載入不起來時，把該節的每一條都判紅（而不是靜靜跳過）。 */
async function libDead(names) {
  for (const n of names) await T(n, () => { throw new Error('friend-rooms.ts 載入失敗 ⇒ 這一節無法執行：' + libErr); });
}
if (esbuild && !LIB) await libDead([
  'B0 掃描器自驗', 'B1 四種狀態', 'B2 inTournament undefined 不放行', 'B3 只看 p1／p2 兩個座位',
  'B4 uids fallback／ended 不進索引', 'B5 髒資料不爆掉', 'B6 房名退回房主名',
  'C1 索引法比巢狀迴圈快', 'C2 房間數線性', 'C3 單次耗時上限',
  'J1~J4 純函式突變',
]);

const room = (id, status, seats, name, host) => ({
  roomId: id, status, roomName: name ?? ('房間' + id), hostName: host ?? ('房主' + id),
  seats: seats.map((u) => (u === null ? { uid: null } : { uid: u })),
});
const ROOMS = [
  room('AAAA', 'lobby', ['u1', null], '小明的練習房', '小明'),
  room('BBBB', 'playing', ['zz', 'u2'], '對戰房', '路人'),
  room('CCCC', 'ended', ['u9', 'u8'], '結束房', '誰'),
  room('DDDD', 'lobby', ['x1', 'x2', 'u7'], '滿座房', '滿'),   // u7 在**觀戰位**（座位 2）
  room('EEEE', 'lobby', ['u5', null], '舊 uid 房', '老王'),
];

if (LIB) {
  await T('B0 掃描器自驗：索引真的建得出東西（下限斷言，避免「空索引 ⇒ 全部 none」的假綠）', () => {
    const idx = LIB.buildFriendRoomIndex(ROOMS);
    assert.ok(idx.size >= 5, '索引只有 ' + idx.size + ' 筆 ⇒ 建索引壞了');
    assert.strictEqual(LIB.FRIEND_SEAT_SLOTS, 2, '只該看 p1/p2 兩個座位');
  });
  await T('B1 ⭐⭐ 四種狀態：等待中＝join／對戰中＝spectate／inTournament＝tournament／其餘＝none', () => {
    const idx = LIB.buildFriendRoomIndex(ROOMS);
    const s1 = LIB.friendRoomState({ uid: 'u1', uids: [] }, idx);
    assert.strictEqual(s1.kind, 'join');
    assert.strictEqual(s1.room.roomId, 'AAAA');
    assert.strictEqual(s1.room.roomName, '小明的練習房');
    assert.strictEqual(s1.room.hostName, '小明');
    const s2 = LIB.friendRoomState({ uid: 'u2', uids: [] }, idx);
    assert.strictEqual(s2.kind, 'spectate');
    assert.strictEqual(s2.room.roomId, 'BBBB');
    const s3 = LIB.friendRoomState({ uid: 'nobody', uids: [], inTournament: true }, idx);
    assert.deepStrictEqual([s3.kind, s3.room], ['tournament', null]);
    const s4 = LIB.friendRoomState({ uid: null, uids: [] }, idx);
    assert.deepStrictEqual([s4.kind, s4.room], ['none', null]);
    assert.deepStrictEqual(
      [s1, s2, s3, s4].map(LIB.friendRoomClickable), [true, true, false, false],
      '可點性不對（tournament／none 一律不可點）');
    assert.deepStrictEqual(
      [s1, s2, s3].map(LIB.friendRoomLabel), ['🚪 加入房間', '👁 觀戰', '🏆 錦標賽對戰中']);
  });
  await T('B2 ⭐⭐⭐ inTournament 是 undefined（舊伺服器）⇒ 當 false，**而且不放行加入**（仍是 none）', () => {
    const idx = LIB.buildFriendRoomIndex(ROOMS);
    for (const v of [undefined, false, null, 0, '', 'true', 1]) {
      const st = LIB.friendRoomState({ uid: 'nobody', uids: [], inTournament: v }, idx);
      assert.strictEqual(st.kind, 'none', 'inTournament=' + JSON.stringify(v) + ' 竟然不是 none');
      assert.strictEqual(LIB.friendRoomClickable(st), false,
        '⚠⚠ inTournament=' + JSON.stringify(v) + ' 竟然放行加入');
    }
    // 正對照：真的 true 才會變成 tournament
    assert.strictEqual(LIB.friendRoomState({ uid: 'n', uids: [], inTournament: true }, idx).kind, 'tournament');
  });
  await T('B3 ⭐⭐ 只看 p1／p2 兩個座位：好友坐在**觀戰位**不算「他在這間房」', () => {
    const idx = LIB.buildFriendRoomIndex(ROOMS);
    assert.strictEqual(LIB.friendRoomState({ uid: 'u7', uids: [] }, idx).kind, 'none',
      '觀戰位（座位 2）被算成在房內');
    // 正對照：同一間房的 p1／p2 認得出來
    assert.strictEqual(LIB.friendRoomState({ uid: 'x1', uids: [] }, idx).room.roomId, 'DDDD');
    assert.strictEqual(LIB.friendRoomState({ uid: 'x2', uids: [] }, idx).room.roomId, 'DDDD');
  });
  await T('B4 ⭐ uid 比不到時往 uids（最近 5 個）找；status 不是 lobby／playing 的房一律不進索引', () => {
    const idx = LIB.buildFriendRoomIndex(ROOMS);
    const st = LIB.friendRoomState({ uid: 'oldone', uids: ['nope', 'u5'] }, idx);
    assert.strictEqual(st.kind, 'join');
    assert.strictEqual(st.room.roomId, 'EEEE');
    assert.strictEqual(LIB.friendRoomState({ uid: 'u9', uids: [] }, idx).kind, 'none', 'ended 的房被算進來了');
    assert.strictEqual(LIB.friendRoomState({ uid: 'u8', uids: [] }, idx).kind, 'none', 'ended 的房被算進來了');
  });
  await T('B5 ⭐ 髒資料不得爆掉：rooms 是 null／房間缺 seats／seats 有 null／roomId 空字串', () => {
    for (const bad of [null, undefined, [], [null], [{}], [{ roomId: 'A', status: 'lobby' }],
                       [{ roomId: '', status: 'lobby', seats: [{ uid: 'u1' }] }],
                       [{ roomId: 'A', status: 'lobby', seats: [null, undefined] }]]) {
      const idx = LIB.buildFriendRoomIndex(bad);
      assert.ok(idx instanceof Map, '髒資料回傳的不是 Map：' + JSON.stringify(bad));
      assert.strictEqual(LIB.friendRoomState({ uid: 'u1', uids: [] }, idx).kind, 'none');
    }
    assert.strictEqual(LIB.friendRoomState(null, null).kind, 'none');
    assert.strictEqual(LIB.friendRoomState({ uid: 'u1' }, null).kind, 'none');
  });
  await T('B6 ⭐ 房名空白時退回房主名（與大廳列表同一套顯示規則）；房名／房主名一定拿得到', () => {
    const idx = LIB.buildFriendRoomIndex([room('ZZZZ', 'lobby', ['u1', null], '', '房主小華')]);
    const st = LIB.friendRoomState({ uid: 'u1', uids: [] }, idx);
    assert.strictEqual(st.room.roomName, '房主小華');
    assert.strictEqual(st.room.hostName, '房主小華');
  });
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n【C】比對複雜度：O(房間數)，不是 O(房間 × 好友)');
if (LIB) {
  const mkRooms = (n) => Array.from({ length: n }, (_, i) =>
    room('R' + i, i % 2 ? 'playing' : 'lobby', ['p' + i, 'q' + i]));
  const mkFriends = (n) => Array.from({ length: n }, (_, i) =>
    ({ uid: 'f' + i, uids: ['a' + i, 'b' + i, 'c' + i, 'd' + i, 'e' + i] }));   // 全部比不到（最壞情況：6 次查表都落空）
  /** 正對照：v6.301 之前那種「每位好友掃一遍所有房間」的巢狀寫法。 */
  const nested = (rooms, friends) => {
    let hits = 0;
    for (const f of friends) {
      const keys = [f.uid, ...f.uids];
      for (const r of rooms) for (let i = 0; i < 2; i++) {
        if (keys.includes(r.seats[i] && r.seats[i].uid)) hits++;
      }
    }
    return hits;
  };
  const indexed = (rooms, friends) => {
    const idx = LIB.buildFriendRoomIndex(rooms);
    let hits = 0;
    for (const f of friends) if (LIB.friendRoomState(f, idx).room) hits++;
    return hits;
  };
  const bench = (fn, rooms, friends, iters) => {
    fn(rooms, friends);   // 暖機
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) fn(rooms, friends);
    return Number(process.hrtime.bigint() - t0) / 1e6 / iters;
  };
  const R100 = mkRooms(100), F100 = mkFriends(100);
  const tIdx100 = bench(indexed, R100, F100, 200);
  const tNest100 = bench(nested, R100, F100, 200);
  const tIdx400 = bench(indexed, mkRooms(400), F100, 100);
  console.log(`      100 房 × 100 好友：索引法 ${tIdx100.toFixed(4)} ms／次｜巢狀迴圈 ${tNest100.toFixed(4)} ms／次｜倍率 ${(tNest100 / tIdx100).toFixed(1)}×`);
  console.log(`      400 房 × 100 好友：索引法 ${tIdx400.toFixed(4)} ms／次（相對 100 房的倍率 ${(tIdx400 / tIdx100).toFixed(2)}×，線性 ⇒ 應接近 1~4×）`);
  await T('C1 ⭐⭐ 100 房 × 100 好友：索引法比巢狀迴圈快至少 5 倍（正對照：巢狀真的慢很多）', () => {
    assert.ok(tNest100 / tIdx100 >= 5,
      '只快了 ' + (tNest100 / tIdx100).toFixed(1) + ' 倍 ⇒ 不是 O(房間數) 的寫法（或量測失效）');
  });
  await T('C2 ⭐⭐ 房間數 ×4 而好友數不變 ⇒ 耗時成長 ≤ 8 倍（線性；平方會是 16 倍起跳）', () => {
    assert.ok(tIdx400 / tIdx100 <= 8,
      '房間 ×4 時耗時變成 ' + (tIdx400 / tIdx100).toFixed(2) + ' 倍 ⇒ 不是線性');
  });
  await T('C3 ⭐ 量測有效性正對照：100 房 × 100 好友的索引法單次 < 2ms（沙盒 CPU 比正式 VM 慢約 10 倍）', () => {
    assert.ok(tIdx100 < 2, '索引法單次 ' + tIdx100.toFixed(3) + ' ms —— 太慢，每 2 秒跑一次會有感');
  });
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n【D】【E】【F】【H】行為端（playwright）');
let chromium = null;
try { chromium = require_(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium; } catch { chromium = null; }

const LIST = {
  friendsApi: 1, me: { uid: 'me', nick: '我' },
  friends: [
    { fid: 'f1', status: 'accepted', nick: '小明', alias: null, uid: 'u1', uids: [], requestedByMe: true, blockedByMe: false, via: 'battle', at: 1 },
    { fid: 'f2', status: 'accepted', nick: '阿華', alias: null, uid: 'u2', uids: [], requestedByMe: false, blockedByMe: false, via: 'battle', at: 2 },
    { fid: 'f3', status: 'accepted', nick: '小賽', alias: null, uid: 'nobody', uids: [], requestedByMe: false, blockedByMe: false, via: 'email', at: 3, inTournament: true },
    { fid: 'f4', status: 'accepted', nick: '阿宅', alias: null, uid: null, uids: [], requestedByMe: false, blockedByMe: false, via: 'email', at: 4 },
    { fid: 'f5', status: 'accepted', nick: '老王', alias: null, uid: 'gone', uids: ['nope', 'u5'], requestedByMe: false, blockedByMe: false, via: 'battle', at: 5 },
  ],
  incoming: [{ fid: 'g1', status: 'pending', nick: '路人甲', alias: null, uid: null, uids: [], requestedByMe: false, blockedByMe: false, via: 'email', at: 6 }],
  outgoing: [],
  blocked: [{ fid: 'b1', status: 'blocked', nick: '壞人', alias: null, uid: 'u1', uids: [], requestedByMe: true, blockedByMe: true, via: null, at: 7 }],
  limit: 100, truncated: false,
};

if (!chromium || !esbuild) {
  skipped.push('【D】【E】【H】行為端 DOM（缺 playwright／esbuild）');
  console.log('  ⚠⚠ SKIP：缺 playwright 或 esbuild ⇒ 掛載行為與版面量測沒有跑（【A】【B】【C】【F】【G】【I】【J】仍在守）');
} else {
  const { compile } = await import('svelte/compiler');
  const dir = mkdtempSync(join(tmpdir(), 'v6301pw-'));
  // ⚠⚠ 同上：BASE 樹沒有 friend-rooms.ts，打包會炸 —— 轉成一條紅，不要讓整支 crash。
  let pwFatal = '';
  // ⚠ Harness 是本守衛自己寫的最小外殼：讓 rooms／joinBlockedMsg 可以在掛載後被改（模擬每 2 秒一次的房間更新）。
  const HARNESS = `<script>
  import P from './FriendsPanel.js';
  let rooms = $state(null);
  let blocked = $state('');
  let mode = $state('with');
  globalThis.__setRooms = (r) => { rooms = r; };
  globalThis.__setBlocked = (m) => { blocked = m; };
  globalThis.__joins = [];
  const onjoin = (id) => { globalThis.__joins.push(id); };
</script>
{#if mode === 'with'}
  <P embedded {rooms} onjoinroom={onjoin} joinBlockedMsg={blocked} />
{:else}
  <P embedded />
{/if}
`;
  writeFileSync(join(dir, 'FriendsPanel.js'), compile(FRP, { generate: 'client', filename: 'FriendsPanel.svelte', runes: true, css: 'injected' }).js.code);
  writeFileSync(join(dir, 'Harness.js'), compile(HARNESS, { generate: 'client', filename: 'Harness.svelte', runes: true, css: 'injected' }).js.code);
  writeFileSync(join(dir, 'fb.js'), 'export const auth = globalThis.__auth;\n');
  writeFileSync(join(dir, 'fbauth.js'), 'export function onAuthStateChanged(a, cb){ setTimeout(()=>cb(globalThis.__auth.currentUser),0); return ()=>{}; }\n');
  writeFileSync(join(dir, 'entry.js'),
    "import { mount, flushSync } from 'svelte';\nimport H from './Harness.js';\nimport P from './FriendsPanel.js';\n"
    + "globalThis.__mount = (t, props) => mount(H, { target: t, props });\n"
    + "globalThis.__mountBare = (t, props) => mount(P, { target: t, props });\n"
    + "globalThis.__flush = flushSync;\n");
  try {
  await esbuild.build({
    entryPoints: [join(dir, 'entry.js')], bundle: true, format: 'iife', outfile: join(dir, 'bundle.js'), logLevel: 'silent',
    alias: {
      '$lib/firebase': join(dir, 'fb.js'), 'firebase/auth': join(dir, 'fbauth.js'),
      '$lib/friends/friends-api': P_API, '$lib/friends/auth-ctx': P_CTX,
      '$lib/friends/friend-rooms': P_FR, '$lib/ui/stale-keep': join(ROOT, 'src/lib/ui/stale-keep.ts'),
    },
    nodePaths: [join(ROOT, 'node_modules')], loader: { '.ts': 'ts' },
    define: { 'import.meta.env': JSON.stringify({ VITE_ORACLE_API_URL: 'https://t.local' }) },
  });
  } catch (e) { pwFatal = String((e && e.message) || e).slice(0, 160); }
  let bundle = '';
  if (!pwFatal) {
    try { bundle = readFileSync(join(dir, 'bundle.js'), 'utf8'); }
    catch (e) { pwFatal = String((e && e.message) || e).slice(0, 160); }
  }
  if (pwFatal) {
    for (const n of ['D1 零新請求', 'E1 四種狀態', 'E2 房名＋房主名', 'E3 只有好友區有',
                     'E4 點下去走既有流程', 'E5 joinBlockedMsg', 'F1 沒傳 rooms 零按鈕',
                     'F2 只給 rooms 也不渲染', 'H1~H4 三尺寸框架安全與對齊']) {
      await T(n, () => { throw new Error('元件打包失敗 ⇒ 行為端無法執行：' + pwFatal); });
    }
  }
  const browser = pwFatal ? null : await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] });
  try {
    if (!browser) throw new Error('__skip__');
    /** 開一頁、灌假 fetch、載入 bundle。 */
    async function newPage(ctx) {
      const pg = await ctx.newPage();
      await pg.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div></body></html>' }));
      await pg.goto('https://t.local/');
      await pg.evaluate((L) => {
        window.__calls = [];
        window.fetch = async (url, init) => {
          window.__calls.push(String(url));
          return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => L };
        };
        window.__auth = { currentUser: { uid: 'me', isAnonymous: false, getIdToken: async () => 'tok' } };
      }, LIST);
      await pg.addScriptTag({ content: bundle });
      return pg;
    }
    const PWROOMS = [
      { roomId: 'AAAA', status: 'lobby', roomName: '小明的練習房', hostName: '小明', seats: [{ uid: 'u1' }, { uid: null }] },
      { roomId: 'BBBB', status: 'playing', roomName: '華山論劍', hostName: '路人', seats: [{ uid: 'zz' }, { uid: 'u2' }] },
      { roomId: 'EEEE', status: 'lobby', roomName: '老王的房', hostName: '老王', seats: [{ uid: 'u5' }, { uid: null }] },
    ];

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await newPage(ctx);
    await pg.evaluate((rs) => { window.__mount(document.getElementById('app'), {}); window.__setRooms(rs); }, PWROOMS);
    await pg.waitForTimeout(300);

    // ── 【E】四種狀態 ───────────────────────────────────────────────
    const snap = await pg.evaluate(() => {
      const rows = [...document.querySelectorAll('.fr-panel .row')];
      return rows.map((r) => ({
        nick: r.querySelector('.nick') ? r.querySelector('.nick').textContent : '',
        btn: r.querySelector('.fr-join') ? r.querySelector('.fr-join').textContent.trim() : null,
        disabled: r.querySelector('.fr-join') ? r.querySelector('.fr-join').disabled : null,
        title: r.querySelector('.fr-join') ? r.querySelector('.fr-join').title : null,
        room: r.querySelector('.fr-room') ? r.querySelector('.fr-room').textContent.trim() : null,
      }));
    });
    await T('E1 ⭐⭐⭐ 四種狀態各自實跑：等待中＝可點的「🚪 加入房間」、對戰中＝可點的「👁 觀戰」、錦標賽＝停用的「🏆 錦標賽對戰中」、不在房間＝停用', () => {
      assert.strictEqual(snap.length, 7, '列數不對（5 好友＋1 待確認＋1 已封鎖）：' + snap.length);
      assert.deepStrictEqual(snap.slice(0, 5).map((r) => [r.nick, r.btn, r.disabled]), [
        ['小明', '🚪 加入房間', false],
        ['阿華', '👁 觀戰', false],
        ['小賽', '🏆 錦標賽對戰中', true],
        ['阿宅', '🚪 加入房間', true],
        ['老王', '🚪 加入房間', false],
      ], '四種狀態的顯示／可點性不對：' + JSON.stringify(snap.slice(0, 5)));
      assert.ok(/錦標賽/.test(snap[2].title), '錦標賽那顆的說明沒有提到錦標賽：' + snap[2].title);
      assert.ok(!/即時/.test(snap[2].title + snap[2].btn), '⚠ 文案不可以寫成「即時」（inTournament 是快照）');
    });
    await T('E2 ⭐⭐⭐ 配對到房間的列一定顯示**房名＋房主名**（uid 未經驗證，玩家要看得到再決定）', () => {
      assert.ok(/小明的練習房/.test(snap[0].room) && /房主：小明/.test(snap[0].room), '加入那一列沒有房名＋房主名：' + snap[0].room);
      assert.ok(/華山論劍/.test(snap[1].room) && /房主：路人/.test(snap[1].room), '觀戰那一列沒有房名＋房主名：' + snap[1].room);
      assert.ok(/老王的房/.test(snap[4].room), 'uids 配對到的那一列沒有房名：' + snap[4].room);
      assert.strictEqual(snap[2].room, null, '錦標賽那一列不該有房間資訊');
      assert.strictEqual(snap[3].room, null, '不在房間那一列不該有房間資訊');
    });
    await T('E3 ⭐⭐ 只有「好友」區有這組按鈕：待我確認／已封鎖兩區一顆都沒有（即使 uid 配得到房間）', () => {
      assert.strictEqual(snap[5].btn, null, '「待我確認」區出現了加入按鈕');
      assert.strictEqual(snap[6].btn, null, '「已封鎖」區出現了加入按鈕（而且那位的 uid 正好配得到房間）');
    });
    await T('E4 ⭐⭐⭐ 點下去真的把房號交給外面的既有流程（加入與觀戰同一條路）；停用的那兩顆點了沒有反應', async () => {
      await pg.evaluate(() => {
        const rows = [...document.querySelectorAll('.fr-panel .row')];
        rows[0].querySelector('.fr-join').click();
        rows[1].querySelector('.fr-join').click();
        rows[2].querySelector('.fr-join').click();
        rows[3].querySelector('.fr-join').click();
      });
      const joins = await pg.evaluate(() => window.__joins);
      assert.deepStrictEqual(joins, ['AAAA', 'BBBB'], '交出去的房號不對（停用的那兩顆不該有反應）：' + JSON.stringify(joins));
    });
    await T('E5 ⭐⭐ joinBlockedMsg 非空（例如玩家名稱還沒填）⇒ 按鈕全部停用並掛一行說明，**不放行加入**', async () => {
      await pg.evaluate(() => { window.__joins.length = 0; window.__setBlocked('請先填寫玩家名稱。'); window.__flush(); });
      const st = await pg.evaluate(() => {
        const rows = [...document.querySelectorAll('.fr-panel .row')];
        rows[0].querySelector('.fr-join').click();
        return {
          dis: rows.slice(0, 5).map((r) => r.querySelector('.fr-join').disabled),
          hint: [...document.querySelectorAll('.fr-panel .hint')].some((e) => e.textContent.includes('請先填寫玩家名稱')),
          joins: window.__joins.slice(),
        };
      });
      assert.deepStrictEqual(st.dis, [true, true, true, true, true], '沒有全部停用：' + JSON.stringify(st.dis));
      assert.ok(st.hint, '好友區沒有掛出說明那一行');
      assert.deepStrictEqual(st.joins, [], '⚠⚠ 停用狀態下竟然還能加入');
      await pg.evaluate(() => { window.__setBlocked(''); window.__flush(); });
    });

    // ── 【D】零新請求 ──────────────────────────────────────────────
    await T('D1 ⭐⭐⭐ 200 次房間更新（模擬每 2 秒一次的大廳更新 ≈ 6.7 分鐘）⇒ 對 /api/rooms、/api/friends 零額外請求', async () => {
      const before = await pg.evaluate(() => window.__calls.slice());
      assert.deepStrictEqual(before, ['https://t.local/api/friends/list'],
        '掛載後的請求本來就不對：' + JSON.stringify(before));
      const after = await pg.evaluate(() => {
        for (let i = 0; i < 200; i++) {
          window.__setRooms([
            { roomId: 'R' + i, status: i % 2 ? 'playing' : 'lobby', roomName: '房' + i, hostName: 'h' + i, seats: [{ uid: 'u1' }, { uid: 'u2' }] },
            { roomId: 'EEEE', status: 'lobby', roomName: '老王的房', hostName: '老王', seats: [{ uid: 'u5' }, { uid: null }] },
          ]);
          window.__flush();
        }
        return { calls: window.__calls.slice(), btn: document.querySelector('.fr-join').textContent.trim() };
      });
      const extra = after.calls.filter((u) => /\/api\/rooms|\/api\/friends/.test(u)).length - 1;
      assert.strictEqual(after.calls.length, 1, '200 次更新之後總請求數變成 ' + after.calls.length + '：' + JSON.stringify(after.calls.slice(0, 6)));
      assert.strictEqual(extra, 0, '多打了 ' + extra + ' 發 /api/rooms 或 /api/friends');
      // 正對照：畫面真的跟著房間更新走（否則「零請求」只是因為根本沒接上）
      assert.ok(['🚪 加入房間', '👁 觀戰'].includes(after.btn), '房間更新後畫面沒有跟著變：' + after.btn);
      console.log('      200 tick 後總 fetch 次數 =', after.calls.length, '（＝掛載時那一發 list，零額外請求）');
    });

    // ── 【F】沒傳 rooms ⇒ 整組不渲染（行為端）─────────────────────
    await T('F1 ⭐⭐⭐ 行為端：**不傳 rooms／onjoinroom** 掛載 ⇒ DOM 裡一顆 .fr-join／.fr-room 都沒有（錦標賽分頁與 /friends 的情形）', async () => {
      const pg2 = await newPage(ctx);
      await pg2.evaluate(() => { window.__mountBare(document.getElementById('app'), { embedded: true }); });
      await pg2.waitForTimeout(300);
      const st = await pg2.evaluate(() => ({
        join: document.querySelectorAll('.fr-join').length,
        room: document.querySelectorAll('.fr-room').length,
        rows: document.querySelectorAll('.row').length,
        others: document.querySelectorAll('.row button').length,
      }));
      assert.strictEqual(st.join, 0, '沒傳 rooms 卻渲染了 ' + st.join + ' 顆加入按鈕');
      assert.strictEqual(st.room, 0, '沒傳 rooms 卻渲染了房間資訊');
      assert.strictEqual(st.rows, 7, '列數不對 ⇒ 掃描器抓錯（' + st.rows + '）');
      assert.ok(st.others > 0, '正對照：既有的按鈕還在（' + st.others + ' 顆）');
      await pg2.close();
    });
    await T('F2 ⭐⭐ 行為端：只傳 rooms、沒傳 onjoinroom ⇒ 也不渲染（不做「按了沒反應」的按鈕）', async () => {
      const pg3 = await newPage(ctx);
      await pg3.evaluate((rs) => { window.__mountBare(document.getElementById('app'), { embedded: true, rooms: rs }); }, PWROOMS);
      await pg3.waitForTimeout(300);
      const n = await pg3.evaluate(() => document.querySelectorAll('.fr-join').length);
      assert.strictEqual(n, 0, '只給 rooms 沒給 onjoinroom 竟然渲染了 ' + n + ' 顆按鈕');
      await pg3.close();
    });
    await ctx.close();

    // ── 【H】三尺寸框架安全 ＋ 新舊元素對齊 ────────────────────────
    const SIZES = [[375, 812], [390, 844], [1366, 768]];
    const measure = async (w, h, withRooms) => {
      const c = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await newPage(c);
      if (withRooms) {
        await p.evaluate((rs) => { window.__mount(document.getElementById('app'), {}); window.__setRooms(rs); }, PWROOMS);
      } else {
        await p.evaluate(() => { window.__mountBare(document.getElementById('app'), { embedded: true }); });
      }
      await p.waitForTimeout(300);
      const out = await p.evaluate(() => {
        const R = (e) => { const r = e.getBoundingClientRect(); return { l: +r.left.toFixed(2), r: +r.right.toFixed(2), t: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
        const rows = [...document.querySelectorAll('.fr-panel .row')];
        const panel = document.querySelector('.fr-panel');
        const pcs = getComputedStyle(rows[0]);
        return {
          panel: R(panel),
          add: R(document.querySelector('.fr-panel .add')),
          groups: [...document.querySelectorAll('.fr-panel .group h2')].map(R),
          rows: rows.map(R),
          nicks: rows.map((x) => R(x.querySelector('.nick'))),
          firstBtns: rows.map((x) => { const b = x.querySelector('button'); return b ? R(b) : null; }),
          allBtns: rows.map((x) => [...x.querySelectorAll('button')].map(R)),
          joins: rows.map((x) => { const b = x.querySelector('.fr-join'); return b ? R(b) : null; }),
          frRooms: rows.map((x) => { const b = x.querySelector('.fr-room'); return b ? R(b) : null; }),
          // ⚠ .row 有 1px 框線：內容區邊界 = 邊框盒 ∓（border + padding），漏掉 border 會差 1px
          rowPad: { l: parseFloat(pcs.paddingLeft) + parseFloat(pcs.borderLeftWidth),
                    r: parseFloat(pcs.paddingRight) + parseFloat(pcs.borderRightWidth) },
          rowGap: parseFloat(pcs.columnGap),
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
        };
      });
      await c.close();
      return out;
    };
    for (const [w, h] of SIZES) {
      const base = await measure(w, h, false);
      const now = await measure(w, h, true);
      const tag = w + '×' + h;
      const dRows = now.rows.map((r, i) => ({ dl: +(r.l - base.rows[i].l).toFixed(2), dr: +(r.r - base.rows[i].r).toFixed(2), dh: +(r.h - base.rows[i].h).toFixed(2) }));
      console.log(`      ${tag}｜面板 left/right ${now.panel.l}/${now.panel.r}（BASE ${base.panel.l}/${base.panel.r}）`
        + `｜列高 BASE ${base.rows.slice(0, 5).map((r) => r.h).join(',')} → NEW ${now.rows.slice(0, 5).map((r) => r.h).join(',')}`
        + `｜新鈕 left ${now.joins.slice(0, 5).map((j) => (j ? j.l : '-')).join(',')}`);
      await T(`H1 ${tag} ⭐⭐ 既有元素**水平零位移**：面板／加好友區／四個區標題／每一列的 left・right 與沒有按鈕時完全相同`, () => {
        assert.deepStrictEqual([now.panel.l, now.panel.r], [base.panel.l, base.panel.r], '面板左右邊界變了');
        assert.deepStrictEqual([now.add.l, now.add.r], [base.add.l, base.add.r], '「用 email 加好友」區左右邊界變了');
        assert.deepStrictEqual(now.groups.map((g) => [g.l, g.r]), base.groups.map((g) => [g.l, g.r]), '區標題左右邊界變了');
        assert.deepStrictEqual(dRows.map((d) => [d.dl, d.dr]), dRows.map(() => [0, 0]), '有列的左右邊界被推動：' + JSON.stringify(dRows));
        assert.deepStrictEqual([now.rows[0].t], [base.rows[0].t], '第一列的頂端位置變了（上面的東西被推動）');
        assert.deepStrictEqual(now.nicks.map((n) => n.l), base.nicks.map((n) => n.l), '暱稱的左緣被推動');
      });
      await T(`H2 ${tag} ⭐⭐⭐ **新舊元素對齊**：按鈕群仍靠右切齊（最右緣與 BASE 相同、等於列內容區右緣）、新按鈕與同行按鈕等高且間距一致、不多佔一行；房名那一行切齊暱稱`, () => {
        // ⚠ 這一列的按鈕群是**靠右**排的（.spacer{flex:1}），所以「新元素有沒有對齊」要看**右緣**，
        //   不是左緣 —— 新按鈕插在最前面時，左緣本來就會往左長出一顆按鈕的寬度。
        for (let i = 0; i < 5; i++) {
          const nb = now.allBtns[i], bb = base.allBtns[i], j = now.joins[i];
          assert.ok(j, '第 ' + i + ' 列沒有新按鈕');
          assert.strictEqual(nb.length, bb.length + 1, `第 ${i} 列的按鈕不是「剛好多一顆」：${bb.length} → ${nb.length}`);
          const maxR = (a) => Math.max(...a.map((b) => b.r));
          assert.strictEqual(maxR(nb), maxR(bb),
            `第 ${i} 列：按鈕群最右緣 ${maxR(nb)} ≠ BASE ${maxR(bb)}（整條偏移了 —— v6.298 的教訓）`);
          assert.strictEqual(maxR(nb), now.rows[i].r - now.rowPad.r,
            `第 ${i} 列：按鈕群沒有切齊列的內容區右緣（${maxR(nb)} vs ${now.rows[i].r - now.rowPad.r}）`);
          // 不多佔一行：按鈕列的行數（distinct top）與 BASE 相同
          assert.strictEqual(new Set(nb.map((b) => b.t)).size, new Set(bb.map((b) => b.t)).size,
            `第 ${i} 列：按鈕多佔了一行（BASE ${new Set(bb.map((b) => b.t)).size} 行 → NEW ${new Set(nb.map((b) => b.t)).size} 行）`);
          // 等高＋同一行的相鄰間距一致（＝新按鈕沒有自帶額外 margin）
          for (const b of nb) assert.strictEqual(b.h, j.h, `第 ${i} 列：按鈕高度不一致（新 ${j.h} vs ${b.h}）`);
          const sameLine = nb.filter((b) => b.t === j.t).sort((a, b) => a.l - b.l);
          const gaps = sameLine.slice(1).map((b, k) => +(b.l - sameLine[k].r).toFixed(2));
          for (const g of gaps) assert.strictEqual(g, now.rowGap,
            `第 ${i} 列：新按鈕與相鄰按鈕的間距 ${g} ≠ 列的 gap ${now.rowGap}`);
        }
        for (let i = 0; i < 5; i++) {
          if (!now.frRooms[i]) continue;
          assert.strictEqual(now.frRooms[i].l, now.nicks[i].l,
            `第 ${i} 列：房名那一行 left=${now.frRooms[i].l} ≠ 暱稱 left=${now.nicks[i].l}`);
          assert.strictEqual(now.frRooms[i].r, now.rows[i].r - now.rowPad.r,
            `第 ${i} 列：房名那一行右緣 ${now.frRooms[i].r} ≠ 列的內容區右緣 ${now.rows[i].r - now.rowPad.r}`);
        }
      });
      await T(`H3 ${tag} ⭐⭐ 不破版：新按鈕完全落在列的內容區內、同一列的按鈕彼此不重疊、整頁沒有水平捲軸`, () => {
        assert.ok(now.docW <= now.winW + 1, '出現水平捲軸：scrollWidth=' + now.docW + ' > ' + now.winW);
        for (let i = 0; i < now.rows.length; i++) {
          const j = now.joins[i];
          if (!j) continue;
          assert.ok(j.l >= now.rows[i].l + now.rowPad.l - 0.5 && j.r <= now.rows[i].r - now.rowPad.r + 0.5,
            `第 ${i} 列的新按鈕跑出內容區：btn=${j.l}~${j.r} row=${now.rows[i].l + now.rowPad.l}~${now.rows[i].r - now.rowPad.r}`);
          const bs = now.allBtns[i];
          for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) {
            const A = bs[a], B = bs[b];
            const overlap = A.l < B.r - 0.5 && B.l < A.r - 0.5 && A.t < B.t + B.h - 0.5 && B.t < A.t + A.h - 0.5;
            assert.ok(!overlap, `第 ${i} 列有兩顆按鈕重疊：${JSON.stringify(A)} / ${JSON.stringify(B)}`);
          }
        }
      });
      await T(`H4 ${tag} ⭐⭐ 列高變化一致：同一種狀態的列高相同；有房名的列剛好多一行（≤ 30px），其餘列的高度增量彼此相同`, () => {
        // 沒有房名資訊的三列（錦標賽／不在房間）：增量必須彼此相同
        const noRoom = [2, 3].map((i) => dRows[i].dh);
        assert.strictEqual(new Set(noRoom).size, 1, '沒有房名的那幾列高度增量不一致：' + JSON.stringify(noRoom));
        const withRoom = [0, 1, 4].map((i) => dRows[i].dh);
        assert.strictEqual(new Set(withRoom).size, 1, '有房名的那幾列高度增量不一致：' + JSON.stringify(withRoom));
        assert.ok(withRoom[0] - noRoom[0] <= 30 && withRoom[0] - noRoom[0] >= 0,
          '房名那一行佔的高度不合理（' + (withRoom[0] - noRoom[0]) + 'px）');
        assert.deepStrictEqual(dRows.slice(5).map((d) => d.dh), [0, 0], '待我確認／已封鎖兩列的高度被改到了');
      });
    }
  } catch (e) {
    if (String(e && e.message) !== '__skip__') throw e;
  } finally {
    if (browser) await browser.close();
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n【F】靜態：三個掛載點各傳什麼');
await T('F3 ⭐⭐⭐ 三個掛載點：只有**大廳**那一個傳 rooms／onjoinroom；錦標賽分頁與 `/friends` 一個都沒有', () => {
  const mounts = [...GAME.matchAll(/<FriendsPanel[\s\S]{0,600}?\/>/g)].map((m) => m[0]);
  assert.strictEqual(mounts.length, 2, 'game/+page.svelte 的 FriendsPanel 掛載點不是 2 個：' + mounts.length);
  const lobbyIdx = GAME.indexOf("{#if lobbyTab === 'friends'}");
  const tournIdx = GAME.indexOf("{:else if tTab === 'friends'}");
  assert.ok(lobbyIdx > 0 && tournIdx > 0, '抓不到大廳／錦標賽的好友分頁錨點');
  const lobbyMount = mounts.find((m) => GAME.indexOf(m) > lobbyIdx);
  const tournMount = mounts.find((m) => GAME.indexOf(m) > tournIdx && GAME.indexOf(m) < lobbyIdx);
  assert.ok(lobbyMount && tournMount, '兩個掛載點的相對位置抓錯了');
  assert.ok(/rooms=\{openRooms\}/.test(lobbyMount), '大廳掛載點沒有傳 rooms={openRooms}');
  assert.ok(/onjoinroom=\{/.test(lobbyMount) && /handleJoinFromList/.test(lobbyMount),
    '大廳掛載點沒有把 onjoinroom 接到既有的 handleJoinFromList');
  assert.ok(/joinBlockedMsg=\{/.test(lobbyMount), '大廳掛載點沒有傳 joinBlockedMsg');
  assert.ok(!/rooms=/.test(tournMount) && !/onjoinroom=/.test(tournMount),
    '⚠⚠⚠ 錦標賽分頁的掛載點傳了 rooms／onjoinroom —— 錦標賽頁沒有 openRooms，而且絕不可為此新增輪詢（v6.118 事故）');
  assert.ok(!/rooms=|onjoinroom=/.test(FRIENDS_PAGE),
    '⚠⚠⚠ `/friends` 獨立頁的掛載點傳了 rooms／onjoinroom —— 那條路沒有 openRooms');
  assert.ok(/<FriendsPanel /.test(FRIENDS_PAGE), '正對照：/friends 頁確實有掛 FriendsPanel（錨點沒抓錯）');
});
await T('F4 ⭐⭐⭐ 沒有新增任何房間訂閱：`subscribeOpenRooms` 全站仍然只有 1 個呼叫點，而且好友功能沒有自己的 timer', () => {
  const sites = [...GAME.matchAll(/=\s*subscribeOpenRooms\s*\(/g)];
  assert.strictEqual(sites.length, 1, 'subscribeOpenRooms 呼叫點變成 ' + sites.length + ' 個 ⇒ 必須重新審 v6.118 的閘');
  for (const [f, src] of [['friend-rooms.ts', stripAllCmt(FR)], ['FriendsPanel.svelte', stripAllCmt(FRP)]]) {
    for (const bad of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'fetch(']) {
      assert.ok(!src.includes(bad), f + ' 出現 ' + bad + ' ⇒ 本版必須零 timer／零請求');
    }
  }
  assert.ok(!/^import /m.test(FR), 'friend-rooms.ts 不該 import 任何東西（守衛才能單獨載入實跑）');
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【G】大廳輪詢在好友分頁照跑');
await T('G1 ⭐⭐⭐ 房間訂閱的閘**沒有** lobbyTab：切到好友分頁時 onlineStep 仍是 join ⇒ 條件求值為 true（正對照：進房後為 false）', () => {
  const m = /if \((![a-zA-Z]+ && mode === 'online' && onlineStep === 'join' && myUid)\) \{/.exec(GAME);
  assert.ok(m, '抽不到大廳房間訂閱的閘（寫法變了？）');
  const cond = m[1];
  assert.ok(!/lobbyTab/.test(cond), '⚠⚠⚠ 閘裡出現 lobbyTab ⇒ 切到好友分頁時房間會停止更新：' + cond);
  const evalCond = (S) => new Function('S', 'with (S) { return (' + cond + '); }')(S);
  const on = { isTournament: false, mode: 'online', onlineStep: 'join', myUid: 'u', lobbyTab: 'online' };
  assert.strictEqual(!!evalCond(on), true, '大廳分頁時竟然不訂閱');
  assert.strictEqual(!!evalCond({ ...on, lobbyTab: 'friends' }), true,
    '⚠⚠⚠ 切到好友分頁時房間訂閱停掉了（好友列的按鈕會整組失效）');
  // 正對照三則：這個條件不是恆真式
  assert.strictEqual(!!evalCond({ ...on, onlineStep: 'room' }), false, '正對照失效：進房後應該不訂閱');
  assert.strictEqual(!!evalCond({ ...on, isTournament: true }), false, '⚠⚠⚠ 錦標賽頁竟然會訂閱（v6.118 事故重演）');
  assert.strictEqual(!!evalCond({ ...on, myUid: '' }), false, '正對照失效：沒有 uid 時應該不訂閱');
});
await T('G2 ⭐ 切分頁的函式只改 lobbyTabRaw，不動 onlineStep／mode（實跑）', () => {
  const m = /function lobbySwitchTab\(tab: 'online' \| 'friends'\) \{([^}]*)\}/.exec(GAME);
  assert.ok(m, '抽不到 lobbySwitchTab');
  const after = new Function('S', 'tab', 'with (S) {' + m[1] + '} return S;')(
    { lobbyTabRaw: 'online', onlineStep: 'join', mode: 'online' }, 'friends');
  assert.deepStrictEqual([after.lobbyTabRaw, after.onlineStep, after.mode], ['friends', 'join', 'online']);
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【I】回歸不變量');
await T('I1 ⭐⭐ 共用元件仍然零 {@html}；四個 {#each} 都用 (r.fid) 當穩定 key', () => {
  assert.ok(!stripAllCmt(FRP).includes('{@html'), '⚠⚠ 共用元件出現 {@html}（房名／暱稱都是玩家自由輸入 ⇒ 紅線）');
  const eaches = stripCmt(FRP).match(/\{#each[^}]*\}/g) || [];
  assert.strictEqual(eaches.length, 4, 'each 不是四個：' + eaches.length);
  for (const e of eaches) assert.ok(/\(r\.fid\)\}$/.test(e), 'each 沒用 fid 當 key：' + e);
});
await T('I2 ⭐ 房名／房主名走 Svelte 預設 escape（模板裡是 {_rs.room.roomName} 這種表達式，不是字串拼 HTML）', () => {
  assert.ok(/\{_rs\.room\.roomName\}/.test(FRP) && /\{_rs\.room\.hostName\}/.test(FRP),
    '房名／房主名不是用表達式渲染的');
  assert.ok(!/innerHTML/.test(stripAllCmt(FRP)), 'FriendsPanel 出現 innerHTML');
});
await T('I3 ⭐ 沒有 pin 死任何版本號／sha256：本守衛與 friend-rooms.ts 都不含 40 碼 sha 或寫死的 v6.xxx 判斷', () => {
  const SELF = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const [n, s] of [['本守衛', SELF], ['friend-rooms.ts', FR]]) {
    assert.ok(!/[0-9a-f]{40}/.test(s), n + ' 含 40 碼 sha ⇒ 會變成 pin 死版本的安慰劑');
    assert.ok(!/VERSION\s*===\s*['"]6\./.test(s), n + ' 拿版本號當判斷');
  }
});

// ══════════════════════════════════════════════════════════════════════
console.log('\n【J】突變測試（沒紅 ＝ 守衛是安慰劑）');
function mutT(name, mutated, expectFrag, run) {
  return T('J ' + name, () => {
    // ⚠ 突變體本身建不起來（錨點不存在）也要算**紅**，不可以讓整支 crash、也不可以誤判成通過。
    let src;
    try { src = typeof mutated === 'function' ? mutated() : mutated; }
    catch (e) { throw new Error('突變體建不起來（錨點不存在，掃描器或實作變了）：' + String(e && e.message)); }
    let err = null;
    try { run(src); } catch (e) { err = e; }
    assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
    assert.ok(String(err.message).includes(expectFrag),
      '突變體紅在別的地方（預期含「' + expectFrag + '」）：' + String(err.message).slice(0, 220));
  });
}
// J1~J3：對 friend-rooms.ts 的純函式突變（重新 esbuild 之後實跑）
if (LIB && esbuild) {
  const dir = mkdtempSync(join(tmpdir(), 'v6301m-'));
  let n = 0;
  const buildMut = async (src) => {
    const f = join(dir, 'm' + (++n) + '.ts');
    writeFileSync(f, src);
    await esbuild.build({ entryPoints: [f], bundle: true, format: 'cjs', platform: 'node', outfile: f + '.cjs', logLevel: 'silent' });
    return require_(f + '.cjs');
  };
  const M1 = await buildMut(mutate(FR, "if (row?.inTournament === true) return { kind: 'tournament', room: null };",
    "if (row?.inTournament !== false) return { kind: 'tournament', room: null };"));
  await mutT('J1 把 `inTournament === true` 改成 `!== false`（舊伺服器的 undefined 會被當成錦標賽）⇒ B2 必紅', 'B2', 'undefined', () => {
    const idx = M1.buildFriendRoomIndex(ROOMS);
    const st = M1.friendRoomState({ uid: 'nobody', uids: [], inTournament: undefined }, idx);
    assert.strictEqual(st.kind, 'none', 'inTournament=undefined 竟然不是 none');
  });
  const M2 = await buildMut(mutate(FR, "return (state.kind === 'join' || state.kind === 'spectate') && !!state.room;",
    "return state.kind !== 'join' ? true : !!state.room;"));
  await mutT('J2 把「只有配對到房間才可點」改成「錦標賽／不在房間也可點」⇒ B1／B2 的可點性必紅', 'B1', '', () => {
    const idx = M2.buildFriendRoomIndex(ROOMS);
    const st = M2.friendRoomState({ uid: 'nobody', uids: [], inTournament: true }, idx);
    assert.strictEqual(M2.friendRoomClickable(st), false, '⚠⚠ 錦標賽狀態竟然放行加入');
  });
  const M3 = await buildMut(mutate(FR, 'const slots = Math.min(FRIEND_SEAT_SLOTS, seats.length);', 'const slots = seats.length;'));
  await mutT('J3 把「只看 2 個座位」改成「看所有座位」⇒ B3（觀戰位不算）必紅', 'B3', '觀戰位', () => {
    const idx = M3.buildFriendRoomIndex(ROOMS);
    assert.strictEqual(M3.friendRoomState({ uid: 'u7', uids: [] }, idx).kind, 'none', '觀戰位（座位 2）被算成在房內');
  });
  const M4 = await buildMut(mutate(FR, "if (!status) continue;", "if (!status && false) continue;"));
  await mutT('J4 讓 ended 的房也進索引 ⇒ B4 必紅', 'B4', 'ended', () => {
    const idx = M4.buildFriendRoomIndex(ROOMS);
    assert.strictEqual(M4.friendRoomState({ uid: 'u9', uids: [] }, idx).kind, 'none', 'ended 的房被算進來了');
  });
} else {
  skipped.push('J1~J4（缺 esbuild）');
}
// J5~J8：對 svelte／page 的靜態突變
await mutT('J5 大廳掛載點拿掉 rooms={openRooms} ⇒ A0／F3 必紅', () => mutate(GAME, 'rooms={openRooms}', ''), '沒有傳 rooms', (g) => {
  assert.ok(g.includes('rooms={openRooms}'), 'game/+page.svelte 的大廳掛載點沒有傳 rooms={openRooms}');
});
await mutT('J6 錦標賽分頁也傳 rooms ⇒ F3 必紅（那是 v6.118 效能事故的入口）', GAME, '錦標賽分頁的掛載點傳了', () => {
  const bad = GAME.replace('<FriendsPanel embedded ondm={openDm}', '<FriendsPanel embedded rooms={openRooms} ondm={openDm}');
  const mounts = [...bad.matchAll(/<FriendsPanel[\s\S]{0,600}?\/>/g)].map((m) => m[0]);
  const tournIdx = bad.indexOf("{:else if tTab === 'friends'}");
  const lobbyIdx = bad.indexOf("{#if lobbyTab === 'friends'}");
  const tournMount = mounts.find((m) => bad.indexOf(m) > tournIdx && bad.indexOf(m) < lobbyIdx);
  assert.ok(!/rooms=/.test(tournMount), '⚠⚠⚠ 錦標賽分頁的掛載點傳了 rooms／onjoinroom');
});
await mutT('J7 把房間訂閱的閘加上 lobbyTab ⇒ G1 必紅（切到好友分頁房間會停止更新）',
  () => mutate(GAME, "if (!isTournament && mode === 'online' && onlineStep === 'join' && myUid) {",
    "if (!isTournament && mode === 'online' && onlineStep === 'join' && lobbyTab === 'online' && myUid) {"),
  'lobbyTab', (g) => {
    const m = /if \((![a-zA-Z]+ && mode === 'online' && onlineStep === 'join'[^)]*)\) \{/.exec(g);
    assert.ok(m, '抽不到閘');
    assert.ok(!/lobbyTab/.test(m[1]), '⚠⚠⚠ 閘裡出現 lobbyTab ⇒ 切到好友分頁時房間會停止更新：' + m[1]);
  });
await mutT('J8 把房名那一行拿掉（只留 CSS 規則）⇒ A0 的「房名＋房主名」必紅',
  () => mutate(FRP, '<span class="fr-room">🎮 ', '<span class="fr-gone">🎮 '), '房名', (f) => {
    assert.ok(RE_FR_ROOM.test(f),
      '⚠⚠ 模板裡沒有「房名＋房主名」那一行 —— uid 來源未經驗證，一定要顯示出來讓玩家自己判斷');
    assert.ok(f.includes('fr-room'), '正對照：CSS 規則還在（證明「只比字串」擋不住這個突變）');
  });
await mutT('J9 把 showRoomBtn 改成「只要有 rooms 就渲染」⇒ 會做出按了沒反應的按鈕（F2 的等價靜態條件必紅）',
  () => mutate(FRP, 'const showRoomBtn = $derived(Array.isArray(rooms) && !!onjoinroom);',
    'const showRoomBtn = $derived(Array.isArray(rooms));'), 'onjoinroom', (f) => {
    assert.ok(/showRoomBtn = \$derived\([^)]*onjoinroom/.test(f),
      '⚠ showRoomBtn 的條件裡沒有 onjoinroom ⇒ 只給 rooms 也會渲染按鈕（按了沒反應）');
  });

// ══════════════════════════════════════════════════════════════════════
if (skipped.length) console.log('\n⚠⚠ 本次跳過：' + skipped.join('；'));
console.log(`\n=== v6.301 好友列加入房間／觀戰：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
