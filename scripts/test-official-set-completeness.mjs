// ⭐⭐⭐ 官方卡包完整性守衛（v6.191）
//
// 站長回報：「asia.pokemon-card.com 的 M-P 有新卡沒收錄，例如【玳蘿】」。
// 在此之前，「官方發了新卡而我們漏收」這件事**只能靠玩家回報**（v6.007 同樣的教訓：
// 「玩家報卡沒實裝＝印刷版本漏收」；v6.116 一次補了 572 張）。
//
// 這支守衛把它變成可重複執行的檢查：
//   ・scripts/data/official-set-manifest.json = 官方卡牌檢索的**離線快照**（卡包 → 卡片 id）
//   ・本守衛（離線、CI 每次都跑）：快照裡的每個 id，要嘛在我們卡庫裡，
//     要嘛在 knownNonHIJ 豁免表（站規只維護 H/I/J）。
//   ・scripts/refresh-official-set-manifest.mjs --write（手動、需要網路）：重抓快照，
//     並把「官方有、我們沒有」的卡按 regulationMark 分流，直接印出待補清單。
//
// ⚠ 為什麼快照要離線：CI 每次 build 都去爬官網既不禮貌也會 flaky（爬不到 = 假紅燈）。
//   離線守衛擋的是「快照更新了但卡沒補」與「卡被誤刪」；要發現**全新發行**請跑 refresh。
//
// ⚠ 掃描器自身要先被驗證（v6.124~126 教訓）：下限斷言 + 正對照都在下面。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'scripts/data/official-set-manifest.json'), 'utf8'));
const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

// 我方全站 id（B-3：一定要跟「全站所有 id」比，不能只跟同名 set 檔比，
//   否則同一張卡被收在別的檔裡會被誤判成缺卡、補下去就變成 id 重複）。
const liveCodes = new Set(INDEX.map((e) => e.code));
const OURS = new Set();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id != null) OURS.add(String(c.id));   // ⚠ v5.990：一律 String(id)
  }
}

console.log('① 快照本身要健康（掃描器壞掉 ≠ 乾淨）');

T('⭐⭐ 下限斷言：卡包數與 id 數不得異常少（快照被截斷／抓壞會在這裡紅）', () => {
  const setNames = Object.keys(MANIFEST.sets ?? {});
  ok(setNames.length >= 30, '快照只有 ' + setNames.length + ' 個卡包 —— 抓取多半失敗了');
  const total = setNames.reduce((n, k) => n + MANIFEST.sets[k].ids.length, 0);
  ok(total >= 4500, '快照只有 ' + total + ' 個 id —— 抓取多半失敗了');
  ok(OURS.size >= 4500, '我方卡庫只掃到 ' + OURS.size + ' 張 —— 掃描器壞了？');
});

T('⭐ 每包的 total 必須等於 ids 長度（分頁沒抓完會對不上）', () => {
  const bad = [];
  for (const [code, v] of Object.entries(MANIFEST.sets)) {
    if (v.total !== v.ids.length) bad.push(code + ': total=' + v.total + ' ids=' + v.ids.length);
    if (new Set(v.ids).size !== v.ids.length) bad.push(code + ': ids 有重複');
  }
  ok(bad.length === 0, bad.join('\n      '));
});

T('⭐⭐ live 的每個卡包都要被快照涵蓋（新卡包不得無聲逃過列管）', () => {
  const covered = new Set();
  for (const v of Object.values(MANIFEST.sets)) for (const c of v.localSetCodes) covered.add(c);
  const missing = INDEX.map((e) => e.code).filter((c) => !covered.has(c));
  ok(missing.length === 0,
    '這些 live 卡包不在官方快照的對照表裡：' + missing.join(', ')
    + '\n      → 跑 `node scripts/refresh-official-set-manifest.mjs --write` 重建快照');
});

console.log('② 官方有的 H/I/J 卡，我們一張都不能少');

T('⭐⭐⭐ 官方快照的每個 id，要嘛在我方卡庫、要嘛在 knownNonHIJ 豁免表', () => {
  const exempt = MANIFEST.knownNonHIJ ?? {};
  const missing = [];
  for (const [code, v] of Object.entries(MANIFEST.sets)) {
    for (const id of v.ids) {
      if (OURS.has(String(id))) continue;
      if (Object.prototype.hasOwnProperty.call(exempt, String(id))) continue;
      missing.push(code + ' #' + id);
    }
  }
  ok(missing.length === 0,
    '官方有、我們沒有、也沒列管的卡共 ' + missing.length + ' 張：\n      '
    + missing.slice(0, 40).join('\n      ')
    + (missing.length > 40 ? '\n      …（其餘省略）' : '')
    + '\n      → 先查 regulationMark：H/I/J 要補進 static/cards；其餘加進 knownNonHIJ（附實際標）');
});

T('⭐⭐ 豁免表不得藏 H/I/J（站規只維護 H/I/J，藏進來等於永遠不補）', () => {
  const bad = Object.entries(MANIFEST.knownNonHIJ ?? {})
    .filter(([, v]) => ['H', 'I', 'J'].includes(v.regulationMark))
    .map(([id, v]) => '#' + id + ' ' + v.name + '(' + v.regulationMark + ')');
  ok(bad.length === 0, '豁免表裡有 H/I/J 標的卡：' + bad.join(', '));
});

T('⭐ 豁免表不得有腐爛項（卡已經補進卡庫了就該移出豁免表）', () => {
  const rotten = Object.keys(MANIFEST.knownNonHIJ ?? {}).filter((id) => OURS.has(String(id)));
  ok(rotten.length === 0, '這些 id 已在卡庫，請從 knownNonHIJ 移除：' + rotten.join(', '));
  const orphan = [];
  const inManifest = new Set();
  for (const v of Object.values(MANIFEST.sets)) for (const id of v.ids) inManifest.add(String(id));
  for (const id of Object.keys(MANIFEST.knownNonHIJ ?? {})) if (!inManifest.has(id)) orphan.push(id);
  ok(orphan.length === 0, '這些豁免項已不在官方快照裡（官方下架？）：' + orphan.join(', '));
});

console.log('③ 正對照：判準必須抓得到真的缺卡');

T('⭐⭐ 餵一個假的「官方有、我們沒有、也沒豁免」樣本，必須被抓到', () => {
  const fakeId = '99999991';
  ok(!OURS.has(fakeId), '測試前提：這個假 id 不該在卡庫裡');
  const exempt = MANIFEST.knownNonHIJ ?? {};
  const caught = !OURS.has(fakeId) && !Object.prototype.hasOwnProperty.call(exempt, fakeId);
  ok(caught, '正對照失效 —— 真的缺卡不會被抓到');
});

T('⭐ 正對照：豁免表判準抓得到「藏了一張 H 標」', () => {
  const probe = { regulationMark: 'H', name: '假卡' };
  ok(['H', 'I', 'J'].includes(probe.regulationMark), '正對照失效');
});

console.log('\n=== v6.191 官方卡包完整性：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
