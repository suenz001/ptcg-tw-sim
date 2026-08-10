// v6.155 守衛：setup 診斷指紋不得再把「等對手」當成異常；手牌可見數要含手機版。
//
// 事故（v6.154 上線後第一次看監控就撞到）：
//   `setup-watchdog-repeat` 24 小時內 **118 次 / 59 人** —— 幾乎每個參賽者都中。
//   兩筆樣本 `sincePollOk` 只有 211ms / 944ms（輪詢正常、沒斷線），
//   `sinceStateChange` 12.3s / 15.2s（伺服器盤面真的沒動）＝ 在等對方做開局選擇。
//   舊判準是「setup 期間看門狗連續觸發 2 次」＝盤面約 11.5 秒沒變（3.5s 門檻 + 8s 節流），
//   而人類看揭示、選出場、放備戰本來就超過 11.5 秒。
//   ⚠ 雜訊最大的傷害不是吵，是**把真訊號淹掉** —— 下次真的有人卡住會埋在 118 筆裡找不到。
//
// ⚠ 這批**只改「要不要回報」，不動看門狗的自癒**（setup 仍是 3.5 秒就強制重抓）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const RAW = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const P = stripComments(RAW);
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('掃描器自我驗證：註解確實被剝掉（本版註解裡寫滿 setup-watchdog-repeat 與數字）', () => {
  assert.equal(RAW.length, P.length, 'stripComments 必須等長替換');
  assert.ok(RAW.includes('118 次 / 59 人'), '前提：被測檔應含本版註解');
  assert.ok(!P.includes('118 次 / 59 人'), '註解沒被剝掉 → 下面的斷言都不可信');
});

// ── ① 行為端：_setupSelfPending 的判準 ─────────────────────────────────────
//   把中央述詞從原始碼抽出來實跑（`new Function`），不是只比對字串存在。
function extractFn(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `找不到 ${name}`);
  const open = src.indexOf('{', i);
  let d = 0, j = open;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) break; } }
  // 去掉 TS 型別標註（`: any` / `: number` / `: string | null`）讓 new Function 吃得下
  return src.slice(i, j + 1)
    .replace(/\)\s*:\s*[A-Za-z<>|\s]+\{/, ') {')
    .replace(/([(,]\s*\w+)\s*:\s*[A-Za-z<>|\s]+/g, '$1');
}
// ⚠ 抽出失敗（例如還沒實作）不能讓整支腳本 throw —— 那會變成 node crash 而不是乾淨的 FAIL，
//   HEAD-FAIL 對照時看不出是「哪幾條」該紅。改成失敗時留 null，由各條斷言各自報。
let selfPending = null, _extractErr = '';
try { selfPending = new Function(`${extractFn(P, '_setupSelfPending')}; return _setupSelfPending;`)(); }
catch (e) { _extractErr = String(e && e.message || e); }
const SP = (...a) => {
  assert.ok(selfPending, '_setupSelfPending 抽不出來或不存在：' + _extractErr);
  return selfPending(...a);
};

T('⭐⭐已經做完、純粹在等對手 → 不算異常（這正是 118 次雜訊的來源）', () => {
  const g = { phase: 'setup', setupDone: [true, true], pendingMulliganDraw: [0, 0],
    mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [true, false] };
  assert.equal(SP(g, 1), null, 'seat 1 已做完、在等 seat 0 的補抽後備戰 → 不該回報');
  assert.equal(SP(g, 0), 'post-bench-open', '正對照：seat 0 確實還有事沒做');
});
T('⭐我這邊還有動作沒做 → 四種都要認得出來', () => {
  const base = { phase: 'setup', setupDone: [true, true], pendingMulliganDraw: [0, 0],
    mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [false, false] };
  assert.equal(SP({ ...base, setupDone: [true, false] }, 1), 'setup-not-done');
  assert.equal(SP({ ...base, pendingMulliganDraw: [0, 1] }, 1), 'mulligan-draw');
  assert.equal(SP({ ...base, mulliganRevealConfirmed: [true, false] }, 1), 'reveal-not-confirmed');
  assert.equal(SP({ ...base, mulliganPostBenchOpen: [false, true] }, 1), 'post-bench-open');
});
T('⭐欄位缺席一律當「沒有待辦」（fail-closed 到不回報，寧可漏報也不製造新雜訊）', () => {
  assert.equal(SP({ phase: 'setup' }, 1), null, '整包欄位都沒有 → 不回報');
  assert.equal(SP({ phase: 'setup', setupDone: [true, true] }, 1), null);
});
T('⭐非 setup 階段 / 無效座位一律 null', () => {
  assert.equal(SP({ phase: 'playing', setupDone: [false, false] }, 1), null);
  assert.equal(SP({ phase: 'setup', setupDone: [false, false] }, -1), null, 'mySeatIdx=-1（尚未入座）不該回報');
});
T('⭐真實事故樣本重演：兩筆線上回報都必須不再觸發或標示得出原因', () => {
  // 樣本 B（Android，mySeatIdx 1）：已做完、在等對手 → 新判準必須「不回報」
  const B = { phase: 'setup', setupDone: [true, true], pendingMulliganDraw: [0, 0],
    mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [true, false] };
  assert.equal(SP(B, 1), null, '樣本 B 仍會回報 ⇒ 雜訊沒收掉');
  // 樣本 A（iPhone，mySeatIdx 1）：自己還沒確認揭示 → 仍算「我有事沒做」，
  //   但要靠 60 秒門檻擋掉「只是在讀牌」的情況（門檻由下面的靜態斷言鎖住）。
  const A = { phase: 'setup', setupDone: [false, false], pendingMulliganDraw: [0, 1],
    mulliganRevealConfirmed: [true, false], mulliganPostBenchOpen: [false, false] };
  assert.ok(SP(A, 1) !== null, '樣本 A 這一類（自己該動作）必須仍分得出來');
});

// ── ② 靜態：接線與門檻 ────────────────────────────────────────────────────
T('⭐⭐診斷判準必須同時有三個條件：我有待辦 / 60 秒門檻 / 每場一次', () => {
  const i = P.indexOf("_tSendClientDiag('setup-watchdog-repeat')");
  assert.ok(i > 0, '找不到 setup 診斷送出點');
  const seg = P.slice(Math.max(0, i - 700), i);
  assert.ok(/_setupSelfPending\(game, mySeatIdx\) !== null/.test(seg), '沒有「我這邊還有待辦」的條件');
  assert.ok(/> 60000/.test(seg), '門檻不是 60 秒（人類讀牌時間會低於它）');
  assert.ok(/!_setupDiagSent/.test(seg), '沒有「每場只報一次」的旗標');
  assert.ok(!/_freshWatchdogFires >= 2/.test(seg), '舊的「連續觸發 2 次」判準還在 → 雜訊會回來');
});
T('⭐⭐看門狗的自癒本身不得被改動（setup 仍是 3.5 秒強制重抓）', () => {
  assert.ok(/phase === 'setup'\) \? 3500 : 20000/.test(P),
    'setup 3.5 秒 / playing 20 秒的自癒門檻被動到了 —— 這批只該改「要不要回報」');
});
T('⭐⭐stale-version 指紋不得被波及（那是 v6.151 抓 playing 凍結的唯一管道）', () => {
  assert.ok(/_freshWatchdogFires >= 3[^\n]*'playing'[^\n]*_freshWatchdogVersionAt/.test(P)
    || /stale-version/.test(P), 'stale-version 判準不見了');
});
T('⭐⭐手牌可見數必須同時數桌機與手機兩套 class（手機版恆為 0 是舊版診斷的假證據）', () => {
  assert.ok(/function _countVisibleHandCards\(\)/.test(P), '沒有中央 helper');
  const i = P.indexOf('function _countVisibleHandCards()');
  const body = P.slice(i, i + 400);
  assert.ok(/\.hand-strip \.hand-card/.test(body) && /\.mp-hand-card/.test(body),
    '兩套 class 要一起數，實際：' + body.slice(0, 200));
  // 兩個消費點都要改用 helper，不能還留著只認桌機的裸查詢
  const bare = (P.match(/querySelectorAll\('\.hand-strip \.hand-card'\)/g) || []).length;
  assert.equal(bare, 0, `還有 ${bare} 處只查桌機 class 的裸 querySelectorAll`);
});
T('⭐診斷旗標必須跨場次清乾淨（殘留會讓下一場漏報）', () => {
  const i = P.indexOf('function tLeaveMatch()');
  const body = P.slice(i, i + 900);
  for (const f of ['_setupDiagSent', '_invisibleHandDiagSent']) {
    assert.ok(new RegExp(`${f} = false`).test(body), `tLeaveMatch 沒有重置 ${f}`);
  }
});
T('⭐payload 要帶 selfPending，讓「等對手」與「我卡住」日後分得出來', () => {
  assert.ok(/selfPending:/.test(P), 'payload 沒有 selfPending 欄位');
});

T('⭐⭐manual-sync 不得吃掉真異常指紋的配額（Fable 5 審查抓到的漏報路徑）', () => {
  const i = P.indexOf('function _tSendClientDiag(');
  assert.ok(i > 0, '找不到 _tSendClientDiag');
  const body = P.slice(i, i + 1400);
  assert.ok(/reason === 'manual-sync'/.test(body), 'manual-sync 沒有被特別處理');
  assert.ok(/_lastManualDiagAt/.test(body), 'manual-sync 沒有自帶節流');
  // 配額只能扣在「非 manual」分支
  const iElse = body.indexOf('} else {');
  const iCount = body.indexOf('_diagSentCount++');
  assert.ok(iElse > 0 && iCount > iElse,
    'manual-sync 仍在扣 _diagSentCount —— 玩家按三下「重新同步」就會讓所有指紋全靜音');
});
T('⭐admin 的指紋說明必須跟著改（v6.155 後語意變成「自己有待辦且 60 秒沒動」）', () => {
  const admin = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const i = admin.indexOf("'setup-watchdog-repeat'");
  assert.ok(i > 0, '找不到 setup-watchdog-repeat 的說明');
  const seg = admin.slice(i, i + 400);
  assert.ok(/60 秒/.test(seg), '說明沒提到 60 秒門檻');
  assert.ok(/等對手不會觸發/.test(seg), '說明沒講清楚「等對手不觸發」——站長會再誤判一次');
  assert.ok(/selfPending/.test(seg), '說明沒指向 selfPending 欄位');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
