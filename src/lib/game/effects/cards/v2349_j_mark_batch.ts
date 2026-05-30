import type { CardInstance, GameState, PlayerState } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import { addLog, regPost, regPre, regR, shuffle, updatePlayer, withPending } from '../_shared';
import { canApplyAttackEffectToTarget } from '../../effects';

function flipFixed(state: GameState, aIdx: 0 | 1, label: string, count: number): { state: GameState; heads: number } {
  let s = state;
  if (count > 0) s = { ...s, coinFlippedThisAttack: true };
  let heads = 0;
  const recordedFlips: string[] = [];  // v5.309
  for (let i = 1; i <= count; i++) {
    const isHeads = Math.random() < 0.5;
    if (isHeads) heads++;
    s = addLog(s, `${label}：第 ${i}/${count} 次擲硬幣 — ${isHeads ? '正面' : '反面'}`, aIdx);
    recordedFlips.push(isHeads ? '正面' : '反面');
  }
  // v5.309: append _machineGunLastFlips → retry modal 顯示「本次擲幣結果」
  if (recordedFlips.length > 0) {
    const existing = s._machineGunLastFlips ?? [];
    s = { ...s, _machineGunLastFlips: [...existing, ...recordedFlips] };
  }
  return { state: s, heads };
}

function flipUntilTails(state: GameState, aIdx: 0 | 1, label: string): { state: GameState; heads: number } {
  let s: GameState = { ...state, coinFlippedThisAttack: true };
  let heads = 0;
  const recordedFlips: string[] = [];  // v5.309
  for (let i = 1; i <= 20; i++) {
    const isHeads = Math.random() < 0.5;
    s = addLog(s, `${label}：第 ${i} 次擲硬幣 — ${isHeads ? '正面' : '反面（停止）'}`, aIdx);
    recordedFlips.push(isHeads ? '正面' : '反面');
    if (isHeads) heads++;
    else break;
  }
  if (recordedFlips.length > 0) {
    const existing = s._machineGunLastFlips ?? [];
    s = { ...s, _machineGunLastFlips: [...existing, ...recordedFlips] };
  }
  return { state: s, heads };
}

function setDefenderAttackFailure(
  state: GameState, aIdx: 0 | 1, flips: number, label: string,
  pool?: Map<string, import('../../types').Card>,
): GameState {
  const dIdx = 1 - aIdx as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const d = { ...players[dIdx] };
  if (!d.active) return state;
  // v5.239：加 attack-effect immunity gate — 涵蓋薄霧能量 / 抵抗之幕 / 球形盾牌 /
  //   化隱 / 太晶 / 全能硬殼 等。若 defender active 免疫招式效果，flag 不該被 set。
  //   玩家回報：章魚桶墨汁噴射打附有薄霧能量的寶可夢，下回合仍被要求擲 2 次硬幣 — 違反卡面。
  if (pool) {
    const tCard = pool.get(d.active.cardId);
    const guard = canApplyEffectToTarget(state, aIdx, d.active, tCard, 'attack-effect', pool, { isBench: false });
    if (guard.blocked) {
      return addLog(state, `${label}：${tCard?.name ?? '?'}｜${guard.reason}（不受招式效果，跳過擲幣干擾）`, aIdx);
    }
  }
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
    // v4.57 A1 修：caller 虛無歸零卡面是「150 點傷害」(attack-damage)，非 attack-effect。
    //   原 v4.53 用 attack-effect 會誤套薄霧/抵抗之幕/皇帝之勢/全能硬殼/硬岩 (這些只擋 effect)。
    //   改 'attack-damage' → active 不擋（直接受擊），bench 走球形盾牌/藏隱/深度下潛/羽毛化石/花之帷幔/太晶/中立中心
    if (pool) {
      const tCard = pool.get(t.cardId);
      const _coinIsBench = t.iid !== s.players[dIdx].active?.iid;
      const guard = canApplyEffectToTarget(s, aIdx, t, tCard, 'attack-damage', pool, { isBench: _coinIsBench });
      if (guard.blocked) {
        s = addLog(s, `${label}：${tCard?.name ?? '?'}｜${guard.reason}（不受傷害）`, aIdx);
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
regPost('沙河馬|潑沙', (state, aIdx, pool) => setDefenderAttackFailure(state, aIdx, 1, '潑沙', pool));
regPre('章魚桶|墨汁噴射', (state) => ({ state, damage: 30 }));
regPost('章魚桶|墨汁噴射', (state, aIdx, pool) => setDefenderAttackFailure(state, aIdx, 2, '墨汁噴射', pool));

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
  // v4.54：卡面是「N×50 點傷害」(attack-damage)，不是「招式效果」。
  //   原 v2.92 誤套 canApplyAttackEffectToTarget 連薄霧/抵抗之幕等 effect immunity 都擋 → 違反卡面。
  //   改用 unified('attack-damage', isBench:?) → bench 才走 resolveBenchGuard 擋球形盾牌等，active 不擋。
  const _groupIsActive = state.players[dIdx].active?.iid === target;
  const tInst = _groupIsActive
    ? state.players[dIdx].active!
    : state.players[dIdx].bench.find(b => b.iid === target);
  if (tInst) {
    const tCard = pool.get(tInst.cardId);
    const guard = canApplyEffectToTarget(r.state, aIdx, tInst, tCard, 'attack-damage', pool, { isBench: !_groupIsActive });
    if (guard.blocked) {
      return addLog(r.state, `群起瞄準：${tCard?.name ?? '?'}｜${guard.reason}（不受傷害）`, aIdx);
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

// 超級差不多娃娃ex｜萬花筒華爾滋：擲 3 次，正面×2 張基本能量
//   v5.253：完整實裝 (玩家選類型 + 任意分配自己場上寶可夢)
//   流程: flipFixed(3) → deck-search picker (filter='BasicEnergy') → energy-distribute picker → commit
regPre('超級差不多娃娃ex|萬花筒華爾滋', (state) => ({ state, damage: 0 }));
regPost('超級差不多娃娃ex|萬花筒華爾滋', (state, aIdx, pool) => {
  const r = flipFixed(state, aIdx, '萬花筒華爾滋', 3);
  const maxN = r.heads * 2;
  if (maxN <= 0) {
    return addLog(r.state, '萬花筒華爾滋：0 次正面，未附加能量', aIdx);
  }
  // v5.253 stage 1: 開 deck-search picker — 玩家從牌庫選最多 maxN 張基本能量 (任何屬性)
  const p = r.state.players[aIdx];
  const cand = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return !!card && card.supertype === 'Energy' && card.subtype === 'Basic';
  });
  const realMax = Math.min(maxN, cand.length);
  const s = addLog(
    r.state,
    `萬花筒華爾滋：${r.heads} 正面 → 從牌庫選最多 ${realMax} 張基本能量 (任何屬性), 任意分配自己場上寶可夢`,
    aIdx,
  );
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy',
    minCount: 0,
    maxCount: realMax,
    effectKey: 'kaleido-waltz-distribute-stage1',
    params: { label: '萬花筒華爾滋' },
  });
});

/**
 * v5.253 stage 2 resolver: 收到玩家從 deck 選的能量 iids → 開 energy-distribute picker.
 *   分配範圍: 自己所有寶可夢 (active + bench) — 卡面「附於自己的寶可夢身上」(無備戰限制).
 */
regR('kaleido-waltz-distribute-stage1', (state, aIdx, iids, params, _pool) => {
  const label = (params?.label as string) ?? '萬花筒華爾滋';
  const p = state.players[aIdx];

  if (iids.length === 0) {
    return updatePlayer(
      addLog(state, `${label}：未選擇任何能量，重洗牌庫`, aIdx),
      aIdx,
      pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }

  // 卡面: 「自己的寶可夢」— active + bench 皆可
  const validIids: string[] = [];
  if (p.active) validIids.push(p.active.iid);
  for (const b of p.bench) validIids.push(b.iid);

  if (validIids.length === 0) {
    // 無寶可夢可附 (理論上不可能, 至少 active 存在才能用招式)
    return updatePlayer(
      addLog(state, `${label}：場上無寶可夢可附能量，重洗牌庫`, aIdx),
      aIdx,
      pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }

  // 開 energy-distribute picker — 玩家用 +/- 分配
  return withPending(
    addLog(state, `${label}：選擇將 ${iids.length} 張基本能量以任意方式分配到自己場上寶可夢`, aIdx),
    {
      type: 'energy-distribute',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: iids.length, maxCount: iids.length,
      effectKey: 'kaleido-waltz-commit',
      params: {
        label,
        energyIids: iids,            // 能量 iid (仍在 deck, commit 時搬走)
        validIids,                   // 候選 iid (active + bench)
        totalCount: iids.length,
        placedCount: 0,
        energyTypeName: '基本',      // 通用標籤 (混合屬性)
      },
    },
  );
});

/**
 * v5.253 commit resolver: 依玩家分配把能量從 deck 搬到各寶可夢身上 (含戰鬥場).
 *   selectedIids: 長度 = totalCount, 每個元素 = 該張能量的目標寶可夢 iid.
 *   仿永生綻放 j-2353-florges-distribute pattern, 但加 active 分支.
 */
regR('kaleido-waltz-commit', (state, aIdx, selectedIids, params, pool) => {
  const label = (params?.label as string) ?? '萬花筒華爾滋';
  const energyIids = ((params?.energyIids as string[] | undefined) ?? []).slice();

  if (selectedIids.length === 0 || energyIids.length === 0) {
    return updatePlayer(
      addLog(state, `${label}：未分配，重洗牌庫`, aIdx),
      aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }),
    );
  }

  const useCount = Math.min(selectedIids.length, energyIids.length);
  const tally = new Map<string, number>();
  let s: GameState = state;

  for (let i = 0; i < useCount; i++) {
    const targetIid = selectedIids[i];
    const energyIid = energyIids[i];
    const pCur = s.players[aIdx];
    const energyInst = pCur.deck.find(c => c.iid === energyIid);
    if (!energyInst) continue;
    s = updatePlayer(s, aIdx, pl => {
      const restDeck = pl.deck.filter(c => c.iid !== energyIid);
      // v5.253 差別於永生綻放: 同時支援附到 active 或 bench
      let newActive = pl.active;
      if (pl.active && pl.active.iid === targetIid) {
        newActive = { ...pl.active, energyAttached: [...pl.active.energyAttached, energyInst] };
      }
      const newBench = pl.bench.map(b => b.iid === targetIid
        ? { ...b, energyAttached: [...b.energyAttached, energyInst] }
        : b);
      return { ...pl, deck: restDeck, active: newActive, bench: newBench };
    });
    tally.set(targetIid, (tally.get(targetIid) ?? 0) + 1);
  }

  // 全部分配完成 → 重洗牌庫 (卡面明文)
  s = updatePlayer(s, aIdx, pl => ({ ...pl, deck: shuffle(pl.deck) }));

  const parts: string[] = [];
  for (const [iid, n] of tally) {
    const player = s.players[aIdx];
    const inst = player.active?.iid === iid ? player.active : player.bench.find(b => b.iid === iid);
    const name = inst ? (pool.get(inst.cardId)?.name ?? '?') : '?';
    parts.push(`${name}×${n}`);
  }
  return addLog(
    s,
    `${label}：${parts.join('、')} 共 ${useCount} 張基本能量 (重洗牌庫)`,
    aIdx,
  );
});
