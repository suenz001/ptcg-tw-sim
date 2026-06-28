/**
 * J 標 v2.360 批次實裝 — 8 組卡牌效果
 *
 * 群組 A  擲幣×能量倍率   — 波爾凱尼恩|強力蒸汽（附加【水】數量×擲幣，正面×90 傷害）
 * 群組 B  競技場加成       — 彩粉蝶|穿堂風（60 + 場上競技場 +60）
 * 群組 C  自傷減傷         — 超級火炎獅ex|大爆炸之火（290 − 自身傷害指示物×10）
 * 群組 D  支援者連動       — 妙喵|拍檔攻擊（10 + 本回合出了瑪琪艾兒 +60）
 * 群組 E  支援者連動＋磨庫 — 河馬獸|龍捲風噴射（80；post：本回合出了塔拉剛 → 磨對手牌庫頂 3 張）
 * 群組 F  跨回合免疫（特性）— 代歐奇希斯|精神防護（80；post：下回合不受擁有特性寶可夢招式傷害）
 * 群組 G  KO 後自我保護   — 具甲武者|要害斬（30；post：KO 對手 → 下回合不受招式傷害與效果）
 * 群組 H  進化特性         — 小木靈|怨恨進化（特性：從手牌進化，進化後寶可夢受 20 傷害）
 *
 * 相依：
 *   - types.ts：CardInstance.immuneToAbilityPokemonNextTurn/ThisTurn
 *               CardInstance.immuneToAllAttackNextTurn/ThisTurn
 *               PlayerState.magearnaPlayedThisTurn / talarongPlayedThisTurn
 *   - engine.ts：RETREAT hook（黏美龍）、攻擊免疫管線、旗標 promote/clear
 *   - v172_hij_batch.ts：瑪琪艾兒 resolver 設 magearnaPlayedThisTurn
 *   - six_decks.ts：塔拉剛 resolver 設 talarongPlayedThisTurn
 */

import type { GameState, CardInstance } from '../../types';
import {
  addLog,
  regA,
  regPost,
  regPre,
  regR,
  sameEvoName,
  updatePlayer,
  withPending,
  triggerOakeyeMillIfApplicable, isOwnFirstTurn,
} from '../_shared';
import { evolvedStatusAfter, buildEvolvedInstance } from '../_shared'; // v5.741/v5.742 進化狀態+建構中央
import { countEnergy } from '../../engine';
import { flipCoinsWithLog } from '../../effects';

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
  // v5.x：改委派 effects.ts flipCoinsWithLog（設 coinFlippedThisAttack + consume retry queue）
  const r = flipCoinsWithLog(state, 1, label, aIdx);
  return {
    state: r.state,
    heads: r.heads === 1,
  };
}

// ── 群組 A：波爾凱尼恩｜強力蒸汽 ────────────────────────────────────────────
// 卡面：擲與這隻寶可夢身上附加的【水】能量的數量相同次數的硬幣，
//   造成正面出現的次數×90點傷害。
// 對應：M-P-J (18513) / M3 兩個版本，共用同一招式名稱故一條 regPre 即可覆蓋。
regPre('波爾凱尼恩|強力蒸汽', (state, aIdx, pool) => {
  const attacker = state.players[aIdx].active;
  if (!attacker) return { state: addLog(state, '強力蒸汽：無戰鬥場寶可夢', aIdx), damage: 0 };

  // v4.797：改用 countEnergy（host-aware）— 認 pokemonType=null 基本【水】能量 + 特殊能量
  //   修舊 bug：strict ec.pokemonType === 'Water' 抓不到 pokemonType=null 的基本水能量。
  const waterCount = countEnergy(attacker, pool).get('Water') ?? 0;

  if (waterCount === 0) {
    return {
      state: addLog(state, '強力蒸汽：無附加【水】能量 → 0 傷害', aIdx),
      damage: 0,
    };
  }

  // 擲 waterCount 次硬幣，計算正面次數
  let heads = 0;
  let s = state;
  for (let i = 0; i < waterCount; i++) {
    const r = flip1('強力蒸汽', s, aIdx);
    s = r.state;
    if (r.heads) heads++;
  }
  const dmg = heads * 90;
  s = addLog(s, `強力蒸汽：${waterCount} 次擲幣，${heads} 次正面 → ${dmg} 傷害`, aIdx);
  return { state: s, damage: dmg };
});

// ── 群組 B：彩粉蝶｜穿堂風 ───────────────────────────────────────────────────
// 卡面：若場上有競技場卡，則增加60點傷害（60 + 60 = 120）。
// 對應：M3 (17986) 唯一版本。
regPre('彩粉蝶|穿堂風', (state, aIdx) => {
  const hasStadium = !!state.activeStadium;
  const dmg = hasStadium ? 120 : 60;
  const msg = hasStadium
    ? `穿堂風：場上有競技場 → ${dmg} 傷害`
    : '穿堂風：場上無競技場 → 60 傷害';
  return { state: addLog(state, msg, aIdx), damage: dmg };
});

// ── 群組 C：超級火炎獅ex｜大爆炸之火 ────────────────────────────────────────
// 卡面：減少這隻寶可夢身上放置的傷害指示物的數量×10點傷害（基礎 290−）。
//   傷害指示物數 = damage / 10，所以實際傷害 = max(0, 290 − attacker.damage)。
// 對應：M4 (18435) / 083 (18534)，共用同一招式名稱一條 regPre 覆蓋。
regPre('超級火炎獅ex|大爆炸之火', (state, aIdx) => {
  const attacker = state.players[aIdx].active;
  const selfDamage = attacker?.damage ?? 0;
  const counters = selfDamage / 10;
  const dmg = Math.max(0, 290 - selfDamage);
  const s = addLog(
    state,
    `大爆炸之火：自身 ${counters} 個傷害指示物 → ${dmg} 傷害`,
    aIdx,
  );
  return { state: s, damage: dmg };
});

// ── 群組 D：妙喵｜拍檔攻擊 ───────────────────────────────────────────────────
// 卡面：在這個回合，若從手牌使出了「瑪琪艾兒」，則增加60點傷害（10 + 60 = 70）。
// 對應：M4 (18456)，M3 妙喵 的招式名稱為「小憩/踩」不受影響。
// 依賴：PlayerState.magearnaPlayedThisTurn（由 v172_hij_batch.ts 瑪琪艾兒 resolver 設定）。
regPre('妙喵|拍檔攻擊', (state, aIdx) => {
  const hasMagearna = state.players[aIdx].magearnaPlayedThisTurn ?? false;
  const dmg = hasMagearna ? 70 : 10;
  const msg = hasMagearna
    ? `拍檔攻擊：本回合有使用瑪琪艾兒 → ${dmg} 傷害`
    : '拍檔攻擊：本回合無使用瑪琪艾兒 → 10 傷害';
  return { state: addLog(state, msg, aIdx), damage: dmg };
});

// ── 群組 E：河馬獸｜龍捲風噴射 ───────────────────────────────────────────────
// 卡面：80 傷害。在這個回合，若從手牌使出了「塔拉剛」，則將對手的牌庫上方3張卡丟棄。
// 對應：M3 (18016)。
// 依賴：PlayerState.talarongPlayedThisTurn（由 six_decks.ts 塔拉剛 resolver 設定）。
// 注意：pre 固定 80（純傷害）由 engine 內建處理；post 只處理磨庫效果。
regPost('河馬獸|龍捲風噴射', (state, aIdx, pool) => {
  if (!(state.players[aIdx].talarongPlayedThisTurn ?? false)) {
    return state; // 本回合未使用塔拉剛，無磨庫效果
  }
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppDeck = state.players[dIdx].deck;
  const count = Math.min(3, oppDeck.length);
  if (count === 0) {
    return addLog(state, '龍捲風噴射：塔拉剛效果 → 對手牌庫已空，無法丟棄', aIdx);
  }
  const milled = oppDeck.slice(0, count);
  const milledNames = milled.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = updatePlayer(state, dIdx, p => ({
    ...p,
    deck: p.deck.slice(count),
    discard: [...p.discard, ...milled],
  }));
  s = addLog(
    s,
    `龍捲風噴射：塔拉剛效果 → 將對手牌庫上方 ${count} 張（${milledNames}）丟棄`,
    aIdx,
  );
  // v2.388 堅果啞鈴｜整人擊落 trigger
  s = triggerOakeyeMillIfApplicable(s, dIdx, milled, pool);
  return s;
});

// ── 群組 F：代歐奇希斯｜精神防護 ────────────────────────────────────────────
// 卡面：80 傷害。在下個對手的回合，這隻寶可夢不會受到擁有特性的寶可夢招式的傷害。
// 對應：M4 (18453) 特定版本（其他代歐奇希斯 有不同招式名稱）。
// 免疫判斷在 engine.ts 攻擊管線：immuneToAbilityPokemonThisTurn 旗標。
// 旗標生命週期：後 regPost 設 NextTurn → END_TURN promote → ThisTurn → 對手 END_TURN 清除。
regPost('代歐奇希斯|精神防護', (state, aIdx) => {
  // 在自身 active 上設 immuneToAbilityPokemonNextTurn 旗標
  let s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, immuneToAbilityPokemonNextTurn: true } };
  });
  return addLog(
    s,
    '精神防護：下個對手回合，此寶可夢不受擁有特性的寶可夢招式傷害',
    aIdx,
  );
});

// ── 群組 G：具甲武者｜要害斬 ─────────────────────────────────────────────────
// 卡面：30 傷害。若對手的寶可夢因這個招式的傷害而【昏厥】了，則在下個對手的回合，
//   這隻寶可夢不會受到招式的傷害與效果的影響。
// 對應：M4 (18446)。
// KO 判斷：regPost 執行時 defender.active === null 表示已被 KO。
// 免疫判斷在 engine.ts 攻擊管線：immuneToAllAttackThisTurn 旗標（baseDamage=0 + skipDefEffects）。
// 旗標生命週期：post 設 NextTurn → END_TURN promote → ThisTurn → 對手 END_TURN 清除。
regPost('具甲武者|要害斬', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  // 若對手戰鬥位寶可夢未被 KO（active 仍存在），則無效果
  if (state.players[dIdx].active !== null) return state;
  // 對手被 KO → 在自身 active 設 immuneToAllAttackNextTurn 旗標
  let s = updatePlayer(state, aIdx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, immuneToAllAttackNextTurn: true } };
  });
  return addLog(
    s,
    '要害斬：對手昏厥 → 下個對手回合，具甲武者不受招式傷害與效果影響',
    aIdx,
  );
});

// ── 群組 H：小木靈｜怨恨進化 ────────────────────────────────────────────────
// 特性：在自己的回合時可使用1次。從自己的手牌選擇1張從這隻寶可夢進化而來的卡，
//   放置於這隻寶可夢身上完成進化。然後，在完成進化的寶可夢身上放置2個傷害指示物。
//   （無法在自己的最初回合使用。）
// 對應：M-P-J (18513)。
// 注意：進化流程仿 engine.ts EVOLVE + v172_hij_batch.ts sturdy-might-tree-step1。

regA('小木靈', 0, (state, aIdx, pool, inst) => {
  if (!inst) return state; // 型別安全
  // v5.192：「無法在自己的最初回合使用」gate（defense-in-depth；engine getUsableAbilities 已 gate）
  if (isOwnFirstTurn(state)) {  // v5.608 收斂走中央判定（turn===1 涵蓋雙方第1回合）
    return addLog(state, '怨恨進化：無法在自己的最初回合使用', aIdx);
  }
  const p = state.players[aIdx];
  const thisCard = pool.get(inst.cardId);
  if (!thisCard) return state;

  // 找出手牌中可從此寶可夢進化的卡（evolvesFrom === '小木靈'）
  const evoIids = p.hand
    .filter(c => {
      const card = pool.get(c.cardId);
      return (
        card?.supertype === 'Pokemon' &&
        card.evolvesFrom != null &&
        sameEvoName(card.evolvesFrom, thisCard.name)
      );
    })
    .map(c => c.iid);

  if (evoIids.length === 0) {
    return addLog(state, '怨恨進化：手牌中沒有可進化的卡，效果無效', aIdx);
  }

  state = addLog(state, '怨恨進化：從手牌選擇 1 張進化卡進化此小木靈', aIdx);
  return withPending(state, {
    type: 'hand-choose',
    actorIdx: aIdx,
    sourcePlayerIdx: aIdx,
    minCount: 1,
    maxCount: 1,
    effectKey: 'phantump-grudge-evolve',
    params: {
      validIids: evoIids,
      targetIid: inst.iid, // 記錄小木靈 iid，resolver 用於精確定位目標
      titleOverride: '怨恨進化：選 1 張進化卡',
    },
  });
});

// 怨恨進化 resolver — 從手牌取進化卡，在場上完成進化並放 2 個傷害指示物
regR('phantump-grudge-evolve', (state, aIdx, iids, params, pool) => {
  const pickedIid = iids[0];
  if (!pickedIid) return state; // 玩家取消選擇

  const targetIid = params?.targetIid as string | undefined;
  const p = state.players[aIdx];

  // 找出手牌中被選取的進化卡
  const evoInst = p.hand.find(c => c.iid === pickedIid);
  if (!evoInst) return state;
  const evoCard = pool.get(evoInst.cardId);
  if (!evoCard || !evoCard.evolvesFrom) {
    return addLog(state, '怨恨進化：選擇的卡片不是有效的進化卡，效果失敗', aIdx);
  }

  // 找出場上的小木靈：優先用 targetIid 精確定位，再退回名稱匹配
  const allPokes: CardInstance[] = [
    ...(p.active ? [p.active] : []),
    ...p.bench,
  ];
  const base = targetIid
    ? allPokes.find(c => c.iid === targetIid)
    : allPokes.find(c => {
        const card = pool.get(c.cardId);
        return card != null && sameEvoName(evoCard.evolvesFrom!, card.name);
      });

  if (!base) {
    return addLog(state, '怨恨進化：找不到目標小木靈，效果失敗', aIdx);
  }

  const baseCard = pool.get(base.cardId);
  const isActive = p.active?.iid === base.iid;

  // 建構進化後實例（仿 engine.ts EVOLVE 流程）
  const prevStack = base.evolvedFromStack ?? [];
  const baseBare: CardInstance = {
    ...base,
    energyAttached: [],
    toolAttached: undefined,
    evolvedFromStack: undefined,
  };
  const evolved: CardInstance = buildEvolvedInstance(base, evoInst, state, pool, { extraDamage: 20 });

  // 從手牌移除進化卡，並在場上以 evolved 取代 base
  state = updatePlayer(state, aIdx, x => ({
    ...x,
    hand: x.hand.filter(c => c.iid !== pickedIid),
    active: isActive ? evolved : x.active,
    bench: isActive
      ? x.bench
      : x.bench.map(c => (c.iid === base.iid ? evolved : c)),
  }));

  return addLog(
    state,
    `怨恨進化：${baseCard?.name ?? '小木靈'} 進化為 ${evoCard.name}，放置 2 個傷害指示物（+20 damage）`,
    aIdx,
  );
});
