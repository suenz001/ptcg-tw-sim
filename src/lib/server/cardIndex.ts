// 僅供伺服器／建置期使用（$lib/server 慣例：絕不會被打包進 client bundle）。
// 讀 static/cards 全部版本 JSON，建立 id→card 對照表（首次呼叫建一次，跨 prerender 全程快取）。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from '$lib/cards/types';
// v6.194：下架卡不產生卡片頁、也不進 sitemap（唯一述詞）。
import { isHiddenFromPlayers } from '$lib/cards/visibility';
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
