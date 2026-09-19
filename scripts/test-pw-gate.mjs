#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// test-pw-gate —— Playwright 的中央閘（scripts/lib/pw.mjs）與過渡期把手
//
// 【背景】
//   站內有 10 支守衛帶 Playwright 段（v6285／6286／6293／6296／6297／6301／6302／
//   6303／6304／6306）。在 2026-09-19 之前：
//     ① `playwright` 不在 package.json 的 devDependencies ⇒ CI 的 `npm ci` 不會裝它
//        ⇒ 那 10 支的 PW 段從實裝那天起**一次都沒有在 CI 上執行過**；
//     ② 它們**各寫各的 gate**（四種形狀、十份判準），skip 也各印各的
//        ⇒ 平行 runner 想對「skip 標記」下硬判準時抓不到它們。
//
// 【這支守衛守什麼】
//   A) Rule 38：PW 的判準只能有一份 —— 除了 scripts/lib/pw.mjs 以外，
//      chain 上的守衛不得自己 `require('playwright')`。
//   B) ⭐ 三個**過渡期把手**必須成對存在，缺一即紅：
//        ① scripts/lib/pw.mjs 的 PW_DEFAULT_MODE === 'off'
//        ② deploy.yml 主 chain 的 `PTCG_PW: 'off'` 與 `PTCG_ALLOW_ENV_SKIP: '1'`
//        ③ deploy.yml 的 continue-on-error 獨立 step 跑 scripts/run-pw-guards.mjs
//      ⇒ 哪天把 ① 改成 'auto' 卻忘了刪 ②③（或反過來），這裡會立刻翻紅。
//      ⚠ 這**不是**在要求永遠維持過渡期 —— 它要求的是「三者一致」，
//        而且 B0 會把現況（過渡期 or 已收尾）印出來，不讓它變成隱形狀態。
//   C) CI 真的有裝瀏覽器（cache + install step），而且裝的是 chromium-headless-shell。
//   D) pwMode() 的行為（表格測試，判準只有一份）。
//   E) 本守衛自己必須在 chain 裡。
//
// 【HEAD-FAIL】A/B/C 在 BASE 上都會紅：BASE 沒有 scripts/lib/pw.mjs、
//   10 支各自 require、deploy.yml 沒有那兩個 step。
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { parseChain } from './lib/chain-parse.mjs';
import { pwMode, PW_DEFAULT_MODE } from './lib/pw.mjs';
import { usesPwGate, listPwGuards, MIN_PW_GUARDS } from './run-pw-guards.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
let P = 0, F = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { P++; console.log('  PASS ' + name); }
  else { F++; console.log('  FAIL ' + name + (detail ? '\n        ' + detail : '')); }
};
const SELF = 'scripts/test-pw-gate.mjs';
const GATE = 'scripts/lib/pw.mjs';
const RUNNER = 'scripts/run-pw-guards.mjs';
const YML = '.github/workflows/deploy.yml';
const rd = (rel) => { try { return normEol(readFileSync(join(ROOT, rel), 'utf8')); } catch { return ''; } };

/** 判準只有一份：自己 require playwright（＝沒走中央閘）。 */
export function rawPwRequire(strippedSrc) {
  return /(?:require|require_|createRequire\([^)]*\))\s*(?:\.resolve\s*)?\(\s*(?:process\.env\.PLAYWRIGHT_MODULE\s*\|\|\s*)?['"]playwright(?:-core)?['"]/
    .test(strippedSrc);
}

console.log('\n【A】Rule 38：PW 的判準只能有一份（中央閘 scripts/lib/pw.mjs）');
chk('A0 ⭐ 中央閘存在且非空', rd(GATE).length > 1000, '長度 ' + rd(GATE).length);
{
  const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const chain = parseChain(String((PKG.scripts && PKG.scripts.test) || ''));
  const offenders = [];
  let scanned = 0;
  for (const rel of chain.uniq) {
    // ⚠ 本檔自己要排除：A1b／A1b2／A1b3 的**正對照樣本**裡就寫著舊形狀的
    //   `require('playwright')`，被自己掃到會誤報（test-v6263 的 ② 也是同樣的理由排除自己）。
    if (!/^scripts\//.test(rel) || rel === GATE || rel === SELF) continue;
    const raw = rd(rel);
    if (!raw) continue;
    scanned++;
    let clean; try { clean = stripCommentsBlankChecked(raw, rel); } catch { clean = raw; }
    if (rawPwRequire(clean)) offenders.push(rel);
  }
  chk('A0b ⭐ 母體下限：掃到 chain 上 ≥ 400 支腳本（掃描器壞掉要在這裡爆）', scanned >= 400, '實際 ' + scanned);
  chk('A1 ⭐⭐⭐ chain 上沒有任何守衛自己 require playwright（一律走中央閘）',
    offenders.length === 0, offenders.join(', '));
}
chk('A1b ★ 正對照①：舊形狀 createRequire(...)(\'playwright\') 必須被抓到',
  rawPwRequire("try { chromium = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium; } catch {}"));
chk('A1b2 ★ 正對照②：require_.resolve(\'playwright\') 也要抓到',
  rawPwRequire("try { pw = require_.resolve(process.env.PLAYWRIGHT_MODULE || 'playwright'); } catch {}"));
chk('A1b3 ★ 正對照③：playwright-core 也算',
  rawPwRequire("const pw = require('playwright-core');"));
chk('A1c ★ 反對照：走中央閘的寫法不得被誤判',
  !rawPwRequire("import { pwChromium } from './lib/pw.mjs';\nconst chromium = pwChromium('x');"));

console.log('\n【B】三個過渡期把手必須一致（要收尾就三者一起改）');
const GATE_SRC = rd(GATE);
/**
 * ⚠⚠ 掃 deploy.yml **一定要先剝掉 `#` 註解**（安慰劑型態 6：lint 視窗含註解）。
 *   這支守衛第一版就中招：deploy.yml 的註解裡寫著
 *   「⭐ 修完之後要做的三件事：① 刪掉這兩行 env（`PTCG_PW: 'off'` …）」，
 *   於是把**真正那一行**註解掉之後，判準仍然從註解裡讀到它 ⇒ 突變 M4 存活。
 *   判準只有這一份（正式斷言與下面的正對照共用）。
 */
export function stripYamlComments(src) {
  return src.split('\n').filter((L) => !/^\s*#/.test(L)).join('\n');
}
const YML_SRC = stripYamlComments(rd(YML));
const modeOff = /PW_DEFAULT_MODE\s*=\s*'off'/.test(GATE_SRC);
const ymlPwOff = /PTCG_PW:\s*'off'/.test(YML_SRC);
const ymlAllowEnvSkip = /PTCG_ALLOW_ENV_SKIP:\s*'1'/.test(YML_SRC);
const ymlPwStep = /continue-on-error:\s*true[\s\S]{0,400}?run-pw-guards\.mjs/.test(YML_SRC)
  || /run-pw-guards\.mjs[\s\S]{0,400}?continue-on-error:\s*true/.test(YML_SRC);
console.log(`  現況：pw.mjs 預設=${PW_DEFAULT_MODE}／yml PTCG_PW:off=${ymlPwOff}`
  + `／yml ALLOW_ENV_SKIP=${ymlAllowEnvSkip}／yml 獨立 step=${ymlPwStep}`);
chk('B0 ⭐ 三者一致：要嘛都在過渡期，要嘛都已收尾',
  (modeOff === ymlPwOff) && (modeOff === ymlPwStep) && (modeOff === ymlAllowEnvSkip),
  `pw.mjs off=${modeOff} / yml off=${ymlPwOff} / allowEnvSkip=${ymlAllowEnvSkip} / step=${ymlPwStep}`);
chk('B0b ★★ 正對照：只有**註解**提到 PTCG_PW: \'off\' 時不得算數（第一版真的踩過）',
  !/PTCG_PW:\s*'off'/.test(stripYamlComments(
    "        env:\n          # 舊寫法是 PTCG_PW: 'off'，已經刪掉\n          FOO: '1'\n")));
chk('B0c ★ 反對照：真正的那一行要算數',
  /PTCG_PW:\s*'off'/.test(stripYamlComments("        env:\n          PTCG_PW: 'off'\n")));
chk('B1 ⭐ 過渡期的預設模式就是程式實際看到的模式（沒有第二份判準）',
  pwMode() === PW_DEFAULT_MODE || process.env.PTCG_PW,
  `pwMode()=${pwMode()} PW_DEFAULT_MODE=${PW_DEFAULT_MODE} PTCG_PW=${process.env.PTCG_PW || '(未設)'}`);

console.log('\n【C】CI 真的有裝瀏覽器，而且跑得到那 10 支');
chk('C0 ⭐ run-pw-guards.mjs 存在', existsSync(join(ROOT, RUNNER)));
chk('C1 ⭐⭐ deploy.yml 有裝 chromium-headless-shell',
  /playwright install[^\n]*chromium-headless-shell/.test(YML_SRC));
// ⚠ 第一版寫成「actions/cache@vN 之後 300 字內出現 ms-playwright」⇒ 把 `path:` 改壞
//   （指到別的目錄）之後，判準仍然從下一行的 `key: ms-playwright-…` 讀到那個字
//   ⇒ 突變 M7 存活。⭐ 要釘的是**快取的目錄**，就直接釘 `path:` 那一行。
chk('C2 ⭐ deploy.yml 有快取 ~/.cache/ms-playwright（不然每次 CI 都重抓 115MB）',
  /uses:\s*actions\/cache@v\d/.test(YML_SRC)
  && /^\s*path:\s*~\/\.cache\/ms-playwright\s*$/m.test(YML_SRC));
chk('C2a ★★ 正對照：path 指到別的目錄時必須抓得到（判準不可以從 key: 那行借字）',
  !/^\s*path:\s*~\/\.cache\/ms-playwright\s*$/m.test(
    '      - uses: actions/cache@v4\n        with:\n          path: ~/.cache/nothing-here\n'
    + "          key: ms-playwright-linux\n"));
chk('C2b ⭐ 快取鍵不得寫死瀏覽器 build 號（那是 pin 死版本號，升版後靜默失效）',
  !/key:[^\n]*chromium[_-]?headless[_-]?shell-\d+/.test(YML_SRC));
chk('C3 ⭐ playwright 在 devDependencies（不然 npm ci 不會裝，等於沒有）',
  !!(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies || {}).playwright);
{
  const list = listPwGuards(ROOT);
  chk(`C4 ⭐⭐⭐ 掃得到 ≥ ${MIN_PW_GUARDS} 支走中央閘的守衛（下限，防空真）`,
    list.length >= MIN_PW_GUARDS, `實際 ${list.length}：` + list.join(', '));
  chk('C4b ★ 正對照：掃描判準抓得到「會開瀏覽器」的樣本',
    usesPwGate("import { pwChromium } from './lib/pw.mjs';"));
  chk('C4c ★ 反對照①：沒走中央閘的樣本不得被算進去',
    !usesPwGate("import { envSkip } from './lib/env-skip.mjs';"));
  chk('C4d ★★ 反對照②：只拿 pwMode／PW_DEFAULT_MODE 的（＝本檔自己）不算 PW 守衛 ——'
    + ' 它不會開瀏覽器，算進來會讓下限斷言鬆一格',
    !usesPwGate("import { pwMode, PW_DEFAULT_MODE } from './lib/pw.mjs';"));
  // ⚠ 下限本身也要被守：把 MIN_PW_GUARDS 調成 0，C4 就永遠成立（安慰劑型態 4：空真）。
  chk('C4e ⭐⭐ 下限常數本身不得被放寬（MIN_PW_GUARDS ≥ 10，＝實裝時的支數）',
    MIN_PW_GUARDS >= 10, 'MIN_PW_GUARDS = ' + MIN_PW_GUARDS);
}

console.log('\n【D】pwMode() 的行為（表格測試）');
{
  const before = process.env.PTCG_PW;
  const T = [['off', 'off'], ['auto', 'auto'], ['strict', 'strict'], ['on', 'strict'],
    ['OFF', 'off'], ['  strict  ', 'strict'], ['nonsense', PW_DEFAULT_MODE], ['', PW_DEFAULT_MODE]];
  const bad = [];
  for (const [set, want] of T) {
    if (set === '') delete process.env.PTCG_PW; else process.env.PTCG_PW = set;
    const got = pwMode();
    if (got !== want) bad.push(`PTCG_PW=${JSON.stringify(set)} 期待 ${want}、實得 ${got}`);
  }
  if (before === undefined) delete process.env.PTCG_PW; else process.env.PTCG_PW = before;
  chk('D1 ⭐⭐ 模式解析逐項正確（含大小寫、空白、「on」的口語寫法、無效值退回預設）',
    bad.length === 0, bad.join(' ｜ '));
  chk('D1b ★ 表格真的涵蓋三種模式（不是只測一種就宣稱涵蓋）',
    new Set(T.map((r) => r[1])).size === 3, JSON.stringify([...new Set(T.map((r) => r[1]))]));
}

console.log('\n【E】本守衛自己必須在 npm test chain 裡');
{
  const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const C = parseChain(String((PKG.scripts && PKG.scripts.test) || ''));
  chk('E1 ⭐ scripts.test 裡**恰好**有本檔一次', C.scripts.filter((s) => s === SELF).length === 1);
  chk('E2 ⭐⭐ run-pw-guards.mjs **不可以**在 chain 上（它會真的開瀏覽器，chain 是阻擋路徑）',
    C.scripts.filter((s) => s === RUNNER).length === 0);
}

console.log(`\n=== PW 中央閘：PASS ${P} / FAIL ${F} ===`);
assert.strictEqual(F, 0, `有 ${F} 條失敗`);
