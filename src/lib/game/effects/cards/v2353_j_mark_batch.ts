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
// v6.065「不看正面→從對手手牌選擇」中央收斂（卡面是「選擇」，不是隨機）
import { oppDiscardChosenConcealedPost } from '../../effects';
import { isReturnToHandBlockedByCalmGround as _calmGroundBlocks } from './v3080_deferred_wave_c'; // v5.986 場上卡→手牌中央述詞
import { selfReturnToHandPost as _selfReturnToHandPost } from '../../effects'; // v5.986 自身回手中央 helper(含平穩境地gate)
import type { EnergyType } from '$lib/cards/types';
import { countEnergyTypeHostAware } from '../../effects'; // v5.669 型別能量數 host-aware(火箭隊=2)
import { applyOppActiveDebuffPost } from '../../effects'; // v5.806 對手 debuff 中央(免疫gate)
import { totalEnergyUnits } from '../../engine'; // v5.669 全屬性能量「個/單位」數 host-aware
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
import { joinCardNames } from '../_shared';
import { toBareCard, getAllAttachedTools } from '../_shared'; // v5.740 離場裸化收斂
import { isBasicEnergyOfType } from '../../engine';
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
 *
 * v4.960：countOf 認新衝天能量 host-aware 規則：
 *   - Stage2 host：算 2 個任意屬性能量（卡面「視為提供 2 個所有屬性的能量」）
 *     → 任何 typeFilter 都 match
 *   - 非 Stage2 host：算 1 個【無】能量（卡面「視為提供 1 個【無】能量」）
 *     → typeFilter='all' 或 typeFilter='Colorless' 時算 1，其他屬性 filter 不 match
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

    // v5.669：卡面「能量的『數量』」=【個】(單位)語意(非【張】卡牌張數;對照 擦除球「張數」=張)。
    //   → 一律走 host-aware 中央計數,火箭隊能量=2 個、繁茂基本草=2、新衝天 host-aware
    //   (與超級交響樂 v5.616 通則一致;原 matchesEnergyType 逐張會把火箭隊算 0~1)。
    //   特定屬性 → countEnergyTypeHostAware;'all'/'Colorless' → totalEnergyUnits(全屬性總單位)。
    const countOf = (c: CardInstance, ownerIdx: 0 | 1): number => {
      if (typeFilter === 'all' || typeFilter === 'Colorless') {
        return totalEnergyUnits(c.energyAttached, pool, state, ownerIdx, c);
      }
      return countEnergyTypeHostAware(c, typeFilter as EnergyType, pool);
    };

    let count = 0;
    if (mode === 'self-attached') {
      count = self.active ? countOf(self.active, aIdx) : 0;
    } else if (mode === 'def-active') {
      count = opp.active ? countOf(opp.active, dIdx) : 0;
    } else if (mode === 'opp-all') {
      const all = [opp.active, ...opp.bench].filter((c): c is CardInstance => !!c);
      count = all.reduce((s, c) => s + countOf(c, dIdx), 0);
    } else {
      // self-all
      const all = [self.active, ...self.bench].filter((c): c is CardInstance => !!c);
      count = all.reduce((s, c) => s + countOf(c, aIdx), 0);
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
// JSON：「從自己的牌庫選擇最多2張抵抗力為【鬥】屬性的寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。」
// v4.45：簡化版（任意寶可夢）→ 真實裝 'Resistance:Fighting' filter
// 對應 deck-search filter 已加在 game/+page.svelte 與 ai.ts（card.resistance?.type === 'Fighting'）
regPre('小箭雀|鳥笛', (state) => ({ state, damage: 0 }));
regPost('小箭雀|鳥笛', (state, aIdx) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return addLog(state, '鳥笛：牌庫為空', aIdx);
  const s = addLog(state, '鳥笛：從牌庫選最多 2 張抵抗力為【鬥】的寶可夢加手牌', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'Resistance:Fighting',
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
regPost('土地雲|螺旋關節', (state, aIdx, pool) => {
  // v5.986 平穩境地：被回手的是「自己」場上的能量 → 對手側有平穩境地則擋
  if (_calmGroundBlocks(state, aIdx, pool)) {
    return addLog(state, '螺旋關節：對手場上有【平穩境地】，能量無法放回手牌', aIdx);
  }
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
// v6.065：卡面是「**選擇**1張丟棄」→ 玩家盲選，不是隨機。
regPost('南瓜怪人ex|幽靈之觸', oppDiscardChosenConcealedPost(1, '幽靈之觸'));

// 禿鷹娜ex｜禿鷹爪：160，在不看正面情況下從對手手牌隨機棄 1 張
regPre('禿鷹娜ex|禿鷹爪', (state) => ({ state, damage: 160 }));
regPost('禿鷹娜ex|禿鷹爪', oppDiscardChosenConcealedPost(1, '禿鷹爪'));

// 朽木妖｜詛咒根：30，受到這個招式的寶可夢下個回合無法附上從手牌使出的能量卡
regPre('朽木妖|詛咒根', (state) => ({ state, damage: 30 }));
// v5.806：收斂中央 applyOppActiveDebuffPost(原漏招式效果免疫 gate→化隱對手仍被禁附能)。
regPost('朽木妖|詛咒根', applyOppActiveDebuffPost(
  '詛咒根',
  (a) => ({ ...a, cantAttachEnergyNextTurn: true }),
  '詛咒根：對手下個回合無法附上從手牌使出的能量卡',
));

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
// v5.986：手刻 body 與中央 selfReturnToHandPost 等價 → 直接收斂(順帶自動吃到平穩境地 gate)。
regPost('電飛鼠|天空迴旋', _selfReturnToHandPost('天空迴旋'));

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

// 超級花葉蒂ex｜永生綻放：200，從牌庫選最多 4 張基本【超】能量，以任意方式附於備戰寶可夢，重洗。
// v3.852 起真正「以任意方式」分配（deck-search → energy-distribute +/- picker，見下方 resolver）。
regPre('超級花葉蒂ex|永生綻放', (state) => ({ state, damage: 200 }));
regPost('超級花葉蒂ex|永生綻放', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return addLog(state, '永生綻放：備戰區沒有寶可夢可附能量', aIdx);
  }
  // v3.85: 基本【超】pokemonType=null fallback。v3.853: 即使 cand=0 也仍開 picker — 讓玩家查看牌庫剩餘卡（Iron Rule 14）。
  const cand = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return !!card && isBasicEnergyOfType(card, 'Psychic');
  });
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
 * v3.852: 永生綻放真正「以任意方式」分配實裝 — 替代舊「全部附到同一隻」簡化版。
 *
 * 流程：
 *   deck-search 選完 → 此 resolver 開 energy-distribute picker（+/- counter UI）
 *   → 玩家用 +/- 把 N 張能量分配到任意數量的備戰寶可夢
 *   → j-2353-florges-distribute commit：從 deck 移除能量 + 分配 + 重洗
 *
 * 卡面：「以任意方式附於『備戰』寶可夢身上」— 只能附備戰，不附戰鬥場（validIids 排除 active）。
 */
regR('j-2353-florges-bench-energy', (state, aIdx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '永生綻放';
  const p = state.players[aIdx];

  if (iids.length === 0) {
    return updatePlayer(
      addLog(state, `${label}：未選擇，重洗牌庫`, aIdx),
      aIdx,
      pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }

  // 卡面：只附「備戰」寶可夢（不含戰鬥場）
  const validIids = p.bench.map(b => b.iid);
  if (validIids.length === 0) {
    // 沒備戰：能量無處可附 → 仍重洗
    return updatePlayer(
      addLog(state, `${label}：備戰區沒有寶可夢可附能量，重洗牌庫`, aIdx),
      aIdx,
      pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }

  // 開 energy-distribute picker — 玩家用 +/- 分配
  return withPending(
    addLog(state, `${label}：選擇將 ${iids.length} 張基本【超】能量以任意方式分配到備戰寶可夢`, aIdx),
    {
      type: 'energy-distribute',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: iids.length, maxCount: iids.length,
      effectKey: 'j-2353-florges-distribute',
      params: {
        label,
        energyIids: iids,            // 能量 iid（仍在 deck，由 commit resolver 移除）
        validIids,                   // 備戰候選 iid
        totalCount: iids.length,
        placedCount: 0,
        energyTypeName: '超',
      },
    },
  );
});

/**
 * v3.852 commit resolver：依玩家分配把能量從 deck 搬到各 bench 寶可夢身上。
 *   selectedIids: 長度 = totalCount，每個元素 = 該張能量的目標寶可夢 iid。
 *   （UI 的 +/- counter 操作後展開為 flat 陣列。）
 */
regR('j-2353-florges-distribute', (state, aIdx, selectedIids, params, pool) => {
  const label = (params?.label as string) ?? '永生綻放';
  const energyIids = ((params?.energyIids as string[] | undefined) ?? []).slice();

  if (selectedIids.length === 0 || energyIids.length === 0) {
    return updatePlayer(
      addLog(state, `${label}：未分配，重洗牌庫`, aIdx),
      aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }

  const useCount = Math.min(selectedIids.length, energyIids.length);
  const tally = new Map<string, number>();
  let s: GameState = state;

  for (let i = 0; i < useCount; i++) {
    const targetIid = selectedIids[i];
    const energyIid = energyIids[i];
    const p = s.players[aIdx];
    // 能量此時仍在 deck（commit 階段才搬）
    const energyInst = p.deck.find(c => c.iid === energyIid);
    if (!energyInst) continue;
    s = updatePlayer(s, aIdx, pl => {
      const restDeck = pl.deck.filter(c => c.iid !== energyIid);
      const attachToBench = (b: CardInstance) => b.iid === targetIid
        ? { ...b, energyAttached: [...b.energyAttached, energyInst] }
        : b;
      return {
        ...pl,
        deck: restDeck,
        bench: pl.bench.map(attachToBench),
      };
    });
    tally.set(targetIid, (tally.get(targetIid) ?? 0) + 1);
  }

  // 全部分配完成 → 重洗牌庫（卡面明文要求）
  s = updatePlayer(s, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));

  const parts: string[] = [];
  for (const [iid, n] of tally) {
    const player = s.players[aIdx];
    const tInst = player.bench.find(b => b.iid === iid);
    const name = tInst ? (pool.get(tInst.cardId)?.name ?? '?') : '?';
    parts.push(`${name}×${n}`);
  }
  return addLog(
    s,
    `${label}：${parts.join('、')} 共 ${useCount} 張基本【超】能量（重洗牌庫）`,
    aIdx,
  );
});
