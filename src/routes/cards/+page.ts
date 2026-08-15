import { base } from '$app/paths';
import type { Card, SetSummary } from '$lib/cards/types';
// v4.956：fetch URL 帶版本參數，繞過 Cloudflare 邊緣 cache
import { VERSION } from '$lib/version';
// v6.194：已對玩家下架的卡不得出現在卡牌資料庫（唯一述詞，見 $lib/cards/visibility）。
import { filterPlayerSelectable, applyHiddenCountsToSets } from '$lib/cards/visibility';

/**
 * Loads either:
 *  - the set index (list of all sets) when no `?set=` query is present
 *  - a single set's cards when `?set=SV10` is present
 *  - **ALL** combined cards across every H/I/J set when `?set=ALL` is present
 *    (virtual set — v2.29)
 *
 * Card JSONs live under static/cards/*.json, fetched at runtime.
 */
export async function load({ fetch, url }: { fetch: typeof globalThis.fetch; url: URL }) {
  const setCode = url.searchParams.get('set');

  if (!setCode) {
    const res = await fetch(`${base}/cards/index.json?v=${VERSION}`);
    if (!res.ok) throw new Error(`Failed to load sets index: HTTP ${res.status}`);
    // v6.194：卡包磚的張數要扣掉下架卡，否則「92 張」點進去只有 90 張。
    const sets: SetSummary[] = applyHiddenCountsToSets(await res.json());
    return { mode: 'index' as const, sets };
  }

  // ── Virtual "ALL" set — combine every set's cards for one big browser ──
  // This is heavy (~4k+ cards), but card images are always lazy-loaded and
  // the filter/search is O(n) which is still fine at that size.
  if (setCode === 'ALL') {
    const indexRes = await fetch(`${base}/cards/index.json?v=${VERSION}`);
    if (!indexRes.ok) throw new Error(`Failed to load sets index: HTTP ${indexRes.status}`);
    const sets: SetSummary[] = applyHiddenCountsToSets(await indexRes.json());

    // Fetch every set's cards in parallel. Individual set failures are
    // tolerated — one broken file shouldn't bomb the whole ALL view.
    // v4.77/v4.9：ALL = 標準環境合併（H/I/J）；M5（深淵之瞳）已於 v4.9 改 regulationMark 為 J，自然納入此 filter
    const standardSets = sets.filter((s) => s.regulationMark === 'H' || s.regulationMark === 'I' || s.regulationMark === 'J');
    const results = await Promise.all(
      standardSets.map(async (s) => {
        try {
          const r = await fetch(`${base}/cards/${s.code}.json?v=${VERSION}`);
          if (!r.ok) return [] as Card[];
          return (await r.json()) as Card[];
        } catch {
          return [] as Card[];
        }
      })
    );
    // v6.194：下架卡不列入（資料仍在、對戰／回放照常，只是玩家瀏覽不到）。
    const cards: Card[] = filterPlayerSelectable(results.flat());

    return {
      mode: 'set' as const,
      setCode: 'ALL',
      setName: '全部 H / I / J 卡牌',
      cards,
      sets,  // v2.184：給 modal foot 顯示「出自於卡包【XXX】」用
    };
  }

  // Validate setCode looks legitimate (avoid letting arbitrary strings hit static).
  // Allow dash — M-P (promo 特典卡) uses it.
  if (!/^[A-Za-z0-9-]+$/.test(setCode)) {
    throw new Error(`Invalid set code: ${setCode}`);
  }

  // Fetch the cards AND the index in parallel — we need the Chinese set name
  // (e.g. "超級交響樂" for M1S) for the header display.
  const [cardsRes, indexRes] = await Promise.all([
    fetch(`${base}/cards/${setCode}.json?v=${VERSION}`),
    fetch(`${base}/cards/index.json?v=${VERSION}`)
  ]);
  if (!cardsRes.ok) throw new Error(`Set ${setCode} not found (HTTP ${cardsRes.status})`);
  // v6.194：單一卡包檢視同樣濾掉下架卡（與 ALL 檢視共用同一份述詞）。
  const cards: Card[] = filterPlayerSelectable((await cardsRes.json()) as Card[]);

  let setName: string | undefined;
  let sets: SetSummary[] = [];
  if (indexRes.ok) {
    sets = applyHiddenCountsToSets(await indexRes.json());
    setName = sets.find((s) => s.code === setCode)?.name;
  }
  // v2.184：sets 也回傳，給 modal foot 顯示「出自於卡包【XXX】」用
  return { mode: 'set' as const, setCode, setName, cards, sets };
}
