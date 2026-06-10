import type { Card } from '$lib/cards/types';
import type { CardInstance, GameState } from '../../types';
import { addLog, drawCards, healResolver, regPost, regPre, regR, updatePlayer, withPending, countAttachedEnergyAsUnits } from '../_shared';
import { flipCoinsWithLog } from '../../effects';

function allPokemon(state: GameState, idx: 0 | 1): CardInstance[] {
  const p = state.players[idx];
  return [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
}

function cardName(pool: Map<string, Card>, inst: CardInstance | null | undefined): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '') : '';
}

function damageCounters(inst: CardInstance | null | undefined): number {
  return Math.floor((inst?.damage ?? 0) / 10);
}

function hasStatus(inst: CardInstance | null | undefined, statuses: string[]): boolean {
  if (!inst) return false;
  return statuses.includes(inst.status ?? '') || statuses.includes(inst.secondaryStatus ?? '');
}

function flipUntilTails(state: GameState, aIdx: 0 | 1, label: string): { state: GameState; heads: number } {
  let s = state;
  let heads = 0;
  for (let i = 1; i <= 20; i++) {
    const r = flipCoinsWithLog(s, 1, label, aIdx);
    s = r.state;
    if (r.heads === 1) heads++;
    else break;
  }
  return { state: s, heads };
}

function flipFixed(state: GameState, aIdx: 0 | 1, label: string, count: number): { state: GameState; heads: number } {
  const r = flipCoinsWithLog(state, count, label, aIdx);
  return { state: r.state, heads: r.heads };
}

// J-mark batch v2.346：P1 simple variable/coin/heal effects verified from static/cards JSON.

// 超級艾路雷朵ex｜快手斬：若自身無傷，50+150。
regPre('超級艾路雷朵ex|快手斬', (state, aIdx) => {
  const atk = state.players[aIdx].active;
  return { state, damage: atk && atk.damage === 0 ? 200 : 50 };
});

// 拉達｜逆襲門牙：自己備戰區所有「小拉達」傷害指示物數 ×40。
regPre('拉達|逆襲門牙', (state, aIdx, pool) => {
  const dmg = state.players[aIdx].bench
    .filter((b) => cardName(pool, b) === '小拉達')
    .reduce((sum, b) => sum + damageCounters(b) * 40, 0);
  return { state, damage: dmg };
});

// 大針蜂ex｜針蜂轟鳴：自己的場上「大針蜂（包含 ex）」數 ×110。
regPre('大針蜂ex|針蜂轟鳴', (state, aIdx, pool) => {
  const count = allPokemon(state, aIdx).filter((p) => {
    const n = cardName(pool, p);
    return n === '大針蜂' || n === '大針蜂ex';
  }).length;
  return { state, damage: count * 110 };
});

// 尖牙籠｜整隻咬：對手戰鬥寶可夢沒有撤退費用時 +80。
regPre('尖牙籠|整隻咬', (state, aIdx, pool) => {
  const def = state.players[1 - aIdx as 0 | 1].active;
  const c = def ? pool.get(def.cardId) : null;
  const hasNoRetreatCost = (c?.retreatCost?.length ?? 0) === 0;
  return { state, damage: hasNoRetreatCost ? 160 : 80 };
});

// 朽木妖｜超頻傷痛：60 + 對手所有寶可夢傷害指示物總數 ×10（即現有 damage 總和）。
regPre('朽木妖|超頻傷痛', (state, aIdx) => {
  const dIdx = 1 - aIdx as 0 | 1;
  const extra = allPokemon(state, dIdx).reduce((sum, p) => sum + (p.damage ?? 0), 0);
  return { state, damage: 60 + extra };
});

// 南瓜怪人ex｜恐怖輪舞：30 + 自己受傷備戰寶可夢數 ×50。
regPre('南瓜怪人ex|恐怖輪舞', (state, aIdx) => {
  const damagedBench = state.players[aIdx].bench.filter((b) => (b.damage ?? 0) > 0).length;
  return { state, damage: 30 + damagedBench * 50 };
});

// 超級大力鱷ex｜晶光嚼碎：若對手戰鬥寶可夢有傷害指示物，200+200。
regPre('超級大力鱷ex|晶光嚼碎', (state, aIdx) => {
  const def = state.players[1 - aIdx as 0 | 1].active;
  return { state, damage: def && def.damage > 0 ? 400 : 200 };
});

// 泥巴魚ex｜濕漉漉陷阱：若自身有傷害指示物，100+100。
regPre('泥巴魚ex|濕漉漉陷阱', (state, aIdx) => {
  const atk = state.players[aIdx].active;
  return { state, damage: atk && atk.damage > 0 ? 200 : 100 };
});

// 小碎鑽｜反擊寶石：若對手剩餘獎賞卡 2 張以下，70+100。
regPre('小碎鑽|反擊寶石', (state, aIdx) => {
  const dIdx = 1 - aIdx as 0 | 1;
  return { state, damage: state.players[dIdx].prizes.length <= 2 ? 170 : 70 };
});

// 青木的毛頭小鷹｜啄傷口：若對手戰鬥寶可夢有傷害指示物，20+80。
regPre('青木的毛頭小鷹|啄傷口', (state, aIdx) => {
  const def = state.players[1 - aIdx as 0 | 1].active;
  return { state, damage: def && def.damage > 0 ? 100 : 20 };
});

// 青木的姆克鷹｜硬撐：若自身中毒或灼傷，60+100。
regPre('青木的姆克鷹|硬撐', (state, aIdx) => {
  const atk = state.players[aIdx].active;
  return { state, damage: hasStatus(atk, ['poisoned', 'burned']) ? 160 : 60 };
});

// 青木的土龍弟弟｜上衝：擲 1 次硬幣，正面 +20。
regPre('青木的土龍弟弟|上衝', (state, aIdx) => {
  const r = flipCoinsWithLog(state, 1, '上衝', aIdx);
  return { state: r.state, damage: r.heads === 1 ? 30 : 10 };
});

// 霹靂電球ex｜百裂球：100 + 擲到反面前正面數 ×100。
regPre('霹靂電球ex|百裂球', (state, aIdx) => {
  const r = flipUntilTails(state, aIdx, '百裂球');
  const dmg = 100 + r.heads * 100;
  return { state: addLog(r.state, `百裂球：${r.heads} 次正面 → 基礎 100 + ${r.heads}×100 = ${dmg} 傷害`, aIdx), damage: dmg };
});

// 青木的土龍節節ex｜職務猛攻：擲與自身附加能量數相同次數，正面數 ×80。
regPre('青木的土龍節節ex|職務猛攻', (state, aIdx, pool) => {
  // v5.541：依「能量數(units)」非卡張數——燃火能量(附進化)算3、火箭隊能量算2 等
  const _act = state.players[aIdx].active;
  const energyCount = _act ? countAttachedEnergyAsUnits(_act, pool, state, aIdx) : 0;
  const r = flipFixed(state, aIdx, '職務猛攻', energyCount);
  const dmg = r.heads * 80;
  return { state: addLog(r.state, `職務猛攻：${r.heads}/${energyCount} 次正面 → ${dmg} 傷害`, aIdx), damage: dmg };
});

// 粉香香｜甜甜香氣：自己的 1 隻寶可夢恢復 30 HP。
regPre('粉香香|甜甜香氣', (state) => ({ state, damage: 0 }));
regPost('粉香香|甜甜香氣', (state, aIdx) => {
  const p = state.players[aIdx];
  const candidates = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  if (candidates.length === 0) return state;
  const s = addLog(state, '甜甜香氣：選擇 1 隻自己的寶可夢恢復 30 HP', aIdx);
  return withPending(s, {
    type: 'heal-target', actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'j-sweet-scent-heal-30',
    params: { healAmount: 30 },
  });
});
regR('j-sweet-scent-heal-30', healResolver);

// 青木的樹枕尾熊｜瞌睡抽出：自身睡眠，抽 2 張。
regPre('青木的樹枕尾熊|瞌睡抽出', (state) => ({ state, damage: 0 }));
regPost('青木的樹枕尾熊|瞌睡抽出', (state, aIdx) => {
  let s = updatePlayer(state, aIdx, (p) => p.active ? { ...p, active: { ...p.active, status: 'asleep' } } : p);
  s = drawCards(s, aIdx, 2);
  return addLog(s, '瞌睡抽出：自身【睡眠】，抽出 2 張卡', aIdx);
});
