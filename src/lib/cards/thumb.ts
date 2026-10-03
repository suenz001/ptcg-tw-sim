/**
 * v6.464 卡圖縮圖（全站單一來源）
 *
 * 由來（2026-10-01 實測，站長同意另開 repo）：
 *   官方卡圖是 868×1212 的 PNG，平均 427KB；官方 CloudFront 對台灣每次都 Miss（0.4～1.2 秒／張）。
 *   一局雙方約 46 張不同卡 ≈ 19.6MB。改用 450px 寬 WebP（q80，平均約 53KB）⇒ 一局約 2.4MB（少 88%）。
 *   縮圖放在獨立 repo suenz001/ptcg-tw-sim-img（GitHub Pages，Fastly 新加坡節點命中約 0.07 秒），
 *   不放 Oracle 主機：台灣 HiNet 到我們的站走 Cloudflare SJC（約 0.43 秒），而且會跟對戰 API 搶同一條隧道。
 *
 * 規則：
 *   - 只轉換 asia.pokemon-card.com 的 /tw/、/hk/ card-img PNG；其他網址（日版 jpg、站內圖）原樣回傳。
 *   - 只用在「小尺寸顯示」（盤面、手牌、選擇視窗、牌組格、資料庫格）。放大檢視（zoom／lightbox／
 *     卡片詳情大圖）一律用官方原圖，否則放大會糊。
 *   - 縮圖不存在（新卡還沒跑 scripts/gen-card-thumbs.py）或 GitHub 掛掉 ⇒ img-retry.ts 會**立刻**
 *     改用官方原圖 ⇒ 最壞＝跟 v6.463 以前一樣。這條退路一定要用 `use:retryImg={官方網址}` 接上。
 *   ⚠ THUMB_PATTERN 必須與 scripts/gen-card-thumbs.py 的 THUMB_RE 相同（產生器與轉換器判準一致），
 *     test-v6464-card-thumbs 會拿全資料庫網址兩邊各跑一次比對。
 */
export const THUMB_BASE = 'https://suenz001.github.io/ptcg-tw-sim-img/w450/';
export const THUMB_PATTERN = '^https://asia\\.pokemon-card\\.com/(tw|hk)/card-img/((?:tw|hk)\\d+)\\.png$';
const THUMB_RE = new RegExp(THUMB_PATTERN);

// >>> v6472-thumb-source-switch
/**
 * ⭐v6.472 站長要求：後台「📡 監控」一鍵切換全站卡圖來源（縮圖站 ↔ 官方原圖），用來比較體感速度。
 *   ・設定存在 Firestore `config/cardPolicy` 的 `thumbSource` 欄位（'official'＝官方原圖；沒有或其他值＝縮圖）。
 *     ⚠ 刻意掛在卡牌政策同一份文件：玩家端本來就會讀它（policy-loader，有 10 分鐘快取），**不多一次讀取、不多一個請求**。
 *   ・policy-loader 讀到後寫進 localStorage（THUMB_SRC_KEY）；本模組在載入時同步讀一次 ⇒ 第一張圖就用對的來源，
 *     不會先載縮圖再換原圖（重複下載）。代價：後台切換後，玩家最慢「10 分鐘快取過期＋重新整理頁面」才換。
 *   ・讀不到（無痕、被封鎖）一律＝縮圖（與 v6.464 起的預設相同）。
 */
export const THUMB_SRC_KEY = 'ptcg_thumb_src_v1';
let _useOfficial = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(THUMB_SRC_KEY) === 'official'; } catch { return false; }
})();
/** policy-loader 讀到後台設定時呼叫：記住設定（下次載入頁面生效；本頁也立即切換，之後新畫的圖用新來源）。 */
export function setThumbSourcePref(v: unknown): void {
  const official = v === 'official';
  _useOfficial = official;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(THUMB_SRC_KEY, official ? 'official' : 'thumb'); } catch { /* 寫不進去就算了 */ }
}
/** 目前是否改用官方原圖（測試／除錯用）。 */
export function isUsingOfficialCardImages(): boolean { return _useOfficial; }
// <<< v6472-thumb-source-switch

/** 官方卡圖網址 → 縮圖網址；不適用的網址原樣回傳（null/undefined 回空字串以外的原值）。
 *  ⭐v6.472：後台切成「官方原圖」時一律原樣回傳。 */
export function cardThumb<T extends string | null | undefined>(url: T): T | string {
  if (!url || _useOfficial) return url;
  const m = THUMB_RE.exec(url);
  return m ? THUMB_BASE + m[2] + '.webp' : url;
}

/** 這個網址是不是本站縮圖（img-retry 用來判斷「縮圖失敗 ⇒ 立刻改官方原圖」）。 */
export function isCardThumb(url: string | null | undefined): boolean {
  return !!url && url.startsWith(THUMB_BASE);
}
