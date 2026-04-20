# PTCG 對戰模擬器 — AI 交接紀錄

> 最後更新：2026-04-20 Session 36 (v1.4)  
> 執行者：Claude Opus 4.7 / Sonnet 4.6 (Anthropic)  
> 專案：https://github.com/suenz001/ptcg-tw-sim  
> 發佈：https://suenz001.github.io/ptcg-tw-sim/game

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
- 封面圖 URL pattern 不統一（M4=`hero-img-01-y25ri.png`，MC=`home/image_package.png`），SET_COVER_URLS 需逐一確認，不能只靠 pattern 推斷
- 若有新卡包：更新 `regulation.js` + `regulation.ts` → `scrape-all.js` DEFAULT_SETS → `build-sets-index.js` SET_NAMES + SET_COVER_URLS
- `setCode` 對牌組編輯器的卡包篩選至關重要，不可留空

---

## 📝 2026-04-17 Session 4 — 補齊剩餘封面 + 修正 MJ 名稱

> 觸發：使用者要求補齊 11 個沒有封面的卡包，並質疑 MJ 名稱

### 發現與修正

| 問題 | 結果 |
|:---|:---|
| SV5K + SV5M 沒有 archive 頁 | **找到**：共用 `/sv5/` archive 頁（雙包同步發售），使用 `hero-visual.jpg` |
| SV11B + SV11W 沒有 archive 頁 | **找到**：共用 `/sv11/` archive 頁，使用 `hero-visual.png` |
| SV5a / SV6a / SV7a / SV9a / MJ 無 archive 頁 | 無官方包裝圖 → 使用各 set 的 001 號卡（封面寶可夢）代替 |
| MBD / MBG | 使用者指定 → 超級蒂安希ex（tw00014110）/ 超級耿鬼ex（tw00014131）|
| MJ 名稱「新人冒險旅程」 | **錯誤**：官網使用英文名 **"New Trainer Journey"**，已修正 |

### 最終封面狀態（24 sets 全部有圖）
- **17 sets** → 官方 archive 包裝圖（archive.pokemon-card.com hero visual）
- **7 sets** → 代表卡圖：SV5a（001蔓藤怪）、SV6a（001電電蟲）、SV7a（001蛋蛋）、SV9a（001阿響的凱羅斯）、MJ（001凱羅斯）、MBD（超級蒂安希ex）、MBG（超級耿鬼ex）

---

## 📝 2026-04-17 Session 5 — 補齊剩餘 5 個卡包官方封面

> 觸發：使用者要求 SV5a/SV6a/SV7a/SV9a/MJ 不用卡片圖，改找真正的卡包封面

### 解決方式
- SV5a/SV6a/SV7a/SV9a → 從日本官方 **pokemon-card.com** 的 products 頁面 HTML 擷取 banner/product 圖片 URL
- MJ (New Trainer Journey) → 台灣 archive 路徑不是 `/mj/` 而是 `/new-trainer-journey/`；在此頁面找到 `og-image.png`（OG 社群分享用圖，代表產品形象）

### 最終封面來源（完整版）
| Code | 封面圖來源 |
|:---|:---|
| SV5K / SV5M | `archive/sv5/` hero-visual.jpg（台灣官網，雙包共用） |
| SV5a | `pokemon-card.com/products/2024/images/SV5a_banner.jpg`（日本官網） |
| SV6a | `pokemon-card.com/products/2024/images/SV6a_10.jpg`（日本官網） |
| SV7a | `pokemon-card.com/products/2024/images/sv7a_banner.jpg`（日本官網） |
| SV9a | `pokemon-card.com/products/2025/images/sv9a_banner.jpg`（日本官網） |
| MJ | `archive/new-trainer-journey/assets/images/og-image.png`（台灣官網） |
| MBD / MBG | 使用者指定 → 蒂安希ex / 耿鬼ex 卡片圖 |
| 其餘 17 sets | 台灣官網各自的 archive hero-visual |

> **重要**：MJ 的台灣 archive URL 是 `new-trainer-journey` 而非 `mj`，未來若有類似命名不一致的情況，需從 archive 頁面 HTML 的 img src 逐一確認。

---

## 📝 2026-04-17 Session 6 — 修正封面熱連結問題 + Lightbox 功能

> 觸發：使用者回報 SV5a/SV6a/SV7a/SV9a/MJ 仍顯示 001 號卡圖；之後要求點擊卡牌圖片可放大

### 問題一：外部封面圖被 Hotlink 保護封鎖

**根因**：瀏覽器請求外部 URL 時會自動帶上 `Referer: https://suenz001.github.io/ptcg-tw-sim`，觸發 `pokemon-card.com` 的熱連結防護（Node.js HEAD 測試沒有 Referer 所以通過，但實際瀏覽器被擋）。

**解決方式**：將 5 個本地化封面圖下載自存至 `static/covers/`
| 檔案 | 大小 | 內容 |
|:---|:---:|:---|
| `static/covers/SV5a.jpg` | 466 KB | 緋紅薄霧包裝圖 |
| `static/covers/SV6a.jpg` | 511 KB | 黑夜漫遊者包裝圖 |
| `static/covers/SV7a.jpg` | 571 KB | 樂園騰龍包裝圖 |
| `static/covers/SV9a.jpg` | 543 KB | 熱風競技場包裝圖 |
| `static/covers/MJ.png`   | 1.4 MB | New Trainer Journey OG 圖 |

`build-sets-index.js` 的 `SET_COVER_URLS` 改為相對路徑 `covers/SV5a.jpg` 等。

**重要**：本地路徑需要在前端加 SvelteKit 的 `base` 前綴（GitHub Pages 部署在 `/ptcg-tw-sim`）。

**`coverUrl()` helper**（位於 `src/routes/cards/+page.svelte`）：
```typescript
function coverUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${base}/${url}`;  // 補上 /ptcg-tw-sim/ 前綴
}
```

封面圖在模板中用 `coverUrl(set.coverImageUrl)` 呼叫。

### 問題二：`<svelte:window>` 不能放在 block 內

Lightbox 新增 `<svelte:window onkeydown={onKeydown} />` 時，若放在 `{#if data.mode === 'set'}...{/if}` block 內會編譯失敗。
修正：移至 `<svelte:head>` 之前（HTML 頂層）。

### 功能：卡牌圖片 Lightbox

點擊詳情 modal 中的卡片圖片，會開啟全螢幕疊層顯示大圖：
- 點擊暗色背景 → 關閉 Lightbox
- 點擊圖片本身 → 不關閉（stopPropagation）
- 按 `Escape` → 關閉
- 圖片上方有 × 關閉按鈕
- 卡片圖片 hover 時顯示 🔍 提示
- `max-width: min(600px, 95vw)` 確保手機上也能正確顯示

### 修改檔案
| 檔案 | 變更 |
|:---|:---|
| `src/routes/cards/+page.svelte` | 新增 lightbox state、`openLightbox` / `closeLightbox` / `onKeydown`；detail img 改為 button 包裝；加入 lightbox overlay HTML + CSS |
| `scripts/build-sets-index.js` | `SET_COVER_URLS` 中 SV5a/SV6a/SV7a/SV9a/MJ 改為本地相對路徑 |
| `static/covers/*.jpg/png` | 5 個新增自存封面圖 |
| `static/cards/index.json` | 重建（封面 URL 更新） |

### Commits
- `f22bf48` feat(cards): coverUrl helper + self-hosted covers for SV5a/SV6a/SV7a/SV9a/MJ
- `59e1cb6` feat(cards): lightbox for full-size card image on click

### 給下一位 AI 的注意事項
- **外部圖片熱連結**：如果未來又要換封面，記得先用瀏覽器實測圖片能否顯示（Node fetch ≠ 瀏覽器請求）。安全做法是自存到 `static/covers/`。
- **`base` 前綴**：本地靜態路徑（`covers/xxx.jpg`）一定要用 `coverUrl()` 包一層，不然在 GitHub Pages 上會 404。
- **`<svelte:window>`** 必須放在 HTML 頂層（`<script>` 結束之後、任何 `{#if}` 之前）。

---

## 📝 2026-04-17 Session 7 — M1 Phase A/B（卡片詳情預覽 + 牌組統計）

> 觸發：使用者確認 M1 規劃後，開始實作 Phase A（卡片詳情）與 Phase B（統計摘要）

### Phase A — 卡片詳情預覽 Modal

**功能**：
- 點擊 picker 右欄的卡片縮圖或名稱 → 開啟詳情 overlay
- 點擊牌組中欄的卡片縮圖也可開啟
- Modal 內容：大圖（180px）、卡名、HP badge、屬性 badge、標記、進化來源
- 若有特性（Ability）：顯示紅色 label 標籤 + 名稱 + 效果文字
- 若有招式（Attack）：顯示能量費用圓形 pip（顏色與 ENERGY_COLOR 對應）、招式名稱、傷害值、效果文字
- 訓練家/能量卡：顯示 rulesText
- 弱點 / 抵抗力 / 撤退費用（能量 pip）
- 牌組內張數 + ± 按鈕（可直接在 modal 內加減，不需關閉）
- Escape 鍵 / 點背景關閉
- 目前預覽的卡在 picker 列表有藍色 outline 高亮

**新增 state**：`pickerPreview: Card | null`、`previewCount`（derived）

**新增 functions**：`openPreview(card)`、`closePreview()`、`onKeydown(e)` → Escape 關閉

### Phase B — 牌組統計摘要列

**功能**：
- 在驗證提示下方顯示：`寶可夢 XX` · `訓練家 XX` · `能量 XX`（彩色 pill）
- 右側附加比例進度條（綠/紫/橘，60 張為底）
- 即時從 `poolById` 計算，`deckStats` derived

### 修改檔案
| 檔案 | 變更 |
|:---|:---|
| `src/routes/decks/+page.svelte` | 新增 preview modal、stats bar、相關 state/derived/CSS |

### Commit
- `57728b9` feat(decks): card detail preview modal + deck stats bar (M1 Phase A/B)
- `ad7ec49` feat(auth): email/password login + anonymous account upgrade

### M1 剩餘工作
- [x] **Phase C** — 文字格式匯入匯出 ✅
- [x] **Phase D** — Firebase Anonymous Auth + Firestore 雲端同步 ✅
- M1 **全部完成** ✅

### 給下一位 AI
- `ENERGY_LABEL` / `ENERGY_COLOR` 定義在 `src/lib/cards/energy.ts`，preview modal 直接 import 使用
- `maxCopies(card)` / `isBasicEnergy(card)` 在 `src/lib/decks/validation.ts`，preview modal 的 ± 按鈕也在用

---

## 📝 2026-04-17 Session 8 — M1 Phase C/D（文字格式 + Firebase 同步）

> 接續 Session 7，完成 M1 最後兩個 Phase

### Phase C — 文字格式匯入匯出

**格式**：每行 `{張數} {卡名} {卡包代號} {卡號}`，首行可加 `// 牌組名稱`

**匯出**：
- 按鈕「匯出文字」（只在有牌組且有卡片時啟用）
- 開啟 modal：顯示格式化文字、「複製到剪貼簿」（`navigator.clipboard`）、「下載 .txt」

**匯入**：
- 按鈕「匯入文字」（只在卡池載入完成時啟用）
- 開啟 modal：貼上文字 → 按「匯入」
- 解析邏輯：用二級索引 `poolBySetNum`（`${setCode}-${collectorNumber}` → Card）逐行查找
- 找不到的卡片：彙整後一次性 confirm 對話框，可選擇略過繼續匯入
- 首行 `// 名稱` 自動設為牌組名稱

**新增 derived**：
- `poolBySetNum: Map<string, Card>` — 二級索引供匯入用
- `textExportContent: string` — 格式化後的匯出文字

### Phase D — Firebase Anonymous Auth + Firestore 雲端同步

**架構**：
- `src/lib/decks/cloud.ts`：`syncDeckToCloud` / `removeDeckFromCloud` / `loadDecksFromCloud`
- Firestore 路徑：`users/{uid}/decks/{deckId}`（每個牌組一個 document）
- `firestore.rules`：只允許 `request.auth.uid == userId`

**同步流程**（onMount）：
1. `signInAnonymously(auth)` → 取得 uid（匿名，不需使用者操作）
2. 先載入 localStorage（立即顯示）
3. 讀取 Firestore：若雲端有資料，以 `updatedAt` 決定哪份較新，合併
4. 首次使用雲端（cloud 空）：把本地牌組全部推上去
5. 合併結果存回 localStorage + 更新 state

**每次操作都 fire-and-forget 同步**：create / rename / add card / remove card / clear / import JSON / import text → `pushDeck()` 或 `dropDeck()`

**狀態顯示**：頁首 pill 標籤
- `⏳ 同步中`（黃底）
- `☁️ 已同步`（綠底）
- `⚠️ 離線`（紅底，hover 顯示錯誤訊息）
- `⬜ 本機`（灰底，尚未登入時）

**注意**：Firebase Console 需手動啟用 Anonymous Auth：
> Authentication → Sign-in method → Anonymous → Enable

### 新增檔案
| 檔案 | 用途 |
|:---|:---|
| `src/lib/decks/cloud.ts` | Firestore CRUD helpers |
| `firestore.rules` | Firestore security rules（需部署：`firebase deploy --only firestore:rules`） |

### Commits
- `57728b9` feat(decks): card detail preview modal + deck stats bar (M1 Phase A/B)
- `2c4b809` feat(decks): text format import/export + Firebase cloud sync (M1 Phase C/D)

### M1 完工狀態
M1 全部 4 個 Phase 已完成。下一個里程碑是 **M2（對戰引擎）**：
- M2 規劃：後端對戰邏輯（Firebase Realtime / Firestore 房間）、牌局狀態機
- `src/lib/cards/pool.ts` 已可在 M2 規則引擎復用

### Email/Password Auth（Session 9 追加）
- Firebase Console 已啟用 Email/Password 登入方式
- 匿名帳號可透過 `linkWithCredential` 升級為 Email 帳號（uid 不變，牌組全部保留）
- 其他裝置用 `signInWithEmailAndPassword` 登入後，`onAuthStateChanged` 自動載入雲端牌組
- 登出後自動以匿名重新登入

### 給下一位 AI 的注意事項
1. **Anonymous Auth** ✅ 已在 Firebase Console 啟用
2. **Firestore Database** ✅ 已建立（asia-east1，從測試模式啟動）
3. **Firestore rules** ✅ 已部署（`firestore.rules`）— 只允許 `auth.uid == userId`
4. **Firebase CLI 登入**：使用者已在本機登入。部署指令：`cd E:\ptcg-tw-sim && node node_modules\firebase-tools\lib\bin\firebase.js deploy --only firestore:rules --project ptcg-tw-sim`（Windows cmd 下用 node 直接呼叫，因為 PowerShell 有 execution policy 限制）
5. cloud.ts 使用 `firebase/firestore`（非 `firebase/firestore/lite`），保留完整監聽能力以供 M2 使用
6. 同步策略是「樂觀更新 + 最後寫入時間戳贏」，如果未來需要衝突解決，要修改 `onAuthStateChanged` 中的 merge 邏輯
7. Firestore 測試模式 30 天到期後會自動拒絕所有請求——但 rules 已部署為正式版規則（auth.uid 驗證），所以不受測試模式到期影響

---

## 📝 2026-04-17 Session 9 — M2 Phase A + B（對戰引擎 + 本機雙人 UI）

### M2 Phase A — 純函式對戰引擎

**新增檔案**：
| 檔案 | 用途 |
|:---|:---|
| `src/lib/game/types.ts` | 全部型別：`GamePhase`, `TurnPhase`, `CardInstance`, `PlayerState`, `GameState`, `GameAction`, `EffectScript` |
| `src/lib/game/engine.ts` | 純函式引擎：`createGame` / `applyAction` / `getAvailableAttacks` / `hasPendingActions` / `countEnergy` / `canAffordAttack` |
| `src/lib/game/actions.ts` | Action creator helpers：`GameActions.placeActive` / `.benchPokemon` / `.finishSetup` / `.drawCard` / `.attachEnergy` / `.attack` / `.takePrizes` / `.sendNewActive` / `.endTurn` / `.playTrainer` / `.evolve` / `.retreat` |
| `src/routes/game/+page.ts` | `prerender = false; ssr = false` |

**引擎行為摘要**：
- `createGame(spec1, spec2, pool)`：洗牌、發 7 張初手（自動重抽至多 10 次，基礎寶可夢不足時）→ `setup-p1` 階段
- `applyAction`：純函式，state → new state
- Setup：PLACE_ACTIVE / BENCH_POKEMON / FINISH_SETUP（發 6 張獎勵牌）→ 雙方完成後進入 `playing`
- Playing：DRAW_CARD（空牌庫即輸）/ ATTACH_ENERGY（每回合 1 次）/ ATTACK（弱點 ×2、KO 扣獎勵牌、EX 系列扣 2 張）/ TAKE_PRIZES（獎勵牌拿完即贏）/ SEND_NEW_ACTIVE / END_TURN（換手、重設旗標）
- `getAvailableAttacks(state, pool)` → 能量足夠的招式 index 陣列
- `canAffordAttack(pokemon, cost, pool)` → 有色能量先比對，剩餘需求比無色

**Commit**：`87d626e` feat(game): M2 Phase A — battle engine core (types + engine + actions)

### M2 Phase B — 本機雙人對戰 UI

**新增檔案**：`src/routes/game/+page.svelte`

**UI 畫面**：
1. **選牌組畫面（Lobby）**：兩人各選牌組 + 填名稱；兩人不可同一牌組；「開始遊戲」按鈕
2. **Setup 畫面**：手牌 grid，基礎寶可夢可按「出場」/「備戰」；已選者顯示 chip；「準備完成」按鈕
3. **對戰盤面（3 欄）**：
   - 左欄：對手區（出場 Pokémon + HP bar、備戰列、牌組/墓地/獎勵牌計數）
   - 中欄：行動區（待取獎勵警示、送出新出場 picker、抽牌/結束回合按鈕、招式按鈕含能量 pip）
   - 右欄：自己區（出場 + 備戰可點擊附加能量、手牌橫捲）
   - 標題列：回合數、行動玩家名稱、TurnPhase 標籤
4. **遊戲結束畫面**：勝者名稱、勝利原因、「再來一局」/「回首頁」按鈕

**互動邏輯**：
- 手牌中的能量卡可點擊選取（發光高亮）→ 再點出場/備戰 Pokémon 完成附加
- 招式按鈕顯示能量 pip（ENERGY_LABEL/ENERGY_COLOR），能量不足時禁用
- 先手第 1 回合不能攻擊（`isFirstTurn` 旗標）
- 所有互動都呼叫 `dispatch(GameActions.xxx())` → `applyAction` → 新 state

**修改檔案**：
| 檔案 | 變更 |
|:---|:---|
| `src/routes/+page.svelte` | 新增「⚔️ 對戰 → /game」section；路線圖標 M2 🚧 |

**已知限制（M3/M4 補齊）**：
- 訓練家牌、特性、特殊能量、寶可夢道具、進化、撤退尚未實裝（效果腳本預留）
- 所有卡片效果實作從 M3 開始分批填入

**Commits**：
- `6bb34b1` chore: mark M1 complete on homepage roadmap
- `edd14fd` feat(game): M2 Phase B — battle board UI (local pass-and-play)

### 給下一位 AI 的注意事項
1. **引擎是純函式**：`applyAction(state, action, pool) → GameState`，可以直接序列化到 Firestore 供 M3 連線對戰使用
2. **`pool`（Map<string, Card>）** 在引擎 call 每次都需要傳入，不要把它塞進 GameState（避免序列化爆掉）
3. **EffectScript 插槽**：`types.ts` 中定義了 `EffectScript` interface，M3/M4 逐張卡實裝時填入 `src/lib/game/effects/` 目錄
4. **EX 判斷**：`engine.ts` 中用 `card.subtype === 'ex'` 判斷是否扣 2 張獎勵牌；目前台灣官網資料的 subtype 欄位需確認格式是否一致
5. **先手第 1 回合限制**：`isFirstTurn` 在 P1 第一次 END_TURN 時清除（在 `handlePlaying` 的 `END_TURN` case 中）
6. **M2 Phase C 已完成**（見下方 Session 10）

---

## 📝 2026-04-17 Session 10 — M2 Phase C（進化 / 撤退 / 打出基礎 / 訓練家）

### 新增檔案
| 檔案 | 用途 |
|:---|:---|
| `src/lib/game/effects.ts` | 訓練家效果登錄表（`TRAINER_EFFECTS` / `RESOLVERS` Map），含 15+ 種常見卡效果 |

### 修改檔案
| 檔案 | 變更摘要 |
|:---|:---|
| `src/lib/game/types.ts` | `CardInstance` 加 `justPlaced?` / `evolvedThisTurn?`；`PlayerState` 加 `retreatedThisTurn`；新增 `PendingSelection` interface；`GameState` 加 `pendingSelection?`；`GameAction` 加 `PLAY_BASIC` / `RESOLVE_SELECTION` |
| `src/lib/game/engine.ts` | 加入 PLAY_BASIC / EVOLVE / RETREAT / PLAY_TRAINER / RESOLVE_SELECTION 處理；END_TURN 清除 `justPlaced`/`evolvedThisTurn`；export `getEvolvableTargets` / `canRetreat` / `getPlayableTrainers` / `getPlayableBasics` |
| `src/lib/game/actions.ts` | 加入 `playBasic` / `evolve` / `retreat` / `resolveSelection` |
| `src/routes/game/+page.svelte` | 手牌新增「上備戰」/ 訓練家「使用」按鈕；出場/備戰寶可夢新增進化下拉選單；出場寶可夢新增撤退選擇器；主階段新增 `PendingSelection` 互動疊層（卡片 grid + 選擇確認） |

### 效果已實裝清單（`effects.ts`）
**即時支援者**（無互動）：管理員、帕底亞的夥伴、納莉、丹瑜、紫竽、松葉的信心、枇琶
**互動支援者**：艾莉絲的鬥志（丟1抽至6）、探險家的嚮導（看頂6選2）、小剛的發掘（搜尋基礎）
**切換物品**：寶可夢交替、急進開關
**回復物品**：好傷藥（回60丟1能量）、龍之秘藥（回120）
**搜尋物品**：好友寶芬（HP≤70基礎到備戰）、赫普的包包（任意基礎到備戰）、甜蜜球/黑暗球（搜寶可夢加手牌）

### 系統設計
- `PendingSelection.effectKey` → `RESOLVERS.get(key)` 找到 resolve 函式，在 `RESOLVE_SELECTION` 時執行
- 支援者每回合限打 1 張（`supporterPlayedThisTurn`）
- `justPlaced` 僅在 PLAY_BASIC 時設置，END_TURN 清除 → 防止同回合進化
- `evolvedThisTurn` 在 EVOLVE 時設置，END_TURN 清除 → 防止同回合再進化
- 第一回合 (`isFirstTurn`) 完全禁止進化

### Commits
- `5ceb89c` feat(game): M2 Phase C — evolve, retreat, play basic, trainer effects
- `6ea8b71` feat(game): built-in preset decks for testing (MBG / MBD)

### 給下一位 AI
1. **effects.ts 擴充**：新卡效果只需在 `effects.ts` 加 `reg('卡名', fn)` 即可，不用動引擎
2. **互動效果流程**：`PLAY_TRAINER` → 呼叫 `effectFn` → 回傳含 `pendingSelection` 的 state → UI 顯示選擇 → `RESOLVE_SELECTION` → 呼叫 `resolver` → 繼續
3. **搜尋效果分頁**：目前 PendingSelection deck-search 會把整個牌庫顯示出來（可能幾十張），UI 沒有分頁；大型牌庫時 scroll 即可，M3 如需優化可加
4. **未實裝效果**：遇到不在 `TRAINER_EFFECTS` 登錄的卡名 → `applyAction` 只棄置卡片並 log「效果尚未實裝」，不影響遊戲進行
5. **下一步**：M3 連線對戰系統，或繼續補充更多卡效果

---

## 📝 2026-04-17 Session 11 — 內建預設測試牌組（MBG / MBD）

### 目的
讓遊戲 Lobby 直接提供兩套可選的官方預組牌組，不需玩家先去建立牌組即可測試對戰。

### 新增檔案
| 檔案 | 用途 |
|:---|:---|
| `src/lib/decks/presets.ts` | 兩副官方預組牌表（各 60 張）＋ `PRESET_DECKS: Deck[]`、`PRESET_IDS: Set<string>` |

### 修改檔案
| 檔案 | 變更 |
|:---|:---|
| `src/routes/game/+page.svelte` | import PRESET_DECKS；`allDecks = [...PRESET_DECKS, ...decks]` derived；Lobby 選單加 `<optgroup label="🎴 內建預組">` 分類；`startGame()` 改從 `allDecks` 查找 |

### 牌組內容
| 牌組 | ID | 寶可夢 | 訓練家 | 能量 |
|:---|:---|:---:|:---:|:---:|
| 超級耿鬼ex（MBG）| `__preset_mbg__` | 18 | 28 | 14 惡 |
| 超級蒂安希ex（MBD）| `__preset_mbd__` | 17 | 29 | 14 超 |

### 預組不存 localStorage
預設牌組是純靜態常數（`PRESET_IDS` 的 id 以 `__preset_` 開頭），不寫入 localStorage，也不會上傳 Firestore，不影響使用者的雲端牌組。

### Commit
- `6ea8b71` feat(game): built-in preset decks for testing (MBG / MBD)

### 給下一位 AI
- 若要新增更多預組，只需在 `presets.ts` 的 `PRESET_DECKS` 陣列加入新的 Deck 物件即可
- `PRESET_IDS` 用來判斷是否為內建牌組（方便之後在牌組編輯器中標示「內建」badge 或禁止刪除）
- 卡片 ID 格式為純數字字串（如 `'14129'`），與 `buildCardIndex` 的 key 格式一致

---

## 📝 2026-04-18 Session 12 — 對戰 UI 重設計（Play Mat 佈局 + 卡片放大）

> 觸發：使用者要求比照官方教學影片重設計對戰畫面佈局，並要求卡片可以點擊放大

### 工作內容

#### 1. Play Mat 佈局重設計（取代舊三欄佈局）

舊版：三欄（對手區 / 行動區 / 我方區），所有內容縱向排列。
新版：上下對稱桌墊佈局，每邊橫向排列：
- **對手（上）**：`[牌庫/棄牌] [←備戰5格] [出場] [獎勵牌]`
- **中間**：行動列（警示 / 攻擊按鈕 / 行動紀錄）
- **我方（下）**：`[獎勵牌] [出場] [備戰5格→] [牌庫/棄牌]`
- **最底**：手牌橫向捲軸

#### 2. 卡片尺寸大幅放大

| 位置 | 舊尺寸 | 新尺寸 |
|------|--------|--------|
| 出場寶可夢圖片 | 68px | **100px** |
| 備戰寶可夢圖片 | 62px | **78px** |
| 手牌圖片 | 54px | **72px** |
| 手牌容器 | 58px | **76px** |
| zone-active 寬度 | 195px | **250px** |
| bench-slot 最大寬 | 80px | **95px** |

#### 3. 卡片放大功能（Zoom Overlay）

**觸發方式**：點擊任何卡片圖片（鼠標顯示為 🔍 zoom-in）
**關閉方式**：點擊暗色背景 / 點擊 ✕ 按鈕 / 按 Escape 鍵

**Zoom Modal 顯示內容**：
- 大圖（260px 寬，右側為資訊面板）
- 卡名、HP badge、屬性 badge、子類型、Regulation Mark
- 進化來源（若有）
- 特性（紅色 label + 名稱 + 效果文字）
- 每個招式（能量 pip + 招式名 + 傷害值 + 效果文字）
- 訓練家/能量牌的 rulesText
- 弱點（×2）、撤退費用（能量 pip）

**實作細節**：
- `let zoomCard = $state<Card | null>(null)` — 新增 UI 狀態
- `openZoom(cardId: string)` — 從 pool 取 Card 存入 zoomCard
- `<svelte:window onkeydown={onGlobalKey} />` — ESC 關閉（同時也清空 selectionPicked）
- 能量牌選取模式中點圖片不觸發 zoom（避免衝突）

#### 4. 規則對照確認（不動 engine，延後到 M3）

已確認以下規則均已正確實裝於 engine.ts：
- 先手第1回合：不攻擊、不進化、不抽牌 ✅
- 每回合限制：1張能量、1張支援者、1次撤退 ✅
- 弱點 ×2、ex 被擊倒給2張獎勵牌 ✅
- 三種勝利條件（獎勵牌/無牌可出/抽不到牌）✅

以下項目規劃**延後至 M3 補齊**：
- 抗性（Resistance，通常 -30）
- 狀態異常（毒/麻痺/睡眠/灼傷）
- 道具牌（Tool）效果
- 競技場牌（Stadium）效果
- 特殊能量完整處理

### 修改檔案
| 檔案 | 變更 |
|:---|:---|
| `src/routes/game/+page.svelte` | Play Mat 佈局、卡片尺寸放大、Zoom Overlay、`<svelte:window>` |

### Commits
- `8c02bf6` feat: redesign battle UI to official PTCG play mat layout
- `（本 session）` feat: card zoom overlay + larger cards in battle UI

---

## 🔮 下一步：M3 多人連線對戰

### M3 規劃

| Phase | 內容 |
|-------|------|
| **A — 房間系統** | 建立/加入房間（4碼房號）、等待對手入場 |
| **B — 狀態同步** | Firestore 儲存 GameState，雙方 `onSnapshot` 即時更新 |
| **C — 行動驗證** | 只有輪到自己才能送出動作（Firestore rules + client guard）|
| **D — 重連/斷線** | 離開後可回來繼續、逾時自動棄局 |

### 技術重點
- **引擎已是純函式**（`applyAction → new state`），GameState 可直接序列化到 Firestore
- **pool 不進 GameState**（避免爆炸），雙方各自在本地建立
- **行動送出方式**：本地先 `applyAction` 驗證合法性 → 寫 action 到 Firestore → 對方監聽到後也 `applyAction` 同步
- **已有 Firestore** `users/{uid}/decks/{deckId}` 結構，M3 新增 `rooms/{roomId}` collection
- **Anonymous Auth** 已啟用，uid 可直接用來識別玩家身分

### Firebase 部署指令（Windows）
```
cd E:\ptcg-tw-sim
node node_modules\firebase-tools\lib\bin\firebase.js deploy --only firestore:rules --project ptcg-tw-sim
```

---

## 📝 2026-04-19 Session 13 — M3 線上連線對戰（Firestore 房間系統）

> 觸發：接續 M2 規劃，實裝 M3 Phase A（房間建立/加入）+ Phase B（GameState 即時同步）

### 新增檔案

| 檔案 | 用途 |
|:---|:---|
| `src/lib/game/room.ts` | Firestore 房間 CRUD：`createRoom` / `joinRoom` / `subscribeRoom` / `pushGameState` |

### 修改檔案

| 檔案 | 變更 |
|:---|:---|
| `firestore.rules` | 新增 `rooms/{roomCode}` 規則：read=已登入用戶；create=hostUid 必須等於 auth.uid；update=host 或 guest |
| `src/lib/game/types.ts` | `SEND_NEW_ACTIVE` action 加入選填欄位 `senderIdx?: 0 \| 1` |
| `src/lib/game/actions.ts` | `sendNewActive()` 支援傳入 `senderIdx` |
| `src/lib/game/engine.ts` | `SEND_NEW_ACTIVE` 改用 `action.senderIdx ?? aIdx`（線上模式可明確指定送出方）；移除誤植的 `PlayerState.energyAttached` 存取（TS 編譯錯誤修正）|
| `src/routes/game/+page.svelte` | 新增模式選擇畫面（本機 / 線上）；線上 Lobby 三步驟（choose→create/join→room）；Firestore `onSnapshot` 即時同步 GameState；`isMyTurn` / `isMyDefenderTurn` derived 防止非行動方操作；`isSyncing` 狀態指示器 |

### 線上對戰流程

```
Host 建立房間 → 取得 4 碼房號 → 等待 Guest 加入
Guest 輸入房號 → joinRoom() → Firestore status='ready'
Host onSnapshot 收到 'ready' → createGame() → pushGameState()
雙方 onSnapshot 收到 gameState → 更新 UI
任一方 dispatch(action) → applyAction() → pushGameState() → 對方 onSnapshot 更新
```

### Room Schema（`rooms/{roomCode}`）

```ts
{
  hostUid: string, hostName: string, hostDeckEntries: [...],
  guestUid: string|null, guestName: string|null, guestDeckEntries: [...]|null,
  gameState: GameState|null,
  status: 'waiting'|'ready'|'playing'|'ended',
  createdAt, updatedAt
}
```

### 已知限制 / 待處理（M3 Phase C/D）

- [ ] **Phase C**：Firestore Rules server-side 行動驗證（目前只有 client guard）
- [ ] **Phase D**：斷線重連（離開後重新訂閱房間可繼續）、逾時棄局機制
- [ ] 兩人在同一台裝置各開分頁測試 OK；不同裝置測試待驗證

### Bug 修復

**Bug 1**：建立房間時出現「Missing or insufficient permissions.」

**根因**：`firestore.rules` 雖然已寫好 `rooms/{roomCode}` 規則，但從未 deploy 到 Firebase，Firestore 仍使用舊規則（只允許 `users/{uid}/decks/{deckId}`）。

**修復**：執行 `npx firebase-tools deploy --only firestore:rules --project ptcg-tw-sim` 部署規則後解決。

---

**Bug 2**：加入房間時出現「Missing or insufficient permissions.」

**根因**：原本的 update 規則只允許 `auth.uid == hostUid || auth.uid == guestUid`。但 guest 加入時 `guestUid` 欄位還是 `null`，guest 的 uid 不符合任何條件，所以 `updateDoc` 被 Firestore 拒絕。

**修復**：在 update 規則加入第三個條件——若房間 `status == 'waiting'` 且 `guestUid == null`，且更新內容把 `guestUid` 設為自己的 uid，則允許：
```js
|| (resource.data.status == 'waiting'
    && resource.data.guestUid == null
    && request.resource.data.guestUid == request.auth.uid)
```
部署後解決（commit `35abe02`）。

### Commits

- `3dd8406` feat(game): M3 線上對戰 — Firestore 房間系統 + 即時同步
- `35abe02` fix(firestore): allow guest to join waiting room
- `c72dde9` fix(game): 固定視角 — 自己永遠在下方，對手永遠在上方

---

**Bug 3**：線上對戰時視角會隨回合切換（對手回合看不到自己手牌）

**根因**：盤面用 `activePlayer`（當前行動玩家）當「我方」、`defenderPlayer`（防守方）當「對手」，導致每次 END_TURN 後兩者互換，線上雙方視角對調。

**修復**：新增 `myIdx`/`oppIdx`/`myPlayer`/`oppPlayer` derived：
- **線上模式**：`myIdx = myPlayerIndex`（固定），自己永遠在下方
- **本機模式**：`myIdx = aIdx`（跟隨行動方），維持原本 pass-and-play 翻轉行為
- 盤面上方改用 `oppPlayer`，下方改用 `myPlayer`，手牌永遠顯示 `myPlayer.hand`
- `aIdx`/`activePlayer` 保留，僅用於動作邏輯（attack/draw/endTurn 的 `isMyTurn()` 判斷）

---

## 📝 2026-04-19 Session 14 — 自動抽牌 + 補齊訓練家效果 + 固定視角

### 自動抽牌
- `engine.ts` 新增 `applyAutoDraw()` helper
- `END_TURN` 結束後直接呼叫，`turnPhase` 不再停在 `'draw'`，直接進入 `'main'`
- 先手第 1 回合本已自動跳過抽牌（FINISH_SETUP 直接設 `turnPhase: 'main'`），不受影響
- UI 移除「📥 抽牌」按鈕

### 視角固定（線上模式）
- 新增 `myIdx` / `oppIdx` / `myPlayer` / `oppPlayer` derived
- **線上模式**：`myIdx = myPlayerIndex`（固定），自己永遠在下方，對手在上方
- **本機模式**：`myIdx = aIdx`（隨行動方），維持原本 pass-and-play 翻轉行為
- 手牌列永遠顯示 `myPlayer.hand`（對手回合也看得到自己的牌）

### 新增 PendingSelection 類型（types.ts）
| 類型 | 用途 |
|:---|:---|
| `opp-bench-choose` | 選對手備戰寶可夢 |
| `discard-search` | 從棄牌區選擇 |
| `hand-choose` | 從手牌選擇（不丟棄） |

### 新增訓練家效果（effects.ts）
| 卡片 | 效果 |
|:---|:---|
| 莉莉艾的決意 | 手牌洗回 + 抽 6（獎勵牌滿 6 時抽 8）|
| 老大的指令 | 呼叫對手備戰 → 互換出場 |
| 高級球 | 丟 2 張手牌 → 搜尋任意寶可夢（2 步）|
| 超級信號 | 搜尋 ex 寶可夢加手牌 |
| 夜間擔架 | 從棄牌取 1 張寶可夢或能量加手牌 |
| 頂尖捕捉器 | 呼叫對手備戰 + 自己切換（2 步）|
| 能量回收器 | 從棄牌選最多 5 張基本能量洗回牌庫 |
| 奇跡修正檔 | 從棄牌取 1 張基本能量附於備戰（2 步）|
| 不公印章 | 雙方洗手牌，自己抽 5 對手抽 2（省略「上回合被擊倒」條件）|

### 未實裝（留下一版）
| 卡片 | 原因 |
|:---|:---|
| 神奇糖果 | 需要 Stage 2 跳進化 UI（hand-choose → 選目標 basic）|
| 龐克頭盔 / 氣球 | 寶可夢道具系統尚未建立 |
| 神秘花園 | 競技場（Stadium）系統尚未建立 |

### Commits
- `c72dde9` fix(game): 固定視角
- `1f53a54` feat(game): 自動抽牌 + 補齊訓練家效果

### ⚠️ 給下一位 AI 的注意事項

1. **Rules 一定要 deploy**：每次修改 `firestore.rules` 後必須執行下方指令，否則線上完全無效：
   ```
   cd E:\ptcg-tw-sim && npx firebase-tools deploy --only firestore:rules --project ptcg-tw-sim
   ```
2. **GameState 序列化**：`pushGameState` 已用 `JSON.parse(JSON.stringify(state))` 去除 `undefined` 欄位（Firestore 不接受 undefined）
3. **pool 不進 GameState**：雙方各自從靜態 JSON 建立 pool，不透過 Firestore 傳輸
4. **senderIdx 參數**：線上模式被擊倒後，防守方（`myPlayerIndex === dIdx`）送出新出場寶可夢時，需傳入 `senderIdx: myPlayerIndex`，否則會被引擎誤判為攻擊方操作
5. **Anonymous Auth**：`onMount` 已有 `signInAnonymously(auth)`，建立/加入房間前 uid 必然存在，無需另外處理

---

## 📝 2026-04-19 Session 15 — 招式效果系統 + 屬性能量修正

> 觸發：使用者回報「攻擊系統沒有完成，能量應該有分各種屬性」

### 問題根因

1. **能量屬性判斷錯誤**：`getEnergyProvided()` 只看 `card.pokemonType` 欄位。但 MBG/MBD 的能量卡（如「基本【惡】能量」）`pokemonType` 欄位為 `undefined`，導致所有能量被視為 Colorless，有色招式費用永遠湊不齊。

2. **ATTACK_PRE/ATTACK_POST 未實裝**：`engine.ts` 已預留鉤子（commits from previous sessions），但 `effects.ts` 尚未 export 這兩個 Map，build 會報錯。

### 修復方式

#### 1. 屬性能量修正（`engine.ts`）

新增 `ZH_ENERGY_TYPE` 對照表，從卡名 `【X】` pattern 推斷屬性：

```typescript
const ZH_ENERGY_TYPE: Record<string, EnergyType> = {
  '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning',
  '超': 'Psychic', '格': 'Fighting', '惡': 'Darkness', '鋼': 'Metal',
  '妖': 'Fairy', '龍': 'Dragon', '無': 'Colorless',
};
// getEnergyProvided 改為：pokemonType 優先，否則從卡名解析
```

#### 2. ATTACK_PRE/ATTACK_POST Map 實裝（`effects.ts`）

新增兩個 Map，共實裝 **13 個招式效果**（MBG/MBD 預組全部特殊招式）：

| 類型 | 招式 | 效果 |
|:---|:---|:---|
| PRE | 超級蒂安希ex \| 花冠射線 | 自動丟棄最多 2 個能量，造成 n×120 傷害 |
| PRE | 霜奶仙 \| 甜點圓陣 | 自己場上寶可夢數量 × 20 |
| PRE | 布魯皇 \| 致命刺擊 | 若對手戰鬥寶可夢有傷害指示物，+90（合計 180）|
| PRE | 黑暗鴉 \| 伏擊 | 擲硬幣，正面 +20（合計 30）|
| PRE | 烏鴉頭頭 \| 狙擊羽毛 | 丟棄 2 個能量，造成 120 傷害（M3 簡化：打出場，不支援備戰指定）|
| PRE | 勾魂眼 \| 動怒爪 | 自己備戰區有惡屬 Stage2 則 +70 |
| PRE | 桃歹郎ex \| 煩煩爆炸 | 對手已取獎勵牌數 × 60 |
| POST | 阿勃梭魯 \| 吸引 | 從牌庫抽 2 張 |
| POST | 小仙奶 \| 吸取之吻 | 自身回復 10 HP |
| POST | 超級耿鬼ex \| 空無強風 | 移動自身最後 1 個能量到玩家選擇的備戰寶可夢 |
| POST | 克雷色利亞 \| 充溢之光 | 從牌庫選最多 2 張基本能量附於自身（無傷害攻擊）|
| POST | 美洛耶塔 \| 治癒旋律 | 選備戰超寶可夢回復 120 HP（無傷害攻擊）|
| POST | 謎擬Q \| 呼朋引伴 | 從牌庫選 1 隻基礎寶可夢放備戰（無傷害攻擊）|

#### 3. 新增 Resolvers

| Key | 功能 |
|:---|:---|
| `gengar-move-energy` | 把暫存的能量 CardInstance 附到玩家選擇的備戰寶可夢 |
| `cresselia-attach-energy` | 把選取的能量從牌庫附到自身出場寶可夢（並洗牌）|
| `heal-120-bench` | 選定備戰寶可夢回復 120 HP |

#### 4. endTurnAfter 機制

RESOLVE_SELECTION 加入 `endTurnAfter` 支援：若 `params.endTurnAfter === true`，選擇解析後設 `turnPhase: 'end'`（目前 ATTACK 後 turnPhase 已是 'end'，此機制為訓練家互動效果保留）。

### 架構說明（給下一位 AI）

```
ATTACK handler 流程：
1. canAffordAttack → 能量足夠才繼續
2. ATTACK_PRE.get(`${cardName}|${attackName}`) → { state, damage }（丟棄能量 / 計算倍數）
3. 弱點 ×2（只對有傷害的招式套用）
4. 施加傷害 → 擊倒判定（pendingPrizes, turnPhase='end'）
5. ATTACK_POST.get(...) → GameState（回復 / 移動能量 / 觸發 pendingSelection）
```

- **POST + pendingSelection 共存**：攻擊 KO 後 `pendingPrizes > 0`，若同時有 pendingSelection，玩家必須先 RESOLVE_SELECTION，再 TAKE_PRIZES，最後 END_TURN（engine 在 pendingSelection 存在時只允許 RESOLVE_SELECTION 動作）。
- **snipe 簡化**：狙擊羽毛目前只打對手出場（不支援備戰指定），M4 可改為觸發 `opp-target-choose`。
- **花冠射線自動丟棄**：自動取最多 2 個能量（不讓玩家選），貪婪策略。若日後需互動，改為 PRE 觸發 pendingSelection（需修改 engine 架構）。

### 未實裝（留 M4）
| 項目 | 說明 |
|:---|:---|
| 神奇糖果 | Stage 2 跳進化（hand-choose → 找目標 basic）|
| 龐克頭盔 / 氣球 | 道具牌（Tool）系統 |
| 神秘花園 | 競技場（Stadium）系統 |
| 無極汰那|力量猛攻 | 反面時「下回合不能攻擊」狀態旗標 |
| 拉帝亞斯ex|無限之刃 | 「下回合不能攻擊」|
| 狙擊羽毛備戰指定 | 需要 opp-target-choose 類型（含 active+bench）|

### Commit
- `f3506f1` feat(game): 招式效果系統 + 屬性能量修正

---

## 📝 2026-04-19 Session 16 — 進化修復 + 棄牌查看 + 無備戰敗局 + UI 放大

> 觸發：使用者回報進化按不了、看不到棄牌、UI 太小；另要求無備戰時自動判敗

### 問題與修復

#### 1. 進化按鈕無法使用（`+page.svelte`）

**根因**：`.bench-slot` 設有 `overflow:hidden`，且 `.field-row` 也有 `overflow:hidden`。`position:absolute` 的 `.evo-menu` 會被這兩層裁切，完全看不到也按不到。

**修復**：棄用 `showEvoMenu` inline dropdown 方案。改用全域 `floatingEvoMenu` 狀態（`{fromIid, evoOpts, x, y}`），搭配 `position:fixed` 浮動覆蓋層，用 `getBoundingClientRect()` 定位在觸發按鈕正上方。backdrop 覆蓋全螢幕用來接收點外關閉事件。

#### 2. 棄牌區無法查看（`+page.svelte`）

**修復**：雙方棄牌格（`.disc-pile`）加 `onclick`，開啟 `viewDiscardFor` Modal。Modal 複用現有 `.zoom-overlay` 樣式，以倒序顯示棄牌（最近丟的在最前），點卡可開啟 Zoom 檢視。

#### 3. 無備戰寶可夢敗局判定（`engine.ts`）

**根因**：ATTACK handler 擊倒後只設 `pendingPrizes` 及 `turnPhase:'end'`，沒有檢查防守方備戰是否已空。UI 會顯示「請送出寶可夢」但備戰為空，玩家無從操作。

**修復**：KO 判定後立即檢查 `defenderState.bench.length === 0`，若成立則直接回傳 `phase:'game-over'`，跳過 TAKE_PRIZES / SEND_NEW_ACTIVE 流程。

#### 4. UI 整體放大

| 元素 | 舊值 | 新值 |
|:---|:---|:---|
| 出場寶可夢圖 | 100px | 120px |
| 備戰寶可夢圖 | max-width 78px | 96px |
| 手牌圖 | 72px | 88px |
| 手牌格寬 | 76px | 92px |
| `zone-active` 寬 | 250px | 300px |
| HP 條高 | 6px / 4px | 8px / 5px |
| `active-card` min-height | 105px | 130px |
| 名稱字型 | .9rem | 1rem |
| HP 字型 | .78rem | .88rem |
| 手牌名稱字型 | .6rem | .68rem |
| 按鈕字型 | .82rem | .9rem |
| `.bench-slot overflow` | hidden | visible（bench-empty 保留 hidden）|

### Commit
- `06f1bd9` feat: 進化選單修復、棄牌區查看、無備戰敗局判定、UI 放大

---

## 📝 2026-04-19 Session 17 — 道具牌/競技場/神奇糖果/無法攻擊全實裝

> 觸發：使用者問「下一步」，補完 MBG/MBD 預組所有未實裝效果

### 已實裝

#### 1. 道具牌系統（Pokémon Tool）

`engine.ts` PLAY_TRAINER 新增 Tool 分支：
- Tool 卡（`supertype:'Pokemon', subtype:'Other'`）現在可從手牌打出
- 打出後不進棄牌區，改觸發 `pendingSelection` 選擇附加目標
- 附加後儲存於 `CardInstance.toolAttached`（原有欄位）
- `getPlayableTrainers` 現在也回傳 Tool/Stadium 卡的 iid

**氣球** 效果：
- `canRetreat` 計算時若出場有氣球，retreat cost -2（最低 0）
- RETREAT handler 同樣扣減
- `retreatCostOf()` UI 函式也已同步

**龐克頭盔** 效果：
- ATTACK handler 在施加傷害後立即檢查防守方出場是否為【惡】且附有龐克頭盔
- 若成立，對攻擊方出場放置 40 傷害指示物並記錄 log

#### 2. 神奇糖果（Rare Candy）

兩步 resolver 流程：
1. `hand-choose` 選手牌中的 Stage 2 / ex（有 evolvesFrom）
2. `rare-candy-choose-target` resolver：查出 Stage 1 的 evolvesFrom 找到目標 Basic，以 `heal-target + validIids` 過濾顯示場上合法基礎
3. `rare-candy-evolve` resolver：繼承傷害/能量/道具/狀態，`evolvedThisTurn: true`

**資料修正**：`MBG.json` 超級耿鬼ex `evolvesFrom` 從 "耿鬼ex"（不存在）改為 "鬼斯通"。

#### 3. 神秘花園（Stadium 競技場）

- Stadium 卡打出後放置於 `GameState.activeStadium`（前一張競技場丟棄牌區）
- 標頭 status-chips 顯示 「🏟 神秘花園」 chip
- 新增 `USE_STADIUM` action（`GameActions.useStadium()`）
- 每位玩家每回合可使用 1 次（`stadiumUsedThisTurn: [boolean, boolean]`）
- **神秘花園效果**：手牌棄 1 能量 → 從牌庫抽牌，直到手牌數 = 場上超屬寶可夢數
- UI：主階段出現「🏟 神秘花園」按鈕（己方回合、未使用時）

#### 4. 無法攻擊效果

- `CardInstance.cantAttackThisTurn?: boolean`
- **無極汰那|力量猛攻**（ATTACK_POST）：擲硬幣，反面時設旗標
- **拉帝亞斯ex|無限之刃**（ATTACK_POST）：固定設旗標
- ATTACK handler 開頭檢查旗標：若設定 → 清除旗標 + log + 強制 `turnPhase:'end'`

#### 5. UI 更新

- 道具卡手牌顯示「🔧 附加」按鈕（黃色）
- 競技場手牌顯示「競技場」按鈕
- 出場/備戰寶可夢顯示 🔧 道具 chip
- `selectionItems` 新增 `validIids` 過濾支援（`heal-target`、`hand-choose`）
- `hand-discard` 新增 `filter:'Energy'` 支援

### 架構說明（給下一位 AI）

- `EffectFn` 型別（effects.ts）第 4 個參數為 `cardInst?: CardInstance`，Tool/Stadium 打出時傳入該卡實例
- Tool 效果 resolver 從 `params.toolInst` 取得卡片實例（整個 CardInstance 物件序列化存入 params）
- Stadium 效果由 `USE_STADIUM` action 觸發（不是 PLAY_TRAINER），支援未來不同競技場效果

### Commits
- `aad0ef2` feat: 道具牌/競技場/神奇糖果/無法攻擊效果全實裝

---

## 📝 2026-04-19 Session 18 — 特性系統 + 特殊狀態 + KO 道具丟棄修復

### 新增機制

#### 1. USE_ABILITY 行動（主動特性）

- `types.ts`：`GameAction` 新增 `{ type: 'USE_ABILITY'; iid: string; abilityIndex: number }`
- `types.ts`：`CardInstance` 新增 `abilityUsedThisTurn?: boolean`（每回合限用 1 次）
- `types.ts`：`PendingSelection.type` 新增 `'opp-poke-choose'`（選對手任意寶可夢，含出場）
- `engine.ts`：USE_ABILITY handler（驗證旗標 → 呼叫 ABILITY_EFFECTS → 標記 abilityUsedThisTurn）
- `engine.ts`：END_TURN 清除全場 abilityUsedThisTurn
- `engine.ts`：新增 export `getUsableAbilities(state, pool)` → `{iid, abilityIndex, pokemonName, abilityName}[]`
- `effects.ts`：`ABILITY_EFFECTS = new Map<string, EffectFn>()` + `regA()` helper
- `actions.ts`：新增 `GameActions.useAbility(iid, abilityIndex)`

#### 2. 已實裝主動特性

| 寶可夢 | 特性 | 效果 |
|:---|:---|:---|
| 米立龍 | 集客 | 只限出場使用；查看牌庫頂 6 張，選 1 張支援者加手牌，其餘洗回 |
| 桃歹郎ex | 支配鎖鏈 | 選備戰惡寶可夢（桃歹郎ex除外）→ 換出場 + 中毒 |

#### 3. 已實裝被動特性（inline in engine.ts）

| 寶可夢 | 特性 | 效果位置 |
|:---|:---|:---|
| 超級耿鬼ex | 影藏 | ATTACK KO 判定前：inex 攻擊者擊倒惡寶可夢時 prizesForKO-1 |
| 超級蒂安希ex | 鑽石膜 | ATTACK 弱點後：受到招式傷害 -30 |
| 拉帝亞斯ex | 天空徑線 | canRetreat + RETREAT：場上有此特性時所有基礎寶可夢免費撤退 |

#### 4. 特殊狀態（5 種）

`CardInstance.status?: SpecialCondition`（`'poisoned'|'burned'|'asleep'|'confused'|'paralyzed'`）

| 狀態 | ATTACK 限制 | END_TURN 效果 |
|:---|:---|:---|
| 中毒 | 無 | +10 傷害，可 KO |
| 燒傷 | 無 | +20 傷害，擲硬幣正面解除 |
| 睡眠 | 無法攻擊、無法撤退 | 擲硬幣正面醒來 |
| 混亂 | 擲硬幣反面 → 自傷 30 + 攻擊失敗 | 無 |
| 麻痺 | 無法攻擊、無法撤退 | 自動解除 |

#### 5. KO 道具丟棄修復

**Bug**：寶可夢被擊倒時，附加的道具卡沒有跟著丟棄。
**修復**：`engine.ts` KO 區段的 `koDiscard` 陣列加入 `toolAttached`。
**同樣修復適用**：ATTACK 一般 KO、狙擊羽毛(snipe-120 resolver)、中毒/燒傷 KO。

#### 6. 狙擊羽毛完整實裝（取代 Session 15 的簡化版）

- **PRE**：丟棄 2 個能量，damage=0
- **POST**：若對手只有出場（無備戰）→ 直接對出場施加 120；若有備戰 → 觸發 `opp-poke-choose`（含出場+備戰）
- resolver `snipe-120`：對選擇目標施加 120，備戰目標不計弱點

#### 7. 無極汰那|敲壞 完整實裝

**POST**：丟棄 `state.activeStadium`，清除 `stadiumUsedThisTurn`

### Commits
- `342b5fa` feat: ability system + all special conditions + complete attack effects

---

## 📝 2026-04-19 Session 19 — AI 對手

### 新增檔案

| 檔案 | 用途 |
|:---|:---|
| `src/lib/game/ai.ts` | 規則型 AI `getAIAction(state, pool) → GameAction \| null` |

### AI 策略優先序

1. 取獎勵牌（`pendingPrizes > 0`）
2. 解析 pendingSelection（autoResolveSelection）
3. 送出新出場（被擊倒後）
4. Setup 階段（選出場 → 備戰 → FINISH_SETUP）
5. 主階段：進化 → 打基礎（備戰<3）→ 附能量 → 訓練家（支援者優先）→ 特性 → 攻擊（最高傷害）→ END_TURN

### autoResolveSelection 行為

| PendingSelection 類型 | AI 選擇邏輯 |
|:---|:---|
| deck-search | 優先 HP 最高的寶可夢 / 支援者優先 |
| bench-choose | 選第一個（`validIids` 限制已套用）|
| opp-bench-choose | 選剩餘 HP 最少的（最容易擊倒）|
| opp-poke-choose | 同上（含出場）|
| hand-discard | 能量 > 訓練家 > 寶可夢 |
| hand-choose | 選第一個 |
| heal-target | 選傷害最多的（最需治療）|
| discard-search | 選前 n 個符合條件的 |

### UI 整合（`+page.svelte`）

- `aiPlayerIndex = $state<0|1|null>(1)`（預設 P2 為 AI）
- `aiThinking / aiTimer`：防止 AI 連擊
- `scheduleAI() / tickAI()`：首步 500ms，後續 250ms
- `$effect` 監聽 game state 變化自動觸發 AI
- Local Lobby：P2 欄位有 AI checkbox（預設打勾）
- 標頭顯示「AI 思考中…」脈衝 chip

### Commits
- `342b5fa` feat: ability system + all special conditions + complete attack effects（AI 包含在同一 commit）

---

## 📝 2026-04-19 Session 20 — 全卡片效果審計 + 6 個 Bug 修復

### 審計範圍
MBG（超級耿鬼ex 預組）+ MBD（超級蒂安希ex 預組）共 46 種卡牌效果逐一對照。

### 發現並修復的 Bug

| 嚴重度 | 位置 | 問題 | 修復 |
|:---:|:---|:---|:---|
| 🔴 致命 | `engine.ts` ATTACK | `prizeAdjust` 計算在 `newDamage` / `defenderHP` 宣告之前使用（Temporal Dead Zone → 每次攻擊 ReferenceError） | 重排程式順序 |
| 🔴 重大 | `engine.ts` TAKE_PRIZES | 勝利條件 `prizes.length - count <= 0`：slice 後 length 已扣 count，再減 count → 取 2 張剩 3 張時觸發假勝利 | 改為 `prizes.length <= 0`；log 計數同步修正 |
| 🟡 次要 | `effects.ts` | `奇跡修正檔` hasEnergy guard：`discard.some(() => true)` 永遠為 true | 改為 `pool.get(...).supertype === 'Energy'` |
| 🟡 次要 | `effects.ts` | `能量回收器` 同樣問題 | 同上 |
| 🟡 次要 | `effects.ts` | `美洛耶塔\|治癒旋律` bench-choose 未傳 `validIids` → 可選非超屬性寶可夢 | 加入 `params: { validIids: psychicBench.map(c => c.iid) }` |
| 🟡 次要 | `+page.svelte` | `selectionItems` 的 `bench-choose` 完全忽略 `params.validIids` → `支配鎖鏈` / `治癒旋律` 限制在 UI 無效 | 加入 validIids 過濾邏輯 |

### 全卡驗證結論
- MBG 所有卡片（22 張）效果正確 ✅
- MBD 所有卡片（24 張）效果正確 ✅
- 特殊狀態（5 種）✅、被動特性（3 種）✅、道具（2 種）✅、競技場 ✅

### Commits
- `2ae246b` fix: card effect audit — 6 bugs patched across engine, effects, and UI

---

## 🔮 下一步（M3 + 後續）

### 目前完成度
- ✅ **M0**：卡片資料（35 sets，標準賽 24 sets）
- ✅ **M1**：牌組編輯器（localStorage + Firestore 雲端同步）
- ✅ **M2**：規則引擎（MBG/MBD 全卡效果）+ AI 對手 + 線上對戰基礎（Firestore 房間）

### M3 尚待完成
- [ ] Firestore Rules server-side 行動驗證（目前只有 client guard）
- [ ] 斷線重連機制（離開後重新訂閱可繼續）
- [ ] 不同裝置測試（目前僅同台分頁測試）

### 可選下一步
1. 新增第三個預組牌組（繼續壓測引擎）
2. UI/UX 優化（硬幣動畫、行動歷史面板）
3. M4：規則引擎嚴謹化（抗性、更多 ex/V/VMAX 規則）
4. M5：卡片池擴充（更多 set 的效果實裝）

### ⚠️ 給下一位 AI 的注意事項

1. **每次修改 `firestore.rules` 都必須 deploy**：
   ```
   cd E:\ptcg-tw-sim && npx firebase-tools deploy --only firestore:rules --project ptcg-tw-sim
   ```
2. **效果 key 格式**：ATTACK_PRE/POST = `「寶可夢名|招式名」`，ABILITY_EFFECTS = `「寶可夢名|特性索引數字」`
3. **pool 不進 GameState**：雙方各自在本地從靜態 JSON 建立，不透過 Firestore 傳輸
4. **Svelte 5 runes**：`$state`、`$derived`、`$derived.by`、`$effect`，不用舊式 `$:` 宣告
5. **本檔為接力文件**：每次工作前先讀它，工作結束後把本次動作追加到最下方

---

## 📝 2026-04-19 Session 21 — 修復線上對戰視角 Bug（雙方看到同一畫面）

> 觸發：使用者回報「對戰時兩個玩家都變成了同一個畫面，之前沒有這個 bug」

### Bug 根因

Session 19 引入 AI 對手時，`aiPlayerIndex = $state<0|1|null>(1)` 預設為 `1`（P2 是 AI，方便本機測試），但進入線上模式時從未將其重置為 `null`。

三個視角相關 derived（`myIdx` / `isMyTurn` / `isMyDefenderTurn`）的判斷順序為「AI 優先 → 線上次之」：

```ts
const myIdx = $derived<0 | 1>(
  aiPlayerIndex !== null ? ((1 - aiPlayerIndex) as 0 | 1) :  // ← 線上模式被這行攔截
  myPlayerIndex !== null ? myPlayerIndex : aIdx
);
```

結果 Host（`myPlayerIndex=0`）和 Guest（`myPlayerIndex=1`）都被 `aiPlayerIndex=1` 攔截，雙方 `myIdx = 1 - 1 = 0`，**兩台都顯示 P1 視角**，看起來像同一個畫面。同理 `isMyTurn` / `isMyDefenderTurn` 也會把線上雙方當成「對 AI」處理。

### 修復（`src/routes/game/+page.svelte`）

在三個 derived 中加入 `mode === 'online'` 優先分支，確保線上模式永遠以 `myPlayerIndex` 決定視角：

```ts
const myIdx = $derived<0 | 1>(
  mode === 'online' ? ((myPlayerIndex ?? 0) as 0 | 1) :  // ← 線上優先
  aiPlayerIndex !== null ? ((1 - aiPlayerIndex) as 0 | 1) :
  myPlayerIndex !== null ? myPlayerIndex : aIdx
);
```

`isMyTurn` / `isMyDefenderTurn` 同樣把 `mode === 'online'` 分支放到最前，使用 `myPlayerIndex` 判定 setup 階段、pendingSelection actorIdx、防守方送寶可夢等邏輯。

本機 AI / 本機雙人模式邏輯維持不變。

### 驗證

- `npm run build` ✅ 通過（SvelteKit adapter-static）
- 預期行為：Host 開房、Guest 加入後，兩台各自看到自己的手牌在下方、對手在上方；標頭 role-chip 顯示「我是 P1 先手」/「我是 P2 後手」

### Commit
- `（本 session）` fix(game): 線上對戰視角修復 — 雙方看到同一畫面（Session 19 regression）

### ⚠️ 給下一位 AI 的注意事項

- `aiPlayerIndex` 預設為 `1` 是刻意保留（本機 lobby 的 AI 勾選預設開啟），**不要**把它改成 `null` 預設值 — 那會讓本機新玩家看不到 AI checkbox 預勾
- 任何「依 mode 判斷視角／行動權」的 derived，`mode === 'online'` 分支都必須優先於 `aiPlayerIndex` 分支
- 進線上 Lobby（`mode='online'`）時**不需**重置 `aiPlayerIndex`，因為 derived 已把 mode 納入考量，且 `scheduleAI()` (line 131) 也有 `mode === 'online'` guard 防止 AI 在線上觸發

---

## 📝 2026-04-19 Session 22 — 遊戲體驗大修（8 項）

> 觸發：使用者回報多項規則/UI 缺失 — 撤退按不到、卡片詳情看不出當前狀態、缺先後手擲硬幣、缺 HUD 每回合資源顯示、特性已用沒標示、義務性效果可白打、setup 依序不同時 + 無 mulligan 補抽

### 1. 撤退 bug 修復（UI overflow 裁切）

**根因**：`retreat-picker` 使用 `position:absolute; bottom:100%` 放在 `.zone-active.my-active-zone` 內，但 `.playmat` / `.field-row` 有 `overflow:hidden`，picker 按鈕被裁切到看不見也點不到（跟 Session 16 修進化選單同一問題）。

**修復**：改用 `position:fixed` 的浮動覆蓋層 `floatingRetreatMenu`，仿 `floatingEvoMenu` 模式：
- 撤退按鈕 `onclick` 用 `getBoundingClientRect()` 取得位置 → 開啟浮動選單
- `.float-evo-menu` 共用樣式
- Escape 鍵 / 點背景 / dispatch 後自動關閉

### 2. 卡片 zoom modal 顯示場上實例狀態

**新增**：`CardInstance.evolvedFromCardIds?: string[]`（進化鏈堆疊）。`EVOLVE` handler 與 `rare-candy-evolve` resolver 在進化時 push 被進化卡的 cardId。

**zoom modal 新增「📍 場上狀態」面板**（僅在 `zoomInst` 非 null 時顯示）：
- HP 剩餘/總量 + 傷害值
- 附加能量（顯示簡名 chip）
- 附加道具（🔧）
- 特殊狀態（☠️/🔥/💤/😵/⚡）
- 進化鏈（A→B→當前）
- 本回合已使用特性（✨）
- `justPlaced` / `evolvedThisTurn` / `cantAttackThisTurn` 旗標

`openZoom(cardId, inst?)` 第二個參數傳入 CardInstance；出場 / 備戰 / 棄牌區查看都傳 inst。

### 3. 開戰擲硬幣決定先後手

- `GameState` 新增 `firstPlayerIdx: 0 | 1`
- `createGame` 用 `Math.random() < 0.5` 決定先手方，log 輸出「🪙 擲硬幣：XXX 先手」
- 所有原本硬編碼 `aIdx === 0`（先手 P1 第 1 回合禁攻擊）改為 `aIdx === state.firstPlayerIdx`
- `getAvailableAttacks` / UI hint 同步修正

### 4. HUD 每回合資源狀態列（新 UI）

header 新增 `.turn-res` 固定顯示 4 格（顯示 activePlayer 狀態）：
- ⚡ 填能 · 📋 支援者 · 🔄 撤退 · 🏟 競技場
- 每格：圖示 + 名稱 + 「可用/已用」狀態（綠背景=可用、紅背景=已用）
- END_TURN 後旗標自動重置 → 顯示自動更新

### 5. 已用特性圖示

新增 `CardInstance.abilityUsedThisTurn` 的視覺化：
- Active 寶可夢：`.ab-used-chip`（紫色 chip「✨已用特性」）
- Bench 寶可夢：小版 ✨ 圖示
- 雙方都顯示（方便看對手狀態）

### 6. 義務性效果系統（TRAINER_GUARDS）

**新增** `TRAINER_GUARDS: Map<string, (st, idx, pool) => boolean>` + `canPlayTrainer()` helper：若 guard 回傳 false，該卡從 `getPlayableTrainers` 過濾掉，`PLAY_TRAINER` handler 也直接 return state 不處理。

**已註冊 guards**：
| 卡片 | Guard |
|:---|:---|
| 夜間擔架 | 棄牌區至少有 1 張寶可夢或能量 |
| 能量回收器 | 棄牌區至少 1 張基本能量 |
| 奇跡修正檔 | 棄牌有能量 **且** 備戰有超屬寶可夢 |
| 寶可夢交替 / 急進開關 | 備戰有寶可夢 |
| 老大的指令 / 頂尖捕捉器 | 對手備戰有寶可夢 |
| 高級球 | 手牌 ≥ 3（扣本卡後能再丟 2） |
| 好傷藥 | 場上至少 1 隻有傷害且有能量 |
| 龍之秘藥 | 場上至少 1 隻有傷害 |

**minCount 強制選**：
- 夜間擔架：`minCount: 0 → 1`（必選）
- 能量回收器：`minCount: 0 → 1`（必選；maxCount = min(5, 棄牌基本能量數)）

### 7. Setup 同時抽牌 + Mulligan 補抽

**GamePhase 重構**：`'setup-p1' | 'setup-p2'` → `'setup'`（單一階段，雙方同時）

- `GameAction` 中 `PLACE_ACTIVE` / `BENCH_POKEMON` / `FINISH_SETUP` 新增 **必填** `senderIdx: 0 | 1`
- `handleSetup` 從 `action.senderIdx` 取玩家 index，檢查 `setupDone[idx]` 避免重複操作
- 雙方 FINISH_SETUP 都完成 → 進入 playing；否則 phase 維持 `'setup'`

**Mulligan 機制**：
- `dealOpeningHand` 回傳 mulligan 次數（7 張起手無基礎寶可夢時的重抽次數）
- `createGame` 根據 m1/m2 對**對手**自動補抽（PTCG 官方規則簡化版：省略詢問，理性玩家必選補抽）
- `GameState` 新增 `mulliganCounts: [number, number]` 欄位
- Setup 畫面顯示 `.mulligan-banner` 提示重抽次數與補抽結果

**UI setup 畫面**：
- setupIdx 由 mode + AI/myPlayerIndex + setupDone 決定（本機雙人：P1 完成後換 P2；AI 對手：AI 那邊由 `tickAI` 自動做；線上：各自看自己）
- 已完成的玩家看到「⏳ 等待對手完成準備…」
- `isMyTurn` / `isMyDefenderTurn` / `tickAI` / `$effect` 監聽全部改為 `phase === 'setup' && !setupDone[idx]`

**AI 改造**（[src/lib/game/ai.ts](src/lib/game/ai.ts)）：
- `getAIAction(state, pool, myIdx?)` 新增第三參數
- setup 階段用 `myIdx`（雙方同時，不看 activePlayerIndex）
- 正式階段仍用 `activePlayerIndex`
- `handleSetupAI` 接收 pIdx 參數，action 帶 `senderIdx: pIdx`

### 驗證
- `npm run build` ✅（SvelteKit adapter-static 通過，無 TS 錯誤）

### Commit
- `（本 session）` feat(game): 撤退 bug 修復、zoom 實例狀態、擲硬幣、HUD、特性標記、義務性 guard、setup 同時+mulligan

### ⚠️ 給下一位 AI 的注意事項

1. **setup action 必須帶 senderIdx**：`GameActions.placeActive(iid, senderIdx)` 等。舊代碼呼叫不帶 senderIdx 會 TS 錯誤。
2. **Mulligan 簡化版**：目前是「自動補抽」不詢問對手。若要改回官方「對手可選」，需加 `pendingMulliganChoice` pending 類型並擴充 UI。
3. **TRAINER_GUARDS 註冊位置**：緊貼 `reg('xxx', ...)` 之前，維持可讀性。guard 回傳 false 時此卡會從 `getPlayableTrainers` 過濾 → UI 看不到「使用」按鈕。
4. **進化鏈**：`evolvedFromCardIds` 只記錄 cardId（不是 iid），因為被進化掉的 CardInstance 已丟失，cardId 足以顯示名稱/圖片。
5. **firstPlayerIdx 欄位**：由 createGame 隨機決定後不再改變。`state.isFirstTurn && aIdx === state.firstPlayerIdx` 才是「先手第 1 回合」的正確判斷。

---

## 📝 2026-04-19 Session 23 — ex 基礎寶可夢 + Stage2 判斷 + 神奇糖果 guard + 進化鏈擊倒

> 觸發：使用者回報三個 bug — 拉蒂亞斯ex/蒂安希ex 無法出場、神奇糖果沒合法目標仍可打、附加道具/能量/進化鏈不能放大。要求主動找類似 bug。

### 🔴 核心 bug：所有 ex 基礎寶可夢無法出場

**根因**：全專案 9 處用 `subtype === 'Basic'` 判斷基礎寶可夢。但拉帝亞斯ex、蒂安希ex、桃歹郎ex 等 ex 基礎的 `subtype === 'ex'` 不是 `'Basic'`，導致：
- ❌ 不能作為出場寶可夢（PLACE_ACTIVE）
- ❌ 不能打到備戰（BENCH_POKEMON / PLAY_BASIC）
- ❌ Mulligan 判斷錯誤（起手 7 張若只有 ex 基礎，會被判斷為「無基礎」無限重抽）
- ❌ AI 的 setup 卡住
- ❌ Deck builder 驗證「至少 1 隻基礎」誤判純 ex 基礎牌組為非法
- ❌ 好友寶芬 / 赫普的包包 / 卡片搜尋時的 'Basic' / 'Basic:HP70' filter
- ❌ 天空徑線（拉帝亞斯ex 被動特性）對自己 ex 基礎無效

**修復**：新增 `isBasicPokemonCard(card)` helper（export 自 engine.ts）：
```ts
export function isBasicPokemonCard(card: Card | undefined): boolean {
  if (!card || card.supertype !== 'Pokemon') return false;
  if (card.subtype === 'Other') return false; // 道具卡
  return !card.evolvesFrom; // 沒進化來源 = 基礎
}
```

全專案統一用此 helper：[engine.ts:57](src/lib/game/engine.ts:57) / [validation.ts:21](src/lib/decks/validation.ts:21) / [ai.ts](src/lib/game/ai.ts) / [+page.svelte](src/routes/game/+page.svelte) 三個地方。

### 🟡 Stage2 判斷同樣 bug（動怒爪）

勾魂眼「動怒爪」+70 傷害條件為「自己備戰有惡屬 Stage2」，但寫成 `subtype === 'Stage2'`。Stage2 ex（超級耿鬼ex 是惡屬 Stage2 ex）的 subtype 是 `'ex'` → 效果失效。

**修復**：新增 `isStage2PokemonCard(card, pool)` helper — 判斷進化鏈深度 = 3（`evolvesFrom` 存在且其 Stage1 自己也有 `evolvesFrom`）。動怒爪改用此邏輯。

### 🟡 神奇糖果 guard

**Bug**：手牌中有 Stage2 但場上沒對應 Basic 時，使用者還能打出神奇糖果 → 進到 `rare-candy-choose-target` 後顯示「場上沒可接受的寶可夢」，**但支援者 flag 已設、卡已進棄牌**，形同被騙。

**修復**：註冊 `TRAINER_GUARDS['神奇糖果']` — 逐一檢查手牌 Stage2，對每張找 Stage1、再找 Stage1.evolvesFrom = Basic name，判斷場上是否有該 Basic（未剛放、未剛進化）。任一有合法目標才允許打出。

同時嚴格化手牌過濾：原本 `c.evolvesFrom && c.subtype !== 'Basic'` 會誤包括 Stage1（有 evolvesFrom 且非 Basic），改用 `isStage2` 精確過濾。

### 🟡 系統性檢查：Pokemon 搜尋 filter 漏排除道具卡

`f === 'Pokemon'` 與 `'PokemonOrEnergy'` filter 只看 `supertype === 'Pokemon'`，會包含道具卡（`subtype === 'Other'` 的寶可夢道具）。修正為排除 `subtype === 'Other'`。影響：甜蜜球、黑暗球、夜間擔架等。

### 🔴 進化鏈被擊倒時未進棄牌（違反 PTCG 官方規則）

**Bug**：Session 22 的 `evolvedFromCardIds: string[]` 只存 cardId，丟失了 Stage1 / Basic 的 CardInstance。寶可夢被擊倒時，只把頂層卡 + 能量 + 道具進棄牌，**進化鏈底下的卡「消失」**，違反 PTCG 規則（對手獎勵牌數以外的實物該全部回到棄牌區）。

**修復**：重構為 `evolvedFromStack: CardInstance[]`（保留完整裸殼 — 清空 energyAttached/toolAttached 因附加物轉給頂層）。所有 4 處 KO 處理（engine 正常擊倒 / 中毒致死 / 燒傷致死 / snipe-120 resolver）都加上 `...evolvedFromStack` 進棄牌。

### zoom modal：進化鏈 / 道具 / 能量可點擊放大

zoom modal 的「📍 場上狀態」面板中：
- **進化鏈節點**：從 `<span>` 改為 `<button class="clickable">`，點擊開啟該卡的 zoom（並帶入該卡實例，可繼續看其狀態）
- **附加能量 chip**：同樣改 button，點擊 zoom 該能量卡
- **附加道具**：tool-chip 改 button，點擊 zoom 該道具卡
- 樣式加 hover 效果（`.clickable:hover` 變亮）

### 系統性檢查未採取的項目（無實際 bug）

| 項目 | 結論 |
|:---|:---|
| EVOLVE handler 用 `!evoCard.evolvesFrom` 判基礎 | ✅ 正確（已用 evolvesFrom） |
| 搜尋 ex 寶可夢 `f === 'ex'` 用 `subtype === 'ex'` | ✅ 正確（ex 身份判斷） |
| `subtype === 'Supporter'` / `'Stadium'` | ✅ 正確（訓練家子類） |
| 切換類（寶可夢交替 / 急進開關）不檢查睡眠麻痺 | ✅ 正確（物品卡繞過狀態限制） |

### 驗證
- `npm run build` ✅
- 測試動作：用純 ex 基礎（拉蒂亞斯ex / 蒂安希ex）打牌組 → 可出場、可備戰、AI 能自動 setup
- 神奇糖果：手牌有 Stage2 但場上無對應 Basic → 「使用」按鈕消失
- zoom 出場 ex 寶可夢 → 點附加能量/道具/進化鏈 → 切換到該卡的 zoom

### Commit
- `（本 session）` fix(game): ex 基礎 + Stage2 + 神奇糖果 guard + 進化鏈擊倒 + zoom 樹狀

### ⚠️ 給下一位 AI 的注意事項

1. **判斷基礎寶可夢永遠用 `isBasicPokemonCard(card)`**，禁止直接 `card.subtype === 'Basic'`。PTCG 中 ex/V/VMAX 等亞種的基礎寶可夢 subtype 不是 'Basic'。
2. **判斷 Stage2 永遠用 `isStage2PokemonCard(card, pool)`**，原因同上。Stage1 可用 `card.evolvesFrom && !isStage2`。
3. **進化鏈資料**：`evolvedFromStack: CardInstance[]`（不是 cardIds）。擊倒時必須 `...target.evolvedFromStack ?? []` 進棄牌。未來新增 KO 處理要加這一行。
4. **ex 判斷（得 2 張獎勵）**：目前用 `name.endsWith('ex')` 或 `card.subtype === 'ex'`，兩者都可（因為 ex 寶可夢的 subtype 一定是 'ex'）。
5. **TRAINER_GUARDS 是防線**：打出前驗證，若漏加導致使用者白送卡/白送支援者 flag。新卡一定要想「需不需要 guard」。

---

## 📝 2026-04-19 Session 24 — 第三副預組（破空焰ex 火屬）+ 卡片審計

> 觸發：使用者接受 C→A→B 路線。Session 24 進入 C 階段：補第三副預組。

### 卡片審計報告
自動掃描 `static/cards/*.json` vs `effects.ts` 已註冊的 `reg/regPre/regPost/regA`，產生 [CARD_AUDIT.md](CARD_AUDIT.md)：
- **特性**：已實裝 2 / 未實裝 247
- **攻擊效果**：已實裝 16 / 未實裝 1599
- **訓練家/道具/競技場**：已實裝 30 / 未實裝 197

MBG/MBD 預組幾乎 100% 實裝可完整對戰，其他卡包多為未實裝。作為長期實裝追蹤表。

### 新預組：`__preset_fire__` 破空焰ex 火屬（60 張）
- 主力：3x 破空焰ex（MC, Basic ex HP 230, 烈火爆進 260）
- 副力：2x 萊希拉姆ex（MC, Basic ex HP 230）
- 進化鏈：4x 小火龍 + 2x 火恐龍、2x 燃燒蟲 + 2x 火神蛾、2x 爆焰龜獸
- 訓練家 29 張：全部沿用 MBG/MBD 已實裝的（reg 按名稱匹配，不看 id）
- 14x 基本【火】能量

### 新實裝 1 個效果
- **破空焰ex|烈火爆進**（ATTACK_POST）— 260 傷害 + 設 `cantAttackThisTurn`
  - 簡化：原文是禁用本招；目前退化為「下回合完全不能攻擊」。未來可擴充 `disabledAttacks?: string[]` 機制。

### Commits
- `d2c86d4` docs: CARD_AUDIT.md
- `7e1868b` feat(game): 第三副預組 + 烈火爆進

---

## 📝 2026-04-19 Session 25 A1 — 拖曳交互

### 實裝
取代原本「先點能量 → 再點目標」兩步流程，新增拖曳：
- 能量卡 → 拖到寶可夢 → `attachEnergy`
- 基礎寶可夢 → 拖到備戰空格 → `playBasic`
- 道具卡 → 拖到寶可夢 → `playTrainer` + 自動消費 `attach-tool` pendingSelection

### 技術
- **Pointer events**（非 HTML5 drag）— 觸控+滑鼠+鍵盤全支援
- `DRAG_THRESHOLD = 6px` 區分 click vs drag — 未達門檻保留原 onclick 行為
- `data-drop-type="poke" data-drop-iid="..."` 與 `data-drop-type="bench-empty"` 標記 drop target
- `document.elementsFromPoint` 即時偵測 hover 的 drop zone
- 浮卡隨滑鼠 + 旋轉 4° + 陰影；drop-zone（pulse 藍框）+ drop-hover（金框）雙層提示

### 關鍵邊界
- 道具 attach 流程：dispatch `playTrainer` → engine 進 `attach-tool` pendingSelection → UI 檢測 `effectKey==='attach-tool'` 且 `dropTargetIid` 在 `params.validIids` → dispatch `resolveSelection`。兩次 dispatch 對應雙推雲端（可接受）。
- 保留所有原按鈕作為 fallback（可及性 + 觸控點擊）

### Commit
- `5a6dc18` feat(ui): 拖曳交互

---

## 📝 2026-04-19 Session 26 A2 — 抽牌/發牌/洗牌動畫

### 動畫清單
- **手牌進場**：每張 `in:fly={{ x: 260, y: -40, delay: i * 70 }}` 從右上飛入，模擬從牌庫發出；Setup 初始 7 張依序 staggered（delay 80ms）
- **手牌出場**：`out:fly={{ y: -220 }}` 打出時向上飛出
- **Mulligan banner**：`scale` 進場 + 🔄 圖示 `spin` 旋轉
- **牌堆立體感**：`::before/::after` 疊層 2 張模擬「一疊卡」+ hover 上浮陰影

### 技術注意
- Svelte `animate:flip` **無法**與 `{#if}` 包 each 內容同時使用（必須為 each 唯一子元素）。目前 each 內有 `{#if c}` guard 所以 flip 拿掉，只保留 in/out transitions。
- Svelte transition 只在 mount/unmount 時觸發 — 既有卡不會重播，新進入才飛。

### Commit
- `3682f24` feat(ui): 動畫

---

## 📝 2026-04-19 Session 27 A3 — 扇形手牌 + hover 放大 + 勝負動畫 + 桌布質感

### 扇形手牌
- CSS custom properties `--fan-rot` + `--fan-lift` 由 Svelte inline style 動態算出
- `transform: rotate(var(--fan-rot)) translateY(var(--fan-lift))`
- `transform-origin: 50% 180%` 讓旋轉軸在下方（合理的扇形樞紐）
- `gap: -24px` 讓卡重疊
- `step = Math.min(4, 36/n)` 手牌越多 step 越小避免兩端翹太高

### hover 放大
- `.hand-card:hover:not(.dragging)`: `translateY(-50px) scale(1.35) rotate(0)`
- cubic-bezier transition 自然彈性
- `.hand-strip { overflow: visible }` 讓放大卡可突出

### 勝負動畫
- 全新 `.gameover-screen` 取代原 lobby 風格
- 背景 `conic-gradient` 光暈 + `slow-spin` 20s 旋轉
- 🏆/💔 圖示 `bounce` 1.5s + 金/紅光暈
- `Victory!` / `Defeat` 字樣 glow shadow
- scale-in → fly-in 文字 → fade-in 按鈕 依序延遲顯示
- 線上模式依 `myPlayerIndex === winner` 判斷勝敗

### 桌布質感
- `.playmat` 新增：radial glow + repeating 45° 紋理
- `::before` 中央虛線邊框框出桌面範圍

### Commit
- `f100094` feat(ui): 質感升級

### ⚠️ 給下一位 AI 的注意事項

1. **扇形 step 計算**：`step = Math.min(4, 36/n)` — 改動前要測手牌 15+ 張的極端情況。
2. **Svelte transition `in:fly` 只觸發一次**（mount 時）— 後續變動不會重播。
3. **animate:flip 使用限制**：元素必須是 keyed each block 的唯一子元素，不能外包 `{#if}`。
4. **拖曳 `moved` 門檻**：當 pointer 移動 < 6px 時視為 click，> 6px 才進入 drag 模式。觸控很容易誤判，調高可解但犧牲敏感度。
5. **`.battle-root` / `.playmat` 的 overflow:hidden**：hover 放大手牌卡要超出 playmat 區域，必須透過 `.hand-strip` 在 playmat 外層渲染 + `.hand-strip` overflow:visible 才不被裁。

---

## 📝 2026-04-19 Session 28 D1 — 硬幣動畫 + HP bar 過場

### 硬幣動畫 overlay
- 新增 `coinFlip` state + `.coin-overlay` 全螢幕淡入層
- 3D 翻轉 1.5s（正面金幣 🪙 / 反面黑幣 ⚫）
- `coin-label` fly-in 顯示結果（「XXX 先手」/「正面」/「反面」）
- 2.2s 後自動消失；`pointer-events:none` 不阻斷遊戲操作

### 觸發機制：log 偵測
引擎內所有擲硬幣（`Math.random() < 0.5`）都已把結果寫入 `log`，UI 不需改 engine：
- `$effect` 監聽 `game.log.length` 變化，取新增訊息
- 訊息含「擲硬幣…先手」→ heads 動畫
- 訊息含「正面」→ heads / 「反面」→ tails
- `lastLogProcessed` 追蹤已處理筆數，避免 log 重掃時重播

### HP bar transition
`.hp-bar` transition 從 `width .3s` → `width .55s cubic-bezier(.3,.8,.3,1), background .3s`
配合 Session 29 的傷害彈出，數字與血條同步流暢下降。

### Commit
- `9b4f361` feat(ui): 硬幣動畫 + HP bar 過場

---

## 📝 2026-04-19 Session 29 D2 — 傷害數字彈出 + 能量 pulse

### 傷害數字彈出
- `$effect` 監聽所有場上寶可夢的 `damage` 變化
- `lastDamageByIid: Map<string, number>` 記錄上次值，比對得差值
- damage 變動時用 `queueMicrotask` + `getBoundingClientRect` 取 DOM 座標
- 在 `damagePops: Array<{id, amount, x, y, heal}>` 加入新項
- 1.4s 後 setTimeout 移除

**CSS 動畫** `dmg-rise`（1.2s）：
- 0% 縮小透明 → 20% 跳出放大 → 100% 向上飛出消失
- 紅字（扣血）`-N` / 綠字（治療）`+N` + 多層 text-shadow 光暈

### 能量附加 pulse
- `dispatch()` 偵測 `action.type === 'ATTACH_ENERGY'` → `triggerEnergyPulse(targetIid)`
- 目標寶可夢套 `.energy-pulse` class 0.7s → CSS `energy-attach-pulse` 綠光脈衝 + scale 1.04

### Commit
- `92de15b` feat(ui): 傷害數字彈出 + 能量 pulse

---

## 📝 2026-04-19 Session 30 B1 — 10 張通用訓練家補實裝

### 新實裝（全部來自 MC「超級進化初階牌組100」卡包，但按名稱註冊跨 set 共用）

| 卡名 | 子類 | 效果 |
|:---|:---|:---|
| 傷藥 | Item | 回 30 HP |
| 西餐廚師 | Supporter | 戰鬥寶可夢回 70 |
| 真菰 | Supporter | 全體各回 40 |
| 白露的真心 | Supporter | 選 HP≤30 的寶可夢回復全部 HP |
| 希特隆的機智 | Supporter | 全體【雷】寶可夢各回 60 |
| 蓋伊 | Supporter | 抽 3 |
| 裁判 | Supporter | 雙方洗手牌抽 4 |
| 衝浪手 | Supporter | 換出場/備戰 + 抽至手牌 5 張 |
| 精靈球 | Item | 擲硬幣正面搜 1 寶可夢 |
| 寶可夢捕捉器 | Item | 擲硬幣正面呼叫對手備戰 |

### 技術要點
- 全部搭配 `TRAINER_GUARDS` 前置檢查（衝浪手需備戰、捕捉器需對手備戰、回復類需有傷害目標）
- 復用現有 resolver：`healResolver` / `search-pokemon-to-hand` / `gust-opp`
- 新增一個 resolver：`surfer-switch`（切換 + 抽到 5）

### 覆蓋率更新
- 訓練家/道具：30 → 40（13% → **18%**）
- 攻擊效果：16 → 17（加了精靈球正面，雖然它是訓練家內的硬幣但 effect 重用了搜尋機制）
- `CARD_AUDIT.md` 已重新生成

### Commit
- `0c85c11` feat(game): 實裝 10 張通用訓練家

### ⚠️ 給下一位 AI 的注意事項

1. **硬幣動畫觸發**依賴 log 訊息關鍵字：「正面」「反面」「擲硬幣」「先手」。新增擲硬幣效果時，log 訊息必須包含這些字串之一，否則不會動畫化。
2. **傷害數字彈出的 DOM 座標**來自 `[data-drop-iid]` 屬性。新增場上寶可夢容器時要確保有此屬性。
3. **Guard 與 effect 必須成對註冊**：guard 回 false 時 UI 根本不顯示按鈕（使用者無法觸發 effect），但 effect 內仍可做防衛檢查。
4. **healResolver 的 params**：`healAmount` + `discardEnergy`；治療無上限時 `healAmount: 9999`（Math.max clamp 至 0）。
5. **下次補卡優先**：M2a 的 34 張、SV8a 的 18 張 — CARD_AUDIT.md 已列完整清單。

---

## 📝 2026-04-19/20 Session 31 — H 標批次實裝 ~127 張

### 分類腳本
新增 `scripts/classify-h-cards.mjs`：掃 H 標 JSON，按正則分類攻擊/特性/訓練家效果。
輸出 `.tmp-H-classify.json` + 終端機統計。TARGET 參數可切換 H/I/J。

### 三波批次（累計本 session ~127 張）

**H1–H4（Session 31 第 1 波，59 張）**
- `statusPost` — 中毒/燒傷/睡眠/麻痺/混亂 POST（8 批 wrapper）
- `selfHitPost` — 自傷 N（對自己放指示物）
- `defStatusBonus` — 對有狀態敵人 +N 傷害
- `selfCantAttackNextPost` — 下回合自己不能攻擊

**H5–H6（Session 31 第 2 波，50 張）**
- `coinPlusDmg` — 擲硬幣正面 +N
- `coinStatusPost` — 擲硬幣正面附加狀態
- `drawPost` — 攻擊後抽 N
- `selfDmgReducePost` — 攻擊後自己受傷 -N 旗標

**H7–H12（Session 32 第 3 波，18 張訓練家）**
- 支援者批次：黑連(抽3)、野餐女孩(擲硬幣抽2/4)、仙后(手牌=1時抽2搜)、
  庫瑟洛斯奇的企圖(對手丟至3)、席藍(搜最多3張ex)、寇沙(手洗抽+1)、
  秋明(對手中毒時洗抽7)、蕾荷(牌庫頂5丟棄)、MJ超級球
- 物品批次：寶可生機劑A(回150)、危險光線(灼傷)、推理組合、奇跡耳麥、
  反擊捕捉器(獎賞多時呼叫備戰)、釣竿MAX、超級能量回收、大地之容器

### 新增 attack hooks
```ts
// effects.ts
ATTACK_PRE:  Map<'cardName|attackName', (state, aIdx, pool) => {state, damage}>
ATTACK_POST: Map<'cardName|attackName', (state, aIdx, pool) => state>
```

### 常用 POST wrapper（可複用）
- `statusPost(status, chance?)` — 附加狀態
- `coinStatusPost(status)` — 擲硬幣正面附加狀態
- `drawPost(n)`, `selfHitPost(n)`, `selfCantAttackNextPost()`

### Commits
- `2b5dec0` Session 31 — H 標批次第 1 波 59 張
- `ffb8da1` H 標第 2 波 +50 張
- `4bd832f` H 標第 3 波 +18 張訓練家

---

## 📝 2026-04-19/20 Session 32 — H 標被動特性 + Stadium + 主動特性

### 被動特性系統（engine hook）
新增 3 個 lookup map（effects.ts 導出，engine ATTACK 查表）：

```ts
PASSIVE_DAMAGE_REDUCE: Map<abilityName, number>       // 攻擊傷害 -N
PASSIVE_IMMUNITY:      Map<abilityName, (attacker, damage, state, aIdx, pool) => boolean>
PASSIVE_RETALIATION:   Map<abilityName, (state, dIdx, pool) => state>
```

**實裝（~11 被動）**
- 鑽石膜/堅硬甲殼/密林之軀/柔軟羊毛/堅堅之軀 — 受傷 -N
- 尾甲/礎石之勢/鐵壁硬殼/神秘之盾 — 特定條件完全免疫
- 毒刺/灼熱之軀/反擊 — 反擊攻擊者

### 主動特性（每回合 1 次）
`ABILITY_EFFECTS: Map<cardName + abilityIndex, EffectFn>`
實裝 ~11 隻：水晶燈火靈勸誘亮光、賽富豪ex紅利硬幣、吉雉雞ex扭轉乾坤、
愛管侍悉心治癒、普隆隆姆轟鳴引擎、鐵蟻ex突然削退、螺釘地鼠狂挖…等。

### Stadium 系統（活卡場地）
- GameState 新增 `activeStadium`、`stadiumUsedThisTurn`
- 實裝：危險密林（對非暗屬中毒 +20）、月光之丘（回 20 給月屬）、
  夜晚學院（看牌庫頂 N 張）

### 特殊狀態系統
`CardInstance.status: 'poisoned' | 'burned' | 'asleep' | 'confused' | 'paralyzed'`
- 中毒：回合結束 10 指示物（+20 危險密林、+50 劇毒支配）
- 燒傷：回合結束 20，擲硬幣正面解除
- 睡眠/麻痺：擲硬幣正面解除
- 混亂：攻擊時擲硬幣，反面自傷 30 攻擊失敗
- 撤退/進化 會清除狀態

### Commit
- `e4584e0` Session 32 — 被動特性 + Stadium + 主動特性（~22 張）

---

## 📝 2026-04-20 v1.0–v1.11 — 重大 UI/UX 大修 + 嚴重 bug 修復

### 版本號系統
新增 `src/lib/version.ts`：
```ts
export const VERSION = '1.21';  // 當前
```
- 小更新 +0.01 · 大更新 +0.1 · 重大變革 +1
- 頭部顯示 chip，使用者可確認是否同步到最新。

### v1.0 — UI 大量拖曳化
- 移除手牌按鈕，統一拖曳
- 手牌 hover 浮層預覽（340px）
- 可執行卡統一黃框（`.can-actionable`）
- 拖曳路徑：能量 → 寶可夢 / 基礎 → 備戰 / 進化 → 場上基底 / 道具 → 寶可夢 / 支援者 → 任何綠區
- `.playmat.trainer-drop-zone::before` 綠光提示

### v1.1 — 線上 Lobby + log 放大
- 新增 `subscribeOpenRooms(callback)`（effects.ts）— onSnapshot 監聽 status='waiting' 房間
- firestore.indexes.json 部署 composite index (status + createdAt)
- `log-col`: 380px × 160px，字體 0.85rem，顯示最近 20 筆

### v1.11 — 6 個嚴重 bug 修復（含最關鍵的線上互踩）
1. **🚨 RESOLVE_SELECTION 搶先**：P1 高級球丟棄介面出現時 P2 可以搶先操作！
   修復：`GameAction.RESOLVE_SELECTION` 新增 `senderIdx?: 0 | 1`，engine 拒絕
   錯誤方的 action：
   ```ts
   if (action.senderIdx !== undefined && action.senderIdx !== actorIdx) return state;
   ```
   UI 的 confirmSelection 和道具 drop 都傳 senderIdx。
   PendingSelection modal 只對 actor 玩家顯示（三模式分別檢查）。
2. AI 勝利顯示 Victory 而非 Defeat — `isWin` 三模式分開判定
3. 對手搜牌時看到玩家牌庫 — selection modal 遮罩改用 actor 檢查
4. Stadium 放大鏡缺失 — chip 改為 button + openZoom
5. 不公印章無條件檢查 — 補 `regG('不公印章', prizes<6)` guard
6. 高級球 log 缺卡名 — resolver 加 `搜到：X 加入手牌` / `丟棄：X`

### 新功能：查看完整牌庫（用於獎賞推算）
selection modal 的 deck-search 類型新增 `<details>` 摺疊區，
顯示 `srcP.deck` 同名卡聚合計數（勾選後不扣除，只反映剩餘）。

### Commits
- `818095d` v1.02 拖曳全牌、黃框統一
- `8b736ae` v1.03 支援者拖曳 + hover 預覽 340px
- `8787640` v1.1 Lobby 列表 + log 放大
- `e8f441c` v1.11 六 bug 修

---

## 📝 2026-04-20 Session 33 (v1.2) — 寶可夢道具 17 張 + engine tool hooks

### 新增 8 個 tool effect map（effects.ts 導出）
```ts
TOOL_HP_BONUS:              Map<toolName, (card) => number>
TOOL_ATTACK_BONUS:          Map<toolName, (atkCard, atkInst, defCard, defInst) => number>
TOOL_DEFENSE_REDUCE_BY_TYPE: Map<toolName, {amount, types[], discardOnTrigger}>
TOOL_PREVENT_KO:            Map<toolName, (inst, card, dmg) => {prevent, leaveHP}>
TOOL_ON_KO:                 Map<toolName, (state, dIdx, aIdx, pool) => state>
TOOL_PRIZE_BONUS:           Map<toolName, (card) => number>
TOOL_ON_DAMAGED:            Map<toolName, (state, dIdx, aIdx, dmg, pool) => state>
TOOL_RETREAT_MOD:           Map<toolName, (card, inst) => {reduceBy?, zero?}>
TOOL_BOTH_SIDES_RETREAT_PLUS: Set<toolName>    // 重力之玉（雙方 +1）
```

### 實裝 17 張 H 標道具
- **HP 加成**：英雄斗篷+100、勇氣護符+50(基礎)、豪華斗篷+100(非規則)、驅勁能量古代+60
- **攻擊加成**：極限腰帶對ex+50、鎖鏈糬中毒時+40、驅勁能量未來+20
- **屬性防禦 -60**：福(超)/巧(火)/千(水)/刺(惡)/霹(鋼)/莓榴(龍)果，觸發即丟棄
- **防 KO**：倖存鍛鍊器（滿血被 KO 時保留 10 HP，丟棄）
- **被 KO 時**：希望護身符(抽3)、沉重接力棒(移3能量到備戰)
- **獎賞加成**：豪華斗篷 +1
- **反傷/抽牌**：幸運頭盔(抽2)、奢華炸彈(反彈120 + 自丟)
- **撤退**：緊急滑板(-1/HP≤30→0)、驅勁能量未來(0)、重力之玉(雙方+1)

延後（複雜 hook）：反擊增幅器、力之沙漏、璀璨結晶、手持循環扇、3張招式學習器

### engine 新 helper
```ts
export function getEffectiveHP(inst, pool): number  // = card.hp + tool 加成
```
**所有** KO 判定、中毒/燒傷 overflow、UI 血條全改讀 `getEffectiveHP`
（原本只讀 `card.hp`，漏掉道具加成會算錯 KO）。

### ATTACK 流程新插入點（engine.ts line 920+）
1. baseDamage（preFn）
2. weakness ×2
3. **TOOL_ATTACK_BONUS**（新，flat +）
4. PASSIVE_DAMAGE_REDUCE
5. **TOOL_DEFENSE_REDUCE_BY_TYPE**（新，觸發後丟棄）
6. PASSIVE_IMMUNITY
7. damageReduceNextHit
8. 施加傷害 + 算 newDamage
9. wouldBeKO 判定（使用 `getEffectiveHP`）
10. **TOOL_PREVENT_KO**（新，保留 leaveHP 並丟道具）
11. KO 執行 → **TOOL_PRIZE_BONUS** + **TOOL_ON_KO**
12. 未 KO → **TOOL_ON_DAMAGED**
13. ATTACK_POST
14. PASSIVE_RETALIATION

### 批次規則套用（用戶要求：類似機制統一）
- **搜牌+丟棄 log 模式**：`bench-basic-from-deck` / `discard-to-hand` /
  `energy-retrieval` 等 resolver 補卡名 log（原只有 ultra-ball-discard 和
  search-pokemon-to-hand 有寫）
- **Guard 補齊**：超級信號（MegaEx在牌庫）、席藍（ex在牌庫）、好友寶芬
  （HP≤70 Basic + 備戰空位）、赫普的包包（Basic + 備戰空位）

### Commit
- `74702cd` Session 33 — 道具 17 張 + hooks

---

## 📝 2026-04-20 v1.21 — KO 卡住修正 + Setup 重構（直接進對戰畫面）

### 關鍵 bug 修
**AI KO 後取獎賞卡卡住** — `isMyTurn()` 在 AI 模式多了 `&& pendingPrizes === 0`：
```ts
// BEFORE: 取獎賞時 isMyTurn 回 false → UI 不顯示取獎按鈕
return game.activePlayerIndex === hIdx && game.pendingPrizes === 0;

// AFTER: 獎賞由 activePlayerIndex 決定，仍應允許取
if (game.pendingPrizes > 0) return game.activePlayerIndex === hIdx;
return game.activePlayerIndex === hIdx;
```

**對手 Stadium 放大鏡** — 原本只有 header chip（不明顯），新增
`.stadium-display` 區塊在 action-bar 右側（卡圖 + 名稱 + 🔍 可點擊）。

### Log 補強
手牌丟棄 4 個 resolver 補卡名：alice-courage、hydai-bottom-draw4、
super-energy-step2、earth-pot-step2。
attach-tool 顯示「🔧 {道具} 附加到 {寶可夢}」。

### Setup 重構（用戶明確要求：直接進對戰畫面）
- **刪除獨立 setup screen**（原 `{:else if phase==='setup'}` 分支）
- phase='setup' 和 'playing' **共用 battle-root**
- **擲硬幣動畫 overlay**（~3.8 秒）：
  - 2 秒硬幣旋轉（CSS `@keyframes coin-spin` 3D rotateY）
  - 1.8 秒揭曉先手 + Mulligan 結果（scale + fade）
  - `.coin-flip-box` 綠金漸層 + 金色 box-shadow
- **Setup 拖曳整合**：
  - 新 `data-drop-type="active-empty"` 空戰鬥場 drop zone
  - dragKind='basic' 同時涵蓋 play（PLAY_BASIC）和 setup（PLACE_ACTIVE / BENCH_POKEMON），by phase 分流 dispatch
  - `dropActiveEmpty` state 偵測
- **Action bar setup 模式**：
  - info-alert 提示（拖出場 / 可加備戰 / 等待對手）
  - 「✅ 準備完成」按鈕（取代攻擊按鈕）
- **本機雙人 myIdx** 在 setup 階段翻向尚未完成 setup 的那一方：
  ```ts
  (game?.phase === 'setup' && myPlayerIndex === null
    ? (game.setupDone[0] ? 1 : 0)
    : ...)
  ```

### 未完成（下次）
- 對手 mulligan 時讓玩家決定抽/不抽（目前仍自動 +N 張）
- 獎賞卡放置動畫（FINISH_SETUP 瞬間完成，沒有 fly 動畫）

### Commit
- `c757f47` v1.21 — KO bug + Setup 重構

---

## 📝 2026-04-20 Session 35 (v1.3) — 7 項一次打包（bug 修 + UX + 待辦 1/2）

### Bug 修

**① 線上房間列表看不到對方建立的房間**
- 原因推斷：`rooms/{code}` 查詢使用 `orderBy('createdAt') + where('status','==','waiting')` 需要
  composite index（`status ASC + createdAt DESC`），production Firestore 很可能沒部署該 index，
  導致 onSnapshot 靜默失敗（無資料）。
- 修：`src/lib/game/room.ts::subscribeOpenRooms` 去掉 `orderBy`，改 client-side 依 `createdAt.seconds` 排序；
  加 `onError` callback 讓 UI 顯示載入失敗原因；`myUid` 改在 snapshot callback 內讀（避免訂閱時 auth 尚未完成）。
- UI：`+page.svelte` 新增 `openRoomsErr` state + 紅字 `.warn.small` 顯示錯誤訊息。

**② 米立龍「集客」peek-top-X 不該顯示「查看牌庫剩餘」**
- 原因：`selection-modal` 內的「📖 查看牌庫剩餘全部」details 區塊對所有 deck-search 都顯示，
  包括 peek-top-N 機制（會爆雷剩餘牌 = 推斷獎賞卡）。
- 修：`{#if pendingSelection.type==='deck-search' && !(filter?.startsWith('TOP') || filter?.includes(':TOP'))}`
  — TOP6 / TOP8 / Supporter:TOP6 類都隱藏「查看剩餘」。

**③ 龐克頭盔反彈傷害消失且無效果**
- 原因：`engine.ts::handleAttack` 中原本在 `newState.players` 上 in-place 套用 +40 反擊傷害，
  但後續 `newState = { ...newState, players: defPlayers, turnPhase: 'end' }` 用 defPlayers 整個覆蓋，
  攻擊方 active 的 damage 被倒回 → 反擊無效、log 也可能被其他路徑丟失。
- 修：提早計算 `punkReflectDamage` flag（只讀取 defender 當前狀態），在 defender 狀態提交（newState.players = defPlayers）
  後才套用到 attacker active.damage，確保不被覆蓋；並補 log「🔧 龐克頭盔：{攻方} 受到 40 傷害反擊！」。

### UX 改善

**④ Log 完整保留 + 可滾動回戰鬥開始**
- 原本用 `.slice(0, 20)` 限制顯示數 → 改為 `[...(game.log ?? [])].reverse()` 完整渲染（最新在上）。
- `.log-col` CSS：`max-height:220px; overflow-y:auto`，自訂 scrollbar 顏色；
  最新一行加 `.log-latest` 背景標記（`background:rgba(170,255,204,.06); border-left:2px solid #aaffcc`）。
- 加 `title` 提示：「向下滾動可查看從戰鬥開始到現在的完整記錄」。

**⑤ 撤退選單改橫向 + 支援放大鏡（避免同名卡選錯）**
- 原本 floating menu 由撤退按鈕座標往上展開，超出螢幕頂部只能顯示 3 張。
- 改寫為置中 modal：`.selection-overlay` + `.selection-modal.retreat-modal`（max-width 760px，grid auto-fill minmax(130px,1fr)）。
- 每張備戰卡有：卡圖、名稱、HP 剩/總、能量摘要、道具、狀態；加「🔍 放大鏡」按鈕（右上 z-index:2），
  點開完整 zoom modal 可看到能量明細 → 解決同名但能量不同選錯的問題。
- 背景點擊關閉，Cancel 按鈕退出。

### 待辦 1：對手 mulligan 時讓玩家決定抽/不抽

- 新增 `GameState.pendingMulliganDraw: [number, number]` 欄位（types.ts）。
- 新增 action：`{ type: 'MULLIGAN_DRAW_DECISION'; accept: boolean; senderIdx: 0 | 1 }`。
- `engine.ts::createGame` 不再自動幫對手補抽；改為設定 `pendingMulliganDraw[0]=m2, pendingMulliganDraw[1]=m1`。
- `handleSetup` 新增分支處理 `MULLIGAN_DRAW_DECISION`：accept → 從自己 deck 抽 N 張；false → 放棄。
  兩邊 decision + setupDone 都 done 才進入 phase='playing'。
- `ai.ts::handleSetupAI` 最前面加 mulligan check：AI 永遠 accept。
- UI：新增 `.mulligan-modal`（在 retreat-modal 之前插入）— 顯示對手 mulligan 次數 + 可抽 N 張 +
  牌組剩餘/手牌/抽後手牌數 + 「抽 N 張 / 放棄」兩按鈕。`GameActions.mulliganDrawDecision(accept, senderIdx)` 新 helper。
- 本機雙人 `myIdx` 加 mulligan 優先判斷（pendingMulliganDraw 有值時先翻到那一方）。
- AI 模式 `shouldAct` 在 setup phase 也檢查 `pendingMulliganDraw[ai] > 0`。

### 待辦 2：獎賞卡放置動畫

- 新增 state：`prizeAnimKey: [number, number]`（雙方各一計數器）。
- `$effect` 偵測 `prizes.length` 從 0 → 6 的 transition，對應玩家 key++。
- 在雙方 `.prize-grid` 外包 `{#key prizeAnimKey[oppIdx]}` / `{#key prizeAnimKey[myIdx]}` — key 變化時整段 re-mount → CSS 動畫重播。
- 新增 `.prize-card.prize-anim` + `@keyframes prize-deal` — fly-in 從左上 `translate(-60px,-40px) rotate(-18deg) scale(.5)`
  → 輕微 overshoot `scale(1.05) rotate(4deg)` → 復位。每張 `animation-delay:{i*90}ms` 錯開發牌感。
- `.prize-gone` 加 `animation:none !important` 防止已空格子也播動畫。

### 驗證
- `node scripts/sim-ai-battle.mjs 100` → 100/100 正常結束，0 卡住 / 0 崩潰 / 0 例外；P1 56 / P2 44，平均 15.1 回合。
- 兩筆 3 回合內結束 = AI 被 1-2 punch wipe，符合 FIRE 卡組 aggressive 行為，非 bug。
- 工程師手動檢查：UI 改動不影響 engine 純函式邏輯，sim 通過即表示機制正確。

### 小改

- `.gitignore` 新增 `.tmp-sim-*` / `.sim-test.mjs` / `.tmp-H-*` / `.tmp-sim-bundle.mjs`。

### 未完成（下次）
- H 標剩餘：~10 張複雜道具、~70 張特性、~500 張攻擊
- I/J 標尚未開始批次（SV9+、M1+、M2+、MC/M3/M4）
- 特殊能量卡系統（M4 原定實裝）
- Firestore composite index（firestore.indexes.json 有定義但 production 未部署） — 若未來要恢復
  server-side orderBy 排序，需 `firebase deploy --only firestore:indexes`

### Commit
- （將在 commit 後補）v1.3 — 7 項打包

---

## 🛠️ 當前架構快速導覽（給下一位 AI）

### 關鍵檔案
| 檔案 | 行數 | 角色 |
|:---|---:|:---|
| `src/lib/game/engine.ts` | ~1500 | 純函式 state machine（applyAction / createGame / handlers） |
| `src/lib/game/effects.ts` | ~2600 | 訓練家 + 招式 + 特性 + 道具 效果登錄表 |
| `src/lib/game/types.ts` | ~215 | GameState / CardInstance / GameAction 型別 |
| `src/lib/game/actions.ts` | ~35 | GameActions helper（建立 action 物件） |
| `src/lib/game/ai.ts` | ~500 | AI 決策 handleSetupAI + handlePlayAI |
| `src/lib/game/room.ts` | ~200 | Firestore 房間 CRUD + subscribeRoom / subscribeOpenRooms |
| `src/routes/game/+page.svelte` | ~2400 | 唯一對戰 UI（lobby + setup + play + game-over 全在這） |
| `src/lib/cards/pool.ts` | 63 | 卡池載入（static/cards/*.json） |
| `src/lib/version.ts` | 13 | 版本號字串 |

### 所有 effect map（effects.ts 頂層 export）
```
TRAINER_EFFECTS, RESOLVERS, TRAINER_GUARDS       // 訓練家
ATTACK_PRE, ATTACK_POST                          // 招式
ABILITY_EFFECTS                                  // 主動特性
PASSIVE_DAMAGE_REDUCE, PASSIVE_IMMUNITY, PASSIVE_RETALIATION  // 被動特性
TOOL_HP_BONUS, TOOL_ATTACK_BONUS, TOOL_DEFENSE_REDUCE_BY_TYPE,
TOOL_PREVENT_KO, TOOL_ON_KO, TOOL_PRIZE_BONUS,
TOOL_ON_DAMAGED, TOOL_RETREAT_MOD, TOOL_BOTH_SIDES_RETREAT_PLUS  // 道具
```

### 註冊 helper（effects.ts 內部）
- `reg(name, fn)` → TRAINER_EFFECTS
- `regR(key, fn)` → RESOLVERS
- `regG(name, fn)` → TRAINER_GUARDS
- `regPre('card|atk', fn)` / `regPost('card|atk', fn)` → ATTACK_PRE/POST
- `regA(cardName, abilityIndex, fn)` → ABILITY_EFFECTS

### AI sim 腳本
```bash
node scripts/sim-ai-battle.mjs 50  # 跑 50 局，檢查 0 卡住 / 0 崩潰
```

### 卡片分類腳本
```bash
node scripts/classify-h-cards.mjs H  # 掃未實裝 H 標，按模式分類
```

### 規則嚴守（用戶反覆強調）
1. **類似機制統一套用**：一個 resolver 補 log → 找所有同類 resolver 一起補
2. **Guard 條件須檢查**：沒目標不該能打（超級信號/席藍/不公印章）
3. **線上 RESOLVE_SELECTION 必帶 senderIdx** — 否則可能互踩
4. **所有 KO 判定用 `getEffectiveHP`** — 不要直接讀 `card.hp`
5. **確認推送到 GitHub 生產環境**：用戶看的是 suenz001.github.io/ptcg-tw-sim/game
6. **版本號要 bump**：小改 +0.01，大改 +0.1，破壞 +1

### 未解決待辦（優先序）
1. H 標剩餘：~10 張複雜道具、~70 張特性、~500 張攻擊
2. I/J 標尚未開始批次（SV9+、M1+、M2+、MC/M3/M4）
3. 特殊能量卡系統（M4 原定實裝）
4. Firestore composite index production 部署（若要恢復 server-side orderBy）

---

## 📝 2026-04-20 Session 36 (v1.4) — 戰鬥場 UI 切割 + log 目標統一 + 選人 UI 統一

### 工作流程反饋（用戶明示）
- **「下次請你自己先push看看，我很懶」** → Session 36 起 Claude 直接嘗試 `git push`，不再要求用戶手動 push。
  （SDK sandbox 中曾有 auth 問題，若失敗會回報具體錯誤讓用戶補推。）

### ① UI Bug：戰鬥寶可夢卡牌下方被切掉
- 根因：`.playmat { grid-template-rows: 1fr auto 1fr; overflow:hidden }` 搭配 `.field-row { overflow:hidden }`
  → 小螢幕下 1fr 區塊壓縮低於卡片自然高度（~187px @ 120px 圖寬），底部能量/狀態資訊被裁掉。
- 修：
  - `.playmat` → `grid-template-rows: minmax(185px,1fr) auto minmax(185px,1fr)` 保底最小高度。
  - `.active-card` → `padding:0.45rem 0.5rem`（原 0.6rem）、`align-items:flex-start`、移除 `min-height:130px`。
  - `.active-img` → `width:105px`（原 120px），同比縮 flex-shrink:0 佔位。

### ② Log 完整性審計（「奇跡修正檔未顯示附加給哪個寶可夢」擴大審查）
用戶：「未顯示敘述附加超能量給哪個寶可夢，請你統一檢查類似的情形需記錄於 log」  
規則：凡是效果「修改特定寶可夢狀態」（附加能量、附加道具、回血、派出上場），log 必須指名目標。

補完的 resolver（13 處）：
- `healResolver`：「→ {name} 回復 {amount} HP[，丟棄 {N} 個能量]」
- `miracle-codec-energy` + `miracle-codec-attach`：拆兩段處理，第二段 log「奇跡修正檔：將 {energyName} 附加到 {targetName}」
- `gengar-move-energy`（超級耿鬼 ex 空無強風）：「空無強風：將 {energyName} 附加到 {targetName}」
- `cresselia-attach-energy`（克雷色利亞 充溢之光）：「充溢之光：將 {names} 附加到 {activeName}」
- `heal-120-bench`：「→ {name} 回復 {actualHeal} HP」
- `rare-candy-evolve`：**原本有 bug，log 在 updatePlayer 裡構造但從未 addLog** — 修為先查名再 addLog，寫出「神奇糖果：{basicName} 進化成 {stage2Name}」
- `gust-opp`（老大的指令）：「老大的指令：呼叫 {name} 到戰鬥場」
- `top-catcher-opp`（頂尖捕捉器對手版）：「頂尖捕捉器：呼叫 {name} 到對手戰鬥場」
- `do-switch`（寶可夢交替 / 急進開關 / 頂尖捕捉器自我版）：「→ 派出 {name} 到戰鬥場」
- `surfer-switch`（衝浪手）：「衝浪手：派出 {name} 到戰鬥場」
- `dominance-chain`（支配鎖鏈）：「支配鎖鏈：派出 {name} 到戰鬥場（中毒）」
- 沉重接力棒 `TOOL_ON_KO`：指名備戰區要繼承的寶可夢名稱，而非泛稱「備戰」

已確認無需修（engine.ts handler 原本就有 log）：
- `ATTACH_ENERGY`：「{attacker.name} 將能量附加到 {targetCard.name}」✅
- `SEND_NEW_ACTIVE`：「{sendingPlayer.name} 送出了 {newActiveCard.name}！」✅
- `RETREAT`：「{name} 的 {activeCard} 撤退，{newActiveCard} 上場！」✅

### ③ 選人 UI 統一（撤退介面 → SEND_NEW_ACTIVE + bench-choose）
用戶：「撤退的時候選擇寶可夢的介面改得不錯，戰鬥寶可夢昏厥須派出時、寶可夢交替、頂尖捕捉器等也請使用一樣的 UI。」

實作方式：
1. **SEND_NEW_ACTIVE**：移除 `alerts-col` 內擁擠的 `.mini-poke-btn` 列（40px 縮圖太小、同名卡無法區分）；
   改為獨立 `.selection-overlay` + `.retreat-modal` — 自動在 `isMyDefenderTurn()` 條件下 pop up，
   含 🔍 放大鏡、HP 剩/總、能量摘要、道具、狀態五段資訊。不提供 cancel（必須選）。
2. **pendingSelection 通用 modal**：新增 `isPokePicker = type ∈ {bench-choose, opp-bench-choose, opp-poke-choose, heal-target}` 判斷。
   - 為 true → 改套 `.retreat-grid` / `.retreat-card` / `.retreat-zoom` / `.retreat-pick` 五元素排版，
     每張卡都有 🔍 magnifier（放大看能量、狀態），點卡面 toggle 選取。
   - 為 false（deck-search / hand-discard / hand-choose / discard-search） → 保留原本 `.sel-grid` 密集排版（64px 縮圖 + 名稱 + HP 小字）。
   - 多選情境（原本就支援）：picked 狀態套 `.retreat-card.sel-picked` 邊框高亮 + 卡面角落 ✓。
3. CSS 補：`.retreat-card.sel-picked { border-color:#aaff44; box-shadow:0 0 10px #aaff4488 }`；
   `.retreat-pick .sel-check { position:absolute; top:.25rem; left:.35rem; font-size:1rem; ... }`。

受影響的選人流程（全部自動升級）：
- 寶可夢交替、急進開關、頂尖捕捉器（自我呼叫）、衝浪手、支配鎖鏈、老大的指令、頂尖捕捉器（對手版）、
  美洛耶塔 治癒旋律、超級耿鬼 ex 空無強風、奇跡修正檔 第二段選目標、所有 `heal-target` 類、所有 `opp-*-choose` 類。

### 驗證
- `node sim.mjs 50` → 50/50 正常結束，0 卡住 / 0 崩潰 / 0 例外；P1 26 / P2 24，平均 14.2 回合。
- 2 局 turn=1 早結束 = Mulligan 後備戰區無寶可夢，屬規則內輸法，非 bug。
- UI 改動不觸及 engine 純函式，sim 通過即代表機制邏輯未破。

### Commit
- （將在 commit 後補）v1.4 — UI 切割修、log 統一、選人介面統一

## 📝 2026-04-20 Session 37 (v1.5) — Setup 蓋牌、Mega ex 獎賞、UI 狀態反白、swap log 雙名、對戰結束匯出 log

### 1. Setup 階段對手卡蓋牌（全模式）
**Why:** 開局雙方都要放基礎寶可夢，但現在 UI 會立刻把對手出場/備戰暴露給你 → 這不符合 PTCG「雙方同時背面放置，揭曉才互看」的規則。
**改動：**
- `src/routes/game/+page.svelte`
  - 新增 `const oppHidden = $derived(!!game && game.phase === 'setup')`
  - 對手 bench slot：若 `oppHidden`，改 render `<div class="card-back card-back-sm">?</div>` + 名字顯示「？？？」；HP/能量/道具/特性旗標/狀態全隱藏（連有幾隻備戰還是看得到，只是不知道身分）。
  - 對手 active：同樣套 `.card-back-lg`，info 只顯示「？？？ / 戰鬥中（未揭曉）」，並加 `card-back-active` class 套斜體灰色樣式。
- CSS：`.card-back` 用 `radial-gradient` 畫紅藍 Pokéball 風格 + 粗黑邊框 + 陰影，sm 尺寸 96×128（bench）、lg 尺寸 105×140（active）。
- 「全模式都蓋」：AI 模式 / 線上模式 / 本機雙人 setup 都適用，因為 `game.phase === 'setup'` 在三種模式都是 true。
- 一旦雙方 `setupDone[0] && setupDone[1]` → phase 變 `playing` → 揭曉。

### 2. 超級進化寶可夢 ex（Mega ex）KO 給 3 張獎賞
**Why:** PTCG Scarlet/Violet — Mega ex（卡名以「超級」開頭 + ex 後綴，如 超級噴火龍Xex / 超級妙蛙花ex / 超級拉帝亞斯ex）擊倒時對手取 **3 張**，不是 2 張。
**改動：** `src/lib/game/engine.ts` `prizesForKO(card)`：
```ts
const isEx = name.endsWith('ex') || name.endsWith('EX');
if (isEx && name.startsWith('超級')) return 3;   // Mega ex
if (isEx) return 2;
return 1;
```
KO resolution（L1040-L1154）、中毒/燒傷致死（L1317 / L1356）都走這個函式 → 統一套到。

### 3. 「下回合無法攻擊」招式改為 UI 反白禁按（新機制 cantAttackPending）
**Why:** 用戶原話：「無極汰那的力量猛攻反面後，應該是一開始就不能使用，應該是像能量不足的時候那樣，直接把兩個招式都反白不能點擊」。
**原機制的問題：** `cantAttackThisTurn` 只在 `ATTACK` handler 被攔截後清除，UI 不知道要反白。而且即使改 UI 反白，玩家不攻擊就永遠不會清，下下回合還是卡住。
**新設計（兩階段旗標）：**
- `types.ts` 新增 `cantAttackPending?: boolean`（「下個自己回合預約封鎖」）。
- 招式 POST 改設 **pending** 而非 thisTurn：`力量猛攻` / `無限之刃` / `烈火爆進` / `selfCantAttackNextPost`（大力鱷駭浪 / 瑪力露麗力量衝撞 / 飛天螳螂猛擊在地 / 斗笠菇關節衝擊 / 鐵斑葉ex稜鏡刀鋒）/ `defCantAttackNextPost`（雪絨蛾冰冷寒氣）。
- `engine.ts` `END_TURN`：
  - 當前玩家（aIdx）active/bench 全體：`cantAttackThisTurn` → **清除**（罰則消耗完）。
  - 下個玩家（nextIdx=dIdx）active/bench 全體：`cantAttackPending` → **promote** 為 `cantAttackThisTurn`。
- `engine.ts` `getAvailableAttacks`：新增三道狀態檢查 → 回傳空 array（→ UI 反白）：
  - `status === 'asleep'`（睡眠）
  - `status === 'paralyzed'`（麻痺）
  - `cantAttackThisTurn === true`
- 混亂仍走「擲幣判定」，不反白（不知道結果前還是可點）；中毒/燒傷不影響攻擊，不反白。
- `ATTACK` handler 的 runtime 檢查保留作為 defensive fallback（被 UI 阻擋後不會走到，但保留以防 bug）。

### 4. Log 審計第二輪：swap 時兩隻名字都寫
**Why:** 用戶原話：「完整的紀錄遊戲的情況，除非該項資訊是只限定自己才能知道」。頂尖捕捉器 / 老大的指令 / 寶可夢交替 / 衝浪手 / 支配鎖鏈這些 swap 類 resolver 原本只寫「呼叫 X 到戰鬥場」，沒寫「把對手/自己原本的戰鬥寶可夢 Y 換下去」。
**改動 `src/lib/game/effects.ts`：**
- `gust-opp`（老大的指令 / 反擊捕捉器 / statusPost 類共用）：`將對手戰鬥場的 {oldName} 換到備戰區，呼叫 {newName} 到對手戰鬥場`
- `top-catcher-opp`：同格式，加「頂尖捕捉器：」前綴
- `do-switch`（寶可夢交替 / 急進開關 / top-catcher 第二段）：`→ 將 {oldName} 換到備戰區，派出 {newName} 到戰鬥場`
- `surfer-switch`（衝浪手）：`衝浪手：將 {oldName} 換到備戰區，派出 {newName} 到戰鬥場`
- `dominance-chain`（桃歹郎支配鎖鏈）：`支配鎖鏈：將 {oldName} 換到備戰區，派出 {newName} 到戰鬥場（中毒）`
- 奇跡修正檔 / 神奇糖果（進化前/後名字）/ 撤退 / SEND_NEW_ACTIVE — Session 36 已處理，驗證通過不動。

### 5b. 備戰區卡牌下方被切掉 + 設置階段 drop zone 框框太小（Session 37 補修）
**Why:** v1.4 修了戰鬥場 active 切掉，但用戶 v1.5 截圖發現 mine-row 備戰區現在被切（圖片只剩名字+HP 一條）。同時用戶反饋初始拖曳寶可夢時，戰鬥場/備戰區的「黃色虛線框」比放置後的實際 slot 小很多，難以瞄準。
**改動 `src/routes/game/+page.svelte` CSS：**
- `.playmat grid-template-rows`: `minmax(185px,1fr)` → `minmax(230px,1fr)`（雙方 row 都從 185 拉到 230，足以容納 bench-slot 完整高度：96px 圖 + 6 行資訊 + 進化/特性按鈕 ≈ 220px）
- `.active-card.active-empty` 加 `min-height:160px; padding:1.4rem; font-size:.9rem; font-weight:600`，drop-zone 狀態 `border-width:3px`（明顯化）。
- `.bench-empty` 對齊填卡後 slot 的 flex 規則：`flex:1 1 70px; min-width:70px; max-width:115px; min-height:170px`（原本 `flex:0 0 70px; min-height:96px` 導致空格小於實格）。

### 6. 匯出 log（遊戲結束後）
**Why:** 用戶希望遊戲結束後能保留完整 log 檔案，便於 review 或分享。
**改動 `src/routes/game/+page.svelte`：**
- 新增 `exportLogAs(format: 'txt' | 'json')` 函式：`Blob` + `URL.createObjectURL` + 動態 `<a download>` 觸發下載。
- TXT 格式：每行 `[T{turn} P{idx}:{name}] {msg}`。
- JSON 格式：`{ meta: {...game state summary}, log: [...entries] }`。
- 檔名：`ptcg-log-{YYYYMMDD-HHmmss}.{ext}`。
- 遊戲結束畫面新增「匯出 TXT」「匯出 JSON」兩鈕（`.export-btns`）。

---

## Session 38（v1.51 — 2026-04-20，中盤 action-bar 排版微調）

### 背景
v1.5 上線後用戶截圖回報中盤 `action-bar` 區塊（opp-row 與 my-row 之間）排版看起來有點跑掉、log 面板太突兀，且場地卡圖示＋文字過小。

### 1. action-bar 中盤排版清理
**改動 `src/routes/game/+page.svelte` CSS：**
- `.log-col`: `max-height:220px → 140px`、`font-size:.85rem → .8rem`、`line-height:1.4 → 1.35`、背景 `.35 → .45`（加深對比）。log 仍保有 `overflow-y:auto` 可往上捲查完整歷史。
- 目的：壓低中盤列高度，讓上下兩個 field-row 的 230px minmax 不被中盤吃掉太多視覺比重。

### 2. 場地卡 stadium-display 放大
**改動 `src/routes/game/+page.svelte` CSS：**
- `.stadium-display img`: `width:60px → 92px`
- `.stadium-display-label`: `font-size:.6rem → .78rem`、加 `letter-spacing:.05em`、色調改 `#a8c4ff`（更亮）
- `.stadium-display-name`: `font-size:.65rem → .82rem`、`max-width:70 → 120px`、`font-weight:600`，色調改 `#dde`
- `.stadium-display` padding 從 `.2rem` → `.35rem .5rem`、`gap:.15rem → .25rem`
- 目的：場地卡在中盤列不再是難以辨識的小縮圖，用戶能一眼看清楚當前場地是什麼。

### 結論
兩處都是純 CSS 微調，engine / effect 無變動，sim 不跑也無風險。版本號 1.5 → 1.51。

---

## Session 38b（v1.52 — 2026-04-20，action-bar log 溢出修正）

### 背景
v1.51 把 log max-height 從 220 → 140px，但用戶又回傳截圖：log 面板的上下邊界仍然「跑出去」opp-row 和 my-row 的邊界。

### 根因
`.action-bar` 有 `align-items:center` 卻沒 `overflow:hidden`。`.playmat` 用 `grid-template-rows:minmax(230px,1fr) auto minmax(230px,1fr)` + `overflow:hidden`，當視窗高度不夠時，中間 `auto` row 會被壓到比 `log-col`（140px + padding ≈ 150px）還矮；`align-items:center` 讓 log-col 垂直居中在窄 row 裡，於是向上下「對稱溢出」到 opp/my row 的視覺區塊。

### 改動 `src/routes/game/+page.svelte` CSS
- `.action-bar`：
  - `align-items:center → stretch`（grid items 垂直撐滿自己的 row）
  - 新增 `max-height:130px`（明確封頂中盤行高，避免 log 長到擠壓上下場）
  - `min-height:52px → 70px`（給 log 一個舒服下限）
  - 新增 `overflow:hidden`（安全網，殘餘溢出一律剪掉）
- 新增 `.alerts-col, .action-btns, .stadium-display { align-self:center; }` — stretch 只給 log，其他 grid item 恢復垂直居中
- `.log-col`：
  - `max-height:140px → 100%`（完全跟隨 action-bar row 的實際高度）
  - 新增 `min-height:0`（flexbox/grid scrolling 容器的慣用 trick，避免被內容撐高）
  - 新增 `align-self:stretch`（明確宣告，避免被父的 align-items 影響）

### 效果
- log-col 永遠被 action-bar 的 130px 天花板封住，不會跑出到 opp/my row
- 實際可視高度跟著視窗自動伸縮：視窗高 → row 更高 → 看到更多 log 行；視窗窄 → row 縮小 → 看少幾行但 log-col 本身有 `overflow-y:auto` 可捲
- 其他中盤元素（alerts / 攻擊按鈕 / 場地卡）仍然垂直置中，視覺上維持原樣

版本號 1.51 → 1.52。



---

## Session 38c（v1.53 — 2026-04-20，修復 FUSE 截斷導致 v1.51/v1.52 部署失敗）

### 背景
Leon 回報線上網址還是顯示 v1.5。檢查 GitHub Actions：v1.51 和 v1.52 的 deploy workflow 都在
「Build SvelteKit app」步驟 FAILED，v1.5（3acac62）才是最後一次成功部署——所以生產站還停在 v1.5。

### 根因
本地 build 重現錯誤：
```
file: src/routes/game/+page.svelte:2563:117
unexpected_eof
```
生產端 `+page.svelte` 在 `.tool-chip` CSS 規則的 `paddin...` 處被切斷，style block 沒有收尾的 `}`
也沒有 `</style>` 閉合標籤。

問題來源：sandbox 從 FUSE mount 讀取大檔時會偶發**讀取截斷**（sandbox 看到 2562 行，實際
Windows / 上一版 commit 都是 2595 行）。我 v1.51 直接 `cp` sandbox 的截斷版到 /tmp clean clone
推上去，所以 origin/main 從 v1.51 開始就爛了；v1.52 又沿用截斷版，build 一直炸。

### 修復
1. 從 `git show 3acac62:src/routes/game/+page.svelte` 拉完整 2595 行版本到 /tmp。
2. 用 Python 重打 v1.51+v1.52 的 CSS 修改（action-bar + log-col + stadium-display 那三段）。
3. 結果檔案 2597 行（原 2595 + 2 新增行），`</style>` 收尾完整。
4. 本地 `npm run build` 驗證通過（build in ~10s，無警告）。

### 經驗
- 不能無腦 `cp` sandbox FUSE 路徑的大檔到 /tmp clean clone；要先 `wc -l` 比對上一版 commit 的
  檔案行數，確認沒被 FUSE 截斷。
- 或更穩妥：用 `git show {last-good-sha}:{path} > /tmp/base` 拉遠端的完整版當基底，在 /tmp 裡用
  Python/sed 打 patch，避開 FUSE 讀取。
- 之後要注意 `src/lib/game/engine.ts`、`src/lib/game/types.ts` 等其他大檔在 sandbox 也可能被
  FUSE 截斷讀（sandbox 分別看到 1615 / 220 行，origin 是 1655 / 230），若要 cp 到 clean clone
  請先比對行數。

版本號 1.52 → 1.53（實質內容與 1.52 相同，只是補完被截斷的檔案讓 build 能過）。

---

## 📝 2026-04-20 Session 38d (v1.54) — 場地卡截斷修復 + my-row 貼齊手牌

**使用者觀察（screenshot）：**
- v1.53 部署成功後，場地卡（stadium）圖片下半部被 action-bar 截掉。
- 自己這邊（綠色 my-row）的 bench 和手牌之間還有一段「不算窄的空隙」—— bench 被 `align-items:flex-start` 推到 my-row 頂端，導致 my-row 底部出現空白。
- 明確提醒：「不要為了調一個地方而整個都亂掉。」

**根因：**
1. `.action-bar{ max-height:130px }` 硬卡住，但 `.stadium-display` 子元素（label ~15px + img ~128px + name ~16px + gap/padding ~20px ≈ 178px）超過上限 → 圖片底部被 `overflow:hidden` 裁掉。
2. `.my-row{ align-items:flex-start; padding-top:0.6rem }` 讓 bench 貼近 action-bar，my-row 底部（靠 hand-strip 那側）留下純粹的視覺空隙。

**修法（兩處 surgical edit，`src/routes/game/+page.svelte`）：**

```diff
- .action-bar{ ... min-height:70px; max-height:130px; overflow:hidden; }
+ .action-bar{ ... min-height:70px; max-height:200px; overflow:hidden; }

- .my-row{ border-top:2px solid #2a5a2a; align-items:flex-start; padding-top:0.6rem; }
+ .my-row{ border-top:2px solid #2a5a2a; align-items:flex-end; padding-bottom:0.6rem; }
```

**為什麼兩處都要改：**
- 只改 max-height：場地卡能完整顯示，但 my-row 底部空隙還在。
- 只改 my-row：空隙消失、bench 貼到手牌附近，但場地卡還是被裁（因為 max-height 沒放寬）。
- 兩個同時改：場地卡完整 + bench 貼手牌 + action-bar 自然撐高（在有 stadium 時）→ `.log-col{ max-height:100% }` 跟著變高，日誌視窗多幾行。

**連鎖副作用檢查：**
- `.playmat{ grid-template-rows:minmax(230px,1fr) auto minmax(230px,1fr) }` 沒動。action-bar 是 `auto`，由最高子元素決定實際高度（無 stadium 時仍是 ~70-90px，空間全還給兩個 1fr row）。
- `.opponent-row` 原本就是 `align-items:flex-end` + `padding-bottom:0.6rem`（對手 bench 貼 action-bar）。my-row 改為 `flex-end + padding-bottom:0.6rem` 後，my bench 貼 hand-strip——等於整個 playmat 的 bench 都朝向版面中央的 action-bar「展開」，對稱性更好。
- `.field-row{ padding:0.5rem 0.7rem }` base padding 不變，my-row 只改方向（top→bottom）不改總量。

**驗證：**
- `/tmp/ptcg-work/repo` clean clone 跑 `npm ci && npm run build` 通過（防 FUSE 截斷誤推，見 v1.53 教訓）。
- GHA 部署在 push 後 90-120s 生效，Leon 須 Ctrl+F5 + 清 Service Worker 確認頁首顯示 v1.54。

**工作流備忘（FUSE 截斷 v2）：**
- 這次 sandbox 的 `+page.svelte` 仍然只讀到 2562 行（origin 2597），完全沒動的情況下又被截斷一次。
- 全程在 `/tmp/ptcg-work/repo` 作業（含 Edit tool），確認 build 過才推。`Read` 讀 `/tmp/` 的檔沒被截斷（因不走 FUSE）。
- 這個 pattern 應該變成預設流程：改 `+page.svelte` 一律先 clone 到 /tmp，不走 FUSE mount。

---

## 📝 2026-04-20 Session 38e (v1.55) — Trainer 拖曳取消 bug 修復

**使用者回報：**
> 支援者或物品卡等沒有目標的訓練家卡牌，如果拖曳起來，又在拖曳回手牌的地方，或是沒有拖曳到釋放區域，視為不使用
> 我剛剛發生拖曳莉莉艾的決意，但又後悔了，拉回手牌，但卻被系統判定為使用

**根因（`src/routes/game/+page.svelte` 的 `onWindowPointerUp`）：**

其他拖曳 kind 都有 drop target 檢查才 dispatch：
- `basic` → 需要 `benchEmpty` / `activeEmpty`
- `evolve` → 需要 `tIid`
- `tool` → 需要 `tIid`

只有 `trainer` 分支寫成 unconditional dispatch：
```js
} else if (d.kind === 'trainer') {
  // 支援者/物品/競技場 — 拖到任何非手牌區域即使用
  // 用 closest 判斷 hit 是否在 hand-scroll 內
  // (drop position 其實不重要，只要不是 hand-scroll 或 hand-card)
  await dispatch(GameActions.playTrainer(d.iid));  // ← 註解寫了「除非是 hand-scroll」，但實作忘了做那個檢查
}
```

註解說明了正確行為（「非手牌區域才使用」）但實作沒照辦——不管拖到哪裡都打出去。結果 Leon 拉回手牌想取消，卻被判定使用。

**修法（pointerup 時用座標 hit-test `.playmat`）：**

```diff
- async function onWindowPointerUp(_e: PointerEvent) {
+ async function onWindowPointerUp(e: PointerEvent) {
  ...
  } else if (d.kind === 'trainer') {
-   await dispatch(GameActions.playTrainer(d.iid));
+   const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
+   const inPlaymat = !!hit?.closest('.playmat');
+   const inHand = !!hit?.closest('.hand-strip');
+   if (inPlaymat && !inHand) {
+     await dispatch(GameActions.playTrainer(d.iid));
+   }
+   // else: 取消使用（手牌保留）
  }
```

**為何檢查 `.playmat` 而不是只排除 `.hand-strip`：**
- Leon 描述兩個取消條件：(1) 「拖回手牌的地方」 (2) 「沒有拖曳到釋放區域」
- `.playmat.trainer-drop-zone::before` 本來就有綠色虛線框視覺提示「這裡是釋放區」（見 `.playmat{ class:trainer-drop-zone={dragging?.kind==='trainer'} }`）
- 正向檢查 `inPlaymat` 同時涵蓋兩種 cancel 情境（拖回手牌 AND 拖到 sidebar / toolbar / 視窗外）

**為何用 `e.clientX/Y` 而不是 `d.x/d.y`：**
- `d.x/d.y` 是 pointermove 快照，pointerup 前最後一次 move 的位置；多數情況與 pointerup 一致，但邊緣 case 可能有 1-frame 差
- `e.clientX/Y` 直接取 pointerup event 自身座標，最準確

**不影響其他 trainer 類型：**
- 附加道具（tool）走 `d.kind === 'tool'` 分支，本來就要求 `tIid`，不受影響
- 設置場地（stadium）實際屬於 trainer kind，但是靠 `playTrainer` → effects.ts 的 resolver 處理；只要釋放點在 playmat 內，stadium 照常生效
- 有 pendingSelection 的 supporter（如 Iono / Boss / 艾莉卡款待）也都在 dispatch 後才 push selection，取消時根本沒進 effects，不會留狀態殘渣

**驗證：** `/tmp/ptcg-work/repo` 本機 `npm run build` 通過。版本 1.54 → 1.55。

