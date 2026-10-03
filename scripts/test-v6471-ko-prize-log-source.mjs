#!/usr/bin/env node
/**
 * v6.471 守衛：KO 獎賞修正的對戰紀錄要寫對來源（中央管線 koDefenderSidePrizeModifiers）
 *
 * 站長回報（2026-10-03）：「傳說的山頂」讓獎賞卡少拿 1 張時，對戰紀錄寫「『影藏』啟動」——
 *   效果是對的，敘述是錯的。影藏是超級耿鬼ex 的特性，不是傳說的山頂的效果。
 * 根因：engine 主傷害 KO 分支把影藏與傳說的山頂累加進同一個 prizeAdjust，log 只看 prizeAdjust < 0 就一律寫影藏
 *   （兩者疊加時還寫「減少 1 張」、實際少 2 張）；effects.ts 側 koPrizesAdjusted（狙擊／指示物／多目標 KO）
 *   則完全不寫道具／古舊能量／傳說的山頂／影藏的 log。
 * 修法：中央 koDefenderSidePrizeModifiers 逐項回傳 { 名稱, 張數, log }，張數由這份清單加總、log 由同一份清單印出；
 *   另印一行標出處的算式（koPrizeFormulaLog）。兩條管線都改用它。
 *
 * 判準（實跑引擎，同一份盤面也餵 BASE＝v6.470 的引擎）：
 *   A 傳說的山頂＋非 ex 攻擊方 KO【無】寶可夢 → 獎賞 0；紀錄有「傳說的山頂（競技場）」、沒有「影藏」  ★HEAD-FAIL
 *   B 影藏：ex 攻擊方 KO【惡】寶可夢、對手備戰有超級耿鬼ex → 獎賞 0；紀錄寫「影藏（超級耿鬼ex 的特性）」、沒有「傳說的山頂」
 *   C 疊加：傳說的山頂＋古舊能量，KO【無】的寶可夢ex（2 張）→ 0 張；兩個來源各一行＋算式「-1（古舊能量）-1（傳說的山頂）= 0 張」★HEAD-FAIL
 *   D effects 側（koPrizesAdjusted，狙擊等 KO 路徑）：同樣寫出傳說的山頂那一行與算式（原本完全沒寫）★HEAD-FAIL
 *   E 效果 KO（koByAttackDamage=false）不套任何修正、也不印修正 log
 *   F 張數與 BASE 逐案相同（只改敘述，不改結果）
 *   G 沒有修正時不多印算式（一般 KO 的紀錄不變）
 *   H 脆弱蛻殼讓對手拿不到獎賞時，不再寫「多餘花粉 +2 張獎賞卡」（Fable 審查找到的同型敘述錯誤）★HEAD-FAIL
 *   P 寶可夢道具寫出道具名（莉莉艾的珍珠）
 *
 * Run: node scripts/test-v6471-ko-prize-log-source.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.470
const BASE_SHA = '0e0f00a9';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const tmps = [];
process.on('exit', () => { for (const p of tmps) { try { rmSync(p, { recursive: true, force: true }); } catch {} } });
/** 把 srcRoot 底下的引擎打包成可 import 的模組 */
async function bundle(srcRoot, tag) {
  const d = mkdtempSync(join(tmpdir(), 'v6471-' + tag + '-')); tmps.push(d);
  const S = join(d, 's.js'), E = join(d, 'e.ts'), O = join(d, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, `export { applyAction } from '${join(srcRoot, 'src/lib/game/engine').replace(/\\/g, '/')}';\nexport { koPrizesAdjusted } from '${join(srcRoot, 'src/lib/game/effects').replace(/\\/g, '/')}';`);
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return import(pathToFileURL(O).href);
}

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const LION = '18508';      // 小獅獅｜撞擊 [無] 10（非 ex、乾淨）
const LAPRAS = '14085';    // 拉普拉斯ex｜衝浪 [水水水] 140（寶可夢ex）
const WATER = '18519';
const ENERGY = '14102';    // 基本【草】能量
const MILTANK = '14011';   // 大奶罐（【無】基礎，1 張）
const EEVEE_EX = '19383';  // 伊布ex（【無】寶可夢ex，2 張）
const SNEASEL = '14421';   // 狃拉（【惡】基礎，1 張）
const GENGAR = '15978';    // 超級耿鬼ex（影藏）
const PEAK = '19622';      // 傳說的山頂
const ANCIENT = '17212';   // 古舊能量
const SHEDINJA = '14063';  // 脫殼忍者（脆弱蛻殼）I
const LILLIE_MON = '16811'; // 莉莉艾的花療環環 I（1 張）
const PEARL = '17163';     // 莉莉艾的珍珠 I
for (const [n, id] of Object.entries({ LION, LAPRAS, WATER, MILTANK, EEVEE_EX, SNEASEL, GENGAR, PEAK, ANCIENT, SHEDINJA, LILLIE_MON, PEARL })) ok(`[前提] 卡庫有 ${n}（${id}）`, pool.has(id), pool.get(id)?.name);
const hpOf = (cid) => Number(pool.get(cid)?.hp ?? 0);

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = (n) => Array.from({ length: n }, () => inst(ENERGY));
function mk({ atk = 'lion', defCid, defEnergy = [], defBench = [inst(MILTANK)], stadium = null, defExtra = {} }) {
  const atkInst = atk === 'lion' ? inst(LION, { energyAttached: [inst(ENERGY)] }) : inst(LAPRAS, { energyAttached: [inst(WATER), inst(WATER), inst(WATER)] });
  const s = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], ancientEnergyMinusOneUsed: [false, false],
    players: [
      { name: 'P1', active: atkInst, bench: [inst(MILTANK)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: inst(defCid, { damage: hpOf(defCid) - 10, energyAttached: defEnergy, ...defExtra }), bench: defBench, hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
    ] };
  if (stadium) { s.activeStadium = inst(stadium); s.activeStadiumOwnerIdx = 0; }
  return s;
}
const ATK = (atk) => ({ type: 'ATTACK', attackIndex: atk === 'lion' ? 0 : 1 });
const CASES = {
  A: () => ({ st: mk({ defCid: MILTANK, stadium: PEAK }), act: ATK('lion') }),
  B: () => ({ st: mk({ atk: 'lapras', defCid: SNEASEL, defBench: [inst(GENGAR)] }), act: ATK('lapras') }),
  C: () => ({ st: mk({ defCid: EEVEE_EX, defEnergy: [inst(ANCIENT)], stadium: PEAK }), act: ATK('lion') }),
  G: () => ({ st: mk({ defCid: MILTANK }), act: ATK('lion') }),
  // 脆弱蛻殼（ex 攻擊方）＋多餘花粉遺留 +2 ⇒ 對手無法獲得獎賞卡，不可再寫「+2 張獎賞卡」
  H: () => ({ st: mk({ atk: 'lapras', defCid: SHEDINJA, defExtra: { deferredPrizeBonusThisTurn: 2 } }), act: ATK('lapras') }),
  // 寶可夢道具：莉莉艾的珍珠＋莉莉艾的寶可夢 ⇒ 0 張，寫出道具名（原本是籠統的「道具調整獎賞卡」）
  P: () => ({ st: mk({ defCid: LILLIE_MON, defExtra: { toolAttached: inst(PEARL) } }), act: ATK('lion') }),
};
/** 實跑一案：回傳 { taken（攻擊方待取＋已取）, log } */
function run(M, key) {
  nn = 0;
  const { st, act } = CASES[key]();
  const out = M.applyAction(st, act, pool);
  const taken = (6 - out.players[0].prizes.length) + (out.pendingPrizes?.[0] ?? 0);
  return { taken, log: (out.log || []).map((l) => (typeof l === 'string' ? l : l.text ?? l.message ?? JSON.stringify(l))).join('\n') };
}
/** effects 側：直接呼叫 koPrizesAdjusted（狙擊／多目標等 KO 路徑共用的中央函式） */
function runFx(M, koByAttackDamage) {
  nn = 0;
  const st = mk({ defCid: MILTANK, stadium: PEAK });
  const r = M.koPrizesAdjusted(st, st.players[1].active, pool.get(MILTANK), 0, 1, pool, koByAttackDamage);
  return { prizes: r.prizes, log: (r.state.log || []).map((l) => (typeof l === 'string' ? l : l.text ?? l.message ?? JSON.stringify(l))).join('\n') };
}

const CUR = await bundle(ROOT, 'cur');
console.log('【行為】本版引擎');
const a = run(CUR, 'A'), b = run(CUR, 'B'), c = run(CUR, 'C'), g = run(CUR, 'G'), h = run(CUR, 'H'), pp = run(CUR, 'P');
ok('★★★[A] 傳說的山頂：獎賞 0；紀錄寫「傳說的山頂（競技場）」、沒有「影藏」', a.taken === 0 && /🏔️ 傳說的山頂（競技場）：大奶罐 是【無】寶可夢/.test(a.log) && !/影藏/.test(a.log) && /-1（傳說的山頂） = 0 張/.test(a.log), JSON.stringify({ taken: a.taken, log: a.log.slice(-400) }));
ok('★★[B] 影藏：獎賞 0；紀錄寫「影藏（超級耿鬼ex 的特性）」、沒有「傳說的山頂」', b.taken === 0 && /👻 影藏（超級耿鬼ex 的特性）：狃拉 是【惡】寶可夢/.test(b.log) && !/傳說的山頂/.test(b.log) && /-1（影藏） = 0 張/.test(b.log), JSON.stringify({ taken: b.taken, log: b.log.slice(-400) }));
ok('★★★[C] 疊加（古舊能量＋傳說的山頂）：0 張；兩個來源各一行＋完整算式', c.taken === 0 && /⚡ 古舊能量（ACE SPEC）：伊布ex 附有「古舊能量」/.test(c.log) && /🏔️ 傳說的山頂（競技場）：伊布ex/.test(c.log)
  && /🧮 獎賞卡：基本 2 張 -1（古舊能量） -1（傳說的山頂） = 0 張/.test(c.log) && !/影藏/.test(c.log), JSON.stringify({ taken: c.taken, log: c.log.slice(-500) }));
ok('★★[H] 脆弱蛻殼：0 張；不再寫「多餘花粉…+2 張獎賞卡」（敘述與實際一致）', h.taken === 0 && /脆弱蛻殼/.test(h.log) && !/\+2 張獎賞卡/.test(h.log) && !/🧮/.test(h.log), JSON.stringify({ taken: h.taken, log: h.log.slice(-400) }));
ok('★★[P] 莉莉艾的珍珠：0 張；寫出道具名與算式', pp.taken === 0 && /🔧 莉莉艾的珍珠（寶可夢道具）：莉莉艾的花療環環 附有「莉莉艾的珍珠」/.test(pp.log) && /-1（莉莉艾的珍珠） = 0 張/.test(pp.log), JSON.stringify({ taken: pp.taken, log: pp.log.slice(-400) }));
ok('★[G] 沒有修正時不多印算式、不出現任何修正來源', g.taken === 1 && !/🧮|傳說的山頂|影藏|古舊能量/.test(g.log), JSON.stringify({ taken: g.taken }));
const d = runFx(CUR, true), e = runFx(CUR, false);
ok('★★★[D] effects 側（koPrizesAdjusted）：傳說的山頂 → 0 張，並寫出來源與算式', d.prizes === 0 && /🏔️ 傳說的山頂（競技場）/.test(d.log) && /🧮 獎賞卡：基本 1 張 -1（傳說的山頂） = 0 張/.test(d.log), JSON.stringify(d));
ok('★★[E] 效果 KO（不是招式傷害）不套修正、也不印修正 log', e.prizes === 1 && !/🏔️|🧮/.test(e.log), JSON.stringify(e));

console.log('\n【H】同一批盤面餵 BASE（v6.470）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6471 H：BASE 對照', '需要 v6.470 commit');
else {
  const bd = mkdtempSync(join(tmpdir(), 'v6471-basesrc-')); tmps.push(bd);
  const tar = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', BASE_SHA, 'src'], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', bd], { input: tar });
  const BASE = await bundle(bd, 'base');
  const bh = run(BASE, 'H'), bpp = run(BASE, 'P');
  const ba = run(BASE, 'A'), bb = run(BASE, 'B'), bc = run(BASE, 'C'), bg = run(BASE, 'G'), bdx = runFx(BASE, true), be = runFx(BASE, false);
  ok('★★★[HEAD-FAIL A] v6.470：傳說的山頂的 KO 紀錄寫成「影藏」啟動（重現站長回報）', /「影藏」啟動/.test(ba.log) && !/傳說的山頂（競技場）/.test(ba.log), ba.log.slice(-300));
  ok('★★[HEAD-FAIL C] v6.470：疊加時沒有分項與算式', !/🧮/.test(bc.log), bc.log.slice(-300));
  ok('★★[HEAD-FAIL H] v6.470：脆弱蛻殼歸 0 時仍寫「+2 張獎賞卡」', /\+2 張獎賞卡/.test(bh.log), bh.log.slice(-300));
  ok('★★[HEAD-FAIL D] v6.470：effects 側不寫傳說的山頂', !/傳說的山頂/.test(bdx.log), bdx.log.slice(-300));
  ok('★★★[F] 張數與 v6.470 逐案相同（A／B／C／G／H／P／effects 招式傷害／effects 效果 KO）',
    ba.taken === a.taken && bb.taken === b.taken && bc.taken === c.taken && bg.taken === g.taken && bh.taken === h.taken && bpp.taken === pp.taken && bdx.prizes === d.prizes && be.prizes === e.prizes,
    JSON.stringify({ base: [ba.taken, bb.taken, bc.taken, bg.taken, bh.taken, bpp.taken, bdx.prizes, be.prizes], cur: [a.taken, b.taken, c.taken, g.taken, h.taken, pp.taken, d.prizes, e.prizes] }));
  ok('★[F2] 一般 KO（無修正）紀錄與 v6.470 逐字相同', bg.log === g.log, JSON.stringify({ base: bg.log.slice(-200), cur: g.log.slice(-200) }));
}

console.log(`\n=== v6.471 KO 獎賞修正紀錄來源: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6471-ko-prize-log-source ===');
process.exit(fail ? 1 : 0);
