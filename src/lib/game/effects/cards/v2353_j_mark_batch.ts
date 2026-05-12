/**
 * J 標 v2.353 批次實裝 — P2/P3 低風險卡牌
 *
 * 群組 A  能量倍乘     — 瑪力露麗ex, 超級差不多娃娃ex, 優雅貓, 哲爾尼亞斯
 * 群組 B  牌庫/棄牌搜尋 — 焰后蜥ex, 戰舞郎, 小箭雀, 雷吉艾斯ex, 雷吉斯奇魯ex
 * 群組 C  手牌操作     — 大嘴娃, 超級皮可西ex, 土地雲, 南瓜怪人ex, 禿鷹娜ex, 朽木妖
 * 群組 D  跨回合效果   — 茸茸羊, 電飛鼠
 * 群組 E  棄牌/牌庫放備戰 — 鳳王, 超級花葉蒂ex
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  ATTACK_PRE_DISCARD_CHOICE,
  addLog,
  drawCards,
  regPost,
  regPre,
  regR,
  returnHandToDeck,
  shuffle,
  updatePlayer,
  withPending,
  getOwnBenchLimit,
} from '../_shared';
// ── 工具函式 ─────────────────────────────────────────────────────────────────

function cardName(pool: Map<string, any>, inst?: CardInstance | null): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '?') : '?';
}

/**
 * 判斷能量卡是否符合 typeFilter（'all' = 任意；或 EnergyType 字串如 'Psychic'）。
 *
 * v3.82 fix：基本能量 pokemonType 常為 null（scraper 對基本能量留空），
 *   需 fallback 從卡名的「【X】」標記 parse 屬性。
 *   bug 場景：哲爾尼亞斯|大地風暴 30×【超】能量數 → 基本【超】能量全部漏算 → damage = 0。
 *   同 v3.731 蜜糖風暴 bug、v3.44 基本能量 pokemonType=null 全面修補。
 */
const __MATCH_ZH_TO_TYPE: Record<string, string> = {
  '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
  '超': 'Psychic', '格': 'Fighting', '鬥': 'Fighting',
  '惡': 'Darkness', '鋼': 'Metal',
  '妖': 'Fairy', '龍': 'Dragon', '無': 'Colorless',
};
function matchesEnergyType(
  e: CardInstance,
  typeFilter: string,
  pool: Map<string, any>,
): boolean {
  if (typeFilter === 'all') return true;
  const card = pool.get(e.cardId);
  if (!card) return false;
  // 已標好屬性（特殊能量大多直接 set pokemonType；少數基本也有設）
  if (card.pokemonType === typeFilter) return true;
  // v3.82：基本能量 pokemonType 常為 null → 從卡名「【X】」parse
  if (card.supertype === 'Energy' && card.subtype === 'Basic') {
    const m = (card.name ?? '').match(/【(.+?)】/);
    if (m && __MATCH_ZH_TO_TYPE[m[1]] === typeFilter) return true;
  }
  return false;
}

// ── Helper A：能量倍乘 regPre ─────────────────────────────────────────────────
/**
 * mode:
 *   'self-attached' — 自身附加的指定屬性能量數量 × per
 *   'def-active'    — 對手戰鬥寶可夢附加的任意能量數量 × per
 *   'opp-all'       — 對手所有寶可夢附加的能量總數 × per
 *   'self-all'      — 自己所有寶可夢附加的指定屬性能量總數 × per
 */
function energyMultiplyPre(
  key: string,
  mode: 'self-attached' | 'def-active' | 'opp-all' | 'self-all',
  base: number,
  per: number,
  typeFilter: string,
  label: string,
): void {
  regPre(key, (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const self = state.players[aIdx];
    const opp  = state.players[dIdx];

    const countOf = (c: CardInstance): number =>
      c.energyAttached.filter(e => matchesEnergyType(e, typeFilter, pool)).length;

    let count = 0;
    if (mode === 'self-attached') {
      count = self.active ? countOf(self.active) : 0;
    } else if (mode === 'def-active') {
      count = opp.active ? countOf(opp.active) : 0;
    } else if (mode === 'opp-all') {
      const all = [opp.active, ...opp.bench].filter((c): c is CardInstance => !!c);
      count = all.reduce((s, c) => s + countOf(c), 0);
    } else {
      // self-all
      const all = [self.active, ...self.bench].filter((c): c is CardInstance => !!c);
      count = all.reduce((s, c) => s + countOf(c), 0);
    }

    const dmg = base + count * per;
    const s = addLog(
      state,
      `${label}：${count} 個能量 × ${per} + ${base} → ${dmg}`,
      aIdx,
    );
    return { state: s, damage: dmg };
  });
}

// ── Helper B：手牌丟能量 × 傷害（registerSelfDiscardMultiply 局部複製）────────
function registerDiscardMultiply(
  key: string,
  label: string,
  baseDamage: number,
  per: number,
  max: number,
): void {
  // 通知 UI 顯示能量丟棄選擇界面
  ATTACK_PRE_DISCARD_CHOICE.set(key, {
    min: 0,
    max,
    scope: 'attacker',
    baseDamage,
    damagePerEnergy: per,
  });
  regPre(key, (state, aIdx, _pool, action) => {
    const player = state.players[aIdx];
    if (!player.active) return { state, damage: baseDamage };
    const all = player.active.energyAttached;
    const chosenIids = action?.discardedEnergyIids;

    let discarded: CardInstance[];
    let remaining: CardInstance[];

    if (chosenIids && chosenIids.length > 0) {
      // 玩家手動選擇
      const allowed = new Set(all.map(e => e.iid));
      const capped = chosenIids.filter(id => allowed.has(id)).slice(0, max);
      const setIds = new Set(capped);
      discarded = all.filter(e => setIds.has(e.iid));
      remaining = all.filter(e => !setIds.has(e.iid));
    } else {
      // 自動取最後 N 張（無 UI 互動時的後備）
      const n = Math.min(max, all.length);
      const toDiscard = all.slice(-n);
      const setIds = new Set(toDiscard.map(e => e.iid));
      discarded = all.filter(e => setIds.has(e.iid));
      remaining = all.filter(e => !setIds.has(e.iid));
    }

    let s = updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: remaining } : null,
      discard: [...p.discard, ...discarded],
    }));
    const dmg = baseDamage + per * discarded.length;
    s = addLog(s, `${label}：丟棄 ${discarded.length} 個能量 → ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  });
}

// ── Helper C：從棄牌區選最多 2 張特定基本能量附於自身（雷吉充能共用）──────────
function regiChargePost(
  key: string,
  typeFilter: string,   // 'Water' | 'Metal' 等 EnergyType
  typeText: string,     // '【水】' | '【鋼】' 等顯示用文字
  label: string,
): void {
  // 使用完整的 key 避免不同雷吉系列衝突
  const resolverKey = `j-2353-regi-self-${key.replace('|', '-')}`;

  regPre(key, (state) => ({ state, damage: 0 }));

  regPost(key, (state, aIdx, pool) => {
    const p = state.players[aIdx];
    const cand = p.discard.filter(c => {
      const card = pool.get(c.cardId);
      return (
        card?.supertype === 'Energy' &&
        card.subtype === 'Basic' &&
        (card.pokemonType === typeFilter || (typeText ? card.name.includes(typeText) : false))
      );
    });
    if (cand.length === 0) {
      return addLog(state, `${label}：棄牌區沒有基本${typeText}能量`, aIdx);
    }
    const realMax = Math.min(2, cand.length);
    const s = addLog(
      state,
      `${label}：從棄牌區選最多 ${realMax} 張基本${typeText}能量附於自身`,
      aIdx,
    );
    return withPending(s, {
      type: 'discard-search',
      actorIdx: aIdx,
      sourcePlayerIdx: aIdx,
      filter: `Energy:${typeFilter}`,
      minCount: 0,
      maxCount: realMax,
      effectKey: resolverKey,
      params: { label, typeText, validIids: cand.map(c => c.iid) },
    });
  });

  regR(resolverKey, (state, aIdx, iids, params, pool) => {
    const lbl = (params?.label as string) ?? label;
    const txt = (params?.typeText as string) ?? typeText;
    const p = state.players[aIdx];
    if (!p.active) return state;
    const picked = p.discard.filter(c => iids.includes(c.iid));
    if (picked.length === 0) return addLog(state, `${lbl}：未選擇`, aIdx);
    const pickedSet = new Set(picked.map(c => c.iid));
    const activeName = cardName(pool, p.active);
    const s = updatePlayer(state, aIdx, pl => ({
      ...pl,
      discard: pl.discard.filter(c => !pickedSet.has(c.iid)),
      active: pl.active
        ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...picked] }
        : pl.active,
    }));
    return addLog(
      s,
      `${lbl}：將 ${picked.length} 張基本${txt}能量附加到 ${activeName}`,
      aIdx,
    );
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// J v2.353：卡牌效果登記
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Group A：能量倍乘 ─────────────────────────────────────────────────────────

// 瑪力露麗ex｜能量氣球：60 + 自身附加的【超】能量數量 × 40
energyMultiplyPre('瑪力露麗ex|能量氣球', 'self-attached', 60, 40, 'Psychic', '能量氣球');

// 超級差不多娃娃ex｜耳之力：20 + 對手戰鬥寶可夢附加的能量數量 × 80（所有屬性）
energyMultiplyPre('超級差不多娃娃ex|耳之力', 'def-active', 20, 80, 'all', '耳之力');

// 優雅貓｜能量粉碎：40 × 對手所有寶可夢附加的能量總數（所有屬性）
energyMultiplyPre('優雅貓|能量粉碎', 'opp-all', 0, 40, 'all', '能量粉碎');

// 哲爾尼亞斯｜大地風暴：30 × 自己所有寶可夢附加的【超】能量總數
energyMultiplyPre('哲爾尼亞斯|大地風暴', 'self-all', 0, 30, 'Psychic', '大地風暴');

// ── Group B：牌庫 / 棄牌搜尋 ─────────────────────────────────────────────────

// 焰后蜥ex｜詭計（0 傷害）：從牌庫任意選最多 2 張卡加手牌，並重洗牌庫
regPre('焰后蜥ex|詭計', (state) => ({ state, damage: 0 }));
regPost('焰后蜥ex|詭計', (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '詭計：牌庫為空', aIdx);
  const s = addLog(state, '詭計：從牌庫任意選最多 2 張卡加手牌', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Any',
    minCount: 0,
    maxCount: 2,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 戰舞郎｜旋轉抽出（0 傷害）：將手牌全部放回牌庫並重洗，然後抽 6 張
regPre('戰舞郎|旋轉抽出', (state) => ({ state, damage: 0 }));
regPost('戰舞郎|旋轉抽出', (state, aIdx) => {
  let s = addLog(state, '旋轉抽出：手牌全部放回牌庫並重洗，抽 6 張', aIdx);
  s = returnHandToDeck(s, aIdx);
  s = drawCards(s, aIdx, 6);
  return s;
});

// 小箭雀｜鳥笛（0 傷害）：從牌庫選最多 2 張抵抗力為【鬥】的寶可夢加手牌，重洗
// ⚠️ 簡化：引擎未實裝抵抗力，以 'Pokemon' filter 代替（選任意寶可夢）
regPre('小箭雀|鳥笛', (state) => ({ state, damage: 0 }));
regPost('小箭雀|鳥笛', (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '鳥笛：牌庫為空', aIdx);
  const s = addLog(
    state,
    '鳥笛：從牌庫選最多 2 張寶可夢加手牌（簡化：任意寶可夢，原文需抵抗力【鬥】）',
    aIdx,
  );
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0,
    maxCount: 2,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// 雷吉艾斯ex｜雷吉充能（0 傷害）：從棄牌區選最多 2 張基本【水】能量附於自身
regiChargePost('雷吉艾斯ex|雷吉充能', 'Water', '【水】', '雷吉充能');

// 雷吉斯奇魯ex｜雷吉充能（0 傷害）：從棄牌區選最多 2 張基本【鋼】能量附於自身
regiChargePost('雷吉斯奇魯ex|雷吉充能', 'Metal', '【鋼】', '雷吉充能');

// 雷吉斯奇魯ex｜防護鋼鐵：140，下個對手回合這隻寶可夢受到招式的傷害 -50
regPre('雷吉斯奇魯ex|防護鋼鐵', (state) => ({ state, damage: 140 }));
regPost('雷吉斯奇魯ex|防護鋼鐵', (state, aIdx) =>
  updatePlayer(
    addLog(state, '防護鋼鐵：下個對手回合，這隻寶可夢受到招式傷害 -50', aIdx),
    aIdx,
    p => p.active ? { ...p, active: { ...p.active, damageReduceNextHit: 50 } } : p,
  ),
);

// ── Group C：手牌操作 ─────────────────────────────────────────────────────────

// 大嘴娃｜雙重食客：0 + 自身丟棄最多 2 張能量 × 60
registerDiscardMultiply('大嘴娃|雙重食客', '雙重食客', 0, 60, 2);

// 超級皮可西ex｜射攻月亮：120 + 自身丟棄最多 4 張手牌能量 × 40
//   v3.26：原 registerDiscardMultiply 用 'attacker' scope 不對（卡面是「從手牌」棄能量），
//   且 v2380 PRE 強制棄前 4 張手牌能量違反「若希望」。
//   現在改由 v2380 自己用 'hand-energy' scope 註冊（玩家自選 0-4 張）；v2353 不再註冊。

// 土地雲｜螺旋關節：120，選 1 個自身附加能量放回手牌
regPre('土地雲|螺旋關節', (state) => ({ state, damage: 120 }));
regPost('土地雲|螺旋關節', (state, aIdx) => {
  const p = state.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) {
    return addLog(state, '螺旋關節：自身沒有能量可放回手牌', aIdx);
  }
  const s = addLog(state, '螺旋關節：選擇 1 個自身能量放回手牌', aIdx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'j-2353-landorus-return-energy',
    params: { label: '螺旋關節', titleOverride: '選擇要放回手牌的能量' },
  });
});
regR('j-2353-landorus-return-energy', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return state;
  const energyIid = iids[0];
  const p = state.players[aIdx];
  if (!p.active) return state;
  const energy = p.active.energyAttached.find(e => e.iid === energyIid);
  if (!energy) return state;
  const ename = cardName(pool, energy);
  const s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    active: pl.active
      ? { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => e.iid !== energyIid) }
      : pl.active,
    hand: [...pl.hand, energy],
  }));
  return addLog(s, `螺旋關節：將 ${ename} 放回手牌`, aIdx);
});

// 南瓜怪人ex｜幽靈之觸：140，在不看正面情況下從對手手牌隨機棄 1 張
regPre('南瓜怪人ex|幽靈之觸', (state) => ({ state, damage: 140 }));
regPost('南瓜怪人ex|幽靈之觸', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  if (d.hand.length === 0) return addLog(state, '幽靈之觸：對手手牌為空', aIdx);
  const idx = Math.floor(Math.random() * d.hand.length);
  const picked = d.hand[idx];
  return updatePlayer(
    addLog(state, '幽靈之觸：隨機棄對手手牌 1 張', aIdx),
    dIdx,
    p => ({ ...p, hand: p.hand.filter((_, i) => i !== idx), discard: [...p.discard, picked] }),
  );
});

// 禿鷹娜ex｜禿鷹爪：160，在不看正面情況下從對手手牌隨機棄 1 張
regPre('禿鷹娜ex|禿鷹爪', (state) => ({ state, damage: 160 }));
regPost('禿鷹娜ex|禿鷹爪', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  if (d.hand.length === 0) return addLog(state, '禿鷹爪：對手手牌為空', aIdx);
  const idx = Math.floor(Math.random() * d.hand.length);
  const picked = d.hand[idx];
  return updatePlayer(
    addLog(state, '禿鷹爪：隨機棄對手手牌 1 張', aIdx),
    dIdx,
    p => ({ ...p, hand: p.hand.filter((_, i) => i !== idx), discard: [...p.discard, picked] }),
  );
});

// 朽木妖｜詛咒根：30，受到這個招式的寶可夢下個回合無法附上從手牌使出的能量卡
regPre('朽木妖|詛咒根', (state) => ({ state, damage: 30 }));
regPost('朽木妖|詛咒根', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active) return state;
  const dName = cardName(pool, d.active);
  const players = [...state.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...d, active: { ...d.active, cantAttachEnergyNextTurn: true } };
  return addLog(
    { ...state, players },
    `詛咒根：${dName} 下個回合無法附上從手牌使出的能量卡`,
    aIdx,
  );
});

// ── Group D：跨回合效果 ───────────────────────────────────────────────────────

// 茸茸羊｜電磁干擾：40，在下個對手的回合，對手無法從手牌使出物品卡
regPre('茸茸羊|電磁干擾', (state) => ({ state, damage: 40 }));
regPost('茸茸羊|電磁干擾', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  players[dIdx] = { ...state.players[dIdx], cantPlayItemNextTurn: true };
  return addLog({ ...state, players }, '電磁干擾：對手下個回合無法從手牌使出物品卡', aIdx);
});

// 電飛鼠｜天空迴旋：30，將這隻寶可夢與附加的卡全部放回手牌
regPre('電飛鼠|天空迴旋', (state) => ({ state, damage: 30 }));
regPost('電飛鼠|天空迴旋', (state, aIdx) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const inst = p.active;
  // 主體 + 附加能量 + 工具卡 + 進化鏈底層
  const returning: CardInstance[] = [
    {
      ...inst,
      damage: 0,
      energyAttached: [],
      toolAttached: undefined,
      status: undefined,
      evolvedFromStack: undefined,
      evolvedThisTurn: undefined,
      justPlaced: undefined,
      playedFromHand: undefined,
      movedToActiveThisTurn: undefined,
      damageBonusThisTurn: undefined,
      damageReduceNextHit: undefined,
      abilityUsedThisTurn: undefined,
      cantAttackThisTurn: undefined,
      cantAttackPending: undefined,
      cantRetreatNextTurn: undefined,
      cantRetreatPendingSelf: undefined,
      damageBonusPending: undefined,
    },
    ...inst.energyAttached,
    ...(inst.toolAttached ? [inst.toolAttached] : []),
    ...(inst.evolvedFromStack ?? []),
  ];
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...p, active: null, hand: [...p.hand, ...returning] };
  return addLog({ ...state, players }, '天空迴旋：將自身（含附加的卡）全部放回手牌', aIdx);
});

// ── Group E：棄牌 / 牌庫放備戰 ───────────────────────────────────────────────

// 鳳王｜復生火焰（0 傷害）：從棄牌區選最多 3 張基礎寶可夢放置備戰區
// 複用 effects.ts 的 bench-from-discard-samename resolver（支援 validIids 過濾）
regPre('鳳王|復生火焰', (state) => ({ state, damage: 0 }));
regPost('鳳王|復生火焰', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  // v3.80：getOwnBenchLimit 支援零之大空洞
  const benchLimit = getOwnBenchLimit(state, aIdx, pool);
  if (p.bench.length >= benchLimit) return addLog(state, '復生火焰：備戰區已滿', aIdx);
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.stage === 'Basic';
  });
  if (cand.length === 0) return addLog(state, '復生火焰：棄牌區沒有基礎寶可夢', aIdx);
  const slots = Math.min(3, benchLimit - p.bench.length, cand.length);
  const s = addLog(state, `復生火焰：從棄牌區選最多 ${slots} 張基礎寶可夢放備戰`, aIdx);
  return withPending(s, {
    type: 'discard-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Pokemon',
    minCount: 0,
    maxCount: slots,
    effectKey: 'bench-from-discard-samename',
    params: {
      validIids: cand.map(c => c.iid),
      targetName: '基礎寶可夢',
      label: '復生火焰',
    },
  });
});

// 超級花葉蒂ex｜永生綻放：200，從牌庫選最多 4 張基本【超】能量附於備戰寶可夢，重洗
// 若備戰只有 1 隻：自動附加。若有多隻：進入 bench-choose 選目標（全部附到同一隻）
// ⚠️ 簡化：原文可「以任意方式」分配，此實裝限制全部附到同一備戰寶可夢
regPre('超級花葉蒂ex|永生綻放', (state) => ({ state, damage: 200 }));
regPost('超級花葉蒂ex|永生綻放', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return addLog(state, '永生綻放：備戰區沒有寶可夢可附能量', aIdx);
  }
  const cand = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return (
      card?.supertype === 'Energy' &&
      card.subtype === 'Basic' &&
      card.pokemonType === 'Psychic'
    );
  });
  if (cand.length === 0) {
    return addLog(state, '永生綻放：牌庫沒有基本【超】能量', aIdx);
  }
  const realMax = Math.min(4, cand.length);
  const s = addLog(
    state,
    `永生綻放：從牌庫選最多 ${realMax} 張基本【超】能量附於備戰寶可夢`,
    aIdx,
  );
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Energy:Psychic',
    minCount: 0,
    maxCount: realMax,
    effectKey: 'j-2353-florges-bench-energy',
    params: { label: '永生綻放' },
  });
});

/**
 * deck-search 選完後：
 * - 能量仍在牌庫中（未移除）
 * - 若備戰只有 1 隻 → 一次完成（移除+重洗+附加）
 * - 若備戰多隻 → bench-choose 選目標（能量暫留牌庫，待 commit 步驟處理）
 */
regR('j-2353-florges-bench-energy', (state, aIdx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '永生綻放';
  const p = state.players[aIdx];

  if (iids.length === 0) {
    // 未選擇任何能量：僅重洗牌庫
    return updatePlayer(
      addLog(state, `${label}：未選擇，重洗牌庫`, aIdx),
      aIdx,
      pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }

  // 此時能量仍在 p.deck，透過 iids 找到
  const pickedSet = new Set(iids);
  const picked = p.deck.filter(c => pickedSet.has(c.iid));

  if (p.bench.length === 1) {
    // 自動附加到唯一的備戰寶可夢
    const target = p.bench[0];
    const tname = _pool.get(target.cardId)?.name ?? '?';
    let s = updatePlayer(state, aIdx, pl => ({
      ...pl,
      deck: shuffle(pl.deck.filter(c => !pickedSet.has(c.iid))),
      bench: pl.bench.map(b =>
        b.iid === target.iid
          ? { ...b, energyAttached: [...b.energyAttached, ...picked] }
          : b,
      ),
    }));
    return addLog(
      s,
      `${label}：將 ${picked.length} 張基本【超】能量附加到 ${tname}（重洗牌庫）`,
      aIdx,
    );
  }

  // 多隻備戰：進入 bench-choose（能量保留在牌庫，iids 傳遞到下一步）
  const s = addLog(
    state,
    `${label}：選擇要附加 ${picked.length} 張基本【超】能量的備戰寶可夢`,
    aIdx,
  );
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'j-2353-florges-bench-energy-commit',
    params: { energyIids: iids, label },
  });
});

/**
 * bench-choose 選完目標後：
 * - 從牌庫移除選中能量（仍在牌庫），重洗，附加到選定備戰寶可夢
 */
regR('j-2353-florges-bench-energy-commit', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '永生綻放';
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];

  if (!targetIid || energyIids.length === 0) return state;

  const p = state.players[aIdx];
  const pickedSet = new Set(energyIids);
  // 能量此時仍在 p.deck（bench-choose 中間步驟未動牌庫）
  const picked = p.deck.filter(c => pickedSet.has(c.iid));
  const target = p.bench.find(b => b.iid === targetIid);
  if (!target) return state;

  const tname = cardName(pool, target);
  let s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    deck: shuffle(pl.deck.filter(c => !pickedSet.has(c.iid))),
    bench: pl.bench.map(b =>
      b.iid === targetIid
        ? { ...b, energyAttached: [...b.energyAttached, ...picked] }
        : b,
    ),
  }));
  return addLog(
    s,
    `${label}：將 ${picked.length} 張基本【超】能量附加到 ${tname}（重洗牌庫）`,
    aIdx,
  );
});
