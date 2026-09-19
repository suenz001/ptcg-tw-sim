#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// test-runner-and-chain-hygiene —— `scripts.test` 這條鏈與平行 runner 的衛生守衛
//
// 【這支守衛守什麼】
//  A) `scripts.test` 不得包含任何 `mutcheck-*` 步驟。
//     mutcheck-* 是**破壞式**的突變測試工具：它把出貨碼或守衛檔改壞、跑一次證明
//     守衛會翻紅、再還原。那是開發時手動跑的，不是回歸測試。一旦被接進 npm test：
//       ① CI 會在 checkout 出來的工作樹上做破壞式改寫，中斷時還原不回去；
//       ② 它們刻意製造紅燈 ⇒ `&&` 鏈從那一步整條停掉，後面幾百支全部不跑。
//  B) chain 的形狀（每一步都是裸 `node scripts/xxx.mjs`）與存在性。
//  C) IRON_RULES Rule 38：這條鏈的解析判準只能有**一份**，在
//     `scripts/lib/chain-parse.mjs`。`scripts/run-tests.mjs` 必須 import 它，
//     不得就地再寫一次 `split('&&')`。
//
// 【⚠ 這是預防性守衛，沒有 HEAD-FAIL】
//   現況鏈上 `mutcheck` 出現 0 次，BASE 上也是 0 次 ⇒ 把改動還原成 BASE，
//   這支照樣綠。也就是說「它現在是綠的」這件事**不構成任何證據**，與一條恆真
//   斷言無法區分（安慰劑型態 1：恆真斷言）。
//   ⇒ 它唯一的證據是**正對照**：A2／A2b／B2／C2b 各餵一個人造違規樣本給
//     **與正式斷言同一個函式**，證明判準真的抓得到。反安慰劑自檢若只是把判準
//     再抄一次餵樣本，它在任何版本都恆綠（Rule 38 的孿生陷阱），所以這裡刻意
//     呼叫 `mutcheckOffenders` / `parseChain` 本身，不另寫一份。
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { parseChain, mutcheckOffenders } from './lib/chain-parse.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
let P = 0, F = 0;
const chk = (name, cond, detail = '') => {
  if (cond) { P++; console.log('  PASS ' + name); }
  else { F++; console.log('  FAIL ' + name + (detail ? '\n        ' + detail : '')); }
};

const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const TEST = String((PKG.scripts && PKG.scripts.test) || '');
const SELF = 'scripts/test-runner-and-chain-hygiene.mjs';
const LIB = 'scripts/lib/chain-parse.mjs';
const RUNNER = 'scripts/run-tests.mjs';

console.log('\n【A】scripts.test 不得包含 mutcheck-* 步驟');
const off = mutcheckOffenders(TEST);
chk('A1 ★★★ chain 裡沒有任何 mutcheck-* 步驟', off.length === 0, '違規：' + off.join(', '));

const POS_A = 'node scripts/test-a.mjs && node scripts/mutcheck-v9999-x.mjs && node scripts/test-b.mjs';
const hitA = mutcheckOffenders(POS_A);
chk('A2 ★ 正對照：人造違規必須被**同一個偵測函式**抓到',
  hitA.length === 1 && hitA[0] === 'scripts/mutcheck-v9999-x.mjs', JSON.stringify(hitA));

const POS_A2 = 'node scripts/test-a.mjs && node scripts/mutcheck-y.mjs --sample && node scripts/test-b.mjs';
chk('A2b ★ 正對照：帶參數的 mutcheck 步驟也要抓到（它走的是 odd 那條路徑）',
  mutcheckOffenders(POS_A2).length === 1, JSON.stringify(mutcheckOffenders(POS_A2)));

chk('A3 ★ 反對照：乾淨的鏈不得誤報',
  mutcheckOffenders('node scripts/test-a.mjs && node scripts/test-b.mjs').length === 0);

console.log('\n【B】chain 的形狀與存在性');
const C = parseChain(TEST);
chk('B1 ⭐ 解析器下限：chain 步數 ≥ 400（解析器壞掉要在這裡爆，不可以靜默回空集合）',
  C.stepCount >= 400, '實際 ' + C.stepCount);
chk('B2 ⭐⭐ chain 每一步都是裸 `node scripts/xxx.mjs`（沒有被塞進 shell 片段）',
  C.odd.length === 0, C.odd.slice(0, 3).join(' | '));
chk('B2b ★ 正對照：塞進 shell 片段必須被判成 odd',
  parseChain('node scripts/a.mjs && echo hi && node scripts/b.mjs').odd.length === 1);
{
  const missing = C.uniq.filter((s) => !existsSync(join(ROOT, s)));
  chk('B3 ⭐⭐ chain 宣告的每一支腳本都存在（少一支 ⇒ CI 從那裡起整條不跑）',
    missing.length === 0, missing.slice(0, 5).join(', '));
}
chk('B4 重複步驟數與已知一致（目前 2 支，已查證是筆誤；runner 內部去重，不動 package.json）',
  C.dups.length <= 2, '重複 ' + C.dups.length + '：' + C.dups.join(', '));

console.log('\n【C】Rule 38：這條鏈的解析判準只能有一份');
chk('C0 ⭐ 中央解析器存在', existsSync(join(ROOT, LIB)));
const RT_RAW = existsSync(join(ROOT, RUNNER)) ? readFileSync(join(ROOT, RUNNER), 'utf8') : '';
chk('C0b ⭐ 平行 runner 存在', RT_RAW.length > 0);
// ⚠ 先剝註解再掃：註解裡提到判準的名字會讓 lint 假綠／假紅（安慰劑型態 6）
const RT = stripCommentsBlankChecked(RT_RAW);
chk('C1 ⭐⭐ run-tests.mjs 必須 import 中央解析器',
  /from\s+['"]\.\/lib\/chain-parse\.mjs['"]/.test(RT), '沒看到 import');
chk('C2 ⭐⭐ run-tests.mjs 不得就地再寫一次 `split(\'&&\')` 解析',
  !/split\(\s*['"]&&['"]\s*\)/.test(RT), '還有就地解析 ⇒ 判準兩份 ⇒ 針對它的守衛會變安慰劑');
chk('C2b ★ 正對照：C2 的判準抓得到就地解析的樣式',
  /split\(\s*['"]&&['"]\s*\)/.test("const steps = raw.split('&&').map(s => s.trim());"));
chk('C2c ★ 反對照：C2 的判準不會被無關的 split 誤觸',
  !/split\(\s*['"]&&['"]\s*\)/.test("const lines = src.split('\\n');"));

console.log('\n【D】本守衛自己必須在 npm test chain 裡（否則寫了等於沒寫）');
{
  const mine = C.uniq.filter((s) => s === SELF);
  const hits = C.scripts.filter((s) => s === SELF).length;
  chk('D1 ⭐ scripts.test 裡**恰好**有本檔一次', mine.length === 1 && hits === 1, '出現 ' + hits + ' 次');
}

console.log(`\n=== runner/chain hygiene：PASS ${P} / FAIL ${F} ===`);
assert.strictEqual(F, 0, `有 ${F} 條失敗`);
