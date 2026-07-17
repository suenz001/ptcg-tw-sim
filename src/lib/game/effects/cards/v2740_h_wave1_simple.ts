/**
 * v2.74 H 標 Wave 1 — 簡單批（30 張）
 *
 * 全部用既有 helper / 已建立 pattern：
 *   - 擲幣 +N (coinBonusPre)
 *   - 自身回血 (selfHealPost)
 *   - 擲幣狀態 (coinStatusPost)
 *   - 擲幣多狀態 (狀態組合)
 *   - 擲幣免疫 (damageReduceNextHit 999)
 *   - 擲幣對手下回合 cantAttack
 *   - recharge (blockedAttackNamesNextTurn)
 *   - 反失敗 (擲反失敗)
 *   - 對手備戰數 ×N
 *   - 自方備戰數 ×N
 *   - 自身指示物 ×10
 *   - 對手戰鬥指示物 ×10
 *   - 對手 ex 條件 +N
 *   - 自身能量數 ×N
 *   - 棄能量大招
 */

import { regPre, regPost, addLog, updatePlayer } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  coinStatusPost, statusPost,
  coinHeadsMultiplyPre, flipCoinsWithLog,
  selfHitPost,
  countEnergyTypeHostAware,
  selfCantAttackNextPost, discardOppActiveEnergyPost,
} from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper（大多複製自 I 標 wave 14）
// ══════════════════════════════════════════════════════════════════════════════

function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const k = Math.min(n, att.energyAttached.length);
    const s = addLog(state, `${label}：自身丟棄 ${k} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const remaining = p.active.energyAttached.slice(0, p.active.energyAttached.length - k);
      const discarded = p.active.energyAttached.slice(p.active.energyAttached.length - k);
      return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
    });
  };
}

function selfHealPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    if (!a) return state;
    const before = a.damage ?? 0;
    if (before === 0) return addLog(state, `${label}：自身無傷害可回復`, aIdx);
    const after = Math.max(0, before - amount);
    return updatePlayer(
      addLog(state, `${label}：自身回復 ${before - after} HP`, aIdx),
      aIdx, p => ({ ...p, active: p.active ? { ...p.active, damage: after } : null }),
    );
  };
}

function rechargePost(attackName: string): AttackPostFn {
  return (state, aIdx, _pool) => updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), attackName],
    } : null,
  }));
}

function coinBonusPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    if (r.heads === 1) {
      const dmg = base + bonus;
      return { state: addLog(r.state, `${label}：正面 → ${base}+${bonus} = ${dmg}`, aIdx), damage: dmg };
    }
    return { state: addLog(r.state, `${label}：反面 → ${base}`, aIdx), damage: base };
  };
}

function coinReverseFailPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    if (r.heads === 0) return { state: addLog(r.state, `${label}：反面 → 招式失敗`, aIdx), damage: 0 };
    return { state: addLog(r.state, `${label}：正面`, aIdx), damage: base };
  };
}

function selfEnergyCountPre(
  base: number, perEnergy: number,
  energyType: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    // v5.688：改用中央 countEnergyTypeHostAware — 認列古舊/稜鏡/燃火/火箭隊/新衝天等「視為該屬性」特殊能量。
    const count = countEnergyTypeHostAware(a, energyType, pool);
    const dmg = base + count * perEnergy;
    return { state: addLog(state, `${label}：自身${energyType}能量 ${count} → ${base}+${count}×${perEnergy} = ${dmg}`, aIdx), damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 擲幣 +N（4 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('帕底亞 烏波|打滾', coinBonusPre(10, 20, '打滾'));
regPre('烈焰馬|燃燒狂奔', coinBonusPre(60, 60, '燃燒狂奔'));
regPre('利歐路|電光一閃', coinBonusPre(10, 20, '電光一閃'));
regPre('敗露球菇ex|蘑菇橫掃', coinBonusPre(100, 80, '蘑菇橫掃'));

// ══════════════════════════════════════════════════════════════════════════════
// 2. 自身回血（3 張）
// ══════════════════════════════════════════════════════════════════════════════
const HEAL: Array<[string, number, number]> = [
  ['椰蛋樹|超級吸取', 50, 30],
  ['畢力吉翁|綠葉吸取', 30, 30],
  ['哲爾尼亞斯|極光增輝', 30, 30],
];
for (const [key, dmg, heal] of HEAL) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfHealPost(heal, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 擲幣狀態（4 張）
// ══════════════════════════════════════════════════════════════════════════════
const COIN_STATUS: Array<[string, number, 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed']> = [
  ['鐵臂膀|衝擊波', 30, 'paralyzed'],
  ['象徵鳥|念力', 60, 'paralyzed'],
  ['熔岩蟲|熾熱熔岩', 20, 'burned'],
];
for (const [key, dmg, st] of COIN_STATUS) {
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, coinStatusPost(st));
}

// 泥巴魚｜劈啪麻痺 50 — 擲1次硬幣，正面則【麻痺】+ 選1個對手戰鬥能量丟棄（Wilson 裁定：丟能量亦在正面條件內）。
// v5.982：原在 COIN_STATUS 表只實裝【麻痺】，漏「再丟1能量」副作用（雙效果卡塞進純狀態表，同渾身臭臭型）。
//   丟能量走中央 discardOppActiveEnergyPost（picker + attack-effect 免疫 gate + host-aware）。
regPre('泥巴魚|劈啪麻痺', (s) => ({ state: s, damage: 50 }));
regPost('泥巴魚|劈啪麻痺', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '劈啪麻痺', aIdx);
  if (r.heads === 0) return addLog(r.state, '劈啪麻痺：反面，無追加效果', aIdx);
  const s1 = statusPost('paralyzed')(r.state, aIdx, pool);
  return discardOppActiveEnergyPost('劈啪麻痺')(s1, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 擲幣雙狀態（2 張）
// ══════════════════════════════════════════════════════════════════════════════
// 阿柏蛇|混入毒：擲幣正面 → 中毒+混亂
regPre('阿柏蛇|混入毒', (s) => ({ state: s, damage: 0 }));
regPost('阿柏蛇|混入毒', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '混入毒', aIdx);
  if (r.heads === 0) return r.state;
  let s = statusPost('poisoned')(r.state, aIdx, pool);
  return statusPost('confused')(s, aIdx, pool);
});

// 晶光花|神經毒：擲幣正面 → 中毒+麻痺
regPre('晶光花|神經毒', (s) => ({ state: s, damage: 0 }));
regPost('晶光花|神經毒', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '神經毒', aIdx);
  if (r.heads === 0) return r.state;
  let s = statusPost('poisoned')(r.state, aIdx, pool);
  return statusPost('paralyzed')(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 擲幣下回合自身免疫（2 張）— 卡面「不會受到招式的傷害與效果的影響」→ 中央 immuneToAllAttackNextTurn
//   (engine 同時擋傷害與 POST 效果)。v5.888 修:原用 damageReduceNextHit=999 只擋傷害、效果(狀態/換位等)會漏。
// ══════════════════════════════════════════════════════════════════════════════
function coinHeadsImmunePost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    if (r.heads === 0) return addLog(r.state, `${label}：反面，無免疫`, aIdx);
    return updatePlayer(
      addLog(r.state, `${label}：正面 → 下回合不受招式的傷害與效果`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, immuneToAllAttackNextTurn: true } : null,
      }),
    );
  };
}
regPre('變隱龍|隱形攻擊', (s) => ({ state: s, damage: 80 }));
regPost('變隱龍|隱形攻擊', coinHeadsImmunePost('隱形攻擊'));
regPre('托戈德瑪爾|尖刺電光', (s) => ({ state: s, damage: 40 }));
regPost('托戈德瑪爾|尖刺電光', coinHeadsImmunePost('尖刺電光'));

// ══════════════════════════════════════════════════════════════════════════════
// 6. 擲幣對手下回合無法用招式（1 張）— 飄香豚|芬香踩踏
// ══════════════════════════════════════════════════════════════════════════════
regPre('飄香豚|芬香踩踏', (s) => ({ state: s, damage: 50 }));
regPost('飄香豚|芬香踩踏', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '芬香踩踏', aIdx);
  if (r.heads === 0) return addLog(r.state, '芬香踩踏：反面', aIdx);
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(
    addLog(r.state, '芬香踩踏：正面 → defender 下回合無法使用招式', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, cantAttackPending: true } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. recharge（3 張）
// ══════════════════════════════════════════════════════════════════════════════
const RECHARGE: Array<[string, number]> = [
  ['火炎獅|爆焰衝撞', 160],
  ['哲爾尼亞斯|終極衝擊', 130],
  ['鐵武者|意念之刃', 120],
];
// v5.982：卡面「無法使用招式」(全鎖)→ selfCantAttackNextPost；「無法使用『X』」(單鎖)→ rechargePost。
const RECHARGE_ALL_LOCK = new Set(['火炎獅|爆焰衝撞', '哲爾尼亞斯|終極衝擊']);
for (const [key, dmg] of RECHARGE) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, RECHARGE_ALL_LOCK.has(key) ? selfCantAttackNextPost() : rechargePost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. 反失敗（1 張）— 來電汪|胡思亂撞
// ══════════════════════════════════════════════════════════════════════════════
regPre('來電汪|胡思亂撞', coinReverseFailPre(20, '胡思亂撞'));

// ══════════════════════════════════════════════════════════════════════════════
// 9. 對手備戰數 ×N（2 張）
// ══════════════════════════════════════════════════════════════════════════════
function oppBenchCountPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const n = state.players[dIdx].bench.length;
    const dmg = base + n * per;
    return { state: addLog(state, `${label}：對手備戰 ${n} 隻 → ${base}+${n}×${per} = ${dmg}`, aIdx), damage: dmg };
  };
}

// v5.844 清除跨檔重複死碼(生效版在 effects.ts,原 厄鬼椪 碧草面具|鬼返)

// v5.844 清除跨檔重複死碼(生效版在 effects.ts,原 捷拉奧拉|鬥戰雷電)

// ══════════════════════════════════════════════════════════════════════════════
// 10. 自方備戰數 ×N（1 張）— 卡璞・鳴鳴ex|閃電結連
// ══════════════════════════════════════════════════════════════════════════════
regPre('卡璞・鳴鳴ex|閃電結連', (state, aIdx, _pool) => {
  const n = state.players[aIdx].bench.length;
  const dmg = 60 + n * 20;
  return { state: addLog(state, `閃電結連：自方備戰 ${n} 隻 → 60+${n}×20 = ${dmg}`, aIdx), damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. 自方場上寶可數 ×N（1 張）— 大宇怪|宇宙律動
// ══════════════════════════════════════════════════════════════════════════════
regPre('大宇怪|宇宙律動', (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  const n = (p.active ? 1 : 0) + p.bench.length;
  const dmg = n * 20;
  return { state: addLog(state, `宇宙律動：自方場上寶可 ${n} → ${n}×20 = ${dmg}`, aIdx), damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. 自身指示物 ×10（2 張）
// ══════════════════════════════════════════════════════════════════════════════
function selfDamageCountersPre(base: number, per: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const counters = Math.floor((state.players[aIdx].active?.damage ?? 0) / 10);
    const dmg = base + counters * per;
    return { state: addLog(state, `${label}：自身指示物 ${counters} → ${base}+${counters}×${per} = ${dmg}`, aIdx), damage: dmg };
  };
}
regPre('雷吉斯奇魯|激怒之錘', selfDamageCountersPre(60, 10, '激怒之錘'));
regPre('故勒頓ex|復仇懲處', selfDamageCountersPre(20, 10, '復仇懲處'));

// ══════════════════════════════════════════════════════════════════════════════
// 13. 對手戰鬥指示物 ×10（1 張）— 閃電鳥|追擊伏特
// ══════════════════════════════════════════════════════════════════════════════
regPre('閃電鳥|追擊伏特', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const counters = Math.floor((state.players[dIdx].active?.damage ?? 0) / 10);
  const dmg = 20 + counters * 10;
  return { state: addLog(state, `追擊伏特：對手指示物 ${counters} → 20+${counters}×10 = ${dmg}`, aIdx), damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. 對手 ex 條件 +N（3 張）
// ══════════════════════════════════════════════════════════════════════════════
function oppExBonusPre(base: number, bonus: number, label: string, alsoMatchV: boolean = false): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const da = state.players[dIdx].active;
    if (!da) return { state, damage: base };
    const card = pool.get(da.cardId);
    const isEx = card?.subtype?.includes('ex') || card?.name?.endsWith('ex');
    const isV = alsoMatchV && (card?.name?.endsWith('V') || card?.name?.includes('VMAX') || card?.name?.endsWith('VSTAR'));
    if (isEx || isV) {
      return { state: addLog(state, `${label}：對手 ex/V → ${base}+${bonus} = ${base+bonus}`, aIdx), damage: base + bonus };
    }
    return { state: addLog(state, `${label}：對手非 ex → ${base}`, aIdx), damage: base };
  };
}
regPre('鐵臂膀|超合金之手', oppExBonusPre(80, 80, '超合金之手', true));
regPre('摔角鷹人|上升衝撞', oppExBonusPre(10, 50, '上升衝撞'));
regPre('哲爾尼亞斯ex|上升角擊', oppExBonusPre(120, 100, '上升角擊'));

// ══════════════════════════════════════════════════════════════════════════════
// 15. 自身屬性能量數 ×N（2 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('大電海燕ex|雷電槍', selfEnergyCountPre(40, 40, 'Lightning', '雷電槍'));
regPre('帝牙盧卡ex|金屬爆破', selfEnergyCountPre(100, 20, 'Metal', '金屬爆破'));

// ══════════════════════════════════════════════════════════════════════════════
// 16. 自方備戰有指示物 +N（2 張）
// ══════════════════════════════════════════════════════════════════════════════
function selfBenchHasDamagePre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const hasInjury = state.players[aIdx].bench.some(b => (b.damage ?? 0) > 0);
    if (hasInjury) return { state: addLog(state, `${label}：自方備戰有指示物 → ${base}+${bonus} = ${base+bonus}`, aIdx), damage: base + bonus };
    return { state: addLog(state, `${label}：自方備戰無指示物 → ${base}`, aIdx), damage: base };
  };
}
regPre('雄偉牙|憤怒突擊', selfBenchHasDamagePre(80, 80, '憤怒突擊'));
regPre('故勒頓ex|復仇光炮', selfBenchHasDamagePre(100, 120, '復仇光炮'));

// ══════════════════════════════════════════════════════════════════════════════
// 17. 棄能量大招（2 張）
// ══════════════════════════════════════════════════════════════════════════════
const DISCARD_N: Array<[string, number, number]> = [
  // v5.399：紅蓮鎧騎ex|鎧農炮 移至 effects.ts SELF_DISCARD_UNITS_BATCH(units+picker,Fire filter)
];
for (const [key, dmg, n] of DISCARD_N) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfDiscardNEnergyPost(n, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// Wave H1 統計：30 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
