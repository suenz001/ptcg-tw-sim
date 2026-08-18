/**
 * v2.158 — 通用「逐張附能量到玩家選的目標寶可夢」chain helper
 *
 * 起因：v2.154 / v2.155 / v2.149 的多張卡（金屬製造者 / 玻璃喇叭 / 燃燒充能 / 電電充能 /
 * 樂呵呵之吻 / X啟動）都有「以任意方式附於 N 隻寶可夢」的卡面，但實裝為「自動附到
 * active 或第 1 隻備戰」的簡化版。Leon 要求升級為符合卡面的玩家自選分配。
 *
 * 設計：複用 v2.89 超級路卡利歐ex｜波動突刺已驗證過的 chain pattern：
 *   1. 能量先從 source（deck 或 discard）移到 attacker.discard 暫存
 *      （deck source 同時 reshuffle）
 *   2. 對第 1 張能量開 poke-picker（依 scope）
 *   3. resolver 將該能量從 discard 移到玩家選的目標
 *   4. 若還有剩餘能量 → 遞迴下一個 picker
 *   5. 場上只有 1 個合法目標時自動全附（避免反覆彈 UI）
 *
 * 兩個 effectKey：
 *   - 'v158-energy-chain-start'：完成能量挑選後的入口（玩家已選 picked 能量 iids）
 *   - 'v158-energy-chain-attach'：picker 選完目標後的單張附加（內部 chain 用）
 *
 * params 結構：
 *   - label              : 招式/特性名（log 用）
 *   - source             : 'deck' | 'discard'  能量原本在哪
 *   - scope              : 'bench-only' | 'any-own'  picker 範圍
 *   - filterType?        : 'Grass'|'Lightning'|'Metal'|'Psychic'|'Colorless'|'Any'
 *                          目標寶可夢屬性（用於可附目標 filter，缺省 'Any'）
 *   - leftoverToDeckBottom?: 玩家放棄沒分配的能量去處（true = 洗回牌庫底；預設 = 留在棄牌區）
 *   - reshuffleDeck?     : 是否在搬完能量後重洗 deck（source='deck' 必為 true）
 *
 * 適用招式（v2.158 升級對象）：
 *   - 燃燒充能（火伊布ex）
 *   - 電電充能（電電蟲）— 草+雷各 ≤2；用兩階段呼叫
 *   - 樂呵呵之吻（迷唇娃）— 卡面是「附於 1 隻備戰」 — 玩家選 1 隻
 *   - 金屬製造者（金屬怪 特性，source='deck top-4'）
 *   - 玻璃喇叭（Item，源於 discard）
 *   - X啟動（大吾的巨金怪ex 特性）
 */

import type { Card } from '$lib/cards/types';
import type { CardInstance, GameState, PlayerState } from '../../types';
import {
  reg, regR, regG, regA, // ts: 雖然這檔不直接 reg 卡片，但仍 export resolver 給其他檔用
  shuffle, addLog, withPending, updatePlayer,
  fireOnHandEnergyAttached, // v5.539 從手牌附能後觸發對手被動（侵蝕詛咒 等）
} from '../_shared';
// v6.164：從手牌附能 → 自方 瑪機雅娜｜自動治癒（卡面「每次從自己的手牌將能量卡附於寶可夢
//   身上時，將那隻寶可夢恢復『90』HP」）。本管線過去只接了「對手」的附能反應
//   （fireOnHandEnergyAttached），漏了自方這一支 —— 走 chain 且來源是手牌的**特性**
//   （鴨嘴炎獸｜拍檔提升 J 標「最多各1張」）瑪機雅娜可同時在戰鬥場，會漏回血。
//   招式型（滿載心田／熱帶狂燒／幸福禮物）攻擊者本身佔住 active，helper 內部查不到
//   瑪機雅娜會回 0，統一呼叫是安全的。
//   ⚠ v3000_g3_wave2 只 import ../_shared，不 import 本檔 ⇒ 無循環 import／TDZ 疑慮。
import { applyMagearnaHandAttachHeal } from './v3000_g3_wave2';
import { getEffectivePokemonTypes } from '../../effects';  // v6.207 中央「場上有效屬性」述詞

// ══════════════════════════════════════════════════════════════════════════════
// pokemonType helpers — 判斷寶可夢屬性是否符合 filter
// ══════════════════════════════════════════════════════════════════════════════

type SingleType = 'Grass' | 'Lightning' | 'Metal' | 'Psychic'
  | 'Fire' | 'Water' | 'Fighting' | 'Darkness' | 'Dragon' | 'Colorless';
type EnergyTypeFilter = SingleType | 'Any' | SingleType[];

// ⭐⭐ v6.207：卡面一律寫「附於自己的【X】寶可夢身上」＝**場上**那隻此刻的屬性。
//   舊版直讀印刷 pokemonType ⇒ 小碎鑽（在場上是【鬥】＋【超】）/ 狠辣椒ex（【草】＋【火】）
//   在能量鏈裡選不到。簽名多收 st/idx/inst 是**必填**，強迫呼叫端提供場上脈絡
//   （缺席會 TS 報錯，不會靜默 fail-open 退回印刷屬性）。
function pokemonMatchesType(
  st: GameState, idx: 0 | 1, inst: CardInstance | null | undefined,
  card: Card | undefined, pool: Map<string, Card>, filter: EnergyTypeFilter,
): boolean {
  if (!card) return false;
  if (filter === 'Any') return true;
  const eff = getEffectivePokemonTypes(st, idx, inst, card, pool);
  if (Array.isArray(filter)) return eff.some(t => filter.includes(t as SingleType));
  return eff.includes(filter);
}

// v2.87 中文屬性顯示名（給 UI 標頭用）
const ZH_BY_TYPE: Record<string, string> = {
  Grass: '草', Fire: '火', Water: '水', Lightning: '雷',
  Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼',
  Dragon: '龍', Colorless: '無', Fairy: '妖',
};

/**
 * v2.87 偵測能量陣列是否「全部同屬性」。
 * 同屬性才能用單一計數器來代表「N 張同質能量分散到目標」。
 */
export function detectSameEnergyType(
  energies: CardInstance[],
  pool: Map<string, Card>,
): SingleType | null {
  if (energies.length === 0) return null;
  const nameToType = (name: string): SingleType | null => {
    if (name.includes('【草】')) return 'Grass';
    if (name.includes('【火】')) return 'Fire';
    if (name.includes('【水】')) return 'Water';
    if (name.includes('【雷】')) return 'Lightning';
    if (name.includes('【超】')) return 'Psychic';
    if (name.includes('【鬥】')) return 'Fighting';
    if (name.includes('【惡】')) return 'Darkness';
    if (name.includes('【鋼】')) return 'Metal';
    if (name.includes('【龍】')) return 'Dragon';
    if (name.includes('【無】')) return 'Colorless';
    return null;
  };
  let firstType: SingleType | null = null;
  for (const e of energies) {
    const c = pool.get(e.cardId);
    if (!c) return null;
    if (c.supertype !== 'Energy' || c.subtype !== 'Basic') return null;
    const t = (c.pokemonType as SingleType | undefined) ?? nameToType(c.name);
    if (!t) return null;
    if (firstType === null) firstType = t;
    else if (firstType !== t) return null;
  }
  return firstType;
}

/**
 * v2.87 共用 resolver：energy-distribute 平展模式
 *   selectedIids: 長度 = totalCount，每個元素 = 該張能量要附給哪一隻寶可夢
 */
regR('v87-energy-distribute-flat', (st, aIdx, selectedIids, params, pool) => {
  const label = String(params?.label ?? '能量分配');
  const energyIids = ((params?.energyIids as string[] | undefined) ?? []).slice();
  const energyTypeName = (params?.energyTypeName as string | undefined) ?? '';
  // ⚠ v6.083 公平性（v6.009 通則）：卡面指名目標時（拍檔提升限「電擊魔獸」「鴨嘴炎獸」、
  //   鱗片律動限【龍】、密勒頓/太樂巴戈斯限標籤），resolver 必須自驗 client 送來的目標
  //   在白名單內 —— engine 的 sanitizeSelectedIids 對 energy-distribute 是「原封放行」
  //   （合法用重複編碼計數），不會幫忙擋。undefined = 不限（舊行為）。
  const allowTargets = params?.targetIids as string[] | undefined;
  const allowSet = Array.isArray(allowTargets) ? new Set(allowTargets) : null;

  if (selectedIids.length === 0 || energyIids.length === 0) {
    return addLog(st, `${label}：未分配任何能量`, aIdx);
  }
  const useCount = Math.min(selectedIids.length, energyIids.length);
  const tally = new Map<string, number>();
  let s: GameState = st;

  for (let i = 0; i < useCount; i++) {
    const targetIid = selectedIids[i];
    if (allowSet && !allowSet.has(targetIid)) continue;   // v6.083 白名單外的目標一律忽略
    const energyIid = energyIids[i];
    const p = s.players[aIdx];
    const energyInst = p.discard.find(c => c.iid === energyIid);
    if (!energyInst) continue;
    const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
    if (!target) continue;
    s = updatePlayer(s, aIdx, pl => {
      const restDiscard = pl.discard.filter(c => c.iid !== energyIid);
      const attach = (poke: CardInstance) => poke.iid === targetIid
        ? { ...poke, energyAttached: [...poke.energyAttached, energyInst] }
        : poke;
      return {
        ...pl,
        discard: restDiscard,
        active: pl.active ? attach(pl.active) : pl.active,
        bench: pl.bench.map(attach),
      };
    });
    tally.set(targetIid, (tally.get(targetIid) ?? 0) + 1);
  }

  // v5.539：從手牌附能 → 對被附能的寶可夢觸發對手附能被動（耿鬼ex|侵蝕詛咒 等）
  // v6.164：per-energy-card —— tally 記的就是「這隻拿了幾張」，必須整數傳下去
  //   （官方 §17.21.F：一次附 2 張 → 侵蝕詛咒放 4 個指示物）。
  if (params?.source === 'hand') {
    // v6.164：自方自動治癒（heal）＋ 對手附能反應（fire），兩者都 per-energy-card
    for (const [iid, n] of tally) s = fireOnHandEnergyAttached(applyMagearnaHandAttachHeal(s, aIdx, [iid], pool, n), aIdx, iid, pool, n);
  }

  const parts: string[] = [];
  for (const [iid, n] of tally) {
    const player = s.players[aIdx];
    const tInst = player.active?.iid === iid ? player.active : player.bench.find(c => c.iid === iid);
    const name = tInst ? (pool.get(tInst.cardId)?.name ?? '?') : '?';
    parts.push(`${name}×${n}`);
  }
  const typeLabel = energyTypeName ? `【${energyTypeName}】` : '';
  if (parts.length > 0) {
    s = addLog(s, `${label}：${parts.join('、')} 共 ${useCount} 張${typeLabel}能量`, aIdx);
  }
  return s;
});

/**
 * v2.87 開出 energy-distribute pending 的便利 helper。
 */
export function dispatchEnergyDistributePending(
  st: GameState,
  aIdx: 0 | 1,
  energyIids: string[],
  validIids: string[],
  opts: { label: string; energyType: SingleType },
): GameState {
  const energyTypeName = ZH_BY_TYPE[opts.energyType] ?? '';
  return withPending(st, {
    type: 'energy-distribute',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: energyIids.length, maxCount: energyIids.length,
    effectKey: 'v87-energy-distribute-flat',
    params: {
      label: opts.label,
      energyIids,
      validIids,
      totalCount: energyIids.length,
      placedCount: 0,
      energyTypeName,
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 核心 helper：直接呼叫版（給其他模組複用，不透過 RESOLVE_SELECTION）
// ══════════════════════════════════════════════════════════════════════════════
//
// 用法：
//   1. 玩家先用 deck-search/discard-search picker 選 energyIids
//   2. resolver 內呼叫 startEnergyChain(state, aIdx, energyIids, opts, pool)
//   3. helper 處理：能量 source 移動、找合法目標、開 chain picker（或 1 目標自動全附）
//
// 對於非 deck/discard 的特殊 source（如 metagross X啟動 — 從 deck 取特定 iid）
// 呼叫方需自己先把能量搬到 attacker.discard，然後 source 傳 'discard'。
//
export interface EnergyChainOpts {
  label: string;
  // v3.12: 加入 'hand' 來源（艾姆利多｜滿載心田、阿羅拉椰蛋樹ex｜熱帶狂燒）。
  // 'hand' 與 'deck' 一樣會把選的能量先搬到 attacker.discard 暫存，
  // 後續 chain 流程一致。'hand' 不需要 reshuffle。
  source: 'deck' | 'discard' | 'hand';
  scope: 'bench-only' | 'any-own';
  filterType?: EnergyTypeFilter;
  // v5.823：可附目標的 iid 白名單(標籤型如密勒頓「未來」/太樂巴戈斯「太晶」寶可夢)。undefined=不限。
  targetIids?: string[];
  /**
   * ⭐ v6.105：卡面是「附於自己的**1隻**寶可夢身上」→ 選好的能量**全部附到同一隻**，
   * 不可分散。預設 false ＝「以任意方式」型（可逐張／分波分散）。
   *
   * ⚠ 這兩種卡面**必須嚴格區分**，是兩條不同的規則：
   *   ・「以任意方式附於自己的寶可夢身上」 → 可分散（singleTarget 不填）
   *   ・「附於自己的 1 隻寶可夢身上」／「附於 1 隻備戰寶可夢身上」 → 只能一隻
   * v2.158 當初把兩者混在一起升級（見本檔頭「適用招式」列表把樂呵呵之吻也列進來），
   * 迷唇娃後來被改回單目標，但**火伊布ex｜燃燒充能一直錯到 v6.105**（玩家回報）。
   */
  singleTarget?: boolean;
}

export function startEnergyChain(
  st: GameState,
  aIdx: 0 | 1,
  energyIids: string[],
  opts: EnergyChainOpts,
  pool: Map<string, Card>,
): GameState {
  const { label, source, scope } = opts;
  const targetIids = opts.targetIids; // v5.823 標籤型目標白名單
  const filterType = opts.filterType ?? 'Any';
  const reshuffleDeck = source === 'deck';

  // 玩家未選任何能量 → 結束（仍要 reshuffle deck 若是 deck source）
  if (energyIids.length === 0) {
    if (reshuffleDeck) {
      st = updatePlayer(st, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
    }
    return addLog(st, `${label}：未選擇能量`, aIdx);
  }

  // 把選的能量從 source 取出，先放到 attacker.discard 暫存
  // v3.12: 'hand' 與 'deck' 同樣搬到 discard 緩衝；'discard' 已在 discard 不需動
  st = updatePlayer(st, aIdx, p => {
    const pickSet = new Set(energyIids);
    if (source === 'deck') {
      const picked = p.deck.filter(c => pickSet.has(c.iid));
      const remaining = p.deck.filter(c => !pickSet.has(c.iid));
      return { ...p, deck: shuffle(remaining), discard: [...p.discard, ...picked] };
    }
    if (source === 'hand') {
      const picked = p.hand.filter(c => pickSet.has(c.iid));
      const remaining = p.hand.filter(c => !pickSet.has(c.iid));
      return { ...p, hand: remaining, discard: [...p.discard, ...picked] };
    }
    // source === 'discard' 已在 discard 中，無需移動
    return p;
  });

  // 找場上合法目標（依 scope + filterType）
  const player = st.players[aIdx];
  const candidates: CardInstance[] = [];
  if (scope === 'any-own') {
    if (player.active) candidates.push(player.active);
  }
  for (const b of player.bench) candidates.push(b);
  // v5.184：詛咒根擋手牌附能 — source='hand' 時排除受詛咒根影響的目標
  //   （詛咒根只擋「從手牌附能」；deck/discard source 不受影響）
  const validTargets = candidates.filter(c => {
    if (!pokemonMatchesType(st, aIdx, c, pool.get(c.cardId), pool, filterType)) return false;
    if (source === 'hand' && c.cantAttachEnergyThisTurn) return false;
    if (targetIids && !targetIids.includes(c.iid)) return false; // v5.823 標籤型目標限定
    return true;
  });

  if (validTargets.length === 0) {
    // 場上無合法目標 → 能量留在 discard
    const ftDesc = filterType === 'Any' ? '寶可夢' :
      Array.isArray(filterType) ? filterType.join('/') + ' 寶可夢' :
      filterType + ' 寶可夢';
    return addLog(st,
      `${label}：場上無可附目標（${ftDesc}），${energyIids.length} 張能量留在棄牌區`,
      aIdx);
  }

  // 場上只有 1 個合法目標 → 全附避免反覆彈 UI
  if (validTargets.length === 1) {
    const target = validTargets[0];
    const tname = pool.get(target.cardId)?.name ?? '?';
    st = updatePlayer(st, aIdx, p => {
      const energies = p.discard.filter(c => energyIids.includes(c.iid));
      const remDiscard = p.discard.filter(c => !energyIids.includes(c.iid));
      const attach = (poke: CardInstance) => poke.iid === target.iid
        ? { ...poke, energyAttached: [...poke.energyAttached, ...energies] }
        : poke;
      return {
        ...p,
        discard: remDiscard,
        active: p.active ? attach(p.active) : p.active,
        bench: p.bench.map(attach),
      };
    });
    // v5.539：source==='hand' → 觸發對手附能被動（耿鬼ex|侵蝕詛咒 等）
    // v6.164：這條是「唯一合法目標 → 全附」，一次附 energyIids.length 張 ⇒ per-energy-card
    if (source === 'hand') st = fireOnHandEnergyAttached(applyMagearnaHandAttachHeal(st, aIdx, [target.iid], pool, energyIids.length), aIdx, target.iid, pool, energyIids.length); // v6.164 heal+fire 皆 per-card
    return addLog(st, `${label}：場上僅有 1 個合法目標 → 全 ${energyIids.length} 張能量附到 ${tname}`, aIdx);
  }

  // ⭐ v6.105：卡面「附於自己的 1 隻寶可夢」型 —— 開**一次**目標 picker，全部能量附同一隻。
  //   （目標只有 1 隻時上面已自動全附，這裡處理 2 隻以上。）
  //   走與「以任意方式」型同一條管線，只差這個分支 —— 能量搬移／目標 filter／詛咒根／
  //   標籤白名單／hand-source 被動觸發全部共用，不再各卡手刻一份。
  if (opts.singleTarget) {
    const pickerType = scope === 'bench-only' ? 'bench-choose' : 'heal-target';
    st = addLog(st, `${label}：選 1 隻寶可夢，${energyIids.length} 張能量全部附給它`, aIdx);
    return withPending(st, {
      type: pickerType,
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'v158-energy-single-target-attach',
      params: {
        label, source,
        energyIids,
        validIids: validTargets.map(c => c.iid),
        titleOverride: `${label}：選擇要附上 ${energyIids.length} 張能量的寶可夢（全部附同一隻）`,
      },
    });
  }

  // v2.87 同屬性偵測：若所有能量都同屬性 → 改用 +/- 計數器 UI（一次選完不必逐張按）
  const energyInsts = st.players[aIdx].discard.filter(c => energyIids.includes(c.iid));
  const sameType = detectSameEnergyType(energyInsts, pool);
  if (sameType) {
    const zh = ZH_BY_TYPE[sameType] ?? '';
    st = addLog(st,
      `${label}：請以「+/-」分配 ${energyIids.length} 張${zh ? `【${zh}】` : ''}能量到 ${validTargets.length} 隻可附目標`,
      aIdx);
    return withPending(st, {
      type: 'energy-distribute',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: energyIids.length, maxCount: energyIids.length,
      effectKey: 'v87-energy-distribute-flat',
      params: {
        label,
        source, // v5.539 thread source → resolver 判斷是否 fire 對手附能被動
        energyIids,
        validIids: validTargets.map(c => c.iid),
        totalCount: energyIids.length,
        placedCount: 0,
        energyTypeName: zh,
      },
    });
  }

  // 多個合法目標 + 混合屬性
  // v3.57：原「逐張 chain」(heal-target picker 一張一張附）→ 改成「按屬性分波」。
  //        例如玩家選了「水1+鬥2」共 3 張，UI 不再彈 3 次 picker，而是：
  //          第 1 波：水能量（共 1 張）→ +/- counter 分配到目標
  //          第 2 波：鬥能量（共 2 張）→ +/- counter 分配到目標
  //        若所有能量同屬性，已在 line 282 的 sameType fast-path 一次解決。
  return dispatchByTypeWaveDistribute(
    st, aIdx,
    energyIids,
    validTargets.map(c => c.iid),
    { label, scope, filterType, source, targetIids },
    pool,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// v3.57：按屬性分波 distribute helper（混屬性多目標的玩家友善 UI）
// ══════════════════════════════════════════════════════════════════════════════
//
// 流程：
//   1. 把 energyIids 按屬性分組 → waves: Array<{typeName, energyIids[]}>
//   2. 開第一波 energy-distribute picker（+/- counter UI 顯示「分配【X】能量」）
//   3. resolver 處理該波 attach；若 waves 還有剩餘 → 開下一波 picker
//
function groupEnergyIidsByType(
  energyIids: string[],
  energiesInDiscard: CardInstance[],
  pool: Map<string, Card>,
): Array<{ typeName: string; energyIids: string[] }> {
  // 卡名對中文屬性的查表（pokemonType 不可靠，scraper 部分基本能量沒填）
  const nameToZh = (name: string): string => {
    if (name.includes('【草】')) return '草';
    if (name.includes('【火】')) return '火';
    if (name.includes('【水】')) return '水';
    if (name.includes('【雷】')) return '雷';
    if (name.includes('【超】')) return '超';
    if (name.includes('【鬥】')) return '鬥';
    if (name.includes('【惡】')) return '惡';
    if (name.includes('【鋼】')) return '鋼';
    if (name.includes('【龍】')) return '龍';
    if (name.includes('【無】')) return '無';
    if (name.includes('【妖】')) return '妖';
    return '?';
  };
  const groups = new Map<string, string[]>();
  for (const iid of energyIids) {
    const inst = energiesInDiscard.find(c => c.iid === iid);
    if (!inst) continue;
    const card = pool.get(inst.cardId);
    if (!card) continue;
    const enType = (card.pokemonType as SingleType | undefined);
    const zh = enType ? (ZH_BY_TYPE[enType] ?? nameToZh(card.name)) : nameToZh(card.name);
    if (!groups.has(zh)) groups.set(zh, []);
    groups.get(zh)!.push(iid);
  }
  // 維持 [水, 鬥, ...] 的插入順序（玩家在 deck-search 點擊順序）
  return Array.from(groups, ([typeName, ids]) => ({ typeName, energyIids: ids }));
}

function dispatchByTypeWaveDistribute(
  st: GameState,
  aIdx: 0 | 1,
  energyIids: string[],
  validIids: string[],
  opts: { label: string; scope: 'bench-only' | 'any-own'; filterType: EnergyTypeFilter; source?: 'deck' | 'discard' | 'hand'; targetIids?: string[] },
  pool: Map<string, Card>,
): GameState {
  const energyInsts = st.players[aIdx].discard.filter(c => energyIids.includes(c.iid));
  const waves = groupEnergyIidsByType(energyIids, energyInsts, pool);
  if (waves.length === 0) {
    return addLog(st, `${opts.label}：能量分組失敗，能量留在棄牌區`, aIdx);
  }
  const [first, ...rest] = waves;
  const tail = first.energyIids.length > 1 ? `（共 ${first.energyIids.length} 張）` : '';
  st = addLog(st,
    `${opts.label}：請以「+/-」分配【${first.typeName}】能量到 ${validIids.length} 個合法目標${tail}` +
    (rest.length > 0 ? `（之後還有 ${rest.length} 種屬性待分配）` : ''),
    aIdx);
  return withPending(st, {
    type: 'energy-distribute',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: first.energyIids.length, maxCount: first.energyIids.length,
    effectKey: 'v357-multi-type-distribute-wave',
    params: {
      label: opts.label,
      scope: opts.scope,
      filterType: opts.filterType,
      source: opts.source, // v5.539 thread source
      targetIids: opts.targetIids, // v5.823 thread 標籤目標到各波
      energyIids: first.energyIids,
      currentTypeName: first.typeName,
      remainingWaves: rest,
      validIids,
      totalCount: first.energyIids.length,
      placedCount: 0,
      energyTypeName: first.typeName,
    },
  });
}

// resolver：處理當前波的 attach；若還有 remainingWaves → 開下一波
regR('v357-multi-type-distribute-wave', (st, aIdx, selectedIids, params, pool) => {
  const label = String(params?.label ?? '能量分配');
  const scope = (params?.scope as 'bench-only' | 'any-own') ?? 'any-own';
  const filterType = (params?.filterType as EnergyTypeFilter | undefined) ?? 'Any';
  const currentEnergyIids = ((params?.energyIids as string[] | undefined) ?? []).slice();
  const currentTypeName = String(params?.currentTypeName ?? '');
  const remainingWaves = ((params?.remainingWaves as Array<{ typeName: string; energyIids: string[] }> | undefined) ?? []).slice();
  const targetIids = params?.targetIids as string[] | undefined; // v5.823 標籤型目標白名單

  if (selectedIids.length === 0 || currentEnergyIids.length === 0) {
    st = addLog(st, `${label}：未分配【${currentTypeName}】能量；剩餘留在棄牌區`, aIdx);
  } else {
    const useCount = Math.min(selectedIids.length, currentEnergyIids.length);
    const tally = new Map<string, number>();
    // v6.083 公平性：同 v87-energy-distribute-flat —— targetIids 白名單要在 attach 端強制，
    //   原本只拿來算「下一波的候選」，本波的 attach 沒驗（改造 client 可附給白名單外的寶可夢）。
    const allowSetW = Array.isArray(targetIids) ? new Set(targetIids) : null;
    for (let i = 0; i < useCount; i++) {
      const targetIid = selectedIids[i];
      if (allowSetW && !allowSetW.has(targetIid)) continue;
      const energyIid = currentEnergyIids[i];
      const p = st.players[aIdx];
      const energyInst = p.discard.find(c => c.iid === energyIid);
      if (!energyInst) continue;
      const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
      if (!target) continue;
      st = updatePlayer(st, aIdx, pl => {
        const restDiscard = pl.discard.filter(c => c.iid !== energyIid);
        const attach = (poke: CardInstance) => poke.iid === targetIid
          ? { ...poke, energyAttached: [...poke.energyAttached, energyInst] } : poke;
        return {
          ...pl, discard: restDiscard,
          active: pl.active ? attach(pl.active) : pl.active,
          bench: pl.bench.map(attach),
        };
      });
      tally.set(targetIid, (tally.get(targetIid) ?? 0) + 1);
    }
    // v5.539：從手牌附能 → 觸發對手附能被動
    // v6.164：per-energy-card（tally = 這隻拿了幾張）
    if (params?.source === 'hand') {
      // v6.164：自方自動治癒＋對手附能反應，兩者都 per-energy-card
      for (const [iid, n] of tally) st = fireOnHandEnergyAttached(applyMagearnaHandAttachHeal(st, aIdx, [iid], pool, n), aIdx, iid, pool, n);
    }
    const parts: string[] = [];
    for (const [iid, n] of tally) {
      const player = st.players[aIdx];
      const tInst = player.active?.iid === iid ? player.active : player.bench.find(c => c.iid === iid);
      const name = tInst ? (pool.get(tInst.cardId)?.name ?? '?') : '?';
      parts.push(`${name}×${n}`);
    }
    if (parts.length > 0) {
      st = addLog(st, `${label}：${parts.join('、')}（【${currentTypeName}】能量 ${useCount} 張）`, aIdx);
    }
  }

  // 還有下一波 → 重算合法目標、發下一波 picker
  if (remainingWaves.length === 0) return st;
  const candidates: CardInstance[] = [];
  if (scope === 'any-own') {
    if (st.players[aIdx].active) candidates.push(st.players[aIdx].active!);
  }
  for (const b of st.players[aIdx].bench) candidates.push(b);
  const nextValid = candidates
    .filter(c => pokemonMatchesType(st, aIdx, c, pool.get(c.cardId), pool, filterType) && (!targetIids || targetIids.includes(c.iid)))
    .map(c => c.iid);
  if (nextValid.length === 0) {
    const totalLeft = remainingWaves.reduce((n, w) => n + w.energyIids.length, 0);
    return addLog(st, `${label}：場上已無合法目標，剩 ${totalLeft} 張能量留在棄牌區`, aIdx);
  }
  const [next, ...rest] = remainingWaves;
  const tailMsg = next.energyIids.length > 1 ? `（共 ${next.energyIids.length} 張）` : '';
  st = addLog(st,
    `${label}：接著分配【${next.typeName}】能量到 ${nextValid.length} 個合法目標${tailMsg}` +
    (rest.length > 0 ? `（之後還有 ${rest.length} 種屬性待分配）` : ''),
    aIdx);
  return withPending(st, {
    type: 'energy-distribute',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: next.energyIids.length, maxCount: next.energyIids.length,
    effectKey: 'v357-multi-type-distribute-wave',
    params: {
      label, scope, filterType,
      source: params?.source, // v5.539 thread source 到下一波
      targetIids, // v5.823 thread 標籤目標到下一波
      energyIids: next.energyIids,
      currentTypeName: next.typeName,
      remainingWaves: rest,
      validIids: nextValid,
      totalCount: next.energyIids.length,
      placedCount: 0,
      energyTypeName: next.typeName,
    },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Entry：玩家完成能量挑選後 picker resolve → 啟動 chain（薄殼，呼叫 helper）
// ══════════════════════════════════════════════════════════════════════════════
//
// 呼叫方應 withPending({
//   type: 'deck-search'|'discard-search',
//   filter: ...能量 filter...,
//   minCount: 0, maxCount: N,
//   effectKey: 'v158-energy-chain-start',
//   params: { label, source, scope, filterType? }
// })
//
/**
 * ⭐ v6.105：單一目標附能的 resolver（卡面「附於自己的 1 隻寶可夢身上」）。
 * 把 params.energyIids 全部從 attacker.discard 搬到玩家選的那一隻身上。
 * ⚠ 公平性：只認 params.validIids 白名單內的目標（client 送來的 iid 一律重驗，
 *   同 v6.009 的 resolver 自驗原則）。
 */
regR('v158-energy-single-target-attach', (st, aIdx, pickedIids, params, pool) => {
  const label = String(params?.label ?? '附加能量');
  const energyIids = (params?.energyIids as string[] | undefined) ?? [];
  const validIids = (params?.validIids as string[] | undefined) ?? [];
  const source = params?.source as 'deck' | 'discard' | 'hand' | undefined;
  const targetIid = pickedIids[0];
  if (!targetIid || energyIids.length === 0) {
    return addLog(st, `${label}：未選擇目標，能量留在棄牌區`, aIdx);
  }
  if (validIids.length > 0 && !validIids.includes(targetIid)) {
    return addLog(st, `${label}：選擇的目標不合法，能量留在棄牌區`, aIdx);
  }
  const tname = pool.get(
    [st.players[aIdx].active, ...st.players[aIdx].bench].find(c => c?.iid === targetIid)?.cardId ?? ''
  )?.name ?? '?';
  st = updatePlayer(st, aIdx, p => {
    const energies = p.discard.filter(c => energyIids.includes(c.iid));
    const remDiscard = p.discard.filter(c => !energyIids.includes(c.iid));
    const attach = (poke: CardInstance) => poke.iid === targetIid
      ? { ...poke, energyAttached: [...poke.energyAttached, ...energies] }
      : poke;
    return {
      ...p,
      discard: remDiscard,
      active: p.active ? attach(p.active) : p.active,
      bench: p.bench.map(attach),
    };
  });
  // v5.539：從手牌附能要觸發對手的附能反應被動（耿鬼ex｜侵蝕詛咒 等）
  // v6.164：singleTarget 全附型 —— 一次附 energyIids.length 張 ⇒ per-energy-card
  if (source === 'hand') st = fireOnHandEnergyAttached(applyMagearnaHandAttachHeal(st, aIdx, [targetIid], pool, energyIids.length), aIdx, targetIid, pool, energyIids.length); // v6.164 heal+fire 皆 per-card
  return addLog(st, `${label}：${energyIids.length} 張能量全部附到 ${tname}`, aIdx);
});

regR('v158-energy-chain-start', (st, aIdx, energyIids, params, pool) => {
  return startEnergyChain(st, aIdx, energyIids, {
    label: String(params?.label ?? '招式'),
    // v3.12: 多支援 'hand' source
    source: (params?.source as 'deck' | 'discard' | 'hand') ?? 'deck',
    scope: (params?.scope as 'bench-only' | 'any-own') ?? 'any-own',
    filterType: params?.filterType as EnergyTypeFilter | undefined,
    // v6.105：卡面「附於自己的 1 隻寶可夢」→ 全部附同一隻（見 EnergyChainOpts.singleTarget）
    singleTarget: params?.singleTarget === true,
    // v6.081：可附目標白名單（卡面指名寶可夢／限屬性時用）。undefined = 不限（舊行為）。
    //   例：鴨嘴炎獸｜拍檔提升 只能附「電擊魔獸」「鴨嘴炎獸」；杖尾鱗甲龍｜鱗片律動 只能附【龍】。
    targetIids: params?.targetIids as string[] | undefined,
  }, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// Chain step：picker 選完目標 → 附 1 張能量；若還有剩餘 → 遞迴下一個 picker
// ══════════════════════════════════════════════════════════════════════════════
regR('v158-energy-chain-attach', (st, aIdx, iids, params, pool) => {
  const label = String(params?.label ?? '招式');
  const scope = (params?.scope as 'bench-only' | 'any-own') ?? 'any-own';
  const filterType = (params?.filterType as EnergyTypeFilter | undefined) ?? 'Any';
  const currentEnergy = String(params?.currentEnergy ?? '');
  const remainingEnergies = (params?.remainingEnergies as string[]) ?? [];
  const targetIid = iids[0];

  // 場上找目標
  const player = st.players[aIdx];
  const target = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid);
  const energyInst = player.discard.find(c => c.iid === currentEnergy);

  if (!target || !energyInst) {
    // 防呆：目標或能量已不存在
    return addLog(st, `${label}：目標或能量遺失，略過此張`, aIdx);
  }

  // 檢查 filter（玩家不應選不合法的目標，但仍校驗）
  const tcard = pool.get(target.cardId);
  if (!pokemonMatchesType(st, aIdx, target, tcard, pool, filterType)) {
    return addLog(st, `${label}：${tcard?.name ?? '?'} 不符屬性 filter，略過此張`, aIdx);
  }

  // 把能量從 discard 移到目標
  st = updatePlayer(st, aIdx, p => {
    const newDiscard = p.discard.filter(c => c.iid !== currentEnergy);
    const attach = (poke: CardInstance) => poke.iid === targetIid
      ? { ...poke, energyAttached: [...poke.energyAttached, energyInst] }
      : poke;
    return {
      ...p,
      discard: newDiscard,
      active: p.active ? attach(p.active) : p.active,
      bench: p.bench.map(attach),
    };
  });
  st = addLog(st, `${label}：1 張能量附到 ${tcard?.name ?? '?'}`, aIdx);

  // 還有剩餘能量 → 開下一個 picker
  if (remainingEnergies.length === 0) return st;

  // 重新計算合法目標（因為前面附完可能不變但仍 defensive）
  const candidates: CardInstance[] = [];
  if (scope === 'any-own') {
    if (st.players[aIdx].active) candidates.push(st.players[aIdx].active!);
  }
  for (const b of st.players[aIdx].bench) candidates.push(b);
  const validTargets = candidates.filter(c => pokemonMatchesType(st, aIdx, c, pool.get(c.cardId), pool, filterType));

  if (validTargets.length === 0) {
    return addLog(st, `${label}：場上已無合法目標，剩 ${remainingEnergies.length} 張能量留在棄牌區`, aIdx);
  }
  if (validTargets.length === 1) {
    const onlyTarget = validTargets[0];
    const oname = pool.get(onlyTarget.cardId)?.name ?? '?';
    st = updatePlayer(st, aIdx, p => {
      const energies = p.discard.filter(c => remainingEnergies.includes(c.iid));
      const remDiscard = p.discard.filter(c => !remainingEnergies.includes(c.iid));
      const attach = (poke: CardInstance) => poke.iid === onlyTarget.iid
        ? { ...poke, energyAttached: [...poke.energyAttached, ...energies] }
        : poke;
      return {
        ...p,
        discard: remDiscard,
        active: p.active ? attach(p.active) : p.active,
        bench: p.bench.map(attach),
      };
    });
    return addLog(st, `${label}：場上僅剩 1 個合法目標 → 剩 ${remainingEnergies.length} 張能量全附到 ${oname}`, aIdx);
  }

  // 多目標 → 對下一張開 picker（chain）
  const next = remainingEnergies[0];
  const rest = remainingEnergies.slice(1);
  // 查出下一張能量的卡名，用於 UI 標頭
  const nextEnergyInDiscard = st.players[aIdx].discard.find(c => c.iid === next);
  const nextEnergyCardName = nextEnergyInDiscard ? (pool.get(nextEnergyInDiscard.cardId)?.name ?? '能量') : '能量';
  st = addLog(st, `${label}：選擇下一張能量目標（剩 ${remainingEnergies.length} 張待附）`, aIdx);
  return withPending(st, {
    type: scope === 'bench-only' ? 'bench-choose' : 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v158-energy-chain-attach',
    params: {
      label, scope, filterType,
      currentEnergy: next,
      remainingEnergies: rest,
      titleOverride: `${label}：將「${nextEnergyCardName}」附到哪一隻寶可夢？`,
    },
  });
});

// 防止「unused import」warning（reg/regG/regA 被 import 是為了未來可能加掛點）
void reg; void regG; void regA;
