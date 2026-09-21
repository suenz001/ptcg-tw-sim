/**
 * v6.421：engine.ts 相對前一版（v6.420）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.420 **之前**。
 *
 * 【v6.421 對 engine.ts 的六組改動】（站長裁定：自傷同時昏厥也判平手）
 *   ① `v6421-zombie-ko-central`：新增 isZombieKO／hasUnresolvedKnockout（純新增）
 *   ②③ sanityKOSweep 戰鬥場／備戰兩處的判準改走 isZombieKO（修改型，判準只有一份）
 *   ④ `v6421-koend-run-post`：防守方全滅時不再直接 return，先讓 postFn 跑完（修改型）
 *   ⑤ `v6421-defer-endgame-zombie`：終局延後的條件多兩條「場上還有 zombie」「中央判定會判平手」（修改型）
 *   ⑥ `v6421-sweep-zombie-under-picker`：已判出終局但檯面有 picker（正面朝上的獎賞）時照樣掃 zombie（純新增）
 *
 * 本檔的錨點由腳本從實際檔案的哨兵區塊擷取，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6421_PAIRS = [
  [
    "// >>> v6421-zombie-ko-central\n/**\n * ⭐⭐v6.421：「傷害已經達到 HP、卻還留在場上」（zombie）的**唯一**判準。\n *   sanityKOSweep 的戰鬥場／備戰兩處與下方 v6421 的終局延後判斷共用這一份（Rule 38）。\n */\nfunction isZombieKO(inst: CardInstance, pool: Map<string, Card>, s: GameState): boolean {\n  const hp = getEffectiveHP(inst, pool, s);\n  return hp > 0 && inst.damage >= hp;\n}\n/** 場上（雙方的戰鬥場＋備戰）是否還有該昏厥卻還沒昏厥的寶可夢。 */\nfunction hasUnresolvedKnockout(s: GameState, pool: Map<string, Card>): boolean {\n  for (const p of s.players) {\n    if (p.active && isZombieKO(p.active, pool, s)) return true;\n    for (const b of p.bench) if (isZombieKO(b, pool, s)) return true;\n  }\n  return false;\n}\n/**\n * 盤面已寫成「某一方獲勝」，但中央判定（含獎賞規則）會判**平手** ⇒ 需要收回重判。\n *   只看「→ 平手」這一個方向：卡片效果直接宣告勝負、牌庫抽完等中央判定不認得的終局\n *   （judge 回 over:false 或同一個勝方）一律不動。\n */\nfunction centralVerdictIsDrawV6421(s: GameState): boolean {\n  if (s.isDraw === true || (s.winner !== 0 && s.winner !== 1)) return false;\n  const v = judgeEndgameV6361(s, true);\n  return v.over === true && v.winner === null;\n}\n// <<< v6421-zombie-ko-central\n",
    ""
  ],
  [
    "    if (isZombieKO(inst, pool, s)) {   // ⭐v6421-zombie-ko-central（判準只有一份）\n      anyKO = true;\n      const ko = inst;",
    "    if (hp > 0 && inst.damage >= hp) {\n      anyKO = true;\n      const ko = inst;"
  ],
  [
    "    if (isZombieKO(inst, pool, s)) {   // ⭐v6421-zombie-ko-central（判準只有一份）\n      anyKO = true;\n      // v5.918 潛者捕捉",
    "    if (hp > 0 && b.damage >= hp) {\n      anyKO = true;\n      // v5.918 潛者捕捉"
  ],
  [
    "    // >>> v6421-koend-run-post\n    // ⭐⭐⭐v6.421（站長裁定，逐字：自傷同時昏厥「也判平手」）：\n    //   這裡原本 `if (_koEnd) return _koEnd;` —— 防守方最後一隻被打倒的當下**直接終局**，\n    //   招式本身剩下的效果（`postFn`）整段被跳過。實測：密勒頓（HP120、已受 90）用「打雷」\n    //   （卡面：這隻寶可夢也受到30點傷害。）打倒對手最後一隻 ⇒ 自傷那 30 點**根本沒套上**，\n    //   密勒頓 90 傷留在場上 ⇒ 判攻擊方獲勝。\n    //   官方順序是招式的效果全部結算完，才進行昏厥檢查與勝負判定（與 v6.361 D-10\n    //   「應該先結算死亡宣告再判勝負」同一個原理）。\n    //   ⇒ 用既有的 `liftEndgameForOnKoV6361` 把終局暫時收回 'playing'（留下 fail-safe 還原值），\n    //     讓 postFn 照跑；自傷造成的昏厥由 applyActionImpl 末端的 sanityKOSweep 結算，\n    //     最後由 v6.361 中央判定重判（取完獎賞但自己沒寶可夢 ⇒ v6.420 的平手分支）。\n    //   ⚠ postFn 本來就要能處理「防守方戰鬥位是空的」：一般 KO（有備戰）時也是先清空戰鬥位、\n    //     跑 postFn、最後才補位 ⇒ 防守方全滅只是「備戰也是空的」，不是新狀態。\n    if (_koEnd) newState = liftEndgameForOnKoV6361(_koEnd);\n    // <<< v6421-koend-run-post\n",
    "    if (_koEnd) return _koEnd;\n"
  ],
  [
    "  // >>> v6421-defer-endgame-zombie\n  // ⭐⭐v6.421：除了 on-KO 佇列，**場上還有該昏厥卻還沒昏厥的寶可夢**時也要延後。\n  //   情境：攻擊方取完最後的獎賞（addPendingPrize／takeSpecificPrizes 當場寫 game-over），\n  //   但招式的自傷已經讓攻擊方自己達到昏厥 ⇒ 不延後的話下面的 sanityKOSweep 被 gate 掉，\n  //   攻擊方帶著足以昏厥的傷害留在場上，判攻擊方獲勝（實測：密勒頓 120 傷仍在場）。\n  //   另外，**中央判定會判平手、盤面上卻寫著某一方獲勝**時也要延後重判（v6.420 裁定：\n  //   取完獎賞的一方自己也沒有寶可夢可上場 ⇒ 平手）。實測：喵喵ex｜夾尾巴逃跑 把自己放回手牌、\n  //   同時取完最後一張獎賞、自己沒有備戰 ⇒ addPendingPrize 當場寫「A 取得所有獎賞卡」，\n  //   沒有任何重判點 ⇒ 判 A 勝（審查者全卡掃描抓到 9 招）。判準直接呼叫中央\n  //   judgeEndgameV6361（Rule 38：不另寫一份 noMon）。\n  if (next.phase === 'game-over' && state.phase === 'playing'\n      && !next.pendingSelection\n      && ((next._onKoAfterPrize?.length ?? 0) > 0 || hasUnresolvedKnockout(next, pool)\n          || centralVerdictIsDrawV6421(next))) {\n  // <<< v6421-defer-endgame-zombie\n",
    "  if (next.phase === 'game-over' && state.phase === 'playing'\n      && !next.pendingSelection && (next._onKoAfterPrize?.length ?? 0) > 0) {\n"
  ],
  [
    "  // >>> v6421-sweep-zombie-under-picker\n  // ⭐⭐v6.421（fable 審查抓到、我自行重現屬實）：攻擊方最後一張獎賞是「正面朝上」時，\n  //   addPendingPrize 開了 take-prize-choose picker ⇒ 上面的延後與 sweep 都被 pendingSelection\n  //   擋住 ⇒ 密勒頓｜打雷 自傷到 120 的 zombie 沒人掃，下面 v6419 結清獎賞、中央重判看到\n  //   密勒頓還在場 ⇒ 判 A 勝（應為平手），終局盤面還留著 zombie。\n  //   ⇒ 這一次 action 已經判出終局（或正在重判）時，檯面上的 picker 不會再有人解\n  //     （終局 ⇒ applyEndgameVerdictV6361 會清掉）⇒ 不必等它，直接收回終局、把 zombie 掃掉；\n  //     sweep 裡新增的取獎賞會排進佇列，由下面 v6419 一併結清，最後照樣交給中央重判。\n  //   ⚠ 位置刻意在 v6.376 的持有者快照 clear **之前**（clear 必須在本 action 最後一次\n  //     sanityKOSweep 之後，否則 樂天河童｜生機森巴 這類最大 HP 型會被重算殺掉 —— test-v6376 D4）。\n  if ((next.phase === 'game-over' || next._v6361NeedsVerdict === true)\n      && !!next.pendingSelection && hasUnresolvedKnockout(next, pool)) {\n    next = liftEndgameForOnKoV6361(next);\n    const _aIdx421 = next.activePlayerIndex;\n    next = sanityKOSweep(next, _aIdx421, pool);\n    if (next.phase !== 'game-over') next = sanityKOSweep(next, (1 - _aIdx421) as 0 | 1, pool);\n  }\n  // <<< v6421-sweep-zombie-under-picker\n",
    ""
  ]
];

/**
 * 把 v6.421 對 engine.ts 的合法改動逐字還原回前一版（v6.420）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6421Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6421_PAIRS.length; i++) {
    const [cur, base] = V6421_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6421Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請依哨兵區塊重新擷取錨點。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
