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
console.log('\n【F】⭐v6.388b/c 守衛的 ROOT 必須是**跨平台**的（Windows-only 寫法會讓 CI 紅、deploy 被 skip）');
// v6.388 的 test-v6388-mf-wave1.mjs 寫了
//   const ROOT = join(dirname(new URL(import.meta.url).pathname.slice(1)), '..');
// `.slice(1)` 只在 Windows 對（pathname 是 `/E:/x/...`）；Linux 的 pathname 是 `/home/...`，
// 砍掉開頭那個 '/' 就變成**相對路徑** ⇒ CI 上 ENOENT ⇒ build job 全紅 ⇒ deploy job 被 skip
// ⇒ **測試站（GitHub Pages）整版沒有更新**，而本機（Windows）永遠測不出來。
//
// 兩層防線：
//   F1 行為層 —— 把每一行「路徑根變數的定義」**真的求值一次**（餵 POSIX 形狀的 file:// URL、
//      用 path.posix 的 join/dirname/isAbsolute），斷言算出來是絕對路徑。
//   F5 字串層 —— Rule 46 本文的直接執行面：任何一行同時出現 `import.meta.url` 與 `.pathname`
//      就紅。多行定義、奇怪的變數名、求值不出來的寫法，都逃不過這一條。
//
// ⚠ 求值環境必須是**模擬的 POSIX**：在 Windows 上 fileURLToPath('file:///home/x') 會 throw
//   ERR_INVALID_FILE_URL_PATH（它要求 drive letter 或 UNC）⇒ 直接餵 node 內建那支的話，
//   每一行都算不出來 ⇒ 整節變成恆綠的安慰劑（v6.388b 第一次寫就踩到）。
//
// ⚠v6.388c（Fable 5 複審 🟡1／🟡2）：
//   ・掃描條件原本是 `/^const\s+ROOT\s*=/`（第 0 欄、只認 ROOT 這個名字、只認單行）
//     ⇒ repo 裡 23 支 `const REPO_ROOT =`、3 支 `export const ROOT`、以及縮排寫法（共 55 行）
//     **完全逃過掃描**。已放寬成「(export) const|let|var <任何名字> =」。
//   ・F0 下限原本是 400，實際 tracked 是 737 ⇒ 掃描器壞到只剩一半仍然綠。已提高到 700。
{
  const POSIX_URL = 'file:///home/runner/work/ptcg-tw-sim/ptcg-tw-sim/scripts/x.mjs';
  const P = pathMod.posix;
  const fileURLToPathPosix = (u) => decodeURIComponent(new URL(u).pathname);
  /** 把一行 `<decl> <名字> = <expr>;` 在模擬的 POSIX 環境下求值；回傳字串，求不出來回傳 null */
  const evalRootLine = (line, url) => {
    // ⚠ 有些守衛把根變數和別的宣告寫在同一行（test-swap-ability.mjs），
    //   所以取「第一個分號之前」，不能只砍行尾分號。
    const expr = line.replace(/^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/, '')
      .split(';')[0]
      .replace(/import\.meta\.url/g, '__U');
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('URL', 'fileURLToPath', 'join', 'dirname', 'path', 'process', '__U',
        'return (' + expr + ');');
      const v = fn(URL, fileURLToPathPosix, P.join, P.dirname, P, process, url);
      return typeof v === 'string' ? v : null;
    } catch { return null; }
  };
  // ⚠ 只掃**正式的**守衛檔：站長機器上 scripts/ 常有未追蹤的 tmp*.mjs／_repro*.mjs，
  //   本機與 CI 的掃描母體會不一樣，一支垃圾檔就能弄出假紅。
  const isFormal = (f) => f.endsWith('.mjs') && !/^(tmp|_|\.)/.test(f);
  // 求值環境提供得起的識別字（含 pathname/slice —— 壞寫法要進得來才守得到）
  const ALLOWED_IDENTS = new Set(['URL', 'fileURLToPath', 'join', 'dirname', 'path', 'process', '__U',
    'posix', 'resolve', 'normalize', 'relative', 'sep', 'isAbsolute', 'env', 'cwd', 'argv',
    'pathname', 'href', 'slice', 'substring', 'replace', 'decodeURIComponent', 'String',
    'new', 'typeof', 'void', 'null', 'true', 'false', 'undefined']);   // ⚠ 'new' 一定要有，否則 new URL(...) 全被濾掉
  const onlyAllowedIdents = (line) => {
    const rhs = line.replace(/^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/, '').split(';')[0]
      .replace(/import\.meta\.url/g, '__U')
      .replace(/process\.env\.[A-Za-z_$][\w$]*/g, 'process')   // 環境變數名不是識別字白名單的事
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "''");   // 先把字串字面挖掉，免得字串內容被當識別字
    const ids = rhs.match(/[A-Za-z_$][\w$]*/g) || [];
    return ids.every((id) => ALLOWED_IDENTS.has(id));
  };
  const scanDirs = ['scripts', 'scripts/lib'];
  const rows = [];
  const allLines = [];
  for (const d of scanDirs) {
    let names = [];
    try { names = readdirSync(join(ROOT, d)); } catch { continue; }
    for (const fn of names.filter(isFormal)) {
      const src = readFileSync(join(ROOT, d, fn), 'utf8');
      for (const line of src.split(/\r?\n/)) {
        allLines.push({ fn: d + '/' + fn, line });
        if (!line.includes('import.meta.url')) continue;
        if (!/^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/.test(line)) continue;
        // ⚠ 只收「真的在算路徑」的行 —— createRequire(import.meta.url) 這種不是路徑計算，
        //   硬拿去求值只會得到 null ⇒ 假紅。路徑計算一定會用到 fileURLToPath 或 new URL。
        if (!/fileURLToPath|new URL|\.pathname/.test(line)) continue;
        // ⚠ 右側是純字串字面的不算（別的守衛會把 ROOT 定義存成字串樣本去做突變測試，
        //   例如 test-v6246 的 const ROOT_LINE = "const ROOT = fileURLToPath(...)";）
        if (/^\s*(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*['"`]/.test(line)) continue;
        // ⚠ 只收「純路徑計算」的行：右側用到我們沒提供的函式（readFileSync、normEol…）
        //   就不是路徑根定義，硬拿去求值只會得到 null ⇒ 假紅。那些形狀由 F5 字串層守。
        //   ⚠ 白名單**必須**包含 pathname／slice，否則 v6.388 那個壞寫法會被這一關放走。
        if (!onlyAllowedIdents(line)) continue;
        rows.push({ fn: d + '/' + fn, line: line.trim() });
      }
    }
  }
  chk('F0 ★ 下限斷言：掃得到夠多支守衛的路徑根定義（掃描器壞掉會在這裡紅）',
      rows.length >= 700, String(rows.length));
  const broken = rows.filter((r) => {
    const v = evalRootLine(r.line, POSIX_URL);
    return v === null || !P.isAbsolute(v);
  });
  chk('F1 ⭐⭐⭐ 每一行路徑根定義在 **POSIX**（Linux／CI）底下都必須算出**絕對路徑**',
      broken.length === 0, JSON.stringify(broken.slice(0, 5)));
  // ★★ 正對照：v6.388 那個 Windows-only 寫法，必須被同一個 evaluator 判成「非絕對」
  //    —— 這一條證明 F1 不是恆真（沒有它，F1 在 evaluator 壞掉時也會綠）
  const BAD = "const ROOT = join(dirname(new URL(import.meta.url).pathname.slice(1)), '..');";   // F5-EXEMPT 守衛自己的樣本
  const badVal = evalRootLine(BAD, POSIX_URL);
  chk('F2 ★★ 正對照：v6.388 那個 Windows-only 寫法，在 POSIX 底下確實算出**相對路徑**',
      typeof badVal === 'string' && !P.isAbsolute(badVal), JSON.stringify(badVal));
  // ★ 反向正對照：官方寫法必須算得出絕對路徑（證明 evaluator 本身沒壞掉）
  const GOOD = "const ROOT = fileURLToPath(new URL('..', import.meta.url));";
  const goodVal = evalRootLine(GOOD, POSIX_URL);
  chk('F3 ★ 反向正對照：官方寫法在同一個 evaluator 下算得出絕對路徑（evaluator 沒壞）',
      typeof goodVal === 'string' && P.isAbsolute(goodVal), JSON.stringify(goodVal));
  const GOOD2 = "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');";
  const good2 = evalRootLine(GOOD2, POSIX_URL);
  chk('F4 ★ 反向正對照2：join(dirname(fileURLToPath(...))) 型也算得出絕對路徑',
      typeof good2 === 'string' && P.isAbsolute(good2), JSON.stringify(good2));
  // ★★★ F5：Rule 46 本文的直接執行面 —— 字串層禁令，把 F1 求值抓不到的形狀全部堵死
  //   （多行定義、包在函式裡、算不出來的寫法……只要同一行同時出現這兩個東西就是違規）
  // ⚠ 這三個字面都要拆開組，否則這一節自己的實作行就會命中自己的判準（自指假紅）。
  const F5_EXEMPT = 'F5-' + 'EXEMPT';
  const K_URL = 'import.meta' + '.url';
  const K_PATH = '.path' + 'name';
  //   ⚠ 純註解行不算違規（Rule 46 禁的是**會執行的程式碼**，不是說明文字；
  //     本節開頭的說明就必須逐字引用那個壞寫法）。
  const isComment = (l) => { const t = l.trim(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };
  const pathnameViolations = allLines.filter((r) =>
    !isComment(r.line) && r.line.includes(K_URL) && r.line.includes(K_PATH)
    && !r.line.includes(F5_EXEMPT));
  // ⚠ 斷言標題也要避開那兩個字面（否則這一行自己就是違規行）
  chk('F5 ⭐⭐⭐ scripts/ 裡不得有任何一行同時出現 import.meta 的 url 與 URL 的 path name（IRON_RULES Rule 46）',
      pathnameViolations.length === 0,
      JSON.stringify(pathnameViolations.slice(0, 5).map((r) => r.fn + ' :: ' + r.line.trim().slice(0, 90))));
  // ★ F5 的正對照：判準真的抓得到（否則 F5 在掃描器壞掉時也會綠）
  const probe = [
    "  const REPO_ROOT = dirname(new URL(import.meta.url).pathname.slice(1));",   // F5-EXEMPT 守衛自己的樣本
    "export const ROOT3 = new URL(import.meta.url).pathname.slice(1);",           // F5-EXEMPT 守衛自己的樣本
    "const clean = fileURLToPath(new URL('..', import.meta.url));",
  ];
  const caught = probe.filter((l) => l.includes(K_URL) && l.includes(K_PATH) && !l.includes(F5_EXEMPT));
  chk('F5b ★★ 正對照：F5 的判準抓得到 REPO_ROOT／export const／縮排 三種變形，且不誤殺正確寫法',
      caught.length === 2, JSON.stringify(caught.length));
  // ★ 豁免不得被濫用：全 scripts/ 只允許守衛自己那一行
  const exemptRows = allLines.filter((r) => r.line.includes(F5_EXEMPT));
  chk('F5c ★ 豁免標記只准出現在本守衛自己的樣本行（不得被拿來繞過 F5）',
      exemptRows.length <= 3 && exemptRows.every((r) => r.fn === 'scripts/' + SELF.replace(/^scripts\//, '')),
      JSON.stringify(exemptRows.map((r) => r.fn)));
}


const skipped = shallowSkipCount();
console.log(`\n[v6371-guard-hygiene] PASS ${n - bad} / FAIL ${bad}` + (skipped ? ` / SHALLOW-SKIP ${skipped}` : ''));
process.exit(bad ? 1 : 0);
