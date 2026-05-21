// v4.987: 進化鏈搜尋 helper
// 輸入寶可夢名字 query，從 pool 內找該寶可夢進化鏈所有卡的 name set。
// 演算法：
//   1. seeds = pool 內 name.includes(query) 的卡（lower case 比對）
//   2. 對每張 seed，往上爬 evolvesFrom 鏈到 root（無 evolvesFrom 即 root）
//   3. 從 root 開始 BFS — pool 內 evolvesFrom in 已知 names 集合的卡，加入 names
//   4. 回傳 names Set
//
// 注意：
//   - query 為 lowercase 比對；name 各語言版本（繁中）直接相等比較
//   - pool 多 set 內可能有同名卡（複數印刷 / ex 版本），都會被 collect
//   - caller 自行決定 pool 範圍：decks 編輯器是全 standard pool；
//     cards 頁是 set-scoped（玩家想跨 set 可切「全部卡包」）

import type { Card } from './types';

export function getEvolutionChainNames(query: string, pool: Card[]): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q || pool.length === 0) return new Set<string>();

  // Step 1: seeds — 名字含 query 的卡
  const seeds = pool.filter(c => c.supertype === 'Pokemon' && c.name.toLowerCase().includes(q));
  if (seeds.length === 0) return new Set<string>();

  // name → Card[] 索引（多印刷 / ex 版本同名）
  const byName = new Map<string, Card[]>();
  for (const c of pool) {
    if (c.supertype !== 'Pokemon') continue;
    const arr = byName.get(c.name) ?? [];
    arr.push(c);
    byName.set(c.name, arr);
  }

  // Step 2: 對每張 seed，往上爬 evolvesFrom 到 root，collect 所有 roots
  const roots = new Set<string>();
  for (const seed of seeds) {
    let cur: Card | undefined = seed;
    const visited = new Set<string>();
    while (cur && cur.evolvesFrom && !visited.has(cur.name)) {
      visited.add(cur.name);
      const parent: Card | undefined = byName.get(cur.evolvesFrom)?.[0];
      if (!parent) {
        // pool 內找不到前階卡（可能跨 regulation / pool 不全）— 直接把 evolvesFrom 名字當 root
        roots.add(cur.evolvesFrom);
        cur = undefined;
        break;
      }
      cur = parent;
    }
    if (cur) roots.add(cur.name);
  }

  // Step 3: 從 roots BFS 收集所有後代名字
  const names = new Set<string>(roots);
  let frontier = [...roots];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const c of pool) {
      if (c.supertype !== 'Pokemon') continue;
      if (!c.evolvesFrom) continue;
      if (names.has(c.name)) continue;
      if (frontier.includes(c.evolvesFrom)) {
        names.add(c.name);
        next.push(c.name);
      }
    }
    frontier = next;
  }

  return names;
}
