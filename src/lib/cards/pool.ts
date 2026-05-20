// Card pool loader — used by the deck editor to look up cards by id,
// search by name, and enumerate cards per set.
//
// We fetch each set's JSON lazily the first time it's needed and keep the
// results in module-level memory. The deck editor often needs the *whole*
// Standard pool (to validate / resolve card ids), so `loadAllSets()` fans
// out the per-set loads in parallel.

import { base } from '$app/paths';
import type { Card, SetSummary } from './types';
// v4.956：fetch URL 帶版本參數，繞過 Cloudflare 邊緣 cache（每次版本 bump 觸發 cache miss）
import { VERSION } from '$lib/version';

const setCache = new Map<string, Card[]>();
let indexCache: SetSummary[] | null = null;
const inflight = new Map<string, Promise<Card[]>>();

export async function loadIndex(
  fetchFn: typeof fetch = fetch
): Promise<SetSummary[]> {
  if (indexCache) return indexCache;
  const res = await fetchFn(`${base}/cards/index.json?v=${VERSION}`);
  if (!res.ok) throw new Error(`Failed to load index.json: HTTP ${res.status}`);
  indexCache = (await res.json()) as SetSummary[];
  return indexCache;
}

export async function loadSet(
  setCode: string,
  fetchFn: typeof fetch = fetch
): Promise<Card[]> {
  const cached = setCache.get(setCode);
  if (cached) return cached;
  const pending = inflight.get(setCode);
  if (pending) return pending;

  const p = (async () => {
    const res = await fetchFn(`${base}/cards/${setCode}.json?v=${VERSION}`);
    if (!res.ok) throw new Error(`Set ${setCode} not found (HTTP ${res.status})`);
    const raw = (await res.json()) as Card[];
    // v2.22：統一訓練家寶可夢命名 — 部分 set（SV9a/MC/SVOM/SVOD）原始卡名帶有
    // <>冠名括號（例：<竹蘭的>烈咬陸鯊ex、<瑪俐的>搗蛋小妖），M2a 復刻版則不帶。
    // 為了統一 effects.ts 裡的效果登錄 key（regA / regPre / regPost 都用純名），
    // 在載入時 strip 掉 `<` 與 `>`。UI 顯示也隨之一致（皆為「竹蘭的XXX」/「瑪俐的XXX」）。
    // v2.71：migrate-trainer-branded.mjs 已把 JSON 層級的 `<>` 全部 strip，parse-card.js
    // 也改在存檔前 strip，所以這個 runtime strip 變成 defensive no-op — 留著以防
    // 有人手動塞回帶 `<>` 的 JSON 或重爬未 migrate 的老 set。
    // v2.172：同時 strip U+200C (ZWNJ, zero-width non-joiner) — SV-P-I 的「寶可夢中心的姐姐」
    // 卡名前帶 ZWNJ 字元，導致 effects.ts 的 reg('寶可夢中心的姐姐') 無法 match。
    // 統一 normalize：移除 <>＜＞ 與 ZWNJ。
    const cards = raw.map(c => {
      if (!c.name) return c;
      const cleaned = c.name.replace(/[<>＜＞‌]/g, '');
      return cleaned !== c.name ? { ...c, name: cleaned } : c;
    });
    setCache.set(setCode, cards);
    inflight.delete(setCode);
    return cards;
  })();
  inflight.set(setCode, p);
  return p;
}

/** Load every set listed in index.json in parallel. */
export async function loadAllSets(
  fetchFn: typeof fetch = fetch
): Promise<Card[]> {
  const index = await loadIndex(fetchFn);
  const batches = await Promise.all(
    index.map((s) => loadSet(s.code, fetchFn))
  );
  return batches.flat();
}

/** Build a Map<cardId, Card> for quick lookup during validation. */
export function buildCardIndex(cards: Card[]): Map<string, Card> {
  const m = new Map<string, Card>();
  for (const c of cards) m.set(c.id, c);
  return m;
}
