/**
 * v2.77 H/I/J 標殘餘清理（6 張）
 *
 * 之前 Wave audit 因字符邊界誤報、或當波未實裝的殘餘卡。
 * G 標卡片不在本波範圍。
 */

import {
  regPre, regPost, regR, addLog, updatePlayer, withPending,
  ATTACK_PRE_DISCARD_CHOICE,
} from '../_shared';
import { joinCardNames } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { flipCoinsWithLog, selfHitPost, energyProvidesType, trickStepPost } from '../../effects'; // v5.682 host-aware；v5.717 戲法舞步收斂

// ══════════════════════════════════════════════════════════════════════════════
// helper
// ══════════════════════════════════════════════════════════════════════════════
// v4.963: 基本能量 pokemonType=null fallback helper — 認屬性能量含 name【X】 fallback。
function isEnergyOfType(ec: any, type: string): boolean {
  if (!ec || ec.supertype !== 'Energy') return false;
  if (ec.pokemonType === type) return true;
  const m = (ec.name || '').match(/【(.+?)】/);
  if (!m) return false;
  const zh: Record<string, string> = { '草':'Grass','火':'Fire','水':'Water','雷':'Lightning','超':'Psychic','鬥':'Fighting','惡':'Darkness','鋼':'Metal','妖':'Fairy','龍':'Dragon','無':'Colorless' };
  return zh[m[1]] === type;
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
// v5.671：萬葉陣雨重複註冊清理 — 統一由 effects.ts bothActiveEnergyMultiplyPre 實作;此 raw-length 死碼移除。

// 纏紅鶴ex|[ex規則] — scraper artifact（攻擊欄位錯誤地放了 ex 卡昏厥獎賞規則）
//   不實裝（不是真正的招式）

// ══════════════════════════════════════════════════════════════════════════════
// === I 標殘餘 (4 張) ===
// ══════════════════════════════════════════════════════════════════════════════
// 超級雷電獸ex|狂暴噴射 200+ — 卡面：「若希望，將這隻寶可夢身上附加的能量卡全部丟棄，增加130點傷害。」
//   v3.26 修：原實裝強制棄全能量 + 強制 +130，違反卡面「若希望」。
//   借殼 binary-yes-no scope（v2.255 蚊香泳士|跳躍衝天 pattern）：玩家開招前選 yes/no。
//   - 選「否」 → 200 傷害，不棄能量
//   - 選「是」 → 330 傷害 + POST 棄全能量
//   AI fallback（chosenIids === undefined）→ 預設選「是」最大化攻擊。
ATTACK_PRE_DISCARD_CHOICE.set('超級雷電獸ex|狂暴噴射', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 200, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢身上附加的能量全部丟棄，增加 130 點傷害？',
  choiceYesLabel: '是（+130 傷害 + 棄全能量）',
  choiceNoLabel: '否（保留能量）',
});
regPre('超級雷電獸ex|狂暴噴射', (state, aIdx, _pool, action) => {
  const a = state.players[aIdx].active;
  const chosenIids = action?.discardedEnergyIids;
  // length>=1 = yes（玩家選了 +130）、length=0 = no
  // AI fallback（chosenIids === undefined）→ 預設 yes 最大化攻擊
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes || !a || a.energyAttached.length === 0) {
    return { state: addLog(state, '狂暴噴射：選「否」 → 200 傷害（不棄能量）', aIdx), damage: 200 };
  }
  return { state: addLog(state, '狂暴噴射：選「是」 → 200+130 = 330（POST 會棄全能量）', aIdx), damage: 330 };
});
regPost('超級雷電獸ex|狂暴噴射', (state, aIdx, _pool, action) => {
  // 同步 PRE 的 yes/no 選擇：只有選「是」才棄全能量
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;
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
regPost('小霞的暴鯉龍|嘩啦嘩啦恐慌', (state, aIdx, pool) => {
  const k = Math.min(7, state.players[aIdx].deck.length);
  const top = state.players[aIdx].deck.slice(0, k);
  return updatePlayer(addLog(state, `嘩啦嘩啦恐慌：自己牌庫頂 ${k} 張丟入棄牌區：${joinCardNames(top, pool)}`, aIdx), aIdx, p => ({
    ...p, deck: p.deck.slice(k), discard: [...p.discard, ...top],
  }));
});

// 吃吼霸ex|極限俯衝 120+ — 若希望 +120 + 自殘 50
//   v5.060：補 binary-yes-no 玩家抉擇（範本：蚊香泳士|跳躍衝天）
//   卡面：「若希望，增加120點傷害。這個情況下，這隻寶可夢也受到50點傷害。」
//   Yes → 240 damage + 自殘 50；No → 120 base 不自殘
//   玩家點名 bug：原強制使用「希望」沒給選擇權。
ATTACK_PRE_DISCARD_CHOICE.set('吃吼霸ex|極限俯衝', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 120, damagePerEnergy: 0,  // damagePerEnergy 不適用 binary-yes-no（僅 placeholder）
  choicePrompt: '是否增加 120 點傷害？這個情況下，這隻寶可夢也受到 50 點傷害。',
  choiceYesLabel: '是（+120 傷害 / 自殘 50）',
  choiceNoLabel: '否（僅 120 傷害 / 不自殘）',
});
regPre('吃吼霸ex|極限俯衝', (state, aIdx, _pool, action) => {
  const chosenIids = action?.discardedEnergyIids;
  // length>=1 = yes（+120），length=0 = no
  // AI fallback（chosenIids === undefined）→ 預設 yes 最大化攻擊
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return { state: addLog(state, '極限俯衝：選擇「否」 → 120 base 不自殘', aIdx), damage: 120 };
  return { state: addLog(state, '極限俯衝：選擇「是」 → 240 傷害 + 自殘 50', aIdx), damage: 240 };
});
regPost('吃吼霸ex|極限俯衝', (state, aIdx, pool, action) => {
  // 同步 PRE 的 yes/no — 只有 yes 才自殘
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) return state;
  return selfHitPost(50, '極限俯衝')(state, aIdx, pool);
});

// 佛烈托斯|鐵之震動 20 — 自方場上鋼能量任意改附自方寶可夢
//   v2.79 用 damage-distribute 風格 picker（玩家點選目標寶可夢分配次數 = 能量數）
//   流程：先收集所有自方場上鋼能量為一個 list，然後讓玩家點選 N 次目標寶可夢，
//   每次點擊代表分配 1 個能量。Resolver 把所有 source 能量拆下、依玩家點擊順序附給目標。
regPre('佛烈托斯|鐵之震動', (s) => ({ state: s, damage: 20 }));
regPost('佛烈托斯|鐵之震動', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  // 收集所有自方場上鋼能量
  const sourceEnergies: Array<{ energyIid: string; sourceIid: string }> = [];
  if (player.active) {
    for (const e of player.active.energyAttached) {
      // v5.682：host-aware → 古舊/稜鏡(Basic)等「視為鋼」的特殊能量也算可改附來源
      if (energyProvidesType(player.active, e, 'Metal', pool)) {
        sourceEnergies.push({ energyIid: e.iid, sourceIid: player.active.iid });
      }
    }
  }
  for (const b of player.bench) {
    for (const e of b.energyAttached) {
      if (energyProvidesType(b, e, 'Metal', pool)) {
        sourceEnergies.push({ energyIid: e.iid, sourceIid: b.iid });
      }
    }
  }
  if (sourceEnergies.length === 0) return addLog(state, '鐵之震動：自方場上無【鋼】能量', aIdx);
  const totalCount = sourceEnergies.length;
  return withPending(addLog(state, `鐵之震動：點選自方寶可夢 ${totalCount} 次，分配 ${totalCount} 張鋼能量`, aIdx), {
    type: 'damage-distribute',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: totalCount, maxCount: totalCount,
    effectKey: 'h-energy-redistribute',
    params: {
      sourceEnergies,
      target: 'self',
      // v5.712：卡面「以任意方式改附於自己的寶可夢身上」含戰鬥位 → includeActive（原漏 → picker 只列備戰，
      //   從戰鬥位拆下的【鋼】能量無法再附回戰鬥位）。resolver 早已支援 active 目標(distMap.has(newActive.iid))。
      includeActive: true,
      titleOverride: `鐵之震動：分配 ${totalCount} 張【鋼】能量（點目標寶可夢，每點一次 = 1 個能量）`,
    },
  });
});

regR('h-energy-redistribute', (state, aIdx, iids, params, _pool) => {
  const sourceEnergies = (params?.sourceEnergies as Array<{ energyIid: string; sourceIid: string }> | undefined) ?? [];
  if (sourceEnergies.length === 0 || iids.length === 0) return state;
  return updatePlayer(addLog(state, `鐵之震動：分配 ${iids.length} 張鋼能量到自方寶可夢`, aIdx), aIdx, p => {
    const energyIidSet = new Set(sourceEnergies.map(s => s.energyIid));
    // 1) 拆下所有 source 能量
    const collectedEnergies: CardInstance[] = [];
    let newActive = p.active;
    if (newActive) {
      collectedEnergies.push(...newActive.energyAttached.filter(e => energyIidSet.has(e.iid)));
      newActive = { ...newActive, energyAttached: newActive.energyAttached.filter(e => !energyIidSet.has(e.iid)) };
    }
    let newBench = p.bench.map(b => {
      const removed = b.energyAttached.filter(e => energyIidSet.has(e.iid));
      collectedEnergies.push(...removed);
      return { ...b, energyAttached: b.energyAttached.filter(e => !energyIidSet.has(e.iid)) };
    });
    // 2) 按 iids 順序分配
    const distMap = new Map<string, CardInstance[]>();
    for (let i = 0; i < iids.length && i < collectedEnergies.length; i++) {
      if (!distMap.has(iids[i])) distMap.set(iids[i], []);
      distMap.get(iids[i])!.push(collectedEnergies[i]);
    }
    // 3) 附加到目標
    if (newActive && distMap.has(newActive.iid)) {
      newActive = { ...newActive, energyAttached: [...newActive.energyAttached, ...distMap.get(newActive.iid)!] };
    }
    newBench = newBench.map(b => {
      if (distMap.has(b.iid)) {
        return { ...b, energyAttached: [...b.energyAttached, ...distMap.get(b.iid)!] };
      }
      return b;
    });
    return { ...p, active: newActive, bench: newBench };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// === J 標殘餘 (1 張) ===
// ══════════════════════════════════════════════════════════════════════════════
// 超能妙喵|戲法舞步 80 — 若希望，對手戰鬥 1 個能量改附對手備戰
regPre('超能妙喵|戲法舞步', (s) => ({ state: s, damage: 80 }));
regPost('超能妙喵|戲法舞步', trickStepPost());

// ══════════════════════════════════════════════════════════════════════════════
// 統計：H(1 漏網) + I(4 漏網) + J(1 漏網) = 6 張
// ══════════════════════════════════════════════════════════════════════════════
