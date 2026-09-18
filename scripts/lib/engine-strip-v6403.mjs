/**
 * v6.403：engine.ts 相對前一版（v6.402）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * ⚠⚠ **鏈的順序**：本版是「v6.403 的樣子 → v6.402 的樣子」，所以呼叫端必須
 *   **先** stripV6403Engine、**再** stripV6402Engine（以此類推，由新到舊；IRON_RULES Rule 54）。
 *
 * 用法與 engine-strip-v6394 / v6398 / v6400 / v6401 / v6402 相同，三處各自 import 同一份：
 *   ・test-v6265-phantom-start-race.mjs 的 F4c／F4d
 *   ・test-v6375-a1-fieldwide-asof.mjs 的 F0b
 *   ・test-v6371-guard-hygiene.mjs 的探針（模組層相依）
 *
 * 【v6.403 對 engine.ts 的 13 組合法改動】主題：「寶可夢【ex】」判準收斂。
 *   v3.67 曾把站內所有 ex 判準**一刀切**改成 isRulePokemon（＝「擁有規則的寶可夢」），
 *   不管卡面寫的是哪一句。v6.403 依 static/cards 台灣官方卡面逐字還原成三個述詞：
 *     ・isPokemonExCard ← 「寶可夢【ex】」        （影藏／防護代碼／阿塞蘿拉的惡作劇／
 *                                                  空手道王的演練／鬥志戰吼／虹色DNA／獎賞張數）
 *     ・isRuleBoxExOrV  ← 「寶可夢【ex】・【V】」 （烏栗）
 *     ・isRulePokemon   ← 「擁有規則的寶可夢」    （本檔內未變更的那些）
 *   三個述詞的**定義**全部在 leaf `selection-filter.ts`，engine 只 import／re-export。
 *
 * ⚠ 行為差異：全 live 卡池 5225 張逐格比對（__m6a/matrix403.mjs 的 23 欄矩陣），
 *   只有 8 張有差異，**全部不在 H/I/J**（F／D／E 標與無標的舊 EX／V 卡）
 *   ⇒ 標準賽零行為變更。守衛 test-v6403 的 E 組逐張釘住這 8 張。
 *
 * ⚠ 本檔由 `__m6a/gen_strip403.py` 從 BASE／HEAD 的 engine.ts 自動產生並驗證
 *   「套用全部 pair 後逐字等於 BASE」——不是手打的，不會漏掉任何一個 hunk。
 */

/** [本版的樣子, BASE 的樣子]；順序無關，每一組都必須恰好命中 1 次。 */
const V6403_PAIRS = [
  [
    "import { isBasicPokemonCard, isBasicPokemonOnField, isRulePokemon, isPokemonExCard, isRuleBoxExOrV, isBasicEnergyOfType, getBasicEnergyType, isMegaExCard, ZH_ENERGY_TYPE, evaluateSelectionFilter, isKnownSelectionFilter, sanitizeSelectionSet } from './selection-filter';",
    "import { isBasicPokemonCard, isBasicPokemonOnField, isRulePokemon, isBasicEnergyOfType, getBasicEnergyType, isMegaExCard, ZH_ENERGY_TYPE, evaluateSelectionFilter, isKnownSelectionFilter, sanitizeSelectionSet } from './selection-filter';"
  ],
  [
    "export { isBasicPokemonCard, isBasicPokemonOnField, isRulePokemon, isPokemonExCard, isRuleBoxExOrV, isBasicEnergyOfType, getBasicEnergyType };",
    "export { isBasicPokemonCard, isBasicPokemonOnField, isRulePokemon, isBasicEnergyOfType, getBasicEnergyType };"
  ],
  [
    "  if (!isPokemonExCard(evoCard)) return false;   // ⭐v6.403 收斂：卡面「寶可夢【ex】」",
    "  if (evoCard.subtype !== 'ex') return false;"
  ],
  [
    "  const isEx = isPokemonExCard(card);   // ⭐v6.403 收斂（官方規則寫的是「寶可夢ex」）",
    "  const isEx = card.name.endsWith('ex') || card.name.endsWith('EX');"
  ],
  [
    "    const _oppIsExEarly = isPokemonExCard(_oppActiveCardEarly);   // ⭐v6.403 收斂",
    "    const _oppIsExEarly = _oppActiveCardEarly?.subtype === 'ex' || (_oppActiveCardEarly?.name?.endsWith('ex') ?? false);"
  ],
  [
    "    if (baseDamage > 0 && attacker.karateKingBonusThisTurn && isPokemonExCard(defenderCard ?? undefined)) {   // ⭐v6.403 收斂",
    "    if (baseDamage > 0 && attacker.karateKingBonusThisTurn && defenderCard?.subtype === 'ex') {"
  ],
  [
    "      // ⭐v6.403 收斂：卡面「對對手的戰鬥場的「寶可夢【ex】・【V】」造成的傷害「+30」點。」\n      const isExV = isRuleBoxExOrV(defenderCard);",
    "      const isExV = defenderCard.subtype === 'ex'\n        || defenderCard.name.endsWith('ex')\n        || defenderCard.name.endsWith('EX')\n        || defenderCard.name.endsWith('V')\n        || defenderCard.name.endsWith('VMAX')\n        || defenderCard.name.endsWith('VSTAR');"
  ],
  [
    "    //   且 attacker 是 ex + 帶有對應 tag，傷害變 0\n    // ⭐v6.403：卡面「寶可夢【ex】」⇒ isPokemonExCard（v3.67 曾一刀切成 isRulePokemon）。\n    // v5.124：打爆類「不計算 defender 身上附加效果」應 bypass — 加 !skipDefEffects gate",
    "    //   且 attacker 是 ex + 帶有對應 tag，傷害變 0\n    // v3.67：改用 isRulePokemon helper（涵蓋未來新規則寶可夢類型）\n    // v5.124：打爆類「不計算 defender 身上附加效果」應 bypass — 加 !skipDefEffects gate"
  ],
  [
    "    if (!skipDefEffects && baseDamage > 0 && defender.active.immuneToExAttackTagThisTurn && isPokemonExCard(attackerCard)) {   // ⭐v6.403",
    "    if (!skipDefEffects && baseDamage > 0 && defender.active.immuneToExAttackTagThisTurn && isRulePokemon(attackerCard)) {"
  ],
  [
    "    // ⭐v6.403：卡面「…不會受到對手的「寶可夢【ex】」招式的傷害與效果的影響。」\n    const attackerIsEx = isPokemonExCard(attackerCard);",
    "    // v3.67：改用 isRulePokemon helper（涵蓋未來新規則寶可夢類型）\n    const attackerIsEx = isRulePokemon(attackerCard);"
  ],
  [
    "      const isExAttacker = isPokemonExCard(attackerCard);   // ⭐v6.403 卡面「寶可夢【ex】」唯一判準",
    "      const isExAttacker = attackerCard.name.endsWith('ex') || attackerCard.name.endsWith('EX');"
  ],
  [
    "                          && isPokemonExCard(attackerCard);   // ⭐v6.403 與主管線同一份",
    "                          && isRulePokemon(attackerCard);"
  ],
  [
    "  const oppIsExUI = isPokemonExCard(oppActiveCardUI);   // ⭐v6.403 收斂（與 EVOLVE handler 同一份）",
    "  const oppIsExUI = oppActiveCardUI?.subtype === 'ex' || (oppActiveCardUI?.name?.endsWith('ex') ?? false);"
  ]
];

/**
 * 把 v6.403 對 engine.ts 的合法改動逐字還原回前一版（v6.402）的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6403Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6403_PAIRS.length; i++) {
    const [cur, base] = V6403_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6403Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請重跑 __m6a/gen_strip403.py 重新產生。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
