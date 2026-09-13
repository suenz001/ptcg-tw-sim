/**
 * ⭐⭐⭐ v6.373 站長裁定 A-3（逐字）：
 *   「凡是有這種類似的狀況，請你都比照 謝米［特性］花之帷幔的判定邏輯」
 *
 * ＝「宣告當時」家族的**全站唯一**述詞。官方依據：
 *   ・站長裁定 六-14 ＋ PTCG_RULES.md §17.46.B（花之帷幔官方問答）
 *     ——「招式的效果視為同時發生；持有者即使被**這一次**招式打到昏厥離場，
 *        該特性對**這一次**招式仍然生效」。
 *
 * ⇒ 判準（本檔 declarationHolderStillCounts 就是它，唯一一份）：
 *
 *     有效 ＝ 現在仍然有效
 *          ||（宣告當時有效 && 持有者是「因為這一次招式而昏厥離場」）
 *
 * ⚠⚠ **不包含「被主動移除」**。站長親自點出的反例家族：
 *   ・拉達｜削落（M3 060/080・092/080，標 J）「**在造成傷害前**，將對手的戰鬥寶可夢
 *     身上附加的『寶可夢道具』卡丟棄。」⇒ 被丟掉的千香果（−60）必須**立刻**失效。
 *     （道具那一半由 v6.351 的 defender resync 管，本檔不碰；v6.373 實測 20 點，不是 0。）
 *   ・仙子伊布ex｜天仙石（SV8a 069/187、MC 299/742、SVPN 005/008，標 H）
 *     「選擇 2 隻對手的**備戰**寶可夢，將那些寶可夢與附加的卡全部**放回牌庫並重洗**。」
 *     ⇒ 被洗回牌庫的持有者**不是昏厥離場**，它的特性對這一次招式的後續結算**不再算數**。
 *
 * ⭐ 怎麼分辨「昏厥離場」與「被主動移除」——**不新增任何 KO hook**：
 *   引擎沒有「本 action 內因昏厥離場」的中央記錄（v6.373 實查：`bench.filter(` 77 處、
 *   `active: null` 22 處、`koDiscard` 47 處，**沒有 chokepoint**），逐一去掛 hook
 *   會在任何漏接處**默默拿掉**線上既有的保護（＝回歸方向的風險）。
 *   ⇒ 改用「持有者現在在**哪一區**」這個**盤面本身就有**的事實：
 *       ・還在場上（active／bench） → live 那一半就會是 true，不走這裡
 *       ・在**棄牌區**              → 昏厥離場（或招式效果丟棄）→ **仍然算數**（fail-safe）
 *       ・在**手牌或牌庫**          → 被放回手牌／洗回牌庫 ＝ 主動移除 → **不算數**
 *       ・哪裡都找不到              → 資訊不足 → **仍然算數**（fail-safe，維持既有行為）
 *   ⚠ fail-safe 方向刻意選「維持既有行為」：唯一會改變線上行為的情況是
 *     「持有者確實出現在手牌／牌庫」，那只可能由招式把它主動移出場造成。
 *
 * ⚠ `_attackTimeAttackerEnergyUnits`（太古防壁的攻擊宣告時能量單位數）**不屬於本家族**：
 *   它不是「特性持有者在不在場上」，而是官方判例明文的數值快照
 *   （「自丟能量招式仍以開打前計」）⇒ 刻意不接本述詞。
 */
import type { GameState } from './types';

/** 本家族涵蓋的特性名（＝宣告當時要記下持有者 iid 的特性）。⚠ 全站唯一一份名單。 */
export const AS_OF_DECLARATION_ABILITIES: readonly string[] = [
  '花之帷幔',    // 謝米          — 備戰免招式傷害（_attackTimeOppFlowerVeil）
  '抵抗之幕',    // 火箭隊的急凍鳥 — 基礎火箭隊免招式效果（_attackTimeOppRocketVeil）
  '球形盾牌',    // 蟲甲聖        — 備戰免招式傷害與效果（_attackTimeOppBugShield）
  '平穩境地',    // 美納斯        — 對手場上寶可夢無法放回手牌（_attackTimeCalmGround）
  '生命制約',    // 伊裴爾塔爾    — 對手戰鬥寶可夢 HP 無法恢復（_attackTimeLifeRestraint）
];

export type AsOfDeclarationSide = 'p1' | 'p2';
export const asOfDeclarationSideKey = (idx: 0 | 1): AsOfDeclarationSide => (idx === 0 ? 'p1' : 'p2');

/**
 * ⭐ 本家族的**唯一**判準核心：宣告當時的持有者，現在還算不算數？
 * @param iids 宣告當時「特性生效中」的持有者 instance id（空／缺席 ⇒ 資訊不足 ⇒ fail-safe true）
 */
export function declarationHolderStillCounts(
  state: GameState | undefined,
  holderIdx: 0 | 1 | undefined,
  iids: readonly string[] | undefined,
): boolean {
  if (!state || holderIdx == null) return true;          // 資訊不足 ⇒ 維持既有行為
  if (!iids || iids.length === 0) return true;           // 同上（舊盤面／跨版相容）
  const p = state.players?.[holderIdx];
  if (!p) return true;
  for (const iid of iids) {
    // 還在場上 ⇒ 算數（live 那一半通常已經 true，這裡只是不誤殺）
    if (p.active?.iid === iid) return true;
    if (p.bench?.some((b) => b.iid === iid)) return true;
    // 被放回手牌／洗回牌庫 ＝ **主動移除** ⇒ 這一位持有者不算數
    if (p.hand?.some((h) => h.iid === iid)) continue;
    if (p.deck?.some((d) => d.iid === iid)) continue;
    // 其餘（棄牌區＝昏厥離場／效果丟棄；或哪裡都找不到）⇒ fail-safe：算數
    return true;
  }
  return false;
}

/**
 * ⭐⭐⭐ 全站唯一的「宣告當時」消費入口。6 個消費點一律走這裡（Rule 38：一個判準一份）。
 * @param liveEffective     現在的盤面上，這個特性是不是仍然生效
 * @param declaredEffective 招式宣告當時，這個特性是不是生效（＝ _attackTime* 快照）
 */
export function isEffectiveAsOfDeclaration(
  state: GameState | undefined,
  holderIdx: 0 | 1 | undefined,
  abilityName: string,
  liveEffective: boolean,
  declaredEffective: boolean,
): boolean {
  if (liveEffective) return true;
  if (!declaredEffective) return false;
  const byAbility = holderIdx == null
    ? undefined
    : state?._attackTimeHolders?.[asOfDeclarationSideKey(holderIdx)];
  return declarationHolderStillCounts(state, holderIdx, byAbility?.[abilityName]);
}
