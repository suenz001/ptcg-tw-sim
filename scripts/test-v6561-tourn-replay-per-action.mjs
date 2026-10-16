#!/usr/bin/env node
/**
 * v6.561 守衛：錦標賽回放改成「每個動作一格」（站長 2026-10-13：「也請你順便把錦標賽復盤也改成每個動作一格」）。
 *
 *   S：伺服器 v1.64（哨兵 v164-replay-steps，錦標賽區塊之前）——把哨兵區塊抽出來，接假 collection／假 app **實跑**：
 *      用 AI 對打一整場的真實盤面逐一餵 tReplayOnApplied，再打 GET /api/replay/tourn-steps，解壓後逐格比對。
 *   K：掛鉤只在 tActionApplyOnce 的「寫入成功」出口（重送／不是你的回合／無效／拒絕／CAS 落敗都不記）；
 *      錦標賽區塊（TAIL_ANCHOR 起）與 BASE 逐位元相同（28 把鎖一把都不動）。
 *   C：前端 replay-tourn.ts（解包、合併半回合格與逐動作格、端點不存在時退回）＋對戰頁 tStartReplay 接線。
 *   E：端到端：伺服器記錄 → 端點 → 前端解包合併 ⇒ 回放格數＝這場 playing 的盤面數，順序與內容逐格相同。
 * 【H】BASE（v6.560）：S／K1／C／E 紅；K1b／K1c（掛鉤不弄壞對戰的安全性質）與 K2 在 BASE 本來就成立。
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip, readBaseBlob } from './lib/base-blob.mjs';
import { revertAdminV165 } from './lib/sap-revert-admin-v165.mjs';
import { revertAdminV166 as _revertAdminV166 } from './lib/sap-revert-admin-v166.mjs';
import { revertAdminV167 as _revertAdminV167 } from './lib/sap-revert-admin-v167.mjs';   // ⭐v1.67（v6.566 對局時限判法、推播偏好帳號層級）
import { revertAdminV168 as _revertAdminV168 } from './lib/sap-revert-admin-v168.mjs';   // ⭐v1.68（v6.575 聊天室禁止連續相同內容，錦標賽區塊之前）：先剝較新的（Rule 54）
import { revertAdminV169 } from './lib/sap-revert-admin-v169.mjs';   // ⭐v1.69（重賽系統訊息「擲硬幣」，錦標賽區塊內兩行；前端未 bump）
const revertAdminV168 = (s) => _revertAdminV168(revertAdminV169(s));   // ⭐v1.69 鏈再長一節（既有呼叫點一個字都不必改）
const revertAdminV167 = (s) => _revertAdminV167(revertAdminV168(s));   // ⭐v1.68 鏈再長一節（既有呼叫點一個字都不必改）
const revertAdminV166 = (s) => _revertAdminV166(revertAdminV167(s));   // ⭐v1.67 鏈再長一節（既有呼叫點一個字都不必改）
   // ⭐v6.563 再先剝一節（Rule 54）   // ⭐v6.562 K2 先剝較新的一節（Rule 54）
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.560。
const BASE_SHA = 'cb4abe25';
const TAIL_ANCHOR = "app.get('/api/tournament";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const mod = await buildAiBundle(ROOT, {});
const pool = loadLivePool(ROOT);

// ── 用 AI 對打一場：回傳伺服器 tActionApplyOnce 會看到的「每一個寫入成功的新盤面」（依序） ──
function playStates(seed = 5) {
  const out = []; let last = null;
  playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')],
    agents: [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)], seed, firstPlayer: firstPlayerOf(seed),
    onStep: (st, act, next) => { if (next && next !== st && next !== last) { out.push(next); last = next; } } });
  return out;
}
const GAME = playStates(5);
const PLAYING = GAME.filter((g) => g.phase === 'playing');
const strip = (g) => { const s = Object.assign({}, g); s.log = []; return s; };

/** 抽哨兵區塊（含頭尾行）。 */
function sentinel(src, tag) {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  if (a < 0 || b < a) return null;
  return src.slice(src.lastIndexOf('\n', a) + 1, src.indexOf('\n', b) + 1);
}
/** 以名稱抽 function 宣告（大括號配對）。 */
function grabFn(src, name) {
  const i = src.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return null;
}

// 假 collection（只做用到的）
function fakeColl(rows = []) {
  return {
    rows,
    createIndex: async () => {},
    insertOne: async (d) => { if (rows.some((r) => r._id === d._id)) throw new Error('E11000 dup'); rows.push(structuredClone(d)); return { insertedId: d._id }; },
    findOne: async (q) => rows.find((r) => Object.entries(q).every(([k, v]) => r[k] === v)) || null,
    find: (q, opt) => {
      let res = rows.filter((r) => Object.entries(q).every(([k, v]) => (v && typeof v === 'object' && '$gte' in v) ? r[k] >= v.$gte : r[k] === v));
      const cur = { sort: (s) => { const [[k, dir]] = Object.entries(s); res = res.slice().sort((x, y) => (x[k] - y[k]) * dir); return cur; }, limit: (n) => { res = res.slice(0, n); return cur; }, toArray: async () => res.map((r) => structuredClone(r)) };
      return cur;
    },
  };
}
function fakeApp() { const routes = {}; return { routes, get: (p, h) => { routes['GET ' + p] = h; } }; }
async function call(app, path, query) {
  let status = 200, body = null;
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; }, set() { return res; } };
  await app.routes['GET ' + path]({ query }, res);
  return { status, body };
}
async function loadServer(src, { matches = [], archives = [] } = {}) {
  const blk = sentinel(src, 'v164-replay-steps');
  if (!blk) return null;
  const db = { cols: {}, collection(n) { return this.cols[n] || (this.cols[n] = fakeColl()); } };
  const app = fakeApp();
  const TMATCH = fakeColl(matches), TARCHIVE = fakeColl(archives);
  const f = new Function('db', 'app', 'TMATCH', 'TARCHIVE', 'Buffer', 'return (async () => {\n' + blk + '\nreturn { tReplayOnApplied, tReplayStepsFlush, _rsBuf };\n})();');
  const api = await f(db, app, TMATCH, TARCHIVE, Buffer);
  return { ...api, app, db, TMATCH, store: db.collection('tournamentReplaySteps') };
}
const gunzipBatches = (batches) => batches.flatMap((b) => JSON.parse(zlib.gunzipSync(Buffer.from(b, 'base64')).toString('utf8')));

// ═══ S：伺服器 ══════════════════════════════════════════════════════════
async function serverScenarios(src) {
  const r = {};
  const match = { _id: 'E1_r1_m0', eventId: 'E1', status: 'done', gameStartedAt: 1000 };
  const S = await loadServer(src, { matches: [match] });
  if (!S) return r;
  const realNow = Date.now; let clock = 2000; Date.now = () => clock;
  try {
    // 開局 setup 也會經過 tActionApplyOnce ⇒ 不可以記
    let ver = 10;
    for (const g of GAME) { clock += 50; S.tReplayOnApplied({ matchId: match._id, eventId: 'E1' }, g, ++ver); }
    await new Promise((res) => setTimeout(res, 50));
    // S3（複審 P2-1）：終局動作本身就要把記憶體清掉——必須在 GET 之前看（GET 也會清，之後再看就是安慰劑）
    r.S3 = S._rsBuf.size === 0 && S.store.rows.length > 0;
    const got = await call(S.app, '/api/replay/tourn-steps', { matchId: match._id });
    const steps = got.status === 200 && got.body && got.body.replayStepsApi === 1 ? gunzipBatches(got.body.batches) : [];
    // S1：每個 playing 盤面一格、順序相同、內容（去 log）逐格相同
    r.S1 = steps.length === PLAYING.length && steps.every((s, i) => JSON.stringify(s.state) === JSON.stringify(strip(PLAYING[i])) && s.logLen === PLAYING[i].log.length && s.turn === (PLAYING[i].turn || 1));
    r.S1n = JSON.stringify({ status: got.status, steps: steps.length, playing: PLAYING.length, game: GAME.length });
    // S2：每半回合（換行動方）一包，不是每個動作一筆；一包最多 40 格
    const halves = new Set(PLAYING.map((g) => (g.turn || 1) + '_' + g.activePlayerIndex)).size;
    const docs = S.store.rows;
    r.S2 = docs.length >= halves && docs.length <= halves + Math.ceil(PLAYING.length / 40) && docs.every((d) => d.n <= 40 && d.matchId === match._id && d.expireAt instanceof Date && d.expireAt.getTime() - clock > 80 * 864e5);
    r.S2n = JSON.stringify({ docs: docs.length, halves });
    // S4：尚未結束且未歸檔 ⇒ 403；找不到 ⇒ 404；沒帶 matchId ⇒ 400
    S.TMATCH.rows.push({ _id: 'E1_r1_m1', eventId: 'E1', status: 'playing', gameStartedAt: 1 });
    const g403 = await call(S.app, '/api/replay/tourn-steps', { matchId: 'E1_r1_m1' });
    const g404 = await call(S.app, '/api/replay/tourn-steps', { matchId: 'nope' });
    const g400 = await call(S.app, '/api/replay/tourn-steps', {});
    r.S4 = g403.status === 403 && g404.status === 404 && g400.status === 400;
    // S5：賽事已歸檔 ⇒ 進行中的場次也開放（與 /api/tournament/replay 同規則）
    const S5 = await loadServer(src, { matches: [{ _id: 'E2_m', eventId: 'E2', status: 'playing', gameStartedAt: 1 }], archives: [{ _id: 'arch_E2' }] });
    r.S5 = (await call(S5.app, '/api/replay/tourn-steps', { matchId: 'E2_m' })).status === 200;
    // S6：重賽重用 matchId：只回 at ≥ gameStartedAt 的包（舊局不混進來）
    const S6 = await loadServer(src, { matches: [{ _id: 'M', eventId: 'E', status: 'done', gameStartedAt: 0 }] });
    clock = 5000; for (let i = 0; i < 12; i++) { clock += 10; S6.tReplayOnApplied({ matchId: 'M' }, PLAYING[i], 100 + i); }
    S6.tReplayOnApplied({ matchId: 'M' }, GAME[GAME.length - 1], 200);   // 舊局終局
    clock = 9000; S6.TMATCH.rows[0].gameStartedAt = 8000;   // 管理員重賽
    for (let i = 0; i < 5; i++) { clock += 10; S6.tReplayOnApplied({ matchId: 'M' }, PLAYING[i], 300 + i); }
    await new Promise((res) => setTimeout(res, 30));
    const g6 = await call(S6.app, '/api/replay/tourn-steps', { matchId: 'M' });
    const s6 = gunzipBatches(g6.body.batches);
    r.S6 = s6.length === 5 && s6.every((s) => s.ver >= 300);
    r.S6n = JSON.stringify({ n: s6.length, vers: s6.map((s) => s.ver) });
    // S7：投降／判負不經過動作端點 ⇒ 10 分鐘沒動作的那一場在下一次掃描時寫出；讀取端也會先把記憶體裡的寫出
    const S7 = await loadServer(src, { matches: [{ _id: 'Q', eventId: 'E', status: 'done', gameStartedAt: 0 }, { _id: 'Z', eventId: 'E', status: 'done', gameStartedAt: 0 }] });
    clock = 100000; for (let i = 0; i < 3; i++) S7.tReplayOnApplied({ matchId: 'Q' }, PLAYING[i], 1 + i);
    const before = S7.store.rows.length;
    clock += 11 * 60 * 1000; S7.tReplayOnApplied({ matchId: 'Z' }, PLAYING[0], 1);
    await new Promise((res) => setTimeout(res, 30));
    r.S7 = before === 0 && S7.store.rows.some((d) => d.matchId === 'Q' && d.n === 3) && !S7._rsBuf.has('Q');
    const gz = await call(S7.app, '/api/replay/tourn-steps', { matchId: 'Z' });
    r.S7b = gunzipBatches(gz.body.batches).length === 1 && !S7._rsBuf.has('Z');
    // S8：沒有 matchId（休閒房間）／非 playing ⇒ 不記
    const S8 = await loadServer(src, {});
    S8.tReplayOnApplied({ matchId: null }, PLAYING[0], 1);
    S8.tReplayOnApplied({}, PLAYING[0], 1);
    S8.tReplayOnApplied({ matchId: 'X' }, GAME.find((g) => g.phase !== 'playing'), 1);
    r.S8 = S8._rsBuf.size === 0 && S8.store.rows.length === 0;
    // S9（複審 P3-1）：同時進行中的對局超過上限 ⇒ 先寫出最久沒動的那一場，記憶體裡的場數不超過上限
    const S9 = await loadServer(src, {});
    const cap = Number((src.match(/const REPLAY_STEPS_MAX_BUFFERS = (\d+);/) || [])[1]);
    clock = 200000;
    for (let i = 0; i <= cap; i++) { clock += 1; S9.tReplayOnApplied({ matchId: 'B' + i }, PLAYING[0], 1); }
    await new Promise((res) => setTimeout(res, 30));
    r.S9 = cap > 0 && cap <= 200 && S9._rsBuf.size === cap && !S9._rsBuf.has('B0') && S9._rsBuf.has('B' + cap) && S9.store.rows.length === 1 && S9.store.rows[0].matchId === 'B0';
    r.S9n = JSON.stringify({ cap, size: S9._rsBuf.size, rows: S9.store.rows.map((d) => d.matchId) });
  } finally { Date.now = realNow; }
  return r;
}

// ═══ K：掛鉤位置 ═════════════════════════════════════════════════════════
async function hookScenarios(src) {
  const r = {};
  const fn = grabFn(src, 'tActionApplyOnce');
  if (!fn) return r;
  const hooks = (fn.match(/tReplayOnApplied\(/g) || []).length;
  // 實跑：注入一個記錄器，走過 applied／rejected／notyourturn／invalid／stale／duplicate 六條路
  const calls = [];
  const helpers = ['_actDupHit', '_actRingPush'].map((n) => grabFn(src, n)).join('\n');
  const PRE = 'const TACT_RING_TTL_MS = 600000; const TACT_RING_MAX = 64;\n';
  const core = await new Function('tReplayOnApplied', 'return (async () => { ' + PRE + helpers + '\n' + fn + '\nreturn tActionApplyOnce; })()')((d, g, v) => calls.push([d.matchId, g, v]));
  const g0 = { phase: 'playing', activePlayerIndex: 0, n: 0 }, g1 = { phase: 'playing', activePlayerIndex: 0, n: 1 };
  const mkDoc = (extra = {}) => ({ _id: 'R', matchId: 'M', version: 7, gameState: g0, recentActs: {}, ...extra });
  const deps = (o = {}) => ({ reload: async () => mkDoc(), canAct: () => true, applyAction: () => g1, actorSeat: () => 0, now: () => 1, cas: async () => ({ matchedCount: 1 }), ...o });
  const a = await core(mkDoc(), 0, 'A', deps());
  const b = await core(mkDoc(), 0, 'B', deps({ applyAction: () => g0 }));                       // rejected
  const c = await core(mkDoc(), 0, 'C', deps({ canAct: () => false }));                          // notyourturn
  const d = await core(mkDoc(), 0, 'D', deps({ applyAction: () => { throw new Error('x'); } })); // invalid
  const e = await core(mkDoc(), 0, 'E', deps({ cas: async () => ({ matchedCount: 0 }) }));       // stale
  const f = await core(mkDoc({ matchId: undefined }), 0, 'F', deps());                           // 休閒房（沒有 matchId）
  r.K1 = hooks === 1 && a.kind === 'applied' && [b, c, d, e].map((x) => x.kind).join() === 'rejected,notyourturn,invalid,stale' && f.kind === 'applied'
    && calls.length === 1 && calls[0][0] === 'M' && calls[0][1] === g1 && calls[0][2] === 8;
  r.K1n = JSON.stringify({ hooks, calls: calls.length, kinds: [a, b, c, d, e, f].map((x) => x.kind) });
  // K1b：記錄器丟例外 ⇒ 對戰照常寫入（絕不影響對戰）
  const core2 = await new Function('tReplayOnApplied', 'return (async () => { ' + PRE + helpers + '\n' + fn + '\nreturn tActionApplyOnce; })()')(() => { throw new Error('boom'); });
  let k = null; try { k = await core2(mkDoc(), 0, 'K', deps()); } catch { k = null; }   // 例外往外丟＝對戰被弄壞 ⇒ 紅（不整支 throw，Rule 41）
  r.K1b = !!k && k.kind === 'applied' && k.version === 8;
  // K1c：守衛單獨抽出來跑、沒有 tReplayOnApplied 這個名字 ⇒ 不會 ReferenceError（typeof 防護）
  const core3 = await new Function('return (async () => { ' + PRE + helpers + '\n' + fn + '\nreturn tActionApplyOnce; })()')();
  try { r.K1c = (await core3(mkDoc(), 0, 'L', deps())).kind === 'applied'; } catch { r.K1c = false; }
  return r;
}

// ═══ C：前端 ═════════════════════════════════════════════════════════════
async function loadClient(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/game/replay-tourn.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6561-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  writeFileSync(E, `export * from '${join(srcRoot, 'src/lib/game/replay-tourn').replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
async function clientScenarios(C, pageSrc, srvSrc) {
  const r = {};
  if (!C) return r;
  const snap = (turn, ap, logLen, tag, ver) => ({ turn, activePlayerIndex: ap, logLen, state: { tag }, ...(ver != null ? { ver } : {}) });
  // 半回合格：(1,0)@3 (1,1)@8 (2,0)@15；逐動作只有 (1,1) 從開頭（8）＋(2,0) 從中段（18）開始
  const half = [snap(1, 0, 3, 'h1'), snap(1, 1, 8, 'h2'), snap(2, 0, 15, 'h3')];
  const acts = [snap(1, 1, 8, 'a1', 20), snap(1, 1, 8, 'a2', 21), snap(1, 1, 11, 'a3', 22), snap(2, 0, 18, 'a4', 30)];
  // 複審 P2-2：逐動作格亂序餵入（穩定排序不能幫忙）⇒ 同 logLen 的 a1／a2 仍要依 ver 排
  const m = C.mergeTournReplaySteps(half, [acts[1], acts[3], acts[0], acts[2]]);
  r.C1 = m.map((s) => s.state.tag).join() === 'h1,a1,a2,a3,h3,a4';   // h2 被逐動作取代；h3 保留（逐動作從中段才有）；同 logLen 依 ver
  r.C1n = m.map((s) => s.state.tag).join();
  r.C2 = C.mergeTournReplaySteps(half, []).map((s) => s.state.tag).join() === 'h1,h2,h3'
    && C.mergeTournReplaySteps([{ turn: 1, activePlayerIndex: null, logLen: null, state: { tag: 'old' } }], acts).map((s) => s.state.tag).join() === 'old';
  // C3：解包（真的 gzip＋base64）；壞掉的包略過、其餘照用
  const good = zlib.gzipSync(Buffer.from(JSON.stringify([{ turn: 1, activePlayerIndex: 0, logLen: 4, ver: 9, state: { tag: 'x' } }]))).toString('base64');
  const dec = await C.decodeTournStepBatches([good, 'not-base64!!', zlib.gzipSync(Buffer.from('{oops')).toString('base64'), 123]);
  r.C3 = dec.length === 1 && dec[0].state.tag === 'x' && dec[0].ver === 9 && (await C.decodeTournStepBatches(null)).length === 0;
  // C4：端點不存在（舊伺服器 404）／沒有哨兵／fetch 例外 ⇒ 回原本的半回合格
  const f404 = async () => ({ ok: false, json: async () => ({}) });
  const fNoFlag = async () => ({ ok: true, json: async () => ({ batches: [good] }) });
  const fThrow = async () => { throw new Error('net'); };
  const fOk = async (u) => { r.C4u = u; return { ok: true, json: async () => ({ replayStepsApi: 1, batches: [good] }) }; };
  const o1 = await C.withTournPerActionSteps('M 1', half, f404), o2 = await C.withTournPerActionSteps('M', half, fNoFlag), o3 = await C.withTournPerActionSteps('M', half, fThrow);
  const o4 = await C.withTournPerActionSteps('M 1', half, fOk);
  r.C4 = o1 === half && o2 === half && o3 === half && o4.map((x) => x.state.tag).join() === 'h1,x,h2,h3' && r.C4u === '/api/replay/tourn-steps?matchId=M%201';
  // C5：前端呼叫的路徑＝伺服器註冊的路徑
  r.C5 = srvSrc.includes("app.get('" + C.TOURN_STEPS_URL + "'");
  // C6：對戰頁 tStartReplay：拿到 /replay 之後先合併逐動作格，再進共用入口 openReplayData
  const fn = pageSrc.match(/async function tStartReplay\(matchId: string\)[\s\S]*?\n  \}/);
  const body = fn ? fn[0] : '';
  const iMerge = body.indexOf('data.snapshots = await withTournPerActionSteps(matchId, data.snapshots || [])');
  const iOpen = body.indexOf("await openReplayData(data, 'tournament')");
  r.C6 = iMerge > 0 && iOpen > iMerge && /import \{ withTournPerActionSteps \} from '\$lib\/game\/replay-tourn'/.test(pageSrc);
  return r;
}

// ═══ E：端到端 ══════════════════════════════════════════════════════════
async function e2e(src, C) {
  const r = {};
  if (!C) return r;
  const match = { _id: 'EE', eventId: 'E', status: 'done', gameStartedAt: 0 };
  const S = await loadServer(src, { matches: [match] });
  if (!S) return r;
  let ver = 0;
  for (const g of GAME) S.tReplayOnApplied({ matchId: 'EE', eventId: 'E' }, g, ++ver);
  await new Promise((res) => setTimeout(res, 50));
  // 既有 snapshotTurn 的半回合格（開局＋每次換行動方）——同形重建
  const half = []; let prev = null;
  for (const g of GAME) {
    if (g.phase === 'playing' && (!prev || prev.phase !== 'playing' || prev.activePlayerIndex !== g.activePlayerIndex)) half.push({ turn: g.turn || 1, activePlayerIndex: g.activePlayerIndex, logLen: g.log.length, state: strip(g) });
    prev = g;
  }
  const fetcher = async (u) => { const q = new URL(u, 'http://x').searchParams; const g = await call(S.app, '/api/replay/tourn-steps', { matchId: q.get('matchId') }); return { ok: g.status === 200, json: async () => g.body }; };
  const merged = await C.withTournPerActionSteps('EE', half, fetcher);
  r.E1 = merged.length === PLAYING.length && merged.every((s, i) => JSON.stringify(s.state) === JSON.stringify(strip(PLAYING[i]))) && merged.length > 3 * half.length;
  r.E1n = JSON.stringify({ merged: merged.length, playing: PLAYING.length, half: half.length });
  // E2：伺服器重啟遺失了某半回合的前段 ⇒ 那半回合保留半回合格，格子仍完整連續（不會跳一段）
  const S2 = await loadServer(src, { matches: [{ ...match }] });
  const lostHalf = half[4];
  let v2 = 0, dropped = 0;
  for (const g of GAME) {
    v2++;
    if (g.phase === 'playing' && (g.turn || 1) === lostHalf.turn && g.activePlayerIndex === lostHalf.activePlayerIndex && dropped < 2) { dropped++; continue; }
    S2.tReplayOnApplied({ matchId: 'EE' }, g, v2);
  }
  await new Promise((res) => setTimeout(res, 50));
  const f2 = async (u) => { const g = await call(S2.app, '/api/replay/tourn-steps', { matchId: 'EE' }); return { ok: g.status === 200, json: async () => g.body }; };
  const m2 = await C.withTournPerActionSteps('EE', half, f2);
  const tags = m2.map((s) => JSON.stringify(s.state));
  r.E2 = dropped === 2 && m2.length === PLAYING.length - 1 && tags.includes(JSON.stringify(lostHalf.state)) && m2.every((s, i) => i === 0 || s.logLen >= m2[i - 1].logLen);
  r.E2n = JSON.stringify({ n: m2.length, playing: PLAYING.length });
  return r;
}

const LABEL = {
  S1: '★★★ S1 伺服器把整場每一個 playing 盤面都記下來（格數、順序、去 log 的內容、logLen、turn 逐格相同）',
  S2: '★★ S2 每半回合一包（不是每個動作一筆）、一包 ≤ 40 格、帶 90 天 TTL',
  S3: '★★ S3 終局動作本身就把記憶體清空（在讀取之前看）',
  S4: '★★★ S4 未結束且未歸檔 ⇒ 403（防偷看）；找不到 404；沒帶 matchId 400',
  S5: '★★ S5 賽事已歸檔 ⇒ 開放（與 /api/tournament/replay 同規則）',
  S6: '★★★ S6 重賽重用 matchId：只回 gameStartedAt 之後的包，舊局不混進來',
  S7: '★★ S7 投降／判負（沒有終局動作）⇒ 閒置 10 分鐘的那一場在下一次掃描寫出、記憶體釋放',
  S7b: '★★ S7b 讀取端先把記憶體裡尚未寫出的那一場寫出再回傳',
  S8: '★★ S8 休閒房（沒有 matchId）與非 playing 盤面都不記',
  S9: '★★ S9 同時進行中的對局超過上限（≤200）⇒ 先寫出最久沒動的那一場，記憶體場數不超過上限',
  K1: '★★★ K1 掛鉤只在 tActionApplyOnce 寫入成功的出口（重送以外的五條失敗路徑都不記；休閒房照常寫入）',
  K1b: '★★★ K1b 記錄器丟例外 ⇒ 對戰照常寫入',
  K1c: '★★ K1c 守衛單獨抽出 tActionApplyOnce 時沒有記錄器 ⇒ 不會 ReferenceError',
  C1: '★★★ C1 合併：有逐動作的半回合取代半回合格；逐動作只有中段的半回合保留開頭那一格；同進度依 ver',
  C2: '★★ C2 沒有逐動作資料／舊資料（無 logLen）⇒ 原樣回傳',
  C3: '★★ C3 解包 base64＋gzip；壞掉的包略過',
  C4: '★★★ C4 舊伺服器 404／缺哨兵／網路錯誤 ⇒ 照用半回合格；網址正確編碼',
  C5: '★★ C5 前端路徑＝伺服器註冊的路徑',
  C6: '★★★ C6 tStartReplay 先合併逐動作格再進 openReplayData',
  E1: '★★★ E1 端到端：伺服器記錄 → 端點 → 前端合併 ⇒ 每個動作一格，與真實對局逐格相同',
  E2: '★★ E2 端到端：某半回合前段遺失 ⇒ 保留那半回合開頭格，時序不倒退',
};

const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8').replace(/\r\n/g, '\n');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const C = await loadClient(ROOT);
const R = { ...(await serverScenarios(SRV)), ...(await hookScenarios(SRV)), ...(await clientScenarios(C, PAGE, SRV)), ...(await e2e(SRV, C)) };
console.log('【S／K／C／E】');
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);

// K2：錦標賽區塊（TAIL_ANCHOR 到檔尾）與 BASE 逐位元相同 ⇒ 28 把鎖一把都不動
console.log('【K2】錦標賽區塊零改動');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6561 K2 錦標賽區塊逐位元比對', '需要歷史 commit');
else {
  const base = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js').out.replace(/\r\n/g, '\n');
  const tail = (s) => s.slice(s.indexOf(TAIL_ANCHOR));
  // ⭐v6.562（Rule 40，意圖不變＝v1.64 本身沒動錦標賽區塊）：v1.65 合法改了區塊 ⇒ 先用 revertAdminV165 整份還原回 v1.64 再比
  const SRV164 = revertAdminV165(revertAdminV166(SRV));
  ok('★★★ K2 錦標賽區塊（TAIL_ANCHOR 起；先剝較新的 v1.65）與 v6.560 逐位元相同', SRV164.indexOf(TAIL_ANCHOR) > 0 && tail(SRV164) === tail(base));
  ok('★ K2b 哨兵都在錦標賽區塊之前', SRV.indexOf('// <<< v164-replay-steps') > 0 && SRV.indexOf('// <<< v164-replay-steps') < SRV.indexOf(TAIL_ANCHOR)
    && SRV.indexOf('// <<< v164-replay-step-hook') > 0 && SRV.indexOf('// <<< v164-replay-step-hook') < SRV.indexOf(TAIL_ANCHOR));

  // 【H】HEAD-FAIL：同一批判準餵 BASE
  console.log('【H】HEAD-FAIL（BASE v6.560）');
  const tmp = mkdtempSync(join(tmpdir(), 'v6561h-'));
  try {
    const BP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte').out;
    const B = { ...(await serverScenarios(base)), ...(await hookScenarios(base)), ...(await clientScenarios(null, BP, base)), ...(await e2e(base, null)) };
    // K1b／K1c 是「掛鉤不可以弄壞對戰」的安全性質：BASE 沒有掛鉤，本來就成立 ⇒ 不列入 HEAD-FAIL（在 BASE 必須綠）
    const SAFETY = ['K1b', 'K1c'];
    for (const k of Object.keys(LABEL)) {
      if (SAFETY.includes(k)) ok(`★[H] v6.560：${k} 是安全性質，BASE 也成立（綠）`, B[k] === true);
      else ok(`★★★[H] v6.560：${k} 紅`, B[k] !== true);
    }
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.561 錦標賽回放逐動作：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
