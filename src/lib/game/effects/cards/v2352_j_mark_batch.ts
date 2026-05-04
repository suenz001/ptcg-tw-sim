import type { CardInstance, GameState, PlayerState } from '../../types';
import { addLog, regPost, regPre, regR, shuffle, updatePlayer, withPending } from '../_shared';

function cardName(pool: Map<string, any>, inst?: CardInstance | null): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '?') : '?';
}

function isBasicEnergyName(card: any, typeText: string): boolean {
  return card?.supertype === 'Energy' && card?.subtype === 'Basic' && card?.name?.includes(typeText);
}

function discardActiveEnergies(
  state: GameState,
  aIdx: 0 | 1,
  count: number,
  label: string,
  pool: Map<string, any>,
  predicate?: (e: CardInstance) => boolean,
): GameState {
  const p = state.players[aIdx];
  const active = p.active;
  if (!active || count <= 0) return state;
  const candidates = predicate ? active.energyAttached.filter(predicate) : active.energyAttached;
  const picked = candidates.slice(0, count);
  if (picked.length === 0) return addLog(state, `${label}：沒有可丟棄的能量`, aIdx);
  const pickedSet = new Set(picked.map(e => e.iid));
  const names = picked.map(e => pool.get(e.cardId)?.name ?? '能量').join('、');
  const s = updatePlayer(state, aIdx, pl => pl.active ? ({
    ...pl,
    active: { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => !pickedSet.has(e.iid)) },
    discard: [...pl.discard, ...picked],
  }) : pl);
  return addLog(s, `${label}：丟棄 ${picked.length} 個自身能量（${names}）`, aIdx);
}

function discardOpponentActiveEnergy(state: GameState, aIdx: 0 | 1, pool: Map<string, any>, label: string): GameState {
  const dIdx = (1 - aIdx) as 0 | 1;
  const d = state.players[dIdx];
  const active = d.active;
  if (!active || active.energyAttached.length === 0) return addLog(state, `${label}：對手戰鬥寶可夢沒有能量`, aIdx);
  const picked = active.energyAttached[0];
  const s = updatePlayer(state, dIdx, pl => pl.active ? ({
    ...pl,
    active: { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => e.iid !== picked.iid) },
    discard: [...pl.discard, picked],
  }) : pl);
  return addLog(s, `${label}：丟棄對手戰鬥寶可夢的 ${pool.get(picked.cardId)?.name ?? '能量'}`, aIdx);
}

function deckEnergyToActivePost(key: string, type: 'Grass' | 'Psychic', typeText: string, maxCount: number, label: string): void {
  regPost(key, (state, aIdx) => {
    const p = state.players[aIdx];
    const candidates = p.deck.filter(c => isBasicEnergyName((state as any).pool?.get?.(c.cardId), typeText));
    // 實際 UI/resolver 會用 pool 驗證；這裡只負責建立 pending。
    return withPending(addLog(state, `${label}：從牌庫選擇最多 ${maxCount} 張基本${typeText}能量附於自身`, aIdx), {
      type: 'deck-search', actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: `Energy:${type}`, minCount: 0, maxCount,
      effectKey: `j-2352-attach-${label}`,
    });
  });
  regR(`j-2352-attach-${label}`, (state, aIdx, iids, _params, pool) => {
    const p = state.players[aIdx];
    const picked = p.deck.filter(c => iids.includes(c.iid)).filter(c => isBasicEnergyName(pool.get(c.cardId), typeText)).slice(0, maxCount);
    const pickedSet = new Set(picked.map(c => c.iid));
    const s = updatePlayer(state, aIdx, pl => ({
      ...pl,
      deck: shuffle(pl.deck.filter(c => !pickedSet.has(c.iid))),
      active: pl.active ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...picked] } : pl.active,
    }));
    const target = cardName(pool, s.players[aIdx].active);
    return addLog(s, `${label}：將 ${picked.length} 張基本${typeText}能量附於 ${target}，並重洗牌庫`, aIdx);
  });
}

function drawUntilHandSize(state: GameState, aIdx: 0 | 1, size: number, label: string): GameState {
  const p = state.players[aIdx];
  const need = Math.max(0, size - p.hand.length);
  if (need <= 0) return addLog(state, `${label}：手牌已達 ${size} 張，不抽卡`, aIdx);
  const take = p.deck.slice(0, need);
  const s = updatePlayer(state, aIdx, pl => ({ ...pl, deck: pl.deck.slice(take.length), hand: [...pl.hand, ...take] }));
  return addLog(s, `${label}：抽 ${take.length} 張直到手牌最多 ${size} 張`, aIdx);
}

function selfBlockSameAttackNext(key: string, attackName: string, damage: number): void {
  regPre(key, (state) => ({ state, damage }));
  regPost(key, (state, aIdx) => updatePlayer(addLog(state, `${attackName}：下個自己的回合不能使用「${attackName}」`, aIdx), aIdx, p => p.active ? ({
    ...p,
    active: { ...p.active, blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), attackName] },
  }) : p));
}

function selfNextDamageReduce(key: string, label: string, damage: number, reduce: number): void {
  regPre(key, (state) => ({ state, damage }));
  regPost(key, (state, aIdx) => updatePlayer(addLog(state, `${label}：下個對手回合，這隻寶可夢受到招式傷害 -${reduce}`, aIdx), aIdx, p => p.active ? ({
    ...p,
    active: { ...p.active, damageReduceNextHit: reduce },
  }) : p));
}

// J v2.352：低風險 P2/P3 deck / energy / cooldown 批次。

// 胖胖哈力｜綠葉充能：20，牌庫最多 1 張基本【草】能量附於自身。
regPre('胖胖哈力|綠葉充能', (state) => ({ state, damage: 20 }));
deckEnergyToActivePost('胖胖哈力|綠葉充能', 'Grass', '【草】', 1, '綠葉充能');

// 代歐奇希斯｜基因充能：牌庫最多 2 張基本【超】能量附於自身。
regPre('代歐奇希斯|基因充能', (state) => ({ state, damage: 0 }));
deckEnergyToActivePost('代歐奇希斯|基因充能', 'Psychic', '【超】', 2, '基因充能');

// 代歐奇希斯｜精神高速：30，若希望抽到手牌滿 5（自動執行可選抽牌）。
regPre('代歐奇希斯|精神高速', (state) => ({ state, damage: 30 }));
regPost('代歐奇希斯|精神高速', (state, aIdx) => drawUntilHandSize(state, aIdx, 5, '精神高速'));

// 冰岩怪｜冰山崩裂：丟牌庫上方 6 張，基本【水】能量張數 ×60。
regPre('冰岩怪|冰山崩裂', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const top = p.deck.slice(0, 6);
  const waterCount = top.filter(c => isBasicEnergyName(pool.get(c.cardId), '【水】')).length;
  const s = updatePlayer(state, aIdx, pl => ({ ...pl, deck: pl.deck.slice(top.length), discard: [...pl.discard, ...top] }));
  return { state: addLog(s, `冰山崩裂：丟棄牌庫上方 ${top.length} 張，其中基本【水】能量 ${waterCount} 張 → ${waterCount * 60}`, aIdx), damage: waterCount * 60 };
});

// 君主蛇｜日光旋繞：棄牌區有「鳴依的勉勵」則 100+150。
regPre('君主蛇|日光旋繞', (state, aIdx, pool) => {
  const hasMei = state.players[aIdx].discard.some(c => pool.get(c.cardId)?.name === '鳴依的勉勵');
  return { state: hasMei ? addLog(state, '日光旋繞：棄牌區有「鳴依的勉勵」→ +150', aIdx) : state, damage: hasMei ? 250 : 100 };
});

// 鳳王｜紅蓮之翼：130，丟自身 1 個【火】能量（自動取第一張提供火的能量）。
regPre('鳳王|紅蓮之翼', (state) => ({ state, damage: 130 }));
regPost('鳳王|紅蓮之翼', (state, aIdx, pool) => discardActiveEnergies(state, aIdx, 1, '紅蓮之翼', pool, e => {
  const c = pool.get(e.cardId);
  return c?.name?.includes('【火】') || c?.pokemonType === 'Fire';
}));

// 大朝北鼻｜鼻衝撞：260，丟自身 3 個能量。
regPre('大朝北鼻|鼻衝撞', (state) => ({ state, damage: 260 }));
regPost('大朝北鼻|鼻衝撞', (state, aIdx, pool) => discardActiveEnergies(state, aIdx, 3, '鼻衝撞', pool));

// 狙射樹梟ex｜粉碎箭：240，丟對手戰鬥寶可夢 1 個能量。
regPre('狙射樹梟ex|粉碎箭', (state) => ({ state, damage: 240 }));
regPost('狙射樹梟ex|粉碎箭', (state, aIdx, pool) => discardOpponentActiveEnergy(state, aIdx, pool, '粉碎箭'));

// 凱路迪歐｜能量反射：70，選自身 1 個能量改附於備戰寶可夢。
regPre('凱路迪歐|能量反射', (state) => ({ state, damage: 70 }));
regPost('凱路迪歐|能量反射', (state, aIdx) => {
  const p = state.players[aIdx];
  if (!p.active || p.active.energyAttached.length === 0) return addLog(state, '能量反射：自身沒有能量可移動', aIdx);
  if (p.bench.length === 0) return addLog(state, '能量反射：沒有備戰寶可夢可移動能量', aIdx);
  return withPending(addLog(state, '能量反射：選擇 1 個自身能量', aIdx), {
    type: 'active-energy-discard', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1, effectKey: 'j-2352-keldeo-energy-reflect-pick',
    params: { titleOverride: '選擇要改附的自身能量' },
  });
});
regR('j-2352-keldeo-energy-reflect-pick', (state, aIdx, iids) => {
  if (iids.length === 0) return state;
  return withPending(addLog(state, '能量反射：選擇要附上的備戰寶可夢', aIdx), {
    type: 'bench-choose', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1, effectKey: 'j-2352-keldeo-energy-reflect-commit',
    params: { energyIid: iids[0], titleOverride: '選擇要改附能量的備戰寶可夢' },
  });
});
regR('j-2352-keldeo-energy-reflect-commit', (state, aIdx, iids, params, pool) => {
  const energyIid = params?.energyIid as string | undefined;
  const targetIid = iids[0];
  if (!energyIid || !targetIid) return state;
  let moved: CardInstance | undefined;
  const s = updatePlayer(state, aIdx, pl => {
    if (!pl.active) return pl;
    moved = pl.active.energyAttached.find(e => e.iid === energyIid);
    if (!moved) return pl;
    return {
      ...pl,
      active: { ...pl.active, energyAttached: pl.active.energyAttached.filter(e => e.iid !== energyIid) },
      bench: pl.bench.map(b => b.iid === targetIid ? { ...b, energyAttached: [...b.energyAttached, moved!] } : b),
    };
  });
  const target = s.players[aIdx].bench.find(b => b.iid === targetIid);
  return addLog(s, `能量反射：將 ${moved ? (pool.get(moved.cardId)?.name ?? '能量') : '能量'} 改附於 ${cardName(pool, target)}`, aIdx);
});

// 下個自己回合不能使用同名招式。
selfBlockSameAttackNext('電龍|閃光伏特', '閃光伏特', 140);
selfBlockSameAttackNext('伊裴爾塔爾ex|黑暗打擊', '黑暗打擊', 210);
selfBlockSameAttackNext('故勒頓ex|衝擊打擊', '衝擊打擊', 200);

// 超級基格爾德ex｜蓋亞波：下個對手回合自身受到招式傷害 -30。
selfNextDamageReduce('超級基格爾德ex|蓋亞波', '蓋亞波', 200, 30);
