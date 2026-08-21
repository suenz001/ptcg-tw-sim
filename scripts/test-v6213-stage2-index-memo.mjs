#!/usr/bin/env node
/**
 * v6.213 守衛 ①：isStage2 全卡池線性掃描 → per-pool 索引（記憶化）
 *
 * 這一版在改什麼
 * ──────────────────────────────────────────────────────────────────────────
 *   v3001_g3_wave3.ts 的 `isStage2`（海兔獸｜黏著束縛的特性消除閘）與
 *   engine.ts 的 `isStage2PokemonCard`／draw_supporters.ts 的
 *   `isStage2PokemonCardLocal` 三支，原本每呼叫一次就對**整個卡池**線性掃描，
 *   迴圈內每張卡各跑一次名稱正規化（v3001 那份連迴圈不變量都每輪重算）。
 *   改走 `$lib/game/stage2-index` 的 per-pool 索引（WeakMap 掛 pool 物件 + size 自癒）。
 *
 * 這支守衛在證明什麼（每一條都標了它抓得到什麼）
 * ──────────────────────────────────────────────────────────────────────────
 *   [HEAD-FAIL] 還原成 v6.212 重跑會 FAIL 的條目。
 *   [差分]      對**全卡池每一張**跑「舊實作 vs 新實作」，結果必須逐字相同。
 *               ⚠ 舊實作是本檔內**重新手寫**的原碼副本，不是 import 新碼再比自己
 *                 （那是恆真式）。副本本身另有正對照證明它抓得到差異。
 *   [跨 pool]   兩份不同的 pool 對同一張卡必須各自算各自的，且**不可互相污染**。
 *   [自癒]      同一個 Map 被塞進新卡（size 變了）⇒ 索引必須重建。
 *   [非 placebo] 用 `__stage2IndexBuildCount()` 證明「第二次呼叫真的沒有重建索引」，
 *               否則整個改動等於沒做（而全部斷言仍會綠 —— 那就是 placebo）。
 *   [微基準]    舊 vs 新的實際耗時，印出來給人看（不設門檻當斷言，機器負載會飄）。
 *
 * Run: node scripts/test-v6213-stage2-index-memo.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.s2-e.ts'), O = join(ROOT, '.s2-o.mjs'), S = join(ROOT, '.s2-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, [
  `export { isStage2ByEvoVariant, isStage2ByPlainEx, isStage2ByExactName, normalizeEvoVariantName, normalizePlainExName, __stage2IndexBuildCount } from './src/lib/game/stage2-index';`,
  `export { sameEvoName } from './src/lib/game/effects/_shared';`,
  `export { isStage2PokemonCard } from './src/lib/game/engine';`,
].join('\n'));
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const M = await import(pathToFileURL(O).href);

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// ── 卡池（與其他守衛同一套載法：只收 index.json 列出的活卡包）──────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const POOL = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) POOL.set(String(c.id), c);
}
console.log('卡池張數:', POOL.size);
T('[前提] 卡池不是空的（否則後面每一條差分都變成恆真式）', () => assert.ok(POOL.size > 3000, '只載到 ' + POOL.size + ' 張'));

// ══════════════════════════════════════════════════════════════════════════
// 0. 舊實作的手寫副本（v6.212 原碼，逐行照抄）—— 差分的「對照組」
//    ⚠ 這裡**不可以**呼叫新碼，否則整個差分就是 `f(x)===f(x)` 的恆真式。
// ══════════════════════════════════════════════════════════════════════════
function OLD_sameEvoName(a, b) {                       // _shared.ts v6.212
  if (!a || !b) return false;
  if (a === b) return true;
  const normalize = (s) => {
    let r = s;
    if (r.endsWith('ex')) r = r.slice(0, -2);
    if (r.startsWith('超級')) r = r.slice(2);
    return r;
  };
  return normalize(a) === normalize(b);
}
function OLD_isStage2PokemonCard(card, pool) {         // engine.ts v6.212 L1043
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  for (const c of pool.values()) {
    if (OLD_sameEvoName(c.name, card.evolvesFrom) && c.supertype === 'Pokemon' && c.evolvesFrom) return true;
  }
  return false;
}
function OLD_oppHasStage2_scan(card, pool) {           // v3070_deferred_wave_d.ts v6.212 L267-275
  if (card && card.evolvesFrom) {
    for (const v of pool.values()) {
      if (v.name === card.evolvesFrom && v.evolvesFrom) return true;
    }
  }
  return false;
}
function OLD_isStage2_v3001(card, pool) {              // v3001_g3_wave3.ts v6.212 L355
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  for (const c of pool.values()) {
    const a = (card.evolvesFrom ?? '').replace(/ex$/, '').trim();
    const b = (c.name ?? '').replace(/ex$/, '').trim();
    if (a === b && c.supertype === 'Pokemon' && c.evolvesFrom) return true;
  }
  return false;
}

console.log('\n1) 對照組自我驗證（證明手寫副本抓得到差異，不是永遠都對的擺設）');
T('[自我驗證] 對照組在真卡池上會回 true 也會回 false（不是常數函式）', () => {
  let t = 0, f2 = 0;
  for (const c of POOL.values()) { if (OLD_isStage2PokemonCard(c, POOL)) t++; else f2++; }
  assert.ok(t > 50, '2 階卡只有 ' + t + ' 張，太少');
  assert.ok(f2 > 50, '非 2 階卡只有 ' + f2 + ' 張，太少');
});
T('[自我驗證] 兩份對照組的判準**真的不同**（「超級」前綴那一段）', () => {
  // 造一份最小 pool：只有「超級龍頭地鼠ex」這個 Stage1（有 evolvesFrom）。
  const p = new Map();
  p.set('1', { id: '1', name: '超級龍頭地鼠ex', supertype: 'Pokemon', evolvesFrom: '龍頭地鼠' });
  const probe = { id: '2', name: 'X', supertype: 'Pokemon', evolvesFrom: '龍頭地鼠' };
  //  sameEvoName 版：normalize('超級龍頭地鼠ex')='龍頭地鼠' === normalize('龍頭地鼠') ⇒ true
  assert.strictEqual(OLD_isStage2PokemonCard(probe, p), true, 'sameEvoName 版應為 true');
  //  v3001 簡化版：'超級龍頭地鼠' !== '龍頭地鼠' ⇒ false
  assert.strictEqual(OLD_isStage2_v3001(probe, p), false, 'v3001 簡化版應為 false');
});

console.log('\n2) ⭐差分：全卡池逐張，舊實作 vs 新實作必須逐字相同');
T('[差分／核心①] sameEvoName 語義：4935 張逐張比對', () => {
  const bad = [];
  for (const c of POOL.values()) {
    const a = OLD_isStage2PokemonCard(c, POOL);
    const b = M.isStage2ByEvoVariant(c, POOL);
    if (a !== b) bad.push(c.id + ' ' + c.name + ' old=' + a + ' new=' + b);
    if (bad.length > 5) break;
  }
  assert.deepStrictEqual(bad, [], '不一致：' + bad.join(' | '));
});
T('[差分／核心①] v3070 逐字比對語義（不檢查 supertype）：4935 張逐張比對', () => {
  const bad = [];
  for (const c of POOL.values()) {
    const a = OLD_oppHasStage2_scan(c, POOL);
    const b = M.isStage2ByExactName(c.evolvesFrom, POOL);
    if (a !== b) bad.push(c.id + ' ' + c.name + ' old=' + a + ' new=' + b);
    if (bad.length > 5) break;
  }
  assert.deepStrictEqual(bad, [], '不一致：' + bad.join(' | '));
});
T('[差分／核心①] 三種判準**真的不同**（這條證明「不能合併」不是藉口）', () => {
  const p = new Map([['1', { id: '1', name: '超級龍頭地鼠ex', supertype: 'Pokemon', evolvesFrom: '龍頭地鼠' }]]);
  const probe = { id: '2', name: 'X', supertype: 'Pokemon', evolvesFrom: '龍頭地鼠' };
  assert.strictEqual(M.isStage2ByEvoVariant(probe, p), true, 'evoVariant 應為 true');
  assert.strictEqual(M.isStage2ByPlainEx(probe, p), false, 'plainEx 應為 false');
  assert.strictEqual(M.isStage2ByExactName(probe.evolvesFrom, p), false, 'exactName 應為 false');
  const p2 = new Map([['1', { id: '1', name: '怪異卡', supertype: 'Trainer', evolvesFrom: '某某' }]]);
  const probe2 = { id: '2', name: 'Y', supertype: 'Pokemon', evolvesFrom: '怪異卡' };
  assert.strictEqual(M.isStage2ByEvoVariant(probe2, p2), false, 'evoVariant 會檢查 supertype');
  assert.strictEqual(M.isStage2ByExactName(probe2.evolvesFrom, p2), true, 'exactName 刻意不檢查 supertype');
});
T('[差分／核心①] v3001 簡化版語義：4935 張逐張比對', () => {
  const bad = [];
  for (const c of POOL.values()) {
    const a = OLD_isStage2_v3001(c, POOL);
    const b = M.isStage2ByPlainEx(c, POOL);
    if (a !== b) bad.push(c.id + ' ' + c.name + ' old=' + a + ' new=' + b);
    if (bad.length > 5) break;
  }
  assert.deepStrictEqual(bad, [], '不一致：' + bad.join(' | '));
});
T('[差分] engine 匯出的 isStage2PokemonCard（真正被全站呼叫的那支）也逐張相同', () => {
  const bad = [];
  for (const c of POOL.values()) {
    const a = OLD_isStage2PokemonCard(c, POOL);
    const b = M.isStage2PokemonCard(c, POOL);
    if (a !== b) bad.push(c.id + ' ' + c.name + ' old=' + a + ' new=' + b);
    if (bad.length > 5) break;
  }
  assert.deepStrictEqual(bad, [], '不一致：' + bad.join(' | '));
});
T('[差分] sameEvoName 本身（normalize 收斂後）：全卡名兩兩對自己與對 evolvesFrom 都不變', () => {
  const names = [...new Set([...POOL.values()].map((c) => c.name).filter(Boolean))];
  const evos = [...new Set([...POOL.values()].map((c) => c.evolvesFrom).filter(Boolean))];
  let n = 0;
  for (const a of names) for (const b of evos) {
    if (OLD_sameEvoName(a, b) !== M.sameEvoName(a, b)) throw new Error('sameEvoName 不一致: ' + a + ' vs ' + b);
    n++;
  }
  assert.ok(n > 100000, '只比了 ' + n + ' 組，太少');
});
T('[差分／邊界] undefined / 空字串 / 只有 "ex" / 前後空白 都與舊實作相同', () => {
  const p = new Map();
  p.set('a', { id: 'a', name: '', supertype: 'Pokemon', evolvesFrom: 'X' });
  p.set('b', { id: 'b', name: 'ex', supertype: 'Pokemon', evolvesFrom: 'Y' });
  p.set('c', { id: 'c', name: '  皮卡丘  ', supertype: 'Pokemon', evolvesFrom: 'Z' });
  p.set('d', { id: 'd', name: '沒有進化前', supertype: 'Pokemon' });
  p.set('e', { id: 'e', name: '道具', supertype: 'Trainer', evolvesFrom: 'Q' });
  const probes = [
    undefined, null,
    { supertype: 'Pokemon', evolvesFrom: '' },
    { supertype: 'Pokemon', evolvesFrom: 'ex' },
    { supertype: 'Pokemon', evolvesFrom: '皮卡丘' },
    { supertype: 'Pokemon', evolvesFrom: '  皮卡丘  ' },
    { supertype: 'Pokemon', evolvesFrom: '沒有進化前' },
    { supertype: 'Trainer', evolvesFrom: '皮卡丘' },
  ];
  for (const q of probes) {
    assert.strictEqual(M.isStage2ByEvoVariant(q, p), OLD_isStage2PokemonCard(q, p), 'evoVariant 邊界: ' + JSON.stringify(q));
    assert.strictEqual(M.isStage2ByPlainEx(q, p), OLD_isStage2_v3001(q, p), 'plainEx 邊界: ' + JSON.stringify(q));
  }
});

console.log('\n3) ⭐⭐跨 pool 不污染 + size 自癒');
T('[跨 pool／核心①] 兩份不同 pool 對同一張卡各算各的，不互相污染', () => {
  const probe = { id: 'p', name: '探針', supertype: 'Pokemon', evolvesFrom: '中間態' };
  // poolA：有「中間態」而且它自己有 evolvesFrom ⇒ probe 是 2 階
  const A = new Map([['1', { id: '1', name: '中間態', supertype: 'Pokemon', evolvesFrom: '基礎' }]]);
  // poolB：也有「中間態」但它**沒有** evolvesFrom ⇒ probe 不是 2 階
  const B = new Map([['1', { id: '1', name: '中間態', supertype: 'Pokemon' }]]);
  assert.strictEqual(M.isStage2ByEvoVariant(probe, A), true, 'A 應為 true');
  assert.strictEqual(M.isStage2ByEvoVariant(probe, B), false, 'B 應為 false（被 A 的索引污染就會變 true）');
  // 交錯再問一次：快取生效之後仍然各自正確
  assert.strictEqual(M.isStage2ByEvoVariant(probe, A), true, 'A 第二次仍應 true');
  assert.strictEqual(M.isStage2ByEvoVariant(probe, B), false, 'B 第二次仍應 false');
  assert.strictEqual(M.isStage2ByPlainEx(probe, A), true, 'A plainEx 應 true');
  assert.strictEqual(M.isStage2ByPlainEx(probe, B), false, 'B plainEx 應 false');
});
T('[跨 pool] size 相同、內容不同的兩份 pool 也不會共用索引', () => {
  const probe = { supertype: 'Pokemon', evolvesFrom: '甲' };
  const A = new Map([['1', { name: '甲', supertype: 'Pokemon', evolvesFrom: '零' }]]);
  const B = new Map([['1', { name: '乙', supertype: 'Pokemon', evolvesFrom: '零' }]]);
  assert.strictEqual(A.size, B.size);
  assert.strictEqual(M.isStage2ByEvoVariant(probe, A), true);
  assert.strictEqual(M.isStage2ByEvoVariant(probe, B), false);
});
T('[自癒／核心①] 同一個 Map 被塞進新卡（ensurePoolForStateIds 的行為）⇒ 索引重建', () => {
  const probe = { supertype: 'Pokemon', evolvesFrom: '中間態' };
  const P = new Map([['x', { name: '無關', supertype: 'Trainer' }]]);
  assert.strictEqual(M.isStage2ByEvoVariant(probe, P), false, '一開始不該是 2 階');
  P.set('1', { name: '中間態', supertype: 'Pokemon', evolvesFrom: '基礎' });   // 後來才載進來
  assert.strictEqual(M.isStage2ByEvoVariant(probe, P), true, 'pool 長大之後必須重新算（否則就是舊索引卡住）');
});

console.log('\n4) ⭐非 placebo：索引真的只建一次');
T('[非 placebo] 同一個 pool 連問 500 次，索引重建次數只 +1', () => {
  const P = new Map([['1', { name: '中間態', supertype: 'Pokemon', evolvesFrom: '基礎' }]]);
  const probe = { supertype: 'Pokemon', evolvesFrom: '中間態' };
  const before = M.__stage2IndexBuildCount();
  for (let i = 0; i < 500; i++) M.isStage2ByEvoVariant(probe, P);
  for (let i = 0; i < 500; i++) M.isStage2ByPlainEx(probe, P);
  const delta = M.__stage2IndexBuildCount() - before;
  assert.strictEqual(delta, 1, '重建了 ' + delta + ' 次（1 才代表記憶化真的生效）');
});
T('[非 placebo／正對照] 每次換一份新 pool ⇒ 重建次數必須跟著漲（計數器不是死的）', () => {
  const before = M.__stage2IndexBuildCount();
  for (let i = 0; i < 7; i++) {
    const P = new Map([['1', { name: 'N' + i, supertype: 'Pokemon', evolvesFrom: '基礎' }]]);
    M.isStage2ByEvoVariant({ supertype: 'Pokemon', evolvesFrom: 'N' + i }, P);
  }
  assert.strictEqual(M.__stage2IndexBuildCount() - before, 7);
});

console.log('\n5) 微基準（只印數字，不當斷言 —— CI 機器負載會飄）');
{
  // 取 200 張真卡當查詢集，各跑 N 輪。
  const probes = [...POOL.values()].slice(0, 200);
  const N = 5;
  let t0 = process.hrtime.bigint();
  let acc = 0;
  for (let r = 0; r < N; r++) for (const c of probes) acc += OLD_isStage2_v3001(c, POOL) ? 1 : 0;
  const oldMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // 新版：先暖機一次把索引建起來（線上第一次呼叫也只付這一次）
  M.isStage2ByPlainEx(probes[0], POOL);
  t0 = process.hrtime.bigint();
  for (let r = 0; r < N; r++) for (const c of probes) acc += M.isStage2ByPlainEx(c, POOL) ? 1 : 0;
  const newMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const calls = N * probes.length;
  console.log('  舊實作 ' + oldMs.toFixed(1) + ' ms / ' + calls + ' 次 = ' + (oldMs * 1000 / calls).toFixed(1) + ' µs/call');
  console.log('  新實作 ' + newMs.toFixed(3) + ' ms / ' + calls + ' 次 = ' + (newMs * 1000 / calls).toFixed(3) + ' µs/call');
  console.log('  加速 ' + (oldMs / Math.max(newMs, 1e-6)).toFixed(0) + ' 倍（acc=' + acc + '，防最佳化消除）');
  T('[效能] 新實作至少快 20 倍（線性掃描 4935 張 vs 一次 Set.has，門檻刻意壓很鬆）',
    () => assert.ok(oldMs / Math.max(newMs, 1e-6) > 20, '只快了 ' + (oldMs / newMs).toFixed(1) + ' 倍'));
}

console.log('\n6) 結構：全站不可以再有「對整個 pool 線性掃描」的 2 階判定');
{
  // ⚠⚠ v6.213 第二輪 opus 審查抓到本節原本的兩個假綠，這裡是修正版：
  //   ①原本只掃**寫死的 3 個檔** ⇒ 其他檔案（effects.ts 就有 3 份）完全掃不到；
  //   ②regex 把迴圈變數寫死成 `const c` ⇒ 改個變數名（`const x`）就繞過去，
  //     而這一版整個賣點就是效能，效能回歸會 100% 靜默。
  //   ⇒ 改成「掃整個 src/lib/game + src/routes」＋變數名放寬成 \w+，
  //     並比照 test-v6210 的做法配一份**具名豁免表 + 死條目偵測**。
  const strip = (s2) => s2.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const walk = (d, out = []) => {
    for (const f of readdirSync(d)) {
      const pth = join(d, f);
      if (statSync(pth).isDirectory()) walk(pth, out);
      else if (f.endsWith('.ts') || f.endsWith('.svelte')) out.push(pth);
    }
    return out;
  };
  const FILES = [...walk(join(ROOT, 'src/lib/game')), ...walk(join(ROOT, 'src/routes'))]
    .map((pth) => [relative(ROOT, pth).split('\\').join('/'), strip(readFileSync(pth, 'utf8'))]);
  T('[自我驗證] 掃描器讀得到檔案而且沒把內容剝爆', () => {
    assert.ok(FILES.length > 40, '只掃到 ' + FILES.length + ' 個檔');
    assert.ok(FILES.every(([, t]) => typeof t === 'string'), '有檔案讀不到');
    assert.ok(FILES.some(([r]) => r === 'src/lib/game/effects.ts'), 'effects.ts 沒被掃到');
    assert.ok(FILES.find(([r]) => r === 'src/lib/game/effects.ts')[1].length > 500000, 'effects.ts 被剝爆了');
  });
  // 「對整個 pool 線性掃描 + 看 evolvesFrom + 直接 return true」的 **2 階判定** pattern。
  //   ⚠ 變數名一律 \w+（寫死 `const c` 的話，改個變數名就繞過去 —— 第二輪審查抓到的）。
  //   ⚠⚠ 必須帶 `return true`：effects.ts 還有三處同樣掃整個 pool 的迴圈，但它們做的是
  //     「由 Stage1 名字回推 Basic 名字」的**鏈結推導**（`basicName = …; break;`），
  //     語義不同、不在本版範圍。用「有沒有 return true」把兩者分開，就**不需要整檔豁免**
  //     ——整檔豁免太粗，會連同一個檔案裡新長出來的真違規一起放掉（第二輪審查實測會漏）。
  const SCAN = /for\s*\(\s*const\s+\w+\s+of\s+pool\.values\(\)\s*\)\s*\{(?:(?!basicName)[\s\S]){0,320}?evolvesFrom(?:(?!basicName)[\s\S]){0,60}?return true/g;
  // ⚠ 具名豁免表（比照 test-v6210 的做法，配死條目偵測）。目前**應該是空的**：
  //   收斂完之後全站不該再有這種寫法；索引建立本身沒有 `return true` 所以天然不會命中。
  const EXEMPT = new Map(Object.entries({}));
  const hits = [];
  for (const [rel, text] of FILES) {
    for (const m of text.matchAll(SCAN)) hits.push({ rel, at: m.index, src: m[0].replace(/\s+/g, ' ').slice(0, 100) });
  }
  T('[自我驗證／正對照] 掃描器抓得到違規樣本，也不會誤報合法寫法', () => {
    const probe = (txt) => [...strip(txt).matchAll(new RegExp(SCAN.source, 'g'))].length;
    // ★ 抓得到（三種變數名都要抓得到）
    assert.strictEqual(probe('for (const x of pool.values()) { if (f(x.name, c.evolvesFrom)) return true; }'), 1, '變數名 x 的違規樣本沒掃到');
    assert.strictEqual(probe('for (const c of pool.values()) { if (f(c.name, card.evolvesFrom)) return true; }'), 1, '變數名 c 的違規樣本沒掃到');
    assert.strictEqual(probe('for (const zz of pool.values()) { const a = 1; if (zz.name === card.evolvesFrom && zz.evolvesFrom) return true; }'), 1, '變數名 zz 的違規樣本沒掃到');
    // ★ 不誤報（這三種都不是 2 階判定）
    assert.strictEqual(probe('for (const c of pool.values()) { total += 1; }'), 0, '不看 evolvesFrom 的迴圈被誤報');
    assert.strictEqual(probe('// for (const c of pool.values()) { c.evolvesFrom } // return true'), 0, '註解沒被剝乾淨');
    assert.strictEqual(probe('for (const c of pool.values()) { if (f(c.name, s2.evolvesFrom) && c.evolvesFrom) { basicName = c.evolvesFrom; break; } }'), 0,
      '鏈結推導（basicName）被誤報成 2 階判定');
  });
  T('[HEAD-FAIL／核心①] 全站（src/lib/game + src/routes）不得再有未豁免的全卡池 2 階線性掃描', () => {
    const bad = hits.filter((h) => !EXEMPT.has(h.rel));
    assert.deepStrictEqual(bad.map((h) => h.rel + ' :: ' + h.src), [],
      '還有 ' + bad.length + ' 處線性掃描沒收斂');
  });
  T('[死條目] 豁免表裡的每一個檔案都確實還有命中（沒命中就該把豁免刪掉）', () => {
    const dead = [...EXEMPT.keys()].filter((k) => !hits.some((h) => h.rel === k));
    assert.deepStrictEqual(dead, [], '死條目：' + dead.join(', '));
  });
  T('[HEAD-FAIL／接線] 原本各自線性掃描的五個檔案都 import 了 stage2-index', () => {
    const need = {
      'src/lib/game/engine.ts': /from '\.\/stage2-index'/,
      'src/lib/game/effects.ts': /from '\.\/stage2-index'/,
      'src/lib/game/effects/cards/v3001_g3_wave3.ts': /from '\.\.\/\.\.\/stage2-index'/,
      'src/lib/game/effects/cards/draw_supporters.ts': /from '\.\.\/\.\.\/stage2-index'/,
      'src/lib/game/effects/cards/v3070_deferred_wave_d.ts': /from '\.\.\/\.\.\/stage2-index'/,
    };
    const miss = Object.entries(need).filter(([rel, re]) => !re.test(FILES.find(([r]) => r === rel)?.[1] ?? ''));
    assert.deepStrictEqual(miss.map((x) => x[0]), []);
  });
  T('[結構] stage2-index 是 leaf：除了 import type 之外零 import（循環 import ⇒ TDZ）', () => {
    const src = readFileSync(join(ROOT, 'src/lib/game/stage2-index.ts'), 'utf8');
    const imports = src.match(/^import .*$/gm) || [];
    assert.ok(imports.length > 0, '一行 import 都沒有？檔案讀錯了');
    for (const l of imports) assert.ok(l.startsWith('import type '), '非 type import：' + l);
  });
  T('[結構] _shared.ts 的 sameEvoName 不再自己寫一份 normalize（單一來源）', () => {
    const sh = strip(readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8'));
    const at = sh.indexOf('export function sameEvoName');
    const body = sh.slice(at, at + 700);
    assert.ok(!/const normalize\s*=/.test(body), 'sameEvoName 內還有 local normalize');
    assert.ok(/normalizeEvoVariantName/.test(body), 'sameEvoName 沒改用中央 normalize');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 7. ⭐⭐⭐消費端覆蓋：把**真正被呼叫的那一支**跑起來
//    （opus 審查抓到：v3001 的 isStage2 是 module-private，前面每一條差分／微基準
//      比的都是中央 helper —— 把 v3001 那支改回線性掃描，全部照樣綠。）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n7) 消費端覆蓋：海兔獸｜黏著束縛的閘（真正呼叫 isStage2 的地方）');
{
  const E2 = join(ROOT, '.s2-e2.ts'), O2 = join(ROOT, '.s2-o2.mjs');
  process.on('exit', () => { for (const p2 of [E2, O2]) { try { unlinkSync(p2); } catch { /* */ } } });
  writeFileSync(E2, `export { isAbilityNullifiedBySticky } from './src/lib/game/effects/cards/v3001_g3_wave3';`);
  await build({ entryPoints: [E2], outfile: O2, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  const V3 = await import(pathToFileURL(O2).href);
  // 最小盤面：對手備戰有「海兔獸」且帶「黏著束縛」；受測者在備戰。
  const SEA = { id: 'sea', name: '海兔獸', supertype: 'Pokemon', evolvesFrom: '海兔獸幼', abilities: [{ name: '黏著束縛', text: '' }] };
  const BASE0 = { id: 'b', name: '基礎', supertype: 'Pokemon' };
  const ST1 = { id: 's1', name: '中間態', supertype: 'Pokemon', evolvesFrom: '基礎' };
  const ST2 = { id: 's2', name: '二階', supertype: 'Pokemon', evolvesFrom: '中間態', abilities: [{ name: '某特性', text: '' }] };
  const mkPool = () => new Map([['sea', SEA], ['b', BASE0], ['s1', ST1], ['s2', ST2],
    ['sea0', { id: 'sea0', name: '海兔獸幼', supertype: 'Pokemon' }]]);
  const mkState = () => ({
    players: [
      { active: null, bench: [{ iid: 'i1', cardId: 's2', damage: 0, energyAttached: [] }], hand: [], deck: [], discard: [], prizes: [] },
      { active: null, bench: [{ iid: 'i2', cardId: 'sea', damage: 0, energyAttached: [] }], hand: [], deck: [], discard: [], prizes: [] },
    ],
  });
  const inst = { iid: 'i1', cardId: 's2', damage: 0, energyAttached: [] };
  T('★★★[消費端] 備戰的 2 階寶可夢，特性真的被「黏著束縛」消除（走的是 v3001 那支 isStage2）', () => {
    assert.strictEqual(V3.isAbilityNullifiedBySticky(mkState(), inst, ST2, true, mkPool()), true);
  });
  T('★★★[消費端／正對照] 備戰的 1 階寶可夢**不會**被消除（判準沒有一律回 true）', () => {
    assert.strictEqual(V3.isAbilityNullifiedBySticky(mkState(), { iid: 'i1', cardId: 's1', damage: 0, energyAttached: [] }, ST1, true, mkPool()), false);
  });
  T('★★★[消費端] 同一個 pool 連問 2000 次 ⇒ 索引只重建 1 次（真正的呼叫路徑也吃到記憶化）', () => {
    const pool2 = mkPool();
    const st = mkState();
    M.isStage2ByPlainEx(ST2, pool2);   // 暖機
    const before = M.__stage2IndexBuildCount();
    for (let k = 0; k < 2000; k++) V3.isAbilityNullifiedBySticky(st, inst, ST2, true, pool2);
    const delta = M.__stage2IndexBuildCount() - before;
    assert.strictEqual(delta, 0, '重建了 ' + delta + ' 次 —— 消費端沒有吃到記憶化');
  });
  T('★★[消費端] 消費端的微基準：2000 次呼叫在 50ms 內（線性掃描版做不到）', () => {
    const pool2 = mkPool();
    const st = mkState();
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 2000; k++) V3.isAbilityNullifiedBySticky(st, inst, ST2, true, pool2);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log('  消費端 2000 次呼叫：' + ms.toFixed(2) + ' ms');
    assert.ok(ms < 50, ms.toFixed(2) + ' ms');
  });
}

console.log('\n=== v6.213 ① stage2 per-pool 索引: ' + pass + ' PASS / ' + fail + ' FAIL ===');
console.log('=== SCRIPT-END v6213-stage2-index-memo ===');
if (fail) process.exit(1);
