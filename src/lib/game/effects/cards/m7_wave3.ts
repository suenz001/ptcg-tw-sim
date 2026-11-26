// ⭐v6.672 M7「波導探求者」實裝 批次 3 —— 主動特性、道具、支援者、競技場、血紅恐懼
//
// ⚠ 卡面逐字取自 static/cards/M7.json（台灣官方中文），未經簡化。
// ⚠ 主動特性的「能不能按」寫在 engine getUsableAbilities（哨兵 v6672-ability-gates，判準①）；
//    這裡的 rejectAbilityUse 只是後備（USE_ABILITY 先標記已使用再呼叫本檔，gate 不能只寫在這裡）。

import {
  reg, regG, regR, regPre, regPost, regAByName,
  addLog, updatePlayer, withPending, shuffle, drawCards, rejectAbilityUse, bareCardsForReturn,
} from '../_shared';
import { TOOL_ON_KO } from './tools';
import { isMegaExCard, isBasicEnergyOfType } from '../../selection-filter';
import { applyStatusToOppActive, hasEffectivePokemonType, openPeekOppHandView } from '../../effects';
import { isImmuneToOppAbilityEffect } from '../../defense';
import type { CardInstance, GameState, PendingSelection, PlayerState } from '../../types';
import type { Card } from '$lib/cards/types';

// >>> v6672-bond-sash
// ⭐v6.672 M7 牽絆披帶：「附有這張卡的『超級進化寶可夢【ex】』受到對手的寶可夢招式的傷害而【昏厥】時，
//   從自己的牌庫任意選擇1張卡加入手牌。並且重洗牌庫。」
//   ⚠ 持有者不是超級進化寶可夢ex ⇒ 沒有效果（判準走中央 isMegaExCard）。
//   ⚠「任意選擇」＝無條件檢索 ⇒ 牌庫有卡就**必須選 1 張**（官方 L1454 親送無人機／L1708 仙后）。
//   ⚠ 卡面沒有「給對手看過」⇒ 不公開卡名（同 希望護身符）。卡面也沒有「在戰鬥場」⇒ 備戰被打倒也觸發（TOOL_ON_KO_BENCH_ALSO）。
TOOL_ON_KO.set('牽絆披帶', (state, dIdx, _aIdx, pool, koInst) => {
  if (!isMegaExCard(pool.get(koInst.cardId))) return state;
  const n = state.players[dIdx].deck.length;
  if (n === 0) return addLog(state, '牽絆披帶：牌庫為空', dIdx);
  state = addLog(state, '牽絆披帶：從牌庫任意選擇 1 張卡加入手牌並重洗', dIdx);
  return withPending(state, {
    type: 'deck-search',
    actorIdx: dIdx, sourcePlayerIdx: dIdx,
    minCount: Math.min(1, n), maxCount: Math.min(1, n),
    filter: 'any',
    effectKey: 'search-to-hand-reshuffle',
    params: { privateReveal: true },
  });
});
// <<< v6672-bond-sash


// ── 超級阿勃梭魯Zex｜血紅恐懼 ──────────────────────────────────────────────
// 卡面：160。「在下個對手的回合，對手無法從手牌附上特殊能量卡，也無法使出競技場卡。」
//   ⚠ 玩家層級的封鎖（主詞是「對手」不是對手的寶可夢）⇒ 不受寶可夢的效果免疫影響（同 古玉魚｜燒灼大地）。
//   ⚠ 兩個旗標都走既有 NextTurn → ThisTurn 的 END_TURN promote／clear（engine 哨兵 v6672-endturn-*），
//     特殊能量的擋點是中央 isHandEnergyAttachLocked（ATTACH_ENERGY 與手牌拖曳提示共用）。
regPre('超級阿勃梭魯Zex|血紅恐懼', (s) => ({ state: s, damage: 160 }));
regPost('超級阿勃梭魯Zex|血紅恐懼', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const s = updatePlayer(state, dIdx, p => ({ ...p, cantAttachSpecialEnergyFromHandNextTurn: true, cantPlayStadiumNextTurn: true }));
  return addLog(s, '血紅恐懼：在下個對手的回合，對手無法從手牌附上特殊能量卡，也無法使出競技場卡', aIdx);
});

// ── 大食花｜酸液陷阱 ─────────────────────────────────────────────────────
// 卡面：「若場上有自己的競技場卡，則在自己的回合時可使用1次。將對手的戰鬥寶可夢【中毒】與【灼傷】。」
//   ⚠ 特性效果 ⇒ kind 'ability-effect'（化隱／光之翼等擋；憨憨臉等來源無關的免疫照常）。
regAByName('大食花', '酸液陷阱', (st, idx, pool) => {
  if (!st.activeStadium || st.activeStadiumOwnerIdx !== idx) return rejectAbilityUse(st, '酸液陷阱：場上沒有自己的競技場卡', idx);
  if (!st.players[(1 - idx) as 0 | 1].active) return rejectAbilityUse(st, '酸液陷阱：對手沒有戰鬥寶可夢', idx);
  let s = addLog(st, '酸液陷阱：將對手的戰鬥寶可夢【中毒】與【灼傷】', idx);
  s = applyStatusToOppActive(s, idx, 'poisoned', pool, { kind: 'ability-effect', label: '酸液陷阱' });
  s = applyStatusToOppActive(s, idx, 'burned', pool, { kind: 'ability-effect', label: '酸液陷阱' });
  return s;
});

// ── 列陣兵｜團結之陣 ─────────────────────────────────────────────────────
// 卡面：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用1次。從牌庫附給自己的所有名稱中有「列陣兵」的
//        備戰寶可夢各1張「基本【鬥】能量」卡。並且重洗牌庫。」
//   ⚠ 帶條件的牌庫搜尋 ⇒ 可宣告找不到（選 0，官方 L832）。每隻目標最多 1 張。
//   ⚠ 找到的張數 = 目標數 ⇒ 每隻各 1 張（沒有選擇空間）；少於目標數 ⇒ 由玩家選要附給哪幾隻（不自動取前面）。
const PHALANX_NAME = '列陣兵';
function phalanxTargets(p: PlayerState, pool: Map<string, Card>): CardInstance[] {
  return p.bench.filter(b => (pool.get(b.cardId)?.name ?? '').includes(PHALANX_NAME));
}
regAByName('列陣兵', '團結之陣', (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  if (cardInst && p.active?.iid !== cardInst.iid) return rejectAbilityUse(st, '團結之陣：這隻寶可夢不在戰鬥場上', idx);
  const targets = phalanxTargets(p, pool);
  if (targets.length === 0) return rejectAbilityUse(st, '團結之陣：備戰區沒有名稱中有「列陣兵」的寶可夢', idx);
  if (p.deck.length === 0) return rejectAbilityUse(st, '團結之陣：牌庫沒有卡', idx);
  const s = addLog(st, `團結之陣：從牌庫選最多 ${targets.length} 張「基本【鬥】能量」，附給備戰的「列陣兵」各 1 張`, idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergyOf=Fighting',
    minCount: 0, maxCount: targets.length,
    effectKey: 'm7-phalanx-pick-energy',
    params: { targetIids: targets.map(t => t.iid), titleOverride: '團結之陣：從牌庫選擇「基本【鬥】能量」' },
  });
});
function phalanxAttach(st: GameState, idx: 0 | 1, pairs: Array<[string, string]>, pool: Map<string, Card>): GameState {
  // pairs：[能量 iid, 備戰 iid]；能量從牌庫移出、各附 1 張，最後重洗牌庫。
  const p = st.players[idx];
  const eMap = new Map(p.deck.map(c => [c.iid, c]));
  const byBench = new Map<string, CardInstance>();
  for (const [e, b] of pairs) { const inst = eMap.get(e); if (inst) byBench.set(b, inst); }
  const used = new Set([...byBench.values()].map(c => c.iid));
  let s = updatePlayer(st, idx, q => ({
    ...q,
    deck: shuffle(q.deck.filter(c => !used.has(c.iid))),
    bench: q.bench.map(b => byBench.has(b.iid) ? { ...b, energyAttached: [...b.energyAttached, byBench.get(b.iid)!] } : b),
  }));
  for (const b of p.bench) {
    const e = byBench.get(b.iid);
    if (e) s = addLog(s, `  → ${pool.get(e.cardId)?.name ?? '?'} → ${pool.get(b.cardId)?.name ?? '?'}`, idx);
  }
  return addLog(s, `團結之陣：附加 ${byBench.size} 張基本【鬥】能量；牌庫重洗`, idx);
}
regR('m7-phalanx-pick-energy', (st, idx, iids, params, pool) => {
  const p = st.players[idx];
  // 公平性自驗：只收牌庫裡真的是基本【鬥】能量、且不重複的卡；目標重算（不信任 client）。
  const targets = phalanxTargets(p, pool).filter(t => ((params?.targetIids as string[]) ?? []).includes(t.iid));
  const picked = [...new Set(iids)].filter(i => {
    const c = p.deck.find(d => d.iid === i);
    return !!c && isBasicEnergyOfType(pool.get(c.cardId), 'Fighting');
  }).slice(0, targets.length);
  if (picked.length === 0) {
    return addLog(updatePlayer(st, idx, q => ({ ...q, deck: shuffle(q.deck) })), '團結之陣：未選擇能量；牌庫重洗', idx);
  }
  if (picked.length === targets.length) {
    return phalanxAttach(st, idx, picked.map((e, i) => [e, targets[i].iid]), pool);
  }
  return withPending(addLog(st, `團結之陣：選擇要附加能量的 ${picked.length} 隻「列陣兵」`, idx), {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: picked.length, maxCount: picked.length,
    effectKey: 'm7-phalanx-pick-target',
    params: { energyIids: picked, validIids: targets.map(t => t.iid), titleOverride: `團結之陣：選擇 ${picked.length} 隻「列陣兵」（各附 1 張）` },
  });
});
regR('m7-phalanx-pick-target', (st, idx, iids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const valid = new Set(phalanxTargets(st.players[idx], pool).map(t => t.iid).filter(i => ((params?.validIids as string[]) ?? []).includes(i)));
  const chosen = [...new Set(iids)].filter(i => valid.has(i));
  // 送來的目標不足（不合法 payload）⇒ 由合法目標依序補足，能量不會憑空消失。
  for (const v of valid) { if (chosen.length >= energyIids.length) break; if (!chosen.includes(v)) chosen.push(v); }
  return phalanxAttach(st, idx, energyIids.slice(0, chosen.length).map((e, i) => [e, chosen[i]]), pool);
});

// ── 超級路卡利歐Zex｜波導探求者 ──────────────────────────────────────────
// 卡面：「若這隻寶可夢在戰鬥場上，則在自己的回合時可使用1次。從自己的牌庫選擇1張支援者卡，在給對手看過後加入手牌。並且重洗牌庫。」
//   ⚠ 帶條件 ⇒ 可選 0；「給對手看過」⇒ 公開卡名（search-to-hand-reshuffle 預設公開）。
regAByName('超級路卡利歐Zex', '波導探求者', (st, idx, _pool, cardInst) => {
  const p = st.players[idx];
  if (cardInst && p.active?.iid !== cardInst.iid) return rejectAbilityUse(st, '波導探求者：這隻寶可夢不在戰鬥場上', idx);
  if (p.deck.length === 0) return rejectAbilityUse(st, '波導探求者：牌庫沒有卡', idx);
  return withPending(addLog(st, '波導探求者：從牌庫選擇 1 張支援者卡（給對手看過後加入手牌）', idx), {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Supporter', minCount: 0, maxCount: 1,
    effectKey: 'search-to-hand-reshuffle',
  });
});

// ── 貓老大｜招財進寶 ─────────────────────────────────────────────────────
// 卡面：「若自己的場上有2隻以上持有招式『聚寶功』的寶可夢，則在自己的回合時可使用1次。從自己的牌庫抽出2張卡。」
regAByName('貓老大', '招財進寶', (st, idx) => {
  if (st.players[idx].deck.length === 0) return rejectAbilityUse(st, '招財進寶：牌庫沒有卡', idx);
  return drawCards(addLog(st, '招財進寶：從牌庫抽出 2 張卡', idx), idx, 2);
});

// ── 天然鳥｜能量躍遷 ─────────────────────────────────────────────────────
// 卡面：「在自己的回合，從手牌使出這張卡並完成進化時，可使用1次。查看對手的手牌，從其中選擇1張能量卡，附於對手的寶可夢身上。」
//   ⚠ 已知區（看過的對手手牌）沒有 fail-to-find（判準③）⇒ 有能量卡就必須選 1 張。
//   ⚠ 對手手牌沒有能量卡 ⇒ 仍查看手牌（多部效果，前段可執行）。
//   ⚠ 附能是「對手的特性效果」⇒ 化隱／光之翼等免疫的寶可夢不能當目標（中央 isImmuneToOppAbilityEffect）。
//   ⚠ 不是「從手牌附上能量」這個玩家動作（附的人不是持有者）⇒ 不觸發手牌附能的反應特性。
regAByName('天然鳥', '能量躍遷', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const hand = st.players[dIdx].hand;
  const energies = hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  if (energies.length === 0) {
    return openPeekOppHandView(addLog(st, '能量躍遷：對手手牌沒有能量卡', idx), idx, '能量躍遷');
  }
  return withPending(addLog(st, `能量躍遷：查看對手手牌（${hand.length} 張），選擇 1 張能量卡`, idx), {
    type: 'hand-choose', actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'm7-energy-leap-pick',
    params: { validIids: energies.map(c => c.iid), titleOverride: '能量躍遷：從對手手牌選擇 1 張能量卡' },
  });
});
function energyLeapTargets(st: GameState, idx: 0 | 1, pool: Map<string, Card>): CardInstance[] {
  const d = st.players[(1 - idx) as 0 | 1];
  return [...(d.active ? [d.active] : []), ...d.bench].filter(t => !isImmuneToOppAbilityEffect(st, idx, t, pool, false));
}
regR('m7-energy-leap-pick', (st, idx, iids, params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const valid = new Set(((params?.validIids as string[]) ?? []).filter(i => st.players[dIdx].hand.some(c => c.iid === i && pool.get(c.cardId)?.supertype === 'Energy')));
  const eIid = iids.find(i => valid.has(i)) ?? [...valid][0];
  if (!eIid) return st;
  const targets = energyLeapTargets(st, idx, pool);
  const eName = pool.get(st.players[dIdx].hand.find(c => c.iid === eIid)!.cardId)?.name ?? '?';
  if (targets.length === 0) return addLog(st, `能量躍遷：對手的寶可夢都不受這個特性的效果影響（${eName} 留在對手手牌）`, idx);
  return withPending(addLog(st, `能量躍遷：選擇的能量卡是 ${eName}，選擇要附給對手的哪隻寶可夢`, idx), {
    type: 'opp-poke-choose', actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'm7-energy-leap-attach',
    params: { energyIid: eIid, validIids: targets.map(t => t.iid), titleOverride: `能量躍遷：將 ${eName} 附於對手的寶可夢` },
  });
});
regR('m7-energy-leap-attach', (st, idx, iids, params, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const eIid = params?.energyIid as string;
  const e = st.players[dIdx].hand.find(c => c.iid === eIid);
  if (!e) return st;
  const valid = new Set(energyLeapTargets(st, idx, pool).map(t => t.iid).filter(i => ((params?.validIids as string[]) ?? []).includes(i)));
  const tIid = iids.find(i => valid.has(i)) ?? [...valid][0];
  if (!tIid) return st;
  // 寫回盤面前再問一次中央免疫判準（兩段式之間盤面可能變動；lint H 也以此為準）
  const _t = [st.players[dIdx].active, ...st.players[dIdx].bench].find(c => c?.iid === tIid);
  if (isImmuneToOppAbilityEffect(st, idx, _t, pool, false)) return addLog(st, '能量躍遷：目標不受這個特性的效果影響', idx);
  let tName = '?';
  const s = updatePlayer(st, dIdx, p => {
    const put = (c: CardInstance): CardInstance => { tName = pool.get(c.cardId)?.name ?? '?'; return { ...c, energyAttached: [...c.energyAttached, e] }; };
    return {
      ...p,
      hand: p.hand.filter(c => c.iid !== eIid),
      active: p.active?.iid === tIid ? put(p.active) : p.active,
      bench: p.bench.map(b => b.iid === tIid ? put(b) : b),
    };
  });
  return addLog(s, `能量躍遷：將對手手牌的 ${pool.get(e.cardId)?.name ?? '?'} 附於對手的 ${tName}`, idx);
});

// ── 可爾妮的全力（支援者）─────────────────────────────────────────────────
// 卡面：「在這個回合，自己的『超級進化寶可夢【ex】』使用的招式，對對手的戰鬥寶可夢造成的傷害，
//        依對手已經獲得的獎賞卡每1張『+20』點。」
//   ⚠ 加傷在中央 applyAttackerActiveDamageBonuses（effects.ts，isMegaExCard、只加在對手的戰鬥寶可夢）。
//   ⚠ 本回合效果型（同 力量蛋白飲）：打出當下場上沒有超級進化寶可夢ex 也可以使用（之後可以進化／換上場）。
regG('可爾妮的全力', () => true);
reg('可爾妮的全力', (st, idx) => {
  st = addLog(st, '可爾妮的全力：這個回合，自己的超級進化寶可夢ex 的招式，依對手已獲得的獎賞卡每 1 張 +20', idx);
  return updatePlayer(st, idx, p => ({ ...p, korrinaFullPowerThisTurn: true }));
});

// ── 吉憲的熱血（支援者）──────────────────────────────────────────────────
// 卡面：「選擇1隻自己的場上的【水】寶可夢，將那隻寶可夢與附加的卡全部放回牌庫並重洗。」
//   ⚠ 屬性走中央有效屬性述詞 hasEffectivePokemonType。
//   ⚠ 戰鬥寶可夢只有在備戰區有寶可夢時才列為候選（放回後必須能派出新的戰鬥寶可夢）；
//     放回後戰鬥場空著 ⇒ 引擎 v6515-promote-first 強制先補位。
function hotBloodCandidates(st: GameState, idx: 0 | 1, pool: Map<string, Card>): CardInstance[] {
  const p = st.players[idx];
  const isWater = (c: CardInstance) => hasEffectivePokemonType(st, idx, c, pool.get(c.cardId), pool, 'Water');
  return [...(p.active && p.bench.length > 0 && isWater(p.active) ? [p.active] : []), ...p.bench.filter(isWater)];
}
regG('吉憲的熱血', (st, idx, pool) => hotBloodCandidates(st, idx, pool).length > 0);
reg('吉憲的熱血', (st, idx, pool) => {
  const cand = hotBloodCandidates(st, idx, pool);
  if (cand.length === 0) return addLog(st, '吉憲的熱血：場上沒有可以選擇的【水】寶可夢', idx);
  return withPending(addLog(st, '吉憲的熱血：選擇 1 隻自己的【水】寶可夢放回牌庫', idx), {
    type: 'bench-choose', actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'm7-hot-blood-return',
    params: { includeActive: true, validIids: cand.map(c => c.iid), titleOverride: '吉憲的熱血：選擇 1 隻自己的【水】寶可夢（連同附加的卡放回牌庫）' },
  });
});
regR('m7-hot-blood-return', (st, idx, iids, _params, pool) => {
  const cand = hotBloodCandidates(st, idx, pool);
  const pick = cand.find(c => iids.includes(c.iid)) ?? cand[0];
  if (!pick) return st;
  const returning = bareCardsForReturn(pick);
  const name = pool.get(pick.cardId)?.name ?? '?';
  const s = updatePlayer(st, idx, p => ({
    ...p,
    active: p.active?.iid === pick.iid ? null : p.active,
    bench: p.bench.filter(b => b.iid !== pick.iid),
    deck: shuffle([...p.deck, ...returning]),
  }));
  return addLog(s, `吉憲的熱血：將 ${name} 與附加的卡（共 ${returning.length} 張）放回牌庫並重洗`, idx);
});

// ── 記者（支援者）───────────────────────────────────────────────────────
// 卡面：「從自己的牌庫抽出2張卡。查看對手的手牌。查看對手的牌庫上方1張卡，回復原樣。」
//   ⚠ 多部效果：任一部可執行就能使用（官方 L1401 奇樹同型）。
//   ⚠ 依卡面順序：先抽、再看對手手牌，關掉後再看對手牌庫上方 1 張（pendingChainQueue 排隊）。
function reporterTopView(st: GameState, idx: 0 | 1): PendingSelection | null {
  const dIdx = (1 - idx) as 0 | 1;
  const top = st.players[dIdx].deck[0];
  if (!top) return null;
  return {
    type: 'reorder-deck-top', actorIdx: idx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'reorder-deck-top-apply',
    params: { candidateIids: [top.iid], allowDiscard: false, targetIdx: dIdx, titleOverride: '記者：查看對手的牌庫上方 1 張卡（確認後放回原處）' },
  } as PendingSelection;
}
regG('記者', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  return st.players[idx].deck.length > 0 || st.players[dIdx].hand.length > 0 || st.players[dIdx].deck.length > 0;
});
reg('記者', (st, idx) => {
  const dIdx = (1 - idx) as 0 | 1;
  let s = st.players[idx].deck.length > 0 ? drawCards(addLog(st, '記者：從牌庫抽出 2 張卡', idx), idx, 2) : addLog(st, '記者：牌庫沒有卡可抽', idx);
  const top = reporterTopView(s, idx);
  if (s.players[dIdx].hand.length > 0) {
    s = openPeekOppHandView(s, idx, '記者');
    if (top) s = { ...s, pendingChainQueue: [...(s.pendingChainQueue ?? []), top] };
    return s;
  }
  s = addLog(s, '記者：對手手牌為空', idx);
  if (!top) return addLog(s, '記者：對手牌庫沒有卡', idx);
  return withPending(addLog(s, '記者：查看對手的牌庫上方 1 張卡', idx), top);
});
