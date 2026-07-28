/**
 * 對戰音效「決策核心」（v6.048）—— 純函式，不碰 AudioContext、不碰 DOM。
 *
 * ## 為什麼要有這一層
 * 音效原本散在 `routes/game/+page.svelte` 的**三條互不相干的路徑**：
 *   1. 本機 action（AI／本機 2P／線上自己的動作）→ `dispatchSfxForAction`
 *   2. 休閒線上對手的動作 → Firestore snapshot diff（只涵蓋一小部分事件）
 *   3. 錦標賽對手的動作 → `tAdopt`，**完全沒有音效**
 * 於是同一件事在不同模式聽到的東西不一樣：錦標賽裡對手攻擊、擊倒我方寶可夢、
 * 甚至我輸掉這一局，都是無聲的。三條路徑各改一次的維護成本，也讓「加一個音效」
 * 這種小事變成三處同步。
 *
 * 這個模組把「發生了什麼事 → 該播什麼音」收斂成**一個可測試的純函式**：
 *   `computeSfxEvents(prev, next, action, pool, ctx) → SfxEvent[]`
 * 播放（AudioContext、stagger 的 setTimeout、throttle）留在 `sfx.ts` 與呼叫端。
 * 這樣才寫得出「逃跑抽出不可以播昏厥音」這種**行為守衛**。
 * （前例：`notify/notify-core.ts` 也是同樣的純決策核心 + 測試分離。）
 *
 * ## ⭐ 判準以 state diff 為主、action 為輔
 * 因為路徑 2/3 根本拿不到 action 物件（對手的動作是從伺服器同步回來的盤面）。
 * 凡是能從 prev/next 推出來的事件（KO、狀態、獎賞、勝負、傷害），一律走 diff；
 * 只有「玩家操作的手勢感」（點擊、放卡、撤退…）才依賴 action。
 */
import type { GameState, CardInstance, SpecialCondition } from '$lib/game/types';
import type { Card } from '$lib/cards/types';
import type { EnergyType } from '$lib/cards/types';
import type { SfxName } from './sfx';

/** 一個待播放的音效。stagger（連續 N 聲）與延遲都只是資料，由播放層執行。 */
export interface SfxEvent {
  name: SfxName;
  volume?: number;
  pan?: number;
  /** > 1 時播 count 聲，間隔 intervalMs（抽多張牌用） */
  count?: number;
  intervalMs?: number;
  /** 延遲播放毫秒數（讓音效排在動畫之後） */
  delayMs?: number;
  /** 跳過同名 100ms throttle（stagger 內部用） */
  force?: boolean;
}

export interface SfxContext {
  /** 'online' 時用 myPlayerIndex 決定左右聲道；AI 模式用 aiPlayerIndex。 */
  mode?: string;
  myPlayerIndex?: number | null;
  aiPlayerIndex?: number | null;
}

/** 左右聲道：自己（或玩家）置中、對手偏右；本機 2P 則左右分開。 */
export function panForActor(actor: 0 | 1, ctx: SfxContext): number {
  if (ctx.mode === 'online' && ctx.myPlayerIndex !== null && ctx.myPlayerIndex !== undefined) {
    return actor === ctx.myPlayerIndex ? 0 : 0.3;
  }
  if (ctx.aiPlayerIndex !== null && ctx.aiPlayerIndex !== undefined) {
    return actor === ctx.aiPlayerIndex ? 0.3 : 0;
  }
  return actor === 0 ? -0.25 : 0.25;
}

// ── 小工具 ────────────────────────────────────────────────────────────────
const onField = (st: GameState, idx: 0 | 1): CardInstance[] =>
  [st.players[idx].active, ...st.players[idx].bench].filter((c): c is CardInstance => !!c);

/** 一隻寶可夢身上的全部特殊狀態（三槽制：主格 + 第二 + 第三槽）。 */
function statusesOf(inst: CardInstance | null | undefined): SpecialCondition[] {
  if (!inst) return [];
  return [inst.status, inst.secondaryStatus, inst.tertiaryStatus]
    .filter((s): s is SpecialCondition => !!s);
}

const STATUS_SFX: Record<string, SfxName> = {
  poisoned: 'poison',
  burned: 'burn',
  asleep: 'sleep',
  confused: 'confuse',
  paralyzed: 'paralyze',
};

/** 任一方拿走了獎賞卡（含「待領」計數增加）＝這次一定有寶可夢昏厥。 */
function anyPrizeProgress(prev: GameState, next: GameState): boolean {
  for (const i of [0, 1] as const) {
    if (next.players[i].prizes.length < prev.players[i].prizes.length) return true;
    if ((next.pendingPrizes?.[i] ?? 0) > (prev.pendingPrizes?.[i] ?? 0)) return true;
  }
  return false;
}

/**
 * ⭐ 真正的「昏厥」判準（Wilson 回報：用土龍節節的特性「逃跑抽出」把自己收回牌庫時，
 * 也會聽到昏厥音）。舊判準是「戰鬥位從有變無」，但戰鬥位會變空的原因很多：
 *   - 昏厥                     → 進**棄牌區**
 *   - 逃跑抽出（放回牌庫）      → 進**牌庫**
 *   - 招式/特性把自己回手牌      → 進**手牌**
 *   - 迷唇姐｜強烈之吻的「丟棄」  → 進棄牌區，但卡面明寫**非昏厥、對手不獲得獎賞卡**
 * 所以判準是兩層：**離場後進了棄牌區**，而且**看得出是被打死的**
 * （有人拿獎賞 ‖ 這隻身上的傷害已達到它的 HP）。
 * 後半條讓「不給獎賞的昏厥」（脆弱蛻殼類）仍有音，也讓「純丟棄」不會誤播。
 *
 * ⚠HP 用卡面基礎值即可：只有**已經離場**的實例才會走到這裡，而場上還活著的
 *   （靠特性加 HP 撐住的）根本不在這個清單裡。
 */
export function detectFaintedIids(prev: GameState, next: GameState, pool: Map<string, Card>): string[] {
  const prizeProgress = anyPrizeProgress(prev, next);
  const out: string[] = [];
  for (const idx of [0, 1] as const) {
    const before = onField(prev, idx);
    const afterIds = new Set(onField(next, idx).map((c) => c.iid));
    if (before.length === 0) continue;
    const discardById = new Map(next.players[idx].discard.map((c) => [c.iid, c]));
    for (const inst of before) {
      if (afterIds.has(inst.iid)) continue;          // 還在場上
      const inDiscard = discardById.get(inst.iid);
      if (!inDiscard) continue;                      // 回牌庫／回手牌 → 不是昏厥
      const hp = Number(pool.get(inst.cardId)?.hp ?? 0);
      const lethal = hp > 0 && (inDiscard.damage ?? 0) >= hp;
      if (prizeProgress || lethal) out.push(inst.iid);
    }
  }
  return out;
}

/**
 * 這一次攻擊是否**真的造成了傷害**。
 * ⚠不能用卡面的印刷傷害判斷（舊寫法）：印著 130 的招式被【薄霧能量】之類完全免疫、
 *   被減傷到 0、或擲幣全反面時，實際傷害是 0，卻仍會播「打擊」音。
 *   反過來，`60×`（依條件倍增）這類卡面印刷不是純數字，也可能被誤判成 0 傷。
 * 判準：場上任何一隻寶可夢的傷害指示物增加，或有寶可夢被打到離場（昏厥）。
 */
export function attackDealtDamage(prev: GameState, next: GameState, pool: Map<string, Card>): boolean {
  for (const idx of [0, 1] as const) {
    const beforeMap = new Map(onField(prev, idx).map((c) => [c.iid, c.damage ?? 0]));
    for (const inst of onField(next, idx)) {
      const before = beforeMap.get(inst.iid);
      if (before !== undefined && (inst.damage ?? 0) > before) return true;
    }
  }
  return detectFaintedIids(prev, next, pool).length > 0;
}

// ── 主決策 ────────────────────────────────────────────────────────────────
/**
 * @param action 可為 null —— 線上/錦標賽「對手的動作」是從伺服器同步回來的盤面，
 *   沒有 action 物件。此時只會產生 diff 推得出來的事件。
 */
export function computeSfxEvents(
  prev: GameState,
  next: GameState,
  action: ({ type: string } & Record<string, unknown>) | null,
  pool: Map<string, Card>,
  ctx: SfxContext = {},
): SfxEvent[] {
  const events: SfxEvent[] = [];
  const actorIdx = (prev.activePlayerIndex ?? 0) as 0 | 1;
  const pan = panForActor(actorIdx, ctx);
  const handDelta = (): number => {
    const ai = (next.activePlayerIndex ?? 0) as 0 | 1;
    return (next.players[ai]?.hand?.length ?? 0) - (prev.players[ai]?.hand?.length ?? 0);
  };
  const pushDraw = (n: number, opts: { volume?: number; delayMs?: number } = {}): void => {
    if (n <= 0) return;
    events.push({ name: 'draw', pan, count: n, intervalMs: 90,
      volume: opts.volume, delayMs: opts.delayMs });
  };

  // ── A. 依 action 的「操作手感」音（只有本機動作有 action）────────────────
  switch (action?.type) {
    case 'DRAW_CARD':
      pushDraw(Math.max(1, handDelta()));
      break;
    case 'MULLIGAN_DRAW_DECISION':
      pushDraw(Number(action.count ?? 0));
      break;
    case 'FINISH_SETUP':
      events.push({ name: 'click', pan });
      break;
    case 'EVOLVE':
      events.push({ name: 'evolve', pan });
      break;
    case 'ATTACH_ENERGY':
      events.push({ name: 'attach-energy', pan });
      break;
    case 'PLAY_BASIC':
    case 'BENCH_POKEMON':
      events.push({ name: 'place-card', pan });
      break;
    case 'USE_STADIUM':
      events.push({ name: 'click', pan });
      break;
    case 'RETREAT':
      // v6.048：原本播的是「洗牌」音 —— 撤退不洗任何牌，語義錯位。
      //   改用紙牌落桌音（換上新的戰鬥寶可夢）。
      events.push({ name: 'place-card', pan });
      break;
    case 'END_TURN':
      events.push({ name: 'click', volume: 0.6, pan });
      break;
    case 'PLAY_TRAINER':
      events.push({ name: 'click', pan });
      pushDraw(handDelta(), { volume: 0.6, delayMs: 100 });
      break;
    case 'USE_ABILITY':
      events.push({ name: 'ability', pan });
      break;
    case 'RESOLVE_SELECTION': {
      events.push({ name: 'click', volume: 0.6, pan });
      pushDraw(handDelta(), { volume: 0.6, delayMs: 150 });
      const me = (next.activePlayerIndex ?? 0) as 0 | 1;
      const deckDelta = prev.players[me].deck.length - next.players[me].deck.length;
      if (deckDelta >= 2) events.push({ name: 'shuffle', volume: 0.4, pan, delayMs: 150 });
      break;
    }
    case 'SEND_NEW_ACTIVE':
      events.push({ name: 'place-card', pan });
      break;
    default:
      break;
  }

  // ── B. 攻擊音：實際造成傷害才用「打擊」音，純效果招式另有一個音 ──────────
  if (action?.type === 'ATTACK') {
    const attacker = prev.players[actorIdx].active;
    const atkCard = attacker ? pool.get(attacker.cardId) : undefined;
    const etype: EnergyType = (atkCard?.pokemonType as EnergyType) ?? 'Colorless';
    events.push(attackDealtDamage(prev, next, pool)
      ? { name: `attack-${etype}` as SfxName, pan }
      : { name: 'attack-nodamage', pan });
  }

  // ── C. 取獎賞：拿走自己最後一張 → 勝利號角 ─────────────────────────────
  //   ⚠v6.048 修判錯邊：`action.playerIdx` 是**取獎者自己**（引擎 TAKE_PRIZES
  //     取的是 `state.players[playerIdx].prizes`），舊寫法卻檢查對手的獎賞堆是否歸零
  //     → 正常對局中永遠不成立，勝利號角從來沒響過。
  if (action?.type === 'TAKE_PRIZES') {
    const acted = (action.playerIdx as 0 | 1 | undefined) ?? actorIdx;
    const myPan = panForActor(acted, ctx);
    events.push(next.players[acted]?.prizes?.length === 0
      ? { name: 'victory-fanfare', pan: myPan }
      : { name: 'prize-take', pan: myPan });
  } else if (!action) {
    // diff-only 路徑（對手取獎）：靠獎賞堆變短推出來
    for (const i of [0, 1] as const) {
      if (next.players[i].prizes.length < prev.players[i].prizes.length) {
        events.push(next.players[i].prizes.length === 0
          ? { name: 'victory-fanfare', pan: panForActor(i, ctx) }
          : { name: 'prize-take', pan: panForActor(i, ctx) });
      }
    }
  }

  // ── C2. diff-only 路徑的抽牌音 ─────────────────────────────────────────
  //   對手在線上/錦標賽抽牌時我們沒有 action 物件，只能從手牌長度變化推。
  //   （有 action 的路徑已在 A 區依 action 播過，這裡不重複。）
  if (!action) {
    for (const i of [0, 1] as const) {
      const delta = (next.players[i]?.hand?.length ?? 0) - (prev.players[i]?.hand?.length ?? 0);
      if (delta > 0) events.push({ name: 'draw', pan: panForActor(i, ctx), count: delta, intervalMs: 90 });
    }
  }

  // ── D. 純 diff 事件（三條路徑共用）──────────────────────────────────────
  // D1. 昏厥（含備戰位；舊版只看戰鬥位，狙擊/中毒擊倒備戰是無聲的）
  if (detectFaintedIids(prev, next, pool).length > 0) {
    events.push({ name: 'ko' });
  }
  // D2. 特殊狀態：三槽都要看，且「換狀態」也算新加
  //   ⚠舊版只比對 `status` 主格且要求「原本沒有狀態」，於是：睡眠中再中毒（中毒被放進
  //     第二槽）、主格從睡眠換成混亂、以及**麻痺**（根本沒有對應音效）全部無聲。
  for (const idx of [0, 1] as const) {
    const beforeMap = new Map(onField(prev, idx).map((c) => [c.iid, new Set<string>(statusesOf(c))]));
    for (const inst of onField(next, idx)) {
      const before = beforeMap.get(inst.iid);
      if (!before) continue;                        // 這隻是新上場的，不算「被施加」
      for (const s of statusesOf(inst)) {
        if (before.has(s)) continue;
        const name = STATUS_SFX[s];
        if (name) events.push({ name });
      }
    }
  }
  // D3. 對局結束
  if (prev.phase !== 'game-over' && next.phase === 'game-over'
      && next.winner !== null && next.winner !== undefined) {
    const isLocalWin = ctx.mode === 'online' && ctx.myPlayerIndex !== null && ctx.myPlayerIndex !== undefined
      ? next.winner === ctx.myPlayerIndex
      : (ctx.aiPlayerIndex !== null && ctx.aiPlayerIndex !== undefined
        ? next.winner !== ctx.aiPlayerIndex
        : true);
    events.push({ name: isLocalWin ? 'game-win' : 'game-lose', delayMs: 300 });
  }

  return events;
}
