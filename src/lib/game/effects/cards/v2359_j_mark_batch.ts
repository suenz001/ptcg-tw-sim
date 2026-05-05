/**
 * J 標 v2.359 批次實裝 — P3/P4 卡牌效果
 *
 * 群組 A  擲幣失敗        — 獨角蟲|偷襲、鬼斯|偷襲（反面 → 0 傷）
 * 群組 B  擲幣狀態/封鎖   — 咚咚鼠|電擊（麻痺）、咩利羊|電磁波（麻痺）
 *                           莉佳的蔓藤怪|綁緊（無法撤退）、莉佳的臭臭花|噴毒（中毒）
 * 群組 C  下回合無法撤退  — 泥巴魚ex|咬緊、圓絲蛛|緊纏之絲、布里卡隆|圍困
 *                           青木的勇士雄鷹|緊抓、阿利多斯|毒陣（中毒+封退）
 * 群組 D  自愈            — 妙喵|小憩（回 20）、芳香精|吸取之吻（50+回 30）
 *                           黏黏寶|吸取（30+回 30）
 * 群組 E  反彈傷害        — 莉佳的走路草|突擊（30+自傷 10）
 * 群組 F  自鎖/換場       — 胡帕|關節衝擊（130+自鎖下回合）
 *                           坦克臭鼬|粉碎迴轉（100+自換場）
 * 群組 G  傷害計算        — 超能妙喵|精神強念（30+20×opp能量）
 *                           君主蛇|皇家指令（20×自方場上寶可夢數）
 *                           耿鬼|意志劫持（10+30×opp備戰數）
 *                           古劍豹|上升利刃（80+80若opp為ex）
 *                           密勒頓ex|強子電光（120+120若opp為ex）
 *                           堅果啞鈴|特殊鞭打（70+70若自身有特殊能量）
 *                           摔角鷹人|復仇踢（30+60若任一備戰有傷害）
 *                           天秤偶|連續旋轉（30×硬幣正面次數）
 *                           寶寶暴龍|勃然大怒（20×自身傷害指示物）
 *                           雷丘|快速攻擊（20+擲幣正面+50）
 *                           倫琴貓|猛力進攻（70×對手已取獎賞張數）
 * 群組 H  能量丟棄        — 長尾火狐|噴射火焰（棄1）
 *                           雷丘|強力伏特（150+棄1）
 *                           倫琴貓|強力伏特（200+棄2）
 *                           頓甲|粉碎頭擊（180+棄2）
 * 群組 I  牌庫/手牌操作  — 大嘴娃|呼朋引伴（2 Basic→備戰）
 *                           火狐狸|呼朋引伴（1 Basic→備戰）
 *                           木木梟|尋找朋友（1 寶可夢→手牌）
 *                           鬼斯通|纏擾（放 3 傷害指示物於 opp active）
 */

import type { GameState, PlayerState } from '../../types';
import {
  addLog,
  regPost,
  regPre,
  updatePlayer,
  withPending,
} from '../_shared';
import type { AttackPreFn, AttackPostFn } from '../_shared';

// ── 私有工具函式 ──────────────────────────────────────────────────────────────

/**
 * 擲 1 次硬幣並寫入 log。
 * 不直接使用 effects.ts 的 flipCoinsWithLog 以避免循環 import。
 */
function flip1(
  label: string,
  state: GameState,
  aIdx: 0 | 1,
): { state: GameState; heads: boolean } {
  const isHeads = Math.random() < 0.5;
  return {
    state: addLog(state, `${label}：擲硬幣 — ${isHeads ? '正面' : '反面'}`, aIdx),
    heads: isHeads,
  };
}

/** 擲幣反面 → 招式失敗（damage = 0），正面 → base 傷害 */
function coinTailsFailFn(base: number, label: string): AttackPreFn {
  return (state, aIdx) => {
    const r = flip1(label, state, aIdx);
    if (!r.heads) {
      return { state: addLog(r.state, `${label}：反面 → 招式失敗`, aIdx), damage: 0 };
    }
    return { state: addLog(r.state, `${label}：正面 → ${base} 傷害`, aIdx), damage: base };
  };
}

/** 擲幣正面 → 對手戰鬥位附加指定狀態（無視 effectShield，簡化版） */
function coinStatusFn(
  status: 'poisoned' | 'paralyzed',
  label: string,
): AttackPostFn {
  return (state, aIdx) => {
    const r = flip1(label, state, aIdx);
    if (!r.heads) return addLog(r.state, `${label}：反面 → 無追加效果`, aIdx);
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...r.state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (!def.active) return r.state;
    def.active = { ...def.active, status };
    players[dIdx] = def;
    return addLog(
      { ...r.state, players },
      `${label}：正面 → 對手${status === 'poisoned' ? '中毒' : '麻痺'}`,
      aIdx,
    );
  };
}

/** 攻擊後對手 active 下回合無法撤退 */
function cantRetreatNextFn(label: string): AttackPostFn {
  return (state, aIdx) => {
    const dIdx = (1 - aIdx) as 0 | 1;
    const players = [...state.players] as [PlayerState, PlayerState];
    const def = { ...players[dIdx] };
    if (def.active) def.active = { ...def.active, cantRetreatNextTurn: true };
    players[dIdx] = def;
    return addLog({ ...state, players }, `${label}：對手下回合無法撤退`, aIdx);
  };
}

/** 攻擊後自身回復 N HP */
function healSelfFn(amount: number, label: string): AttackPostFn {
  return (state, aIdx) => {
    const players = [...state.players] as [PlayerState, PlayerState];
    const att = { ...players[aIdx] };
    if (!att.active) return state;
    const healed = Math.min(att.active.damage, amount);
    if (healed === 0) return state;
    att.active = { ...att.active, damage: att.active.damage - healed };
    players[aIdx] = att;
    return addLog({ ...state, players }, `${label}：恢復 ${healed} HP`, aIdx);
  };
}

/** 攻擊後自身丟棄最後 N 個能量 */
function discardOwnNEnergyFn(n: number, label: string): AttackPostFn {
  return (state, aIdx, pool) => {
    const att = state.players[aIdx].active;
    if (!att || att.energyAttached.length === 0) return state;
    const attName = pool.get(att.cardId)?.name ?? '?';
    const count = Math.min(n, att.energyAttached.length);
    const s = addLog(state, `${label}：${attName} 丟棄 ${count} 個能量`, aIdx);
    return updatePlayer(s, aIdx, p => {
      if (!p.active) return p;
      const keep = p.active.energyAttached.slice(0, p.active.energyAttached.length - count);
      const gone = p.active.energyAttached.slice(p.active.energyAttached.length - count);
      return {
        ...p,
        active: { ...p.active, energyAttached: keep },
        discard: [...p.discard, ...gone],
      };
    });
  };
}

/** 攻擊後從牌庫選最多 max 張基礎寶可夢放備戰（bench-basic-from-deck resolver） */
function benchBasicFn(max: number, label: string): AttackPostFn {
  return (state, aIdx) => {
    const player = state.players[aIdx];
    const slots = 5 - player.bench.length;
    if (slots <= 0) return addLog(state, `${label}：備戰區已滿`, aIdx);
    if (player.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const realMax = Math.min(max, slots);
    const s = addLog(state, `${label}：從牌庫選最多 ${realMax} 張基礎寶可夢放備戰`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx,
      sourcePlayerIdx: aIdx,
      filter: 'Basic',
      minCount: 0,
      maxCount: realMax,
      effectKey: 'bench-basic-from-deck',
    });
  };
}

/** 攻擊後從牌庫選最多 max 張（filter）加手牌（search-to-hand-reshuffle resolver） */
function searchToHandFn(max: number, filter: string, label: string): AttackPostFn {
  return (state, aIdx) => {
    const p = state.players[aIdx];
    if (p.deck.length === 0) return addLog(state, `${label}：牌庫為空`, aIdx);
    const s = addLog(state, `${label}：從牌庫選最多 ${max} 張（${filter}）加手牌`, aIdx);
    return withPending(s, {
      type: 'deck-search',
      actorIdx: aIdx,
      sourcePlayerIdx: aIdx,
      filter,
      minCount: 0,
      maxCount: max,
      effectKey: 'search-to-hand-reshuffle',
    });
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 A：擲幣失敗（反面 → 招式無效）
// 卡面：「擲 1 次硬幣，若反面，此招式無效。」
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 獨角蟲（M4 Basic Grass 50HP）｜偷襲：30，反面失敗
regPre('獨角蟲|偷襲', coinTailsFailFn(30, '偷襲'));

// 鬼斯（M3 Basic Darkness 70HP）｜偷襲：30，反面失敗
regPre('鬼斯|偷襲', coinTailsFailFn(30, '偷襲'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 B：擲幣追加狀態 / 直接無法撤退
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 咚咚鼠（M3 Basic Lightning 70HP）｜電擊：30，正面麻痺
// 卡面：「30 擲 1 次硬幣，若正面，對手的戰鬥寶可夢麻痺。」
regPost('咚咚鼠|電擊', coinStatusFn('paralyzed', '電擊'));

// 咩利羊（M4 Basic Lightning 70HP）｜電磁波：20，正面麻痺
// 卡面：「20 擲 1 次硬幣，若正面，對手的戰鬥寶可夢麻痺。」
regPost('咩利羊|電磁波', coinStatusFn('paralyzed', '電磁波'));

// 莉佳的蔓藤怪（MC Basic Grass 80HP）｜綁緊：50，對手下回合無法撤退
// 卡面：「50 對手的戰鬥寶可夢下次回合無法撤退。」
regPost('莉佳的蔓藤怪|綁緊', cantRetreatNextFn('綁緊'));

// 莉佳的臭臭花（MC Stage1 Grass 90HP）｜噴毒：50，正面中毒
// 卡面：「50 擲 1 次硬幣，若正面，對手的戰鬥寶可夢中毒。」
regPost('莉佳的臭臭花|噴毒', coinStatusFn('poisoned', '噴毒'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 C：攻擊後對手下回合無法撤退
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 泥巴魚ex（MC Basic Fighting 210HP）｜咬緊：30，對手下回合無法撤退
// 卡面：「30 對手的戰鬥寶可夢下次回合無法撤退。」
regPost('泥巴魚ex|咬緊', cantRetreatNextFn('咬緊'));

// 圓絲蛛（M3 Basic Grass 60HP）｜緊纏之絲：10，對手下回合無法撤退
// 卡面：「10 對手的戰鬥寶可夢下次回合無法撤退。」
regPost('圓絲蛛|緊纏之絲', cantRetreatNextFn('緊纏之絲'));

// 布里卡隆（M4 Stage2 Grass 180HP）｜圍困：160，對手下回合無法撤退
// 卡面：「160 對手的戰鬥寶可夢下次回合無法撤退。」
regPost('布里卡隆|圍困', cantRetreatNextFn('圍困'));

// 青木的勇士雄鷹（MC Stage1 Colorless 130HP）｜緊抓：50，對手下回合無法撤退
// 卡面：「50 對手的戰鬥寶可夢下次回合無法撤退。」
regPost('青木的勇士雄鷹|緊抓', cantRetreatNextFn('緊抓'));

// 阿利多斯（M3 Stage1 Grass 110HP）｜毒陣：50，中毒 + 下回合無法撤退
// 卡面：「50 對手的戰鬥寶可夢中毒。對手的戰鬥寶可夢下次回合無法撤退。」
regPost('阿利多斯|毒陣', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  if (!def.active) return state;
  def.active = {
    ...def.active,
    status: 'poisoned',
    cantRetreatNextTurn: true,
  };
  players[dIdx] = def;
  return addLog({ ...state, players }, '毒陣：對手中毒 + 下回合無法撤退', aIdx);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 D：自愈招式
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 妙喵（M3 Basic Psychic 60HP）｜小憩：0 傷，自身回復 20 HP
// 卡面：「將這隻寶可夢身上的 2 個傷害指示物去除。」
regPre('妙喵|小憩', (state) => ({ state, damage: 0 }));
regPost('妙喵|小憩', healSelfFn(20, '小憩'));

// 芳香精（M3 Stage1 Psychic 120HP）｜吸取之吻：50，自身回復 30 HP
// 卡面：「50 將這隻寶可夢身上的 3 個傷害指示物去除。」
regPost('芳香精|吸取之吻', healSelfFn(30, '吸取之吻'));

// 黏黏寶（M4 Basic Dragon 60HP）｜吸取：30，自身回復 30 HP
// 卡面：「30 將這隻寶可夢身上的 3 個傷害指示物去除。」
regPost('黏黏寶|吸取', healSelfFn(30, '吸取'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 E：反彈傷害（自傷）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 莉佳的走路草（MC Basic Grass 60HP）｜突擊：30，自傷 10
// 卡面：「30 這隻寶可夢受到 10 點傷害。」
regPost('莉佳的走路草|突擊', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  if (!att) return state;
  const attName = pool.get(att.cardId)?.name ?? '?';
  const players = [...state.players] as [PlayerState, PlayerState];
  players[aIdx] = {
    ...state.players[aIdx],
    active: { ...att, damage: att.damage + 10 },
  };
  return addLog({ ...state, players }, `突擊：${attName} 自身受到 10 點傷害`, aIdx);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 F：自鎖 / 攻擊後強制換場
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 胡帕（MC Basic Darkness 120HP）｜關節衝擊：130，自身下回合無法使用招式
// 卡面：「130 這隻寶可夢下次回合無法使用招式。」
// 使用 cantAttackPending 機制（于 END_TURN promote 成 cantAttackThisTurn）
regPost('胡帕|關節衝擊', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, cantAttackPending: true };
  players[aIdx] = att;
  return addLog({ ...state, players }, '關節衝擊：這隻寶可夢下回合無法使用招式', aIdx);
});

// 坦克臭鼬（M4 Stage1 Darkness 110HP）｜粉碎迴轉：100，攻擊後強制切換自身
// 卡面：「100 將 1 隻備戰寶可夢換入戰鬥。」
// 使用 bench-choose → do-switch resolver（同 selfSwapPost 邏輯）
regPost('坦克臭鼬|粉碎迴轉', (state, aIdx) => {
  const player = state.players[aIdx];
  if (!player.active || player.bench.length === 0) {
    return addLog(state, '粉碎迴轉：備戰區沒有寶可夢，無法切換', aIdx);
  }
  const s = addLog(state, '粉碎迴轉：選擇換入的備戰寶可夢', aIdx);
  return withPending(s, {
    type: 'bench-choose',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'do-switch',
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 G：條件傷害計算
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 超能妙喵（M3 Stage1 Psychic 100HP）｜精神強念：30 + 對手 active 能量數×20
// 卡面：「30+ 增加對手的戰鬥寶可夢身上附加的能量的數量×20 點傷害。」
// 注意：代歐奇希斯 精神強念 = 80+20×；本條目基礎為 30。
regPre('超能妙喵|精神強念', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  const count = defActive ? defActive.energyAttached.length : 0;
  const dmg = 30 + count * 20;
  return {
    state: addLog(state, `精神強念：對手 ${count} 個能量 → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// 君主蛇（M3 Stage2 Grass 160HP）｜皇家指令：20×自方場上寶可夢總數
// 卡面：「20× 增加自己場上的寶可夢的數量×20 點傷害。」
regPre('君主蛇|皇家指令', (state, aIdx) => {
  const p = state.players[aIdx];
  const count = (p.active ? 1 : 0) + p.bench.length;
  const dmg = count * 20;
  return {
    state: addLog(state, `皇家指令：場上 ${count} 隻寶可夢 → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// 耿鬼（M3 Stage2 Darkness 130HP）｜意志劫持：10 + 對手備戰數×30
// 卡面：「10+ 增加對手的備戰區的寶可夢的數量×30 點傷害。」
regPre('耿鬼|意志劫持', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const bench = state.players[dIdx].bench.length;
  const dmg = 10 + bench * 30;
  return {
    state: addLog(state, `意志劫持：對手備戰 ${bench} 隻 → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// 古劍豹（M3 Basic Darkness 120HP）｜上升利刃：80，若對手為 ex +80
// 卡面：「80 若對手的戰鬥寶可夢是 ex 寶可夢，增加 80 點傷害。」
regPre('古劍豹|上升利刃', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  const defCard = defActive ? pool.get(defActive.cardId) : null;
  const isEx = !!(defCard && (defCard.subtype === 'ex' || defCard.name?.endsWith('ex')));
  const dmg = 80 + (isEx ? 80 : 0);
  return {
    state: addLog(
      state,
      `上升利刃：${isEx ? '對手為 ex → +80' : '對手非 ex'} → ${dmg}`,
      aIdx,
    ),
    damage: dmg,
  };
});

// 密勒頓ex（MC Basic Lightning 220HP）｜強子電光：120，若對手為 ex +120
// 卡面：「120+ 若對手的戰鬥寶可夢是 ex 寶可夢，增加 120 點傷害。」
regPre('密勒頓ex|強子電光', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defActive = state.players[dIdx].active;
  const defCard = defActive ? pool.get(defActive.cardId) : null;
  const isEx = !!(defCard && (defCard.subtype === 'ex' || defCard.name?.endsWith('ex')));
  const dmg = 120 + (isEx ? 120 : 0);
  return {
    state: addLog(
      state,
      `強子電光：${isEx ? '對手為 ex → +120' : '對手非 ex'} → ${dmg}`,
      aIdx,
    ),
    damage: dmg,
  };
});

// 堅果啞鈴（M4 Stage1 Metal 130HP）｜特殊鞭打：70，若自身附有特殊能量 +70
// 卡面：「70+ 若這隻寶可夢身上附加了特殊能量卡，增加 70 點傷害。」
regPre('堅果啞鈴|特殊鞭打', (state, aIdx, pool) => {
  const att = state.players[aIdx].active;
  const hasSpecial = att
    ? att.energyAttached.some(e => {
        const ec = pool.get(e.cardId);
        return ec?.supertype === 'Energy' && ec.subtype !== 'Basic';
      })
    : false;
  const dmg = 70 + (hasSpecial ? 70 : 0);
  return {
    state: addLog(
      state,
      `特殊鞭打：${hasSpecial ? '附有特殊能量 → +70' : '無特殊能量'} → ${dmg}`,
      aIdx,
    ),
    damage: dmg,
  };
});

// 摔角鷹人（M3 Basic Fighting 70HP）｜復仇踢：30，若任一備戰有傷害 +60
// 卡面：「30+ 若自己備戰區有任何 1 隻已受傷的寶可夢，增加 60 點傷害。」
regPre('摔角鷹人|復仇踢', (state, aIdx) => {
  const bench = state.players[aIdx].bench;
  const anyDamaged = bench.some(c => c.damage > 0);
  const dmg = 30 + (anyDamaged ? 60 : 0);
  return {
    state: addLog(
      state,
      `復仇踢：${anyDamaged ? '備戰有傷害 → +60' : '備戰無傷'} → ${dmg}`,
      aIdx,
    ),
    damage: dmg,
  };
});

// 天秤偶（M4 Basic Fighting 70HP）｜連續旋轉：30×（擲到反面止）
// 卡面：「擲硬幣直到出現反面，增加正面出現的次數×30 點傷害。」
regPre('天秤偶|連續旋轉', (state, aIdx) => {
  let s = state;
  let heads = 0;
  let count = 0;
  // 安全上限 20 次防無限迴圈
  for (let i = 0; i < 20; i++) {
    count++;
    const isHeads = Math.random() < 0.5;
    s = addLog(s, `連續旋轉：第 ${count} 次擲硬幣 — ${isHeads ? '正面' : '反面（停止）'}`, aIdx);
    if (isHeads) heads++;
    else break;
  }
  const dmg = heads * 30;
  s = addLog(s, `連續旋轉：${heads} 次正面 → ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// 寶寶暴龍（M3 Stage1 Fighting 100HP）｜勃然大怒：20×自身傷害指示物數
// 卡面：「20× 增加這隻寶可夢身上的傷害指示物的數量×20 點傷害。」
// 傷害指示物 = damage ÷ 10（每格 10）
regPre('寶寶暴龍|勃然大怒', (state, aIdx) => {
  const att = state.players[aIdx].active;
  const counters = att ? Math.floor(att.damage / 10) : 0;
  const dmg = counters * 20;
  return {
    state: addLog(state, `勃然大怒：${counters} 個傷害指示物 → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// 雷丘（MC Stage1 Lightning 130HP）｜快速攻擊：20，擲幣正面 +50
// 卡面：「20+ 擲 1 次硬幣，若正面，增加 50 點傷害。」
regPre('雷丘|快速攻擊', (state, aIdx) => {
  const r = flip1('快速攻擊', state, aIdx);
  const dmg = 20 + (r.heads ? 50 : 0);
  return {
    state: addLog(
      r.state,
      `快速攻擊：${r.heads ? '正面 → +50' : '反面 → +0'} → ${dmg}`,
      aIdx,
    ),
    damage: dmg,
  };
});

// 倫琴貓（M3 Stage2 Lightning 150HP）｜猛力進攻：70×對手已取獎賞張數
// 卡面：「70× 增加對手已經獲得的獎賞卡的數量×70 點傷害。」
// 初始獎賞 = 6，taken = 6 - prizes.length（同 桃歹郎ex 邏輯）
regPre('倫琴貓|猛力進攻', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const taken = 6 - state.players[dIdx].prizes.length;
  const dmg = taken * 70;
  return {
    state: addLog(state, `猛力進攻：對手已取 ${taken} 張獎賞 → ${dmg}`, aIdx),
    damage: dmg,
  };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 H：攻擊後丟棄自身能量
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 長尾火狐（M4 Stage1 Fire 100HP）｜噴射火焰：80，棄 1 個能量
// 卡面：「80 將這隻寶可夢身上附加的 1 個能量丟棄。」
regPost('長尾火狐|噴射火焰', discardOwnNEnergyFn(1, '噴射火焰'));

// 雷丘（MC Stage1 Lightning 130HP）｜強力伏特：150，棄 1 個能量
// 卡面：「150 將這隻寶可夢身上附加的 1 個能量丟棄。」
regPost('雷丘|強力伏特', discardOwnNEnergyFn(1, '強力伏特'));

// 倫琴貓（M3 Stage2 Lightning 150HP）｜強力伏特：200，棄 2 個能量
// 卡面：「200 將這隻寶可夢身上附加的 2 個能量丟棄。」
regPost('倫琴貓|強力伏特', discardOwnNEnergyFn(2, '強力伏特'));

// 頓甲（M4 Stage1 Fighting 150HP）｜粉碎頭擊：180，棄 2 個能量
// 卡面：「180 將這隻寶可夢身上附加的 2 個能量丟棄。」
regPost('頓甲|粉碎頭擊', discardOwnNEnergyFn(2, '粉碎頭擊'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 群組 I：牌庫 / 手牌操作
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 大嘴娃（MC Basic Metal 90HP）｜呼朋引伴：0 傷，從牌庫選最多 2 隻基礎寶可夢放備戰
// 卡面：「從自己的牌庫選擇最多 2 張【基礎】寶可夢卡，放置於備戰區。並且重洗牌庫。」
regPre('大嘴娃|呼朋引伴', (state) => ({ state, damage: 0 }));
regPost('大嘴娃|呼朋引伴', benchBasicFn(2, '呼朋引伴'));

// 火狐狸（M4 Basic Fire 70HP）｜呼朋引伴：0 傷，從牌庫選最多 1 隻基礎寶可夢放備戰
// 卡面：「從自己的牌庫選擇 1 張【基礎】寶可夢卡，放置於備戰區。並且重洗牌庫。」
regPre('火狐狸|呼朋引伴', (state) => ({ state, damage: 0 }));
regPost('火狐狸|呼朋引伴', benchBasicFn(1, '呼朋引伴'));

// 木木梟（M3 Basic Grass 80HP）｜尋找朋友：0 傷，從牌庫選 1 張寶可夢加手牌
// 卡面：「從自己的牌庫選擇 1 張寶可夢卡，在給對手看過後加入手牌。並且重洗牌庫。」
regPre('木木梟|尋找朋友', (state) => ({ state, damage: 0 }));
regPost('木木梟|尋找朋友', searchToHandFn(1, 'Pokemon', '尋找朋友'));

// 鬼斯通（M3 Stage1 Darkness 100HP）｜纏擾：0 傷，在對手戰鬥位放 3 個傷害指示物
// 卡面：「在對手的戰鬥寶可夢身上放置 3 個傷害指示物。」
// 實裝：直接在 regPost 加 30 damage（3 指示物×10），繞過弱點/抵抗（非攻擊傷害）
regPre('鬼斯通|纏擾', (state) => ({ state, damage: 0 }));
regPost('鬼斯通|纏擾', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return state;
  const defName = pool.get(def.cardId)?.name ?? '?';
  const players = [...state.players] as [PlayerState, PlayerState];
  players[dIdx] = {
    ...state.players[dIdx],
    active: { ...def, damage: def.damage + 30 },
  };
  return addLog(
    { ...state, players },
    `纏擾：在 ${defName} 身上放 3 個傷害指示物（30）`,
    aIdx,
  );
});
