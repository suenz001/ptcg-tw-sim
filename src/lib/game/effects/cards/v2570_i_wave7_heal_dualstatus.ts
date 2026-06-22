/**
 * v2.57 I 標 Wave 7 — 自身回血 / 不計算抵抗力 / 雙重狀態
 *
 *   A. 純自身回血（12 張）
 *   B. 不計算抵抗力（3 張）
 *   C. 雙重狀態（2 張）
 *
 * 共 17 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import {
  regPre, regPost,
  addLog, updatePlayer,
} from '../_shared';
import type { AttackPostFn } from '../_shared';
import { canApplyAttackEffectToTarget, applyStatusToSelfActive, applyStatusToOppActive } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// helper: 自身回血 N 點
// ══════════════════════════════════════════════════════════════════════════════
function selfHealPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    if (!a) return state;
    const before = a.damage ?? 0;
    if (before === 0) return addLog(state, `${label}：自身無傷害可回復`, aIdx);
    const after = Math.max(0, before - amount);
    const actuallyHealed = before - after;
    return updatePlayer(
      addLog(state, `${label}：自身回復 ${actuallyHealed} HP（${before} → ${after} 傷害）`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: after } : null,
      }),
    );
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. A 純自身回血（12 張）
// ══════════════════════════════════════════════════════════════════════════════
const SELF_HEAL: Array<[string, number, number]> = [
  // [key, dmg, healAmount]
  ['蓮帽小童|超級吸取', 30, 30],
  ['小海獅|泡沫吸取', 20, 20],
  ['斗笠菇|超級吸取', 90, 30],
  ['厄鬼椪 水井面具|泡沫吸取', 100, 30],
  ['啃果蟲|小吸取', 10, 10],
  ['派拉斯|吸血', 10, 10],
  ['畢力吉翁|終極吸取', 30, 30],
  ['莉莉艾的萌虻|紋絲不動', 0, 10],
  ['皮卡丘|放鬆休息', 0, 20],
  ['大宇怪|冥想', 0, 40],
];
for (const [key, dmg, heal] of SELF_HEAL) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfHealPost(heal, atkName));
}

// 食夢夢|睡覺 — 0 + 自身睡眠 + 回 30 HP
regPre('食夢夢|睡覺', (s) => ({ state: s, damage: 0 }));
regPost('食夢夢|睡覺', (state, aIdx, pool) => {
  // v5.675 收斂：自身睡眠走中央自身狀態 helper
  let s = applyStatusToSelfActive(state, aIdx, 'asleep', pool, { label: '睡覺' });
  s = addLog(s, '睡覺：回復 30 HP', aIdx);
  return selfHealPost(30, '睡覺')(s, aIdx, pool);
});

// 盔甲鳥|羽棲 — 0 + 回 50 + 自身下回合無法撤退
regPre('盔甲鳥|羽棲', (s) => ({ state: s, damage: 0 }));
regPost('盔甲鳥|羽棲', (state, aIdx, pool) => {
  let s = selfHealPost(50, '羽棲')(state, aIdx, pool);
  return updatePlayer(
    addLog(s, '羽棲：自身下回合無法撤退', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, cantRetreatPendingSelf: true } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. B 不計算抵抗力（3 張）
// v4.495：原誤套 skipWeakRes（跳兩個），改 skipResistance（只跳抵抗力）
//   卡面：「這個招式的傷害不計算抵抗力。」— 沒說不計算弱點，弱點仍應 ×2
// ══════════════════════════════════════════════════════════════════════════════
const SKIP_RES: Array<[string, number]> = [
  ['雷吉洛克|毀壞者金勾臂', 120],
  ['龍頭地鼠ex|巨岩墜落', 200],
  ['師父鼬|衝天粉碎', 80],
];
for (const [key, dmg] of SKIP_RES) {
  regPre(key, (s) => ({ state: s, damage: dmg, skipResistance: true }));
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. C 雙重狀態（2 張）
//
// PTCG 狀態分類：
//   - 思考類（status field）: asleep / confused / paralyzed
//   - 特殊狀態類（secondaryStatus field）: poisoned / burned
// 「中毒+睡眠」 = status=asleep, secondaryStatus=poisoned
// 「灼傷+混亂」 = status=confused, secondaryStatus=burned
// ══════════════════════════════════════════════════════════════════════════════
// 毒粉蛾|薄暮之毒 100 + 對手戰鬥場 中毒+睡眠
regPre('毒粉蛾|薄暮之毒', (s) => ({ state: s, damage: 100 }));
regPost('毒粉蛾|薄暮之毒', (state, aIdx, pool) => {
  // v5.675 收斂：對手雙重狀態走中央，逐狀態判免疫（不眠擋睡眠/祭典擋中毒/泡沫水全擋/化隱純樸）
  let s = applyStatusToOppActive(state, aIdx, 'asleep', pool, { kind: 'attack-effect', label: '薄暮之毒' });
  s = applyStatusToOppActive(s, aIdx, 'poisoned', pool, { kind: 'attack-effect', label: '薄暮之毒' });
  return s;
});

// 火箭隊的黑魯加|惡之火種 0 + 對手戰鬥場 灼傷+混亂
regPre('火箭隊的黑魯加|惡之火種', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的黑魯加|惡之火種', (state, aIdx, pool) => {
  // v5.675 收斂：對手雙重狀態走中央，逐狀態判免疫（憨憨臉擋混亂/祭典擋灼傷/泡沫水全擋/化隱純樸）
  let s = applyStatusToOppActive(state, aIdx, 'burned', pool, { kind: 'attack-effect', label: '惡之火種' });
  s = applyStatusToOppActive(s, aIdx, 'confused', pool, { kind: 'attack-effect', label: '惡之火種' });
  return s;
});

// 輔助：unused import 防護
export type _v2570Sentinel = PlayerState;
type _CIT = CardInstance;
