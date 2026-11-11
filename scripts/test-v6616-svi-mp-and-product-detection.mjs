#!/usr/bin/env node
import ts from 'typescript';
import { filterNotIgnored } from './lib/tracked-scope.mjs';   // v6.637：既有中央來源母體，不掃被gitignore的診斷殘檔
import { extractBaseArchive } from './lib/base-archive.mjs';
/**
 * v6.616 守衛：M-P 補 17 張、SVI「Trianers Camp」收錄（只收卡圖印 H 的 58 張）、新卡包偵測連官方商品清單
 *
 * 站長 2026-11-01：
 *   「官方有，站上沒有的卡，只要補h i j表的卡就好，已經退標的卡不用管」
 *   「新卡包偵測改成連官方商品清單一起比對。」
 *   「H i j標的話都要收」（SVI）
 *   「只有h i j標要收 收之前，先確認是不是h i j標！ 這是最基本的」
 *   ⇒ ⚠ 官網 detail 頁的標記欄位對舊商品的重印不可靠：SVI 的訓練家卡圖印 G、基本能量卡圖無標記，
 *     官網卻標 I／J。逐張看卡圖左下角後，SVI 只收 58 張（寶可夢 53＋西餐廚師＋野餐女孩×4，全部印 H）。
 *
 * 【D】資料層
 *   D1 M-P 17 張（20083～20092、20096～20098、20100～20103）在 M-P-I／M-P-J，setCode 對、card-set-map 對、
 *      每張在站上都有同名同卡面的既有印刷（tags 逐字相同）；20102 是「老大的指令」（站長 2026-09-15 裁定）
 *   D2 SVI 58 張：id 集合逐一釘住、全部 H、setCode SVI、card-set-map 對、id 不和其他卡包重複；
 *      超能豔鴕 11317 是「1階進化、從飄飄雛進化」（卡圖左上角實看；官網 detail 頁的階段欄位寫「基礎」是錯的，
 *      同 v6.076 大力鱷的教訓：官網單一欄位不可盡信，以卡圖與跨印刷比對為準）
 *   D3 index.json：SVI 條目（名稱照官網、H、2024-08-22、張數與 supertypeCounts 現查）；M-P-I／M-P-J 張數現查；
 *      既有條目（SVI 以外）與 BASE 逐字相同（M-P 兩筆只准改張數三欄）
 *   D4 card-set-map.json：BASE 的鍵值逐字保留
 *   D6 全卡庫 id 一律是字串（審查 P1-1：第一版 M-P 17 張寫成數字，前端卡池查不到）
 *   D5 排序：卡牌資料庫的卡包選單（orderSetsForPicker）裡 SVI 在 H 群、依發售日落在正確位置；
 *      同一群內發售日一律新→舊（站長：「戰術牌組卡包在卡牌資料庫的排序位置也要依據發售日」）
 * 【C】卡面與實作
 *   C1 SVI 每張：要嘛站上有同名同卡面（全欄位相同），要嘛是本版登記的 14 張新卡面之一
 *   C2 行為端：SVI 新卡面的 6 招逐一實跑引擎（含反對照）；有效果的招式全部已註冊、訓練家全部已註冊
 *   C3 零回歸：多麗米亞｜能量支援 抽成中央 helper 後，三種盤面的 log／pending 與 BASE 逐字相同
 *   C4 重印判準唯一一份：refresh 與完整性守衛都 import scripts/lib/official-reprint-match.mjs，別處沒有第二份
 * 【H】HEAD-FAIL：BASE（v6.615）上 D1、D2、D3、C2 紅
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { findSameFace } from './lib/official-reprint-match.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '8e842315';   // v6.615（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 900) : '')); } };
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const HIJ = new Set(['H', 'I', 'J']);

import { V6616_MP_IDS as MP_IDS, V6616_SVI_IDS as SVI_IDS } from './lib/revert-v6616-svi-mp.mjs';   // 單一來源（Rule 38）
// SVI 站上沒有的卡面（14 隻，refresh 實測；逐張看過卡圖核對 HP／屬性／招式／弱點／抵抗／撤退）
// ⚠ 密勒頓 11313：官網 detail 頁弱點寫【火】，卡圖印的是【鬥】⇒ 照卡圖，與 MC 16754 同卡面（重印）
const SVI_NEW_FACES = ['11302', '11303', '11312', '11314', '11315', '11316', '11317', '11318', '11320', '11321', '11324', '11330', '11335', '11338'];

const STRAY = [];
const TMP = mkdtempSync(join(tmpdir(), 'v6616-'));
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* */ } } try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ } });

// ── 卡池 ──
function loadPool(read, exists) {
  const idx = read('static/cards/index.json');
  const pool = new Map(); const byFile = {};
  for (const e of idx) {
    const p = `static/cards/${e.code}.json`;
    if (!exists(p)) continue;
    byFile[e.code] = read(p);
    for (const c of byFile[e.code]) if (c?.id != null) pool.set(String(c.id), c);
  }
  return { idx, pool, byFile };
}

function dataChecks(read, exists) {
  const r = {};
  const { idx, pool, byFile } = loadPool(read, exists);
  const map = read('static/card-set-map.json');
  // D1
  const mp = MP_IDS.map((id) => pool.get(id));
  const others = [...pool.values()].filter((c) => !MP_IDS.includes(String(c.id)) && !SVI_IDS.includes(String(c.id)));
  const fieldsSame = (a, b) => ['supertype', 'subtype', 'stage', 'hp', 'pokemonType', 'evolvesFrom', 'weakness', 'resistance', 'retreatCost', 'abilities', 'attacks', 'rulesText', 'tags', 'name']
    .every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
  r.D1 = mp.every((c) => c && typeof c.id === 'string' && String(c.setCode) === (c.regulationMark === 'I' ? 'M-P-I' : 'M-P-J') && HIJ.has(c.regulationMark)
    && map[String(c.id)] === c.setCode && (byFile[c.setCode] ?? []).some((x) => String(x.id) === String(c.id))
    && findSameFace(c, others) !== null && others.some((o) => fieldsSame(c, o)))
    && pool.get('20102')?.name === '老大的指令';
  // D2
  const svi = byFile.SVI ?? null;
  const elsewhere = new Set(); for (const [code, list] of Object.entries(byFile)) if (code !== 'SVI') for (const c of list) elsewhere.add(String(c.id));
  r.D2 = !!svi && JSON.stringify(svi.map((c) => String(c.id)).sort()) === JSON.stringify([...SVI_IDS].sort())
    && svi.every((c) => c.regulationMark === 'H' && c.setCode === 'SVI' && map[String(c.id)] === 'SVI' && !elsewhere.has(String(c.id)))
    && (() => { const c = svi.find((x) => String(x.id) === '11317'); return c && c.stage === 'Stage1' && c.subtype === 'Stage1' && c.evolvesFrom === '飄飄雛'; })();
  // D3
  const e = idx.find((x) => x.code === 'SVI');
  const st = (list) => { const m = {}; for (const c of list ?? []) m[c.supertype] = (m[c.supertype] || 0) + 1; return Object.fromEntries(['Pokemon', 'Trainer', 'Energy'].filter((k) => m[k]).map((k) => [k, m[k]])); };
  const cnt = (code) => { const x = idx.find((y) => y.code === code); const l = byFile[code] ?? []; return x && x.cardCount === l.length && x.count === l.length && JSON.stringify(x.supertypeCounts) === JSON.stringify(st(l)); };
  r.D3 = !!e && e.name === 'Trianers Camp' && e.regulationMark === 'H' && e.releaseDate === '2024-08-22' && cnt('SVI') && cnt('M-P-I') && cnt('M-P-J');
  return { r, idx, pool, map, byFile, others };
}

const cur = dataChecks(J, (p) => existsSync(join(ROOT, p)));
console.log('【D】資料層');
ok('★★★ D1 M-P 17 張：卡包、card-set-map、同名同卡面既有印刷（含 tags）、老大的指令改名', cur.r.D1);
ok('★★★ D2 SVI 58 張：id 集合、全部 H、setCode、card-set-map、id 不重複、超能豔鴕是 1 階進化（從飄飄雛）', cur.r.D2);
ok('★★ D3 index.json：SVI 條目與 M-P 兩筆張數現查一致', cur.r.D3);
// D6（審查 P1-1）：全卡庫 id 一律是字串 —— 前端卡池用原始 id 當 key（pool.ts／game 頁 merged.set(c.id)），查卡一律 String(cardId)
//   ⇒ 數字 id 的卡永遠查不到（牌組有它就判「還沒載入」一直全量重載）。v6.616 第一版的 M-P 17 張就是數字。
{
  const badId = (c) => !!c && typeof c.id !== 'string';
  const nonStr = [];
  for (const f of readdirSync(join(ROOT, 'static/cards'))) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    for (const c of J('static/cards/' + f)) if (badId(c)) nonStr.push(f + '#' + c.id);
  }
  ok('★★★ D6 全卡庫每張卡的 id 都是字串（數字 id 在前端卡池查不到）', nonStr.length === 0, nonStr.slice(0, 20).join(', '));
  // 正對照：同一支判準對數字 id 必須紅
  ok('★ D6 正對照（同一支 badId）：數字 id 會被判出來、字串 id 不會', badId({ id: 20083 }) && !badId({ id: '20083' }));
}

// D3b／D4 既有內容逐字不動（BASE blob）
let baseData = null;
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const rb = (p) => { const b = readBaseBlob(ROOT, BASE_SHA, p); if (!b.ok) throw new Error('BASE 缺 ' + p); return JSON.parse(b.out); };
  const baseIdx = rb('static/cards/index.json');
  const curIdx = cur.idx;
  const strip = (x) => (x.code === 'M-P-I' || x.code === 'M-P-J') ? { ...x, cardCount: 0, count: 0, supertypeCounts: null } : x;
  ok('★★ D3b index.json：BASE 的每一筆逐字保留（M-P 兩筆只改張數三欄），SVI 加在最後',
    curIdx.length === baseIdx.length + 1 && curIdx.at(-1).code === 'SVI'
    && JSON.stringify(curIdx.slice(0, baseIdx.length).map(strip)) === JSON.stringify(baseIdx.map(strip)));
  const baseMap = rb('static/card-set-map.json');
  const curMap = cur.map;
  const lost = Object.entries(baseMap).filter(([k, v]) => curMap[k] !== v);
  const added = Object.keys(curMap).filter((k) => !(k in baseMap));
  ok('★★ D4 card-set-map.json：BASE 鍵值逐字保留，新增的正好是 17＋58 張', lost.length === 0
    && JSON.stringify(added.sort()) === JSON.stringify([...MP_IDS, ...SVI_IDS].sort()), JSON.stringify({ lost: lost.slice(0, 5), added: added.length }));
  // M-P 兩檔：BASE 的卡逐字保留
  for (const code of ['M-P-I', 'M-P-J']) {
    const b = rb(`static/cards/${code}.json`), c = cur.byFile[code];
    ok(`★ D4b ${code}：BASE 的 ${b.length} 張逐字保留在最前面`, JSON.stringify(c.slice(0, b.length)) === JSON.stringify(b));
  }
  baseData = dataChecks(rb, (p) => readBaseBlob(ROOT, BASE_SHA, p).ok);
} else shallowSkip('test-v6616 D3b／D4／HEAD-FAIL', 'BASE ' + BASE_SHA + ' 不在物件庫');

// D5 排序：真的跑 orderSetsForPicker
{
  const S = join(ROOT, '.v6616-so.mjs'); STRAY.push(S);
  await build({ entryPoints: [join(ROOT, 'src/lib/cards/set-order.ts')], outfile: S, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent' });
  const { orderSetsForPicker, isPromoSet } = await import(pathToFileURL(S).href);
  const groups = orderSetsForPicker(cur.idx);
  const H = groups.find(([m]) => m === 'H')?.[1] ?? [];
  const Jg = groups.find(([m]) => m === 'J')?.[1] ?? [];
  const pos = H.findIndex((s) => s.code === 'SVI');
  const dated = (list) => list.filter((s) => !isPromoSet(s) && s.releaseDate);
  const mono = (list) => dated(list).every((s, i, a) => i === 0 || a[i - 1].releaseDate >= s.releaseDate);
  const before = H[pos - 1], after = H[pos + 1];
  ok('★★ D5 卡包選單：SVI 在 H 群，前一包發售日 ≥ 2024-08-22、後一包 ≤ 2024-08-22；H、J 群發售日一律新→舊（含 v6.615 戰術牌組）',
    pos > 0 && before.releaseDate >= '2024-08-22' && (!after || isPromoSet(after) || !after.releaseDate || after.releaseDate <= '2024-08-22')
    && mono(H) && mono(Jg) && ['MTL', 'MTS', 'MTH', 'MTK'].every((c) => Jg.some((s) => s.code === c)),
    JSON.stringify({ pos, before: before?.code + ' ' + before?.releaseDate, after: after?.code + ' ' + after?.releaseDate }));
}

// ── C1 ──
console.log('【C】卡面與實作');
{
  const svi = cur.byFile.SVI ?? [];
  const bad = [];
  for (const c of svi) {
    const s = findSameFace(c, cur.others);
    const isNew = SVI_NEW_FACES.includes(String(c.id));
    if (isNew && s) bad.push(c.id + ' 列為新卡面卻找到同卡面 ' + s);
    if (!isNew && !s) bad.push(c.id + ' ' + c.name + ' 找不到同名同卡面');
    if (!isNew && s) { const o = cur.pool.get(s); for (const k of ['supertype', 'subtype', 'stage', 'hp', 'evolvesFrom', 'weakness', 'resistance', 'retreatCost', 'abilities', 'attacks', 'rulesText', 'tags']) if (JSON.stringify(c[k] ?? null) !== JSON.stringify(o[k] ?? null)) bad.push(c.id + ' ' + c.name + ' 欄位 ' + k + ' 與 ' + s + ' 不同'); }
  }
  ok('★★★ C1 SVI 每張：同名同卡面（全欄位含 tags）或是本版登記的 14 張新卡面之一', svi.length === 58 && bad.length === 0, bad.join('；'));
}

// ── C2／C3 引擎 ──
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const p = './' + srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const S = join(parent, '.v6616-s-' + tag + '.js'), E = join(parent, '.v6616-e-' + tag + '.ts'), O = join(parent, '.v6616-o-' + tag + '.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "export { applyAction } from '" + p + "/lib/game/engine';\nexport { ATTACK_PRE, ATTACK_POST, TRAINER_EFFECTS } from '" + p + "/lib/game/effects/_shared';\nimport '" + p + "/lib/game/effects';\n");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent' });
  return import(pathToFileURL(O).href);
}
const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
const pool = cur.pool;
const all = [...pool.values()];
const eName = (n) => all.find((c) => c.name === n && c.supertype === 'Energy')?.id;
const COL = String(eName('基本【雷】能量') ?? '');
const en = (cid, iid) => ({ iid, cardId: cid, damage: 0, energyAttached: [] });
const mon = (cid, iid, o = {}) => ({ iid, cardId: cid, damage: 0, energyAttached: [], ...o });
const PL = (name, o = {}) => ({ name, active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...o });
const E6 = (cid) => [1, 2, 3, 4, 5, 6].map((i) => en(cid, 'ae' + i));
const DECK = (cid) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => en(cid, 'dk' + n));
// 肉盾現查（不寫死 id）：HP ≥ 200、沒有抵抗力、弱點不是 6 隻攻擊者的屬性（傷害才是卡面數字）
const ATK_TYPES = new Set(['11303', '11312', '11321', '11324', '11330', '11335'].map((id) => pool.get(id)?.pokemonType).filter(Boolean));
const pickDef = (pred) => all.find((c) => c.supertype === 'Pokemon' && HIJ.has(c.regulationMark) && Number(c.hp) >= 200 && !c.resistance && !ATK_TYPES.has(c.weakness?.type) && pred(c));
const DEF_EX = String(pickDef((c) => /ex$/.test(c.name) && c.subtype === 'ex')?.id ?? '');
const DEF_NONEX = String(pickDef((c) => !/ex$/.test(c.name) && c.subtype !== 'ex')?.id ?? '');
ok('★ fixture：基本【雷】能量、ex 肉盾、非 ex 肉盾都找得到', !!COL && !!DEF_EX && !!DEF_NONEX, JSON.stringify({ COL, DEF_EX, DEF_NONEX }));
const TYPE_ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
// 攻擊者身上附自己屬性的基本能量（無色屬性附雷）⇒ 招式費用一定付得出
const typeEnergy = (t) => String(eName('基本【' + (TYPE_ZH[t] ?? '雷') + '】能量') ?? COL);
const ORND = Math.random;
const withCoin = (v, fn) => { Math.random = () => v; try { return fn(); } finally { Math.random = ORND; } };
const HEADS = 0.1, TAILS = 0.9;
function hit(M, atkId, atkName, { def = DEF_NONEX, defEnergy = 0, bench = [], discard = [] } = {}) {
  const c = pool.get(atkId); const i = (c?.attacks ?? []).findIndex((a) => a.name === atkName);
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      PL('P0', { active: mon(atkId, 'atk', { energyAttached: E6(typeEnergy(c?.pokemonType)) }), deck: DECK(COL), bench, discard }),
      PL('P1', { active: mon(def, 'def', { energyAttached: Array.from({ length: defEnergy }, (_, k) => en(COL, 'de' + k)) }), deck: DECK(COL), bench: [mon(DEF_NONEX, 'db1')] }),
    ],
  };
  try {
    const s = M.applyAction(st, { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool);
    return { dmg: s.players[1].active?.damage ?? null, status: s.players[1].active?.status ?? null, pend: s.pendingSelection?.effectKey ?? null, ptype: s.pendingSelection?.type ?? null, plabel: s.pendingSelection?.params?.label ?? null, pdmg: s.pendingSelection?.params?.damage ?? null, log: s.log.map((l) => (typeof l === 'string' ? l : l?.message ?? '')).join('\n') };
  } catch (e) { return { err: String(e && e.message) }; }
}
function c2(M) {
  const res = {};
  const h1 = withCoin(HEADS, () => hit(M, '11303', '泡沫光線')), t1 = withCoin(TAILS, () => hit(M, '11303', '泡沫光線'));
  res.paralyze = h1.status === 'paralyzed' && h1.dmg === 60 && !t1.status && t1.dmg === 60;
  const b = hit(M, '11312', '瞄準電光');
  res.snipe = b.ptype === 'opp-poke-choose' && b.pend === 'snipe-variable' && b.pdmg === 20;
  const h3 = withCoin(HEADS, () => hit(M, '11321', '雙重粉碎')), t3 = withCoin(TAILS, () => hit(M, '11321', '雙重粉碎'));
  res.multi = h3.dmg === 80 && t3.dmg === 0;
  const ex = hit(M, '11324', '覺悟之牙', { def: DEF_EX }), nx = hit(M, '11324', '覺悟之牙', { def: DEF_NONEX });
  res.exBonus = ex.dmg === 120 && nx.dmg === 50;
  const disc = [en(COL, 'dc1')];
  const k1 = hit(M, '11330', '充溢祈願', { bench: [mon(DEF_NONEX, 'b1')], discard: disc });
  const k0 = hit(M, '11330', '充溢祈願', { bench: [], discard: disc });
  res.attachBench = k1.ptype === 'discard-search' && k1.pend === 'discard-energy-attach-bench-only' && k1.plabel === '充溢祈願' && !k0.pend && /充溢祈願：備戰區沒有寶可夢/.test(k0.log);
  const h6 = withCoin(HEADS, () => hit(M, '11335', '破壞之角', { defEnergy: 2 })), t6 = withCoin(TAILS, () => hit(M, '11335', '破壞之角', { defEnergy: 2 }));
  res.discardEnergy = h6.dmg === 70 && t6.dmg === 70 && h6.pend !== null && t6.pend === null;
  // 全覆蓋：SVI 有效果的招式全部已註冊、訓練家全部已註冊
  const miss = [];
  for (const c of cur.byFile.SVI ?? []) {
    for (const a of c.attacks ?? []) if (a.effect && !M.ATTACK_PRE.has(`${c.name}|${a.name}`) && !M.ATTACK_POST.has(`${c.name}|${a.name}`)) miss.push(`${c.name}|${a.name}`);
    if (c.supertype === 'Trainer' && !M.TRAINER_EFFECTS.has(c.name)) miss.push(c.name);
  }
  res.coverage = (cur.byFile.SVI ?? []).length === 58 && miss.length === 0;
  res.miss = miss;
  return res;
}
const cH = c2(HEAD);
ok('★★★ C2a 瑪力露麗｜泡沫光線：正面麻痺、反面沒有（傷害 60 都打出去）', cH.paralyze);
ok('★★★ C2b 布撥｜瞄準電光：開「選擇對手 1 隻」picker（中央 snipe-variable）、傷害 20', cH.snipe);
ok('★★★ C2c 恰雷姆｜雙重粉碎：2 正 ⇒ 80、2 反 ⇒ 0', cH.multi);
ok('★★★ C2d 故勒頓｜覺悟之牙：對 ex ⇒ 120、對非 ex ⇒ 50', cH.exBonus);
ok('★★★ C2e 基拉祈｜充溢祈願：有備戰 ⇒ 棄牌區基本能量 picker（label 充溢祈願）；沒備戰 ⇒ 不開', cH.attachBench);
ok('★★★ C2f 肯泰羅｜破壞之角：正面 ⇒ 開選能量 picker、反面 ⇒ 不開（傷害 70 都打出去）', cH.discardEnergy);
ok('★★★ C2g 全覆蓋：SVI 有效果的招式與訓練家全部已註冊', cH.coverage, JSON.stringify(cH.miss));

// C3 零回歸：多麗米亞｜能量支援（BASE 引擎 vs 現行）
let BASE_M = null;
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const dirB = join(TMP, 'base');
  mkdirSync(dirB, { recursive: true });
  extractBaseArchive(ROOT, BASE_SHA, ['src'], dirB);
  BASE_M = await bundleFrom(join(dirB, 'src'), 'base');
  const dorumi = all.find((c) => c.name === '多麗米亞' && (c.attacks ?? []).some((a) => a.name === '能量支援'));
  const run = (M, o) => { const r = hit(M, String(dorumi.id), '能量支援', o); return JSON.stringify([r.dmg, r.pend, r.ptype, r.plabel, r.log]); };
  const cases = [{ bench: [], discard: [en(COL, 'x1')] }, { bench: [mon(DEF_NONEX, 'b1')], discard: [] }, { bench: [mon(DEF_NONEX, 'b1')], discard: [en(COL, 'x1')] }];
  const diffs = cases.filter((o) => run(HEAD, o) !== run(BASE_M, o));
  ok('★★ C3 多麗米亞｜能量支援：沒備戰／沒能量／正常 三種盤面，log 與 pending 與 BASE 逐字相同', !!dorumi && diffs.length === 0 && /能量支援：從棄牌區選 1 張基本能量/.test(run(HEAD, cases[2])), JSON.stringify(diffs));
} else shallowSkip('test-v6616 C3', 'BASE ' + BASE_SHA + ' 不在物件庫');

// C4 重印判準唯一一份
{
  // v6.637：空白檔不可能有函式定義；非空檔仍嚴格剝註解，保留完整掃描母體。
  const src = (p) => {
    const text = readFileSync(join(ROOT, p), 'utf8');
    // 非忽略的純註解診斷檔也是合法零定義；由獨立TS parser確認，不能以剝除器自己吐空作豁免。
    const ast = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (ast.statements.length === 0 && ast.parseDiagnostics.length === 0) return '';
    return stripCommentsBlankChecked(text, { label: p });
  };
  const users = ['scripts/refresh-official-set-manifest.mjs', 'scripts/test-official-set-completeness.mjs'];
  const imports = users.every((p) => /import\s*\{[^}]*findSameFace[^}]*\}\s*from\s*'\.\/lib\/official-reprint-match\.mjs'/.test(src(p)));
  const candidates = readdirSync(join(ROOT, 'scripts')).filter(f => f.endsWith('.mjs')).map(f => join(ROOT, 'scripts', f));
  const dup = filterNotIgnored(ROOT, candidates).filter(p => /function\s+(findSameFace|pokemonFace)\b/.test(src('scripts/' + p.split(/[\\/]/).at(-1))));
  ok('★★ C4 重印判準只有 scripts/lib/official-reprint-match.mjs 一份，refresh 與完整性守衛都 import 它', imports && dup.length === 0, JSON.stringify(dup));
}

// ── HEAD-FAIL ──
if (baseData && BASE_M) {
  const cB = c2(BASE_M);
  const red = [!baseData.r.D1 && 'D1', !baseData.r.D2 && 'D2', !baseData.r.D3 && 'D3', !cB.coverage && 'C2g'].filter(Boolean);
  console.log('  （BASE 上紅的：' + red.join('、') + '）');
  ok('★★ HEAD-FAIL：BASE（v6.615）上 D1、D2、D3、C2g 全紅', red.length === 4, red.join(','));
}

console.log(`\n=== v6.616 M-P 補卡／SVI 收錄／新卡包偵測：${pass} PASS / ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
