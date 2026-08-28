/**
 * 寶可夢道具（Pokemon Tool）效果模組
 *
 * v2.09 (Session 38b6)：從 effects.ts 抽離 Session 33 的 TOOL_* 登錄表 + 附加
 * 機制，作為模組化第三波（第一波 _shared、第二波 white_lily_akamatsu）。
 *
 * 本檔包含：
 *   - toolAttachEffect(toolName) — 附加道具到己方寶可夢的 EffectFn 工廠
 *   - reg('氣球' / '龐克頭盔') — 兩張有特殊原因需顯式登錄的道具
 *   - regR('attach-tool') — heal-target 選擇後把道具 attach 到目標寶可夢
 *   - TOOL_* 八張登錄表（HP_BONUS / ATTACK_BONUS / DEFENSE_REDUCE_BY_TYPE /
 *     PREVENT_KO / ON_KO / PRIZE_BONUS / ON_DAMAGED / RETREAT_MOD）
 *   - TOOL_BOTH_SIDES_RETREAT_PLUS Set
 *   - 每張具體道具的效果登錄（英雄斗篷、勇氣護符、極限腰帶、豪華斗篷 …）
 *   - 自動 attach reg 區塊（將所有在 TOOL_* 中登錄的道具自動補 attach effect）
 *
 * 下游：
 *   - engine.ts 透過 effects.ts re-export 取用 TOOL_* Maps
 *   - effects.ts 的 effectiveHPInline() 仍需 TOOL_HP_BONUS 計算有效 HP
 *
 * 註：本檔為 side-effect 模組 — import 它即完成所有登錄。
 *
 * 搬遷原則：內容逐字 copy 自原 effects.ts，不更動任何邏輯；只把 莉莉艾的珍珠
 * 從檔尾搬前（使其也被自動登記區覆蓋），於是可拿掉原先的 if-guard。
 */

import type { Card, EnergyType } from '$lib/cards/types';
import { isMegaExCard } from '../../selection-filter'; // v6.072 訂製背心：Mega ex 中央述詞（leaf）
import type { GameState, CardInstance } from '../../types';
import type { EffectFn } from '../_shared';
import {
  TRAINER_EFFECTS,
  PENDING_REFRESH_ON_POP,   // v6.215 佇列取出時重算 picker params
  reg, regR, regG, regPost,
  TRAINER_GUARDS,  // v6.072 自動 Tool guard：已自訂 guard 的道具不覆蓋
  addLog, updatePlayer, withPending, shuffle,
  hasMultiToolRelay, isLotomFamily,
} from '../_shared';
// v3.66：規則寶可夢統一判定 helper
import { isRulePokemon, computeRetreatCostForKOedActive } from '../../engine';  // v6.136 沉重接力棒判有效撤退費
import { applyStatusToOppActive, getEffectivePokemonTypes } from '../../effects';  // v6.206 中央有效屬性述詞
import { getEffectiveWeaknessType } from '../../effects';  // v6.207 與傷害引擎共用的「當下實際弱點」述詞
// v5.070：沉重接力棒分配能量改用 startEnergyChain — UI 顯示能量類型 + 同屬性 +/- counter
import { startEnergyChain } from './v158_energy_chain';

// ══════════════════════════════════════════════════════════════════════════════
// Session 33 — 寶可夢道具（Tool）效果登錄表
//
// 設計：每個 tool 的效果都是一小段「在 ATTACK 流程特定時機觸發」的 hook。
// 引擎在 ATTACK handler 查表呼叫，沒註冊的 tool 沒效果。
//
// 觸發點（依序）：
//   1. TOOL_HP_BONUS            — 防守方有效 HP 增加（影響 KO 判定）
//   2. TOOL_ATTACK_BONUS        — 攻擊方 +N 傷害（weakness 後）
//   3. TOOL_DEFENSE_REDUCE_BY_TYPE — 攻擊屬性符合時防守方 -N，觸發後丟棄道具
//   4. TOOL_PREVENT_KO          — 滿血被 KO 時保留 HP，觸發後丟棄道具
//   5. TOOL_ON_KO               — 被 KO 時的額外效果（如抽牌、移能量）
//   6. TOOL_PRIZE_BONUS         — 被 KO 時對手多獲 N 張獎賞
//   7. TOOL_ON_DAMAGED          — 被打到但未 KO 時觸發（如反傷、抽牌）
//   8. TOOL_RETREAT_MOD         — 撤退成本修正
// ══════════════════════════════════════════════════════════════════════════════

export const TOOL_HP_BONUS = new Map<string, (holderCard: Card) => number>();
export const TOOL_ATTACK_BONUS = new Map<string, (
  attackerCard: Card, attackerInst: CardInstance,
  defenderCard: Card, defenderInst: CardInstance
) => number>();
export const TOOL_DEFENSE_REDUCE_BY_TYPE = new Map<string, {
  amount: number;
  types: EnergyType[];
  discardOnTrigger: boolean;
  /** v2.176: holder 自身屬性過濾 — 只在 holder 屬於這些屬性時觸發；空 = 無 holder 限制 */
  holderTypes?: EnergyType[];
}>();
/**
 * v2.176: 防守方道具 — 攻擊方擁有特性時 -N（神聖護符）
 * Hook：fn(attackerCard) => amount。回傳 0 = 不觸發。
 */
export const TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY = new Map<string, (
  attackerCard: Card
) => number>();
/**
 * v6.072：依「攻擊方**卡片本身**」的防守減傷。與上面 _ABILITY 那支的差別＝
 *   呼叫端**不會**先要求「攻擊方有有效特性」，判準完全由 callback 自己決定。
 *   額外傳 holderCard，因為卡面常帶「附有這張卡的寶可夢（…除外）」這種持有者條件。
 * ⚠ 新增成員時 engine.ts 主傷害管線與 effects.ts 狙擊/備戰管線**兩處都要接**
 *   （v6.049 已痛過：兩份獨立實作，漏一邊就會漂移）。
 */
export const TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD = new Map<string, (
  attackerCard: Card, holderCard: Card | undefined
) => number>();
export const TOOL_PREVENT_KO = new Map<string, (
  holderInst: CardInstance, holderCard: Card, incomingDamage: number
) => { prevent: boolean; leaveHP: number }>();
// v5.067：signature 加 koInst 參數 — 讓 callback 能直接從 koInst.energyAttached 撈
//   被 KO 寶可夢身上的能量，避免從 discard 倒序撈時撞到工具卡/進化卡誤 break。
//   起源：吼鯨王ex 附沉重接力棒被 KO 時，舊邏輯「discard 倒序遇非基本能量就 break」
//   會在第一張（沉重接力棒自己）就 break → 抓不到能量 → 反擊效果不觸發（玩家回報）。
export const TOOL_ON_KO = new Map<string, (
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, pool: Map<string, Card>, koInst: CardInstance,
  // v6.215：使用招式的寶可夢在**攻擊當下**的 iid 快照（延後觸發的道具用它定位攻擊方，
  //   因為「自身與備戰互換」型招式解完後 players[aIdx].active 已經不是攻擊者了）。
  attackerIid?: string
) => GameState>();
export const TOOL_PRIZE_BONUS = new Map<string, (holderCard: Card) => number>();
export const TOOL_ON_DAMAGED = new Map<string, (
  state: GameState, dIdx: 0 | 1, aIdx: 0 | 1, damage: number, pool: Map<string, Card>,
  attackerIid?: string   // v6.215 見 TOOL_ON_KO 註解
) => GameState>();
export const TOOL_RETREAT_MOD = new Map<string, (
  holderCard: Card, holderInst: CardInstance, effHP?: number
) => { reduceBy?: number; zero?: boolean }>();

// ── HP 加成 ──────────────────────────────────────────────────────────────────
TOOL_HP_BONUS.set('英雄斗篷', () => 100);
TOOL_HP_BONUS.set('勇氣護符', (card) => !card.evolvesFrom ? 50 : 0);
TOOL_HP_BONUS.set('豪華斗篷', (card) => {
  // v3.66：改用 isRulePokemon helper
  return isRulePokemon(card) ? 0 : 100;
});
// 驅勁能量 古代/未來：v2.222 加 gate — 必須附在「古代/未來」寶可夢身上才生效
//   卡面：「附有這張卡的『古代』寶可夢的最大HP +60」
//   雖然 UI 端不會給玩家附錯，但若引擎/AI 強制附（如 ATTACK_POST 自動附），
//   仍要檢查 tag 才不會變成 free HP buff 給非古代寶可夢
TOOL_HP_BONUS.set('驅勁能量 古代', (card) => card.tags?.includes('古代') ? 60 : 0);
// Wave 42：竹蘭的力量負重（道具）— 「竹蘭的」寶可夢 HP +70
TOOL_HP_BONUS.set('竹蘭的力量負重', (card) => card.name.includes('竹蘭的') ? 70 : 0);

// ── 攻擊加成（我方帶此道具 → 打出時 +N）────────────────────────────────────
TOOL_ATTACK_BONUS.set('極限腰帶', (_a, _ai, defCard) => {
  // v3.67：改用 isRulePokemon helper（涵蓋 V/VMAX/VSTAR 與未來新規則類型）
  return isRulePokemon(defCard) ? 50 : 0;
});
// v4.4991 fix：中毒實際存 secondaryStatus（status 只在純中毒、無行動狀態時為 'poisoned'）
TOOL_ATTACK_BONUS.set('鎖鏈糬', (_a, atkInst) => (atkInst.status === 'poisoned' || atkInst.secondaryStatus === 'poisoned' || atkInst.tertiaryStatus === 'poisoned') ? 40 : 0);
TOOL_ATTACK_BONUS.set('驅勁能量 未來', () => 20);
// v2.133 電氣球：附有的「皮卡丘ex」對對手戰鬥場的「寶可夢ex」+50
TOOL_ATTACK_BONUS.set('電氣球', (attCard, _ai, defCard) => {
  if (attCard.name !== '皮卡丘ex') return 0;
  // v3.67：改用 isRulePokemon helper
  return isRulePokemon(defCard) ? 50 : 0;
});
// ── 猛攻手鐲（Tool）— 對對手戰鬥場 ex +30 ───────────────────────────────────
//   卡面: 「附有這張卡的寶可夢（『擁有規則的寶可夢』除外）」
//   v5.256: 補 holder gate — attackerCard 是 rule pokemon (ex/V/VMAX 等) 時不生效.
TOOL_ATTACK_BONUS.set('猛攻手鐲', (attackerCard, _ai, defCard) => {
  // v5.256：holder 是擁有規則的寶可夢 → 不該生效 (卡面除外條款)
  if (isRulePokemon(attackerCard)) return 0;
  // v3.67：改用 isRulePokemon helper
  return isRulePokemon(defCard) ? 30 : 0;
});
// v2.170 活力頭帶：使用招式 +10 傷害
TOOL_ATTACK_BONUS.set('活力頭帶', () => 10);
// v2.170 赫普的講究頭帶：「赫普的」寶可夢招式 +30
//   注意：「能量減少 1 個【無】」部分需要 cost hook，本版未實裝（已記入 SKIPPED）
TOOL_ATTACK_BONUS.set('赫普的講究頭帶', (atkCard) =>
  atkCard.name?.startsWith('赫普的') ? 30 : 0);

// ── 特定屬性防禦（防守方帶此道具 → 特定屬性攻擊 -60，觸發即丟棄） ─────────
TOOL_DEFENSE_REDUCE_BY_TYPE.set('福祿果', { amount: 60, types: ['Psychic'], discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('巧可果', { amount: 60, types: ['Fire'],    discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('千香果', { amount: 60, types: ['Water'],   discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('刺耳果', { amount: 60, types: ['Darkness'], discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('霹霹果', { amount: 60, types: ['Metal'],   discardOnTrigger: true });
TOOL_DEFENSE_REDUCE_BY_TYPE.set('莓榴果', { amount: 60, types: ['Dragon'],  discardOnTrigger: true });

// v2.176 渾厚鱗片：附有這張卡的【龍】寶可夢，受到對手【草】【火】【水】【雷】招式 -50（不丟棄）
TOOL_DEFENSE_REDUCE_BY_TYPE.set('渾厚鱗片', {
  amount: 50,
  types: ['Grass', 'Fire', 'Water', 'Lightning'],
  discardOnTrigger: false,
  holderTypes: ['Dragon'],
});

// v2.176 神聖護符：附有這張卡的寶可夢，受到對手擁有特性的寶可夢招式 -30（不丟棄）
TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY.set('神聖護符', (attackerCard) => {
  return (attackerCard.abilities && attackerCard.abilities.length > 0) ? 30 : 0;
});

// v6.072 訂製背心（M6・J，PokemonTool）—
//   「附有這張卡的寶可夢（『超級進化寶可夢【ex】除外』）受到對手的
//     『超級進化寶可夢【ex】』招式的傷害「-60」點。」
//   ⚠ 兩個條件都要：攻擊方是 Mega ex **且** 持有者自己**不是** Mega ex。
//   ⚠ 卡面沒寫「丟棄這張卡」→ 觸發後不丟。
TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD.set('訂製背心', (attackerCard, holderCard) => {
  if (!isMegaExCard(attackerCard)) return 0;
  if (isMegaExCard(holderCard)) return 0;   // 卡面「超級進化寶可夢【ex】除外」
  return 60;
});

// ── 防 KO（滿血被 KO 時留 10 HP） ─────────────────────────────────────────
TOOL_PREVENT_KO.set('倖存鍛鍊器', (inst, card) => {
  const hp = card.hp ?? 0;
  if (inst.damage === 0 && hp > 10) return { prevent: true, leaveHP: 10 };
  return { prevent: false, leaveHP: 0 };
});

// ── 被 KO 時效果 ───────────────────────────────────────────────────────────
// v2.232 升級為 deck-search pending（不再簡化）；原版固定抽頂 3 張是錯的。
//   卡面實際是「從牌庫任意選擇最多 3 張卡加入手牌，並重洗牌庫」— 應讓玩家自選。
//   actorIdx = dIdx（被 KO 方的玩家做選擇）。共用 search-to-hand-reshuffle。
TOOL_ON_KO.set('希望護身符', (state, dIdx, _aIdx, _pool, _koInst) => {
  if (state.players[dIdx].deck.length === 0) {
    return addLog(state, '希望護身符：牌庫為空', dIdx);
  }
  state = addLog(state, '希望護身符：從牌庫任意選擇最多 3 張卡加手牌並重洗', dIdx);
  return withPending(state, {
    type: 'deck-search',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: Math.min(3, state.players[dIdx].deck.length),
    filter: 'any',
    effectKey: 'search-to-hand-reshuffle',
    // v6.097：希望護身符 卡面「…從自己的牌庫任意選擇最多3張卡加入手牌。並且重洗牌庫。」
    //   **沒有**「在給對手看過後」→ 卡名不可對外公開。
    params: { privateReveal: true },
  });
});
// v2.233 升級為玩家自選 + 逐張分配（之前簡化為「最近 3 張基本能量自動附第 1 個備戰」）
//   卡面：「選擇最多 3 張那隻寶可夢身上附加的基本能量卡，以任意方式改附於
//          自己的備戰寶可夢身上。」
//   實作：
//     1. 從 discard 倒序撈最近被 KO 的基本能量（最多 3 張）作為候選池
//     2. 開 discard-search pending（filter='Any', minCount=0, maxCount=N，
//        validIids 限定候選池）讓玩家挑要附的張數
//     3. resolver 逐張開 heal-target pending（validIids 限備戰）讓玩家分配
TOOL_ON_KO.set('沉重接力棒', (state, dIdx, _aIdx, pool, koInst) => {
  const player = state.players[dIdx];
  if (player.bench.length === 0) return state;
  // v6.136 ⚠ 卡面條件「附有這張卡的**【撤退】所需的能量為4個**的寶可夢」——
  //   舊實作完全沒判這一條，任何撤退費的寶可夢附上去都會生效（玩家回報）。
  //   走中央 computeRetreatCostForKOedActive：判定基準是**昏厥當下的有效撤退費**
  //   （含氣球/緊急滑板/重力之玉/天空徑線/N的城堡/磁鐵【鋼】能量/特性/鼓擊等全部修正），
  //   不是卡面印刷值 —— 依官方裁定「附 3 張重力之玉的普隆隆姆ex 被 KO 時可以發動」。
  //   ⚠ 不能用 computeActiveRetreatCostFor：此時 active 已被設為 null（恆回 0）。
  if (computeRetreatCostForKOedActive(state, dIdx, koInst, pool) !== 4) return state;
  // v5.067：直接從 koInst.energyAttached snapshot 撈基本能量（最多 3 張）
  //   舊邏輯「discard 倒序遇非基本能量就 break」會在第一張工具卡（沉重接力棒自己）
  //   就 break，導致吼鯨王ex 等附工具卡的寶可夢的能量都撈不到 → 反擊效果不觸發。
  //   新邏輯直接讀 koInst 的能量 snapshot，不依賴 discard 順序，正確且穩定。
  const candidateIids: string[] = [];
  for (const e of koInst.energyAttached) {
    if (candidateIids.length >= 3) break;
    const ec = pool.get(e.cardId);
    if (ec?.supertype === 'Energy' && ec.subtype === 'Basic') {
      candidateIids.push(e.iid);
    }
  }
  if (candidateIids.length === 0) return state;
  state = addLog(state,
    `沉重接力棒：選最多 ${candidateIids.length} 張基本能量改附於備戰寶可夢`, dIdx);
  // v5.069 UX：加 titleOverride 讓 picker 標題明確「沉重接力棒：選擇基本能量」
  //   而非預設「從棄牌區選擇」— 玩家清楚知道 modal 是 KO 反擊觸發，不會誤以為遊戲卡住
  return withPending(state, {
    type: 'discard-search',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: candidateIids.length,
    effectKey: 'heavy-baton-pick-energies',
    params: {
      validIids: candidateIids,
      titleOverride: `沉重接力棒：選擇 0∼${candidateIids.length} 張基本能量改附於備戰寶可夢`,
    },
  });
});
regR('heavy-baton-pick-energies', (st, idx, energyIids, _params, pool) => {
  if (energyIids.length === 0) {
    return addLog(st, '沉重接力棒：未選擇能量', idx);
  }
  // v5.070：改用 startEnergyChain helper（v2.158 通用能量分配 chain，X啟動 / 燃燒充能 /
  //   金屬製造者 等都共用此 pattern）。自動處理：
  //   - 0 bench → 能量留 discard（startEnergyChain 內建 leftover log）
  //   - 1 bench → 直接全附（避免反覆彈 UI）
  //   - 同屬性多 bench → 開 energy-distribute pending 用 +/- counter UI（UI 顯示 【火】能量 等）
  //   - 混屬性多 bench → 按 type 分波（先全部【火】後全部【水】），每波 +/- counter
  //   爲 v3.57 wave-by-type pattern，UI 標題清楚顯示「分配【X】能量到 N 個合法目標」。
  //   source='discard'（能量在 KO 時已搬到 dIdx 的 discard）；
  //   scope='bench-only'（卡面「附於自己的備戰寶可夢身上」— 不含戰鬥位）；
  //   filterType='Any'（不限備戰寶可夢屬性）。
  return startEnergyChain(st, idx, energyIids, {
    label: '沉重接力棒',
    source: 'discard',
    scope: 'bench-only',
    filterType: 'Any',
  }, pool);
});
// v5.070：原 heavy-baton-distribute resolver 已被 startEnergyChain 取代，移除以避免代碼分歧

// ── 被擊倒時對手多獲 1 張獎賞 ─────────────────────────────────────────────
TOOL_PRIZE_BONUS.set('豪華斗篷', (card) => {
  // v3.66：改用 isRulePokemon helper
  return isRulePokemon(card) ? 0 : 1;
});

// ── 莉莉艾的珍珠（Pokemon Tool） ────────────────────────────────────────────
// v5.122 卡面修正：「附有這張卡的『莉莉艾的寶可夢』受到對手的寶可夢招式的傷害而
//   【昏厥】時，被獲得的獎賞卡減少 1 張。」
//   → 條件是「卡名前綴『莉莉艾的』」，不是 isRulePokemon（ex/V/VMAX）！
//   玩家回報：莉莉艾的花療環環（Basic 非 ex）+ 莉莉艾的珍珠 → 對手獎賞沒 -1。
//   根因：原 v3.66 誤用 isRulePokemon → 花療環環不是規則寶可夢 → 返回 0。
//   修法：改用 card.name.startsWith('莉莉艾的')
//   涵蓋（MC 全部 7 隻）：莉莉艾的皮皮ex / 莉莉艾的皮可西 / 莉莉艾的花療環環 / etc.
TOOL_PRIZE_BONUS.set('莉莉艾的珍珠', (card) => {
  return card?.name?.startsWith('莉莉艾的') ? -1 : 0;
});

// ── 受傷（未 KO）觸發 ──────────────────────────────────────────────────────
// v5.080：通用 helper — 卡面「受到傷害時」依 PTCG 規則含 KO 情境，
//   同一 fn 同時註冊到 TOOL_ON_DAMAGED + TOOL_ON_KO。
//   damage 參數在 KO 路徑傳 0（適用於不依賴 damage 值的道具；
//   依賴 baseDamage 的「豪邁炸彈」240 點以上條件未來 v5.081 處理）。
/**
 * v6.120 ⭐ 這些道具的**卡面是「受到…傷害時」，不是「昏厥時」**。
 *
 * 之所以同一支 fn 也被塞進 `TOOL_ON_KO`，純粹是為了讓「引擎主管線的 KO 分支」也能觸發 ——
 * 那條分支不會跑 `TOOL_ON_DAMAGED`（KO 與非 KO 是互斥的 if/else），而依 PTCG 規則
 * 「受到傷害時」是包含「被這次傷害打死」的情況的。所以它是一個**補償性的鏡射**。
 *
 * ⚠⚠ 但中央傷害 helper（狙擊／延後傷害／多目標）跟引擎主管線的結構不同：它們是
 * **先 `fireDefenderOnDamaged`、KO 時再 `fireDefenderOnKO`**，兩者都會跑。
 * 於是同一次傷害就把這些道具觸發了**兩次**（玩家回報「手持循環扇發動 2 次」；
 * 幸運頭盔會抽 4 張、凸凸頭盔會反傷 40）。
 *
 * 因此把「哪些名字是鏡射來的」公開出來，讓 `fireDefenderOnKO` 在
 * 「這次傷害的 on-damaged 已經跑過了」時跳過它們。
 * ⭐ 通則：**同一個效果同時掛在兩個 hook 上時，一定要有一個地方知道「另一個 hook 跑過沒有」**，
 *   否則只要有任何一條路徑同時跑兩個 hook，就會靜默地觸發兩次。
 */
export const TOOL_ON_KO_MIRRORED_FROM_DAMAGED = new Set<string>();

/**
 * ⭐⭐⭐ v6.260：卡面**沒有**「在戰鬥場」的 TOOL_ON_KO 道具（備戰被對手招式傷害 KO 也觸發）。
 * 逐卡宣告制（Rule 28）＋ fail-closed：沒列在這裡 = 只在戰鬥場觸發（既有行為）。
 * 卡面逐字（static/cards 台灣官方）：
 *   希望護身符（SV8 11278）「附有這張卡的寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，…」
 *     —— 沒有「在戰鬥場」⇒ 備戰也觸發。
 *   對照：沉重接力棒（SV5M 9907）「…在戰鬥場上受到…」⇒ 只在戰鬥場（不列入）。
 *   鏡射道具（幸運頭盔/凸凸頭盔/火箭隊的催眠裝置/逆境保險/奢華炸彈/手持循環扇）
 *     卡面全部有「在戰鬥場」⇒ 不列入。
 */
export const TOOL_ON_KO_BENCH_ALSO = new Set<string>(['希望護身符']);

/**
 * ⭐⭐⭐ v6.215：官方處理順序是 **招式效果先於「受到傷害時」道具效果**。
 *
 * `PTCG RULES/PTCG_RULES.md` §17.22.A L1530-1531 逐字：
 *   Q:「幸運頭盔」抽卡 與 招式「脅迫獠牙」丟手牌，何者先執行？
 *   A: 先因招式「脅迫獠牙」的效果將自己的手牌丟棄。／
 *      之後，因寶可夢道具卡「幸運頭盔」的效果從牌庫抽卡。
 * L2916 另證：「會在招式造成傷害後才執行寶可夢道具卡『幸運頭盔』的效果處理」。
 * 同方向的跨個案判例：§17.2.A L606-607（學習裝置：先丟棄能量）、
 * §17.2.A L604-605（特性反擊針：先恢復30點HP）、§16.1 L549（先處理發動方的招式效果）。
 *
 * 但 engine 的 ATTACK 主流程是 `TOOL_ON_DAMAGED / TOOL_ON_KO` 先跑、`ATTACK_POST`（招式效果）
 * 後跑 —— 與官方**相反**（v4.933 起的既有行為）。名單內的道具會被 engine 延後到
 * ATTACK_POST 之後才觸發，藉此對齊官方序。
 *
 * ⚠ 名單只放「不會對攻擊方造成傷害、不牽動昏厥判定」的道具。反傷型
 * （凸凸頭盔／奢華炸彈／豪邁炸彈／龐克頭盔）與 火箭隊的催眠裝置 **刻意不放** ——
 * 它們會牽動昏厥判定／獎賞卡／補位／雙 KO，風險遠大於收益（站長 2026-08-22 裁定暫緩）。
 *
 * ⚠ 只影響 engine 主管線。中央傷害 helper（狙擊／多目標／延後傷害）的
 * `fireDefenderOnDamaged` 本身就是**從 ATTACK_POST 內**被呼叫的，已經在招式效果之後。
 */
export const TOOL_FIRE_AFTER_ATTACK_EFFECT = new Set<string>([
  '幸運頭盔',      // 純抽牌，不碰攻擊方
  '逆境保險',      // 純抽牌，不碰攻擊方
  '手持循環扇',    // 搬攻擊方能量（目標用攻擊當下 iid 快照）
]);

/**
 * v6.215：用「攻擊當下的 iid 快照」找出使用招式的寶可夢。
 * 延後觸發的道具不可以再讀 `players[aIdx].active` —— `selfSwapPost` 家族（自身與備戰互換）
 * 在 ATTACK_POST 開 `do-switch` picker，會**先於**延後的道具解完，此刻 active 已經換人。
 *
 * ⚠⚠ **fail-closed**：沒帶快照就回 `null`（效果不發動），**不退回讀 active**。
 *   理由（長期記憶「新旗標未傳＝fail-closed」）：退回讀 active 會讓「呼叫端忘了傳」
 *   變成一個**測不出來**的錯誤 —— 表面照常運作、只有在自身互換那種場合才悄悄打錯人。
 *   目前 4 個呼叫端（engine 的 KO / 非 KO 分支、effects.ts 的 fireDefenderOnDamaged /
 *   fireDefenderOnKO）全部都傳。舊版留下的 pending 由 resolver 端自己顯式補值。
 */
function findAttackerInstance(
  state: import('../../types').GameState, aIdx: 0 | 1, attackerIid?: string,
): CardInstance | null {
  if (!attackerIid) return null;
  const ap = state.players[aIdx];
  if (ap.active?.iid === attackerIid) return ap.active;
  return ap.bench.find(b => b.iid === attackerIid) ?? null;   // 已離場 ⇒ null ⇒ 效果不發動
}

function registerToolOnDamagedAndKO(
  name: string,
  fn: (state: import('../../types').GameState, dIdx: 0|1, aIdx: 0|1, damage: number, pool: Map<string, import('$lib/cards/types').Card>, attackerIid?: string) => import('../../types').GameState,
): void {
  TOOL_ON_DAMAGED.set(name, fn);
  TOOL_ON_KO.set(name, (state, dIdx, aIdx, pool, _koInst, attackerIid) => fn(state, dIdx, aIdx, 0, pool, attackerIid));
  TOOL_ON_KO_MIRRORED_FROM_DAMAGED.add(name);
}

registerToolOnDamagedAndKO('幸運頭盔', (state, dIdx) => {
  state = addLog(state, '幸運頭盔：抽 2 張', dIdx);
  return updatePlayer(state, dIdx, p => {
    const taken = p.deck.slice(0, 2);
    return { ...p, deck: p.deck.slice(2), hand: [...p.hand, ...taken] };
  });
});
// v2.170 凸凸頭盔：受傷時對攻擊方 +20 傷害（2 個傷害指示物）
registerToolOnDamagedAndKO('凸凸頭盔', (state, _dIdx, aIdx) => {
  return updatePlayer(addLog(state, '凸凸頭盔：對攻擊方放置 2 個傷害指示物（+20）', null), aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 20 } };
  });
});
// v2.170 火箭隊的催眠裝置：受傷時若 holder 為「火箭隊的」寶可夢，將攻擊方睡眠
registerToolOnDamagedAndKO('火箭隊的催眠裝置', (state, dIdx, aIdx, _dmg, pool) => {
  const dp = state.players[dIdx];
  const holder = dp.active;
  if (!holder) return state;
  const holderCard = pool.get(holder.cardId);
  if (!holderCard?.name?.startsWith('火箭隊的')) return state;
  // v5.675 收斂：道具讓攻擊方睡眠走中央（item-effect 不被化隱擋；補不眠/泡沫水免疫 + 欄位保留）。
  //   holder=dIdx，applyStatusToOppActive 施加於 1-dIdx=攻擊方 aIdx。
  return applyStatusToOppActive(state, dIdx, 'asleep', pool, { kind: 'item-effect', label: '火箭隊的催眠裝置' });
});
// v2.170 逆境保險：受傷時若 holder 弱點屬性 = 攻擊方屬性，從牌庫抽 3 張
registerToolOnDamagedAndKO('逆境保險', (state, dIdx, aIdx, _dmg, pool) => {
  const dp = state.players[dIdx];
  const ap = state.players[aIdx];
  if (!dp.active || !ap.active) return state;
  const dCard = pool.get(dp.active.cardId);
  const aCard = pool.get(ap.active.cardId);
  if (!dCard || !aCard) return state;
  // ⭐ v6.206：「對手戰鬥寶可夢的**屬性**」＝有效屬性，原本手刻 `aCard.pokemonType`（印刷屬性），
  //   小碎鑽｜雙重屬性（【鬥】＋【超】）／狠辣椒ex｜雙重屬性（【草】＋【火】）／
  //   鐵轍跡｜二重核心（【鬥】＋【鋼】）三張全部漏判。改走中央 getEffectivePokemonTypes
  //   （內含特性消除閘：對手的雙屬性特性被消掉時就退回印刷屬性）。
  // ⭐⭐⭐ v6.207 站長裁定：holder 側的「弱點屬性」也要吃**改寫**。原本讀印刷 weakness ⇒
  //   同一盤面傷害引擎已照新弱點 ×2（火恐龍打 超級噴火龍Xex，掌握弱點把弱點改成【火】⇒ 40→80），
  //   逆境保險卻不觸發＝兩邊對「弱點是什麼」認知不一致。改共用傷害引擎用的**同一份**述詞
  //   getEffectiveWeaknessType（妖精領域【龍】→【超】／掌握弱點覆寫／金屬防禦強化 disabled）。
  //   ⚠ actorIdx = 攻擊方 aIdx（妖精領域以攻擊方為持有方視角）；holder 是被攻擊的 dp.active。
  //   ⚠ disabled（鋁鋼橋龍ex｜金屬防禦強化「這隻寶可夢的弱點全部消除」）⇒ 此刻沒有弱點
  //     ⇒ 不可能匹配，與傷害引擎 `!w.disabled && …` 同判準。
  const _wk = getEffectiveWeaknessType(state, aIdx, dp.active, dCard, pool);
  if (_wk.disabled) return state;
  const weakness = _wk.type;
  if (!weakness) return state;
  if (!getEffectivePokemonTypes(state, aIdx, ap.active, aCard, pool).includes(weakness)) return state;
  return updatePlayer(addLog(state, '逆境保險：弱點屬性匹配 → 抽 3 張', dIdx), dIdx, p => {
    const taken = p.deck.slice(0, 3);
    return { ...p, deck: p.deck.slice(taken.length), hand: [...p.hand, ...taken] };
  });
});
registerToolOnDamagedAndKO('奢華炸彈', (state, dIdx, aIdx) => {
  // 反彈 120 傷害到攻擊方，且道具丟棄
  state = updatePlayer(state, dIdx, p => {
    if (!p.active || !p.active.toolAttached) return p;
    const tool = p.active.toolAttached;
    return { ...p, active: { ...p.active, toolAttached: undefined }, discard: [...p.discard, tool] };
  });
  state = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 120 } };
  });
  return addLog(state, '奢華炸彈：反彈 120 傷害！', null);
});

// v4.897 豪邁炸彈（M5 PokemonTool）— 240+ 超級進化ex 招式傷害 → 反擊 12 指示物
// 卡面：「附有這張卡的寶可夢（『超級進化ex』除外），在戰鬥場受到對手『超級進化ex』
//        的招式造成 240 點以上傷害時，在使用招式的寶可夢身上放置 12 個傷害指示物。
//        之後將這張卡丟棄。」
// Gates（全部要符合才觸發）：
//   1. baseDamage >= 240
//   2. 攻擊方為 超級進化ex（name 以「超級」開頭且結尾 'ex'，同 engine.ts prizesForKO）
//   3. 防守方非 超級進化ex（卡面「超級進化ex 除外」）
// 注意：iterate getAllAttachedTools 找特定的「豪邁炸彈」instance 並丟棄（單張 fire；多張不疊加）
TOOL_ON_DAMAGED.set('豪邁炸彈', (state, dIdx, aIdx, baseDamage, pool) => {
  // Gate 1: 傷害門檻
  if (baseDamage < 240) return state;
  const dPlayer = state.players[dIdx];
  const aPlayer = state.players[aIdx];
  if (!dPlayer.active || !aPlayer.active) return state;
  // Gate 2: 攻擊方為 超級進化ex
  const aCard = pool.get(aPlayer.active.cardId);
  const isAttackerMegaEx = isMegaExCard(aCard);
  if (!isAttackerMegaEx) return state;
  // Gate 3: 防守方非 超級進化ex
  const dCard = pool.get(dPlayer.active.cardId);
  const isDefenderMegaEx = isMegaExCard(dCard);
  if (isDefenderMegaEx) return state;
  // 找出 defender 身上對應的「豪邁炸彈」instance（含 toolAttached + extraTools）
  const allTools: CardInstance[] = [];
  if (dPlayer.active.toolAttached) allTools.push(dPlayer.active.toolAttached);
  if (dPlayer.active.extraTools) allTools.push(...dPlayer.active.extraTools);
  const luxuryBombInst = allTools.find(t => pool.get(t.cardId)?.name === '豪邁炸彈');
  if (!luxuryBombInst) return state;
  // 1. 把該 豪邁炸彈 從 defender 移到棄牌堆
  state = updatePlayer(state, dIdx, p => {
    if (!p.active) return p;
    let active = p.active;
    if (active.toolAttached?.iid === luxuryBombInst.iid) {
      active = { ...active, toolAttached: undefined };
    } else if (active.extraTools) {
      active = { ...active, extraTools: active.extraTools.filter(x => x.iid !== luxuryBombInst.iid) };
    }
    return { ...p, active, discard: [...p.discard, luxuryBombInst] };
  });
  // 2. 攻擊方 +120 傷害（12 個指示物）
  state = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: p.active.damage + 120 } };
  });
  return addLog(state,
    `豪邁炸彈：${aCard?.name ?? '?'} 受到 ${baseDamage} 點超級進化ex 招式傷害（≥240） → 放 12 個傷害指示物（+120）！道具丟棄`,
    null);
});

// v2.210 手持循環扇：受傷未 KO 時，holder 從 attacker.active 選 1 個能量，
//   改附到 attacker 的 1 隻備戰寶可夢。對攻擊方不利（抽走主力能量）。
// 卡面：「附有這張卡的寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，選擇 1 個
//   使用招式的寶可夢身上附加的能量，改附於對手的備戰寶可夢身上。」
// 觸發：holder 在戰鬥場 + 受到對手招式傷害（已由 engine ATTACK 流程確保）
// actor = dIdx（防守方/holder 端做選擇）
// 兩段 pending：
//   1. modal-choice：列出 attacker.active 的能量為 options
//   2. opp-bench-choose：選 attacker 備戰寶可夢
registerToolOnDamagedAndKO('手持循環扇', (state, dIdx, aIdx, _dmg, pool, attackerIid) => {
  const ap = state.players[aIdx];
  // ⭐ v6.215：本道具已延後到 ATTACK_POST 之後才觸發（官方序：招式效果 → 道具）。
  //   ⇒ 「使用招式的寶可夢」必須用攻擊當下的 iid 快照定位，禁讀 players[aIdx].active。
  //   ⇒ 招式若先自丟能量（蒼炎刃鬼ex｜紫水晶激怒「將這隻寶可夢身上附加的能量卡全部丟棄」），
  //      這裡就真的沒有能量可搬 —— 原本順序相反時反而幫攻擊方保住 1 顆能量。
  const holder = findAttackerInstance(state, aIdx, attackerIid);
  if (!holder || holder.energyAttached.length === 0) {
    // 使用招式的寶可夢已離場、或身上無能量 → 無效果
    return state;
  }
  if (ap.bench.length === 0) {
    // 攻擊方無備戰寶可夢 → 沒地方放，無效果
    return state;
  }
  // 列出能量選項（⭐ 用能量 iid 當 option id，不用陣列索引 —— 索引會因招式自丟能量而位移）
  const energyOptions = holder.energyAttached.map((e) => ({
    id: e.iid,
    text: `${pool.get(e.cardId)?.name ?? '能量'}`,
  }));
  state = addLog(state,
    '手持循環扇：選 1 個攻擊方能量改附到攻擊方備戰',
    dIdx);
  return withPending(state, {
    type: 'modal-choice',
    actorIdx: dIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'cycle-fan-step1-pick-energy',
    params: { label: '手持循環扇：選 1 個攻擊方戰鬥位能量', options: energyOptions, attackerIid: holder.iid },
  });
});
/**
 * ⭐ v6.215：手持循環扇的候選能量在「佇列取出時」重算。
 *
 * 官方序把招式效果排在道具之前，於是招式自己的 picker 會先解掉；若那個 resolver 動到
 * 攻擊方身上的能量（土地雲｜螺旋關節「選擇1個這隻寶可夢身上附加的能量，放回手牌。」／
 * 波爾凱尼恩｜逆火 等 returnSelfActiveEnergyPost 家族／自丟能量型），排隊當下算好的
 * options 就過時了。這裡在 picker 真正浮上檯面前重算一次。
 * 重算後若「使用招式的寶可夢」已離場、身上沒能量、或攻擊方沒有備戰 ⇒ 整筆取消。
 */
PENDING_REFRESH_ON_POP.set('cycle-fan-step1-pick-energy', (state, sel, pool) => {
  const dIdx = sel.actorIdx as 0 | 1;
  const aIdx = (1 - dIdx) as 0 | 1;
  // 舊版 pending 沒有 attackerIid ⇒ 顯式補當下 active（見 regR 的同一條相容註解）
  const _sn = sel.params?.attackerIid as string | undefined;
  const holder = findAttackerInstance(state, aIdx, _sn ?? state.players[aIdx].active?.iid);
  const ap = state.players[aIdx];
  if (!holder || holder.energyAttached.length === 0 || ap.bench.length === 0) {
    return { state: addLog(state, '手持循環扇：已無可改附的能量或備戰寶可夢，效果取消', dIdx), sel: null };
  }
  const options = holder.energyAttached.map((en) => ({
    id: en.iid,
    text: `${pool.get(en.cardId)?.name ?? '能量'}`,
  }));
  // ⚠ 只換 params.options，其餘欄位（type / effectKey / min-maxCount / actorIdx / attackerIid）照抄。
  //   不做「內容沒變就回傳原物件」的短路 —— engine 的 stampPendingToken 每次 pop 都會重新蓋章，
  //   那條短路沒有任何可觀察效果，留著只會變成測不到的死分支。
  return { state, sel: { ...sel, params: { ...sel.params, options } } };
});

// resolver step 1: 移除選中能量，開 step 2 選 attacker bench
regR('cycle-fan-step1-pick-energy', (st, dIdx, iids, params, _pool) => {
  const aIdx = (1 - dIdx) as 0 | 1;
  const _snapIid = params?.attackerIid as string | undefined;
  // v6.215 相容：v6.214 以前開的 pending 沒有 attackerIid（部署當下正在進行的對局可能還帶著）。
  //   那時的順序是「道具先開 picker」⇒ 讀當下 active 就是正確的攻擊方。顯式補值，
  //   讓 findAttackerInstance 本身維持 fail-closed。
  const holder = findAttackerInstance(st, aIdx, _snapIid ?? st.players[aIdx].active?.iid);
  const pick = iids[0];
  let removed: CardInstance | null = holder?.energyAttached.find(e => e.iid === pick) ?? null;
  // v6.215 相容：v6.214 以前的 option id 是**陣列索引**；部署當下仍在進行的對局可能還帶著
  //   那種 pending（沒有 attackerIid）。只在「沒有快照」時才走索引解讀，避免索引漂移復辟。
  if (!removed && holder && _snapIid === undefined && /^\d+$/.test(pick ?? '')) {
    removed = holder.energyAttached[parseInt(pick, 10)] ?? null;
  }
  if (!holder || !removed) {
    return addLog(st, '手持循環扇：選擇無效，效果取消', dIdx);
  }
  const _rmIid = removed.iid;
  // 從「使用招式的寶可夢」身上移除能量（它可能已被自身互換型招式換到備戰區）
  st = updatePlayer(st, aIdx, p => {
    const strip = (c: CardInstance) => (c.iid === holder.iid
      ? { ...c, energyAttached: c.energyAttached.filter(e => e.iid !== _rmIid) }
      : c);
    return {
      ...p,
      active: p.active ? strip(p.active) : p.active,
      bench: p.bench.map(strip),
    };
  });
  // 開 step 2：選 attacker 備戰；用 params 暫存被移除的能量 CardInstance
  // ⭐ v6.215：補宣告 params.validIids（＝攻擊方備戰，與 fieldPickerBaseIids('opp-bench-choose')
  //   同一份述詞、也與 UI 顯示同源）。原本沒宣告時只靠 v6.176 的兜底，
  //   `test-v6175` F 段的棘輪把它算成「裸奔的場上目標型 picker」——這一版順手還掉。
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'cycle-fan-step2-place-energy',
    params: { energy: removed, validIids: st.players[aIdx].bench.map(b => b.iid) },
  });
});
// resolver step 2: 把暫存能量附到選中的 attacker 備戰
regR('cycle-fan-step2-place-energy', (st, dIdx, iids, params, pool) => {
  const aIdx = (1 - dIdx) as 0 | 1;
  const targetIid = iids[0];
  const energy = params?.energy as CardInstance | undefined;
  if (!targetIid || !energy) {
    return addLog(st, '手持循環扇：缺少能量或目標，效果取消', dIdx);
  }
  const ap = st.players[aIdx];
  const target = ap.bench.find(c => c.iid === targetIid);
  if (!target) {
    return addLog(st, '手持循環扇：找不到目標備戰寶可夢，效果取消', dIdx);
  }
  const energyName = pool.get(energy.cardId)?.name ?? '能量';
  const targetName = pool.get(target.cardId)?.name ?? '?';
  st = addLog(st,
    `手持循環扇：${energyName} 改附到 ${targetName}（攻擊方備戰）`,
    dIdx);
  return updatePlayer(st, aIdx, p => ({
    ...p,
    bench: p.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energy] }
      : c),
  }));
});

// ── 撤退成本修正 ──────────────────────────────────────────────────────────
TOOL_RETREAT_MOD.set('緊急滑板', (card, inst, effHP) => {
  // v5.961 「剩餘HP為30以下」= 有效HP(含+HP道具/特性/場地);原 base card.hp→多重轉接+勇氣護符等誤判免撤退
  const hp = effHP ?? (card.hp ?? 0);
  const remaining = hp - inst.damage;
  if (remaining <= 30) return { zero: true };
  return { reduceBy: 1 };
});
TOOL_RETREAT_MOD.set('驅勁能量 未來', () => ({ zero: true }));
// 氣球 已有既存 engine 支援（retreat -2），這裡補註冊好保持一致性
TOOL_RETREAT_MOD.set('氣球', () => ({ reduceBy: 2 }));

// ── 重力之玉：雙方撤退 +1（需要 engine 層在計算兩側時查對面 tool） ─────
// 用一個獨立的 flag 標記，engine 計算撤退時若雙方任一 active 帶此 tool，則 +1
export const TOOL_BOTH_SIDES_RETREAT_PLUS = new Set<string>();
TOOL_BOTH_SIDES_RETREAT_PLUS.add('重力之玉');

// ══════════════════════════════════════════════════════════════════════════════
// 道具附加機制：toolAttachEffect + 氣球 / 龐克頭盔 reg + attach-tool resolver
// （從 effects.ts line 1295-1344 區塊搬入，邏輯不變）
// ══════════════════════════════════════════════════════════════════════════════

// v5.851 中央：計算「可附加此道具的自方寶可夢」— 單一真相來源。
//   picker(toolAttachEffect 的 validIids) 與自動 TRAINER_GUARD(可玩性判定) 共用，
//   一致涵蓋洛托姆ex｜多重轉接第 2 張道具（洛托姆家族已附 1 張、relay 啟用、extraTools<1 仍可附）。
//   根因（本次修）：舊 guard 只認「無 toolAttached」的目標、漏多重轉接 → 洛托姆ex 自身在戰鬥場
//   且為唯一可附目標時，卡片被判不可玩、道具附不上；備戰有其他無道具寶可夢時 guard 巧合放行才沒露餡。
//   toolAttachEffect 端的 picker filter 早已正確涵蓋多重轉接，但 guard 另寫一份 → 兩份邏輯漂移。
function toolAttachableTargets(
  st: GameState,
  idx: 0 | 1,
  pool: Map<string, Card>,
  toolName: string,
): CardInstance[] {
  const p = st.players[idx];
  const allInPlay = [...(p.active ? [p.active] : []), ...p.bench];
  const gate = TOOL_ATTACH_GATE.get(toolName);
  const relayActive = hasMultiToolRelay(st, idx, pool);
  return allInPlay.filter(pk => {
    // 容量條件：尚無道具，或（多重轉接啟用 + 洛托姆家族 + 尚未溢出第 2 張）
    const capacityOk = !pk.toolAttached
      || (relayActive && isLotomFamily(pool.get(pk.cardId)) && (pk.extraTools?.length ?? 0) < 1);
    if (!capacityOk) return false;
    // holder gate（核心記憶碟 等限定持有者）
    if (!gate) return true;
    const card = pool.get(pk.cardId);
    return card ? gate(card) : false;
  });
}

function toolAttachEffect(toolName: string): EffectFn {
  return (st, idx, pool, toolInst) => {
    if (!toolInst) return st;
    // v5.851 收斂：可附目標改走中央 toolAttachableTargets（picker 與 TRAINER_GUARD 單一真相來源，
    //   一致涵蓋洛托姆ex｜多重轉接第 2 張道具）。原 inline filter 與自動 guard 各寫一份 → guard 漏多重轉接。
    const validIids = toolAttachableTargets(st, idx, pool, toolName).map(pk => pk.iid);
    if (validIids.length === 0) {
      // gate 把所有 holder 過濾光時，clear 訊息提示
      const reason = TOOL_ATTACH_GATE.has(toolName) ? '無符合附加條件的寶可夢' : '沒有可附加道具的寶可夢';
      // 把道具放回手牌（不要從手牌消失）
      return updatePlayer(
        addLog(st, `${toolName}：${reason}，道具回到手牌`, idx),
        idx,
        pl => ({ ...pl, hand: [...pl.hand, toolInst] })
      );
    }
    st = addLog(st, `${toolName}：選擇要附加的寶可夢`, idx);
    return withPending(st, {
      type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1, filter: '',
      effectKey: 'attach-tool',
      // v6.175 站長裁定：寶可夢道具選目標可以反悔。⚠ 這裡只是**宣告**，
      //   真正的還原在 regR('attach-tool') 的空選擇分支（道具原封回手牌，
      //   道具卡沒有「每回合限一張」之類的旗標要清，故不會留下半套狀態）。
      params: { toolInst, validIids, allowCancel: true },
    });
  };
}
reg('氣球', toolAttachEffect('氣球'));
reg('龐克頭盔', toolAttachEffect('龐克頭盔'));

regR('attach-tool', (st, idx, picked, params, pool) => {
  const toolInst = params?.toolInst as CardInstance;
  if (!toolInst) return st;
  // v5.465：玩家取消附加（空選擇）→ 道具退回手牌，不可消失（手機/桌面取消鈕共用此路徑）。
  //   根因：道具在 PLAY_TRAINER 時已從手牌移除；空 resolve 原本找不到 target 也不退回 → 道具憑空消失。
  if (!picked || picked.length === 0) {
    return updatePlayer(
      addLog(st, `${pool.get(toolInst.cardId)?.name ?? '道具'}：取消附加，道具回到手牌`, idx),
      idx,
      pl => ({ ...pl, hand: [...pl.hand, toolInst] }),
    );
  }
  const targetIid = picked[0];
  // Defensive check：target 已有道具則拒絕附加（一隻寶可夢只能附加一個道具）
  const p = st.players[idx];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  const target = all.find(c => c.iid === targetIid);
  if (target?.toolAttached) {
    // v3.20 洛托姆ex｜多重轉接：名字含「洛托姆」的自方寶可夢，且自方場上有
    //   洛托姆ex 帶「多重轉接」啟用 → 第 2 張道具進 extraTools（最多 +1 張）。
    const targetCard = pool.get(target.cardId);
    const lotomFamily = isLotomFamily(targetCard);
    const relayActive = hasMultiToolRelay(st, idx, pool);
    const currentExtraCount = (target.extraTools?.length ?? 0);
    const toolName2 = pool.get(toolInst.cardId)?.name ?? '道具';
    const targetName2 = targetCard?.name ?? '?';
    if (lotomFamily && relayActive && currentExtraCount < 1) {
      // gate 通過 → push 進 extraTools
      // 注意：先檢查 TOOL_ATTACH_GATE（核心記憶碟 等限定 holder）
      const gateFn = TOOL_ATTACH_GATE.get(toolName2);
      if (gateFn && targetCard && !gateFn(targetCard)) {
        return updatePlayer(
          addLog(st, `${toolName2}：附加失敗（${targetName2} 不符合附加條件，道具回到手牌）`, idx),
          idx,
          pl => ({ ...pl, hand: [...pl.hand, toolInst] })
        );
      }
      const next = addLog(st, `🔧 ${toolName2} 附加到 ${targetName2}（多重轉接：第 2 張道具）`, idx);
      return updatePlayer(next, idx, p => {
        const attach = (pk: CardInstance): CardInstance => {
          if (pk.iid !== targetIid) return pk;
          const cur = pk.extraTools ?? [];
          return { ...pk, extraTools: [...cur, toolInst] };
        };
        return {
          ...p,
          active: p.active ? attach(p.active) : null,
          bench: p.bench.map(attach),
        };
      });
    }
    // 否則退回手牌（既有行為）
    return updatePlayer(
      addLog(st, '附加失敗：目標寶可夢已有道具，道具回到手牌', idx),
      idx,
      pl => ({ ...pl, hand: [...pl.hand, toolInst] })
    );
  }
  const targetName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const toolName = pool.get(toolInst.cardId)?.name ?? '道具';
  // v2.214：TOOL_ATTACH_GATE — 限定 holder（例：核心記憶碟 只能附超級基格爾德ex）
  const gate = TOOL_ATTACH_GATE.get(toolName);
  if (gate && target) {
    const targetCard = pool.get(target.cardId);
    if (!targetCard || !gate(targetCard)) {
      return updatePlayer(
        addLog(st, `${toolName}：附加失敗（${targetName} 不符合附加條件，道具回到手牌）`, idx),
        idx,
        pl => ({ ...pl, hand: [...pl.hand, toolInst] })
      );
    }
  }
  st = addLog(st, `🔧 ${toolName} 附加到 ${targetName}`, idx);
  return updatePlayer(st, idx, p => {
    const attach = (pk: CardInstance): CardInstance =>
      pk.iid === targetIid ? { ...pk, toolAttached: toolInst } : pk;
    return {
      ...p,
      active: p.active ? attach(p.active) : null,
      bench: p.bench.map(attach),
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 道具卡自動登記 attach effect（Wave 42 bugfix）
//
// 背景：任何登錄在 TOOL_* 映射中的道具，都需要 TRAINER_EFFECTS 中有對應的
// attach resolver，否則 engine 的 PLAY_TRAINER 會走到 isTool 分支但找不到
// effect 而 log「效果尚未實裝」，結果卡片既沒附上寶可夢、也沒回手牌，
// 直接從手牌消失。原本只有 氣球 / 龐克頭盔 有顯式 reg，其他（英雄斗篷、
// 勇氣護符、豪華斗篷、極限腰帶、鎖鏈糬、驅勁能量、倖存鍛鍊器、希望護身符、
// 沉重接力棒、幸運頭盔、奢華炸彈、緊急滑板、福祿果系列、重力之玉、
// 竹蘭的力量負重、莉莉艾的珍珠 …）都是隱性 broken，直到 Leon 實際測試到才發現。
// 這裡統一掃過所有 TOOL_* 結構，未被任何 reg() 蓋過者即註冊 toolAttachEffect。
// ══════════════════════════════════════════════════════════════════════════════

// v2.264：把「所有具備 attach-tool 機制的道具」集中到一個 export const，
//   讓檔尾的 guard 自動登記也用同一份名單（含 氣球 / 龐克頭盔 / 等沒有 TOOL_* hook 的純機械道具）。
export const ATTACH_TOOL_NAMES = new Set<string>([
  '氣球', '龐克頭盔',
  // v3.04 hotfix: inline-handled tools（engine.ts hardcoded 名字檢查，沒在任何 TOOL_* Map 裡）
  // 必須顯式加入此 Set，否則檔尾 auto-register loop 抓不到 → engine PLAY_TRAINER 走 isTool 分支
  // 但 TRAINER_EFFECTS 沒 entry → 報「效果尚未實裝」並把卡刪除！v2.149 璀璨結晶 等入坑案例
  '璀璨結晶',          // engine.ts: 太晶寶可夢使用招式 cost -1
  '反擊增幅器',        // engine.ts: 自方獎賞 > 對手時 cost -1【無】
  '力之沙漏',          // engine.ts: 持有方回合結束時觸發棄能量附加
  // v5.268+v5.273: 重試徽章 — engine.ts inline handler 處理 modal trigger,
  //   attach 機制走 toolAttachEffect (檔尾 auto-register loop 抓此 Set).
  //   v5.273 已刪除 TOOL_ATTACH_GATE → 可附任何屬性 (跟氣球一樣).
  '重試徽章',
  ...TOOL_HP_BONUS.keys(),
  ...TOOL_ATTACK_BONUS.keys(),
  ...TOOL_DEFENSE_REDUCE_BY_TYPE.keys(),
  ...TOOL_PREVENT_KO.keys(),
  ...TOOL_ON_KO.keys(),
  ...TOOL_PRIZE_BONUS.keys(),
  ...TOOL_ON_DAMAGED.keys(),
  ...TOOL_RETREAT_MOD.keys(),
  ...TOOL_BOTH_SIDES_RETREAT_PLUS,
  // v5.439：神聖護符等「攻擊方有特性時減傷」道具 — 原本漏 spread 此 map → 無法附加
  //   (玩家回報神聖護符「找不到 attach 效果註冊」退回手牌)。
  ...TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY.keys(),
  // v6.072：依攻擊方卡片減傷的道具（訂製背心）也要能被附加
  ...TOOL_DEFENSE_REDUCE_BY_ATTACKER_CARD.keys(),
]);

{
  for (const name of ATTACH_TOOL_NAMES) {
    if (!TRAINER_EFFECTS.has(name)) {
      reg(name, toolAttachEffect(name));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// v2.214 — Tool 招式注入機制（招式學習器 螢石 / 核心記憶碟）
//
// 卡面：「附有這張卡的（特定）寶可夢，可使用這張卡上寫的招式」
//   - 招式 attacks 由 scraper（v2.213）抽到 card.attacks
//   - engine.ts ATTACK handler / getEffectiveAttacks 已合併 attacker.toolAttached.attacks
//   - 這裡只需登錄招式效果（regPost effectKey='${tool 名}|${招式名}'）
//     + 額外的 hook（attach gate、回合結束自棄）
//
// 1. TOOL_ATTACH_GATE — 附加閘門
//    - fn(holderCard) => boolean (true = 可附加)
//    - 在 attach-tool resolver 檢查；返 false 則退回手牌並 log
//    - 用例：核心記憶碟 只能附「超級基格爾德ex」
//
// 2. TOOL_END_TURN_DISCARD — 持有方自己回合結束時自動棄
//    - 在 engine.ts END_TURN handler 觸發（在 力之沙漏 hook 附近）
//    - 用例：招式學習器 螢石（卡面「在自己的回合結束時丟棄」）
// ══════════════════════════════════════════════════════════════════════════════

export const TOOL_ATTACH_GATE = new Map<string, (holderCard: Card) => boolean>();
export const TOOL_END_TURN_DISCARD = new Set<string>();

// ── 招式學習器 螢石（H, M2/SV8 11281）──────────────────────────────────────
// 卡面：附有這張卡的寶可夢，可使用這張卡上寫的招式。
//       將附於寶可夢身上的這張卡，在自己的回合結束時丟棄。
//
// 招式：螢石 [草水超]
//   將這隻寶可夢身上附加的能量卡全部丟棄，將自己的所有「太晶」寶可夢的 HP 全部恢復。
//
// 實裝：
//   - 一般 attach（無 holder gate）→ toolAttachEffect 即可
//   - TOOL_END_TURN_DISCARD 加入 → engine 在自己回合結束自棄
//   - regPost('招式學習器 螢石|螢石') 招式效果：
//     * 棄掉 active 上所有能量
//     * 找場上所有「太晶」tag 寶可夢，HP 全恢復（damage = 0）
// ── 超級烈空坐帽子（J, M6 19616）v6.081 ──────────────────────────────────────
// 卡面：附有這張卡的寶可夢，可使用這張卡上寫的招式。[需要有足夠使用招式的能量。]
// 招式 德爾塔之禮 [無]：
//   從牌庫附給自己的所有身上附有「超級烈空坐帽子」的寶可夢各1張基本能量卡。並且重洗牌庫。
//
// ⚠「所有身上附有這張卡的寶可夢」→ 找 host 一律用 toolAttached ＋ extraTools
//   （多重轉接時道具會在 extraTools，只讀 toolAttached 會漏，v5.835 教訓）。
// ⚠「各 1 張」→ 每隻**剛好 1 張**，不是自由分配 → 逐隻開 picker（禁 startEnergyChain 的自由分配）。
// ⚠ 無 attach gate（卡面沒限定持有者）、不自棄（卡面沒寫回合結束丟棄）。
reg('超級烈空坐帽子', toolAttachEffect('超級烈空坐帽子'));

/** 找出自己場上所有「身上附有指定道具」的寶可夢（含 extraTools） */
function hostsWithTool(state: GameState, idx: 0 | 1, pool: Map<string, Card>, toolName: string): CardInstance[] {
  const p = state.players[idx];
  const all = [...(p.active ? [p.active] : []), ...p.bench];
  return all.filter(c => {
    const tools = [c.toolAttached, ...(c.extraTools ?? [])].filter(Boolean) as CardInstance[];
    return tools.some(t => pool.get(t.cardId)?.name === toolName);
  });
}

/** 逐隻附 1 張基本能量的 chain step（i = 目前處理到第幾隻） */
function deltaGiftStep(state: GameState, idx: 0 | 1, pool: Map<string, Card>, hostIids: string[], i: number): GameState {
  const p = state.players[idx];
  if (i >= hostIids.length) {
    return updatePlayer(addLog(state, '德爾塔之禮：重洗牌庫', idx), idx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  const hostIid = hostIids[i];
  const host = [...(p.active ? [p.active] : []), ...p.bench].find(c => c.iid === hostIid);
  if (!host) return deltaGiftStep(state, idx, pool, hostIids, i + 1);   // 已離場 → 跳過
  const hostName = pool.get(host.cardId)?.name ?? '?';
  const basicIids = p.deck
    .filter(c => { const cc = pool.get(c.cardId); return cc?.supertype === 'Energy' && cc.subtype === 'Basic'; })
    .map(c => c.iid);
  if (basicIids.length === 0) {
    return deltaGiftStep(addLog(state, `德爾塔之禮：牌庫已無基本能量（${hostName} 沒拿到）`, idx),
      idx, pool, hostIids, i + 1);
  }
  return withPending(addLog(state, `德爾塔之禮：從牌庫選 1 張基本能量附於 ${hostName}`, idx), {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'm6-delta-gift-step',
    params: { validIids: basicIids, hostIids, i, hostIid },
  });
}

regPost('超級烈空坐帽子|德爾塔之禮', (state, aIdx, pool) => {
  const hosts = hostsWithTool(state, aIdx, pool, '超級烈空坐帽子');
  if (hosts.length === 0) {
    return updatePlayer(addLog(state, '德爾塔之禮：場上沒有附有「超級烈空坐帽子」的寶可夢', aIdx),
      aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));
  }
  return deltaGiftStep(
    addLog(state, `德爾塔之禮：${hosts.length} 隻寶可夢各附 1 張基本能量`, aIdx),
    aIdx, pool, hosts.map(h => h.iid), 0);
});

regR('m6-delta-gift-step', (state, idx, iids, params, pool) => {
  const hostIids = (params?.hostIids as string[]) ?? [];
  const i = Number(params?.i ?? 0);
  const hostIid = params?.hostIid as string | undefined;
  const p = state.players[idx];
  // ⚠ 自驗：只認「還在牌庫內 ∧ 是基本能量」的 iid，且最多 1 張（卡面「各 1 張」）
  const chosen = p.deck.find(c => iids.includes(c.iid)
    && (() => { const cc = pool.get(c.cardId); return cc?.supertype === 'Energy' && cc.subtype === 'Basic'; })());
  let s = state;
  if (chosen && hostIid) {
    const eName = pool.get(chosen.cardId)?.name ?? '?';
    const hostName = pool.get(
      [...(p.active ? [p.active] : []), ...p.bench].find(c => c.iid === hostIid)?.cardId ?? '')?.name ?? '?';
    s = addLog(s, `德爾塔之禮：將 ${eName} 附於 ${hostName}`, idx);
    s = updatePlayer(s, idx, pl => {
      const give = (c: CardInstance | null) =>
        c && c.iid === hostIid ? { ...c, energyAttached: [...c.energyAttached, chosen] } : c;
      return {
        ...pl,
        active: give(pl.active) ?? null,
        bench: pl.bench.map(b => give(b)!),
        deck: pl.deck.filter(c => c.iid !== chosen.iid),
      };
    });
  }
  return deltaGiftStep(s, idx, pool, hostIids, i + 1);
});

TOOL_END_TURN_DISCARD.add('招式學習器 螢石');
reg('招式學習器 螢石', toolAttachEffect('招式學習器 螢石'));

regPost('招式學習器 螢石|螢石', (state, aIdx, pool) => {
  const players = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  const me = { ...players[aIdx] };
  const active = me.active;
  if (!active) return state;
  // 1) 棄掉 active 上所有能量
  const energyDiscard = active.energyAttached;
  if (energyDiscard.length > 0) {
    me.discard = [...me.discard, ...energyDiscard];
    me.active = { ...active, energyAttached: [] };
    state = addLog(state,
      `招式學習器 螢石 / 螢石：${pool.get(active.cardId)?.name ?? '?'} 丟棄 ${energyDiscard.length} 張能量`,
      aIdx);
  }
  // 2) 治癒場上所有太晶寶可夢
  const isTera = (c: CardInstance | null): c is CardInstance =>
    !!c && (pool.get(c.cardId)?.tags?.includes('太晶') ?? false);
  const heal = (c: CardInstance): CardInstance => isTera(c) && c.damage > 0 ? { ...c, damage: 0 } : c;
  if (me.active && isTera(me.active)) {
    me.active = heal(me.active);
  }
  me.bench = me.bench.map(c => heal(c));
  players[aIdx] = me;
  // log healed names
  const healedNames: string[] = [];
  if (active && isTera(active) && active.damage > 0) healedNames.push(pool.get(active.cardId)?.name ?? '?');
  for (const b of state.players[aIdx].bench) {
    if (isTera(b) && b.damage > 0) healedNames.push(pool.get(b.cardId)?.name ?? '?');
  }
  if (healedNames.length > 0) {
    state = addLog(state, `招式學習器 螢石 / 螢石：恢復場上太晶寶可夢的 HP（${healedNames.join('、')}）`, aIdx);
  } else {
    state = addLog(state, '招式學習器 螢石 / 螢石：場上無受傷的太晶寶可夢', aIdx);
  }
  return { ...state, players };
});

// ── 核心記憶碟（J, M3 18049）──────────────────────────────────────────────
// 卡面：附有這張卡的「超級基格爾德ex」可使用這張卡上寫的招式。
//
// 招式：大地光炮 [鬥×4] 350
//   將這隻寶可夢身上附加的能量卡全部丟棄。
//
// 實裝：
//   - TOOL_ATTACH_GATE 限定 holder.name === '超級基格爾德ex'
//   - regPost('核心記憶碟|大地光炮') 招式後棄全部能量
//     350 base damage 由 attack.damage 處理（engine 自動讀）
TOOL_ATTACH_GATE.set('核心記憶碟', (holderCard) => holderCard.name === '超級基格爾德ex');
reg('核心記憶碟', toolAttachEffect('核心記憶碟'));

// v5.273: 移除 v5.162 設的「重試徽章 Colorless 限制」
//   根因: 卡面「附有這張卡的【無屬性】寶可夢使用招式時...」是效果端 gate,
//         不是附加端. 跟氣球一樣可以附在任何屬性的寶可夢身上.
//   engine.ts L5611+ ATTACK 末端 modal trigger 已正確 gate isColorless,
//   「無屬性才能 reroll」的效果端規則仍維持.
// (原 TOOL_ATTACH_GATE.set('重試徽章', ...) 已刪)

regPost('核心記憶碟|大地光炮', (state, aIdx, pool) => {
  const players = [...state.players] as [import('../../types').PlayerState, import('../../types').PlayerState];
  const me = { ...players[aIdx] };
  const active = me.active;
  if (!active) return state;
  const energyDiscard = active.energyAttached;
  if (energyDiscard.length > 0) {
    me.discard = [...me.discard, ...energyDiscard];
    me.active = { ...active, energyAttached: [] };
    players[aIdx] = me;
    state = addLog({ ...state, players },
      `核心記憶碟 / 大地光炮：${pool.get(active.cardId)?.name ?? '?'} 丟棄 ${energyDiscard.length} 張能量`,
      aIdx);
  }
  return state;
});

// ══════════════════════════════════════════════════════════════════════════════
// v2.264 — Tool 卡 TRAINER_GUARD 自動登記
//
// 背景：sim 抓到的 PLAY_TRAINER stuck loop（竹蘭的力量負重 等）— Tool 卡的
//   resolver 在「沒有可附加道具的寶可夢」時把卡放回手牌並 log，但 UI 的
//   getPlayableTrainers 沒對應 gate → AI 一直挑同一張 → 無限迴圈。
//
// 解法：對每張已登記 toolAttachEffect 的 Tool，自動 regG 一個 guard：
//   - 場上至少 1 隻寶可夢可以附加（無 toolAttached + 通過 TOOL_ATTACH_GATE 才算）
//   - 都不可附加 → guard 返回 false → UI 不亮卡、engine 拒絕
//
// 注意：必須在 TOOL_ATTACH_GATE 全部登記完之後才能跑（檔案最尾段）。
//
// ⚠⚠ v6.072：這一整段在某次「大檔讀取截斷」中連同檔尾一起遺失（檔案結尾停在上面那條
//   註解框線的半個 UTF-8 位元組，而且已經 commit 進 repo）。esbuild/vite 用 lossy decode
//   吃下了壞掉的結尾，所以 build 一直是綠的、沒人發現。
//   行為實測（v6.072 守衛）：場上所有寶可夢都已附道具時，getPlayableTrainers 仍列出該 Tool，
//   打出後只是「道具回到手牌」、盤面零變化 —— 正是本段當初要根絕的 AI 無限迴圈條件。
//   ⭐ 通則：檔案結尾出現不完整 UTF-8 = 曾被截斷，**必須檢查尾段 code 是不是整段不見了**，
//     不能只把壞位元組砍掉了事。
// ══════════════════════════════════════════════════════════════════════════════
{
  for (const name of ATTACH_TOOL_NAMES) {
    // 已經自訂 guard 的道具不覆蓋（如需額外條件的卡自己註冊）
    if (TRAINER_GUARDS.has(name)) continue;
    // v5.851 單一真相來源：與 toolAttachEffect 的 picker validIids 共用 toolAttachableTargets，
    //   一致涵蓋洛托姆ex｜多重轉接的第 2 張道具（兩份各寫一份就會漂移）。
    regG(name, (st, idx, pool) => toolAttachableTargets(st, idx, pool, name).length > 0);
  }
}
