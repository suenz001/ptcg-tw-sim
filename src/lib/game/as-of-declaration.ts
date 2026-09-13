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
  // >>> v6374-a2-opp-active-returned-to-bench
  // ⭐v6.374 站長裁定 A-2（＝A-3「凡是有這種類似的狀況，請你都比照花之帷幔」）：
  //   這兩個特性的消費點在 applyActionImpl 尾段（applyOppActiveReturnedToBenchTriggers），
  //   讀的是**動作結束後**的盤面 ⇒ 持有者被同一招打到昏厥離場就整個不生效（v6.374 前實測）。
  '凹洞',        // 火箭隊的三地鼠（M2a，標 I）— 對手戰鬥寶可夢回備戰 ⇒ 那隻身上 2 個傷害指示物
  '熔岩地域',    // 熔岩蝸牛（SV5M，標 H）    — 對手戰鬥寶可夢回備戰 ⇒ 新上場的寶可夢【灼傷】
  // <<< v6374-a2-opp-active-returned-to-bench
  // >>> v6375-a1-field-wide-reduce
  // ⭐⭐v6.375 站長裁定 A-1／A-3（「凡是有這種類似的狀況，請你都比照花之帷幔」）：
  //   field-wide 減傷 5 張。消費點是 effects.ts 的 _applyBenchAbilityReduce（備戰那一份傷害），
  //   它排在主傷害的 KO 分支**之後** ⇒ 持有者在戰鬥位被同一招打死，備戰那一段就讀不到它。
  //   v6.375 行為端實測（真卡 三首惡龍ex｜黑曜石 130＋2 隻備戰各 130，__m6a/probe375_d2.mjs）：
  //     守護之鐘 備戰 130（應 120）／齒輪塗層 130（應 110）／凍原堡壘 130（應 80）／
  //     垃圾洩氣 130（應 110）／捲牆 備戰水牛直接被 KO（應 -60 存活）。五張全中。
  '守護之鐘',    // 青銅鐘（SVM 12152，標 H）  — 自方所有寶可夢受招式傷害 -10（疊加 ×N）
  '凍原堡壘',    // 冰雪巨龍（M3 18000，標 J） — 自方附【水】能量者 -50（卡面明文不重複）
  '齒輪塗層',    // 齒輪怪（MC 16979，標 I）   — 自方附【鋼】能量者 -20（疊加 ×N）
  '捲牆',        // 爆炸頭水牛（M2a 14800，標 H）— 【無】基礎 -60（卡面明文不重複）
  '垃圾洩氣',    // 灰塵山（M4 18475，標 J）   — 攻擊方附道具時 -20（不重複）
  // ⚠ 漩渦言靈是 A-2 家族（與 凹洞／熔岩地域 同一個函式 getOppRetreatTriggers），
  //   但條件是「在**戰鬥場**上」⇒ 見下方 AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES。
  '漩渦言靈',    // 夢妖魔ex（M2 14354／18582，標 I）— 對手戰鬥寶可夢回備戰 ⇒ 新上場的【混亂】
  // <<< v6375-a1-field-wide-reduce
];

// >>> v6375-active-only-and-counted-card-names
/**
 * ⭐v6.375：卡面條件是「只要這隻寶可夢在**戰鬥場**上」而**不是**「在場上」的特性。
 *   ⚠ 快照端（collectAsOfDeclarationHolders）看到 loc !== 'active' 就**不記**，
 *     否則「宣告當時在備戰」的持有者會被誤算成生效（v6.375 實測反對照 V3）。
 *   ⚠ 判準本身仍然只有 declarationHolderStillCounts 一份（Rule 38）；這裡只界定
 *     「宣告當時生效」的**位置**條件，與 hasAbilityOnActive 的 live 判準逐字同義
 *     （後者最後一步就是 isAbilityHolderEffective(..., 'active', ...)，見 v3001_g3_wave3.ts）。
 */
export const AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES: readonly string[] = [
  '漩渦言靈',    // 夢妖魔ex — 「只要這隻寶可夢在戰鬥場上…」
];

/**
 * ⭐⭐v6.375：有些持有者條件數的是**卡名隻數**，不是「特性生效的持有者隻數」。
 *   目前唯一一張：爆炸頭水牛｜捲牆 —— 卡面「只要這隻寶可夢與自己的**其他「爆炸頭水牛」**
 *   在場上」，而 v5.614 已查明現行卡池有 **SV8 id 11267 的爆炸頭水牛（標 H、HP130、
 *   沒有捲牆特性）**，它**算隻數但不是特性持有者**（玩家回報：1 隻捲牆 ＋ 1 隻 SV8 漏減傷）。
 *   ⇒ 只記「特性持有者 iid」的快照表達不了它：SV8 那隻被同一招打死時，卡名計數會從 2 掉到 1。
 *   ⇒ 這裡另外依**卡名**記一份在場 iid，key 用 asOfDeclarationCardNameKey() 加後綴隔開，
 *     不會和任何特性名相撞（特性名不可能含「@」）。判準仍然共用同一份
 *     declarationHolderStillCounts（Rule 38）。
 *   ⚠ 只放真的「依卡名計數」的卡；每多一個名字就多掃一次全場，不要當成通用清單。
 */
export const AS_OF_DECLARATION_COUNTED_CARD_NAMES: readonly string[] = [
  '爆炸頭水牛',  // 捲牆的「與自己的其他『爆炸頭水牛』在場上」
];

/** 依卡名記錄時使用的快照 key。⚠ Firestore map key 不可含 '.'／'/'／'['／']'／'*'；'@' 安全。 */
export const asOfDeclarationCardNameKey = (cardName: string): string => cardName + '@卡名';
// <<< v6375-active-only-and-counted-card-names

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

// >>> v6374-as-of-declaration-holder-iids
/**
 * ⭐⭐v6.374：同一份判準核心的**集合版**入口（站長裁定 A-2：凹洞／熔岩地域）。
 *
 * `isEffectiveAsOfDeclaration` 回傳布林，只能表達「這個特性算不算數」；
 * 但「凹洞」卡面是「只要**這隻**寶可夢在場上…放置 2 個傷害指示物」＝**每隻各算一次**
 * （v6.196 已改成按隻計數）⇒ 消費點要的是**持有者集合**，不是布林。
 *
 * ⚠⚠ 判準**完全不另寫**：逐一交給同一份 declarationHolderStillCounts（Rule 38）。
 *   回傳 ＝ 現在仍然生效的持有者 ∪ 宣告當時生效且「不是被主動移出場」的持有者（依 iid 去重）。
 *   非 ATTACK 路徑（撤退／道具換場…）沒有 _attackTimeHolders ⇒ 原封不動回傳 liveIids。
 */
export function asOfDeclarationHolderIids(
  state: GameState | undefined,
  holderIdx: 0 | 1 | undefined,
  abilityName: string,
  liveIids: readonly string[],
): string[] {
  const out = [...liveIids];
  if (!state || holderIdx == null) return out;
  const declared = state._attackTimeHolders?.[asOfDeclarationSideKey(holderIdx)]?.[abilityName];
  if (!declared || declared.length === 0) return out;
  for (const iid of declared) {
    if (out.includes(iid)) continue;
    if (declarationHolderStillCounts(state, holderIdx, [iid])) out.push(iid);
  }
  return out;
}
// <<< v6374-as-of-declaration-holder-iids

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
