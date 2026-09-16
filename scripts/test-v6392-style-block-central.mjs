#!/usr/bin/env node
/**
 * v6.392 守衛：「Svelte 檔案的樣式區塊在哪裡」收斂成單一判準（站長裁示 ①）
 *
 * 【為什麼】v6.391 現查：這個判準被抄在 **21 個檔案／29 個呼叫點**裡。後果：
 *   ① 其中一份寫成 indexOf 就靜默切歪（css-cascade.mjs 踩過，把 4,900 行 markup 當 CSS）；
 *   ② 有人在註解裡寫出開頭字面，**所有呼叫點一起壞**，而且訊息全是「抽不到 CSS 規則」；
 *   ③ 沒有一份有 fail-closed，切歪了照樣回傳，守衛拿垃圾比對還亮綠燈。
 *
 * 【0】fixture　【A】⭐⭐ 唯一來源（禁自寫）　【B】⭐⭐ 行為層（含 fail-closed 正對照）
 * 【C】⭐⭐⭐ HEAD-FAIL　【D】chain
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleTagIndex, styleEndIndex, styleBlockOf, cssOf, markupBeforeStyle, assertLooksLikeStyleBlock } from './lib/svelte-style-block.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const SELF = 'scripts/test-v6392-style-block-central.mjs';
const LIB = 'scripts/lib/svelte-style-block.mjs';
// ⚠ BASE_SHA 必須留在 main 上（Rule 45）：git branch -a --contains f05e0bbe 要印得出 main。
const BASE_SHA = 'f05e0bbe94c3e7f1f49306b09e3f18cb2cad5add';   // v6.391（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); return true; }
  fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
  return false;
};

const OPEN = '<' + 'style';
const CLOSE = '</' + 'style>';
const PAGE = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, PAGE), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
console.log('【0】fixture');
// ═══════════════════════════════════════════════════════════════════════════
chk('F0 中央 helper 存在且 export 齊全',
  [styleTagIndex, styleEndIndex, styleBlockOf, cssOf, markupBeforeStyle, assertLooksLikeStyleBlock]
    .every((f) => typeof f === 'function'));
chk('F0b ★ 哨兵：本檔讀到的 +page.svelte 是活的', SRC.length > 100000 && SRC.includes('.tourn-tabs {'), String(SRC.length));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐⭐ 唯一來源：scripts/ 底下沒有人自己找樣式標籤');
// ═══════════════════════════════════════════════════════════════════════════
{
  const files = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); }
      else if (/\.(mjs|js)$/.test(n)) files.push(p);
    }
  })(join(ROOT, 'scripts'));
  chk('A0 ★ 掃描器有掃到東西（下限）', files.length > 300, String(files.length));

  // ⚠ 判準是「原始碼裡出現完整字面」。中央 helper 自己是用 '<' + 'style' 組出來的，
  //   所以它不會命中自己的判準 —— 這不是豁免，是刻意的寫法（見該檔檔頭）。
  const BAD = [
    new RegExp("lastIndexOf\\('" + OPEN + "'\\)"),
    new RegExp("indexOf\\('" + OPEN + "'\\)"),
    new RegExp("lastIndexOf\\('" + CLOSE + "'\\)"),
    new RegExp("indexOf\\('" + CLOSE + "'\\)"),
  ];
  // 白名單：突變測試必須寫得出「改回舊寫法」的字串，否則它就沒辦法證明守衛會紅。
  const ALLOW = new Set([
    // 突變測試必須寫得出「改回舊寫法」的字串，否則它就沒辦法證明守衛會紅。
    'scripts/mutcheck-v6390-scroll-list.mjs',
    'scripts/mutcheck-v6392-style-block.mjs',
    // ⚠ 未追蹤的廢棄舊實驗檔（v6.293 已取代它，不在 test chain 裡，本機跑本來就是 13 FAIL）。
    //   它只存在於站長的工作樹、CI 上根本沒這個檔 ⇒ 不白名單的話會造成「本機紅、CI 綠」。
    'scripts/test-v6291-friends-theme.mjs',
    SELF,
  ]);
  const hits = [];
  for (const p of files) {
    // ⚠ ROOT 是 fileURLToPath(new URL('..')) 的結果，**已經以分隔符結尾** ⇒ 不可以再 +1（會吃掉一個字元）。
    const rel = p.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
    if (ALLOW.has(rel)) continue;
    const s = readFileSync(p, 'utf8');
    for (const re of BAD) if (re.test(s)) { hits.push(rel); break; }
  }
  chk('A1 ⭐⭐⭐ 沒有任何 script 自己找樣式標籤（一律走 ' + LIB + '）',
    hits.length === 0, JSON.stringify(hits));
  // ★ 正對照：白名單裡的那幾支**確實**有那個字面（否則 A1 是「掃不到東西所以綠」）
  const allowHave = [...ALLOW].filter((rel) => {
    try { const s = readFileSync(join(ROOT, rel), 'utf8'); return BAD.some((re) => re.test(s)); } catch { return false; }
  });
  chk('A1b ★ 正對照：白名單裡至少有一支真的含那個字面（證明偵測器會命中）',
    allowHave.length >= 1, JSON.stringify(allowHave));

  const users = files.filter((p) => readFileSync(p, 'utf8').includes("svelte-style-block.mjs"));
  chk('A2 ⭐ 至少 18 個檔案改用中央 helper（v6.392 現查 21 個）', users.length >= 18, String(users.length));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 行為層');
// ═══════════════════════════════════════════════════════════════════════════
{
  const a = styleTagIndex(SRC), e = styleEndIndex(SRC);
  chk('B1 開頭／結束標籤位移合理', a > 0 && e > a, JSON.stringify({ a, e }));
  const block = styleBlockOf(SRC), css = cssOf(SRC), markup = markupBeforeStyle(SRC);
  chk('B2 ⭐ markupBeforeStyle ＋ styleBlockOf 拼回來 === 原檔（沒有漏字也沒有重複）',
    markup + block === SRC, JSON.stringify({ m: markup.length, b: block.length, s: SRC.length }));
  chk('B3 ⭐ cssOf 是 styleBlockOf 的真子集，而且不含標籤',
    block.includes(css) && !css.includes(OPEN) && !css.includes(CLOSE) && css.length > 100000,
    JSON.stringify({ css: css.length, block: block.length }));
  chk('B4 ⭐ cssOf 抓得到真實的 CSS 規則（.tourn-tabs 在最前段）', css.includes('.tourn-tabs {'));
}
// B5／B6：fail-closed 的**正對照** —— 這兩條才是這支守衛的本體
{
  // 現查：+page.svelte 的 <svelte:head> 裡有一段 {@html '…'} 注入樣式，
  //   那個開頭字面排在真標籤之前 ⇒ 用 indexOf 一定會切歪。
  const first = SRC.indexOf(OPEN), last = SRC.lastIndexOf(OPEN);
  chk('B5 ★ 現查：檔案裡確實有一個排在真標籤之前的假開頭字面（fail-closed 才有意義）',
    first >= 0 && first < last, JSON.stringify({ first, last }));
  let threw = false;
  try { assertLooksLikeStyleBlock(SRC.slice(first)); } catch { threw = true; }
  chk('B6 ⭐⭐⭐ 用 indexOf 切出來的區塊，fail-closed 必須炸（不可以默默回傳）', threw);
  // 註解裡塞一個開頭字面 ⇒ lastIndexOf 會被推到後面 ⇒ 也必須炸
  const poisoned = SRC.replace('.copy-attack-modal{', '/* ' + OPEN + '> */ .copy-attack-modal{');
  let threw2 = false, msg2 = '';
  try { styleBlockOf(poisoned); } catch (e) { threw2 = true; msg2 = String(e.message); }
  chk('B7 ⭐⭐ 註解裡出現開頭字面（Rule 48）⇒ 中央 helper 必須炸，而且要說出真正的原因',
    poisoned !== SRC && threw2 && msg2.includes('Rule 48'), JSON.stringify({ changed: poisoned !== SRC, msg: msg2.slice(0, 60) }));
  // ★ 反面對照：正常的檔案不可以炸
  let ok3 = true;
  try { styleBlockOf(SRC); cssOf(SRC); } catch { ok3 = false; }
  chk('B8 ★ 反面對照：正常的檔案不會炸（B6／B7 不是「什麼都炸」）', ok3);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐⭐ HEAD-FAIL：BASE(v6.391) 上這些全部不成立');
// ═══════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6.392【C】HEAD-FAIL', '需要歷史 commit');
} else {
  const blib = readBaseBlob(ROOT, BASE_SHA, LIB);
  chk('C1 ⭐⭐⭐ BASE 根本沒有中央 helper 這個檔', !blib.ok || !blib.out);
  // BASE 上那幾支守衛都還是自己寫的
  const SAMPLES = ['scripts/test-v6297-tourn-friends-tab.mjs', 'scripts/test-v6298-lobby-tab-align.mjs',
    'scripts/test-v6303-ui-batch.mjs', 'scripts/test-v6199-leaderboard-top-n.mjs'];
  const selfWritten = SAMPLES.filter((rel) => {
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    return b.ok && new RegExp("lastIndexOf\\('" + OPEN + "'\\)").test(b.out);
  });
  chk('C2 ⭐⭐⭐ BASE 上這 ' + SAMPLES.length + ' 支**全部**是自己寫的', selfWritten.length === SAMPLES.length,
    JSON.stringify(selfWritten));
  const nowSelf = SAMPLES.filter((rel) => new RegExp("lastIndexOf\\('" + OPEN + "'\\)").test(readFileSync(join(ROOT, rel), 'utf8')));
  chk('C2b ★ 正對照：同樣那幾支在 HEAD 已經一支都沒有自己寫', nowSelf.length === 0, JSON.stringify(nowSelf));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const chain = String(pkg.scripts?.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('D1 ⭐ scripts.test 裡**恰好**有本檔一次',
    chain.filter((s) => s === 'node ' + SELF).length === 1,
    String(chain.filter((s) => s === 'node ' + SELF).length));
}

console.log(`\n=== v6.392 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
