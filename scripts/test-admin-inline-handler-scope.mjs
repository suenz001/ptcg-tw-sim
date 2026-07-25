// v1.58 守衛：admin.html 的 inline on* handler 不可直接寫入模組層級變數。
//
// 真實事故（同一個坑的第二次）：
//   admin.html 整份是 `<script type="module">`，模組層級的 `let` **不是 window 屬性**；
//   而 HTML 的 inline `onchange="..."` 是在**全域**作用域執行的。
//   於是 `onchange="_archSince=this.value"` 只是建立了一個同名的全域變數，
//   模組內的 `_archSince` 永遠停在初始值 '0' →
//   牌組原型統計不論選「最近 7 天」還是「最近 30 天」，送出的 since 都是 0（全部時間），
//   Wilson 看到的數字完全不變。
//
//   ⚠這類錯誤不會有任何錯誤訊息：不 throw、不 console.error、功能「看起來有反應」
//     （因為它確實重新載入了），只是參數永遠錯。靠肉眼複查極難發現 → 必須用靜態守衛。
//
//   第一次是 v1.50「inline onclick 呼叫的函式必須掛 window」，這次是「賦值」的變體。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const lines = src.split('\n');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ── 收集模組層級（頂層縮排）的 let/const/var 名稱 ──
const modStart = lines.findIndex((l) => l.includes('<script type="module">'));
const topLevelVars = new Set();
if (modStart >= 0) {
  for (const l of lines.slice(modStart + 1)) {
    const m = /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (m) topLevelVars.add(m.group ? m.group(1) : m[1]);
  }
}

T('前提：admin.html 是 module script 且有模組層級變數（本檢查才有意義）', () => {
  assert.ok(modStart >= 0, 'admin.html 應為 <script type="module">');
  assert.ok(topLevelVars.size > 20, '應找得到模組層級變數，實得 ' + topLevelVars.size);
  console.log('   模組層級變數 ' + topLevelVars.size + ' 個');
});

const HANDLER_RE = /\bon(?:click|change|input|submit|keyup|keydown|blur|focus)\s*=\s*"([^"]*)"/g;
/** 找出 inline handler 內對「識別字」的賦值（=、++、--、+=、-=）。 */
function assignmentsIn(body) {
  const out = [];
  for (const m of body.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+\+|--|\+=|-=)/g)) out.push(m[1]);
  return out;
}

T('⭐inline on* handler 不可直接賦值模組層級變數（全域作用域寫不到它，會靜默失效）', () => {
  const bad = [];
  lines.forEach((raw, i) => {
    // 剝掉行註解——說明文字裡引用壞寫法當反例是合理的，不該誤判
    const c = raw.indexOf('//');
    const l = c >= 0 && !raw.slice(0, c).includes('"') ? raw.slice(0, c) : raw;
    for (const m of l.matchAll(HANDLER_RE)) {
      for (const name of assignmentsIn(m[1])) {
        if (topLevelVars.has(name)) bad.push(`第 ${i + 1} 行：${name}  ←  ${m[1].slice(0, 80)}`);
      }
    }
  });
  assert.deepEqual(bad, [],
    '以下 inline handler 寫的是全域同名變數、模組內的值永遠不會變（請改成掛在 window 的 setter）：\n  '
    + bad.join('\n  '));
});

T('⭐時間範圍下拉必須透過掛在 window 的 setter（本次事故的具體回歸鎖）', () => {
  const sel = lines.find((l) => l.includes('id="arch-since"'));
  assert.ok(sel, '牌組原型的時間範圍下拉應存在');
  assert.ok(/onchange="setArchSince\(/.test(sel), '應呼叫 setArchSince()，實際：' + sel.trim().slice(0, 140));
  assert.ok(src.includes('window.setArchSince'), 'setArchSince 必須掛在 window，否則 inline handler 找不到它');
});

T('⭐時間範圍的讀取端以畫面上的下拉為單一真實來源（模組變數不同步也不會算錯）', () => {
  assert.ok(src.includes('function currentArchSince('), '應有 currentArchSince() 讀取器');
  const raw = (src.match(/Number\(_archSince\s*\|\|\s*0\)/g) || []).length;
  assert.equal(raw, 0, '不應再有任何地方直接讀模組變數 _archSince 來算天數（要走 currentArchSince()）');
  const via = (src.match(/Number\(currentArchSince\(\)\s*\|\|\s*0\)/g) || []).length;
  assert.ok(via >= 2, '統計與明細兩個端點都要走 currentArchSince()，實得 ' + via);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
