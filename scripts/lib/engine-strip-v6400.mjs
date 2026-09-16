/**
 * v6.400：engine.ts 相對前一版（v6.399）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * 用法與 engine-strip-v6394 / engine-strip-v6398 相同，三處各自 import 同一份：
 *   ・test-v6265-phantom-start-race.mjs 的 F4c／F4d
 *   ・test-v6375-a1-fieldwide-asof.mjs 的 F0b
 *   ・test-v6371-guard-hygiene.mjs 的探針（模組層相依）
 *
 * ⚠ 呼叫端拿到的字串必須已經 normEol（LF）。
 * ⚠ fail-closed：每一組錨點都必須恰好命中 1 次，否則直接 throw。
 *
 * 【v6.400 對 engine.ts 的 2 組合法改動】把「特殊能量視為提供什麼」的五份判準往一致的方向收：
 *   ① getEnergyProvided：未登記的特殊能量先看卡名的【X】再 fallback【無】。
 *      站上現有的特殊能量全部都在 SPECIAL_ENERGY_TYPES 裡 ⇒ **行為零變化**（守衛 F1 逐張釘住）。
 *   ② energyTypeUnitsHostAware 的一般分支改走 getEnergyProvided（＝付費端用的同一份表），
 *      修掉「扣殺／回力鏢／富裕／薄霧／噴射／反轉／治療」七張的【無】漏判（它們卡名裡沒有「【無】」
 *      兩個字，原本的 isEnergyOfType 一律回 false）。
 *      ⚠ 玩家可見行為零變化：H/I/J 沒有任何卡面在篩「附加的【無】能量卡」，
 *        且付費／撤退／countEnergy 三條路徑收斂前後**逐格完全相同**（87×7 矩陣比對，只有 21 格
 *        hostAware.Colorless 由 0 變 1）。
 */

/** [本版的樣子, BASE 的樣子]；順序無關，每一組都必須恰好命中 1 次。 */
const V6400_PAIRS = [
  // ①getEnergyProvided fallback
  [
    "  // \u7279\u6b8a\u80fd\u91cf\uff1a\u5148\u67e5\u8868\uff1b\u672a\u767b\u8a18\u8005\u5148\u770b\u5361\u540d\u7684\u3010X\u3011\uff0c\u6700\u5f8c\u624d fallback \u70ba Colorless\n  // \u2b50v6.400\uff1a\u88dc\u300c\u5361\u540d\u3010X\u3011\u300d\u9019\u4e00\u5c64 \u2014\u2014 \u7ad9\u4e0a**\u73fe\u6709**\u7684\u7279\u6b8a\u80fd\u91cf\u5168\u90e8\u90fd\u5728\u8868\u88e1\uff0c\u6240\u4ee5\u9019\u662f\n  //   **\u884c\u70ba\u96f6\u8b8a\u5316**\u7684\u6539\u52d5\uff08\u5b88\u885b test-v6400 \u7684 F1 \u9010\u5f35\u91d8\u4f4f\uff09\uff1b\u5b83\u7684\u610f\u7fa9\u662f\uff1a\u65e5\u5f8c\u65b0\u589e\u4e00\u5f35\n  //   \u300c\u6ce1\u6cab\u3010\u6c34\u3011\u80fd\u91cf\u300d\u9019\u7a2e\u5361\u540d\u81ea\u5e36\u5c6c\u6027\u7684\u7279\u6b8a\u80fd\u91cf\u6642\uff0c\u5c31\u7b97\u5fd8\u4e86\u52a0\u9032 SPECIAL_ENERGY_TYPES\uff0c\n  //   \u4e5f\u4e0d\u6703\u975c\u9ed8\u9000\u5316\u6210\u3010\u7121\u3011\uff08\u90a3\u6703\u8b93\u73a9\u5bb6\u4ed8\u4e0d\u51fa\u6709\u8272\u8cbb\u7528\uff09\u3002\n  if (SPECIAL_ENERGY_TYPES[c.name]) return SPECIAL_ENERGY_TYPES[c.name];\n  const sm = c.name.match(/\u3010(.+?)\u3011/);\n  if (sm) {\n    const st = ZH_ENERGY_TYPE[sm[1]];\n    if (st) return [st];\n  }\n  return ['Colorless'];\n",
    "  // \u7279\u6b8a\u80fd\u91cf\uff1a\u5148\u67e5\u8868\uff1b\u672a\u767b\u8a18\u8005 fallback \u70ba Colorless\n  if (SPECIAL_ENERGY_TYPES[c.name]) return SPECIAL_ENERGY_TYPES[c.name];\n  return ['Colorless'];\n",
  ],
  // ②energyTypeUnitsHostAware fallback
  [
    "  // \u2b50v6.400\uff1a\u4e00\u822c\u80fd\u91cf\uff08\u57fa\u672c\u80fd\u91cf \uff0b \u975e host-dependent \u7684\u7279\u6b8a\u80fd\u91cf\uff09\u4e00\u5f8b\u554f**\u6210\u672c\u7aef\u90a3\u4e00\u4efd\u8868**\n  //   getEnergyProvided\uff0c\u4e0d\u8981\u518d\u81ea\u5df1\u7528 isEnergyOfType \u5224\u4e00\u6b21\u3002\n  //   \u4fee\u6389\u7684\u6f0f\u5224\uff1a\u6263\u6bba\uff0f\u56de\u529b\u93e2\uff0f\u5bcc\u88d5\uff0f\u8584\u9727\uff08H/I \u6a19\uff09\u8207\u5674\u5c04\uff0f\u53cd\u8f49\uff0f\u6cbb\u7642\uff08G \u6a19\uff09\u9019 7 \u5f35\n  //   \u5361\u9762\u90fd\u662f\u300c\u8996\u70ba\u63d0\u4f9b1\u500b\u3010\u7121\u3011\u80fd\u91cf\u300d\uff0c\u4f46\u5361\u540d\u88e1\u6c92\u6709\u300c\u3010\u7121\u3011\u300d\u5169\u500b\u5b57 \u21d2 isEnergyOfType \u56de false\n  //   \u21d2 \u672c\u51fd\u5f0f\u5c0d\u5b83\u5011\u7684\u3010\u7121\u3011\u4e00\u5f8b\u7b54 0\uff0c\u800c countEnergy \u8207 canAffordAttack \u90fd\u7b54 1\u3002\n  //   \u26a0 \u76ee\u524d H/I/J \u6c92\u6709\u4efb\u4f55\u5361\u9762\u5728\u7be9\u300c\u9644\u52a0\u7684\u3010\u7121\u3011\u80fd\u91cf\u5361\u300d\u21d2 \u9019\u662f\u628a\u5169\u4efd\u5224\u6e96\u5c0d\u9f4a\uff0c\n  //     \u73a9\u5bb6\u53ef\u898b\u884c\u70ba\u96f6\u8b8a\u5316\uff08\u5b88\u885b test-v6400 \u9010\u683c\u6bd4\u5c0d\u91d8\u4f4f\uff09\u3002\n  return getEnergyProvided(e.cardId, pool).includes(type) ? 1 : 0;\n}",
    "  return isEnergyOfType(ec, type) ? 1 : 0;\n}",
  ],
];

/**
 * 把 v6.400 對 engine.ts 的合法改動逐字還原回前一版的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6400Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6400_PAIRS.length; i++) {
    const [cur, base] = V6400_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6400Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請對照本版 engine.ts 更新 V6400_PAIRS。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
