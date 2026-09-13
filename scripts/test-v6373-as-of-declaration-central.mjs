// v6.373 守衛：「宣告當時」＝花之帷幔判準，收斂成全站唯一的中央述詞
//
// 站長裁定 A-3（逐字）：「凡是有這種類似的狀況，請你都比照 謝米［特性］花之帷幔的判定邏輯」
//
// 本版四件事：
//   (甲) 中央述詞 src/lib/game/as-of-declaration.ts —— 6 個消費點全部改走它，
//        並把原本 `live || snapshot`（＝宣告當時有效就永遠算數）**收緊**成
//          有效 ＝ live ||（宣告當時有效 && 持有者不是「被主動移出場」）
//        判別「主動移除」不靠新增 KO hook，而是看持有者現在在**哪一區**
//        （手牌／牌庫 ＝ 主動移除；棄牌區／找不到 ＝ fail-safe 仍算數）。
//   (乙) （recon 結論見報告）影藏兩條管線的 state 差異**不在本版動**，理由寫在報告。
//   (丙) C-11：`_attackTime*` 的「設定點一處／清除點一處／清除在 applyActionImpl 尾段」
//        改成**枚舉式掃描器**（不再只釘具名那幾個）。
//   (丁) C-14：engine.ts v6.351 那段「費用支付」註解已被 v6.367 證偽 ⇒ 改正。
//
// 斷言分層：
//   【A】⭐⭐⭐ 行為端（收緊本身）：持有者被**洗回牌庫** vs 被**打死進棄牌區**，兩者必須不同結果。
//   【B】⭐ 花之帷幔既有行為零變更（真卡：謝米被同一招 KO ⇒ 備戰仍受保護）。
//   【C】⭐ 站長 C-7：弱丁魚先昏厥離場 ⇒ 仍在使用招式的寶可夢身上放 3 個指示物。
//   【D】⭐ 削落家族行為鎖（v6.351 的修正不可以被本版弄壞）。
//   【E】(丙) 枚舉式掃描器 ＋ 下限斷言 ＋ 正對照。
//   【F】(甲) 中央性掃描 ＋ 正對照。
//   【G】(丁) 註解逐字 ＋ test-v6265 剝除鏈。
//   【H】HEAD-FAIL 對 BASE(45e925c1 ＝ v6.372)，用 hasBaseCommit 保護、淺複製 shallowSkip。
//
// ⚠ 合成 ATTACK_POST 只在本守衛的 bundle 裡註冊、try/finally 還原；
//   ⛔ 絕對不可以把測試用的東西寫進 src/。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, restoreBaseSubtree, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '45e925c17dc8b2b3edee2b80e52f3da322a90cea';   // v6.372（v6.373 的上一版）

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
const byId = (id) => pool.get(String(id));
const HIJ = (c) => ['H', 'I', 'J'].includes(c?.regulationMark);

// ── 真卡 fixture（全部 H/I/J，卡面事實來自 static/cards）────────────────────
const YVELTAL = byId('19991');                 // M6a 079/103 標J 伊裴爾塔爾｜生命制約 HP120【惡】
const SHAYMIN = byId('14672');                 // M2a 012/193 標I 謝米｜花之帷幔 HP80【草】
const ARTIC   = byId('19924');                 // M6a 標J 急凍鳥｜冰雹（對手全體各 30）
const FEEB    = byId('19928');                 // M6a 標J 弱丁魚｜群聚反擊 HP30【水】
const FEEBEX  = byId('19571');                 // 弱丁魚ex HP260（戰鬥場主詞，不會被 30 打死）
const RADA    = byId('18037');                 // M3 060/080 標J 拉達｜削落（20，造成傷害前丟道具）
const CHIKA   = all.find(c => c.name === '千香果' && HIJ(c));       // −60 屬性減傷
const LUXBOMB = all.find(c => c.name === '奢華炸彈' && HIJ(c));     // 反擊指示物
const HEROCAPE= all.find(c => c.name === '英雄斗篷' && HIJ(c));     // 最大 HP +100

const ARTIC_I = ARTIC ? ARTIC.attacks.findIndex(a => a.name === '冰雹') : -1;
const RADA_I  = RADA ? RADA.attacks.findIndex(a => a.name === '削落') : -1;

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Dragon: '龍' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;

/** 【A】用的攻擊方：基礎／無特性／非規則／單費純數字招式／屬性不吃伊裴爾塔爾的弱抗。 */
const ATK = all.find(c => c.supertype === 'Pokemon' && HIJ(c)
  && c.pokemonType && c.pokemonType !== 'Lightning' && c.pokemonType !== 'Fighting'
  && (c.stage ?? c.subtype) === 'Basic' && !(c.abilities || []).length && !(c.tags || []).length && NONRULE(c)
  && (c.attacks || []).some(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0 && !String(a.effect ?? '').trim() && (a.cost || []).length === 1));
const ATK_ATTACK = ATK ? ATK.attacks.find(a => /^\d+$/.test(String(a.damage)) && Number(a.damage) > 0 && !String(a.effect ?? '').trim() && (a.cost || []).length === 1) : null;
const ATK_IDX = ATK && ATK_ATTACK ? ATK.attacks.findIndex(a => a.name === ATK_ATTACK.name) : -1;
const BASE_DMG = ATK_ATTACK ? Number(ATK_ATTACK.damage) : -1;
const KEY = ATK && ATK_ATTACK ? `${ATK.name}|${ATK_ATTACK.name}` : 'x|y';
/** 高 HP 的中性靶（放對手戰鬥場，別被打死才看得到回血差異）。 */
const TGT = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 150
  && c.weakness?.type !== ATK?.pokemonType && c.resistance?.type !== ATK?.pokemonType);
/** 【B】用的備戰靶：非規則、不是【草】弱點（謝米保護的是非規則寶可夢）。 */
const BTGT = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 100 && c.weakness?.type !== 'Water');
/** 【D】用的防守方：無特性、非規則、不吃【無】弱點。 */
const DTGT = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 100
  && c.weakness?.type !== RADA?.pokemonType && c.resistance?.type !== RADA?.pokemonType);

console.log('\n【0】fixture 自驗（Rule 25：抽不到卡／卡面對不上要大聲紅，不可以靜默全綠）');
chk('0a ⭐伊裴爾塔爾（M6a 079/103，id 19991，標 J）在卡池，特性【生命制約】逐字相符',
  YVELTAL?.name === '伊裴爾塔爾' && YVELTAL?.regulationMark === 'J' && Number(YVELTAL?.hp) === 120
  && YVELTAL?.abilities?.[0]?.name === '生命制約'
  && YVELTAL?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，對手的戰鬥寶可夢的HP無法恢復。',
  JSON.stringify({ n: YVELTAL?.name, m: YVELTAL?.regulationMark, e: YVELTAL?.abilities?.[0]?.effect }));
chk('0b ⭐謝米（M2a 012/193，id 14672，標 I）｜花之帷幔 HP80【草】',
  SHAYMIN?.name === '謝米' && SHAYMIN?.regulationMark === 'I' && Number(SHAYMIN?.hp) === 80
  && SHAYMIN?.abilities?.some(a => a.name === '花之帷幔'),
  JSON.stringify({ n: SHAYMIN?.name, m: SHAYMIN?.regulationMark, hp: SHAYMIN?.hp }));
chk('0c ⭐急凍鳥｜冰雹（標 J）卡面逐字＝「對手的所有寶可夢各受到30點傷害。[在備戰區不計算弱點・抵抗力。]」',
  ARTIC?.regulationMark === 'J' && ARTIC_I >= 0
  && ARTIC.attacks[ARTIC_I].effect === '對手的所有寶可夢各受到30點傷害。[在備戰區不計算弱點・抵抗力。]',
  JSON.stringify(ARTIC?.attacks?.[ARTIC_I]));
chk('0d ⭐弱丁魚（M6a，標 J）HP30｜群聚反擊；弱丁魚ex HP260 且**沒有**群聚反擊',
  FEEB?.regulationMark === 'J' && Number(FEEB?.hp) === 30 && FEEB?.abilities?.some(a => a.name === '群聚反擊')
  && Number(FEEBEX?.hp) === 260 && !(FEEBEX?.abilities || []).some(a => a.name === '群聚反擊'),
  JSON.stringify([FEEB?.hp, FEEBEX?.hp]));
chk('0e ⭐拉達（M3 060/080，標 J）｜削落 20 點、卡面逐字「在造成傷害前，將對手的戰鬥寶可夢身上附加的「寶可夢道具」卡丟棄。」',
  RADA?.regulationMark === 'J' && RADA_I >= 0 && String(RADA.attacks[RADA_I].damage) === '20'
  && RADA.attacks[RADA_I].effect === '在造成傷害前，將對手的戰鬥寶可夢身上附加的「寶可夢道具」卡丟棄。',
  JSON.stringify(RADA?.attacks?.[RADA_I]));
chk('0f ⭐千香果／奢華炸彈／英雄斗篷 都在卡池且都是 H/I/J 的「寶可夢道具」',
  [CHIKA, LUXBOMB, HEROCAPE].every(c => c && c.subtype === 'PokemonTool' && HIJ(c)),
  JSON.stringify([CHIKA?.name, CHIKA?.regulationMark, LUXBOMB?.regulationMark, HEROCAPE?.regulationMark]));
chk('0g 抓得到【A】用的攻擊方／高 HP 靶／備戰靶／【D】用的防守方（全部 H/I/J）',
  !!ATK && !!ATK_ATTACK && ATK_IDX >= 0 && BASE_DMG > 0 && !!TGT && !!BTGT && !!DTGT,
  JSON.stringify({ atk: ATK?.name, dmg: BASE_DMG, tgt: TGT?.name, btgt: BTGT?.name, dtgt: DTGT?.name }));
chk('0h ⭐千香果 −60 ＞ 削落 20 ⇒「沒收緊就會變 0 點」這個門檻是真的（不是湊出來的）',
  String(CHIKA?.effect ?? CHIKA?.rules ?? '').includes('60') || String(JSON.stringify(CHIKA)).includes('60'),
  JSON.stringify(CHIKA?.effect ?? CHIKA?.rules ?? null));
if (!YVELTAL || !SHAYMIN || !ARTIC || !FEEB || !FEEBEX || !RADA || !CHIKA || !LUXBOMB || !HEROCAPE
  || !ATK || !ATK_ATTACK || !TGT || !BTGT || !DTGT) {
  console.log('\n❌ fixture 不齊，無法繼續'); process.exit(1);
}

// ── harness ──────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6373-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/** ⚠ entry 要寫在 srcDir 的父目錄、用相對路徑 import（Windows 的 `E:/…` 會被 esbuild 當成套件名）。 */
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = `./${name}`;
  const S = join(parent, `.v6373-s-${tag}.js`), E = join(parent, `.v6373-e-${tag}.ts`), O = join(parent, `.v6373-o-${tag}.mjs`);
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
chk('0i ⭐【A】那一招在 src/ 裡**沒有**既有的 ATTACK_PRE／ATTACK_POST（合成的不會蓋掉真卡實裝）',
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
const run = (MOD, st, a) => heads(() => {
  try { return MOD.applyAction(st, a, pool); }
  catch (e) { return { __err: String(e && e.message ? e.message : e), players: st.players, log: [] }; }
});
const eCost = (c, n) => ((c.attacks || []).find(a => a.name === n)?.cost ?? []).map(t => inst(EID[t] ?? EID.Water));
const filler = (n, id) => Array.from({ length: n }, () => inst(id));

// ══════════════════════════════════════════════════════════════════════════════
// 【A】收緊本身：持有者「被洗回牌庫」（主動移除）vs「進棄牌區」（昏厥離場）
//   盤面：玩家 0 出招（自己身上 50 點傷害），玩家 1 戰鬥場高 HP 靶、備戰有伊裴爾塔爾。
//   合成 ATTACK_POST：① 依 mode 把備戰的伊裴爾塔爾搬到 牌庫／棄牌區／原地不動
//                      ② 替**攻擊方自己**恢復 30 點
//   依卡面，伊裴爾塔爾的對手（＝玩家 0）的戰鬥寶可夢 HP 無法恢復。
// ══════════════════════════════════════════════════════════════════════════════
const HEAL = 30, SELF_DMG = 50;
const makePost = (mode) => (s, ai) => {
  const di = 1 - ai;
  const players = [...s.players];
  if (mode !== 'stay' && mode !== 'none') {
    const dp = { ...players[di] };
    const i = dp.bench.findIndex(b => String(b.cardId) === String(YVELTAL.id));
    if (i >= 0) {
      const moved = dp.bench[i];
      dp.bench = dp.bench.filter((_, k) => k !== i);
      if (mode === 'deck') dp.deck = [...dp.deck, moved];
      else if (mode === 'discard') dp.discard = [...dp.discard, moved];
      else if (mode === 'hand') dp.hand = [...dp.hand, moved];
    }
    players[di] = dp;
  }
  const ap = { ...players[ai] };
  if (ap.active) ap.active = { ...ap.active, damage: Math.max(0, (ap.active.damage ?? 0) - HEAL) };
  players[ai] = ap;
  return { ...s, players };
};
function runHeal(MOD, mode) {
  const orig = MOD.ATTACK_POST.get(KEY);
  MOD.ATTACK_POST.set(KEY, makePost(mode));
  try {
    const bench = mode === 'none' ? [inst(BTGT.id)] : [inst(YVELTAL.id), inst(BTGT.id)];
    const st = mk(
      { active: inst(ATK.id, { energyAttached: eCost(ATK, ATK_ATTACK.name), damage: SELF_DMG }),
        bench: [inst(ATK.id)], deck: filler(3, ATK.id), prizes: filler(6, ATK.id) },
      { active: inst(TGT.id), bench, deck: filler(3, BTGT.id), prizes: filler(6, BTGT.id) });
    return run(MOD, st, { type: 'ATTACK', attackIndex: ATK_IDX });
  } finally { if (orig) MOD.ATTACK_POST.set(KEY, orig); else MOD.ATTACK_POST.delete(KEY); }
}
const atkDmg = (r) => (r?.players?.[0]?.active ? r.players[0].active.damage : -999);
const benchIds = (r) => (r?.players?.[1]?.bench ?? []).map(b => String(b.cardId));
const zoneOf = (r, id) => {
  const p = r?.players?.[1]; if (!p) return '?';
  for (const [z, arr] of [['deck', p.deck], ['discard', p.discard], ['hand', p.hand], ['bench', p.bench]])
    if ((arr ?? []).some(x => String(x.cardId) === String(id))) return z;
  return 'gone';
};

// ══════════════════════════════════════════════════════════════════════════════
// 【B】花之帷幔：謝米在戰鬥場被同一招 KO ⇒ 備戰非規則寶可夢仍然免疫（既有行為）
// 【C】站長 C-7：弱丁魚先昏厥離場 ⇒ 仍在使用招式的寶可夢身上放 3 個指示物
// ══════════════════════════════════════════════════════════════════════════════
function runArtic(MOD, p1Active, p1Bench) {
  const st = mk(
    { active: inst(ARTIC.id, { energyAttached: eCost(ARTIC, '冰雹') }), bench: [inst(BTGT.id)],
      deck: filler(3, BTGT.id), prizes: filler(6, BTGT.id) },
    { active: p1Active, bench: p1Bench, deck: filler(3, BTGT.id), prizes: filler(6, BTGT.id) });
  return run(MOD, st, { type: 'ATTACK', attackIndex: ARTIC_I });
}
const benchDmgs = (r) => (r?.players?.[1]?.bench ?? []).map(b => b.damage ?? 0);
const retalLogs = (r) => (r?.log ?? []).map(l => String(l?.message ?? l)).filter(m => /群聚反擊/.test(m));

// ══════════════════════════════════════════════════════════════════════════════
// 【D】削落家族行為鎖（v6.351 的「在造成傷害前」修正不可以被本版弄壞）
// ══════════════════════════════════════════════════════════════════════════════
function runRada(MOD, toolCard) {
  const st = mk(
    { active: inst(RADA.id, { energyAttached: eCost(RADA, '削落') }), bench: [inst(RADA.id)],
      deck: filler(3, RADA.id), prizes: filler(6, RADA.id) },
    { active: inst(DTGT.id, { toolAttached: toolCard ? inst(toolCard.id) : null }), bench: [inst(DTGT.id)],
      deck: filler(3, DTGT.id), prizes: filler(6, DTGT.id) });
  return run(MOD, st, { type: 'ATTACK', attackIndex: RADA_I });
}
const defDmg = (r) => (r?.players?.[1]?.active ? r.players[1].active.damage : 'KO');
const selfDmg = (r) => (r?.players?.[0]?.active ? r.players[0].active.damage : 'KO');

// ══════════════════════════════════════════════════════════════════════════════
/** 整個行為矩陣（HEAD 與 BASE 各跑一次）。 */
function matrix(MOD) {
  const deck = runHeal(MOD, 'deck');
  const hand = runHeal(MOD, 'hand');
  const disc = runHeal(MOD, 'discard');
  const stay = runHeal(MOD, 'stay');
  const none = runHeal(MOD, 'none');
  const shay = runArtic(MOD, inst(SHAYMIN.id, { damage: 80 - 30 }), [inst(BTGT.id)]);
  const shayNone = runArtic(MOD, inst(BTGT.id), [inst(BTGT.id)]);
  const c7 = runArtic(MOD, inst(FEEBEX.id), [inst(FEEB.id), inst(BTGT.id)]);
  const radaNone = runRada(MOD, null);
  const radaChika = runRada(MOD, CHIKA);
  const radaBomb = runRada(MOD, LUXBOMB);
  const radaCape = runRada(MOD, HEROCAPE);
  return {
    deckDmg: atkDmg(deck), deckZone: zoneOf(deck, YVELTAL.id),
    handDmg: atkDmg(hand), handZone: zoneOf(hand, YVELTAL.id),
    discDmg: atkDmg(disc), discZone: zoneOf(disc, YVELTAL.id),
    stayDmg: atkDmg(stay), noneDmg: atkDmg(none),
    shayBench: JSON.stringify(benchDmgs(shay)), shayActive: shay?.players?.[1]?.active ? 'alive' : 'KO',
    shayNoneBench: JSON.stringify(benchDmgs(shayNone)),
    c7Atk: (c7?.players?.[0]?.active?.damage ?? -999), c7Logs: retalLogs(c7).length,
    c7BenchLeft: (c7?.players?.[1]?.bench ?? []).length,
    radaNoneDmg: defDmg(radaNone), radaChikaDmg: defDmg(radaChika),
    radaBombDmg: defDmg(radaBomb), radaBombSelf: selfDmg(radaBomb), radaCapeDmg: defDmg(radaCape),
    err: [deck, disc, stay, none, shay, c7, radaChika].map(r => r?.__err ?? '').filter(Boolean).join(' | '),
  };
}
const H = matrix(HEAD);

console.log('\n【A】⭐⭐⭐(甲) 收緊本身：持有者「被主動移出場」與「昏厥離場」必須不同結果');
chk('A0 哨兵：宣告當時對手場上**沒有**伊裴爾塔爾 ⇒ 恢復照常（50 → 20）',
  H.noneDmg === SELF_DMG - HEAL, `${H.noneDmg}${H.err ? ' err=' + H.err : ''}`);
chk('A1 哨兵（v6.354 既有行為）：伊裴爾塔爾**留在備戰** ⇒ 恢復被擋（維持 50）',
  H.stayDmg === SELF_DMG, String(H.stayDmg));
chk('A2 哨兵：合成 POST 真的把伊裴爾塔爾搬進了牌庫／棄牌區（不然 A3/A4 是空真）',
  H.deckZone === 'deck' && H.discZone === 'discard' && H.handZone === 'hand',
  JSON.stringify([H.deckZone, H.discZone, H.handZone]));
chk('A3 ⭐⭐⭐核心：持有者被**洗回牌庫**（＝仙子伊布ex｜天仙石 那種主動移除）⇒ 恢復**不再**被擋（50 → 20）',
  H.deckDmg === SELF_DMG - HEAL, String(H.deckDmg));
chk('A4 ⭐⭐⭐核心：持有者被**放回手牌**（主動移除）⇒ 恢復**不再**被擋（50 → 20）',
  H.handDmg === SELF_DMG - HEAL, String(H.handDmg));
chk('A5 ⭐⭐⭐反對照（站長裁定六-14 的本體）：持有者進**棄牌區**（＝昏厥離場）⇒ 恢復**仍然**被擋（維持 50）',
  H.discDmg === SELF_DMG, String(H.discDmg));
chk('A6 ⭐「不同結果」這件事本身：牌庫／手牌 與 棄牌區 的結果必須真的不一樣（不是兩邊都放行）',
  H.deckDmg !== H.discDmg && H.handDmg !== H.discDmg,
  JSON.stringify([H.deckDmg, H.handDmg, H.discDmg]));

console.log('\n【B】⭐花之帷幔既有行為零變更（謝米被同一招 KO ⇒ 備戰仍受保護）');
chk('B0 哨兵：謝米**真的**被冰雹的 30 點打死離場（HP80、預置 50 點傷害）',
  H.shayActive === 'KO', H.shayActive);
chk('B1 ⭐站長裁定六-14：謝米被同一招 KO 後，備戰非規則寶可夢仍然 0 點（快照仍然算數）',
  H.shayBench === '[0]', H.shayBench);
chk('B2 ⭐反對照：宣告當時對手場上**沒有**謝米 ⇒ 備戰照常吃 30 點（B1 不是恆真）',
  H.shayNoneBench === '[30]', H.shayNoneBench);

console.log('\n【C】⭐⭐站長第一輪裁示 C-7：弱丁魚先昏厥離場，仍要放 3 個傷害指示物');
chk('C0 哨兵：備戰那隻 HP30 的弱丁魚**真的**被同一招打到昏厥離場（備戰只剩 1 隻）',
  H.c7BenchLeft === 1, String(H.c7BenchLeft));
chk('C1 ⭐⭐⭐站長逐字：持有者已離場，仍在使用招式的寶可夢身上放置 3 個傷害指示物（+30）',
  H.c7Atk === 30, String(H.c7Atk));
chk('C2 ⭐只放**一次**（log 恰好一行，不是當下盤面＋快照各一次）',
  H.c7Logs === 1, String(H.c7Logs));

console.log('\n【D】⭐削落家族行為鎖（站長點名的反例：被丟掉的道具必須立刻失效）');
chk('D1 ⭐⭐⭐拉達｜削落 打戴著**千香果**（−60）的對手 ⇒ 傷害必須是 20，不是 0',
  H.radaChikaDmg === 20, String(H.radaChikaDmg));
chk('D2 反對照：對手**沒有**道具時，削落逐字 20 點（D1 不是恆真）',
  H.radaNoneDmg === 20, String(H.radaNoneDmg));
chk('D3 ⭐戴**奢華炸彈**（反擊指示物）⇒ 道具在造成傷害前就被丟掉 ⇒ 攻擊方身上 0 點反擊',
  H.radaBombDmg === 20 && H.radaBombSelf === 0, JSON.stringify([H.radaBombDmg, H.radaBombSelf]));
chk('D4 ⭐戴**英雄斗篷**（最大 HP +100）⇒ 道具先被丟掉，傷害照樣 20',
  H.radaCapeDmg === 20, String(H.radaCapeDmg));

// ══════════════════════════════════════════════════════════════════════════════
// 【E】(丙) C-11：`_attackTime*` 的枚舉式掃描器
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】⭐(丙) C-11：`_attackTime*` 枚舉式掃描器（設定點一處／清除點一處／清除在 applyActionImpl 尾段）');
const engSrc = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
const typSrc = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
const count = (t, s) => t.split(s).length - 1;

/** ⭐ 枚舉式掃描器（純函式，可以餵突變過的字串做正對照）。回傳問題清單。 */
function scanAttackTimeSnapshots(typ, eng) {
  const problems = [];
  const fields = [...new Set([...typ.matchAll(/^\s*(_attackTime\w+)\?:/gm)].map(m => m[1]))];
  if (!fields.length) { problems.push('types.ts 一個 _attackTime* 欄位都掃不到（掃描器本身壞了）'); return { fields, problems }; }
  const iSetStart = eng.indexOf('const attackTimeOppFlowerVeil = hasFlowerVeil(state, dIdx, pool);');
  const iSetEnd = eng.indexOf('    let preBreakdown:');
  const iTail = eng.indexOf('  next = markHealsByDamageDecrease(state, next, pool);');
  if (iSetStart < 0 || iSetEnd < 0 || iTail < 0) {
    problems.push(`掃描器定位失敗（ATTACK 宣告區塊／applyActionImpl 尾段找不到）：${iSetStart}/${iSetEnd}/${iTail}`);
    return { fields, problems };
  }
  for (const f of fields) {
    const setNeedle = `...workingState, ${f}:`;
    const nSet = count(eng, setNeedle);
    if (nSet !== 1) { problems.push(`${f}：設定點 ${nSet} 處（必須恰好 1 處，寫法 \`...workingState, ${f}:\`）`); continue; }
    const iSet = eng.indexOf(setNeedle);
    if (!(iSet > iSetStart && iSet < iSetEnd)) problems.push(`${f}：設定點不在 ATTACK 宣告區塊內（Rule 38：不另開 ATTACK 起點 hook）`);
    const clrNeedle = `delete cleared.${f};`;
    const nClr = count(eng, clrNeedle);
    if (nClr !== 1) { problems.push(`${f}：清除點 ${nClr} 處（必須恰好 1 處）`); continue; }
    if (eng.indexOf(clrNeedle) < iTail) problems.push(`${f}：清除點不在 applyActionImpl 尾段（必須排在 markHealsByDamageDecrease 之後）`);
    if (count(eng, `delete ${f}`) + count(eng, `newState.${f} !== undefined`) > 0) {
      problems.push(`${f}：出現了 applyActionImpl 尾段以外的清除寫法`);
    }
  }
  return { fields, problems };
}
const SCAN = scanAttackTimeSnapshots(typSrc, engSrc);
chk('E1 ⭐枚舉：types.ts 掃得到的 `_attackTime*` 欄位數 ≥ 8（下限斷言；本版新增 _attackTimeHolders）',
  SCAN.fields.length >= 8, JSON.stringify(SCAN.fields));
chk('E2 ⭐掃描器列出的欄位含本版新增的 _attackTimeHolders 與既有七支',
  ['_attackTimeOppFlowerVeil', '_attackTimeCalmGround', '_attackTimeOppRocketVeil', '_attackTimeOppBugShield',
    '_attackTimeAttackerEnergyUnits', '_attackTimeFieldWideRetal', '_attackTimeLifeRestraint', '_attackTimeHolders']
    .every(f => SCAN.fields.includes(f)), JSON.stringify(SCAN.fields));
chk('E3 ⭐⭐掃描器對**現況**必須零問題（設定點一處／清除點一處／清除在尾段）',
  SCAN.problems.length === 0, JSON.stringify(SCAN.problems));
chk('E4 ⭐正對照①：把某個欄位的 clear 搬到 applyActionImpl 尾段**之前** ⇒ 掃描器必須紅',
  (() => {
    const needle = '  if (next._attackTimeHolders !== undefined && !next.pendingSelection) {\n    const cleared = { ...next };\n    delete cleared._attackTimeHolders;\n    next = cleared;\n  }\n';
    const n2 = engSrc.includes(needle) ? needle : needle.replace(/\n/g, '\r\n');
    if (!engSrc.includes(n2)) return false;
    const moved = engSrc.replace(n2, '') .replace(
      engSrc.includes('  next = markHealsByDamageDecrease(state, next, pool);\r\n') ? '  next = markHealsByDamageDecrease(state, next, pool);\r\n' : '  next = markHealsByDamageDecrease(state, next, pool);\n',
      n2 + (engSrc.includes('\r\n') ? '  next = markHealsByDamageDecrease(state, next, pool);\r\n' : '  next = markHealsByDamageDecrease(state, next, pool);\n'));
    return scanAttackTimeSnapshots(typSrc, moved).problems.some(p => p.includes('_attackTimeHolders'));
  })());
chk('E5 ⭐正對照②：把某個欄位的 clear 整段刪掉 ⇒ 掃描器必須紅（清除點 0 處）',
  (() => {
    const m = engSrc.includes('\r\n');
    const needle = (m ? '    delete cleared._attackTimeOppBugShield;\r\n' : '    delete cleared._attackTimeOppBugShield;\n');
    if (!engSrc.includes(needle)) return false;
    return scanAttackTimeSnapshots(typSrc, engSrc.replace(needle, '')).problems.some(p => p.includes('_attackTimeOppBugShield'));
  })());
chk('E6 ⭐正對照③：把某個欄位的設定點複製成兩處 ⇒ 掃描器必須紅（設定點 2 處）',
  (() => {
    const needle = '...workingState, _attackTimeOppRocketVeil:';
    if (!engSrc.includes(needle)) return false;
    return scanAttackTimeSnapshots(typSrc, engSrc.replace(needle, needle + ' 0 }; const _x = { ' + needle))
      .problems.some(p => p.includes('_attackTimeOppRocketVeil'));
  })());
chk('E7 ⭐正對照④：types.ts 掃不到欄位時掃描器要大聲紅（不可以靜默全綠）',
  scanAttackTimeSnapshots('export interface X { foo?: string; }', engSrc).problems.length > 0);

// ══════════════════════════════════════════════════════════════════════════════
// 【F】(甲) 中央性：`live || snapshot` 的過寬寫法必須一處都不剩
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】⭐(甲) 中央性：6 個消費點全部走中央述詞，過寬的 `|| state._attackTime…` 零殘留');
const SRC_FILES = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) SRC_FILES.push(p);
  }
})(join(ROOT, 'src'));
/** ⭐ 過寬寫法偵測器（純函式，可餵樣本做正對照）。 */
const WIDE_RE = /\|\|\s*(?:state|s|next|workingState|st)\._attackTime\w+/g;
const wideHits = (txt) => (txt.match(WIDE_RE) ?? []).length;
let wideTotal = 0; const wideWhere = [];
for (const p of SRC_FILES) {
  const n = wideHits(readFileSync(p, 'utf8'));
  if (n) { wideTotal += n; wideWhere.push(`${p.slice(ROOT.length)}×${n}`); }
}
chk('F1 ⭐⭐⭐src/ 全掃：`… || state._attackTime…` 這種過寬寫法 0 處（BASE(45e925c1) 實測 4 處，全在 effects.ts）',
  wideTotal === 0, JSON.stringify(wideWhere));
chk('F2 ⭐正對照：偵測器對樣本字串算得到（F1 不是恆真）',
  wideHits('if (live || state._attackTimeOppFlowerVeil) {}') === 1
  && wideHits('if (live || s._attackTimeCalmGround) {}') === 1
  && wideHits('const a = state._attackTimeHolders;') === 0);
const asofPath = join(ROOT, 'src/lib/game/as-of-declaration.ts');
const asof = readFileSync(asofPath, 'utf8');
chk('F3 ⭐中央述詞檔存在，且判準核心 declarationHolderStillCounts 只定義一份',
  count(asof, 'export function declarationHolderStillCounts(') === 1
  && count(asof, 'export function isEffectiveAsOfDeclaration(') === 1, String(asof.length));
const effSrc = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
const g3Src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/v3001_g3_wave3.ts'), 'utf8');
chk('F4 ⭐6 個消費點都改走中央述詞：effects.ts 5 處 ＋ v3001_g3_wave3.ts 2 處呼叫 isEffectiveAsOfDeclaration',
  count(effSrc, 'isEffectiveAsOfDeclaration(') === 5 && count(g3Src, 'isEffectiveAsOfDeclaration(') === 2,
  JSON.stringify([count(effSrc, 'isEffectiveAsOfDeclaration('), count(g3Src, 'isEffectiveAsOfDeclaration(')]));
chk('F5 ⭐field-wide 反擊那一份（已經存 iid）直接走同一份判準核心，不另寫第二份',
  count(effSrc, 'declarationHolderStillCounts(') === 1, String(count(effSrc, 'declarationHolderStillCounts(')));
chk('F6 ⭐持有者 iid 的收集器只有一份，且只在 engine 的 ATTACK 宣告點被呼叫一次',
  count(g3Src, 'export function collectAsOfDeclarationHolders(') === 1
  && count(engSrc, 'collectAsOfDeclarationHolders(state, 0, pool)') === 1
  && count(engSrc, 'collectAsOfDeclarationHolders(state, 1, pool)') === 1);
chk('F7 ⭐⭐Firestore 禁巢狀陣列：新欄位形狀是 { p1, p2 } 的物件 map，不是 tuple／T[][]',
  /_attackTimeHolders\?:\s*\{\s*p1:\s*Record<string,\s*string\[\]>;\s*p2:\s*Record<string,\s*string\[\]>;?\s*\}/.test(typSrc),
  (typSrc.match(/_attackTimeHolders\?:[^\n]*/) ?? ['(找不到)'])[0]);
chk('F8 ⭐`_attackTimeAttackerEnergyUnits`（太古防壁數值快照）刻意**不**接本述詞（官方判例，非本家族）',
  !/isEffectiveAsOfDeclaration\([^)]*_attackTimeAttackerEnergyUnits/.test(effSrc + engSrc)
  && asof.includes('_attackTimeAttackerEnergyUnits'));

// ══════════════════════════════════════════════════════════════════════════════
// 【G】(丁) C-14 過期註解 ＋ test-v6265 剝除鏈
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】⭐(丁) C-14：v6.351 那段「費用支付」註解已被 v6.367 證偽 ⇒ 改正');
chk('G1 ⭐engine.ts 不再出現被證偽的「（費用支付、旗標蓋章）動過」',
  !engSrc.includes('（費用支付、旗標蓋章）動過'));
chk('G2 ⭐改正後逐字：與 v6.367 的平行註解一致（「旗標蓋章之類」）＋ 標了 v6373 標記',
  engSrc.includes('//   （旗標蓋章之類）動過，整個覆蓋回去會把那些改動洗掉。 // ⭐v6373-c14-stale-comment')
  && engSrc.includes('PTCG 招式費用**不支付**、能量留在身上'));
chk('G3 ⭐事實複驗：engine.ts 全檔確實沒有任何「攻擊費用扣除」的實作（證偽的依據）',
  count(engSrc, 'payAttackCost') === 0 && count(engSrc, 'payCost') === 0);
const t6265 = readFileSync(join(ROOT, 'scripts/test-v6265-phantom-start-race.mjs'), 'utf8');
chk('G4 ⭐test-v6265 剝除鏈**最外層**是 stripV6373Engine（本版動到 engine.ts 的 BASE 既有行）',
  count(t6265, 'const stripV6373Engine = (src) =>') === 1
  && /stripV6373Engine\(stripV6369Engine\(/.test(t6265), String(count(t6265, 'const stripV6373Engine = (src) =>')));

// ══════════════════════════════════════════════════════════════════════════════
// 【H】HEAD-FAIL 對 BASE
// ══════════════════════════════════════════════════════════════════════════════
const BASE = process.env.V6373_BASE || BASE_SHA;
console.log(`\n【H】HEAD-FAIL：對 BASE(${BASE.slice(0, 8)} ＝ v6.372，本版的上一版) 重跑整個行為矩陣`);
if (!hasBaseCommit(ROOT, BASE)) {
  shallowSkip('【H】HEAD-FAIL 對 BASE 的重建比對', '【A】~【G】都不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  const r = restoreBaseSubtree(ROOT, BASE, baseSrc, 'src');
  if (chk('H0 BASE 樹重建成功（整個 src/ 子樹）', r.ok, r.reason ?? `replaced=${r.replaced} removed=${r.removed}`)) {
    const BMOD = await bundleFrom(baseSrc, 'base');
    const B = matrix(BMOD);
    chk('H1 哨兵：BASE bundle 是活的（哨兵情境照樣綠，不是整支爆掉造成的「全紅」）',
      B.noneDmg === SELF_DMG - HEAL && B.stayDmg === SELF_DMG && B.radaNoneDmg === 20,
      JSON.stringify({ none: B.noneDmg, stay: B.stayDmg, rada: B.radaNoneDmg, err: B.err }));
    chk('H2 ⭐⭐⭐(甲) BASE 一定要紅：持有者被**洗回牌庫**後，BASE 還在用快照把恢復擋下來',
      B.deckDmg === SELF_DMG && H.deckDmg === SELF_DMG - HEAL, `BASE=${B.deckDmg} HEAD=${H.deckDmg}`);
    chk('H3 ⭐⭐⭐(甲) BASE 一定要紅：持有者被**放回手牌**後同樣',
      B.handDmg === SELF_DMG && H.handDmg === SELF_DMG - HEAL, `BASE=${B.handDmg} HEAD=${H.handDmg}`);
    chk('H4 ⭐⭐零變更：昏厥離場（棄牌區）那一條 BASE 與 HEAD **必須一致**（收緊沒有波及裁定六-14）',
      B.discDmg === H.discDmg && H.discDmg === SELF_DMG, `BASE=${B.discDmg} HEAD=${H.discDmg}`);
    chk('H5 ⭐⭐零變更：花之帷幔（謝米被同招 KO ⇒ 備戰 0 點）BASE 與 HEAD 逐字相同',
      B.shayBench === H.shayBench && B.shayNoneBench === H.shayNoneBench,
      `BASE=${B.shayBench}/${B.shayNoneBench} HEAD=${H.shayBench}/${H.shayNoneBench}`);
    chk('H6 ⭐⭐零變更：站長 C-7 弱丁魚（+30、log 一行）BASE 與 HEAD 逐字相同',
      B.c7Atk === H.c7Atk && B.c7Logs === H.c7Logs && H.c7Atk === 30,
      `BASE=${B.c7Atk}/${B.c7Logs} HEAD=${H.c7Atk}/${H.c7Logs}`);
    chk('H7 ⭐⭐零變更：削落家族（千香果 20／奢華炸彈 20+0／英雄斗篷 20）BASE 與 HEAD 逐字相同',
      B.radaChikaDmg === H.radaChikaDmg && B.radaBombDmg === H.radaBombDmg
      && B.radaBombSelf === H.radaBombSelf && B.radaCapeDmg === H.radaCapeDmg && H.radaChikaDmg === 20,
      JSON.stringify([B.radaChikaDmg, B.radaBombDmg, B.radaBombSelf, B.radaCapeDmg]));
    const baseWide = (() => {
      let n = 0; const where = [];
      (function walk(d) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.ts')) { const k = wideHits(readFileSync(p, 'utf8')); if (k) { n += k; where.push(`${e.name}×${k}`); } }
        }
      })(baseSrc);
      return { n, where };
    })();
    chk('H8 ⭐(甲) 結構 BASE 一定要紅：BASE 的 src/ 恰好 4 處過寬的 `|| state._attackTime…`（全在 effects.ts），HEAD 0 處',
      baseWide.n === 4 && baseWide.where.length === 1 && baseWide.where[0].startsWith('effects.ts') && wideTotal === 0,
      `BASE=${baseWide.n} ${JSON.stringify(baseWide.where)} HEAD=${wideTotal}`);
    chk('H9 ⭐(丁) 結構 BASE 一定要紅：BASE 的 engine.ts 還留著被證偽的「（費用支付、旗標蓋章）動過」',
      readFileSync(join(baseSrc, 'lib/game/engine.ts'), 'utf8').includes('（費用支付、旗標蓋章）動過')
      && !engSrc.includes('（費用支付、旗標蓋章）動過'));
  }
}

console.log(`\n═══ v6.373 守衛：PASS ${pass} / FAIL ${fail} ═══`);
process.exit(fail === 0 ? 0 : 1);
