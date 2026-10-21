import { advancePlayerClock, DEFAULT_PLAYER_CLOCK_POLICY, parsePlayerClockPolicy, playerClockDue, projectPlayerClock,
  type PlayerClockPolicy, type PlayerClockState } from './player-clock';
import { timeoutAction } from '../game/timeout-action';
import { applyAction } from '../game/engine';
import type { GameState } from '../game/types';
import type { Card } from '$lib/cards/types';
import type { Seat } from '../game/modal-slots';

export interface ClockRoom {
  _id: string;
  matchId?: string;
  eventId?: string;
  version: number;
  gameState: GameState;
  playerClock?: PlayerClockState | null;
  timeLimitTurn?: number | null;
}
interface ClockDependencies {
  now(): number;
  pool: Map<string, Card>;
  loadPolicy(): Promise<unknown>;
  savePolicy(policy: PlayerClockPolicy): Promise<void>;
  activeRooms(): Promise<string[]>;
  loadRoom(id: string): Promise<ClockRoom | null>;
  /** version CAS；呼叫者同時維護既有 actorSeat、replay、快照與終局管線。 */
  commit(room: ClockRoom, next: GameState, clock: PlayerClockState | null, automatic: boolean): Promise<boolean>;
  warn(message: string): void;
  notifyPolicyChange?(ids: string[]): void;
}

/**
 * 伺服器時計協調器。tick 只在記憶體投影秒數；只有初始化、政策變動、
 * 真人／自動動作、無進展標記才寫房間。預設 OFF 不讀盤面或執行 AI。
 */
export function createPlayerClockRuntime(deps: ClockDependencies) {
  let policy: PlayerClockPolicy = { ...DEFAULT_PLAYER_CLOCK_POLICY };
  let loaded = false;
  let refreshing: Promise<void> | null = null;
  let configuring = false;
  let policyGeneration = 0;
  const tracked = new Map<string, PlayerClockState>();
  const jobs = new Map<string, Promise<void>>();
  const bump = () => Math.max(deps.now(), policy.changedAt + 1);

  async function refresh(): Promise<void> {
    if (configuring) return;
    if (refreshing) return refreshing;
    const generation = policyGeneration;
    refreshing = (async () => {
      try {
        const fresh = parsePlayerClockPolicy(await deps.loadPolicy());
        if (generation !== policyGeneration || configuring) return;
        policy = fresh;
        loaded = true;
        if (!policy.enabled) { tracked.clear(); return; }
        const ids = await deps.activeRooms();
        const active = new Set(ids);
        for (const id of tracked.keys()) if (!active.has(id)) tracked.delete(id);
        for (const id of ids) {
          if (configuring) break;
          const c = tracked.get(id);
          if (c?.epoch === policy.epoch && c.changedAt === policy.changedAt) continue;
          await reconcile(id);
        }
      } catch {
        if (generation !== policyGeneration || configuring) return;
        // 設定或資料庫不可讀，不用舊快取繼續強制操作。
        loaded = false;
        tracked.clear();
        deps.warn('個人時計暫停：無法讀取設定或對局');
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  function currentPolicy(): PlayerClockPolicy {
    return loaded ? { ...policy } : { ...policy, enabled: false };
  }
  function calculate(room: ClockRoom, next = room.gameState): PlayerClockState | null {
    if (configuring || !loaded) {
      // 暫停強制處理時真人仍可動作；必須結算舊責任並移交新責任，不能保留舊 actors。
      const old = room.playerClock;
      return old ? advancePlayerClock(old, next, {
        enabled: true, minutes: old.minutes, epoch: old.epoch, changedAt: old.changedAt,
      }, deps.now()) : null;
    }
    if (!policy.enabled || !room.matchId) return null;
    return advancePlayerClock(room.playerClock, next, policy, deps.now());
  }
  function remember(room: ClockRoom, clock: PlayerClockState | null): void {
    if (clock && loaded && policy.enabled && clock.epoch === policy.epoch) tracked.set(room._id, clock);
    else tracked.delete(room._id);
  }
  function publicClock(clock: PlayerClockState | null | undefined): PlayerClockState | null {
    if (!loaded || !policy.enabled || !clock || clock.epoch !== policy.epoch || clock.changedAt !== policy.changedAt) return null;
    return projectPlayerClock(clock, deps.now());
  }
  async function reconcile(id: string): Promise<void> {
    const room = await deps.loadRoom(id);
    if (!room?.matchId || room.gameState?.phase !== 'playing') { tracked.delete(id); return; }
    const c = calculate(room);
    if (!c) return;
    if (!room.playerClock || room.playerClock.epoch !== c.epoch || room.playerClock.changedAt !== c.changedAt
      || room.playerClock.gameStart !== c.gameStart) {
      if (await deps.commit(room, room.gameState, c, false)) remember(room, c);
    } else remember(room, c);
  }
  function blocked(room: ClockRoom, seat: Seat): boolean {
    if (!loaded || configuring || !policy.enabled) return false;
    return playerClockDue(calculate(room), seat);
  }
  async function work(id: string): Promise<void> {
    if (jobs.has(id)) return jobs.get(id);
    const job = (async () => {
      // 一次最多八步，之後由下一 tick 接續，不能在事件迴圈無限試選。
      for (let n = 0; n < 8; n++) {
        if (!loaded || !policy.enabled || configuring) break;
        const room = await deps.loadRoom(id);
        if (!room?.matchId || room.gameState?.phase !== 'playing') { tracked.delete(id); break; }
        // 與真人 action 同一道最後回合界線，不能替下一回合出牌翻盤。
        if (typeof room.timeLimitTurn === 'number' && room.gameState.turn > room.timeLimitTurn) {
          tracked.delete(id); break;
        }
        const revision = policy.changedAt;
        const c = calculate(room);
        const seat = ([0, 1] as const).find(s => playerClockDue(c, s));
        if (!c || seat === undefined) { remember(room, c); break; }
        let next: GameState | null = null;
        try {
          const action = timeoutAction(room.gameState, deps.pool, seat);
          if (action) {
            const source = action.type === 'RESOLVE_SELECTION'
              ? { ...room.gameState, _rejectedResolveStreak: 0, _rejectedResolveTok: room.gameState.pendingSelection?.token }
              : room.gameState;
            const result = applyAction(source, action, deps.pool);
            // 不消耗引擎「連續拒絕三次就放行」保護，避免 AI 藉空選擇跳過卡牌效果。
            const rejected = action.type === 'RESOLVE_SELECTION' && (result._rejectedResolveStreak ?? 0) > 0;
            const sameSelection = action.type === 'RESOLVE_SELECTION' && !!result.pendingSelection
              && result.pendingSelection.token === source.pendingSelection?.token
              && result.pendingSelection.effectKey === source.pendingSelection?.effectKey;
            if (result !== source && !rejected && !sameSelection) next = result;
          }
        } catch { /* 以下改標記，保留盤面讓真人恢復 */ }
        if (!loaded || configuring || !policy.enabled || revision !== policy.changedAt) break;
        if (!next) {
          c.stalled[seat] = true;
          if (await deps.commit(room, room.gameState, c, false)) {
            remember(room, c);
            deps.warn('個人時計接管無法推進，已保留真人操作');
          }
          break;
        }
        const post = advancePlayerClock(c, next, policy, deps.now());
        if (!await deps.commit(room, next, post, true)) continue;
        remember(room, post);
      }
    })().finally(() => { jobs.delete(id); });
    jobs.set(id, job);
    return job;
  }
  async function tick(): Promise<void> {
    if (!loaded || configuring || !policy.enabled) return;
    // 不逐秒查 DB，只對記憶體裡確實逾時的房間取盤面；限制每 tick 啟動的工作量。
    let launched = 0;
    for (const [id, stored] of tracked) {
      const c = projectPlayerClock(stored, deps.now());
      if (![0, 1].some(s => playerClockDue(c, s as Seat)) || jobs.has(id)) continue;
      if (++launched > 4) break;
      void work(id).catch(() => { tracked.delete(id); deps.warn('個人時計接管讀寫失敗，等待重新同步'); });
    }
  }
  async function configure(enabled: boolean, minutes: number): Promise<PlayerClockPolicy> {
    if (configuring) throw new Error('設定更新中，請稍後再試');
    if (typeof enabled !== 'boolean' || !Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error('請輸入 1～120 分鐘');
    configuring = true;
    policyGeneration++;
    try {
      // 關閉回覆成功之前，等已開始的接管寫入完成；不允許舊工作在回覆後再補動作。
      await Promise.allSettled([...jobs.values()]);
      if (refreshing) await refreshing;
      // 第一次管理操作也讀持久化設定，避免尚未初始化時把既有 epoch 當成 OFF。
      policy = parsePlayerClockPolicy(await deps.loadPolicy()); loaded = true;
      const at = bump();
      const next = { enabled, minutes, epoch: enabled && !policy.enabled ? at : policy.epoch, changedAt: at };
      await deps.savePolicy(next);
      policy = next; loaded = true; tracked.clear();
      if (deps.notifyPolicyChange) {
        try { deps.notifyPolicyChange(await deps.activeRooms()); }
        catch { deps.warn('個人時計設定已保存，通知延遲；客戶端下次同步會更新'); }
      }
      return { ...next };
    } finally { configuring = false; }
  }
  return { refresh, tick, configure, currentPolicy, calculate, remember, publicClock, blocked, work, ready: () => loaded };
}
