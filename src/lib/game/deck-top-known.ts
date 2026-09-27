/**
 * ⭐v6.429「自己擺到牌庫頂、所以自己知道是哪幾張」的紀錄（AI 對戰強化：呆呆王打法）。
 *
 * 【為什麼需要】
 *   暗碼迷的解讀（從牌庫選 2 張、以任意順序放回牌庫上方）、夜間學院（手牌 1 張放回牌庫上方）之後，
 *   擺牌的那一方**合法地知道**牌庫頂是什麼（呆呆王｜耀閃挑戰的打法就是靠這個）。
 *   AI 試算招式時會先把牌庫打亂（shuffleHiddenZonesForSim，避免偷看牌庫），
 *   所以沒有這份紀錄的話，AI 永遠「不知道」自己剛擺好的牌庫頂，打法無從成立。
 *
 * 【公平性：只記自己擺的、而且牌庫一有別的變動就作廢】
 *   紀錄 = { iids: 牌庫頂由上而下的已知卡, restSig: 擺好當下「已知卡以下那一段」的 iid 序列雜湊 }。
 *   讀取時驗證：目前牌庫必須等於「已知卡（上面可能已被抽走幾張）＋當時那一段原封不動」。
 *   ⇒ 抽牌（從上面拿走）不影響剩下的已知卡；洗牌、從中間拿卡、放到牌庫下方、放上別的卡……都會讓驗證失敗 ⇒ 什麼都不知道。
 *   雜湊只用來比對「那一段有沒有被動過」，不含卡片內容；紀錄只給擺牌的那一方自己用（AI 只讀自己那一側）。
 *
 * 【形狀】`{ p1?, p2? }`（Firestore 禁巢狀陣列：map 裡包 array 才可以；見 types.ts ancientAttackedIidsThisTurn 的說明）。
 * 本模組只提供純函式，不改任何規則行為：玩家看到的對戰結果與 v6.428 完全相同。
 */
import type { GameState } from './types';

export interface KnownDeckTop {
  iids: string[];
  restSig: string;
}

const keyOf = (pIdx: 0 | 1): 'p1' | 'p2' => (pIdx === 0 ? 'p1' : 'p2');

/** iid 序列的 FNV-1a 32 位元雜湊（十六進位）。只用來判斷「那一段有沒有被動過」。 */
export function deckSegmentSig(iids: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const id of iids) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x7c;                              // 分隔符，避免 ['ab','c'] 與 ['a','bc'] 撞在一起
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * 記錄：`topIids` 剛被 pIdx 這一方自己擺到牌庫頂（由上而下）。呼叫時 state 的牌庫必須已經是擺好之後的樣子。
 * 以 state 目前的牌庫計算「已知卡以下那一段」的雜湊。
 */
export function recordKnownDeckTop(state: GameState, pIdx: 0 | 1, topIids: readonly string[]): GameState {
  const deck = state.players[pIdx].deck;
  const k = topIids.length;
  // 防呆：牌庫頂真的就是這幾張才記（否則寧可不記——不知道比知道錯還好）
  for (let i = 0; i < k; i++) if (deck[i]?.iid !== topIids[i]) return clearKnownDeckTop(state, pIdx);
  const rec: KnownDeckTop = { iids: [...topIids], restSig: deckSegmentSig(deck.slice(k).map((c) => c.iid)) };
  return { ...state, deckTopKnown: { ...(state.deckTopKnown ?? {}), [keyOf(pIdx)]: rec } };
}

/** 清掉 pIdx 這一方的紀錄。 */
export function clearKnownDeckTop(state: GameState, pIdx: 0 | 1): GameState {
  if (!state.deckTopKnown?.[keyOf(pIdx)]) return state;
  const next = { ...(state.deckTopKnown ?? {}) };
  delete next[keyOf(pIdx)];
  return { ...state, deckTopKnown: next };
}

/**
 * 牌庫少於這個張數就一律當作不知道（fable 審查 A-2）。
 *   restSig 比對的是真實牌庫：整副被重洗後「剛好洗回原順序」時驗證也會通過，等於偷看到「洗牌結果沒變」。
 *   n 張牌洗回原順序的機率是 1/n!：n=3 是 1/6、n=4 是 1/24，n≥5 才 < 1%。真人玩家在這種情況下只會認為「洗過了、不知道」。
 */
export const KNOWN_DECK_TOP_MIN_DECK = 5;

/**
 * 目前 pIdx 這一方**合法知道**的牌庫頂（由上而下的 iid）。驗證失敗一律回 []。
 *   允許的變化只有一種：上面的已知卡被抽走了幾張（牌庫從上方減少）。
 */
export function knownDeckTopIids(state: GameState, pIdx: 0 | 1): string[] {
  const rec = state.deckTopKnown?.[keyOf(pIdx)];
  if (!rec || !Array.isArray(rec.iids) || rec.iids.length === 0) return [];
  const deck = state.players[pIdx].deck;
  if (deck.length < KNOWN_DECK_TOP_MIN_DECK) return [];
  const k = rec.iids.length;
  for (let drawn = 0; drawn <= k; drawn++) {
    const remainKnown = rec.iids.slice(drawn);
    if (deck.length < remainKnown.length) continue;
    let ok = true;
    for (let i = 0; i < remainKnown.length; i++) if (deck[i].iid !== remainKnown[i]) { ok = false; break; }
    if (!ok) continue;
    if (deckSegmentSig(deck.slice(remainKnown.length).map((c) => c.iid)) === rec.restSig) return remainKnown;
  }
  return [];
}
