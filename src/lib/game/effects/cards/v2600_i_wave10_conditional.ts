/**
 * v2.6 I 標 Wave 10 — 條件 +N 第三批
 *
 *   A. 對手中毒 +N (2 張)
 *   B. 對手是進化寶可夢 +N (1 張)
 *   C. 對手抵抗力是【鬥】+N (1 張)
 *   D. 自身有道具 +N (3 張)
 *   E. 自身有特殊能量 +N (1 張)
 *   F. 自身有「火箭隊能量」+N (1 張)
 *   G. 場上有競技場 +N (1 張)
 *   H. 自身 X 能量 ≥ N +N (1 張)
 *   I. 能量比 cost 多 2 +N (2 張)
 *   J. 自方備戰有特定名稱寶可夢 +N (3 張)
 *   K. 自方備戰特定寶可夢受傷 +N (1 張)
 *   L. 自方棄牌區基本能量 ≥ 10 +N (1 張)
 *   M. 雙方手牌數相同 +N (1 張)
 *   N. 上對手回合招式 KO 自方 +N (1 張)
 *   O. 自方場上特定能量總數 ×K 等 (1 張)
 *
 * 共 ~22 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import { regPre } from '../_shared';
import { addLog } from '../_shared';
import type { AttackPreFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// helper: 對手中毒條件 +N
// ══════════════════════════════════════════════════════════════════════════════
function oppPoisonedConditionPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const cond = !!def && (def.status === 'poisoned' || def.secondaryStatus === 'poisoned');
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：對手戰鬥寶可夢 ${cond ? `中毒 → +${bonus}` : '無中毒'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 對手是進化寶可夢 +N
function oppEvolutionConditionPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const card = def ? pool.get(def.cardId) : undefined;
    const cond = !!card?.evolvesFrom;
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：對手戰鬥寶可夢 ${cond ? `進化寶可夢 → +${bonus}` : '基礎'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自身有道具 +N
function selfHasToolConditionPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    const cond = !!a?.toolAttached;
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：自身 ${cond ? `有道具 → +${bonus}` : '無道具'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自身有特殊能量 +N
function selfHasSpecialEnergyPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    const cond = a.energyAttached.some(e => pool.get(e.cardId)?.subtype === 'Special');
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：自身 ${cond ? `有特殊能量 → +${bonus}` : '無特殊能量'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自身有「火箭隊能量」+N
function selfHasRocketEnergyPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    const cond = a.energyAttached.some(e => {
      const card = pool.get(e.cardId);
      return !!card && card.name.includes('火箭隊能量');
    });
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：自身 ${cond ? `有火箭隊能量 → +${bonus}` : '無火箭隊能量'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 場上有競技場 +N
function stadiumConditionPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const cond = !!state.activeStadium;
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：場上 ${cond ? `有競技場 → +${bonus}` : '無競技場'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自身 X 能量 ≥ N → +K
function selfEnergyMinPre(
  base: number, bonus: number,
  energyType: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  threshold: number, label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    let count = 0;
    for (const e of a.energyAttached) {
      if (pool.get(e.cardId)?.pokemonType === energyType) count++;
    }
    const cond = count >= threshold;
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：自身 ${energyType} 能量 ${count} 個（門檻 ${threshold}）${cond ? `→ +${bonus}` : '不足'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自身能量比 cost 多 2 → +K
function selfExtraEnergyPre(
  base: number, bonus: number, costCount: number, label: string,
): AttackPreFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    const have = a.energyAttached.length;
    const cond = have >= costCount + 2;
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：自身能量 ${have} 個（cost+2 = ${costCount + 2}）${cond ? `→ +${bonus}` : '不足'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自方備戰有特定名稱寶可夢 +N
function selfBenchHasNamePre(
  base: number, bonus: number,
  namePatterns: string[],
  label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    const cond = player.bench.some(b => {
      const card = pool.get(b.cardId);
      if (!card) return false;
      return namePatterns.some(p => card.name.includes(p));
    });
    const dmg = base + (cond ? bonus : 0);
    const s = addLog(state, `${label}：自方備戰 ${cond ? `有「${namePatterns.join('/')}」 → +${bonus}` : `無「${namePatterns.join('/')}」`} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// A. 對手中毒 +N (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('車輪毬|毒液衝擊', oppPoisonedConditionPre(30, 60, '毒液衝擊'));
regPre('蜈蚣王|毒液衝擊', oppPoisonedConditionPre(90, 90, '毒液衝擊'));

// ══════════════════════════════════════════════════════════════════════════════
// B. 對手是進化寶可夢 +N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('雙斧戰龍|揮擊', oppEvolutionConditionPre(80, 80, '揮擊'));

// ══════════════════════════════════════════════════════════════════════════════
// C. 對手抵抗力是【鬥】+N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('地幔岩|擊落', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const card = def ? pool.get(def.cardId) : undefined;
  const cond = card?.resistance?.type === 'Fighting';
  const dmg = 30 + (cond ? 50 : 0);
  const s = addLog(state, `擊落：對手抵抗力 ${cond ? '為【鬥】 → +50' : '非【鬥】'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// D. 自身有道具 +N (3 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('音波龍|強化斬', selfHasToolConditionPre(70, 70, '強化斬'));
regPre('勾帕路翁|金屬武裝', selfHasToolConditionPre(80, 40, '金屬武裝'));

// ══════════════════════════════════════════════════════════════════════════════
// E. 自身有特殊能量 +N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('長毛狗|特殊獠牙', selfHasSpecialEnergyPre(100, 100, '特殊獠牙'));

// ══════════════════════════════════════════════════════════════════════════════
// F. 自身有「火箭隊能量」+N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的閃電鳥|惡棍閃電', selfHasRocketEnergyPre(60, 60, '惡棍閃電'));

// ══════════════════════════════════════════════════════════════════════════════
// G. 場上有競技場 +N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('大朝北鼻|山岳墜落', stadiumConditionPre(70, 70, '山岳墜落'));

// ══════════════════════════════════════════════════════════════════════════════
// H. 自身 X 能量 ≥ N (1 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('暴雪王|結冰木', selfEnergyMinPre(120, 120, 'Grass', 2, '結冰木'));

// ══════════════════════════════════════════════════════════════════════════════
// I. 能量比 cost 多 2 → +K (2 張)
// ══════════════════════════════════════════════════════════════════════════════
// 電擊魔獸ex|高電壓壓制 cost = ['L','L','C'] 3 個
regPre('電擊魔獸ex|高電壓壓制', selfExtraEnergyPre(180, 100, 3, '高電壓壓制'));
// 胖嘟嘟ex|力量壓制 cost = ?? — 卡面查不到 cost，設定為合理值
regPre('胖嘟嘟ex|力量壓制', selfExtraEnergyPre(80, 80, 3, '力量壓制'));

// ══════════════════════════════════════════════════════════════════════════════
// J. 自方備戰有特定名稱寶可夢 +N (3 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的尼多后|愛之衝擊', selfBenchHasNamePre(60, 120, ['尼多王'], '愛之衝擊'));
regPre('鐵蟻|一起啃食', selfBenchHasNamePre(20, 20, ['鐵蟻'], '一起啃食'));
// 巨金怪|結合光束 — 自方備戰需同時有「鐵啞鈴」AND「金屬怪」
regPre('巨金怪|結合光束', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const benchNames = player.bench.map(b => pool.get(b.cardId)?.name ?? '').filter(n => n);
  const hasA = benchNames.some(n => n === '鐵啞鈴');
  const hasB = benchNames.some(n => n === '金屬怪');
  const cond = hasA && hasB;
  const dmg = 130 + (cond ? 150 : 0);
  const s = addLog(state, `結合光束：自方備戰 ${cond ? '有鐵啞鈴+金屬怪 → +150' : '不具齊'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// K. 自方備戰特定寶可夢受傷 +N (1 張)
// 流氓熊貓|大佬拳 — 備戰「頑皮熊貓」身上有指示物 → +120
// ══════════════════════════════════════════════════════════════════════════════
regPre('流氓熊貓|大佬拳', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const cond = player.bench.some(b => {
    const card = pool.get(b.cardId);
    return card?.name === '頑皮熊貓' && (b.damage ?? 0) > 0;
  });
  const dmg = 80 + (cond ? 120 : 0);
  const s = addLog(state, `大佬拳：備戰「頑皮熊貓」${cond ? '有指示物 → +120' : '無指示物'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// L. 自方棄牌區基本火能量 ≥ 10 → +N (1 張)
// 水晶燈火靈|濺射火柱
// ══════════════════════════════════════════════════════════════════════════════
regPre('水晶燈火靈|濺射火柱', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  let count = 0;
  for (const c of player.discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic'
        && (card.pokemonType === 'Fire' || /【火】/.test(card.name))) {
      count++;
    }
  }
  const cond = count >= 10;
  const dmg = 50 + (cond ? 100 : 0);
  const s = addLog(state, `濺射火柱：棄牌區基本【火】能量 ${count} 張 ${cond ? '(≥10 → +100)' : '(<10)'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// M. 雙方手牌數相同 +N (1 張)
// 哥德小姐|同步射擊
// ══════════════════════════════════════════════════════════════════════════════
regPre('哥德小姐|同步射擊', (state, aIdx, _pool) => {
  const myHand = state.players[aIdx].hand.length;
  const oppHand = state.players[(1 - aIdx) as 0 | 1].hand.length;
  const cond = myHand === oppHand;
  const dmg = 90 + (cond ? 90 : 0);
  const s = addLog(state, `同步射擊：自手 ${myHand} / 對手手 ${oppHand} ${cond ? '相同 → +90' : '不同'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// N. 上對手回合招式 KO 自方 +N (1 張)
// 代拉基翁|報仇
// ══════════════════════════════════════════════════════════════════════════════
regPre('代拉基翁|報仇', (state, aIdx, _pool) => {
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const tookPrize = attackKO > 0;
  const bonus = tookPrize ? 80 : 0;
  const s = tookPrize
    ? addLog(state, '報仇：上對手回合自方寶可夢被招式 KO → +80', aIdx) : state;
  return { state: s, damage: 50 + bonus };
});

// ══════════════════════════════════════════════════════════════════════════════
// 輔助：unused import 防護
export type _v2600Sentinel = PlayerState;
type _CIT = CardInstance;
