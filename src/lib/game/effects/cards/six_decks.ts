/**
 * v2.112 六組新 preset 的卡片效果（首批）— 招式使用既有 helpers 能直接做完的部分。
 *
 * 對應 preset：N的索羅亞克 / 火焰雞多龍 / 夠讚狗 / 顫弦蠑螈 / 蒼炎刃鬼 / 超級甲賀忍蛙。
 *
 * 本檔 v2.112 實裝範圍（6 張招式 / 1 特性）：
 *   - N的捷克羅姆｜撕裂（skipDefEffects 70）
 *   - N的捷克羅姆｜亂暴閃電（self noAttacksNextTurn 250）
 *   - 力壯雞｜二連踢（擲 2 硬幣 × 40）
 *   - 火焰雞ex｜燃燒旋踢（self noAttacksNextTurn 200）
 *   - 莉莉艾的皮皮ex｜滿月輪舞（雙方備戰數 × 20）
 *   - 超級阿勃梭魯ex｜死亡終局（若對手戰鬥位 ≥6 傷 → KO）
 *
 * TODO v2.113+：剩下的 17 張（Trainer / 多數 ability / 2 張特殊能量）。
 */
import type { PlayerState, GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import { regPre, regPost, addLog } from '../_shared';
import { skipDefEffectsPre, coinHeadsMultiplyPre, bothBenchMultiplyPre } from '../../effects';

// ─── 撕裂 70（skipDefEffects）───────────────────────────────────────────────
regPre('N的捷克羅姆|撕裂', skipDefEffectsPre(70, '撕裂'));

// ─── 亂暴閃電 250 + 自己下回合無法攻擊 ──────────────────────────────────────
// Wave 36 的 player-level noAttacksNextTurn 旗標：ATTACK_POST 設旗標即可。
regPost('N的捷克羅姆|亂暴閃電', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], noAttacksNextTurn: true };
  return addLog({ ...state, players }, '亂暴閃電：下個自己的回合，這隻寶可夢無法使用招式', aIdx);
});

// ─── 二連踢 40×（coin heads multiply）───────────────────────────────────────
regPre('力壯雞|二連踢', coinHeadsMultiplyPre(2, 40, '二連踢'));

// ─── 燃燒旋踢 200 + 自己下回合無法攻擊 ──────────────────────────────────────
regPost('火焰雞ex|燃燒旋踢', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], noAttacksNextTurn: true };
  return addLog({ ...state, players }, '燃燒旋踢：下個自己的回合，這隻寶可夢無法使用招式', aIdx);
});

// ─── 滿月輪舞 20 + 雙方備戰 × 20 ────────────────────────────────────────────
regPre('莉莉艾的皮皮ex|滿月輪舞', bothBenchMultiplyPre(20, 20, '滿月輪舞'));

// ─── 死亡終局：若對手戰鬥位傷害指示物 ≥6 → 昏厥（造成 9999 傷害 = 必 KO）
// rulesText：「若對手的戰鬥寶可夢身上放置的傷害指示物為 6 個，則將那隻寶可夢【昏厥】。」
// 卡面字面是「6 個」→ 放寬為 ≥6（等同 60 傷以上）— 符合一般 PTCG ruling 「至少 6 個」。
regPre('超級阿勃梭魯ex|死亡終局', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const dmg = def?.damage ?? 0;
  if (dmg >= 60) {
    return { state: addLog(state, '死亡終局：對手戰鬥寶可夢傷害指示物 ≥6 個 → KO', aIdx), damage: 9999 };
  }
  return { state: addLog(state, '死亡終局：對手戰鬥寶可夢傷害不足 6 個，造成 0 傷害', aIdx), damage: 0 };
});

// v2.113+ 未實裝（佔位 — 下批補完）：
//   N的索羅亞克ex｜交易 + 暗黑底牌（copy attack 類）
//   N的達摩狒狒｜復燃 + 火人加農炮
//   N的扒手貓｜暗槓（看對手手牌放回牌庫）
//   火焰雞ex｜沸騰鬥志（1/回合 棄牌區搜基本能量）
//   夠讚狗｜腎上腺力量（惡能量在身 HP+100、傷害+100）
//   龜足巨鎧｜岩石武裝（1/回合 手牌附鬥能量）
//   蓋諾賽克特｜ACE消弭（附 Tool 禁對手 ACE SPEC）
//   毒電嬰｜呼朋引伴（牌庫搜 ≤2 基礎寶可夢放備戰）
//   顫弦蠑螈｜惡棍衝天（牌庫搜惡能量 + 2 傷）
//   超級阿勃梭魯ex｜惡之鉤爪 200（看對手手牌棄 1）
//   火箭隊的狃拉｜暗算（對手備戰 snipe × 傷害）
//   超級甲賀忍蛙ex｜必殺手裡劍 + 忍者飛旋
//   Trainer：N的ＰＰ提升劑 / 阿杏的秘招 / 空手道王的演練 / 高溫燃燒器 / 塔拉剛 /
//            完全體攪拌器 / AZ的平和
//   Energy：稜鏡能量 / 新衝天能量（需擴 engine SPECIAL_ENERGY_TYPES）
