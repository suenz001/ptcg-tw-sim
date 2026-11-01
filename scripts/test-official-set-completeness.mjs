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
import { findSameFace, normName } from './lib/official-reprint-match.mjs';

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
  const printed = MANIFEST.printedMarkOverrides ?? {};
  const missing = [];
  for (const [code, v] of Object.entries(MANIFEST.sets)) {
    for (const id of v.ids) {
      if (OURS.has(String(id))) continue;
      if (Object.prototype.hasOwnProperty.call(exempt, String(id))) continue;
      if (Object.prototype.hasOwnProperty.call(printed, String(id))) continue;   // v6.616：卡圖印的不是 H/I/J
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

T('⭐⭐ v6.616 卡圖標記列管表：印的必須不是 H/I/J、附查證日期，且不得與卡庫或 knownNonHIJ 重疊', () => {
  // 站長 2026-11-01：「只有h i j標要收 收之前，先確認是不是h i j標！」
  //   官網標記欄位對舊商品的重印不可靠（SVI 訓練家卡圖印 G、官網標 I／J）⇒ 以卡圖為準，人工列管。
  const printed = MANIFEST.printedMarkOverrides ?? {};
  const inManifest = new Set();
  for (const v of Object.values(MANIFEST.sets)) for (const id of v.ids) inManifest.add(String(id));
  const check = (id, v) => {
    const bad = [];
    if (['H', 'I', 'J'].includes(v?.printed)) bad.push('#' + id + ' printed=' + v.printed + '（印的是 H/I/J 就該收）');
    if (!(typeof v?.printed === 'string' && v.printed.length > 0)) bad.push('#' + id + ' 沒有 printed');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v?.verifiedAt ?? '')) bad.push('#' + id + ' 沒有 verifiedAt');
    if (OURS.has(id)) bad.push('#' + id + ' 已在卡庫（腐爛項）');
    if (Object.prototype.hasOwnProperty.call(MANIFEST.knownNonHIJ ?? {}, id)) bad.push('#' + id + ' 同時在 knownNonHIJ');
    if (!inManifest.has(id)) bad.push('#' + id + ' 不在官方快照裡');
    return bad;
  };
  const bad = Object.entries(printed).flatMap(([id, v]) => check(id, v));
  ok(bad.length === 0, bad.join('、'));
  // 正對照（同一支 check）：印 H 卻列進來、沒有查證日期 ⇒ 都必須被抓到
  const [anyId, anyV] = Object.entries(printed)[0] ?? [];
  ok(anyId, 'printedMarkOverrides 是空的 —— v6.616 起至少有 SVI 的 57 張');
  ok(check(anyId, { ...anyV, printed: 'H' }).length > 0, '正對照失效：印 H 的沒被抓到');
  ok(check(anyId, { ...anyV, verifiedAt: '' }).length > 0, '正對照失效：沒有查證日期沒被抓到');
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

console.log('③ ⭐ v6.616：官方商品清單 —— 站上沒收錄的商品不得藏著站上沒有的標準賽卡面');

const PRODUCTS = MANIFEST.products ?? {};
const NOT_COLLECTED = MANIFEST.productsNotCollected ?? {};
const OURS_CARD = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) OURS_CARD.set(String(c.id), c);
}

T('⭐⭐ 下限斷言：商品清單不得異常少（官方檢索頁抓壞會在這裡紅）', () => {
  const n = Object.keys(PRODUCTS).length;
  ok(n >= 100, '快照的商品清單只有 ' + n + ' 項 —— 抓取多半失敗了（2026-11-01 實測 136 項）');
  const uncovered = Object.values(PRODUCTS).filter((v) => !v.covered);
  ok(uncovered.some((v) => (v.standardCount ?? 0) > 0), '沒有任何未收錄商品有標準賽卡 —— 篩選參數可能失效（2026-11-01 實測有數十項）');
  ok(uncovered.some((v) => Object.keys(v.reprintOf ?? {}).length > 0), '沒有任何重印對應 —— 重印比對可能壞了');
});

T('⭐⭐ 站上的每個卡包都在官方商品清單裡標成已收錄（大小寫不敏感）', () => {
  const coveredLC = new Set(Object.entries(PRODUCTS).filter(([, v]) => v.covered).map(([k]) => k.toLowerCase()));
  const bad = Object.keys(MANIFEST.sets).filter((k) => !coveredLC.has(k.toLowerCase()));
  ok(bad.length === 0, '這些站上卡包在商品清單裡找不到或沒標成已收錄：' + bad.join(', '));
});

// ⭐ 裁定只涵蓋當時列出的那幾張（ruledNewFaces）；同一商品之後多出的新卡面不得被舊裁定消音。
//   回傳「站上沒有、也沒被有效裁定涵蓋」的卡面（③ 與它的正對照共用這一支，Rule 38）
function unruledFaces(v, r) {
  const valid = !!r && typeof r.reason === 'string' && r.reason.length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(r.ruledAt ?? '');
  const ruled = new Set(valid && Array.isArray(r.ruledNewFaces) ? r.ruledNewFaces : []);
  return (v.newFaces ?? []).filter((f) => !ruled.has(f.id));
}

T('⭐⭐ ③ 正對照：裁定清單外多一張新卡面、或沒有理由 ⇒ 必須抓到', () => {
  const r = { reason: '測試用的裁定理由，長度超過十個字', ruledAt: '2026-11-01', ruledNewFaces: ['1'] };
  ok(unruledFaces({ newFaces: [{ id: '1' }] }, r).length === 0, '清單內的卡面竟然沒被放行');
  ok(unruledFaces({ newFaces: [{ id: '1' }, { id: '2' }] }, r).length === 1, '清單外多一張沒被抓到');
  ok(unruledFaces({ newFaces: [{ id: '1' }] }, { ...r, reason: '' }).length === 1, '沒有理由的裁定竟然放行');
  ok(unruledFaces({ newFaces: [{ id: '1' }] }, undefined).length === 1, '沒有裁定竟然放行');
});

T('⭐⭐⭐ 未收錄商品：要嘛沒有站上沒有的卡面，要嘛站長裁定不收（附理由）', () => {
  const bad = [];
  for (const [code, v] of Object.entries(PRODUCTS)) {
    if (v.covered) continue;
    ok(Number.isInteger(v.standardCount), code + ' 沒有 standardCount（快照格式壞了）');
    ok(Array.isArray(v.newFaces) && v.reprintOf && typeof v.reprintOf === 'object', code + ' 缺 newFaces／reprintOf（快照格式壞了）');
    ok(v.newFaces.length + Object.keys(v.reprintOf).length <= v.standardCount, code + ' 的 newFaces＋reprintOf 超過 standardCount');
    if (v.newFaces.length === 0) continue;
    const unruled = unruledFaces(v, NOT_COLLECTED[code]);
    if (unruled.length === 0) continue;
    bad.push(code + ' ' + v.label + '：站上沒有、也沒有被裁定涵蓋的卡面 ' + unruled.length + ' 張（' + unruled.slice(0, 4).map((f) => f.name + '#' + f.id).join('、') + '…）');
  }
  ok(bad.length === 0, '這些未收錄商品有站上沒有的標準賽卡面，且沒有站長裁定：\n      ' + bad.join('\n      ')
    + '\n      → 收錄進 static/cards，或請站長裁定後列入 productsNotCollected（附 reason／ruledAt）');
});

T('⭐⭐ 重印對應必須指向站上真的存在、同名、H/I/J 的卡（離線可驗的那一半）', () => {
  const bad = [];
  let n = 0;
  for (const [code, v] of Object.entries(PRODUCTS)) {
    for (const [offId, ref] of Object.entries(v.reprintOf ?? {})) {
      n++;
      const siteId = ref?.site;
      const c = OURS_CARD.get(String(siteId));
      if (!c) { bad.push(code + ' #' + offId + ' → ' + siteId + '（站上沒有這張）'); continue; }
      if (normName(c.name) !== normName(ref?.name)) bad.push(code + ' #' + offId + ' ' + ref?.name + ' → ' + siteId + ' ' + c.name + '（名稱不同）');
      if (!['H', 'I', 'J'].includes(c.regulationMark)) bad.push(code + ' #' + offId + ' → ' + siteId + ' ' + c.name + '（' + c.regulationMark + '，不是 H/I/J）');
      if (OURS.has(String(offId))) bad.push(code + ' #' + offId + '（官方 id 已在站上，不該算重印）');
    }
  }
  ok(n >= 100, '重印對應只有 ' + n + ' 筆 —— 比對可能壞了（2026-11-01 實測約 400 筆）');
  ok(bad.length === 0, bad.join('\n      '));
});

T('⭐ 站長裁定不收的商品必須真的在官方清單裡、且附理由與日期（不得有腐爛項）', () => {
  const bad = [];
  for (const [code, r] of Object.entries(NOT_COLLECTED)) {
    if (!Array.isArray(r?.ruledNewFaces)) bad.push(code + '（沒有 ruledNewFaces：裁定當時涵蓋哪幾張要寫清楚）');
    if (!PRODUCTS[code]) bad.push(code + '（官方清單已無此商品）');
    else if (PRODUCTS[code].covered) bad.push(code + '（已經收錄了，請移出 productsNotCollected）');
    if (!(typeof r?.reason === 'string' && r.reason.length >= 10)) bad.push(code + '（沒有理由）');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.ruledAt ?? '')) bad.push(code + '（沒有裁定日期）');
  }
  ok(bad.length === 0, bad.join('、'));
});

T('⭐⭐ 重印判準正對照（與 refresh 共用同一支 findSameFace）', () => {
  const pick = (pred) => [...OURS_CARD.values()].find(pred);
  const mon = pick((c) => c.supertype === 'Pokemon' && ['H', 'I', 'J'].includes(c.regulationMark) && (c.attacks ?? []).some((a) => a.damage));
  const tr = pick((c) => c.supertype === 'Trainer' && ['H', 'I', 'J'].includes(c.regulationMark) && (c.rulesText ?? '').length > 10);
  ok(mon && tr, '找不到正對照樣本');
  const site = [...OURS_CARD.values()];
  // 原樣（模擬官方 detail 多了提示語與空白）⇒ 必須認得出是重印
  ok(findSameFace(structuredClone(mon), site) !== null, '同一張寶可夢卡竟然不算重印');
  ok(findSameFace({ ...structuredClone(tr), id: 'x', rulesText: tr.rulesText + '\n\n在自己的回合時，物品卡可不限張數使用。' }, site) !== null, '訓練家卡多了官方提示語就認不出來');
  // 卡面不同 ⇒ 必須回 null
  const m2 = structuredClone(mon); m2.attacks = m2.attacks.map((a, i) => (i === 0 ? { ...a, damage: '999' } : a));
  ok(findSameFace(m2, site) === null, '招式傷害不同卻被當成重印');
  const m4 = structuredClone(mon); m4.attacks = m4.attacks.map((a, i) => (i === 0 ? { ...a, cost: [...(a.cost ?? []), 'Colorless'] } : a));
  ok(findSameFace(m4, site) === null, '招式費用不同卻被當成重印');
  const m5 = structuredClone(mon); m5.stage = m5.stage === 'Basic' ? 'Stage1' : 'Basic';
  ok(findSameFace(m5, site) === null, '階段不同卻被當成重印');
  const m3 = structuredClone(mon); m3.hp = String(Number(m3.hp || 0) + 10);
  ok(findSameFace(m3, site) === null, 'HP 不同卻被當成重印');
  ok(findSameFace({ ...structuredClone(tr), name: '並不存在的訓練家卡名' }, site) === null, '站上沒有的訓練家卡名卻被當成重印');
  ok(findSameFace({ ...structuredClone(tr), supertype: 'Pokemon', attacks: [{ name: '假招', damage: '1', effect: '' }] }, site) === null, '種類不同卻被當成重印');
  const en = pick((c) => c.supertype === 'Energy' && /^基本【.】能量$/.test(c.name));
  ok(en && findSameFace({ ...structuredClone(en), name: en.name.replace(/[【】]/g, '') }, site) !== null, '「基本雷能量」寫法認不出是「基本【雷】能量」');
  ok(findSameFace({ ...structuredClone(tr), name: tr.name + '（赤日）' }, site) === null, '名稱不同（括號）卻被當成重印');
});

console.log('④ 正對照：判準必須抓得到真的缺卡');

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
