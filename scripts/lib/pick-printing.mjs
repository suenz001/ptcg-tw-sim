// ⭐⭐⭐ v6.333 測試用：從卡池挑「**具備指定招式／特性的那一張印刷**」。
//
// ⚠⚠ 為什麼需要這個（M6a「30th CELEBRATION」帶出來的）：
//   守衛裡到處都是 `byName('耿鬼ex')` / `byName('藏瑪然特')` 這種「用卡名挑一張」的 helper，
//   它會回傳卡池裡**第一張**同名卡。30 週年紀念包大量重印經典寶可夢名，
//   於是同一個名字底下多了一張招式／特性完全不同的印刷：
//     ・耿鬼ex：MC/SV5K 是【侵蝕詛咒】＋戲法舞步；M6a 076/103 是【死亡宣告】＋渾沌傷痛
//     ・藏瑪然特：SV10 有「強大猛擊」；M6a 093/103 是彈落／盾牌壓制
//   ⇒ 測試會靜默挑到錯的那一張，症狀是「找不到那一招」或「行為完全對不上」，
//     而**引擎其實沒壞**。這是 v6.257~259「同名不同印刷用卡名當 key」的測試端版本。
//
// ⇒ 挑印刷一律用「這一輪在測的那個特徵」（招式名或特性名）當條件，不要只用卡名。
//   這是**收緊**不是放寬：條件不夠精確時會直接 throw，不會靜默挑錯。

/**
 * @param {Map<string, any>} pool  cardId → card（呼叫端自己組，通常只含 live 卡包）
 * @param {string} name            台灣官方卡名（逐字）
 * @param {{attack?: string, ability?: string, marks?: string[]}} [opt]
 *   attack／ability：這張印刷必須有的招式名／特性名（擇一或並用）
 *   marks：可接受的賽季標，預設 H/I/J（站規只維護這三個標）
 * @returns {string} cardId
 */
export function pickPrinting(pool, name, opt = {}) {
  const { attack, ability, marks = ['H', 'I', 'J'] } = opt;
  const hits = [];
  for (const [id, c] of pool) {
    if (!c || c.name !== name) continue;
    if (marks && !marks.includes(c.regulationMark)) continue;
    if (attack && !(c.attacks ?? []).some((a) => a?.name === attack)) continue;
    if (ability && !(c.abilities ?? []).some((a) => a?.name === ability)) continue;
    hits.push(id);
  }
  if (hits.length === 0) {
    const all = [...pool.values()].filter((c) => c?.name === name)
      .map((c) => `${c.id}(${c.setCode} ${c.collectorNumber} ${c.regulationMark})`);
    throw new Error(
      `pickPrinting 找不到「${name}」`
      + (attack ? `｜招式「${attack}」` : '') + (ability ? `｜特性「${ability}」` : '')
      + `（標 ${marks.join('/')}）。卡池裡的同名卡：${all.join(', ') || '（一張都沒有）'}`);
  }
  return hits[0];
}

/** 同上，但要求「剛好一張」——用於必須唯一指認的場合（多於一張時代表條件不夠精確）。 */
export function pickPrintingUnique(pool, name, opt = {}) {
  const { attack, ability, marks = ['H', 'I', 'J'] } = opt;
  const hits = [];
  for (const [id, c] of pool) {
    if (!c || c.name !== name) continue;
    if (marks && !marks.includes(c.regulationMark)) continue;
    if (attack && !(c.attacks ?? []).some((a) => a?.name === attack)) continue;
    if (ability && !(c.abilities ?? []).some((a) => a?.name === ability)) continue;
    hits.push(id);
  }
  if (hits.length !== 1) {
    throw new Error(`pickPrintingUnique「${name}」條件不夠精確或找不到：命中 ${hits.length} 張（${hits.join(',')}）`);
  }
  return hits[0];
}
