/**
 * v6.107 守衛：休閒線上對戰「閒置自動判負」
 *
 * 玩家回報：一般（休閒）對戰遇到掛機的人，掛十分鐘都沒有任何結果。
 * 三個獨立斷點（任一個都足以致死）：
 *   ① 休閒原本只有「手動宣告」制，沒有伺服器自動判負。
 *   ② 那個宣告按鈕**只渲染在桌機版面**，手機直式版完全沒有。
 *   ③ 對戰中不送心跳 ⇒ 對手掛機時雙方零寫入 ⇒ 房間 5 分鐘後被殭屍清掃**整個刪掉**，
 *      之後宣告一定失敗，而且前端把失敗一律顯示成「對手其實已經行動了」。
 *
 * 本檔釘住三件事，並用**真的 currentActorSeat**（從 server_admin_patch.js 抽出）
 * 驗證 setup 各子階段都判得出「該誰動作」—— 那正是過去「開局掛機完全無解」的原因。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const patch = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const page = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '→', e.message); fail++; } };

// 抽出真正的 currentActorSeat（brace-match，與 test-tournament-setup-idle-gate 同手法）
function extractFn(name) {
  const start = patch.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到 ${name}`);
  let i = patch.indexOf('{', start), depth = 0, end = -1;
  for (; i < patch.length; i++) {
    if (patch[i] === '{') depth++;
    else if (patch[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return eval('(' + patch.slice(start, end) + ')');
}
const currentActorSeat = extractFn('currentActorSeat');

console.log('① setup 各子階段都要判得出「該誰動作」（過去開局掛機無解的根源）');
const base = (o = {}) => ({ phase: 'setup', setupDone: [false, false], players: [{}, {}], ...o });

T('A 我重抽較多（engine 擋我放場）→ 該動作的是重抽較少方，不是我', () => {
  // mulliganCounts=[0,2]：座位 0 重抽少 → 它要先放場+按準備；座位 1 在等
  const gs = base({ mulliganCounts: [0, 2] });
  assert.strictEqual(currentActorSeat(gs), 0);
});
T('A2 重抽少方已準備、重抽多方還沒 → 換多方該動作', () => {
  const gs = base({ mulliganCounts: [0, 2], setupDone: [true, false] });
  assert.strictEqual(currentActorSeat(gs), 1);
});
T('B 雙方都按完準備，只有一方欠「確認重抽揭示」→ 單判欠的那方', () => {
  const gs = base({ setupDone: [true, true], mulliganRevealConfirmed: [true, false] });
  assert.strictEqual(currentActorSeat(gs), 1);
});
T('B2 雙方都按完準備，只有一方欠補抽 → 單判欠的那方', () => {
  const gs = base({ setupDone: [true, true], pendingMulliganDraw: [0, 2] });
  assert.strictEqual(currentActorSeat(gs), 1);
});
T('C 互動式開局（閃焰王牌）只有一方還要選 → 判那一方', () => {
  const gs = base({ openingChoicePending: [false, true], mulliganCounts: [1, 0] });
  assert.strictEqual(currentActorSeat(gs), 1);
});
T('D 雙方都還沒放場、重抽次數相同 → 回 -1（雙方都該動作，不判任何一方）', () => {
  const gs = base({ mulliganCounts: [0, 0] });
  assert.strictEqual(currentActorSeat(gs), -1);
});
T('E 對戰中：輪到誰就是誰（含 pendingSelection／需送新寶可夢優先）', () => {
  assert.strictEqual(currentActorSeat({ phase: 'playing', activePlayerIndex: 1, players: [{ active: {} }, { active: {} }] }), 1);
  assert.strictEqual(currentActorSeat({ phase: 'playing', activePlayerIndex: 0, players: [{ active: {} }, { active: null }] }), 1,
    '對手戰鬥位空著（要送新寶可夢）時該他動作，即使名義上是我的回合');
  assert.strictEqual(currentActorSeat({ phase: 'playing', activePlayerIndex: 0, players: [{ active: {} }, { active: {} }], pendingSelection: { actorIdx: 1 } }), 1);
});
T('F 已結束的對局不判（回 null）', () => {
  assert.strictEqual(currentActorSeat({ phase: 'game-over' }), null);
});

console.log('② 休閒閒置判負必須複用同一個 currentActorSeat（禁另寫一份判定）');
// ⚠ 用函式宣告當錨點：檔案其他地方（例如殭屍清掃的註解）也會提到這個名字，
//   用 indexOf('startCasualIdleForfeit') 會抓到註解、往後取到的不是函式本體 → 假 FAIL。
const CASUAL_I = patch.indexOf('(function startCasualIdleForfeit()');
const casualBody = CASUAL_I >= 0 ? patch.slice(CASUAL_I, CASUAL_I + 5000) : '';
T('休閒判負 pass 存在', () => {
  assert.ok(CASUAL_I >= 0, '找不到 (function startCasualIdleForfeit()');
});
T('⭐ 它呼叫 currentActorSeat —— 不得自行實作「該誰動作」', () => {
  assert.ok(casualBody.includes('currentActorSeat(gs)'),
    '休閒判負必須複用錦標賽那份（已被 v0.60/0.62/0.67/0.74/v6.053 五次事故淬鍊過）；' +
    '另寫一份＝新一輪漂移的開始');
});
T('actor 為 -1／null 時不判任何一方（雙方都欠動作／判不出來）', () => {
  assert.ok(/actor !== 0 && actor !== 1/.test(casualBody), '缺少 -1/null 的保護');
});
T('判負是把房間寫成 game-over + ended，**不是刪房**', () => {
  assert.ok(casualBody.includes("phase = 'game-over'") && casualBody.includes("status: 'ended'"), '應寫成結束局');
  assert.ok(!casualBody.includes('deleteOne') && !casualBody.includes('deleteMany'), '判負不該刪房，玩家要看得到結果');
});
T('門檻沿用房主設定 idleTimeoutSec（Wilson 裁定），並 clamp 60~300', () => {
  assert.ok(casualBody.includes('idleTimeoutSec'), '要讀房主設定');
  assert.ok(/Math\.min\(300,\s*Math\.max\(60/.test(casualBody), '要 clamp 60~300 與前端一致');
});

console.log('③ 殭屍清掃不能搶在判負之前把房刪掉');
T('⭐ playing 房的刪除門檻 > 判負門檻上限（300 秒）＋足夠緩衝', () => {
  const m = /const PLAYING_STALE_MS = (\d+) \* 60 \* 1000;/.exec(patch);
  assert.ok(m, '找不到 PLAYING_STALE_MS');
  const min = Number(m[1]);
  assert.ok(min >= 10,
    `playing 刪房門檻只有 ${min} 分鐘 —— 房主可把閒置門檻設到 5 分鐘，` +
    '刪房會搶在判負前發生，玩家又會回到「掛著沒結果、按鈕還騙人」的狀態');
});

console.log('④ 手機版也要看得到「宣告對手棄權」（v6.098 同型：判定亮了但按鈕不存在）');
T('⭐ banner 與確認視窗在版面分支之外（手機／桌機共用同一份）', () => {
  const lines = page.split('\n');
  let depth = 0, start = -1, end = -1;
  lines.forEach((l, i) => {
    if (start < 0 && l.includes('{#if isPortraitMobile && game}')) { start = i; depth = 1; return; }
    if (start < 0 || end >= 0) return;
    depth += (l.match(/\{#if|\{#each|\{#await/g) || []).length;
    depth -= (l.match(/\{\/if\}|\{\/each\}|\{\/await\}/g) || []).length;
    if (depth <= 0) end = i;
  });
  assert.ok(start >= 0 && end > start, '找不到手機／桌機版面分支');
  const bi = lines.findIndex((l) => l.includes('opp-inactive-banner'));
  const mi = lines.findIndex((l) => l.includes('{#if showForfeitConfirm}'));
  assert.ok(bi > end, `宣告 banner 在版面分支內（第 ${bi + 1} 行）→ 手機版看不到`);
  assert.ok(mi > end, `確認視窗在版面分支內（第 ${mi + 1} 行）→ 手機版按了沒反應`);
});
T('正對照：把行號挪進分支內的假樣本會被抓出來', () => {
  const fake = ['{#if isPortraitMobile && game}', '<div class="opp-inactive-banner"></div>', '{:else}', '{/if}'];
  let depth = 0, end = -1;
  fake.forEach((l, i) => {
    if (l.includes('{#if isPortraitMobile && game}')) { depth = 1; return; }
    if (end >= 0) return;
    depth += (l.match(/\{#if|\{#each/g) || []).length;
    depth -= (l.match(/\{\/if\}|\{\/each\}/g) || []).length;
    if (depth <= 0) end = i;
  });
  const bi = fake.findIndex((l) => l.includes('opp-inactive-banner'));
  assert.ok(!(bi > end), '掃描式對「banner 在分支內」必須失敗');
});

console.log(`\n=== v6.107 休閒閒置自動判負：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
