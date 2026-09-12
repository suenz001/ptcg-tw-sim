#!/usr/bin/env node
/**
 * v6.365 守衛 —— 站長裁定 六-2：錦標賽平手 ＝ **雙敗**（絕不由管理員判定）
 *
 * 站長裁定逐字（2026-09-12）：
 *   「錦標賽平手就等於雙敗，千萬不要由管理員判定，管理員不可能隨時在線上，
 *     而且目前已經有雙敗的機制」
 *
 * ⭐ 站上「既有的雙敗機制」是什麼（recon 結論，本版沿用它、沒有發明第二套）：
 *   ・資料形狀 ＝ TMATCH `status:'done'` ＋ `winnerUid:null`（＋一個成因旗標）。
 *   ・既有三個生產者：v0.44 對局時限平手（`timeLimit:true, draw:true`）、
 *     v6.188 兩人都棄賽（`doubleDrop`）、未進場雙缺席（`doubleNoShow`）。
 *   ・計分端 src/lib/tournament/swiss.ts buildSwissPlayersFromMatches 逐字：
 *     「只計已結束的對戰：有 winner=勝負已定；無 winner 但 status==='done'=雙未進場(雙敗)」
 *     ⇒ 雙方各記一筆 'L'、都不得分。**所以本版一個字都沒動 swiss.ts**，
 *       也沒有動用「宣告了卻沒人寫入」的 SwissResult 'T'。
 *
 * ⚠ 本檔一律**實跑**：把 server_admin_patch.js 的函式抽出來接上假 mongo 真的跑一遍，
 *   斷言「TMATCH 裡最後長什麼樣」「聊天室貼出了什麼」「瑞士輪算出幾分」，
 *   不是驗字串（旗標層斷言一律與行為併列，安慰劑 #28）。
 *
 * HEAD-FAIL（把 BASE_SHA = v6.364 的 server_admin_patch.js 餵進同一組情境）：
 *   B1/B2/B3/B4/G1 全紅（BASE 的 onMatchGameOver 遇到 wSeat==null 直接 return
 *   ⇒ 對戰永遠停在 status:'playing'、輪次永遠不推進、玩家只能等管理員）。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '7fcc1c66adfbaff17f8a245a2ba0683962f86f53';   // v6.364（本版的前一版）
const LF = (s) => s.split('\r\n').join('\n');
const SRV = LF(readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8'));
const PAGE = LF(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
const SWISS = LF(readFileSync(join(ROOT, 'src/lib/tournament/swiss.ts'), 'utf8'));

let BASE_SRV = null, baseWhy = '';
try {
  BASE_SRV = LF(execFileSync('git', ['show', BASE_SHA + ':oracle-admin/server_admin_patch.js'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 }));
} catch (e) { baseWhy = String((e && e.message) || e).slice(0, 160); }

let pass = 0, fail = 0, skip = 0;
const chk = (t, c, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + t); }
  else { fail++; console.log('  ❌ FAIL ' + t + (extra ? '\n        ' + extra : '')); }
};
const TA = async (t, fn) => { try { const r = await fn(); chk(t, r === true || r === undefined, typeof r === 'string' ? r : ''); }
  catch (e) { chk(t, false, String((e && e.message) || e)); } };

// ════════ 真的 swiss 純函式 ════════
const E = join(ROOT, '.v6365-e.ts'), O = join(ROOT, '.v6365-o.mjs'), S$ = join(ROOT, '.v6365-s.js');
process.on('exit', () => { for (const p of [E, O, S$]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S$, 'export const base="";export const assets="";');
writeFileSync(E, [
  "export { buildSwissPlayersFromMatches, computeStandings, pairSwissRound } from './src/lib/tournament/swiss';",
  "export { computeSfxEvents } from './src/lib/audio/sfx-events';",
].join('\n'));
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S$ }, logLevel: 'error' });
const TENG = await import(pathToFileURL(O).href);
const { buildSwissPlayersFromMatches, computeStandings, computeSfxEvents } = TENG;

// ════════ 假 mongo ════════
const clone = (o) => JSON.parse(JSON.stringify(o));
function matchOne(doc, q) {
  for (const k of Object.keys(q || {})) {
    const cond = q[k];
    if (k === '$or') { if (!cond.some((c) => matchOne(doc, c))) return false; continue; }
    const v = doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond && v === cond.$ne) return false;
      if ('$in' in cond && !cond.$in.includes(v)) return false;
      if ('$nin' in cond && cond.$nin.includes(v)) return false;
      if ('$exists' in cond && (v !== undefined) !== cond.$exists) return false;
      const plain = Object.keys(cond).filter((x) => !x.startsWith('$'));
      if (plain.length && JSON.stringify(v) !== JSON.stringify(cond)) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}
function applyUpd(doc, u) {
  let ch = false;
  if (u.$set) for (const k of Object.keys(u.$set)) { if (JSON.stringify(doc[k]) !== JSON.stringify(u.$set[k])) ch = true; doc[k] = u.$set[k]; }
  if (u.$unset) for (const k of Object.keys(u.$unset)) { if (k in doc) { delete doc[k]; ch = true; } }
  return ch;
}
function Col() {
  const rows = [];
  const y = () => new Promise((r) => setTimeout(r, 0));
  return {
    _rows: rows,
    async findOne(q, o) { await y(); const r = rows.find((d) => matchOne(d, q)); return r ? clone(r) : null; },
    find(q) { const sel = async () => { await y(); return rows.filter((d) => matchOne(d, q || {})).map(clone); };
      return { toArray: sel, sort: () => ({ toArray: sel }) }; },
    async insertOne(d) { await y(); rows.push(clone(d)); return { insertedId: d._id }; },
    async insertMany(a) { await y(); if (!Array.isArray(a) || a.length === 0) throw new Error('Invalid BulkOperation, Batch cannot be empty'); for (const d of a) rows.push(clone(d)); return { insertedCount: a.length }; },
    async updateOne(q, u, opts) {
      await y();
      const i = rows.findIndex((d) => matchOne(d, q));
      if (i < 0) {
        if (opts && opts.upsert) { const d = {}; for (const k of Object.keys(q)) { const c = q[k]; if (!(c && typeof c === 'object')) d[k] = c; }
          if (u.$set) Object.assign(d, u.$set); rows.push(clone(d)); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
        return { matchedCount: 0, modifiedCount: 0 };
      }
      const ch = applyUpd(rows[i], u);
      return { matchedCount: 1, modifiedCount: ch ? 1 : 0 };
    },
    async updateMany(q, u) { await y(); let n = 0; for (const d of rows) if (matchOne(d, q)) { applyUpd(d, u); n++; } return { matchedCount: n, modifiedCount: n }; },
    async deleteMany(q) { await y(); let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matchOne(rows[i], q)) { rows.splice(i, 1); n++; } return { deletedCount: n }; },
    async countDocuments(q) { await y(); return rows.filter((d) => matchOne(d, q || {})).length; },
  };
}

// ════════ 把出貨碼抽出來接上假 mongo ════════
function fnSrc(src, name) {
  for (const head of ['    async function ' + name + '(', '    function ' + name + '(']) {
    const i = src.indexOf(head);
    if (i < 0) continue;
    const j = src.indexOf('\n    }\n', i);
    if (j <= i) throw new Error('抓不到 ' + name + ' 的結尾');
    return src.slice(i, j + 6);
  }
  throw new Error('server_admin_patch.js 找不到函式 ' + name);
}
const FNS = ['buildRoundMatches', 'swissPhase', 'postSystemChat', 'recordChampion', 'recordTournamentArchive',
  'advanceOrFinish', 'pairingsToMatches', '_forceGameOver', 'finishSwissWithSurvivor', 'finishIfLastSurvivor',
  'advanceSwiss', 'noChampionReason', 'checkRoundAdvance', 'onMatchGameOver'];
function makeSrv(src) {
  const TEVENTS = Col(), TREGS = Col(), TMATCH = Col(), TROOMS = Col(), TCHAT = Col(), TARCHIVE = Col(), TCHAMPS = Col();
  const env = { TEVENTS, TREGS, TMATCH, TROOMS, TCHAT, TARCHIVE, TCHAMPS, TENG, console };
  const code = FNS.map((n) => fnSrc(src, n)).join('\n')
    + '\nreturn { onMatchGameOver, checkRoundAdvance, noChampionReason };';
  const names = Object.keys(env);
  const built = new Function(...names, code)(...names.map((n) => env[n]));
  return { ...built, TEVENTS, TREGS, TMATCH, TROOMS, TCHAT, TARCHIVE, TCHAMPS };
}

const chatText = async (S) => (await S.TCHAT.find({}).toArray()).map((r) => r.text).join('\n');
const mrow = async (S, id) => await S.TMATCH.findOne({ _id: id });

/** 佈一場「4 人瑞士制、第 1 輪」：m0 = 甲 vs 乙（要打成平手）、m1 = 丙 vs 丁（丙已勝）。 */
async function seedSwiss(S) {
  await S.TEVENTS.insertOne({ _id: 'EV', name: '測試賽', status: 'running', format: 'swiss-then-cut',
    phase: 'swiss', currentRound: 1, swissRounds: 2, roundCountdownMin: 3, roundStartedAt: 1 });
  for (const [uid, name] of [['u1', '甲'], ['u2', '乙'], ['u3', '丙'], ['u4', '丁']]) {
    await S.TREGS.insertOne({ _id: 'EV__' + uid, eventId: 'EV', uid, name, checkedIn: true });
  }
  await S.TMATCH.insertOne({ _id: 'EV_r1_m0', eventId: 'EV', round: 1, idx: 0, phase: 'swiss',
    p1uid: 'u1', p1name: '甲', p2uid: 'u2', p2name: '乙', winnerUid: null, winnerName: null,
    status: 'playing', bye: false, roomId: 'R0', entered: [true, true] });
  await S.TMATCH.insertOne({ _id: 'EV_r1_m1', eventId: 'EV', round: 1, idx: 1, phase: 'swiss',
    p1uid: 'u3', p1name: '丙', p2uid: 'u4', p2name: '丁', winnerUid: 'u3', winnerName: '丙',
    status: 'done', bye: false, roomId: 'R1' });
  await S.TROOMS.insertOne({ _id: 'R0', matchId: 'EV_r1_m0', seats: ['u1', 'u2'], names: ['甲', '乙'], version: 1,
    gameState: drawGs() });
}
const drawGs = () => ({ id: 'g1', phase: 'game-over', isDraw: true, turn: 9,
  winReason: '雙方同時取得所有獎賞卡，且雙方皆可放置戰鬥寶可夢', log: [{ turn: 9, playerIndex: null, message: 'x' }] });
const winGs = (w) => ({ id: 'g1', phase: 'game-over', winner: w, turn: 9, winReason: '取得所有獎賞卡', log: [{ turn: 9, playerIndex: null, message: 'x' }] });

/** 跑一次「平手的對局結束」──呼叫的**只有** onMatchGameOver，全程沒有任何管理員端點。 */
async function runDraw(src) {
  const S = makeSrv(src);
  await seedSwiss(S);
  const room = await S.TROOMS.findOne({ _id: 'R0' });
  await S.onMatchGameOver(room, room.gameState);
  return S;
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】harness 自我驗證（掃描器自己要先被驗過，Rule 25）');
await TA('0-1 本版與 BASE 的 14 支函式都抽得出來、沙盒都建得起來', async () => {
  makeSrv(SRV);
  if (BASE_SRV) makeSrv(BASE_SRV);
  return true;
});
await TA('0-2 正對照：有勝方的對局照樣會被結算（沙盒沒壞、不是「整支沒跑」）', async () => {
  const S = makeSrv(SRV);
  await seedSwiss(S);
  await S.TROOMS.updateOne({ _id: 'R0' }, { $set: { gameState: winGs(0) } });
  const room = await S.TROOMS.findOne({ _id: 'R0' });
  await S.onMatchGameOver(room, room.gameState);
  const m = await mrow(S, 'EV_r1_m0');
  return (m.status === 'done' && m.winnerUid === 'u1') || JSON.stringify(m);
});
if (!BASE_SRV) { skip++; console.log('  ⚠ SKIP HEAD-FAIL 段：拿不到 BASE blob（淺複製？）:: ' + baseWhy); }

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】HEAD-FAIL：同樣的情境餵給 v6.364 的出貨碼 ⇒ 必須「卡住等管理員」');
if (BASE_SRV) {
  await TA('A1 ⭐⭐⭐ BASE：平手 ⇒ 對戰永遠停在 playing、沒有任何公告、輪次不推進', async () => {
    const S = await runDraw(BASE_SRV);
    const m = await mrow(S, 'EV_r1_m0');
    const ev = await S.TEVENTS.findOne({ _id: 'EV' });
    const t = await chatText(S);
    return (m.status === 'playing' && m.winnerUid === null && ev.currentRound === 1 && t === '')
      || JSON.stringify([m.status, m.winnerUid, ev.currentRound, t]);
  });
  await TA('A2 ⭐⭐ BASE：平手場**沒有**任何雙敗旗標（本版的 gameDraw 是新的，不是本來就有）', async () => {
    const S = await runDraw(BASE_SRV);
    const m = await mrow(S, 'EV_r1_m0');
    return (!m.draw && !m.gameDraw) || JSON.stringify(m);
  });
  await TA('A3 ⭐⭐ BASE：平手場進瑞士輪重建 ⇒ 雙方 0 分且**一筆勝負都沒有**（＝沒被記敗）', async () => {
    const S = await runDraw(BASE_SRV);
    const ms = await S.TMATCH.find({ eventId: 'EV' }).toArray();
    const pl = buildSwissPlayersFromMatches(
      ms.map((m) => ({ round: m.round, p1uid: m.p1uid, p2uid: m.p2uid, winnerUid: m.winnerUid, bye: !!m.bye, status: m.status })),
      [{ uid: 'u1', name: '甲' }, { uid: 'u2', name: '乙' }, { uid: 'u3', name: '丙' }, { uid: 'u4', name: '丁' }]);
    const a = pl.find((p) => p.uid === 'u1'), b = pl.find((p) => p.uid === 'u2');
    return (a.results.length === 0 && b.results.length === 0) || JSON.stringify(pl.map((p) => [p.uid, p.matchPoints, p.results]));
  });
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】本版：錦標賽平手 ⇒ 走既有雙敗機制（兩邊都記敗、正常結束、零人工介入）');
await TA('B1 ⭐⭐⭐ 平手 ⇒ TMATCH 變成 done、winnerUid 仍是 null（＝站上既有雙敗機制的資料形狀）', async () => {
  const S = await runDraw(SRV);
  const m = await mrow(S, 'EV_r1_m0');
  return (m.status === 'done' && m.winnerUid === null && m.winnerName === null) || JSON.stringify(m);
});
await TA('B2 ⭐⭐⭐ 平手 ⇒ **兩邊都記敗**（把結果餵回瑞士輪重建：各一筆 L、各 0 分）', async () => {
  const S = await runDraw(SRV);
  const ms = await S.TMATCH.find({ eventId: 'EV' }).toArray();
  const pl = buildSwissPlayersFromMatches(
    ms.map((m) => ({ round: m.round, p1uid: m.p1uid, p2uid: m.p2uid, winnerUid: m.winnerUid, bye: !!m.bye, status: m.status })),
    [{ uid: 'u1', name: '甲' }, { uid: 'u2', name: '乙' }, { uid: 'u3', name: '丙' }, { uid: 'u4', name: '丁' }]);
  const a = pl.find((p) => p.uid === 'u1'), b = pl.find((p) => p.uid === 'u2');
  return (a.matchPoints === 0 && b.matchPoints === 0
    && a.results.filter((r) => r === 'L').length === 1 && b.results.filter((r) => r === 'L').length === 1
    && a.results.filter((r) => r === 'W' || r === 'BYE').length === 0
    && b.results.filter((r) => r === 'W' || r === 'BYE').length === 0)
    || JSON.stringify(pl.map((p) => [p.uid, p.matchPoints, p.results]));
});
await TA('B3 ⭐⭐⭐ 零人工介入：沙盒裡**一個管理員端點都沒有**，只呼叫 onMatchGameOver 就收乾淨了', async () => {
  const S = await runDraw(SRV);
  const open = await S.TMATCH.countDocuments({ eventId: 'EV', round: 1, status: { $ne: 'done' } });
  return open === 0 || ('第 1 輪還有 ' + open + ' 場沒結束');
});
await TA('B4 ⭐⭐ 平手場**不會**出現在 admin 的待裁定清單（第 1 輪 status $ne done ／ pending-admin）', async () => {
  const S = await runDraw(SRV);
  const pend = await S.TMATCH.find({ eventId: 'EV', round: 1, status: { $ne: 'done' } }).toArray();
  const all = await S.TMATCH.find({ eventId: 'EV' }).toArray();
  return (pend.length === 0 && all.every((m) => m.status !== 'pending-admin'))
    || JSON.stringify(all.map((m) => [m._id, m.status]));
});
await TA('B5 ⭐ 公告照實說「雙敗」，而且**不可以**再提「等待管理員／人工裁定」', async () => {
  const S = await runDraw(SRV);
  const t = await chatText(S);
  return (t.includes('雙敗') && !t.includes('等待管理員') && !t.includes('人工裁定')
    && !t.includes('待站長') && !t.includes('保留給管理員'))
    || JSON.stringify(t);
});
await TA('B6 ⭐ 成因旗標：draw＋gameDraw 都寫上（不重用 doubleNoShow／doubleDrop／timeLimit）', async () => {
  const S = await runDraw(SRV);
  const m = await mrow(S, 'EV_r1_m0');
  return (m.draw === true && m.gameDraw === true && !m.doubleNoShow && !m.doubleDrop && !m.timeLimit && !m.deadlockDraw)
    || JSON.stringify(m);
});
await TA('B7 ⭐⭐ 冪等：同一場再收一次不會重複公告、也不會把分數算兩次', async () => {
  const S = await runDraw(SRV);
  const room = await S.TROOMS.findOne({ _id: 'R0' });
  await S.onMatchGameOver(room, room.gameState);
  const rows = await S.TCHAT.find({}).toArray();
  const n = rows.filter((r) => r.text.includes('雙敗')).length;
  return n === 1 || ('雙敗公告出現 ' + n + ' 次');
});
await TA('B8 ⭐⭐⭐ **非平手**的無勝方 game-over（資料不一致／系統死角）維持不結算 —— 絕不亂判兩個人敗', async () => {
  const S = makeSrv(SRV);
  await seedSwiss(S);
  await S.TROOMS.updateOne({ _id: 'R0' }, { $set: { gameState: { id: 'g1', phase: 'game-over', turn: 9, log: [] } } });
  const room = await S.TROOMS.findOne({ _id: 'R0' });
  await S.onMatchGameOver(room, room.gameState);
  const m = await mrow(S, 'EV_r1_m0');
  const t = await chatText(S);
  return (m.status === 'playing' && m.winnerUid === null && t === '') || JSON.stringify([m.status, m.winnerUid, t]);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】瑞士輪行為端：分數正確、絕不為負／NaN、排名算得出來');
await TA('C1 ⭐⭐⭐ 帶一場平手的賽事跑 buildSwissPlayersFromMatches＋computeStandings：不丟例外、分數非負非 NaN', async () => {
  const S = await runDraw(SRV);
  const ms = await S.TMATCH.find({ eventId: 'EV' }).toArray();
  const pl = buildSwissPlayersFromMatches(
    ms.map((m) => ({ round: m.round, p1uid: m.p1uid, p2uid: m.p2uid, winnerUid: m.winnerUid, bye: !!m.bye, status: m.status })),
    [{ uid: 'u1', name: '甲' }, { uid: 'u2', name: '乙' }, { uid: 'u3', name: '丙' }, { uid: 'u4', name: '丁' }]);
  const st = computeStandings(pl);
  const okNum = st.every((s) => Number.isFinite(s.matchPoints) && s.matchPoints >= 0
    && Number.isFinite(s.owp) && Number.isFinite(s.oowp) && Number.isInteger(s.rank) && s.rank >= 1);
  const ranks = st.map((s) => s.rank).sort((a, b) => a - b).join(',');
  return (st.length === 4 && okNum && ranks === '1,2,3,4') || JSON.stringify(st.map((s) => [s.uid, s.matchPoints, s.owp, s.oowp, s.rank]));
});
await TA('C2 ⭐⭐ 分數對得上：丙 3 分(W)、丁 0 分(L)、甲乙各 0 分(L)', async () => {
  const S = await runDraw(SRV);
  const ms = await S.TMATCH.find({ eventId: 'EV' }).toArray();
  const pl = buildSwissPlayersFromMatches(
    ms.map((m) => ({ round: m.round, p1uid: m.p1uid, p2uid: m.p2uid, winnerUid: m.winnerUid, bye: !!m.bye, status: m.status })),
    [{ uid: 'u1', name: '甲' }, { uid: 'u2', name: '乙' }, { uid: 'u3', name: '丙' }, { uid: 'u4', name: '丁' }]);
  const g = (u) => pl.find((p) => p.uid === u);
  return (g('u3').matchPoints === 3 && g('u3').results[0] === 'W'
    && g('u4').matchPoints === 0 && g('u4').results[0] === 'L'
    && g('u1').results[0] === 'L' && g('u2').results[0] === 'L')
    || JSON.stringify(pl.map((p) => [p.uid, p.matchPoints, p.results]));
});
await TA('C3 ⭐ swiss.ts 本版一個字都沒動（雙敗計分沿用既有那一條，沒有發明第二套）', () => {
  return (SWISS.includes("const resolved = m.winnerUid != null || m.status === 'done';")
    && SWISS.includes("      // status==='done' 且無 winner = 雙未進場/雙敗\n      if (a) a.results.push('L');\n      if (b) b.results.push('L');")
    && !SWISS.includes("results.push('T')"))
    || 'swiss.ts 的既有雙敗分支對不上';
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】反對照：一般勝負場的計分**完全沒變**（本版 vs BASE 逐字比對）');
if (BASE_SRV) {
  const runWin = async (src) => {
    const S = makeSrv(src);
    await seedSwiss(S);
    await S.TROOMS.updateOne({ _id: 'R0' }, { $set: { gameState: winGs(1) } });
    const room = await S.TROOMS.findOne({ _id: 'R0' });
    await S.onMatchGameOver(room, room.gameState);
    const m = await mrow(S, 'EV_r1_m0');
    m.endedAt = 0;                                    // 時戳正規化（唯一會飄的欄位）
    const ev = await S.TEVENTS.findOne({ _id: 'EV' });
    const ms = await S.TMATCH.find({ eventId: 'EV' }).toArray();
    return JSON.stringify({ m, round: ev.currentRound, status: ev.status,
      chat: (await S.TCHAT.find({}).toArray()).map((r) => r.text),
      nextRound: ms.filter((x) => x.round === 2).map((x) => [x.p1uid, x.p2uid, x.status]).sort() });
  };
  await TA('D1 ⭐⭐⭐ 有勝方的對局：TMATCH 文件、公告、下一輪配對與 BASE **逐字元相同**', async () => {
    const a = await runWin(SRV), b = await runWin(BASE_SRV);
    return a === b || ('本版 =' + a + '\n        BASE =' + b);
  });
  await TA('D2 ⭐ 自我驗證：D1 不是恆真（平手情境下兩邊一定不同）', async () => {
    const a = JSON.stringify(await (async () => { const S = await runDraw(SRV); return (await mrow(S, 'EV_r1_m0')).status; })());
    const b = JSON.stringify(await (async () => { const S = await runDraw(BASE_SRV); return (await mrow(S, 'EV_r1_m0')).status; })());
    return a !== b || ('兩邊平手行為竟然一樣：' + a);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】反對照：休閒／單機的平手**仍然是平手**（站長只裁定了錦標賽），而且照樣播落敗音');
await TA('E1 ⭐⭐ 休閒戰績：無 winner ⇒ 仍記 draw（不是 loss）', () => {
  const i = SRV.indexOf('    function casualSideResult(winner, isP1) {');
  if (i < 0) return '找不到 casualSideResult';
  const j = SRV.indexOf('\n    }\n', i);
  const fn = new Function('return (' + SRV.slice(i + 4, j + 6).replace(/^function/, 'function') + ')')();
  return (fn(null, true) === 'draw' && fn(undefined, false) === 'draw'
    && fn(0, true) === 'win' && fn(0, false) === 'loss')
    || JSON.stringify([fn(null, true), fn(0, true), fn(0, false)]);
});
await TA('E2 ⭐⭐ v6.364 平手落敗音還在：單機／休閒平手 ⇒ 雙方都收到 game-lose', () => {
  const P0 = () => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] });
  const prev = { phase: 'playing', activePlayerIndex: 0, players: [P0(), P0()], log: [] };
  const next = { phase: 'game-over', isDraw: true, activePlayerIndex: 0, players: [P0(), P0()], log: [] };
  const names = (ctx) => computeSfxEvents(prev, next, null, new Map(), ctx).map((e) => e.name);
  const a = names({ mode: 'online', myPlayerIndex: 0 });
  const b = names({ mode: 'online', myPlayerIndex: 1 });
  const s = names({ mode: 'solo', aiPlayerIndex: 1 });
  return (a.includes('game-lose') && b.includes('game-lose') && s.includes('game-lose')
    && !a.includes('game-win') && !b.includes('game-win') && !s.includes('game-win'))
    || JSON.stringify([a, b, s]);
});
await TA('E3 ⭐ 非錦標賽的平手結算視窗（v6.361 新增）逐字還在，本版沒有動到它', () => {
  return (PAGE.includes('>>> v6361-draw-modal') && PAGE.includes('<<< v6361-draw-modal')
    && PAGE.includes("{#if game.phase === 'game-over' && (game.winner === null || game.winner === undefined) && !isTournament}")
    && PAGE.includes('本局平手！'))
    || '找不到 v6361 平手結算視窗';
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】前端：錦標賽平手不再顯示「等待管理員裁定」');
await TA('F1 ⭐⭐⭐ 全站再也找不到「本場平手，等待管理員裁定」這句話', () => {
  return !PAGE.includes('本場平手，等待管理員裁定') || '它還在 +page.svelte 裡';
});
await TA('F2 ⭐⭐ 錦標賽平手改說雙敗，而且只在 isDraw 時說（其他無勝方情況不可被誤標成雙敗）', () => {
  const i = PAGE.indexOf("{#if isTournament && game && game.phase === 'game-over' && (game.winner === null || game.winner === undefined)}");
  if (i < 0) return '找不到錦標賽無勝方返回列';
  const line = PAGE.slice(i, PAGE.indexOf('\n', i));
  return (line.includes('{#if game.isDraw}') && line.includes('雙敗')
    && line.includes('不需管理員裁定') && line.includes('返回賽事大廳'))
    || line.slice(0, 300);
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】晉級／下一輪配對不會因為平手場卡住');
await TA('G1 ⭐⭐⭐ 平手收掉之後本輪全 done ⇒ 瑞士制真的配出第 2 輪（BASE 會永遠停在第 1 輪）', async () => {
  const S = await runDraw(SRV);
  const ev = await S.TEVENTS.findOne({ _id: 'EV' });
  const r2 = await S.TMATCH.find({ eventId: 'EV', round: 2 }).toArray();
  return (ev.currentRound === 2 && ev.status === 'running' && r2.length === 2
    && r2.every((m) => m.p1uid && m.p2uid))
    || JSON.stringify([ev.currentRound, ev.status, r2.map((m) => [m.p1uid, m.p2uid])]);
});
await TA('G2 ⭐⭐ 平手的兩個人**照樣**被排進下一輪（雙敗是記敗，不是踢出瑞士輪）', async () => {
  const S = await runDraw(SRV);
  const r2 = await S.TMATCH.find({ eventId: 'EV', round: 2 }).toArray();
  const uids = new Set(r2.flatMap((m) => [m.p1uid, m.p2uid]));
  return (uids.has('u1') && uids.has('u2')) || JSON.stringify([...uids]);
});
await TA('G3 ⭐⭐ 單淘汰：平手 ⇒ 兩人皆不晉級、賽程照樣往下走（不卡住、不丟例外）', async () => {
  const S = makeSrv(SRV);
  await S.TEVENTS.insertOne({ _id: 'EV', name: '單敗賽', status: 'running', format: 'single-elim', currentRound: 1, rounds: 2, roundCountdownMin: 3 });
  for (const [uid, name] of [['u1', '甲'], ['u2', '乙'], ['u3', '丙'], ['u4', '丁']]) {
    await S.TREGS.insertOne({ _id: 'EV__' + uid, eventId: 'EV', uid, name, checkedIn: true });
  }
  await S.TMATCH.insertOne({ _id: 'EV_r1_m0', eventId: 'EV', round: 1, idx: 0, p1uid: 'u1', p1name: '甲', p2uid: 'u2', p2name: '乙',
    winnerUid: null, winnerName: null, status: 'playing', bye: false, roomId: 'R0', entered: [true, true] });
  await S.TMATCH.insertOne({ _id: 'EV_r1_m1', eventId: 'EV', round: 1, idx: 1, p1uid: 'u3', p1name: '丙', p2uid: 'u4', p2name: '丁',
    winnerUid: 'u3', winnerName: '丙', status: 'done', bye: false });
  await S.TROOMS.insertOne({ _id: 'R0', matchId: 'EV_r1_m0', seats: ['u1', 'u2'], names: ['甲', '乙'], version: 1, gameState: drawGs() });
  const room = await S.TROOMS.findOne({ _id: 'R0' });
  await S.onMatchGameOver(room, room.gameState);
  const ev = await S.TEVENTS.findOne({ _id: 'EV' });
  const open = await S.TMATCH.countDocuments({ eventId: 'EV', status: { $ne: 'done' } });
  return (open === 0 && ev.status === 'finished' && ev.championUid === 'u3')
    || JSON.stringify([open, ev.status, ev.championUid]);
});
await TA('G4 ⭐ 完賽公告：最後一場是規則平手時，措辭不可謊稱「時限到」或「未進場」', async () => {
  const S = makeSrv(SRV);
  const t = S.noChampionReason([{ winnerUid: null, draw: true, gameDraw: true }], 0);
  return (t.includes('平手') && !t.includes('時限') && !t.includes('未進場') && !t.includes('棄賽')) || t;
});
await TA('G5 ⭐ 正對照：時限平手的既有措辭沒被動到（v6.189 那條還在）', async () => {
  const S = makeSrv(SRV);
  const t = S.noChampionReason([{ winnerUid: null, draw: true, timeLimit: true }], 0);
  return (t.includes('平手') && t.includes('時限')) || t;
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【H】level-triggered 對帳：平手也會被補收（/action 那一次失敗時的第二道網）');
{
  const B0 = SRV.indexOf('// ── ⭐⭐⭐v6.212 GAMEOVER RECONCILE BLOCK BEGIN');
  const B1 = SRV.indexOf('GAMEOVER RECONCILE BLOCK END', B0 + 1);
  const beginLine = B0 > 0 ? SRV.lastIndexOf('\n', B0) + 1 : -1;
  const endLine = B1 > 0 ? SRV.indexOf('\n', B1) : -1;
  const BLOCK = (beginLine >= 0 && endLine > beginLine) ? SRV.slice(beginLine, endLine) : '';
  await TA('H0 harness 自我驗證：對帳區塊抓得到（抓不到的話下面兩條是恆真）', () => BLOCK.length > 200 || ('抓到 ' + BLOCK.length + ' 字元'));
  const RUNNER = new Function('_light', 'TROOMS', 'm', 'onMatchGameOver',
    'return (async function () { for (let _once = 0; _once < 1; _once++) {\n'
    + BLOCK + '\n return { continued: false }; } return { continued: true }; })();');
  const runRec = async (gs) => {
    const calls = [], warns = [];
    const room = { _id: 'R1', matchId: 'M1', eventId: 'E1', seats: ['u0', 'u1'], names: ['甲', '乙'], gameState: gs };
    const TROOMS = { async findOne() { return room; } };
    const onMatchGameOver = async (doc, g) => { calls.push({ matchId: doc && doc.matchId, isDraw: g && g.isDraw }); };
    const _light = { lastActionAt: 1, gameState: { phase: gs.phase } };
    const ow = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try { const r = await RUNNER(_light, TROOMS, { _id: 'M1', roomId: 'R1' }, onMatchGameOver); return { ...r, calls, warns }; }
    finally { console.warn = ow; }
  };
  await TA('H1 ⭐⭐⭐ 房間是平手的 game-over 而對戰仍 playing ⇒ 對帳**真的補跑**結算', async () => {
    delete global.__ptcgReconcileNoWinnerWarned;
    const r = await runRec({ phase: 'game-over', isDraw: true, log: [] });
    delete global.__ptcgReconcileNoWinnerWarned;
    return (r.calls.length === 1 && r.calls[0].isDraw === true && r.continued === true)
      || JSON.stringify([r.calls, r.continued, r.warns]);
  });
  await TA('H2 ⭐⭐ 正對照：**不是**平手的無勝方 game-over 仍然不補跑、只 warn（不自作主張）', async () => {
    delete global.__ptcgReconcileNoWinnerWarned;
    const r = await runRec({ phase: 'game-over', winner: null, log: [] });
    delete global.__ptcgReconcileNoWinnerWarned;
    return (r.calls.length === 0 && r.warns.length === 1) || JSON.stringify([r.calls, r.warns]);
  });
  await TA('H3 ⭐ 正對照：有勝方的 game-over 照舊補跑（沒有把既有那條關掉）', async () => {
    delete global.__ptcgReconcileNoWinnerWarned;
    const r = await runRec({ phase: 'game-over', winner: 1, log: [] });
    delete global.__ptcgReconcileNoWinnerWarned;
    return r.calls.length === 1 || JSON.stringify(r.calls);
  });
}

console.log('\n=== v6.365 錦標賽平手＝雙敗：' + pass + ' PASS, ' + fail + ' FAIL' + (skip ? ', ' + skip + ' SKIP' : '') + ' ===');
process.exit(fail ? 1 : 0);
