// v6.069 M6「綠寶石風暴」招式實裝 批次 7（12 招）
//
// 選件原則（沿用批次 1–6）：卡面措辭與既有 H/I/J 卡逐字（或語序等價）相同，
//   一律呼叫中央 helper，禁手刻、禁簡化。本批同時把 5 個維度收斂進 effects.ts 中央 helper：
//     recruitNamedToBenchPost / registerDiscardBasicEnergyMultiply / snipeCountersPost /
//     bothReturnHandAndDrawPost / oppAbilityHolderCountPre / selfImmuneToAttackDamageNextPost
//
// ⚠ 每張卡面均逐字取自 static/cards/M6.json（`effect` 欄），未經任何簡化。

import { regPre, regPost, ATTACK_PRE_DISCARD_CHOICE } from '../_shared';
import {
  recruitNamedToBenchPost,
  registerDiscardBasicEnergyMultiply,
  snipeCountersPost,
  bothReturnHandAndDrawPost,
  oppAbilityHolderCountPre,
  oppAllEnergyMultiplyPre,
  oppSwapDmgPost,
  drawToHandPost,
  registerDamageThenOptionalDeckSearchToHand,
  deckEnergyAttachSelfPost,
  selfImmuneToAttackDamageNextPost,
} from '../../effects';
import { deckEnergyAttachBenchPost } from './abra_mawile_deck';

// ── 1. 溜溜糖球｜增長 ───────────────────────────────────────────────────────
// 卡面：從自己的牌庫選擇最多2張「溜溜糖球」，放置於備戰區。並且重洗牌庫。
//   範本 燈火幽靈｜亮光增長（3 張版），本輪一併收斂進中央 recruitNamedToBenchPost。
regPre('溜溜糖球|增長', (state) => ({ state, damage: 0 }));
regPost('溜溜糖球|增長', recruitNamedToBenchPost('溜溜糖球', 2, '增長'));

// ── 2. 加熱洛托姆ex｜再次加熱 30× ──────────────────────────────────────────
// 卡面：在給對手看過自己的棄牌區的所有「基本【火】能量」卡後，造成其張數×30點傷害。
//        然後，將給對手看過的能量卡放回牌庫並重洗。
//   範本 蓋歐卡｜逆流（基本【水】、×20），本輪一併收斂。
//   ⚠「張數」＝逐張，不是「數量」（單位）→ 不走 host-aware units。
registerDiscardBasicEnergyMultiply('加熱洛托姆ex|再次加熱', 'Fire', 30, '再次加熱');

// ── 3. 啪嚓海膽｜能量粉碎 20× ──────────────────────────────────────────────
// 卡面：造成對手的所有寶可夢身上附加的能量的數量×20點傷害。
//   ⚠「能量的數量」＝**個**（單位）語意（v5.669 Wilson 裁定），必須 host-aware：
//     火箭隊能量=2、燃火能量附進化=3、新衝天能量 on Stage2=2、大竺葵｜繁茂 基本草=2。
//   （v6.069 已修好 oppAllEnergyMultiplyPre 的 'all' 分支漏傳 state → 繁茂原本沒生效。）
regPre('啪嚓海膽|能量粉碎', oppAllEnergyMultiplyPre(0, 20, 'all', '能量粉碎'));

// ── 4. 龍捲雲｜螺旋俯衝 70 ─────────────────────────────────────────────────
// 卡面：若希望，從牌庫抽卡直到自己的手牌滿6張為止。
//   範本 竹蘭的烈咬陸鯊ex｜螺旋俯衝（100）逐字相同 —— binary-yes-no 前置選擇 + drawToHandPost(6)。
//   ⚠ v5.509：抽牌放在 regPre（傷害前），避免氣絕自動取獎進手牌後少抽 1 張。
ATTACK_PRE_DISCARD_CHOICE.set('龍捲雲|螺旋俯衝', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫抽卡直到自己的手牌滿 6 張為止？',
  choiceYesLabel: '是（抽到 6）',
  choiceNoLabel: '否（跳過抽牌）',
});
regPre('龍捲雲|螺旋俯衝', (state, aIdx, pool, action) => {
  const chosen = action?.discardedEnergyIids;
  const choseYes = chosen === undefined ? true : chosen.length >= 1;
  if (!choseYes) return { state, damage: 70 };
  return { state: drawToHandPost(6, '螺旋俯衝')(state, aIdx, pool), damage: 70 };
});

// ── 5. 烈箭鷹ex｜鉤爪搜尋 150 ──────────────────────────────────────────────
// 卡面：若希望，從自己的牌庫任意選擇最多2張卡加入手牌。並且重洗牌庫。
//   範本 貓頭夜鷹｜鉤爪搜尋（70）逐字相同，中央 helper 已含「效果先於傷害」與私訊揭示。
ATTACK_PRE_DISCARD_CHOICE.set('烈箭鷹ex|鉤爪搜尋', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 0, damagePerEnergy: 0,
  choicePrompt: '是否從牌庫任意選擇最多 2 張卡加入手牌？',
  choiceYesLabel: '是（搜尋 2 張）',
  choiceNoLabel: '否（跳過搜尋）',
});
registerDamageThenOptionalDeckSearchToHand('烈箭鷹ex|鉤爪搜尋', { damage: 150, maxCount: 2, logName: '鉤爪搜尋' });

// ── 6. 勾魂眼｜不祥之眼 ────────────────────────────────────────────────────
// 卡面：在對手的1隻寶可夢身上放置5個傷害指示物。
//   範本 綿綿泡芙／納噬草｜悄聲加害（2 個／1 個），本輪一併收斂進 snipeCountersPost。
regPre('勾魂眼|不祥之眼', (state) => ({ state, damage: 0 }));
regPost('勾魂眼|不祥之眼', snipeCountersPost(5, '不祥之眼'));

// ── 7. 夢歌仙人掌｜懲罰尖刺 10+ ────────────────────────────────────────────
// 卡面：增加對手的場上擁有特性的寶可夢的數量×50點傷害。
//   ⚠「擁有特性」看**當下有效的**特性（v6.049）：被消除＝沒特性；效果被擋（監視之眼）仍算有。
regPre('夢歌仙人掌|懲罰尖刺', oppAbilityHolderCountPre(10, 50, '懲罰尖刺'));

// ── 8. 露力麗｜蹦蹦充能 ────────────────────────────────────────────────────
// 卡面：從自己的牌庫選擇1張能量卡，附於備戰寶可夢身上。並且重洗牌庫。
//   範本 謝米｜親送花朵（限【草】寶可夢），露力麗無屬性限制 → targetType = null。
//   ⚠ v5.821：targetType 是「目標寶可夢的屬性」，不是能量屬性；
//     卡面寫「能量卡」＝任意能量（含特殊能量），helper 已如此處理。
regPre('露力麗|蹦蹦充能', (state) => ({ state, damage: 0 }));
regPost('露力麗|蹦蹦充能', deckEnergyAttachBenchPost(null, '蹦蹦充能'));

// ── 9. 赤面龍｜拖出 ────────────────────────────────────────────────────────
// 卡面：選擇對手的1隻備戰寶可夢，與戰鬥寶可夢互換。然後，新上場的寶可夢受到40點傷害。
//   與 勇士雄鷹｜拖出（H 標，同為 40 點）語序等價 → 同一 helper。
//   ⚠ 這是 C-05（攻擊方選備戰）：免疫 gate 在**被選的備戰目標**，
//     原戰鬥位的「不受招式效果」不擋互換（官方 §17.3.D，v5.995）。
regPre('赤面龍|拖出', (state) => ({ state, damage: 0 }));
regPost('赤面龍|拖出', oppSwapDmgPost(40, '拖出'));

// ── 10. 巨翅飛魚｜掀起波浪 ─────────────────────────────────────────────────
// 卡面：雙方玩家各自將手牌全部放回牌庫並重洗。然後，各自從牌庫抽出4張卡。
//   ⚠ 玩家層級效果 → 不過 canApplyEffectToTarget（v5.929 背蓋化石誤擋的教訓）。
regPre('巨翅飛魚|掀起波浪', (state) => ({ state, damage: 0 }));
regPost('巨翅飛魚|掀起波浪', bothReturnHandAndDrawPost(4, '掀起波浪'));

// ── 11. 雷公ex｜雷霆纏身 ───────────────────────────────────────────────────
// 卡面：這個招式在先攻玩家的最初回合也可使用。
//        從自己的牌庫選擇1張能量卡，附於這隻寶可夢身上。並且重洗牌庫。
//   ⚠ 前半句由 FIRST_TURN_USABLE_ATTACKS 白名單處理（engine ATTACK + getAvailableAttacks 雙路徑）。
//   ⚠ 卡面寫「能量卡」（非「基本能量卡」）→ anyEnergy:true，特殊能量也可選。
regPre('雷公ex|雷霆纏身', (state) => ({ state, damage: 0 }));
regPost('雷公ex|雷霆纏身', deckEnergyAttachSelfPost(null, '雷霆纏身', { anyEnergy: true }));

// ── 12. 騎拉帝納｜渾沌匍匐 120 ─────────────────────────────────────────────
// 卡面：在下個對手的回合，這隻寶可夢不會受到招式的傷害。
//        在上個自己的回合，若自己的寶可夢使用了「渾沌匍匐」，則無法使用這個招式。
//   ⚠ 第一句是「不會受到招式的**傷害**」＝ damage-only → immuneToAttackDamageNextTurn，
//     **不是** immuneToAllAttackNextTurn（那是「傷害與效果」全免疫，會多擋掉招式效果）。
//   ⚠ 第二句主詞是「自己的**寶可夢**」（非「這隻寶可夢」）＝玩家層級冷卻 →
//     engine 的 PLAYER_LEVEL_ATTACK_COOLDOWN（讀中央 attackUsedLastSelfTurn，
//     撤退／換位／第二張同名卡都繞不過）。與 仙子伊布ex｜天仙石 同型。
regPost('騎拉帝納|渾沌匍匐', selfImmuneToAttackDamageNextPost('渾沌匍匐'));
