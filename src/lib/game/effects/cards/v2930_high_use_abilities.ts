/**
 * v2.93a — 高使用率特性實裝（部分）
 *
 * 本檔實裝 3 張卡之中的 2 張（剩 1 張在 engine.ts 加 KO bonus hook）：
 *   1. 奇樹的大電海燕｜閃光抽出（M2a/MC/SV9 — I 標）
 *   2. 阿響的鳳王ex｜金色火焰（M2a/SV9a — I 標）
 *
 * 設計原則：
 *   - 嚴格依照 official 卡面文字實裝，不簡化
 *   - 1 回合 1 次靠 engine 既有 abilityUsedThisTurn gate（per-instance）
 *   - 各 resolver 用既有 chained pending pattern（仿 麻麻鰻｜電氣發電機 / 龐克練肌）
 */

import type { CardInstance, PlayerState, GameState } from '../../types';
import { applyMagearnaHandAttachHeal } from './v3000_g3_wave2';
import { fireOnHandEnergyAttached } from '../_shared';
import { canApplyEffectToTarget } from '../../defense'; // v5.839 換位免疫 gate // v5.662 從手牌附能→對手反應(侵蝕詛咒/麻痺門牙)
import {
  regA, regAByName, regR,
  addLog, addPrivateLog, updatePlayer, withPending,
  drawCards, rejectAbilityUse } from '../_shared';
import type { Card } from '$lib/cards/types';
import { isBasicEnergyOfType } from '../../selection-filter'; // v6.210：基本能量屬性判定收斂中央述詞（leaf，Check O 安全）

// 導出 sentinel 防止 unused import warnings
export type _v2930Sentinel = PlayerState | GameState | Card;

// ══════════════════════════════════════════════════════════════════════════════
// 1) 奇樹的大電海燕｜閃光抽出
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合，若將 1 個這隻寶可夢身上附加的『基本【雷】能量』丟棄，
//        則可使用 1 次。從牌庫抽卡直到自己的手牌滿 6 張為止。」
//
// 設計：
//   - regA 主動觸發；engine 會處理 abilityUsedThisTurn gate
//   - cost: 自身寶可夢身上必須有「基本【雷】能量」可棄；觸發時自動棄第 1 張匹配的
//   - 抽牌：抽到手牌 = 6 張為止；若手牌 ≥6 已滿則無效但仍消耗能量
//   - 若牌庫空則抽到牌庫空為止（不報錯）
// ══════════════════════════════════════════════════════════════════════════════
regA('奇樹的大電海燕', 0, (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  // 找觸發源寶可夢實例（同名場上有多隻時用 cardInst 區分；fallback active）
  const allPokes: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  const src = cardInst
    ? allPokes.find(c => c.iid === cardInst.iid)
    : allPokes.find(c => pool.get(c.cardId)?.name === '奇樹的大電海燕');
  if (!src) return rejectAbilityUse(st, '閃光抽出：找不到奇樹的大電海燕', idx);

  // gate: 必須有基本【雷】能量在身上
  const lightningEnergyIdx = src.energyAttached.findIndex(e => {
    const card = pool.get(e.cardId);
    return isBasicEnergyOfType(card, 'Lightning');
  });
  if (lightningEnergyIdx < 0) {
    return addLog(st, '閃光抽出：身上無基本【雷】能量可棄', idx);
  }

  // 棄能量
  const discarded = src.energyAttached[lightningEnergyIdx];
  const isActive = p.active?.iid === src.iid;
  let s = updatePlayer(st, idx, pl => {
    const newAttached = src.energyAttached.filter((_, i) => i !== lightningEnergyIdx);
    if (isActive && pl.active) {
      return {
        ...pl,
        active: { ...pl.active, energyAttached: newAttached },
        discard: [...pl.discard, discarded],
      };
    }
    return {
      ...pl,
      bench: pl.bench.map(c => c.iid === src.iid ? { ...c, energyAttached: newAttached } : c),
      discard: [...pl.discard, discarded],
    };
  });
  const energyName = pool.get(discarded.cardId)?.name ?? '基本【雷】能量';
  s = addLog(s, `閃光抽出：棄自身 ${energyName}`, idx);

  // 抽到手牌 = 6 張
  const handCount = s.players[idx].hand.length;
  const need = Math.max(0, 6 - handCount);
  if (need === 0) {
    return addLog(s, '閃光抽出：手牌已滿 6 張，不抽（能量仍消耗）', idx);
  }
  const deckLeft = s.players[idx].deck.length;
  const actualDraw = Math.min(need, deckLeft);
  if (actualDraw === 0) {
    return addLog(s, '閃光抽出：牌庫已空，無法抽牌', idx);
  }
  s = drawCards(s, idx, actualDraw);
  return addLog(s, `閃光抽出：抽到手牌滿 6 張（共抽 ${actualDraw} 張）`, idx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2) 阿響的鳳王ex｜金色火焰
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時可使用 1 次。從自己的手牌選擇最多 2 張『基本【火】能量』卡，
//        附於備戰區的 1 隻『阿響的寶可夢』身上。」
//
// 兩階段 chained pending：
//   1. hand-discard filter='Energy:Fire' 選 0~2 張
//   2. bench-choose 限「阿響的」備戰寶可夢 → 把選的能量附過去
//
// 注意：
//   - 卡面說「最多 2 張」 → minCount: 0（玩家可選 0 張等於不發動，但仍消耗 ability gate）
//     實際引擎處理：若選 0 張就 no-op return（不消耗 abilityUsedThisTurn）
//   - 「備戰區的」 → 不含戰鬥場；validIids 只取 bench
//   - 「阿響的寶可夢」 → name 開頭含「阿響的」
// ══════════════════════════════════════════════════════════════════════════════
regA('阿響的鳳王ex', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];

  // gate: 手牌至少 1 張基本【火】能量
  const fireEnergies = p.hand.filter(c => {
    const card = pool.get(c.cardId);
    return isBasicEnergyOfType(card, 'Fire');
  });
  if (fireEnergies.length === 0) {
    return rejectAbilityUse(st, '金色火焰：手牌沒有基本【火】能量', idx);
  }

  // gate: 備戰區至少 1 隻「阿響的」寶可夢
  const ayanoBench = p.bench.filter(c => pool.get(c.cardId)?.name?.startsWith('阿響的'));
  if (ayanoBench.length === 0) {
    return addLog(st, '金色火焰：備戰區無「阿響的」寶可夢', idx);
  }

  const max = Math.min(2, fireEnergies.length);
  const s = addLog(st,
    `金色火焰：從手牌選 0~${max} 張基本【火】能量，附於備戰區 1 隻「阿響的」寶可夢`,
    idx);
  return withPending(s, {
    type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Fire',
    minCount: 0, maxCount: max,
    effectKey: 'gold-flame-pick-energy',
    // v3.62 titleOverride：是「附於阿響的寶可夢」不是丟棄
    params: {
      validIids: fireEnergies.map(c => c.iid),
      titleOverride: `金色火焰：選 0~${max} 張手牌基本【火】能量（接著選「阿響的」寶可夢附於）`,
    },
  });
});

regR('gold-flame-pick-energy', (st, idx, energyIids, _params, pool) => {
  if (energyIids.length === 0) {
    return addLog(st, '金色火焰：未選擇能量', idx);
  }
  const p = st.players[idx];
  // 重新檢查備戰區「阿響的」寶可夢（防備中途換場）
  const ayanoBench = p.bench.filter(c => pool.get(c.cardId)?.name?.startsWith('阿響的'));
  if (ayanoBench.length === 0) {
    return addLog(st, '金色火焰：備戰區已無「阿響的」寶可夢，能量留在手牌', idx);
  }

  // 1 隻備戰直接附；多隻開 bench-choose pending
  if (ayanoBench.length === 1) {
    const target = ayanoBench[0];
    const tName = pool.get(target.cardId)?.name ?? '?';
    const energies = p.hand.filter(c => energyIids.includes(c.iid));
    let s = addLog(st,
      `金色火焰：將 ${energies.length} 張基本【火】能量附於 ${tName}`, idx);
    const attached = updatePlayer(s, idx, pl => ({
      ...pl,
      hand: pl.hand.filter(c => !energyIids.includes(c.iid)),
      bench: pl.bench.map(c => c.iid === target.iid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    }));
    // ⭐ v6.105（Fable 覆核抓到）：這條「備戰只有 1 隻 → 直接附」的捷徑，原本漏了
    //   下面 gold-flame-attach（備戰 ≥2 隻）有做的兩件事 —— 從**手牌**附能必須觸發
    //   對手的附能反應被動（耿鬼ex｜侵蝕詛咒、麻痺門牙）與己方瑪機雅娜｜自動治癒。
    //   結果同一張卡「備戰 1 隻」與「備戰 2 隻以上」行為不一致。
    //   ⚠ 通則：**fast-path 與 picker path 必須做完全一樣的副作用**，只能省掉「選誰」。
    // v6.164：卡面「最多 2 張」→ 一次附 N 張，「每次附能」反應要觸發 N 次
    //   （官方 §17.21.F：侵蝕詛咒對一次附 2 張放 4 個指示物）。
    return fireOnHandEnergyAttached(
      applyMagearnaHandAttachHeal(attached, idx, [target.iid], pool, energies.length),
      idx, target.iid, pool, energies.length);
  }

  return withPending(st, {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'gold-flame-attach',
    params: {
      energyIids,
      validIids: ayanoBench.map(c => c.iid),
    },
  });
});

regR('gold-flame-attach', (st, idx, iids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  if (iids.length === 0 || energyIids.length === 0) return st;
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  const tCard = pool.get(target.cardId);
  if (!tCard?.name?.startsWith('阿響的')) {
    return addLog(st, '金色火焰：目標非「阿響的」寶可夢，取消附加', idx);
  }
  const tName = tCard.name;
  const energies = p.hand.filter(c => energyIids.includes(c.iid));
  let s = addLog(st,
    `金色火焰：將 ${energies.length} 張基本【火】能量附於 ${tName}`, idx);
  const attached = updatePlayer(s, idx, pl => ({
    ...pl,
    hand: pl.hand.filter(c => !energyIids.includes(c.iid)),
    bench: pl.bench.map(c => c.iid === targetIid
      ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
      : c),
  }));
  // v5.662：補對手附能反應(侵蝕詛咒/麻痺門牙)
  // v6.164：per-energy-card（一次附 N 張 → 反應觸發 N 次）
  return fireOnHandEnergyAttached(
    applyMagearnaHandAttachHeal(attached, idx, [targetIid], pool, energies.length),
    idx, targetIid, pool, energies.length);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3) 拉帝歐斯（M1S）｜潔淨支援
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合，從備戰區將自己的『超級拉帝亞斯【ex】』放置於戰鬥場時，
//        可使用 1 次。選擇自己的備戰寶可夢身上附加的任意數量的能量卡，
//        改附於戰鬥寶可夢身上。」
//
// 觸發條件（自方回合 + 自己的）：
//   - 場上 active 必須是「超級拉帝亞斯ex」
//   - active.movedToActiveThisTurn === true（撤退 / KO 後 promote / 換場 等）
//   - 自方備戰至少 1 隻有附加能量
//   - 1 回合 1 次（per-instance：拉帝歐斯 abilityUsedThisTurn）
//
// UX 設計（chained pending，分多次選擇給玩家最大彈性）：
//   1. bench-choose pending：選 1 隻備戰寶可夢（minCount=0 maxCount=1）。0 = 結束
//   2. modal-choice (stepper)：「從 {pokeName}（{n} 張能量）轉移幾張？」
//   3. 把該寶可夢「最後 n 張」能量轉到戰鬥場（保留前面幾張）
//   4. 回到步驟 1，玩家可繼續從別隻備戰轉移；選 0 結束
//
// 注意：getUsableAbilities 需在 engine.ts 加 gate（已在 v2.93b 同步加）。
//   這裡的 regA fn 只負責真正觸發後的 picker chain。
// ══════════════════════════════════════════════════════════════════════════════
regA('拉帝歐斯', 0, (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  // gate：active 必須是超級拉帝亞斯ex 且本回合移到戰鬥場
  if (!p.active) return rejectAbilityUse(st, '潔淨支援：戰鬥場無寶可夢', idx);
  const activeName = pool.get(p.active.cardId)?.name;
  if (activeName !== '超級拉帝亞斯ex') {
    return addLog(st, '潔淨支援：戰鬥場非「超級拉帝亞斯ex」', idx);
  }
  if (!p.active.movedToActiveThisTurn) {
    return addLog(st, '潔淨支援：戰鬥場寶可夢非「本回合從備戰移到戰鬥場」', idx);
  }
  // gate：備戰至少 1 隻有附加能量
  const benchWithEnergy = p.bench.filter(c => c.energyAttached.length > 0);
  if (benchWithEnergy.length === 0) {
    return addLog(st, '潔淨支援：備戰寶可夢身上無能量可轉移', idx);
  }

  // v5.907：收斂到 active-energy-discard(scope='all-own') 個別能量 picker——可跨屬性自由勾選
  //   備戰寶可夢身上能量卡,改附戰鬥寶可夢(active=剛上場的超級拉帝亞斯ex)。共用 swiftcursor-energy-pick
  //   resolver(targetIid=active,只從非 target 抽出→只抽備戰)。原鏈式 bench-choose+stepper 只能取末端 N 張,
  //   無法選 1火1超(玩家回報)。
  const benchEnergyIids: string[] = [];
  for (const c of p.bench) for (const e of c.energyAttached) benchEnergyIids.push(e.iid);
  const s = addLog(st,
    '潔淨支援：選擇備戰寶可夢身上任意數量能量卡，改附戰鬥寶可夢（可跨屬性自由選、可不選）', idx);
  return withPending(s, {
    type: 'active-energy-discard', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: benchEnergyIids.length,
    effectKey: 'swiftcursor-energy-pick',
    params: {
      scope: 'all-own',
      validIids: benchEnergyIids,
      targetIid: p.active.iid,
      label: '潔淨支援',
      titleOverride: '潔淨支援：選擇備戰能量改附戰鬥寶可夢（可跨屬性自由選）',
    },
  });
});

// v5.907：舊 cleansing-support-pick-bench / cleansing-support-transfer / openCleansingNextPick
//   (鏈式 bench-choose + stepper 取末端 N 張) 已收斂到 active-energy-discard(scope=all-own) +
//   共用 swiftcursor-energy-pick(見上方 ability),移除。


// ══════════════════════════════════════════════════════════════════════════════
// 3) 鐵掌力士｜大力捕捉器 (v2.94)
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用 1 次。
//        選擇 1 隻對手的備戰寶可夢，與戰鬥寶可夢互換。」
//
// 設計：
//   - 加入 ON_EVOLVE_FROM_HAND_ABILITIES Set（engine.ts 在 EVOLVE 後 prompt 玩家）
//   - regA 觸發：選 1 隻對手備戰 → 與對手戰鬥場互換（復用 'gust-opp' resolver）
//   - 'gust-opp' 已實裝於 supporters_gust.ts，會把選中的對手備戰換到對手戰鬥場
// ══════════════════════════════════════════════════════════════════════════════
regA('鐵掌力士', 0, (st, idx, _pool, _cardInst) => {
  const dIdx = (1 - idx) as 0 | 1;
  const opp = st.players[dIdx];
  if (!opp.active) return rejectAbilityUse(st, '大力捕捉器：對手戰鬥場無寶可夢', idx);
  if (opp.bench.length === 0) return rejectAbilityUse(st, '大力捕捉器：對手備戰區無寶可夢', idx);
  // v5.995 C-05 方向修正：效果對象是被選的【備戰寶可夢】→ 原戰鬥位免疫不擋（v5.839 舊 gate 方向相反，移除）；
  //   改過濾備戰候選（免疫特性效果的備戰不可被選為互換目標）。
  const validIids = opp.bench
    // v6.028：互換位置不是「放置傷害指示物」→ 對戰圓形競技場不該擋（玩家回報本卡被誤擋）
    .filter(b => !canApplyEffectToTarget(st, idx, b, _pool.get(b.cardId), 'ability-effect', _pool, { isBench: true, counterPlacement: false }).blocked)
    .map(b => b.iid);
  if (validIids.length === 0) return addLog(st, '大力捕捉器：對手備戰寶可夢皆不受特性效果影響，無法互換', idx);
  const s = addLog(st, '大力捕捉器：選 1 隻對手備戰寶可夢與戰鬥場互換', idx);
  return withPending(s, {
    type: 'opp-bench-choose',
    actorIdx: idx,
    sourcePlayerIdx: dIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'gust-opp',
    params: { validIids },
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// 4) 狂歡浪舞鴨｜快節奏 (v2.95)
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合，若將 1 張自己的手牌放回牌庫下方，則可使用 1 次。
//        從牌庫抽卡直到自己的手牌滿 5 張為止。」
//
// 設計：
//   - regA 觸發；engine 處理 abilityUsedThisTurn gate
//   - cost: 任意 1 張手牌放回牌庫下方（不是丟棄、不是重洗）
//   - 抽牌：抽到手牌 = 5 張為止；若手牌 ≥5 則只支付 cost 不抽
//   - 「牌庫下方」= deck[deck.length-1]（PTCG 慣例：deck[0] 是頂、deck[end] 是底）
// ══════════════════════════════════════════════════════════════════════════════
regA('狂歡浪舞鴨', 0, (st, idx, _pool, _cardInst) => {
  const p = st.players[idx];
  if (p.hand.length === 0) {
    return rejectAbilityUse(st, '快節奏：手牌為空，無法支付 1 張手牌的代價', idx);
  }
  const s = addLog(st, '狂歡浪舞鴨：使用特性「快節奏」，選擇 1 張手牌放回牌庫下方', idx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'quaquaval-fast-tempo',
    params: { titleOverride: '快節奏：選 1 張手牌放回牌庫下方' },
  });
});
regR('quaquaval-fast-tempo', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) return st;
  const handIid = iids[0];
  const p = st.players[idx];
  const handIdx = p.hand.findIndex(c => c.iid === handIid);
  if (handIdx === -1) return st;
  const cardInst = p.hand[handIdx];
  const cardName = pool.get(cardInst.cardId)?.name ?? '?';
  // 1. 把該手牌移到牌庫下方（不是丟棄、不是重洗）
  let s = updatePlayer(st, idx, pl => {
    const newHand = [...pl.hand];
    newHand.splice(handIdx, 1);
    return { ...pl, hand: newHand, deck: [...pl.deck, cardInst] };
  });
  s = addLog(s, `快節奏：將「${cardName}」放回牌庫下方`, idx);
  // 2. 抽到手牌 = 5 張為止
  const newHandLen = s.players[idx].hand.length;
  if (newHandLen >= 5) {
    return addLog(s, '快節奏：手牌已達 5 張以上，不抽卡', idx);
  }
  const drawCount = 5 - newHandLen;
  s = addLog(s, `快節奏：從牌庫抽卡直到手牌滿 5 張（抽 ${drawCount} 張）`, idx);
  return drawCards(s, idx, drawCount);
});


// ══════════════════════════════════════════════════════════════════════════════
// 5) 莫魯貝可｜搜尋點心 (v2.95)
// ══════════════════════════════════════════════════════════════════════════════
// 卡面：「在自己的回合時可使用 1 次。查看自己的牌庫上方 1 張卡，回復原樣。
//        若希望，將那張卡丟棄。」
//
// 設計：
//   - regA 觸發；engine 處理 abilityUsedThisTurn gate
//   - peek 牌庫頂 1 張 → 用 modal-choice 帶 options「保留 / 丟棄」
//   - 卡名透過 log 顯示（owner-only — actorIdx == 自己 的 log 不會洩露給對手）
//   - 「回復原樣」= 不丟棄則卡片留在 deck[0]（不動）；
//     「丟棄」=  deck.shift → discard
// ══════════════════════════════════════════════════════════════════════════════
regAByName('莫魯貝可', '搜尋點心', (st, idx, pool, _cardInst) => {
  const p = st.players[idx];
  if (p.deck.length === 0) {
    return rejectAbilityUse(st, '搜尋點心：牌庫為空，無法使用', idx);
  }
  const topInst = p.deck[0];
  const topName = pool.get(topInst.cardId)?.name ?? '?';
  // v5.794：卡面「查看自己牌庫上方 1 張，回復原樣，若希望可丟棄」。選「保留」會放回牌庫頂 →
  //   公開 log 揭示卡名會讓對手得知你的牌庫頂。改用中央 addPrivateLog（出招方看卡名、對手脫敏）。
  const s = addPrivateLog(st, `莫魯貝可：使用特性「搜尋點心」，查看牌庫上方 1 張卡 → 「${topName}」`, '莫魯貝可：使用特性「搜尋點心」，查看牌庫上方 1 張卡', idx);
  return withPending(s, {
    type: 'modal-choice', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'morpeko-snack-search-v295',
    params: {
      label: '搜尋點心',
      titleOverride: `搜尋點心：牌庫頂為「${topName}」，要將其丟棄嗎？`,
      options: [
        { id: 'keep', text: '保留（回復原樣）' },
        { id: 'discard', text: `將「${topName}」丟棄` },
      ],
    },
  });
});
regR('morpeko-snack-search-v295', (st, idx, iids, _params, pool) => {
  const choice = iids[0];
  if (choice === 'keep') {
    return addLog(st, '搜尋點心：選擇保留，牌庫頂卡片回復原樣', idx);
  }
  // 'discard'
  const p = st.players[idx];
  if (p.deck.length === 0) {
    return addLog(st, '搜尋點心：牌庫已空，無卡可丟棄', idx);
  }
  const topInst = p.deck[0];
  const topName = pool.get(topInst.cardId)?.name ?? '?';
  let s = updatePlayer(st, idx, pl => ({
    ...pl,
    deck: pl.deck.slice(1),
    discard: [...pl.discard, topInst],
  }));
  s = addLog(s, `搜尋點心：將「${topName}」丟棄`, idx);
  return s;
});


// ══════════════════════════════════════════════════════════════════════════════
// 夢幻ex｜重啟（SVK 001 / id 11131 — H 標）— v5.813
//   卡面：「在自己的回合時可使用1次。從牌庫抽卡直到自己的手牌滿3張為止。」
//   先前完全未實作（getAbilityFn 回 undefined）→ 使用無任何效果。比照中央 draw-until-N
//   邏輯（need = Math.max(0, 3 - hand.length)，已滿 3 張則不抽）。
//   per-instance「每回合 1 次」由引擎 markUsed(abilityUsedThisTurn) 負責，此處不需手動設。
// ══════════════════════════════════════════════════════════════════════════════
regAByName('夢幻ex', '重啟', (state, aIdx, _pool, inst) => {
  if (!inst) return state;
  const p = state.players[aIdx];
  const need = Math.max(0, 3 - p.hand.length);
  if (need === 0) return addLog(state, '重啟：手牌已達 3 張以上，不抽卡', aIdx);
  const drawn = Math.min(need, p.deck.length);
  if (drawn === 0) return rejectAbilityUse(state, '重啟：牌庫為空', aIdx);
  const s = addLog(state, `重啟：抽到手牌滿 3（補 ${drawn} 張）`, aIdx);
  return drawCards(s, aIdx, drawn);
});
