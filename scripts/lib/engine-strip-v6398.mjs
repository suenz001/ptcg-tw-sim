/**
 * v6.398：engine.ts 相對前一版（v6.397）的「合法改動」還原器 —— 全站**只有這一份**（Rule 38）。
 *
 * 用法與 engine-strip-v6394.mjs 完全相同（它的檔頭說明了為什麼需要這種還原器）：
 *   ・test-v6265-phantom-start-race.mjs 的 F4c／F4d
 *   ・test-v6375-a1-fieldwide-asof.mjs 的 F0b
 *   ・test-v6371-guard-hygiene.mjs 的探針（模組層相依）
 * 三處**各自 import 同一份**，不要再抄。
 *
 * ⚠ 呼叫端拿到的字串必須已經 normEol（LF）。
 * ⚠ fail-closed：每一組錨點都必須恰好命中 1 次，否則直接 throw（過期要大聲炸開）。
 *
 * 【v6.398 對 engine.ts 的合法改動】站長回報「烈獄狂火X 丟不掉新衝天能量」後的全站收斂：
 * 「寶可夢身上附加的【X】能量卡」一律走中央 host-aware 述詞 energyProvidesType。
 *   ① energyTypeUnitsHostAware 補收「夜光能量」（G 標，視為 1 個所有屬性）——
 *      ②③ 兩處原本各自 inline 把夜光列為全屬性，不補的話改走中央就會退化。
 *   ② 夠讚狗｜腎上腺力量：inline 的六條【惡】判準 → energyProvidesType（**行為等價**，
 *      收斂理由是 Rule 38；守衛 test-v6398 的 A5 是零回歸斷言）。
 *   ③ 冰雪巨龍｜凍原堡壘（engine 主管線 active 路徑）：inline 的【水】判準 → energyProvidesType
 *      （**行為有變**：新衝天附於【2階進化】、稜鏡附於【基礎】現在會被正確認成【水】能量卡）。
 */

/** [本版的樣子, BASE 的樣子]；順序無關，每一組都必須恰好命中 1 次。 */
const V6398_PAIRS = [
  // ①夜光補表
  [
    "  if (ec.name === '\u53e4\u820a\u80fd\u91cf') return 1; // \u5168\u5c6c\u6027 ACE SPEC\n  // \u2b50v6.398\uff1a\u591c\u5149\u80fd\u91cf\uff08G \u6a19\uff0c\u5361\u9762\u300c\u8996\u70ba\u63d0\u4f9b1\u500b\u6240\u6709\u5c6c\u6027\u7684\u80fd\u91cf\u300d\uff09\u3002\u6536\u9304\u7406\u7531\uff1aengine \u5167\u539f\u672c\u6709\n  //   \u5169\u8655 inline \u5c6c\u6027\u5224\u6e96\uff08\u5920\u8b9a\u72d7\uff5c\u814e\u4e0a\u817a\u529b\u91cf\u3001\u51b0\u96ea\u5de8\u9f8d\uff5c\u51cd\u539f\u5821\u58d8\uff09\u5404\u81ea\u628a\u591c\u5149\u5217\u70ba\u5168\u5c6c\u6027\uff0c\n  //   v6.398 \u628a\u5b83\u5011\u6536\u6582\u5230\u672c\u51fd\u5f0f \u2014\u2014 \u82e5\u672c\u8868\u4e0d\u6536\uff0c\u6539\u8d70\u4e2d\u592e\u5c31\u6703\u8b93\u90a3\u5169\u5f35\u5361\u5c0d\u591c\u5149**\u9000\u5316**\u3002\n  //   \u26a0 \u5361\u9762\u7b2c\u4e8c\u6bb5\u300c\u82e5\u8eab\u4e0a\u9644\u6709\u9019\u5f35\u5361\u4ee5\u5916\u7684\u7279\u6b8a\u80fd\u91cf\u5361\uff0c\u5247\u8996\u70ba\u63d0\u4f9b1\u500b\u3010\u7121\u3011\u80fd\u91cf\u300d\u672c\u51fd\u5f0f\u770b\u4e0d\u5230\n  //     host \u7684 energyAttached\uff08\u7c3d\u540d\u53ea\u6709 cardId\uff09\u21d2 \u7dad\u6301\u8207 v6.398 \u4e4b\u524d engine \u5169\u8655 inline \u5b8c\u5168\u76f8\u540c\u7684\n  //     \u884c\u70ba\uff08\u4e0d\u505a\u8a72\u964d\u7d1a\uff09\uff0c\u4e0d\u5728\u672c\u7248\u64f4\u5927\u7bc4\u570d\uff1bG \u6a19\u4e0d\u5728\u6a19\u6e96\u8cfd\uff0c\u4e4b\u5f8c\u8981\u505a\u518d\u9023\u540c SPECIAL_ENERGY_TYPES \u4e00\u8d77\u6536\u3002\n  if (ec.name === '\u591c\u5149\u80fd\u91cf') return 1;\n",
    "  if (ec.name === '\u53e4\u820a\u80fd\u91cf') return 1; // \u5168\u5c6c\u6027 ACE SPEC\n",
  ],
  // ②夠讚狗
  [
    "  if (card.name === '\u5920\u8b9a\u72d7' && hpAbilityEffective(inst, card, '\u814e\u4e0a\u817a\u529b\u91cf')) {\n    // \u2b50v6.398 \u6536\u6582\uff08Rule 38\uff09\uff1a\u539f\u672c\u9019\u88e1 inline \u91cd\u5beb\u4e86\u4e00\u4efd\u300c\u8eab\u4e0a\u9644\u6709\u3010\u60e1\u3011\u80fd\u91cf\u5361\u300d\u5224\u6e96\n    //   \uff08\u57fa\u672c\u3010\u60e1\u3011/pokemonType/\u7a1c\u93e1 on Basic/\u53e4\u820a/\u591c\u5149/\u706b\u7bad\u968a \u516d\u689d\uff09\uff0c\u8207\u4e2d\u592e host-aware\n    //   \u8ff0\u8a5e energyProvidesType \u5404\u4e00\u4efd \u21d2 \u65b0\u7279\u6b8a\u80fd\u91cf\u53ea\u6703\u88ab\u52a0\u9032\u5176\u4e2d\u4e00\u908a\u3002\u6539\u8d70\u4e2d\u592e\u55ae\u4e00\u51fa\u53e3\u3002\n    const hasDark = inst.energyAttached.some(e => energyProvidesType(inst, e, 'Darkness', pool));\n    if (hasDark) hp += 100;\n  }\n",
    "  if (card.name === '\u5920\u8b9a\u72d7' && hpAbilityEffective(inst, card, '\u814e\u4e0a\u817a\u529b\u91cf')) {\n    const hostIsEvolution = !!card.evolvesFrom || card.stage === 'Stage1' || card.stage === 'Stage2';\n    const hasDark = inst.energyAttached.some(e => {\n      const ec = pool.get(e.cardId);\n      if (!ec || ec.supertype !== 'Energy') return false;\n      // \u57fa\u672c\u3010\u60e1\u3011\u80fd\u91cf\n      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Darkness' || /\u3010\u60e1\u3011/.test(ec.name))) return true;\n      // \u7279\u6b8a\u80fd\u91cf\u672c\u8eab\u5c6c\u6027\u542b Darkness\n      if (ec.pokemonType === 'Darkness') return true;\n      // \u7a1c\u93e1\u80fd\u91cf on Basic host \u2192 \u8996\u70ba\u5168\u5c6c\u6027\uff08\u542b Darkness\uff09\n      if (ec.name === '\u7a1c\u93e1\u80fd\u91cf' && !hostIsEvolution) return true;\n      // \u53e4\u820a / \u591c\u5149\u80fd\u91cf \u2192 \u55ae\u5f35\u5168\u5c6c\u6027\n      if (ec.name === '\u53e4\u820a\u80fd\u91cf' || ec.name === '\u591c\u5149\u80fd\u91cf') return true;\n      // \u706b\u7bad\u968a\u80fd\u91cf \u2192 \u63d0\u4f9b\u3010\u8d85\u3011\u3010\u60e1\u3011\n      if (ec.name === '\u706b\u7bad\u968a\u80fd\u91cf') return true;\n      return false;\n    });\n    if (hasDark) hp += 100;\n  }\n",
  ],
  // ③凍原堡壘
  [
    "      if (hasFrozenFortress && defender.active) {\n        // \u2b50v6.398 \u6536\u6582\uff08Rule 38\uff09\uff1a\u539f\u672c inline \u4e00\u4efd\u300c\u9644\u6709\u3010\u6c34\u3011\u80fd\u91cf\u5361\u300d\u5224\u6e96\uff08\u6f0f\u65b0\u885d\u5929 on Stage2\u3001\n        //   \u6f0f\u7a1c\u93e1 on \u57fa\u790e\uff09\uff0c\u4e14 effects.ts \u7684\u5099\u6230\u8def\u5f91\u53e6\u6709\u4e00\u4efd \u21d2 \u5169\u4efd\u90fd\u6539\u8d70\u4e2d\u592e energyProvidesType\u3002\n        const hasWater = defender.active.energyAttached.some(e => energyProvidesType(defender.active!, e, 'Water', pool));\n",
    "      if (hasFrozenFortress && defender.active) {\n        const hasWater = defender.active.energyAttached.some(e => {\n          const ec = pool.get(e.cardId);\n          if (!ec || ec.supertype !== 'Energy') return false;\n          // \u57fa\u672c\u3010\u6c34\u3011\u80fd\u91cf\n          if (ec.subtype === 'Basic' && (ec.pokemonType === 'Water' || /\u3010\u6c34\u3011/.test(ec.name ?? ''))) return true;\n          // \u7279\u6b8a\u80fd\u91cf\u672c\u8eab\u5c6c\u6027\u542b Water\n          if (ec.pokemonType === 'Water') return true;\n          // \u53e4\u820a\u80fd\u91cf / \u591c\u5149\u80fd\u91cf \u2192 \u5168\u5c6c\u6027\n          if (ec.name === '\u53e4\u820a\u80fd\u91cf' || ec.name === '\u591c\u5149\u80fd\u91cf') return true;\n          return false;\n        });\n",
  ],
];

/**
 * 把 v6.398 對 engine.ts 的合法改動逐字還原回前一版的樣子。
 * @param {string} src engine.ts 的內容（**必須已經 normEol 成 LF**）
 * @returns {string}
 */
export function stripV6398Engine(src) {
  let t = String(src);
  for (let i = 0; i < V6398_PAIRS.length; i++) {
    const [cur, base] = V6398_PAIRS[i];
    const hits = t.split(cur).length - 1;
    if (hits !== 1) {
      throw new Error('stripV6398Engine：第 ' + (i + 1) + ' 組錨點命中 ' + hits
        + ' 次（預期 1）——還原器過期了，請對照本版 engine.ts 更新 V6398_PAIRS。');
    }
    t = t.split(cur).join(base);
  }
  return t;
}
