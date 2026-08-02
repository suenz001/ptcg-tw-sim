/**
 * v6.101 守衛：「傳說」競技場（兩張合一）匯出官網代碼時的 id 合併
 *
 * 背景（Wilson 回報）：M6 傳說場地卡匯出成官網代碼會出問題，因為官網是
 * **兩張合成一張卡片、共用一個序號**。本站 v6.093 為了讓左右半各自能出牌，
 * 自己造了右半 id（19624/19625/19626）—— 官方卡表沒有這些 id。
 *
 * ⚠ 最危險的地方：台灣官網的 beforecheck API **不驗 cardId 存不存在**，
 *   送幽靈 id 不會報錯，而是靜默產生一副壞掉的牌組代碼。
 *   ⇒ 出口端必須自己合併，這個守衛就是釘住這件事。
 *
 * Wilson 裁定：1 套「傳說的山頂」＝**算 2 張**（官網 60 張上限裡佔 2 格）。
 */
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const O = join(ROOT, '.x-stadium.mjs');
process.on('exit', () => { try { unlinkSync(O); } catch {} });

let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '→', e.message); fail++; } };

await build({
  entryPoints: [join(ROOT, 'src/lib/decks/cardIdMigration.ts')], outfile: O,
  bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'error',
  alias: { $lib: join(ROOT, 'src/lib') },
});
const M = await import(pathToFileURL(O).href);
const E = (cardId, count, name = '') => ({ cardId, count, name });

console.log('① 合併：右半 id 併回官方那張卡');
ok('1-1 一套（左1右1）→ 官方 id 一筆、count=2（實體張數）', () => {
  const r = M.mergeTwoCardStadiumEntries([E('19622', 1, '傳說的山頂'), E('19625', 1, '傳說的山頂')]);
  assert.deepStrictEqual(r.map((x) => [x.cardId, x.count]), [['19622', 2]]);
});
ok('1-2 兩套（左2右2）→ count=4', () => {
  const r = M.mergeTwoCardStadiumEntries([E('19621', 2), E('19624', 2)]);
  assert.deepStrictEqual(r.map((x) => [x.cardId, x.count]), [['19621', 4]]);
});
ok('1-3 三張傳說場地卡各自獨立、不互相混到', () => {
  const r = M.mergeTwoCardStadiumEntries([
    E('19621', 1), E('19624', 1), E('19622', 1), E('19625', 1), E('19623', 1), E('19626', 1),
  ]);
  assert.deepStrictEqual(r.map((x) => [x.cardId, x.count]), [['19621', 2], ['19622', 2], ['19623', 2]]);
});
ok('1-4 一般卡片完全不受影響（順序與張數原樣）', () => {
  const src = [E('12345', 4), E('67890', 2), E('11111', 1)];
  assert.deepStrictEqual(M.mergeTwoCardStadiumEntries(src), src);
});
ok('1-5 合併後不會殘留任何自造的右半 id（送出去的都是官方 id）', () => {
  const r = M.mergeTwoCardStadiumEntries([E('19621', 2), E('19624', 2), E('19625', 1), E('19622', 1), E('19626', 3), E('19623', 3)]);
  for (const e of r) assert.ok(!['19624', '19625', '19626'].includes(e.cardId), '殘留幽靈 id：' + e.cardId);
});
ok('1-6 只有右半、沒有左半（牌組壞掉的邊緣情形）也要換成官方 id', () => {
  const r = M.mergeTwoCardStadiumEntries([E('19625', 1)]);
  assert.deepStrictEqual(r.map((x) => [x.cardId, x.count]), [['19622', 1]]);
});
ok('1-7 合併不改變總張數（官網 60 張上限的計算前提）', () => {
  const src = [E('19621', 2), E('19624', 2), E('12345', 4)];
  const sum = (a) => a.reduce((n, e) => n + e.count, 0);
  assert.strictEqual(sum(M.mergeTwoCardStadiumEntries(src)), sum(src));
});

console.log('② 與拆分互為反向（匯出→匯入 round-trip 不走樣）');
ok('2-1 拆 → 合 回到原樣', () => {
  const merged = [E('19622', 4), E('12345', 3)];
  const split = M.splitTwoCardStadiumEntries({ entries: merged }).entries;
  assert.deepStrictEqual(
    M.mergeTwoCardStadiumEntries(split).map((x) => [x.cardId, x.count]),
    merged.map((x) => [x.cardId, x.count]),
  );
});
ok('2-2 合 → 拆 回到原樣（本站內部表示：左右各半）', () => {
  const inSite = [E('19623', 2), E('19626', 2)];
  const back = M.splitTwoCardStadiumEntries({ entries: M.mergeTwoCardStadiumEntries(inSite) }).entries;
  assert.deepStrictEqual(back.map((x) => [x.cardId, x.count]), inSite.map((x) => [x.cardId, x.count]));
});

ok('1-8 合併保留 cardName 等其他欄位（送官網要帶卡名）', () => {
  const r = M.mergeTwoCardStadiumEntries([
    { cardId: '19625', cardName: '傳說的山頂', count: 1 },
    { cardId: '19622', cardName: '傳說的山頂', count: 1 },
  ]);
  assert.deepStrictEqual(r, [{ cardId: '19622', cardName: '傳說的山頂', count: 2 }]);
});
ok('1-9 只有右半時仍拿得到卡名（左右半的官方卡名逐字相同）', () => {
  const r = M.mergeTwoCardStadiumEntries([{ cardId: '19626', cardName: '傳說的熔岩洞', count: 1 }]);
  assert.strictEqual(r[0].cardName, '傳說的熔岩洞');
});
ok('1-10 卡表資料前提：左右半同名，且右半沒有 twDeckBuildId', () => {
  // ⚠ 匯出時 cardId 取 `card.twDeckBuildId ?? card.id`。若日後有人替右半補上 twDeckBuildId，
  //   送進合併的就不再是 19624-19626，合併會**靜默失效**、幽靈 id 又會流到官網。
  //   這一項就是釘住那個前提；真要補 twDeckBuildId，必須同時處理合併。
  const m6 = JSON.parse(readFileSync(join(ROOT, 'static/cards/M6.json'), 'utf8'));
  const by = new Map(m6.map((c) => [String(c.id), c]));
  for (const [left, right] of [['19621', '19624'], ['19622', '19625'], ['19623', '19626']]) {
    const L = by.get(left), R = by.get(right);
    assert.ok(L && R, `卡表缺 ${left}/${right}`);
    assert.strictEqual(R.name, L.name, `${right} 與 ${left} 卡名不一致`);
    assert.strictEqual(R.twDeckBuildId, undefined, `${right} 多了 twDeckBuildId → 合併會失效`);
  }
});

console.log('③ 出口端真的有接（不是寫好放著沒人呼叫）');
const decks = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
ok('3-1 匯出官網代碼前有先合併', () => {
  const i = decks.indexOf('exportToTwOfficialCode');
  assert.ok(i > 0, '找不到匯出函式');
  const body = decks.slice(i, i + 3000);
  assert.ok(body.includes('mergeTwoCardStadiumEntries('), '匯出路徑沒有呼叫合併 → 會送出幽靈 id');
});
ok('3-2 匯入官網代碼後有還原成左右兩半', () => {
  assert.ok(decks.includes('splitTwoCardStadiumEntries('), '匯入路徑沒有拆回左右半');
});
ok('3-3 兩個函式都從中央模組取得（禁在頁面裡另外手刻一份對照表）', () => {
  assert.ok(/import\s*\{[^}]*mergeTwoCardStadiumEntries[^}]*\}\s*from\s*'\$lib\/decks\/cardIdMigration'/.test(decks));
  const noComment = decks.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const ghost of ['19624', '19625', '19626']) {
    assert.ok(!noComment.includes(`'${ghost}'`), `頁面裡手刻了右半 id ${ghost}，應只存在於 cardIdMigration.ts`);
  }
});
ok('3-4 正對照：掃描式對「沒接中央」的樣本會失敗', () => {
  const bad = 'function exportToTwOfficialCode(){ const entriesRaw = deck.entries; post(entriesRaw); }';
  const body = bad.slice(bad.indexOf('exportToTwOfficialCode'));
  assert.ok(!body.includes('mergeTwoCardStadiumEntries('));
});

console.log(`\n=== v6.101 傳說場地卡匯出守衛：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
