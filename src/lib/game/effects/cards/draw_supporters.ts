/**
 * 抽牌 / 洗牌 / 互動 Supporter 群 — 模組化批次 v2.12 (Session 38b9)
 *
 * 原位於 effects.ts 67-180 行：
 *   - 即時支援者：管理員 / 帕底亞的夥伴 / 納莉 / 丹瑜 / 紫竽 / 松葉的信心 / 枇琶
 *   - 互動支援者：艾莉絲的鬥志（hand-discard → draw-up-to-6）
 *                 探險家的嚮導（TOP6 → 選 2 加手牌，其餘丟棄）
 *
 * v2.14 (Session 38bb)：新增 鳴依的勉勵 — 棄牌基本能量 → 2 階進化寶可夢附加
 *
 * 這些卡都是訓練家（Supporter），只依賴 _shared.ts 匯出的 reg / regR / helper，
 * 不涉及攻擊系統 / 特性 / 道具 / Stadium / 被動減傷等機制，byte-exact 搬運。
 */

import {
  reg, regR, regG,
  addLog, addPrivateLog, updatePlayer, withPending,
  drawCards, discardHand, returnHandToDeck,
  sameEvoName, shuffle,
} from '../_shared';
import type { CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';

// 本地複製 engine.ts 的 isStage2PokemonCard 判定，避免 engine ↔ effects 循環 import。
// 規則：evolvesFrom 存在，且該 evolvesFrom（Stage1）本身也有 evolvesFrom（指回 Basic）。
function isStage2PokemonCardLocal(
  card: Card | undefined,
  pool: Map<string, Card>
): boolean {
  if (!card || card.supertype !== 'Pokemon' || !card.evolvesFrom) return false;
  for (const c of pool.values()) {
    if (sameEvoName(c.name, card.evolvesFrom) && c.supertype === 'Pokemon' && c.evolvesFrom) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════════════
// 即時支援者（無需互動）
// ══════════════════════════════════════════════════════════════════════════════

// 管理員 — 抽 2 張；若場上有「居民會館」則不丟棄這張，放回牌庫並重洗
// v2.228 補：之前漏掉「若場上有居民會館，則不丟棄這張管理員，放回牌庫並重洗」
// ⭐ v6.127 官方判準：效果完全無法執行時，訓練家卡不能使用
//   （PTCG_RULES.md L805 電氣發生器／L819 野餐籃／L821 牌庫0／L1957 過度放電）。
// 卡面「從自己的牌庫抽出2張卡。然後，若場上有『居民會館』，則不丟棄這張『管理員』，
//   而是放回牌庫並重洗。」→ 牌庫空**且**場上沒有居民會館時才完全無效果；
//   ⚠ 有居民會館時即使牌庫空，「這張卡放回牌庫」仍會改變盤面 → 仍可使用
//     （官方 L1712 夜間學院：牌庫0仍可用，因為另一部分效果能執行）。
regG('管理員', (st, idx, pool) => {
  if (st.players[idx].deck.length > 0) return true;
  return (st.activeStadium ? pool.get(st.activeStadium.cardId)?.name : null) === '居民會館';
});
reg('管理員', (st, idx, pool) => {
  st = addLog(st, '管理員：抽 2 張', idx);
  st = drawCards(st, idx, 2);
  // 檢查活躍 stadium 是否為「居民會館」
  const stadiumName = st.activeStadium ? pool.get(st.activeStadium.cardId)?.name : null;
  if (stadiumName === '居民會館') {
    // 把剛丟到棄牌的管理員撿回牌庫並重洗（取最後一張同名「管理員」即可）
    const player = st.players[idx];
    let foundIdx = -1;
    for (let i = player.discard.length - 1; i >= 0; i--) {
      if (pool.get(player.discard[i].cardId)?.name === '管理員') {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx >= 0) {
      const inst = player.discard[foundIdx];
      st = updatePlayer(st, idx, p => ({
        ...p,
        discard: [...p.discard.slice(0, foundIdx), ...p.discard.slice(foundIdx + 1)],
        deck: shuffle([...p.deck, inst]),
      }));
      st = addLog(st, '管理員：場上有居民會館，將自身放回牌庫並重洗', idx);
    }
  }
  return st;
});

// 帕底亞的夥伴 — 抽 3 張
// ⭐ v6.127 官方判準：效果完全無法執行時，訓練家卡不能使用
//   （PTCG_RULES.md L805 電氣發生器／L819 野餐籃／L821 牌庫0／L1957 過度放電）。
// 卡面「從自己的牌庫抽出3張卡」→ 牌庫為空＝完全無效果（官方 L821 同型）。
regG('帕底亞的夥伴', (st, idx) => st.players[idx].deck.length > 0);
reg('帕底亞的夥伴', (st, idx) => {
  st = addLog(st, '帕底亞的夥伴：抽 3 張', idx);
  return drawCards(st, idx, 3);
});

// 納莉 — 抽 4 張；在使用此卡的回合結束時，若手牌 ≥5 張則全丟
// v2.228 補：之前漏掉「END_TURN 手牌≥5 全丟」trigger
// ⭐ v6.128 **站長裁定（2026-08-08）**：這張卡在牌庫為空時**不能執行**。
//   ⚠ 它屬於 v6.127 留下的「多部效果卡」灰區 —— 牌庫空時仍有第二段（棄手牌／回合結束）
//     可以執行，依官方 L833 阿楓／L1712 夜間學院的通則「一部分能執行就可用」原本可能放行。
//     但那半段對玩家**只有壞處**（棄自己的手牌／直接結束回合），站長裁定：主效果無法執行
//     就不能使用，不讓玩家誤按而只吃到代價。
// 卡面：「從自己的牌庫抽出4張卡。在使用了這張卡的回合結束時，若自己的手牌有5張以上，
//        則將自己的手牌全部丟棄。」→ 牌庫空＝抽不到卡，只剩回合結束棄手牌的代價。
regG('納莉', (st, idx) => st.players[idx].deck.length > 0);
reg('納莉', (st, idx) => {
  st = addLog(st, '納莉：抽 4 張（若回合結束時手牌 ≥5 將全部丟棄）', idx);
  st = drawCards(st, idx, 4);
  // 設旗標：END_TURN 在 engine.ts 處理「於 aIdx 方檢查 hand.length>=5 → 全丟」
  return updatePlayer(st, idx, p => ({ ...p, nanuDiscardAtTurnEnd: true }));
});

// 丹瑜 — 手牌全丟，抽 5 張（先攻第一回合可用）
// ⭐ v6.128 **站長裁定（2026-08-08）**：這張卡在牌庫為空時**不能執行**。
//   ⚠ 它屬於 v6.127 留下的「多部效果卡」灰區 —— 牌庫空時仍有第二段（棄手牌／回合結束）
//     可以執行，依官方 L833 阿楓／L1712 夜間學院的通則「一部分能執行就可用」原本可能放行。
//     但那半段對玩家**只有壞處**（棄自己的手牌／直接結束回合），站長裁定：主效果無法執行
//     就不能使用，不讓玩家誤按而只吃到代價。
// 卡面：「這張卡可在先攻玩家的最初回合使用。將自己的手牌全部丟棄，從牌庫抽出5張卡。」
//   → 牌庫空＝抽不到卡，只剩「把自己手牌全丟掉」的代價。
regG('丹瑜', (st, idx) => st.players[idx].deck.length > 0);
reg('丹瑜', (st, idx) => {
  st = addLog(st, '丹瑜：手牌全丟，抽 5 張', idx);
  st = discardHand(st, idx);
  return drawCards(st, idx, 5);
});

// 紫竽 — 手牌洗回牌庫，抽 4 張；若對手剩餘獎賞 ≤3 則改抽 8 張
// v2.228 補：之前漏掉「若對手剩餘獎賞卡的張數為 3 張以下，則改爲抽出 8 張卡」
reg('紫竽', (st, idx) => {
  const oppPrizes = st.players[(1 - idx) as 0 | 1].prizes.length;
  const drawN = oppPrizes <= 3 ? 8 : 4;
  st = addLog(st,
    `紫竽：手牌洗回牌庫，抽 ${drawN} 張（對手剩餘獎賞 ${oppPrizes} 張${oppPrizes <= 3 ? ' ≤3 → 8 張' : ''}）`,
    idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, drawN);
});

// 松葉的信心 — 丟 1 張手牌，從牌庫抽出與對手備戰寶可夢相同數量的卡
// v2.227 修根源：之前完全寫錯（複製紫竽/莉莉艾的「洗回牌庫抽 5」）。
//   卡面：「這張卡必須將自己的 1 張手牌丟棄才可使用。
//          從自己的牌庫抽出與對手的備戰寶可夢相同數量的卡。」
//   regG：手牌至少 2 張（1 張支援者本身 + 1 張要丟）
regG('松葉的信心', (st, idx) => st.players[idx].hand.length >= 2);
reg('松葉的信心', (st, idx) => {
  // 此時支援者已從手牌進棄牌，hand.length >= 1 表示有可丟的卡
  if (st.players[idx].hand.length === 0) {
    return addLog(st, '松葉的信心：手牌為空，無法支付丟棄 1 張的代價', idx);
  }
  st = addLog(st, '松葉的信心：選 1 張手牌丟棄，再從牌庫抽與對手備戰寶可夢相同數量的卡', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'matsuba-confidence',
  });
});
regR('matsuba-confidence', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `松葉的信心：丟棄 ${names}`, idx);
  }
  st = updatePlayer(st, idx, (p) => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const hand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand, discard: [...p.discard, ...toDiscard] };
  });
  const oppIdx = (1 - idx) as 0 | 1;
  const benchN = st.players[oppIdx].bench.length;
  if (benchN === 0) {
    return addLog(st, '松葉的信心：對手備戰寶可夢 0 隻 → 抽 0 張', idx);
  }
  st = addLog(st, `松葉的信心：對手備戰寶可夢 ${benchN} 隻 → 抽 ${benchN} 張`, idx);
  return drawCards(st, idx, benchN);
});

// 莉莉艾的決意 — 手牌洗回牌庫，抽 6 張（獎賞卡剩 6 張時抽 8 張）
// v2.24 從 effects.ts 搬遷
reg('莉莉艾的決意', (st, idx) => {
  const prizes = st.players[idx].prizes.length;
  const drawCount = prizes >= 6 ? 8 : 6;
  st = addLog(st, `莉莉艾的決意：手牌洗回牌庫，抽 ${drawCount} 張`, idx);
  st = returnHandToDeck(st, idx);
  return drawCards(st, idx, drawCount);
});

// 枇琶 — 查看對手手牌，從其中選擇最多 2 張「物品卡」將其丟棄
// v2.38 升級為完整實裝（不再簡化）；原版簡化為「抽 3 張」是錯的。
//   依官方文字（`rulesText` 亦印證）：
//   「查看對手的手牌，從其中選擇最多2張物品卡，將其丟棄。」
// 實裝機制：
//   - 先掃對手手牌，挑出 Trainer/Item 的 iids 放入 validIids 傳給 UI。
//   - 開 'hand-discard' 選單，sourcePlayerIdx = 對手，actorIdx = 自己，
//     minCount=0（允許不選，例如只有 1 張時也可只選 1 或 0）、maxCount=min(2, 物品張數)、
//     filter='Item'（UI / AI 據此過濾）。
//   - UI 會以 validIids 限定「只有物品卡可點選」；非物品的手牌在 UI 下方
//     揭露區塊（`<details>` 對手手牌其餘卡）裡僅供查看，不可選。
//   - Resolver 把選取的 iids 從對手 hand 移到對手 discard。
// v6.089：卡面「查看對手的手牌，從其中選擇最多2張物品卡丟棄」→ 對手手牌 0 張時
//   連看都沒得看，打出完全沒效果。對手手牌張數是公開資訊（同瑪琪艾兒的既有守衛）。
regG('枇琶', (st, idx) => st.players[(1 - idx) as 0 | 1].hand.length > 0);
reg('枇琶', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppHand = st.players[dIdx].hand;
  if (oppHand.length === 0) {
    return addLog(st, '枇琶：對手手牌為空，無效果', idx);
  }
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v3.9992：揭示對手手牌改 addPrivateLog
  let s = addPrivateLog(st,
    `枇琶：查看對手手牌（${oppHand.length} 張）— ${handNames}`,
    `枇琶：查看對手手牌（${oppHand.length} 張）`,
    idx);
  const itemIids = oppHand
    .filter(c => {
      const card = pool.get(c.cardId);
      return card?.supertype === 'Trainer' && card.subtype === 'Item';
    })
    .map(c => c.iid);
  // v2.41：即使對手沒有物品卡，也必須開 UI 讓玩家查看對手整副手牌
  //   — Leon：「就算對手沒有物品卡，也應該跑出ui，讓玩家查看
  //     (因為還能確認對方的手牌內容，是一個重要戰略)」
  // 以 maxCount:0 + 空 validIids 進 pending → UI 下方 <details> 會揭露對手
  // 全部手牌（pickableIids=空集合 → otherHand=整副手牌），footer 顯示
  // 「不選（跳過）」讓玩家確認關閉。resolver 收到空 selectedIids 正常走完
  // 「未選取任何物品卡」日誌分支。
  if (itemIids.length === 0) {
    s = addLog(s, '枇琶：對手手牌無物品卡，可確認手牌內容後結束', idx);
    return withPending(s, {
      type: 'hand-discard',
      actorIdx: idx,
      sourcePlayerIdx: dIdx,
      minCount: 0,
      maxCount: 0,
      filter: 'Item',
      effectKey: 'loquat-discard-opp-items',
      params: { validIids: [] },
    });
  }
  s = addLog(s, `枇琶：可丟棄對手最多 ${Math.min(2, itemIids.length)} 張物品卡`, idx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: idx,
    sourcePlayerIdx: dIdx,
    minCount: 0,
    maxCount: Math.min(2, itemIids.length),
    filter: 'Item',
    effectKey: 'loquat-discard-opp-items',
    params: { validIids: itemIids },
  });
});

// v2.38 枇琶 resolver — 將選取的對手手牌（物品卡）移到對手棄牌區
regR('loquat-discard-opp-items', (st, actorIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - actorIdx) as 0 | 1;
  const oppP = st.players[dIdx];
  const picks = oppP.hand.filter(c => selectedIids.includes(c.iid));
  if (picks.length === 0) {
    return addLog(st, '枇琶：未選取任何物品卡', actorIdx);
  }
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const pickedSet = new Set(selectedIids);
  return updatePlayer(
    addLog(st, `枇琶：丟棄對手 ${picks.length} 張物品卡 — ${names}`, actorIdx),
    dIdx,
    p => ({
      ...p,
      hand: p.hand.filter(c => !pickedSet.has(c.iid)),
      discard: [...p.discard, ...picks],
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 互動支援者
// ══════════════════════════════════════════════════════════════════════════════

// 艾莉絲的鬥志 — 丟棄 1 張手牌，抽至 6 張
// v6.089：卡面「這張卡必須將自己的1張手牌丟棄才可使用」＝印刷 cost。
//   手牌只剩這張時 cost 付不出來 → 照卡娜莉／秘密箱的既有守衛形態 gate（含此卡需 ≥2 張）。
//   ⚠ 只 gate cost，不 gate「手牌已≥6 抽 0 張」——抽牌類依站內慣例一律放行。
regG('艾莉絲的鬥志', (st, idx) => st.players[idx].hand.length >= 2);
reg('艾莉絲的鬥志', (st, idx) => {
  const hand = st.players[idx].hand;
  if (hand.length === 0) {
    return addLog(st, '艾莉絲的鬥志：手牌為空，無法使用', idx);
  }
  st = addLog(st, '艾莉絲的鬥志：選 1 張手牌丟棄，再抽至 6 張', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'alice-courage',
  });
});
regR('alice-courage', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `艾莉絲的鬥志：丟棄 ${names}`, idx);
  }
  st = updatePlayer(st, idx, (p) => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    const hand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand, discard: [...p.discard, ...toDiscard] };
  });
  const needed = Math.max(0, 6 - st.players[idx].hand.length);
  return drawCards(st, idx, needed);
});

// 探險家的嚮導 — 查看牌庫頂 6 張，選 2 張加手牌，其餘丟棄
// v2.226 加 regG：牌庫為空時不可打出
regG('探險家的嚮導', (st, idx) => st.players[idx].deck.length > 0);
reg('探險家的嚮導', (st, idx) => {
  const top6Iids = st.players[idx].deck.slice(0, 6).map(c => c.iid);
  if (top6Iids.length === 0) {
    return addLog(st, '探險家的嚮導：牌庫為空', idx);
  }
  // v5.259: 卡面強制「選擇 2 張」，minCount = min(2, 可選數) (牌庫不足才允許 N<2)
  const requiredMin = Math.min(2, top6Iids.length);
  st = addLog(st, `探險家的嚮導：查看牌庫頂 ${top6Iids.length} 張，需強制選 ${requiredMin} 張`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TOP6',
    minCount: requiredMin, maxCount: 2,
    effectKey: 'explorer-guide',
    params: { top6Iids },
  });
});
regR('explorer-guide', (st, idx, iids, params, _pool) => {
  const top6Iids = (params?.top6Iids as string[]) ?? [];
  return updatePlayer(st, idx, (p) => {
    const top6 = p.deck.filter(c => top6Iids.includes(c.iid));
    const rest = p.deck.filter(c => !top6Iids.includes(c.iid));
    const chosen = top6.filter(c => iids.includes(c.iid));
    const discarded = top6.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      deck: rest,
      hand: [...p.hand, ...chosen],
      discard: [...p.discard, ...discarded],
    };
  });
});

// 鳴依的勉勵 — 自己剩餘獎賞 > 對手剩餘獎賞時可用：
//   從棄牌區選最多 2 張基本能量 → 附於 1 隻自己的 2 階進化寶可夢
//
// 流程：discard-search（BasicEnergy, 1-2）→ heal-target（限 Stage2 iids）→ 附加能量
// 若棄牌區剛好只剩 1 張可選，或場上只有 1 隻 Stage2，會在 resolver 盡量自動化。
regG('鳴依的勉勵', (st, idx, pool) => {
  const oppIdx = (1 - idx) as 0 | 1;
  if (st.players[idx].prizes.length <= st.players[oppIdx].prizes.length) return false;
  const hasBasicEnergy = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (!hasBasicEnergy) return false;
  const p = st.players[idx];
  const allSelf: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  return allSelf.some(c => isStage2PokemonCardLocal(pool.get(c.cardId), pool));
});
reg('鳴依的勉勵', (st, idx, pool) => {
  const p = st.players[idx];
  const cand = p.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  const maxPick = Math.min(2, cand.length);
  st = addLog(st, `鳴依的勉勵：從棄牌選最多 ${maxPick} 張基本能量附於 1 隻【2階進化】寶可夢`, idx);
  return withPending(st, {
    type: 'discard-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy', minCount: 1, maxCount: maxPick,
    effectKey: 'naruei-encourage-pick-target',
  });
});
regR('naruei-encourage-pick-target', (st, idx, iids, _params, pool) => {
  const p = st.players[idx];
  const allSelf: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
  const validStage2 = allSelf.filter(c => isStage2PokemonCardLocal(pool.get(c.cardId), pool));
  if (validStage2.length === 0) {
    // 場上沒有 Stage2（理論上 guard 會擋，保險）：能量已從 discard-search 點選，但不附加
    return addLog(st, '鳴依的勉勵：場上沒有 2 階進化寶可夢，取消附加', idx);
  }
  // 場上只有 1 隻 Stage2 → 直接附加
  if (validStage2.length === 1) {
    const target = validStage2[0];
    const energies = p.discard.filter(c => iids.includes(c.iid));
    const targetName = pool.get(target.cardId)?.name ?? '?';
    let s = addLog(st, `鳴依的勉勵：將 ${energies.length} 張基本能量附加到 ${targetName}`, idx);
    return updatePlayer(s, idx, pl => {
      const rest = pl.discard.filter(c => !iids.includes(c.iid));
      if (pl.active && pl.active.iid === target.iid) {
        return {
          ...pl,
          discard: rest,
          active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] },
        };
      }
      return {
        ...pl,
        discard: rest,
        bench: pl.bench.map(c => c.iid === target.iid
          ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
          : c),
      };
    });
  }
  // 多隻 Stage2 → 第二步選目標
  return withPending(st, {
    type: 'heal-target', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'naruei-encourage-commit',
    params: { energyIids: iids, validIids: validStage2.map(c => c.iid) },
  });
});
regR('naruei-encourage-commit', (st, idx, iids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const targetIid = iids[0];
  const p = st.players[idx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return st;
  // ⭐ v6.105 公平性（Fable 覆核抓到）：resolver 收到的 iid 來自 client，必須自驗。
  //   卡面限「自己的 1 隻【2階進化】寶可夢」；引擎的中央 sanitize 對非 deck-search
  //   是原封放行的，這裡不驗就能把能量附到任何一隻自家寶可夢。
  const validIids = (params?.validIids as string[] | undefined) ?? [];
  if (validIids.length > 0 && !validIids.includes(targetIid)) {
    return addLog(st, '鳴依的勉勵：選擇的目標不合法，取消附加', idx);
  }
  if (!isStage2PokemonCardLocal(pool.get(target.cardId), pool)) {
    return addLog(st, '鳴依的勉勵：目標不是 2 階進化寶可夢，取消附加', idx);
  }
  const energies = p.discard.filter(c => energyIids.includes(c.iid));
  if (energies.length === 0) return st;
  const targetName = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `鳴依的勉勵：將 ${energies.length} 張基本能量附加到 ${targetName}`, idx);
  return updatePlayer(s, idx, pl => {
    const rest = pl.discard.filter(c => !energyIids.includes(c.iid));
    if (pl.active && pl.active.iid === targetIid) {
      return {
        ...pl,
        discard: rest,
        active: { ...pl.active, energyAttached: [...pl.active.energyAttached, ...energies] },
      };
    }
    return {
      ...pl,
      discard: rest,
      bench: pl.bench.map(c => c.iid === targetIid
        ? { ...c, energyAttached: [...c.energyAttached, ...energies] }
        : c),
    };
  });
});

// ── 琵魯（Supporter / J）── v2.179 ────────────────────────────────────────────
// 卡面：從牌庫抽卡直到自己的手牌滿 5 張為止。
//       若希望，在從牌庫抽卡前，將自己的任意數量的手牌丟棄。
// 實裝：開 hand-discard pending（任意 0~hand.length），resolver 棄掉所選 + 抽到 5。
// gate：永遠可用（牌庫空也允許 — 卡面沒禁；丟掉手牌也可能是策略）。
reg('琵魯', (st, idx) => {
  st = addLog(st, '琵魯：選擇要丟棄的手牌（可不選），然後抽卡直到滿 5 張', idx);
  const handLen = st.players[idx].hand.length;
  if (handLen === 0) {
    // 沒手牌可丟，直接抽到 5
    const need = Math.max(0, 5 - st.players[idx].hand.length);
    return drawCards(st, idx, need);
  }
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 0, maxCount: handLen,
    effectKey: 'pirou-discard-then-draw',
  });
});
regR('pirou-discard-then-draw', (st, idx, iids, _params, pool) => {
  const chosen = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `琵魯：丟棄 ${chosen.length} 張手牌（${names}）`, idx);
    st = updatePlayer(st, idx, p => ({
      ...p,
      hand: p.hand.filter(c => !iids.includes(c.iid)),
      discard: [...p.discard, ...chosen],
    }));
  } else {
    st = addLog(st, '琵魯：未丟棄任何手牌', idx);
  }
  const need = Math.max(0, 5 - st.players[idx].hand.length);
  if (need > 0) {
    st = addLog(st, `琵魯：抽到 5 張手牌（補 ${need} 張）`, idx);
    st = drawCards(st, idx, need);
  } else {
    st = addLog(st, '琵魯：手牌已滿 5 張，不抽', idx);
  }
  return st;
});

