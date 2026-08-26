/**
 * v6.233 「預估傷害」——**唯一**的計算入口（手機直式與桌機兩套 UI 共用這一份）。
 *
 * ## 為什麼是「乾跑」而不是「另外抽一份公式」
 * 傷害計算牽涉弱點／抵抗力／四十幾種加減傷來源／特性消除／道具／場地卡，
 * 而且整段是寫在 `engine.ts` 的 ATTACK handler **裡面**
 * （`composeFormula` 在 L5807，是那個 handler 內的區域閉包，不是可重用的函式）。
 * 再寫第二份必然與實戰漂移，而玩家會照著錯的數字下決定 —— **那比沒有預估更糟**。
 * ⇒ 本檔**不做任何傷害計算**：深複製盤面 → 用**真實的 `applyAction`** 打那一招 →
 *   讀引擎自己寫下的 `lastDealtDamage` 與傷害公式字串 → 丟掉那份盤面。
 *   零新計算邏輯 ⇒ 不可能漂移（因為它就是實戰用的那段程式碼）。
 *
 * ## 深複製是硬性要求
 * `handlePlaying`（engine.ts L3166）只做**淺複製**
 * （`const players = [...state.players]; const attacker = {...players[aIdx]};`）
 * ⇒ 內層的 `CardInstance` 是**共用參照**，任何就地修改都會污染真正的盤面。
 * 所以一律 `structuredClone`，並由守衛 `test-v6233-damage-estimate.mjs` 用深比對
 * 釘死「預估跑完後原本的 GameState 逐位元組不變」。
 *
 * ## 擲幣：不動實戰路徑
 * 全站擲幣都收斂在 `flipCoinsWithLog`，判定式是 `Math.random() < 0.5`。
 * 乾跑期間把 `Math.random` 換成一支**帶狀 PRNG**：heads 模式回 `[0, 0.5)`、
 * tails 模式回 `[0.5, 1)` ⇒ 等於「全正面 / 全反面」，**但仍是變動的亂數**
 * （若直接回固定值，`Math.random().toString(36).slice(2,10)` 會產生相同 iid、
 *  洗牌也會退化成常數）。`try/finally` 一定還原 —— 同 `ai-eval.ts`／`optimistic.ts`
 * 的既有先例；實戰路徑一行都沒動。
 *
 * ## 「擲硬幣直到出現反面」不可以給範圍
 * 全正面跑出來的是「連續 20~30 次正面」的理論值（實作端有上限保護），
 * 機率百萬分之一，顯示出來是誤導。
 * 偵測**不靠卡名清單、也不靠卡面 regex**，而是行為端：
 *   **全正面與全反面的擲幣次數不同 ⇒ 次數本身取決於擲幣結果 ⇒ 無上限**。
 * （卡面 `直到出現反面` 的 regex 只在守衛裡當交叉驗證，見 IRON_RULES Rule 25。）
 *
 * ## ⚠ 不得洩漏隱藏資訊
 * 預估在瀏覽器端跑、用的是玩家自己那一份 GameState —— 但那份盤面**含有玩家不該知道的
 * 東西**（雙方牌庫順序、獎賞卡、對手手牌）。若某一招的傷害取決於這些，把數字顯示出來
 * 就等於作弊（實例：呆呆王｜耀閃挑戰 的傷害取決於自己牌庫頂那一張）。
 * ⇒ 再跑一次「換一種可能的隱藏牌況」的乾跑，只要結果不同就一律降級成「依看不到的牌而定」。
 *
 * ⚠⚠ v6.236：這一段原本**只反轉順序**，於是「傷害取決於隱藏區**內容**（而不是順序）」的招式
 *   完全偵測不到 —— 實證兩張：`狩獵鳳蝶｜能量吸管`（對手手牌中能量卡張數×80）與
 *   `風妖精ex｜奇跡棉花`（對手手牌中訓練家卡張數×50），出招前就把對手手牌的組成
 *   直接換算成數字顯示出來。改成**在同一側的隱藏區之間重新分配**（各區張數不變），
 *   順序與組成同時改變，兩張都已降級。
 */
import type { GameState, CardInstance, PendingSelection } from './types';
import type { Card } from '$lib/cards/types';
import { applyAction } from './engine';
// ⚠ 這一行故意**不與上面那行合併**：`test-v6233-damage-estimate.mjs` 逐字釘住
//   `import { applyAction } from './engine'` 這個字串，用來證明「傷害只由真實引擎算出、
//   本檔沒有自己再算一份」。合併成一行會讓那條守衛靜默失效。
import { canAffordAttack, getEffectiveAttacks } from './engine';
import { getBasicEnergyType, evaluateSelectionFilter, isKnownSelectionFilter } from './selection-filter';
import type { SelectionFilterZone } from './selection-filter';

/** 傷害公式中的一項。label 一律沿用**引擎自己寫的字串**（例：`弱點` / `抵抗力`），不另行翻譯。 */
export type EstimateTerm = { sign: string; value: number; label: string };

type DamageEstimateCore =
  /** 這一招不造成傷害（純效果） ⇒ 不顯示 */
  | { kind: 'none' }
  /** 乾跑跑不出結論（引擎沒受理／深複製失敗） ⇒ 不顯示 */
  | { kind: 'unknown' }
  /** 會先跳選擇視窗，或取決於玩家看不到的牌（牌序或組成） ⇒ 顯示文字，**絕不顯示成 0** */
  | { kind: 'depends'; why: 'selection' | 'hidden' }
  | { kind: 'exact'; value: number; formula: string; terms: EstimateTerm[] }
  /** 有隨機成分：下界＝全反面實跑值、上界＝全正面實跑值。`coin` 代表這個隨機來自擲硬幣 */
  | { kind: 'range'; min: number; max: number; coin: boolean; formula: string; terms: EstimateTerm[] }
  /** 「擲硬幣直到出現反面」型：只有下界，上界無上限 */
  | { kind: 'open'; min: number; formula: string; terms: EstimateTerm[] };

/**
 * ⭐v6.237【D】所有變體共用的附註 —— 只有「能量還沒附夠」時才會出現。
 *
 * 站長的原始需求是**出招前的規劃**：「有時候沒看到本來想說可以一拳打掉對手，
 * 結果發現對方抗屬性」—— 想知道的是「如果我把能量附上去，這招打得死嗎」。
 * v6.236 以前能量不足的招式一律不顯示（引擎的 ATTACK 在 `canAffordAttack` 那一關
 * 直接原樣 return ⇒ 乾跑完全沒有 log ⇒ `unknown`），**在最需要它的時候不顯示**。
 * ⇒ 改成照樣給數字，但那個數字是在**假設**之下算的，必須逐字講清楚。
 */
export type EstimateNote = {
  /** 目前附著的能量還付不出這一招 ⇒ 數字是「假設剛好把費用附滿」跑出來的。 */
  assumedEnergy?: boolean;
  /** 傷害本身會隨附著的能量數改變 ⇒ 上面那個數字只是「剛好附滿」的那一種情形。 */
  energyScaled?: boolean;
};

export type DamageEstimate = DamageEstimateCore & EstimateNote;

type CoinMode = 'heads' | 'tails';

type RunOut =
  | { ok: false }
  | { ok: true; dmg: number; flips: number; pending: boolean; formula: string; terms: EstimateTerm[]; logAdded: number };

/**
 * ⚠⚠ 固定結果的**預算**。超過就改回相反的那一面。
 *
 * 為什麼一定要有：v6.233 當時 `怪顎龍｜亂暴`／`洛奇亞ex｜破壞潮旋` 的實作是
 * `while (true) { 擲1次; if (反面) break; }` **沒有次數上限**，乾跑把硬幣固定成全正面時
 * 迴圈永遠不會結束 —— 瀏覽器分頁會直接卡死。
 * ⚠ v6.234 已把全站「擲到反面為止」收斂到 `flipCoinsUntilTails`，每一處都有明確上限
 *   （10／20／30，逐卡宣告），所以那個特定的無窮迴圈已經不存在。
 *   **但這道預算仍然保留**：它擋的是「任何一處未來又寫出無上限迴圈」的通例，
 *   是這支乾跑自己的安全網，不依賴卡片實作端永遠做對（Rule 25 的精神）。
 * ⇒ 固定結果只維持前 `COIN_BUDGET` 次抽樣，之後翻面，保證任何迴圈都會終止。
 *
 * 256 的取法：合法的擲幣次數最多就是實作端的上限 30；Fisher-Yates 洗一副 60 張牌
 * 會吃掉 59 次抽樣 —— 256 足夠讓「洗好幾次牌 ＋ 擲滿上限」都還在預算內。
 */
const COIN_BUDGET = 256;

/**
 * ⭐⭐⭐v6.237【B】**絕不再靜靜吞掉錯誤**。
 *
 * v6.233～v6.236 這支預估**從來沒有在畫面上出現過**，而三個版本、62 條守衛、
 * 完整 npm test 全綠都沒抓到。真因是 `+page.svelte` 的 `game` 是 Svelte 5 的
 * `$state` **Proxy**，`structuredClone` 對 Proxy 一律拋 `DataCloneError`
 * （HTML 規格：帶有 [[ProxyHandler]] 內部欄位的物件不可序列化）——
 * 而下面兩處的 `catch` 把它吃得一乾二淨，**連 console 都不留一行**。
 *
 * ⇒ 每一種失敗原因至少留一行 `console.warn`。
 * ⚠ 但**每種只噴一次**：這支會被 `$derived` 在每次盤面變動時重算，
 *   每次 render 都噴等於把主控台洗掉、反而更難查。
 * ⚠ 行為維持 fail-closed：算不出來就不顯示，**絕不拿錯數字騙玩家**。
 */
const _warnedTags = new Set<string>();
export function warnEstimateOnce(tag: string, err?: unknown): void {
  if (_warnedTags.has(tag)) return;
  _warnedTags.add(tag);
  try {
    console.warn('[預估傷害] 已停用（' + tag + '）：', err);
  } catch {
    // console 不可用（極少數環境）時什麼也不做 —— 診斷失敗不可以反過來影響對戰。
  }
}

/** 只給守衛用：把「已經噴過」的記錄清掉，才能驗「同一種原因只噴一次」。 */
export function resetEstimateWarnings(): void {
  _warnedTags.clear();
}

/** 基本能量卡「屬性 → cardId」對照表（同一個 pool 只算一次）。 */
const _basicEnergyCache = new WeakMap<Map<string, Card>, Map<string, string>>();
function basicEnergyIdByType(pool: Map<string, Card>): Map<string, string> {
  const hit = _basicEnergyCache.get(pool);
  if (hit) return hit;
  const m = new Map<string, string>();
  for (const c of pool.values()) {
    const t = getBasicEnergyType(c);
    if (t && !m.has(t)) m.set(t, String(c.id));
  }
  _basicEnergyCache.set(pool, m);
  return m;
}

/** 目前附著的能量付不付得出這一招。⚠ 判斷不了一律回 true（＝不啟用假設，維持 v6.236 的行為）。 */
function canAffordNow(base: GameState, attackIndex: number, pool: Map<string, Card>): boolean {
  try {
    const aIdx = base.activePlayerIndex;
    const act = base.players?.[aIdx]?.active;
    if (!act) return true;
    const entry = getEffectiveAttacks(base, act, pool)[attackIndex];
    if (!entry) return true;
    return canAffordAttack(act, entry.atk.cost ?? [], pool, base, aIdx, entry.atk.name);
  } catch (err) {
    warnEstimateOnce('判斷能量是否足夠時丟出例外', err);
    return true;
  }
}

/**
 * ⭐v6.237【D】把「剛好付得出這一招」所缺的基本能量補到**丟棄用的複本**上。
 *
 * ⚠ **不動既有的能量**（特殊能量的效果照樣算得到），只補缺的部分：
 *   依 cost 逐格補對應屬性的基本能量，【無】用攻擊方自己的屬性；
 *   補到 `canAffordAttack` 成立為止，末尾多留 3 格給「鼓擊／夜間礦山」這類**加費**效果。
 * ⚠ 只在丟棄用的複本上做，真實盤面一個位元組都不會動（由守衛的深比對釘死）。
 *
 * @param extra 付得出來之後再多附幾顆（用來偵測「傷害會不會隨附著的能量數變動」）。
 * @returns 是否補到付得出來；補不出來就放棄這一次乾跑（不顯示，絕不硬掰）。
 */
function topUpEnergyForCost(
  s: GameState,
  attackIndex: number,
  pool: Map<string, Card>,
  extra: number,
): boolean {
  const aIdx = s.activePlayerIndex;
  const act = s.players?.[aIdx]?.active;
  if (!act) return false;
  let entry;
  try {
    entry = getEffectiveAttacks(s, act, pool)[attackIndex];
  } catch (err) {
    warnEstimateOnce('補能量時取招式清單丟出例外', err);
    return false;
  }
  if (!entry) return false;
  const cost = entry.atk.cost ?? [];
  const byType = basicEnergyIdByType(pool);
  if (byType.size === 0) return false;
  const ownType = String(pool.get(act.cardId)?.pokemonType ?? '');
  const anyId = byType.values().next().value as string;
  const pickId = (t: string): string => byType.get(t) ?? byType.get(ownType) ?? anyId;
  const afford = (): boolean => canAffordAttack(act, cost, pool, s, aIdx, entry.atk.name);
  let seq = 0;
  const attach = (t: string): void => {
    const e: CardInstance = {
      iid: 'est-topup-' + (seq++),
      cardId: pickId(t),
      damage: 0,
      energyAttached: [],
      evolvedFromStack: [],
    } as unknown as CardInstance;
    act.energyAttached = [...(act.energyAttached ?? []), e];
  };
  const plan = [...cost.map(c => (c === 'Colorless' ? ownType : String(c))), ownType, ownType, ownType];
  for (const t of plan) {
    if (afford()) break;
    attach(t);
  }
  if (!afford()) return false;
  for (let i = 0; i < extra; i++) attach(ownType);
  return true;
}

/**
 * 帶狀 PRNG（mulberry32 再映射到半區間）。
 * `heads` → `[0, 0.5)`（`Math.random() < 0.5` 恆為 true ＝ 正面）
 * `tails` → `[0.5, 1)`（恆為 false ＝ 反面）
 * 超過 `COIN_BUDGET` 次之後改吐相反那一面（見上方說明）。
 */
function bandedRandom(mode: CoinMode): () => number {
  let s = 0x9e3779b9 | 0;
  let used = 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0,1)
    const heads = mode === 'heads' ? used++ < COIN_BUDGET : used++ >= COIN_BUDGET;
    return heads ? u * 0.5 : 0.5 + u * 0.5;
  };
}

/**
 * 把「玩家不該知道內容／順序」的區域換成**另一種同樣可能的牌況**：
 * 自己這一側＝牌庫＋獎賞卡；對手那一側＝牌庫＋獎賞卡＋手牌。
 * 自己的手牌與雙方場上是公開資訊，不動。
 *
 * 做法：把同一側的隱藏區**串成一串、反轉、再按原本各區的張數切回去**。
 *   - 每一區的**張數不變** ⇒「對手手牌有幾張」「自己牌庫剩幾張」這種**公開**資訊不受影響，
 *     不會把只看張數的招式（例：超級雪妖女ex｜怨言）誤判成偷看。
 *   - 同一側的牌只是在隱藏區之間搬家 ⇒ 換出來的仍是一個**玩家無法排除的可能牌況**
 *     （玩家本來就不知道自己哪幾張在獎賞卡、對手手上拿著什麼），沒有憑空生出卡。
 *   - 順序**與組成**同時改變 ⇒ 依牌序（呆呆王｜耀閃挑戰）與依組成
 *     （狩獵鳳蝶｜能量吸管、風妖精ex｜奇跡棉花）的招式都偵測得到。
 * ⚠ 只在**丟棄用的深複製**上做，真實盤面一個位元組都不會動。
 */
function permuteHiddenZones(s: GameState, viewerIdx: 0 | 1): void {
  for (let i = 0; i < 2; i++) {
    const p = s.players?.[i];
    if (!p) continue;
    const deck = Array.isArray(p.deck) ? p.deck : null;
    const prizes = Array.isArray(p.prizes) ? p.prizes : null;
    const hand = (i !== viewerIdx && Array.isArray(p.hand)) ? p.hand : null;
    const pooled: CardInstance[] = [];
    if (deck) pooled.push(...deck);
    if (prizes) pooled.push(...prizes);
    if (hand) pooled.push(...hand);
    pooled.reverse();
    let k = 0;
    if (deck) { p.deck = pooled.slice(k, k + deck.length); k += deck.length; }
    if (prizes) { p.prizes = pooled.slice(k, k + prizes.length); k += prizes.length; }
    if (hand) { p.hand = pooled.slice(k, k + hand.length); k += hand.length; }
  }
}

/**
 * ⭐⭐⭐v6.238 讀「這一招對對手戰鬥位造成的傷害」。
 *
 * `lastDealtDamage` 只有 engine 的 ATTACK 主管線會寫，站內有一整族招式走的是
 * 「regPre 傷害設 0 →（效果／選擇視窗）→ 最後才 dealAttackDamageToTarget」的延後範本，
 * 那條路徑不經過主管線 ⇒ 只讀 `lastDealtDamage` 會得到 0，於是預估把「其實會打 420」
 * 判成「純效果、沒有傷害 ⇒ 不顯示」。站長回報的「第一招完全沒有預估」就是這樣來的。
 * ⇒ 改讀 v6.238 新增的 `attackDamageToDefActive`（兩條路徑都會寫）。
 * ⚠ 取兩者的大值只是為了向下相容（例：錦標賽伺服器端還是舊版 server-engine 時），
 *   兩欄講的是同一件事（對手戰鬥位吃到的招式傷害），不會互相污染。
 */
function readDealt(s: GameState): number {
  return Math.max(s.attackDamageToDefActive ?? 0, s.lastDealtDamage ?? 0);
}

/**
 * ⭐⭐⭐v6.238 乾跑時「把選擇視窗一路跑到底」的步數上限。
 * 站內最長的 picker chain 是 3 段；6 足夠且保證任何情況都會停。
 */
const PENDING_STEP_BUDGET = 6;

/** 這兩種 picker 的 payload 不是「iid 陣列」語意（選項字串／帶順序），乾跑不碰。 */
const CHAIN_UNSUPPORTED_TYPES: ReadonlySet<string> = new Set(['modal-choice', 'reorder-deck-top']);

/**
 * 這個 picker 的候選 iid —— **只用於乾跑的「全選」對照組**。
 * ⚠ 刻意用寬鬆的取法（有 `params.validIids` 就用它，否則整個來源區）：
 *   它的用途是「換一種選擇再跑一次，看傷害會不會變」，寬一點只會讓結論更保守
 *   （多判成「依選擇而定」），不會讓玩家看到錯的數字。
 */
function chainCandidates(s: GameState, p: PendingSelection, pool: Map<string, Card>): CardInstance[] | null {
  if (CHAIN_UNSUPPORTED_TYPES.has(p.type)) return null;
  const src = s.players?.[(p.sourcePlayerIdx ?? p.actorIdx) as 0 | 1];
  if (!src) return null;
  const arr = (x: unknown): CardInstance[] => (Array.isArray(x) ? (x as CardInstance[]).filter(c => c && typeof c.iid === 'string') : []);
  const act = (): CardInstance[] => (src.active ? [src.active] : []);
  let list: CardInstance[] | null;
  switch (p.type) {
    case 'deck-search': list = arr(src.deck); break;
    case 'discard-search': list = arr(src.discard); break;
    case 'hand-discard':
    case 'hand-choose': list = arr(src.hand); break;
    case 'bench-choose':
    case 'opp-bench-choose':
      list = [...arr(src.bench), ...(p.params?.includeActive === true ? act() : [])]; break;
    case 'opp-poke-choose':
    case 'heal-target': list = [...act(), ...arr(src.bench)]; break;
    case 'active-energy-discard': list = arr(src.active?.energyAttached); break;
    // 分配型：合法用「重複的 iid」編碼「分配幾個」⇒ 候選就是可分配的目標
    case 'damage-distribute':
    case 'energy-distribute': list = arr(src.bench); break;
    default: list = null;
  }
  if (!list) return null;
  // `params.validIids` 是「這個 picker 到底能勾什麼」的權威（消毒閘與 UI 都以它為準）。
  const vi = p.params?.validIids;
  if (Array.isArray(vi)) {
    const allow = new Set((vi as unknown[]).filter((x): x is string => typeof x === 'string'));
    list = list.filter(c => allow.has(c.iid));
  }
  // 卡面 filter（已收錄的才套；未收錄／查不到卡一律保留 —— 三態 fail-open，同消毒閘的作法）
  const zone = p.type as SelectionFilterZone;
  if (p.filter && (zone === 'deck-search' || zone === 'hand-discard' || zone === 'discard-search')
      && isKnownSelectionFilter(zone, p.filter)) {
    const f = p.filter;
    list = list.filter(c => evaluateSelectionFilter(zone, f, { iid: c.iid }, pool.get(c.cardId),
      { params: p.params as Record<string, unknown> | undefined }) !== false);
  }
  return list;
}

/**
 * 乾跑要送出的答覆。回 `null` ＝「不能替玩家決定」，這一次乾跑放棄。
 *
 * 三種政策都是**玩家做得到的合法答覆**（張數在 min~max 之間）：
 *   `min-first` 選最少張、由前往後取｜`max-first` 選最多張｜`min-last` 選最少張、由後往前取
 * 三者算出來的傷害一致，才敢說「這一招的傷害與選擇無關」。
 */
function chainAnswer(
  s: GameState,
  p: PendingSelection,
  pool: Map<string, Card>,
  policy: 'min-first' | 'max-first' | 'min-last',
): string[] | null {
  const min = Math.max(0, p.minCount ?? 0);
  const max = Math.max(min, p.maxCount ?? min);
  if (min === 0 && policy !== 'max-first') return [];
  const cands = chainCandidates(s, p, pool);
  if (!cands) return null;
  const ids = cands.map(c => c.iid);
  if (ids.length === 0) return min === 0 ? [] : null;
  const want = policy === 'max-first' ? Math.min(max, Math.max(min, ids.length)) : min;
  const src = policy === 'min-last' ? [...ids].reverse() : ids;
  const out = src.slice(0, want);
  // 分配型的 minCount ＝「要分配幾個」，靠重複同一個 iid 表示 ⇒ 不足就補
  while (out.length < want) out.push(src[out.length % src.length]);
  return out;
}

/**
 * ⭐⭐⭐v6.238 用**真實引擎**把選擇視窗一路回答到底，回傳最終盤面（跑不完回 `null`）。
 *
 * 為什麼需要：「先開選擇視窗、最後才造成傷害」的招式（波動突刺／弦月光芒／忍之利刃…）
 * 在 ATTACK 這一個 action 結束時傷害根本還沒發生 ⇒ 只看那一刻就只能說「依選擇而定」。
 * 引擎已經把後續流程寫好了，乾跑照著把 `RESOLVE_SELECTION` 送完就是了 —— 一樣是
 * **零新計算邏輯**，跑的還是實戰那段程式碼。
 * ⚠ 全程在丟棄用的深複製上進行；答不出來一律 `null`（fail-closed）。
 */
function drivePendingChain(
  s0: GameState,
  pool: Map<string, Card>,
  policy: 'min-first' | 'max-first' | 'min-last',
): GameState | null {
  let s = s0;
  for (let step = 0; step < PENDING_STEP_BUDGET; step++) {
    const p = s.pendingSelection;
    if (!p) return s;
    if (s.phase !== 'playing') return s;
    const ans = chainAnswer(s, p, pool, policy);
    if (ans === null) return null;
    const tokenBefore = p.token;
    const keyBefore = p.effectKey;
    let next: GameState;
    try {
      next = applyAction(
        s,
        { type: 'RESOLVE_SELECTION', selectedIids: ans, senderIdx: p.actorIdx, pendingToken: p.token },
        pool,
      );
    } catch (err) {
      warnEstimateOnce('乾跑把選擇視窗跑到底時丟出例外', err);
      return null;
    }
    const np = next.pendingSelection;
    // 同一個 picker 還在原地 ⇒ 引擎沒受理這個答覆（消毒閘擋下等）⇒ 放棄，別空轉
    if (np && np.token === tokenBefore && np.effectKey === keyBefore) return null;
    s = next;
  }
  return s.pendingSelection ? null : s;
}

/** 從新增的 log 取出最後一段引擎寫的傷害公式（`【100(基礎) ×2(弱點) = 200】`）。 */
function pickFormula(messages: string[]): string {
  let out = '';
  for (const m of messages) {
    const hit = /【([^】]+)】/.exec(m);
    // ⚠⚠v6.238：【】在 log 裡不是公式專用 —— 卡名本身就有（「基本【鬥】能量」「寶可夢【ex】」）。
    //   v6.238 讓乾跑把選擇視窗跑到底之後，被掃到的 log 變多，波動突刺就抓到了「鬥」當公式
    //   （畫面上會多出一行莫名其妙的「鬥」）。引擎寫的公式一定同時有 `(基礎)` 與 ` = `。
    if (hit && hit[1].includes('(基礎)') && hit[1].includes(' = ')) out = hit[1];
  }
  return out;
}

/** 把公式字串拆成 term（純字串解析，不重算任何數字）。 */
export function parseFormulaTerms(formula: string): EstimateTerm[] {
  const out: EstimateTerm[] = [];
  const re = /([×+\-])\s*(\d+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    out.push({ sign: m[1], value: Number(m[2]), label: m[3] });
  }
  return out;
}

/** 跑一次乾跑。**唯一**會呼叫 applyAction 的地方。 */
function runOnce(
  base: GameState,
  attackIndex: number,
  pool: Map<string, Card>,
  mode: CoinMode,
  viewerIdx: 0 | 1,
  permuteHidden: boolean,
  /** ⭐v6.237【D】null＝不補能量（付得出來）；數字＝補到剛好付得出來，再多附這麼多顆。 */
  topUpEnergyExtra: number | null,
): RunOut {
  let work: GameState;
  try {
    // ⚠⚠ 深複製是硬性要求（見檔頭）。structuredClone 失敗就放棄預估，絕不退回淺複製。
    work = structuredClone(base);
  } catch (err) {
    // ⚠⚠v6.237：這個 catch 就是讓整個功能隱形三個版本的兇手 —— 一定要留下診斷。
    //   最常見的原因：呼叫端把 Svelte 5 的 `$state` Proxy 直接丟進來
    //   （Proxy 不可 structuredClone）⇒ 呼叫端要先做 `$state.snapshot()`。
    warnEstimateOnce('盤面深複製失敗（可能是 Svelte $state Proxy，呼叫端需先 $state.snapshot）', err);
    return { ok: false };
  }
  // `lastDealtDamage` 不是每次 ATTACK 開頭清的（engine.ts 只在造成傷害時寫入），
  // 殘留的上一招數值會被誤讀成這一招的傷害 ⇒ 在**丟棄用的複本**上先歸零。
  work.lastDealtDamage = 0;
  work.attackDamageToDefActive = 0;   // ⭐v6.238 同上（見 readDealt）
  // ⭐v6.237【D】能量不足時，先在複本上把費用補滿（補不出來就放棄這一次乾跑）。
  if (topUpEnergyExtra !== null && !topUpEnergyForCost(work, attackIndex, pool, topUpEnergyExtra)) {
    return { ok: false };
  }
  if (permuteHidden) permuteHiddenZones(work, viewerIdx);

  const beforeLogLen = (base.log ?? []).length;
  const orig = Math.random;
  let out: GameState;
  try {
    Math.random = bandedRandom(mode);
    out = applyAction(work, { type: 'ATTACK', attackIndex }, pool);
    // ⭐⭐⭐v6.238 這一招是「先開選擇視窗、最後才造成傷害」的話，ATTACK 這一個 action
    //   結束時傷害還沒發生。用真實引擎把選擇視窗跑到底 —— **而且要跑三種不同的合法答覆**：
    //     ・min-first ＝ 選最低張數、由前往後取
    //     ・max-first ＝ 選最高張數（張數會不會影響傷害）
    //     ・min-last  ＝ 選最低張數、由後往前取（「選到哪一張」會不會影響傷害）
    //   三種答覆算出來的傷害**一樣** ⇒ 這一招的傷害與選擇無關，可以放心報數字；
    //   不一樣（或任一邊跑不完）⇒ 維持原本的「依選擇而定」，絕不拿其中一個數字騙玩家。
    //   ⚠ 必須留在 Math.random 還被換掉的區間內，硬幣模式才跟主 action 一致。
    if (out.pendingSelection) {
      const cNone = drivePendingChain(out, pool, 'min-first');
      const cAll = cNone ? drivePendingChain(out, pool, 'max-first') : null;
      const cAlt = cAll ? drivePendingChain(out, pool, 'min-last') : null;
      //   ⚠⚠ 還要求「跑到底之後傷害 > 0」：跑完仍是 0 的話，分不出「這招本來就不造成傷害」
      //     與「傷害正是由這個選擇決定的」⇒ 一律維持 v6.237 的「依選擇而定」。
      //     少了這一關，狩獵鳳蝶｜能量吸管／風妖精ex｜奇跡棉花（傷害取決於對手手牌組成）
      //     會在「剛好算出 0」時從『依選擇而定』掉成『完全不顯示』——而「有沒有顯示」
      //     本身就是玩家看得出來的訊號（v6.236 那一條的精神）。
      if (cNone && cAll && cAlt && readDealt(cNone) === readDealt(cAll)
          && readDealt(cNone) === readDealt(cAlt) && readDealt(cNone) > 0) out = cNone;
    }
  } catch (err) {
    // ⚠v6.237：引擎在乾跑中丟例外也要留一行（例：卡池不完整）。行為仍 fail-closed。
    warnEstimateOnce('引擎在乾跑中丟出例外', err);
    return { ok: false };
  } finally {
    Math.random = orig; // ⚠ 一定要還原，否則整場對局的隨機源被換掉且極難聯想
  }

  const added = (out.log ?? []).slice(beforeLogLen).map(l => l?.message ?? '');
  const formula = pickFormula(added);
  return {
    ok: true,
    dmg: readDealt(out),   // ⭐v6.238 延後造成的傷害也讀得到（見 readDealt）
    // flipCoinsWithLog 每擲一次就 append 一筆；ATTACK 開頭會清空 ⇒ 這就是「本招擲了幾次」。
    flips: (out._machineGunLastFlips ?? []).length,
    pending: !!out.pendingSelection,
    formula,
    terms: parseFormulaTerms(formula),
    logAdded: added.length,
  };
}

/**
 * 估一招的傷害。
 *
 * @param base        目前盤面（**不會被修改**）。
 *                    ⚠⚠ **必須是純物件**（plain object graph）——本檔用 `structuredClone` 深複製，
 *                    而 `structuredClone` 對 Proxy 一律拋 `DataCloneError`。Svelte 端請先
 *                    `$state.snapshot(game)`（v6.233～v6.236 就是漏了這一步，整個功能三個版本
 *                    從來沒顯示過）。丟 Proxy 進來不會壞事：fail-closed 回 `unknown` 並留一行診斷。
 *                    ⇒ 本檔刻意**不 import svelte**，維持與框架無關（Node 守衛也直接呼叫它）
 * @param attackIndex `getEffectiveAttacks()` 的 index（與送出的 ATTACK action 同一套）
 * @param pool        卡池
 * @param viewerIdx   看畫面的人（＝出招方）；決定哪一份手牌算「隱藏」
 */
export function estimateAttackDamage(
  base: GameState | null | undefined,
  attackIndex: number,
  pool: Map<string, Card>,
  viewerIdx: 0 | 1,
): DamageEstimate {
  if (!base || base.phase !== 'playing' || base.pendingSelection) return { kind: 'unknown' };
  if (!Number.isInteger(attackIndex) || attackIndex < 0) return { kind: 'unknown' };

  // ⭐v6.237【D】目前付不出這一招 ⇒ 改用「剛好把費用附滿」的假設再估（見 topUpEnergyForCost）。
  //   ⚠ 付得出來的招式：`topUp === null`，整條路徑與 v6.236 逐字相同（零行為變動）。
  const assumedEnergy = !canAffordNow(base, attackIndex, pool);
  const topUp: number | null = assumedEnergy ? 0 : null;

  const t = runOnce(base, attackIndex, pool, 'tails', viewerIdx, false, topUp);
  const h = runOnce(base, attackIndex, pool, 'heads', viewerIdx, false, topUp);
  if (!t.ok || !h.ok) return { kind: 'unknown' };
  // 引擎完全沒受理這個 action（例：睡眠／本回合無法使用招式）⇒ 不顯示，別假裝是 0
  if (t.logAdded === 0 && h.logAdded === 0) return { kind: 'unknown' };

  // ⭐v6.237【D】傷害會不會隨「附著的能量數」變動？**多附 2 顆再跑一次**就知道 ——
  //   偵測是行為端的，不靠卡名清單也不靠卡面 regex（同檔頭「無上限」那一條的精神）。
  //   會變 ⇒ 上面那個數字只是「剛好附滿」的那一種，文案要講明白。
  let energyScaled = false;
  if (assumedEnergy) {
    const x = runOnce(base, attackIndex, pool, 'tails', viewerIdx, false, 2);
    energyScaled = x.ok && x.dmg !== t.dmg;
  }
  const note: EstimateNote = assumedEnergy ? { assumedEnergy: true, energyScaled } : {};

  // ① 擲幣「次數」本身取決於擲幣結果 ⇒ 無上限（「擲硬幣直到出現反面」）。
  //    這一條必須排在最前面：這型的全正面值是連續 20~30 次正面的理論值，當成範圍上界會誤導。
  if (t.flips !== h.flips) {
    return { ...note, kind: 'open', min: Math.min(t.dmg, h.dmg), formula: '', terms: h.terms };
  }

  // ② 會跳選擇視窗、而且此刻還沒造成傷害 ⇒ 依選擇而定（**不可顯示成 0**）。
  //    ⚠ 先造成傷害、之後才開 picker 的招式（例：拉普拉斯ex｜水炮迴旋）傷害已經定案，
  //      那種要照常顯示數字，所以這裡要同時看 dmg === 0。
  if ((t.pending && t.dmg === 0) || (h.pending && h.dmg === 0)) return { ...note, kind: 'depends', why: 'selection' };

  // ③ ⚠ 隱藏資訊防護：換一種可能的隱藏牌況再跑一次，結果變了就代表這個數字是「偷看」來的。
  //    ⚠⚠ v6.236：這一段必須排在「沒有傷害 ⇒ 不顯示」**前面**。
  //      否則依隱藏資訊的招式只要在**當下這個牌況**剛好打 0，就會走「不顯示」——
  //      而「有沒有顯示提示」本身就是一個看得出來的訊號（玩家等於得知牌庫頂不是那一張）。
  //      代價是純效果招式多跑兩次乾跑；實測 1174 個預估只有 2 個結論改變。
  const t2 = runOnce(base, attackIndex, pool, 'tails', viewerIdx, true, topUp);
  const h2 = runOnce(base, attackIndex, pool, 'heads', viewerIdx, true, topUp);
  if (!t2.ok || !h2.ok) return { ...note, kind: 'depends', why: 'hidden' };
  if (t2.dmg !== t.dmg || h2.dmg !== h.dmg || t2.flips !== t.flips || h2.flips !== h.flips) {
    return { ...note, kind: 'depends', why: 'hidden' };
  }

  // ④ 純效果、沒有傷害 ⇒ 不顯示
  if (t.dmg === 0 && h.dmg === 0) return { kind: 'none' };

  if (t.dmg === h.dmg) return { ...note, kind: 'exact', value: t.dmg, formula: t.formula, terms: t.terms };
  return {
    ...note,
    kind: 'range',
    min: Math.min(t.dmg, h.dmg),
    max: Math.max(t.dmg, h.dmg),
    // 兩次乾跑唯一的差別就是硬幣被固定成全反面／全正面 ⇒ 有擲幣就是擲幣造成的差。
    // 沒擲幣卻有差 ⇒ 來自別的隨機來源（例：隨機丟手牌），文案改用「隨機」。
    coin: h.flips > 0,
    formula: '',
    terms: h.terms,
  };
}

/** 一次估完戰鬥寶可夢的所有招式（index 與 `getEffectiveAttacks()` 對齊）。 */
export function estimateAllAttacks(
  base: GameState | null | undefined,
  attackCount: number,
  pool: Map<string, Card>,
  viewerIdx: 0 | 1,
): DamageEstimate[] {
  const out: DamageEstimate[] = [];
  for (let i = 0; i < attackCount; i++) out.push(estimateAttackDamage(base, i, pool, viewerIdx));
  return out;
}

/** 這個預估要不要顯示。 */
export function hasEstimateToShow(e: DamageEstimate | null | undefined): boolean {
  return !!e && e.kind !== 'none' && e.kind !== 'unknown';
}

/**
 * 「為什麼」——把引擎公式裡的**修正項**（弱點／抵抗力／各種加減傷）轉成短標籤。
 * ⚠ label 一律照抄引擎寫的字，不另行翻譯，避免與對戰紀錄裡的用字分家。
 */
export function estimateReasonText(e: DamageEstimate | null | undefined): string {
  if (!e || !('terms' in e)) return '';
  const mods = e.terms.filter(t => t.sign === '×' || t.sign === '+' || t.sign === '-');
  if (mods.length === 0) return '';
  return mods.map(t => `${t.label} ${t.sign}${t.value}`).join('、');
}

/**
 * 一行式文案（手機直式的招式列、桌機 hover 卡片的標題都用這一支）。
 * ⚠ 文案一律用「預估」，不可寫成「實際傷害」——預估用的是玩家自己那份盤面，
 *   若傷害取決於玩家不知道的資訊就會不準（那種情況已被 ④ 降級成「依…而定」）。
 */
export function estimateShortText(e: DamageEstimate | null | undefined): string {
  if (!e) return '';
  const core = estimateCoreText(e);
  if (!core) return '';
  // ⭐v6.237【D】能量還沒附夠時，數字是「假設剛好把費用附滿」算出來的 —— 逐字講明白，
  //   絕不讓玩家以為那是現況就打得出來的傷害。
  //   ⚠ 前綴／後綴加在**外面**，主體文案一個字都沒動（v6.234 的突變測試逐字釘住那一段）。
  return (e.assumedEnergy ? '附滿能量後' : '') + core + (e.energyScaled ? '（傷害依附著的能量而定）' : '');
}

/**
 * 主體文案。
 * ⚠ 這一段的字面量被 `test-v6234-resistance-label-and-coin-cap.mjs` 的突變測試逐字釘住，
 *   改字之前先去看那支守衛。
 * ⚠ 刻意**不 export**：全站唯一對外的文案入口只有 `estimateShortText`（守衛也釘死這件事）。
 */
function estimateCoreText(e: DamageEstimate): string {
  switch (e.kind) {
    case 'exact': {
      const why = estimateReasonText(e);
      return why ? `預估 ${e.value}（${why}）` : `預估 ${e.value}`;
    }
    case 'range': {
      const why = estimateReasonText(e);
      const src = e.coin ? '擲幣' : '隨機';
      return why ? `預估 ${e.min}～${e.max}（${src}；${why}）` : `預估 ${e.min}～${e.max}（${src}）`;
    }
    case 'open':
      // ⭐v6.234 站長裁定：舊文案「預估 0+（擲到反面為止，無上限）」的「0+」讀起來很怪。
      //   ⇒ 一律改講「傷害依擲幣次數而定」；基礎傷害不為 0 的招式（例：超級袋獸ex｜機關槍合擊 200+）
      //     先報起始值再講次數，才不會讓玩家以為那一招真的可能只打 0。
      //   ⚠ 手機直式與桌機都是呼叫這一支，**只有這一份字串**（禁兩份文案）。
      return e.min > 0
        ? `預估 ${e.min} 起，傷害依擲幣次數而定`
        : '預估：傷害依擲幣次數而定';
    case 'depends':
      return e.why === 'hidden' ? '預估：依看不到的牌而定' : '預估：依選擇而定';
    default:
      return '';
  }
}
