/**
 * v6.422：engine.ts 相對前一版（v6.421）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**（Rule 54：由新到舊）：本版必須排在 v6.421 **之前**。
 *
 * 【v6.422 對 engine.ts 的兩組改動】（兩組都是純新增）
 *   ① `v6422-endgame-finalize-helper`：finalizeEndgameV6422（終局收尾：清殘留 picker、改寫提早的勝利宣告）
 *   ② `v6422-endgame-finalize`：applyActionImpl 末端唯一的呼叫點
 *
 * 本檔的錨點由腳本從實際檔案的哨兵區塊擷取，並**當場驗證剝除後逐字等於 BASE**，不是手打。
 */

/** [本版的樣子, BASE 的樣子]；每一組都必須恰好命中 1 次。 */
const V6422_PAIRS = [
  [
    "// >>> v6422-endgame-finalize-helper\n/**\n * ⭐⭐v6.422：終局收尾（只在「本次 action 才判出終局」時呼叫一次，見 applyActionImpl 末端）。\n *\n * ① **清掉終局盤面上殘留的選擇視窗**（pendingSelection／pendingChainQueue）。\n *    審查者全卡實測：108 個招式在「取完最後一張獎賞」後，postFn 仍開出一般 picker，\n *    盤面寫著 game-over 卻留著 pendingSelection —— applyActionImpl 開頭對 game-over 早退，\n *    那個視窗永遠解不掉，只是剛好被勝負結算畫面蓋住。v4.73／v6.361 各自在自己的分支清，\n *    這裡把「任何一條路徑判出的終局」一次收齊。\n *\n * ② **改寫本 action 內「提早寫下的勝利宣告」**。\n *    v6.361 起，終局可能被收回（liftEndgameForOnKoV6361）、效果結算完之後再由中央重判。\n *    收回之前 addPendingPrize／resolveKnockouts 已經寫了「A 取得所有獎賞卡，獲勝！」\n *    ⇒ 玩家在紀錄裡先看到「A 獲勝」，接著才看到「⚖️ … 平手」。\n *    ⇒ 只改寫**與最終結果不一致**的那幾行：句尾「獲勝！」換成「（勝負待效果結算完畢後判定）」，\n *      前半句（取得所有獎賞卡／沒有可上場的寶可夢）照留，事實陳述不變。\n *    ⚠ 只動**本 action 新增**的紀錄（index ≥ 前一個盤面的 log 長度）：之前的紀錄已經推上伺服器，\n *      oracle-client 的 delta PUT 只送追加的部分（logAppend），改寫舊行會讓兩端不一致。\n *    ⚠ 雙方同名時宣告的名字必然等於勝方名字 ⇒ 有勝方時自然不改寫（分不出是誰就不動），\n *      只有「最終平手」會改寫（平手時任何勝利宣告都不成立）。\n */\nconst V6422_PENDING_NOTE = '（勝負待效果結算完畢後判定）';\n/**\n * 一行紀錄若是某位玩家的勝利宣告，回傳 [勝方座位, 去掉「獲勝」後綴的前半句]；否則 null。\n *   ⚠ 用**兩位玩家的實際名字**做後綴比對，不用 regex 猜名字 —— 玩家名稱可以含全形逗號\n *     （伺服器只做長度截斷），「，([^，]+) 獲勝！」會把名字切斷（審查者實測：「小明，大王」）。\n *   句型（全站 grep「獲勝！」逐一核對）：\n *     「{名} 取得所有獎賞卡，獲勝！」／「…，{名} 獲勝！」（沒有可上場的寶可夢、無法抽牌）\n */\nfunction parseWinClaimV6422(msg: string, names: [string, string]): [0 | 1, string] | null {\n  let best: [0 | 1, string] | null = null;\n  let bestLen = -1;\n  for (const w of [0, 1] as const) {\n    // ⚠ 兩個名字都對得上時取**較長**的那個（例：「大王」與「小明，大王」—— 後者的宣告也以「，大王 獲勝！」結尾）\n    if (names[w].length <= bestLen) continue;\n    if (msg === `${names[w]} 取得所有獎賞卡，獲勝！`) { best = [w, `${names[w]} 取得所有獎賞卡`]; bestLen = names[w].length; continue; }\n    const tail = `，${names[w]} 獲勝！`;\n    if (msg.endsWith(tail) && msg.length > tail.length) { best = [w, msg.slice(0, -tail.length)]; bestLen = names[w].length; }\n  }\n  return best;\n}\nexport function finalizeEndgameV6422(prev: GameState, next: GameState): GameState {\n  let out: GameState = next;\n  // ① 殘留的選擇視窗\n  //   ⚠ 用 delete、不寫 undefined（v6.417 同一個理由：留著 key 的 undefined 會讓 buildRoomPatch\n  //     走 set 而不是 del，一旦被 JSON.stringify 丟掉，伺服器端的舊值就永遠刪不掉）。\n  //   ⚠ 值為 undefined 但 key 還在的也一併 delete（applyEndgameVerdictV6361／v4.73 兜底寫的是\n  //     `pendingSelection: undefined`；審查者提醒：與 v6.417 同一顆地雷）。null 不動（Firestore 可存）。\n  if (out.pendingSelection || (out.pendingChainQueue?.length ?? 0) > 0\n      || ('pendingSelection' in out && out.pendingSelection === undefined)\n      || ('pendingChainQueue' in out && out.pendingChainQueue === undefined)) {\n    const c: GameState = { ...out };\n    delete (c as { pendingSelection?: unknown }).pendingSelection;\n    delete (c as { pendingChainQueue?: unknown }).pendingChainQueue;\n    out = c;\n  }\n  // ② 與最終結果不一致的提早勝利宣告\n  const base = prev.log?.length ?? 0;\n  const log = out.log ?? [];\n  if (log.length > base) {\n    const draw = out.isDraw === true;\n    const w = (out.winner === 0 || out.winner === 1) ? out.winner : null;\n    const names: [string, string] = [String(out.players[0]?.name ?? ''), String(out.players[1]?.name ?? '')];\n    // 雙方同名時宣告的是誰無從分辨 ⇒ 只在平手時改寫（平手時任何勝利宣告都不成立）\n    const sameNames = names[0] === names[1];\n    let changed = false;\n    const nl = log.map((e, i) => {\n      if (i < base || typeof e?.message !== 'string') return e;\n      const c = parseWinClaimV6422(e.message, names);\n      if (c === null) return e;\n      const wrong = draw || (!sameNames && w !== null && c[0] !== w);\n      if (!wrong) return e;\n      changed = true;\n      return { ...e, message: c[1] + V6422_PENDING_NOTE };\n    });\n    if (changed) out = { ...out, log: nl };\n  }\n  return out;\n}\n// <<< v6422-endgame-finalize-helper\n",
    ""
  ],
  [
    "  // >>> v6422-endgame-finalize\n  // ⭐⭐v6.422：本次 action 判出終局時的**最後一道收尾**（全站只有這一處）。\n  //   （開頭對 state.phase === 'game-over' 早退 ⇒ 走到這裡的一定是「本次才判出終局」。）\n  if (next.phase === 'game-over') {\n    next = finalizeEndgameV6422(state, next);\n  }\n  // <<< v6422-endgame-finalize\n",
    ""
  ]
];

/**
 * 把 v6.422 對 engine.ts 的合法改動逐字還原回前一版（v6.421）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6422Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6422_PAIRS.length; i++) {
    const [cur, base] = V6422_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6422Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請依哨兵區塊重新擷取錨點。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
