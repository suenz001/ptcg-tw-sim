// v5.310: 常用卡牌 (favorites) — 本地 localStorage 持久化
// 跟 deck storage 同 pattern (loadDecks / saveDecks). 雲端同步走 favoritesCloud.ts.

const KEY = 'ptcg-tw-sim:favorites';

function browserOnly<T>(fallback: T, fn: () => T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try { return fn(); } catch { return fallback; }
}

/** 讀取本地常用卡牌 cardId 集合 (純讀, 不變更 storage). */
export function loadFavorites(): Set<string> {
  return browserOnly<Set<string>>(new Set(), () => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  });
}

/** 寫入本地. caller 應自己先 mutate set, 再呼叫此函式. */
export function saveFavorites(set: Set<string>): void {
  browserOnly<void>(undefined, () => {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  });
}
