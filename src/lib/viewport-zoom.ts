// ⭐v6.469（全站 audit 2026-10-03，站長核准）：雙指放大只在「對戰畫面」禁止。
//
// 背景：app.html 的 viewport 從很早以前就是全站
//   `maximum-scale=1, user-scalable=no`（站長不記得當初原因；多半是防對戰頁雙擊／捏合把桌墊放大）。
//   ⇒ 卡牌資料庫、牌組公布欄這些「閱讀用」的頁面，Android 上也不能用兩指放大看小字（WCAG 1.4.4）。
//
// 規則（單一來源，layout 每次導頁後套用）：
//   ・/game、/tournament（同一個對戰元件）：維持原本的禁止縮放（與 app.html 逐字相同）。
//   ・其他頁、非 iOS：拿掉 maximum-scale 與 user-scalable ⇒ 可以兩指放大。
//   ・iOS：一律維持 app.html 原樣、不動。
//       iOS 10 之後 Safari 本來就**無視** user-scalable=no，兩指放大一直都可以；
//       而 maximum-scale=1 在 iOS 上的唯一作用是「點輸入框時不自動放大」（字級 < 16px 的欄位）
//       ⇒ 拿掉它反而會讓 iOS 玩家一點搜尋框畫面就跳大，是退步。
//   ⚠ app.html 本身一個字都不改（test-v6213 釘住原文；JS 掛掉時就是舊行為）。
//   ⚠ 從可縮放頁回到對戰頁時，重新設回 maximum-scale=1，瀏覽器會把縮放夾回 1 倍。

export const VIEWPORT_LOCKED = 'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no';
export const VIEWPORT_ZOOMABLE = 'width=device-width, initial-scale=1, viewport-fit=cover';

/** 去掉 base path 後，是不是對戰畫面（/game、/tournament 與其子路徑）。 */
export function isBattleRoute(pathname: string, base = ''): boolean {
  let p = String(pathname || '/');
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  return /^\/(game|tournament)(?:\.html)?(?:\/|$)/.test(p);
}

/** iPhone／iPad（含 iPadOS 13+ 偽裝成 Mac 的情況）。 */
export function isIOSLike(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

/** 該頁應該用哪一份 viewport；null ＝ 維持現狀不要動（iOS）。 */
export function desiredViewport(pathname: string, base: string, ios: boolean): string | null {
  if (ios) return null;
  return isBattleRoute(pathname, base) ? VIEWPORT_LOCKED : VIEWPORT_ZOOMABLE;
}

/** 套用到 document（只在內容真的不同時才寫，避免無謂的版面重算）。 */
export function applyViewportFor(pathname: string, base = ''): void {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const ios = isIOSLike(navigator.userAgent || '', (navigator as Navigator & { platform?: string }).platform || '', navigator.maxTouchPoints || 0);
  const want = desiredViewport(pathname, base, ios);
  if (want && meta.getAttribute('content') !== want) meta.setAttribute('content', want);
}
