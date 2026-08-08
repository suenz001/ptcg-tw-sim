#!/usr/bin/env node
/**
 * v6.134 守衛：休閒大廳輪詢的 gate 必須含 mode === 'online'
 *
 * 背景：`subscribeOpenRooms` 每 2 秒打兩支 GET /api/rooms（lobby + playing）。
 * 舊 gate 是 `!isTournament && onlineStep === 'join' && myUid`，但
 *   - `mode` 初始值是 null
 *   - `onlineStep` 初始值就是 'join'
 *   - 正式站 onMount 無條件 oracleAuth() 設好 myUid
 * ⇒ 任何開著 /game 的分頁（停在模式選擇、打 AI、本機雙人）都在輪詢，
 *   而畫面上根本沒有渲染大廳列表（列表在 `{:else}`（mode==='online'）分支裡）。
 * 實測：錦標賽進行中 5 分鐘 74.9 MB / 5942 req 打在 /api/rooms，佔總頻寬約 60%。
 *
 * 這支守衛同時鎖住三件事，避免日後有人把條件改鬆：
 *   ① gate 必須同時含 !isTournament / mode === 'online' / onlineStep === 'join' / myUid
 *   ② 全站唯一呼叫 subscribeOpenRooms 的地方只有這一處（新增呼叫點必須重新審 gate）
 *   ③ 掃描器自我驗證：把 gate 還原成舊寫法必須 FAIL（防守衛本身失效）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P = join(ROOT, 'src/routes/game/+page.svelte');
const SRC = readFileSync(P, 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS ' + m); };
const no = (m) => { fail++; console.log('  FAIL ' + m); };

// ── 掃描器下限斷言：檔案要夠大才代表真的讀到了（mount 截斷防護）
if (SRC.length < 500000) {
  console.log('FAIL 掃描器前提不成立：game/+page.svelte 只讀到 ' + SRC.length + ' bytes（疑似被截斷）');
  process.exit(1);
}

// ── ② 呼叫點唯一性（先驗，因為 ① 依賴它）
const callSites = [...SRC.matchAll(/=\s*subscribeOpenRooms\s*\(/g)];
if (callSites.length === 1) ok('subscribeOpenRooms 全站只有 1 個呼叫點');
else no('subscribeOpenRooms 呼叫點有 ' + callSites.length + ' 個（新增呼叫點必須重新審 gate，並更新此守衛）');

// ── ① 取呼叫點往前 400 字，必須落在含四個條件的 if 裡
const idx = SRC.indexOf('= subscribeOpenRooms(');
const win = idx > 0 ? SRC.slice(Math.max(0, idx - 400), idx) : '';
const needles = [
  ['!isTournament', '不在錦標賽頁'],
  ["mode === 'online'", "已進入線上模式（v6.134 新增：少了這條，打 AI／本機雙人／停在模式選擇的分頁都會輪詢）"],
  ["onlineStep === 'join'", '停在大廳列表那一步'],
  ['myUid', '已取得 uid'],
];
for (const [n, why] of needles) {
  if (win.includes(n)) ok('gate 含 ' + n + '（' + why + '）');
  else no('gate 缺少 ' + n + '（' + why + '）');
}

// ── ③ 自我驗證：反向對照。舊寫法（缺 mode）必須被判 FAIL
const legacy = "if (!isTournament && onlineStep === 'join' && myUid) {";
if (!SRC.includes(legacy)) ok('自我驗證：舊 gate 寫法已不存在');
else no('自我驗證：仍存在舊 gate 寫法（缺 mode === \'online\'）');

// ── ④ 正對照：確認大廳列表 UI 真的只在 mode 為線上的分支渲染
//    （若哪天 UI 搬到 mode===null 也要顯示，這條會提醒重新審 gate）
const uiIdx = SRC.indexOf('{#each lobbyRooms');
if (uiIdx > 0) {
  const before = SRC.slice(0, uiIdx);
  const lastLocal = before.lastIndexOf("{:else if mode === 'local'}");
  const lastNull = before.lastIndexOf('{#if mode === null}');
  if (lastLocal > 0 && lastNull > 0 && lastLocal > lastNull) ok('正對照：大廳列表 UI 位於 mode 線上分支之後');
  else no('正對照：大廳列表 UI 的 mode 分支結構與預期不符 —— gate 需重新審');
} else {
  no('正對照：找不到 lobbyRooms 的渲染點（UI 結構已變，需重新審 gate）');
}

console.log('\n[v6134-lobby-poll-gate] PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
