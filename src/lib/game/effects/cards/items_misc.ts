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
  addLog, updatePlayer, withPending,
  shuffle,
  drawCards, returnHandToDeck,
  clearActiveEffects,
  healResolver,
} from '../_shared';
import type { EffectFn } from '../_shared';

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
reg('急進開關', switchEffect('急進開關'));
// 切換類：備戰必須有寶可夢
regG('寶可夢交替', (st, idx) => st.players[idx].bench.length > 0);
regG('急進開關', (st, idx) => st.players[idx].bench.length > 0);

regR('do-switch', (st, idx, iids, _params, pool) => {
  const prevPlayer = st.players[idx];
  const target = prevPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = prevPlayer.active ? (pool.get(prevPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `→ 將 ${oldName} 換到備戰區，派出 ${newName} 到戰鬥場`, idx);
  return updatePlayer(st, idx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newActive = { ...p.bench[bIdx], justPlaced: false };
    const newBench = [...p.bench];
    // v2.08：離開戰鬥場清狀態旗標
    newBench[bIdx] = clearActiveEffects(p.active);
    return { ...p, active: newActive, bench: newBench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 藥水 / 回復
// ══════════════════════════════════════════════════════════════════════════════

// 好傷藥 — 回復 60 HP，丟棄 1 個能量
// Guard: 場上至少 1 隻寶可夢「有傷害且身上有能量」
regG('好傷藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0 && c.energyAttached.length > 0);
});
reg('好傷藥', (st, idx) => {
  st = addLog(st, '好傷藥：選擇回復 60 HP 的寶可夢（丟棄 1 個能量）', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-60-discard-1',
    params: { healAmount: 60, discardEnergy: 1 },
  });
});

// 龍之秘藥 — 回復 120 HP（簡化，原版有條件）
// Guard: 場上至少 1 隻寶可夢有傷害
regG('龍之秘藥', (st, idx) => {
  const all = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return all.some(c => c.damage > 0);
});
reg('龍之秘藥', (st, idx) => {
  st = addLog(st, '龍之秘藥：選擇回復 120 HP 的寶可夢', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'heal-120',
    params: { healAmount: 120, discardEnergy: 0 },
  });
});

regR('heal-60-discard-1', healResolver);
regR('heal-120', healResolver);

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
    if (card?.supertype === 'Pokemon' && card.subtype !== 'Other') return true;
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
regG('能量回收器', (st, idx, pool) =>
  st.players[idx].discard.some(c => pool.get(c.cardId)?.supertype === 'Energy')
);
reg('能量回收器', (st, idx, pool) => {
  const energies = st.players[idx].discard.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
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
regR('energy-retrieval', (st, idx, iids, _params, _pool) => {
  const n = iids.length;
  st = addLog(st, `能量回收器：${n} 張基本能量洗回牌庫`, idx);
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
    return { ...p, discard: p.discard.filter(c => !iids.includes(c.iid)), hand: [...p.hand, ...picked] };
  });
});

// 奇跡修正檔 — 從棄牌區選 1 張基本超能量，附於備戰的超寶可夢身上（兩步）
regG('奇跡修正檔', (st, idx, pool) => {
  // 棄牌區有能量 + 備戰有超屬寶可夢才能打
  const hasEnergy = st.players[idx].discard.some(c => pool.get(c.cardId)?.supertype === 'Energy');
  const hasPsychicBench = st.players[idx].bench.some(b => pool.get(b.cardId)?.pokemonType === 'Psychic');
  return hasEnergy && hasPsychicBench;
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
  if (player.bench.length === 0) {
    // 直接附到出場寶可夢
    const activeName = player.active ? (pool.get(player.active.cardId)?.name ?? '出場寶可夢') : '出場寶可夢';
    st = addLog(st, `奇跡修正檔：將 ${energyName} 附加到 ${activeName}`, idx);
    return updatePlayer(st, idx, (p) => {
      const energyCard = p.discard.find(c => c.iid === energyIid);
      if (!energyCard || !p.active) return p;
      return {
        ...p,
        discard: p.discard.filter(c => c.iid !== energyIid),
        active: { ...p.active, energyAttached: [...p.active.energyAttached, energyCard] },
      };
    });
  }
  return withPending(st, {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'miracle-codec-attach',
    params: { energyIid, energyName },
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
regG('頂尖捕捉器', (st, idx) => st.players[(1 - idx) as 0 | 1].bench.length > 0);
reg('頂尖捕捉器', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  if (st.players[oppIdx].bench.length === 0) {
    return addLog(st, '頂尖捕捉器：對手備戰區沒有寶可夢', idx);
  }
  st = addLog(st, '頂尖捕捉器：選擇要呼叫的對手備戰寶可夢', idx);
  return withPending(st, {
    type: 'opp-bench-choose',
    actorIdx: idx, sourcePlayerIdx: oppIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'top-catcher-opp',
  });
});
regR('top-catcher-opp', (st, idx, iids, _params, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const oppPlayer = st.players[oppIdx];
  const target = oppPlayer.bench.find(c => c.iid === iids[0]);
  const newName = target ? (pool.get(target.cardId)?.name ?? '?') : '?';
  const oldName = oppPlayer.active ? (pool.get(oppPlayer.active.cardId)?.name ?? '?') : '?';
  st = addLog(st, `頂尖捕捉器：將對手戰鬥場的 ${oldName} 換到備戰區，呼叫 ${newName} 到對手戰鬥場`, idx);
  // 切換對手備戰 → 對手出場
  st = updatePlayer(st, oppIdx, (p) => {
    if (!p.active) return p;
    const bIdx = p.bench.findIndex(c => c.iid === iids[0]);
    if (bIdx < 0) return p;
    const newBench = [...p.bench];
    // v2.08：離開戰鬥場清狀態旗標
    newBench[bIdx] = clearActiveEffects(p.active);
    return { ...p, active: { ...p.bench[bIdx], justPlaced: false }, bench: newBench };
  });
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
// v3 fix：加一個回合開始時的獨立快照 oppPrizesAtMyTurnStart[idx]，
//         gate 條件改為 TurnStart < LastTurnEnd（= 對手在他們剛結束的回合取過獎賞）。
//         自己回合的自 KO 只會讓「目前 opp.prizes」變少但 TurnStart 已鎖定，不會觸發。
regG('不公印章', (st, idx) => {
  const lastEnd = st.oppPrizesAtMyLastTurnEnd?.[idx] ?? 6;
  const turnStart = st.oppPrizesAtMyTurnStart?.[idx] ?? 6;
  return turnStart < lastEnd;
});
reg('不公印章', (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  st = addLog(st, '不公印章：雙方洗手牌重抽（自己 5 張，對手 2 張）', idx);
  st = returnHandToDeck(st, idx);
  st = returnHandToDeck(st, oppIdx);
  st = drawCards(st, idx, 5);
  st = drawCards(st, oppIdx, 2);
  return st;
});
