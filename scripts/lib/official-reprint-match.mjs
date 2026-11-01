// ⭐ v6.616：判斷「官方的某張卡」是不是站上已收錄卡的重印（同名、同卡面）
// ─────────────────────────────────────────────────────────────────────────────
// 用途：新卡包偵測（scripts/refresh-official-set-manifest.mjs）比對官方商品清單時，
//   站上沒收錄的商品裡常有「標準賽可用」的卡（官方 regulation=1 篩選），但其中絕大多數
//   是站上早已收錄的訓練家／基本能量的重印（例：高級球、寶可夢交替、基本【火】能量）。
//   重印不必另收；真正要回報的是「站上找不到同名同卡面」的卡。
//
// 判準（保守：寧可多報、不可漏報）：
//   ・名稱：去掉空白／零寬字元與【】後逐字相同（「基本雷能量」＝「基本【雷】能量」）
//     ⚠ 不去括號：老大的指令（赤日）與站上的「老大的指令」名稱不同，要報給站長看，不自動視為重印
//     （站長 2026-09-15 只裁定過「老大的指令（烏羽）」是官網誤植）
//   ・寶可夢：同名的寶可夢可以是完全不同的卡 ⇒ 階段、HP、屬性、弱點、抵抗力、撤退、每個招式（名稱／費用／傷害／效果）、
//     每個特性（名稱／效果）全部相同才算重印
//     ⚠ 刻意不比 evolvesFrom 與 tags：refresh 用的 parseCard 從官網「進化」面板讀進化鏈（面板列的是整條進化鏈，
//       單張讀進化來源常常讀錯，例：ex 卡）、tags 由爬蟲另外從篩選頁回填（parseCard 單張抓不到）⇒ 兩者比了只會讓同一張卡被誤報。
//       階段（stage／subtype）已經涵蓋「同名但階段不同」的情形。
//   ・訓練家／能量：遊戲規則上同名＝同一張卡（構築的 4 張限制也是看名稱），舊印刷只差在
//     譯文措辭（2026-11-01 實測：「各自」／「各」、多印「在自己的回合時，物品卡可不限張數使用。」）
//     ⇒ 只比名稱與種類（supertype）

// ⚠ 唯一一份：refresh 與守衛 test-official-set-completeness 都 import 這裡（Rule 38）。

const ZW = /[\s\u200b-\u200d\ufeff]/g;
const PUNCT = /[。、，,．.「」『』：:；;！!？?（）()]/g;

/** 名稱正規化：去空白、零寬字元與【】 */
export const normName = (s) => String(s ?? '').replace(ZW, '').replace(/[【】]/g, '');
/** 文字正規化：去空白、零寬字元、標點、【】 */
export const normText = (s) => String(s ?? '').replace(ZW, '').replace(PUNCT, '').replace(/[【】]/g, '');

function pokemonFace(c) {
  return JSON.stringify([
    c.stage ?? null,
    c.subtype ?? null,
    String(c.hp ?? ''),
    c.pokemonType ?? null,
    c.weakness ?? null,
    c.resistance ?? null,
    c.retreatCost ?? null,
    (c.attacks ?? []).map((a) => [normText(a.name), JSON.stringify(a.cost ?? null), String(a.damage ?? ''), normText(a.effect)]),
    (c.abilities ?? []).map((a) => [normText(a.name), normText(a.effect)]),
  ]);
}

/**
 * 在站上卡（siteCards）裡找與官方卡（off）同名同卡面的一張，回傳其 id（字串）或 null。
 * @param {object} off  parseCard 抓回來的官方卡
 * @param {Iterable<object>} siteCards 站上 live 卡
 */
export function findSameFace(off, siteCards) {
  const name = normName(off?.name);
  if (!name) return null;
  for (const s of siteCards) {
    if (normName(s?.name) !== name) continue;
    if (s.supertype !== off.supertype) continue;
    if (off.supertype !== 'Pokemon') return String(s.id);
    if (pokemonFace(s) === pokemonFace(off)) return String(s.id);
  }
  return null;
}
