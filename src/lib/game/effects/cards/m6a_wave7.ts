/**
 * v6.347 M6a「30th CELEBRATION」**特性**實裝 —— 批次 7（M6a 的最後一批）
 *
 * ⚠⚠ 卡面文字逐字取自 `static/cards/M6a.json`（台灣官方中文，**`abilities[].effect`**，不是 `.text`）。
 *
 * ⭐ 本檔只放「玩家主動使用（USE_ABILITY）」型的特性；**被動特性沒有 handler**，
 *   一律登記在 `effects.ts` / `engine.ts` 的既有中央表裡（Rule 38：同一個判準只能有一份）：
 *     002/104 阿羅拉 椰蛋樹｜一長再長 → `engine.getEffectiveHP`（被動最大 HP 家族，含特性消除閘）
 *     004/103 甜甜螢｜絕佳費洛蒙      → `effects.WEAKNESS_MULTIPLIER_ABILITIES` ＋ `effects.weaknessMultiplier`
 *                                       （⭐v6.353 實裝的「弱點**倍率**」中央述詞，與弱點**屬性**述詞
 *                                        `getEffectiveWeaknessType` 並列；engine 主傷害管線與
 *                                        `effects.applyWeakRes` 兩個消費點都問它。純被動 ⇒ 無 handler，
 *                                        也不會出現在 `getUsableAbilities`（那份清單只列 `ABILITY_EFFECTS`
 *                                        有登錄的主動特性）。守衛：scripts/test-v6353-weakness-multiplier.mjs）
 *     022     皮卡丘｜寂寞眼神        → `PASSIVE_DAMAGE_REDUCE` + `ACTIVE_ONLY_PASSIVE_REDUCE_ABILITIES`
 *     027     皮卡丘｜躲起來          → `getBenchImmunityAbilityName`（藏隱／深度下潛 同一支）
 *     076     耿鬼ex｜死亡宣告        → ⚠**本版未實裝**（待站長裁示；曾實作後撤回，見 changelog v6.347【五】3：PASSIVE_ON_KO 在兩條 KO 管線相對 addPendingPrize 的順序相反）
 *     095     卡比獸｜好眠            → `engine` 寶可夢檢查的睡眠擲幣區
 *     057/135 夢幻ex｜記憶螺旋        → `engine.getEffectiveAttacks`（古空棘魚｜潛入記憶 同一家族）
 *
 * ⭐ 「這個特性現在能不能用」全站只有一份述詞：`engine.getUsableAbilities`
 *   （v6.181：不在那份清單裡 ⇒ USE_ABILITY 完全不執行）。所以本檔每一支 regAByName 的
 *   early-return 條件，都必須在 `getUsableAbilities` 有**同一份**對應 gate，否則會變成
 *   「按鈕亮著卻沒反應」或「條件明明成立卻按不下去」（v6.127/v6.131/v6.132 的前科）。
 *   ⇒ 三神鳥那一組把述詞抽成 `effects.ts` 的中央出口 `m6aWingAbilityReady`，兩端共用。
 *
 * ⭐ 拒絕一律走 `rejectAbilityUse`（v6.181）：原樣回傳動作前的 state，不吃掉本回合的特性權。
 *
 * ⚠⚠ **循環 import 的 TDZ**：effects.ts 在檔尾 `import './effects/cards/m6a_wave7'`，但 ESM 的
 *   import 會被提升 ⇒ 本檔的**模組主體比 effects.ts 的主體先執行**。所以本檔只能在模組主體
 *   直接用「函式宣告」（會提升），**不可以**在模組主體讀 effects.ts 的 `const`
 *   （例如把 spec 表寫成 `for (const x of M6A_WING_SPEC_MAP)` 會直接 ReferenceError）。
 *   ⇒ 三神鳥改成「三行字面註冊 + handler 內才問中央述詞」。
 */

import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  regAByName, regR,
  addLog, updatePlayer, withPending, rejectAbilityUse,
  shuffle, healResolver, fireOnHandEnergyAttached,
  healOneOwnPokemonPending,   // ⭐v6.348 治癒類中央出口（與 甜點之禮／發酵果汁／激動治癒 同一支）
} from '../_shared';
import { applyMagearnaHandAttachHeal } from './v3000_g3_wave2';
import {
  flipCoinsWithLog,
  m6aWingSpec,             // ⭐ 三神鳥「羽擊」三支特性的中央規格（effects.ts，函式宣告 → 無 TDZ）
  m6aWingAbilityReady,     // ⭐ 同一份可用性述詞（engine.getUsableAbilities 也是問這一支）
} from '../../effects';
import { isBasicEnergyOfType } from '../../selection-filter';

// 導出 sentinel 防止 unused type import warning
export type _M6aW7Sentinel = CardInstance | GameState | Card;

// ══════════════════════════════════════════════════════════════════════════════
// ① 005/103 彩粉蝶｜指引之舞
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時可使用1次。擲1次硬幣若為正面，則從自己的牌庫選擇1張寶可夢卡，
//        在給對手看過後加入手牌。並且重洗牌庫。」
//   ⚠ 「在給對手看過後」⇒ **公開**揭示 ⇒ `search-to-hand-reshuffle` 不帶 `privateReveal`
//     （帶了就變成對手只看得到張數，違反卡面）。
//   ⚠ minCount:0 —— 這是**帶條件**的牌庫搜尋（找「寶可夢卡」），依官方 fail-to-find
//     可以宣告找不到（v6.126/v6.131 的定論：只有「任意選擇1張卡」才必須選）。
//   ⚠ 擲幣在特性權已被扣掉之後才擲（engine USE_ABILITY 先標記再執行）⇒ 反面就是沒效果。
// ══════════════════════════════════════════════════════════════════════════════
regAByName('彩粉蝶', '指引之舞', (st, idx, _pool, _cardInst) => {
  // gate 與 engine.getUsableAbilities 同一份：牌庫張數是公開資訊（官方 L821 電氣發生器判準）。
  if (st.players[idx].deck.length === 0) {
    return rejectAbilityUse(st, '指引之舞：牌庫為空，無法使用', idx);
  }
  const r = flipCoinsWithLog(st, 1, '彩粉蝶｜指引之舞', idx);
  const s0 = r.state;
  if (r.heads !== 1) return addLog(s0, '指引之舞：反面 → 沒有效果', idx);
  const s = addLog(s0, '指引之舞：正面 → 從牌庫選 1 張寶可夢卡（給對手看過後）加入手牌，並重洗牌庫', idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon', minCount: 0, maxCount: 1,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ② 006 火焰鳥｜燃燒羽擊 ／ 012 急凍鳥｜嚴寒羽擊 ／ 049 閃電鳥｜濺射羽擊
// ══════════════════════════════════════════════════════════════════════════════
// 卡面（三張只差「屬性」與「前提的另外兩隻是誰」，其餘逐字相同）：
//   006/105 火焰鳥｜燃燒羽擊「若自己的場上有『急凍鳥』『閃電鳥』，則在自己的回合時可使用1次。
//                            從自己的手牌選擇1張『基本【火】能量』卡，附於這隻寶可夢身上。」
//   012/107 急凍鳥｜嚴寒羽擊「…『火焰鳥』『閃電鳥』…『基本【水】能量』…」
//   049/108 閃電鳥｜濺射羽擊「…『火焰鳥』『急凍鳥』…『基本【雷】能量』…」
//   ⇒ **一支參數化的 handler + 一份中央規格表 + 一支 resolver**，不抄三份（Rule 38）。
//   ⚠ 「自己的場上」＝ 戰鬥場 + 備戰區（不限持有者自己在哪一區）。
//   ⚠ 「從自己的手牌…附於」＝ 從手牌附能 ⇒ 必須觸發對手的附能反應（耿鬼ex｜侵蝕詛咒、
//     麻痺門牙）與己方瑪機雅娜｜自動治癒（v6.105 的教訓：fast-path 漏掉這兩件事）。
// ══════════════════════════════════════════════════════════════════════════════
function regM6aWingAbility(holder: string, abilityName: string): void {
  regAByName(holder, abilityName, (st, idx, pool, cardInst) => {
    if (!cardInst) return rejectAbilityUse(st, `${abilityName}：找不到持有者`, idx);
    const spec = m6aWingSpec(abilityName);
    if (!spec) return rejectAbilityUse(st, `${abilityName}：規格表缺漏`, idx);
    const ready = m6aWingAbilityReady(st, idx, abilityName, pool);
    if (!ready.ok) return rejectAbilityUse(st, `${abilityName}：${ready.reason ?? '條件不符'}`, idx);
    const cands = st.players[idx].hand.filter(
      c => isBasicEnergyOfType(pool.get(c.cardId), spec.energyType));
    const s = addLog(st,
      `${spec.holder}：使用特性「${abilityName}」，從手牌選 1 張「基本【${spec.zh}】能量」附於自己身上`, idx);
    return withPending(s, {
      type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
      filter: `BasicEnergy:${spec.energyType}`,
      minCount: 1, maxCount: 1,   // 卡面「選擇1張」＝必選（gate 已保證手牌有）
      effectKey: 'm6a-wing-attach-self',
      params: {
        validIids: cands.map(c => c.iid),
        targetIid: cardInst.iid,
        abilityName,
        titleOverride: `${abilityName}：選 1 張手牌「基本【${spec.zh}】能量」附於 ${spec.holder}`,
      },
    });
  });
}
regM6aWingAbility('火焰鳥', '燃燒羽擊');
regM6aWingAbility('急凍鳥', '嚴寒羽擊');
regM6aWingAbility('閃電鳥', '濺射羽擊');

regR('m6a-wing-attach-self', (st, idx, iids, params, pool) => {
  const abilityName = String(params?.abilityName ?? '羽擊');
  if (iids.length === 0) return addLog(st, `${abilityName}：未選擇能量`, idx);
  const targetIid = String(params?.targetIid ?? '');
  const p = st.players[idx];
  const energies = p.hand.filter(c => iids.includes(c.iid));
  if (energies.length === 0) return addLog(st, `${abilityName}：選擇的能量已不在手牌`, idx);
  const holder = p.active?.iid === targetIid ? p.active : p.bench.find(b => b.iid === targetIid);
  if (!holder) return addLog(st, `${abilityName}：持有者已不在場上，能量留在手牌`, idx);
  const tName = pool.get(holder.cardId)?.name ?? '?';
  const s0 = updatePlayer(st, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !iids.includes(c.iid)),
    active: pl.active && pl.active.iid === targetIid
      ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] }
      : pl.active,
    bench: pl.bench.map(b => b.iid === targetIid
      ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
      : b),
  }));
  const s = addLog(s0, `${abilityName}：將 ${pool.get(energies[0].cardId)?.name ?? '能量'} 附於 ${tName}`, idx);
  // v6.105/v6.164：從手牌附能 → 對手附能反應（侵蝕詛咒／麻痺門牙）＋ 瑪機雅娜｜自動治癒，
  //   而且是「每張各一次」。
  return fireOnHandEnergyAttached(
    applyMagearnaHandAttachHeal(s, idx, [targetIid], pool, energies.length),
    idx, targetIid, pool, energies.length);
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 074/114 尼多娜｜分享歡樂
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時可使用1次。將自己的1隻寶可夢恢復「30」HP。」
//   ⚠ 與 霜奶仙ex｜甜點之禮（v2995_g4_wave1.ts）**卡面逐字相同** ⇒ 走同一支中央
//     `healResolver`（heal-target pending，params.healAmount），不另寫一份回血邏輯。
// ══════════════════════════════════════════════════════════════════════════════
//   ⭐v6.348 與 霜奶仙ex｜甜點之禮 卡面逐字相同 ⇒ 連「開 picker」都走同一支中央出口
//     healOneOwnPokemonPending（含 validIids 消毒閘），不再各寫一份 withPending。
regAByName('尼多娜', '分享歡樂', (st, idx, _pool, _cardInst) =>
  healOneOwnPokemonPending(st, idx, 30, 'share-joy-heal-30', '分享歡樂'));
regR('share-joy-heal-30', healResolver);

// ══════════════════════════════════════════════════════════════════════════════
// ④ 084/103 索爾迦雷歐｜日出
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若這隻寶可夢在備戰區，則在自己的回合時可使用1次。從自己的牌庫選擇最多2張
//        「基本【鋼】能量」卡，附於這隻寶可夢身上。並且重洗牌庫。」
//   ⚠ 「若這隻寶可夢在備戰區」⇒ 在戰鬥場時不可使用（gate 與 engine 端同一份條件）。
//   ⚠ 「最多2張」⇒ minCount:0（可以一張都不選，仍會重洗牌庫）。
//   ⚠ 牌庫張數是公開資訊 ⇒ 牌庫為 0 時不可使用（v6.132 站長裁定，同 頸傘發電／惡棍衝天）。
//   ⚠ 這是從**牌庫**附能，不是從手牌 ⇒ **不**觸發「從手牌附能」的反應（侵蝕詛咒等）。
// ══════════════════════════════════════════════════════════════════════════════
regAByName('索爾迦雷歐', '日出', (st, idx, _pool, cardInst) => {
  const p = st.players[idx];
  if (!cardInst) return rejectAbilityUse(st, '日出：找不到持有者', idx);
  if (p.active?.iid === cardInst.iid) {
    return rejectAbilityUse(st, '日出：這隻寶可夢在戰鬥場，必須在備戰區才能使用', idx);
  }
  if (p.deck.length === 0) return rejectAbilityUse(st, '日出：牌庫為空，無法使用', idx);
  const s = addLog(st,
    '索爾迦雷歐：使用特性「日出」，從牌庫選最多 2 張「基本【鋼】能量」附於自己身上（並重洗牌庫）', idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy:Metal', minCount: 0, maxCount: 2,
    effectKey: 'm6a-sunrise-attach',
    params: { targetIid: cardInst.iid },
  });
});

regR('m6a-sunrise-attach', (st, idx, iids, params, pool) => {
  const targetIid = String(params?.targetIid ?? '');
  const p = st.players[idx];
  const energies = p.deck.filter(c => iids.includes(c.iid));
  if (energies.length === 0) {
    const s0 = updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s0, '日出：未選擇能量，牌庫已重洗', idx);
  }
  const holder = p.active?.iid === targetIid ? p.active : p.bench.find(b => b.iid === targetIid);
  // ⚠ 持有者已離場（被 KO／回手）⇒ 能量**留在牌庫**（先抽出來又沒地方附＝把卡片弄不見）。
  if (!holder) {
    const s0 = updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
    return addLog(s0, '日出：持有者已不在場上，能量留在牌庫並重洗', idx);
  }
  const tName = pool.get(holder.cardId)?.name ?? '?';
  const s = updatePlayer(st, idx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => !iids.includes(c.iid))),
    active: pl.active && pl.active.iid === targetIid
      ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] }
      : pl.active,
    bench: pl.bench.map(b => b.iid === targetIid
      ? { ...b, energyAttached: [...b.energyAttached, ...energies] }
      : b),
  }));
  return addLog(s, `日出：將 ${energies.length} 張「基本【鋼】能量」附於 ${tName}，並重洗牌庫`, idx);
});
