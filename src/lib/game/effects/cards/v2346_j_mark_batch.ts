import type { Card } from '$lib/cards/types';
import type { CardInstance, GameState } from '../../types';
import { addLog, drawCards, healResolver, regPost, regPre, regR, updatePlayer, withPending, countAttachedEnergyAsUnits } from '../_shared';
import { hasStatusInAnySlot } from '../_shared'; // v5.834 跨三槽狀態讀取
import { flipCoinsWithLog, flipCoinsUntilTails, applyStatusToSelfActive , defHasCountersBonusPre } from '../../effects';
import { oppCountersMultiplyPre } from '../../effects'; // ⭐v6.399 收斂：對手傷害指示物 × N（中央唯一一份）
import { damageCounterCount } from '../_shared'; // ⭐v6.399 指示物個數：全站唯一一份判準
import { computeActiveRetreatCostFor } from '../../engine'; // v5.711 有效撤退費(整隻咬)

function allPokemon(state: GameState, idx: 0 | 1): CardInstance[] {
  const p = state.players[idx];
  return [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
}

function cardName(pool: Map<string, Card>, inst: CardInstance | null | undefined): string {
  return inst ? (pool.get(inst.cardId)?.name ?? '') : '';
}

// ⭐v6.399：本檔原本的 local damageCounters 已刪除（與 _shared 的 damageCounterCount 同一判準）。

function flipUntilTails(state: GameState, aIdx: 0 | 1, label: string): { state: GameState; heads: number } {
  // v6.234：收斂到中央 flipCoinsUntilTails，沿用本檔原本的 20 次上限（行為不變）。
  return flipCoinsUntilTails(state, aIdx, label, 20);
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
  // v5.678：卡面「所有『小拉達』」採 NameContains（含「火箭隊的小拉達」等同名家族；Wilson 裁定 + 洛托呼喚先例）
  const dmg = state.players[aIdx].bench
    .filter((b) => cardName(pool, b).includes('小拉達'))
    .reduce((sum, b) => sum + damageCounterCount(b) * 40, 0);
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
  const dIdx = (1 - aIdx) as 0 | 1;
  // v5.711：「沒有撤退費用」=有效撤退費為 0（含磁鐵鋼/浮遊/特性歸0 讓 base>0 歸 0、
  //   或咒縛火焰/重力之玉讓 base=0 變 >0），不再用 base retreatCost.length。對齊 v5.690 同類。
  const hasNoRetreatCost = computeActiveRetreatCostFor(state, dIdx, pool) === 0;
  return { state, damage: hasNoRetreatCost ? 160 : 80 };
});

// 朽木妖｜超頻傷痛：卡面「增加對手的所有寶可夢身上放置的傷害指示物的數量×10點傷害。」
// ⭐v6.399 收斂：原本算的是「傷害值總和」——站上傷害恆為 10 的倍數，所以與「指示物數×10」
//   **恆等價**，但那是巧合不是判準。改走中央 oppCountersMultiplyPre 的 scope:'all'。
//   ⚠ 原本不寫 log ⇒ 傳 { log: false }，對戰紀錄逐字不變。
regPre('朽木妖|超頻傷痛', oppCountersMultiplyPre(60, 10, '超頻傷痛', { log: false, scope: 'all' }));

// 南瓜怪人ex｜恐怖輪舞：30 + 自己受傷備戰寶可夢數 ×50。
regPre('南瓜怪人ex|恐怖輪舞', (state, aIdx) => {
  const damagedBench = state.players[aIdx].bench.filter((b) => (b.damage ?? 0) > 0).length;
  return { state, damage: 30 + damagedBench * 50 };
});

// 超級大力鱷ex｜晶光嚼碎：若對手戰鬥寶可夢有傷害指示物，200+200。
regPre('超級大力鱷ex|晶光嚼碎', defHasCountersBonusPre(200, 200, '晶光嚼碎'));   // ⭐v6.388 收斂到中央

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
regPre('青木的毛頭小鷹|啄傷口', defHasCountersBonusPre(20, 80, '啄傷口'));   // ⭐v6.388a 收斂到中央

// 青木的姆克鷹｜硬撐：若自身中毒或灼傷，60+100。
regPre('青木的姆克鷹|硬撐', (state, aIdx) => {
  const atk = state.players[aIdx].active;
  return { state, damage: hasStatusInAnySlot(atk, ['poisoned', 'burned']) ? 160 : 60 };
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
regPost('青木的樹枕尾熊|瞌睡抽出', (state, aIdx, pool) => {
  // v5.675 收斂：自身睡眠走中央自身狀態 helper（不眠/泡沫水免疫 + 欄位保留）
  let s = applyStatusToSelfActive(state, aIdx, 'asleep', pool, { label: '瞌睡抽出' });
  s = drawCards(s, aIdx, 2);
  return addLog(s, '瞌睡抽出：抽出 2 張卡', aIdx);
});
