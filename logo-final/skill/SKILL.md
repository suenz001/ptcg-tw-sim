---
name: ptcg-site-logo
description: ptcg-tw-sim 站台品牌識別（方案 4「屬性色環」）的完整畫法與替換流程。Use when Wilson 提到 logo、換 logo、icon、favicon、PWA icon、maskable、og-image、分享預覽圖、YouTube 縮圖、報告圖 logo、品牌識別、頭圖、宣傳圖 —— 含屬性色票查證方法、gen_logo.py／gen_marketing.py 產生器、全站替換清單與踩坑史。
---

# ptcg-site-logo — 站台 Logo 畫法與替換全紀錄

> 2026-08-13 定稿。素材與產生器全部在 repo `logo-final/`（E:\ptcg-tw-sim\logo-final\）。
> **這份文件的目標：一個完全沒有對話記憶的 AI 也能重現、延伸、正確替換這套識別。**

## 0. 識別是什麼（一句話）

**8 段屬性色環，中央一張金框深藍卡牌、上有白色四芒星**。色環＝玩家組牌真正會用到的 8 色基本能量；金框卡＝「這是卡牌對戰站」。整體是同心圓構圖，天生耐圓形裁切。

## 1. 版權紅線（每次改圖前自查）

- **精靈球三要素**絕不齊備：上下二分色、中央橫帶、中央圓鈕。本設計是「多段扇形環＋中央**矩形**卡」——三要素零命中，改版時不得往精靈球方向靠。
- 禁止出現：任何寶可夢**角色**、官方**標準字**（Pokémon logo 字體）、官方**能量符號圖形**（葉子/火焰/水滴…那套 icon）。
- **顏色本身不受著作權保護**——用「草＝綠、火＝紅…」的色彩聯想是安全的，但我們用的是**站台自己的色票**（見下），不是抄官方圖檔。

## 2. ⭐ 屬性與顏色的查證方法（兩個踩過的大坑）

### 坑 A：不可憑印象配色
曾經憑印象填色碼被退。**色碼唯一來源**：`src/lib/cards/energy.ts` **L19–L31 `ENERGY_COLOR`**（`ENERGY_LABEL` 在 L4–L16）。全站卡庫篩選、能量 pip、攻擊特效都用這份，logo 必須同源。若行號漂移，grep：
```
grep -n "ENERGY_COLOR" src/lib/cards/energy.ts
```

### 坑 B：妖屬性已退場（曾把「妖」畫進色環被站長指正）
H/I/J 賽制 `Fairy` 在屬性欄位**完全不存在**（pokemonType／attacks[].cost／weakness／resistance 全為 0；「妖」只出現在卡名如風妖精）。查證方法——**只信 `static/cards/*.json` 統計，不信印象**：
- 逐卡（卡片自身 `regulationMark` ∈ H/I/J，⚠不是看卡包）統計 `pokemonType`、`attacks[].cost`、基本能量卡名（「基本【X】能量」）。
- live 卡包清單看 `static/cards/index.json`。

### 8 段的取捨標準（站長已拍板）
入環＝「H/I/J **實際發行過基本能量卡**」的 8 屬性。龍（無基本能量、#c8a332 撞金框）、無色（無基本能量、#c8c2b5 撞鋼段）不入環。

## 3. 設計規格

- **座標系**：512×512 viewBox，圓心 (256,256)。
- **色環**：8 段各 45°，**12 點鐘起順時針＝草火水雷超鬥惡鋼**：
  `#6bb34c` `#e05a2b` `#4a92d4` `#e8c423` `#9b4ea0` `#a65a2a` `#3f3a5c` `#8d8f94`
  完整版外半徑 208／內半徑 144，段間縫 gap 3°，描邊 2.5px。
- **金框卡**：外框 118×164 圓角 12（比例≈0.72，接近真卡 63:88），金漸層 `#ffe08a→#e0b23f→#9f7414`（45°）；內面 102×148 圓角 8 深藍 `#232b58`；白色四芒星（大星＋右上小星 opacity .85）；投影 translate(6,7) 黑 18%。
- **發光**：環上「gloss」線性漸層（白 .34 → 白 .04 → 黑 .20，上亮下暗）；中央「halo」放射漸層（`#fffbe8` .55→.16→0，r=132）。
- **深底版（on_dark）差異**：分隔描邊改白 .38、外圈 r209.5／內圈 r142.5 白色亮環（.28/.22, 3px）——否則**惡段 `#3f3a5c` 會沉入深藍底**。
- **32px 簡化版**：粗環（外 208／內 120、gap 2.2、描邊 6）、無光澤無光暈、卡片只留金框＋單一大星；深底再加白外緣 r212／內緣 r116。
- **輔色**：深底 `#0e1330`、maskable 深藍 `#1a2150`、淺底 `#f5f3ec`、卡面 `#232b58`。

## 4. 產生器怎麼用

沙盒需求：`pip install cairosvg`＋系統有 Noto Sans CJK TC 字型（行銷圖文字用）。

```
cd logo-final
python3 gen_logo.py        # 重出全部 SVG 母檔 + logo PNG（含 maskable）
python3 gen_marketing.py   # 重出 og-image、YouTube 縮圖(base+範例)、裁切模擬圖
```
- 參數都在檔案頂部：`gen_logo.py` 的 `RING`（色表）、`MASK_SCALE`（maskable 內容比例）；`gen_marketing.py` 的 `TEXTS`（所有文案——**站長要改字就改這裡重跑**）。
- 產生後**必須親眼看渲染結果**（歷史教訓：宣稱看過而沒看＝事故）。

## 5. 版本清單與用途

| 檔案 | 用途 |
|---|---|
| `logo-master.svg` / `logo-master-ondark.svg` | 完整版母檔（淺底用／深底用） |
| `logo-simple.svg` / `logo-simple-ondark.svg` | 32px 簡化版母檔 |
| `logo-mono.svg` | 單色母檔（currentColor 任意換色） |
| `logo-512-light/dark/transparent.png` | 頭圖、行銷底圖、疊圖 |
| `logo-128-light/dark.png` | 報告圖落款、推播通知大圖示 |
| `logo-32-light/dark.png` | favicon（**一定用簡化版構圖**） |
| `logo-mono-light/dark-512.png` | 單色印刷、浮水印 |
| `logo-maskable-light-512.png` | **PWA maskable 正式版（淺底，內容 96%）** |
| `logo-maskable-navy-512.png` | maskable 深底備用 |
| `maskable-crop-sim.png` | 三種裁切模擬檢查圖 |
| `og-image-1200x630.png` | FB/LINE/Twitter 分享卡（→覆蓋 `static/og-image.png`） |
| `youtube-thumb-base-1280x720.png` | YouTube 縮圖**底圖**（無標題，給 Canva 疊字） |
| `youtube-thumb-1280x720.png` | YouTube 縮圖範例標題版 |
| `index.html` | 離線預覽全部素材（雙擊開啟） |

## 6. maskable 規則（站長拍板：淺底＋盡量放大）

- W3C 最小安全區＝中心圓**半徑 40%**（512px→204.8px），外圍 10% 可能被任何形狀裁掉。
- 淺底完整版最外緣＝色環 208＋描邊 1.25＝209.25px → 理論上限 scale≈0.978；**採 `MASK_SCALE=0.96`**（外緣 200.9px，留約 4px 抗鋸齒緩衝）。深底版含亮環外緣 211px，0.96 時 202.6px 也安全。
- 色環是同心圓 → 即使遇到裁得更兇的非標啟動器，也只會均勻削環外緣、不會切壞構圖。改版時**維持同心圓構圖**就保有這個性質。
- 驗證方式：跑 `gen_marketing.py` 出 `maskable-crop-sim.png`（正方形／rx=20% 圓角方形／80% 安全圓＋96/72/48px 縮小），逐一目視。

## 7. og-image 與 YouTube 縮圖規格

- **og-image（1200×630 淺底）**：左 440px logo；右側＝站名 68px 粗體＋金色短槓＋副標 39px＋三顆深藍膠囊（免安裝／即開即戰／H/I/J 標環境）＋網址；底部 16px 八色條。文案全在 `gen_marketing.py` TEXTS。
- **YouTube 縮圖（1280×720 深底 #0e1330）**：左 490px 深底版 logo＋背光；左上小站名；底部 20px 八色條；**右側 x580–1240、y140–620 是每週標題區**（base 版此區全空）。範例字級：主標白 108px 粗體、金色底槓、副標金 `#ffd76a` 58px——小圖 336×189 已驗證可讀。
- **站長（非工程師）每週換標題的做法（Canva）**：
  1. 開 canva.com →「建立設計」→「自訂尺寸」輸入 1280×720
  2. 「上傳」→ 選 `youtube-thumb-base-1280x720.png` → 拖進畫布拉滿
  3. 加兩個文字框放在右半空白區：主標選粗黑體、白色、約 100pt；副標金色（色碼 `#FFD76A`）、約 55pt
  4. 之後每週用「建立副本」只改字 → 右上「分享」→「下載」PNG
- 紅線同第 1 節：兩張圖上不可出現角色／官方標準字／精靈球元素。

## 8. 全站替換清單（換 logo 時逐條做；行號為 2026-08-13 HEAD，先 grep 再信）

沿用既有檔名只換內容＋bump `?v=`。對應：`icon-32`←`logo-32-*`、`icon-180/192/512`←完整版重出對應尺寸（gen_logo.py 加一行 render）、`icon-512-maskable`←`logo-maskable-light-512.png`。

1. `static/icons/`：`icon-32.png`、`icon-180.png`、`icon-192.png`、`icon-512.png`、`icon-512-maskable.png` 五顆全換。
2. `src/app.html`：L47–L50 favicon/apple-touch-icon `?v=4.993`→bump（iOS 快取極頑固）；L77 splash icon `?v=` bump；L25/L34/L64 og-image URL 不改字。
3. `static/manifest.json`：L15/L21/L27 三個 `src` 的 `?v=` bump；L27 maskable 指向新檔內容。
4. `src/lib/notify.ts` L176/L256、`src/service-worker.ts` L149：檔名沿用不改碼，bump 站版號讓 SW precache 更新。
5. `static/og-image.png`：用 `og-image-1200x630.png` 覆蓋（檔名沿用）。
6. repo 根 `YouTube縮圖_1280x720.png`：改用新縮圖流程。
7. `oracle-admin/icons/site-icon-192.png` 換新＋`oracle-admin/admin.html` **L3301** `?v=1.65` bump；部署走站長的 update-admin-full.bat。⚠ admin 自身 favicon（L13–16 紫色 ADMIN icon）與主站 logo 無關，不動。
8. `static/line-group-qr.png` 中央若嵌舊 logo，請站長確認後重出 QR。

⚠ 快取三層：`?v=` bump → SW precache（bump 站版號）→ Cloudflare 可快取數天（index.json 曾被快取 4 天）。換完無痕＋手機實機各驗一次。
⚠ 報告圖 Canvas：admin 報告圖 logo 走 `img.onload` 畫進 canvas，**未 decode 會靜默不畫**——換圖後實際匯出一張報告圖確認落款。
⚠ 部署鐵律：兩段式（先測試站等綠燈），三支 bat 由站長自跑，絕不代跑。

## 9. 踩過的坑（改版前全部讀一遍）

1. **憑印象配色**→退件。色碼只能來自 `energy.ts ENERGY_COLOR`。
2. **把妖畫進色環**→站長指正。H/I/J 妖已完全退場（第 2 節查證法）。
3. **深底鬼影／深底隱形**：深藍底上惡段 `#3f3a5c` 幾乎隱形、深色描邊產生髒鬼影。解法＝深底版一律亮色分隔線＋亮色內外緣（on_dark 分支），不要拿淺底版直接放深底。
4. **撞到 Google logo**：段數少、只剩紅黃綠藍時整體像 Google 色環。解法＝維持 8 段全彩（含惡鋼的暗色與中性色），並保留中央金框卡當識別主體。
5. **32px 直接縮小會糊**：完整版的光澤、小星、細縫在 32px 全爛。favicon 一律用簡化版構圖（第 3 節）。
6. **maskable 安全邊距**：早期縮到 52% 太保守（站長嫌留白多）；現行 96% 是「W3C 40% 安全圓內的最大值留 4px 緩衝」。再放大前先重算幾何並重跑裁切模擬。
7. **站長退件過「太呆板、看不出是寶可夢卡牌」**：純幾何環不夠——中央那張金框卡＋星是「卡牌感」的來源，任何改版都不可拿掉或縮太小。
8. **宣稱看過渲染圖而其實沒看**＝事故。每次出圖必須實際打開檢查。
