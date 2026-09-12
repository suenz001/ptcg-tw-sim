// ── Picker modal 按鈕邏輯（純函式，給 game/+page.svelte 用 + 測試網驗證）──
// v5.424 整體 audit：Wilson 規則 —
//   未知資訊（自己的牌庫 / 對手的手牌）→ 可【不選】；【確定】需 ≥1。
//   已知資訊（棄牌區 / 我方手牌 / 雙方場上）且有 gate → 無【不選】、強制 ≥1。
//   例外：卡面「任意數量 / 若希望 / 任意方式」或被動 on-KO「或跳過」的已知資訊 picker 仍可【不選】，
//        以 effectKey 白名單列舉（見下；來源：static/cards JSON 卡面 audit）。

/**
 * 已知資訊卻「卡面合法允許選 0」的 picker effectKey 白名單。
 *
 * ⚠ v6.125 起，**新卡請改用 `params.allowSkipZero`**（逐卡宣告，見 SkipDecisionInput 註解）。
 *   這份白名單保留給既有的「單卡獨佔 effectKey」，不再擴充 —— 因為 effectKey 粒度
 *   解不了「多張卡共用同一 resolver、但卡面一個可選 0 一個必選」的衝突。
 *   （事故：胖嘟嘟｜深海抽出「若希望」被迫放回 1 張，就是漏加白名單；
 *     長毛狗｜氣味偵測「任意選擇」曾在白名單，v5.881 換 effectKey 時整個掉了。）
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
  // ⭐v6.349 移除 'energy-duster-pick'：能量撢子已收斂到 peekOppPickToDeckBottomPost
  //   （minCount=1 必選，與同措辭的 伊布｜叼去藏 一致）⇒ 沒有任何 withPending 再用這個 key，
  //   留著就是 test-v6125-optional-picker-skip ④ 說的「死條目」（會讓人誤以為那張卡已處理過）。
  //   ⚠ regR('energy-duster-pick') 的**相容別名**仍然保留（舊 pending 不可卡死），
  //     那是 resolver 註冊，與本白名單（UI 的【不選】鈕）無關。
  'heavy-baton-pick-energies',     // 沉重接力棒（on-KO）：任意方式改附
  'alloy-forge-pick',              // 鋁鋼橋龍ex｜合金建造：任意方式附加
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
  /**
   * v6.125：**逐卡**宣告「卡面允許選 0 張」（由 withPending 的 `params.allowSkipZero` 帶進來）。
   *
   * ⚠ 為什麼需要它、而不是繼續加 `OPTIONAL_SELECTION_EFFECT_KEYS`：
   *   白名單的粒度是 **effectKey**，但站內大量 resolver 是**多張卡共用**的中央管線。
   *   例：`v158-energy-chain-start` 同時被
   *     ・艾姆利多｜滿載心田(H)「最多2張，**以任意方式**附於…」→ 卡面可選 0
   *     ・吉利蛋｜幸運貼附(H)「選擇**1張**基本能量卡，附於…」→ 卡面**必選**
   *   共用，整個 key 放進白名單就等於讓吉利蛋可以跳過必付的代價（公平性漏洞）；
   *   不放又讓艾姆利多違反卡面。**effectKey 粒度天生解不了這種衝突。**
   *   `allowSkipZero` 由 withPending 的呼叫端設定 —— 那裡才知道現在是哪一張卡。
   *
   * ⚠ 仍受 `minCount >= 1` 短路保護：卡面要求至少選 N 的效果，設了這個旗標也不會放行。
   */
  allowSkipZero?: boolean;
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
  // v6.125：逐卡宣告的「卡面允許選 0」優先於下面所有分類（解共用 resolver 的衝突，見型別註解）。
  if (p.allowSkipZero === true) return true;
  // v5.543：「看牌庫上方 N 張，強制選擇加手牌」型（已揭示、必選）→ 無【不選】。
  //   ★ 注意「搜尋牌庫找特定卡」型（賽吉/喵頭目 等）依官方「找不到」規則仍可不選，故不列入此名單。
  if (MANDATORY_TOP_PICK_EFFECT_KEYS.has(p.effectKey)) return false;
  return isUnknownInfoPicker(p) || OPTIONAL_SELECTION_EFFECT_KEYS.has(p.effectKey);
}

/**
 * ⭐⭐⭐ v6.175 站長裁定：**「取消整個動作」不是「選 0 張」，不受 minCount 短路管轄。**
 *
 * `attach-tool`（打出寶可夢道具後選要附給誰）早在 v5.465 就把 resolver 的空選擇分支
 * 寫成「道具**退回手牌**」，UI 也備好了「取消（道具退回手牌）」的文案，
 * 但它的 `minCount` 是 1（卡面確實要選 1 隻），於是被 `selectionAllowsSkip` 的
 * `minCount >= 1` 短路擋住 ⇒ **那顆鈕永遠渲染不出來、那條 0-branch 是死碼**。
 * （這正是 audit skill 線索 ②：「實作端已經承諾過的『可跳過』比卡面更硬」。）
 *
 * 語義區分（不可混用，混用等於讓必付的代價可以跳過）：
 *   ・`selectionAllowsSkip`  = 卡面允許「效果選 0 個目標」（效果照樣結算，只是沒選）。
 *   ・`selectionAllowsCancel`= 取消**整個動作**、回到動作前（道具原封退回手牌）。
 * ⇒ 只有「動作本身可以完整還原、不留任何半套狀態」的 picker 才可以列進來。
 */
export const CANCELLABLE_SELECTION_EFFECT_KEYS: ReadonlySet<string> = new Set<string>([
  'attach-tool',   // v6.175：道具退回手牌（regR('attach-tool') 的空選擇分支已完整還原）
]);

/** 這個 picker 是否提供「取消整個動作」的出口。可由 `params.allowCancel` 逐卡宣告。 */
export function selectionAllowsCancel(p: { effectKey: string; allowCancel?: boolean }): boolean {
  return p.allowCancel === true || CANCELLABLE_SELECTION_EFFECT_KEYS.has(p.effectKey);
}

/** 【確定】可點的最低選取數：一律至少 1（全面防呆，未選不可按確定；選 0 走【不選】）。 */
export function selectionConfirmFloor(minCount: number): number {
  return Math.max(1, minCount);
}

/**
 * ⭐⭐⭐ v6.331 `modal-choice` 專用的中央述詞群。
 *
 * `modal-choice` 與其他 picker 有兩個**結構性**差異，站內踩過的洞都源自這兩點：
 *   ① 候選不在 `selectionItems` 裡 —— `game/+page.svelte` 的 `selectionItemsRaw`
 *      的 `switch` **沒有** `modal-choice` 這個 case，所以它對 modal-choice 永遠回 `[]`。
 *      拿 `selectionItems.length` 判斷「有沒有候選」等於恆為 0。
 *   ② payload 是**選項 id 字串**（'keep' / 'yes' / '2' / 能量 iid …）不是場上 iid，
 *      所以 `sanitizeSelectedIids` 把它列在 `VALID_IIDS_GATE_EXEMPT` 裡**原封放行**
 *      —— 送進 resolver 的是完全未消毒的輸入。
 */
export interface ModalChoiceOption {
  id: string;
  text: string;
  disabled?: boolean;
}

/** 這個 modal-choice **形狀合法**的全部選項（含 disabled；字串等壞形狀一律不算）。 */
export function modalChoiceAllOptions(params?: Record<string, unknown> | null): ModalChoiceOption[] {
  const raw = params?.options;
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is ModalChoiceOption =>
    !!o && typeof o === 'object'
    && typeof (o as { id?: unknown }).id === 'string'
    && (o as { id: string }).id !== '');
}

/** 這個 modal-choice 目前有幾個「玩家真的按得下去」的選項（disabled 的不算）。 */
export function modalChoiceEnabledOptions(params?: Record<string, unknown> | null): ModalChoiceOption[] {
  return modalChoiceAllOptions(params).filter((o) => o.disabled !== true);
}

/**
 * modal-choice 的「候選數」。stepper 型一律算 1（數字面板永遠送得出一個合法值）。
 * ⚠ 這是 `selectionHasNoExit` 對 modal-choice 的正確輸入 —— 見上面的差異①。
 */
export function modalChoiceCandidateCount(params?: Record<string, unknown> | null): number {
  if (params?.stepper) return 1;
  return modalChoiceEnabledOptions(params).length;
}

/**
 * ⭐⭐⭐ 這一次送進來的 payload 是「玩家真的做了一個選擇」嗎？
 *
 * 回 `false` 時引擎必須**不執行 resolver、不關 pending** —— 否則就是玩家回報的症狀：
 * **卡片已經消耗掉了，盤面卻什麼都沒發生。**
 * （38 個 modal-choice resolver 對空 choice 的寫法是散的：有的 `if (!choice) return st;`
 *   直接吞掉；有的 `parseInt(iids[0] ?? '0')` **靜默幫玩家選了第一個選項**；
 *   有的 `choice !== 'yes'` 當成拒絕。逐個修＝下一張新卡又會漏，所以收斂到這裡。）
 *
 * ⚠⚠ 沒有任何可選項時**必須回 true**：那時空 payload 是玩家唯一的出口（UI 的放棄鈕），
 *    擋下去就從「卡片白費」變成「畫面鎖死」，是更嚴重的回歸。
 */
export function modalChoicePayloadValid(
  params: Record<string, unknown> | null | undefined,
  iids: readonly unknown[] | null | undefined,
): boolean {
  const first = Array.isArray(iids) ? iids[0] : undefined;
  const stepper = params?.stepper as { min?: number; max?: number } | undefined;
  if (stepper) {
    const n = Number(first);
    if (typeof first !== 'string' && typeof first !== 'number') return false;
    if (!Number.isFinite(n)) return false;
    if (typeof stepper.min === 'number' && n < stepper.min) return false;
    if (typeof stepper.max === 'number' && n > stepper.max) return false;
    return true;
  }
  // ⚠ 兩種「零可用選項」都必須放行，但理由不同，不可合併成一個判斷：
  //   ・完全沒有選項（options 缺漏／空／形狀壞掉）⇒ 空 payload 是玩家唯一的出口。
  //   ・有選項但**全部 disabled** ⇒ 玩家一顆也按不下去，同樣需要出口。
  //   ⇒ 但只要還有一個 enabled 的選項，disabled 的那些就**不可以**被送進來。
  //   ⚠⚠ 一定要呼叫**中央** `modalChoiceEnabledOptions`，不可以就地再寫一次
  //   `filter(o => o.disabled !== true)` —— 抄第二遍等於「判準有兩份」：
  //   對抗性審查實測，把中央那份的 disabled 過濾拿掉，守衛全部照樣綠（突變存活）。
  const all = modalChoiceAllOptions(params);
  if (all.length === 0) return true;
  const enabled = modalChoiceEnabledOptions(params);
  if (enabled.length === 0) return true;
  return typeof first === 'string' && enabled.some((o) => o.id === first);
}

/**
 * ⭐ v6.331 本機 AI「連續無進展」保險絲要送出的 payload。
 *
 * 那條保險絲（`game/+page.svelte` 的 no-progress guard）原本無條件送 `[]`。
 * 加了上面的中央閘之後，`[]` 對「還有選項的 modal-choice」會被退回，
 * 保險絲就得白繞 `RESOLVE_REJECT_STREAK_MAX` 拍才推得動。
 * ⇒ 直接送**第一個可用選項**，一拍就有進展，且與 `ai.ts` 的預設選法（第一個非 disabled）一致。
 */
export function aiStuckSelectionPayload(pending: { type: string; params?: Record<string, unknown> | null }): string[] {
  if (pending.type !== 'modal-choice') return [];
  const stepper = pending.params?.stepper as { init?: number; min?: number } | undefined;
  if (stepper) return [String(stepper.init ?? stepper.min ?? 0)];
  const opts = modalChoiceEnabledOptions(pending.params);
  return opts.length > 0 ? [opts[0].id] : [];
}

/**
 * ⭐⭐⭐ v6.174 中央安全網述詞：這個 picker 現在**完全沒有出口**嗎？
 *
 * 「沒有出口」＝ 候選清單是空的（玩家一個都勾不到）、卡面又要求至少選 1，
 * 而 `selectionAllowsSkip` 也不給【不選】鈕 ⇒ 玩家所有按鈕都是 disabled ⇒ **對局卡死**。
 * 這種情況代表發動端的 gate 有洞（gate 都做對的話這顆按鈕永遠不該出現），
 * 但在 gate 補好之前，玩家不能被鎖在畫面上。
 *
 * ⚠ v6.174 修的洞：原本這段判斷寫在 game/+page.svelte 的 `pendingStuckEmpty`，
 *   而且**明文排除 damage-distribute / energy-distribute**（理由是「它們用 counts 不用 picked」）。
 *   但那兩型同樣是「候選為空 → 確認鈕永遠 disabled」，排除掉等於**那兩型真的沒有任何逃生口**。
 *   分配型的候選為空一樣要給放棄鈕；改成純函式後由 test-selection-ui 直接覆蓋。
 *
 * @param candidateCount picker 目前實際渲染出的候選數量（UI 的 selectionItems.length）。
 *   ⚠ v6.331：`modal-choice` 的候選**不在** selectionItems 裡（見 modalChoiceCandidateCount 註解），
 *   所以這裡對它一律改用 `params.options` 重算 —— 由述詞自己接管，呼叫端傳什麼都不會接錯線。
 */
export function selectionHasNoExit(
  p: SkipDecisionInput & { minCount?: number; allowCancel?: boolean; params?: Record<string, unknown> | null },
  candidateCount: number,
): boolean {
  const n = p.type === 'modal-choice' ? modalChoiceCandidateCount(p.params) : candidateCount;
  if (n > 0) return false;
  if ((p.minCount ?? 0) <= 0) return false;
  // 已經有【不選】鈕的 picker 本來就有出口
  if (selectionAllowsSkip(p)) return false;
  // v6.175：有【取消】鈕（道具退回手牌）也算有出口，不必再多長一顆「放棄」
  if (selectionAllowsCancel(p)) return false;
  return true;
}
