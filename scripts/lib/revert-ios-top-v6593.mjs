// v6.593：只還原已審查的手機頂部避讓；每個錨點必須唯一，額外差異保留。
import assert from 'node:assert/strict';
import { normEol } from './eol-agnostic.mjs';
export const IOS_TOP_V6593_PAIRS = [
  [
    "<script lang=\"ts\">\n  // >>> v6593-ios-top-clearance\n  // 主畫面版的系統模糊可能超出安全區；僅 iPhone/iPod 留額外空間。\n  // 玩家 iOS 版本未知，不依版本猜測；這是版面避讓，不是關閉系統特效。\n  const isIPhoneStandalone = typeof navigator !== 'undefined'\n    && /iPhone|iPod/.test(navigator.userAgent)\n    && (navigator as Navigator & { standalone?: boolean }).standalone === true;\n  // <<< v6593-ios-top-clearance\n  import type { GameState, CardInstance, PendingSelection } from '$lib/game/types';\n",
    "<script lang=\"ts\">\n  import type { GameState, CardInstance, PendingSelection } from '$lib/game/types';\n"
  ],
  [
    "\n<div class=\"mp\" class:mp-ios-standalone={isIPhoneStandalone} use:preventScroll>\n\n",
    "\n<div class=\"mp\" use:preventScroll>\n\n"
  ],
  [
    "    /* v6.590：只在可用高度不足時壓縮彈性區；一般直式維持原尺寸。655px 包含計時列。 */\n    --mp-top-clearance: 0px;\n    --mp-shortfall: clamp(0px, calc(655px - (100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - var(--mp-top-clearance))), 360px);\n    --mp-hand-size: max(48px, calc(96px - var(--mp-shortfall) * 0.16));\n",
    "    /* v6.590：只在可用高度不足時壓縮彈性區；一般直式維持原尺寸。655px 包含計時列。 */\n    --mp-shortfall: clamp(0px, calc(655px - (100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px))), 360px);\n    --mp-hand-size: max(48px, calc(96px - var(--mp-shortfall) * 0.16));\n"
  ],
  [
    "       數值與行為與 env(safe-area-inset-*) 完全相同，只是不再各自寫一份。 */\n    padding-top: calc(var(--safe-top, 0px) + var(--mp-top-clearance));\n    padding-bottom: var(--safe-bottom, 0px);\n",
    "       數值與行為與 env(safe-area-inset-*) 完全相同，只是不再各自寫一份。 */\n    padding-top: var(--safe-top, 0px);\n    padding-bottom: var(--safe-bottom, 0px);\n"
  ],
  [
    "    padding-right: var(--safe-right, 0px);\n  }\n  /* v6.593：額外避讓系統模糊帶；安全區為零時不增加空白。\n     20px 為相似實機案例的避讓量，仍需受影響 iPhone 確認效果。 */\n  .mp.mp-ios-standalone {\n    --mp-top-clearance: min(20px, max(0px, var(--safe-top, 0px)));\n  }\n",
    "    padding-right: var(--safe-right, 0px);\n  }\n"
  ]
];
export function revertIosTopV6593(source) {
  let s = normEol(source);
  for (const [current, previous] of IOS_TOP_V6593_PAIRS) {
    assert.equal(s.split(current).length - 1, 1, 'v6593手機還原錨點必須唯一');
    s = s.replace(current, previous);
  }
  return s;
}
