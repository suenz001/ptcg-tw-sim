#!/usr/bin/env node
/**
 * v6.401 守衛：特殊能量「視為提供什麼」的五份判準，收斂成中央 energyUnitsOnHost（Rule 38）。
 *
 * 【站長 v6.401 裁示】
 *   ① 火箭隊能量在「數身上有幾個【超】/【惡】能量」時算 **2 個**（照卡面「視為提供2個
 *      【超】【惡】2種屬性的能量」；收斂前只有 countEnergy 算 1，付費端與篩選端都算 2）。
 *   ② 把付招式費用那條核心路徑也一起收斂。
 *
 * 【收斂前 vs 收斂後】engine 的五個入口原本各寫一份：
 *   ① countEnergy ② getEnergyUnits ③ totalEnergyUnits ④ energyTypeUnitsHostAware ⑤ canAffordAttack
 *   ⇒ 全部委派給 energyUnitsOnHost(e, host, pool, { bloom })。
 *
 * 【逐格驗證】收斂前後各跑一次 87 格（3 host stage × 29 live 能量）× 7 欄的行為矩陣，
 *   **差異只有 12 格**，全部是宣告過的：
 *     ・火箭隊能量 countEnergy 1 → 2（站長裁示）× 3 host
 *     ・夜光能量（**G 標**）units／countEnergy／afford1 由「只有【無】」變成全屬性 × 3 host
 *       —— 照卡面第一段「視為提供1個所有屬性的能量」；G 標不在標準賽、牌組檢查會擋，
 *       玩家端零影響。第二段的降級條件仍未實作（見 energyUnitsOnHost 的註解）。
 *   其餘 **零差異**：totalUnits、afford2same、hostAware 一格都沒變。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-401g-s.js'), E = join(ROOT, '.x-401g-e.ts'), O = join(ROOT, '.x-401g-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { getEnergyUnits, totalEnergyUnits, countEnergy, canAffordAttack,\n"
  + "  energyTypeUnitsHostAware, energyUnitsOnHost } from './src/lib/game/engine';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { getEnergyUnits, totalEnergyUnits, countEnergy, canAffordAttack, energyTypeUnitsHostAware } = M;
/** ⚠ Rule 41：中央 helper 在 BASE 上不存在 ⇒ 哨兵包起來，讓每一條各自誠實翻紅。 */
const MISSING = Symbol('missing');
const energyUnitsOnHost = (typeof M?.energyUnitsOnHost === 'function') ? M.energyUnitsOnHost : () => MISSING;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + ' :: ' + e.message); fail++; } };

const idByName = (n, pred) => { for (const [id, c] of pool) if (c?.name === n && (!pred || pred(c))) return id; return null; };
const TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Colorless'];
let nn = 0;
const mkE = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const mkHost = (hid, es) => ({ iid: 'h' + (++nn), cardId: String(hid), damage: 0, energyAttached: es });
const hostOf = (stage) => { for (const [id, c] of pool) if (c?.supertype === 'Pokemon' && c.stage === stage && !(c.abilities ?? []).length) return id; return null; };
const HB = hostOf('Basic'), H1 = hostOf('Stage1'), H2 = hostOf('Stage2');

/** engine.ts 裡某個函式的 body（結構 anchor：從簽名到下一個頂層 function／export function）。 */
const ENGINE_SRC = normEol(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
const ENGINE_NOCOMMENT = (() => { try { return stripCommentsBlankChecked(ENGINE_SRC, 'engine.ts'); } catch { return ENGINE_SRC; } })();
function fnBody(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) return null;
  const rest = src.slice(i + signature.length);
  const m = rest.search(/\n(?:export )?function /);
  return m < 0 ? rest : rest.slice(0, m);
}

console.log('【0】前提哨兵');
T('F0 ★ 三種 host stage 與中央 helper 都在（環境壞了要立刻發現，不可靜默 SKIP）', () => {
  assert.ok(HB && H1 && H2, 'Basic/Stage1/Stage2 三種 host 要各抓到一隻無特性的');
  assert.notStrictEqual(energyUnitsOnHost(mkE(idByName('古舊能量')), null, pool), MISSING,
    'energyUnitsOnHost 缺席（BASE 沙盒）');
});

console.log('\n【A】⭐⭐⭐ 收斂層：五個入口都走中央，且不得再有自己的特殊能量 inline');
const ENTRIES = [
  ['countEnergy', 'export function countEnergy('],
  ['getEnergyUnits', 'export function getEnergyUnits('],
  ['totalEnergyUnits', 'export function totalEnergyUnits('],
  ['energyTypeUnitsHostAware', 'export function energyTypeUnitsHostAware('],
  ['canAffordAttack', 'export function canAffordAttack('],
];
/** 特殊能量的「卡名 → 視為提供什麼」規則，只准寫在中央 energyUnitsOnHost 裡。 */
const SPECIAL_NAMES = ['稜鏡能量', '新衝天能量', '燃火能量', '古舊能量', '夜光能量', '火箭隊能量'];
T('A1 ⭐⭐⭐ 五個入口的 body 都必須呼叫 energyUnitsOnHost', () => {
  for (const [name, sig] of ENTRIES) {
    const body = fnBody(ENGINE_NOCOMMENT, sig);
    assert.ok(body, '抓不到 ' + name + ' 的 body（anchor 失效）');
    assert.ok(body.length < 12000, name + ' 的 body 抓太長（' + body.length + '）⇒ anchor 可能吃到下一個函式');
    assert.ok(body.includes('energyUnitsOnHost('), name + ' 沒有走中央 energyUnitsOnHost');
  }
});
T('A2 ⭐⭐⭐ 五個入口的 body 裡不得再出現特殊能量卡名（判準只能留在中央那一份）', () => {
  const bad = [];
  for (const [name, sig] of ENTRIES) {
    const body = fnBody(ENGINE_NOCOMMENT, sig);
    for (const sp of SPECIAL_NAMES) if (body.includes(sp)) bad.push(name + ' 裡還寫著「' + sp + '」');
  }
  assert.strictEqual(bad.length, 0, '判準沒收乾淨：\n  ' + bad.join('\n  '));
  // ★ 正對照：中央那一份**必須**寫著這些卡名（否則上面那條是恆真）
  const central = fnBody(ENGINE_NOCOMMENT, 'export function energyUnitsOnHost(');
  assert.ok(central, '抓不到 energyUnitsOnHost 的 body');
  for (const sp of SPECIAL_NAMES) {
    assert.ok(central.includes(sp), '中央 energyUnitsOnHost 裡沒有「' + sp + '」⇒ A2 是恆真的');
  }
});
T('A3 ⭐⭐ 全站（engine 以外）不得再有人自己列舉這些特殊能量的「視為提供」規則', () => {
  // 只掃 game 目錄的 .ts：卡檔可以因為別的理由提到卡名（例如註冊 regPre），
  // 所以判準是「同一行同時出現卡名與 types/Colorless/ALL」這種規則式寫法。
  const files = [];
  for (const d of ['src/lib/game', 'src/lib/game/effects', 'src/lib/game/effects/cards']) {
    for (const f of readdirSync(join(ROOT, d))) if (f.endsWith('.ts')) files.push(d + '/' + f);
  }
  const bad = [];
  let scanned = 0;
  for (const rel of files) {
    if (rel === 'src/lib/game/engine.ts') continue;
    const raw = normEol(readFileSync(join(ROOT, rel), 'utf8'));
    let src; try { src = stripCommentsBlankChecked(raw, rel); } catch { src = raw; }
    for (const line of src.split('\n')) {
      if (!SPECIAL_NAMES.some((sp) => line.includes(sp))) continue;
      scanned++;
      if (/types\s*:|ALL_TYPES|'Colorless'|\bunits\b/.test(line)) bad.push(rel + '：' + line.trim());
    }
  }
  assert.ok(scanned > 5, '只掃到 ' + scanned + ' 行提到特殊能量卡名 ⇒ 掃描器壞了（下限斷言）');
  assert.strictEqual(bad.length, 0, 'engine 以外還有人列舉特殊能量規則：\n  ' + bad.join('\n  '));
  // ★ 正對照
  assert.ok(/types\s*:/.test("if (c.name === '古舊能量') return [{ types: ALL }];"), '偵測器對違規樣本沒反應');
});

console.log('\n【B】⭐⭐⭐ 站長裁示：火箭隊能量算 2 個');
T('B1 ⭐⭐⭐ countEnergy：1 張火箭隊能量 ⇒【超】2、【惡】2（修正前是各 1）', () => {
  const rkt = idByName('火箭隊能量');
  assert.ok(rkt, '卡池沒有火箭隊能量');
  for (const h of [HB, H1, H2]) {
    const e = mkE(rkt);
    const cm = countEnergy(mkHost(h, [e]), pool);
    assert.strictEqual(cm.get('Psychic') ?? 0, 2, '【超】應為 2（卡面「視為提供2個…」）');
    assert.strictEqual(cm.get('Darkness') ?? 0, 2, '【惡】應為 2');
    for (const t of TYPES) {
      if (t === 'Psychic' || t === 'Darkness') continue;
      assert.strictEqual(cm.get(t) ?? 0, 0, '火箭隊能量不該提供 ' + t);
    }
  }
});
T('B2 ⭐⭐ 零回歸：付費端本來就認 2（1 張火箭隊付得出【超】【超】，付不出【超】【超】【超】）', () => {
  const rkt = idByName('火箭隊能量');
  const e = mkE(rkt);
  const host = mkHost(H1, [e]);
  assert.strictEqual(!!canAffordAttack(host, ['Psychic', 'Psychic'], pool), true, '應付得出 2 個【超】');
  assert.strictEqual(!!canAffordAttack(host, ['Psychic', 'Darkness'], pool), true, '應付得出 1 超 1 惡');
  assert.strictEqual(!!canAffordAttack(host, ['Psychic', 'Psychic', 'Psychic'], pool), false, '不該付得出 3 個【超】');
  assert.strictEqual(totalEnergyUnits([e], pool, undefined, undefined, host), 2, '撤退端應為 2 個單位');
});
T('B3 ⭐⭐ 卡面查證：火箭隊能量的 rulesText 明寫「視為提供2個【超】【惡】2種屬性的能量」', () => {
  const rkt = pool.get(String(idByName('火箭隊能量')));
  const rt = String(rkt?.rulesText ?? '').replace(/\s+/g, '');
  assert.ok(rt.includes('視為提供2個【超】【惡】2種屬性的能量'), '卡面措辭變了：' + rt.slice(0, 80));
});

console.log('\n【C】⭐⭐ 收斂時最容易弄壞的兩個邊界');
T('C1 ⭐⭐⭐ host = null 的保守分支：getEnergyUnits 對稜鏡／新衝天／燃火一律回「1 個【無】」', () => {
  for (const name of ['稜鏡能量', '新衝天能量', '燃火能量']) {
    const id = idByName(name);
    assert.ok(id, '卡池沒有 ' + name);
    const us = getEnergyUnits(String(id), pool);
    assert.strictEqual(us.length, 1, name + ' 在沒有 host 時應為 1 個單位，實得 ' + us.length);
    assert.deepStrictEqual(us[0].types, ['Colorless'],
      name + ' 在沒有 host 時應只提供【無】，實得 ' + JSON.stringify(us[0].types)
      + ' —— 中央 helper 的 hasHost 保守分支被改壞了（會讓沒帶 host 的呼叫端突然變成全屬性）');
  }
  // ★ 對照：有 host 時就必須展開（證明上面不是「一律 Colorless」）
  const prism = mkE(idByName('稜鏡能量'));
  assert.strictEqual(energyTypeUnitsHostAware(mkHost(HB, [prism]), prism, 'Fire', pool), 1,
    '稜鏡附【基礎】時應視為提供【火】');
});
T('C2 ⭐⭐ 繁茂（opts.bloom）：基本【草】＝ 2 個【草】單位，且只影響基本【草】', () => {
  let grassId = null, fireId = null;
  for (const [id, c] of pool) {
    if (c?.supertype !== 'Energy' || c?.subtype !== 'Basic') continue;
    if (!grassId && /【草】/.test(c.name)) grassId = id;
    if (!fireId && /【火】/.test(c.name)) fireId = id;
  }
  assert.ok(grassId && fireId, '卡池找不到基本【草】/【火】能量');
  const g = mkE(grassId), f = mkE(fireId);
  const host = mkHost(H1, [g, f]);
  const gb = energyUnitsOnHost(g, host, pool, { bloom: true });
  assert.notStrictEqual(gb, MISSING, 'energyUnitsOnHost 缺席');
  assert.strictEqual(gb.length, 2, '繁茂時基本【草】應為 2 個單位');
  assert.deepStrictEqual(gb.map((u) => u.types), [['Grass'], ['Grass']]);
  assert.strictEqual(energyUnitsOnHost(g, host, pool, { bloom: false }).length, 1, '沒繁茂時應為 1 個');
  assert.strictEqual(energyUnitsOnHost(f, host, pool, { bloom: true }).length, 1, '繁茂不該影響基本【火】');
  // ★ 稜鏡等特殊能量也不該被繁茂加倍
  const prism = mkE(idByName('稜鏡能量'));
  assert.strictEqual(energyUnitsOnHost(prism, mkHost(HB, [prism]), pool, { bloom: true }).length, 1,
    '繁茂只加倍**基本**【草】能量');
});
T('C3 ⭐⭐ 零回歸：五張 host-dependent 的單位數逐格釘死（與 v6.400 的 D 組同一組數字）', () => {
  const cases = [
    ['稜鏡能量', HB, 1, ['Grass', 'Fire', 'Colorless']],       // 附【基礎】= 1 個全屬性單位
    ['稜鏡能量', H2, 1, ['Colorless']],                         // 附進化 = 1 個【無】
    ['新衝天能量', H2, 2, ['Grass', 'Colorless']],              // 附【2階】= 2 個全屬性
    ['新衝天能量', HB, 1, ['Colorless']],
    ['燃火能量', H1, 3, ['Colorless']],                          // 附進化 = 3 個【無】
    ['燃火能量', HB, 1, ['Colorless']],
    ['古舊能量', HB, 1, ['Grass', 'Colorless']],
    ['火箭隊能量', HB, 2, ['Psychic', 'Darkness']],
  ];
  for (const [name, host, wantLen, mustInclude] of cases) {
    const id = idByName(name);
    const e = mkE(id);
    const us = energyUnitsOnHost(e, mkHost(host, [e]), pool);
    assert.strictEqual(us.length, wantLen, name + ' on ' + pool.get(String(host))?.stage + ' 應為 ' + wantLen + ' 個單位');
    for (const ty of mustInclude) {
      assert.ok(us.some((u) => u.types.includes(ty)), name + ' 的單位應含 ' + ty);
    }
  }
});
T('D1 ⭐ 釘住「統一 evolvesFrom 判準對標準賽零影響」這個事實', () => {
  // canAffordAttack 原本的「是不是進化」少了 evolvesFrom 那一項；統一之後只會影響
  // 「有 evolvesFrom 但 stage 不是 Stage1/Stage2」的卡 —— H/I/J 必須一張都沒有。
  let hij = 0, total = 0;
  for (const [, c] of pool) {
    if (c?.supertype !== 'Pokemon') continue;
    const st = c.stage ?? c.subtype;
    if (!c.evolvesFrom || st === 'Stage1' || st === 'Stage2') continue;
    total++;
    if (['H', 'I', 'J'].includes(String(c.regulationMark))) hij++;
  }
  assert.ok(total > 0, '卡池裡一張這種卡都沒有 ⇒ 這條斷言變成空真（掃描器可能壞了）');
  assert.strictEqual(hij, 0,
    'H/I/J 出現了 ' + hij + ' 張「有 evolvesFrom 但 stage 不是 Stage1/Stage2」的卡 ⇒'
    + ' 統一判準會改變標準賽行為，必須重新評估（v6.401 當時是 0 張）');
});

console.log('\n【E】chain');
T('E1 本守衛已掛進 npm test chain', () => {
  assert.ok(readFileSync(join(ROOT, 'package.json'), 'utf8').includes('test-v6401-energy-units-central.mjs'));
});

console.log('\n=== v6.401 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
