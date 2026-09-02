// v6.282 好友功能 P0 —— 事件迴圈阻塞 benchmark（Rule 32：效能數字必附可重跑的量測腳本）
//   用法：node scripts/perf-v6282-friends-eventloop.mjs [發數=200] [好友數=100] [待確認數=30]
//   量什麼：把出貨碼 PTCG-FRIENDS 區塊抽出來、用共用 harness 的假 db 跑 GET /api/friends/list，
//   同時用 setImmediate ticker 量「事件迴圈拿回控制權的間隔」⇒ 阻塞 p50/p99/max。
//   三組數字：
//     ① 假 db 每個操作經一次 setImmediate（模擬真實 mongo I/O 邊界）⇒ 阻塞分佈＝handler 在兩次 I/O 之間的同步工作
//     ② 假 db 零 I/O ⇒ 整發的同步 CPU 上界（含假 db 線性掃描＋structuredClone 的成本）
//     ③ 只跑假 db 的同一組查詢（沒有 handler）⇒ 把 ② 扣掉 ③ 就是出貨碼自己的 CPU
//   ⚠ 沙盒 CPU 約為正式 VM 的 1/10（Rule 32），數字要換算後才能推論線上。
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPatch, extractBlock, FR_START, FR_END, buildFriends, makeFakeDb, asUser, matchDoc } from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readPatch(join(ROOT, 'oracle-admin/server_admin_patch.js'));
const FR = extractBlock(PATCH, FR_START, FR_END, 15000);
const N = Number(process.argv[2] || 200), NF = Number(process.argv[3] || 100), NP = Number(process.argv[4] || 30);
const ME = { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' };
const mk = (a, b, requester, extra) => { const [x, y] = a < b ? [a, b] : [b, a]; const _id = x + '|' + y; return Object.assign({ _id, fid: createHash('sha1').update(_id).digest('hex').slice(0, 24), a: x, b: y, status: 'pending', requester, blockedBy: null, nickA: 'nA', nickB: 'nB', addedVia: 'battle', createdAt: 1, updatedAt: 1 }, extra || {}); };
const seed = () => ({
  tournamentConfig: [{ _id: 'friendsConfig', enabled: true }],
  friendships: Array.from({ length: NF }, (_, i) => mk(ME.email, 'friend' + String(i).padStart(3, '0') + '@example.com', ME.email, { status: 'accepted' }))
    .concat(Array.from({ length: NP }, (_, i) => mk(ME.email, 'p' + i + '@example.com', 'p' + i + '@example.com'))),
  playerIdentity: Array.from({ length: NF }, (_, i) => ({ _id: 'friend' + String(i).padStart(3, '0') + '@example.com', uid: 'o' + i, uids: [{ uid: 'o' + i, at: i }], nick: 'F' + i })),
});
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
const fmt = (m) => 'p50 ' + m.p50.toFixed(3) + ' / p99 ' + m.p99.toFixed(3) + ' / max ' + m.max.toFixed(3) + ' ms（ticker ' + m.ticks + ' 次、總 ' + m.ms.toFixed(1) + 'ms、每發 ' + (m.ms / N).toFixed(3) + 'ms）';

console.log('v6.282 friends benchmark：list × ' + N + '，好友 ' + NF + '、待確認 ' + NP + '，node ' + process.version);
// ① I/O 邊界版
{
  const H = buildFriends(FR, { seed: seed(), dbOpts: { ioDelay: true } });
  const m = await measureLoop(async () => { let r; for (let i = 0; i < N; i++) r = await H.call('get', '/api/friends/list', asUser(ME)); return r; });
  if (m.out.code !== 200 || m.out.body.friends.length !== NF) throw new Error('handler 回應不對：' + m.out.code);
  console.log('① 假 db 每操作一次 setImmediate（模擬 I/O 邊界）— 事件迴圈阻塞 ' + fmt(m));
}
// ② 零 I/O 版（同步 CPU 上界）
let cpuAll;
{
  const H = buildFriends(FR, { seed: seed() });
  const m = await measureLoop(async () => { let r; for (let i = 0; i < N; i++) r = await H.call('get', '/api/friends/list', asUser(ME)); return r; });
  cpuAll = m.ms;
  console.log('② 零 I/O — 整發同步 CPU 上界：總 ' + m.ms.toFixed(1) + 'ms、每發 ' + (m.ms / N).toFixed(3) + 'ms（含假 db 成本）');
}
// ③ 只跑假 db 同一組查詢（沒有 handler）
{
  const db = makeFakeDb(seed());
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    await db.collection('tournamentConfig').findOne({ _id: 'friendsConfig' });
    const docs = []; for await (const d of db.collection('friendships').find({ $or: [{ a: ME.email }, { b: ME.email }], status: { $in: ['accepted', 'pending', 'blocked'] } }).limit(250)) docs.push(d);
    const others = docs.map((d) => (d.a === ME.email ? d.b : d.a));
    for await (const d of db.collection('playerIdentity').find({ _id: { $in: others } }).limit(250)) { /* consume */ }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('③ 只跑假 db 同一組查詢（無 handler）：總 ' + ms.toFixed(1) + 'ms、每發 ' + (ms / N).toFixed(3) + 'ms');
  console.log('⇒ 出貨碼自己的 CPU ≈ ② − ③ ＝ 每發 ' + ((cpuAll - ms) / N).toFixed(3) + 'ms（沙盒；正式 VM 約 1/10）');
}
// 正對照：量測器抓得到 30ms 同步空轉
{
  const m = await measureLoop(async () => { const t = Date.now(); while (Date.now() - t < 30) { /* spin */ } return 1; });
  console.log('正對照（同步空轉 30ms）：max ' + m.max.toFixed(1) + 'ms' + (m.max >= 25 ? ' ✓ 量測器有效' : ' ✗ 量測器壞了'));
}
