// ⭐v6.596 對戰版面的「預設值」（玩家從沒選過版面時用哪一個）——唯一一份判準（IRON_RULES Rule 38）。
//
//   ・寬 ≥ 1024 ⇒ 新版桌墊（blue）—— v6.446 站長裁定，維持不變。
//   ・寬 < 1024 但「直立或接近正方形」（高 ≥ 寬 × 0.9）、而且不是手機（短邊 > 600）⇒ 也用新版桌墊。
//     ⚠（審查 P1-1）但「寬 ≤ 950 的橫向」除外：那個範圍有一組替經典版手機橫放寫的舊規則
//       （@media (max-width:950px) and (orientation:landscape)：整頁鎖一個畫面、行動列最高 12vh），
//       新版桌墊套到它會把行動鈕切掉、按不到（880×800 實測）⇒ 這類尺寸維持經典版。
//     站長 2026-10-24 裁定（玩家回報 Samsung Galaxy Z Fold 8 展開後經典版只用到上半個畫面）：
//     經典版是照 1366 寬的橫向排列設計的，窄螢幕只能整體縮小到約 55%，直立時下半部整片空白；
//     新版桌墊在 <1024 會改成直排、填滿整個畫面（v6.466 已在直向 iPad 驗過）。
//   ・其他（窄的橫向視窗，例如 1000×700）⇒ 經典版（維持原本預設）。
//   ⚠ 只決定「預設」：玩家選過的版面（localStorage 'ptcg_battle_layout'）一律照玩家的選擇；預設值不寫回 localStorage。
//   ⚠（審查 P2-2）從沒選過版面的玩家，視窗尺寸改變（Fold 從封面螢幕展開、旋轉）時對戰頁會重算一次預設。
//   ⚠ 手機尺寸走手機版（MobilePortraitBattle），不讀 battleLayout，這裡回什麼都不影響它。
//     ⭐v6.612 起「手機尺寸」由 battle-view-mode.ts 判斷：寬 ≤ 600，或高 ≤ 600 且（觸控或寬 < 1024）；寬 ≥ 1024 的滑鼠矮視窗走電腦版（這裡回 blue）。

export type DefaultBattleLayout = 'blue' | 'classic';

export function defaultBattleLayout(w: number, h: number): DefaultBattleLayout {
  if (!(w > 0) || !(h > 0)) return 'classic';
  if (w >= 1024) return 'blue';
  if (w > h && w <= 950) return 'classic';
  if (Math.min(w, h) > 600 && h >= w * 0.9) return 'blue';
  return 'classic';
}
