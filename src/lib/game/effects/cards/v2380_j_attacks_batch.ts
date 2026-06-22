/**
 * v2.38 波 1 — J 標寶可夢招式補實裝（attack effects）
 *
 * 涵蓋 J 標 25 個 attack effect（純傷害招式不需註冊，已被引擎自動處理）。
 * 配對表（卡名｜招式名）：
 *   01. 大嘴娃｜雙重食客           60× 丟棄手牌能量張數
 *   02. 超級呆殼獸ex｜殼捲風旋轉   180 + 下回合受招式 → 對手放 12 個指示物
 *   03. 電龍｜閃光伏特              140 + 下回合無法用此招（recharge）
 *   04. 超級皮可西ex｜射攻月亮     120 + 丟手牌能量 ≤4 ×40
 *   05. 土地雲｜巨岩墜落            50  + 不計算抵抗力
 *   06. 超級基格爾德ex｜蓋亞波     200 + 下回合受招式 -30（reduceNextHit）
 *   07. 伊裴爾塔爾ex｜死亡靈魂     OHKO 對手所有 HP ≤50 寶可夢
 *   08. 伊裴爾塔爾ex｜黑暗打擊     210 + recharge
 *   09. 古劍豹｜狡兔三窟            20  + 自選交換備戰
 *   10. 掘地兔｜地震                140 + 自己備戰各 30 傷害（不計弱抗）
 *   11. 九尾｜九尾狐搬動           選備戰，把指示物全搬到對手戰鬥場
 *   12. 信使鳥｜幸福禮物           雙方各選 ≤3 基本能量附加（簡化：自己側）
 *   13. 電飛鼠｜小使者              從牌庫挑 ≤2 基本能量加手
 *   14. 哲爾尼亞斯｜大地風暴       30× 自己所有寶可夢身上超能量數
 *   15. 樹才怪｜岩石投擲            30 + 不計抵抗力
 *   16. 千針魚｜毒液衝擊            30+，對手中毒 +50
 *   17. 金屬怪｜防守壓制            70 + 下回合受招式 -30
 *   18. 勾帕路翁ex｜力量衝撞       200 + recharge（無法使用招式）
 *   19. 藍鱷｜咬碎                   50 + 擲幣正→丟對手戰鬥場能量
 *   20. 雷吉艾斯ex｜雷吉充能       從棄牌區挑 ≤2 基本【水】能量附自身
 *   21. 雷吉斯奇魯ex｜雷吉充能     從棄牌區挑 ≤2 基本【鋼】能量附自身
 *   22. 瑪力露麗ex｜能量氣球       60 + 自身超能量數 ×40
 *   23. 故勒頓ex｜衝擊打擊         200 + recharge
 *   24. 優雅貓｜能量粉碎           40× 對手所有寶可夢身上能量總數
 *   25. 青木的姆克兒｜小使者       同電飛鼠
 *   26. 超級差不多娃娃ex｜耳之力   20+ 對手戰鬥場能量數 ×80
 *   27. 青木的勇士雄鷹｜勇鳥猛攻   120 + 自傷 30
 *
 * 鐵律：純傷害招式（無 effect 文）不在此檔；恢復／互換／搜尋等流程由 pendingSelection 處理。
 */

import type { CardInstance, GameState, PlayerState } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import type { Card } from '$lib/cards/types';
import {
  regPre, regPost, regR,
  addLog, updatePlayer, withPending, shuffle,
  ATTACK_PRE_DISCARD_CHOICE,
} from '../_shared';
import { energyMatchesType } from '../_shared';
import type { AttackPostFn } from '../_shared';
import { isBasicEnergyOfType, getEnergyUnits } from '../../engine';
import { flipCoinsWithLog, canApplyAttackEffectToTarget, koTargetByAttackEffect } from '../../effects';

// ── 01. 大嘴娃｜雙重食客 — 60× 丟棄手牌能量張數 ─────────────────────────────
// JSON：「從自己的手牌將最多2張能量卡丟棄，造成其張數×60點傷害。」
// v4.41：auto-discard 2 → ATTACK_PRE_DISCARD_CHOICE 玩家選 0-2（仿 v3.26 射攻月亮）
ATTACK_PRE_DISCARD_CHOICE.set('大嘴娃|雙重食客', {
  min: 0, max: 2, scope: 'hand-energy',
  baseDamage: 0, damagePerEnergy: 60,
});
regPre('大嘴娃|雙重食客', (state, aIdx, pool, action) => {
  const player = state.players[aIdx];
  const chosenIids = action?.discardedEnergyIids;
  const handEnergies = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  let toDiscard: typeof handEnergies = [];
  if (chosenIids && chosenIids.length > 0) {
    // 玩家自選：限定為手牌能量、capped 到 2
    const allowed = new Set(handEnergies.map(e => e.iid));
    const capped = chosenIids.filter(id => allowed.has(id)).slice(0, 2);
    const setIds = new Set(capped);
    toDiscard = handEnergies.filter(e => setIds.has(e.iid));
  }
  let s = state;
  if (toDiscard.length > 0) {
    s = updatePlayer(s, aIdx, p => ({
      ...p,
      hand: p.hand.filter(c => !toDiscard.some(d => d.iid === c.iid)),
      discard: [...p.discard, ...toDiscard],
    }));
    s = addLog(s, `雙重食客：丟棄手牌 ${toDiscard.length} 張能量 → ${toDiscard.length * 60} 傷害`, aIdx);
  } else {
    s = addLog(s, '雙重食客：未丟手牌能量 → 0 傷害', aIdx);
  }
  return { state: s, damage: toDiscard.length * 60 };
});

// ── 02. 超級呆殼獸ex｜殼捲風旋轉 — 180 + 下次受招式時 retaliation 12 indicator ──
// v2.382 真實裝：在 attacker.active 設 retaliateCountersOnNextHit = 12 flag。
// engine 在攻擊 pipeline 末段（傷害套用後）檢查 defender 帶此 flag → 對 attacker
// active 放 12 個指示物（= 120 damage），消費後清除 flag。
regPre('超級呆殼獸ex|殼捲風旋轉', (s, _a, _p) => ({ state: s, damage: 180 }));
regPost('超級呆殼獸ex|殼捲風旋轉', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, retaliateCountersOnNextHit: 12 } : null,
  }));
});

// ── 03. 電龍｜閃光伏特 — 140 + recharge ──────────────────────────────────────
// 「下個自己的回合，這隻寶可夢無法使用『閃光伏特』」→ blockedAttackNamesNextTurn
regPre('電龍|閃光伏特', (s, _a, _p) => ({ state: s, damage: 140 }));
regPost('電龍|閃光伏特', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '閃光伏特'],
    } : null,
  }));
});

// ── 04. 超級皮可西ex｜射攻月亮 — 卡面：「若希望，從自己的手牌將最多4張能量卡丟棄，增加其張數×40點傷害。」
//   v3.26 修：原強制棄手牌前 4 張能量，違反卡面「若希望」+「最多」（玩家可選 0-4）。
//   改用 hand-energy scope（v2.389 新加；UI 列出手牌能量讓玩家點選 0-4 張）。
//   AI fallback：未指定 → 不丟（保守，等於 base 120）；UI 玩家會走 picker 路徑。
ATTACK_PRE_DISCARD_CHOICE.set('超級皮可西ex|射攻月亮', {
  min: 0, max: 4, scope: 'hand-energy',
  baseDamage: 120, damagePerEnergy: 40,
});
regPre('超級皮可西ex|射攻月亮', (state, aIdx, pool, action) => {
  const player = state.players[aIdx];
  const chosenIids = action?.discardedEnergyIids;
  const handEnergies = player.hand.filter(c => pool.get(c.cardId)?.supertype === 'Energy');
  let toDiscard: typeof handEnergies = [];
  if (chosenIids && chosenIids.length > 0) {
    // 玩家自選：限定為手牌能量、capped 到 4
    const allowed = new Set(handEnergies.map(e => e.iid));
    const capped = chosenIids.filter(id => allowed.has(id)).slice(0, 4);
    const setIds = new Set(capped);
    toDiscard = handEnergies.filter(e => setIds.has(e.iid));
  }
  let s = state;
  if (toDiscard.length > 0) {
    s = updatePlayer(s, aIdx, p => ({
      ...p,
      hand: p.hand.filter(c => !toDiscard.some(d => d.iid === c.iid)),
      discard: [...p.discard, ...toDiscard],
    }));
    s = addLog(s, `射攻月亮：丟棄手牌 ${toDiscard.length} 張能量 → 120+${toDiscard.length * 40} = ${120 + toDiscard.length * 40}`, aIdx);
  } else {
    s = addLog(s, '射攻月亮：未丟手牌能量 → 120', aIdx);
  }
  return { state: s, damage: 120 + toDiscard.length * 40 };
});

// ── 05. 土地雲｜巨岩墜落 — 50, 不計抵抗力 ─────────────────────────────────
// v4.495：原誤套 skipWeakRes（跳兩個），改 skipResistance（只跳抵抗力）— 弱點仍應計算
regPre('土地雲|巨岩墜落', (s, _a, _p) => ({ state: s, damage: 50, skipResistance: true }));

// ── 06. 超級基格爾德ex｜蓋亞波 — 200 + 下回合受招式 -30 ──────────────────────
regPre('超級基格爾德ex|蓋亞波', (s, _a, _p) => ({ state: s, damage: 200 }));
regPost('超級基格爾德ex|蓋亞波', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damageReduceNextHit: 30 } : null,
  }));
});

// ── 07. 伊裴爾塔爾ex｜死亡靈魂 — OHKO 對手所有 HP ≤50 寶可夢 ──────────────────
// v2.382 真實裝：直接讓對手所有 HP ≤50 的寶可夢身上累積 damage 達到 max HP，
// 由後續 sanityKOSweep 統一處理 KO（移到棄牌 / 給獎賞）。
regPre('伊裴爾塔爾ex|死亡靈魂', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('伊裴爾塔爾ex|死亡靈魂', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const opp = state.players[dIdx];
  const allOpp = [...(opp.active ? [opp.active] : []), ...opp.bench];

  // 篩出剩餘 HP ≤50（即 effectiveHP - damage ≤ 50）的寶可夢
  const targets: { iid: string; name: string }[] = [];
  const blocked: string[] = [];
  const _oppActiveIid = state.players[dIdx].active?.iid;
  for (const pk of allOpp) {
    const card = pool.get(pk.cardId);
    if (!card) continue;
    const remainingHP = (card.hp ?? 0) - pk.damage;  // 簡化：用 card.hp 而非 getEffectiveHP
    if (remainingHP > 0 && remainingHP <= 50) {
      // v4.53 Phase 3：unified('attack-effect') per-target — bench target 補球形盾牌/藏隱等
      const _deathIsBench = pk.iid !== _oppActiveIid;
      const guard = canApplyEffectToTarget(state, aIdx, pk, card, 'attack-effect', pool, { isBench: _deathIsBench });
      if (guard.blocked) {
        blocked.push(`${card.name}｜${guard.reason}`);
        continue;
      }
      targets.push({ iid: pk.iid, name: card.name });
    }
  }
  let s = state;
  for (const b of blocked) s = addLog(s, `死亡靈魂：${b}（不昏厥）`, aIdx);
  if (targets.length === 0) {
    return addLog(s, '死亡靈魂：對手場上沒有 HP ≤50 的寶可夢可昏厥', aIdx);
  }
  s = addLog(s,
    `死亡靈魂：將對手 ${targets.length} 隻寶可夢昏厥 — ${targets.map(t => t.name).join('、')}`,
    aIdx);
  // v5.522：效果KO收斂中央 koTargetByAttackEffect（深淵之瞳式：搬棄牌 + recordOppKO + addPendingPrize，
  //   不走 damage 管線→不誤觸受傷反擊 / 不殘留假傷害）。多目標先 KO 備戰、最後 KO 戰鬥位（game-over 判定正確）。
  const _benchTargets = targets.filter(t => t.iid !== _oppActiveIid);
  const _activeTarget = targets.find(t => t.iid === _oppActiveIid);
  for (const t of _benchTargets) {
    const inst = s.players[dIdx].bench.find(b => b.iid === t.iid);
    if (inst) s = koTargetByAttackEffect(s, aIdx, inst, false, pool, '死亡靈魂');
  }
  if (_activeTarget) {
    const inst = s.players[dIdx].active;
    if (inst && inst.iid === _activeTarget.iid) s = koTargetByAttackEffect(s, aIdx, inst, true, pool, '死亡靈魂');
  }
  return s;
});

// ── 08. 伊裴爾塔爾ex｜黑暗打擊 — 210 + recharge ──────────────────────────────
regPre('伊裴爾塔爾ex|黑暗打擊', (s, _a, _p) => ({ state: s, damage: 210 }));
regPost('伊裴爾塔爾ex|黑暗打擊', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '黑暗打擊'],
    } : null,
  }));
});

// ── 09. 古劍豹｜狡兔三窟 — 20 + 自選交換備戰（self-swap） ──────────────────
regPre('古劍豹|狡兔三窟', (s, _a, _p) => ({ state: s, damage: 20 }));
regPost('古劍豹|狡兔三窟', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '狡兔三窟：選擇「否」 — 不互換', aIdx);
  const _cb: AttackPostFn = (state, aIdx, _pool) => {
  const p = state.players[aIdx];
  if (p.bench.length === 0) {
    return addLog(state, '狡兔三窟：備戰區無寶可夢，無法互換', aIdx);
  }
  const s = addLog(state, '狡兔三窟：選 1 隻備戰寶可夢與戰鬥場互換', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 0, maxCount: 1,
    effectKey: 'self-swap-active-bench',
    params: { label: '狡兔三窟' },
  });
};
  return _cb(state, aIdx, pool);
});

// ── 10. 掘地兔｜地震 — 140 + 自己備戰各 30 ───────────────────────────────────
regPre('掘地兔|地震', (s, _a, _p) => ({ state: s, damage: 140 }));
regPost('掘地兔|地震', (state, aIdx, pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => ({ ...b, damage: b.damage + 30 })),
  }));
});

// ── 11. 九尾｜九尾狐搬動 — 選備戰，搬指示物到對手戰鬥場 ───────────────────────
regPre('九尾|九尾狐搬動', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('九尾|九尾狐搬動', (state, aIdx, _pool) => {
  const player = state.players[aIdx];
  const damaged = player.bench.filter(b => b.damage > 0);
  if (damaged.length === 0) {
    return addLog(state, '九尾狐搬動：備戰區無受傷寶可夢', aIdx);
  }
  const s = addLog(state, '九尾狐搬動：選 1 隻備戰，把身上指示物全搬到對手戰鬥場', aIdx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'kitsune-move-counters',
    params: { validIids: damaged.map(b => b.iid) },
  });
});
regR('kitsune-move-counters', (state, aIdx, iids, _params, pool) => {
  const targetIid = iids[0];
  if (!targetIid) return state;
  const player = state.players[aIdx];
  const src = player.bench.find(b => b.iid === targetIid);
  if (!src || src.damage === 0) return state;
  const moveAmount = src.damage;
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppActive = state.players[dIdx].active;
  if (!oppActive) return state;
  // v4.58：改 unified('attack-effect', isBench:false) — 行為等價
  const oppCard = pool.get(oppActive.cardId);
  const guard = canApplyEffectToTarget(state, aIdx, oppActive, oppCard, 'attack-effect', pool, { isBench: false });
  if (guard.blocked) {
    return addLog(state, `九尾狐搬動：${oppCard?.name ?? '?'}｜${guard.reason}（不搬指示物）`, aIdx);
  }

  let s = state;
  s = updatePlayer(s, aIdx, p => ({
    ...p,
    bench: p.bench.map(b => b.iid === targetIid ? { ...b, damage: 0 } : b),
  }));
  s = updatePlayer(s, dIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: p.active.damage + moveAmount } : null,
  }));
  return addLog(s, `九尾狐搬動：將 ${moveAmount} 點傷害指示物移到對手戰鬥場`, aIdx);
});

// ── 13. 電飛鼠｜小使者 / 25. 青木的姆克兒｜小使者 — 牌庫挑 ≤2 基本能量加手 ───
function smallMessengerPost(label: string) {
  return (state: import('../../types').GameState, aIdx: 0 | 1, _pool: Map<string, import('$lib/cards/types').Card>) => {
    const player = state.players[aIdx];
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const s = addLog(state, `${label}：從牌庫選最多 2 張基本能量加手`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      filter: 'BasicEnergy',
      minCount: 0, maxCount: 2,
      effectKey: 'small-messenger-search',
      params: { label },
    });
  };
}
regPre('電飛鼠|小使者', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('電飛鼠|小使者', smallMessengerPost('小使者'));
regPre('青木的姆克兒|小使者', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('青木的姆克兒|小使者', smallMessengerPost('小使者'));

regR('small-messenger-search', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) {
    return updatePlayer(state, aIdx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  return updatePlayer(state, aIdx, p => {
    const taken = p.deck.filter(c => iids.includes(c.iid));
    return {
      ...p,
      deck: shuffle(p.deck.filter(c => !iids.includes(c.iid))),
      hand: [...p.hand, ...taken],
    };
  });
});

// ── 14. 哲爾尼亞斯｜大地風暴 — 30× 自己所有寶可夢身上超能量數 ─────────────────
//   v3.82 fix：基本【超】能量的 pokemonType 常為 null（scraper 留空），改用 isBasicEnergyOfType.
//   v5.323 fix：感應【超】能量等特殊能量 pokemonType=null 且非 Basic, 兩條 check 都漏抓
//     → 改用 getEnergyUnits (engine.ts) 看 unit.types 含 'Psychic'. 涵蓋基本+特殊能量
//     (含古舊能量 / 稜鏡能量 / 感應【超】能量等). 一張能量卡算 1 個 (不按 unit 數).
// v5.669：移除重複註冊 — 此招式統一由 v2353 energyMultiplyPre(host-aware,能量「個」數,火箭隊=2)實作。

// ── 15. 樹才怪｜岩石投擲 — 30, 不計抵抗力 ───────────────────────────────────
// v4.495：原誤套 skipWeakRes，改 skipResistance（弱點仍應計算）
regPre('樹才怪|岩石投擲', (s, _a, _p) => ({ state: s, damage: 30, skipResistance: true }));

// ── 16. 千針魚｜毒液衝擊 — 30+，對手中毒 → +50 ──────────────────────────────
regPre('千針魚|毒液衝擊', (state, aIdx, _pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  const isPoisoned = def?.status === 'poisoned' || def?.secondaryStatus === 'poisoned' || def?.tertiaryStatus === 'poisoned';
  return { state, damage: 30 + (isPoisoned ? 50 : 0) };
});

// ── 17. 金屬怪｜防守壓制 — 70 + 下回合受招式 -30 ────────────────────────────
regPre('金屬怪|防守壓制', (s, _a, _p) => ({ state: s, damage: 70 }));
regPost('金屬怪|防守壓制', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damageReduceNextHit: 30 } : null,
  }));
});

// ── 18. 勾帕路翁ex｜力量衝撞 — 200 + recharge（無法使用招式） ───────────────
regPre('勾帕路翁ex|力量衝撞', (s, _a, _p) => ({ state: s, damage: 200 }));
regPost('勾帕路翁ex|力量衝撞', (state, aIdx, _pool) => {
  // 「下個自己的回合，這隻寶可夢無法使用招式」— 用 cantAttackPending
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, cantAttackPending: true } : null,
  }));
});

// ── 19. 藍鱷｜咬碎 — 50 + 擲幣正→丟對手戰鬥場能量 ──────────────────────────
regPre('藍鱷|咬碎', (s, _a, _p) => ({ state: s, damage: 50 }));
regPost('藍鱷|咬碎', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '咬碎', aIdx);
  if (!r.heads) return r.state;
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = r.state.players[dIdx].active;
  if (!def || def.energyAttached.length === 0) {
    return addLog(r.state, '咬碎：對手戰鬥場無能量', aIdx);
  }
  const last = def.energyAttached[def.energyAttached.length - 1];
  const eName = pool.get(last.cardId)?.name ?? '能量';
  return updatePlayer(
    addLog(r.state, `咬碎：丟棄對手 ${eName}`, aIdx),
    dIdx, p => ({
      ...p,
      active: p.active ? { ...p.active, energyAttached: p.active.energyAttached.slice(0, -1) } : null,
      discard: [...p.discard, last],
    }),
  );
});

// ── 20-21. 雷吉艾斯ex / 雷吉斯奇魯ex｜雷吉充能 — 從棄牌區挑 ≤2 基本【水/鋼】 ───
function regiChargePost(label: string, energyType: 'Water' | 'Metal') {
  return (state: import('../../types').GameState, aIdx: 0 | 1, pool: Map<string, import('$lib/cards/types').Card>) => {
    const player = state.players[aIdx];
    const candidates = player.discard.filter(c => {
      const cc = pool.get(c.cardId);
      return cc?.supertype === 'Energy' && cc.subtype === 'Basic' && energyMatchesType(cc, energyType);
    });
    if (candidates.length === 0) {
      return addLog(state, `${label}：棄牌區無基本【${energyType === 'Water' ? '水' : '鋼'}】能量`, aIdx);
    }
    const s = addLog(state, `${label}：從棄牌區選最多 2 張基本【${energyType === 'Water' ? '水' : '鋼'}】能量附自身`, aIdx);
    return withPending(s, {
      type: 'discard-search',
      actorIdx: aIdx, sourcePlayerIdx: aIdx,
      minCount: 0, maxCount: 2,
      effectKey: 'regi-charge',
      params: { label, validIids: candidates.map(c => c.iid) },
    });
  };
}
regPre('雷吉艾斯ex|雷吉充能', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('雷吉艾斯ex|雷吉充能', regiChargePost('雷吉充能', 'Water'));
regPre('雷吉斯奇魯ex|雷吉充能', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('雷吉斯奇魯ex|雷吉充能', regiChargePost('雷吉充能', 'Metal'));

regR('regi-charge', (state, aIdx, iids, _params, _pool) => {
  if (iids.length === 0) return state;
  return updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    const moved = p.discard.filter(c => iids.includes(c.iid));
    const newDiscard = p.discard.filter(c => !iids.includes(c.iid));
    return {
      ...p,
      discard: newDiscard,
      active: { ...p.active, energyAttached: [...p.active.energyAttached, ...moved] },
    };
  });
});

// ── 22. 瑪力露麗ex｜能量氣球 — 60 + 自身超能量數 ×40 ──────────────────────
// v5.669：移除重複註冊 — 此招式統一由 v2353 energyMultiplyPre(host-aware,能量「個」數,火箭隊=2)實作。

// ── 23. 故勒頓ex｜衝擊打擊 — 200 + recharge ────────────────────────────────
regPre('故勒頓ex|衝擊打擊', (s, _a, _p) => ({ state: s, damage: 200 }));
regPost('故勒頓ex|衝擊打擊', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? {
      ...p.active,
      blockedAttackNamesNextTurn: [...(p.active.blockedAttackNamesNextTurn ?? []), '衝擊打擊'],
    } : null,
  }));
});

// ── 24. 優雅貓｜能量粉碎 — 40× 對手所有寶可夢身上能量總數 ─────────────────
// v5.669：移除重複註冊 — 此招式統一由 v2353 energyMultiplyPre(host-aware,能量「個」數,火箭隊=2)實作。

// ── 26. 超級差不多娃娃ex｜耳之力 — 20+ 對手戰鬥場能量數 ×80 ─────────────────
// v5.669：移除重複註冊 — 此招式統一由 v2353 energyMultiplyPre(host-aware,能量「個」數,火箭隊=2)實作。

// ── 27. 青木的勇士雄鷹｜勇鳥猛攻 — 120 + 自傷 30 ────────────────────────────
regPre('青木的勇士雄鷹|勇鳥猛攻', (s, _a, _p) => ({ state: s, damage: 120 }));
regPost('青木的勇士雄鷹|勇鳥猛攻', (state, aIdx, _pool) => {
  return updatePlayer(state, aIdx, p => ({
    ...p,
    active: p.active ? { ...p.active, damage: p.active.damage + 30 } : null,
  }));
});

// ── 12. 信使鳥｜幸福禮物 — 雙方各選 ≤3 基本能量附加（v4.36 真正逐張選目標） ──
// 卡面：「雙方玩家若希望，各自從自己的手牌選擇最多 3 張基本能量卡，
//        以任意方式附於自己的寶可夢身上。（對手先選擇。）」
//
// 跨 player pending chain（actorIdx 動態切換）：
//   Phase 1 (opp hand-discard): 對手選 0-3 基本能量 → resolver lucky-gift-opp
//   Phase 2 (opp distribute): 對手逐張選 heal-target（active + bench 任選）→ resolver lucky-gift-attach
//   Phase 3 (self hand-discard): 自己選 0-3 基本能量 → resolver lucky-gift-self
//   Phase 4 (self distribute): 自己逐張選 heal-target → resolver lucky-gift-attach
//
// v4.36 升級：原本 Phase 2/4 簡化為「全附到 active」，違反「以任意方式」。
//   現改為 chain：場上單一目標 → 自動全附；多目標 → 逐張開 picker（heal-target）。
// phase 切換：phase='opp' chain 結束時自動觸發 Phase 3；phase='self' chain 結束時招式結束。

// helper: 觸發 Phase 3（自方 hand-discard picker）
function luckyGiftSelfPickPhase(s: GameState, attackerIdx: 0 | 1, pool: Map<string, Card>): GameState {
  const ownHandHasBasic = s.players[attackerIdx].hand.some(c => {
    const cc = pool.get(c.cardId);
    return cc?.supertype === 'Energy' && cc.subtype === 'Basic';
  });
  if (!ownHandHasBasic) {
    return addLog(s, '幸福禮物：自己手牌無基本能量，效果結束', attackerIdx);
  }
  s = addLog(s, '幸福禮物：自己選 ≤3 張基本能量', attackerIdx);
  return withPending(s, {
    type: 'hand-discard',
    actorIdx: attackerIdx, sourcePlayerIdx: attackerIdx,
    minCount: 0, maxCount: 3,
    filter: 'BasicEnergy',
    effectKey: 'lucky-gift-self',
    params: { titleOverride: '幸福禮物：選 ≤3 張基本能量附於自己寶可夢（接著逐張選目標）' },
  });
}

// helper: phase-aware distribute chain 入口（找候選目標、單一自動 / 多選 picker）
function luckyGiftDistribute(
  s: GameState, actorIdx: 0 | 1, remainingIids: string[],
  phase: 'opp' | 'self', attackerIdx: 0 | 1, pool: Map<string, Card>,
): GameState {
  if (remainingIids.length === 0) {
    if (phase === 'opp') return luckyGiftSelfPickPhase(s, attackerIdx, pool);
    return s;
  }
  // 候選目標：actorIdx 的 active + bench（任意寶可夢，無 type filter）
  const player = s.players[actorIdx];
  const candidates: CardInstance[] = [];
  if (player.active) candidates.push(player.active);
  for (const b of player.bench) candidates.push(b);
  if (candidates.length === 0) {
    s = addLog(s, `幸福禮物：場上無寶可夢可附加，剩 ${remainingIids.length} 張能量留在棄牌區`, actorIdx);
    if (phase === 'opp') return luckyGiftSelfPickPhase(s, attackerIdx, pool);
    return s;
  }
  // 場上唯一目標 → 全自動附（避免反覆彈 UI）
  if (candidates.length === 1) {
    const target = candidates[0];
    const allIids = remainingIids;
    s = updatePlayer(s, actorIdx, p => {
      const energies = p.discard.filter(c => allIids.includes(c.iid));
      const newDiscard = p.discard.filter(c => !allIids.includes(c.iid));
      const attach = (poke: CardInstance) => poke.iid === target.iid
        ? { ...poke, energyAttached: [...poke.energyAttached, ...energies] }
        : poke;
      return {
        ...p,
        discard: newDiscard,
        active: p.active ? attach(p.active) : null,
        bench: p.bench.map(attach),
      };
    });
    const tname = pool.get(target.cardId)?.name ?? '?';
    s = addLog(s, `幸福禮物：場上唯一目標 → ${allIids.length} 張能量全附到 ${tname}`, actorIdx);
    if (phase === 'opp') return luckyGiftSelfPickPhase(s, attackerIdx, pool);
    return s;
  }
  // 多目標 → 對下一張能量開 heal-target picker（chain）
  const [currentIid, ...restIids] = remainingIids;
  const currentEnergyInDiscard = s.players[actorIdx].discard.find(c => c.iid === currentIid);
  const currentEnergyName = currentEnergyInDiscard
    ? (pool.get(currentEnergyInDiscard.cardId)?.name ?? '基本能量')
    : '基本能量';
  s = addLog(s, `幸福禮物：選擇能量附加目標（剩 ${remainingIids.length} 張待附）`, actorIdx);
  return withPending(s, {
    type: 'heal-target',
    actorIdx, sourcePlayerIdx: actorIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'lucky-gift-attach',
    params: {
      phase, attackerIdx,
      currentIid, remainingIids: restIids,
      titleOverride: `幸福禮物：將「${currentEnergyName}」附到哪一隻寶可夢？`,
    },
  });
}

regPre('信使鳥|幸福禮物', (s, _a, _p) => ({ state: s, damage: 0 }));
regPost('信使鳥|幸福禮物', (state, aIdx, pool, action) => {
  // v5.063：若希望 binary-yes-no guard
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '幸福禮物：選擇「否」 — 跳過禮物', aIdx);
  const _cb: AttackPostFn = (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // 對手手牌是否有基本能量？無 → 跳過對手側
  const oppHandHasBasic = state.players[dIdx].hand.some(c => {
    const cc = pool.get(c.cardId);
    return cc?.supertype === 'Energy' && cc.subtype === 'Basic';
  });
  // 我方手牌是否有？無 → 跳過自己側
  const ownHandHasBasic = state.players[aIdx].hand.some(c => {
    const cc = pool.get(c.cardId);
    return cc?.supertype === 'Energy' && cc.subtype === 'Basic';
  });
  if (!oppHandHasBasic && !ownHandHasBasic) {
    return addLog(state, '幸福禮物：雙方手牌皆無基本能量，無效果', aIdx);
  }
  // 卡面對手先選；若對手手牌無基本能量，跳過直接到我方
  if (oppHandHasBasic) {
    const s = addLog(state, '幸福禮物：對手先選 ≤3 張基本能量附於對手寶可夢', aIdx);
    return withPending(s, {
      type: 'hand-discard',
      actorIdx: dIdx, sourcePlayerIdx: dIdx,
      minCount: 0, maxCount: 3,
      filter: 'BasicEnergy',
      effectKey: 'lucky-gift-opp',
      params: { attackerIdx: aIdx, titleOverride: '幸福禮物：選 ≤3 張基本能量附於對手寶可夢（接著逐張選目標）' },
    });
  }
  // 對手無基本能量 → 直接到我方
  return luckyGiftSelfPickPhase(state, aIdx, pool);
};
  return _cb(state, aIdx, pool);
});

// Phase 1 resolver — 對手 hand-discard 完成 → 移能量到 opp.discard 暫存 → 進 Phase 2 distribute
regR('lucky-gift-opp', (state, dIdx, iids, params, pool) => {
  const attackerIdx = (params?.attackerIdx as 0 | 1) ?? ((1 - dIdx) as 0 | 1);
  if (iids.length === 0) {
    let s = addLog(state, '幸福禮物：對手選擇不分配能量', dIdx);
    return luckyGiftSelfPickPhase(s, attackerIdx, pool);
  }
  // 移能量到 opp.discard 暫存（之後 distribute chain 從 discard 取出附到目標）
  let s = updatePlayer(state, dIdx, p => {
    const chosen = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand: newHand, discard: [...p.discard, ...chosen] };
  });
  s = addLog(s, `幸福禮物：對手選 ${iids.length} 張基本能量，接著逐張選目標`, dIdx);
  return luckyGiftDistribute(s, dIdx, iids, 'opp', attackerIdx, pool);
});

// Phase 3 resolver — 自己 hand-discard 完成 → 移能量到 self.discard 暫存 → 進 Phase 4 distribute
regR('lucky-gift-self', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) {
    return addLog(state, '幸福禮物：自己選擇不分配能量', aIdx);
  }
  let s = updatePlayer(state, aIdx, p => {
    const chosen = p.hand.filter(c => iids.includes(c.iid));
    const newHand = p.hand.filter(c => !iids.includes(c.iid));
    return { ...p, hand: newHand, discard: [...p.discard, ...chosen] };
  });
  s = addLog(s, `幸福禮物：自己選 ${iids.length} 張基本能量，接著逐張選目標`, aIdx);
  return luckyGiftDistribute(s, aIdx, iids, 'self', aIdx, pool);
});

// Phase 2/4 resolver — 單張能量目標附加；遞迴下一張或結束 phase
regR('lucky-gift-attach', (state, actorIdx, targetIids, params, pool) => {
  const phase = (params?.phase as 'opp' | 'self') ?? 'self';
  const attackerIdx = (params?.attackerIdx as 0 | 1) ?? actorIdx;
  const currentIid = String(params?.currentIid ?? '');
  const restIids = (params?.remainingIids as string[] | undefined) ?? [];
  const targetIid = targetIids[0];

  let s = state;
  const player = s.players[actorIdx];
  const target = player.active?.iid === targetIid
    ? player.active
    : player.bench.find(c => c.iid === targetIid);
  const energyInst = player.discard.find(c => c.iid === currentIid);

  if (!target || !energyInst) {
    s = addLog(s, '幸福禮物：目標或能量遺失，略過此張', actorIdx);
  } else {
    s = updatePlayer(s, actorIdx, p => {
      const newDiscard = p.discard.filter(c => c.iid !== currentIid);
      const attach = (poke: CardInstance) => poke.iid === targetIid
        ? { ...poke, energyAttached: [...poke.energyAttached, energyInst] }
        : poke;
      return {
        ...p,
        discard: newDiscard,
        active: p.active ? attach(p.active) : null,
        bench: p.bench.map(attach),
      };
    });
    const tname = pool.get(target.cardId)?.name ?? '?';
    const ename = pool.get(energyInst.cardId)?.name ?? '基本能量';
    s = addLog(s, `幸福禮物：「${ename}」附到 ${tname}`, actorIdx);
  }

  // 遞迴下一張（chain 自帶 phase 切換邏輯）
  return luckyGiftDistribute(s, actorIdx, restIids, phase, attackerIdx, pool);
});

// 輔助：避免 unused import
export type _v2380Sentinel = PlayerState;
