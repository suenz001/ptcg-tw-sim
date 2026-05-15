/**
 * v2.67 I 標 Wave 17 — 複雜批 II（22 張）
 *
 * 涵蓋：
 *   - 反傷（藏瑪然特強大猛擊）
 *   - 棄場上 stadium +N（浩大鯨ex粉碎重壓）
 *   - 自身回手（火箭隊的叉字蝠ex刺殺迴旋）
 *   - 移轉自方備戰指示物（死神棺/火箭隊的果然翁）
 *   - 對手戰鬥能量改備戰（火箭隊的閃電鳥/小灰怪）
 *   - 牌庫挑能量分配（風妖精ex/熔蟻獸）
 *   - 棄牌挑（圖圖犬/長毛狗）
 *   - 擲幣到反 +N（賽富豪）
 *   - 對手擲幣自殘（火箭隊的引夢貘人）
 *   - 對手手牌回牌庫（墓揚犬）
 *   - 對手指示物 ×2（N的雙倍多多冰）
 *   - 對手特殊狀態觸發狙擊（夢妖魔）
 *   - 攻擊失敗預約（穿山王）
 *   - 看對手獎賞（火箭隊的索偵蟲）
 *   - 對手1隻寶可夢回牌庫（狡猾天狗）
 *   - 棄對手 stadium（古玉魚）
 *   - 雙方睡眠+下回合 +N（樹枕尾熊）
 */

import { regPre, regPost, regR, addLog, updatePlayer, withPending, shuffle, discardActiveStadium, ATTACK_PRE_DISCARD_CHOICE } from '../_shared';
// v3.10 import 修 bug 用的兩個 helper（原本 wave17 內自己 inline 寫成「加手」）
import { deckSearchAttachToAnyPost, discardSearchAttachToBenchPost } from './v2750_h_wave2_full';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { coinStatusPost, flipCoinsWithLog, statusPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// helper
// ══════════════════════════════════════════════════════════════════════════════

function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const k = Math.min(n, att.energyAttached.length);
    const s = addLog(state, `${label}：自身丟棄 ${k} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 樹枕尾熊｜晚安敲擊 30 — 雙方戰鬥寶可夢睡眠 + 下回合 +100
// ══════════════════════════════════════════════════════════════════════════════
regPre('樹枕尾熊|晚安敲擊', (s) => ({ state: s, damage: 30 }));
regPost('樹枕尾熊|晚安敲擊', (state, aIdx, pool) => {
  // 對手戰鬥場睡眠
  let s = statusPost('asleep')(state, aIdx, pool);
  // 自方戰鬥場睡眠
  s = updatePlayer(s, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, status: 'asleep' as const } : null,
  }));
  // 下回合 +100
  s = updatePlayer(s, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damageBonusPending: 100 } : null,
  }));
  return addLog(s, '晚安敲擊：雙方戰鬥場睡眠 + 自身下回合招式 +100', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 藏瑪然特｜強大猛擊 70 — 下回合受招式時，對攻擊方放與受傷相同的指示物
// ══════════════════════════════════════════════════════════════════════════════
regPre('藏瑪然特|強大猛擊', (s) => ({ state: s, damage: 70 }));
regPost('藏瑪然特|強大猛擊', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '強大猛擊：下回合受招式時，對攻擊方放與受傷相同數值的指示物（用 retaliateCountersOnNextHit 機制）', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, retaliateCountersOnNextHit: 9999 } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 浩大鯨ex｜粉碎重壓 140+ — 卡面：「若希望，將場上的競技場卡丟棄。這個情況下，增加140點傷害。」
//   v3.26 修：原實裝強制棄競技場 + 強制 +140，違反卡面「若希望」。
//   借殼 binary-yes-no scope：玩家開招前選 yes/no（場上無競技場時直接 140 不開 picker）。
// ══════════════════════════════════════════════════════════════════════════════
ATTACK_PRE_DISCARD_CHOICE.set('浩大鯨ex|粉碎重壓', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 140, damagePerEnergy: 0,
  choicePrompt: '是否將場上的競技場卡丟棄，增加 140 點傷害？',
  choiceYesLabel: '是（+140 傷害 + 棄競技場）',
  choiceNoLabel: '否（保留競技場）',
});
regPre('浩大鯨ex|粉碎重壓', (state, aIdx, _pool, action) => {
  if (!state.activeStadium) {
    return { state: addLog(state, '粉碎重壓：場上無競技場 → 140', aIdx), damage: 140 };
  }
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return { state: addLog(state, '粉碎重壓：選「否」 → 140 傷害（保留競技場）', aIdx), damage: 140 };
  }
  return { state: addLog(state, '粉碎重壓：選「是」 → 140+140 = 280（POST 棄競技場）', aIdx), damage: 280 };
});
regPost('浩大鯨ex|粉碎重壓', (state, aIdx, _pool, action) => {
  if (!state.activeStadium) return state;
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;
  return addLog(discardActiveStadium(state, aIdx), '粉碎重壓：棄場上競技場', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 火箭隊的叉字蝠ex｜刺殺迴旋 120 — 卡面：「若希望，將這隻寶可夢放回手牌。（寶可夢以外的卡全部丟棄。）」
//   v3.26 修：原實裝強制自身回手，違反卡面「若希望」。
//   借殼 binary-yes-no：玩家可選擇是否回手（保留戰鬥位）。
// ══════════════════════════════════════════════════════════════════════════════
ATTACK_PRE_DISCARD_CHOICE.set('火箭隊的叉字蝠ex|刺殺迴旋', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 120, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢放回手牌？（寶可夢以外的卡全部丟棄）',
  choiceYesLabel: '是（自身回手牌；附加能量/道具棄）',
  choiceNoLabel: '否（保留戰鬥位）',
});
regPre('火箭隊的叉字蝠ex|刺殺迴旋', (s) => ({ state: s, damage: 120 }));
regPost('火箭隊的叉字蝠ex|刺殺迴旋', (state, aIdx, _pool, action) => {
  // 同步 PRE 的 yes/no 選擇
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return addLog(state, '刺殺迴旋：選「否」 → 自身留場', aIdx);
  }
  // 自身放回手；附加能量/道具棄
  return updatePlayer(
    addLog(state, '刺殺迴旋：選「是」 → 自身放回手牌（附加能量/道具棄）', aIdx),
    aIdx, p => {
      if (!p.active) return p;
      const mainCard = { iid: p.active.iid, cardId: p.active.cardId, damage: 0, energyAttached: [] };
      const discardedAttached: CardInstance[] = [
        ...p.active.energyAttached.map(e => ({ ...e, damage: 0, energyAttached: [] })),
      ];
      if (p.active.toolAttached) {
        discardedAttached.push({ ...p.active.toolAttached, damage: 0, energyAttached: [] });
      }
      return {
        ...p,
        active: null,
        hand: [...p.hand, mainCard],
        discard: [...p.discard, ...discardedAttached],
      };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 死神棺｜伸長的傷害棺材 — 選自方備戰 1 隻指示物全部移到對手 1 隻
// ══════════════════════════════════════════════════════════════════════════════
regPre('死神棺|伸長的傷害棺材', (s) => ({ state: s, damage: 0 }));
regPost('死神棺|伸長的傷害棺材', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const candidates = p.bench.filter(b => (b.damage ?? 0) > 0);
  if (candidates.length === 0) return addLog(state, '伸長的傷害棺材：自方備戰無傷害可移轉', aIdx);
  const s = addLog(state, '伸長的傷害棺材：選 1 隻自方備戰寶可夢，將指示物全移轉至對手 1 隻', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave17-coffin-step1',
  });
});
regR('wave17-coffin-step1', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const sourceIid = iids[0];
  const dIdx = (1 - aIdx) as 0 | 1;
  const s = addLog(state, '伸長的傷害棺材：選 1 隻對手寶可夢承受指示物', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave17-coffin-step2',
    params: { sourceIid },
  });
});
regR('wave17-coffin-step2', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const sourceIid = params?.sourceIid as string | undefined;
  const targetIid = iids[0];
  if (!sourceIid) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  // 取 source damage
  const sourceBench = state.players[aIdx].bench.find(b => b.iid === sourceIid);
  const moveDmg = sourceBench?.damage ?? 0;
  if (moveDmg === 0) return state;
  // 清 source damage
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === sourceIid ? { ...b, damage: 0 } : b),
  }));
  // 加給 target
  s = updatePlayer(s, dIdx, p => {
    if (p.active && p.active.iid === targetIid) {
      return { ...p, active: { ...p.active, damage: (p.active.damage ?? 0) + moveDmg } };
    }
    return { ...p, bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: (b.damage ?? 0) + moveDmg } : b) };
  });
  return addLog(s, `伸長的傷害棺材：移轉 ${moveDmg} 點傷害指示物`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 火箭隊的果然翁｜火箭鏡面 — 同 #5 但限制 source 為自方備戰「火箭隊的寶可夢」, target 為對手戰鬥場
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的果然翁|火箭鏡面', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的果然翁|火箭鏡面', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const rocketBench = p.bench.filter(b => {
    const card = pool.get(b.cardId);
    return card?.name?.startsWith('火箭隊的') && (b.damage ?? 0) > 0;
  });
  if (rocketBench.length === 0) return addLog(state, '火箭鏡面：自方備戰無火箭隊寶可夢有傷害可移轉', aIdx);
  const s = addLog(state, '火箭鏡面：選 1 隻自方備戰火箭隊寶可夢，指示物全移到對手戰鬥場', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave17-rocket-mirror',
  });
});
regR('wave17-rocket-mirror', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const sourceIid = iids[0];
  const dIdx = (1 - aIdx) as 0 | 1;
  const sourceBench = state.players[aIdx].bench.find(b => b.iid === sourceIid);
  const moveDmg = sourceBench?.damage ?? 0;
  if (moveDmg === 0) return state;
  let s = updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === sourceIid ? { ...b, damage: 0 } : b),
  }));
  s = updatePlayer(s, dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + moveDmg } : null,
  }));
  return addLog(s, `火箭鏡面：將 ${moveDmg} 點指示物移到對手戰鬥場`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 火箭隊的閃電鳥｜阻礙之翼 30 — 對手戰鬥場 1 個能量改附對手備戰
// ──────────────────────────────────────────────────────────────────────────────
// v3.14 修 Rule 7：原本「取末尾能量 + 隨機備戰」雙重 auto-pick 違反卡面「玩家選 1
//   個能量 + 改附（指定）對手備戰」。改成 chain：active-energy-discard（對手戰鬥場
//   能量 picker，sourcePlayerIdx=dIdx）→ bench-choose（對手備戰，sourcePlayerIdx=dIdx）。
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的閃電鳥|阻礙之翼', (s) => ({ state: s, damage: 30 }));
regPost('火箭隊的閃電鳥|阻礙之翼', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (!opp.active || opp.active.energyAttached.length === 0 || opp.bench.length === 0) {
    return addLog(state, '阻礙之翼：條件不足（對手戰鬥場無能量或備戰無寶可夢）', aIdx);
  }
  return withPending(addLog(state, '阻礙之翼：選擇對手戰鬥場 1 張能量（將改附對手備戰）', aIdx), {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v3140-zapdos-jamming-pick-energy',
    params: { titleOverride: '選擇要改附的對手能量' },
  });
});
regR('v3140-zapdos-jamming-pick-energy', (state, aIdx, iids) => {
  const energyIid = iids[0];
  if (!energyIid) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  return withPending(addLog(state, '阻礙之翼：選擇要改附能量的對手備戰寶可夢', aIdx), {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'v3140-zapdos-jamming-attach',
    params: { energyIid, titleOverride: '選擇要改附能量的對手備戰' },
  });
});
regR('v3140-zapdos-jamming-attach', (state, aIdx, iids, params, pool) => {
  const targetIid = iids[0];
  const energyIid = params?.energyIid as string | undefined;
  if (!targetIid || !energyIid) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const energyInst = opp.active?.energyAttached.find(e => e.iid === energyIid);
  if (!energyInst) return state;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  return updatePlayer(
    addLog(state, `阻礙之翼：將對手戰鬥位 ${eName} 改附對手備戰`, aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.filter(e => e.iid !== energyIid) } : null,
      bench: p.bench.map(b => b.iid === targetIid ? { ...b, energyAttached: [...b.energyAttached, energyInst] } : b),
    }),
  );
});

// 小灰怪｜挪動一下 0 — 對手「場上」寶可夢能量改附對手「其他」寶可夢
// v4.01 修 UI：v3.9999 用 modal-choice 玩家覺得 UI 太陽春（沒卡片/放大鏡/能量資訊）。
//   改用 standard picker：
//   Stage 1: active-energy-discard scope='all-opp' sourcePlayerIdx=dIdx
//     → 玩家看到對手 active+bench 所有能量卡片，含「[戰鬥場/備戰] 寶可夢名」標籤 + 放大鏡
//   Stage 2: opp-bench-choose includeActive=true + validIids 排除 source ownerIid
//     → 玩家看到對手寶可夢卡片（含 active + bench，排除來源），可放大檢視
regPre('小灰怪|挪動一下', (s) => ({ state: s, damage: 0 }));
regPost('小灰怪|挪動一下', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  // 蒐集對手場上所有能量總數 + 場上寶可夢總數
  const allPokes: CardInstance[] = [];
  if (opp.active) allPokes.push(opp.active);
  for (const b of opp.bench) allPokes.push(b);
  const totalEnergies = allPokes.reduce((sum, pk) => sum + pk.energyAttached.length, 0);
  // 至少 1 顆能量 + 至少 2 隻場上寶可夢（source + target）才能挪
  if (totalEnergies === 0 || allPokes.length < 2) {
    return addLog(state, '挪動一下：條件不足（對手場上無能量或場上不足 2 隻）', aIdx);
  }
  return withPending(addLog(state, '挪動一下：選擇要改附的對手能量（場上任一隻寶可夢）', aIdx), {
    type: 'active-energy-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'minccino-shuffle-pick-energy-anywhere',
    params: {
      scope: 'all-opp',
      titleOverride: '挪動一下：選擇要改附的對手能量（場上任一隻）',
    },
  });
});
regR('minccino-shuffle-pick-energy-anywhere', (state, aIdx, iids, _params, _pool) => {
  const energyIid = iids[0];
  if (!energyIid) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  // 找出該能量的擁有者寶可夢
  const allPokes: CardInstance[] = [];
  if (opp.active) allPokes.push(opp.active);
  for (const b of opp.bench) allPokes.push(b);
  const owner = allPokes.find(pk => pk.energyAttached.some(e => e.iid === energyIid));
  if (!owner) return addLog(state, '挪動一下：找不到能量擁有者', aIdx);
  // Stage 2：選對手「其他」寶可夢（排除 source）— 用 opp-bench-choose includeActive
  const validTargets = allPokes.filter(pk => pk.iid !== owner.iid).map(pk => pk.iid);
  if (validTargets.length === 0) {
    return addLog(state, '挪動一下：對手場上無其他可附加目標，效果結束', aIdx);
  }
  return withPending(addLog(state, '挪動一下：選擇要附加能量的對手寶可夢（不可為來源寶可夢）', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'minccino-shuffle-attach-anywhere',
    params: {
      includeActive: true,
      validIids: validTargets,
      ownerIid: owner.iid, energyIid,
      titleOverride: '挪動一下：選擇要附加能量的對手寶可夢',
    },
  });
});
regR('minccino-shuffle-attach-anywhere', (state, aIdx, iids, params, pool) => {
  const targetIid = iids[0];
  const ownerIid = params?.ownerIid as string | undefined;
  const energyIid = params?.energyIid as string | undefined;
  if (!targetIid || !ownerIid || !energyIid) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const owner = opp.active?.iid === ownerIid ? opp.active : opp.bench.find(b => b.iid === ownerIid);
  if (!owner) return state;
  const energyInst = owner.energyAttached.find(e => e.iid === energyIid);
  if (!energyInst) return state;
  const eName = pool.get(energyInst.cardId)?.name ?? '?';
  const ownerName = pool.get(owner.cardId)?.name ?? '?';
  const targetPoke = opp.active?.iid === targetIid ? opp.active : opp.bench.find(b => b.iid === targetIid);
  const targetName = targetPoke ? (pool.get(targetPoke.cardId)?.name ?? '?') : '?';
  return updatePlayer(
    addLog(state, `挪動一下：將 ${ownerName} 身上 ${eName} 改附 ${targetName}`, aIdx),
    dIdx, p => {
      const stripSource = (poke: CardInstance) => poke.iid === ownerIid
        ? { ...poke, energyAttached: poke.energyAttached.filter(e => e.iid !== energyIid) }
        : poke;
      const attachTarget = (poke: CardInstance) => poke.iid === targetIid
        ? { ...poke, energyAttached: [...poke.energyAttached, energyInst] }
        : poke;
      const apply = (poke: CardInstance) => attachTarget(stripSource(poke));
      return {
        ...p,
        active: p.active ? apply(p.active) : null,
        bench: p.bench.map(apply),
      };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 風妖精ex｜能量之禮 — 從牌庫挑 ≤3 張基本能量，附於自方任一寶可夢身上
//   v3.10 修 bug：原本 effectKey 'wave13-deck-take-any' 加到手牌；
//   卡面是「以任意方式附於自己的寶可夢身上」 → 改用 deckSearchAttachToAnyPost
//   (active + bench 皆可選；雙階段 pending：deck-search → heal-target)
// ══════════════════════════════════════════════════════════════════════════════
regPre('風妖精ex|能量之禮', (s) => ({ state: s, damage: 0 }));
regPost('風妖精ex|能量之禮', deckSearchAttachToAnyPost(3, '能量之禮'));

// 熔蟻獸｜舔舔捕捉 — 牌庫挑【火】寶可夢卡與「基本【火】能量」卡合計 ≤3 加手
regPre('熔蟻獸|舔舔捕捉', (s) => ({ state: s, damage: 0 }));
regPost('熔蟻獸|舔舔捕捉', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) return state;
  const s = addLog(state, '舔舔捕捉：從牌庫挑 0~3 張【火】寶可夢/基本火能量加手（重洗）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'FirePokemonOrBasicFireEnergy',
    minCount: 0, maxCount: 3,
    effectKey: 'wave13-deck-take-any',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 圖圖犬｜能量寫生 — 擲 3 次, 從棄牌區挑 ≤正面數 基本能量分配備戰
//   v3.10 修 bug：原本 effectKey 'wave17-pickup-energy-to-hand' 加到手牌；
//   卡面是「以任意方式附於備戰寶可夢身上」 → 改用 discardSearchAttachToBenchPost
//   動態 max = heads（卡面「最多與正面出現的次數相同數量」）
// ══════════════════════════════════════════════════════════════════════════════
regPre('圖圖犬|能量寫生', (s) => ({ state: s, damage: 0 }));
regPost('圖圖犬|能量寫生', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 3, '能量寫生', aIdx);
  if (r.heads === 0) return addLog(r.state, '能量寫生：0 正面', aIdx);
  // 注意：卡面未限基本能量類型（任意基本能量）
  return discardSearchAttachToBenchPost(r.heads, '能量寫生')(r.state, aIdx, pool);
});
// 舊 resolver 'wave17-pickup-energy-to-hand' 已 obsolete（A12 唯一 caller）
//   保留 dead key 不會造成 runtime error（resolver Map 查不到時 engine 已有 fallback），
//   但仍清掉以避免 grep 噪音。


// ══════════════════════════════════════════════════════════════════════════════
// 10. 賽富豪｜抓到飽 — 擲幣到反, 從牌庫挑 ≤正面數加手
// ══════════════════════════════════════════════════════════════════════════════
regPre('賽富豪|抓到飽', (s) => ({ state: s, damage: 0 }));
regPost('賽富豪|抓到飽', (state, aIdx, _pool) => {
  let heads = 0;
  let s = state;
  while (true) {
    const r = flipCoinsWithLog(s, 1, '抓到飽', aIdx);
    s = r.state;
    if (r.heads === 0) break;
    heads++;
    if (heads >= 20) break;  // 安全閥
  }
  if (heads === 0) {
    return updatePlayer(addLog(s, '抓到飽：0 正面', aIdx), aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  s = addLog(s, `抓到飽：${heads} 正面 → 從牌庫挑 0~${heads} 張卡加手（重洗）`, aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Any',
    minCount: 0, maxCount: heads,
    effectKey: 'wave13-deck-take-any',
  });
});

// 長毛狗｜氣味偵測 — 擲 3 次, 從棄牌區挑 ≤正面數加手
regPre('長毛狗|氣味偵測', (s) => ({ state: s, damage: 0 }));
regPost('長毛狗|氣味偵測', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 3, '氣味偵測', aIdx);
  if (r.heads === 0) return addLog(r.state, '氣味偵測：0 正面', aIdx);
  const s = addLog(r.state, `氣味偵測：${r.heads} 正面 → 從棄牌區挑 0~${r.heads} 張卡加手`, aIdx);
  return withPending(s, {
    type: 'discard-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Any',
    minCount: 0, maxCount: r.heads,
    effectKey: 'wave17-pickup-energy-to-hand',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. 火箭隊的引夢貘人｜備戰區操縱 80× — 對手擲與對手備戰數同次硬幣, 反×80 自殘對手戰鬥（不計弱抗）
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的引夢貘人|備戰區操縱', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const benchN = state.players[dIdx].bench.length;
  if (benchN === 0) return { state: addLog(state, '備戰區操縱：對手備戰 0 隻', aIdx), damage: 0, skipWeakRes: true };
  const r = flipCoinsWithLog(state, benchN, '備戰區操縱', dIdx);
  const tails = benchN - r.heads;
  const dmg = tails * 80;
  return { state: addLog(r.state, `備戰區操縱：對手擲 ${benchN} 次, 反 ${tails} → ${tails}×80 = ${dmg}`, aIdx), damage: dmg, skipWeakRes: true };
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 墓揚犬｜恐怖啃咬 30 — 擲到反, 對手選正面數張手牌正面查看後回對手牌庫並重洗
//   簡化：隨機挑 N 張對手手牌回對手牌庫並重洗
// ══════════════════════════════════════════════════════════════════════════════
regPre('墓揚犬|恐怖啃咬', (s) => ({ state: s, damage: 30 }));
regPost('墓揚犬|恐怖啃咬', (state, aIdx, _pool) => {
  let heads = 0;
  let s = state;
  while (true) {
    const r = flipCoinsWithLog(s, 1, '恐怖啃咬', aIdx);
    s = r.state;
    if (r.heads === 0) break;
    heads++;
    if (heads >= 10) break;
  }
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = s.players[dIdx];
  if (heads === 0 || opp.hand.length === 0) {
    return addLog(s, `恐怖啃咬：0 正面或對手手牌空`, aIdx);
  }
  const k = Math.min(heads, opp.hand.length);
  const indices = Array.from({ length: opp.hand.length }, (_, i) => i);
  shuffle(indices);
  const pickIdx = new Set(indices.slice(0, k));
  return updatePlayer(
    addLog(s, `恐怖啃咬：對手隨機 ${k} 張手牌回牌庫並重洗`, aIdx),
    dIdx, p => {
      const picked = p.hand.filter((_, i) => pickIdx.has(i));
      const rest = p.hand.filter((_, i) => !pickIdx.has(i));
      return { ...p, hand: rest, deck: shuffle([...p.deck, ...picked]) };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. N的雙倍多多冰｜覆雪 — 對手所有寶可夢指示物變為 2 倍
// ══════════════════════════════════════════════════════════════════════════════
regPre('N的雙倍多多冰|覆雪', (s) => ({ state: s, damage: 0 }));
regPost('N的雙倍多多冰|覆雪', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(
    addLog(state, '覆雪：對手所有寶可夢身上指示物變為 2 倍', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) * 2 } : null,
      bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) * 2 })),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 夢妖魔｜刺殺魔法 60 — 對手戰鬥場有特殊狀態 → 對手 1 隻備戰受 60
// ══════════════════════════════════════════════════════════════════════════════
regPre('夢妖魔|刺殺魔法', (s) => ({ state: s, damage: 60 }));
regPost('夢妖魔|刺殺魔法', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const da = state.players[dIdx].active;
  if (!da?.status && !da?.secondaryStatus) return addLog(state, '刺殺魔法：對手戰鬥場無特殊狀態', aIdx);
  if (state.players[dIdx].bench.length === 0) return state;
  const s = addLog(state, '刺殺魔法：選 1 隻對手備戰受 60', aIdx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave3a-snipe-bench',
    params: { amount: 60, label: '刺殺魔法' },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. 穿山王｜潑沙 50 — 下回合 defender 用招式時擲幣反失敗
// ══════════════════════════════════════════════════════════════════════════════
regPre('穿山王|潑沙', (s) => ({ state: s, damage: 50 }));
regPost('穿山王|潑沙', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(
    addLog(state, '潑沙：下回合對手戰鬥寶可夢使用招式時，對手擲 1 次硬幣，反面則招式失敗', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, attackFailureFlipCountPending: 1 } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. 火箭隊的索偵蟲｜搜索之眼 — 看對手反面 1 張獎賞
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的索偵蟲|搜索之眼', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的索偵蟲|搜索之眼', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const prizes = state.players[dIdx].prizes;
  if (prizes.length === 0) return state;
  const idx = Math.floor(Math.random() * prizes.length);
  const target = prizes[idx];
  const cardName = pool.get(target.cardId)?.name ?? '?';
  return addLog(state, `搜索之眼：對手第 ${idx + 1} 張獎賞為「${cardName}」（僅本次揭露）`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. 狡猾天狗｜陣風返 — 擲幣正面，對手 1 隻寶可夢與附加卡放回對手牌庫並重洗
// ══════════════════════════════════════════════════════════════════════════════
regPre('狡猾天狗|陣風返', (s) => ({ state: s, damage: 0 }));
regPost('狡猾天狗|陣風返', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '陣風返', aIdx);
  if (r.heads === 0) return addLog(r.state, '陣風返：反面', aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = r.state.players[dIdx];
  if (opp.bench.length === 0 && !opp.active) return r.state;
  const s = addLog(r.state, '陣風返：正面 → 選 1 隻對手寶可夢與附加卡回牌庫', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave17-bounce-opp',
  });
});
regR('wave17-bounce-opp', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  const targetIid = iids[0];
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(state, dIdx, p => {
    let target: CardInstance | null = null;
    let newActive = p.active;
    let newBench = p.bench;
    if (p.active && p.active.iid === targetIid) {
      target = p.active;
      newActive = null;
    } else {
      target = p.bench.find(b => b.iid === targetIid) ?? null;
      newBench = p.bench.filter(b => b.iid !== targetIid);
    }
    if (!target) return p;
    // 主寶可夢卡 + 進化堆 + 能量 + 道具 全部回牌庫
    const allCards: CardInstance[] = [
      { iid: target.iid, cardId: target.cardId, damage: 0, energyAttached: [] },
      ...(target.evolvedFromStack ?? []).map(c => ({ iid: c.iid, cardId: c.cardId, damage: 0, energyAttached: [] })),
      ...target.energyAttached.map(e => ({ iid: e.iid, cardId: e.cardId, damage: 0, energyAttached: [] })),
      ...(target.toolAttached ? [{ iid: target.toolAttached.iid, cardId: target.toolAttached.cardId, damage: 0, energyAttached: [] }] : []),
    ];
    return {
      ...p,
      active: newActive,
      bench: newBench,
      deck: shuffle([...p.deck, ...allCards]),
    };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. 古玉魚｜燒灼大地 40 — 棄場上對手競技場 + 下回合對手禁出競技場
// v4.33：補完「有丟棄的情況下，在下個對手的回合，對手無法從手牌使出競技場卡」flag。
// ══════════════════════════════════════════════════════════════════════════════
regPre('古玉魚|燒灼大地', (s) => ({ state: s, damage: 40 }));
regPost('古玉魚|燒灼大地', (state, aIdx, _pool) => {
  if (!state.activeStadium) return state;
  // 卡面：「有丟棄的情況下」→ 確實有 stadium 才設 flag（無 stadium 時不觸發 flag）
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = discardActiveStadium(state, aIdx);
  s = updatePlayer(s, dIdx, p => ({ ...p, cantPlayStadiumNextTurn: true }));
  return addLog(s, '燒灼大地：棄場上競技場 + 對手下個回合無法使出競技場卡', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 17 統計：22 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
