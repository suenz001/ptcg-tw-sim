/**
 * v2.65 I 標 Wave 15 — 雜項第八批（25 張）
 *
 * 涵蓋：
 *   - 進化牌庫搜尋簡化 (5 張) — 從牌庫挑 1 張 Pokemon 卡加手牌（玩家手動進化）
 *   - 對手棄手牌 (3 張) — 對手選 N 張對手自己手牌棄
 *   - 場上條件 ×N (5 張)
 *   - 棄能量 + 額外效果 (3 張)
 *   - 自殘 + 狀態 (2 張)
 *   - 自身招式 +N (1 張)
 *   - 看對手牌庫頂 (2 張)
 *   - 其他條件 (3 張)
 *   - 雜 (1 張)
 */

import { regPre, regPost, regR, addLog, updatePlayer, withPending, shuffle, ATTACK_PRE_DISCARD_CHOICE } from '../_shared';
import type { AttackPostFn, AttackPreFn } from '../_shared';
import type { GameState, CardInstance } from '../../types';
import type { Card } from '$lib/cards/types';
import { coinStatusPost, flipCoinsWithLog, statusPost } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 共用 helper
// ══════════════════════════════════════════════════════════════════════════════

// 從牌庫挑 ≤1 張寶可夢加手牌（簡化版進化搜尋）
function deckPickOnePokemonToHandPost(label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫已空`, aIdx);
    const s = addLog(state, `${label}：從牌庫挑 ≤1 張寶可夢加手牌（玩家手動進化；重洗）`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'Pokemon',
      minCount: 0, maxCount: 1,
      effectKey: 'wave13-deck-take-any',  // 復用 v2.63 既有 resolver
    });
  };
}

// 對手選 N 張對手自己手牌棄掉
function oppHandDiscardPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.hand.length === 0) return addLog(state, `${label}：對手手牌已空`, aIdx);
    const k = Math.min(n, opp.hand.length);
    const s = addLog(state, `${label}：對手選 ${k} 張對手自己的手牌丟棄`, aIdx);
    return withPending(s, {
      type: 'hand-discard',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: k, maxCount: k,
      effectKey: 'wave15-opp-hand-discard',
      params: { label },
    });
  };
}
regR('wave15-opp-hand-discard', (state, _actorIdx, iids, params, _pool) => {
  // _actorIdx 是對手（被對手控制的玩家）；要把那些卡從那位玩家的 hand 移到 discard
  const label = (params?.label as string | undefined) ?? '勒緊';
  if (iids.length === 0) return addLog(state, `${label}：未棄牌`, _actorIdx);
  const set = new Set(iids);
  return updatePlayer(
    addLog(state, `${label}：對手丟棄 ${iids.length} 張手牌`, _actorIdx),
    _actorIdx, p => {
      const discarded = p.hand.filter(c => set.has(c.iid));
      const remaining = p.hand.filter(c => !set.has(c.iid));
      return { ...p, hand: remaining, discard: [...p.discard, ...discarded] };
    },
  );
});

// 看對手牌庫頂 5 張並排序
function viewOppDeckTopReorderPost(n: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.deck.length === 0) return addLog(state, `${label}：對手牌庫已空`, aIdx);
    const realN = Math.min(n, opp.deck.length);
    const top = opp.deck.slice(0, realN);
    const s = addLog(state, `${label}：查看對手牌庫頂 ${realN} 張並重新排序`, aIdx);
    return withPending(s, {
      type: 'reorder-deck-top',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      minCount: realN, maxCount: realN,
      effectKey: 'wave15-opp-deck-reorder',
      params: {
        candidateIids: top.map(c => c.iid),
        titleOverride: `${label}：排序對手牌庫頂 ${realN} 張`,
      },
    });
  };
}
regR('wave15-opp-deck-reorder', (state, actorIdx, selectedIids, _params, _pool) => {
  // selectedIids = 玩家排好的 iid 順序（index 0 = top of deck）
  const dIdx = (1 - actorIdx) as 0 | 1;
  return updatePlayer(state, dIdx, p => {
    const set = new Set(selectedIids);
    const top = selectedIids.map(iid => p.deck.find(c => c.iid === iid)!).filter(Boolean);
    const rest = p.deck.filter(c => !set.has(c.iid));
    return { ...p, deck: [...top, ...rest] };
  });
});

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
    const s = addLog(state, `${label}：自身丟棄全部能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const discarded = p.active.energyAttached;
      return { ...p, active: { ...p.active, energyAttached: [] }, discard: [...p.discard, ...discarded] };
    });
  };
}

// 自殘 N HP
function selfHitPost(amount: number, label: string): AttackPostFn {
  return (state, aIdx, _pool) => {
    return updatePlayer(
      addLog(state, `${label}：自身受到 ${amount} 點傷害`, aIdx),
      aIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: (p.active.damage ?? 0) + amount } : null,
      }),
    );
  };
}

// 對手 1 隻備戰受 N
function snipeOneOppBenchPost(amount: number, label: string, exOnly: boolean = false): AttackPostFn {
  return (state, aIdx, _pool) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const opp = state.players[dIdx];
    if (opp.bench.length === 0) return addLog(state, `${label}：對手備戰區無寶可夢`, aIdx);
    const s = addLog(state, `${label}：選 1 隻對手備戰寶可夢，受到 ${amount} 點傷害${exOnly ? '（限 ex）' : ''}`, aIdx);
    return withPending(s, {
      type: 'opp-bench-choose',
      actorIdx: aIdx, sourcePlayerIdx: dIdx,
      filter: exOnly ? 'ex' : undefined,
      minCount: 1, maxCount: 1,
      effectKey: 'wave3a-snipe-bench',
      params: { amount, label },
    });
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. 進化牌庫搜尋（5 張）— 全部簡化為「從牌庫挑 1 張寶可夢加手牌」（玩家手動進化）
// ══════════════════════════════════════════════════════════════════════════════
const EVOLVE_SEARCH: Array<[string, number]> = [
  ['夢妖|覺醒', 0],
  ['火箭隊的沙基拉斯|爆裂覺醒', 30],
  ['雙卵細胞球|細胞進化', 0],
  ['火箭隊的尼多娜|惡之覺醒', 0],
  ['人造細胞卵|細胞覺醒', 0],
];
for (const [key, dmg] of EVOLVE_SEARCH) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, deckPickOnePokemonToHandPost(atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. 對手棄手牌（3 張）— 黑眼鱷/混混鱷/流氓鱷｜勒緊
// ══════════════════════════════════════════════════════════════════════════════
const HAND_DISCARD: Array<[string, number, number]> = [  // [key, dmg, n]
  ['黑眼鱷|勒緊', 10, 1],
  ['混混鱷|勒緊', 40, 2],
  ['流氓鱷|勒緊', 60, 2],
];
for (const [key, dmg, n] of HAND_DISCARD) {
  const atkName = key.split('|')[1];
  regPre(key, (s) => ({ state: s, damage: dmg }));
  regPost(key, oppHandDiscardPost(n, atkName));
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. 場上條件 ×N（5 張）
// ══════════════════════════════════════════════════════════════════════════════

// 火箭隊的操陷蛛｜火箭猛攻 — 自方場上「火箭隊的寶可夢」數 × 30
regPre('火箭隊的操陷蛛|火箭猛攻', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let count = 0;
  for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
    const card = pool.get(c.cardId);
    if (card?.name?.startsWith('火箭隊的')) count++;
  }
  const dmg = count * 30;
  return { state: addLog(state, `火箭猛攻：場上火箭隊寶可夢 ${count} 隻 → ${count}×30 = ${dmg}`, aIdx), damage: dmg };
});

// 奇樹的霹靂電球｜連鎖伏特 — 20 + 自方場上所有「奇樹的寶可夢」身上雷能量總數 × 20
regPre('奇樹的霹靂電球|連鎖伏特', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let lightning = 0;
  for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
    const card = pool.get(c.cardId);
    if (!card?.name?.startsWith('奇樹的')) continue;
    for (const e of c.energyAttached) {
      if (pool.get(e.cardId)?.pokemonType === 'Lightning') lightning++;
    }
  }
  const dmg = 20 + lightning * 20;
  return { state: addLog(state, `連鎖伏特：奇樹寶可雷能量 ${lightning} 個 → 20 + ${lightning}×20 = ${dmg}`, aIdx), damage: dmg };
});

// 洛托姆｜配件秀 — 自方所有寶可夢身上附加的「寶可夢道具」數量 × 30
regPre('洛托姆|配件秀', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let toolCount = 0;
  for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
    if (c.toolAttached) {
      const tool = pool.get(c.toolAttached.cardId);
      if (tool?.subtype === 'Tool' || tool?.subtype === 'PokemonTool') toolCount++;
    }
  }
  const dmg = toolCount * 30;
  return { state: addLog(state, `配件秀：自方寶可道具 ${toolCount} 個 → ${toolCount}×30 = ${dmg}`, aIdx), damage: dmg };
});

// 流氓鱷｜咒詛猛擊 — 120 + 對手手牌 ≤3 張時 +120
regPre('流氓鱷|咒詛猛擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const handN = state.players[dIdx].hand.length;
  if (handN <= 3) {
    return { state: addLog(state, `咒詛猛擊：對手手牌 ${handN} 張 ≤3 → 120+120 = 240`, aIdx), damage: 240 };
  }
  return { state: addLog(state, `咒詛猛擊：對手手牌 ${handN} 張 > 3 → 120`, aIdx), damage: 120 };
});

// 劈斬司令｜致命刺擊 — 60 + 對手戰鬥場有指示物時 +60
regPre('劈斬司令|致命刺擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const dmgCounter = state.players[dIdx].active?.damage ?? 0;
  if (dmgCounter > 0) {
    return { state: addLog(state, `致命刺擊：對手戰鬥場有 ${dmgCounter} 傷害 → 60+60 = 120`, aIdx), damage: 120 };
  }
  return { state: addLog(state, `致命刺擊：對手無指示物 → 60`, aIdx), damage: 60 };
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 棄能量 + 額外效果（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 超級麻麻鰻魚王ex｜災難衝擊 190 — 卡面：「若希望，將2個這隻寶可夢身上附加的【雷】能量丟棄，將對手的戰鬥寶可夢【麻痺】。」
//   v3.26 修：原實裝強制棄 2 雷能量 + 強制麻痺，違反卡面「若希望」。
//   借殼 binary-yes-no：玩家可選擇是否棄 2 雷+麻痺對手（雷能量不足 2 個時不開 picker）。
ATTACK_PRE_DISCARD_CHOICE.set('超級麻麻鰻魚王ex|災難衝擊', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 190, damagePerEnergy: 0,
  choicePrompt: '是否將 2 個這隻寶可夢身上附加的【雷】能量丟棄，將對手的戰鬥寶可夢【麻痺】？',
  choiceYesLabel: '是（棄 2 雷能量 + 對手麻痺）',
  choiceNoLabel: '否（保留能量；對手不麻痺）',
});
regPre('超級麻麻鰻魚王ex|災難衝擊', (s) => ({ state: s, damage: 190 }));
regPost('超級麻麻鰻魚王ex|災難衝擊', (state, aIdx, pool, action) => {
  const chosenIids = action?.discardedEnergyIids;
  const choseYes = chosenIids === undefined ? true : chosenIids.length >= 1;
  if (!choseYes) {
    return addLog(state, '災難衝擊：選「否」 → 不棄能量、不麻痺對手', aIdx);
  }
  // 1) 棄 2 個雷能量
  let s = state;
  const att = s.players[aIdx].active;
  if (att) {
    const lightningIids: string[] = [];
    for (let i = att.energyAttached.length - 1; i >= 0 && lightningIids.length < 2; i--) {
      const e = att.energyAttached[i];
      if (pool.get(e.cardId)?.pokemonType === 'Lightning') lightningIids.push(e.iid);
    }
    if (lightningIids.length >= 2) {
      const set = new Set(lightningIids);
      s = updatePlayer(s, aIdx, p => {
        if (!p.active) return p;
        const discarded = p.active.energyAttached.filter(e => set.has(e.iid));
        const remaining = p.active.energyAttached.filter(e => !set.has(e.iid));
        return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
      });
      s = addLog(s, '災難衝擊：選「是」 → 棄 2 個雷能量', aIdx);
    } else {
      // 雷能量不足 → 不執行棄能量也不麻痺（卡面「將...丟棄，將對手...麻痺」是條件性）
      return addLog(s, '災難衝擊：雷能量不足 2 個（無法棄；不麻痺）', aIdx);
    }
  }
  // 2) 對手戰鬥場麻痺
  return statusPost('paralyzed')(s, aIdx, pool);
});

// 火焰雞｜業火連踢 120 — 棄 2 能量, 對手 1 隻備戰也受到 120
regPre('火焰雞|業火連踢', (s) => ({ state: s, damage: 120 }));
regPost('火焰雞|業火連踢', (state, aIdx, pool) => {
  let s = selfDiscardNEnergyPost(2, '業火連踢')(state, aIdx, pool);
  return snipeOneOppBenchPost(120, '業火連踢')(s, aIdx, pool);
});

// 捷拉奧拉｜閃電急襲 — 棄全能量, 對手備戰區 1 隻 ex 受 210
regPre('捷拉奧拉|閃電急襲', (s) => ({ state: s, damage: 0 }));
regPost('捷拉奧拉|閃電急襲', (state, aIdx, pool) => {
  let s = selfDiscardAllEnergyPost('閃電急襲')(state, aIdx, pool);
  return snipeOneOppBenchPost(210, '閃電急襲', true)(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 自殘 + 狀態（2 張）
// ══════════════════════════════════════════════════════════════════════════════

// 巴布土撥｜怒氣拳 130 — 自殘 60, 對手戰鬥麻痺（簡化必中，無「若希望」UI）
regPre('巴布土撥|怒氣拳', (s) => ({ state: s, damage: 130 }));
regPost('巴布土撥|怒氣拳', (state, aIdx, pool) => {
  let s = selfHitPost(60, '怒氣拳')(state, aIdx, pool);
  return statusPost('paralyzed')(s, aIdx, pool);
});

// 奇樹的頑皮雷彈｜怦怦炸彈 — 自殘 100, 擲幣正面對手戰鬥昏厥（直接 KO，簡化）
regPre('奇樹的頑皮雷彈|怦怦炸彈', (s) => ({ state: s, damage: 0 }));
regPost('奇樹的頑皮雷彈|怦怦炸彈', (state, aIdx, pool) => {
  let s = selfHitPost(100, '怦怦炸彈')(state, aIdx, pool);
  // 擲幣正面對手戰鬥昏厥（簡化：用 asleep 狀態替代，因引擎無 'fainted' 即時狀態）
  // 此處改用 KO 方式：直接設定對手 active.damage = HP
  const r = flipCoinsWithLog(s, 1, '怦怦炸彈', aIdx);
  s = r.state;
  if (r.heads === 1) {
    const dIdx = (1 - aIdx) as 0 | 1;
    const da = s.players[dIdx].active;
    if (da) {
      const card = pool.get(da.cardId);
      const hp = card?.hp ?? 0;
      s = updatePlayer(s, dIdx, p => ({
        ...p,
        active: p.active ? { ...p.active, damage: hp } : null,
      }));
      s = addLog(s, '怦怦炸彈：正面 → 對手戰鬥寶可夢昏厥', aIdx);
    }
  } else {
    s = addLog(s, '怦怦炸彈：反面', aIdx);
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 自身招式 +N — 步哨鼠｜聚氣（下回合「必殺門牙」傷害改為 240）
// ══════════════════════════════════════════════════════════════════════════════
regPre('步哨鼠|聚氣', (s) => ({ state: s, damage: 0 }));
regPost('步哨鼠|聚氣', (state, aIdx, _pool) => {
  return updatePlayer(
    addLog(state, '聚氣：下回合自身招式 +160（針對「必殺門牙」效果為 80 → 240）', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? {
        ...p.active,
        damageBonusPending: 160,  // +160 → 必殺門牙 80 + 160 = 240（簡化：所有招式都 +160）
      } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 看對手牌庫頂排序（2 張）
// ══════════════════════════════════════════════════════════════════════════════
regPre('哥德小童|天眼', (s) => ({ state: s, damage: 0 }));
regPost('哥德小童|天眼', viewOppDeckTopReorderPost(5, '天眼'));

regPre('火箭隊的天罩蟲|攪亂雷達', (s) => ({ state: s, damage: 0 }));
regPost('火箭隊的天罩蟲|攪亂雷達', viewOppDeckTopReorderPost(5, '攪亂雷達'));

// ══════════════════════════════════════════════════════════════════════════════
// 8. 其他條件（3 張）
// ══════════════════════════════════════════════════════════════════════════════

// 鐵螯龍蝦｜反撲剪 130 —「若這隻寶可夢身上放置有傷害指示物，則這個招式只需要1個惡能量即可使用」
//   能量 cost reduction 屬於招式 cost 規則，本批簡化為純 130 傷害（玩家自行記憶能量條件）
regPre('鐵螯龍蝦|反撲剪', (s) => ({ state: s, damage: 130 }));

// 酋雷姆ex｜雪爆發 130 — 對手所有備戰各受到對手已獲得獎賞數 ×10
regPre('酋雷姆ex|雪爆發', (s) => ({ state: s, damage: 130 }));
regPost('酋雷姆ex|雪爆發', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppPrizesTaken = 6 - state.players[dIdx].prizes.length;
  const amount = oppPrizesTaken * 10;
  if (amount === 0) return addLog(state, '雪爆發：對手未取獎賞，備戰無傷害', aIdx);
  return updatePlayer(
    addLog(state, `雪爆發：對手備戰各受 ${amount} 點傷害（對手已取獎賞 ${oppPrizesTaken} 張）`, aIdx),
    dIdx, p => ({
      ...p,
      bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) + amount })),
    }),
  );
});

// 巨炭山｜瀝青加農炮 — 棄牌區 ≥10 張基本鬥能量否則失敗 + 對手 1 隻寶可夢 140
regPre('巨炭山|瀝青加農炮', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let fightEnergyCount = 0;
  for (const c of p.discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Fighting' || card.name.includes('【鬥】'))) fightEnergyCount++;
  }
  if (fightEnergyCount < 10) {
    return { state: addLog(state, `瀝青加農炮：棄牌區基本鬥能量僅 ${fightEnergyCount} 張 < 10 → 招式失敗`, aIdx), damage: 0 };
  }
  return { state: addLog(state, `瀝青加農炮：棄牌區基本鬥能量 ${fightEnergyCount} 張 ≥ 10 → 對手 1 隻寶可夢受 140`, aIdx), damage: 0 };
});
regPost('巨炭山|瀝青加農炮', (state, aIdx, pool) => {
  const p = state.players[aIdx];
  let fightEnergyCount = 0;
  for (const c of p.discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic' && (card.pokemonType === 'Fighting' || card.name.includes('【鬥】'))) fightEnergyCount++;
  }
  if (fightEnergyCount < 10) return state;
  // 選對手 1 隻寶可夢（含戰鬥場）
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const total = (opp.active ? 1 : 0) + opp.bench.length;
  if (total === 0) return state;
  const s = addLog(state, '瀝青加農炮：選 1 隻對手寶可夢受 140', aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave15-asphalt-cannon',
    params: { amount: 140 },
  });
});
regR('wave15-asphalt-cannon', (state, aIdx, iids, params, _pool) => {
  if (iids.length === 0) return state;
  const amount = (params?.amount as number | undefined) ?? 0;
  const dIdx = (1 - aIdx) as 0 | 1;
  const targetIid = iids[0];
  return updatePlayer(state, dIdx, p => {
    if (p.active && p.active.iid === targetIid) {
      return { ...p, active: { ...p.active, damage: (p.active.damage ?? 0) + amount } };
    }
    return { ...p, bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: (b.damage ?? 0) + amount } : b) };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 雜（1 張）— N的象徵鳥｜勝利象徵
//   「使用這個招式時，若自己剩餘獎賞卡的張數為 1 張，則這場對戰己方獲勝。」
// ══════════════════════════════════════════════════════════════════════════════
regPre("N的象徵鳥|勝利象徵", (s) => ({ state: s, damage: 0 }));
regPost('N的象徵鳥|勝利象徵', (state, aIdx, _pool) => {
  const myPrizes = state.players[aIdx].prizes.length;
  if (myPrizes === 1) {
    // 觸發勝利：將自方獎賞清空模擬「取走最後 1 張勝利」
    return updatePlayer(
      addLog(state, '勝利象徵：自方獎賞剩 1 張 → 觸發勝利', aIdx),
      aIdx, p => ({ ...p, prizes: [] }),
    );
  }
  return addLog(state, `勝利象徵：自方獎賞剩 ${myPrizes} 張，未滿足條件`, aIdx);
});

// ══════════════════════════════════════════════════════════════════════════════
// Wave 15 統計：25 張寶可夢招式 effect 實裝
// ══════════════════════════════════════════════════════════════════════════════
