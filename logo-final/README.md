# PTCG TW SIM 最終 Logo 素材包（方案 4「屬性色環」定稿）

> 2026-08-13。**本輪未 push、未改任何站上檔案**，只產出素材。雙擊 `index.html` 離線預覽全部版本。
> 上一輪錯誤已修正：**移除妖、加入惡**，且全部色碼改為**站台既有的 ENERGY_COLOR**（不再憑印象配色）。
> 本輪新增（站長三決定落地）：① maskable **正式版＝淺底、內容放大到 96%**（附三種裁切模擬圖）；
> ② `og-image-1200x630.png` 與 YouTube 縮圖（base＋範例標題兩層）成圖；③ 畫法完整記錄於 `skill/SKILL.md`。

## 一、屬性查證結果（資料來源：`static/cards/*.json`，只算卡片自身 `regulationMark` ∈ H/I/J）

live 卡包（`static/cards/index.json`）共 42 包，H/I/J 卡合計 **4688** 張。統計腳本邏輯：逐卡看 `pokemonType`、`attacks[].cost`、`weakness.type`、`resistance.type`、能量卡名。

| 屬性 | pokemonType 出現 | 招式費用出現 | 基本能量卡 | 入環？ |
|---|---:|---:|---|---|
| 草 Grass | 525 | 660 | 基本【草】能量 ×8 | ✅ |
| 火 Fire | 393 | 830 | ×10 | ✅ |
| 水 Water | 457 | 765 | ×7 | ✅ |
| 雷 Lightning | 341 | 648 | ×9 | ✅ |
| 超 Psychic | 509 | 746 | ×9 | ✅ |
| 鬥 Fighting | 414 | 746 | ×6 | ✅ |
| **惡 Darkness** | **406** | **745** | **基本【惡】能量 ×10** | ✅ |
| 鋼 Metal | 236 | 448 | ×8 | ✅ |
| 龍 Dragon | 155 | 0 | 無 | ❌（無基本能量卡） |
| 無色 Colorless | 425 | 5448 | 無 | ❌（無基本能量卡；色相近鋼/金框） |
| **妖 Fairy** | **0** | **0** | **無** | —（**H/I/J 已完全不存在**） |

- 「妖」字樣在 H/I/J 只出現在**卡名**（風妖精、雪妖女、朽木妖…共 77 張），`Fairy` 從未出現在任何屬性欄位（pokemonType／cost／弱點／抵抗力全為 0）。站長指正屬實。
- **色環 8 段的取捨標準**：取「H/I/J 實際發行過基本能量卡」的 8 屬性＝玩家組牌時真正的 8 色能量。龍與無色是卡的屬性但沒有對應基本能量，且龍 `#c8a332` 撞金框、無色 `#c8c2b5` 撞鋼段，入環反而降低辨識。

## 二、顏色來源（站台既有配色，非自定）

`src/lib/cards/energy.ts` **L19–L31 `ENERGY_COLOR`**（全站卡庫篩選、能量 pip、攻擊特效同一份；`ENERGY_LABEL` 在 L4–L16）：

| 環位（12 點鐘起順時針） | 屬性 | 色碼 |
|---|---|---|
| 1 | 草 | `#6bb34c` |
| 2 | 火 | `#e05a2b` |
| 3 | 水 | `#4a92d4` |
| 4 | 雷 | `#e8c423` |
| 5 | 超 | `#9b4ea0` |
| 6 | 鬥 | `#a65a2a` |
| 7 | 惡 | `#3f3a5c` |
| 8 | 鋼 | `#8d8f94` |

輔色（非屬性）：金框漸層 `#ffe08a→#e0b23f→#9f7414`、卡面深藍 `#232b58`、深底 `#0e1330`、maskable 深藍底 `#1a2150`、淺底 `#f5f3ec`。

## 三、檔案清單與用途

| 檔案 | 尺寸 | 用途 |
|---|---|---|
| `logo-512-light.png` | 512 淺底 | og-image 底、文件、簡報、印刷 |
| `logo-512-dark.png` | 512 深底 | 站內深藍主題、YouTube 縮圖、宣傳片（深底版分隔線改亮色＋亮緣，惡段不沉底） |
| `logo-512-transparent.png` | 512 透明 | 疊圖用（淺底；深底疊圖請用 `logo-master-ondark.svg` 重出） |
| `logo-128-light.png` / `logo-128-dark.png` | 128 | 報告圖落款、通知大圖示 |
| `logo-32-light.png` / `logo-32-dark.png` | 32 | favicon（**簡化版構圖**，見下） |
| `logo-mono-light-512.png` / `logo-mono-dark-512.png` | 512 | 單色場合（墨 `#10142c`／米白 `#f5f3ec`） |
| `logo-maskable-light-512.png` | 512 | **PWA `purpose:maskable` 正式版（淺底）**。內容比例 **96%**：色環外緣 200.9px＜W3C 安全圓半徑 204.8px（40%），留約 4px 緩衝 |
| `logo-maskable-navy-512.png` | 512 | maskable 深底備用（同 96%；含亮外環，外緣 202.6px 仍安全） |
| `maskable-crop-sim.png` | — | 三種裁切模擬檢查圖（正方形／圓角方形 rx=20%／80% 安全圓＋96/72/48px 縮小檢視），已逐一目視確認 |
| `og-image-1200x630.png` | 1200×630 | 分享預覽卡成圖（→覆蓋 `static/og-image.png`；文案在 `gen_marketing.py` TEXTS 可改） |
| `youtube-thumb-base-1280x720.png` | 1280×720 | YouTube 縮圖**底圖**（右側 x580–1240,y140–620 留空給每週標題；Canva 疊字流程見 `skill/SKILL.md` §7） |
| `youtube-thumb-1280x720.png` | 1280×720 | YouTube 縮圖範例標題版（「本週環境報告／TOP 牌組・勝率解析」，336×189 小圖已驗證可讀） |
| `logo-master.svg` / `logo-master-ondark.svg` | — | 完整版母檔（淺底用／深底用） |
| `logo-simple.svg` / `logo-simple-ondark.svg` | — | 32px 簡化版母檔 |
| `logo-mono.svg` | — | 單色母檔（currentColor，可任意換色） |
| `gen_logo.py` | — | 產生器：`python3 gen_logo.py` 重出全部 logo（maskable 比例在 `MASK_SCALE`） |
| `gen_marketing.py` | — | 產生器：`python3 gen_marketing.py` 重出 og-image／YouTube 縮圖／裁切模擬（文案在頂部 `TEXTS`） |
| `skill/SKILL.md` | — | **畫法完整紀錄（skill）**：查證方法、設計規格、替換清單、踩坑史——給未來 AI 重現用 |
| `index.html` | — | 離線預覽頁（含 PWA 圓形/squircle 裁切模擬、32px 原寸＋放大並列） |
| `_checks/` | — | 渲染檢查用拼圖（可刪） |

**32px 驗證結果（親眼看過）**：完整版在 32px 卡面細節會糊，故 32px 一律用簡化版（粗環、內孔加大、卡片只剩金框＋深藍面＋單一大星）——原寸與 8 倍放大皆確認 8 色可辨、卡形可辨；深底版靠亮色外緣把「惡」段從深藍底切出來。單色版於淺/深底皆以 512 實際渲染確認清晰。

## 四、全站替換清單（2026-08-13 重新 grep 逐條複查，行號為當日 HEAD 實況）

> 原則：**沿用既有檔名**只換內容＋bump `?v=`。對應關係：`icon-32` ← `logo-32-*`、`icon-180`/`icon-192`/`icon-512` ← 完整版重出對應尺寸（gen_logo.py 加一行 render 即可）、`icon-512-maskable` ← `logo-maskable-light-512.png`。

### A. 主站（E:\ptcg-tw-sim）
1. `static/icons/`：`icon-32.png`、`icon-180.png`、`icon-192.png`、`icon-512.png`、`icon-512-maskable.png` 五顆全換。
2. `src/app.html`（已複查無誤）
   - **L47–L50**：apple-touch-icon／favicon ×4 → bump `?v=4.993` 為新值（iOS 對 apple-touch-icon 快取極頑固）
   - **L77**：開場 splash `<img class="app-splash-icon">`（icon-192）→ bump `?v=`
   - **L25、L34、L64**：`og-image.png` 引用 URL 不用改，但 **`static/og-image.png`（1200×630）本身要重做**（現版含舊 logo）——可用 `logo-512-dark.png`＋站名字樣重排
3. `static/manifest.json`（已複查）：**L15、L21、L27** 三個 `src` 的 `?v=4.993` → bump；L27 maskable 換 **`logo-maskable-light-512.png`（站長拍板正式版＝淺底）**
4. `src/lib/notify.ts` **L176、L256**、`src/service-worker.ts` **L149**：推播 icon 均指 `icons/icon-192.png`，檔名沿用**不用改碼**；照慣例 bump 站版號讓 SW precache 更新

### B. 報告圖／後台（oracle-admin）
5. `oracle-admin/icons/site-icon-192.png` → 換新 logo 192px（報告圖識別）
6. `oracle-admin/admin.html` **L3301**：`img.src = 'icons/site-icon-192.png?v=1.65'` → bump `?v=`（上一輪已勘誤：是 3301 不是 3300，本輪再次確認）。後台自身 favicon（**L13–L16**，紫色 ADMIN 專用 icon）與主站 logo 無關，可不動。部署走站長的 update-admin-full.bat
### C. 行銷素材（站長本輪特別點名）
7. **`static/og-image.png`**（1200×630）：✅ 成圖已做好＝`logo-final/og-image-1200x630.png`，直接覆蓋原檔名即可
8. **`YouTube縮圖_1280x720.png`**（repo 根目錄）：✅ 新流程已做好＝`youtube-thumb-base-1280x720.png`（Canva 疊每週標題）＋範例版；`PTCG宣傳片_90秒.mp4` 若片頭含舊 logo 另行處理
9. `static/line-group-qr.png`：QR 圖，若中央嵌了舊 logo 請站長確認（本輪未拆圖驗證）

### 替換注意事項
- **快取三層**：`?v=` bump（HTML/manifest）→ SW precache（bump 站版號觸發）→ **Cloudflare 對正式站靜態檔可快取數天**（v6.155 教訓：index.json 被快取 4 天），換完請用無痕＋手機實機各驗一次
- **報告圖 Canvas**：admin 報告圖的 logo 走 `img.onload` 畫進 canvas，**未 decode 會靜默不畫**（v1.64 教訓）——換圖後務必實際匯出一張報告圖確認落款有出現
- 兩段式部署：先測試站等綠燈，三支 bat 由站長自跑

## 五、紅線自查
色環為 8 段多色扇形：無上下二分色、無中央橫帶、無中央圓鈕（中央是**矩形**金框卡）——精靈球三要素零命中。未使用官方能量符號圖形（只借站台自己的色票）、無角色、無官方標準字。
