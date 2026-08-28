/**
 * v2.999 Group 3 Wave 1 — 10 張條件 +HP / +傷害 / -傷害 / 屬性切換類 passive 特性
 *
 * 來源：ABILITY_AUDIT_V2_98.md Group 3 Wave 1。
 *
 * 實裝分布：
 *   A. 條件式 +max HP / +傷害（4 張）
 *      1. 夠讚狗｜腎上腺力量    — getEffectiveHP +100 / PASSIVE_ATTACK_BONUS +100
 *         （早於本波由 v2.122 與 engine.ts inline 完成 — 本檔不重複實裝，只列在文件追溯）
 *      2. 怖納噬草｜雜草魂      — getEffectiveHP × 對手已取獎賞 ×50（早於本波在
 *         engine.ts getEffectiveHP 完成 — 本檔不重複實裝）
 *      3. 修建老匠｜大師工藝    — getEffectiveHP × 自身【鬥】能量 ×40（早於本波在
 *         engine.ts getEffectiveHP 完成 — 本檔不重複實裝）
 *      4. 棄世猴｜憤怒穴        — PASSIVE_ATTACK_BONUS 條件式 +120（本波新實裝）
 *
 *   B. 攻擊端 +N 傷害 buff（2 張）
 *      5. 肋骨海龜｜原始心得    — PASSIVE_ATTACK_BONUS 對對手「戰鬥場進化寶可夢」+30（本波新實裝）
 *      6. 裙兒小姐｜大晴天      — PASSIVE_ATTACK_BONUS 自方【草】/【火】寶可夢 +20（本波新實裝）
 *
 *   C. 屬性切換（1 張）
 *      7. 鐵轍跡｜二重核心      — 改 effective types 為【鬥】+【鋼】（本波新實裝；
 *         engine.ts attackerEffectiveTypes 計算中已加閘門，呼叫 hasIronTracksDualCore helper）
 *
 *   D. 自方寶可夢受傷 -N（3 張）
 *      8. 大吾的小碎鑽｜岩石宮殿 — 在備戰時自方「大吾的」寶可夢受招式傷害 -30
 *         （卡面明文「不重複」— 場上多隻只 -30 一次）— inline 在 engine.ts 套用
 *      9. 青銅鐘｜守護之鐘      — 自方所有寶可夢受招式傷害 -10
 *         （卡面未寫不重複，但保守按 has-not-count 不疊加，避免濫用）— inline
 *     10. 齒輪怪｜齒輪塗層      — 自方所有附【鋼】能量寶可夢受招式傷害 -20
 *         （同樣保守 has-not-count 不疊加）— inline
 *
 * 設計：
 *   - 本檔集中提供 helper（hasFieldAbility / damageReducerForDefender 等）讓
 *     engine.ts 與 effects.ts 引用，避免邏輯散落在多處。
 *   - 「+N 傷害」走 effects.ts 既有的 PASSIVE_ATTACK_BONUS Map（在這裡 .set）。
 *   - 「-N 受傷」inline 寫在 engine.ts 的 damage pipeline（與爆炸頭水牛 / 灰塵山 /
 *     冰雪巨龍 同模式），但條件 helper 從本檔 import。
 *   - 屬性切換改在 engine.ts attackerEffectiveTypes 計算端，調用本檔 helper。
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import { isAbilityHolderEffective } from './v3001_g3_wave3';
import type { Card } from '$lib/cards/types';
import { PASSIVE_ATTACK_BONUS } from '../../effects';
import { ROCKET_WATCHTOWER_STADIUMS } from './stadiums';

// 導出 sentinel 防止 unused import warnings
export type _v2999G3W1Sentinel = PlayerState | GameState | Card | CardInstance;

// ════════════════════════════════════════════════════════════════════════════
// 共用 helper：場上 ability holder 偵測
// ════════════════════════════════════════════════════════════════════════════

/**
 * 是否「玩家 idx 場上（active+bench）」有任何寶可夢具有指定 ability 名稱。
 * 用於團體 buff/debuff 的「場上有 1+」型條件判斷。
 */
function hasAbilityOnSide(
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
  abilityName: string,
): boolean {
  if (!state || ownerIdx == null || !pool) return false;
  const owner = state.players[ownerIdx];
  const all = [...(owner.active ? [owner.active] : []), ...owner.bench];
  return all.some(c => {
    const card = pool.get(c.cardId);
    return card?.abilities?.some(a => a.name === abilityName);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// A4. 棄世猴｜憤怒穴
//
// 卡面：「若這隻寶可夢身上放置有 2 個以上的傷害指示物，則這隻寶可夢使用的招式，
//        對對手的戰鬥寶可夢造成的傷害『+120』點。」
//
// 條件：身上 ≥ 2 個傷害指示物（damage ≥ 20，因 1 指示物 = 10 傷害）。
//   - att.name === '棄世猴' gate：只有棄世猴自己攻擊時才生效。
//   - PASSIVE_ATTACK_NO_STACK 不需加，因為「這隻寶可夢使用的招式」本身就是
//     attacker self-gate；就算備戰另有棄世猴，gate 仍只觸發一次（attackerCard
//     永遠是攻擊發動者本人）。
// ════════════════════════════════════════════════════════════════════════════
// 棄世猴｜憤怒穴 — 已搬到 registerV2999G3W1Passives()，避免 ESM TDZ

// ════════════════════════════════════════════════════════════════════════════
// B5. 肋骨海龜｜原始心得
//
// 卡面：「只要這隻寶可夢在場上，自己的寶可夢使用的招式，
//        對對手的戰鬥場的進化寶可夢造成的傷害『+30』點。」
//
// 範圍：
//   - 主語=自方「所有」攻擊者（不限肋骨海龜本人）→ 不需 NO_STACK，per-source
//     疊加（場上 N 隻肋骨海龜會貢獻 +30×N，與輝煌聲援同模式）。
//   - 對象 gate：對手戰鬥位寶可夢必須是「進化寶可夢」（evolvesFrom 有值或
//     stage = Stage1/Stage2）。
//
// 註：engine 在「攻擊方場上每張卡」上 invoke fn，attackerCard=發動者本人。
//   只要場上有肋骨海龜（即此 fn 被 invoke 一次），條件成立就 +30。
// ════════════════════════════════════════════════════════════════════════════
// 肋骨海龜｜原始心得 — 已搬到 registerV2999G3W1Passives()，避免 ESM TDZ

// ════════════════════════════════════════════════════════════════════════════
// B6. 裙兒小姐｜大晴天
//
// 卡面：「只要這隻寶可夢在場上，自己的【草】或者【火】寶可夢使用的招式，
//        對對手的戰鬥寶可夢造成的傷害『+20』點。」
//
// 範圍：
//   - 主語=自方「所有【草】或【火】寶可夢」→ 與輝煌聲援/力之鹽同模式，
//     per-source 疊加（場上 2 隻裙兒小姐就 +40）。
//   - attacker.pokemonType in {Grass, Fire} 才生效。
// ════════════════════════════════════════════════════════════════════════════
// 裙兒小姐｜大晴天 — 已搬到 registerV2999G3W1Passives()，避免 ESM TDZ

// ════════════════════════════════════════════════════════════════════════════
// C7. 鐵轍跡｜二重核心
//
// 卡面：「只要這隻寶可夢身上附有「驅勁能量 未來」，這隻寶可夢改為【鬥】與【鋼】
//        2 種屬性。」
//
// 範圍：影響弱點 / 抵抗力等屬性比對；engine.ts attackerEffectiveTypes 在計算
//   攻擊者有效屬性時呼叫此 helper。
// 條件：身上 energyAttached 中有任意 cardId 對應卡名 === '驅勁能量 未來'。
// ════════════════════════════════════════════════════════════════════════════
export function hasIronTracksDualCore(
  /** ⭐ v6.204：新增 state/ownerIdx —— 「二重核心」也是 passive 特性，會被消除。 */
  state: GameState | undefined,
  ownerIdx: 0 | 1 | undefined,
  inst: CardInstance | null | undefined,
  card: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): boolean {
  if (!inst || !card || !pool) return false;
  if (card.name !== '鐵轍跡') return false;
  // ⭐ v6.204：鐵轍跡 = Basic /【鋼】/ **非規則寶可夢** ⇒ 熔岩洞（只消進化）、監視塔（只消【無】）、
  //   初始化（只消「擁有規則的寶可夢」）、黏著束縛（只消備戰【2階進化】）**全部打不到**；
  //   打得到的只有**招式版暗夜羽擊**與 **passive 振翼髮｜暗夜羽擊**（都只作用於戰鬥場）。
  //   ⚠「初始化除外」那一句**不能**當成理由 —— 真正的理由是它不是規則寶可夢
  //     （isInitializeNullified 第一道就擋掉）。v6.205 已把 SV8a 11641／12405 缺的
  //     「未來」tag 補上（先前只有 SV5M 9892 有），但那不改變本行的判斷依據。
  //   location 由 inst 與該玩家 active 比對推得（與小碎鑽那條對稱，不硬寫 'active'）。
  // ⚠ 這兩行必須**緊貼**下面的特性名字面量：v6.202 枚舉守衛的視窗是 ±8 行，拉遠了會被判成沒接閘。
  const _act = state?.players?.[ownerIdx ?? 0]?.active;
  const _loc: 'active' | 'bench' = (_act && _act.iid === inst.iid) ? 'active' : 'bench';
  if (!card.abilities?.some(a => a.name === '二重核心')) return false;
  if (!isAbilityHolderEffective(state, inst, card, ownerIdx, '二重核心', _loc, pool)) return false;
  // 檢查身上是否附有「驅勁能量 未來」
  return inst.energyAttached.some(e => {
    const ec = pool.get(e.cardId);
    return ec?.name === '驅勁能量 未來';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 爆炸頭水牛｜捲牆 — 場上有 2 隻以上「爆炸頭水牛」(依卡名)時，自己的【無】基礎寶可夢受
//   對手招式傷害 -60。v5.614 收斂：原 engine(戰鬥位) 與 effects(備戰) 各一份 inline，
//   且都「要求每隻爆炸頭水牛都有捲牆特性」→ 含 SV8(11267 無捲牆)版時計數不足、漏減傷
//   (玩家報：超級袋獸ex 場上 1 隻捲牆+1 隻 SV8，被忍之利刃 KO)。抽單一函式兩處共用。
//   依【卡名】計數 ≥2 + 至少一隻捲牆特性有效(未被火箭隊的監視塔消除【無】特性)。回傳 60 或 0。
// ════════════════════════════════════════════════════════════════════════════
export function curlWallReduce(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  victimCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): number {
  if (!state || defenderIdx == null || !victimCard || !pool) return 0;
  // 受惠 gate：受傷者必須是【無】基礎寶可夢
  const isColorless = victimCard.pokemonType === 'Colorless';
  const isBasic = !victimCard.evolvesFrom && victimCard.stage !== 'Stage1' && victimCard.stage !== 'Stage2';
  if (!isColorless || !isBasic) return 0;
  const me = state.players[defenderIdx];
  const all = [...(me.active ? [me.active] : []), ...me.bench];
  // 依【卡名】計數「爆炸頭水牛」≥2（不要求每隻都有捲牆特性；SV8 11267 無捲牆版也算數量）
  const buffaloByName = all.filter(c => pool.get(c.cardId)?.name === '爆炸頭水牛').length;
  if (buffaloByName < 2) return 0;
  // 火箭隊的監視塔消除【無】寶可夢特性 → 捲牆失效（爆炸頭水牛本身是【無】）
  const sd = state.activeStadium ? pool.get(state.activeStadium.cardId) : null;
  if (sd && ROCKET_WATCHTOWER_STADIUMS.has(sd.name)) return 0;
  // 至少一隻「有捲牆特性」的爆炸頭水牛在場
  // ⭐ v6.202：原本只比對特性名（上面那行的監視塔 early-return 是唯一的消除來源判定），
  //   招式版暗夜羽擊（abilityNullifiedThisTurn）與 passive 振翼髮｜暗夜羽擊 都打得到
  //   位於戰鬥場的爆炸頭水牛 ⇒ 逐隻過中央述詞 isAbilityHolderEffective（v6.196 家族）。
  const _actIid = me.active?.iid;
  const hasWall = all.some(c => {
    const card = pool.get(c.cardId);
    if (card?.name !== '爆炸頭水牛' || !card.abilities?.some(a => a.name === '捲牆')) return false;
    const loc: 'active' | 'bench' = (_actIid != null && c.iid === _actIid) ? 'active' : 'bench';
    return isAbilityHolderEffective(state, c, card, defenderIdx, '捲牆', loc, pool);
  });
  return hasWall ? 60 : 0;
}

// ════════════════════════════════════════════════════════════════════════════
// D8. 大吾的小碎鑽｜岩石宮殿
//
// 卡面：「只要這隻寶可夢在備戰區，自己的所有「大吾的寶可夢」受到對手的寶可夢
//        招式的傷害『-30』點。無論有多少隻擁有這個特性的寶可夢，這個效果也不會重複。」
//
// 範圍：
//   - 主語：擁有特性者（大吾的小碎鑽）必須在「備戰區」。
//   - 受惠：受傷者（defender.active）卡名必須以「大吾的」開頭。
//     ⚠「大吾的」是**卡面逐字的判準**（官方「訓練家冠名」族群靠卡名前綴識別，
//        tags 只有籠統的 '訓練家冠名' 分不出是誰）⇒ 這個字串比對是正確的，別改成中央述詞。
//        全站查證：H/I/J 現役卡中沒有任何**非寶可夢**卡以「大吾的」開頭，且此處 defenderCard
//        必然是場上的受傷寶可夢 ⇒ 無誤判風險。
//   - 卡面明文「不重複」→ 多隻效果上限仍 -30。
//
// 用法：engine.ts 在 PASSIVE_DAMAGE_REDUCE_COND 之後 inline 套用此 helper。
// 回傳值：- 30（觸發）或 0（未觸發）。
//
// ⭐⭐⭐ v6.209 特性消除閘 —— 這件事**已被判過兩次且結論相反**，定論寫在這裡，別再判第三次
// ────────────────────────────────────────────────────────────────────────────
// v6.202 判「結構上不可達 ⇒ 刻意不加閘」；v6.208 又把本函式列為「沒接特性消除閘」的舊帳。
// v6.209 重新查證（逐字讀 static/cards + **行為端實跑**，非推論）：
//
//   持有者 = 大吾的小碎鑽（SVOD.json id 12583，I 標）
//     supertype=Pokemon / subtype=stage=Basic / pokemonType=Psychic / hp=80 /
//     tags=['訓練家冠名']（**非**規則寶可夢：不在 RULE_BOX_SUBTYPES、卡名不以 ex/EX 結尾）
//   卡面「只要這隻寶可夢**在備戰區**」⇒ 持有者的 location 恆為 'bench'。
//
//   現行六種特性消除來源逐一驗證（scripts/test-steelix-palace-ability-nullify-gate.mjs
//   對每一種都建了真盤面、跑完整 ATTACK，並附**正對照**證明該來源在同一盤面確實生效）：
//     ❌ 鐵荊棘ex｜初始化      — 只消「擁有規則的寶可夢」；小碎鑽非規則寶可夢
//     ❌ 火箭隊的監視塔        — 只消【無】屬性（或 fossilOnField）；小碎鑽是【超】
//     ❌ 傳說的熔岩洞          — 只消**進化**寶可夢；小碎鑽 stage='Basic'
//     ❌ 招式版暗夜羽擊        — 中央閘限 location==='active'；持有者恆在備戰
//     ❌ passive 振翼髮｜暗夜羽擊 — 同上，限對手**戰鬥場**
//     ❌ 海兔獸｜黏著束縛      — 只消備戰的【2階進化】；小碎鑽是【基礎】
//   ⇒ v6.202 的「今天六種都打不到」是**對的**。
//   ⚠ 另有第七種、但**不在中央閘裡**的消除來源：可達鴨／哥達鴨｜濕氣（14692/14693，I 標）
//     「只要這隻寶可夢在場上，雙方所有寶可夢的**將自己【昏厥】的效果的特性**，全部消除。」
//     它是 **ability-scoped**（只消特定語義的特性，走 effects.ts:13931 獨立那條），
//     設計上就不收進中央閘 ⇒ 岩石宮殿不是「將自己昏厥」類，**不適用**。
//     所以下面那句「自動涵蓋新來源」精確講是：涵蓋所有 **blanket 型**（不分特性名）消除來源。
//
// 但「不可達」是一條**依賴其他六張卡條件**的脆弱不變式（任何一張新卡都可能推翻它），
// 而中央閘是**自我維護**的。⇒ v6.209 定論：**接上中央閘**（沿用既有 isAbilityHolderEffective，
// 與同檔的 捲牆／守護之鐘／齒輪塗層／盾之守護 一致），今天是保證的 no-op（差分實跑 0 mismatch），
// 明天自動涵蓋新來源。**這件事到此結案，後續 audit 看到這段註解即可跳過。**
// 絆線守衛：上述測試用「合成持有者」（把小碎鑽改成【無】屬性／2階／規則寶可夢）反向證明
// 這一行閘**真的會擋**，避免它退化成永遠 true 的死碼（HEAD 無閘時該測試會紅）。
// ════════════════════════════════════════════════════════════════════════════
export function steelixPalaceReduce(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  defenderCard: Card | null | undefined,
  pool: Map<string, Card> | undefined,
): number {
  if (!state || defenderIdx == null || !defenderCard || !pool) return 0;
  // 受惠 gate：受傷者必須是「大吾的」寶可夢
  if (!defenderCard.name.startsWith('大吾的')) return 0;
  // 場上有 ≥1 隻大吾的小碎鑽 + ability=岩石宮殿，且該隻在備戰區（非 active）
  const me = state.players[defenderIdx];
  for (const inst of me.bench) {
    const c = pool.get(inst.cardId);
    if (c?.name !== '大吾的小碎鑽') continue;
    if (!c.abilities?.some(a => a.name === '岩石宮殿')) continue;
    // v6.209：特性消除閘（見上方定論註解）。持有者恆在備戰 ⇒ location 固定 'bench'。
    if (!isAbilityHolderEffective(state, inst, c, defenderIdx, '岩石宮殿', 'bench', pool)) continue;
    return 30; // 卡面明文「不重複」→ 觸發即固定 -30
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════════════
// D9. 青銅鐘｜守護之鐘
//
// 卡面：「只要這隻寶可夢在場上，自己的所有寶可夢受到對手的寶可夢招式的傷害『-10』點。」
//
// 範圍：場上有任一青銅鐘（active 或 bench）→ 自方所有寶可夢受傷 -10。
// 疊加：v5.193 玩家要求 audit — 卡面未寫「不重複」 → 改為 count × 10 疊加
//   （N 隻青銅鐘 → -10×N 傷害；與鴨嘴炎獸熔岩波動 v5.188 同邏輯）。
//   參考 PTCG 通則：未明文「不重複」的同名 passive 預設疊加。
// ════════════════════════════════════════════════════════════════════════════
export function bronzongShelterReduce(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): number {
  // v5.193：count × 10（場上有 N 隻青銅鐘 → -10×N 傷害）
  if (!state || defenderIdx == null || !pool) return 0;
  const owner = state.players[defenderIdx];
  const all = [...(owner.active ? [owner.active] : []), ...owner.bench];
  let count = 0;
  for (const c of all) {
    const card = pool.get(c.cardId);
    if (!card?.abilities?.some(a => a.name === '守護之鐘')) continue;
    const loc: 'active' | 'bench' = owner.active && c.iid === owner.active.iid ? 'active' : 'bench';
    if (!isAbilityHolderEffective(state, c, card, defenderIdx, '守護之鐘', loc, pool)) continue;
    count++;
  }
  return count * 10;
}

// ════════════════════════════════════════════════════════════════════════════
// ⭐⭐ v6.206 陳舊的盾甲化石｜盾之守護（M5 19216，J）—— v6.205 查出是全站最後一張
//   「卡面有效果但完全沒實裝」的 H/I/J 卡，本版補實裝。
//
// 卡面逐字（static/cards/M5.json 19216，特性讀 abilities[].effect）：
//   特性 盾之守護：「只要這隻寶可夢在戰鬥場上，自己的所有寶可夢受到對手的寶可夢招式的傷害
//                  「-10」點。」
//   rulesText：「這張卡可作為HP60的【無】屬性的【基礎】寶可夢放置於場上。這張卡不會陷入
//                特殊狀態，無法撤退。\n 若在自己的回合中，則可將場上的這張卡丟棄。」
//
// ⚠ 條件是「在**戰鬥場**上」——**不是**青銅鐘｜守護之鐘 的「在場上」（v6.205 已明確指出
//   兩者條件不同、不可沿用）。⇒ 只有 owner.active 是這張化石時才生效；備戰的化石不生效。
// ⚠ 受惠對象是「自己的**所有**寶可夢」（含備戰）⇒ engine 戰鬥位管線與 effects 備戰管線
//   兩條都要接（與守護之鐘同位置）。
// ⚠ 疊加：卡面未寫「不重複」，但條件限「在戰鬥場上」⇒ 場上至多 1 隻 ⇒ 恆為 -10，
//   不存在疊加問題（刻意不寫 count×10，避免給人「可以疊」的錯誤暗示）。
// ⚠ 特性消除閘：化石放到場上是【基礎】【無】（rulesText 明文，inst.fossilOnField，v6.145）。
//   沿用 v6.196/v6.204 的中央閘 isAbilityHolderEffective，逐一查證後可達來源如下：
//     ✅ 火箭隊的監視塔（消【無】）—— 中央閘的 isNullifiedByRocketWatchtower 已讀 fossilOnField
//     ✅ 招式版暗夜羽擊（abilityNullifiedThisTurn，location='active'）
//     ✅ passive 振翼髮｜暗夜羽擊（對手戰鬥場，location='active'）
//     ❌ 傳說的熔岩洞（只消進化）—— fossilOnField ⇒ 中央閘判為【基礎】，打不到
//     ❌ 鐵荊棘ex｜初始化（只消「擁有規則的寶可夢」）—— 化石卡是 Trainer/Item，非規則寶可夢
//     ❌ 海兔獸｜黏著束縛（只消**備戰**【2階進化】）—— 本特性本來就只在戰鬥場生效
// ════════════════════════════════════════════════════════════════════════════
export function shieldFossilGuardReduce(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  pool: Map<string, Card> | undefined,
): number {
  if (!state || defenderIdx == null || !pool) return 0;
  const act = state.players[defenderIdx]?.active;
  if (!act) return 0;
  // 卡面「在戰鬥場上」＝ 持有者必須是自己的戰鬥寶可夢；且必須是**放在場上的化石**
  //   （手牌裡的同一張卡是 Item，不會走到這裡，但顯式判 fossilOnField 才不依賴呼叫端）。
  if (!act.fossilOnField) return 0;
  const card = pool.get(act.cardId);
  if (!card?.abilities?.some(a => a.name === '盾之守護')) return 0;
  if (!isAbilityHolderEffective(state, act, card, defenderIdx, '盾之守護', 'active', pool)) return 0;
  return 10;
}

// ════════════════════════════════════════════════════════════════════════════
// D10. 齒輪怪｜齒輪塗層
//
// 卡面：「只要這隻寶可夢在場上，自己的所有身上附有【鋼】能量卡的寶可夢，
//        受到對手的寶可夢招式的傷害『-20』點。」
//
// 範圍：
//   - 持有者：場上有齒輪怪 + ability=齒輪塗層。
//   - 受惠：受傷者（defender.active）身上必須附有【鋼】能量卡（基本【鋼】能量
//     或 pokemonType=Metal 的特殊能量；古舊/夜光能量視為全屬性也算）。
// 疊加：v5.193 玩家要求 audit — 卡面未寫「不重複」 → 改為 count × 20 疊加
//   （N 隻齒輪怪 → -20×N 傷害；受惠者仍需附【鋼】能量）。
// ════════════════════════════════════════════════════════════════════════════
export function gearCoatingReduce(
  state: GameState | undefined,
  defenderIdx: 0 | 1 | undefined,
  defenderInst: CardInstance | null | undefined,
  pool: Map<string, Card> | undefined,
): number {
  if (!state || defenderIdx == null || !pool || !defenderInst) return 0;
  // 受傷者身上必須附【鋼】能量
  const hasMetal = defenderInst.energyAttached.some(e => {
    const ec = pool.get(e.cardId);
    if (!ec || ec.supertype !== 'Energy') return false;
    if (ec.subtype === 'Basic' && (ec.pokemonType === 'Metal' || /【鋼】/.test(ec.name))) return true;
    if (ec.pokemonType === 'Metal') return true;
    if (ec.name === '古舊能量' || ec.name === '夜光能量') return true;
    return false;
  });
  if (!hasMetal) return 0;
  // v5.193：count × 20（場上有 N 隻齒輪怪 → -20×N 傷害）
  const owner = state.players[defenderIdx];
  const all = [...(owner.active ? [owner.active] : []), ...owner.bench];
  let count = 0;
  for (const c of all) {
    const card = pool.get(c.cardId);
    if (!card?.abilities?.some(a => a.name === '齒輪塗層')) continue;
    const loc: 'active' | 'bench' = owner.active && c.iid === owner.active.iid ? 'active' : 'bench';
    if (!isAbilityHolderEffective(state, c, card, defenderIdx, '齒輪塗層', loc, pool)) continue;
    count++;
  }
  return count * 20;
}


// ════════════════════════════════════════════════════════════════════════════
// v2.9992 hotfix: register PASSIVE_ATTACK_BONUS .set() 改成 lazy register
//
// 根因：v2.999 把 .set() 直接寫在模組 top-level，但本檔與 effects.ts 形成循環
//   import — 執行 .set() 時 PASSIVE_ATTACK_BONUS Map 還在 TDZ（undefined），
//   導致整個 effects.ts 模組初始化拋 TypeError，game 頁 500。
//
// 修法：把 .set() 包進 register 函式，由 effects.ts 在自己 body 末端（Map 已初始化
//   後）呼叫此函式。這時 PASSIVE_ATTACK_BONUS 已是真正的 Map 物件，.set() 可正常
//   執行。
// ════════════════════════════════════════════════════════════════════════════

let _v2999G3W1Registered = false;

export function registerV2999G3W1Passives(): void {
  if (_v2999G3W1Registered) return; // idempotent
  _v2999G3W1Registered = true;

  // 棄世猴｜憤怒穴 — 卡面逐字（static/cards/SV10.json id=12797）：
  //   「若**這隻寶可夢**身上放置有2個以上的傷害指示物，則**這隻寶可夢**使用的招式，
  //     對對手的戰鬥寶可夢造成的傷害「+120」點。」⇒ 主詞＝持有者本人（自指型）。
  // ⭐ v6.258：原本 gate 是 `att.name !== '棄世猴'`，但 att 是**攻擊者**的卡，
  //   dispatch 掃的是整個己方場找持有者 ⇒ 棄世猴【M5 039/081・J】（特性是「不朽身軀」，
  //   沒有「憤怒穴」）當攻擊者、備戰放一隻 SV10 版，幽靈打擊 100 會變 220 直接 KO（實測）。
  //   改由中央 PASSIVE_ATTACK_SELF_SUBJECT 主詞閘保證 holder === attacker；
  //   傷害指示物數也直接讀**持有者實體**（卡面主詞），不再讀 me.active。
  //   ⚠ holderInst 未傳入時 fail-closed 回 0（不多打），中央 dispatch 一定會傳。
  PASSIVE_ATTACK_BONUS.set('憤怒穴', (_att, _def, _state, _aIdx, _pool, holderInst) => {
    if (!holderInst) return 0;
    const counters = Math.floor((holderInst.damage ?? 0) / 10);
    return counters >= 2 ? 120 : 0;
  });

  // 肋骨海龜｜原始心得 — 對對手戰鬥場進化寶可夢 +30
  PASSIVE_ATTACK_BONUS.set('原始心得', (_att, def) => {
    if (!def) return 0;
    const isEvolution = !!def.evolvesFrom
      || def.stage === 'Stage1' || def.stage === 'Stage2';
    return isEvolution ? 30 : 0;
  });

  // 裙兒小姐｜大晴天 — 自方【草】/【火】寶可夢 +20
  PASSIVE_ATTACK_BONUS.set('大晴天', (att) => {
    return (att.pokemonType === 'Grass' || att.pokemonType === 'Fire') ? 20 : 0;
  });
}
