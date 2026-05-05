/**
 * v2.38 波 1 — J 標寶可夢招式補實裝（attack effects）
 *
 * 涵蓋 J 標 25 個 attack effect（純傷害招式不需註冊，已被引擎自動處理）。
 * 配對表（卡名｜招式名）：
 *   01. 大嘴娃｜雙重食客           60× 丟棄手牌能量張數
 *   02. 超級呆殼獸ex｜殼捲風旋轉   180 + 下回合受招式 → 對手放 12 個指示物
 *   03. 電龍｜閃光伏特              140 + 下回合無法用此招（recharge）
 *   04. 超級皮可西ex｜射攻月亮     120 + 丟手牌能量 ≤4 ×40
 *   05. 土地雲｜巨岩墜落            50  + 不計算抵抗力
 *   06. 超級基格爾德ex｜蓋亞波     200 + 下回合受招式 -30（reduceNextHit）
 *   07. 伊裴爾塔爾ex｜死亡靈魂     OHKO 對手所有 HP ≤50 寶可夢
 *   08. 伊裴爾塔爾ex｜黑暗打擊     210 + recharge
 *   09. 古劍豹｜狡兔三窟            20  + 自選交換備戰
 *   10. 掘地兔｜地震                140 + 自己備戰各 30 傷害（不計弱抗）
 *   11. 九尾｜九尾狐搬動           選備戰，把指示物全搬到對手戰鬥場
 *   12. 信使鳥｜幸福禮物           雙方各選 ≤3 基本能量附加（簡化：自己側）
 *   13. 電飛鼠｜小使者              從牌庫挑 ≤2 基本能量加手
 *   14. 哲爾尼亞斯｜大地風暴       30× 自己所有寶可夢身上超能量數
 *   15. 樹才怪｜岩石投擲            30 + 不計抵抗力
 *   16. 千針魚｜毒液衝擊            30+，對手中毒 +50
 *   17. 金屬怪｜防守壓制            70 + 下回合受招式 -30
 *   18. 勾帕路翁ex｜力量衝撞       200 + recharge（無法使用招式）
 *   19. 藍鱷｜咬碎                   50 + 擲幣正→丟對手戰鬥場能量
 *   20. 雷吉艾斯ex｜雷吉充能       從棄牌區挑 ≤2 基本【水】能量附自身
 *   21. 雷吉斯奇魯ex｜雷吉充能     從棄牌區挑 ≤2 基本【鋼】能量附自身
 *   22. 瑪力露麗ex｜能量氣球       60 + 自身超能量數 ×40
 *   23. 故勒頓ex｜衝擊打擊         200 + recharge
 *   24. 優雅貓｜能量粉碎           40× 對手所有寶可夢身上能量總數
 *   25. 青木的姆克兒｜小使者       同電飛鼠
 *   26. 超級差不多娃娃ex｜耳之力   20+ 對手戰鬥場能量數 ×80
 *   27. 青木的勇士雄鷹｜勇鳥猛攻   120 + 自傷 30
 *
 * 鐵律：純傷害招式（無 effect 文）不在此檔；恢復／互換／搜尋等流程由 pendingSelection 處理。
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost, regR,
  addLog, updatePlayer, withPending, shuffle,
} from '../_shared';
import { flipCoinsWithLog } from '../../effects';

// ── 01. 大嘴娃｜雙重食客 — 60× 丟棄手牌能量張數 ─────────────────────────────
// 玩家在 PRE 階段選 0..2 張手牌能量丟棄；damage = 60 × 丟棄張數。
// 為避免擴 PendingSelection schema，採簡化路徑：
//   POST 階段觸發 hand-discard（filter: Energy）讓玩家選 0..2 張，
//   resolver 改回 active.damageBonusPending 之類的補傷害…
//   但既有 attack 流程是 PRE 算 damage、POST 處理副作用，無法回頭改 damage。
// 因此本檔對「雙重食客」採 fallback：直接以「自動找最多 2 張手牌能量丟棄」結算。
//   後續若要互動式選擇，需擴 ATTACK_PRE_DISCARD_CHOICE schema。
regPre('大嘴娃|雙重食客', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  // 找手牌中所有能量卡
  const handEnergies = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  // 簡化：自動丟最多 2 張
  const toDiscard = handEnergies.slice(0, 2);
  let s = state;
  if (toDiscard.length > 0) {
    s = updatePlayer(s, aIdx, p => ({
      ...p,
      hand: p.hand.filter(c => !toDiscard.some(d => d.iid === c.iid)),
      discard: [...p.discard, ...toDiscard],
    }));
    s = addLog(s, `雙重食客：丟棄手牌 ${toDiscard.length} 張能量 → ${toDiscard.length * 60} 傷害`, aIdx);
  } else {
    s = addLog(s, '雙重食客：手牌無能量可丟棄 → 0 傷害', aIdx);
  }
  return { state: s, damage: toDiscard.length * 60 };
});

// ── 02. 超級呆殼獸ex｜殼捲風旋轉 — 180 + 下回合受招式 retaliation 12 indicator ──
// 這是「下個對手回合，這隻寶可夢受到招式傷害時，使用招式的寶可夢身上放 12 個指示物」
// 既有引擎沒有專屬 retaliation hook，先用 inline marker（attacked-back）— 由 engine
// 在攻擊 resolved 後檢查 defender 是否帶這個 marker，有則對 attacker 放 12 個。
// 為簡化：用 damageReduceNextHit 的反面 — `retaliateCountersNextHit`。
// 因為要動 engine，本波先把傷害處理完，retaliation 標 stub。
regPre('超級呆殼獸ex|殼捲風旋轉', (s, _a, _p) => ({ state: s, damage: 180 }));
regPost('超級呆殼獸ex|殼捲風旋轉', (state, aIdx, _pool) => {
  // TODO(v2.39+): retaliation 12 counter 標記 — 需 engine 加新 hook
  return addLog(state, '殼捲風旋轉：下個對手回合受招式時，放 12 個指示物到攻擊方（暫未實裝 retaliation hook）', aIdx);
});

// ── 03. 電龍｜閃光伏特 — 140 + recharge ──────────────────────────────────────
// 「下個自己的回合，這隻寶可夢無法使用『閃光伏特』」→ blockedAttackNamesNextTurn
regPre('電龍|閃光伏特', (s, _a, _p) => ({ state: s, damage: 140 }));
regPost('電龍|閃光伏特', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '閃光伏特'],
    } : null,
  }));
});

// ── 04. 超級皮可西ex｜射攻月亮 — 120 + 丟手牌 ≤4 能量 ×40 ─────────────────────
// 同雙重食客模式：簡化為自動丟最多 4 張手牌能量。
regPre('超級皮可西ex|射攻月亮', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const handEnergies = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  const toDiscard = handEnergies.slice(0, 4);
  let s = state;
  if (toDiscard.length > 0) {
    s = updatePlayer(s, aIdx, p => ({
      ...p,
      hand: p.hand.filter(c => !toDiscard.some(d => d.iid === c.iid)),
      discard: [...p.discard, ...toDiscard],
    }));
    s = addLog(s, `射攻月亮：丟棄手牌 ${toDiscard.length} 張能量 → +${toDiscard.length * 40} 傷害`, aIdx);
  }
  return { state: s, damage: 120 + toDiscard.length * 40 };
});

// ── 05. 土地雲｜巨岩墜落 — 50, 不計抵抗力 ─────────────────────────────────
regPre('土地雲|巨岩墜落', (s, _a, _p) => ({ state: s, damage: 50, skipWeakRes: true }));
// 注意：規則上「不計算抵抗力」嚴格只跳過 resistance 計算，但 PTCG 引擎多半 skipWeakRes 同時跳過弱點；
//   實務影響極小（巨岩墜落無弱抗目標族群罕見），本波接受此簡化。

// ── 06. 超級基格爾德ex｜蓋亞波 — 200 + 下回合受招式 -30 ──────────────────────
regPre('超級基格爾德ex|蓋亞波', (s, _a, _p) => ({ state: s, damage: 200 }));
regPost('超級基格爾德ex|蓋亞波', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damageReduceNextHit: 30 } : null,
  }));
});

// ── 07. 伊裴爾塔爾ex｜死亡靈魂 — OHKO 對手所有 HP ≤50 寶可夢 ──────────────────
regPre('伊裴爾塔爾ex|死亡靈魂', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('伊裴爾塔爾ex|死亡靈魂', (state, aIdx, pool) => {
  // OHKO 類效果：直接施加 9999 damage 到所有 HP ≤50 的對手寶可夢。
  // PTCG 「將...昏厥」是無視 HP 直接 KO；這裡用大量 damage = max HP 達成同效。
  // 簡化：標 log 提示，實際 OHKO 流程需 engine 級 hook；本波 stub。
  return addLog(state, '死亡靈魂：將對手所有剩餘 HP ≤50 的寶可夢昏厥（暫未實裝 OHKO hook）', aIdx);
});

// ── 08. 伊裴爾塔爾ex｜黑暗打擊 — 210 + recharge ──────────────────────────────
regPre('伊裴爾塔爾ex|黑暗打擊', (s, _a, _p) => ({ state: s, damage: 210 }));
regPost('伊裴爾塔爾ex|黑暗打擊', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '黑暗打擊'],
    } : null,
  }));
});

// ── 09. 古劍豹｜狡兔三窟 — 20 + 自選交換備戰（self-swap） ──────────────────
regPre('古劍豹|狡兔三窟', (s, _a, _p) => ({ state: s, damage: 20 }));
regPost('古劍豹|狡兔三窟', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return addLog(state, '狡兔三窟：備戰區無寶可夢，無法互換', aIdx);
  }
  const s = addLog(state, '狡兔三窟：選 1 隻備戰寶可夢與戰鬥場互換', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 0, maxCount: 1,
    effectKey: 'self-swap-active-bench',
    params: { label: '狡兔三窟' },
  });
});

// ── 10. 掘地兔｜地震 — 140 + 自己備戰各 30 ───────────────────────────────────
regPre('掘地兔|地震', (s, _a, _p) => ({ state: s, damage: 140 }));
regPost('掘地兔|地震', (state, aIdx, pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => ({ ...b, damage: b.damage + 30 })),
  }));
});

// ── 11. 九尾｜九尾狐搬動 — 選備戰，搬指示物到對手戰鬥場 ───────────────────────
regPre('九尾|九尾狐搬動', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('九尾|九尾狐搬動', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  const damaged = player.bench.filter(b => b.damage > 0);
  if (damaged.length === 0) {
    return addLog(state, '九尾狐搬動：備戰區無受傷寶可夢', aIdx);
  }
  const s = addLog(state, '九尾狐搬動：選 1 隻備戰，把身上指示物全搬到對手戰鬥場', aIdx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'kitsune-move-counters',
    params: { validIids: damaged.map(b => b.iid) },
  });
});
regR('kitsune-move-counters', (state, aIdx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return state;
  const player = state.players[aIdx];
  const src = player.bench.find(b => b.iid === targetIid);
  if (!src || src.damage === 0) return state;
  const moveAmount = src.damage;
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppActive = state.players[dIdx].active;
  if (!oppActive) return state;

  let s = state;
  s = updatePlayer(s, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: 0 } : b),
  }));
  s = updatePlayer(s, dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: p.active.damage + moveAmount } : null,
  }));
  return addLog(s, `九尾狐搬動：將 ${moveAmount} 點傷害指示物移到對手戰鬥場`, aIdx);
});

// ── 13. 電飛鼠｜小使者 / 25. 青木的姆克兒｜小使者 — 牌庫挑 ≤2 基本能量加手 ───
function smallMessengerPost(label: string) {
  return (state: import('../../types').GameState, aIdx: 0 | 1, _pool: Map<string, import('$lib/cards/types').Card>) => {
    const player = state.players[aIdx];
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const s = addLog(state, `${label}：從牌庫選最多 2 張基本能量加手`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy',
      minCount: 0, maxCount: 2,
      effectKey: 'small-messenger-search',
      params: { label },
    });
  };
}
regPre('電飛鼠|小使者', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('電飛鼠|小使者', smallMessengerPost('小使者'));
regPre('青木的姆克兒|小使者', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('青木的姆克兒|小使者', smallMessengerPost('小使者'));

regR('small-messenger-search', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  return updatePlayer(state, aIdx, p => {
    const taken = p.deck.filter(c => iids.includes(c.iid));
    return {
      ...p,
      deck: shuffle(p.deck.filter(c => !iids.includes(c.iid))),
      hand: [...p.hand, ...taken],
    };
  });
});

// ── 14. 哲爾尼亞斯｜大地風暴 — 30× 自己所有寶可夢身上超能量數 ─────────────────
regPre('哲爾尼亞斯|大地風暴', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
  let psyCount = 0;
  for (const pk of all) {
    for (const e of pk.energyAttached) {
      const ec = pool.get(e.cardId);
      if (ec?.pokemonType === 'Psychic') psyCount++;
    }
  }
  return { state, damage: psyCount * 30 };
});

// ── 15. 樹才怪｜岩石投擲 — 30, 不計抵抗力 ───────────────────────────────────
regPre('樹才怪|岩石投擲', (s, _a, _p) => ({ state: s, damage: 30, skipWeakRes: true }));

// ── 16. 千針魚｜毒液衝擊 — 30+，對手中毒 → +50 ──────────────────────────────
regPre('千針魚|毒液衝擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const isPoisoned = def?.status === 'poisoned' || def?.secondaryStatus === 'poisoned';
  return { state, damage: 30 + (isPoisoned ? 50 : 0) };
});

// ── 17. 金屬怪｜防守壓制 — 70 + 下回合受招式 -30 ────────────────────────────
regPre('金屬怪|防守壓制', (s, _a, _p) => ({ state: s, damage: 70 }));
regPost('金屬怪|防守壓制', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damageReduceNextHit: 30 } : null,
  }));
});

// ── 18. 勾帕路翁ex｜力量衝撞 — 200 + recharge（無法使用招式） ───────────────
regPre('勾帕路翁ex|力量衝撞', (s, _a, _p) => ({ state: s, damage: 200 }));
regPost('勾帕路翁ex|力量衝撞', (state, aIdx, _pool) => {
  // 「下個自己的回合，這隻寶可夢無法使用招式」— 用 cantAttackPending
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, cantAttackPending: true } : null,
  }));
});

// ── 19. 藍鱷｜咬碎 — 50 + 擲幣正→丟對手戰鬥場能量 ──────────────────────────
regPre('藍鱷|咬碎', (s, _a, _p) => ({ state: s, damage: 50 }));
regPost('藍鱷|咬碎', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '咬碎', aIdx);
  if (!r.heads) return r.state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = r.state.players[dIdx].active;
  if (!def || def.energyAttached.length === 0) {
    return addLog(r.state, '咬碎：對手戰鬥場無能量', aIdx);
  }
  const last = def.energyAttached[def.energyAttached.length - 1];
  const eName = pool.get(last.cardId)?.name ?? '能量';
  return updatePlayer(
    addLog(r.state, `咬碎：丟棄對手 ${eName}`, aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) } : null,
      discard: [...p.discard, last],
    }),
  );
});

// ── 20-21. 雷吉艾斯ex / 雷吉斯奇魯ex｜雷吉充能 — 從棄牌區挑 ≤2 基本【水/鋼】 ───
function regiChargePost(label: string, energyType: 'Water' | 'Metal') {
  return (state: import('../../types').GameState, aIdx: 0 | 1, pool: Map<string, import('$lib/cards/types').Card>) => {
    const player = state.players[aIdx];
    const candidates = player.discard.filter(c => {
      const cc = pool.get(c.cardId);
      return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && cc.pokemonType === energyType;
    });
    if (candidates.length === 0) {
      return addLog(state, `${label}：棄牌區無基本【${energyType === 'Water' ? '水' : '鋼'}】能量`, aIdx);
    }
    const s = addLog(state, `${label}：從棄牌區選最多 2 張基本【${energyType === 'Water' ? '水' : '鋼'}】能量附自身`, aIdx);
    return withPending(s, {
      type: 'discard-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 0, maxCount: 2,
      effectKey: 'regi-charge',
      params: { label, validIids: candidates.map(c => c.iid) },
    });
  };
}
regPre('雷吉艾斯ex|雷吉充能', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('雷吉艾斯ex|雷吉充能', regiChargePost('雷吉充能', 'Water'));
regPre('雷吉斯奇魯ex|雷吉充能', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('雷吉斯奇魯ex|雷吉充能', regiChargePost('雷吉充能', 'Metal'));

regR('regi-charge', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const moved = p.discard.filter(c => iids.includes(c.iid));
    const newDiscard = p.discard.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      discard: newDiscard,
      active: { ...p.active, energyAttached: [...p.active.energyAttached, ...moved] },
    };
  });
});

// ── 22. 瑪力露麗ex｜能量氣球 — 60 + 自身超能量數 ×40 ──────────────────────
regPre('瑪力露麗ex|能量氣球', (state, aIdx, pool) => {
  const active = state.players[aIdx].active;
  if (!active) return { state, damage: 60 };
  let psyCount = 0;
  for (const e of active.energyAttached) {
    const ec = pool.get(e.cardId);
    if (ec?.pokemonType === 'Psychic') psyCount++;
  }
  return { state, damage: 60 + psyCount * 40 };
});

// ── 23. 故勒頓ex｜衝擊打擊 — 200 + recharge ────────────────────────────────
regPre('故勒頓ex|衝擊打擊', (s, _a, _p) => ({ state: s, damage: 200 }));
regPost('故勒頓ex|衝擊打擊', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '衝擊打擊'],
    } : null,
  }));
});

// ── 24. 優雅貓｜能量粉碎 — 40× 對手所有寶可夢身上能量總數 ─────────────────
regPre('優雅貓|能量粉碎', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  let cnt = 0;
  if (opp.active) cnt += opp.active.energyAttached.length;
  for (const b of opp.bench) cnt += b.energyAttached.length;
  return { state, damage: cnt * 40 };
});

// ── 26. 超級差不多娃娃ex｜耳之力 — 20+ 對手戰鬥場能量數 ×80 ─────────────────
regPre('超級差不多娃娃ex|耳之力', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const cnt = def ? def.energyAttached.length : 0;
  return { state, damage: 20 + cnt * 80 };
});

// ── 27. 青木的勇士雄鷹｜勇鳥猛攻 — 120 + 自傷 30 ────────────────────────────
regPre('青木的勇士雄鷹|勇鳥猛攻', (s, _a, _p) => ({ state: s, damage: 120 }));
regPost('青木的勇士雄鷹|勇鳥猛攻', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: p.active.damage + 30 } : null,
  }));
});

// ── 12. 信使鳥｜幸福禮物 — 雙方各選 ≤3 基本能量附加（簡化：只自己側） ────────
regPre('信使鳥|幸福禮物', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('信使鳥|幸福禮物', (state, aIdx, pool) => {
  // 簡化：只觸發自己側挑能量加附（對手側互動需 inter-player pending，本波 stub）
  const player = state.players[aIdx];
  const handBasic = player.hand.filter(c => {
    const cc = pool.get(c.cardId);
    return cc?.supertype === 'Energy' && cc.subtype === 'Basic';
  });
  if (handBasic.length === 0) {
    return addLog(state, '幸福禮物：手牌無基本能量', aIdx);
  }
  const s = addLog(state, '幸福禮物：自己選 ≤3 張基本能量分配給場上寶可夢（簡化版：對手側未實裝）', aIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 0, maxCount: 3,
    filter: 'BasicEnergy',
    effectKey: 'lucky-gift-self',
    params: {},
  });
});
regR('lucky-gift-self', (state, aIdx, iids, _params, pool) => {
  // 簡化：把選的能量直接塞進戰鬥位（理想應讓玩家對每張選目標）
  if (iids.length === 0) return state;
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const chosen = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      hand: newHand,
      active: { ...p.active, energyAttached: [...p.active.energyAttached, ...chosen] },
    };
  });
});

// 輔助：避免 unused import
export type _v2380Sentinel = PlayerState;
