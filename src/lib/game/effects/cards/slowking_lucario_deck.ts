/**
 * 呆呆王 + 超級路卡利歐 兩組預組卡效果
 *
 * v2.91 第一批 (1-5)：嚴格按卡面 JSON rulesText 實裝。每張卡的實作策略都
 *   在下方註解說明，若用到「自動挑選」等工程妥協會明寫（與扮晶晶酒 v2.57
 *   相同 precedent — AttackPreFn 同步限制）。
 */

import type { CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { RULE_BOX_SUBTYPES } from '../../types';
import {
  reg, regR, regG, regPre, regPost, regA,
  ATTACK_PRE, ATTACK_POST,
  shuffle, updatePlayer, addLog, drawCards, withPending,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 呆呆獸 M-P 18072｜憨憨臉（特性 — 卡面：「這隻寶可夢不會【混亂】」）
// ══════════════════════════════════════════════════════════════════════════════
// 實裝：**被動狀態免疫**，不註冊 regA（無主動觸發）。
//   engine / effects.ts 的混亂施加點（statusPost / coinStatusPost / selfConfusePost /
//   修建老匠|暴走）於 v2.91 都已加 isConfusionImmune gate — 若目標寶可夢的
//   abilities 含 name='憨憨臉' → 不施加混亂並 log。

// ══════════════════════════════════════════════════════════════════════════════
// 呆呆王 SV7 10934｜耀閃挑戰（招式 — copy-attack from own deck top）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面原文：「將自己的牌庫上方 1 張卡丟棄，若那張卡為寶可夢卡（『擁有規則的
//   寶可夢』除外），則選擇 1 個那隻寶可夢持有的招式，作為這個招式使用。」
//
// 實裝策略（務實 copy-attack，跟扮晶晶酒 v2.57 同 precedent）：
//   AttackPreFn 是同步函式，無法在攻擊中途彈 UI 讓玩家挑招式。跟扮晶晶酒一樣，
//   走「自動挑印刷傷害最高那招」路線：
//     1. 丟自己牌庫頂 1 張到棄牌區
//     2. 若非寶可夢卡 → 招式失敗（damage=0 + log）
//     3. 若是「擁有規則的寶可夢」(ex / V / VSTAR / GX 等) → 招式失敗（卡面明文）
//     4. 若該寶可夢無招式 → 招式失敗（log）
//     5. 否則挑印刷傷害最高那招（全 0 退回第一招）
//     6. 遞迴呼叫該招式的 ATTACK_PRE 取 damage + skipWeakRes / skipDefEffects
//     7. 存 pendingCopyAttackKey 供 regPost 轉接該招式的 ATTACK_POST
regPre('呆呆王|耀閃挑戰', (state, aIdx, pool, action) => {
  const p = state.players[aIdx];
  if (p.deck.length === 0) {
    return { state: addLog(state, '耀閃挑戰：牌庫已空', aIdx), damage: 0 };
  }
  const top = p.deck[0];
  const rest = p.deck.slice(1);
  const topCard = pool.get(top.cardId);
  const topName = topCard?.name ?? '?';
  // Step 1: 丟牌庫頂 1 張到棄牌區
  let s = updatePlayer(state, aIdx, pl => ({
    ...pl,
    deck: rest,
    discard: [...pl.discard, top],
  }));
  s = addLog(s, `耀閃挑戰：將牌庫頂「${topName}」丟棄`, aIdx);
  // Step 2: 非寶可夢 → 失敗
  if (!topCard || topCard.supertype !== 'Pokemon') {
    return {
      state: addLog(s, `耀閃挑戰：「${topName}」不是寶可夢卡，招式效果失敗`, aIdx),
      damage: 0,
    };
  }
  // Step 3: 擁有規則的寶可夢 → 不能取其招式
  if (RULE_BOX_SUBTYPES.has(topCard.subtype)) {
    return {
      state: addLog(s, `耀閃挑戰：「${topName}」是「擁有規則的寶可夢」，不能取其招式，招式效果失敗`, aIdx),
      damage: 0,
    };
  }
  const atks = topCard.attacks ?? [];
  if (atks.length === 0) {
    return {
      state: addLog(s, `耀閃挑戰：「${topName}」沒有招式可選，招式效果失敗`, aIdx),
      damage: 0,
    };
  }
  // Step 5: 挑印刷傷害最高的招式（同扮晶晶酒 precedent — 自動挑選）
  const parseDmg = (dmgStr: string): number => {
    const m = dmgStr.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  let picked = atks[0];
  let pickedDmg = parseDmg(picked.damage);
  for (let i = 1; i < atks.length; i++) {
    const d = parseDmg(atks[i].damage);
    if (d > pickedDmg) { picked = atks[i]; pickedDmg = d; }
  }
  const copiedKey = `${topCard.name}|${picked.name}`;
  s = addLog(s, `耀閃挑戰：選擇「${topName}」的「${picked.name}」作為這個招式使用（自動挑印刷最高傷害）`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };
  // Step 6: 遞迴該招式的 regPre
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, action);
    // Bug fix (#18): 複製招式時，弱點/抗性必須以使用者（呆呆王＝超屬性）的屬性計算
    // 不繼承被複製招式的 skipWeakRes — 否則若複製到「不計算弱點」招式會錯誤跳過弱點
    return {
      state: sub.state,
      damage: sub.damage,
      skipWeakRes: false,
      skipDefEffects: sub.skipDefEffects,
    };
  }
  // 無註冊 regPre → 退回印刷傷害
  return { state: s, damage: pickedDmg };
});
// regPost 轉接到被複製招式的 ATTACK_POST（與扮晶晶酒對稱）
regPost('呆呆王|耀閃挑戰', (state, aIdx, pool) => {
  const key = state.pendingCopyAttackKey;
  const cleared = { ...state, pendingCopyAttackKey: undefined };
  if (!key) return cleared;
  const copiedPost = ATTACK_POST.get(key);
  if (!copiedPost) return cleared;
  return copiedPost(cleared, aIdx, pool);
});

// ── 呆呆王 SV7 10934｜超念力 — 120 無效果 ────────────────────────────────────
regPre('呆呆王|超念力', (state) => ({ state, damage: 120 }));

// ══════════════════════════════════════════════════════════════════════════════
// 超級袋獸ex M1S 14071｜使者衝刺（特性）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用 1 次。從自己的牌庫
//   抽出 2 張卡。在使用了其他的『使者衝刺』的回合，這個特性無法使用。」
//
// 實作：
//   - 戰鬥場限定 → gate 檢查 cardInst 是否為 active
//   - 同名一回合限制 → engine USE_ABILITY handler 已於 v2.91 加 player-level
//     `abilityNamesUsedThisTurn` 檢查（同名特性跨實例共享 1 次）
//   - 效果：抽 2 張
// 注意：regG() 是註冊**訓練家卡**的 guard，對寶可夢特性無效。
// 使者衝刺的 gate（戰鬥場限定 + 同名一回合限制）已在 engine.ts 的
// getUsableAbilities + USE_ABILITY handler 中 hardcoded（v2.91）。
regA('超級袋獸ex', 0, (st, idx) => {
  return drawCards(addLog(st, '使者衝刺：抽 2 張', idx), idx, 2);
});

// ── 超級袋獸ex｜機關槍合擊 — 基礎 200 + 擲到反面前正面數 × 50 ──────────────
// v2.252：每次擲幣 1 行 log（「第 N 次擲硬幣 — 正面/反面」），UI 逐個排隊播放動畫。
//   舊版合併寫一行「擲到反面前正面 N 次」會被 UI parser 誤判成單次 heads 動畫，
//   且 heads=0 時 message 仍含「正面」字樣 → 顯示錯誤面。
regPre('超級袋獸ex|機關槍合擊', (state, aIdx) => {
  let s = state;
  let heads = 0;
  let count = 0;
  for (let i = 0; i < 20; i++) {
    count++;
    const isHeads = Math.random() < 0.5;
    s = addLog(s, `機關槍合擊：第 ${count} 次擲硬幣 — ${isHeads ? '正面' : '反面（停止）'}`, aIdx);
    if (isHeads) heads++;
    else break;
  }
  const dmg = 200 + heads * 50;
  s = addLog(s, `機關槍合擊：${heads} 次正面 → 基礎 200 + ${heads}×50 = ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 靈幽馬 M2a 14740
// ══════════════════════════════════════════════════════════════════════════════
regPre('靈幽馬|陰森射擊', (state) => ({ state, damage: 30 }));

// 幻影碎 — 卡面：「將這隻寶可夢身上附加的能量卡全部丟棄，在對手的 1 隻寶可夢
//   身上放置 12 個傷害指示物。」（無基礎傷害，12 counter = 120 效果型傷害）
regPre('靈幽馬|幻影碎', (state) => ({ state, damage: 0 }));
regPost('靈幽馬|幻影碎', (state, aIdx, pool) => {
  const d = state.players[1 - aIdx as 0 | 1];
  const oppCount = (d.active ? 1 : 0) + d.bench.length;
  if (oppCount === 0) return addLog(state, '幻影碎：對手場上無寶可夢', aIdx);
  const ap = state.players[aIdx];
  if (!ap.active) return state;
  // 先自拔所有能量
  const ownEnergies = ap.active.energyAttached;
  let s = state;
  if (ownEnergies.length > 0) {
    s = updatePlayer(s, aIdx, pl => ({
      ...pl,
      active: pl.active ? { ...pl.active, energyAttached: [] } : pl.active,
      discard: [...pl.discard, ...ownEnergies],
    }));
    s = addLog(s,
      `幻影碎：丟棄 ${pool.get(ap.active.cardId)?.name ?? '靈幽馬'} 身上 ${ownEnergies.length} 張能量`,
      aIdx);
  }
  // 選對手 1 隻放 12 個指示物
  // v3.14 修：原 sourcePlayerIdx: aIdx 是 bug — opp-poke-choose 的 sourcePlayerIdx
  // 應指向「目標方」（對手 dIdx），picker 才會顯示對手寶可夢。原值導致 picker 顯示
  // 自己寶可夢 → 玩家無法選對手 → 12 counter 全失效（P0 嚴重）。
  const dIdx = (1 - aIdx) as 0 | 1;
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'phantom-shatter-place-counters',
    params: { counters: 12 },
  });
});
regR('phantom-shatter-place-counters', (st, idx, iids, params, pool) => {
  const counters = (params?.counters as number) ?? 12;
  const targetIid = iids[0];
  const dIdx = (1 - idx) as 0 | 1;
  const d = st.players[dIdx];
  let target: CardInstance | null = null;
  if (d.active?.iid === targetIid) target = d.active;
  else target = d.bench.find(c => c.iid === targetIid) ?? null;
  if (!target) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  const addDmg = counters * 10;
  const newDmg = target.damage + addDmg;
  const s = addLog(st,
    `幻影碎：在對手的 ${tname} 身上放置 ${counters} 個傷害指示物（${addDmg} 傷害，效果型）`,
    idx);
  return updatePlayer(s, dIdx, pl => {
    if (pl.active?.iid === targetIid) {
      return { ...pl, active: { ...pl.active, damage: newDmg } };
    }
    return { ...pl, bench: pl.bench.map(c => c.iid === targetIid ? { ...c, damage: newDmg } : c) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 太陽岩 MC 16843｜宇宙光束
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：若自己的備戰區沒有「月石」，則這個招式失敗。這個招式的傷害不計算弱點・抵抗力。
regPre('太陽岩|宇宙光束', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const hasMoonstone = p.bench.some(c => pool.get(c.cardId)?.name === '月石');
  if (!hasMoonstone) {
    return {
      state: addLog(state, '宇宙光束：備戰區沒有「月石」，招式失敗', aIdx),
      damage: 0,
    };
  }
  return {
    state: addLog(state, '宇宙光束：備戰區有月石 → 70 傷害（不計算弱點/抗性）', aIdx),
    damage: 70,
    skipWeakRes: true,
  };
});

// ══════════════════════════════════════════════════════════════════════════════
// 月石 MC 16842｜月光循環（特性）
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「若自己的場上有『太陽岩』，且在自己的回合，從自己的手牌將 1 張『基本
//   【鬥】能量』卡丟棄，則可使用 1 次。從自己的牌庫抽出 3 張卡。
//   在使用了其他的『月光循環』的回合，這個特性無法使用。」
// 月光循環 gate（場上太陽岩 + 手牌基本鬥能量 + 同名一回合限制）同樣在
// engine.ts 的 getUsableAbilities + USE_ABILITY handler 中 hardcoded。
regA('月石', 0, (st, idx, pool) => {
  // 找 1 張基本【鬥】能量丟棄
  const p = st.players[idx];
  const energyInst = p.hand.find(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.name?.includes('【鬥】') ?? false);
  });
  if (!energyInst) return addLog(st, '月光循環：手牌無基本【鬥】能量', idx);
  let s = updatePlayer(st, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => c.iid !== energyInst.iid),
    discard: [...pl.discard, energyInst],
  }));
  s = addLog(s, '月光循環：丟棄 1 張基本【鬥】能量，從牌庫抽 3 張', idx);
  return drawCards(s, idx, 3);
});

// ── 月石｜力量寶石 — 50 無效果 ──────────────────────────────────────────────
regPre('月石|力量寶石', (state) => ({ state, damage: 50 }));

// ══════════════════════════════════════════════════════════════════════════════
// 超級路卡利歐ex M2a 14752｜波動突刺
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「從自己的棄牌區選擇最多 3 張『基本【鬥】能量』卡，以任意方式附於
//   備戰寶可夢身上。」（基礎 130 傷害）
//
// 實作：逐張 pending chain — 讓玩家每選 1 張能量後，獨立選 1 隻備戰目標，
//   重複直到所有選到的能量都分配完。完全符合卡面「以任意方式附於備戰」
//   語意（每張能量可不同目標）。
regPre('超級路卡利歐ex|波動突刺', (state) => ({ state, damage: 130 }));
regPost('超級路卡利歐ex|波動突刺', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return addLog(state, '波動突刺：備戰區沒有寶可夢，無法附加能量', aIdx);
  }
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.name?.includes('【鬥】') ?? false);
  });
  if (cand.length === 0) {
    return addLog(state, '波動突刺：棄牌區沒有基本【鬥】能量', aIdx);
  }
  const maxTake = Math.min(3, cand.length);
  const s = addLog(state,
    `波動突刺：從棄牌區選最多 ${maxTake} 張「基本【鬥】能量」，接著依序選備戰目標`,
    aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicFightingEnergy', minCount: 0, maxCount: maxTake,
    effectKey: 'pulse-thrust-energies-picked',
  });
});

// 玩家選完 0~3 張能量 → 進入逐張分配備戰目標流程
regR('pulse-thrust-energies-picked', (st, idx, energyIids) => {
  if (energyIids.length === 0) {
    return addLog(st, '波動突刺：未選擇能量，略過附加', idx);
  }
  const p = st.players[idx];
  if (p.bench.length === 0) return st;
  // 若只有 1 隻備戰 → 直接全附（避免反覆彈 UI）
  if (p.bench.length === 1) {
    const target = p.bench[0];
    const energies = p.discard.filter(c => energyIids.includes(c.iid));
    let s = addLog(st,
      `波動突刺：備戰僅有 1 隻，${energies.length} 張能量全附到該寶可夢`,
      idx);
    return updatePlayer(s, idx, pl => ({
      ...pl,
      discard: pl.discard.filter(c => !energyIids.includes(c.iid)),
      bench: pl.bench.map(c => c.iid === target.iid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    }));
  }
  // 多隻備戰 → 對第 1 張能量開 bench-choose
  const firstEnergy = energyIids[0];
  const remaining = energyIids.slice(1);
  const s = addLog(st,
    `波動突刺：選擇要附第 1 張能量的備戰寶可夢（共 ${energyIids.length} 張待附）`,
    idx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'pulse-thrust-attach-one',
    params: { currentEnergy: firstEnergy, remainingEnergies: remaining },
  });
});

// 附 1 張能量到選到的備戰；若還有剩餘能量 → 開下一個 bench-choose（chain）
regR('pulse-thrust-attach-one', (st, idx, iids, params, pool) => {
  const currentEnergy = params?.currentEnergy as string;
  const remaining = (params?.remainingEnergies as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  const energyInst = p.discard.find(c => c.iid === currentEnergy);
  if (!target || !energyInst) return st;
  const tname = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `波動突刺：將 1 張基本【鬥】能量附到備戰 ${tname}`, idx);
  s = updatePlayer(s, idx, pl => ({
    ...pl,
    discard: pl.discard.filter(c => c.iid !== currentEnergy),
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, energyInst] }
      : c),
  }));
  // 若還有剩餘 → 開下一個 bench-choose
  if (remaining.length === 0) return s;
  const nextEnergy = remaining[0];
  const rest = remaining.slice(1);
  s = addLog(s, `波動突刺：選擇要附下一張能量的備戰寶可夢（剩 ${remaining.length} 張）`, idx);
  return withPending(s, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'pulse-thrust-attach-one',
    params: { currentEnergy: nextEnergy, remainingEnergies: rest },
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 暗碼迷的解讀 MC 17169（Supporter）— v2.96 改為有序兩步選擇
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「從自己的牌庫任意選擇 2 張卡。重洗剩餘牌庫，將所選的卡以任意順序
//   排列，放回牌庫上方。」
// v2.96（Leon 指示）：「放的這兩張卡應該有順序，先選要放回的第二張，再選要放
//   在最上面的那張」→ 改為 chained pending：
//     Step 1：選 1 張作為「牌庫上方第 2 張」（在 top 之下）
//     Step 2：從剩餘牌庫選 1 張作為「牌庫最上方」
//   最終 deck 順序：[topPick, secondPick, ...shuffle(remainingDeck)]
regG('暗碼迷的解讀', (st, idx) => {
  return st.players[idx].deck.length > 0;
});
reg('暗碼迷的解讀', (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '暗碼迷的解讀：牌庫已空', idx);
  if (p.deck.length === 1) {
    // 牌庫只剩 1 張 — 卡面「任意選擇 2 張」不可能滿足，降級為放回那張 + 無可洗
    return addLog(st, '暗碼迷的解讀：牌庫只剩 1 張，無需選擇', idx);
  }
  const s = addLog(st,
    '暗碼迷的解讀：先從牌庫選第 1 張（將放在牌庫上方第 2 位）',
    idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Any',
    minCount: 1, maxCount: 1,
    effectKey: 'cipher-geek-pick-second',
    params: { titleOverride: '暗碼迷的解讀：先從牌庫選第 1 張（將放在牌庫上方第 2 位）' },
  });
});
// Step 1 resolver：記住第 1 次選的卡，從 deck 暫移到 pending params，開 Step 2
regR('cipher-geek-pick-second', (st, idx, iids) => {
  if (iids.length !== 1) return st;
  const secondIid = iids[0];
  const p = st.players[idx];
  const secondCard = p.deck.find(c => c.iid === secondIid);
  if (!secondCard) return st;
  // 暫移該卡到 params — 確保 Step 2 的 deck list 不再含這張（否則玩家會誤選同一張）
  let s = updatePlayer(st, idx, pl => ({
    ...pl,
    deck: pl.deck.filter(c => c.iid !== secondIid),
  }));
  s = addLog(s, '暗碼迷的解讀：再從剩餘牌庫選第 2 張（將放在牌庫最上方）', idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Any',
    minCount: 1, maxCount: 1,
    effectKey: 'cipher-geek-pick-top',
    params: {
      reservedSecond: secondCard,
      titleOverride: '暗碼迷的解讀：再從剩餘牌庫選第 2 張（將放在牌庫最上方）',
    },
  });
});
// Step 2 resolver：把 topPick 放牌庫最上方，reservedSecond 放第 2 位，其餘洗牌
regR('cipher-geek-pick-top', (st, idx, iids, params) => {
  if (iids.length !== 1) return st;
  const topIid = iids[0];
  const reservedSecond = params?.reservedSecond as CardInstance | undefined;
  if (!reservedSecond) return st;
  return updatePlayer(st, idx, p => {
    const topCard = p.deck.find(c => c.iid === topIid);
    if (!topCard) return p;
    const rest = p.deck.filter(c => c.iid !== topIid);
    return { ...p, deck: [topCard, reservedSecond, ...shuffle(rest)] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 超級路卡利歐ex｜超級勇氣（270 + 下回合同招禁）— v2.92
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在下個自己的回合，這隻寶可夢無法使用『超級勇氣』。」（基礎 270 傷害）
//
// 實裝：
//   - regPre: 270 基礎傷害
//   - regPost: 將 '超級勇氣' push 到 attacker active 的 blockedAttackNamesNextTurn
//   - engine END_TURN promote NextTurn → ThisTurn（在 owner 下回合開始前）
//   - engine ATTACK handler + getAvailableAttacks 檢查 blockedAttackNamesThisTurn
regPre('超級路卡利歐ex|超級勇氣', (state) => ({ state, damage: 270 }));
regPost('超級路卡利歐ex|超級勇氣', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  if (!p.active) return state;
  const name = pool.get(p.active.cardId)?.name ?? '?';
  const players = [...state.players] as typeof state.players;
  const newActive = {
    ...p.active,
    blockedAttackNamesNextTurn: [
      ...(p.active.blockedAttackNamesNextTurn ?? []),
      '超級勇氣',
    ],
  };
  players[aIdx] = { ...p, active: newActive };
  return addLog({ ...state, players },
    `超級勇氣：${name} 在下個自己的回合無法使用「超級勇氣」`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 硬岩【鬥】能量 M3 18057（Special Energy）— v2.92
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「只要這張卡附於寶可夢身上，視為提供 1 個【鬥】能量。附有這張卡的【鬥】
//   寶可夢不會受到對手的寶可夢使用招式的效果的影響。（已經受到的效果不會消除。）」
//
// 屬性部分：SPECIAL_ENERGY_TYPES 已有『硬岩【鬥】能量』→ Fighting（engine.ts 中央表）
// Shield 部分：export helper `hasEffectShield(inst, pool)`，
//   effects.ts 的 `statusPost` / `coinStatusPost` 等 defender-targeting POST 會檢查。
//   詳見 effects.ts isConfusionImmune 的對稱實作，本模組不註冊 reg* — 是 passive。

// ══════════════════════════════════════════════════════════════════════════════
// 回力鏢能量 MC 17209（Special Energy）— v2.92
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「只要這張卡附於寶可夢身上，視為提供 1 個【無】能量。若因附有這張卡的
//   寶可夢使用的招式的效果使這張卡被丟棄，則在招式的傷害與效果的影響之後，
//   重新附於原本的寶可夢身上。」
//
// 實裝：engine ATTACK handler 在 regPre/regPost 結束後，檢查 attacker active
//   上原本附有的「回力鏢能量」是否被丟到棄牌區 → 若是，重附回 attacker active。
//   （前提：attacker active 仍是原本的 inst，iid 未變）
// 屬性：SPECIAL_ENERGY_TYPES 已有『回力鏢能量』→ Colorless。

// ══════════════════════════════════════════════════════════════════════════════
// 引力山岳 SV8 11286（Stadium）— v2.92
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「雙方場上所有【2階進化】寶可夢的最大 HP 各『-30』。」
// 實裝：engine.ts 的 getEffectiveHP + effects.ts 的 effectiveHPInline 已加
//   gravity-mountain hook（v2.92）— 當 activeStadium.name === '引力山岳'
//   且 card.stage === 'Stage2' → hp -= 30。本模組不需註冊 reg*。
