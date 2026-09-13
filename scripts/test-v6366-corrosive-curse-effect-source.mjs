// v6.366 守衛 —— 站長裁定 六-3：耿鬼ex（SV5K 047/071）｜侵蝕詛咒 是【特性】的效果，
//   卻一直走「招式效果」管線（kind:'attack-effect'）。
//
// 站長裁定逐字：
//   「耿鬼ex（SV5K）｜侵蝕詛咒 的同病灶，另開一版來修」
//   （同病灶＝v6.358 站長裁定 D-9：「『招式』的效果」免疫不該擋住「『特性』的效果」）
//
// 卡面（static/cards，逐字錨在【E】）：
//   侵蝕詛咒（特性）：「只要這隻寶可夢在場上，每次對手從手牌將能量卡附於寶可夢身上時，
//                     在那隻寶可夢身上放置2個傷害指示物。」
//
// ⚠ 待站長裁示（見本版回報 §8）：v6.358 的 EFFECT_SOURCE_IMMUNITY 目前**只**驅動
//   `canApplyAttackEffectToTarget`（＝ kind==='attack-effect' 與 koTargetByAttackEffect 那條路），
//   「特性效果」這一維實際上是由 DamageKind 的 'ability-effect' 分派決定的（20 餘個既有特性
//   呼叫端都是這樣）。本版**沒有**把兩者合併 —— 試過之後 test-v6255 的
//   「自己這一側的化隱持有者不該被自己的 ability-effect 擋」會翻紅（見回報 §3/§8）。
//
// ⚠ 本檔全部是**行為端**斷言（盤面 damage / KO / log），旗標與字串層一律標「補充」（安慰劑 #28）。
// ⚠ 沒有恆真斷言（#27）；沒有用 `||` 放寬（#26）：每一條都是 === 到具體數字。
// ⚠【E】卡面逐字錨自帶掃描器自驗：故意弄髒的 face 必須抓不到，否則整組 face 斷言是恆真。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6366-s.js'), E = join(ROOT, '.v6366-e.ts'), O = join(ROOT, '.v6366-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
  + "export { dealAttackDamageToTarget, EFFECT_SOURCE_IMMUNITY, effectSourceBlocks,\n"
  + "         OPP_ENERGY_ATTACH_PASSIVE } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, dealAttackDamageToTarget, EFFECT_SOURCE_IMMUNITY, effectSourceBlocks,
        OPP_ENERGY_ATTACH_PASSIVE } = M;

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); all.push(c);
  }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('卡池抓不到 ' + n); return c; };

const GENG  = byId('9817');    // 耿鬼ex   SV5K 047/071 HP310 Stage2【惡】ex ｜侵蝕詛咒（本版主角）
const PIXI  = byId('18007');   // 超級皮可西ex M3 HP320 ｜光之翼（只寫「特性」）
const BUG   = byId('9856');    // 蟲甲聖   SV5M Stage1 ｜球形盾牌（只寫「招式」，自方備戰）
const SUMO  = byId('10255');   // 斯魔茶   SV5a Basic  ｜藏隱  （只寫「招式」，備戰自身）
const KOI   = byId('12683');   // 小霞的鯉魚王 SV9a Basic ｜深度下潛（只寫「招式」，備戰自身）
const ROCK  = byId('14694');   // 火箭隊的急凍鳥 M2a Basic ｜抵抗之幕（只寫「招式」）
const DOLL  = byId('19175');   // 怨影娃娃  M5 Basic ｜化隱（C 類：「招式**與**特性」）
const KURE  = byId('10428');   // 來悲粗茶  SV6 Stage1 ｜詛咒水滴 ＝ **真的招式效果**（4 個指示物）
const ARENA = byName('對戰圓形競技場');

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;

const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');
/** 對【惡】有弱點×2、沒特性 ⇒ 用來證明「指示物**不**算弱點」 */
const WEAK = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && c.weakness?.type === 'Darkness' && c.weakness?.value === '×2' && Number(c.hp) >= 110);
/** 對【惡】沒有弱點、沒特性、HP 夠高（吃得下 20/40 不昏厥） */
const TOUGH = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && c.weakness?.type && c.weakness.type !== 'Darkness' && Number(c.hp) >= 200);

let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({
  name: 'P', active: null, bench: [], hand: [], deck: [], discard: [],
  prizes: [], abilityNamesUsedThisTurn: [], ...o,
});
const prizes = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P({ name: 'A', deck: [inst(PLAIN.id), inst(PLAIN.id)], prizes: prizes(6), ...p0 }),
            P({ name: 'B', deck: [inst(PLAIN.id), inst(PLAIN.id)], prizes: prizes(6), ...p1 })],
  ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c === true) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const LOGS = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l?.text ?? l));
/** p0 場上這個 iid 現在的 damage；已離場回 'KO' */
const dmg0 = (r, iid) => {
  const p = r.players[0];
  const hit = [...(p.active ? [p.active] : []), ...p.bench].find((c) => c.iid === iid);
  return hit ? hit.damage : 'KO';
};

// ── 共用盤面 ────────────────────────────────────────────────────────────────
/**
 * 主情境：p0（我方）從手牌附 1 張能量；p1（對手）場上有 耿鬼ex｜侵蝕詛咒。
 * defBench[pick] 或 defActive 就是被附能、也就是被放指示物的那一隻。
 * @returns { damage, logs }
 */
function attach({ a, b = [], pick = 'active', gengAt = 'active', extra = {} }) {
  const e = inst(EID.Water);
  const g = gengAt === 'none' ? inst(PLAIN.id) : inst(GENG.id);
  const st = mk(
    { active: a, bench: b, hand: [e] },
    gengAt === 'bench' ? { active: inst(PLAIN.id), bench: [g] } : { active: g },
    extra);
  const t = pick === 'active' ? st.players[0].active : st.players[0].bench[pick];
  const out = applyAction(st, { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: t.iid }, pool);
  return { damage: dmg0(out, t.iid), logs: LOGS(out) };
}

/**
 * 哨兵（**真的招式效果**）：p1 的 來悲粗茶 使出「詛咒水滴」，把 4 個指示物全放在同一隻
 * p0 寶可夢身上（＝ dealAttackDamageToTarget kind:'attack-effect'）。盤面與 attach() 同構。
 */
function curseDrop({ a, b = [], pick = 'active', extra = {} }) {
  const st = mk({ active: a, bench: b },
    { active: inst(KURE.id, { energyAttached: [inst(EID.Grass)] }), bench: [inst(PLAIN.id)] },
    { activePlayerIndex: 1, ...extra });
  const t = pick === 'active' ? st.players[0].active : st.players[0].bench[pick];
  const ai = (KURE.attacks || []).findIndex((x) => x.name === '詛咒水滴');
  let r = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool);
  if (!r.pendingSelection) return { damage: 'NO-PENDING', logs: LOGS(r) };
  r = applyAction(r, { type: 'RESOLVE_SELECTION', effectKey: r.pendingSelection.effectKey,
    selectedIids: [t.iid, t.iid, t.iid, t.iid], actorIdx: 1 }, pool);
  return { damage: dmg0(r, t.iid), logs: LOGS(r) };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】harness 自驗（fixture 抓錯 ⇒ 後面全是假綠）');
{
  chk('0a 耿鬼ex＝SV5K 047/071、HP310、Stage2、【惡】、ex、印著「侵蝕詛咒」',
    String(GENG.setCode) === 'SV5K' && String(GENG.collectorNumber) === '047/071'
    && Number(GENG.hp) === 310 && GENG.stage === 'Stage2' && GENG.pokemonType === 'Darkness'
    && GENG.subtype === 'ex' && (GENG.abilities || []).some((x) => x.name === '侵蝕詛咒'),
    JSON.stringify([GENG.setCode, GENG.collectorNumber, GENG.hp, GENG.stage, GENG.pokemonType, GENG.subtype]));
  chk('0b ⭐侵蝕詛咒登記在 OPP_ENERGY_ATTACH_PASSIVE（掛錯 map ⇒ 整支不會觸發）',
    OPP_ENERGY_ATTACH_PASSIVE.has('侵蝕詛咒'), JSON.stringify([...OPP_ENERGY_ATTACH_PASSIVE.keys()]));
  chk('0c ⭐侵蝕詛咒的卡面 label 是「特性」（本版整支裁定的前提）',
    (GENG.abilities || []).find((x) => x.name === '侵蝕詛咒')?.label === '特性',
    String((GENG.abilities || []).find((x) => x.name === '侵蝕詛咒')?.label));
  chk('0d 五張免疫卡 fixture 都抓得到且印著該特性',
    (PIXI.abilities || []).some((x) => x.name === '光之翼')
    && (BUG.abilities || []).some((x) => x.name === '球形盾牌')
    && (SUMO.abilities || []).some((x) => x.name === '藏隱')
    && (KOI.abilities || []).some((x) => x.name === '深度下潛')
    && (ROCK.abilities || []).some((x) => x.name === '抵抗之幕')
    && (DOLL.abilities || []).some((x) => x.name === '化隱'),
    JSON.stringify([PIXI.name, BUG.name, SUMO.name, KOI.name, ROCK.name, DOLL.name]));
  chk('0e 來悲粗茶｜詛咒水滴 抓得到（本檔「真的招式效果」哨兵）',
    (KURE.attacks || []).some((x) => x.name === '詛咒水滴') && KURE.pokemonType === 'Grass',
    JSON.stringify((KURE.attacks || []).map((x) => x.name)));
  chk('0f 弱點 fixture：找得到對【惡】弱點×2 的【基礎】寶可夢（＝耿鬼ex 的屬性）',
    !!WEAK && WEAK.weakness.type === 'Darkness' && WEAK.weakness.value === '×2'
    && Number(WEAK.hp) >= 110, JSON.stringify([WEAK?.name, WEAK?.hp, WEAK?.weakness]));
  chk('0g 中立 fixture：TOUGH 對【惡】沒弱點、HP ≥ 200；PLAIN 抓得到',
    !!TOUGH && TOUGH.weakness.type !== 'Darkness' && Number(TOUGH.hp) >= 200 && !!PLAIN,
    JSON.stringify([TOUGH?.name, TOUGH?.hp, TOUGH?.weakness?.type, PLAIN?.name]));
  chk('0h 能量 id 查得到（硬編會讓 ATTACH/ATTACK 靜默 return ⇒ 假綠）',
    !!EID.Water && !!EID.Grass && !!EID.Darkness, JSON.stringify(EID));
  chk('0i 對戰圓形競技場 抓得到（【C】的「不該變」對照）', !!ARENA && ARENA.subtype === 'Stadium',
    JSON.stringify([ARENA?.name, ARENA?.subtype]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐基準：對手從手牌附能 ⇒ 侵蝕詛咒在那隻身上放 2 個指示物（＝20 點）');
{
  const hit  = attach({ a: inst(TOUGH.id) });
  const none = attach({ a: inst(TOUGH.id), gengAt: 'none' });
  const ben  = attach({ a: inst(TOUGH.id), gengAt: 'bench' });

  chk('A1 ⭐附能後那隻身上 2 個傷害指示物 ＝ damage 20', hit.damage === 20, String(hit.damage));
  chk('A2 哨兵：對手場上**沒有**侵蝕詛咒 ⇒ damage 0（fixture 不是自己會長指示物）',
    none.damage === 0, String(none.damage));
  chk('A3 侵蝕詛咒持有者在【備戰】也照樣觸發（卡面「只要這隻寶可夢在場上」）',
    ben.damage === 20, String(ben.damage));
  chk('A4 ⭐log 逐字寫出「侵蝕詛咒」（沒 log ⇒ 玩家看不到發生什麼事）',
    hit.logs.filter((x) => x.includes('侵蝕詛咒')).length === 1,
    JSON.stringify(hit.logs.filter((x) => x.includes('侵蝕詛咒'))));
  chk('A5 哨兵：沒有侵蝕詛咒時 log 裡不該出現它',
    none.logs.filter((x) => x.includes('侵蝕詛咒')).length === 0,
    JSON.stringify(none.logs.filter((x) => x.includes('侵蝕詛咒'))));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐⭐站長裁定主軸之一：【光之翼】（只寫「特性」）**應該**擋住侵蝕詛咒');
{
  const blocked = attach({ a: inst(PIXI.id) });                 // 目標印著 光之翼
  const ctrl    = attach({ a: inst(TOUGH.id) });                // 正對照：同盤面沒有 光之翼
  const atkDim  = curseDrop({ a: inst(PIXI.id) });              // 招式那一維：光之翼 不該擋
  const atkCtrl = curseDrop({ a: inst(TOUGH.id) });

  chk('B1 ⭐⭐侵蝕詛咒（特性效果）被 光之翼 擋下 ⇒ damage 0', blocked.damage === 0, String(blocked.damage));
  chk('B2 ⭐正對照：同盤面換成沒有光之翼的寶可夢 ⇒ 照樣中 20', ctrl.damage === 20, String(ctrl.damage));
  chk('B3 ⭐log 要寫出「光之翼」為什麼不受影響',
    blocked.logs.filter((x) => x.includes('光之翼')).length === 1,
    JSON.stringify(blocked.logs.filter((x) => x.includes('光之翼'))));
  chk('B4 ⭐招式那一維不變：真的招式效果（詛咒水滴 4 個指示物）打光之翼 ⇒ 照樣中 40',
    atkDim.damage === 40, String(atkDim.damage));
  chk('B4 哨兵：同一招打沒有光之翼的寶可夢也是 40（招式哨兵本身有效）',
    atkCtrl.damage === 40, String(atkCtrl.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐⭐四張「卡面只寫招式」的免疫 ⇒ 不再擋侵蝕詛咒；招式那一維逐張哨兵');
{
  // 每一筆：[名稱, 附能盤面, 招式哨兵盤面]
  const CASES = [
    ['C1 球形盾牌（蟲甲聖：自己的所有備戰）',
      { a: inst(TOUGH.id), b: [inst(TOUGH.id), inst(BUG.id)], pick: 0 }],
    ['C2 藏隱（斯魔茶：備戰自身）',
      { a: inst(TOUGH.id), b: [inst(SUMO.id)], pick: 0 }],
    ['C3 深度下潛（小霞的鯉魚王：備戰自身）',
      { a: inst(TOUGH.id), b: [inst(KOI.id)], pick: 0 }],
    ['C4 抵抗之幕（火箭隊的急凍鳥：戰鬥位，走 canApplyAttackEffectToTarget 分支）',
      { a: inst(ROCK.id) }],
    ['C5 抵抗之幕（火箭隊的急凍鳥：備戰，走 resolveBenchGuard 分支）',
      { a: inst(TOUGH.id), b: [inst(ROCK.id)], pick: 0 }],
    ['C6 躲藏／飛翔／要害斬 類 per-turn 旗標 immuneToAllAttackThisTurn（卡面只寫「招式」）',
      { a: inst(TOUGH.id, { immuneToAllAttackThisTurn: true }) }],
    ['C7 純樸 類 per-turn 旗標 immuneToAttackEffectsThisTurn（卡面只寫「招式」）',
      { a: inst(TOUGH.id, { immuneToAttackEffectsThisTurn: true }) }],
  ];
  for (const [name, board] of CASES) {
    const ability = attach({ ...board });
    const attack  = curseDrop({ ...board });
    chk(`${name} ⇒ 侵蝕詛咒（特性）**不再**被擋，damage 20`, ability.damage === 20, String(ability.damage));
    chk(`${name} ⭐哨兵：同盤面換成真的招式效果（詛咒水滴）⇒ **照舊擋住**，damage 0`,
      attack.damage === 0, String(attack.damage));
  }
}

console.log('\n【C-fix】不該變的那幾維（改錯邊就會紅）');
{
  const hy      = attach({ a: inst(DOLL.id) });                       // 化隱：C 類，兩種來源都擋
  const hyAtk   = curseDrop({ a: inst(DOLL.id) });
  const arena   = attach({ a: inst(TOUGH.id), b: [inst(TOUGH.id)], pick: 0,
    extra: { activeStadium: inst(ARENA.id), activeStadiumOwnerIdx: 0 } });
  const arenaC  = attach({ a: inst(TOUGH.id), b: [inst(TOUGH.id)], pick: 0 });

  chk('C8 ⭐化隱（卡面「招式**與**特性」）⇒ 侵蝕詛咒照樣被擋，damage 0', hy.damage === 0, String(hy.damage));
  chk('C8 哨兵：化隱對真的招式效果也照樣擋，damage 0', hyAtk.damage === 0, String(hyAtk.damage));
  chk('C9 ⭐對戰圓形競技場（卡面「招式**與**特性」+備戰放指示物）⇒ 照樣擋，damage 0',
    arena.damage === 0, String(arena.damage));
  chk('C9 正對照：把競技場拿掉 ⇒ 同盤面照樣中 20', arenaC.damage === 20, String(arenaC.damage));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐卡面是「放置 2 個傷害指示物」＝ flat 20：不算弱點／抵抗力／減傷');
{
  const weakHit  = attach({ a: inst(WEAK.id) });                              // 目標對【惡】弱點×2
  const plainHit = attach({ a: inst(TOUGH.id) });
  const redHit   = attach({ a: inst(TOUGH.id, { damageReduceNextHit: 10 }) }); // 下次被擊減傷 10

  chk(`D1 ⭐⭐目標對【惡】有弱點×2（${WEAK.name}）⇒ 仍然只放 20（不是 40）`,
    weakHit.damage === 20, String(weakHit.damage));
  chk('D2 對照：目標對【惡】沒有弱點 ⇒ 也是 20', plainHit.damage === 20, String(plainHit.damage));
  chk('D3 ⭐防守方「下次被擊減傷 10」⇒ 指示物不吃減傷，仍然 20', redHit.damage === 20, String(redHit.damage));

  // ⭐ 控制組：同一塊盤面、同一個中央入口、同一個數字 20，只把 kind 換成「招式的傷害」
  //    ⇒ 必須變成 40 / 10。這一組證明「弱點與減傷 fixture 是真的會生效的」，
  //    沒有它，D1/D3 就會是「因為這盤面本來就沒弱點」的恆真斷言（安慰劑 #27）。
  const probe = (defInst, kind) => {
    const st = mk({ active: defInst },
      { active: inst(GENG.id, { energyAttached: [inst(EID.Darkness), inst(EID.Darkness)] }) });
    const t = st.players[0].active;
    return dmg0(dealAttackDamageToTarget(st, 1, t.iid, 20, pool, { kind, label: 'D-probe' }), t.iid);
  };
  chk('D4 ⭐控制組：同盤面同數字，kind=\'attack-damage\' ⇒ 弱點×2 生效 = 40',
    probe(inst(WEAK.id), 'attack-damage') === 40, String(probe(inst(WEAK.id), 'attack-damage')));
  chk('D4 ⭐控制組：同盤面同數字，kind=\'ability-effect\' ⇒ 不算弱點 = 20',
    probe(inst(WEAK.id), 'ability-effect') === 20, String(probe(inst(WEAK.id), 'ability-effect')));
  chk('D5 ⭐控制組：減傷 10 在 kind=\'attack-damage\' 下真的會扣 = 10',
    probe(inst(TOUGH.id, { damageReduceNextHit: 10 }), 'attack-damage') === 10,
    String(probe(inst(TOUGH.id, { damageReduceNextHit: 10 }), 'attack-damage')));
  chk('D5 ⭐控制組：同一個減傷盤面在 kind=\'ability-effect\' 下不扣 = 20',
    probe(inst(TOUGH.id, { damageReduceNextHit: 10 }), 'ability-effect') === 20,
    String(probe(inst(TOUGH.id, { damageReduceNextHit: 10 }), 'ability-effect')));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】卡面逐字錨（static/cards；卡面改版／抓錯印刷會紅）');
{
  const abFace = (card, name) => (card.abilities || []).find((x) => x.name === name)?.effect;
  const FACES = [
    ['侵蝕詛咒', GENG, '侵蝕詛咒',
      '只要這隻寶可夢在場上，每次對手從手牌將能量卡附於寶可夢身上時，在那隻寶可夢身上放置2個傷害指示物。'],
    ['光之翼', PIXI, '光之翼', '這隻寶可夢不會受到對手的寶可夢特性效果的影響。'],
    ['球形盾牌', BUG, '球形盾牌', '只要這隻寶可夢在場上，自己的所有備戰寶可夢不會受到對手的寶可夢招式的傷害與效果的影響。'],
    ['藏隱', SUMO, '藏隱', '只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。'],
    ['深度下潛', KOI, '深度下潛', '只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。'],
    ['抵抗之幕', ROCK, '抵抗之幕',
      '只要這隻寶可夢在場上，自己的場上所有【基礎】寶可夢的「火箭隊的寶可夢」，不會受到對手的寶可夢使用招式的效果的影響。（已經受到的效果不會消除。）'],
    ['化隱', DOLL, '化隱', '這隻寶可夢不會受到對手的招式與特性的效果的影響。'],
  ];
  for (const [tag, card, member, face] of FACES) {
    chk(`E ${tag}（${card.name}）卡面逐字`, abFace(card, member) === face, JSON.stringify(abFace(card, member)));
  }
  // 掃描器自驗：弄髒一個字 ⇒ 必須抓不到（否則整組 face 斷言是恆真）
  chk('E* 掃描器自驗：故意弄髒的 face 必須比對失敗',
    abFace(GENG, '侵蝕詛咒') !== '只要這隻寶可夢在場上，每次對手從手牌將能量卡附於寶可夢身上時，在那隻寶可夢身上放置3個傷害指示物。',
    'dirty face 竟然比中了');
  // 卡面關鍵字 ⇔ EFFECT_SOURCE_IMMUNITY 分類（補充；行為端已由 B/C 釘住）
  chk('E+ 補充：光之翼卡面含「特性」且不含「招式」⇒ 它只該擋特性那一維',
    abFace(PIXI, '光之翼').includes('特性') && !abFace(PIXI, '光之翼').includes('招式'),
    abFace(PIXI, '光之翼'));
  chk('E+ 補充：球形盾牌／藏隱／深度下潛／抵抗之幕 卡面都含「招式」且都不含「特性」',
    [[BUG, '球形盾牌'], [SUMO, '藏隱'], [KOI, '深度下潛'], [ROCK, '抵抗之幕']]
      .every(([c, m]) => abFace(c, m).includes('招式') && !abFace(c, m).includes('特性')),
    JSON.stringify([[BUG, '球形盾牌'], [SUMO, '藏隱'], [KOI, '深度下潛'], [ROCK, '抵抗之幕']]
      .filter(([c, m]) => !abFace(c, m).includes('招式') || abFace(c, m).includes('特性')).map(([, m]) => m)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】⭐中央性：侵蝕詛咒沒有自己的私有判準／旁路，走的就是既有的特性效果中央入口');
{
  // ⭐⭐ 行為端：把 9 種免疫盤面各跑兩次 ——
  //   (i) 真的從手牌附能（走 engine ATTACH_ENERGY → fireOnHandEnergyAttached → 侵蝕詛咒）
  //   (ii) 直接呼叫中央入口 dealAttackDamageToTarget(kind:'ability-effect')
  //   兩排必須**逐格相同**。任何「只對侵蝕詛咒生效的特例」都會讓某一格對不上。
  const BOARDS = [
    ['無免疫(戰鬥位)', () => ({ a: inst(TOUGH.id), b: [], pick: 'active' })],
    ['無免疫(備戰)', () => ({ a: inst(TOUGH.id), b: [inst(TOUGH.id)], pick: 0 })],
    ['光之翼', () => ({ a: inst(PIXI.id), b: [], pick: 'active' })],
    ['化隱', () => ({ a: inst(DOLL.id), b: [], pick: 'active' })],
    ['球形盾牌', () => ({ a: inst(TOUGH.id), b: [inst(TOUGH.id), inst(BUG.id)], pick: 0 })],
    ['藏隱', () => ({ a: inst(TOUGH.id), b: [inst(SUMO.id)], pick: 0 })],
    ['深度下潛', () => ({ a: inst(TOUGH.id), b: [inst(KOI.id)], pick: 0 })],
    ['抵抗之幕(戰鬥位)', () => ({ a: inst(ROCK.id), b: [], pick: 'active' })],
    ['抵抗之幕(備戰)', () => ({ a: inst(TOUGH.id), b: [inst(ROCK.id)], pick: 0 })],
  ];
  const viaCard = [], viaCentral = [], viaAttackKind = [];
  for (const [, mkBoard] of BOARDS) {
    viaCard.push(attach({ ...mkBoard() }).damage);
    for (const [kind, sink] of [['ability-effect', viaCentral], ['attack-effect', viaAttackKind]]) {
      const cfg = mkBoard();
      const st = mk({ active: cfg.a, bench: cfg.b }, { active: inst(GENG.id) });
      const t = cfg.pick === 'active' ? st.players[0].active : st.players[0].bench[cfg.pick];
      sink.push(dmg0(dealAttackDamageToTarget(st, 1, t.iid, 20, pool, { kind, label: '侵蝕詛咒' }), t.iid));
    }
  }
  chk('F1 ⭐⭐9 種免疫盤面：真的附能 vs 直接呼叫中央入口(ability-effect) 逐格相同（沒有私有旁路）',
    JSON.stringify(viaCard) === JSON.stringify(viaCentral),
    JSON.stringify({ 附能: viaCard, 中央: viaCentral, 盤面: BOARDS.map(([n]) => n) }));
  chk('F2 ⭐非恆真對照：同一批盤面改用 kind=\'attack-effect\' ⇒ 至少 6 格不同（比對有鑑別力）',
    viaCard.filter((v, i) => v !== viaAttackKind[i]).length >= 6,
    JSON.stringify({ ability: viaCard, attack: viaAttackKind }));
  chk('F3 ⭐附能那一排的具體數字（盤面 fixture 沒壞）',
    JSON.stringify(viaCard) === JSON.stringify([20, 20, 0, 0, 20, 20, 20, 20, 20]),
    JSON.stringify(viaCard));

  // 補充（行為端已由 F1–F3 與 B/C/D 釘住）
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const def = readFileSync(join(ROOT, 'src/lib/game/defense.ts'), 'utf8');
  // defense.ts 的 JSDoc 會把「侵蝕詛咒」當成 'ability-effect' 的例子列出來（那是文件，不是特例）；
  // 這裡要求的是：**程式碼行**裡不准出現這個名字（卡名特例 bypass 一定寫在程式碼行）。
  const defCodeHits = def.split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && l.includes('侵蝕詛咒'));
  chk('F4 補充：defense.ts（免疫總閘）的**程式碼行**沒有出現「侵蝕詛咒」⇒ 沒有卡名特例',
    defCodeHits.length === 0, JSON.stringify(defCodeHits));
  const effGuardSection = eff.slice(eff.indexOf('export function resolveBenchGuard'),
    eff.indexOf('// SPECIAL_ENERGY_ATTACH 和 AttachEnergyHookFn 已搬到 _shared.ts'));
  const effGuardHits = effGuardSection.split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && l.includes('侵蝕詛咒'));
  chk('F4b 補充：resolveBenchGuard 整段的程式碼行也沒有卡名特例',
    effGuardSection.length > 500 && effGuardHits.length === 0,
    JSON.stringify([effGuardSection.length, effGuardHits]));
  const srcFiles = [];
  (function walk(d) {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|svelte|js)$/.test(ent.name)) srcFiles.push(p);
    }
  })(join(ROOT, 'src'));
  const readers = srcFiles.filter((p) => /EFFECT_SOURCE_IMMUNITY\s*\.\s*(get|has|forEach)\b/.test(readFileSync(p, 'utf8')));
  const readCount = srcFiles.reduce((n, p) =>
    n + ((readFileSync(p, 'utf8').match(/EFFECT_SOURCE_IMMUNITY\s*\.\s*(get|has|forEach)\b/g) || []).length), 0);
  chk('F5 補充：全 src 只有 1 處讀 EFFECT_SOURCE_IMMUNITY（＝effectSourceBlocks；本版沒開第二份判準）',
    readCount === 1 && readers.length === 1 && readers[0].endsWith('effects.ts'),
    JSON.stringify([readCount, readers.map((p) => p.replace(ROOT, ''))]));
  chk('F6 補充：effectSourceBlocks 對 A 類／C 類／查無登記（fail-closed）的回答',
    effectSourceBlocks('抵抗之幕', 'attack') === true
    && effectSourceBlocks('抵抗之幕', 'ability') === false
    && effectSourceBlocks('化隱', 'attack') === true
    && effectSourceBlocks('化隱', 'ability') === true
    && effectSourceBlocks('查無此登記XYZ', 'ability') === true,
    JSON.stringify([effectSourceBlocks('抵抗之幕', 'ability'), effectSourceBlocks('化隱', 'ability')]));
  chk('F7 補充：侵蝕詛咒走的是**既有**的 \'ability-effect\'，DamageKind 沒有新增第四種值',
    eff.includes("dealAttackDamageToTarget(state, gIdx, targetIid, 20, pool, { kind: 'ability-effect', label: '侵蝕詛咒' })")
    && (eff.match(/export type DamageKind = 'attack-damage' \| 'attack-effect' \| 'ability-effect';/g) || []).length === 1,
    'kind 或 DamageKind 定義不如預期');
  chk('F8 補充：EFFECT_SOURCE_IMMUNITY 的【抵抗之幕】仍登記為 A 類（本版沒有改動這張表）',
    JSON.stringify(EFFECT_SOURCE_IMMUNITY.get('抵抗之幕')?.blocks) === '["attack"]',
    JSON.stringify(EFFECT_SOURCE_IMMUNITY.get('抵抗之幕')));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n═══ v6.366 守衛：${pass} 綠 / ${fail} 紅 ═══`);
process.exit(fail === 0 ? 0 : 1);
