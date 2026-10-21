import type { GameState } from '../game/types';
import { actionResponsibility, actionTurnKey } from '../game/action-responsibility';
import type { Seat } from '../game/modal-slots';

export const QUICK_TURN_MS = 30_000;
export interface PlayerClockPolicy {
  enabled: boolean;
  minutes: number;
  /** 每次 OFF → ON 換新 epoch；重新啟用不追溯關閉期間。 */
  epoch: number;
  changedAt: number;
}
export const DEFAULT_PLAYER_CLOCK_POLICY: Readonly<PlayerClockPolicy> = Object.freeze({
  enabled: false, minutes: 15, epoch: 0, changedAt: 0,
});
export interface PlayerClockState {
  epoch: number;
  changedAt: number;
  minutes: number;
  gameStart: number;
  at: number;
  turnKey: string;
  actors: Seat[];
  spent: [number, number];
  quickLeft: [number, number];
  /** 額度耗完後、本半回合的 30 秒已建立。 */
  quick: [boolean, boolean];
  /** AI 無法合法推進時不忙迴圈；保留真人操作以恢復。 */
  stalled: [boolean, boolean];
}
export function parsePlayerClockPolicy(value: unknown): PlayerClockPolicy {
  const v = value as Partial<PlayerClockPolicy> | null;
  if (!v || typeof v.minutes !== 'number' || !Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > 120
    || !Number.isFinite(v.epoch) || !Number.isFinite(v.changedAt)) return { ...DEFAULT_PLAYER_CLOCK_POLICY };
  return { enabled: v.enabled === true, minutes: v.minutes, epoch: v.epoch!, changedAt: v.changedAt! };
}
function charge(c: PlayerClockState, until: number): void {
  const delta = Math.max(0, until - c.at);
  const limit = c.minutes * 60_000;
  for (const seat of c.actors) {
    const before = c.spent[seat];
    c.spent[seat] += delta;
    if (c.quick[seat]) c.quickLeft[seat] = Math.max(0, c.quickLeft[seat] - delta);
    else if (c.spent[seat] >= limit) {
      c.quick[seat] = true;
      c.quickLeft[seat] = Math.max(0, QUICK_TURN_MS - Math.max(0, delta - Math.max(0, limit - before)));
    }
  }
  c.at = Math.max(c.at, until);
}
export function projectPlayerClock(previous: PlayerClockState, now: number): PlayerClockState {
  const c: PlayerClockState = { ...previous, actors: [...previous.actors], spent: [...previous.spent],
    quickLeft: [...previous.quickLeft], quick: [...previous.quick], stalled: [...previous.stalled] };
  charge(c, now);
  return c;
}
/** 純函式：以舊責任集合結算到 now，然後安裝新盤面的責任集合。 */
export function advancePlayerClock(
  previous: PlayerClockState | null | undefined, g: GameState, policy: PlayerClockPolicy, now: number,
): PlayerClockState | null {
  if (!policy.enabled || g.phase !== 'playing') return null;
  const gameStart = g.gameStartTime ?? 0;
  const key = actionTurnKey(g);
  const fresh = !previous || previous.epoch !== policy.epoch || previous.gameStart !== gameStart;
  const c: PlayerClockState = fresh ? {
    epoch: policy.epoch, changedAt: policy.changedAt, minutes: policy.minutes,
    gameStart, at: now, turnKey: key, actors: [], spent: [0, 0],
    quickLeft: [QUICK_TURN_MS, QUICK_TURN_MS], quick: [false, false], stalled: [false, false],
  } : {
    ...previous, actors: [...previous.actors], spent: [...previous.spent],
    quickLeft: [...previous.quickLeft], quick: [...previous.quick], stalled: [...previous.stalled],
  };
  if (!fresh && c.changedAt !== policy.changedAt) {
    charge(c, Math.min(now, Math.max(c.at, policy.changedAt)));
    c.minutes = policy.minutes;
    c.changedAt = policy.changedAt;
    for (const seat of [0, 1] as const) {
      c.quick[seat] = c.spent[seat] >= policy.minutes * 60_000;
      c.quickLeft[seat] = QUICK_TURN_MS;
      c.stalled[seat] = false;
    }
  }
  charge(c, now);
  if (c.turnKey !== key) {
    c.turnKey = key;
    c.quickLeft = [QUICK_TURN_MS, QUICK_TURN_MS];
    c.quick = [c.spent[0] >= c.minutes * 60_000, c.spent[1] >= c.minutes * 60_000];
    c.stalled = [false, false];
  }
  c.actors = actionResponsibility(g);
  return c;
}

export function playerClockDue(c: PlayerClockState | null, seat: Seat): boolean {
  return !!c && c.actors.includes(seat) && c.quick[seat] && c.quickLeft[seat] <= 0 && !c.stalled[seat];
}

/** 下次額度耗完或快速回合到期。null 表示目前沒有人需要操作。 */
export function playerClockDeadline(c: PlayerClockState | null): number | null {
  if (!c) return null;
  let wait = Infinity;
  for (const seat of c.actors) {
    if (c.stalled[seat]) continue;
    wait = Math.min(wait, c.quick[seat] ? c.quickLeft[seat] : Math.max(0, c.minutes * 60_000 - c.spent[seat]));
  }
  return Number.isFinite(wait) ? c.at + wait : null;
}
