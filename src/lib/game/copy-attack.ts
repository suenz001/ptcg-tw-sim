/**
 * 借招（複製他人招式）家族的**中央管線** —— v6.337
 *
 * ── 為什麼要有這個檔（玩家回報的 bug）────────────────────────────────────────
 * 玩家用「呆呆王｜耀閃挑戰」翻出「火箭隊的謎擬Ｑ」，再用「扮晶晶酒」去學對手太晶
 * 寶可夢「多龍巴魯托ex」的招式時，**永遠只會用到第 1 招**。
 *
 * 真因不是扮晶晶酒一張卡，是結構性的：
 *   1. `action.copyAttackChoice` 是**單層** `{ pokeIid, attackIndex }`，但借招可以**鏈式**
 *      （官方 PTCG_RULES.md **L2276~2277** 明文承認：高傲指令翻到另一張貓老大ex，
 *        「可以」選它的高傲指令來用）。
 *   2. 全站 8 張借招卡**每一張都把同一個 action 原封往下傳**，沒有任何一層清掉 choice。
 *   3. 「怎麼讀 choice」的判準**各自手寫了一份**，驗證程度不一 ——
 *      耀閃挑戰／欺詐／試著模仿／揮指／技能大盜／高傲指令有驗 `pokeIid`，
 *      **扮晶晶酒完全沒驗**（只檢查 index 沒越界），暗黑底牌只驗一半。
 *   ⇒ 上一層的 `{謎擬Ｑ.iid, 0}` 被下一層拿去索引多龍巴魯托ex 的招式陣列 ＝ 串味。
 *
 * ── 這個檔負責什麼（IRON_RULES Rule 38：同一個判準只能有一份）────────────────
 *   A. `copyAttackCandidates()` —— **「這一層可以借哪些招」的唯一來源**。
 *      規則層與 UI picker 共用同一份 ⇒ 結構上保證「畫面上看得到的 ＝ 能勾的 ＝ 規則層認的」。
 *   B. `pickCopiedAttack()` —— **「怎麼從 action 取出屬於本層的選擇」的唯一判準**。
 *      鏈首的 `pokeIid` + `attackIndex` 必須**真的落在本層的候選裡**才算數；
 *      對不上就整條鏈丟掉走 fallback（fail-safe：深層不會再串味）。
 *
 * ⚠ 本檔的 runtime import **只有 `./types`**（純型別＋常數，不會回頭 import 本檔）⇒
 *   可以被 engine／effects／各卡檔／`+page.svelte` 任意 import 而不會成環
 *   （長期記憶：循環 import 下模組層級 `const` 會 TDZ）。
 */

import { RULE_BOX_SUBTYPES } from './types';
import type { GameState, CardInstance } from './types';
import type { Card } from '$lib/cards/types';

/** `card.attacks` 的元素型別（避免猜 `$lib/cards/types` 的匯出名） */
type CardAttack = NonNullable<Card['attacks']>[number];

/** 玩家在某一層借招 picker 上做的選擇 */
export type CopyChoice = { pokeIid: string; attackIndex: number };

/** 這一層可以借的一個「(招式持有者, 招式)」組合 */
export type CopyCandidate = {
  /** 招式持有者的場上／牌庫實體 iid —— 選擇的比對鍵 */
  ownerIid: string;
  ownerCardId: string;
  ownerName: string;
  /** 在 `card.attacks` 裡的**原始 index**（UI 與規則層必須用同一套 index） */
  attackIndex: number;
  attackName: string;
  /** 印刷傷害（`parseDmg`；非數字開頭＝0），只給 fallback 排序用 */
  damage: number;
};

/**
 * 借招鏈的深度上限。
 * 官方允許借招借到借招（L2277），但實作必須有界，否則可以構造出無限遞迴。
 * 到達上限時，本層的候選會**排除所有借招招式**，強迫這一層落在一個終端招式上。
 */
export const COPY_ATTACK_MAX_DEPTH = 4;

/**
 * 全站「借用他人招式」的招式 key（`卡名|招式名`）。
 * ⚠ 新增借招卡時**只改這裡**：規則層的深度上限、UI 的遞迴 picker 都讀這一份。
 * ⚠ 不含「借支援者效果」的魔牆人偶｜相仿秀、九尾｜靈怪變化（它們走
 *   `runAsCopiedSupporterEffect`，不是招式複製），也不含只「鎖招」不借招的無理取鬧／記憶之鎖。
 */
export const COPY_ATTACK_KEYS: readonly string[] = [
  '皮可西|揮指',
  '呆呆王|耀閃挑戰',
  '火箭隊的謎擬Ｑ|扮晶晶酒',
  'N的索羅亞克ex|暗黑底牌',
  '火箭隊的貓老大ex|高傲指令',
  '索羅亞克|欺詐',
  '阿響的樹才怪|試著模仿',
  '狐大盜|技能大盜',
];

const COPY_ATTACK_KEY_SET: ReadonlySet<string> = new Set(COPY_ATTACK_KEYS);

export function isCopyAttackKey(key: string | undefined | null): boolean {
  return !!key && COPY_ATTACK_KEY_SET.has(key);
}

/** 印刷傷害解析：只取開頭的數字（`120+` → 120、`×20` → 0） */
export function parsePrintedDamage(dmg: string | undefined | null): number {
  const m = String(dmg ?? '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// 鏈：action 上的借招選擇
// ══════════════════════════════════════════════════════════════════════════════

/** 只讀 ATTACK action 上與借招有關的兩個欄位（避免把整個 GameAction 型別拖進來） */
export type CopyAttackActionView = {
  copyAttackChoice?: CopyChoice;
  copyAttackChain?: CopyChoice[];
} | undefined;

/**
 * 把 action 上的借招選擇攤平成一條鏈（第 1 層在前）。
 * - `copyAttackChoice` ＝ 第 1 層（既有欄位，向後相容：舊 client / AI 只送這個）
 * - `copyAttackChain` ＝ 第 2 層以後（v6.337 新增）
 */
export function copyAttackChainOf(action: CopyAttackActionView): CopyChoice[] {
  if (!action) return [];
  const out: CopyChoice[] = [];
  if (action.copyAttackChoice) out.push(action.copyAttackChoice);
  if (Array.isArray(action.copyAttackChain)) {
    for (const c of action.copyAttackChain) {
      if (c && typeof c.pokeIid === 'string' && typeof c.attackIndex === 'number') out.push(c);
    }
  }
  return out;
}

/**
 * 產生「要傳給下一層 PRE/POST」的 action：把 `rest` 這條剩餘的鏈重新裝回去。
 * ⚠ 這是**唯一**允許把借招選擇往下傳的方式 —— 直接把原 action 傳下去就是本次 bug 的成因。
 */
export function withCopyAttackChain<T extends object | undefined>(action: T, rest: CopyChoice[]): T {
  const base = (action ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...base };
  if (rest.length === 0) {
    delete next.copyAttackChoice;
    delete next.copyAttackChain;
  } else {
    next.copyAttackChoice = rest[0];
    if (rest.length > 1) next.copyAttackChain = rest.slice(1);
    else delete next.copyAttackChain;
  }
  return (action === undefined && rest.length === 0 ? undefined : next) as T;
}

// ══════════════════════════════════════════════════════════════════════════════
// A. 候選枚舉 —— 規則層與 UI 的唯一來源
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 依卡面判定「可以借的寶可夢」。每一條都對應卡面原文，改動前先回查
 * `static/cards/*.json` 的 `attacks[].effect`。
 */
function ownersFor(
  key: string, state: GameState, aIdx: 0 | 1, pool: Map<string, Card>,
): CardInstance[] {
  const dIdx = (1 - aIdx) as 0 | 1;
  const me = state.players[aIdx];
  const opp = state.players[dIdx];
  switch (key) {
    // 「選擇1個對手的戰鬥寶可夢持有的招式」
    case '皮可西|揮指':
    case '索羅亞克|欺詐':
    case '阿響的樹才怪|試著模仿':
      return opp.active ? [opp.active] : [];

    // 「選擇1個對手的戰鬥場的『太晶』寶可夢持有的招式」
    case '火箭隊的謎擬Ｑ|扮晶晶酒': {
      if (!opp.active) return [];
      const c = pool.get(opp.active.cardId);
      return c?.tags?.includes('太晶') ? [opp.active] : [];
    }

    // 「選擇1個對手的場上寶可夢持有的招式」（gate：自己 1 張手牌都沒有）
    case '狐大盜|技能大盜': {
      if (me.hand.length > 0) return [];
      return [...(opp.active ? [opp.active] : []), ...opp.bench];
    }

    // 「選擇1個自己的備戰區的『N的寶可夢』持有的招式」
    case 'N的索羅亞克ex|暗黑底牌':
      return me.bench.filter(b => pool.get(b.cardId)?.name?.startsWith('N的'));

    // 「將自己的牌庫上方1張卡丟棄，若那張卡為寶可夢卡（『擁有規則的寶可夢』除外）…」
    //   ⚠ 必須在「丟棄之前」呼叫（規則層與 UI 都是對同一個 deck[0] 取樣）。
    case '呆呆王|耀閃挑戰': {
      const top = me.deck[0];
      if (!top) return [];
      const c = pool.get(top.cardId);
      if (!c || c.supertype !== 'Pokemon') return [];
      // ⚠ 卡面「（『擁有規則的寶可夢』除外）」—— 判準走中央的 RULE_BOX_SUBTYPES（Rule 38：不另抄一份）
      if (RULE_BOX_SUBTYPES.has(String(c.subtype))) return [];
      return [top];
    }

    // 「將對手的牌庫上方10張卡翻到正面。若希望，選擇1個其中的寶可夢持有的招式…」
    case '火箭隊的貓老大ex|高傲指令':
      return opp.deck.slice(0, 10).filter(c => pool.get(c.cardId)?.supertype === 'Pokemon');

    default:
      return [];
  }
}

/**
 * 依 key 決定「哪些招式要被排除」。
 * 目前全站只有兩種排除：
 *   - 同名招式（揮指／欺詐／試著模仿：不可借對手同名的那一招，避免互相遞迴）
 *   - 自己這張卡的這一招（暗黑底牌不可複製自己）
 * ⚠ 高傲指令**不**排除自己 —— 官方 L2276~2277 明文允許借另一張貓老大ex 的高傲指令。
 */
function excludedAttack(key: string, ownerCard: Card, atk: CardAttack): boolean {
  switch (key) {
    // ⚠ v6.337：一律用「卡名|招式名」比對，不用招式名 ——
    //   只比招式名的話，將來只要進一張招式同名的卡（例如另一隻會「揮指」的寶可夢），
    //   對手那一招就會被錯誤排除。舊碼的 fallback 本來就是用 selfKey 比對的。
    case '皮可西|揮指':
    case '索羅亞克|欺詐':
    case '阿響的樹才怪|試著模仿':
    case 'N的索羅亞克ex|暗黑底牌':
      return `${ownerCard.name}|${atk.name}` === key;
    default:
      return false;
  }
}

/**
 * 目前已經借了幾層（＝借招堆疊的深度）。規則層不必自己算。
 * ⚠ UI 在「還沒 dispatch」時無法從 state 取得深度，必須自己把已經選了幾層傳進來。
 */
export function copyAttackDepth(state: GameState): number {
  return (state.pendingCopyAttackKeys ?? []).length;
}

/**
 * **「這一層可以借哪些招」的唯一來源。**
 * 規則層（各卡 regPre）與 UI（借招 picker）都必須走這一支，
 * 否則「顯示的」與「能選的」與「規則層認的」就會漂移（本次 bug 的孿生風險）。
 *
 * @param depth 目前是借招鏈的第幾層（0 ＝ 玩家親手點的那一招）。
 *              規則層可以省略（從 `state` 的借招堆疊算），UI 必須自己傳。
 *              到達 `COPY_ATTACK_MAX_DEPTH` 時排除所有借招招式，強迫落在終端招式上。
 */
export function copyAttackCandidates(
  key: string, state: GameState, aIdx: 0 | 1, pool: Map<string, Card>,
  depth: number = copyAttackDepth(state),
): CopyCandidate[] {
  const out: CopyCandidate[] = [];
  const atDepthCap = depth >= COPY_ATTACK_MAX_DEPTH - 1;
  for (const inst of ownersFor(key, state, aIdx, pool)) {
    const card = pool.get(inst.cardId);
    if (!card?.name || !card.attacks) continue;
    // ⚠ 官方 L2059~2060：「因訓練家卡或特性等效果可以使用的招式，不屬於這隻寶可夢持有的招式」
    //   ⇒ 這裡必須用**卡面 `card.attacks`**，不可以用 `getEffectiveAttacks`（含道具／潛入記憶招式）。
    for (let i = 0; i < card.attacks.length; i++) {
      const atk = card.attacks[i];
      if (!atk?.name) continue;
      if (excludedAttack(key, card, atk)) continue;
      if (atDepthCap && COPY_ATTACK_KEY_SET.has(`${card.name}|${atk.name}`)) continue;
      out.push({
        ownerIid: inst.iid,
        ownerCardId: inst.cardId,
        ownerName: card.name,
        attackIndex: i,
        attackName: atk.name,
        damage: parsePrintedDamage(atk.damage),
      });
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// B. 選招 —— 唯一判準
// ══════════════════════════════════════════════════════════════════════════════

export type CopyPickResult = {
  /** 選中的候選；候選為空時是 null（呼叫端負責寫「無可複製招式」的 log） */
  candidate: CopyCandidate | null;
  /** true ＝ 玩家自己選的；false ＝ fallback（AI／舊 client／鏈對不上） */
  byPlayer: boolean;
  /** 要傳給下一層的剩餘鏈（本層用掉一格；對不上時整條丟掉） */
  restChain: CopyChoice[];
};

/**
 * **借招家族「怎麼選招」的唯一判準。**
 *
 * 判準只有一句：**鏈首的選擇必須真的落在「本層的候選」裡**
 * （`ownerIid` 與 `attackIndex` 同時命中），否則就當它不屬於這一層。
 * 上一層的選擇，其 `pokeIid` 是上一層的持有者，**結構上不可能**命中本層的候選
 * ⇒ 串味在這裡被擋死，而不是靠每張卡各自記得寫一行 `pokeIid` 檢查。
 *
 * ⚠ 對不上時**整條鏈丟掉**（`restChain: []`）：鏈已經錯位，繼續往下傳只會讓更深的
 *   層級再串一次味。fail-safe 的代價是「更深層也走 fallback」，可接受。
 */
export function pickCopiedAttack(
  candidates: readonly CopyCandidate[], action: CopyAttackActionView,
): CopyPickResult {
  if (candidates.length === 0) return { candidate: null, byPlayer: false, restChain: [] };
  const chain = copyAttackChainOf(action);
  const head = chain[0];
  if (head) {
    const hit = candidates.find(c => c.ownerIid === head.pokeIid && c.attackIndex === head.attackIndex);
    if (hit) return { candidate: hit, byPlayer: true, restChain: chain.slice(1) };
  }
  // fallback：印刷傷害最高（同傷害時取先出現者 —— 與 v2.57 起的既有行為一致）
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].damage > best.damage) best = candidates[i];
  }
  return { candidate: best, byPlayer: false, restChain: [] };
}
