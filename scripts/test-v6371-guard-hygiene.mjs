#!/usr/bin/env node
/**
 * v6.371 守衛：**守衛自己的衛生** —— 站長裁定 六-4／六-7 ＋ v6.370 留下的三個洞。
 * ⭐ 本版出貨碼（`src/`）一行都沒改；被守的對象**就是別的守衛**。
 *   所以「行為層」＝ 把那幾支守衛（或它們逐字抽出來的那幾條）**當子行程／獨立模組真的跑起來**，
 *   看它在指定情境下紅不紅 —— 不是 grep 某個字串在不在。
 *
 * 【A】(甲) 六-4：`test-v6265` 的 F4 原本是**一個** `T(...)` 塞了六件彼此無關的判準。
 *     `T()` 是 try/catch ⇒ 第一條 throw 就整條中止 ⇒ server_admin_patch.js 的 sha 一對不上，
 *     engine.ts／oracle-client.ts 的位元組釘**一次都不會跑**（第十種安慰劑：被前一條斷言短路）。
 *     ⇒ 拆成 F4a~F4e。本節把 F4 家族的**原始碼逐字抽出來**，在可控輸入（記憶體裡改過的
 *       server_admin_patch.js／engine.ts）底下真的執行，證明「一條紅不影響其他條」。
 *     ⇒ HEAD-FAIL：對 BASE(v6.370) 的 test-v6265 做同一件事 —— 同樣的突變下 engine.ts
 *       **連讀都沒讀到**（讀取次數 0），本版必須 ≥1。
 *
 * 【B】(乙) 六-7：`test-v6234` 的兩個突變錨點是**多行字串字面**，CRLF 工作樹 `indexOf` 永遠 -1
 *     ⇒ 突變層零保護力（LF 的 CI／免疫測試網才綠 ⇒ 假綠）。
 *     ⇒ 收斂到中央 helper `scripts/lib/eol-agnostic.mjs`（Rule 38，不在各錨點補 replace）。
 *     ⇒ 本節用**真的** damage-estimate.ts／effects.ts 切成 LF 與 CRLF 兩份，證明兩種都定位得到；
 *       反對照：把中央 helper 退回 LF-only ⇒ CRLF 版必須立刻定位失敗（＝證明 B 不是恆真）。
 *
 * 【C】(丙) 六-6：本版新接進 npm test chain 的步驟，每一支都必須恰好出現一次、
 *     而且是 `node scripts/xxx.mjs` 的形狀（拆解 `&&` 比對，不是 grep 整串）。
 *
 * 【D】(丁) v6.370 的三個洞：
 *     D1 `test-v6263` ② 的成員判準從「原始碼含字面」改成「真的有 import 語句」。
 *     D2 `test-v6263` ⑤ 從 Windows 的 PLATFORM-SKIP 裡救出來（它與 PATH shim 無關）。
 *     D3 `test-v6296` 不再自己 shell out 到 git（chain 裡最後一支白名單外的）。
 *
 * ⚠ 禁止恆真斷言（#27）／禁止用 `||` 放寬（#26）／旗標層斷言只能當補充（#28）。
 * 突變測試：`__m6a/mutcheck_v6371.mjs`。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import * as pathMod from 'node:path';   // ⭐v6.388b【F】求值守衛 ROOT 定義行時要餵 path 模組
import { createRequire } from 'node:module';   // ⭐v6.388e【F】用 acorn 剝區塊註解（真 tokenizer）
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hasBaseCommit, readBaseBlob, shallowSkip, shallowSkipCount } from './lib/base-blob.mjs';
import { eolCount, eolReplaceOnce, normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'scripts/test-v6371-guard-hygiene.mjs';
const V6265 = 'scripts/test-v6265-phantom-start-race.mjs';
const V6234 = 'scripts/test-v6234-resistance-label-and-coin-cap.mjs';
const V6263 = 'scripts/test-v6263-shallow-clone-ci-guards.mjs';
const V6296 = 'scripts/test-v6296-lobby-friends-tab.mjs';
const EOLLIB = 'scripts/lib/eol-agnostic.mjs';
const BASE_SHA = 'b3ec78771f1ffa16602a94cb6ad2c776cece7514';   // v6.370（本版的前一版；本檔改動前的樣子）

let n = 0, bad = 0;
const chk = (label, cond, extra = '') => {
  n++; console.log((cond ? '  PASS ' : '  FAIL ') + label + (cond ? '' : (extra ? '  ⟵ ' + String(extra).slice(0, 400) : '')));
  if (!cond) bad++;
};
const readRel = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const TMPS = [];
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });
const mkdt = (tag) => { const d = mkdtempSync(join(tmpdir(), 'v6371-' + tag + '-')); TMPS.push(d); return d; };

// ══════════════════════════════════════════════════════════════════════════════
console.log('【A】(甲) 六-4：F4 家族必須互相獨立 —— 一條紅不可以把其他條短路掉');

/**
 * 從 test-v6265 的原始碼裡**逐字**抽出「剝除器 ＋ F4 家族」那一整段，
 * 組成一個可以獨立執行的 ESM 模組（prelude 提供同名的 ROOT/RO/常數/T/ok/…）。
 * ⚠ 用的是**真的原始碼**：哪天有人把 F4c 的判準改掉／刪掉，這裡自動跟著變 —— 不是複製一份來測。
 * ⚠ readFileSync 在 prelude 裡被包了一層：可由環境變數把 server_admin_patch.js／engine.ts
 *   換成「記憶體裡改過的」暫存檔，並**記錄每一次讀取**（證明某一條到底有沒有跑到）。
 */
function buildF4Probe(v6265Src, tag) {
  const START_NEW = "await T('F4a ";
  const START_OLD = "await T('F4 ⭐⭐⭐ 錦標賽的同步／盤面路徑";
  const END = "await T('F5 ";
  const isNew = v6265Src.includes(START_NEW);
  const a = v6265Src.indexOf(isNew ? START_NEW : START_OLD);
  const e = v6265Src.indexOf(END, a + 1);
  if (a < 0 || e < 0) return null;
  // 剝除器：新版在 F4a 之前的模組層；舊版在 T 回呼裡（跟著 F4 一起被抽走）
  let head = '';
  if (isNew) {
    const h = v6265Src.indexOf('// ⭐⭐⭐ v6.371（甲）站長裁定 六-4');
    if (h < 0 || h > a) return null;
    head = v6265Src.slice(h, a);
  }
  const body = head + v6265Src.slice(a, e);
  const constOf = (name) => {
    const m = new RegExp('^const ' + name + " = '([0-9a-f]{40,64})';", 'm').exec(v6265Src);
    return m ? m[1] : null;
  };
  const consts = ['BASE_SHA', 'BASE_SHA_V6266', 'BASE_SHA_V6309', 'TOURN_TAIL_SHA256_V6276']
    .map((k) => [k, constOf(k)]);
  if (consts.some(([, v]) => !v)) return null;
  const libDir = pathToFileURL(join(ROOT, 'scripts/lib/')).href;
  const prelude = `
import { readFileSync as _rfs } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { hasBaseCommit, readBaseBlob, shallowSkip } from ${JSON.stringify(libDir + 'base-blob.mjs')};
import { eolFind, normEol } from ${JSON.stringify(libDir + 'eol-agnostic.mjs')};
// ⚠ v6.394：engine.ts 的還原器收斂到 lib（test-v6265 F4c 與 test-v6375 F0b 共用同一份）
//   ⇒ 探針的模組層相依也要提供它，否則 F4c 會紅在「stripV6394Engine is not defined」。
import { stripV6394Engine } from ${JSON.stringify(libDir + 'engine-strip-v6394.mjs')};
  import { stripV6398Engine } from ${JSON.stringify(libDir + 'engine-strip-v6398.mjs')};
  import { stripV6400Engine } from ${JSON.stringify(libDir + 'engine-strip-v6400.mjs')};
  import { stripV6402Engine } from ${JSON.stringify(libDir + 'engine-strip-v6402.mjs')};
  import { stripV6403Engine } from ${JSON.stringify(libDir + 'engine-strip-v6403.mjs')};
  import { stripV6401Engine } from ${JSON.stringify(libDir + 'engine-strip-v6401.mjs')};
const ROOT = ${JSON.stringify(ROOT)};
${consts.map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join('\n')}
const __reads = [];
// ⚠ 一律把讀進來的字串正規化成 LF：本節要隔離的是「短路」這一件事，
//   不要讓 (乙) 的行尾落差混進來（BASE 版沒有 normEol，不這樣做它會紅在別的理由上）。
const readFileSync = (p, enc) => {
  const s = String(p).replace(/\\\\/g, '/');
  __reads.push(s);
  let real = p;
  if (/server_admin_patch\\.js$/.test(s) && process.env.V6371_SAP) real = process.env.V6371_SAP;
  else if (/\\/engine\\.ts$/.test(s) && process.env.V6371_ENG) real = process.env.V6371_ENG;
  const out = _rfs(real, enc);
  return typeof out === 'string' ? out.replace(/\\r\\n/g, '\\n') : out;
};
const RO = readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8');
const __results = [];
const ok = (c, m) => assert.ok(c, m);
const T = async (name, fn) => {
  try { await fn(); __results.push({ name, ok: true, msg: '' }); }
  catch (err) { __results.push({ name, ok: false, msg: String((err && err.message) || err).split('\\n')[0] }); }
};
`;
  const epilogue = `
console.log('__V6371_PROBE__' + JSON.stringify({
  results: __results,
  engineReads: __reads.filter((x) => /\\/engine\\.ts$/.test(x)).length,
  sapReads: __reads.filter((x) => /server_admin_patch\\.js$/.test(x)).length,
}));
`;
  const dir = mkdt('f4-' + tag);
  const file = join(dir, 'probe.mjs');
  writeFileSync(file, prelude + body + epilogue, 'utf8');
  return file;
}

function runProbe(file, env = {}) {
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ...env },
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const m = /__V6371_PROBE__(\{.*\})/.exec(out);
  return { code: r.status, out, data: m ? JSON.parse(m[1]) : null };
}
const res = (d, prefix) => (d ? d.results.filter((x) => x.name.startsWith(prefix)) : []);
const one = (d, prefix) => res(d, prefix)[0] || null;

// ── 準備兩個「記憶體裡改過的」輸入 ────────────────────────────────────────────
const MUTDIR = mkdt('inputs');
const SAP_REAL = normEol(readRel('oracle-admin/server_admin_patch.js'));
const SAP_MUT = join(MUTDIR, 'server_admin_patch.js');
{
  // 改錦標賽區塊裡的**一個字元** ⇒ tail sha256 必變（＝ v6.365 那種「合法改動忘了重釘 sha」）
  const ti = SAP_REAL.indexOf("app.get('/api/tournament");
  chk('A0 前提：server_admin_patch.js 抓得到第一支 /api/tournament 端點', ti > 0, String(ti));
  // ⚠ 只改**第一處**（ti 指的就是它）—— 一個字元，錦標賽區塊內，tail sha256 必變。
  const mutTail = SAP_REAL.slice(ti).replace("app.get('/api/tournament", "app.get('/api/tournamenT");
  chk('A0 前提：突變真的改到了東西（一個字元）', mutTail !== SAP_REAL.slice(ti)
      && mutTail.length === SAP_REAL.length - ti);
  writeFileSync(SAP_MUT, SAP_REAL.slice(0, ti) + mutTail, 'utf8');
  chk('A0 前提：突變只動了錦標賽區塊（前半段逐字不變）',
      normEol(readFileSync(SAP_MUT, 'utf8')).slice(0, ti) === SAP_REAL.slice(0, ti));
}
const ENG_REAL = normEol(readRel('src/lib/game/engine.ts'));
const ENG_MUT = join(MUTDIR, 'engine.ts');
{
  // engine.ts 改**一個位元組**（在一段不帶任何 v63xx 哨兵的既有註解裡）⇒ F4c 必紅
  const r = eolReplaceOnce(ENG_REAL, 'export function applyAction(', 'export function applyAction (');
  chk('A0 前提：engine.ts 的 applyAction 宣告恰好一處（反對照的突變錨點）', r.ok, 'count=' + r.count);
  writeFileSync(ENG_MUT, r.out, 'utf8');
}

const probeHead = buildF4Probe(readRel(V6265), 'head');
chk('A0 ⭐ 從 test-v6265 抽得出 F4 家族 ＋ 剝除器（抽取器自驗）', probeHead !== null);

const HAS_BASE = hasBaseCommit(ROOT, BASE_SHA);

if (probeHead) {
  // ── A1 基準：什麼都沒動 ⇒ F4a~F4e 全綠 ──
  const base = runProbe(probeHead);
  chk('A1 ⭐ 基準：F4 家族抽出來獨立執行，五條都在（F4a~F4e）',
      base.data && ['F4a', 'F4b', 'F4c', 'F4d', 'F4e'].every((k) => one(base.data, k)),
      base.out.slice(-400));
  chk('A1 ⭐⭐ 基準：五條全部綠',
      base.data && base.data.results.length === 5 && base.data.results.every((x) => x.ok),
      base.data ? JSON.stringify(base.data.results.filter((x) => !x.ok)) : base.out.slice(-400));

  // ── A2 ⭐⭐⭐（甲）本題：sha 那一條紅，其他條仍然各自判定 ──
  const mutSap = runProbe(probeHead, { V6371_SAP: SAP_MUT });
  chk('A2 ⭐⭐⭐ server_admin_patch.js 被改一個字元 ⇒ F4b（sha）必紅',
      mutSap.data && one(mutSap.data, 'F4b') && one(mutSap.data, 'F4b').ok === false,
      mutSap.data ? JSON.stringify(res(mutSap.data, 'F4b')) : mutSap.out.slice(-400));
  chk('A2 ⭐⭐⭐ 同一次執行裡 F4c（engine.ts 位元組釘）**仍然有跑而且是綠的**（修前：根本不會執行）',
      mutSap.data && one(mutSap.data, 'F4c') && one(mutSap.data, 'F4c').ok === true,
      mutSap.data ? JSON.stringify(res(mutSap.data, 'F4c')) : mutSap.out.slice(-400));
  chk('A2 ⭐⭐ 同一次執行裡 F4d（oracle-client.ts 位元組釘）也仍然有跑而且是綠的',
      mutSap.data && one(mutSap.data, 'F4d') && one(mutSap.data, 'F4d').ok === true,
      mutSap.data ? JSON.stringify(res(mutSap.data, 'F4d')) : mutSap.out.slice(-400));
  // ⭐⭐v6.372：F4c 的位元組釘本身就是「需要歷史」的斷言（拿不到 BASE blob 時它自己 shallowSkip）
  //   ⇒ 在**淺複製**（CI 的 fetch-depth:1）下 engine.ts 必然是 0 次讀取、突變也翻不紅。
  //   v6.371 漏了這一層 ⇒ CI build job 紅 2 條（A2 的讀取次數、A3 的反對照）⇒ deploy 被 skip。
  //   ⚠ 這不是放寬：F4c／F4d「仍然有跑而且是綠的」那兩條在淺複製下照樣守（它們驗的是
  //   「有沒有被短路掉」，不需要歷史）；這裡只把「需要真的做位元組比對」的兩條大聲宣告跳過。
  if (!HAS_BASE) {
    shallowSkip('v6.371【A2】engine.ts 真的被讀取過（位元組釘需要 BASE blob）',
                'F4c/F4d「沒有被短路」那兩條不需要歷史，仍在守');
  } else {
    chk('A2 ⭐⭐ 行為層佐證：engine.ts 在這一次執行裡**真的被讀取過**（不是靠名字判斷有沒有跑）',
        mutSap.data && mutSap.data.engineReads >= 1, mutSap.data ? String(mutSap.data.engineReads) : '?');
  }
  chk('A2 ★ 其餘三條（F4a/F4e）不受影響、仍然綠',
      mutSap.data && ['F4a', 'F4e'].every((k) => one(mutSap.data, k) && one(mutSap.data, k).ok === true),
      mutSap.data ? JSON.stringify(mutSap.data.results.map((x) => x.name + '=' + x.ok)) : '');

  // ── A3 反對照：engine.ts 改一個位元組 ⇒ F4c 必紅、F4b 仍綠（兩條各自獨立） ──
  const mutEng = runProbe(probeHead, { V6371_ENG: ENG_MUT });
  if (!HAS_BASE) {
    shallowSkip('v6.371【A3】engine.ts 改一個位元組 ⇒ F4c 必紅（需要 BASE blob 才做得了位元組比對）',
                '下面兩條「F4b／F4d 不被反向污染」不需要歷史，仍在守');
  } else {
    chk('A3 ⭐⭐⭐ 反對照：engine.ts 改一個位元組 ⇒ F4c 必紅（證明 A2 的「綠」不是恆真）',
        mutEng.data && one(mutEng.data, 'F4c') && one(mutEng.data, 'F4c').ok === false,
        mutEng.data ? JSON.stringify(res(mutEng.data, 'F4c')) : mutEng.out.slice(-400));
  }
  chk('A3 ⭐⭐ 反對照：同一次執行裡 F4b（sha）仍然綠（engine 的紅不會反向污染 sha 那一條）',
      mutEng.data && one(mutEng.data, 'F4b') && one(mutEng.data, 'F4b').ok === true,
      mutEng.data ? JSON.stringify(res(mutEng.data, 'F4b')) : '');
  chk('A3 ⭐⭐ 反對照：F4d（oracle-client.ts）也仍然綠（兩個位元組釘互不影響）',
      mutEng.data && one(mutEng.data, 'F4d') && one(mutEng.data, 'F4d').ok === true,
      mutEng.data ? JSON.stringify(res(mutEng.data, 'F4d')) : '');

  // ── A4 ⭐⭐ HEAD-FAIL：對 BASE(v6.370) 的 test-v6265 做同一件事 ──
  if (!HAS_BASE) {
    shallowSkip('v6.371【A4】HEAD-FAIL：BASE(v6.370) 的 F4 在 sha 紅掉時根本不會讀 engine.ts',
                'A1~A3 是本版現況的行為端，不需要歷史，仍在守');
  } else {
    const b = readBaseBlob(ROOT, BASE_SHA, V6265);
    chk('A4 讀得到 BASE 的 test-v6265', b.ok);
    const probeBase = b.ok ? buildF4Probe(b.out, 'base') : null;
    chk('A4 ⭐ BASE 版抽得出 F4（它只有一條 `F4 …`，沒有 F4a~F4e）', probeBase !== null);
    if (probeBase) {
      // ⭐⭐v6.381：BASE 版的 F4 釘的是**它當時**的 server_admin_patch.js sha。
      //   之後的版本合法改過那個檔（v6.381 就改了錦標賽區塊）⇒ 拿**現行**檔案餵 BASE 探針，
      //   它的 sha 那一條本來就會紅、engine.ts 一樣被短路 ⇒ 這一節會變成「永遠成立」的假 HEAD-FAIL，
      //   而下面的對照組則會誤報成紅。
      //   ⇒ BASE 探針一律餵 **BASE 版自己的** server_admin_patch.js（那才是它的環境），
      //     突變也在 BASE 版的內容上做（同樣只改錦標賽區塊的一個字元）。
      const bSap = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
      chk('A4 ★ 讀得到 BASE 的 server_admin_patch.js', bSap.ok);
      const SAP_BASE = join(MUTDIR, 'sap-base.js');
      const SAP_BASE_MUT = join(MUTDIR, 'sap-base-mut.js');
      if (bSap.ok) {
        const b0 = normEol(bSap.out);
        writeFileSync(SAP_BASE, b0, 'utf8');
        const ti0 = b0.indexOf("app.get('/api/tournament");
        chk('A4 ★ BASE 版的 server_admin_patch.js 也抓得到第一支 /api/tournament 端點', ti0 > 0, String(ti0));
        writeFileSync(SAP_BASE_MUT,
          b0.slice(0, ti0)
          + b0.slice(ti0).replace("app.get('/api/tournament", "app.get('/api/tournamenT"), 'utf8');
      }
      const bm = runProbe(probeBase, { V6371_SAP: SAP_BASE_MUT });
      chk('A4 ⭐⭐⭐ HEAD-FAIL：BASE 版在同一個突變下**只有一條**判定結果，而且是紅的',
          bm.data && bm.data.results.length === 1 && bm.data.results[0].ok === false,
          bm.data ? JSON.stringify(bm.data.results) : bm.out.slice(-400));
      chk('A4 ⭐⭐⭐ HEAD-FAIL：BASE 版在同一個突變下 engine.ts 的讀取次數是 **0**（＝位元組釘被短路掉，一次都沒跑）',
          bm.data && bm.data.engineReads === 0, bm.data ? String(bm.data.engineReads) : '?');
      chk('A4 ★ 對照組：BASE 版**沒有**突變時 engine.ts 讀得到（證明上一條不是因為 BASE 本來就不讀）',
          bSap.ok && (() => { const bb = runProbe(probeBase, { V6371_SAP: SAP_BASE });
            return !!bb.data && bb.data.engineReads >= 1; })());
    }
  }
}

// ── A5 結構（補充；#28：旗標層只能當補充）──────────────────────────────────
{
  const s = readRel(V6265);
  for (const k of ['F4a', 'F4b', 'F4c', 'F4d', 'F4e']) {
    chk('A5 test-v6265 裡 `await T(\'' + k + '` 恰好一次', s.split("await T('" + k + " ").length === 2,
        String(s.split("await T('" + k + " ").length - 1));
  }
  chk('A5 ⭐ 舊的合併版 F4 已經不存在（不得同時留兩份判準）',
      !s.includes("await T('F4 ⭐⭐⭐ 錦標賽的同步／盤面路徑"));
  chk('A5 ★ 負對照：同樣的拆解法對不存在的條目要回 0', s.split("await T('F4z ").length - 1 === 0);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】(乙) 六-7：突變錨點必須對 CRLF 與 LF 兩種行尾都定位得到');

/** 從 test-v6234 的原始碼裡逐字抽出 bundleMutated 的突變三元組（[rel, from, to]）。 */
function mutationTuples(src, tag) {
  const head = `const ${tag} = await bundleMutated('${tag}', [[`;
  const a = src.indexOf(head);
  if (a < 0) return null;
  const e = src.indexOf(']]);', a);
  if (e < 0) return null;
  const lit = src.slice(a + head.length - 2, e + 2);   // 從 `[[` 到 `]]`
  try { return new Function('return ' + lit)(); } catch { return null; }
}
const v6234src = readRel(V6234);
const TUPLES = [['M1', mutationTuples(v6234src, 'm1')], ['M2', mutationTuples(v6234src, 'm2')]];
chk('B0 ⭐ 抽得出 test-v6234 的兩組突變錨點（抽取器自驗）',
    TUPLES.every(([, t]) => Array.isArray(t) && t.length === 1 && t[0].length === 3),
    JSON.stringify(TUPLES.map(([k, t]) => k + '=' + (t ? t.length : 'null'))));
chk('B0 ★ 兩組錨點都是**多行**字串（不是多行就沒有這個坑，本節會變成恆真）',
    TUPLES.every(([, t]) => t && /\n/.test(t[0][1])),
    JSON.stringify(TUPLES.map(([k, t]) => k + ':' + (t ? JSON.stringify(t[0][1].slice(0, 30)) : ''))));

for (const [tag, t] of TUPLES) {
  if (!t) continue;
  const [rel, from] = t[0];
  const real = readRel(join('src', rel).replace(/\\/g, '/'));
  const lf = normEol(real), crlf = lf.replace(/\n/g, '\r\n');
  chk(`B1 ⭐⭐⭐ ${tag}（${rel}）：中央 helper 在 **LF** 版恰好定位到 1 處`, eolCount(lf, from) === 1, String(eolCount(lf, from)));
  chk(`B1 ⭐⭐⭐ ${tag}（${rel}）：中央 helper 在 **CRLF** 版也恰好定位到 1 處（修前：0 處）`,
      eolCount(crlf, from) === 1, String(eolCount(crlf, from)));
  chk(`B2 ⭐⭐ ${tag}：修前的寫法（String.includes）在 LF 版找得到`, lf.includes(from) === true);
  chk(`B2 ⭐⭐⭐ ${tag}：修前的寫法（String.includes）在 CRLF 版**找不到** —— 這就是零保護力的來源`,
      crlf.includes(from) === false);
  const r = eolReplaceOnce(crlf, from, t[0][2]);
  chk(`B3 ⭐⭐ ${tag}：對 CRLF 版取代成功，而且取代進去的內容沿用 CRLF（不得混行尾）`,
      r.ok && r.out !== crlf && !/[^\r]\n/.test(r.out), 'ok=' + r.ok + ' count=' + r.count);
}

// ── B4 反對照：把中央 helper 退回 LF-only ⇒ CRLF 版必須立刻定位失敗 ──────────
{
  const libSrc = readRel(EOLLIB);
  const from = ".replace(/\\n/g, '\\\\r?\\\\n')";
  const mut = eolReplaceOnce(libSrc, from, ".replace(/\\n/g, '\\\\n')");
  chk('B4 ⭐ 反對照的突變錨點在中央 helper 裡恰好一處', mut.ok, 'count=' + mut.count);
  if (mut.ok) {
    const d = mkdt('eolmut');
    const f = join(d, 'eol-agnostic.mjs');
    writeFileSync(f, mut.out, 'utf8');
    const m = await import(pathToFileURL(f).href);
    const t = TUPLES[0][1];
    if (t) {
      const real = normEol(readRel(join('src', t[0][0]).replace(/\\/g, '/')));
      const crlf = real.replace(/\n/g, '\r\n');
      chk('B4 ⭐⭐⭐ 反對照：中央 helper 退回 LF-only ⇒ CRLF 版立刻變成 0 處（證明 B1 不是恆真）',
          m.eolCount(crlf, t[0][1]) === 0, String(m.eolCount(crlf, t[0][1])));
      chk('B4 ★ 反對照：退回 LF-only 之後 LF 版仍然是 1 處（突變只打到該打的地方）',
          m.eolCount(real, t[0][1]) === 1, String(m.eolCount(real, t[0][1])));
    }
  }
}

// ── B5 ⭐⭐ 行為層：test-v6234 子行程真的跑一次，兩條突變必須是 PASS ────────────
{
  const r = spawnSync(process.execPath, [join(ROOT, V6234)], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900000,
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const linePass = (frag) => out.split(/\r?\n/).some((l) => /^\s*PASS /.test(l) && l.includes(frag));
  const lineFail = (frag) => out.split(/\r?\n/).some((l) => /^\s*FAIL /.test(l) && l.includes(frag));
  chk('B5 ⭐⭐⭐ 行為層：test-v6234 子行程 exit=0（本機 CRLF 工作樹）', r.status === 0, out.slice(-500));
  chk('B5 ⭐⭐⭐ 行為層：突變 M1 不再「定位失敗」而且是 PASS', linePass('突變 M1：') && !lineFail('突變 M1 定位'),
      out.split(/\r?\n/).filter((l) => l.includes('突變 M1')).join(' | '));
  chk('B5 ⭐⭐⭐ 行為層：突變 M2 不再「定位失敗」而且是 PASS', linePass('突變 M2：') && !lineFail('突變 M2 定位'),
      out.split(/\r?\n/).filter((l) => l.includes('突變 M2')).join(' | '));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】(丙) 六-6：本版新接進 chain 的步驟必須真的會被跑到');
// ⭐ (丙) 六-6：本版接進 chain 的 19 步（本守衛 ＋ 18 支「原本不在 chain、現在就是綠的、
//   單獨跑 < 10 秒、而且有非零 exit 路徑」的既有測試；合計約 23 秒）。
//   ⚠ 沒有非零 exit 路徑的（test-play-basic／test-regmarks／test-picker-skip-cancel 空檔）
//     一律**不接** —— 接進去只會變成「永遠綠」的安慰劑步驟。
const NEW_STEPS = [
  'node scripts/test-v6371-guard-hygiene.mjs',
  'node scripts/test-ami-gaze-allmons.mjs',
  'node scripts/test-burn-cure-tertiary.mjs',
  'node scripts/test-confuse-newactive-placement.mjs',
  'node scripts/test-hydro-pump-bench.mjs',
  'node scripts/test-idle-setup-blocker.mjs',
  'node scripts/test-kaleido-waltz.mjs',
  'node scripts/test-multi-tool-relay.mjs',
  'node scripts/test-opp-turn-immune-promote.mjs',
  'node scripts/test-prevent-prize-nullify.mjs',
  'node scripts/test-protect-charge-expire.mjs',
  'node scripts/test-retaliation-nullify.mjs',
  'node scripts/test-rotom-call-namecontains.mjs',
  'node scripts/test-scorch-earth-stadium.mjs',
  'node scripts/test-sticky-retreat-deferred-prize.mjs',
  'node scripts/test-swap-ability.mjs',
  'node scripts/test-swiss.mjs',
  'node scripts/test-tournament-setup-idle-gate.mjs',
  'node scripts/test-tournament-stats.mjs',
];
{
  const pkg = JSON.parse(readRel('package.json'));
  const chain = String(pkg.scripts.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('C1 package.json 的 scripts.test 拆解得到 >= 400 步', chain.length >= 400, String(chain.length));
  chk('C1 chain 裡每一步都是 `node scripts/xxx.mjs` 的形狀（不得被塞進奇怪的 shell 片段）',
      chain.every((s) => /^node scripts\/[\w.\-]+\.mjs$/.test(s)),
      JSON.stringify(chain.filter((s) => !/^node scripts\/[\w.\-]+\.mjs$/.test(s)).slice(0, 3)));
  for (const step of NEW_STEPS) {
    chk('C2 ⭐ `' + step + '` 在 scripts.test 裡**恰好**一次（拆解比對，不是 grep 整串）',
        chain.filter((s) => s === step).length === 1, String(chain.filter((s) => s === step).length));
    const rel = step.replace(/^node\s+/, '');
    chk('C2 ★ 它宣告的檔案真的存在且不是空檔', existsSync(join(ROOT, rel)) && statSync(join(ROOT, rel)).size > 1000);
  }
  // ⭐⭐ 不接安慰劑：每一支新接進 chain 的腳本都必須**存在非零 exit 的路徑**
  //   （`process.exit(fail ? 1 : 0)` 之類）。永遠 exit 0 的腳本接進 chain ＝ 多一步永遠綠。
  for (const step of NEW_STEPS) {
    const rel = step.replace(/^node\s+/, '');
    const src = existsSync(join(ROOT, rel)) ? readRel(rel) : '';
    chk('C2 ⭐⭐ ' + rel.replace('scripts/', '') + ' 有非零 exit 的路徑（不得是永遠綠的安慰劑步驟）',
        /process\.exit\(\s*(?!0\s*\))/.test(src) || /process\.exitCode\s*=/.test(src),
        src ? '找不到 process.exit(非0)' : '讀不到檔案');
  }
  chk('C2 ★ 負對照：偵測器對「只有 process.exit(0)」的樣本要判為沒有',
      /process\.exit\(\s*(?!0\s*\))/.test('process.exit(0);\n') === false);
  chk('C2 ★ 負對照：同樣的拆解法對不存在的步驟要回 0',
      chain.filter((s) => s === 'node scripts/test-v9999-does-not-exist.mjs').length === 0);
  // ⭐ 全 chain 的檔案都必須存在（`&&` 鏈裡有一支不存在 ⇒ CI 從那裡開始整條停掉）
  const missing = [...new Set(chain.map((s) => s.replace(/^node\s+/, '')))].filter((r) => !existsSync(join(ROOT, r)));
  chk('C3 ⭐⭐ chain 裡宣告的每一支腳本都存在（少一支 ⇒ CI 從那裡起整條不跑）',
      missing.length === 0, JSON.stringify(missing));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】(丁) v6.370 留下的三個洞');

// ── D1 (丁-1) test-v6263 ② 的成員判準：註解騙不過去 ──────────────────────────
{
  const s = readRel(V6263);
  const m = /const HELPER_IMPORT_RE = (\/.*\/[a-z]*);/.exec(s);
  chk('D1 ⭐ test-v6263 裡抓得到 ② 的 import 偵測器（單一定義）', !!m, m ? '' : '找不到 HELPER_IMPORT_RE');
  chk('D1 ⭐⭐ ② 的成員判準**不再**是「原始碼含字面」（includes(HELPER) 必須絕跡）',
      !/files\.get\(rel\)\.includes\(HELPER\)/.test(s) && !/src\.includes\(HELPER\)/.test(s),
      (s.match(/\w+\.includes\(HELPER\)/g) || []).join(' / '));
  if (m) {
    const RE = new Function('return ' + m[1])();
    const t = (x) => RE.test(x);
    chk('D1 ⭐⭐⭐ 偵測器真值表：真的 import 語句 ⇒ true',
        t("import { hasBaseCommit } from './lib/base-blob.mjs';\n") === true);
    chk('D1 ⭐⭐⭐ 偵測器真值表：只有註解提到路徑 ⇒ false（v6.370 實測騙得過去的那一招）',
        t("//   走中央 helper `scripts/lib/base-blob.mjs`\nconst x = 1;\n") === false);
    chk('D1 ⭐⭐ 偵測器真值表：字串字面提到路徑 ⇒ false',
        t("const HELPER = 'lib/base-blob.mjs';\n") === false);
    chk('D1 ★ 偵測器真值表：整支檔案裡完全沒提到 ⇒ false', t("const a = 1;\n") === false);
    chk('D1 ★ 偵測器真值表：帶前導空白的 import 也算數（不是只認行首）',
        t("  import { readBaseBlob } from './lib/base-blob.mjs';\n") === true);
    // ⭐ 行為層佐證：本檔自己、test-v6265、test-v6296 都必須被判為「有 import」
    for (const rel of [SELF, V6265, V6296, V6234]) {
      chk('D1 ⭐ 偵測器對真檔案的判定：' + rel.replace('scripts/', '') + ' 有 import',
          RE.test(readRel(rel)) === true);
    }
  }
  // ── D1b ⭐⭐⭐ 行為層：把 ② 的**真實判準碼**逐字抽出來，餵三個合成樣本真的跑一次 ──
  //   ⚠ 只驗「HELPER_IMPORT_RE 的真值表」擋不住「規則改對了但沒接上去」——
  //     所以這裡抽的是 rawGitUsers／rawHistUsers／helperUsers／offenders **那幾行本身**，
  //     用合成的 files Map 跑，看 ② 的成員判定結果。改壞接線（例如把 importsHelper 換回
  //     includes）在這裡會立刻現形。
  {
    const P = {
      strip: /^const strip = \(s\) => [\s\S]*?;\r?$/m,
      gitCallsIn: /^function gitCallsIn\(src\) \{[\s\S]*?^\}\r?$/m,
      hasHistSha: /^const hasHistSha = [^\n]*;\r?$/m,
      HELPER: /^const HELPER = [^\n]*;\r?$/m,
      RE: /^const HELPER_IMPORT_RE = [^\n]*;\r?$/m,
      importsHelper: /^const importsHelper = [^\n]*;\r?$/m,
      ALLOW: /^const ALLOW = new Map\(\[[\s\S]*?^\]\);\r?$/m,
      rawGitUsers: /^const rawGitUsers = [^\n]*;\r?$/m,
      rawHistUsers: /^const rawHistUsers = [^\n]*;\r?$/m,
      helperUsers: /^const helperUsers = [^\n]*;\r?$/m,
      offenders: /^const offenders = [^\n]*;\r?$/m,
    };
    const parts = {};
    let missing = [];
    for (const [k, re] of Object.entries(P)) {
      const mm = re.exec(s);
      if (mm) parts[k] = mm[0]; else missing.push(k);
    }
    chk('D1b ⭐ 抽得出 ② 的判準碼共 11 段（抽取器自驗；少一段就不要假裝在測）',
        missing.length === 0, JSON.stringify(missing));
    if (missing.length === 0) {
      const HEX = 'a'.repeat(40);
      const FAKE = [
        // ① v6.370 實測騙得過去的那一招：自己 shell out 到 git ＋ 寫死歷史 sha，
        //    但只在**註解**裡提到中央 helper 的路徑 ⇒ 必須被判成 offender
        ['scripts/.fake-offender.mjs',
         "//   走中央 helper `scripts/lib/base-blob.mjs`\n"
         + "import { execFileSync } from 'node:child_process';\n"
         + "const BASE = '" + HEX + "';\n"
         + "const out = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE]);\n"],
        // ② 做對的參照組：真的有 import 語句 ⇒ 不可以被判成 offender
        ['scripts/.fake-good.mjs',
         "import { readBaseBlob } from './lib/base-blob.mjs';\n"
         + "import { execFileSync } from 'node:child_process';\n"
         + "const BASE = '" + HEX + "';\n"
         + "const out = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', BASE]);\n"],
        // ③ 根本不讀歷史 ⇒ 不在列管範圍
        ['scripts/.fake-clean.mjs', "const a = 1;\nconst sha = 'aaaa';\n"],
      ];
      const body = parts.strip + '\n' + parts.gitCallsIn + '\n' + parts.hasHistSha + '\n'
        + parts.HELPER + '\n' + parts.RE + '\n' + parts.importsHelper + '\n' + parts.ALLOW + '\n'
        + parts.rawGitUsers + '\n' + parts.rawHistUsers + '\n' + parts.helperUsers + '\n'
        + parts.offenders + '\n'
        + 'return { offenders, helperUsers, rawGitUsers, rawHistUsers };';
      let out = null, err = '';
      try { out = new Function('files', 'SELF', body)(new Map(FAKE), V6263); }
      catch (e) { err = String((e && e.message) || e); }
      chk('D1b ⭐ ② 的判準碼組得起來並跑得動', out !== null, err);
      if (out) {
        chk('D1b ⭐⭐⭐ 合成 offender（git 呼叫＋歷史 sha，路徑只在註解裡）**必須**被 ② 抓到',
            out.offenders.length === 1 && out.offenders[0] === 'scripts/.fake-offender.mjs',
            JSON.stringify(out.offenders));
        chk('D1b ⭐⭐⭐ 真的有 import 語句的參照組**不可以**被判成 offender（否則 ② 會誤殺）',
            !out.offenders.includes('scripts/.fake-good.mjs')
            && out.helperUsers.includes('scripts/.fake-good.mjs'),
            JSON.stringify(out.helperUsers));
        chk('D1b ⭐⭐ 只在註解裡提到路徑的那一支**不算**走了中央 helper',
            !out.helperUsers.includes('scripts/.fake-offender.mjs'), JSON.stringify(out.helperUsers));
        chk('D1b ★ 不讀歷史的那一支不在列管範圍（掃描器沒有無差別擴張）',
            !out.rawGitUsers.includes('scripts/.fake-clean.mjs')
            && !out.rawHistUsers.includes('scripts/.fake-clean.mjs'),
            JSON.stringify(out.rawGitUsers));
      }
    }
  }
  // HEAD-FAIL：BASE(v6.370) 的 test-v6263 用的還是 includes 字面
  if (!HAS_BASE) {
    shallowSkip('v6.371【D1】HEAD-FAIL：BASE(v6.370) 的 ② 還是 includes 字面', '上面的真值表是本版現況，仍在守');
  } else {
    const b = readBaseBlob(ROOT, BASE_SHA, V6263);
    chk('D1 ⭐⭐ HEAD-FAIL：BASE(v6.370) 的 ② 判準確實是 `files.get(rel).includes(HELPER)`（本版把它換掉了）',
        b.ok && /files\.get\(rel\)\.includes\(HELPER\)/.test(b.out));
  }
}

// ── D2 (丁-2) test-v6263 ⑤ 必須在兩個平台都跑 ────────────────────────────────
let v6263Out = '', v6263Code = -1;
{
  const r = spawnSync(process.execPath, [join(ROOT, V6263)], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 1800000,
    env: { ...process.env, PATH: process.env.PATH },
  });
  v6263Out = String(r.stdout || '') + String(r.stderr || '');
  v6263Code = r.status;
}
const linePass = (frag) => v6263Out.split(/\r?\n/).some((l) => /^\s*PASS /.test(l) && l.includes(frag));
chk('D2 ⭐⭐ 行為層：test-v6263 子行程 exit=0', v6263Code === 0, v6263Out.slice(-500));
chk('D2 ⭐⭐⭐ ⑤ 的兩條突變在**本平台**真的跑過而且是 PASS（v6.370 在 Windows 把它們一起跳掉了）',
    linePass('test-v6224-deck-import-timeout.mjs：改壞回應訊息後**必須紅**')
    && linePass('test-v6230-deck-export-timeout.mjs：改壞回應訊息後**必須紅**'),
    v6263Out.split(/\r?\n/).filter((l) => l.includes('改壞回應訊息')).join(' | '));
chk('D2 ⭐⭐ ⑤ 自己的「全平台都跑完」正對照 PASS', linePass('⑤ 突變測試在**所有平台**都必須真的跑完'));
chk('D2 ⭐⭐ PLATFORM-SKIP 的範圍只剩 ④（⑤ 不准再被一起關掉）',
    !/PLATFORM-SKIP ④⑤/.test(v6263Out),
    (v6263Out.match(/PLATFORM-SKIP[^\n]*/g) || []).join(' | '));
chk('D2 ★ 現況本來就有 PLATFORM-SKIP 或本來就沒有 —— 兩種都要與平台相符',
    (process.platform === 'win32') === /PLATFORM-SKIP/.test(v6263Out),
    process.platform + ' / ' + /PLATFORM-SKIP/.test(v6263Out));
// HEAD-FAIL：BASE(v6.370) 的 test-v6263 在本平台跑起來，⑤ 的那兩條**不存在**
if (!HAS_BASE) {
  shallowSkip('v6.371【D2】HEAD-FAIL：BASE(v6.370) 的 ⑤ 在 Windows 完全不執行', '上面是本版現況的行為端，仍在守');
} else if (process.platform !== 'win32') {
  console.log('  ⚠ D2 HEAD-FAIL 只有在 Windows 才有對照意義（POSIX 上 BASE 的 ⑤ 本來就會跑）—— 本平台以結構斷言代替');
  const b = readBaseBlob(ROOT, BASE_SHA, V6263);
  chk('D2 ⭐⭐ HEAD-FAIL（結構）：BASE(v6.370) 的 ⑤ 確實被關在 `if (WIN)` 的 else 分支裡',
      b.ok && b.out.indexOf('⑤ ⭐⭐ 突變測試') > b.out.indexOf('} else {')
      && b.out.indexOf('⑤ ⭐⭐ 突變測試') < b.out.indexOf('  ranBehaviour = true;'));
} else {
  const b = readBaseBlob(ROOT, BASE_SHA, V6263);
  chk('D2 讀得到 BASE 的 test-v6263', b.ok);
  if (b.ok) {
    // ⚠ 相對 import（'./lib/base-blob.mjs'）與 ROOT 推導都靠檔案位置 ⇒ 必須放在 scripts/ 底下跑
    const f = join(ROOT, 'scripts', '.v6371-v6263-base.mjs');
    let r2 = null;
    try {
      writeFileSync(f, b.out, 'utf8');
      const rr = spawnSync(process.execPath, [f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 1800000 });
      r2 = String(rr.stdout || '') + String(rr.stderr || '');
    } finally { try { rmSync(f, { force: true }); } catch { /* */ } }
    chk('D2 ⭐⭐⭐ HEAD-FAIL：BASE(v6.370) 在 Windows 上 ⑤ 的突變測試**一條都沒跑**（本版必須有兩條）',
        r2 !== null && !/改壞回應訊息後/.test(r2),
        (String(r2).match(/改壞回應訊息[^\n]*/g) || []).join(' | '));
    chk('D2 ★ HEAD-FAIL 對照：BASE 版確實有印 PLATFORM-SKIP ④⑤（證明上一條不是因為它整支沒跑起來）',
        r2 !== null && /PLATFORM-SKIP ④⑤/.test(r2), String(r2).slice(-300));
  }
}

// ── D3 (丁-3) test-v6296 不得再自己 shell out 到 git ─────────────────────────
{
  // ⭐ 用 test-v6263 **自己**那個偵測器（逐字抽出來），不是另外寫一個（Rule 38）
  const s = readRel(V6263);
  const m = /function gitCallsIn\(src\) \{([\s\S]*?)\n\}/.exec(s);
  chk('D3 ⭐ 從 test-v6263 抽得出 gitCallsIn 偵測器', !!m);
  if (m) {
    const strip = new Function('s', "return s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').split('\\n').filter((l) => !/^\\s*\\/\\//.test(l)).join('\\n');");
    const gitCallsIn = new Function('strip', 'return function gitCallsIn(src) {' + m[1] + '\n}')(strip);
    chk('D3 ★ 偵測器正對照：合成樣本（有 git 呼叫）抓得到',
        gitCallsIn("const r = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', X]);").length === 1);
    chk('D3 ★ 偵測器負對照：註解裡的 git 呼叫不算',
        gitCallsIn("// execFileSync('git', ['cat-file'])\nconst a = 1;").length === 0);
    chk('D3 ⭐⭐⭐ test-v6296 現況：自己呼叫 git 的次數是 **0**（已收斂到 readBaseBlob）',
        gitCallsIn(readRel(V6296)).length === 0, JSON.stringify(gitCallsIn(readRel(V6296))));
    chk('D3 ⭐⭐ test-v6296 真的改走中央 helper（有 readBaseBlob 的呼叫點）',
        /readBaseBlob\(ROOT, BASE_SHA, 'src\/routes\/game\/\+page\.svelte'\)/.test(readRel(V6296)));
    if (!HAS_BASE) {
      shallowSkip('v6.371【D3】HEAD-FAIL：BASE(v6.370) 的 test-v6296 自己呼叫 git', '現況斷言仍在守');
    } else {
      const b = readBaseBlob(ROOT, BASE_SHA, V6296);
      chk('D3 ⭐⭐⭐ HEAD-FAIL：BASE(v6.370) 的 test-v6296 確實自己呼叫 git（本版把它收斂掉了）',
          b.ok && gitCallsIn(b.out).length === 1, b.ok ? JSON.stringify(gitCallsIn(b.out)) : '讀不到 BASE');
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】本守衛自己必須在 npm test chain 裡');
{
  const pkg = JSON.parse(readRel('package.json'));
  const chain = String(pkg.scripts.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('E1 ⭐ scripts.test 裡**恰好**有本檔一次', chain.filter((s) => s === 'node ' + SELF).length === 1,
      String(chain.filter((s) => s === 'node ' + SELF).length));
  chk('E1 ★ 本檔在 chain 裡宣告的路徑真的存在', existsSync(join(ROOT, SELF)) && statSync(join(ROOT, SELF)).size > 5000);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】⭐v6.388b~e 守衛的路徑根必須是**跨平台**的（Windows-only 寫法會讓 CI 紅、deploy 被 skip）');
// v6.388 的 test-v6388-mf-wave1.mjs 寫了
//   const ROOT = join(dirname(new URL(import.meta.url).pathname.slice(1)), '..');
// `.slice(1)` 只在 Windows 對（pathname 是 `/E:/x/...`）；Linux 的 pathname 是 `/home/...`，
// 砍掉開頭那個 '/' 就變成**相對路徑** ⇒ CI 上 ENOENT ⇒ build job 全紅 ⇒ deploy job 被 skip
// ⇒ **測試站（GitHub Pages）整版沒有更新**，而本機（Windows）永遠測不出來。
//
// ── 兩層防線 ────────────────────────────────────────────────────────────────
//   F1 行為層 —— 把每一行「路徑根變數的定義」**真的求值一次**（模擬 POSIX），
//      並斷言算出來的值**落在允許的三個根之一**（repo root／scripts／scripts/lib）。
//      ⚠ 只驗 isAbsolute 不夠：`dirname(fileURLToPath(...)) + '\\..'` 求得出絕對路徑，
//        但那是 Windows 分隔符，在 Linux 上是個不存在的目錄（v6.388c 的假綠）。
//   F5 字串層 —— 三條純字串禁令，堵住 F1 求值不到的形狀。
//
// ⚠ 求值環境必須是**模擬的 POSIX**：Windows 上 fileURLToPath('file:///home/x') 會 throw
//   ERR_INVALID_FILE_URL_PATH（要求 drive letter 或 UNC）⇒ 直接餵 node 內建那支的話，
//   每一行都算不出來 ⇒ 整節變成恆綠的安慰劑（v6.388b 第一次寫就踩到）。
//
// ⚠⚠ 區塊註解必須用**真的 tokenizer**（acorn）剝，不可以用正則（v6.388d 的倒退）：
//   `/\/\*[\s\S]*?\*\//g` 會被 `//` 行註解或字串／正則字面裡的 `/*` 觸發
//   （例如 `// … /api/tournament/* 是同源路徑`），一路吃到下一個 `*/`。
//   實測：56 支守衛的真程式碼被剝成空白，其中 **4 支的 `const ROOT =` 行整行消失**
//   （test-ai-playbook-contract、test-v6149-sw-api-bypass、test-v6211-pending-clobber、
//     test-v6296-lobby-friends-tab）⇒ 把 v6.388 那個原始壞寫法放回那 4 支，守衛照樣全綠。
//   ⇒ 用 acorn 的 onComment 取真正的 Block 區間，並且 **acorn 載不到就一律紅**（F0c，fail-closed），
//     絕不 try/catch 靜默退回正則 —— 那只會變成另一個安慰劑。
//   ⇒ 另加 F0d 自證：剝完之後路徑根定義行**一行都不能少**。
//
// ── 已知極限（**實測**過的，不要再寫「都逃不過」）────────────────────────────
//   下列寫法兩層都守不到，F 節不宣稱守得住（⭐v6.388g 依 Opus 5 的實測**現查更新**）：
//     ・解構：`const { pathname: pn } = new URL(import.meta.url);` ＋ 別處 `pn.slice(1)`
//     ・正則取代：`fileURLToPath(import.meta.url).replace(/\/scripts\/.*$/, '')`
//       （Windows 下反斜線不 match ⇒ ROOT 會變成檔案路徑本身）
//     ・反斜線的其他拼法：模板字串 `+ \`\\..\``、`.concat('\\..')`
//   ⚠ v6.388e/f 的清單裡有一項是**錯的**：`.path\u006eame` 實測**會紅**
//     （identsOf 把字串字面剝成 ''，求值後是相對路徑 ⇒ F1 抓得到）。已移除。
//   （`const u = import.meta.url;` ＋ 下一行 `new URL(u).pathname.slice(1)` 這種**關鍵字分行**
//    是守得到的 —— F5 規則②不看 import.meta 在不在同一行。）
//   這一節守的是「照著現有守衛抄、順手自己優化路徑處理」這個**實際發生過**的情境，
//   不是一個防惡意繞過的沙箱。
{
  const REPO = '/home/runner/work/ptcg-tw-sim/ptcg-tw-sim';
  const P = pathMod.posix;
  const fileURLToPathPosix = (u) => decodeURIComponent(new URL(u).pathname);
  // ⚠v6.388f（Opus 5 複審 🟡2）：這裡原本是白名單集合
  //   new Set([REPO, REPO + '/scripts', REPO + '/scripts/lib'])
  //   —— 但 `const __filename = fileURLToPath(import.meta.url);` 是 **Node 官方的跨平台寫法**，
  //   算出來的是**檔案**路徑，不在集合裡 ⇒ 假紅 ⇒ CI 紅 ⇒ deploy 被 skip
  //   （跟這一整串版本在修的災難同型，只是方向相反）。
  //   ⇒ 判準改成「落在 repo 之下的 POSIX 絕對路徑」：壞寫法算出來的是**相對路徑**或**含反斜線**，
  //     兩者都還是會紅（F2／F2b 正對照在守）。
  const normRoot = (v) => {
    const n = P.normalize(String(v));
    return n.length > 1 ? n.replace(/\/+$/, '') : n;
  };

  // ── acorn（真 tokenizer）──────────────────────────────────────────────────
  // ⚠ 用 createRequire 而不是靜態 import：acorn 是 transitive 相依（在 package-lock 裡、
  //   npm ci 會裝），靜態 bare import 會被 test-v6380【B1】要求寫進 package.json。
  //   萬一哪天它真的不見了，F0c 會紅 —— 那正是我們要的（fail-closed）。
  const __req = createRequire(import.meta.url);
  let acornMod = null, acornErr = '';
  try { acornMod = __req('acorn'); } catch (e) { acornErr = String((e && e.message) || e).slice(0, 140); }
  chk('F0c ★★★ acorn 必須載得到（區塊註解要用真 tokenizer 剝；載不到一律紅，不得靜默退回正則）',
      !!acornMod && typeof acornMod.parse === 'function', acornErr);

  /**
   * 把區塊註解換成等量空白（保住行號與行數），並回傳 acorn 算出來的**權威註解區間**。
   * acorn 不可用時原樣回傳（F0c 已經先紅了）。
   * ⚠ 為什麼不用中央的 scripts/lib/strip-comments.mjs（`stripCommentsBlankChecked`）：
   *   那一支連 `//` 行註解一起剝，而本節**必須**看得到行註解 ——
   *   `isLineComment()` 要靠它判斷、F5 的豁免標記也寫在行尾註解裡。
   *   （中央那份對這幾支檔案的**區塊**註解處理實測是正確的，本節不是在繞過它。）
   */
  const stripBlockComments = (s) => {
    if (!acornMod) return { out: s, spans: [] };
    const spans = [];
    try {
      acornMod.parse(s, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true,
        onComment: (isBlock, _text, start, end) => { if (isBlock) spans.push([start, end]); } });
    } catch { return { out: s, spans: [] }; }   // 解析不了的檔原樣處理（F0e 會記帳）
    let out = s;
    for (const [a, b] of spans) out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, ' ') + out.slice(b);
    return { out, spans };
  };
  /** 每一行的起始字元 offset（用來判斷該行是否整行落在某個註解區間裡） */
  const lineStartsOf = (s) => { const a = [0]; for (let i = 0; i < s.length; i++) if (s[i] === '\n') a.push(i + 1); return a; };

  // 求值環境提供得起的識別字。
  // ⚠ 必須包含 pathname／slice（否則 v6.388 那個壞寫法會被這一關放走）
  // ⚠ 必須包含 new（否則 new URL(...) 型全被濾掉 —— v6.388c 第一次漏了，rows 從 792 掉到 56）
  const ALLOWED_IDENTS = new Set(['URL', 'fileURLToPath', 'join', 'dirname', 'path', 'process', '__U',
    'posix', 'resolve', 'normalize', 'relative', 'sep', 'isAbsolute', 'env', 'cwd', 'argv',
    'pathname', 'href', 'slice', 'substring', 'replace', 'decodeURIComponent', 'String',
    'new', 'typeof', 'void', 'null', 'true', 'false', 'undefined']);
  const rhsOf = (line) => line
    .replace(/^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/, '').split(';')[0]
    .replace(/import\.meta\.url/g, '__U')
    // ⚠ 環境變數未設時是 undefined，**不可以**換成 process 物件 ——
    //   否則 `process.env.X ?? fileURLToPath(...)` 會直接回傳那個物件 ⇒ 求值成 null ⇒ 假紅。
    .replace(/process\.env\.[A-Za-z_$][\w$]*/g, 'undefined');
  const identsOf = (rhs) => (rhs
    .replace(/\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+\/[gimsuy]*/g, ' ')   // 先剝掉正則字面（裡面的 $ 不是識別字）
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "''")                          // 再剝掉字串字面
    .match(/[A-Za-z_$][\w$]*/g) || []);
  const evalRootLine = (line, url) => {
    const expr = rhsOf(line);
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('URL', 'fileURLToPath', 'join', 'dirname', 'path', 'process', '__U',
        'return (' + expr + ');');
      const v = fn(URL, fileURLToPathPosix, P.join, P.dirname, P, process, url);
      return typeof v === 'string' ? v : null;
    } catch { return null; }
  };
  const goodRoot = (v) => typeof v === 'string' && !v.includes('\\')
    && (normRoot(v) === REPO || normRoot(v).startsWith(REPO + '/'));

  // ⚠ 只掃**正式的**守衛檔：站長機器上 scripts/ 常有未追蹤的 tmp*.mjs／_repro*.mjs，
  //   本機與 CI 的掃描母體會不一樣，一支垃圾檔就能弄出假紅。
  const isFormal = (f) => f.endsWith('.mjs') && !/^(tmp|_|\.)/.test(f);
  const isLineComment = (l) => l.trim().startsWith('//');
  const DECL = /^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/;
  const looksLikeRootLine = (l) => !isLineComment(l) && l.includes('import.meta.url') && DECL.test(l)
    && /fileURLToPath|new URL|\.pathname/.test(l)
    && !/^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*['"`]/.test(l);
  // 已知安全、可以不進 F1 求值的形狀：讀自己這個檔（readFileSync(fileURLToPath(import.meta.url))）。
  // ⚠ 這是**唯一**的白名單。多出別的形狀 ⇒ F0b 紅 ⇒ 人要來看那是什麼，不可以無聲放行。
  const KNOWN_SAFE_SKIP = (l) => /readFileSync\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)/.test(l)
    && !l.includes('.pathname');

  // ⚠ 掃描範圍只有這兩層。scripts/tools/、scripts/scrape/、scripts/*.js 不在內 ——
  //   現況 npm test chain 的每一步都是 `node scripts/*.mjs`（沒有 .js、沒有子目錄），
  //   所以目前沒有 CI 風險；但**日後把 scripts/tools/ 接進 chain 就會有盲區**，記得同步加進來。
  const scanDirs = ['scripts', 'scripts/lib'];
  const rows = [];        // 「路徑根定義行」——會被 F1 求值
  const skippedRows = []; // 被識別字白名單濾掉、又不在 KNOWN_SAFE_SKIP 裡的（必須是 0）
  const allLines = [];    // 剝掉區塊註解後的全部行 —— F5 字串層用
  let lostByStrip = [];   // F0d：剝完之後不見了的路徑根定義行
  let parseFailFiles = [];
  for (const d of scanDirs) {
    let names = [];
    try { names = readdirSync(join(ROOT, d)); } catch { continue; }
    for (const fn of names.filter(isFormal)) {
      const rel = d + '/' + fn;
      const raw = readFileSync(join(ROOT, d, fn), 'utf8');
      if (acornMod) {
        try { acornMod.parse(raw, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
        catch { parseFailFiles.push(rel); }
      }
      const { out: src, spans } = stripBlockComments(raw);
      const before = raw.split(/\r?\n/);
      const after = src.split(/\r?\n/);
      const starts = lineStartsOf(raw);
      // ⚠v6.388f（Opus 5 複審 🟡1）：F0d 原本是「剝前是路徑根定義行、剝後不是 ⇒ 剝壞了」，
      //   但一行**寫在區塊註解裡**的路徑根定義被**正確**剝掉，也完全符合這個條件 ⇒ 假紅。
      //   （而這一整串版本的敘事正是在鼓勵大家把那個壞寫法寫進檔頭說明，本 repo 守衛檔頭
      //     清一色是 /** … */ ⇒ 下一個人照做就 CI 紅、deploy 被 skip。）
      //   ⇒ 改拿 acorn 的**權威註解區間**當基準：整行落在某個區間裡就是「本來就該剝掉」。
      // ⚠v6.388g（Opus 5 複審 🔴1）：這裡原本是
      //     return spans.some(([s0, s1]) => s0 <= a && b <= s1 + 1);
      //   —— b 是**下一行的起始 offset**，`s1 + 1` 假設「註解剛好結束在行尾、後面只有一個 \n」。
      //   兩個前提都不成立：
      //     (a) CRLF 下 b = s1 + 2（多一個 \r）⇒ 本機誤紅、CI 綠 ⇒ **守衛的行為跟行尾字元綁在一起**
      //     (b) 註解結束在**行中間**、後面還有程式碼（`*/ export default 1;`）
      //         ⇒ **LF 也紅** ⇒ CI build 紅 ⇒ deploy job 被 skip ⇐ 正是本串版本在修的災難
      //   ⇒ 改成「這一行**被抹掉的每一個字元**都必須落在 acorn 的註解區間內」：
      //     不看行尾、不看註解結束在哪裡，只看「被動到的字元有沒有授權」。
      const inComment = (i) => {
        const a = starts[i] ?? 0;
        const b = (starts[i + 1] ?? raw.length);
        for (let k = a; k < b; k++) {
          if (raw[k] === src[k]) continue;                                   // 沒被動到
          if (!spans.some(([s0, s1]) => k >= s0 && k < s1)) return false;     // 被動到，但不在註解裡 ⇒ 剝壞了
        }
        return true;
      };
      const url = 'file://' + REPO + '/' + rel;   // ⭐ 用該檔**真實的**相對路徑組 URL
      for (let i = 0; i < after.length; i++) {
        const line = after[i];
        allLines.push({ fn: rel, line });
        // F0d：剝之前是路徑根定義行、剝之後卻不是 ⇒ 剝壞了（v6.388d 的正則版就是這樣壞的）
        if (looksLikeRootLine(before[i] ?? '') && !looksLikeRootLine(line) && !inComment(i)) {
          lostByStrip.push(rel + ':' + (i + 1) + '  ' + String(before[i]).trim().slice(0, 70));
        }
        if (!looksLikeRootLine(line)) continue;
        const entry = { fn: rel, url, line: line.trim() };
        // 右側用到我們沒提供的函式就不是單純的路徑計算，硬求值只會得到 null ⇒ 假紅。
        if (!identsOf(rhsOf(line)).every((id) => ALLOWED_IDENTS.has(id))) {
          if (!KNOWN_SAFE_SKIP(line)) skippedRows.push(entry);
          continue;
        }
        rows.push(entry);
      }
    }
  }

  chk('F0 ★ 下限斷言：掃得到夠多支守衛的路徑根定義（掃描器壞掉會在這裡紅）',
      rows.length >= 700, String(rows.length));
  // ★★ F0b：白名單外的靜默跳過必須是 **0** —— 無聲放行的唯一入口。
  //    若你新加的寫法落在這裡：先確認它在 Linux 上真的算得出 repo root，
  //    再把它加進 KNOWN_SAFE_SKIP 並在那裡寫明理由。**不要**單純放寬門檻。
  chk('F0b ★★ 白名單外、被識別字過濾靜默跳過的路徑根定義行必須是 0',
      skippedRows.length === 0,
      JSON.stringify(skippedRows.slice(0, 5).map((r) => r.fn + ' :: ' + r.line.slice(0, 70))));
  // ★★ F0d：剝區塊註解不可以吃掉真程式碼（v6.388d 的正則版吃掉了 4 支守衛的 ROOT 行）
  chk('F0d ★★★ 剝註解不得吃掉**註解以外**的路徑根定義行（基準＝acorn 算出來的註解區間）',
      lostByStrip.length === 0, JSON.stringify(lostByStrip.slice(0, 6)));
  chk('F0e ★ 每一支守衛檔都要 parse 得過（parse 不過 ⇒ 區塊註解剝不乾淨 ⇒ 掃描有盲區）',
      parseFailFiles.length === 0, JSON.stringify(parseFailFiles.slice(0, 5)));

  const broken = rows.filter((r) => !goodRoot(evalRootLine(r.line, r.url)));
  // ⚠ 責任分工（v6.388g）：F1 放寬成「repo 之下的絕對路徑」之後，它只保證
  //   「在 Linux 上算得出一個合理的 repo 內路徑」。**Windows-only 寫法的偵測責任在 F5**
  //   （例：`const u = import.meta.url;` ＋ `'/' + new URL(u).pathname.slice(1)` 會算出
  //     repo 之下的絕對路徑 ⇒ F1 綠，但 F5 規則②會紅）。
  //   ⇒ **不要因為覺得 F5 冗餘就把它砍掉**，那會直接開洞。
  chk('F1 ⭐⭐⭐ 每一行路徑根定義在 **POSIX**（Linux／CI）底下都必須算出 repo 之下的絕對路徑',
      broken.length === 0,
      JSON.stringify(broken.slice(0, 5).map((r) => ({ fn: r.fn, v: evalRootLine(r.line, r.url), line: r.line.slice(0, 80) }))));

  const U = 'file://' + REPO + '/scripts/x.mjs';
  const BAD = "const ROOT = join(dirname(new URL(import.meta.url).pathname.slice(1)), '..');";   // F5-EXEMPT 守衛自己的樣本
  chk('F2 ★★ 正對照：v6.388 那個 Windows-only 寫法，在 POSIX 底下算出來的是相對路徑（判定為壞）',
      !goodRoot(evalRootLine(BAD, U)), JSON.stringify(evalRootLine(BAD, U)));
  const BAD2 = "const ROOT = dirname(fileURLToPath(import.meta.url)) + '\\\\..';";   // F5-EXEMPT 守衛自己的樣本
  chk('F2b ★★ 正對照2：`dirname(fileURLToPath(...)) + 反斜線..` 雖然是絕對路徑，也必須判定為壞',
      !goodRoot(evalRootLine(BAD2, U)), JSON.stringify(evalRootLine(BAD2, U)));
  const GOOD = "const ROOT = fileURLToPath(new URL('..', import.meta.url));";
  chk('F3 ★ 反向正對照：官方寫法在同一個 evaluator 下判定為好', goodRoot(evalRootLine(GOOD, U)),
      JSON.stringify(evalRootLine(GOOD, U)));
  const GOOD2 = "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');";
  chk('F4 ★ 反向正對照2：join(dirname(fileURLToPath(...))) 型也判定為好', goodRoot(evalRootLine(GOOD2, U)),
      JSON.stringify(evalRootLine(GOOD2, U)));

  // ★★★ F5：Rule 46 本文的直接執行面 —— 三條純字串禁令
  // ⚠ 這三個字面都要拆開組，否則這一節自己的實作行就會命中自己的判準（自指假紅）。
  const F5_EXEMPT = 'F5-' + 'EXEMPT';
  const K_URL = 'import.meta' + '.url';
  const K_PATH = '.path' + 'name';
  const f5rules = [
    // ① 同一行同時出現 import.meta 的 url 與 URL 的 path name
    (l) => l.includes(K_URL) && l.includes(K_PATH),
    // ② 砍 pathname 開頭那個斜線的動作本身就是 Windows-only（**不看** import.meta 在不在同一行，
    //    所以「先把 url 存進變數、下一行才取 pathname」也抓得到）
    //    ⚠ 若你是在解析 http URL（`new URL(req.url).pathname.slice(1)` 是合法的），
    //      請改寫成 `.pathname.replace(/^\//, '')`；本節的豁免標記是守衛自己樣本專用，不要借用。
    (l) => l.includes(K_PATH + '.slice(') || l.includes(K_PATH + '.substring(')
        || l.includes("['path" + "name']") || l.includes('["path' + 'name"]'),
    // ③ 路徑根定義行把反斜線**拼接**進路徑（`+ '\\..'`）
    //    ⚠ 只抓「加號後面接一個含反斜線的字串字面」。
    //      `.replace(/[\\/]$/, '')`、`.replace(/\\/g, '/')` 這種**正規化**是正確寫法，不可誤殺
    //      （perf-v6248-split-tradeoff.mjs 就是這樣寫的，v6.388d 第一版把它判成違規）。
    //    ⚠ 已知極限：模板字串與 .concat() 的反斜線拼接抓不到。
    (l) => (l.includes(K_URL) || l.includes('fileURLToPath')) && DECL.test(l) && /\+\s*['"]\\\\/.test(l),
  ];
  const violate = (l) => !isLineComment(l) && !l.includes(F5_EXEMPT) && f5rules.some((r) => r(l));
  const f5bad = allLines.filter((r) => violate(r.line));
  chk('F5 ⭐⭐⭐ scripts/ 不得有 Windows-only 的路徑處理（IRON_RULES Rule 46 的三條字串禁令）',
      f5bad.length === 0,
      JSON.stringify(f5bad.slice(0, 5).map((r) => r.fn + ' :: ' + r.line.trim().slice(0, 90))));
  const probeBad = [
    "  const REPO_ROOT = dirname(new URL(import.meta.url).pathname.slice(1));",   // F5-EXEMPT 樣本
    "export const ROOT3 = new URL(import.meta.url).pathname.slice(1);",           // F5-EXEMPT 樣本
    "const ROOT4 = u.pathname.slice(1);",                                         // F5-EXEMPT 樣本（規則②：關鍵字分行）
    "const ROOT5 = dirname(fileURLToPath(import.meta.url)) + '\\\\..';",          // F5-EXEMPT 樣本（規則③）
  ];
  const probeGood = [
    "const clean = fileURLToPath(new URL('..', import.meta.url));",
    "const clean2 = join(dirname(fileURLToPath(import.meta.url)), '..');",
  ];
  chk('F5b ★★ 正對照：三條禁令都抓得到（含關鍵字分行、反斜線拼接），且不誤殺兩種官方寫法',
      probeBad.filter((l) => f5rules.some((r) => r(l))).length === probeBad.length
      && probeGood.filter((l) => f5rules.some((r) => r(l))).length === 0,
      JSON.stringify({ bad: probeBad.filter((l) => f5rules.some((r) => r(l))).length,
                       good: probeGood.filter((l) => f5rules.some((r) => r(l))).length }));
  const exemptRows = allLines.filter((r) => r.line.includes(F5_EXEMPT));
  // ⚠ 額度是「恰好夠用」的：本檔目前 6 行（BAD、BAD2、probeBad×4），其他檔一律不准用。
  //   別的檔要寫壞寫法當樣本，請用字串拼接（'import.meta' + '.url'），
  //   mutcheck-v6388d-guard-root.mjs 就是這樣做的。
  chk('F5c ★ 豁免標記只准出現在本守衛自己的樣本行（其他檔請改用字串拼接，不要借用標記）',
      exemptRows.length <= 6 && exemptRows.every((r) => r.fn === SELF),
      JSON.stringify(exemptRows.map((r) => r.fn)));
  // ★ F6：本節的突變測試必須留在 repo 裡，**而且真的還在測這兩條**
  //   （Rule 46：「查法要一併寫進文件，讓下一個人能複驗」；只驗檔案存在＝安慰劑）
  {
    const MUT = 'scripts/mutcheck-v6388d-guard-root.mjs';
    const ok = existsSync(join(ROOT, MUT));
    const body = ok ? readFileSync(join(ROOT, MUT), 'utf8') : '';
    chk('F6 ★★ 突變測試在 repo 裡，而且還在檢查 F1／F5 這兩條（只驗檔案存在＝安慰劑）',
        ok && body.includes('F1 ' + '⭐⭐⭐') && body.includes('F5 ' + '⭐⭐⭐'),
        JSON.stringify({ exists: ok, len: body.length }));
  }
}


const skipped = shallowSkipCount();
console.log(`\n[v6371-guard-hygiene] PASS ${n - bad} / FAIL ${bad}` + (skipped ? ` / SHALLOW-SKIP ${skipped}` : ''));
process.exit(bad ? 1 : 0);
