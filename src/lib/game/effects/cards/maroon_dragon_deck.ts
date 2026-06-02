/**
 * 魔靈多龍牌組 Wave 43（Session 38ay 原批）— v2.65 模組化搬遷
 *
 * 涵蓋卡：
 *   - 喵喵ex｜殺手鐧捕捉（BENCH_PLACE_TRIGGERS：上備戰時從牌庫搜支援者）
 *   - 黑夜魔靈｜咒詛炸彈（regA，13 counter；v2.95 起 attack-style 變體全移除）
 *   - 多龍奇｜偵查指令（regA：查看牌庫上方 2 張選 1 加手牌，其餘放回下方）
 *   - 願增猿｜腎上腺腦力（regA：從自己 1 隻受傷寶可夢搬 ≤30 傷害到對手 1 隻寶可夢）
 *   - 特殊紅牌（Item + guard：對手剩餘獎賞 ≤3 才能用 → 對手洗回手牌抽 3）
 *   - 阿蜜的目光（Supporter + guard：戰鬥位寶可夢下次受招式 -30）
 *
 * 對 effects.ts 的硬依賴（從 '../../effects' 取用）：
 *   - findAbilityUserIid / selfKOInstance / koPrizeCount
 * 這些 helper 還留在 effects.ts 頂層（日後再統一搬）。
 *
 * 循環 import 安全：effects.ts 的 top-level `export function` 宣告完成後，
 * 才會執行本檔的 side-effect import（在 effects.ts 頂部集中 `import './effects/cards/...'`），
 * 且上列 helper 只在 regA / regPre / regPost 的 callback 裡被呼叫，不在模組求值時被呼叫。
 */

import type { GameState, PlayerState, CardInstance } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import {
  reg, regR, regG, regA,
  BENCH_PLACE_TRIGGERS,
  addLog, addPrivateLog, drawCards, updatePlayer, returnHandToDeck, withPending, shuffle,
  recordOppKO,
  isAbilityBlockedByOakEye,
} from '../_shared';
import {
  findAbilityUserIid,
  selfKOInstance,
  koPrizeCount,
  isBenchProtected,
} from '../../effects';
import { getEffectiveHP } from '../../engine';  // v5.091
import { addPendingPrize } from '../_shared';

// ── 喵喵ex｜殺手鐧捕捉 — v2.320 改為 promptPlayAbilities 互動提示 ──────────
// 原本在 BENCH_PLACE_TRIGGERS 自動觸發；現改為 regA 路徑，
// 由 promptPlayAbilities 詢問玩家後呼叫。
// 注意：v2306_meta_pokemon.ts 中有另一個以 '喵喵ex|殺手鐧捕捉' 為 key 的版本，
//       但 engine 用的是 pokemonName|abilityIndex（'喵喵ex|0'），所以以本 regA 為準。
regA('喵喵ex', 0, (st, aIdx, pool, inst) => {
  const p = st.players[aIdx];
  if (p.abilityNamesUsedThisTurn?.includes('殺手鐧捕捉')) {
    return addLog(st, '殺手鐧捕捉：這個回合已經使用過「殺手鐧捕捉」，無法再使用', aIdx);
  }
  if (p.deck.length === 0) {
    return addLog(st, '殺手鐧捕捉：牌庫為空', aIdx);
  }
  const instInPlay = p.active?.iid === inst?.iid ? p.active : p.bench.find(c => c.iid === inst?.iid);
  if (instInPlay) instInPlay.abilityUsedThisTurn = true;
  let s = updatePlayer(st, aIdx, pl => ({
    ...pl, abilityNamesUsedThisTurn: [...(pl.abilityNamesUsedThisTurn ?? []), '殺手鐧捕捉']
  }));
  s = addLog(s, '喵喵ex：使用特性「殺手鐧捕捉」，從牌庫選擇 1 張支援者加入手牌', aIdx);
  return withPending(s, {
    type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx, minCount: 0, maxCount: 1,  // v3.996：玩家可不選
    filter: 'Trainer:Supporter', effectKey: 'meowth-ex-trump-catch',
  });
});

// ── 黑夜魔靈｜咒詛炸彈 — 13 counter ──────────────────────────────────────────
// v2.95：JSON migration 後 abilities[0]={name:'咒詛炸彈'} 統一存在，attack-style
// ZWJ 變體註冊全數移除。
// v5.074：用第 4 參數 cardInst.iid 取代 findAbilityUserIid（同回合 2 隻時不誤判）
regA('黑夜魔靈', 0, (st, aIdx, pool, cardInst) => {
  const userIid = cardInst?.iid;
  if (!userIid) return st;
  const dIdx = (1 - aIdx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active && dp.bench.length === 0) {
    return selfKOInstance(addLog(st, '咒詛炸彈：對手無可選寶可夢', aIdx),
      aIdx, userIid, pool, '咒詛炸彈');
  }
  const s = addLog(st, '咒詛炸彈：選 1 隻對手寶可夢放 13 個傷害指示物', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'cursed-bomb',
    params: { label: '咒詛炸彈', userIid, includeActive: true, counters: 13 },
  });
});

// ── 多龍奇｜偵查指令 ─────────────────────────────────────────────────────────
// 一回合一次：查看牌庫上方 2 張，選 1 張加手牌，其餘放回牌庫下方（不洗牌）。
// v2.07：原實作用 TOP3（slice(0,3)）且 filter 字串 'TOP3' 在 +page.svelte / ai.ts
//        沒註冊，fallback 到「顯示整個牌庫」→ 玩家可以從整副牌庫任選；同時結尾
//        用 shuffle() 把剩餘塞回整副牌庫也錯了（應放回下方）。
//        正確卡面：查看上方 2 張，選其中 1 張加手牌，剩餘放回牌庫下方。
regA('多龍奇', 0, (st, idx) => {
  const p = st.players[idx];
  const top2 = p.deck.slice(0, 2);
  if (top2.length === 0) return addLog(st, '偵查指令：牌庫為空', idx);
  st = addLog(st, `偵查指令：查看牌庫上方 ${top2.length} 張，選 1 張加手牌，其餘放回牌庫下方`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TOP2',
    minCount: 1, maxCount: 1,
    effectKey: 'scouting-order',
    params: { top2Iids: top2.map(c => c.iid) },
  });
});

regR('scouting-order', (st, idx, iids, params, pool) => {
  const top2Iids = (params?.top2Iids as string[]) ?? [];
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    // v3.14 修 Rule 8：卡面無「給對手看過」字樣 → 對手不應看到具體卡名。
    //   原 addLog 公開卡名違反 PTCG 規則「未揭示資訊」原則。改用 addPrivateLog：
    //   privateMsg（本人）顯示卡名；publicMsg（對手）只顯示張數。
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addPrivateLog(st,
      `偵查指令：將 ${names} 加入手牌（剩餘放回牌庫下方）`,
      `偵查指令：將 ${chosen.length} 張卡加入手牌（剩餘放回牌庫下方）`,
      idx);
  } else {
    st = addLog(st, '偵查指令：未選取任何卡（全數放回牌庫下方）', idx);
  }
  return updatePlayer(st, idx, (p) => {
    const top2 = p.deck.filter(c => top2Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top2Iids.includes(c.iid));
    const picked = top2.filter(c => iids.includes(c.iid));
    const remaining = top2.filter(c => !iids.includes(c.iid));
    // 剩餘牌放回牌庫下方（不洗牌）：rest（原本 top2 以下的部分） + remaining
    return {
      ...p,
      deck: [...rest, ...remaining],
      hand: [...p.hand, ...picked],
    };
  });
});

// ── 願增猿｜腎上腺腦力 ───────────────────────────────────────────────────────
// 一回合一次：從自己 1 隻受傷寶可夢身上移動最多 3 個傷害指示物（= 最多 30 傷害）
// 到對手 1 隻寶可夢身上。轉移數量 = min(來源目前傷害, 30)。
// 例：來源 20 傷害 → 轉 20（來源回 20、對手 +20）；來源 60 傷害 → 轉 30（上限）。
// 若因此將對手寶可夢擊倒，等同於一般取獎賞流程（defender 下回合可用不公印章等
// 「自己寶可夢上回合昏厥」類 gate，因為 oppPrizesAtMyLastTurnEnd 快照會偵測到）。
// 流程：
//   1. heal-target：選「身上有 ≥10 傷害」的己方寶可夢 → 根據當前傷害計算轉移量
//   2. opp-poke-choose：選對手 1 隻寶可夢 → +轉移量 傷害（含 KO 判定）
regA('願增猿', 0, (st, idx, pool) => {
  // v2.372 探探鼠｜監視之眼 — 改用 _shared.ts 的通用標籤判定（MOVE_DAMAGE_COUNTER_ABILITIES）
  if (isAbilityBlockedByOakEye(st, '腎上腺腦力', pool)) {
    return addLog(st, '腎上腺腦力：被探探鼠的監視之眼消除（傷害指示物無法改放）', idx);
  }
  const p = st.players[idx];
  const self = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  const sources = self.filter(c => c.damage >= 10);
  if (sources.length === 0) {
    return addLog(st, '腎上腺腦力：場上沒有受傷（≥10 傷害）的寶可夢', idx);
  }
  const dp = st.players[(1 - idx) as 0 | 1];
  if (!dp.active && dp.bench.length === 0) {
    return addLog(st, '腎上腺腦力：對手場上無寶可夢', idx);
  }
  st = addLog(st, '腎上腺腦力：選 1 隻受傷（≥10 傷害）的己方寶可夢', idx);
  return withPending(st, {
    type: 'heal-target', // 複用 heal-target UI（讓玩家選自己場上的寶可夢）
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'adrenal-brain-src',
    params: { validIids: sources.map(c => c.iid) },
  });
});

regR('adrenal-brain-src', (st, idx, iids, params, pool) => {
  const validIids = (params?.validIids as string[]) ?? [];
  const targetIid = iids[0];
  if (!targetIid || !validIids.includes(targetIid)) {
    return addLog(st, '腎上腺腦力：目標不合法', idx);
  }
  const p = st.players[idx];
  const source = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!source) return st;
  const maxCounters = Math.min(Math.floor(source.damage / 10), 3);
  if (maxCounters <= 0) {
    return addLog(st, '腎上腺腦力：來源傷害不足（無 counter 可搬）', idx);
  }
  const sourceName = pool.get(source.cardId)?.name ?? '?';
  // v3.874：玩家自選要搬 1~maxCounters 個指示物（恢復 v3.14 設計、replacing v3.711 全搬）
  //   卡面「選擇最多 3 個傷害指示物」— 「最多」是玩家可選的上限，不是強制全搬。
  //   開 modal-choice + stepper picker → resolver 'adrenal-brain-count' 讀 iids[0] 為 count
  //   數字並接力開「對手寶可夢目標」picker。範圍只在來源 1 隻寶可夢（無法跨多隻）。
  let s = addLog(st, `腎上腺腦力：${sourceName} 身上有 ${source.damage} 傷害，請選擇搬幾個指示物（1~${maxCounters}）`, idx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'adrenal-brain-count',
    params: {
      label: `腎上腺腦力：要從 ${sourceName} 身上搬幾個傷害指示物到對手？（1~${maxCounters}，每個 = 10 傷害）`,
      stepper: { min: 1, max: maxCounters, step: 1, init: maxCounters },
      sourceIid: targetIid,
      sourceName,
    },
  });
});

regR('adrenal-brain-count', (st, idx, iids, params, pool) => {
  const choice = iids[0];
  const sourceIid = (params?.sourceIid as string) ?? '';
  const sourceName = (params?.sourceName as string) ?? '?';
  const count = parseInt(choice ?? '1', 10) || 1;
  if (!sourceIid) return st;
  return _adrenalCountChosen(st, idx, sourceIid, sourceName, count, pool);
});

// helper：搬移 N 個指示物 → 接「選對手 1 隻」
function _adrenalCountChosen(
  st: GameState, idx: 0 | 1, sourceIid: string, sourceName: string, count: number,
  _pool: Map<string, import('$lib/cards/types').Card>,
): GameState {
  const amount = count * 10;
  let s = st;
  s = addLog(s, `腎上腺腦力：從 ${sourceName} 身上移除 ${amount} 傷害（回復 ${amount} HP）`, idx);
  s = updatePlayer(s, idx, pl => {
    if (pl.active && pl.active.iid === sourceIid) {
      return { ...pl, active: { ...pl.active, damage: Math.max(0, pl.active.damage - amount) } };
    }
    return { ...pl,
      bench: pl.bench.map(c => c.iid === sourceIid ? { ...c, damage: Math.max(0, c.damage - amount) } : c) };
  });
  const dIdx = (1 - idx) as 0 | 1;
  const dp = s.players[dIdx];
  if (!dp.active && dp.bench.length === 0) {
    return addLog(s, '腎上腺腦力：對手無可選寶可夢（效果中斷）', idx);
  }
  s = addLog(s, `腎上腺腦力：選對手 1 隻寶可夢 +${amount} 傷害`, idx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'adrenal-brain-target',
    params: { includeActive: true, amount },
  });
}

regR('adrenal-brain-target', (st, actorIdx, iids, params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const defender = st.players[dIdx];
  const targetIid = iids[0];
  if (!targetIid) return st;
  const isActive = defender.active?.iid === targetIid;
  const target = isActive ? defender.active! : defender.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const targetCard = pool.get(target.cardId);
  // v4.51 Phase 2：改用統一 canApplyEffectToTarget（kind='ability-effect'）— 涵蓋光之翼 + 對戰圓形
  const _adrenalGuard = canApplyEffectToTarget(st, actorIdx, target, targetCard, 'ability-effect', pool, { isBench: !isActive });
  if (_adrenalGuard.blocked) {
    return addLog(st,
      `腎上腺腦力：${targetCard?.name ?? '?'} ${_adrenalGuard.reason}（已回復來源傷害）`,
      actorIdx);
  }
  // v5.091: 用 getEffectiveHP 含夠讚狗腎上腺力量等 +HP 修正
  const tHp = getEffectiveHP(target, pool, st);
  const amount = (params?.amount as number) ?? 30;
  const newDmg = target.damage + amount;
  let s: GameState = st;
  if (tHp > 0 && newDmg >= tHp) {
    const koDiscard: CardInstance[] = [
      { ...target, damage: newDmg },
      ...target.energyAttached,
      ...(target.toolAttached ? [target.toolAttached] : []),
      ...(target.evolvedFromStack ?? []),
    ];
    const prizes = targetCard ? koPrizeCount(targetCard) : 1;
    const players = [...s.players] as [PlayerState, PlayerState];
    const newDefender: PlayerState = {
      ...defender,
      discard: [...defender.discard, ...koDiscard],
      active: isActive ? null : defender.active,
      bench: isActive ? defender.bench : defender.bench.filter(c => c.iid !== targetIid),
    };
    players[dIdx] = newDefender;
    s = addLog({ ...s, players },
      `腎上腺腦力：在 ${targetCard?.name ?? '?'} 身上放 ${amount} 傷害 → 被擊倒！+${prizes} 張獎賞卡`, actorIdx);
    s = addPendingPrize(s, actorIdx, prizes);
    // v2.246：腎上腺腦力是「對手主動特性 KO」
    s = recordOppKO(s, dIdx, targetCard, 'ability');
    if (isActive && newDefender.bench.length === 0) {
      return { ...s, phase: 'game-over', winner: actorIdx,
        winReason: `${defender.name} 沒有可上場的寶可夢` };
    }
  } else {
    const players = [...s.players] as [PlayerState, PlayerState];
    const newDefender = { ...defender };
    if (isActive) newDefender.active = { ...target, damage: newDmg };
    else newDefender.bench = defender.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c);
    players[dIdx] = newDefender;
    s = addLog({ ...s, players },
      `腎上腺腦力：在 ${targetCard?.name ?? '?'} 身上放 ${amount} 傷害`, actorIdx);
  }
  return s;
});

// ── 特殊紅牌（Item） ────────────────────────────────────────────────────────
// 原文：這張卡只有在對手剩餘獎賞卡的張數為 3 張以下時才可使用。
// 效果：對手手牌洗回牌庫，抽 3 張。
regG('特殊紅牌', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  return st.players[oppIdx].prizes.length <= 3;
});
reg('特殊紅牌', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  if (st.players[dIdx].prizes.length > 3) {
    return addLog(st, '特殊紅牌：對手剩餘獎賞卡超過 3 張，無法使用', idx);
  }
  // v4.08 修：卡面「對手將對手自己的手牌全部翻回反面並重洗，放回牌庫下方」
  //   原用 returnHandToDeck 會把 hand+deck 一起 shuffle（手牌混進牌庫各處），
  //   違反卡面「放回牌庫下方」。改用 inline：hand 內部 shuffle 後 append 到 deck 末端。
  st = addLog(st, '特殊紅牌：對手手牌重洗後放回牌庫下方，並抽 3 張', idx);
  st = updatePlayer(st, dIdx, p => ({
    ...p,
    deck: [...p.deck, ...shuffle(p.hand)],
    hand: [],
  }));
  return drawCards(st, dIdx, 3);
});

// ── 阿蜜的目光（Supporter） ─────────────────────────────────────────────────
// 本回合結束後，你的戰鬥位寶可夢下次受到招式傷害 -30（套用 damageReduceNextHit）。
regG('阿蜜的目光', (st, idx) => !!st.players[idx].active);
reg('阿蜜的目光', (st, idx, pool) => {
  const p = st.players[idx];
  if (!p.active) return addLog(st, '阿蜜的目光：戰鬥位沒有寶可夢', idx);
  const activeName = pool.get(p.active.cardId)?.name ?? '戰鬥位寶可夢';
  st = addLog(st, `阿蜜的目光：${activeName} 下次受到招式傷害 -30`, idx);
  return updatePlayer(st, idx, pl => {
    if (!pl.active) return pl;
    return { ...pl, active: { ...pl.active, damageReduceNextHit: 30 } };
  });
});
