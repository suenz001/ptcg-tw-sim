// v6.335 守衛：M6「綠寶石風暴」高編號印刷（077/076 ～ 113/076，SAR／AR／UR 等）補齊。
//
// 這批卡的性質：**與本體編號的卡完全相同**（官方 detail 逐字比對過），只是另一種插圖／稀有度。
// 所以這支守衛要守的不是「效果對不對」（效果由來源印刷的既有守衛守），而是：
//   ① 資料面沒有半吊子（編號連號、id 唯一、圖片依自己的 id、card-set-map／index.json 同步）
//   ② clone **沒有抓錯來源**（卡面逐字要等於某一張既有的同名卡）
//   ③ ⭐行為端：新印刷放上場真的跑 applyAction，結果必須與來源印刷一致（不是只比字串）
//   ④ 牌組合法性：J 標且 M6 不在 DECK_LOCKED_SETS ⇒ 可組牌；M6a 仍必須被擋（正對照）
//
// ⚠ 反安慰劑：每一節都有正對照／突變測試；HEAD-FAIL 走中央 scripts/lib/base-blob.mjs，
//   淺複製取不到歷史時大聲 shallowSkip，絕不 fail-open。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '813fd407990cdfde217c7190dccb5c4d227450e8'; // v6.334（本版之前）
const DIR = join(ROOT, 'static/cards');

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra ? ':: ' + extra : ''); }
};

// ── 卡庫 ────────────────────────────────────────────────────────────────────
const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
const live = new Set(index.map((e) => e.code));
const all = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) if (c?.id != null) all.push(c);
}
const pool = new Map(all.map((c) => [String(c.id), c]));
const m6 = all.filter((c) => c.setCode === 'M6');
const NEW_NUMS = Array.from({ length: 37 }, (_, i) => String(77 + i).padStart(3, '0') + '/076');
const news = NEW_NUMS.map((n) => m6.find((c) => c.collectorNumber === n)).filter(Boolean);

const Z = (s) => (s || '').replace(/[​-‏﻿]/g, '').replace(/\s+/g, ' ').trim();
const face = (c) => {
  if (c.supertype === 'Pokemon') {
    const p = [];
    for (const a of c.abilities || []) p.push('ABIL:' + Z(a.label) + '|' + Z(a.name) + '|' + Z(a.effect));
    for (const a of c.attacks || []) p.push('ATK:' + Z(a.name) + '|' + Z(a.damage) + '|' + (a.cost || []).join('') + '|' + Z(a.effect));
    return String(c.hp) + '/' + c.pokemonType + '\n' + p.join('\n');
  }
  return 'RULES:' + Z(c.rulesText ?? c.effect ?? '');
};
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【A】資料面：37 張高編號印刷收齊且各表同步');
chk('A0 掃描器真的掃到東西（找到 37 張，不是 0 張全綠）', news.length === 37, String(news.length));
{
  const missing = NEW_NUMS.filter((n) => !m6.some((c) => c.collectorNumber === n));
  chk('A1 077/076 ～ 113/076 連號無缺', missing.length === 0, missing.join(','));
  const badSet = news.filter((c) => c.setCode !== 'M6' || c.regulationMark !== 'J');
  chk('A2 每張 setCode=M6 且 regulationMark=J', badSet.length === 0, badSet.map((c) => c.collectorNumber).join(','));
  const ids = news.map((c) => String(c.id));
  chk('A2b id 全部落在官方區間 19631~19667 且不重複',
      new Set(ids).size === 37 && ids.every((i) => /^\d+$/.test(i) && Number(i) >= 19631 && Number(i) <= 19667));
  const dupIds = all.map((c) => String(c.id)).filter((i, _n, arr) => arr.indexOf(i) !== arr.lastIndexOf(i));
  chk('A2c 全站 cardId 唯一（clone 沒撞號）', dupIds.length === 0, [...new Set(dupIds)].slice(0, 5).join(','));
  const badImg = news.filter((c) =>
    c.imageUrl !== 'https://asia.pokemon-card.com/tw/card-img/tw' + String(c.id).padStart(8, '0') + '.png'
    || c.sourceUrl !== 'https://asia.pokemon-card.com/tw/card-search/detail/' + c.id + '/');
  chk('A3 ⭐ imageUrl／sourceUrl 依**自己的 id** 重算（不是抄來源那張）',
      badImg.length === 0, badImg.map((c) => c.collectorNumber).join(','));
  const map = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));
  const notMapped = news.filter((c) => map[String(c.id)] !== 'M6');
  chk('A4 ⭐ card-set-map.json 這 37 個 id 都指向 M6（漏了會讓卡片載不進來）',
      notMapped.length === 0, notMapped.map((c) => c.id).join(','));
  chk('A4b card-set-map 的 M6 條目數 = M6.json 張數',
      Object.values(map).filter((v) => v === 'M6').length === m6.length, String(m6.length));
  const e = index.find((x) => x.code === 'M6');
  chk('A5 index.json 的 M6 張數與 supertypeCounts 與實際相符',
      e && e.cardCount === m6.length && e.count === m6.length
      && e.supertypeCounts.Pokemon === m6.filter((c) => c.supertype === 'Pokemon').length
      && e.supertypeCounts.Trainer === m6.filter((c) => c.supertype === 'Trainer').length
      && e.supertypeCounts.Energy === m6.filter((c) => c.supertype === 'Energy').length,
      JSON.stringify(e && e.supertypeCounts));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【B】卡面逐字 = 某一張既有的同名卡（clone 沒抓錯來源）');
const srcOf = (c, universe) => universe.filter((x) => x.name === c.name && String(x.id) !== String(c.id) && face(x) === face(c));
{
  const older = all.filter((c) => !(c.setCode === 'M6' && NEW_NUMS.includes(c.collectorNumber)));
  const orphan = news.filter((c) => srcOf(c, older).length === 0);
  chk('B1 ⭐⭐ 每一張新印刷的卡面（HP／屬性／特性／招式／規則文字）逐字等於某張既有同名卡',
      orphan.length === 0, orphan.map((c) => c.collectorNumber + ' ' + c.name).join(' | '));
  // ⚠ 突變測試：把其中一張的招式傷害改掉，B1 必須抓得到（否則 B1 是恆真式）
  const victim = news.find((c) => (c.attacks || []).length > 0);
  const mutated = JSON.parse(JSON.stringify(victim));
  mutated.attacks[0].damage = String(mutated.attacks[0].damage) + '9';
  chk('B2 ⚠ 突變：改掉一張新印刷的招式傷害 ⇒ B1 必須紅（證明不是恆真式）',
      srcOf(mutated, older).length === 0, victim.collectorNumber);
  // 同一張卡的多個新印刷之間也必須完全相同
  const byName = new Map();
  for (const c of news) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  const multi = [...byName.entries()].filter(([, v]) => v.length > 1);
  const inconsistent = multi.filter(([, v]) => new Set(v.map(face)).size !== 1);
  chk('B3 同一張卡的多個新印刷（089/107、095/110/113 等）彼此卡面完全相同',
      multi.length >= 5 && inconsistent.length === 0,
      'multi=' + multi.length + ' bad=' + inconsistent.map(([n]) => n).join(','));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐ 行為端：新印刷真的跑 applyAction，結果與來源印刷一致');
const STUB = join(ROOT, '.stub-v6335.js');
writeFileSync(STUB, 'export const base="";');
const ENT = join(ROOT, '.ent-v6335.ts');
const OUT = join(ROOT, '.ent-v6335.mjs');
writeFileSync(ENT,
  "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { isDeckLockedCard, isCardMarkStandardLegal } from './src/lib/cards/regulation';\n");
await build({
  entryPoints: [ENT], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': STUB }, logLevel: 'error',
});
const mod = await import(pathToFileURL(OUT).href + '?t=' + Date.now());

let _i = 0;
const inst = (cid, e = {}) => ({ iid: 'g' + (++_i), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const SUP = '14019', E_GRASS = '14102';
// ⚠ 防守者故意用高 HP 的 009/076（340）：若用 60HP 的鬼斯，兩邊都回 'KO'，
//   C1 就成了「反正都相等」的恐真式（實測過，這是安慰劑）。
const DEF = '19559';
function attackDamage(attackerCardId, attackIndex, energyCount) {
  _i = 0;
  const s = mod.createGame({ name: 'P1', entries: [{ cardId: SUP, count: 1 }] },
                           { name: 'P2', entries: [{ cardId: SUP, count: 1 }] }, pool);
  const att = inst(attackerCardId, { energyAttached: Array.from({ length: energyCount }, () => inst(E_GRASS)) });
  const def = inst(DEF);
  const mk = (p, o) => ({ ...p, hand: [], deck: [inst(SUP)], discard: [], bench: [],
    prizes: Array.from({ length: 6 }, () => inst(SUP)), ...o });
  const st = { ...s, phase: 'playing', turnPhase: 'main', turn: 3, activePlayerIndex: 0,
    firstPlayerIdx: 0, isFirstTurn: false, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [mk(s.players[0], { active: att }), mk(s.players[1], { active: def })] };
  const n = mod.applyAction(st, { type: 'ATTACK', attackIndex }, pool);
  return n.players[1].active ? n.players[1].active.damage : 'KO';
}
{
  // 089/076（新印刷）vs 009/076（來源）—— 超級具甲武者ex｜四爪控制（無色×3、160）
  const newC = m6.find((c) => c.collectorNumber === '089/076');
  const srcC = m6.find((c) => c.collectorNumber === '009/076');
  chk('C0 取得對照組（089/076 與 009/076 都在卡庫裡）', !!newC && !!srcC);
  if (newC && srcC) {
    const idx = (newC.attacks || []).findIndex((a) => a.name === '四爪控制');
    chk('C0b 招式索引一致（新印刷與來源的 attacks 順序相同）',
        idx >= 0 && idx === (srcC.attacks || []).findIndex((a) => a.name === '四爪控制'));
    const a = attackDamage(newC.id, idx, 3);
    const b = attackDamage(srcC.id, idx, 3);
    chk(`C1 ⭐⭐ 新印刷打出來的傷害與來源印刷相同（新 ${a} / 來源 ${b}）`, a === b && a !== 0 && a !== undefined);
    // 正對照：換一張別的卡，傷害必須不同 ⇒ 證明 C1 不是「反正都回同一個值」
    // 正對照：同一張卡改打另一招，傷害必須不同 ⇒ 證明 harness 不是反正都回同一個值
    const oi = (newC.attacks || []).findIndex((x) => x.name !== '四爪控制');
    const d = attackDamage(newC.id, oi, 3);
    chk(`C2 ⚠ 正對照：同一張卡打另一招，傷害就不同（${d} ≠ ${a}）`,
        d !== a && typeof d === 'number' && typeof a === 'number');
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【D】牌組合法性：可組進標準賽；M6a 仍被擋（正對照）');
{
  const badMark = news.filter((c) => mod.isCardMarkStandardLegal(c.regulationMark) !== true);
  chk('D1 37 張全部是標準賽可用的標記', badMark.length === 0, badMark.map((c) => c.collectorNumber).join(','));
  const locked = news.filter((c) => mod.isDeckLockedCard(c) !== false);
  chk('D2 37 張都不在 DECK_LOCKED_SETS（M6 開放組牌）', locked.length === 0, locked.map((c) => c.collectorNumber).join(','));
  const m6a = all.find((c) => c.setCode === 'M6a');
  chk('D3 ⚠ 正對照：M6a 的卡仍然被擋（證明 D2 不是恆真式）', !!m6a && mod.isDeckLockedCard(m6a) === true);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【E】HEAD-FAIL：BASE（v6.334）沒有這 37 張 ⇒ A 必須整批紅');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip(`v6.335 HEAD-FAIL（BASE ${BASE_SHA.slice(0, 8)} 的 M6.json／card-set-map 對照）`,
    '這個 checkout 沒有 BASE 那顆 commit（淺複製）');
} else {
  const bM6 = readBaseBlob(ROOT, BASE_SHA, 'static/cards/M6.json');
  const bMap = readBaseBlob(ROOT, BASE_SHA, 'static/card-set-map.json');
  if (!bM6.ok || !bMap.ok) {
    shallowSkip('v6.335 HEAD-FAIL', '取不到 BASE blob');
  } else {
    const oldM6 = JSON.parse(bM6.out);
    const oldMap = JSON.parse(bMap.out);
    const oldNums = new Set(oldM6.map((c) => c.collectorNumber));
    chk('E1 BASE 的 M6.json 一張高編號都沒有（A1 對 BASE 必紅）',
        NEW_NUMS.every((n) => !oldNums.has(n)) && oldM6.length === m6.length - 37,
        'baseLen=' + oldM6.length);
    chk('E2 BASE 的 card-set-map 沒有這 37 個 id（A4 對 BASE 必紅）',
        news.every((c) => oldMap[String(c.id)] === undefined));
    chk('E3 ⚠ 哨兵：BASE 本來就有的本體編號（001/076）在 BASE 也找得到 —— 若這條也紅代表 BASE blob 根本沒讀到',
        oldNums.has('001/076'));
    // ⭐ 真正在守「沒搬動資料」的那一條：新卡只能 append，既有 76 筆必須逐字未變
    const curM6 = JSON.parse(readFileSync(join(DIR, 'M6.json'), 'utf8'));
    chk('E4 ⭐⭐ 補卡只是 append：M6.json 原本那 ' + oldM6.length + ' 筆相對 BASE 逐字未變',
        JSON.stringify(curM6.slice(0, oldM6.length)) === JSON.stringify(oldM6));
  }
}

console.log(`\n=== v6.335 M6 高編號印刷：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
