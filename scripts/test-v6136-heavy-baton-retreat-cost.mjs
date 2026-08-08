#!/usr/bin/env node
/**
 * v6.136 守衛：沉重接力棒必須判「【撤退】所需的能量為 4 個」
 *
 * 玩家回報：撤退費不是 4 的寶可夢附上沉重接力棒也會生效。
 * 卡面（static/cards SV5M，H 標）：
 *   「附有這張卡的【撤退】所需的能量為4個的寶可夢，在戰鬥場上受到對手的寶可夢招式的傷害
 *     而【昏厥】時，選擇最多3張那隻寶可夢身上附加的基本能量卡，以任意方式改附…」
 * 舊實作只判了「備戰不為空 / koInst 有基本能量」，完全沒有撤退費條件。
 *
 * 判定基準（官方裁定，PTCG RULES）：附 3 張「重力之玉」的普隆隆姆ex 被 KO 時**可以**發動
 *   ⇒ 用「昏厥當下的**有效**撤退費（含所有增減修正）」，不是卡面印刷值。
 *
 * 這支守衛同時鎖住「一勞永逸」的部分：
 *   ④ 枚舉守衛擴到**道具 rulesText** —— 這次漏網的根因就是 v5.690/v5.711 那波
 *      「依撤退費計算」的收斂只掃了招式 effect，沒掃道具的 rulesText。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOLS = readFileSync(join(ROOT, 'src/lib/game/effects/cards/tools.ts'), 'utf8');
const ENGINE = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  PASS ' + m); };
const no = (m) => { fail++; console.log('  FAIL ' + m); };

// 掃描器下限斷言
if (ENGINE.length < 200000 || TOOLS.length < 20000) {
  console.log(`FAIL 掃描器前提不成立：engine=${ENGINE.length} tools=${TOOLS.length}（疑似 mount 截斷）`);
  process.exit(1);
}

// ── ① 中央 helper 存在，且是「包裝 computeActiveRetreatCostFor」而非複製邏輯
const fnIdx = ENGINE.indexOf('export function computeRetreatCostForKOedActive');
if (fnIdx > 0) {
  ok('① 中央 helper computeRetreatCostForKOedActive 存在');
  const body = ENGINE.slice(fnIdx, fnIdx + 900);
  if (body.includes('computeActiveRetreatCostFor(')) ok('① 它轉呼叫中央 computeActiveRetreatCostFor（不複製修正邏輯）');
  else no('① 它沒有轉呼叫 computeActiveRetreatCostFor —— 疑似自行複製撤退費修正，會漂移');
  if (/active:\s*koInst/.test(body)) ok('① 它把 koInst 放回 active 再算（繞過 active 已 null 的問題）');
  else no('① 它沒有把 koInst 放回 active —— computeActiveRetreatCostFor 會因 active===null 恆回 0');
} else {
  no('① 找不到 computeRetreatCostForKOedActive');
}

// ── ② 沉重酒力棒 handler 必須用它判 === 4
const hbIdx = TOOLS.indexOf("TOOL_ON_KO.set('沉重接力棒'");
if (hbIdx > 0) {
  const body = TOOLS.slice(hbIdx, hbIdx + 1600);
  if (body.includes('computeRetreatCostForKOedActive')) ok('② 沉重接力棒有呼叫中央撤退費 helper');
  else no('② 沉重接力棒沒有判撤退費 —— 任何撤退費的寶可夢附上去都會生效（玩家回報的 bug）');
  if (/computeRetreatCostForKOedActive\([^)]*\)\s*!==\s*4/.test(body)) ok('② 判定是「!== 4 就不觸發」（卡面「為4個」＝剛好 4）');
  else no('② 撤退費判定不是 !== 4 —— 卡面是「為4個」，必須剛好等於 4');
  // 反向對照：不得改用 base retreatCost.length
  if (!/retreatCost\?\.length|retreatCost\.length/.test(body)) ok('② 反向對照：沒有用 base retreatCost.length（會漏算重力之玉等修正）');
  else no('② 反向對照：用了 base retreatCost.length —— 違反官方裁定（重力之玉那則）');
} else {
  no("② 找不到 TOOL_ON_KO.set('沉重接力棒')");
}

// ── ③ 正對照：另 8 張「讀取撤退費」的招式必須都走中央（防日後有人改回 base）
const readers = [
  ['src/lib/game/effects.ts', '阿利多斯|線帶纏繞'],
  ['src/lib/game/effects.ts', '鐵包袱|瞬風衝激'],
  ['src/lib/game/effects.ts', '烈箭鷹|氣旋競爭'],
  ['src/lib/game/effects/cards/v2620_i_wave12_misc5.ts', '投摔鬼|背負上投'],
  ['src/lib/game/effects/cards/v2346_j_mark_batch.ts', '尖牙籠|整隻咬'],
  ['src/lib/game/effects/cards/v2760_h_wave3_complex.ts', '長毛巨魔|影繩結'],
];
const cache = new Map();
let readerBad = 0;
for (const [f, key] of readers) {
  if (!cache.has(f)) cache.set(f, readFileSync(join(ROOT, f), 'utf8'));
  const src = cache.get(f);
  const i = src.indexOf(`regPre('${key}'`);
  if (i < 0) { no(`③ 找不到 ${key} 的 regPre（卡名/檔案已變，需重新審）`); readerBad++; continue; }
  if (!src.slice(i, i + 900).includes('computeActiveRetreatCostFor')) {
    no(`③ ${key} 沒走中央 computeActiveRetreatCostFor`); readerBad++;
  }
}
if (readerBad === 0) ok(`③ 6 張「依撤退費計算傷害」的招式全部走中央 computeActiveRetreatCostFor`);

// ── ④ 枚舉守衛（一勞永逸）：卡面出現「【撤退】所需的能量為N個」的 HIJ 卡，
//     實作端必須讀中央撤退費 helper。這次漏網就是因為舊守衛只掃招式、沒掃道具 rulesText。
const CARDS = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(CARDS, 'index.json'), 'utf8')).map(e => e.code));
const CENTRAL = /computeActiveRetreatCostFor|computeRetreatCostForKOedActive/;
const IMPL_FILES = [];
const walk = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) walk(join(dir, f.name));
    else if (f.name.endsWith('.ts')) IMPL_FILES.push(join(dir, f.name));
  }
};
walk(join(ROOT, 'src/lib/game'));
const ALL_IMPL = IMPL_FILES.map(p => readFileSync(p, 'utf8')).join('\n');

const needCentral = [];
for (const f of readdirSync(CARDS)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(CARDS, f), 'utf8'))) {
    if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
    // 「為N個」＝把撤退費當**條件**讀取（不是增減修正）
    const texts = [c.rulesText || '', ...(c.attacks || []).map(a => a.effect || ''),
                   ...(c.abilities || []).map(a => a.effect || '')];
    if (texts.some(t => /【撤退】所需的能量為\d+個/.test(t))) needCentral.push(c.name);
  }
}
const uniq = [...new Set(needCentral)];
if (uniq.length === 0) {
  no('④ 枚舉守衛掃不到任何「【撤退】所需的能量為N個」的卡 —— 掃描器可能壞了（卡面措辭已變？）');
} else {
  ok(`④ 枚舉守衛掃到 ${uniq.length} 張條件式讀撤退費的 HIJ 卡：${uniq.join('、')}`);
  let bad = 0;
  for (const name of uniq) {
    // 該卡的實作區塊附近必須出現中央 helper
    let found = false;
    for (const src of IMPL_FILES.map(p => readFileSync(p, 'utf8'))) {
      let i = src.indexOf(name);
      while (i >= 0) {
        if (CENTRAL.test(src.slice(Math.max(0, i - 400), i + 1600))) { found = true; break; }
        i = src.indexOf(name, i + 1);
      }
      if (found) break;
    }
    if (!found) { no(`④ 「${name}」卡面有「【撤退】所需的能量為N個」條件，實作卻沒讀中央撤退費 helper`); bad++; }
  }
  if (bad === 0) ok('④ 上述每一張的實作都讀了中央撤退費 helper');
}

// ── ⑤ 自我驗證：掃描器對「實作端完全沒有中央 helper」要抓得到
if (CENTRAL.test(ALL_IMPL)) ok('⑤ 自我驗證：中央 helper 名稱在實作端確實存在（否定型掃描的正對照）');
else no('⑤ 自我驗證：實作端找不到任何中央撤退費 helper —— 掃描器前提已崩');

console.log('\n[v6136-heavy-baton-retreat-cost] PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
