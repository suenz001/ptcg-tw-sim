// ⭐⭐⭐v6.198 守衛：收緊 `stale-version` 診斷指紋的**送出判準**
//   跑法：node scripts/test-v6198-stale-version-gate.mjs
//
// 背景：舊判準＝「看門狗連續觸發 3 次 ∧ playing ∧ 版本沒前進 ∧ 盤面 60 秒沒動」。
//   拿 2026-08-16 的 7 天 dump（407 筆 / 93 人）逐筆回放，約 89% 是「有人在長考」的
//   正常等待，而且 202/407（49.6%）是同一間房雙方各報一次的鏡像重複。
//   新判準三取一（a 前景卻輪詢不通／b 伺服器動過我沒跟上／c 誰該動作認知分岔）。
//
// ⚠⚠ 這支刻意**不是**只驗字串存在（本專案反覆踩「斷言有呼叫某函式 ≠ 那件事發生了」）：
//   ①把 stale-diag.ts esbuild 剝型別後**真的跑起來**逐條求值；
//   ②把 +page.svelte 的送出點與 `_staleVersionWhyNow()` 切出來**實跑**（含「自己長考」
//     「對手長考」兩種典型假陽性情境）；
//   ③**自癒正對照** —— 用括號配對（不是 AST，別誇大）證明 tForceResync()/startTournamentPoll() 在
//     診斷 if 之外，收緊判準絕不可能讓自癒失效；
//   ④用**真實 dump 的 407 筆**（PII 已剝除的 fixture）回放，斷言命中數就是 43 筆 / 25 人；
//   ⑤admin 的新舊判準徽章與 dump 摘要的分帳函式，一律餵舊 payload 實跑。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
// ⚠ 中央模組用**容錯**讀：檔案不存在時要變成一條有名字的失敗斷言，
//   而不是整支測試在 import 階段丟 ENOENT stack（HEAD-FAIL 對照才數得出幾條）。
const DIAG = (() => { try { return readFileSync(join(ROOT, 'src/lib/tournament/stale-diag.ts'), 'utf8'); } catch { return ''; } })();
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const FIX = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/v6198-stale-version-replay.json'), 'utf8'));

let pass = 0; const fails = [];
const T = (name, fn) => { try { fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };

const ts = (s) => transformSync(s, { loader: 'ts' }).code;
/** 剝掉註解 —— 否定型斷言一律先剝，否則「註解裡提到舊寫法」會被誤判成程式碼還在用。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/** 從 `from` 起算，回傳「配對到的那一對大括號」之間（含括號）的原始碼。 */
function braceBlock(src, from, label) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, '找不到錨點（守衛需同步更新）：' + label);
  const s = src.indexOf('{', i);
  assert.ok(s > 0, '錨點後找不到 { ：' + label);
  let depth = 0;
  for (let k = s; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('大括號沒有配對：' + label);
}

// ── 0) 剝註解器自我驗證（否定型掃描的前提）────────────────────────────
T('0a 剝註解器：行註解真的被剝掉', () => {
  assert.equal(stripComments('a = 1; // tForceResync()\nb = 2;').includes('tForceResync()'), false);
});
T('0b 剝註解器：不會誤剝正常程式碼', () => {
  assert.ok(stripComments('const y = 3;\nconst z = 4;').includes('const z = 4'));
});
T('0c 剝註解器：區塊註解真的被剝掉', () => {
  assert.equal(stripComments('/* startTournamentPoll() */ const z = 1;').includes('startTournamentPoll()'), false);
});
T('0d braceBlock 自我驗證：只吃到配對的那一對', () => {
  const b = braceBlock('if (x) { a(); if (y) { b(); } c(); }\nd();', 'if (x)', 'self');
  assert.ok(b.includes('c();') && !b.includes('d();'));
});

// ── 1) 中央述詞：實跑逐條求值 ─────────────────────────────────────────
let M = null;
T('1a 中央模組可載入且匯出述詞與兩個門檻常數', () => {
  assert.ok(DIAG, '找不到 src/lib/tournament/stale-diag.ts');
  const body = ts(DIAG).replace(/export\s+/g, '')
    + '\n; return { staleVersionDiagWhy, STALE_POLL_STALL_MS, STALE_ACTION_LEAD_MS };';
  M = new Function(body)();
  assert.equal(typeof M.staleVersionDiagWhy, 'function');
  assert.equal(M.STALE_POLL_STALL_MS, 15000);
  assert.equal(M.STALE_ACTION_LEAD_MS, 15000);
});
// 一個「盤面 60 秒沒動、但三條都不成立」的基準情境：對手在長考。
const OPP_THINKING = {
  vis: 'visible', sincePollOk: 900, sinceStateChange: 65000, sinceLastAction: 64800,
  srvActor: 1, localActor: 1,
};
// 自己在長考：一樣三條都不成立（我方 client 完全健康，只是我沒出牌）。
const SELF_THINKING = {
  vis: 'visible', sincePollOk: 420, sinceStateChange: 72000, sinceLastAction: 71900,
  srvActor: 0, localActor: 0,
};
T('1b ★三條都不成立 ⇒ 不送（對手長考）', () => {
  assert.equal(M.staleVersionDiagWhy(OPP_THINKING), null);
});
T('1c ★三條都不成立 ⇒ 不送（自己長考）', () => {
  assert.equal(M.staleVersionDiagWhy(SELF_THINKING), null);
});
T('1d ★(a) 單獨成立 ⇒ 會送：前景 ∧ 輪詢 15 秒沒回應', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sincePollOk: 15000 }), 'a');
});
T('1e (a) 邊界：14999 ms 不送、15000 ms 送', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sincePollOk: 14999 }), null);
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sincePollOk: 15000 }), 'a');
});
T('1f ⭐(a) 背景頁籤不算：計時器被瀏覽器節流是正常的，不是故障', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, vis: 'hidden', sincePollOk: 999999 }), null);
});
T('1g ★(b) 單獨成立 ⇒ 會送：伺服器動過而我沒跟上 15 秒以上', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sinceStateChange: 65000, sinceLastAction: 40000 }), 'b');
});
T('1h (b) 邊界：差剛好 15000 不送（要嚴格大於）、15001 送', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sinceStateChange: 65000, sinceLastAction: 50000 }), null);
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sinceStateChange: 65001, sinceLastAction: 50000 }), 'b');
});
T('1i ⭐⭐(b) sinceLastAction 為負（裝置時鐘偏差）一律不採信 —— 否則差值必定爆表', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sinceStateChange: 65000, sinceLastAction: -11443 }), null);
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sinceStateChange: 65000, sinceLastAction: -17756357 }), null);
});
T('1j (b) sinceLastAction 為 -1（伺服器沒回 lastActionAt）也不採信', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, sinceStateChange: 65000, sinceLastAction: -1 }), null);
});
T('1k ★(c) 單獨成立 ⇒ 會送：伺服器與本地對「該誰動作」分岔', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, srvActor: 1, localActor: 0 }), 'c');
});
T('1l ⭐(c) 拿不到 srvActor（v6.157 以前 / 截斷）⇒ fail-closed 不送', () => {
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, srvActor: null, localActor: 0 }), null);
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, srvActor: undefined, localActor: 0 }), null);
  assert.equal(M.staleVersionDiagWhy({ ...OPP_THINKING, srvActor: 1, localActor: null }), null);
});
T('1m 多條同時成立 ⇒ 回傳字母串（站長要看得出是哪幾條）', () => {
  assert.equal(M.staleVersionDiagWhy({ vis: 'visible', sincePollOk: 30000, sinceStateChange: 90000, sinceLastAction: 10000, srvActor: 1, localActor: 0 }), 'abc');
});
T('1n 輸入為 null/undefined 不 throw、一律不送', () => {
  assert.equal(M.staleVersionDiagWhy(null), null);
  assert.equal(M.staleVersionDiagWhy(undefined), null);
});

// ── 2) +page.svelte 接線：把 helper 切出來實跑 ────────────────────────
const PAGE_NC = stripComments(PAGE);
let WHY = null;
T('2a `_staleVersionWhyNow()` 存在且真的呼叫中央述詞（不是自己再寫一份判準）', () => {
  const fn = braceBlock(PAGE, 'function _staleVersionWhyNow()', '_staleVersionWhyNow');
  assert.ok(stripComments(fn).includes('staleVersionDiagWhy('), '沒有呼叫中央述詞');
  // ⭐⭐每一欄都必須與診斷 payload 用**逐字同一個算式** —— 不是「有這個欄位名」而已。
  //   把 payload 區塊切出來，逐欄比對 RHS 原始碼字串；只要有人在任一邊加了偏移或改了
  //   缺值寫法（`? ... : -1`），站長拿 dump 回放就會得到與線上不同的答案。
  const pi = PAGE.indexOf('const payload = {', PAGE.indexOf('function _tSendClientDiag('));
  const pay = PAGE.slice(pi, PAGE.indexOf('void tApi(', pi));
  // helper 裡每一欄自成一行 ⇒ 抽得到乾淨的 RHS；再拿那串**原文**去 payload 裡找。
  //   payload 是一行擠好幾欄，所以用 includes 比對而不是再抽一次（抽會抽過頭）。
  for (const k of ['sincePollOk', 'sinceStateChange', 'sinceLastAction']) {
    const m = new RegExp('\\n\\s*' + k + ':\\s*([^\\n]*?),\\s*\\n').exec(fn);
    assert.ok(m, '抽不到 ' + k + ' 的運算式');
    assert.ok(pay.includes(k + ': ' + m[1].trim()),
      k + ' 的算式與 payload 不一致（站長回放 dump 會對不上）：' + m[1].trim());
  }
  for (const k of ['srvActor', 'localActor', 'vis']) assert.ok(fn.includes(k + ':'), '缺欄位 ' + k);
  // srvActor 兩邊的缺值語義必須等價：payload 寫 'n/a'、判準寫 null，都代表「拿不到」。
  assert.ok(/tServerActorSeat === undefined \? null : tServerActorSeat/.test(fn), 'srvActor 缺值語義不對');
  assert.ok(/tServerActorSeat === undefined \? 'n\/a' : tServerActorSeat/.test(pay), 'payload 的 srvActor 被改過');
  // 實跑：把它包成可注入變數的函式（TS 剝掉型別後就是純 JS）。
  const src = ts(fn).replace('function _staleVersionWhyNow()', 'function _inner()');
  WHY = new Function('staleVersionDiagWhy', 'document', '_tLastPollOkAt', '_tLastStateChangeAt',
    'tLastActionAt', 'tServerActorSeat', 'tCurrentActorSeat', 'game', 'Date',
    src + '\n; return _inner();');
});
function runWhy(o) {
  const now = 1_000_000_000_000;
  const FakeDate = { now: () => now };
  return WHY(M.staleVersionDiagWhy, { visibilityState: o.vis },
    o.sincePollOk < 0 ? 0 : now - o.sincePollOk,
    o.sinceStateChange < 0 ? 0 : now - o.sinceStateChange,
    o.sinceLastAction === -1 ? 0 : now - o.sinceLastAction,
    o.srvActor, () => o.localActor, {}, FakeDate);
}
T('2b ★行為端：對手長考 ⇒ 送出點求值為「不送」', () => {
  assert.equal(runWhy(OPP_THINKING), null);
});
T('2c ★行為端：自己長考 ⇒ 送出點求值為「不送」', () => {
  assert.equal(runWhy(SELF_THINKING), null);
});
T('2d ★行為端：(a) 前景 15 秒輪詢不通 ⇒ 送', () => {
  assert.equal(runWhy({ ...OPP_THINKING, sincePollOk: 16000 }), 'a');
});
T('2e ★行為端：(b) 真漏接 ⇒ 送', () => {
  assert.equal(runWhy({ ...OPP_THINKING, sinceStateChange: 65000, sinceLastAction: 30000 }), 'b');
});
T('2f ★行為端：(c) 該誰動作分岔 ⇒ 送', () => {
  assert.equal(runWhy({ ...OPP_THINKING, srvActor: 1, localActor: 0 }), 'c');
});
T('2g ⭐tServerActorSeat 為 undefined（v6.157 以前的伺服器）不得被當成 0', () => {
  assert.equal(runWhy({ ...OPP_THINKING, srvActor: undefined, localActor: 0 }), null);
});

// ── 3) ⭐⭐⭐自癒正對照：收緊診斷絕不可以動到自救 ─────────────────────
T('3a ★★★自癒 tForceResync()/startTournamentPoll() 必須在診斷 if **之外**', () => {
  const i = PAGE_NC.indexOf("_tSendClientDiag('stale-version')");
  assert.ok(i > 0, '找不到 stale-version 送出點');
  // 從送出點往回找它所屬的最外層 if（＝新鮮度看門狗那一段）的收尾，
  // 再確認 tForceResync/startTournamentPoll 在「診斷 if」關掉之後才出現。
  const j = PAGE_NC.indexOf('tForceResync();', i);
  const k = PAGE_NC.indexOf('startTournamentPoll();', i);
  assert.ok(j > i && k > j, '看門狗結尾的自癒兩行不見了');
  const between = PAGE_NC.slice(i, j);
  // 診斷 if 必須在自癒之前就收掉：兩者之間的 '}' 要多於 '{'。
  const open = (between.match(/\{/g) || []).length;
  const close = (between.match(/\}/g) || []).length;
  assert.ok(close > open, '自癒兩行看起來被包進了診斷 if 裡（close=' + close + ' open=' + open + '）');
});
T('3b ★★★自癒不得被任何 staleWhy 判準 gate 住', () => {
  const i = PAGE_NC.indexOf("_tSendClientDiag('stale-version')");
  const j = PAGE_NC.indexOf('startTournamentPoll();', i);
  assert.ok(i >= 0 && j > i, 'anchor（stale-version 診斷／startTournamentPoll）失效 ⇒ 下面的否定斷言會恆真（v6.323 fail-open 同型修正）');
  const seg = PAGE_NC.slice(i, j);
  const fr = seg.indexOf('tForceResync');
  assert.ok(fr >= 0, 'anchor tForceResync 不在區段內 ⇒ 下面的否定斷言會恆真（v6.323 fail-open 同型修正）');
  assert.equal(/_staleVersionWhyNow\s*\(/.test(seg.slice(fr)), false,
    '自癒與判準之間出現了新的耦合');
});
T('3c 新鮮度看門狗本身的門檻一個字都沒動（20 秒 / setup 3.5 秒 / 8 秒節流）', () => {
  assert.ok(PAGE_NC.includes("(game && game.phase === 'setup') ? 3500 : 20000"), '看門狗門檻被動到了');
  assert.ok(PAGE_NC.includes('(Date.now() - _tLastForceResyncAt) > 8000'), '看門狗節流被動到了');
});
T('3d 舊有的四道前置條件仍在（收緊是「再加一道」，不是「換掉」）', () => {
  const i = PAGE_NC.indexOf("_tSendClientDiag('stale-version')");
  const seg = PAGE_NC.slice(Math.max(0, i - 900), i);
  assert.ok(seg.includes('_freshWatchdogFires >= 3'), '少了連續觸發 3 次');
  assert.ok(seg.includes("game.phase === 'playing'"), '少了 playing 限制');
  assert.ok(seg.includes('tVersion === _freshWatchdogVersionAt'), '少了版本沒前進');
  assert.ok(seg.includes('> 60000'), '少了 60 秒門檻');
  assert.ok(seg.includes('_staleDiagVersion !== tVersion'), '少了 per-stall 去重');
});
T('3e ⭐判準不成立時**不**設 _staleDiagVersion（否則條件 a 之後累積起來就永遠報不出來）', () => {
  const i = PAGE_NC.indexOf('const _why = _staleVersionWhyNow();');
  assert.ok(i > 0, '找不到判準求值');
  const j = PAGE_NC.indexOf('tForceResync();', i);
  const seg = PAGE_NC.slice(i, j);
  const a = seg.indexOf('if (_why)');
  const b = seg.indexOf('_staleDiagVersion = tVersion');
  assert.ok(a >= 0 && b > a, '_staleDiagVersion 被設在 if (_why) 之外');
});
T('3f payload 帶上 staleWhy 與 oppQuiet（站長判讀與鏡像回報的替代欄位）', () => {
  assert.ok(PAGE_NC.includes("staleWhy: (reason === 'stale-version' ? _staleDiagWhy : null)"), 'staleWhy 沒接上');
  assert.ok(PAGE_NC.includes('oppQuiet: tOppQuietSec'), 'oppQuiet 沒接上');
});

// ── 4) ⭐⭐⭐真實 dump 回放（407 筆，PII 已剝除）────────────────────────
T('4a fixture 完整：407 筆 / 93 人（＝舊判準在那 7 天送出的全部）', () => {
  assert.equal(FIX.meta.rows, 407);
  assert.equal(FIX.rows.length, 407);
  assert.equal(new Set(FIX.rows.map((r) => r.who)).size, 93);
});
let REPLAY = null;   // 4b 實際算出來的結果，4c 直接用它（不可以再寫死字面量）
T('4b ★★★新判準回放：命中 43 筆 / 25 人（a 39、b 4、c 2 且 c 全被 a 涵蓋）', () => {
  let a = 0, b = 0, c = 0;
  const hitUsers = new Set(); let hits = 0;
  for (const r of FIX.rows) {
    const why = M.staleVersionDiagWhy({
      vis: r.vis ?? null,
      sincePollOk: typeof r.sincePollOk === 'number' ? r.sincePollOk : -1,
      sinceStateChange: typeof r.sinceStateChange === 'number' ? r.sinceStateChange : -1,
      sinceLastAction: typeof r.sinceLastAction === 'number' ? r.sinceLastAction : -1,
      srvActor: typeof r.srvActor === 'number' ? r.srvActor : null,
      localActor: typeof r.actorSeat === 'number' ? r.actorSeat : null,
    });
    if (!why) continue;
    hits++; hitUsers.add(r.who);
    if (why.includes('a')) a++;
    if (why.includes('b')) b++;
    if (why.includes('c')) c++;
  }
  assert.equal(a, 39, 'a 類命中數變了：' + a);
  assert.equal(b, 4, 'b 類命中數變了：' + b);
  assert.equal(c, 2, 'c 類命中數變了：' + c);
  assert.equal(hits, 43, '總命中數變了：' + hits);
  assert.equal(hitUsers.size, 25, '受影響人數變了：' + hitUsers.size);
  REPLAY = { hits, users: hitUsers.size, a, b, c };
});
T('4c ★收緊後降幅（用 4b **實算**的結果，不可以寫死字面量）', () => {
  assert.ok(REPLAY, '4b 沒有跑出結果');
  const pct = Math.round((1 - REPLAY.hits / FIX.rows.length) * 1000) / 10;
  assert.equal(pct, 89.4, '降幅變了：' + pct + '%');
  // c 全部被 a 涵蓋 ⇒ 三條的「單獨貢獻」相加會大於總命中數（重複計算），差額必須正好是 2。
  assert.equal(REPLAY.a + REPLAY.b + REPLAY.c - REPLAY.hits, 2, 'a/b/c 的重疊關係變了');
});
T('4d ⭐被截斷（parse 不出來）的 21 筆一律判不出條件 ⇒ 不送，且不可被誤判成命中', () => {
  const un = FIX.rows.filter((r) => !r.parsed);
  assert.equal(un.length, 21);
  for (const r of un) {
    // ⚠ 餵**這一列自己的**欄位（截斷列一律抽不到，所以全是 null／'(absent)'）——
    //   餵常數的話這 21 次等於同一個斷言重跑 21 遍，沒有驗到資料。
    assert.equal(r.vis, null, '截斷列不該抽得到 vis');
    assert.equal(M.staleVersionDiagWhy({
      vis: r.vis ?? null,
      sincePollOk: typeof r.sincePollOk === 'number' ? r.sincePollOk : -1,
      sinceStateChange: typeof r.sinceStateChange === 'number' ? r.sinceStateChange : -1,
      sinceLastAction: typeof r.sinceLastAction === 'number' ? r.sinceLastAction : -1,
      srvActor: typeof r.srvActor === 'number' ? r.srvActor : null,
      localActor: typeof r.actorSeat === 'number' ? r.actorSeat : null,
    }), null);
  }
});

// ── 5) 新舊 client 混雜：admin 徽章 + dump 分帳，一律實跑 ───────────────
let BADGE = null;
T('5a admin 的 monStaleBadge() 可切出並實跑', () => {
  const fn = braceBlock(ADMIN, 'function monStaleBadge(r)', 'monStaleBadge');
  BADGE = new Function('escapeHtml', fn + '\n; return monStaleBadge;')((x) => String(x));
  assert.equal(typeof BADGE, 'function');
});
T('5b ★新 client（payload 有 poll.staleWhy）標「新判準 a」', () => {
  const out = BADGE({ reason: 'stale-version', diag: JSON.stringify({ poll: { staleWhy: 'a' } }) });
  assert.ok(out.includes('新判準') && out.includes('a'), out);
});
T('5c ★★舊 client（v6.197 以前，整包沒有 staleWhy 這個 key）標「舊判準」', () => {
  const out = BADGE({ reason: 'stale-version', diag: JSON.stringify({ poll: { srvActor: 1, sinceLastAction: 60000 } }) });
  assert.ok(out.includes('舊判準'), out);
  assert.equal(out.includes('新判準'), false);
});
T('5d ⭐被截斷的列標「判準不明」，**不可以**被當成舊判準', () => {
  const out = BADGE({ reason: 'stale-version', diag: '{"poll":{"srvAct' });
  assert.ok(out.includes('判準不明'), out);
  assert.equal(out.includes('舊判準'), false);
});
T('5e-2 ⭐⭐有 staleWhy 這個 key 但值為空 ⇒ admin 與 dump 必須同調（都算新判準）', () => {
  const out = BADGE({ reason: 'stale-version', diag: JSON.stringify({ poll: { staleWhy: null } }) });
  assert.ok(out.includes('新判準'), '空值被 admin 判成「不是新判準」，與 dump 的 staleGateOf 不一致：' + out);
  assert.equal(out.includes('舊判準'), false, out);
});
T('5e 其他 reason 不標徽章（不干擾既有畫面）', () => {
  assert.equal(BADGE({ reason: 'slow-rtt', diag: '{}' }), '');
  assert.equal(BADGE(null), '');
});

let DUMP = null;
T('5f dump-client-monitor.cjs 匯出 staleGateOf / oppQuietOf', () => {
  DUMP = require_(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'));
  assert.equal(typeof DUMP.staleGateOf, 'function');
  assert.equal(typeof DUMP.oppQuietOf, 'function');
});
T('5g ★dump 分帳：new / legacy / unknown 三種必須分得出來', () => {
  assert.deepEqual(DUMP.staleGateOf('stale-version', { poll: { staleWhy: 'ab' } }, true), { gate: 'new', why: 'ab' });
  assert.deepEqual(DUMP.staleGateOf('stale-version', { poll: { srvActor: 1 } }, true), { gate: 'legacy', why: null });
  assert.deepEqual(DUMP.staleGateOf('stale-version', null, false), { gate: 'unknown', why: null });
  assert.equal(DUMP.staleGateOf('slow-rtt', { poll: {} }, true), null);
});
T('5h ⭐新 client 但其他指紋：staleWhy 為 null 仍算 new（欄位在就是新 bundle）', () => {
  assert.deepEqual(DUMP.staleGateOf('stale-version', { poll: { staleWhy: null } }, true), { gate: 'new', why: null });
});
T('5i ⭐oppQuietOf：欄位缺席回 null（「不知道」），不是 0（「對手正常」）', () => {
  assert.equal(DUMP.oppQuietOf({ poll: { srvActor: 1 } }), null);
  assert.equal(DUMP.oppQuietOf({ poll: { oppQuiet: 0 } }), 0);
  assert.equal(DUMP.oppQuietOf({ poll: { oppQuiet: 42 } }), 42);
  assert.equal(DUMP.oppQuietOf(null), null);
});
T('5j dump 摘要真的有把兩批分開列出來（否則站長會把數字加在一起）', () => {
  const SRC = readFileSync(join(ROOT, 'oracle-admin/tournament/dump-client-monitor.cjs'), 'utf8');
  assert.ok(SRC.includes('②-b'), '摘要沒有新的分帳段落');
  assert.ok(SRC.includes('staleTally.uidsNew.size'), '分帳沒有算人數');
  assert.ok(SRC.includes('②-c'), '摘要沒有對手掉線段落');
});

// ── 6) 版本 ────────────────────────────────────────────────────────────
T('6a version.ts 與 admin.html 的版本提示同步', () => {
  const V = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8').match(/VERSION = '([\d.]+)'/)[1];
  assert.ok(Number(V) >= 6.198, '版本不得倒退（本守衛自 v6.198 起生效）：' + V);
  assert.ok(ADMIN.includes("window.SITE_VERSION_HINT = '" + V + "';"),
    'admin.html 的 SITE_VERSION_HINT 沒跟著 version.ts bump（version.ts=' + V + '）');
});

console.log('\n通過 ' + pass + ' 項' + (fails.length ? '，失敗 ' + fails.length + ' 項' : ''));
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
