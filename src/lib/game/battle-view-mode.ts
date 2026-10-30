/**
 * ⭐v6.612 對戰頁要用「手機版」還是「電腦版」的唯一判準（站長 2026-10-30：筆電顯示成手機版、沒辦法顯示 Windows 網頁版）。
 *
 * 真因：舊規則「瀏覽器可用畫面的寬或高只要有一邊 ≤ 600 就是手機」（v5.194，為了手機橫放也走手機版）。
 *   筆電本來就扁，再扣掉工作列、分頁列、網址列，可用高度常常不到 600
 *   （1366×768 開 125% 縮放 ≈ 1093×520；1920×1080 開 150% 縮放 ≈ 1280×590）⇒ 被當成「手機橫放」。
 *
 * 新規則（站長同意「改判斷＋加手動開關」）：
 *   ・寬度 ≤ 600 ⇒ 一定是手機版（電腦版版面在這種寬度放不下；手動開關也不能改）。
 *   ・玩家手動選「手機版」／「電腦版」⇒ 照玩家選的。
 *   ・自動：高度 ≤ 600 時，還要「主要是用手指觸控」（pointer: coarse）或「寬度不到 1024」才算手機 ⇒ 手機橫放仍是手機版，
 *     用滑鼠／觸控板、寬度 ≥ 1024 的筆電走電腦版（電腦版本身有依視窗自動縮放）；平板直立的 v6.313 開關照舊。
 *     （審查 P2：寬 601～1023 又矮的滑鼠視窗——例如半邊視窗 640×590、900×500——電腦版的「≤ 950 橫向」舊樣式會把手牌推出畫面又捲不到
 *       ⇒ 維持 v6.611 以前的手機版；站長的兩台筆電 1093×520、1280×590 都 ≥ 1024，照樣走電腦版。）
 */
export type BattleViewMode = 'auto' | 'desktop' | 'mobile';
export const BATTLE_VIEW_MODE_KEY = 'ptcg_battle_view_mode';
/** 手機門檻（與 /friends 私訊面板、v5.194 起的 600 相同） */
export const MOBILE_EDGE = 600;

export function normalizeBattleViewMode(x: unknown): BattleViewMode {
  return x === 'desktop' || x === 'mobile' ? x : 'auto';
}

/** 電腦版在矮視窗（高 ≤ 600）要放得下需要的最小寬度。 */
export const DESKTOP_SHORT_MIN_W = 1024;

/** 「該當成手機尺寸」：窄（寬 ≤ 600），或矮（高 ≤ 600）而且主要靠手指觸控、或寬度不到 1024。 */
export function isPhoneSized(w: number, h: number, coarse: boolean): boolean {
  return w <= MOBILE_EDGE || (h <= MOBILE_EDGE && (coarse || w < DESKTOP_SHORT_MIN_W));
}

/** 對戰頁要不要走手機版（MobilePortraitBattle）。force＝v6.313「平板直立時用手機版」開關。 */
export function decideMobileBattle(w: number, h: number, force: boolean, coarse: boolean, mode: BattleViewMode): boolean {
  if (w <= MOBILE_EDGE) return true;
  if (mode === 'mobile') return true;
  if (mode === 'desktop') return false;
  return isPhoneSized(w, h, coarse) || (force && h > w);
}

/** 目前主要的指標是不是手指（拿不到 matchMedia ⇒ 當成不是，走電腦版的寬鬆判定）。 */
export function coarsePointerNow(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { return false; }
}
