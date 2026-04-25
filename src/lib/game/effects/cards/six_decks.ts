/**
 * v2.112 + v2.113 六組新 preset 的卡片效果 — 23 張實裝（含能量）。
 *
 * 對應 preset：N的索羅亞克 / 火焰雞多龍 / 夠讚狗 / 顫弦蠑螈 / 蒼炎刃鬼 / 超級甲賀忍蛙。
 *
 * v2.112：撕裂 / 亂暴閃電 / 二連踢 / 燃燒旋踢 / 滿月輪舞 / 死亡終局（6 張 attack）
 * v2.113：17 張（寶可夢招式 8 + ability 4 + Trainer 7 + 特殊能量 engine inline）
 *   - Passive（engine hook）：夠讚狗｜腎上腺力量（PASSIVE_ATTACK_BONUS + effectiveHP）、
 *     蓋諾賽克特｜ACE消弭（canPlayTrainer gate）
 *   - 特殊能量（engine canAffordAttack inline）：稜鏡能量 / 新衝天能量
 */
import type { PlayerState, GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { regPre, regPost, regA, reg, regR, regG, addLog, drawCards, withPending, updatePlayer, applyBenchPlaceSideEffects, ATTACK_PRE, ATTACK_POST } from '../_shared';
import { skipDefEffectsPre, coinHeadsMultiplyPre, bothBenchMultiplyPre } from '../../effects';

// ─── 撕裂 70（skipDefEffects）───────────────────────────────────────────────
regPre('N的捷克羅姆|撕裂', skipDefEffectsPre(70, '撕裂'));

// ─── 亂暴閃電 250 + 自己下回合無法攻擊 ──────────────────────────────────────
// Wave 36 的 player-level noAttacksNextTurn 旗標：ATTACK_POST 設旗標即可。
regPost('N的捷克羅姆|亂暴閃電', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], noAttacksNextTurn: true };
  return addLog({ ...state, players }, '亂暴閃電：下個自己的回合，這隻寶可夢無法使用招式', aIdx);
});

// ─── 二連踢 40×（coin heads multiply）───────────────────────────────────────
regPre('力壯雞|二連踢', coinHeadsMultiplyPre(2, 40, '二連踢'));

// ─── 燃燒旋踢 200 + 自己下回合無法攻擊 ──────────────────────────────────────
regPost('火焰雞ex|燃燒旋踢', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = { ...players[aIdx], noAttacksNextTurn: true };
  return addLog({ ...state, players }, '燃燒旋踢：下個自己的回合，這隻寶可夢無法使用招式', aIdx);
});

// ─── 滿月輪舞 20 + 雙方備戰 × 20 ────────────────────────────────────────────
regPre('莉莉艾的皮皮ex|滿月輪舞', bothBenchMultiplyPre(20, 20, '滿月輪舞'));

// ─── 死亡終局：若對手戰鬥位傷害指示物 ≥6 → 昏厥（造成 9999 傷害 = 必 KO）
// rulesText：「若對手的戰鬥寶可夢身上放置的傷害指示物為 6 個，則將那隻寶可夢【昏厥】。」
// 卡面字面是「6 個」→ 放寬為 ≥6（等同 60 傷以上）— 符合一般 PTCG ruling 「至少 6 個」。
regPre('超級阿勃梭魯ex|死亡終局', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const dmg = def?.damage ?? 0;
  if (dmg >= 60) {
    return { state: addLog(state, '死亡終局：對手戰鬥寶可夢傷害指示物 ≥6 個 → KO', aIdx), damage: 9999 };
  }
  return { state: addLog(state, '死亡終局：對手戰鬥寶可夢傷害不足 6 個，造成 0 傷害', aIdx), damage: 0 };
});

// ═══════════════════════════════════════════════════════════════════════════
// v2.113 第二批實裝
// ═══════════════════════════════════════════════════════════════════════════

// ─── 寶可夢招式 ────────────────────────────────────────────────────────────

// N的達摩狒狒｜復燃 — 對手棄牌區基本能量 × 30
regPre('N的達摩狒狒|復燃', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let n = 0;
  for (const c of state.players[dIdx].discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card?.subtype === 'Basic') n++;
  }
  return { state: addLog(state, `復燃：對手棄牌區基本能量 ${n} 張 → ${n*30} 傷害`, aIdx), damage: n * 30 };
});

// N的達摩狒狒｜火人加農炮 90（自棄所有能量 + 對手 1 備戰 90）— 用 regPost 後續
// v2.132：修簽名 (state, aIdx, _dmg, pool) → (state, aIdx, pool)
regPost('N的達摩狒狒|火人加農炮', (state, aIdx, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) {
    const discarded = att.active.energyAttached;
    att.active = { ...att.active, energyAttached: [] };
    att.discard = [...att.discard, ...discarded];
    players[aIdx] = att;
    if (discarded.length > 0) {
      state = addLog({ ...state, players }, `火人加農炮：丟棄 ${discarded.length} 張能量卡`, aIdx);
    } else {
      state = { ...state, players };
    }
  }
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) {
    return addLog(state, '火人加農炮：對手無備戰寶可夢', aIdx);
  }
  return withPending(addLog(state, '火人加農炮：對 1 隻對手備戰寶可夢造成 90 傷害', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'fire-cannon-90',
    params: { damage: 90 },
  });
});
regR('fire-cannon-90', (state, aIdx, selectedIids, params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dmg = (params?.damage as number) ?? 90;
  const players = [...state.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  def.bench = def.bench.map(b => selectedIids.includes(b.iid) ? { ...b, damage: b.damage + dmg } : b);
  players[dIdx] = def;
  const tgt = def.bench.find(b => selectedIids.includes(b.iid));
  const name = tgt ? (pool.get(tgt.cardId)?.name ?? '?') : '?';
  return addLog({ ...state, players }, `火人加農炮：對 ${name} 造成 ${dmg} 傷害`, aIdx);
});

// N的扒手貓｜暗槓 30 — 查對手手牌 → 選 1 張放對手牌庫「下方」
// 簡化：用 hand-discard pending 讓玩家從對手手牌選 1 張；resolver 將該卡放回對手牌庫底部。
//
// v2.132：原 postFn 簽名寫成 `(state, aIdx, _dmg, pool)` — 多塞 _dmg → pool 變 undefined →
//   `pool.get(...)` 拋 TypeError → 整個 dispatch 失敗 → 連 30 傷害都沒套（Leon 透過
//   暗黑底牌 copy-attack 觸發而看到「沒造成傷害也沒抽手牌」）。修為正確簽名 `(state, aIdx, pool)`。
regPost('N的扒手貓|暗槓', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  if (oppHand.length === 0) return addLog(state, '暗槓：對手手牌為空', aIdx);
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  state = addLog(state, `暗槓：查看對手手牌 — ${handNames}`, aIdx);
  return withPending(state, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'lie-cheat-to-deck-bottom',
    params: { validIids: oppHand.map(c => c.iid) },
  });
});
regR('lie-cheat-to-deck-bottom', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const opp = { ...players[dIdx] };
  const pick = opp.hand.find(c => selectedIids.includes(c.iid));
  if (!pick) return addLog(state, '暗槓：未選取卡', aIdx);
  opp.hand = opp.hand.filter(c => c.iid !== pick.iid);
  opp.deck = [...opp.deck, pick];  // 放到牌庫「下方」（陣列末端）
  players[dIdx] = opp;
  const name = pool.get(pick.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `暗槓：將對手的 ${name} 放回對手牌庫下方`, aIdx);
});

// 毒電嬰｜呼朋引伴 — 牌庫搜 ≤2【基礎】寶可夢放備戰
regPost('毒電嬰|呼朋引伴', (state, aIdx) => {
  if (state.players[aIdx].bench.length >= 5) return addLog(state, '呼朋引伴：備戰區已滿', aIdx);
  const maxN = Math.min(2, 5 - state.players[aIdx].bench.length);
  return withPending(addLog(state, `呼朋引伴：從牌庫選 ≤${maxN} 張基礎寶可夢放備戰`, aIdx), {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicPokemon',
    minCount: 0, maxCount: maxN,
    effectKey: 'recruit-to-bench',
  });
});
regR('recruit-to-bench', (state, aIdx, selectedIids, _params, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.deck.filter(c => selectedIids.includes(c.iid));
  p.deck = p.deck.filter(c => !selectedIids.includes(c.iid));
  const actuallyPlacedIids: string[] = [];
  for (const pk of picks) {
    if (p.bench.length < 5) {
      p.bench = [...p.bench, { ...pk, justPlaced: true }];
      actuallyPlacedIids.push(pk.iid);
    }
  }
  // 重洗牌庫
  p.deck = [...p.deck].sort(() => Math.random() - 0.5);
  players[aIdx] = p;
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog({ ...state, players }, `呼朋引伴：從牌庫放 ${picks.length} 張基礎寶可夢到備戰（${names}），並重洗牌庫`, aIdx);
  // v2.119：觸發「放到備戰」的被動場地卡效果（險惡廢墟等）
  s = applyBenchPlaceSideEffects(s, aIdx, actuallyPlacedIids, pool);
  return s;
});

// 超級阿勃梭魯ex｜惡之鉤爪 200 — 看對手手牌棄 1
// v2.132：修簽名（_dmg 多餘 → pool 變 undefined → throw）
regPost('超級阿勃梭魯ex|惡之鉤爪', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  if (oppHand.length === 0) return addLog(state, '惡之鉤爪：對手手牌為空', aIdx);
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  state = addLog(state, `惡之鉤爪：查看對手手牌 — ${handNames}`, aIdx);
  return withPending(state, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'evil-claw-opp-discard',
    params: { validIids: oppHand.map(c => c.iid) },
  });
});
regR('evil-claw-opp-discard', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const opp = { ...players[dIdx] };
  const pick = opp.hand.find(c => selectedIids.includes(c.iid));
  if (!pick) return addLog(state, '惡之鉤爪：未選取', aIdx);
  opp.hand = opp.hand.filter(c => c.iid !== pick.iid);
  opp.discard = [...opp.discard, pick];
  players[dIdx] = opp;
  const name = pool.get(pick.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `惡之鉤爪：棄掉對手的 ${name}`, aIdx);
});

// 火箭隊的狃拉｜暗算 — 對手 1 備戰 × (其身上傷害指示物數量) × 20（不計弱抗）
regPost('火箭隊的狃拉|暗算', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return addLog(state, '暗算：對手無備戰寶可夢', aIdx);
  return withPending(addLog(state, '暗算：對 1 隻對手備戰寶可夢造成（其傷害指示物數）×20 傷害', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'ambush-snipe-by-counters',
  });
});
regR('ambush-snipe-by-counters', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  const tgt = def.bench.find(b => selectedIids.includes(b.iid));
  if (!tgt) return addLog(state, '暗算：目標無效', aIdx);
  const counters = Math.floor((tgt.damage ?? 0) / 10);
  const dmg = counters * 20;
  def.bench = def.bench.map(b => b.iid === tgt.iid ? { ...b, damage: b.damage + dmg } : b);
  players[dIdx] = def;
  const name = pool.get(tgt.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `暗算：對 ${name}（${counters} 個傷害指示物）造成 ${dmg} 傷害`, aIdx);
});

// 超級甲賀忍蛙ex｜忍者飛旋 120+ — 若將 1 張水能量放回手牌，+80
// v2.132：修簽名（雖然函式 body 沒用 pool，但簽名錯誤仍會在 TS strict 觸發 type 不符）
regPost('超級甲賀忍蛙ex|忍者飛旋', (state, _aIdx, _pool) => {
  // 簡化版：若身上有水能量，自動把最後一張水回手並 +80（傷害已由 regPre 算，這裡靠 regPre 補）
  // 為維持 post-only，不直接影響 dmg — 改成 regPre 版本
  return state;
});
// 改成 pre 算額外 +80（若身上有水能量、則能量回手）
regPre('超級甲賀忍蛙ex|忍者飛旋', (state, aIdx, pool) => {
  const active = state.players[aIdx].active;
  if (!active) return { state, damage: 120 };
  const waterIdx = active.energyAttached.findIndex(e => {
    const ec = pool.get(e.cardId);
    return ec?.supertype === 'Energy' && ec?.subtype === 'Basic' &&
      (ec.pokemonType === 'Water' || /【水】/.test(ec.name));
  });
  if (waterIdx < 0) {
    return { state: addLog(state, '忍者飛旋：身上無【水】能量（未觸發 +80）', aIdx), damage: 120 };
  }
  // 把該張水能量放回手牌
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const energyCard = p.active!.energyAttached[waterIdx];
  p.active = { ...p.active!, energyAttached: p.active!.energyAttached.filter((_, i) => i !== waterIdx) };
  p.hand = [...p.hand, energyCard];
  players[aIdx] = p;
  return { state: addLog({ ...state, players }, '忍者飛旋：將 1 張【水】能量放回手牌 → +80 傷害', aIdx), damage: 200 };
});

// ─── Abilities（寶可夢特性，regA 1/回合）────────────────────────────────────

// N的索羅亞克ex｜交易 — 棄 1 手牌 → 抽 2
//   卡面：「在自己的回合，若將自己的 1 張手牌丟棄，則可使用 1 次。從自己的牌庫抽出 2 張卡。」
//   v2.131：原 gate 寫 `< 2` 是錯的（卡面只需 1 張可丟）；改為 `=== 0`。
//          getUsableAbilities 也加同樣的 gate（無手牌或牌庫空就隱藏按鈕）。
regA('N的索羅亞克ex', 0, (st, idx) => {
  if (st.players[idx].hand.length === 0) return addLog(st, '交易：手牌為空，無法丟棄', idx);
  if (st.players[idx].deck.length === 0) return addLog(st, '交易：牌庫為空', idx);
  st = addLog(st, '交易：選 1 張手牌丟棄 → 抽 2 張', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'trade-draw-2',
  });
});
regR('trade-draw-2', (state, aIdx, selectedIids, _params) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.hand.filter(c => selectedIids.includes(c.iid));
  p.hand = p.hand.filter(c => !selectedIids.includes(c.iid));
  p.discard = [...p.discard, ...picks];
  players[aIdx] = p;
  let s = addLog({ ...state, players }, `交易：丟棄 ${picks.length} 張手牌`, aIdx);
  s = drawCards(s, aIdx, 2);
  return addLog(s, '交易：抽 2 張', aIdx);
});

// 火焰雞ex｜沸騰鬥志 — 棄牌區選 1 基本能量附給自己寶可夢（1/回合）
// v2.117 修：原實裝用了不存在的 pending type 'attach-energy-own-any' 導致 UI 卡住，
//   且 gate 只寫在 fn 內部（按了才跳 log）。改為：
//   - Step 1: discard-search / BasicEnergy 選能量
//   - Step 2: heal-target + validIids=全部自己寶可夢 → 選附加目標
//   - engine getAvailableAbilities gate（棄牌區有基本能量才顯示按鈕，同「充能」pattern）
// 註：ability gate 在 engine.ts 端維護，這裡只做安全檢查（雙重保險）。
regA('火焰雞ex', 0, (st, idx, pool) => {
  const hasBasicEnergy = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (!hasBasicEnergy) return addLog(st, '沸騰鬥志：棄牌區無基本能量', idx);
  st = addLog(st, '沸騰鬥志：從棄牌區選 1 張基本能量附給 1 隻自己的寶可夢', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'blaziken-boiling-pick-energy',
  });
});
regR('blaziken-boiling-pick-energy', (state, aIdx, selectedEnergyIids) => {
  const p = state.players[aIdx];
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  return withPending(state, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'blaziken-boiling-attach',
    params: {
      energyIids: selectedEnergyIids,
      validIids: allMy.map(c => c.iid),
      titleOverride: '選擇附加能量的寶可夢（沸騰鬥志）',
    },
  });
});
regR('blaziken-boiling-attach', (state, aIdx, selectedPokeIids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const energy = p.discard.find(c => energyIids.includes(c.iid));
  if (!energy) return addLog(state, '沸騰鬥志：能量不在棄牌區', aIdx);
  p.discard = p.discard.filter(c => c.iid !== energy.iid);
  const pIid = selectedPokeIids[0];
  let tgtName = '?';
  if (p.active?.iid === pIid) {
    p.active = { ...p.active, energyAttached: [...p.active.energyAttached, energy] };
    tgtName = pool.get(p.active.cardId)?.name ?? '?';
  } else {
    p.bench = p.bench.map(b => {
      if (b.iid === pIid) {
        tgtName = pool.get(b.cardId)?.name ?? '?';
        return { ...b, energyAttached: [...b.energyAttached, energy] };
      }
      return b;
    });
  }
  players[aIdx] = p;
  const ename = pool.get(energy.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `沸騰鬥志：將 ${ename} 附給 ${tgtName}`, aIdx);
});

// 龜足巨鎧｜岩石武裝 — 手牌選 1 張「基本【鬥】能量」附給自己的【鬥】寶可夢（1/回合）
// v2.117 修：pending type 改 heal-target + validIids（限【鬥】寶可夢）
regA('龜足巨鎧', 0, (st, idx, pool) => {
  const hasFighting = st.players[idx].hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【鬥】/.test(card.name);
  });
  if (!hasFighting) return addLog(st, '岩石武裝：手牌無基本【鬥】能量', idx);
  // 還要確認場上有【鬥】寶可夢
  const p = st.players[idx];
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  const hasFightPoke = allMy.some(c => pool.get(c.cardId)?.pokemonType === 'Fighting');
  if (!hasFightPoke) return addLog(st, '岩石武裝：場上無【鬥】寶可夢', idx);
  st = addLog(st, '岩石武裝：從手牌選 1 張基本【鬥】能量附給自己的【鬥】寶可夢', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    filter: 'BasicFightingEnergy',
    effectKey: 'rock-armor-pick-energy',
  });
});
regR('rock-armor-pick-energy', (state, aIdx, selectedIids, _params, pool) => {
  const p = state.players[aIdx];
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  const fightIids = allMy.filter(c => pool.get(c.cardId)?.pokemonType === 'Fighting').map(c => c.iid);
  return withPending(state, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'rock-armor-attach',
    params: {
      energyIids: selectedIids,
      validIids: fightIids,
      titleOverride: '選擇附加能量的【鬥】寶可夢（岩石武裝）',
    },
  });
});
regR('rock-armor-attach', (state, aIdx, selectedPokeIids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const energy = p.hand.find(c => energyIids.includes(c.iid));
  if (!energy) return addLog(state, '岩石武裝：能量不在手牌', aIdx);
  p.hand = p.hand.filter(c => c.iid !== energy.iid);
  const pIid = selectedPokeIids[0];
  let tgtName = '?';
  if (p.active?.iid === pIid) {
    p.active = { ...p.active, energyAttached: [...p.active.energyAttached, energy] };
    tgtName = pool.get(p.active.cardId)?.name ?? '?';
  } else {
    p.bench = p.bench.map(b => {
      if (b.iid === pIid) {
        tgtName = pool.get(b.cardId)?.name ?? '?';
        return { ...b, energyAttached: [...b.energyAttached, energy] };
      }
      return b;
    });
  }
  players[aIdx] = p;
  const ename = pool.get(energy.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `岩石武裝：將 ${ename} 附給 ${tgtName}`, aIdx);
});

// 顫弦蠑螈｜惡棍衝天 — 牌庫選 1 張「基本【惡】能量」附給備戰區【惡】寶可夢 + 重洗 + 放 2 傷
// v2.117 修：filter 'BasicDarknessEnergy' engine 不認得 → 改用 'Energy:Darkness'。
//   pending type 'attach-energy-bench-dark' 不存在 → 改用 heal-target + validIids（限備戰【惡】）。
regA('顫弦蠑螈', 0, (st, idx, pool) => {
  const hasDark = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【惡】/.test(card.name);
  });
  if (!hasDark) return addLog(st, '惡棍衝天：牌庫無基本【惡】能量', idx);
  const hasDarkBench = st.players[idx].bench.some(b => {
    const card = pool.get(b.cardId);
    return card?.pokemonType === 'Darkness';
  });
  if (!hasDarkBench) return addLog(st, '惡棍衝天：備戰無【惡】寶可夢', idx);
  st = addLog(st, '惡棍衝天：從牌庫選 1 張基本【惡】能量附給備戰【惡】寶可夢（+2 傷害）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Darkness',
    minCount: 1, maxCount: 1,
    effectKey: 'rascal-skyward-pick',
  });
});
regR('rascal-skyward-pick', (state, aIdx, selectedIids, _params, pool) => {
  const p = state.players[aIdx];
  const darkBenchIids = p.bench.filter(b => pool.get(b.cardId)?.pokemonType === 'Darkness').map(b => b.iid);
  return withPending(state, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'rascal-skyward-attach',
    params: {
      energyIids: selectedIids,
      validIids: darkBenchIids,
      titleOverride: '選擇備戰【惡】寶可夢附加能量（惡棍衝天）',
    },
  });
});
regR('rascal-skyward-attach', (state, aIdx, selectedPokeIids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const energy = p.deck.find(c => energyIids.includes(c.iid));
  if (!energy) return addLog(state, '惡棍衝天：能量不在牌庫', aIdx);
  p.deck = p.deck.filter(c => c.iid !== energy.iid);
  const pIid = selectedPokeIids[0];
  p.bench = p.bench.map(b => b.iid === pIid ? { ...b, energyAttached: [...b.energyAttached, energy], damage: b.damage + 20 } : b);
  // 重洗
  p.deck = [...p.deck].sort(() => Math.random() - 0.5);
  players[aIdx] = p;
  const tgt = p.bench.find(b => b.iid === pIid);
  const name = tgt ? (pool.get(tgt.cardId)?.name ?? '?') : '?';
  const ename = pool.get(energy.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `惡棍衝天：將 ${ename} 附給 ${name}（放 2 個傷害指示物）並重洗牌庫`, aIdx);
});

// 超級甲賀忍蛙ex｜必殺手裡劍 — 若在戰鬥場、棄 1 水能量 → 對手 1 寶可夢放 6 傷
regA('超級甲賀忍蛙ex', 0, (st, idx, pool, cardInst) => {
  if (st.players[idx].active?.iid !== cardInst?.iid) {
    return addLog(st, '必殺手裡劍：這隻寶可夢必須在戰鬥場', idx);
  }
  const waterIdx = st.players[idx].hand.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' &&
      (card.pokemonType === 'Water' || /【水】/.test(card.name));
  });
  if (waterIdx < 0) return addLog(st, '必殺手裡劍：手牌無基本【水】能量', idx);
  // 棄能量
  const players = [...st.players] as [PlayerState, PlayerState];
  const p = { ...players[idx] };
  const energy = p.hand[waterIdx];
  p.hand = p.hand.filter((_, i) => i !== waterIdx);
  p.discard = [...p.discard, energy];
  players[idx] = p;
  st = addLog({ ...st, players }, '必殺手裡劍：丟棄 1 張基本【水】能量，在對手 1 隻寶可夢身上放 6 個傷害指示物', idx);
  return withPending(st, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: (1 - idx) as 0 | 1,
    minCount: 1, maxCount: 1,
    effectKey: 'greninja-shuriken-6',
  });
});
regR('greninja-shuriken-6', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  let name = '?';
  if (def.active && selectedIids.includes(def.active.iid)) {
    def.active = { ...def.active, damage: def.active.damage + 60 };
    name = pool.get(def.active.cardId)?.name ?? '?';
  } else {
    def.bench = def.bench.map(b => {
      if (selectedIids.includes(b.iid)) {
        name = pool.get(b.cardId)?.name ?? '?';
        return { ...b, damage: b.damage + 60 };
      }
      return b;
    });
  }
  players[dIdx] = def;
  return addLog({ ...state, players }, `必殺手裡劍：在 ${name} 身上放 6 個傷害指示物（60 傷）`, aIdx);
});

// ─── Trainer ──────────────────────────────────────────────────────────────

// N的ＰＰ提升劑（Item）— 棄牌區選 1 張基本能量附給備戰區的「N的」寶可夢
// v2.117 修：原實裝用了不存在的 pending type 'attach-energy-bench-n' 導致 follow-up 卡住；
//   gate 未註冊為 regG，UI 仍顯示黃框。改為：
//   - regG gate：棄牌區有基本能量 AND 備戰有 N的寶可夢
//   - Step 1: discard-search / BasicEnergy 選能量
//   - Step 2: heal-target + validIids=備戰 N的寶可夢 → 選目標
regG('N的ＰＰ提升劑', (st, idx, pool) => {
  const hasBasicE = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (!hasBasicE) return false;
  const hasNBench = st.players[idx].bench.some(b => {
    const card = pool.get(b.cardId);
    return card?.name.startsWith('N的');
  });
  return hasNBench;
});
reg('N的ＰＰ提升劑', (st, idx) => {
  st = addLog(st, 'N的ＰＰ提升劑：從棄牌區選 1 張基本能量附給備戰「N的」寶可夢', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'n-pp-pick-energy',
  });
});
regR('n-pp-pick-energy', (state, aIdx, selectedIids, _params, pool) => {
  const p = state.players[aIdx];
  const nBenchIids = p.bench.filter(b => pool.get(b.cardId)?.name.startsWith('N的')).map(b => b.iid);
  return withPending(state, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'n-pp-attach',
    params: {
      energyIids: selectedIids,
      validIids: nBenchIids,
      titleOverride: '選擇備戰「N的」寶可夢附加能量（N的ＰＰ提升劑）',
    },
  });
});
regR('n-pp-attach', (state, aIdx, selectedPokeIids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const energy = p.discard.find(c => energyIids.includes(c.iid));
  if (!energy) return addLog(state, 'N的ＰＰ提升劑：能量不在棄牌區', aIdx);
  p.discard = p.discard.filter(c => c.iid !== energy.iid);
  const pIid = selectedPokeIids[0];
  let tgtName = '?';
  p.bench = p.bench.map(b => {
    if (b.iid === pIid) {
      tgtName = pool.get(b.cardId)?.name ?? '?';
      return { ...b, energyAttached: [...b.energyAttached, energy] };
    }
    return b;
  });
  players[aIdx] = p;
  const ename = pool.get(energy.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `N的ＰＰ提升劑：將 ${ename} 附給 ${tgtName}`, aIdx);
});

// 阿杏的秘招（Supporter）
// v2.117 完整重寫（Leon 指定流程）：
//   1) 先選最多 2 隻自己場上的【惡】寶可夢（1 ≤ N ≤ min(2, 惡寶數量, 牌庫惡能量數)）
//   2) 再從牌庫搜基本【惡】能量 M 張（1 ≤ M ≤ min(N, 牌庫惡能量數)）
//   3) 第 i 張能量附給第 i 隻選到的寶可夢；若 M < N，後面的寶可夢不拿到
//   4) 若被附能量的其中一隻是戰鬥寶可夢 → 中毒
//   5) 重洗牌庫
// 原實裝用了 engine 不存在的 pending type 'attach-energies-to-dark-pokes' + 自訂 filter
// 'BasicDarknessEnergy' / 'DarknessOwn' → UI 既顯示非惡能量、又卡在無法附加。全部改成
// engine 原生支援的 filter / pending type。
regG('阿杏的秘招', (st, idx, pool) => {
  const hasDarkE = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【惡】/.test(card.name);
  });
  if (!hasDarkE) return false;
  const allMy = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return allMy.some(pk => pool.get(pk.cardId)?.pokemonType === 'Darkness');
});
reg('阿杏的秘招', (st, idx, pool) => {
  const p = st.players[idx];
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  const darkPokeIids = allMy.filter(c => pool.get(c.cardId)?.pokemonType === 'Darkness').map(c => c.iid);
  const deckDarkECount = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【惡】/.test(card.name);
  }).length;
  const maxPoke = Math.min(2, darkPokeIids.length, deckDarkECount);
  st = addLog(st, `阿杏的秘招：選 1~${maxPoke} 隻【惡】寶可夢，之後從牌庫搜對應張數基本【惡】能量附上`, idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: maxPoke,
    effectKey: 'akyo-pick-pokes',
    params: {
      validIids: darkPokeIids,
      deckDarkECount,
      titleOverride: `選擇要附基本【惡】能量的寶可夢（最多 ${maxPoke} 隻）`,
    },
  });
});
regR('akyo-pick-pokes', (state, aIdx, selectedPokeIids, params) => {
  // v2.121：玩家放棄（空 iids）→ 結束效果不開第二 pending
  if (selectedPokeIids.length === 0) {
    return addLog(state, '阿杏的秘招：未選寶可夢，放棄效果', aIdx);
  }
  const deckDarkECount = (params?.deckDarkECount as number) ?? 0;
  const nPokes = selectedPokeIids.length;
  const maxE = Math.min(nPokes, deckDarkECount);
  // v2.121：若牌庫無基本【惡】能量（maxE=0），整個效果已無意義，直接結束
  if (maxE <= 0) {
    return addLog(state, '阿杏的秘招：牌庫已無基本【惡】能量，結束效果', aIdx);
  }
  return withPending(state, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Energy:Darkness',
    // v2.121：minCount 降為 0，讓玩家可以「不選（跳過）」或「放棄」
    minCount: 0, maxCount: maxE,
    effectKey: 'akyo-pick-energies',
    params: {
      pokeIids: selectedPokeIids,
      titleOverride: `從牌庫選 0~${maxE} 張基本【惡】能量`,
    },
  });
});
regR('akyo-pick-energies', (state, aIdx, selectedEnergyIids, params, pool) => {
  const pokeIids = (params?.pokeIids as string[]) ?? [];
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  // v2.121：若玩家放棄（空 iids）→ 直接重洗結束
  if (selectedEnergyIids.length === 0) {
    p.deck = [...p.deck].sort(() => Math.random() - 0.5);
    players[aIdx] = p;
    return addLog({ ...state, players }, '阿杏的秘招：未選能量，重洗牌庫結束效果', aIdx);
  }
  const energies = p.deck.filter(c => selectedEnergyIids.includes(c.iid));
  p.deck = p.deck.filter(c => !selectedEnergyIids.includes(c.iid));
  // 第 i 張能量附給第 i 隻選到的寶可夢（若 M < N，後面的寶可夢拿不到）
  const poisonedActive: string[] = [];
  const attachLog: string[] = [];
  for (let i = 0; i < energies.length; i++) {
    const e = energies[i];
    const pokeIid = pokeIids[i];
    if (!pokeIid) break;
    const ename = pool.get(e.cardId)?.name ?? '?';
    if (p.active?.iid === pokeIid) {
      p.active = { ...p.active, energyAttached: [...p.active.energyAttached, e], status: 'poisoned' };
      poisonedActive.push(pool.get(p.active.cardId)?.name ?? '?');
      attachLog.push(`${pool.get(p.active.cardId)?.name ?? '?'} +${ename}`);
    } else {
      p.bench = p.bench.map(b => {
        if (b.iid === pokeIid) {
          attachLog.push(`${pool.get(b.cardId)?.name ?? '?'} +${ename}`);
          return { ...b, energyAttached: [...b.energyAttached, e] };
        }
        return b;
      });
    }
  }
  // 重洗
  p.deck = [...p.deck].sort(() => Math.random() - 0.5);
  players[aIdx] = p;
  let s = addLog({ ...state, players }, `阿杏的秘招：${attachLog.join('、')}`, aIdx);
  if (poisonedActive.length > 0) {
    s = addLog(s, `阿杏的秘招：戰鬥寶可夢 ${poisonedActive.join('、')} → 中毒`, aIdx);
  }
  s = addLog(s, '阿杏的秘招：重洗牌庫', aIdx);
  return s;
});

// 空手道王的演練（Supporter）— 本回合對 ex +40（player-level flag karateKingBonus）
reg('空手道王的演練', (st, idx) => {
  const players = [...st.players] as [PlayerState, PlayerState];
  players[idx] = { ...players[idx], karateKingBonusThisTurn: true };
  return addLog({ ...st, players }, '空手道王的演練：這回合自己的寶可夢對對手戰鬥場的 ex 傷害 +40', idx);
});

// 塔拉剛（Supporter）— 棄牌區搜【鬥】寶可夢+基本【鬥】能量合計 ≤4 張加手牌
reg('塔拉剛', (st, idx, pool) => {
  const eligible = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon' && card.pokemonType === 'Fighting') return true;
    if (card.supertype === 'Energy' && card.subtype === 'Basic' && /【鬥】/.test(card.name)) return true;
    return false;
  });
  if (eligible.length === 0) return addLog(st, '塔拉剛：棄牌區無符合卡', idx);
  st = addLog(st, `塔拉剛：從棄牌區選最多 ${Math.min(4, eligible.length)} 張【鬥】寶可夢或基本【鬥】能量加手牌`, idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'FightingPokemonOrBasicFightingEnergy',
    minCount: 0, maxCount: Math.min(4, eligible.length),
    effectKey: 'taragun-to-hand',
  });
});
regR('taragun-to-hand', (state, aIdx, selectedIids, _params, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.discard.filter(c => selectedIids.includes(c.iid));
  p.discard = p.discard.filter(c => !selectedIids.includes(c.iid));
  p.hand = [...p.hand, ...picks];
  players[aIdx] = p;
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  return addLog({ ...state, players }, `塔拉剛：取回 ${picks.length} 張到手牌（${names}）`, aIdx);
});

// 高溫燃燒器（Item）— 棄自己 1 張基本【火】能量 → 選對手場上 1 張 Tool/特殊能量/Stadium 丟棄
// v2.117 修：加 regG 讓手牌無火能量時 UI 不顯示黃框（Leon 要求）。
// 主 effect follow-up（選 Tool/特殊能量/Stadium）目前引擎沒有 mixed-pick pending type，
// 留待未來擴充 — 先標記為 TODO，不會卡住遊戲（log 提示後直接結束）。
regG('高溫燃燒器', (st, idx, pool) => {
  const hasFire = st.players[idx].hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【火】/.test(card.name);
  });
  if (!hasFire) return false;
  // 也要對手場上有可敲對象，否則整張牌無意義
  const dIdx = (1 - idx) as 0 | 1;
  const oppAll = [...(st.players[dIdx].active ? [st.players[dIdx].active!] : []), ...st.players[dIdx].bench];
  const hasTargetTool = oppAll.some(p => p.toolAttached);
  const hasTargetSpecialE = oppAll.some(p => p.energyAttached.some(e => {
    const ec = pool.get(e.cardId);
    return ec?.supertype === 'Energy' && ec?.subtype !== 'Basic';
  }));
  const hasStadium = !!st.activeStadium;
  return hasTargetTool || hasTargetSpecialE || hasStadium;
});
reg('高溫燃燒器', (st, idx, pool) => {
  const fireIdx = st.players[idx].hand.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【火】/.test(card.name);
  });
  if (fireIdx < 0) return addLog(st, '高溫燃燒器：手牌無基本【火】能量', idx);
  // 棄能量
  const players = [...st.players] as [PlayerState, PlayerState];
  const p = { ...players[idx] };
  const eCard = p.hand[fireIdx];
  p.hand = p.hand.filter((_, i) => i !== fireIdx);
  p.discard = [...p.discard, eCard];
  players[idx] = p;
  st = addLog({ ...st, players }, '高溫燃燒器：丟棄 1 張基本【火】能量', idx);
  return addLog(st, '高溫燃燒器：從對手場上選 1 張 Tool/特殊能量/Stadium 丟棄（TODO: 引擎尚未支援 mixed-pick pending，請手動執行）', idx);
});

// 完全體攪拌器（Item ACE SPEC）— 從牌庫選 ≤5 張丟棄 + 重洗
reg('完全體攪拌器', (st, idx) => {
  if (st.players[idx].deck.length === 0) return addLog(st, '完全體攪拌器：牌庫為空', idx);
  st = addLog(st, '完全體攪拌器：從牌庫任意選擇最多 5 張丟棄並重洗', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'any',
    minCount: 0, maxCount: Math.min(5, st.players[idx].deck.length),
    effectKey: 'full-shaker-discard',
  });
});
regR('full-shaker-discard', (state, aIdx, selectedIids, _params) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.deck.filter(c => selectedIids.includes(c.iid));
  p.deck = p.deck.filter(c => !selectedIids.includes(c.iid));
  p.discard = [...p.discard, ...picks];
  p.deck = [...p.deck].sort(() => Math.random() - 0.5);
  players[aIdx] = p;
  return addLog({ ...state, players }, `完全體攪拌器：丟棄 ${picks.length} 張牌庫卡並重洗`, aIdx);
});

// AZ的平和（Supporter）— 戰鬥↔備戰互換，換入 ex 到備戰回 80 HP
reg('AZ的平和', (st, idx, pool) => {
  if (!st.players[idx].active || st.players[idx].bench.length === 0) {
    return addLog(st, 'AZ的平和：需要戰鬥位 + 備戰區寶可夢', idx);
  }
  return withPending(addLog(st, 'AZ的平和：選 1 隻備戰寶可夢與戰鬥寶可夢互換', idx), {
    type: 'own-bench-pokemon',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'az-peace-swap',
  });
});
regR('az-peace-swap', (state, aIdx, selectedIids, _params, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (!p.active) return state;
  const bIdx = p.bench.findIndex(b => selectedIids.includes(b.iid));
  if (bIdx < 0) return addLog(state, 'AZ的平和：未選備戰', aIdx);
  const oldActive = p.active;
  const oldBench = p.bench[bIdx];
  p.bench = p.bench.map((b, i) => i === bIdx ? { ...oldActive } : b);
  p.active = { ...oldBench };
  // 若戰鬥 → 備戰（swapped out）為 ex，回 80
  const movedOutCard = pool.get(oldActive.cardId);
  if (movedOutCard?.subtype === 'ex') {
    p.bench = p.bench.map((b, i) => i === bIdx ? { ...b, damage: Math.max(0, b.damage - 80) } : b);
    state = addLog(state, `AZ的平和：${movedOutCard.name} 換入備戰，回復 80 HP`, aIdx);
  }
  players[aIdx] = p;
  return addLog({ ...state, players }, 'AZ的平和：戰鬥↔備戰互換完成', aIdx);
});

// ═══════════════════════════════════════════════════════════════════════════
// Passive / Player-level / Engine-integrated effects — 由 engine 那邊 hook：
//   - 夠讚狗｜腎上腺力量（PASSIVE_ATTACK_BONUS + effectiveHPInline，effects.ts 維護）
//   - 蓋諾賽克特｜ACE消弭（canPlayTrainer gate，_shared.ts 維護）
//   - 稜鏡能量 / 新衝天能量（engine canAffordAttack inline）
//   - 空手道王的演練（karateKingBonusThisTurn → engine 打傷害時加）
// ═══════════════════════════════════════════════════════════════════════════

// ─── N的索羅亞克ex｜暗黑底牌（copy-attack）v2.119 ─────────────────────────
// 卡面：選擇 1 個自己備戰區的「N的寶可夢」持有的招式，作為此招式使用。
//
// 流程：
//   1) UI intercept：打出此招式時，彈 modal 讓玩家選備戰 N的寶可夢 + 該寶可夢的招式
//      → dispatch ATTACK 時把 { copyAttackChoice: { pokeIid, attackIndex } } 塞進 action
//   2) regPre 讀 action.copyAttackChoice → 查詢該招的 effectKey（cardName|attackName）
//      → 轉接到 ATTACK_PRE.get(copiedKey)（若未註冊則用印刷傷害）
//      → 把 copiedKey 存到 state.pendingCopyAttackKey，讓 regPost 接力
//   3) regPost 讀 state.pendingCopyAttackKey → 呼叫 ATTACK_POST.get(copiedKey)
//      處理 pendingSelection 類附加效果；結束後清除旗標
//   4) fallback：無 copyAttackChoice 時（例如 AI / 舊 state），自動挑備戰 N的寶可夢
//      中「印刷傷害最高」的招式（同扮晶晶酒 precedent）
regPre('N的索羅亞克ex|暗黑底牌', (state, aIdx, pool, action) => {
  const parseDmg = (s: string): number => {
    const m = s.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const choice = action?.copyAttackChoice;
  const bench = state.players[aIdx].bench;
  let nBench: CardInstance | null = null;
  let pickedAttackIdx = -1;
  if (choice) {
    nBench = bench.find(b => b.iid === choice.pokeIid) ?? null;
    pickedAttackIdx = choice.attackIndex;
  } else {
    // fallback：自動挑備戰 N的寶可夢最高印刷傷害招式
    nBench = bench.find(b => pool.get(b.cardId)?.name?.startsWith('N的')) ?? null;
    if (nBench) {
      const atks = pool.get(nBench.cardId)?.attacks ?? [];
      let bestIdx = 0, bestDmg = parseDmg(atks[0]?.damage ?? '');
      for (let i = 1; i < atks.length; i++) {
        const d = parseDmg(atks[i].damage);
        if (d > bestDmg) { bestDmg = d; bestIdx = i; }
      }
      pickedAttackIdx = bestIdx;
    }
  }
  if (!nBench) {
    return { state: addLog(state, '暗黑底牌：備戰區沒有「N的」寶可夢', aIdx), damage: 0 };
  }
  const nCard = pool.get(nBench.cardId);
  const pickedAtk = nCard?.attacks?.[pickedAttackIdx];
  if (!nCard || !pickedAtk) {
    return { state: addLog(state, `暗黑底牌：${nCard?.name ?? '?'} 沒有對應的招式`, aIdx), damage: 0 };
  }
  const copiedKey = `${nCard.name}|${pickedAtk.name}`;
  let s = addLog(state, `暗黑底牌：使用 ${nCard.name} 的「${pickedAtk.name}」`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, action);
    return {
      state: sub.state,
      damage: sub.damage,
      skipWeakRes: sub.skipWeakRes,
      skipDefEffects: sub.skipDefEffects,
    };
  }
  // 被複製招式未註冊 PRE：回印刷傷害
  return { state: s, damage: parseDmg(pickedAtk.damage) };
});
regPost('N的索羅亞克ex|暗黑底牌', (state, aIdx, pool) => {
  const key = state.pendingCopyAttackKey;
  const cleared: GameState = { ...state, pendingCopyAttackKey: undefined };
  if (!key) return cleared;
  const copiedPost = ATTACK_POST.get(key);
  if (!copiedPost) return cleared;
  return copiedPost(cleared, aIdx, pool);
});
