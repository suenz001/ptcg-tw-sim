/**
 * 物品卡（Item）雜項群 — 模組化批次 v2.24 (Session 38bd)
 *
 * 原位於 effects.ts 107-499 行：
 *   - 切換類：寶可夢交替 / 急進開關 / 頂尖捕捉器
 *   - 藥水/回復：好傷藥 / 龍之秘藥
 *   - 棄牌區回收：夜間擔架 / 能量回收器 / 奇跡修正檔
 *   - 其他：不公印章
 *
 * 這些卡都是訓練家（Item），只依賴 _shared.ts 匯出的 reg / regR / regG / helper，
 * 不涉及攻擊系統 / 特性 / 道具 Tool / Stadium / 被動減傷等機制，byte-exact 搬運。
 *
 * Resolvers 集合：
 *   - do-switch        （被寶可夢交替 / 急進開關 / 頂尖捕捉器 尾段共用）
 *   - heal-60-discard-1 / heal-120（共用 healResolver）
 *   - discard-to-hand  （夜間擔架）
 *   - energy-retrieval （能量回收器）
 *   - miracle-codec-energy / miracle-codec-attach（奇跡修正檔兩步）
 *   - top-catcher-opp  （頂尖捕捉器第一步，尾段續接 do-switch）
 */

import {
  reg, regR, regG,
  addLog, addPrivateLog, updatePlayer, withPending,
  shuffle,
  drawCards, returnHandToDeck,
  clearActiveEffects,
  healResolver,
  getOwnBenchLimit,
} from '../_shared';
import { hasEffectivePokemonType } from '../../effects';  // v6.207 中央「場上有效屬性」述詞
import { joinCardNames, abilityUsedAfterSwap, toBareCard, buildDevolvedInstance } from '../_shared'; // v5.993 rescue 回牌庫裸化 + v6.020 buildDevolvedInstance(修奇異時鐘 TS2304 runtime 炸彈)
import { tryPromptPromoteActive } from '../_shared';
import { promoteOppBenchToActive } from '../_shared';  // ⭐ v6.174 換場目標解析失敗一律 no-op + 據實 log
import { deckWithCardsToBottom } from '../_shared'; // v6.124 「重洗放回牌庫下方」中央管線
import { logPickedCards } from '../_shared'; // v6.097 揭示卡名中央來源
// v3.06 對手 trainer 免疫 helper（斧牙龍｜緊張感 / 浩大鯨ex｜融合為雪）
import { isImmuneToOppTrainer as _v3060IsImmuneOppTrainer } from './v3060_deferred_wave_b';
// v3.08 美納斯｜平穩境地 — 阻擋對手寶可夢/附加卡 → 對手手牌
import { isReturnToHandBlockedByCalmGround as _calmGroundBlocks } from './v3080_deferred_wave_c'; // v5.985 傳「被回手卡持有者」idx
import type { EffectFn } from '../_shared';
import { flipCoinsWithLog } from '../../effects';
import { applyOppActiveReturnedToBenchTriggers } from '../../engine'; // v5.831
import type { CardInstance, GameState } from '../../types';
import type { Card } from '$lib/cards/types'; // v5.861 重新啟動箱逐張分配 chain 型別
import { isBasicEnergyOfType } from '../../selection-filter'; // v6.210：基本能量屬性判定收斂中央述詞（leaf，Check O 安全）

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 切換
// ══════════════════════════════════════════════════════════════════════════════

function switchEffect(label: string): EffectFn {
  return (st, idx) => {
    const player = st.players[idx];
    if (!player.active || player.bench.length === 0) {
      return addLog(st, `${label}：備戰區沒有寶可夢，無法切換`, idx);
    }
    st = addLog(st, `${label}：選擇換入的備戰寶可夢`, idx);
    return withPending(st, {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'do-switch',
    });
  };
}
reg('寶可夢交替', switchEffect('寶可夢交替'));
// v3.45：急進開關有「能量轉移」效果，與寶可夢交替不同 — 改用 rushSwitchEffect
reg('急進開關', rushSwitchEffect());
// 切換類：備戰必須有寶可夢
regG('寶可夢交替', (st, idx) => st.players[idx].bench.length > 0);
regG('急進開關', (st, idx) => st.players[idx].bench.length > 0);

regR('do-switch', (st, idx, iids, _params, pool) => {
  const prevPlayer = st.players[idx];
  const target = prevPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = prevPlayer.active ? (pool.get(prevPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `→ 將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場`, idx);
  const _leftPoke = prevPlayer.active;
  let _swapped = updatePlayer(st, idx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    // v3.812：preserve justPlaced + playedFromHand（位置交換不該清除剛打出 flag）
    // v4.978：set movedToActiveThisTurn — 振翅高飛/潔淨支援/金屬之路 等特性 gate 需要
    const newActive = { ...p.bench[bIdx], movedToActiveThisTurn: true };
    const newBench = [...p.bench];
    // v2.08：離開戰鬥場清狀態旗標
    newBench[bIdx] = clearActiveEffects(p.active);
    return { ...p, active: newActive, bench: newBench };
  });
  // v5.852：自我互換/交替的觸發(漩渦言靈/熔岩地域/凹洞)改由 applyActionImpl 中央偵測統一處理。
  void _leftPoke;
  // v5.243：包 tryPromptPromoteActive — 自方換位 ON_PROMOTE_TO_ACTIVE prompt
  return tryPromptPromoteActive(_swapped, idx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// v3.45 急進開關 — 與寶可夢交替不同：交換後額外做「能量轉移」picker
// 卡面：「將自己的戰鬥寶可夢與備戰寶可夢互換。然後，選擇換入備戰區的寶可夢
//   身上附加的任意數量的能量卡，改附於新的戰鬥寶可夢身上。」
// 流程：
//   1. bench-choose：玩家選備戰中的目標
//   2. rush-switch-pick-bench：執行 swap，若舊 active 身上有能量則開 picker
//   3. rush-switch-energy-transfer：把選的能量從 bench(舊 active) 移到新 active
// ══════════════════════════════════════════════════════════════════════════════
function rushSwitchEffect(): EffectFn {
  return (st, idx) => {
    const player = st.players[idx];
    if (!player.active || player.bench.length === 0) {
      return addLog(st, '急進開關：備戰區沒有寶可夢，無法切換', idx);
    }
    st = addLog(st, '急進開關：選擇換入的備戰寶可夢', idx);
    return withPending(st, {
      type: 'bench-choose',
      actorIdx: idx, sourcePlayerIdx: idx,
      minCount: 1, maxCount: 1,
      effectKey: 'rush-switch-pick-bench',
    });
  };
}

regR('rush-switch-pick-bench', (st, idx, iids, _params, pool) => {
  const prevPlayer = st.players[idx];
  if (!prevPlayer.active) return st;
  const prevActiveIid = prevPlayer.active.iid;
  const target = prevPlayer.bench.find(c => c.iid === iids[0]);
  if (!target) return st;
  const newName = pool.get(target.cardId)?.name ?? '?';
  const oldName = pool.get(prevPlayer.active.cardId)?.name ?? '?';
  let s = addLog(st, `急進開關：將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場`, idx);
  // swap（同 do-switch 邏輯）
  s = updatePlayer(s, idx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    // v3.812：preserve justPlaced + playedFromHand（位置交換不該清除剛打出 flag）
    // v4.978：set movedToActiveThisTurn — 振翅高飛/潔淨支援/金屬之路 等特性 gate 需要
    const newActive = { ...p.bench[bIdx], movedToActiveThisTurn: true };
    const newBench = [...p.bench];
    newBench[bIdx] = clearActiveEffects(p.active);
    return { ...p, active: newActive, bench: newBench };
  });
  // 找原 active（現在在 bench），檢查能量數
  const newP = s.players[idx];
  const prevOnBench = newP.bench.find(c => c.iid === prevActiveIid);
  if (!prevOnBench || prevOnBench.energyAttached.length === 0 || !newP.active) {
    return addLog(s, '急進開關：原戰鬥寶可夢身上無能量可轉移', idx);
  }
  // 開 picker：選 0~N 張能量轉移
  const eCount = prevOnBench.energyAttached.length;
  s = addLog(s, `急進開關：選擇要從 ${oldName} 轉移到 ${newName} 的能量（0-${eCount} 張）`, idx);
  return withPending(s, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: eCount,
    effectKey: 'rush-switch-energy-transfer',
    params: {
      targetIid: prevActiveIid,
      newActiveIid: newP.active.iid,
      titleOverride: '急進開關：選擇要轉移到新戰鬥寶可夢的能量',
    },
  });
});

regR('rush-switch-energy-transfer', (st, idx, iids, params, pool) => {
  const fromIid = params?.targetIid as string | undefined;
  const toIid = params?.newActiveIid as string | undefined;
  if (!fromIid || !toIid) return st;
  if (iids.length === 0) {
    return addLog(st, '急進開關：未轉移任何能量', idx);
  }
  const p = st.players[idx];
  const src = p.bench.find(c => c.iid === fromIid);
  if (!src || !p.active || p.active.iid !== toIid) {
    return addLog(st, '急進開關：來源/目標寶可夢已不在預期位置（中斷）', idx);
  }
  const energySet = new Set(iids);
  const toMove = src.energyAttached.filter(e => energySet.has(e.iid));
  if (toMove.length === 0) return st;
  const fromName = pool.get(src.cardId)?.name ?? '?';
  const toName = pool.get(p.active.cardId)?.name ?? '?';
  const s = addLog(st, `急進開關：從 ${fromName} 轉移 ${toMove.length} 張能量到 ${toName}`, idx);
  // v5.244：急進開關能量轉移完成後 ON_PROMOTE_TO_ACTIVE prompt
  return tryPromptPromoteActive(updatePlayer(s, idx, pl => ({
    ...pl,
    active: pl.active ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...toMove] } : null,
    bench: pl.bench.map(b => b.iid === fromIid
      ? { ...b, energyAttached: b.energyAttached.filter(e => !energySet.has(e.iid)) }
      : b),
  })), idx, pool);
});


// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 藥水 / 回復
// ══════════════════════════════════════════════════════════════════════════════

// 好傷藥 — 卡面「將自己的1隻寶可夢恢復60HP。然後，選擇1個恢復的寶可夢身上附加的能量，將其丟棄。」
// v5.425：卡面分 2 段 — 第一段回血（必做）、第二段丟能量（沒能量則略過）。
//   Guard 改成「只要有受傷寶可夢」即可（不再要求有能量）；無能量寶可夢回血後 healResolver 直接 return。
//   reg 傳 validIids=受傷寶可夢，picker 只能選受傷的（順帶修「選沒受傷的卻丟能量」）。
regG('好傷藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('好傷藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  const damagedIids = all.filter(c => c.damage > 0).map(c => c.iid);
  st = addLog(st, '好傷藥：選擇回復 60 HP 的受傷寶可夢（之後可丟棄其身上 1 個能量）', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-60-discard-1',
    params: { healAmount: 60, discardEnergy: 1, validIids: damagedIids },
  });
});

// 龍之秘藥 — 將自己的「戰鬥場的」【龍】寶可夢恢復 60 HP
// 卡面（MC / SV7a，reg=H）：「將自己的戰鬥場的【龍】寶可夢恢復『60』HP。」
// v2.262 修兩個 bug：HP 120 → 60；範圍從「任一【龍】寶可夢」限縮為「戰鬥場」。
//   因為只能對戰鬥位 1 隻寶可夢用，不需要 pendingSelection — 直接 inline 處理。
regG('龍之秘藥', (st, idx, pool) => {
  const a = st.players[idx].active;
  if (!a) return false;
  // 只能對戰鬥場的【龍】寶可夢使用，且必須有傷害（PDF §II-C-06）
  return a.damage > 0 && pool.get(a.cardId)?.pokemonType === 'Dragon';
});
reg('龍之秘藥', (st, idx, pool) => {
  const a = st.players[idx].active;
  if (!a) return st;
  const card = pool.get(a.cardId);
  st = addLog(st, `龍之秘藥：${card?.name ?? '?'} 回復 60 HP`, idx);
  return updatePlayer(st, idx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: Math.max(0, p.active.damage - 60) } : null,
  }));
});

regR('heal-60-discard-1', healResolver);
// v5.422：好傷藥回血後「玩家選哪個能量丟棄」的 resolver（從被回血寶可夢 ownerIid 上移除選中能量）
regR('heal-discard-energy-pick', (st, idx, pickedIids, params) => {
  const ownerIid = params?.ownerIid as string | undefined;
  const pickedSet = new Set(pickedIids);
  if (pickedIids.length === 0) return addLog(st, '好傷藥：未選擇能量丟棄', idx);
  const removed: CardInstance[] = [];
  let s = updatePlayer(st, idx, p => {
    const strip = (pk: CardInstance | null): CardInstance | null => {
      if (!pk || (ownerIid !== undefined && pk.iid !== ownerIid)) return pk;
      const keep: CardInstance[] = [];
      for (const e of pk.energyAttached) { if (pickedSet.has(e.iid)) removed.push(e); else keep.push(e); }
      return { ...pk, energyAttached: keep };
    };
    const newActive = strip(p.active);
    const newBench = p.bench.map(strip) as CardInstance[];
    return { ...p, active: newActive, bench: newBench, discard: [...p.discard, ...removed] };
  });
  return addLog(s, `好傷藥：丟棄 ${removed.length} 個能量`, idx);
});
regR('heal-120', healResolver);
// v2.159 龍之秘藥 — resolver 額外驗證目標必須是【龍】寶可夢
regR('heal-120-dragon-only', (st, idx, iids, params, pool) => {
  const iid = iids[0];
  const player = st.players[idx];
  const target = player.active?.iid === iid ? player.active : player.bench.find(c => c.iid === iid);
  if (!target || pool.get(target.cardId)?.pokemonType !== 'Dragon') {
    return addLog(st, '龍之秘藥：選擇的不是【龍】寶可夢，效果失敗', idx);
  }
  return healResolver(st, idx, iids, params, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 棄牌區回收
// ══════════════════════════════════════════════════════════════════════════════

// 夜間擔架 — 從棄牌區選 1 張寶可夢或「基本」能量卡加手牌
// v2.43 修：卡面寫「寶可夢卡或者基本能量卡」，原本 filter 用 PokemonOrEnergy（含特殊能量）
// 導致可以撿回感應【超】能量這種 Special Energy — 不符合卡面。
regG('夜間擔架', (st, idx, pool) => {
  // 棄牌區至少 1 張寶可夢或基本能量（排除 Special Energy / Pokemon 道具 subtype=Other）
  return st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Pokemon') return true;
    if (card?.supertype === 'Energy' && card.subtype === 'Basic') return true;
    return false;
  });
});
reg('夜間擔架', (st, idx) => {
  st = addLog(st, '夜間擔架：從棄牌區選 1 張寶可夢或基本能量加手牌', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'PokemonOrBasicEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'discard-to-hand',
  });
});

// 能量回收器 — 從棄牌區選最多 5 張基本能量卡放回牌庫（義務性：至少選 1 張）
// v2.44 修：guard + maxN 原本用 `supertype==='Energy'`（含 Special Energy），
// 但 filter 是 'BasicEnergy'（只基本能量）。棄牌區只剩 Special Energy 時 minCount:1 會卡死。
regG('能量回收器', (st, idx, pool) =>
  st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  })
);
reg('能量回收器', (st, idx, pool) => {
  const energies = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
  const maxN = Math.min(5, energies.length);
  st = addLog(st, `能量回收器：從棄牌區選 1–${maxN} 張基本能量洗回牌庫`, idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 1, maxCount: maxN,
    effectKey: 'energy-retrieval',
  });
});
// v6.097：卡面（SVOD 12589）「從自己的棄牌區選擇最多5張基本能量卡，**在給對手看過後**
//   放回牌庫並重洗。」→ 原 log 只有張數，補上卡名（棄牌區公開，無洩漏疑慮）。
regR('energy-retrieval', (st, idx, iids, _params, pool) => {
  const pickedForLog = st.players[idx].discard.filter(c => iids.includes(c.iid));
  st = logPickedCards(st, idx, pickedForLog, pool, '能量回收器', '洗回牌庫', { publicReveal: true });
  return updatePlayer(st, idx, (p) => {
    const chosen = p.discard.filter(c => iids.includes(c.iid));
    const newDiscard = p.discard.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle([...p.deck, ...chosen]), discard: newDiscard };
  });
});

regR('discard-to-hand', (st, idx, iids, _params, pool) => {
  // 棄牌區 → 手牌：來源是公開的，記錄取回的卡名
  const chosen = st.players[idx].discard.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `從棄牌取回：${names}`, idx);
  }
  return updatePlayer(st, idx, (p) => {
    const picked = p.discard.filter(c => iids.includes(c.iid));
    // Bug fix (#17 擔架): 寶可夢從棄牌區回到手牌時，必須清除戰鬥狀態
    // 否則上場後會保留被昏厥前的特殊狀態/傷害/附加能量等殘留資訊
    const cleanedPicked = picked.map(c => {
      const card = pool.get(c.cardId);
      if (card?.supertype !== 'Pokemon') return c;
      // 保留 iid / cardId；清除所有戰場狀態欄位
      return {
        iid: c.iid,
        cardId: c.cardId,
        damage: 0,
        energyAttached: [],
        // toolAttached, evolvedFromStack, status, secondaryStatus 等皆不帶回
      } as typeof c;
    });
    return { ...p, discard: p.discard.filter(c => !iids.includes(c.iid)), hand: [...p.hand, ...cleanedPicked] };
  });
});

// 奇跡修正檔 — 從棄牌區選 1 張基本超能量，附於備戰的超寶可夢身上（兩步）
// v2.44 修：guard 原本只查 `supertype==='Energy'`（任何能量都算通過），但 filter 是
// 'BasicPsychicEnergy'（基本【超】能量）。棄牌區若只剩其他屬性能量 / 富裕能量 /
// 感應【超】等 Special Energy，UI 會卡在「選 1 張 · 已選 0」的空選擇畫面。
// 正確語義：guard 必須與 filter 比對一致。
regG('奇跡修正檔', (st, idx, pool) => {
  const hasBasicPsy = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Psychic');
  });
  // ⭐ v6.207：「附於備戰區的【超】寶可夢身上」＝場上有效屬性（小碎鑽）。gate 與 validIids 同時改。
  const hasPsychicBench = st.players[idx].bench.some(b => hasEffectivePokemonType(st, idx, b, pool.get(b.cardId), pool, 'Psychic'));
  return hasBasicPsy && hasPsychicBench;
});
reg('奇跡修正檔', (st, idx, pool) => {
  st = addLog(st, '奇跡修正檔：從棄牌區選 1 張基本【超】能量', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    // 只「基本【超】能量」—「BasicEnergy」本身是所有屬性基本能量，這裡要再縮一層。
    // 過濾規則：supertype=Energy && subtype=Basic && name 含「【超】」。
    // 用 name match 是因為基本能量的 pokemonType 欄位全部為空（卡表資料慣例）。
    filter: 'BasicPsychicEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'miracle-codec-energy',
  });
});
regR('miracle-codec-energy', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const energyIid = iids[0];
  const player = st.players[idx];
  const energyInst = player.discard.find(c => c.iid === energyIid);
  const energyName = energyInst ? (pool.get(energyInst.cardId)?.name ?? '超能量') : '超能量';
  // 只有【超】屬性備戰寶可夢才能成為目標
  const psychicBench = player.bench.filter(b => hasEffectivePokemonType(st, idx, b, pool.get(b.cardId), pool, 'Psychic'));
  if (psychicBench.length === 0) {
    // 備戰區沒有【超】寶可夢（正常流程不應到此，因為 regG 已攔截；防禦性 return）
    return st;
  }
  const validIids = psychicBench.map(b => b.iid);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'miracle-codec-attach',
    params: { energyIid, energyName, validIids },
  });
});
regR('miracle-codec-attach', (st, idx, iids, params, pool) => {
  const energyIid = params?.energyIid as string;
  if (!energyIid) return st;
  const targetIid = iids[0];
  const player = st.players[idx];
  const target = player.bench.find(c => c.iid === targetIid);
  const targetName = target ? (pool.get(target.cardId)?.name ?? '備戰寶可夢') : '備戰寶可夢';
  const energyName = (params?.energyName as string | undefined)
    ?? (() => {
      const e = player.discard.find(c => c.iid === energyIid);
      return e ? (pool.get(e.cardId)?.name ?? '超能量') : '超能量';
    })();
  st = addLog(st, `奇跡修正檔：將 ${energyName} 附加到 ${targetName}`, idx);
  return updatePlayer(st, idx, (p) => {
    const energyCard = p.discard.find(c => c.iid === energyIid);
    if (!energyCard) return p;
    return {
      ...p,
      discard: p.discard.filter(c => c.iid !== energyIid),
      bench: p.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, energyCard] }
        : c),
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 切換（呼叫對手 + 自己切換）
// ══════════════════════════════════════════════════════════════════════════════

// 頂尖捕捉器 — 選 1 隻對手備戰 → 換到對手場上；再選自己備戰 → 切換自己
// v3.06 緊張感 / 融合為雪 — 對手 trainer 免疫：filter 排除
regG('頂尖捕捉器', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const valid = st.players[oppIdx].bench.filter(b => !_v3060IsImmuneOppTrainer(st, oppIdx, b, pool));
  return valid.length > 0;
});
reg('頂尖捕捉器', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // v3.06 緊張感 / 融合為雪 — 對手 trainer 免疫：filter 排除
  const validIids = st.players[oppIdx].bench
    .filter(b => !_v3060IsImmuneOppTrainer(st, oppIdx, b, pool))
    .map(b => b.iid);
  if (validIids.length === 0) {
    return addLog(st, '頂尖捕捉器：對手備戰區沒有可呼叫的寶可夢（緊張感/融合為雪 免疫）', idx);
  }
  st = addLog(st, '頂尖捕捉器：選擇要呼叫的對手備戰寶可夢', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'top-catcher-opp',
    params: { validIids },
  });
});
// ⭐ v6.174：同 gust-opp — 先 log 後判定會騙玩家，且解析失敗時仍往下開「自己換誰上場」picker
//   ⇒ 對手根本沒換、我方卻被要求換場（半套盤面）。收斂到中央 promoteOppBenchToActive。
regR('top-catcher-opp', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const r = promoteOppBenchToActive(st, oppIdx, iids[0], pool, '頂尖捕捉器：', idx);
  st = r.state;
  if (!r.ok) return st;
  // 若自己也有備戰，選擇自己要換入的寶可夢
  if (st.players[idx].bench.length === 0) return st;
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'do-switch',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 其他
// ══════════════════════════════════════════════════════════════════════════════

// 不公印章 — 必須「上個對手的回合自己的寶可夢昏厥了」才可使用（= 對手剛結束的回合有取過獎賞）
// 規則原文：「這張卡必須在上個對手的回合自己的寶可夢【昏厥】了才可使用」
// 歷史 bug：
//   v1 bug：用 `players[idx].prizes.length < 6`（= 我有取過獎賞）判定，方向剛好寫反；
//           且沒區分「上一回合」vs「以前曾經」。
//   v2 fix：engine END_TURN 快照對手獎賞到 oppPrizesAtMyLastTurnEnd[idx]，比對目前 opp.prizes。
//   v2 hole：這種只看「比 LastTurnEnd 少」的判定，無法區分「對手回合擊倒我方」vs
//            「我自己回合內自 KO」（例如黑夜魔靈咒詛炸彈 在自己回合自爆 → opp 也取獎賞 → 誤觸發）。
//   v3 fix：加一個回合開始時的獨立快照 oppPrizesAtMyTurnStart[idx]，
//           gate 條件改為 TurnStart < LastTurnEnd（= 對手在他們剛結束的回合取過獎賞）。
//   v3 hole：TurnStart 是 finalize 後（= checkup 之後）的 snapshot，所以中毒/灼傷/
//           冰冷之帳等寶可夢檢查階段 KO 也會被誤算成「對手回合 KO」。但 PTCG 規則：
//           寶可夢檢查不屬於任何玩家的回合，這些 KO 不該觸發本卡。
//   v3 hole 仍存在：MainEnd snapshot 只區分「對手主回合 KO」vs「checkup KO」，但無法
//                  區分「招式 KO」vs「主動特性 KO」。雖然不公印章卡面不嚴格要求區分，
//                  但 v2.246 仍升級為精確 cause tracking 統一機制。
// v2.246 fix（最終版）：使用 KO cause tracking counter
//   合法觸發：對手主回合中的「招式 KO」+「主動特性 KO」（含 黑夜魔靈|咒詛炸彈）
//   排除：checkup KO（中毒/灼傷/冰冷之帳）+ 自 KO（自己 main phase 自爆）
regG('不公印章', (st, idx) => {
  const attackKO = st.oppAttackKOdMeInLastOppTurn?.[idx] ?? 0;
  const abilityKO = st.oppAbilityKOdMeInLastOppTurn?.[idx] ?? 0;
  return (attackKO + abilityKO) > 0;
});
reg('不公印章', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  // v5.190：加詳細 log 顯示重洗前後牌庫張數，方便玩家確認確實有重洗
  //   (玩家回報「沒重洗」— audit shuffle Fisher-Yates 邏輯正確，加 log 排除誤會)
  const myHandBefore = st.players[idx].hand.length;
  const myDeckBefore = st.players[idx].deck.length;
  const oppHandBefore = st.players[oppIdx].hand.length;
  const oppDeckBefore = st.players[oppIdx].deck.length;
  st = addLog(st, '不公印章：雙方手牌洗回牌庫並重洗，然後自己抽 5 張、對手抽 2 張', idx);
  st = returnHandToDeck(st, idx);
  st = addLog(st, `不公印章：自己手牌 ${myHandBefore} 張 + 牌庫 ${myDeckBefore} 張 → 重洗為 ${st.players[idx].deck.length} 張牌庫`, idx);
  st = returnHandToDeck(st, oppIdx);
  st = addLog(st, `不公印章：對手手牌 ${oppHandBefore} 張 + 牌庫 ${oppDeckBefore} 張 → 重洗為 ${st.players[oppIdx].deck.length} 張牌庫`, idx);
  st = drawCards(st, idx, 5);
  st = drawCards(st, oppIdx, 2);
  return st;
});

// ── 調換票（Item） v2.148 ───────────────────────────────────────────────────
// 卡面：「數過自己的獎賞卡張數後，全部翻回反面並重洗，放回牌庫下方。
//   然後，從牌庫上方抽出與放回張數相同數量的卡，作為獎賞卡放置。」
//
// 流程：
//   count = prizes.length（一般是 1~6）
//   把所有獎賞卡洗一洗，放到 deck 底部
//   從 deck 上方抽 count 張，放到 prizes
//   牌庫不夠 count 張時 → 全部能抽就抽（防呆，避免越界）
//
// gate：必須要還有獎賞卡 + 牌庫至少 1 張（否則沒意義）。
regG('調換票', (st, idx) => {
  const p = st.players[idx];
  return p.prizes.length > 0 && p.deck.length > 0;
});
reg('調換票', (st, idx) => {
  const count = st.players[idx].prizes.length;
  let s = updatePlayer(st, idx, p => {
    if (p.prizes.length === 0) return p;
    // 把獎賞卡洗一洗放到牌庫最底
    // v6.124 收斂：卡面「全部翻回反面並重洗，放回牌庫下方」——只洗獎賞那幾張。
    const newDeckPre = deckWithCardsToBottom(p.deck, p.prizes, 'shuffled');
    // 從新牌庫上方抽 count 張當新獎賞（牌庫不夠時取所有）
    const take = Math.min(p.prizes.length, newDeckPre.length);
    const newPrizes = newDeckPre.slice(0, take);
    const newDeck = newDeckPre.slice(take);
    return { ...p, prizes: newPrizes, deck: newDeck };
  });
  return addLog(s, `調換票：${count} 張獎賞洗回牌庫下方，重新抽 ${count} 張作為新獎賞`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// v2.166 物品卡批次（卡池中未實裝的常見 Item）
// ══════════════════════════════════════════════════════════════════════════════

// ── 開洞之鏟（Item / M-P-I）─────────────────────────────────────────────────
// 卡面：將自己的牌庫上方 2 張卡丟棄。
regG('開洞之鏟', (st, idx) => st.players[idx].deck.length > 0);
reg('開洞之鏟', (st, idx, pool) => {
  const top2 = st.players[idx].deck.slice(0, 2);
  return updatePlayer(addLog(st, `開洞之鏟：將自己的牌庫上方 ${top2.length} 張卡丟棄：${joinCardNames(top2, pool)}`, idx), idx, p => {
    return { ...p, deck: p.deck.slice(top2.length), discard: [...p.discard, ...top2] };
  });
});

// ── 粉碎之錘（Item / MC）────────────────────────────────────────────────────
// 卡面：擲 1 次硬幣若為正面，則選擇 1 個對手的場上寶可夢身上附加的能量，將其丟棄。
// gate：對手場上至少 1 隻寶可夢身上有能量（不論基本/特殊）
// 流程：先 coin flip → 正面開 opp-poke-choose（限有能量的）→ resolver 丟最後一張能量
regG('粉碎之錘', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  return all.some(pk => pk.energyAttached.length > 0);
});
reg('粉碎之錘', (st, idx) => {
  // v3.14 修 Rule 7：原本選完寶可夢自動取末尾能量。卡面寫「選擇 1 個能量」
  // 應由玩家選擇。改成 flipCoinsWithLog → opp-poke-choose（選目標寶可夢）→
  // active-energy-discard（選該寶可夢身上的 1 張能量）chain。
  const r = flipCoinsWithLog(st, 1, '粉碎之錘', idx);
  st = r.state;
  if (!r.heads) {
    return addLog(st, '粉碎之錘：反面 → 無效', idx);
  }
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  const cand = all.filter(pk => pk.energyAttached.length > 0);
  if (cand.length === 0) return addLog(st, '粉碎之錘：對手場上沒有能量可丟', idx);
  st = addLog(st, '粉碎之錘：選 1 隻對手寶可夢丟棄 1 張能量', idx);
  return withPending(st, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'crush-hammer-pick-poke',
    params: { includeActive: true, validIids: cand.map(c => c.iid) },
  });
});
// v3.14 第二步：玩家在選中的寶可夢身上挑 1 張能量丟棄
//   active-energy-discard 擴充：透過 params.targetIid 指定 iid，picker 讀該寶可夢
//   的 energyAttached（無論 active 或 bench）。
regR('crush-hammer-pick-poke', (st, idx, iids) => {
  const targetIid = iids[0];
  if (!targetIid) return st;
  const dIdx = (1 - idx) as 0 | 1;
  return withPending(st, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'crush-hammer-discard',
    params: { targetIid, titleOverride: '選擇要丟棄的對手能量' },
  });
});
regR('crush-hammer-discard', (st, idx, iids, params, pool) => {
  const energyIid = iids[0];
  const targetIid = params?.targetIid as string | undefined;
  if (!energyIid || !targetIid) return st;
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const removed = target.energyAttached.find(e => e.iid === energyIid);
  if (!removed) return st;
  const energyName = pool.get(removed.cardId)?.name ?? '能量';
  const targetName = pool.get(target.cardId)?.name ?? '?';
  const s = addLog(st, `粉碎之錘：丟棄 ${targetName} 身上的 ${energyName}`, idx);
  return updatePlayer(s, dIdx, p => {
    const updated = { ...target, energyAttached: target.energyAttached.filter(e => e.iid !== energyIid) };
    return {
      ...p,
      active: p.active?.iid === targetIid ? updated : p.active,
      bench: p.bench.map(c => c.iid === targetIid ? updated : c),
      discard: [...p.discard, removed],
    };
  });
});

// ── 派帕的三明治（Item / MC）────────────────────────────────────────────────
// 卡面：將自己的戰鬥寶可夢恢復「30」HP。若那隻寶可夢為「派帕的寶可夢」，則恢復的 HP 改為「100」。
regG('派帕的三明治', (st, idx) => {
  return !!st.players[idx].active && st.players[idx].active!.damage > 0;
});
reg('派帕的三明治', (st, idx, pool) => {
  if (!st.players[idx].active) return st;
  const card = pool.get(st.players[idx].active!.cardId);
  const name = card?.name ?? '?';
  const isPiper = !!card?.name?.startsWith('派帕的');
  const heal = isPiper ? 100 : 30;
  st = addLog(st, `派帕的三明治：${name} 恢復 ${heal} HP${isPiper ? '（派帕的寶可夢）' : ''}`, idx);
  return updatePlayer(st, idx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: { ...p.active, damage: Math.max(0, p.active.damage - heal) },
    };
  });
});

// ── 密阿雷格雷派餅（Item / M3）─────────────────────────────────────────────
// 卡面：將自己的戰鬥寶可夢恢復「20」HP，特殊狀態也恢復 1 個。
// 「特殊狀態恢復 1 個」依 v2.163 約定：先清 status 主格，否則清 secondaryStatus。
regG('密阿雷格雷派餅', (st, idx) => {
  const a = st.players[idx].active;
  if (!a) return false;
  return a.damage > 0 || !!a.status || !!a.secondaryStatus || !!a.tertiaryStatus;
});
reg('密阿雷格雷派餅', (st, idx, pool) => {
  if (!st.players[idx].active) return st;
  const a = st.players[idx].active!;
  const name = pool.get(a.cardId)?.name ?? '?';
  // v5.296: 三槽清除 (中毒+灼傷+混亂可共存, 萬靈藥類只清 1 個依優先順序)
  let clearedLabel = '';
  let nextStatus = a.status;
  let nextSecondary = a.secondaryStatus;
  let nextTertiary = a.tertiaryStatus;
  if (a.status) { clearedLabel = a.status; nextStatus = undefined; }
  else if (a.secondaryStatus) { clearedLabel = a.secondaryStatus; nextSecondary = undefined; }
  else if (a.tertiaryStatus) { clearedLabel = a.tertiaryStatus; nextTertiary = undefined; }
  const heal = Math.min(20, a.damage);
  const bits: string[] = [];
  if (heal > 0) bits.push(`恢復 ${heal} HP`);
  if (clearedLabel) bits.push(`解除 ${clearedLabel}`);
  st = addLog(st, `密阿雷格雷派餅：${name}${bits.length ? '：' + bits.join('，') : ''}`, idx);
  return updatePlayer(st, idx, p => {
    if (!p.active) return p;
    return {
      ...p,
      active: {
        ...p.active,
        damage: Math.max(0, p.active.damage - 20),
        status: nextStatus,
        secondaryStatus: nextSecondary,
        tertiaryStatus: nextTertiary,
      },
    };
  });
});

// ── 能量硬幣（Item / MC）────────────────────────────────────────────────────
// 卡面：擲 2 次硬幣，若全部為正面，則從自己的牌庫選 1 張基本能量卡，附於自己的寶可夢身上。並重洗牌庫。
regG('能量硬幣', (st, idx, pool) => {
  const hasBasicEnergy = st.players[idx].deck.length > 0;
  const hasPoke = !!st.players[idx].active || st.players[idx].bench.length > 0;
  return hasBasicEnergy && hasPoke;
});
reg('能量硬幣', (st, idx) => {
  const r = flipCoinsWithLog(st, 2, '能量硬幣', idx);
  st = r.state;
  if (r.heads < 2) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      `能量硬幣：${r.heads}/2 次正面（未全部正面）→ 重洗牌庫`, idx);
  }
  st = addLog(st, '能量硬幣：2/2 次正面！從牌庫選 1 張基本能量附給寶可夢', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'energy-coin-pick',
  });
});
regR('energy-coin-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '能量硬幣：未選擇能量（牌庫已重洗）', idx);
  }
  const energyIid = iids[0];
  const energyName = pool.get(st.players[idx].deck.find(c => c.iid === energyIid)?.cardId ?? '')?.name ?? '?';
  st = addLog(st, `能量硬幣：搜到 ${energyName}，選 1 隻寶可夢附加`, idx);
  return withPending(st, {
    type: 'bench-choose',  // 借 bench-choose（含 active）作為「選自己場上 1 隻」picker
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-coin-attach',
    params: { includeActive: true, energyIid, energyName },
  });
});
regR('energy-coin-attach', (st, idx, iids, params, pool) => {
  const targetIid = iids[0];
  const energyIid = params?.energyIid as string | undefined;
  if (!targetIid || !energyIid) return st;
  const player = st.players[idx];
  const energyInst = player.deck.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  const energyName = pool.get(energyInst.cardId)?.name ?? '能量';
  const targetInst = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid) ?? null;
  const targetName = targetInst ? (pool.get(targetInst.cardId)?.name ?? '?') : '?';
  st = addLog(st, `能量硬幣：${energyName} 附給 ${targetName}，牌庫重洗`, idx);
  return updatePlayer(st, idx, p => {
    const newDeck = shuffle(p.deck.filter(c => c.iid !== energyIid));
    const attachTo = (pk: import('$lib/game/types').CardInstance) =>
      pk.iid === targetIid
        ? { ...pk, energyAttached: [...pk.energyAttached, energyInst] }
        : pk;
    return {
      ...p,
      active: p.active ? attachTo(p.active) : null,
      bench: p.bench.map(attachTo),
      deck: newDeck,
    };
  });
});

// ── 大師球（Item / SVE）────────────────────────────────────────────────────
// 卡面：從自己的牌庫選 1 張寶可夢卡，給對手看後加入手牌。並重洗牌庫。
regG('大師球', (st, idx) => st.players[idx].deck.length > 0);
reg('大師球', (st, idx, pool) => {
  st = addLog(st, '大師球：從牌庫選 1 張寶可夢加手牌（給對手看）', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無寶可夢時允許 Pass
  const hasPoke = st.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'master-ball-pick',
  });
});
regR('master-ball-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '大師球：未選擇（牌庫已重洗）', idx);
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `大師球：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const set = new Set(iids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 巢穴球（Item / MC）─────────────────────────────────────────────────────
// 卡面：從自己的牌庫選 1 張【基礎】寶可夢卡，放置於備戰區。並重洗牌庫。
regG('巢穴球', (st, idx, pool) => {
  // v3.78：支援零之大空洞
  if (st.players[idx].bench.length >= getOwnBenchLimit(st, idx, pool)) return false;
  return st.players[idx].deck.length > 0;
});
reg('巢穴球', (st, idx, pool) => {
  st = addLog(st, '巢穴球：從牌庫選 1 張基礎寶可夢放備戰', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無基礎寶可夢時允許 Pass
  const hasBasic = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card?.subtype === 'Basic';
  });
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic',
    minCount: 0, maxCount: 1,
    effectKey: 'nest-ball-place',
  });
});
regR('nest-ball-place', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '巢穴球：未選擇（牌庫已重洗）', idx);
  const iid = iids[0];
  const inst = st.players[idx].deck.find(c => c.iid === iid);
  if (!inst) return st;
  const name = pool.get(inst.cardId)?.name ?? '?';
  st = addLog(st, `巢穴球：${name} 放置到備戰區`, idx);
  return updatePlayer(st, idx, p => {
    // v3.78：支援零之大空洞
    if (p.bench.length >= getOwnBenchLimit(st, idx, pool)) return p;
    const placed = { ...inst, justPlaced: true };
    const rest = p.deck.filter(c => c.iid !== iid);
    return { ...p, deck: shuffle(rest), bench: [...p.bench, placed] };
  });
});

// ── 朋友手冊（Item）────────────────────────────────────────────────────────
// 卡面：從自己的棄牌區選最多 2 張支援者卡，給對手看後放回牌庫並重洗。
regG('朋友手冊', (st, idx, pool) => {
  return st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Trainer' && card.subtype === 'Supporter';
  });
});
reg('朋友手冊', (st, idx) => {
  st = addLog(st, '朋友手冊：從棄牌區選最多 2 張支援者放回牌庫', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter',
    minCount: 0, maxCount: 2,
    effectKey: 'friend-book-return',
  });
});
regR('friend-book-return', (st, idx, iids, _params, pool) => {
  const set = new Set(iids);
  const picked = st.players[idx].discard.filter(c => set.has(c.iid));
  if (picked.length === 0) return addLog(st, '朋友手冊：未選擇任何支援者', idx);
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `朋友手冊：${names}（${picked.length} 張）放回牌庫並重洗`, idx);
  return updatePlayer(st, idx, p => {
    const rest = p.discard.filter(c => !set.has(c.iid));
    return { ...p, discard: rest, deck: shuffle([...p.deck, ...picked]) };
  });
});

// ── 能量貼紙（Item）────────────────────────────────────────────────────────
// 卡面：擲 1 次硬幣若為正面，則從自己的棄牌區選 1 張基本能量卡，附於備戰寶可夢身上。
regG('能量貼紙', (st, idx, pool) => {
  if (st.players[idx].bench.length === 0) return false;
  return st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  });
});
reg('能量貼紙', (st, idx) => {
  // v3.14 改用 flipCoinsWithLog（含對手驗證 cue + coin 動畫）— 替代原本 Math.random
  const r = flipCoinsWithLog(st, 1, '能量貼紙', idx);
  st = r.state;
  if (!r.heads) return addLog(st, '能量貼紙：反面 → 無效果', idx);
  st = addLog(st, '能量貼紙：從棄牌區選 1 張基本能量', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 0, maxCount: 1,
    effectKey: 'energy-sticker-pick',
  });
});
regR('energy-sticker-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(st, '能量貼紙：未選擇能量', idx);
  const energyIid = iids[0];
  const inst = st.players[idx].discard.find(c => c.iid === energyIid);
  if (!inst) return st;
  const energyName = pool.get(inst.cardId)?.name ?? '能量';
  st = addLog(st, `能量貼紙：搜到 ${energyName}，選 1 隻備戰寶可夢附加`, idx);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'energy-sticker-attach',
    params: { includeActive: false, energyIid, energyName },
  });
});
regR('energy-sticker-attach', (st, idx, iids, params, pool) => {
  const targetIid = iids[0];
  const energyIid = params?.energyIid as string | undefined;
  if (!targetIid || !energyIid) return st;
  const player = st.players[idx];
  const energyInst = player.discard.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  const targetInst = player.bench.find(c => c.iid === targetIid);
  if (!targetInst) return st;
  const energyName = pool.get(energyInst.cardId)?.name ?? '能量';
  const targetName = pool.get(targetInst.cardId)?.name ?? '?';
  st = addLog(st, `能量貼紙：${energyName} 附給備戰 ${targetName}`, idx);
  return updatePlayer(st, idx, p => ({
    ...p,
    discard: p.discard.filter(c => c.iid !== energyIid),
    bench: p.bench.map(b => b.iid === targetIid
      ? { ...b, energyAttached: [...b.energyAttached, energyInst] }
      : b),
  }));
});

// ── 親送無人機（Item / SV6a）─────────────────────────────────────────────
// 卡面：擲 2 次硬幣，若全部為正面，則從自己的牌庫任意選擇 1 張卡加入手牌。並重洗牌庫。
regG('親送無人機', (st, idx) => st.players[idx].deck.length > 0);
reg('親送無人機', (st, idx) => {
  // v3.14 改用 flipCoinsWithLog（每次擲幣 1 行 log，含對手驗證 cue + coin 動畫）
  const r = flipCoinsWithLog(st, 2, '親送無人機', idx);
  st = r.state;
  if (r.heads < 2) {
    return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })),
      '親送無人機：未全部正面 → 重洗牌庫', idx);
  }
  st = addLog(st, '親送無人機：全正面！從牌庫任選 1 張加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    // v3.997：minCount=0 — 對手不知道牌庫內容，玩家可選擇不找（fake fail to find）
    minCount: 0, maxCount: 1,
    effectKey: 'gift-drone-pick',
  });
});
regR('gift-drone-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '親送無人機：未選擇（牌庫已重洗）', idx);
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addPrivateLog(st, `親送無人機：搜到 ${names} 加入手牌`, `親送無人機：搜到 ${picked.length} 張卡加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const set = new Set(iids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 訂購盒（Item）──────────────────────────────────────────────────────────
// 卡面：若使用了這張卡，則自己的回合結束。從自己的牌庫選最多 2 張物品卡，給對手看後加入手牌並重洗。
regG('訂購盒', (st, idx) => st.players[idx].deck.length > 0);
reg('訂購盒', (st, idx) => {
  st = addLog(st, '訂購盒：從牌庫選最多 2 張物品卡加手牌（用後回合結束）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Item',
    minCount: 0, maxCount: 2,
    effectKey: 'order-box-pick',
  });
});
regR('order-box-pick', (st, idx, iids, _params, pool) => {
  const set = new Set(iids);
  const picked = st.players[idx].deck.filter(c => set.has(c.iid));
  if (picked.length > 0) {
    const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    // v2.96：卡面「給對手看過」→ 公開卡名
    st = addLog(st, `訂購盒：搜到 ${names} 加入手牌`, idx);
  } else {
    st = addLog(st, '訂購盒：未選擇任何物品卡', idx);
  }
  st = updatePlayer(st, idx, p => {
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
  // 強制回合結束 — 把 turnPhase 設為 'end' 觸發引擎進入結束流程
  return addLog({ ...st, turnPhase: 'end' as const }, '訂購盒：使用後自己的回合結束', idx);
});

// ── 幫忙鈴（Item）──────────────────────────────────────────────────────────
// 卡面：這張卡只可在後攻玩家的最初回合使用。從自己的牌庫選 1 張支援者卡加手牌並重洗。
// v4.940 修 gate bug：原 `!st.isFirstTurn` 永遠擋到後攻方第 1 回合（engine 端 isFirstTurn
//   在後攻方行動段已是 false，僅涵蓋先攻方第 1 動作回合，見 engine.ts:2076-2078 註解）。
//   改用 `st.turn !== 1`（state.turn 只在後攻方 END_TURN 才 +1，turn===1 涵蓋雙方第 1 動作回合）
//   + `activePlayerIndex !== firstPlayerIdx` 排除先攻方 → 正確的「後攻方第 1 回合」gate。
regG('幫忙鈴', (st, idx, _pool) => {
  if (st.turn !== 1) return false;
  if (st.activePlayerIndex === st.firstPlayerIdx) return false;
  return st.players[idx].deck.length > 0;
});
reg('幫忙鈴', (st, idx, pool) => {
  st = addLog(st, '幫忙鈴：從牌庫選 1 張支援者加手牌（給對手看）', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無支援者時允許 Pass
  const hasSupporter = st.players[idx].deck.some(c => pool.get(c.cardId)?.subtype === 'Supporter');
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter',
    minCount: 0, maxCount: 1,
    effectKey: 'help-bell-pick',
  });
});
regR('help-bell-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '幫忙鈴：未選擇（牌庫已重洗）', idx);
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `幫忙鈴：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const set = new Set(iids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 火箭隊的驚嚇炸彈（Item / MC）──────────────────────────────────────────
// 卡面：擲 1 次硬幣若為正面，則在對手的 1 隻寶可夢身上放置 2 個傷害指示物。
//       若為反面，則在自己的戰鬥寶可夢身上放置 2 個傷害指示物。
regG('火箭隊的驚嚇炸彈', () => true);
reg('火箭隊的驚嚇炸彈', (st, idx) => {
  // v3.14 改用 flipCoinsWithLog 替代 Math.random + 反面分支補 addLog
  //   （原本反面只默默扣自己 20 HP，玩家看不到 log）。
  const r = flipCoinsWithLog(st, 1, '火箭隊的驚嚇炸彈', idx);
  st = r.state;
  if (!r.heads) {
    // 反面：自己戰鬥場 +20 傷害（v3.14 補 log）
    if (!st.players[idx].active) return st;
    st = addLog(st, '火箭隊的驚嚇炸彈：反面 → 自己戰鬥位放 2 個傷害指示物（+20 傷害）', idx);
    return updatePlayer(st, idx, p => ({
      ...p,
      active: p.active ? { ...p.active, damage: p.active.damage + 20 } : null,
    }));
  }
  // 正面：選對手 1 隻 +20
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  if (all.length === 0) return st;
  st = addLog(st, '火箭隊的驚嚇炸彈：選 1 隻對手寶可夢放置 2 個傷害指示物', idx);
  return withPending(st, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'rocket-scare-bomb-place',
    params: { includeActive: true },
  });
});
regR('rocket-scare-bomb-place', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const targetIid = iids[0];
  if (!targetIid) return st;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const tn = pool.get(target.cardId)?.name ?? '?';
  st = addLog(st, `火箭隊的驚嚇炸彈：${tn} 受到 20 傷害`, idx);
  // dmg-direct-ok: 道具放置傷害指示物，免疫(化隱/神秘石居)僅針對招式/特性，不走中央招式 guard
  return updatePlayer(st, dIdx, p => {
    const upd = (pk: typeof target) => pk.iid === targetIid ? { ...pk, damage: pk.damage + 20 } : pk;
    return {
      ...p,
      active: p.active && p.active.iid === targetIid ? { ...p.active, damage: p.active.damage + 20 } : p.active,
      bench: p.bench.map(upd),
    };
  });
});

// ── 勝利之證（Item）────────────────────────────────────────────────────────
// 卡面：擲 1 次硬幣若為正面，則從自己的牌庫選 1 張寶可夢卡，給對手看後加手牌。並重洗牌庫。
regG('勝利之證', (st, idx) => st.players[idx].deck.length > 0);
reg('勝利之證', (st, idx, pool) => {
  // v3.14 改用 flipCoinsWithLog 替代 Math.random — 含 coin 動畫與對手驗證 cue
  const r = flipCoinsWithLog(st, 1, '勝利之證', idx);
  st = r.state;
  if (!r.heads) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '勝利之證：反面 → 重洗牌庫', idx);
  st = addLog(st, '勝利之證：從牌庫選 1 張寶可夢加手牌', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無寶可夢時允許 Pass
  const hasPoke = st.players[idx].deck.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'victory-proof-pick',
  });
});
regR('victory-proof-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '勝利之證：未選擇（牌庫已重洗）', idx);
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `勝利之證：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const set = new Set(iids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 能量撢子（Item）────────────────────────────────────────────────────────
// 卡面：查看對手的手牌，從其中選擇 1 張能量卡，放回對手的牌庫下方。
regG('能量撢子', (st, idx) => {
  // v5.420：對手手牌是否有能量是「未知資訊」，不可拿來 gate 可用性（會洩漏+誤擋）。
  //   卡面效果是「查看對手手牌」＝永遠有效果（取得資訊），只要對手手牌非空就可用；
  //   若手牌無能量，reg 內走「僅查看」分支（不丟）。原本要求對手有能量是簡易安裝。
  const dIdx = (1 - idx) as 0 | 1;
  return st.players[dIdx].hand.length > 0;
});
reg('能量撢子', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppHand = st.players[dIdx].hand;
  if (oppHand.length === 0) return addLog(st, '能量撢子：對手手牌為空', idx);
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v3.9992：揭示對手手牌改 addPrivateLog
  let s = addPrivateLog(st,
    `能量撢子：查看對手手牌（${oppHand.length} 張）— ${handNames}`,
    `能量撢子：查看對手手牌（${oppHand.length} 張）`,
    idx);
  const energyIids = oppHand
    .filter(c => pool.get(c.cardId)?.supertype === 'Energy')
    .map(c => c.iid);
  if (energyIids.length === 0) {
    s = addLog(s, '能量撢子：對手手牌無能量卡（僅查看）', idx);
    return withPending(s, {
      type: 'hand-discard',  // 借用 hand-discard UI（sourcePlayerIdx=dIdx 對手手牌）
      actorIdx: idx, sourcePlayerIdx: dIdx,
      minCount: 0, maxCount: 0,
      filter: 'Energy',
      effectKey: 'energy-duster-pick',
      params: { validIids: [] },
    });
  }
  s = addLog(s, `能量撢子：選 1 張能量放回對手牌庫下方`, idx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 0, maxCount: 1,
    filter: 'Energy',
    effectKey: 'energy-duster-pick',
    // v3.62 titleOverride：是「放回對手牌庫下方」不是丟棄
    params: { validIids: energyIids, titleOverride: '能量撢子：選 1 張對手手牌能量放回對手牌庫下方' },
  });
});
regR('energy-duster-pick', (st, idx, iids, _params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  if (iids.length === 0) return addLog(st, '能量撢子：未選擇任何能量', idx);
  const targetIid = iids[0];
  const inst = st.players[dIdx].hand.find(c => c.iid === targetIid);
  if (!inst) return st;
  const name = pool.get(inst.cardId)?.name ?? '能量';
  st = addLog(st, `能量撢子：對手的 ${name} 從手牌放回牌庫下方`, idx);
  return updatePlayer(st, dIdx, p => ({
    ...p,
    hand: p.hand.filter(c => c.iid !== targetIid),
    // v6.124 收斂：卡面「放回對手的牌庫下方」沒有「重洗」→ keep-order。
    deck: deckWithCardsToBottom(p.deck, [inst], 'keep-order'),
  }));
});

// ── 招式學習器機（Item）────────────────────────────────────────────────────
// 卡面：從自己的牌庫選最多 3 張名稱中有「招式學習器」的「寶可夢道具」卡，給對手看後加手牌並重洗。
regG('招式學習器機', (st, idx) => st.players[idx].deck.length > 0);
reg('招式學習器機', (st, idx, pool) => {
  // 牌庫中名稱含「招式學習器」的 PokemonTool iids
  const validIids = st.players[idx].deck
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Trainer'
        && card.subtype === 'PokemonTool'
        && card.name?.includes('招式學習器');
    })
    .map(c => c.iid);
  st = addLog(st, `招式學習器機：從牌庫選最多 3 張「招式學習器」道具加手牌`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    // ⭐ v6.109：卡面「名稱中有『招式學習器』的『寶可夢道具』卡」——兩個條件都要進 filter。
    //   舊寫法 'PokemonTool' 會列出牌庫**所有**寶可夢道具、只靠 validIids 擋。
    //   ⚠ 不能用既有的 'NameContains:'：那個 prefix 的語義是「名稱含 X 的**物品卡**」
    //   （化石採掘場 v5.155 建立），會把 Item 的「招式學習器機」本身也列進來、卻列不到道具。
    filter: 'Tool:NameContains=招式學習器',
    minCount: 0, maxCount: Math.min(3, validIids.length),
    effectKey: 'tm-machine-pick',
    params: { validIids },
  });
});
regR('tm-machine-pick', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) })), '招式學習器機：未選擇（牌庫已重洗）', idx);
  const picked = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = picked.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v2.96：卡面「給對手看過」→ 公開卡名
  st = addLog(st, `招式學習器機：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, p => {
    const set = new Set(iids);
    const got = p.deck.filter(c => set.has(c.iid));
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: shuffle(rest), hand: [...p.hand, ...got] };
  });
});

// ── 悠哉尾草棒（Item / MC）─────────────────────────────────────────────────
// 卡面：這張卡只可在後攻玩家的最初回合使用。
//       選擇 1 個對手的場上寶可夢身上附加的能量，放回對手的手牌。
// gate：必須是後攻方第 1 回合（state.turn === 1 且 activePlayerIndex !== firstPlayerIdx）
//       + 對手場上至少 1 隻寶可夢有能量
// v4.940：原寫 `!st.isFirstTurn` 是錯的（同 幫忙鈴 bug），改 `st.turn !== 1`。
regG('悠哉尾草棒', (st, idx, pool) => {
  // 後攻方第 1 動作回合：state.turn 仍 === 1（turn 只在後攻方 END_TURN +1），
  // 且當前 activePlayer 是後攻方（!== firstPlayerIdx）
  if (st.turn !== 1) return false;
  if (st.activePlayerIndex === st.firstPlayerIdx) return false;
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 阻擋整個效果
  if (_calmGroundBlocks(st, (1 - idx) as 0 | 1, pool)) return false; // v5.985 被回手的是對手的卡
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  return all.some(pk => pk.energyAttached.length > 0);
});
reg('悠哉尾草棒', (st, idx, pool) => {
  // v3.08 美納斯｜平穩境地：對手場上有美納斯 → 整個效果不發生
  if (_calmGroundBlocks(st, (1 - idx) as 0 | 1, pool)) { // v5.985 被回手的是對手的卡
    return addLog(st, '悠哉尾草棒：對手場上有【平穩境地】，效果無效', idx);
  }
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const all = [...(dp.active ? [dp.active] : []), ...dp.bench];
  const cand = all.filter(pk => pk.energyAttached.length > 0);
  if (cand.length === 0) return addLog(st, '悠哉尾草棒：對手場上沒有能量', idx);
  st = addLog(st, '悠哉尾草棒：選 1 隻對手寶可夢，1 張能量放回對手手牌', idx);
  return withPending(st, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'lazy-tail-grass-bounce',
    params: { includeActive: true, validIids: cand.map(c => c.iid) },
  });
});
// v3.14 修 Rule 7：原本選完寶可夢自動拿末尾能量。卡面寫「選擇 1 個能量」應玩家選。
//   改成 opp-poke-choose（pick 目標寶可夢）→ active-energy-discard（pick 該寶可夢
//   身上能量）chain。
regR('lazy-tail-grass-bounce', (st, idx, iids) => {
  const targetIid = iids[0];
  if (!targetIid) return st;
  const dIdx = (1 - idx) as 0 | 1;
  return withPending(st, {
    type: 'active-energy-discard',
    actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'lazy-tail-grass-pick-energy',
    params: { targetIid, titleOverride: '選擇要放回對手手牌的能量' },
  });
});
regR('lazy-tail-grass-pick-energy', (st, idx, iids, params, pool) => {
  const energyIid = iids[0];
  const targetIid = params?.targetIid as string | undefined;
  if (!energyIid || !targetIid) return st;
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const target = dp.active?.iid === targetIid
    ? dp.active
    : dp.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const removed = target.energyAttached.find(e => e.iid === energyIid);
  if (!removed) return st;
  const energyName = pool.get(removed.cardId)?.name ?? '能量';
  const targetName = pool.get(target.cardId)?.name ?? '?';
  const s = addLog(st, `悠哉尾草棒：將 ${targetName} 身上的 ${energyName} 放回對手手牌`, idx);
  return updatePlayer(s, dIdx, p => {
    const updated = { ...target, energyAttached: target.energyAttached.filter(e => e.iid !== energyIid) };
    return {
      ...p,
      active: p.active?.iid === targetIid ? updated : p.active,
      bench: p.bench.map(c => c.iid === targetIid ? updated : c),
      hand: [...p.hand, removed],
    };
  });
});

// ── 重新啟動箱（Item / H）── v2.180 ───────────────────────────────────────────
// 卡面：從棄牌區附給自己的所有「未來」寶可夢各 1 張基本能量卡。
// 實裝：玩家從棄牌挑選 ≤N 張基本能量（N = 場上未來寶可夢數），
//       v5.861：改為玩家逐張分配（Wilson 裁定應由玩家選哪張基本能量附給哪隻未來寶可夢，
//       原自動 picked[i]→future[i] 固定順序是「自動亂填」bug）。卡面「所有『未來』各1張」→ 每隻上限
//       1 張：逐張開 picker 選目標、附後移出候選。(不走中央 startEnergyChain：其 energy-distribute
//        無 per-target≤1 上限，會讓玩家集中多張到 1 隻，違反「各 1 張」。)
// gate：場上未來寶可夢 ≥1 + 棄牌基本能量 ≥1。
regG('重新啟動箱', (st, idx, pool) => {
  const p = st.players[idx];
  const futures = [...(p.active ? [p.active] : []), ...p.bench]
    .filter(c => pool.get(c.cardId)?.tags?.includes('未來'));
  if (futures.length === 0) return false;
  const basicCount = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }).length;
  return basicCount >= 1;
});
reg('重新啟動箱', (st, idx, pool) => {
  const p = st.players[idx];
  const futures = [...(p.active ? [p.active] : []), ...p.bench]
    .filter(c => pool.get(c.cardId)?.tags?.includes('未來'));
  const basicCount = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic';
  }).length;
  const maxPick = Math.min(futures.length, basicCount);
  st = addLog(st, `重新啟動箱：場上 ${futures.length} 隻「未來」寶可夢，從棄牌挑最多 ${maxPick} 張基本能量分配（每隻 1 張）`, idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 0, maxCount: maxPick,
    effectKey: 'restart-box-attach',
    params: { futureIids: futures.map(f => f.iid) },
  });
});
regR('restart-box-attach', (st, idx, iids, _params, pool) => {
  // v5.861：玩家選完能量 → 進入逐張分配 chain（玩家選每張附給哪隻「未來」寶可夢，各 1 張）。
  const futureIids = ((_params?.futureIids as string[]) ?? []).slice();
  if (iids.length === 0) {
    return addLog(st, '重新啟動箱：未選擇任何能量，效果結束', idx);
  }
  return _restartBoxChainStep(st, idx, iids.slice(), futureIids, pool);
});

// v5.861：重新啟動箱逐張分配 chain — 每隻「未來」寶可夢各 1 張，玩家選哪張能量給哪隻。
function _restartBoxChainStep(st: GameState, idx: 0 | 1, energyIids: string[], futureIids: string[], pool: Map<string, Card>): GameState {
  const onField = [...(st.players[idx].active ? [st.players[idx].active] : []), ...st.players[idx].bench]
    .filter((c): c is CardInstance => !!c);
  const validFutures = futureIids.filter(fi => onField.some(c => c.iid === fi));
  if (energyIids.length === 0) return st;
  if (validFutures.length === 0) {
    return addLog(st, `重新啟動箱：已無可分配的「未來」寶可夢，剩 ${energyIids.length} 張能量留在棄牌區`, idx);
  }
  const currentEnergy = energyIids[0];
  const eInst = st.players[idx].discard.find(c => c.iid === currentEnergy);
  const eName = eInst ? (pool.get(eInst.cardId)?.name ?? '能量') : '能量';
  if (validFutures.length === 1) {
    st = _restartBoxAttachOne(st, idx, currentEnergy, validFutures[0], pool);
    const rest = energyIids.slice(1);
    if (rest.length > 0) return addLog(st, `重新啟動箱：僅剩 1 隻「未來」寶可夢已附 1 張，剩 ${rest.length} 張能量留在棄牌區`, idx);
    return st;
  }
  st = addLog(st, `重新啟動箱：選擇「${eName}」要附給哪一隻「未來」寶可夢（各 1 張）`, idx);
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'restart-box-chain-attach',
    // v6.129 ⚠ validIids 原本寫在 pending 頂層 → 三端都讀不到 ⇒ 可附給任何寶可夢，
    //   卡面「附於自己的『未來』寶可夢」限制失效。
    params: {
      validIids: validFutures,
      currentEnergy,
      remainingEnergy: energyIids.slice(1),
      remainingFutures: validFutures,
      titleOverride: `重新啟動箱：將「${eName}」附到哪一隻「未來」寶可夢？`,
    },
  });
}

// v5.861：把 1 張棄牌區能量附到指定目標並記 log（chain 內部共用）
function _restartBoxAttachOne(st: GameState, idx: 0 | 1, energyIid: string, targetIid: string, pool: Map<string, Card>): GameState {
  const energyInst = st.players[idx].discard.find(c => c.iid === energyIid);
  if (!energyInst) return st;
  st = updatePlayer(st, idx, p => {
    const remaining = p.discard.filter(c => c.iid !== energyIid);
    const attach = (c: CardInstance | null) => (c && c.iid === targetIid)
      ? { ...c, energyAttached: [...c.energyAttached, energyInst] } : c;
    return { ...p, discard: remaining, active: attach(p.active), bench: p.bench.map(c => attach(c) ?? c) };
  });
  const tInst = [...(st.players[idx].active ? [st.players[idx].active] : []), ...st.players[idx].bench]
    .find(c => c?.iid === targetIid);
  const tName = tInst ? (pool.get(tInst.cardId)?.name ?? '?') : '?';
  const eName = pool.get(energyInst.cardId)?.name ?? '能量';
  return addLog(st, `重新啟動箱：${eName} 附給 ${tName}`, idx);
}

regR('restart-box-chain-attach', (st, idx, iids, params, pool) => {
  const currentEnergy = String(params?.currentEnergy ?? '');
  const remainingEnergy = ((params?.remainingEnergy as string[]) ?? []).slice();
  const remainingFutures = ((params?.remainingFutures as string[]) ?? []).slice();
  const targetIid = iids[0];
  if (!targetIid) return addLog(st, '重新啟動箱：未選擇目標，效果結束', idx);
  st = _restartBoxAttachOne(st, idx, currentEnergy, targetIid, pool);
  const nextFutures = remainingFutures.filter(fi => fi !== targetIid);
  return _restartBoxChainStep(st, idx, remainingEnergy, nextFutures, pool);
});

// ── 除蟲噴霧（Item / I）── v2.179 ────────────────────────────────────────────
// 卡面：將對手的戰鬥寶可夢與備戰寶可夢互換。[由對手選擇放置於戰鬥場的寶可夢。]
// 實裝：用既有 force-opp-swap resolver — 對對手開 bench-choose pending（min=1 max=1）。
// gate：對手有 active + 至少 1 隻備戰。
regG('除蟲噴霧', (st, idx, pool) => {
  const dp = st.players[(1 - idx) as 0 | 1];
  if (!dp.active || dp.bench.length < 1) return false;
  // v5.995 audit：C-04 目標=對手戰鬥寶可夢 → 緊張感/融合為雪(不受對手物品)active 擋(HEAD 漏 gate)
  return !_v3060IsImmuneOppTrainer(st, (1 - idx) as 0 | 1, dp.active, pool);
});
reg('除蟲噴霧', (st, idx, _pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  if (!dp.active || dp.bench.length === 0) return st;
  // v5.995 audit：緊張感/融合為雪 active 不受對手物品效果 → 不被強制換位
  if (_v3060IsImmuneOppTrainer(st, dIdx, dp.active, _pool)) {
    return addLog(st, '除蟲噴霧：對手的戰鬥寶可夢不受對手物品卡效果影響，無法互換', idx);
  }
  st = addLog(st, '除蟲噴霧：對手必須將戰鬥寶可夢與備戰寶可夢互換（由對手選擇）', idx);
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'force-opp-swap',
    params: { label: '除蟲噴霧', attackerIdx: idx },
  });
});

// ── 妨害信函（Item / H）── v2.177 ────────────────────────────────────────────
// 卡面：對手數過對手自己的手牌張數後，全部翻回反面並重洗，放回牌庫下方。
//       然後，對手從牌庫抽出與放回的張數相同數量的卡。
// 實裝：對手手牌 → 洗回對手牌庫底 → 對手抽 N 張。
// gate：對手手牌 ≥1（為 0 時打出沒意義，避免浪費 Item）。
regG('妨害信函', (st, idx) => st.players[(1 - idx) as 0 | 1].hand.length >= 1);
reg('妨害信函', (st, idx, _pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const handCount = st.players[dIdx].hand.length;
  if (handCount === 0) return st;
  st = addLog(st, `妨害信函：對手手牌 ${handCount} 張全部洗回牌庫底，再抽相同張數`, idx);
  st = updatePlayer(st, dIdx, p => {
    // v6.124 收斂：卡面「全部翻回反面並重洗，放回牌庫下方」——只洗手牌那幾張。
    return { ...p, hand: [], deck: deckWithCardsToBottom(p.deck, p.hand, 'shuffled') };
  });
  st = drawCards(st, dIdx, handCount);
  return st;
});

// ── 豐收漁網（Item / J）── v2.186 ─────────────────────────────────────────────
// 卡面：「從自己的棄牌區選擇【水】寶可夢卡與『基本【水】能量』卡最多各 3 張，
//        在給對手看過後放回牌庫並重洗。」
// 實裝（v5.487 單一合併 picker，參考 水蓮的照顧/小剛的發掘）：
//   discard-search filter='WaterPokemonOrBasicWaterEnergy' → 'fishnet-unified'
//   UI(fishnetPickState) enforce 寶可夢 ≤3、能量 ≤3（各 3）；resolver 防衛性再 cap。
// gate：棄牌有 ≥1 張【水】寶可夢 或 基本【水】能量
regG('豐收漁網', (st, idx, pool) => {
  const p = st.players[idx];
  const hasWaterPoke = p.discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.pokemonType === 'Water';
  });
  const hasBasicWater = p.discard.some(c => isBasicEnergyOfType(pool.get(c.cardId), 'Water'));
  return hasWaterPoke || hasBasicWater;
});
// v5.487：改單一合併 picker（參考 水蓮的照顧/小剛的發掘）— 同 modal 顯示【水】寶可夢 + 基本【水】能量，
//   UI 端分類上限：寶可夢最多 3、能量最多 3（各 3，非合計）。發動後必選（不在 OPTIONAL 白名單）。
//   filter='WaterPokemonOrBasicWaterEnergy'；effectKey='fishnet-unified'（UI fishnetPickState enforce）。
reg('豐收漁網', (st, idx, pool) => {
  const p = st.players[idx];
  const waterPoke = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.pokemonType === 'Water';
  }).length;
  const waterEnergy = p.discard.filter(c => isBasicEnergyOfType(pool.get(c.cardId), 'Water')).length;
  const maxCount = Math.min(3, waterPoke) + Math.min(3, waterEnergy);
  // v5.488：除 filter 字串外，再用 validIids 硬列合法卡 iid（棄牌區【水】寶可夢 + 基本【水】能量），
  //   確保 picker modal 絕不顯示其他卡（如支援者）—— discard-search 的 validIids 為硬性白名單。
  const validIids = p.discard.filter(co => {
    const card = pool.get(co.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon' && card.pokemonType === 'Water') return true;
    if (isBasicEnergyOfType(card, 'Water')) return true;
    return false;
  }).map(co => co.iid);
  st = addLog(st, '豐收漁網：從棄牌區選【水】寶可夢與基本【水】能量（各最多 3 張）放回牌庫並重洗', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'WaterPokemonOrBasicWaterEnergy', minCount: 0, maxCount,
    effectKey: 'fishnet-unified',
    params: { validIids },
  });
});
regR('fishnet-unified', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(st, '豐收漁網：未選擇任何卡，效果結束', idx);
  }
  const p = st.players[idx];
  const selected = p.discard.filter(c => iids.includes(c.iid));
  // 防衛性各型上限 3（UI 端 fishnetPickState 已 enforce；此處避免 server/sim 收到超量）
  const pokes = selected.filter(c => pool.get(c.cardId)?.supertype === 'Pokemon').slice(0, 3);
  const energies = selected.filter(c => pool.get(c.cardId)?.supertype === 'Energy').slice(0, 3);
  const picks = [...pokes, ...energies];
  const pickSet = new Set(picks.map(c => c.iid));
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `豐收漁網：${picks.length} 張（${names}）放回牌庫並重洗`, idx);
  return updatePlayer(st, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => !pickSet.has(c.iid)),
    // v5.993：進牌庫前 toBareCard 裸化(棄牌卡帶場上 transient 旗標，防外洩回場)
    deck: shuffle([...pl.deck, ...picks.map(toBareCard)]),
  }));
});

// ── 鬼之假面（Item / H）── v2.193 ────────────────────────────────────────────
// 卡面：「從自己的棄牌區選擇1張名稱中有「厄鬼椪」的「寶可夢【ex】」卡，
//        與自己的場上的1隻名稱中有「厄鬼椪」的「寶可夢【ex】」互換
//        （所附加的卡・傷害指示物・特殊狀態・效果等全部保留）。將換下的寶可夢丟棄。」
//
// 實裝（兩階段 pending）：
//   1. discard-search filter='Pokemon:NamePrefix=厄鬼椪' min=1 max=1 → 'oni-mask-step1'
//   2. step1 resolver 暫存 picked discard iid → 開 bench-choose w/ includeActive
//      讓玩家選場上的厄鬼椪 ex → 'oni-mask-step2'
//   3. step2 resolver 執行 swap：
//      - 場上目標的 cardId 改成 discard pick 的 cardId（保留 energy/tool/damage/status/evolvedFromStack）
//      - 場上目標**舊的** cardId 裸殼 → 棄牌
//      - discard pick 從棄牌移除
//
// 卡名 fuzzy filter：'Pokemon:NamePrefix=厄鬼椪' 會 match 厄鬼椪所有版本（含非 ex）。
// 嚴格規則要求 ex，但 deck building 通常只放 ex 版本，玩家會自行避免選錯。
// 若選非 ex resolver 仍會執行 swap（不限 ex），這是可接受的 trade-off。
//
// gate：棄牌有名字含厄鬼椪的寶可夢卡 + 場上 active/bench 有名字含厄鬼椪的寶可夢
function hasOnishimaPoke(insts: import('../../types').CardInstance[],
                          pool: Map<string, import('$lib/cards/types').Card>): boolean {
  return insts.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && card.name.includes('厄鬼椪');
  });
}
// v5.844 清除重複死碼(生效版保留在他處),原行 1511
// v5.844 清除重複死碼(生效版保留在他處),原行 1516
regR('oni-mask-step1', (st, idx, iids, _params, _pool) => {
  if (iids.length !== 1) {
    return addLog(st, '鬼之假面：取消（未選擇）', idx);
  }
  st = addLog(st, '鬼之假面：再選擇場上的「厄鬼椪 ex」與其互換', idx);
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'oni-mask-step2',
    params: { includeActive: true, fromDiscardIid: iids[0] },
  });
});
regR('oni-mask-step2', (st, idx, iids, params, pool) => {
  const fromDiscardIid = (params?.fromDiscardIid as string) ?? '';
  const targetIid = iids[0];
  if (!fromDiscardIid || !targetIid) {
    return addLog(st, '鬼之假面：取消（未選擇場上目標）', idx);
  }
  const p = st.players[idx];
  const discardPick = p.discard.find(c => c.iid === fromDiscardIid);
  if (!discardPick) return addLog(st, '鬼之假面：棄牌中找不到所選卡，取消', idx);
  const fieldTarget = p.active?.iid === targetIid ? p.active
    : p.bench.find(c => c.iid === targetIid);
  if (!fieldTarget) return addLog(st, '鬼之假面：場上找不到所選目標，取消', idx);

  const oldCardName = pool.get(fieldTarget.cardId)?.name ?? '?';
  const newCardName = pool.get(discardPick.cardId)?.name ?? '?';

  // 換下的寶可夢「裸殼」→ 棄牌（不帶 energy/tool/damage/status/evolvedFromStack）
  const oldBare: import('../../types').CardInstance = {
    iid: fieldTarget.iid + '-old-' + Date.now(),
    cardId: fieldTarget.cardId,
    damage: 0,
    energyAttached: [],
  };

  // 互換：把場上 instance 的 cardId 改成 discardPick 的 cardId
  const swapped: import('../../types').CardInstance = {
    ...fieldTarget,
    cardId: discardPick.cardId,
    // 保留：damage/energy/tool/status/secondaryStatus/evolvedFromStack/各種旗標
    // v5.625 官方QA：特性已使用以名稱保留(換上不同名特性可用、同名沿用已用)
    abilityUsedThisTurn: abilityUsedAfterSwap(fieldTarget, pool.get(fieldTarget.cardId), pool.get(discardPick.cardId)),
  };

  st = addLog(st, `鬼之假面：${oldCardName} ↔ ${newCardName}（保留所有附加）；換下的 ${oldCardName} 丟棄`, idx);

  return updatePlayer(st, idx, pl => ({
    ...pl,
    active: pl.active?.iid === targetIid ? swapped : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid ? swapped : c),
    discard: [...pl.discard.filter(c => c.iid !== fromDiscardIid), oldBare],
  }));
});

// ── 變化之書（Item / J）── v2.193 ────────────────────────────────────────────
// 卡面：「『變化之書』只可2張同時使用。（效果是2張生效1次。）
//        從自己的棄牌區選擇1張【基礎】寶可夢卡，與自己的場上的1隻【基礎】寶可夢互換
//        （所附加的卡・傷害指示物・特殊狀態・效果等全部保留）。將換下的寶可夢丟棄。」
//
// 「2 張同時使用」實裝：
//   - regG: 手牌中變化之書 ≥2 張 + 棄牌有基礎寶可夢 + 場上有基礎寶可夢
//   - reg: 觸發時，PLAY_TRAINER 已把使出的第 1 張變化之書棄掉，這裡再從手牌
//          找第 2 張同名卡棄掉，然後開 swap pending
//
// Swap pattern 同鬼之假面（兩階段）：
//   1. discard-search filter='Basic' min=1 max=1 → 'changing-book-step1'
//   2. step1 → bench-choose w/ includeActive，filter Basic Pokemon → 'changing-book-step2'
//   3. step2 swap：保留 energy/tool/damage/status/evolvedFromStack
function isBasicOnField(insts: import('../../types').CardInstance[],
                       pool: Map<string, import('$lib/cards/types').Card>): boolean {
  return insts.some(c => {
    const card = pool.get(c.cardId);
    return !!card && card.supertype === 'Pokemon' && !card.evolvesFrom
      && card.subtype !== 'Stage1' && card.subtype !== 'Stage2' && card.subtype !== 'Other';
  });
}
regG('變化之書', (st, idx, pool) => {
  const p = st.players[idx];
  // 必須手牌 ≥2 張同名（一張正在打出 = 還在 hand，另一張要棄）
  const handBookCount = p.hand.filter(c => pool.get(c.cardId)?.name === '變化之書').length;
  if (handBookCount < 2) return false;
  const fieldInsts = [...(p.active ? [p.active] : []), ...p.bench];
  // 棄牌中有基礎寶可夢
  const hasBasicInDiscard = p.discard.some(c => {
    const card = pool.get(c.cardId);
    return !!card && card.supertype === 'Pokemon' && !card.evolvesFrom
      && card.subtype !== 'Stage1' && card.subtype !== 'Stage2' && card.subtype !== 'Other';
  });
  return hasBasicInDiscard && isBasicOnField(fieldInsts, pool);
});
reg('變化之書', (st, idx, pool) => {
  // 棄掉第二張變化之書（PLAY_TRAINER 已棄掉第一張）
  const p = st.players[idx];
  const secondBookIdx = p.hand.findIndex(c => pool.get(c.cardId)?.name === '變化之書');
  if (secondBookIdx < 0) return addLog(st, '變化之書：缺第二張（gate 異常）', idx);
  const secondBook = p.hand[secondBookIdx];
  st = updatePlayer(st, idx, pl => ({
    ...pl,
    hand: pl.hand.filter((_, i) => i !== secondBookIdx),
    discard: [...pl.discard, secondBook],
  }));
  st = addLog(st, '變化之書：2 張同時使用，第二張也棄到棄牌區', idx);
  st = addLog(st, '變化之書：從棄牌選 1 張【基礎】寶可夢', idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic', minCount: 1, maxCount: 1,
    effectKey: 'changing-book-step1',
  });
});
regR('changing-book-step1', (st, idx, iids, _params, _pool) => {
  if (iids.length !== 1) {
    return addLog(st, '變化之書：取消（未選擇）', idx);
  }
  st = addLog(st, '變化之書：再選擇場上的【基礎】寶可夢與其互換', idx);
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'changing-book-step2',
    params: { includeActive: true, fromDiscardIid: iids[0], filterBasic: true },
  });
});
regR('changing-book-step2', (st, idx, iids, params, pool) => {
  const fromDiscardIid = (params?.fromDiscardIid as string) ?? '';
  const targetIid = iids[0];
  if (!fromDiscardIid || !targetIid) {
    return addLog(st, '變化之書：取消（未選擇場上目標）', idx);
  }
  const p = st.players[idx];
  const discardPick = p.discard.find(c => c.iid === fromDiscardIid);
  if (!discardPick) return addLog(st, '變化之書：棄牌中找不到所選卡，取消', idx);
  const fieldTarget = p.active?.iid === targetIid ? p.active
    : p.bench.find(c => c.iid === targetIid);
  if (!fieldTarget) return addLog(st, '變化之書：場上找不到所選目標，取消', idx);

  // 確認場上目標是基礎寶可夢（防呆）
  const fieldCard = pool.get(fieldTarget.cardId);
  if (!fieldCard || fieldCard.supertype !== 'Pokemon' || fieldCard.evolvesFrom
      || fieldCard.subtype === 'Stage1' || fieldCard.subtype === 'Stage2') {
    return addLog(st, '變化之書：場上目標非【基礎】寶可夢，取消', idx);
  }

  const oldCardName = fieldCard.name;
  const newCardName = pool.get(discardPick.cardId)?.name ?? '?';

  const oldBare: import('../../types').CardInstance = {
    iid: fieldTarget.iid + '-old-' + Date.now(),
    cardId: fieldTarget.cardId,
    damage: 0,
    energyAttached: [],
  };

  const swapped: import('../../types').CardInstance = {
    ...fieldTarget,
    cardId: discardPick.cardId,
    // v5.625 官方QA：特性「已使用」以名稱保留——換上不同名特性可用、同名沿用已用(不再整包帶 true 誤擋)
    abilityUsedThisTurn: abilityUsedAfterSwap(fieldTarget, fieldCard, pool.get(discardPick.cardId)),
  };

  st = addLog(st, `變化之書：${oldCardName} ↔ ${newCardName}（保留所有附加）；換下的 ${oldCardName} 丟棄`, idx);

  return updatePlayer(st, idx, pl => ({
    ...pl,
    active: pl.active?.iid === targetIid ? swapped : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid ? swapped : c),
    discard: [...pl.discard.filter(c => c.iid !== fromDiscardIid), oldBare],
  }));
});

// ── 奇異時鐘（Item / I）── v2.194 ────────────────────────────────────────────
// 卡面：「選擇1隻自己的進化的【超】寶可夢，移除任意數量的「進化卡」使其退化。
//        將移除的卡放回手牌。[退化的寶可夢在那個回合無法進化。]」
//
// 實裝（兩段 pending）：
//   1. bench-choose w/ includeActive 選自己的【超】Stage1/Stage2 寶可夢 → 'odd-clock-step1'
//   2. step1：根據 target 的 stack 長度決定退化選項：
//      - Stage1（stack 長度 1）：直接退 1 層（自動，不問）
//      - Stage2（stack 長度 2）：modal-choice 1 / 2 層
//   3. step2 / inline：執行 pop —
//      - 移除 N 層（含當前頂層）→ 對應 cardId 包成新 hand instance 放回手牌
//      - instance 的 cardId 改成 stack[len-N] 的 cardId
//      - evolvedFromStack 切到 stack.slice(0, len - N)
//      - 設 evolvedThisTurn=true（達成「那個回合無法進化」）
// v6.020：改回傳 iid 清單（gate 與 picker 同 predicate，杜絕漂移，v5.996 教訓）— 自己場上「進化的【超】寶可夢」
// ⭐ v6.207：「自己的進化的【超】寶可夢」＝場上有效屬性（小碎鑽在場上是【鬥】＋【超】）。
//   簽名多收 st/idx 是**必填**——強迫呼叫端提供場上脈絡，不會靜默退回印刷屬性。
function psychicEvoIids(st: import('../../types').GameState, idx: 0 | 1,
                       insts: import('../../types').CardInstance[],
                       pool: Map<string, import('$lib/cards/types').Card>): string[] {
  return insts.filter(c => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon'
        || !hasEffectivePokemonType(st, idx, c, card, pool, 'Psychic')) return false;
    return card.subtype === 'Stage1' || card.subtype === 'Stage2'
      || card.stage === 'Stage1' || card.stage === 'Stage2';
  }).map(c => c.iid);
}
regG('奇異時鐘', (st, idx, pool) => {
  const p = st.players[idx];
  const fieldInsts = [...(p.active ? [p.active] : []), ...p.bench];
  return psychicEvoIids(st, idx, fieldInsts, pool).length > 0;
});
reg('奇異時鐘', (st, idx, pool) => {
  const p = st.players[idx];
  const fieldInsts = [...(p.active ? [p.active] : []), ...p.bench];
  const validIids = psychicEvoIids(st, idx, fieldInsts, pool);
  st = addLog(st, '奇異時鐘：選擇 1 隻自己的進化【超】寶可夢退化', idx);
  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'odd-clock-step1',
    params: { includeActive: true, validIids, label: '選擇要退化的【超】進化寶可夢' },
  });
});
regR('odd-clock-step1', (st, idx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return addLog(st, '奇異時鐘：取消（未選擇）', idx);
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active
    : p.bench.find(c => c.iid === targetIid);
  if (!target) return addLog(st, '奇異時鐘：場上找不到所選目標', idx);

  const tCard = pool.get(target.cardId);
  if (!tCard || !hasEffectivePokemonType(st, idx, target, tCard, pool, 'Psychic')) {
    return addLog(st, '奇異時鐘：所選目標非【超】寶可夢，取消', idx);
  }
  const stage = tCard.subtype === 'Stage2' || tCard.stage === 'Stage2' ? 'Stage2'
    : (tCard.subtype === 'Stage1' || tCard.stage === 'Stage1' ? 'Stage1' : 'Basic');
  if (stage === 'Basic') {
    return addLog(st, '奇異時鐘：所選目標非進化寶可夢，取消', idx);
  }

  if (stage === 'Stage1') {
    // 自動退 1 層
    return doOddClockDevolve(st, idx, targetIid, 1, pool);
  }
  // Stage2 → 問玩家退 1 還是 2 層
  st = addLog(st, '奇異時鐘：選擇要退化的層數', idx);
  return withPending(st, {
    type: 'modal-choice', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'odd-clock-step2',
    params: {
      label: '奇異時鐘',
      targetIid,
      options: [
        { id: '1', text: '①退化 1 層（→ 1 階進化）' },
        { id: '2', text: '②退化 2 層（→ 基礎）' },
      ],
    },
  });
});
regR('odd-clock-step2', (st, idx, iids, params, pool) => {
  const choice = iids[0];
  const targetIid = (params?.targetIid as string) ?? '';
  if (!choice || !targetIid) return st;
  const layers = choice === '2' ? 2 : 1;
  return doOddClockDevolve(st, idx, targetIid, layers, pool);
});
function doOddClockDevolve(
  st: import('../../types').GameState, idx: 0 | 1, targetIid: string, layers: number,
  pool: Map<string, import('$lib/cards/types').Card>
): import('../../types').GameState {
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active
    : p.bench.find(c => c.iid === targetIid);
  if (!target) return addLog(st, '奇異時鐘：找不到目標，取消', idx);
  const stack = target.evolvedFromStack ?? [];
  if (stack.length < layers) {
    return addLog(st, `奇異時鐘：堆疊深度不足以退化 ${layers} 層，取消`, idx);
  }
  // v5.984：退化建構收斂中央 buildDevolvedInstance(暈眩山谷混亂例外+唯一 removed iid;多層退化 layers)
  const removedCardIds: string[] = [target.cardId];
  for (let i = 1; i < layers; i++) {
    removedCardIds.push(stack[stack.length - i].cardId);
  }
  const newBaseInst = stack[stack.length - layers];
  const _dv = buildDevolvedInstance(target, layers, st, pool, { evolvedThisTurn: true });
  if (!_dv) return addLog(st, `奇異時鐘：堆疊深度不足以退化 ${layers} 層，取消`, idx);
  const handCards: import('../../types').CardInstance[] = _dv.removedCards;
  // v2.261 Bug C-13：退化規則 — 保留 damage / energy / tool（PDF §II-C-13），
  //   清除特殊狀態與附加效果（跟進化規則一致 — PDF 明文「退化後特殊狀態與附加效果消除」）。
  // v5.672：清狀態+附加效果改用中央 clearActiveEffects(CLEAR_ON_EXIT_FLAGS,~50旗標)。原只清 7 個,
  //   漏其餘效果旗標(純樸 immuneToAttackEffects/takeExtra/weaknessOverride/retaliate 等);PDF §II-C-13
  //   「退化後特殊狀態與附加效果消除」=與進化一致全清(保留 damage/能量/道具)。
  const devolved: import('../../types').CardInstance = _dv.devolved;
  const oldName = pool.get(target.cardId)?.name ?? '?';
  const newName = pool.get(newBaseInst.cardId)?.name ?? '?';
  const cardNames = removedCardIds.map(cid => pool.get(cid)?.name ?? '?').join('、');
  st = addLog(st, `奇異時鐘：${oldName} 退化 ${layers} 層成 ${newName}（移除：${cardNames} 放回手牌）`, idx);
  return updatePlayer(st, idx, pl => ({
    ...pl,
    active: pl.active?.iid === targetIid ? devolved : pl.active,
    bench: pl.bench.map(c => c.iid === targetIid ? devolved : c),
    hand: [...pl.hand, ...handCards],
  }));
}

// ── 化石卡 5 張（v2.187 核心 scaffold）── ────────────────────────────────────
// 共通機制：作為 HP60【無】基礎寶可夢上場、**可被進化**（化石→Stage1→Stage2，
//          5 條鏈見 FOSSIL_DESIGN.md）、不能撤退、不會中異常狀態、自己回合可丟棄
//          （非昏厥）。詳細規則見 engine.ts FOSSIL_ITEM_NAMES / PLAY_FOSSIL /
//          DISCARD_FOSSIL handler。
//
// 這些卡不走一般 Item 的 PLAY_TRAINER 路徑：
//   - 從手牌打到備戰 → PLAY_FOSSIL action（UI 拖曳會觸發此 action）
//   - 場上自主丟棄 → DISCARD_FOSSIL action
//
// 因此這裡只用「永遠 false 的 regG」佔位，讓一般 Item 路徑無法觸發。
// 各自的被動效果（v2.188+）會在獨立 hook map 實裝。
//
// 名稱列表 = engine.ts FOSSIL_ITEM_NAMES（保持同步）：
//   陳舊的根狀化石（H）、陳舊的背蓋化石（H）、陳舊的羽毛化石（I）、
//   陳舊的顎之化石（J）、陳舊的鰭之化石（J）
const FOSSIL_NAMES_LOCAL = [
  '陳舊的根狀化石',
  '陳舊的背蓋化石',
  '陳舊的羽毛化石',
  '陳舊的顎之化石',
  '陳舊的鰭之化石',
  // v4.895 / M5 — 陳舊的頭蓋/盾牌化石（透過 化石採掘場 從牌庫放到備戰；regG=false 阻擋
  // PLAY_TRAINER 路徑使用，化石只能走 PLAY_FOSSIL 或 化石採掘場 resolver 路徑）
  // v4.896：原譯「古老的」校正為「陳舊的」與既有命名一致。
  '陳舊的頭蓋化石',
  '陳舊的盾甲化石',
];
for (const name of FOSSIL_NAMES_LOCAL) {
  // 永遠 false：阻擋 Item 路徑（拖到 PLAY_TRAINER 不能用）
  regG(name, () => false);
  // reg fallback：不會被 PLAY_TRAINER 觸發到（因為 regG=false），但保留 noop 以利 audit 識別
  reg(name, (st) => st);
}

