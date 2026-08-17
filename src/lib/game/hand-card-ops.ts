// ⭐⭐⭐ v6.200 「這張手牌卡**現在**能做哪個操作」的**唯一述詞**。
//
// 玩家回報（桌機）：烈箭鷹ex 的特性「激動俯衝」條件成立時，手牌卡**點得動、拖不動**
//   —— 卡片會亮黃框（`can-actionable`），但 `.draggable` 沒加、`onpointerdown` 也不會
//   呼叫 `startDrag`，所以連拖曳動畫都出不來。
//
// 真因（v6.199 `+page.svelte` L10845~10858）：桌機手牌卡有**兩份**互不相干的可用性判定
//   ・拖曳：`dragKind = canEnergy ? 'energy' : canBasic ? … : canTrainer ? … : null`
//     —— 這串**完全沒有** `canHandActivate`
//   ・點擊：`onclick` 讀 `canHandActivate = handActivateAbilities.has(iid)`
//   兩份條件漂移 ⇒ 只有「點擊」那條路徑認得手牌特性。
//   （同族前科：v6.098 手機版手牌特性硬編、v6.131 特性 gate vs regA、
//     v6.109 filter vs validIids —— 一律是「同一件事被寫成兩份」。）
//
// ⇒ 本模組把「手牌卡的可用操作集合」收斂成單一來源：桌機的**拖曳**與**點擊**、
//   黃框、提示文字、drop-zone 高亮全部只讀 `getHandCardOps()`。
// ⚠ 禁止在任何 UI 端硬編卡名／特性名（v6.098 守衛 `test-v6098-hand-ability-ui-central`
//   仍然有效）；新增同型手牌特性只改 engine 的 `HAND_ACTIVATE_GATES`。
// ⚠ 桌機 classic 與 fable 兩種版面共用**同一份 markup**（fable 只是 `.playmat` 上多一個
//   `layout-fable` class 的純 CSS 版面），所以修這裡兩種版面同時生效；
//   手機直式（`MobilePortraitBattle.svelte`）**沒有卡片拖曳**（點卡片開 sheet 選單，
//   每個操作各一顆按鈕），所以不存在「拖曳/點擊不一致」這個缺口。
// ⭐v6.201：手機直式原本自帶的**第三份**判定（playable{Basic,Fossil,Trainer,Evo}Iids
//   ＋ aceCancelActiveLocal ＋ handAbilityActivatableIids）已全部刪除，改讀本檔。
//   ⚠ 手機與桌機仍是**兩套獨立版面分支**（禁用 @media 當手機開關）——
//     收斂的只有「這張手牌現在能做什麼」這個述詞，版面/互動 paradigm 各自維持。
//   ⚠ 手機的「我的回合」與桌機不同源：手機 `isMyTurn = !isSpectator &&
//     activePlayerIndex === myIdx`，但 setup 階段雙方同時擺場（activePlayerIndex
//     只有一個），所以手機另外傳 `ctx.isMySetupTurn`（見 HandCardOpsCtx）。
//     沒傳＝沿用 isMyTurn ⇒ 桌機行為完全不變。

import type { Card } from '$lib/cards/types';
import type { GameState } from './types';
import {
  getPlayableBasics,
  getPlayableFossils,
  getPlayableTrainers,
  getEvolvableTargets,
  getHandActivatableAbilities,
  isBasicPokemonCard,
  isFossilItemCard,
  canBeInitialActiveCard,
  isAceCancelActive,
  getBenchLimit,
} from './engine';

/**
 * 手牌卡可執行的操作種類。
 * ⚠ 每一項都必須同時被「拖曳」與（有對應入口的）「點擊」路徑認得 ——
 *   守衛 `scripts/test-v6200-hand-drag-click-parity.mjs` 會逐項比對。
 */
export type HandCardOp =
  | 'energy'         // 附加能量到自己場上的寶可夢
  | 'basic'          // playing 階段：基礎寶可夢放備戰
  | 'basic-setup'    // setup 階段：基礎寶可夢放備戰（已有出場寶可夢）
  | 'setup-active'   // setup 階段：放到空的戰鬥場
  | 'fossil'         // 化石 Item 當基礎寶可夢放備戰
  | 'tool'           // 寶可夢道具附到寶可夢身上
  | 'trainer'        // 支援者／物品／競技場
  | 'evolve'         // 進化到場上的某隻
  | 'hand-ability';  // ⭐ 從手牌發動的特性（齒輪怪｜緊急迴轉、烈箭鷹ex｜激動俯衝…）

export const HAND_CARD_OPS: readonly HandCardOp[] = [
  'energy', 'basic', 'basic-setup', 'setup-active',
  'fossil', 'tool', 'trainer', 'evolve', 'hand-ability',
] as const;

/** 拖曳時這個 op 要把卡片放到哪一種釋放區（對應 `data-drop-type`；'playmat' = 整張桌墊） */
export type HandDropTarget = 'poke' | 'bench-empty' | 'active-empty' | 'playmat';

/**
 * ⭐ op → 釋放區的**唯一對照表**。桌機 `onWindowPointerUp` 只准查這張表，
 *   禁止在 UI 端另寫一份 `if (kind === 'xxx')` 的對照。
 */
export const HAND_OP_DROP_TARGET: Readonly<Record<HandCardOp, HandDropTarget>> = {
  energy: 'poke',
  basic: 'bench-empty',
  'basic-setup': 'bench-empty',
  'setup-active': 'active-empty',
  fossil: 'bench-empty',
  tool: 'poke',
  trainer: 'playmat',
  evolve: 'poke',
  'hand-ability': 'bench-empty',
};

/**
 * 拖曳中要顯示成哪一種「手感」（沿用 v1.03 起的 DragKind，只影響 CSS/ghost 樣式）。
 * ⚠ 這只是**外觀**；能不能拖、拖到哪裡生效，一律看 `getHandCardOps` 的集合。
 */
export type HandDragKind = 'energy' | 'basic' | 'fossil' | 'tool' | 'evolve' | 'trainer' | 'hand-ability';

const DRAG_KIND_PRIORITY: ReadonlyArray<readonly [HandCardOp, HandDragKind]> = [
  ['energy', 'energy'],
  ['basic', 'basic'],
  ['basic-setup', 'basic'],
  ['setup-active', 'basic'],
  ['fossil', 'fossil'],
  ['evolve', 'evolve'],
  ['tool', 'tool'],
  ['trainer', 'trainer'],
  ['hand-ability', 'hand-ability'],
];

/** 這張手牌現在能不能拖曳（= 有任何一種可用操作）。拖曳與點擊必須問同一支。 */
export function handCardDraggable(ops: ReadonlySet<HandCardOp> | undefined): boolean {
  return !!ops && ops.size > 0;
}

/** 主要拖曳外觀（只挑一種顯示用 kind）。ops 為空 → null（不可拖）。 */
export function handCardDragKind(ops: ReadonlySet<HandCardOp> | undefined): HandDragKind | null {
  if (!ops || ops.size === 0) return null;
  for (const [op, kind] of DRAG_KIND_PRIORITY) if (ops.has(op)) return kind;
  return null;
}

/** 這張手牌拖到某種釋放區時，會用哪一個 op 結算（沒有 → null，等於拖過去不生效）。 */
export function handOpForDropTarget(
  ops: ReadonlySet<HandCardOp> | undefined,
  target: HandDropTarget,
): HandCardOp | null {
  if (!ops) return null;
  for (const [op] of DRAG_KIND_PRIORITY) {
    if (ops.has(op) && HAND_OP_DROP_TARGET[op] === target) return op;
  }
  return null;
}

/** UI-only 的上下文（線上／AI／本機雙人三種模式各自算出來的「現在是我的回合嗎」） */
export interface HandCardOpsCtx {
  /** UI 端 isMyTurn()：線上看 myPlayerIndex、AI 模式看人類座位、本機雙人隨 actor 翻轉 */
  isMyTurn: boolean;
  /**
   * ⭐v6.201 setup 階段專用的「我現在可以擺場嗎」。
   * setup 是**雙方同時**擺場，`activePlayerIndex` 只指得到一個人 —— 手機直式的
   * `isMyTurn` 正是 `activePlayerIndex === myIdx`，拿它當 setup 的閘會把另一方鎖死
   * （手機端 v2.287 就是為了這個而在 setup 條件裡刻意不寫 isMyTurn）。
   * 桌機的 `isMyTurn()` 本身已含 setup 分支（見 +page.svelte setupActorSide），
   * 所以**不傳**＝沿用 isMyTurn，桌機行為不變。
   */
  isMySetupTurn?: boolean;
}

/**
 * ⭐⭐⭐ 手牌可用操作的**唯一述詞**。回傳 `iid → Set<HandCardOp>`；
 *   沒有 entry ＝ 這張卡現在什麼都做不了（不可拖、不可點、不亮黃框）。
 */
export function getHandCardOps(
  state: GameState | null | undefined,
  myIdx: 0 | 1,
  pool: Map<string, Card>,
  ctx: HandCardOpsCtx,
): Map<string, Set<HandCardOp>> {
  const out = new Map<string, Set<HandCardOp>>();
  if (!state) return out;
  const me = state.players?.[myIdx];
  if (!me) return out;
  // 對手側缺席時 isAceCancelActive 會 throw；UI 熱路徑一炸整條手牌就不渲染 → fail-closed。
  if (!state.players?.[(1 - myIdx)]) return out;

  const isMyTurn = !!ctx.isMyTurn;
  const playing = state.phase === 'playing';
  const setup = state.phase === 'setup';

  // engine 端的可用清單（都以 state.activePlayerIndex 為視角；UI 再乘上 isMyTurn）
  const basics = isMyTurn && playing ? new Set(getPlayableBasics(state, pool)) : new Set<string>();
  const fossils = isMyTurn && playing ? new Set(getPlayableFossils(state, pool)) : new Set<string>();
  const trainers = isMyTurn && playing ? new Set(getPlayableTrainers(state, pool)) : new Set<string>();
  const evos = isMyTurn && playing
    ? new Set(getEvolvableTargets(state, pool).flatMap(e => e.toIids))
    : new Set<string>();
  const handAbilities = isMyTurn ? getHandActivatableAbilities(state, myIdx, pool) : [];
  const handAbilityIids = new Set(handAbilities.map(a => a.iid));

  // v5.079 蓋諾賽克特｜ACE消弭：對手場上有附道具的蓋諾賽克特 → 不能附 ACE SPEC 能量
  //   （engine ATTACH_ENERGY 已擋；UI 也要擋，否則亮黃框但按了沒反應）
  const aceCancel = isAceCancelActive(state, myIdx, pool);
  // v5.211/5.212 祭典樂舞第 2 次招式 pending 期間：不能附能量
  //   （basics/fossils/trainers/evos 在 engine helper 內已擋，能量沒有 helper 要自己擋）
  const festivalPending = !!(state.festivalDancePendingSecondAttack
    && state.festivalDancePendingSecondAttack.idx === myIdx);

  // ⚠ 逐字對齊 v6.199 template：
  //   canBasicSetup      = 基礎卡 && setup && 我的回合 && (未 setupDone || mulligan 補抽後加備戰)
  //   canSetupActiveSpecial = 非基礎但可當初始戰鬥寶可夢（閃焰王牌｜瞬間爆發力）
  //                        && setup && **!setupDone**（沒有 mulligan 分支）&& 我的回合 && 沒有戰鬥寶可夢
  //   ⭐v6.201 setup 用 isMySetupTurn（未傳→退回 isMyTurn，桌機行為不變）
  const setupTurn = ctx.isMySetupTurn === undefined ? isMyTurn : !!ctx.isMySetupTurn;
  const setupOpen = setup && setupTurn
    && (!state.setupDone?.[myIdx] || !!state.mulliganPostBenchOpen?.[myIdx]);
  const setupFresh = setup && setupTurn && !state.setupDone?.[myIdx];
  // ⭐v6.201 備戰位已滿就不能再放（engine handleSetup 的 BENCH_POKEMON 同一道 gate）——
  //   原本只有 playing 路徑的 getPlayableBasics 有這層，setup 路徑漏了。
  const benchFull = (me.bench?.length ?? 0) >= getBenchLimit(state, myIdx, pool);

  for (const inst of me.hand ?? []) {
    const c = pool.get(inst.cardId);
    if (!c) continue;
    const ops = new Set<HandCardOp>();

    const isEnergyCard = c.supertype === 'Energy';
    const isBasicCard = isBasicPokemonCard(c);
    const isFossilCard = isFossilItemCard(c);
    const isTrainerCard = c.supertype === 'Trainer';
    const isToolCard = isTrainerCard && c.subtype === 'PokemonTool';
    const isEvolutionCard = c.supertype === 'Pokemon' && !!c.evolvesFrom;

    if (isEnergyCard && playing && state.turnPhase === 'main' && isMyTurn
        && !me.energyAttachedThisTurn && !state.pendingSelection
        && !(c.tags?.includes('ACE SPEC') && aceCancel)
        && !festivalPending) {
      ops.add('energy');
    }
    if (isBasicCard && basics.has(inst.iid)) ops.add('basic');
    if (isBasicCard && setupOpen && !!me.active && !benchFull) ops.add('basic-setup');
    if (!me.active && (isBasicCard ? setupOpen : (setupFresh && canBeInitialActiveCard(c)))) ops.add('setup-active');
    if (isFossilCard && fossils.has(inst.iid)) ops.add('fossil');
    if (!isFossilCard && isTrainerCard && trainers.has(inst.iid)) {
      ops.add(isToolCard ? 'tool' : 'trainer');
    }
    if (isEvolutionCard && evos.has(inst.iid) && !state.pendingSelection) ops.add('evolve');
    if (handAbilityIids.has(inst.iid)) ops.add('hand-ability');

    if (ops.size > 0) out.set(inst.iid, ops);
  }
  return out;
}
