// v6.158 守衛：setup「誰該動作」只能有一份判準（伺服器 currentActorSeat）。
//
// 2026-08-10 錦標賽（跑 v6.156）的監控：
//   ・setup-watchdog-repeat 64 次 / 36 人
//   ・兩筆「開局卡住」指紋，兩間房完全同簽名：
//       tVersion=1, phase=setup, setupDone=[false,false],
//       pendingMulliganDraw=[2,0], mulliganRevealConfirmed=[false,true],
//       actorSeat=-1, selfPending="setup-not-done", mySeatIdx=1, rtt=null
//
// 實跑後查到的兩件事（本檔就是把它們鎖住）：
//   ① 那個 actorSeat=-1 是 **client 診斷自己算錯的**。payload 用的 tCurrentActorSeat
//      是 v5.569 的舊副本，setup 只看 setupDone ⇒ 雙方都沒完成就一律 -1。
//      同一份盤面丟進伺服器的 currentActorSeat 實跑是 **0**（引擎 line 831 / 2231：
//      pendingMulliganDraw[0]=2 ⇔ mulliganCounts=[0,2] ⇔ 座位 1 重抽了兩次
//      ⇒ 依 PTCG 規則 mulligan 較少方＝座位 0 先放戰鬥場）。
//      「-1＝沒人該動作的死角」是假訊號，會把診斷帶往完全錯誤的方向。
//   ② selfPending='setup-not-done' 是假陽性。回報者是座位 1＝重抽較多方，
//      引擎 PLACE_ACTIVE 直接擋他（myMul > oppMul && !setupDone[opp]），
//      他的 setupDone 本來就會是 false ——【規則叫他等】不是卡住。
//   ③ 真 bug：`pendingMulliganDraw[對手] > 0` 在建局當下就成立，而
//      「⏳ 等待對手決定補抽」是 position:fixed;inset:0 的全螢幕遮罩。
//      對手一按【準備完成】規則上就輪到重抽方放出場了（actorSeat 指向他），
//      遮罩卻還在 ⇒ 他什麼都按不到，伺服器同時在倒數判他閒置敗。
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
const SRV_RAW = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('  PASS', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// ── 0. 掃描器自我驗證（Rule 25：否定型掃描必須先證明註解真的被剝掉）─────────
T('掃描器自我驗證：註解確實被等長替換掉', () => {
  assert.equal(RAW.length, P.length, 'stripComments 必須等長替換（位置索引才可信）');
  assert.ok(RAW.includes('v5.569 的舊副本') || RAW.includes('v5.569 舊副本'),
    '前提：被測檔應含本版註解（用來證明剝除有效）');
  assert.ok(!P.includes('v5.569 舊副本'), '註解沒被剝掉 → 下面所有否定型斷言都不可信');
});

// ── 1. 把三個函式抽出來真的跑（不是比對字串存在）───────────────────────────
function extractFn(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `找不到 ${name}`);
  const open = src.indexOf('{', i);
  let d = 0, j = open;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) break; } }
  return src.slice(i, j + 1)
    .replace(/\)\s*:\s*[A-Za-z0-9<>|\s-]+\{/, ') {')            // 回傳型別
    .replace(/const (\w+)\s*:\s*[0-9|\s-]+=/g, 'const $1 =')     // const lessIdx: 0 | 1 =
    .replace(/([(,]\s*\w+)\s*:\s*[A-Za-z<>|\s]+/g, '$1');        // 參數型別
}
let CLI = null, cliErr = '';
try {
  CLI = new Function(
    extractFn(P, 'setupActorSeat') + '\n'
    + extractFn(P, '_setupSelfPending') + '\n'
    + extractFn(P, 'tCurrentActorSeat') + '\n'
    + 'return { setupActorSeat, _setupSelfPending, tCurrentActorSeat };')();
} catch (e) { cliErr = String((e && e.message) || e); }
const need = () => { assert.ok(CLI, 'client 三個函式抽不出來：' + cliErr); return CLI; };

// 伺服器端 currentActorSeat（唯一權威）
function extractSrvActor() {
  const i = SRV_RAW.indexOf('function currentActorSeat(gs) {');
  assert.ok(i > 0, 'server_admin_patch.js 找不到 currentActorSeat');
  const open = SRV_RAW.indexOf('{', i);
  let d = 0, j = open;
  for (; j < SRV_RAW.length; j++) { if (SRV_RAW[j] === '{') d++; else if (SRV_RAW[j] === '}') { d--; if (d === 0) break; } }
  return new Function(SRV_RAW.slice(i, j + 1) + '\nreturn currentActorSeat;')();
}
const SRV = extractSrvActor();

// ⭐ 2026-08-10 兩筆真實回報的盤面（mulliganCounts 由引擎公式反推：
//    pendingMulliganDraw[0] = max(0, m2-m1)、mulliganRevealConfirmed = [m2===0, m1===0]）
const SAMPLE = (pmd0, m1) => ({
  phase: 'setup', setupDone: [false, false],
  pendingMulliganDraw: [pmd0, 0], mulliganRevealConfirmed: [false, true],
  mulliganPostBenchOpen: [false, false], mulliganCounts: [0, m1],
});
const M12 = SAMPLE(2, 2);   // 房 mr_evt_..._r5_m12
const M20 = SAMPLE(1, 1);   // 房 mr_evt_..._r5_m20

T('⭐⭐【正對照＝真相】伺服器 currentActorSeat 對兩筆樣本都回 0（不是 -1 死角）', () => {
  assert.equal(SRV(M12), 0, 'mulligan 較少方＝座位 0 該放戰鬥場');
  assert.equal(SRV(M20), 0);
});

T('⭐⭐⭐診斷 payload 的 actorSeat 必須等於伺服器判準（舊副本會回 -1＝假死角）', () => {
  const { tCurrentActorSeat } = need();
  assert.equal(tCurrentActorSeat(M12), 0,
    'tCurrentActorSeat 仍是只看 setupDone 的舊副本 → 診斷會把「輪到對手」誤報成「沒人該動作」');
  assert.equal(tCurrentActorSeat(M20), 0);
});

T('⭐⭐⭐等待中的重抽較多方不得再被記成異常（64 次 / 36 人的假陽性來源）', () => {
  const { _setupSelfPending } = need();
  assert.equal(_setupSelfPending(M12, 1), null, '座位 1 被引擎規則擋著在等 → 不是卡住');
  assert.equal(_setupSelfPending(M20, 1), null);
  // 正對照：真的該他動作的那一方仍要標示得出來，否則就是把訊號一起關掉了
  assert.equal(_setupSelfPending(M12, 0), 'setup-not-done', '座位 0 才是該動作方');
});

T('⭐⭐「誰該動作」全 setup 狀態空間必須三方一致（只能有一份判準）', () => {
  const { setupActorSeat, tCurrentActorSeat } = need();
  const BOOL = [false, true];
  const CNT = [[0, 0], [0, 1], [1, 0], [2, 0], [0, 2], [1, 1], [3, 1]];
  let n = 0, bad = [];
  for (const sd0 of BOOL) for (const sd1 of BOOL)
    for (const mc of CNT)
      for (const pmd of [[0, 0], [Math.max(0, mc[1] - mc[0]), Math.max(0, mc[0] - mc[1])]])
        for (const mrc of [[true, true], [false, true], [true, false], [false, false]])
          for (const mpb of [[false, false], [true, false], [false, true], [true, true]]) {
            const g = { phase: 'setup', setupDone: [sd0, sd1], mulliganCounts: mc,
              pendingMulliganDraw: pmd, mulliganRevealConfirmed: mrc, mulliganPostBenchOpen: mpb };
            const s = SRV(g), a = setupActorSeat(g), c = tCurrentActorSeat(g);
            n++;
            if (a !== s || c !== s) bad.push(`${JSON.stringify([sd0, sd1, mc, pmd, mrc, mpb])} srv=${s} setupActorSeat=${a} tCurrentActorSeat=${c}`);
          }
  assert.ok(n >= 800, '狀態空間太小：' + n);
  assert.equal(bad.length, 0, `${bad.length}/${n} 組不一致，例如：\n      ` + bad.slice(0, 4).join('\n      '));
});

T('⭐_setupSelfPending 仍認得「輪到我、我確實還有事沒做」的四種待辦（沒把訊號一起關掉）', () => {
  const { _setupSelfPending } = need();
  const base = { phase: 'setup', setupDone: [true, true], mulliganCounts: [0, 0],
    pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [false, false] };
  assert.equal(_setupSelfPending({ ...base, setupDone: [true, false] }, 1), 'setup-not-done');
  assert.equal(_setupSelfPending({ ...base, pendingMulliganDraw: [0, 1] }, 1), 'mulligan-draw');
  assert.equal(_setupSelfPending({ ...base, mulliganRevealConfirmed: [true, false] }, 1), 'reveal-not-confirmed');
  assert.equal(_setupSelfPending({ ...base, mulliganPostBenchOpen: [false, true] }, 1), 'post-bench-open');
  assert.equal(_setupSelfPending({ phase: 'playing', setupDone: [false, false] }, 1), null);
  assert.equal(_setupSelfPending({ phase: 'setup', setupDone: [false, false] }, -1), null);
});

// ── 2. 行為端：全螢幕「等待對手」遮罩的顯示條件（真的求值，不是比對字串）────
function extractElseIfCond() {
  const key = "{:else if game && game.phase==='setup' && (game.pendingMulliganDraw?.[oppIdx] ?? 0) > 0";
  const i = P.indexOf(key);
  assert.ok(i > 0, '找不到「等待對手決定補抽」的 {:else if} 分支');
  const end = P.indexOf('\n', i);
  const line = P.slice(i, end).trim();
  assert.ok(line.endsWith('}'), '條件不在同一行，抽取失效：' + line.slice(-40));
  return line.slice('{:else if '.length, -1);
}
T('⭐⭐⭐全螢幕遮罩不得蓋住「規則上輪到我」的玩家（開局被判閒置敗的真兇）', () => {
  const { setupActorSeat } = need();
  const cond = extractElseIfCond();
  const show = new Function('game', 'oppIdx', 'myIdx', 'mode', 'myPlayerIndex', 'setupActorSeat',
    'return !!(' + cond + ');');
  // 我＝座位 1（重抽 2 次）。對手已按準備 ⇒ 規則上輪到我放出場（setupActorSeat=1）
  const myTurn = { phase: 'setup', setupDone: [true, false], mulliganCounts: [0, 2],
    pendingMulliganDraw: [2, 0], mulliganRevealConfirmed: [false, true], mulliganPostBenchOpen: [false, false] };
  assert.equal(setupActorSeat(myTurn), 1, '前提：這個盤面規則上該座位 1 動作');
  assert.equal(show(myTurn, 0, 1, 'online', 1, setupActorSeat), false,
    '輪到我卻還蓋著 position:fixed;inset:0 的遮罩 ⇒ 我按不到任何東西，伺服器卻在倒數判我敗');
  // 正對照：我做完了、真的在等對手決定補抽 ⇒ 遮罩必須照常顯示
  const wait = { phase: 'setup', setupDone: [true, true], mulliganCounts: [0, 2],
    pendingMulliganDraw: [2, 0], mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [false, false] };
  assert.equal(setupActorSeat(wait), 0, '前提：這個盤面該對手動作');
  assert.equal(show(wait, 0, 1, 'online', 1, setupActorSeat), true, '真的在等對手時遮罩不該消失');
  // 本機／AI 模式不受影響（原本就只在 online 顯示）
  assert.equal(show(wait, 0, 1, 'ai', 1, setupActorSeat), false);
});

// ── 3. stale-version 指紋門檻與 payload 判讀欄位 ───────────────────────────
T('⭐⭐stale-version 門檻要與 setup 指紋齊平（36 秒會把「對手長考」全報進來）', () => {
  const i = P.indexOf("_tSendClientDiag('stale-version')");
  assert.ok(i > 0, '找不到 stale-version 送出點');
  const seg = P.slice(Math.max(0, i - 400), i);
  assert.ok(/_tLastStateChangeAt\) > 60000/.test(seg),
    'stale-version 沒有 60 秒的盤面凍結門檻 —— 舊判準（連續觸發 3 次）只等於 36 秒');
  assert.ok(/_freshWatchdogFires >= 3/.test(seg), '原本的連續觸發判準不該被拿掉，只是再加一層門檻');
  assert.ok(/'playing'/.test(seg), 'stale-version 僅限 playing 階段（setup 有自己的指紋）');
});
T('⭐⭐payload 要帶得出「長考 vs 真卡住」的判讀欄位', () => {
  // ⚠ 全檔有三處 `const payload = {`，一定要先錨到 _tSendClientDiag 再往後找
  const fi = P.indexOf('function _tSendClientDiag(');
  assert.ok(fi > 0, '找不到 _tSendClientDiag');
  const i = P.indexOf('const payload = {', fi);
  assert.ok(i > fi, '找不到診斷 payload');
  // ⚠ stripComments 是等長替換，被剝掉的註解仍佔位置 → 視窗要開夠大才涵蓋 poll 區塊
  const body = P.slice(i, P.indexOf('void tApi(', i));
  assert.ok(body.length > 1500 && body.length < 9000, 'payload 區塊抽取異常：' + body.length);
  assert.ok(/sinceLastAction:/.test(body), 'payload 沒有 sinceLastAction（伺服器上多久沒人動作）');
  assert.ok(/srvActor:/.test(body), 'payload 沒有 srvActor（伺服器權威的該動作座位）');
  assert.ok(/tServerActorSeat/.test(body), 'srvActor 必須來自伺服器欄位，不能又用 client 自己推算的');
});
T('⭐看門狗自癒門檻不得被動到（這一版只改「要不要回報」與遮罩顯示）', () => {
  assert.ok(/phase === 'setup'\) \? 3500 : 20000/.test(P), 'setup 3.5s / playing 20s 的自癒門檻被改了');
});
T('⭐v6.151／v6.156 的倒數方向錨點必須完整保留', () => {
  assert.ok(P.includes("const actor = (tServerActorSeat !== undefined) ? tServerActorSeat : tCurrentActorSeat(game);"),
    '伺服器權威優先、本地推算當 fallback 的那一行不見了');
});
T('⭐admin 監控說明要跟著改（否則站長會照舊判準再誤讀一次）', () => {
  const i = ADMIN.indexOf("'stale-version': [");
  assert.ok(i > 0, '找不到 stale-version 說明');
  const seg = ADMIN.slice(i, i + 700);
  assert.ok(/60 秒/.test(seg), '說明沒提到新門檻');
  assert.ok(/長考/.test(seg), '說明沒講「對手長考也會報」這個判讀重點');
  assert.ok(/sinceLastAction/.test(seg), '說明沒指向判讀欄位');
});

// ── 4. Fable 5 審查補強①：stale-version 同一個卡住版本只回報一次 ──────────
T('⭐⭐stale-version 必須 per-stall 去重（否則一次長考就燒光每頁 3 發的診斷配額）', () => {
  const i = P.indexOf("_tSendClientDiag('stale-version')");
  assert.ok(i > 0, '找不到 stale-version 送出點');
  const seg = P.slice(Math.max(0, i - 500), i + 60);
  assert.ok(/_staleDiagVersion !== tVersion/.test(seg), '沒有「這個版本已回報過就不再送」的去重條件');
  assert.ok(seg.indexOf('_staleDiagVersion = tVersion') < seg.indexOf("_tSendClientDiag('stale-version')"),
    '去重旗標必須在送出**之前**寫入，否則早退／例外時等於沒去重');
  const li = P.indexOf('function tLeaveMatch()');
  assert.ok(/_staleDiagVersion = -1/.test(P.slice(li, li + 1200)), 'tLeaveMatch 沒有把去重旗標歸零 → 下一場漏報');
});

// ── 5. Fable 5 審查補強②：/action 被拒（401/403）不得靜默 ─────────────────
//   server_admin_patch.js：`/action` 對正式賽房要求 verified 身分（403），
//   而遮蔽關閉時 `/state` 完全不驗身分 ⇒「輪詢正常、畫面正常、動作全被拒、版本永遠不前進」。
T('⭐⭐⭐前提查證：伺服器 /action 真的會對未驗證身分回 403，而 /state 不驗', () => {
  const ai = SRV_RAW.indexOf("app.post('/api/tournament/action'");
  assert.ok(ai > 0, '找不到 /action 端點');
  const seg = SRV_RAW.slice(ai, ai + 1800);
  assert.ok(/doc\.matchId && !_id\.verified\) return res\.status\(403\)/.test(seg),
    '/action 的 verified gate 不見了 —— 下面的 client 端斷言前提就不成立了');
  const si = SRV_RAW.indexOf("app.get('/api/tournament/state'");
  assert.ok(si > 0, '找不到 /state 端點');
  // ⚠ v6.170 完整回應尾端補了 oppQuietSec（B-4 對手心跳）⇒ 舊的結尾錨點會抓到更後面的
  //   端點而讓區塊爆長。改用「/state 端點的下一個端點起點」當結尾，不再依賴回應的最後一個欄位。
  const sseg = SRV_RAW.slice(si, SRV_RAW.indexOf("app.post('/api/tournament/action'", si));
  assert.ok(sseg.length > 1000 && sseg.length < 20000, '/state 區塊抽取異常：' + sseg.length);
  assert.ok(/_redactOn\(\) \? await _viewerSeat\(req, doc\)/.test(sseg),
    '/state 的身分檢查改成無條件了？那這條路徑的前提要重新評估');
});
T('⭐⭐⭐動作被拒必須①標記②留下診斷指紋（舊版只閃一則紅字就沒了）', () => {
  // ⚠⚠ v6.170：送出與重試搬進 `_tActAttempt`（tournamentDispatch 只剩「產 actId ＋ 樂觀更新
  //   ＋ 交給狀態機」）。這條斷言的對象是**整台動作送出狀態機**，所以區間從 _tActAttempt 起算。
  const di = P.indexOf('async function _tActAttempt(');
  assert.ok(di > 0, '找不到 _tActAttempt（動作送出狀態機）');
  const body = P.slice(di, P.indexOf('async function tournamentReset()', di));
  assert.ok(body.length > 2000, '動作送出狀態機抽取異常：' + body.length);
  assert.ok(/async function tournamentDispatch\(/.test(body), '區間應涵蓋 tournamentDispatch');
  assert.ok(/e\.status === 401 \|\| e\.status === 403/.test(body), 'catch 沒有分辨「身分被拒」與一般網路錯誤');
  assert.ok(/_tActionAuthErr = true/.test(body), '沒有設身分被拒旗標 ⇒ 橫幅出不來');
  assert.ok(/_tSendClientDiag\('action-forbidden'\)/.test(body), '沒有回報診斷指紋 ⇒ 站長事後看不到');
  assert.ok(/_actionAuthDiagSent/.test(body), '指紋沒有每場一次的節流');
  // 只有「動作真的送進去」才准清旗標 —— 輪詢成功不能當身分正常的證據（/state 不驗身分）
  const clear = body.indexOf('_tActionAuthErr = false');
  const call = body.indexOf("tApi('/action'");
  assert.ok(clear > call && clear > 0, '清旗標必須在 /action 成功回應之後，實際 clear=' + clear + ' call=' + call);
  assert.ok(!/_tActionAuthErr = false/.test(P.slice(P.indexOf('function startTournamentPoll'), P.indexOf('function startTournamentPoll') + 3000)),
    '輪詢成功時清掉了身分被拒旗標 —— /state 不驗身分，它證明不了身分是好的');
});
T('⭐⭐【行為端】身分被拒時失聯橫幅必須亮，且按叉叉之後不會被輪詢成功頂回來', () => {
  const bi = P.indexOf('const tNetBannerOn = $derived(');
  assert.ok(bi > 0, '找不到 tNetBannerOn');
  const end = P.indexOf(';', P.indexOf('$derived(', bi));
  const expr = P.slice(P.indexOf('$derived(', bi) + '$derived('.length, end).replace(/\)\s*$/, '');
  const on = new Function('tOfflineSec', '_tNetBannerDismissAt', '_tLastPollOkAt', '_tActionAuthErr', '_tActionAuthErrAt',
    'return !!(' + expr + ');');
  const NOW = 1000000;
  // 輪詢完全正常（tOfflineSec=0、剛剛才成功）＋ 動作被 403 ⇒ 必須亮
  assert.equal(on(0, 0, NOW, true, NOW - 5000), true, '身分被拒卻不亮橫幅 ⇒ 玩家只會看到動作沒反應');
  // 按了叉叉（dismiss 在報錯之後）⇒ 收掉，而且**不會**因為輪詢又成功而跳回來
  assert.equal(on(0, NOW + 1, NOW + 9999, true, NOW - 5000), false, '關掉之後又被輪詢成功頂回來');
  // 沒有身分問題、輪詢也正常 ⇒ 不亮（不得誤傷正常情況）
  assert.equal(on(0, 0, NOW, false, 0), false);
  // 既有的失聯行為不得被改掉
  assert.equal(on(12, 0, NOW, false, 0), true, '原本的「失聯 10 秒以上」橫幅被改壞了');
});
T('⭐橫幅文案要先判身分被拒（那一種的自救方式不同）', () => {
  const bi = P.indexOf('net-warn-banner');
  const seg = P.slice(bi, bi + 1400);
  const a = seg.indexOf('_tActionAuthErr'), b = seg.indexOf('tAuthLost');
  assert.ok(a > 0 && b > a, '身分被拒的分支必須排在 tAuthLost 之前，實際 a=' + a + ' b=' + b);
});
T('⭐admin 監控要認得 action-forbidden，否則指紋回來也顯示成空白標題', () => {
  const i = ADMIN.indexOf("'action-forbidden': [");
  assert.ok(i > 0, 'MON_REASON_INFO 沒有 action-forbidden');
  const seg = ADMIN.slice(i, i + 600);
  assert.ok(/403/.test(seg) && /閒置判負/.test(seg), '說明沒講清楚「不是掛機、該場閒置判負要人工複核」');
});

console.log(`\n=== v6.158 setup 判準單一化: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
