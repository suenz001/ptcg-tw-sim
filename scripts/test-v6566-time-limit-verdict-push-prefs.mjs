#!/usr/bin/env node
/**
 * v6.566 守衛（站長 2026-10-14 兩項）：
 *   ① admin 可以切換「對局時限到、最後回合打完仍未分出勝負」的判法：雙方皆判敗（預設）／獎賞卡少的一方獲勝。
 *   ② 「有玩家發起社群賽時也通知我」關掉後偶爾還是收到：另一台沒動過勾選的裝置一登記推播，
 *      就用本機預設「開」把整個帳號（含手機）改回開 ⇒ 改成以伺服器（帳號層級）為準。
 *
 *   S：server v1.67 哨兵 v167-time-limit-verdict 抽出來接假 Mongo／假 app **實跑**（預設、admin 才能改、非法值 400、快取立即失效）。
 *   T：錦標賽區塊的對局時限掃描（整段抽出來實跑）：宣布最後回合時記下判法與對應公告；最後回合打完依「記下的」判法判；
 *      舊場次沒記 ⇒ 讀目前設定；'prizes' 模式獎賞卡相同仍雙方皆判敗（舊行為逐字不變）。
 *   U：推播三支端點（subscribe／prefs POST／prefs GET）抽出來實跑：帳號層級寫入、新裝置繼承、另一台登記不會把別台改回開。
 *   C：前端 notify.ts 的 syncNotifyCommunity 實跑（esbuild 打包，注入假 localStorage／假 api）；subscribePush 改走它。
 *   A：admin 面板 tevTlvPanelHtml 實跑、tevTlvSet 注入假 api 實跑。
 * 【H】BASE（v6.565）：S／T／U／C／A 逐條紅（T3、T4、T5 是舊行為零回歸對照，BASE 也必須綠）。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.565。
const BASE_SHA = '695356b2';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ── 假 Mongo（只做用到的）──────────────────────────────────────────────
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
function matchOne(doc, q) {
  for (const k of Object.keys(q || {})) {
    const c = q[k], v = doc[k];
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      if ('$ne' in c && v === c.$ne) return false;
      if ('$in' in c && !c.$in.includes(v)) return false;
      continue;
    }
    if (v !== c) return false;
  }
  return true;
}
function Col(rows = []) {
  const calls = { findOne: 0 };
  return {
    rows, calls,
    async findOne(q) { calls.findOne++; const r = rows.find((d) => matchOne(d, q)); return r ? clone(r) : null; },
    find(q) {
      let sel = rows.filter((d) => matchOne(d, q || {})).map(clone);
      const cur = { sort: () => cur, limit: (n) => { sel = sel.slice(0, n); return cur; }, project: () => cur, toArray: async () => sel };
      return cur;
    },
    async updateOne(q, u, o) {
      let d = rows.find((x) => matchOne(x, q));
      if (!d) { if (!(o && o.upsert)) return { matchedCount: 0 }; d = {}; for (const k of Object.keys(q)) if (typeof q[k] !== 'object') d[k] = q[k]; rows.push(d); }
      if (u.$set) Object.assign(d, clone(u.$set));
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(q, u) { let n = 0; for (const d of rows) if (matchOne(d, q)) { Object.assign(d, clone(u.$set)); n++; } return { modifiedCount: n }; },
    async deleteMany(q) {
      const hit = (d) => Object.keys(q).every((k) => {
        const v = k === 'sub.endpoint' ? (d.sub && d.sub.endpoint) : d[k], c = q[k];
        return (c && typeof c === 'object') ? ('$ne' in c ? v !== c.$ne : true) : v === c;
      });
      for (let i = rows.length - 1; i >= 0; i--) if (hit(rows[i])) rows.splice(i, 1);
      return {};
    },
  };
}
function sentinel(src, tag) {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  if (a < 0 || b < a) return null;
  return src.slice(src.lastIndexOf('\n', a) + 1, src.indexOf('\n', b) + 1);
}
async function call(h, req) {
  let status = 200, body = null;
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; }, set() { return res; } };
  await h(req, res);
  return { status, body };
}
/** 從 start 起找第一個 `{`，配對到對應的 `}`（跳過字串／正則以外的簡單情形；抽出後再用 new Function 驗語法）。 */
function braceBlock(src, start) {
  const i = src.indexOf('{', start);
  if (i < 0) return null;
  let d = 0, q = null;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (q) { if (ch === '\\') { k++; continue; } if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(start, k + 1); }
  }
  return null;
}

// ═══ S：判法設定 ═════════════════════════════════════════════════════════
async function settingScenarios(P) {
  const r = {};
  const blk = sentinel(P, 'v167-time-limit-verdict');
  if (!blk) return r;
  const cfg = Col();
  const routes = {};
  const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  const db = { collection: (n) => (n === 'tournamentConfig' ? cfg : Col()) };
  let admin = false;
  const F = await new Function('db', 'app', 'tournIdentity', 'isTournAdmin', 'return (async () => {\n' + blk + '\nreturn { tTimeLimitVerdict, TLV_MODES, TLV_DEFAULT };\n})();')(
    db, app, async () => ({ uid: 'u', email: 'a@x' }), () => admin);
  const G = () => call(routes['GET /api/tourn-time-limit-verdict'], { query: {} });
  const S = (mode) => call(routes['POST /api/tourn-time-limit-verdict'], { body: { mode } });
  const realNow = Date.now; let clock = 5_000_000; Date.now = () => clock;
  try {
    const d0 = await F.tTimeLimitVerdict();
    const g403 = await G(); const s403 = await S('prizes');
    admin = true;
    const g0 = await G();
    const bad = await S('winner');
    const s1 = await S('prizes');
    const after = await F.tTimeLimitVerdict();   // POST 後立即生效（不等 10 秒快取）
    const g1 = await G();
    const s2 = await S('double-loss');
    r.S1 = d0 === 'double-loss' && F.TLV_DEFAULT === 'double-loss' && g403.status === 403 && s403.status === 403 && cfg.rows.length === 1
      && g0.status === 200 && g0.body.tlvApi === 1 && g0.body.mode === 'double-loss' && g0.body.defaultMode === 'double-loss'
      && bad.status === 400 && s1.status === 200 && s1.body.mode === 'prizes' && after === 'prizes' && g1.body.mode === 'prizes'
      && s2.body.mode === 'double-loss' && cfg.rows[0].updatedBy === 'a@x';
    r.S1n = JSON.stringify({ d0, g0: g0.body, s1: s1.body, after, rows: cfg.rows });
    // S2：讀不到設定（DB 出錯）⇒ 預設雙方皆判敗；10 秒快取（期間不重查）
    cfg.rows.length = 0; clock += 20_000;
    const c0 = cfg.calls.findOne; await F.tTimeLimitVerdict(); await F.tTimeLimitVerdict(); const c1 = cfg.calls.findOne;
    const brokenDb = { collection: () => ({ findOne: async () => { throw new Error('down'); } }) };
    const F2 = await new Function('db', 'app', 'tournIdentity', 'isTournAdmin', 'return (async () => {\n' + blk + '\nreturn { tTimeLimitVerdict };\n})();')(
      brokenDb, { get() {}, post() {} }, async () => ({}), () => false);
    r.S2 = c1 - c0 === 1 && (await F2.tTimeLimitVerdict()) === 'double-loss';
  } finally { Date.now = realNow; }
  return r;
}

// ═══ T：對局時限掃描（錦標賽區塊內）════════════════════════════════════
function limitBlockOf(P) {
  const a = P.indexOf('        // v0.44 對局時限：官方「打完剩餘回合」制');
  if (a < 0) return null;
  const s = P.indexOf("        if (ev.status === 'running') {\n          const limitMin", a);
  if (s < 0) return null;
  return braceBlock(P, s);
}
async function limitScenarios(P) {
  const r = {};
  const blk = limitBlockOf(P);
  if (!blk) return r;
  const run = async ({ match, prizes, turn, cfgMode }) => {
    const ev = { _id: 'E', status: 'running', roundLimitMin: 25, format: 'single-elim' };
    const now = 100 * 60000;
    const TMATCH = Col([{ _id: 'M', eventId: 'E', status: 'playing', roomId: 'R', gameStartedAt: 1, p1uid: 'a', p2uid: 'b', p1name: '甲', p2name: '乙', round: 1, ...match }]);
    const gs = { phase: 'playing', turn, players: [{ prizes: Array(prizes[0]).fill({}) }, { prizes: Array(prizes[1]).fill({}) }] };
    const TROOMS = Col([{ _id: 'R', version: 3, gameState: gs }]);
    const chats = [], adv = [];
    const f = new Function('ev', 'now', 'TMATCH', 'TROOMS', 'postSystemChat', 'advanceOrFinish', 'swissPhase', 'swissContinueNote', 'tTimeLimitVerdict', 'TLV_MODES',
      'return (async () => {\n' + blk + '\n})();');
    await f(ev, now, TMATCH, TROOMS, async (t) => { chats.push(t); }, async (m, u, n) => { adv.push([u, n]); }, () => false, () => '', async () => cfgMode, ['double-loss', 'prizes']);
    return { m: TMATCH.rows[0], room: TROOMS.rows[0], chats, adv };
  };
  // T1：時間到（第一次）⇒ 記下目前判法；公告依判法
  const t1a = await run({ match: {}, prizes: [3, 3], turn: 5, cfgMode: 'double-loss' });
  const t1b = await run({ match: {}, prizes: [3, 3], turn: 5, cfgMode: 'prizes' });
  r.T1 = t1a.m.timeLimitReached === true && t1a.m.timeLimitTurn === 5 && t1a.m.timeLimitVerdict === 'double-loss' && t1a.adv.length === 0 && t1a.room.timeLimitTurn === 5
    && /若仍未分出勝負，雙方皆判敗。$/.test(t1a.chats[0] || '')
    && t1b.m.timeLimitVerdict === 'prizes' && /依雙方剩餘獎賞卡判定。$/.test(t1b.chats[0] || '');
  r.T1n = JSON.stringify([t1a.m, t1a.chats, t1b.chats]);
  // T2：最後回合打完、記下的是 double-loss ⇒ 獎賞卡不同也雙方皆判敗（即使站長之後切成 prizes）
  const t2 = await run({ match: { timeLimitReached: true, timeLimitTurn: 5, timeLimitVerdict: 'double-loss' }, prizes: [2, 4], turn: 6, cfgMode: 'prizes' });
  r.T2 = t2.m.status === 'done' && t2.m.winnerUid === null && t2.m.draw === true && t2.m.timeLimit === true && t2.adv.length === 1 && t2.adv[0][0] === null
    && t2.room.gameState.phase === 'game-over' && t2.room.gameState.winner === null && /仍未分出勝負 → 雙方皆判敗/.test(t2.room.gameState.winReason)
    && /^⏰ 對局時限到，最後回合結束後仍未分出勝負 → 雙方皆判敗，雙方淘汰/.test(t2.chats[0] || '');
  r.T2n = JSON.stringify([t2.m, t2.room.gameState.winReason, t2.chats]);
  // T3：記下的是 prizes ⇒ 剩得少的一方獲勝（即使站長之後切成 double-loss）
  const t3 = await run({ match: { timeLimitReached: true, timeLimitTurn: 5, timeLimitVerdict: 'prizes' }, prizes: [2, 4], turn: 6, cfgMode: 'double-loss' });
  r.T3 = t3.m.status === 'done' && t3.m.winnerUid === 'a' && t3.room.gameState.winner === 0 && t3.adv[0][0] === 'a';
  // T4：舊場次（v1.67 之前宣布、沒記判法；當時公告寫「依雙方剩餘獎賞卡判定」）⇒ 照公告用 prizes，不管目前設定（Opus 審查 P2-1）
  const t4 = await run({ match: { timeLimitReached: true, timeLimitTurn: 5 }, prizes: [2, 4], turn: 6, cfgMode: 'double-loss' });
  const t4b = await run({ match: { timeLimitReached: true, timeLimitTurn: 5 }, prizes: [2, 4], turn: 6, cfgMode: 'prizes' });
  r.T4 = t4.m.winnerUid === 'a' && t4b.m.winnerUid === 'a';
  // T5（零回歸對照，BASE 也必須綠）：prizes 模式、獎賞卡相同 ⇒ 舊措辭逐字不變；最後回合還沒打完 ⇒ 什麼都不動
  const t5 = await run({ match: { timeLimitReached: true, timeLimitTurn: 5, timeLimitVerdict: 'prizes' }, prizes: [3, 3], turn: 6, cfgMode: 'prizes' });
  const t5b = await run({ match: { timeLimitReached: true, timeLimitTurn: 5, timeLimitVerdict: 'double-loss' }, prizes: [2, 4], turn: 5, cfgMode: 'double-loss' });
  r.T5 = t5.m.winnerUid === null && t5.m.draw === true && t5.room.gameState.winReason === '對局時限到，最後回合結束後雙方剩餘獎賞卡相同 → 自動判雙敗（雙方淘汰）'
    && t5.chats[0] === '⏰ 對局時限到，最後回合結束後仍平手 → 自動判雙敗，雙方淘汰（下一輪對手輪空）。'
    && t5b.m.status === 'playing' && t5b.chats.length === 0 && t5b.room.gameState.phase === 'playing';
  r.T5n = JSON.stringify([t5.room.gameState.winReason, t5.chats, t5b.m.status]);
  return r;
}

async function actionScenarios(P) {
  const r = {};
  const a = P.indexOf("    app.post('/api/tournament/action', async (req, res) => {");
  if (a < 0) return r;
  const src = braceBlock(P, P.indexOf('async (req, res) =>', a));
  if (!src) return r;
  const run = async (doc) => {
    let applied = 0;
    const TROOMS = { findOne: async () => clone(doc) };
    const h = new Function('TROOMS', 'tournIdentity', '_stateForSeat', 'TSEAT_NO_REDACT', 'tActionApplyOnce', 'canSeatAct', 'TENG', 'normalizeAction', 'TPOOL', 'currentActorSeat', '_lpNotify', 'snapshotTurn', 'onMatchGameOver',
      'return ' + src + ';')(TROOMS, async () => ({ uid: 'a', verified: true }), (g) => g, -1,
      async (d) => { applied++; return { kind: 'ok', gs: d.gameState, version: d.version + 1 }; }, () => true, {}, (x) => x, null, () => 0, () => {}, () => {}, async () => {});
    const out = await call(h, { body: { room: 'R', action: { type: 'END_TURN' } } });
    return { out, applied };
  };
  const base = { _id: 'R', matchId: 'M', version: 7, seats: ['a', 'b'], gameState: { phase: 'playing', turn: 6, activePlayerIndex: 0 } };
  const blocked = await run({ ...base, timeLimitTurn: 5 });
  const inFinal = await run({ ...base, timeLimitTurn: 6 });
  const noLimit = await run({ ...base });
  r.T6 = blocked.applied === 0 && /對局時限已到/.test(String(blocked.out.body && blocked.out.body.error)) && blocked.out.body.version === 7
    && inFinal.applied === 1 && noLimit.applied === 1;
  r.T6n = JSON.stringify([blocked, inFinal.applied, noLimit.applied]);
  // T7（Opus 複審 P1）：管理員重賽沿用同一個房間 ⇒ 房間上的 timeLimitTurn 必須清掉（否則新對局一打到那個回合數就被擋），TMATCH 的判法也清掉
  const ri = P.indexOf("app.post('/api/tournament/admin/match/restart'");
  const rsrc = ri >= 0 ? braceBlock(P, P.indexOf('async (req, res) =>', ri)) : '';
  const roomUpd = (rsrc || '').split('\n').find((l) => /await TROOMS\.updateOne\(\{ _id: roomId \}/.test(l)) || '';
  const matchUpd = (rsrc || '').split('\n').find((l) => /await TMATCH\.updateOne\(\{ _id: m\._id \}, \{ \$set: \{ roomId,/.test(l)) || '';
  r.T7 = /actorSeat: currentActorSeat\(gs\), timeLimitTurn: null \} \}/.test(roomUpd) && /timeLimitTurn: '', timeLimitCalledAt: '', timeLimitVerdict: ''/.test(matchUpd);
  r.T7n = JSON.stringify([roomUpd.slice(-160), matchUpd.slice(-200)]);
  return r;
}

// ═══ U：推播偏好端點（錦標賽區塊內）════════════════════════════════════
async function pushScenarios(P) {
  const r = {};
  const a = P.indexOf("    app.post('/api/tournament/push/subscribe'");
  const b = P.indexOf("    app.post('/api/tournament/push/unsubscribe'");
  if (a < 0 || b < a) return r;
  const src = P.slice(a, b);
  const TPUSH = Col(), TPUSHPREF = Col();
  const routes = {};
  const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  let who = 'W';
  new Function('app', 'TPUSH', 'TPUSHPREF', 'tournIdentity', 'Buffer', src)(app, TPUSH, TPUSHPREF, async () => ({ uid: who }), Buffer);
  const sub = (ep) => call(routes['POST /api/tournament/push/subscribe'], { body: { subscription: { endpoint: ep } } });
  const pref = (on, src = 'user') => call(routes['POST /api/tournament/push/prefs'], { body: src ? { notifyCommunity: on, src } : { notifyCommunity: on } });
  const getp = () => (routes['GET /api/tournament/push/prefs'] ? call(routes['GET /api/tournament/push/prefs'], { query: {} }) : Promise.resolve({ status: 404, body: null }));
  // 情境（站長的真實流程）：手機登記並關掉 ⇒ 電腦（從沒動過勾選）登記 ⇒ 換一個新端點的裝置登記
  const g0 = await getp();
  await sub('phone');
  await pref(false);
  await sub('desktop');           // 新版 client 不會再無條件送「開」；伺服器端新裝置繼承帳號層級的「關」
  await sub('phone-rotated');     // 手機瀏覽器換了推播端點 ⇒ 新的一筆也是「關」
  const g1 = await getp();
  const rows = TPUSH.rows.filter((x) => x.uid === 'W');
  r.U1 = g0.status === 200 && g0.body && g0.body.prefsApi === 1 && g0.body.known === false && g0.body.notifyCommunity === true
    && rows.length === 3 && rows.every((x) => x.notifyCommunity === false)
    && g1.body && g1.body.known === true && g1.body.notifyCommunity === false
    && TPUSHPREF.rows.length === 1 && TPUSHPREF.rows[0]._id === 'W' && TPUSHPREF.rows[0].notifyCommunity === false;
  r.U1n = JSON.stringify({ g0: g0.body, g1: g1.body, rows: rows.map((x) => [x._id.slice(-6), x.notifyCommunity]), pref: TPUSHPREF.rows });
  // U2：親手打開 ⇒ 帳號層級與所有裝置都開；別人的帳號不受影響；沒有帳號層級紀錄的人新登記 ⇒ 不寫欄位（缺席＝開，舊行為）
  await pref(true);
  who = 'X'; await sub('x-phone');
  const xr = TPUSH.rows.find((x) => x.uid === 'X');
  r.U2 = TPUSH.rows.filter((x) => x.uid === 'W').every((x) => x.notifyCommunity === true) && TPUSHPREF.rows.find((x) => x._id === 'W').notifyCommunity === true
    && xr && !('notifyCommunity' in xr) && !TPUSHPREF.rows.some((x) => x._id === 'X');
  // U3a：同一台裝置（同一個端點）換登入 Y ⇒ X 掛在這個端點上的那一筆被刪掉
  who = 'Y'; await sub('x-phone');
  const u3a = TPUSH.rows.filter((x) => x.sub.endpoint === 'x-phone').map((x) => x.uid).join(',') === 'Y';
  // U3b：舊版 client（不帶 src）登記後無條件送「開」⇒ 忽略；送「關」照收
  who = 'W'; await pref(false);
  const legacyOn = await pref(true, '');
  const u3b = legacyOn.body && legacyOn.body.ignored === true && TPUSHPREF.rows.find((x) => x._id === 'W').notifyCommunity === false
    && TPUSH.rows.filter((x) => x.uid === 'W').every((x) => x.notifyCommunity === false);
  await pref(true); const legacyOff = await pref(false, '');
  const u3c = !(legacyOff.body && legacyOff.body.ignored) && TPUSHPREF.rows.find((x) => x._id === 'W').notifyCommunity === false;
  r.U3 = u3a && u3b && u3c;
  r.U3n = JSON.stringify({ u3a, u3b, u3c, rows: TPUSH.rows.map((x) => [x.uid, x.sub.endpoint, x.notifyCommunity]) });
  // U3d：廣播（broadcastPush 抽出來實跑）：同一端點掛兩個帳號只推一次；任何一筆關掉的端點不推
  const bi = P.indexOf('    async function broadcastPush(');
  const bsrc = bi >= 0 ? P.slice(bi, P.indexOf('\n    }\n', bi) + 6) : '';
  if (bsrc) {
    const T2 = Col([
      { _id: '1', uid: 'A', sub: { endpoint: 'dev1' } },
      { _id: '2', uid: 'B', sub: { endpoint: 'dev1' } },
      { _id: '3', uid: 'C', sub: { endpoint: 'dev2' } },
      { _id: '4', uid: 'D', sub: { endpoint: 'dev2' }, notifyCommunity: false },
      { _id: '5', uid: 'E', sub: { endpoint: 'dev3' } },
    ]);
    const sent = [];
    const bp = new Function('TPUSH', '_webpush', 'return (' + bsrc.trim() + ');')(T2, { sendNotification: async (sub) => { sent.push(sub.endpoint); } });
    await bp({ title: 't' }, { prefKey: 'notifyCommunity' });
    r.U3 = r.U3 && sent.sort().join(',') === 'dev1,dev3';
    r.U3n += ' sent=' + sent.join(',');
  } else r.U3 = false;
  return r;
}

// ═══ C：前端 notify.ts ═══════════════════════════════════════════════════
async function loadNotify(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6566-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs'), S = join(tmp, 's.js');
  writeFileSync(S, 'export const base="";export const browser=true;');
  writeFileSync(E, `export * as N from '${join(srcRoot, 'src/lib/notify').replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
async function clientScenarios(L, notifySrc) {
  const r = {};
  if (!L || !L.N || typeof L.N.syncNotifyCommunity !== 'function') return r;
  const N = L.N;
  const env = (store) => {
    globalThis.window = globalThis.window || {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  };
  const mkApi = (srv, log) => async (path, body) => {
    log.push([path, body === undefined ? 'GET' : JSON.stringify(body)]);
    if (body === undefined) { if (srv === 'old') throw new Error('404'); return srv; }
    return { ok: true };
  };
  const K = 'ptcg.notify.community', D = 'ptcg.notify.community.dirty';
  try {
    // C1：電腦（從沒動過勾選）＋伺服器記得「關」⇒ 採用伺服器的關、**不送**任何東西
    let st = {}; env(st); let log = [];
    const v1 = await N.syncNotifyCommunity(mkApi({ prefsApi: 1, known: true, notifyCommunity: false }, log));
    const c1 = v1 === false && st[K] === '0' && log.length === 1 && log[0][1] === 'GET';
    // C2：本機親手切過、還沒送到（dirty）⇒ 補送本機值、清掉 dirty
    st = { [K]: '0', [D]: '1' }; env(st); log = [];
    const v2 = await N.syncNotifyCommunity(mkApi({ prefsApi: 1, known: true, notifyCommunity: true }, log));
    const c2 = v2 === false && log.length === 1 && log[0][0] === '/push/prefs' && log[0][1] === '{"notifyCommunity":false,"src":"user"}' && !(D in st);
    // C3：伺服器沒有帳號層級紀錄（舊資料）：本機明確設過「關」⇒ 送一次；本機沒設過 ⇒ 什麼都不送
    st = { [K]: '0' }; env(st); log = [];
    const v3 = await N.syncNotifyCommunity(mkApi({ prefsApi: 1, known: false, notifyCommunity: true }, log));
    const c3a = v3 === false && log.length === 2 && log[1][1] === '{"notifyCommunity":false,"src":"sync"}';
    // 本機明確設過「開」＋伺服器沒紀錄 ⇒ 不送（「開」是預設；避免先同步的那台搶先把「開」寫成帳號層級）
    st = { [K]: '1' }; env(st); log = [];
    const v3c = await N.syncNotifyCommunity(mkApi({ prefsApi: 1, known: false, notifyCommunity: true }, log));
    const c3c = v3c === null && log.length === 1;
    st = {}; env(st); log = [];
    const v3b = await N.syncNotifyCommunity(mkApi({ prefsApi: 1, known: false, notifyCommunity: true }, log));
    const c3b = v3b === null && log.length === 1 && log[0][1] === 'GET';
    // C4：讀伺服器失敗（逾時／504／舊伺服器）⇒ 不管本機是什麼都**不送**（Opus 審查 P1-1：這正是原本的覆蓋路徑）
    st = { [K]: '1' }; env(st); log = [];
    const v4 = await N.syncNotifyCommunity(mkApi('old', log));
    st = { [K]: '0' }; env(st); const log4b = [];
    await N.syncNotifyCommunity(mkApi('old', log4b));
    // 伺服器回錯誤物件（不是丟例外，例如 504 被 tApi 包成 { error }）⇒ 同樣不送
    st = { [K]: '1' }; env(st); const log4c = [];
    const v4c = await N.syncNotifyCommunity(mkApi({ error: '504 timeout' }, log4c));
    const c4 = v4 === null && log.length === 1 && log[0][1] === 'GET' && log4b.length === 1 && v4c === null && log4c.length === 1;
    // C5：親手切換 ⇒ 送出成功清 dirty；送出失敗留 dirty（下次補送）
    st = {}; env(st); log = [];
    await N.saveNotifyCommunity(false, mkApi({}, log));
    const c5a = st[K] === '0' && !(D in st) && log[0][1] === '{"notifyCommunity":false,"src":"user"}';
    st = {}; env(st);
    const origWarn = console.warn; console.warn = () => {};
    try { await N.saveNotifyCommunity(false, async () => { throw new Error('offline'); }); } finally { console.warn = origWarn; }
    const c5b = st[K] === '0' && st[D] === '1';
    r.C1 = c1 && c2 && c3a && c3b && c3c && c4 && c5a && c5b;
    r.C1n = JSON.stringify({ c1, c2, c3a, c3b, c3c, c4, c5a, c5b });
  } finally { delete globalThis.localStorage; }
  // C2：subscribePush 登記成功後改走 syncNotifyCommunity，不再無條件送本機值
  const i = notifySrc.indexOf('export async function subscribePush(');
  const body = i >= 0 ? notifySrc.slice(i, notifySrc.indexOf('\n}\n', i)) : '';
  r.C2 = /await syncNotifyCommunity\(api\);/.test(body) && !/notifyCommunity: getNotifyCommunity\(\)/.test(body);
  return r;
}

// ═══ A：admin 面板 ═══════════════════════════════════════════════════════
async function adminScenarios(H) {
  const r = {};
  const i = H.indexOf('function tevTlvPanelHtml(');
  const j = H.indexOf('function tevDailyPanelHtml(');
  if (i < 0 || j < i) return r;
  const calls = []; let confirmAns = true, reloads = 0;
  const win = {};
  const api = async (path, opt) => { calls.push([path, opt && opt.method, opt && JSON.parse(opt.body)]); return {}; };
  const F = new Function('window', 'api', 'confirm', 'alert', 'loadTournamentAdmin', H.slice(i, j) + '\nreturn { tevTlvPanelHtml };')(
    win, api, () => confirmAns, () => {}, () => { reloads++; });
  const off = F.tevTlvPanelHtml(null, '');
  const dl = F.tevTlvPanelHtml({ tlvApi: 1, mode: 'double-loss', defaultMode: 'double-loss' }, '');
  const pz = F.tevTlvPanelHtml({ tlvApi: 1, mode: 'prizes', defaultMode: 'double-loss' }, '');
  r.A1 = off === '' && /目前：雙方皆判敗/.test(dl) && /value="double-loss" checked/.test(dl) && !/value="prizes" checked/.test(dl)
    && /目前：獎賞卡少的一方獲勝/.test(pz) && /value="prizes" checked/.test(pz) && /雙方皆判敗<\/b> <span[^>]*>（預設）/.test(pz);
  await win.tevTlvSet('prizes');
  confirmAns = false; await win.tevTlvSet('double-loss');
  r.A2 = calls.length === 1 && calls[0][0] === '/api/tourn-time-limit-verdict' && calls[0][1] === 'POST' && calls[0][2].mode === 'prizes' && reloads === 2
    && /const td = await api\('\/api\/tourn-time-limit-verdict'\); if \(td && td\.tlvApi === 1\) tlvData = td;/.test(H) && /\+ tevTlvPanelHtml\(tlvData, btnS\);/.test(H);
  r.A2n = JSON.stringify({ calls, reloads });
  const oi = H.indexOf('function _tsMatchOutcome(');
  if (oi >= 0) {
    const O = new Function(H.slice(oi, H.indexOf('\n}\n', oi) + 3) + '\nreturn _tsMatchOutcome;')();
    r.A3 = O({ timeLimit: true, winnerUid: null, status: 'done' }) === '時限雙敗' && O({ timeLimit: true, winnerUid: 'a', status: 'done' }) === '時限判負';
  }
  return r;
}

const LABEL = {
  S1: '★★★ S1 判法設定：預設雙方皆判敗；只有管理員能讀寫；非法值 400；改了立即生效',
  S2: '★★ S2 判法設定：10 秒快取；DB 讀不到 ⇒ 預設雙方皆判敗',
  T1: '★★★ T1 時限到：記下當下判法，公告依判法（雙方皆判敗／依獎賞卡）',
  T2: '★★★ T2 記下 double-loss：最後回合打完獎賞卡不同也雙方皆判敗（之後切換不影響）',
  T3: '★★★ T3 記下 prizes：剩得少的一方獲勝（之後切換不影響）',
  T4: '★★ T4 舊場次沒記判法（v1.67 前宣布）⇒ 照當時公告用獎賞卡判',
  T6: '★★★ T6 /action：最後回合打完（turn 超過宣布時的值）⇒ 不再接受動作；還在最後回合內照常',
  T7: '★★★ T7 管理員重賽：清掉房間上的最後回合標記與這一場記下的判法（否則新對局會被擋住）',
  U3: '★★★ U3 推播：同一裝置換帳號只留新帳號；舊版 client 送「開」被忽略、送「關」照收；廣播依端點去重且任一筆關掉就不推',
  T5: '★★ T5 零回歸：prizes 模式獎賞卡相同仍是舊措辭雙敗；最後回合沒打完不動',
  U1: '★★★ U1 推播偏好：手機關掉後，電腦登記／手機換端點都不會被改回開（帳號層級＋新裝置繼承）；GET 讀得到',
  U2: '★★ U2 推播偏好：親手打開全部開；別的帳號不受影響；沒有帳號層級紀錄的人照舊不寫欄位',
  C1: '★★★ C1 前端同步：以伺服器為準；只有親手切過（dirty）或舊資料本機明確設過才送；沒設過不送預設值',
  C2: '★★ C2 subscribePush 改走 syncNotifyCommunity（不再無條件送本機值）',
  A1: '★★ A1 admin 面板：顯示目前判法、選中狀態、預設標示；舊伺服器不顯示',
  A2: '★★ A2 admin 切換：確認後 POST、取消不送；有接進賽事分頁',
  A3: '★ A3 admin 戰績：時限雙敗標「時限雙敗」，有勝方才是「時限判負」',
};

const P = normEol(readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8'));
const ADMIN = normEol(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'));
const NOTIFY = normEol(readFileSync(join(ROOT, 'src/lib/notify.ts'), 'utf8'));
async function all(P0, A0, N0, L0) {
  // ⚠ 每一節各自包 try（Rule 41：BASE 缺東西時逐條紅，不整支 throw）
  const g = async (fn) => { try { const x = await fn(); return x && typeof x === 'object' ? x : {}; } catch (e) { return { _err: String(e && e.message) }; } };
  return { ...(await g(() => settingScenarios(P0))), ...(await g(() => limitScenarios(P0))), ...(await g(() => actionScenarios(P0))), ...(await g(() => pushScenarios(P0))),
    ...(await g(() => clientScenarios(L0, N0))), ...(await g(() => adminScenarios(A0))) };
}
const R = await all(P, ADMIN, NOTIFY, await loadNotify(ROOT));
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n'] ?? R._err);

console.log('【H】HEAD-FAIL（BASE v6.565）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6566 HEAD-FAIL', '需要歷史 commit');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6566b-'));
  try {
    const rd = (p) => { const x = readBaseBlob(ROOT, BASE_SHA, p); return x.ok ? normEol(x.out) : ''; };
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src/lib | tar -x -C "${tmp}"`]);
    const B = await all(rd('oracle-admin/server_admin_patch.js'), rd('oracle-admin/admin.html'), rd('src/lib/notify.ts'), await loadNotify(tmp));
    for (const k of Object.keys(LABEL)) {
      // T3（prizes 判法本來就是舊行為）、T5 是零回歸對照：BASE 也必須綠（「之後切換不影響」由 T2 守，T2 在 BASE 必紅）
      if (k === 'T3' || k === 'T4' || k === 'T5') { ok('★★ [H] v6.565：' + k + ' 零回歸對照本來就綠（不要求紅）', B[k] === true, B[k + 'n'] ?? B._err); continue; }
      ok(`★★★[H] v6.565：${k} 紅`, B[k] !== true, String(B[k]));
    }
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.566 對局時限判法／社群賽通知偏好：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
