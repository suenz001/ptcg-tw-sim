// v6.273 Firestore 讀取減量：首頁 changelog 的 admin override（config/homeChangelog）
//   localStorage TTL 快取。
// v6.281 負結果快取 6 小時 → 30 天，並綁站台版本（版本一變即失效）。
// v6.306 ⭐ 靜態檔閘門：訊號 = 0 時**根本不呼叫 Firestore**（連 getDoc 都不發）。
//
// 背景：這份 override 是 v5.755 的 admin 後台功能——「讀到才覆蓋」static/changelog.html
//   的內建內容。實際上它幾乎沒在用（2026-08-30 查證：Firestore 文件根本不存在），
//   但每一次首頁載入都要花 1 次 Firestore 讀取去「確認它不存在」，不分匿名，
//   是全站最大宗的 Firestore 讀取來源（官方明文：零結果查詢照樣計 1 讀、且不顯示在
//   用量儀表板；約 3.7 萬讀/天、佔免費額度 74%）。
//   ⚠ v6.273 的 6 小時 TTL 實測幾乎零命中（玩家一天來一次，每次都過期）。
//   ⚠ v6.281 的「30 天＋綁站台版本」被站台的出版頻率打死：58 小時內出了 23 版
//     ⇒ 等效 TTL ≈ 2.5 小時，比 6 小時還短；monitor dump 實測回訪命中率反而從 44.9% 掉到 38.7%。
//   ⚠⚠ 更根本的問題：任何 localStorage 策略**只救得了回訪者**。可證明的讀取只有
//     3,500~9,500/天，站長觀測 43,000 ⇒ 缺口來自匿名／LINE・FB 內嵌瀏覽器／爬蟲這批
//     看不到的母體，他們的 localStorage 很可能根本不持久 ⇒ 快取對他們永遠零命中。
//
// 做法（v6.306）：
//   ・首頁本來就會 fetch static/changelog.html；該檔最後一行帶一個世代訊號
//       <!-- ptcg-override-gen:N -->
//     由 parseOverrideGen() 解析（缺訊號／非法 ⇒ 0）。
//   ・N = 0 ⇒ loadHomeChangelogOverride() 直接回 null，**不呼叫 fetchOverride**
//     ⇒ 所有人（首訪、匿名、內嵌瀏覽器、爬蟲）都是 0 讀。價值不在「提高命中率」，
//     而在「根本不發請求」，所以不受 localStorage 持久性影響。
//   ・N ≠ 0 ⇒ 才讀 Firestore，且以 N 當快取 key（欄位 g，取代 v6.281 的站台版本 v）：
//     admin 改一次 override、把訊號 +1 出一版，全站立刻生效，不必等 30 天。
//   ・正結果（admin 真的設了 override）：TTL 6 小時——admin 改內容最慢 6 小時全站生效。
//   ・負結果（N ≠ 0 但文件不存在）：TTL 30 天，並綁 N。
//   ・舊格式快取（欄位 v 或無 g）：一律視為未命中。
//   ・localStorage 不可用（隱私模式/SSR）：N ≠ 0 時照舊每次讀；N = 0 時仍然 0 讀。
//   ・讀取失敗：不寫快取（下次載入再試）。
//   ・時鐘倒退（快取時間戳在未來）：視為過期（玩家時鐘會漂，v6.198 教訓）。
//
// 純函式抽在 lib（不進 .svelte），守衛可直接 bundle 實跑。本檔零 import。

export const HOME_CL_TTL_MS = 6 * 60 * 60 * 1000;            // 正結果：6 小時
export const HOME_CL_NEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 負結果：30 天（另受世代綁定約束）
const CACHE_KEY = 'ptcg_home_cl_cache_v1';

/** static/changelog.html 最後一行的世代訊號（位置無關，整檔 regex）。0 ＝ 不讀 Firestore。 */
export const OVERRIDE_GEN_RE = /<!--\s*ptcg-override-gen:(\d+)\s*-->/;

/** 從 changelog.html 內容解析世代；缺訊號／非法／非正整數 ⇒ 0（fail-closed：不發請求）。 */
export function parseOverrideGen(html: unknown): number {
  if (typeof html !== 'string') return 0;
  const m = OVERRIDE_GEN_RE.exec(html);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** 世代是否為「要讀 Firestore」的正整數。 */
function isLiveGen(gen: unknown): gen is number {
  return typeof gen === 'number' && Number.isSafeInteger(gen) && gen > 0;
}

/** 讀快取。hit=false 代表「沒有可用快取，需要真的去讀 Firestore」。 */
export function readCachedOverride(gen: number, now: number = Date.now()): { hit: boolean; html: string | null } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { hit: false, html: null };
    const o = JSON.parse(raw) as { at?: unknown; html?: unknown; g?: unknown };
    if (typeof o?.at !== 'number' || !Number.isFinite(o.at)) return { hit: false, html: null };
    if (o.g !== gen) return { hit: false, html: null };                  // 世代改變／舊格式（無 g）→ 未命中
    if (o.at > now) return { hit: false, html: null };                   // 時鐘倒退 → 視為過期
    if (o.html !== null && typeof o.html !== 'string') return { hit: false, html: null }; // 形狀不對 → 當損毀
    const ttl = o.html === null ? HOME_CL_NEG_TTL_MS : HOME_CL_TTL_MS;   // 負結果 30 天／正結果 6 小時
    if (now - o.at >= ttl) return { hit: false, html: null };            // TTL 到期
    return { hit: true, html: o.html };
  } catch {
    return { hit: false, html: null };  // 損毀/隱私模式 → 照舊讀 Firestore
  }
}

/** 寫快取（html=null 代表「確認過 override 不存在」的負結果）。失敗靜默（隱私模式）。 */
export function writeCachedOverride(html: string | null, gen: number, now: number = Date.now()): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, html, g: gen })); } catch { /* 隱私模式等 → 下次照舊讀 */ }
}

/**
 * 取得 override html（null＝沒有 override，用內建）。
 * gen 不是正整數（訊號 0／缺訊號）⇒ 直接 null，**不呼叫 fetchOverride**（0 次 Firestore 讀取）。
 * 否則 TTL 內用快取（0 次讀取）；否則呼叫 fetchOverride（1 次讀取）並把結果
 * （含負結果）寫回快取。fetchOverride 失敗 → 往上丟、不寫快取（呼叫端沿用既有 .catch）。
 */
export async function loadHomeChangelogOverride(
  gen: number,
  fetchOverride: () => Promise<string | null>
): Promise<string | null> {
  if (!isLiveGen(gen)) return null;                                     // ⭐ 閘門：訊號 0 ⇒ 不發請求
  const cached = readCachedOverride(gen);
  if (cached.hit) return cached.html;
  const html = await fetchOverride();
  writeCachedOverride(typeof html === 'string' && html ? html : null, gen);
  return html;
}
