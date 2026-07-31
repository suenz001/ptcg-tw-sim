/**
 * v2.49 I 標 Wave 3a — 條件 +N / 擲幣倍率 / 自殘 / 狙擊備戰 批次實裝
 *
 * 涵蓋 ~40 張 I 標寶可夢招式，按 pattern 分組：
 *
 *   A. 擲 N 次硬幣，正面數 × K 傷害（5 張）
 *   B. 自身 X 屬能量數 × K 傷害（4 張）
 *   C. 對手獎賞數 / 自方獎賞數條件 +N（5 張）
 *   D. 對手戰鬥場能量數 ×N 增傷或減傷（2 張）
 *   E. 對手身上傷害指示物 ×N（1 張）
 *   F. 狙擊單隻對手備戰（5 張）
 *   G. 對手所有備戰 each +N（2 張）
 *   H. 雙方所有備戰 each +N（1 張）
 *   I. 自身受招後下回合受招式 -N（8 張）
 *   J. 擲 N 次全正面 +K（2 張）
 *   K. 自方場上條件 +N（3 張）
 *
 * 復用既有 helper（statusPost / coinStatusPost / selfHitPost from effects.ts）
 * + 本檔自定 inline factory（避免動 effects.ts 主檔）
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost,
  addLog, updatePlayer,
} from '../_shared';
import { energyMatchesType } from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';
// v5.177：補 import (v5.176 hotfix wave3a-snipe-bench resolver 用此 helper 但漏 import)
import { canApplyEffectToTarget } from '../../defense';
import { flipCoinsWithLog, countAttachedEnergyAsUnits, countEnergyTypeHostAware, prizesConditionPre } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// helper: A 擲 N 次硬幣，正面數 × K 傷害（damage='Nx30+' 等）
// ══════════════════════════════════════════════════════════════════════════════
function coinFlipMultiplyPre(coinCount: number, perHead: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, coinCount, label, aIdx);
    const heads = r.heads;
    const s = addLog(r.state, `${label}：擲 ${coinCount} 次硬幣 → ${heads} 次正面，造成 ${heads * perHead} 點傷害`, aIdx);
    return { state: s, damage: heads * perHead };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: B 自身 X 屬能量數 × K 傷害
// ══════════════════════════════════════════════════════════════════════════════
function selfEnergyCountPre(
  base: number,
  perEnergy: number,
  energyType: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a) return { state, damage: base };
    // v5.688：改用中央 countEnergyTypeHostAware — 認列古舊/稜鏡/燃火/火箭隊/新衝天等「視為該屬性」特殊能量。
    const count = countEnergyTypeHostAware(a, energyType, pool);
    const dmg = base + count * perEnergy;
    const s = addLog(state, `${label}：自身${energyType}能量 ${count} 個 → ${base} + ${count}×${perEnergy} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: C 條件式獎賞數 +N（自方/對方）
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// helper: D 對手戰鬥場能量數 × K（增傷或減傷）
// ══════════════════════════════════════════════════════════════════════════════
function oppActiveEnergyCountPre(
  base: number,
  perEnergy: number,
  mode: 'add' | 'sub',
  label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    // v5.448：改用單位計數（新衝天 on Stage2 = 2）— 大橫掃依對手能量數減傷
    const count = def ? countAttachedEnergyAsUnits(def, pool) : 0;
    const delta = count * perEnergy;
    const dmg = mode === 'add' ? base + delta : Math.max(0, base - delta);
    const s = addLog(state, `${label}：對手戰鬥場 ${count} 個能量 → ${base}${mode === 'add' ? '+' : '-'}${delta} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: E 對手戰鬥場傷害指示物數 × K
// ══════════════════════════════════════════════════════════════════════════════
function oppActiveDamageCountPre(perCounter: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const def = state.players[dIdx].active;
    const counters = def ? Math.floor((def.damage ?? 0) / 10) : 0;
    const dmg = counters * perCounter;
    const s = addLog(state, `${label}：對手戰鬥場 ${counters} 個傷害指示物 → ${counters}×${perCounter} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: F 狙擊單隻對手備戰 N（攻方需挑 1 隻 bench；簡化：用 opp-bench-choose）
// ──────────────────────────────────────────────────────────────────────────────
// 既有 oppSnipePost 已實裝（讓玩家選 1 隻備戰），這裡直接定義新的 inline 版本
// ══════════════════════════════════════════════════════════════════════════════
function snipeOneBenchPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.bench.length === 0) {
      return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    }
    const s = addLog(state, `${label}：選 1 隻對手備戰寶可夢，受到 ${amount} 點傷害（不計算弱點/抵抗力）`, aIdx);
    return {
      ...s,
      pendingSelection: {
        type: 'opp-bench-choose',
        actorIdx: aIdx, sourcePlayerIdx: dIdx,
        minCount: 1, maxCount: 1,
        effectKey: 'wave3a-snipe-bench',
        params: { amount, label },
      },
    };
  };
}

// 對手所有備戰每隻 +N
// v5.268: per-bench 走 canApplyEffectToTarget('attack-damage', isBench:true)
//   修花之帷幔/球形盾牌/藏隱/深度下潛/羽毛化石/太晶/中立中心/暗影【惡】能量 等備戰免傷.
function snipeAllOppBenchPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.bench.length === 0) {
      return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    }
    let s = state;
    const newBench = opp.bench.map(b => {
      const card = pool.get(b.cardId);
      const guard = canApplyEffectToTarget(s, aIdx, b, card, 'attack-damage', pool, { isBench: true });
      if (guard.blocked) {
        s = addLog(s, `${label}：${card?.name ?? '?'} 因 ${guard.reason} 不受傷害`, aIdx);
        return b;
      }
      return { ...b, damage: (b.damage ?? 0) + amount };
    });
    const players = [...s.players] as [PlayerState, PlayerState];
    players[dIdx] = { ...opp, bench: newBench };
    return addLog({ ...s, players }, `${label}：對手備戰寶可夢各受到 ${amount} 點傷害（未被擋者）`, aIdx);
  };
}

// 雙方所有備戰每隻 +N
// v5.268: 對手側 per-bench 走 canApplyEffectToTarget guard (花之帷幔等可擋);
//   自方側不走 guard (自傷不應受花之帷幔保護, 卡面如此).
function snipeAllBothBenchPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    let s = state;
    const players = [...s.players] as [PlayerState, PlayerState];
    for (const i of [0, 1] as const) {
      const p = { ...players[i] };
      const isOppSide = i !== aIdx;
      p.bench = p.bench.map(b => {
        if (isOppSide) {
          const card = pool.get(b.cardId);
          const guard = canApplyEffectToTarget(s, aIdx, b, card, 'attack-damage', pool, { isBench: true });
          if (guard.blocked) {
            s = addLog(s, `${label}：${card?.name ?? '?'} 因 ${guard.reason} 不受傷害`, aIdx);
            return b;
          }
        }
        return { ...b, damage: (b.damage ?? 0) + amount };
      });
      players[i] = p;
    }
    return addLog({ ...s, players }, `${label}：雙方備戰寶可夢各受到 ${amount} 點傷害（未被擋者）`, aIdx);
  };
}

// resolver for snipe one
import { regR } from '../_shared';
regR('wave3a-snipe-bench', (state, aIdx, iids, params, pool) => {
  const amount = (params?.amount as number | undefined) ?? 0;
  const label = (params?.label as string | undefined) ?? '狙擊';
  if (iids.length === 0) return state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  // v5.176：加 canApplyEffectToTarget guard
  // v5.270：增強 audit log — 明確顯示 guard 是否觸發, 方便玩家對帳 (花之帷幔/球形盾牌等)
  // v5.445：加選用 kind 參數 — 預設 'attack-damage'(維持既有 7 卡)；放傷害指示物型(刺殺魔法)
  //   傳 'attack-effect' 才會走對戰圓形競技場等「招式效果」免疫。
  const kind = (params?.kind as 'attack-damage' | 'attack-effect' | undefined) ?? 'attack-damage';
  let s = state;
  const target = s.players[dIdx].bench.find(b => b.iid === targetIid);
  if (!target) return s;
  const targetCard = pool.get(target.cardId);
  // v6.029：本 resolver 的 kind='attack-effect' 同樣只用於「放指示物型」備戰狙擊 → 對戰圓形應擋。
  const guard = canApplyEffectToTarget(s, aIdx, target, targetCard, kind, pool, { isBench: true, counterPlacement: true });
  if (guard.blocked) {
    return addLog(s, `✋ ${label}：${targetCard?.name ?? '?'} 受到 ${guard.reason} 保護, 不受影響`, aIdx);
  }
  // v5.270: guard 未觸發 — 確認套用前寫一條 audit log (讓玩家從 log 對帳)
  const applyDesc = kind === 'attack-effect' ? `放置 ${Math.round(amount / 10)} 個傷害指示物` : `造成 ${amount} 點傷害`;
  s = addLog(s, `🎯 ${label}：對 ${targetCard?.name ?? '?'} ${applyDesc} (guard 未觸發)`, aIdx);
  return updatePlayer(s, dIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === targetIid
      ? { ...b, damage: (b.damage ?? 0) + amount }
      : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// helper: I 自身受招後下回合受招式 -N（damageReduceNextHit 設於自身）
// （既有 effects.ts 的 selfDmgReducePost 同功能，這裡 inline 避免 cross-file export）
// ══════════════════════════════════════════════════════════════════════════════
function selfDmgReduceNextPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const p = { ...players[aIdx] };
    if (p.active) p.active = { ...p.active, damageReduceNextHit: n };
    players[aIdx] = p;
    return addLog({ ...state, players }, `${label}：自身下次受招式 -${n}`, aIdx);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: J 擲 N 次硬幣全正面 +K
// ══════════════════════════════════════════════════════════════════════════════
function coinAllHeadsPlusPre(base: number, coinCount: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const r = flipCoinsWithLog(state, coinCount, label, aIdx);
    const heads = r.heads;
    state = r.state;
    const allHeads = heads === coinCount;
    const dmg = base + (allHeads ? bonus : 0);
    const s = addLog(state, `${label}：擲 ${coinCount} 次 → ${heads} 正面 → ${allHeads ? `全正面 +${bonus}` : '未全正面'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// helper: K 自方場上條件（場上能量數 / 競技場 等）
// ══════════════════════════════════════════════════════════════════════════════
function selfFieldEnergyConditionPre(
  base: number,
  bonus: number,
  energyType: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal',
  threshold: number,
  label: string,
): AttackPreFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    const allOwn: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
    let count = 0;
    for (const pk of allOwn) {
      for (const e of pk.energyAttached) {
        if (energyMatchesType(pool.get(e.cardId), energyType)) count++;
      }
    }
    const cond = count >= threshold;
    const dmg = cond ? base + bonus : base;
    const s = addLog(state, `${label}：自方場上${energyType}能量 ${count} 個（門檻 ${threshold}）→ ${cond ? `+${bonus}` : '不增傷'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

function selfStadiumConditionPre(base: number, bonus: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    // v4.42：限定「自己的」競技場（卡面「自己的競技場卡」）
    // 既有 GameState.activeStadiumOwnerIdx 同步維護自 v2.x 的 stadium 機制
    const cond = !!state.activeStadium && state.activeStadiumOwnerIdx === aIdx;
    const dmg = cond ? base + bonus : base;
    const condDesc = !state.activeStadium ? '場上無競技場'
      : (state.activeStadiumOwnerIdx === aIdx ? '場上有自己的競技場' : '場上競技場是對手的');
    const s = addLog(state, `${label}：${condDesc} → ${cond ? `+${bonus}` : '不增傷'} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. A 擲幣 ×K 倍率（5 張）
// ══════════════════════════════════════════════════════════════════════════════
const COIN_MULTIPLY: Array<[string, number, number]> = [
  // [key, coinCount, perHead]
  ['大嘴雀|機關槍鑽', 5, 30],
  ['傘電蜥|雙重抓', 2, 10],
  ['豆蟋蟀|躍動', 3, 10],
  ['白海獅|摔打', 2, 70],
];
for (const [key, coins, per] of COIN_MULTIPLY) {
  const atkName = key.split('|')[1];
  regPre(key, coinFlipMultiplyPre(coins, per, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. B 自身能量 ×K（4 張）
// ══════════════════════════════════════════════════════════════════════════════
const SELF_ENERGY_COUNT: Array<[string, number, number, 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal']> = [
  // [key, base, perEnergy, energyType]
  ['椰蛋樹|木之重壓', 60, 30, 'Grass'],
  ['火紅不倒翁|火炎球', 10, 20, 'Fire'],
  ['達摩狒狒|火炎球', 40, 40, 'Fire'],
];
for (const [key, base, per, type] of SELF_ENERGY_COUNT) {
  const atkName = key.split('|')[1];
  regPre(key, selfEnergyCountPre(base, per, type, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. C 獎賞數條件 +N（4 張）
// ══════════════════════════════════════════════════════════════════════════════
// 蒼響|界限破壞 50+ — 「對手剩餘獎賞 ≤3」+90
regPre('蒼響|界限破壞', prizesConditionPre(50, 90, 'opp', 'lte', 3, 'remaining', '界限破壞'));
// 大鋼蛇|歡迎之尾 40+ — 「自己剩餘獎賞 = 6」+200
regPre('大鋼蛇|歡迎之尾', prizesConditionPre(40, 200, 'self', 'eq', 6, 'remaining', '歡迎之尾'));
// 捷克羅姆ex|電爆發 130+ — 「對手已獲得獎賞 × 50」+ 自身受 30
regPre('捷克羅姆ex|電爆發', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const taken = 6 - state.players[dIdx].prizes.length;
  const dmg = 130 + taken * 50;
  const s = addLog(state, `電爆發：對手已獲得獎賞 ${taken} 張 → 130 + ${taken}×50 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});
regPost('捷克羅姆ex|電爆發', (state, aIdx, _pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (p.active) p.active = { ...p.active, damage: (p.active.damage ?? 0) + 30 };
  players[aIdx] = p;
  return addLog({ ...state, players }, '電爆發：自身受到 30 點傷害', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. D 對手戰鬥場能量數 ×K（2 張）
// ══════════════════════════════════════════════════════════════════════════════
// 巨鍛匠|大橫掃 240 - 對手能量×60
regPre('巨鍛匠|大橫掃', oppActiveEnergyCountPre(240, 60, 'sub', '大橫掃'));

// ══════════════════════════════════════════════════════════════════════════════
// 5. E 對手戰鬥場傷害指示物 ×K（1 張）
// ══════════════════════════════════════════════════════════════════════════════
// 脫殼忍者|傷害律動 20× — 對手身上指示物 ×20
regPre('脫殼忍者|傷害律動', oppActiveDamageCountPre(20, '傷害律動'));

// ══════════════════════════════════════════════════════════════════════════════
// 6. F 狙擊單隻對手備戰（5 張）
// ══════════════════════════════════════════════════════════════════════════════
const SNIPE_ONE_BENCH: Array<[string, number, number]> = [
  // [key, baseDmg, snipeAmount]
  ['巨石丁|岩石踢', 20, 20],
  ['長耳兔|魯莽踢', 0, 50],
  ['雪暴馬|冰之射擊', 20, 20],
  ['赫普的蒼響ex|剎那斬', 30, 30],
  ['波皇子|瞄準俯衝', 0, 70],
];
for (const [key, base, snipe] of SNIPE_ONE_BENCH) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: base }));
  regPost(key, snipeOneBenchPost(snipe, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. G 對手所有備戰 +N（1 張）
// ══════════════════════════════════════════════════════════════════════════════
// N的雙倍多多冰|暴風雪 120 + 對手所有備戰 10
regPre('N的雙倍多多冰|暴風雪', (s) => ({ state: s, damage: 120 }));
regPost('N的雙倍多多冰|暴風雪', snipeAllOppBenchPost(10, '暴風雪'));

// ══════════════════════════════════════════════════════════════════════════════
// 8. H 雙方所有備戰 +N（1 張）
// ══════════════════════════════════════════════════════════════════════════════
// 臭臭花|灑口水 20 + 雙方所有備戰 20
regPre('臭臭花|灑口水', (s) => ({ state: s, damage: 20 }));
regPost('臭臭花|灑口水', snipeAllBothBenchPost(20, '灑口水'));

// ══════════════════════════════════════════════════════════════════════════════
// 9. I 自身下回合受招式 -N（8 張）
// ══════════════════════════════════════════════════════════════════════════════
const SELF_DMG_REDUCE_NEXT: Array<[string, number, number]> = [
  // [key, baseDmg, reduceN]
  ['超級暴雪王ex|冰霜屏障', 200, 30],
  ['大炭車|防守壓制', 20, 20],
  ['齒輪兒|堅硬齒輪', 10, 10],
  ['齒輪組|堅硬齒輪', 50, 20],
  ['赫普的鋼鎧鴉|鋼翼', 150, 60],
  ['甲殼龍|防守壓制', 30, 30],
  ['火箭隊的火焰鳥ex|火焰屏障', 110, 50],
  ['珍珠貝|硬殼壓制', 10, 10],
];
for (const [key, dmg, reduce] of SELF_DMG_REDUCE_NEXT) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, selfDmgReduceNextPost(reduce, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. J 擲幣全正面 +K（2 張）
// ══════════════════════════════════════════════════════════════════════════════
// 穿著熊|必殺金勾臂 100 + 擲 2 全正 +100
regPre('穿著熊|必殺金勾臂', coinAllHeadsPlusPre(100, 2, 100, '必殺金勾臂'));

// ══════════════════════════════════════════════════════════════════════════════
// 11. K 自方場上條件（雷公|電氣墜落、破破舵輪|大地能量）
// ══════════════════════════════════════════════════════════════════════════════
// 雷公|電氣墜落 30 + 自方場上【雷】能量 ≥4 → +90
regPre('雷公|電氣墜落', selfFieldEnergyConditionPre(30, 90, 'Lightning', 4, '電氣墜落'));
// 破破舵輪|大地能量 30 + 自己的競技場 +50
// v4.42：簡化版（任何競技場）→ 修正為僅限自己的競技場（JSON 原文「自己的競技場卡」）
regPre('破破舵輪|大地能量', selfStadiumConditionPre(30, 50, '大地能量'));

// ══════════════════════════════════════════════════════════════════════════════
// 統計：
//   A 擲幣 ×K：4 張
//   B 自身能量 ×K：3 張
//   C 獎賞條件：3 張（界限破壞/歡迎之尾/電爆發）
//   D 對手能量 ×K：1 張
//   E 對手指示物 ×K：1 張
//   F 狙擊單隻：5 張
//   G 對手全備戰 +N：1 張
//   H 雙方全備戰 +N：1 張
//   I 自身下回合 -N：8 張
//   J 擲幣全正面：1 張
//   K 自方場上條件：2 張
//   合計：30 張 I 標寶可夢招式批次實裝
// ══════════════════════════════════════════════════════════════════════════════

// 輔助：unused import 防護
export type _v2490Sentinel = PlayerState;
