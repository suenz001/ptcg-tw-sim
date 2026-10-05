// ⭐v6.474 網頁版（≥1024px）介面強化：全站頂端列＋淺色／深色主題（站長：「全站主色調兩種都做」）。
//
// 這支是「哪一頁顯示頂端列」「哪一頁吃主題」「玩家選了哪個主題」的**單一來源**，全部是純函式，
// layout 與 SiteTopBar 只呼叫這裡，守衛也直接 import 這裡驗行為。
//
// 規則：
//   ・頂端列：後台（/admin）不顯示；其他頁都顯示。是否「只在網頁版顯示」由 CSS 的 @media (min-width:1024px) 決定，
//     ⇒ 手機（<1024px）版面一個像素都不變。
//     ⭐v6.475（站長：「對戰演練和錦標賽沒有用到上方的表頭」）：/game、/tournament 的**大廳**也顯示；
//     真正進入牌桌（對戰／觀戰／回放）時由對戰頁在 <html> 掛 data-battle-view，CSS 把頂端列收起來 ⇒ 牌桌空間不變。
//   ・主題：只有列在 THEMED_ROUTES 的頁面整頁吃 --ui-* 色票；頂端列本身兩種主題都跟著變，切換鈕每頁都有。
//   ・玩家沒選過 ⇒ 跟著作業系統的深色／淺色設定；選過 ⇒ 記在 localStorage。
//     ⚠ 讀寫 localStorage 一律包 try/catch（Safari 無痕模式 setItem 會丟例外）。
//   ・<html data-theme="light|dark"> 永遠是「實際生效的主題」⇒ CSS 只需要一種選擇器，不必再寫 prefers-color-scheme。

import { isBattleRoute } from '$lib/viewport-zoom';

export type UiTheme = 'light' | 'dark';

export const THEME_KEY = 'ptcg_ui_theme';

/** 目前已接上 --ui-* 色票的頁面（去掉 base 之後的路徑，整條比對）。後續階段在這裡加。 */
// ⭐v6.477：對戰大廳、錦標賽大廳、好友頁也接上（牌桌畫面另由 data-battle-view 排除，牌桌樣式不動）
export const THEMED_ROUTES: readonly RegExp[] = [/^\/$/, /^\/cards$/, /^\/card\/[^/]+$/, /^\/decks$/, /^\/deck-posts$/, /^\/game$/, /^\/tournament$/, /^\/friends$/];

/** 去掉 base path，統一成以 / 開頭、不帶結尾斜線（根目錄除外）。 */
export function stripBase(pathname: string, base = ''): string {
  let p = String(pathname || '/');
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1) p = p.replace(/\/+$/, '').replace(/\.html$/, '') || '/';
  return p;
}

/** 這一頁要不要渲染頂端列（網頁版）。對戰頁的牌桌另由 data-battle-view 收起（見 battleViewAttr）。 */
export function showTopBar(pathname: string, base = ''): boolean {
  const p = stripBase(pathname, base);
  return !/^\/admin(?:\/|$)/.test(p);
}

/** 對戰頁（/game、/tournament）目前是不是「牌桌畫面」：錦標賽看 tStep、休閒看有沒有盤面。
 *  判準沿用 viewport-zoom 的 isBattleRoute（不是對戰路由一律 false）。 */
export function isBattleView(pathname: string, base: string, tournament: boolean, tStep: string, hasGame: boolean): boolean {
  if (!isBattleRoute(pathname, base)) return false;
  return tournament ? tStep === 'playing' : hasGame;
}

/** 對戰頁呼叫：把「是不是牌桌畫面」寫到 <html data-battle-view>（頂端列據此收起）。 */
export function setBattleViewAttr(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-battle-view', '');
  else document.documentElement.removeAttribute('data-battle-view');
}

/** 這一頁是否已接上主題色票。 */
export function isThemedRoute(pathname: string, base = ''): boolean {
  const p = stripBase(pathname, base);
  return THEMED_ROUTES.some((re) => re.test(p));
}

/** 頂端列的導覽項目。match 用「路徑前綴」判斷目前所在頁（/card/123 也算卡牌資料庫）。 */
export const NAV_ITEMS: readonly { href: string; label: string; match: RegExp }[] = [
  { href: '/cards', label: '卡牌資料庫', match: /^\/cards?(?:\/|$)/ },
  { href: '/decks', label: '牌組編輯器', match: /^\/decks(?:\/|$)/ },
  { href: '/deck-posts', label: '牌組公布欄', match: /^\/deck-posts(?:\/|$)/ },
  { href: '/game', label: '對戰演練', match: /^\/game(?:\/|$)/ },
  { href: '/tournament', label: '錦標賽', match: /^\/tournament(?:\/|$)/ },
];

/** 目前所在的導覽項目 href；都不是 ⇒ ''（例如首頁）。 */
export function activeNavHref(pathname: string, base = ''): string {
  const p = stripBase(pathname, base);
  const hit = NAV_ITEMS.find((it) => it.match.test(p));
  return hit ? hit.href : '';
}

/** 解析存起來的值；不是 light/dark 一律當成「沒選過」。 */
export function parseStoredTheme(raw: unknown): UiTheme | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

/** 實際生效的主題：玩家選過就用玩家的，否則跟作業系統。 */
export function resolveTheme(stored: UiTheme | null, systemPrefersDark: boolean): UiTheme {
  return stored ?? (systemPrefersDark ? 'dark' : 'light');
}

export function readStoredTheme(): UiTheme | null {
  try { return parseStoredTheme(localStorage.getItem(THEME_KEY)); } catch { return null; }
}

function systemPrefersDark(): boolean {
  try { return !!(typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches); } catch { return false; }
}

/** 把實際生效的主題寫到 <html data-theme>；回傳寫入的值。 */
export function applyTheme(): UiTheme {
  const t = resolveTheme(readStoredTheme(), systemPrefersDark());
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t);
  return t;
}

/** 玩家按下切換：存起來並立即套用；回傳新主題。 */
export function setTheme(t: UiTheme): UiTheme {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* 存不了就只套用這一次 */ }
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t);
  return t;
}

/** 沒選過的玩家：作業系統切換深淺色時跟著變。回傳取消監聽的函式。 */
export function followSystemTheme(onChange: (t: UiTheme) => void): () => void {
  try {
    if (typeof matchMedia !== 'function') return () => {};
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => { if (readStoredTheme() === null) onChange(applyTheme()); };
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  } catch { return () => {}; }
}

/** ⭐v6.477：網頁版（≥1024px）旗標寫到 <html data-ui-wide>。
 *  用途：對戰頁的大廳淺色規則**不能用 @media**（對戰頁的 @media 數量被多支守衛釘死：手機／桌機不靠斷點切版，
 *  test-v6199／v6448～v6450／v6466／v6470），改用這個屬性當桌機條件；斷點與 SiteTopBar／各頁的 min-width:1024px 相同。
 *  回傳取消監聽的函式。 */
export const WIDE_QUERY = '(min-width: 1024px)';
export function trackWideAttr(): () => void {
  try {
    if (typeof document === 'undefined' || typeof matchMedia !== 'function') return () => {};
    const mq = matchMedia(WIDE_QUERY);
    const apply = () => { if (mq.matches) document.documentElement.setAttribute('data-ui-wide', ''); else document.documentElement.removeAttribute('data-ui-wide'); };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  } catch { return () => {}; }
}
