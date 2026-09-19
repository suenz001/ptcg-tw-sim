/**
 * v6.407：engine.ts 相對前一版（v6.406）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**：本版是「v6.407 的樣子 → v6.406 的樣子」，所以呼叫端必須
 *   **先** stripV6407Engine、**再** stripV6403Engine（以此類推，由新到舊；IRON_RULES Rule 54）。
 *
 * 【v6.407 對 engine.ts 的三組改動】主題：自身能量的「付出」延後到造成傷害之後。
 *   官方裁定：招式結算是三段 —— ① 傷害計算與造成 → ② 招式效果（含付出）→ ③ 受傷時特性／道具。
 *   依據：伏特【雷】能量的官方 Q&A（閃電鳥｜十萬伏特丟光能量仍 +60：
 *         「會在造成招式傷害後，才丟棄…能量卡」）
 *         ＋ `PTCG RULES/PTCG_RULES.md` §17.46.D（粉碎箭 vs 凍原堡壘：先算傷害再丟）
 *         ＋ §17.46.A／§17.22.A（招式效果仍早於「受傷時」的特性／道具）。
 *   ⇒ ATTACK_PRE／ATTACK_POST 只 `queueAttackEnergyPayment` 登記，
 *     engine 在「傷害造成後」與「ATTACK_POST 之後」各 flush 一次。
 *
 * ⚠ 三處改動全部用 `// >>> v6407-xxx` / `// <<< v6407-xxx` 哨兵框起來。
 *   本檔由 `__m6a/gen_strip407.py` 從實際檔案產生，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6407_PAIRS = [
  [
    "  // >>> v6407-engine-imports\n  flushAttackEnergyPayment,                   // ⭐⭐⭐v6.407 自身能量付出：登記後的單點執行\n  // <<< v6407-engine-imports\n",
    ""
  ],
  [
    "    // >>> v6407-flush-attack-energy-payment\n    // ⭐⭐⭐v6.407：自身能量的「付出」在這裡才真的執行。\n    //   位置就是官方三段順序的第二段：\n    //     ① 傷害計算與造成（上面那一行 addLog 已經做完）\n    //     ② **招式效果（含丟自己的能量）** ← 這裡\n    //     ③ 受傷時的特性／道具（龐克頭盔反擊、甲殼刺、手持循環扇…）\n    //   早於龐克頭盔預算與 resolveKnockouts ⇒ 甲殼刺／手持循環扇看到的是「已付出」的盤面，\n    //   它們「撲空」正是官方要的（§17.46.A 螺旋關節、§17.46.D 夾尾巴逃跑）。\n    //   ⚠ 沒有登記時這一行是 no-op（連欄位都沒建）⇒ 不影響任何其他招式。\n    newState = flushAttackEnergyPayment(newState, pool);\n    // ⚠⚠ defPlayers 是上面抳走的快照，下方有四處把它**整份**寫回 newState.players；\n    //   不同步的話，那四處會把攻擊方反寫回「還沒付出」的樣子（v6.368 那類 stale players 洞）。\n    defPlayers[aIdx] = newState.players[aIdx];\n    // <<< v6407-flush-attack-energy-payment\n\n",
    ""
  ],
  [
    "      // >>> v6407-flush-after-post\n      // ⭐⭐⭐v6.407：POST **也會**登記自身能量付出（超級麻麻鰻魚王ex｜災難衝擊\n      //   就是在 ATTACK_POST 裡呼叫 resolveOptInPayment）。上面那一次 flush 早於 POST，\n      //   所以這裡要**再跑一次**，否則 POST 登記的付出永遠不會執行（能量不見丟）。\n      //   ⚠ flush 對「沒有登記」的 state 是 no-op ⇒ 對其他招式完全無影響。\n      //   ⚠ POST 本身已經在傷害之後，所以這一次 flush 不會破壞官方的三段順序。\n      newState = flushAttackEnergyPayment(newState, pool);\n      // <<< v6407-flush-after-post\n",
    ""
  ]
];

/**
 * 把 v6.407 對 engine.ts 的合法改動逐字還原回前一版（v6.406）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6407Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6407_PAIRS.length; i++) {
    const [cur, base] = V6407_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6407Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip407.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
