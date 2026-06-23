/**
 * v2.64 I 標 Wave 14 — 雜項第七批（31 張）
 *
 * 涵蓋：
 *   - 棄 N/全 能量大招 (8 張)
 *   - 自身回血 (3 張)
 *   - 條件 +N 簡單 (5 張)
 *   - 擲幣 ×N 倍率 (5 張)
 *   - 擲幣狀態 (3 張)
 *   - 自方狙擊備戰 (3 張)
 *   - recharge (3 張)
 *   - 反失敗 (1 張)
 */

import { regPre, regPost, addLog, updatePlayer, withPending } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState } from '../../types';
import type { Card } from '$lib/cards/types';
import {
  statusPost, coinStatusPost,
  coinHeadsMultiplyPre, flipCoinsWithLog, snipeOneOppBenchPost,
  countEnergyTypeHostAware,
} from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 本地 helper
// ══════════════════════════════════════════════════════════════════════════════

// 棄自身 N 個能量（從尾端取）
function selfDiscardNEnergyPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) {
      return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    }
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

// 棄自身全能量
function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) {
      return addLog(state, `${label}：自身無能量可丟棄`, aIdx);
    }
    const s = addLog(state, `${label}：自身丟棄全部能量（${att.energyAttached.length} 個）`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const discarded = p.active.energyAttached;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...discarded] };
    });
  };
}

// 自身回血 X 點
function selfHealPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const a = state.players[aIdx].active;
    if (!a) return state;
    const before = a.damage ?? 0;
    if (before === 0) return addLog(state, `${label}：自身無傷害可回復`, aIdx);
    const after = Math.max(0, before - amount);
    return updatePlayer(
      addLog(state, `${label}：自身回復 ${before - after} HP`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: after } : null,
      }),
    );
  };
}

// 下回合自身無法用此招（recharge）
function rechargePost(attackName: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(state, aIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), attackName],
      } : null,
    }));
  };
}

// 對手 1 隻備戰受 N（讓玩家挑）— 用既有 wave3a-snipe-bench resolver

// 自身 X 屬能量數 ×K + base
function selfEnergyCountPre(
  base: number,
  perEnergy: number,
  energyType: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  label: string,
) {
  return (state: GameState, aIdx: 0|1, pool: Map<string, Card>) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    // v5.688：改用中央 countEnergyTypeHostAware — 認列古舊/稜鏡/燃火/火箭隊/新衝天等「視為該屬性」特殊能量。
    const count = countEnergyTypeHostAware(a, energyType, pool);
    const dmg = base + count * perEnergy;
    const s = addLog(state, `${label}：自身${energyType}能量 ${count} 個 → ${base} + ${count}×${perEnergy} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// 擲 1 次硬幣，正面 +bonus
function coinBonusPre(base: number, bonus: number, label: string) {
  return (state: GameState, aIdx: 0|1, _pool: Map<string, Card>) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    if (r.heads === 1) {
      const dmg = base + bonus;
      return { state: addLog(r.state, `${label}：正面 → ${base} + ${bonus} = ${dmg}`, aIdx), damage: dmg };
    }
    return { state: addLog(r.state, `${label}：反面 → ${base}`, aIdx), damage: base };
  };
}

// 擲 1 次硬幣，反面失敗（純擲幣失敗，無條件）
function coinReverseFailPre(base: number, label: string) {
  return (state: GameState, aIdx: 0|1, _pool: Map<string, Card>) => {
    const r = flipCoinsWithLog(state, 1, label, aIdx);
    if (r.heads === 0) {
      return { state: addLog(r.state, `${label}：反面 → 招式失敗（0 傷害）`, aIdx), damage: 0 };
    }
    return { state: addLog(r.state, `${label}：正面`, aIdx), damage: base };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 棄 N/全能量大招（8 張）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面 pattern：「damage。選擇N個（或全部）這隻寶可夢身上附加的能量，將其丟棄。」
// ══════════════════════════════════════════════════════════════════════════════

const DISCARD_N: Array<[string, number, number]> = [  // [key, dmg, n（0 = 全棄）]
  // v5.391：超級噴火駝ex|火山流星 移除 — 它在 effects.ts registerSelfDiscardMultiply 已完整註冊
  //   （含 picker + units），這裡若再註冊 regPost(selfDiscardNEnergyPost) 會「多丟 2 張」double-discard。
  // v5.394：漩渦波/力量踩踏/暴雪刀鋒/粉碎頭擊 移至 effects.ts registerSelfDiscardMultiply(units+picker)
  ['鋼炮臂蝦|水之發射器', 210, 0],
  ['洛托姆ex|十萬伏特', 130, 0],
  ['超級拉帝亞斯ex|幻想脈衝', 300, 0],
];
for (const [key, dmg, n] of DISCARD_N) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, n === 0 ? selfDiscardAllEnergyPost(atkName) : selfDiscardNEnergyPost(n, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. 自身回血（3 張）
// ──────────────────────────────────────────────────────────────────────────────
// 卡面 pattern：「damage。將這隻寶可夢恢復「N」HP。」
// ══════════════════════════════════════════════════════════════════════════════

const SELF_HEAL: Array<[string, number, number]> = [  // [key, dmg, healAmount]
  ['蓮帽小童|超級吸取', 30, 30],
  ['小海獅|泡沫吸取', 20, 20],
  ['木棉球|吸取', 10, 10],
];
for (const [key, dmg, heal] of SELF_HEAL) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfHealPost(heal, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 條件 +N 簡單（5 張）
// ──────────────────────────────────────────────────────────────────────────────
// 哥達鴨 水炮 60+ 自身水能量數×20
// 其他：擲 1 次硬幣若為正面 +bonus
// ══════════════════════════════════════════════════════════════════════════════

regPre('哥達鴨|水炮', selfEnergyCountPre(60, 20, 'Water', '水炮'));

const COIN_BONUS: Array<[string, number, number]> = [  // [key, base, bonus]
  ['奇樹的電海燕|電光一閃', 10, 20],
  ['火箭隊的蛋蛋|祈求', 10, 20],
  ['長毛豬|上衝', 30, 30],
  ['逐電犬|電氣狂奔', 70, 70],
  ['瑪沙那|連續擊拳', 10, 20],
];
for (const [key, base, bonus] of COIN_BONUS) {
  regPre(key, coinBonusPre(base, bonus, key.split('|')[1]));
}

// 頑皮熊貓 真氣突刺 50：擲 1 次硬幣若為反面，則這個招式失敗
regPre('頑皮熊貓|真氣突刺', coinReverseFailPre(50, '真氣突刺'));

// ══════════════════════════════════════════════════════════════════════════════
// 4. 擲幣 ×N 倍率（6 張）
// ══════════════════════════════════════════════════════════════════════════════

regPre('大嘴雀|機關槍鑽', coinHeadsMultiplyPre(5, 30, '機關槍鑽'));
regPre('傘電蜥|雙重抓', coinHeadsMultiplyPre(2, 10, '雙重抓'));
regPre('大顎蟻|二連頭錘', coinHeadsMultiplyPre(2, 10, '二連頭錘'));
regPre('豆蟋蟀|躍動', coinHeadsMultiplyPre(3, 10, '躍動'));
regPre('白海獅|摔打', coinHeadsMultiplyPre(2, 70, '摔打'));
// 岩殿居蟹 尖石攻擊 80+ 擲 1 次硬幣若為正面 +60
regPre('岩殿居蟹|尖石攻擊', coinBonusPre(80, 60, '尖石攻擊'));

// ══════════════════════════════════════════════════════════════════════════════
// 5. 擲幣狀態（3 張）
// ══════════════════════════════════════════════════════════════════════════════

const COIN_STATUS: Array<[string, number, 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed']> = [
  ['冰砌鵝|嚴寒頭錘', 20, 'paralyzed'],
  ['三合一磁怪|電擊', 30, 'paralyzed'],
  ['狩獵鳳蝶|麻痺粉', 40, 'paralyzed'],
];
for (const [key, dmg, st] of COIN_STATUS) {
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, coinStatusPost(st));
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. 自方狙擊備戰（3 張）
// ──────────────────────────────────────────────────────────────────────────────
// 「對手的1隻備戰寶可夢受到 N 點傷害。[在備戰區不計算弱點・抵抗力。]」
// 注意：本批是「無 base damage」或「+對手戰鬥場 base」這 2 種；以下:
//   巨石丁 岩石踢 20 + 對手1備戰 20
//   雪暴馬 冰之射擊 20 + 對手1備戰 20
//   長耳兔 魯莽踢 0 + 對手1備戰 50
// ══════════════════════════════════════════════════════════════════════════════

const SNIPE_AND_HIT: Array<[string, number, number]> = [  // [key, baseDmg, snipeAmount]
  ['巨石丁|岩石踢', 20, 20],
  ['雪暴馬|冰之射擊', 20, 20],
  ['長耳兔|魯莽踢', 0, 50],
];
for (const [key, base, snipe] of SNIPE_AND_HIT) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: base }));
  regPost(key, snipeOneOppBenchPost(snipe, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. recharge（3 張）
// ══════════════════════════════════════════════════════════════════════════════

const RECHARGE: Array<[string, number]> = [
  ['雪暴馬|冰霜颱風', 130],
  ['奇樹的電肚蛙ex|閃電伏特', 230],
  ['蓮帽小童|水流斬', 70],
];
for (const [key, dmg] of RECHARGE) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, rechargePost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// Wave 14 統計：31 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
