/**
 * 呆呆王 + 超級路卡利歐 兩組預組卡效果
 *
 * v2.91 第一批 (1-5)：嚴格按卡面 JSON rulesText 實裝。每張卡的實作策略都
 *   在下方註解說明，若用到「自動挑選」等工程妥協會明寫（與扮晶晶酒 v2.57
 *   相同 precedent — AttackPreFn 同步限制）。
 */

import type { CardInstance, GameAction, GameState } from '../../types';
import { copyAttackPostDispatch } from '../_shared';
import type { Card } from '$lib/cards/types';
import { RULE_BOX_SUBTYPES } from '../../types';
import {
  reg, regR, regG, regPre, regPost, regA,
  ATTACK_PRE, ATTACK_POST, ATTACK_PRE_DISCARD_CHOICE,
  shuffle, updatePlayer, addLog, drawCards, withPending,
} from '../_shared';
import { dealAttackDamageToTarget } from '../../effects'; // v5.386：幻影碎放指示物改走中央函式（補招式效果免疫 guard）
import { flipCoinsWithLog } from '../../effects';

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
  // Step 5（v3.895 重寫）：選擇 borrowed 招式
  //   - 優先讀 action.copyAttackChoice（玩家在 UI brightChallengePicker 選的招式）
  //     · pokeIid 必須等於牌庫頂 top.iid（防 race — 若玩家從開 picker 到 confirm 之間 deck top 變了，fallback 自動挑）
  //     · attackIndex 為玩家選的招式 index（0 ≤ idx < atks.length）
  //   - fallback（AI / 舊 state / pokeIid mismatch / index 越界）：自動挑印刷傷害最高那招
  const choice = action?.copyAttackChoice;
  let pickedIdx = -1;
  let useChoice = false;
  if (choice && choice.pokeIid === top.iid && choice.attackIndex >= 0 && choice.attackIndex < atks.length) {
    pickedIdx = choice.attackIndex;
    useChoice = true;
  } else {
    // 自動挑印刷傷害最高（同扮晶晶酒 v2.57 fallback precedent）
    const parseDmg = (dmgStr: string): number => {
      const m = dmgStr.match(/^(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    let bestDmg = parseDmg(atks[0].damage);
    pickedIdx = 0;
    for (let i = 1; i < atks.length; i++) {
      const d = parseDmg(atks[i].damage);
      if (d > bestDmg) { pickedIdx = i; bestDmg = d; }
    }
  }
  const picked = atks[pickedIdx];
  const copiedKey = `${topCard.name}|${picked.name}`;
  const pickMode = useChoice ? '玩家選擇' : '自動挑印刷最高傷害';
  s = addLog(s, `耀閃挑戰：選擇「${topName}」的「${picked.name}」作為這個招式使用（${pickMode}）`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };
  // Step 6: 遞迴該招式的 regPre
  //   v3.72 QA fix：若 borrowed 招式有 binary-yes-no PRE_DISCARD_CHOICE（「若希望」類），
  //     borrowed attack 的 picker 不會跳（attack key 是耀閃挑戰不是 borrowed），
  //     player 沒機會選 yes/no。預設視為「希望」(注入 sentinel iid)，
  //     讓借者能拿到 +N 加成（如金屬之錘 +150，QA 規定即使 0 鋼能量也應 +150）。
  const copiedSpec = ATTACK_PRE_DISCARD_CHOICE.get(copiedKey);
  let dispatchAction = action;
  // v5.720：只在玩家「未透過前端 binary modal 選擇」時(action 無 discardedEnergyIids，例 AI / 舊 state)
  //   才預設「希望」fallback；玩家有選(含選「否」= 空陣列)就尊重玩家，讓玩家能選「不希望」
  //   (官方判例：借者可選不增加傷害；選希望時前端會走被借招式自己的能量流程，如金屬之錘有鋼則丟)。
  if (copiedSpec?.scope === 'binary-yes-no' && action?.discardedEnergyIids === undefined) {
    dispatchAction = {
      ...(action ?? { type: 'ATTACK', attackIndex: 0 } as Extract<GameAction, { type: 'ATTACK' }>),
      discardedEnergyIids: ['__yaoshan_borrowed_yes__'],
    };
  }
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, dispatchAction);
    // Bug fix (#18): 複製招式時，弱點/抗性必須以使用者（呆呆王＝超屬性）的屬性計算
    // 不繼承被複製招式的 skipWeakRes — 否則若複製到「不計算弱點」招式會錯誤跳過弱點
    return {
      state: sub.state,
      damage: sub.damage,
      skipWeakRes: false,
      skipDefEffects: sub.skipDefEffects,
    };
  }
  // 無註冊 regPre → 退回印刷傷害（解析 picked.damage 數字）
  const parseDmgFallback = (dmgStr: string): number => {
    const m = dmgStr.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  return { state: s, damage: parseDmgFallback(picked.damage) };
});
// regPost 轉接到被複製招式的 ATTACK_POST（與扮晶晶酒對稱）
regPost('呆呆王|耀閃挑戰', copyAttackPostDispatch);

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
regPre('超級袋獸ex|機關槍合擊', (state, aIdx, _pool, action) => {
  // v5.164：設 coinFlippedThisAttack=true（重試徽章 ATTACK 末端 modal trigger 依賴此 flag）。
  //   動態次數擲幣（直到反面）無法用 flipCoinsWithLog（固定次數）helper，故 inline 設。
  // v5.165：擲幣明細存到 state._machineGunLastFlips 供 retry-badge modal 顯示；
  //         若 action._retryInjectedFlips 有值（玩家選「保留前次結果」時 engine 重跑帶入）
  //         → 跳過 random，用既定陣列依序判定（語義：玩家確認後才正式套用此次擲幣結果）。
  // v5.x：每次擲幣逐一走 flipCoinsWithLog（設 coinFlippedThisAttack、自行 consume
  //   _retryInjectedFlipsQueue 注入、append _machineGunLastFlips 供 retry-badge modal 顯示）。
  //   不再 inline 維護 flips 陣列 / 自行讀 action._retryInjectedFlips —
  //   engine keep 路徑同時設 state queue，由 flipCoinsWithLog 統一消費。
  void action;
  let s: GameState = state;
  let heads = 0;
  for (let i = 0; i < 20; i++) {
    const r = flipCoinsWithLog(s, 1, '機關槍合擊', aIdx);
    s = r.state;
    if (r.heads === 1) heads++;
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
  // v5.386：改走中央 dealAttackDamageToTarget（kind='attack-effect'）— 補上原本完全漏掉的
  //   招式效果免疫 guard（化隱/純樸/對戰圓形/球形盾牌 等「放傷害指示物」該擋）。
  //   放 N 個指示物 = N×10 傷害；KO 由 dealAttackDamageToTarget inline 處理（移除目標、不雙重）。
  const counters = (params?.counters as number) ?? 12;
  return dealAttackDamageToTarget(st, idx, iids[0], counters * 10, pool, { kind: 'attack-effect', label: `幻影碎（${counters} 個指示物）` });
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
regPre('超級路卡利歐ex|波動突刺', (state) => ({ state, damage: 0 })); // v5.508：傷害延後到附能量後（log 先效果後傷害）
regPost('超級路卡利歐ex|波動突刺', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defIid = state.players[dIdx].active?.iid;
  // 漸強波 pattern：附能量後才造傷害；無對手 active 理論上不會發生（攻擊需對手 active）。
  const dealNow = (s: GameState) => defIid
    ? dealAttackDamageToTarget(s, aIdx, defIid, 130, pool, { kind: 'attack-damage', label: '波動突刺' })
    : s;
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return dealNow(addLog(state, '波動突刺：備戰區沒有寶可夢，無法附加能量', aIdx));
  }
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.name?.includes('【鬥】') ?? false);
  });
  if (cand.length === 0) {
    return dealNow(addLog(state, '波動突刺：棄牌區沒有基本【鬥】能量', aIdx));
  }
  const maxTake = Math.min(3, cand.length);
  const s = addLog(state,
    `波動突刺：從棄牌區選最多 ${maxTake} 張「基本【鬥】能量」，再以 +/- 分配到備戰`,
    aIdx);
  return withPending(s, {
    type: 'discard-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'BasicFightingEnergy', minCount: 0, maxCount: maxTake,
    effectKey: 'pulse-thrust-energies-picked',
    params: { defIid },
  });
});

// v5.508：選完 0~3 張能量 → 開「單一」energy-distribute (+/-) 分配到備戰（金屬製造者式），
//   分配完在 resolver 內才造成 130 傷害（log 效果在傷害前）。原逐張 bench-choose chain 已移除。
regR('pulse-thrust-energies-picked', (st, idx, energyIids, params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const defIid = (params?.defIid as string | undefined) ?? st.players[dIdx].active?.iid;
  const dealNow = (s: GameState) => defIid
    ? dealAttackDamageToTarget(s, idx, defIid, 130, pool, { kind: 'attack-damage', label: '波動突刺' })
    : s;
  if (energyIids.length === 0) {
    return dealNow(addLog(st, '波動突刺：未選擇能量，略過附加', idx));
  }
  const benchIids = st.players[idx].bench.map(c => c.iid);
  if (benchIids.length === 0) return dealNow(st);
  const s = addLog(st, '波動突刺：以 +/- 分配【鬥】能量到備戰寶可夢', idx);
  return withPending(s, {
    type: 'energy-distribute', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: energyIids.length, maxCount: energyIids.length,
    effectKey: 'pulse-thrust-distribute',
    params: {
      label: '波動突刺', energyIids, validIids: benchIids,
      totalCount: energyIids.length, placedCount: 0, energyTypeName: '鬥', defIid,
    },
  });
});

// v5.508：分配 resolver（mirror v87-energy-distribute-flat 的附能量）→ 再造成 130 傷害。
//   selectedIids 長度 = totalCount，每元素 = 該張能量要附給哪隻備戰。
regR('pulse-thrust-distribute', (st, idx, selectedIids, params, pool) => {
  const energyIids = ((params?.energyIids as string[] | undefined) ?? []).slice();
  const defIid = params?.defIid as string | undefined;
  let s: GameState = st;
  const useCount = Math.min(selectedIids.length, energyIids.length);
  const tally = new Map<string, number>();
  for (let i = 0; i < useCount; i++) {
    const targetIid = selectedIids[i];
    const energyIid = energyIids[i];
    const pl = s.players[idx];
    const energyInst = pl.discard.find(c => c.iid === energyIid);
    const target = pl.bench.find(c => c.iid === targetIid);
    if (!energyInst || !target) continue;
    s = updatePlayer(s, idx, pp => ({
      ...pp,
      discard: pp.discard.filter(c => c.iid !== energyIid),
      bench: pp.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, energyInst] }
        : c),
    }));
    tally.set(targetIid, (tally.get(targetIid) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [tid, n] of tally) {
    const tInst = s.players[idx].bench.find(c => c.iid === tid);
    parts.push(`${tInst ? (pool.get(tInst.cardId)?.name ?? '?') : '?'}×${n}`);
  }
  if (parts.length > 0) {
    s = addLog(s, `波動突刺：將 ${parts.join('、')} 共 ${useCount} 張基本【鬥】能量附到備戰`, idx);
  }
  // 效果後再造成傷害（漸強波 pattern）
  if (defIid) s = dealAttackDamageToTarget(s, idx, defIid, 130, pool, { kind: 'attack-damage', label: '波動突刺' });
  return s;
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
// v6.006（線上穩健化）：原「兩步 chained deck-search（step1 先把選中卡從牌庫移出、把整個
//   CardInstance 暫存進 pending.params，step2 再放回）」是全站唯一此模式，在線上錦標賽 live-room
//   造成客戶端卡在 picker（選不了卡/當掉→閒置判負；CSD子龍 vs 大吾 R2 dump 佐證：伺服器已完整
//   解完、finalState 無殘留 pending，但客戶端 desync 卡死）。改為【單一 deck-search 一次選 2 張】：
//   不中途移卡、不暫存 CardInstance、無 chained pending（單一 RESOLVE_SELECTION）→ 線上不再 desync，
//   且不可能掉卡。resolver 依玩家選取順序放回牌庫上方（維持 Leon v2.96 排序語義：先選＝上方第 2 位、
//   後選＝最上方），其餘重洗。
reg('暗碼迷的解讀', (st, idx) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '暗碼迷的解讀：牌庫已空', idx);
  if (p.deck.length === 1) {
    // 牌庫只剩 1 張 — 卡面「任意選擇 2 張」不可能滿足，降級：該張本就在牌庫上方，無需選擇/重洗
    return addLog(st, '暗碼迷的解讀：牌庫只剩 1 張，無需選擇', idx);
  }
  const s = addLog(st,
    '暗碼迷的解讀：從牌庫選 2 張放回牌庫上方（先選＝上方第 2 位、後選＝最上方），其餘重洗',
    idx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Any',
    minCount: 2, maxCount: 2,
    effectKey: 'cipher-geek-arrange-top',
    params: { titleOverride: '暗碼迷的解讀：選 2 張放回牌庫上方（先選＝上方第 2 位、後選＝最上方）' },
  });
});
// 單步 resolver：依玩家選取順序（selectedIids 反映點選序，UI selectionPicked 為 Set 保留插入序）
//   放回牌庫上方 —— 先選的放上方第 2 位、後選的放最上方（= 牌庫頂順序為選取序 reverse），其餘重洗。
//   全程不從牌庫移卡、不暫存 CardInstance；任何情況總卡數守恆（不可能掉卡）。
regR('cipher-geek-arrange-top', (st, idx, iids) => {
  const p = st.players[idx];
  const chosen = ((iids ?? []) as string[])
    .map(iid => p.deck.find(c => c.iid === iid))
    .filter((c): c is CardInstance => !!c);
  if (chosen.length === 0) {
    // 未選到任何卡（理論上 minCount=2 保證有選）→ 全部重洗，安全不掉卡
    return updatePlayer(st, idx, pl => ({ ...pl, deck: shuffle([...pl.deck]) }));
  }
  const chosenIids = new Set(chosen.map(c => c.iid));
  const rest = p.deck.filter(c => !chosenIids.has(c.iid));
  // 先選的放上方第 2 位、後選的放最上方 → 牌庫頂順序 = 選取序反轉
  const topOrder = [...chosen].reverse();
  return updatePlayer(st, idx, pl => ({ ...pl, deck: [...topOrder, ...shuffle(rest)] }));
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
//   且 card.stage === 'Stage2' → hp