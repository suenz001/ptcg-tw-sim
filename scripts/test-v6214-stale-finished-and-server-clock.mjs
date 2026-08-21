#!/usr/bin/env node
/**
 * 守衛：v6.214 ①已結束的舊局不自動採納 ②未進場容許窗（admin 可調）③伺服器單一時鐘 ④取樣率。
 *
 * ⚠⚠ 本檔的每一條「核心」斷言都必須在 v6.213（BASE）上是**紅的**（HEAD-FAIL），
 *   而每一條「正對照」都必須在 BASE 與 HEAD 上**同樣是綠的**（＝證明沒有回歸）。
 *   純字串斷言一律附一條行為端 —— 過去十一輪連續抓到「只驗字串存在」的假綠。
 *
 * Run: node scripts/test-v6214-stale-finished-and-server-clock.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-214-s.js'), E = join(ROOT, '.x-214-e.ts'), O = join(ROOT, '.x-214-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { resolveRoomUpdate, shouldSkipStalePush, isStaleFinishedGame, isOlderGame } from './src/lib/game/sync-guards';\n"
  + "export { noteServerTime, serverNowOrNull, getServerClockOffsetMs, getServerClockRttMs, __resetServerClock } from './src/lib/game/server-clock';\n"
  + "export { createGame } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { resolveRoomUpdate, shouldSkipStalePush, isStaleFinishedGame, isOlderGame,
  noteServerTime, serverNowOrNull, getServerClockOffsetMs, getServerClockRttMs, __resetServerClock, createGame } = M;

const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0; const fails = [];
const ok = (n, cond, d = '') => {
  if (cond) { pass++; console.log('  PASS ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); }
};

/**
 * 以大括號配對抽出一支函式的**真本**（不用魔術數字切窗 —— v6.213 的教訓）。
 * ⚠ v6.214 opus 審查抓到：天真的計數會被**字串／註解裡的大括號**騙走，
 *   而症狀是 `new Function` 直接 SyntaxError ⇒ 守衛「崩掉」而不是「變紅」，
 *   後面幾十條斷言整批沒跑到 —— 崩掉的腳本證明不了任何事。
 *   ⇒ 這裡逐字元跳過 '…' / "…" / `…` / // … / 區塊註解。
 */
function grabFn(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let j = src.indexOf('{', i);
  if (j < 0) return null;
  let d = 0;
  for (let k = j; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (c === '/' && n === '/') { k = src.indexOf('\n', k); if (k < 0) return null; continue; }
    if (c === '/' && n === '*') { k = src.indexOf('*/', k + 2); if (k < 0) return null; k += 1; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c;
      k++;
      for (; k < src.length; k++) {
        if (src[k] === '\\') { k++; continue; }
        if (src[k] === q) break;
      }
      continue;
    }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
/** 抽出來的真碼可能被改壞成不合法 JS ⇒ 一律包起來，讓它**變紅**而不是把腳本炸掉。 */
function safeFn(build) { try { return build(); } catch (e) { return { __err: String(e && e.message) }; } }
/** 去掉註解再數 —— 註解裡提到某個名字不算「用到它」。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1) ① 已結束的舊局不自動採納 —— 純函式行為 ＋ 三條正對照');
// ════════════════════════════════════════════════════════════════════════════
let _gid = 0;
const mkGS = (o = {}) => ({
  id: o.id ?? 'G' + (++_gid), createdAt: o.createdAt, createdAtSrv: o.createdAtSrv,
  phase: o.phase ?? 'playing',
  log: Array.from({ length: o.logLen ?? 5 }, (_, i) => ({ msg: 'l' + i })),
  setupDone: [false, false], mulliganRevealConfirmed: [false, false],
  pendingMulliganDraw: [0, 0], mulliganPostBenchOpen: [false, false],
  pendingPrizes: [0, 0], firstPlayerIdx: 0,
  players: [{ name: 'P0', prizes: [{}, {}, {}, {}, {}, {}], deck: [] },
            { name: 'P1', prizes: [{}, {}, {}, {}, {}, {}], deck: [] }],
});
const ctx = (o = {}) => ({ myPlayerIndex: o.me ?? 0, roomLastUndoApplyAt: 0, lastSeenUndoApplyAt: 0,
  roomRestartCount: 0, lastAdoptedRestartCount: 0, activeGameId: o.active });

{
  const over = mkGS({ id: 'OLD', phase: 'game-over' });
  ok('★★★[HEAD-FAIL／核心①] 本地沒有局 × incoming 是已結束的舊局 → reject（不再無條件 adopt）',
    resolveRoomUpdate(null, over, ctx()).kind === 'reject'
    && resolveRoomUpdate(null, over, ctx()).reason === 'finished-old-game',
    JSON.stringify(resolveRoomUpdate(null, over, ctx())).slice(0, 90));
  ok('★★★[HEAD-FAIL／核心①] 記得的是**別局** → 一樣 reject',
    resolveRoomUpdate(null, over, ctx({ active: 'SOMETHING-ELSE' })).kind === 'reject');

  // ── 正對照 A：重新加入「進行中」的對局仍然接得回去 ──────────────────────
  const playing = mkGS({ id: 'RUN', phase: 'playing' });
  ok('★★★[正對照①-A] 本地沒有局 × incoming 進行中 → 照舊 adopt（重新加入/重整/換裝置）',
    resolveRoomUpdate(null, playing, ctx()).kind === 'adopt');
  const setup = mkGS({ id: 'SET', phase: 'setup' });
  ok('★★★[正對照①-A2] 本地沒有局 × incoming 還在開局 → 照舊 adopt',
    resolveRoomUpdate(null, setup, ctx()).kind === 'adopt');

  // ── 正對照 B：剛結束、玩家還在該局頁面 → 終局畫面不可以消失 ─────────────
  const g1p = mkGS({ id: 'SAME', phase: 'playing', logLen: 5 });
  const g1o = mkGS({ id: 'SAME', phase: 'game-over', logLen: 9 });
  ok('★★★[正對照①-B] 本地 playing → 收到同一局的 game-over：照舊採用（否則永遠看不到勝負）',
    resolveRoomUpdate(g1p, g1o, ctx()).kind === 'adopt');
  const g1o2 = mkGS({ id: 'SAME', phase: 'game-over', logLen: 10 });
  ok('★★★[正對照①-B2] 本地已經是 game-over → 同局的 game-over 照舊採用（終局畫面不消失）',
    resolveRoomUpdate(g1o, g1o2, ctx()).kind === 'adopt');

  // ── 正對照 C：重整想看終局盤 ────────────────────────────────────────────
  ok('★★★[正對照①-C] 本地沒有局，但記得剛剛就在這一局 → adopt（重整後仍看得到終局盤）',
    resolveRoomUpdate(null, over, ctx({ active: 'OLD' })).kind === 'adopt');

  // ── 這條規則的作用範圍必須很窄：本地有局時完全不介入 ────────────────────
  ok('[範圍①] 本地有局時 isStaleFinishedGame 一律 false（不可能吃掉終局畫面）',
    isStaleFinishedGame(g1p, over, null) === false
    && isStaleFinishedGame(g1o, over, null) === false);
  ok('[範圍①] incoming 不是 game-over 時一律 false',
    isStaleFinishedGame(null, playing, null) === false
    && isStaleFinishedGame(null, setup, null) === false);
  ok('[範圍①] incoming 為 null → false（不搶 ignore 的路由）',
    isStaleFinishedGame(null, null, null) === false
    && resolveRoomUpdate(null, null, ctx()).kind === 'ignore');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2) ① 消費端接線（+page.svelte）—— 字串 ＋ **真碼行為**');
// ════════════════════════════════════════════════════════════════════════════
ok('[接線①] resolveRoomUpdate 的 ctx 真的帶了 activeGameId（不帶＝這一版等於沒做）',
  /activeGameId: _activeGameId,/.test(PAGE));
ok('[接線①] import 有補上 isStaleFinishedGame（漏 import ＝ runtime ReferenceError）',
  /import \{[^}]*isStaleFinishedGame[^}]*\} from '\$lib\/game\/sync-guards';/.test(PAGE));
{
  // ⚠ opus 審查抓到的假綠：原本只用 regex 找「有沒有出現 isStaleFinishedGame(...)」，
  //   把它改寫成 `(true || isStaleFinishedGame(...))`（＝永遠放行）照樣命中 ⇒ 守衛沒在驗任何事。
  //   ⇒ 改成把 force-adopt 那一整個 `if (...)` 的**條件式抽出來真的跑**。
  const i0 = PAGE.indexOf('      if (_forceAdoptNext) {');
  const i1 = PAGE.indexOf('if (incoming && incoming.phase', i0);
  ok('[前提①] 找得到 force-adopt 的條件式', i0 >= 0 && i1 > i0);
  if (i0 >= 0 && i1 > i0) {
    // 用括號配對取出 if 的條件（不是切固定字元數）
    let d = 0, st = PAGE.indexOf('(', i1), en = -1;
    for (let k = st; k < PAGE.length; k++) {
      if (PAGE[k] === '(') d++;
      else if (PAGE[k] === ')') { d--; if (d === 0) { en = k; break; } }
    }
    const cond = en > st ? PAGE.slice(st + 1, en) : '';
    ok('[前提①] 條件式抽得出來', cond.length > 20, cond.slice(0, 80));
    const run = safeFn(() => new Function('game', 'incoming', '_activeGameId', 'isStaleFinishedGame',
      'return (' + cond + ');'));
    ok('★★★[前提①] 條件式可以執行（抽壞／改壞一律變紅）', typeof run === 'function', run && run.__err);
    if (typeof run === 'function') {
      const over = { id: 'OLD', phase: 'game-over' };
      ok('★★★[行為①／force-adopt] 本地沒有局 × 已結束的舊局 ⇒ 條件式回 false（自癒不會變成另一個跳回舊局的入口）',
        run(null, over, null, isStaleFinishedGame) === false);
      ok('★★★[行為①／force-adopt 正對照] 記得就是這一局（重整）⇒ 條件式回 true',
        run(null, over, 'OLD', isStaleFinishedGame) === true);
      ok('★★★[行為①／force-adopt 正對照] 本地有同一局、incoming 是 playing ⇒ 照舊放行',
        run({ id: 'X', phase: 'playing' }, { id: 'X', phase: 'playing' }, null, isStaleFinishedGame) === true);
      ok('[行為①／force-adopt] setup 仍然一律不放行（v5.587 既有行為，沒被順手改掉）',
        run(null, { id: 'S', phase: 'setup' }, 'S', isStaleFinishedGame) === false);
    }
  }
}
ok('[接線①] 用 $effect 當單一接線點（逐處手動呼叫必定漏接）',
  /\$effect\(\(\) => \{ _noteActiveGame\(game\); \}\);/.test(PAGE));

{
  // ── 行為端：把兩支真碼抽出來跑（sessionStorage 用 stub）───────────────────
  const fRead = grabFn(PAGE, 'function _readActiveGameId(): string | null');
  const fNote = grabFn(PAGE, 'function _noteActiveGame(g: GameState | null): void');
  ok('[前提①] 抽得到 _readActiveGameId / _noteActiveGame 的真本', !!fRead && !!fNote);
  if (fRead && fNote) {
    const strip = (s) => s.replace(/: string \| null/g, '').replace(/: GameState \| null/g, '').replace(/: void/g, '');
    const mk = (store, opts = {}) => new Function('store', 'NOW', 'BOOM', [
      "const ACTIVE_GAME_KEY = 'ptcg:activeGameId';",
      'const ACTIVE_GAME_TTL_MS = 5 * 60 * 1000;',
      'const sessionStorage = BOOM ? { getItem(){throw new Error("denied");}, setItem(){throw new Error("denied");}, removeItem(){throw new Error("denied");} } : store;',
      'const Date = { now: () => NOW };',
      strip(fRead), 'let _activeGameId = _readActiveGameId();',
      'let _seenGameOnce = false;', strip(fNote),
      'return { read: () => _activeGameId, note: (g) => { _noteActiveGame(g); return _activeGameId; },',
      '         raw: () => store.__d[ACTIVE_GAME_KEY] };',
    ].join('\n'))(store, opts.now ?? 1_000_000, !!opts.boom);
    const mkStore = (seed) => {
      const d = Object.assign({}, seed || {});
      return { __d: d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; } };
    };
    const K = 'ptcg:activeGameId';
    // ⚠ 破壞測試的教訓：抽出來的真碼**可能會 throw**（例如有人把 try/catch 拿掉）。
    //   若讓它直接往上炸，守衛就會「崩掉」而不是「變紅」—— 崩掉的腳本證明不了任何事。
    const safe = (fn) => { try { return fn(); } catch (e) { return '__THREW__: ' + e.message; } };

    ok('★★★[行為①] 剛寫入的局：重整後（＝重新讀 sessionStorage）讀得回同一個 id',
      safe(() => mk(mkStore({ [K]: JSON.stringify({ id: 'G9', at: 1_000_000 }) })).read()) === 'G9');
    ok('★★★[行為①] 逾 TTL（5 分鐘）的記錄一律讀不回來 ⇒ 舊局不會被放行',
      safe(() => mk(mkStore({ [K]: JSON.stringify({ id: 'G9', at: 1_000_000 - 5 * 60 * 1000 - 1 }) })).read()) === null);
    ok('[行為①] 剛好等於 TTL 邊界仍算有效（>TTL 才過期）',
      safe(() => mk(mkStore({ [K]: JSON.stringify({ id: 'G9', at: 1_000_000 - 5 * 60 * 1000 }) })).read()) === 'G9');
    for (const bad of ['', 'not-json', '{}', '{"id":1,"at":2}', '{"id":"x"}', 'null']) {
      ok('[行為①] 壞掉的記錄不 throw、一律當成沒有 — ' + JSON.stringify(bad),
        safe(() => mk(mkStore({ [K]: bad })).read()) === null,
        String(safe(() => mk(mkStore({ [K]: bad })).read())));
    }
    ok('★★★[行為①] sessionStorage 被拒（無痕/配額）→ 不 throw，退化成「不記得」＝更保守',
      safe(() => mk(mkStore({}), { boom: true }).read()) === null,
      String(safe(() => mk(mkStore({}), { boom: true }).read())));
    {
      const h = safe(() => mk(mkStore({ [K]: JSON.stringify({ id: 'G9', at: 1_000_000 }) })));
      ok('★★★[行為①／關鍵] 元件剛掛載、還沒有盤面時餵 null：**不可以**清掉記憶（清了＝重整看不到終局盤）',
        typeof h === 'object' && safe(() => h.note(null)) === 'G9' && !!safe(() => h.raw()));
      safe(() => h.note({ id: 'G9' }));
      ok('★★★[行為①] 玩家真的回大廳（有過盤面之後才餵 null）→ 記憶清掉 ⇒ 之後任何舊局都被擋',
        typeof h === 'object' && safe(() => h.note(null)) === null && safe(() => h.raw()) === undefined);
    }
    {
      const h = safe(() => mk(mkStore({})));
      ok('[行為①] 採用新局會覆寫記憶（含時間戳）',
        typeof h === 'object' && safe(() => h.note({ id: 'NEW' })) === 'NEW'
        && safe(() => JSON.parse(h.raw()).id) === 'NEW' && safe(() => JSON.parse(h.raw()).at) === 1_000_000);
    }
    {
      const h = safe(() => mk(mkStore({}), { boom: true }));
      ok('[行為①] 寫入被拒時也不 throw（對戰頁不可以因為 storage 掛掉而爆炸）',
        typeof h === 'object' && safe(() => h.note({ id: 'X' })) === 'X');
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3) ② 未進場容許窗 —— 真碼抽出來跑 ＋ 兩個消費端 ＋ 差分');
// ════════════════════════════════════════════════════════════════════════════
{
  const fGrace = grabFn(SRV, 'function noShowGraceMin(evNoShowMin, tune)');
  const floorM = /const NOSHOW_FLOOR_MIN = (\d+);/.exec(SRV);
  ok('★★★[HEAD-FAIL／前提②] 抽得到中央函式 noShowGraceMin ＋ 硬地板常數', !!fGrace && !!floorM);
  if (fGrace && floorM) {
    const _built = safeFn(() => new Function('NOSHOW_FLOOR_MIN', fGrace + '\nreturn noShowGraceMin;')(Number(floorM[1])));
    ok('★★★[前提②] 抽出來的真碼可以執行（抽壞／改壞一律變紅，不可以讓腳本崩掉）',
      typeof _built === 'function', _built && _built.__err);
    const graceMin = typeof _built === 'function' ? _built : () => '__EXTRACT-FAILED__';
    const FLOOR = Number(floorM[1]);
    ok('[②] 硬地板是 2 分鐘（改小要連同這條一起想清楚）', FLOOR === 2, String(FLOOR));

    ok('★★★[正對照②] 設定關閉 ⇒ 逐字等於 v6.213 的舊式（5 分鐘 fallback）',
      graceMin(undefined, null) === 5 && graceMin(0, { enabled: false, minutes: 3 }) === 5
      && graceMin(8, { enabled: false, minutes: 3 }) === 8);
    ok('★★★[核心②] 開啟後預設 3 分鐘（賽事設定 5 分鐘 → 縮短為 3）',
      graceMin(5, { enabled: true, minutes: 3 }) === 3);
    ok('★★★[核心②／只縮不拉] 賽事自己設得更短時以賽事為準（2 分鐘不會被拉回 3）',
      graceMin(2, { enabled: true, minutes: 3 }) === 2);
    ok('★★★[核心②／地板] 設定值低於硬地板 → 夾到地板（admin 填 0.5 也不會生效）',
      graceMin(5, { enabled: true, minutes: 0.5 }) === FLOOR);
    for (const bad of [undefined, null, NaN, 0, -3, 'abc']) {
      ok('[②／誤判防護] 設定值不合法 ⇒ 回 base，**不是回 0**（回 0 ＝ 一開放就判負） — ' + String(bad),
        graceMin(5, { enabled: true, minutes: bad }) === 5);
    }
    {
      // 差分：關閉時，10 萬組隨機輸入必須與**手抄的 v6.213 舊式**逐字相同。
      const legacy = (ev) => (Number(ev) > 0 ? Number(ev) : 5);
      let diff = 0;
      for (let i = 0; i < 100000; i++) {
        const ev = [undefined, null, 0, -1, 1, 2, 3, 5, 8, 25, 'x'][i % 11];
        if (graceMin(ev, { enabled: false, minutes: 1 }) !== legacy(ev)) diff++;
        if (graceMin(ev, null) !== legacy(ev)) diff++;
      }
      ok('★★★[正對照②／差分] 灰度關閉時 10 萬組輸入與舊式**逐字相同**', diff === 0, diff + ' 組不同');
    }
    {
      // 正對照的反證：這支函式在開啟時**真的會改變結果**（否則上面那條差分是恆真式）。
      let changed = 0;
      for (const ev of [5, 8, 25]) if (graceMin(ev, { enabled: true, minutes: 3 }) !== legacyOf(ev)) changed++;
      function legacyOf(ev) { return Number(ev) > 0 ? Number(ev) : 5; }
      ok('★★★[反證②] 開啟時結果**確實不同**於舊式（證明上面的差分不是恆真式）', changed === 3, String(changed));
    }
  }
  // 兩個消費端必須都走這支（判定端 ＋ 顯示端；只改一邊＝玩家看到的倒數會說謊）
  const calls = (SRV.match(/noShowGraceMin\(/g) || []).length;
  ok('★★★[核心②／單一來源] noShowGraceMin 全檔恰好 3 處：定義 1 + 顯示端 1 + 判定端 1（多一處＝有人又抄了一份）',
    calls === 3, '實際 ' + calls + ' 處（含定義）');
  ok('★★★[HEAD-FAIL／接線②] 顯示端：/event 的 noShowDeadline 用的是 noShowGraceMin 的結果',
    /const nsMin = noShowGraceMin\(_e\.noShowMin, _nsTuneForEvent\);[\s\S]{0,700}?noShowDeadline: enterOpenAt \+ nsMin \* 60000/.test(SRV));
  ok('★★★[HEAD-FAIL／接線②] 判定端：排程器的 deadline 用的是 noShowGraceMin 的結果',
    /const nsMin = noShowGraceMin\(ev\.noShowMin, _nsTune\);\s*\n\s*const deadline = ev\.roundStartedAt \+ \(cdMin \+ nsMin\) \* 60000;/.test(SRV));
  {
    // ⚠⚠ opus 審查抓到的假綠：上面兩條只比對「有沒有出現這串字」。
    //   把原字面留著、後面**再加一行覆寫** `myMatch.noShowDeadline = …舊式…` 照樣全綠，
    //   而那正是這兩條宣稱要防的「畫面說還有 2 分鐘、伺服器已經判你輸」。
    //   ⇒ 補「這個欄位在該區塊內只被寫一次」與「兩端的算式真的跑出同一個時刻」。
    const e0 = SRV.indexOf('        let myMatch = null;');
    const e1 = SRV.indexOf('// v0.40：附上所有開放中賽事清單', e0);
    const evSeg = (e0 >= 0 && e1 > e0) ? SRV.slice(e0, e1) : '';
    const evCode = stripComments(evSeg);
    ok('[前提②] /event 的 myMatch 區塊切得出來（去註解後仍有內容）',
      evSeg.length > 500 && evCode.length > 300, 'len=' + evSeg.length + '／去註解 ' + evCode.length);
    ok('★★★[接線②／不可事後覆寫] noShowDeadline 在 /event 的 myMatch 區塊內**只出現一次**',
      (evCode.match(/noShowDeadline/g) || []).length === 1,
      '出現 ' + (evCode.match(/noShowDeadline/g) || []).length + ' 次');
    ok('★★★[接線②／不可事後覆寫] 該區塊內只有一處把分鐘換算成毫秒（60000）給 noShowDeadline 用',
      (evCode.match(/nsMin \* 60000/g) || []).length === 1);

    const s0 = SRV.indexOf('// 未進場判負：');
    const s1 = SRV.indexOf('// 閒置判負：', s0);
    const scSeg = (s0 >= 0 && s1 > s0) ? SRV.slice(s0, s1) : '';
    const scCode = stripComments(scSeg);
    ok('★★★[接線②／不可事後覆寫] 排程器那一段裡 `deadline` 只被賦值一次',
      (scCode.match(/(const|let|var)\s+deadline\s*=/g) || []).length === 1
      && (scCode.match(/\bdeadline\s*=[^=]/g) || []).length === 1,
      JSON.stringify(scCode.match(/\bdeadline\s*=[^=]/g)));

    // 行為端：把兩端的算式各自抽出來**真的跑**，證明同一組輸入算出同一個時刻。
    const evLine = /const enterOpenAt = \(_e\.roundStartedAt \|\| 0\) \+ cdMin \* 60000;/.exec(evSeg);
    const evDl = /noShowDeadline: (enterOpenAt \+ nsMin \* 60000)/.exec(evSeg);
    const scDl = /const deadline = (ev\.roundStartedAt \+ \(cdMin \+ nsMin\) \* 60000);/.exec(scSeg);
    ok('[前提②] 兩端的算式都抽得出來', !!evLine && !!evDl && !!scDl);
    if (evLine && evDl && scDl) {
      const fEv = safeFn(() => new Function('_e', 'cdMin', 'nsMin',
        evLine[0] + '\nreturn ' + evDl[1] + ';'));
      const fSc = safeFn(() => new Function('ev', 'cdMin', 'nsMin', 'return ' + scDl[1] + ';'));
      ok('★★★[前提②] 兩端算式可以執行', typeof fEv === 'function' && typeof fSc === 'function');
      if (typeof fEv === 'function' && typeof fSc === 'function') {
        let bad = 0;
        for (const rs of [0, 1_700_000_000_000, 999]) {
          for (const cd of [0, 3, 8]) {
            for (const ns of [2, 3, 5]) {
              if (fEv({ roundStartedAt: rs }, cd, ns) !== fSc({ roundStartedAt: rs }, cd, ns)) bad++;
            }
          }
        }
        ok('★★★[行為②] 27 組輸入下，玩家看到的倒數終點與伺服器判負的時刻**完全一致**',
          bad === 0, bad + ' 組不同');
      }
    }
  }
  ok('★★★[HEAD-FAIL／誤判防護②] 舊的「寫死 5 分鐘」算式已經一處都不剩',
    !/const nsMin = \(ev\.noShowMin > 0 \? ev\.noShowMin : 5\);/.test(SRV)
    && !/const nsMin = \(_e\.noShowMin > 0 \? _e\.noShowMin : 5\);/.test(SRV));
  ok('[②] 設定讀不到時傳 null ⇒ 回 base ⇒ 只會變寬鬆，不會提早判負',
    /try \{ _nsTune = await noShowConfig\(\); \} catch \(e\) \{[^}]*\}/.test(SRV)
    && /try \{ _nsTuneForEvent = await noShowConfig\(\); \} catch \(e\) \{[^}]*\}/.test(SRV));
  ok('★★★[②／admin 可調] GET/POST /api/tournament/admin/noshow 都在',
    /app\.get\('\/api\/tournament\/admin\/noshow'/.test(SRV)
    && /app\.post\('\/api\/tournament\/admin\/noshow'/.test(SRV));
  ok('[②／admin] 低於硬地板一律 400（明確拒絕，不靜默夾值）',
    /_m < NOSHOW_FLOOR_MIN \|\| _m > 60[\s\S]{0,200}?res\.status\(400\)/.test(SRV));
  ok('[②／admin] 改完立刻失效快取（不必等 10 秒）', /_nsCfgAt = 0;/.test(SRV));
  ok('[②] 預設是**開啟**（灰度旗標的例外：站長裁定要縮短，預設關著等於沒做）',
    /const TNS_DEFAULT = \{ enabled: true, minutes: 3 \};/.test(SRV)
    && /cfg\.enabled = cfg\.enabled !== false;/.test(SRV));
  ok('★★★[②／下一次調整的依據] 進場時刻 enteredAt 有被記錄（純遙測，不參與判定）',
    /\['enteredAt\.' \+ mySeat0\]: Date\.now\(\)/.test(SRV));
  {
    // ⚠ opus 審查抓到的假綠：原本直接 `SRV.slice(indexOf(A), indexOf(B))`，
    //   只要有人把註解錨點改個名，indexOf 就回 -1、slice 長度變 0、否定式恆真。
    //   ⇒ 先把錨點本身斷言起來（兩個都要找得到、而且前後順序正確、切出來的段落夠長）。
    const a0 = SRV.indexOf('// 未進場判負：'), b0 = SRV.indexOf('// 閒置判負：');
    const seg = (a0 >= 0 && b0 > a0) ? SRV.slice(a0, b0) : '';
    ok('★★★[前提②] 未進場判負那一段切得出來（錨點被改名 ⇒ 下面那條就變成恆真的空跑）',
      a0 >= 0 && b0 > a0 && seg.length > 800, 'a=' + a0 + ' b=' + b0 + ' len=' + seg.length);
    ok('★★★[②／不可污染判定] 未進場判負一段裡**不可以**出現 enteredAt（它只是遙測）',
      seg.length > 800 && !/enteredAt/.test(seg));
  }
  ok('[②／admin UI] 監控分頁有這一塊，而且按鈕接到 monSetNoShow',
    /api\('\/api\/tournament\/admin\/noshow'\)/.test(ADMIN)
    && /window\.monSetNoShow = async function/.test(ADMIN)
    && /onclick="monSetNoShow\(true, this\)"/.test(ADMIN));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4) ③ 伺服器單一時鐘 —— 行為 ＋ 相容路徑差分');
// ════════════════════════════════════════════════════════════════════════════
{
  __resetServerClock();
  ok('★★★[③] 從沒同步過 ⇒ serverNowOrNull() 為 null（呼叫端才會退回 Date.now()）',
    serverNowOrNull() === null && getServerClockOffsetMs() === null);
  const t0 = Date.now();
  ok('[③] 非 epoch 值一律拒收（例如 performance.now() 那種小數字）',
    noteServerTime(1234, t0, t0 + 10) === false && serverNowOrNull() === null);
  ok('[③] 非數字/NaN/字串一律拒收',
    noteServerTime('x', t0, t0 + 10) === false && noteServerTime(NaN, t0, t0 + 10) === false
    && noteServerTime(null, t0, t0 + 10) === false && serverNowOrNull() === null);
  ok('[③] RTT 過大（>10 秒）拒收 —— 夾不緊的樣本只會把偏移量估歪',
    noteServerTime(t0 + 60000, t0, t0 + 10001) === false && serverNowOrNull() === null);
  ok('[③] 負 RTT（時鐘在請求中途被改）拒收',
    noteServerTime(t0 + 60000, t0 + 500, t0) === false && serverNowOrNull() === null);
  {
    // 本機慢 77 秒的情境：伺服器蓋 t0+77000，往返 200ms ⇒ offset ≈ +77000（誤差 ≤ RTT/2）
    const okAccept = noteServerTime(t0 + 77000 + 100, t0, t0 + 200);
    const off = getServerClockOffsetMs();
    ok('★★★[核心③] 夾擠算得出偏移量（本機慢 77 秒 → offset ≈ +77000，誤差 ≤ RTT/2）',
      okAccept === true && Math.abs(off - 77000) <= 100, String(off));
    ok('[③] serverNowOrNull() ＝ 本機時間 + 偏移量', Math.abs(serverNowOrNull() - (Date.now() + off)) <= 2);
  }
  {
    // 只保留 RTT 最小的那一筆（不是最後一筆、也不是平均）
    const before = getServerClockOffsetMs(), rttBefore = getServerClockRttMs();
    noteServerTime(Date.now() + 999999, Date.now() - 4000, Date.now());   // RTT 4 秒，較差
    ok('★★★[③] 較差的樣本（RTT 更大）不會覆蓋較好的樣本',
      getServerClockOffsetMs() === before && getServerClockRttMs() === rttBefore);
    const n0 = Date.now();
    noteServerTime(n0 + 5000, n0, n0 + 20);                                // RTT 20ms，較好
    ok('★★★[③] 較好的樣本（RTT 更小）會取代舊的',
      Math.abs(getServerClockOffsetMs() - 5000) <= 20 && getServerClockRttMs() === 20);
  }

  // ── 相容路徑：isOlderGame ────────────────────────────────────────────────
  const legacyOlder = (a, b) => ((a?.createdAt ?? 0) < (b?.createdAt ?? 0));
  {
    let diff = 0, both = 0, srvDiff = 0;
    let x = 12345;
    const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    for (let i = 0; i < 100000; i++) {
      // ⚠ opus 審查抓到：原本只餵正整數，於是 `isFinite` / `typeof === 'number'` 兩道
      //   型別守門是零覆蓋的死碼（拿掉它們兩套守衛都全綠）。而 `createdAtSrv` 是
      //   **從房間過網回來的外部資料**，髒值正是它們存在的理由 ⇒ 分佈補上髒型別。
      const DIRTY = [NaN, Infinity, -Infinity, '123', '9', null, undefined, -1, 0, true, {}];
      const mkVal = () => {
        const r = rnd();
        if (r < 0.12) return DIRTY[Math.floor(rnd() * DIRTY.length)];
        if (r < 0.24) return 1_000_000;                    // 大量重複值 ⇒ 製造「同齡局」
        return Math.floor(rnd() * 1e13);
      };
      const mk = () => {
        const r = rnd();
        const o = {};
        if (r < 0.85) o.createdAt = mkVal();
        if (rnd() < 0.4) o.createdAtSrv = mkVal();
        return o;
      };
      const a = mk(), b = mk();
      const hasBoth = typeof a.createdAtSrv === 'number' && isFinite(a.createdAtSrv)
        && typeof b.createdAtSrv === 'number' && isFinite(b.createdAtSrv);
      if (hasBoth) {
        both++;
        // ⚠ opus 審查抓到的洞：原本這裡直接 `continue`，兩邊都有 createdAtSrv 的分支
        //   **完全沒有被差分覆蓋**（把 `a < b` 改成 `a <= b` 兩套守衛全綠）。
        //   ⇒ 改成跟手抄的伺服器時鐘式做差分，不再跳過。
        if (isOlderGame(a, b) !== (a.createdAtSrv < b.createdAtSrv)) srvDiff++;
        continue;
      }
      if (isOlderGame(a, b) !== legacyOlder(a, b)) diff++;
    }
    ok('★★★[正對照③／差分] **任一邊缺 createdAtSrv** 時，10 萬組隨機輸入與 v6.213 舊式逐字相同',
      diff === 0, diff + ' 組不同');
    ok('[前提③] 上面那份 fuzz 真的有涵蓋到「兩邊都有」的樣本（否則差分是空跑）', both > 5000, String(both));
    ok('★★★[核心③／差分] 兩邊都有 createdAtSrv 時，結果就是 `a.createdAtSrv < b.createdAtSrv`（不是 <=、不是字典序）',
      srvDiff === 0, srvDiff + ' 組不同');
  }
  ok('★★★[核心③] 兩局**都有** createdAtSrv → 用伺服器時鐘比（即使 createdAt 講反話）',
    isOlderGame({ createdAt: 9_000_000_000_000, createdAtSrv: 100 }, { createdAt: 1, createdAtSrv: 200 }) === true
    && isOlderGame({ createdAt: 1, createdAtSrv: 300 }, { createdAt: 9_000_000_000_000, createdAtSrv: 200 }) === false);
  ok('★★★[反證③] 同一組輸入在舊式下會判**相反** ⇒ 證明這一版真的改變了行為',
    legacyOlder({ createdAt: 9_000_000_000_000 }, { createdAt: 1 }) === false);
  ok('[③] 只有一邊有 createdAtSrv ⇒ 絕不拿伺服器時鐘去跟瀏覽器時鐘混著比',
    isOlderGame({ createdAt: 5, createdAtSrv: 999 }, { createdAt: 9 }) === true);
  ok('★★★[核心③／同齡局] 兩局 createdAtSrv **相等** ⇒ false（守衛的語義是「較新/同齡都採用」，`<=` 會把同齡局誤判成舊局）',
    isOlderGame({ createdAtSrv: 100 }, { createdAtSrv: 100 }) === false
    && isOlderGame({ createdAt: 5, createdAtSrv: 100 }, { createdAt: 5, createdAtSrv: 100 }) === false);
  for (const dirty of [NaN, Infinity, '123', null, true, {}]) {
    ok('★★★[核心③／型別守門] createdAtSrv 是外部資料：非有限數字一律退回 createdAt 比較 — ' + String(dirty),
      isOlderGame({ createdAt: 1, createdAtSrv: dirty }, { createdAt: 2, createdAtSrv: 5 }) === true
      && isOlderGame({ createdAt: 9, createdAtSrv: dirty }, { createdAt: 2, createdAtSrv: 5 }) === false);
  }
  ok('★★★[核心③／型別守門] 字串型 createdAtSrv 不可以走字典序（"9" < "10" 是 false ⇒ 會判反）',
    isOlderGame({ createdAt: 1, createdAtSrv: '9' }, { createdAt: 2, createdAtSrv: '10' }) === true);

  // ── 兩個消費端都收斂到 isOlderGame ──────────────────────────────────────
  const GUARD = readFileSync(join(ROOT, 'src/lib/game/sync-guards.ts'), 'utf8');
  ok('★★★[HEAD-FAIL／單一來源③] sync-guards 裡不再有任何一處手寫的 createdAt 大小比較',
    !/\(incoming\.createdAt \?\? 0\) < \(current\.createdAt \?\? 0\)/.test(GUARD)
    && !/\(incoming\.createdAt \?\? 0\) < \(local\.createdAt \?\? 0\)/.test(GUARD));
  ok('[③] 推端與收端都呼叫 isOlderGame',
    /return isOlderGame\(incoming, current\);/.test(GUARD) && /if \(isOlderGame\(incoming, local\)\)/.test(GUARD));
  {
    // 推端行為端：createdAtSrv 兩邊都有時，推端的跨局防舊也跟著改判。
    const cur = mkGS({ id: 'A', phase: 'playing', createdAt: 9_000_000_000_000, createdAtSrv: 200 });
    const inc = mkGS({ id: 'B', phase: 'playing', createdAt: 1, createdAtSrv: 100 });
    ok('★★★[行為③／推端] shouldSkipStalePush 也吃到伺服器時鐘（不是只有收端改）',
      shouldSkipStalePush(inc, cur) === true);
  }
  ok('★★★[③／leaf] server-clock.ts 除註解外零 import（循環 import ＝ v6.078 的 TDZ 炸彈）',
    !/^\s*import /m.test(readFileSync(join(ROOT, 'src/lib/game/server-clock.ts'), 'utf8')));
  ok('[③／接線] oracle-client 在房間寫入成功後對時（只採信 ok 分支）',
    /if \(res && 'ok' in res && res\.ok && res\.room\) \{[\s\S]{0,160}?_noteRoomServerTime\(\(res\.room as any\)\.updatedAt, _sentAt, Date\.now\(\)\);/.test(
      readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8')));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5) ③ engine：createGame 真的寫（或不寫）createdAtSrv');
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = join(ROOT, 'static/cards');
  const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
  const pool = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
    for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
  }
  const BASIC = '19174', ENERGY = '14128';
  const deck = { name: 'P', entries: [{ cardId: BASIC, count: 8 }, { cardId: ENERGY, count: 52 }] };

  __resetServerClock();
  const g0 = createGame(deck, deck, pool, { firstPlayerOverride: 0 });
  ok('★★★[正對照③] 沒同步過伺服器時鐘 ⇒ createGame **完全不寫** createdAtSrv（舊局格式逐字不變）',
    !('createdAtSrv' in g0), JSON.stringify(g0.createdAtSrv));
  ok('[正對照③] createdAt 仍然照舊是本機時鐘（欄位語義一個字都沒變）',
    typeof g0.createdAt === 'number' && Math.abs(g0.createdAt - Date.now()) < 60000);

  const n0 = Date.now();
  noteServerTime(n0 + 123456, n0, n0 + 20);
  const g1 = createGame(deck, deck, pool, { firstPlayerOverride: 0 });
  ok('★★★[HEAD-FAIL／核心③] 同步過之後，createGame 寫入的 createdAtSrv ＝ 伺服器時鐘',
    typeof g1.createdAtSrv === 'number' && Math.abs(g1.createdAtSrv - (Date.now() + 123456)) < 2000,
    String(g1.createdAtSrv - Date.now()));
  ok('★★★[核心③] createdAtSrv 與 createdAt **差了整個偏移量**（不是複製 Date.now()）',
    Math.abs((g1.createdAtSrv - g1.createdAt) - 123456) < 2000, String(g1.createdAtSrv - g1.createdAt));
  __resetServerClock();
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6) ④ 取樣率 0.01 → 0.1 ＋ 總量複算');
// ════════════════════════════════════════════════════════════════════════════
{
  const m = /const PERF_SAMPLE_RATE = ([0-9.]+);/.exec(PAGE);
  ok('★★★[HEAD-FAIL／核心④] PERF_SAMPLE_RATE ＝ 0.1', !!m && Number(m[1]) === 0.1, m && m[1]);
  ok('[④] 每場最多一發、且要累積 20 發成功往返（門檻沒被順手改掉）',
    /const PERF_SAMPLE_MIN_CALLS = 20;/.test(PAGE)
    && /if \(!_perfSampleArmed \|\| _perfSampleSent\) return;/.test(PAGE));
  ok('★★★[④／不可擠掉真異常] 取樣仍在 _isExempt 名單裡（不佔每頁 3 發的異常配額）',
    /const _isExempt = _isManual \|\| reason === 'stale-board-drop' \|\| reason === 'perf-sample';/.test(PAGE));
  ok('★★★[④／不可擠掉真異常] 伺服器節流是 per-(uid, reason)，取樣不會把真異常擋掉',
    /const _thKey = uid \+ '\|' \+ String\(\(req\.body && req\.body\.reason\) \|\| ''\);/.test(SRV));
  const RATE = Number(m[1]);
  const M = 150;                     // 一場賽事約 150 場對戰（v6.213 記錄）
  const BASE_WEEK = 993;             // v6.184 實測：7 天 TTL 下的異常回報總量
  const CAP = 8192;                  // v6.184：每列字元上限（不是列數上限）
  for (const E of [2, 5, 10]) {
    const add = M * RATE * E - M * 0.01 * E;
    const total = BASE_WEEK + M * RATE * E;
    console.log('  每週 ' + E + ' 場賽事 ⇒ 取樣 ' + (M * RATE * E).toFixed(0) + ' 筆/週'
      + '（比 1% 多 ' + add.toFixed(0) + ' 筆，佔既有 ' + BASE_WEEK + ' 筆的 +' + (add / BASE_WEEK * 100).toFixed(1) + '%）'
      + '；總列數 ' + total.toFixed(0) + '，最壞情況（每列都塞滿 ' + CAP + ' 字元）'
      + (total * CAP / 1048576).toFixed(1) + ' MB');
  }
  // ⚠ opus 審查抓到：原本這裡有一條「7 天常駐量 < 20 MB」的 ★★★ 斷言，
  //   但實測 RATE 從 0.01 一路開到 **1.0**（每一場都送）也只有 19.5 MB ⇒ 那條在任何 RATE 下都不會紅
  //   ＝ placebo。容量本來就不是這一版的風險點，所以把它**降級成計算輸出**，
  //   真正該釘住的是「取樣率有沒有被調到站長裁定範圍以外」。
  console.log('  ⇒ 容量：RATE=1.0（每場都送）的最壞情況也只有 '
    + ((BASE_WEEK + M * 1.0 * 10) * CAP / 1048576).toFixed(1) + ' MB ⇒ 容量從來不是這一版的限制因素。');
  ok('★★★[④／裁定範圍] 取樣率落在 0 < RATE <= 0.2（站長裁定 10%；有人偷偷開到 1.0 這條要紅）',
    RATE > 0 && RATE <= 0.2, String(RATE));
  {
    // 「8192 是每列上限、不是列數上限」—— 原本只驗兩個字串存在（`truncated` 在該檔出現 7 次，近乎恆真）。
    //   ⇒ 改成把 `_cdiagPack` 的真本抽出來跑：驗它切的是**字元**、而且切過的一定會標記。
    const fPack = grabFn(SRV, 'function _cdiagPack(');
    ok('[前提④] 抽得到 _cdiagPack 的真本', !!fPack);
    const pack = fPack ? safeFn(() => new Function(fPack + '\nreturn _cdiagPack;')()) : null;
    ok('★★★[前提④] _cdiagPack 可以執行', typeof pack === 'function', pack && pack.__err);
    if (typeof pack === 'function') {
      const small = safeFn(() => pack({ a: 'x' }));
      const huge = safeFn(() => pack({ a: 'y'.repeat(50000) }));
      ok('★★★[④／容量語義] 短 payload 不會被切、也會誠實標記 truncated=false',
        small && small.truncated === false && typeof small.s === 'string');
      ok('★★★[④／容量語義] 超長 payload 被切成 <= 8192 **字元**，而且 truncated=true、rawLen 保留原長',
        huge && huge.truncated === true && huge.s.length <= 8192 && huge.rawLen > 8192,
        huge && (huge.s.length + '／' + huge.rawLen));
    }
  }
}

console.log('\n=== v6.214 ①②③④: ' + pass + ' PASS / ' + fails.length + ' FAIL ===');
for (const f of fails) console.log('  ✗ ' + f);
console.log('=== SCRIPT-END v6214-stale-finished-and-server-clock ===');
process.exit(fails.length ? 1 : 0);
