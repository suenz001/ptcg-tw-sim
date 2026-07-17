// ── Picker modal 按鈕邏輯（純函式，給 game/+page.svelte 用 + 測試網驗證）──
// v5.424 整體 audit：Wilson 規則 —
//   未知資訊（自己的牌庫 / 對手的手牌）→ 可【不選】；【確定】需 ≥1。
//   已知資訊（棄牌區 / 我方手牌 / 雙方場上）且有 gate → 無【不選】、強制 ≥1。
//   例外：卡面「任意數量 / 若希望 / 任意方式」或被動 on-KO「或跳過」的已知資訊 picker 仍可【不選】，
//        以 effectKey 白名單列舉（見下；來源：static/cards JSON 卡面 audit）。

/**
 * 已知資訊卻「卡面合法允許選 0」的 picker effectKey 白名單。
 * 依據：static/cards/*.json 卡面含「任意數量 / 若希望 / 任意方式」或被動 on-KO「或跳過」。
 * 維護：新增同類卡時把其 withPending 的 effectKey 加進來即可（單一維護點，免改各 withPending）。
 */
export const OPTIONAL_SELECTION_EFFECT_KEYS: ReadonlySet<string> = new Set<string>([
  'rush-switch-energy-transfer',   // 急進開關：任意數量能量改附
  'pirou-discard-then-draw',       // 琵魯：若希望任意數量丟手牌
  'm5-slowpoke-discard-all',       // 呆呆獸｜丟到飽：任意數量丟手牌
  'swiftcursor-energy-pick',       // 鐵斑葉ex｜迅速游標：任意數量能量改附
  'v327-unfezant-reverse-wind',    // 高傲雉雞｜反轉之風：若希望
  'v327-tauros-thrust',            // 帕底亞 肯泰羅｜上搗角擊：若希望
  'v327-slowking-flush',           // 呆呆王｜付諸東流：若希望
  'v327-octopus-water-clean',      // 章魚桶｜水流清洗：若希望
  'self-swap-active-bench',        // 狡兔三窟 等自身換場（共用 resolver）：若希望互換
  'lucky-gift-self',               // 信使鳥｜幸福禮物（自方階段）：若希望
  'lucky-gift-opp',                // 信使鳥｜幸福禮物（對手階段）：若希望
  'flame-dance-pick-fire',         // 烈焰猴｜火焰蹈舞：最多各1、任意方式
  'flame-dance-pick-fight',        // 烈焰猴｜火焰蹈舞（鬥側）
  'lillie-ribombee-invite-place',  // 莉莉艾的蝶結萌虻：查看對手手牌任意數量（亦屬未知資訊）
  'loquat-discard-opp-items',      // 枇琶：查看對手手牌（未知資訊）
  'energy-duster-pick',            // 能量撢子：查看對手手牌（未知資訊）
  'heavy-baton-pick-energies',     // 沉重接力棒（on-KO）：任意方式改附
  'alloy-forge-pick',              // 鋁鋼橋龍ex｜合金建造：任意方式附加
  'wave17-pickup-energy-to-hand',  // 長毛狗｜氣味偵測：擲幣後任意選擇（含 0）
  'cleansing-support-pick-bench',  // 拉帝歐斯｜潔淨支援：任意數量能量改附
  'pulse-thrust-energies-picked',  // 超級路卡利歐ex｜波動突刺：自選填能（可不選）
  'ursaluna-bm-attach',            // 月月熊 赫月｜經驗法則：自選附能（可不附）
  'm5-mirieton-photon-code',       // 密勒頓｜光子纜線（on-KO）：或跳過
  'lycanroc-spike-bind-attach',    // 鬃岩狼人｜尖刺纏身：自選附能（可不附）
  'attach-tool',                   // v5.465：附加寶可夢道具選目標 → 可取消（道具退回手牌）
  'brailliant-attach',         // v5.733：力之沙漏（PokemonTool）回合結束「可」從棄牌區附基本能量 → 可不選
  'sakura-crescendo-attach',       // v5.465：櫻花魚｜漸強波 從手牌附水能量 → 可不選（也可不附）
]);

/**
 * v5.543：「查看牌庫上方 N 張，強制選擇 K 張加入手牌」型 picker 的 effectKey 白名單。
 * 這類是【已揭示、必選】（非搜尋），不可【不選】。
 * ⚠ 與「搜尋牌庫找特定卡」不同——後者依官方規則一律可「找不到」而跳過（即使牌庫有），
 *   故 賽吉/喵頭目/v2996 等搜尋型(filter 分類)、暗碼迷的解讀(搜尋整副排序)都【不】列入此名單。
 * 維護：新增同類「看牌庫上方 N 張必選加手牌」卡時把其 effectKey 加進來即可（單一維護點）。
 */
export const MANDATORY_TOP_PICK_EFFECT_KEYS: ReadonlySet<string> = new Set<string>([
  'scouting-order',  // 多龍奇｜偵查指令：查看上方2張，選1張加手牌
  'explorer-guide',  // 探險家的嚮導：查看頂6張，強制選2張加手牌
  'shinli-pick',     // 辛俐：查看上方4張，強制選2張加手牌
  // v5.964:移除 'n-plot-energy-move'(v5.663 誤加)——它是 active-energy-discard 型(非「看牌庫上方N張」型),
  //   且 selectionAllowsSkip 對已知資訊 picker 本就回 false → entry 為 no-op 死碼;N的謀劃「最多2個」依
  //   Wilson 已知資訊規則維持強制至少選1(regG 已保證有候選)。
]);

export interface SkipDecisionInput {
  type: string;
  actorIdx: 0 | 1;
  sourcePlayerIdx: 0 | 1;
  effectKey: string;
  minCount?: number;  // v5.607：卡面要求的最低選取數（權威信號）
}

/** 未知資訊 picker：自己的牌庫（牌庫搜尋 / 牌庫頂排序）或對手的手牌（hand-* 且來源為對手）。 */
export function isUnknownInfoPicker(p: SkipDecisionInput): boolean {
  if (p.type === 'deck-search' || p.type === 'reorder-deck-top') return true;
  if ((p.type === 'hand-discard' || p.type === 'hand-choose') && p.sourcePlayerIdx !== p.actorIdx) return true;
  return false;
}

/**
 * 是否顯示【不選】(可略過)。
 * = 未知資訊 OR 卡面明訂可選 0（白名單 effectKey）。
 * 否則（已知資訊 + 有 gate：棄牌區檢索 / 我方手牌固定取 / 場上目標）→ 不顯示【不選】、強制 ≥1。
 */
export function selectionAllowsSkip(p: SkipDecisionInput): boolean {
  // v5.607：minCount>=1 = 卡面要求「至少選 N(N>=1)」→ 一律不給【不選】(minCount 是卡面語意權威)。
  //   修玩家報「啪咚猴|衝衝鼓」：卡面「從牌庫任意選擇 1 張卡加入手牌」=無類別限定的任意檢索，
  //   牌庫非空一定找得到「任意 1 張」→ 不適用官方「找不到」(fail-to-find)，必選。
  //   fail-to-find 只在「搜尋符合特定條件的卡」(minCount=0)時適用；「任意檢索」沒有找不到的情形。
  //   通則：任何 picker 只要 minCount>=1 就不該能跳過(送 0)，這是純語意防呆，零誤傷
  //   (「最多 N/任意數量/可不選」型卡面 minCount 本就=0 → 不受影響)。
  if ((p.minCount ?? 0) >= 1) return false;
  // v5.543：「看牌庫上方 N 張，強制選擇加手牌」型（已揭示、必選）→ 無【不選】。
  //   ★ 注意「搜尋牌庫找特定卡」型（賽吉/喵頭目 等）依官方「找不到」規則仍可不選，故不列入此名單。
  if (MANDATORY_TOP_PICK_EFFECT_KEYS.has(p.effectKey)) return false;
  return isUnknownInfoPicker(p) || OPTIONAL_SELECTION_EFFECT_KEYS.has(p.effectKey);
}

/** 【確定】可點的最低選取數：一律至少 1（全面防呆，未選不可按確定；選 0 走【不選】）。 */
export function selectionConfirmFloor(minCount: number): number {
  return Math.max(1, minCount);
}
