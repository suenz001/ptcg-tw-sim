// v6.081 M6「綠寶石風暴」實裝 批次 14 —— 能量加速型特性 3 個 + 道具招式 1 個
//
// ⚠ 卡面逐字取自 static/cards（台灣官方中文），未經簡化。
// ⚠「以任意方式附於…」一律走中央 startEnergyChain（逐張選目標分散），
//    禁「選 1 隻塞全部」（v5.858 教訓）。

import { regAByName, regR, addLog, updatePlayer, withPending, shuffle } from '../_shared';
import { startEnergyChain } from './v158_energy_chain'; // v6.081 「以任意方式附加」中央 chain

// ── 1. 鴨嘴炎獸｜拍檔提升 ─────────────────────────────────────────────────
// 卡面：在自己的回合時可使用1次。從自己的手牌選擇「基本【火】能量」卡與
//        「基本【雷】能量」卡最多各1張，以任意方式附於自己的「電擊魔獸」或者
//        「鴨嘴炎獸」身上。
//   ⚠「最多各 1 張」→ 火 ≤1 且 雷 ≤1（不是「總共最多 2 張」，兩張同屬性不合法）。
//   ⚠ 目標限定卡名「電擊魔獸」「鴨嘴炎獸」（含戰鬥位與備戰）。
//   ⚠ 從手牌附能 → startEnergyChain(source:'hand') 內部已接
//     fireOnHandEnergyAttached（磁怪治癒 / 對手侵蝕詛咒等反應）。
const PARTNER_BOOST_TARGET_NAMES = ['電擊魔獸', '鴨嘴炎獸'];
regAByName('鴨嘴炎獸', '拍檔提升', (st, idx, pool) => {
  const p = st.players[idx];
  const isBasicOf = (cid: string, zh: string): boolean => {
    const c = pool.get(cid);
    return !!c && c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes(zh);
  };
  const fireIids = p.hand.filter(c => isBasicOf(c.cardId, '【火】')).map(c => c.iid);
  const ltngIids = p.hand.filter(c => isBasicOf(c.cardId, '【雷】')).map(c => c.iid);
  if (fireIids.length === 0 && ltngIids.length === 0) {
    return addLog(st, '拍檔提升：手牌沒有基本【火】能量與基本【雷】能量', idx);
  }
  const targets = [...(p.active ? [p.active] : []), ...p.bench]
    .filter(c => PARTNER_BOOST_TARGET_NAMES.includes(pool.get(c.cardId)?.name ?? ''));
  if (targets.length === 0) {
    return addLog(st, '拍檔提升：場上沒有「電擊魔獸」或「鴨嘴炎獸」', idx);
  }
  const valid = [...fireIids, ...ltngIids];
  return withPending(
    addLog(st, '拍檔提升：從手牌選「基本【火】能量」與「基本【雷】能量」最多各 1 張', idx), {
      type: 'hand-discard', actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'Energy',
      // ⚠ v6.083：maxCount 依「有幾種屬性」而非總張數 —— 卡面是「各最多 1 張」，
      //   手牌只有 2 張火時上限應是 1（原本可勾 2 張，resolver 靜默只收 1 張＝體感沒做完）。
      minCount: 0, maxCount: (fireIids.length > 0 ? 1 : 0) + (ltngIids.length > 0 ? 1 : 0),
      effectKey: 'm6-partner-boost-pick',
      params: {
        validIids: valid,
        fireIids, ltngIids,
        targetIids: targets.map(t => t.iid),
        titleOverride: '拍檔提升：選基本【火】／基本【雷】能量（各最多 1 張，接著選要附給哪隻）',
      },
    });
});
regR('m6-partner-boost-pick', (st, idx, iids, params, pool) => {
  // ⚠ 公平性自驗（v6.009 通則）：client 送來的 iid 必須在候選內，且**每種屬性最多 1 張**。
  const fire = new Set((params?.fireIids as string[]) ?? []);
  const ltng = new Set((params?.ltngIids as string[]) ?? []);
  const targetIids = (params?.targetIids as string[]) ?? [];
  const picked: string[] = [];
  let usedFire = false, usedLtng = false;
  for (const id of iids) {
    if (fire.has(id) && !usedFire) { picked.push(id); usedFire = true; continue; }
    if (ltng.has(id) && !usedLtng) { picked.push(id); usedLtng = true; continue; }
    // 超出「各 1 張」或不在候選 → 忽略
  }
  if (picked.length === 0) return addLog(st, '拍檔提升：未選擇能量', idx);
  // 交給中央 chain：逐張選要附給哪隻（限「電擊魔獸」「鴨嘴炎獸」）
  return startEnergyChain(st, idx, picked, {
    label: '拍檔提升', source: 'hand', scope: 'any-own', filterType: 'Any', targetIids,
  }, pool);
});

// ── 2. 杖尾鱗甲龍｜鱗片律動 ───────────────────────────────────────────────
// 卡面：在自己的回合時可使用1次。查看自己的牌庫上方6張卡，從其中選擇任意數量的
//        基本能量卡，以任意方式附於自己的【龍】寶可夢身上。將剩餘卡放回牌庫並重洗。
//   ⚠ filter 用已接線的 'TOP6'（picker 顯示翻開的 6 張全部＝「查看」），
//     可勾選的限制走 validIids（只有基本能量）。
//   ⚠「以任意方式」→ startEnergyChain 逐張選目標；目標限自己的【龍】寶可夢。
regAByName('杖尾鱗甲龍', '鱗片律動', (st, idx, pool) => {
  const p = st.players[idx];
  if (p.deck.length === 0) return addLog(st, '鱗片律動：牌庫為空', idx);
  const top6 = p.deck.slice(0, 6);
  const basicEnergyIids = top6
    .filter(c => { const cc = pool.get(c.cardId); return cc?.supertype === 'Energy' && cc.subtype === 'Basic'; })
    .map(c => c.iid);
  const dragons = [...(p.active ? [p.active] : []), ...p.bench]
    .filter(c => pool.get(c.cardId)?.pokemonType === 'Dragon');
  if (dragons.length === 0) return addLog(st, '鱗片律動：場上沒有【龍】寶可夢', idx);
  return withPending(
    addLog(st, `鱗片律動：查看牌庫上方 ${top6.length} 張，選任意數量基本能量附於自己的【龍】寶可夢`, idx), {
      type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
      filter: 'TOP6',
      minCount: 0, maxCount: Math.max(1, basicEnergyIids.length),
      effectKey: 'v158-energy-chain-start',
      params: {
        top6Iids: top6.map(c => c.iid),
        validIids: basicEnergyIids,
        label: '鱗片律動', source: 'deck', scope: 'any-own', filterType: 'Any',
        targetIids: dragons.map(d => d.iid),
        titleOverride: '鱗片律動：牌庫上方 6 張中的基本能量（選任意數量，接著逐張選要附給哪隻【龍】）',
      },
    });
});

// ── 3. 超級烈空坐ex｜霸者咆哮 ─────────────────────────────────────────────
// 卡面：在自己的回合，從手牌將這張卡放置於備戰區時，可使用1次。查看自己的牌庫上方4張卡，
//        從其中選擇1張基本能量卡，附於這隻寶可夢身上。將剩餘卡翻回反面並重洗，放回牌庫下方。
//   ⚠ 剩餘卡是「重洗後**放回牌庫下方**」，不是洗回整副牌庫（順序意義不同）。
//   ⚠ 只附給「這隻寶可夢」（發動特性的那隻），不是任選。
regAByName('超級烈空坐ex', '霸者咆哮', (st, idx, pool, cardInst) => {
  const p = st.players[idx];
  // ⚠ v6.083：**不**用 abilityNamesUsedThisTurn 擋（原 v6.081 寫法過嚴）。
  //   卡面「在自己的回合，從手牌將**這張卡**放置於備戰區時，可使用1次」——「1 次」綁的是
  //   「這一次放置」，同回合放第二隻超級烈空坐ex 應該各自可以發動。
  //   對照組：喵喵ex｜殺手鐧捕捉 之所以用名稱層級，是因為它卡面**另有明文**
  //   「在這個回合，若已經使出了名稱中有『殺手鐧』的特性，則這個特性無法使用」。本卡沒有這句。
  //   觸發點只有 promptPlayAbilities 的「放置時詢問」（engine 不把 ON_PLAY 特性放進手動清單），
  //   所以一次放置天然只會問一次，不需要額外的 per-turn gate。
  const selfIid = cardInst?.iid;
  if (!selfIid) return addLog(st, '霸者咆哮：找不到發動的寶可夢', idx);
  if (p.deck.length === 0) return addLog(st, '霸者咆哮：牌庫為空', idx);
  const top4 = p.deck.slice(0, 4);
  const basicEnergyIids = top4
    .filter(c => { const cc = pool.get(c.cardId); return cc?.supertype === 'Energy' && cc.subtype === 'Basic'; })
    .map(c => c.iid);
  const s = addLog(st, `霸者咆哮：查看牌庫上方 ${top4.length} 張，選 1 張基本能量附於自己`, idx);
  return withPending(s, {
    type: 'deck-search', actorIdx: idx, sourcePlayerIdx: idx,
    filter: 'TOP4',
    minCount: 0, maxCount: 1,
    effectKey: 'm6-overlord-roar',
    params: {
      top4Iids: top4.map(c => c.iid),
      validIids: basicEnergyIids,
      selfIid,
      titleOverride: '霸者咆哮：牌庫上方 4 張中的基本能量（選 1 張附於這隻寶可夢）',
    },
  });
});
regR('m6-overlord-roar', (st, idx, iids, params, pool) => {
  const selfIid = params?.selfIid as string | undefined;
  const p = st.players[idx];
  const top4Iids = new Set((params?.topIids as string[]) ?? (params?.top4Iids as string[]) ?? []);
  const top4 = p.deck.filter(c => top4Iids.has(c.iid));
  // 自驗：只認「在翻開的 4 張內 ∧ 是基本能量」的 iid
  const chosen = top4.find(c => iids.includes(c.iid)
    && (() => { const cc = pool.get(c.cardId); return cc?.supertype === 'Energy' && cc.subtype === 'Basic'; })());
  const rest = top4.filter(c => c.iid !== chosen?.iid);
  const remainingDeck = p.deck.filter(c => !top4Iids.has(c.iid));
  let s = st;
  if (chosen && selfIid) {
    const eName = pool.get(chosen.cardId)?.name ?? '?';
    s = addLog(s, `霸者咆哮：將 ${eName} 附於這隻寶可夢`, idx);
  } else {
    s = addLog(s, '霸者咆哮：未附加能量', idx);
  }
  // 剩餘卡「翻回反面並重洗，放回牌庫下方」
  s = addLog(s, `霸者咆哮：其餘 ${rest.length} 張翻回反面並重洗，放回牌庫下方`, idx);
  return updatePlayer(s, idx, pl => {
    const attachTo = (c: typeof pl.active) =>
      c && chosen && c.iid === selfIid ? { ...c, energyAttached: [...c.energyAttached, chosen] } : c;
    return {
      ...pl,
      active: attachTo(pl.active) ?? null,
      bench: pl.bench.map(b => attachTo(b)!),
      deck: [...remainingDeck, ...shuffle(rest)],
    };
  });
});
