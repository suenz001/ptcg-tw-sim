import type { CardInstance, GameState, PlayerState } from '../../types';
import type { Card } from '$lib/cards/types';
import { addLog, regPost, regPre, updatePlayer, withPending } from '../_shared';

function discardActiveEnergy(state: GameState, aIdx: 0 | 1, count: number | 'all', label: string): GameState {
  const p = state.players[aIdx];
  const active = p.active;
  if (!active) return state;
  const n = count === 'all' ? active.energyAttached.length : Math.min(count, active.energyAttached.length);
  const toDiscard = active.energyAttached.slice(0, n);
  const remaining = active.energyAttached.slice(n);
  let s = updatePlayer(state, aIdx, (pl) => ({
    ...pl,
    discard: [...pl.discard, ...toDiscard],
    active: pl.active ? { ...pl.active, energyAttached: remaining } : pl.active,
  }));
  return addLog(s, `${label}：丟棄 ${toDiscard.length} 個自身附加能量`, aIdx);
}

function chooseOppPokemonDamage(state: GameState, aIdx: 0 | 1, damage: number, label: string) {
  const dIdx = 1 - aIdx as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active && d.bench.length === 0) return addLog(state, `${label}：對手場上無寶可夢`, aIdx);
  return withPending(addLog(state, `${label}：選擇對手 1 隻寶可夢造成 ${damage} 傷害`, aIdx), {
    type: 'opp-poke-choose', actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-variable',
    params: { damage, label, kind: 'attack-damage' },
  });
}

function chooseOppBenchDamage(state: GameState, aIdx: 0 | 1, damage: number, label: string) {
  const dIdx = 1 - aIdx as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return addLog(state, `${label}：對手無備戰寶可夢`, aIdx);
  return withPending(addLog(state, `${label}：選擇對手 1 隻備戰寶可夢造成 ${damage} 傷害`, aIdx), {
    type: 'opp-bench-choose', actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'snipe-variable',
    params: { damage, label, kind: 'attack-damage' },
  });
}

function healAllPlayers(state: GameState, amount: number): GameState {
  const players = state.players.map((p) => ({
    ...p,
    active: p.active ? { ...p.active, damage: Math.max(0, p.active.damage - amount) } : p.active,
    bench: p.bench.map((b) => ({ ...b, damage: Math.max(0, b.damage - amount) })),
  })) as [PlayerState, PlayerState];
  return { ...state, players };
}

function nameOf(pool: Map<string, Card>, inst: CardInstance | null | undefined): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '') : '';
}

// J-mark batch v2.347：P1 bench damage / heal / low-risk variable damage.

// 投羽梟｜羽毛射擊：丟棄自身全部能量，對手 1 隻寶可夢 90 傷害。
regPre('投羽梟|羽毛射擊', (state) => ({ state, damage: 0 }));
regPost('投羽梟|羽毛射擊', (state, aIdx) => {
  const s = discardActiveEnergy(state, aIdx, 'all', '羽毛射擊');
  return chooseOppPokemonDamage(s, aIdx, 90, '羽毛射擊');
});

// 超級噴火龍Yex｜炎獄狂爆Y：丟棄自身 3 個能量，對手 1 隻寶可夢 280 傷害。
// v5.844：丟 3 能量改 SELF_DISCARD_UNITS_BATCH picker(玩家選,原 discardActiveEnergy 自動取末端)；此處只留狙擊 280
regPost('超級噴火龍Yex|炎獄狂爆Y', (state, aIdx) => chooseOppPokemonDamage(state, aIdx, 280, '炎獄狂爆Y'));

// 凱路迪歐｜穿通：20，對手 1 隻備戰也 20。
regPost('凱路迪歐|穿通', (state, aIdx) => chooseOppBenchDamage(state, aIdx, 20, '穿通'));

// 禿鷹娜ex｜骨之射擊：對手 1 隻寶可夢 50 傷害。
regPre('禿鷹娜ex|骨之射擊', (state) => ({ state, damage: 0 }));
regPost('禿鷹娜ex|骨之射擊', (state, aIdx) => chooseOppPokemonDamage(state, aIdx, 50, '骨之射擊'));

// 青木的姆克鷹｜羽毛強襲：150，丟棄自身 2 個能量，對手 1 隻備戰也 50。
// v5.844：羽毛強襲主傷害 150 改由 SELF_DISCARD_UNITS_BATCH regPre 設(含 picker)
// v5.844：丟 2 能量改 batch picker(玩家選,原自動)；主傷害 150 由 batch regPre 設；此處只留狙擊 50
regPost('青木的姆克鷹|羽毛強襲', (state, aIdx) => chooseOppBenchDamage(state, aIdx, 50, '羽毛強襲'));

// 超級花葉蒂ex｜溫柔之光：雙方所有寶可夢各恢復 30 HP。
regPre('超級花葉蒂ex|溫柔之光', (state) => ({ state, damage: 0 }));
regPost('超級花葉蒂ex|溫柔之光', (state, aIdx) => {
  const s = healAllPlayers(state, 30);
  return addLog(s, '溫柔之光：雙方所有寶可夢各恢復 30 HP', aIdx);
});

// 莉佳的大食花｜花園輪舞：自己場上「莉佳的寶可夢」數 ×40。
regPre('莉佳的大食花|花園輪舞', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const all = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  const count = all.filter((c) => nameOf(pool, c).startsWith('莉佳的')).length;
  return { state: addLog(state, `花園輪舞：自己場上「莉佳的寶可夢」${count} 隻 → ${count * 40} 傷害`, aIdx), damage: count * 40 };
});
