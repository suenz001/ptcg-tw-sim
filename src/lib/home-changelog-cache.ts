// v6.273 Firestore 讀取減量：首頁 changelog 的 admin override（config/homeChangelog）
//   localStorage TTL 快取。
//
// 背景：這份 override 是 v5.755 的 admin 後台功能——「讀到才覆蓋」static/changelog.html
//   的內建內容。實際上它幾乎沒在用（2026-08-30 查證：Firestore 文件根本不存在），
//   但每一次首頁載入都要花 1 次 Firestore 讀取去「確認它不存在」，不分匿名，
//   是全站最大宗的 Firestore 讀取來源。
//
// 做法：把「上次確認的結果」（含 html=null 的負結果）連同時間戳記在 localStorage，
//   TTL（6 小時）內直接用快取、不打 Firestore。
//   ・admin 之後若新增/修改 override：新訪客與快取過期者立即看到，其餘最慢 6 小時。
//   ・localStorage 不可用（隱私模式/SSR）：照舊每次讀 —— 行為與 v6.272 以前完全相同。
//   ・讀取失敗：不寫快取（下次載入再試）。
//   ・時鐘倒退（快取時間戳在未來）：視為過期（玩家時鐘會漂，v6.198 教訓）。
//
// 純函式抽在 lib（不進 .svelte），守衛可直接 bundle 實跑。

export const HOME_CL_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時
const CACHE_KEY = 'ptcg_home_cl_cache_v1';

/** 讀快取。hit=false 代表「沒有可用快取，需要真的去讀 Firestore」。 */
export function readCachedOverride(now: number = Date.now()): { hit: boolean; html: string | null } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { hit: false, html: null };
    const o = JSON.parse(raw) as { at?: unknown; html?: unknown };
    if (typeof o?.at !== 'number' || !Number.isFinite(o.at)) return { hit: false, html: null };
    if (o.at > now) return { hit: false, html: null };                   // 時鐘倒退 → 視為過期
    if (now - o.at >= HOME_CL_TTL_MS) return { hit: false, html: null }; // TTL 到期
    if (o.html !== null && typeof o.html !== 'string') return { hit: false, html: null }; // 形狀不對 → 當損毀
    return { hit: true, html: o.html };
  } catch {
    return { hit: false, html: null };  // 損毀/隱私模式 → 照舊讀 Firestore
  }
}

/** 寫快取（html=null 代表「確認過 override 不存在」的負結果）。失敗靜默（隱私模式）。 */
export function writeCachedOverride(html: string | null, now: number = Date.now()): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, html })); } catch { /* 隱私模式等 → 下次照舊讀 */ }
}

/**
 * 取得 override html（null＝沒有 override，用內建）。
 * TTL 內用快取（0 次 Firestore 讀取）；否則呼叫 fetchOverride（1 次讀取）並把結果
 * （含負結果）寫回快取。fetchOverride 失敗 → 往上丟、不寫快取（呼叫端沿用既有 .catch）。
 */
export async function loadHomeChangelogOverride(
  fetchOverride: () => Promise<string | null>
): Promise<string | null> {
  const cached = readCachedOverride();
  if (cached.hit) return cached.html;
  const html = await fetchOverride();
  writeCachedOverride(typeof html === 'string' && html ? html : null);
  return html;
}
