#!/usr/bin/env node
/**
 * v6.157 守衛：錦標賽「開局死角」的 level-triggered 補推。
 *
 * ── 這一版在修什麼 ────────────────────────────────────────────────────────
 * `tryAdvanceToPlaying`（engine.ts）是 setup -> playing 的守門員，五個條件：
 *   (1) 互動式開局已定案 (2) 雙方 setupDone (3) pendingMulliganDraw 皆 0
 *   (4) mulliganRevealConfirmed 雙 true (5) mulliganPostBenchOpen 皆 false
 * 它是 **edge-triggered**：只在 applyAction 的 4 個 handler 結尾被呼叫。
 * 當「讓五條件湊齊的最後一筆狀態變化」走的是不呼叫它的路徑（線上 setup 合併／
 * CAS 寫回／版本 skew 補寫），而兩位玩家都在等對方、不會再送任何 action
 * ⇒ **永遠沒有人來推它**，房間停在 setup 一路卡到閒置判負。
 * ⇒ (A) bundle entry export 它 (B) 伺服器閒置掃描 level-triggered 補推一次。
 *
 * ── 這支測試的分工（哪些是真的 HEAD-FAIL）────────────────────────────────
 *   [HEAD-FAIL] 標記的條目：把 build-server-engine.mjs 與 server_admin_patch.js
 *     還原成 v6.156 的內容重跑，這些會 FAIL。
 *   第 3 節（引擎行為）在 v6.156 **也會 PASS** —— 它只證明「引擎的推進 gate 本身沒問題、
 *     死角確實推得動」，**不構成** HEAD-FAIL 證明。刻意保留是因為若哪天有人改壞了
 *     tryAdvanceToPlaying 的條件，(B) 的補推就會變成空轉。
 *   第 4 節是**行為端**：把伺服器那段真程式碼切出來，配真引擎 + 假 DB 實跑。
 *     ⚠ 「有呼叫某函式」不等於「那件事有發生」（v6.137 假回滾的教訓）——
 *       所以寫回、CAS、lastActionAt、不判輸贏，全部由實跑的結果釘住。
 *
 * Run: node scripts/test-v6157-setup-advance-level-triggered.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const BSE = readFileSync(join(ROOT, 'scripts/build-server-engine.mjs'), 'utf8');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══════════════════════════════════════════════════════════════════════════
// 0. 保長度的註解／字串剝除器 + 它自己的自我驗證
//    ⚠ 為什麼一定要剝：過去被騙過好幾次 —— `//` 註解裡寫了 `/api/*` 讓守衛把它當
//      block comment 開頭吃掉真程式碼（v6.149）、註解裡寫了 `{#if ...}` 字面量讓
//      守衛抓到假錨點（v6.149）。否定型斷言（「不存在某 pattern」）尤其致命。
//    ⚠ 保長度是刻意的：剝除後的索引與原始檔**逐字元對齊**，才能做「A 出現在 B 之前」
//      這種位置關係斷言（本檔第 2 節整節都靠它）。
// ══════════════════════════════════════════════════════════════════════════
function stripJs(s, mode = 'comments') {
  const out = s.split('');
  const wipeStrings = mode === 'all';
  const n = s.length;
  let i = 0, prev = '';
  const REGEX_PREV = '(,=:[!&|?{};+-*%~^<>';
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && s[i + 1] === '*') {
      let j = i + 2;
      while (j + 1 < n && !(s[j] === '*' && s[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      for (let k = i; k < j; k++) if (s[k] !== '\n') out[k] = ' ';
      i = j; continue;
    }
    if (c === '/' && REGEX_PREV.includes(prev)) {
      let j = i + 1, ok = false;
      while (j < n) {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '\n') break;
        if (s[j] === '/') { ok = true; break; }
        j++;
      }
      if (ok) { for (let k = i; k <= j; k++) out[k] = ' '; i = j + 1; prev = '/'; continue; }
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1;
      while (j < n) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === q) break; j++; }
      if (wipeStrings) for (let k = i + 1; k < Math.min(j, n); k++) if (s[k] !== '\n') out[k] = '.';
      i = Math.min(j, n - 1) + 1; prev = '"'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

T('[自我驗證] 剝除器：行註解裡的 /api/* 不會被當成 block comment 吃掉後面的真程式碼', () => {
  const got = stripJs('a// /api/* x\nREAL_CODE');
  assert.ok(got.includes('REAL_CODE'), '真程式碼被吃掉了: ' + JSON.stringify(got));
  assert.ok(!got.includes('/api/'), '註解沒被剝掉');
});
T('[自我驗證] 剝除器：多行 block comment 整段剝掉（逐行掃描會漏的那種）', () => {
  const got = stripJs('x/*aaa\nbbb TROOMS.updateOne(\nccc*/y');
  assert.ok(!got.includes('TROOMS.updateOne'), 'block comment 內的假錨點沒被剝掉');
  assert.ok(got.includes('x') && got.includes('y'));
});
T('[自我驗證] 剝除器：字串內容被抹掉但 http:// 不會被誤判成註解', () => {
  const got = stripJs("s='http://z'; REAL2");
  assert.ok(got.includes('REAL2'), '真程式碼被吃掉了: ' + JSON.stringify(got));
});
T('[自我驗證] 剝除器：註解裡的假錨點真的被剝掉（不是把它留著讓斷言矇對）', () => {
  const got = stripJs("// TROOMS.updateOne({ _id: x });\nREAL3");
  assert.ok(!got.includes('TROOMS.updateOne'), '註解裡的假錨點沒被剝掉');
  assert.ok(got.includes('REAL3'));
  const got2 = stripJs("const a = 'TROOMS.updateOne';", 'all');
  assert.ok(!got2.includes('TROOMS.updateOne'), "mode='all' 沒抹掉字串內容");
  const got3 = stripJs("const a = 'TROOMS.updateOne';");
  assert.ok(got3.includes('TROOMS.updateOne'), "mode='comments' 不該抹掉字串內容");
});
T('[自我驗證] 剝除器：保長度（位置關係斷言的前提）', () => {
  assert.equal(stripJs(SRC).length, SRC.length, 'server_admin_patch.js 剝除後長度改變');
  assert.equal(stripJs(SRC, 'all').length, SRC.length, "mode='all' 剝除後長度改變");
  assert.equal(stripJs(BSE).length, BSE.length, 'build-server-engine.mjs 剝除後長度改變');
});
// S   = 只剝註解（字串內容保留）—— 位置關係與 pattern 比對用這份，
//        主要威脅是「註解裡的字面量被誤當成真程式碼」，剝掉註解就擋住了。
// SALL = 連字串內容一起抹 —— 否定型斷言的第二道保險（防止「剛好寫在某個字串裡」矇混過關）。
const S = stripJs(SRC);
const SALL = stripJs(SRC, 'all');
T('[自我驗證/正對照] 剝除後既有真程式碼仍在（不是把整份檔案剝爆）', () => {
  for (const anchor of ['function currentActorSeat(gs) {', 'TENG.applyAction(', "TENG = require(TDIR + ", 'async function maybeIdleWarn60(']) {
    assert.ok(S.includes(anchor), '剝除後找不到既有真程式碼: ' + anchor);
  }
  assert.ok(S.length > SRC.length * 0.5, '剝除後有效字元少於一半，剝過頭了');
});

// ══════════════════════════════════════════════════════════════════════════
// 1. [HEAD-FAIL] bundle 進入點必須 export tryAdvanceToPlaying
//    沒有這一條，伺服器端 TENG.tryAdvanceToPlaying 永遠是 undefined，
//    第 2 節的補推會整條被 fail-open 跳過（而且只 warn 一次，很難發現）。
// ══════════════════════════════════════════════════════════════════════════
const mEntry = BSE.match(/writeFileSync\(ENTRY,\s*`([\s\S]*?)`\);/);
T('build-server-engine.mjs 的 entry 模板可定位', () => {
  assert.ok(mEntry && mEntry[1] && mEntry[1].length > 50, '找不到 writeFileSync(ENTRY, `...`)');
});
const ENTRY_CODE = mEntry ? stripJs(mEntry[1]) : '';
const importsFromEngine = (name) =>
  new RegExp('import\\s*\\{[^}]*\\b' + name + '\\b[^}]*\\}\\s*from\\s*\\S*game/engine').test(ENTRY_CODE);
// ⚠ 不要求 `}` 後緊接 `;` —— entry 裡有 `export { validateDeck } from '...';` 這種形式，
//   寫死 `};` 會讓正對照假 FAIL（而正對照假 FAIL 比真 FAIL 更容易被忽略成雜訊）。
const exportsName = (name) =>
  new RegExp('export\\s*\\{[^}]*\\b' + name + '\\b[^}]*\\}').test(ENTRY_CODE);
T('[HEAD-FAIL①a] entry 從 engine import tryAdvanceToPlaying', () => {
  assert.ok(importsFromEngine('tryAdvanceToPlaying'));
});
T('[HEAD-FAIL①b] entry export tryAdvanceToPlaying', () => {
  assert.ok(exportsName('tryAdvanceToPlaying'));
});
T('[正對照] 同樣的判法對既有的 createGame/applyAction/validateDeck 也成立（斷言本身不是恆真/恆假）', () => {
  assert.ok(importsFromEngine('createGame') && exportsName('createGame'), 'createGame');
  assert.ok(importsFromEngine('applyAction') && exportsName('applyAction'), 'applyAction');
  assert.ok(exportsName('validateDeck'), 'validateDeck');
  assert.ok(!importsFromEngine('thisNameDoesNotExist'), '反向：不存在的名字不該被判為有 import');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. [HEAD-FAIL] 伺服器閒置掃描：有呼叫 + 條件式寫回 + 位置關係
// ══════════════════════════════════════════════════════════════════════════
const BEGIN_MARK = 'v6.157 SETUP ADVANCE BLOCK BEGIN';
const END_MARK = 'v6.157 SETUP ADVANCE BLOCK END';
const iBegin = SRC.indexOf(BEGIN_MARK);
const iEnd = SRC.indexOf(END_MARK);
T('[HEAD-FAIL②a] 補推區塊可定位（BEGIN/END marker）', () => {
  assert.ok(iBegin > 0 && iEnd > iBegin, 'iBegin=' + iBegin + ' iEnd=' + iEnd);
});
// ⚠ 從 marker 所在**行的行首**切到 END marker 所在**行的行尾** —— 直接用 marker 的
//   字元位置切，開頭會是半截註解文字（沒有 `//` 前綴），第 4 節 new Function 會語法錯誤。
const iBeginLine = iBegin > 0 ? SRC.lastIndexOf('\n', iBegin) + 1 : -1;
const iEndLine = iEnd > 0 ? SRC.indexOf('\n', iEnd) : -1;
const BLOCK_RAW = iBeginLine >= 0 && iEndLine > iBeginLine ? SRC.slice(iBeginLine, iEndLine) : '';
const BLOCK = stripJs(BLOCK_RAW);
const BLOCK_ALL = stripJs(BLOCK_RAW, 'all');

const iCall = S.indexOf('TENG.tryAdvanceToPlaying(gs)');
T('[HEAD-FAIL②b] 伺服器**真的呼叫**了 TENG.tryAdvanceToPlaying(gs)（剝除註解後仍在 ⇒ 不是註解裡的字面量）', () => {
  assert.ok(iCall > 0, '剝除註解後找不到呼叫');
  assert.ok(iCall > iBegin && iCall < iEnd, '呼叫不在補推區塊內');
});
T('[HEAD-FAIL②c] 呼叫點在閒置掃描「算 actor」之前 —— 先試著救活，救不活才走判定', () => {
  const iActor = S.indexOf('const actor = currentActorSeat(gs);', iCall);
  assert.ok(iActor > iCall, '呼叫點之後找不到 currentActorSeat');
  assert.ok(iActor - iCall < 4000, '兩者距離過遠（' + (iActor - iCall) + '），可能不是同一段掃描');
});
T('[HEAD-FAIL②d] 呼叫點在 v6.156 的 pending-admin 死角處置之前', () => {
  const iPending = S.indexOf('pending-admin');
  assert.ok(iPending > 0, '找不到 pending-admin（v6.156 行為不見了？）');
  assert.ok(iCall < iPending, '補推寫在 pending-admin 之後 ⇒ 永遠先被判掉，等於沒效果');
});
T('[回歸] v6.156 的死角 pending-admin 處置仍在（推不動時的既有行為不可被拿掉）', () => {
  assert.ok(S.includes("status: 'pending-admin'"), 'pending-admin 寫回不見了');
  assert.ok(S.includes('deadlockDraw: true'), 'deadlockDraw 旗標不見了');
});

// ── 條件式寫回：用括號平衡切出 if 區塊，斷言**位置**而不只是「有出現」 ────────
const IF_HEAD = "if (advanced && advanced.phase === 'playing') {";
const iIf = S.indexOf(IF_HEAD);
function blockRange(str, openIdx) {
  let d = 0;
  for (let k = openIdx; k < str.length; k++) {
    if (str[k] === '{') d++;
    else if (str[k] === '}') { d--; if (d === 0) return [openIdx, k + 1]; }
  }
  return [openIdx, -1];
}
T('[HEAD-FAIL③a] 有「推進成功才寫回」的條件判斷，且在呼叫之後', () => {
  assert.ok(iIf > 0, '找不到 ' + IF_HEAD);
  assert.ok(iIf > iCall, '條件判斷寫在呼叫之前');
});
const IFR = iIf > 0 ? blockRange(S, S.indexOf('{', iIf + IF_HEAD.length - 1)) : [0, -1];
const IFBODY = IFR[1] > 0 ? S.slice(IFR[0], IFR[1]) : '';
T('[HEAD-FAIL③b] 條件區塊可用括號平衡切出', () => {
  assert.ok(IFBODY.length > 200, 'IFBODY 長度 ' + IFBODY.length);
});
T('[HEAD-FAIL③c] 寫回**在**條件區塊內（＝條件式寫回，不是無條件蓋盤面）', () => {
  assert.ok(IFBODY.includes('TROOMS.updateOne('), '條件區塊內沒有寫回');
  const iWriteGlobal = S.indexOf('TROOMS.updateOne(', iCall);
  assert.ok(iWriteGlobal >= IFR[0] && iWriteGlobal < IFR[1],
    '呼叫之後的第一個寫回不在條件區塊內 ⇒ 可能是無條件寫回');
});
T('[HEAD-FAIL③d] 寫回是 **CAS**（比對 room.version）—— 非終局的整包寫回不 CAS 會蓋掉玩家動作且版本號一樣', () => {
  assert.ok(/TROOMS\.updateOne\(\{\s*_id:\s*m\.roomId,\s*version:\s*room\.version\s*\}/.test(IFBODY),
    '寫回的 filter 沒有比對 version');
});
T('[HEAD-FAIL③e] 寫回有 bump 版本 + 更新 lastActionAt + 帶上 actorSeat', () => {
  assert.ok(/version:\s*room\.version\s*\+\s*1/.test(IFBODY), '沒有 bump version');
  assert.ok(/lastActionAt:\s*now/.test(IFBODY), '沒有更新 lastActionAt（下一輪掃描會把剛拿到行動權的人判負）');
  assert.ok(/actorSeat:\s*currentActorSeat\(/.test(IFBODY), '沒有更新伺服器權威 actorSeat（v6.151）');
});
T('[HEAD-FAIL③f] 有在房間 log 塞系統訊息（會 bump 版本，順便打醒版本卡住的 client）', () => {
  assert.ok(/og\.log\.push\(/.test(IFBODY), '沒有往 og.log push');
});
T('[HEAD-FAIL③g] 補推成功後 continue —— 本輪不判任何人輸贏', () => {
  assert.ok(/\bcontinue;/.test(IFBODY), '沒有 continue');
});
T('[否定型/已剝註解] 補推區塊內不得出現任何判負或推進輪次的呼叫', () => {
  for (const bad of ['advanceOrFinish', 'checkRoundAdvance', 'winnerUid', "status: 'done'", 'idleForfeit']) {
    assert.ok(!BLOCK.includes(bad), '補推區塊內不該有：' + bad);
  }
  for (const bad of ['advanceOrFinish', 'checkRoundAdvance', 'winnerUid', 'idleForfeit']) {
    assert.ok(!BLOCK_ALL.includes(bad), "（連字串一起抹的版本）補推區塊內不該有：" + bad);
  }
});
T('[自我驗證] 上一條的否定型斷言不是恆真（同樣的字串在**整個掃描段**確實找得到）', () => {
  for (const bad of ['advanceOrFinish', 'checkRoundAdvance', 'winnerUid', 'idleForfeit']) {
    assert.ok(S.includes(bad), '整份檔案裡竟然找不到 ' + bad + ' ⇒ 否定型斷言恆真、擋不住任何東西');
  }
});
T('[HEAD-FAIL④] fail-open：舊 bundle 沒有這個 export 時要判型別並**出聲**（只 warn 一次）', () => {
  assert.ok(BLOCK.includes("typeof TENG.tryAdvanceToPlaying !== 'function'"), '沒有型別 fail-open 判斷');
  assert.ok(/console\.warn\(/.test(BLOCK), 'fail-open 沒有出聲（沒有訊號就沒人會發現功能沒開）');
  assert.ok(/global\.__ptcgSetupAdvanceWarned/.test(BLOCK), '沒有去重旗標 ⇒ 每 30 秒每場印一行會灌爆 pm2 log');
});

// ── 作用域：TENG / postSystemChat 必須在補推區塊看得見（v0.94/v1.01 的教訓）──
function inScope(declAnchor, useIdx) {
  const iDecl = S.indexOf(declAnchor);
  if (iDecl < 0) return { ok: false, why: '找不到宣告 ' + declAnchor };
  let d0 = 0;
  for (let k = 0; k < iDecl; k++) { if (S[k] === '{') d0++; else if (S[k] === '}') d0--; }
  let d = d0, min = Infinity;
  for (let k = iDecl; k < useIdx; k++) {
    if (S[k] === '{') d++;
    else if (S[k] === '}') { d--; if (d < min) min = d; }
  }
  return { ok: min >= d0, why: 'declDepth=' + d0 + ' minBetween=' + min };
}
T('[結構] TENG 在補推區塊的作用域內（helper 在別的 IIFE 裡 = ReferenceError，node --check 抓不到）', () => {
  const r = inScope('let TENG, poolObj;', iCall);
  assert.ok(r.ok, r.why);
});
T('[結構] postSystemChat 在補推區塊的作用域內', () => {
  const r = inScope('async function postSystemChat', iCall);
  assert.ok(r.ok, r.why);
});
T('[結構] currentActorSeat 在補推區塊的作用域內（寫回時要拿它算 actorSeat）', () => {
  const r = inScope('function currentActorSeat(gs) {', iCall);
  assert.ok(r.ok, r.why);
});

// ══════════════════════════════════════════════════════════════════════════
// 3. 引擎行為：死角盤面確實推得動（⚠ 在 v6.156 也會 PASS，不算 HEAD-FAIL 證明）
// ══════════════════════════════════════════════════════════════════════════
const SFILE = join(ROOT, '.x-v6157-s.js'), EFILE = join(ROOT, '.x-v6157-e.ts'), OFILE = join(ROOT, '.x-v6157-o.mjs');
process.on('exit', () => { for (const p of [SFILE, EFILE, OFILE]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SFILE, 'export const base="";export const assets="";');
writeFileSync(EFILE,
  "export { createGame, applyAction, tryAdvanceToPlaying } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [EFILE], outfile: OFILE, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': SFILE }, logLevel: 'error' });
const { createGame, applyAction, tryAdvanceToPlaying } = await import(pathToFileURL(OFILE).href);

const cdir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(cdir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(cdir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(cdir, f), 'utf8'))) if (c && c.id != null) pool.set(String(c.id), c);
}
const BASIC = '19174';    // 迷唇姐（基礎）
const ENERGY = '14128';   // 基本【超】能量
const clone = (s) => JSON.parse(JSON.stringify(s));
function withSeed(seed, fn) {
  const orig = Math.random; let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}
const DECK = { name: 'P', entries: [{ cardId: BASIC, count: 20 }, { cardId: ENERGY, count: 40 }] };

/**
 * 造一個**真的**死角盤面，用真實成因：
 *   雙方各自在自己端 FINISH_SETUP（各自那半的 setupDone 為 true、獎賞也發了），
 *   線上把兩半合起來 ⇒ setupDone=[true,true]，但**合併路徑不會呼叫 tryAdvanceToPlaying**
 *   ⇒ phase 仍是 'setup'，而兩位玩家都在等對方，不會再送任何 action。
 */
function makeStuck() {
  let g = withSeed(4242, () => createGame(DECK, DECK, pool));
  assert.equal(g.phase, 'setup');
  assert.deepEqual(g.pendingMulliganDraw, [0, 0], '前提：這個 seed 沒有 mulligan 補抽');
  assert.deepEqual(g.mulliganRevealConfirmed, [true, true], '前提：沒有待確認的揭示');
  const basicOf = (s, i) => s.players[i].hand.find((c) => c.cardId === BASIC);
  g = applyAction(g, { type: 'PLACE_ACTIVE', senderIdx: 0, iid: basicOf(g, 0).iid }, pool);
  g = applyAction(g, { type: 'PLACE_ACTIVE', senderIdx: 1, iid: basicOf(g, 1).iid }, pool);
  const a = applyAction(clone(g), { type: 'FINISH_SETUP', senderIdx: 0 }, pool);
  const b = applyAction(clone(g), { type: 'FINISH_SETUP', senderIdx: 1 }, pool);
  assert.equal(a.phase, 'setup'); assert.equal(b.phase, 'setup');
  assert.deepEqual(a.setupDone, [true, false]);
  assert.deepEqual(b.setupDone, [false, true]);
  const stuck = clone(a);
  stuck.players[1] = clone(b.players[1]);       // 對手那半（含他的獎賞）
  stuck.setupDone = [true, true];               // 合併後湊齊 —— 但沒有人來推
  return stuck;
}
let STUCK = null;
T('[前提] 能造出真死角：phase 仍 setup、五個推進條件全滿足', () => {
  STUCK = makeStuck();
  assert.equal(STUCK.phase, 'setup');
  assert.deepEqual(STUCK.setupDone, [true, true]);
  assert.deepEqual(STUCK.pendingMulliganDraw, [0, 0]);
  assert.deepEqual(STUCK.mulliganRevealConfirmed, [true, true]);
  assert.ok(!(STUCK.mulliganPostBenchOpen || [false, false])[0] && !(STUCK.mulliganPostBenchOpen || [false, false])[1]);
  assert.ok(STUCK.players[0].active && STUCK.players[1].active, '雙方都有戰鬥場寶可夢');
  assert.equal(STUCK.players[0].prizes.length, 6);
  assert.equal(STUCK.players[1].prizes.length, 6);
});
T('（v6.156 也 PASS）引擎：死角盤面 tryAdvanceToPlaying 會推進到 playing', () => {
  const out = tryAdvanceToPlaying(clone(STUCK));
  assert.equal(out.phase, 'playing');
  assert.equal(out.turnPhase, 'main', '推進後應已自動抽牌進入 main');
  assert.equal(out.activePlayerIndex, STUCK.firstPlayerIdx);
});
T('（v6.156 也 PASS）[正對照] 五條件沒滿足時原樣回傳、phase 不動', () => {
  const notConfirmed = clone(STUCK); notConfirmed.mulliganRevealConfirmed = [true, false];
  assert.equal(tryAdvanceToPlaying(notConfirmed).phase, 'setup');
  const owesDraw = clone(STUCK); owesDraw.pendingMulliganDraw = [0, 2];
  assert.equal(tryAdvanceToPlaying(owesDraw).phase, 'setup');
  const notDone = clone(STUCK); notDone.setupDone = [true, false];
  assert.equal(tryAdvanceToPlaying(notDone).phase, 'setup');
  const mpb = clone(STUCK); mpb.mulliganPostBenchOpen = [false, true];
  assert.equal(tryAdvanceToPlaying(mpb).phase, 'setup');
  const opening = clone(STUCK);
  opening.openingFlow = 'interactive'; opening.openingDone = [false, false]; opening.setupDone = [false, false];
  assert.equal(tryAdvanceToPlaying(opening).phase, 'setup');
});

// ══════════════════════════════════════════════════════════════════════════
// 4. [HEAD-FAIL] 行為端：把伺服器那段**真程式碼**切出來，配真引擎 + 假 DB 實跑
//    ⚠ 「有呼叫某函式」不等於「那件事有發生」（v6.137 假回滾）——所以寫回內容、
//      CAS filter、lastActionAt、要不要判輸贏，全部實跑後逐欄位斷言。
// ══════════════════════════════════════════════════════════════════════════
// 真的 currentActorSeat（同 test-idle-setup-blocker 的抽法）
function extractFn(name) {
  const start = SRC.indexOf('function ' + name + '(gs) {');
  assert.ok(start >= 0, '找不到 ' + name);
  let i = SRC.indexOf('{', start), d = 0, end = -1;
  for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) { end = i + 1; break; } } }
  return new Function('return (' + SRC.slice(start, end) + ')')();
}
const realCurrentActorSeat = extractFn('currentActorSeat');
T('[自我驗證] 抽出來的 currentActorSeat 是真的（playing 回 activePlayerIndex、setup 雙 done 回 -1）', () => {
  assert.equal(realCurrentActorSeat({ phase: 'playing', activePlayerIndex: 1, players: [{ active: {} }, { active: {} }] }), 1);
  assert.equal(realCurrentActorSeat({ phase: 'setup', setupDone: [true, true], mulliganCounts: [0, 0],
    pendingMulliganDraw: [0, 0], mulliganRevealConfirmed: [true, true], mulliganPostBenchOpen: [false, false] }), -1);
});

// 把補推區塊包成可實跑的 async 函式。for 迴圈只跑一圈：
//   區塊裡 `continue` ⇒ 跳出迴圈 ⇒ 回傳 continued:true（＝掃描不再往下判輸贏）
//   沒有 continue ⇒ 走到迴圈內的 return ⇒ continued:false（＝會往下走原本的判定）
const RUNNER = new Function('gs', 'room', 'm', 'now', 'TROOMS', 'TENG', 'currentActorSeat', 'postSystemChat',
  'return (async function () { for (let _once = 0; _once < 1; _once++) {\n'
  + BLOCK_RAW + '\n return { continued: false }; } return { continued: true }; })();');

function mkEnv(o) {
  const writes = [], chats = [], warns = [];
  const TROOMS = { async updateOne(filter, update) { writes.push({ filter, update }); return { matchedCount: o.casHit === false ? 0 : 1, modifiedCount: o.casHit === false ? 0 : 1 }; } };
  const TENG = o.oldBundle ? { applyAction() {} } : { tryAdvanceToPlaying };
  const postSystemChat = async (t) => { chats.push(t); };
  const origWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  const restore = () => { console.warn = origWarn; };
  return { writes, chats, warns, TROOMS, TENG, postSystemChat, restore };
}
const NOW = 1770000000000;
async function run(gs, o = {}) {
  const env = mkEnv(o);
  const room = { _id: 'R1', version: o.version === undefined ? 7 : o.version, gameState: gs };
  const m = { _id: 'M1', roomId: 'R1', round: 3, p1name: '小明', p2name: '小華' };
  try {
    const r = await RUNNER(gs, room, m, NOW, env.TROOMS, env.TENG, realCurrentActorSeat, env.postSystemChat);
    return { ...r, ...env };
  } finally { env.restore(); }
}

await TA('[HEAD-FAIL⑤a] 死角盤面：真的被 CAS 寫回、盤面變 playing、版本 +1、lastActionAt 更新', async () => {
  const r = await run(clone(STUCK));
  assert.equal(r.writes.length, 1, '應該剛好寫回一次，實際 ' + r.writes.length);
  const w = r.writes[0];
  assert.deepEqual(w.filter, { _id: 'R1', version: 7 }, 'CAS filter 不對: ' + JSON.stringify(w.filter));
  const set = w.update.$set;
  assert.equal(set.gameState.phase, 'playing', '寫回的盤面不是 playing');
  assert.equal(set.version, 8, '版本沒有 +1');
  assert.equal(set.lastActionAt, NOW, 'lastActionAt 沒更新 ⇒ 下一輪掃描會把剛拿到行動權的人判負');
  assert.equal(set.updatedAt, NOW);
  assert.ok(set.actorSeat === 0 || set.actorSeat === 1, 'actorSeat 應為 0/1，實際 ' + set.actorSeat);
  assert.ok(Array.isArray(set.gameState.log) && set.gameState.log.length > 0, '房間 log 沒有訊息');
  assert.ok(JSON.stringify(set.gameState.log).includes('伺服器'), 'log 沒有留下系統訊息');
  assert.equal(r.chats.length, 1, '應在大廳聊天室公告一次');
  assert.equal(r.continued, true, '補推成功後必須 continue（本輪不判任何人輸贏）');
});
await TA('[HEAD-FAIL⑤b] 死角盤面：寫回的獎賞/手牌沒被弄丟（整包寫回不可殘缺，log 也不能被洗掉）', async () => {
  const r = await run(clone(STUCK));
  const gsOut = r.writes[0].update.$set.gameState;
  assert.equal(gsOut.players[0].prizes.length, 6);
  assert.equal(gsOut.players[1].prizes.length, 6);
  assert.ok(gsOut.players[0].active && gsOut.players[1].active);
});
await TA('[正對照] 五條件沒滿足的 setup 房：不得寫回、不得改 phase、要往下走原本的判定', async () => {
  const notReady = clone(STUCK); notReady.mulliganRevealConfirmed = [true, false];
  const r = await run(notReady);
  assert.equal(r.writes.length, 0, '推不動卻寫回了');
  assert.equal(r.chats.length, 0);
  assert.equal(r.continued, false, '推不動時必須落回原本的 pending-admin/判負路徑');
  assert.equal(notReady.phase, 'setup', 'phase 被就地改掉了');
});
await TA('[正對照] 只有一方 setupDone 的正常 setup 房（單純有人掛機）：完全不介入', async () => {
  const half = clone(STUCK); half.setupDone = [true, false];
  const r = await run(half);
  assert.equal(r.writes.length, 0);
  assert.equal(r.continued, false);
});
await TA('[正對照] playing 房：整段補推不進場', async () => {
  const playing = tryAdvanceToPlaying(clone(STUCK));
  assert.equal(playing.phase, 'playing');
  const r = await run(playing);
  assert.equal(r.writes.length, 0, 'playing 房不該被補推碰到');
  assert.equal(r.continued, false);
});
await TA('[HEAD-FAIL⑥] 舊 bundle（沒有 tryAdvanceToPlaying）：fail-open 不寫回、要 warn、且只 warn 一次', async () => {
  delete global.__ptcgSetupAdvanceWarned;
  const r1 = await run(clone(STUCK), { oldBundle: true });
  assert.equal(r1.writes.length, 0, '舊 bundle 竟然寫回了');
  assert.equal(r1.continued, false, '舊 bundle 應落回原本行為');
  assert.equal(r1.warns.length, 1, '應 warn 一次，實際 ' + r1.warns.length);
  assert.ok(r1.warns[0].includes('update-tournament.bat'), 'warn 沒告訴人怎麼修');
  const r2 = await run(clone(STUCK), { oldBundle: true });
  assert.equal(r2.warns.length, 0, '第二次不該再 warn（每 30 秒每場印一行會灌爆 pm2 log）');
  delete global.__ptcgSetupAdvanceWarned;
});
await TA('[HEAD-FAIL⑦] CAS 未命中（玩家剛好送了動作）：不公告、也不判任何人輸贏', async () => {
  const r = await run(clone(STUCK), { casHit: false });
  assert.equal(r.writes.length, 1, '仍應嘗試一次 CAS 寫回');
  assert.equal(r.chats.length, 0, 'CAS 沒中就不該公告（盤面根本沒被我們改）');
  assert.equal(r.continued, true, 'CAS 沒中代表盤面正在動 ⇒ 這場不是死角，本輪保守不判');
});
await TA('[防呆] 房間的 version 欄位不是數值：不做 CAS 也不盲寫', async () => {
  const r = await run(clone(STUCK), { version: null });
  assert.equal(r.writes.length, 0, '沒有版本欄位就不能寫（CAS 條件會失效變成盲寫）');
  assert.equal(r.continued, false);
});

console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exit(fail ? 1 : 0);
