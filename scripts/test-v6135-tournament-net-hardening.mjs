#!/usr/bin/env node
/**
 * v6.135 守衛：錦標賽網路層三項防護（PR-1，不含樂觀更新）
 *
 * ① tApi 必須有逾時保護（AbortController + setTimeout）
 *    fetch 預設沒有 timeout。隧道黑洞時 `await fetch` 既不 resolve 也不 reject
 *    → tournamentDispatch 的 finally 永遠不執行 → tBusy 永久 true
 *    → 之後所有點擊被 `if (tBusy) return` 靜默吞掉（tBusy 無 template 綁定，按鈕不變灰）。
 *
 * ② 錦標賽輪詢的「client 超前回正」分支必須有亂序守衛 reqV === tVersion
 *    setInterval 不等前一發完成，RTT 抖動時多發並行；晚到的舊回應會把盤面倒回舊版本，
 *    1.2 秒後又跳回 ⇒ 玩家看到「動作出現又消失」。既有 gen !== tPollGen 擋不住同輪詢內亂序。
 *
 * ③ tournamentDispatch 的 in-flight 分支不得靜默 return（必須寫 tError 給玩家看）
 *
 * 每一項都附反向對照（舊寫法不得存在），並含掃描器下限斷言。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS ' + m); };
const no = (m) => { fail++; console.log('  FAIL ' + m); };

if (SRC.length < 500000) {
  console.log('FAIL 掃描器前提不成立：game/+page.svelte 只讀到 ' + SRC.length + ' bytes（疑似 mount 截斷）');
  process.exit(1);
}

// ── 取 tApi 函式本體（從宣告到下一個 `\n  async function` / `\n  function`）
const tApiStart = SRC.indexOf('async function tApi(');
if (tApiStart < 0) { console.log('FAIL 找不到 tApi 宣告'); process.exit(1); }
const after = SRC.slice(tApiStart + 10);
const nextFn = after.search(/\n  (async )?function /);
const TAPI = after.slice(0, nextFn > 0 ? nextFn : 4000);

// ① 逾時保護
if (TAPI.includes('AbortController')) ok('① tApi 使用 AbortController');
else no('① tApi 沒有 AbortController —— fetch 無 timeout，隧道黑洞會讓 tBusy 永久 true');

if (/setTimeout\([^)]*abort/s.test(TAPI) || (TAPI.includes('setTimeout') && TAPI.includes('.abort('))) ok('① tApi 有 setTimeout → abort 的逾時觸發');
else no('① tApi 有 AbortController 但沒有觸發 abort 的計時器（等於沒有 timeout）');

if (TAPI.includes('signal')) ok('① fetch 有帶 signal（否則 AbortController 不會生效）');
else no('① fetch 沒有帶 signal —— AbortController 建了也不會作用');

if (TAPI.includes('clearTimeout')) ok('① 有 clearTimeout（避免每次請求都留一顆計時器）');
else no('① 缺 clearTimeout');

if (/AbortError/.test(TAPI)) ok('① AbortError 有轉成可讀訊息（呼叫端會顯示在 tError）');
else no('① AbortError 沒有轉譯 —— 玩家會看到原始錯誤字串');

// ① 反向對照：舊的「裸 fetch 直接 await」寫法不得存在
const legacyFetch = `const res = await fetch(T_API + path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });`;
if (!SRC.includes(legacyFetch)) ok('① 反向對照：舊的無 signal 裸 fetch 已不存在');
else no('① 反向對照：仍存在舊的無 signal 裸 fetch');

// ── ② 輪詢亂序守衛
const revertIdx = SRC.indexOf('client 版本超前伺服器');
if (revertIdx > 0) {
  // 取該註解之後 600 字（回正分支的實際程式碼）
  const win = SRC.slice(revertIdx, revertIdx + 900);
  if (win.includes('reqV === tVersion')) ok('② 回正分支有亂序守衛 reqV === tVersion');
  else no('② 回正分支缺 reqV === tVersion —— 晚到的舊回應會把盤面倒回舊版本');
} else {
  no('② 找不到「client 版本超前伺服器」回正分支（結構已變，需重新審）');
}

if (/const reqV = tVersion/.test(SRC)) ok('② 有捕捉送出當下的版本 reqV');
else no('② 沒有捕捉 reqV（守衛條件無從成立）');

// ② 反向對照：舊的無守衛寫法不得存在
const legacyRevert = 'r.version < tVersion && r.gameState) { game = r.gameState; tVersion = r.version; }';
if (!SRC.includes(legacyRevert)) ok('② 反向對照：舊的無亂序守衛回正分支已不存在');
else no('② 反向對照：仍存在無亂序守衛的回正分支');

// ── ③ in-flight 不得靜默 return
const dispIdx = SRC.indexOf('async function tournamentDispatch(');
if (dispIdx > 0) {
  const win = SRC.slice(dispIdx, dispIdx + 900);
  // v6.137 對戰動作的網路鎖已從 tBusy 拆成 tInFlight（tBusy 留給大廳操作）。
  //   這裡斷言的是**意圖**「in-flight 分支不得靜默吞點擊」，兩個名字都接受，
  //   避免日後再改名時守衛因為變數名過期而假紅。
  if (/if \((tBusy|tInFlight)\)\s*\{[^}]*tError/.test(win)) ok('③ tournamentDispatch 的 in-flight 分支有寫 tError');
  else no('③ tournamentDispatch 的 in-flight 分支沒有給玩家任何回饋（靜默吞點擊）');
  if (!/if \((tBusy|tInFlight)\) return;\s*(tBusy|tInFlight) = true/.test(win)) ok('③ 反向對照：舊的靜默 `if (鎖) return;` 已不存在');
  else no('③ 反向對照：仍是舊的靜默 `if (鎖) return;`');
} else {
  no('③ 找不到 tournamentDispatch');
}

// ── ④ 不得回退：這三項都不涉及樂觀更新，tVersion 語義必須維持「伺服器確認過的版本」
//    （PR-2 才會引入本地預測；這裡先釘住「預測不得偷偷 bump tVersion」的前提）
const predictSmell = /tVersion\s*\+\+|tVersion\s*\+=\s*1/.test(SRC);
if (!predictSmell) ok('④ tVersion 沒有被 client 自行遞增（維持「伺服器確認過的版本」語義）');
else no('④ 發現 client 自行遞增 tVersion —— 會讓輪詢的回正分支誤判，樂觀更新前必須先釐清');

// ── ⑤ Fable 5 審查後補的三項（v6.135 收尾）
if (/opts\?\.timeoutMs/.test(TAPI)) ok('⑤ tApi 支援 opts.timeoutMs（讓「失敗有狀態副作用」的呼叫放寬）');
else no('⑤ tApi 不支援 opts.timeoutMs');

if (/_timedOut/.test(TAPI)) ok('⑤ 用 _timedOut 旗標判定逾時（不把其他來源的 AbortError 誤判成逾時）');
else no('⑤ 缺 _timedOut 旗標 —— 外部 abort 會被誤報成「連線逾時」');

// tEnterMatch 的兩發必須放寬：它的 catch 會 tStep='lobby' 把玩家踢回大廳，
// 8s 誤殺代價 = 慢網路玩家進不了場（可能吃 noShow 判負）
const entIdx = SRC.indexOf('async function tEnterMatch');
if (entIdx > 0) {
  const win = SRC.slice(entIdx, entIdx + 1400);
  const widened = (win.match(/timeoutMs:\s*20000/g) || []).length;
  if (widened >= 2) ok('⑤ tEnterMatch 的 /match/enter 與 /state?v=-1 都放寬到 20s');
  else no('⑤ tEnterMatch 只有 ' + widened + ' 處放寬（需 2 處）—— 進場失敗會踢回大廳');
  if (/tStep = 'lobby'/.test(win)) ok('⑤ 正對照：tEnterMatch 失敗確實會踢回大廳（放寬的理由成立）');
  else no('⑤ 正對照：tEnterMatch 的失敗處理已變，放寬理由需重新評估');
} else { no('⑤ 找不到 tEnterMatch'); }

// in-flight 提示必須會自己消失（成功路徑不清 tError → 紅 toast 會永掛）
const dIdx = SRC.indexOf('async function tournamentDispatch(');
const dWin = dIdx > 0 ? SRC.slice(dIdx, dIdx + 900) : '';
if (/setTimeout\(\s*\(\)\s*=>\s*\{[^}]*tError\s*=\s*''/.test(dWin)) ok('⑤ in-flight 提示有自動清除（避免紅色 toast 永掛）');
else no('⑤ in-flight 提示沒有自動清除 —— 動作成功後紅字會一直掛著');

console.log('\n[v6135-tournament-net-hardening] PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
