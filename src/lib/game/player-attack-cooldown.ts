/**
 * ⭐v6.435 玩家層級招式冷卻的**唯一判準**（leaf 模組：只 import 型別，不會成環）
 *
 * 卡面：「在上個自己的回合，若自己的寶可夢使出了『X』，則無法使用這個招式。」
 *   —— 主詞是「自己的寶可夢」，不是「這隻寶可夢」⇒ 玩家層級的事實。
 *   仙子伊布ex｜天仙石、騎拉帝納｜渾沌匍匐。
 *
 * 為什麼從 engine.ts 搬出來：
 *   借招家族的中央候選枚舉 `copy-attack.ts` 也必須問同一個判準
 *   （站長裁定 2026-09-28：「夢幻ex｜基因駭入不能借冷卻中的天仙石」——同一句卡面的揮指／欺詐／
 *   試著模仿／技能大盜／高傲指令／耀閃挑戰一體適用），但 copy-attack.ts 的 runtime import 只能是 leaf，
 *   import engine.ts 會成環（循環 import 下模組層級 const 會 TDZ）。
 *   ⇒ 判準搬到這裡，engine.ts 與 copy-attack.ts 都 import 這一份（IRON_RULES Rule 38：判準只能有一份）。
 *
 * 官方問答（PTCG_RULES.md L2002～2005）：夢幻ex 用基因駭入**借**天仙石之後，下個自己的回合
 *   自己的仙子伊布ex 仍可以用天仙石、也可以再借一次 ⇒ 借來用的**不算**「自己的寶可夢使出了天仙石」。
 *   引擎的蓋章記的是**印在卡上的那一招**（揮指），自然符合；這裡不需要特別處理。
 */
import type { GameState } from './types';

/**
 * v6.056：per-player 欄位在 GameState 裡若寫成 `T[][]`，Firestore 會整包拒收
 * （`Nested arrays are not supported`）→ 線上對局根本存不進房間。
 * 因此這類欄位一律用 `{ p1, p2 }`，並用這個 helper 把 seat index 轉成 key。
 * ⭐v6.435 從 engine.ts 搬來（engine.ts 仍 re-export，既有 import 不受影響）。
 */
export function ancientKey(idx: 0 | 1): 'p1' | 'p2' {
  return idx === 0 ? 'p1' : 'p2';
}

// v5.967 玩家層級招式冷卻：卡面「若『自己的寶可夢』上個自己的回合使出了X，則無法使用」(非「這隻寶可夢」)。
//   仙子伊布ex｜天仙石 屬此類。舊實作把冷卻鎖在 attacker instance(blockedAttackNamesNextTurn)，會被撤退／
//   換位／第二張同名卡繞過。改在招式禁用 gate 掃自己全場的中央 attackUsedLastSelfTurn(招式結算自動蓋章、
//   不隨離場清除)判定，任一隻上個自己回合用過此招即禁用。
//   v6.069 騎拉帝納｜渾沌匍匐（M6）：「在上個自己的回合，若自己的寶可夢使用了『渾沌匍匐』，
//   則無法使用這個招式」—— 主詞是「自己的寶可夢」非「這隻寶可夢」，同 天仙石。
export const PLAYER_LEVEL_ATTACK_COOLDOWN: ReadonlySet<string> = new Set<string>(['天仙石', '渾沌匍匐']);

// ⭐v6.428 中央述詞：玩家層級冷卻中嗎？（ATTACK handler、getAvailableAttacks、⭐v6.435 借招候選 共用同一份）
//   舊版只在 ATTACK handler 判 ⇒ getAvailableAttacks 仍列為可用 ⇒ 招式按鈕亮著、按下去才被擋，
//   AI 也會把它當候選（批次 B2 診斷抓到）。
//   卡面主詞「自己的寶可夢」使出了X ⇒ **玩家層級的事實**：用過的那一隻就算已經離場
//   （昏厥、回手、放回牌庫、退化成不帶蓋章的實體）也照樣冷卻（fable 審查實測舊版會被繞過）。
//   ⇒ 讀遊戲層級 attackNamesUsedLastSelfTurn；再併看場上實體的 attackUsedLastSelfTurn
//     （v6.428 以前開始、還在進行中的對局沒有遊戲層級紀錄，保留舊判準當退路）。
export function isPlayerLevelAttackOnCooldown(
  state: GameState, pIdx: 0 | 1, attackName: string | undefined | null,
): boolean {
  if (!attackName || !PLAYER_LEVEL_ATTACK_COOLDOWN.has(attackName)) return false;
  if ((state.attackNamesUsedLastSelfTurn?.[ancientKey(pIdx)] ?? []).includes(attackName)) return true;
  const p = state.players[pIdx];
  return [p.active, ...p.bench].some((c) => c?.attackUsedLastSelfTurn === attackName);
}
