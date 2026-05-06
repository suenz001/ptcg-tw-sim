/**
 * v2.77 H/I/J 標殘餘清理（6 張）
 *
 * 之前 Wave audit 因字符邊界誤報、或當波未實裝的殘餘卡。
 * G 標卡片不在本波範圍。
 */

import {
  regPre, regPost, addLog, updatePlayer,
} from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { flipCoinsWithLog } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// helper
// ══════════════════════════════════════════════════════════════════════════════
function selfHitPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => updatePlayer(addLog(state, `${label}：自身受 ${amount}`, aIdx), aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + amount } : null,
  }));
}

function selfDiscardAllEnergyPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    return updatePlayer(addLog(state, `${label}：棄全能量`, aIdx), aIdx, p => {
      if (!p.active) return p;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...p.active.energyAttached] };
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// === H 標殘餘 (1 張) ===
// ══════════════════════════════════════════════════════════════════════════════
// 厄鬼椪 碧草面具ex|萬葉陣雨 30+ — 增加雙方戰鬥寶可夢身上附加能量數量 ×30
//   (Wave 2 audit 因字符邊界誤報，這裡確認註冊)
regPre('厄鬼椪 碧草面具ex|萬葉陣雨', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const d = state.players[(1-aIdx) as 0|1].active;
  const total = (a?.energyAttached.length ?? 0) + (d?.energyAttached.length ?? 0);
  return { state: addLog(state, `萬葉陣雨：雙方戰鬥能量 ${total} → 30+${total}×30 = ${30 + total*30}`, aIdx), damage: 30 + total*30 };
});

// 纏紅鶴ex|[ex規則] — scraper artifact（攻擊欄位錯誤地放了 ex 卡昏厥獎賞規則）
//   不實裝（不是真正的招式）

// ══════════════════════════════════════════════════════════════════════════════
// === I 標殘餘 (4 張) ===
// ══════════════════════════════════════════════════════════════════════════════
// 超級雷電獸ex|狂暴噴射 200+ — 若希望棄全能量 +130
regPre('超級雷電獸ex|狂暴噴射', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  if (!a || a.energyAttached.length === 0) return { state, damage: 200 };
  return { state: addLog(state, '狂暴噴射：棄全能量 → 200+130 = 330', aIdx), damage: 330 };
});
regPost('超級雷電獸ex|狂暴噴射', (state, aIdx, _pool) => {
  return selfDiscardAllEnergyPost('狂暴噴射')(state, aIdx, new Map());
});

// 小霞的暴鯉龍|嘩啦嘩啦恐慌 70× — 牌庫頂 7 棄，「小霞的寶可夢」張數 ×70
regPre('小霞的暴鯉龍|嘩啦嘩啦恐慌', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  const top = p.deck.slice(0, 7);
  let count = 0;
  for (const c of top) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Pokemon' && card.name?.startsWith('小霞的')) count++;
  }
  return { state: addLog(state, `嘩啦嘩啦恐慌：牌庫頂 7 中小霞的 ${count} → ${count*70}`, aIdx), damage: count * 70 };
});
regPost('小霞的暴鯉龍|嘩啦嘩啦恐慌', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => {
    const k = Math.min(7, p.deck.length);
    return { ...p, deck: p.deck.slice(k), discard: [...p.discard, ...p.deck.slice(0, k)] };
  });
});

// 吃吼霸ex|極限俯衝 120+ — 若希望 +120 + 自殘 50
//   簡化：自動使用「希望」(預設 240 damage + 自殘 50)
regPre('吃吼霸ex|極限俯衝', (s) => ({ state: s, damage: 240 }));
regPost('吃吼霸ex|極限俯衝', selfHitPost(50, '極限俯衝'));

// 佛烈托斯|鐵之震動 20 — 自方場上鋼能量任意改附自方寶可夢
//   [TODO engine] 自由分配 UI 暫無，記 log 提示玩家手動執行
regPre('佛烈托斯|鐵之震動', (s) => ({ state: s, damage: 20 }));
regPost('佛烈托斯|鐵之震動', (state, aIdx, _pool) => {
  return addLog(state, '鐵之震動：[卡面]自方場上鋼能量任意改附自方寶可夢（請玩家手動移動）', aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// === J 標殘餘 (1 張) ===
// ══════════════════════════════════════════════════════════════════════════════
// 超能妙喵|戲法舞步 80 — 若希望，對手戰鬥 1 個能量改附對手備戰
regPre('超能妙喵|戲法舞步', (s) => ({ state: s, damage: 80 }));
regPost('超能妙喵|戲法舞步', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  if (!opp.active || opp.active.energyAttached.length === 0 || opp.bench.length === 0) return state;
  const last = opp.active.energyAttached[opp.active.energyAttached.length - 1];
  const benchIdx = Math.floor(Math.random() * opp.bench.length);
  return updatePlayer(addLog(state, '戲法舞步：對手戰鬥末尾 1 個能量改附對手備戰（隨機）', aIdx), dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) } : null,
    bench: p.bench.map((b, i) => i === benchIdx ? { ...b, energyAttached: [...b.energyAttached, last] } : b),
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 統計：H(1 漏網) + I(4 漏網) + J(1 漏網) = 6 張
// ══════════════════════════════════════════════════════════════════════════════
