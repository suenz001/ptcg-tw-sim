/**
 * 搜尋寶可夢類訓練家（球 + 搜尋 Supporter） — 模組化批次 v2.19 (Session 38c0)
 *
 * 原位於 effects.ts L200–L316 + L369–L425：
 *   物品：好友寶芬 / 赫普的包包 / 甜蜜球 / 黑暗球 / 高級球 / 超級信號
 *   Supporter：小剛的發掘（機制同球類—從牌庫搜寶可夢加手牌，放同檔以共用 resolver）
 *
 * 共用 resolver：
 *   - bench-basic-from-deck：搜到的基礎寶可夢放備戰區（好友寶芬 / 赫普的包包）
 *   - search-pokemon-to-hand：搜到的寶可夢加手牌（甜蜜球 / 黑暗球 / 小剛的發掘 / 高級球 / 超級信號）
 *   - ultra-ball-discard：高級球兩階段（先丟手牌、再 withPending 進 deck-search → search-pokemon-to-hand）
 *
 * 這些卡只依賴 _shared 的登錄函式 + 純 helper，無攻擊系統 / 特性 / 道具 / Stadium 連動，
 * byte-exact 搬運。
 */

import {
  reg, regR, regG,
  addLog, addPrivateLog, updatePlayer, withPending, shuffle,
  applyBenchPlaceSideEffects,
  getOwnBenchLimit,
} from '../_shared';

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（放備戰區）
// ══════════════════════════════════════════════════════════════════════════════

// 好友寶芬 — 從牌庫選最多 2 隻 HP≤70 基礎寶可夢放備戰
regG('好友寶芬', (st, idx, pool) => {
  // 備戰要有空位，且牌庫要有 HP≤70 的基礎寶可夢
  // v3.78：用 getOwnBenchLimit 支援零之大空洞（5→8 格）
  if (st.players[idx].bench.length >= getOwnBenchLimit(st, idx, pool)) return false;
  return st.players[idx].deck.length > 0;
});
reg('好友寶芬', (st, idx, pool) => {
  // v3.78：slots 改用 getOwnBenchLimit（零之大空洞時可放 8）
  const slots = getOwnBenchLimit(st, idx, pool) - st.players[idx].bench.length;
  const takeMax = Math.min(2, slots);
  st = addLog(st, `好友寶芬：從牌庫選至多 ${takeMax} 隻 HP≤70 基礎寶可夢到備戰區`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic:HP70',
    minCount: 0, maxCount: takeMax,
    effectKey: 'bench-basic-from-deck',
  });
});

// 赫普的包包 — 從牌庫選最多 2 隻「赫普的」基礎寶可夢到備戰
// v2.159：完整實裝「赫普的」前綴限定
//   - gate 至少 1 隻「赫普的」基礎在牌庫
//   - filter 用新 'Basic:NamePrefix=赫普的'（UI 端 filter parser 同步擴展）
//   - resolver 端驗證選的卡符合 prefix（防呆 / AI sim 模式 fallback）
regG('赫普的包包', (st, idx, pool) => {
  // v3.78
  if (st.players[idx].bench.length >= getOwnBenchLimit(st, idx, pool)) return false;
  return st.players[idx].deck.length > 0;
});
reg('赫普的包包', (st, idx, pool) => {
  // v3.78
  const slots = getOwnBenchLimit(st, idx, pool) - st.players[idx].bench.length;
  const takeMax = Math.min(2, slots);
  st = addLog(st, `赫普的包包：從牌庫選至多 ${takeMax} 隻「赫普的」基礎寶可夢到備戰區`, idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Basic:NamePrefix=赫普的',
    minCount: 0, maxCount: takeMax,
    effectKey: 'bench-named-basic-from-deck',
    params: { namePrefix: '赫普的' },
  });
});

// v2.159：bench-named-basic-from-deck — 同 bench-basic-from-deck 但 resolver 驗證 namePrefix
regR('bench-named-basic-from-deck', (st, idx, iids, params, pool) => {
  const namePrefix = String(params?.namePrefix ?? '');
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  // 驗證每張選的卡：必須是 prefix 開頭 + 基礎寶可夢
  const valid = chosen.filter(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && !card.evolvesFrom
      && (!namePrefix || card.name.startsWith(namePrefix));
  });
  const validIids = valid.map(c => c.iid);
  if (valid.length === 0) {
    return updatePlayer(addLog(st, `${namePrefix ? '「'+namePrefix+'」' : ''}基礎寶可夢搜尋：未選擇符合條件的卡`, idx),
      idx, p => ({ ...p, deck: shuffle(p.deck) }));
  }
  const names = valid.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  st = addLog(st, `放到備戰區：${names}`, idx);
  st = updatePlayer(st, idx, (p) => {
    const selected = p.deck
      .filter(c => validIids.includes(c.iid))
      // v4.997: 防禦性 fresh-state reset — 從 deck 拿出來放 bench 的 inst 應該是
      //   乾淨狀態，避免某 path 殘留 damage / status / 能量導致新寶可夢上場立即被 KO
      //   （玩家回報感應【超】能量 拉破破舵輪 被 sanityKOSweep 判 damage 200 ≥ HP 140）
      .map(c => ({
        ...c,
        justPlaced: true,
        damage: 0,
        status: undefined,
        secondaryStatus: undefined,
        tertiaryStatus: undefined,
        energyAttached: [],
        toolAttached: undefined,
        extraTools: [],
        evolvedFromStack: undefined,
        evolvedThisTurn: undefined,
      }));
    // v5.010：原本 .slice(0, limit) 會截掉超出備戰的卡 → 寶可夢從 deck 拿出來但被丟失。
    //   改成：按 slots 分配，多餘的 selected 與 unselected 一起放回 remaining 重洗。
    const benchLimit = getOwnBenchLimit(st, idx, pool);
    const slots = Math.max(0, benchLimit - p.bench.length);
    const toBench = selected.slice(0, slots);
    const overflow = selected.slice(slots).map(c => ({
      ...c, justPlaced: undefined, damage: 0, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined,
      energyAttached: [], toolAttached: undefined, extraTools: [], evolvedFromStack: undefined,
      evolvedThisTurn: undefined,
    }));
    const remaining = [...p.deck.filter(c => !validIids.includes(c.iid)), ...overflow];
    const bench = [...p.bench, ...toBench];
    return { ...p, deck: shuffle(remaining), bench };
  });
return st; // v5.866 險惡廢墟改走 applyAction 出口中央偵測
});

regR('bench-basic-from-deck', (st, idx, iids, params, pool) => {
  // v4.941 defense-in-depth：若 params 有 targetName，過濾 iids 只保留同名卡
  //   防 picker UI bug 或惡意 client 繞 picker 送任意基礎寶可夢 iid。
  //   picker 端 'Basic:SameName' filter 已做第一層攔截，這裡是第二層 server-side 驗證。
  const targetName = params?.targetName as string | undefined;
  let effIids = iids;
  if (targetName) {
    effIids = iids.filter(iid => {
      const inst = st.players[idx].deck.find(c => c.iid === iid);
      return inst && pool.get(inst.cardId)?.name === targetName;
    });
  }
  // v5.115 defense-in-depth #2：若 params 有 validIids（如哲爾尼亞斯|大地之門限定【超】基礎），
  //   過濾 iids 只保留 validIids 中的卡。玩家回報大地之門抓出基礎以外寶可夢 —
  //   picker UI filter:'Pokemon' 只過濾「寶可夢類」，沒過濾 Stage1/Stage2/超屬性。
  //   caller 已傳 validIids 限制候選，但本 resolver 之前沒驗證 → 修補 server-side gate。
  const validIids = params?.validIids as string[] | undefined;
  if (validIids && validIids.length > 0) {
    const validSet = new Set(validIids);
    effIids = effIids.filter(iid => validSet.has(iid));
  }
  // 公開資訊：放到備戰區本來就對對手可見，順便記到 log 方便追蹤
  const chosen = st.players[idx].deck.filter(c => effIids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `放到備戰區：${names}`, idx);
  } else {
    st = addLog(st, '牌庫搜尋：未選擇任何卡', idx);
  }
  // 把 bench 增加 + deck remove + 重洗
  st = updatePlayer(st, idx, (p) => {
    const selected = p.deck
      .filter(c => effIids.includes(c.iid))
      // v4.997: 防禦性 fresh-state reset — 從 deck 拿出來放 bench 的 inst 應該是
      //   乾淨狀態，避免某 path 殘留 damage / status / 能量導致新寶可夢上場立即被 KO
      //   （玩家回報感應【超】能量 拉破破舵輪 被 sanityKOSweep 判 damage 200 ≥ HP 140）
      .map(c => ({
        ...c,
        justPlaced: true,
        damage: 0,
        status: undefined,
        secondaryStatus: undefined,
        tertiaryStatus: undefined,
        energyAttached: [],
        toolAttached: undefined,
        extraTools: [],
        evolvedFromStack: undefined,
        evolvedThisTurn: undefined,
      }));
    // v5.010：原本 .slice(0, limit) 會截掉超出備戰的卡 → 寶可夢從 deck 拿出來但被丟失。
    //   改成：按 slots 分配，多餘的 selected 與 unselected 一起放回 remaining 重洗。
    const benchLimit2 = getOwnBenchLimit(st, idx, pool);
    const slots2 = Math.max(0, benchLimit2 - p.bench.length);
    const toBench2 = selected.slice(0, slots2);
    const overflow2 = selected.slice(slots2).map(c => ({
      ...c, justPlaced: undefined, damage: 0, status: undefined, secondaryStatus: undefined, tertiaryStatus: undefined,
      energyAttached: [], toolAttached: undefined, extraTools: [], evolvedFromStack: undefined,
      evolvedThisTurn: undefined,
    }));
    const remaining = [...p.deck.filter(c => !effIids.includes(c.iid)), ...overflow2];
    const bench = [...p.bench, ...toBench2];
    return { ...p, deck: shuffle(remaining), bench };
  });
// v5.866 險惡廢墟改走 applyAction 出口中央偵測
  return st;
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（加手牌）
// ══════════════════════════════════════════════════════════════════════════════

// 甜蜜球 — 從牌庫選 1 隻與對手出場寶可夢同名的寶可夢加手牌
// v2.159 升級為完整實裝（不再簡化）；之前簡化為任意寶可夢，現在限定「與對手出場（戰鬥位+備戰位）寶可夢同名」。
regG('甜蜜球', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppNames = new Set<string>();
  if (st.players[dIdx].active) {
    const c = pool.get(st.players[dIdx].active!.cardId);
    if (c) oppNames.add(c.name);
  }
  for (const b of st.players[dIdx].bench) {
    const c = pool.get(b.cardId);
    if (c) oppNames.add(c.name);
  }
  if (oppNames.size === 0) return false;
  return st.players[idx].deck.length > 0;
});
reg('甜蜜球', (st, idx, pool) => {
  const dIdx = (1 - idx) as 0 | 1;
  const oppNames = new Set<string>();
  if (st.players[dIdx].active) {
    const c = pool.get(st.players[dIdx].active!.cardId);
    if (c) oppNames.add(c.name);
  }
  for (const b of st.players[dIdx].bench) {
    const c = pool.get(b.cardId);
    if (c) oppNames.add(c.name);
  }
  st = addLog(st, `甜蜜球：從牌庫選 1 隻與對手場上同名的寶可夢加手牌（${[...oppNames].join('/')}）`, idx);
  // v2.993：卡面寫「選擇 1 張」mandatory；牌庫無同名寶可夢時允許 Pass
  const hasMatch = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && oppNames.has(card.name);
  });
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon:MatchOppName',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
    params: { matchOppNames: [...oppNames] },
  });
});

// 黑暗球 — 查看牌庫下方 7 張，選 1 張寶可夢加手牌；剩餘放回牌庫並重洗
// v4.940 修：原實作 filter='Pokemon' 沒限定範圍 → 玩家可從整個牌庫挑寶可夢（規則違反）。
//   改用既有 filter 'Pokemon:TOP_N' + params.topIids = bottom7 iids，
//   限定 picker 候選只在牌庫下方 7 張寶可夢內。
//   加 addPrivateLog 揭示 bottom 7 內容（自己看具體卡名 / 對手只看「查看 N 張」）。
//   選到的卡用 addLog 公開卡名（卡面寫「給對手看過」）— search-pokemon-to-hand resolver 已處理。
reg('黑暗球', (st, idx, pool) => {
  const deckLen = st.players[idx].deck.length;
  if (deckLen === 0) {
    return addLog(st, '黑暗球：牌庫為空，無法使用', idx);
  }
  const bottomN = Math.min(7, deckLen);
  const bottom = st.players[idx].deck.slice(-bottomN);
  const bottomIids = bottom.map(c => c.iid);
  const bottomNames = bottom.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  const hasPoke = bottom.some(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  // 揭示 bottom N：自己看具體卡名，對手只看到查看了 N 張（Iron Rule 8）
  st = addPrivateLog(st,
    `黑暗球：牌庫下方 ${bottomN} 張 ─ ${bottomNames}`,
    `黑暗球：查看牌庫下方 ${bottomN} 張`,
    idx);
  // v2.993 + Iron Rule 14：bottom N 無寶可夢時 minCount=0 允許 Pass（玩家仍可看到剩餘資訊）
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    // v4.942：filter 'Pokemon:TOP_N' → 'Pokemon:TOP7' + param top7Iids（vs topIids）
    //   原因：picker UI 「🔍 查看翻到的其他」block 用正則 `/:TOP\d+$/` 偵測 + 抓 top<N>Iids，
    //         Pokemon:TOP_N 不符合（_N 不是數字），所以不會顯示 7 張中非寶可夢的卡。
    //   改用 'Pokemon:TOP7' + top7Iids 兩個既有慣例，自動觸發 UI block 顯示全部 7 張。
    filter: 'Pokemon:TOP7',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
    params: {
      top7Iids: bottomIids,  // 即使叫 top7Iids 內容仍是 bottom7（UI block 抓此 key）
      titleOverride: `黑暗球：從牌庫下方 ${bottomN} 張中選 1 張寶可夢加手牌`,
    },
  });
});

regR('search-pokemon-to-hand', (st, idx, iids, _params, pool) => {
  // v2.96：卡面有「給對手看過」（高級球 / 黑暗球 / 甜蜜球 / 超級信號 / 小剛的發掘 stage2 等共用此 resolver）
  // → 必須公開卡名給對手 log（PTCG 防作弊驗證機制）
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  if (chosen.length > 0) {
    const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `搜到：${names} 加入手牌`, idx);
  } else {
    st = addLog(st, '牌庫搜尋：未選擇任何卡', idx);
  }
  return updatePlayer(st, idx, (p) => {
    const chosenInPlayer = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(remaining), hand: [...p.hand, ...chosenInPlayer] };
  });
});

// 小剛的發掘（Supporter）— v5.014 統一 picker：同 modal 顯示基礎+進化
// 卡面：「從自己的牌庫選擇最多 2 張【基礎】寶可夢卡，或者 1 張進化寶可夢卡，在給對手看過後加入手牌」
// 動態規則（picker UI 端 enforce）：
//   - 點 Basic → 可再點 Basic（最多 2）/ Evolution 變灰
//   - 點 Evolution → 其他全變灰（最多 1 隻）
// effectKey 'brocks-dig-unified' 是 UI 端 brocksDigPickState 的判別 key
reg('小剛的發掘', (st, idx) => {
  st = addLog(st, '小剛的發掘：從牌庫選最多 2 隻【基礎】寶可夢卡，或 1 隻進化寶可夢卡加手牌', idx);
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 2,
    effectKey: 'brocks-dig-unified',
  });
});

regR('brocks-dig-unified', (st, idx, iids, _params, pool) => {
  if (iids.length === 0) {
    st = updatePlayer(st, idx, p => ({ ...p, deck: shuffle(p.deck) }));
    return addLog(st, '小剛的發掘：未選擇任何寶可夢；重洗牌庫結束', idx);
  }
  // 玩家選的 iid 在 UI 端已驗證符合卡面規則（同類 Basic ≤2 或 單張 Evolution）
  // resolver 不再做 type-check，避免 server / sim 端 reject 後 UI 卻顯示成功的不一致
  const chosen = st.players[idx].deck.filter(c => iids.includes(c.iid));
  const names = chosen.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
  // 卡面「給對手看過」→ 公開卡名
  st = addLog(st, `小剛的發掘：搜到 ${names} 加入手牌`, idx);
  return updatePlayer(st, idx, (p) => {
    const picked = p.deck.filter(c => iids.includes(c.iid));
    const remaining = p.deck.filter(c => !iids.includes(c.iid));
    return { ...p, deck: shuffle(remaining), hand: [...p.hand, ...picked] };
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 物品卡 — 搜尋牌庫（補充）
// ══════════════════════════════════════════════════════════════════════════════

// 高級球 — 丟棄 2 張手牌，搜尋任意寶可夢加手牌
// Guard: 手牌至少 3 張（含本卡）—— 打出後需再丟 2 張
regG('高級球', (st, idx) => st.players[idx].hand.length >= 3);
reg('高級球', (st, idx) => {
  if (st.players[idx].hand.length < 2) {
    return addLog(st, '高級球：手牌不足 2 張，無法使用', idx);
  }
  st = addLog(st, '高級球：選擇 2 張手牌丟棄', idx);
  return withPending(st, {
    type: 'hand-discard',
    actorIdx: idx, sourcePlayerIdx: idx,
    minCount: 2, maxCount: 2,
    effectKey: 'ultra-ball-discard',
  });
});
regR('ultra-ball-discard', (st, idx, iids, _params, pool) => {
  // 記錄丟棄的卡名（公開資訊 — 丟棄到棄牌區本來就公開）
  const toDiscardNow = st.players[idx].hand.filter(c => iids.includes(c.iid));
  if (toDiscardNow.length > 0) {
    const names = toDiscardNow.map(c => pool.get(c.cardId)?.name ?? '?').join('、');
    st = addLog(st, `高級球：丟棄 ${names}`, idx);
  }
  st = updatePlayer(st, idx, (p) => {
    const toDiscard = p.hand.filter(c => iids.includes(c.iid));
    return { ...p, hand: p.hand.filter(c => !iids.includes(c.iid)), discard: [...p.discard, ...toDiscard] };
  });
  // v3.995：minCount=0 — 對手不知道牌庫內容，選不選由玩家決定（即使有也可不找）
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'Pokemon',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});

// 超級信號 — 從牌庫搜尋 1 張「超級進化寶可夢 ex」加手牌
// ⚠️ 必須只過濾「超級進化 ex」（名字開頭「超級」），普通 ex（桃歹郎ex / 拉帝亞斯ex）不可被搜到
regG('超級信號', (st, idx, pool) =>
  st.players[idx].deck.length > 0
);
reg('超級信號', (st, idx, pool) => {
  st = addLog(st, '超級信號：從牌庫選 1 張超級進化寶可夢 ex 加手牌', idx);
  // v2.993：卡面寫「選 1 張」mandatory；牌庫無超級進化 ex 時允許 Pass
  const hasMegaEx = st.players[idx].deck.some(c => {
    const card = pool.get(c.cardId);
    return card?.supertype === 'Pokemon' && (card.name?.startsWith('超級') ?? false) && (card.name?.includes('ex') ?? false);
  });
  return withPending(st, {
    type: 'deck-search',
    actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'MegaEx',
    minCount: 0, maxCount: 1,
    effectKey: 'search-pokemon-to-hand',
  });
});
