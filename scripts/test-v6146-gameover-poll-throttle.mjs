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
  assert.ok(RAW.includes('對戰結束後降頻'), '前提：被測檔應含本版註解');
  assert.ok(!SRC.includes('對戰結束後降頻'), '被測檔的註解沒被剝掉 → 下面的斷言都不可信');
});

T('⭐⭐主輪詢：對戰結束後必須降頻（且不是 clearInterval —— 平手待裁定仍需收更新）', () => {
  const body = sliceBetween(SRC, 'function startTournamentPoll()', '}, 1200);');
  assert.ok(/phase\s*===\s*'game-over'/.test(body), '主輪詢內沒有判 phase === game-over');
  assert.ok(/_goTick/.test(body), '沒有降頻計數器');
  assert.ok(/winner\s*==\s*null/.test(body), '沒有區分「平手待管理員裁定」與「已分勝負」的頻率');
  assert.ok(!/clearInterval\s*\(\s*tPollTimer\s*\)/.test(body.slice(body.indexOf('setInterval'))),
    '不可在輪詢回呼內 clearInterval —— 平手待裁定的玩家會永遠等不到裁定結果');
});

T('⭐⭐輪詢停擺看門狗（6 秒）：對戰結束後不得再抓 v=-1 全量盤面', () => {
  const seg = sliceBetween(SRC, "_tLastPollOkAt > 0 && (Date.now() - _tLastPollOkAt) > 6000", 'startTournamentPoll();');
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
  const body = sliceBetween(SRC, 'function startSpectatePoll()', '}, 2000);');
  assert.ok(/phase\s*===\s*'game-over'/.test(body), '觀戰輪詢沒有判 game-over');
  assert.ok(/_spGoTick/.test(body), '觀戰輪詢沒有降頻計數器');
});

T('⭐離場路徑仍然要真的停 timer（降頻不能取代停止）', () => {
  for (const fn of ['function tLeaveMatch()', 'function tLeaveSpectate()']) {
    const body = sliceBetween(SRC, fn, 'tStep = ');
    assert.ok(/clearInterval\(tPollTimer\)/.test(body), `${fn} 沒有 clearInterval(tPollTimer)`);
    assert.ok(/tPollGen\+\+/.test(body), `${fn} 沒有 tPollGen++（in-flight 回應會把玩家彈回對戰）`);
  }
});

T('⭐⭐降頻計數器是 closure 變數 → startTournamentPoll() 的呼叫點必須全部被 game-over 擋住', () => {
  // Fable 5 審查指出的隱性耦合：_goTick 住在 startTournamentPoll() 的 closure 裡，
  //   任何人重建 timer 就會把計數歸零、降頻靜默失效。目前 4 個呼叫點中的兩個看門狗
  //   已被 !_tOver 擋住，另兩個是人為進場（本來就該歸零）。
  //   ⇒ 鎖住「呼叫點總數」，有人新增第五個就會紅，逼他回來想清楚。
  const sites = [...SRC.matchAll(/startTournamentPoll\(\)/g)].length;
  assert.equal(sites, 5, `startTournamentPoll() 出現 ${sites} 次（1 個定義 + 4 個呼叫）。`
    + '新增呼叫點時請確認：它會不會在 game-over 之後重建 timer 而讓降頻失效？確認後再更新這個數字。');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
