// v6.302 好友清單 `roomId`（伺服器用 email 比對）—— 事件迴圈阻塞 benchmark
//   （Rule 32：效能數字必須附上可重跑的量測腳本；比照 scripts/perf-v6300-friends-intournament.mjs）
//   用法：node scripts/perf-v6302-friend-room-by-email.mjs [發數=200] [好友數=100]
//   量什麼：把出貨碼 PTCG-FRIENDS 區塊抽出來、用共用 harness 的假 db 真的跑 GET /api/friends/list，
//   同時用 setImmediate ticker 量「事件迴圈拿回控制權的間隔」⇒ 阻塞 p50/p99/max。
//   五種情境（同一批好友，只換房間側的狀態）：
//     A 一間開著的房都沒有 —— 只多一發 rooms 查詢，迴圈零圈
//     B 30 間房（站長給的尖峰量級）
//     C 100 間房（上限滿載；100 房 × 2 座位 ＝ 200 ⇒ 剛好讓路一次）
//     D 索引不存在 ⇒ 整段跳過（只多一次 indexes()，結果快取 60 秒）
//     E 對照組：v6.301 的行為（把 roomId 那兩處拿掉）⇒ 本版的**增量**＝C − E
//   ⚠ 5 秒共用快照會讓第 2 發之後都零查詢 ⇒ 這裡刻意**每一發都用新的 harness**（最壞情況），
//     線上實際成本遠低於此。
//   ⚠ 沙盒 CPU 約為正式 VM 的 1/10（Rule 32），數字要換算後才能推論線上。
//   ⚠ 「每發」數字含假 db 的線性掃描＋structuredClone 成本，是**上界**，不是出貨碼自己的成本。
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPatch, extractBlock, FR_START, FR_END, buildFriends, asUser } from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readPatch(join(ROOT, 'oracle-admin/server_admin_patch.js'));
const FR = extractBlock(PATCH, FR_START, FR_END, 15000);
const N = Number(process.argv[2] || 200), NF = Number(process.argv[3] || 100);
const ME = { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' };
const FULL_IDX = {
  rooms: [{ status: 1, updatedAt: -1 }],
  tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }],
  tournamentEvents: [{ status: 1 }],
  tournamentMatches: [{ eventId: 1, status: 1 }],
};
const NO_ROOM_IDX = Object.assign({}, FULL_IDX, { rooms: [{ somethingElse: 1 }] });
const mk = (a, b) => { const [x, y] = a < b ? [a, b] : [b, a]; const _id = x + '|' + y; return { _id, fid: _id.length.toString(16).padStart(24, '0'), a: x, b: y, status: 'accepted', requester: x, blockedBy: null, nickA: 'nA', nickB: 'nB', addedVia: 'battle', createdAt: 1, updatedAt: 1 }; };
function seed(nRooms) {
  const friendships = [], rooms = [];
  for (let i = 0; i < NF; i++) friendships.push(mk(ME.email, 'friend' + String(i).padStart(3, '0') + '@example.com'));
  for (let i = 0; i < nRooms; i++) {
    rooms.push({
      _id: 'R' + i, status: i % 2 ? 'playing' : 'lobby', updatedAt: 100000 - i,
      roomName: '房間' + i, hostName: '房主' + i,
      // ⚠ 前半數的房間坐的是好友（模擬「好友真的在房裡」），後半是路人
      seats: [{ uid: 'u' + i, email: (i < nRooms / 2 ? 'friend' + String(i).padStart(3, '0') : 'x' + i) + '@example.com' },
              { uid: 'v' + i, email: 'y' + i + '@example.com' }],
      // ⚠ 刻意塞一包大 gameState：projection 若寫錯就會在數字上看得出來
      gameState: { log: new Array(200).fill('對戰紀錄文字佔位' + i) },
    });
  }
  return { tournamentConfig: [{ _id: 'friendsConfig', enabled: true }], friendships, rooms };
}
async function measureLoop(fn) {
  let ticks = 0, last = process.hrtime.bigint(); const gaps = []; let running = true;
  const tick = () => { if (!running) return; const now = process.hrtime.bigint(); gaps.push(Number(now - last) / 1e6); last = now; ticks++; setImmediate(tick); };
  setImmediate(tick);
  await new Promise((r) => setImmediate(r));
  ticks = 0; gaps.length = 0; last = process.hrtime.bigint();
  const t0 = process.hrtime.bigint();
  const out = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  running = false;
  gaps.sort((a, b) => a - b);
  const q = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0);
  return { out, ticks, ms, max: gaps.length ? gaps[gaps.length - 1] : ms, p99: q(0.99), p50: q(0.5) };
}
const fmt = (m) => 'p50 ' + m.p50.toFixed(3) + ' / p99 ' + m.p99.toFixed(3) + ' / max ' + m.max.toFixed(3) + ' ms（每發 ' + (m.ms / N).toFixed(3) + 'ms、總 ' + m.ms.toFixed(1) + 'ms）';

console.log('v6.302 roomId benchmark：list × ' + N + '（每發都用全新 harness ⇒ 快照永遠不命中，最壞情況），好友 ' + NF + '，node ' + process.version);
const runs = {};
async function scenario(key, label, blockSrc, indexes, nRooms, expectHit) {
  const s = seed(nRooms);
  let finds = 0, last = null;
  const m = await measureLoop(async () => {
    let r = null;
    for (let i = 0; i < N; i++) {
      // ⚠ 每一發都重建 ⇒ 5 秒快照不會命中（線上實際是「5 秒內只有第一發要付這個成本」）
      const H = buildFriends(blockSrc, { seed: s, dbOpts: { indexes, noAutoIndex: true, ioDelay: true } });
      r = await H.call('get', '/api/friends/list', asUser(ME));
      finds += H.db._log.filter((l) => l.name === 'rooms' && l.op === 'find').length;
      last = H;
    }
    return r;
  });
  if (m.out.code !== 200 || m.out.body.friends.length !== NF) throw new Error(label + '：handler 回應不對（' + m.out.code + '）');
  const hit = m.out.body.friends.filter((f) => f.roomId).length;
  if (expectHit !== null && hit !== expectHit) throw new Error(label + '：配對到房間的人數 ' + hit + ' ≠ 預期 ' + expectHit);
  console.log(label + '\n    事件迴圈阻塞 ' + fmt(m) + '\n    rooms 查詢 ' + finds + ' 發（' + N + ' 發 list 合計，每發 ' + (finds / N).toFixed(2) + '）｜配對到房間 ' + hit + ' 人');
  runs[key] = m;
  void last;
  return m;
}
await scenario('A', 'A 一間開著的房都沒有', FR, FULL_IDX, 0, 0);
await scenario('B', 'B 30 間房（尖峰量級）', FR, FULL_IDX, 30, 15);
await scenario('C', 'C 100 間房（上限滿載）', FR, FULL_IDX, 100, 50);
await scenario('D', 'D 索引不存在 ⇒ 整段跳過', FR, NO_ROOM_IDX, 100, 0);
// E 對照組：把 roomId 那兩處拿掉 ＝ v6.301 的行為
const V6301 = FR
  .replace('        const rmap = await _frRoomsByEmail(me.yield);\n', '')
  .replace('            if (rmap) p.roomId = rmap.get(_oe) || null;\n', '');
if (V6301 === FR || V6301.includes('_frRoomsByEmail(me.yield)')) throw new Error('對照組沒有真的拿掉 roomId —— 錨點漂移了');
// ⚠⚠ 對照組**必須用同樣多的房間**：假 db 每次 buildFriends 都會 structuredClone 整包 seed，
//   房間數不同的兩組相減得到的是「seed 大小的差」，不是本版的成本（拿 30 房去減 100 房會得到負數）。
await scenario('E', 'E 對照組（拿掉 roomId ＝ v6.301 的行為）— 100 間房', V6301, FULL_IDX, 100, null);
await scenario('E30', 'E30 對照組（同上）— 30 間房', V6301, FULL_IDX, 30, null);
console.log('\n⇒ 滿載增量（C − E，同為 100 房）＝ 每發 ' + ((runs.C.ms - runs.E.ms) / N).toFixed(3) + 'ms（沙盒；正式 VM 約 1/10 ⇒ 約 ' + ((runs.C.ms - runs.E.ms) / N / 10).toFixed(3) + 'ms）');
console.log('⇒ 尖峰增量（B − E30，同為 30 房）＝ 每發 ' + ((runs.B.ms - runs.E30.ms) / N).toFixed(3) + 'ms');
console.log('⇒ 常態上界：線上有 5 秒共用快照 ⇒ 每 5 秒最多付一次上面的成本，其餘 list 皆為 0');
// 正對照：量測器抓得到 30ms 同步空轉（否則「阻塞很小」可能只是量測器壞了）
{
  const m = await measureLoop(async () => { const t = Date.now(); while (Date.now() - t < 30) { /* spin */ } return 1; });
  console.log('正對照（同步空轉 30ms）：max ' + m.max.toFixed(1) + 'ms' + (m.max >= 25 ? ' ✓ 量測器有效' : ' ✗ 量測器壞了'));
}
