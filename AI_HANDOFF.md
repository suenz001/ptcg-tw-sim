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

### Commit
- `5ceb89c` feat(game): M2 Phase C — evolve, retreat, play basic, trainer effects

### 給下一位 AI
1. **effects.ts 擴充**：新卡效果只需在 `effects.ts` 加 `reg('卡名', fn)` 即可，不用動引擎
2. **互動效果流程**：`PLAY_TRAINER` → 呼叫 `effectFn` → 回傳含 `pendingSelection` 的 state → UI 顯示選擇 → `RESOLVE_SELECTION` → 呼叫 `resolver` → 繼續
3. **搜尋效果分頁**：目前 PendingSelection deck-search 會把整個牌庫顯示出來（可能幾十張），UI 沒有分頁；大型牌庫時 scroll 即可，M3 如需優化可加
4. **未實裝效果**：遇到不在 `TRAINER_EFFECTS` 登錄的卡名 → `applyAction` 只棄置卡片並 log「效果尚未實裝」，不影響遊戲進行
5. **下一步**：M3 連線對戰系統，或繼續補充更多卡效果
