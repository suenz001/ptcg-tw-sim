/**
 * v6.344 M6a「30th CELEBRATION」招式實裝 —— 批次 4（7 招｜換位／回牌庫／退化／道具移除）
 *
 * ⚠⚠ 卡面文字逐字取自 `static/cards/M6a.json`（台灣官方中文，`attacks[].effect`），未經簡化。
 *
 * ⭐ 本批**沒有任何一招需要改寫傷害** ⇒ 全部只登記 `regPost`，傷害一律讓引擎讀卡面
 *   （v6.333 皮卡丘ex｜打雷 硬寫 220 而 M6a 印刷是 200 的前科；`scripts/test-fixed-damage-base.mjs` 在守）。
 *   唯一落在 `regPre` 的是 **藏瑪然特｜彈落**（卡面「**在造成傷害前**」丟道具 ⇒ 順序有意義），
 *   它屬於 effects.ts 內部 local helper `defToolDiscardPre` 的家族 ⇒ 依規範登記在
 *   effects.ts 那一區與 烈雀｜啄食／拉達｜削落／金魚王｜啄落 並列，**不在本檔另抄一份**。
 *   本批 8 個鍵已跑過同名印刷碰撞檢查（`__m6a/collide_w4.mjs` + `wave4-keys.json`）：
 *   全卡庫同名同招的傷害與效果文字都只有一種 ⇒ 沒有「同名不同印刷」的風險。
 *
 * ⭐⭐⭐ 本批最容易做錯的地方：**換位有三個方向，各有各的中央出口，絕不可混用**
 *   ① 「選擇 1 隻**對手的備戰**寶可夢，與戰鬥寶可夢互換」＝ gust 方向（攻擊方選）
 *      ⇒ 中央 `oppSwapDmgPost`（C-05 家族；免疫閘收斂在**目標端**：免疫招式效果的對手備戰
 *        不可被選為互換目標，原戰鬥位的化隱/純樸**不擋** —— 官方判例 §17.3.D 催眠貘｜強行入眠）。
 *   ② 「**對手**將對手自己的戰鬥寶可夢與備戰寶可夢互換」＝由**對手**選
 *      ⇒ 中央 `forceOppSwapPost`（C-04 家族；免疫閘在**對手戰鬥位**：化隱/純樸不被強制換位）。
 *   ③ 「將**這隻**寶可夢與備戰寶可夢互換」＝自己換自己 ⇒ 中央 `selfSwapPost`（`do-switch`）。
 *
 * ⭐⭐ 「若希望」型（瞬間移動突擊／飄舞）一律走 `ATTACK_PRE_DISCARD_CHOICE` 的
 *   `binary-yes-no` 前置選擇 —— 玩家**必須**保有「不發動」的選項。
 *   ⚠ 絕不可以做成「只有一個候選就直接發動」的 fast-path（v6.339 火箭隊的貓老大ex｜高傲指令 事故）。
 *
 * ⭐ Rule 38：本檔不寫任何判準。需要的新中央 helper `devolveAllOppEvolvedPost`
 *   放在 effects.ts 當中央出口，並把逐字同措辭的既有卡（太陽伊布ex｜阿賽斯特萊石）
 *   一併收斂過去（見 effects.ts 該 helper 的註解）。
 */

import type { CardInstance } from '../../types';
import {
  regPost, regR, ATTACK_PRE_DISCARD_CHOICE,
  addLog, updatePlayer, withPending, shuffle,
  toBareCard,              // 離場／回牌庫一律裸化（白名單），防暫時性旗標外洩到下一次入場
  abilityUsedAfterSwap,    // v5.625 官方 QA：卡片互換後「特性本回合已使用」以**特性名稱**判定
} from '../_shared';
import {
  oppSwapDmgPost,          // ①「選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換」（攻擊方選 = gust）
  forceOppSwapPost,        // ②「對手將對手自己的戰鬥寶可夢與備戰寶可夢互換」（對手選）
  selfSwapPost,            // ③「將這隻寶可夢與備戰寶可夢互換」（自己換自己）
  selfReturnToDeckPost,    // 「將這隻寶可夢與附加的卡全部放回牌庫並重洗」
  flipCoinsWithLog,        // 中央擲幣（含 log；<0.5 = 正面）
  devolveAllOppEvolvedPost, // 「從對手的所有進化的寶可夢身上，各移除1張『進化卡』使其退化」
} from '../../effects';
// 美納斯｜平穩境地：「場上的卡無法放回手牌」的中央述詞（傳「**被回手那張卡的持有者**」的 idx）。
// ⚠ 這一閘只能放在卡檔 —— effects.ts 不可以 import ./effects/cards/* 的 symbol
//   （scripts/anti-pattern-lint.mjs 的反向 edge 規則，module-init 循環 TDZ）。
//   站上所有「場上的卡回手牌」的卡（念力土偶｜退化光線、v2353/v2354、items_misc…）都是這樣接的。
import { isReturnToHandBlockedByCalmGround as _calmGroundBlocks } from './v3080_deferred_wave_c';

// ══════════════════════════════════════════════════════════════════════════════
// ① gust 方向：「選擇 1 隻**對手的備戰**寶可夢，與戰鬥寶可夢互換。」（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 003/103 電螢蟲｜誘導之光 [Grass] dmg=''：選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換。
//   ⚠ 卡面 damage 欄是空的 ⇒ 傳給中央的追加傷害是 0（`oppSwapDmgPost(0, …)`），
//     **不登記 regPre**（登了會憑空多打一份主線傷害）。
//   ⚠ 免疫閘不是寫在這裡 —— 中央 helper 已用 `canApplyEffectToTarget(isBench)` 把免疫招式效果的
//     對手備戰從 `validIids` 排除（`scripts/test-gust-immunity.mjs`／
//     `scripts/test-opp-swap-hidden-immunity.mjs` 在守這條），本檔不可再抄第二份判準。
//   ⚠ 同措辭正對照：派帕的陸地水母｜拉扯（同樣 0 傷 + C-05 互換）。
regPost('電螢蟲|誘導之光', oppSwapDmgPost(0, '誘導之光'));

// ══════════════════════════════════════════════════════════════════════════════
// ② 自己換自己（`selfSwapPost` / `do-switch`）（2 招 + 1 招「若希望」在 ③）
// ══════════════════════════════════════════════════════════════════════════════
// 026/103 皮卡丘｜逃來逃去 [C] dmg=''：將這隻寶可夢與備戰寶可夢互換。
//   ⚠ 卡面**沒有**「若希望」⇒ 強制執行，不開 yes/no（與 粉蝶蛹｜走來走去、醜醜魚｜躍起逃走 同一支）。
regPost('皮卡丘|逃來逃去', selfSwapPost('逃來逃去'));

// 014/103 帕路奇亞｜蟲洞 [W,W,C] 100：
//   將這隻寶可夢與備戰寶可夢互換。然後，對手將對手自己的戰鬥寶可夢與備戰寶可夢互換。
//   ⚠⚠ **兩段、兩個方向、兩個 picker**，順序照卡面：先自己換（我選），再對手換（對手選）。
//     兩者都走 `withPending`：第一筆進 `pendingSelection`，第二筆自動排進 `pendingChainQueue`，
//     玩家依序解（v4.933 既有機制），不會互相覆蓋。
//   ⚠ 任一段條件不足時**只是那一段不執行**，不可當掉、也不可讓整招失敗：
//     ・自己沒有備戰 ⇒ `selfSwapPost` 只 log（前半不執行），後半照樣叫對手換。
//     ・對手沒有備戰 ⇒ `forceOppSwapPost` 只 log（後半不執行）。
//     ・對手戰鬥位免疫招式效果（化隱／純樸…）⇒ 中央 helper 直接不開 picker（C-04 既定判準）。
regPost('帕路奇亞|蟲洞', (state, aIdx, pool) => {
  const s = selfSwapPost('蟲洞')(state, aIdx, pool);
  return forceOppSwapPost('蟲洞')(s, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 「若希望」型（binary-yes-no 前置選擇）（2 招）
//    ⚠⚠ 玩家必須保有「不發動」的選擇 —— 不可以因為「只有一個候選」就替他發動（v6.339 事故）。
//    ⚠ `discardedEnergyIids === undefined`（AI／乾跑／借招沒帶答覆）→ 視為「是」，
//      這是站上「若希望」家族的既有慣例（沙漠蜻蜓ex｜風暴返、賽富豪｜賽富迴旋…），不另立第二種。
// ══════════════════════════════════════════════════════════════════════════════
// 057/103（+128/103）夢幻ex｜瞬間移動突擊 [P] 30：若希望，將這隻寶可夢與備戰寶可夢互換。
//   ⚠ 逐字同措辭正對照：古劍豹｜狡兔三窟（20）／音波龍ex｜狡兔三窟（50）／沙漠蜻蜓ex｜風暴返（130）。
//   ⚠ baseDamage 只是 UI 預估用的顯示值，**不是**傷害來源（傷害由引擎讀卡面）。
ATTACK_PRE_DISCARD_CHOICE.set('夢幻ex|瞬間移動突擊', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 30, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢與備戰寶可夢互換？',
  choiceYesLabel: '是（換到備戰）',
  choiceNoLabel: '否（留在戰鬥位）',
});
regPost('夢幻ex|瞬間移動突擊', (state, aIdx, pool, action) => {
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '瞬間移動突擊：選擇「否」 — 不互換', aIdx);
  return selfSwapPost('瞬間移動突擊')(state, aIdx, pool);
});

// 061/103（+131/103）飄飄球｜飄舞 [P] 20：若希望，將這隻寶可夢與附加的卡全部放回牌庫並重洗。
//   ⚠ 是「放回**牌庫**並重洗」不是回手牌 ⇒ 走 `selfReturnToDeckPost`，
//     **不是** `selfReturnToHandPost`（那一支還要過【平穩境地】閘，回牌庫不在那張卡的射程內）。
//   ⚠ 「與附加的卡**全部**」＝主體 + 能量 + 道具 + 進化堆疊，中央 helper 內部走
//     `bareCardsForReturn`（每一張都 `toBareCard` 裸化）—— 離場清狀態的通則，
//     否則暫時性旗標會外洩到下一次入場。
//   ⚠ 逐字同措辭正對照：賽富豪｜賽富迴旋（100，同樣是「若希望」自身回牌庫）。
ATTACK_PRE_DISCARD_CHOICE.set('飄飄球|飄舞', {
  min: 0, max: null, scope: 'binary-yes-no',
  baseDamage: 20, damagePerEnergy: 0,
  choicePrompt: '是否將這隻寶可夢與附加的卡全部放回牌庫並重洗？',
  choiceYesLabel: '是（自身回牌庫）',
  choiceNoLabel: '否（留在戰鬥位）',
});
regPost('飄飄球|飄舞', (state, aIdx, pool, action) => {
  const _chosenIids = action?.discardedEnergyIids;
  const _choseYes = _chosenIids === undefined ? true : _chosenIids.length >= 1;
  if (!_choseYes) return addLog(state, '飄舞：選擇「否」 — 不回牌庫', aIdx);
  return selfReturnToDeckPost('飄舞')(state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ 退化（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 058/103 太陽伊布｜奇跡璨耀 [P,C] dmg=''：
//   從對手的所有進化的寶可夢身上，各移除1張「進化卡」使其退化。將移除的卡放回對手的手牌。
//   ⚠ 與 太陽伊布ex｜阿賽斯特萊石 逐字同措辭（只差移除的卡去手牌還是去牌庫）
//     ⇒ 共用中央 `devolveAllOppEvolvedPost`（本版一併把阿賽斯特萊石收斂過去）。
//   ⚠ 「各移除**1張**」＝只退一層，不是退到基礎。
//   ⚠ 對手**每一隻**都要各自過免疫閘（`scripts/test-devolve-attack-hidden-immunity.mjs` 在守）；
//     被擋的那一隻只是不退化，其餘照退。
//   ⚠ 卡面 damage 欄是空的 ⇒ 只登 regPost。
//   ⚠⚠ 「將移除的卡放回對手的**手牌**」⇒ 要過【平穩境地】（美納斯）閘：
//     被回手的是**對手**的進化卡 ⇒ 傳 dIdx（＝被回手卡的持有者），與 念力土偶｜退化光線 同一份判準。
regPost('太陽伊布|奇跡璨耀', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  if (_calmGroundBlocks(state, dIdx, pool)) {
    return addLog(state, '奇跡璨耀：對手場上有【平穩境地】，效果無效', aIdx);
  }
  return devolveAllOppEvolvedPost('奇跡璨耀', 'hand')(state, aIdx, pool);
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 與牌庫的寶可夢卡「互換」（1 招）
// ══════════════════════════════════════════════════════════════════════════════
// 093/103（+136/103）百變怪｜整人變身 [C,C] dmg=''：
//   擲1次硬幣若為正面，則從自己的牌庫選擇1張寶可夢卡，與這隻寶可夢互換
//   （所附加的卡・傷害指示物・特殊狀態・效果等全部保留）。若互換了，則這張卡放回牌庫。並且重洗牌庫。
//
//   ⭐⭐ 「互換（…全部保留）」＝換的是**卡片本體**，身上的東西原封不動留在**原位**：
//     實作＝把場上那個 instance 的 `cardId` 換掉，`iid` 與 energyAttached／toolAttached／
//     extraTools／damage／三槽狀態／各種效果旗標／evolvedFromStack **一個都不動**。
//     這是站上既有的「互換」機制（海豚俠｜全能變身、鬼之假面、變化之書 同一種做法），
//     **不需要**新增 GameState 欄位、也**不動** engine.ts 的核心流程。
//   ⭐ 「**若互換了**，則這張卡放回牌庫」＝被換下來的百變怪（本體那張卡）以**裸卡**回牌庫；
//     沒互換（反面／沒選）就不放回，但「並且重洗牌庫」照做（已經看過牌庫）。
//   ⚠ 「1張寶可夢卡」是**帶條件**的搜尋 ⇒ 依 v6.126 判準可以宣告「找不到」而選 0 張
//     （不適用「任意選擇不可選 0」那一條）。
//   ⚠ 換上來的卡若有特性：`abilityUsedAfterSwap`（v5.625 官方 QA）—— 同名特性沿用「已使用」，
//     不同名則可再使用一次。
regPost('百變怪|整人變身', (state, aIdx, pool) => {
  const r = flipCoinsWithLog(state, 1, '整人變身', aIdx);
  if (r.heads !== 1) return addLog(r.state, '整人變身：反面 — 不互換', aIdx);
  const p = r.state.players[aIdx];
  if (!p.active) return r.state;
  if (p.deck.length === 0) return addLog(r.state, '整人變身：牌庫為空，無法選擇', aIdx);
  // picker 只列牌庫裡的「寶可夢卡」（卡面明文）。候選 0 張時仍要重洗牌庫（已看過牌庫）。
  const pokeIids = p.deck.filter(d => pool.get(d.cardId)?.supertype === 'Pokemon').map(d => d.iid);
  if (pokeIids.length === 0) {
    return updatePlayer(addLog(r.state, '整人變身：牌庫沒有寶可夢卡，重洗牌庫', aIdx), aIdx,
      pl => ({ ...pl, deck: shuffle([...pl.deck]) }));
  }
  const s = addLog(r.state,
    '整人變身：正面 — 從牌庫選 1 張寶可夢卡與這隻寶可夢互換（所附加的卡・傷害指示物・特殊狀態・效果等全部保留）', aIdx);
  return withPending(s, {
    type: 'deck-search',
    actorIdx: aIdx, sourcePlayerIdx: aIdx,
    filter: 'Pokemon', minCount: 0, maxCount: 1,
    effectKey: 'ditto-transform-swap',
    params: { hostIid: p.active.iid, label: '整人變身', validIids: pokeIids },
  });
});

regR('ditto-transform-swap', (st, idx, iids, params, pool) => {
  const label = (params?.label as string) ?? '整人變身';
  const hostIid = params?.hostIid as string | undefined;
  const p = st.players[idx];
  // 不論有沒有互換成功，「並且重洗牌庫」都要做（玩家已經看過牌庫）。
  const reshuffle = (msg: string) =>
    updatePlayer(addLog(st, msg, idx), idx, pl => ({ ...pl, deck: shuffle([...pl.deck]) }));
  if (iids.length === 0 || !hostIid) return reshuffle(`${label}：未選擇寶可夢卡，重洗牌庫`);
  // v6.009：resolver 一律自行 re-validate client 傳來的 iids（禁原封處理）。
  const picked = p.deck.find(c => c.iid === iids[0]);
  if (!picked) return reshuffle(`${label}：牌庫中找不到所選卡，重洗牌庫`);
  if (pool.get(picked.cardId)?.supertype !== 'Pokemon') return reshuffle(`${label}：所選非寶可夢卡，重洗牌庫`);
  const onField = p.active?.iid === hostIid ? p.active : p.bench.find(c => c.iid === hostIid);
  if (!onField) return reshuffle(`${label}：場上找不到這隻寶可夢，重洗牌庫`);

  const oldName = pool.get(onField.cardId)?.name ?? '?';
  const newName = pool.get(picked.cardId)?.name ?? '?';
  // 互換＝只換「卡片本體」（cardId）：iid 與身上的一切（能量／道具／傷害指示物／
  //   特殊狀態／效果旗標／進化堆疊）全部原封不動留在原位。
  const swapped: CardInstance = {
    ...onField,
    cardId: picked.cardId,
    abilityUsedThisTurn: abilityUsedAfterSwap(onField, pool.get(onField.cardId), pool.get(picked.cardId)),
  };
  // 「若互換了，則這張卡放回牌庫」：換下來的本體以**裸卡**（新 iid，防與場上實例撞號）回牌庫。
  const bareOld: CardInstance = { ...toBareCard(onField), iid: `${onField.iid}_ditto_${Math.random().toString(36).slice(2, 8)}` };
  const s = addLog(st, `${label}：${oldName} 與牌庫的「${newName}」互換（所附加的卡・傷害指示物・特殊狀態・效果等全部保留）；${oldName} 放回牌庫並重洗`, idx);
  return updatePlayer(s, idx, pl => ({
    ...pl,
    active: pl.active?.iid === hostIid ? swapped : pl.active,
    bench: pl.bench.map(c => (c.iid === hostIid ? swapped : c)),
    deck: shuffle([...pl.deck.filter(c => c.iid !== picked.iid), bareOld]),
  }));
});
