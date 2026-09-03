// v6.300 好友「正在錦標賽對戰中」—— 事件迴圈阻塞 benchmark
//   （Rule 32：效能數字必須附上可重跑的量測腳本；比照 scripts/perf-v6282-friends-eventloop.mjs）
//   用法：node scripts/perf-v6300-friends-intournament.mjs [發數=200] [好友數=100] [對戰中人數=40]
//   量什麼：把出貨碼 PTCG-FRIENDS 區塊抽出來、用共用 harness 的假 db 真的跑 GET /api/friends/list，
//   同時用 setImmediate ticker 量「事件迴圈拿回控制權的間隔」⇒ 阻塞 p50/p99/max。
//   四種情境（同一份好友資料，只換錦標賽側的狀態）：
//     A 沒有賽事在進行（絕大多數時間）—— 只多一發 tournamentEvents，②③ 零查詢
//     B 有賽事在進行、好友有人在打 —— 三發固定查詢（與好友人數無關）
//     C 索引不存在 ⇒ 整段跳過（只多一次 indexes()，且結果快取 60 秒）
//     D 對照組：v6.299 的行為（把 inTournament 那三行拿掉）⇒ 本版的**增量**＝B − D
//   ⚠ 沙盒 CPU 約為正式 VM 的 1/10（Rule 32），數字要換算後才能推論線上。
//   ⚠ 「每發」數字含假 db 的線性掃描＋structuredClone 成本，是**上界**，不是出貨碼自己的成本。
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPatch, extractBlock, FR_START, FR_END, buildFriends, asUser } from './lib/friends-harness-v6282.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readPatch(join(ROOT, 'oracle-admin/server_admin_patch.js'));
const FR = extractBlock(PATCH, FR_START, FR_END, 15000);
const N = Number(process.argv[2] || 200), NF = Number(process.argv[3] || 100), NP = Number(process.argv[4] || 40);
const ME = { uid: 'fA', email: 'alice@example.com', name: '愛麗絲' };
const FULL_IDX = {
  tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }],
  tournamentEvents: [{ status: 1 }],
  tournamentMatches: [{ eventId: 1, status: 1 }],
};
const NO_EV_IDX = {
  tournamentRegistrations: [{ email: 1, registeredAt: -1, name: 1 }, { eventId: 1 }],
  tournamentMatches: [{ eventId: 1, status: 1 }],
};
const mk = (a, b) => { const [x, y] = a < b ? [a, b] : [b, a]; const _id = x + '|' + y; return { _id, fid: _id.length.toString(16).padStart(24, '0'), a: x, b: y, status: 'accepted', requester: x, blockedBy: null, nickA: 'nA', nickB: 'nB', addedVia: 'battle', createdAt: 1, updatedAt: 1 }; };
function seed(evStatus) {
  const rows = [], regs = [], matches = [];
  for (let i = 0; i < NF; i++) {
    const e = 'friend' + String(i).padStart(3, '0') + '@example.com';
    rows.push(mk(ME.email, e));
    regs.push({ _id: 'EV1__u' + i, eventId: 'EV1', uid: 'u' + i, email: e, name: 'F' + i, registeredAt: 100 + i, deck: new Array(60).fill('卡牌名稱佔位') });
    if (i < NP) matches.push({ _id: 'M' + i, eventId: 'EV1', status: 'playing', p1uid: 'u' + i, p2uid: 'x' + i, round: 1, idx: i });
  }
  return {
    tournamentConfig: [{ _id: 'friendsConfig', enabled: true }],
    friendships: rows,
    tournamentEvents: [{ _id: 'EV1', status: evStatus, name: '週末賽' }],
    tournamentMatches: matches,
    tournamentRegistrations: regs,
  };
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

console.log('v6.300 inTournament benchmark：list × ' + N + '，好友 ' + NF + '、對戰中 ' + NP + '，node ' + process.version);
const runs = {};
async function scenario(label, blockSrc, dbOpts, seedObj, expectPlaying) {
  const H = buildFriends(blockSrc, { seed: seedObj, dbOpts });
  const m = await measureLoop(async () => { let r; for (let i = 0; i < N; i++) r = await H.call('get', '/api/friends/list', asUser(ME)); return r; });
  if (m.out.code !== 200 || m.out.body.friends.length !== NF) throw new Error('handler 回應不對：' + m.out.code);
  const got = m.out.body.friends.filter((f) => f.inTournament).length;
  if (expectPlaying !== null && got !== expectPlaying) throw new Error(label + '：對戰中人數 ' + got + ' ≠ 預期 ' + expectPlaying);
  const q = (n, re) => H.db._log.filter((l) => l.name === n && (re || /^(find|aggregate)$/).test(l.op)).length;
  console.log(label + ' — 事件迴圈阻塞 ' + fmt(m)
    + '｜查詢次數 events=' + q('tournamentEvents') + ' matches=' + q('tournamentMatches')
    + ' regs=' + q('tournamentRegistrations') + '（' + N + ' 發 list 全程合計）');
  runs[label[0]] = m;
  return m;
}
await scenario('A 沒有賽事在進行（絕大多數時間）', FR, { indexes: FULL_IDX, ioDelay: true }, seed('finished'), 0);
await scenario('B 有賽事在進行、' + NP + ' 位好友正在打', FR, { indexes: FULL_IDX, ioDelay: true }, seed('running'), NP);
await scenario('C 索引不存在 ⇒ 整段跳過', FR, { indexes: NO_EV_IDX, noAutoIndex: true, ioDelay: true }, seed('running'), 0);
// D 對照組：把 inTournament 這三行拿掉 ＝ v6.299 的行為
const V6299 = FR
  .replace('        const tplay = await _frTournPlayingEmails(me.yield);\n', '')
  .replace("if (d.status === 'accepted') { p.inTournament = !!(tplay && tplay.has(_oe)); friends.push(p); }",
    "if (d.status === 'accepted') { friends.push(p); }");
if (V6299 === FR) throw new Error('對照組沒有真的拿掉 inTournament —— 錨點漂移了');
await scenario('D 對照組（拿掉 inTournament ＝ v6.299）', V6299, { indexes: FULL_IDX, ioDelay: true }, seed('running'), null);
console.log('⇒ 本版增量（B − D）＝ 每發 ' + ((runs.B.ms - runs.D.ms) / N).toFixed(3) + 'ms、p99 ' + (runs.B.p99 - runs.D.p99).toFixed(3) + 'ms（沙盒；正式 VM 約 1/10）');
console.log('⇒ 常態情境增量（A − D）＝ 每發 ' + ((runs.A.ms - runs.D.ms) / N).toFixed(3) + 'ms');
// 正對照：量測器抓得到 30ms 同步空轉
{
  const m = await measureLoop(async () => { const t = Date.now(); while (Date.now() - t < 30) { /* spin */ } return 1; });
  console.log('正對照（同步空轉 30ms）：max ' + m.max.toFixed(1) + 'ms' + (m.max >= 25 ? ' ✓ 量測器有效' : ' ✗ 量測器壞了'));
}
