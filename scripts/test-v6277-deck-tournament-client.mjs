#!/usr/bin/env node
// v6.277 守衛 —— 套牌戰績【client 端 P3b：錦標賽勝率】
//
// ── 這一版做什麼 ──────────────────────────────────────────────────────────
//  ① 三個報名入口（/register、/register-and-checkin、/propose）都帶 `deck.id`
//     ⇒ 伺服器 v6.276 才收得到 TREGS.deckId、歸檔 players[].deckId。
//  ② `/decks` 的 🔍 錦標賽欄從「寫死累積中」改成讀伺服器真資料（三態）。
//
// ── 這支守衛怎麼證明（全部斷言到行為層／逐字集合，不是「字串存在」）──────────
//  【0】掃描器自我驗證（Rule 25：先證明抽取器抓得到東西、也判得出壞樣本）
//  【A】⭐⭐ 三個報名入口**實跑**：請求體除了多一個 `deckId` 之外**逐位元不變**
//       （JSON.stringify 含 key 順序；BASE 快照內嵌 ⇒ 淺複製也照守）
//       ＋ 全站枚舉：這三支端點的呼叫點總數與位置
//  【B】⭐⭐ `deck-stats.ts` 三態行為端：ok／not-collected／**舊伺服器（欄位缺席）fail-open**
//       ＋ truncated ＋ 錦標賽 vsArchetype 正規化
//  【C】⭐ `/decks` 的 UI 三態：真數字／累積中／舊伺服器；`since` **讀伺服器欄位、不寫死版本號**
//  【D】⭐⭐ `/decks` 載入請求數與 BASE 相同（量測，會把兩邊的呼叫點集合印出來）
//  【E】⭐⭐ Firestore 讀取次數不變（三個改動檔的 Firestore 呼叫點逐字計數）
//       ⭐v6.311：計數前先用 scripts/lib/strip-comments.mjs **剝掉註解**，
//       並附自驗：剝除器正對照（真呼叫點還在）／長度護欄／**已知答案表**（E3，history-free）。
//       起因：v6.307 在 game/+page.svelte 寫了一行**註解**提到 loadDecksFromCloud，【Gc】在完整歷史下誤紅
//       （CI 淺複製 SHALLOW-SKIP 所以看不到；一改 fetch-depth:0 就會擋 deploy）。
//       ⭐v6.312：v6.311 的行級剝除器對「單行區塊／模板註解後接程式碼」「`*` 開頭的運算式續行」
//       「`*/` 收尾行接程式碼」四種合法程式碼會**整行吃掉 ⇒ 假綠**（獨立審查者用突變實證）。
//       helper 改成行級狀態機（只在行首開區塊、尾巴保留、孤兒 `*` 行保留、單一區塊 >150 行即炸）；
//       E0a 把那四種樣式（B1~B4）放進正對照、【H】各自實跑突變；FS_TOKENS 同時數帶括號版
//       （擋 `import * as cloud` 再呼叫兩次的假綠）；反面對照全改內嵌樣本、不再綁真檔的某行註解。
//  【F】正對照：休閒那兩欄逐字不變；v6.271 的版面不回退；`Deck.id` 仍是 crypto.randomUUID()
//  【G】HEAD-FAIL：對真 BASE(v6.276) blob 跑，A~E 的每一條**各自**紅
//  【H】突變測試（16 條），每一條都必須紅在指定的位置
//  【I】自查：本守衛在 package.json 的 test chain 裡
//
// ⚠⚠ 只捕捉 assert.AssertionError —— 其他例外（打錯字／抽取器壞掉）必須直接炸掉。
// ⚠⚠ 全檔**不 pin 任何版本號字串當判準**（第九種守衛安慰劑）。
// Run: node scripts/test-v6277-deck-tournament-client.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import * as stripMod from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '9f500a55cf83daa8be3530ff01c8a163c6a60a23';   // v6.276
// ⭐ v6.277 自己的 commit sha（v6.279 補上）。
//   ⚠⚠ 下面【Ge】原本比的是「v6.276 blob vs **工作樹**」—— 它守的是
//   「**v6.277** 除了三個 deckId 之外沒動 game/+page.svelte」這件**歷史事實**，
//   卻會在之後任何一版合法改動該檔時誤紅（v6.279 第一次踩到）。
//   改成 commit vs commit ⇒ 永久成立、不必每版維護；「現在的碼還有那三個 deckId」
//   由本檔【A1~A3】對**工作樹**的斷言繼續守（兩件事分開，都沒有被放寬）。
const SELF_SHA = '54e7a3c68892f5d8ee7146181c7481549b26e177';   // v6.277

const P_GP = join(ROOT, 'src/routes/game/+page.svelte');
const P_DS = join(ROOT, 'src/lib/decks/deck-stats.ts');
const P_DK = join(ROOT, 'src/routes/decks/+page.svelte');
const P_ST = join(ROOT, 'src/lib/decks/storage.ts');
const P_PK = join(ROOT, 'package.json');

const GP = readFileSync(P_GP, 'utf8');
const DS = readFileSync(P_DS, 'utf8');
const DK = readFileSync(P_DK, 'utf8');
const ST = readFileSync(P_ST, 'utf8');
const PK = readFileSync(P_PK, 'utf8');

let pass = 0, fail = 0;
const T = async (n, f) => {
  try { await f(); console.log('  PASS ' + n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL ' + n + '\n        ' + e.message); fail++; } else throw e; }
};
const esbuild = await import('esbuild');
const { compile: svelteCompile } = await import('svelte/compiler');
const { render: svelteRender } = await import('svelte/server');
const { createRequire } = await import('node:module');

// ══════════════════════════════════════════════════════════════════════════
// 共用抽取器（Rule 25：每一支都有下限斷言，抽不到東西一律當成掃描器壞掉）
// ══════════════════════════════════════════════════════════════════════════
function matchBlock(src, startIdx, open, close) {
  const i = src.indexOf(open, startIdx);
  assert.ok(i >= 0, '找不到起始的 ' + open);
  let depth = 0, inStr = null, inTpl = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k], p = src[k - 1];
    if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
    if (c === '`' && p !== '\\') { inTpl ^= 1; continue; }
    if (inTpl) continue;
    if ((c === '"' || c === "'") && p !== '\\') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  assert.fail('括號沒有配對到底');
}
function extractFn(src, header, minLen, label) {
  const i = src.indexOf(header);
  assert.ok(i >= 0, '抽不到 ' + label + '（找不到 ' + header.trim().slice(0, 60) + '）');
  const body = matchBlock(src, i, '{', '}');
  const out = src.slice(i, src.indexOf(body, i) + body.length);
  assert.ok(out.length >= minLen, label + ' 只抽到 ' + out.length + ' 字元（下限 ' + minLen + '）—— 抽取器壞了？');
  return out;
}
const ts2js = (s) => esbuild.transformSync(s.replace(/^\s*export /, ''), { loader: 'ts' }).code;

// ── /decks 載入區段（【D】用；口徑逐字沿用 v6.267 守衛，兩支不得漂移）──────
function loadPathOf(src, minMount = 2000, minInits = 20) {
  const i = src.indexOf('onMount(');
  assert.ok(i >= 0, '抓不到 onMount(');
  const mount = matchBlock(src, i, '(', ')');
  assert.ok(mount.length >= minMount, 'onMount 區塊只有 ' + mount.length + ' 字元 —— 抽取器壞了？');
  const inits = [];
  for (let k = src.indexOf('$state('); k >= 0; k = src.indexOf('$state(', k + 1)) inits.push(matchBlock(src, k, '(', ')'));
  assert.ok(inits.length >= minInits, '只抓到 ' + inits.length + ' 個 $state( —— 抽取器壞了？');
  return { mount, inits, all: mount + '\n' + inits.join('\n'), effects: (src.match(/\$effect\(/g) || []).length };
}
const NET_TOKENS = [
  'fetch(', 'loadAllSets(', 'loadIndex(', 'loadDecksFromCloud(', 'syncDeckToCloud(',
  'removeDeckFromCloud(', 'loadFavoritesFromCloud(', 'saveFavoritesToCloud(',
  'signInAnonymously(', 'onAuthStateChanged(', 'getDoc(', 'getDocs(', 'setDoc(', 'onSnapshot(',
  'fetchDeckStats(', 'deckStatsTournamentReady(',
];
function netCallSites(text) {
  const out = [];
  for (const t of NET_TOKENS) { const n = text.split(t).length - 1; if (n > 0) out.push(t + '×' + n); }
  return out.sort();
}
// Firestore／雲端同步的呼叫點計數（【E】用）
// ⭐v6.311：**先剝註解再數**（中央 helper scripts/lib/strip-comments.mjs）。
//   ⚠ 不可以把 loadDecksFromCloud 拿掉、不可以放寬期望值 —— 這條守的是「Firestore 呼叫點不准偷偷變多」。
// ⭐v6.312：五個雲端函式**同時數不帶括號與帶括號**兩種。只數不帶括號的 `loadDecksFromCloud`（=1 import＋1 呼叫＝2）
//   擋不住「改成 `import * as cloud` 再呼叫兩次 `cloud.loadDecksFromCloud(`」（仍是 2 ⇒ 假綠）；帶括號版直接數呼叫點。
const FS_TOKENS = ['getDoc(', 'getDocs(', 'setDoc(', 'updateDoc(', 'deleteDoc(', 'onSnapshot(', 'addDoc(',
  'loadDecksFromCloud', 'syncDeckToCloud', 'removeDeckFromCloud', 'loadFavoritesFromCloud', 'saveFavoritesToCloud',
  'loadDecksFromCloud(', 'syncDeckToCloud(', 'removeDeckFromCloud(', 'loadFavoritesFromCloud(', 'saveFavoritesToCloud('];
// 每個檔的剝除器護欄：長度下限 ＋ 正對照（剝完之後「真呼叫點」必須還在；import 行沒有括號所以不算）
//   ⭐v6.312：三個檔一律 0.5（v6.311 把 deck-stats.ts 放寬到 0.4 是不必要的削弱 —— 實測 9f500a55 剝後 67.4%、
//   e65a718e 剝後 60.5%，0.5 就過且有 10 點餘裕；DS 的已知答案表全 0，長度護欄與 mustKeep 是它僅有的兩道護欄）。
const FS_STRIP = {
  GP: { label: 'game/+page.svelte', minRatio: 0.5, mustKeep: ['loadDecksFromCloud('] },
  DS: { label: 'deck-stats.ts', minRatio: 0.5, mustKeep: ['fetchDeckStats('] },
  DK: { label: 'decks/+page.svelte', minRatio: 0.5, mustKeep: ['loadDecksFromCloud(', 'syncDeckToCloud('] },
};
function fsCounts(text, which, { mod = stripMod, opt = FS_STRIP[which], tokens = FS_TOKENS } = {}) {
  assert.ok(FS_STRIP[which], 'fsCounts：which 必須是 GP/DS/DK，實得 ' + which);
  return mod.countTokensStripped(text, tokens, opt);
}
// ⭐ 已知答案表＝BASE(v6.276) 三個檔**剝註解後**的確切數字（history-free；【Gc】會拿真 BASE blob 核對這張表沒抄錯）。
//   ⚠ 這不是「拿新碼算出來的期望值」—— 是從 9f500a55 的 blob 量出來、手抄進來的。
//   ⭐v6.312 帶括號那五欄：用一份**獨立的 Python 實作**（同一套行級狀態機規則）對 9f500a55 blob 量出、手抄；
//   JS helper 與 Python 在六個 blob（9f500a55／e65a718e 各三檔）的剝後輸出逐位元相同。
const FS_BASE = {
  GP: { 'getDoc(': 0, 'getDocs(': 0, 'setDoc(': 0, 'updateDoc(': 0, 'deleteDoc(': 0, 'onSnapshot(': 0, 'addDoc(': 0,
    loadDecksFromCloud: 2, syncDeckToCloud: 0, removeDeckFromCloud: 0, loadFavoritesFromCloud: 0, saveFavoritesToCloud: 0,
    'loadDecksFromCloud(': 1, 'syncDeckToCloud(': 0, 'removeDeckFromCloud(': 0, 'loadFavoritesFromCloud(': 0, 'saveFavoritesToCloud(': 0 },
  DS: { 'getDoc(': 0, 'getDocs(': 0, 'setDoc(': 0, 'updateDoc(': 0, 'deleteDoc(': 0, 'onSnapshot(': 0, 'addDoc(': 0,
    loadDecksFromCloud: 0, syncDeckToCloud: 0, removeDeckFromCloud: 0, loadFavoritesFromCloud: 0, saveFavoritesToCloud: 0,
    'loadDecksFromCloud(': 0, 'syncDeckToCloud(': 0, 'removeDeckFromCloud(': 0, 'loadFavoritesFromCloud(': 0, 'saveFavoritesToCloud(': 0 },
  DK: { 'getDoc(': 0, 'getDocs(': 0, 'setDoc(': 0, 'updateDoc(': 0, 'deleteDoc(': 0, 'onSnapshot(': 0, 'addDoc(': 0,
    loadDecksFromCloud: 3, syncDeckToCloud: 5, removeDeckFromCloud: 2, loadFavoritesFromCloud: 2, saveFavoritesToCloud: 2,
    'loadDecksFromCloud(': 2, 'syncDeckToCloud(': 4, 'removeDeckFromCloud(': 1, 'loadFavoritesFromCloud(': 1, 'saveFavoritesToCloud(': 1 },
};
// 【Gc／E3】共用的判準：三個檔的（剝註解後）計數必須等於已知答案表。可注入突變後的 helper 模組／原始碼。
function assertFsMatchesTable({ gp = GP, ds = DS, dk = DK, mod = stripMod, tokens = FS_TOKENS, table = FS_BASE } = {}) {
  const now = { DK: fsCounts(dk, 'DK', { mod, tokens }), GP: fsCounts(gp, 'GP', { mod, tokens }), DS: fsCounts(ds, 'DS', { mod, tokens }) };
  assert.deepStrictEqual(now.DK, table.DK, '/decks 的 Firestore 呼叫點變了（與已知答案表不同）：' + JSON.stringify(now.DK));
  assert.deepStrictEqual(now.GP, table.GP, '/game 的 Firestore 呼叫點變了（與已知答案表不同）：' + JSON.stringify(now.GP));
  assert.deepStrictEqual(now.DS, table.DS, 'deck-stats.ts 的 Firestore 呼叫點變了（與已知答案表不同）：' + JSON.stringify(now.DS));
  return now;
}

// ══════════════════════════════════════════════════════════════════════════
// 報名入口的實跑 harness（三支各自把 payload 攔下來）
// ══════════════════════════════════════════════════════════════════════════
const DECK = { id: 'a1b2c3d4-1111-2222-3333-444455556666', name: '測試牌組', entries: [{ cardId: 'C1', count: 60 }] };
const VER = '9.999';
function runEnroll(gpSrc, deck = DECK) {
  const js = ts2js(extractFn(gpSrc, '  async function tournEnroll(eventId: string) {', 300, 'tournEnroll'));
  const calls = [];
  const fn = new Function('tNickname', 'tError', 'allDecks', 'tDeckId', 'tBusy', 'tCoinPref',
    'tRegFormEventId', 'tApi', 'saveCoinPref', 'tournLoadEvent', 'calls',
    js + '\n;return tournEnroll;')(
    '暱稱', '', [deck], deck.id, false, 'first', '',
    async (route, payload) => { calls.push([route, payload]); return {}; },
    () => {}, async () => {}, calls);
  return fn('EV1').then(() => calls);
}
function runLateJoin(gpSrc, deck = DECK) {
  const js = ts2js(extractFn(gpSrc, '  async function tLateJoin(eventId: string) {', 300, 'tLateJoin'));
  const calls = [];
  const fn = new Function('tNickname', 'tError', 'allDecks', 'tDeckId', 'tBusy', 'tCoinPref',
    'tRegFormEventId', 'tCheckinErrId', 'VERSION', 'tApi', 'saveCoinPref', 'tournLoadEvent', 'calls',
    js + '\n;return tLateJoin;')(
    '暱稱', '', [deck], deck.id, false, 'first', '', '', VER,
    async (route, payload) => { calls.push([route, payload]); return {}; },
    () => {}, async () => {}, calls);
  return fn('EV1').then(() => calls);
}
function runPropose(gpSrc, deck = DECK) {
  const js = ts2js(extractFn(gpSrc, '  async function tPropose() {', 300, 'tPropose'));
  const calls = [];
  const fn = new Function('tNickname', 'tError', 'allDecks', 'tDeckId', 'tBusy', 'tCoinPref',
    'tProposeName', 'tProposeFormat', 'tProposeRally', 'tProposeOpen', 'tApi', 'tournLoadEvent', 'calls',
    js + '\n;return tPropose;')(
    '暱稱', '', [deck], deck.id, false, 'first', '社群賽X', 'swiss-then-cut', 30, true,
    async (route, payload) => { calls.push([route, payload]); return {}; },
    async () => {}, calls);
  return fn().then(() => calls);
}
// ⭐ BASE(v6.276) 的三個請求體快照（**內嵌＝history-free**，淺複製的 CI 也照守）。
//   這是「除了多一個 deckId 之外逐位元不變」的對照組；【G】會拿真 BASE blob 再驗一次快照沒抄錯。
const BASE_BODY = {
  '/register': '{"eventId":"EV1","name":"暱稱","deckName":"測試牌組","deckEntries":[{"cardId":"C1","count":60}],"coinPref":"first"}',
  '/register-and-checkin': '{"eventId":"EV1","name":"暱稱","deckName":"測試牌組","deckEntries":[{"cardId":"C1","count":60}],"coinPref":"first","ver":"9.999"}',
  '/propose': '{"format":"swiss-then-cut","rallyMin":30,"eventName":"社群賽X","nickname":"暱稱","deckName":"測試牌組","deckEntries":[{"cardId":"C1","count":60}],"coinPref":"first"}',
};

// ══════════════════════════════════════════════════════════════════════════
// deck-stats.ts 的實跑 harness
// ══════════════════════════════════════════════════════════════════════════
function loadDeckStats(dsSrc, { apiUrl = 'http://t.local' } = {}) {
  assert.ok(dsSrc.length > 3000, 'deck-stats.ts 只有 ' + dsSrc.length + ' 字元 —— 檔案不存在或被掏空');
  const marker = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
  assert.ok(dsSrc.includes(marker), 'deck-stats.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  const js = esbuild.transformSync(dsSrc.replace(marker, JSON.stringify(apiUrl)), { loader: 'ts', format: 'cjs' }).code;
  const m = { exports: {} };
  return (fetchImpl) => { new Function('module', 'exports', 'fetch', js)(m, m.exports, fetchImpl); return m.exports; };
}
const mkFetch = (respFn) => { const calls = []; const f = async (u, i) => { calls.push(u); return respFn(calls.length, u, i); }; f.calls = calls; return f; };
const jsonRes = (status, body) => ({ status, ok: status < 400, json: async () => body });
const baseBody = (over = {}) => ({
  ok: true, deckStatsApi: 1, deckId: 'D1',
  casual: { scope: 'online-only', games: 10, wins: 6, losses: 4, draws: 0, winRate: 0.6 },
  vsArchetype: [{ name: '噴火龍ex', games: 6, wins: 5, losses: 1, draws: 0, winRate: 5 / 6 }],
  since: 'v6.266', scanned: 10, truncated: false, scanCap: 5000, ...over,
});
// 伺服器 v6.276 的三種 tournament 回應形狀（逐欄比照出貨碼）
const T_OK = {
  status: 'ok', games: 5, wins: 3, losses: 2, draws: 0, winRate: 0.6,
  since: 'vX.YZ', vsArchetype: [{ name: '狂灑冰晶', games: 3, wins: 2, losses: 1, draws: 0, winRate: 2 / 3 }],
  events: 4, scanned: 88, truncated: false, scanCap: 300,
};
const T_NOTCOLLECTED = {
  status: 'not-collected', games: 0, wins: 0, losses: 0, draws: 0, winRate: null,
  since: 'vX.YZ', vsArchetype: [], events: 0, scanned: 0, truncated: false, scanCap: 300,
};
// ⭐ 舊伺服器（v6.275 以下）的形狀：只有前六個 key，**沒有 since**
const T_OLD_SERVER = { status: 'not-collected', games: 0, wins: 0, losses: 0, draws: 0, winRate: null };

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【0】掃描器自我驗證（Rule 25）═════════════════════════════════════════');
await T('0-1 三支報名函式／deck-stats／載入區段都抽得到，長度合理', () => {
  extractFn(GP, '  async function tournEnroll(eventId: string) {', 300, 'tournEnroll');
  extractFn(GP, '  async function tLateJoin(eventId: string) {', 300, 'tLateJoin');
  extractFn(GP, '  async function tPropose() {', 300, 'tPropose');
  loadPathOf(DK);
  assert.ok(DS.length > 3000, 'deck-stats.ts 太短');
});
await T('0-2 [正對照] 對「人工植入的壞樣本」判得出來（掃描器真的在看東西）', () => {
  const probe = 'onMount(() => { fetchDeckStats("x"); loadIndex(); });\nlet a = $state(1);\nlet b = $state(2);';
  const sites = netCallSites(loadPathOf(probe, 20, 2).all);
  assert.ok(sites.includes('fetchDeckStats(×1'), '掃描器抓不到植入的 fetchDeckStats ⇒【D】全是假綠：' + sites.join(','));
  assert.ok(sites.includes('loadIndex(×1'), '掃描器抓不到 loadIndex');
});
await T('0-3 括號配對器不會被字串／樣板字面內的括號騙倒', () => {
  const s = 'f({ a: "}{", b: `${x})(`, c: 1 })';
  assert.strictEqual(matchBlock(s, 0, '(', ')'), s.slice(1));
  assert.strictEqual(matchBlock(s, 0, '{', '}'), '{ a: "}{", b: `${x})(`, c: 1 }');
});
await T('0-4 [正對照] 報名 harness 真的攔得到 payload（不是每次都回空陣列）', async () => {
  const c = await runEnroll(GP);
  assert.strictEqual(c.length, 1, 'harness 攔到 ' + c.length + ' 發（應 1）—— 空陣列空真是第四種安慰劑');
  assert.strictEqual(c[0][0], '/register');
  assert.ok(c[0][1] && typeof c[0][1] === 'object', 'payload 不是物件');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【A】⭐⭐ 三個報名入口：請求體除了多一個 deckId 之外逐位元不變 ═════════');

await T('A0 ⭐ 全站枚舉：這三支端點在 src/ 只有這三個呼叫點，且全部在 game/+page.svelte', () => {
  for (const [route, n] of [["tApi('/register'", 1], ["tApi('/register-and-checkin'", 1], ["tApi('/propose'", 1]]) {
    const c = GP.split(route).length - 1;
    assert.strictEqual(c, n, route + ' 在 game/+page.svelte 出現 ' + c + ' 次（應 ' + n + '）');
  }
  console.log('        枚舉：/register ×1、/register-and-checkin ×1、/propose ×1（全部在 src/routes/game/+page.svelte）');
});

for (const [label, runner, route] of [
  ['A1 /register', runEnroll, '/register'],
  ['A2 /register-and-checkin', runLateJoin, '/register-and-checkin'],
  ['A3 /propose', runPropose, '/propose'],
]) {
  await T(label + ' ⭐⭐ 實跑：payload 多且只多一個 deckId，其餘欄位與 key 順序逐位元不變', async () => {
    const calls = await runner(GP);
    assert.strictEqual(calls.length, 1, '打了 ' + calls.length + ' 發（應 1）');
    assert.strictEqual(calls[0][0], route, '打錯端點：' + calls[0][0]);
    const p = calls[0][1];
    assert.strictEqual(p.deckId, DECK.id, 'deckId 不是 deck.id（實得 ' + JSON.stringify(p.deckId) + '）');
    // ⭐ 逐位元：把 deckId 這一個 key 拿掉之後，JSON.stringify（含 key 順序）必須等於 BASE 快照
    const { deckId, ...rest } = p;
    const got = JSON.stringify(rest);
    assert.strictEqual(got, BASE_BODY[route],
      '請求體除了 deckId 以外被改動了。\n        BASE ：' + BASE_BODY[route] + '\n        修後 ：' + got);
    // ⭐ 新 key 必須**附加在最後**（不可以插隊改變既有 key 順序）
    assert.strictEqual(Object.keys(p)[Object.keys(p).length - 1], 'deckId',
      'deckId 不是附加在最後：' + Object.keys(p).join(','));
    console.log('        ' + route + ' 逐位元：' + BASE_BODY[route] + '  ＋ deckId');
  });
}
await T('A4 ⭐ client 送出的 deckId 一定通過伺服器的 sanitizeDeckId（否則會被靜默丟掉）', () => {
  const DECK_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;          // 逐字抄自 server_admin_patch.js
  const js = ts2js(extractFn(ST, 'export function newDeck(', 100, 'newDeck')
    + '\n' + extractFn(ST, 'function randomId(): string {', 80, 'randomId'));
  const make = (c) => new Function('crypto', js + '\n;return newDeck;')(c);
  const a = make({ randomUUID: () => '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })('x');
  assert.ok(DECK_ID_RE.test(a.id), 'randomUUID 產的 id 不合伺服器的 sanitizeDeckId：' + a.id);
  const fb = make({})('x');
  assert.ok(DECK_ID_RE.test(fb.id), 'fallback 產的 id 不合伺服器的 sanitizeDeckId：' + fb.id);
});
await T('A5 [正對照] 60 張以外／沒選牌組時三支都一發不送（既有 gate 逐字不變）', async () => {
  const bad = { id: DECK.id, name: 'n', entries: [{ cardId: 'C1', count: 59 }] };
  for (const [name, runner] of [['tournEnroll', runEnroll], ['tLateJoin', runLateJoin], ['tPropose', runPropose]]) {
    const c = await runner(GP, bad);
    assert.strictEqual(c.length, 0, name + ' 張數不對還是送出去了');
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【B】⭐⭐ deck-stats.ts 三態行為端 ════════════════════════════════════');
await T('B1 ⭐「有資料」：status ok ⇒ 錦標賽數字／since／對各原型都正規化出來', async () => {
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OK }))));
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, true, '應該成功：' + JSON.stringify(r));
  const t = r.data.tournament;
  assert.strictEqual(t.status, 'ok');
  assert.strictEqual(t.games, 5); assert.strictEqual(t.wins, 3); assert.strictEqual(t.losses, 2);
  assert.strictEqual(t.winRate, 0.6);
  assert.strictEqual(t.since, 'vX.YZ', 'since 沒有從伺服器讀出來（實得 ' + t.since + '）—— 是不是寫死了？');
  assert.strictEqual(t.vsArchetype.length, 1, '錦標賽的對各原型列不見了');
  assert.strictEqual(t.vsArchetype[0].name, '狂灑冰晶');
  assert.strictEqual(t.events, 4); assert.strictEqual(t.scanCap, 300);
  assert.strictEqual(mod.deckStatsTournamentReady(t), true, '有資料卻判成「累積中」');
});
await T('B2 ⭐「查無」：status not-collected ⇒ ready=false（UI 顯示「累積中」）', async () => {
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_NOTCOLLECTED }))));
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, true, '查無資料不可以被當成錯誤');
  assert.strictEqual(r.data.tournament.status, 'not-collected');
  assert.strictEqual(r.data.tournament.since, 'vX.YZ', 'since 恆帶，查無資料也要有');
  assert.strictEqual(mod.deckStatsTournamentReady(r.data.tournament), false);
});
await T('B3 ⭐⭐「舊伺服器」：tournament 沒有 since ⇒ since 空字串、ready=false（fail-open）', async () => {
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OLD_SERVER }))));
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, true, '舊伺服器的回應不可以讓整頁壞掉');
  assert.strictEqual(r.data.tournament.since, '', 'since 沒有落回空字串（實得 ' + JSON.stringify(r.data.tournament.since) + '）');
  assert.deepStrictEqual(r.data.tournament.vsArchetype, [], '舊伺服器沒有這個欄位 ⇒ 必須是空陣列');
  assert.strictEqual(mod.deckStatsTournamentReady(r.data.tournament), false, '舊伺服器沒有 fail-open 退回「累積中」');
});
await T('B3b ⭐⭐「舊伺服器」極端：連 tournament 這個 key 都沒有 ⇒ 不丟例外、ready=false', async () => {
  const b = baseBody(); delete b.tournament;
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, b)));
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.tournament.status, 'not-collected');
  assert.strictEqual(mod.deckStatsTournamentReady(r.data.tournament), false);
});
await T('B4 ⭐⭐ ready 的判準只看伺服器回應：**任何**版本字串都認（不得寫死某一版）', async () => {
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OK }))));
  await mod.fetchDeckStats('D1');
  for (const s of ['v6.276', 'v7.001', 'v99.999', '起計', 'X']) {
    assert.strictEqual(mod.deckStatsTournamentReady({ ...T_OK, since: s }), true,
      'since=' + s + ' 被判成 false ⇒ 判準裡有寫死的版本號（第九種安慰劑）');
  }
  assert.strictEqual(mod.deckStatsTournamentReady({ ...T_OK, since: '' }), false);
  assert.strictEqual(mod.deckStatsTournamentReady({ ...T_OK, status: 'not-collected' }), false);
  assert.strictEqual(mod.deckStatsTournamentReady({ ...T_OK, games: 0 }), false, 'games=0 不可以顯示真數字');
  assert.strictEqual(mod.deckStatsTournamentReady(null), false);
  assert.strictEqual(mod.deckStatsTournamentReady(undefined), false);
});
await T('B5 ⭐ 錦標賽 truncated：旗標與 scanCap 都留給 UI 講給玩家聽', async () => {
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, baseBody({ tournament: { ...T_OK, truncated: true, events: 300 } }))));
  const r = await mod.fetchDeckStats('D1');
  assert.strictEqual(r.data.tournament.truncated, true);
  assert.strictEqual(r.data.tournament.scanCap, 300);
  assert.strictEqual(r.data.truncated, false, '休閒側的 truncated 被錦標賽的蓋掉了');
});
await T('B6 [正對照] 休閒側的正規化逐欄不變（v6.267 的行為一個位元都不准動）', async () => {
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OK }))));
  const r = await mod.fetchDeckStats('D1');
  assert.deepStrictEqual(r.data.casual, { scope: 'online-only', games: 10, wins: 6, losses: 4, draws: 0, winRate: 0.6 });
  assert.deepStrictEqual(r.data.vsArchetype, [{ name: '噴火龍ex', games: 6, wins: 5, losses: 1, draws: 0, winRate: 5 / 6 }]);
  assert.strictEqual(r.data.since, 'v6.266');
  assert.strictEqual(r.data.scanCap, 5000);
});
await T('B7 ⭐ 哨兵／429／網路錯誤／快取／防連點的既有行為不變（v6.267 回歸）', async () => {
  const f1 = mkFetch(() => jsonRes(503, { error: 'x' }));
  const m1 = loadDeckStats(DS)(f1);
  assert.strictEqual((await m1.fetchDeckStats('D1')).unsupported, true);
  assert.strictEqual(m1.deckStatsHidden(), true);
  await m1.fetchDeckStats('D2');
  assert.strictEqual(f1.calls.length, 1, '記住不支援之後又多打了 ' + (f1.calls.length - 1) + ' 發');
  const f2 = mkFetch(() => jsonRes(429, { error: 'x' }));
  const m2 = loadDeckStats(DS)(f2);
  assert.strictEqual((await m2.fetchDeckStats('D1')).unsupported, false, '429 被誤判成不支援');
  const f3 = mkFetch(() => jsonRes(200, baseBody({ tournament: T_OK })));
  const m3 = loadDeckStats(DS)(f3);
  await m3.fetchDeckStats('D1'); const b = await m3.fetchDeckStats('D1');
  assert.strictEqual(b.fromCache, true); assert.strictEqual(f3.calls.length, 1);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【C】⭐ /decks 的 UI 三態 ════════════════════════════════════════════');
const DS_MODAL = (() => {
  const i = DK.indexOf('<div class="ds-card-h">錦標賽</div>');
  assert.ok(i > 0, '找不到錦標賽欄');
  const j = DK.indexOf('</ul>', i);
  assert.ok(j > i, '找不到 ds-notes 的結尾');
  const out = DK.slice(i - 200, j + 5);
  assert.ok(out.length > 1500, '錦標賽區塊只抽到 ' + out.length + ' 字元 —— 抽取器壞了？');
  return out;
})();
await T('C1 ⭐ 錦標賽欄由 tournReady 分岔（不再是寫死的「累積中」）', () => {
  assert.ok(/<div class="ds-card-h">錦標賽<\/div>\s*\{#if tournReady\}/.test(DS_MODAL),
    '錦標賽欄後面沒有 {#if tournReady} 分岔 ⇒ 還是寫死的');
  assert.ok(DS_MODAL.includes('{fmtWinRate(statsData.tournament.winRate)}'), '沒有顯示錦標賽勝率');
  assert.ok(DS_MODAL.includes('{statsData.tournament.games} 場：{statsData.tournament.wins} 勝 {statsData.tournament.losses} 敗'),
    '沒有顯示錦標賽場次／勝敗');
});
await T('C2 ⭐⭐ 「累積中」的退路還在（查無資料／舊伺服器都靠它）', () => {
  assert.ok(DS_MODAL.includes('<div class="ds-rate ds-pending">累積中</div>'), '「累積中」退路不見了');
});
await T('C3 ⭐⭐⭐ since 一律讀 `statsData.tournament.since`；模板內**沒有任何寫死的版本號**', () => {
  assert.ok(DS_MODAL.includes('{statsData.tournament.since}') || DS_MODAL.includes("statsData.tournament.since ?"),
    'UI 沒有讀 tournament.since');
  const hard = DS_MODAL.match(/v6\.\d{3}/g) || [];
  assert.deepStrictEqual(hard, [], '模板裡出現寫死的版本號：' + hard.join(','));
  // 全檔也不准有「自 v6.xxx 起計」這種寫死字串
  const hardAll = DK.match(/自 v\d/g) || [];
  assert.deepStrictEqual(hardAll, [], '/decks 出現寫死的「自 vX 起計」字串');
});
await T('C4 ⭐ truncated 為真時告訴玩家「只統計最近 N 場」（休閒／錦標賽各一條）', () => {
  assert.ok(DS_MODAL.includes('{#if statsData.truncated}') && DS_MODAL.includes('{statsData.scanCap} 場'),
    '休閒側的 truncated 提示不見了');
  assert.ok(DS_MODAL.includes('{#if tournReady && statsData.tournament.truncated}')
    && DS_MODAL.includes('{statsData.tournament.scanCap} 場賽事'),
    '錦標賽側 truncated 沒有告訴玩家「只統計最近 N 場賽事」');
});
await T('C5 ⭐ 錦標賽的「對各牌組原型」表存在，each 有穩定 key，且只在有資料時出現', () => {
  assert.ok(DK.includes('{#if tournReady && statsData.tournament.vsArchetype.length > 0}'),
    '錦標賽的對各原型表沒有被 tournReady 閘住');
  assert.ok(DK.includes('{#each statsData.tournament.vsArchetype as row (row.name)}'),
    '錦標賽 each 沒有穩定 key（Svelte each 變動必加 key）');
  assert.strictEqual(DK.split('{#each statsData.tournament.vsArchetype as row').length - 1, 1);
});
await T('C6 ⭐ tournReady 是純衍生狀態（$derived），沒有新增 $effect／計時器／請求', () => {
  assert.ok(/const tournReady = \$derived\(/.test(DK), 'tournReady 不是 $derived');
  assert.strictEqual((DK.match(/\$effect\(/g) || []).length, 0, '/decks 出現了 $effect');
  assert.strictEqual(DK.split('deckStatsTournamentReady(').length - 1, 2,
    'deckStatsTournamentReady 呼叫次數異常（應 2：import 一次＋$derived 一次）');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【C-SSR】⭐⭐⭐ 三態**真的算繪出來**（不是字串存在）══════════════════');
// ⭐ 把 modal 的資料區塊（ds-cards ～ ds-notes）切成一支最小 Svelte 元件，用 SSR **真的算繪**。
//   它只依賴 statsData / tournReady / fmtWinRate 三樣東西 ⇒ 注入完整可跑。
//   ⚠ 這一節把「模板長什麼樣」升級成「玩家實際看到什麼字」——【C】的靜態斷言只是輔助。
function fragOf(src) {
  const i = src.indexOf('        <div class="ds-cards">');
  assert.ok(i > 0, '抽不到 ds-cards 區塊');
  const j = src.indexOf('</ul>', i) + 5;
  assert.ok(j > i, '抽不到 ds-notes 的結尾');
  const out = src.slice(i, j);
  assert.ok(out.length > 1500, '模板片段只抽到 ' + out.length + ' 字元 —— 抽取器壞了？');
  return out;
}
function buildProbe(frag) {
  const comp = '<' + 'script>\n  let { statsData, tournReady } = $props();\n'
    + "  function fmtWinRate(v) { return v === null ? '—' : (v * 100).toFixed(1) + '%'; }\n"
    + '</' + 'script>\n' + frag + '\n';
  const out = svelteCompile(comp, { filename: 'Probe.svelte', generate: 'server' });
  const cjs = esbuild.transformSync(out.js.code, { loader: 'js', format: 'cjs' }).code;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', cjs)(m, m.exports, createRequire(ROOT + '/x.js'));
  assert.ok(m.exports.default, 'SSR 元件沒編出來');
  return m.exports.default;
}
// ⚠ 只正規化「空白」：`{#if}` 分支即使沒有輸出也會留下一個空白節點，那不是畫面差異。
const norm = (h) => h.replace(/<!--[^>]*-->/g, '').replace(/\s+/g, ' ').trim();
const mkData = (t) => ({
  casual: { scope: 'online-only', games: 10, wins: 6, losses: 4, draws: 0, winRate: 0.6 },
  vsArchetype: [{ name: '噴火龍ex', games: 6, wins: 5, losses: 1, draws: 0, winRate: 5 / 6 }],
  tournament: t, since: 'v6.266', scanned: 10, truncated: false, scanCap: 5000,
});
const READY = (() => {
  const mod = loadDeckStats(DS)(mkFetch(() => jsonRes(200, baseBody())));
  assert.strictEqual(typeof mod.deckStatsTournamentReady, 'function', '判準出口不存在');
  return mod.deckStatsTournamentReady;                    // ⭐ 用出貨碼本尊當閘，不是自己另寫一份
})();
const PROBE = buildProbe(fragOf(DK));
const renderState = (t) => norm(svelteRender(PROBE, { props: { statsData: mkData(t), tournReady: READY(t) } }).body);
const S_OK = renderState(T_OK);
const S_NC = renderState(T_NOTCOLLECTED);
const S_OLD = renderState(T_OLD_SERVER);
const S_TRUNC = renderState({ ...T_OK, truncated: true });

await T('CS1 ⭐⭐【ok】算繪出錦標賽的勝率／場次／對各原型表，而且**不再出現**「累積中」', () => {
  assert.ok(S_OK.includes('<div class="ds-card-h">錦標賽</div> <div class="ds-rate">60.0%</div> <div class="ds-sub">5 場：3 勝 2 敗</div>'),
    '錦標賽欄沒有算繪出真數字：\n        ' + S_OK.slice(0, 500));
  assert.ok(!S_OK.includes('累積中'), 'ok 態竟然還顯示「累積中」');
  assert.ok(S_OK.includes('對各牌組原型的勝率（錦標賽）') && S_OK.includes('狂灑冰晶'), '錦標賽的對各原型表沒有算繪出來');
  assert.ok(S_OK.includes('對各牌組原型的勝率（休閒）'), '有兩張表時休閒那張沒有標示');
  assert.ok(S_OK.includes('錦標賽的統計<b>自 vX.YZ 起計</b>'),
    'since 沒有從伺服器欄位算繪出來（是不是寫死了？）：\n        ' + S_OK.slice(-400));
});
await T('CS2 ⭐【not-collected】算繪出「累積中」＋「自 {since} 起的賽事還沒有這副牌的紀錄」', () => {
  assert.ok(S_NC.includes('<div class="ds-rate ds-pending">累積中</div> <div class="ds-sub">自 vX.YZ 起的賽事還沒有這副牌的紀錄</div>'),
    'not-collected 態算繪錯了：\n        ' + S_NC.slice(0, 500));
  assert.ok(!S_NC.includes('（錦標賽）'), '沒有資料卻算繪出錦標賽的對各原型表');
});
await T('CS3 ⭐⭐⭐【舊伺服器】算繪出來的整塊畫面與 BASE **逐字相同**（fail-open，畫面零改變）', () => {
  assert.ok(S_OLD.includes('<div class="ds-rate ds-pending">累積中</div> <div class="ds-sub">賽事的牌組紀錄尚未開始收集</div>'),
    '舊伺服器態沒有落回 v6.267 的原文：\n        ' + S_OLD.slice(0, 500));
  if (!hasBaseCommit(ROOT, BASE_SHA)) {
    shallowSkip('test-v6277【CS3】與 BASE 算繪逐字比對（需要 BASE blob）', '上面那條逐字原文比對不需要歷史，仍在守');
    return;
  }
  const b = readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte');
  assert.ok(b.ok, '讀不到 BASE blob');
  const baseHtml = norm(svelteRender(buildProbe(fragOf(b.out)), { props: { statsData: mkData(T_OLD_SERVER) } }).body);
  assert.ok(baseHtml.length > 600, 'BASE 算繪只有 ' + baseHtml.length + ' 字元 —— 探針壞了？');
  assert.strictEqual(S_OLD, baseHtml,
    '舊伺服器看到的畫面與 BASE 不同（fail-open 應該逐字相同）：\n        修後：' + S_OLD + '\n        BASE：' + baseHtml);
  console.log('        舊伺服器態：修後與 BASE 算繪逐字相同（' + baseHtml.length + ' 字元）');
});
await T('CS4 ⭐【truncated】算繪出「錦標賽只統計最近 N 場賽事」', () => {
  assert.ok(S_TRUNC.includes('錦標賽只統計最近 300 場賽事'),
    'truncated 為真時沒有告訴玩家：\n        ' + S_TRUNC.slice(-400));
  assert.ok(!S_OK.includes('只統計最近'), 'truncated 為假時不該出現這句');
});
await T('CS5 [正對照] 三態的休閒那兩欄**算繪結果**逐字相同（休閒側零影響）', () => {
  const casualOf = (h) => h.slice(0, h.indexOf('<div class="ds-card-h">錦標賽</div>'));
  assert.strictEqual(casualOf(S_OK), casualOf(S_NC));
  assert.strictEqual(casualOf(S_OK), casualOf(S_OLD));
  assert.ok(casualOf(S_OK).includes('<div class="ds-rate">60.0%</div> <div class="ds-sub">10 場：6 勝 4 敗</div>'),
    '休閒欄算繪錯了：' + casualOf(S_OK));
  const tableOf = (h) => h.slice(h.indexOf('<h4 class="ds-h4">對各牌組原型的勝率'), h.indexOf('<ul class="ds-notes">'));
  assert.ok(tableOf(S_NC).includes('噴火龍ex') && tableOf(S_NC).includes('83.3%'), '休閒的對各原型表算繪錯了');
  assert.strictEqual(tableOf(S_NC), tableOf(S_OLD));
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【D】⭐⭐ /decks 載入請求數（量測）════════════════════════════════════');
const lpNow = loadPathOf(DK);
const sitesNow = netCallSites(lpNow.all);
console.log('        修後載入區段：onMount ' + lpNow.mount.length + ' 字元、$state 初始化 ' + lpNow.inits.length + ' 個、$effect ' + lpNow.effects + ' 個');
console.log('        修後載入區段的網路呼叫點：' + sitesNow.join('  '));
await T('D1 ⭐⭐⭐ 載入區段沒有 fetchDeckStats(／deckStatsTournamentReady(（點下去才打）', () => {
  assert.ok(!sitesNow.some((s) => s.startsWith('fetchDeckStats(')), '載入區段出現 fetchDeckStats：' + sitesNow.join(','));
  assert.ok(!sitesNow.some((s) => s.startsWith('deckStatsTournamentReady(')), '載入區段出現 deckStatsTournamentReady：' + sitesNow.join(','));
});
await T('D2 ⭐ /api/deck-stats 只在 openDeckStats 內打，全檔恰 1 次', () => {
  assert.strictEqual(DK.split('fetchDeckStats(').length - 1, 1, '全檔 fetchDeckStats 呼叫不是 1 次');
  const fn = extractFn(DK, '  async function openDeckStats(d: Deck) {', 200, 'openDeckStats');
  assert.strictEqual(fn.split('fetchDeckStats(').length - 1, 1);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【E】⭐⭐ Firestore 讀取次數（剝整行註解後的呼叫點逐字計數）════════════');
// ⭐v6.312 剝除器正對照樣本（E0a／【H】共用）：純註解全剔掉、真呼叫點一個都不能少。
//   上半：純註解（//、/* */ 單行、真正的 /** … */ 區塊含 * 續行、<!-- --> 單行與跨行、行尾註解）。
//   下半：v6.311 會整行吃掉的四種**合法程式碼**（獨立審查者的 B1~B4），每一種各帶一個真呼叫點。
const STRIP_PROBE = [
  "import { loadDecksFromCloud } from '$lib/decks/cloud';",
  '// 每一個殘留 callback 都各跑一次 loadDecksFromCloud（每副牌 1 次）',
  '/* loadDecksFromCloud( 區塊單行 */',
  '/**',
  ' * loadDecksFromCloud( 續行（真正的區塊裡）',
  ' */',
  '<!-- loadDecksFromCloud( 模板註解 -->',
  '<!--',
  '  loadDecksFromCloud( 跨行模板註解',
  '-->',
  'const cloud = await loadDecksFromCloud(u.uid); // 行尾註解也提到 loadDecksFromCloud',
  '/* B1 */ const b1 = await loadDecksFromCloud(u.uid);',
  'const b2 = 1',
  '  * (await loadDecksFromCloud(u.uid)).length;',
  '<!-- B3 --> {await loadDecksFromCloud(u.uid)}',
  '/* B4',
  ' */ const b4 = await loadDecksFromCloud(u.uid);',
].join('\n');
// 期望值（手算）：不帶括號＝import 1 ＋ 真呼叫行 2（該行的行尾註解一起留＝保守）＋ B1~B4 各 1 ＝ 7；帶括號＝真呼叫 1 ＋ B1~B4 ＝ 5
const STRIP_PROBE_EXPECT = { loadDecksFromCloud: 7, 'loadDecksFromCloud(': 5 };
function assertStripProbe(mod = stripMod) {
  const c = mod.countTokensStripped(STRIP_PROBE, ['loadDecksFromCloud', 'loadDecksFromCloud('], { label: 'probe', minRatio: 0.3, mustKeep: ['loadDecksFromCloud('] });
  assert.deepStrictEqual(c, STRIP_PROBE_EXPECT, '剝除器計數不對：' + JSON.stringify(c));
}
await T('E0a ⭐⭐ 剝除器正對照：純註解裡的 token 全剔掉、真呼叫點（含 B1~B4 四種合法樣式）一個都不少', () => {
  assert.strictEqual(STRIP_PROBE.split('loadDecksFromCloud').length - 1, 12, '樣本自己就不對');
  assert.strictEqual(STRIP_PROBE.split('loadDecksFromCloud(').length - 1, 9, '樣本自己就不對（帶括號）');
  assertStripProbe();
  // 逐一：B1~B4 各自單獨也留得住（不是靠別行補數）
  for (const [k, line] of Object.entries({
    B1: '/* v6.312 */ const again = await loadDecksFromCloud(u.uid);',
    B2: 'const n = 1\n  * (await loadDecksFromCloud(u.uid)).length;',
    B3: '<!-- x --> {await loadDecksFromCloud(u.uid)}',
    B4: '/* block\n */ const again = await loadDecksFromCloud(u.uid);',
  })) assert.strictEqual(stripMod.stripCommentLines(line).split('loadDecksFromCloud(').length - 1, 1, k + ' 被剝除器吃掉了');
});
await T('E0b ⭐⭐ 反面對照（第 13 種安慰劑）：// 註解裡的 /api/x/* 會讓 block regex 吃掉真呼叫點；行級剝除器不會', () => {
  const trap = "// 伺服器在每個 /api/tournament/* 回應帶 X-Srv-Ms\nconst cloud = await loadDecksFromCloud(u.uid);\ntry { x(); } catch { /* ignore */ }\n";
  const blockRe = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.strictEqual(blockRe(trap).split('loadDecksFromCloud(').length - 1, 0, '樣本沒有重現「一路吃掉」⇒ 這條反面對照是假的');
  assert.strictEqual(stripMod.stripCommentLines(trap).split('loadDecksFromCloud(').length - 1, 1, '行級剝除器也把真呼叫點吃掉了');
  // ⭐v6.312：反面對照**只用內嵌樣本**。v6.311 這裡另外斷言真檔 game/+page.svelte 必須存在「// … /api/x/*」那一行，
  //   等於守衛的綠紅取決於某一行註解在不在 —— 跟這次的病根（註解影響守衛）同型，拿掉。
});
await T('E0c ⭐ 護欄自驗：長度護欄與正對照都會炸（AssertionError），不是恆真', () => {
  assert.throws(() => stripMod.stripCommentsChecked('// a\n// b\n// c\nx = 1;', { label: 'p', minRatio: 0.5 }),
    (e) => e instanceof assert.AssertionError && /只剩/.test(e.message), '長度護欄沒炸');
  assert.throws(() => stripMod.stripCommentsChecked('const x = 1;', { label: 'p', mustKeep: ['loadDecksFromCloud('] }),
    (e) => e instanceof assert.AssertionError && /正對照/.test(e.message), '正對照沒炸');
  assert.throws(() => stripMod.stripCommentsChecked('', { label: 'p' }), assert.AssertionError, '空輸入沒炸');
  assert.strictEqual(stripMod.stripCommentsChecked('const x = 1;', { label: 'p', mustKeep: ['x = 1'] }), 'const x = 1;');
  // ⭐v6.312 區塊長度護欄：行首開的區塊 >150 行（或沒收尾）要炸；長度護欄過得了（程式碼佔 60%）也照炸 —— 兩道獨立
  const longBlock = '/*\n' + ' x\n'.repeat(200) + '*/\n' + 'const y = 1;\n'.repeat(300);
  assert.throws(() => stripMod.stripCommentsChecked(longBlock, { label: 'p' }),
    (e) => e instanceof assert.AssertionError && /長達 202 行/.test(e.message), '區塊護欄沒炸');
  assert.throws(() => stripMod.stripCommentsChecked('/* 沒收尾\n' + 'const y = 1;\n'.repeat(10), { label: 'p' }),
    (e) => e instanceof assert.AssertionError && /沒有收尾/.test(e.message), '未收尾區塊沒炸');
  assert.ok(stripMod.stripCommentsChecked(longBlock, { label: 'p', maxBlockLines: 300 }).includes('const y = 1;'), '明寫 maxBlockLines 應放行');
  // 反面：`// … /api/x/*` 這種行中 /* 永遠不會開區塊（事故 2 的根因）
  const st = stripMod.stripCommentLinesWithStats('// 每個 /api/tournament/* 回應\nconst a = 1;\nconst b = 2; /* 行尾 */\nx();');
  assert.strictEqual(st.blocks.length, 0, '行中的 /* 開了區塊：' + JSON.stringify(st.blocks));
  assert.strictEqual(st.out, 'const a = 1;\nconst b = 2; /* 行尾 */\nx();');
});
const FS_NOW = { DK: fsCounts(DK, 'DK'), GP: fsCounts(GP, 'GP'), DS: fsCounts(DS, 'DS') };
const ratioOf = (t, which) => (stripMod.stripCommentLines(t).length / t.length * 100).toFixed(1) + '%';
console.log('        /decks   ：' + JSON.stringify(FS_NOW.DK) + '（剝註解後剩 ' + ratioOf(DK) + '）');
console.log('        /game    ：' + JSON.stringify(FS_NOW.GP) + '（剝註解後剩 ' + ratioOf(GP) + '）');
console.log('        deck-stats：' + JSON.stringify(FS_NOW.DS) + '（剝註解後剩 ' + ratioOf(DS) + '）');
await T('E1 ⭐⭐ deck-stats.ts 完全沒有 Firestore／firebase 的呼叫點（史料無關的絕對值）', () => {
  for (const [k, v] of Object.entries(FS_NOW.DS)) assert.strictEqual(v, 0, 'deck-stats.ts 出現 ' + k + ' ×' + v);
  assert.ok(!/firebase|firestore/i.test(DS), 'deck-stats.ts 竟然引用了 firebase');
});
await T('E2 ⭐⭐ /decks 的 Firestore 呼叫點與內嵌快照相同（history-free；只准變少）', () => {
  // 快照＝v6.271 守衛量到的同一組數字（歷史事實，不隨版本失效）。
  const SNAP = { 'getDoc(': 0, 'getDocs(': 0, 'setDoc(': 0, 'updateDoc(': 0, 'deleteDoc(': 0, 'onSnapshot(': 0, 'addDoc(': 0,
    loadDecksFromCloud: 3, syncDeckToCloud: 5, removeDeckFromCloud: 2, loadFavoritesFromCloud: 2, saveFavoritesToCloud: 2,
    'loadDecksFromCloud(': 2, 'syncDeckToCloud(': 4, 'removeDeckFromCloud(': 1, 'loadFavoritesFromCloud(': 1, 'saveFavoritesToCloud(': 1 };   // 帶括號欄 v6.312 從 9f500a55 量出手抄
  assert.deepStrictEqual(FS_NOW.DK, SNAP, '/decks 的 Firestore 呼叫點變了：' + JSON.stringify(FS_NOW.DK));
});
await T('E3 ⭐⭐⭐ 三個檔（剝註解後）的 Firestore 呼叫點等於已知答案表（history-free；淺複製也在守）', () => {
  assertFsMatchesTable();
  // 已知答案表自己的正對照：表裡至少有一個非零（不是掃了個空）
  assert.ok(FS_BASE.GP.loadDecksFromCloud > 0 && FS_BASE.DK.syncDeckToCloud > 0, '已知答案表是空的？');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【F】正對照：休閒兩欄逐字不變／v6.271 版面不回退 ═══════════════════════');
// ⭐ 內嵌快照＝v6.267 上線後那兩欄的**逐字**原文（history-free）。
const CASUAL_CARD = `          <div class="ds-card">
            <div class="ds-card-h">休閒對戰（線上）</div>
            <div class="ds-rate">{fmtWinRate(statsData.casual.winRate)}</div>
            <div class="ds-sub">{statsData.casual.games} 場：{statsData.casual.wins} 勝 {statsData.casual.losses} 敗{#if statsData.casual.draws > 0} {statsData.casual.draws} 平{/if}</div>
          </div>`;
const CASUAL_TABLE = `        {#if statsData.vsArchetype.length === 0}
          <p class="ds-msg">還沒有可以分類的對手牌組。累積幾場線上休閒對戰之後就會出現。</p>
        {:else}
          <div class="ds-table-wrap">
            <table class="ds-table">
              <thead>
                <tr><th>對手的牌組原型</th><th>場次</th><th>勝敗</th><th>勝率</th></tr>
              </thead>
              <tbody>
                {#each statsData.vsArchetype as row (row.name)}
                  <tr>
                    <td class="ds-name">{row.name}</td>
                    <td>{row.games}</td>
                    <td>{row.wins} 勝 {row.losses} 敗{#if row.draws > 0} {row.draws} 平{/if}</td>
                    <td class:ds-good={row.winRate !== null && row.winRate >= 0.55} class:ds-bad={row.winRate !== null && row.winRate <= 0.45}>{fmtWinRate(row.winRate)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}`;
await T('F1 ⭐⭐ 休閒那一欄（勝率卡）逐字不變', () => {
  assert.ok(DK.includes(CASUAL_CARD), '休閒勝率卡被改動了');
});
await T('F2 ⭐⭐ 休閒的「對各牌組原型」表逐字不變', () => {
  assert.ok(DK.includes(CASUAL_TABLE), '休閒的對各原型表被改動了');
});
await T('F3 ⭐ 「累積中」那一態的說明文字逐字保留（舊伺服器看到的畫面不變）', () => {
  assert.ok(DK.includes('賽事的牌組紀錄尚未開始收集'), '舊伺服器那一態的說明文字被拿掉了');
  assert.ok(DK.includes('<li>這份統計<b>自 {statsData.since} 起計</b>，在那之前的對戰沒有紀錄、不會列入。</li>'),
    '「累積中」那一態的第一條註記不再逐字相同');
  assert.ok(DK.includes('<li>只計算線上休閒對戰；與電腦對戰、同一台裝置的雙人對戰都不列入。</li>'),
    '「累積中」那一態的第二條註記不再逐字相同');
});
await T('F4 ⭐ v6.271 的版面不回退（左欄 260px／名稱兩行截斷；完整幾何模型在 test-v6271）', () => {
  assert.ok(DK.includes('grid-template-columns: 260px minmax(0, 1fr) minmax(0, 1fr);'), '左欄寬度被改回去了');
  assert.ok(/-webkit-line-clamp: [2-9]/.test(DK), '.deck-name 的兩行截斷被改回去了');
});
await T('F5 ⭐⭐⭐ Deck.id 仍是 crypto.randomUUID()（「戰績跟著檔案走」的基礎）', () => {
  assert.ok(/crypto\.randomUUID\(\)/.test(ST), 'storage.ts 不再用 crypto.randomUUID()');
  const fn = extractFn(ST, 'export function upsertDeck(', 100, 'upsertDeck');
  assert.ok(!/randomUUID/.test(fn), 'upsertDeck 竟然會產生新 id ⇒ 編輯牌組會讓戰績歸零');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【G】HEAD-FAIL：對 BASE(v6.276) 的原始碼，A~E 的每一條各自紅 ══════════');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('test-v6277【G】HEAD-FAIL（需要 BASE blob）', '【H】突變測試與內嵌 BASE 快照不需要歷史，仍在守');
} else {
  const bGP = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  const bDS = readBaseBlob(ROOT, BASE_SHA, 'src/lib/decks/deck-stats.ts');
  const bDK = readBaseBlob(ROOT, BASE_SHA, 'src/routes/decks/+page.svelte');
  assert.ok(bGP.ok && bDS.ok && bDK.ok, '讀不到 BASE blob');
  const reds = [];
  const red = async (label, f) => {
    let threw = false;
    try { await f(); } catch (e) { if (e instanceof assert.AssertionError) threw = true; else throw e; }
    reds.push([label, threw]);
  };
  await red('A1 /register 帶 deckId', async () => {
    const c = await runEnroll(bGP.out);
    assert.strictEqual(c[0][1].deckId, DECK.id);
  });
  await red('A2 /register-and-checkin 帶 deckId', async () => {
    const c = await runLateJoin(bGP.out);
    assert.strictEqual(c[0][1].deckId, DECK.id);
  });
  await red('A3 /propose 帶 deckId', async () => {
    const c = await runPropose(bGP.out);
    assert.strictEqual(c[0][1].deckId, DECK.id);
  });
  await red('B1 tournament 正規化出 since', async () => {
    const mod = loadDeckStats(bDS.out)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OK }))));
    const r = await mod.fetchDeckStats('D1');
    assert.strictEqual(r.data.tournament.since, 'vX.YZ');
  });
  await red('B4 有 deckStatsTournamentReady 這個判準出口', async () => {
    const mod = loadDeckStats(bDS.out)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OK }))));
    assert.strictEqual(typeof mod.deckStatsTournamentReady, 'function');
  });
  await red('C1 錦標賽欄由 tournReady 分岔', () => {
    assert.ok(/<div class="ds-card-h">錦標賽<\/div>\s*\{#if tournReady\}/.test(bDK.out));
  });
  await red('C4 錦標賽 truncated 的提示', () => {
    assert.ok(bDK.out.includes('{#if tournReady && statsData.tournament.truncated}'));
  });
  await red('C5 錦標賽的對各原型表', () => {
    assert.ok(bDK.out.includes('{#each statsData.tournament.vsArchetype as row (row.name)}'));
  });
  await T('G1 ⭐⭐ 對 BASE 的每一條**各自**紅（不是單一 crash）', () => {
    const notRed = reds.filter(([, r]) => !r).map(([l]) => l);
    assert.strictEqual(notRed.length, 0, 'BASE 上沒有紅的：' + notRed.join('、'));
    assert.ok(reds.length >= 7, '只跑了 ' + reds.length + ' 條 HEAD-FAIL');
    console.log('        BASE 上 ' + reds.length + '/' + reds.length + ' 條各自紅：' + reds.map(([l]) => l).join('、'));
  });
  await T('Ga ⭐⭐⭐【正對照 a】三個報名請求體的 BASE 快照沒有抄錯（拿真 BASE blob 對跑）', async () => {
    for (const [route, runner] of [['/register', runEnroll], ['/register-and-checkin', runLateJoin], ['/propose', runPropose]]) {
      const c = await runner(bGP.out);
      assert.strictEqual(c.length, 1, route + ' BASE 上打了 ' + c.length + ' 發');
      assert.strictEqual(JSON.stringify(c[0][1]), BASE_BODY[route],
        route + ' 的內嵌 BASE 快照與真 BASE blob 不符：\n        真 BASE：' + JSON.stringify(c[0][1]));
    }
    console.log('        三個入口的 BASE 快照逐位元核對通過');
  });
  await T('Gb ⭐⭐⭐【正對照 b】/decks 載入區段的網路呼叫點集合與 BASE 完全相同（量測）', () => {
    const lpBase = loadPathOf(bDK.out);
    const sitesBase = netCallSites(lpBase.all);
    console.log('        BASE 載入區段：' + sitesBase.join('  '));
    console.log('        修後載入區段：' + sitesNow.join('  '));
    assert.ok(sitesBase.length >= 4, 'BASE 只掃到 ' + sitesBase.length + ' 個呼叫點 —— 掃描器壞了？');
    assert.deepStrictEqual(sitesNow, sitesBase, '/decks 載入路徑的網路呼叫點變了 ⇒ 載入請求數變了');
    assert.strictEqual(lpNow.effects, lpBase.effects, '$effect 數量變了（' + lpBase.effects + ' → ' + lpNow.effects + '）');
    assert.strictEqual(lpNow.inits.length, lpBase.inits.length, '$state 數量變了');
  });
  await T('Gc ⭐⭐⭐【正對照 c】三個改動檔（剝註解後）的 Firestore 呼叫點與 BASE 逐字相同，且 BASE 等於已知答案表', () => {
    const base = { DK: fsCounts(bDK.out, 'DK'), GP: fsCounts(bGP.out, 'GP'), DS: fsCounts(bDS.out, 'DS') };
    // ① 已知答案表沒抄錯（拿真 BASE blob 核對）
    assert.deepStrictEqual(base.DK, FS_BASE.DK, '已知答案表 DK 與真 BASE 對不上：' + JSON.stringify(base.DK));
    assert.deepStrictEqual(base.GP, FS_BASE.GP, '已知答案表 GP 與真 BASE 對不上：' + JSON.stringify(base.GP));
    assert.deepStrictEqual(base.DS, FS_BASE.DS, '已知答案表 DS 與真 BASE 對不上：' + JSON.stringify(base.DS));
    // ② 現在的碼與 BASE 相同
    assert.deepStrictEqual(FS_NOW.DK, base.DK, '/decks 的 Firestore 呼叫點變了');
    assert.deepStrictEqual(FS_NOW.GP, base.GP, '/game 的 Firestore 呼叫點變了');
    assert.deepStrictEqual(FS_NOW.DS, base.DS, 'deck-stats.ts 的 Firestore 呼叫點變了');
    console.log('        BASE /decks：' + JSON.stringify(base.DK) + '（剝註解後剩 ' + ratioOf(bDK.out) + '）');
    console.log('        BASE /game ：' + JSON.stringify(base.GP) + '（剝註解後剩 ' + ratioOf(bGP.out) + '）');
    // ③ 反面對照（⭐v6.312 改**內嵌樣本**、不綁真檔）：把 v6.307 那種註解行接到 BASE blob 後面 ——
    //    不剝註解就對不上 BASE、剝了就對得上 ⇒ 證明剝註解是必要的、不是裝飾。
    //    v6.311 這裡是拿工作樹 GP 與 BASE 比「不剝時必須不同」，等於要求真檔永遠留著那行註解（清掉註解守衛就紅）。
    const raw = (t) => { const o = {}; for (const k of FS_TOKENS) o[k] = t.split(k).length - 1; return o; };
    const withCmt = bGP.out + '\n// v6.307 風格：每一個殘留 callback 都各跑一次 loadDecksFromCloud(uid)\n';
    assert.notDeepStrictEqual(raw(withCmt), raw(bGP.out), '反面對照失效：多一行註解、不剝也對得上？');
    assert.deepStrictEqual(fsCounts(withCmt, 'GP'), base.GP, '剝了註解還是對不上 BASE ⇒ 剝除器沒把 // 行剔掉');
  });
  await T('Gd ⭐⭐【正對照 d】休閒兩欄的內嵌快照真的來自 BASE（逐字核對）', () => {
    assert.ok(bDK.out.includes(CASUAL_CARD), '休閒勝率卡的快照與 BASE 對不上 ⇒ F1 是在測不存在的形狀');
    assert.ok(bDK.out.includes(CASUAL_TABLE), '休閒對各原型表的快照與 BASE 對不上 ⇒ F2 是在測不存在的形狀');
  });
  await T('Ge ⭐【正對照 e】v6.277 的 game/+page.svelte 除了三個 deckId 之外逐字等於 v6.276', () => {
    if (!hasBaseCommit(ROOT, SELF_SHA)) {
      shallowSkip('v6277-Ge revert-diff', '需要 v6.277 的 commit；A1~A3 對工作樹的斷言仍在守');
      return;
    }
    const selfGP = readBaseBlob(ROOT, SELF_SHA, 'src/routes/game/+page.svelte');
    assert.ok(selfGP.ok, '讀不到 v6.277 的 game/+page.svelte');
    let t = selfGP.out;
    const undo = [
      ["    // ⭐⭐v6.277 套牌戰績（P3b）：報名時把這副牌的 `Deck.id` 一起送出（伺服器 v6.276 起收）。\n    //   ⚠⚠ 純 additive —— 請求體除了**多這一個 key** 之外逐位元不變（守衛 test-v6277 逐字證明），\n    //     伺服器端沒送／不合格一律**欄位缺席**，絕不因為它擋報名。\n", ''],
      ["      // ⭐⭐v6.277：補報到也要帶 deckId（三個報名入口一個都不能漏，否則那些場次永遠算不進戰績）。\n", ''],
      ["      // ⭐⭐v6.277：發起社群賽＝發起者自動報名，同樣要帶 deckId（第三個入口）。\n", ''],
      ['coinPref: tCoinPref, deckId: deck.id });', 'coinPref: tCoinPref });'],
      ['coinPref: tCoinPref, ver: VERSION, deckId: deck.id });', 'coinPref: tCoinPref, ver: VERSION });'],
    ];
    for (const [a, b] of undo) {
      assert.ok(t.includes(a), 'game/+page.svelte 的還原字串對不上（被第三度改動？）：' + a.slice(0, 60));
      t = t.split(a).join(b);
    }
    assert.strictEqual(t, bGP.out, 'game/+page.svelte 除了三個 deckId 之外還被動到別的地方');
  });
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【H】突變測試（沒紅＝守衛沒測到，不是「這件事不重要」）══════════════════');
const mut = async (label, mutate, check) => {
  const src = mutate();
  assert.notStrictEqual(src.changed, false, label + '：突變沒改到東西（樣式對不上＝守衛在測不存在的形狀）');
  let red = false;
  try { await check(src.out); } catch (e) { if (e instanceof assert.AssertionError) red = true; else throw e; }
  await T('H ' + label + ' ⇒ 必須紅', () => assert.ok(red, '突變沒有翻紅 ⇒ 先假設守衛沒測到'));
};
const mk = (src, a, b) => ({ out: src.replace(a, b), changed: src.includes(a) && src.replace(a, b) !== src });

await mut('H1 /propose 忘了帶 deckId（最容易漏的第三個入口）',
  () => mk(GP, "coinPref: tCoinPref, deckId: deck.id });\n      if (r?.error) tError = r.error; else { tProposeOpen = false;",
    "coinPref: tCoinPref });\n      if (r?.error) tError = r.error; else { tProposeOpen = false;"),
  async (out) => { const c = await runPropose(out); assert.strictEqual(c[0][1].deckId, DECK.id); });

await mut('H2 /register 把 deckId 插在中間（改變既有 key 順序＝請求體不再逐位元相同）',
  () => mk(GP, "{ eventId, name: nick, deckName: deck.name, deckEntries: deck.entries, coinPref: tCoinPref, deckId: deck.id }",
    "{ eventId, deckId: deck.id, name: nick, deckName: deck.name, deckEntries: deck.entries, coinPref: tCoinPref }"),
  async (out) => {
    const c = await runEnroll(out);
    const { deckId, ...rest } = c[0][1];
    assert.strictEqual(JSON.stringify(rest), BASE_BODY['/register']);
    assert.strictEqual(Object.keys(c[0][1])[Object.keys(c[0][1]).length - 1], 'deckId');
  });

await mut('H3 /register 順手改了既有欄位（deckName → deck.id）',
  () => mk(GP, "deckName: deck.name, deckEntries: deck.entries, coinPref: tCoinPref, deckId: deck.id }",
    "deckName: deck.id, deckEntries: deck.entries, coinPref: tCoinPref, deckId: deck.id }"),
  async (out) => {
    const c = await runEnroll(out);
    const { deckId, ...rest } = c[0][1];
    assert.strictEqual(JSON.stringify(rest), BASE_BODY['/register']);
  });

await mut('H4 ⭐⭐ since 判準改成寫死某一版（第九種安慰劑：pin 死版本號）',
  () => mk(DS, "  if (!t.since) return false;          // 舊伺服器（欄位缺席）⇒ fail-open 退回「累積中」",
    "  if (t.since !== 'v6.276') return false;"),
  async (out) => {
    const mod = loadDeckStats(out)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OK }))));
    await mod.fetchDeckStats('D1');
    for (const s of ['v6.276', 'v7.001', 'v99.999']) {
      assert.strictEqual(mod.deckStatsTournamentReady({ ...T_OK, since: s }), true, 'since=' + s + ' 被判 false');
    }
  });

await mut('H5 ⭐⭐ 舊伺服器 fail-open 被拿掉（沒有 since 也顯示真數字 ⇒ 0 勝 0 敗騙玩家）',
  () => mk(DS, "  if (!t.since) return false;          // 舊伺服器（欄位缺席）⇒ fail-open 退回「累積中」\n", ''),
  async (out) => {
    const mod = loadDeckStats(out)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OLD_SERVER }))));
    const r = await mod.fetchDeckStats('D1');
    assert.strictEqual(mod.deckStatsTournamentReady(r.data.tournament), false);
    assert.strictEqual(mod.deckStatsTournamentReady({ ...T_OK, since: '' }), false);
  });

await mut('H6 normalize 把 tournament.since 寫死成某個版本（不再讀伺服器欄位）',
  () => mk(DS, "      since: toStr(t.since, ''),", "      since: toStr(t.since, 'v6.276'),"),
  async (out) => {
    const mod = loadDeckStats(out)(mkFetch(() => jsonRes(200, baseBody({ tournament: T_OLD_SERVER }))));
    const r = await mod.fetchDeckStats('D1');
    assert.strictEqual(r.data.tournament.since, '', 'since 沒有落回空字串（實得 ' + r.data.tournament.since + '）');
  });

await mut('H7 錦標賽 truncated 不告訴玩家（悄悄只算最近 N 場）',
  () => mk(DK, "          {#if tournReady && statsData.tournament.truncated}\n", "          {#if false}\n"),
  (out) => {
    const i = out.indexOf('<div class="ds-card-h">錦標賽</div>');
    const seg = out.slice(i - 200, out.indexOf('</ul>', i) + 5);
    assert.ok(seg.includes('{#if tournReady && statsData.tournament.truncated}'), 'truncated 提示不見了');
  });

await mut('H8 ⭐ 把放大鏡的請求搬到 onMount（＝載入就多打一發）',
  () => mk(DK, '    loadIndex().then((setIndex) => {', '    fetchDeckStats("x");\n    loadIndex().then((setIndex) => {'),
  (out) => {
    const sites = netCallSites(loadPathOf(out).all);
    assert.ok(!sites.some((s) => s.startsWith('fetchDeckStats(')), '載入區段出現 fetchDeckStats：' + sites.join(','));
  });

await mut('H9 休閒那一欄被順手改掉（正對照必須抓到）',
  () => mk(DK, '<div class="ds-card-h">休閒對戰（線上）</div>', '<div class="ds-card-h">休閒對戰</div>'),
  (out) => { assert.ok(out.includes(CASUAL_CARD), '休閒勝率卡被改動了'); });

await mut('H10 ⭐⭐ 錦標賽欄的 else 分支被改掉（舊伺服器看到的畫面不再與 BASE 相同）',
  () => mk(DK, "'賽事的牌組紀錄尚未開始收集'", "'尚未開始收集'"),
  (out) => {
    const html = norm(svelteRender(buildProbe(fragOf(out)), { props: { statsData: mkData(T_OLD_SERVER), tournReady: false } }).body);
    assert.ok(html.includes('<div class="ds-rate ds-pending">累積中</div> <div class="ds-sub">賽事的牌組紀錄尚未開始收集</div>'),
      '舊伺服器態沒有落回 v6.267 的原文');
  });
await mut('H11 ⭐⭐ tournReady 為真時仍然畫「累積中」（三態接錯線）',
  () => mk(DK, '            {#if tournReady}\n              <div class="ds-rate">{fmtWinRate(statsData.tournament.winRate)}</div>',
    '            {#if false}\n              <div class="ds-rate">{fmtWinRate(statsData.tournament.winRate)}</div>'),
  (out) => {
    const html = norm(svelteRender(buildProbe(fragOf(out)), { props: { statsData: mkData(T_OK), tournReady: true } }).body);
    assert.ok(!html.includes('累積中'), 'ok 態竟然還顯示「累積中」');
  });

// ── ⭐v6.311 剝註解計數的突變測試（每一條都要紅在**指定的那一條訊息**；只捕 AssertionError）──────
//   突變 helper 本身：把 scripts/lib/strip-comments.mjs 的原始碼改壞，用 data: URL 匯入（不落地暫存檔，
//   併行跑其他守衛也不會互相干擾）。
const STRIP_SRC = readFileSync(join(ROOT, 'scripts/lib/strip-comments.mjs'), 'utf8');
async function mutStripMod(pairs) {
  let src = STRIP_SRC;
  for (const [a, b] of pairs) {
    assert.strictEqual(src.split(a).length - 1, 1, '突變錨點不唯一或不存在（helper 的形狀變了）：' + a.slice(0, 70));
    src = src.replace(a, b);
  }
  assert.notStrictEqual(src, STRIP_SRC, '突變沒改到 helper');
  return import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
}
const KEEP_LINE = '    keepFrom[i] = 0;                                         // d. 其餘一律保留';   // ⭐v6.323 錨點：狀態機改產 keepFrom（單一真相），刪行／留白兩種渲染都從它導出
const EAT_ALL = ["  return out.join('\\n');                                   // 渲染①（刪行）的唯一出口", "  return '';                                               // 渲染①（刪行）的唯一出口"];   // 剝除器吃掉整檔
const EAT_TOKEN_LINES = [KEEP_LINE, "    keepFrom[i] = line.includes('loadDecksFromCloud') ? -1 : 0;"]; // 只吃掉含 token 的行（長度護欄過得了）
// ⭐v6.312 helper 自身回歸的突變（每一種都是「退回 v6.311 的吃法」）：
const EAT_STAR_LINES = [KEEP_LINE, "    keepFrom[i] = /^\\s*\\*/.test(line) ? -1 : 0;"];            // 丟掉 * 開頭的行（B2 假綠）
const EAT_TAIL_SINGLE = ['      keepFrom[i] = k + cl.length;                           // b. 單行區塊，尾巴保留（B1、B3）', '      keepFrom[i] = -1;'];
const EAT_TAIL_CLOSE = ['      keepFrom[i] = from;                                    // c. 收尾後的尾巴保留（B4）', '      keepFrom[i] = -1;'];
const OPEN_MIDLINE = ["      if (!t.startsWith(open)) continue;", "      if (!line.includes(open)) continue;"];              // 行中 /* 也開區塊（事故 2 的根因）
const NO_BLOCK_GUARD = ['  const bad = blocks.find((b) => !b.closed || b.lines > maxBlockLines);', '  const bad = null;'];
const NO_RATIO_GUARD = ['  assert.ok(ratio >= minRatio,\n', '  assert.ok(true,\n'];
const NO_MUSTKEEP = ['  for (const k of mustKeep) {\n', '  for (const k of []) {\n'];
const mutRe = async (label, run, expectRe) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  await T('H ' + label + ' ⇒ 必須紅在 ' + expectRe, () => {
    assert.ok(err, '突變沒有翻紅 ⇒ 先假設守衛沒測到');
    assert.ok(expectRe.test(err.message), '紅在別的地方：' + err.message.slice(0, 200));
  });
};
const mutGreen = async (label, run) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  await T('H ' + label + ' ⇒ 必須綠', () => assert.ok(!err, '不該紅卻紅了：' + (err && err.message.slice(0, 200))));
};
const GP_CALL = 'const cloud = await loadDecksFromCloud(u.uid);';
assert.strictEqual(GP.split(GP_CALL).length - 1, 1, '突變錨點（真呼叫點）不唯一：' + GP_CALL);

await mutRe('H12 ⭐⭐⭐ game/+page.svelte 多一個**真的** loadDecksFromCloud( 呼叫（守衛還在守）',
  () => assertFsMatchesTable({ gp: GP.replace(GP_CALL, GP_CALL + '\n      const again = await loadDecksFromCloud(u.uid);') }),
  /\/game 的 Firestore 呼叫點變了/);
// ⭐⭐⭐ v6.312 主證明：B1~B4 四種合法程式碼各多一個**真的**呼叫點 —— v6.311 全部假綠（剝後仍是 2），現在必須紅
for (const [k, mut] of Object.entries({
  B1: GP_CALL + '\n      /* v6.312 */ const again = await loadDecksFromCloud(u.uid);',
  B2: GP_CALL + '\n      const n = 1\n        * (await loadDecksFromCloud(u.uid)).length;',
  B3: GP_CALL + '\n      <!-- x --> {await loadDecksFromCloud(u.uid)}',
  B4: GP_CALL + '\n      /* block\n      */ const again = await loadDecksFromCloud(u.uid);',
})) {
  await mutRe('H12-' + k + ' ⭐⭐⭐ game/+page.svelte 以「' + k + '」樣式多一個**真的** loadDecksFromCloud( 呼叫（v6.311 假綠）',
    () => assertFsMatchesTable({ gp: GP.replace(GP_CALL, mut) }),
    /\/game 的 Firestore 呼叫點變了/);
}
await mutRe('H12-ns ⭐⭐ 改成 `import * as cloud` 再呼叫兩次 cloud.loadDecksFromCloud(（不帶括號仍是 2 ⇒ v6.277 起假綠；帶括號版抓到）',
  () => {
    const gp = GP.replace(/^\s*import \{[^}]*loadDecksFromCloud[^}]*\} from '\$lib\/decks\/cloud';[^\n]*\n/m, "import * as cloud from '$lib/decks/cloud';\n")
      .replace(GP_CALL, 'const cloud1 = await cloud.loadDecksFromCloud(u.uid);\n      const cloud2 = await cloud.loadDecksFromCloud(u.uid);');
    assert.strictEqual(gp.split('loadDecksFromCloud').length - 1, GP.split('loadDecksFromCloud').length - 1, '突變沒做到「不帶括號計數不變」（樣本錯）');
    assertFsMatchesTable({ gp });
  },
  /\/game 的 Firestore 呼叫點變了/);
await mutGreen('H13 ⭐⭐⭐ game/+page.svelte 多幾行**註解**提到 loadDecksFromCloud（假紅已修好；⭐v6.312 樣本改成真正的區塊）',
  () => assertFsMatchesTable({ gp: GP.replace(GP_CALL,
    '// 以前這裡會對每個殘留 callback 各跑一次 loadDecksFromCloud(uid)\n' +
    '      /* 區塊單行：loadDecksFromCloud(uid) */\n' +
    '      /**\n' +
    '       * 續行：loadDecksFromCloud(uid)\n' +
    '       */\n' +
    GP_CALL) }));
await mutRe('H14 ⭐⭐ 剝除器吃掉整檔（護欄還在）',
  async () => assertFsMatchesTable({ mod: await mutStripMod([EAT_ALL]) }),
  /剝註解後只剩/);
await mutRe('H15 ⭐⭐ 剝除器吃掉整檔 ＋ 長度護欄被拿掉 ＋ 正對照被拿掉 ⇒ 已知答案表仍抓到（三層各自獨立）',
  async () => assertFsMatchesTable({ mod: await mutStripMod([EAT_ALL, NO_RATIO_GUARD, NO_MUSTKEEP]) }),
  /已知答案表不同/);
await mutRe('H16 ⭐⭐ 剝除器只吃掉含 token 的行（長度過得了護欄）⇒ 正對照抓到',
  async () => assertFsMatchesTable({ mod: await mutStripMod([EAT_TOKEN_LINES]) }),
  /正對照「loadDecksFromCloud\(」不見了/);
await mutRe('H16b 同上但正對照被拿掉 ⇒ 已知答案表抓到（BASE 與 NOW 同時歸零也不會恆等）',
  async () => assertFsMatchesTable({ mod: await mutStripMod([EAT_TOKEN_LINES, NO_MUSTKEEP]) }),
  /已知答案表不同/);
await mutRe('H17 ⭐ 把 loadDecksFromCloud 從 FS_TOKENS 拿掉（守衛被閹割）',
  () => assertFsMatchesTable({ tokens: FS_TOKENS.filter((t) => t !== 'loadDecksFromCloud') }),
  /已知答案表不同/);
await T('H18 ⭐ 反面對照：若 helper 沒被突變，同一條路徑是綠的（突變 harness 不是恆紅）', async () => {
  const same = await import('data:text/javascript;base64,' + Buffer.from(STRIP_SRC, 'utf8').toString('base64'));
  assertFsMatchesTable({ mod: same });
  assertStripProbe(same);
});
// ⭐v6.312 helper 自身回歸：退回 v6.311 的任何一種吃法，E0a 的正對照樣本都要抓到（紅在「剝除器計數不對」）
await mutRe('H19 ⭐⭐ helper 退化成「丟掉 * 開頭的行」（B2 假綠）⇒ 正對照樣本抓到',
  async () => assertStripProbe(await mutStripMod([EAT_STAR_LINES])), /剝除器計數不對/);
await mutRe('H20 ⭐⭐ helper 退化成「單行區塊後的尾巴不留」（B1、B3 假綠）⇒ 正對照樣本抓到',
  async () => assertStripProbe(await mutStripMod([EAT_TAIL_SINGLE])), /剝除器計數不對/);
await mutRe('H21 ⭐⭐ helper 退化成「區塊收尾行的尾巴不留」（B4 假綠）⇒ 正對照樣本抓到',
  async () => assertStripProbe(await mutStripMod([EAT_TAIL_CLOSE])), /剝除器計數不對/);
await mutRe('H22 ⭐⭐ helper 退化成「行中的 /* 也開區塊」（事故 2 的根因）⇒ 內嵌樣本上正對照抓到（真呼叫點被吃掉）',
  async () => {
    // 行中的 /* 出現在正則字面量裡（不是註解）；退化版會從這行開區塊、一路吃到下一個 */ ⇒ 真呼叫點不見
    const m = await mutStripMod([OPEN_MIDLINE]);
    const probe = "const re = /\\/api\\/*/;\nconst cloud = await loadDecksFromCloud(u.uid);\ntry { x(); } catch { /* ignore */ }\n" + 'const pad = 1;\n'.repeat(20);   // 墊高長度，讓抓到它的是正對照而不是長度護欄
    assert.strictEqual(stripMod.stripCommentLines(probe).split('loadDecksFromCloud(').length - 1, 1, '正常版反而吃掉了真呼叫點');
    m.stripCommentsChecked(probe, { label: 'probe', minRatio: 0.3, mustKeep: ['loadDecksFromCloud('] });
  }, /正對照「loadDecksFromCloud\(」不見了/);
await mutRe('H23 ⭐ 區塊長度護欄被拿掉 ⇒ E0c 的自驗抓到（區塊護欄沒炸）',
  async () => {
    const m = await mutStripMod([NO_BLOCK_GUARD]);
    const longBlock = '/*\n' + ' x\n'.repeat(200) + '*/\n' + 'const y = 1;\n'.repeat(300);
    assert.throws(() => m.stripCommentsChecked(longBlock, { label: 'p' }), (e) => e instanceof assert.AssertionError && /長達 202 行/.test(e.message), '區塊護欄沒炸');
  }, /區塊護欄沒炸/);
await mutRe('H24 ⭐ 正對照樣本的期望值被改壞（例如有人把 B2 從表裡拿掉）⇒ 樣本自檢抓到',
  () => {
    const c = stripMod.countTokensStripped(STRIP_PROBE, ['loadDecksFromCloud('], { label: 'probe', minRatio: 0.3 });
    assert.deepStrictEqual(c, { 'loadDecksFromCloud(': STRIP_PROBE_EXPECT['loadDecksFromCloud('] - 1 }, '剝除器計數不對：' + JSON.stringify(c));
  }, /剝除器計數不對/);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n══ 【I】自查 ═══════════════════════════════════════════════════════════');
await T('I1 本守衛在 package.json 的 test chain 裡（只加進 iron-rules-audit 等於沒加）', () => {
  const chain = JSON.parse(PK).scripts.test;
  assert.ok(chain.includes('scripts/test-v6277-deck-tournament-client.mjs'),
    'test chain 裡沒有本守衛 ⇒ deploy 的 build job 不會跑它');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.277 守衛：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
