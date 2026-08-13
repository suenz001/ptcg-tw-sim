/**
 * v2.112 + v2.113 六組新 preset 的卡片效果 — 23 張實裝（含能量）。
 *
 * 對應 preset：N的索羅亞克 / 火焰雞多龍 / 夠讚狗 / 顫弦蠑螈 / 蒼炎刃鬼 / 超級甲賀忍蛙。
 *
 * v2.112：撕裂 / 亂暴閃電 / 二連踢 / 燃燒旋踢 / 滿月輪舞 / 死亡終局（6 張 attack）
 * v2.113：17 張（寶可夢招式 8 + ability 4 + Trainer 7 + 特殊能量 engine inline）
 *   - Passive（engine hook）：夠讚狗｜腎上腺力量（PASSIVE_ATTACK_BONUS + effectiveHP）、
 *     蓋諾賽克特｜ACE消弭（canPlayTrainer gate）
 *   - 特殊能量（engine canAffordAttack inline）：稜鏡能量 / 新衝天能量
 */
import { tryPromptPromoteActive, damageCounterCount } from '../_shared';
import { deckWithCardsToBottom } from '../_shared'; // v6.124 「放回牌庫下方」中央管線 // v5.785 指示物個數中央
import { copyAttackPostDispatch } from '../_shared';
import { isReturnToHandBlockedByCalmGround as _calmGroundBlocks } from './v3080_deferred_wave_c'; // v5.986 場上卡→手牌中央述詞
import { joinCardNames, toBareCard } from '../_shared';  // v5.515 丟棄 log 顯示卡名 / v5.993 rescue 回手裸化
import { attachEnergyFromZoneToOwnPokemon } from '../_shared';  // ⭐ v6.174 附能目標解析失敗一律 no-op（禁半套：能量已離開來源區卻沒附上）
import { recruitBasicToBenchPost } from '../../effects';  // v6.067 呼朋引伴族中央 helper
import { applyMagearnaHandAttachHeal } from './v3000_g3_wave2';
import type { PlayerState, GameState, CardInstance } from '../../types';
import { canApplyEffectToTarget } from '../../defense';
import { isBasicPokemonCard } from '../../engine';  // v5.270: 毒電嬰呼朋引伴 pre-scan basic
import type { Card } from '$lib/cards/types';
import { regPre, regPost, regA, reg, regR, regG, addLog, addPrivateLog, drawCards, withPending, updatePlayer, applyBenchPlaceSideEffects, ATTACK_PRE, ATTACK_POST, ATTACK_PRE_DISCARD_CHOICE, discardActiveStadium, shuffle, getOwnBenchLimit,
  fireOnHandEnergyAttached, // v5.539 從手牌附能後觸發對手附能被動
  rejectAbilityUse,         // ⭐v6.181 中央「拒絕出口」
} from '../_shared';
import { skipDefEffectsPre, coinHeadsMultiplyPre, bothBenchMultiplyPre, canApplyAttackEffectToTarget, isBenchProtected, dealAttackDamageToTarget, koTargetByAttackEffect, clearActiveEffects, resolveOptInPayment } from '../../effects'; // v5.992 若希望 opt-in 中央管線

// ─── 撕裂 70（skipDefEffects）───────────────────────────────────────────────
regPre('N的捷克羅姆|撕裂', skipDefEffectsPre(70, '撕裂'));

// ─── 亂暴閃電 250 + 「這隻寶可夢」下回合無法攻擊（個體 level）─────────────
// v3.73 bug fix：原本誤用 player-level noAttacksNextTurn → 撤退換上備戰另一隻
// N的索羅亞克ex 也會被卡（暗黑底牌借這招的場景）。卡面「這隻寶可夢」是個體 level，
// 應設 active.cantAttackPending（綁 CardInstance），撤退時 clearActiveEffects 會清。
regPost('N的捷克羅姆|亂暴閃電', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, cantAttackPending: true };
  players[aIdx] = att;
  return addLog({ ...state, players }, '亂暴閃電：下個自己的回合，這隻寶可夢無法使用招式', aIdx);
});

// ─── 二連踢 40×（coin heads multiply）───────────────────────────────────────
regPre('力壯雞|二連踢', coinHeadsMultiplyPre(2, 40, '二連踢'));

// ─── 燃燒旋踢 200 + 「這隻寶可夢」下回合無法攻擊（個體 level）─────────────
// v3.73 bug fix（同亂暴閃電根因）：卡面「這隻寶可夢」應綁 CardInstance 而非 player。
regPost('火焰雞ex|燃燒旋踢', (state, aIdx) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) att.active = { ...att.active, cantAttackPending: true };
  players[aIdx] = att;
  return addLog({ ...state, players }, '燃燒旋踢：下個自己的回合，這隻寶可夢無法使用招式', aIdx);
});

// ─── 滿月輪舞 20 + 雙方備戰 × 20 ────────────────────────────────────────────
regPre('莉莉艾的皮皮ex|滿月輪舞', bothBenchMultiplyPre(20, 20, '滿月輪舞'));

// ─── 死亡終局：若對手戰鬥位傷害指示物「剛好 6 個」→ 直接昏厥（招式效果，不走 damage pipeline）
//     （官方=ちょうど6個，7 個以上不觸發；用 === 6，切勿誤改成 >= 6。test-exact-damage-counter-ko 守衛）
// 卡面：「若對手的戰鬥寶可夢身上放置的傷害指示物為 6 個，則將那隻寶可夢【昏厥】。」
// PTCG 規則：「將那隻寶可夢【昏厥】」是「招式效果」（直接昏厥），不是「招式傷害」。
//   不應被 damageReduceNextHit（整人擊落 / 順滑大衣）、PASSIVE_DAMAGE_IMMUNE（花之帷幔
//   / 抵抗之幕）或弱抗倍率干擾。
// v3.9992 修法：原 v2 用 damage = 9999 走 damage pipeline 是簡化實裝（違反 Iron Rule 7），
//   會被以上 damage modifier 誤擋。改為：
//   1. regPre：damage = 0（招式本身不造成傷害）
//   2. regPost：條件達成 → canApplyAttackEffectToTarget 檢查招式效果免疫 →
//      直接寫 damage = 99999 到 active 上，繞過所有 damage modifier，
//      由 ATTACK pipeline 末尾的 sanityKOSweep 處理 KO 與獎賞卡計算。
// v5.785：卡面「為 6 個」= 剛好 6 個（Wilson 裁定，7 個以上不觸發）。用 damageCounterCount === 6。
regPre('超級阿勃梭魯ex|死亡終局', (s) => ({ state: s, damage: 0 }));
regPost('超級阿勃梭魯ex|死亡終局', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const def = state.players[dIdx].active;
  if (!def) return state;
  if (damageCounterCount(def) !== 6) {
    // v5.785：卡面「為 6 個」= 剛好 6 個（Wilson 裁定）。7 個以上不觸發。
    return addLog(state, `死亡終局：對手戰鬥寶可夢傷害指示物 ${damageCounterCount(def)} 個（非剛好 6 個），效果未觸發`, aIdx);
  }
  // v4.58：改 unified('attack-effect', isBench:false) — 行為等價
  const defCard = pool.get(def.cardId);
  const guard = canApplyEffectToTarget(state, aIdx, def, defCard, 'attack-effect', pool, { isBench: false });
  if (guard.blocked) {
    return addLog(state, `死亡終局：${defCard?.name ?? '?'}｜${guard.reason}（不昏厥）`, aIdx);
  }
  // v5.522：效果KO收斂中央 koTargetByAttackEffect（深淵之瞳式：搬棄牌+recordOppKO+addPendingPrize，不走 damage 管線）
  return koTargetByAttackEffect(
    addLog(state, '死亡終局：對手戰鬥寶可夢傷害指示物剛好 6 個 → 直接昏厥（招式效果）', aIdx),
    aIdx, def, true, pool, '死亡終局',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// v2.113 第二批實裝
// ═══════════════════════════════════════════════════════════════════════════

// ─── 寶可夢招式 ────────────────────────────────────────────────────────────

// N的達摩狒狒｜復燃 — 對手棄牌區基本能量 × 30
regPre('N的達摩狒狒|復燃', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  let n = 0;
  for (const c of state.players[dIdx].discard) {
    const card = pool.get(c.cardId);
    if (card?.supertype === 'Energy' && card?.subtype === 'Basic') n++;
  }
  return { state: addLog(state, `復燃：對手棄牌區基本能量 ${n} 張 → ${n*30} 傷害`, aIdx), damage: n * 30 };
});

// N的達摩狒狒｜火人加農炮 90（自棄所有能量 + 對手 1 備戰 90）— 用 regPost 後續
// v2.132：修簽名 (state, aIdx, _dmg, pool) → (state, aIdx, pool)
regPost('N的達摩狒狒|火人加農炮', (state, aIdx, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const att = { ...players[aIdx] };
  if (att.active) {
    const discarded = att.active.energyAttached;
    att.active = { ...att.active, energyAttached: [] };
    att.discard = [...att.discard, ...discarded];
    players[aIdx] = att;
    if (discarded.length > 0) {
      state = addLog({ ...state, players }, `火人加農炮：丟棄 ${discarded.length} 張能量卡`, aIdx);
    } else {
      state = { ...state, players };
    }
  }
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) {
    return addLog(state, '火人加農炮：對手無備戰寶可夢', aIdx);
  }
  return withPending(addLog(state, '火人加農炮：對 1 隻對手備戰寶可夢造成 90 傷害', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'fire-cannon-90',
    params: { damage: 90 },
  });
});
regR('fire-cannon-90', (state, aIdx, selectedIids, params, pool) => {
  // v5.386：改走中央 dealAttackDamageToTarget — 補上原本漏掉的備戰免疫 guard
  //   （花之帷幔/球形盾牌/太晶/對戰圓形/藏隱/深度下潛/羽毛化石 等備戰傷害免疫）。
  const dmg = (params?.damage as number) ?? 90;
  let s = state;
  for (const iid of selectedIids) {
    s = dealAttackDamageToTarget(s, aIdx, iid, dmg, pool, { kind: 'attack-damage', label: '火人加農炮' });
  }
  return s;
});

// N的扒手貓｜暗槓 30 — 查對手手牌 → 選 1 張放對手牌庫「下方」
// v2.239 釐清（不再簡化）：技術上 reuse hand-discard pending（已含「查看對手手牌 + 限定 iid」邏輯，
//   不需新增 pending type）；resolver 把該卡 push 到 opp.deck 末端 = 牌庫下方。
//   加 titleOverride 讓 UI 顯示「選 1 張放回對手牌庫下方」而非預設「選擇丟棄的手牌」。
//
// v2.132：原 postFn 簽名寫成 `(state, aIdx, _dmg, pool)` — 多塞 _dmg → pool 變 undefined →
//   `pool.get(...)` 拋 TypeError → 整個 dispatch 失敗 → 連 30 傷害都沒套（Leon 透過
//   暗黑底牌 copy-attack 觸發而看到「沒造成傷害也沒抽手牌」）。修為正確簽名 `(state, aIdx, pool)`。
regPost('N的扒手貓|暗槓', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  if (oppHand.length === 0) return addLog(state, '暗槓：對手手牌為空', aIdx);
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v3.9992：揭示對手手牌改 addPrivateLog — 對手知道自己手牌（無感），但觀戰者不該揭示
  state = addPrivateLog(state,
    `暗槓：查看對手手牌 — ${handNames}`,
    `暗槓：查看對手手牌（${oppHand.length} 張）`,
    aIdx);
  return withPending(state, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'lie-cheat-to-deck-bottom',
    params: {
      validIids: oppHand.map(c => c.iid),
      titleOverride: '暗槓：選 1 張放回對手牌庫下方',
    },
  });
});
regR('lie-cheat-to-deck-bottom', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const opp = { ...players[dIdx] };
  const pick = opp.hand.find(c => selectedIids.includes(c.iid));
  if (!pick) return addLog(state, '暗槓：未選取卡', aIdx);
  opp.hand = opp.hand.filter(c => c.iid !== pick.iid);
  // v6.124 收斂：卡面「放回對手的牌庫下方」沒有「重洗」→ keep-order。
  opp.deck = deckWithCardsToBottom(opp.deck, [pick], 'keep-order');
  players[dIdx] = opp;
  const name = pool.get(pick.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `暗槓：將對手的 ${name} 放回對手牌庫下方`, aIdx);
});

// 毒電嬰｜呼朋引伴 — 牌庫搜 ≤2【基礎】寶可夢放備戰
// v5.270: 牌庫內有 basic 可選時 minCount=min(maxN,1) (至少選 1, 不可跳過);
//   牌庫沒有 basic 時直接 log 跳過 (避免手機版 picker maxCount=1+minCount=0 卡確認 button)
// v6.067：收斂到中央 recruitBasicToBenchPost（與 M6 電擊獸｜呼朋引伴 卡面逐字相同，共用同一份）。
//   行為不變：benchLimit gate → 牌庫預掃 → deck-search picker（minCount=0，卡面「最多」可選 0 張）。
regPost('毒電嬰|呼朋引伴', recruitBasicToBenchPost(2, '呼朋引伴'));
regR('recruit-to-bench', (state, aIdx, selectedIids, _params, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  // v5.254：server-side guard — 剔除非基礎寶可夢 (防 client picker 漏 filter / AI fall-through)
  //   卡面: 呼朋引伴只能放「基礎」寶可夢到備戰
  const rawPicks = p.deck.filter(c => selectedIids.includes(c.iid));
  const picks: typeof rawPicks = [];
  const rejected: string[] = [];
  for (const pk of rawPicks) {
    if (isBasicPokemonCard(pool.get(pk.cardId))) {
      picks.push(pk);
    } else {
      rejected.push(pool.get(pk.cardId)?.name ?? '?');
    }
  }
  // 從 deck 移除「實際採用的」 picks (rejected 留在 deck 等重洗)
  const acceptedIids = new Set(picks.map(c => c.iid));
  p.deck = p.deck.filter(c => !acceptedIids.has(c.iid));
  const actuallyPlacedIids: string[] = [];
  // v3.78：用 getOwnBenchLimit
  const benchLimit = getOwnBenchLimit(state, aIdx, pool);
  for (const pk of picks) {
    if (p.bench.length < benchLimit) {
      p.bench = [...p.bench, { ...pk, justPlaced: true }];
      actuallyPlacedIids.push(pk.iid);
    }
  }
  // 重洗牌庫
  p.deck = shuffle([...p.deck]);
  players[aIdx] = p;
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  let s = addLog({ ...state, players }, `呼朋引伴：從牌庫放 ${picks.length} 張基礎寶可夢到備戰（${names}），並重洗牌庫`, aIdx);
// v5.866 險惡廢墟改走 applyAction 出口中央偵測
  return s;
});

// 超級阿勃梭魯ex｜惡之鉤爪 200 — 看對手手牌棄 1
// v2.132：修簽名（_dmg 多餘 → pool 變 undefined → throw）
regPost('超級阿勃梭魯ex|惡之鉤爪', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const oppHand = state.players[dIdx].hand;
  if (oppHand.length === 0) return addLog(state, '惡之鉤爪：對手手牌為空', aIdx);
  const handNames = oppHand.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // v3.9992：揭示對手手牌改 addPrivateLog — 對手知道自己手牌（無感），但觀戰者不該揭示
  state = addPrivateLog(state,
    `惡之鉤爪：查看對手手牌 — ${handNames}`,
    `惡之鉤爪：查看對手手牌（${oppHand.length} 張）`,
    aIdx);
  return withPending(state, {
    type: 'hand-discard',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'evil-claw-opp-discard',
    params: { validIids: oppHand.map(c => c.iid) },
  });
});
regR('evil-claw-opp-discard', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const opp = { ...players[dIdx] };
  const pick = opp.hand.find(c => selectedIids.includes(c.iid));
  if (!pick) return addLog(state, '惡之鉤爪：未選取', aIdx);
  opp.hand = opp.hand.filter(c => c.iid !== pick.iid);
  opp.discard = [...opp.discard, pick];
  players[dIdx] = opp;
  const name = pool.get(pick.cardId)?.name ?? '?';
  return addLog({ ...state, players }, `惡之鉤爪：棄掉對手的 ${name}`, aIdx);
});

// 火箭隊的狃拉｜暗算 — 對手 1 備戰 × (其身上傷害指示物數量) × 20（不計弱抗）
regPost('火箭隊的狃拉|暗算', (state, aIdx) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (state.players[dIdx].bench.length === 0) return addLog(state, '暗算：對手無備戰寶可夢', aIdx);
  return withPending(addLog(state, '暗算：對 1 隻對手備戰寶可夢造成（其傷害指示物數）×20 傷害', aIdx), {
    type: 'opp-bench-choose',
    actorIdx: aIdx, sourcePlayerIdx: dIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'ambush-snipe-by-counters',
  });
});
regR('ambush-snipe-by-counters', (state, aIdx, selectedIids, _params, pool) => {
  // v5.386：改走中央 dealAttackDamageToTarget — 補上原本漏掉的備戰免疫 guard。
  const dIdx = (1 - aIdx) as 0 | 1;
  const tgt = state.players[dIdx].bench.find(b => selectedIids.includes(b.iid));
  if (!tgt) return addLog(state, '暗算：目標無效', aIdx);
  const counters = Math.floor((tgt.damage ?? 0) / 10);
  const dmg = counters * 20;
  return dealAttackDamageToTarget(state, aIdx, tgt.iid, dmg, pool, { kind: 'attack-damage', label: `暗算（${counters} 個指示物）` });
});

// 超級甲賀忍蛙ex｜忍者飛旋 — 卡面：「若希望，將 1 個這隻寶可夢身上附加的【水】能量放回手牌，增加 80 點傷害。」
// v5.992 中央收斂：改 binary-yes-no + optInPay（Wilson 裁定比照金屬之錘 QA：
//   opt-in 一律可選；0【水】能量也 +80（付出與加傷為獨立事件）；有水 → 強制放回 min(1, 持有)。
//   UI 一段 yes/no、二段自動全付/0 付 sentinel/超額 picker，由 spec.optInPay 一般化驅動）。
//   舊版 v2.251~v5.991：attacker picker + exactRequired=1 — 0 水時 picker 空、玩家拿不到 +80
//   （玩家回報：皮可西｜揮指 借此招 0 水複製只打 120，即此缺口）。
ATTACK_PRE_DISCARD_CHOICE.set('超級甲賀忍蛙ex|忍者飛旋', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 120, damagePerEnergy: 0,
  choicePrompt: '是否將 1 個【水】能量放回手牌，增加 80 點傷害？（若身上無【水】能量，仍 +80）',
  choiceYesLabel: '是（+80 傷害）',
  choiceNoLabel: '否（僅 120 傷害）',
  verb: 'return-to-hand', // 卡面：「將 1 個【水】能量放回手牌」
  optInPay: { payMax: 1, scope: 'attacker', verb: 'return-to-hand', energyTypeFilter: 'Water', countMode: 'units' },
});
regPre('超級甲賀忍蛙ex|忍者飛旋', (state, aIdx, pool, action) => {
  const pay = ATTACK_PRE_DISCARD_CHOICE.get('超級甲賀忍蛙ex|忍者飛旋')!.optInPay!;
  const blocked = _calmGroundBlocks(state, aIdx, pool); // v5.986 平穩境地：能量無法放回手牌
  const r = resolveOptInPayment(state, aIdx, pool, action, '忍者飛旋', pay, { aiDefault: 'skip', blockPayment: blocked });
  if (!r.optedIn) return { state: addLog(r.state, '忍者飛旋：未選擇加成 → 120 傷害', aIdx), damage: 120 };
  // v5.994 Wilson 裁定：付出與加傷獨立 → 平穩境地擋回手時,能量留身但加傷仍照給。
  if (r.paymentBlocked) return { state: addLog(r.state, '忍者飛旋：對手場上有【平穩境地】，能量無法放回手牌，依裁定仍 +80 → 200 傷害', aIdx), damage: 200 };
  if (r.paidCount === 0) return { state: addLog(r.state, '忍者飛旋：身上無【水】能量，依裁定仍 +80 → 200 傷害', aIdx), damage: 200 };
  return { state: addLog(r.state, '忍者飛旋：將 1 張【水】能量放回手牌 → +80 = 200 傷害', aIdx), damage: 200 };
});

// ─── Abilities（寶可夢特性，regA 1/回合）────────────────────────────────────

// N的索羅亞克ex｜交易 — 棄 1 手牌 → 抽 2
//   卡面：「在自己的回合，若將自己的 1 張手牌丟棄，則可使用 1 次。從自己的牌庫抽出 2 張卡。」
//   v2.131：原 gate 寫 `< 2` 是錯的（卡面只需 1 張可丟）；改為 `=== 0`。
//          getUsableAbilities 也加同樣的 gate（無手牌或牌庫空就隱藏按鈕）。
regA('N的索羅亞克ex', 0, (st, idx) => {
  if (st.players[idx].hand.length === 0) return rejectAbilityUse(st, '交易：手牌為空，無法丟棄', idx);
  if (st.players[idx].deck.length === 0) return rejectAbilityUse(st, '交易：牌庫為空', idx);
  st = addLog(st, '交易：選 1 張手牌丟棄 → 抽 2 張', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'trade-draw-2',
  });
});
regR('trade-draw-2', (state, aIdx, selectedIids, _params, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.hand.filter(c => selectedIids.includes(c.iid));
  p.hand = p.hand.filter(c => !selectedIids.includes(c.iid));
  p.discard = [...p.discard, ...picks];
  players[aIdx] = p;
  let s = addLog({ ...state, players }, `交易：丟棄 ${joinCardNames(picks, pool)}`, aIdx);  // v5.515 顯示卡名
  s = drawCards(s, aIdx, 2);
  return addLog(s, '交易：抽 2 張', aIdx);
});

// 火焰雞ex｜沸騰鬥志 — 棄牌區選 1 基本能量附給自己寶可夢（1/回合）
// v2.117 修：原實裝用了不存在的 pending type 'attach-energy-own-any' 導致 UI 卡住，
//   且 gate 只寫在 fn 內部（按了才跳 log）。改為：
//   - Step 1: discard-search / BasicEnergy 選能量
//   - Step 2: heal-target + validIids=全部自己寶可夢 → 選附加目標
//   - engine getAvailableAbilities gate（棄牌區有基本能量才顯示按鈕，同「充能」pattern）
// 註：ability gate 在 engine.ts 端維護，這裡只做安全檢查（雙重保險）。
regA('火焰雞ex', 0, (st, idx, pool) => {
  const hasBasicEnergy = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (!hasBasicEnergy) return addLog(st, '沸騰鬥志：棄牌區無基本能量', idx);
  st = addLog(st, '沸騰鬥志：從棄牌區選 1 張基本能量附給 1 隻自己的寶可夢', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'blaziken-boiling-pick-energy',
  });
});
regR('blaziken-boiling-pick-energy', (state, aIdx, selectedEnergyIids) => {
  const p = state.players[aIdx];
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  return withPending(state, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'blaziken-boiling-attach',
    params: {
      energyIids: selectedEnergyIids,
      validIids: allMy.map(c => c.iid),
      titleOverride: '選擇附加能量的寶可夢（沸騰鬥志）',
    },
  });
});
// ⭐⭐⭐ v6.174（玩家回報：錦標賽「薪水小偷 R2」對局卡住，log 出現「沸騰鬥志：將 基本【超】能量 附給 ?」）
//   原實作先把能量從棄牌區 filter 掉、再用 selectedPokeIids[0] 找目標，找不到就只把名字寫成 `?`
//   ⇒ 能量既沒回棄牌區也沒附到任何寶可夢，**整張卡從遊戲中消失**。
//   改走中央 attachEnergyFromZoneToOwnPokemon：先解析、全成功才動盤面，失敗一律完全 no-op。
//   卡面（SVM 12086）：「從自己的棄牌區選擇1張基本能量卡，附於自己的寶可夢身上。」
//   → 來源 discard、目標不限備戰/戰鬥場、無額外傷害。
regR('blaziken-boiling-attach', (state, aIdx, selectedPokeIids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  return attachEnergyFromZoneToOwnPokemon(
    state, aIdx, 'discard', energyIids[0], selectedPokeIids[0], pool, '沸騰鬥志',
  ).state;
});

// 龜足巨鎧｜岩石武裝 — 手牌選 1 張「基本【鬥】能量」附給自己的【鬥】寶可夢（1/回合）
// v2.117 修：pending type 改 heal-target + validIids（限【鬥】寶可夢）
// v2.226 / v2.239 釐清（不再簡化）：
//   gate（getUsableAbilities + 此處）已確保手牌有基本【鬥】能量、場上有【鬥】寶可夢。
//   所有候選都是「基本【鬥】能量」（cardId 雖可能不同但 game state 等效），
//   自動取手牌第 1 張與玩家手選功能等效；不開 hand-discard 也避免 Leon 誤解為「棄牌」。
//   直接開 heal-target 選目標寶可夢，resolver 自動取手牌第 1 張基本【鬥】能量附過去。
regA('龜足巨鎧', 0, (st, idx, pool) => {
  const hasFighting = st.players[idx].hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【鬥】/.test(card.name);
  });
  if (!hasFighting) return addLog(st, '岩石武裝：手牌無基本【鬥】能量', idx);
  const p = st.players[idx];
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  // v5.184：詛咒根擋手牌附能 — filter 受詛咒根影響的【鬥】寶可夢
  const fightPokes = allMy.filter(c => pool.get(c.cardId)?.pokemonType === 'Fighting' && !c.cantAttachEnergyThisTurn);
  if (fightPokes.length === 0) return rejectAbilityUse(st, '岩石武裝：場上無可附能的【鬥】寶可夢', idx);
  st = addLog(st, '岩石武裝：選擇 1 隻【鬥】寶可夢，從手牌附 1 張基本【鬥】能量', idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'rock-armor-attach',
    params: {
      validIids: fightPokes.map(c => c.iid),
      titleOverride: '選擇附加能量的【鬥】寶可夢（岩石武裝）',
    },
  });
});
// ⭐ v6.174 同 sweep：目標解析失敗時原本會把手牌那張基本【鬥】能量吃掉（同「附給 ?」型）。
//   卡面（M3 18019 / M-P-J 18070）：「從自己的手牌選擇1張『基本【鬥】能量』卡，附於自己的【鬥】寶可夢身上。」
regR('rock-armor-attach', (state, aIdx, selectedPokeIids, _params, pool) => {
  const p = state.players[aIdx];
  // v2.226：自動取手牌第 1 張基本【鬥】能量（gate 保證至少有 1 張）
  const energy = p.hand.find(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【鬥】/.test(card.name);
  });
  if (!energy) return addLog(state, '岩石武裝：手牌無基本【鬥】能量', aIdx);
  // v5.184：詛咒根擋手牌附能 — 與 gate 同一份條件（resolver 自驗，禁只信 client 送的 iid）
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  const allowed = allMy
    .filter(c => pool.get(c.cardId)?.pokemonType === 'Fighting' && !c.cantAttachEnergyThisTurn)
    .map(c => c.iid);
  const r = attachEnergyFromZoneToOwnPokemon(
    state, aIdx, 'hand', energy.iid, selectedPokeIids[0], pool, '岩石武裝',
    { allowedTargetIids: allowed },
  );
  if (!r.ok) return r.state;
  const pIid = r.target!.iid;
  // v5.539：從手牌附能後觸發對手附能被動（侵蝕詛咒 等）
  return fireOnHandEnergyAttached(
    applyMagearnaHandAttachHeal(r.state, aIdx, [pIid], pool),  // v5.485 自動治癒
    aIdx, pIid, pool);
});

// 顫弦蠑螈｜惡棍衝天 — 牌庫選 1 張「基本【惡】能量」附給備戰區【惡】寶可夢 + 重洗 + 放 2 傷
// v2.117 修：filter 'BasicDarknessEnergy' engine 不認得 → 改用 'Energy:Darkness'。
//   pending type 'attach-energy-bench-dark' 不存在 → 改用 heal-target + validIids（限備戰【惡】）。
regA('顫弦蠑螈', 0, (st, idx, pool) => {
  if (st.players[idx].deck.length === 0) return rejectAbilityUse(st, '惡棍衝天：牌庫為空', idx);
  const hasDarkBench = st.players[idx].bench.some(b => {
    const card = pool.get(b.cardId);
    return card?.pokemonType === 'Darkness';
  });
  if (!hasDarkBench) return addLog(st, '惡棍衝天：備戰無【惡】寶可夢', idx);
  // v2.324: 即使不確定有無惡能量也要讓玩家搜尋（可檢視牌庫 + 重洗）— PTCG 隱藏資訊規則
  st = addLog(st, '惡棍衝天：從牌庫搜尋 1 張基本【惡】能量附給備戰【惡】寶可夢（+2 傷害）', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Energy:Darkness',
    minCount: 0, maxCount: 1,
    effectKey: 'rascal-skyward-pick',
  });
});
regR('rascal-skyward-pick', (state, aIdx, selectedIids, _params, pool) => {
  const p = state.players[aIdx];
  if (selectedIids.length === 0) {
    let s = updatePlayer(state, aIdx, pl => ({ ...pl, deck: shuffle([...pl.deck]) }));
    return addLog(s, '惡棍衝天：未選擇能量（重洗牌庫）', aIdx);
  }
  const darkBenchIids = p.bench.filter(b => pool.get(b.cardId)?.pokemonType === 'Darkness').map(b => b.iid);
  return withPending(state, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'rascal-skyward-attach',
    params: {
      energyIids: selectedIids,
      validIids: darkBenchIids,
      titleOverride: '選擇備戰【惡】寶可夢附加能量（惡棍衝天）',
    },
  });
});
// ⭐ v6.174 同 sweep：原本目標解析失敗時能量已從牌庫移除卻沒附上（卡片消失）。
//   卡面（M2 14375）：「從自己的牌庫選擇1張『基本【惡】能量』卡，附於備戰區的【惡】寶可夢身上。
//   並且重洗牌庫。然後，在附上那張卡的寶可夢身上放置2個傷害指示物。」
//   → 目標限「備戰區的【惡】」；傷害指示物 2 個 = 20；重洗牌庫是卡面獨立的一句，**無論有沒有附成功都要洗**。
regR('rascal-skyward-attach', (state, aIdx, selectedPokeIids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const p = state.players[aIdx];
  const allowed = p.bench.filter(b => pool.get(b.cardId)?.pokemonType === 'Darkness').map(b => b.iid);
  const r = attachEnergyFromZoneToOwnPokemon(
    state, aIdx, 'deck', energyIids[0], selectedPokeIids[0], pool, '惡棍衝天',
    { allowedTargetIids: allowed, extraDamage: 20 },
  );
  const shuffled = updatePlayer(r.state, aIdx, pl => ({ ...pl, deck: shuffle([...pl.deck]) }));
  return addLog(shuffled, r.ok ? '惡棍衝天：放置 2 個傷害指示物並重洗牌庫' : '惡棍衝天：重洗牌庫', aIdx);
});

// 超級甲賀忍蛙ex｜必殺手裡劍 — 若在戰鬥場、棄 1 水能量 → 對手 1 寶可夢放 6 傷
regA('超級甲賀忍蛙ex', 0, (st, idx, pool, cardInst) => {
  if (st.players[idx].active?.iid !== cardInst?.iid) {
    return rejectAbilityUse(st, '必殺手裡劍：這隻寶可夢必須在戰鬥場', idx);
  }
  const waterIdx = st.players[idx].hand.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' &&
      (card.pokemonType === 'Water' || /【水】/.test(card.name));
  });
  if (waterIdx < 0) return addLog(st, '必殺手裡劍：手牌無基本【水】能量', idx);
  // 棄能量
  const players = [...st.players] as [PlayerState, PlayerState];
  const p = { ...players[idx] };
  const energy = p.hand[waterIdx];
  p.hand = p.hand.filter((_, i) => i !== waterIdx);
  p.discard = [...p.discard, energy];
  players[idx] = p;
  st = addLog({ ...st, players }, '必殺手裡劍：丟棄 1 張基本【水】能量，在對手 1 隻寶可夢身上放 6 個傷害指示物', idx);
  // ⭐⭐⭐ v6.175 卡面逐字（M4 18442 / M-P-J 18516）：
  //   「若這隻寶可夢在戰鬥場，且在自己的回合，**從自己的手牌將1張「基本【水】能量」卡丟棄，
  //     則可使用1次**。在對手的1隻寶可夢身上放置6個傷害指示物。」
  //   ⇒ 丟能量是**使用條件（代價）**，卡面順序就是「先付代價 → 才可使用 → 然後放指示物」，
  //     所以這裡**不**改成「先選目標再付代價」（那會違背卡面）。
  //   站長真正要的是「代價付了、效果沒發生」不可以留在盤面上 ⇒ 改用**原子化**：
  //     目標解析不到（空選擇／iid 失效）⇒ resolver 把能量退回手牌並解除本回合已用標記，
  //     整個動作完全還原。免疫擋下（光之翼等）**不算解析失敗**：那是防禦方的能力，
  //     依站長 2026-08-07 裁定代價照付、效果不發動。
  //   ⚠ 同時補上 validIids —— 沒有 validIids 的 pending 完全不經中央消毒閘（v6.010/v6.174），
  //     等於這張卡對「錯位／竄改的 iid」毫無防線。
  const oppAll = [
    ...(st.players[(1 - idx) as 0 | 1].active ? [st.players[(1 - idx) as 0 | 1].active!] : []),
    ...st.players[(1 - idx) as 0 | 1].bench,
  ];
  return withPending(st, {
    type: 'opp-poke-choose',
    actorIdx: idx, sourcePlayerIdx: (1 - idx) as 0 | 1,
    minCount: 1, maxCount: 1,
    effectKey: 'greninja-shuriken-6',
    params: {
      validIids: oppAll.map(c => c.iid),
      paidEnergyIid: energy.iid,
      holderIid: cardInst?.iid,
    },
  });
});
regR('greninja-shuriken-6', (state, aIdx, selectedIids, _params, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const players = [...state.players] as [PlayerState, PlayerState];
  const def = { ...players[dIdx] };
  let name = '?';
  // ⭐⭐⭐ v6.175 原子化：解析不到目標 ⇒ **完全還原**（能量退回手牌 + 解除本回合已用標記）。
  //   原本是 `if (!target) return state;` —— 代價已經付掉、6 個指示物沒放、特性也用掉了，
  //   玩家淨損一張基本【水】能量與一次特性權（與火焰雞ex 同一種「半套盤面」）。
  {
    const _tid = selectedIids[0];
    // ⚠ Fable 5 審查：`_tid` 為 undefined 且 def.active 為 null 時 `undefined === undefined` 會誤判命中。
    const _hit = _tid != null && (def.active?.iid === _tid || def.bench.some(b => b.iid === _tid));
    if (!_hit) {
      const paidIid = _params?.paidEnergyIid as string | undefined;
      const holderIid = _params?.holderIid as string | undefined;
      const me = { ...players[aIdx] };
      const back = paidIid ? me.discard.find(c => c.iid === paidIid) : undefined;
      if (back) {
        me.discard = me.discard.filter(c => c.iid !== paidIid);
        me.hand = [...me.hand, back];
      }
      if (holderIid) {
        const unmark = (pk: CardInstance): CardInstance => {
          if (pk.iid !== holderIid || !pk.abilityUsedThisTurn) return pk;
          const n = { ...pk }; delete n.abilityUsedThisTurn; return n;
        };
        me.active = me.active ? unmark(me.active) : me.active;
        me.bench = me.bench.map(unmark);
      }
      players[aIdx] = me;
      return addLog({ ...state, players },
        '必殺手裡劍：沒有選到對手的寶可夢，效果未執行（基本【水】能量退回手牌，本回合仍可再使用）', aIdx);
    }
  }
  // v4.51 Phase 2：改用統一 canApplyEffectToTarget helper（kind='ability-effect'）
  //   - 涵蓋光之翼（self-only 擋特性效果，active + bench 都擋）
  //   - 涵蓋對戰圓形（bench-only 擋招式/特性的效果）
  //   - 球形盾牌 / 藏隱 等卡面寫「招式」不擋特性，N/A
  const targetIid = selectedIids[0];
  const isActive = def.active?.iid === targetIid;
  const target = isActive ? def.active : def.bench.find(b => b.iid === targetIid);
  if (!target) return state;
  const targetCard = pool.get(target.cardId);
  const guard = canApplyEffectToTarget(state, aIdx, target, targetCard, 'ability-effect', pool, { isBench: !isActive });
  if (guard.blocked) {
    players[dIdx] = def;
    return addLog({ ...state, players }, `必殺手裡劍：${targetCard?.name ?? '?'} ${guard.reason}，未放置傷害指示物`, aIdx);
  }
  if (isActive && def.active) {
    def.active = { ...def.active, damage: def.active.damage + 60 };
    name = targetCard?.name ?? '?';
  } else {
    def.bench = def.bench.map(b => {
      if (b.iid === targetIid) {
        name = pool.get(b.cardId)?.name ?? '?';
        return { ...b, damage: b.damage + 60 };
      }
      return b;
    });
  }
  players[dIdx] = def;
  return addLog({ ...state, players }, `必殺手裡劍：在 ${name} 身上放 6 個傷害指示物（60 傷）`, aIdx);
});

// ─── Trainer ──────────────────────────────────────────────────────────────

// N的ＰＰ提升劑（Item）— 棄牌區選 1 張基本能量附給備戰區的「N的」寶可夢
// v2.117 修：原實裝用了不存在的 pending type 'attach-energy-bench-n' 導致 follow-up 卡住；
//   gate 未註冊為 regG，UI 仍顯示黃框。改為：
//   - regG gate：棄牌區有基本能量 AND 備戰有 N的寶可夢
//   - Step 1: discard-search / BasicEnergy 選能量
//   - Step 2: heal-target + validIids=備戰 N的寶可夢 → 選目標
regG('N的ＰＰ提升劑', (st, idx, pool) => {
  const hasBasicE = st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic';
  });
  if (!hasBasicE) return false;
  const hasNBench = st.players[idx].bench.some(b => {
    const card = pool.get(b.cardId);
    return card?.name.startsWith('N的');
  });
  return hasNBench;
});
reg('N的ＰＰ提升劑', (st, idx) => {
  st = addLog(st, 'N的ＰＰ提升劑：從棄牌區選 1 張基本能量附給備戰「N的」寶可夢', idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'BasicEnergy',
    minCount: 1, maxCount: 1,
    effectKey: 'n-pp-pick-energy',
  });
});
regR('n-pp-pick-energy', (state, aIdx, selectedIids, _params, pool) => {
  const p = state.players[aIdx];
  const nBenchIids = p.bench.filter(b => pool.get(b.cardId)?.name.startsWith('N的')).map(b => b.iid);
  return withPending(state, {
    type: 'heal-target',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    minCount: 1, maxCount: 1,
    effectKey: 'n-pp-attach',
    params: {
      energyIids: selectedIids,
      validIids: nBenchIids,
      titleOverride: '選擇備戰「N的」寶可夢附加能量（N的ＰＰ提升劑）',
    },
  });
});
// ⭐ v6.174 同 sweep。卡面（MC 17106）：「從自己的棄牌區選擇1張基本能量卡，附於備戰區的『N的寶可夢』身上。」
//   → 來源 discard、目標限「備戰區」且卡名以「N的」開頭。
regR('n-pp-attach', (state, aIdx, selectedPokeIids, params, pool) => {
  const energyIids = (params?.energyIids as string[]) ?? [];
  const allowed = state.players[aIdx].bench
    .filter(b => pool.get(b.cardId)?.name.startsWith('N的')).map(b => b.iid);
  return attachEnergyFromZoneToOwnPokemon(
    state, aIdx, 'discard', energyIids[0], selectedPokeIids[0], pool, 'N的ＰＰ提升劑',
    { allowedTargetIids: allowed },
  ).state;
});

// 阿杏的秘招（Supporter）
// v2.117 完整重寫（Leon 指定流程）：
//   1) 先選最多 2 隻自己場上的【惡】寶可夢（1 ≤ N ≤ min(2, 惡寶數量, 牌庫惡能量數)）
//   2) 再從牌庫搜基本【惡】能量 M 張（1 ≤ M ≤ min(N, 牌庫惡能量數)）
//   3) 第 i 張能量附給第 i 隻選到的寶可夢；若 M < N，後面的寶可夢不拿到
//   4) 若被附能量的其中一隻是戰鬥寶可夢 → 中毒
//   5) 重洗牌庫
// 原實裝用了 engine 不存在的 pending type 'attach-energies-to-dark-pokes' + 自訂 filter
// 'BasicDarknessEnergy' / 'DarknessOwn' → UI 既顯示非惡能量、又卡在無法附加。全部改成
// engine 原生支援的 filter / pending type。
regG('阿杏的秘招', (st, idx, pool) => {
  if (st.players[idx].deck.length === 0) return false;
  const allMy = [...(st.players[idx].active ? [st.players[idx].active!] : []), ...st.players[idx].bench];
  return allMy.some(pk => pool.get(pk.cardId)?.pokemonType === 'Darkness');
});
reg('阿杏的秘招', (st, idx, pool) => {
  // v4.4995：set flag — 叉字蝠 SV6a 怨影使者 gate 用（卡面條件：本回合手牌使出了阿杏的秘招）
  st = updatePlayer(st, idx, p => ({ ...p, akyoSecretPlayedThisTurn: true }));
  const p = st.players[idx];
  const allMy = [...(p.active ? [p.active] : []), ...p.bench];
  const darkPokeIids = allMy.filter(c => pool.get(c.cardId)?.pokemonType === 'Darkness').map(c => c.iid);
  const maxPoke = Math.min(2, darkPokeIids.length);
  st = addLog(st, `阿杏的秘招：選 1~${maxPoke} 隻【惡】寶可夢，之後從牌庫搜對應張數基本【惡】能量附上`, idx);
  return withPending(st, {
    type: 'heal-target',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: maxPoke,
    effectKey: 'akyo-pick-pokes',
    params: {
      validIids: darkPokeIids,
      titleOverride: `選擇要附基本【惡】能量的寶可夢（最多 ${maxPoke} 隻）`,
    },
  });
});
regR('akyo-pick-pokes', (state, aIdx, selectedPokeIids, params) => {
  // v2.121：玩家放棄（空 iids）→ 結束效果不開第二 pending
  if (selectedPokeIids.length === 0) {
    return addLog(state, '阿杏的秘招：未選寶可夢，放棄效果', aIdx);
  }
  const nPokes = selectedPokeIids.length;
  // v2.324：不再預判牌庫能量數，直接允許搜尋與所選寶可夢同張數的能量
  return withPending(state, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Energy:Darkness',
    minCount: 0, maxCount: nPokes,
    effectKey: 'akyo-pick-energies',
    params: {
      pokeIids: selectedPokeIids,
      titleOverride: `從牌庫選 0~${nPokes} 張基本【惡】能量`,
    },
  });
});
regR('akyo-pick-energies', (state, aIdx, selectedEnergyIids, params, pool) => {
  const pokeIids = (params?.pokeIids as string[]) ?? [];
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  // v2.121：若玩家放棄（空 iids）→ 直接重洗結束
  if (selectedEnergyIids.length === 0) {
    p.deck = shuffle([...p.deck]);
    players[aIdx] = p;
    return addLog({ ...state, players }, '阿杏的秘招：未選能量，重洗牌庫結束效果', aIdx);
  }
  const energies = p.deck.filter(c => selectedEnergyIids.includes(c.iid));
  p.deck = p.deck.filter(c => !selectedEnergyIids.includes(c.iid));
  // 第 i 張能量附給第 i 隻選到的寶可夢（若 M < N，後面的寶可夢拿不到）
  const poisonedActive: string[] = [];
  const attachLog: string[] = [];
  for (let i = 0; i < energies.length; i++) {
    const e = energies[i];
    const pokeIid = pokeIids[i];
    if (!pokeIid) break;
    const ename = pool.get(e.cardId)?.name ?? '?';
    if (p.active?.iid === pokeIid) {
      p.active = { ...p.active, energyAttached: [...p.active.energyAttached, e], status: 'poisoned' };
      poisonedActive.push(pool.get(p.active.cardId)?.name ?? '?');
      attachLog.push(`${pool.get(p.active.cardId)?.name ?? '?'} +${ename}`);
    } else {
      p.bench = p.bench.map(b => {
        if (b.iid === pokeIid) {
          attachLog.push(`${pool.get(b.cardId)?.name ?? '?'} +${ename}`);
          return { ...b, energyAttached: [...b.energyAttached, e] };
        }
        return b;
      });
    }
  }
  // 重洗
  p.deck = shuffle([...p.deck]);
  players[aIdx] = p;
  let s = addLog({ ...state, players }, `阿杏的秘招：${attachLog.join('、')}`, aIdx);
  if (poisonedActive.length > 0) {
    s = addLog(s, `阿杏的秘招：戰鬥寶可夢 ${poisonedActive.join('、')} → 中毒`, aIdx);
  }
  s = addLog(s, '阿杏的秘招：重洗牌庫', aIdx);
  return s;
});

// 空手道王的演練（Supporter）— 本回合對 ex +40（player-level flag karateKingBonus）
reg('空手道王的演練', (st, idx) => {
  const players = [...st.players] as [PlayerState, PlayerState];
  players[idx] = { ...players[idx], karateKingBonusThisTurn: true };
  return addLog({ ...st, players }, '空手道王的演練：這回合自己的寶可夢對對手戰鬥場的 ex 傷害 +40', idx);
});

// 塔拉剛（Supporter）— 棄牌區搜【鬥】寶可夢+基本【鬥】能量合計 ≤4 張加手牌
// v2.226 加 regG：棄牌區無【鬥】寶可夢且無基本【鬥】能量時不可打出（UI 不顯示黃框）
regG('塔拉剛', (st, idx, pool) => {
  return st.players[idx].discard.some(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon' && card.pokemonType === 'Fighting') return true;
    if (card.supertype === 'Energy' && card.subtype === 'Basic' && /【鬥】/.test(card.name)) return true;
    return false;
  });
});
reg('塔拉剛', (st, idx, pool) => {
  // v2.360：設旗標供 河馬獸｜龍捲風噴射 判斷本回合是否出過塔拉剛
  st = updatePlayer(st, idx, p => ({ ...p, talarongPlayedThisTurn: true }));
  const eligible = st.players[idx].discard.filter(c => {
    const card = pool.get(c.cardId);
    if (!card) return false;
    if (card.supertype === 'Pokemon' && card.pokemonType === 'Fighting') return true;
    if (card.supertype === 'Energy' && card.subtype === 'Basic' && /【鬥】/.test(card.name)) return true;
    return false;
  });
  if (eligible.length === 0) return addLog(st, '塔拉剛：棄牌區無符合卡', idx);
  st = addLog(st, `塔拉剛：從棄牌區選最多 ${Math.min(4, eligible.length)} 張【鬥】寶可夢或基本【鬥】能量加手牌`, idx);
  return withPending(st, {
    type: 'discard-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'FightingPokemonOrBasicFightingEnergy',
    minCount: 0, maxCount: Math.min(4, eligible.length),
    effectKey: 'taragun-to-hand',
  });
});
regR('taragun-to-hand', (state, aIdx, selectedIids, _params, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.discard.filter(c => selectedIids.includes(c.iid));
  p.discard = p.discard.filter(c => !selectedIids.includes(c.iid));
  // v5.993：加入手牌前 toBareCard 裸化(棄牌卡帶場上 transient 旗標，防外洩回場)
  p.hand = [...p.hand, ...picks.map(toBareCard)];
  players[aIdx] = p;
  const names = picks.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  return addLog({ ...state, players }, `塔拉剛：取回 ${picks.length} 張到手牌（${names}）`, aIdx);
});

// 高溫燃燒器（Item）— 棄自己 1 張基本【火】能量 → 選對手場上 1 張 Tool/特殊能量/Stadium 丟棄
// v2.117：加 regG 讓手牌無火能量時 UI 不顯示黃框（Leon 要求）。
// v2.140：完整實裝 — 用 modal-choice 列出對手場上所有 3 類候選作 options，玩家挑 1 個，
//   resolver 根據 option.id prefix（tool:/energy:/stadium）分派丟棄動作。
// v2.257：AI heuristic 加在 ai.ts modal-choice case（effectKey='heat-burner-pick' 分流），
//   優先順序：對手戰鬥位特殊能量 > 備戰位特殊能量 > 場地卡 > 戰鬥位 Tool > 備戰位 Tool。
regG('高溫燃燒器', (st, idx, pool) => {
  const hasFire = st.players[idx].hand.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【火】/.test(card.name);
  });
  if (!hasFire) return false;
  // 也要對手場上有可敲對象，否則整張牌無意義
  const dIdx = (1 - idx) as 0 | 1;
  const oppAll = [...(st.players[dIdx].active ? [st.players[dIdx].active!] : []), ...st.players[dIdx].bench];
  const hasTargetTool = oppAll.some(p => p.toolAttached);
  const hasTargetSpecialE = oppAll.some(p => p.energyAttached.some(e => {
    const ec = pool.get(e.cardId);
    return ec?.supertype === 'Energy' && ec?.subtype !== 'Basic';
  }));
  const hasStadium = !!st.activeStadium;
  return hasTargetTool || hasTargetSpecialE || hasStadium;
});
reg('高溫燃燒器', (st, idx, pool) => {
  const fireIdx = st.players[idx].hand.findIndex(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Energy' && card?.subtype === 'Basic' && /【火】/.test(card.name);
  });
  if (fireIdx < 0) return addLog(st, '高溫燃燒器：手牌無基本【火】能量', idx);
  // 棄能量
  const players = [...st.players] as [PlayerState, PlayerState];
  const p = { ...players[idx] };
  const eCard = p.hand[fireIdx];
  p.hand = p.hand.filter((_, i) => i !== fireIdx);
  p.discard = [...p.discard, eCard];
  players[idx] = p;
  st = addLog({ ...st, players }, '高溫燃燒器：丟棄 1 張基本【火】能量', idx);

  // v2.140：用 modal-choice 列出對手場上所有 Tool / 特殊能量 / Stadium 三類候選，玩家選 1 個
  const dIdx = (1 - idx) as 0 | 1;
  const dp = st.players[dIdx];
  const oppAll: { inst: typeof dp.bench[0]; pos: 'active' | 'bench' }[] = [];
  if (dp.active) oppAll.push({ inst: dp.active, pos: 'active' });
  for (const b of dp.bench) oppAll.push({ inst: b, pos: 'bench' });

  const options: { id: string; text: string }[] = [];
  for (const { inst, pos } of oppAll) {
    const ownerName = pool.get(inst.cardId)?.name ?? '?';
    const posLabel = pos === 'active' ? '戰鬥' : '備戰';
    if (inst.toolAttached) {
      const t = pool.get(inst.toolAttached.cardId)?.name ?? '?';
      options.push({ id: `tool:${inst.iid}`, text: `🔧 ${posLabel} ${ownerName} 的道具「${t}」` });
    }
    for (const e of inst.energyAttached) {
      const ec = pool.get(e.cardId);
      if (ec?.supertype === 'Energy' && ec?.subtype !== 'Basic') {
        options.push({ id: `energy:${inst.iid}:${e.iid}`, text: `⚡ ${posLabel} ${ownerName} 的特殊能量「${ec?.name ?? '?'}」` });
      }
    }
  }
  if (st.activeStadium) {
    const stadiumName = pool.get(st.activeStadium.cardId)?.name ?? '?';
    options.push({ id: 'stadium', text: `🏟 場地卡「${stadiumName}」` });
  }

  if (options.length === 0) {
    return addLog(st, '高溫燃燒器：對手場上無可丟棄的 Tool/特殊能量/Stadium', idx);
  }

  st = addLog(st, '高溫燃燒器：從對手場上選 1 張 Tool/特殊能量/Stadium 丟棄', idx);
  return withPending(st, {
    type: 'modal-choice',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'heat-burner-pick',
    params: { label: '高溫燃燒器', options },
  });
});
regR('heat-burner-pick', (state, aIdx, iids, _params, pool) => {
  if (iids.length === 0) return addLog(state, '高溫燃燒器：未選擇目標', aIdx);
  const choice = iids[0];
  const dIdx = (1 - aIdx) as 0 | 1;
  let s = state;
  const players = [...s.players] as [PlayerState, PlayerState];

  if (choice === 'stadium') {
    if (!s.activeStadium) return addLog(s, '高溫燃燒器：場地已不存在', aIdx);
    const sName = pool.get(s.activeStadium.cardId)?.name ?? '?';
    // v2.244：用 discardActiveStadium helper 丟回擁有者棄牌堆
    s = discardActiveStadium(s, aIdx);
    return addLog(s, `高溫燃燒器：場地卡「${sName}」被丟棄`, aIdx);
  }

  if (choice.startsWith('tool:')) {
    const targetIid = choice.slice(5);
    const dp = { ...players[dIdx] };
    let toolName = '?';
    let toolInst: typeof dp.bench[0]['toolAttached'] | undefined;
    if (dp.active && dp.active.iid === targetIid) {
      toolInst = dp.active.toolAttached;
      if (!toolInst) return addLog(s, '高溫燃燒器：目標已無道具', aIdx);
      toolName = pool.get(toolInst.cardId)?.name ?? '?';
      // opp-mut-ok: 高溫燃燒器為物品卡,丟對手道具不受化隱擋(化隱只擋招式與特性效果)
      dp.active = { ...dp.active, toolAttached: undefined };
    } else {
      const bIdx = dp.bench.findIndex(b => b.iid === targetIid);
      if (bIdx < 0) return addLog(s, '高溫燃燒器：找不到目標', aIdx);
      const b = { ...dp.bench[bIdx] };
      toolInst = b.toolAttached;
      if (!toolInst) return addLog(s, '高溫燃燒器：目標已無道具', aIdx);
      toolName = pool.get(toolInst.cardId)?.name ?? '?';
      b.toolAttached = undefined;
      dp.bench = [...dp.bench];
      dp.bench[bIdx] = b;
    }
    dp.discard = [...dp.discard, toolInst];
    players[dIdx] = dp;
    s = { ...s, players };
    return addLog(s, `高溫燃燒器：丟棄對手的道具「${toolName}」`, aIdx);
  }

  if (choice.startsWith('energy:')) {
    const parts = choice.split(':');
    const targetIid = parts[1];
    const energyIid = parts[2];
    const dp = { ...players[dIdx] };
    let removed: typeof dp.bench[0]['energyAttached'][0] | undefined;
    if (dp.active && dp.active.iid === targetIid) {
      removed = dp.active.energyAttached.find(e => e.iid === energyIid);
      if (!removed) return addLog(s, '高溫燃燒器：找不到能量', aIdx);
      // opp-mut-ok: 高溫燃燒器為物品卡,丟對手能量不受化隱擋(化隱只擋招式與特性效果)
      dp.active = { ...dp.active, energyAttached: dp.active.energyAttached.filter(e => e.iid !== energyIid) };
    } else {
      const bIdx = dp.bench.findIndex(b => b.iid === targetIid);
      if (bIdx < 0) return addLog(s, '高溫燃燒器：找不到目標', aIdx);
      const b = { ...dp.bench[bIdx] };
      removed = b.energyAttached.find(e => e.iid === energyIid);
      if (!removed) return addLog(s, '高溫燃燒器：找不到能量', aIdx);
      b.energyAttached = b.energyAttached.filter(e => e.iid !== energyIid);
      dp.bench = [...dp.bench];
      dp.bench[bIdx] = b;
    }
    dp.discard = [...dp.discard, removed];
    players[dIdx] = dp;
    s = { ...s, players };
    const eName = pool.get(removed.cardId)?.name ?? '?';
    return addLog(s, `高溫燃燒器：丟棄對手的特殊能量「${eName}」`, aIdx);
  }

  return s;
});

// 完全體攪拌器（Item ACE SPEC）— 從牌庫選 ≤5 張丟棄 + 重洗
// v2.226 加 regG：牌庫為空時不可打出
regG('完全體攪拌器', (st, idx) => st.players[idx].deck.length > 0);
reg('完全體攪拌器', (st, idx) => {
  if (st.players[idx].deck.length === 0) return addLog(st, '完全體攪拌器：牌庫為空', idx);
  st = addLog(st, '完全體攪拌器：從牌庫任意選擇最多 5 張丟棄並重洗', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'any',
    minCount: 0, maxCount: Math.min(5, st.players[idx].deck.length),
    effectKey: 'full-shaker-discard',
  });
});
regR('full-shaker-discard', (state, aIdx, selectedIids, _params) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  const picks = p.deck.filter(c => selectedIids.includes(c.iid));
  p.deck = p.deck.filter(c => !selectedIids.includes(c.iid));
  p.discard = [...p.discard, ...picks];
  p.deck = shuffle([...p.deck]);
  players[aIdx] = p;
  return addLog({ ...state, players }, `完全體攪拌器：丟棄 ${picks.length} 張牌庫卡並重洗`, aIdx);
});

// AZ的平和（Supporter）— 戰鬥↔備戰互換，換入 ex 到備戰回 80 HP
// v6.089：卡面「將自己的戰鬥寶可夢與備戰寶可夢互換」→ 備戰區為空時互換不可能，
//   打出完全沒效果。照寶可夢交替／急進開關的既有守衛形態 gate。
regG('AZ的平和', (st, idx) => !!st.players[idx].active && st.players[idx].bench.length > 0);
reg('AZ的平和', (st, idx, pool) => {
  if (!st.players[idx].active || st.players[idx].bench.length === 0) {
    return addLog(st, 'AZ的平和：需要戰鬥位 + 備戰區寶可夢', idx);
  }
  return withPending(addLog(st, 'AZ的平和：選 1 隻備戰寶可夢與戰鬥寶可夢互換', idx), {
    type: 'bench-choose',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 1, maxCount: 1,
    effectKey: 'az-peace-swap',
  });
});
regR('az-peace-swap', (state, aIdx, selectedIids, _params, pool) => {
  const players = [...state.players] as [PlayerState, PlayerState];
  const p = { ...players[aIdx] };
  if (!p.active) return state;
  const bIdx = p.bench.findIndex(b => selectedIids.includes(b.iid));
  if (bIdx < 0) return addLog(state, 'AZ的平和：未選備戰', aIdx);
  // v5.855：舊 active 下場一律走中央 clearActiveEffects（狀態三槽+~50 旗標全清）——原 {...oldActive}
  //   直接放備戰漏清(狀態靠 scrubBenchStatus 兜底但受傷/免疫類旗標會洩漏)。收斂「戰鬥位→備戰一律 clearActiveEffects」。
  const oldActive = p.active;
  const oldBench = p.bench[bIdx];
  p.bench = p.bench.map((b, i) => i === bIdx ? clearActiveEffects(oldActive) : b);
  // v5.244：補設 movedToActiveThisTurn flag — 之前漏設導致疾風直撞類條件招式無法觸發 bonus,
  //   也是 ON_PROMOTE_TO_ACTIVE prompt 的必要 gate
  p.active = { ...oldBench, movedToActiveThisTurn: true };
  // 若戰鬥 → 備戰（swapped out）為 ex，回 80
  const movedOutCard = pool.get(oldActive.cardId);
  if (movedOutCard?.subtype === 'ex') {
    p.bench = p.bench.map((b, i) => i === bIdx ? { ...b, damage: Math.max(0, b.damage - 80) } : b);
    state = addLog(state, `AZ的平和：${movedOutCard.name} 換入備戰，回復 80 HP`, aIdx);
  }
  players[aIdx] = p;
  // v5.244：自方換位 ON_PROMOTE_TO_ACTIVE prompt（AZ的平和是 Supporter）
  return tryPromptPromoteActive(
    addLog({ ...state, players }, 'AZ的平和：戰鬥↔備戰互換完成', aIdx),
    aIdx, pool,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Passive / Player-level / Engine-integrated effects — 由 engine 那邊 hook：
//   - 夠讚狗｜腎上腺力量（PASSIVE_ATTACK_BONUS + effectiveHPInline，effects.ts 維護）
//   - 蓋諾賽克特｜ACE消弭（canPlayTrainer gate，_shared.ts 維護）
//   - 稜鏡能量 / 新衝天能量（engine canAffordAttack inline）
//   - 空手道王的演練（karateKingBonusThisTurn → engine 打傷害時加）
// ═══════════════════════════════════════════════════════════════════════════

// ─── N的索羅亞克ex｜暗黑底牌（copy-attack）v2.119 ─────────────────────────
// 卡面：選擇 1 個自己備戰區的「N的寶可夢」持有的招式，作為此招式使用。
//
// 流程：
//   1) UI intercept：打出此招式時，彈 modal 讓玩家選備戰 N的寶可夢 + 該寶可夢的招式
//      → dispatch ATTACK 時把 { copyAttackChoice: { pokeIid, attackIndex } } 塞進 action
//   2) regPre 讀 action.copyAttackChoice → 查詢該招的 effectKey（cardName|attackName）
//      → 轉接到 ATTACK_PRE.get(copiedKey)（若未註冊則用印刷傷害）
//      → 把 copiedKey 存到 state.pendingCopyAttackKey，讓 regPost 接力
//   3) regPost 讀 state.pendingCopyAttackKey → 呼叫 ATTACK_POST.get(copiedKey)
//      處理 pendingSelection 類附加效果；結束後清除旗標
//   4) fallback：無 copyAttackChoice 時（例如 AI / 舊 state），自動挑備戰 N的寶可夢
//      中「印刷傷害最高」的招式（同扮晶晶酒 precedent）
regPre('N的索羅亞克ex|暗黑底牌', (state, aIdx, pool, action) => {
  const parseDmg = (s: string): number => {
    const m = s.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const choice = action?.copyAttackChoice;
  const bench = state.players[aIdx].bench;
  let nBench: CardInstance | null = null;
  let pickedAttackIdx = -1;
  if (choice) {
    nBench = bench.find(b => b.iid === choice.pokeIid) ?? null;
    pickedAttackIdx = choice.attackIndex;
  } else {
    // v2.140 改良 fallback：跨整個備戰區的所有 N的寶可夢與所有招式組合中，
    //   挑「印刷傷害最高」的（含 ex 招式）— 原本只看第一隻備戰，導致 sim 勝率 10.6%。
    // 排除：自己（索羅亞克ex 不能複製自己）、暗黑底牌（防遞迴）。
    const benchCandidates = bench.filter(b => {
      const c = pool.get(b.cardId);
      return c?.name?.startsWith('N的') && c.name !== 'N的索羅亞克ex';
    });
    let best: { inst: CardInstance; atkIdx: number; dmg: number } | null = null;
    for (const b of benchCandidates) {
      const atks = pool.get(b.cardId)?.attacks ?? [];
      for (let i = 0; i < atks.length; i++) {
        if (atks[i].name === '暗黑底牌') continue; // 防遞迴
        const d = parseDmg(atks[i].damage);
        if (!best || d > best.dmg) {
          best = { inst: b, atkIdx: i, dmg: d };
        }
      }
    }
    if (best) {
      nBench = best.inst;
      pickedAttackIdx = best.atkIdx;
    }
  }
  if (!nBench) {
    return { state: addLog(state, '暗黑底牌：備戰區沒有「N的」寶可夢', aIdx), damage: 0 };
  }
  const nCard = pool.get(nBench.cardId);
  const pickedAtk = nCard?.attacks?.[pickedAttackIdx];
  if (!nCard || !pickedAtk) {
    return { state: addLog(state, `暗黑底牌：${nCard?.name ?? '?'} 沒有對應的招式`, aIdx), damage: 0 };
  }
  const copiedKey = `${nCard.name}|${pickedAtk.name}`;
  // v2.134 防呆：拒絕複製自己（避免 stack overflow）
  if (copiedKey === 'N的索羅亞克ex|暗黑底牌') {
    return { state: addLog(state, '暗黑底牌：無法複製自己', aIdx), damage: 0 };
  }
  let s = addLog(state, `暗黑底牌：使用 ${nCard.name} 的「${pickedAtk.name}」`, aIdx);
  s = { ...s, pendingCopyAttackKey: copiedKey };
  const copiedPre = ATTACK_PRE.get(copiedKey);
  if (copiedPre) {
    const sub = copiedPre(s, aIdx, pool, action);
    // Bug fix (#18): 複製招式時，弱點/抗性必須以使用者（N的索羅亞克ex＝惡屬性）的屬性計算
    // 不繼承被複製招式的 skipWeakRes — 否則若複製到「不計算弱點」招式會錯誤跳過弱點
    return {
      state: sub.state,
      damage: sub.damage,
      skipWeakRes: false,
      skipDefEffects: sub.skipDefEffects,
    };
  }
  // 被複製招式未註冊 PRE：回印刷傷害
  return { state: s, damage: parseDmg(pickedAtk.damage) };
});
regPost('N的索羅亞克ex|暗黑底牌', copyAttackPostDispatch);
