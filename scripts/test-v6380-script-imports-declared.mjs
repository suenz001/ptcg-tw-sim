#!/usr/bin/env node
/**
 * v6.380 守衛 —— scripts/ 直接 import 的每一個 npm 套件都必須在 package.json 宣告
 *
 * ⚠⚠ 這一版是 hotfix：v6.377 引進的 `scripts/lint-eol-anchors.mjs` import 了 `acorn-walk`，
 *    但 `acorn-walk` 從來不是我們宣告的相依（只是別人的 transitive）。
 *    本機與兩張免疫網都把 `node_modules` junction 到 `E:\ptcg-tw-sim\node_modules`（完整樹）
 *    ⇒ 兩張網**測不出來**；CI 卻在 `Run engine regression tests` 炸成
 *    `ERR_MODULE_NOT_FOUND: Cannot find package 'acorn-walk'`，deploy 被 skip，
 *    測試站停在 v6.376。
 *
 * ⭐ 真因（不是「npm ci 沒裝」）：
 *    `.github/workflows/deploy.yml` 在 `npm ci` 之後還有一步
 *    `npm install @rollup/rollup-linux-x64-gnu @esbuild/linux-x64 --no-save --no-package-lock`。
 *    `--no-package-lock` 會**忽略 lock、依 package.json 重算整棵樹並修剪**
 *    ⇒ 沒有任何宣告者需要的 transitive（acorn-walk）就被移除。
 *    ⇒ **凡是我們自己直接 import 的套件，都必須自己宣告**，否則隨時會被那一步修掉。
 *
 * 判準（行為層代理，但釘的是真正的失效機制）：
 *   【B1】scripts/ 下每個 bare import 的套件 ∈ package.json 的 dependencies ∪ devDependencies
 *   【B2】每個這樣的套件在 package-lock.json 有**頂層**節點 node_modules/<pkg>（npm ci 會裝到可解析位置）
 *   【B3】package.json 的 devDependencies 與 lock 的 packages[""].devDependencies 完全一致（npm ci 的前提）
 *
 * ⚠ 禁止恆真斷言：A2／A3／A4 是掃描器自我驗證（正／負對照），D 是對 BASE 的 HEAD-FAIL。
 */
import assert from 'node:assert';
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { filterNotIgnored } from './lib/tracked-scope.mjs';   // 母體判準的單一真相（Rule 38）
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = process.env.V6380_BASE || 'd359f157';   // v6.379

/** 掃描下限：低於這個數字代表掃描器自己壞了（例如 readdir 走錯目錄）⇒ 直接紅，不准靜默全綠 */
const MIN_SCANNED = 800;

/**
 * 不是 npm 套件、因此不必宣告的 bare specifier。
 * ⭐ 現在是**零白名單**：AST 掃描只認真正的 import／export-from／import()／require()，
 *   所以像 '$lib'（只出現在 esbuild 的 alias 選項字串裡）根本不會被掃進來，不需要白名單。
 * ⚠ 只准變短：任何新增的條目都必須「真的還有東西蓋到」，否則 A5 過期偵測會紅。
 */
const ALLOW_BARE = [];

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => {
  if (c) { pass++; console.log('  PASS ' + t); return true; }
  fail++; console.log('  FAIL ' + t + (extra ? '\n        ' + String(extra).slice(0, 600) : ''));
  return false;
};

const builtin = new Set(builtinModules);
const isBuiltin = (s) => s.startsWith('node:') || builtin.has(s.split('/')[0]);
const pkgNameOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

// ── 掃描器本體：acorn 解析 AST（註解與字串常值天生不會被誤判） ──────────────
function collectImports(src, label) {
  const specs = [];
  let ast = null;
  for (const sourceType of ['module', 'script']) {
    try {
      ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowAwaitOutsideFunction: true });
      break;
    } catch { /* 換下一種 */ }
  }
  if (!ast) return { specs, parsed: false };
  walk.simple(ast, {
    ImportDeclaration(n) { if (n.source && typeof n.source.value === 'string') specs.push(n.source.value); },
    ExportNamedDeclaration(n) { if (n.source && typeof n.source.value === 'string') specs.push(n.source.value); },
    ExportAllDeclaration(n) { if (n.source && typeof n.source.value === 'string') specs.push(n.source.value); },
    ImportExpression(n) { if (n.source && n.source.type === 'Literal' && typeof n.source.value === 'string') specs.push(n.source.value); },
    CallExpression(n) {
      if (n.callee && n.callee.type === 'Identifier' && n.callee.name === 'require'
        && n.arguments.length === 1 && n.arguments[0].type === 'Literal'
        && typeof n.arguments[0].value === 'string') specs.push(n.arguments[0].value);
    },
  });
  void label;
  return { specs, parsed: true };
}

// ⭐ 母體 = 「git 沒有忽略的檔」，判準集中在 scripts/lib/tracked-scope.mjs（Rule 38）。
//   為什麼不用檔名樣式（例如 /^(tmp|_|\.)/）濾：那會連站長手寫的 `_repro_*.mjs` 一起漏掉，
//   而那些檔一旦被 `git add -A` 就會進版控，正是最需要被掃的。
//   為什麼要濾：守衛的 esbuild 暫存殘檔（已在 .gitignore 列管）會污染母體 ——
//   實測 scripts/.v6380-positive-control.mjs 這個上一輪中斷留下的檔，
//   曾讓本守衛的 B1/B2/D2 三條翻紅（純粹由殘檔造成的假紅）。
function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (/\.(mjs|js|cjs)$/.test(e.name)) out.push(p);
    }
  }
  return filterNotIgnored(ROOT, out.sort());
}

/**
 * 掃出 scripts/ 下所有「bare import 的套件名 → 用到它的檔案」。
 * @param {string[]} files 絕對路徑
 */
function scanBarePackages(files) {
  const used = new Map();
  const parseFailed = [];
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join('/');
    const src = normEol(readFileSync(f, 'utf8'));
    const { specs, parsed } = collectImports(src, rel);
    if (!parsed) { parseFailed.push(rel); continue; }
    for (const spec of specs) {
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('file:') || spec.startsWith('http')) continue;
      if (isBuiltin(spec)) continue;
      const name = pkgNameOf(spec);
      if (!used.has(name)) used.set(name, []);
      used.get(name).push(rel);
    }
  }
  return { used, parseFailed };
}

const PKG = JSON.parse(normEol(readFileSync(join(ROOT, 'package.json'), 'utf8')));
const LOCK = JSON.parse(normEol(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')));
const declaredOf = (pkgJson) => new Set([
  ...Object.keys(pkgJson.dependencies || {}),
  ...Object.keys(pkgJson.devDependencies || {}),
]);
const DECLARED = declaredOf(PKG);
const ALLOW_SET = new Set(ALLOW_BARE.map((a) => a.spec));

const FILES = listFiles(join(ROOT, 'scripts'));
const { used: USED, parseFailed: PARSE_FAILED } = scanBarePackages(FILES);

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】掃描器自我驗證（不准靜默全綠）');
// ════════════════════════════════════════════════════════════════════════════
chk('★★ A1 掃描到的檔案數 >= ' + MIN_SCANNED, FILES.length >= MIN_SCANNED, 'files=' + FILES.length);
chk('★★ A1b 掃出來的 bare 套件種類 >= 4（掃描器真的有在解析 import）', USED.size >= 4,
  '種類=' + USED.size + ' → ' + [...USED.keys()].join(', '));
chk('★★ A1c 每一支 scripts/ 檔案都解析得動（acorn 不該有解析不了的）', PARSE_FAILED.length === 0,
  '解析失敗：' + PARSE_FAILED.slice(0, 10).join(', '));

// ⭐ 母體本身的正／反對照 ＋ 下限斷言
//   （下面的 A2／A3 驗的是**掃描器的解析能力**——它們直呼 scanBarePackages、不經過母體。
//     母體換判準之後，母體自己也需要一組對照，否則「濾掉太多」會是靜默的假綠。）
{
  chk('★★ A1d ⭐ 母體下限：scripts/ 掃到的 .mjs/.js/.cjs >= 700（濾過頭會在這裡爆）',
    FILES.length >= 700, '母體=' + FILES.length);

  const probeAbs = join(ROOT, 'scripts', '_v6380-scope-probe.mjs');   // 底線開頭：**不被** .gitignore 忽略
  const ignAbs = join(ROOT, 'scripts', '.v6380-scope-ignored.mjs');   // 點開頭：**會被** .gitignore 忽略
  try {
    writeFileSync(probeAbs, 'export const x = 1;\n');
    writeFileSync(ignAbs, 'export const y = 2;\n');
    const again = listFiles(join(ROOT, 'scripts'));
    chk('★★★ A1e 母體正對照：未被 gitignore 忽略的新檔**必須**進母體（濾太多會被這條抓到）',
      again.includes(probeAbs), '母體裡找不到 _v6380-scope-probe.mjs');
    chk('★★★ A1f 母體反對照：被 gitignore 忽略的殘檔**不得**進母體（濾太少會被這條抓到）',
      !again.includes(ignAbs), '母體裡混進了 .v6380-scope-ignored.mjs');
  } finally {
    try { unlinkSync(probeAbs); } catch { /* noop */ }
    try { unlinkSync(ignAbs); } catch { /* noop */ }
  }
}

// 正對照：塞一支真的含未宣告 import 的暫存檔進 scripts/ ⇒ 掃描器必須抓到
{
  const tmpRel = 'scripts/.v6380-positive-control.mjs';
  const tmpAbs = join(ROOT, tmpRel);
  const FAKE = 'definitely-not-a-real-package-v6380';
  writeFileSync(tmpAbs, "import x from '" + FAKE + "';\nexport default x;\n");
  try {
    const r = scanBarePackages([tmpAbs]);
    chk('★★★ A2 正對照：掃描器抓得到未宣告的 bare import', r.used.has(FAKE) && !DECLARED.has(FAKE),
      '抓到的：' + [...r.used.keys()].join(', '));
  } finally { try { unlinkSync(tmpAbs); } catch { /* noop */ } }
}

// 負對照 1：只出現在**註解**裡的 import 不可以被誤判
{
  const tmpRel = 'scripts/.v6380-negative-control.mjs';
  const tmpAbs = join(ROOT, tmpRel);
  writeFileSync(tmpAbs,
    "// 這一行只是註解：import('firebase-admin').then(() => {})\n"
    + "/* 區塊註解：require('some-ghost-package') */\n"
    + "const s = \"import 'string-literal-package'\";\n"
    + "import { readFileSync } from 'node:fs';\nexport default [s, readFileSync];\n");
  try {
    const r = scanBarePackages([tmpAbs]);
    chk('★★★ A3 負對照：註解／字串常值裡的 import 不會被誤判', r.used.size === 0,
      '誤判成：' + [...r.used.keys()].join(', '));
  } finally { try { unlinkSync(tmpAbs); } catch { /* noop */ } }
}

// 負對照 2：真實檔案 —— test-admin-helper-scope.mjs 的 firebase-admin 只在註解裡
{
  const rel = 'scripts/test-admin-helper-scope.mjs';
  const abs = join(ROOT, rel);
  let exists = true;
  try { statSync(abs); } catch { exists = false; }
  if (!exists) {
    chk('★ A4 負對照（真實檔案）：' + rel + ' 不存在 ⇒ 這條失去意義，請改綁別的檔案', false, '檔案不存在');
  } else {
    const raw = normEol(readFileSync(abs, 'utf8'));
    const r = scanBarePackages([abs]);
    chk('★★ A4 負對照（真實檔案）：' + rel + ' 的原始碼確實出現 firebase-admin 字樣，但不是真的 import',
      raw.includes('firebase-admin') && !r.used.has('firebase-admin'),
      '字樣=' + raw.includes('firebase-admin') + ' 判成 import=' + r.used.has('firebase-admin'));
  }
}

// ALLOW 過期偵測（只准變短）
{
  const stale = ALLOW_BARE.filter((a) => !USED.has(a.spec));
  console.log('        ALLOW_BARE 目前有 ' + ALLOW_BARE.length + ' 條（零白名單是最嚴格狀態）');
  chk('★★ A5 ALLOW_BARE 沒有過期條目（每一條都還真的有東西蓋到；只准變短）', stale.length === 0,
    '過期：' + stale.map((a) => a.spec).join(', '));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】主判準：直接 import 的套件必須自己宣告，且 npm ci 裝得到');
// ════════════════════════════════════════════════════════════════════════════
const NEEDS_DECL = [...USED.keys()].filter((n) => !ALLOW_SET.has(n)).sort();
{
  const missing = NEEDS_DECL.filter((n) => !DECLARED.has(n));
  chk('★★★ B1 scripts/ 直接 import 的每個套件都在 package.json 宣告',
    missing.length === 0,
    '未宣告：' + missing.map((n) => n + '（' + [...new Set(USED.get(n))].slice(0, 3).join(', ') + '…）').join(' | '));
  console.log('        直接 import 的套件：' + NEEDS_DECL.join(', '));
}
{
  const lockPkgs = LOCK.packages || {};
  const noTopNode = NEEDS_DECL.filter((n) => !Object.prototype.hasOwnProperty.call(lockPkgs, 'node_modules/' + n));
  chk('★★★ B2 每個套件在 package-lock.json 都有頂層節點 node_modules/<pkg>',
    noTopNode.length === 0, '缺頂層節點：' + noTopNode.join(', '));
}
{
  const rootEntry = (LOCK.packages || {})[''] || {};
  const lockDev = JSON.stringify(rootEntry.devDependencies || {});
  const pkgDev = JSON.stringify(PKG.devDependencies || {});
  const lockDep = JSON.stringify(rootEntry.dependencies || {});
  const pkgDep = JSON.stringify(PKG.dependencies || {});
  chk('★★★ B3 package.json 與 lock 的 root 相依表完全一致（npm ci 的前提，不一致會直接失敗）',
    lockDev === pkgDev && lockDep === pkgDep,
    'devDeps 一致=' + (lockDev === pkgDev) + ' deps 一致=' + (lockDep === pkgDep));
}
{
  // 本版真正修掉的三個：它們是我們**直接 import**、卻一直靠別人 transitive 才活著的
  const THREE = ['acorn', 'acorn-walk', 'esbuild'];
  const stillUsed = THREE.filter((n) => USED.has(n));
  chk('★★ B4 acorn／acorn-walk／esbuild 仍然是 scripts/ 直接 import 的（若某天不再用，請一併從 devDeps 移除）',
    stillUsed.length === THREE.length, '仍在用的：' + stillUsed.join(', '));
  chk('★★★ B5 這三個都已是 package.json 的直接相依（不再只是別人的 transitive）',
    THREE.every((n) => DECLARED.has(n)), '缺：' + THREE.filter((n) => !DECLARED.has(n)).join(', '));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】CI 現場口徑：為什麼「宣告」是必要的（真因釘住）');
// ════════════════════════════════════════════════════════════════════════════
{
  const wf = normEol(readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8'));
  chk('★★ C1 deploy.yml 用 npm ci 安裝相依', /\bnpm ci\b/.test(wf));
  chk('★★★ C2 deploy.yml 在 npm ci 之後還有一步帶 --no-package-lock（＝會依 package.json 重算並修剪整棵樹）'
    + '\n        ⚠ 這一步若被移除，本條會紅 —— 屆時請回來檢視 B1 的理由是否改變（B1 本身仍應保留）',
    /--no-package-lock/.test(wf));
  chk('★★ C3 那一步確實在 npm ci 之後（順序決定了修剪會不會吃掉 npm ci 裝好的東西）',
    wf.indexOf('npm ci') >= 0 && wf.indexOf('--no-package-lock') > wf.indexOf('npm ci'),
    'ci@' + wf.indexOf('npm ci') + ' prune@' + wf.indexOf('--no-package-lock'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【D】HEAD-FAIL：BASE(' + BASE_SHA + ') 的宣告表撐不起現行的 import');
// ════════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【D】對 BASE(' + BASE_SHA + ') 的 HEAD-FAIL', '【A】【B】【C】不需要歷史，仍在守');
} else {
  const basePkgRaw = readBaseBlob(ROOT, BASE_SHA, 'package.json');
  const basePkg = JSON.parse(normEol(typeof basePkgRaw === 'string' ? basePkgRaw : basePkgRaw.out));
  const baseDeclared = declaredOf(basePkg);
  const missingOnBase = NEEDS_DECL.filter((n) => !baseDeclared.has(n)).sort();
  chk('★★★ D1 用 BASE 的 package.json 當宣告表，現行 scripts 會掃出「未宣告」⇒ 本守衛在 BASE 上必紅',
    missingOnBase.length > 0, 'BASE 上未宣告的：' + missingOnBase.join(', '));
  chk('★★★ D2 而且那一組恰好是 acorn／acorn-walk／esbuild（本版新增的三個宣告）',
    JSON.stringify(missingOnBase) === JSON.stringify(['acorn', 'acorn-walk', 'esbuild']),
    '實際：' + JSON.stringify(missingOnBase));
  const baseLockRaw = readBaseBlob(ROOT, BASE_SHA, 'package-lock.json');
  const baseLock = JSON.parse(normEol(typeof baseLockRaw === 'string' ? baseLockRaw : baseLockRaw.out));
  const baseRootDev = ((baseLock.packages || {})[''] || {}).devDependencies || {};
  chk('★★ D3 BASE 的 lock root devDependencies 也沒有這三個（證明 D1 不是 package.json 單邊改動）',
    ['acorn', 'acorn-walk', 'esbuild'].every((n) => !Object.prototype.hasOwnProperty.call(baseRootDev, n)),
    '有的：' + ['acorn', 'acorn-walk', 'esbuild'].filter((n) => Object.prototype.hasOwnProperty.call(baseRootDev, n)).join(', '));
  chk('★★ D4 BASE 的 lock 本來就有 node_modules/acorn-walk 頂層節點 —— 所以真因不是「npm ci 沒裝」，而是後面那一步修剪掉了',
    Object.prototype.hasOwnProperty.call(baseLock.packages || {}, 'node_modules/acorn-walk'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】npm test chain 一致性');
// ════════════════════════════════════════════════════════════════════════════
{
  const self = 'scripts/test-v6380-script-imports-declared.mjs';
  const chain = String(PKG.scripts?.test || '');
  chk('★★ E1 本守衛已掛進 npm test chain', chain.includes(self), 'chain 長度=' + chain.length);
  chk('★★ E2 lint-eol-anchors 也在 chain 裡（它就是踩到這個雷的那一支）',
    chain.includes('scripts/lint-eol-anchors.mjs'));
}

console.log('\n=== v6.380 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
assert.strictEqual(fail, 0, '有 ' + fail + ' 條失敗');
