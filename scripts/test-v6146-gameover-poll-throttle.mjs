// v6.146 守衛：錦標賽對戰**結束後**不得再以全速輪詢／不得再週期性強抓全量盤面。
//
// 事故（站長轉述營運端觀測，我方逐行查證）：
//   勝負視窗出現後沒有自動跳轉（設計如此，玩家要自己按「返回賽事大廳」），
//   但 client 的三條迴圈完全沒有把 `phase === 'game-over'` 當一回事：
//     ① 主輪詢 setInterval 1200ms → 一直打 /state
//     ② 輪詢停擺看門狗（6 秒沒成功回應）→ 抓 v=-1 全量
//     ③ 新鮮度看門狗（8 秒盤面沒動）→ 抓 v=-1 全量，而 tForceResync 末尾**無條件**把
//        _tLastStateChangeAt 推到現在 ⇒「8 秒 stale → resync → 重設計時 → 再 8 秒」無限迴圈
//   實測一場賽事三場對戰同時掛著，5 分鐘 819 個無效 request。
//   ④ 觀戰輪詢 2000ms 在 done 之後照樣每 2 秒下載一整份 redact 盤面。
//
// ⚠ 判準是**降頻不是停**：`winner == null` 的平手要「等待管理員裁定」，
//   裁定會改伺服器盤面 —— 完全 clearInterval 會讓那些玩家永遠等不到結果。
//
// ⚠⚠ 這張網一律在**剝掉註解後**的原始碼上比對：本檔與被測檔的註解裡都寫滿了
//   'game-over'，不剝的話每一條斷言都會被註解餵成假綠（v6.139 踩過同款）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

/** 剝掉 // 行註解、/* 區塊註解 *​/ 與 <!-- --> 模板註解（換成等長空白，行號不變） */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const SRC = stripComments(RAW);

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
/** 取兩個錨點之間的片段；任一錨點失效就直接錯（禁止 slice(-1) 靜默變成整份檔案） */
function sliceBetween(src, a, b) {
  const i = src.indexOf(a); assert.ok(i >= 0, `錨點失效（可能被重構）：${a}`);
  const j = src.indexOf(b, i + a.length); assert.ok(j > i, `結束錨點失效：${b}`);
  return src.slice(i, j);
}

T('⭐掃描器自我驗證：stripComments 真的有剝掉註解（否則整張網是假綠）', () => {
  const probe = stripComments("const a = 1; // game-over 註解\n/* game-over 區塊 */\n<!-- game-over 模板 -->\nconst b = 2;");
  assert.ok(!probe.includes('game-over'), '註解沒被剝掉');
  assert.ok(probe.includes('const a = 1;') && probe.includes('const b = 2;'), '把程式碼一起剝掉了');
  assert.ok(RAW.length === SRC.length, 'stripComments 必須等長替換（行號/位移要對得起來）');
  assert.ok(RAW.includes('是降頻不是停'), '前提：被測檔應含本版註解（錨點過期請更新）');
  assert.ok(!SRC.includes('是降頻不是停'), '被測檔的註解沒被剝掉 → 下面的斷言都不可信');
});

T('⭐⭐輪詢節奏必須收斂在單一中央述詞 tPollDesiredMs（v6.148 從「每 N 輪」改成時間判準）', () => {
  const fn = sliceBetween(SRC, 'function tPollDesiredMs(', '\n  function startTournamentPoll()');
  assert.ok(/phase\s*===\s*'game-over'/.test(fn), '中央述詞沒有判 game-over');
  assert.ok(/winner\s*==\s*null/.test(fn), '沒有區分「平手待管理員裁定」與「已分勝負」的頻率');
  assert.ok(/6000\s*:\s*12000/.test(fn), 'game-over 的降頻數值不見了（平手 6s／有勝負 12s）');
  const body = sliceBetween(SRC, 'function startTournamentPoll()', '}, 400);');
  assert.ok(/tPollDesiredMs\(false\)/.test(body), '主輪詢沒有走中央節奏述詞');
  assert.ok(!/clearInterval\s*\(\s*tPollTimer\s*\)/.test(body.slice(body.indexOf('setInterval'))),
    '不可在輪詢回呼內 clearInterval —— 平手待裁定的玩家會永遠等不到裁定結果');
});

T('⭐⭐輪詢停擺看門狗（6 秒）：對戰結束後不得再抓 v=-1 全量盤面', () => {
  // ⚠ 錨點只取「不會因為換行/加條件而變動」的最短片段（v6.149 把這個 if 拆成多行時，
  //   原本含 `&&` 的長錨點就失效了 —— 守衛應該鎖語義，不是鎖排版）。
  const seg = sliceBetween(SRC, "(Date.now() - _tLastPollOkAt) > 6000", 'startTournamentPoll();');
  const cond = SRC.slice(SRC.indexOf("if (tStep === 'playing' && game &&", SRC.indexOf('notifyScan([], tMyMatch, tNow);')), SRC.indexOf('_tLastPollOkAt = Date.now();  '));
  assert.ok(/_tOver/.test(cond), '條件沒有排除 game-over（缺 !_tOver）');
  assert.ok(seg.includes('v=-1'), '前提：這條看門狗確實會抓 v=-1（錨點還對）');
});

T('⭐⭐新鮮度看門狗（8 秒）：對戰結束後不得再週期性 tForceResync', () => {
  const seg = sliceBetween(SRC, 'const _freshStaleMs', 'tForceResync();');
  assert.ok(/_tOver/.test(seg), '條件沒有排除 game-over（缺 !_tOver）→ 會形成 8 秒一次 v=-1 的無限迴圈');
  assert.ok(/_tLastForceResyncAt\)\s*>\s*8000/.test(seg), '前提：節流條件還在（錨點還對）');
});

T('⭐_tOver 必須是「當下盤面」算出來的，不能是殘留旗標', () => {
  const m = SRC.match(/const _tOver\s*=\s*([^\n;]+);/);
  assert.ok(m, '找不到 _tOver 定義');
  assert.ok(/game/.test(m[1]) && /game-over/.test(m[1]), `_tOver 應由 game.phase 即時算出，實際：${m[1].trim()}`);
});

T('⭐觀戰輪詢：對戰結束後必須降頻（伺服器對 /spectate/state 一律回全量 redact 盤面）', () => {
  const body = sliceBetween(SRC, 'function startSpectatePoll()', '}, 400);');
  assert.ok(/tPollDesiredMs\(true\)/.test(body), '觀戰輪詢沒有走中央節奏述詞');
  const fn = sliceBetween(SRC, 'function tPollDesiredMs(', '\n  function startTournamentPoll()');
  assert.ok(/spectate\)\s*return 10000/.test(fn), '觀戰在 game-over 後的降頻數值不見了');
});

T('⭐離場路徑仍然要真的停 timer（降頻不能取代停止）', () => {
  for (const fn of ['function tLeaveMatch()', 'function tLeaveSpectate()']) {
    const body = sliceBetween(SRC, fn, 'tStep = ');
    assert.ok(/clearInterval\(tPollTimer\)/.test(body), `${fn} 沒有 clearInterval(tPollTimer)`);
    assert.ok(/tPollGen\+\+/.test(body), `${fn} 沒有 tPollGen++（in-flight 回應會把玩家彈回對戰）`);
  }
});

T('⭐⭐v6.148 C4：輪詢不得自我壅塞（上一發沒回就跳過本 tick，主輪詢與觀戰都要）', () => {
  for (const [name, open, close, flag] of [
    ['主輪詢', 'function startTournamentPoll()', '}, 400);', '_pollBusy'],
    ['觀戰輪詢', 'function startSpectatePoll()', '}, 400);', '_spBusy'],
  ]) {
    const body = sliceBetween(SRC, open, close);
    assert.ok(new RegExp(`if \\(${flag}\\) return;`).test(body), `${name} 沒有 in-flight 早退`);
    assert.ok(new RegExp(`finally \\{ ${flag} = false;`).test(body),
      `${name} 沒有在 finally 放掉旗標 —— 一次例外就會讓輪詢永久停擺`);
    // ⭐⭐⭐ 早退**必須在 try 之外**：`return` 在 try 內一樣會執行 finally，
    //   於是「因忙碌而跳過」的 tick 會把在途那一發設的旗標清掉 ⇒ 防壅塞完全失效。
    //   ⚠ 本守衛第一版就是斷言那個壞掉的 pattern 為「正確」（v6.137「斷言有呼叫≠事情有發生」的翻版），
    //     Fable 5 實測 RTT 2 秒時同時在途最高 3 發才抓出來。
    const iRet = body.indexOf(`if (${flag}) return;`);
    const iTry = body.indexOf('try {');
    assert.ok(iRet >= 0 && iTry >= 0 && iRet < iTry,
      `${name} 的 in-flight 早退寫在 try 內（return 會觸發 finally 把在途旗標清掉）`);
  }
});
T('⭐⭐降頻計數器是 closure 變數 → startTournamentPoll() 的呼叫點必須全部被 game-over 擋住', () => {
  // Fable 5 審查指出的隱性耦合：_goTick 住在 startTournamentPoll() 的 closure 裡，
  //   任何人重建 timer 就會把計數歸零、降頻靜默失效。目前 4 個呼叫點中的兩個看門狗
  //   已被 !_tOver 擋住，另兩個是人為進場（本來就該歸零）。
  //   ⇒ 鎖住「呼叫點總數」，有人新增第五個就會紅，逼他回來想清楚。
  // v6.149：+1 = 連線健康橫幅的「立即重新同步」按鈕。它安全，因為：
  //   ①那是玩家手動按的，重建 timer 只會多送一發，之後仍由 tPollDesiredMs 決定節奏；
  //   ②橫幅本身已排除 game-over（沒有東西要同步），所以不會在降頻期間被按到。
  const sites = [...SRC.matchAll(/startTournamentPoll\(\)/g)].length;
  assert.equal(sites, 6, `startTournamentPoll() 出現 ${sites} 次（1 個定義 + 5 個呼叫）。`
    + '新增呼叫點時請確認：它會不會在 game-over 之後重建 timer 而讓降頻失效？確認後再更新這個數字。');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
