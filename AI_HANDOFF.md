# PTCG 對戰模擬器 — AI 交接紀錄

> 最後更新：2026-04-16  
> 執行者：Antigravity AI (Google Deepmind)  
> 專案：https://github.com/suenz001/ptcg-tw-sim

---

## 📋 本次工作摘要

### 目標
移除所有 **G 標（已退標）** 卡包，只保留標準賽合法的 **H / I / J** 標卡牌。

### 背景
- 專案是一個 PTCG（寶可夢集換式卡牌遊戲）的線上對戰模擬器
- 使用 SvelteKit（adapter-static）+ Firebase（Firestore + Auth）
- 卡牌資料從台灣官網 `asia.pokemon-card.com/tw/` 爬取，存為靜態 JSON
- 問題：資料庫中包含已退標的 G 標卡包（SV1~SV4 系列），需要清除

---

## ✅ 已完成的變更

### 1. 確認 Regulation Mark 對照表
**方法**：下載每個卡包的第一張卡牌圖片，直接查看卡片左下角的 regulation mark 字母。

| Mark | 狀態 | 卡包代碼 |
|:---:|:---:|:---|
| **G** | ❌ 已刪除 | SV1S, SV1V, SV1a, SV2P, SV2D, SV2a, SV3, SV3a, SV4K, SV4M, SV4a（共 11 個）|
| **H** | ✅ 保留 | SV5K, SV5M, SV5a, SV6, SV6a, SV7, SV7a, SV8, SV8a, MJ（共 10 個）|
| **I** | ✅ 保留 | SV9, SV9a, SV10, SV11B, SV11W, M1S, M1L, M2, M2a, MBD, MBG（共 11 個）|
| **J** | ✅ 保留 | MC, M3, M4（共 3 個）|

> ⚠️ 注意：台灣官網的卡牌 HTML 頁面**不會顯示** regulation mark，只有卡牌圖片上才看得到。
> 所以 scraper 無法自動抓取，需要用 set code 查表補上。

### 2. 新增檔案

| 檔案路徑 | 用途 |
|:---|:---|
| `src/lib/cards/regulation.ts` | TypeScript 版 set→mark 對照表，前端使用 |
| `scripts/regulation.js` | 純 JS 版 set→mark 對照表，供 Node.js scripts 使用 |
| `scripts/backfill-marks.js` | 一次性腳本：為所有卡牌 JSON 補上 `regulationMark` 欄位 |

### 3. 修改檔案

| 檔案路徑 | 變更內容 |
|:---|:---|
| `scripts/scrape/scrape-all.js` | `DEFAULT_SETS` 移除所有 G 標卡包，只保留 H/I/J |
| `scripts/scrape/parse-card.js` | 導入 regulation.js，用 set code 查表自動填入 `regulationMark`（因為官網 HTML 不提供）|
| `scripts/build-sets-index.js` | 移除 G 標的 `SET_NAMES`，`index.json` 輸出加入 `regulationMark` 欄位 |
| `src/lib/cards/types.ts` | `SetSummary` interface 新增 `regulationMark?: string` |
| `src/routes/cards/+page.svelte` | 卡包列表按 H→I→J 分組顯示，每組有彩色標記徽章（H=藍, I=紫, J=橘）|
| `static/cards/*.json`（24 個檔案）| 每張卡都補上了正確的 `regulationMark` 值 |
| `static/cards/index.json` | 重建，只含 24 個標準賽卡包 |

### 4. 刪除檔案（22 個）

```
static/cards/SV1S.json + SV1S.log
static/cards/SV1V.json + SV1V.log
static/cards/SV1a.json + SV1a.log
static/cards/SV2P.json + SV2P.log
static/cards/SV2D.json + SV2D.log
static/cards/SV2a.json + SV2a.log
static/cards/SV3.json  + SV3.log
static/cards/SV3a.json + SV3a.log
static/cards/SV4K.json + SV4K.log
static/cards/SV4M.json + SV4M.log
static/cards/SV4a.json + SV4a.log
```

### 5. 驗證結果

| 項目 | 結果 |
|:---|:---|
| `index.json` 卡包數 | 24 sets（H:10 + I:11 + J:3）|
| 所有卡片 `regulationMark` | 4059/4059 全部已標記（無遺漏）|
| G 標 JSON 殘留 | 0 個（全部清除）|
| `npm run build` | ✅ 編譯成功 |

---

## 🏗️ 專案架構（供下一位 AI 參考）

```
ptcg-tw-sim/
├── src/
│   ├── lib/
│   │   ├── cards/
│   │   │   ├── types.ts          # Card, SetSummary 等型別定義
│   │   │   └── regulation.ts     # [NEW] set code → regulation mark 對照
│   │   └── firebase.ts           # Firebase client config
│   └── routes/
│       ├── +page.svelte          # 首頁（專案路線圖）
│       └── cards/
│           ├── +page.ts          # 資料載入（fetch index.json / set JSON）
│           └── +page.svelte      # 卡牌瀏覽器 UI
├── scripts/
│   ├── regulation.js             # [NEW] JS 版 regulation mark 對照（跟 TS 版保持同步）
│   ├── backfill-marks.js         # [NEW] 一次性 backfill 腳本
│   ├── build-sets-index.js       # 產生 static/cards/index.json
│   └── scrape/
│       ├── scrape-all.js         # 批次爬取所有卡包
│       ├── scrape-set.js         # 爬取單一卡包
│       └── parse-card.js         # 解析卡牌 HTML → JSON
├── static/
│   └── cards/
│       ├── index.json            # 卡包索引（24 sets）
│       ├── SV5K.json ... M4.json # 各卡包的卡牌資料
│       └── *.log                 # 爬取紀錄
├── svelte.config.js              # SvelteKit 設定（adapter-static）
└── package.json
```

### 技術棧
- **前端**：SvelteKit 5 + adapter-static（部署到 GitHub Pages）
- **後端**：Firebase（Firestore + Auth + Cloud Functions）— 尚未完整實作
- **卡牌資料**：靜態 JSON，從台灣官網爬取
- **部署**：GitHub Pages（https://suenz001.github.io/ptcg-tw-sim）

### 重要注意事項
1. **Regulation mark 無法從官網 HTML 抓取**，必須用 set code 查表（`regulation.ts` / `regulation.js`）
2. 如果有新卡包發售，需要：
   - 在 `regulation.ts` 和 `regulation.js` 中新增 set code → mark 映射
   - 在 `scrape-all.js` 的 `DEFAULT_SETS` 中新增
   - 在 `build-sets-index.js` 的 `SET_NAMES` 中新增中文名稱
   - 執行 `node scripts/scrape/scrape-all.js` 爬取
   - 執行 `node scripts/build-sets-index.js` 重建索引
3. **兩份 regulation 對照表必須保持同步**（`src/lib/cards/regulation.ts` 和 `scripts/regulation.js`）

---

## 🔮 下一步建議（M1 階段）

根據首頁路線圖，接下來可能的工作：
- M1：牌組編輯器（deck builder）
- M2：對戰引擎（battle engine）
- M3：多人連線（multiplayer via Firebase）

目前 M0 階段（卡牌資料庫 + 瀏覽器）已完成。

---

## 📝 2026-04-17 Session 2 — Claude（接手驗證）

> 執行者：Claude（Anthropic）
> 觸發：使用者指出上輪把 G 標卡包誤爬，要求讀 `AI_HANDOFF.md` 並延續

### 驗證結果（全數通過）

| 項目 | 結果 |
|:---|:---|
| `static/cards/*.json` 總數 | 24 個 set JSON + `index.json` |
| 全卡 `regulationMark` 覆蓋 | **4059 / 4059** 全部已標記 |
| Set 分布 | H:10 · I:11 · J:3 = 24 ✓ |
| G 標殘留 | 0 ✓ |
| `scripts/regulation.js` ↔ `src/lib/cards/regulation.ts` | 兩表完全同步 ✓ |
| `npm run build` | ✅ 編譯成功（SvelteKit adapter-static） |
| `cards/+page.svelte` UI | H→I→J 分組、彩色徽章、「標準賽 H / I / J 標」提示皆正確 |
| Git working tree | 乾淨，HEAD = `7ff2f3a chore: remove G-mark sets...` |

### 規範記錄（給下一位 AI）
- **本檔為接力文件**：每次工作前先讀它，工作結束後把動作寫回來。
- `SET_REGULATION_MARK` 有兩份（`.ts` 前端 + `.js` scripts），**永遠成對修改**。
- 未來新卡包發售 SOP（已在前節列出）：更新兩份對照表 → `scrape-all.js` DEFAULT_SETS → `build-sets-index.js` SET_NAMES → 爬取 → 重建索引。
- 官網 HTML **不含 regulation mark**，只有卡圖上看得到；新卡包要親自下載第一張卡圖驗證字母。

### 下一步：進入 M1（牌組編輯器）
- 路線圖順序 M0 → M1 → M5 不變。
- M0 已確認正確完結，開始實作 M1：
  1. 新增 `/decks` 路由，支援本地草稿（localStorage）
  2. 卡片搜尋／加入介面（從 `static/cards/*.json` 選卡）
  3. 牌組規則驗證（60 張、同名 ≤4 張、能量卡例外、僅 Standard H/I/J）
  4. 匯出 / 匯入 JSON
  5. 之後（M1 尾端）再串 Firebase Auth + Firestore 儲存雲端牌組

---

## 📝 2026-04-17 Session 2 (續) — M1 scaffold 實作

### 新增檔案（Claude）

| 檔案 | 用途 |
|:---|:---|
| `src/lib/decks/types.ts` | `Deck` / `DeckEntry` / `DeckValidationResult` 型別 |
| `src/lib/decks/storage.ts` | localStorage CRUD（`loadDecks` / `upsertDeck` / `deleteDeck` / `newDeck`），key = `ptcg-tw-sim:decks` |
| `src/lib/decks/validation.ts` | Standard 合法性驗證（60 張、同名 ≤4、至少 1 隻基礎寶可夢、僅 H/I/J） |
| `src/lib/cards/pool.ts` | 共用卡池載入器：`loadIndex` / `loadSet` / `loadAllSets`（lazy + in-flight dedupe）+ `buildCardIndex` |
| `src/routes/decks/+page.ts` | 路由設定（prerender=true, ssr=false） |
| `src/routes/decks/+page.svelte` | **牌組編輯器主畫面**（三欄：牌組列表 / 牌組內容 / 卡片搜尋 + 篩選） |

### 修改檔案

| 檔案 | 變更 |
|:---|:---|
| `src/routes/+page.svelte` | 首頁新增「牌組編輯器」連結；路線圖標註 M0 ✅ / M1 🚧 |

### M1 scaffold 已有功能
- 多牌組並存（localStorage）
- 即時規則驗證（60 張、同名 ≤4、基本能量無上限、至少 1 隻基礎寶可夢、擋非標卡）
- 卡片搜尋（名稱 / 卡號）+ 類型 + 卡包 + 標記三重篩選
- 匯出 / 匯入 JSON
- 清空 / 刪除 / 更名
- 加卡按鈕在超過上限時自動禁用（能量卡例外）
- Svelte 5 runes（`$state` / `$derived` / `$derived.by`）
- `npm run build` ✅ 通過（含 prerender，無警告無錯誤）

### M1 尚待完成
- [ ] 串接 Firebase Anonymous Auth（首頁已做 demo，這邊要把牌組綁 uid）
- [ ] 將 localStorage 牌組同步到 Firestore（`users/{uid}/decks/{deckId}`）
- [ ] 卡片詳情彈窗（點名稱或圖片 → 看 HP / 招式 / 特性）
- [ ] 能量卡額外檢查（特殊能量總數 vs 基本能量）
- [ ] 牌組匯入時的嚴格 schema 驗證（目前只檢查最外層欄位）

### 給下一位 AI 的 hand-off
- 目前僅靠 localStorage。重構到 Firestore 時保持 `src/lib/decks/storage.ts` 介面不動，只換實作即可。
- `src/lib/cards/pool.ts` 是之後 M2 規則引擎也要用的共用模組，不要重複實作。
- 每次動作繼續往本檔追加新的 session 條目。

---

## 📝 2026-04-17 Session 3 — M0 資料修正（卡包名稱 + 封面 + setCode）

> 觸發：使用者發現卡包名稱全部錯誤（沿用佔位名），封面用的是卡片圖而非包裝圖，且多個 set 的 setCode 欄位為空字串

### 問題根因
1. **卡包名稱**：`build-sets-index.js` 的 `SET_NAMES` 是早期 AI 隨意命名（如「Mega之星」「雷公」「水君」），全部非官方
2. **封面圖**：原本用 `cards[0].imageUrl`（第一張卡的牌面），而非卡包包裝圖
3. **setCode 空字串**：`parse-card.js` 從 HTML 的 `img[src*="twhk_exp_"]` 抓 set code，但 M 系列和部分 SV 系列的頁面沒有這個圖片 → 爬到的 `setCode` 為空

### 修正方式
- **官方名稱**：去 `asia.pokemon-card.com/tw/archive/special/card/{code}/` 頁面抓 title；對找不到 archive 的卡包，從卡牌 detail 頁面的文字確認
- **封面圖**：同樣從 archive 頁面找 `hero-visual.jpg / hero-visual.png / hero-pkg.png / hero-pack.png / hero-img-*.png` 等圖片
- **setCode**：新增 `scripts/backfill-setcode.js`，用檔名作為 ground truth，補回空白的 `setCode`

### 全部修正後的卡包名稱（24 sets，2026-04-17 驗證）

| Code | 正確官方名稱 | 封面來源 |
|:---|:---|:---|
| SV5K | 狂野之力 | 卡片圖（無 archive） |
| SV5M | 異度審判 | 卡片圖 |
| SV5a | 緋紅薄霧 | 卡片圖 |
| SV6  | 變幻假面 | **archive art** ✓ |
| SV6a | 黑夜漫遊者 | 卡片圖 |
| SV7  | 星晶奇跡 | **archive art** ✓ |
| SV7a | 樂園騰龍 | 卡片圖 |
| SV8  | 超電突圍 | **archive art** ✓ |
| SV8a | 太晶慶典ex | **archive art** ✓ |
| MJ   | 新人冒險旅程 | 卡片圖 |
| SV9  | 對戰搭檔 | **archive art** ✓ |
| SV9a | 熱風競技場 | 卡片圖 |
| SV10 | 火箭隊的榮耀 | **archive art** ✓ |
| SV11B | 漆黑伏特 | 卡片圖 |
| SV11W | 純白閃焰 | 卡片圖 |
| M1S  | 超級交響樂 | **archive art** ✓ (m1 共用) |
| M1L  | 超級勇氣 | **archive art** ✓ (m1 共用) |
| M2   | 烈獄狂火X | **archive art** ✓ |
| M2a  | 超級進化夢想ex | **archive art** ✓ |
| MBD  | 超級蒂安希ex | 卡片圖 |
| MBG  | 超級耿鬼ex | 卡片圖 |
| MC   | 超級進化初階牌組100 | **archive art** ✓ |
| M3   | 虛無歸零 | **archive art** ✓ |
| M4   | 忍者飛旋 | **archive art** ✓ |

### 新增／修改檔案
| 檔案 | 變更 |
|:---|:---|
| `scripts/build-sets-index.js` | 更新 `SET_NAMES`（全部改為官方名）；新增 `SET_COVER_URLS`（13 個有 archive 封面的卡包）；改用封面優先邏輯 |
| `scripts/backfill-setcode.js` | 【新增】補回所有卡牌的 `setCode` 空白（3546 張） |
| `scripts/fetch-set-info.js` | 【新增】一次性調查腳本（已完成任務，可保留或刪除） |
| `static/cards/index.json` | 已重建（名稱 + 封面全部更新） |
| `static/cards/*.json`（23 個） | `setCode` 全部補齊（SV10 / SV8a 原本就有，其餘補上） |

### 給下一位 AI 的注意事項
- SV9a 名稱「熱風競技場」源自 card detail 頁面文字，archive 頁不存在，如有疑慮請重新驗證
- 封面圖 URL pattern：`https://asia.pokemon-card.com/tw/archive/special/card/{lowercase_code}/assets/images/hero-visual.{jpg|png}`（但 M4 是 `hero-img-01-y25ri.png`，MC 是 `home/image_package.png` — 不一致，所以 SET_COVER_URLS 要逐一確認）
- 若有新卡包：更新 `regulation.js` + `regulation.ts` → `scrape-all.js` DEFAULT_SETS → `build-sets-index.js` SET_NAMES + SET_COVER_URLS
- `setCode` 對牌組編輯器的卡包篩選至關重要，不可留空
