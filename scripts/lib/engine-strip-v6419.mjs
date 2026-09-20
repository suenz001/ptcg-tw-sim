/**
 * v6.419：engine.ts 相對前一版（v6.418）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.418 **之前**。
 *
 * 【v6.419 對 engine.ts 的兩組改動】
 *   ① `v6419-no-pop-after-gameover`：佇列取出加 `phase === 'playing'` 前置
 *      （終局之後不再浮出一個點不動的 picker）。**修改型**。
 *   ② `v6419-settle-queued-prizes`：終局判出來時先結清**檯面上與佇列裡**沒兌現的
 *      `take-prize-choose`，再交給 v6.361 中央判定重判（⇒ 雙方同時取完 ⇒ 平手）。**純新增**。
 *
 * ⚠ 改動用 `// >>> v6419-xxx` / `// <<< v6419-xxx` 哨兵框起來。
 *   本檔由 `__m6a/gen_strip419.py` 從實際檔案產生，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6419_PAIRS = [
  [
    "    // >>> v6419-no-pop-after-gameover\n    // ⭐v6.419（站長裁定）：終局之後**不再**把佇列裡的 picker 浮上檯面。\n    //   先前終局後仍會浮出一個怎麼點都無效的 picker（applyActionImpl 開頭就\n    //   `if (state.phase === 'game-over') return state`）⇒ 畫面上是一層點不掉的暗幕\n    //   （被 .gameover-modal 的 z-index 9999 蓋住，只看得到暗幕）。\n    //   ⚠ 佇列本身**刻意保留**：v6419-settle-queued-prizes 會在本次 action 末端\n    //     讀它把未兌現的取獎賞結清，清空的動作由那裡負責。\n    if (newState.phase === 'playing' && !newState.pendingSelection && newState.pendingChainQueue && newState.pendingChainQueue.length > 0) {\n    // <<< v6419-no-pop-after-gameover\n",
    "    if (!newState.pendingSelection && newState.pendingChainQueue && newState.pendingChainQueue.length > 0) {\n"
  ],
  [
    "  // >>> v6419-settle-queued-prizes\n  // ⭐⭐⭐v6.419（站長裁定：「統一成平手」）。\n  //\n  // 【修的是什麼】「雙方**同時**取完最後一張獎賞卡」時，勝負會因為「有沒有開 picker」而不同：\n  //   ・雙方都沒有正面朝上的獎賞（不開 picker，兩邊同步自動取）\n  //       ⇒ 走下面的中央判定 ⇒ **平手**（v6.361 站長裁定 D-10／D-11）。✅\n  //   ・雙方都有正面朝上的獎賞（開 picker）\n  //       ⇒ `takeSpecificPrizes` 取光時自己就寫死 `winner: ownerIdx`、繞過中央判定，\n  //         而對手排在 `pendingChainQueue` 裡的那一筆**永遠不會被兌現**\n  //       ⇒ 變成「先取完的那一方獲勝」。❌（v6.418 之前也錯，只是錯在另一邊）\n  //\n  // 【修法】終局判出來時，若佇列裡還有沒兌現的 `take-prize-choose`：\n  //   ① 用既有的 `liftEndgameForOnKoV6361` 把終局暫時收回 'playing'（並留下 fail-safe 還原值）\n  //   ② 把那幾筆取獎賞結清（勝負已定，指定哪一張不再有任何資訊價值 ⇒ 取最前面的 N 張，\n  //      與 `PENDING_REFRESH_ON_POP` 的「已經沒有正面朝上的了」分支同一套語意）\n  //   ③ 交給下面的中央判定重判 ⇒ 雙方獎賞都歸 0 ⇒ **平手**\n  // ⚠ 只在「已經判出終局」時才會走到 ⇒ 對局進行中的排隊行為（v6.418）完全不受影響。\n  // ⚠ 平手時 `applyEndgameVerdictV6361` 會刪掉 winner、寫 isDraw ⇒ ②裡 takeSpecificPrizes\n  //   順手寫的 winner 會被覆蓋掉，不需要在這裡處理。\n  // ⚠⚠ 要看的是**兩個地方**（審查者實測抓到的洞，我自行查證屬實）：\n  //   ・`pendingChainQueue`：雙方都有正面朝上的獎賞時，第二位的 picker 排在這裡。\n  //   ・`pendingSelection`：**只有一方**有正面朝上的獎賞時，那一方的 picker 在檯面上\n  //     而對手是自動取 ⇒ 沒有排隊、只有檯面上這一筆沒兌現。\n  //     實測（bench 1/1、獎賞 2 vs 1）：只補佇列的話，四種組合會得到三種結果\n  //     FF=平手／TF=GEN 勝／FT=ATK 勝／TT=平手 —— 同一個盤面只差「誰的獎賞翻正面」。\n  // ⚠ 還要涵蓋 `_v6361NeedsVerdict === true`：drain 內的 lift 已經把 phase 收回 'playing'\n  //   （終局判過、正在重判）⇒ 只看 phase 會整條路徑跳過。\n  const _v6419Top = next.pendingSelection;\n  const _v6419Owed = [\n    ...(_v6419Top?.effectKey === 'take-prize-choose' ? [_v6419Top] : []),\n    ...(next.pendingChainQueue ?? []).filter(q => q.effectKey === 'take-prize-choose'),\n  ];\n  if ((next.phase === 'game-over' || next._v6361NeedsVerdict === true) && next.isDraw !== true\n      && _v6419Owed.length > 0) {\n    const _owed = _v6419Owed;\n    let _s = liftEndgameForOnKoV6361(next);\n    const _restQ = (next.pendingChainQueue ?? []).filter(q => q.effectKey !== 'take-prize-choose');\n    _s = {\n      ..._s,\n      pendingChainQueue: _restQ.length > 0 ? _restQ : undefined,\n      // 檯面上那一筆若是取獎賞，已經在下面結清 ⇒ 收掉（否則終局盤面會留一個點不動的視窗）\n      pendingSelection: _v6419Top?.effectKey === 'take-prize-choose' ? undefined : _v6419Top,\n    };\n    for (const _sel of _owed) {\n      const _idx = _sel.actorIdx as 0 | 1;\n      const _pz = _s.players[_idx]?.prizes ?? [];\n      if (_pz.length === 0) continue;\n      const _want = Math.min(Math.max(1, (_sel.params?.remaining as number) ?? 1), _pz.length);\n      _s = takeSpecificPrizes(_s, _idx, _pz.slice(0, _want).map(c => c.iid), pool);\n    }\n    next = _s;\n  }\n  // <<< v6419-settle-queued-prizes\n",
    ""
  ]
];

/**
 * 把 v6.419 對 engine.ts 的合法改動逐字還原回前一版（v6.418）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6419Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6419_PAIRS.length; i++) {
    const [cur, base] = V6419_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6419Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip419.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
