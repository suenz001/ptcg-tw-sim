// server v1.83＋前端 v6.643 守衛：錦標賽擴容第四批（2026-11-15）
//
// 【N】/event「最近一次報名暱稱」每人 60 秒快取（擴容審查 P2-4）
//   N1 同一人 60 秒內只查一次資料庫；回傳形狀與原本 find(...).toArray() 相同（陣列）；過期後重查
//   N2 失效：清單人只清那個人；傳 null 整個清空；超過 5000 人整個清空（不會無限長大）
//   N3 查詢條件與原本逐字相同（排除空暱稱、只投影 name/registeredAt、依 registeredAt 新到舊、取 1 筆）
//   N4 /event 改用快取；所有會改變「最近暱稱」的寫入點（三支報名端點、遲到報名、報名回滾、取消報名、刪除賽事）都有失效
// 【F】棄賽／未進場判負的「寫房間 game-over」改成版本 CAS＋重試（擴容審查 P2-2 剩下兩處）
//   F1 第一次命中 ⇒ 寫一次、版本＋1；F2 被玩家動作搶先（沒命中）⇒ 重讀後再寫，用的是新盤面；F3 連續 3 次衝突 ⇒ 放棄、回 false
//   F4 build 回 null（例如已是 game-over）⇒ 不寫；舊房間沒有 version 欄位 ⇒ 不加版本條件
//   F5 _forceGameOver 與未進場判負都走這支，不再有無條件整包寫回
// 【C】個人時計 activeRooms 走索引：先取進行中賽事，沒有就不查對戰；有才用 eventId＋status 查
// 【W】前端新鮮度看門狗只重建輪詢（那一發 tForceResync 的結果一直被 ++tPollGen 丟棄）
// 【H】HEAD-FAIL：BASE（a01413b7）上逐條紅
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'a01413b7';
const SAP = 'oracle-admin/server_admin_patch.js', PAGE = 'src/routes/game/+page.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };
const blockOf = (src, tag) => { const i = src.indexOf('// >>> ' + tag), j = src.indexOf('// <<< ' + tag); return i >= 0 && j > i ? src.slice(i, j) : ''; };

async function checkN(src, tag) {
  const blk = blockOf(src, 'v183-event-lastnick-cache');
  let api = null; const q = [];
  let clock = 1000;
  const TREGS = { find: (f, o) => { q.push({ f, o }); return { sort: (s) => ({ limit: (n) => ({ toArray: async () => { q[q.length - 1].s = s; q[q.length - 1].n = n; return [{ _id: 'x', name: 'N' + f.uid, registeredAt: 5 }]; } }) }) }; } };
  try { if (blk) api = new Function('TREGS', 'Date', blk + '\nreturn { evLastNickV183, evLastNickInvalidateV183, _evLastNickCacheV183 };')(TREGS, { now: () => clock }); } catch (e) { api = null; }
  const get = api ? api.evLastNickV183 : async () => 'MISSING';
  const r1 = await get('u1'), r2 = await get('u1');
  clock += 59999; const r3 = await get('u1');
  const n1 = q.length;
  clock += 2; const r4 = await get('u1');
  ok(`★★★ N1${tag} 60 秒內只查一次、回傳陣列形狀不變；過期後重查`, Array.isArray(r1) && r1[0] && r1[0].name === 'Nu1' && r2 === r1 && r3 === r1 && n1 === 1 && q.length === 2 && Array.isArray(r4), JSON.stringify({ n1, n: q.length }));
  let n2ok = false;
  if (api) {
    await get('u2'); const before = q.length;
    api.evLastNickInvalidateV183('u2'); await get('u2'); await get('u1');
    const afterOne = q.length;   // u2 重查、u1 仍命中
    api.evLastNickInvalidateV183(null); await get('u1');
    const afterAll = q.length;
    for (let i = 0; i < 5001; i++) api._evLastNickCacheV183.set('k' + i, { rows: [], at: clock });
    await get('fresh');
    n2ok = afterOne === before + 1 && afterAll === afterOne + 1 && api._evLastNickCacheV183.size <= 2;
  }
  ok(`★★ N2${tag} 失效：只清指定的人；null 整個清空；超過 5000 人整個清空`, n2ok);
  let n5 = false;
  if (blk) {
    let release; const gate = new Promise((r) => { release = r; }); let nq = 0;
    const T2 = { find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => { nq++; await gate; return [{ name: 'OLD' }]; } }) }) }) };
    const api2 = new Function('TREGS', 'Date', blk + '\nreturn { evLastNickV183, evLastNickInvalidateV183, _evLastNickCacheV183 };')(T2, { now: () => 1 });
    const pr = api2.evLastNickV183('u9');
    api2.evLastNickInvalidateV183('u9');
    release();
    const got = await pr;
    n5 = got[0].name === 'OLD' && !api2._evLastNickCacheV183.has('u9') && nq === 1;
  }
  ok(`★★ N5${tag} 查詢在途時有人報名（失效）⇒ 這次結果照回，但不寫回快取`, n5);
  const q0 = q[0] || {};
  ok(`★★ N3${tag} 查詢條件與原本逐字相同（排除空暱稱、只投影 name/registeredAt、新到舊、取 1）`, JSON.stringify(q0.f) === JSON.stringify({ uid: 'u1', name: { $nin: [null, ''] } }) && JSON.stringify(q0.o) === JSON.stringify({ projection: { name: 1, registeredAt: 1 } }) && JSON.stringify(q0.s) === JSON.stringify({ registeredAt: -1 }) && q0.n === 1, JSON.stringify(q0));
  const useOk = /evLastNickV183\(id\.uid\),/.test(src) && !/TREGS\.find\(\{ uid: id\.uid, name: \{ \$nin: \[null, ''\] \} \}/.test(src);
  const lines = src.split('\n');
  const writeIdx = lines.map((l, i) => [l, i]).filter(([l]) => /await TREGS\.(insertOne|deleteOne|deleteMany)\(/.test(l));
  const missing = writeIdx.filter(([l, i]) => {
    const end = l.includes('insertOne({') && !l.includes('});') ? lines.findIndex((x, k) => k > i && /^\s*\}\);/.test(x)) : i;
    return !/^\s*if \(typeof evLastNickInvalidateV183 === 'function'\) evLastNickInvalidateV183\(/.test(lines[end + 1] || '');
  }).map(([l]) => l.trim().slice(0, 70));
  // N6（審查 P3-4）：TREGS 的 update 若改到 name 或 registeredAt，也必須緊接失效（目前一處都沒有；防將來新增漏接）
  const upd = lines.map((l, i) => [l, i]).filter(([l]) => /await TREGS\.update(One|Many)\(/.test(l) && /\$set: \{[^}]*\b(name|registeredAt):/.test(l));
  const updMiss = upd.filter(([, i]) => !/evLastNickInvalidateV183\(/.test(lines[i + 1] || ''));
  const scanned = lines.filter((l) => /await TREGS\.update(One|Many)\(/.test(l)).length;
  ok(`★ N6${tag} TREGS 的 update 改到 name／registeredAt 也要緊接失效（掃了 ${scanned} 處 update，改暱稱的 ${upd.length} 處）`, scanned >= 3 && updMiss.length === 0, JSON.stringify(updMiss.map(([l]) => l.trim().slice(0, 80))));
  ok(`★★★ N4${tag} /event 改用快取；所有 TREGS 報名寫入／刪除點後面緊接失效（共 ${writeIdx.length} 處）`, useOk && writeIdx.length >= 6 && missing.length === 0, JSON.stringify({ useOk, missing }));
}

async function checkF(src, tag) {
  const blk = blockOf(src, 'v183-force-gameover-cas');
  let fn = null;
  let rooms = [], writes = [], miss = 0;
  const TROOMS = {
    findOne: async () => { const r = rooms.shift(); return r ? JSON.parse(JSON.stringify(r)) : null; },
    updateOne: async (f, u) => { writes.push({ f, u }); if (miss > 0) { miss--; return { matchedCount: 0 }; } return { matchedCount: 1 }; },
  };
  const warns = [];
  try { if (blk) fn = new Function('TROOMS', 'console', blk + '\nreturn forceRoomGameOverV183;')(TROOMS, { warn: (m) => warns.push(m) }); } catch { fn = null; }
  const F = fn || (async () => 'MISSING');
  const build = (room) => ({ ...room.gameState, phase: 'game-over' });
  rooms = [{ version: 5, gameState: { phase: 'playing', turn: 3 } }]; writes = []; miss = 0;
  const a = await F('R', build, 77);
  ok(`★★★ F1${tag} 第一次命中 ⇒ 只寫一次，條件帶 version 5、寫入 6`, a === true && writes.length === 1 && writes[0].f.version === 5 && writes[0].u.$set.version === 6 && writes[0].u.$set.gameState.phase === 'game-over' && writes[0].u.$set.updatedAt === 77, JSON.stringify(writes));
  rooms = [{ version: 5, gameState: { phase: 'playing', turn: 3 } }, { version: 6, gameState: { phase: 'playing', turn: 4 } }]; writes = []; miss = 1;
  const b = await F('R', build, 1);
  ok(`★★★ F2${tag} 被玩家動作搶先（沒命中）⇒ 重讀新盤面再寫（版本 6→7、turn 4）`, b === true && writes.length === 2 && writes[1].f.version === 6 && writes[1].u.$set.version === 7 && writes[1].u.$set.gameState.turn === 4, JSON.stringify(writes));
  rooms = [1, 2, 3, 4].map((v) => ({ version: v, gameState: { phase: 'playing' } })); writes = []; miss = 3;
  const c = await F('R', build, 1);
  const last = writes[writes.length - 1] || {};
  ok(`★★ F3${tag} 連續 3 次衝突 ⇒ 最後補一發不帶版本條件、用 $inc 推版本（結果一定寫成、不產生重複版本號），印一行警告`, c === true && writes.length === 4 && !('version' in (last.f || {})) && last.u && last.u.$inc && last.u.$inc.version === 1 && !('version' in last.u.$set) && last.u.$set.gameState.phase === 'game-over' && warns.length === 1, JSON.stringify({ c, w: writes.length, last }));
  rooms = [{ version: 5, gameState: { phase: 'game-over' } }]; writes = []; miss = 0;
  const d = await F('R', () => null, 1);
  rooms = [{ gameState: { phase: 'playing' } }]; writes = []; miss = 0;
  const e = await F('R', build, 1);
  ok(`★★ F4${tag} build 回 null ⇒ 不寫；舊房間沒有 version ⇒ 不加版本條件、寫 2`, d === false && e === true && writes.length === 1 && !('version' in writes[0].f) && writes[0].u.$set.version === 2, JSON.stringify(writes));
  const fgo = (() => { const i = src.indexOf('    async function _forceGameOver(m, winSeat, reason) {'); const j = src.indexOf('\n    }\n', i); return i >= 0 && j > i ? src.slice(i, j) : ''; })();
  const lineOf = (needle) => src.split('\n').find((l) => l.includes(needle)) || '';
  const sites = { noShow: lineOf('未進場，判定你獲勝'), forfeit: lineOf("og.winReason = (lName || '對手') + ' 投降"), admin: lineOf("og.winReason = '管理員裁定：' + wName") };
  const bad = Object.entries(sites).filter(([, l]) => !/forceRoomGameOverV183\(m\.roomId,/.test(l) || /TROOMS\.updateOne/.test(l)).map(([k]) => k);
  ok(`★★★ F5${tag} 棄賽、未進場、投降、管理員裁定四處都走 forceRoomGameOverV183，不再有無條件整包寫回`, /forceRoomGameOverV183\(m\.roomId,/.test(fgo) && !/TROOMS\.updateOne/.test(fgo) && bad.length === 0, JSON.stringify({ fgo: fgo.length, bad }));
  const cl = blockOf(src, 'v183-gameover-claim');
  ok(`★★★ G1${tag} onMatchGameOver 一般勝負：對戰紀錄只在還沒結束時寫（status ≠ done），沒搶到就不推進`, /TMATCH\.updateOne\(\{ _id: m\._id, status: \{ \$ne: 'done' \} \}/.test(cl) && /if \(!_winClaim \|\| _winClaim\.matchedCount !== 1\) return;/.test(cl), cl.slice(0, 200));
}

async function checkC(src, tag) {
  const blk = blockOf(src, 'v183-clock-active-rooms');
  const calls = [];
  const mk = (evs, ms) => ({ collection: (n) => ({ find: (f, o) => { calls.push({ n, f, o }); return { toArray: async () => (n === 'tournamentEvents' ? evs : ms), limit: () => ({ toArray: async () => ms }) }; } }) });
  const run = async (db) => {
    if (!blk) return 'MISSING';
    return new Function('db', 'return (async () => {' + blk + '\nreturn matches.map((m) => m.roomId).filter(Boolean); })();')(db);
  };
  let r0, r1;
  try { r0 = await run(mk([], [{ roomId: 'X' }])); } catch (e) { r0 = 'ERR ' + e.message; }
  const c0 = calls.length;
  try { r1 = await run(mk([{ _id: 'E1' }, { _id: 'E2' }], [{ roomId: 'R1' }, { roomId: null }])); } catch (e) { r1 = 'ERR ' + e.message; }
  const mq = calls.find((x, i) => i >= c0 && x.n === 'tournamentMatches');
  ok(`★★★ C1${tag} 沒有進行中賽事 ⇒ 不查對戰、回空；有 ⇒ 用 eventId＋status 走索引（不再全集合掃描 status）`,
    Array.isArray(r0) && r0.length === 0 && c0 === 1 && calls[0].n === 'tournamentEvents' && Array.isArray(r1) && r1.join() === 'R1' && mq && JSON.stringify(mq.f) === JSON.stringify({ eventId: { $in: ['E1', 'E2'] }, status: 'playing' }), JSON.stringify({ r0, r1, calls }));
}

function sliceAt(src, a, b) { const i = src.indexOf(a); const j = src.indexOf(b, i); return i >= 0 && j > i ? src.slice(i, j) : ''; }
function checkW(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const seg = sliceAt(page, "_tSendClientDiag('stale-version')", '隱形手牌') || sliceAt(page, "_tSendClientDiag('stale-version')", "_invisibleHandDiagSent && [");
  const _sp = seg.indexOf('startTournamentPoll();');
  const tail = _sp >= 0 ? seg.slice(0, _sp + 30) : '';   // 診斷送出點 → 自癒（含之間全部）
  ok(`★★★ W1${tag} 看門狗收尾只重建輪詢，不再先送一發會被丟棄的 tForceResync`, seg.length > 100 && /startTournamentPoll\(\);/.test(seg) && !/tForceResync\(\)/.test(tail), tail);
  ok(`★ W2${tag} 其他呼叫點（回前景、立即重新同步鈕）照舊保留 tForceResync`, (page.match(/tForceResync\(\)/g) || []).length >= 8);
}

const CUR = readFileSync(join(ROOT, SAP), 'utf8').replace(/\r\n/g, '\n');
console.log('【N】/event 暱稱快取'); await checkN(CUR, '');
console.log('【F】終局寫房間 CAS'); await checkF(CUR, '');
console.log('【C】個人時計 activeRooms'); await checkC(CUR, '');
console.log('【W】前端看門狗'); checkW(readFileSync(join(ROOT, PAGE), 'utf8'), '');
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const b = readBaseBlob(ROOT, BASE_SHA, SAP), bp = readBaseBlob(ROOT, BASE_SHA, PAGE);
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  const B = b.ok ? b.out.replace(/\r\n/g, '\n') : '';
  await checkN(B, '@BASE'); await checkF(B, '@BASE'); await checkC(B, '@BASE'); checkW(bp.ok ? bp.out : '', '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
  const bpass = pass - before; pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 N1～N5、F1～F5、G1、C1、W1 逐條紅', ['N1', 'N2', 'N3', 'N4', 'N5', 'F1', 'F2', 'F3', 'F4', 'F5', 'G1', 'C1', 'W1'].every((k) => reds.some((r) => r.includes(k + '@BASE'))), reds.join(','));
  ok('★★ H2 BASE 上 W2 綠（正對照：tForceResync 其他呼叫點本來就在）', !reds.some((r) => r.includes('W2@BASE')) && bpass >= 1, reds.join(','));
}
console.log(`=== server v1.83／v6.643 擴容第四批：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
