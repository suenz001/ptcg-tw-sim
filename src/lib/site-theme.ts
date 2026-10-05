// ⭐v6.474 網頁版（≥1024px）介面強化：全站頂端列＋淺色／深色主題（站長：「全站主色調兩種都做」）。
//
// 這支是「哪一頁顯示頂端列」「哪一頁吃主題」「玩家選了哪個主題」的**單一來源**，全部是純函式，
// layout 與 SiteTopBar 只呼叫這裡，守衛也直接 import 這裡驗行為。
//
// 規則：
//   ・頂端列：對戰畫面（/game、/tournament，判準沿用 viewport-zoom.ts 的 isBattleRoute，不另寫一份）
//     與後台（/admin）不顯示；其他頁都顯示。是否「只在網頁版顯示」由 CSS 的 @media (min-width:1024px) 決定，
//     ⇒ 手機（<1024px）版面一個像素都不變。
//   ・主題：只有列在 THEMED_ROUTES 的頁面真的吃 --ui-* 色票；其他頁在後續階段才接上。
//     切換鈕也只在這些頁面出現（在還沒接上主題的頁面按了沒反應，只會讓玩家困惑）。
//   ・玩家沒選過 ⇒ 跟著作業系統的深色／淺色設定；選過 ⇒ 記在 localStorage。
//     ⚠ 讀寫 localStorage 一律包 try/catch（Safari 無痕模式 setItem 會丟例外）。
//   ・<html data-theme="light|dark"> 永遠是「實際生效的主題」⇒ CSS 只需要一種選擇器，不必再寫 prefers-color-scheme。

import { isBattleRoute } from '$lib/viewport-zoom';

export type UiTheme = 'light' | 'dark';

export const THEME_KEY = 'ptcg_ui_theme';

/** 目前已接上 --ui-* 色票的頁面（去掉 base 之後的路徑）。後續階段在這裡加。 */
export const THEMED_ROUTES: readonly string[] = ['/'];

/** 去掉 base path，統一成以 / 開頭、不帶結尾斜線（根目錄除外）。 */
export function stripBase(pathname: string, base = ''): string {
  let p = String(pathname || '/');
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1) p = p.replace(/\/+$/, '').replace(/\.html$/, '') || '/';
  return p;
}

/** 這一頁要不要顯示頂端列（網頁版）。 */
export function showTopBar(pathname: string, base = ''): boolean {
  if (isBattleRoute(pathname, base)) return false;
  const p = stripBase(pathname, base);
  return !/^\/admin(?:\/|$)/.test(p);
}

/** 這一頁是否已接上主題色票。 */
export function isThemedRoute(pathname: string, base = ''): boolean {
  return THEMED_ROUTES.includes(stripBase(pathname, base));
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
