import type { CardInstance, GameState, PlayerState } from '../../types';
import { addLog, regPost, regPre, regR, shuffle, updatePlayer, withPending } from '../_shared';
import { canApplyAttackEffectToTarget } from '../../effects';

function flipFixed(state: GameState, aIdx: 0 | 1, label: string, count: number): { state: GameState; heads: number } {
  let s = state;
  let heads = 0;
  for (let i = 1; i <= count; i++) {
    const isHeads = Math.random() < 0.5;
    if (isHeads) heads++;
    s = addLog(s, `${label}：第 ${i}/${count} 次擲硬幣 — ${isHeads ? '正面' : '反面'}`, aIdx);
  }
  return { state: s, heads };
}

function flipUntilTails(state: GameState, aIdx: 0 | 1, label: string): { state: GameState; heads: number } {
  let s = state;
  let heads = 0;
  for (let i = 1; i <= 20; i++) {
    const isHeads = Math.random() < 0.5;
    s = addLog(s, `${label}：第 ${i} 次擲硬幣 — ${isHeads ? '正面' : '反面（停止）'}`, aIdx);
    if (isHeads) heads++;
    else break;
  }
  return { state: s, heads };
}

function setDefenderAttackFailure(state: GameState, aIdx: 0 | 1, flips: number, label: string): GameState {
  const dIdx = 1 - aIdx as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const d = { ...players[dIdx] };
  if (!d.active) return state;
  d.active = { ...d.active, attackFailureFlipCountPending: flips };
  players[dIdx] = d;
  return addLog({ ...state, players }, `${label}：下個對手回合，受到此招式的寶可夢使用招式前需擲 ${flips} 次硬幣`, aIdx);
}

function damageOneNoKo(state: GameState, targetPlayerIdx: 0 | 1, targetIid: string, amount: number): GameState {
  return updatePlayer(state, targetPlayerIdx, (p) => {
    if (p.active?.iid === targetIid) return { ...p, active: { ...p.active, damage: p.active.damage + amount } };
    return { ...p, bench: p.bench.map((b) => b.iid === targetIid ? { ...b, damage: b.damage + amount } : b) };
  });
}

function damageAllOppByCoin(
  state: GameState,
  aIdx: 0 | 1,
  amount: number,
  label: string,
  pool?: Map<string, any>,
): GameState {
  const dIdx = 1 - aIdx as 0 | 1;
  let s = state;
  const targets = [s.players[dIdx].active, ...s.players[dIdx].bench].filter((c): c is CardInstance => !!c);
  for (const t of targets) {
    const isHeads = Math.random() < 0.5;
    s = addLog(s, `${label}：對 ${t.iid} 擲硬幣 — ${isHeads ? '正面' : '反面'}`, aIdx);
    if (!isHeads) continue;
    // v2.92 招式效果免疫檢查（per-target；無 pool 時跳過 — 向後相容）
    if (pool) {
      const tCard = pool.get(t.cardId);
      const guard = canApplyAttackEffectToTarget(s, aIdx, t, tCard, pool);
      if (guard.blocked) {
        s = addLog(s, `${label}：${tCard?.name ?? '?'}｜${guard.reason}（不放指示物）`, aIdx);
        continue;
      }
    }
    s = damageOneNoKo(s, dIdx, t.iid, amount);
  }
  return addLog(s, `${label}：正面且未被擋下的對手寶可夢各受到 ${amount} 傷害`, aIdx);
}

function attachBasicEnergyFromDeckToActive(state: GameState, aIdx: 0 | 1, pool: Map<string, any>, maxCount: number, label: string): GameState {
  if (maxCount <= 0) return addLog(state, `${label}：0 次正面，未附加能量`, aIdx);
  const p = state.players[aIdx];
  if (!p.active) return state;
  const picked: CardInstance[] = [];
  const rest: CardInstance[] = [];
  for (const c of p.deck) {
    const card = pool.get(c.cardId);
    if (picked.length < maxCount && card?.supertype === 'Energy' && card?.subtype === 'Basic') picked.push(c);
    else rest.push(c);
  }
  const shuffled = shuffle(rest);
  const s = updatePlayer(state, aIdx, (pl) => ({
    ...pl,
    deck: shuffled,
    active: pl.active ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...picked] } : pl.active,
  }));
  return addLog(s, `${label}：從牌庫附加 ${picked.length}/${maxCount} 張基本能量到自身，並重洗牌庫`, aIdx);
}

function countOwnNamed(state: GameState, aIdx: 0 | 1, pool: Map<string, any>, nameIncludes: string): number {
  const p = state.players[aIdx];
  const all = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  return all.filter((c) => pool.get(c.cardId)?.name?.includes(nameIncludes)).length;
}

// J-mark batch v2.349：remaining P1 coin/deck/hand effects.

// 沙河馬｜潑沙、章魚桶｜墨汁噴射：下回合目標使用招式前擲幣，反面則失敗。
regPre('沙河馬|潑沙', (state) => ({ state, damage: 10 }));
regPost('沙河馬|潑沙', (state, aIdx) => setDefenderAttackFailure(state, aIdx, 1, '潑沙'));
regPre('章魚桶|墨汁噴射', (state) => ({ state, damage: 30 }));
regPost('章魚桶|墨汁噴射', (state, aIdx) => setDefenderAttackFailure(state, aIdx, 2, '墨汁噴射'));

// 超級基格爾德ex｜虛無歸零：對手所有寶可夢各擲 1 次，正面各 150。
regPre('超級基格爾德ex|虛無歸零', (state) => ({ state, damage: 0 }));
regPost('超級基格爾德ex|虛無歸零', (state, aIdx, pool) => damageAllOppByCoin(state, aIdx, 150, '虛無歸零', pool));

// 卡比獸｜大胃王：擲到反面，依正面數從牌庫附基本能量到自身（自動選前 N 張）。
regPre('卡比獸|大胃王', (state) => ({ state, damage: 0 }));
regPost('卡比獸|大胃王', (state, aIdx, pool) => {
  const r = flipUntilTails(state, aIdx, '大胃王');
  return attachBasicEnergyFromDeckToActive(r.state, aIdx, pool, r.heads, '大胃王');
});

// 肯泰羅｜群起瞄準：選對手 1 隻，擲自己場上肯泰羅數量，正面×50 傷害。
regPre('肯泰羅|群起瞄準', (state) => ({ state, damage: 0 }));
regPost('肯泰羅|群起瞄準', (state, aIdx) => {
  const dIdx = 1 - aIdx as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active && d.bench.length === 0) return addLog(state, '群起瞄準：對手場上無寶可夢', aIdx);
  return withPending(addLog(state, '群起瞄準：選擇對手 1 隻寶可夢', aIdx), {
    type: 'opp-poke-choose', actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1, effectKey: 'j-taurus-group-aim',
  });
});
regR('j-taurus-group-aim', (state, aIdx, iids, _params, pool) => {
  const dIdx = 1 - aIdx as 0 | 1;
  const count = countOwnNamed(state, aIdx, pool, '肯泰羅');
  const r = flipFixed(state, aIdx, '群起瞄準', count);
  const dmg = r.heads * 50;
  const target = iids[0];
  if (!target || dmg <= 0) return addLog(r.state, `群起瞄準：${r.heads}/${count} 次正面，未造成傷害`, aIdx);
  // v2.92 招式效果免疫檢查（指示物放置屬招式效果）
  const tInst = state.players[dIdx].active?.iid === target
    ? state.players[dIdx].active!
    : state.players[dIdx].bench.find(b => b.iid === target);
  if (tInst) {
    const tCard = pool.get(tInst.cardId);
    const guard = canApplyAttackEffectToTarget(r.state, aIdx, tInst, tCard, pool);
    if (guard.blocked) {
      return addLog(r.state, `群起瞄準：${tCard?.name ?? '?'}｜${guard.reason}（不放指示物）`, aIdx);
    }
  }
  return addLog(damageOneNoKo(r.state, dIdx, target, dmg), `群起瞄準：${r.heads}/${count} 次正面 → ${dmg} 傷害`, aIdx);
});

// 步哨鼠｜臨檢：擲 3 次，依正面數將對手手牌前 N 張回牌庫並重洗（公開 log，不看內容）。
regPre('步哨鼠|臨檢', (state) => ({ state, damage: 0 }));
regPost('步哨鼠|臨檢', (state, aIdx) => {
  const dIdx = 1 - aIdx as 0 | 1;
  const r = flipFixed(state, aIdx, '臨檢', 3);
  const n = Math.min(r.heads, r.state.players[dIdx].hand.length);
  if (n <= 0) return addLog(r.state, '臨檢：沒有卡放回牌庫', aIdx);
  const s = updatePlayer(r.state, dIdx, (p) => {
    const moved = p.hand.slice(0, n);
    const hand = p.hand.slice(n);
    return { ...p, hand, deck: shuffle([...moved, ...p.deck]) };
  });
  return addLog(s, `臨檢：${r.heads}/3 次正面，將對手 ${n} 張手牌放回牌庫並重洗`, aIdx);
});

// 托戈德瑪爾ex｜尖尖回轉：若上個自己的回合使用過此招式，80+80；使用後記錄到下個自己的回合。
regPre('托戈德瑪爾ex|尖尖回轉', (state, aIdx) => {
  const active = state.players[aIdx].active;
  const bonus = active?.pointySpinThisTurn ? 80 : 0;
  return { state: addLog(state, `尖尖回轉：${bonus ? '上個自己的回合已使用 → 160' : '未連續使用 → 80'}`, aIdx), damage: 80 + bonus };
});
regPost('托戈德瑪爾ex|尖尖回轉', (state, aIdx) => updatePlayer(state, aIdx, (p) => p.active ? {
  ...p,
  active: { ...p.active, pointySpinNextTurn: true, pointySpinThisTurn: undefined },
} : p));

// 超級差不多娃娃ex｜萬花筒華爾滋：擲 3 次，正面×2 張基本能量自動附到自身。
regPre('超級差不多娃娃ex|萬花筒華爾滋', (state) => ({ state, damage: 0 }));
regPost('超級差不多娃娃ex|萬花筒華爾滋', (state, aIdx, pool) => {
  const r = flipFixed(state, aIdx, '萬花筒華爾滋', 3);
  return attachBasicEnergyFromDeckToActive(r.state, aIdx, pool, r.heads * 2, '萬花筒華爾滋');
});
