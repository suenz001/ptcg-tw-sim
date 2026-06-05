/**
 * v2.56 I 標 Wave 6 — 複雜互動卡
 *
 *  1. 瑪夏多|暗影側踢 (60 + 若 KO → 下回合免疫招式傷害)
 *  2. 雪吞蟲|躲藏 (0 + 擲 1 正 → 下回合免疫招式)
 *  3. 瑪狃拉|報應爪 (20 + 自身 HP ≤ 50 → +170)
 *  4. 流氓鱷|復仇獠牙 (60 + 上對手回合自己有寶可夢被招式 KO → +160)
 *  5. 巨蔓藤|肌力鞭打 (120 + 自身能量比招式 cost 多 2 個 → +140)
 *  6. 焚焰蚣|緊束粉碎 (50 + 擲 2 次硬幣，N 次正面 → 棄對手 N 個能量)
 *  7. 超級暴雪王ex|山崩之錘 (棄牌庫頂 6 → 其中基本【水】數 ×100)
 *  8. 蓋諾賽克特|昆蟲加農炮 (任選 1 對手寶可夢 × 自身草能量 × 20，不計弱抗)
 *  9. 雪絨蛾|冰凍羽擊 (對手所有寶可夢各 20 + 對手戰鬥場睡眠，不計弱抗)
 * 10. 千面避役|擊斃 (雙方場上 HP 最低寶可夢 KO，自己除外)
 *
 * 共 10 張 I 標寶可夢招式 effect 實裝
 */

import type { CardInstance, PlayerState } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import {
  regPre, regPost, regR,
  addLog, updatePlayer, withPending,
} from '../_shared';
import { joinCardNames } from '../_shared';
import type { AttackPostFn } from '../_shared';
import { canApplyAttackEffectToTarget, statusPost, countOneEnergy, flipCoinsWithLog, dealAttackDamageToTarget, countEnergyTypeBloomAware } from '../../effects';

// ══════════════════════════════════════════════════════════════════════════════
// 1. 瑪夏多|暗影側踢 60 + 若 KO 對手 → 下回合免疫招式
// ══════════════════════════════════════════════════════════════════════════════
regPre('瑪夏多|暗影側踢', (s) => ({ state: s, damage: 60 }));
regPost('瑪夏多|暗影側踢', (state, aIdx, _pool) => {
  // 在 ATTACK_POST 階段，傷害已套用；判斷對手 active 是否變成 KO（damage >= effective HP）
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) {
    // 對手 active 已被 KO 移除（傷害足夠擊倒）
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (att.active) att.active = { ...att.active, immuneToAllAttackNextTurn: true };
    players[aIdx] = att;
    return addLog({ ...state, players }, '暗影側踢：成功擊倒對手 → 下回合免疫招式傷害', aIdx);
  }
  return state;
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. 雪吞蟲|躲藏 0 + 擲 1 正面 → 下回合免疫招式
// ══════════════════════════════════════════════════════════════════════════════
regPre('雪吞蟲|躲藏', (s) => ({ state: s, damage: 0 }));
regPost('雪吞蟲|躲藏', (state, aIdx, _pool) => {
  const r = flipCoinsWithLog(state, 1, '躲藏', aIdx);
  const heads = r.heads === 1;
  let s = r.state;
  if (!heads) return s;
  return updatePlayer(
    addLog(s, '躲藏：正面 → 下回合免疫招式傷害', aIdx),
    aIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, immuneToAllAttackNextTurn: true } : null,
    }),
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. 瑪狃拉|報應爪 20 + 自身 HP ≤ 50 +170
// ══════════════════════════════════════════════════════════════════════════════
regPre('瑪狃拉|報應爪', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return { state, damage: 20 };
  const card = pool.get(a.cardId);
  const maxHP = card?.hp ?? 0;
  const curHP = maxHP - (a.damage ?? 0);
  const cond = curHP <= 50;
  const dmg = 20 + (cond ? 170 : 0);
  const s = addLog(state, `報應爪：自身剩餘 HP ${curHP} ${cond ? '≤ 50 → +170' : '> 50，不增傷'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. 流氓鱷|復仇獠牙 60 + 上對手回合自方寶可夢被招式 KO → +160
// 用既有 state.oppAttackKOdMeInLastOppTurn 機制（v2.246）
// ══════════════════════════════════════════════════════════════════════════════
regPre('流氓鱷|復仇獠牙', (state, aIdx, _pool) => {
  const attackKO = state.oppAttackKOdMeInLastOppTurn?.[aIdx] ?? 0;
  const tookPrize = attackKO > 0;
  const bonus = tookPrize ? 160 : 0;
  const s = tookPrize
    ? addLog(state, '復仇獠牙：上對手回合自方寶可夢被招式 KO → +160 傷害', aIdx)
    : state;
  return { state: s, damage: 60 + bonus };
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 巨蔓藤|肌力鞭打 120 + 自身能量比 cost 多 2 → +140
// 招式 cost = ['Grass','Grass','Colorless','Colorless'] = 4 個能量
// 條件：身上能量 ≥ 6 個
// ══════════════════════════════════════════════════════════════════════════════
regPre('巨蔓藤|肌力鞭打', (state, aIdx, _pool) => {
  const a = state.players[aIdx].active;
  const have = a?.energyAttached.length ?? 0;
  const cond = have >= 6;  // cost 4 + 2
  const dmg = 120 + (cond ? 140 : 0);
  const s = addLog(state, `肌力鞭打：自身能量 ${have} 個 ${cond ? '(≥ cost+2 = 6) → +140' : '不足 cost+2，不增傷'} = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. 焚焰蚣|緊束粉碎 50 + 擲 2 次正面數 → 棄對手 N 個能量
// ══════════════════════════════════════════════════════════════════════════════
regPre('焚焰蚣|緊束粉碎', (s) => ({ state: s, damage: 50 }));
regPost('焚焰蚣|緊束粉碎', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 2, '緊束粉碎', aIdx);
  const heads = r.heads;
  let s = addLog(r.state, `緊束粉碎：擲 2 次硬幣 → ${heads} 次正面`, aIdx);
  if (heads === 0) return addLog(s, '緊束粉碎：無正面，無棄能效果', aIdx);
  // 棄對手戰鬥場 N 個能量（從尾端取）
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def || def.energyAttached.length === 0) {
    return addLog(s, '緊束粉碎：對手戰鬥場無能量可棄', aIdx);
  }
  const discardCount = Math.min(heads, def.energyAttached.length);
  const defName = pool.get(def.cardId)?.name ?? '?';
  s = addLog(s, `緊束粉碎：棄對手戰鬥場 ${discardCount} 個能量`, aIdx);
  return updatePlayer(s, dIdx, p => {
    if (!p.active) return p;
    const energies = p.active.energyAttached;
    const remaining = energies.slice(0, energies.length - discardCount);
    const discarded = energies.slice(energies.length - discardCount);
    return { ...p, active: { ...p.active, energyAttached: remaining }, discard: [...p.discard, ...discarded] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. 超級暴雪王ex|山崩之錘 牌庫頂 6 棄 → 其中基本【水】張數 ×100
// ══════════════════════════════════════════════════════════════════════════════
regPre('超級暴雪王ex|山崩之錘', (state, aIdx, pool) => {
  const player = state.players[aIdx];
  const top6 = player.deck.slice(0, 6);
  let waterCount = 0;
  for (const c of top6) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card.subtype === 'Basic'
        && (card.pokemonType === 'Water' || /【水】/.test(card.name))) {
      waterCount++;
    }
  }
  const dmg = waterCount * 100;
  const s = addLog(state, `山崩之錘：棄牌庫頂 ${top6.length} 張，其中 ${waterCount} 張基本【水】 → ${waterCount}×100 = ${dmg}`, aIdx);
  return { state: s, damage: dmg };
});

regPost('超級暴雪王ex|山崩之錘', (state, aIdx, pool) => {
  // 把牌庫頂 6 張移到棄牌區（已在 pre 用作計算，但要實際移除）
  const top6 = state.players[aIdx].deck.slice(0, 6);
  if (top6.length === 0) return state;
  return updatePlayer(addLog(state, `山崩之錘：自己牌庫頂 ${top6.length} 張丟入棄牌區：${joinCardNames(top6, pool)}`, aIdx), aIdx, p => ({
    ...p, deck: p.deck.slice(top6.length), discard: [...p.discard, ...top6],
  }));
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. 蓋諾賽克特|昆蟲加農炮 0 + 任選 1 對手寶可夢 ×草能量 ×20，不計弱抗
// ══════════════════════════════════════════════════════════════════════════════
regPre('蓋諾賽克特|昆蟲加農炮', (s) => ({ state: s, damage: 0 }));
regPost('蓋諾賽克特|昆蟲加農炮', (state, aIdx, pool) => {
  const a = state.players[aIdx].active;
  if (!a) return state;
  // v5.439：改用 countEnergyTypeBloomAware — 補大竺葵|繁茂（基本草×2）+ host-aware 特殊能量。
  //   原 countOneEnergy 不認繁茂 → 場上有大竺葵時草能量沒×2（玩家回報 20×2×2=80 卻只 40）。
  const grassCount = countEnergyTypeBloomAware(a, 'Grass', state, aIdx, pool);
  const dmg = grassCount * 20;
  if (dmg === 0) {
    return addLog(state, '昆蟲加農炮：自身無草能量，無傷害', aIdx);
  }
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  // 找對手場上所有寶可夢（active + bench）
  const targets: string[] = [];
  if (opp.active) targets.push(opp.active.iid);
  for (const b of opp.bench) targets.push(b.iid);
  if (targets.length === 0) {
    return addLog(state, '昆蟲加農炮：對手場上無寶可夢', aIdx);
  }
  const s = addLog(state, `昆蟲加農炮：自身草能量 ${grassCount} 個 → 任選 1 對手寶可夢受 ${dmg} 點傷害（不計弱抗）`, aIdx);
  return withPending(s, {
    type: 'opp-poke-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'wave6-snipe-any-opp-flat',
    params: { amount: dmg, label: '昆蟲加農炮', validIids: targets },
  });
});

// resolver — 對任選對手 1 寶可夢造成固定傷害（active or bench，不計弱抗）
regR('wave6-snipe-any-opp-flat', (state, aIdx, iids, params, pool) => {
  const amount = (params?.amount as number | undefined) ?? 0;
  const label = (params?.label as string | undefined) ?? '狙擊';
  // v5.437：改走中央 dealAttackDamageToTarget（補免疫/弱抗/KO/受傷反擊）。
  //   此 resolver 跨卡共用且 kind 不同：昆蟲加農炮=傷害(計弱抗)、悄聲加害=放指示物、
  //   意念移物=傷害但整招不計弱抗 → 由各卡 params 指定 kind / noWeakness。
  const kind = (params?.kind as 'attack-damage' | 'attack-effect' | undefined) ?? 'attack-damage';
  const noWeakness = (params?.noWeakness as boolean | undefined) ?? false;
  if (iids.length === 0 || amount === 0) return state;
  let s = state;
  for (const iid of iids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, amount, pool, { kind, label, noWeakness });
    if (s.phase === 'game-over') return s;
  }
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. 雪絨蛾|冰凍羽擊 對手所有寶可夢各 20 + 對手戰鬥場睡眠（不計弱抗）
// ══════════════════════════════════════════════════════════════════════════════
// v5.168 重設計：active +20 走 mainline ATTACK 管線（含弱點 / 抵抗力 / 攻擊方道具 猛攻手鐲 等
//   完整加成），bench +20 維持 regPost 自己手動套（卡面「對備戰不計算弱點抵抗力 + 不算道具」）。
//   原 regPre damage=0 + regPost 手動 active+20 → 完全跳過 mainline → 弱點/道具都漏 → bug。
//   Wilson 補充 v5.168：active 要算弱點+道具，bench 才不算 → regPre 不設 skipWeakRes / skipDefEffects。
regPre('雪絨蛾|冰凍羽擊', (s) => ({ state: s, damage: 20 }));
regPost('雪絨蛾|冰凍羽擊', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = addLog(state, '冰凍羽擊：對手備戰寶可夢各受到 20 點傷害（不計弱抗）+ 對手戰鬥場睡眠', aIdx);
  // active 的 20 傷害 + tool bonus 已由 mainline ATTACK handler 套用（含猛攻手鐲、活力頭帶 等）。
  // 此處只處理 bench +20（卡面「不計弱抗」故 raw +20）+ bench guard（球形盾牌/藏隱/深度下潛/羽毛化石/花之帷幔/太晶）。
  const opp = s.players[dIdx];
  const benchBlocked = new Set<string>();
  for (const b of opp.bench) {
    const g = canApplyEffectToTarget(s, aIdx, b, pool.get(b.cardId), 'attack-damage', pool, { isBench: true });
    if (g.blocked) {
      benchBlocked.add(b.iid);
      s = addLog(s, `冰凍羽擊：${pool.get(b.cardId)?.name ?? '?'}｜${g.reason}（不受傷害）`, aIdx);
    }
  }
  s = updatePlayer(s, dIdx, p => ({
    ...p,
    bench: p.bench.map(b => ({ ...b, damage: (b.damage ?? 0) + (benchBlocked.has(b.iid) ? 0 : 20) })),
  }));
  // 睡眠走 statusPost — 內含薄霧 / 硬岩 / 皇帝之勢 / 抵抗之幕 / 泡沫 / 祭典會場 / 憨憨臉 全套檢查
  s = statusPost('asleep')(s, aIdx, pool);
  return s;
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. 千面避役|擊斃 — 從雙方場上（除自身外）選 1 隻 HP 最低，將其昏厥
// JSON：「從雙方的場上寶可夢（這隻寶可夢除外）中選擇1隻剩餘HP最少的寶可夢，將其【昏厥】。」
// v4.41：auto-pick → 過濾出所有並列最低 HP 候選，1 隻自動執行，2+ 隻開 modal-choice 讓玩家選
// ══════════════════════════════════════════════════════════════════════════════
regPre('千面避役|擊斃', (s) => ({ state: s, damage: 0 }));
regPost('千面避役|擊斃', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // 收集雙方所有寶可夢（除攻擊者本人）
  type Cand = { ownerIdx: 0 | 1; iid: string; remaining: number; name: string };
  const cands: Cand[] = [];
  const myActive = state.players[aIdx].active;
  for (const owner of [aIdx, dIdx] as const) {
    const p = state.players[owner];
    const all: CardInstance[] = [...(p.active ? [p.active] : []), ...p.bench];
    for (const pk of all) {
      if (pk.iid === myActive?.iid) continue;  // 排除自身
      const card = pool.get(pk.cardId);
      const maxHP = card?.hp ?? 9999;
      const remaining = maxHP - (pk.damage ?? 0);
      cands.push({ ownerIdx: owner, iid: pk.iid, remaining, name: card?.name ?? '?' });
    }
  }
  if (cands.length === 0) {
    return addLog(state, '擊斃：場上無可選寶可夢（除自身）', aIdx);
  }
  // v4.41：找最低 HP，filter 出所有並列最低的候選
  const minRemaining = Math.min(...cands.map(c => c.remaining));
  const tied = cands.filter(c => c.remaining === minRemaining);
  // 1 隻 → 直接昏厥（與原行為相同）
  if (tied.length === 1) {
    const target = tied[0];
    const s = addLog(
      state,
      `擊斃：唯一剩餘 HP 最少的 ${target.name}（${target.ownerIdx === aIdx ? '自方' : '對手'}，剩 ${target.remaining}）→ 直接昏厥`,
      aIdx,
    );
    return updatePlayer(s, target.ownerIdx, p => {
      const newActive = p.active && p.active.iid === target.iid
        ? { ...p.active, damage: 99999 }
        : p.active;
      const newBench = p.bench.map(b => b.iid === target.iid
        ? { ...b, damage: 99999 }
        : b);
      return { ...p, active: newActive, bench: newBench };
    });
  }
  // 2+ 隻並列 → modal-choice picker 讓玩家選
  const s = addLog(state,
    `擊斃：${tied.length} 隻並列剩餘 HP 最少（${minRemaining}）— 玩家選 1 隻昏厥`, aIdx);
  return withPending(s, {
    type: 'modal-choice',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'striking-down-pick',
    params: {
      label: '擊斃',
      titleOverride: `擊斃：${tied.length} 隻並列剩餘 HP 最少（${minRemaining}），選 1 隻昏厥`,
      options: tied.map(c => ({
        id: `${c.ownerIdx}|${c.iid}`,
        text: `${c.ownerIdx === aIdx ? '自方' : '對手'}：${c.name}（剩 ${c.remaining} HP）`,
      })),
    },
  });
});

// resolver：讀玩家選擇 → KO 該目標
regR('striking-down-pick', (st, aIdx, iids, _params, pool) => {
  const choice = iids[0];
  if (!choice) return addLog(st, '擊斃：未選擇目標', aIdx);
  const [ownerStr, targetIid] = choice.split('|');
  const ownerIdx = (Number(ownerStr) === 0 ? 0 : 1) as 0 | 1;
  const p = st.players[ownerIdx];
  const target = p.active?.iid === targetIid ? p.active : p.bench.find(c => c.iid === targetIid);
  if (!target) return addLog(st, '擊斃：目標已不存在', aIdx);
  const tname = pool.get(target.cardId)?.name ?? '?';
  let s = addLog(st, `擊斃：選定 ${tname}（${ownerIdx === aIdx ? '自方' : '對手'}）→ 直接昏厥`, aIdx);
  return updatePlayer(s, ownerIdx, pl => {
    const newActive = pl.active && pl.active.iid === targetIid
      ? { ...pl.active, damage: 99999 }
      : pl.active;
    const newBench = pl.bench.map(b => b.iid === targetIid
      ? { ...b, damage: 99999 }
      : b);
    return { ...pl, active: newActive, bench: newBench };
  });
});

// 輔助：unused import 防護
export type _v2560Sentinel = PlayerState;
type _APT = AttackPostFn;
