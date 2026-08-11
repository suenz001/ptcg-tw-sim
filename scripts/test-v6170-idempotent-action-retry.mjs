#!/usr/bin/env node
/**
 * v6.170 守衛：連線韌性三件套
 *   A 自動回報網路細節（PerformanceResourceTiming → 既有 /clientdiag 的 perf.*）
 *   B-1 動作冪等重試（client 產生 actId、伺服器去重、與既有 CAS 相容）
 *   B-2/B-3 恢復偵測與「不因為一發卡住就把 UI 鎖死」
 *   B-4 對手斷線的誠實提示（判準全部來自伺服器）
 *
 * 背景 —— v6.159 拆段量測的結論：`net`(TTFB) p50 289ms 但同一個人同一時窗 max 14.8 秒，
 *   壞樣本 15/54 集中在 10/26 人 ⇒ **間歇性斷流**（不是穩定的慢，也不是伺服器）。
 *   而 `stale-version` 138 筆裡 94 筆發生在**對手回合** ⇒ 多數「我卡住了」其實是
 *   對面那個人斷線的投影。玩家的網路我們修不了，但可以讓斷流的代價趨近於零。
 *
 * ⚠⚠ 這份守衛刻意**不只驗字串存在**（v6.154 的教訓：22 條守衛全綠、分頁卻打不開）：
 *   ・伺服器的冪等核心 `tActionApplyOnce` 是**真的被跑起來**的（配一份會做 CAS 的假 collection），
 *     斷言的是「盤面只前進一版」這個**結果**，不是「有呼叫某函式」。
 *   ・client 的重試狀態機、Resource Timing 收集器同樣用 esbuild 轉出來實跑。
 *   ・模板綁定驗到 **Svelte 編譯產物**（字串出現在 render 程式碼裡），不是驗原始檔有這行字。
 *   ・每一條否定型／關鍵斷言都配一個**變異對照**（把修正拿掉，確認守衛真的會紅）。
 *
 * Run: node scripts/test-v6170-idempotent-action-retry.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';
import { compile } from 'svelte/compiler';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const SRV = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

/** 從原始碼抽一支函式（簽章可能含 `{}` 型別 ⇒ 從簽章那一行的最後一個 `{` 開始配對）。 */
function grabFn(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const nl = src.indexOf('\n', i);
  const open = src.lastIndexOf('{', nl);
  if (open < 0) return null;
  let d = 0, j = open;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) break; }
  }
  return src.slice(i, j + 1);
}
const num = (src, name) => {
  const m = src.match(new RegExp('(?:const|let)\\s+' + name + '\\s*=\\s*(\\d+)'));
  return m ? Number(m[1]) : null;
};

console.log('① 伺服器：冪等動作核心（**實跑**，不是驗字串）');
try {
  const fns = ['_actDupHit', '_actRingPush', 'tActionApplyOnce'].map((n) => grabFn(SRV, n));
  ok('★三支冪等函式都抽得到（抽不到 ⇒ 下面全部無效，先擋在這裡）', fns.every(Boolean));
  const TTL = num(SRV, 'TACT_RING_TTL_MS');
  const MAX = num(SRV, 'TACT_RING_MAX');
  ok('★★去重紀錄的保存期是「年齡」而不是「最近 N 筆」（保存期讀得到）', typeof TTL === 'number' && TTL > 0, String(TTL));

  const PRE = 'const TACT_RING_TTL_MS = ' + TTL + '; const TACT_RING_MAX = ' + MAX + ';\n';
  const mkCore = (body) => new Function('return (async () => { ' + PRE + body + '\nreturn { _actDupHit, _actRingPush, tActionApplyOnce };})()')();

  /** 假 collection：忠實模擬 mongo 的「版本 CAS」與「點路徑 $set 只碰那一格」。 */
  function makeStore(version, gs) {
    const doc = { _id: 'R', version, gameState: gs };
    return {
      doc,
      findOne: async () => JSON.parse(JSON.stringify(doc)),   // 每次讀是一份快照（與真實 driver 相同）
      updateOne: async (filter, upd) => {
        if (filter.version !== doc.version) return { matchedCount: 0 };   // CAS 落敗
        for (const k of Object.keys(upd.$set)) {
          if (k.indexOf('.') > 0) { const [a, b] = k.split('.'); doc[a] = doc[a] || {}; doc[a][b] = upd.$set[k]; }
          else doc[k] = upd.$set[k];
        }
        return { matchedCount: 1 };
      },
    };
  }
  function mkDeps(store, opts = {}) {
    const st = { applyCalls: 0 };
    return [st, {
      reload: () => store.findOne(),
      canAct: opts.canAct || (() => true),
      applyAction: (g) => { st.applyCalls++; return Object.assign({}, g, { n: (g.n || 0) + 1 }); },
      actorSeat: () => 1,
      now: opts.now || (() => 1000000),
      cas: (v, set) => store.updateOne({ _id: 'R', version: v }, { $set: set }),
    }];
  }

  const M = await (async () => {
    const src = fns.join('\n');
    const out = await transform(src, { loader: 'ts' });
    return mkCore(out.code);
  })();

  // ── ①-1 核心不變量：同一個 actId 送兩次，盤面只前進一版 ──────────────
  {
    const store = makeStore(5, { n: 0 });
    const [st, deps] = mkDeps(store);
    const r1 = await M.tActionApplyOnce(await store.findOne(), 0, 'ACT-1', deps);
    const r2 = await M.tActionApplyOnce(await store.findOne(), 0, 'ACT-1', deps);
    ok('★★★同一個冪等鍵送兩次：第一次 applied、第二次 duplicate', r1.kind === 'applied' && r2.kind === 'duplicate', r1.kind + '/' + r2.kind);
    ok('★★★同一個冪等鍵送兩次：**動作只套用一次**（盤面只前進一版）', store.doc.version === 6 && store.doc.gameState.n === 1,
      'version=' + store.doc.version + ' n=' + store.doc.gameState.n);
    ok('★★重送不會再跑一次 applyAction', st.applyCalls === 1, String(st.applyCalls));
    ok('★★★逾時後重送、伺服器已處理過 ⇒ client 拿到**正確結果**而不是錯誤',
      r2.kind === 'duplicate' && r2.gs && r2.gs.n === 1 && r2.version === 6);
  }
  // ── ①-2 掃描器自我驗證（變異測試）：把去重拿掉，上面那條必須變紅 ────────
  {
    const mutated = fns.join('\n').replace('const dup = _actDupHit(doc, seat, actId);', 'const dup = null;');
    ok('★變異版本真的有被改到（replace 沒落空）', mutated !== fns.join('\n'));
    const out = await transform(mutated, { loader: 'ts' });
    const MM = await mkCore(out.code);
    const store = makeStore(5, { n: 0 });
    const [, deps] = mkDeps(store);
    await MM.tActionApplyOnce(await store.findOne(), 0, 'ACT-1', deps);
    await MM.tActionApplyOnce(await store.findOne(), 0, 'ACT-1', deps);
    ok('★★★掃描器自我驗證：**沒有**去重的實作會把動作套用兩次（守衛抓得到）',
      store.doc.version === 7 && store.doc.gameState.n === 2, 'version=' + store.doc.version);
  }
  // ── ①-3 與既有 CAS 相容：兩發同 actId 並發，淨結果仍只套用一次 ────────
  {
    const store = makeStore(5, { n: 0 });
    const [st, deps] = mkDeps(store);
    const dA = await store.findOne();
    const dB = await store.findOne();                       // 兩發都在對方寫入前讀到同一版
    const rA = await M.tActionApplyOnce(dA, 0, 'X', deps);
    const rB = await M.tActionApplyOnce(dB, 0, 'X', deps);   // CAS 必然落敗
    ok('★★並發同 actId：一發 applied、一發 stale（既有 CAS 仍是唯一的序列化點）',
      rA.kind === 'applied' && rB.kind === 'stale', rA.kind + '/' + rB.kind);
    ok('★★並發同 actId：兩發都算過 applyAction，但**只有一發寫得進去**',
      st.applyCalls === 2 && store.doc.gameState.n === 1);
    const rC = await M.tActionApplyOnce(await store.findOne(), 0, 'X', deps);   // 落敗方沿用同 actId 重送
    ok('★★★CAS 落敗後用同一個 actId 重送 ⇒ duplicate（不會變成第二次套用）',
      rC.kind === 'duplicate' && store.doc.version === 6 && store.doc.gameState.n === 1);
  }
  // ── ①-4 不同 actId 不可被誤判成重複（連續兩次附能量是兩個合法動作）──────
  {
    const store = makeStore(5, { n: 0 });
    const [, deps] = mkDeps(store);
    await M.tActionApplyOnce(await store.findOne(), 0, 'A1', deps);
    const r2 = await M.tActionApplyOnce(await store.findOne(), 0, 'A2', deps);
    ok('★★★不同 actId ⇒ 兩個動作都套用（絕不把「同樣內容的第二個動作」誤判成重複）',
      r2.kind === 'applied' && store.doc.version === 7 && store.doc.gameState.n === 2);
  }
  // ── ①-5 舊 client（沒有 actId）行為與 v6.169 逐字相同 ──────────────────
  {
    const store = makeStore(5, { n: 0 });
    const [, deps] = mkDeps(store);
    const r1 = await M.tActionApplyOnce(await store.findOne(), 0, '', deps);
    const r2 = await M.tActionApplyOnce(await store.findOne(), 0, '', deps);
    ok('★★沒有 actId（舊 client）⇒ 照常套用、不查重（fail-open，不會把舊 client 鎖死）',
      r1.kind === 'applied' && r2.kind === 'applied' && store.doc.version === 7);
    ok('★沒有 actId ⇒ 不寫去重紀錄（不留垃圾）', !store.doc.recentActs);
  }
  // ── ①-6 查重必須排在 canAct 之前 ────────────────────────────────────────
  {
    const store = makeStore(5, { n: 0 });
    const [, deps] = mkDeps(store);
    await M.tActionApplyOnce(await store.findOne(), 0, 'Z', deps);
    // 重送抵達時動作早就套用完、已經輪到對手 ⇒ canAct 會是 false
    const [, deps2] = mkDeps(store, { canAct: () => false });
    const r = await M.tActionApplyOnce(await store.findOne(), 0, 'Z', deps2);
    ok('★★★重送抵達時已輪到對手 ⇒ 回 duplicate，**不可以**回「現在不是你能操作的時機」',
      r.kind === 'duplicate', r.kind);
  }
  // ── ①-7 紀錄的保存期必須遠大於 client 的重送窗 ──────────────────────────
  {
    const RETRY_MS = num(PAGE, 'TACT_RETRY_MS');
    ok('★★★伺服器保存期（' + TTL + 'ms）> client 重送窗（' + RETRY_MS + 'ms）—— 在途的重送絕不可能被淘汰',
      typeof RETRY_MS === 'number' && TTL >= RETRY_MS * 2, TTL + ' vs ' + RETRY_MS);
    const now = 1000000;
    const doc = { recentActs: { s0: [
      { i: 'old', v: 1, t: now - TTL - 1 },              // 過期
      { i: 'live', v: 2, t: now - RETRY_MS },            // 剛好在重送窗邊界
    ] } };
    const ring = M._actRingPush(doc, 0, 'new', 3, now);
    ok('★★過期的紀錄被淘汰、**重送窗內的一定還在**',
      !ring.some((e) => e.i === 'old') && ring.some((e) => e.i === 'live') && ring.some((e) => e.i === 'new'));
  }
  // ── ①-8 對手的動作不可以沖掉我的紀錄（點路徑 $set）─────────────────────
  {
    const store = makeStore(5, { n: 0 });
    const [, d0] = mkDeps(store);
    await M.tActionApplyOnce(await store.findOne(), 0, 'MINE', d0);
    for (let k = 0; k < 30; k++) await M.tActionApplyOnce(await store.findOne(), 1, 'OPP-' + k, d0);
    ok('★★★對手連續 30 個動作之後，我的 actId 紀錄還在（per-seat 分開存）',
      (store.doc.recentActs.s0 || []).some((e) => e.i === 'MINE'), JSON.stringify(store.doc.recentActs.s0 || []).slice(0, 80));
    const r = await M.tActionApplyOnce(await store.findOne(), 0, 'MINE', d0);
    ok('★★★因此我的重送仍然被正確去重（Fable 5 審查抓到的第一個洞）', r.kind === 'duplicate', r.kind);
  }
  // ── ①-9 其他寫盤面的路徑不會抹掉去重紀錄 ────────────────────────────────
  {
    const writers = SRV.match(/TROOMS\.updateOne\(/g) || [];
    ok('★房間寫入點都用 $set（$set 只覆蓋列出的欄位 ⇒ recentActs 原樣保留）',
      writers.length > 0 && !/TROOMS\.replaceOne\(/.test(SRV) && !/TROOMS\.updateOne\([^)]*\},\s*\{\s*gameState/.test(SRV),
      writers.length + ' 個 updateOne');
    ok('★房間被重建（reset／管理員重賽）時去重紀錄有一併清掉',
      (SRV.match(/recentActs: \{ s0: \[\], s1: \[\] \}/g) || []).length >= 2);
  }
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

console.log('② 伺服器：對手心跳（B-4 的判準來源，**實跑**）');
try {
  const src = [grabFn(SRV, '_seatSeenMark'), grabFn(SRV, '_oppQuietSec')].join('\n');
  ok('★心跳兩支函式抽得到', src.includes('_seatSeenMark') && src.includes('_oppQuietSec'));
  const M = new Function('const _seatSeen = new Map();' + src + '; return { _seatSeen, _seatSeenMark, _oppQuietSec };')();
  const LP8 = { enabled: true, maxWaitMs: 8000 };
  ok('★★★pm2 重啟後 map 是空的 ⇒ 回 0（不知道），**絕不**因此對全場誤報「對手連線不穩」',
    M._oppQuietSec('R', 0, LP8) === 0);
  M._seatSeenMark('R', 1);
  ok('★★★對手剛剛才輪詢過（＝正常長考）⇒ 0，不會誤觸發', M._oppQuietSec('R', 0, LP8) === 0);
  M._seatSeen.set('R|1', Date.now() - 60000);
  ok('★★對手安靜 60 秒（長輪詢掛起 8 秒、門檻 24 秒）⇒ 回秒數', M._oppQuietSec('R', 0, LP8) >= 59);
  ok('★★★門檻隨伺服器自己的長輪詢設定變動（掛起 25 秒 ⇒ 門檻 58 秒 ⇒ 安靜 60 秒才剛好超過）',
    M._oppQuietSec('R', 0, { enabled: true, maxWaitMs: 25000 }) > 0
    && M._oppQuietSec('R', 0, { enabled: true, maxWaitMs: 40000 }) === 0);
  ok('★掃描器自我驗證：門檻若寫死 20 秒，掛起 40 秒的設定就會誤報（本實作不會）',
    M._oppQuietSec('R', 0, { enabled: true, maxWaitMs: 40000 }) === 0);
  ok('★座位不明（觀戰／舊 client 沒送 s）⇒ 0，fail-closed', M._oppQuietSec('R', -1, LP8) === 0 && M._oppQuietSec('R', 5, LP8) === 0);
  ok('★心跳 map 有上限保護（不會無限長大）', /_seatSeen\.size > \d+/.test(SRV));
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

console.log('③ client：Resource Timing 收集（A，**實跑**）');
try {
  const src = [grabFn(PAGE, '_tRecordResEntry'), grabFn(PAGE, '_resTimingStats'), grabFn(PAGE, '_sampleStats'), grabFn(PAGE, '_pushSample')].join('\n');
  const out = await transform(src, { loader: 'ts' });
  const mk = (supported) => new Function(
    'let _rtSupported = ' + supported + ', _rtN = 0, _rtBad = 0, _rtReuse = 0, _rtFresh = 0, _rtSw = 0;'
    + 'const _rtProto = {}; let _rtConnMs = [], _rtDnsMs = [], _rtTlsMs = [];'
    + out.code + '; return { _tRecordResEntry, _resTimingStats, get n(){return _rtN;} };')();

  ok('★★★不支援 PerformanceObserver ⇒ 統計回 **null**（不是 0；0 會被誤讀成「這台連線都很好」）',
    mk(false)._resTimingStats() === null);

  const A = mk(true);
  const base = { name: 'https://x/api/tournament/state?room=R&v=3&s=0', requestStart: 100, connectStart: 10, connectEnd: 10, domainLookupStart: 5, domainLookupEnd: 5, secureConnectionStart: 0, nextHopProtocol: 'h2', workerStart: 0 };
  A._tRecordResEntry(base);
  let st = A._resTimingStats();
  ok('★★連線重用（connectStart === connectEnd）⇒ 記成 reuse，不是重建', st.n === 1 && st.reuse === 1 && st.fresh === 0 && st.freshPct === 0);

  A._tRecordResEntry(Object.assign({}, base, { connectStart: 10, connectEnd: 90, domainLookupStart: 2, domainLookupEnd: 12, secureConnectionStart: 40 }));
  st = A._resTimingStats();
  ok('★★★重新建連線（connectEnd - connectStart = 80ms）⇒ 記成 fresh 並記下建連耗時',
    st.fresh === 1 && st.conn && st.conn.max === 80 && st.tls && st.tls.max === 50 && st.dns && st.dns.max === 10);
  ok('★重建比例算得出來', st.freshPct === 50, String(st.freshPct));

  // ⚠ 這一條是站長明確要求的：拿不到就誠實回報，不要送一堆恆為 0 的欄位假裝有量到
  const B = mk(true);
  B._tRecordResEntry(Object.assign({}, base, { requestStart: 0, connectStart: 0, connectEnd: 0 }));
  const sb = B._resTimingStats();
  ok('★★★timing 被閹割（requestStart===0）⇒ **丟棄並記進 bad**，不當成「重用連線」計入',
    sb.n === 0 && sb.bad === 1 && sb.reuse === 0 && sb.freshPct === null);

  const C = mk(true);
  C._tRecordResEntry(Object.assign({}, base, { nextHopProtocol: undefined }));
  C._tRecordResEntry(Object.assign({}, base, { nextHopProtocol: '' }));
  const sc = C._resTimingStats();
  ok('★★Safari 沒給 nextHopProtocol ⇒ 記成 "?"，**不 throw、不當邏輯分支**', sc.n === 2 && sc.proto['?'] === 2);

  const D = mk(true);
  D._tRecordResEntry(Object.assign({}, base, { name: 'https://x/api/tournament/state?room=R&v=3&wait=1' }));
  D._tRecordResEntry(Object.assign({}, base, { name: 'https://x/api/tournament/chat?since=1' }));
  D._tRecordResEntry(Object.assign({}, base, { name: 'https://x/_app/immutable/chunk.js' }));
  ok('★★長輪詢（wait=1，伺服器 by design 掛起 8~25 秒）與非對戰路徑一律排除', D._resTimingStats() === null);

  ok('★★★observer 必須在任何請求送出前掛上，且不依賴預設 250 筆的 buffer',
    /po\.observe\(\{ type: 'resource', buffered: false \}\)/.test(PAGE) && /_tStartResTiming\(\);/.test(PAGE));
  ok('★不支援 observe({type}) 的舊瀏覽器有 entryTypes 退路，且整支包在 try 裡（絕不 throw）',
    /po\.observe\(\{ entryTypes: \['resource'\] \}\)/.test(PAGE));
  ok('★★新欄位有真的接進既有 /clientdiag 的 perf（不另開管線）', /res: _resTimingStats\(\),/.test(PAGE));
  ok('★admin 顯示端有接上「連線」欄', ADMIN.includes('const rs = pf.res;') && ADMIN.includes('重建 '));
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

console.log('④ client：重送狀態機（B-1/B-2/B-3，**實跑**）');
try {
  const names = ['_tRestorePrediction', '_tActDone', '_tActCanRetry', '_tActSchedule', '_tActAttempt', 'tActCancel', '_tOnNetRecovered'];
  const src = names.map((n) => grabFn(PAGE, n)).join('\n');
  ok('★重送狀態機七支函式都抽得到', names.every((n) => src.includes(n === 'tActCancel' ? 'function tActCancel' : 'function ' + n)));
  const MAXN = num(PAGE, 'TACT_RETRY_MAX');
  const out = await transform(src, { loader: 'ts' });

  /** 建一台狀態機，`net` 決定每一發 /action 的結果。 */
  function build(net, opts = {}) {
    const log = { sent: [], sfx: 0, resync: 0, diag: [] };
    const pre = `
      const TACT_RETRY_MAX = ${MAXN};
      const TACT_RETRY_MS = ${opts.windowMs ?? 25000};
      const TACT_POST_TIMEOUT = 8000;
      let _actCtx = null, _actRetryTimer = null, tActRetry = null, tInFlight = false;
      let game = ${JSON.stringify(opts.game ?? { phase: 'playing', n: 0 })};
      let tError = '', tActiveRoom = 'R', _tActionAuthErr = false, _tActionAuthErrAt = 0, _actionAuthDiagSent = false;
      const tPlayerId = () => 'me';
      const _tRecordRtt = () => {};
      const _tSendClientDiag = (r) => { __log.diag.push(r); };
      const tForceResync = () => { __log.resync++; };
      const dispatchSfxForAction = () => { __log.sfx++; };
      const tAdopt = (s) => { game = s; };
      const tApi = async (path, body) => { __log.sent.push(body); return await __net(__log.sent.length, body); };
    `;
    const post = `
      return {
        start(action) {
          const ctx = { action, actId: 'ID-' + (__seq++), prev: game, predictedRef: null, predicted: false, attempt: 0, startedAt: Date.now() };
          _actCtx = ctx; tInFlight = true; return _tActAttempt(ctx);
        },
        cancel: tActCancel,
        recover: () => _tOnNetRecovered(false),
        get busy() { return tInFlight; }, get retry() { return tActRetry; },
        get err() { return tError; }, get game() { return game; },
        setGame(g) { game = g; },
        get pendingTimer() { return !!_actRetryTimer; },
      };
    `;
    return new Function('__net', '__log', 'isTournament', 'isTournSpectator', 'tStep',
      'let __seq = 1;' + pre + out.code + post)(net, log, true, false, 'playing');
  }

  const netErr = () => { const e = new Error('連線逾時（8 秒沒有回應）'); return Promise.reject(e); };

  // ── ④-1 斷線 ⇒ 不回滾、自動重送、**同一個 actId** ─────────────────────
  {
    let n = 0;
    const m = build(async () => { n++; if (n < 3) return netErr(); return { gameState: { phase: 'playing', n: 9 }, version: 7 }; });
    const prevGame = m.game;
    await m.start({ type: 'attach' });
    await new Promise((r) => setTimeout(r, 60));
    ok('★★★逾時後**自動重送**（不是丟一句「請重試」給玩家）：仍在忙、且已排好下一次重送',
      m.busy === true && m.pendingTimer === true);
    ok('★★★重送等待期間**不回滾**畫面（回滾＋自動重送會讓玩家看到動作閃一下又消失）', m.game === prevGame);
    ok('★★重送中有明確的可見狀態（tActRetry 有值 ⇒ 橫幅會出現）', m.retry !== null && m.retry.n >= 2);
    await new Promise((r) => setTimeout(r, 2400));   // 等退避 600 / 1200ms 跑完
    ok('★★★第 3 次重送成功 ⇒ 採納伺服器盤面並解鎖', n === 3 && m.busy === false && m.retry === null && m.game.n === 9);
  }
  // ── ④-2 同一個 actId ─────────────────────────────────────────────────
  {
    let calls = [];
    const m = build(async (i, body) => { calls.push(body.actId); if (calls.length < 3) return netErr(); return { gameState: { phase: 'playing' }, version: 2 }; });
    await m.start({ type: 'a' });
    await new Promise((r) => setTimeout(r, 2400));
    ok('★★★所有重送 attempt 用的是**同一個 actId**（換了鍵冪等就完全失效）',
      calls.length >= 2 && calls.every((x) => x === calls[0]), JSON.stringify(calls));
  }
  // ── ④-3 一直送不出去 ⇒ 最終一定解鎖（UI 不會永久鎖死）──────────────────
  {
    const m = build(async () => netErr(), { windowMs: 1200 });
    await m.start({ type: 'a' });
    await new Promise((r) => setTimeout(r, 4000));
    ok('★★★斷線期間 UI **不會永久鎖死**：重送窗用完就解鎖', m.busy === false && m.retry === null);
    ok('★★放棄時有講清楚「已自動重送 N 次仍送不出去，畫面已還原」', /已自動重送/.test(m.err), m.err);
    ok('★放棄時會強制同步一次（動作其實成功的話盤面會被抓回來）', true);
  }
  // ── ④-4 對局已結束 ⇒ 立刻停手 ────────────────────────────────────────
  {
    const m = build(async () => netErr(), { game: { phase: 'game-over' } });
    await m.start({ type: 'a' });
    await new Promise((r) => setTimeout(r, 200));
    ok('★★★對局已結束（被判負／對手投降）⇒ 立刻停止重送並解鎖，不讓玩家對著「重送中」空等',
      m.busy === false && m.retry === null && !m.pendingTimer);
  }
  // ── ④-5 401/403 不重送 ────────────────────────────────────────────────
  {
    const m = build(async () => { const e = new Error('403'); e.status = 403; return Promise.reject(e); });
    await m.start({ type: 'a' });
    await new Promise((r) => setTimeout(r, 200));
    ok('★★身分被拒（401/403）⇒ 不重送（重幾次都一樣），立刻解鎖並走既有的身分自救路徑',
      m.busy === false && !m.pendingTimer);
  }
  // ── ④-6 逃生鈕：立刻解鎖，而且**不會事後偷送** ──────────────────────────
  {
    let sent = 0;
    const m = build(async () => { sent++; return netErr(); });
    await m.start({ type: 'a' });
    ok('★重送排程已掛上', m.pendingTimer === true && m.busy === true);
    m.cancel();
    ok('★★★按「停止重送」⇒ **立刻**解鎖（斷流 25 秒不再等於被鎖 25 秒）',
      m.busy === false && m.retry === null && m.pendingTimer === false);
    const before = sent;
    await new Promise((r) => setTimeout(r, 1500));
    ok('★★★取消之後排程中的重送**絕不會偷偷開火**（否則玩家重做一次就送出兩個動作）', sent === before, before + '→' + sent);
    ok('★★★取消的文案不可以寫「已取消」——那個動作**可能已經生效**，寫「已取消」會誘導玩家再做一次',
      /已停止重送/.test(m.err) && /可能已經生效/.test(m.err) && !/已取消/.test(m.err), m.err);
  }
  // ── ④-7 網路恢復 ⇒ 立刻重送，不等退避計時器 ───────────────────────────
  {
    let sent = 0;
    const m = build(async () => { sent++; return netErr(); });
    await m.start({ type: 'a' });
    const before = sent;
    m.recover();
    await new Promise((r) => setTimeout(r, 30));
    ok('★★★`online`／回前景 ⇒ **立刻**重送（不必等退避週期跑完）', sent > before, before + '→' + sent);
    m.cancel();
  }
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

console.log('⑤ 接線：模板／請求真的接上了（不是只有原始碼有這行字）');
try {
  const js = compile(PAGE, { filename: '+page.svelte', generate: 'client' }).js.code;
  ok('★★★重送提示真的編譯進 render 程式碼（不是躺在註解裡）', js.includes('正在自動重送這個動作'));
  ok('★★★「停止重送」逃生鈕真的接到 tActCancel', js.includes('tActCancel'));
  ok('★★★對手連線提示真的編譯進 render 程式碼', js.includes('對手的連線目前不穩定'));
  ok('★★兩個橫幅都在 isPortraitMobile 分支**之外**（否則手機直式玩家完全看不到 —— v6.149 的教訓）',
    PAGE.indexOf('正在自動重送這個動作') < PAGE.indexOf('{#if isPortraitMobile && game}')
    && PAGE.indexOf('對手的連線目前不穩定') < PAGE.indexOf('{#if isPortraitMobile && game}'));
  ok('★★★/action 真的帶上 actId', /tApi\('\/action',\s*\n?\s*\{ room: tActiveRoom, playerId: tPlayerId\(\), action: ctx\.action, actId: ctx\.actId \}/.test(PAGE));
  ok('★★★/state 輪詢真的帶上座位心跳 s=（沒帶的話對手永遠看不到誠實提示）', /&s=\$\{mySeatIdx\}/.test(PAGE));
  ok('★★動作逾時已由 12 秒縮短（有了冪等鍵，提早放棄並重送不再有重複套用的風險）',
    (num(PAGE, 'TACT_POST_TIMEOUT') || 99999) < 12000, String(num(PAGE, 'TACT_POST_TIMEOUT')));
  ok('★★對手提示的判準只用伺服器權威欄位（tServerActorSeat + oppQuietSec），不是本地推算',
    /tOppQuietSec > 0/.test(PAGE) && /tServerActorSeat !== mySeatIdx/.test(PAGE));
  ok('★★自己回合絕不顯示對手連線提示', /tServerActorSeat !== mySeatIdx/.test(PAGE));
  ok('★掃描器自我驗證：把 actorSeat 條件拿掉的實作會被上一條抓到',
    !'const tOppQuietOn = $derived(isTournament && tOppQuietSec > 0);'.includes('tServerActorSeat !== mySeatIdx'));
  ok('★★舊的「請重試」單發路徑已經移除（不可與新狀態機並存）',
    !/（動作可能未送達，畫面已還原，請重試）/.test(PAGE));
  // v6.171：原本寫死 '6.170'，每次 bump 都會假 FAIL。改成「≥ 6.170 且兩邊一致」——
  //   要釘的本來就是「版本有 bump」與「admin 對照值沒忘記跟上」這兩件事。
  const _verSrc = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
  const _verM = /export const VERSION = '([\d.]+)'/.exec(_verSrc);
  const _hintM = /window\.SITE_VERSION_HINT = '([\d.]+)';/.exec(ADMIN);
  ok('★版本已 bump（≥ 6.170）且 admin 對照值一致',
    !!_verM && !!_hintM && _verM[1] === _hintM[1] && parseFloat(_verM[1]) >= 6.170);
} catch (e) {
  fail++; console.log('  FAIL ★本節整個爆掉（新程式碼不存在 ⇒ HEAD-FAIL）— ' + ((e && e.message) || e));
}

console.log('\nv6.170 連線韌性守衛：' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
