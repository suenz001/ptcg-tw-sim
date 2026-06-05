import type { GameState, PlayerState, CardInstance, SpecialCondition } from '../../types';
import type { Card } from '$lib/cards/types';
import { addLog, clearActiveEffects, regPost, regPre, updatePlayer, withPending } from '../_shared';
import { flipCoinsWithLog, dealSelfDamage, applyStatusToOppActive } from '../../effects';

const statusLabel: Record<SpecialCondition, string> = {
  poisoned: '中毒', burned: '灼傷', asleep: '睡眠', confused: '混亂', paralyzed: '麻痺',
};

// v5.444：改走中央 applyStatusToOppActive（一勞永逸補化隱 / 純樸 / 泡沫能量 / 祭典會場
//   / 憨憨臉 / 不眠 全部免疫；原本完全無 guard，化隱被中毒+灼傷類招式無視）。
//   多狀態逐一施加，dual-status 雙格共存由 applyStatusToActive 處理。
function applyDefStatuses(state: GameState, aIdx: 0 | 1, statuses: SpecialCondition[], label: string, pool: Map<string, Card>, poisonDamagePerCheckup?: number): GameState {
  let s = state;
  for (const st of statuses) {
    s = applyStatusToOppActive(s, aIdx, st, pool, {
      kind: 'attack-effect',
      label,
      poisonDamagePerCheckup: st === 'poisoned' ? poisonDamagePerCheckup : undefined,
    });
  }
  return s;
}

function flipOne(state: GameState, aIdx: 0 | 1, label: string): { state: GameState; heads: boolean } {
  const r = flipCoinsWithLog(state, 1, label, aIdx);
  return { state: r.state, heads: r.heads === 1 };
}

function selfImmuneOnHeads(label: string) {
  return (state: GameState, aIdx: 0 | 1) => {
    const r = flipOne(state, aIdx, label);
    if (!r.heads) return addLog(r.state, `${label}：反面 → 無追加效果`, aIdx);
    const s = updatePlayer(r.state, aIdx, (p) => p.active ? {
      ...p,
      active: { ...p.active, immuneToAllAttackNextTurn: true },
    } : p);
    return addLog(s, `${label}：正面 → 下個對手回合免疫招式傷害`, aIdx);
  };
}

function selfSwitchToFirstBench(state: GameState, aIdx: 0 | 1, label: string): GameState {
  const p = state.players[aIdx];
  if (!p.active || p.bench.length === 0) return addLog(state, `${label}：沒有備戰寶可夢可互換`, aIdx);
  const oldActive = clearActiveEffects(p.active);
  const newActive = clearActiveEffects(p.bench[0]);
  const newBench = [oldActive, ...p.bench.slice(1)];
  return updatePlayer(addLog(state, `${label}：與備戰寶可夢互換`, aIdx), aIdx, (pl) => ({ ...pl, active: newActive, bench: newBench }));
}

// v5.438：委派中央 dealSelfDamage（自傷收斂）。
function addSelfDamage(state: GameState, aIdx: 0 | 1, amount: number, label: string): GameState {
  return dealSelfDamage(state, aIdx, amount, undefined, label);
}

// J-mark batch v2.348：remaining P1 simple statuses / revenge / coin status.

// 躲藏：擲 1 次硬幣，正面則下個對手回合免疫招式傷害（現有引擎以 damageReduceNextHit 表示）。
regPre('粉蝶蛹|躲藏', (state) => ({ state, damage: 0 }));
regPost('粉蝶蛹|躲藏', selfImmuneOnHeads('躲藏'));
regPre('瑪力露|躲藏', (state) => ({ state, damage: 0 }));
regPost('瑪力露|躲藏', selfImmuneOnHeads('躲藏'));

// 焰后蜥ex｜剋命銳爪：100，對手中毒+灼傷，自己與備戰互換。
// v5.067：原 selfSwitchToFirstBench 自動換 bench[0] 改為 bench-choose picker
//   讓玩家自選備戰寶可夢（玩家回報）。同 selfSwapPost 範本 — 中毒+灼傷先執行，
//   然後開 bench-choose pending 讓玩家選；玩家選完後 do-switch resolver 完成互換。
regPre('焰后蜥ex|剋命銳爪', (state) => ({ state, damage: 100 }));
regPost('焰后蜥ex|剋命銳爪', (state, aIdx, pool) => {
  let s = applyDefStatuses(state, aIdx, ['poisoned', 'burned'], '剋命銳爪', pool);
  const player = s.players[aIdx];
  if (!player.active || player.bench.length === 0) {
    return addLog(s, '剋命銳爪：備戰區沒有寶可夢，無法切換', aIdx);
  }
  s = addLog(s, '剋命銳爪：選擇換入的備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'do-switch',
  });
});

// 龍王蠍｜危害之尾：100，自身 70，對手中毒+麻痺。
regPre('龍王蠍|危害之尾', (state) => ({ state, damage: 100 }));
regPost('龍王蠍|危害之尾', (state, aIdx, pool) => {
  let s = addSelfDamage(state, aIdx, 70, '危害之尾');
  s = applyDefStatuses(s, aIdx, ['poisoned', 'paralyzed'], '危害之尾', pool);
  return s;
});

// 超級毒藻龍ex｜致死猛毒：對手中毒，該中毒每次寶可夢檢查放置 16 個傷害指示物（160）。
regPre('超級毒藻龍ex|致死猛毒', (state) => ({ state, damage: 0 }));
regPost('超級毒藻龍ex|致死猛毒', (state, aIdx, pool) => applyDefStatuses(state, aIdx, ['poisoned'], '致死猛毒', pool, 160));

// 莉佳的霸王花ex｜粉綻放：160，對手中毒+睡眠。
regPre('莉佳的霸王花ex|粉綻放', (state) => ({ state, damage: 160 }));
regPost('莉佳的霸王花ex|粉綻放', (state, aIdx, pool) => applyDefStatuses(state, aIdx, ['poisoned', 'asleep'], '粉綻放', pool));

// 托戈德瑪爾ex｜麻痺針：20，擲硬幣正面麻痺。
regPre('托戈德瑪爾ex|麻痺針', (state) => ({ state, damage: 20 }));
regPost('托戈德瑪爾ex|麻痺針', (state, aIdx, pool) => {
  const r = flipOne(state, aIdx, '麻痺針');
  if (!r.heads) return addLog(r.state, '麻痺針：反面 → 無追加效果', aIdx);
  return applyDefStatuses(r.state, aIdx, ['paralyzed'], '麻痺針', pool);
});

// 故勒頓ex｜緋紅之牙：上個對手回合若自己的寶可夢因招式傷害昏厥，50+120。
regPre('故勒頓ex|緋紅之牙', (state, aIdx) => {
  const revenge = (state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0) > 0;
  const dmg = revenge ? 170 : 50;
  return { state: addLog(state, `緋紅之牙：${revenge ? '上個對手回合有我方寶可夢因招式昏厥 → 170' : '條件未滿足 → 50'}`, aIdx), damage: dmg };
});
