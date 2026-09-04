// scripts/test-v6307-game-auth-unsub.mjs
// ⭐⭐ v6.307：/game 的 Firebase `onAuthStateChanged` 監聽器必須在元件銷毀時解除。
//
// 背景：SvelteKit 是 SPA，玩家每進出一次 /game 就 mount 一次。v6.306 以前
//   `onAuthStateChanged(auth, async u => {...})` 的回傳值（unsubscribe）沒存、onDestroy 也沒解除
//   ⇒ 監聽器一路疊加；auth 一變（登入／登出／匿名升級 Google），**每一個**殘留 callback 都各跑一次
//   「整批雲端牌組拉取」（loadDecksFromCloud：每副牌 1 次 Firestore 讀取）＋ signInAnonymously。
//   同型缺口 v6.197 已在 `_unsubOracleUid` 修過一次，這一版補 auth 這一支。
//
// ⭐ 這支守衛**不是**字串 grep。它分三層：
//   【A】AST 層（esbuild 去型別 → acorn 真的解析）：找到唯一那個 `onAuthStateChanged(...)` 呼叫，
//       證明它在 onMount 內、回傳值被賦給某個識別字 X、X 在頂層宣告、而且某個 onDestroy 回呼裡有呼叫 X。
//   【B】行為層：把「註冊敘述」與「onDestroy 回呼本體」的**真實原始碼**抽出來，用假的 onAuthStateChanged
//       （spy：回傳會把自己從存活集合移除的 unsub）在 `with(proxy)` 沙盒裡真的執行：
//       mount N 個實例 ⇒ 存活 N；銷毀 1 個 ⇒ N−1；全部銷毀 ⇒ 0；重複銷毀不會多退。
//       ⚠ 這一層才擋得住「呼叫寫在 if (false) 裡」「先清空再呼叫」這種 AST 看起來有、實際不會跑的寫法。
//   【C】突變自測：7 個突變體，各必須紅在預期那一條（只捕捉 AssertionError）。
//       其中 M1（拿掉賦值）就是 v6.306 的原狀 ⇒ 等價於 HEAD-FAIL，而且不需要歷史 commit。
//
// 用法：node scripts/test-v6307-game-auth-unsub.mjs
//   環境變數 V6307_SRC=<path>：改對別的檔跑（例如對 BASE blob 做 HEAD-FAIL 證明）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';

const _require = createRequire(import.meta.url);
const acorn = _require('acorn');
const walk = _require('acorn-walk');
const esbuild = await import('esbuild');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_GAME = process.env.V6307_SRC || (ROOT + 'src/routes/game/+page.svelte');
const rd = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + String(e.message).slice(0, 900)); fail++; }
    else throw e;   // ⚠ 只吞斷言失敗；打錯字／模組壞掉必須直接炸
  }
};
const mutate = (src, a, b) => {
  const n = src.split(a).length - 1;
  assert.strictEqual(n, 1, '突變錨點不唯一或不存在（' + n + '）：' + a.slice(0, 90));
  return src.replace(a, b);
};

// ─────────────────────────────────────────────────────────────────────────────
// 解析：<script lang="ts"> → esbuild 去型別 → acorn AST
// ─────────────────────────────────────────────────────────────────────────────
function scriptOf(svelteSrc) {
  const m = svelteSrc.match(/<script\b[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, '找不到 <script> 區塊');
  return m[1];
}
function parseJs(ts) {
  const js = esbuild.transformSync(ts, { loader: 'ts', target: 'es2022', format: 'esm' }).code;
  const ast = acorn.parse(js, { ecmaVersion: 2022, sourceType: 'module' });
  return { js, ast };
}
const calleeName = (node) => (node.type === 'CallExpression' && node.callee.type === 'Identifier') ? node.callee.name : null;
/** 呼叫的目標識別字：`X()`、`X?.()`（ChainExpression 包 CallExpression）都算 */
const callTarget = (node) => {
  const c = node.type === 'ChainExpression' ? node.expression : node;
  return calleeName(c);
};
/** 節點是否為某個 `fnName(cb)` 的回呼函式（第一個引數） */
function callbackOf(fnName, ast) {
  const out = [];
  walk.full(ast, (n) => {
    if (calleeName(n) === fnName && n.arguments[0] && /Function/.test(n.arguments[0].type)) out.push(n.arguments[0]);
  });
  return out;
}
/** 收集 fn 本體內（不進更深的巢狀函式也算，因為 onDestroy 回呼裡可能包 try）所有被呼叫的識別字 */
function callsIn(fnNode) {
  const names = [];
  walk.full(fnNode.body, (n) => { const t = callTarget(n); if (t) names.push(t); });
  return names;
}

/** 【A】AST 分析：回傳 { X, regStmtSrc, destroyBodySrc } */
function analyze(svelteSrc) {
  const { js, ast } = parseJs(scriptOf(svelteSrc));

  // A1：整個 script 內 `onAuthStateChanged(...)` 的呼叫必須剛好 1 個（import 不是呼叫）
  const calls = [];
  walk.fullAncestor(ast, (n, _st, ancestors) => {
    if (calleeName(n) === 'onAuthStateChanged') calls.push({ node: n, ancestors: ancestors.slice() });
  });
  assert.strictEqual(calls.length, 1, 'onAuthStateChanged(...) 的呼叫只能有 1 個（找到 ' + calls.length + ' 個）');
  const { node: call, ancestors } = calls[0];

  // A2：必須在 onMount 回呼裡（元件生命週期內註冊，才能在 onDestroy 對稱解除）
  const inOnMount = ancestors.some((a) => calleeName(a) === 'onMount');
  assert.ok(inOnMount, 'onAuthStateChanged 必須在 onMount 內註冊');

  // A3：回傳值必須被賦值（AssignmentExpression 的右邊、或 VariableDeclarator 的 init）
  const parent = ancestors[ancestors.length - 2];
  let X = null;
  if (parent && parent.type === 'AssignmentExpression' && parent.right === call && parent.left.type === 'Identifier') X = parent.left.name;
  else if (parent && parent.type === 'VariableDeclarator' && parent.init === call && parent.id.type === 'Identifier') X = parent.id.name;
  assert.ok(X, 'onAuthStateChanged 的回傳值（unsubscribe 函式）沒有被賦值 ⇒ 元件銷毀後監聽器永遠解不掉');

  // A5：某個 onDestroy 回呼（或 onMount 的 return 函式）裡必須呼叫 X
  const cleanups = callbackOf('onDestroy', ast);
  // onMount 的 return () => {...} 也是合法 cleanup 位置（decks 頁的寫法）
  for (const cb of callbackOf('onMount', ast)) {
    walk.simple(cb.body, { ReturnStatement(r) { if (r.argument && /Function/.test(r.argument.type)) cleanups.push(r.argument); } });
  }
  const destroyFn = cleanups.find((cb) => callsIn(cb).includes(X));
  assert.ok(destroyFn, 'onDestroy 沒有呼叫 ' + X + '（監聽器在元件銷毀時沒被解除）');

  // A4：X 必須在 script 頂層宣告（AssignmentExpression 形態時）；VariableDeclarator 形態則在 onMount 內即可
  if (parent.type === 'AssignmentExpression') {
    const topNames = new Set();
    for (const s of ast.body) if (s.type === 'VariableDeclaration') for (const d of s.declarations) if (d.id.type === 'Identifier') topNames.add(d.id.name);
    assert.ok(topNames.has(X), X + ' 沒有在 script 頂層宣告（onMount 與 onDestroy 看不到同一個變數）');
  }

  // 抽「註冊敘述」原始碼（最近的 Statement 祖先）與「cleanup 回呼本體」原始碼，給【B】真的跑
  const stmt = [...ancestors].reverse().find((a) => /Statement$|^VariableDeclaration$/.test(a.type) && a.type !== 'BlockStatement');
  assert.ok(stmt, '找不到包住 onAuthStateChanged 的敘述');
  const regStmtSrc = js.slice(stmt.start, stmt.end);
  const destroyBodySrc = destroyFn.body.type === 'BlockStatement' ? js.slice(destroyFn.body.start + 1, destroyFn.body.end - 1) : ('(' + js.slice(destroyFn.body.start, destroyFn.body.end) + ')');
  return { X, regStmtSrc, destroyBodySrc };
}

// ─────────────────────────────────────────────────────────────────────────────
// 【B】行為模擬：真的執行抽出來的原始碼，數存活監聽器
// ─────────────────────────────────────────────────────────────────────────────
/** 萬用空值：任何屬性都是自己、可呼叫、可 new、ToPrimitive=0 —— 讓 onDestroy 本體裡其他清理碼都能跑過 */
const U = new Proxy(function U() {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? (() => 0) : k === 'then' ? undefined : U),
  apply: () => U,
  construct: () => U,
});
function makeScope(vars) {
  const store = Object.assign(Object.create(null), vars);
  return new Proxy(store, {
    has: () => true,   // 所有自由識別字都走這個 scope（含賦值）
    get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : U)),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
function simulate(info, { instances = 3 } = {}) {
  const live = new Set(); let seq = 0, unsubCalls = 0; const cbTypes = [];
  const fakeOnAuth = (_auth, cb) => {
    cbTypes.push(typeof cb);
    const id = ++seq; live.add(id);
    return () => { unsubCalls++; live.delete(id); };
  };
  // ⚠ 用 new Function（非嚴格模式）才能用 with；抽出的碼是 esbuild 去型別後的 JS
  const mountFn = new Function('__s', 'with (__s) {\n' + info.regStmtSrc + '\n}');
  const destroyFn = new Function('__s', 'with (__s) {\n' + info.destroyBodySrc + '\n}');
  const scopes = [];
  for (let i = 0; i < instances; i++) {
    const s = makeScope({ onAuthStateChanged: fakeOnAuth, auth: {}, [info.X]: null });
    mountFn(s); scopes.push(s);
  }
  const afterMount = live.size;
  assert.strictEqual(afterMount, instances, '假 onAuthStateChanged 應被呼叫 ' + instances + ' 次（註冊敘述抽取失敗？）得到 ' + afterMount);
  assert.ok(cbTypes.every((t) => t === 'function'), 'onAuthStateChanged 的第二個引數必須是 callback 函式');
  destroyFn(scopes[0]);
  const afterOne = live.size;
  destroyFn(scopes[0]);   // 重複銷毀：不能炸、也不能多退
  const afterDup = { live: live.size, unsubCalls };
  for (let i = 1; i < instances; i++) destroyFn(scopes[i]);
  return { afterMount, afterOne, afterDup, afterAll: live.size, unsubCalls };
}

/** 完整守衛（AST + 行為），給主檔與突變體共用 */
function check(svelteSrc) {
  const info = analyze(svelteSrc);
  const r = simulate(info, { instances: 3 });
  assert.strictEqual(r.afterOne, 2, '銷毀 1 個實例後存活監聽器應為 2，得到 ' + r.afterOne + '（onDestroy 本體沒有真的呼叫 ' + info.X + '）');
  assert.strictEqual(r.afterDup.live, 2, '重複銷毀同一實例不得再退訂（存活應維持 2）');
  assert.strictEqual(r.afterDup.unsubCalls, 1, '重複銷毀同一實例不得重複呼叫 unsub（應 1 次，得到 ' + r.afterDup.unsubCalls + '）');
  assert.strictEqual(r.afterAll, 0, '全部實例銷毀後仍有 ' + r.afterAll + ' 個存活的 auth 監聽器（洩漏）');
  assert.strictEqual(r.unsubCalls, 3, 'unsub 總呼叫次數應 = 實例數 3，得到 ' + r.unsubCalls);
  return { info, r };
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('v6.307 /game onAuthStateChanged 退訂守衛：' + P_GAME);
const SRC = rd(P_GAME);

console.log('\n【A】AST：註冊在 onMount、回傳值賦給頂層變數、onDestroy 有呼叫');
let INFO = null;
T('唯一的 onAuthStateChanged 呼叫：在 onMount 內、回傳值被賦值、頂層宣告、onDestroy 有呼叫', () => {
  INFO = analyze(SRC);
  assert.ok(/^_unsub/.test(INFO.X), '變數命名應與 _unsubOracleUid 同型（_unsub*），得到 ' + INFO.X);
});

console.log('\n【B】行為：mount 3 → 銷毀 1 → 重複銷毀 → 全部銷毀，數存活監聽器');
T('mount 3 個實例 ⇒ 存活 3；銷毀 1 ⇒ 2；重複銷毀不多退；全部銷毀 ⇒ 0', () => {
  const { r } = check(SRC);
  assert.deepStrictEqual([r.afterMount, r.afterOne, r.afterAll], [3, 2, 0]);
});

console.log('\n【C】突變自測（每個突變體必須紅在預期那一條）');
const MUTANTS = [
  ['M1 拿掉賦值（＝v6.306 原狀，等價 HEAD-FAIL）',
    (s) => mutate(s, '_unsubAuth = onAuthStateChanged(auth,', 'onAuthStateChanged(auth,'), /沒有被賦值/],
  ['M2 onDestroy 整行拿掉',
    (s) => mutate(s, '    _unsubAuth?.(); _unsubAuth = null;', ''), /onDestroy 沒有呼叫 _unsubAuth/],
  ['M3 只清空不呼叫',
    (s) => mutate(s, '_unsubAuth?.(); _unsubAuth = null;', '_unsubAuth = null;'), /onDestroy 沒有呼叫 _unsubAuth/],
  ['M4 呼叫包在 if (false) 裡（AST 看得到呼叫、實際不會跑）',
    (s) => mutate(s, '_unsubAuth?.(); _unsubAuth = null;', 'if (false) { _unsubAuth?.(); } _unsubAuth = null;'), /存活監聽器應為 2/],
  ['M5 先清空再呼叫（順序錯，永遠呼叫到 null）',
    (s) => mutate(s, '_unsubAuth?.(); _unsubAuth = null;', '_unsubAuth = null; _unsubAuth?.();'), /存活監聽器應為 2/],
  ['M6 存到別的變數名（onDestroy 呼叫的不是它）',
    (s) => mutate(s, '_unsubAuth = onAuthStateChanged(auth,', '_unsubAuthTypo = onAuthStateChanged(auth,'), /onDestroy 沒有呼叫 _unsubAuthTypo/],
  ['M7 多了一個裸註冊（第二個監聽器沒人管）',
    (s) => mutate(s, '    _unsubAuth = onAuthStateChanged(auth,', '    onAuthStateChanged(auth, () => {});\n    _unsubAuth = onAuthStateChanged(auth,'), /只能有 1 個/],
  ['M8 解除搬到 onMount 開頭（不在 onDestroy）',
    (s) => mutate(mutate(s, '    _unsubAuth?.(); _unsubAuth = null;', ''),
      '    _unsubAuth = onAuthStateChanged(auth,', '    _unsubAuth?.(); _unsubAuth = null;\n    _unsubAuth = onAuthStateChanged(auth,'), /onDestroy 沒有呼叫 _unsubAuth/],
];
if (!process.env.V6307_SRC) {
  for (const [name, fn, expectRe] of MUTANTS) {
    T(name, () => {
      let err = null;
      try { check(fn(SRC)); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
      assert.ok(err, '突變體沒有讓任何斷言變紅 ⇒ 守衛是安慰劑');
      assert.ok(expectRe.test(String(err.message)), '紅在別條：' + String(err.message).slice(0, 300) + '（預期 ' + expectRe + '）');
    });
  }
} else {
  console.log('  （V6307_SRC 模式：跳過突變自測，只對指定檔跑 A/B）');
}

console.log('\nv6.307 守衛：PASS ' + pass + ' / FAIL ' + fail);
if (fail) process.exit(1);
