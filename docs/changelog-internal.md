# 更新記錄（內部詳細版）

> ⚠ **這份不是給玩家看的**，玩家看的是首頁的精簡版（`static/changelog.html`，只講「你會看到什麼變化」）。
> 這裡保留完整的來龍去脈：根因、卡面查證、機制名稱、伺服器/部署細節、守衛設計。
> 供 Claude 與 Wilson 日後查閱；**不會被打包進網站、玩家看不到、也不佔進站載入量**。
>
> 寫作規則：每出一版，先在這裡寫詳細版，再把「玩家需要知道的那一兩句」放進首頁 changelog。
>
> ⭐ **首頁 changelog 三條硬規範（v6.121 站長交辦，已由 `test-changelog-size-and-archive` 鎖住）**：
> 1. **公告語氣，不得用第二人稱**（你／妳／您）。它是給所有玩家看的改版說明，
>    不是對站長一個人的報告。✗「會連問你兩次能量」 ✓「會連續要求選兩次能量」。
> 2. **與遊戲／網站內容無關、或玩家不需要知道的，整則都不要放上首頁** ——
>    純伺服器內部調整（降載、索引、查詢最佳化）、更新記錄自己的寫法、部署流程，
>    一律只寫在這份內部檔。判準：「玩家看了之後，有任何要做的事或感受得到的規則差異嗎？」
> 3. 每則 40~80 字「一句話＋必要提醒」，細節寫這裡。
> 更早的紀錄（v6.043 以前）在 `static/changelog-archive.html`（那份是公開的完整歷史）。

（本檔由 v6.106 從當時的首頁 changelog 完整搬移建立，日期 2026-08-02）

## v6.125 — 卡面「若希望／任意數量」的 picker 真的能選 0 張（逐卡宣告取代 effectKey 白名單）

玩家回報：**胖嘟嘟｜深海抽出(J)**「從自己的牌庫抽出1張卡。然後，**若希望**，選擇1張自己的
手牌，放回牌庫下方。」—— 實際上被**強制**放回 1 張。

### 根因不在引擎
引擎的 `minCount: 0` 本來就是對的。缺的是 UI 的【不選】鈕：
`selectionAllowsSkip()` 的站規是「已知資訊（棄牌區／我方手牌／場上）預設不給【不選】」，
只有 effectKey 在 `OPTIONAL_SELECTION_EFFECT_KEYS` 白名單才放行 —— 胖嘟嘟的 key 漏加。
沒有【不選】鈕 + 確定鈕下限是 `max(1, minCount)` = 1 ⇒ 玩家出不去，只能放 1 張。

### ⚠⚠ 為什麼不是「再加一個白名單條目」就好（本版的真正主題）
白名單的粒度是 **effectKey**，但站內大量 resolver 是**多張卡共用**的中央管線：

| 共用 effectKey | 卡面可選 0 的 | 卡面必選的 |
|---|---|---|
| `discard-to-hand` | 長毛狗｜氣味偵測「**任意選擇**」 | 奇跡耳麥／釣竿MAX／水蓮的照顧／能量回收「最多N張」 |
| `v158-energy-chain-start` | 艾姆利多｜滿載心田／阿羅拉 椰蛋樹ex｜熱帶狂燒／莫魯貝可｜撿拾附上 | **吉利蛋｜幸運貼附「選擇1張」** |
| `h-wave2-pickup-energy-to-bench-stage1` | 鬃岩狼人｜渦輪刀鋒／帕奇利茲｜啪滋啪滋充電／圖圖犬｜能量寫生 | 花舞鳥｜能量支援「附於1隻」 |

整個 key 放進白名單 ＝ 讓吉利蛋可以**跳過必付的附能代價**（公平性漏洞）；不放又違反卡面。
⇒ 新增 `pendingSelection.params.allowSkipZero`，由 **withPending 的呼叫端**逐卡宣告
（那裡才知道現在是哪一張卡）。三個共用 factory 加上必填的 `optional` 參數往下傳。
⚠ 仍受 `minCount >= 1` 短路保護 —— 卡面要求至少選 N 的效果設了旗標也不會放行。

### 修掉的（卡面逐字有「若希望／任意數量／以任意方式／任意選擇」）
胖嘟嘟｜深海抽出(J)、長毛狗｜氣味偵測(I)、鴨嘴炎獸｜拍檔提升(J)、咚咚鼠｜擺尾發電(J)、
優雅貓｜能量攪拌(H)、胡地｜奇異駭入(H)、塗標客｜惡作劇作畫(H)、鬃岩狼人｜渦輪刀鋒(H)、
帕奇利茲｜啪滋啪滋充電(H)、圖圖犬｜能量寫生(I)、艾姆利多｜滿載心田(H)、
阿羅拉 椰蛋樹ex｜熱帶狂燒(H)、莫魯貝可｜撿拾附上(H)。

### 反向修（把正確行為建立在正確機制上）
**吉利蛋｜幸運貼附(H)**「從自己的手牌選擇**1張**基本能量卡」是必選，程式卻給 `minCount: 0`
—— 目前行為正確純粹是因為「它不在白名單」，是脆弱的巧合。改成 `minCount: 1`，
由 `selectionAllowsSkip` 的第一道短路正面擋住。

### ⚠ 同型回歸（v5.881 埋的）
長毛狗｜氣味偵測原本**在**白名單（key `wave17-pickup-energy-to-hand`），
v5.881 把它改掛中央 `discard-to-hand` 之後，白名單那條就變成死碼，【不選】鈕無聲消失，
跟胖嘟嘟一模一樣被迫至少選 1。→ 死條目已清（另清 `cleansing-support-pick-bench`，
v5.907 收斂時遺留），並加守衛「白名單不得有零 producer 的死條目」。

### 守衛 `scripts/test-v6125-optional-picker-skip.mjs`（9 項，HEAD FAIL 8）
① 行為端：胖嘟嘟／長毛狗／優雅貓／胡地 跑真流程後 `selectionAllowsSkip()` 必須回 true
② 反向：吉利蛋必選；**同 key 的艾姆利多仍可選 0** —— 證明分流有效
③ **枚舉守衛（一勞永逸）**：任何 `minCount` 可為 0 的 pendingSelection 都必須「顯式表態」
   （allowSkipZero／未知資訊 type／legacy 白名單／具名豁免清單四選一），新卡漏表態就 CI 紅
④ 白名單衛生：不得再有死條目

⚠⚠ **掃描器的兩個盲點**（第一版守衛因此假綠，修掉後多抓到 6 個）：
  ・`withPending(addLog(st, \`…${x}…\`, i), {…})` —— template literal 的 `${` 讓
    「往後找第一個 `{`」抓進字串內部，括號配對整個錯位（光子纜線就是這樣被漏掉）
  ・engine.ts 有直接寫 `return { …, pendingSelection: { … } }`，根本沒有 withPending（力之沙漏）
  ⇒ 改以 `effectKey: '…'` 為錨點**往回**配對出物件開頭。
  **教訓：掃描器本身要先被驗證會不會漏，否則枚舉守衛只是安慰劑。**

### 站長裁定（2026-08-07）
「已知資訊 + 卡面純『最多N張』（**沒有**任意數量／若希望／任意方式）可不可以選 0？」
→ **站長要逐張複核**，本版維持現狀（必選 ≥1），涉及 20 張卡。
既有先例支持維持現狀：v5.964 N的謀劃「最多2個」裁定強制 ≥1、豐收漁網註解「發動後必選」、
`selection-ui.ts` 檔頭例外清單只列「任意數量／若希望／任意方式」。
官方規則檔（PTCG_RULES.md）只有「從**牌庫**選擇可以1張都不選」的 fail-to-find 裁定，
查不到棄牌區／手牌的對應裁定 —— 所以這是站規問題，不是官方規則問題。

### ⚠ Fable 5 審查的兩處我判定它錯了（未採納）
它把 **雙卵細胞球｜細胞進化(I)**（卡面「選擇1張」）與 **火箭隊的尼多娜｜惡之覺醒(I)**
（卡面「選擇最多2隻」）判為「可選 0」，理據是「後段的牌庫搜尋可 fail-to-find」。
但那是**間接推論**，兩張卡面逐字都沒有「若希望／任意數量／任意方式／任意選擇」，
且 phase A 選的是**場上的底座寶可夢**（已知資訊），與牌庫 fail-to-find 是不同的選擇點。
依「寧可保守」維持必選，並列入待站長複核的那 20 張。

### 順帶查出的死碼
`discardSearchAttachToAnyPost`、`discardSearchBasicEnergiesPost` 兩個 factory 全 repo 零呼叫者
（v3.09/v3.10 改成「附於備戰」之後就沒人用了），已在原處標註。

## v6.124 — 「重洗放回牌庫下方」的重洗範圍收斂成中央管線

站長交辦（延續 v6.123）：「請確認，並做整體的 audit 確認有沒有類似的問題或是類似的解決方法
（我們只處理 HIJ 標，G 標不在標準賽範圍，不用處理）。請盡量用一勞永逸的收斂式、中央管線的方式來作修正。」

### 維度定義
卡面「（將那些卡翻回反面並重洗，）放回牌庫**下方**」——**重洗的主詞是「那些卡」**
（剛查看過的 N 張／剛收回的手牌／獎賞），所以只有那幾張要被打亂，
**牌庫其餘部分的順序必須原封不動**。

⚠ 極易混淆的對照組：卡面寫「放回牌庫**並重洗**」（**沒有**「下方」）＝洗整副，是**另一條規則**。
差別只有「下方」兩個字。live HIJ 中屬於對照組的有 杜若(H)、女服務生(J)、滑稽演員(I)，
它們保留 `shuffle(整副)` 是正確的，本版**沒有動**。

### 這是重複發生第 3 次的 bug 型
| 版本 | 卡 | 錯法 |
|---|---|---|
| v4.08 | 特殊紅牌 | 誤用 `returnHandToDeck`（hand+deck 一起洗） |
| v6.123 | 推理組合 | `shuffle(rest)` —— 洗錯邊，把**沒看到**的部分洗掉 |
| v6.124 | 越橘的一步棋(I)×3、悟松(H) | `shuffle([...rest, ...toBottom])` —— 整副洗掉 |

⇒ 這一版收斂成單一中央管線，杜絕第 4 次。

### 中央管線（`src/lib/game/effects/_shared.ts`）
```ts
export function deckWithCardsToBottom<T>(
  rest: readonly T[], toBottom: readonly T[], mode: 'shuffled' | 'keep-order',
): T[]
```
`mode` **刻意設成必填**，強迫呼叫端回去讀卡面：有「重洗」字樣 → `'shuffled'`；
只說「放回牌庫下方」→ `'keep-order'`。

### 修掉的真 bug
- **越橘的一步棋(I)** 3 處（未選擇 / 選到非【惡】而效果終止 / 成功放備戰）都寫成
  `shuffle([...rest, ...remaining])` → 整副牌庫被洗。log 也一併從「剩餘洗回牌庫」改成「⋯牌庫下方」。
- **悟松(H)** `p.deck = shuffle([...p.deck, ...p.hand])` → 雙方整副牌庫都被洗。
  ⚠ 同檔的 **滑稽演員(I)** 寫法幾乎一樣但**卡面是「放回牌庫並重洗」**，屬對照組，不得改。
- **海岱(H)**（Fable 5 審查補抓）卡面是「**以任意順序排列**，放回牌庫下方」，
  原本用 `p.hand.filter(...)` ＝手牌原順序，玩家點選的順序被丟棄。改成依 picker 送出的 iids 順序。
  牌庫底順序在本站**是可觀察的**（蟲甲聖ex｜相反抽出從下方抽 3、蟲蟲恐慌×4、黑暗球），所以有實質差異。

### 一併收斂（原本行為正確，只是各寫各的 → 防日後漂移）
金屬怪｜金屬製造者(H)、超級烈空坐ex｜霸者咆哮(J)、多龍奇｜偵查指令(H, keep-order)、
特殊紅牌(J)、妨害信函(H)、調換票(I)、彩粉蝶｜大飛翅(J)、推理組合(H) 兩分支、
N的扒手貓｜暗槓(I, keep-order)、能量撢子(J, keep-order)。共 15 個消費點。

### 守衛 `scripts/test-v6124-deck-bottom-shuffle-scope.mjs`（19 項，HEAD 跑 FAIL 7）
1. 中央 helper 單元（`'shuffled'` 只洗 toBottom、`'keep-order'` 完全不洗）
2. **行為端**逐卡驗「牌庫其餘部分順序逐張不變」12 張
3. **卡面枚舉守衛**：掃 live HIJ 卡面含「放回牌庫下方」者必須在 VERIFIED 清單
4. **反向對照**：杜若／女服務生／滑稽演員不得被誤收（收進來會反過來把正確實作改壞）
5. 正對照：把舊寫法餵給同一判準必須被抓到

⚠⚠ **Fable 5 審查抓到的守衛漏洞（已修）**：措辭變體「放回**對手的**牌庫下方」
（N的扒手貓｜暗槓、能量撢子）不符原本的 regex `/放回牌庫(最)?下方/`，那兩張整整逃過列管。
regex 已改成 `/放回(對手的)?牌庫(最)?下方/`。
**教訓：枚舉守衛的 regex 也要當成「會漏」的東西去驗，別假設卡面措辭只有一種寫法。**

### 順帶
- `test-v6123-inference-look-before-choose.mjs` 原本拿 **G 標的蕾荷**當「不得波及其他卡」的對照組。
  站長裁定只維護 H/I/J → 改用 哥德小童｜天眼(I)、火箭隊的天罩蟲｜攪亂雷達(I)，
  另一條 `allowDiscard:true` 契約改成**直接構造 params**，完全不綁任何一張卡（也不會因卡池變動腐爛）。
- v6.123 的守衛**上一版忘了加進 `npm test` chain**，本版一併補上（445 步）。

### 同維度已確認乾淨（不必改）
「查看 → **若希望** → 二元決定」6 張：好啦魷｜惡作劇觸手(H)、岩狗狗｜挖回(I)、
燭光靈｜光照燃燒(I)、莫魯貝可｜搜尋點心(H)、魔牆人偶｜相仿秀(H)、火箭隊的妨礙機器人(I)
—— 全部都是先揭示（選項文字甚至帶卡名）再問，決策時序正確。

### 🔨 待站長裁定（本版**未**動）
**火箭隊的妨礙機器人(I)** 卡面是「**選擇**1張對手的反面朝上的獎賞卡，並在不看正面的情況下，
從對手的手牌**選擇**1張」，現行實作用 `Math.random()` **隨機**抽兩個位置，玩家不能選。
雖是「盲選」（看不到正面），但**位置**本身在本站是有資訊的（獎賞被翻過正面、對手剛抽了什麼）。
依「絕不簡化卡效果」的原則這應該改成玩家點選，但涉及獎賞格與對手手牌背面的兩段 picker，
風險與範圍都超出本版，先列出來等裁定。

## v6.123 — 【推理組合】決策點搬到「看完 3 張之後」＋ 修重洗範圍過大

站長：「道具卡【推理組合】的做法錯了 —— 應該是要讓玩家**看完 3 張以後**，才決定要排順序或是
放回牌庫下方。建議在排序畫面上，除了確定按鈕以外，旁邊增加一個【重洗放回牌庫下方】按鈕。」

### 卡面（static/cards MC 17116 / SV8 11274，H 標）
「查看自己的牌庫上方3張卡，以任意順序排列，放回牌庫上方。
　**或者**將那些卡全部翻回反面並重洗，放回牌庫下方。」
⇒ 先「查看」，看完才二選一。站長的判讀正確。

### 舊實作錯在哪
v2.164 是先開 `modal-choice` 問「①排序 ②洗回底」，**此時 3 張還沒攤開給玩家看**
（`topCards` 只活在 resolver 的閉包裡）—— 等於逼玩家盲猜，卡面給的資訊完全沒用上。

### 改法
- `reg('推理組合')` 直接開 `reorder-deck-top`（3 張攤開），
  params 新增 `altAction: { id, label, logText }` ＝ 卡面「或者」那一半。
- 共用 resolver `reorder-deck-top-apply` 加一條分支：`params.altAction && iids[0] === altAction.id`。
  ⚠ **必須擺在 candidateSet 過濾之前** —— altAction.id 不是 iid，會被濾掉。
- UI：reorder 的 footer 在 `params.altAction` 存在時多渲染一顆次要按鈕。
- ⭐ **通則：卡面的「查看」在前、「或者」在後 ⇒ 選擇 UI 必須在揭露之後。**

### ⚠⚠ 一併修掉的既有 bug（Fable 5 抓到，我複驗屬實）
舊的洗回底分支寫 `deck: [...shuffle(rest), ...shuffle(topCards)]` ——
卡面只說「將**那些卡**（3 張）翻回反面並重洗」，**牌庫其餘部分不該被重洗**。
`shuffle(rest)` 會把玩家已知的牌庫順序整個摧毀（例：上一次推理組合／蕾荷排好的頂部）。
新分支＝`[...rest, ...shuffle(top)]`；舊 resolver 那份也一併修。

### Fable 5 審查的四個結論（我逐條複驗）
1. **哨兵不會被中央 sanitize 閘吃掉** —— `engine.ts` 的 `sanitizeSelectedIids`
   只對 `t === 'deck-search'` 消毒，其餘 `else return iids;` 原封放行（註解也明寫
   reorder-deck-top 原封放行）。✅ 屬實。
2. **既有的「不選（跳過）」路徑不能重用** —— `selection-ui.ts` 的 `selectionAllowsSkip`
   在 `minCount>=1` 一律回 false，而推理組合是 `minCount=maxCount=3`；
   而且送 `[]` 的語義是「原順序放回頂」，跟「洗回底」是兩件事。✅ 屬實。
3. **AI 零回歸** —— `ai.ts` 的 `reorder-deck-top` case 回「全部候選、原順序」，
   而改版前 AI 走 modal-choice 是「選第一個非 disabled 選項」＝排序。兩者**逐 bit 相同**。
   已在 ai.ts 補註解說明 AI 刻意不採用 altAction。
4. **舊 resolver 要保留** —— 舊 client 在該 pending 掛著時重整換版，房間 state 會殘留
   `inference-combination-choice`；沒有 resolver 的話 engine 會直接清 pending、效果靜默蒸發。
   保留即可消除。⚠ lint 的 Check N 只抓「effectKey 沒有 resolver」，**不抓孤兒 resolver**，
   保留不會紅燈。

### ⚠ 我自己踩到的測試坑
正對照第一版寫「拿蕾荷送哨兵字串 → 牌庫順序不變」，**紅了**。
因為蕾荷是 `allowDiscard: true`（卡面「選任意數量丟棄」，minCount=0），
送任何非候選字串＝「一張都不留」→ 全部進棄牌，那是它**正常的**語義。
正確的正對照＝拿推理組合的 params **刪掉 altAction** 再送同一個哨兵 → 分支不得進入。
⭐ **通則：寫 fail-closed 正對照時，對照組必須只差「那個旗標」，其餘條件要完全相同。**

### 同型卡掃描
用「揭露動詞（查看/翻開/抽出/展示）× 分歧連接（或者/或將/，或/也可以/可以改為）」
掃全部 H/I/J 卡的 rulesText＋attacks＋abilities：**唯一命中就是推理組合**。
「先看後二選一」目前是孤例，altAction 不急著一般化，但寫成 params 驅動等於免費預留。

### 驗證
守衛 `test-v6123-inference-look-before-choose.mjs`（11 項，HEAD 9 FAIL）；
完整 npm test **443** 綠；svelte compile 警告數與 HEAD 相同（98）；tsc 無新錯。

### ⚠ 部署
動到引擎（effects.ts）⇒ **三支 bat 都要跑**（`update-tournament.bat` 一定要，
它會重建錦標賽的 server-engine，否則兩站行為會分岔）。

## v6.122 — 補位（派出新的戰鬥寶可夢）改「選取 → 確定」兩段式

玩家回報：「戰鬥寶可夢昏厥或需要替換時，選擇備戰寶可夢上場，現在只要點選就立即上場，
希望增加確定的按鈕避免按錯。」

### ⚠⚠ 這個流程搞砸的後果很嚴重
補位卡住 = 玩家無法行動 → 錦標賽會被**閒置判負**。所以每一項改動都以「不能讓玩家按不到
確定鈕」為第一原則，並請 Fable 5 先審過（它抓到三個我漏掉的點，見下）。

### 現況勘查
補位 UI 只有兩個 modal，都在 `src/routes/game/+page.svelte`：
- **A 防守方版**：`defenderPlayer?.active===null && isMyDefenderTurn() && !pendingSelection`
- **B 自 KO 版**：`myPlayer?.active===null && (myPlayer?.bench??[]).length>0 && !pendingSelection`

⭐ **手機直式（MobilePortraitBattle）沒有自己的補位 UI** —— 它只顯示「請從備戰區派出新的
戰鬥寶可夢（下方視窗選擇）」，實際用的就是上面兩個 modal（它們刻意放在
`{#if isPortraitMobile}` 區塊**之外**）。所以改這兩個 modal＝桌機手機一起改到。

### 改法
1. 卡片點擊改成**選取／取消選取**（`sel-picked` + ✓），不再直接 dispatch。
2. 兩個 modal 各加 `sel-footer` 確定鈕，未選時 `disabled` 並顯示「請先點選要上場的寶可夢」，
   選了顯示「✅ 確定讓「〇〇」上場」。
3. 卡片格子收斂成單一 `{#snippet promoteGrid(...)}`，兩處 `@render`（原本各抄一份會漂移）。
4. **`confirmSendNewActive()` 是全檔唯一送出 SEND_NEW_ACTIVE 的地方**，送出前 re-validate。

### Fable 5 抓到、我複驗屬實的三點
1. ⭐⭐ **兩個 modal 的 pick state 不可共用**。一般情況 A、B 列的是同一份備戰區，但
   **本機雙人「雙方同時自傷 KO」**時 A 列防守方、B 列攻方 —— 是兩份不同的清單疊在一起，
   共用一份 state 會跨清單汙染。⇒ 改成 `promotePickDef` / `promotePickSelf` 兩個獨立 state。
2. ⭐⭐ **不要用 `$effect` 主動清 state**（loop／時序風險）。改用 derived 的
   `_pickOk`（pick 存在且仍在該 bench）控制 disabled，dispatch 前再驗一次、成功後才清。
   線上盤面被對手動作 merge 掉時，確定鈕自動變灰、玩家重選即可，不會卡死。
3. ⭐ **兩個 modal 原本都沒有 `!isSpectator`**（既有 bug）：觀戰／回放停在 active=null 的
   半回合快照時，會蓋一個點不動也關不掉的 modal。dispatch 本來就擋觀戰者，補 gate 零風險。

⚠ 另外 Fable 提醒的判負風險：兩段式下「點選」不產生 server action，玩家選了忘記按確定，
閒置計時照跑。緩解＝確定鈕顯眼、hint 文案改成「先點選…再按下方的『確定上場』」、
手機版把 footer 釘住（見下）。

### 手機版 CSS
手機直式把**整個 modal**當捲動容器（v5.299 拿掉 `.retreat-grid` 內層捲動、v5.308 給
`.selection-modal` 加 `overflow-y:auto`），備戰滿場時 footer 會落在折疊線下面要捲才看得到。
⇒ 只在 `.retreat-modal .sel-footer` 加 `position:sticky; bottom:0`（不碰其他 25 個
`sel-footer` 消費者）。

### 驗證
svelte compile OK 且**警告數與 HEAD 相同（98）**；完整 npm test **442** 綠；
守衛 `test-v6122-promote-confirm.mjs`（11 項，HEAD 9 FAIL）。
守衛含正對照（把舊的「卡片直接 dispatch」寫法餵進同一判準必須被抓到）、
以及反向護欄（`MobilePortraitBattle.svelte` 不得出現 `sendNewActive`，防未來有人在手機
分支另做一份直送 UI）。

⚠ 沙盒教訓：mount 的 `node_modules` 是 Windows 版 esbuild，Linux 跑不了。
不必整包 `npm ci` —— 抓一份 `@esbuild/linux-x64` 的 binary、設 `ESBUILD_BINARY_PATH`
就能沿用 mount 的 node_modules 跑完整測試鏈。

## admin v1.66 — 後台卡片索引「保證新鮮」＋ 載入失敗不再靜默

站長回報：admin 看玩家牌組明細出現 `#18594 × 2`；同一份文字貼進遊戲站「匯入」，
又出現「特殊紅牌 使用 M4·072/083（自動替代，原 083-106/083 不在牌池）」。

### 診斷（兩個現象同一個根）
- `18594` =「燃火能量」M2 109/080 I 標，是 **v6.116** 補進卡庫的 572 張重印之一。
- 牌組文字裡「特殊紅牌 **083** · 106/083」的 setCode「083」，是 **v6.117** 修掉的舊值
  （原本誤把分母寫進 setCode）。⚠ 該卡本身從 v2.107 就在庫裡，不是新卡。
⇒ **admin 那個分頁手上的卡片索引，是卡庫更新以前的快照。**
匯入端的「自動替代」是**正確行為** —— 它拿最新卡池找不到 setCode「083」，
於是退回同名卡並如實告知。真正該修的是 admin 匯出了過期的 setCode。

### 三個放大器（全部修掉）
| # | 問題 | 修法 |
|---|---|---|
| a | 兩個卡片 `fetch` 完全沒有 revalidate | 收斂到 `_fetchCardJson()`，一律 `cache:'no-cache'`（GH Pages 有 ETag，沒變只回 304，不會重抓 4MB） |
| b | `_cardLoadPromise` 是**分頁生命週期**快取 —— 後台分頁開好幾天就永遠是舊的 | 加 `CARD_INDEX_TTL_MS = 10 分鐘` |
| c | 逐包 `catch {}` 是**空的** —— 某一包沒載到完全無聲，只看到一堆 `#id` | 收集失敗卡包 → `console.error` ＋ 畫面非阻塞警告條 |

另外補了兩個既有缺陷：
- **cardCount 對帳**：`index.json` 每個卡包都宣告 `cardCount`，載完逐包比對實際張數；
  不符先 `cache:'reload'` 重抓一次，仍不符就列進警告。本次事故「宣告 116 張、實際 80 張」
  有這條會**一秒現形**。
- **外層 catch 原本把 `_cardLoadPromise` 留成「已解決的空結果」** → index.json 一次網路抖動，
  這個分頁從此所有卡片永遠是 `#id` 且永不重試。改成失敗時設回 `null`。

### ⚠⚠ 最需要小心的一點（Fable 5 指出，我複驗屬實）
牌組明細那段文字是**機器格式** —— `src/routes/decks/+page.svelte` 的 mAdmin regex
`/^(.+)\s+(\S+)\s+·\s+(\S+)\s+·\s+([GHIJ])\s+×\s+(\d+)$/` 逐字依賴
「卡名 卡包 · 卡號 · 標 × N」。所以 `cardLabel` 的 **fallback 絕對不能長得像它** ——
否則匯入端會把「索引沒載到」的那行當成一張合法的卡，靜默匯入到錯的卡片，
比顯示 `#id` 糟得多。現行「解析不了 → 匯入端明確報錯」是**安全的失敗**，必須保住。
守衛因此用**行為端**斷言：把 fallback 字串真的餵進那條 regex，必須解不出來；
同時正對照「正常格式仍解得出來」，證明機器格式沒被改壞。

### ⚠ 另一個查到但沒動的問題（未爆彈）
正式站 `www.ptcg-tw-sim.com/cards/index.json` 走 Cloudflare，實測 `cf-cache-status: HIT`、
`age` 約 **4.2 天**（遠大於 origin 的 max-age），回的是缺 M6 與 SV-P-J 的舊版；
加 `?nocache=` 重抓就是最新的。目前**沒有實際受害者** —— 遊戲站所有 runtime fetch
（`pool.ts` / `routes/cards/+page.ts`）都帶 `?v=${VERSION}`。
但這代表：**www 上任何不帶 query 的 static 資源都可能舊好幾天**。
守衛第 ④ 條因此寫成全 repo 掃描：任何對卡片 JSON 的 fetch 都必須帶 `?v=` 或指定 cache 模式。

### 守衛
`scripts/test-card-index-freshness.mjs`（9 項，HEAD 8 FAIL），已進 npm test。

### ⚠ 部署
只動 `oracle-admin/admin.html` ⇒ 跑 **`update-admin-html.bat`**（或 `update-admin-full.bat`）。
本版**不上首頁 changelog** —— 純後台問題，玩家沒有任何要做的事（見 v6.121 訂的規範）。

## v6.121 — 首頁 changelog 改成公告語氣，並移除只有站長需要知道的條目

站長：「首頁 changelog 的寫法應該是要給所有玩家看的扼要改版內容，而不是針對我（網站作者）
的說明」「與遊戲內容或網站內容無關的改版內容（或是玩家不需要知道的、只有我這個網站作者
需要知道的），就不用顯示在首頁 changelog」。

### 改了什麼
1. **拿掉全部第二人稱**（原本有 10 處「你」）：
   「會連問你兩次能量」→「會連續要求選兩次能量」、
   「牌組檢查會提醒你補齊」→「會提示補齊」、
   「改為由你自行勾選／盲選」→「由玩家自行勾選／盲選」、
   「不再直接結束你的回合」→「不會再直接結束該回合」、
   「只列出跟你有關的變化」→「只列出實際的改版內容」等。
2. **整則移除 3 條站長專屬題材**（內容仍完整保留在本檔）：
   - v6.119 錦標賽伺服器再降載 —— 純內部調整，玩家沒有任何要做的事
   - v6.106 更新記錄再精簡 —— 更新記錄自己的寫法
   - v6.100 首頁只顯示最近 50 次更新 —— 同上
   ⇒ 首頁 50 則 → **47 則**。
3. **v6.120 拿掉「錦標賽伺服器同步再降一輪負載」那句**；v6.118 不再解釋內部怎麼查。
4. 頁尾不再寫死「最近 50 次更新／更早的 189 則」，改成不綁數字的說法（以後搬條目不會過期）。

### 守衛（`test-changelog-size-and-archive.mjs` 12 → 13 項，HEAD 3 FAIL）
- ⑥ 技術用語黑名單加上 `降載／資料庫查詢／輪詢／索引／projection／API`
- ⑫ **第二人稱檢查**（你／妳／您），附正對照
- ⑬ **站長專屬題材檢查**（更新記錄再精簡／首頁只顯示最近／伺服器降載／部署／bat 檔）

⚠ 純前端靜態內容，不影響對戰；但有 bump 版本號（否則 Service Worker 會繼續餵舊的 changelog）。

## v6.120 — 「受到傷害時」道具重複觸發（玩家回報）＋ 伺服器降載收尾

站長：「還有未處理的就繼續下一輪。」本版兩件事：接續 v6.119 的伺服器降載尾巴，
以及久候的玩家回報「手持循環扇發動 2 次」。

### ⭐⭐⭐ A. 手持循環扇「發動 2 次」——真因是同一個效果掛在兩個 hook 上

**維度**：`registerToolOnDamagedAndKO` 把同一支 fn **同時**塞進 `TOOL_ON_DAMAGED` 與
`TOOL_ON_KO`。這個鏡射本身是對的 —— 引擎主管線的 KO 分支與非 KO 分支是**互斥的
if/else**，KO 時不會跑 `TOOL_ON_DAMAGED`，而依 PTCG 規則「受到傷害時」是包含
「被這次傷害打死」的，所以需要鏡射才會觸發。

**但中央傷害 helper 的結構不同**：`dealAttackDamageToTarget` /
snipe-multi / clone-strike-multi-hit 這三條都是
「先 `fireDefenderOnDamaged`、KO 時再 `fireDefenderOnKO`」，**兩條都會跑**
⇒ 同一次傷害觸發兩次。

harness 實測（一擊 KO 帶道具的戰鬥位）：

| 道具 | 卡面 | bug 版 |
|---|---|---|
| 幸運頭盔 | 抽 2 張 | **抽 4 張** |
| 手持循環扇 | 抽走 1 個能量 | **連開 2 個 picker，抽走 2 個** |
| 凸凸頭盔 | 反傷 20 | **反傷 40** |

其餘同批：火箭隊的催眠裝置／逆境保險／奢華炸彈。

**修法（中央收斂）**：`tools.ts` 公開 `TOOL_ON_KO_MIRRORED_FROM_DAMAGED`
（由 `registerToolOnDamagedAndKO` 自動登記，單一來源）；`fireDefenderOnKO` 新增
`onDamagedAlreadyFired` 參數，為 true 時**跳過鏡射來的那批**。
三個中央 helper 各自用 `const _onDamagedFired = ...` 記下實情再傳進去；
引擎主管線不傳（預設 false）⇒ 那條路徑行為一個字都沒變。

⭐ **通則：同一個效果同時掛在兩個 hook 上時，一定要有一個地方知道「另一個 hook 跑過沒有」。**
只要有任何一條路徑同時跑兩個 hook，就會靜默地觸發兩次，而且不會有任何錯誤訊息。

**枚舉守衛**（`test-v6120-ondamaged-tool-double-fire.mjs`，10 項，HEAD 5 FAIL）：
除了三個行為端斷言，還有跨表枚舉 ——
把 `TOOL_ON_DAMAGED`／`PASSIVE_RETALIATION`／`PASSIVE_ON_DAMAGED`／
`SPECIAL_ENERGY_ON_DAMAGED`（受傷側）與
`TOOL_ON_KO`／`PASSIVE_KO_RETALIATION`／`PASSIVE_ON_KO`（昏厥側）取交集，
**任何同時出現在兩側的名字都必須登記在鏡射名單裡**，否則 FAIL。
本次掃描確認：除了那 6 張道具，特性／特殊能量**沒有**任何一個被同時掛兩邊（維度乾淨）。
另有反向斷言（沉重接力棒／希望護身符這種真正的「昏厥時」道具不得混進名單、不得被跳過）
與「引擎主管線 KO 時幸運頭盔仍要抽 2」的正對照 —— 防止有人把鏡射整個拿掉。

### B. 伺服器降載收尾（接 v6.119 的 🔨 待辦）

三項，**全部只動讀取路徑，寫回路徑一個字不改**：

1. **`/event` 現行賽事解析改吃 3 秒快取**。原本 handler 第一行 `resolveEventFromReq`
   會走 `getActiveEvent → listOpenEvents`，等於**每個請求各一次未快取的**
   `TEVENTS.find({status:{$ne:'finished'}})`；而下一行 `getEventShared()` 早就把
   **同一份清單**快取了 3 秒。改成先取 shared、再從 `shared.openList` 解析。
   ⚠ 只改這個唯讀端點，`resolveEventFromReq` 本身不動 —— register／checkin 等
   **會寫入**的端點仍走未快取的新鮮讀取。
   ⚠ 排序抽成 `pickActiveFromList`，**必須先 `slice()` 再 sort**：呼叫端傳的是
   `_eventShared.openList` 這個快取物件本身，in-place sort 會把快取順序改成
   「顯示優先序」，而 `/event` 回傳的 events 清單依賴原本的 createdAt 順序。
2. **索引**：`TEVENTS` 原本除 `_id` 外**完全沒索引**（status 是全站最常過濾的欄位、
   賽事只增不減）→ 補 `{status:1}`；`TMATCH` 補 `(eventId,status)`／`(eventId,round)` 複合索引。
3. **對局時限掃描兩段式讀**：時限一到，該輪還在打的**每一場**都會每 30 秒各拉一份
   完整 gameState（log 佔約 73%），但判斷只需要 phase 與 turn 兩個純量。
   改成輕量 projection 早退 + **過了早退才走原本一字未改的完整讀取**。
   ⚠⚠ 同 v6.119 的地雷：底下三個判定分支都會 `JSON.parse(JSON.stringify(gs))`
   把盤面整包 `$set` 回去，**完整讀取絕不能加 projection**（會永久洗掉 log）。
   守衛裡有一條**全域否定斷言**：掃描所有 `JSON.parse(JSON.stringify(` 的位置，
   往前回溯最近的 `TROOMS.findOne`，該次讀取一律不得帶 projection。

守衛 `test-v6120-event-shared-and-roundlimit.mjs`（13 項，HEAD 9 FAIL），
含 `pickActiveFromList` 的**行為端**斷言（真的跑起來，驗證它不改動傳入的陣列）。

### 驗證
完整 npm test **440** 綠；`anti-pattern-lint` 無違規；`tsc` TS2304 = 0；
`node --check server_admin_patch.js` 過。

### ⚠ 部署
本版動到 **引擎（effects.ts / tools.ts）** 與 **`oracle-admin/server_admin_patch.js`**
⇒ 三支 bat 都要跑（`update-tournament.bat` 一定要，它同時重建錦標賽 server-engine 與上傳 patch）。

## v6.119 — 錦標賽伺服器端查詢降載（Fable 5 評估 + 逐條查證）

接續 v6.118（那批是純前端）。站長：「盡量把找到的問題徹底解決，但要避免風險。」
**Fable 5 抓到一個我原本會踩的地雷**，逐條查證後採用它的方案。

### ⚠⚠⚠ 差點踩的地雷：閒置判負「不能」直接加 projection
我原本打算對閒置判負的 `TROOMS.findOne` 加 `projection`（只讀 currentActorSeat 需要的欄位）。
Fable 指出：**判負分支會 `JSON.parse(JSON.stringify(gs))` 把整份盤面 clone 後寫回**
（`$set: { gameState: og }`）。projection 過的殘缺盤面寫回去 ⇒ **log 被永久洗掉**，
投降／閒置場的回放（`/replay`、`/match-log` 都靠房間 `gameState.log` fallback）會壞。

我逐字讀完 `currentActorSeat`（含 setup 的 5 種路徑）自行列出它碰的欄位，與 Fable 的清單一致
（phase / setupDone / openingChoicePending / pendingMulliganDraw / mulliganRevealConfirmed /
mulliganPostBenchOpen / mulliganCounts / pendingSelection.actorIdx / pendingPrizes /
players[i].active / activePlayerIndex，**不讀 log**）。但那不是重點 ——
**寫回路徑才是**。而且這個函式的註解裡有 v0.60/v0.62/v0.67/v0.74/v6.053 五次「誤判閒置敗」事故史，
是全站最不能亂動的地方之一。

⇒ 採用**兩段式讀取**（同檔 v0.68 `/state` 已驗證過的 pattern）：
輕量讀 `{ projection: { lastActionAt: 1, updatedAt: 1 } }` 只做門檻判斷，
**過門檻才走原本一字未改的完整讀取＋判定**。門檻的 fallback 鏈與完整路徑逐字相同；
`_light` 為 null 就落到完整讀由原本的 `!gs → continue` 處理。
判負與否的每一個決策仍由完整 doc 決定 ⇒ **零行為變更**，只可能多讀一次 200 bytes 的小 doc。
玩家對戰中每幾秒就有動作 ⇒ 99% 的 (場 × tick) 在輕量讀就結束。

### 本批六項（全部逐條查證過）
1. **TREGS 索引 `{uid}` `{eventId}`** —— 這個 collection 從來沒有索引，卻是**永久累積**的
   （正常完賽不刪報名，v0.84 預填暱稱、v0.90 聊天暱稱都刻意依賴歷史報名）。
   `/event` 每人每 3 秒 `find({uid})` 是全表掃。索引不可能改變查詢結果，只換 query plan。
2. **TREPLAY 索引 `{matchId}`** —— 回放快照是最大的 collection 之一（90 天 × 每半回合一份
   完整盤面），但 `find({matchId})`（看回放）與 `deleteMany({matchId})`（重賽清舊局）都是全表掃。
3. **閒置判負兩段式**（上面）。
4. **未進場判負的防呆探測加 projection** —— 那次 `findOne` 只讀 `gameState.phase` 且**不寫回**
   （逐字確認），可安全 projection。⚠ 同一分支下方「設 game-over」那次仍讀完整 doc（會寫回）。
5. **TRULES 30s TTL 快取 ＋ CRUD 主動失效** —— rooms-archetypes 以前每次 cache-miss 都重查。
   ⚠ miss 比想像多：**setup 階段的房間永遠不會進 `_roomArchCache`**（被 phase gate 擋掉），
   所以大廳只要有一間房在開局，每輪輪詢都會觸發一次查詢。
   ⚠ 快取與失效函式**移到 `TRULES` 宣告旁**（呼叫點在 handler、定義原本在後面 —— 雖然
   function 會 hoist、`let` 在 handler 執行時也早已初始化，但 v0.94/v1.01 兩次作用域事故
   讓我不想留任何疑慮）。
6. **`/event` 的 myRegs 不再拉回歷屆報名的完整 60 張牌表** —— handler 只用到
   eventId/name/deckName/checkedIn/autoRemovedConflict/registeredAt，**只有當前賽事那一筆**
   需要 deckEntries（算 deckCount）。改成 `projection: { deckEntries: 0 }` ＋ 對那一筆
   `_id` 點查補回。⚠ `deckCount(undefined)` 會回 **-1**（不是 0），不補回來前端會顯示錯的張數。
   已確認 `_events` 那邊只用 `_reg` 的 checkedIn/autoRemovedConflict/deckName/name。

### 刻意不做（Fable 也標「留下次」）
- **對局時限掃描**（同樣是全量讀）：它的兩個判定寫回點同樣是整包 clone，
  要改就得連寫回一起改成「重讀完整 doc 再 clone」——**這是本批唯一會動到寫入路徑的改動**，
  值得單獨一批＋單獨驗證（開一場 `roundLimitMin=1` 的測試賽跑到加時）。
- `/event` 內 active event 改讀 shared.openList（碰到 gate 語義）。
- 非 playing 房負快取、TEVENTS `$ne` 索引、判負寫回改 dotted `$set`。

### 守衛
`test-v6119-tournament-query-load.mjs`（12 項，HEAD 10 FAIL）。
⭐ 最重要的一條是**否定型**：閒置判負路徑必須仍有一次「不帶 projection」的完整讀取，
並斷言輕量讀排在它前面、fallback 鏈逐字相同。附正對照。
⚠ `test-v6115-lobby-archetype` 因為端點改用 `getEnabledRulesCached()` 而 FAIL ——
那是**正確的抓取**（它把端點原始碼抽出來實跑，依賴變了就會炸），補注入該函式後 16 項全綠。

### ⚠ 部署
只動 `server_admin_patch.js` → **必須跑 `update-tournament.bat`**（前端無變更）。

## v6.118 — 兩個效能退化：錦標賽 30 人 lag ＋ 卡牌資料庫「所有卡牌」卡住

站長回報＋玩家回報。**Fable 5 協助診斷，我逐條查證過**（兩條線的主因都不是「最近的新功能」，
是既有結構被資料量／人數放大 —— 但我 v6.115 確實在其中一個缺口上疊了東西）。

### ⭐⭐⭐ B 線根因：錦標賽頁整場都在跑「休閒大廳」的 2 秒輪詢
`/tournament` 是 `<GamePage tournamentMode={true} />`（**同一個元件**）。而：
- `onlineStep` 的初始值就是 `'join'`（`game/+page.svelte` 的 state 宣告）
- 錦標賽流程**從頭到尾不會改它** —— 三個 `onlineStep = 'room'` 賦值點全在
  休閒線上的「建房／加入房／admin 觀戰」路徑上，錦標賽有自己的 `tStep`
- 正式站在 onMount 會無條件 `oracleAuth()` 設好 `myUid`

⇒ 訂閱條件 `onlineStep === 'join' && myUid` **永遠成立** ⇒ 每位參賽者每 2 秒打兩支
`/api/rooms`（lobby + playing）。**30 人 ≈ 每秒 30 個純浪費請求**打進 Oracle 的單執行緒，
疊在錦標賽本身的輪詢（`/state` 1.2s/人、`/event`+`/chat` 3s、`/bracket` 9s）上。
錦標賽頁根本不顯示休閒大廳列表，這些資料一筆都用不到。

⚠ 這是**既有**缺口（我比對過 v6.113/v6.114 的同段程式碼，gate 完全相同），
之前 50 人賽 lag 做過兩輪降載也沒動到它 —— 那兩輪只 gate 了錦標賽自己的 5 支 API。
⚠ **但我 v6.115 把 `ensureRoomArchetypes()` 掛在同一個 callback**，所以錦標賽頁也會打
`/api/rooms-archetypes`。它有 per-room 30 秒節流＋伺服器 5 分鐘 TTL，量級小，但確實是我疊上去的。

**修法**：`$effect` 條件加 `!isTournament`；`ensureRoomArchetypes` 內再加一道 `isTournament` 早退
（雙保險，即使將來 `$effect` 又被改壞）。

### A 線根因：/cards?set=ALL 一次全量渲染 4930 張
- ALL 模式 fetch 42 個卡包 JSON，實測 **4.43 MB**（v6.116 後 4930 張）
- `{#each filtered as card (card.id)}` **完全沒有虛擬捲動／分頁** ⇒ 4930 張 × 每張約 5–6 個
  DOM 節點 ≈ **近 3 萬個節點在同一個任務裡建完**，主執行緒整段凍住
- ⚠ v6.101 的 `use:retryImg` **每個 `<img>` 各自**掛 `window:online` 與
  `document:visibilitychange` ⇒ **9,860 個全域監聽器**。掛載成本之外，每次切回分頁
  瀏覽器要同步迭代全部 handler
- 搜尋沒有 debounce：每敲一個字對 4930 張全量重跑 filter ＋ 4930 節點 keyed diff

**修法（純前端，三項）**：
1. `retryImg` 改成**模組層級各一個** listener ＋ `Set<kick>` 分發；
   用 `WeakSet<window>` 記「已綁過的 window」而不是布林旗標（SSR→CSR／測試換 window 才會重綁）
2. `/cards` 增量渲染：`PAGE_SIZE = 240`，`{#each shown}`＋IntersectionObserver 哨兵
   （`rootMargin: 600px`，捲到附近就先追加，使用者無感）；篩選／搜尋一變就把 `visibleCount` 歸零
3. 搜尋 150ms debounce（`filtered` 改讀 `debouncedQuery`）

### 守衛
`test-v6118-perf-guards.mjs`（9 項，HEAD 6 FAIL）：訂閱條件必須含 `!isTournament`／
`ensureRoomArchetypes` 有雙保險早退／大廳輪詢間隔不得 < 2000ms／grid 不得直接吃 `filtered`／
必須有 IntersectionObserver 追加且篩選變動歸零／搜尋必須 debounce／
`retryImg` 內不得再出現 `window.addEventListener`。各配正對照。
`test-v6101-img-retry.mjs` 的 1-7 改成**行為端**斷言（destroy 後全域事件不得再叫到該節點，
比數 listener 數量更強），並新增一條「掛 50 個 img 後全域 listener 仍恆為 1」。38 項全綠。

### ⚠ 還沒做的（下一批，需要動 Oracle patch → 要跑 bat）
Fable 另外指出三個**既有**的伺服器端可改善點，這版沒動：
- `TREGS` 沒有索引（`/event` 每 3 秒 × 人數做全表掃）
- 閒置判負掃描每 30 秒對每場 playing match 做 `TROOMS.findOne` **不帶 projection**
  （整份 gameState 含 log 拉出來只為算 `currentActorSeat`，log 佔約 73%）
- `/api/rooms-archetypes` 的 `TRULES.find` 每次 cache miss 都重查（可加 60s TTL）

### ⚠ 部署
本版**純前端**，不需要跑 bat。

## v6.117 — 把上一輪踩到的兩個坑做成常設守衛，順手修出兩個既有資料 bug

上一輪（v6.116 補 572 張重印）踩了兩個「當下沒有任何測試會紅」的坑。這一版把它們變成
`npm test` 的一部分，避免記憶被壓縮後重蹈覆轍。

### ① 根治：`build-sets-index.js` 以前完全不看 argv
`node scripts/build-sets-index.js --help` 不是查用法，是**直接跑完整重生**，
把 `index.json` 裡手工整理的欄位（卡包中文名「深淵之瞳」→ "M5"、regulationMark → null、
releaseDate）全洗掉。現在加了參數閘：
- `--help` / `-h` → 印用法後 `exit 0`，**不執行**
- 未知參數 → 印用法後 `exit 1`
- 沒帶 `--write` → 什麼都不做（預設不寫檔）
⭐ **通則：想知道一支腳本怎麼用，先 `head -30` 讀它的檔頭，不要試跑。**
   很多老腳本沒有參數解析，任何參數都等於「直接執行」。

### ② 新守衛 `test-card-db-integrity.mjs`（12 項）
把 v6.116 當時「手動跑過一次」的檢查全部常設化：
- **index.json 手工欄位沒被重生掉**：每包都要有 regulationMark、name 不得等於 code、
  非特典包要有 releaseDate（＋正對照確認判準抓得到「被重生」的樣本）
- **張數自洽**：index 的 cardCount/count 與實際卡片檔逐包相符
  （`build-server-engine.mjs` 的卡池守衛也依賴這個數字）
- **card-set-map.json 零落差**：缺／多／指錯都要 0
- **cardId 全站唯一**：同一個 id 不得出現在兩個卡包
  ——這條同時把「diff 只比同 set 檔會誤判成缺卡」的風險釘住
- **setCode 必須等於所在檔名**
- **卡名／招式名／特性名不得含零寬字元**
- **imageUrl 要麼由 id 合成、要麼在例外表**（＋例外表不得腐爛）
- **靜態**：`build-sets-index.js` 必須有參數閘

### ⭐ 這支守衛第一次跑就抓到兩個既有資料 bug
1. **M4（忍者飛旋）37 張秘密稀有的 `setCode` 被寫成 `"083"`**（分母），應為 `"M4"`。
   影響是玩家可見的：牌組編輯器的**卡包篩選**篩不到這 37 張、**匯出牌組文字**會輸出
   「哈力栗 083 084/083」而不是「哈力栗 M4 084/083」（貼到官方牌組工具會對不上）。
   ⚠ 對戰載入不受影響 —— `card-set-map.json` 是用檔名產生的，不是讀 setCode。
2. **6 處卡名／招式名含零寬字元 U+200C**（招式學習器 衰退、5 張的「念動彈」）。
   目前沒造成行為問題（那些招式都不需效果實作、那張是 G 標），但
   **effectKey 是「卡名|招式名」逐字比對**，零寬字元看不見卻會讓 reg 永遠對不上 ——
   將來要實作時會變成「明明寫了卻靜默沒生效」。一併剝除。

兩者都已修正，守衛 HEAD 對照 3 FAIL → 修後 12 PASS。完整 npm test 436 綠。

### ⚠ 部署
改到 `static/cards` → **必須跑 `update-tournament.bat`** 重生 tournament-pool.json。

## v6.116 — 補齊 572 張漏收的高稀有度印刷（SR／SAR／AR 等，全部 H/I/J 標）

玩家回報：支援者「小光」缺 SR/SAR 版卡圖（`detail/18600`、`detail/18591`）。
Wilson：「請掃一下還有哪些卡片的高版本漏抓了，請補上（功能應該都有了，只是缺卡圖）。」

### 全站盤點（官方 card-search vs 我方）
| 卡包 | 我方 | 官方 | 缺 | 其中 H/I/J |
|---|---|---|---|---|
| M2 烈獄狂火X | 80 | 116 | 36 | **36**（全 I） |
| M2a 超級進化夢想ex | 250 | 486 | 236 | **236**（I 194／H 42） |
| SV8a 閃色寶藏ex | 237 | 381 | 144 | **97**（H；另 46 張 G 標不補） |
| SV11B 漆黑伏特 | 174 | 254 | 80 | **79**（I 78／H 1；1 張 G 不補） |
| SV11W 純白閃焰 | 174 | 254 | 80 | **80**（全 I） |
| M-P 特典卡 | 134 | 156 | 24 | **24**（全 J） |
| SV-P 特典卡 | 84 | 238 | 154 | **20**（J 13／I 7；另 134 張 F/G/A–E 不補） |

合計補 **572 張**，卡庫 4358 → **4930**。其餘 34 個卡包官方數＝我方數，乾淨。
（M6 我方 76 > 官方 73，是發售前預掃的秘密稀有，不是問題。）

### ⭐ 全部都是既有卡的重印，沒有需要新實作的卡
逐張比對卡名（去掉「基礎/1階進化/2階進化」前綴與 `<火箭隊的>` 標記後）：
572 張全部在我方已有同名卡。所以「功能都有，只缺卡圖」的判斷正確。
兩種形態：M2/M-P 是**超號秘密稀有**（081–116/080）；SV8a/SV11B/SV11W/M2a 是**同編號另一種印刷**
（官方同一個編號有兩個 id，我方只收了其中一個）。

### 方法（可複用）
- 官方 `card-search/list` 是 server-rendered，`?expansionCodes=<CODE>&pageNo=N` 可直接列舉 detail id；
  detail 頁 fetch + DOMParser 取 `h1`（階段+卡名）、`span.alpha`（**regulationMark**）、
  編號、`.skillName`、`various_images/energy/<屬性>.png`。
- ⚠ **diff 必須跟「全站所有 id」比，不能只跟同名 set 檔比** —— 某張卡可能被我方收在別的檔案裡，
  只比同 set 會誤判成缺卡（本次驗證：誤判 0）。
- clone 精配：同 set 同名 → 屬性 → 招式集（v5.906 教訓：新編號別信「同名第一張」）。
  ⚠ 官方 `.skillName` 含**零寬字元**，比對前要先剝掉，否則招式集永遠對不上而落回錯的候選
  （鴨嘴炎獸 19532 本來被配到舊版 12476，剝掉後正確配到 19563）。

### ⭐⭐ 兩個本次踩到的坑（都寫進記憶）
1. **`node scripts/build-sets-index.js --help` 不是查說明，是直接重生 index.json**
   （它不解析參數）。手工整理的卡包名稱（深淵之瞳→"M5"）、regulationMark、releaseDate 全被洗掉，
   `test-card-set-order` 才抓出來。修法＝從 HEAD 取回 index.json 重做手術式更新，
   並加 HEAD 對照斷言「未動到的卡包欄位必須逐欄相同」。
2. **大量資料在瀏覽器與本地之間搬運會有轉抄錯誤**：572 筆裡有 1 筆打錯
   （13022 的來源寫成 13948／實為 13947，會把「陳舊的背蓋化石」配成「寶可裝置3.0」）。
   ⭐ 修法＝**兩邊各算一次校驗和**（每個 set 的筆數／新 id 總和／來源 id 總和／編號總和）比對，
   差 1 就抓得出來。這個做法要固定下來。

### 驗證
`index.json` cardCount 與實際檔案逐包相符、`card-set-map.json` 與實際檔案零落差（缺 0／多 0／指錯 0）、
未動到的 34 個卡包欄位與 HEAD 逐欄相同；21 張「來源 reg ≠ 官方 reg」的卡（多為 G 標舊印刷升到 I/J）
逐張比對官方卡面文字，與我方來源完全一致。

### ⚠ 部署
**必須跑 `update-tournament.bat`** 重生 `tournament-pool.json`，否則這 572 張在錦標賽伺服器端不存在
（client 組得出牌、server 不認 id）。build 端有卡數守衛，數字不符會中止部署。

## v6.115 — 大廳「對戰中的房間」改顯示**牌組原型名稱**（取代 v6.114 的場面卡圖）

Wilson 看完 v6.114 後改需求：「我覺得你這樣弄得太複雜了，不用顯示獎賞卡和寶可夢，
只要去比對雙方玩家的牌庫內容，是屬於我在 admin 裡面設定的符合哪一套牌組原型，
然後就能判斷玩家是用什麼牌組在玩。」
⇒ v6.114 的迷你場面列（卡圖／獎賞張數／回合數）與 `lobby-preview.ts` **整個移除**；
大廳排版重構保留（那是 Wilson 自己提的需求）。

### 新端點 `GET /api/rooms-archetypes?ids=A1B2,C3D4`
放在 `registerDeckRules` 這個 IIFE 內（`deckToSets`/`classifyDeck`/`TRULES`/`getCardNameMap`
都在該作用域）。⭐ **不可以**為了「放在房間區塊比較順」把分類邏輯抄第二份 ——
`classifyDeck` 的註解已寫明兩份不同版會把同一副牌分到不同原型。

- **只回名稱字串**（`{ roomId: { p1, p2 } }`），牌表一張都不出去（白名單建構，不是 delete 私有欄位）。
- 查詢帶 `projection: { 'seats.deckEntries':1, 'gameState.phase':1, status:1 }` ——
  不加的話整份房間（含雙方手牌／牌庫）會被拉進伺服器記憶體。
- 端點**不掛 requireFirebaseAdmin**（大廳所有人要用），但也因此更不能回牌表。
- `ids` 用 `/^[A-Z0-9]{1,8}$/` 白名單 + 上限 40（防注入、防一次拉全部房間）。
- 5 分鐘 TTL 快取（一場對戰內牌組不會變）。

### ⚠⚠ 兩條刻意的時機限制（都有守衛實跑驗證）
1. **只處理 `status === 'playing'`**。等待中的房間雙方已選牌組但還沒開打，
   先看到對方牌組再決定加不加入＝牌組狙擊。**Wilson 裁定：只對戰中顯示。**
2. **連 playing 房也要 `gameState.phase === 'playing'` 才回**。開局放置階段對戰畫面本身是
   `oppHidden`（雙方互相看不到場面），若大廳先報出牌組，玩家另開一個分頁就能依對手牌組
   決定自己的開局策略。

### 回傳語義（前端必須分辨兩種「沒有」）
- 字串（含 `'未分類'`）＝ 有牌表且比對完成 → 顯示
- `null` 或該 roomId 不在回應裡 ＝ 還不知道（未開打／規則庫沒載入／房間不存在）→ **不顯示**
⭐ 規則庫沒載入時**絕不能**回「未分類」，否則整個大廳會變成一片「未分類」。

### 前端
`ensureRoomArchetypes` 在 `subscribeOpenRooms` 的 callback 呼叫，但**只問**
「還沒有標籤且 30 秒內沒問過」的對戰中房間 ⇒ 正常每間房只問一次，
不會跟著大廳每 2 秒輪詢一起放大負載。`ORACLE_MODE` gate + `catch` fail-open。
⚠ **測試站（Firebase）沒有這套規則庫**，標籤只有正式站看得到。

### 守衛
`test-v6115-lobby-archetype.mjs`（16 項，HEAD 13 FAIL）。
⭐ 用**大括號配對**把端點原始碼抽出來，注入假的 `db`/`getCardNameMap`/`TRULES`/`classifyDeck`
**實跑**，真的驗「setup 不回」「lobby 拿不到」「回應不含牌表」，不是只做字串比對。

### ⚠ 部署
前端隨 GitHub Pages 走；**端點在 `server_admin_patch.js` → 必須跑 `update-tournament.bat`**，
否則前端會打到不存在的端點（已 fail-open，只是沒有標籤）。

## v6.114 — 大廳「對戰中的房間」顯示雙方場上寶可夢 ＋ 大廳排版重構（批 1／純前端）

**來源**：玩家許願「希望可以在對戰房間外面顯示裡面對戰的卡組，例如雙方戰鬥區跟備戰區目前放的
寶可夢，這樣想觀戰特定卡組學習的時候比較方便找。」Wilson 裁定照 Fable 5 的分批走，
牌組原型標籤放到批 3（僅正式站，未命中顯示「未分類」）。

### 勘查更正（我原本的假設是錯的）
- **正式站（Oracle）大廳拿不到盤面**：`server.js` 的 `GET /api/rooms` 有
  `projection: { 'seats.deckEntries': 0, gameState: 0 }`。所以本批的場面預覽
  **只有測試站（Firebase `onSnapshot` 拿整份 room doc）看得到**，正式站要等批 2 的摘要端點。
  ⚠ repo 裡的 `server js.txt` 是 2026-06-24 的副本，VM 現行版需 Wilson 確認。
- **卡圖例外只有 5 張**（Fable 說 248 張是把非 live 的 `M5_jp_legacy` 246 張算進去了）：
  M-P-J 兩張只有港版圖、M6 傳說競技場三張共用同一張官方圖。
- 大廳頁的 `pool` 是進對戰後才依牌組載入的，**大廳階段沒有卡片資料庫** → 顯示卡名要額外載 DB，
  顯示卡圖反而便宜（URL 由 cardId 合成）。

### 中央管線 `src/lib/game/lobby-preview.ts`
`buildLobbyFieldPreview(room)` 是**唯一**的資料出口，UI 不得直讀 `r.gameState`（守衛有擋）。
**白名單建構**（逐欄位挑出來組新物件），不是「複製後 delete 私有欄位」—— 後者只要來源多一個
欄位就會靜默外洩。輸出只有：雙方 active/bench 的 cardId、獎賞**張數**、回合數。
形狀用 `{ p1, p2 }` 而非 `T[][]`（Firestore 巢狀陣列禁令，v6.056）；批 2 的伺服器端點回同一形狀，
UI 不必再改一次。

### ⚠⚠ 兩條真的洩漏路徑（都已 gate + 守衛）
1. **setup 階段一律不預覽**。對戰畫面本身是 `oppHidden = (game.phase === 'setup')`，
   開局放置期間雙方互相看不到場面；但房間此時 `status` 已經是 `playing`，若大廳照畫，
   玩家只要**另開一個分頁看大廳**就能偷看對手還沒揭示的備戰區。（這條 Fable 沒抓到。）
2. **等待中（lobby）的房間永遠不顯示任何場面／牌組資訊**。雙方已選牌組但還沒開打，
   先看到對方牌組再決定加不加入＝牌組狙擊。守衛用結構 anchor 截出 lobbyRooms 區塊，
   斷言區塊內不得出現 `buildLobbyFieldPreview` / `gameState` / `deckEntries` / `or-field`。

顯示「場上寶可夢」本身**不是**洩漏：戰鬥區／備戰區、獎賞剩餘張數是 PTCG 規則上的公開資訊，
何況觀戰模式本來就是上帝視角（有「看 P1／看 P2」工具列）。

### 排版重構（Wilson：必須兼顧手機版）
舊版 `.open-room-row` 是**單行 flex 且沒有 flex-wrap**，一列硬塞 6 個元素，375px 寬下房名被
壓成幾個字、其餘互相擠爆；`.open-room-list` 還有 `max-height:240px` 內滾動 → 手機變成
「頁面滾動 + 清單內滾動」雙層滾動。改成三行卡片式（`or-main` / `or-meta` / `or-field`），
每行各自 `flex-wrap`，手機 media query 解除內滾動。名稱未填時補一行提示（舊版只是把按鈕反白，
不說為什麼）。既有功能全部保留：練習房標籤、等待開戰標籤、房主在線圓點、房齡、房號、
手動房號加入、私密房過濾、觀戰開關。

### 卡圖
`lobbyCardImageUrl(cardId)` 由 id 合成官方網址，5 張例外走 `CARD_IMG_EXCEPTIONS`。
⭐ **枚舉守衛**：掃 `static/cards` 的 live 卡，凡 imageUrl 不等於合成值就**必須**在例外表裡，
且例外表不得有多餘項 —— 以後新卡出現例外而沒補表會直接紅燈。
載入失敗用 `or-img-failed` class 隱藏，**`onload` 會把 class 拿掉** —— keyed each 會重用節點，
不復原的話上一張的失敗狀態會被帶到新卡上（v6.101 教訓）。備戰區 each 用 `cardId + index` 複合 key
（只用 cardId 遇到場上兩隻同名會撞 key → 整頁白屏）。

### 守衛
`test-v6114-lobby-preview.mjs`（16 項，HEAD 13 FAIL）。

### ⚠ 部署
本批**純前端**，`npm run build` 的測試站即可驗收；正式站的大廳同樣吃這份前端，
但因為端點沒回 `gameState`，**正式站要等批 2 才看得到場面**。

## v6.113 —「自身條件才可使用招式」維度收斂（請假王ex 漏 4 種特性消除）

**Wilson 回報**：「超級泥偶巨人ex 能在手牌不滿 10 張的狀況下使用招式。」

### ⚠ 先講結論：那張卡在乾淨盤面下**引擎是對的**
用 harness 跑真實 `applyAction` 流程逐一重現：
手牌 5 張→擋、9 張→擋、10 張→可用（卡面是「10 張**以上**」）、ATTACK 端也擋（不只 UI 反白）。
`getAvailableAttacks` 與 ATTACK handler 兩端都走 `selfAttackPreconditionBlock`（v6.080 就收斂好了）。
**放行的情況只有一種：它的特性被消除**（招式版暗夜羽擊／振翼髮／傳說的熔岩洞／鐵荊棘ex 初始化）
—— 那是**正確**行為（特性沒了，限制就沒了）。
⭐ 需要跟 Wilson 確認實際情境：場上是不是有【傳說的熔岩洞】或對手【鐵荊棘ex】。

### ⭐⭐ 但沿著這個維度掃全站，抓到同型的真 bug
卡面「自身條件才可使用招式」的 HIJ 卡**共 3 張**：
| 卡 | 卡面 | 實作 |
|---|---|---|
| 火箭隊的超夢ex｜力量抑制者 | 自己場上「火箭隊的」≥4 隻 | 中央述詞 ✅ |
| 超級泥偶巨人ex｜啟動限制 | 自己手牌 ≥10 張 | 中央述詞 ✅ |
| **請假王ex｜懶怠個性** | 對手場上沒有 ex/V 則無法使用招式 | **自己一份** ❌ |

`isLazyTraitBlockingAttack` 只 gate 了「火箭隊的監視塔」一種特性消除，
**漏掉招式版暗夜羽擊／振翼髮 passive／傳說的熔岩洞／鐵荊棘ex 初始化**（後三種都會消除它的特性）。
已用 harness 逐一重現：④⑤⑥ 三個情境在 HEAD 都是「特性已被消除卻還擋」。

⚠ 另外它的 ATTACK 分支還會 **`turnPhase: 'end'`** —— 「無法使用招式」不該連回合都耗掉；
同維度另兩張都只是拒絕並寫 log。**三張已統一成同一種行為**。

### 修法（中央收斂）
- 「懶怠個性」收進 `selfAttackPreconditionBlock`，前面照樣過 `isAbilityHolderEffective`。
- engine 兩處自己一份的呼叫全部移除。
- `isLazyTraitBlockingAttack` **只留卡面條件**（對手有沒有 ex/V），特性有效性一律交給中央述詞
  —— 兩份判斷遲早漂移，這次就是漂移的結果。

### ⭐ 一勞永逸：枚舉守衛
`scripts/test-v6113-self-attack-precondition.mjs`（20 項，HEAD 9 FAIL）最後一條**掃 static/cards**：
HIJ 卡面凡是「才可使用招式／無法使用招式」型特性，特性名都必須出現在中央述詞裡，
**新卡漏接直接紅燈**（現況 3 張全部已接）。另有正對照確保判準不是永遠成立。

行為端 13 條：兩張卡的邊界值（9/10 張）、ATTACK 端也擋、特性被消除→限制消失（4 種來源）、
被擋時不得結束回合。靜態 4 條：三個特性名在中央、每張都有 `isAbilityHolderEffective`、
engine 不得在中央之外自己呼叫、`isLazyTraitBlockingAttack` 不得自己判特性消除。

## v6.112 — 化石身上的道具／場地 HP 加成生效 ＋ 奪冠報告圖三項修正

### ⭐⭐ A：英雄斗篷附在化石上沒作用（玩家回報）
`getEffectiveHP` 開頭有一行 `if (inst.fossilOnField) return 60;`
（v2.187 註解：「化石上場永遠 60HP，且**不吃任何 Tool/能量/Stadium 加減**」）。

**查證（Fable 查、我逐項複驗）**：
- 現行台灣官方卡面**只有兩個限制** —— 「不會陷入特殊狀態」「無法撤退」。
- 官方規則 1031 條 Q&A **查不到任何**「化石不受寶可夢道具影響／HP 固定 60」的條文
  （我自己也 grep 過「不受／無法附加／固定／無效」全部 0 命中）；反而：
  §17.39.I 治癒襁褓**可以**恢復場上化石的 HP、§17.38.B 化石可被效果KO、
  §17.37.C 化石可被進化、§128「處於附加狀態時，寶可夢道具的效果**皆為有效狀態**」。
- ⭐ **舊寫法的來源已查出**：`static/cards/M5_jp_legacy.json`（日文預覽版舊文本，id 50290/50291）
  寫著「**無法被附加能量，也不受弱點和抵抗力的影響**」—— **現行卡面已刪除這兩句**，程式沒跟上。
- ⚠ 而且舊行為是最糟的組合：`tools.ts` 的 `toolAttachableTargets` **沒有排除化石**，
  UI 讓你附、log 印「🔧 英雄斗篷 附加到 陳舊的背蓋化石」，**只有 HP 加成被吞掉**。

**Wilson 裁定**：依現行卡面，加成生效。

**修法（中央收斂）**：`return 60` 早退 → **只換 base**（`FOSSIL_BASE_HP = 60`），
之後整條既有加成鏈原封不動（阻礙之塔 gate → 道具 → 特殊能量 → 場地）。
屬性／卡名不符的（增強【草】能量、引力山岳、昂主花葉蒂）本來就不會命中，不必特判。
⭐ 另加中央述詞 **`isBasicPokemonOnField(inst, card)`**：化石的 `pool.get(cardId)` 是 **Trainer**
（`stage`/`hp`/`pokemonType` 全 null），任何寫成 `card.stage === 'Basic'` 的判斷都**不會命中化石**，
但卡面明寫它「可作為…【基礎】寶可夢放置於場上」。激動競技場（【基礎】最大HP+30）兩條路徑都改走它。

**實測值**：裸化石 60｜+英雄斗篷 **160**｜+激動競技場 **90**｜兩者疊 **190**｜
+增強【草】能量 60（【無】不吃）｜+引力山岳 60（那是【2階】-30）｜阻礙之塔在場 60（道具被停用）。

**受影響 caller 全部間接經由 `getEffectiveHP`**（engine 20 處、`effectiveHPInline` 15 處、
UI 桌機＋手機兩套血條、ai.ts 8 處＋ai-eval 2 處）——單一來源收斂得夠好，**零散點改動**。
既有兩支斷言化石=60 的測試都用裸化石 ⇒ 仍全綠，不需改。

### B：奪冠報告圖三項修正（Wilson 回報）
1. **「很多字疊在一起」** —— 第一版每區固定 max 列數、y 一路累加，社群賽場次一多就把註腳與
   頁腳整個蓋過去。修法＝**畫之前先算剩餘空間**（`roomFor(rowH, reserve)`），
   列數 = min(想畫的, 塞得下的)；註腳／頁腳是硬保留區。
   ⭐ 通則：**Canvas 版面別用「固定列數 + 累加 y」**，資料量一變就爆版；要嘛先分配再畫，
   要嘛畫之前問「還剩多少空間」。
2. **按鈕移到「牌組原型」分頁**，與「🖼️ 匯出環境報告圖」並排、共用左邊的「統計範圍」下拉
   （全部時間／7／30／90 天）。⚠ 它不需要先按「計算統計」，所以不 disabled；
   ⚠ 換頁後 `tournStatsCache` 可能是 null → **自己補載一次** `/api/tournament/admin/stats`。
3. **社群賽不列玩家名字**（Wilson：「這個圖主要是讓玩家參考哪些牌組目前強勢，不是針對個人
   玩家的成績」）→ 改成「該期間**奪冠次數最多的前幾名牌組**」次數榜（列高 56，比冠軍列 92 省空間）。

### 守衛
- `test-v6112-fossil-hp-bonuses.mjs`（15 項，HEAD 7 FAIL）：卡面查證＋四組該生效的值＋
  三組反向對照（不該生效的仍不生效）＋中央述詞＋KO 判定跟上＋靜態禁早退復活（**剝註解後掃**，
  因為修正說明裡引用了舊寫法）＋兩條正對照。
- `test-v6111-champion-report.mjs` 擴到 27 項：社群賽次數榜、社群賽區塊禁用 `champRows`、
  `roomFor` 動態列數、按鈕位置、快取為空自己補載。
  ⚠ 抓社群賽區塊的 anchor 要用 `sectionHead('👥'`，不能用「社群賽」三個字 —— 副標裡就出現過一次。

### ⚠ 部署
A 是引擎改動 → **`update-tournament.bat`**（重建錦標賽 server-engine）＋另兩支。
B 只動 `admin.html` → `update-admin-full.bat`。

## v6.111 — admin：奪冠報告圖（可發佈的 PNG）

Wilson：「我想到還可以增加奪冠的報告圖，內容分別為 網站賽 冠軍、四強的牌組、社群賽 冠軍的
牌組等等（因為社群賽通常人數都很少，因此我覺得只列冠軍就好），或是其他你覺得有意義的統計，
請 Fable 5 幫忙也設計出一張輸出的圖片（參考已經完成的牌組使用率與勝率 匯出環境報告圖）」

### ⭐ 為什麼是兩張圖而不是同一張圖多一個分頁：量綱不同
既有「環境報告圖」＝**連續的份額／勝率**（分母是幾千場對局，畫比率有意義）。
奪冠報告＝**離散的個位數事件**（一期可能只有 3 場網站賽）。
⇒ **本圖全圖不出現任何百分比**，一律「N 場」「N 位」；也**不做「較上期 ▲▼」**
（奪冠數的期間差幾乎全是噪音，環境圖的 `miTrend` 整段不引用）。

### 資料來源：兩份，用 eventId／uid 對照
1. `tournStatsCache`（`/api/tournament/admin/stats`）—— 賽事名／時間／人數／matches／deckEntries
2. **新端點** `GET /api/admin/champion-report?since=` —— 伺服器端算好的「冠軍與四強 → 牌組原型」

⭐ **為什麼分類要在後端算**：`classifyDeck` 的註解已寫明「總表與明細若不同版，同一副牌會被
分到不同原型」。前端自己抄一份必然漂移；而且伺服器的卡名對照（`tournament-pool.json`）
與前端的 `CARDS_BASE`（github.io）是**兩份不同來源**，前端比對 includes/excludes 卡名有對不上的風險。
⭐ **名次推導反過來走 app.locals**：`_detectCutPlacements` 原本在錦標賽 IIFE 內，新端點在
deck-rules IIFE 內 → 把函式掛上 `app.locals`，**不抄第二份**。它的保守條件（決賽必須單一場、
四強必須是決賽兩人的上一輪）是刻意寫死的，放寬會把瑞士輪某一輪誤判成準決賽、圖上出現 16 個「四強」。
⚠ 跨 IIFE 的東西一律在 **handler 執行時**才從 app.locals 取，不要在註冊時解構（v0.94/v1.01 事故）。
⚠ 端點刻意**不回 deckEntries** —— ① 已經有一份，再傳一次每場 N×60 張很肥。

### 圖面（1080×1350，2× 輸出，沿用環境報告圖的 MI 常數與 miRR/miFont/miFit/miLogo）
品牌帶 → 標題（期間・網站賽 X 場・社群賽 Y 場・共 Z 人次）→ 🏆 網站賽冠軍（>3 場改「冠軍牌組
次數榜」）→ 🥈 網站賽四強牌組次數 → 👥 社群賽冠軍（**沒資料也保留區塊**，避免版面塌陷）
→ 註腳（口徑說明）→ 頁腳（含「本站為非官方、非營利」）。

### 口徑（都寫進註腳，避免玩家拿去跟大廳排行榜對數字）
- **參賽 < 8 人的賽事不計四強**：4 人賽的「四強」＝全體參賽者，數字正確但荒謬。
- **社群賽完全不進四強統計** —— 與 `_aggregateArchives` 的既有口徑一致（社群賽本來就不算名次）。
- 沒有冠軍的場次（取消／雙方未到）、名次判不出來的場次，都在註腳報數字，不靜默吞掉。
- 原型未命中 → 退玩家自填牌組名 → 再退主力寶可夢 → 「（未分類）」。

### ⚠ 陷阱（沿用既有那張圖踩過的，加上新的）
- 一律用 `tournStatsCache.archives` **全量**，不可用被 `tsEventFilter` 篩過的那份 ——
  使用者切到「社群自辦賽」再產圖，網站賽區塊會整塊空掉，**而且完全不會報錯**。
- **不放卡圖**：卡圖在 github.io ＝跨來源，畫進 canvas 會 taint、`toBlob` 直接拋 SecurityError、
  整張圖匯不出來。只用卡名文字。
- logo 走既有 `miLogo()`（`drawImage` 一張未 decode 的圖會**靜默不畫也不報錯**）。
- 主力寶可夢 fallback 前要 `await ensureCardIndex()/ensureCardTags()`，否則會把支援型寶可夢
  當成主力，產出「吉雉雞ex 奪冠」的笑話圖。
- 文案零「官方」（v6.110 的版權風險）。

### 守衛 `scripts/test-v6111-champion-report.mjs`（22 項，HEAD 18 FAIL）
靜態：端點存在／分類走 classifyDeck／名次走 app.locals 且全檔只有 1 份定義／不回 deckEntries／
limit 與 stats 對齊／用全量 archives／MIN_FOR_TOP4=8／零百分比／不引用 miTrend／
用 miLogo·miFont·miFit／固定 2×／await 卡片索引／文案零「官方」＋正對照。
行為端：**把 `crBuild` 用大括號配對抽出來實跑**（未滿 8 人不計四強／社群賽不進四強／
沒有冠軍的場次／判不出名次／原型未命中退 deckName／冠軍戰績勝負）。
⚠ 抽取失敗時給 throwing stub，讓失敗以正常的 ✗ 呈現 —— 否則 HEAD-FAIL 對照會直接 crash、看不到 FAIL 數。

### ⚠ 部署
**`update-admin-full.bat`**（admin.html）＋ **`update-tournament.bat`**（server_admin_patch.js 的新端點）
都要跑，否則按鈕會打到不存在的端點。

## v6.110 — 「官方賽」全面更名為「網站賽」（版權風險）

**Wilson**：「請幫我從官方賽更名為網站賽，避免誤導玩家以為我是寶可夢的官方，或是引起官方
版權爭議…tournament 有關我們網站自己取名為官方的稱呼都改掉。」

首頁免責聲明白紙黑字寫「本站為**非官方**、非營利之愛好者社群」，站內卻把自辦賽事叫「官方賽」
—— 自相矛盾，也是實質的商標／版權風險。

### 改了什麼（11 處使用者可見文字）
`src/routes/game/+page.svelte`（9）：🏛️ 官方歷屆冠軍→網站賽歷屆冠軍｜🏛️ 官方賽→🏛️ 網站賽｜
勝場榜（官方+社群）→（網站賽+社群賽）｜8 強榜（官方）→（網站賽）｜決賽次數榜（官方）→（網站賽）｜
個人成績四格：官方奪冠／決賽(官方)／4 強(官方)／8 強(官方)→網站賽…
`oracle-admin/admin.html`（2）：賽事統計篩選鈕「🏛️ 官方賽」→「🏛️ 網站賽」、「（僅官方賽）」→「（僅網站賽）」

### ⚠ 刻意**不**改（改了會壞或反效果）
1. **資料欄位／API 契約**：`communityEvent`、`championsOfficial`、admin 篩選值 `'official'`、
   變數名 `tHofOfficialOpen`／`nOfficial`。歸檔資料已經用這些鍵存了幾百場，改了就是資料事故。
2. **對寶可夢官方的正當引用**：「PTCG 官方規則」「官方中文卡名」「官方素材」「非官方」
   「支持官方數位生態系」—— 這些正是在表達「我們不是官方」，改掉反而糟。
3. **changelog 封存頁的歷史紀錄**（保留原始敘述，鐵律）。

### 守衛 `scripts/test-v6110-site-tournament-naming.mjs`（9 項，HEAD 2 FAIL）
掃 5 個檔，**先剝掉 `//`、`/* */`、`<!-- -->` 三種註解**再找禁用詞
（`官方賽`／`官方奪冠`／`官方歷屆`／`（官方）`／`(官方)`／`官方+社群`）。
⭐ 三條正對照缺一不可：①明顯違規樣本要被抓 ②註解裡的舊稱不算違規 ③**「非官方」「官方規則」
「官方中文卡名」不得被誤殺**。另有一條反向斷言釘住三個資料欄位仍然存在
—— 防止未來有人「順手」把欄位名一起改掉。

⭐ 通則：**更名類需求要先切開「使用者看得到的字」與「資料／協定用的字」**，
只改前者。用具體禁用詞（而不是「含某字」）當判準，才不會把正當用法一起殺掉。

## v6.109 — 「查看/搜尋 N 張選某類」的 picker：可勾區只放該類別，其餘走下拉

**玩家回報**：「超級烈空坐ex 的特性【霸者咆哮】應該只篩選出能量卡，然後下拉選單顯示其他的
非能量卡片，請參考寶可裝置3.0 之類的卡牌的作法。」

### 維度定義（這輪掃的是這個）
**picker 的 `filter`（決定畫面顯示什麼）必須與 `validIids`（決定能勾什麼）一致。**
兩者不一致時，玩家就是在一堆點不動的卡裡找目標，而且畫面**完全沒有解釋為什麼點不下去**。
判準永遠是**卡面**：卡面限了什麼，filter 就要限什麼。

### 修的（依卡面逐張查證，全 HIJ）
| 卡 | 卡面 | 舊 filter（顯示） | 新 filter |
|---|---|---|---|
| 超級烈空坐ex｜霸者咆哮 | 查看上方4張，選1張**基本能量卡** | `TOP4`（4 張全放可勾區） | `BasicEnergy:TOP_N` |
| 杖尾鱗甲龍｜鱗片律動 | 查看上方6張，選任意數量**基本能量卡** | `TOP6` | `BasicEnergy:TOP_N` |
| 蛋蛋｜果實盈滿 / 急凍鳥｜冰冷羽擊 / 雷電雲｜充電 | 「基本【草】/【水】/【雷】能量」 | `BasicEnergy`（列出**所有屬性**） | `BasicEnergy:<Type>`（**中央 helper，一改三卡**） |
| 樹才怪｜考驗之旅 | 選最多2張**「變化之書」** | `Any`（顯示**整副牌庫**） | `Name:變化之書` |
| 招式學習器機 | 名稱含「招式學習器」的**寶可夢道具** | `PokemonTool`（列出所有道具） | `Tool:NameContains=招式學習器`（新 prefix） |

⭐ **中央化的紅利**：UI 與 ai.ts 的 deck-search 都已先呼叫 `evaluateSelectionFilter`（P1-1 批3/4），
所以新 prefix 只要收進 `selection-filter.ts` **一處**，兩端自動生效 —— 不需要再各寫一份。
⚠ `Tool:NameContains=` 不能用既有的 `NameContains:`：那個 prefix 的語義是「名稱含 X 的**物品卡**」
（化石採掘場 v5.155 建立），會抓到 Item 的「招式學習器機」**本身**、卻抓不到 PokemonTool 的道具。

### 沒改的（正對照：判準不是「一律禁止純 TOPn」）
探險家的嚮導（TOP6）／八朔（TOP8）／多龍奇｜偵查指令（TOP2）卡面都是「選**任意** N 張卡」，
本來就該全部可勾 —— 它們也**沒有** validIids。這正是 Check W 的判準。

### 一勞永逸：lint Check W
`filter:'TOPn'`（純數字）且同一個 withPending 內有 `validIids` ⇒ 違規。
在 HEAD 上跑**恰好**抓到那兩張、修後全站乾淨（我把 lint 丟進 `git archive HEAD` 的樹裡實測過，
Fable 也獨立複驗了一次）。可用 `// top-filter-ok: 理由` 標註豁免。

### ⚠ 踩到的坑
`test-v6105-…` 的呼叫點掃描窗口**寫死 6 行**，我在 params 多加兩行註解＋一個欄位，
`label` 就被推出窗口 → 該呼叫點變成「反查不到卡面」、涵蓋率門檻紅燈。
**這不是降門檻能解的**（降門檻＝把守衛弱化）。改成窗口 20 行 ＋ 遇到下一個 `effectKey` 截斷。
⭐ 通則：**靜態掃描的窗口大小是脆弱點**，要嘛用結構化邊界（下一個同型 anchor）截斷，
要嘛給足餘裕；寫死一個小數字遲早被一次無關的格式調整弄紅。

### 守衛
`scripts/test-v6109-peek-typed-filter.mjs`（16 項，HEAD 4 FAIL）：行為端跑兩張 peek 卡驗可勾集合
＋「非能量卡仍看得到」＋「4 張全無能量不卡住」；靜態釘住五張的 filter、中央 prefix 的 subtype 判準、
UI/ai 兩端都接中央 evaluator、下拉 gate regex 匹配 `:TOP_N`；正對照三張純 TOPn 不得被改。

## v6.108 — 選卡防呆：確認前先寫出「你選的是哪張」（DCG_Bear 回報選錯卡）

**玩家回報**：DCG_Bear 在錦標賽 `evt_msb1nw9i_r1_m14`（2026-08-02 00:10 UTC 開賽）說
「第 11 步我要拿的是**祭典會場**，結果卻變成**捕蟲組合**」。

### 我查證的客觀事實（回放 API，不是推測）
T5 log 序列：寶可平板（deck-search #1，resolver 內含 shuffle）→ 進化 → **衝衝鼓**
（deck-search #2，`filter:'Any'` 整副牌庫）→「搜到 1 張卡加入手牌」（私下 log 不顯示卡名）
→ 玩家隨即打出捕蟲組合、開 7 張卻**一張都沒選**。
盤面 diff：**捕蟲組合 牌庫 1→0**、**祭典會場 牌庫 2→2（動都沒動）**、棄牌捕蟲組合 1→2。
⇒ 玩家說的沒錯，他確實拿到了捕蟲組合。

### 但引擎與送出路徑逐項查證都正確（列出來，下次別重查）
- 全程綁 **iid**：`toggleSelection(iid)` → `selectionPicked:Set<string>` → `confirmSelection`
  送 `[...selectionPicked]` → server `TENG.applyAction` 用**自己的盤面** → `sanitizeSelectedIids`
  （deck-search 只做 zone 成員／去重／validIids 交集／maxCount 夾取，不換卡）→ resolver
  `search-generic-to-hand-private` 的 `deck.filter(c => iids.includes(c.iid))`。**無一處用 index。**
- **iid 零碰撞**：掃 11 個快照、雙方 hand/deck/discard/prizes/active/bench，無重複。
- **錦標賽 client 完全不跑本地 `applyAction`**（`+page.svelte` 的 `dispatch` 對 isTournament
  直接 return），client 不會自己 shuffle ⇒ 玩家看到的順序＝伺服器順序，不存在錯位窗口。
- **不是 v6.101 的 `retryImg`**：那個 action 是比賽後 2.5 小時（02:40 UTC）才上線的。
- `pool` 是 `$state` 且整包替換；`getCard` 無快取；`getCard` 回 undefined 時是**整格不渲染**
  （`{#if c}`），不會「用別張的圖配這張的 iid」。
- 手機直式版**沒有第二份 picker**（`MobilePortraitBattle` 明文把 modal 交給 `+page.svelte`）。
⇒ 找不到任何「顯示 A、實得 B」的成立路徑。**沒有為了交差發明 bug。**

### 最可能的成因（Wilson 裁定做防呆，不動引擎）
單選 picker 的 **v2.86「maxCount===1 時點另一張會靜默換掉選取」** ＋ 整副牌庫 17 張小卡圖
亂序平鋪 ＋ **確認前全程不顯示所選卡名**（提示列只寫「已選 1」、按鈕只寫「確定（1張）」）
＋ 衝衝鼓是**私下**搜尋（log 不寫卡名，第一個發現點是手牌）。

### 本版做的（Wilson 選「顯示卡名＋加穩定 key」，不加二次確認）
1. **中央 `selectedCardNames` / `selectedNamesLabel`**（單一來源）。⚠ 提示列與確認鈕**兩個
   消費點各接一次**——記憶教訓 v6.088/6.098：中央述詞寫好 ≠ 消費點有接，且要拆「判定端」
   與「動作端」各問一次。守衛就是照這個拆的。
2. 提示列：`已選 1：《祭典會場》`；確定鈕：`確定 《祭典會場》`（>3 張時退回顯示張數，避免爆版）。
3. **四處 `{#each selectionItems as item}` 補 `(item.iid)` key**。本案雖非根因，但 v6.101 已
   證實非 keyed 節點重用會咬人（action 內部狀態殘留），一次消滅這一族群。
4. 守衛 `test-v6108-selection-name-confirm.mjs`（8 項，HEAD 6 FAIL）：key 全覆蓋（含正對照）、
   卡名只能用 iid 比對、兩個消費點各一條、禁退回舊寫法、**卡名不得流進 addLog/dispatch**
   （避免防呆反而洩漏對手看不到的私下搜尋內容）。

### ⭐⭐ Fable 5 審查抓到的兩個回歸（我查證屬實，已修）
1. **concealed picker 會洩漏對手蓋牌的卡名 —— 公平性 bug，比原本要修的問題還嚴重。**
   `params.concealed:true` 的效果（功夫鼬／滑滑小子｜拍落、太陽伊布ex｜精神出局／咬棄、
   貓貓｜占為己有）卡面是「**在不看正面的情況下**選擇」，UI 顯示卡背 + `???`。
   我的新提示列會把 `getCard(cardId).name` 印出來 ⇒ 玩家可**逐張 toggle 讀卡名，
   把對手整副手牌掃一遍**再決定丟哪張，等於把防呆做成作弊工具。
   修：`selectedCardNames` 開頭 `if (params?.concealed === true) return []`。
   ⚠ 原本守衛的「不得流進 addLog/dispatch」那條**抓不到這個洩漏**（假綠），已單獨釘一條 + 正對照。
   ⭐ 通則：**任何「把內部資料顯示給玩家看」的新 UI，都要先問一次「這個 picker 的卡面
   有沒有說玩家不該看到」** —— 顯示層的洩漏和 log 洩漏是兩個不同的維度。
   （公平性修正，依鐵律不寫首頁 changelog。）
2. **keyed each 撞到重複 key 會 throw、整個對戰頁白屏**（prod 也會，v5.606 已被咬過一次）。
   正常盤面 iid 唯一，但版本 skew／引擎瞬時異常都可能造成。已在 `selectionItems` 出口套
   既有的 `dedupeByIid`（單點護住四個 each），fail 模式從「白屏」降回「少顯示一張」。
   ⚠ 順帶：`selectionItems` 拆成 `selectionItemsRaw`(原邏輯) + `selectionItems`(dedupe 出口)，
   並把 `selectedCardNames` 移到宣告之後 —— `$derived` 雖然惰性不會踩 TDZ，但別留這種地雷。

### 附帶收益
keyed each 讓 DOM 節點身分跟著 iid 走 ⇒ `use:retryImg` 那類「action 內部狀態殘留在被重用的
節點上」的錯位（v6.101）在這四個清單裡從根本上不會再發生。

### Fable 確認不需要改的（省得下次再想）
- 確定鈕的動詞是中性的「確定」，動作語意由 `selectionTitle` 承擔（v3.62 起已中性化），
  在「丟棄／放回牌庫／移除能量」型 picker 讀起來仍正確。
- 觀戰／回放看不到這個 modal（`myPlayerIndex === null` 三個分支全 false，v2.196 的隱私 gate）。
- `selectionPicked` 全部寫入點都是 `= new Set(...)` 整包替換（零筆 `.add/.delete/.clear`），
  `$derived` 一定會重跑 ⇒ 卡名會即時更新。

### 下次遇到同型回報的查法（省時間）
`GET /api/tournament/replay?matchId=<id>` → 比對**該回合前後的牌庫組成 diff**，
比讀 log 快也準（私下搜尋的 log 本來就不寫卡名）。

## v6.107 — 休閒線上「閒置自動判負」（玩家回報：掛機十分鐘沒結果）

**玩家回報**：一般（休閒）對戰「遇到很多那種掛機的人，右上角時間過了大概十分鐘都沒有什麼結果
就這樣給它掛著。不是有限定閒置時間直接判敗嗎？」Wilson 指名由 Fable 5 找根因（此問題反覆發生、
多次修過沒根治）。

### 三個各自獨立、都足以單獨致死的斷點（Fable 找出，我逐一查證屬實）
1. **休閒原本只有「手動宣告」制**，沒有伺服器自動判負；錦標賽才有（`server_admin_patch.js` 的賽事迴圈）。
   玩家把錦標賽的功能誤以為全站通用。他說的「右上角時間」其實是**對戰經過時間**計時器（v4.24），
   閒置倒數 UI 第一行就是 `if (!isTournament …) return null` —— 休閒根本沒有倒數。
2. **宣告按鈕只渲染在桌機版面**：banner 與確認視窗都寫在
   `+page.svelte` 的 `{#if isPortraitMobile}…{:else}…{/if}` 的桌機那一半，
   `MobilePortraitBattle.svelte` 搜「棄權/forfeit/inactiv」**零命中**。
   計時邏輯照跑、`oppInactivityWarn` 照樣變 true，但**沒有任何 UI 消費它** ——
   ⭐ 與 v6.098「黃框會亮但按鈕不存在」完全同型。
3. **房間會被伺服器整個刪掉**（最致命，也是「修了很多次還是沒用」的結構性原因）：
   - `startZombieRoomCleanup`：`status='playing'` 且 5 分鐘沒寫入 → `deleteMany` 整房。
   - `+page.svelte:5583`：**對戰中不送心跳**（v2.83 為避免與 pushGameState race）。
     那段註解假設「playing 房一定有人在 push」—— 但「對手掛機、我在等」時**雙方都零寫入**。
   - 時間線（預設 3 分鐘）：T0 對手最後動作 → T0+3min banner 出現 → **T0+5~7min 房被刪** →
     `claimOpponentForfeit` 讀不到房 → throw → 回 false → 前端把 false 一律顯示成
     「**對手其實已經行動了，現在輪到你！**」。沒有人被判勝負，掛機者零代價。
   - 房主還能把門檻設到 5 分鐘 ＝ banner 出現的瞬間房剛好被刪。

### Wilson 的裁定（AskUserQuestion）
- 處置方式：**伺服器自動判負**（不是只修手動按鈕）
- 門檻：**沿用房主設定**（60~300 秒，預設 180）

### 修法
**伺服器端**（`oracle-admin/server_admin_patch.js` v1.03）
- 新增 `startCasualIdleForfeit()`，放在**錦標賽 IIFE 內**——那裡才拿得到 `currentActorSeat` 與 `db`。
- ⭐ **中央收斂：判「現在該誰動作」直接複用錦標賽的 `currentActorSeat`**。那個函式已被
  v0.60/v0.62/v0.67/v0.74/v6.053 **五次事故**淬鍊過，正確處理 setup／mulligan 不對稱／
  互動式開局（閃焰王牌）各子階段。休閒的舊判定（前端 `_waitingOnOpp`）從未跟上這些修正 ——
  **這就是「開局掛機完全無解」的真正原因**（Fable 用真 engine 重現了 3 種盤面）。
  ⚠ 絕對不要在休閒端另寫一份判定，那是新一輪漂移的起點。
- 每 30 秒掃一次；門檻＝`idleTimeoutSec`（clamp 60~300）＋15 秒緩衝；
  `actor` 為 -1（雙方都欠動作）或 null（判不出）→ **不判**；
  判負只把房寫成 `game-over` + `status:'ended'`（**不刪房**，玩家看得到結果）。
- **樂觀鎖**：`updateOne({ _id, updatedAt: room.updatedAt, status:'playing' })` ——
  這一輪讀到之後對方若剛好動作了，更新不會命中，下一輪用新的 updatedAt 重算，不會誤判邊緣行動者。
- `PLAYING_STALE_MS` 5 分鐘 → **20 分鐘**：讓判負先收場，刪房只負責清「連判都判不出來」的真殭屍。

**前端**：banner + 確認視窗整段移出版面分支 ⇒ 手機／桌機共用同一份（H-1）。

### 守衛 `scripts/test-v6107-casual-idle-forfeit.mjs`（16 項，HEAD 7 FAIL）
- ① 從 patch 抽出**真的** `currentActorSeat` 跑 setup 各子階段（A 重抽不對稱／B 欠揭示確認／
  B2 欠補抽／C 互動式開局／D 雙方都欠→-1／E 對戰中／F game-over→null）。
- ② 靜態斷言休閒判負**必須呼叫 `currentActorSeat`**、有 -1/null 保護、寫 ended 不刪房、讀 idleTimeoutSec。
  ⚠ 錨點要用 `(function startCasualIdleForfeit()` —— 用名字 indexOf 會抓到別處註解裡的提及 → 假 FAIL。
- ③ `PLAYING_STALE_MS` 必須 > 判負門檻上限。
- ④ banner/modal 不得回到版面分支內（含正對照）。

### ⭐⭐ Fable 5 審查抓到的致命點：休閒房版本欄位是 `_version` 不是 `version`
我第一版寫 `version: (room.version||1)+1`（那是**錦標賽 TROOMS** 的欄位名），`names` 同樣是錦標賽欄位。
休閒房用 `_version`（`oracle-client.ts` 的 `oraclePollRoom` **只在 `room._version !== lastVersion` 才回呼**，
且 server 對 `?since=_version` 相同時直接回 204 無 body）。後果三連：
① 勝方在正常輪詢路徑上**永遠收不到判負**（只能靠 v5.360 那個 8 秒卡住自癒 resubscribe 僥倖搭便車）；
② 敗方分頁完全收不到，畫面停在 playing；
③ 掛機者醒來時用**舊 `_version`** 當 expectedVersion 的 PUT 會把 game-over + ended **整包蓋回 playing**
（我的 `updatedAt` 樂觀鎖只保護 sweep 不蓋別人，保護不了別人不蓋 sweep）。
⭐ **通則：跨子系統複用程式碼時，欄位名契約要逐一查證** —— 我把判負函式放進錦標賽 IIFE 以複用
`currentActorSeat`（正確決定），卻連帶把錦標賽的**資料欄位名**也一起抄了進來。
⭐⭐ **16 項守衛當時全綠** —— 綠燈完全沒有反映「玩家看不看得到」。已補兩項：
釘 `_version` bump ＋ 樂觀鎖比對 ＋ 禁 `version:`/`room.names`；另加**正對照**斷言
`oracle-client.ts` 確實只認 `_version` 變化（那個契約若改了，判負送達會再次靜默失效）。

### 其他順手項（Fable 指出）
- `[zombie-cleanup]` 啟動 log 文案還印「playing>5min」→ 改 v0.4「playing>20min」，否則部署後看 log 會被誤導。
- 錦標賽 IIFE 的 catch 訊息寫「正常對戰/admin 不受影響」——休閒判負現在住在裡面，這句已不成立 → 補上警語。
- 判負啟動時 console.log 一行，部署後可用 log 確認它活著。
- 確認 modal 硬寫「對手已 **3 分鐘**無回應」與可調門檻不符 → 改讀 `idleTimeoutSec`。

### 已知小窗（不修，記錄）
- 練習模式 undoRequest／restart／return-to-room 提案 pending 時，**提案者本身是 actor**，
  對手不回應會判提案者敗。舊的手動宣告制同樣存在此窗（等回應的 actor 也按不了宣告鈕），發生率低。
- actor=-1/null 的真殭屍房（雙方都掉線）會在大廳「進行中」多掛 15 分鐘。

### ⚠⚠ 測試站無法驗證這個功能
`deploy.yml` **沒有設 `VITE_BACKEND_MODE`** ⇒ GitHub Pages 測試站的休閒房走 **Firestore**，
VM 的 sweep 摸不到（測試站也因此沒有殭屍刪房問題）。**只有正式站（Oracle 模式）會生效。**
回報的玩家若在測試站，這版對他無效 —— 下次要先確認玩家在哪一站。

### ⚠ 部署
伺服器端改動**必須跑 `update-tournament.bat`**（＋ `update-admin-full.bat`）才生效，
否則正式站的休閒房仍是舊行為（沒有自動判負、5 分鐘刪房）。

## v6.106 — 首頁更新記錄再精簡（Wilson 交辦）＋ 建立本內部檔

**Wilson 原話**：「首頁的 changelog 還是寫得太長了，請讓內容簡單明瞭，只要讓玩家知道他們需要知道的
事情就好，事情的來龍去脈和伺服器、程式相關的內容不用跟玩家他們解釋那麼多」「細部的 changelog
只要在後台紀錄，方便你查閱就好」。

**他選的規格**（AskUserQuestion）：
- 首頁每則＝「**一句話＋必要提醒**」，約 40~80 字。
- 細部紀錄放 **repo 內部檔案**（不是 admin 後台、也不是只靠 commit 訊息）。

**做法**
- `static/changelog.html` 50 則全部重寫：10,728 字 → **3,733 字**（-65%），檔案 35.8KB → 15.3KB，
  每則中位數 197 → 75 字、最長 515 → 123 字。
- 保留不刪的東西（這幾類砍掉會害到玩家）：① 需要玩家自己動手的指示（例如「請重新匯出一次」、
  `?opening=0`）② 生效範圍限制（只在手機／只在電腦／哪些模式不受影響）③ 卡面規則裁定與 ⚠ 反向提醒
  （例如「以任意方式」型不受影響、監視之眼擋的是效果不是特性）。
- 本檔（`docs/changelog-internal.md`）建立，把當時首頁的完整詳細版整份搬進來當基準。

**守衛** `scripts/test-changelog-size-and-archive.mjs` 從 7 項擴到 11 項：
每則 ≤150 字、合計 ≤5000 字、內部檔存在、內部檔純文字量必須 > 首頁的 2 倍
（⚠ 比**純文字**不是檔案大小 —— 首頁是 HTML，標籤本身就佔一堆字元會失真）。

⚠ **日後出版本的流程**：先在本檔寫詳細版（根因、卡面查證、機制名、部署注意事項），
再把「玩家需要知道的那一兩句」放進 `static/changelog.html`，並把最舊一則搬進
`static/changelog-archive.html` 維持 50 則。

## v6.105 — **修正「火伊布ex｜燃燒充能」可以把 2 張能量分給不同寶可夢**

卡面是「從自己的牌庫選擇最多2張基本能量卡，附於自己的**1隻**寶可夢身上」—— 兩張必須附給**同一隻**，但之前會讓你逐張挑目標、可以拆開分給兩隻。
現在改成選完能量後選 1 隻，全部附上去。
⚠ 卡面寫「**以任意方式**附於自己的寶可夢」的招式（哼唱充能、閃焰渦輪、能量之禮…）不受影響，那類本來就可以分散。
▸另修「阿響的鳳王ex｜金色火焰」：備戰區**只有 1 隻**「阿響的」寶可夢時，附能不會觸發對手的反應效果（例如帕奇利茲｜麻痺門牙的傷害指示物）；備戰 2 隻以上時則正常。現在兩種情況一致。

## v6.104 — **「火箭隊的超級球」與「賽吉」現在可以選擇不拿**

這兩張卡是從**整副牌庫**搜尋，官方規則允許玩家宣告「找不到」；但先前只要牌庫裡真的有符合的卡，系統就會強迫你一定要選一張。
現在牌庫有沒有候選都會出現【不選】，和其他牌庫搜尋卡一致。
⚠ **查看牌庫上方 N 張**那類（女服務生、超級烈空坐ex｜霸者咆哮）不受影響 —— 那 N 張已經攤開給你看了，卡面寫「選擇1張」就是必選。

## v6.103 — **修正「吼叫尾ex｜絕叫」與「甜甜螢｜慢芬香」完全打不出來**

這兩招的卡面都是「這個招式只可在**後攻玩家的最初回合**使用」，但實際上**連後攻方的第一個回合也用不了** —— 招式按鈕是灰的，硬送出去也會被擋掉，等於這兩張卡的招式從來沒有能用過。
現在後攻方的第一個回合可以正常使用；先攻方、以及後攻方第二回合之後仍照卡面擋下。

## v6.101 — **卡圖沒載出來會自動重新載入 ＋ 修正「傳說」場地卡匯出官網代碼**

**①手牌／場上偶爾有幾張卡圖是空白的**（手機上特別明顯，往往要再操作幾步或過幾回合才會突然出現）。原因是卡圖是向官方網站取得的大圖，訊號不穩時會載入失敗，而失敗之後瀏覽器不會自己再試一次。
現在載入失敗會**自動重試最多 4 次**（間隔 1 秒、3 秒、8 秒、20 秒），中間兩次改走**體積小很多的縮圖**（弱網下成功機率高得多），最後一次再回頭試官方原圖；**網路恢復或切回遊戲畫面時也會立刻再試一次**，訊號恢復後重試次數會重新計算。還沒載出來的位置會顯示深色外框與卡名，讓你知道是圖還在載、不是卡片有問題（不會顯示成卡背，以免和未揭曉的牌搞混）。對戰、牌組編輯器、卡牌資料庫全部適用。
**②「傳說的海溝／山頂／熔岩洞」匯出成官網牌組代碼**：這三張在官方是**兩張合用一個編號**，本站為了左右半各自能出牌而分成兩張，匯出時右半會送出官網查不到的編號 ——**官網不會報錯，但拿到的代碼打開後那幾張是壞的**。現在匯出前會自動合併回官方那一個編號（1 套＝2 張，佔 60 張上限裡的 2 格），從官網代碼匯入時也會自動還原成左右兩半。
⚠ 建議把之前匯出過、含這三張場地卡的官網代碼**重新匯出一次**。

## v6.100 — **更新記錄精簡：首頁只顯示最近 50 次更新，敘述改成只講「你會看到什麼變化」**

更新記錄累積到 228 則、每次進站都要整份載入，內容裡也有不少偏程式面的說明。這一版做了兩件事：
▸**首頁只顯示最近 50 次更新**（載入量從 173KB 降到約 33KB），更早的紀錄移到**完整更新歷史**頁面，最下方有連結可以查看，一則都沒有刪掉。
▸保留的 50 則**逐則重寫**，只講這次改了什麼、你會看到什麼差別，拿掉那些偏技術性的說明。
另外對玩家完全沒有影響的版本（例如診斷版、當時的緊急回退）已移到完整歷史，不再佔用首頁版面。

## v6.099 — **手機版：移除兩個按了沒反應的按鈕（超能妙喵｜誘導之尾、火神蛾｜熱浪鱗粉）**

手機版點開手牌的「悠哉尾草棒」或基本【火】能量時，會跳出「棄此卡 → 觸發…」的按鈕，但按下去完全沒有反應。這兩個按鈕已經移除。
**功能沒有損失**：這兩個特性請點**場上那隻超能妙喵／火神蛾**的特性按鈕發動，發動時一樣會自動從手牌丟棄對應的卡。

## v6.098 — **手機版：修正「烈箭鷹ex｜激動俯衝」點開卡片沒有發動按鈕**

手機版場上有【無】屬性的超級進化寶可夢ex（例如超級袋獸ex）時，手牌的烈箭鷹ex 雖然會亮起黃框，但點開卡片只看得到「查看詳情」、找不到發動特性的按鈕。現在會正常出現「⚡ 激動俯衝 (放備戰)」。
電腦版是點卡片直接發動，原本就正常，不受影響。

## v6.097 — **修正「火箭隊的叉字蝠ex｜刺殺迴旋」讓底下的超音蝠／大嘴蝠消失 ＋ 搜尋到的卡現在會顯示卡名**

**①刺殺迴旋**：選擇把自己放回手牌時，**只有最上面的叉字蝠ex回到手牌，疊在底下的火箭隊的超音蝠與大嘴蝠直接從對局中消失了**。現在三張寶可夢卡會一起回到手牌，附加的能量與道具照卡面全部丟棄。
**②搜尋的揭示**：卡面寫「在給對手看過後加入手牌」的招式與物品卡，之前對戰紀錄只寫「挑了 N 張卡」、沒有卡名，對手不知道你拿走了什麼。現在會公開列出卡名，涵蓋熔蟻獸｜舔舔捕捉、扒手貓｜邪惡邀請、小霞的拉普拉斯｜一起游水、夢夢蝕｜夢境呼喚、嗡蝠｜搬運破爛、牙牙｜集力、霜奶仙｜彩色甜點、探探鼠／火箭隊的咩利羊｜籌備、赫普的沙包蛇｜築窩、電飛鼠／青木的姆克兒｜小使者、好啦魷｜籌備、熱帶龍｜果實香氣、銀伴戰獸｜拍檔呼喚、能量輸送PRO，以及從棄牌區取回的能量回收器、差不多娃娃｜招喚、烏波｜打水。
反過來，**頭巾混混｜偷竊**與**賽富豪｜抓到飽**的卡面沒有「給對手看過」，維持不公開卡名（只有自己看得到）。焰后蜥ex｜詭計、白蓬蓬｜微風之禮、希望護身符、桃歹郎｜最後鎖鏈 也一樣改回不公開。

## v6.095 — **「傳說」場地卡在剩下的查看畫面也切成左右兩張**

查看牌庫剩餘全部、翻牌看到的其他張、對手手牌其餘 N 張、高傲指令翻到的 10 張、開局手牌展示與重抽回顧、**翻成正面的獎賞卡**（看回放時六張都會翻正面，最容易看到）、**對手回合的行動面板** —— 這些地方現在都會正確顯示左半或右半，不再是橫圖亂裁的一條或縮得很小。
查看牌庫時同名卡也改成一格一張（不再合併成「×4」），左右半各自佔一格。

## v6.094 — **修正「手上兩張左半也能當成一套放到場上」**

上一版把「傳說」場地卡拆成左右兩張之後，手上拿到**兩張左半也會被當成一左一右**直接放到場上。已修正，左右完全由卡片本身決定。
另外：牌組編輯器右半那一列現在顯示自己那半的圖；用文字匯入牌組會自動排成左右各半，不會一匯入就跳提醒；錦標賽報名存下的牌組與已開好的線上房間，即使是拆卡前的舊格式也會自動轉換。

## v6.093 — **「傳說」場地卡正式拆成左右兩張獨立的卡片（各有官方編號）**

「傳說的海溝／山頂／熔岩洞」在官方卡表本來就佔兩個編號（例如傳說的山頂是 073/076 和 074/076），現在系統完全比照辦理：
▸牌組編輯器會看到左右兩張、各標自己的編號；按 ＋／－ 時左右一起加減（一次一套），不會留下半張。
▸牌組檢查改成「左右張數必須相同」。上限不變 —— 左右**合計最多 4 張**（＝2 套）。
▸放到場上仍要手上同時有左半和右半，放上去時兩張一起離手。
▸**已存好的牌組會自動轉換**（4 張 → 左 2 ＋ 右 2），你不用做任何事。若舊資料是奇數張，會轉成例如左 2 ＋ 右 1，牌組檢查會提醒你補齊 —— 我們不會擅自幫你改張數。

## v6.092 — **修正牌組編輯器縮圖擠爛 ＋ 手機版回放手牌也切半**

牌組清單的「傳說」場地卡縮圖會被壓成細長條或溢出去蓋到卡名，已改回固定顯示左半（張數由右邊的計數器顯示）。
另外補上手機版**回放**時的手牌切半 —— 電腦版已經有了，手機版漏掉。

## v6.091 — **「傳說」場地卡在選擇盤、棄牌區、牌組編輯器也切成左右兩張 ＋ 霸者咆哮改成必選**

**①切半顯示擴到全站**：選擇卡片的視窗、棄牌區（電腦版與手機版）、牌組編輯器都會切成左右兩張個別顯示，不再擠成一張看不清楚的橫圖。棄牌區裡左右半各佔一格（不再合併成「×2」）。
**②「超級烈空坐ex｜霸者咆哮」改成必選**：卡面是「從其中**選擇1張**基本能量卡」，沒有「最多」兩個字，而且那 4 張已經給你看過了。現在只要 4 張裡有基本能量就必須選 1 張（完全沒有基本能量時仍可直接關閉）。

## v6.090 — **「傳說」場地卡改成左右各是一張卡片，要湊到一左一右才能放到場上**

之前左右是靠畫面上的排列順序算出來的，所以洗牌、抽牌之後左右還會互換。現在**每一張實體卡從建牌組時就帶著自己的左右身分**，不管洗牌、抽到手上、丟到棄牌區、再洗回牌庫，永遠是同一半。
**打出條件也跟著改**：必須手上同時有左半和右半才能放到場上；兩張都是左半（或都是右半）不會亮框、也打不出去。放上場時系統會自動挑走另外那一半，兩張一起離手。

## v6.089 — **5 張打出後「完全沒有效果」的訓練家，現在不會再白白消耗掉**

把全站現役訓練家卡逐張對照卡面掃過一遍，找出「在某些盤面下打出去必定 0 效果、卻照樣消耗掉一張手牌（支援者還會用掉該回合唯一的支援者權）」的卡。以下 5 張在那些盤面下會變成不可打出（不亮框、點了也不會出牌）：
▸**鏽蝕組手下**：卡面寫「必須在上個對手的回合自己的寶可夢昏厥了才可使用」；另外對手場上完全沒有能量時也丟不了。
▸**AZ的平和**：備戰區沒有寶可夢時，互換不可能發生。
▸**古歷**：雙方場上所有寶可夢都滿血時，恢復 50HP 沒有意義。
▸**艾莉絲的鬥志**：卡面要求丟 1 張手牌，手牌只剩這張時付不出代價。
▸**枇琶**：對手手牌 0 張時，連要查看的手牌都沒有。
判斷條件全部只用雙方都看得到的公開資訊，不會洩漏任何隱藏情報。「抽到手牌滿 N 張」與「從牌庫搜尋」這兩類即使抽 0 張、搜不到目標也維持可以打出。

## v6.088 — **修正：傳說的熔岩洞沒有真的消除特性 ＋ 庫瑟洛斯奇的企圖在對手手牌 ≤3 張時仍可打出**

**①傳說的熔岩洞**卡面是「雙方場上所有進化寶可夢的特性全部消除」，但你主動點特性這條路徑漏了判斷 —— 場上放了熔岩洞，多龍奇的「偵查指令」照樣按得下去。已修正，其他消除來源（暗夜羽擊、黏著束縛、監視之眼等）在這條路徑上的漏洞也一併補起來。對手打出的熔岩洞同樣會消除你的進化寶可夢特性（卡面寫的是「雙方場上」）。
**②庫瑟洛斯奇的企圖**卡面是「對手丟棄手牌直到變為 3 張為止」，對手手牌本來就 ≤3 張時打出完全沒效果卻會白白消耗一張卡和支援者權。現在這種盤面下不會亮框、也打不出去。

## v6.087 — **傳說競技場：手牌顯示成兩張直立的卡**

官方對這三張場地只提供一張左右並排的合併卡圖，之前手牌會直接顯示那張橫的圖。現在手牌裡的兩張各自顯示左半／右半，看起來就跟其他卡一樣是正常的直式卡；放到場地區之後仍是合併後的樣子。電腦版與手機版都已套用。

## v6.084 — **🎉 M6「綠寶石風暴」全卡實裝完成 —— 三張「傳說」競技場開放使用**

傳說的海溝／山頂／熔岩洞是由兩張實體卡合成一個場地的新形式，現已可在對戰中使用：手牌必須同時有兩張才能放置，放上場後兩張一起佔用場地區，離場時也兩張一起進棄牌區。
三個場地效果：**海溝**＝雙方所有寶可夢恢復的 HP ×2；**山頂**＝雙方【無】寶可夢被對手招式擊倒時對方少拿 1 張獎賞；**熔岩洞**＝雙方場上所有進化寶可夢的特性全部消除。
連動三卡同步開放：蓋歐卡「狂暴漩渦」、固拉多「狂暴大地」、小楓與小南的修行。

## v6.083 — **修正：選能量／選手牌的視窗按「不丟」「不給對手看」，反而被當成全丟／全展示**

攻擊前的選擇視窗按下「不丟（0 傷害）」或「不給對手看（0 傷害）」時：
・**變隱龍「鮮豔鞭打」／雙劍鞘「劍武備」**：明明選擇不展示，卻把手牌中全部符合的卡強制公開給對手看（等於被迫洩底）。
・**電擊魔獸「電壓錘」**與同機制的既有卡（固拉多「熔岩光芒」、巨鉗螳螂ex「十字破壞」等）：按「不丟」反而把身上能量全部丟光。
已修正。另外：超級烈空坐ex「霸者咆哮」改為每隻各 1 次（卡面綁的是「這張卡放到備戰區時」，不是每回合）；鴨嘴炎獸「拍檔提升」的選能量上限改為依實際屬性數。

## v6.081 — **M6 能量加速特性 3 個 ＋ 超級烈空坐帽子**

**鴨嘴炎獸「拍檔提升」**：每回合 1 次，從手牌選基本【火】與基本【雷】能量最多各 1 張，附於自己的「電擊魔獸」或「鴨嘴炎獸」（可分開附給不同隻）。
**杖尾鱗甲龍「鱗片律動」**：每回合 1 次，查看牌庫上方 6 張，選任意數量基本能量附於自己的【龍】寶可夢，其餘洗回。
**超級烈空坐ex「霸者咆哮」**：從手牌放到備戰區時可用 1 次，查看牌庫上方 4 張選 1 張基本能量附於自己。
**超級烈空坐帽子**（寶可夢道具）：附有它的寶可夢可以使用招式「德爾塔之禮」—— 從牌庫附給自己所有身上附有這張卡的寶可夢各 1 張基本能量。

## v6.080 — **M6 特性 2 個 ＋ 修正手牌特性在備戰上限 6～8 時不亮**

**超級泥偶巨人ex「啟動限制」**：只有自己手牌 10 張以上時這隻寶可夢才可使用招式。
**烈箭鷹ex「激動俯衝」**：手牌有這張卡、且自己場上有【無】屬性的超級進化寶可夢【ex】時，每回合 1 次可直接把它從手牌放到備戰區。
**修正齒輪怪「緊急迴轉」**：場上有零之大空洞（備戰上限 6～8）時，手牌的卡不會亮起來、點了也沒反應，已修正。

## v6.079 — **M6 招式 2 招 ＋ 修正雙劍鞘「劍武備」**

**電擊魔獸「電壓錘」**：丟棄自己身上任意數量基本能量，張數×60（特殊能量不可選也不計）。
**變隱龍「鮮豔鞭打」**：從手牌將任意數量寶可夢卡給對手看過後，屬性種類數×30（3 張【草】只算 1 種；卡片不會離開手牌）。
**修正雙劍鞘「劍武備」**：原本會自動把手牌裡全部符合的卡都展示出去，沒有少展示的選項。手牌是隱藏資訊、展示幾張是有意義的決策，現改為由你自行勾選。

## v6.078 — **M6 招式 5 招**

**蟲蟲恐慌**（雨翅蛾／三蜜蜂／圓絲蛛）：牌庫下方 7 張翻正面，其中持有「蟲蟲恐慌」的寶可夢張數×50；翻開的寶可夢洗回牌庫、其餘丟棄（與 M5 燒火蚣互相計數）。
**穿山鼠「覺醒」**：從牌庫選 1 張從穿山鼠進化而來的卡當場進化（傷害、能量、道具全部保留）。
**勾魂眼「引誘出來」**：對手牌庫上方 5 張翻正面，選任意數量【基礎】寶可夢放到對手備戰區。

## v6.076 — **修正：大力鱷（SV-P 特典卡）被標成 1 階進化**

同一張大力鱷在其他三個卡包都是 2 階，只有 SV-P 特典卡那張標錯，已更正（進化來源本來就是藍鱷，不受影響）。

## v6.074 — **修正：超級進化寶可夢【ex】的進化來源錯誤（進化不出來）**

M6 三張超級進化 ex 的進化來源抓錯，導致牌組裡放了正確的前一階也進化不出來 —— **超級具甲武者ex** 應從膽小蟲、**超級泥偶巨人ex** 應從泥偶小人、**超級烏賊王ex** 應從好啦魷。
同一類問題全站掃過一輪，另修正**阿羅拉 嘎啦嘎啦**應從卡拉卡拉進化。

## v6.073 — **M6「希嘉娜的信賴」實裝**

將自己的戰鬥寶可夢與備戰寶可夢互換，然後選 1 個換下去那隻身上的能量，改附於新的戰鬥寶可夢（換下的沒有能量時就只互換）。

## v6.072 — **修正：寶可夢道具「無法附加時仍可打出」＋ M6 訓練家 4 張**

**道具修正**：場上所有寶可夢都已經附了道具（沒有可附加的對象）時，道具卡原本仍會亮起可打出，打出後只顯示「道具回到手牌」、盤面完全沒有變化。現在這種盤面下不可打出。
**新實裝**：美味飯糰（回 30 HP，棄牌區每有 1 張**「美味飯糰」**再 +30，這張卡本身不計）、冒險提燈（牌庫找基本【火】與基本【雷】能量各 1 張）、基利（牌庫找支援者與競技場合計最多 3 張）、訂製背心（受對手超級進化ex 招式傷害 −60；持有者自己是超級進化ex 時不生效）。

## v6.071 — **M6 招式：化身團結 ＋ 綠寶石風暴 ＋ 母親的誘引**

**化身團結**（龍捲雲／雷電雲／土地雲／眷戀雲）：四種都在自己場上時，使用招式所需的【無】能量全部消除。
**超級烈空坐ex「綠寶石風暴」**：自己場上【火】與【雷】能量的數量×50。
**尼多后「母親的誘引」**：每回合 1 次，擲幣正面則把對手備戰換上戰鬥場。

## v6.070 — **M6 特性 5 個**

七夕青鳥「棉花搬運」（自己所有【基礎】寶可夢撤退 0）、膽小蟲「懦弱」（對手場上有寶可夢【ex】時自己撤退 0）、大鋼蛇「高密度盔甲」（HP 全滿時受招式傷害 −60）、弱丁魚ex「大洋增輝」（在戰鬥場時每回合 1 次回 50 HP）、胖嘟嘟「深海抽出」（抽 1 張，然後可選 1 張手牌放回牌庫下方）。

## v6.069 — **M6 招式 12 招 ＋「能量的數量」計算修正**

**新實裝**：溜溜糖球「增長」、加熱洛托姆ex「再次加熱」、啪嚓海膽「能量粉碎」、龍捲雲「螺旋俯衝」、烈箭鷹ex「鉤爪搜尋」、勾魂眼「不祥之眼」、夢歌仙人掌「懲罰尖刺」、露力麗「蹦蹦充能」、赤面龍「拖出」、巨翅飛魚「掀起波浪」、雷公ex「雷霆纏身」、騎拉帝納「渾沌匍匐」。
**修正（既有卡）**：卡面寫「能量的數量」的招式，原本沒把大竺葵「繁茂」（基本【草】能量各算 2 個）算進去 —— 塗標客「能量塗鴉」、葉伊布ex「綠葉風暴」、霏歐納「能量壓制」、洛托姆「能量短路」、各版「精神強念」、吞食獸「張大嘴」、椰蛋樹「投球時刻」共 8 處已修正。

## v6.068 — **M6 招式 4 招**

鴨嘴火獸「集力」（牌庫找最多 2 張基本能量給對手看過後加手牌）、尼多蘭「尋找朋友」（牌庫找 1 張寶可夢給對手看過後加手牌）、三蜜蜂「憑空消失」（自己連同附加的卡全部回手牌）、阿利多斯「隱密針」（下個對手回合不受【基礎】寶可夢招式的傷害，進化寶可夢仍打得到）。

## v6.067 — **M6 招式 5 招**

電擊獸「呼朋引伴」（牌庫選最多 2 張【基礎】寶可夢放備戰）、卡蒂狗「吼叫」（對手的戰鬥與備戰互換，由對手選上場的那隻）、土地雲「蓋亞粉碎」（丟棄場上的競技場卡）、熔蟻獸「破壞火」（擲幣正面則丟棄對手戰鬥寶可夢 1 個能量）、雷公ex「力量猛攻」（擲幣反面則下個自己的回合無法使用招式）。

## v6.066 — **效果還沒實裝的訓練家卡，現在會直接擋住不讓打出**

不再「打出去卻沒效果、還白白吃掉一張卡和該回合的支援者權」。這些卡在手牌不會亮框，實裝完成後就會自動開放。
日後任何新卡包進了資料庫但效果還沒做，都會自動比照辦理。

## v6.065 — **「在不看正面的情況下，從對手的手牌選擇N張」全面改為由你盲選（共 16 張卡）**

卡面寫的是「**選擇**」—— 攻擊方看著卡背挑位置，這和電腦隨機抽是兩回事：手牌位置是可以推理的資訊（你剛看過對手手牌、或記得他抽牌與回收的順序）。
**丟棄型**：功夫鼬／滑滑小子／酷豹「拍落」、班基拉斯ex「暴君粉碎」、南瓜怪人ex「幽靈之觸」、禿鷹娜ex「禿鷹爪」、火箭隊的鈴鐺響「鈴鈴吵鬧」、超級頭巾混混ex「不法之足」、巨牙鯊「咬棄」、多麗米亞「手部造型」、烈箭鷹特性「穹天狩獵」。
**查看後放回牌庫型**：雪童子／洛托姆／長尾怪手「驚嚇」、墓揚犬「恐怖啃咬」、雙尾怪手特性「使壞之尾」。
太陽伊布ex「精神出局」與火箭隊的喵喵「占為己有」原本就是這樣，維持不變。
⚠多麗米亞「手部造型」卡面只寫「不看正面」沒寫「選擇」，經裁定同樣由使用招式的玩家盲選。

## v6.063 — **M6 招式 3 招**

加熱洛托姆ex「強力閃焰」（打完丟棄自己身上 2 個能量）、好啦魷「拍落」、阿利多斯「劇痛毒」（中毒，且因這個中毒放置的傷害指示物改為 4 個）。

## v6.062 — **M6 招式 8 招**

赫拉克羅斯「扣殺抽出」（抽 2 張）、巨翅飛魚「泡沫吸取」（自身回 30 HP）、煤炭龜「烈焰爆」（下個自己的回合無法使用這一招）、雷電雲「雷電刀鋒」（傷害不計對手身上的附加效果）、大鋼蛇「重重橫掃」（傷害不計抵抗力）、穿山王「挖洞爪」（丟棄對手牌庫上方 1 張）、青綿鳥「雀躍」（與備戰互換）、電海燕「高速移動」（擲幣正面則下個對手回合不受招式的傷害與效果影響）。

## v6.061 — **M6 招式 12 招 ＋ 修正自爆磁怪「衝天電光」多算 120 點**

**條件加傷**：蜂女王「俐落一擊」（對手為進化 +80）、超級具甲武者ex「致命刺擊」（對手身上有傷害指示物 +160）、風速狗「活力獠牙」（對手剩餘獎賞 ≤4 +90）、眷戀雲「上升之心」（對手為【ex】+100）、刺球仙人掌「擊飛」（擲幣正面 +10）、大電海燕「襲擊」（這回合從電海燕進化 +90）。
**依數量計傷**：引夢貘人「意志統治者」（對手手牌×20）、超級烏賊王ex「精神傀儡」（對手備戰數×70）、鱗甲龍「雙重粉碎」（擲2幣，正面×70）。
**指定目標／擲幣**：夢歌仙人掌「直擊彈」、摩托蜥「突圍」、小箭雀「偷襲」。
**修正**自爆磁怪「衝天電光」：用【神奇糖果】從小磁怪直接跳級時，明明不是從三合一磁怪進化卻仍多算 120 點（50 誤判成 170），已改成只看實際的進化來源。

## v6.060 — **M6 招式 11 招**

**造成特殊狀態**：煤炭龜「灼燒」、引夢貘人「催眠波動」、圓絲蛛「毒針」、超級烏賊王ex「不祥波動」、電擊魔獸「泰山壓頂」（擲幣正面則麻痺）。
**限制對手**：超級具甲武者ex「四爪控制」與火箭雀「緊抓」（被打到的下個回合無法撤退）、雨翅蛾「恐怖花紋」（被打到的下個回合無法使用招式）。
**限制自己／自我防護**：尼多后「終極衝擊」、大岩蛇「防守壓制」與心鱗寶「硬頭」（下個對手的回合受到招式傷害 −30）。

## v6.059 — **新增 M6「綠寶石風暴」共 73 張卡進入卡牌資料庫**

（2026/8/7 發售）現在可以在卡牌圖鑑查詢，也可以組進牌組。卡片效果分批實裝，本版先完成三張自傷型招式：赫拉克羅斯「十萬馬力」、風速狗「熱力衝撞」、超級泥偶巨人ex「巨兵拳」。

## v6.058 — **修正閃焰王牌開局：選擇完成後自己的動作被對手的畫面覆蓋**

做完開局選擇之後把寶可夢放上戰鬥場、或領取重抽補償的牌，這些動作有機會被對手同時傳來的盤面洗掉 —— 放上場的寶可夢退回手牌，或剛領到的補抽被收回**而且不會再發給你**（等於永久少抽）。已修正。

## v6.057 — **【閃焰王牌】的開局選擇正式在線上對戰與錦標賽生效**

起手沒有【基礎】寶可夢、只有閃焰王牌時，會跳出選擇視窗：可以用牠反面朝上放上戰鬥場開局，也可以依官方規則視同沒有基礎寶可夢而重抽手牌（自己的重抽次數 +1、對手因此可以多抽牌）；重抽後若又只抽到牠，會再問一次。
⚠若線上開局遇到任何狀況，開房時在網址最後加上 ?opening=0 即可讓那一局改用舊的處理方式（只有開房的人加才有效）。牌組裡沒有閃焰王牌的對局完全不受影響。

## v6.056 — **修好「線上對戰完全開不了局」**

症狀是雙方都按下準備完成後，永遠停在「⏳ 雙方已準備，遊戲即將開始⋯」。這個問題從 v5.911 起就存在，現已修好，線上對戰恢復正常。
錦標賽不受影響（用的是另一套伺服器），本機雙人與對 AI 也一直正常。

## v6.052 — **起手只有【閃焰王牌】時，現在可以自己選要不要用牠開局**

閃焰王牌的特性寫的是「**則可**將這張卡反面朝上放置於戰鬥場」；依官方問答，起手沒有【基礎】寶可夢、只有牠時，你也可以當作沒有基礎寶可夢而重抽手牌（自己的重抽次數 +1、對手因此可以多抽牌）。
原本一律替你選了「放上去開局」，等於少給一個官方選項，而且會左右雙方的重抽次數。現在會跳出視窗讓你決定；重抽後若又只抽到牠會再問一次。

## v6.050 — **休閒線上對戰：對手回合的音效補齊**

原本只聽得到換回合、擊倒、狀態、拿獎賞、勝負，對手的攻擊、進化、附能量、放卡、使用特性、撤退全都是無聲的（同一場對戰打 AI 有聲音、打線上就沒有）。

## v6.049 — **特性被「消除」時，該寶可夢現在真的算是「沒有特性的寶可夢」**

【火箭隊的監視塔】在場時，【無】寶可夢明明已經沒有特性了，卻還是會被雪妖女「冰冷之帳」放傷害指示物。同一個判斷還用在死神棺「冥府之律」、代歐奇希斯「精神防護」、神聖護符、電蜘蛛「複眼」、厄鬼椪 礎石面具ex「礎石之勢」，一併修正。鐵荊棘ex「初始化」、振翼髮「暗夜羽擊」、海兔獸「黏著束縛」造成的消除同樣適用。
⚠反過來不變：探探鼠「監視之眼」擋的是「傷害指示物改放」這個**效果**，被它擋住的寶可夢仍然是**擁有特性**的寶可夢 —— 冰冷之帳照樣會打它；願增猿「腎上腺腦力」的按鈕也不再消失（特性可以正常發動，只是發動後效果被擋下）。
另外，雪妖女自己的特性若被消除，「冰冷之帳」也不再生效。

## v6.048 — **對戰音效大修**

▸**傷害音只在真的造成傷害時響**：沒有傷害的純效果招式（含被完全擋下、減傷到 0、擲幣全反面）改用柔和音。
▸**昏厥音只在真的昏厥時響**：用土龍節節「逃跑抽出」把自己收回牌庫也會聽到昏厥音，已修；備戰位被擊倒現在也有聲音。
▸**錦標賽中對手的動作**原本幾乎全程無聲，已補齊。
▸**擲硬幣終於有聲音**，正面反面不同音。
▸【麻痺】新增音效；雙重狀態的第二、三個狀態現在也聽得到。
▸修「拿到最後一張獎賞」的勝利號角（原本正常對局中永遠不會響）。
▸撤退不再播洗牌音，改用紙牌落桌音。

## v6.047 — **「化隱」現在也能免疫對手特性造成的費用增加**

阿利多斯「大網」、超級水晶燈火靈ex「咒縛火焰」（對手撤退多花 1 個能量）、陳舊的根狀化石「原始根」（對手【基礎】寶可夢使用招式多花 1 個【無】能量）原本連有「化隱」的寶可夢也照樣加費用，已擋下。
⚠**方向差異**：【薄霧能量】只寫「不會受到對手的寶可夢**使用招式**的效果的影響」，擋不住這類特性效果，也擋不住帝牙海獅「凍結獠牙」的鎖招（依官方問答）。
另修**電燈怪「錯亂閃光」**：對手原本就處於混亂又免疫招式效果時，混亂並沒有被重新施加，混亂自傷卻仍被改成 8 個指示物（80 點），已修正。

## v6.046 — **修正【薄霧能量】等「不受招式效果影響」沒擋下延遲型招式效果**

身上附了【薄霧能量】，仍被迷唇姐「強烈之吻」在下個回合結束時整隻丟棄。同類問題共 12 張受影響：迷唇姐「強烈之吻」、火箭隊的臭泥「浸蝕污泥」、凱羅斯「慢嚼碎」、冰伊布「滲透寒氣」、帕奇利茲「麻痺門牙」、穿山王／沙丘娃／噬沙堡爺「潑沙」、智揮猩「掌握弱點」、冰雪巨龍「冰冷寒氣」、飄香豚「芬香踩踏」、鐵包袱「冷卻噴射」、帕底亞 肯泰羅「障礙踩踏」。
化隱、純樸、皇帝之勢、抵抗之幕、陳舊的背蓋化石等其他來源同樣適用。被擋下時對戰紀錄會顯示是哪一張卡擋的。

## v6.045 — **卡牌資料庫的卡包順序改成「越新越前面」**

原本舊的排在上面、新的要滑到最下面才看得到。現在最上面是「全部卡牌」，接著是 J 標（最新發售的排在最左上），該標的特典卡放在該區塊最後，再往下才是 I 標、H 標。找剛發售的新卡不必再往下捲。

## v6.044 — **首頁與卡牌資料庫的介面調整**

▸不再提供舊版首頁，統一為新版。
▸「🔄 強制更新版本（清快取）」移到首頁最上方，一進站就看得到（畫面顯示不正常或卡在舊版時請點它）。
▸卡牌資料庫手機排版：卡包一列 2 個、卡片一列 3 張，翻動距離少一半以上（電腦版維持原樣）。
▸修正卡片詳情視窗的左右切換鈕與進化鏈按鈕在白底上幾乎看不見的問題。
