// ⭐ v6.318／v6.319／v6.320 守衛：中央 helper scripts/lib/strip-markup-sections.mjs 自身先驗（Rule 25）
//
// ── 這支在守什麼 ────────────────────────────────────────────────────────────
//   「單趟行級狀態機：HTML 註解只在模板層認；區段只在『行首』開、只在行首（或開頭同一行）收；
//    『行首』＝本行到此為止只有空白／BOM／已剝掉的註解或區段；模板層殘留的開頭標籤字面必須逐條對上 allowResidual」這個形狀。
//   同一支剝除器連續五版被突變推翻（v6.310 區塊正則／v6.311 行首整行丟／v6.316-317 先剝註解再抽區段／
//   v6.318 「行首」沒對齊 Svelte：BOM／同行註解／</div><style> 三種 Svelte 會編譯的形狀全被當模板 ⇒ sections=0 ⇒ 消費者假綠），
//   所以本檔**不信任檔頭的任何宣稱**，只信下面的突變有沒有紅：
//   【0】內嵌樣本＋**手算**已知答案（history-free，永不過期）；0-5～0-10 每一條都拿 svelte/compiler 的 parse() 當「Svelte 怎麼看」的裁判
//   【A】方向 A（v6.311/312/316 的老洞）：註解裡出現 <style>／</style> 字面 ⇒ 模板不可以被吃掉；v6.316 之前的順序必吃
//   【B】方向 B（v6.317 的洞）：script 內容裡出現 '<!--'／'-->' 字串 ⇒ import 不可以被吃掉；v6.317 的順序必吃
//   【C】方向 C（v6.318 的洞）：BOM／`<!-- x --><script>`／`</div><style>` ⇒ 前兩種必須抽得到區段、第三種必須紅在護欄⑦；
//        v6.318 的 OPEN 規則（pos===0 且不認 BOM）對三種都是 sections=0 且零殘留斷言 ⇒ 反面對照
//   【D】方向 D（v6.319 的洞，審查者行為端實證）：⛔-1 <style> 內 CSS 註解 `/*\n</style>\n*/` ⇒ helper 提前收尾、CSS 流進模板層，
//        v6.319 的三道網（護欄⑦只看開頭字面／minSections／比段數的裁判）全綠 ⇒ 現在必須紅在護欄⑧「收尾」；
//        ⛔-2 屬性值／表達式裡的 `<!--`（後面另有 -->）⇒ 區段連收尾一起被當註解吞掉 ⇒ 必須紅在護欄⑨「註解文字裡有 … 收尾字面」；
//        反面對照：v6.319 的 RESIDUAL_RE（只看開頭）對 ⛔-1 是 0 殘留、比段數的裁判對 ⛔-1 是 SAME ⇒ 證明是 ⑧⑨與範圍裁判在守
//   【1】固定 blob（v6.316）的已知答案表：由另一份 Python 實作（字元級掃描）獨立量出後手抄
//   【2】工作樹正反對照（不綁數字，永不過期）；⚠ 反對照字串必須在原檔存在（v6.317 的 '.prize-view-modal {' 恆真）
//   【3】事故重現（固定 blob 植入兩個方向的突變）
//   【4】護欄突變：未收尾／超長／單一註解比例／對照打錯字／區段下限／區段未收尾／巢狀／殘留白名單四種寫錯，各紅在指定訊息
//   【5】全站 .svelte／.html 實掃（⚠ 用 git ls-tree HEAD，不用 ls-files：本站用 plumbing 推版、.git/index 不更新）：
//        零炸、零未宣告殘留（唯一白名單＝game 的 {@html '<style>'}）、長度行數不變；
//        5-2 ⭐ 每支 .svelte 用 svelte/compiler parse() 當裁判（v6.320 改**範圍級**）：helper 每一段的 start/end/innerStart/innerEnd
//        必須與 Svelte 的 instance／module／css 逐位相同，helper 每一個 HTML 註解的 start/end 必須與 AST Comment 節點逐位相同
//        （⛔-1 範圍不同、⛔-2 註解位移不同 ⇒ 都紅；比段數的舊裁判對 ⛔-1 是綠的）。
//        唯一已知偏差：friends/+page.svelte 的 <svelte:head><style>（helper 多一段 style，釘死 LF 位移 3607–3704）——
//        Svelte 當 <svelte:head> 底下的模板元素（AST 裡是 RegularElement name=style、範圍同一個），helper 當區段；
//        行為端證明：test-v6293 A1 就是要抽這一段當「注入 head 的樣式」，沒有守衛拿 friends 頁的模板層或 style 內文守「不存在」。
//        5-3 ⭐ 把 ⛔-1 植入真檔（MobilePortraitBattle 的 <style> 之後）⇒ 範圍裁判必紅、比段數的舊裁判必綠（反面對照）
// ⚠⚠ 只捕捉 assert.AssertionError —— 其他例外必須直接炸掉。
// Run: node scripts/test-lib-strip-markup-sections.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { createRequire } from 'node:module';
// ⭐ v6.319：「Svelte 怎麼看」的裁判（devDependency，零新依賴）。走 CJS 單檔 bundle（compiler/index.js）：ESM 入口會拉一整棵相依樹，慢 100 倍。
const { parse: svelteParse, compile: svelteCompile } = createRequire(import.meta.url)('svelte/compiler');
import { templateOnly, sectionInner, markupSections, scanMarkup, scanMarkupChecked, nonWs, blankOut, GAME_INLINE_STYLE } from './lib/strip-markup-sections.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⭐ 固定 blob（v6.316）。這不是「pin 版本」—— blob 內容永不變，表也永不過期；淺複製時大聲 SKIP（不 fail-open）。
const FIXED_SHA = '8f8b378236e0477f4451b5c00fa93d0582bf2c71';
const P_GAME = 'src/routes/game/+page.svelte';
const P_MPB = 'src/routes/game/MobilePortraitBattle.svelte';
// 已知答案表：v6.318 由獨立的 Python 字元級掃描（re.sub(r'\s','') ＋ utf-16-le 長度）量出後手抄；
//   ⚠ 不可以拿 helper 算出來再寫回去。（這兩個 blob 的腳本裡沒有 '<!--' 字面 ⇒ 數字與 v6.317 的表相同，這是巧合不是恆等。）
const KNOWN = {
  [P_GAME]: { template: 184279, styleInner: 205952, scriptInner: 373083, styleSections: 1, scriptSections: 1, comments: 275 },
  [P_MPB]:  { template: 22587,  styleInner: 23495,  scriptInner: 24484,  styleSections: 1, scriptSections: 1, comments: 43 },
};

let pass = 0, fail = 0;
const T = (n, f) => {
  try { f(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const throwsRe = (fn, re, why) => assert.throws(fn, (e) => e instanceof assert.AssertionError && re.test(e.message), why);
/** Svelte 5 parse() 眼中的頂層區段數：script ＝ instance＋module、style ＝ css。 */
const svelteCounts = (src) => { const a = svelteParse(src, { modern: true }); return { script: (a.instance ? 1 : 0) + (a.module ? 1 : 0), style: a.css ? 1 : 0 }; };
const helperCounts = (src, opt = {}) => { const r = scanMarkupChecked(src, opt); return { script: r.sections.filter((x) => x.tag === 'script').length, style: r.sections.filter((x) => x.tag === 'style').length }; };
/** ⭐ v6.320 範圍級裁判：Svelte 5 parse() 眼中每一段頂層區段的 [start,end) 與內文 [innerStart,innerEnd)，依 start 排序。 */
const svelteRanges = (src) => {
  const a = svelteParse(src, { modern: true }); const out = [];
  for (const [tag, n] of [['script', a.instance], ['script', a.module], ['style', a.css]]) if (n) out.push({ tag, start: n.start, end: n.end, innerStart: n.content.start, innerEnd: n.content.end });
  return out.sort((x, y) => x.start - y.start);
};
/** Svelte 5 parse() 的 fragment 裡（含巢狀）每一個 HTML Comment 節點的 [start,end)，依 start 排序。⚠ script／style 內文裡的 <!-- 不是節點（與 helper 同判）。 */
const svelteComments = (src) => {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'Comment') out.push({ start: n.start, end: n.end });
    for (const k of Object.keys(n)) { if (k === 'metadata' || k === 'parent') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); }
  })(svelteParse(src, { modern: true }).fragment);
  return out.sort((x, y) => x.start - y.start);
};
const helperRanges = (r) => r.sections.map((s) => ({ tag: s.tag, start: s.start, end: s.end, innerStart: s.innerStart, innerEnd: s.innerEnd }));
const helperComments = (r) => r.comments.map((c) => ({ start: c.start, end: c.end }));
/** v6.319 的護欄⑦：只看**開頭**字面的殘留數（在 scanMarkup 的模板層上算）——只當方向 D 的反面對照。 */
const v6319Residual = (src) => [...scanMarkup(src).template.matchAll(/<(script|style)\b/gi)].length;
/** v6.319 的 5-2 裁判：只比**段數**——只當方向 D 的反面對照。 */
const v6319CountJudgeSame = (src) => { const r = scanMarkup(src); const h = { script: r.sections.filter((x) => x.tag === 'script').length, style: r.sections.filter((x) => x.tag === 'style').length }; return JSON.stringify(h) === JSON.stringify(svelteCounts(src)); };
const compiles = (src) => { try { svelteCompile(src, { generate: 'client' }); return true; } catch { return false; } };
/** v6.318 的 OPEN 規則（只在 pos===0、不認 BOM；同行註解之後不再看；同行第二段不再看）——回傳認到的 tag 清單，只當方向 C 的反面對照。 */
function v6318Tags(src) {
  const OPEN2 = new RegExp('^[ \\t]*<(script|style)\\b', 'i');
  const tags = []; let inCmt = false;
  for (const line of src.split('\n')) {
    if (inCmt) { if (line.includes(CC)) inCmt = false; continue; }
    const m = line.match(OPEN2);
    if (m) { tags.push(m[1].toLowerCase()); continue; }
    const c = line.indexOf(CO); if (c >= 0 && line.indexOf(CC, c) < 0) inCmt = true;
  }
  return tags;
}

// 兩個歷史事故的形狀，只用來當反面對照，不可拿去守東西。
const S = '<' + 'script', SS = '<\\/' + 'script>', Y = '<' + 'style', YY = '<\\/' + 'style>';
const CO = '<!' + '--', CC = '--' + '>';
/** v6.316 之前（test-v6190 原寫法）：先區段、最後才剝註解；區段開頭不限行首。 */
function preV6316Order(src) {
  let t = src;
  t = blankOut(t, new RegExp(S + '[\\s\\S]*?' + SS, 'g'));
  t = blankOut(t, new RegExp(Y + '[\\s\\S]*?' + YY, 'g'));
  t = blankOut(t, new RegExp(CO + '[\\s\\S]*?' + CC, 'g'));
  return t;
}
/** v6.317：先把 HTML 註解全文空白化（連腳本裡的也剝）、再抽行首開頭的 script 區段內文。 */
function v6317ScriptInner(src) {
  const t = blankOut(src, new RegExp(CO + '[\\s\\S]*?' + CC, 'g'));
  return [...t.matchAll(new RegExp('^[ \\t]*' + S + '\\b[^>]*>([\\s\\S]*?)' + SS, 'gm'))].map((m) => m[1]).join('\n');
}

console.log('【0】內嵌樣本＋手算答案');
// 第 1 行腳本、第 2 行模板、第 3 行註解（提到樣式標籤字面）、第 4 行模板含字串字面、第 5 行真樣式
const FX1 = [
  '<script>let a = 1;</script>',
  'A{#if x}B{/if}',
  CO + ' 提到 ' + Y + '> 字面 {#if y}zz{/if} ' + CC,
  "C{@html '" + Y + '>x' + '</' + "style>'}",
  '<style>.q{color:red}</style>',
].join('\n');
const FX1_ALLOW = ["C{@html '<style>x</style>'}"];   // 第 4 行的字串字面整串（v6.319 起必須宣告、v6.320 起收尾也要在宣告範圍內，見 0-9／4-9）
T('0-1 templateOnly：手算答案 39（第 2 行 13 ＋ 第 4 行 26），長度／行數不變，模板標記只剩正文那一組', () => {
  const out = templateOnly(FX1, { label: 'FX1', minSections: 1, allowResidual: FX1_ALLOW });
  assert.strictEqual(nonWs(out), 39, '非空白字元數 ' + nonWs(out));
  assert.strictEqual(out.length, FX1.length);
  assert.strictEqual(out.split('\n').length, 5);
  assert.strictEqual((out.match(/\{#if/g) || []).length, 1, '註解裡的區塊標記沒剝掉／正文的被剝掉');
  assert.ok(/\{#if x\}/.test(out) && !/let a = 1/.test(out) && !/color:red/.test(out));
});
T('0-2 sectionInner：style 內文 ".q{color:red}"、script 內文 "let a = 1;"；字串字面裡的標籤不是區段（前面有正文），但必須宣告 allowResidual', () => {
  assert.strictEqual(sectionInner(FX1, 'style', { minSections: 1, allowResidual: FX1_ALLOW }), '.q{color:red}');
  assert.strictEqual(sectionInner(FX1, 'script', { minSections: 1, allowResidual: FX1_ALLOW }), 'let a = 1;');
  assert.strictEqual(markupSections(FX1, 'style', { allowResidual: FX1_ALLOW }).sections.length, 1);
  throwsRe(() => markupSections(FX1, 'style'), /殘留 2 處 .*開頭 1／收尾 1.*第 4 行開頭「<style>x/, '不宣告就必須紅');
  throwsRe(() => markupSections(FX1, 'style', { allowResidual: ["C{@html '<style>"] }), /殘留 1 處 .*開頭 0／收尾 1.*第 4 行收尾「<\/style>'\}」/, 'v6.319 只蓋開頭的短宣告 ⇒ 收尾字面仍紅（護欄⑧）');
});
T('0-3 行首允許前導空白／tab：縮排的單行樣式（friends 頁 svelte:head 那種）算一段', () => {
  const fx = '<script>x</script>\n<svelte:head>\n\t<style>html{margin:0}</style>\n</svelte:head>\n<p>T</p>\n<style>.a{b:c}</style>';
  const r = markupSections(fx, 'style', { minSections: 2 });
  assert.deepStrictEqual(r.sections.map((s) => s.inner), ['html{margin:0}', '.a{b:c}']);
  assert.ok(templateOnly(fx).includes('<p>T</p>'));
});
T('0-4 屬性跨行的開頭標籤／大寫標籤／自閉合／CRLF：各算對，長度行數不變', () => {
  const fx = '<script\n  lang="ts"\n>\nlet a = 1;\n</script>\n<p>T</p>\n<STYLE>\n.q{c:d}\n</STYLE>\n<script src="x" />\n<p>U</p>';
  const r = scanMarkupChecked(fx);
  assert.deepStrictEqual(r.sections.map((s) => s.tag + '@' + s.line), ['script@1', 'style@7', 'script@10']);
  assert.strictEqual(r.sections[0].inner, '\nlet a = 1;\n');
  assert.strictEqual(r.sections[2].inner, '');
  assert.strictEqual(nonWs(r.template), 16, '<p>T</p> ＋ <p>U</p> ＝ 8 ＋ 8');
  const crlf = fx.replace(/\n/g, '\r\n');
  const rc = scanMarkupChecked(crlf);
  assert.strictEqual(rc.template.length, crlf.length);
  assert.strictEqual(rc.template.split('\n').length, crlf.split('\n').length);
  assert.strictEqual(nonWs(rc.template), 16);
  assert.strictEqual(rc.sections.length, 3);
});
T('0-5 巢狀在元素裡的 <div><style>…</style></div>：Svelte parse() 說 css 只有 1 段（巢狀那段在 fragment）⇒ 但它是殘留字面，未宣告 ⇒ 護欄⑦紅；宣告 allowResidual 後只剝一種 tag 時另一種原樣留著', () => {
  const fx = '<script>s</script>\n<div><style>.x{}</style></div>\n<style>.y{}</style>';
  assert.deepStrictEqual(svelteCounts(fx), { script: 1, style: 1 }, 'Svelte 對巢狀 <style> 的判定變了？');
  throwsRe(() => markupSections(fx, 'style'), /殘留 2 處 .*第 2 行開頭「<style>\.x\{\}<\/style><\/div>」；第 2 行收尾「<\/style><\/div>」/);
  const allow = ['<div><style>.x{}</style>'];
  assert.deepStrictEqual(helperCounts(fx, { allowResidual: allow }), svelteCounts(fx));
  assert.ok(templateOnly(fx, { allowResidual: allow }).includes('<div><style>.x{}</style></div>'));
  const onlyScript = templateOnly(fx, { tags: ['script'], allowResidual: allow });
  assert.ok(onlyScript.includes('<style>.y{}</style>') && !onlyScript.includes('s</script>'));
});
T('0-6 ⭐ 檔首 BOM：\\uFEFF<script lang="ts"> 是區段（Svelte parse() 同判 instance=1）；BOM 原樣留在模板層、長度不變；v6.318 規則抽到 0 段', () => {
  const fx = '\uFEFF<script lang="ts">\n  import X from "./X.svelte";\n  let a: number = 1;\n</script>\n<p>{a}</p>\n';
  assert.deepStrictEqual(svelteCounts(fx), { script: 1, style: 0 });
  assert.deepStrictEqual(helperCounts(fx), { script: 1, style: 0 });
  assert.ok(sectionInner(fx, 'script', { minSections: 1 }).includes('import X from'));
  const t = templateOnly(fx);
  assert.strictEqual(t.charCodeAt(0), 0xFEFF, 'BOM 應原樣留在模板層');
  assert.strictEqual(t.length, fx.length);
  assert.strictEqual(nonWs(t), 10, '<p>{a}</p> ＝ 3＋3＋4');
  assert.deepStrictEqual(v6318Tags(fx), [], '反面對照：v6.318 的規則應該認不到 BOM 後的 <script>');
});
T('0-7 ⭐ 同一行 HTML 註解之後的 <!-- x --><script>：是區段（Svelte 同判）、同行的 import 抽得到；v6.318 規則抽到 0 段', () => {
  const fx = CO + ' x ' + CC + '<script lang="ts">import X from "./X.svelte";\n  let a: number = 1;\n</script>\n<p>{a}</p>\n';
  assert.deepStrictEqual(svelteCounts(fx), { script: 1, style: 0 });
  assert.deepStrictEqual(helperCounts(fx), { script: 1, style: 0 });
  const inner = sectionInner(fx, 'script', { minSections: 1 });
  assert.ok(inner.startsWith('import X from'), '同行 import 沒抽到：' + JSON.stringify(inner.slice(0, 30)));
  assert.strictEqual(scanMarkupChecked(fx).comments.length, 1);
  assert.strictEqual(nonWs(templateOnly(fx)), 10);
  assert.deepStrictEqual(v6318Tags(fx), [], '反面對照');
  // 多行註解收尾之後接 <style> 也一樣
  const fx2 = '<script>x</script>\n' + CO + '\n' + Y + '> 註解裡的字面\n' + CC + '<style>.q{a:b}</style>\n<p>T</p>';
  assert.deepStrictEqual(svelteCounts(fx2), { script: 1, style: 1 });
  assert.strictEqual(sectionInner(fx2, 'style', { minSections: 1 }), '.q{a:b}');
});
T('0-8 ⭐ 頂層但接在 </div> 後面的 </div><style>：Svelte 當 css（合法）、本站禁用 ⇒ helper 不認、護欄⑦必須紅（fail-closed，不可以靜默當模板）', () => {
  const fx = '<script>let a = 1;</script>\n<div class="hidden">{a}</div><style>.hidden{display:none}</style>\n';
  assert.deepStrictEqual(svelteCounts(fx), { script: 1, style: 1 }, 'Svelte 對 </div><style> 的判定變了？那本條的前提就變了');
  throwsRe(() => scanMarkupChecked(fx), /殘留 2 處 .*第 2 行開頭「<style>\.hidden\{display:none\}<\/style>」；第 2 行收尾「<\/style>」/);
  throwsRe(() => sectionInner(fx, 'style'), /殘留 2 處/);
  throwsRe(() => templateOnly(fx), /殘留 2 處/);
  // 同型：<div>hi</div><script>（Svelte 當 instance）也一樣紅，不會變成「零 import」（開頭在第 1 行、收尾在第 3 行）
  throwsRe(() => sectionInner('<div>hi</div><script>\n  import X from "./X.svelte";\n</script>\n', 'script'), /殘留 2 處 <script／<style 標籤字面（開頭 1／收尾 1.*第 1 行開頭「<script>」；第 3 行收尾「<\/script>」/);
});
T('0-9 ⭐ 字串字面 {@html \'<style>…\'}：Svelte 放在 fragment（css=0）⇒ 剝除器當模板是對的，但必須用 allowResidual 宣告；宣告的字串要含標籤字面、在原檔恰一處、位置對得上', () => {
  const fx = "<script>let a = 1;</script>\n<svelte:head>\n  " + GAME_INLINE_STYLE + "\n</svelte:head>\n<p>{a}</p>\n";
  assert.ok(GAME_INLINE_STYLE.startsWith("{@html '<style>html, body {") && GAME_INLINE_STYLE.endsWith("</style>'}"), 'GAME_INLINE_STYLE 必須是含開頭與收尾的整串');
  assert.deepStrictEqual(svelteCounts(fx), { script: 1, style: 0 });
  throwsRe(() => templateOnly(fx), /殘留 2 處 .*第 3 行開頭「<style>html, body/);
  throwsRe(() => templateOnly(fx, { allowResidual: ["{@html '<style>html, body {"] }), /殘留 1 處 .*開頭 0／收尾 1.*第 3 行收尾「<\/style>'\}」/, 'v6.319 的短宣告只蓋開頭 ⇒ 收尾字面紅在護欄⑧');
  const out = templateOnly(fx, { allowResidual: [GAME_INLINE_STYLE] });
  assert.ok(out.includes(GAME_INLINE_STYLE), '宣告過的字面應原樣留在模板層');
  assert.deepStrictEqual(helperCounts(fx, { allowResidual: [GAME_INLINE_STYLE] }), { script: 1, style: 0 });
});
T('0-10 同一行兩個區段 <script module>…</script><script>…</script>：Svelte module＋instance ＝ 2；helper 也 2（前一段剝掉之後仍算「行首」）；v6.318 規則只認 1', () => {
  const fx = '<script module>export const M = 1;</script><script>import X from "./X.svelte"; let a = 1;</script>\n<p>{a}</p>\n';
  assert.deepStrictEqual(svelteCounts(fx), { script: 2, style: 0 });
  assert.deepStrictEqual(helperCounts(fx), { script: 2, style: 0 });
  assert.ok(sectionInner(fx, 'script', { minSections: 2 }).includes('import X from'));
  assert.deepStrictEqual(v6318Tags(fx), ['script'], '反面對照：v6.318 只認同一行的第一段');
});

console.log('【A】方向 A：註解裡出現區段標籤字面 ⇒ 模板不可以被吃掉');
const FXA = [
  '<script>let a = 1;</script>',
  CO,
  '<style>',
  '  ↑ 註解裡行首的樣式開頭標籤字面（沒有收尾字面）；再提一次 ' + Y + '>',
  CC,
  '<div>{#if x}BIG TEMPLATE{/if}</div>',
  '<style>.q{color:red}</style>',
].join('\n');
T('A-1 手算：模板 33（第 6 行）；註解 1 段 4 行；區段 script 1／style 1（註解裡行首的那個標籤不算）', () => {
  const r = scanMarkupChecked(FXA);
  assert.strictEqual(nonWs(templateOnly(FXA, { minSections: 1 })), 33);
  assert.deepStrictEqual(r.comments.map((c) => c.line + ':' + c.lines), ['2:4']);
  assert.deepStrictEqual(r.sections.map((s) => s.tag + '@' + s.line), ['script@1', 'style@7']);
  assert.strictEqual(sectionInner(FXA, 'style'), '.q{color:red}');
});
T('A-2 反面對照：v6.316 之前的順序從註解裡的標籤字面一路吃到真收尾，只剩 4（註解開頭那四個字）≠ 33 ⇒ 方向 A 是被守住的，不是剛好對', () => {
  assert.strictEqual(nonWs(preV6316Order(FXA)), 4);
});

console.log('【B】方向 B：script 內容裡出現註解字面字串 ⇒ import 不可以被吃掉');
const IMPORT_LINE = "  import DmPanel from '../friends/DmPanel.svelte';";
const FXB = [
  '<script lang="ts">',
  "  const __cmtOpen = '" + CO + "';",
  IMPORT_LINE,
  "  const __cmtClose = '" + CC + "';",
  '</script>',
  '<p>{__cmtOpen}</p>',
  '<style>.q{color:red}</style>',
].join('\n');
T('B-1 sectionInner(script) 三行原樣都在（含 import）；模板手算 18（<p>{__cmtOpen}</p>）；註解 0 段', () => {
  const inner = sectionInner(FXB, 'script', { minSections: 1, mustKeep: [IMPORT_LINE] });
  assert.strictEqual(inner.split('\n').filter((l) => l.trim()).length, 3);
  assert.strictEqual(nonWs(templateOnly(FXB, { minSections: 1 })), 18);
  assert.strictEqual(scanMarkupChecked(FXB).comments.length, 0);
});
T('B-2 反面對照：v6.317 的順序（先把註解全文空白化）抽出來的 script 內文**沒有** import 那一行 ⇒ 方向 B 是被守住的', () => {
  assert.ok(!v6317ScriptInner(FXB).includes('DmPanel'), 'v6.317 的順序居然留住了 import？反面對照失效');
  assert.ok(sectionInner(FXB, 'script').includes('DmPanel'));
});
T('B-3 反過來：模板層的 <!-- 仍是註解（B 不是把註解剝除整個關掉）', () => {
  const fx = '<script>x</script>\n' + CO + ' {#if y}zz{/if} ' + CC + '\n<p>{#if x}T{/if}</p>';
  assert.strictEqual((templateOnly(fx).match(/\{#if/g) || []).length, 1);
});

console.log('【C】方向 C：Svelte 認得、v6.318 認不到的三種開頭 ⇒ 不可以靜默變成「零區段」');
const FXC_IMPORT = "import DmPanel from '../friends/DmPanel.svelte';";
const FXC = {
  bom: '\uFEFF<script lang="ts">\n  ' + FXC_IMPORT + '\n</script>\n<div>{#if x}T{/if}</div>\n<style>.q{c:d}</style>\n',
  cmt: CO + ' x ' + CC + '<script lang="ts">' + FXC_IMPORT + '\n</script>\n<div>{#if x}T{/if}</div>\n<style>.q{c:d}</style>\n',
  div: '<script lang="ts">\n  ' + FXC_IMPORT + '\n</script>\n<div>{#if x}T{/if}</div><style>.q{c:d}</style>\n',
};
T('C-1 三種形狀 Svelte parse() 都是 script 1＋style 1（前提）；v6.318 規則：bom／cmt 只認得 style（script 段＝0 ⇒ 零 import）、div 只認得 script ⇒ 反面對照成立', () => {
  for (const k of Object.keys(FXC)) assert.deepStrictEqual(svelteCounts(FXC[k]), { script: 1, style: 1 }, k);
  assert.deepStrictEqual([v6318Tags(FXC.bom), v6318Tags(FXC.cmt), v6318Tags(FXC.div)], [['style'], ['style'], ['script']]);
});
T('C-2 bom／cmt：helper 抽到 script 1＋style 1、import 那行在 script 內文裡、模板手算 23（<div>{#if x}T{/if}</div> ＝ 5＋6＋1＋5＋6）', () => {
  for (const k of ['bom', 'cmt']) {
    assert.deepStrictEqual(helperCounts(FXC[k]), { script: 1, style: 1 }, k);
    assert.ok(sectionInner(FXC[k], 'script', { minSections: 1, mustKeep: [FXC_IMPORT] }).includes('DmPanel'), k);
    assert.strictEqual(nonWs(templateOnly(FXC[k], { minSections: 1 })), 23, k);
  }
});
T('C-3 div：helper 不認那段 style（前面有 </div>）⇒ 不是靜默當模板，而是紅在護欄⑦「殘留」；sectionInner(script) 也紅（同一道護欄，呼叫哪個 tag 都擋）', () => {
  throwsRe(() => sectionInner(FXC.div, 'style'), /殘留 2 處 <script／<style 標籤字面（開頭 1／收尾 1.*第 4 行開頭「<style>\.q\{c:d\}/);
  throwsRe(() => sectionInner(FXC.div, 'script'), /殘留 2 處/);
  throwsRe(() => templateOnly(FXC.div), /殘留 2 處/);
});

console.log('【D】方向 D（v6.319 的洞）：區段被提前收尾／被註解吞掉 ⇒ 不可以靜默變成模板');
// ⛔-1：<style> 裡的 CSS 註解，第 3 行的 </style> 在註解內。Svelte read_style 先吃 /* … */ 再找 </style ⇒ css 是完整 7 行；helper 在第 3 行收尾。
const FXD1 = ['<script>let a = 1;</script>', '<p class="a">T</p>', '<style>', '/*', '</' + 'style>', '*/', '.a{color:red}', '@media (max-width:600px){.a{color:blue}}', '</style>', ''].join('\n');
T('D-1 ⛔-1 前提：Svelte 5 compile() 成功、css 範圍 [47,133)、內文含 @media；helper 的 style 段在第 3 行就收尾（[47,66)）⇒ @media 流進模板層', () => {
  assert.ok(compiles(FXD1), 'Svelte 對 CSS 註解裡的 </style> 的判定變了？那本條的前提就變了');
  assert.deepStrictEqual(svelteRanges(FXD1), [{ tag: 'script', start: 0, end: 27, innerStart: 8, innerEnd: 18 }, { tag: 'style', start: 47, end: 133, innerStart: 54, innerEnd: 125 }]);
  const raw = scanMarkup(FXD1);   // 無護欄的純掃描：看「洞」本身
  assert.deepStrictEqual(helperRanges(raw)[1], { tag: 'style', start: 47, end: 66, innerStart: 54, innerEnd: 58 }, 'helper 的 style 段範圍');
  assert.ok(raw.template.includes('@media (max-width:600px)'), '@media 應已流進模板層（這就是洞）');
});
T('D-2 ⛔-1 ⭐ 修後必須紅在護欄⑧「殘留 … 收尾」（第 9 行的真 </style>）—— sectionInner／templateOnly／markupSections 哪個入口都紅', () => {
  const re = /殘留 1 處 <script／<style 標籤字面（開頭 0／收尾 1；不在 allowResidual 裡）：第 9 行收尾「<\/style>」.*提前收尾/;
  throwsRe(() => scanMarkupChecked(FXD1), re);
  throwsRe(() => sectionInner(FXD1, 'style', { minSections: 1 }), re);
  throwsRe(() => templateOnly(FXD1, { minSections: 1 }), re);
  throwsRe(() => markupSections(FXD1, 'script', { minSections: 1 }), re);
});
T('D-3 ⛔-1 反面對照：v6.319 的三道網對它全綠 —— 護欄⑦（只看開頭）殘留 0、段數 style=1 滿足 minSections:1、比段數的裁判 SAME；範圍級裁判 DIFF', () => {
  assert.strictEqual(v6319Residual(FXD1), 0, 'v6.319 的殘留規則居然紅了？反面對照失效');
  assert.strictEqual(scanMarkup(FXD1).sections.filter((x) => x.tag === 'style').length, 1);
  assert.strictEqual(v6319CountJudgeSame(FXD1), true, '比段數的裁判居然分得出來？反面對照失效');
  assert.notDeepStrictEqual(helperRanges(scanMarkup(FXD1)), svelteRanges(FXD1), '範圍級裁判必須分得出來');
});
T('D-4 ⛔-1 同型：<style> 裡的 HTML 註解 <!-- </style> -->（Svelte read_style 也跳過它）⇒ 同樣紅在護欄⑧', () => {
  const fx = '<script>x</script>\n<style>\n' + CO + '\n</' + 'style>\n' + CC + '\n.a{c:d}\n</style>\n';
  assert.ok(compiles(fx));
  assert.strictEqual(svelteRanges(fx)[1].end, fx.length - 1);
  throwsRe(() => scanMarkupChecked(fx), /殘留 1 處 .*開頭 0／收尾 1.*第 7 行收尾「<\/style>」/);
});
// ⛔-2：模板屬性值／表達式裡的 <!--（Svelte 當屬性值、AST Comment 不含它）；檔案後面另有 --> ⇒ helper 把中間的區段當註解吞掉
const D2_MID = ['<p title="' + CO + '">T</p>', "<p>{'" + CO + "'}</p>", '<p data-x="' + CO + '">T</p>'];
const D2_IMPORT = 'import X from "./X.svelte";';
const d2ScriptAfter = (mid) => mid + '\n<script>' + D2_IMPORT + '</script>\n' + CO + ' x ' + CC + '\n<style>.a{c:d}</style>\n';   // script 在後、被吞
const d2StyleAfter = (mid) => '<script>' + D2_IMPORT + '</script>\n' + mid + '\n<style>.a{c:d}</style>\n' + CO + ' 尾註解 ' + CC + '\n';   // style 在後、被吞
const d2NoClose = (mid) => '<script>' + D2_IMPORT + '</script>\n' + mid + '\n<style>.a{c:d}</style>\n';                                 // 後面沒有 --> ⇒ 護欄①
T('D-5 ⛔-2 前提：三種形狀 × 三種排列 Svelte 5 compile() 都成功、AST 的 Comment 節點只有那個真註解（或 0 個）；helper 純掃描把區段吞進註解（段數少一段、模板層零開頭殘留）', () => {
  for (const mid of D2_MID) {
    for (const [k, mk] of [['scriptAfter', d2ScriptAfter], ['styleAfter', d2StyleAfter], ['noClose', d2NoClose]]) {
      const fx = mk(mid);
      assert.ok(compiles(fx), k + ' ' + mid);
      assert.strictEqual(svelteRanges(fx).length, 2, k + ' ' + mid + '：Svelte 應看到 script＋style');
      assert.strictEqual(svelteComments(fx).length, k === 'noClose' ? 0 : 1, k + ' ' + mid + '：AST Comment 節點數');
      if (k !== 'noClose') {
        const raw = scanMarkup(fx);
        assert.strictEqual(raw.sections.length, 1, k + ' ' + mid + '：helper 純掃描應少一段（被吞）');
        assert.strictEqual(v6319Residual(fx), 0, k + ' ' + mid + '：v6.319 的護欄⑦對它是 0 殘留（反面對照）');
        assert.strictEqual(raw.comments.length, 1);
        assert.notDeepStrictEqual(helperComments(raw), svelteComments(fx), k + ' ' + mid + '：範圍級裁判（註解位移）必須分得出來');
      }
    }
  }
});
T('D-6 ⛔-2 ⭐ 修後：後面有 --> 的六種 ⇒ 紅在護欄⑨「註解文字裡有 … 收尾字面」（指出被吞的那段）；後面沒有 --> 的三種 ⇒ 紅在護欄①「沒有收尾」', () => {
  for (const mid of D2_MID) {
    throwsRe(() => sectionInner(d2ScriptAfter(mid), 'script', { minSections: 1 }), /第 1 行開的 HTML 註解文字裡有 <\/script／<\/style 收尾字面（第 2 行「<\/script>」）⇒ 這段「註解」吞掉了一整段區段/, mid);
    throwsRe(() => templateOnly(d2ScriptAfter(mid)), /註解文字裡有 .*收尾字面（第 2 行「<\/script>」）/, mid);
    throwsRe(() => sectionInner(d2StyleAfter(mid), 'style', { minSections: 1 }), /第 2 行開的 HTML 註解文字裡有 .*收尾字面（第 3 行「<\/style>」）/, mid);
    throwsRe(() => templateOnly(d2NoClose(mid)), /第 2 行的 HTML 註解沒有收尾/, mid);
  }
});
T('D-7 護欄⑨的白名單：註解文字裡的收尾字面若以 allowResidual 宣告（含該字面、原檔恰一處）⇒ 放行；宣告了卻沒蓋到任何殘留 ⇒ 紅在「白名單過期」；開頭字面在註解裡不需宣告（方向 A 不變）', () => {
  const fx = '<script>x</script>\n' + CO + ' 這裡以前有 </' + 'style> 收尾字面 ' + CC + '\n<p>T</p>\n<style>.a{}</style>\n';
  throwsRe(() => templateOnly(fx), /第 2 行開的 HTML 註解文字裡有 .*收尾字面（第 2 行「<\/style> 收尾字面 -->」）/);
  assert.ok(templateOnly(fx, { allowResidual: ['以前有 </' + 'style> 收尾'] }).includes('<p>T</p>'));
  throwsRe(() => templateOnly(fx, { allowResidual: ['以前有 </' + 'style> 收尾', '<style>.a{}'] }), /allowResidual「<style>\.a\{\}…」沒有蓋到任何殘留.*白名單過期/);
  assert.strictEqual(scanMarkupChecked(FXA).comments.length, 1, '方向 A 的樣本（註解裡行首 <style> 開頭字面）仍不需宣告');
});

console.log('【1】固定 blob 已知答案表（獨立量測、手抄）');
const blobs = {};
for (const p of [P_GAME, P_MPB]) blobs[p] = readBaseBlob(ROOT, FIXED_SHA, p);
const haveBlobs = hasBaseCommit(ROOT, FIXED_SHA) && Object.values(blobs).every((r) => r.ok);
if (!haveBlobs) {
  shallowSkip('strip-markup-sections【1】【3】固定 blob 已知答案表', '【0】【A】【B】【2】【4】【5】是 history-free 的等價條件，仍在守');
} else {
  for (const p of [P_GAME, P_MPB]) {
    const src = blobs[p].out.replace(/\r\n/g, '\n');
    const k = KNOWN[p];
    const ar = p === P_GAME ? [GAME_INLINE_STYLE] : [];   // game 的 {@html '<style>'} 是全站唯一宣告的殘留字面
    T('1 ' + p + '：template=' + k.template + ' styleInner=' + k.styleInner + ' scriptInner=' + k.scriptInner + ' 區段各 1、註解 ' + k.comments, () => {
      assert.strictEqual(nonWs(templateOnly(src, { label: p, minSections: 1, allowResidual: ar })), k.template);
      const st = markupSections(src, 'style', { minSections: 1, allowResidual: ar }), sc = markupSections(src, 'script', { minSections: 1, allowResidual: ar });
      assert.strictEqual(st.sections.length, k.styleSections);
      assert.strictEqual(sc.sections.length, k.scriptSections);
      assert.strictEqual(nonWs(sectionInner(src, 'style', { allowResidual: ar })), k.styleInner);
      assert.strictEqual(nonWs(sectionInner(src, 'script', { allowResidual: ar })), k.scriptInner);
      assert.strictEqual(scanMarkupChecked(src, { allowResidual: ar }).comments.length, k.comments);
      if (p === P_GAME) {
        throwsRe(() => templateOnly(src, { label: p }), /殘留 2 處 .*第 9842 行開頭「<style>html, body/, 'game 不宣告白名單就必須紅');
        throwsRe(() => templateOnly(src, { label: p, allowResidual: ["{@html '<style>html, body {"] }), /殘留 1 處 .*開頭 0／收尾 1.*第 9842 行收尾「<\/style>'\}」/, 'v6.319 的短宣告在 v6.320 必須紅在收尾（護欄⑧）');
      }
    });
  }
  console.log('【3】事故重現（固定 blob 植入兩個方向的突變）');
  T('3-A game：在 {@html} 那一行之後植入「提到樣式標籤字面」的註解 ⇒ v6.316 之前的順序剩不到 1%，helper 仍是 184279', () => {
    const src = blobs[P_GAME].out.replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const at = lines.findIndex((l) => l.includes("{@html '" + Y + '>'));
    assert.ok(at > 0, '找不到 {@html} 那一行');
    lines.splice(at + 1, 0, CO + ' 註解提到 ' + Y + '> 字面 ' + CC);
    const inj = lines.join('\n');
    const old = nonWs(preV6316Order(inj));
    assert.ok(old < KNOWN[P_GAME].template * 0.01, '舊順序沒有重現事故？剩 ' + old);
    assert.strictEqual(nonWs(templateOnly(inj, { minSections: 1, allowResidual: [GAME_INLINE_STYLE] })), KNOWN[P_GAME].template);
  });
  T('3-B game：腳本裡用 \'' + CO + '\'／\'' + CC + '\' 字串夾一行靜態 import DmPanel ⇒ helper 抽出的 script 內文含那一行；v6.317 的順序抽不到', () => {
    const src = blobs[P_GAME].out.replace(/\r\n/g, '\n');
    const anchor = "  import type { DmSession, DmSessionState } from '$lib/friends/dm-session';\n";
    assert.strictEqual(src.split(anchor).length - 1, 1, '錨點不唯一');
    const inj = src.replace(anchor, anchor + "  const __cmtOpen = '" + CO + "';\n" + IMPORT_LINE + "\n  const __cmtClose = '" + CC + "';\n");
    assert.ok(!v6317ScriptInner(inj).includes(IMPORT_LINE), 'v6.317 的順序居然抽得到？反面對照失效');
    const inner = sectionInner(inj, 'script', { minSections: 1, allowResidual: [GAME_INLINE_STYLE] });
    assert.ok(inner.includes(IMPORT_LINE), 'helper 抽出的 script 內文沒有那行 import');
    assert.strictEqual(nonWs(templateOnly(inj, { minSections: 1, allowResidual: [GAME_INLINE_STYLE] })), KNOWN[P_GAME].template, '模板數字也不可以變');
  });
  T('3-M MobilePortraitBattle：腳本收尾後植入同樣的註解 ⇒ 舊順序剩 8，helper 仍是 22587', () => {
    const src = blobs[P_MPB].out.replace(/\r\n/g, '\n');
    const inj = src.replace('</' + 'script>\n', '</' + 'script>\n' + CO + ' 註解提到 ' + Y + '> 字面 ' + CC + '\n');
    assert.notStrictEqual(inj, src);
    assert.strictEqual(nonWs(preV6316Order(inj)), 8);
    assert.strictEqual(nonWs(templateOnly(inj, { minSections: 1 })), KNOWN[P_MPB].template);
  });
}

console.log('【2】工作樹正反對照（不綁數字）');
T('2-1 game/+page.svelte：模板錨點 prizeViewOpen 還在、腳本 function openPrizeView 與樣式 .prize-view-modal{ 不見', () => {
  const src = readFileSync(join(ROOT, P_GAME), 'utf8');
  templateOnly(src, { label: P_GAME, minSections: 1, mustKeep: ['prizeViewOpen'], mustDrop: ['function openPrizeView', '.prize-view-modal{'], allowResidual: [GAME_INLINE_STYLE] });
});
T('2-2 MobilePortraitBattle.svelte：模板錨點 mp-clickable 還在、樣式 .mp-chip { 不見', () => {
  const src = readFileSync(join(ROOT, P_MPB), 'utf8');
  templateOnly(src, { label: P_MPB, minSections: 1, mustKeep: ['mp-clickable'], mustDrop: ['.mp-chip {'] });
});

console.log('【4】護欄突變（每一條各紅在指定訊息）');
T('4-1 未收尾的 HTML 註解 ⇒ 紅在「沒有收尾」', () => {
  throwsRe(() => templateOnly('<p>a</p>\n' + CO + ' x\n<p>b</p>'), /HTML 註解沒有收尾/);
});
T('4-2 超過 150 行的 HTML 註解 ⇒ 紅在「長達」', () => {
  throwsRe(() => templateOnly('<p>a</p>\n' + CO + '\n'.repeat(160) + CC + '\n<p>b</p>'), /長達 161 行/);
});
T('4-3 單一註解吃掉超過 40% 的模板層 ⇒ 紅在「吃掉了模板層」；分母不含 script（腳本再大也救不了它）；模板層 < 200 不談比例', () => {
  const P = '<p>' + 'a'.repeat(150) + '</p>';                              // 模板 158
  throwsRe(() => templateOnly(P + '\n' + CO + ' ' + 'x'.repeat(400) + ' ' + CC), /第 2 行開的 HTML 註解吃掉了模板層/);   // 400/558 = 72%
  const bigScript = '<script>\n' + 'y'.repeat(20000) + '\n</script>\n' + P + '\n' + CO + ' ' + 'x'.repeat(400) + ' ' + CC;
  throwsRe(() => templateOnly(bigScript), /吃掉了模板層/, '分母若含 script 這條就不會紅（v6.317 的無牙形狀）');
  // 五段各 ~30% 合計 ~150%：不是「單一」吃掉 ⇒ 不紅（friends/+page.svelte 那種合法形狀）
  const many = P + '\n' + Array(5).fill(CO + ' ' + 'x'.repeat(70) + ' ' + CC).join('\n');
  assert.ok(templateOnly(many).includes('a'.repeat(150)));
  // 模板層太小（< 200）：比例不套用，但未收尾／超長仍會炸
  assert.ok(templateOnly('<p>a</p>\n' + CO + ' ' + 'x'.repeat(100) + ' ' + CC).includes('<p>a</p>'));
  throwsRe(() => templateOnly('<p>a</p>\n' + CO + ' x'), /沒有收尾/);
});
T('4-4 mustKeep 找不到 ⇒ 紅在「正對照」；mustDrop 還在 ⇒ 紅在「還在」；⭐ 對照字串在原檔根本不存在 ⇒ 紅在「打錯字」（v6.317 恆真反對照）', () => {
  throwsRe(() => templateOnly(FX1, { mustKeep: ['NOT_THERE'], allowResidual: FX1_ALLOW }), /正對照「NOT_THERE」在原檔根本不存在/);
  throwsRe(() => templateOnly(FX1, { mustDrop: ['{#if x}'], allowResidual: FX1_ALLOW }), /「\{#if x\}」還在/);
  throwsRe(() => templateOnly(FX1, { mustDrop: ['.q{color:red}', 'THIS_STRING_NEVER_EXISTED_XYZ'], allowResidual: FX1_ALLOW }), /反對照「THIS_STRING_NEVER_EXISTED_XYZ」在原檔根本不存在/);
  throwsRe(() => templateOnly(FX1, { mustDrop: ['.q {color:red}'], allowResidual: FX1_ALLOW }), /反對照「\.q \{color:red\}」在原檔根本不存在/);
  throwsRe(() => sectionInner(FX1, 'style', { mustKeep: ['.q {'], allowResidual: FX1_ALLOW }), /正對照「\.q \{」在原檔根本不存在/);
});
T('4-5 minSections 抽不到 ⇒ 紅在「只找到」；空輸入 ⇒ 紅在「非空字串」；tag 亂給 ⇒ 紅', () => {
  throwsRe(() => sectionInner('<p>no style here</p>', 'style', { minSections: 1 }), /只找到 0 個 style 區段/);
  throwsRe(() => templateOnly('<p>no style here</p>', { minSections: 1 }), /只找到 0 個 script 區段/);
  throwsRe(() => scanMarkup(''), /非空字串/);
  throwsRe(() => sectionInner(FX1, 'div', { allowResidual: FX1_ALLOW }), /tag 只能是/);
});
T('4-6 區段未收尾（吃到檔尾）⇒ 紅在「沒有收尾」；多行區段的收尾不在行首 ⇒ 同樣不算收尾 ⇒ 紅', () => {
  throwsRe(() => templateOnly('<script>\nlet a = 1;\n<p>T</p>'), /<script> 區段沒有收尾/);
  throwsRe(() => templateOnly('<style>\n.q{}\n  x</' + 'style>\n<p>T</p>'), /<style> 區段沒有收尾/);
});
T('4-7 區段裡行首又開同一種標籤（上一段的收尾不在行首）⇒ 紅在「巢狀」', () => {
  throwsRe(() => templateOnly('<script>\nlet a = 1; </' + 'script>\n<p>T</p>\n<script>\nlet b = 2;\n</script>'), /第 4 行行首又開了 <script>/);
});
T('4-9 護欄⑦白名單四種寫錯各紅在指定訊息：沒宣告 ⇒「殘留」；宣告的字串不含標籤字面 ⇒「本身不含」；在原檔不是恰一處 ⇒「必須恰一處」；字面已經變成真區段 ⇒「白名單過期」；型別亂給 ⇒ 紅', () => {
  const fx = "<script>x</script>\n<p>{@html '<style>a</style>'}</p>\n";
  const A = "{@html '<style>a</style>'}";
  throwsRe(() => templateOnly(fx), /殘留 2 處 <script／<style 標籤字面（開頭 1／收尾 1；不在 allowResidual 裡）：第 2 行開頭「<style>a<\/style>'\}<\/p>」；第 2 行收尾「<\/style>'\}<\/p>」/);
  throwsRe(() => templateOnly(fx, { allowResidual: ['{@html'] }), /allowResidual「\{@html」本身不含/);
  throwsRe(() => templateOnly(fx, { allowResidual: ["{@html '<style>zzz"] }), /在原檔出現 0 次（必須恰一處）/);
  throwsRe(() => templateOnly(fx + fx.split('\n')[1] + '\n', { allowResidual: [A] }), /在原檔出現 2 次（必須恰一處）/);
  assert.ok(templateOnly(fx, { allowResidual: [A] }).includes(A));
  throwsRe(() => templateOnly(fx, { allowResidual: ["{@html '<style>"] }), /殘留 1 處 .*開頭 0／收尾 1.*第 2 行收尾「<\/style>'\}<\/p>」/, '只蓋開頭的短宣告 ⇒ 收尾仍紅');
  throwsRe(() => templateOnly('<script>x</script>\n<style>.a{}</style>\n', { allowResidual: ['<style>.a'] }), /allowResidual「<style>\.a…」沒有蓋到任何殘留標籤字面.*白名單過期/);
  throwsRe(() => templateOnly(fx, { allowResidual: 'oops' }), /allowResidual 必須是非空字串陣列/);
  // 位置要對得上：宣告的是第 2 行那個，殘留的卻是另一處 ⇒ 仍紅在「殘留」
  const fx2 = fx + "<p>{@html '<script>b</script>'}</p>\n";
  throwsRe(() => templateOnly(fx2, { allowResidual: [A] }), /殘留 2 處 .*第 3 行開頭「<script>b/);
});
T('4-8 反面對照：把 helper 改回「先剝註解再抽區段」⇒ 【B-1】必紅；改回「先區段最後註解」⇒ 【A-1】必紅', () => {
  assert.ok(!v6317ScriptInner(FXB).includes(IMPORT_LINE));
  assert.notStrictEqual(nonWs(preV6316Order(FXA)), 33);
  assert.ok(nonWs(preV6316Order(FXA)) < 10);
});

console.log('【5】全站 .svelte／.html 實掃');
// ⚠ v6.319：改用 `git ls-tree -r HEAD --name-only`。本站用 Python git plumbing 推版，**不會更新 .git/index**
//   （站長本機 index mtime 09-05 19:33 早於 HEAD commit 09-06 00:30）⇒ `ls-files` 讀的是舊 index，新增的 .svelte 會漏掃，
//   而「≥ 20 支」的下限擋不住少一兩支。同型缺口：scripts/test-bat-crlf.mjs 早就寫了同一條註記。
const listTracked = () => execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', 'HEAD', '--name-only'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\n').filter((f) => /\.(svelte|html)$/.test(f));
/** 全站唯一宣告的殘留白名單（呼叫端宣告；行為端證明見 5-2 的 parse() 比對與 0-9）。 */
const RESIDUAL_ALLOW = { [P_GAME]: [GAME_INLINE_STYLE] };
T('5-1 git ls-tree HEAD 的每一支 .svelte／.html 都掃得過（零炸、零未宣告殘留）、長度行數不變；Svelte 元件檔至少 1 段區段；四個 UI 主檔各恰 1 段 script＋1 段 style；body.html（BOM＋同行多段 <script src>）9 段 script 零殘留', () => {
  const files = listTracked();
  assert.ok(files.length >= 20, '只列到 ' + files.length + ' 支（v6.319 有 22 支）⇒ ls-tree 壞了？');
  assert.ok(files.includes(P_GAME) && files.includes('src/lib/friends/FriendsPanel.svelte') && files.includes('body.html'), '清單缺了已知的檔案：' + files.join(','));
  const both = new Set([P_GAME, P_MPB, 'src/routes/decks/+page.svelte', 'src/routes/deck-posts/+page.svelte']);
  let bodyScripts = -1;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    if (!src) continue;
    const r = scanMarkupChecked(src, { label: f, allowResidual: RESIDUAL_ALLOW[f] ?? [] });
    assert.strictEqual(r.template.length, src.length, f);
    assert.strictEqual(r.template.split('\n').length, src.split('\n').length, f);
    if (f.endsWith('.svelte')) assert.ok(r.sections.length >= 1, f + '：Svelte 元件沒抽到任何區段');
    if (both.has(f)) {
      assert.strictEqual(r.sections.filter((s) => s.tag === 'script').length, 1, f + ' script 區段數');
      assert.strictEqual(r.sections.filter((s) => s.tag === 'style').length, 1, f + ' style 區段數');
    }
    if (f === 'body.html') {
      bodyScripts = r.sections.filter((s) => s.tag === 'script').length;
      assert.strictEqual(src.charCodeAt(0), 0xFEFF, 'body.html 應以 BOM 開頭（v2.79 抓的官方站片段）—— 不是的話本條的「BOM 實檔」前提就沒了');
      assert.strictEqual(r.residual.length, 0, 'body.html 還有殘留：' + JSON.stringify(r.residual));
    }
  }
  assert.strictEqual(bodyScripts, 9, 'body.html 的 <script src> 應為 9 段（v6.318 只認得 3 段、其餘 6 段同一行的被當模板）');
});
T('5-2 ⭐ 每支 .svelte 用 svelte/compiler parse() 當**範圍級**裁判：helper 每段的 start/end/innerStart/innerEnd ＝ Svelte 的 instance／module／css；每個 HTML 註解的 start/end ＝ AST Comment 節點（唯一例外 friends/+page.svelte 的 <svelte:head><style>，釘死位移）', () => {
  // ⚠ 已知偏差（v6.319 站長裁定只報告不動、v6.320 釘成精確位移）：src/routes/friends/+page.svelte 第 83 行 <svelte:head> 底下縮排的
  //   `<style>html, body { … }</style>` —— helper 當區段（行首規則）、Svelte 當 <svelte:head> 底下的模板元素（AST RegularElement name=style，
  //   同一個範圍 [3607,3704)）。行為端證明：test-v6293 A1 就是要抽這一段當「注入 head 的樣式」，沒有任何守衛拿 friends 頁的模板層或
  //   style 內文去斷言「不存在」⇒ helper 多認這一段不會讓任何反向斷言假綠。位移或檔案一變，這條就紅，屆時重釘或拿掉。
  //   ⚠ 位移以 LF 計（站長本機 autocrlf=true、工作樹是 CRLF ⇒ 先正規化再比，裁判兩邊吃同一份字串）。
  const KNOWN_DEVIATION = {
    'src/routes/friends/+page.svelte': { extraHelper: [{ tag: 'style', start: 3607, end: 3704, innerStart: 3614, innerEnd: 3696 }], svelteHeadStyleText: '<style>html, body { margin: 0; background-color: #162816 !important; min-height: 100vh; }</style>' },
  };
  const files = listTracked().filter((f) => f.endsWith('.svelte'));
  assert.ok(files.length >= 12, '只列到 ' + files.length + ' 支 .svelte（v6.319 有 14 支）');
  let checked = 0, sectionsCompared = 0, commentsCompared = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
    const r = scanMarkupChecked(src, { label: f, allowResidual: RESIDUAL_ALLOW[f] ?? [] });
    let h = helperRanges(r);
    const sv = svelteRanges(src);
    const dev = KNOWN_DEVIATION[f];
    if (dev) {
      for (const x of dev.extraHelper) {
        const i = h.findIndex((y) => JSON.stringify(y) === JSON.stringify(x));
        assert.ok(i >= 0, f + '：已知偏差的 helper 端範圍 ' + JSON.stringify(x) + ' 不在 helper 的區段裡 ⇒ 例外過期，請重釘或拿掉；helper 實得 ' + JSON.stringify(h));
        assert.strictEqual(src.slice(x.start, x.end), dev.svelteHeadStyleText, f + '：已知偏差那一段的文字變了 ⇒ 例外過期');
        // Svelte 端：同一個範圍必須是 <svelte:head> 底下的 RegularElement name=style（不是 css、不是別的東西）
        const ast = svelteParse(src, { modern: true });
        const head = ast.fragment.nodes.find((n) => n.type === 'SvelteHead');
        assert.ok(head && head.start < x.start && x.end < head.end, f + '：已知偏差那一段不在 <svelte:head> 裡了 ⇒ 例外過期');
        const el = head.fragment.nodes.find((n) => n.type === 'RegularElement' && n.name === 'style' && n.start === x.start && n.end === x.end);
        assert.ok(el, f + '：Svelte AST 在 [' + x.start + ',' + x.end + ') 沒有 <svelte:head> 底下的 style 元素 ⇒ 例外過期');
        h = h.filter((_, j) => j !== i);
      }
    }
    assert.deepStrictEqual(h, sv, f + '：helper 與 Svelte parse() 對頂層區段**範圍**的判定不一致（helper ' + JSON.stringify(h) + ' vs svelte ' + JSON.stringify(sv) + '）');
    assert.deepStrictEqual(helperComments(r), svelteComments(src), f + '：helper 與 Svelte parse() 對 HTML 註解位移的判定不一致');
    sectionsCompared += sv.length; commentsCompared += r.comments.length;
    checked++;
  }
  assert.strictEqual(checked, files.length);
  assert.ok(sectionsCompared >= 24 && commentsCompared >= 300, '比對的區段／註解太少（' + sectionsCompared + '／' + commentsCompared + '；v6.320 實量 27／393）⇒ 裁判空轉');
});
T('5-3 ⭐ 把 ⛔-1 植入真檔（MobilePortraitBattle 的 <style> 開頭之後放 CSS 註解 /* </style> */）⇒ 範圍級裁判紅、護欄⑧紅；v6.319 的比段數裁判與護欄⑦對它仍綠（反面對照）', () => {
  const src = readFileSync(join(ROOT, P_MPB), 'utf8').replace(/\r\n/g, '\n');
  const m = src.match(/\n<style[^>]*>\n/);
  assert.ok(m, '找不到 MobilePortraitBattle 的 <style> 開頭');
  const inj = src.slice(0, m.index + m[0].length) + '/*\n</' + 'style>\n*/\n' + src.slice(m.index + m[0].length);
  assert.ok(compiles(inj), 'Svelte 應仍編譯得過（前提）');
  assert.deepStrictEqual(svelteRanges(inj).map((x) => x.tag), ['script', 'style']);
  assert.strictEqual(v6319CountJudgeSame(inj), true, 'v6.319 的比段數裁判應該是綠的（反面對照）');
  assert.strictEqual(v6319Residual(inj), 0, 'v6.319 的護欄⑦應該是 0 殘留（反面對照）');
  assert.notDeepStrictEqual(helperRanges(scanMarkup(inj)), svelteRanges(inj), '範圍級裁判必須紅');
  throwsRe(() => scanMarkupChecked(inj, { label: P_MPB }), /殘留 1 處 .*開頭 0／收尾 1.*收尾「<\/style>」/);
  assert.ok(!scanMarkup(inj).sections.some((x) => x.tag === 'style' && x.inner.includes('.mp-chip')), '被提前收尾的 style 段不該再含 .mp-chip（洞的形狀）');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} test-lib-strip-markup-sections：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
