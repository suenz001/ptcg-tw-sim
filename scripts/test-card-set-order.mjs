// 守衛：卡包選單的排列順序（v6.045）。
//
// Wilson 要的是「越新越靠左上」：
//   ① 賽季標的順序 J → I → H（原本是 H → I → J）
//   ② 同一標內發售日 新 → 舊（原本是舊 → 新）
//   ③ 特典卡永遠排在該標最後
//
// ⚠這支用**真實的 static/cards/index.json** 驗證實際輸出順序，不是只測假資料 ——
//   排序這種東西，用人造資料很容易測得過但真實資料仍然錯（例如日期格式不一致）。
//   資料本身也一起釘：J 標的第一個必須真的是最新發售的那個卡包。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { build } from 'esbuild';
import { unlinkSync, writeFileSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-so-s.js'), E = join(ROOT, '.x-so-e.ts'), O = join(ROOT, '.x-so-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export * from './src/lib/cards/set-order';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { orderSetsForPicker, compareSetsNewestFirst, isPromoSet, MARK_ORDER }
  = await import(pathToFileURL(O).href);

const SETS = JSON.parse(readFileSync(join(ROOT, 'static/cards/index.json'), 'utf8'));

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：index.json 讀得到，且 H/I/J 三個標都有卡包', () => {
  assert.ok(SETS.length > 30, `卡包數應該不少，實得 ${SETS.length}`);
  for (const m of ['H', 'I', 'J']) {
    assert.ok(SETS.some((s) => s.regulationMark === m), `應有 ${m} 標卡包`);
  }
});

T('⭐⭐標的順序是 J → I → H（最新的標在最上面）', () => {
  assert.deepEqual([...MARK_ORDER], ['J', 'I', 'H']);
  const marks = orderSetsForPicker(SETS).map(([m]) => m);
  const std = marks.filter((m) => ['H', 'I', 'J'].includes(m));
  assert.deepEqual(std, ['J', 'I', 'H'],
    `標準賽三個標應由新到舊排列，實得 ${std.join(' → ')}`);
});

T('⭐⭐每個標之內：發售日由新到舊', () => {
  for (const [mark, list] of orderSetsForPicker(SETS)) {
    const dated = list.filter((s) => s.releaseDate && !isPromoSet(s));
    for (let i = 1; i < dated.length; i++) {
      assert.ok(dated[i - 1].releaseDate >= dated[i].releaseDate,
        `${mark} 標順序錯：${dated[i - 1].code}(${dated[i - 1].releaseDate}) `
        + `排在 ${dated[i].code}(${dated[i].releaseDate}) 前面，但它比較舊`);
    }
  }
});

T('⭐⭐特典卡一定排在該標的最後一個', () => {
  for (const [mark, list] of orderSetsForPicker(SETS)) {
    const promoIdx = list.map((s, i) => (isPromoSet(s) ? i : -1)).filter((i) => i >= 0);
    if (promoIdx.length === 0) continue;
    const firstPromo = Math.min(...promoIdx);
    for (let i = firstPromo; i < list.length; i++) {
      assert.ok(isPromoSet(list[i]),
        `${mark} 標的特典卡之後不該再出現一般卡包，但第 ${i} 個是 ${list[i].code}`);
    }
    console.log(`   ${mark} 標：共 ${list.length} 個，最後 ${promoIdx.length} 個是特典卡`);
  }
});

T('⭐⭐用真實資料驗第一個位置：J 標的第一個必須是最新發售的卡包', () => {
  const [firstMark, firstList] = orderSetsForPicker(SETS)[0];
  assert.equal(firstMark, 'J');
  const newestJ = SETS.filter((s) => s.regulationMark === 'J' && s.releaseDate && !isPromoSet(s))
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0];
  assert.equal(firstList[0].code, newestJ.code,
    `J 標第一個應是最新的 ${newestJ.code}（${newestJ.releaseDate}），實得 ${firstList[0].code}`);
  console.log(`   最左上＝${firstList[0].code}「${firstList[0].name}」（${firstList[0].releaseDate}）`);
});

T('⭐特典卡判定不可只依賴「沒有發售日」（日後若補了日期也不能跑掉）', () => {
  assert.ok(isPromoSet({ code: 'M-P-J' }) && isPromoSet({ code: 'SV-P-I' }), '應認得特典卡 code');
  assert.ok(!isPromoSet({ code: 'SV11B' }) && !isPromoSet({ code: 'MC' }), '一般卡包不該被誤判');
  // 就算特典卡被補上（很新的）日期，仍必須墊底
  const withDate = { code: 'M-P-J', regulationMark: 'J', releaseDate: '2099-12-31' };
  const normal = { code: 'MX', regulationMark: 'J', releaseDate: '2026-01-01' };
  assert.ok(compareSetsNewestFirst(withDate, normal) > 0,
    '特典卡就算有日期也必須排在一般卡包後面');
});

T('⭐同日發售的卡包順序必須穩定（不能每次重新整理都跳動）', () => {
  const a = { code: 'SV5K', regulationMark: 'H', releaseDate: '2024-02-02' };
  const b = { code: 'SV5M', regulationMark: 'H', releaseDate: '2024-02-02' };
  assert.ok(compareSetsNewestFirst(a, b) < 0 && compareSetsNewestFirst(b, a) > 0,
    '同日發售應以 code 做穩定 tiebreaker');
});

T('⭐排序不得增減卡包（只能改順序）', () => {
  const before = [...SETS.map((s) => s.code)].sort();
  const after = orderSetsForPicker(SETS).flatMap(([, l]) => l.map((s) => s.code)).sort();
  assert.deepEqual(after, before, '排序後卡包集合必須完全相同');
});

T('⭐排序不得改動傳入的陣列（避免呼叫端拿到被就地排過的資料）', () => {
  const input = SETS.map((s) => ({ ...s }));
  const snapshot = input.map((s) => s.code).join(',');
  orderSetsForPicker(input);
  assert.equal(input.map((s) => s.code).join(','), snapshot,
    '⚠傳入的陣列被就地排序了 —— 呼叫端若還依賴原順序就會出錯');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
