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

// v5.602：去除進化變體後綴/前綴 → 取「同一隻寶可夢」的 base 名（用於 seed 同 species 精確比對）。
//   超級XXXex / XXXex / XXXV / XXXVMAX … 視為同一 species；不同 species（咕咕 vs 咕咕鴿）則不同。
//   與 engine sameEvoName 同精神，但 cards/ 層自含、不依賴 game/。
function evoBaseName(name: string): string {
  let n = (name ?? '').trim().toLowerCase();
  if (n.startsWith('超級')) n = n.slice(2);
  n = n.replace(/(vmax|vstar|gx|ex|v)$/, '');
  return n.trim();
}

export function getEvolutionChainNames(query: string, pool: Card[]): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q || pool.length === 0) return new Set<string>();

  // Step 1: seeds
  // v5.602 修：原本用 c.name.startsWith(q) → 當某寶可夢名是另一隻「不同 species」的前綴時會誤抓
  //   （玩家報「咕咕」抓到「咕咕鴿」→ 咕咕鴿往上爬 evolvesFrom 到「豆豆鴿」→ 整條豆豆鴿線被拉進咕咕鏈）。
  //   改法：先取「同進化 species」精確 seed（去 ex/超級/V 等變體後 base name 等於 query base）；
  //   找不到精確 species 才退回 prefix 比對（保留「打部分字搜尋」如輸入「甲賀」）。
  //   真正同線的後代由 Step 3 BFS（evolvesFrom 鏈）收集，不受此限（鬼斯→鬼斯通→耿鬼 等仍完整）。
  const isSeedCard = (c: Card) =>
    c.supertype === 'Pokemon' || (c.supertype === 'Trainer' && c.subtype === 'Item');
  const qBase = evoBaseName(q);
  let seeds = pool.filter(c => isSeedCard(c) && evoBaseName(c.name) === qBase);
  if (seeds.length === 0) seeds = pool.filter(c => isSeedCard(c) && c.name.toLowerCase().startsWith(q));
  if (seeds.length === 0) return new Set<string>();

  // name → Card[] 索引（多印刷 / ex 版本同名）
  // v5.271: 加 Trainer/Item 卡 (化石) — 寶可夢 evolvesFrom===化石名 時可查到 fossil root
  const byName = new Map<string, Card[]>();
  for (const c of pool) {
    if (c.supertype !== 'Pokemon' && !(c.supertype === 'Trainer' && c.subtype === 'Item')) continue;
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

/**
 * v4.988: 進化鏈分階版本 — 給 modal 視覺化用。
 * 回傳按 stage (Basic / Stage1 / Stage2) 排序的陣列，同階多名字並列。
 *
 * 範例輸出（query='甲賀忍蛙'）：
 *   [
 *     { stage: 'Basic',  names: ['呱呱泡蛙'] },
 *     { stage: 'Stage1', names: ['呱頭蛙'] },
 *     { stage: 'Stage2', names: ['甲賀忍蛙ex', '超級甲賀忍蛙ex'] },
 *   ]
 */
export interface EvolutionStageGroup {
  stage: 'Basic' | 'Stage1' | 'Stage2';
  names: string[];
}

export function getEvolutionChainGrouped(query: string, pool: Card[]): EvolutionStageGroup[] {
  const allNames = getEvolutionChainNames(query, pool);
  if (allNames.size === 0) return [];

  // 對每個 name 取第一張卡決定 stage（同名同階）
  const stageOrder: ('Basic' | 'Stage1' | 'Stage2')[] = ['Basic', 'Stage1', 'Stage2'];
  const grouped = new Map<'Basic' | 'Stage1' | 'Stage2', string[]>();
  for (const name of allNames) {
    const card = pool.find(c => c.name === name);
    // 優先 stage 欄位，fallback subtype，再 fallback by evolvesFrom 判斷
    let stage: 'Basic' | 'Stage1' | 'Stage2';
    if (card?.stage && stageOrder.includes(card.stage)) {
      stage = card.stage;
    } else if (card?.subtype === 'Stage1' || card?.subtype === 'Stage2' || card?.subtype === 'Basic') {
      stage = card.subtype;
    } else if (card?.supertype === 'Trainer' && card?.subtype === 'Item') {
      // v5.271: 化石卡標 Basic stage (作為進化鏈起點)
      stage = 'Basic';
    } else {
      // card 缺失或 subtype 非標準（如 'ex'）→ 由 evolvesFrom 判斷
      stage = card?.evolvesFrom ? 'Stage1' : 'Basic';
    }
    const arr = grouped.get(stage) ?? [];
    arr.push(name);
    grouped.set(stage, arr);
  }

  return stageOrder
    .filter(s => grouped.has(s))
    .map(s => ({ stage: s, names: grouped.get(s)! }));
}
