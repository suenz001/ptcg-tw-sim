/**
 * v2.374 — 火箭隊的以歐路普｜火箭腦力（regA）
 *
 * 卡面（SV10 12794 / 再印 12909）：
 *   「在自己的回合時，可不限次數使用。選擇1個自己的場上的「火箭隊的寶可夢」身上
 *     放置的傷害指示物，改放於自己的其他寶可夢身上。」
 *
 * 關鍵設計：
 *   - 不限次數使用 → 不需要 abilityNamesUsedThisTurn check
 *   - 來源限「自己場上的『火箭隊的』寶可夢」（卡名以「火箭隊的」開頭）
 *   - 目標限「自己場上其他寶可夢」（不能放回原本那隻）
 *   - 監視之眼 gate：v2.372 已把「火箭腦力」加進 MOVE_DAMAGE_COUNTER_ABILITIES set，
 *     engine.ts ability availability 迴圈會自動套用 isAbilityBlockedByOakEye()，
 *     本檔僅在 regA 入口加同樣 short-circuit 作為 runtime 防備。
 *
 * 實作流程（兩階段 pendingSelection）：
 *   1. heal-target picker：選來源（filter: 卡名以「火箭隊的」開頭 + damage >= 10）
 *      → resolver 'rocket-brain-source' 紀錄 sourceIid，跳第 2 階段
 *   2. heal-target picker：選目標（filter: 自己場上其他寶可夢，排除來源）
 *      → resolver 'rocket-brain-target' 從來源移除 1 顆指示物（-10 damage）
 *        加到目標（+10 damage），含 KO 判定（自己 KO 自己幾乎不會發生但保險寫）。
 *
 * ⚠️ 鐵律遵循：
 *   - 監視之眼 gate 用 isAbilityBlockedByOakEye() 通用 helper（v2.372 set 已涵蓋）
 *   - 對手場上有探探鼠也會擋（雙方都不能用此特性，符合卡面）
 */

import type { CardInstance } from '../../types';
import {
  regA, regR,
  addLog, updatePlayer, withPending,
  isAbilityBlockedByOakEye,
} from '../_shared';
import { markDamageCounterMovedFrom } from '../_shared'; // v5.947 移動指示物非治療

// ══════════════════════════════════════════════════════════════════════════════
// 火箭隊的以歐路普｜火箭腦力（regA index 0）
// ══════════════════════════════════════════════════════════════════════════════
regA('火箭隊的以歐路普', 0, (st, idx, pool) => {
  // 監視之眼 gate（v2.372 通用標籤判定）
  if (isAbilityBlockedByOakEye(st, '火箭腦力', pool)) {
    // v6.049 措辭更正：阻擋效果 ≠ 消除特性
    return addLog(st, '火箭腦力：發動了，但被探探鼠的監視之眼擋下（傷害指示物無法改放）', idx);
  }

  const player = st.players[idx];
  const allOwn: CardInstance[] = [
    ...(player.active ? [player.active] : []),
    ...player.bench,
  ];

  // 來源候選：自己場上的「火箭隊的」寶可夢 + 至少 1 顆指示物
  const sources = allOwn.filter(c => {
    const card = pool.get(c.cardId);
    return !!card?.name?.startsWith('火箭隊的') && c.damage >= 10;
  });
  if (sources.length === 0) {
    return addLog(st, '火箭腦力：場上沒有「火箭隊的」寶可夢有傷害指示物', idx);
  }

  // 目標候選：自己場上至少 ≥ 2 隻（含來源）才能轉移（必須有「其他寶可夢」可放）
  if (allOwn.length < 2) {
    return addLog(st, '火箭腦力：場上沒有其他寶可夢可接收指示物', idx);
  }

  st = addLog(st, '火箭腦力：選 1 隻場上的「火箭隊的」寶可夢作為來源', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'rocket-brain-source',
    params: { validIids: sources.map(c => c.iid) },
  });
});

// 第 1 階段 resolver — 紀錄 sourceIid，開第 2 階段 picker
regR('rocket-brain-source', (st, idx, iids, params, pool) => {
  const validIids = (params?.validIids as string[]) ?? [];
  const sourceIid = iids[0];
  if (!sourceIid || !validIids.includes(sourceIid)) {
    return addLog(st, '火箭腦力：來源不合法', idx);
  }

  const player = st.players[idx];
  const sourceInst = player.active?.iid === sourceIid
    ? player.active
    : player.bench.find(c => c.iid === sourceIid);
  if (!sourceInst) return addLog(st, '火箭腦力：來源已不在場上', idx);

  // 目標候選：自己場上其他寶可夢（排除來源 iid）
  const targets: CardInstance[] = [
    ...(player.active && player.active.iid !== sourceIid ? [player.active] : []),
    ...player.bench.filter(c => c.iid !== sourceIid),
  ];
  if (targets.length === 0) {
    return addLog(st, '火箭腦力：場上沒有其他寶可夢可接收指示物', idx);
  }

  const sourceName = pool.get(sourceInst.cardId)?.name ?? '?';
  st = addLog(st, `火箭腦力：選 1 隻其他寶可夢接收 ${sourceName} 身上的 1 顆指示物`, idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'rocket-brain-target',
    params: { sourceIid, validIids: targets.map(c => c.iid) },
  });
});

// 第 2 階段 resolver — 來源 -10 傷害，目標 +10 傷害（含 KO 判定）
regR('rocket-brain-target', (st, idx, iids, params, pool) => {
  const sourceIid = params?.sourceIid as string | undefined;
  const validIids = (params?.validIids as string[]) ?? [];
  const targetIid = iids[0];
  if (!sourceIid || !targetIid || !validIids.includes(targetIid) || sourceIid === targetIid) {
    return addLog(st, '火箭腦力：目標不合法', idx);
  }

  const player = st.players[idx];
  const findInst = (iid: string): CardInstance | undefined =>
    player.active?.iid === iid ? player.active : player.bench.find(c => c.iid === iid);

  const source = findInst(sourceIid);
  const target = findInst(targetIid);
  if (!source || !target) {
    return addLog(st, '火箭腦力：來源或目標已不在場上', idx);
  }

  const sourceName = pool.get(source.cardId)?.name ?? '?';
  const targetName = pool.get(target.cardId)?.name ?? '?';

  // 一律移動 1 顆指示物（卡面：「選擇1個」）
  // 來源 -10 傷害，目標 +10 傷害
  st = addLog(st, `火箭腦力：${sourceName} -10 傷害 / ${targetName} +10 傷害`, idx);

  st = updatePlayer(st, idx, p => {
    const updateInst = (c: CardInstance): CardInstance => {
      if (c.iid === sourceIid) return { ...c, damage: Math.max(0, c.damage - 10) };
      if (c.iid === targetIid) return { ...c, damage: c.damage + 10 };
      return c;
    };
    return {
      ...p,
      active: p.active ? updateInst(p.active) : null,
      bench: p.bench.map(updateInst),
    };
  });
  return markDamageCounterMovedFrom(st, sourceIid);  // v5.947 火箭腦力移動指示物(非治療)→來源不算 healedThisTurn
  // 注意：指示物轉移到「自己」其他寶可夢上，理論上不會超過 HP 的情況極少見；
  //   若超過 HP 引發 KO 判定，由 engine 的下次 game state cycle 處理（pendingSelection
  //   resolve 後，engine 會做 KO check）。本 resolver 不在這裡 inline KO，避免重複處理。
});
