# PTCG 實體賽事演練引擎 — AI 交接紀錄

> 最後更新：2026-05-04 (v2.351)
> 正式網址：https://suenz001.github.io/ptcg-tw-sim/game
> 卡牌資料庫：https://suenz001.github.io/ptcg-tw-sim/cards?set=ALL

---

## 工作 SOP

1. **每次工作前先讀本檔**，工作結束後把動作寫回來（更新版本號、記錄變更摘要）。
2. **每次實作新卡片功能前**，先查 `static/cards/` 原始資料或線上卡表確認卡牌內容。
3. **版本號 bump 規則**：小改/bug fix → +0.01；新功能/機制 → +0.1；破壞性變更 → +1。
4. **Build 與 Push**：用兩個獨立 bat 檔分開執行，不要合併（npm run build 視窗會自動關閉）。
5. **每次 push 前確認版本號已更新** (`src/lib/version.ts`)。

---

## 開發規範

### 卡牌實裝
- **G 標卡不實裝**。
- 每次新增效果 resolver 前，先確認是否已有可複用的 helper（`effects/_shared.ts`、`effects.ts`）。
- 新卡一定要想「是否需要 `TRAINER_GUARDS`」防線。guard 回傳 false 時，卡片從 UI 消失、打出前驗證，防止玩家白送卡。
- 寫 `known gap` / `TODO` / `stub` 時，留下「實裝路徑」線索（哪個 field、哪個 handler 要動），讓後續人知道要清這條註解。

### 基礎寶可夢 / Stage 判斷
- **判斷基礎寶可夢**：永遠用 `isBasicPokemonCard(card)`，**禁止** `card.subtype === 'Basic'`。
  - 原因：ex / V / VMAX 等亞種的基礎寶可夢 subtype 不是 'Basic'。
- **判斷 Stage2**：永遠用 `isStage2PokemonCard(card, pool)`，原因同上。
- **判斷 ex**（得 2 張獎賞）：`card.subtype === 'ex'` 或 `name.endsWith('ex')`，兩者皆可。

### 進化鏈資料
- 進化鏈用 `evolvedFromStack: CardInstance[]`（完整 instance，非 cardId 陣列）。
- 所有 KO 處理（engine 正常擊倒 / 中毒 / 灼傷 / snipe resolver）都必須加：
  ```ts
  ...target.evolvedFromStack ?? []   // 進棄牌區
  ```
- 未來新增任何 KO 路徑，必須加這一行。

### HP 計算
- **所有 KO 判定**用 `getEffectiveHP(state, playerIdx, card, pool)`，**禁止**直接讀 `card.hp`。
  - 原因：場上 HP 受各種 PASSIVE 效果影響（夠讚狗 +100、特性加成等）。

### 隱藏資訊規則
- **牌庫內容為隱藏資訊**，禁止用 `regG` 檢查牌庫是否含合法目標（即使有也不能擋出牌）。
- 搜尋動作啟動時，統一使用中性日誌（「從牌庫搜尋 X 卡...」），直到 resolver 完成後才記錄結果。
- **看牌庫前 N 張、看對手手牌** 等效果的展示 UI 不對另一方顯示。

### 線上多人規則
- `RESOLVE_SELECTION`、`setup action` 等 action 必須帶 `senderIdx`，否則 P1/P2 互踩。
- P2（join 方）使用招式或跳過攻擊後，UI 必須立即送出 `END_TURN`，不等 AI scheduler。

### Log 完整性
- 凡是效果「修改特定寶可夢狀態」（附加能量、附加道具、回血、派出上場），log 必須指名目標寶可夢名稱。

### 新卡包發售 SOP
1. 在 `src/lib/cards/regulation.ts` 和 `scripts/regulation.js` 新增 set code → mark 映射（**兩份必須成對修改**）。
2. 在 `scripts/scrape/scrape-all.js` 的 `DEFAULT_SETS` 新增。
3. 在 `scripts/build-sets-index.js` 的 `SET_NAMES` 新增中文名稱。
4. 執行 `node scripts/scrape/scrape-all.js` 爬取。
5. 執行 `node scripts/build-sets-index.js` 重建索引。
- ⚠️ Regulation mark 無法從官網 HTML 抓取，必須用 set code 查表。新卡包要下載第一張卡圖驗證字母。

### 引擎細節
- **先手第 1 回合**判斷：`state.isFirstTurn && aIdx === state.firstPlayerIdx`（`firstPlayerIdx` 由 createGame 固定不變）。
- **Mulligan 簡化版**：目前自動補抽，不詢問對手。若要改回官方版，需加 `pendingMulliganChoice`。
- `SEND_NEW_ACTIVE` 只在 `isOwnTurn`（`sendingIdx === state.activePlayerIndex`）時設 `movedToActiveThisTurn`，對手 KO 後強制換場不算。
- 攻擊方自身的 `damageReduceNextHit`（如 吠/大聲咆哮 後的傷害削減）在傷害計算管線中**不受 `skipDefEffects` 保護**，必須在弱點計算前先行套用。

---

## 待辦事項

### 🔴 高優先（功能缺口）

| 項目 | 說明 | 狀態 |
|---|---|---|
| J 標未實裝卡 | audit 結果：implemented: 184、needs-review: 54、missing: 110（以 P2/P3 為主）；詳見 `docs/reports/j-mark-effects-audit.md` | 進行中 |
| 複雜道具/卡（需深層引擎擴充）| 馬志士的交易、火箭隊的妨礙機器人（對手互動 picker）；招式學習器螢石 / 核心記憶碟（招式注入機制）；手持循環扇（TOOL_ON_DAMAGED 雙段 pending）；壯偉碩木（Stadium 兩階進化）；配樂之笛（peek-opp-deck-top 5） | 暫緩 |

### 🟡 中優先（機制缺陷）

| 項目 | 說明 |
|---|---|
| `PASSIVE_*_NO_STACK` 機制 | 赫普的卡比獸｜大方已用 `processedAbNames` 依特性名去重；後續若遇到其他卡面明寫「不重複」的 PASSIVE 類效果，仍需確認是否能共用此 dedup 或需建立更通用的 no-stack 清單。 |
| `PASSIVE_IMMUNITY` 廣義效果 | 目前只擋傷害；卡面「傷害與效果的影響」應也擋 status / 拔能量等廣義效果。 |
| Ability gate 全面審查 | 目前只確認修了「腎上腺腦力」gate；其餘約 30 個 ability 待逐一驗證是否需要 gate。 |

### ⚪ 低優先（延後）

| 項目 | 說明 |
|---|---|
| 手機橫屏 RWD | 多次迭代未達理想，Leon 決定暫緩。需從 layout 設計重出發。 |
| 線上觀戰 Phase 3 | 抽牌動畫適配 + zoom modal RWD + selection-modal RWD。 |
| `effects.ts` 模組化 | 檔案龐大，已有拆分計畫，但 Leon 尚未核准實作。 |
| Firestore composite index 部署 | 若要恢復 server-side orderBy，需在 production 部署 composite index。 |

---

## 版本歷史

| 版本 | 摘要 |
|---|---|
| v2.351 | 實裝超級火炎獅ex｜吠 + 修復攻擊方自身 damageReduceNextHit 引擎 bug + 修復疾風直撞對手KO後誤觸發 |
| v2.350 | 修復奇跡修正檔限定【超】備戰目標 + 棄牌區寶可夢上場時重置傷害 |
| v2.349 | J 標剩餘 P1 效果批次（沙河馬、章魚桶、超級基格爾德ex、托戈德瑪爾ex 等 8 張）|
| v2.348 | J 標狀態效果批次 |
| v2.347 | J 標備戰傷害批次 |
| v2.346 | J 標簡單效果批次 |
| v2.345 | 修復連續相同結果擲幣文字動畫不重播（coinFlipIdCounter + `{#key}`）|
| v2.341 | 超級袋獸ex 機關槍合擊硬幣動畫順序修正（coinAnimation.ts 抽出 parser）|
| v2.340 | M2/M2a 超級快龍ex + 花舞鳥ex + 超級噴火龍Xex focused batch |
| v2.339 | focused regression tests 全通過（T1 小火馬 / T3 奇諾栗鼠 / T4 炎武王 fix）|
| v2.338 | 小火馬蓄能量實裝 + 力之沙漏改為玩家選擇 |
| v2.337 | 修復 sanityKOSweep getEffectiveHP stuck_loop（進化 iid collision）|
| v2.336 | 修復祭典會場附能量寶可夢特殊狀態免疫與恢復 |
| v2.335 | 修復祭典樂舞 KO 後第 2 次招式 + AI stuck_loop 判定 |
| v2.334 | 稽核 v2.326+ 後清理 previous-model artifacts |
| v2.333 | 修復線上模式 P2 被誤判成 AI 回合 → 攻擊後不自動結束 |
| v2.332 | 修復線上模式 P2 使用招式後未自動結束回合 |
| v2.331 | 修復線上模式「跳過攻擊」未立即結束回合 |
| v2.329 | 修復線上P2 bug + AI pickBestActive effectiveHP + 隱私 bug（3 項）|
| v2.327 | 修復 six_decks.ts shuffle 未匯入（63 場遊戲全部 crash）|
| v2.326 | 修復備戰寶可夢被 sanityKOSweep 誤判擊倒 |
| v2.325 | 隱藏資訊規則全面稽核：移除所有非法 regG；日誌中性化 |
| v2.324 | 龐克練肌/狂挖隱藏資訊修正 + 舊 TS 型別錯誤修復 |
| v2.323 | 實裝蓋諾賽克特 ACE消弭 + 修正神奇糖果進化不觸發特性 |
| v2.321-322 | 隱藏資訊 gate 修正 + Supporter filter 修正 |
| v2.320 | 重構手牌使出/進化特性為互動式提示 (promptPlayAbilities) |
| v2.315-319 | 牌庫搜尋 guard 修復 + iPad 佈局 + playedFromHand 旗標 |
| v2.313-314 | 平板 / 1366x768 橫向佈局 |
| v2.300-312 | 手機版各項 UI 優化、棄牌區、招式淡化、預設牌組調整 |
| v2.261-299 | PTCG 規則審查多波（退化清狀態等）+ 各卡牌實裝批次 |
| v2.200-260 | H/I/J 標卡牌批次實裝（共 30 波以上）|
| v2.100-199 | 引擎核心建設（多人、Arena、能量系統、進化鏈、狀態效果）|
| v2.00-099 | 初始 H 標批次實裝 + 六大預組 + 牌組編輯器 |
| v1.x | 原型期（卡牌資料庫爬取、SvelteKit scaffold、M0-M2 建設）|
