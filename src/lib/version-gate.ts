/**
 * ⭐⭐⭐ v6.384 版本閘的**唯一判準**。
 *
 * 在這一版之前，「client 版本太舊要不要擋」的邏輯只存在於 `/game` 頁面裡的
 * `tCheckinBlockedByVersion()`（v6.160~v6.167 累積出來的五條 fail-open），
 * 而且只服務「錦標賽報到」一個入口。
 * 站長 2026-09-14 裁定要把同一套沿用到**休閒（一般）對戰**的
 * 【建立房間】【加入】【觀戰】三個入口 ——
 * ⇒ 判準必須抽成單一來源（IRON_RULES Rule 38：同一個判準只能有一份）。
 *   若讓休閒那邊自己再寫一份 if，兩份遲早會漂移，而且「漂移的那一份」
 *   一定是沒有守衛盯著的那一份。
 *
 * ⚠⚠⚠ 這支函式的每一條失敗路徑都必須 **fail-open**（回 `block: false` ＝ 不擋人）。
 *   站長裁定：本站是練習站，可用性優先於版本一致性。
 *   ・錦標賽：把人擋在報到之外 ＝ 他打不了那場比賽。
 *   ・休閒對戰：把人擋在房間之外 ＝ 他今天就是玩不到。
 *   兩者的代價都遠高於「放一個舊 client 進來」。
 *
 * ⚠ 版本大小的比較本身在 `version-compare.ts`（v6.160 就有，十進位小數語義）。
 *   這支**不重寫**那個比較，只組合它與「什麼時候該放行」的那幾條例外。
 */
import { isClientTooOld, recentlyHardRefreshed } from './version-compare';

/** 提示視窗要不要跳出來的輸入。全部是純資料，沒有任何 DOM／網路相依。 */
export interface VersionGateInput {
  /** 目前這份 bundle 的版本（`$lib/version` 的 VERSION）。 */
  cur: unknown;
  /** 伺服器給的門檻。空字串／解析不出來 ⇒ 不擋（fail-open）。 */
  min: unknown;
  /** `window.location.href`。用來判斷「是不是剛按過強制更新進來的」。 */
  href: unknown;
  /** 現在時間（測試可注入）。 */
  now: number;
  /**
   * 這個入口是不是**已經提示過一次**了。
   * ⭐ v6.167 的教訓：①~④ 全部建立在「提示視窗真的畫得出來」上，
   *   而 v6.160~v6.166 正是栽在視窗被放進錯的版面分支 ⇒ 玩家只看到「按了沒反應」，
   *   再按幾次都一樣 ＝ 被鎖在外面。這一條是唯一**不依賴 UI** 的 fail-open：
   *   最壞情況收斂成「白按一次」，第二次一定放行。
   */
  alreadyPrompted: boolean;
  /**
   * 這個入口有沒有「再不動作就來不及」的截止時間（毫秒）。
   * ・錦標賽報到：`checkInDeadline - now`。
   * ・休閒對戰：沒有截止時間 ⇒ 不傳（視為 Infinity）。
   */
  deadlineLeftMs?: number;
  /**
   * 截止時間小於這個值就直接放行。預設 30 秒
   * （v6.162 站長裁定，v6.160 原為 90 秒：「更新不需要那麼久，30 秒綽綽有餘」）。
   */
  deadlineFloorMs?: number;
}

/**
 * 判定結果。
 * ⚠ `reason` 不是裝飾 —— 呼叫端要拿它送診斷（錦標賽端原本就會送
 *   `checkin-stale-after-update` / `checkin-stale-deadline-near`），
 *   站長才看得到「更新沒生效」這種只有在真實玩家身上才會發生的情況。
 */
export type VersionGateReason =
  | 'not-old'             // 版本不比門檻舊（含門檻解析不出來）⇒ 本來就不必擋
  | 'already-prompted'    // 這個入口已經提示過一次 ⇒ 放行（v6.167 ⑤）
  | 'recently-refreshed'  // 剛更新過一輪版本仍舊 ⇒ 放行（v6.160 ②）
  | 'deadline-near'       // 截止時間快到了 ⇒ 放行（v6.160 ③）
  | 'error'               // 判斷本身出錯 ⇒ 放行
  | 'too-old';            // 真的該提示更新

export interface VersionGateVerdict {
  /** true ＝ 該跳提示視窗（而且**不要**執行原本的動作）。 */
  block: boolean;
  reason: VersionGateReason;
}

/** 預設的「截止時間門檻」。改這個數字時 admin.html 的兩處說明文字要一起改。 */
export const DEADLINE_FLOOR_MS_DEFAULT = 30000;

/**
 * 要不要跳「版本太舊」提示視窗。
 *
 * 判定順序刻意與 v6.160~v6.167 的既有實作**逐條對齊**，讓錦標賽那條路徑
 * 在這一版之後行為逐字不變（零回歸；`test-v6384` 有逐案對照）：
 *   ① 版本沒有比門檻舊 ⇒ 不擋
 *   ⑤ 這個入口已經提示過一次 ⇒ 不擋
 *   ② 剛更新過一輪、版本仍舊 ⇒ 不擋（並回 'recently-refreshed' 讓呼叫端送診斷）
 *   ③ 截止時間不足 ⇒ 不擋（並回 'deadline-near'）
 *   否則 ⇒ 擋（跳視窗）
 */
export function evaluateVersionGate(input: VersionGateInput): VersionGateVerdict {
  try {
    if (!isClientTooOld(input.cur, input.min)) return { block: false, reason: 'not-old' };
    if (input.alreadyPrompted) return { block: false, reason: 'already-prompted' };
    if (recentlyHardRefreshed(input.href, input.now)) return { block: false, reason: 'recently-refreshed' };
    // ⚠ 沒有截止時間的入口（休閒對戰）傳 undefined ⇒ Infinity ⇒ 這一條永遠不成立。
    //   不可以寫成 `input.deadlineLeftMs < floor`：undefined 參與比較會得到 false，
    //   看起來「剛好也對」，但 0 或 NaN 就會靜默走錯邊。明確給 Infinity 才是意圖。
    const left = (typeof input.deadlineLeftMs === 'number' && Number.isFinite(input.deadlineLeftMs))
      ? input.deadlineLeftMs
      : Infinity;
    const floor = (typeof input.deadlineFloorMs === 'number' && Number.isFinite(input.deadlineFloorMs))
      ? input.deadlineFloorMs
      : DEADLINE_FLOOR_MS_DEFAULT;
    if (left < floor) return { block: false, reason: 'deadline-near' };
    return { block: true, reason: 'too-old' };
  } catch {
    return { block: false, reason: 'error' };   // 判斷本身出任何錯 ⇒ 不擋
  }
}

/**
 * 從 `/api/client-min-version` 的回應取出門檻。
 *
 * ⚠⚠ 這支也是 fail-open 的一部分：回應形狀不對（舊版伺服器、代理回了 HTML、
 *   端點還沒部署 ⇒ 404 的 JSON、`enabled` 沒開）一律回空字串
 *   ⇒ `isClientTooOld` 解析不出來 ⇒ 不擋任何人。
 * ⚠ `enabled !== true` 也回空字串：灰度旗標沒開的時候，門檻數字存在也不該生效。
 */
export function readMinVersionPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as { enabled?: unknown; min?: unknown };
  if (p.enabled !== true) return '';
  return (typeof p.min === 'string') ? p.min : '';
}
