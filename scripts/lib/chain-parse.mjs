// ════════════════════════════════════════════════════════════════════════════
// scripts/lib/chain-parse.mjs —— `package.json` 的 scripts.test 這條鏈的**唯一**解析器
//
// 為什麼要有這支：`scripts/run-tests.mjs`（平行 runner）與
// `scripts/test-runner-and-chain-hygiene.mjs`（守衛）都要判斷「這條鏈長什麼樣」。
// 判準寫兩份的話，守衛的突變測試只會改到其中一份，另一份把行為撐住
// ⇒ 守衛看起來很認真、其實測不到（IRON_RULES Rule 38，安慰劑型態 11）。
// 所以兩邊一律 import 這裡的函式，禁止就地再寫一次。
// ════════════════════════════════════════════════════════════════════════════

/** 從 scripts.test 的字串解析出步驟。回傳的 odd 是「不是裸 node 指令」的那些步驟。 */
export function parseChain(testStr) {
  const raw = String(testStr || '');
  const steps = raw.split('&&').map((s) => s.trim()).filter(Boolean);
  const scripts = [];
  const odd = [];
  for (const s of steps) {
    const m = /^node\s+(scripts\/[A-Za-z0-9._-]+\.mjs)$/.exec(s);
    if (!m) { odd.push(s); continue; }
    scripts.push(m[1]);
  }
  const seen = new Set();
  const uniq = [];
  const dups = [];
  for (const s of scripts) {
    if (seen.has(s)) { dups.push(s); continue; }
    seen.add(s); uniq.push(s);
  }
  return { stepCount: steps.length, scripts, uniq, dups, odd };
}

/**
 * 找出鏈上的突變測試腳本（`mutcheck-*.mjs`）。
 *
 * 為什麼不准它們在鏈上：`mutcheck-*` 是**破壞式**的——它們會把出貨碼或守衛檔
 * 改壞、跑一次、再還原，用來證明「這個突變會讓守衛翻紅」。那是開發時手動跑的
 * 工具，不是回歸測試。一旦被接進 `npm test`：
 *   ① CI 會在 checkout 出來的工作樹上做破壞式改寫，中斷時還原不回去；
 *   ② 它們刻意製造紅燈，會讓 `&&` 鏈從那一步整條停掉。
 * 這條規則目前沒有任何違規（鏈上 mutcheck 出現 0 次），所以它是**預防性**守衛
 * ——正因如此，配的正對照就是它唯一的證據：沒有正對照，這支守衛與一條
 * 恆真斷言無法區分（安慰劑型態 1）。
 */
export function mutcheckOffenders(testStr) {
  const { scripts, odd } = parseChain(testStr);
  const hit = [];
  for (const s of scripts) if (/(^|\/)mutcheck-/.test(s)) hit.push(s);
  // odd 的步驟也要看：有人可能寫成 `node scripts/mutcheck-x.mjs --foo`
  for (const s of odd) if (/mutcheck-/.test(s)) hit.push(s);
  return hit;
}
