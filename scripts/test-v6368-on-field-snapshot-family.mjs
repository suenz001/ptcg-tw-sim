// v6.368 守衛：「宣告當時」快照家族（站長裁定 六-10／六-11／六-14 ＋ 第二個 stale 洞）
//
// 本版四件事（同一個家族）：
//   (甲) 六-10「一起修」：伊裴爾塔爾｜生命制約 也改成**宣告當時**判定
//        （新增 _attackTimeLifeRestraint，比照 _attackTimeCalmGround）。
//   (乙) 六-11「依你的建議統一」：ATTACK 流程尾段那一疊 attack-time snapshot clear
//        （花之帷幔／平穩境地／抵抗之幕／球形盾牌／太古防壁 共五個）整疊移到
//        applyActionImpl 尾段 —— 那裡本來就各有一份**完全相同**的 clear。
//   (丙) 六-14：PTCG_RULES.md §16.2 補一句例外（指向 §17.46.B 既有的花之帷幔官方問答）。
//   (丁) v6.367 recon 發現的第二個 stale 洞：engine.ts 回合加傷／招致削傷兩格寫的是
//        函式開頭那個區域 players 陣列，把 ATTACK_PRE 的盤面改動反寫回 PRE 之前。
//
// 斷言分層：
//   【A】(甲) 行為端 —— 生命制約持有者被同一招打死，該招的恢復仍被擋（HEAD 綠、BASE 紅）
//        ＋ 反對照（宣告當時沒有／特性已被消除）＋ 不重複／不過度回捲 ＋ 跨 action 不殘留。
//   【B】(乙) 行為端 —— 快照語意零變更（清除時機一致）＋ 五支既有守衛全綠 ＋ 位置正確性。
//   【C】(丙) 規則書那一句的存在與逐字 ＋ 掃描器自驗（正對照）。
//   【D】(丁) 行為端 —— 合成 PRE 改防守方 ＋ 招式帶 damageBonusThisTurn／nextOwnAttackPenalty
//        ⇒ 防守方的改動不可以被反寫（HEAD 綠、BASE 紅）。
//   【E】中央性掃描（每一條都配正對照，禁止恆真）。
//   【F】HEAD-FAIL —— 對 BASE(917874bf ＝ v6.367) 重跑整個矩陣。
//
// ⚠ 合成 ATTACK_PRE／ATTACK_POST 只在本守衛的 bundle 裡註冊、try/finally 還原；
//   ⛔ 絕對不可以把測試用的東西寫進 src/。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '917874bf11c146023afcd5097a3c0978ea361e5b';   // v6.367（v6.368 的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; } else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

// ── 卡池 ──────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const NONRULE = (c) => c.subtype !== 'ex' && !/(ex|EX|V|VMAX|VSTAR)$/.test(String(c.name));

/** 伊裴爾塔爾（M6a 079/103，id 19991）— 特性【生命制約】。 */
const YVELTAL = pool.get('19991');
const YV_ABILITY = YVELTAL?.abilities?.[0];
const YV_TEXT = '只要這隻寶可夢在場上，對手的戰鬥寶可夢的HP無法恢復。';

/**
 * 攻擊方：【基礎】／無特性／無 tag／非規則寶可夢，且有一招「純數字傷害、卡面無效果文、單費」。
 * ⚠ 屬性必須**不是**伊裴爾塔爾的弱點（Lightning）也不是其抵抗力（Fighting）—— 否則傷害被弱抗打歪，
 *   「剛好打死 / 剛好打不死」的門檻就算不準。
 */
const ATK = all.find(c => c.supertype === 'Pokemon'
  && c.pokemonType && c.pokemonType !== 'Lightning' && c.pokemonType !== 'Fighting'
  && (c.stage ?? c.subtype) === 'Basic' && !(c.abilities || []).length && !(c.tags || []).length && NONRULE(c)
  && (c.attacks || []).some(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0 && !String(a.effect ?? '').trim()
    && (a.cost || []).length === 1));
const ATK_ATTACK = ATK ? ATK.attacks.find(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0
  && !String(a.effect ?? '').trim() && (a.cost || []).length === 1) : null;
const ATK_IDX = ATK && ATK_ATTACK ? ATK.attacks.findIndex(a => a.name === ATK_ATTACK.name) : -1;
const BASE_DMG = ATK_ATTACK ? Number(ATK_ATTACK.damage) : -1;
const KEY = ATK && ATK_ATTACK ? `${ATK.name}|${ATK_ATTACK.name}` : 'x|y';
/** 攻擊費用要付得起：找一張該屬性的基本能量；單費 Colorless 也吃得下。 */
const ATK_COST_TYPE = ATK_ATTACK ? String(ATK_ATTACK.cost[0]) : '';
const ENERGY_BY_TYPE = {
  Grass: '基本【草】能量', Fire: '基本【火】能量', Water: '基本【水】能量', Lightning: '基本【雷】能量',
  Psychic: '基本【超】能量', Fighting: '基本【鬥】能量', Darkness: '基本【惡】能量', Metal: '基本【鋼】能量',
  Dragon: '基本【龍】能量', Colorless: '基本【草】能量',
};
const COST_ENERGY = all.find(c => c.name === (ENERGY_BY_TYPE[ATK_COST_TYPE] ?? '基本【草】能量'));
/** 防守方備戰用的靶（讓 KO 後有得補位）。 */
const BENCH_TGT = all.find(c => c.supertype === 'Pokemon' && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 100);
/** (丁) 用的靶：HP 夠高不會被打倒。 */
const TGT = all.find(c => c.supertype === 'Pokemon' && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && Number(c.hp) >= 150
  && c.weakness?.type !== ATK?.pokemonType && c.resistance?.type !== ATK?.pokemonType);

console.log('\n【0】fixture 自驗（Rule 25：抽不到卡／卡面對不上要大聲紅，不可以靜默全綠）');
chk('0a ⭐伊裴爾塔爾（M6a 079/103，id 19991）在卡池裡，而且特性叫【生命制約】',
  !!YVELTAL && YVELTAL.name === '伊裴爾塔爾' && YV_ABILITY?.name === '生命制約',
  JSON.stringify({ n: YVELTAL?.name, no: YVELTAL?.collectorNumber, ab: YV_ABILITY?.name }));
chk('0b ⭐卡面逐字（台灣官方卡面 static/cards/M6a.json）與本版依據的文字一致',
  YV_ABILITY?.effect === YV_TEXT, JSON.stringify(YV_ABILITY?.effect));
chk('0c 伊裴爾塔爾 HP=120／【基礎】／非規則寶可夢（門檻計算的前提）',
  Number(YVELTAL?.hp) === 120 && (YVELTAL?.stage ?? YVELTAL?.subtype) === 'Basic' && NONRULE(YVELTAL ?? {}),
  JSON.stringify({ hp: YVELTAL?.hp, stage: YVELTAL?.stage }));
chk('0d 抓得到合用的攻擊方（基礎／無特性／非規則／單費純數字招式／屬性不是伊裴爾塔爾的弱抗）',
  !!ATK && !!ATK_ATTACK && ATK_IDX >= 0 && BASE_DMG > 0,
  JSON.stringify({ atk: ATK?.name, type: ATK?.pokemonType, attack: ATK_ATTACK?.name, dmg: BASE_DMG }));
chk('0e 抓得到付得起招式費用的基本能量 ＋ 備戰靶 ＋ (丁) 用的高 HP 靶',
  !!COST_ENERGY && !!BENCH_TGT && !!TGT,
  JSON.stringify({ e: COST_ENERGY?.name, b: BENCH_TGT?.name, t: TGT?.name, thp: TGT?.hp }));
chk('0f ⭐這一招打不死滿血的伊裴爾塔爾（門檻要靠預先放的傷害控制，不是靠運氣）',
  BASE_DMG > 0 && BASE_DMG < 120, String(BASE_DMG));
if (!YVELTAL || !ATK || !ATK_ATTACK || !COST_ENERGY || !BENCH_TGT || !TGT) {
  console.log('\n❌ fixture 不齊，無法繼續'); process.exit(1);
}

// ── harness ──────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6368-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/** ⚠ entry 要寫在 srcDir 的父目錄、用相對路徑 import（Windows 的 `E:/…` 會被 esbuild 當成套件名）。 */
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = `./${name}`;
  const S = join(parent, `.v6368-s-${tag}.js`), E = join(parent, `.v6368-e-${tag}.ts`), O = join(parent, `.v6368-o-${tag}.mjs`);
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    `export { ATTACK_PRE, ATTACK_POST } from '${p}/lib/game/effects/_shared';\n`
    + `export { applyAction } from '${p}/lib/game/engine';\n`
    + `import '${p}/lib/game/effects';\n`);
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
chk('0g ⭐這一招在 src/ 裡**沒有**既有的 ATTACK_PRE／ATTACK_POST（合成的不會蓋掉真卡實裝）',
  !HEAD.ATTACK_PRE.get(KEY) && !HEAD.ATTACK_POST.get(KEY), KEY);

let seq = 0;
const inst = (id, extra = {}) => ({
  cardId: String(id), iid: 'i' + (++seq), damage: 0, energyAttached: [], toolAttached: null,
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false,
  evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)], ...extra,
});
const heads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };

const ATK_ENERGY = () => [inst(COST_ENERGY.id), inst(COST_ENERGY.id), inst(COST_ENERGY.id)];

// ══════════════════════════════════════════════════════════════════════════════
// (甲) 伊裴爾塔爾｜生命制約 ——「宣告當時」快照
//   盤面：玩家 0 出招（攻擊方自己身上有 50 點傷害），玩家 1 的戰鬥位是伊裴爾塔爾。
//   合成 ATTACK_POST 在招式結算中替**攻擊方自己**恢復 30 點 ——
//   依卡面，伊裴爾塔爾的對手（＝玩家 0）的戰鬥寶可夢 HP 無法恢復 ⇒ 這 30 點必須被擋掉。
// ══════════════════════════════════════════════════════════════════════════════
const HEAL_AMOUNT = 30;
const SELF_DMG = 50;
const healSelfPost = (s, ai) => {
  const players = [...s.players];
  const act = players[ai].active;
  if (!act) return s;
  players[ai] = { ...players[ai], active: { ...act, damage: Math.max(0, (act.damage ?? 0) - HEAL_AMOUNT) } };
  return { ...s, players };
};

/**
 * @param opts.yveltal   'alive' | 'ko' | 'none' | 'nullified'
 * @param opts.seedStale 先在輸入 state 裡塞一份**上一個 action 殘留的**假快照
 */
function runHeal(MOD, opts = {}) {
  const { yveltal = 'alive', seedStale = false, heal = true } = opts;
  const origPost = MOD.ATTACK_POST.get(KEY);
  if (heal) MOD.ATTACK_POST.set(KEY, healSelfPost);
  try {
    const atkActive = inst(ATK.id, { energyAttached: ATK_ENERGY(), damage: SELF_DMG });
    let defActive;
    if (yveltal === 'none') defActive = inst(BENCH_TGT.id, { damage: 0 });
    else if (yveltal === 'ko') defActive = inst(YVELTAL.id, { damage: 120 - BASE_DMG });
    else if (yveltal === 'nullified') defActive = inst(YVELTAL.id, { damage: 0, abilityNullifiedThisTurn: true });
    else defActive = inst(YVELTAL.id, { damage: 0 });
    const extra = seedStale ? { _attackTimeLifeRestraint: { p1: true, p2: true } } : {};
    const st = mk(
      { active: atkActive, bench: [inst(ATK.id)], deck: [inst(ATK.id), inst(ATK.id)], hand: [], prizes: Array.from({ length: 6 }, () => inst(ATK.id)) },
      { active: defActive, bench: [inst(BENCH_TGT.id)], deck: [inst(BENCH_TGT.id), inst(BENCH_TGT.id)], prizes: Array.from({ length: 6 }, () => inst(BENCH_TGT.id)) },
      extra);
    return heads(() => {
      try { return MOD.applyAction(st, { type: 'ATTACK', attackIndex: ATK_IDX }, pool); }
      catch (e) { return { __err: String(e && e.message ? e.message : e), players: st.players, log: [] }; }
    });
  } finally { if (origPost) MOD.ATTACK_POST.set(KEY, origPost); else MOD.ATTACK_POST.delete(KEY); }
}
const atkDmgOf = (r) => (r && r.players && r.players[0] && r.players[0].active ? r.players[0].active.damage : -999);
const atkHealedFlag = (r) => (r && r.players && r.players[0] && r.players[0].active ? !!r.players[0].active.healedThisTurn : null);

// ══════════════════════════════════════════════════════════════════════════════
// (丁) 合成 ATTACK_PRE 改**防守方**（＋招式帶 damageBonusThisTurn／nextOwnAttackPenalty）
// ══════════════════════════════════════════════════════════════════════════════
const PRE_DEF_DMG = 30;
const preTouchDefender = (s, ai) => {
  const di = 1 - ai; const players = [...s.players];
  players[di] = {
    ...players[di],
    active: { ...players[di].active, damage: (players[di].active.damage ?? 0) + PRE_DEF_DMG },
    discard: [...players[di].discard, inst(TGT.id)],
  };
  return { ...s, players };
};
function runPre(MOD, mutate, atkActiveExtra = {}) {
  const orig = MOD.ATTACK_PRE.get(KEY);
  MOD.ATTACK_PRE.set(KEY, (s, ai) => ({ state: mutate ? mutate(s, ai) : s, damage: BASE_DMG }));
  try {
    const a = inst(ATK.id, { energyAttached: ATK_ENERGY(), ...atkActiveExtra });
    const st = mk(
      { active: a, bench: [inst(ATK.id)], deck: [inst(ATK.id), inst(ATK.id)], hand: [], prizes: Array.from({ length: 6 }, () => inst(ATK.id)) },
      { active: inst(TGT.id), bench: [inst(TGT.id)], deck: [inst(TGT.id), inst(TGT.id)], prizes: Array.from({ length: 6 }, () => inst(TGT.id)) });
    return heads(() => {
      try { return MOD.applyAction(st, { type: 'ATTACK', attackIndex: ATK_IDX }, pool); }
      catch (e) { return { __err: String(e && e.message ? e.message : e), players: st.players, log: [] }; }
    });
  } finally { if (orig) MOD.ATTACK_PRE.set(KEY, orig); else MOD.ATTACK_PRE.delete(KEY); }
}
const defDmgOf = (r) => (r && r.players && r.players[1] && r.players[1].active ? r.players[1].active.damage : -999);
const defDiscOf = (r) => (r && r.players && r.players[1] ? r.players[1].discard.length : -999);

// ══════════════════════════════════════════════════════════════════════════════
/** 整個行為矩陣（HEAD 與 BASE 各跑一次）。 */
function matrix(MOD) {
  const alive = runHeal(MOD, { yveltal: 'alive' });
  const ko = runHeal(MOD, { yveltal: 'ko' });
  const none = runHeal(MOD, { yveltal: 'none' });
  const nullified = runHeal(MOD, { yveltal: 'nullified' });
  const stale = runHeal(MOD, { yveltal: 'none', seedStale: true });
  const noHeal = runHeal(MOD, { yveltal: 'ko', heal: false });
  const preCtl = runPre(MOD, preTouchDefender);
  const preBonus = runPre(MOD, preTouchDefender, { damageBonusThisTurn: 50 });
  const prePenalty = runPre(MOD, preTouchDefender, { nextOwnAttackPenalty: 10 });
  const preNone = runPre(MOD, null, { damageBonusThisTurn: 50 });
  const SNAP_KEYS = ['_attackTimeOppFlowerVeil', '_attackTimeCalmGround', '_attackTimeOppRocketVeil',
    '_attackTimeOppBugShield', '_attackTimeAttackerEnergyUnits', '_attackTimeFieldWideRetal', '_attackTimeLifeRestraint'];
  const leftover = SNAP_KEYS.filter(k => preCtl && preCtl[k] !== undefined);
  return {
    aliveDmg: atkDmgOf(alive), aliveHealed: atkHealedFlag(alive),
    koDmg: atkDmgOf(ko), koHealed: atkHealedFlag(ko), koPending: !!(ko && ko.pendingSelection),
    // 「真的被打死了」＝戰鬥場上已經不是那隻伊裴爾塔爾（KO 後補位前 active 會是 null）
    koDefGone: !!(ko && ko.players && ko.players[1]
      && (!ko.players[1].active || String(ko.players[1].active.cardId) !== String(YVELTAL.id))),
    noneDmg: atkDmgOf(none),
    nullifiedDmg: atkDmgOf(nullified),
    staleDmg: atkDmgOf(stale),
    noHealDmg: atkDmgOf(noHeal),
    preCtlDmg: defDmgOf(preCtl), preCtlDisc: defDiscOf(preCtl),
    preBonusDmg: defDmgOf(preBonus), preBonusDisc: defDiscOf(preBonus),
    prePenaltyDmg: defDmgOf(prePenalty), prePenaltyDisc: defDiscOf(prePenalty),
    preNoneDmg: defDmgOf(preNone), preNoneDisc: defDiscOf(preNone),
    leftover: leftover.join(','),
    err: [alive, ko, none, preCtl].map(r => r?.__err ?? '').filter(Boolean).join(' | '),
  };
}

const H = matrix(HEAD);

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐(甲) 站長裁定 六-10：伊裴爾塔爾｜生命制約 依**宣告當時**判定');
chk('A0 哨兵：合成 POST 沒開時，攻擊方身上的傷害原封不動（盤面沒搭錯）',
  H.noHealDmg === SELF_DMG, `${H.noHealDmg} vs ${SELF_DMG}${H.err ? ' err=' + H.err : ''}`);
chk(`A1 哨兵（v6.354 既有行為）：伊裴爾塔爾**活著** ⇒ 對手戰鬥寶可夢的恢復被擋（傷害維持 ${SELF_DMG}）`,
  H.aliveDmg === SELF_DMG, String(H.aliveDmg));
chk('A1b ⭐被擋下時不可以標 healedThisTurn（否則活潑刀／活潑鮮花類條件會誤觸發）',
  H.aliveHealed === false, JSON.stringify(H.aliveHealed));
chk('A2a 哨兵：KO 情境下伊裴爾塔爾**真的**被這一招打死了（不然 A2 是空真）',
  H.koDefGone === true && H.noHealDmg === SELF_DMG, JSON.stringify({ gone: H.koDefGone, pending: H.koPending }));
chk(`A2 ⭐⭐⭐核心：伊裴爾塔爾被**同一招**打死 ⇒ 這一招裡的恢復**仍然**被擋（傷害維持 ${SELF_DMG}，不是 ${SELF_DMG - HEAL_AMOUNT}）`,
  H.koDmg === SELF_DMG, String(H.koDmg));
chk(`A3 ⭐反對照：宣告當時對手場上**沒有**伊裴爾塔爾 ⇒ 恢復照常（${SELF_DMG} → ${SELF_DMG - HEAL_AMOUNT}）`,
  H.noneDmg === SELF_DMG - HEAL_AMOUNT, String(H.noneDmg));
chk(`A4 ⭐反對照：伊裴爾塔爾在場但**特性已被消除**（暗夜羽擊類）⇒ 恢復照常（${SELF_DMG - HEAL_AMOUNT}）`,
  H.nullifiedDmg === SELF_DMG - HEAL_AMOUNT, String(H.nullifiedDmg));
chk(`A5 ⭐不重複／不過度：被擋下時只是「這次恢復沒發生過」，傷害回到 ${SELF_DMG}，不是 0、也不是負的`,
  H.aliveDmg === SELF_DMG && H.koDmg === SELF_DMG && H.aliveDmg >= 0, `${H.aliveDmg}/${H.koDmg}`);
chk('A6 ⭐跨 action 不殘留：輸入 state 帶著上一個 action 的假快照，但這一次 ATTACK 宣告當時沒有持有者 ⇒ 恢復照常',
  H.staleDmg === SELF_DMG - HEAL_AMOUNT, String(H.staleDmg));
chk('A6b ⭐攻擊結束（沒有 pendingSelection）後，七個 attack-time 快照都不留在盤面上',
  H.leftover === '', H.leftover);

console.log('\n【D】⭐(丁) v6.367 recon 發現的第二個 stale 洞：PRE 的盤面改動不可以被反寫');
chk(`D0 哨兵：招式**不帶**回合加傷／招致削傷時，PRE 對防守方的改動看得到（傷害 ${PRE_DEF_DMG + BASE_DMG}、棄牌 1 張）`,
  H.preCtlDmg === PRE_DEF_DMG + BASE_DMG && H.preCtlDisc === 1, `${H.preCtlDmg}/${H.preCtlDisc}`);
chk(`D1 ⭐⭐⭐帶 damageBonusThisTurn=50 ⇒ PRE 對防守方的改動**仍然**看得到（${PRE_DEF_DMG + BASE_DMG + 50}、棄牌 1 張）`,
  H.preBonusDmg === PRE_DEF_DMG + BASE_DMG + 50 && H.preBonusDisc === 1, `${H.preBonusDmg}/${H.preBonusDisc}`);
chk(`D2 ⭐⭐⭐帶 nextOwnAttackPenalty=10 ⇒ PRE 對防守方的改動**仍然**看得到（${PRE_DEF_DMG + BASE_DMG - 10}、棄牌 1 張）`,
  H.prePenaltyDmg === PRE_DEF_DMG + BASE_DMG - 10 && H.prePenaltyDisc === 1, `${H.prePenaltyDmg}/${H.prePenaltyDisc}`);
chk(`D3 ⭐反對照：PRE 什麼都不改 ＋ 帶 damageBonusThisTurn=50 ⇒ 只有 ${BASE_DMG + 50}、棄牌 0 張（沒有憑空多出東西）`,
  H.preNoneDmg === BASE_DMG + 50 && H.preNoneDisc === 0, `${H.preNoneDmg}/${H.preNoneDisc}`);

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】(乙) 站長裁定 六-11：五個既有 attack-time 快照的 clear 統一到 applyActionImpl 尾段');
const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
const count = (t, s) => t.split(s).length - 1;
const FIVE = ['_attackTimeOppFlowerVeil', '_attackTimeCalmGround', '_attackTimeOppRocketVeil',
  '_attackTimeOppBugShield', '_attackTimeAttackerEnergyUnits'];
{
  // ATTACK 流程尾段（原本那一疊的位置）到 applyActionImpl 尾段之間，不可以再有任何一個 delete。
  const iWrapper = eng.indexOf('  next = markHealsByDamageDecrease(state, next, pool);');
  const iMoved = eng.indexOf('// ⭐v6368-attack-time-clear-moved');
  chk('B0 掃描器定位：找得到 markHealsByDamageDecrease 呼叫點與 (乙) 的移走標記',
    iWrapper > 0 && iMoved > 0 && iMoved < iWrapper, `${iMoved} / ${iWrapper}`);
  for (const k of FIVE) {
    chk(`B1-${k} ⭐clear 全檔只剩**一處**（applyActionImpl 尾段）`,
      count(eng, `delete cleared.${k};`) === 1, String(count(eng, `delete cleared.${k};`)));
    const iDel = eng.indexOf(`delete cleared.${k};`);
    chk(`B2-${k} ⭐⭐那一處必須排在 markHealsByDamageDecrease **之後**（＝整個 dispatch 的真正結尾）`,
      iDel > iWrapper, `${iDel} vs ${iWrapper}`);
  }
  chk('B3 ⭐⭐v6.357 的 field-wide 反擊快照維持原樣（同一段、同一個位置，本版沒動它）',
    count(eng, 'delete cleared._attackTimeFieldWideRetal;') === 1
    && eng.indexOf('delete cleared._attackTimeFieldWideRetal;') > iWrapper);
  chk('B4 ⭐掃描器正對照：樣本裡真的有這串時要算得到、沒有時要算 0（避免恆真）',
    count('a delete cleared._attackTimeOppBugShield; b', 'delete cleared._attackTimeOppBugShield;') === 1
    && count('nothing here', 'delete cleared._attackTimeOppBugShield;') === 0);
  chk('B5 ⭐⭐ATTACK 流程尾段那一疊**整疊不見了**（留下的是說明標記，不是被註解掉的死碼）',
    count(eng, 'newState._attackTimeOppFlowerVeil !== undefined') === 0
    && count(eng, 'newState._attackTimeAttackerEnergyUnits !== undefined') === 0
    && iMoved > 0, JSON.stringify([count(eng, 'newState._attackTimeOppFlowerVeil !== undefined'), iMoved]));
  chk('B6 ⭐正對照：`newState._attackTime… !== undefined` 這個字面在樣本裡算得到（B5 不是恆真）',
    count('if (newState._attackTimeOppFlowerVeil !== undefined) {}', 'newState._attackTimeOppFlowerVeil !== undefined') === 1);
}
{
  // ⭐⭐ 行為端：位置是否正確，由「尾段的消費點讀不讀得到快照」決定 ——
  //   本版 (甲) 的 A2 就是這條的活見證（生命制約的消費點 markHealsByDamageDecrease 在尾段）。
  //   突變測試 __m6a/mutcheck_v6368.mjs 會把生命制約的 clear 搬回舊那一疊的位置，A2 必須翻紅。
  chk('B7 ⭐⭐行為端見證：A2 綠 ⇒ 位在 applyActionImpl 尾段的消費點確實讀得到 attack-time 快照',
    H.koDmg === SELF_DMG, String(H.koDmg));
}
console.log('\n【B-R】(乙) 行為零變更：五個快照相關的既有守衛必須維持全綠');
for (const g of [
  'scripts/test-attack-effect-immunity-matrix.mjs',
  'scripts/test-taikobari-bench.mjs',
  'scripts/test-taikobari-hitbenchall.mjs',
  'scripts/test-flat-multisnipe-immunity-bypass.mjs',
  'scripts/test-calmground-return-to-hand.mjs',
  'scripts/test-v6357-field-wide-retal-attack-time.mjs',
  'scripts/test-v6354-heal-block.mjs',
  'scripts/test-v6351-pre-effects-visible-to-damage.mjs',
  'scripts/test-v6367-attacker-pre-resync.mjs',
]) {
  const r = spawnSync(process.execPath, [g], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = (r.stdout || '') + (r.stderr || '');
  chk(`BR ${g.replace('scripts/', '')} 維持全綠`, r.status === 0,
    out.split('\n').filter(l => l.includes('❌') || /^\s*FAIL /.test(l)).slice(0, 3).join(' / ') || ('exit=' + r.status));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】(丙) 站長裁定 六-14：PTCG_RULES.md §16.2 那一句例外');
{
  const RULES = readFileSync(join(ROOT, 'PTCG RULES/PTCG_RULES.md'), 'utf8');
  const SENT = '- ⭐ **例外（站長裁定 六-14，v6.368）**：上一條的『離場』**不適用於同一次招式 resolve 之中**';
  const CITE = '招式「虛無歸零」的效果會對所有擲硬幣出現正面的對手的寶可夢同時造成傷害，因此，這個情況下，特性「花之帷幔」的效果會生效';
  const ANCHOR = '- 標示『處於有效狀態 / 處於生效狀態』的特性，效果持續至寶可夢離場、進化、退化、競技場卡或其他卡片明文使其失效。';
  chk('C1 ⭐補的那一句存在、而且只有一句', count(RULES, SENT) === 1, String(count(RULES, SENT)));
  chk('C2 ⭐它緊接在 §16.2「處於有效狀態…離場…」那一條之後（不是隨便丟在別處）',
    RULES.indexOf(SENT) > 0 && RULES.indexOf(ANCHOR) > 0
    && RULES.indexOf(SENT) > RULES.indexOf(ANCHOR)
    && RULES.indexOf(SENT) - RULES.indexOf(ANCHOR) < ANCHOR.length + 8,
    `${RULES.indexOf(ANCHOR)} / ${RULES.indexOf(SENT)}`);
  chk('C3 ⭐它在 §16.2 與 §16.3 之間（章節位置正確）',
    RULES.indexOf('### §16.2 特性與招式的互動') < RULES.indexOf(SENT)
    && RULES.indexOf(SENT) < RULES.indexOf('### §16.3 能量處理規則'));
  chk('C4 ⭐⭐它**指向**既有的官方問答（§17.46.B 的花之帷幔逐字），不是憑空新增一條沒有出處的規則',
    count(RULES, CITE) === 2 && RULES.indexOf(SENT) < RULES.lastIndexOf(CITE),
    `CITE 出現 ${count(RULES, CITE)} 次（1＝原問答、1＝本版引用）`);
  chk('C5 ⭐補的是「同一次招式 resolve 之中視為同時」，不是「離場後永久有效」',
    RULES.indexOf(SENT) > 0
    && RULES.slice(RULES.indexOf(SENT), RULES.indexOf(SENT) + 400).includes('招式效果視為同時發生')
    && !RULES.slice(RULES.indexOf(SENT), RULES.indexOf(SENT) + 400).includes('永久'));
  chk('C6 ⭐標明是站長裁定與版本（以後的人查得到來源）',
    RULES.slice(RULES.indexOf(SENT), RULES.indexOf(SENT) + 120).includes('站長裁定 六-14')
    && RULES.slice(RULES.indexOf(SENT), RULES.indexOf(SENT) + 120).includes('v6.368'));
  chk('C7 ⭐掃描器自驗（正對照）：這幾個字面在樣本裡算得到、在空字串裡算 0',
    count('x' + SENT + 'y', SENT) === 1 && count('', SENT) === 0
    && count('x' + CITE + 'y', CITE) === 1 && count('', CITE) === 0);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】中央性：新機制只有一份，而且接在既有形狀上');
{
  const g3 = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
  const types = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  chk('E1 ⭐生命制約快照的**設定點只有一處**，而且就在既有那一疊 attack-time 快照旁邊',
    count(eng, '_attackTimeLifeRestraint: {') === 1
    && eng.indexOf('_attackTimeLifeRestraint: {') > eng.indexOf('_attackTimeCalmGround: [')
    && eng.indexOf('_attackTimeLifeRestraint: {') < eng.indexOf('const attackTimeOppRocketVeil'),
    String(count(eng, '_attackTimeLifeRestraint: {')));
  chk('E2 ⭐生命制約快照的**清除點只有一處**，而且在 markHealsByDamageDecrease（唯一消費點）之後',
    count(eng, 'delete cleared._attackTimeLifeRestraint;') === 1
    && eng.indexOf('delete cleared._attackTimeLifeRestraint;')
       > eng.indexOf('  next = markHealsByDamageDecrease(state, next, pool);'));
  chk('E3 ⭐⭐消費點只有一處，而且就接在既有的中央述詞後面（不另開第二套消除閘）',
    count(g3, '_attackTimeLifeRestraint') === 1
    && g3.indexOf('_attackTimeLifeRestraint') > g3.indexOf('export function isHealBlockedFor'),
    String(count(g3, '_attackTimeLifeRestraint')));
  chk('E4 ⭐⭐per-player 一律 { p1, p2 }，禁止 T[][]（Firestore 禁巢狀陣列；v6.056 事故）',
    /_attackTimeLifeRestraint\?: \{ p1: boolean; p2: boolean \};/.test(types)
    && !/_attackTimeLifeRestraint\?: \[/.test(types));
  chk('E5 ⭐(丁) 的兩格都改成從 workingState.players 起手，全檔沒有殘留的 stale 寫法',
    count(eng, 'const _v6368P = [...workingState.players]') === 1
    && count(eng, 'const _v6368P2 = [...workingState.players]') === 1
    && count(eng, 'players[aIdx] = { ...players[aIdx], active: newAtk };') === 0,
    String(count(eng, 'players[aIdx] = { ...players[aIdx], active: newAtk };')));
  chk('E6 ⭐正對照：stale 寫法的字面在樣本裡算得到（E5 不是恆真）',
    count('  players[aIdx] = { ...players[aIdx], active: newAtk };\n', 'players[aIdx] = { ...players[aIdx], active: newAtk };') === 1);
  chk('E7 ⭐v6.351／v6.367 兩份快照對齊原封不動地還在（本版沒有取代它們）',
    count(eng, 'Object.assign(defender, workingState.players[dIdx]);') === 1
    && count(eng, '>>> v6367-resync-attacker-after-pre') === 1);
  chk('E8 ⭐哨兵成對（純新增的三個區塊）',
    ['v6368-life-restraint-import', 'v6368-life-restraint-snapshot-set', 'v6368-life-restraint-snapshot-clear']
      .every(t => count(eng, '>>> ' + t) === 1 && count(eng, '<<< ' + t) === 1));
  // ⚠ v6.369 修一個**同型的守衛過期**：剝除鏈每出一版就往外長一層，原本寫死「最外層＝
  //   stripV6368Engine」的斷言在下一版必然假性翻紅。改成只釘本版該負責的兩件事 ——
  //   ① v6.368 那一層還在；② 它緊貼在 v6.367 外面；③ 它真的被接在 s0 那條鏈上。
  //   「誰是最外層」由**當版**的守衛自己釘（v6.369 起是 test-v6369 的 D10 ＋ __m6a/stripcheck369v2.mjs）。
  chk('E9 ⭐test-v6265 的剝除鏈裡 v6.368 那一層還在，且緊貼在 v6.367 外面、確實接在 s0 鏈上',
    (() => {
      const t = readFileSync(join(ROOT, 'scripts/test-v6265-phantom-start-race.mjs'), 'utf8');
      const s0line = (t.split(/\r?\n/).find(l => l.includes('const s0 = strip')) ?? '');
      return count(t, 'const stripV6368Engine = (src) =>') === 1
        && /stripV6368Engine\(stripV6367Engine\(/.test(t)
        && s0line.includes('stripV6368Engine(');
    })());
}

// ══════════════════════════════════════════════════════════════════════════════
const BASE = process.env.V6368_BASE || BASE_SHA;
console.log(`\n【F】HEAD-FAIL：對 BASE(${BASE.slice(0, 8)} ＝ v6.367，本版的上一版) 重跑整個行為矩陣`);
if (!hasBaseCommit(ROOT, BASE)) {
  shallowSkip('【F】HEAD-FAIL 對 BASE 的重建比對', '【A】~【E】不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  const FILES = ['src/lib/game/engine.ts', 'src/lib/game/types.ts', 'src/lib/game/effects/cards/v3001_g3_wave3.ts'];
  let rebuilt = true;
  for (const rel of FILES) {
    const b = readBaseBlob(ROOT, BASE, rel);
    if (!chk('F0 BASE 樹重建成功：' + rel, b.ok)) { rebuilt = false; continue; }
    writeFileSync(join(baseSrc, rel.replace('src/', '')), b.out, 'utf8');
  }
  if (rebuilt) {
    const BMOD = await bundleFrom(baseSrc, 'base');
    const B = matrix(BMOD);
    chk('F1 哨兵：BASE bundle 是活的（哨兵情境照樣綠，不是整支爆掉造成的「全紅」）',
      B.aliveDmg === SELF_DMG && B.noneDmg === SELF_DMG - HEAL_AMOUNT && B.preCtlDmg === PRE_DEF_DMG + BASE_DMG,
      JSON.stringify({ alive: B.aliveDmg, none: B.noneDmg, preCtl: B.preCtlDmg, err: B.err }));
    chk('F2 ⭐⭐⭐(甲) BASE 一定要紅：伊裴爾塔爾被同一招打死後，BASE 讓恢復過去了',
      B.koDmg === SELF_DMG - HEAL_AMOUNT && H.koDmg === SELF_DMG,
      `BASE=${B.koDmg} HEAD=${H.koDmg}`);
    chk('F3 ⭐⭐⭐(丁) BASE 一定要紅：帶 damageBonusThisTurn 時 BASE 把 PRE 的改動反寫掉了',
      B.preBonusDmg === BASE_DMG + 50 && B.preBonusDisc === 0
      && H.preBonusDmg === PRE_DEF_DMG + BASE_DMG + 50 && H.preBonusDisc === 1,
      `BASE=${B.preBonusDmg}/${B.preBonusDisc} HEAD=${H.preBonusDmg}/${H.preBonusDisc}`);
    chk('F4 ⭐⭐⭐(丁) BASE 一定要紅：帶 nextOwnAttackPenalty 時同樣被反寫',
      B.prePenaltyDmg === BASE_DMG - 10 && B.prePenaltyDisc === 0
      && H.prePenaltyDmg === PRE_DEF_DMG + BASE_DMG - 10 && H.prePenaltyDisc === 1,
      `BASE=${B.prePenaltyDmg}/${B.prePenaltyDisc} HEAD=${H.prePenaltyDmg}/${H.prePenaltyDisc}`);
    chk('F5 ⭐(乙) 語意零變更：BASE 與 HEAD 在「攻擊結束後快照都清乾淨」上一致',
      B.leftover === '' && H.leftover === '', `BASE=[${B.leftover}] HEAD=[${H.leftover}]`);
    chk('F6 ⭐反對照在 BASE 也一樣（證明紅的是「宣告當時」那一條，不是整個 harness 漂移）',
      B.nullifiedDmg === SELF_DMG - HEAL_AMOUNT && B.noneDmg === SELF_DMG - HEAL_AMOUNT
      && B.preNoneDmg === BASE_DMG + 50 && B.preNoneDisc === 0,
      JSON.stringify([B.nullifiedDmg, B.noneDmg, B.preNoneDmg, B.preNoneDisc]));
  }
}

console.log(`\n═══ v6.368 守衛：PASS ${pass} / FAIL ${fail} ═══`);
process.exit(fail === 0 ? 0 : 1);
