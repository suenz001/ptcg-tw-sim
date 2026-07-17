import type { CardInstance, GameState, PlayerState } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import { addLog, regPost, regPre, regR, shuffle, updatePlayer, withPending } from '../_shared';
import { startEnergyChain } from './v158_energy_chain';
import { canApplyAttackEffectToTarget, flipCoinsWithLog, dealAttackDamageToTarget } from '../../effects';

function flipFixed(state: GameState, aIdx: 0 | 1, label: string, count: number): { state: GameState; heads: number } {
  // v5.x: 改委派給 effects.ts 的中央 flipCoinsWithLog（同步設 coinFlippedThisAttack
  //   + consume _retryInjectedFlipsQueue + append _machineGunLastFlips）。重試徽章依賴此 flag。
  const r = flipCoinsWithLog(state, count, label, aIdx);
  return { state: r.state, heads: r.heads };
}

function flipUntilTails(state: GameState, aIdx: 0 | 1, label: string): { state: GameState; heads: number } {
  let s: GameState = state;
  let heads = 0;
  for (let i = 1; i <= 20; i++) {
    const r = flipCoinsWithLog(s, 1, label, aIdx);
    s = r.state;
    if (r.heads === 1) heads++;
    else break;
  }
  return { state: s, heads };
}

function setDefenderAttackFailure(
  state: GameState, aIdx: 0 | 1, flips: number, label: string,
  pool?: Map<string, import('$lib/cards/types').Card>,
): GameState {
  const dIdx = 1 - aIdx as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const d = { ...players[dIdx] };
  if (!d.active) return state;
  // v5.239：加 attack-effect immunity gate — 涵蓋薄霧能量 / 抵抗之幕 / 球形盾牌 /
  //   化隱 / 太晶 / 全能硬殼 等。若 defender active 免疫招式效果，flag 不該被 set。
  //   玩家回報：章魚桶墨汁噴射打附有薄霧能量的寶可夢，下回合仍被要求擲 2 次硬幣 — 違反卡面。
  if (pool) {
    const tCard = pool.get(d.active.cardId);
    const guard = canApplyEffectToTarget(state, aIdx, d.active, tCard, 'attack-effect', pool, { isBench: false });
    if (guard.blocked) {
      return addLog(state, `${label}：${tCard?.name ?? '?'}｜${guard.reason}（不受招式效果，跳過擲幣干擾）`, aIdx);
    }
  }
  d.active = { ...d.active, attackFailureFlipCountPending: flips };
  players[dIdx] = d;
  return addLog({ ...state, players }, `${label}：下個對手回合，受到此招式的寶可夢使用招式前需擲 ${flips} 次硬幣`, aIdx);
}

function damageOneNoKo(state: GameState, targetPlayerIdx: 0 | 1, targetIid: string, amount: number): GameState {
  return updatePlayer(state, targetPlayerIdx, (p) => {
    if (p.active?.iid === targetIid) return { ...p, active: { ...p.active, damage: p.active.damage + amount } };
    return { ...p, bench: p.bench.map((b) => b.iid === targetIid ? { ...b, damage: b.damage + amount } : b) };
  });
}

function damageAllOppByCoin(
  state: GameState,
  aIdx: 0 | 1,
  amount: number,
  label: string,
  pool?: Map<string, any>,
): GameState {
  const dIdx = 1 - aIdx as 0 | 1;
  let s = state;
  const targets = [s.players[dIdx].active, ...s.players[dIdx].bench].filter((c): c is CardInstance => !!c);
  for (const t of targets) {
    const rco = flipCoinsWithLog(s, 1, label, aIdx);
    s = rco.state;
    const isHeads = rco.heads === 1;
    if (!isHeads) continue;
    // v5.470：改走中央 dealAttackDamageToTarget（免疫+弱抗+道具+擊倒一次到位）。
    //   卡面「各受到150點傷害，[在備戰區不計算弱點・抵抗力]」→ 戰鬥場(active)計弱點×2/抵抗、備戰 noWeakness。
    //   原 damageOneNoKo 為 raw（不算弱抗、不 KO）→ 戰鬥場漏弱點（玩家回報虛無歸零沒算對手戰鬥場弱點）。
    //   免疫(薄霧/硬岩只擋 effect、太晶/神秘石居/球形盾牌/花之帷幔/對戰圓形等)由 helper kind='attack-damage' 內部 canApplyEffectToTarget 統一處理。
    if (pool) {
      const _coinIsBench = t.iid !== s.players[dIdx].active?.iid;
      s = dealAttackDamageToTarget(s, aIdx, t.iid, amount, pool, { kind: 'attack-damage', label, noWeakness: _coinIsBench });
    } else {
      s = damageOneNoKo(s, dIdx, t.iid, amount);
    }
  }
  return addLog(s, `${label}：正面且未被擋下的對手寶可夢各受到 ${amount} 傷害`, aIdx);
}

function attachBasicEnergyFromDeckToActive(state: GameState, aIdx: 0 | 1, pool: Map<string, any>, maxCount: number, label: string): GameState {
  if (maxCount <= 0) return addLog(state, `${label}：0 次正面，未附加能量`, aIdx);
  const p = state.players[aIdx];
  if (!p.active) return state;
  const picked: CardInstance[] = [];
  const rest: CardInstance[] = [];
  for (const c of p.deck) {
    const card = pool.get(c.cardId);
    if (picked.length < maxCount && card?.supertype === 'Energy' && card?.subtype === 'Basic') picked.push(c);
    else rest.push(c);
  }
  const shuffled = shuffle(rest);
  const s = updatePlayer(state, aIdx, (pl) => ({
    ...pl,
    deck: shuffled,
    active: pl.active ? { ...pl.active, energyAttached: [...pl.active.energyAttached, ...picked] } : pl.active,
  }));
  return addLog(s, `${label}：從牌庫附加 ${picked.length}/${maxCount} 張基本能量到自身，並重洗牌庫`, aIdx);
}

function countOwnNamed(state: GameState, aIdx: 0 | 1, pool: Map<string, any>, nameIncludes: string): number {
  const p = state.players[aIdx];
  const all = [p.active, ...p.bench].filter((c): c is CardInstance => !!c);
  return all.filter((c) => pool.get(c.cardId)?.name?.includes(nameIncludes)).length;
}

// J-mark batch v2.349：remaining P1 coin/deck/hand effects.

// 沙河馬｜潑沙、章魚桶｜墨汁噴射：下回合目標使用招式前擲幣，反面則失敗。
regPre('沙河馬|潑沙', (state) => ({ state, damage: 10 }));
regPost('沙河馬|潑沙', (state, aIdx, pool) => setDefenderAttackFailure(state, aIdx, 1, '潑沙', pool));
regPre('章魚桶|墨汁噴射', (state) => ({ state, damage: 30 }));
regPost('章魚桶|墨汁噴射', (state, aIdx, pool) => setDefenderAttackFailure(state, aIdx, 2, '墨汁噴射', pool));

// 超級基格爾德ex｜虛無歸零：對手所有寶可夢各擲 1 次，正面各 150。
regPre('超級基格爾德ex|虛無歸零', (state) => ({ state, damage: 0 }));
regPost('超級基格爾德ex|虛無歸零', (state, aIdx, pool) => damageAllOppByCoin(state, aIdx, 150, '虛無歸零', pool));

// 卡比獸｜大胃王：擲到反面，依正面數從牌庫附基本能量到自身（自動選前 N 張）。
regPre('卡比獸|大胃王', (state) => ({ state, damage: 0 }));
regPost('卡比獸|大胃王', (state, aIdx, pool) => {
  const r = flipUntilTails(state, aIdx, '大胃王');
  return attachBasicEnergyFromDeckToActive(r.state, aIdx, pool, r.heads, '大胃王');
});

// 肯泰羅｜群起瞄準：選對手 1 隻，擲自己場上肯泰羅數量，正面×50 傷害。
regPre('肯泰羅|群起瞄準', (state) => ({ state, damage: 0 }));
regPost('肯泰羅|群起瞄準', (state, aIdx) => {
  const dIdx = 1 - aIdx as 0 | 1;
  const d = state.players[dIdx];
  if (!d.active && d.bench.length === 0) return addLog(state, '群起瞄準：對手場上無寶可夢', aIdx);
  return withPending(addLog(state, '群起瞄準：選擇對手 1 隻寶可夢', aIdx), {
    type: 'opp-poke-choose', actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1, effectKey: 'j-taurus-group-aim',
  });
});
regR('j-taurus-group-aim', (state, aIdx, iids, _params, pool) => {
  const dIdx = 1 - aIdx as 0 | 1;
  const count = countOwnNamed(state, aIdx, pool, '肯泰羅');
  const r = flipFixed(state, aIdx, '群起瞄準', count);
  const dmg = r.heads * 50;
  const target = iids[0];
  if (!target || dmg <= 0) return addLog(r.state, `群起瞄準：${r.heads}/${count} 次正面，未造成傷害`, aIdx);
  // v4.54：卡面是「N×50 點傷害」(attack-damage)，不是「招式效果」。
  //   原 v2.92 誤套 canApplyAttackEffectToTarget 連薄霧/抵抗之幕等 effect immunity 都擋 → 違反卡面。
  //   改用 unified('attack-damage', isBench:?) → bench 才走 resolveBenchGuard 擋球形盾牌等，active 不擋。
  const _groupIsActive = state.players[dIdx].active?.iid === target;
  const tInst = _groupIsActive
    ? state.players[dIdx].active!
    : state.players[dIdx].bench.find(b => b.iid === target);
  if (tInst) {
    const tCard = pool.get(tInst.cardId);
    const guard = canApplyEffectToTarget(r.state, aIdx, tInst, tCard, 'attack-damage', pool, { isBench: !_groupIsActive });
    if (guard.blocked) {
      return addLog(r.state, `群起瞄準：${tCard?.name ?? '?'}｜${guard.reason}（不受傷害）`, aIdx);
    }
  }
  return addLog(damageOneNoKo(r.state, dIdx, target, dmg), `群起瞄準：${r.heads}/${count} 次正面 → ${dmg} 傷害`, aIdx);
});

// 步哨鼠｜臨檢：擲 3 次，依正面數將對手手牌前 N 張回牌庫並重洗（公開 log，不看內容）。
regPre('步哨鼠|臨檢', (state) => ({ state, damage: 0 }));
regPost('步哨鼠|臨檢', (state, aIdx, pool) => {
  const dIdx = 1 - aIdx as 0 | 1;
  const r = flipFixed(state, aIdx, '臨檢', 3);
  const n = Math.min(r.heads, r.state.players[dIdx].hand.length);
  if (n <= 0) return addLog(r.state, '臨檢：沒有卡放回牌庫', aIdx);
  const _lNames = r.state.players[dIdx].hand.slice(0, n).map(c => pool.get(c.cardId)?.name ?? '?').join('、'); // v5.863 雙方公開放回牌庫的卡名(Wilson裁定)
  const s = updatePlayer(r.state, dIdx, (p) => {
    const moved = p.hand.slice(0, n);
    const hand = p.hand.slice(n);
    return { ...p, hand, deck: shuffle([...moved, ...p.deck]) };
  });
  return addLog(s, `臨檢：${r.heads}/3 次正面，將對手 ${n} 張手牌放回牌庫並重洗 — ${_lNames}`, aIdx);
});

// 托戈德瑪爾ex｜尖尖回轉：若上個自己的回合使用過此招式，80+80；使用後記錄到下個自己的回合。
// v5.967 改讀中央 attackUsedLastSelfTurn(招式結算自動蓋章、不隨撤退/換位清除)，取代 pointySpin 旗標
//   (pointySpin 被歸類 CLEAR_ON_EXIT/BENCH_SCRUB → 撤退再回戰鬥位會漏 +80，違反卡面「這隻寶可夢」)。
//   無需 regPost：每個招式結算後 engine 都會把 attackUsedThisTurn 設為招式名並於 END_TURN promote。
regPre('托戈德瑪爾ex|尖尖回轉', (state, aIdx) => {
  const active = state.players[aIdx].active;
  const bonus = active?.attackUsedLastSelfTurn === '尖尖回轉' ? 80 : 0;
  return { state: addLog(state, `尖尖回轉：${bonus ? '上個自己的回合已使用 → 160' : '未連續使用 → 80'}`, aIdx), damage: 80 + bonus };
});

// 超級差不多娃娃ex｜萬花筒華爾滋：擲 3 次，正面×2 張基本能量
//   v5.253：完整實裝 (玩家選類型 + 任意分配自己場上寶可夢)
//   流程: flipFixed(3) → deck-search picker (filter='BasicEnergy') → energy-distribute picker → commit
regPre('超級差不多娃娃ex|萬花筒華爾滋', (state) => ({ state, damage: 0 }));
regPost('超級差不多娃娃ex|萬花筒華爾滋', (state, aIdx, pool) => {
  const r = flipFixed(state, aIdx, '萬花筒華爾滋', 3);
  const maxN = r.heads * 2;
  if (maxN <= 0) {
    return addLog(r.state, '萬花筒華爾滋：0 次正面，未附加能量', aIdx);
  }
  // v5.253 stage 1: 開 deck-search picker — 玩家從牌庫選最多 maxN 張基本能量 (任何屬性)
  const p = r.state.players[aIdx];
  const cand = p.deck.filter(c => {
    const card = pool.get(c.cardId);
    return !!card && card.supertype === 'Energy' && card.subtype === 'Basic';
  });
  const realMax = Math.min(maxN, cand.length);
  const s = addLog(
    r.state,
    `萬花筒華爾滋：${r.heads} 正面 → 從牌庫選最多 ${realMax} 張基本能量 (任何屬性), 任意分配自己場上寶可夢`,
    aIdx,
  );
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    filter: 'BasicEnergy',
    minCount: 0,
    maxCount: realMax,
    effectKey: 'kaleido-waltz-distribute-stage1',
    params: { label: '萬花筒華爾滋' },
  });
});

/**
 * v5.253 stage 2 resolver: 收到玩家從 deck 選的能量 iids → 開 energy-distribute picker.
 *   分配範圍: 自己所有寶可夢 (active + bench) — 卡面「附於自己的寶可夢身上」(無備戰限制).
 */
regR('kaleido-waltz-distribute-stage1', (state, aIdx, iids, params, pool) => {
  const label = (params?.label as string) ?? '萬花筒華爾滋';
  // v5.619：收斂到中央 startEnergyChain（仿過度放電 v5.502 / X啟動）。
  //   原自訂 energy-distribute 對「混合屬性」只顯示通用「基本」標籤，玩家看不出每張能量屬性，
  //   且 index 對應(energyIids[i] → 目標[i])對玩家隱藏 → 依選取順序填仍會跑到錯的寶可夢。
  //   startEnergyChain：同屬性→單 +/- 顯示【X】；混屬性→逐屬性分波(每波顯示該波【X】)，徹底解決。
  //   source='deck'(自動 reshuffle 卡面「重洗牌庫」)、scope='any-own'(自己 active+備戰)、filterType='Any'(任意屬性目標)。
  return startEnergyChain(state, aIdx, iids, {
    label, source: 'deck', scope: 'any-own', filterType: 'Any',
  }, pool);
});

/**
 * v5.253 commit resolver: 依玩家分配把能量從 deck 搬到各寶可夢身上 (含戰鬥場).
 *   selectedIids: 長度 = totalCount, 每個元素 = 該張能量的目標寶可夢 iid.
 *   仿永生綻放 j-2353-florges-distribute pattern, 但加 active 分支.
 */
// v5.619：kaleido-waltz-commit 已被中央 startEnergyChain（v87-energy-distribute-flat / 逐屬性分波）取代，保留 no-op 以防殘留 pending。
regR('kaleido-waltz-commit', (st) => st);
