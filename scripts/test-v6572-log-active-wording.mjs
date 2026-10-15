#!/usr/bin/env node
/**
 * v6.572 守衛：對戰紀錄與畫面文字的「戰鬥位」統一成官方卡面用詞（站長 2026-10-15 分批統一第 2 批：「戰鬥位 → 戰鬥場」）。
 *   依據：static/cards 官方卡面「戰鬥場」288 次、「戰鬥寶可夢」1144 次、「戰鬥位」0 次。
 *   用法：講「位置」用「戰鬥場」（留在戰鬥場、不在戰鬥場、戰鬥場置中）；講「那隻寶可夢」用「戰鬥寶可夢」
 *        （對手的戰鬥寶可夢身上的能量、已昏厥的戰鬥寶可夢、戰鬥寶可夢與備戰寶可夢互換）。
 *
 *   S1 src 所有字串字面（含 picker 標題、按鈕）不再出現「戰鬥位」；唯一例外是 ai-eval.ts 的內部除錯鍵（玩家看不到）
 *   S2 .svelte 畫面文字（模板、屬性）不再出現「戰鬥位」
 *   S3 掃描器正對照：字串與畫面裡的違規樣本抓得到；註解不算
 *   W1 抽樣確認改寫用對了詞（位置 vs 寶可夢）
 *   【H】BASE（v6.571）：S1、S2、W1 紅；S3 綠（正對照）
 *   ⭐審查（Opus 5.5）P3-1～P3-3：S3 補模板插值／巢狀／regex 字面樣本；ai-eval 只豁免「.戰鬥位.」鍵片段；WORD 不再排除「戰鬥位置」
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { scanStrings, markupText, walkSrc } from './lib/src-string-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.571。
const BASE_SHA = 'dc2f8c79ed541ea22128abeb9f533cc3f75436ed';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ⭐審查 P3-3：src 已經沒有「戰鬥位置」這個詞 ⇒ 不再排除（原本 /戰鬥位(?!置)/ 會放過「戰鬥位＋置中」這種組合）
const WORD = /戰鬥位/;
// 例外：ai-eval.ts 的試算差異鍵（`p${n}.戰鬥位.${k}` 這種內部除錯字串，不會出現在玩家畫面；test-v6430 在用）
//   ⭐審查 P3-2：只豁免那一段「.戰鬥位.」鍵片段，不豁免整個檔（之後在 ai-eval.ts 新增玩家看得到的字串照樣會抓）
const ALLOW_KEY = (rel, t) => rel === 'src/lib/game/ai-eval.ts' && t === '.戰鬥位.';
const FILES = walkSrc(join(ROOT, 'src'));

function scenS(read) {
  const str = [], mk = [];
  let n = 0;
  for (const p of FILES) {
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    const src = read(rel);
    if (src == null) continue;
    n++;
    scanStrings(src, rel, (t, line) => { if (WORD.test(t) && !ALLOW_KEY(rel, t)) str.push(rel + ':' + line + ' ' + t.slice(0, 60)); });
    const m = markupText(src, rel);
    if (WORD.test(m)) mk.push(rel + ' ' + (m.match(/.{0,20}戰鬥位(?!置).{0,20}/) || [''])[0]);
  }
  return { S1: n > 200 && str.length === 0, S1n: JSON.stringify({ n, hits: str.slice(0, 6), total: str.length }),
    S2: mk.length === 0, S2n: JSON.stringify(mk.slice(0, 6)) };
}
function scenS3() {
  // ⭐審查 P3-1：正對照要涵蓋「有插值的模板字串（中段、巢狀）」與「regex 字面不算字串」—— 否則掃描器漏掃模板／把 regex 當字串時本支照樣綠
  const a = []; scanStrings("// 戰鬥位（註解不算）\naddLog(s, '對手戰鬥位的能量'); const t = `留在戰鬥位`; const u = `對手${x}戰鬥位${`巢狀戰鬥位`}`; const r = a / b; const q = /'戰鬥位'/.test(z);", 'x.ts', (t) => { if (WORD.test(t)) a.push(t); });
  const m = markupText('<script>const x = 1;</script><!-- 戰鬥位 --><p title="戰鬥位">戰鬥位置中</p>', 'x.svelte');
  const okA = JSON.stringify(a) === JSON.stringify(['對手戰鬥位的能量', '留在戰鬥位', '戰鬥位', '巢狀戰鬥位']);
  return { S3: okA && WORD.test(m) && !WORD.test(markupText('<!-- 戰鬥位 --><p>戰鬥場置中</p>', 'x.svelte'))
      && !ALLOW_KEY('src/lib/game/ai-eval.ts', '留在戰鬥位') && ALLOW_KEY('src/lib/game/ai-eval.ts', '.戰鬥位.') && !ALLOW_KEY('src/lib/game/effects.ts', '.戰鬥位.'),
    S3n: JSON.stringify({ a, m }) };
}
function scenW(read) {
  const e = read('src/lib/game/effects.ts') ?? '', m5 = read('src/lib/game/effects/cards/m5_preview.ts') ?? '', pg = read('src/routes/game/+page.svelte') ?? '';
  return {
    W1: e.includes("choiceNoLabel: '否（留在戰鬥場）'") && e.includes('已昏厥的戰鬥寶可夢）') && e.includes('反轉之風：選擇 0∼${cap} 個對手的戰鬥寶可夢身上的能量放回對手手牌')
      && m5.includes("'介秒迴轉：戰鬥寶可夢與備戰寶可夢互換完成'") && m5.includes("'破壞頭錘：丟棄對手的戰鬥寶可夢身上的 1 個能量'") && m5.includes("'水迴旋：自身已不在戰鬥場'") && pg.includes('・桌墊版 = 仿實體 TCG — 戰鬥場置中'),
  };
}
const LABEL = {
  S1: '★★★ S1 src 所有字串（對戰紀錄、picker 標題、按鈕）不再出現「戰鬥位」（ai-eval.ts 內部除錯鍵除外）',
  S2: '★★★ S2 頁面畫面文字（模板、屬性）不再出現「戰鬥位」',
  S3: '★★ S3 掃描器正對照：字串與畫面裡的違規抓得到；註解、「戰鬥位置」不算',
  W1: '★★ W1 用詞抽查：位置說「戰鬥場」、寶可夢說「戰鬥寶可夢」',
};
const ZERO = new Set(['S3']);   // P3-3 起 S2 不再排除「戰鬥位置」⇒ BASE 的「戰鬥位置中」會讓 S2 紅（HEAD-FAIL）
const rd = (rel) => { try { return normEol(readFileSync(join(ROOT, rel), 'utf8')); } catch { return null; } };
const all = (read) => ({ ...scenS(read), ...scenS3(), ...scenW(read) });
const R = all(rd);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);
console.log('【H】HEAD-FAIL（BASE v6.571）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6572 HEAD-FAIL', '需要歷史 commit');
else {
  const B = all((rel) => { const x = readBaseBlob(ROOT, BASE_SHA, rel); return x.ok ? normEol(x.out) : null; });
  for (const k of Object.keys(LABEL)) {
    if (ZERO.has(k)) ok(`★★[正對照] v6.571：${k} 在 BASE 上也是綠`, B[k] === true, B[k + 'n']);
    else ok(`★★★[H] v6.571：${k} 紅`, B[k] !== true, String(B[k + 'n'] ?? '').slice(0, 160));
  }
}
console.log(`\n=== v6.572 「戰鬥位」→「戰鬥場／戰鬥寶可夢」：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
