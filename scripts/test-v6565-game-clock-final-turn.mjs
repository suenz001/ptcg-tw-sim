// ⭐v6.565 守衛：休閒線上雙方時鐘差不再灌進計時器＋終局時最後一回合算進行動方（站長 2026-10-14）
//
//   站長：「這兩個好修嗎？好修的話一起修掉，記得要審查」（v6.564 審查留下的 P2／P3）。
//   ① 休閒線上是雙方各自套用動作：回合開始時間由「結束回合的那一方」寫、下一回合由另一方減。
//      v6.564 以前 engine 一律寫本機 Date.now() ⇒ 兩台電腦的時鐘差直接進累計時間（一方多、一方少），對戰紀錄 [mm:ss] 也一樣。
//      修法：engine 的計時欄位與對戰紀錄時間戳改用 server-clock.ts 的 gameClockNow()（同步過＝伺服器時鐘；沒同步過＝Date.now()，與舊版逐字相同），
//      畫面端（+page.svelte timerNow）休閒／本機用 tickTime + getServerClockOffsetMs()（同一個時鐘）。
//   ② 引擎只有 END_TURN 才累計回合時間 ⇒ 終局那一回合永遠沒算進任何一方。
//      修法：src/lib/game/game-timer.ts computeTimerView（唯一一份）：終局時把「最後一回合開始 → 紀錄最後一筆時間戳」算給當時的行動方。
//
//   C1 ★★★ 兩台時鐘差 5 分鐘（一快一慢）的電腦輪流結束回合 ⇒ 累計＝真正經過的時間；紀錄時間戳也在伺服器時鐘上（engine 實跑）
//   C2 ★★★ 沒同步過（本機雙人／vs AI）⇒ 照舊用 Date.now()（零回歸，engine 實跑）
//   C3 ★★  gameClockNow：沒同步＝Date.now()、同步後＝Date.now()+偏移量（與 serverNowOrNull 同值）
//   C4 ★★★ computeTimerView：終局把最後一回合算給行動方（總時間 − 雙方累計＝開局準備）；紀錄時間戳不可信時用備用時刻；進行中與舊版同值
//   C5 ★★  頁面接線：休閒／本機的「現在」加同一份偏移量；錦標賽不加（另有 tClockOffset）；回放停住（實跑抽出的 timerNow）
//   C6 ★★  復盤每一格的 at 用同一個時鐘
//   C7 ★★  engine／_shared 剝註解後只剩 createdAt 一處 Date.now()（新寫的時間戳若用本機時鐘就會紅）
//   HEAD-FAIL：BASE v6.564（ea8cb15c）逐條紅。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBaseBlob, hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.564。
const BASE_SHA = 'ea8cb15c';
const normEol = (s) => String(s).replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ── 卡池（只要兩張就夠） ───────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const BIG = '10619', DEF = '13163';

async function loadLibs(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6565-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs'), S = join(tmp, 's.js');
  writeFileSync(S, 'export const base="";export const assets="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  const parts = [
    `export { createGame, applyAction } from '${p('src/lib/game/engine')}';`,
    `export * as SC from '${p('src/lib/game/server-clock')}';`,
    `export * as RR from '${p('src/lib/game/replay-record')}';`,
    `import '${p('src/lib/game/effects')}';`,
  ];
  if (existsSync(join(srcRoot, 'src/lib/game/game-timer.ts'))) parts.push(`export * as GT from '${p('src/lib/game/game-timer')}';`);
  writeFileSync(E, parts.join('\n'));
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } catch (e) { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ── 用凍結的 Date.now 跑一段 ────────────────────────────────────────────
function withClock(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return fn(); } finally { Date.now = real; }
}
const T0 = 1_800_000_000_000;   // 伺服器時間的基準（epoch ms）

function engineScenarios(L) {
  const r = {};
  if (!L || !L.createGame || !L.SC) return r;
  let nn = 0;
  const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
  const mk = (startAt) => {
    const s = L.createGame({ name: 'P1', entries: [{ cardId: BIG, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
      gameStartTime: startAt, currentTurnStartTime: startAt, playerTurnTimeMs: [0, 0],
      players: [
        { ...s.players[0], hand: [], deck: Array.from({ length: 10 }, () => inst(BIG)), discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(BIG), bench: [inst(DEF)] },
        { ...s.players[1], hand: [], deck: Array.from({ length: 10 }, () => inst(DEF)), discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: inst(BIG), bench: [inst(DEF)] }] };
  };
  // 「某台電腦」：本機時鐘＝伺服器時間 − skew；同步一次（RTT 100ms）後套用動作
  const onMachine = (skew, serverMs, fn) => {
    L.SC.__resetServerClock();
    const local = serverMs - skew;
    withClock(local, () => L.SC.noteServerTime(serverMs, local - 50, local + 50));
    return withClock(local, fn);
  };
  const origRandom = Math.random; Math.random = () => 0.99;
  try {
    // C1：A 的時鐘慢 5 分鐘、B 快 5 分鐘。P1（A）在伺服器時間 T0 開始回合，用了 60 秒結束；P2（B）用了 90 秒結束。
    const s0 = onMachine(0, T0, () => mk(T0));
    const s1 = onMachine(+300_000, T0 + 60_000, () => L.applyAction(s0, { type: 'END_TURN' }, pool));   // A 結束 P1 的回合
    const s2 = onMachine(-300_000, T0 + 150_000, () => L.applyAction(s1, { type: 'END_TURN' }, pool));  // B 結束 P2 的回合
    const t1 = s2.playerTurnTimeMs || [];
    const newLogs = (s2.log || []).slice((s0.log || []).length);
    const logTsOk = newLogs.length > 0 && newLogs.every((e) => typeof e.timestamp === 'number' && e.timestamp >= T0 + 60_000 && e.timestamp <= T0 + 150_000);
    r.C1 = Math.abs((t1[0] ?? -1) - 60_000) <= 1 && Math.abs((t1[1] ?? -1) - 90_000) <= 1
      && Math.abs((s2.currentTurnStartTime ?? 0) - (T0 + 150_000)) <= 1 && logTsOk;
    r.C1n = JSON.stringify({ t1, cts: s2.currentTurnStartTime - T0, logTs: newLogs.map((e) => e.timestamp - T0) });
    // C2：沒同步過 ⇒ 用 Date.now()（本機雙人／vs AI 與舊版逐字相同）
    L.SC.__resetServerClock();
    const u0 = withClock(T0, () => mk(T0));
    const u1 = withClock(T0 + 42_000, () => L.applyAction(u0, { type: 'END_TURN' }, pool));
    const uLogs = (u1.log || []).slice((u0.log || []).length);
    r.C2 = (u1.playerTurnTimeMs || [])[0] === 42_000 && u1.currentTurnStartTime === T0 + 42_000
      && uLogs.length > 0 && uLogs.every((e) => e.timestamp === T0 + 42_000);
    r.C2n = JSON.stringify({ t: u1.playerTurnTimeMs, cts: u1.currentTurnStartTime - T0, logTs: uLogs.map((e) => e.timestamp - T0) });
  } finally { Math.random = origRandom; L.SC.__resetServerClock(); }
  return r;
}

function clockScenarios(L) {
  const r = {};
  if (!L || !L.SC || typeof L.SC.gameClockNow !== 'function') return r;
  const SC = L.SC;
  SC.__resetServerClock();
  const a = withClock(T0, () => SC.gameClockNow());
  withClock(T0, () => SC.noteServerTime(T0 + 300_000, T0 - 40, T0 + 40));
  const b = withClock(T0 + 1000, () => SC.gameClockNow());
  const c = withClock(T0 + 1000, () => SC.serverNowOrNull());
  SC.__resetServerClock();
  r.C3 = a === T0 && b === T0 + 301_000 && c === b;
  r.C3n = JSON.stringify({ a: a - T0, b: b - T0, c: c - T0 });
  // C6：復盤每一格的 at
  withClock(T0, () => SC.noteServerTime(T0 + 300_000, T0 - 40, T0 + 40));
  const rec = L.RR.createReplayRecorder('G');
  const st = { id: 'G', phase: 'playing', turn: 1, activePlayerIndex: 0, log: [{ m: 1 }], players: [{ prizes: [], hand: [], deck: [] }, { prizes: [], hand: [], deck: [] }] };
  withClock(T0 + 5_000, () => L.RR.recordStep(rec, st));
  SC.__resetServerClock();
  r.C6 = rec.steps.length === 1 && rec.steps[0].at === T0 + 305_000;
  r.C6n = JSON.stringify(rec.steps.map((x) => x.at - T0));
  return r;
}

function timerScenarios(L) {
  const r = {};
  if (!L || !L.GT) return r;
  const V = L.GT.computeTimerView;
  const g0 = { phase: 'game-over', activePlayerIndex: 1, gameStartTime: 1_000, currentTurnStartTime: 500_000, playerTurnTimeMs: [200_000, 250_000],
    log: [{ timestamp: 1_000 }, { timestamp: 520_000 }, { timestamp: 545_000 }, { timestamp: 530_000 }] };
  // 終局：最後一回合 45 秒算給 P2（行動方）；總時間＝最後一回合開始＋最後一回合 − 開局（這組人造數字的開局空檔是 49_000；正常 engine 盤面這個空檔是 0）
  const a = V(g0, 9_999_999, null);
  // 回放：紀錄與備用時刻取較晚的（伺服器投降／閒置判負不寫紀錄，endedAt 才是真正結束）；備用較早 ⇒ 用紀錄（與即時同值）
  const b = V(g0, 9_999_999, 560_000);
  const b2 = V(g0, 9_999_999, 540_000);
  // 紀錄最後一筆比最後一回合開始還早（舊資料／別的時鐘）⇒ 不可信 ⇒ 用備用時刻；沒有備用 ⇒ 最後一回合 0（同舊版：停在最後一回合開始）
  const gOld = { ...g0, log: [{ timestamp: 400_000 }] };
  const c = V(gOld, 9_999_999, 560_000);
  const d = V(gOld, 9_999_999, null);
  // 備用時刻也比最後一回合開始還早 ⇒ 同樣不可信 ⇒ 0（審查 P2-2：原本沒有情境抓這條）
  const d2 = V(gOld, 9_999_999, 450_000);
  // 終局時行動方是 P1 ⇒ 最後一回合加在 P1（審查 P2-2：原本情境的行動方全是 P2，寫死 1 抓不到）
  const a0 = V({ ...g0, activePlayerIndex: 0 }, 9_999_999, null);
  // 進行中：與舊版公式同值（現在 − 回合開始；總時間＝現在 − 開局）
  const e = V({ ...g0, phase: 'playing' }, 530_000, null);
  // 開局準備（沒有 gameStartTime）⇒ 全 0
  const f = V({ phase: 'setup', activePlayerIndex: 0, log: [] }, 530_000, null);
  r.C4 = a.live === 45_000 && a.p0 === 200_000 && a.p1 === 295_000 && a.total === 544_000 && a.total - a.p0 - a.p1 === 49_000
    && b.live === 60_000 && b.p1 === 310_000 && b.total === 559_000 && JSON.stringify(a) === JSON.stringify(b2)
    // gameOverEndAt 直接驗（經 computeTimerView 時被 max(0,…) 夾住、看不出來）：早於最後一回合開始的時刻一律不採信
    && L.GT.gameOverEndAt(gOld, null) === null && L.GT.gameOverEndAt(gOld, 450_000) === null && L.GT.gameOverEndAt(gOld, 560_000) === 560_000 && L.GT.gameOverEndAt({ ...g0, phase: 'playing' }, 560_000) === null
    && d2.live === 0 && d2.p1 === 250_000 && a0.live === 45_000 && a0.p0 === 245_000 && a0.p1 === 250_000
    && c.live === 60_000 && c.p1 === 310_000 && c.total === 559_000
    && d.live === 0 && d.p1 === 250_000 && d.total === 499_000
    && e.live === 30_000 && e.p0 === 200_000 && e.p1 === 280_000 && e.total === 529_000
    && f.live === 0 && f.p0 === 0 && f.p1 === 0 && f.total === 0;
  r.C4n = JSON.stringify({ a, b, b2, c, d, d2, a0, e, f });
  return r;
}

function derivedExpr(pg, name) {
  const m = new RegExp('const ' + name + ' = \\$derived\\(([\\s\\S]*?)\\n  \\);').exec(pg);
  return m ? m[1] : null;
}
function pageScenarios(pg) {
  const r = {};
  const eNow = derivedExpr(pg, 'timerNow');
  if (eNow) {
    const run = (ctx) => new Function('isTReplay', 'tReplayAt', 'game', 'tickTime', 'isTournament', 'tClockOffset', 'getServerClockOffsetMs', 'return (' + eNow + ');')(
      ctx.isTReplay ?? false, ctx.tReplayAt ?? null, ctx.game ?? null, ctx.tickTime, ctx.isTournament ?? false, ctx.tClockOffset ?? 0, () => ctx.off ?? null);
    const casual = run({ tickTime: T0, off: 300_000 });
    const casualUnsynced = run({ tickTime: T0, off: null });
    const tourn = run({ tickTime: T0, isTournament: true, tClockOffset: -7_000, off: 300_000 });
    const replay = run({ tickTime: T0 + 9_999, isTReplay: true, tReplayAt: T0 - 5, off: 300_000 });
    r.C5 = casual === T0 + 300_000 && casualUnsynced === T0 && tourn === T0 - 7_000 && replay === T0 - 5
      && /import \{ getServerClockOffsetMs, gameClockNow \} from '\$lib\/game\/server-clock';/.test(pg)
      && /const timerView = \$derived\(computeTimerView\(game, timerNow, isTReplay \? tReplayAt : null\)\);/.test(pg)
      // 審查 P2-1／P3-1：對戰結果回報的時長／結束時刻、復盤 savedAt 與 gameStartTime 同一個時鐘
      && /durationMs: g\.gameStartTime \? Math\.max\(0, gameClockNow\(\) - g\.gameStartTime\) : 0,/.test(pg) && /endedAt: gameClockNow\(\),/.test(pg)
      && /appVersion: VERSION, now: gameClockNow\(\)(?: \}\);|,\s*decks: )/.test(pg);   // ⭐v6.600（Rule 40）：後面多交雙方牌組，savedAt 仍是遊戲時鐘
    r.C5n = JSON.stringify({ casual: casual - T0, casualUnsynced: casualUnsynced - T0, tourn: tourn - T0, replay: replay - T0 });
  }
  return r;
}

// 掃 src/lib/game 底下所有 .ts：紀錄時間戳不可以用本機時鐘寫（審查 P3-6：新檔／cards／room 也要守）
function libTimestampOffenders(srcRoot) {
  const out = []; let files = 0;
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, ent.name);
      if (ent.isDirectory()) { walk(f); continue; }
      if (!ent.name.endsWith('.ts')) continue;
      files++;
      let code; try { code = stripCommentsBlankChecked(normEol(readFileSync(f, 'utf8'))); } catch { out.push(f + '（剝註解失敗）'); continue; }
      if (/timestamp\s*:\s*(Date\s*\.\s*now|new\s+Date|performance\s*\.\s*now)/.test(code)) out.push(f.slice(srcRoot.length));
    }
  };
  walk(join(srcRoot, 'src/lib/game'));
  return { out, files };
}
function staticScenarios(engineSrc, sharedSrc, srcRoot) {
  const r = {};
  if (!engineSrc || !sharedSrc) return r;
  const code = (s) => stripCommentsBlankChecked(normEol(s));
  let ce, cs;
  try { ce = code(engineSrc); cs = code(sharedSrc); } catch { return r; }
  const eHits = ce.split('\n').filter((l) => l.includes('Date.now()'));
  const sHits = cs.split('\n').filter((l) => l.includes('Date.now()'));
  const tsHits = (ce.match(/timestamp: gameClockNow\(\)/g) || []).length + (cs.match(/timestamp: gameClockNow\(\)/g) || []).length;
  const lib = libTimestampOffenders(srcRoot);
  const roomTs = ['src/lib/game/room-oracle.ts', 'src/lib/game/room.ts'].map((f) => { try { return (stripCommentsBlankChecked(normEol(readFileSync(join(srcRoot, f), 'utf8'))).match(/timestamp: gameClockNow\(\)/g) || []).length; } catch { return -1; } });
  r.C7 = eHits.length === 1 && /createdAt: Date\.now\(\),/.test(eHits[0]) && sHits.length === 0 && tsHits >= 8
    && /const timerStart = gameClockNow\(\);/.test(ce) && /const _timerNowMs = gameClockNow\(\);/.test(ce)
    && lib.files > 50 && lib.out.length === 0 && roomTs[0] === 2 && roomTs[1] === 2;
  r.C7n = JSON.stringify({ engine: eHits.map((l) => l.trim().slice(0, 60)), shared: sHits.length, tsHits, libFiles: lib.files, offenders: lib.out, roomTs });
  return r;
}

const LABEL = {
  C1: '★★★ C1 兩台時鐘各差 5 分鐘的電腦輪流結束回合：累計＝真正經過的時間、回合開始與紀錄時間戳都在伺服器時鐘上（engine 實跑）',
  C2: '★★★ C2 沒同步過（本機雙人／vs AI）：照舊用本機 Date.now()（零回歸）',
  C3: '★★ C3 gameClockNow：沒同步＝Date.now()、同步後＝加上偏移量（與 serverNowOrNull 同值）',
  C4: '★★★ C4 計時器：終局把最後一回合算給行動方（總時間−雙方累計＝開局準備）、紀錄不可信用備用時刻、進行中與舊版同值',
  C5: '★★ C5 頁面「現在」：休閒／本機加同一份偏移量、錦標賽用 tClockOffset、回放停在那一格；四個數字走 computeTimerView',
  C6: '★★ C6 復盤每一格的 at 用遊戲時鐘',
  C7: '★★ C7 engine 只剩 createdAt 一處本機時鐘；src/lib/game 全部 .ts 的紀錄時間戳都不准用本機時鐘；休閒棄權／離開 4 筆紀錄有蓋遊戲時鐘',
};

const g = async (fn) => { try { const x = await fn(); return x && typeof x === 'object' ? x : {}; } catch (e) { return { _err: String(e && e.message) }; } };
async function all(srcRoot, pg, engineSrc, sharedSrc) {
  const L = await loadLibs(srcRoot);
  return { ...(await g(() => engineScenarios(L))), ...(await g(() => clockScenarios(L))), ...(await g(() => timerScenarios(L))),
    ...(await g(() => pageScenarios(pg))), ...(await g(() => staticScenarios(engineSrc, sharedSrc, srcRoot))) };
}

// C7 掃描器正對照：違規寫法一定抓得到、註解裡的不算
{
  const pos = ['{ timestamp: Date.now() }', '{ timestamp : Date . now() }', '{ timestamp: new Date().getTime() }', '{timestamp:performance.now()}'];
  const neg = ['const keepCodeHere = 1;\n// timestamp: Date.now()\n/* timestamp: Date.now() */', '{ timestamp: gameClockNow() }'];   // ⚠ 整份只有註解會被剝除器的「吐空」護欄擋下，所以前面放一行程式碼
  const hit = (x) => /timestamp\s*:\s*(Date\s*\.\s*now|new\s+Date|performance\s*\.\s*now)/.test(stripCommentsBlankChecked(x + '\n'));
  ok('★ C7 正對照：四種違規寫法都抓得到、註解與正確寫法不誤判', pos.every(hit) && !neg.some(hit), JSON.stringify({ pos: pos.map(hit), neg: neg.map(hit) }));
}
const rd = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));
const R = await all(ROOT, rd('src/routes/game/+page.svelte'), rd('src/lib/game/engine.ts'), rd('src/lib/game/effects/_shared.ts'));
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n'] ?? R._err);

console.log('【H】HEAD-FAIL（BASE v6.564）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6565 HEAD-FAIL', '需要歷史 commit');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6565b-'));
  try {
    const archive = execFileSync('git', ['-C', ROOT, 'archive', BASE_SHA, 'src/lib'], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-f', '-', '-C', tmp], { input: archive });
    const blob = (p) => normEol(readBaseBlob(ROOT, BASE_SHA, p).out || '');
    const B = await all(tmp, blob('src/routes/game/+page.svelte'), blob('src/lib/game/engine.ts'), blob('src/lib/game/effects/_shared.ts'));
    for (const k of Object.keys(LABEL)) {
      if (k === 'C2') { ok(`★★ [H] v6.564：C2 本來就綠（零回歸對照，不要求紅）`, B.C2 === true, B.C2n ?? B._err); continue; }
      ok(`★★★[H] v6.564：${k} 紅`, B[k] !== true, String(B[k]) + ' ' + (B[k + 'n'] ?? ''));
    }
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
console.log(`\n=== v6.565 遊戲時鐘／終局最後一回合：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
