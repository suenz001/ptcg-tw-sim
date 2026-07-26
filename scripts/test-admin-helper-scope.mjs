// v0.94 守衛：admin patch 的跨區塊 helper 必須定義在所有 caller 都看得到的作用域。
//
// 為什麼需要這張網（真實事故）：
//   v0.91/v0.92 把 buildCasualCleanFilter 與 getCardAttrMap 定義進
//   `(function registerMatchRecords(){ ... })()` 這個 IIFE 內，
//   但「牌組原型統計」與「牌組原型明細」兩個端點在該 IIFE **之外** →
//   線上一點就 `ReferenceError: buildCasualCleanFilter is not defined`。
//
//   ⚠為什麼既有防線全部漏接：
//     ・`node --check` 只驗語法，跨 closure 的名稱解析它不管
//     ・單元測試用 `new Function(抽出的函式文字)` 執行，**完全繞過原始作用域**
//   所以需要這個專門檢查「定義位置 vs 使用位置」的靜態守衛。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');

/** 找出所有具名 IIFE `(function name() { ... })()` 的行範圍。 */
function findIifeRanges() {
  const out = [];
  const re = /\(function\s+(\w+)\s*\(\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let d = 0, j = m.index + m[0].length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (d === 0) break; }
    }
    out.push({
      name: m[1],
      startLine: src.slice(0, m.index).split('\n').length,
      endLine: src.slice(0, j).split('\n').length,
    });
  }
  return out;
}
const lineOf = (needle) => {
  const i = src.indexOf(needle);
  return i < 0 ? -1 : src.slice(0, i).split('\n').length;
};
const iifes = findIifeRanges();

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：patch 檔內確實有具名 IIFE 區塊（本檢查才有意義）', () => {
  assert.ok(iifes.length > 0, '應找得到至少一個具名 IIFE');
  console.log('   偵測到 IIFE：' + iifes.map((x) => `${x.name}(${x.startLine}-${x.endLine})`).join('、'));
});

// 這些 helper 同時被 IIFE 內外的程式碼使用 → 必須定義在所有 IIFE 之外
const SHARED_HELPERS = [
  { def: 'function buildCasualCleanFilter(', users: ["app.get('/api/admin/deck-archetype-stats'",
                                                     "app.get('/api/admin/deck-archetype-detail'",
                                                     "app.get('/api/admin/stats/cards/winrate'"] },
  { def: 'function getCardAttrMap(', users: ["app.get('/api/admin/deck-archetype-detail'"] },
];

for (const h of SHARED_HELPERS) {
  const name = h.def.replace('function ', '').replace('(', '');
  T(`⭐${name} 必須定義在所有 IIFE 之外（否則 IIFE 外的端點會 ReferenceError）`, () => {
    const defLine = lineOf(h.def);
    assert.ok(defLine > 0, h.def + ' 應存在');
    const inside = iifes.find((r) => defLine >= r.startLine && defLine <= r.endLine);
    assert.ok(!inside, `定義在第 ${defLine} 行，落在 IIFE ${inside?.name}(${inside?.startLine}-${inside?.endLine}) 內`
      + ' → IIFE 外的呼叫端會 ReferenceError');
  });
  T(`${name} 的定義位置早於所有使用點（函式宣告雖會 hoist，仍以可讀性為準）`, () => {
    const defLine = lineOf(h.def);
    for (const u of h.users) {
      const uLine = lineOf(u);
      if (uLine < 0) continue;   // 該 caller 可能尚未存在
      assert.ok(defLine < uLine, `${name} 定義在第 ${defLine} 行，卻在第 ${uLine} 行就被使用`);
    }
  });
}

T('⭐事故重演鎖：helper 與其 caller 不可分處兩個「平行」的 IIFE（互相看不到）', () => {
  // 這正是 v0.94 事故的形狀：
  //   helper 在 registerMatchRecords 內、端點在 registerStatsEndpoints 內 —— 兩個平行閉包，
  //   彼此不在對方的作用域鏈上 → ReferenceError。
  // 只要 helper 定義在**所有** IIFE 之外（最外層），任何 IIFE 內的 caller 都讀得到，此風險即消失。
  const iifeOf = (ln) => iifes.find((r) => ln >= r.startLine && ln <= r.endLine);
  for (const h of SHARED_HELPERS) {
    const name = h.def.replace('function ', '').replace('(', '');
    const defIife = iifeOf(lineOf(h.def));
    for (const u of h.users) {
      const uLine = lineOf(u);
      if (uLine < 0) continue;
      const useIife = iifeOf(uLine);
      if (!defIife) continue;                      // helper 在最外層 → 一定看得到，安全
      assert.equal(defIife.name, useIife?.name,
        `${name} 定義在 IIFE ${defIife.name}，但 ${u} 在 ${useIife?.name ?? '最外層'} —— 兩者互相看不到`);
    }
  }
  console.log('   兩個牌組原型端點所在 IIFE：'
    + ["app.get('/api/admin/deck-archetype-stats'", "app.get('/api/admin/deck-archetype-detail'"]
        .map((ep) => (iifeOf(lineOf(ep))?.name ?? '最外層')).join('、')
    + '；helper 皆在最外層 → 讀得到');
});

// ══ v1.01：通用作用域掃描（取代「逐一點名少數 helper」）════════════════════
// v0.94 是「helper 關在 IIFE 內、caller 在外」；v1.01 是它的**鏡像**——
//   v1.00 新增的 getPokemonNameSet() 定義在外層，但它呼叫的 getCardNameMap
//   當時還關在 registerStatsEndpoints 的 IIFE 內 → 一按「計算統計」就
//   ReferenceError『getCardNameMap is not defined』，整個端點 500。
// 兩次都不是語法錯，`node --check` 與「抽出函式文字執行」的單元測試都抓不到，
//   只有真的部署上去點下去才會炸。上面那條 SHARED_HELPERS 是**逐一點名**的白名單，
//   換個新 helper 名字就完全漏掉——所以這裡改成通用規則：
//   **凡定義在所有 IIFE 之外的函式，它呼叫到的本檔函式也必須在外層看得到。**

/** 把註解與字串換成等長空白：說明文字裡提到的函式名不是真的呼叫。 */
function _blank(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (x) => x.replace(/[^\n]/g, ' '));
}
/** 以大括號深度配對，找出某個 '{' 對應的 '}'。 */
function _matchBrace(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') d++;
    else if (s[i] === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}
function _iifeRanges(s) {
  const out = [];
  for (const m of s.matchAll(/\(function\s+([A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g)) {
    const open = s.indexOf('{', m.index), end = _matchBrace(s, open);
    if (end > 0) out.push({ name: m[1] || '(匿名)', start: m.index, end });
  }
  return out;
}
function _funcDecls(s) {
  const out = [];
  for (const m of s.matchAll(/\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g)) {
    const open = s.indexOf('{', m.index), end = _matchBrace(s, open);
    if (end > 0) out.push({ name: m[1], at: m.index, bodyStart: open, bodyEnd: end });
  }
  return out;
}

T('⭐⭐通用鎖：IIFE 外的函式不可呼叫「只存在於某個 IIFE 內」的函式（v1.01 事故）', () => {
  const clean = _blank(src);
  const iifes = _iifeRanges(src);
  const decls = _funcDecls(src);
  const enclosing = (pos) => iifes.filter((r) => pos > r.start && pos < r.end);

  const outer = new Set(), innerOnly = new Map();
  for (const d of decls) {
    const rs = enclosing(d.at);
    if (!rs.length) outer.add(d.name);
    else if (!innerOnly.has(d.name)) innerOnly.set(d.name, rs[rs.length - 1].name);
  }
  for (const n of outer) innerOnly.delete(n);   // 外層也有一份就沒問題

  const bad = [], seen = new Set();
  for (const d of decls) {
    if (enclosing(d.at).length) continue;        // 只查「定義在外層」的函式
    const body = clean.slice(d.bodyStart, d.bodyEnd);
    // 自己 body 內定義的巢狀函式當然看得到
    const local = new Set([...body.matchAll(/\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g)].map((x) => x[1]));
    for (const c of body.matchAll(/\b([A-Za-z0-9_$]+)\s*\(/g)) {
      const n = c[1];
      if (n === d.name || local.has(n) || !innerOnly.has(n)) continue;
      const k = d.name + '>' + n;
      if (seen.has(k)) continue;
      seen.add(k);
      bad.push(`${d.name}()（最外層）呼叫了 ${n}()，但 ${n} 只定義在 IIFE ${innerOnly.get(n)} 內 —— 執行到就 ReferenceError`);
    }
  }
  assert.deepEqual(bad, [], '跨作用域引用：\n  ' + bad.join('\n  '));
  console.log(`   掃描 ${decls.length} 個函式宣告 / ${iifes.length} 個 IIFE，外層函式 ${outer.size} 個 → 無跨作用域引用`);
});


T('整份 patch 語法可解析（等同 node --check，順手鎖住）', () => {
  // 用 Function 建構子做語法檢查；patch 是 script 不是 module，可直接丟
  assert.doesNotThrow(() => new Function(src.replace(/^#!.*\n/, '')), '語法應可解析');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
