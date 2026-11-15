// server v1.84 守衛：擴容審查剩下的小事（2026-11-15）
//
// 【P】/match/forfeit（投降）改條件式寫入（比照 /drop）
//   P1 正常：這一場仍在對戰中 ⇒ 寫成投降（條件含 status:'playing'）、寫房間 game-over、公告、推進輪次各一次
//   P2 搶輸：findOne 之後這一場已經被別的路徑收掉（updateOne 沒命中）⇒ 不寫房間、不公告、不推進，回 ok＋note
//   P3 沒有對戰中的場 ⇒ 照舊回「無進行中對戰」，不寫任何東西
//   P4（審查 P3-5）房間盤面已是 game-over（TMATCH 等對帳補寫）⇒ 不寫投降（只投影 gameState.phase）
// 【A】/admin/match/resolve（管理員裁定）改條件式寫入
//   A1 正常：條件含 status $ne 'done'，寫房間／公告／推進各一次
//   A2 搶輸 ⇒ 409「該場次已結束」，不寫房間、不公告、不推進
//   A3 非管理員 ⇒ 403，一筆都不查
// 【N】聊天／牌組公布欄的 getLastRegisteredNick 收斂到 /event 的 evLastNickV183（同一個查詢、同一個快取）
//   N1 最近一次報名沒填暱稱 ⇒ 回更早那次有填的（原本回 null）
//   N2 與 /event 共用快取：/event 查過就不再查；報名時失效 ⇒ 下一次立刻是新暱稱（原本最多 5 分鐘才換）
//   N3 從沒報名過／查詢丟例外 ⇒ null；uid 缺席 ⇒ null 且不查
//   N4 判準只有一份：舊的 5 分鐘快取 _chatNickCache 不存在；getLastRegisteredNick 本體不再自己查 TREGS
// 【H】HEAD-FAIL：BASE（b1d3c07c＝v6.644）上 P2／P4／A2／N1／N2／N4 紅，P1／P3／A1／A3／N3 綠（正對照）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'b1d3c07c';   // v6.644（server 仍是 v1.83）
const SAP = 'oracle-admin/server_admin_patch.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };
const blockOf = (src, tag) => { const i = src.indexOf('// >>> ' + tag), j = src.indexOf('// <<< ' + tag); return i >= 0 && j > i ? src.slice(i, j) : ''; };

// 大括號配對抽出 app.post('<path>', async (req, res) => { … }); 整段
function appHandler(src, path) {
  const head = `app.post('${path}', async (req, res) => {`;
  const i = src.indexOf(head);
  if (i < 0) return '';
  let d = 0;
  for (let k = src.indexOf('{', i + head.length - 1); k < src.length; k++) {
    if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1) + ');'; }
  }
  return '';
}
function fnBody(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return '';
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return '';
}

// 假環境：TMATCH.updateOne 依 filter 對「資料庫現況」判斷有沒有命中
function makeEnv({ dbMatch, findMatch, admin = true, roomPhase = 'main' }) {
  const log = { upd: [], room: 0, chat: [], adv: 0, find: 0, roomRead: [] };
  const TROOMS = { findOne: async (f, o) => { log.roomRead.push({ f, o }); return { _id: f._id, gameState: { phase: roomPhase } }; } };
  const TMATCH = {
    findOne: async () => { log.find++; return findMatch ? JSON.parse(JSON.stringify(findMatch)) : null; },
    updateOne: async (f, u) => {
      log.upd.push({ f, u });
      const st = dbMatch.status;
      let hit = f._id === dbMatch._id;
      if (hit && typeof f.status === 'string') hit = st === f.status;
      if (hit && f.status && typeof f.status === 'object' && '$ne' in f.status) hit = st !== f.status.$ne;
      if (hit) Object.assign(dbMatch, u.$set);
      return { matchedCount: hit ? 1 : 0, modifiedCount: hit ? 1 : 0 };
    },
  };
  const TEVENTS = { find: () => ({ toArray: async () => [{ _id: 'E1', status: 'running' }] }) };
  const deps = {
    tournIdentity: async () => ({ uid: 'u1', verified: true, email: 'a@x' }),
    tournRequireVerified: () => false,
    isTournAdmin: () => admin,
    TEVENTS, TMATCH, TROOMS,
    forceRoomGameOverV183: async () => { log.room++; return true; },
    postSystemChat: async (t) => { log.chat.push(t); },
    advanceOrFinish: async () => { log.adv++; },
  };
  return { log, deps };
}
async function runHandler(src, path, env, body) {
  const h = appHandler(src, path);
  if (!h) return { err: '抽不到端點' };
  let fn = null;
  const app = { post: (_p, f) => { fn = f; } };
  const names = Object.keys(env.deps);
  try { new Function('app', ...names, h)(app, ...names.map((k) => env.deps[k])); } catch (e) { return { err: e.message }; }
  let status = 200, out = null;
  const res = { status: (c) => { status = c; return res; }, json: (o) => { out = o; return res; } };
  try { await fn({ body: body || {}, query: {} }, res); } catch (e) { return { err: e.message }; }
  return { status, out };
}

const M = () => ({ _id: 'M1', eventId: 'E1', status: 'playing', p1uid: 'u1', p2uid: 'u2', p1name: '甲', p2name: '乙', roomId: 'R1', round: 1 });

async function checkP(src, tag) {
  // P1 正常
  {
    const db = M(); const env = makeEnv({ dbMatch: db, findMatch: M() });
    const r = await runHandler(src, '/api/tournament/match/forfeit', env, { room: 'R1' });
    const u = env.log.upd[0];
    ok(`★★ P1${tag} 正常投降 ⇒ 寫成對手勝、寫房間／公告／推進各一次`,
      !r.err && r.out?.ok === true && env.log.upd.length === 1 && db.status === 'done' && db.winnerUid === 'u2' && db.forfeit === true
        && env.log.room === 1 && env.log.chat.length === 1 && env.log.adv === 1, JSON.stringify({ r, log: env.log }));
    ok(`★★★ P1b${tag} 寫入條件含 status:'playing'（條件式搶占）`, u && u.f._id === 'M1' && u.f.status === 'playing', JSON.stringify(u?.f));
  }
  // P2 搶輸：findOne 看到 playing，但資料庫裡已經被正常打完（乙勝 → 甲勝已判）
  {
    const db = { ...M(), status: 'done', winnerUid: 'u1', winnerName: '甲' }; const env = makeEnv({ dbMatch: db, findMatch: M() });
    const r = await runHandler(src, '/api/tournament/match/forfeit', env, { room: 'R1' });
    ok(`★★★ P2${tag} findOne 之後這一場已結束 ⇒ 不覆寫結果、不寫房間、不公告、不推進，回 ok`,
      !r.err && r.out?.ok === true && db.winnerUid === 'u1' && db.forfeit !== true && env.log.room === 0 && env.log.chat.length === 0 && env.log.adv === 0,
      JSON.stringify({ r, db, log: env.log }));
  }
  // P4（審查 P3-5）房間已是 game-over、TMATCH 還沒寫（等對帳）⇒ 不寫投降
  {
    const db = M(); const env = makeEnv({ dbMatch: db, findMatch: M(), roomPhase: 'game-over' });
    const r = await runHandler(src, '/api/tournament/match/forfeit', env, { room: 'R1' });
    const rr = env.log.roomRead[0];
    ok(`★★★ P4${tag} 房間盤面已是 game-over ⇒ 不寫投降、不公告、不推進（只投影 gameState.phase）`,
      !r.err && r.out?.ok === true && env.log.upd.length === 0 && db.status === 'playing' && env.log.room === 0 && env.log.chat.length === 0 && env.log.adv === 0
        && rr && JSON.stringify(rr.o) === JSON.stringify({ projection: { 'gameState.phase': 1 } }), JSON.stringify({ r, log: env.log }));
  }
  // P3 沒有對戰中的場
  {
    const db = M(); const env = makeEnv({ dbMatch: db, findMatch: null });
    const r = await runHandler(src, '/api/tournament/match/forfeit', env, {});
    ok(`★ P3${tag} 沒有對戰中的場 ⇒ 照舊回「無進行中對戰」，一筆都不寫`, !r.err && r.out?.note === '無進行中對戰' && env.log.upd.length === 0 && env.log.room === 0, JSON.stringify(r));
  }
}

async function checkA(src, tag) {
  {
    const db = M(); const env = makeEnv({ dbMatch: db, findMatch: M() });
    const r = await runHandler(src, '/api/tournament/admin/match/resolve', env, { matchId: 'M1', winnerSeat: 1 });
    const u = env.log.upd[0];
    ok(`★★ A1${tag} 正常裁定 ⇒ 乙勝、adminResolved、寫房間／公告／推進各一次`,
      !r.err && r.out?.ok === true && db.status === 'done' && db.winnerUid === 'u2' && db.adminResolved === true && env.log.room === 1 && env.log.chat.length === 1 && env.log.adv === 1,
      JSON.stringify({ r, log: env.log }));
    ok(`★★★ A1b${tag} 寫入條件含 status $ne 'done'`, u && u.f._id === 'M1' && JSON.stringify(u.f.status) === JSON.stringify({ $ne: 'done' }), JSON.stringify(u?.f));
  }
  {
    const db = { ...M(), status: 'done', winnerUid: 'u1', winnerName: '甲', forfeit: true }; const env = makeEnv({ dbMatch: db, findMatch: M() });
    const r = await runHandler(src, '/api/tournament/admin/match/resolve', env, { matchId: 'M1', winnerSeat: 1 });
    ok(`★★★ A2${tag} 檢查之後這一場剛被收掉 ⇒ 409「該場次已結束」，不覆寫、不寫房間、不公告、不推進`,
      !r.err && r.status === 409 && r.out?.error === '該場次已結束' && db.winnerUid === 'u1' && !db.adminResolved && env.log.room === 0 && env.log.chat.length === 0 && env.log.adv === 0,
      JSON.stringify({ r, db, log: env.log }));
  }
  {
    const db = M(); const env = makeEnv({ dbMatch: db, findMatch: M(), admin: false });
    const r = await runHandler(src, '/api/tournament/admin/match/resolve', env, { matchId: 'M1', winnerSeat: 1 });
    ok(`★ A3${tag} 非管理員 ⇒ 403，一筆都不查`, !r.err && r.status === 403 && env.log.find === 0 && env.log.upd.length === 0, JSON.stringify(r));
  }
}

async function checkN(src, tag) {
  const blk = blockOf(src, 'v183-event-lastnick-cache');
  const g = fnBody(src, '    async function getLastRegisteredNick(uid) {');
  ok(`前提${tag} 抽得到 evLastNickV183 區塊與 getLastRegisteredNick`, blk.length > 500 && g.length > 100, `${blk.length} ${g.length}`);
  // 資料庫：u1 報過兩次，最近一次沒填暱稱
  const regs = [{ uid: 'u1', name: '舊名', registeredAt: 1 }, { uid: 'u1', name: '', registeredAt: 2 }];
  let nq = 0, boom = false;
  const match = (r, f) => r.uid === f.uid && (!f.name || !(f.name.$nin || []).includes(r.name ?? null));
  const TREGS = { find: (f) => ({ sort: () => ({ limit: (n) => ({ toArray: async () => { nq++; if (boom) throw new Error('db down'); return regs.filter((r) => match(r, f)).sort((a, b) => b.registeredAt - a.registeredAt).slice(0, n).map((r) => ({ name: r.name, registeredAt: r.registeredAt })); } }) }) }) };
  let api = null;
  // BASE 的 getLastRegisteredNick 還讀自己的 _chatNickCache ⇒ 替它補一個（HEAD 沒有這個名字，補了也不影響）
  try { api = new Function('TREGS', 'const _chatNickCache = new Map();\n' + blk + '\n' + g + '\nreturn { evLastNickV183, evLastNickInvalidateV183, getLastRegisteredNick };')(TREGS); } catch (e) { api = { err: e.message }; }
  const _g = typeof api?.getLastRegisteredNick === 'function' ? api.getLastRegisteredNick : async () => 'MISSING';
  const get = async (u) => { try { return await _g(u); } catch (e) { return 'THROW:' + e.message; } };
  const n1 = await get('u1');
  ok(`★★★ N1${tag} 最近一次報名沒填暱稱 ⇒ 回更早那次有填的「舊名」（原本回 null）`, n1 === '舊名', JSON.stringify(n1));
  // N2：/event 先查過 ⇒ 聊天不再查；報名後失效 ⇒ 立刻是新名字
  let n2 = false;
  if (api && typeof api.evLastNickV183 === 'function') {
    api.evLastNickInvalidateV183(null);
    const q0 = nq; await api.evLastNickV183('u1'); await get('u1'); const shared = nq === q0 + 1;
    regs.push({ uid: 'u1', name: '新名', registeredAt: 3 });
    api.evLastNickInvalidateV183('u1');
    const after = await get('u1');
    n2 = shared && after === '新名';
  }
  ok(`★★★ N2${tag} 與 /event 共用同一份快取（/event 查過就不再查）；報名時失效 ⇒ 下一次立刻是新暱稱`, n2);
  const n3a = await get('nobody');
  boom = true; api?.evLastNickInvalidateV183?.(null); const n3b = await get('u1'); boom = false;
  const q1 = nq; const n3c = await get(''); const n3d = await get(null);
  ok(`★★ N3${tag} 從沒報名 ⇒ null；查詢丟例外 ⇒ null（不往外丟）；uid 缺席 ⇒ null 且不查`, n3a === null && n3b === null && n3c === null && n3d === null && nq === q1, JSON.stringify({ n3a, n3b, n3c, n3d }));
  ok(`★★ N4${tag} 判準只有一份：舊的 _chatNickCache 已移除；getLastRegisteredNick 本體不再自己查 TREGS`, !/_chatNickCache/.test(src) && g.length > 0 && !/TREGS\./.test(g) && /evLastNickV183\(uid\)/.test(g), JSON.stringify({ old: /_chatNickCache/.test(src), self: /TREGS\./.test(g) }));
}

const src = readFileSync(join(ROOT, SAP), 'utf8').replace(/\r\n/g, '\n');
console.log('【P】投降條件式寫入'); await checkP(src, '');
console.log('【A】管理員裁定條件式寫入'); await checkA(src, '');
console.log('【N】暱稱 helper 收斂'); await checkN(src, '');

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const b = readBaseBlob(ROOT, BASE_SHA, SAP);
  const bs = b.ok ? b.out.replace(/\r\n/g, '\n') : '';
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  await checkP(bs, '@BASE'); await checkA(bs, '@BASE'); await checkN(bs, '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
  const bp = pass - before; pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  ok('★★★ H1 BASE 上 P1b／P2／P4／A1b／A2／N1／N2／N4 都紅（本版修的正是這些）', ['P1b@', 'P2@', 'P4@', 'A1b@', 'A2@', 'N1@', 'N2@', 'N4@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
  ok('★★ H2 BASE 上「前提」、P1／P3／A1／A3／N3 綠（正對照：抽取器與假資料庫沒壞）', !reds.some((r) => /前提|P1@|P3@|A1@|A3@|N3@/.test(r)) && bp >= 6, reds.join(',') + ' ' + bp);
}
console.log(`=== server v1.84 投降／裁定條件式＋暱稱收斂：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
