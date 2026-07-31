/**
 * v2.51 I 標 Wave 3c — 擲幣狀態 + 進化來源條件 + 自身指示物 + 自殘 批次實裝
 *
 *   A. 擲幣狀態（7 張）— 復用 effects.ts 既有 coinStatusPost
 *   B. 進化來源條件 +N（2 張）
 *   C. 自身傷害指示物相關（3 張）
 *   D. 自殘類（1 張）
 *
 * 共 13 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import {
  regPre, regPost,
  addLog, updatePlayer,
} from '../_shared';
import type { AttackPostFn } from '../_shared';
import { coinStatusPost, flipCoinsWithLog } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 1. A 擲幣狀態（7 張）— 純擲幣狀態類，復用 coinStatusPost
// ══════════════════════════════════════════════════════════════════════════════
const COIN_STATUS_ATTACKS: Array<[string, number, 'poisoned'|'burned'|'asleep'|'confused'|'paralyzed']> = [
  ['多多冰|冰凍光束', 50, 'paralyzed'],
  ['單首龍|泰山壓頂', 20, 'paralyzed'],
  ['麻麻鰻魚王|雷電牙', 60, 'paralyzed'],
  ['火箭隊的茸茸羊|電擊', 50, 'paralyzed'],
  ['火箭隊的阿柏蛇|扯後腿', 0, 'paralyzed'],
  ['魔牆人偶|念力', 40, 'paralyzed'],
  ['小霞的海星星|泡沫光線', 20, 'paralyzed'],
];
for (const [key, dmg, status] of COIN_STATUS_ATTACKS) {
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, coinStatusPost(status));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. B 進化來源條件 +N（2 張）— 「在這個回合，若這隻寶可夢從 X 進化，則 +N」
// ══════════════════════════════════════════════════════════════════════════════
// 自爆磁怪|衝天電光 50+ — 從「三合一磁怪」進化 +120
regPre('自爆磁怪|衝天電光', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 50 };
  // evolvedFromStack 含此回合進化的來源卡，檢查是否包含「三合一磁怪」
  const evolvedThisTurn = a.evolvedThisTurn === true;
  // v6.061 修正：原本還 OR 了 `pool.get(a.cardId)?.evolvesFrom === '三合一磁怪'`，
  //   但那是自爆磁怪**自己卡面**的「進化自」，恆等於 '三合一磁怪' → 整個條件退化成只看
  //   evolvedThisTurn。用【神奇糖果】從小磁怪直接進化成自爆磁怪（Stage2 跳級）時，
  //   卡面「若這隻寶可夢從『三合一磁怪』進化」並不成立，卻仍誤加 120。
  //   判準只能看**實際的進化來源**（evolvedFromStack 末端），與同檔 小霞的寶石海星｜乍然閃光 一致。
  // 用 evolvedFromStack 的最後 1 張（最近進化來源）
  const stack = a.evolvedFromStack ?? [];
  const lastEvoSource = stack.length > 0 ? pool.get(stack[stack.length - 1].cardId)?.name : null;
  const fromMagneton = evolvedThisTurn && lastEvoSource === '三合一磁怪';
  const dmg = fromMagneton ? 50 + 120 : 50;
  const s = addLog(state, `衝天電光：${fromMagneton ? '從三合一磁怪進化 +120' : '本回合非從三合一磁怪進化'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 小霞的寶石海星|乍然閃光 60+ — 從「小霞的海星星」進化 +80
regPre('小霞的寶石海星|乍然閃光', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 60 };
  const evolvedThisTurn = a.evolvedThisTurn === true;
  const stack = a.evolvedFromStack ?? [];
  const lastEvoSource = stack.length > 0 ? pool.get(stack[stack.length - 1].cardId)?.name : null;
  const fromKasumi = evolvedThisTurn && lastEvoSource === '小霞的海星星';
  const dmg = fromKasumi ? 60 + 80 : 60;
  const s = addLog(state, `乍然閃光：${fromKasumi ? '從小霞的海星星進化 +80' : '本回合非從小霞的海星星進化'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. C 自身傷害指示物相關（3 張）
// ══════════════════════════════════════════════════════════════════════════════
// 吃吼霸ex|駭浪反攻 30+ — 自身指示物 ×10 增傷
regPre('吃吼霸ex|駭浪反攻', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const counters = a ? Math.floor((a.damage ?? 0) / 10) : 0;
  const dmg = 30 + counters * 10;
  const s = addLog(state, `駭浪反攻：自身 ${counters} 個指示物 → 30 + ${counters}×10 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 派帕的獒教父ex|幹勁衝撞 30+ — 自身無指示物 +120
regPre('派帕的獒教父ex|幹勁衝撞', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const cond = !!a && (a.damage ?? 0) === 0;
  const dmg = 30 + (cond ? 120 : 0);
  const s = addLog(state, `幹勁衝撞：自身${cond ? '無指示物 +120' : `有 ${Math.floor((a?.damage ?? 0) / 10)} 個指示物，不增傷`} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 鐵炮魚|抓狂 10× — 自身指示物 ×10
regPre('鐵炮魚|抓狂', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const counters = a ? Math.floor((a.damage ?? 0) / 10) : 0;
  const dmg = counters * 10;
  const s = addLog(state, `抓狂：自身 ${counters} 個指示物 → ${counters}×10 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. D 自殘類（1 張）
// ══════════════════════════════════════════════════════════════════════════════
// 火箭隊的拉達|顧前不顧後 90 — 擲 2 次硬幣，全反面則自身受 90
regPre('火箭隊的拉達|顧前不顧後', (s) => ({ state: s, damage: 90 }));
regPost('火箭隊的拉達|顧前不顧後', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 2, '顧前不顧後', aIdx);
  const allTails = r.heads === 0;
  let s = addLog(r.state, `顧前不顧後：擲 2 次硬幣 → ${r.heads} 正面`, aIdx);
  if (!allTails) return s;
  s = addLog(s, '顧前不顧後：全反面 → 自身受到 90 點傷害', aIdx);
  return updatePlayer(s, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + 90 } : null,
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 統計：A:7 + B:2 + C:3 + D:1 = 13 張 I 標寶可夢招式批次實裝
// ══════════════════════════════════════════════════════════════════════════════

// 輔助：unused import 防護
export type _v2510Sentinel = PlayerState;
type _CIT = CardInstance;
type _APT = AttackPostFn;
