// ⭐v6.483 卡片「單卡頁」（/card/{id}/，建置期預渲染的 SEO 頁）連結判準。
//
// 單卡頁只為「標準環境、玩家看得到」的卡產生（$lib/server/cardIndex.ts 的 getStdCardIds）。
//   ⚠ 建置期用的是**程式內建的預設卡牌政策**（DEFAULT_CARD_POLICY，建置時不會去讀後台政策），
//     所以這裡也用預設政策判斷，而不是執行期的 isCardMarkStandardLegal（後台改政策時兩者會不同，
//     用執行期判準會連到不存在的頁面）。兩者是否一致由 test-v6483 對全部真實卡逐張比對。
import { isHiddenFromPlayers } from './visibility';
import { DEFAULT_CARD_POLICY } from './regulation';

/** 這張卡有沒有單卡頁（＝建置期有預渲染）。 */
export function hasCardPage(card: { id?: string | number | null; regulationMark?: string | null } | null | undefined): boolean {
  if (!card || card.id == null || card.id === '') return false;
  if (isHiddenFromPlayers(card.id)) return false;
  const m = card.regulationMark;
  return !!m && DEFAULT_CARD_POLICY.allowedMarks.includes(m);
}

/** 單卡頁的站內路徑（含 base、結尾斜線）；沒有單卡頁回 null。 */
export function cardPageHref(base: string, card: { id?: string | number | null; regulationMark?: string | null } | null | undefined): string | null {
  return hasCardPage(card) ? `${base}/card/${encodeURIComponent(String(card!.id))}/` : null;
}

// ⭐v6.618 單卡頁（手機）右上角 ✕：回到原本的卡牌瀏覽頁面（站長：「參考卡片檢視的頁面的做法」）
//   ・上一頁就是卡牌資料庫（/cards，含 ?set=…&card=… 視窗狀態）且同一個分頁還有上一頁 ⇒ history.back()
//     （回到原本的卡包、篩選、捲動位置；從卡片視窗點「📄 單卡頁」過來的，回去視窗會再打開那張卡）
//   ・其他情況（搜尋引擎直接進來、分享連結、另開新分頁、從其他頁面過來）⇒ 到這張卡所屬卡包的卡牌列表
//   ・上一頁從哪裡判斷：站內換頁（SvelteKit 用戶端導航）用 afterNavigate 的 from；整頁載入（卡片視窗的連結就是整頁載入）
//     用 document.referrer。⚠ 用戶端導航時 document.referrer 不會更新（停在最初載入的那一頁），所以 from 優先。
export type CardPageBack = { kind: 'back' } | { kind: 'go'; href: string };

/** 這一筆歷史紀錄的「上一頁」網址（給 cardPageBackTarget 用）。
 *  ・用戶端導航（link／goto）：nav.from 就是上一頁。
 *  ・整頁載入（type 'enter'，from 為 null；卡片視窗的「📄 單卡頁」就是這種）：用 document.referrer。
 *  ・popstate（返回／前進手勢）：⚠ 倒退回本頁時 from 是「剛離開、排在後面的那一頁」，不是上一頁（審查 P2-1：
 *    直接進單卡頁 → 點麵包屑到 /cards → 返回 → 按 ✕ 會被誤判成 history.back() 而離開網站）⇒ 一律沿用這筆歷史紀錄
 *    第一次進來時記下的值（SvelteKit snapshot 會在 afterNavigate 之前還原；沒有就是空字串 ⇒ 走卡包列表）。 */
export function cardPagePrevUrl(nav: { type: string; fromHref: string | null }, referrer: string, kept: string): string {
  if (nav.type === 'popstate') return kept || '';
  if (nav.fromHref) return nav.fromHref;
  return referrer || '';
}

/** ✕ 該怎麼回去。prevUrl：上一頁的完整網址（沒有就傳空字串）。 */
export function cardPageBackTarget(o: { prevUrl: string; origin: string; base: string; historyLength: number; setCode: string }): CardPageBack {
  const fallback: CardPageBack = { kind: 'go', href: `${o.base}/cards?set=${encodeURIComponent(o.setCode)}` };
  if (!o.prevUrl || !(o.historyLength > 1)) return fallback;
  let u: URL;
  try { u = new URL(o.prevUrl); } catch { return fallback; }
  if (u.origin !== o.origin) return fallback;
  const p = u.pathname.replace(/\/+$/, '');
  return p === `${o.base}/cards` ? { kind: 'back' } : fallback;
}
