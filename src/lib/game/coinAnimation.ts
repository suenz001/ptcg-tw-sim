export type CoinFlipAnimationEvent = { result: 'heads' | 'tails'; label: string };

/**
 * Parse battle-log messages into coin-flip animation events.
 *
 * Important: summary lines such as
 *   「機關槍合擊：3 次正面 → 基礎 200 + 3×50 = 350 傷害」
 * are NOT coin flips and must not enqueue an extra heads animation after the
 * final tails flip. Only explicit flip logs with 「— 正面」/「— 反面」 format
 * (the em-dash, NOT the arrow →) should animate.
 */
export function parseCoinFlipAnimationEvents(msg: string): CoinFlipAnimationEvent[] {
  // 匹配「— 正面」或「— 反面（停止）」等明確的單次擲幣結果。
  // 關鍵：summary 行用 "→"（箭頭），不用 "—"（破折號），所以此 regex 不會誤觸。
  const single = msg.match(/—\s*(正面|反面)/u);
  if (single) {
    return [{ result: single[1] === '正面' ? 'heads' : 'tails', label: `擲硬幣：${single[1]}` }];
  }

  return [];
}
