#!/usr/bin/env node
/**
 * 突變測試：證明 test-runner-and-chain-hygiene.mjs 不是安慰劑。
 *
 * 為什麼這支特別需要突變測試：那支守衛是**預防性**的——現況鏈上 `mutcheck` 出現
 * 0 次，BASE 上也是 0 次，所以「它是綠的」這件事與一條恆真斷言無法區分
 * （安慰劑型態 1）。它唯一的證據就是判準真的抓得到違規。
 *
 * 做法：逐一注入一個「守衛應該要擋下來的錯誤」，跑守衛，斷言
 *   ① 守衛 exit code ≠ 0（⚠ 絕不用 /FAIL/.test(out) —— 守衛結尾恆印「FAIL N」）
 *   ② **紅在預期的那一條**（紅錯地方 = 沒測到，型態 2）
 * 最後一律還原（finally），並複驗「還原後守衛全綠」。
 *
 * ⚠⚠ 這支是**破壞式**的：它會暫時改寫 package.json 與 scripts/ 底下的檔案。
 *   請在平行 runner 的沙盒裡跑（`node scripts/run-tests.mjs --setup-only --workers 1`
 *   之後 `cd P:\repo`），不要在主樹跑。它刻意**不**接進 npm test chain，
 *   而 test-runner-and-chain-hygiene 的 A1 正是在守這件事。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const GUARD = join(ROOT, 'scripts/test-runner-and-chain-hygiene.mjs');

const PKG = 'package.json';
const LIB = 'scripts/lib/chain-parse.mjs';
const RUNNER = 'scripts/run-tests.mjs';

/** @type {{id:string,file:string,from:string,to:string,red:string[],green?:string[]}[]} */
const MUTS = [
  {
    id: 'M1 把一支 mutcheck-* 接進 scripts.test（這支守衛存在的理由）',
    file: PKG,
    from: 'node scripts/anti-pattern-lint.mjs && ',
    to: 'node scripts/anti-pattern-lint.mjs && node scripts/mutcheck-runner-chain-hygiene.mjs && ',
    red: ['A1'],
    green: ['A2', 'A3'],     // 正／反對照不該跟著爆，證明它們各自獨立
  },
  {
    id: 'M2 掏空「scripts 路徑」的 mutcheck 偵測',
    file: LIB,
    from: '  for (const s of scripts) if (/(^|\\/)mutcheck-/.test(s)) hit.push(s);',
    to: '  if (0) for (const s of scripts) if (/(^|\\/)mutcheck-/.test(s)) hit.push(s);',
    red: ['A2'],
    // ⭐ A1 不會紅（鏈上本來就 0 支 mutcheck）—— 正對照才是這支預防性守衛唯一的偵測器。
    // ⭐ A2b 也不該紅：它走的是 **odd 路徑**（帶參數的步驟），與這一行各自獨立。
    //    這一條當初宣告成「A2 與 A2b 都要紅」，突變測試把我的誤解抓出來了 —— 那正是
    //    「必須斷言**紅在預期的那一條**」這個紀律的用處（安慰劑型態 2：紅錯地方也算沒測到）。
    green: ['A1', 'A2b', 'A3'],
  },
  {
    id: 'M2b 掏空「odd 路徑」的 mutcheck 偵測（帶參數的步驟）',
    file: LIB,
    from: '  for (const s of odd) if (/mutcheck-/.test(s)) hit.push(s);',
    to: '  if (0) for (const s of odd) if (/mutcheck-/.test(s)) hit.push(s);',
    red: ['A2b'],
    green: ['A1', 'A2', 'A3'],   // 反過來證明兩條偵測路徑確實各自獨立
  },
  {
    id: 'M3 解析器對 shell 片段不再判成 odd（形狀判準被放寬）',
    file: LIB,
    // ⚠ anchor 一律用**單行**：這些檔是 CRLF，跨行的 anchor 用 '\n' 接起來會對不上。
    from: '    if (!m) { odd.push(s); continue; }',
    to: '    if (!m) { continue; }',
    red: ['B2b'],
    green: ['B1'],   // B1 掃的是真實的 chain（本來就沒有 shell 片段）⇒ 不該跟著紅
  },
  {
    id: 'M4 runner 拿掉中央 import（Rule 38：判準又變成兩份）',
    file: RUNNER,
    from: "import { parseChain as parseChainCentral } from './lib/chain-parse.mjs';",
    to: "// removed-by-mutcheck",
    red: ['C1'],
  },
  {
    id: 'M5 runner 就地再寫一次 split(\'&&\') 解析',
    file: RUNNER,
    from: "  const parsed = parseChainCentral(raw);",
    to: "  const parsed = parseChainCentral(raw); const _shadow = raw.split('&&').map((x) => x.trim());",
    red: ['C2'],
    green: ['C1'],
  },
];

function runGuard() {
  const r = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, timeout: 300000 });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
/** 某一條斷言有沒有紅。⚠ 只認「FAIL <id>」這個逐條樣式，不是整篇 grep 'FAIL'。 */
function isRed(out, id) {
  return new RegExp('^\\s*FAIL ' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'm').test(out);
}

console.log('【0】基準：未突變時守衛必須全綠');
{
  const r = runGuard();
  assert.strictEqual(r.code, 0, '未突變就紅了，突變測試無意義：\n' + r.out.slice(-1200));
  console.log('  OK  守衛在乾淨狀態下 exit=0');
}

let killed = 0;
for (const m of MUTS) {
  const path = join(ROOT, m.file);
  const orig = readFileSync(path, 'utf8');
  let ok = false;
  try {
    assert.ok(orig.includes(m.from), `${m.id}：突變 anchor 不在（判準已改？）\n  找：${m.from.slice(0, 80)}`);
    writeFileSync(path, orig.replace(m.from, m.to));
    const r = runGuard();
    assert.notStrictEqual(r.code, 0, `${m.id}：突變存活（守衛照樣 exit=0）`);
    for (const id of m.red) {
      assert.ok(isRed(r.out, id), `${m.id}：應該紅在 ${id}，但那一條沒紅\n` + r.out.slice(-1500));
    }
    for (const id of (m.green || [])) {
      assert.ok(!isRed(r.out, id), `${m.id}：${id} 不該跟著紅（兩條斷言沒有各自獨立）`);
    }
    ok = true;
  } finally {
    writeFileSync(path, orig);
  }
  killed++;
  console.log(`  OK  ${m.id}  → 紅在 ${m.red.join('/')}${m.green ? '，而 ' + m.green.join('/') + ' 維持綠' : ''}`);
}

console.log('\n【末】還原後複驗');
{
  const r = runGuard();
  assert.strictEqual(r.code, 0, '還原後守衛沒有回到全綠（finally 沒還原乾淨）：\n' + r.out.slice(-1200));
  console.log('  OK  還原後 exit=0');
}

console.log(`\n=== mutcheck runner/chain hygiene：${killed}/${MUTS.length} 個突變都被抓到 ===`);
