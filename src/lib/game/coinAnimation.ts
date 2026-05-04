export type CoinFlipAnimationEvent = { result: 'heads' | 'tails'; label: string };

/**
 * Parse battle-log messages into coin-flip animation events.
 *
 * Important: summary lines such as
 *   「機關槍合擊：3 次正面 → 基礎 200 + 3×50 = 350 傷害」
 * are NOT coin flips and must not enqueue an extra heads animation after the
 * final tails flip. Only explicit flip logs or legacy messages that actually
 * mention 「擲硬幣」 should animate.
 */
export function parseCoinFlipAnimationEvents(msg: string): CoinFlipAnimationEvent[] {
  const single = msg.match(/—\s*(正面|反面)/);
  if (single) {
    return [{ result: single[1] === '正面' ? 'heads' : 'tails', label: `擲硬幣：${single[1]}` }];
  }

  if (!msg.includes('硬幣')) return [];

  if (msg.includes('正面')) {
    return [{ result: 'heads', label: '擲硬幣：正面' }];
  }
  if (msg.includes('反面')) {
    return [{ result: 'tails', label: '擲硬幣：反面' }];
  }
  return [];
}
