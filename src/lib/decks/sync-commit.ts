/** v6.658：只確認實際上傳的版本，保留等待網路期間的本機操作。 */
import type { Deck } from './types';
import { deckPayloadEqual, type LocalDeckOwnership } from './member-sync';
import { sortDecks } from './storage';

export const cloneDecks = (decks: Deck[]): Deck[] => JSON.parse(JSON.stringify(decks));
export const favoritesEqual = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));

export function reconcileDeckSync(input: {
  uid: string; before: Deck[]; current: Deck[]; planned: Deck[];
  currentOwnership: LocalDeckOwnership; cloudIds: string[];
  uploaded: Deck[]; deleted: string[]; failedUploads: string[]; failedDeletes: string[];
}): { decks: Deck[]; ownership: LocalDeckOwnership } {
  const { uid, before, current, planned, uploaded, deleted } = input;
  const previous = new Map(before.map((d) => [d.id, d]));
  const latest = new Map(current.map((d) => [d.id, d]));
  const result = new Map(planned.map((d) => [d.id, d]));
  const own = input.currentOwnership;
  const same = own.kind === 'member' && own.memberUid === uid;
  const pending = new Set(same ? own.pendingUpsertIds : []);
  const pendingDeletes = new Set(same ? own.pendingDeleteIds : []);
  const known = new Set(input.cloudIds);
  for (const d of uploaded) known.add(d.id);
  for (const id of deleted) known.delete(id);

  // 同 ID 的刪除／重建也按完成時內容判斷，不能用 dirty 集合有沒有該 ID 代替版本。
  for (const id of new Set([...previous.keys(), ...latest.keys()])) {
    const a = previous.get(id), b = latest.get(id);
    if (a && !b) {
      result.delete(id); pending.delete(id);
      if (known.has(id)) pendingDeletes.add(id);
    } else if (b && (!a || !deckPayloadEqual(a, b))) {
      result.set(id, b); pending.add(id); pendingDeletes.delete(id);
    }
  }
  for (const d of uploaded) {
    const now = result.get(d.id);
    if (now && deckPayloadEqual(now, d)) pending.delete(d.id);
    else if (now) pending.add(d.id);
    else if (known.has(d.id)) pendingDeletes.add(d.id);
  }
  for (const id of deleted) {
    if (!latest.has(id)) pendingDeletes.delete(id);
    else { pending.add(id); result.set(id, latest.get(id)!); }
  }
  for (const id of input.failedUploads) if (result.has(id)) pending.add(id);
  for (const id of input.failedDeletes) pendingDeletes.add(id);
  // 已由雲端新版取代、或內容等價的舊待傳標記也可確認；途中的新版本一定保留。
  for (const id of [...pending]) {
    const a = previous.get(id), b = latest.get(id), resolved = result.get(id);
    if (!resolved) pending.delete(id);
    else if (a && b && deckPayloadEqual(a, b) && !input.failedUploads.includes(id)
      && !deleted.includes(id) && !uploaded.some((d) => d.id === id)) pending.delete(id);
  }
  return {
    decks: sortDecks([...result.values()]),
    ownership: {
      kind: 'member', memberUid: uid, knownCloudIds: [...known],
      pendingUpsertIds: [...pending], pendingDeleteIds: [...pendingDeletes], anonIds: [],
      pendingFavorites: !!own.pendingFavorites,
    },
  };
}

/** 同頁共用序列，避免存檔／登入同步／排序／刪除互相超車；不新增輪詢。 */
export function createCloudTaskQueue(getUid: () => string | null = () => null): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const guarded = async (): Promise<T> => {
      const uid = getUid();
      // 跨分頁協調雲端寫入，使用瀏覽器鎖，不新增網路／定時器；不支援時保留同頁序列。
      return uid && typeof navigator !== 'undefined' && navigator.locks
        ? await navigator.locks.request<Promise<T>>('ptcg-decks:' + uid, task) : await task();
    };
    const run = tail.then(guarded, guarded);
    tail = run.catch(() => undefined);
    return run;
  };
}
