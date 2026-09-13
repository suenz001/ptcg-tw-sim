#!/usr/bin/env node
/**
 * ⭐ v6.377 C-9：行尾中性**靜態掃描器** —— 「多行字串錨點 × 磁碟讀進來的檔案內容」。
 *
 * 事故本體（六-7，v6.371 已查明、v6.377 全面收斂）：
 *   本專案工作樹是 CRLF（core.autocrlf=true），但守衛裡到處是「多行字串字面當錨點」：
 *       const A = '  {#if isPortraitMobile && game}\n';
 *       const i = PAGE.indexOf(A);           // ← CRLF 工作樹永遠 -1
 *   ⇒ 本機永久紅、CI（LF）永久綠。兩邊都很糟：本機紅燈淹沒真紅燈，LF 綠燈是**假綠**
 *     （突變層根本沒跑到，等於零保護力）。
 *
 * ⚠⚠ `scripts/test-lint-crlf-neutral.mjs` 的守備範圍**只有 anti-pattern-lint 一支**
 *   （把它搬到臨時工作區、LF/CRLF 各跑一次比 stdout）。它抓不到「別的守衛自己的錨點過期」。
 *   本檔補的就是那一塊：不蓋一層鏡像 chain（成本太高），改用靜態掃描。
 *
 * ── 判準（**寫死在這裡，不要用感覺**）─────────────────────────────────────────
 *   違規 = 以下兩個條件同時成立的呼叫點：
 *     (1) **haystack 是磁碟原始內容**：
 *         `readFileSync(...)` 直接呼叫，或一個「作用域解析後」綁到 `readFileSync(...)` 的識別字，
 *         且該綁定**沒有**被正規化（沒走 `normEol(...)`／`.replace(/\r\n/…)`）。
 *     (2) **needle 是多行錨點**：字串／模板字面（可經 `+` 串接、可經同檔常數轉一手），
 *         含至少一個 `\n`，且含至少一個非 `\r\n` 的字元。
 *         ⇒ 純分隔符 `'\n'`、`'\n\n'` **不算**（那是另一類問題，不在本檔守備範圍）。
 *   方法：indexOf / lastIndexOf / includes / split / replace / replaceAll / startsWith / endsWith。
 *
 * ── 本判準**不**涵蓋什麼（誠實揭露，不要假裝全包）───────────────────────────
 *   - 內容經過自訂 helper 轉一手（`epSrc(PATCH, …)`）之後才比對：追不到，不報。
 *   - 執行期才組出來的 needle（來自 JSON／參數）：追不到，不報。
 *   - `.split('\n')` 這種純分隔符寫法：不在守備範圍（見上）。
 *   ⇒ 所以本檔是**下限**保護，不是完備性證明。
 *
 * ── 修法（正解只有一條）───────────────────────────────────────────────────
 *   在**讀檔處**收斂：`const PAGE = normEol(readFileSync(p, 'utf8'));`
 *   `normEol` 來自 v6.371 中央 helper `scripts/lib/eol-agnostic.mjs`。
 *   ⚠ 它在 LF 下是**證明得了的 no-op**（`s.replace(/\r\n/g,'\n')`，沒有 \r\n 就原樣回傳）
 *     ⇒ 對 CI／LF 免疫測試網零風險，只會修好 CRLF 本機。
 *   ⚠ 需要「匹配結束位置」（`src.slice(i, j + needle.length)`）的場合改用 `eolFind`。
 *
 * ── 反安慰劑設計 ─────────────────────────────────────────────────────────
 *   ① 內建自驗：正對照（合成違規必須抓到）＋ 負對照（註解裡的、已 normEol 的不得誤報）。
 *      偵測器壞掉 ⇒ 本檔**在掃描之前**就 exit 1，不會退化成「掃到 0 個 ⇒ 全綠」。
 *   ② 下限斷言：掃到的檔案數 < MIN_SCANNED ⇒ 紅。
 *   ③ 債務基線（ALLOW）：每一條都要寫理由，而且**沒有蓋到任何東西 ⇒ 紅**（過期偵測）。
 *      ⚠ ALLOW 是「已知債務／不適用」，不是「這樣寫沒問題」。它只准變短，不准變長。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 下限：掃到的檔案數少於這個值 ⇒ 掃描器壞了（最典型症狀：一個都沒掃到 ⇒ 全綠）。 */
export const MIN_SCANNED = 800;

/**
 * 債務基線／不適用清單。每一條：{ file, hay, method, reason }。
 * ⚠ 沒有蓋到任何違規的條目 ⇒ 紅（過期偵測）。⚠ 只准變短。
 */
export const ALLOW = [];

const METHODS = new Set(['indexOf', 'lastIndexOf', 'includes', 'split', 'replace', 'replaceAll', 'startsWith', 'endsWith']);
const SCOPE_TYPES = new Set([
  'Program', 'BlockStatement', 'FunctionDeclaration', 'FunctionExpression',
  'ArrowFunctionExpression', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement',
]);

/** needle 是不是「多行錨點」（見檔頭判準 (2)）。 */
export function isMultilineAnchor(s) {
  return typeof s === 'string' && s.includes('\n') && /[^\r\n]/.test(s);
}

function litValue(node, consts) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') {
    // 有內插時用 \u0001 佔位：不影響「含不含 \n」的判斷。
    return node.quasis.map((q) => q.value.cooked ?? '').join('\u0001');
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const a = litValue(node.left, consts), b = litValue(node.right, consts);
    if (a === null && b === null) return null;
    return (a ?? '') + (b ?? '');
  }
  if (node.type === 'Identifier' && consts.has(node.name)) return consts.get(node.name);
  return null;
}

const textOf = (src, n) => src.slice(n.start, n.end);
const hasReader = (src, n) => /\breadFileSync\s*\(/.test(textOf(src, n));
const isNormalized = (src, n) => {
  const t = textOf(src, n);
  return /\bnormEol\s*\(/.test(t) || /\.replace\(\s*\/\\r/.test(t) || /\.replace\(\s*\/\[\\r/.test(t);
};
function nearestScope(ancestors) {
  for (let i = ancestors.length - 2; i >= 0; i--) if (SCOPE_TYPES.has(ancestors[i].type)) return ancestors[i];
  return ancestors[0];
}

/**
 * 掃一份原始碼，回傳違規清單。`rel` 只用來標示來源。
 * ⭐ 匯出給守衛做正／負對照用 —— 守衛驗的是**這一支真的偵測邏輯**，不是另寫一份。
 */
export function scanSource(rel, src) {
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    return { parseError: String(e && e.message), rows: [] };
  }
  const consts = new Map();          // 同檔字串常數（給 needle 轉一手用）
  const bindings = [];               // { name, scope, raw:boolean }
  walk.ancestor(ast, {
    VariableDeclarator(n, _st, anc) {
      if (!n.id || n.id.type !== 'Identifier') return;
      const v = litValue(n.init, consts);
      if (v !== null) consts.set(n.id.name, v);
      const raw = !!(n.init && hasReader(src, n.init) && !isNormalized(src, n.init));
      bindings.push({ name: n.id.name, scope: nearestScope(anc), raw });
    },
  });
  const resolve = (name, anc) => {
    let best = null, bestDepth = -1;
    for (const b of bindings) {
      if (b.name !== name) continue;
      const d = anc.indexOf(b.scope);
      if (d > bestDepth) { bestDepth = d; best = b; }
    }
    return bestDepth >= 0 ? best : null;
  };
  // 指派式的讀檔（`let GAME = ''; … GAME = readFileSync(…)`）⇒ 把該綁定升級成 raw。
  walk.ancestor(ast, {
    AssignmentExpression(n, _st, anc) {
      if (!n.left || n.left.type !== 'Identifier' || !n.right) return;
      if (!hasReader(src, n.right) || isNormalized(src, n.right)) return;
      const b = resolve(n.left.name, anc);
      if (b) b.raw = true;
    },
  });
  const rows = [];
  walk.ancestor(ast, {
    CallExpression(n, _st, anc) {
      const c = n.callee;
      if (!c || c.type !== 'MemberExpression' || c.computed) return;
      if (!c.property || c.property.type !== 'Identifier' || !METHODS.has(c.property.name)) return;
      const needle = litValue(n.arguments[0], consts);
      if (!isMultilineAnchor(needle)) return;
      const obj = c.object;
      let hay = null;
      if (obj.type === 'Identifier') {
        const b = resolve(obj.name, anc);
        if (b && b.raw) hay = obj.name;
      } else if (obj.type === 'CallExpression' && obj.callee && obj.callee.type === 'Identifier'
        && obj.callee.name === 'readFileSync') {
        hay = 'readFileSync()';
      }
      if (!hay) return;
      rows.push({
        file: rel, line: n.loc.start.line, method: c.property.name, hay,
        needle: needle.slice(0, 60),
      });
    },
  });
  return { parseError: null, rows };
}

// ── ① 內建自驗：偵測器壞掉就當場紅，不准退化成「掃到 0 個 ⇒ 全綠」──────────────
const POS_SAMPLE = [
  "import { readFileSync } from 'node:fs';",
  "const PAGE = readFileSync('x.svelte', 'utf8');",
  "const A = '  {#if a}\\n    <b/>\\n';",
  'const i = PAGE.indexOf(A);',
  "const j = PAGE.lastIndexOf('\\n{:else}\\n');",
  'export { i, j };',
].join('\n');
const NEG_SAMPLE = [
  "import { readFileSync } from 'node:fs';",
  "import { normEol } from './lib/eol-agnostic.mjs';",
  "const PAGE = normEol(readFileSync('x.svelte', 'utf8'));",
  "const A = '  {#if a}\\n    <b/>\\n';",
  'const i = PAGE.indexOf(A);',
  "// const j = PAGE.indexOf('  {#if b}\\n');",
  "const RAW = readFileSync('y.txt', 'utf8');",
  "const k = RAW.split('\\n');",
  "const m = RAW.indexOf('\\n');",
  'export { i, k, m };',
].join('\n');

export function selfTest() {
  const errs = [];
  const pos = scanSource('<pos>', POS_SAMPLE);
  if (pos.parseError) errs.push('正對照樣本解析失敗：' + pos.parseError);
  if (pos.rows.length !== 2) {
    errs.push('正對照：應抓到 2 處（識別字錨點 1 + 內嵌錨點 1），實得 ' + pos.rows.length
      + ' ⇒ ' + JSON.stringify(pos.rows));
  }
  const neg = scanSource('<neg>', NEG_SAMPLE);
  if (neg.parseError) errs.push('負對照樣本解析失敗：' + neg.parseError);
  if (neg.rows.length !== 0) {
    errs.push('負對照誤報（normEol 已收斂／註解裡的／純分隔符 \\n 都不該報）：' + JSON.stringify(neg.rows));
  }
  return errs;
}

export function listTrackedScripts() {
  const r = spawnSync('git', ['ls-files', '-z', 'scripts'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error('git ls-files scripts 失敗（exit=' + r.status + '）：' + String(r.stderr || '').slice(0, 300));
  }
  return r.stdout.split('\0').filter((f) => f.endsWith('.mjs'));
}

export function scanRepo() {
  const files = listTrackedScripts();
  const rows = []; const parseErrors = [];
  let scanned = 0;
  for (const rel of files) {
    let src;
    try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
    scanned++;
    const r = scanSource(rel, src);
    if (r.parseError) { parseErrors.push(rel + '：' + r.parseError); continue; }
    rows.push(...r.rows);
  }
  return { scanned, rows, parseErrors };
}

/** ALLOW 比對：回 { allowed, unmatched, hits }。 */
export function applyAllow(rows) {
  const hits = ALLOW.map(() => 0);
  const allowed = [];
  const rest = [];
  for (const row of rows) {
    const i = ALLOW.findIndex((a) => a.file === row.file && a.hay === row.hay && a.method === row.method);
    if (i >= 0) { hits[i]++; allowed.push(row); } else rest.push(row);
  }
  const unmatched = ALLOW.filter((_, i) => hits[i] === 0);
  return { violations: rest, allowed, unmatched, hits };
}

function main() {
  console.log('行尾中性錨點掃描（v6.377 C-9）');
  const se = selfTest();
  if (se.length) {
    console.log('\n❌ 內建自驗失敗 —— 偵測邏輯壞了，掃描結果不可信：');
    for (const e of se) console.log('   ' + e);
    process.exit(1);
  }
  console.log('  自驗通過（正對照抓得到、負對照不誤報）');

  const { scanned, rows, parseErrors } = scanRepo();
  console.log('  掃描 scripts/ 下有追蹤的 .mjs：' + scanned + ' 支');
  if (parseErrors.length) {
    console.log('\n❌ 有檔案解析失敗（掃描結果不完整）：');
    for (const e of parseErrors.slice(0, 10)) console.log('   ' + e);
    process.exit(1);
  }
  if (scanned < MIN_SCANNED) {
    console.log('\n❌ 下限斷言失敗：掃到 ' + scanned + ' 支 < MIN_SCANNED=' + MIN_SCANNED
      + '（掃描器壞掉最典型的症狀就是「掃到 0 個 ⇒ 全綠」）');
    process.exit(1);
  }
  const { violations, allowed, unmatched } = applyAllow(rows);
  console.log('  命中 ALLOW（已知債務／不適用）：' + allowed.length + ' 處 / ALLOW 共 ' + ALLOW.length + ' 條');

  let bad = false;
  if (unmatched.length) {
    bad = true;
    console.log('\n❌ ALLOW 有 ' + unmatched.length + ' 條過期（沒有蓋到任何違規）—— 請把它刪掉：');
    for (const a of unmatched) console.log('   ' + a.file + ' :: ' + a.hay + '.' + a.method + '()  理由：' + a.reason);
  }
  if (violations.length) {
    bad = true;
    console.log('\n❌ 發現 ' + violations.length + ' 處「多行錨點 × 磁碟原始內容」：');
    for (const v of violations) {
      console.log('   ' + v.file + ':' + v.line + '  ' + v.hay + '.' + v.method + '(' + JSON.stringify(v.needle) + ')');
    }
    console.log('\n   修法：在讀檔處收斂 —— const X = normEol(readFileSync(p, \'utf8\'));');
    console.log('         （import { normEol } from \'./lib/eol-agnostic.mjs\'；需要結束位置請用 eolFind）');
  }
  if (bad) process.exit(1);
  console.log('\n✅ 0 處違規、ALLOW 無過期條目');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();