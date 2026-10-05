// ⭐v6.483 卡牌資料庫的搜尋／篩選條件寫進網址（站長同意的建議 #1）。
//
// 為什麼：搜尋語法（v6.481）做強了，但搜出來的結果無法分享，按返回或重新整理條件就全丟。
// 做法：條件寫進網址參數（用 replaceState，不新增瀏覽紀錄、不觸發重新載入），進頁時讀回來。
//   ・參數：q＝搜尋字、m＝搜尋模式、s＝關鍵字範圍、cat／tag／type／stage／mark＝多選篩選（逗號分隔）、card＝開著的卡片。
//   ・`set`（卡包）由路由本身處理（+page.ts 的 load），這裡原封保留、不碰。
//   ・讀回時逐項驗證（只收白名單裡的值）⇒ 網址被亂改也不會讓頁面壞掉，不認得的值直接忽略。
//   ・條件都是預設值時不寫任何參數 ⇒ 一般瀏覽的網址跟以前一模一樣。

export type CardsUrlState = {
  q: string;
  mode: 'normal' | 'keyword' | 'evolution';
  scope: 'all' | 'attacks' | 'abilities';
  cat: string[];
  tag: string[];
  type: string[];
  stage: string[];
  mark: string[];
  card: string | null;
};

/** 每個多選篩選可以接受的值（由頁面提供，與畫面上的按鈕同一份清單）。 */
export type CardsUrlAllowed = { cat: readonly string[]; tag: readonly string[]; type: readonly string[]; stage: readonly string[]; mark: readonly string[] };

const MODES = ['normal', 'keyword', 'evolution'] as const;
const SCOPES = ['all', 'attacks', 'abilities'] as const;
/** 搜尋字長度上限（網址太長某些瀏覽器／通訊軟體會截斷） */
export const URL_Q_MAX = 200;
const LIST_KEYS = ['cat', 'tag', 'type', 'stage', 'mark'] as const;
/** 本模組管理的參數（寫入時先清掉這些，再依目前狀態寫回；其他參數一律保留） */
export const CARDS_URL_KEYS = ['q', 'm', 's', ...LIST_KEYS, 'card'] as const;

/** 從網址參數讀回條件；不合法的值一律忽略。 */
export function readCardsUrlState(search: string, allowed: CardsUrlAllowed): CardsUrlState {
  let sp: URLSearchParams;
  try { sp = new URLSearchParams(search); } catch { sp = new URLSearchParams(); }
  const m = sp.get('m');
  const s = sp.get('s');
  const list = (k: (typeof LIST_KEYS)[number]) => {
    const raw = sp.get(k);
    if (!raw) return [];
    const ok = new Set(allowed[k]);
    // 去重＋保留白名單裡的值（順序依網址，畫面上的 Set 不在乎順序）
    return [...new Set(raw.split(',').map((x) => x.trim()).filter((x) => ok.has(x)))];
  };
  const card = sp.get('card');
  return {
    q: (sp.get('q') ?? '').slice(0, URL_Q_MAX),
    mode: (MODES as readonly string[]).includes(m ?? '') ? (m as CardsUrlState['mode']) : 'normal',
    scope: (SCOPES as readonly string[]).includes(s ?? '') ? (s as CardsUrlState['scope']) : 'all',
    cat: list('cat'), tag: list('tag'), type: list('type'), stage: list('stage'), mark: list('mark'),
    card: card && /^[A-Za-z0-9_-]{1,40}$/.test(card) ? card : null,
  };
}

/** 依目前條件產生新的 search 字串（含開頭的 ?；沒有任何參數時回 ''）。保留不屬於本模組的參數（例如 set）。 */
export function writeCardsUrlSearch(currentSearch: string, st: CardsUrlState): string {
  let sp: URLSearchParams;
  try { sp = new URLSearchParams(currentSearch); } catch { sp = new URLSearchParams(); }
  for (const k of CARDS_URL_KEYS) sp.delete(k);
  const q = st.q.trim().slice(0, URL_Q_MAX);
  if (q) sp.set('q', q);
  if (st.mode !== 'normal') sp.set('m', st.mode);
  if (st.mode === 'keyword' && st.scope !== 'all') sp.set('s', st.scope);
  for (const k of LIST_KEYS) if (st[k].length) sp.set(k, [...st[k]].sort().join(','));
  if (st.card) sp.set('card', st.card);
  const out = sp.toString();
  return out ? '?' + out : '';
}
