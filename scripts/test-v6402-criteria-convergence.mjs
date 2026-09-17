#!/usr/bin/env node
/**
 * v6.402 守衛：站長點名的「龐克頭盔／豪邁炸彈判準收斂」，擴大成
 * **「同一個判準只能有一份」＋「場上寶可夢屬性一律問有效屬性」** 兩條線（IRON_RULES Rule 38 / Rule 52 家族）。
 *
 * 【收斂前 vs 收斂後】
 *   ① 龐克頭盔：engine 主管線（攻擊前預算 punkReflectDamage）與 effects.fireDefenderOnDamaged
 *      各寫一份 ⇒ 收斂成中央 punkHelmetReflectDamageFor（兩份都漏了 extraTools、都直讀印刷屬性）。
 *   ② 「對手的『超級進化寶可夢【ex】』打我、而我不是」這個兩層判準寫了**三份**
 *      （訂製背心、豪邁炸彈 TOOL_ON_DAMAGED、engine 的 KO 路徑）⇒ 收斂成
 *      megaExAttackerAndNonMegaHolder ＋ luxuryBombGateOk。
 *   ③ TOOL_DEFENSE_REDUCE_BY_TYPE 的觸發判準（攻擊方屬性 ＋ holderTypes）engine／effects
 *      兩份逐字重複 ⇒ 收斂成 toolDefenseByTypeApplies。
 *   ④ 「附有這張卡的【X】寶可夢」holder 屬性：硬岩【鬥】／伏特【雷】×2／燃料【火】／
 *      暗影【惡】／重試徽章×2／磁鐵【鋼】／泡沫【水】全部改問中央 fieldPokemonHasType
 *      ／ctx.effectiveTypes（收斂前一律直讀印刷 pokemonType）。
 *   ⑤ 「這個 inst 在誰的場上」engine.getEffectiveHP 內 inline 一份 ⇒ 收斂成 fieldOwnerIdxOf。
 *
 * 【為什麼是零行為變化】會改變「有效屬性」的只有三張卡＋化石：
 *   狠辣椒ex（印刷【火】→【草】【火】）、小碎鑽（印刷【鬥】→【鬥】【超】）、
 *   鐵轍跡（印刷【鋼】→【鬥】【鋼】，且需要 G 標的「驅勁能量 未來」⇒ H/I/J 不可達）、
 *   化石在場上是【無】（v6.208）。
 *   本版接上的屬性條件是【惡】【龍】【鬥】【雷】【火】【水】【鋼】【無】——
 *   三張卡的**印刷屬性本來就已經命中**它們各自的條件，化石沒有招式，
 *   ⇒ 逐一實跑證明差異為 0（見【E】）。
 *
 * ⚠ Rule 41：中央述詞在 BASE 上不存在 ⇒ 一律用哨兵包起來，讓每一條各自誠實翻紅。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
const S = join(ROOT, '.x-402-s.js'), E = join(ROOT, '.x-402-e.ts'), O = join(ROOT, '.x-402-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* 忽略 */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { punkHelmetReflectDamageFor, PUNK_HELMET_REFLECT_DAMAGE, toolDefenseByTypeApplies,\n"
  + "  fieldPokemonHasType, fieldOwnerIdxOf, fieldSlotOf, specialEnergyHolderCtx,\n"
  + "  megaExAttackerAndNonMegaHolder, luxuryBombGateOk, LUXURY_BOMB_DAMAGE_THRESHOLD,\n"
  + "  getEffectivePokemonTypes, checkSpecialEnergyStatusImmune,\n"
  + "  TOOL_ON_DAMAGED, TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD,\n"
  + "  SPECIAL_ENERGY_RETREAT_MOD, SPECIAL_ENERGY_STATUS_IMMUNE } from './src/lib/game/effects';\n"
  + "export { createGame, applyAction, getRetreatCost } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);

/** ⚠ Rule 41 哨兵：BASE 上沒有這些 export ⇒ 不可以讓整支 throw。 */
const MISSING = Symbol('missing');
const F = (n) => (typeof M?.[n] === 'function' ? M[n] : () => MISSING);
const punkHelmetReflectDamageFor = F('punkHelmetReflectDamageFor');
const toolDefenseByTypeApplies = F('toolDefenseByTypeApplies');
const fieldPokemonHasType = F('fieldPokemonHasType');
const fieldOwnerIdxOf = F('fieldOwnerIdxOf');
const specialEnergyHolderCtx = F('specialEnergyHolderCtx');
const megaExAttackerAndNonMegaHolder = F('megaExAttackerAndNonMegaHolder');
const luxuryBombGateOk = F('luxuryBombGateOk');
const { getEffectivePokemonTypes, createGame, applyAction, TOOL_ON_DAMAGED,
  TOOL_DEFENSE_REDUCE_BY_TYPE, TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD,
  SPECIAL_ENERGY_RETREAT_MOD, SPECIAL_ENERGY_STATUS_IMMUNE, checkSpecialEnergyStatusImmune } = M;

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => c && ['H', 'I', 'J'].includes(c.regulationMark);
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS ' + n); pass++; } catch (e) { console.log('  FAIL ' + n + ' :: ' + e.message); fail++; } };

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const idByName = (n, pred) => { for (const [id, c] of pool) if (c?.name === n && HIJ(c) && (!pred || pred(c))) return id; return null; };
const cardsNamed = (n) => [...pool.values()].filter((c) => c?.name === n && HIJ(c));

/** 最小可用的 GameState（createGame 產生完整骨架，再覆蓋雙方場面）。 */
const FILLER = idByName('皮寶寶') ?? [...pool.keys()].find((id) => pool.get(id)?.supertype === 'Pokemon');
function mkState(a0, a1, opts = {}) {
  const s0 = createGame({ name: 'P1', entries: [{ cardId: FILLER, count: 1 }] },
                        { name: 'P2', entries: [{ cardId: FILLER, count: 1 }] }, pool);
  return { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    activeStadium: opts.stadiumId ? inst(opts.stadiumId) : null,
    players: [
      { ...s0.players[0], hand: [], deck: [inst(FILLER)], discard: [], prizes: [], active: a0, bench: opts.bench0 ?? [] },
      { ...s0.players[1], hand: [], deck: [inst(FILLER)], discard: [], prizes: [], active: a1, bench: opts.bench1 ?? [] }] };
}

// ════════════════════════════════════════════════════════════════════════════
console.log('【0】哨兵（環境／中央述詞存在；BASE 沙盒會在這裡就全部誠實翻紅）');
T('F0 ★ 卡池讀得到、H/I/J 張數夠（掃描器壞了要立刻發現）', () => {
  assert.ok(pool.size > 3000, 'pool 只有 ' + pool.size + ' 張');
  assert.ok([...pool.values()].filter(HIJ).length > 3000, 'H/I/J 張數不足');
});
T('F1 ⭐ 六支中央述詞都存在（Rule 41 哨兵；缺席時下面每一條各自紅，不是整支爆掉）', () => {
  for (const n of ['punkHelmetReflectDamageFor', 'toolDefenseByTypeApplies', 'fieldPokemonHasType',
    'fieldOwnerIdxOf', 'specialEnergyHolderCtx', 'megaExAttackerAndNonMegaHolder', 'luxuryBombGateOk']) {
    assert.strictEqual(typeof M?.[n], 'function', n + ' 不存在（BASE？）');
  }
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】卡面逐字錨（static/cards 台灣官方；卡面改版／抓錯印刷會在這裡紅）');
const FACES = [
  ['龐克頭盔', '附有這張卡的【惡】寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，在使用招式的寶可夢身上放置4個傷害指示物。'],
  ['豪邁炸彈', '附有這張卡的寶可夢（「超級進化寶可夢【ex】」除外）在戰鬥場受到對手的「超級進化寶可夢【ex】」「240」以上的招式的傷害時，在使用招式的寶可夢身上放置12個傷害指示物。然後，將這張卡丟棄。'],
  // ⚠ 錨要涵蓋**實作真正依賴的那半句**（審查 Y2）：
  //   訂製背心的「（「超級進化寶可夢【ex】除外」）」＝ isMegaExCard(holderCard) 的依據。
  ['訂製背心', '附有這張卡的寶可夢（「超級進化寶可夢【ex】除外」）受到對手的「超級進化寶可夢【ex】」招式的傷害「-60」點。'],
  ['渾厚鱗片', '附有這張卡的【龍】寶可夢，受到對手的【草】【火】【水】【雷】寶可夢招式的傷害「-50」點。'],
  // ⚠ 重試徽章的「在每個自己的回合時，可使用1次」＝ retryBadgeUsedThisTurn 的依據（審查 Y2）。
  ['重試徽章', '在每個自己的回合時，可使用1次，自己因附有這張卡的【無】寶可夢的招式而擲硬幣時'],
  ['硬岩【鬥】能量', '附有這張卡的【鬥】寶可夢不會受到對手的寶可夢使用招式的效果的影響。'],
  ['燃料【火】能量', '若因附有這張卡的【火】寶可夢使用的招式的效果使這張卡被丟棄'],
  ['泡沫【水】能量', '附有這張卡的【水】寶可夢不會陷入特殊狀態'],
  ['磁鐵【鋼】能量', '附有這張卡的【鋼】寶可夢【撤退】所需的能量全部消除。'],
  ['伏特【雷】能量', '附有這張卡的【雷】寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+20」點。'],
  ['暗影【惡】能量', '只要附有這張卡的【惡】寶可夢在備戰區，不會受到對手的招式的傷害。'],
];
T('A1 ⭐⭐ 11 張卡的卡面逐字都對得上（每一張都必須在 H/I/J live 找得到）', () => {
  for (const [name, face] of FACES) {
    const hits = cardsNamed(name);
    assert.ok(hits.length > 0, name + ' 在 H/I/J live 找不到');
    for (const c of hits) {
      assert.ok(String(c.rulesText ?? '').includes(face),
        name + '(#' + c.id + ') 卡面對不上：' + JSON.stringify(String(c.rulesText ?? '').slice(0, 90)));
    }
  }
});
T('A1b ★ 正對照：逐字比對真的抓得到不符（不是恆真）', () => {
  assert.ok(!String(cardsNamed('龐克頭盔')[0].rulesText ?? '').includes('放置5個傷害指示物'));
});
T('A2 ⭐ 三張「會改變有效屬性」的卡，印刷屬性逐字釘住（本版零行為變化的前提）', () => {
  const want = { 狠辣椒ex: 'Fire', 小碎鑽: 'Fighting', 鐵轍跡: 'Metal' };
  for (const [n, ty] of Object.entries(want)) {
    const hits = cardsNamed(n);
    assert.ok(hits.length > 0, n + ' 不在 H/I/J live');
    for (const c of hits) assert.strictEqual(c.pokemonType, ty, n + ' 印刷屬性變了（' + c.pokemonType + '）⇒ 本版的零差異結論要重新評估');
  }
  assert.strictEqual(cardsNamed('驅勁能量 未來').length, 0,
    '「驅勁能量 未來」進了 H/I/J ⇒ 鐵轍跡｜二重核心變成可達，硬岩【鬥】等判定的差異要重新評估');
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】中央述詞單元測（直呼，不經上游 gate ⇒ 安慰劑型態 3 的解藥）');
const PUNK = idByName('龐克頭盔');
const DARK = (() => { for (const [id, c] of pool) if (HIJ(c) && c.supertype === 'Pokemon' && c.pokemonType === 'Darkness' && !(c.abilities ?? []).length) return id; return null; })();
const NONDARK = (() => { for (const [id, c] of pool) if (HIJ(c) && c.supertype === 'Pokemon' && c.pokemonType === 'Fire' && !(c.abilities ?? []).length) return id; return null; })();
const JAM = (() => { for (const [id, c] of pool) if (HIJ(c) && c.name === '阻礙之塔') return id; return null; })();

T('B0 ★ fixture 成立（龐克頭盔／【惡】無特性／【火】無特性 都抓得到）', () => {
  assert.ok(PUNK && DARK && NONDARK, [PUNK, DARK, NONDARK].join(','));
});
T('B1 ⭐⭐⭐ 龐克頭盔：【惡】holder ＋ 實際受傷 ⇒ 40', () => {
  const h = inst(DARK, [], { toolAttached: inst(PUNK) });
  const st = mkState(inst(NONDARK), h);
  assert.strictEqual(punkHelmetReflectDamageFor(st, 1, h, pool, { toolsJammed: false, damageDealt: 30 }), 40);
});
T('B2 ⭐⭐ 龐克頭盔：傷害被擋到 0 ⇒ 不反擊（卡面「受到…傷害時」）', () => {
  const h = inst(DARK, [], { toolAttached: inst(PUNK) });
  const st = mkState(inst(NONDARK), h);
  assert.strictEqual(punkHelmetReflectDamageFor(st, 1, h, pool, { toolsJammed: false, damageDealt: 0 }), 0);
});
T('B3 ⭐⭐ 龐克頭盔：阻礙之塔（道具失效）⇒ 不反擊', () => {
  const h = inst(DARK, [], { toolAttached: inst(PUNK) });
  const st = mkState(inst(NONDARK), h);
  assert.strictEqual(punkHelmetReflectDamageFor(st, 1, h, pool, { toolsJammed: true, damageDealt: 30 }), 0);
});
T('B4 ⭐⭐ 龐克頭盔：holder 不是【惡】⇒ 不反擊', () => {
  const h = inst(NONDARK, [], { toolAttached: inst(PUNK) });
  const st = mkState(inst(NONDARK), h);
  assert.strictEqual(punkHelmetReflectDamageFor(st, 1, h, pool, { toolsJammed: false, damageDealt: 30 }), 0);
});
T('B5 ⭐⭐⭐〔收斂修掉的漏洞〕龐克頭盔在 extraTools（多重轉接第 2 張）也必須算', () => {
  const h = inst(DARK, [], { toolAttached: undefined, extraTools: [inst(PUNK)] });
  const st = mkState(inst(NONDARK), h);
  assert.strictEqual(punkHelmetReflectDamageFor(st, 1, h, pool, { toolsJammed: false, damageDealt: 30 }), 40,
    '只看 toolAttached 的舊寫法會在這裡回 0（v5.835 通則）');
});
T('B6 ⭐ 龐克頭盔：沒有那張道具 ⇒ 0（負對照，證明 B1 不是恆真）', () => {
  const h = inst(DARK);
  const st = mkState(inst(NONDARK), h);
  assert.strictEqual(punkHelmetReflectDamageFor(st, 1, h, pool, { toolsJammed: false, damageDealt: 30 }), 0);
});

const MEGA = (() => { for (const [id, c] of pool) if (HIJ(c) && c.supertype === 'Pokemon' && /^超級/.test(c.name ?? '') && /ex$/.test(c.name ?? '')) return id; return null; })();
T('B7 ★ fixture：抓得到一張「超級進化寶可夢【ex】」', () => { assert.ok(MEGA, '抓不到 Mega ex'); });
T('B8 ⭐⭐⭐ 豪邁炸彈 gate：240 觸發／239 不觸發（卡面「240」以上）', () => {
  const a = pool.get(String(MEGA)), h = pool.get(String(DARK));
  assert.strictEqual(luxuryBombGateOk(240, a, h), true);
  assert.strictEqual(luxuryBombGateOk(239, a, h), false);
  assert.strictEqual(luxuryBombGateOk(1000, a, h), true);
});
T('B9 ⭐⭐ 豪邁炸彈 gate：攻擊方不是 Mega ex ⇒ false；holder 自己是 Mega ex ⇒ false', () => {
  const a = pool.get(String(MEGA)), h = pool.get(String(DARK)), plain = pool.get(String(NONDARK));
  assert.strictEqual(luxuryBombGateOk(240, plain, h), false);
  assert.strictEqual(luxuryBombGateOk(240, a, a), false);
});
T('B10 ⭐⭐ 訂製背心與豪邁炸彈共用同一支判準（驗**具體值**）', () => {
  // ⚠ 這一條原本寫成「vest(x) > 0 === megaExAttackerAndNonMegaHolder(x)」——
  //   兩邊都走同一支函式 ⇒ 把那支函式改壞了兩邊會**一起**變，斷言恆真（安慰劑型態 12）。
  //   改成先釘死具體值（60／0／0），再附帶驗「與中央述詞同值」。
  const vest = TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD.get('訂製背心');
  assert.ok(typeof vest === 'function', '訂製背心沒有登記');
  const mega = pool.get(String(MEGA)), plain = pool.get(String(DARK));
  assert.strictEqual(vest(mega, plain), 60, '超級進化ex 打非超級進化ex ⇒ -60');
  assert.strictEqual(vest(mega, mega), 0, '卡面「超級進化寶可夢【ex】除外」⇒ 不減');
  assert.strictEqual(vest(plain, plain), 0, '攻擊方不是超級進化ex ⇒ 不減');
  assert.strictEqual(vest(mega, plain) > 0, megaExAttackerAndNonMegaHolder(mega, plain));
  assert.strictEqual(vest(mega, mega) > 0, megaExAttackerAndNonMegaHolder(mega, mega));
});

const SCALE = idByName('渾厚鱗片');
const DRAGON = (() => { for (const [id, c] of pool) if (HIJ(c) && c.supertype === 'Pokemon' && c.pokemonType === 'Dragon' && !(c.abilities ?? []).length) return id; return null; })();
T('B11 ★ fixture：渾厚鱗片與【龍】無特性寶可夢抓得到', () => { assert.ok(SCALE && DRAGON, [SCALE, DRAGON].join(',')); });
T('B12 ⭐⭐⭐ toolDefenseByTypeApplies：渾厚鱗片 holderTypes【龍】正反對照', () => {
  const defense = TOOL_DEFENSE_REDUCE_BY_TYPE.get('渾厚鱗片');
  assert.ok(defense, '渾厚鱗片沒有登記');
  const atk = inst(NONDARK);                       // 【火】攻擊方 ∈ defense.types
  const holderDragon = inst(DRAGON, [], { toolAttached: inst(SCALE) });
  const holderDark = inst(DARK, [], { toolAttached: inst(SCALE) });
  const st1 = mkState(atk, holderDragon);
  const st2 = mkState(atk, holderDark);
  assert.strictEqual(toolDefenseByTypeApplies(st1, defense, 0, atk, pool.get(String(NONDARK)), 1, holderDragon, pool.get(String(DRAGON)), pool), true);
  assert.strictEqual(toolDefenseByTypeApplies(st2, defense, 0, atk, pool.get(String(NONDARK)), 1, holderDark, pool.get(String(DARK)), pool), false,
    'holder 不是【龍】就不該減傷');
});
T('B13 ⭐⭐ toolDefenseByTypeApplies：攻擊方屬性不在清單內 ⇒ false（果實類無 holderTypes 也要驗）', () => {
  const defense = TOOL_DEFENSE_REDUCE_BY_TYPE.get('渾厚鱗片');
  const atkDark = inst(DARK);                      // 【惡】∉【草火水雷】
  const holderDragon = inst(DRAGON, [], { toolAttached: inst(SCALE) });
  const st = mkState(atkDark, holderDragon);
  assert.strictEqual(toolDefenseByTypeApplies(st, defense, 0, atkDark, pool.get(String(DARK)), 1, holderDragon, pool.get(String(DRAGON)), pool), false);
  const berry = TOOL_DEFENSE_REDUCE_BY_TYPE.get('刺耳果');   // types:['Darkness']、無 holderTypes
  assert.ok(berry && !berry.holderTypes, '刺耳果不該有 holderTypes');
  assert.strictEqual(toolDefenseByTypeApplies(st, berry, 0, atkDark, pool.get(String(DARK)), 1, holderDragon, pool.get(String(DRAGON)), pool), true,
    '沒有 holderTypes ⇒ 只看攻擊方屬性');
});

T('B14 ⭐⭐ fieldOwnerIdxOf：戰鬥場／備戰／兩邊／不在場上', () => {
  const a = inst(DARK), b = inst(NONDARK), bench = inst(DARK);
  const st = mkState(a, b, { bench1: [bench] });
  assert.strictEqual(fieldOwnerIdxOf(st, a), 0);
  assert.strictEqual(fieldOwnerIdxOf(st, b), 1);
  assert.strictEqual(fieldOwnerIdxOf(st, bench), 1, '備戰也要找得到');
  assert.strictEqual(fieldOwnerIdxOf(st, inst(DARK)), undefined, '不在場上要回 undefined（下游退回印刷屬性）');
  assert.strictEqual(fieldOwnerIdxOf(undefined, a), undefined);
});
T('B15 ⭐⭐⭐ fieldPokemonHasType：印刷屬性 ＋ ownerIdx 省略時自動推導', () => {
  const a = inst(DARK);
  const st = mkState(a, inst(NONDARK));
  assert.strictEqual(fieldPokemonHasType(st, 0, a, pool, 'Darkness'), true);
  assert.strictEqual(fieldPokemonHasType(st, undefined, a, pool, 'Darkness'), true, 'ownerIdx 省略要自己推');
  assert.strictEqual(fieldPokemonHasType(st, 0, a, pool, 'Fire'), false);
  assert.strictEqual(fieldPokemonHasType(st, 0, null, pool, 'Darkness'), false);
});
const PEBBLE = idByName('小碎鑽');
T('B16 ⭐⭐⭐ fieldPokemonHasType 真的問「有效」屬性：小碎鑽（印刷【鬥】）在場上同時是【超】', () => {
  assert.ok(PEBBLE, '小碎鑽不在 H/I/J live');
  const p = inst(PEBBLE);
  const st = mkState(p, inst(NONDARK));
  assert.strictEqual(fieldPokemonHasType(st, 0, p, pool, 'Fighting'), true, '印刷屬性不得弄丟');
  assert.strictEqual(fieldPokemonHasType(st, 0, p, pool, 'Psychic'), true, '雙重屬性沒有生效 ⇒ 接的是印刷屬性（假收斂）');
});
T('B17 ⭐⭐ specialEnergyHolderCtx：effectiveTypes 與中央述詞同值（不是第二份實作）', () => {
  const p = inst(PEBBLE);
  const st = mkState(p, inst(NONDARK));
  const ctx = specialEnergyHolderCtx(st, 0, p, pool);
  assert.deepStrictEqual(ctx.effectiveTypes, getEffectivePokemonTypes(st, 0, p, pool.get(String(PEBBLE)), pool));
  assert.strictEqual(ctx.ownerIdx, 0);
  const ctx2 = specialEnergyHolderCtx(st, undefined, p, pool);
  assert.strictEqual(ctx2.ownerIdx, 0, 'ownerIdx 省略要走 fieldOwnerIdxOf');
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】holder 型特殊能量：hook 一律吃 ctx.effectiveTypes（行為端）');
const MAGNET = idByName('磁鐵【鋼】能量');
const BUBBLE = idByName('泡沫【水】能量');
const METALP = (() => { for (const [id, c] of pool) if (HIJ(c) && c.supertype === 'Pokemon' && c.pokemonType === 'Metal' && !(c.abilities ?? []).length && (c.retreatCost?.length ?? 0) > 0) return id; return null; })();
const WATERP = (() => { for (const [id, c] of pool) if (HIJ(c) && c.supertype === 'Pokemon' && c.pokemonType === 'Water' && !(c.abilities ?? []).length) return id; return null; })();
T('C0 ★ fixture：磁鐵【鋼】／泡沫【水】／【鋼】（撤退費>0）／【水】 都抓得到', () => {
  assert.ok(MAGNET && BUBBLE && METALP && WATERP, [MAGNET, BUBBLE, METALP, WATERP].join(','));
});
T('C1 ⭐⭐⭐ 磁鐵【鋼】能量：hook 簽名吃 ctx（【鋼】holder ⇒ zero，非【鋼】⇒ 不動）', () => {
  const fn = SPECIAL_ENERGY_RETREAT_MOD.get('磁鐵【鋼】能量');
  assert.ok(typeof fn === 'function', '磁鐵【鋼】能量沒有登記');
  const metal = inst(METALP, [inst(MAGNET)]);
  const water = inst(WATERP, [inst(MAGNET)]);
  const st = mkState(metal, water);
  assert.strictEqual(fn(pool.get(String(METALP)), metal, specialEnergyHolderCtx(st, 0, metal, pool)).zero, true);
  assert.notStrictEqual(fn(pool.get(String(WATERP)), water, specialEnergyHolderCtx(st, 1, water, pool)).zero, true);
});
T('C2 ⭐⭐⭐ 泡沫【水】能量：hook 簽名吃 ctx（【水】holder ⇒ 五種狀態全免疫）', () => {
  const fn = SPECIAL_ENERGY_STATUS_IMMUNE.get('泡沫【水】能量');
  assert.ok(typeof fn === 'function', '泡沫【水】能量沒有登記');
  const water = inst(WATERP, [inst(BUBBLE)]);
  const metal = inst(METALP, [inst(BUBBLE)]);
  const st = mkState(water, metal);
  const s1 = fn(pool.get(String(WATERP)), specialEnergyHolderCtx(st, 0, water, pool));
  assert.strictEqual(s1.size, 5, '【水】holder 應五種狀態全免疫，得到 ' + s1.size);
  const s2 = fn(pool.get(String(METALP)), specialEnergyHolderCtx(st, 1, metal, pool));
  assert.strictEqual(s2.size, 0, '非【水】holder 不該免疫');
});
T('C3 ⭐⭐ checkSpecialEnergyStatusImmune 走得通（state 成為必填之後，行為不變）', () => {
  const water = inst(WATERP, [inst(BUBBLE)]);
  const metal = inst(METALP, [inst(BUBBLE)]);
  const st = mkState(water, metal);
  assert.strictEqual(checkSpecialEnergyStatusImmune(water, 'asleep', pool, st).immune, true);
  assert.strictEqual(checkSpecialEnergyStatusImmune(metal, 'asleep', pool, st).immune, false);
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B-E2E】⭐⭐⭐ 端到端：走 applyAction 全流程（不是直呼述詞）');
// ⚠ 審查 Y3：【B】【C】【E】全部是直呼中央述詞 —— 只證明「述詞對」，沒證明
//   「主管線真的走它」。這一組用完整 ATTACK 把兩件事一起驗。
const ZH2EN = { 草: 'Grass', 火: 'Fire', 水: 'Water', 雷: 'Lightning', 超: 'Psychic', 鬥: 'Fighting', 惡: 'Darkness', 鋼: 'Metal', 龍: 'Dragon', 無: 'Colorless' };
const energyByType = new Map();
for (const [id, c] of pool) {
  if (!HIJ(c) || c.supertype !== 'Energy' || c.subtype !== 'Basic') continue;
  const m = String(c.name ?? '').match(/【(.+?)】/);
  const t = m ? ZH2EN[m[1]] : null;
  if (t && !energyByType.has(t)) energyByType.set(t, id);
}
const ANY_ENERGY = [...energyByType.values()][0];
const energyIdFor = (t) => energyByType.get(t) ?? ANY_ENERGY;
/** 找一張「招式傷害是純數字、沒有 effect、沒有特性、HP 夠高」的乾淨攻擊方。 */
const ATTACKER = (() => {
  for (const [id, c] of pool) {
    if (!HIJ(c) || c.supertype !== 'Pokemon' || (c.hp ?? 0) < 200) continue;
    if ((c.abilities ?? []).length) continue;
    const ai = (c.attacks ?? []).findIndex((a) =>
      /^[0-9]+$/.test(String(a.damage ?? '')) && Number(a.damage) >= 10
      && !String(a.effect ?? '').trim() && (a.cost ?? []).length > 0 && (a.cost ?? []).length <= 3);
    if (ai >= 0) return { id, ai, cost: c.attacks[ai].cost ?? [], type: c.pokemonType, name: c.name };
  }
  return null;
})();
/** 找一張「屬性對攻擊方中立、HP 夠高、沒有特性」的靶。 */
const pickCleanTarget = (wantType, atkType) => {
  for (const [id, c] of pool) {
    if (!HIJ(c) || c.supertype !== 'Pokemon') continue;
    if (c.pokemonType !== wantType) continue;
    if ((c.hp ?? 0) < 250) continue;
    if ((c.abilities ?? []).length) continue;
    if (c.weakness?.type === atkType || c.resistance?.type === atkType) continue;
    return id;
  }
  return null;
};
function battle(defenderId, opts = {}) {
  const ac = pool.get(String(ATTACKER.id));
  const me = inst(ATTACKER.id, ATTACKER.cost.map((t) => inst(energyIdFor(t))));
  const tool = opts.noTool ? {} : { toolAttached: inst(idByName('龐克頭盔')) };
  const foe = inst(defenderId, [], tool);
  const s0 = createGame({ name: ('P1'), entries: [{ cardId: String(defenderId), count: 1 }] },
                        { name: ('P2'), entries: [{ cardId: String(defenderId), count: 1 }] }, pool);
  const st = { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null,
    activeStadium: opts.stadiumId ? inst(opts.stadiumId) : null,
    players: [
      { ...s0.players[0], hand: [], deck: [inst(defenderId)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(defenderId)), active: me, bench: [] },
      { ...s0.players[1], hand: [], deck: [inst(defenderId)], discard: [],
        prizes: Array.from({ length: 6 }, () => inst(defenderId)), active: foe, bench: [] }] };
  const after = applyAction(st, { type: 'ATTACK', attackIndex: ATTACKER.ai }, pool);
  assert.ok(after && after !== st, ac.name + ' 的招式沒有被引擎接受（cost／前提不成立）');
  assert.ok(after.players[1].active, '靶被秒殺了（換血更厚的）');
  return { atkDamage: after.players[0].active?.damage ?? -1, defDamage: after.players[1].active?.damage ?? -1,
    logs: (after.log ?? []).map((l) => String(l?.message ?? l)) };
}
T('E2E0 ★ fixture：抓得到乾淨的攻擊方與【惡】／非【惡】兩個靶', () => {
  assert.ok(ATTACKER, '找不到「純數字傷害＋無 effect＋無特性」的攻擊方');
  assert.ok(pickCleanTarget('Darkness', ATTACKER.type), '找不到【惡】靶');
  assert.ok(pickCleanTarget('Water', ATTACKER.type) || pickCleanTarget('Grass', ATTACKER.type), '找不到非【惡】靶');
  assert.ok(idByName('龐克頭盔'), '龐克頭盔不在 H/I/J live');
});
T('E2E1 ⭐⭐⭐ 全流程 ATTACK：【惡】holder 附龐克頭盔 ⇒ 攻擊方被反擊 40', () => {
  const d = pickCleanTarget('Darkness', ATTACKER.type);
  const r = battle(d);
  assert.ok(r.defDamage > 0, '靶沒有實際受傷 ⇒ 前置條件不成立，下面的斷言沒有意義');
  assert.strictEqual(r.atkDamage, 40, '攻擊方應被放 4 個傷害指示物（40）');
  assert.ok(r.logs.some((l) => l.includes('龐克頭盔')), 'log 沒有龐克頭盔那一行');
});
T('E2E2 ⭐⭐⭐ 反對照：holder 不是【惡】⇒ 不反擊（證明 E2E1 不是恆真）', () => {
  const d = pickCleanTarget('Water', ATTACKER.type) ?? pickCleanTarget('Grass', ATTACKER.type);
  const r = battle(d);
  assert.ok(r.defDamage > 0, '靶沒有實際受傷 ⇒ 前置條件不成立');
  assert.strictEqual(r.atkDamage, 0, '非【惡】holder 不該反擊');
});
T('E2E3 ⭐⭐ 反對照：沒有附龐克頭盔 ⇒ 不反擊', () => {
  const d = pickCleanTarget('Darkness', ATTACKER.type);
  const r = battle(d, { noTool: true });
  assert.strictEqual(r.atkDamage, 0, '沒有那張道具就不該反擊');
});
T('E2E4 ⭐⭐ 反對照：阻礙之塔（道具失效）⇒ 不反擊', () => {
  const jam = idByName('阻礙之塔');
  if (!jam) { assert.ok(true, '阻礙之塔不在 H/I/J live ⇒ 略過（不是假綠：B3 已用單元測驗過同一個 gate）'); return; }
  const d = pickCleanTarget('Darkness', ATTACKER.type);
  const r = battle(d, { stadiumId: jam });
  assert.ok(r.defDamage > 0, '靶沒有實際受傷 ⇒ 前置條件不成立');
  assert.strictEqual(r.atkDamage, 0, '阻礙之塔下道具失效，不該反擊');
});
console.log('\n【D】收斂層（靜態；否定型一律配正對照，先剝註解）');
const src = (rel) => normEol(readFileSync(join(ROOT, rel), 'utf8'));
const strip = (s, tag) => { try { return stripCommentsBlankChecked(s, tag); } catch { return s; } };
const ENGINE = strip(src('src/lib/game/engine.ts'), 'engine.ts');
const EFFECTS = strip(src('src/lib/game/effects.ts'), 'effects.ts');
const TOOLS = strip(src('src/lib/game/effects/cards/tools.ts'), 'tools.ts');
const ENERGY = strip(src('src/lib/game/effects/cards/energy_cards.ts'), 'energy_cards.ts');
const DEFENSE = strip(src('src/lib/game/defense.ts'), 'defense.ts');
const SELFILTER = strip(src('src/lib/game/selection-filter.ts'), 'selection-filter.ts');
const count = (h, n) => h.split(n).length - 1;

T('D0 ★ 剝註解真的有作用（不然下面每一條否定斷言都可能被註解餵成假訊號）', () => {
  // ⚠ stripCommentsBlankChecked 是「把註解換成等長空白」⇒ **長度不變**才是正常的；
  //   要驗的是「註解的字不見了、程式碼的字還在」。
  assert.strictEqual(ENGINE.length, src('src/lib/game/engine.ts').length, 'blank-checked 剝除器應保持長度');
  assert.ok(!ENGINE.includes('龐克頭盔反射'), 'engine 的註解沒被剝掉');
  assert.ok(!EFFECTS.includes('龐克頭盔反射（戰鬥場'), 'effects 的註解沒被剝掉');
  assert.ok(ENGINE.includes('punkHelmetReflectDamageFor('), '剝除器把真碼也砍掉了');
});
T('D1 ⭐⭐⭐ 龐克頭盔判準只有一份：定義 1 處、呼叫恰 2 處，且沒有人再自己比對卡名', () => {
  assert.strictEqual(count(EFFECTS, 'export function punkHelmetReflectDamageFor('), 1, '中央述詞定義不是 1 份');
  const calls = count(ENGINE, 'punkHelmetReflectDamageFor(') + count(EFFECTS, 'punkHelmetReflectDamageFor(');
  assert.strictEqual(calls, 3, '定義 1 ＋ 呼叫 2 ＝ 3 個字面，實得 ' + calls);
  // 除了中央述詞內那一行，全站不得再出現「name === '龐克頭盔'」型的 gate
  const bad = [];
  for (const [tag, s] of [['engine.ts', ENGINE], ['effects.ts', EFFECTS], ['tools.ts', TOOLS], ['defense.ts', DEFENSE]]) {
    for (const line of s.split('\n')) {
      if (!line.includes('龐克頭盔')) continue;
      if (line.includes('addLog') || line.includes('🔧')) continue;          // log 文字
      if (line.includes("?.name === '龐克頭盔')) return 0;")) continue;       // 中央述詞自己
      if (/name === '龐克頭盔'/.test(line)) bad.push(tag + ' :: ' + line.trim());
    }
  }
  assert.deepStrictEqual(bad, [], '還有第二份龐克頭盔判準：\n      ' + bad.join('\n      '));
});
T('D1b ★ 正對照：上面那個掃描器抓得到「第二份判準」的樣本', () => {
  const sample = "    if (t?.name === '龐克頭盔' && c?.pokemonType === 'Darkness') { x = 40; }";
  assert.ok(/name === '龐克頭盔'/.test(sample) && !sample.includes('addLog'));
});
T('D2 ⭐⭐⭐ 「超級進化ex 打非超級進化ex」判準只有一份（三個呼叫端都走中央）', () => {
  // ⚠ 判準放在 leaf（selection-filter.ts）而不是 tools.ts：effects→tools 是既有反向 edge，
  //   往那裡新增 symbol 會被 anti-pattern-lint [O] 擋下（module-init 循環 TDZ）。
  assert.strictEqual(count(SELFILTER, 'export function megaExAttackerAndNonMegaHolder('), 1, '中央述詞定義不是 1 份');
  assert.strictEqual(count(SELFILTER, 'export function luxuryBombGateOk('), 1);
  assert.strictEqual(count(SELFILTER, 'export const LUXURY_BOMB_DAMAGE_THRESHOLD = 240;'), 1, '240 門檻要有具名常數');
  assert.strictEqual(count(TOOLS, 'isMegaExCard('), 0,
    'tools.ts 還自己判 Mega ex（' + count(TOOLS, 'isMegaExCard(') + ' 處）⇒ 判準又變成兩份');
  assert.ok(count(TOOLS, 'megaExAttackerAndNonMegaHolder(') >= 1, '訂製背心沒有走中央述詞');
  assert.ok(count(TOOLS, 'luxuryBombGateOk(') >= 1, '豪邁炸彈沒有走中央 gate');
  assert.strictEqual(count(ENGINE, 'luxuryBombGateOk('), 1, 'engine 的 KO 路徑要走中央 gate');
  assert.strictEqual(count(ENGINE, 'isMegaExCard(lbAtkCard'), 0, 'engine 還留著自己的那一份 Mega ex 判準');
  assert.strictEqual(count(TOOLS, 'baseDamage < 240'), 0, '240 門檻不得再散寫（已收進 LUXURY_BOMB_DAMAGE_THRESHOLD）');
});
T('D2b ★ 正對照：SELFILTER 真的讀得到（不是空字串讓上面每一條恆假）', () => {
  assert.ok(SELFILTER.length > 5000, 'selection-filter.ts 只讀到 ' + SELFILTER.length + ' 字元');
  assert.ok(count(SELFILTER, 'isMegaExCard(') >= 3, 'isMegaExCard 定義 1 ＋ 中央述詞 2 = 至少 3 次');
});
T('D3 ⭐⭐⭐ TOOL_DEFENSE_REDUCE_BY_TYPE 判準只有一份（engine／effects 各呼叫 1 次）', () => {
  assert.strictEqual(count(EFFECTS, 'export function toolDefenseByTypeApplies('), 1);
  assert.strictEqual(count(ENGINE, 'toolDefenseByTypeApplies('), 1);
  assert.strictEqual(count(EFFECTS, 'toolDefenseByTypeApplies('), 2, '定義 1 ＋ 呼叫 1');
  assert.strictEqual(count(ENGINE, '_holderTypes'), 0, 'engine 還留著自己那一份 holderTypes 展開');
  assert.strictEqual(count(EFFECTS, '_holderTypes'), 0, 'effects 還留著自己那一份 holderTypes 展開');
});
T('D4 ⭐⭐⭐ 「inst 在誰的場上／哪個位置」只有一份（engine 兩處 inline 推導都收掉）', () => {
  assert.strictEqual(count(EFFECTS, 'export function fieldSlotOf('), 1, '中央述詞定義不是 1 份');
  assert.strictEqual(count(EFFECTS, 'export function fieldOwnerIdxOf('), 1);
  assert.ok(/return fieldSlotOf\(state, inst\)\?\.ownerIdx;/.test(EFFECTS),
    'fieldOwnerIdxOf 沒有委派 fieldSlotOf ⇒ 又變成兩份迴圈');
  assert.ok(count(ENGINE, 'fieldOwnerIdxOf(') >= 1, 'engine 沒有改走中央推導');
  assert.ok(count(ENGINE, 'fieldSlotOf(') >= 1, 'engine 的 hpAbilityEffective 沒有改走中央推導');
  assert.strictEqual(count(ENGINE, "for (let k = 0 as 0 | 1; k <= 1; k = (k + 1) as 0 | 1) {"), 0,
    'engine 還留著 inline 的 owner 推導迴圈');
  // ⚠ 審查 R2：**寫成 if/else 的第三份**會躲掉上面那個字面 ⇒ 改掃「語義」：
  //   engine 裡任何「.bench.some(b => b.iid === …)」都是在自己推 owner。
  assert.strictEqual(count(ENGINE, '.bench.some(b => b.iid === inst.iid)'), 0,
    'engine 還有自己推 owner 的 if/else 版（審查 R2 抓到的第三份）');
});
T('D4c ★ 正對照：D4 的兩條否定斷言都抓得到樣本（不是恆真）', () => {
  const sample1 = "  for (let k = 0 as 0 | 1; k <= 1; k = (k + 1) as 0 | 1) {";
  const sample2 = "  if (state.players[0].active?.iid === inst.iid || state.players[0].bench.some(b => b.iid === inst.iid)) {";
  assert.strictEqual(count(sample1, "for (let k = 0 as 0 | 1; k <= 1; k = (k + 1) as 0 | 1) {"), 1);
  assert.strictEqual(count(sample2, '.bench.some(b => b.iid === inst.iid)'), 1);
});
T('D4b ⭐⭐ fieldSlotOf 的 loc 真的分得出戰鬥場／備戰（不是只回 ownerIdx 的空殼）', () => {
  const a = inst(DARK), b = inst(NONDARK), bench = inst(DARK);
  const st = mkState(a, b, { bench1: [bench] });
  const f = (typeof M?.fieldSlotOf === 'function') ? M.fieldSlotOf : () => MISSING;
  assert.deepStrictEqual(f(st, a), { ownerIdx: 0, loc: 'active' });
  assert.deepStrictEqual(f(st, bench), { ownerIdx: 1, loc: 'bench' });
  assert.strictEqual(f(st, inst(DARK)), null);
});
T('D5 ⭐⭐⭐ holder 型特殊能量的 hook 不得再直讀印刷屬性', () => {
  assert.strictEqual(count(ENERGY, 'holder.pokemonType'), 0, 'energy_cards.ts 還在讀印刷屬性');
  assert.ok(count(ENERGY, 'ctx.effectiveTypes') >= 3, 'energy_cards.ts 走 ctx.effectiveTypes 的地方少於 3 處');
});
T('D5b ★ 正對照：D5 的掃描器抓得到印刷屬性讀取（不是恆真）', () => {
  assert.ok(count("if (holder.pokemonType === 'Metal') return { zero: true };", 'holder.pokemonType') === 1);
});
T('D6 ⭐⭐ 本版接上中央述詞的 6 個 holder 判定，engine／defense 不得留印刷屬性寫法', () => {
  const FORBID = [
    ['engine.ts', ENGINE, "attackerCard.pokemonType === 'Lightning'"],
    ['engine.ts', ENGINE, "attackerCard?.pokemonType === 'Fire'"],
    ['engine.ts', ENGINE, "_rbCard?.pokemonType !== 'Colorless'"],
    ['engine.ts', ENGINE, "atkCard?.pokemonType === 'Colorless'"],
    ['defense.ts', DEFENSE, "targetCard?.pokemonType === 'Darkness'"],
    ['effects.ts', EFFECTS, "aCard.pokemonType === 'Lightning'"],
    ['effects.ts', EFFECTS, "targetCard?.pokemonType !== rule.requireType"],
  ];
  const bad = FORBID.filter(([, s, pat]) => s.includes(pat)).map(([t, , pat]) => t + ' :: ' + pat);
  assert.deepStrictEqual(bad, [], '這幾處還在讀印刷屬性：\n      ' + bad.join('\n      '));
});
T('D7 ⭐⭐ 六處都真的改走中央 fieldPokemonHasType（否定斷言配正向斷言）', () => {
  assert.ok(count(ENGINE, 'fieldPokemonHasType(') >= 4, 'engine 只有 ' + count(ENGINE, 'fieldPokemonHasType(') + ' 處走中央（預期 ≥4）');
  assert.ok(count(EFFECTS, 'fieldPokemonHasType(') >= 3, 'effects 只有 ' + count(EFFECTS, 'fieldPokemonHasType(') + ' 處（含定義）');
  assert.strictEqual(count(DEFENSE, 'fieldPokemonHasType('), 1, 'defense.ts 的暗影【惡】能量沒有走中央');
});
T('D8 ⭐ 每個改過的檔都真的 import 了中央述詞（漏 import ＝ runtime 炸彈）', () => {
  assert.ok(/import[\s\S]{0,4000}fieldPokemonHasType[\s\S]{0,4000}from '\.\/effects'/.test(src('src/lib/game/defense.ts')),
    'defense.ts 沒 import fieldPokemonHasType');
  assert.ok(/punkHelmetReflectDamageFor/.test(src('src/lib/game/engine.ts').slice(0, 6000)),
    'engine.ts 的 import 區沒有 punkHelmetReflectDamageFor');
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【E】⭐⭐ 零回歸差分：本版接上的每一個屬性條件，全卡池逐一比對「印刷 vs 有效」');
T('E1 ⭐⭐⭐ 全卡池「有效屬性 ⊇ 印刷屬性」（本輪替換都是純新增，不得弄丟本色）', () => {
  let n = 0;
  for (const [id, c] of pool) {
    if (!HIJ(c) || c.supertype !== 'Pokemon' || !c.pokemonType) continue;
    const i0 = inst(id);
    const st = mkState(i0, inst(FILLER));
    assert.ok(fieldPokemonHasType(st, 0, i0, pool, c.pokemonType), c.name + ' 弄丟了印刷屬性');
    n++;
  }
  assert.ok(n > 2000, '只掃到 ' + n + ' 張 ⇒ 掃描器壞了');
});
/** 場上化石（Trainer/Item，rulesText 明寫「可作為…寶可夢放置於場上」）—— 有效屬性是【無】。 */
const FOSSIL_IDS = [...pool.entries()]
  .filter(([, c]) => HIJ(c) && c.supertype === 'Trainer' && /可作為.{0,20}寶可夢.{0,6}放置於場上/.test(String(c.rulesText ?? '')))
  .map(([id]) => id);
T('E1b ★ fixture：抓得到場上化石（審查 R1：E2 第一版把它們整類漏掉了）', () => {
  assert.ok(FOSSIL_IDS.length >= 8, '只抓到 ' + FOSSIL_IDS.length + ' 張化石 ⇒ 掃描器壞了');
});
T('E2 ⭐⭐⭐ 本版 8 個屬性條件的差分：全卡池（**含化石**）逐一，差異只准落在明列清單內', () => {
  // ⚠⚠ 審查 R1：這一條的第一版寫 `c.supertype !== 'Pokemon' continue`，
  //   而化石是 Trainer ⇒ **唯一真的會差的那一類被排除在輸入集之外**，【無】那一格永遠 0 差異
  //   ＝ 空真（安慰劑型態 4）。現在化石一律納入，並把它們的差異**明列**出來。
  const COND = ['Darkness', 'Dragon', 'Fighting', 'Lightning', 'Fire', 'Water', 'Metal', 'Colorless'];
  const diffs = [];
  let n = 0;
  const targets = [];
  for (const [id, c] of pool) {
    if (!HIJ(c)) continue;
    if (c.supertype === 'Pokemon') targets.push([id, c, false]);
    else if (FOSSIL_IDS.includes(id)) targets.push([id, c, true]);
  }
  for (const [id, c, isFossil] of targets) {
    const i0 = isFossil ? inst(id, [], { fossilOnField: true }) : inst(id);
    const st = mkState(i0, inst(FILLER));
    for (const ty of COND) {
      const printed = c.pokemonType === ty;
      const eff = fieldPokemonHasType(st, 0, i0, pool, ty);
      if (printed !== eff) diffs.push(c.name + '#' + id + ' ' + ty + ' ' + printed + '→' + eff);
      n++;
    }
  }
  assert.ok(n > 20000, '只比了 ' + n + ' 格 ⇒ 掃描器壞了');
  assert.ok(targets.some(([, , f]) => f), '輸入集裡一張化石都沒有 ⇒ 又回到 R1 的空真');
  // ⭐ 唯一合法的差異：**每一張場上化石**在【無】那一格 false→true（v6.208 站長裁定）。
  //   小碎鑽（印刷【鬥】⇒ 多【超】）與 狠辣椒ex（印刷【火】⇒ 多【草】）多出來的屬性
  //   都不在本版 8 個條件內 ⇒ 不該出現在這裡。
  const want = FOSSIL_IDS.map((id) => pool.get(id).name + '#' + id + ' Colorless false→true').sort();
  assert.deepStrictEqual(diffs.slice().sort(), want,
    '差異清單與「每張場上化石各一筆【無】」對不上（本版的零行為變化結論要重新評估）：\n      '
    + diffs.join('\n      '));
});
T('E2c ⭐⭐⭐〔化石 × 重試徽章〕不可達性釘住：化石沒有招式，也沒有「擲幣＋自身換位」的招式', () => {
  // 本版把重試徽章的 holder 判定從印刷屬性改成有效屬性 ⇒ 化石從 false 變 true。
  // 它之所以仍是零行為變化，靠的是兩個**卡池事實**；卡池一變就要在這裡翻紅重新評估。
  for (const id of FOSSIL_IDS) {
    const c = pool.get(id);
    assert.strictEqual((c.attacks ?? []).length, 0, c.name + '#' + id + ' 竟然有招式 ⇒ 化石可以擲硬幣了');
  }
  // 另一條路：同一個招式既擲硬幣、又把自己換下場（換上來的化石若附著重試徽章就會被讀到）。
  let risky = 0;
  for (const [, c] of pool) {
    if (!HIJ(c)) continue;
    for (const a of (c.attacks ?? [])) {
      const e = String(a.effect ?? '');
      if (!/擲.{0,4}硬幣|擲出/.test(e)) continue;
      if (!/與備戰寶可夢互換|這隻寶可夢.{0,8}回到備戰|備戰寶可夢互換/.test(e)) continue;
      risky++;
    }
  }
  assert.strictEqual(risky, 0, '出現了「擲硬幣＋自身換位」的招式（' + risky + ' 招）⇒ 重試徽章讀「當下 active」可能讀到化石，要重新評估');
});
T('E2d ★ 正對照：E2c 的兩個掃描器都抓得到樣本（不是恆真）', () => {
  const sample = { effect: '擲1次硬幣，若為正面，這隻寶可夢與備戰寶可夢互換。' };
  assert.ok(/擲.{0,4}硬幣|擲出/.test(sample.effect) && /與備戰寶可夢互換/.test(sample.effect));
  assert.ok([...pool.values()].some((c) => (c.attacks ?? []).length > 0), 'attacks 掃描器抓不到任何有招式的卡');
});
T('E2b ★ 正對照：差分掃描器抓得到真的差異（拿【超】驗，小碎鑽必須出現）', () => {
  const p = inst(PEBBLE);
  const st = mkState(p, inst(FILLER));
  assert.strictEqual(pool.get(String(PEBBLE)).pokemonType === 'Psychic', false);
  assert.strictEqual(fieldPokemonHasType(st, 0, p, pool, 'Psychic'), true,
    '小碎鑽的【超】沒有出現 ⇒ E2 的「零差異」是假綠（接的其實是印刷屬性）');
});

console.log('\n=== v6.402 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail > 0 ? 1 : 0);
