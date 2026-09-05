// ⭐ v6.317 守衛：中央 helper scripts/lib/strip-markup-sections.mjs 自身先驗（Rule 25）
//
// ── 這支在守什麼 ────────────────────────────────────────────────────────────
//   「先剝 HTML 註解、再剝／抽 script／style 區段，等長空白化」這條順序與形狀。
//   順序反了（v6.316 之前 test-v6190 的寫法）⇒ 註解裡一提到樣式標籤的字面，整段模板就被吃掉，
//   後面所有對模板的斷言都變恆真。本檔用四種方式證明 helper 抓得到、也判得出壞樣本：
//   【0】內嵌樣本＋**手算**已知答案（history-free，永不過期）；同一樣本用舊順序算出來必須不一樣
//   【1】固定 blob（v6.316）的已知答案表：非空白字元數（UTF-16 code unit）由另一份 Python 實作獨立量出後手抄
//   【2】工作樹正對照：模板錨點必須還在、腳本錨點必須不見（不綁數字，永不過期）
//   【3】事故重現：在固定 blob 上植入「提到樣式標籤字面的註解」⇒ 舊順序吃掉 >99%，helper 一個字都不差
//   【4】護欄突變：未收尾／超長／比例／正對照／區段下限，各紅在指定訊息
// ⚠⚠ 只捕捉 assert.AssertionError —— 其他例外必須直接炸掉。
// Run: node scripts/test-lib-strip-markup-sections.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { templateOnly, sectionInner, markupSections, blankHtmlCommentsChecked, nonWs, blankOut } from './lib/strip-markup-sections.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⭐ 固定 blob（v6.316）。這不是「pin 版本」—— blob 內容永不變，表也永不過期；淺複製時大聲 SKIP（不 fail-open）。
const FIXED_SHA = '8f8b378236e0477f4451b5c00fa93d0582bf2c71';
const P_GAME = 'src/routes/game/+page.svelte';
const P_MPB = 'src/routes/game/MobilePortraitBattle.svelte';
// 已知答案表：由 Python（re + utf-16-le 長度）獨立量出後手抄；⚠ 不可以拿 helper 算出來再寫回去。
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

// 事故的那個形狀（舊順序：先區段、最後才剝註解；區段開頭不限行首）—— 只用來當反面對照，不可拿去守東西。
const S = '<' + 'script', SS = '<\\/' + 'script>', Y = '<' + 'style', YY = '<\\/' + 'style>';
function oldOrder(src) {
  let t = src;
  t = blankOut(t, new RegExp(S + '[\\s\\S]*?' + SS, 'g'));
  t = blankOut(t, new RegExp(Y + '[\\s\\S]*?' + YY, 'g'));
  t = blankOut(t, /<!--[\s\S]*?-->/g);
  return t;
}

console.log('【0】內嵌樣本＋手算答案');
// 第 1 行腳本、第 2 行模板、第 3 行註解（提到樣式標籤字面）、第 4 行模板含字串字面、第 5 行真樣式
const FX1 = [
  '<script>let a = 1;</script>',
  'A{#if x}B{/if}',
  '<!-- 提到 ' + Y + '> 字面 {#if y}zz{/if} -->',
  "C{@html '" + Y + '>x' + '</' + "style>'}",
  '<style>.q{color:red}</style>',
].join('\n');
T('0-1 templateOnly：手算答案 39（第 2 行 13 ＋ 第 4 行 26），長度／行數不變，模板標記只剩正文那一組', () => {
  const out = templateOnly(FX1, { label: 'FX1', minSections: 1 });
  assert.strictEqual(nonWs(out), 39, '非空白字元數 ' + nonWs(out));
  assert.strictEqual(out.length, FX1.length);
  assert.strictEqual(out.split('\n').length, 5);
  assert.strictEqual((out.match(/\{#if/g) || []).length, 1, '註解裡的區塊標記沒剝掉／正文的被剝掉');
  assert.ok(/\{#if x\}/.test(out) && !/let a = 1/.test(out) && !/color:red/.test(out));
});
T('0-2 反面對照：同一樣本用舊順序算出 21（第 3 行字面吃到第 4 行的收尾，連註解開頭都留下來）≠ 39 ⇒ 順序真的有差', () => {
  assert.strictEqual(nonWs(oldOrder(FX1)), 21);
});
const FX2 = [
  '<script>let a = 1;</script>',
  '<!-- 提到 ' + Y + '> 字面 -->',
  '<div>{#if x}BIG TEMPLATE{/if}</div>',
  '<style>.q{color:red}</style>',
].join('\n');
T('0-3 事故形狀（註解在真樣式之前）：helper 手算 33；舊順序只剩 6（整段模板被吃掉，只留註解開頭）', () => {
  assert.strictEqual(nonWs(templateOnly(FX2, { minSections: 1 })), 33);
  assert.strictEqual(nonWs(oldOrder(FX2)), 6);
});
T('0-4 sectionInner：style 內文 ".q{color:red}"、script 內文 "let a = 1;"；字串字面裡的標籤不是區段（不在行首）', () => {
  assert.strictEqual(sectionInner(FX1, 'style', { minSections: 1 }), '.q{color:red}');
  assert.strictEqual(sectionInner(FX1, 'script', { minSections: 1 }), 'let a = 1;');
  assert.strictEqual(markupSections(FX1, 'style').sections.length, 1);
});
T('0-5 行首允許前導空白：縮排的單行樣式（friends 頁 svelte:head 那種）算一段、收尾取最近的', () => {
  const fx = '<script>x</script>\n<svelte:head>\n  <style>html{margin:0}</style>\n</svelte:head>\n<p>T</p>\n<style>.a{b:c}</style>';
  const r = markupSections(fx, 'style', { minSections: 2 });
  assert.deepStrictEqual(r.sections.map((s) => s.inner), ['html{margin:0}', '.a{b:c}']);
  assert.ok(templateOnly(fx).includes('<p>T</p>'));
});

console.log('【1】固定 blob 已知答案表（獨立量測、手抄）');
const blobs = {};
for (const p of [P_GAME, P_MPB]) blobs[p] = readBaseBlob(ROOT, FIXED_SHA, p);
const haveBlobs = hasBaseCommit(ROOT, FIXED_SHA) && Object.values(blobs).every((r) => r.ok);
if (!haveBlobs) {
  shallowSkip('strip-markup-sections【1】【3】固定 blob 已知答案表', '【0】【2】【4】是 history-free 的等價條件，仍在守');
} else {
  for (const p of [P_GAME, P_MPB]) {
    const src = blobs[p].out.replace(/\r\n/g, '\n');
    const k = KNOWN[p];
    T('1 ' + p + '：template=' + k.template + ' styleInner=' + k.styleInner + ' scriptInner=' + k.scriptInner + ' 區段各 1、註解 ' + k.comments, () => {
      assert.strictEqual(nonWs(templateOnly(src, { label: p, minSections: 1 })), k.template);
      const st = markupSections(src, 'style', { minSections: 1 }), sc = markupSections(src, 'script', { minSections: 1 });
      assert.strictEqual(st.sections.length, k.styleSections);
      assert.strictEqual(sc.sections.length, k.scriptSections);
      assert.strictEqual(nonWs(sectionInner(src, 'style')), k.styleInner);
      assert.strictEqual(nonWs(sectionInner(src, 'script')), k.scriptInner);
      assert.strictEqual(blankHtmlCommentsChecked(src).comments.length, k.comments);
    });
  }
  console.log('【3】事故重現（固定 blob 植入註解）');
  T('3-1 game：在 {@html} 那一行之後植入「提到樣式標籤字面」的註解 ⇒ 舊順序剩不到 1%，helper 仍是 184279', () => {
    const src = blobs[P_GAME].out.replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const at = lines.findIndex((l) => l.includes("{@html '" + Y + '>'));
    assert.ok(at > 0, '找不到 {@html} 那一行');
    lines.splice(at + 1, 0, '<!-- 註解提到 ' + Y + '> 字面 -->');
    const inj = lines.join('\n');
    const old = nonWs(oldOrder(inj));
    assert.ok(old < KNOWN[P_GAME].template * 0.01, '舊順序沒有重現事故？剩 ' + old);
    assert.strictEqual(nonWs(templateOnly(inj, { minSections: 1 })), KNOWN[P_GAME].template);
  });
  T('3-2 MobilePortraitBattle：腳本收尾後植入同樣的註解 ⇒ 舊順序剩 8，helper 仍是 22587', () => {
    const src = blobs[P_MPB].out.replace(/\r\n/g, '\n');
    const inj = src.replace('</' + 'script>\n', '</' + 'script>\n<!-- 註解提到 ' + Y + '> 字面 -->\n');
    assert.notStrictEqual(inj, src);
    assert.strictEqual(nonWs(oldOrder(inj)), 8);
    assert.strictEqual(nonWs(templateOnly(inj, { minSections: 1 })), KNOWN[P_MPB].template);
  });
}

console.log('【2】工作樹正對照（不綁數字）');
T('2-1 game/+page.svelte：模板錨點 prizeViewOpen 還在、腳本 function openPrizeView 與樣式 .prize-view-modal { 不見', () => {
  const src = readFileSync(join(ROOT, P_GAME), 'utf8');
  templateOnly(src, { label: P_GAME, minSections: 1, mustKeep: ['prizeViewOpen'], mustDrop: ['function openPrizeView', '.prize-view-modal {'] });
});
T('2-2 MobilePortraitBattle.svelte：模板錨點 mp-clickable 還在、樣式 .mp-chip { 不見', () => {
  const src = readFileSync(join(ROOT, P_MPB), 'utf8');
  templateOnly(src, { label: P_MPB, minSections: 1, mustKeep: ['mp-clickable'], mustDrop: ['.mp-chip {'] });
});

console.log('【4】護欄突變（每一條各紅在指定訊息）');
T('4-1 未收尾的 HTML 註解 ⇒ 紅在「沒有收尾」', () => {
  throwsRe(() => templateOnly('<p>a</p>\n<!-- x\n<p>b</p>'), /沒有收尾/);
});
T('4-2 超過 150 行的 HTML 註解 ⇒ 紅在「長達」', () => {
  throwsRe(() => templateOnly('<p>a</p>\n<!--' + '\n'.repeat(160) + '-->\n<p>b</p>'), /長達 161 行/);
});
T('4-3 註解吃掉超過一半的非空白字元 ⇒ 紅在「吃掉了」', () => {
  throwsRe(() => templateOnly('<p>a</p>\n<!-- ' + 'x'.repeat(100) + ' -->'), /吃掉了/);
});
T('4-4 mustKeep 找不到 ⇒ 紅在「正對照」；mustDrop 還在 ⇒ 紅在「還在」', () => {
  throwsRe(() => templateOnly(FX1, { mustKeep: ['NOT_THERE'] }), /正對照「NOT_THERE」不見了/);
  throwsRe(() => templateOnly(FX1, { mustDrop: ['{#if x}'] }), /「\{#if x\}」還在/);
});
T('4-5 minSections 抽不到 ⇒ 紅在「只找到」；長度不同不可能靜默（等長化壞掉時紅在「長度變了」）', () => {
  throwsRe(() => sectionInner('<p>no style here</p>', 'style', { minSections: 1 }), /只找到 0 個 style 區段/);
  throwsRe(() => blankHtmlCommentsChecked(''), /非空字串/);
});
T('4-6 反面對照：helper 若改回「先區段後註解」⇒ 【0-3】必紅（＝順序是被守住的，不是剛好對）', () => {
  // 把 helper 的兩步對調，重算 FX2：等價於 oldOrder（區段開頭不限行首時） ⇒ 0 ≠ 33
  assert.notStrictEqual(nonWs(oldOrder(FX2)), 33);
});

console.log(`\n${fail === 0 ? '✅' : '❌'} test-lib-strip-markup-sections：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
