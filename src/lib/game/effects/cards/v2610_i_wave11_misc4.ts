/**
 * v2.61 I 標 Wave 11 — 第四批雜項
 *
 *   A. 擲幣正面 immune (5 張)
 *   B. 擲幣反面失敗 (2 張)
 *   C. 擲 N 次硬幣 +K×N (2 張)
 *   D. 自身能量回手 (2 張)
 *   E. 對手所有寶可夢/備戰各 N 傷 (2 張)
 *   F. 對手有指示物的備戰打 N (1 張)
 *   G. 從棄牌區挑能量附 (2 張)
 *   H. 從牌庫挑 1 鬥能量附自方 (1 張)
 *   I. 自身回手牌 (2 張)
 *   J. 棄牌區火箭隊支援者數 ×K (2 張)
 *   K. 場上寶可夢道具數 ×K (3 張)
 *   L. 「輪唱」家族 (3 張)
 *   M. 對手特殊狀態數 ×K (1 張)
 *   N. 自身水能量 ×30（簡化）(1 張)
 *   O. 自方所有寶可夢回 N (1 張)
 *   P. 對手戰鬥場中毒倍率（中毒每回合放 8 個）(1 張)
 *   Q. 不計對手附加效果 (1 張)
 *   R. 對手備戰數 ×K (1 張)
 *
 * 共 ~32 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import { regPre, regPost, addLog, updatePlayer, withPending, regR } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// helper: 擲幣正面 → 自身下回合 immune
// ══════════════════════════════════════════════════════════════════════════════
function coinHeadsSelfImmunePost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    let s = addLog(state, `${label}：擲 1 次硬幣 → ${heads ? '正面' : '反面'}`, aIdx);
    if (!heads) return s;
    return updatePlayer(
      addLog(s, `${label}：正面 → 自身下回合免疫招式傷害`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damageReduceNextHit: 9999 } : null,
      }),
    );
  };
}

// helper: 擲幣反面失敗
function coinTailsFailPre(base: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const heads = Math.random() < 0.5;
    if (!heads) return { state: addLog(state, `${label}：反面 → 招式失敗`, aIdx), damage: 0 };
    return { state: addLog(state, `${label}：正面 → ${base} 傷害`, aIdx), damage: base };
  };
}

// helper: 擲 N 次硬幣，正面數 ×K + base
function coinFlipPlusMultiPre(base: number, coinCount: number, perHead: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    let heads = 0;
    for (let i = 0; i < coinCount; i++) if (Math.random() < 0.5) heads++;
    const dmg = base + heads * perHead;
    const s = addLog(state, `${label}：擲 ${coinCount} 次 → ${heads} 正面 → ${base} + ${heads}×${perHead} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}

// helper: 自身棄 N 個指定屬性能量回手
function selfReturnNTypeEnergyToHandPost(
  n: number,
  energyType: 'Grass'|'Fire'|'Water'|'Lightning'|'Psychic'|'Fighting'|'Darkness'|'Metal'|'any',
  label: string,
): AttackPostFn {
  return (state, aIdx, pool) => {
    const a = state.players[aIdx].active;
    if (!a || a.energyAttached.length === 0) return state;
    let returnedCount = 0;
    const newEnergies: CardInstance[] = [];
    const returned: CardInstance[] = [];
    for (let i = a.energyAttached.length - 1; i >= 0; i--) {
      const e = a.energyAttached[i];
      const card = pool.get(e.cardId);
      if (returnedCount < n && (energyType === 'any' || card?.pokemonType === energyType)) {
        returned.unshift(e);
        returnedCount++;
      } else {
        newEnergies.unshift(e);
      }
    }
    if (returned.length === 0) return addLog(state, `${label}：無對應能量可回手`, aIdx);
    return updatePlayer(
      addLog(state, `${label}：將 ${returned.length} 張能量從自身放回手牌`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, energyAttached: newEnergies } : null,
        hand: [...p.hand, ...returned],
      }),
    );
  };
}

// helper: 對手所有備戰各受到 N
function snipeAllOppBenchPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    return updatePlayer(
      addLog(state, `${label}：對手所有備戰寶可夢各受到 ${amount} 點傷害`, aIdx),
      dIdx, p => ({
        ...p,
        bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) + amount })),
      }),
    );
  };
}

// 對手所有寶可夢（active+bench）各受到 N
function snipeAllOppPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    return updatePlayer(
      addLog(state, `${label}：對手所有寶可夢各受到 ${amount} 點傷害`, aIdx),
      dIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + amount } : null,
        bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) + amount })),
      }),
    );
  };
}

// helper: 自身回手牌
function selfReturnToHandPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(
      addLog(state, `${label}：自身連附加卡放回手牌（寶可夢以外的卡丟棄）`, aIdx),
      aIdx, p => {
        if (!p.active) return p;
        const a = p.active;
        // Pokémon card 本體回手
        const newHand: CardInstance[] = [...p.hand, {
          ...a, damage: 0, energyAttached: [], toolAttached: undefined,
          status: undefined, secondaryStatus: undefined,
          evolvedFromStack: undefined, evolvedThisTurn: undefined,
          justPlaced: undefined, playedFromHand: undefined, movedToActiveThisTurn: undefined,
          damageBonusThisTurn: undefined, damageReduceNextHit: undefined,
          abilityUsedThisTurn: undefined, cantAttackThisTurn: undefined, cantAttackPending: undefined,
          cantRetreatNextTurn: undefined, cantRetreatPendingSelf: undefined,
          damageBonusPending: undefined, takeExtraDamageThisTurn: undefined, takeExtraDamageNextTurn: undefined,
          blockedAttackNamesNextTurn: undefined,
        }];
        // Energy/Tool/Stack 進棄牌區
        const discarded = [
          ...a.energyAttached,
          ...(a.toolAttached ? [a.toolAttached] : []),
          ...(a.evolvedFromStack ?? []),
        ];
        return { ...p, active: null, hand: newHand, discard: [...p.discard, ...discarded] };
      },
    );
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// A. 擲幣正面 immune (5 張)
// ══════════════════════════════════════════════════════════════════════════════
const COIN_IMMUNE: Array<[string, number]> = [
  // [key, baseDmg]
  ['咕咕鴿|飛翔', 0],  // 卡面：擲 1 反面則失敗，正面則 immune；簡化：合併到 immune helper（先不嚴格做失敗）
  ['高傲雉雞|高速飛翔', 120],
  ['大力鱷|深處潛水', 140],
  ['戽斗尖梭|潛水', 60],
  ['百合根娃娃|躲藏', 0],
];
for (const [key, dmg] of COIN_IMMUNE) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, coinHeadsSelfImmunePost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// B. 擲幣反面失敗 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的尼多蘭|偷襲', coinTailsFailPre(30, '偷襲'));
regPre('猴怪|踹', coinTailsFailPre(30, '踹'));

// ══════════════════════════════════════════════════════════════════════════════
// C. 擲 N 次硬幣 +K×N (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('修建老匠|暴動', coinFlipPlusMultiPre(100, 2, 50, '暴動'));
regPre('始祖小鳥|雜技', coinFlipPlusMultiPre(30, 2, 30, '雜技'));

// ══════════════════════════════════════════════════════════════════════════════
// D. 自身能量回手 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('波爾凱尼恩|逆火', (s) => ({ state: s, damage: 130 }));
regPost('波爾凱尼恩|逆火', selfReturnNTypeEnergyToHandPost(2, 'Fire', '逆火'));

regPre('裹蜜蟲|能量閉環', (s) => ({ state: s, damage: 50 }));
regPost('裹蜜蟲|能量閉環', selfReturnNTypeEnergyToHandPost(1, 'any', '能量閉環'));

// ══════════════════════════════════════════════════════════════════════════════
// E. 對手所有寶可夢/備戰各 N 傷 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('暴飛龍ex|廣域爆破', (s) => ({ state: s, damage: 0 }));
regPost('暴飛龍ex|廣域爆破', snipeAllOppBenchPost(50, '廣域爆破'));

regPre('火箭隊的阿柏怪|旋轉之尾', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的阿柏怪|旋轉之尾', snipeAllOppPost(30, '旋轉之尾'));

// ══════════════════════════════════════════════════════════════════════════════
// F. 對手有指示物的備戰打 N (1 張)
// 龍頭地鼠ex|貫通鑽 60 + 對手有指示物的 1 隻備戰 60
// ══════════════════════════════════════════════════════════════════════════════
regPre('龍頭地鼠ex|貫通鑽', (s) => ({ state: s, damage: 60 }));
regPost('龍頭地鼠ex|貫通鑽', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const wounded = opp.bench.filter(b => (b.damage ?? 0) > 0);
  if (wounded.length === 0) return addLog(state, '貫通鑽：對手備戰區無受傷寶可夢', aIdx);
  // 自動選第一個受傷的
  const target = wounded[0];
  return updatePlayer(
    addLog(state, `貫通鑽：對手備戰受傷寶可夢受到 60 點傷害`, aIdx),
    dIdx, p => ({
      ...p,
      bench: p.bench.map(b => b.iid === target.iid ? { ...b, damage: (b.damage ?? 0) + 60 } : b),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// G. 從棄牌區挑能量附 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
// 雷吉洛克ex|雷吉充能 — 從棄牌區挑 ≤2 基本鬥能量附自身
regPre('雷吉洛克ex|雷吉充能', (s) => ({ state: s, damage: 0 }));
regPost('雷吉洛克ex|雷吉充能', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const fightInDiscard = player.discard.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.pokemonType === 'Fighting' || /【鬥】/.test(card.name));
  });
  if (fightInDiscard.length === 0) return addLog(state, '雷吉充能：棄牌區無基本【鬥】能量', aIdx);
  // 自動取前 2 張附自身
  const toAttach = fightInDiscard.slice(-Math.min(2, fightInDiscard.length));
  const toAttachIids = new Set(toAttach.map(c => c.iid));
  return updatePlayer(
    addLog(state, `雷吉充能：從棄牌區挑 ${toAttach.length} 張基本【鬥】能量附自身`, aIdx),
    aIdx, p => ({
      ...p,
      discard: p.discard.filter(c => !toAttachIids.has(c.iid)),
      active: p.active ? {
        ...p.active,
        energyAttached: [...p.active.energyAttached, ...toAttach],
      } : null,
    }),
  );
});

// 土地雲|豐產 — 從棄牌區挑 1 基本鬥能量附自身
regPre('土地雲|豐產', (s) => ({ state: s, damage: 0 }));
regPost('土地雲|豐產', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const fightIdx = player.discard.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.pokemonType === 'Fighting' || /【鬥】/.test(card.name));
  });
  if (fightIdx < 0) return addLog(state, '豐產：棄牌區無基本【鬥】能量', aIdx);
  const energy = player.discard[fightIdx];
  return updatePlayer(
    addLog(state, '豐產：從棄牌區挑 1 張基本【鬥】能量附自身', aIdx),
    aIdx, p => ({
      ...p,
      discard: p.discard.filter((_, i) => i !== fightIdx),
      active: p.active ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] } : null,
    }),
  );
});

// 土地雲|地震 110 + 自方備戰各 10
regPre('土地雲|地震', (s) => ({ state: s, damage: 110 }));
regPost('土地雲|地震', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '地震：自方備戰寶可夢各受到 10 點傷害', aIdx),
    aIdx, p => ({
      ...p,
      bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) + 10 })),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// H. 從牌庫挑 1 鬥能量附自方 (1 張)
// 厄鬼椪 礎石面具|石之神樂 — 從牌庫挑 1 基本鬥能量附自方寶可夢
// ══════════════════════════════════════════════════════════════════════════════
// v3.13 修 B6：原本「自動附給自身」，違反卡面「附於自己的寶可夢身上（玩家選目標）」。
//   參考 v2630 同家族 草/火/水之神樂 helper，改用 heal-target picker 讓玩家選目標。
//   階段 1：找出 1 張基本【鬥】能量；階段 2：heal-target picker 選自方任一寶可夢；
//   resolver 把該能量從牌庫移到目標身上並重洗。
regPre('厄鬼椪 礎石面具|石之神樂', (s) => ({ state: s, damage: 0 }));
regPost('厄鬼椪 礎石面具|石之神樂', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const fightCard = player.deck.find(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card.subtype === 'Basic'
      && (card.pokemonType === 'Fighting' || /【鬥】/.test(card.name));
  });
  if (!fightCard) {
    // 牌庫無 → 重洗
    function _shuffle<T>(arr: T[]): T[] {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    return updatePlayer(
      addLog(state, '石之神樂：牌庫中無基本【鬥】能量；重洗牌庫', aIdx),
      aIdx, p => ({ ...p, deck: _shuffle(p.deck) }),
    );
  }
  // 玩家選自方寶可夢目標（active + bench 都允許）
  return withPending(
    addLog(state, '石之神樂：從牌庫挑 1 基本【鬥】能量；選擇要附給哪一隻寶可夢', aIdx),
    {
      type: 'heal-target',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 1, maxCount: 1,
      effectKey: 'v313-stone-kagura-attach',
      params: { energyIid: fightCard.iid, label: '石之神樂' },
    },
  );
});

// v3.13 resolver: 把選中的能量附於玩家挑的目標寶可夢，並重洗牌庫
regR('v313-stone-kagura-attach', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const energyIid = params?.energyIid as string | undefined;
  const label = (params?.label as string | undefined) ?? '石之神樂';
  if (!energyIid) return state;
  const targetIid = iids[0];
  function _shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  return updatePlayer(
    addLog(state, `${label}：將能量附給選定的寶可夢；重洗牌庫`, aIdx),
    aIdx, p => {
      const energy = p.deck.find(c => c.iid === energyIid);
      if (!energy) return p;
      const newDeck = _shuffle(p.deck.filter(c => c.iid !== energyIid));
      const newActive = p.active && p.active.iid === targetIid
        ? { ...p.active, energyAttached: [...p.active.energyAttached, energy] }
        : p.active;
      const newBench = p.bench.map(b => b.iid === targetIid
        ? { ...b, energyAttached: [...b.energyAttached, energy] }
        : b);
      return { ...p, deck: newDeck, active: newActive, bench: newBench };
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// I. 自身回手牌 (2 張)
// ══════════════════════════════════════════════════════════════════════════════
regPre('莉莉艾的花療環環|憑空消失', (s) => ({ state: s, damage: 30 }));
regPost('莉莉艾的花療環環|憑空消失', selfReturnToHandPost('憑空消失'));

regPre('隨風球|氣球迴旋', (s) => ({ state: s, damage: 110 }));
regPost('隨風球|氣球迴旋', selfReturnToHandPost('氣球迴旋'));

// ══════════════════════════════════════════════════════════════════════════════
// J. 棄牌區火箭隊支援者數 ×K (2 張)
// ══════════════════════════════════════════════════════════════════════════════
function rocketSupporterCountInDiscardPre(perCard: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    let count = 0;
    for (const c of player.discard) {
      const card = pool.get(c.cardId);
      if (card?.supertype === 'Trainer' && card.subtype === 'Supporter'
          && card.name.includes('火箭隊')) {
        count++;
      }
    }
    const dmg = count * perCard;
    const s = addLog(state, `${label}：棄牌區「火箭隊」支援者 ${count} 張 → ${count}×${perCard} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}
regPre('火箭隊的多邊獸Ⅱ|R指令', rocketSupporterCountInDiscardPre(20, 'R指令'));
regPre('火箭隊的多邊獸Ｚ|R指令', rocketSupporterCountInDiscardPre(20, 'R指令'));

// ══════════════════════════════════════════════════════════════════════════════
// K. 場上寶可夢道具數 ×K (3 張)
// ══════════════════════════════════════════════════════════════════════════════
function selfFieldToolCountPre(perTool: number, label: string): AttackPreFn {
  return (state, aIdx, _pool) => {
    const player = state.players[aIdx];
    let count = 0;
    if (player.active?.toolAttached) count++;
    for (const b of player.bench) if (b.toolAttached) count++;
    const dmg = count * perTool;
    const s = addLog(state, `${label}：自方場上道具 ${count} 個 → ${count}×${perTool} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}
regPre('切割洛托姆|配件秀', selfFieldToolCountPre(30, '配件秀'));
regPre('加熱洛托姆|配件秀', selfFieldToolCountPre(30, '配件秀'));
regPre('清洗洛托姆|配件秀', selfFieldToolCountPre(30, '配件秀'));

// ══════════════════════════════════════════════════════════════════════════════
// L. 「輪唱」家族 (3 張)
// ══════════════════════════════════════════════════════════════════════════════
function chorusFamilyPre(perPokemon: number, label: string): AttackPreFn {
  return (state, aIdx, pool) => {
    const player = state.players[aIdx];
    const all: CardInstance[] = [...(player.active ? [player.active] : []), ...player.bench];
    let count = 0;
    for (const pk of all) {
      const card = pool.get(pk.cardId);
      if (card?.attacks?.some(a => a.name === '輪唱')) count++;
    }
    const dmg = count * perPokemon;
    const s = addLog(state, `${label}：自方場上「輪唱」寶可夢 ${count} 隻 → ${count}×${perPokemon} = ${dmg}`, aIdx);
    return { state: s, damage: dmg };
  };
}
regPre('圓蝌蚪|輪唱', chorusFamilyPre(20, '輪唱'));
regPre('藍蟾蜍|輪唱', chorusFamilyPre(40, '輪唱'));
regPre('蟾蜍王|輪唱', chorusFamilyPre(70, '輪唱'));

// ══════════════════════════════════════════════════════════════════════════════
// M. 對手特殊狀態數 ×K (1 張)
// 火箭隊的臭臭泥|毒液危害 100× 對手戰鬥場狀態數
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的臭臭泥|毒液危害', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  let count = 0;
  if (def?.status) count++;
  if (def?.secondaryStatus) count++;
  const dmg = count * 100;
  const s = addLog(state, `毒液危害：對手戰鬥場特殊狀態 ${count} 個 → ${count}×100 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// N. 自身水能量 ×30（簡化）(1 張)
// 櫻花魚|漸強波 30× 自身水能量數
// （卡面有「若希望，從手牌附水能量」前置 — 簡化為直接計算當前水能量）
// ══════════════════════════════════════════════════════════════════════════════
regPre('櫻花魚|漸強波', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 0 };
  let count = 0;
  for (const e of a.energyAttached) {
    if (pool.get(e.cardId)?.pokemonType === 'Water') count++;
  }
  const dmg = count * 30;
  const s = addLog(state, `漸強波：自身水能量 ${count} 個 → ${count}×30 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// O. 自方所有寶可夢回 N (1 張)
// 清洗洛托姆|搓洗 — 20 + 自方所有寶可夢各回 10 HP
// ══════════════════════════════════════════════════════════════════════════════
regPre('清洗洛托姆|搓洗', (s) => ({ state: s, damage: 20 }));
regPost('清洗洛托姆|搓洗', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '搓洗：自方所有寶可夢各回 10 HP', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, damage: Math.max(0, (p.active.damage ?? 0) - 10) } : null,
      bench: p.bench.map(b => ({ ...b, damage: Math.max(0, (b.damage ?? 0) - 10) })),
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// P. 對手戰鬥場中毒（每回合改放 8 個）(1 張)
// 火箭隊的尼多王ex|惡劣角擊 100 + 對手戰鬥場中毒（特殊：每回合 8 個傷害指示物）
// 簡化：標準中毒（每回合 1 個指示物 = 10 點），但我們用 poisonDamagePerCheckup 旗標
// ══════════════════════════════════════════════════════════════════════════════
regPre('火箭隊的尼多王ex|惡劣角擊', (s) => ({ state: s, damage: 100 }));
regPost('火箭隊的尼多王ex|惡劣角擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  return updatePlayer(
    addLog(state, '惡劣角擊：對手戰鬥場【中毒】（每回合 checkup 放 8 個指示物 = 80 點）', aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        secondaryStatus: 'poisoned' as const,
        poisonDamagePerCheckup: 80,
      } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// Q. 不計對手附加效果 (1 張) — 赤面龍|撕裂 40, skipDefEffects
// ══════════════════════════════════════════════════════════════════════════════
regPre('赤面龍|撕裂', (s) => ({ state: s, damage: 40, skipDefEffects: true }));

// ══════════════════════════════════════════════════════════════════════════════
// R. 對手備戰數 ×K (1 張) — 索羅亞克|意志劫持 30× 對手備戰數
// ══════════════════════════════════════════════════════════════════════════════
regPre('索羅亞克|意志劫持', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const benchN = state.players[dIdx].bench.length;
  const dmg = benchN * 30;
  const s = addLog(state, `意志劫持：對手備戰 ${benchN} 隻 → ${benchN}×30 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// 輔助：unused import 防護
export type _v2610Sentinel = PlayerState;
type _APT = AttackPostFn;
// withPending unused, prevent eslint warning
void withPending;
