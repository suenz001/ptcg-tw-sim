// v6.273 Firestore 讀取減量：首頁 changelog 的 admin override（config/homeChangelog）
//   localStorage TTL 快取。
// v6.281 負結果快取 6 小時 → 30 天，並綁站台版本（版本一變即失效）。
//
// 背景：這份 override 是 v5.755 的 admin 後台功能——「讀到才覆蓋」static/changelog.html
//   的內建內容。實際上它幾乎沒在用（2026-08-30 查證：Firestore 文件根本不存在），
//   但每一次首頁載入都要花 1 次 Firestore 讀取去「確認它不存在」，不分匿名，
//   是全站最大宗的 Firestore 讀取來源。
//   ⚠ v6.273 的 6 小時 TTL 實測幾乎零命中——玩家一天來一次，每次都過期。
//   2026-09-02 三份資料交叉定案：官方明文「查詢回零結果照樣計 1 讀，但不顯示在
//   用量儀表板」⇒ 這份 404 文件約 3.7 萬讀/天、佔免費額度 74%，儀表板上完全看不到
//   （細節見 docs/changelog-internal.md v6.281）。
//
// 做法（v6.281）：
//   ・正結果（admin 真的設了 override）：TTL 維持 6 小時——admin 改內容最慢 6 小時全站生效。
//   ・負結果（確認過不存在）：TTL 30 天，且快取綁站台版本（欄位 v）——版本一變即
//     視為未命中 ⇒ 每人每版最多 1 讀；站台常出新版，admin 日後真要啟用 override 時，
//     出一個新版就能讓全站的負結果快取立即失效，不必等 30 天。
//   ・舊格式快取（沒有 v 欄位，v6.273~v6.280 寫入）：一律視為未命中（重讀一次）。
//   ・localStorage 不可用（隱私模式/SSR）：照舊每次讀——行為與 v6.272 以前完全相同。
//   ・讀取失敗：不寫快取（下次載入再試）。
//   ・時鐘倒退（快取時間戳在未來）：視為過期（玩家時鐘會漂，v6.198 教訓）。
//
// 純函式抽在 lib（不進 .svelte），守衛可直接 bundle 實跑。
// ⚠ VERSION 以相對路徑 import 自 ./version——該檔是零 import 的純 leaf module
//   （整檔只有一個 export const），不可能與本檔形成循環 import
//   （Rule 12 的模組層級 TDZ 只發生在循環依賴下）。

import { VERSION } from './version';

export const HOME_CL_TTL_MS = 6 * 60 * 60 * 1000;            // 正結果：6 小時
export const HOME_CL_NEG_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 負結果：30 天（另受版本綁定約束）
const CACHE_KEY = 'ptcg_home_cl_cache_v1';

/** 讀快取。hit=false 代表「沒有可用快取，需要真的去讀 Firestore」。 */
export function readCachedOverride(now: number = Date.now()): { hit: boolean; html: string | null } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { hit: false, html: null };
    const o = JSON.parse(raw) as { at?: unknown; html?: unknown; v?: unknown };
    if (typeof o?.at !== 'number' || !Number.isFinite(o.at)) return { hit: false, html: null };
    if (o.v !== VERSION) return { hit: false, html: null };              // 版本改變／舊格式（無 v）→ 未命中
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
export function writeCachedOverride(html: string | null, now: number = Date.now()): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, html, v: VERSION })); } catch { /* 隱私模式等 → 下次照舊讀 */ }
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
