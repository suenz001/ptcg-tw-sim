#!/usr/bin/env node
/**
 * ⭐⭐⭐ v6.385 守衛：「能量的數量」＝**個數**，而且 host-aware ＋ 場上特性 aware。
 *
 * 來源：玩家回報「大竺葵｜繁茂在場，阿羅拉椰蛋樹的 3 顆草沒有被算成 6 個」。
 * 查證結果：椰蛋樹｜一長再長那條**是對的**，但順著做全站 audit 挖出 9 張真的漏網的卡。
 *
 * ⚠⚠⚠ 根因不是某張卡寫錯，是**同一個判準有三份**：
 *   ・countEnergyTypeHostAware（22 個呼叫點）—— v6.385 之前**完全沒有繁茂**
 *   ・countEnergyTypeBloomAware（3 個呼叫點）—— 有繁茂
 *   ・selfAllEnergyMultiplyPre 裡一份 v3.731 的 inline 繁茂分支 —— 與中央算法不一致
 *   再加上 countAttachedEnergyAsUnits / countOneEnergy 的 state/ownerIdx 是 **optional**，
 *   「忘了傳」是靜默的（v6.069 修過 8 個點，後來新卡又漏回去）。
 *
 * v6.385 的收斂：三份併成一份、參數改必填（漏傳 ⇒ 編譯錯誤）。
 *
 * 【A】中央述詞：真的跑，含特性消除閘
 * 【B】⭐ 行為端矩陣：卡池裡**每一張**「能量的數量」型的 H/I/J 卡 × 有無繁茂，自動跑 applyAction
 * 【C】收斂：不得再出現第二份繁茂判準（inline +2）
 * 【D】必填化：所有呼叫點都要帶 ctx / state（漏傳＝靜默少算，這條釘住它）
 * 【E】站長裁定逐字錨
 * 【F】HEAD-FAIL：BASE(v6.384) 沒有這些東西 ⇒ 必須紅
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = join(ROOT, '.xv6385-s.js'), E = join(ROOT, '.xv6385-e.ts'), O = join(ROOT, '.xv6385-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });

// ⚠ HEAD-FAIL 的 BASE ＝ 本版的前一版（v6.384）。過期的唯一後果是【F】整段 skip（會大聲印出來）。
const BASE_SHA = 'd369184c386060a6f1f1b700f6fae6b34850be13';   // v6.384

const rd = (rel) => { try { return normEol(readFileSync(join(ROOT, rel), 'utf8')); } catch { return ''; } };
const EFFECTS = rd('src/lib/game/effects.ts');
const SHARED = rd('src/lib/game/effects/_shared.ts');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  let v = cond;
  if (typeof cond === 'function') { try { v = cond(); } catch (e) { v = false; extra = extra || ('例外：' + (e && e.message)); } }
  if (v && typeof v.then === 'function') { v = false; extra = extra || '斷言回傳 Promise（async 的要用 okA）'; }
  if (v) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};
/** async 版的 ok（⚠ 直接把 async thunk 丟給 ok() 會拿到 Promise ＝ 恆真，是安慰劑）。 */
const okA = async (name, fn, extra = '') => {
  let v = false, ex = extra;
  try { v = await fn(); } catch (e) { v = false; ex = ex || ('例外：' + (e && e.message)); }
  ok(name, !!v, ex);
};

// ── 引擎 harness（真的跑）
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction, getEffectiveHP } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
let M = null, modErr = '';
try {
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
  M = await import(pathToFileURL(O).href);
} catch (e) { modErr = '引擎 bundle 失敗：' + String(e && e.message).split('\n')[0]; }

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Grass;
const BLOOM = all.filter((c) => (c.abilities || []).some((a) => a.name === '繁茂'))[0];
const LAVA = all.find((c) => c.name === '傳說的熔岩洞');
const EGG = all.filter((c) => c.name === '阿羅拉 椰蛋樹' && (c.abilities || []).some((a) => a.name === '一長再長'))[0];
const TANK = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && Number(c.hp) >= 200 && c.pokemonType === 'Colorless');
let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false, activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)], ...extra });
const withCoin = (heads, fn) => { const o = Math.random; Math.random = () => (heads ? 0.1 : 0.9); try { return fn(); } finally { Math.random = o; } };
/**
 * log 的**數字序列**（比對用）。
 * ⚠ 兩個各自踩過的坑，兩條都要：
 *   ① log 裡有 iid（`i1599`）每次建盤面都不同 ⇒ 直接比整份 log 會**永遠有差**＝恆真安慰劑
 *      （v6.385 第一輪我自己踩的）。
 *   ② 只比 log **文字**也不夠：突變把繁茂關掉但 log 仍然印「（繁茂×2 套用基本【草】）」字樣時，
 *      文字有差、**數字沒差** ⇒ 照樣綠（Fable 5 複審 🟡8 實測存活）。
 *      ⇒ 這裡只留**數字**，字樣一律丟掉。
 */
const norm = (r) => {
  const lines = (r?.log || []).map((l) => String(l?.message ?? l?.text ?? l))
    .map((l) => l.replace(/i\d+/g, '#'))
    // ⭐⭐⭐v6.385d（Fable 5 第三輪 🔴2）：log 裡的「（繁茂×2 套用基本【草】）」這種**解釋性字樣**
    //   本身就帶一個 2（src/lib/game/effects.ts:8647、v155_attacks.ts:117）。抽數字時會把它一起抽走
    //   ⇒ 只要繁茂在場，數字序列就必然多一個 2 ⇒ B1 對那批卡**恆真**。
    //   Fable 突變實證：把 v155 巨型花束的 `grassCount += 2` 改成 `+= 1`、把 selfAllEnergyMultiplyPre
    //   的 ctx 換成 {state:null, ownerIdx:null}（繁茂整個失效），守衛照樣 43/0 全綠。
    //   ⇒ 抽數字**之前**先把這種字樣整段剝掉（B0d 守著這件事）。
    .map((l) => l.replace(/（繁茂×2[^）]*）/g, ''))
    .filter((l) => /\d/.test(l))
    .filter((l) => !/獎賞卡|被擊倒|抽了|洗入|放回/.test(l));
  return (lines.join(' | ').match(/\d+/g) || []).join(',');
};

// ══ 【A】中央述詞（真的跑）═══════════════════════════════════════════════
console.log('\n【A】中央述詞：繁茂在場時「基本【草】＝2 個」，特性被消除時退回');
const okm = (name, thunk) => ok(name, modErr ? false : thunk, modErr || '');
okm('A0 哨兵：fixture 都抓得到（大竺葵｜繁茂／傳說的熔岩洞／阿羅拉椰蛋樹／基本【草】）',
  () => !!(BLOOM && LAVA && EGG && EID.Grass && TANK));
okm('A1 ⭐⭐⭐ 一長再長：3 張基本草 ＋ 繁茂在備戰 ⇒ 最大 HP +250（玩家回報的那個盤面）', () => {
  const egg = inst(EGG.id, { energyAttached: [inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] });
  const st = mk({ active: egg, bench: [inst(BLOOM.id)] }, { active: inst(TANK.id) });
  return M.getEffectiveHP(egg, pool, st) === Number(EGG.hp) + 250;
});
okm('A2 ⭐ 反對照：同樣 3 張基本草、**沒有**大竺葵 ⇒ 不加成（證明差異真的來自繁茂）', () => {
  const egg = inst(EGG.id, { energyAttached: [inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] });
  const st = mk({ active: egg }, { active: inst(TANK.id) });
  return M.getEffectiveHP(egg, pool, st) === Number(EGG.hp);
});
okm('A3 ⭐⭐⭐ 繁茂在【戰鬥場】也算（卡面是「只要這隻寶可夢在場上」）', () => {
  const egg = inst(EGG.id, { energyAttached: [inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] });
  const st = mk({ active: inst(BLOOM.id), bench: [egg] }, { active: inst(TANK.id) });
  return M.getEffectiveHP(egg, pool, st) === Number(EGG.hp) + 250;
});
okm('A4 ⭐⭐⭐ 大竺葵在**對手**場上 ⇒ 不生效（卡面：「自己的所有寶可夢」）', () => {
  const egg = inst(EGG.id, { energyAttached: [inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] });
  const st = mk({ active: egg }, { active: inst(TANK.id), bench: [inst(BLOOM.id)] });
  return M.getEffectiveHP(egg, pool, st) === Number(EGG.hp);
});
// ⚠⚠ Fable 5 複審 🔴6：原本寫 `!== EGG.hp + 250`，但增強【草】能量卡面自帶
//   「附有這張卡的【草】寶可夢的最大HP +20」⇒ 3 張永遠是 +60，HP 永遠不等於 400
//   ⇒ 那是**恆真斷言**。突變「中央繁茂分支拿掉 subtype==='Basic'」（HP 變 460）照樣 PASS。
//   ⇒ 改成斷言**精確值**：只加增強草自己的 +20×3，繁茂一個都不能加。
okm('A5 ⭐⭐⭐ 繁茂只吃「基本【草】能量」卡：3 張增強【草】能量 ⇒ 只有 +60（增強草自己的 HP 加成）', () => {
  const enh = all.find((c) => c.supertype === 'Energy' && c.name === '增強【草】能量');
  if (!enh) throw new Error('fixture 找不到 增強【草】能量');
  const egg = inst(EGG.id, { energyAttached: [inst(enh.id), inst(enh.id), inst(enh.id)] });
  const st = mk({ active: egg, bench: [inst(BLOOM.id)] }, { active: inst(TANK.id) });
  const got = M.getEffectiveHP(egg, pool, st);
  if (got !== Number(EGG.hp) + 60) throw new Error('實際 ' + got + '（期望 ' + (Number(EGG.hp) + 60) + '）');
  return true;
});
// ⚠⚠ Fable 5 複審 🔴5：原本用「一長再長」當量尺 —— 但椰蛋樹自己是 Stage1，熔岩洞會**同時**
//   消掉它自己的特性 ⇒ 不論繁茂有沒有被消除，答案都是 150 ⇒ 恆真。突變「hasBloomOnField 的
//   備戰分支拿掉 isAbilityHolderEffective」照樣全綠。
//   ⇒ 改用**招式**（椰蛋樹｜木之重壓）當量尺：熔岩洞只消特性、不影響招式，
//     所以數字差異**只**來自「大竺葵（Stage2）的繁茂有沒有被消掉」這單一變因。
await okA('A6 ⭐⭐⭐ 繁茂被特性消除（傳說的熔岩洞，大竺葵是 Stage2）⇒ 退回不加倍', async () => {
  const c = all.find((x) => String(x.id) === '13962');   // 椰蛋樹｜木之重壓（Stage1，招式不受熔岩洞影響）
  const ai = (c.attacks || []).findIndex((x) => x.name === '木之重壓');
  const run = (bloom, lava) => {
    const att = inst(c.id, { energyAttached: [inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] });
    const st = mk({ active: att, bench: bloom ? [inst(BLOOM.id)] : [], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
      { active: inst(TANK.id), bench: [inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
      lava ? { activeStadium: inst(LAVA.id), activeStadiumOwnerIdx: 1 } : {});
    return norm(withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool)));
  };
  const plain = run(false, false), withBloom = run(true, false), withLava = run(true, true);
  if (plain === withBloom) throw new Error('哨兵失敗：有沒有繁茂的數字一樣（' + plain + '）');
  if (withLava !== plain) throw new Error('熔岩洞在場時仍然加倍：' + withLava + '（應該等於無繁茂的 ' + plain + '）');
  return true;
});

// ══ 【B】⭐⭐⭐ 行為端矩陣（卡池自動枚舉）═══════════════════════════════
console.log('\n【B】行為端矩陣：每一張「能量的數量」型的 H/I/J 卡 × 有無繁茂（自動枚舉卡池）');
const HIJ = all.filter((c) => ['H', 'I', 'J'].includes(String(c.regulationMark || '')));
const cand = []; const seen = new Set();
for (const c of HIJ) for (const a of (c.attacks || [])) {
  const eff = String(a.effect || '');
  // ⭐v6.385c（Fable 5 🟡2）：原本只收「能量的數量」，於是 isCompare 的第二分支
  //   `/比使用這個招式所需的能量多/` 永遠命中不到（那批卡的 effect 沒有「能量的數量」四個字）
  //   ＝死碼。改成把那一批（巨蔓藤／胖嘟嘟ex／電擊魔獸ex／超級龍頭地鼠ex／精神尖槍）
  //   真的收進矩陣 —— 它們走 totalEnergyUnits，本來就 bloom-aware，收進來是**加守備**。
  //   ⚠ 但它們是 **self 型**（比的是自己 vs 招式 cost），不是比較型 —— 見下方 isCompare。
  // ⭐v6.385d（Fable 5 第三輪 🟡3）：卡面的措辭不只「能量的數量」一種 ——
  //   「能量**數量**相同」（恰好喙／合氣掌，中間沒有「的」）、「能量**有 N 個以上**」（磁場炸裂）
  //   原本兩個矩陣都收不到。
  // ⭐v6.385e（Fable 5 第四輪 🟡2）：還有第五種措辭 ——「附有 **N 個以上【X】能量**」
  //   （能量在後：阿羅拉 椰蛋樹｜一長再長、暴雪王｜結冰木）。
  if (!/能量的數量|能量數量|比使用這個招式所需的能量多|能量有\s*\d+\s*個以上|\d+\s*個以上【.+?】能量/.test(eff)) continue;
  if (/【撤退】所需的能量/.test(eff)) continue;                    // 撤退費型：不是「附加的能量」
  // ⭐⭐⭐v6.385e（Fable 5 第四輪 🔴）：屬性排除必須**綁在計數措辭上**。
  //   v6.385d 寫成「effect 裡出現非【草】屬性字樣就不收」，於是
  //   **咚咚鼠｜擺尾發電**（「與對手的所有寶可夢身上附加的**能量的數量**相同數量的
  //   『基本【雷】能量』卡」—— 數的是對手全場**泛指**能量，【雷】只是要撈的卡名）被誤排。
  //   那正是 v6.385b 修好的其中一張 ⇒ 守備直接歸零（Rule 40：新規則不得把舊觀測點蓋掉）。
  //   Fable 實證：把 v2354 的 totalEnergyCount 退回漏傳 state/ownerIdx，
  //   v6.385d 的守衛 47/0 一條都不紅；v6.385c 的守衛則紅在「咚咚鼠｜擺尾發電（繁茂在 P1）」。
  //   ⇒ 只有「【X】能量 + 計數量詞」才算指名屬性；泛指「能量的數量」照收。
  if (/【(水|火|雷|超|鬥|惡|鋼|妖|龍)】(與【.+?】)?能量(的數量|數量|有\s*\d+\s*個以上)/.test(eff)
      && !/【草】能量/.test(eff)) continue;
  const k = `${c.name}|${a.name}`; if (seen.has(k)) continue; seen.add(k);
  cand.push({ c, a, eff, who: /對手的(所有|戰鬥)寶可夢身上附加/.test(eff) ? 'opp' : (/雙方的/.test(eff) ? 'both' : 'self') });
}
ok(`B0 哨兵：卡池裡枚舉得到「能量的數量」型的卡（實際 ${cand.length} 張）`, cand.length >= 25, String(cand.length));
const runCard = (c, ai, bloomSide) => {
  const cost = (c.attacks[ai].cost || []);
  const att = inst(c.id, { energyAttached: [...cost.map((t) => inst(EID[t] || EID.Colorless)), inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] });
  const defA = inst(TANK.id, { energyAttached: [inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] });
  const myB = [], opB = [inst(TANK.id, { energyAttached: [inst(EID.Grass), inst(EID.Grass), inst(EID.Grass)] })];
  if (bloomSide === 0) myB.push(inst(BLOOM.id));
  if (bloomSide === 1) opB.push(inst(BLOOM.id));
  // ⚠ Fable 5 複審 🔴3：棄牌區要放幾張基本【雷】能量，否則「咚咚鼠｜擺尾發電」
  //   （從棄牌區撈 N 張基本雷）會因為撈不到東西而完全沒有數字 log ⇒ 被下面的 skip 邏輯
  //   靜默跳過，那張卡就**永遠測不到**。
  const disc = Array.from({ length: 6 }, () => inst(EID.Lightning));
  const st = mk({ active: att, bench: myB, discard: disc, deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
    { active: defA, bench: opB, discard: disc.map((d) => inst(d.cardId)), deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
  try { return norm(withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool))); }
  catch (e) { return 'ERR:' + String(e.message).slice(0, 100); }
};
// ⚠⚠ Fable 5 複審 🔴4：原本把「跑出例外」和「沒有數字 log」一起 `continue` 掉 ——
//   突變「把 ctx 拿掉」會讓 applyAction 直接 TypeError（線上＝整個對戰軟鎖），守衛卻全綠。
//   ⇒ 例外一律**判紅**；「測不到」的要列出來、而且只能落在白名單裡。
// ⚠ Fable 5 複審 🟡9：both 型（雙方全場）與「自己 vs 對手比較」型只測一側的話，
//   錯邊突變會活下來 ⇒ 這兩類兩側都測。
const SKIP_WHITELIST = [];   // ⭐ 目前應為空：任何一張被跳過都要先弄清楚為什麼
// ⭐v6.385c（Fable 5 🟡3）：只驗「該變的那一側有變」，「兩側都算繁茂」這種突變會活下來
//   ⇒ 補反向：不該變的那一側必須**真的沒變**。白名單留給「卡面本來就兩側都數」的例外。
const WRONG_SIDE_WHITELIST = [];
// ⭐v6.385c：通用 fixture 給的 3 張基本草，對「比招式 cost 多 2 個」型的某些卡是**飽和**的
//   —— 有沒有繁茂條件都已經成立 ⇒ 數字當然一樣。這不是漏修，是 fixture 測不到。
//   ⚠ 每一張都必須附理由，而且必須有一條**條件真的會翻轉**的專屬斷言接手（見 B8）。
const B1_SATURATED = new Map([
  ['代歐奇希斯｜精神尖槍', 'cost 3 ＋ fixture 的 3 張草 ＝ 6 個，已經比 cost 多 3 個（門檻是多 2 個）⇒ 有無繁茂都成立。改由 B8 用 1 張草的盤面驗條件翻轉。'],
]);
const bBad = [], bErr = [], bSkip = [], bWrongSide = [];
if (!modErr) {
  for (const { c, a, eff, who } of cand) {
    const ai = (c.attacks || []).findIndex((x) => x.name === a.name);
    const key = `${c.name}｜${a.name}`;
    // 主詞決定要驗哪一側；「雙方」與「比較型」兩側都要驗
    // ⚠ 這個判斷不可以太寬：「擲與…能量的數量**相同次數**的硬幣」裡的「相同」不是比較型
    //   （光電傘蜥｜強大伏特、怖納噬草｜強力尖刺、青木的土龍節節ex｜職務猛攻都是 self 型），
    //   誤判成比較型就會去驗**對側**繁茂，那一側本來就不該有變 ⇒ 假紅。
    //   （「擲與…相同**次數**的硬幣」「撈與…相同**數量**的基本雷能量卡」都只是在描述數量，
    //     主詞仍然只有一方 ⇒ 只驗那一方。真正的比較型只有「雙方…」與「比所需的能量多 N 個」。）
    // ⭐v6.385c（Fable 5 第二輪）：修正 isCompare 的語意。
    //   ⚠「比使用這個招式所需的能量多 N 個」（巨蔓藤／胖嘟嘟ex／電擊魔獸ex／超級龍頭地鼠ex／
    //     精神尖槍）比的是「自己身上的能量 vs **招式 cost**」——**不是**自己 vs 對手。
    //     當成比較型去驗對手側 ⇒ 對手側本來就不該變 ⇒ 假紅（v6.385c 實測到的）。
    //   ⭐ 真正的雙方比較型有兩種措辭：「雙方…」與吞食獸｜張大嘴的
    //     「比對手的戰鬥寶可夢身上附加的能量的數量多」—— 後者的 who 會被判成 opp，
    //     但它**自己那一側也要數** ⇒ 不收進來的話反向斷言 B1c 會假紅。
    //   ⭐v6.385d：第三種真正的雙方比較措辭 —— 「這隻寶可夢**與對手的戰鬥寶可夢**身上附加的
    //     能量數量相同」（恰好喙／合氣掌）。卡面逐字查證：H/I/J 只有這兩張。
    const isCompare = /雙方/.test(eff)
      || /比對手的.{0,16}身上附加的能量的數量/.test(eff)
      || /與對手的[^。]{0,20}身上附加的能量數量相同/.test(eff);
    const sides = (who === 'both' || isCompare) ? [0, 1] : [who === 'opp' ? 1 : 0];
    const A = runCard(c, ai, -1);
    if (A.startsWith('ERR')) { bErr.push(key + ' 無繁茂 ' + A); continue; }
    if (!A) { bSkip.push(key); continue; }
    for (const side of sides) {
      const B = runCard(c, ai, side);
      if (B.startsWith('ERR')) { bErr.push(key + ' 繁茂在 P' + side + ' ' + B); continue; }
      if (A === B && !B1_SATURATED.has(key)) bBad.push(`${key}（${c.regulationMark}｜${c.setCode}｜id ${c.id}，繁茂在 P${side}）`);
    }
    // ⭐v6.385c 反向：sides 以外的那一側放繁茂，數字必須完全不變
    for (const side of [0, 1].filter((x) => !sides.includes(x))) {
      const B2 = runCard(c, ai, side);
      if (B2.startsWith('ERR')) { bErr.push(key + ' 反向 P' + side + ' ' + B2); continue; }
      if (A !== B2 && !WRONG_SIDE_WHITELIST.includes(key)) bWrongSide.push(`${key}（繁茂在 P${side} 不該有變：${A} → ${B2}）`);
    }
  }
}
ok('B0b ⭐ 掃描器自我驗證：norm() 真的把 iid 正規化掉（否則 B1 會恆真）', () => {
  const f1 = { log: ['i123 造成 30 點傷害'] }, f2 = { log: ['i456 造成 30 點傷害'] };
  return norm(f1) === norm(f2) && norm(f1) === '30';
});
ok('B0c ⭐⭐ 掃描器自我驗證：norm() 只留數字（log 多了字樣但數字沒變 ⇒ 判為相同）', () => {
  // ⚠ 樣本裡的「字樣」本身不可以含數字（「繁茂×2」的那個 2 會被算進數字序列）
  const f1 = { log: ['自身【草】能量 6 個 → 240'] };
  const f2 = { log: ['自身【草】能量 6 個（繁茂已套用） → 240'] };
  return norm(f1) === norm(f2) && norm(f1) === '6,240';
});
ok('B0d ⭐⭐⭐ 掃描器自我驗證：log 裡的「（繁茂×2 …）」字樣**不得**被算進數字序列', () => {
  // ⚠ 這一條就是 Fable 第三輪 🔴2 的護欄：字樣本身帶一個 2，沒剝掉就會讓 B1 恆真。
  const f1 = { log: ['巨型花束：自身【草】能量 6 個 → 370'] };
  const f2 = { log: ['巨型花束：自身【草】能量 6 個（繁茂×2 套用基本【草】） → 370'] };
  return norm(f1) === norm(f2) && norm(f1) === '6,370';
});
ok('B1 ⭐⭐⭐ 每一張「能量的數量」型的卡，繁茂在該側時數字都要跟著變',
  !modErr && bBad.length === 0, modErr || ('沒跟著變的：' + bBad.join('、')));
ok('B1a ⭐⭐⭐ 沒有任何一張在跑的時候丟例外（例外＝線上會軟鎖，不可以當成「測不到」跳過）',
  !modErr && bErr.length === 0, modErr || bErr.join(' ／ '));
ok('B1c ⭐⭐ 反向：繁茂放在**不該影響**的那一側時，數字必須一個都不變',
  !modErr && bWrongSide.length === 0, modErr || ('錯邊卻有變的：' + bWrongSide.join('、')));
ok('B1b ⭐⭐ 被跳過（fixture 產不出數字）的卡必須在白名單內，而且白名單要是空的',
  !modErr && bSkip.every((k) => SKIP_WHITELIST.includes(k)),
  '未登記的跳過：' + bSkip.filter((k) => !SKIP_WHITELIST.includes(k)).join('、'));
// ⚠ 正對照：否定型守衛必須證明「這個判準真的分辨得出差異」（不是每張都恰好相同）
ok('B1d ⭐ 飽和白名單每一張都要有理由（不准空白放行）',
  [...B1_SATURATED.values()].every((v) => typeof v === 'string' && v.length > 20),
  JSON.stringify([...B1_SATURATED.keys()]));
ok('B8 ⭐⭐⭐ 代歐奇希斯｜精神尖槍：cost 3 ＋ 1 張基本草 ⇒ 無繁茂 4 個（不足 cost+2=5）／有繁茂 5 個（成立）', () => {
  if (modErr) throw new Error(modErr);
  const c = all.find((x) => String(x.id) === '18452');
  if (!c) throw new Error('fixture 找不到 代歐奇希斯（18452）');
  const ai = (c.attacks || []).findIndex((x) => x.name === '精神尖槍');
  const run = (bloom) => {
    const pay = (c.attacks[ai].cost || []).map(() => inst(EID.Psychic));
    const att = inst(c.id, { energyAttached: [...pay, inst(EID.Grass)] });
    const st = mk({ active: att, bench: bloom ? [inst(BLOOM.id)] : [], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
      { active: inst(TANK.id), bench: [inst(TANK.id), inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
    return norm(withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool)));
  };
  const A = run(false), B = run(true);
  if (A === B) throw new Error('1 張基本草＋繁茂與沒繁茂一樣（條件沒翻轉）：' + A);
  return true;
});
ok('B2 ⭐ 正對照：椰蛋樹｜木之重壓在繁茂下確實翻倍（6 個 → 12 個）', () => {
  if (modErr) throw new Error(modErr);
  const c = all.find((x) => String(x.id) === '13962');
  const ai = (c.attacks || []).findIndex((x) => x.name === '木之重壓');
  const A = runCard(c, ai, -1), B = runCard(c, ai, 0);
  return /(^|,)6(,|$)/.test(A) && /(^|,)12(,|$)/.test(B);
});
ok('B3 ⭐⭐ 反對照：其他屬性（【水】能量的數量）不受繁茂影響', () => {
  if (modErr) throw new Error(modErr);
  const c = all.find((x) => String(x.id) === '16652');   // 吼鯨王｜水炮
  if (!c) throw new Error('fixture 找不到 吼鯨王');
  const ai = (c.attacks || []).findIndex((x) => x.name === '水炮');
  return runCard(c, ai, -1) === runCard(c, ai, 0);
});
ok('B4 ⭐⭐⭐ 暴雪王｜結冰木：繁茂在場時 1 張基本草就達到「2 個以上」門檻', () => {
  if (modErr) throw new Error(modErr);
  const c = all.find((x) => String(x.id) === '12777');
  const ai = (c.attacks || []).findIndex((x) => x.name === '結冰木');
  const run = (grass, bloom) => {
    // ⚠ 這一支的 cost 是【水】【水】【水】【無】—— 無色位**不可以**用基本草付
    //   （EID.Colorless 在本檔被指到基本草，用它付費會平白多一張草 ⇒ 門檻測試失真）。
    const pay = (c.attacks[ai].cost || []).map((t) => inst(t === 'Colorless' ? EID.Water : (EID[t] || EID.Water)));
    const att = inst(c.id, { energyAttached: [...pay, ...Array.from({ length: grass }, () => inst(EID.Grass))] });
    const st = mk({ active: att, bench: bloom ? [inst(BLOOM.id)] : [], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
      { active: inst(TANK.id), bench: [inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
    return norm(withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool)));
  };
  const one = run(1, false), oneBloom = run(1, true), two = run(2, false);
  if (one === oneBloom) throw new Error('1 張基本草＋繁茂與沒繁茂一樣：' + one);
  // ⚠ 不能整串比：1 張 vs 2 張時「身上能量總數」本來就不同 ⇒ 只比**最終傷害**（序列最後一個數字）。
  const last = (x) => (String(x).split(',').pop() || '');
  if (last(oneBloom) !== last(two)) throw new Error('1 張＋繁茂最終傷害 ' + last(oneBloom) + ' ≠ 2 張的 ' + last(two));
  if (last(one) === last(two)) throw new Error('哨兵失敗：1 張與 2 張的最終傷害一樣（門檻沒在守）');
  return true;
});
ok('B5 ⭐⭐⭐ 巨蔓藤｜肌力鞭打：4 張基本草＋繁茂 ⇒ 8 個 ≥ cost+2 ⇒ 增傷', () => {
  if (modErr) throw new Error(modErr);
  const c = all.find((x) => x.name === '巨蔓藤' && (x.attacks || []).some((y) => y.name === '肌力鞭打'));
  if (!c) throw new Error('fixture 找不到 巨蔓藤');
  const ai = (c.attacks || []).findIndex((x) => x.name === '肌力鞭打');
  const run = (bloom) => {
    const att = inst(c.id, { energyAttached: Array.from({ length: 4 }, () => inst(EID.Grass)) });
    const st = mk({ active: att, bench: bloom ? [inst(BLOOM.id)] : [], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
      { active: inst(TANK.id), bench: [inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
    return norm(withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool)));
  };
  const A = run(false), B = run(true);
  if (A === B) throw new Error('有沒有繁茂都一樣：' + A);
  return true;
});

// ══ 【B6】⭐⭐⭐ host-aware 矩陣（自動枚舉；雷公｜電氣墜落就是被這一條抓到的）═══
// Fable 5 第二輪複審 🟡1：上面的【B】只枚舉「招式文字含『能量的數量』」的卡，於是
//   「【X】能量**有 N 個以上**」「能量**數量相同**」「能量**有 3 個以上**」這幾種措辭
//   全部落在矩陣外 —— 雷公｜電氣墜落（v2490 的 selfFieldEnergyConditionPre，與 v2580
//   的 fieldEnergyCountConditionPre 是同一語意的**第二份 factory**）就是這樣漏掉的。
//
// ⭐ 這一條不靠繁茂，改用**古舊能量**（卡面：視為提供所有屬性的能量）當探針：
//   「N 張基本【X】能量」與「N 張古舊能量」在任何『數【X】能量個數』的判準下都必須
//   得到**完全相同**的數字。凡是自己 for 迴圈比 `pokemonType === X` 的寫法，古舊能量
//   一律算 0 ⇒ 數字不同 ⇒ 立刻翻紅。未來新卡自動納入，不必記得回來加。
console.log('\n【B6】host-aware 矩陣：基本【X】能量 vs 古舊能量（視為提供所有屬性）必須同值');
const ANCIENT = all.find((c) => c.supertype === 'Energy' && c.subtype !== 'Basic' && /古舊能量/.test(String(c.name)));
ok('B6a ★ 抓得到古舊能量（探針本身要存在，否則整段是空轉）', !!ANCIENT, String(ANCIENT && ANCIENT.id));
const ZH2T = { 草: 'Grass', 火: 'Fire', 水: 'Water', 雷: 'Lightning', 超: 'Psychic', 鬥: 'Fighting', 惡: 'Darkness', 鋼: 'Metal' };
// ⭐v6.385e：補第五種措辭「N 個以上【X】能量」（能量在後）。
const COUNTING2 = /(能量的數量|能量有\s*\d+\s*個以上|能量每\s*1\s*個|能量的個數|能量數量相同|\d+\s*個以上【.+?】能量)/;
const haCand = []; const seen6 = new Set();
for (const c of HIJ) {
  const rows = [
    ...(c.attacks || []).map((a, i) => ({ kind: 'attack', name: a.name, eff: String(a.effect || ''), ai: i, cost: a.cost || [] })),
    ...(c.abilities || []).map((a) => ({ kind: 'ability', name: a.name, eff: String(a.effect || ''), ai: -1, cost: [] })),
  ];
  for (const r of rows) {
    if (!COUNTING2.test(r.eff)) continue;
    if (/【撤退】所需的能量/.test(r.eff)) continue;
    const m = r.eff.match(/【(草|火|水|雷|超|鬥|惡|鋼)】能量/);
    if (!m) continue;                       // 只收「指名屬性」的（泛指『能量』的由【B】守）
    const k = `${c.name}|${r.name}`; if (seen6.has(k)) continue; seen6.add(k);
    haCand.push({ c, r, type: ZH2T[m[1]] });
  }
}
ok(`B6b ★ 枚舉器活著：指名屬性的能量計數卡 ≥ 15 張（實際 ${haCand.length}）`, haCand.length >= 15, String(haCand.length));
// ⭐⭐⭐v6.385d（Fable 5 第三輪 🔴1）：原本這裡寫「招式型才跑得動（特性型由【A】與 B7 守）」
//   —— **不實**。【A】只驗一長再長、B7 是雷公（招式），haCand 裡那 3 張特性
//   （尖刺盔甲／快掃拳返／大師工藝）只是在充 B6b 的數，`r.kind !== 'attack'` 直接跳過。
//   Fable 突變實證：把 engine.ts 的大師工藝、effects.ts 的尖刺盔甲退回舊寫法，守衛照樣 43/0。
//   ⇒ 特性型改用兩種行為端探針，逐卡宣告（清單完整性由 B6f 守，新卡會逼人來補）：
//     ① 最大 HP 型（大師工藝）：直接問 getEffectiveHP(inst, pool, state)
//     ② 受傷反擊型（尖刺盔甲／快掃拳返）：讓對手打一下，讀**攻擊方身上的傷害**
//   ⚠ v6.385e：值改成 { kind, n } —— **張數要能逐卡指定**。一長再長的門檻是「6 個以上」，
//     固定放 3 張會兩邊都達不到門檻 ⇒ A===B ⇒ **假綠**（Fable 第四輪 🟡2）。
const ABILITY_PROBES = new Map([
  ['大師工藝', { kind: 'hp', n: 3 }],      // 140 + 3×40 = 260
  ['一長再長', { kind: 'hp', n: 6 }],      // 門檻 6 個【草】⇒ 150 + 250 = 400
  ['尖刺盔甲', { kind: 'retal', n: 3 }],   // 3×30 = 90
  ['快掃拳返', { kind: 'retal', n: 3 }],   // 60
]);
/** 攻擊方 fixture：H/I/J、無特性、有招式、傷害固定的小拳頭（用來逼出受傷反擊）。 */
const PUNCHER = all.find((c) => String(c.id) === '13410')   // 酷豹（I）拍落 50
  || all.find((c) => c.supertype === 'Pokemon' && ['H','I','J'].includes(String(c.regulationMark || ''))
    && !(c.abilities || []).length && (c.attacks || []).some((a) => /^\d+$/.test(String(a.damage || ''))));
const runAbilityHP = (c, type, useAncient, n = 3) => {
  const E1 = () => inst(useAncient ? String(ANCIENT.id) : EID[type]);
  const holder = inst(c.id, { energyAttached: Array.from({ length: n }, E1) });
  const st = mk({ active: holder, bench: [], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
    { active: inst(TANK.id), bench: [inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
  try { return String(M.getEffectiveHP(holder, pool, st)); } catch (e) { return 'ERR:' + String(e.message).slice(0, 80); }
};
const runAbilityRetal = (c, type, useAncient, n = 3) => {
  if (!PUNCHER) return 'ERR:找不到攻擊方 fixture';
  const ai = (PUNCHER.attacks || []).findIndex((a) => /^\d+$/.test(String(a.damage || '')));
  if (ai < 0) return 'ERR:攻擊方沒有固定傷害招式';
  const E1 = () => inst(useAncient ? String(ANCIENT.id) : EID[type]);
  const holder = inst(c.id, { energyAttached: Array.from({ length: n }, E1) });
  const att = inst(PUNCHER.id, { energyAttached: Array.from({ length: 5 }, () => inst(String(ANCIENT.id))) });
  const st = mk({ active: att, bench: [inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
    { active: holder, bench: [inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
  try {
    const r = withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool));
    return String(r.players[0].active ? r.players[0].active.damage : 'KO');
  } catch (e) { return 'ERR:' + String(e.message).slice(0, 80); }
};
const runHA = (c, ai, cost, useAncient, type) => {
  const E1 = () => inst(useAncient ? String(ANCIENT.id) : EID[type]);
  const pay = (cost || []).map(() => inst(String(ANCIENT.id)));   // cost 一律用古舊付（提供所有屬性）
  const att = inst(c.id, { energyAttached: [...pay, E1(), E1()] });
  const myB = [inst(TANK.id, { energyAttached: [E1(), E1()] })];
  const opA = inst(TANK.id, { energyAttached: [E1(), E1(), E1(), E1()] });
  const opB = [inst(TANK.id, { energyAttached: [E1(), E1()] })];
  const disc = Array.from({ length: 6 }, () => inst(EID.Lightning));
  const st = mk({ active: att, bench: myB, discard: disc, deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
    { active: opA, bench: opB, discard: disc.map((d) => inst(d.cardId)), deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
  try { return norm(withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool))); }
  catch (e) { return 'ERR:' + String(e.message).slice(0, 100); }
};
const HA_SKIP = [];            // ⭐ 目前應為空
const haBad = [], haErr = [], haSkip = [];
if (!modErr && ANCIENT) {
  for (const { c, r, type } of haCand) {
    const key = `${c.name}｜${r.name}`;
    // ⭐v6.385d：招式走 runHA；特性依 ABILITY_PROBES 走 HP 或受傷反擊探針。
    let A, B;
    if (r.kind === 'attack') { A = runHA(c, r.ai, r.cost, false, type); B = runHA(c, r.ai, r.cost, true, type); }
    else {
      const probe = ABILITY_PROBES.get(r.name);
      if (!probe) { haErr.push(key + ' 特性沒有登記探針（ABILITY_PROBES）'); continue; }
      const run = probe.kind === 'hp' ? runAbilityHP : runAbilityRetal;
      A = run(c, type, false, probe.n); B = run(c, type, true, probe.n);
    }
    if (A.startsWith('ERR') || B.startsWith('ERR')) { haErr.push(key + ' ' + (A.startsWith('ERR') ? A : B)); continue; }
    if (!A && !B) { haSkip.push(key); continue; }
    if (A !== B) haBad.push(`${key}（${c.regulationMark}｜id ${c.id}｜【${type}】：基本=${A} 古舊=${B}）`);
  }
}
ok('B6 ⭐⭐⭐ 每一張「指名屬性能量計數」的卡：基本【X】與古舊能量必須同值',
  !modErr && haBad.length === 0, modErr || ('數字不同的：' + haBad.join('、')));
ok('B6c ⭐⭐ 沒有任何一張在跑的時候丟例外（ERR 一律判紅）', !modErr && haErr.length === 0, modErr || haErr.join(' ／ '));
ok('B6f ⭐⭐⭐ haCand 裡的**每一張特性**都要有登記探針（新卡會逼人來補，不會靜默跳過）',
  haCand.filter((x) => x.r.kind === 'ability').every((x) => ABILITY_PROBES.has(x.r.name)),
  '沒登記的：' + haCand.filter((x) => x.r.kind === 'ability' && !ABILITY_PROBES.has(x.r.name)).map((x) => x.c.name + '｜' + x.r.name).join('、'));
// ⭐⭐⭐v6.385e（Fable 5 第四輪 🟡1）：B6g/B6h 原本**沒有呼叫被驗的那支探針**
//   （B6g 直接呼叫 getEffectiveHP、B6h 只驗 `> 0`）⇒ 把 runAbilityHP 改成回傳常數、
//   或把特性實作整個弄死（大師工藝 `* 40` → `* 0`、快掃拳返 `* 2` → `* 0`），守衛照樣 47/0。
//   ⇒ 改成**用同一支探針 ＋ 精確期望值**的正對照（實測值見 __m6a/v385e_v2.out.txt）。
const probeExact = (name, ab, type, n, expect, note) => ok(name, () => {
  if (modErr || !ANCIENT) throw new Error(modErr || '沒有古舊能量');
  const c = all.find((x) => ['H','I','J'].includes(String(x.regulationMark || ''))
    && (x.abilities || []).some((a) => a.name === ab));
  if (!c) throw new Error('fixture 找不到 ' + ab);
  const p = ABILITY_PROBES.get(ab);
  if (!p) throw new Error(ab + ' 沒有登記探針');
  const run = p.kind === 'hp' ? runAbilityHP : runAbilityRetal;
  const v = run(c, type, false, n);
  if (String(v) !== String(expect)) throw new Error(`${c.name}｜${ab} 實得 ${v}，期望 ${expect}（${note}）`);
  return true;
});
probeExact('B6g ⭐⭐⭐ 特性探針正對照（精確值）：修建老匠｜大師工藝 3 個【鬥】⇒ 最大 HP 260',
  '大師工藝', 'Fighting', 3, 260, '印刷 140 ＋ 3×40');
probeExact('B6h ⭐⭐⭐ 特性探針正對照（精確值）：布里卡隆｜尖刺盔甲 3 個【草】⇒ 攻擊方吃 90',
  '尖刺盔甲', 'Grass', 3, 90, '3×30');
probeExact('B6i ⭐⭐⭐ 特性探針正對照（精確值）：拖拖蚓ex｜快掃拳返 3 個【鋼】⇒ 攻擊方吃 60',
  '快掃拳返', 'Metal', 3, 60, '卡面 N×2 個指示物');
probeExact('B6j ⭐⭐⭐ 特性探針正對照（精確值）：阿羅拉 椰蛋樹｜一長再長 6 個【草】⇒ 最大 HP 400',
  '一長再長', 'Grass', 6, 400, '印刷 150 ＋ 250；門檻就是 6 個 ⇒ 張數不對會立刻看出來');
ok('B6k ★ 探針哨兵：一長再長只放 3 個【草】時**達不到門檻**（證明 B6j 的 400 不是恆真）', () => {
  if (modErr) throw new Error(modErr);
  const c = all.find((x) => ['H','I','J'].includes(String(x.regulationMark || ''))
    && (x.abilities || []).some((a) => a.name === '一長再長'));
  const v3 = runAbilityHP(c, 'Grass', false, 3), v6 = runAbilityHP(c, 'Grass', false, 6);
  return String(v3) === String(c.hp) && String(v6) !== String(v3);
});
ok('B6d ⭐ 被跳過的卡必須在白名單內，而且白名單要是空的',
  !modErr && haSkip.every((k) => HA_SKIP.includes(k)), '未登記的跳過：' + haSkip.filter((k) => !HA_SKIP.includes(k)).join('、'));
ok('B6e ⭐⭐ 正對照：這個探針真的分辨得出差異（把古舊能量換成 basic 他屬，數字必須不同）', () => {
  if (modErr || !ANCIENT) throw new Error(modErr || '沒有古舊能量');
  // 雷公｜電氣墜落：4 個【雷】才 +90。用【水】當「錯的屬性」⇒ 一定湊不到門檻 ⇒ 與基本【雷】不同。
  const c = all.find((x) => x.name === '雷公' && (x.attacks || []).some((y) => y.name === '電氣墜落'));
  if (!c) throw new Error('fixture 找不到 雷公｜電氣墜落');
  const ai = (c.attacks || []).findIndex((y) => y.name === '電氣墜落');
  const right = runHA(c, ai, c.attacks[ai].cost, false, 'Lightning');
  const wrong = runHA(c, ai, c.attacks[ai].cost, false, 'Water');
  if (right === wrong) throw new Error('探針分辨不出屬性差異（恆真）：' + right);
  return true;
});
ok('B7 ⭐⭐⭐ 雷公｜電氣墜落（Fable 第二輪 🔴1）：2 張基本雷 ＋ 備戰 2 張古舊能量 ⇒ 算 4 個 ⇒ 增傷', () => {
  if (modErr || !ANCIENT) throw new Error(modErr || '沒有古舊能量');
  const c = all.find((x) => x.name === '雷公' && (x.attacks || []).some((y) => y.name === '電氣墜落'));
  const ai = (c.attacks || []).findIndex((y) => y.name === '電氣墜落');
  const run = (benchAncient) => {
    const pay = (c.attacks[ai].cost || []).map(() => inst(EID.Lightning));
    const att = inst(c.id, { energyAttached: pay });
    const myB = [inst(TANK.id, { energyAttached: benchAncient ? [inst(String(ANCIENT.id)), inst(String(ANCIENT.id))] : [] })];
    const st = mk({ active: att, bench: myB, deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) },
      { active: inst(TANK.id), bench: [inst(TANK.id)], deck: [inst(TANK.id)], prizes: Array.from({ length: 6 }, () => inst(TANK.id)) });
    return norm(withCoin(true, () => M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool)));
  };
  const without = run(false), withA = run(true);
  const last = (x) => (String(x).split(',').pop() || '');
  if (last(without) === last(withA)) throw new Error('備戰 2 張古舊能量沒有被算進去：' + without + ' vs ' + withA);
  return true;
});

// ══ 【C】收斂：繁茂判準只有一份 ═══════════════════════════════════════
console.log('\n【C】收斂：繁茂只有一份判準（Rule 38）');
ok('C1 ⭐⭐⭐ countEnergyTypeHostAware 自己就含繁茂（不是靠另一支 wrapper）',
  /export function countEnergyTypeHostAware\([\s\S]{0,900}?hasBloomOnField\(ctx\.state, ctx\.ownerIdx, pool\)/.test(EFFECTS));
ok('C2 ⭐⭐⭐ countEnergyTypeBloomAware 已經只是薄 wrapper（不再自己算一遍）', () => {
  const i = EFFECTS.indexOf('export function countEnergyTypeBloomAware');
  const seg = i < 0 ? '' : EFFECTS.slice(i, i + 400);
  return seg.includes('return countEnergyTypeHostAware(host, type, pool, { state, ownerIdx });')
    && !/for \(const e of host\.energyAttached\)/.test(seg);
});
// ⚠ 誠實標註（Fable 5 複審 🟡12）：C1~C3 只證明「**這三個位置**沒有第二份繁茂判準」，
//   不等於全站只有一份 —— 站上仍有 v155_attacks.ts 的 超級大竺葵ex｜巨型花束 整段 inline、
//   _shared.ts 的 getEnergyDiscardUnits、engine.ts 的 totalEnergyUnits／canAffordAttack。
//   它們目前行為與中央一致（由【B】的行為端矩陣守著），但「Rule 38 已完成」是**過度宣稱**。
//   真正在守「不得漂移」的是【B】，不是這三條字串掃描。
ok('C3 ⭐⭐ selfAllEnergyMultiplyPre 裡不得再有 inline 的「基本草 +2」',
  () => {
    const i = EFFECTS.indexOf('function selfAllEnergyMultiplyPre');
    const seg = i < 0 ? '' : EFFECTS.slice(i, i + 1600);
    return seg.length > 200 && !/count \+= 2/.test(seg);
  });
ok('C4 ⭐ 掃描器自我驗證：C3 的判準抓得到「count += 2」這種 inline 寫法',
  /count \+= 2/.test('        if (isBasicGrass) count += 2;'));

// ══ 【D】必填化：不得有漏傳 ════════════════════════════════════════════
console.log('\n【D】必填化：state/ownerIdx 不是 optional，任何呼叫點都不得漏傳');
ok('D1 ⭐⭐⭐ countAttachedEnergyAsUnits 的 state/ownerIdx 是**必填**（漏傳 ⇒ 編譯錯誤）',
  /export function countAttachedEnergyAsUnits\([\s\S]{0,260}?state: GameState \| null,[\s\S]{0,80}?ownerIdx: 0 \| 1 \| null,/.test(SHARED));
ok('D2 ⭐⭐⭐ countEnergyTypeHostAware 的 ctx 是**必填**',
  /export function countEnergyTypeHostAware\([\s\S]{0,300}?ctx: \{ state: GameState \| null; ownerIdx: 0 \| 1 \| null \},/.test(EFFECTS));
ok('D3 ⭐⭐⭐ countOneEnergy 的 ctx 是**必填**',
  /export function countOneEnergy\([\s\S]{0,300}?ctx: \{ state: GameState \| null; ownerIdx: 0 \| 1 \| null \},/.test(EFFECTS));
// ⚠ 這一條是原始碼掃描（結構面）；行為面由【B】守。兩者都要有 —— 光有掃描是安慰劑，
//   光有行為端則擋不住「新加一張卡漏傳」（那張卡還沒進卡池／還沒被枚舉到）。
const SRCS = [];
{
  const walk = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) { walk(rel); continue; }
      if (/\.(ts|mjs)$/.test(e.name)) SRCS.push([rel, rd(rel)]);
    }
  };
  walk('src/lib/game');
}
// ⚠⚠ Fable 5 複審 🟡10：原本的 regex 是 /countEnergyTypeHostAware\(([^)]*\}[^)]*)\)/ ——
//   它**要求引數裡有 `}`**，所以「漏傳 ctx」的呼叫（沒有物件字面量）根本不會被匹配到 ⇒ 恆真。
//   而且 countOneEnergy 完全沒掃。⇒ 改成真的**數引數個數**（括號配對，跳過字串與巢狀括號）。
/** 從 `name(` 之後做括號配對，回傳頂層引數個數（0 代表 `()`）。 */
const argCountAt = (src, openIdx) => {
  let depth = 0, args = 1, q = '';
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; if (depth === 0) return args; continue; }
    if (ch === ',' && depth === 1) args++;
  }
  return -1;
};
const MIN_ARGS = { countEnergyTypeHostAware: 4, countOneEnergy: 4, countAttachedEnergyAsUnits: 4 };
const leak = [];
for (const [rel, src] of SRCS) {
  for (const [fn, need] of Object.entries(MIN_ARGS)) {
    let i = 0;
    for (;;) {
      i = src.indexOf(fn + '(', i);
      if (i < 0) break;
      const open = i + fn.length;
      // 跳過定義本身與 import
      const lineStart = src.lastIndexOf('\n', i) + 1;
      const line = src.slice(lineStart, src.indexOf('\n', i));
      // ⚠ 跳過定義本身、import，以及**註解**（註解裡常寫 `countEnergyTypeHostAware(雷)` 這種示意）
      if (/export function|^\s*import|from '/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) { i = open; continue; }
      const n = argCountAt(src, open);
      if (n >= 0 && n < need) leak.push(`${rel}: ${fn} 只有 ${n} 個引數（需要 ${need}）— ${line.trim().slice(0, 90)}`);
      i = open;
    }
  }
}
ok('D4 ⭐⭐⭐ 原始碼掃描：三支計數函式的每一個呼叫點都帶滿引數（沒有漏傳 state/ownerIdx/ctx）',
  leak.length === 0, leak.join(' ／ '));
ok('D4b ⭐ 掃描器自我驗證：argCountAt 數得出引數個數（否則 D4 是恆真）', () => {
  const sample = "countOneEnergy(att, filter, pool)";
  const sample2 = "countOneEnergy(att, filter, pool, { state, ownerIdx: aIdx })";
  return argCountAt(sample, 'countOneEnergy'.length) === 3
    && argCountAt(sample2, 'countOneEnergy'.length) === 4;
});

// ══ 【E】站長裁定逐字錨 ════════════════════════════════════════════════
console.log('\n【E】站長裁定');
ok('E1 ⭐⭐ 「基本能量的數量」＝個數、受繁茂影響（站長 2026-09-15 裁定）有寫在程式碼旁',
  /基本能量的數量」算的是「個數」，會受到繁茂的影響/.test(EFFECTS));
ok('E2 ⭐ 帕路奇亞｜空間粉碎確實走 basic filter（裁定的對象沒有跑掉）',
  /regPre\('帕路奇亞\|空間粉碎', selfAttachedEnergyMultiplyPre\(0, 40, 'basic', '空間粉碎'\)\)/.test(EFFECTS));

// ══ 【F】HEAD-FAIL ═════════════════════════════════════════════════════
console.log('\n【F】HEAD-FAIL（BASE ＝ v6.384，那時還沒有這些東西 ⇒ 每一條都必須紅）');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【F】BASE blob 對照', '需要歷史 commit（淺複製環境）');
} else {
  const bEff = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/effects.ts');
  const bSh = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/effects/_shared.ts');
  ok('F0 哨兵：BASE 的兩個檔都讀得到（讀不到的話下面全是空真）', bEff.ok && bSh.ok);
  const be = bEff.ok ? normEol(bEff.out) : '';
  const bs = bSh.ok ? normEol(bSh.out) : '';
  ok('F1 ⭐⭐⭐ BASE 的 countEnergyTypeHostAware **沒有** ctx（C1/D2 對 BASE 必紅）',
    be.length > 0 && !/export function countEnergyTypeHostAware\([\s\S]{0,300}?ctx:/.test(be));
  ok('F2 ⭐⭐⭐ BASE 的 countAttachedEnergyAsUnits 是 optional（D1 對 BASE 必紅）',
    bs.length > 0 && /export function countAttachedEnergyAsUnits\([\s\S]{0,200}?state\?: GameState,/.test(bs));
  ok('F3 ⭐⭐⭐ BASE 的 selfAllEnergyMultiplyPre 裡**有** inline 的 count += 2（C3 對 BASE 必紅）', () => {
    const i = be.indexOf('function selfAllEnergyMultiplyPre');
    const seg = i < 0 ? '' : be.slice(i, i + 1600);
    return seg.length > 200 && /count \+= 2/.test(seg);
  });
  ok('F4 ⭐ 哨兵：BASE 本來就有的東西（countEnergyTypeBloomAware）在 BASE 也找得到',
    be.includes('export function countEnergyTypeBloomAware'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.385 能量個數中央化：${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
