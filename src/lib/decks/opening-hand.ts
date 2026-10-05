// ⭐v6.485 牌組編輯器「🎲 測抽」的純函式（站長同意的建議 #3）。
//
// 模擬對戰開始：洗牌 → 抽 7 張起手 → 擺 6 張獎賞卡；之後可以一張一張往下抽（模擬每回合抽牌）。
// ・起手判定與引擎（engine.ts 的 classifyOpeningHand）同一套分法：
//     has-basic ＝ 手牌有基礎寶可夢；burst-only ＝ 沒有基礎、但有可直接放戰鬥場的卡（閃焰王牌的【瞬間爆發力】）；
//     none ＝ 兩者都沒有（實戰要重抽，對手可多抽）。
//   基礎判準直接呼叫中央 isBasicPokemonCard；「可放戰鬥場」與引擎 canBeInitialActiveCard 是否一致，
//   由 test-v6485 對全部真實卡逐張比對（避免為了這個小功能把整個引擎打包進牌組編輯器）。
// ・機率：起手 7 張至少 1 張基礎寶可夢 ＝ 1 − C(N−B, 7) / C(N, 7)（超幾何分布，N＝牌組張數、B＝基礎寶可夢張數）。
// ・亂數可注入（守衛用固定亂數驗證），預設 Math.random（這只是畫面上的練習，不影響任何對戰）。
import type { Card } from '$lib/cards/types';
import { isBasicPokemonCard } from '$lib/game/selection-filter';

export const OPENING_HAND = 7;
export const PRIZE_COUNT = 6;
/** 閃焰王牌的特性名（與引擎 canBeInitialActiveCard 相同；test-v6485 逐卡比對兩者結果） */
const INSTANT_BURST = '瞬間爆發力';

export type OpeningKind = 'has-basic' | 'burst-only' | 'none';
export type SimCard = { key: number; card: Card };
export type SimState = { hand: SimCard[]; prizes: SimCard[]; deck: SimCard[] };

/** 可以在對戰準備時放到戰鬥場（基礎寶可夢，或有【瞬間爆發力】的寶可夢）。 */
export function canStartActive(card: Card | undefined): boolean {
  if (!card || card.supertype !== 'Pokemon' || card.subtype === 'Other') return false;
  // ⚠ 用回傳 boolean 的 isBasicOf，不直接用型別述詞 isBasicPokemonCard：述詞會把下一行的 card 窄成 never（tsc 紅）
  if (isBasicOf(card)) return true;
  return !!card.abilities?.some((ab) => ab.name === INSTANT_BURST);
}

/** 依牌組內容展開成一張張卡（每張給唯一 key，畫面 {#each} 用）。 */
export function expandDeck(entries: readonly { card: Card; count: number }[]): SimCard[] {
  const out: SimCard[] = [];
  let k = 0;
  for (const { card, count } of entries) for (let i = 0; i < Math.max(0, Math.floor(count)); i++) out.push({ key: k++, card });
  return out;
}

/** Fisher–Yates 洗牌（回傳新陣列，不改原陣列）。 */
export function shuffled<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 洗牌、抽 7 張、擺 6 張獎賞；牌不夠時能抽多少抽多少。 */
export function dealOpening(deck: readonly SimCard[], rng: () => number = Math.random): SimState {
  const d = shuffled(deck, rng);
  const hand = d.slice(0, OPENING_HAND);
  const prizes = d.slice(OPENING_HAND, OPENING_HAND + PRIZE_COUNT);
  return { hand, prizes, deck: d.slice(OPENING_HAND + PRIZE_COUNT) };
}

/** 從牌庫頂抽一張到手牌（牌庫空了就原樣回傳）。 */
export function drawOne(st: SimState): SimState {
  if (st.deck.length === 0) return st;
  return { hand: [...st.hand, st.deck[0]], prizes: st.prizes, deck: st.deck.slice(1) };
}

/** 起手判定（與引擎同一套三態）。 */
export function classifyOpening(hand: readonly SimCard[]): OpeningKind {
  if (hand.some((h) => isBasicPokemonCard(h.card))) return 'has-basic';
  if (hand.some((h) => canStartActive(h.card))) return 'burst-only';
  return 'none';
}

/** 組合數 C(n, k)（用乘法累乘，n≤60 不會溢位）。 */
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** 起手 hand 張中至少 1 張基礎寶可夢的機率（0～1）。N＝牌組張數、B＝基礎寶可夢張數。 */
export function basicInOpeningProb(N: number, B: number, hand = OPENING_HAND): number {
  if (N <= 0 || B <= 0) return 0;
  const h = Math.min(hand, N);
  if (N - B < h) return 1;
  return 1 - comb(N - B, h) / comb(N, h);
}

/** 這張卡是不是基礎寶可夢（畫面標示用；直接呼叫中央述詞）。 */
export function isBasicOf(card: Card | undefined): boolean {
  return isBasicPokemonCard(card);
}
