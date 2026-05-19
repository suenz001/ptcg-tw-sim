# M5 深淵之瞳 — 日版搶先 → 繁中正式版 Migration Plan

> 建立日期：2026-05-19（v4.9 完成 M5 合併 J 標當天）
> 觸發時機：當繁體中文台灣版正式發售「深淵之瞳」（暫稱 M5）卡包時
> 預估工作量：邏輯實裝沿用 95%、字串校正 5%

---

## 背景與決策

在 v4.77 ~ v4.9 期間我們完整實裝了 M5「深淵之瞳」日版搶先卡包共 **81 張卡**，包含：

- Phase 1 ~ Phase 8h 全部 deferred 卡處理完畢
- Engine 層擴充：超級進化 ex (Mega-ex) 統一規則、化石機制、重試徽章 pause/resume、護城龍 bench-aura defense、迷唇姐 delayed discard、招式竊賊、光子密碼、豪華炸彈 tool-on-damaged hook 等等
- v4.9 已將 M5 合併到 **J 標** regulation mark，卡牌資料庫 / 牌組編輯器全面通用化

當繁中正式版發售時，**遊戲機制不會改變**，所以引擎層邏輯實裝可以原封不動沿用。唯一需要處理的是「字串對應層」—— 卡名、招式名、特性名、規則文字等翻譯校正。

---

## 可沿用部分（零成本）

以下檔案的邏輯實裝**完全不需要重寫**：

### Engine 層

- `src/lib/game/engine.ts`：M5 相關 ATTACK / RESOLVE_SELECTION / PASSIVE / TOOL hook
- `src/lib/game/effects.ts`：M5 卡所有 ATTACK_PRE / ATTACK_POST / RESOLVERS / PASSIVE_* / TOOL_ON_DAMAGED 註冊
- `src/lib/game/effects/cards/*.ts`：M5 個別卡效果檔
- `src/lib/game/types.ts`：所有為 M5 新加的 flag（retryBadgeUsedThisTurn、coinFlippedThisAttack、immune flags 等）

### 卡片 metadata（無需改動）

- evolvesFrom 進化鏈
- pokemonType / HP / weakness / resistance / retreatCost
- 招式 cost 與 damage 數字
- regulationMark = J（v4.9 已設定，繁中版大概率也是 J 標）

### 已歸檔的設計決策

- 超級進化 ex (Mega-ex) 識別規則：`name.startsWith('超級') && name.endsWith('ex')`
- FOSSIL_ITEM_NAMES Set 內的化石統一機制
- 重試徽章 engine pause/resume 機制（v4.898 設計）
- 護城龍太鼓防壁 bench-aura defense 模式

---

## 需要校正的部分（風險所在）

風險全集中在「字串對應」。以下項目發售日必須逐一 audit：

### 1. 卡名 / 招式名 / 特性名翻譯

**最大踩坑點**。我們已經在 M5 實裝過程踩過好幾輪 —— 海豚寶寶→波普海豚、強顎雞母蟲 pokedex 736、暗黑鈴的「化石除外」實為「惡屬性除外」、化石命名 古老→陳舊 對齊舊版本。繁中正式版很可能再次出現官方翻譯與我們不同的情況。

所有以下位置都要對齊：

- `static/cards/M5.json` 的 `name` / `rulesText` / `attacks[].name` / `ability.name`
- `regA('卡名', ...)` / `regPre('卡名', ...)` / `regPost('卡名', ...)` / `regR('卡名', ...)` 註冊 key
- `RESOLVERS.set('卡名', ...)` / `ATTACK_PRE.set(...)` / `ATTACK_POST.set(...)` Map key
- `PASSIVE_ON_KO.set('特性名', ...)` / `PASSIVE_PREVENT_KO` / `PASSIVE_DAMAGE_REDUCE_COND` Map key
- `TOOL_ON_DAMAGED.set('道具名', ...)` Map key
- `FOSSIL_ITEM_NAMES` Set 內的化石名

### 2. Set code 與 cardId

目前用 `M5.json` + `id: M5-XXX`。繁中正式版的官方 set code 大概率不是 M5（可能是 SV12 之類）。影響：

- 牌組存檔的 cardId 對應（用戶舊牌組會找不到卡）
- 圖片 URL 路徑
- `static/cards/index.json` 的 set entry

**建議策略（二選一）**：

**A. 保留 M5 作為日版歷史紀錄，繁中版另開新檔**
- `static/cards/M5.json` 不動（標記為 archived / JP-preview）
- 新增 `static/cards/SV12.json`（或官方實際 code）
- 在 cardId 層做 alias 表 `M5-001 → SV12-001`
- 牌組存檔讀取時自動 migrate
- 優點：歷史可回溯、舊測試紀錄不失效
- 缺點：兩份卡資料重複

**B. 直接 in-place rename M5 → 新 set code**
- 跑 migration script 把 M5.json → 新 code.json
- engine code 內所有 `M5-XXX` cardId reference 替換
- 牌組存檔做一次性 cardId migration
- 優點：乾淨單一來源
- 缺點：歷史 changelog 提到 M5 的部分仍要保留（不可改），帳面上會有不一致

**推薦 A 方案** —— 歷史保留 + 新表共存更安全。

### 3. 卡片圖片 URL

目前 imageUrl 指向的是 PokemonCard.io 日版圖（或我們暫時自製的譯卡）。繁中版上線時要全換成繁中官圖 —— 可能來自 PTCGTW 官方網站、寶可夢 TCG 中文官網或新管道。

### 4. regulationMark

v4.9 已歸 J 標。**驗證重點**：繁中版上線時官方是否：
- 仍把這彈歸 J 標 → 不動
- 升級到新標籤（例如 K 標） → 需更新 81 張卡 + index.json + 構築 gate

---

## 繁中發售日 SOP

當繁中版實際上線時，按以下步驟處理：

### Phase 1：資料抓取與 diff（半天）

1. 從繁中官方來源抓取「深淵之瞳」完整卡表（JSON 或結構化資料）
2. 寫一支 diff script：
   - 比對 81 張卡的 `name`（卡名）
   - 比對每張卡的 `attacks[].name`（招式名）
   - 比對 `ability.name`（特性名）
   - 比對 `rulesText`（規則 / 描述文字）
3. 產出 `m5_jp_to_tw_rename.json` 對應表，例如：
   ```json
   {
     "海豚寶寶": "波普海豚",
     "古老的根狀化石": "陳舊的根狀化石",
     "...": "..."
   }
   ```
   （此檔案就是 audit 成果，記錄所有需要替換的字串）

### Phase 2：JSON 層替換（1 小時）

寫 Python script 處理 `static/cards/M5.json`（或新 set 檔）：
- 用對應表批次替換 `name` / `rulesText` / `attacks[].name` / `ability.name`
- 保持其他欄位完全不動（HP、cost、damage、type、evolvesFrom 等）

### Phase 3：Engine code 層替換（2 小時）

這是最危險的一步，必須走 **Python pipeline + tsc 雙重驗證**：

1. 寫 Python script 對 `src/lib/game/effects.ts` 與 `src/lib/game/effects/cards/*.ts` 做字串替換
2. 替換目標：
   - `regA('舊卡名', ...)` → `regA('新卡名', ...)`
   - 同理 regPre / regPost / regR / regG
   - `RESOLVERS.set('舊', ...)` → `RESOLVERS.set('新', ...)`
   - PASSIVE_* / TOOL_ON_DAMAGED / ATTACK_PRE / ATTACK_POST Map key
   - FOSSIL_ITEM_NAMES Set 內字串
3. `npx tsc --noEmit -p .` 必須 exit 0
4. 用 grep 確認沒有殘留舊字串（除了 changelog 歷史紀錄）

### Phase 4：cardId / Set code 處理（如有改變）

如選 A 方案（建議）：
- 保留 M5.json 不動，加 archived flag
- 新建 `static/cards/SV12.json`（或新 code）
- 加 cardId alias migration 到 `decks` 載入邏輯

如選 B 方案：
- in-place rename M5 → 新 code
- 牌組存檔 migration helper

### Phase 5：圖片 URL 切換

把所有 imageUrl 從日版圖替換為繁中官圖來源。

### Phase 6：全卡邏輯回歸測試

走完整 81 張卡的招式 / 特性互動測試，確認 key 替換沒有失效。重點測試項目：
- 重試徽章（超級袋獸ex 機關槍合擊測試）
- 化石組（陳舊的頭蓋化石 / 盾牌化石）
- 護城龍太鼓防壁
- 迷唇姐強烈之吻 delayed discard
- 招式竊賊 / 光子密碼
- 豪華炸彈 tool-on-damaged 三 gate

### Phase 7：版本號 + changelog + push

- bump version（例如 v5.0 「M5 繁中版正式對應」）
- 寫 changelog 標註翻譯 audit 結果
- 走 push_v5_0.py 走 Python plumbing pipeline
- 部署完成

---

## 注意事項與踩坑紀錄

1. **絕對不要改歷史 changelog**。v4.77 ~ v4.9 的 changelog 提到「日版搶先」「M5」等字樣全部保留，這是版本回溯的證據。
2. **Iron Rule 11**：M5.json 是大檔案（81 張卡），改動必須走 Python pipeline（json.dumps），不可用 Edit tool 手改。
3. **Iron Rule 4**：每次替換後 tsc 必須 clean。
4. **Iron Rule 1**：changelog 內 `<` `>` `{` `}` 必須 entity escape，避免 vite-plugin-svelte build 失敗。
5. **cardId 不要輕易改**。如果非改不可，必須同時提供 migration helper 處理用戶舊牌組。
6. **官方翻譯可能反直覺**。例：暗黑鈴實際是「惡屬性除外」（不是「化石除外」）；化石用「陳舊的」而非「古老的」前綴。直接信官方文字，不要腦補。
7. **regA 等 helper 的 key 是 case-sensitive 字串比對**，多一個空白、少一個全形字元都會導致整張卡的特性 / 招式失效。替換完一定要 grep 驗證。

---

## 投資報酬率估算

| 項目 | 從零實裝 | 沿用 + 校正 |
|------|---------|-----------|
| Engine 機制設計 | 40 小時 | 0 小時 |
| 81 張卡邏輯實裝 | 30 小時 | 0 小時 |
| 卡名 / 翻譯校正 | — | 4 小時 |
| 圖片 URL 切換 | — | 1 小時 |
| 回歸測試 | 10 小時 | 3 小時 |
| **總計** | **80 小時** | **8 小時** |

**節省 90% 工作量**。當初投入做 81 張卡的邏輯實裝是值得的投資。

---

## 相關檔案參考

- `IRON_RULES.md`：全部鐵律（特別是 Rule 1, 4, 7, 7c, 11）
- `AI_HANDOFF.md`：對 AI 接手的指引
- `FOSSIL_DESIGN.md`：化石機制詳細設計
- `static/cards/M5.json`：M5 卡資料（81 張）
- `static/cards/index.json`：所有 set entry
- `src/lib/game/effects.ts`：核心註冊檔
- `src/lib/version.ts`：版本號規則
