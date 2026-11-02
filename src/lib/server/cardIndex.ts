// 僅供伺服器／建置期使用（$lib/server 慣例：絕不會被打包進 client bundle）。
// 讀 static/cards 全部版本 JSON，建立 id→card 對照表（首次呼叫建一次，跨 prerender 全程快取）。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '$lib/cards/types';
// v6.194：下架卡不產生卡片頁、也不進 sitemap（唯一述詞）。
import { isHiddenFromPlayers, applyHiddenCountsToSets } from '$lib/cards/visibility';
import { isCardMarkStandardLegal } from '$lib/cards/regulation';

const DIR = join(process.cwd(), 'static', 'cards');
// v6.333 Rule 38：原本這裡有一份 local `STD_MARKS`（＝第三份 H/I/J 複本）。
// 唯一來源已收斂到 $lib/cards/regulation 的 isCardMarkStandardLegal（無標 fail-closed）。
let _map: Map<string, Card> | null = null;

export function getCardMap(): Map<string, Card> {
  if (_map) return _map;
  const m = new Map<string, Card>();
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    let arr: Card[];
    try { arr = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Card[]; } catch { continue; }
    for (const c of arr) if (c && c.id != null) m.set(String(c.id), c);
  }
  _map = m;
  return m;
}

// Phase 1 預渲染範圍：所有標準 H/I/J 卡 id（含寶可夢／訓練家／能量）。
export function getStdCardIds(): string[] {
  const ids: string[] = [];
  for (const [id, c] of getCardMap()) {
    if (isHiddenFromPlayers(id)) continue;   // v6.194：已對玩家下架
    // v6.333 Rule 38：改呼叫全站唯一述詞（無標 fail-closed），不再自己比對集合。
    if (isCardMarkStandardLegal(c.regulationMark)) ids.push(id);
  }
  return ids;
}

// ⭐ v6.617：單卡頁的「出自於卡包」要卡包名稱／封面／發售日 ⇒ 讀 static/cards/index.json（建置期一次）。
//   張數先扣掉下架卡（applyHiddenCountsToSets，與 /cards 同一支）⇒ 單卡頁寫的「N 張」＝點進去看到的張數（審查 P2-1：M-P-J 141 vs 139）。
import type { SetLite } from '$lib/cards/cover-url';
let _sets: Map<string, SetLite> | null = null;
export function getSetSummary(code: string): SetLite | null {
  if (!_sets) {
    _sets = new Map();
    try {
      for (const s of applyHiddenCountsToSets(JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as (SetLite & { cardCount: number })[])) {
        _sets.set(s.code, { code: s.code, name: s.name, releaseDate: s.releaseDate ?? null, cardCount: s.cardCount, coverImageUrl: s.coverImageUrl });
      }
    } catch { /* 讀不到就不顯示卡包卡片（單卡頁其餘內容照常） */ }
  }
  return _sets.get(code) ?? null;
}
