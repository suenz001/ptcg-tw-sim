# 內部改版紀錄（不打包進網站）

## v6.273 — Firestore 讀取減量【P2：client 端三大宗】（玩家零感，不寫首頁 changelog）

BASE `d7761cce38ff2352b766763324ede99ba833067e`（v6.272，遠端 main）。
站長：「每日讀取幾乎都是 45000 到 48000 左右」（免費額度 50,000/日，天天如此）。
v6.272 已做 admin 端止血；本版處理 client 端三大宗（純前端，**不需要伺服器改動**）。

### 1. `config/homeChangelog`（最大宗：每次首頁載入 1 讀、不分匿名 ≈ 1.2萬~2萬/日）
- 實查（Firestore REST，2026-08-30）：**這份 admin override 文件根本不存在**（404 NOT_FOUND，
  非 403 → 規則允許讀、文件不存在）。全站每天花上萬次讀取去「確認它不存在」。
- 修法：`src/lib/home-changelog-cache.ts`（新檔）— localStorage TTL 快取 **6 小時**，
  含「確認過不存在」的**負結果**。`+page.svelte` 接線改走 `loadHomeChangelogOverride()`。
- 取捨：admin 之後若改/新增 override，新訪客與快取過期者立即生效，其餘最慢 6 小時。
  override 從未被使用過（文件不存在），故玩家零感、不寫首頁 changelog。
- 防呆：隱私模式（localStorage throw）→ 照舊每次讀；時鐘倒退（at 在未來）→ 視為過期
  （v6.198 教訓）；fetch 失敗不寫快取。快取存原始字串，`__BASE__` 替換仍在使用端。

### 2. `users/{uid}/decks` 整批 getDocs（第二大宗：每副牌 1 讀，30 副＝30 讀/次）
- 用途查證：進 /decks（**含匿名**）與對戰頁（Google）都整批拉 → 與 localStorage merge
  by updatedAt（跨裝置同步＋首次上雲 push＋localStorage 遺失復原）。**匿名玩家有雲端牌組**
  （cloud 空且 local 有時會自動 push 上雲）⇒ 不能直接跳過匿名，改用 meta 方案一體涵蓋。
- 修法：`users/{uid}/meta/decks` 單一文件記 `rev`（每次雲端牌組寫入後 bump）；client 把
  「上次全拉時看到的 rev」記在 localStorage（`ptcg_decks_cloud_rev_v1`，含 uid 綁定）。
  進頁時 1 讀 meta：rev 沒變（且本地牌組非空）→ 跳過整批 getDocs。
- ⚠⚠ 牌組安全（本輪最高風險）：**所有邊界一律 fail-open 整批全拉** —— 無本地 rev（首次/
  換裝置/隱私模式）、本地牌組空（快取損毀）、換帳號（uid 不符）、meta 不存在/讀取失敗。
  跳過分支只沿用 localStorage、零雲端寫入。meta 放**獨立子集合** `meta/`（不是 `decks/`
  底下）⇒ 舊版 client 的 getDocs 永遠看不到它，不會把 meta 誤當一副牌。
- bump 佈點（decks/+page.svelte）：saveAllDecksToCloud（整批 1 次）、dropDeck、首次上雲、
  persistDeckOrder（整批 1 次）、actualPushDeck（目前無人呼叫，防未來）。全拉後
  `recordCloudDecksRev`：meta 已有→0 寫只記本地；meta 缺→一次性遷移建 meta（1 寫）；
  **雲端空集合不建 meta**（純過路匿名訪客零額外讀寫）。
- 已知取捨：舊 client（混用期）寫入不 bump meta → 其他裝置最慢到下次「rev 有變」才看到
  （不會丟資料：進頁比對仍每次執行，任何 bump 都會觸發全拉）。

### 3. `config/broadcast`（每場線上對局每端 1 讀 ≈ 0.3k~1k/日）
- 實查：文件存在且站長**活躍使用中**（2026-08-30 當天才更新過「強制更新」公告）。
- 修法：10 分鐘**記憶體**快取（不碰 localStorage）。F5/新分頁立即生效；已開著的分頁
  最慢 10 分鐘後的下一場生效。讀取失敗不快取（v5.481 容錯語意不變）。

### 4. 全站 client 端 Firestore 讀取點盤點（rev-pinned git grep）
① `+page.svelte:114` homeChangelog（本版修）② `cloud.ts:38` decks getDocs（本版修）
③ `broadcast.ts:19`（本版修）④ `favoritesCloud.ts:19` — 只在 /decks 手動「📥 從雲端讀取」
按鈕內，量小不動 ⑤ `tracking.ts:82` — 僅 Google 會員且 24h throttle，量小不動
⑥ `+page.svelte:207/246` feedback modal onSnapshot ×2 — 開 modal 才觸發，量小不動
⑦ `room.ts` 多處 — 正式站 build 被 `oracleSwapPlugin`（vite.config.js）換成 room-oracle
（走 Oracle fetch），dead path 不計 ⑧ `admin/feedbacks/+page.svelte` — admin 專用（v6.272 已管）。

### 5. 量化（守衛 spy 實測，非推估；scripts/test-v6273-firestore-client-read-cache.mjs【G】）
- 典型 session（首頁→/decks→對戰(1 場線上)→/decks、Google 30 副、快取暖）：
  **修前 92 讀（1＋30＋31＋30）→ 修後 4 讀（0＋1＋2＋1），省 95.7%**。
- 匿名 1 副同 session：4 讀 → 3 讀（對戰頁匿名本就 0 讀牌組，維持零讀取）。
- 全站估算：homeChangelog ~1.2萬~2萬/日 → 快取暖後降 ~9 成（TTL 6h ⇒ 每裝置每日 ~1-2 讀）；
  decks ~1萬~2.5萬/日 → 每次進頁 N 讀變 1 讀（多牌組玩家降 9 成以上）。
  預估總量 45k~48k/日 → **約 8k~15k/日**（首次訪客/冷快取仍要讀，無法歸零）。
- 寫入額度影響：bump ≈ 每次「存檔/刪除/順序調整」+1 寫（估 +0.5k~2k/日）＋ 老帳號一次性
  遷移（每 uid 1 寫，攤在升版後首週）。相對免費額度 20,000/日安全；無變動 session 0 寫
  （守衛 G1 斷言 writes=0）。

### 6. 守衛
`scripts/test-v6273-firestore-client-read-cache.mjs`（58 條，已入 package.json test chain）：
【A】快取行為 8 條（命中/過期/損毀/隱私模式/時鐘倒退/失敗不快取/正對照）【B】首頁接線實跑
【C】cloud helpers 12 條（五種 fail-open 邊界＋讀寫次數）【D】/decks 段實跑 8 條（含「跳過分支
牌組不消失」「雲端掛掉不洗空」）【E】對戰頁 4 條（含匿名零讀取）【F】broadcast 5 條
【G】session 量化（修後絕對值 history-free；BASE 對照淺複製時 SHALLOW-SKIP）【H】HEAD-FAIL
6 條（BASE 上各自紅）【I】突變 6 條（含 I3「跳過分支洗空牌組」必須紅）。

## v6.272 — Firestore 讀取減量【P1：admin 端止血】（純伺服器端，玩家零改動）

BASE `866c4dcf61d876dd06c45e1215a50f4a4ad4f910`（v6.271，遠端 main）。
動到的檔案只有 `oracle-admin/server_admin_patch.js`（v1.30 → v1.31）、`oracle-admin/admin.html`、
`src/lib/version.ts`、`package.json`、本檔、新守衛，以及 `scripts/test-v6219-admin-stats-users-cache.mjs`
（見第 6 節）。**首頁 changelog 不寫**（玩家看不到 admin 後台）。

### 0. 站長回報（逐字）
> 「我的 firebase 資料量已經逼近免費額度的上限…減少對 firebase 的依賴，避免被收費」

站長補充確認：**吃緊的是「讀取數」，不是儲存量**。

### 1. ⭐⭐⭐ 先把官方計費規則查清楚（Rule 29 的精神：動之前先查文件）
出處 <https://cloud.google.com/firestore/pricing>（2026-08-30 查證，逐字引用）：

| 主題 | 官方原文 | 對我們的意義 |
|---|---|---|
| 免費額度 | 「Free tier … **Document reads 50,000 per day**」 | 每天 5 萬次，超過就收費 |
| 每次查詢底價 | 「There is a **minimum charge of one document read** for each query that you perform」 | 空查詢也要 1 次 |
| `count()` 計費 | 「For aggregation queries such as count(), sum(), and avg(), you are charged for index entries read … you are charged **one read operation for each batch of up to 1000 index entries**」；「count() operations that read between 0 and 1000 index entries are billed for **one document read**」 | 一間房訊息 < 1000 則 ⇒ **一次 count() 就是 1 次讀取** |
| `offset()` | 「when you send a query that includes an offset, you are charged a read for **each skipped document**」 | ⚠⚠ **Firestore 絕不可以照 Mongo 那樣 skip 分頁**，那比全撈還貴 |

⚠⚠ **Admin SDK 不豁免**。它繞過的是 **Firestore 安全規則（firestore.rules）**，
**讀取照樣計費、照樣吃免費額度**。原本 `server_admin_patch.js` 的註解寫
「admin SDK 不吃 client quota」——**那句話是錯的**，本版把它更正並附上官方出處。

### 2. 掃出來的無上限 Firestore 讀取（全站，`git grep` 指定 rev 掃 BASE）

| # | 位置（v6.271 行號） | 觸發時機 | 有無上限 | 估算讀取量 | 本版處置 |
|---|---|---|---|---|---|
| 1 | `server_admin_patch.js:637` | admin 點「🔥 Firebase 對戰」的 lobby/playing/**ended** | **無** | = 該 status 的房數 | ✅ 加上限 300 |
| 2 | `:638` | 同上，「全部」 | **無** | = 整個 rooms collection | ✅ 加上限 300 |
| 3 | `:656` | 同上，**逐房** `count()` messages | 無（跟著 1/2 的筆數） | **N 次** | ✅ 預設不算（`?msgCounts=1` 才算） |
| 4 | `:340` `/api/admin/stats` | 每開一次「📊 總覽」 | **無** | = feedbacks 總數 | ✅ 改 5 分鐘快取 |
| 5 | `:819` `/api/admin/firebase/feedback` | 每開一次「💬 意見回饋」 | **無** | = feedbacks 總數 | ✅ 同上快取（＋2000 筆安全上限） |
| — | `:801` / `:2048` / `:2141`（單一玩家的 decks／feedbacks） | 查單一玩家 | 天然有界（單人） | 個位數～數十 | 不動 |
| — | `:366` `/api/admin/firestore-write-audit` | 站長手動按「執行 Audit」 | 全部走 `count()` | 約 5 ×（collection 數 + 3） | 不動（本來就便宜） |
| — | `:697` messages 列表 | 點某一房的 💬 | `limit(500)` | ≤ 500 | 不動 |
| — 玩家端 | `src/lib/game/room.ts:1012/1035/1268`、`src/routes/admin/feedbacks/+page.svelte:66`、`src/lib/decks/cloud.ts:38` | 玩家操作 | `limit(50/80/100/MESSAGES_LIMIT)`／單一使用者 | 小 | **零改動** |

⇒ **沒有第 6 個無上限的讀取點**。Fable 5 指認的 4 個位置（637/638/656/340）與第 5 個（819）
**行號全部正確**，「admin SDK 不吃 client quota 是錯的」這一點也正確；
唯一需要補正的是它自陳「未查官方文件」的 `count()` 計費規則 —— 本版已查證並逐字引用。

### 3. 修法

#### 3a. `/api/admin/firebase/rooms` 加上限（沿用 v1.22／v6.240 Oracle 分頁的做法）
沿用的是 **「哨兵欄位 ＋ 全量真值 counts ＋ 常數寫在 handler 內」** 這三件事，不是重造一套：

* `capped: true`（新伺服器才有；舊 `admin.html` 拿不到就照舊行為）
* `truncated` / `matchedTotal`（**這個篩選底下的全量真值**，來自本來就在打的 3 發 `count()`）
* `orderedBy`（`updatedAt` / `createdAt` / `__name__`）
* 常數 `FB_ROOMS_CAP_DEFAULT` / `FB_ROOMS_CAP_MAX` **寫在 handler 內部**
  （v6.229／v6.240 教訓：既有守衛把 `app.get(...)` 整段抽出來跑，依賴外層變數會抽出空殼）

⚠ 與 Oracle 那支**唯一不同**：Firestore 不能 `offset` 分頁（見上表），所以這裡是**只用 limit
的「最新 N 筆」**，不是真分頁；要看更多用 `?cap=`（硬上限 1000）。

**上限 300 的依據**：`admin.html` 每頁 50 筆 ⇒ 300 = 6 頁；300（清單）+ 3（counts）≈ **303 次
讀取／點一次**，佔每日 5 萬免費額度的 **0.6%**，站長一天點 100 次也只用掉 ~60%。
（v0.20 之前本來就是 `limit 300`，是那次「admin SDK 不吃 quota」的誤解把它拿掉的。）

⚠ 帶 `where('status')` 又要 `orderBy('updatedAt')` 需要複合索引 `{status,updatedAt}`，
而 `firestore.indexes.json` 只宣告了 `{status,createdAt}` ⇒ **依序退階**
`updatedAt → createdAt → 無排序`。退階**不會多花讀取**（缺索引是 `FAILED_PRECONDITION`，
在讀到任何文件之前就被拒絕），而退到「無排序」等於**依房號取樣**，畫面上一定要講出來。

#### 3b. 截斷怎麼標明（⭐ 行為端，不是字串存在）
`admin.html` 的 `renderRoomsTab` 多畫一列 `#firebase-rooms-notice`（**只有 Firebase 分頁有**）：
* 被截斷 → 「⚠ 只顯示最新 300 筆（此篩選共 4,992 筆），**這不是全部**。」
* 沒截斷 → 「✅ 這個篩選底下的 N 筆已全部顯示。」（正對照，不當狼來了）
* `orderedBy === '__name__'` → 「⚠ Firestore 缺複合索引，這 300 筆是**依房號取樣**、不是最新的那幾筆。」
* 右側一顆開關：「💬 訊息數：關（點我計算，每房各 1 次讀取）」

守衛用 **cheerio 對真的渲染出來的 HTML 做 DOM 斷言**（v6.154 教訓：22 條守衛全綠但分頁打不開）。

#### 3c. 逐房 `count()` 改成預設不算
`admin.html` 自 v0.3 起對 `messageCount === undefined` **本來就有退路**（畫成「💬 訊息」按鈕，
點進去才真的讀那一房的訊息，那支有 `limit(500)`）⇒ 關掉它不會有壞掉的畫面。
要看數字時按上面那顆開關，會重抓並帶 `?msgCounts=1`，而且**只對已經套過上限的那 ≤300 間房算**。

#### 3d. feedbacks 改快取（沿用 v1.19 `getUsersStatsCached`）
沿用的是 **「結果快取 ＋ single-flight ＋ 過期先回舊值背景刷新 ＋ 回應帶 `at` 讓畫面標資料時間」**
這一整套，連 TTL 都取同一個值 **5 分鐘**（`USERS_STATS_TTL_MS` 的先例）。
**查詢與欄位映射一字未動**，只是「什麼時候讀」改變。

⚠ 與 users 統計不同的一點：feedbacks **admin 自己會改**。所以
`PUT …/feedbacks/:id/reply` 與 `DELETE …/feedbacks/:id` 兩支都呼叫 `invalidateFeedbacksCache()`
—— 站長寫完回覆／刪完必須立刻看到，不能等 TTL。
⚠ `/api/admin/stats` 的 `total` / `new24h` **仍走 `count()`**（各 1 次讀取、永遠精確、算法一字未動），
只有需要 client-side filter 的「未回覆數」是快取值，畫面上標了資料時間。

### 4. ⭐⭐ 量化（spy 實測，不是推估；量測腳本＝新守衛的第 ⑪ 節，Rule 32）
fixture：5,000 間 Firebase 房（其中 4,992 間 ended）、137 則 feedback。
儀器依**官方計費規則**計數（查詢回幾份算幾次、最低 1；`count()` 每 1000 索引項 1 次、最低 1；
缺索引的查詢 0 次）。

| admin 動作（點一次） | 修前 | 修後 | 省下 |
|---|---|---|---|
| 🔥 Firebase 對戰「✅ 已結束」 | **9,991** | **307** | 96.9% |
| 🔥 Firebase 對戰「全部」 | **9,991** | **307** | 96.9% |
| 📊 總覽（feedback 段）第 1 次 | 139 | 139 | 0% |
| 📊 總覽（feedback 段）第 2 次起（5 分鐘內） | 139 | **2** | 98.6% |
| 💬 意見回饋 第 1 次 | 137 | 137 | 0% |
| 💬 意見回饋 第 2 次起（5 分鐘內） | 137 | **0** | 100% |

⚠ 修前那個 9,991 是 `2 × N`（N = 已結束房數），而 ended 房**永久保留** ⇒ 只會越長越大、無上界；
修後有硬上界 303。⚠ 這個 fixture 的 N 是我設的，**線上真正的 N 我量不到**（沒有正式站的
Firestore 存取）—— 但「無上界 vs 303」這個結論與 N 無關。

### 5. 不可破壞（逐項證明）
* **錦標賽逐位元未動**：從第一支 `/api/tournament` 端點到檔尾（241,958 字元）
  `sha256 = 34a8448b7de92a1f9a3a30c02c01ecd274409e1520fcc73fe5e92d6da47cc12c`，
  與 v6.271 相同（內嵌在守衛裡，淺複製下也在守；並附「多一個空白就不同」的自我驗證）。
  v6.269 既有的 clientdiag 區塊 sha `14011f93…` 也維持不變。
* **玩家端零改動**：`git ls-tree -r` 逐檔 blob 雜湊比對 `src/` + `static/`，
  只有 `src/lib/version.ts` 不同（守衛第 ⑩ 節；淺複製時 `shallowSkip`）。
* **不刪任何資料**：本版沒有新增任何 `delete` / `deleteMany` / TTL。
* **admin 數字不變**：三狀態 counts 仍是全量真值（守衛用 4 種查詢各驗一次）；
  未回覆數與修前算法逐一致（守衛自己算一遍當正對照）。

### 6. 守衛
`scripts/test-v6272-firestore-read-reduction.mjs`（**42 條**，已進 `package.json` 的 test chain）。
對真 BASE blob（v6.271）跑：**34 紅 / 8 綠**，紅的各自紅；
綠的那 8 條全部是「不變式」（counts 全量真值、錦標賽 sha256 ×2、玩家端零改動、版本、行尾、
以及兩條量測基準 —— 它們本來就是在量 BASE 的行為）。
突變測試 7 個（M1 拿掉 `.limit(_cap)`／M2 訊息數改成永遠算／M3 `truncated` 寫死 false／
M4 `matchedTotal` 謊報成清單長度／M5 TTL 改 0／M6 把提示從 `innerHTML` 拿掉／
M7 前端拿掉 `msgCounts` 參數），**全部紅在指定的那一條**，沒有 0 紅的。

⚠ 順帶修一支既有守衛：`scripts/test-v6219-admin-stats-users-cache.mjs` 把 `/api/admin/stats`
的 handler 抽出來實跑，而 handler 現在多依賴一個外層 helper `getFeedbacksCached`
⇒ 沒注入的話會 `ReferenceError`、被 handler 自己的 `try/catch` 吞掉、`feedback` 變成 `{ error }`，
`unreplied` 就成了 `undefined`（完整 `npm test` 第 542 步就是這樣抓到的）。
本版把它注入，**資料仍只有 `mkFirestore` 那一份 fixture ⇒ `unreplied` 的判準一字未改**，
並補一條新斷言：意見回饋的 `total` / `new24h` 每一發都要重打 `count()`（＝不可以連它們也被快取掉）。

完整 `npm test`：**602 步全綠**（分批跑；`test-v6170` 單支 90 秒、`test-v6237/6238` 各約 100 秒）。
`tsc --noEmit`：**TS2304 = 0**（只剩沙盒本來就有的兩個環境錯：缺 `.svelte-kit/tsconfig.json`、
repo 根目錄的 `write_v2306.cjs` 未終止 template literal，兩者在 BASE 上也一樣）。

### 7. 還沒做的（P2，留給下一版）
* Firebase 的休閒對戰本身（`src/lib/game/room.ts` 的 `onSnapshot`）是玩家端讀取的大宗，
  但**本版一個字都沒動**（Rule 30：不拿玩家做實驗）。要動之前得先量「玩家端一天到底幾次讀取」。
* `firestore.indexes.json` 沒有 `{status,updatedAt}` 複合索引。加了可以讓 status 篩選走最精確的
  排序，但那要站長跑 `firebase deploy --only firestore:indexes` ——
  **本版不加**（未部署的索引宣告只會讓人以為有），改成退階＋畫面誠實標示。

## v6.271 — 牌組編輯器左欄「我的牌組」太窄（桌機牌組名稱只看得到 2 個字）

BASE `9254f2ac8ddc6dfc51706b13fb386374b0000185`（v6.270，遠端 main）。本版只動 `/decks` 的 CSS。

### 0. 站長回報（逐字）
> 「使用 windows 網頁版時，牌組編輯器最左側的【我的牌組】區塊，太窄了，牌組的文字只能顯示幾個字而已，
> 這樣會使玩家根本無法從介面中直接看到牌組的名字，反而在手機版因為切成三個區塊，導致【我的牌組】的
> 區塊內容顯示，比網頁版還多。」

### 1. 量到的現況（不是估的：Chrome for Testing 152 headless，真的排版量出來）
量測方式：把 `src/routes/decks/+page.svelte` 的 `<style>` 區塊**原樣**抽出來，配上與 markup
逐一對應的 `<li>`（▲▼ 欄／`.deck-pick`／🔍／✕），用 `--window-size=W,900` 逐個寬度渲染，
讀 `.deck-name` 的 `clientWidth`，再用「同字型的探針元素二分」量它到底放得下幾個中文字。
腳本與 HTML 都在 `/tmp`（一次性），數字如下：

| 版面 | 視窗寬 | 左欄寬 | `.deck-name` 寬 | 可完整顯示的中文字 |
|---|---|---|---|---|
| v6.270 | 1920 / 1600 / 1440 / 1280 / 1024 | **220px（都一樣）** | 44px | **2** |
| v6.270 | 414 / 375 / 360（單欄） | 382 / 343 / 328 | 206 / 167 / 152 | 12 / 10 / 9 |
| v6.271 | 1920 / 1600 / 1440 / 1280 / 1024 | 260px | 137px | **16**（8 字 × 2 行） |
| v6.271 | 414 / 375 / 360 | 382 / 343 / 328 | 259 / 220 / 205 | 32 / 26 / 24 |

⭐ **桌機四種寬度數字完全一樣**，因為 `main { max-width: 1200px }` ＋ 第一軌是**固定 220px**
⇒ 視窗再寬，左欄一個像素都不會多拿。1920 下右邊有 720px 是空白。

### 2. 為什麼只有 2 個字（逐項拆帳，`.rail` 內寬 194px）
`.deck-list li` 是 `display:flex; gap:4px`，四個子項：

| 子項 | 寬度 | 出處 |
|---|---|---|
| `.deck-reorder-col`（▲▼） | 18px | `.deck-reorder-btn { min-width: 18px }`（v5.320） |
| `.deck-pick` | 剩下的 112.8px | `flex: 1` |
| `.deck-stats-btn`（🔍） | 25.6px | `button.icon { width: 1.6rem }`（**v6.267 新增**） |
| 刪除（✕） | 25.6px | 同上 |
| gap × 3 | 12px | |

`.deck-pick` 再扣自己的 `padding: 0.4rem 0.5rem`（8px×2）剩 96.8px，而它是**橫向** flex，
裡面還有 `flex-shrink: 0` 的 `.deck-size`（「60 / 60」實測 45.0px）＋ `gap: 0.5rem`
⇒ 名稱只剩 **43.8px**。`.deck-name` 是 `white-space: nowrap` 一行截斷，16px 字級 ⇒ **2 個字**。

### 3. ⭐ 手機版為什麼反而顯示比較多
`@media (max-width: 900px)` 把 `.layout` 改成單欄（`minmax(0, 1fr)`，v6.213 修的）
⇒ 左欄拿到**整個頁寬**（375px 裝置上是 343px），同一套扣法之後名稱還有 166.8px ＝ 10 個字。
**不是手機做了什麼，是桌機被 220px 綁死。** 全站只有這一份 CSS，`/decks` 沒有 `isMobile`／
`matchMedia`／`portrait` 任何分支（本版複驗過：`git grep` 於 BASE 上為 0 命中）。

### 4. ⭐⭐ 是不是 v6.267 的 🔍 造成的迴歸？——**是幫兇，不是元凶**
把 🔍 那顆按鈕從 markup 拿掉（＝v6.266 的列結構）重量一次：名稱 **73px ＝ 4 個字**。
⇒ v6.267 把 4 字砍成 2 字（少了 29px：按鈕 25.6 ＋ gap 4）。**確實是我們自己弄出來的一半**，
但即使完全沒有 🔍，4 個字本來也不能用 ⇒ 結構性原因是「固定 220px 的左欄」＋
「名稱和張數、三組按鈕全部擠在同一行」。⇒ 本版兩邊一起修，**不是把 🔍 拿掉**
（站長明確要留著 v6.267 的功能）。

### 5. 修法（四處 CSS，全部在 `src/routes/decks/+page.svelte` 的 `<style>`）
| # | 選擇器 | v6.270 | v6.271 | 為什麼 |
|---|---|---|---|---|
| A | `.layout` | `220px minmax(0,1fr) minmax(0,1fr)` | `260px …` | 左欄加寬 40px |
| B | `.deck-pick` | 橫向 flex、`gap:0.5rem`、`padding:0.4rem 0.5rem` | `flex-direction: column`／`align-items: stretch`／`gap:0.1rem`／`padding:0.35rem 0.5rem` | 名稱**獨佔一整列**，不再和「60 / 60」搶寬度 |
| C | `.deck-name` | `white-space: nowrap` 一行截斷、`flex: 1` | `-webkit-box` ＋ `-webkit-box-orient: vertical` ＋ `-webkit-line-clamp: 2` ＋ `white-space: normal` ＋ `overflow-wrap: anywhere` ＋ `line-height: 1.25` ＋ `flex: none` | 兩行截斷 |
| D | `.deck-size` | `0.8rem` | `0.75rem` ＋ `line-height: 1.15` | 移到第二列，縮字級補回列高 |

⚠ C 的四條缺任何一條，`-webkit-line-clamp` 都會**靜默失效**退回一行（守衛逐條各自斷言）。
⚠ B 若把 `align-items` 寫成 `flex-start`，名稱寬度會變成「內容寬」而不是「整個 pick 寬」，
  兩行截斷等於沒做 —— 守衛也單獨鎖了這一條。

**取捨（逐字說明）**：1200px 版面下中／右兩欄各從 458px → 438px，**各少 20px（4.4%）**。
牌組內容區與卡牌搜尋區的內部元素都沒有寫死的最小寬度（`.picker-list li` 是
`40px minmax(0,1fr) auto auto`、`.deck-header` 是 `1fr auto`），438px 下不會擠壞。
列高從 36.8px → 短名稱 46.6px／長名稱 66.6px（多一列張數、名稱最多兩行）——
這是「內容更完整」必然要付的縱向成本，站長要的正是這個。

**刻意不做的**：把 `main { max-width: 1200px }` 放寬。1920 下確實有 720px 空白，
放寬會一次改掉整頁的行長與卡片格線，超出本次回報範圍，風險不成比例。

### 6. 守衛
- 新增 `scripts/test-v6271-deck-rail-width.mjs`（40 條，已接進 `package.json` 的 test chain）。
  - 第 3 節是**幾何預算模型**：所有輸入（軌道寬、rail padding／border、li gap、pick padding／gap、
    ▲▼ 的 min-width、`button.icon` 的 width、line-clamp 行數）**都從當前 CSS 讀出來**，
    不是驗字串存在。模型必須**逐一重現 Chrome 實測的 6 個數字**
    （v6.270 桌機 2 字／375 10 字／414 12 字；v6.271 桌機 16／375 26／414 32），
    v6.266 沒有 🔍 的 4 字也算得出來。對照組 v6.270 的四個宣告值用**內嵌快照**寫死
    （歷史事實，不隨版本失效）⇒ 淺複製的 CI 照跑，不需要歷史 blob。
  - 對「當前」只斷言門檻與倍數（≥12 字、≥3 倍、手機三個寬度都不得變差），
    **不 pin 死 16 這個數字** —— 之後若有人再加寬，這支守衛不會誤紅（避開第九種安慰劑）。
  - `★★[模型前提] 每一列恰好 5 顆 button` —— 之後若有人再往列裡塞按鈕，模型會高估，
    這條會先紅並強迫重新推導。
- 更新 `scripts/test-v6213-mobile-deck-editor.mjs` 的桌機 CSS 指紋
  （`4a2669f933bf118e`／26776 → `26605e17e71776c4`／26937）。
  ⚠⚠ **更新指紋沒有讓鎖變鬆**，反而更緊：新增一節把 v6.271 的**四處逐字宣告編輯做反向還原**，
  還原後必須回到 v6.267 的指紋（26776）；原本的「拿掉 v6.267 那一段 → 回到 v6.212」那條鏈
  改接在**還原後**的字串上，整條鏈仍然成立 ⇒「桌機除了登記的這四處，一個宣告都沒動」
  仍然是逐字證明。且 `.layout` 那條從單一字串比對改成
  「①仍是三欄且第二、三軌仍是 `minmax(0,1fr)` ②第一軌只准更寬不准更窄（≥220px）
  ③本版等於 260px」三條 —— 比原本只比一個字串更嚴。

### 7. 不變量（本版逐一確認）
- Firestore 讀取次數**零變化**：本版沒有動 `<script>` 一個字元，
  `$effect(0)／onMount(1)／setInterval(0)／setTimeout(9)／fetch(2)／getDocs(0)／getDoc(0)／
  onSnapshot(0)／loadDecksFromCloud(3)／syncDeckToCloud(5)／removeDeckFromCloud(2)／
  fetchDeckStats(3)` 逐項與 v6.270 相同（守衛第 4 節以**上界**斷言鎖住，只准變少）。
- 玩家端效能：純 CSS，沒有新增節點、沒有新增監聽、沒有新增請求。
- `svelte/compiler` 警告數與 BASE **完全相同**：25 條，`css_unused_selector` 仍然只有
  原本就存在的 `.pk-mode-btn + .pk-mode-btn` 1 條（沒有多出選擇器對不上的情形）。
- 🔍（`openDeckStats`）／✕（`removeDeck`）／▲▼（`moveDeckUp`／`moveDeckDown`）
  markup 與 handler 逐字未動；🔍 仍然包在 `{#if !statsHidden}` 裡。

### 8. 突變測試（4 個，各自紅在預期那一條）
| # | 突變 | 預期紅的斷言 |
|---|---|---|
| M1 | 左欄改回 220px | v6271 第 1 節「比 220px 更寬」＋第 3 節門檻／倍數 ＋ v6213 指紋 |
| M2 | 拿掉 `.deck-pick` 的 `flex-direction: column` | v6271「改成直向」＋幾何模型門檻 |
| M3 | `.deck-name` 只拿掉 `-webkit-box-orient: vertical`（其餘三條都在） | v6271「`-webkit-box-orient: vertical`」單獨紅 |
| M4 | `.deck-pick` 的 `align-items` 改成 `flex-start` | v6271「align-items 是 stretch」單獨紅 |
| M5 | 在 `@media (max-width: 600px)` 補一條把 `.deck-name` 蓋回 `white-space: nowrap` | v6271「沒有任何 @media 蓋回去」 |

## v6.270 — 休閒 PUT 上行增量【階段 2：client 端】＋ bodyBytes 診斷 ＋ dump 補 phantom 欄位

BASE `d9f9b4351b5642095d59d7a2db9037064989855a`（v6.269，遠端 main）。
伺服器端 v6.268 已上線並確認 `hoisted=true enabled=true`；本版只做 client。

### 0. v6.268 協定的複驗（自己讀碼，不是轉述）
- middleware 只攔 `PUT ^/api/rooms/[^/]+$` 且 body 帶 `patchProto`；`/api/tournament/*` 原樣通過 ✅
- ⚠ **轉述誤差一處**：任務描述寫 `patch:{set,del}, logAppend`，實際 `logAppend` 在 **patch 裡面**
  （`patch:{set,del,logAppend}`，`_dpApplyPatch` 讀 `patch.logAppend`）。
- 三態、上限（set/del ≤256、logAppend ≤512、hash ≤1M 字元、深度 ≤32、路徑禁 `__proto__` 等）、
  哨兵 `deltaPut:1`、409 不回 room、email 剝除／回填 —— 全部與轉述一致 ✅
- 路徑**最多兩層**（top 或 `gameState.sub`）——這一點決定了實際省幅（見下）。

### 1. client 端（`oracle-client.ts` 的 `v6270-delta-put-client-core` 區塊）
- 哨兵：`oracleGetRoom`／`oracleGetRoomDelta` 在回應是 `{room}` 形狀時記下 `deltaPut === 1`
  （**以最近一次 GET 為準**；404/204/列表不動旗標）。零額外請求。
- `oracleTx` 語義逐字不變：每輪仍是「GET 最新 → fn → PUT」；只在 fn **之前**多一個
  `deltaPutBase(room)` 快照（哨兵缺席／熔斷回 null 且**不做任何複製**），PUT 改走
  `oracleUpsertRoomDelta`（base 為 null 時**直接 delegate 給 oracleUpsertRoom** ⇒ 與 BASE 逐字同請求）。
  409 → 既有 conflict 重試 ⇒ 下一輪重 GET 重 diff。
- diff：兩層欄位＋`gameState.log` 前綴相同只送 `logAppend`；deep-equal（鍵序無關）。
- fullHash 對 `JSON.parse(JSON.stringify(newData))` 計算；canonical hash 與伺服器**逐字元同演算法**。
- 退全量四條路：①哨兵缺席／熔斷 ②diff 不可增量／超限／hash 過大 ③**patch > 全量 body 的 60%**
  ④送出後 422/400（當場改送全量、同一 attempt；**連續 3 次 ⇒ 本 session 熔斷**＋`casual-delta-fuse` 指紋；
  成功送達 patch 就歸零——「連 3 次」是連續不是累計；409 不計）。
- ⚠ oracleTx 內新識別字一律 `typeof === 'function'` 防衛：test-v6245/v6246 的抽取 harness 只注入
  四個既有識別字、test-v6265 的 CJS stub 也沒有這兩支 ⇒ 舊守衛**零改動**照樣綠（它們驗的正是全量路徑）。

### 2. ⭐ 實測省多少（`scripts/perf-v6270-delta-put-savings.mjs`，真引擎 AI 自對局 ＋ 真 middleware round-trip）
4 個預組配對、379 發推送、**端到端逐位元比對 379/379 全過**：
- BASE 上行：p50 32,852 / p90 54,325 / p99 63,009 bytes，合計 12.4MB
- 修後上行：p50 12,734 / p90 13,955 / p99 16,813 bytes，合計 4.6MB ⇒ **省 62.7%**（patch 318 / 全量 61）
- ⚠⚠ **誠實更正先前的估計**：階段 1 時預估「p50 30KB → 1.5KB、省 93~96%」**不成立**。
  真因：協定路徑最多兩層，而 `gameState.players`（雙方完整盤面的 tuple）是**單一子鍵**，
  幾乎每一步都變 ⇒ patch 的大宗就是整包 players（p50 約 12KB）。log 部分確實只剩 append。
  要再往下（例如 `gameState.players.0` 三層路徑）需要**改伺服器協定**，屬下一階段提案，本版不碰。
- client 端新增 CPU（快照＋round-trip＋diff＋hash＋序列化）：沙盒 p50 4.0ms / p99 8.0ms / max 11.8ms
  （守衛【G】在 CI 釘 p99 < 40ms 沙盒上限）；哨兵缺席時新增 CPU 為 **0**（守衛 E4 用 Proxy 陷阱證明連讀都不讀）。

### 3. bodyBytes 診斷（【2】）
- 量測點在 oracle-client（`_dpNoteBytes`）：**實送 body 的 UTF-8 位元組**，patch／full 各自 50 筆滾動窗。
  哨兵缺席（舊伺服器）時**完全不量**（不多做序列化）⇒ 舊路徑 CPU 與 BASE 相同、bodyBytes 為 null。
- payload：`push.bodyBytes = { patch:{n,p50,p95,max}|null, full:{…}|null }`（兩者分辨得出）；
  `delta`（拒收統計）只在 `casual-delta-fuse` 有值，其餘一律 null（沿用 claim/phantom 的「null 不是缺席」慣例）。
- `+page.svelte` 只加兩支小函式（`_casualDeltaDiag`／`_casualNoteDeltaFuse`）＋
  `_casualRecordPush` 內一行 typeof-防衛呼叫 ⇒ v6.261 守衛的六函式抽取 harness 零改動照常綠。
- 一般玩家 0 發／0 bytes：實測（守衛 F4 ＋ test-v6261-perf ① 全綠）。
- dump 端**零改動**接住 bodyBytes：casualSummary 的 list 本來就整包帶 `push` 物件。

### 4. dump 補 phantom 欄位（【3】）
`casualSummary()` 的 `out.list.push({...})` 原本把 client 有送、mongo 裡有的 `phantom` 整個丟掉
⇒ 補 `phantom: (o && o.phantom) || null`（won/readyMs/localSrv/incomingSrv）。**只補欄位**，
統計數字一個不動（守衛 H2 逐欄位驗）。第二條路徑的分析等下一份 dump 的資料到手再說。

### 5. 既有守衛的調整（逐條，全部是「過期 pin 前移」或「有記錄的合法放寬」）
- `test-v6154`：admin `MON_REASON_INFO` 補 `casual-delta-fuse` 白話說明（該守衛**強制**每個新指紋都要有）。
- `test-v6261-perf`：紅線係數 0.03 → **0.035**（payload 多兩個 null 欄位，實測 1287→1422 bytes；
  主紅線「佔該場總上行 < 0.1%」原封不動且實測最壞 0.079%）。
- `test-v6265`：F2 清單補第 5 個 reason；F4 的 `server_admin_patch.js` pin 從 v6.266 前移到 v6.269
  ——⚠ **發現該 pin 從 v6.268 起其實沒在守**（CI 淺複製、沙盒 git archive 都沒歷史，
  只有「有完整歷史的環境」才會跑到；本次在 /tmp 建了 git 物件庫才炸出來）；
  `oracle-client.ts` 改為「剝掉 v6.270 已知合法新增後仍須逐字等於 v6.264 blob」。
- `test-v6267`：Gc 的 room-oracle 比對前把 v6.270 的兩處改動**逐字剝回**（字面對不上照樣紅）。
- `test-v6264`：【F】的 BASE pin 前移到 v6.269（v6.267 已有一次同款前移；同樣只在有歷史的環境生效）。

### 6. 守衛 `scripts/test-v6270-delta-put-client.mjs`（43 條，已進 package.json test chain）
【A】行為端接線（真 room-oracle CJS 實跑 pushGameState 真的送出 patch）／【C】端到端 round-trip：
固定案例＋**fuzz 10,000 次**（client diff → 真 middleware 套用 → canonical hash 一致）／
【D】三態＋熔斷／【E】60%、上限、哨兵語義／【B】正對照 (a)~(e)（(a) 與 BASE 的**請求序列逐字比對**、
(c)(d) 內嵌 sha256 錨定 server_admin_patch.js／room.ts／firebase.ts，VERSION-gated、停用時明講）／
【F】bodyBytes＋指紋接線／【G】perf p99／【H】dump phantom／【I】突變 8 條**各自紅在預期斷言**／
【J】HEAD-FAIL 5 條各自紅（淺複製時 shallowSkip 並明講）。
⚠ 讀檔一律先把 CRLF 正規化成 LF（Windows checkout 的工作樹與 CI 的 LF 才不會互相假紅）。

### 7. 部署
- 伺服器端 v6.268 已上線 ⇒ 本版**沒有順序風險**；只動 client＋admin.html＋dump。
- 站長要跑：`redeploy-oracle.bat`（前端主站，VM nginx）＋ `update-admin-full.bat`（admin.html）。
  `dump-client-monitor.cjs` 照舊是 VM 上手動跑的腳本，不經 bat。
- 上線後看什麼：①下一份 dump 的【②-e】休閒批 `push.bodyBytes`（patch 與 full 的 p50 應分別落在
  約 13KB 與 30~48KB，patch 佔比越高越好）；②`casual-delta-fuse` 是否成批出現（偶發可忽略，
  成批＝兩端協定漂移要回頭查）；③`casual-slow-push` 的 p95 趨勢是否下降（分母校正後看）。
- kill switch：伺服器把 `_DELTA_PUT_ENABLED` 改 false 重佈 ⇒ 哨兵消失，全站 client 自動回全量（守衛 E3）。

## v6.269 — admin 📡 分頁加上「🎮 休閒對戰批」＋ dump 彙總段的重複計算修正

BASE `1f3a7baa69207c6a88fe42d8ca18d1f906578b56`（v6.268）。
站長交辦：「把休閒批加進 admin 的 📡 分頁」——v6.261 上線休閒診斷指紋時刻意沒做（怕動到既有
數字口徑），只做在 dump 的【②-e】區塊，站長每次要看得跑 `dump-monitor.bat`。

### 查證（本版第一件事：複驗「後端已備好 `?mode=casual`」這句話）
**部分成立，但不足以做出子表。** `server_admin_patch.js`：
- `const _wantCasual = String(req.query.mode || '') === 'casual';` 與
  `q.mode = _wantCasual ? 'casual' : { $ne: 'casual' };` 確實存在 ⇒ 入口有。
- ⚠ 但 `q` **只餵給 `rows`（`.limit(120)` 的明細）**。統計三塊全部寫死排除休閒：
  `const agg = _aggAll.filter(a => !isCasualReason(a._id))`（byReason）、
  `sampleRttRows` 的 `mode: { $ne: 'casual' }`、`rttRows` 的 `reason: 'slow-rtt'`。
  ⇒ 帶 `?mode=casual` 拿得到的休閒資料**只有 120 筆明細，沒有任何統計數字**。
⇒ 本版不是「換個 mode」，而是補一條**完全獨立**的伺服器路徑。

### 做了什麼
**① `oracle-admin/server_admin_patch.js`**
- 新增 `_buildCasualDiagReport(coll, since, hours)`（＋`_casualUaShort` / `_casualQuant`，
  兩支逐字對齊 dump 的 `uaShort` / `quant`，守衛會拿同一批 UA 對跑兩邊）。
- `/api/tournament/admin/clientdiag` 在 `q.mode = …` 之後加**一行早退**：
  `if (_wantCasual) return res.json(await _buildCasualDiagReport(TCDIAG, since, hours));`
  ⇒ 錦標賽那一整段（byReason／slowRtt／sample／rows）**逐位元未動**，守衛以內嵌
  sha256 `14011f93…50d2ec`（4848 字元）鎖住。
- ⚠⚠ 絕不可拖累錦標賽（pm2 fork_mode 單 instance）⇒ 三道：
  ①cursor 逐筆不 `toArray`；②每 200 筆走中央 `adminScanYield`（v6.242）；
  ③硬上限 `CASUAL_DIAG_SCAN_CAP = 5000`，超過回 `capped:true`（**不靜默截斷**）。
  實測（沙盒 5000 筆，正式 VM 約快 10 倍）：總耗時約 31 ms、讓路 25 次、
  阻塞 p50 1.1 ms / p99 3.8 ms / max 3.8 ms；拿掉讓路的突變體：讓路 **0 次**、max 阻塞 29~33 ms。
- 早退**排在 `isTournAdmin` gate 之後**（休閒明細含玩家 email，守衛斷言順序）。
- 回應帶哨兵 `casualApi: 1` ⇒ 畫面分得出「伺服器舊版」與「這段期間真的 0 筆」。
- ⚠ 沒有新端點、沒有新 collection、沒有新索引（沿用 `tournamentClientDiag` 與 7 天 TTL）。

**② `oracle-admin/admin.html`（📡 監控分頁）**
- `loadMonitor` 多打**第二發** `?mode=casual&hours=`（`_r[5]` → `cg = _ok(_r[5])`）。
  刻意分兩發而不是併進同一個回應：兩批母體不同，合在一起回會誘導人相加，
  而且錦標賽那份的內容必須逐位元不變。
- 新 `monCasualBlock(cg)`：容器 `#mon-casual` / `#mon-casual-body`，內容比照 dump 的【②-e】：
  合計筆數/人數/截斷、指紋次數表、上行 p50/p95 中位數與最差與單發最久與失敗累計、
  棄權宣告 granted/rejected/unknown、版本與平台分佈、最近 120 筆明細。
- ⚠⚠ **判讀警語印在畫面上**（不是只寫在註解）：①母體不同不可相加或比較
  ②只有已登入 email 帳號的休閒玩家會送 ③倖存者偏差（要 10 發成功推送才送得出指紋 ⇒
  上行完全爆掉的人看不見）④「對手棄權」是頻率下界不是上界。
- ⭐ `monCasualBlock(cg)` **寫在 `if/else` 之外、無條件呼叫**，而且是 🩺 那一框的**兄弟**
  不是巢狀 —— 塞進 `dg.byReason.length` 分支的話，錦標賽沒異常的那幾天休閒子表會整塊消失。
- MON_REASON_INFO 開頭那段「這三則預設不會出現在本分頁」的註解已更新（本版起會出現）。

**③ `oracle-admin/tournament/dump-client-monitor.cjs`（Fable 5 在 v6.262 發現的 bug）**
- 真因：`byReason` 的彙總段只濾 `isSampleReason`、**沒濾 `isCasualReason`**
  ⇒ `casual-slow-push` / `casual-forfeit-claim` / `casual-phantom-adopt` 同時落進
  【② 玩家端異常指紋】（錦標賽）與【②-e 休閒對戰批】＝**重複計算**。
- 修法：新增**單一出口** `splitAggRows(agg)`（三分流：anomaly / sample / casual，
  順序與 `splitDiagRows` 一致 —— 先判 casual，否則 `casual-perf-sample` 會混進健康對照組），
  `byReason` 與 `sampleAgg` 都改吃它，並 export 給守衛實跑。
- **變化量**（以 2026-08-30 那份 dump 的實際數字）：【②】少 3 列 / 少 90 次
  （`casual-slow-push` 50 ＋ `casual-forfeit-claim` 39 ＋ `casual-phantom-adopt` 1）。
  ⭐ 這是**修正不是退步**：那 90 次本來就已經在【②-e】算過一次。
  錦標賽那幾則的 `n` 與 `players` **逐項不變**（守衛用新舊兩份實作對跑證明）。
  ⚠ 【②】的「合計 N 筆」原本就走 `rows.length`（`splitDiagRows`，本來是對的）
  ⇒ v6.261~v6.268 那幾份 dump 的**逐列相加對不上合計**，只是沒有人會去加。
- 順手加自我對帳：`_sumN !== rows.length` 就印「⚠⚠ 對帳失敗」。

**④ `scripts/test-v6154-monitor-tab.mjs`**：抽取視窗 `2600 → 3400`
（本版在同一支 handler 內多了一行早退，那條 `catch` 被推到 offset 2705）。
⭐ 只放大視窗，**regex 與斷言一個字都沒改**；3400 仍遠小於整支 handler（約 5900 字元）。

### 守衛 `scripts/test-v6269-casual-monitor-tab.mjs`（46 條，已進 `package.json` 的 test chain）
- ⑤ 是 **DOM 層**（`cheerio`）：把 `loadMonitor` 抽出來實跑、斷言它寫進 `#tab-monitor`
  （而 admin.html 真的有那個容器）、`#mon-casual` 存在、`#mon-casual-body` **有被填入**
  且畫得出「合計 7 筆 / 6 人」「7.2 秒」「伺服器擋下 1 次」——
  v6.154 的教訓（22 條守衛全綠但分頁根本打不開）就是靠這一節擋。
- 突變 8 個，**全部紅在預期那一條**：M1 拿掉讓路（讓路 0 次）／M2 改成 `await null`／
  M3 拿掉 `.limit(CAP)`（掃 5500 筆）／M4 把失敗算進 p95（p95max 變 120000）／
  M5 用 `rows===0` 判舊伺服器／M6 把休閒子表搬進 else 分支（0 異常時整塊消失）／
  M7 彙總段回退成 v6.261 舊寫法／M8 錦標賽區塊動一個字元（sha256 翻紅）。
- HEAD-FAIL：對真 BASE blob 跑 **27 條各自紅**（PASS 19 / FAIL 27）。
- ⚠ 淺複製：④⑦ 的「與 BASE blob 逐字元比對」走中央 `base-blob.mjs` 的 `shallowSkip`
  （大聲宣告、不 fail-open）；同一件事另有**不需歷史**的判準在守
  （④＝內嵌 sha256；⑦＝新符號不得出現在 `src/`／`static/`、且玩家端不引用 `oracle-admin/`）。
  ⚠ ⑦ 的逐檔 blob 比對只在 `VERSION === '6.269'` 時生效（下一版一定會動 `src/`），
  停用時會明講，不是靜默 return。
- `test-v6263` 已把本守衛列管，並在**無 git 環境**實跑證明條數不變。

### 玩家端零改動
`src/` 只動 `version.ts`（守衛以 `git ls-tree` 逐檔 blob 雜湊比對證明）；
`oracle-admin/` 不在玩家 bundle 的建置範圍內（守衛以 grep 證明 `src/`／`static/` 完全不引用它）。

### 部署
本版**沒有** client 新欄位／server 要認的相依（休閒指紋的送出端 v6.261 起就沒動），
但 admin.html 與 server_admin_patch.js 都改了 ⇒ 站長要跑
`update-admin-full.bat` ＋ `redeploy-oracle.bat`（`update-tournament.bat` 也涵蓋這兩個檔）。
⚠ **先跑 `redeploy-oracle.bat`（server）再跑 `update-admin-full.bat`（admin 頁）** ——
順序反了的話 admin 頁會打到還沒有 `casualApi` 的舊伺服器，畫面會顯示「伺服器還是舊版」
（不會壞、也不會產生髒資料，只是白跑一趟）。
`dump-client-monitor.cjs` 是站長本機／VM 上手動跑的腳本，不經 bat。

## v6.268 — 休閒 PUT 上行增量【階段 1：伺服器端先行】

BASE `4ccfdff1c5ec485172397c9509200f12906e3646`（v6.267）。
站長已裁定「server 先上、觀察後再出 client」⇒ 本版玩家完全無感（client 還不會送 patch）。

### 查證（VM dump `put7743.txt`，server.js 行號）
- 寫入語義：`PUT /api/rooms/:code` 是 `findOneAndUpdate` ＋ `$set:{...data,_version,updatedAt}`
  （server.js:97-111）——**top-level 逐鍵覆寫**，不是 replaceOne；`data` 缺席的 top-level 鍵留在 DB。
- CAS：filter `{_id, _version: expectedVersion}`；沒中 → 409 `{conflict, currentVersion, room}`（:111-121）。
- 回應體：**PUT 有回 `room`（`returnDocument:'after'` 全量，含 gameState）**——v6.265 查不到的那一點這次釘住了。
- 長輪詢：核心**沒有 EventEmitter**；SSE `/stream` 端點是 500ms 輪 DB（:166-210），
  休閒 client 用 GET `?since=` → 204 輪詢 ⇒ 通知是 pull-based，middleware 零接觸。
- `express@^4.21.0`（dump 檔尾 dependencies）；`express.json()` 的 limit **dump 裡沒有，查不出**
  （不影響本版：delta body 必小於今日已能通過的全量 body）。

### 做了什麼（只動 `oracle-admin/server_admin_patch.js`）
- 新 `PTCG-DELTA-PUT-BLOCK`（v1.29），插在 `PTCG-ROOMS-OUT-BLOCK-END` 之後、錦標賽區塊之前；
  用 v1.11/v1.16/v1.17/v1.20 的既有手法 hoist 到第一個 route layer 之前（先於核心 PUT）。
- 收 `{patchProto:1, patch:{set,del,logAppend}, fullHash, expectedVersion}` →
  基底＝DB 現 doc 的 **client 視角**（JSON round-trip ＋ v1.20 同款 email 剝除）→ 套 patch →
  canonical hash（遞迴排序鍵＋FNV 雙 32bit，免疫 BSON 鍵序）複驗 → email 回填（同 uid 才回填）→
  `req.body = {data, expectedVersion}` 交給既有核心 PUT。**落庫仍是全量、CAS／回應全不動。**
- 三態：版本不符→409（不回 room，避開 email 外洩）；hash 不符／格式錯／停用／例外→422 `deltaReject`；
  正常→核心 PUT 既有回應。舊 client（沒帶 patchProto）逐位元原樣 `next()`。
- GET `/api/rooms/:code` 的 `{room}` 回應加哨兵 `deltaPut:1`＝kill switch：
  把 `_DELTA_PUT_ENABLED` 改 `false` 重佈（update-tournament.bat）→ 哨兵消失，全站自動回全量。
- 上限三道：set/del ≤256、logAppend ≤512、hash 工作量 ≤1M 字元、深度 ≤32；超限一律 deltaReject。
  路徑段禁 `__proto__`/`constructor`/`prototype`（prototype pollution gate）。

### 下一版（client 端 v6.269+）前置條件
- 哨兵判定：以**最近一次 GET** 的 `deltaPut:1` 決定下一發 PUT 可否送 patch。
- fullHash 必須對 `JSON.parse(JSON.stringify(newData))` 計算（與伺服器 JSON 視角一致）。
- 收到 422 `deltaReject`、或 400（patch 區塊被整個撤掉時核心 PUT 的 missing data）→ 改送全量；
  連 3 次 → 本 session 熔斷 ＋ `casual-` 前綴診斷指紋。409 帶 `deltaReason:'version'` → 重新 GET 再決定。

### 守衛 `scripts/test-v6268-delta-put-server.mjs`（進 package.json test chain）
正對照（舊 client body 逐位元不變／tournament 路徑原樣／落庫 doc 與全量路徑逐位元同形）、
round-trip（固定案例＋隨機突變 fuzz）、三態、perf p99、9 個突變各自翻紅、
錦標賽區塊內嵌 sha256（與 v6.265 逐位元相同）、HEAD-FAIL。

## v6.267 — 套牌戰績【client 端 P2】：`seats[].deckId` ＋ `/decks` 的 🔍

BASE `63104f4e4c6d8dfc03d04f64369d0cc6f727b4e8`（v6.266）。
v6.266 已把**伺服器端**三件事上線（`makePlayerDoc` 白名單收 `deckId`、`/api/match-result`
從房間 seat enrich、sparse 索引與 `GET /api/deck-stats`）。
⚠⚠ 但房間 `seats[]` 當時**根本沒有 `deckId` 這個欄位** ⇒ 那段 enrich 一直是空轉的。
這一版把它接上，並加上玩家看得到的放大鏡。

### 0. v6.266 的複驗（我自己讀碼，不是轉述）

| 交接說的 | 實測 | 判定 |
|---|---|---|
| 哨兵 `deckStatsApi: 1` | `server_admin_patch.js:2694` | ✅ |
| `tournament.status: 'not-collected'` | `:2708` | ✅ |
| `since: 'v6.266'`、`truncated` | `:2711` / `:2712` | ✅ |
| makePlayerDoc 白名單收 deckId「在 :1119」 | 實際在 **`:1112-1113`** | ✅（行號差 6 行） |
| enrich「在 :1160-1176」 | 實際在 **`:1165-1181`** | ✅（行號差 5 行） |
| sparse 索引 `{'p1.deckId':1}` / `{'p2.deckId':1}` | `:1000-1001`，都帶 `sparse: true` | ✅ |
| 房間 `seats[]` 沒有 `deckId` | `room-oracle.ts:275` 的 `setSeatDeck` 只寫 `deckEntries` | ✅ 確認空轉 |

⇒ 轉述沒有說錯，只有兩處行號偏 5~6 行。

### 1. `seats[].deckId` 怎麼寫

- `Seat` 加 **optional** 欄位 `deckId?: string | null`（舊房間沒有這個欄位也要讀得動）。
- `setSeatDeck(roomCode, deckEntries, deckId?)` —— **兩份 room 都改**
  （`room.ts` = Firestore = 測試站；`room-oracle.ts` = 正式站）。
  只改測試站測不到、只改正式站則測試站測不到，兩邊都要。
- `game/+page.svelte:8829` 的 `handleSetDeck` 手上就有 `deck.id` ⇒ 一起送。
- ⚠⚠ **座位被清空／換人坐時必須一起清掉 deckId**。這是這一版最危險的一條：
  漏了的話，新玩家坐上前一位玩家離開的座位，那一局會被記到**別人的牌組**上。
  兩份檔各 9 處「清空座位」的字面量全部補上 `deckId: null`（守衛 A3 用**實跑 takeSeat**
  證明兩個座位都被清乾淨，A4 用枚舉＋剝註解證明沒有漏網）。

⚠ **為什麼不在 `/api/match-result` 的 payload 裡也送一份**：
`$setOnInsert` 只有先送到的那一發會落地，而每個 client 只知道**自己**用哪一副牌
⇒ payload 路徑天生只能補一半；伺服器的房間 seat enrich 兩側都補得到。
兩條路併存＝同一件事有兩個來源、會漂移，所以**只留房間 seat 這一條**。

### 2. 本機雙人／vsAI：**不記**（結構性排除，不是靠過濾）

本機模式根本沒有房間（`roomCode` 為空）⇒ `/api/match-result` 的 enrich 區塊
`if (doc.roomCode && …)` 直接不進去 ⇒ 那些列連 `deckId` 欄位都不會有。
這比「記了再讓 `buildCasualCleanFilter` 濾掉」好：sparse 索引**不會**被永遠不會被查的列撐大。

### 3. Firestore 讀取次數：**零增加**（實測）

`room.ts` 的 `setSeatDeck` 本來就是 `getDoc` 1 發 ＋ `updateDoc` 1 發；
這一版只是在**已經要寫回去的** `newSeats` 物件裡多一個欄位。
守衛【E】把該函式抽出來實跑並計數：`getDoc=1 / getDocs=0 / onSnapshot=0 / updateDoc=1`，
並用 BASE blob 同法量測比對（正對照 b）。`updateDoc` 的**欄位集合**也逐字比對，
確認沒有多寫第二個欄位。

### 4. 放大鏡的哨兵 fail-open：怎麼做到「載入頁面不多打一發」

⭐ 關鍵是把判斷拆成**純函式**與**請求**兩件事，放進新檔 `src/lib/decks/deck-stats.ts`：

- `deckStatsHidden()` ——只讀 `VITE_ORACLE_API_URL` 與模組層級旗標，**不碰網路**。
  元件用 `let statsHidden = $state(deckStatsHidden())` 初始化 ⇒ 放大鏡**先顯示**。
- `fetchDeckStats(deckId)` ——只在玩家**點下去**時呼叫。
  回應沒有 `typeof body.deckStatsApi === 'number'` ⇒ 記住 `apiSupported = false`、
  當場在視窗裡說明，之後整顆放大鏡藏起來，而且 `fetchDeckStats` 自己也會擋掉後續呼叫。
- ⚠⚠ **429 與網路錯誤不可以被判成「不支援」**：429 代表伺服器明明支援、只是這一刻太頻繁；
  網路錯誤是玩家自己斷線。誤判會把功能永久藏掉（突變 H5 專門釘這一條）。
- ⚠ 旗標放**模組層級**、刻意不用 localStorage：伺服器修好後玩家重整就會回來，
  不必清快取；而路由切換（decks → 首頁 → decks）之間仍記得住。
- ⚠ `VITE_ORACLE_API_URL` 為空的 build（＝GitHub Pages **測試站**）一律 hidden
  ⇒ **測試站看不到這個功能**，站長只能在正式站驗收（誠實寫在這裡）。

### 5. client 端快取／防連點

- per-deckId 60 秒快取（**刻意與伺服器的 60s TTL 同值**，再短只是白打一發）。
- in-flight map：同一副牌同時只會有一發在飛，連點 6 下只打 1 發（守衛 C8 實測）。

### 6. `/decks` 載入請求數：與 BASE 相同（量測）

守衛【D】把「載入區段」定義成 **onMount 整塊 ＋ 每一個 `$state(...)` 的初始化運算式**
（這一頁 `$effect` 為 0，D0 釘住），在其中枚舉網路呼叫點：

```
BASE ：loadAllSets×1  loadDecksFromCloud×1  loadIndex×1  onAuthStateChanged×1  signInAnonymously×1  syncDeckToCloud×1
修後 ：loadAllSets×1  loadDecksFromCloud×1  loadIndex×1  onAuthStateChanged×1  signInAnonymously×1  syncDeckToCloud×1
```

⇒ **逐字相同**。載入區段唯一的新增是 `deckStatsHidden()×1`，
而 C10 用「一被呼叫就丟 AssertionError 的 fetch」呼叫它 200 次，證明它零請求。

### 7. UI

- 位置：`/decks` 左欄每一副牌的 ✕ **左邊**（同一個 `<li>`）。
- ⭐ 複驗過 `/decks` 確實是**單一版面**（全檔 grep `isMobile` / `matchMedia` / `portrait` 皆 0，
  只有 CSS `@media`）⇒ 不做手機／桌機兩套分支，一個 modal ＋ 響應式 CSS。
- 內容：休閒（線上）勝率大字 ＋ 錦標賽欄顯示「累積中」＋ 對各原型的表格
  （勝率 ≥55% 綠、≤45% 紅）＋ 三條說明（自 v6.266 起計／只算線上休閒／紀錄跟著這副牌走），
  `truncated` 為真時多一條「目前只統計最近 N 場」。
- ⚠ 點背景關閉用的是一顆**透明按鈕**（不是在 div 上掛 onclick）
  ⇒ svelte compile 警告數與 BASE **完全相同**（decks 25→25、game 98→98），
  警告數才能繼續當「版面沒被改壞」的金絲雀（v6.237 的教訓）。

### 8. ⚠ 要請站長裁定的一件事（本版**沒有**處理）

房間的 `seats[]` 是整包下發給**雙方**的（`deckEntries` 本來就是，對戰要用）。
加上 `deckId` 之後，對手的瀏覽器也會拿到我的 `deckId`，理論上可以拿去查我這副牌的勝率。
- 外洩的只有**數字與原型名稱**（端點不回 email／暱稱／房號／牌表）。
- 對手本來就看得到我完整的 60 張牌。
- 但這與 v6.220「seats[].email 不再下發玩家端」是同一類問題。
⇒ 若站長認為要擋，做法是比照 v6.220：**伺服器端**在 rooms-out middleware 把
`seats[].deckId` 剝掉，並在 PUT 回填（少了回填會被 client 的整包寫回洗掉）。
那是伺服器改動，必須另開一版且 **server 先上**。

### 9. 守衛

`scripts/test-v6267-deck-stats-client.mjs`（**45 條**，已進 `package.json` 的 test chain）：
【0】掃描器自我驗證（含 stripComments 的正對照 —— 我自己在 JSDoc 裡寫的範例真的害 A4 誤報過一次）
【A】seats[].deckId 實跑　【B】handleSetDeck 實跑　【C】deck-stats 十條行為端
【D】載入請求數量測　【E】Firestore 讀取次數量測　【F】既有 CRUD
【G】HEAD-FAIL（對 BASE 9 條各自紅）＋ 正對照 (a)(b)(c)　【H】突變 9 條全紅。

⚠ `test-v6264` 的 `BASE_SHA` 已同步換成 v6.266 的 sha（不換的話 F1 會因為「首頁多了兩則」而紅）。

### 10. 順手修兩支既有守衛（跑完整 npm test 時被抓到）

**① `test-v6213` 的桌機 CSS 指紋鎖**（它自己的檔頭就寫「要刻意改桌機時，把新指紋填進來並在
commit 說明」）。這一版替 `/decks` 新增了套牌戰績 modal 的桌機樣式 ⇒ 指紋必然變。
⭐ 為了不讓「更新指紋」把鎖變弱，多加一條：**把 `.ds-backdrop` ~ `.ds-notes` 那一段整組拿掉之後，
必須逐字還原回 v6.212 的指紋**（`6ac52437ce962826` / 25315 字元）。
⇒ 「桌機只多了那一段、其餘一個宣告都沒動」仍然是逐字證明。

**② `test-v6265` 的兩處逐字比對已經過期，而且沒有人發現。**
- `F4` 把 `oracle-admin/server_admin_patch.js` 釘在 v6.264 的 blob，但 **v6.266 合法改過它**
  ⇒ 只要物件庫拿得到歷史就必紅。**CI 是 `fetch-depth: 1` 淺複製 ⇒ 一直靜默 `shallowSkip`**，
  所以從 v6.266 起這一條其實**沒有在守**（正是 v6.263 記錄的那種毛病，只是換一個位置復發）。
  ⇒ 改成「每個檔各自釘在**最後一次合法改動的那一版**」。
- `B2` 把**整份** `room.ts` 釘在 v6.264，但它要守的其實是「Firestore 版的 `startGame` 不可以
  被改壞」。整份比對會讓同一個檔案裡別的函式被合法改動（本版的 `seats[].deckId`）誤紅。
  ⇒ 收窄成只對 **`startGame` 那一段**逐字比對：範圍更準、強度不變（並補了抽取器的下限斷言）。

⚠ 這兩件事都不是「為了讓自己過關而放寬守衛」——①附了更嚴的還原對照，②把假綠改回真的在守。

### 11. 驗證輸出（沙盒實測）

- `test-v6267`：**45 PASS / 0 FAIL**（含 HEAD-FAIL 9 條各自紅、突變 9 條全紅）。
- svelte compile 警告數 vs BASE：`decks/+page.svelte` **25 → 25**、`game/+page.svelte` **98 → 98**
  （代碼分佈也逐項相同；`css_unused_selector` 維持 1／7）。
  ⭐ 這是靠「背景關閉改用透明按鈕」換來的：照既有 modal 那樣在 div 上掛 onclick 會多 4 條 a11y 警告。
- `tsc`：改前改後**同為 82 條既有錯誤**（全在 effects.ts／engine.ts，與本版無關），
  新增檔 `deck-stats.ts` 0 錯，`TS2304` 兩邊都是 **0**。
- 完整 `npm test`（597 步，分批跑）全綠；`anti-pattern-lint` 無違規。
- ⚠ **`vite build` 在沙盒跑不完**（超過 178 秒的呼叫上限）。已完成的部分：
  client 與 server 兩個 bundle 都已產出（＝兩份 `.svelte` 的 Svelte 編譯都過了），
  只差最後的 prerender／adapter；而 `src/routes/+layout.ts` 是 `ssr = false`
  ⇒ prerender 只輸出 HTML 殼、不會執行元件程式碼 ⇒ 那一步不可能因為本版的改動而失敗。
  即便如此，**綠燈仍以 GitHub Actions 的 `conclusion` 為準**。


## v6.266 — 套牌戰績【伺服器端 P1】：`deckId` 收取 ＋ sparse 索引 ＋ `GET /api/deck-stats`

BASE `cef06975e99502eb8eb20f26e07ac713267f41b3`（v6.265）。
⭐ 這一版**玩家看不到任何東西**（純伺服器端）⇒ 刻意不寫首頁 changelog。

### 0. 需求與硬約束

玩家許願（站長轉述）：牌組列表的 ✕ 旁邊加一個 🔍，看該套牌的休閒勝率／錦標賽勝率／
對不同牌組原型的勝率；而且「勝敗紀錄跟著套牌走，更新套牌仍維持原本勝率，按 ✕ 刪除才消失」。

站長硬約束：①**必須記在 Oracle 主機，不能記在 Firebase** ②**絕不可以拖累已經穩定的錦標賽伺服**。
站長裁定：休閒勝率口徑＝**只算線上對戰**（vsAI 與本機雙人不計入）；上線節奏＝**server 先上**。

### 1. ⭐ 「跟著檔案走」天然成立 —— 零遷移、零覆寫

`Deck.id` 早就是 client 端 `crypto.randomUUID()` 產的穩定 UUID（`src/lib/decks/storage.ts:65-80`），
`upsertDeck` 依 id 就地更新（`:47-56`）⇒ **編輯不換 id**；複製／匯入走 `newDeck()`＝新 UUID
⇒ 勝率天然不跟。既有牌組全部都已經有 id ⇒ **不需要任何遷移，也不會覆寫任何既有資料**。

### 2. 本版做的三件事（全部在 `oracle-admin/server_admin_patch.js`）

**① `makePlayerDoc` 白名單收 `deckId`**
- ⚠⚠ **沒送就一個位元都不動**：`const _did = sanitizeDeckId(p && p.deckId); if (_did) doc.deckId = _did;`
- ⚠ 絕不寫 `doc.deckId = null` —— 欄位**缺席**才是「舊列／本機對戰」的唯一表示法；
  寫成 null 會被 sparse 索引收進去（sparse 只跳過缺席，不跳過 null）。
- ⚠ `mrValidateRecord` **一個字都沒動**：新欄位格式壞掉絕不可以擋掉整場戰績。
- 淨化出口 `sanitizeDeckId` 定義在**所有 IIFE 之外** —— 兩個消費端分屬不同 closure
  （`makePlayerDoc` 在 `registerMatchRecords`、`/api/deck-stats` 在 `registerStatsEndpoints`），
  放進任何一個都會讓另一邊 ReferenceError（v0.94／v1.01 兩次線上事故）。
  字元集刻意涵蓋 `newDeck()` 的兩種 id：UUID 與 `randomUUID` 缺席時的 fallback `d_<b36>_<b36>`。

**② 房間 seat enrich（併進既有那一發 `findOne`）**
- ⚠⚠ **不能只靠 payload**：`/api/match-result` 是 `$setOnInsert` ⇒ 只有**先送到的那一發**會落地，
  而每個 client 只知道「自己」用了哪一副牌（對手的 deckId 在對手瀏覽器的 localStorage）
  ⇒ 只靠 payload，慢的那一側永遠缺 deckId、有一半的對局會是瘸的。
- 成本＝**零額外查詢**：v6.220 起 `seats[].email` 已不下發玩家端 ⇒ 線上 client 送來的
  `p1/p2.email` 一律是 null ⇒ 既有的 email 條件在線上路徑本來就恆真、那一發 `findOne`
  本來每場就會發；deckId 只是讓同一發多帶兩個小欄位回來（projection 加 `'seats.deckId': 1`）。
- ⚠ `seats[].deckId` 是 **client 下一版才會寫入**的欄位。本版補不到 ⇒ 什麼都不寫
  （守衛 C4 有行為端斷言）。**server 必須先上**：白名單會丟掉 client 送來的新欄位，
  順序反了 client 上了也收不到。

**③ 新端點 `GET /api/deck-stats?deckId=`**
- 免登入 ＋ per-IP 30/min 限流。理由：deckId 是猜不到的 UUID ＝ 它本身就是憑證；
  而牌組存在玩家 localStorage，**伺服器根本沒有「這副牌屬於誰」的對照**，
  要求登入也判斷不出誰有權看。
- 回傳：休閒勝率（只算線上）＋ 對各原型的勝率 ＋ 場次數 ＋ `truncated`／`scanned`。
- ⭐ 哨兵 `deckStatsApi: 1` —— 下一版 client 用 `typeof body.deckStatsApi === 'number'`
  判斷伺服器支不支援，缺席就把放大鏡整個藏起來（不要顯示一張全 0 的表騙玩家）。
- ⚠ 白名單建構：回應只有數字與**原型名稱字串**，對手的 email／暱稱／房號／牌表
  一個位元都不出去（守衛 D11）。
- ⚠ 放在 `registerStatsEndpoints` 這個 IIFE 內（＝註解裡的「registerDeckRules 區段」）：
  分類要用 `deckToSets`／`classifyDeck`／`TRULES`／`getCardNameMap`，它們都在這個作用域。
  抄第二份會讓同一副牌在 admin 統計與這裡被分到**不同原型**（`classifyDeck` 的註解已寫明）。

### 3. ⚠⚠ 兩個踩了會靜默壞掉的坑（都寫進註解與守衛了）

**(a) `buildCasualCleanFilter` 回傳的物件自己就帶一個 `$or`**（離開場那條規則）。
把 deckId 的 `$or` 直接塞進同一層會把它**整條覆蓋掉** ⇒ 休閒淨化規則靜默失效。
⇒ 一律用 `$and: [clean, { $or: [...] }]` 併。突變 M4 驗過。

**(b) 對手原型：`cardCounts` 物件 *不可以* 直接丟給 `archetypeNameOf`。**
它的第一行是 `if (!entries || !entries.length) return null` —— 那是為 `deckEntries` **陣列**寫的；
`matchRecords` 存的是 `cardCounts` **物件**，`.length` 恆為 `undefined`
⇒ **每一筆都回 null、整張表靜默全空**（不報錯、不 500，只是永遠沒有資料）。
⭐ 修法是「**轉形狀**」不是「抄一份分類邏輯」：先把 `{cardId: 張數}` 轉成 `[{cardId,count}]`
（`deckToSets` 兩種形狀都吃），再走 v6.229 的**中央** `archetypeNameOf`。突變 M5 驗過（vsArchetype 變 0 列）。

⚠ 我第一版真的抄了一份（自己寫 `deckToSets`＋`classifyDeck`），結果被**既有守衛**
`test-v6229-admin-archetype-parity.mjs` 的「突變 S1 單一錨點」當場抓到：
`if (!nameMap.size || !rules.length) return null;` 在全檔出現了 2 次 ⇒ 那支守衛的突變測試失效。
⇒ 教訓：新端點要用中央語義時，**呼叫它**，不要把它的條件式重打一遍。

### 4. ⚠⚠ 「絕不可拖累錦標賽」的四道防線（pm2 是 fork_mode 單 instance ⇒ 同一個 node 行程）

| # | 防線 | 為什麼 |
|---|---|---|
| a | 兩支 **sparse** 索引 `{p1.deckId:1}` `{p2.deckId:1}` | `matchRecords` 已 18.5 萬筆舊列**沒有**這個欄位；非 sparse 會把每一筆都以 null 鍵收進索引。sparse ⇒ **索引從 0 筆開始長** |
| b | **端點自驗索引存在，否則自我停用**（503，且不帶哨兵） | 無索引 ＝ 對 18.5 萬筆 COLLSCAN ＝ 上百 MB 的連續阻塞，絕不可以上線 |
| c | cursor 逐筆（不 `toArray`）＋ 每 200 筆走中央 `adminScanYield` | v6.242 的結論：**cursor 只解決記憶體、讓路才解決時間** |
| d | 硬上限 5000 筆 ＋ per-deckId 60s 快取 ＋ per-IP 限流 | 最後一道保險 |

索引比照 v6.240 的先例：**只在服務啟動時建一次**、不 `await`、`.catch()` 兜底；
實際建構跑在 **mongod 行程**，node 這端只是送一發命令 ⇒ 事件迴圈零阻塞。
`listIndexes` 成功結果快取 60s、失敗退避 10s（剛開機索引還在建時不要一次失敗就整天停用）。

**實測（守衛 E1，20 萬筆假資料，沙盒 CPU 約為正式 VM 的 10 倍慢）**：見 `scripts/test-v6266-deck-stats-server.mjs`
執行輸出（出貨碼 vs 突變 M1「拿掉讓路」的對照數字每次執行都會印出來）。

### 5. ⚠ 本版**沒有**做、以及刻意不做的

- **錦標賽勝率**：本版沒有資料來源。要收得到得先讓 `TREGS` 報名紀錄與 `tournamentArchives`
  的 `players[]` 也帶 deckId —— 那會動到**錦標賽的寫入路徑**（站長最在意的區塊）⇒ 另開一版。
  端點先回 `tournament.status = 'not-collected'`，讓 client 顯示「累積中」而不是 0 勝 0 敗。
- **既有牌組不做歷史回填**：回填只能靠「email ＋ 60 張完全吻合」的近似比對，**會誤配到別人的牌組**。
  ⇒ 誠實從上線起算，回應帶 `since: 'v6.266'`，UI 之後要明講「自 v6.266 起計」。
- **client 端 UI（放大鏡）留到下一版**（站長同意 server 先上、觀察後再出 client）。

### 6. 錦標賽零接觸的證明

守衛【F】用**內嵌 sha256**（history-free ⇒ CI 淺複製下照樣在守）證明：
從 `const TEVENTS = db.collection('tournamentEvents');` 到檔尾共 **218,193 個 UTF-16 code unit**
（＝218,164 個 code point；差 29 是區塊內 emoji 的 surrogate pair），
sha256 `54cd122681c99f050eadf22e7823159bc5f40ecbc88118f49e5de88cb683b196`，
與 v6.265 **逐位元相同**（含 TEVENTS／TREGS／TMATCH／TCHAT／TARCHIVE／TCHAMPS／scheduler／
`/state`／`/action`／判負／瑞士制全部在內）。
F2 是掃描器自驗（改一個字元 sha 必須變），F3 證明本版所有改動都落在該區塊**之前**，
F4 是行為端：把 deck-stats 跑起來，記錄它碰過哪些 collection ⇒ 只有 `matchRecords`。

### 6b. ⚠ 本版被**既有守衛**抓到三次（全部是「新增的東西掉進別人的掃描視窗」）

| # | 誰抓到 | 症狀 | 修法 |
|---|---|---|---|
| 1 | `test-v6229`（突變 S1 單一錨點） | 我抄了一份 `if (!nameMap.size \|\| !rules.length) return null;` ⇒ 全檔出現 2 次，那支守衛的突變測試失效 | 改成**呼叫**中央 `archetypeNameOf`（見 3(b)） |
| 2 | `test-v6119`（① 索引 best-effort） | 它掃「含 `createIndex` 的**行**」並要求每行都有 `catch` —— 我的**註解**裡寫了 `createIndex` 卻沒有 `catch` | 註解改寫成不出現裸 `createIndex` |
| 3 | `test-v6240`（前提＋⑥） | 它把「rooms 索引那一行 → `/api/admin/oracle/rooms` 註冊」之間整段當 pre 區段抽出來**執行**，並斷言「啟動時只建 1 條索引」；我把新索引插在那個視窗裡 ⇒ 長度爆掉、索引變 3 條 | 索引搬到 `matchRecords` 自己的區塊旁（`sanitizeDeckId` 上方），也更合理 |

⭐ 通則：**在既有大檔裡新增東西時，要先問「我這幾行會不會落進某支守衛的抽取視窗」**。
這三次都不是功能壞掉，但兩次會讓**別人的守衛靜默失效**（第 1、3 條），那比自己紅還危險。

### 7. 守衛

`scripts/test-v6266-deck-stats-server.mjs`（已進 `package.json` 的 test chain）。
【A】結構／HEAD-FAIL 5 條・【B】正對照（舊 payload 逐位元）＋ 突變 M3・
【C】seat enrich 行為 5 條（含 v6.220 既有 email 四案例）・【D】端點行為 12 條（含突變 M4/M5/M6/M7）・
【E】事件迴圈實測 ＋ 突變 M1・【F】錦標賽零接觸 4 條（含掃描器自驗）・【G】資料保全／版本・【H】HEAD-FAIL。

## v6.265 — 開局 CAS 競態：`startGame` 的 `won` 判定（練習模式「手牌無預警重洗」的真因）

BASE `3fd89b566d729ccddebb3014cdcb9d3cd4bd8fd5`（v6.264）。

### 0. 真因（Fable 5 診斷，本版**獨立複驗過**）

`src/lib/game/room-oracle.ts` 的 `oracleTx` 是一個**重試迴圈**：409（CAS 輸掉）或逾時
都會「重新 `oracleGetRoom` → 對**新**盤面重跑 closure → 再 PUT 一次」。
而 `startGame`（BASE L625~647）的 `let started = false` 寫在 **`oracleTx` 外面**、
且每個 attempt **不歸零**：

```
GET v5 null | PUT#1 → CONFLICT（房間已被寫成 game-B）| GET v6 game-B | PUT#2 → OK
⇒ startGame 回傳 won = true，但房間 canonical 是 game-B
```

`+page.svelte:8669` 的 `if (won) { game = _pendingGame; … }` 於是採用**自己的 phantom 局**，
幾秒後輪詢送來 canonical 局（不同 id）⇒ `resolveRoomUpdate` 第 2 條判 adopt
⇒ **手牌整份被換掉＝玩家回報的「無預警重洗」**。

⭐⭐⭐ **為什麼修很多次都沒好**：Firestore 版 `src/lib/game/room.ts:929` 用 `runTransaction`，
回傳值取自**最終那一輪 closure**，語意本來就是對的 ⇒ github.io 測試站（Firebase 後端）
**永遠重現不了**；只有 .com 正式站（`vite.config.js` 的 `oracleSwapPlugin` 換成 `room-oracle`）會發生。

⚠ 觸發前提＝「P1 的第一發 PUT 沒能在 6 秒內 commit」（`shouldAttemptStartGame` 給 P2 的
fallback grace），而那正是 v6.245 實錄過的族群（開局 48KB 上行實測 86.954 秒才送達）。

### 1. 修法：兩層，而且**結構性那一層才是主角**

新增中央 helper `oracleTxFlagged(roomCode, fn, opts)`（room-oracle.ts，緊接在 `oracleTx` 之後）：

- closure 的**第一個語句**就是 `marked = false`（每個 attempt 重判）
  ⇒ 回傳的 `marked` 恆等於「最後那一輪（＝真正寫進房間的那一輪）的結論」。
- `startGame` 在它之上再加一層**結構性複驗**：拿 `oracleTx` 回傳的**最終房間**問
  `room.gameState?.id === gameState.id`。
  這一層涵蓋 409／逾時／**「PUT 其實送達了只是回應逾時」**等所有路徑，
  不必逐條列舉失敗形狀 —— 逐條列舉正是這個 bug 反覆漏掉的原因。
  ⭐ 它還順手救回一條 BASE 也答不對的：我方 PUT 已送達、只是回應逾時 ⇒ 房間就是我這一局
  ⇒ `marked` 是 false，但結構性複驗判得出 `won = true`。
- ⚠ **fail-safe**：伺服器的 PUT `ok` 回應若沒把 `gameState` 帶回來（舊伺服器／回應被裁切），
  `finalId` 是 `undefined` ⇒ 退回 `marked`。**絕不可以**因為讀不到一個欄位就把建局整個關掉。
  （`/api/rooms/:code` 的 PUT route 不在本 repo，所以「回應一定含 gameState」是**假設不得成立**的前提。）

### 2. 同型缺口：全站枚舉結果 = **恰 4 處，全部收斂**

`git grep` 全 rev 掃過：`oracleTx` 只被 `src/lib/game/room-oracle.ts` 使用（其餘命中都是守衛與文件）。
以「closure 內賦值、但宣告在 closure 外」為判準掃 29 個呼叫點：

| 位置（BASE 行號） | 旗標 | 消費端 | 害處 |
|---|---|---|---|
| `startGame` L627 | `started` | `+page.svelte:8669` 用它決定**要不要採用本地盤面** | ⭐⭐⭐ 手牌重洗 |
| `checkAndAcceptRematch` L436 | `didReset` | 呼叫端 `.catch()` 之外**完全沒讀** | 低（潛在陷阱） |
| `checkAndAcceptRestart` L513 | `didReset` | 同上 | 低 |
| `checkAndAcceptReturnToRoom` L600 | `didReset` | 同上 | 低 |

四處**一律改走同一支 `oracleTxFlagged`**（不是三處各寫一套）。
守衛 `test-v6265` 的【C】把掃描器連同**正／反對照樣本**一起驗過：
「closure 第一行歸零」是唯一合格樣式，BASE 上恰好抓到 4 處、本版 0 處。

### 3. 新診斷指紋 `casual-phantom-adopt`（證偽工具）

沿用 v6.261 的休閒管線（同端點 `/clientdiag`、同一張 `tournamentClientDiag`、同 7 天 TTL）。
**伺服器端零改動**：分帳只看 reason 的 `casual-` 前綴（`server_admin_patch.js` 的 `isCasualReason`），
守衛把那支函式抽出來實跑證明它認得新指紋 ⇒ **本版不需要 server 先上**。

觸發條件（三條都要成立）：①本地已經有一局 ②採納的是**不同 id** 的局
③**不是**雙方同意的重新開局（`restartProposalCount` 遞增）。
帶 `won`（本頁 startGame 的判定）／`readyMs`（送出 startGame 時雙方就緒已多久）／兩局的 `createdAtSrv`。

⚠⚠ **一般玩家 0 發／0 bytes** —— 實測（守衛【D】【G】，抽真函式跑）：
同一局前進 200 次、盤面更新 1000 次、`_casualNotePhantomAdopt` 十萬次，**送出 0 發、0 bytes**，
十萬次總耗時 3.65 ms（每次 0.037 µs，純字串比較，沒有計時器／網路／序列化）。

⭐ 這是**證偽工具**：修對了的話它應該歸零。**沒歸零 ⇒ 還有第二條路徑。**

### 4. 順帶修：重整後多走一次 apply-undo（`lastSeenUndoApplyAt`）

`lastSeenUndoApplyAt` 原本**只在 apply-undo 分支**同步。重整後它是 0，而房間的
`lastUndoApplyAt` 可能是先前某次悔棋留下的大時戳 ⇒ 採納第一份盤面之後的**下一發**輪詢
會滿足 `resolveRoomUpdate` 第 3 條 ⇒ 走一次 apply-undo：繞過 stale 守衛，
並且把 `_unpushedState` 清成 `null` ⇒ **v6.212 的「本地領先先重推」自癒在重整後的第一手失效**。
（判斷是「玩家可見」才修：那正是保護慢連線玩家的機制。）

修法：`if (!game) lastSeenUndoApplyAt = Math.max(lastSeenUndoApplyAt, room.lastUndoApplyAt ?? 0)`
—— 語意上正確，因為 `pushUndoRollback` 是在**同一個 `oracleTx`** 裡寫 `gameState` 與
`lastUndoApplyAt`，帶著該時戳的盤面本來就已經是悔棋**之後**的盤面。
正對照（守衛 E3）：真正的悔棋（時戳再度變大）仍然走 apply-undo 並清掉作廢快照。
⚠ 一個字都沒有動 `resolveRoomUpdate`。

### 5. 不可破壞的事都用**實跑**證明（守衛 `scripts/test-v6265-phantom-start-race.mjs`，52 條）

| 保證 | 怎麼證 |
|---|---|
| HEAD-FAIL 409 | 對真 BASE blob 實跑 ⇒ `won=true` / 本版 `won=false`（A1/A2） |
| HEAD-FAIL 逾時 | 同上（A3/A4）；另加「伺服器沒回 gameState」的 fail-safe 路徑（A5） |
| (a) 真贏家仍是 true | B1／B1b／B1c 三種情境 |
| (b) Firestore 版不變 | `room.ts` 對 BASE **整份逐字元相同**（B2） |
| (c) 一般對局逐位元不變 | 七支 API 的請求序列與 BASE `deepStrictEqual`（B3/B4、perf①） |
| (d) 一般玩家 0 發／0 bytes | D1/D1b/D1c/D1d、G1（實跑計數） |
| 錦標賽零接觸 | F1~F5：`server_admin_patch.js`／`sync-guards.ts`／`oracle-client.ts`／`engine.ts` 對 BASE **逐字相同** |
| `resolveRoomUpdate` 未動 | F5（整份 `sync-guards.ts` 逐字比對） |
| 接線真的接上 | 【E】把 `handleRoomUpdate` 的盤面區塊**抽出來真的跑**（v6.154 教訓） |
| 突變 | 【I】10 個，**全部紅在指定那一條** |

### 5b. ⚠ 第一次 push 的 CI 紅燈（自己記一筆）

`24127c68` 的 build job 紅在 `test-v6265` 的 **C0** —— 而且**只在 CI 紅、本機全綠**。
原因：C0 原本拿「BASE 版本的 room-oracle.ts」去驗掃描器抓不抓得到那四處；
CI 是 `fetch-depth: 1` 淺複製 ⇒ 走 `revertToBase()` 的**等價突變版**，
而那支只還原了 `startGame` 的兩個機制、**沒有**把三支 `checkAndAccept*` 也改回舊寫法
⇒ 等價版上只剩 1 處違規，`=== 4` 的斷言必紅。

⇒ 修法（`d?????`）：把 C0 改成 **history-free 的內嵌樣本**（四個呼叫點的實際形狀直接寫進守衛），
真 BASE blob 的四處枚舉降級成 `C0-blob`，拿不到時走 `shallowSkip` 大聲跳過。
⚠ 教訓：**凡是「拿 BASE 當判準」的斷言，都要問一次「淺複製時我拿到的是什麼」** ——
等價突變版只等價於它刻意還原的那幾條，不等於整份 BASE。

### 6. 順手：`test-v6264` 的【F】改成每一版都適用

原本 F1/F2/F3 寫死 v6.263→v6.264 的一次性搬運（`e.ver === 'v6.264'`、封存頁恰 324 則、
首頁必須降到六成以下）⇒ **出下一版就必紅**。
改成版本無關的不變量：BASE 指向**上一版**、「首頁只多最新一則」「封存頁只多最舊一則」
「bodies 只多一則少一則、其餘逐字不變」（新增 F2b）、「單版增量 ≤ 2KB」。
⚠ 出新版時只要把 `BASE_SHA` 換成上一版的 sha。

## v6.264 — 首頁 changelog 的結構解：較舊條目的內文「展開才取得」

BASE `ff7ef443a7dd38e48cf0659d8f5e52fe1acf3806`（v6.263）。

### 0. 現況複驗（實測位元組，不是推論）

| | BASE(v6.263) | v6.264 |
|---|---|---|
| `static/changelog.html` | **61,436 bytes**（守衛上限 60KB = 61,440 ⇒ **只剩 4 bytes**） | **31,206 bytes（-49.2%）** |
| 其中 `log-body` 內文 | 40,729 bytes（66.3%） | 12 則 = 10,183 bytes |
| `static/changelog-bodies.html`（新） | — | 31,665 bytes（**不預快取**，展開才抓） |
| `static/changelog-archive.html` | 223,716 bytes / **324 則** | 224,817 bytes / **325 則** |

⚠ 交接時被告知封存頁是「325 則」，**實測 BASE 是 324 則**；v6.264 把 v6.196 搬進去之後才是 325 則。

### 1. 站長裁定與 N 的取法

站長：「首頁只載最新 N 則，其餘展開才拓」。取 **N = 12**：

- 位元組預算：`size(N) ≈ 19,264 + 843N`（50 則標題固定約 372B/則、內文平均 843B/則）。
  取 N=12 ⇒ 約 30KB，**回到 v6.100 當初的設計點（約 33KB）**，離 60KB 上限有一倍餘裕。
- ⭐**每版增量趨近 0**：出一版 = 進一則完整條目（約 +1,215B）－ 第 13 則的內文搬走（約 −843B）
  － 最舊一則的標題搬進封存（約 −372B）⇒ 淨值約 0。這才是真正的「結構解」：
  **不是把檔案改小一次，而是讓它不再單向長大**。
- 出版節奏實測（`git log`）約每天 8 版 ⇒ 前 12 則涵蓋最近約 1.5 天；50 則的**標題全部照舊直接顯示**，
  被延後的只有「展開才看得到的補充說明」。

### 2. 舊條目的內文為什麼用 fetch，不是導到封存頁

1. **封存頁裡根本沒有那 38 則**：封存頁依設計只放「已經被擠出首頁 50 則」的條目（BASE 最新是 v6.195），
   要改成導頁就得把 38 則複製過去 ⇒ 兩份會漂移。
2. **份量差 7 倍**：封存頁 224KB，專用的 bodies 片段 31KB。為了讀一段補充說明抓 224KB 不合理。
3. 「展開」的語意是留在原地；導頁會開新分頁、失去閱讀位置。

### 3. 檔案結構與**出版時的搬運順序（三步，順序不可亂）**

- `static/changelog.html`：50 則。前 12 則含 `<div class="log-body">`；
  第 13~50 則只留 `<summary>`，`<details>` 上帶 `data-ver="v6.xxx"`。
- `static/changelog-bodies.html`：**片段**（不是完整頁面），38 個 `<div class="log-body" data-ver="v6.xxx">`。
- 出新版時：
  1. 新條目（標題＋內文）寫進 `changelog.html` 最上面，並把前一則的 `<details open>` 改回 `<details>`；
  2. 把**第 13 則**的內文搬進 `changelog-bodies.html` 最上面，該則的 `<details>` 補上 `data-ver`；
  3. 把**第 50 則之後被擠出去的那一則**（標題＋內文合起來）搬進 `changelog-archive.html` 最上面。
- ⚠ 漏做任何一步，`test-v6264` 的 A4（雙向集合比對）會直接紅並印出差集與這三步。

### 4. Service Worker（本項最大風險，行為級實測）

`src/service-worker.ts` 的 `PRECACHE` 收 **`files` 全部**（static/ 底下）⇒
新加的 `changelog-bodies.html` **預設會被預快取**，那就等於把省下來的位元組原封不動搬回每位訪客的
install，白做一場。⇒ 加進 `HEAVY_MEDIA`（與 covers／music／changelog-archive 同一條路，「用到才快取」）。

`test-v6264` 的【D】把 SW 打包後**真的 dispatch install / fetch**，實測三種情境：

| 情境 | 結果 |
|---|---|
| 首次安裝 | install 不抓 `/changelog-bodies.html`；`/changelog.html` 仍照舊預快取（正對照） |
| 版本更新（新版 CACHE_NAME） | 同樣不抓 bodies ⇒ 每天出版都不會多這 31KB |
| 離線 | 抓過一次 ⇒ 走 `network-first` 已寫進 cache，離線讀得到；從未抓過 ⇒ 該請求失敗，由前端顯示可重試提示（不是白畫面） |

⚠ v6.222 的 `cache:'reload'` 只對 **prerendered HTML** 生效，bodies 是 `files` ⇒ 語義不變，
本版沒有動到那條路（D2 是正對照）。
⚠ 前端請求帶 `?v=${VERSION}` ⇒ 出新版時 URL 改變，不會吃到舊版 bodies。

### 5. 前端接線（`src/routes/+page.svelte` ＋ 新的 `src/lib/changelog-lazy.ts`）

- ⚠⚠ **`toggle` 事件不會冒泡** ⇒ 事件委派必須用**捕獲階段**（`addEventListener(..., true)`）。
  寫成 `false` 會完全沒有反應，而且不會有任何錯誤訊息。突變測試 E2 專門釘這一條。
- 監聽掛在 `<section class="changelog-section">`（用 `bind:this`），**不是** `.changelog-list` ——
  後者在 `{#if}` 裡，`{@html}` 重繪會換掉節點、監聽就掉了。
- 整份 bodies **只抓一次**（memoized promise）；失敗時把 promise 清掉，讓玩家再展開一次可重試。
- 已載入的那一則用 `data-body-state="done"` 早退：不重抓、不疊第二塊、**節點不換掉**
  （否則已讀過的條目每次展開都會再閃一次「補充說明載入中…」）。突變測試 E4 釘這一條。
- admin 後台 `changelogOverride` 的內容沒有 `data-ver` ⇒ 這套機制自動不生效，行為與 BASE 相同。

### 6. 既有守衛的調整：**只收緊，沒有放寬**（逐條）

| 守衛 | 改動 | 為什麼是收緊 |
|---|---|---|
| `test-changelog-size-and-archive` ② | `< 60KB` → **`< 40KB`** | `{x : x<40KB} ⊂ {x : x<60KB}`，舊門檻擋得下的新門檻一定也擋得下 |
| 同上 ②b（新增） | bodies 檔也 `< 40KB` | 新增條款，防「把成長換個地方繼續」 |
| 同上 ⑥⑬ | 黑名單改掃 `changelog.html + changelog-bodies.html` | 內文搬走後若只掃前者＝**被放寬**；改後掃描面積只增不減 |
| `test-changelog-render` markdown 檢查 | 同上，兩份一起掃 | 同上 |
| `test-changelog-html-classes-have-global-css` | `FILES` 加入 `changelog-bodies.html` | bodies 同樣是被 `{@html}` 注入的片段，吃首頁的 `:global` 樣式 |
| `test-v6223`「條目數 = 50」「恰一則 open」 | **完全未改** | 新結構仍是 50 則、1 則 open |
| `test-changelog-size-and-archive` ①⑦⑧⑨⑪⑫ | **完全未改** | 它們看的是 `<summary>` 的純文字，本版沒有動 summary |

### 7. 新守衛 `scripts/test-v6264-changelog-lazy-body.mjs`（36 PASS）

【0】掃描器自驗（⚠ 第一版踩到：V8 的 `String.split` 對「位置 0 的零寬比對」不會切出前導空字串，
盲目 `shift()` 會少算一則）／【A】結構不變量（history-free）／【B】lib 純函式真的執行／
【C】把 `+page.svelte` 的 handler 用 esbuild 轉成 JS **在自寫的最小 DOM 上真的跑**
（DOM stub 自己先驗過會分辨捕獲／冒泡）／【D】SW 三情境／【E】六個突變／
【F】對 BASE blob 逐字還原（淺複製時走 `shallowSkip` 大聲印出）。

**HEAD-FAIL：對 BASE 樹跑 = 21 條各自紅（不是單一 crash）、exit 1；修後 36 PASS / 0 FAIL。**
突變 6 個全部紅在指定的那一條。

### 8. 量測（Rule 32：附腳本）

`scripts/perf-v6264-changelog-bytes.mjs`：對同一棵樹量「首頁進站要下載的 changelog 位元組」
（含 gzip 後大小），BASE 對 HEAD。
⚠ Rule 36 提醒：**位元組減量不等於延遲減量**。這一版的主要價值是**結構性的**
（守衛上限只剩 4 bytes、下一版必爆），位元組只是副產品；不要拿它當「玩家會變快多少」的宣稱。

## v6.263 — CI 的淺複製盲點：8 支守衛在 `fetch-depth: 1` 下 SKIP 或**靜默掏空**

BASE `472ee5f97e7d5ca3e922bf9fa79cf04e4fa6b7fa`（v6.262）。
⚠ 這一版**完全沒有玩家端改動**（`src/` 只動 `version.ts` 的版本字串），首頁 changelog 不寫。

### 0. 現況（實測，不是推論）

`.github/workflows/deploy.yml` 的 build job 用 `actions/checkout@v4` **沒有 `with:`**
⇒ 走 action 預設 `fetch-depth: 1` 的淺複製。`iron-rules-audit.yml` 雖然 `fetch-depth: 2`，
但它 `continue-on-error: true`，**從來不擋 deploy** ⇒ 真正的保護只有 build job 的 `npm test`。

驗證方法：用 `git init` + `git fetch --depth=1 <BASE>` 造**真的**淺複製（不是「假裝拿不到 blob」
的模擬），與 `git clone -s`（完整物件）各跑一次全鏈。

| 守衛 | 淺複製行為 | 完整 clone | 淺複製 | 差 |
|---|---|---|---|---|
| `test-v6224-deck-import-timeout` | ⚠**靜默掏空**（:198 `catch { console.log(); return; }`） | 11 | 11 | **0（看不出來）** |
| `test-v6230-deck-export-timeout` | ⚠**靜默掏空**（:264 同上） | 14 | 14 | **0（看不出來）** |
| `test-v6233-damage-estimate` | 印 SKIP，整節不跑 | 62 | 60 | −2 |
| `test-v6234-resistance-label-and-coin-cap` | 印 SKIP ⇒ **唯一的 FAIL 被吞掉** | 57 PASS **/ 1 FAIL** | 52 / 0 | −5 |
| `test-v6236-estimate-hidden-composition` | 印 SKIP | 28 | 24 | −4 |
| `test-v6237-estimate-state-proxy` | 印 SKIP | 62 | 56 | −6 |
| `test-v6238-estimate-deferred-damage-and-magnifier` | 印 SKIP | 57 | 56 | −1 |
| `test-v6239-central-attack-formula-and-optin-estimate` | 印 SKIP | ⚠**crash exit 1** | 33 | — |

⭐ 第 9、10 支：`test-v6245` / `test-v6246` / `test-v6261` **也**讀歷史 sha，
但它們用「內嵌等價突變版 / 內嵌 sha256」當退路 ⇒ 淺複製下條數不變且仍然在守（做對的參照組）。
`test-bat-crlf` 讀的是 `ls-tree HEAD`，淺複製一樣拿得到。

⭐ 完整 clone 跑全鏈 591 支：**只有 2 支紅**（`test-v6234`、`test-v6239`），其餘全綠。

### 1. `test-v6234` 是真的紅 —— 但**是守衛過期，不是引擎壞掉**

它第 448 行的斷言是「把 v6.234 新增的 label 段回推成舊的一行後，`engine.ts` 與 BASE(v6.233)
**逐位元組相同**」＝ 凍結整份 `engine.ts`。v6.238 起 `composeAttackFormula` 搬成模組層級、
又新增 `attackDamageToDefActive` 等等，`engine.ts` 已從 634,236 長到 643,796 bytes ⇒ 必定 false。

複驗（自行重跑，不採信轉述）：把 v6.233 與 HEAD 的 `src/` 各自 esbuild 打包，
對 **3,862 張卡的每個招式 × 2 種防守方＝11,454 個樣本**跑 `applyAction`，
用同一顆確定性亂數種子比對「傷害數字／全場傷害指示物分佈／pendingSelection.effectKey」：

```
攻擊方卡數= 3862 樣本（卡×招式×2種防守方）= 11454
防守方 A=超級拉帝亞斯ex B=願增猿
相同 11454 / 不同 0（其中兩邊丟同樣例外 0）
```

正對照（Rule 33）：把 HEAD 的弱點 `×2` 改成 `×3` 後重跑同一支比對器 ⇒ **相同 10978 / 不同 476**。
⇒ 比對器不是恆真的安慰劑，引擎確實沒壞。

### 2. 修法

| 檔 | 做法 |
|---|---|
| **新** `scripts/lib/base-blob.mjs` | 中央 helper：`hasBaseCommit` / `readBaseBlob` / `shallowSkip`。跳過時印 `⚠⚠ SHALLOW-SKIP`，process 結束再印一次總結 |
| `test-v6224` / `test-v6230` | ⭐ **內嵌 BASE 行為快照**：B2 改成與內嵌快照逐分支 deep-equal（淺複製照跑）；新增 B2b 在拿得到歷史時重算驗證內嵌值。11→12、14→15，**兩種環境條數相同** |
| `test-v6234` | 刪掉過期的逐位元組凍結，改成同版本內的突變對照：換掉 label 字串 ⇒ 傷害仍是 70；拿掉抵抗力算式 ⇒ 傷害變 100。history-free |
| `test-v6236` | 把「HEAD 已不再是只反轉順序」這條**純 HEAD 檢查**移出歷史 gate（淺複製 24→25） |
| `test-v6239` | ⚠ 原本疊 BASE 的整份 `effects.ts` ⇒ 與新 `engine.ts` 連結不起來、完整 clone 直接 crash。改成拔掉中央 helper 那一行 `composeAttackFormula` 的突變＋正對照（33→36，兩種環境相同） |
| `test-v6233` / `test-v6237` / `test-v6238` | 純歷史性斷言（「BASE 當時長什麼樣」），內嵌只會變恆真安慰劑 ⇒ 維持跳過，但改走中央 helper 大聲印出來 |
| **新** `test-v6263-shallow-clone-ci-guards` | meta 守衛，33 條 |
| `test-v6175` | F 段掃描器的 `readdirSync` 加排序（棘輪數字不隨檔案系統浮動）。⚠ 在 BASE 實測 asc/desc/原生順序**都是 55**，無法重現先前「掛載磁碟 57」的說法 ⇒ 這次只是把它釘死，數字未變、門檻仍 `<= 55` |

### 3. `test-v6263` 守什麼

① 掃描器列管 test chain 裡所有「讀歷史」的腳本（下限斷言＋三條正／負對照）。
② 這些腳本不是走中央 helper 就是在**白名單**裡；白名單每一項都要在 ④ 被實跑背書。
③ 靜態偵測「catch 只印字就 return」的靜默掏空（附正／負對照）。
④ ⭐ **行為端**：把 `git` 換成必定失敗的 PATH shim，`v6224/v6230/v6245/v6246/v6261`
   的通過條數必須與真環境**完全相同**。
⑤ ⭐ **突變**：同一個 shim 下把 `server_admin_patch.js` 的回應訊息改壞 ⇒ 必須紅。
   （修前實測：淺複製＋同樣的突變 ⇒ `11 pass / 0 fail`，exit 0，**全綠**。）
⑥ 把 `deploy.yml` 的 `fetch-depth` 現況釘住，讓改動變成刻意的動作。

### 4. ⚠ 本版**不**改 `fetch-depth: 0` —— 分階段的理由

量測（本機 `file://` 協定，同一台沙盒）：

| | 物件庫 | fetch 時間 |
|---|---|---|
| `--depth=1` | 36 MB | 16.8 秒 |
| 完整 | 55 MB+ | > 120 秒（沙盒逾時，未跑完） |

`git count-objects -vH`：`size-pack 63.66 MiB`（GitHub 端是預打包，主要差在多下載約 20 MiB）。

⇒ 順序：**這一版先把守衛修對**（完整 clone 下 591 支全綠已驗），
**下一版**再加 `fetch-depth: 0`（那時才不會一開就擋 deploy），最後才談 fail-closed。
若現在就改，`test-v6234` / `test-v6239` 這兩顆紅燈會立刻擋住 deploy。

### 5. 待辦／要請站長裁示

- ⚠⚠ **首頁 `static/changelog.html` 已 61,436 bytes = 59.996 KB，門檻 `< 60KB`** ——
  下一則進去就爆。目前是 50 則、`<details>` 數量由 `test-v6223` 釘死 `=== 50`，
  搬進封存是 1 進 1 出，而新條目（約 1,600~1,700 B）比被擠掉的舊條目（約 750~850 B）大
  ⇒ 每版淨增約 800 B。三個選項：
  (a) 把則數從 50 降到 46（需同時改 `test-v6223` 的 `=== 50`，是規格調整不是放寬安全判準），
      約省 3.2 KB；
  (b) 給 `<div class="log-body">` 加**每則位元組上限**並把現有最長的 8~10 則修短
      （body 佔 40,729 B / 66%），約可省 5 KB；
  (c) ⭐ 結構解：首頁只載最新 N 則、其餘展開時才 fetch —— 一次解除耦合。
- `fetch-depth: 0`（見 §4）。

## v6.262 — 陳舊的鰭之化石｜鰭之守護：免疫**範圍**兩個方向都修（含 lint 兩個掃描器盲點）

BASE `12162345e9be92b4e38fe144c64659f6b2eab588`（v6.261，遠端 main）。

### 卡面逐字（唯一權威＝`static/cards`；⚠ 特性讀 `abilities[].effect`，不是 `rulesText`）

- 陳舊的鰭之化石（M3 `069/080`，J，Trainer/Item，`id=18046`，live 印刷**只有 1 張**）
  - `abilities[0]`＝特性「鰭之守護」的 `effect`：
    「對手從手牌使出支援者卡時，這隻寶可夢不會受到那個效果的影響。」
  - `rulesText`（另一段，**不含**「支援者」二字）：
    「這張卡可作為HP60的【無】屬性的【基礎】寶可夢放置於場上。這張卡不會陷入特殊狀態，無法撤退。\n
     若在自己的回合中，則可將場上的這張卡丟棄。」
  - ⚠⚠ `scripts/test-v6251-basic-on-field-followups.mjs` 舊註解寫「現行台灣卡面**沒有**那句／
    站內被動來自舊版卡面」——**那是錯的**，它只讀了 `rulesText`。本版已改成正面斷言特性逐字。

- ⭐⭐⭐ 站內四個「對支援者免疫」的來源，卡面**全部**逐字寫「對手**從手牌使出**」：
  鰭之守護／斧牙龍｜緊張感（10627）／浩大鯨ex｜融合為雪（12782）／超甲狂犀｜廣域堡壘（10947）。
  ⇒「從手牌使出」是共同前提，不是修飾語 ⇒ `source` 前提放在 `isImmuneToOppSupporter` **最外層**，
  不是只 gate 化石那一條。

### 行為端枚舉（live H/I/J 支援者 83 張 × 化石在備戰／戰鬥 × 3 種 picker 優先序＝498 次完整 `applyAction`）

修前動到化石的有 4 張，修後剩 2 張（皆為已裁定正確的 C-05 換位）：

| 卡 | 標 | 修前 | 修後 |
|---|---|---|---|
| 鏽蝕組手下 | J | ❌ 化石是唯一候選時能量仍被丟 | ✅ gate=false、候選不含化石 |
| 古歷 | J | ❌ 對手化石 `damage 30→0` | ✅ 不回血；自己的化石照回 |
| 老大的指令 | I | 戰鬥場化石被換下（候選不含它） | 不變（正確） |
| 琉琪亞的展示 | H | 同上 | 不變（正確） |

⚠ 我的第一版探測器**漏掉鏽蝕組手下**：第二段 picker（`active-energy-discard`）沒有 `validIids`，
若一律優先送「化石本體 iid」，能量永遠選不中 → 假 PASS。守衛因此改跑三種優先序取聯集（Rule 25）。

### 改了什麼

1. **新檔** `src/lib/game/supporter-effect-source.ts`（葉子模組，**零 import** 避免 TDZ）：
   `SupporterEffectSource = 'from-hand' | 'copied-effect'`、`getSupporterEffectSource()`、
   `runAsCopiedSupporterEffect(fn)`（`finally` 還原成**呼叫前**的值，支援巢狀）。
   ⚠⚠ 預設 `'from-hand'` ＝ **fail-closed**：任何忘了宣告的新路徑行為與 v6.261 完全相同。
   ⚠ 做成環境值而非必填參數，是因為消費點（候選過濾器）身處 resolver 深處、
   **拿不到「是誰在執行我」**；改必填只會讓每個呼叫端硬填 `'from-hand'`＝等於沒修。
2. `effects/cards/v3080_deferred_wave_c.ts` `isImmuneToOppSupporter` 加第 5 參 `source?`，
   首行 `if ((source ?? getSupporterEffectSource()) !== 'from-hand') return false;`。
3. 【1】`effects/cards/m5_preview.ts` 新增 `rustHenchmanIsCandidate`（比照 `creepyBroIsCandidate`），
   `regG` 與 `reg` 共用同一份候選述詞（兩邊漂移就是 v6.109 那類 bug）。
4. 【2】`effects/cards/v2370_mp_promo.ts` `healAllOnField` 加 `aIdx`/`pool`，**只**過濾對手側；
   `regG('古歷')` 同步扣掉對手側免疫者（判準①/Rule 26a）。
   ⚠ 依站長裁定**沒有**加「有利／不利」判斷（卡面沒有這個概念），守衛有反向斷言擋住。
5. 【3】`v2680_i_wave18_copy_attacks.ts:靈怪變化` 與 `v2760_h_wave3_complex.ts:相仿秀`
   的 `TRAINER_EFFECTS.get(...)(...)` 包進 `runAsCopiedSupporterEffect`。
6. ⭐ `effects.ts` 火箭隊的坂木是站內**唯一**在 resolver（跨一次 `applyAction`）才算免疫候選的
   消費點 —— 環境值那時早已還原 ⇒ `reg` 端把來源蓋進 `params.__suppSrc`，
   `regR('sakaki-self-swap')` 讀回來明確傳給述詞（缺欄位 fall back `'from-hand'`）。
   ⚠ 目前 live 走不到（兩張複製卡自己都不是「火箭隊的」寶可夢），是為將來的複製鏈先接好。
7. 【4】清理：`engine.ts` 刪 `isFinFossilSupporterImmune`（`git grep` 全 repo 零呼叫端）；
   `supporters_gust.ts` 刪內聯化石比對（它會**繞過**新的來源前提）；
   `test-v6251` 的錯誤註解改成正面逐字斷言。

### 【5】lint Check H — 修了**兩個**掃描器盲點，並把人工豁免換成結構化驗證

- 盲點①（交辦單指出的）：`H_MUT` 的「丟能量」只認賦值 `x.energyAttached =`，
  站內主流是不可變更新的**物件字面量** `{ ...c, energyAttached: newAttached }` ⇒ 整批沒被掃到。
- 盲點②（我自己查到的）：`mutatedIdx` 的 `updatePlayer(...)` regex 遇到**巢狀第一參數**
  `updatePlayer(addLog(state, '…', aIdx), dIdx, …)` 比不中 → 回 `null` → Check H/C 直接 `continue`。
  **【1】的那一行正是這個寫法**，所以就算只修盲點①也照樣抓不到（Rule 25.6/25.8）。
- 盲點③：resolver 有兩種寫法，`enclosingResolverKey` 只認 `regR(`，漏掉 `RESOLVERS.set(`。
- ⭐ 取代人工 `// opp-mut-ok:`：新增 **producer-gate 遞移查詢** —— 從 stage-2 的 `regR('<key>')`
  反查「誰 `withPending` 出這個 key」，去那個函式找 gate；producer 本身也是 resolver 就再往上一層
  （最多 5 跳；鏽蝕組手下是 3 層鏈）。**查不到 producer ⇒ 不豁免（fail-closed）**。
- ⚠⚠ 新樣式第一次照到 **11 個既有站點**（物品卡／招式效果那條線，與支援者免疫是**不同維度**）。
  刻意不在這一版逐一改判 ⇒ 列成**具名待審清單** `H_OBJLIT_PENDING`（不是隱形豁免），
  並配「死條目」斷言。**這 11 條需要站長另開一輪裁定**，見下方。
- 正對照：把 `m5_preview.ts` 還原成 BASE blob → lint 紅在
  `m5_preview.ts:1457 …'m5-trainer-rust-henchman-pick-energy' 的 stage-1 producer 也沒有 gate`；
  修後乾淨。下限斷言：`files≥60 / producerHits≥200 / producerKeys≥150 / hCandidates≥200`。

### 【6】永久守衛

- `scripts/test-v6262-fin-fossil-supporter-immunity.mjs`（**36 條**，已進 `package.json` test chain）
- `scripts/test-v6262-perf.mjs`（Rule 32；已進 test chain）
- ⚠ 白名單（老大的指令／琉琪亞的展示）**每條都有行為端證明**，不是文字理由：
  斷言 picker 的 `validIids` **不含**化石 iid（＝化石不是效果的目標、免疫確實生效），
  而化石之所以離開戰鬥場，是因為玩家指定的是對手備戰的**另一隻**（C-05 換位語意，
  `reference-c05-swap-target-immunity-v5995` ＋ `PTCG RULES/PTCG_RULES.md` §17.3.D）；
  另配「化石在備戰且是唯一備戰時 gate 必為 false」的反面對照。

### 驗證

- HEAD-FAIL（逐項各自紅）：還原 `m5_preview`→4 紅；`v2370_mp_promo`→4 紅；
  `v2680`+`v2760`→4 紅；`engine`+`supporters_gust`→7 紅；`v3080`→5 紅。全部還原後 36/36。
- 突變 7 個全紅且**紅在預期那一條**、零 CRASH（守衛的 `ok()` 走 `node:assert`，
  非 `AssertionError` 會標成 CRASH 以免把「程式炸了」誤當成「守衛抓到」）。
- 免疫網：`test-damage-immunity-matrix` / `test-attack-effect-immunity-matrix` /
  `test-selection-ui` / `test-gust-immunity` 全綠；
  `test-v6112-fossil-hp-bonuses`、`test-fossil-onfield-placed-bench`、`test-v6251`、
  `test-v6202`/`v6204`/`v6205`/`v6208`、`test-v6253`~`v6261`（含 `test-v6261-casual-clientdiag`
  50 PASS ⇒ 一般玩家仍 0 發／0 bytes）全綠。
- `test-ts2304-scan` 綠（掃 161 檔）；獨立 tsconfig 對 `src/lib` 跑 tsc：TS2304 = 0，
  總錯誤數 60 ＝ BASE 的 60（零新增）。
- 效能 BASE vs v6.262 並排（各 3 輪）：gate(含化石) 0.0058/0.0049/0.0067 → 0.0048/0.0066/0.0047 ms；
  gate(無化石) 0.0030/0.0019/0.0029 → 0.0022/0.0023/0.0025 ms；
  applyAction PLAY_TRAINER 0.0629/0.0730/0.0676 → 0.0630/0.0636/0.0603 ms ⇒ **無退化**
  （含化石那條略快：`supporters_gust` 少一次內聯 `pool.get()` + 卡名比對）。

### ⚠ 待站長裁定（本版**沒有**動，只是第一次被看見）

`H_OBJLIT_PENDING` 的 11 條：粉碎之錘 / 悠哉尾草棒 / 改造之錘（Item）、
盾甲龍與武士古蹟系的招式（`m5-bastiodon-shatter`、`m5-warlord-destroy-headbutt`）、
皮拿（G 標，不維護）、天星隊手下（G 標）、阻礙之翼、惡作劇塗鴉、毒粉蝶的招式，
以及**方向相反**的甲殼刺（防禦方反擊型特性，動的是攻擊方）。
問題是「這些動對手能量的路徑該不該過 `canApplyEffectToTarget`／化隱免疫」——
與本版的支援者免疫是兩件事，需要逐張讀卡面 + 行為端複驗後才改。


## v6.261 — 休閒對戰終於有診斷指紋（沿用既有 /clientdiag 管線，加 mode 維度）

BASE `28339fa46aea6d88b5df7ea7befa31358a57dd59`（v6.260）。

### 問題（複驗過的事實，不是轉述）

- `_tSendClientDiag`（`src/routes/game/+page.svelte`）**函式在 L6081、閘在 L6084**
  （交辦單寫「約 L5998」，位置差了 83 行；閘的內容則完全正確）：
  `if (!isTournament || isTournSpectator || !tActiveRoom) return;`
- ⇒ `tournamentClientDiag` 裡的**每一個數字**（`stale-version`／`setup-watchdog-repeat`／
  `manual-sync`／`stale-board-drop`／`slow-rtt`，以及 v6.213 的健康對照組 `perf-sample`
  與 v6.227 的 colo 分佈）**都只涵蓋錦標賽路徑**。
- 連量測本身也是：`_tRecordApiSegments` / `_tRecordSrvSample` / `_tRecordColoSample` /
  `_tRecordRtt` / `_tRecordAdopt` 開頭一律 `if (!isTournament ...) return;`，
  而休閒根本不走 `tApi`（走 `oracle-client.ts` 的 `oracleApi`）。
- ⇒ 休閒佔全站 94% 流量卻零指紋：「對手誤拿棄權勝」量不到頻率、v6.245~v6.249 的休閒
  同步修正沒有任何線上資料可驗成效、「線上休閒大廳偶發打不開」沒有分母。

### 設計：**共用同一條管線**，用 reason 前綴分帳（不另開第二套）

| | 錦標賽（v6.260 起未變） | 休閒（本版新增） |
|---|---|---|
| 觸發 | slow-rtt(p95≥3s)／stale-version／invisible-hand／setup-*／manual-sync／stale-board-drop | `casual-slow-push`（盤面推送 p95≥5s）／`casual-forfeit-claim`（按下「對手棄權」） |
| 取樣 | `perf-sample`：每場 10%（`PERF_SAMPLE_RATE`）、滿 20 發往返送 1 發 | `casual-perf-sample`：**共用同一個 `PERF_SAMPLE_RATE`**、滿 10 發推送送 1 發 |
| 上限 | 每頁 3 發（manual-sync／stale-board-drop／perf-sample 豁免） | 每場每種 1 發、**每頁硬上限 6 發** |
| payload | ~1.8KB（+svelteWarn 最多 2.3KB） | **實測 407 bytes**（守衛實跑量測） |
| 時機 | 異常當下／滿 N 發往返後 | 既有 `pushTracked()` 出口（fire-and-forget） |
| 端點 | `POST /api/tournament/clientdiag` | **同一支** |
| collection | `tournamentClientDiag`（TTL 7 天） | **同一張、同一個 TTL、不加索引** |

- **為什麼不是把錦標賽的 payload 直接套過來**：那 30 幾個欄位（`tVersion`／`tPollGen`／
  `srvActor`／`perf.api.*`）全是 `/action` 路徑的專屬狀態，休閒送出去會是一整包 null
  —— 比沒有資料更糟（看起來像「錦標賽也壞了」）。所以是**同一條管線、兩種 payload**。
- **送出點收斂**：新增 `_tPostClientDiag()`，`tApi('/clientdiag')` 全站仍然只有 2 處
  （v6.179 守衛釘的就是這個數字）。

### ⚠ 最高紅線：玩家端零額外負擔（實測，`scripts/test-v6261-perf.mjs`）

- **一般玩家（沒中籤、網路正常）：新增請求 0 發、新增上行 0 bytes** —— 修前修後逐字相同。
- 最壞情況（同時中籤＋每發推送都超過門檻＋還按了棄權宣告）：**一場 3 發、1,287 bytes**
  ＝該場總上行的 0.014%（長局）～0.071%（短局，1.7MB）。
- 同一個頁面連打 20 場（1,600 發推送）：**6 發、2,560 bytes**（per-page 硬上限擋住）。
- 熱路徑 CPU：`_casualRecordPush` 每發 **2.99 µs**（沙盒；正式 VM 更快），
  對照一發盤面推送本身 180~1000 ms ⇒ 佔 **0.0017%**。
- 量測對象＝**出貨碼本身**（從 `+page.svelte` 抽出來實跑），不是守衛另寫的等價實作（Rule 32）。

### 為什麼掛在 `pushTracked()`

v6.248 已經把**全站 5 個盤面推送呼叫點**收斂到 `pushTracked()` / `pushUndoTracked()`，
而且它們已經有 `PushMark.at` 這個時間戳 ⇒ 量測只是 `Date.now() - m.at` 一個減法：
**沒有新請求、沒有新計時器、沒有新的 await**。`finally` 裡還原標記仍排在遙測**前面**
（遙測自己另有 try/catch）⇒ v6.249 的在途保護一個字都沒動（守衛實跑驗過）。

### 指紋的判讀（寫給站長，admin 與 dump 兩邊同一段文字）

- `casual-slow-push`：休閒每個動作要 PUT 整包盤面（實測 40~48KB）。門檻 p95 ≥ **5 秒**
  ⇒ 有效上行低於約 10KB/s。取值依據（Rule 37）：線上實測最慢的**成功**推送是
  86.954 秒／48285 bytes ⇒ 5 秒遠低於它，中等程度的塞住也抓得到。
  這是 v6.245／v6.246「慢的是玩家上行」的**玩家端**實測值（在此之前只有 nginx 的
  408 與 `upstream=-` 這種伺服器端旁證）。
- `casual-forfeit-claim`：`claim.granted=false` ＝伺服器擋下來，代表**宣告者自己的畫面是舊的**、
  對手其實動過了。⚠⚠ 這是「對手誤拿棄權勝」的**頻率下界不是上界**：被誤判掉的那一方
  本來就卡住、送不出任何回報 ⇒ 永遠只看得到宣告者那一側。
- `casual-perf-sample`：健康對照組，回答「這一版有沒有讓休閒變慢」。

### ⚠⚠ 兩批數字**永遠不可以相加**（母體不同）

錦標賽走 `/action`（伺服器權威推進，一次往返＝一個動作）；休閒是 client-authoritative
（一個動作＝PUT 整包盤面，`oracleTx` 最多 5 輪 GET+PUT）——「一次往返」根本不是同一件事。

- 伺服器：`insertOne` 多寫 `mode`（由 reason 前綴推導，**不採信 client 送的欄位**）；
  `/api/tournament/admin/clientdiag` 預設 `q.mode = { $ne: 'casual' }`
  ——⭐ 用 `$ne` 而不是 `mode:'tournament'`，因為 **v6.260 以前的舊列根本沒有這個欄位**，
  `$ne` 才會把它們收進錦標賽批 ⇒ **既有的每一個數字逐字不變、可以跟舊 dump 對帳**。
  要看休閒批得明確帶 `?mode=casual`。`byReason` / `sampleAgg` 兩行 filter 一個字沒動
  （改的是它們的來源 `agg = _aggAll.filter(!isCasualReason)`）。
  `sampleRttRows` 補 `mode:{$ne:'casual'}`（`SAMPLE_REASONS` 新增了 `casual-perf-sample`，
  不補就會污染健康對照組）。
- dump：`splitDiagRows` 改**三分流**（⚠ 先判 casual 再判 sample，否則
  `casual-perf-sample` 會落進錦標賽的對照組）＋獨立的 `casualSummary()`；
  摘要新增【②-e 🎮 休閒對戰批】並明文寫「絕不可以跟【②】【②-d】相加」。
- admin：三則新指紋補上白話說明；⚠ 它們**預設不會顯示在 📡 分頁**（母體不同），
  說明文字裡直接寫明要用 dump 或 `?mode=casual`。

### 隱私

- payload **不含**任何玩家可辨識資料（無 email／暱稱／牌組／卡名；守衛用字串掃描把關）。
- `uid` / `email` 是**伺服器**自己寫進 doc 的（既有行為），讀取端 `/admin/clientdiag`
  有 `isTournAdmin` gate ⇒ admin only。玩家端沒有新增任何看得到的欄位。
- ⚠ 母體有一層自我限制：`tournIdentity` 只認 Firebase 的 email 帳號（匿名被明文拒絕）
  ⇒ **未登入的休閒玩家連送都不送**（送了也會被丟棄，那是白付一發請求）。
  判讀時要記得這一批的母體是「已登入的休閒玩家」，不是全部休閒玩家。

### 容量（⚠ 推估，不是實測 —— 沙盒連不到正式站 mongo）

以 v6.240 實測的 82,031 筆已結束 Oracle 房間推估每日 100~400 場：
每日約 30~120 筆、7 天 TTL 內約 210~840 筆（約 100~410KB）。
既有 `tournamentClientDiag` 約 5 千筆同量級 ⇒ **不加新索引**（`{ts:1}` 的 TTL 索引
已經覆蓋範圍掃描，量級是毫秒；加索引只換來寫入放大）。真的爆量就把
`CASUAL_SLOW_PUSH_P95_MS` 調高即可（單一常數，守衛會跟著讀）。

### 分階段（第一階段刻意只做這三種）

刻意**不做**的：休閒側的 colo／四段拆分／Resource Timing／longtask ——
那些量測全掛在 `tApi` 上，接到 `oracleApi` 等於動 v6.245~v6.249 剛修完的檔案。
第一階段先用「零接觸熱路徑」的方式拿到**分母**（每日幾場、上行 p95 分佈、棄權宣告頻率），
下一階段再依第一週的實際數字決定要不要往 `oracle-client.ts` 加量測。

### 驗證

- `scripts/test-v6261-casual-clientdiag.mjs`（50 條）＋ `scripts/test-v6261-perf.mjs`（19 條），
  兩支都進 `package.json` 的 test chain。
- **HEAD-FAIL**：對 BASE(v6.260) 的 `git archive` 樹實跑 ⇒ **43 FAIL / 7 PASS**，
  各項各自紅；那 7 條 PASS 全部是**正對照／保護性不變量**
  （錦標賽 payload 逐字未變、沒有新端點、沒有新 collection、沒有新索引、admin gate）。
- **正對照（錦標賽逐字不變）**：把 `const payload = {` 到送出點的整段抽出來，
  ①與 BASE blob **逐字元比對** ②比對 sha256 `6e5e7aff…`（CI 是 fetch-depth:1，
  兩條互為備援，**兩條都拿不到就直接紅**，不 fail-open）。
- 突變 7 個，全部紅在預期那一條：①休閒 reason 掉回錦標賽路徑 ②骰子改成每發都擲
  ③拿掉 per-page 上限 ④匿名也送 ⑤逾時也記進 p95 ⑥slow-push 每場送多發
  ⑦dump 三分流順序顛倒。**沒有任何一個 0 紅**。
- Svelte 編譯 warning：**98 vs BASE 98**（逐項相同：a11y 89／css_unused 7／其他 2）。
- `tsc --noEmit`：TS2304 **0 個**；其餘錯誤與 BASE 同一批（只動了 `version.ts` 的字串）。

### 一併更新的既有守衛（判準沒有放寬）

- `test-v6213`：`SAMPLE_REASONS` 的「兩邊逐字相同」原本寫死 `['perf-sample']`；
  改成**把伺服器那份字面量解析出來跟 dump 逐項比對**（比寫死更強），
  另加兩條：`perf-sample` 不可被換掉、`casual-perf-sample` 必須在清單內。
- `test-v6248`：`pushTracked` 的 `finally` 多了一行遙測 ⇒ 正規表示式改成
  「finally 的**第一件事**仍是 `_endPushTrack(m)`」；harness 補一個 `_casualRecordPush` no-op stub；
  ⚠ **突變6 的突變字串同步更新** —— 不更新的話那條突變根本改不到程式碼，會變成恆綠的安慰劑
  （原本的 `b.passed === false` 反向斷言正好把它抓出來了）。

### 部署

- `src/routes/game/+page.svelte` / `src/lib/version.ts` 有改 ⇒ **`redeploy-oracle.bat`**
- `oracle-admin/server_admin_patch.js` / `oracle-admin/admin.html` 有改 ⇒ **`update-admin-full.bat`**
  （⚠ 沒有動 `server-engine.cjs` 的 export，不需要 `update-tournament.bat`）
- `oracle-admin/tournament/dump-client-monitor.cjs`：站長要用時再 `scp` 到 VM 的 `/tmp`。
- ⚠ **首頁 changelog 沒有寫**：這是玩家看不到的內部遙測（玩家端行為零改變、
  一般玩家連一發額外請求都沒有），依規格不放首頁。

---

## v6.260 — 備戰 KO 的 on-KO／防 KO 缺口修補：isActive gate 下沉 ＋ 四條路徑接中央

BASE `e9157fe275d3a522c6547c097f2fead5a10d1e1f`（v6.259）。

### 複驗結論（對轉述的修正）

1. ✅ `fireDefenderOnKO` 開頭確有 `if (!isActive) return s0;`（潛者捕捉段之後）。
2. ✅ 最後鎖鏈（M2a 14775）／希望護身符（SV8 11278）卡面無「在戰鬥場」；
   沙之羽擊／光子纜線／炸裂針／沉重接力棒卡面皆有 ⇒ 對照組維持 active-only。
3. ⚠ **轉述的「5 條路徑」清單有誤**：
   - `dragapult-snipe`（放指示物）與 `applyDamageToAllOpp`（痛楚記憶/侵蝕之風/覆雪，
     全部「放置傷害指示物」）是**效果 KO**，卡面「受到…傷害而昏厥」不成立 ⇒ 本來就
     **不該**觸發，不必補呼叫。反而 `applyDamageToAllOpp` 以 koByAttackDamage=true 結算
     是**過度觸發 bug**（鬆口氣/豪華斗篷/珍珠在效果 KO 誤調獎賞、護身符誤開 picker）→ 已修。
   - 轉述漏了第 6 條真正的漏網：`olive-oil-distribute`（mega_decks.ts）連**戰鬥位** KO
     都沒呼叫 fireDefenderOnKO/preventKO。
4. ⚠⚠ **「需要 pending 佇列化」的前提不成立**：`pendingChainQueue`（v4.933）＋
   `stampPendingToken`（v6.175，token 對不上一律拒絕、發號機只前進）＋
   `PENDING_REFRESH_ON_POP`（v6.215，pop 時重算候選）早已在生產環境跑多年——
   「戰鬥場 KO 帶希望護身符的桃歹郎」本來就會連開 2 個 picker 排隊（實測 R9）。
   本版**零新增佇列機制**，只是多幾個呼叫端把 picker 排進既有佇列。

### 修法

- `fireDefenderOnKO`：移除 isActive 一刀切，改逐效果宣告（fail-closed）：
  `TOOL_ON_KO_BENCH_ALSO = {希望護身符}`（tools.ts）、
  `PASSIVE_ON_KO_BENCH_ALSO = {最後鎖鏈}`（effects.ts）；②③段 loc 改傳實際位置。
  ①段補 `koByAttackDamage` gate（效果 KO 不觸發道具）。
- `hitBenchAll`／`bench-hit-N`／`snipe-60-ex`／`olive-oil-distribute` 四條傷害 KO 路徑
  補 `applyPreventKOToVictim`（KO 判定前）＋ `fireDefenderOnKO`（sweep 後逐隻，快照
  `{...c, damage:newDmg}` 含能量/道具）。hitBenchAll/bench-hit-N 僅對手招式時觸發
  （自傷維持現狀）；寫回段改以最新 player 為基底（倖存鍛鍊器丟道具進 discard）。
- `applyDamageToAllOpp`：koPrizesAdjusted ×2 與 fireDefenderOnKO 改傳 koByAttackDamage=false。
- `koPrizesAdjusted` PASSIVE_PREVENT_PRIZE 的 loc 由硬寫 'active' 改實際位置偵測。
- olive-oil 的 KO 棄牌改 `getAllAttachedTools`（原漏 extraTools，v5.067/v6.136 同型）。

### 驗證

- `scripts/test-v6260-bench-ko-onko.mjs`（28 條，進 npm test chain）：HEAD-FAIL 15 條各自紅
  （A1~A10/B6/C2~C4/D4）、正對照 13 條 BASE 也綠；含端到端 applyAction token 流程、
  「恰好 1 次」log 計數、一次 KO 多隻、阻礙之塔、自傷、效果 KO 負對照、
  D1/D2/D3 宣告集合⟺卡面「在戰鬥場」雙向掃描（含下限與正對照）、
  D4 靜態「傷害 KO 路徑必接 fireDefenderOnKO」（括號配對抽取、下限 ≥10、D5 正對照）。
- 突變 7 個全部紅在預期（M1 gate 回捲/M2 沙之羽擊誤入/M3 刪 fire/M4 效果KO回捲/
  M5 刪 preventKO/M6 接力棒誤入/M7 ①段 gate 移除），0 個漏網。
- 逐位元正對照：BASE vs v6.260 於「戰鬥場 KO ×2、無 KO ×2」四場景 state 完全一致（剝 timestamp）。
- 效能（Rule 32，腳本 /tmp/f5v6260/perf.mjs＋scripts/test-v6260-perf.mjs）：
  hitBenchAll 無 KO 0.0715→0.0554ms（雜訊）、雙 KO 0.0104→0.0106ms、
  中央狙擊備戰 KO 0.0375→0.0427ms —— 皆微秒級，未 KO 路徑增量 0（全在 KO 分支內）。
- test-v6256 C3 守衛更新：applyPreventKOToVictim 呼叫端 3→7（effects 6＋mega_decks 1），
  每端 kind 必填檢查照舊。
- ai.ts／手機 UI 零改動：全部復用既有 effectKey（search-to-hand-reshuffle 等），AI 按
  pendingSelection.type 通用處理，戰鬥場 KO 同場景早已在跑。

### 待辦（本輪不做，留站長裁定）

- 快掃拳返（拖拖蚓ex，「受到傷害時」無「在戰鬥場」）：hitBenchAll／bench-hit-N／
  olive-oil 的**備戰受傷（未 KO）**未觸發 on-damaged（v5.980 只接了 dealAttackDamageToTarget）。
  屬 on-damaged 維度，改動點在迴圈內每隻受傷處，本輪不擴。
- 防 KO 家族之「自傷」：勤奮之心等卡面「受到招式的傷害」無「對手的」字樣，理論上
  自家地震打死自家滿血持有者也該防；本版僅對手招式觸發（維持既有），歧義請站長裁定。
- `applyDamageToAllOpp` 的 active KO 原本傳 recordOppKO(…,'attack',false) 正確，
  但 `_miracleActiveKO` 旗標宣告後永遠是 false（死碼，未動）。

## v6.259 — 「被 KO 時修改獎賞張數」中央收斂：`PASSIVE_KO_PRIZE_ADJUST`

BASE `f116910a7050e7fa660220f4f3bced7920203e95`（v6.258）。
站長回報：超級路卡利歐ex｜波動突刺 KO 願增猿ex 時「鬆口氣」沒有發動。

### 0. 複驗：轉述的診斷不成立，真因是「順序」

轉述說「走中央 `dealAttackDamageToTarget` 的 KO 不觸發 `PASSIVE_ON_KO`」——
**這句話是錯的**。`fireDefenderOnKO`（effects.ts:8279）第 ③ 段（8363~8371）本來就會
dispatch `PASSIVE_ON_KO`，`dealAttackDamageToTarget` 也確實在 8833 呼叫它。

真因是**兩條管線相對於 `addPendingPrize` 的順序相反**：

| 管線 | 順序 |
|---|---|
| `engine.ts` 主 ATTACK | `addPendingPrize`(6094) → `PASSIVE_ON_KO`(6137) |
| `effects.ts dealAttackDamageToTarget` | `fireDefenderOnKO`(8833) → `addPendingPrize`(8840) |

而「鬆口氣」舊實作（effects.ts:16714~16732）是 **claw-back**：
「從攻擊方**手牌最後一張**把剛拿的獎賞卡拿回來」——註解自己寫著
「PASSIVE_ON_KO 緊接 addPendingPrize 之後執行」。

BASE 實測（`scripts/repro_v6259.mjs`，完整 `applyAction` ATTACK→RESOLVE）：

| 情境 | BASE 結果 |
|---|---|
| 波動突刺（中央 helper）＋攻擊方手牌 3 張 | log 有出現，但**偷走一張真手牌**塞進獎賞堆（獎賞張數剛好對） |
| 波動突刺（中央 helper）＋攻擊方手牌 0 張 | **完全不發動**，獎賞 6→4（＝站長看到的症狀） |
| 超級勇氣（引擎主管線） | 正確：獎賞 6→5 |
| 備戰區的願增猿ex 被狙擊 KO | **不發動**（`fireDefenderOnKO` 開頭 `if (!isActive) return`） |

⚠ 「偷手牌」那條比「不發動」更嚴重：那張手牌變成獎賞卡，而且攻擊方已經在私訊 log
看過它 —— 等於多看了一張獎賞卡的內容。公平性問題，故首頁 changelog 只寫症狀不寫細節。

### 1. 卡面逐字（`static/cards`，只用台灣官方卡面）

| 註冊項 | 卡面 | 位置限定 | 原因限定 |
|---|---|---|---|
| 願增猿ex｜鬆口氣（SV6a 10619 / SV8a 11628） | 「這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，若自己的場上有「桃歹郎【ex】」，則被獲得的獎賞卡減少1張。」 | **無**「在戰鬥場」⇒ 備戰也算 | 招式傷害 |
| 桃歹郎｜最後鎖鏈（M2a 14775） | 「這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，從自己的牌庫任意選擇1張卡加入手牌。」 | **無**「在戰鬥場」 | 招式傷害 |
| 沙漠蜻蜓｜沙之羽擊（M-P-I 14432） | 「…與這隻寶可夢**在戰鬥場上**受到對手的招式的傷害而【昏厥】時…」 | 戰鬥場 | 招式傷害 |
| 密勒頓｜光子纜線（M5 19171 / M-P-J 19235） | 「這隻寶可夢**在戰鬥場上**受到對手的寶可夢招式的傷害而【昏厥】時…」 | 戰鬥場 | 招式傷害 |
| 沙鈴仙人掌｜炸裂針（SV9 12468，`PASSIVE_KO_RETALIATION`） | 「這隻寶可夢**在戰鬥場上**受到…而【昏厥】時…」 | 戰鬥場 | 招式傷害 |
| 沉重接力棒（SV5M 9907，`TOOL_ON_KO`） | 「…**在戰鬥場上**受到對手的寶可夢招式的傷害而【昏厥】時…」 | 戰鬥場 | 招式傷害 |
| 希望護身符（SV8 11278，`TOOL_ON_KO`） | 「附有這張卡的寶可夢受到對手的寶可夢招式的傷害而【昏厥】時…」 | **無**「在戰鬥場」 | 招式傷害 |

### 2. 修法：改成「獎賞張數修正子」（順序依賴從設計上消失）

- 新增 `PASSIVE_KO_PRIZE_ADJUST`（宣告式表）＋ `koVictimAbilityPrizeAdjust()`（單一入口）。
- 「鬆口氣」**移出** `PASSIVE_ON_KO`，改註冊到新表。
- 兩條「算獎賞張數」的管線各呼叫**一次**：
  - `effects.ts koPrizesAdjusted`（涵蓋 effects.ts 側 18 個 KO 路徑；在 `koByAttackDamage` gate 內）
  - `engine.ts` 主 ATTACK 的 inline 獎賞計算（`prizes` 加總）
- ⭐ **「恰好 1 次」是結構保證**：修正子只在「算張數」那一刻被讀一次，
  不像 hook 會被兩條路徑各跑一遍（對比 v6.120 的雙觸發事故）。

行為差異（相對 BASE）：

| 情境 | BASE | v6.259 |
|---|---|---|
| 主管線 KO 願增猿ex | 拿 2 張再退 1 張（**且退回去的那張已被看過、順序被打亂**） | 直接只拿 1 張 |
| 中央 helper KO（手牌 3） | 偷一張真手牌 | 只拿 1 張，手牌不動 |
| 中央 helper KO（手牌 0） | 不發動，拿 2 張 | 只拿 1 張 |
| 備戰的願增猿ex 被狙擊 KO | 不發動 | 依卡面發動 |
| 效果 KO／指示物 KO／中毒灼傷檢查 KO／沒有桃歹郎ex／特性被消除 | 不發動 | 不發動（不變） |

### 3. 未處理（下一輪；已查證但本版刻意不動）

`fireDefenderOnKO` 開頭有 `if (!isActive) return s0;`（effects.ts:8325），
而**桃歹郎｜最後鎖鏈**與**希望護身符**的卡面**沒有**「在戰鬥場」⇒ 備戰被狙擊 KO 時
依卡面應該發動，目前不會。另有 5 條備戰 KO 路徑（`hitBenchAll`／`bench-hit-N`／
`snipe-60-ex`／`applyDamageToAllOpp` 的 bench 段／`dragapult-snipe`）**根本沒呼叫**
`fireDefenderOnKO`。
⚠ 本版不動的理由：那兩個效果都會 `withPending` 開 picker，而 `hitBenchAll` 這類
一次 KO 多隻的路徑會連開多個 picker（互相覆蓋），屬於另一個維度的工程風險，
需要 pending 佇列化才安全。**要請站長裁示要不要開這一輪。**

### 4. 守衛

`scripts/test-v6259-ko-prize-adjust-central.mjs`（19 項，BASE 11 FAIL 且**各自紅**）：
- A1~A5 行為端：主管線／中央 helper／手牌 0 張／備戰 KO／一次 KO 兩隻，
  每條都斷言「鬆口氣 log **恰好** N 次」＋獎賞張數。
- B1~B7 依卡面**不該**觸發：效果 KO／放指示物／中毒檢查／無桃歹郎ex／特性被消除，
  ＋中央述詞單元測（`koByAttackDamage=false` ⇒ 0），＋一般寶可夢正對照。
- C1 兩張表名稱不得相交（防同一效果掛兩個 hook ⇒ v6.120 型雙觸發）。
- C2 下限斷言（表被清空就紅）。C3 每個 key 都要有 `static/cards` 卡面佐證且逐字含
  「獎賞卡」「昏厥」「傷害」。
- C4 **跨管線等價**：`PASSIVE_ON_KO` ∪ 新表的每個成員，兩條管線 KO 後攻擊方
  獎賞／手牌張數必須相同（＝這次 bug 的通用防線），且至少驗到 3 個成員。
- C5 源碼掃描：`PASSIVE_ON_KO` 區塊內不得出現 `prizes:` 寫入（附正對照）。
- C6 兩條管線都要呼叫中央述詞，engine 端恰好 1 次。

`scripts/test-v6259-perf.mjs`：KO 路徑 `applyAction` 中位數
**BASE 0.19860 → v6.259 0.19526 ms/attack**（同機同 fixture，N=3000×3）；
中央述詞命中 0.000666 ms/call、無特性早退 0.000165 ms/call。

突變測試 6 個，全部紅在預期那一條：
M1 engine 不加修正 → A1/C4；M2 `koPrizesAdjusted` 不加 → A2~A5/C4；
M3 拿掉 `koByAttackDamage` gate → B7；M4 拿掉特性有效性 gate → B5；
M5 拿掉桃歹郎ex 條件 → B4；M6 鬆口氣重複註冊進 `PASSIVE_ON_KO` → C1。
⚠ M3 第一次跑 **0 紅**（原本的 B1/B2 走的是呼叫端的外層 gate，測不到函式內層），
依紀律補了 B7 直呼中央述詞的單元測才測得到。

⚠ 動到 effects.ts / engine.ts ⇒ `update-tournament.bat` ＋ `redeploy-oracle.bat` 都要跑。

## v6.258 — `PASSIVE_ATTACK_BONUS`「主詞」維度：自指型被動必須 holder === attacker

BASE `e0c80a56cdd172a988a984ab93f79010123d6e46`（v6.257）。
來源：Fable 5 對 v6.257 的獨立審查（第三個真 bug；v6.257 的 lint 把它判進白名單放行了）。

### 0. 根因

`PASSIVE_ATTACK_BONUS` 的 dispatch 迴圈掃的是**攻擊方整個場**找「印著這個特性的卡」，
但加成套在 `attackerCard` 身上 —— **「誰是持有者」與「誰在攻擊」是兩件事**。
四個卡面主詞為「這隻寶可夢使用的招式」的自指型條目卻只用 `att.name === '卡名'` 當 gate：

| 位置（BASE 行號） | 特性 | 原 gate |
|---|---|---|
| `effects.ts:4200` | 複眼（電蜘蛛） | `att.name !== '電蜘蛛'` |
| `effects.ts:4241` | 大將（仆斬將軍） | `att.name !== '仆斬將軍'` |
| `effects.ts:4262` | 激動力量（飯匙蛇） | `att.name !== '飯匙蛇'` |
| `v2999_g3_wave1.ts:405` | 憤怒穴（棄世猴） | `att.name !== '棄世猴'` |

⇒ **同名不同印刷、其中一版沒印該特性**時，「沒特性的那版當攻擊者 ＋ 有特性的在備戰」照樣加成。

**BASE 實測（`scripts/repro_v6258.mjs`）**：

| 攻擊者（無該特性的印刷） | 備戰（有該特性） | BASE | 正確 |
|---|---|---|---|
| 仆斬將軍【MC 473/742・H】肘擊 40 | 仆斬將軍【M2a・I】大將 | **100** | 40 |
| 棄世猴【M5 039/081・J】幽靈打擊 100 | 棄世猴【SV10・I】憤怒穴 | **220（直接 KO）** | 100 |
| 電蜘蛛【SV11W・I】放電 50 | 電蜘蛛【SV6a・H】複眼 | **100** | 50 |

順帶：`憤怒穴` **不在** `PASSIVE_ATTACK_NO_STACK` ⇒ 場上兩隻 SV10 棄世猴時 BASE 加 **+240**。

⚠ v6.257 白名單的理由「沒印該特性的印刷根本不會呼叫到」是**錯的推論**：
dispatch 由 holder 的 abilities 驅動，加成落在 attacker 身上。複眼那條甚至沒被 lint 掃到
（視窗內剛好有 `abilities` 字樣，被 `VERIFY_TOKENS` 誤放行）。

### 1. 卡面主詞全表（`static/cards` `abilities[].effect` 逐字）

| 特性 | 卡 | 卡面主詞 | 分類 | 該不該疊加 |
|---|---|---|---|---|
| 大將 | 仆斬將軍 | 「**這隻寶可夢**使用的招式…」 | 自指 | 天然單一持有者 |
| 複眼 | 電蜘蛛 | 「**這隻寶可夢**使用的招式…」 | 自指 | 同上 |
| 憤怒穴 | 棄世猴 | 「若**這隻寶可夢**身上…則**這隻寶可夢**使用的招式…」 | 自指 | 同上 |
| 激動力量 | 飯匙蛇 | 「若自己的場上有…則**這隻寶可夢**使用的招式…」 | 自指 | 同上 |
| 輝煌聲援 | 竹蘭的羅絲雷朵 | 「只要這隻寶可夢在場上，**自己的**『竹蘭的寶可夢』…」 | 全場 | **疊加**（v5.725 通則） |
| 力之鹽 | 鹽石巨靈 | 「…**自己的**【鬥】寶可夢…」 | 全場 | 疊加 |
| 皇家聲援 | 君主蛇ex | 「…**自己的**寶可夢…」 | 全場 | 疊加 |
| 鈷藍指令 | 鐵頭殼ex | 「…**自己的**「未來」寶可夢（鐵頭殼ex 除外）…」 | 全場 | 疊加 |
| 原始心得 | 肋骨海龜 | 「…**自己的**寶可夢…對進化寶可夢…」 | 全場 | 疊加 |
| 大晴天 | 裙兒小姐 | 「…**自己的**【草】或【火】寶可夢…」 | 全場 | 疊加 |
| 勝利聲援 | 比克提尼 | 「…**自己的**【火】進化寶可夢…」 | 全場 | 疊加 |
| 大方 | 赫普的卡比獸 | 「…**自己的**「赫普的寶可夢」…**無論有多少隻…也不會重複**」 | 全場 | **不疊加**（NO_STACK） |

「該不該疊加」的分界＝**卡面主詞**：自指型天生只有一個持有者能過主詞閘（不存在疊加問題）；
全場型預設 per-holder 疊加（v5.725 通則），**只有卡面明文「不重複」才進 `PASSIVE_ATTACK_NO_STACK`**。
⇒ 與 `reference-passive-ability-stacking-per-holder` **不衝突**，兩件事正交。

### 2. 其他 `PASSIVE_*` map 有沒有同型錯誤 → **沒有**

`git grep '<MAP>.get(' e0c80a56` 逐一讀過每個 dispatch 迴圈的迭代對象：

| map | 迭代對象 | 主詞風險 |
|---|---|---|
| `PASSIVE_ATTACK_BONUS` | **攻擊方整個場**（active + bench） | ⚠ 唯一有風險者 → 本版修 |
| `PASSIVE_ATTACKER_BUFF` | `attackerCard.abilities`（攻擊者本人） | 無 |
| `PASSIVE_IMMUNITY` / `PASSIVE_COIN_AVOID` / `PASSIVE_DAMAGE_REDUCE(_COND/_BY_ATTACKER)` | 防守方**那一隻**的 abilities | 無 |
| `PASSIVE_PREVENT_KO` / `PASSIVE_PREVENT_PRIZE` / `PASSIVE_KO_RETALIATION` / `PASSIVE_ON_KO` | 被 KO／被打的**那一隻** | 無 |
| `PASSIVE_RETALIATION` / `PASSIVE_ON_DAMAGED` | 受傷的**那一隻** | 無 |
| `OPP_ENERGY_ATTACH_PASSIVE` | 對手整場，但**事件語意就是 per-holder**（v5.725 已治） | 無 |

### 3. 修法：中央收斂（不是三處各補 if）

`effects.ts`：
- 新增 `PASSIVE_ATTACK_SELF_SUBJECT`（宣告式主詞表，4 個自指型）。
- 新增 `collectPassiveAttackBonuses(state, attackerState, aIdx, attackerInst, attackerCard, defenderCard, pool)`
  ＝**唯一 dispatch**：監視塔【無】壓制 → ⭐主詞閘 → `isAbilityHolderEffective` → `NO_STACK` dedup。
- Map 型別加第 6 參數 `holderInst`；`憤怒穴` 改讀**持有者實體**的指示物（卡面主詞），
  未傳入時 fail-closed 回 0。
- 四個自指型條目移除 `att.name === '卡名'` 假 gate（改由中央閘保證）。

三個消費點改接同一份（原本三份手抄迴圈，v6.202 已因其中一份漏接特性消除閘吃過一次虧）：
`engine.ts` ATTACK 主管線 ／ `effects.ts applyAttackerActiveDamageBonuses` ／
`mega_decks.ts computeOliveOilBuff`。

⚠ 一併統一：engine 那份原本 gate 讀 `state`、fn 讀 `workingState`（兩份不同步），
現在一律用呼叫端傳進來的**當下工作狀態**（effects.ts 那份本來就是這樣）。

### 4. 守衛 `scripts/test-v6258-passive-attack-subject.mjs`（31 條）

- A 卡面逐字（4 自指 + 3 全場 + 三組印刷差異存在）
- B 誤加成必須消失（含「兩隻憤怒穴」與中央閘單元、holder≠state.active 的單元）
- C **正對照**：有印該特性的自己攻擊仍加成／全場型仍 per-holder 疊加／
  **裙兒小姐 SV11B（無大晴天）＋ 備戰 SVM ⇒ 仍 +20**（證明沒把全場型一起關掉）／大方仍不疊加
- D 三個消費點的**行為端**接線證明（少接一個就紅）
- L lint：主詞分類器（含正對照）／`PASSIVE_ATTACK_BONUS.get(` 全站唯一且在中央函式內／
  三個呼叫端清單／SELF_SUBJECT 無死條目
- W **v6.257 白名單每一條的行為端證明**（電氣球／大力鱷／鬆口氣／捲牆）

**HEAD-FAIL（對 BASE 樹跑）**：21 PASS / **9 FAIL**（B1 B2 B3 B4 B5 L1 L1b L2 L3 各自紅），
正對照 C/D/W 在 BASE 上全綠 ⇒ 不是「整片紅」。

**突變測試 7 個，全部紅在預期那一條**：
M1 拿掉主詞閘 → B1~B5；M2 誤把「大晴天」列入 SELF_SUBJECT → C6+L1+L1b；
M3 拿掉「複眼」→ B3+L1+L1b；M4 engine 消費點不接中央 → C/D/L3 共 10 條；
M5 憤怒穴改讀 `state.players[i].active` → B6；M6 mega_decks 再寫一份 `.get(` → L2；
M7 NO_STACK 拿掉「大方」→ C7。
（M5 第一輪 0 紅 ⇒ 依紀律**先假設守衛沒測到**，補了 B6 單元後才測得到。）

### 5. 既有守衛的下限調整（都是因為這次收斂，不是放水）

- `test-v6257` E2：`totalHits >= 20 → 15`（移除 3 個假自指卡名 gate，實測 20 → 17）。
  同時**刪掉兩條判錯的白名單**（棄世猴／仆斬將軍），並在其餘 4 條旁註記行為端證明在 test-v6258 的哪一條。
- `test-v6202` 20a：`sites.length >= 90 → 85`（三份 dispatch 收斂成一份，實測 90 → 88）。

### 6. 效能（Rule 32）

量測腳本 `scripts/perf_v6258_passive_dispatch.mjs`（可對任一棵樹重跑）＋
CI 守衛 `scripts/test-v6258-perf.mjs`（絕對上限）。
同機、同 fixture（攻擊方滿場 6 隻全帶被動加成特性）、N=4000×5 取中位數：

| | run1 | run2 |
|---|---|---|
| BASE e0c80a56 | 0.1825 ms/attack | 0.1843 ms/attack |
| v6.258 | **0.1771** | **0.1742** |

主詞閘排在 `if (!fn) continue` 之後 ⇒ 一般卡增量 0 次（早退，Rule 31）。
`collectPassiveAttackBonuses` 單獨計時 0.0033 ms/call。**無退化。**

### 7. 順帶查證 / 待辦（本版未動）

- **堅果啞鈴實為 4 筆**（v6.257 內部紀錄漏列 `13092`，同為 SV11W 064/086・I）。
  v6.257 的修法是 per-card 述詞 `cardPrintsAbility` ⇒ 已被覆蓋，無實害，僅枚舉表補正。
- `USE_HAND_DISCARD_ABILITY` 的 handler 是**死碼**（Map 自 v5.510 起是空的）—— 非 bug，待辦。
- **爆炸頭水牛兩張的 `abilities[].effect` 夾零寬字元**：實測**無害** ——
  站內對「捲牆」的判斷全部比對 `a.name`（`'捲牆'`，無零寬），沒有任何一處比對 `effect` 字串；
  `test-v6202` 20k 的零寬掃描器也是掃**特性名**。⇒ 不動 `static/cards`（改卡資料要校驗和、
  `index.json` 絕不可重生），列為資料清理待辦。
- ⚠ **新發現（本版未修，需站長裁示）**：走中央 `dealAttackDamageToTarget` 的延後／狙擊型招式
  （實測：超級路卡利歐ex｜波動突刺）造成的 KO **不會觸發 `PASSIVE_ON_KO`**
  （願增猿ex｜鬆口氣 的獎賞 -1 沒發動；engine 主管線的同一個 KO 則正常）。
  BASE 上就是這樣，**不是本版造成**。屬另一個維度（KO 觸發覆蓋），建議下一輪處理。

## v6.257 — 「同名不同印刷、卡面內容不同」維度：dispatch 必須確認這張印刷真的印著

BASE `de2113dfd360f58cad3a26bd82484369d2cfa7ff`（v6.256）。

### 0. 站長回報（逐字）

> 勒克貓 版本為 MC · 245/742 似乎有跟 M3 · 026/080 · J 版本一樣的特性 鬥志戰吼，
> 可以在登場的回合馬上進化，請你確認，是不是弄錯了？？
> 依據 MC · 245/742 版本的卡片內容，並沒有特性，只有招式為「咬緊」。

**回報成立。** `static/cards` 查證（live H/I/J，特性讀 `abilities[].effect`）：

| id | 檔案 | 卡號 | 標 | stage | abilities | attacks |
|---|---|---|---|---|---|---|
| 18003 | M3.json | 026/080 | J | Stage1 | `[{name:'鬥志戰吼', effect:'若對手的戰鬥寶可夢為「寶可夢【ex】」，則這隻寶可夢就算在自己的最初回合或者剛使出的回合，也可進化。'}]` | 劈哩啪啦 |
| 16716 | MC.json | 245/742 | H | Stage1 | `null` | 咬緊 |
| 10454 | SV6.json | 040/101 | H | Stage1 | `null` | 咬緊 |

三張都 `evolvesFrom='小貓怪'`、HP90、【雷】。倫琴貓只有 M3 `18004` 一版。

### 1. 根因（實際碼，不是註解）

`src/lib/game/engine.ts` 兩處，都只比對**卡名**、完全沒問 `abilities`：

- EVOLVE handler：`const hasFightingHowlEarly = baseCard.name === '勒克貓' && _oppIsExEarly;`
- UI 鏡射 `getEvolvableTargets`：`const hasFightingHowlBypass = fpCard.name === '勒克貓' && oppIsExUI;`

實測重現（BASE blob，完整 `applyAction`）：

```
MC 245/742 (無特性): UI可進化=[{"fromIid":"a1","toIids":["h1"]}] 實際進化=true
SV6 040/101 (無特性): UI可進化=[{"fromIid":"a1","toIids":["h1"]}] 實際進化=true
M3 026/080 (有鬥志戰吼): UI可進化=[{...}] 實際進化=true
```

同一族的另外兩項**早就修好了**：提升進化（v6.202）與刺激進化（v6.204）都已走
`hasEffectiveAbilityByInst`。鬥志戰吼是最後一個漏網。

### 2. 全站 audit：「同名不同印刷但卡面內容不同」兩個方向都掃

live H/I/J 共 4693 張、同名多印刷 1127 組。以**正規化空白＋剝零寬**後比對：

| 分類 | 組數 | 判定 |
|---|---|---|
| (甲) `abilities` **名稱集合**不一致 | 100 | 需逐一查 dispatch 是否用卡名 |
| (甲) `attacks` 名稱集合不一致 | 412 | dispatch key 含招式名 ⇒ 天然隔離 |
| (乙) 同名特性 `effect` 逐字不同 | 4 | **全是「ex」vs「【ex】」排版差異，語意相同 ⇒ 非 bug** |
| (乙) 同名招式 cost/damage/effect 不同 | 1 | 葉伊布｜嫩葉之恩「那張卡」vs「這些卡」措辭修訂 ⇒ 非 bug |
| (乙) 訓練家 `rulesText` 不同 | 3 | 泰姆（支援者通用規則文有無印）／滿充的體貼・超級信號（「超級進化【ex】」vs「超級進化寶可夢【ex】」）⇒ 非 bug |

⇒ **(乙)「給錯」方向：0 個真 bug。**

(甲) 方向再拆三條路徑逐一驗：

1. **主動特性 registry**（`getAbilityFn` 先查 `卡名|特性名`，miss 才 fallback `卡名|abIdx`）——
   行為端掃描：同名多印刷且**同一 index 特性名不同**的 (卡名,index) 共 **11 組**
   （叉字蝠／鴨嘴炎獸／樂天河童／白海獅／怖納噬草／岩殿居蟹／桃歹郎／斯魔茶／棄世猴／齒輪怪／肋骨海龜），
   **全部 `ABILITY_EFFECTS.has('卡名|index') === false`** ⇒ by-index fallback 撞不到 ⇒ 0 bug。
2. **PASSIVE_\* 系列**（`PASSIVE_ATTACK_BONUS` 等）key 是**特性名**，engine 迭代場上卡的
   `abilities` 才 dispatch ⇒ 沒印該特性的印刷根本不會呼叫到 ⇒ 0 bug。
3. **手刻 `card.name === 'X'` 的 passive / gate** —— 這條才是出事的地方。靜態掃描
   （100 個高風險卡名 × 全 src 的 `name === / !==` 相等比對）共 84 個命中，逐條讀實際碼後
   只有 **2 處**沒有伴隨「這張印刷真的印著該特性」的驗證：

| # | 位置 | 卡 | 症狀 |
|---|---|---|---|
| 甲-1 | `engine.ts` EVOLVE handler ＋ `getEvolvableTargets` | 勒克貓｜鬥志戰吼 | MC 245/742、SV6 040/101（無特性）也能剛使出／剛進化就再進化 |
| 甲-2 | `effects/_shared.ts` `triggerOakeyeMillIfApplicable` | 堅果啞鈴｜整人擊落 | SV11W 064/086、SV11W 145/086（`abilities=null`）從牌庫被丟棄時也丟對手牌庫頂 8 張 |

甲-2 是**靜態 lint 抓出來的**（站長只回報了甲-1）。堅果啞鈴印刷：
`18481` M4 061/083 J 有「整人擊落」；`13421` SV11W 064/086 I 與 `13837` SV11W 145/086 I
`abilities=null`（只有招式「強力鞭打」「金屬爪」）。

### 3. 中央收斂（不是「在勒克貓那裡加 if」）

**兩支中央述詞，依「卡在不在場上」分工：**

| 位置 | 述詞 | 檔案 | 會不會問「特性此刻被消除了嗎」 |
|---|---|---|---|
| 場上（戰鬥位／備戰） | `hasEffectiveAbilityByInst`（v6.196 既有） | `defense.ts:132` | 會 |
| 非場上（牌庫／棄牌區／手牌） | `cardPrintsAbility`（**v6.257 新增**） | `effects/_shared.ts` | 不會（卡不在場上，特性消除談不上） |

`cardPrintsAbility` 刻意寫成無配置、無 regex、與 `hasEffectiveAbilityByInst` 內部**逐字相同**的
嚴格 `===` 比對；零寬字元交給 `test-card-db-integrity` 負責（v6.117 教訓）。

**進化時序豁免收斂成單一 producer**：`engine.ts getEvolveTimingBypass(state, ownerIdx, inst,
card, isActive, oppActiveIsEx, pool) → { push, shellink, fightingHowl }`。
EVOLVE handler 與 `getEvolvableTargets` 兩端**都只呼叫它**。動機：那三處註解已經三次寫過
「兩端必須同 commit」（v6.088／v6.202／v6.207 教訓）—— 改成單一 producer 之後不可能再分岔。
副作用（好的）：EVOLVE handler 原本呼叫 `hasShellinkEvolveBypass` **兩次**（同 state 同參數同值），
收斂後只算一次。

**順帶修好的正確性**：鬥志戰吼現在也會被特性消除來源打到。勒克貓 `stage='Stage1'`
＝進化寶可夢 ⇒【傳說的熔岩洞】「雙方場上所有進化寶可夢的特性全部消除」應該消掉它；
舊碼只比對卡名，消除完全打不到（守衛 A8）。

### 4. 守衛 `scripts/test-v6257-samename-printing-dispatch.mjs`（24 條）

- A1–A9 勒克貓行為端（完整 `applyAction` EVOLVE ＋ `getEvolvableTargets` 兩端）
  ・A5/A6/A7 是 M3 的正對照；A8 熔岩洞；**A9 誤殺防線：三張勒克貓在一般時序都照常進化**
- B1–B5 提升進化／刺激進化的同名不同印刷正對照（**行為必須完全不變**）＋ 伊布在備戰不生效
- C1–C3 堅果啞鈴（完整 ATTACK 流程：花岩怪｜崩山 mill 受害方牌庫頂 1 張）
- D1 全站 registry by-index 碰撞掃描（下限斷言：同名同 index 異特性 ≥8 組）
- E1–E3 靜態 lint：E1 **正對照**（合成違規樣本必須被抓到、加了述詞必須不再違規）、
  E2 全站掃描（下限斷言：原始檔 ≥100、高風險卡名 ≥50、卡名比對命中 ≥20）、
  E3 白名單死條目
- F1–F3 單一 producer（F3 是行為端交叉驗證，不是字串比對）

**白名單 5 條**（逐條查證過，以原始碼片段比對，程式一改就失效）：
電氣球對「皮卡丘ex」（卡面就是卡名）／大力鱷 trigger-source fallback（按鈕由 abilities 決定）／
`PASSIVE_ATTACK_BONUS` 的棄世猴・仆斬將軍（key 是特性名）／願增猿ex｜鬆口氣判「桃歹郎ex」
（卡面「若自己的場上有『桃歹郎ex』」）／爆炸頭水牛｜捲牆的 partner 計數
（卡面「只要這隻寶可夢**與自己的其他「爆炸頭水牛」**在場上」⇒ partner 不需要帶特性，
SV8 087/106 `abilities=null` 確實算數量）。

### 5. HEAD-FAIL（對真 BASE blob，**各項各自紅**）

`engine.ts` ＋ `_shared.ts` 同時還原成 BASE blob：**13 PASS / 10 FAIL**。
紅的是 A1、A2、A3、A4、A8、C2、C3、E2、F1、F2；
**正對照 A5/A6/A7/A9/B1–B5/C1/D1/E1/E3/F3 維持全綠 ⇒ 沒有誤殺。**

### 6. 突變測試（7 個）

| 突變 | 紅在 |
|---|---|
| M1 鬥志戰吼改回 `card.name === '勒克貓'` | A1 A2 A3 A4 A8 F1 F2 |
| M2 `cardPrintsAbility` 尾端改 `return true` | C3 |
| M3 `cardPrintsAbility` 開頭 early `return false` | C1 C3 |
| M4 `push` 拿掉 `isActive` gate | B5 |
| M5 `fightingHowl` 拿掉 `oppActiveIsEx` | A7 |
| M6 UI 端繞過中央 producer（改回手刻） | A2 A4 F1 F2 F3 |
| M7 堅果啞鈴改回卡名比對 | C2 ＋ E2 |

⚠ **M7 第一次只紅 C2、沒紅 E2 —— 這是守衛的真缺陷，不是「守衛夠好」**：
lint 的 ±8 行視窗原本用**含註解**的行，只要註解裡提到 `hasEffectiveAbilityByInst` /
`cardPrintsAbility`，違規碼就會被誤判成「有伴隨驗證」⇒ 註解就能讓整條 lint 失效。
修法：視窗改用剝掉註解後的碼。修完 M7 與 M1 都會紅 E2。
收緊後又冒出一個新命中（爆炸頭水牛 partner 計數），逐字查卡面後判定合規 ⇒ 進白名單。

⚠ M2 沒紅 C2 的原因已查明、**不是守衛沒測到**：SV11W 堅果啞鈴 `abilities=null`，
`cardPrintsAbility` 第一行 `if (!abs ...) return false` 就退了，M2 的突變改不到那條路徑；
真正把邏輯改回卡名的 M7 會紅 C2。
⚠ M1 沒紅 E2：突變後那行落在 `getEvolveTimingBypass` 內，±8 行視窗仍看得到
`hasEffectiveAbilityByInst` ⇒ 視窗判準的固有邊界；A1–A4/A8/F1/F2 共 7 條已足以擋下。

### 7. 效能（Rule 32；量測腳本 `scripts/test-v6257-perf.mjs`）

典型滿場盤面（雙方 active + 5 備戰、手牌 7 張含 3 張進化卡）：

| | `getEvolvableTargets`（UI 熱路徑，20000 次） | `applyAction` EVOLVE（5000 次） |
|---|---|---|
| BASE r1 / r2 / r3 | 0.00400 / 0.00369 / 0.00430 ms | 0.11375 / 0.11141 / 0.11914 ms |
| v6.257 r1 / r2 / r3 | 0.00374 / 0.00381 / 0.00371 ms | 0.11382 / 0.11034 / 0.10999 ms |

三輪皆無退化（EVOLVE 少算一次 `hasShellinkEvolveBypass`，UI 端 `oppActiveIsEx` 先短路、
`hasEffectiveAbilityByInst` 對沒有 `abilities` 的卡第一行就退）。

### 8. 連帶清理

`scripts/test-v6205-…` 的 `ADJUDICATED_IMPLEMENTED` 有一條
`'勒克貓|鬥志戰吼':'…（按卡名「勒克貓」…）'`。改走特性名之後該候選判準不再列它為候選
⇒ 依 7e「兩張判讀表都不得有死條目」移除（與 v6.207 移除威嚇之顎同一個機制）。

### 9. 待辦 / 已知邊界

- 靜態 lint 的 ±8 行視窗是啟發式：違規碼若剛好緊鄰另一段合法的特性驗證會被放行（M1 的情形）。
  行為端守衛（A/B/C/F）是主要防線，lint 只是補網。
- `_oppIsExEarly` 判 ex 用 `subtype === 'ex' || name.endsWith('ex')`，本版未動。
- 卡面 `effect` 內含零寬字元的兩張（爆炸頭水牛 SV-P-H 147／SV7 081 的「‌爆炸頭水牛」）
  只影響 effect 文字、不影響 `name` 比對，本版未處理。


## v6.256 —「這隻寶可夢受到的招式的傷害」中央收斂（6 條傷害管線漏記）

BASE `20d4d6dfecb9101b07b9420a16968c19640367f4`（v6.255）。

### 1. 問題：只有 2 條管線有記，其餘 6 條漏記

`CardInstance.damageTakenLastOppTurn` 的**全 src 唯一讀取點**是
`src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts:23`
（超級赫拉克羅斯ex｜重裝角擊，M2 `14322`/`18578`，I 標，HP280）。
卡面逐字：「增加與在上個對手的回合這隻寶可夢受到的招式的傷害相同數值的傷害。」

對 BASE blob 跑完整 `applyAction` 流程（探針腳本邏輯已收進
`scripts/test-v6256-damage-taken-central.mjs` 的 B 區），實測結果：

| # | 管線 | 位置（BASE 行號） | 一般情況 | 防 KO | 該不該寫 |
|---|---|---|---|---|---|
| 1 | engine.ts ATTACK 主管線（active 主傷害） | `engine.ts:6349-6352` | ✅ 全額 | ✅ 實際扣到（v6.255） | 要 |
| 2 | `dealAttackDamageToTarget`（狙擊／延後型中央 helper） | `effects.ts:8748-8751` | ✅ | ❌ `L8715` 提早 `return _pk.state` | 要 |
| 3 | `snipe-multi`（鐵頭殼ex｜雙刃劍、月亮伊布｜出奇一擊、三重冰霜…） | `effects.ts:11054-11055` / 防KO `11030` | ❌ | ❌ | 要（`params.kind` 為 attack-effect 時不寫） |
| 4 | `clone-strike-multi-hit`（甲賀忍蛙ex｜分身連打、吼叫尾｜大吼大叫、三色炮） | `effects.ts:15895-15896` / 防KO `15866` | ❌ | ❌ | 要 |
| 5 | `hitBenchAll`（古鼎鹿｜大地斷裂、穿山王｜地震、焚焰蚣｜燃燒熱浪、電飛鼠｜天空波） | `effects.ts:1414` | ❌ | 無此分支 | 要 |
| 6 | `hitBenchPickPost`（三首惡龍ex｜黑曜石、奇麒麟ex｜惡劣光束、摩托蜥ex｜突圍、冰伊布ex｜冰霜子彈、古簡蝸｜貪婪危害） | `effects.ts:1623` | ❌ | 無此分支 | 要 |
| 7 | `snipe-60-ex`（謝米｜精刺奇襲） | `effects.ts:7374` | ❌ | 無此分支 | 要 |
| — | 放置傷害指示物族（`placeCountersBenchPickPost`、dragapult-snipe、咒詛炸彈、噬沙堡爺ex｜重晶石之獄…） | 各處 | 不寫 | — | **不該寫**（卡面是「放置傷害指示物」＝招式效果，不是「受到傷害」） |

⚠ 轉述的三個位置（`8714` / `11030` / `15866`）**全部屬實**，但**少報了 3 條**：
`hitBenchAll`、`hitBenchPickPost`、`snipe-60-ex` 連一般情況都沒寫。

玩家實際會遇到：備戰區的超級赫拉克羅斯ex 被上述招式打到（或被防 KO 擋下），
下個自己回合用「重裝角擊」只會打出基礎的 100。實測：`大地斷裂` 打 30 之後上場，
BASE 打 100、修後打 130。

### 2. 修法：單一寫入點 `withAttackDamageTaken`

`src/lib/game/effects/_shared.ts` 新增（`_shared.ts` 是 leaf，engine 與 effects 都已經
import 它，無新循環）：

```ts
export function withAttackDamageTaken(
  inst: CardInstance, prevDamage: number, newDamage: number,
  kind: 'attack-damage' | 'attack-effect' | 'ability-effect',
): CardInstance
```

- `actual = Math.max(0, newDamage - prevDamage)` ⇒ **防 KO 時自然就是「實際扣到的」**
  （v6.255 站長裁定＋官方 `PTCG RULES/PTCG_RULES.md` L1933-1934：勤奮之心留 HP10 ⇒
  指示物 22 個＝有效 HP−10），**一般情況自然就是全額**。呼叫端不必再判防 KO。
- `kind !== 'attack-damage' || actual <= 0` ⇒ 只寫 `damage`，不碰 `damageTakenLastOppTurn`。
- 防 KO 的三條路徑由 `applyPreventKOToVictim` 一支涵蓋，並把 `kind` 改成**必填參數**
  （Rule 28：共用 factory 加必填參數往下傳，強迫新呼叫端回去讀卡面）。

engine 主管線也改走同一支：
`withAttackDamageTaken(defenderState.active!, _damageBeforeThisAttack, _survivedDamage, 'attack-damage')`。

⚠ **與 v6.255 的唯一位元差異**：baseDamage 為 0（0 傷害招式）且防守方存活時，
BASE 會寫 `damageTakenLastOppTurn: 0`，現在維持 `undefined`。唯一讀取點用 `?? 0` 取值、
END_TURN 的清除本來就跳過 `undefined` ⇒ 行為完全相同。

### 3. 累計語意（本版**不**改變）

卡面「受到的招式的傷害」＝上個對手回合內的**總和**（v6.253 B9、v6.255 C5 已經是此語意
且有守衛）；多目標招式時**各自記各自的**（per-instance，天然由 iid 分開）。
自傷型招式（`dealAttackDamageToTarget(s, dIdx, 自己的iid, …)`）與打自己備戰的
`hitBenchAll` 仍照記，但那是在**自己回合**發生、於自己 `END_TURN` 就被清掉，讀不到。

### 4. 守衛

`scripts/test-v6256-damage-taken-central.mjs`（17 條）：
- A 區 2 條：卡面前提（重裝角擊恰好 2 張印刷／六條管線代表卡的卡面逐字）。
- B 區 12 條行為端：B1/B2/B3 正對照（engine 一般＋engine 防 KO＋dealAttackDamageToTarget
  一般，逐位元不變）；B4~B9 六條管線各一條；B10 端到端（重裝角擊 100→130）；
  B11 負對照（attack-effect 不計）；B12 中央 helper 單元語意。
- C 區 3 條 lint：C1 全 src 只有 `_shared.ts` 能寫此欄位（正對照＋下限斷言）；
  C2 中央算式與 ≥10 個消費端；C3 `applyPreventKOToVictim` 三個呼叫端都必須帶 `kind`
  且宣告端必填（正對照餵 6 參數樣本）。

**HEAD-FAIL（對真 BASE blob）**：B4~B10 **各自紅**（7 條）；C1/C2/C3 各自紅（3 條）。

**突變 7 個，全部紅在預期那一條**：
① 拿掉 helper 的 kind gate → B11/B12/C2 紅；
② 拿掉 `Math.max(0,…)` → 只有 C2 紅（**行為端沒紅是正確的**：`actual <= 0` 的早退
   已經涵蓋負值 ⇒ 這是真正的行為等價突變，不是守衛沒測到）；
③ `hitBenchAll` 退回直接 spread → B7/B10 紅；
④ `applyPreventKOToVictim` 被動分支退回直接 spread → B4 紅；
⑤ engine 退回自己寫（繞過中央）→ C1/C2 紅；
⑥ helper 改覆寫不累計 → B12 紅 ＋ **test-v6255 C5 紅**；
⑦ `snipe-multi` 把 kind 寫死 `'attack-effect'` → B5 紅。

**改到既有守衛**：`test-v6255-…` 的 C7/C8 原本斷言「算式寫在 engine.ts 裡」，
算式搬家後會假紅。C7 把 `_shared.ts` 補進掃描清單（維持下限斷言的意義）；
C8 改成「engine 必須走 `withAttackDamageTaken`」＋「中央 helper 必須是
`newDamage - prevDamage`」——**比原本更強**（同時擋住「又拉回 engine 內寫死」），
且對 BASE 原始碼仍然紅（已實測）。

### 5. 效能（Rule 32：附量測腳本 `scripts/test-v6256-perf.mjs`）

微基準（沙盒，N=2,000,000，7 輪取最小）：

| 寫法 | ns/call |
|---|---|
| BASE 的 `{ ...inst, damage, damageTakenLastOppTurn }` | 34.84 |
| v6.256 `withAttackDamageTaken` | 45.10 |
| **差值** | **+10.26 ns／每一隻被打到的寶可夢** |

量級檢核：多目標招式一次最多 6 隻 ⇒ 每個 action 最多 +62 ns，而
`applyAction(ATTACK)` 本身約 **215,000 ns**（同一台沙盒）⇒ 占比 **0.03%**，差三個數量級。

`applyAction` A/B（各跑 4 次程序、每次 5 輪取最小，µs/action）：

| 情境 | BASE 最小 | v6.256 最小 |
|---|---|---|
| engine 主管線 單體攻擊（防守方存活） | 215.55 | 213.91 |
| 多目標 黑曜石（1 主傷害 ＋ 2 備戰＝3 次寫入） | 295.81 | 303.71 |

⇒ 動作層級**量不出差異**（逐輪互有高低，落在雜訊帶內）。
⚠ 沙盒 CPU 約為正式 VM 的 1/10 量級，上表只可比相對值。

### 6. tsc

自訂 `tsconfig`（strict、只含 `src/lib/game/**`）BASE 88 個既有錯誤、修後 **88 個**，
錯誤碼分佈逐項相同，**TS2304 兩邊皆 0**。


## v6.255 — 化隱一起豁免特性消除 ＋「受到的傷害」改記實際扣到的 ＋ 兩個守衛/註解更正

站長裁定（2026-08-28，逐字）：①「一起豁免」 ②「改成實際扣到的」。

### 1. 化隱一起進 OPP_ABILITY_EFFECT_IMMUNE_ABILITIES

**卡面枚舉（BASE fa30fb59，只用 static/cards，live index.json 的 42 個卡包、4935 張）**
掃描條件＝`abilities[].effect` 同時含「不會受到」與「特性」⇒ 13 筆，特性名只有 3 種：

| 特性 | 印刷 | 標 | effect 逐字 |
|---|---|---|---|
| 化隱 | 19149 斯魔茶 / 19150 來悲粗茶 / 19175 怨影娃娃 / 19176 詛咒娃娃（**共 4 張**，皆 M5） | J | 這隻寶可夢不會受到對手的招式與特性的效果的影響。 |
| 光之翼 | 18007 / 18399 / 18415 超級皮可西ex（M3） | J | 這隻寶可夢不會受到對手的寶可夢特性效果的影響。 |
| 礎石之勢 | 厄鬼椪 礎石面具ex ×6 | H | 這隻寶可夢不會受到對手的擁有特性的寶可夢**招式的傷害**。（主詞是招式傷害 ⇒ 不收） |

⚠ **官方 `PTCG RULES/PTCG_RULES.md` 對「化隱 × 特性消除」零裁定**（全文逐字搜尋 化隱／
藏隱／暗夜羽擊 的 Q&A，沒有任何一條）。本條是**站長裁定**、依卡面字面推論，日後可翻案：
改 `OPP_ABILITY_EFFECT_IMMUNE_ABILITIES` 一個名字即可。

**收斂點（沒有新增平行實作）**
化隱在站內有兩個免疫消費點：`defense.ts canApplyEffectToTarget` step 1b（unified）與
`effects.ts canApplyAttackEffectToTarget`（@deprecated legacy）。**兩者都是先問
`isAbilityHolderEffective(...,'化隱',...)`**，而 v6.254 的豁免鉤子就掛在那支中央述詞裡
（`isInitializeNullified` / `isOppActiveAbilityNullifiedByMoonsenne` / `isAbilityNullifiedBySticky`）。
⇒ 只改名單一行，兩個消費點自動同步（守衛 B2 用兩支各問一次，分歧就紅）。

**行為差異逐項（harness 實測 BASE vs HEAD，四張各驗）**

| 消除源 | BASE | HEAD | 說明 |
|---|---|---|---|
| 振翼髮｜暗夜羽擊（passive，對手戰鬥位） | 化隱失效 | **化隱維持有效** | ⭐**本版唯一的實質行為改變** |
| 鐵荊棘ex｜初始化 | 不影響 | 不影響 | 化隱四張都不是「擁有規則的寶可夢」⇒ 本來就打不到（no-op） |
| 海兔獸｜黏著束縛 | 不影響 | 不影響 | 卡面限【2階進化】，化隱四張是 Basic/Stage1（no-op） |
| 傳說的熔岩洞（競技場卡） | 來悲粗茶/詛咒娃娃(Stage1) 失效 | **相同** | 競技場卡不豁免 |
| 火箭隊的監視塔（競技場卡） | 不影響 | 不影響 | 卡面限【無】，化隱四張是草/超（no-op） |
| `abilityNullifiedThisTurn`（招式旗標） | 化隱失效 | **相同** | 見下 |

### 2. 「招式版特性消除該不該被化隱擋」— 推論與依據

化隱卡面**有寫「招式」**，所以答案是「應該擋」。但**擋的位置不是評估點**：

1. 全站唯一會設 `abilityNullifiedNextTurn` 的是 `regPost('振翼髮|暗夜羽擊')`
   （`v2362_new_decks_batch.ts` L55），而它走中央 `applyOppActiveDebuffPost`
   —— 那支自帶 attack-effect 免疫閘 ⇒ **化隱有效時旗標根本寫不上去**（守衛 B7 行為端驗證，
   並配正對照：化隱被熔岩洞消除時旗標設得上去）。「化隱擋招式版特性消除」已經成立。
2. 若在評估點（`hasEffectiveOppAbilityImmunity` / `isAbilityHolderEffective` step 1）也豁免，
   會變成「旗標當初**合法**寫上去（寫入當下化隱正被熔岩洞消除），事後熔岩洞被換掉，
   化隱無聲復活」—— 那是回頭改寫已結算的過去，卡面沒這樣講。
3. 補充事實：現役 H/I/J **沒有任何招式**會消除特性
   （掃 `attacks[].effect` 同時含「特性」與「無效|消除」⇒ 0 張），
   `振翼髮|暗夜羽擊` 那支 reg 無對應卡（現役振翼髮招式是 飛來橫禍／蠱惑挪移／月亮之力）。
⇒ **維持不豁免**，並用 B7 把「施加點有擋」鎖住。

### 3. damageTakenLastOppTurn ＝ 實際扣到的（engine.ts）

**讀取點枚舉（BASE，`git grep` 指定 rev，src 全域）：只有 1 個**
`v2690_i_wave19_engine_hooks.ts` L23 `const dmgTaken = a?.damageTakenLastOppTurn ?? 0;`
（超級赫拉克羅斯ex｜重裝角擊，M2 14322/18578，I 標，HP280，attacks[0] 100+）
卡面逐字：「增加與在上個對手的回合這隻寶可夢受到的招式的傷害相同數值的傷害。」

**寫入點 3 個**：engine.ts L6334-6339（主管線，本版改）、effects.ts L8749
（`dealAttackDamageToTarget` 非 KO 分支）、engine.ts L7676 END_TURN 清除。

**官方依據**：`PTCG_RULES.md` L1933-1934 ——「激動競技場在場、請假王ex 對滿血皮卡丘ex
使出偉大橫掃，因勤奮之心以剩餘HP『10』留在場上時，皮卡丘ex 身上放置的傷害指示物為多少個？
→ 為22個。」＝ 有效 HP−10，不是招式全額。

**改法**：`_actualDamageTaken = Math.max(0, _survivedDamage - (newDamage - baseDamage))`。
非防 KO 時 `_survivedDamage === newDamage` ⇒ 恆等於 `baseDamage`，**行為與 BASE 完全相同**
（守衛 C4/C5 是正對照）。

| 情境 | BASE | HEAD |
|---|---|---|
| 岩殿居蟹(HP150)｜結實 被 160 打 | damageTaken=160 | **140** |
| 超級摔角鷹人ex(HP250) 帶 100 傷、堅忍之軀正面、被 160 打 | 160 | **140** |
| 倖存鍛鍊器 擋下 | 160 | **140** |
| 重裝角擊：滿血赫拉(HP280) 被 300 打、倖存鍛鍊器擋下 | 100+300=400 | **100+270=370** |
| 一般受傷未昏厥（皮卡丘ex HP200 被 160 打） | 160 | 160（不變） |

⚠ **未處理、已回報站長的相鄰缺口**（本版**刻意不動**，屬另一個維度）：
`effects.ts` 的狙擊/多目標傷害管線在**防 KO 成功時提早 return**（L8714 `applyPreventKOToVictim`），
`damageTakenLastOppTurn` **完全沒累計**（記 0）；另外兩條多目標路徑（L11030、L15866 附近）
即使**沒有**防 KO 也從來不寫這個欄位。這是「漏記」不是「記全額」，與站長這次的裁定不同型。

### 4. C5 守衛安慰劑（Fable 5 抓到）

`scripts/test-v6253-nullifier-and-survive.mjs` 舊 C5 把【傳說的熔岩洞】放在場上，
但三合一磁怪自己也是【1階進化】⇒ 過度放電先被熔岩洞消除 ⇒ `listed` 恆 false ⇒
`!(listed && blocked)` 恆真、**不可能紅**。改成兩個方向都到得了的正對照對
（無消除源 ⇒ 不列出且擋下；我方振翼髮消掉哥達鴨的濕氣 ⇒ 列出且不擋），
斷言 `listed === !blocked` ＋ 兩個方向各自的絕對值。
**突變證明**：把 `hasPsyduckDamp` 的 v6.253 gate 拿掉 ⇒ 新 C5-B 紅、
**舊 C5 在同一個突變下仍然綠**（實測印出 `listed=false blocked=false`）⇒ 安慰劑確認。

### 5. 效能註解更正（Rule 32，只改敘述不改邏輯）

`v3001_g3_wave3.ts` `isInitializeNullified` 原註解「不用 `[0,1]` 陣列…實測有感」
會讓人以為這條路徑仍便宜，方向與實測相反。獨立複驗（`scripts/perf-v6253.mjs`，
各 3 輪取最小、N=60000、同一台沙盒）getUsableAbilities µs/call：

| 情境 | v6.252 fe0dcb0d | v6.253 312ec9a9 | v6.254 fa30fb59 | v6.255 |
|---|---|---|---|---|
| worst | 3.682 | 9.461 | 10.110 | 9.832 |
| typical | 5.191 | 6.036 | 5.911 | 5.839 |

⇒ Fable 5 回報的「worst 3.8→9.5µs（約 2.5 倍）」成立。v6.255 相對 v6.254 持平。
本版新增量測腳本 `scripts/test-v6255-perf.mjs`（BASE vs HEAD 同 workload）：
canApplyEffectToTarget 一般盤面 63.5→63.9 ns、對手化隱 200.6→195.9 ns（持平）、
isAbilityHolderEffective 化隱×暗夜羽擊 256.3→327.3 ns（+28%，多問兩張競技場卡，刻意）；
完整 applyAction(ATTACK) 248.07→245.34 µs / 239.19→237.55 µs（動作層級量不出差異）。

### 6. defense.ts 零行為差異收斂（前一版代理提出、站長同意）

`canApplyEffectToTarget` step 1（光之翼）/ step 1b（化隱）原本只用 `1 - actorIdx` 推 owner。
新增 `isInstOnSide` + `isTargetOnActorOwnSide`（先問對面 ⇒ 對手戰鬥位 1 次比對就早退），
**排在 hasEffectiveAbilityByInst / isAbilityHolderEffective 之後** ⇒ 一般盤面 0 次呼叫。
**fail-closed**：兩側都找不到（KO 前快照）維持 BASE 的照擋。

⭐ **「目前沒有會踩到的真卡」已獨立複驗**：把探針插進 `canApplyEffectToTarget`
（記錄每一次 target 不在 `1-actorIdx` 那一側的呼叫 + 呼叫堆疊），
對 BASE fa30fb59 跑**完整 575 支 npm test**，只有 1 筆命中且是合成呼叫
（`test-protect-code-any-ex-bench.mjs`，kind=attack-damage、鐵臂膀、無特性、兩側都找不到）
⇒ **零行為差異**，不是修現存 bug。

### 守衛

`scripts/test-v6255-hidden-immunity-and-damage-taken.mjs`（35 條）＋
`scripts/test-v6255-perf.mjs`（3 條上限斷言）。
HEAD-FAIL 對 BASE fa30fb59：三個原始碼檔全還原 ⇒ 14 PASS / 19 FAIL，且**逐檔還原**時
紅的條目剛好落在對應區塊（v3001→A4/B1×4/B2×4/B4/B7；engine→C1/C2/C3/C6/C8；
defense→D1/D2/D5；test-v6253→E1）。
突變測試 7 個（化隱豁免擴大到競技場卡 / 擴大到招式旗標 / 名單拿掉光之翼 /
消除源有效性失效 / engine 記回全額 / defense 拿掉 owner 驗證 / 濕氣 gate 拿掉）
全部紅在預期條目，且只捕捉 `assert.AssertionError`。

## v6.254 — 超級皮可西ex｜光之翼：豁免「對手的寶可夢特性」型特性消除

站長裁定（2026-08-28，逐字）：「不該消。要修」。

**卡面（static/cards/M3.json id 18007，J 標，subtype=ex，stage=Stage1，pokemonType=Psychic）**
`abilities[0].effect` = 「這隻寶可夢不會受到對手的寶可夢特性效果的影響。」

**官方裁定（PTCG RULES/PTCG_RULES.md，逐字）**
- L2818「對手的戰鬥場上有特性「初始化」處於生效狀態的鐵荊棘ex時，自己的超級皮可西ex的
  特性「光之翼」會消除嗎？」／L2819「不會消除。」
- L2733「對手的戰鬥場上有特性「初始化」處於生效狀態的鐵荊棘ex時，若從手牌抽出超級皮可西ex
  重疊在自己場上的皮皮身上讓其進化，特性「光之翼」會生效嗎？」／L2734「會生效。」
- L2722/2723（咒詛炸彈可以選它、但效果不生效）、L2828/2829（冰冷之帳不能放指示物）、
  L2830/2831（大力捕捉器可以選、但不能互換）。
- ⚠ **官方沒有任何一條講到 光之翼 × 競技場卡**（`grep 光之翼` 全檔 13 條，逐條看過）。
  ⇒ 競技場卡是否豁免採站長裁定「不豁免」（卡面寫的是「寶可夢特性」，競技場卡不是）。

**BASE 行為（312ec9a9，harness 實測）**
`isAbilityHolderEffective(對手初始化在場, 皮可西, '光之翼') = false`，
`canApplyEffectToTarget(..., 'ability-effect') = {blocked:false}` ⇒ 免疫整個消失。

**修法（中央收斂，全部在 v3001_g3_wave3.ts）**
- 新增 `OPP_ABILITY_EFFECT_IMMUNE_ABILITIES`（逐字對齊卡面的名單，目前只有『光之翼』）
  ＋ `printsOppAbilityImmunity`（便宜早退）＋ `hasEffectiveOppAbilityImmunity`（中央述詞）。
- 三個「寶可夢特性」型消除源各自接上 holder 脈絡並豁免**對手側**來源：
  `isInitializeNullified`（+3 個選填參數）／`isOppActiveAbilityNullifiedByMoonsenne`（+defenderInst）／
  `isAbilityNullifiedBySticky`（+holderOwnerIdx）。
- `isAbilityHolderEffective` 與 `isAbilityNullifiedByPassive` 兩支都接上（否則 UI gate／
  USE_ABILITY dispatch 會與中央閘對同一張卡給相反答案）。
- engine.ts `isInitializeBlocking`（+2 個選填參數，兩個 caller 都傳）與
  effects.ts `promptPlayAbilities` 的 `isInitializeNullified` 也一併接上。

**為什麼沒有「光之翼先被消除⇒不再豁免」的邏輯循環**
`hasEffectiveOppAbilityImmunity` **只**查三個「非寶可夢特性」的來源
（火箭隊的監視塔／傳說的熔岩洞／`abilityNullifiedThisTurn`），不回頭呼叫 `isAbilityHolderEffective`
⇒ 結構上不可能遞迴，也不會與 v6.253 的 `_nullifierVisiting` 打架。
官方 L2733/L2818 的語氣就是「光之翼先生效」，與這個實作順序一致。

**消除源重新枚舉（live H/I/J 卡面掃描，非 grep 程式碼）**
寶可夢特性型 4：鐵荊棘ex｜初始化、振翼髮｜暗夜羽擊(passive)、海兔獸｜黏著束縛、
可達鴨/哥達鴨｜濕氣（只消除「將自己【昏厥】的效果的特性」⇒ 與光之翼零交集，不需改）。
競技場卡型 2：火箭隊的監視塔、傳說的熔岩洞。招式型 1：招式版暗夜羽擊（`abilityNullifiedThisTurn`）。
⇒ **沒有第 7、第 8 個**（洛托姆ex｜多重轉接只是提到「這個特性消除時」，不是消除源）。

**同型卡枚舉（live H/I/J，`effect` ＋ `rulesText` 全載體）**
「不會受到對手的…特性…影響」只有兩族：
- 光之翼（超級皮可西ex，本版處理）
- 化隱（斯魔茶／怨影娃娃／來悲粗茶／詛咒娃娃）：「這隻寶可夢不會受到對手的招式與特性的
  效果的影響。」字面上是光之翼的**超集**，但官方 Q&A 對它與特性消除的互動零裁定，
  且會改動既有「化隱 × 暗夜羽擊」的行為 ⇒ **本版不擅自擴大**，待站長裁定。
（「礎石之勢」「精神防護」只講「招式的傷害」，與特性消除無關。）

**效能（IRON_RULES Rule 32；量測腳本 scripts/test-v6254-magical-shine-perf.mjs）**
A/B（BASE vs 修後，9 輪取最小、N=200k）：一般盤面 218.8→210.9 ns/call（-3.6%）；
一般盤面×一般卡 210.4→203.4（-3.3%）；對手初始化在場×光之翼持有者 447.1→291.5（-34.8%，
豁免先短路變快）；對手初始化在場×一般規則寶可夢 422.9→463.5（+9.6%）。
換算到完整 `applyAction(ATTACK)`（7 輪取最小、N=3000）：有鐵荊棘ex 42.28→42.03 µs（-0.6%）、
一般盤面 41.75→41.35 µs（-0.9%）⇒ 動作層級量不出差異。
⚠ 開發途中曾把兩張競技場卡的檢查提前到 step 0 之前（純可讀性重排），
量到 +21.9%（423.7→516.3 ns）⇒ **已還原成 v6.253 的原順序**，並在原始碼寫下這段量測。

**測試**
- `scripts/test-v6254-magical-shine-immunity.mjs`（28 條）：A 卡面/官方逐字、B 豁免生效（HEAD 全紅）、
  C 正對照（競技場卡／招式旗標／自己這一側／無光之翼的卡 行為與 BASE 相同）、
  D 行為端 E2E（黑夜魔靈｜咒詛炸彈 × 超級皮可西ex，對照官方 L2722/2723）、E 結構守衛（含偽造正對照）。
- HEAD-FAIL：對 BASE blob 跑 → 11 PASS / 14 FAIL，每一條各自紅（不是單一 crash）。
- 突變 6 個全紅在預期那一條：擴大到熔岩洞／監視塔／招式旗標／自己這一側、名單清空、
  `isAbilityNullifiedByPassive` 不傳脈絡。
- 免疫網：damage-immunity 25、attack-effect-immunity 19、selection-ui 35、v6253 27、
  v6202 53、initialize-nullify 8、has-effective-ability 11、v6196-legend-cave 18 全綠。

## v6.253 — 特性消除源自身有效性 ＋「防 KO 成功＝未昏厥」兩個中央述詞

站長回報兩件事（逐字）：①「振翼髮 [特性] 暗夜羽擊 在場上時，對方場上是 鐵荊棘ex，照理說，
鐵荊棘ex的 [特性] 初始化 應該要被消除，但似乎沒有…拉帝亞斯 特性 天空徑線，但仍然無法直接撤退」
②「岩殿居蟹 [特性] 結實 發動後，無法觸發身上裝備的寶可夢道具 手持循環扇」。

⚠ 站長口中的「拉帝亞斯」實際是 **拉帝亞斯ex**（M2a 14735 / MC 16783 / SV7a 11049 等，subtype=ex），
不是無特性的普通拉帝亞斯（MC 16782）。「規則寶可夢」在資料上＝`subtype ∈ RULE_BOX_SUBTYPES`
（ex/EX/V/VMAX/VSTAR/GX/MegaEvolution）或 `tags` 含同名項；「未來」是 `tags` 含 `'未來'`。

### Bug 1 根因：消除源自身的有效性沒有人問

`v3001_g3_wave3.ts isInitializeNullified` 的迴圈只做
`ac?.abilities?.some(ab => ab.name === '初始化')` —— **只問「場上有沒有印著初始化的卡」**。
振翼髮 passive 那一支（`isOppActiveAbilityNullifiedByMoonsenne` → `hasAbilityOnActive`）
早在 v6.196 就接上了中央閘，`isInitializeNullified` 與 `isAbilityNullifiedBySticky`
（走刻意無閘的 `hasAbilityOnBench`）被漏掉。v6.202 的枚舉守衛甚至把這兩處寫進豁免表，
理由是「加 gate 會自我遞迴」—— 那個理由是可以解的，代價卻是真 bug。

修法：新增中央述詞 `isNullifierAbilityEffective(state, holderInst, holderCard, ownerIdx,
nullifierName, location, pool)`，內部轉呼叫 `isAbilityHolderEffective`，並用 module-level
`_nullifierVisiting: Set<string>` 擋住「同一個消除源名稱」的自我遞迴（遞迴時回 true＝
fail-open＝維持 v6.252 行為，最壞不會比現在差）。引擎全程同步 ⇒ 集合不會跨請求交錯。

三個消費點接上：
1. `isInitializeNullified`（鐵荊棘ex｜初始化）— **有行為差異，就是站長回報的那一條**。
2. `isAbilityNullifiedBySticky`（海兔獸｜黏著束縛）— 述詞層修正。⚠ 當前卡池 **0 行為差異**：
   唯一打得到海兔獸（Stage1）的來源是【傳說的熔岩洞】，而它同時也消除所有備戰【2階進化】
   受害者的特性 ⇒ 淨效果相同。等同 v6.209 岩石宮殿的處理（保證的 no-op，接閘防未來漂移）。
3. `effects.ts hasPsyduckDamp`（可達鴨／哥達鴨｜濕氣）— 原本用的
   `isAbilityNullifiedByPassive` **比中央閘窄**（只有 初始化／暗夜羽擊／黏著束縛，
   漏掉監視塔與熔岩洞），而 `engine.ts isSelfKOEffectBlocked`（v6.201）早就走中央閘
   ⇒ 同一張卡兩支實作會給不同答案。⚠ 同樣 **0 行為差異**：哥達鴨是 Stage1，能打到它的
   熔岩洞同時也打得到唯一 live 的自 KO 特性持有者三合一磁怪（Stage1）；
   `cursedBombAttackPost` / `overvoltAttackPost` 兩個 factory 全 src **零註冊端＝死碼**。

### Bug 2 根因：`preventedKO` 掉進「無人分支」

`engine.ts` ATTACK 主管線寫成
`if (!preventedKO && wouldBeKO) { …KO… } else if (!preventedKO) { …未 KO… }`
⇒ **防 KO 成功時兩個分支都不跑**。於是非 KO 分支裡的
`TOOL_ON_DAMAGED`（幸運頭盔／凸凸頭盔／奢華炸彈／火箭隊的催眠裝置／逆境保險／手持循環扇／
豪邁炸彈，共 7 支）與 `SPECIAL_ENERGY_ON_DAMAGED`（扣殺能量）整批靜默漏掉，
連 `damageTakenLastOppTurn`（重裝角擊追蹤）也沒累計。
而共用尾段的 `PASSIVE_RETALIATION` / `PASSIVE_ON_DAMAGED` 是用
`_v5113RanInKoBranch = wouldBeKO && !preventedKO` 判的，**照樣會跑**
⇒ 同一次傷害「特性有反應、道具沒反應」，本來就自相矛盾。

修法：中央述詞 `const defenderSurvivedAttack = !wouldBeKO || preventedKO;`
（語意＝這一擊之後防守方仍留在場上＝PTCG 規則的「受到了傷害但沒有昏厥」），
`else if (!preventedKO)` 改成 `else if (defenderSurvivedAttack)`；並在分支開頭用
`const _survivedDamage = preventedKO ? defenderState.active!.damage : newDamage;`
保住防 KO 已寫入的「剩餘 HP = leaveHP」，否則會把剛救回來的寶可夢再打死一次。

官方依據（`PTCG RULES/PTCG_RULES.md`）：
- L1899／L1901（§17.29.A 勤奮之心）、L2650（§17.45.A 堅忍之軀）：
  「以剩餘HP為『10』的狀態留在場上」⇒ 昏厥時效果（雷之大地／古舊能量）不生效 ⇒ 沒有昏厥。
- L1933（§17.29.D）：勤奮之心留場時身上是 22 個傷害指示物 ⇒ 傷害確實有結算。
- L1935／L2733／L2818：官方一律寫「特性『初始化』**處於生效狀態**的鐵荊棘ex」；
  L1594／L2505 同樣寫「特性『暗夜羽擊』**處於有效狀態**的振翼髮」
  ⇒ 消除源自身必須有效，正是本版的判準。

### 中央傷害 helper 路徑不受影響

`dealAttackDamageToTarget`（狙擊／多目標／延後傷害）本來就是「先 `fireDefenderOnDamaged`、
KO 時再 `fireDefenderOnKO`」，prevent-KO 時扇子本來就會觸發 ⇒ 這次只動引擎主管線，
且 `TOOL_ON_KO_MIRRORED_FROM_DAMAGED` 的跳過條件（v6.120）不受影響，不會變成觸發兩次。

### 效能（Rule 31/32：附量測腳本 `scripts/perf-v6253.mjs`，沙盒 N=60000 × 3 輪）

| 情境 | getRetreatCost | getUsableAbilities |
|---|---|---|
| typical（場上無任何消除源） | 2.44 → 2.62 µs | 5.26 → 5.76 µs |
| worst（振翼髮 vs 鐵荊棘ex ＋ 熔岩洞 ＋ 雙方滿場規則寶可夢） | 2.97 → 3.75 µs | 3.76 → 9.51 µs |

worst 的 +5.75 µs ÷ 一個 frame 的 16,667 µs ＝ **0.03%**，差三個數量級 ⇒ 玩家零感受；
且沙盒 CPU 比正式環境慢，線上只會更低。
⚠ 這兩支都是**前端**述詞，不經過伺服器。
⚠ 實作時特地避開 `for (const i of [0,1] as const)`（每次呼叫配置新陣列，實測有感），
改用計數迴圈。

### 守衛

`scripts/test-v6253-nullifier-and-survive.mjs`（27 條）：
A 段 11 條（消除源有效性，含正對照「沒有振翼髮時初始化照常壓制」「鐵荊棘ex 是未來不得自消」
與遞迴防護實跑）、B 段 9 條（5 個防 KO 來源 × 受傷道具／特殊能量全部行為端實跑，
含「恰好抽 2 張不得變 4 張」的重複觸發檢查）、C 段 7 條（卡面枚舉下限、登錄數下限、
兩條靜態 lint 各配「抓得到違規樣本」的正對照、濕氣兩份實作一致性）。
HEAD-FAIL：對 BASE `fe0dcb0d` 跑 → 13 PASS / 14 FAIL，正對照全綠（不是無差別紅）。
突變測試 4 個全部紅在預期條目。
`scripts/test-v6202-passive-ability-gate.mjs`：GATE_RE 加入 `isNullifierAbilityEffective`，
並刪掉「初始化」「黏著束縛」兩個已不成立的豁免條目（20e 會擋住死條目）。

### 已查證、留待站長裁定的一條（本版**未**動）

官方 L2733／L2818：「對手戰鬥場上有特性『初始化』處於生效狀態的鐵荊棘ex 時，自己的
超級皮可西ex 的特性『光之翼』會消除嗎？→ **不會消除／會生效**」。
原因是光之翼卡面＝「這隻寶可夢不會受到對手的寶可夢**特性效果**的影響」，
而初始化正是對手的寶可夢特性效果 ⇒ 它免疫初始化本身。
站內 `isAbilityHolderEffective` 目前**沒有**這個豁免 ⇒ 超級皮可西ex（M3 18007，J 標）
的光之翼會被初始化誤消除。修它要動到所有 `isAbilityHolderEffective` 消費點，
爆炸半徑大且會碰到既有免疫語意，依「一版一修法」留到下一輪，並先問站長是否同意判準。

## v6.252 — 錦標賽賽事區塊摺疊 ＋ 大廳聊天【聊天】/【系統】篩選

站長逐字需求：①「網站賽和社群賽同時舉行…賽事頁面會被拉的很長，希望能增加摺疊功能」
②「聊天室希望增加篩選【聊天】和【系統】…網站管理員的訊息是屬於【聊天】…打勾的位置設在
💬 大廳聊天室 標題的右邊」。站長另裁定三件事：摺疊預設＝有報名就展開、進場鈕安全＝輪到我時
**強制展開**（不是把按鈕移出摺疊區）、聊天篩選只做大廳聊天。

### 需求A：摺疊

**版面真正被拉長的是 `bracketBlock`**，不是賽事卡 —— 瑞士排名表
（`{#each standingsKeyed(brk.standings)}`，BASE L9466）是全員 30~40 列、沒有上限；
賽事卡本身只有十幾行。所以摺疊必須同時涵蓋 `eventCard` 與 `bracketBlock`，
粒度以 **eventId** 為單位（`ev._id` 對 `brk.event?._id`）。

判定全部集中在一個純述詞 `tEvOpenBy(eventId, registered, dropped, pref, myMatchEventId, myByeEventId)`，
優先序：
1. **強制展開**：`eventId === myMatchEventId || eventId === myByeEventId` → `true`
2. 使用者手動偏好（`pref[eventId]` 是 boolean）→ 依使用者
3. 預設：`!!registered && !dropped`

`tEvOpen` 是 `$derived.by`，一次算出整張 `eventId → boolean` 表；模板只做 O(1) 查表
（`tEvOpen[ev._id] !== false`），沒有在 render 裡重算，也沒有 per-render 的陣列配置。
`tEvOpen[未知 id]` 是 `undefined`，`!== false` ⇒ **fail-open 展開**：
賽程載到了但 `/event` 還沒回、或 `brk.event` 缺席時，寧可多畫也絕不把整場藏起來。

#### ⚠⚠ 為什麼「強制展開」是硬約束

`{@render myMatchBox()}`（進場按鈕）就畫在 `bracketBlock` 的賽程表區塊內
（BASE L9479-9483），BASE 自己的註解已經寫著「v5.937 進場鈕保底(判負攸關)」。
摺疊掉那一段＝進場鈕消失＝玩家吃 noShow 判負。站長裁定不移動按鈕、改用強制展開，
所以 `tEvOpenBy` 的第 1 條優先序是不可退讓的；守衛用突變測試（拿掉那一行）證明它抓得到。

BASE L9526-9530 的頂層保底（`tMyMatch` 對不到任何已載入 bracket 時獨立渲染）**一字未動**。

#### localStorage

`ptcg_tourn_evfold_v1`，只寫「使用者**手動**點過的那幾場」的 boolean。
沒有紀錄的賽事一律回退預設規則 ⇒ 新賽事出現時行為可預期，不會被別場的偏好帶著走。
讀（`tLoadEvFold`）與寫（`tToggleEv`）都包 try/catch（隱私模式 `setItem` 會 throw；
`getItem` 的 ReferenceError 也一併吃掉）。讀進來還會逐 key 檢查型別，壞掉的內容一律當「沒有偏好」。

#### 摺疊後留下的資訊

標題列（`.tourn-ev-head`）永遠可見：▾/▸ 箭頭 ＋ 🏆 賽事名 ＋（被強制展開時）🔒。
摺疊時多一行摘要：狀態（`tEventStatusLabel(ev.status)`）｜報名人數｜📣 社群賽｜✅ 已報名｜點此展開。
**摘要內刻意不放進場鈕** —— 強制展開已經處理了，再放一顆等於兩個真相來源。
賽程表／排名表摺疊後保留原本的標題（含賽事名、第幾輪、冠軍、「· 更新中」）。

無障礙沿用名人堂 `.tourn-hof-toggle` 的 pattern：`role="button"` + `tabindex="0"` +
`onclick` + `onkeydown`（Enter/Space）+ `aria-expanded`。**class 另取名 `.tourn-fold-toggle`**，
不與名人堂共用，`tHofOfficialOpen` / `tHofCommunityOpen` 兩個狀態一字未動。

### 需求B：聊天篩選

判準就是伺服器已經在下發的 `m.sys`。查證（`oracle-admin/server_admin_patch.js`，BASE）：

- L5595 出口：`sys: !!m.sys, admin: !!m.admin` ⇒ **每一則都一定有 boolean 的 sys**，不需要回填舊資料。
- L5920 是系統訊息的**唯一**寫入點：`{ uid:'system', name:'系統', …, sys: true }`。
- L5629 是玩家／管理員的發言：`{ …, admin: isAdm || undefined }`，**不寫 sys**。

⇒ 管理員訊息（`admin:true`、`sys` 缺席）現在就已經歸在【聊天】，站長那句是確認不是修正。
**純前端，`server_admin_patch.js` 一個字都沒改。**

另外大廳聊天在 `tournamentChat`，伺服器每 ~5 分鐘只保留最近 800 則、前端最多 600
⇒ 沒有「舊訊息缺欄位」的問題。（那 137,861 筆 `messages` 是休閒房內聊天，與本需求無關。）

```
let tChatShowChat = $state(true);
let tChatShowSys  = $state(true);
const tChatFiltered = $derived(
  (tChatShowChat && tChatShowSys) ? tChat
    : (!tChatShowChat && !tChatShowSys) ? []
    : tChat.filter((m) => (m && m.sys) ? tChatShowSys : tChatShowChat)
);
```

⚠ 效能：預設（都勾）**直接回傳原陣列**，不配置新陣列、不走訪任何一則
⇒ 對絕大多數玩家的成本是零。守衛用 `assert.strictEqual(out, MSGS)` 鎖住這條快路徑。

兩處畫面（大廳 `.tourn-chat` 與對戰中浮動面板 `.chat-panel`）共用同一組狀態與同一個 derived，
`{#each}` 的 key 維持 `m.id`。都不勾時兩處都給提示文字，不會變成一片空白。

#### 兩個容易漏掉的接線

1. **自動捲的依賴**：BASE L1549 的 `$effect` 只依賴 `tChat.length`。切換篩選時原始長度不變
   ⇒ 不重捲 ⇒ 畫面停在半空。改成依賴 `tChatFiltered.length` ＋ 兩個旗標。
   浮動面板那邊（BASE L1454-1465）的條件是 `tChat.length > tLastSeenChat`（有未讀才捲），
   切換篩選同樣不成立 ⇒ 另加一個**只依賴兩個旗標**的 `$effect`（收訊息時不會多跑）。
2. **未讀計數不能動**：`chatFabUnread`（BASE L1301）維持用未篩選的 `tChat.length`，
   否則被篩掉的訊息會永遠標不掉已讀。守衛用逐字比對鎖住那一行。

#### ⚠ 浮動面板的拖曳

`.chat-panel-header` 綁了 `onpointerdown/move/up` 且 CSS `touch-action: none`。
勾選框比照既有的關閉鈕加 `onpointerdown={(e) => e.stopPropagation()}`，否則手機上一按
就變成在拖視窗、勾不動。另外那個 `<span>` 必須帶 `role="group"` ——
`pointerdown` 在 svelte 的 `a11y_no_static_element_interactions` 名單內，不加會多一個 warning。

### 驗證

`scripts/test-v6252-tourn-fold-and-chat-filter.mjs`：27 項 ＋ 6 個突變。
刻意**完全不做字串存在性檢查**（v6.154 的教訓：22 條守衛全綠、分頁根本打不開）：

- 用 `svelte/compiler` 的 `parse()` 取真 AST；
- 把真的 `tEvOpenBy` / `tEvOpen`（`$derived.by`）/ `tChatFiltered`（`$derived`）
  用 `typescript` 轉出 JS 後 **實跑**；
- 把模板的 `{@const _evOpen}` / `{@const _bkId}` / `{@const _bkOpen}` 表達式原文抽出來
  **實跑**（這才驗得到「接線有沒有接上」）；
- 用 AST 斷言 `{@render myMatchBox()}` 真的落在 `{#if _bkOpen}` 的 true 分支內，
  再把上面算出來的值餵進去 ⇒ 端到端證明「輪到我進場＋手動摺疊」時進場鈕仍畫得出來。

⚠ 寫守衛時自己踩到一個坑：**Svelte 5 的 `Fragment` 節點沒有 `start`/`end`**，
`src.slice(undefined, undefined)` 會回**整個檔案**，`includes()` 於是永遠成立 ⇒ 兩項假 PASS。
改用 `nodeRange()`（走訪子節點取 min/max）之後才抓到真的內容。

HEAD-FAIL（對 BASE blob `000a886c` 跑）：**24 FAIL / 3 PASS**，而且是各項各自紅、不是單一 crash
（extraction 一律延遲建構）。那 3 項 PASS 是刻意設計的「不可破壞」鎖：
名人堂摺疊未動、`chatFabUnread` 逐字未變、休閒房內聊天未動 —— 它們在 BASE 上本來就該綠。

突變 6 個，各自紅在指定那一條：
拿掉強制展開→A③；預設規則反向→A①；模板 `_bkOpen` 改 fail-closed→A⑧；
篩選判準改看 `m.admin`→B③；`{#each}` 改回 `tChat`→B⑥；進場鈕搬出摺疊分支→A⑨。

`svelte/compiler` 對 `game/+page.svelte` 編譯成功，**warning 98 個，與 BASE 完全相同**
（含 `css_unused_selector` 7 個未增加 ⇒ 新加的 CSS 選擇器全部有對上，
`.chat-panel-header .tchat-filter` 這種跨 `{#if}` 的後代選擇器也有對上）。

### 部署

只動前端（`src/routes/game/+page.svelte`）＋ 版本號 ＋ changelog。
**沒有動 `static/cards`、沒有動引擎、沒有動 `oracle-admin/server_admin_patch.js`**
⇒ `update-tournament.bat` 這一版不需要跑；`redeploy-oracle.bat` 需要（主站前端在 VM 的 nginx）；
`update-admin-full.bat` 因為 `oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 有同步而需要跑。

## v6.251 — v6.250 的三個漏網：保母蟲｜治癒襁褓、變化之書、琉琪亞的展示（＋ lint 擴充）

獨立審查者複驗 v6.250 後找到的。v6.250 把「場上視角的【基礎】寶可夢」收斂到中央述詞
`isBasicPokemonOnField`（`src/lib/game/selection-filter.ts`），並附了一條 lint ——
**但那條 lint 只掃 `.stage === 'Basic'`**，而這三個漏網全部躲在
`supertype === 'Pokemon' && !evolvesFrom` 這個**等價樣式**底下，一個都沒被抓到。

### 二分法紀律（官方 `PTCG RULES/PTCG_RULES.json` 的 `qa[].id`）

- 手牌／牌庫／棄牌區視角 → `isBasicPokemonCard`（id 789／795／572：化石在這些區域是**物品**卡）
- 場上 instance 視角 → `isBasicPokemonOnField`（id 783／787：化石放到場上就是【基礎】寶可夢）

### 漏網① 保母蟲｜治癒襁褓（`effects/cards/v2620_i_wave12_misc5.ts`）

卡面：「將自己的所有【基礎】寶可夢各恢復『100』HP。」——純場上視角。
原本手刻 `c.supertype === 'Pokemon' && !c.evolvesFrom`，化石那張卡是 `Trainer` ⇒ 直接跳過。
實測（BASE blob）：自己備戰的化石 `damage 50` → 打完仍是 `50`。
這**直接違反官方 id 783**（「使用保母蟲的招式『治癒襁褓』，可以恢復作為[基礎]寶可夢放置於場上的
物品卡『陳舊的羽毛化石』的HP嗎？」→「可以。」）—— 而 id 783 正是 v6.250 自己寫進中央註解當依據的那一則。

### 漏網② 變化之書（`effects/cards/items_misc.ts`）

這張卡**一張卡跨兩個視角**：
- 「從自己的**棄牌區**選擇1張【基礎】寶可夢**卡**」→ 卡片視角（官方 id 795）→ 維持 `isBasicPokemonCard`
- 「與自己的**場上**的1隻【基礎】寶可夢互換」→ 場上視角 → 改走 `isBasicPokemonOnField`

原本場上那半有一份本地 helper `isBasicOnField`（同檔案內），
**只因為名字和中央述詞不同（`isBasicOnField` vs `isBasicPokemonOnField`）就躲過 lint** ——
這正是長期記憶裡「本地版遮蔽中央版」的溫床。已刪除，改成
`changingBookFieldTargetIids(st, idx, pool)` 直接呼叫中央述詞。

順帶抓到兩件事：

1. **`filterBasic: true` 是死參數**。step1 的 pending 傳了它，但**全站沒有任何消費點讀這個欄位**
   （`bench-choose` 的候選＝`fieldPickerBaseCandidates` ∩ `params.validIids`，UI／AI／engine 消毒閘三端皆同）
   ⇒ picker 會列出場上**所有**寶可夢，玩家選到進化寶可夢時只會被 step2 的防呆靜默取消。
   改成宣告 `validIids`（v6.109「看得到 === 勾得動」）。
2. ⚠⚠ **`fossilOnField` 會外洩**。互換是 `{ ...fieldTarget, cardId: 新的 }`，
   場上目標一旦可以是化石，換上去的真寶可夢就會繼承 `fossilOnField: true`
   ⇒ 變成一隻「HP 恆 60、不能撤退、不會中特殊狀態」的假化石（v5.993 transient 旗標再入場外洩同型）。
   已顯式 `fossilOnField: undefined`。**這是修 A 之後才生出來的 B，如果只照審查者的清單改就會踩到。**

### 漏網③ 琉琪亞的展示（`effects/cards/v172_hij_batch.ts`）

卡面：「選擇1隻對手的**備戰區**的【基礎】寶可夢，與戰鬥寶可夢互換。」——場上視角。
gate 與 picker 兩處都用了 `isBasicPokemonCard`。

同段兩行 `if (c.fossilOnField && …'陳舊的鰭之化石') return false;` 是**永遠到不了的死碼**
（`isBasicPokemonCard` 對化石那張 Trainer 卡先回 `false` 就 return 了）——
反過來說也證明原作者本來就以為化石選得到。改判準後那兩行只是
`isImmuneToOppSupporter` 的重複（該 helper 首行 v3.21 起就在判鰭之化石），故一併刪除；
守衛用行為端斷言「鰭之化石仍被排除」鎖住這件事不會因為刪除而破功。

連帶把 `import { isBasicPokemonCard } from '../../engine';` 刪掉（該檔已無其他用途），
少一條 `cards/* → engine` 的循環邊；改從 leaf 的 `selection-filter` 取 `isBasicPokemonOnField`。

### 重新枚舉：沒有第 4、第 5 個漏網

以 `git archive f3c2008d`（＝遠端 main）的樹重新枚舉 live H/I/J 卡面出現「【基礎】寶可夢」的
招式 `effect`／特性 `effect`／訓練家與能量 `rulesText`，共 **78 組**，逐張 diff。
場上視角的全部確認過，另外**特別複驗**了審查者清單上沒有的兩張：

- **神奇糖果**「放置於自己的場上的**可進化成那隻寶可夢的**【基礎】寶可夢身上」—— 實作走
  `canEvolveOnto(basicName, 場上那張的 name)` 的**逐字卡名比對**，不是【基礎】判定。
  資料面查證：`陳舊的顎之化石 → 寶寶暴龍 → 怪顎龍` 等 8 條化石進化線都在 live 卡池裡，
  所以這是真的會發生的情境，而實作**本來就正確**（官方 id 744 亦明示化石可被進化）。
- **壯偉碩木**「從自己的場上的1隻【基礎】寶可夢進化而來的【1階進化】寶可夢卡」—— `baseNames`
  取場上所有寶可夢的卡名（含化石），filter 要求 Stage1 的 `evolvesFrom ∈ baseNames`，
  同樣是卡名比對 ⇒ **本來就正確**。

另外查證了審查者已排除的那幾張，結論一致：
投擲猴｜聯合投擲（`countOwnPokemon` 不濾 `supertype`，否定式寫法**意外正確**）、
稜鏡能量（`hostIsEvolution` 否定式，意外正確）、激動競技場（早已中央）、
6 張「不受【基礎】寶可夢招式的傷害」與尾甲／原始根／障礙踩踏（化石沒有招式）、
天空徑線／棉花搬運（化石無法撤退）、抵抗之幕／火箭隊的蘭斯（要求卡名含「火箭隊的」）、
皇冠蛋白石、奧密之眼（問的是「進化」，化石 `stage=null` 正確地不算）。

⚠ 但「意外正確」＝下一個人改判準就會壞掉，所以還是把兩處改成明確走中央述詞（結果完全相同）：

- `effects.ts` 投擲猴｜聯合投擲 → `countOwnPokemon(state, aIdx, pool, (c, i) => isBasicPokemonOnField(i, c))`
- `effects.ts` `defCantAttackIfSubtypePost('basic')`（帕底亞 肯泰羅｜障礙踩踏）→ `isBasicPokemonOnField(def, card)`
  （化石沒有招式 ⇒ 對局結果零差異，但原本會對化石印出「對手不符合條件」的錯誤 log。）

### lint 擴充（`scripts/test-v6251-basic-on-field-followups.mjs`）

v6.250 的 lint 只掃 `.stage === 'Basic'`。新增兩種樣式：

- **樣式 A**：`!x.evolvesFrom`（用「有沒有進化來源」判【基礎】）。
  `(?<!!)` lookbehind 排除 `!!x.evolvesFrom`（那是「是不是進化」，不是本維度）。
  現況 27 筆全部列入白名單並逐筆寫理由（牌庫／手牌／棄牌區視角、進化判定、
  或雖是場上視角但已查證對化石無行為差異）。
- **樣式 B**：**名稱含 `Basic` 的本地述詞定義**（就是 `isBasicOnField` 那種同義本地版）。
  19 筆白名單，多數是「基本**能量**」的 helper。

兩條都配：**下限斷言**（`.ts` 檔數 > 100、掃描行數 > 70000、樣式 A 命中 ≥ 25、樣式 B 命中 ≥ 15）、
**白名單死條目檢查**、**正對照**（把三個漏網在 BASE 上的原始碼片段餵進去，必須被抓到；
並確認不會誤抓中央述詞用法與 `!!x.evolvesFrom`）。

⚠ 誠實記錄：樣式 A **抓不到**變化之書 step2 那種「**肯定式**」寫法
（`if (fieldCard.evolvesFrom) 拒絕`）。守衛裡把這件事寫成一條明示的紀錄，
並靠樣式 B 與行為端測試補上 —— 單一靜態樣式一定有洞。

### 【5】嗡嗡榍石守衛的安慰劑

`scripts/test-v6250-basic-on-field-central.mjs` 原本那條只斷言
「log 裡沒有出現『對手戰鬥場非基礎』」—— **硬幣反面時它恆真**（反面走的是備戰那一支，
本來就不會印那句話）。實測：把 `嗡嗡榍石` 改回卡片視角後跑 6 次，舊斷言只紅 1 次。
修法：覆寫 `Math.random` 固定正面 + 斷言化石**真的被昏厥**，並加一條 Stage2 的正對照。
同樣的突變下新斷言 **6/6 紅**；未突變時連跑 10 次 **10/10 綠**。

### 【7】時間炸彈

`scripts/test-v6248-selfheal-followups.mjs` 原本寫死「v6.248／v6.181 必須在首頁／封存」，
再過 50 版一定會紅。改成不綁版本的等價條件：首頁 50 則版本號嚴格遞減，
且封存頁必須存在比首頁最舊那一則更舊的紀錄（＝「搬進封存」而不是「被刪掉」仍然被鎖住）。

### 【8】巢穴球的死變數

`items_misc.ts` 巢穴球算了一個 `hasBasic` 卻沒有任何人讀，而且用的是
`subtype === 'Basic'`（會被 `ex` 覆蓋、漏掉所有基礎 ex）。死變數＋錯判準留著遲早被抄走，刪掉。

### ⚠ 對【6】的更正（審查者這一條說錯了）

審查者說「v6.250 那則 changelog 只講險惡廢墟」。實際去讀 `static/changelog.html`：
v6.250 的 `log-body` **已經**逐張列出了貪婪食客／嗡嗡榍石／揚沙／斧擊衝撞，
也明說「依官方裁定，化石放到場上時就是一隻【無】屬性的【基礎】寶可夢…上述四個效果也照樣對化石生效」。
所以那一則沒有問題，不去改它（封存規範也是舊條目維持原始敘述）。
v6.251 另開一則講這一版新修的三張卡。

### ⚠ 本輪發現但**不動**的東西（留待後續，避免混入本維度）

1. **「陳舊的鰭之化石不受對手支援者卡影響」在現行台灣卡面上不存在。**
   `static/cards/M3` id 18046 的 `rulesText` 只有「不會陷入特殊狀態，無法撤退」。
   站內從 v2.388 起就給它這個被動（`engine.ts` L921 名單、`supporters_gust.ts`、
   `v3080_deferred_wave_c.ts` 的 `isImmuneToOppSupporter` 首行），出處疑似舊版／日文預覽卡面
   （同 v6.112 的化石 HP 事故）。這牽涉多個檔案與玩家可見行為，**本輪不動**，
   守衛裡放了一條卡面斷言，官方哪天真的加回來時會紅。
2. **`applyStatusToOppActive` 沒有化石狀態免疫的 early-return**。
   琉琪亞的展示把化石換上場後仍會 log「陷入【混亂】」，只是
   `engine.ts` 的 `applyAction` 出口 sweep 會把狀態清掉 ⇒ 盤面正確、**log 誤導**。
   屬「狀態施加」維度，本輪不動（守衛已斷言盤面正確）。
3. **爆炸頭水牛｜捲牆對化石不生效**，卡住的是「【無】屬性」那半（化石 `pokemonType=null`）
   ⇒ 屬 v6.206／v6.208 的屬性維度待辦。

### 部署提醒

改到卡片效果與 `effects.ts`／`engine.ts` 無關檔案以外的部分 ⇒
Wilson 需要跑 `update-tournament.bat` ＋ `redeploy-oracle.bat`（＋ `update-admin-full.bat`）。

## v6.250 — 「場上視角的【基礎】寶可夢」收斂到中央述詞 isBasicPokemonOnField（5 個 outlier）

站長回報：場上有**險惡廢墟**時，把**烈箭鷹ex**（Stage2 進化）用特性「激動俯衝」放到備戰區，
被放了 2 個傷害指示物。

### 真因

`effects/_shared.ts` 的 `applyBenchPlaceSideEffects` **只濾【惡】屬性、完全沒判【基礎】**
（`if (!card || card.pokemonType === 'Darkness') return c;`）。
v5.866 起的中央管線（`engine.ts` `applyRuggedRuinsBenchPlace`，由 `applyAction` 出口以
before/after 新 iid 差分偵測）本身是好的 —— **壞的是它呼叫的述詞**。

### 修法：中央述詞下沉 + 5 個消費點全部改接

`isBasicPokemonOnField(inst, card)`（v6.112 建立於 `engine.ts`）**下沉到
`src/lib/game/selection-filter.ts`**（純 leaf，只 import types；`effects/_shared.ts` 早就
從它 import `isMegaExCard` ⇒ 零循環風險），`engine.ts` 改 re-export。
比照 v6.018 `isBasicPokemonCard` 下沉的先例。
⚠ 下沉後跑了 **5 種 module 評估順序**的實跑 TDZ 探針（`_shared` 先 / `effects` 先 /
`engine` 先 / `selection-filter` 先 / 卡片子檔先），5 種都成功載入且
`TRAINER_EFFECTS=237`、`ATTACK_POST=1185`（模組初始化沒有中斷）。

| # | 卡／效果 | 舊寫法 | 症狀 |
|---|---|---|---|
| 1 | 險惡廢墟 | 只判 `pokemonType === 'Darkness'` | **任何**寶可夢放到自己備戰都吃 20 |
| 2 | 三首惡龍ex｜貪婪食客 | `isBasicPokemonCard(defenderCard)` | KO 對手的**化石**不給 +1 獎賞 |
| 3 | 阿羅拉 椰蛋樹ex｜嗡嗡榍石 | `card?.stage !== 'Basic'` ×2 | 對手場上化石被判「非基礎，無效」 |
| 4 | 火箭隊的班基拉斯｜揚沙 | `supertype !== 'Pokemon'` 直接 false | 對手場上化石不吃 2 個指示物 |
| 5 | **雙斧戰龍｜斧擊衝撞** | `stage !== 'Basic' && subtype !== 'Basic'` | 對手戰鬥場化石被判「非基礎」 |

⚠ 第 5 條是這一版**自己掃出來的**（前置調查沒有列），而且
`PTCG RULES/PTCG_RULES.json` 的 **id 787 就是這張卡的官方裁定**：
「使用雙斧戰龍的招式『斧擊衝撞』，可以將作為[基礎]寶可夢放置於對手戰鬥場上的物品卡
『陳舊的羽毛化石』[昏厥]嗎？ → **可以**。」原實作直接違反它。

### ⭐⭐⭐ 二分法紀律（寫在 `selection-filter.ts` 的函式註解裡）

| 視角 | 述詞 | 化石算不算【基礎】寶可夢 | 官方裁定（`PTCG_RULES.json` 的 `qa[].id`） |
|---|---|---|---|
| 手牌／牌庫／棄牌區 | `isBasicPokemonCard` | **不算**（是物品卡） | 789 禿鷹娜／795 保母曼波溫柔鰭／572 配樂之笛 |
| 場上 instance | `isBasicPokemonOnField` | **算** | 783 治癒襁褓可恢復化石 HP／787 斧擊衝撞可 KO 化石 |

⚠⚠ 修險惡廢墟時若圖方便寫成 `isBasicPokemonCard(card)`，會把**化石一起關掉** ——
與 v6.145「中央閘把化石判成進化」是同型陷阱。守衛的矩陣第 (5) 條就是釘這個。
⚠⚠ **禁用 `subtype === 'Basic'` 判【基礎】**：`subtype` 會被 `ex` 覆蓋。實測 live H/I/J：
`Basic|ex` 338 張（會被漏掉）、`Stage2|ex` 150 張（會被誤放，烈箭鷹ex 正是這類）。
另實測 `stage === 'Basic'` ⟺ `!evolvesFrom` 在 live H/I/J **零歧異**（2226 = 2226）。

### ⚠ 現況鎖：放到「對手」備戰區不觸發險惡廢墟

站長裁定**維持現行行為**（卡面「每次在**自己的回合**將…放置於備戰區時」，本站解讀為
「自己的回合、自己的備戰區」）。`applyRuggedRuinsBenchPlace` 只掃 `before.activePlayerIndex`
一側的邏輯**沒有動**，但補上了明示註解，並在守衛裡加三條鎖：
行為（配樂之笛把基礎放到對手備戰 → 對手那隻 damage=0）、
靜態（不得改成雙側掃描、註解必須寫明裁定）、
枚舉（卡面「放置於對手的備戰區」的 H/I/J 卡**剛好 5 張**：勾魂眼／莉莉艾的蝶結萌虻／
禿鷹娜／大舌頭／配樂之笛，上下限都斷言）。

### 守衛 `scripts/test-v6250-basic-on-field-central.mjs`（30 條，已進 npm test）

- ① 4+1 張卡的**卡面逐字**複驗（全部讀 `static/cards`）＋資料面斷言（stage 恆有值、
  `stage==='Basic'` ⟺ 無 `evolvesFrom`、`subtype` 被 ex 覆蓋 > 100 筆）。
- ③ 險惡廢墟 **7 項矩陣**：Stage2 ex 不放／Stage2 不放／Basic 放 20／Basic+subtype=ex 放 20／
  化石放 20／【惡】不放／鬼之假面互換（保留 iid）不放。
- ⑤ 另外 4 個 outlier 的行為端，**每一條都配正對照**（Stage2 不得被誤判成【基礎】）。
- ⑥ **lint**：全站 `src/lib/game/**` 剝註解後掃 `.stage === 'Basic'`；
  非場上視角的 10 筆走**逐行內容比對**的白名單（每筆註明視角與官方裁定），
  其餘必須為 0。配三道防安慰劑：下限斷言（檔案 > 100、行數 > 70000、命中數 ≥ 白名單筆數）、
  **白名單死條目檢查**（寫法一改就紅，防止白名單變成隱形通道）、
  正對照（餵 3 個違規樣本必須被抓到、2 個中央述詞用法不得誤抓、
  註解裡的舊寫法不得誤報、剝註解不得把程式也吃掉）。

### 驗證

- **HEAD-FAIL**（對 BASE `4bd11bb2` 的乾淨 tree 跑）：`PASS 19 / FAIL 11`，
  5 個 outlier **各自各一條紅**（不是單一 crash）。修後 `PASS 30 / FAIL 0`。
- **突變測試** 4 組，各自只紅在預期那一條：
  ① 險惡廢墟改用 `isBasicPokemonCard` ⇒ 只有矩陣第 (5) 條「化石放 20」紅（化石陷阱被抓到）；
  ② 揚沙回到手刻 ⇒ 揚沙紅＋lint 紅 1 處；
  ③ 險惡廢墟拿掉【基礎】判定 ⇒ 矩陣 (1)(2) 紅；
  ④ 斧擊衝撞回到手刻 ⇒ 斧擊衝撞紅＋lint 紅 1 處。
- 免疫網：`test-damage-immunity-matrix` 25/0、`test-attack-effect-immunity-matrix` 19/0。
- 回歸：`test-rugged-ruins-bench-place-central` 4/0、`test-v6112-fossil-hp-bonuses` 15/0、
  `test-selection-ui` 35/0、`test-ts2304-scan` 無、`test-m6-wave13` 15/0、
  `test-v6098-hand-ability-ui-central` 18/0。
- `tsc --noEmit -p .`：與 BASE **完全同一組 91 筆基線錯誤**（只有行號位移），新增 0 筆、**TS2304 = 0**。
- 效能：述詞是兩行純函式（`inst?.fossilOnField` 早退 + 一次欄位比較），
  險惡廢墟那條只在該場地在場時才會走到（helper 開頭就 no-op 早退）⇒ 玩家端零額外成本。

### ⚠ 沒有動的東西

- 「放到對手備戰不觸發」的單側掃描邏輯（現況鎖）。
- 進化（保留 iid）、鬼之假面互換（`effects.ts` 保留 iid）—— 守衛第 (7) 條實測沒有誤觸發。
- 手牌／牌庫／棄牌區視角的卡（溫柔鰭／配樂之笛／禿鷹娜／大舌頭／莉莉艾的蝶結萌虻／
  鳳王復生火焰／哲爾尼亞斯大地之門）—— 全部維持 `isBasicPokemonCard` 語意，並進了 lint 白名單。
- **超能豔鴕｜奧密之眼**：前置調查把它歸為「棄牌區／手牌視角」，實際上是**場上視角**，
  但它問的是「**是不是進化**寶可夢」（`card.stage && card.stage !== 'Basic'`），
  化石 `stage` 為 null ⇒ 正確地不算進化 ⇒ **現行行為正確，這一版不動**，只進白名單並註明理由。
- v6.245~v6.249 的休閒同步改動：零接觸。

## v6.249 — 獨立審查者複驗 v6.248：退避參數過猛、streak 語意誤述、25 分鐘 fail-safe、兩處守衛安慰劑

v6.248 上線後由**獨立對抗性審查者**複驗：正確性沒有回歸（34 條全綠、突變全捕捉），
但**不同意兩個參數**，並抓到**兩處守衛安慰劑**。這一版逐條處理，每一條都先自己複驗過才動手。

⚠ 首頁 changelog **沒有寫**：這一版是參數微調＋守衛修正，玩家在正常對局裡看不到差異。

### 【1】`RESYNC_MAX_MS` 60 秒 → **20000**（審查者的數字我全部複驗成立）

量測腳本 `scripts/perf-v6249-resync-backoff-forfeit.mjs`（虛擬時鐘、5 秒 interval、
抽 `+page.svelte` 真的 interval body 與 `sync-guards.ts` 真的純函式；三個對照組都是
**對同一份原始碼做字串突變**，不是另外手寫模型）。t=0 是最後一次 `game.log` 變動：

| 版本 | 重訂閱時刻（秒） | 300 秒次數 | 180 秒窗內 | 最壞脫困延遲 | **致命區間** |
|---|---|---|---|---|---|
| v6.247 固定 8 秒 | 10,20,…,300 | 30 | 18 | —（基準） | 0 s |
| v6.248 上限 60 秒 | 10,20,30,50,85,145,205,265 | 8 | 6 | **55 s**（R=86s：base 90 → head 145） | **35 s**（R=146~180） |
| 候選 上限 20 秒 | 10,20,30,50,70,90,…,290 | 16 | 10 | 10 s | 10 s（R=171~180） |
| **v6.249 出貨** | 10,20,30,50,70,90,110,130,150,**160,170,180**,200,…,300 | 18 | 12 | 10 s | **0 s** |

- 實作者宣稱的「慢 0~30 秒」是錯的；審查者的 55 s / 18→6 / 35 s 三個數字**逐一複驗成立**。
- 站長已裁定「卡住方判負」⇒ 那 35 秒寬的區間等於「從被救回變成輸掉」。
- ⚠ 只調成 20 秒**還不夠**：仍留下 R∈(170,180] 這 10 秒寬的淨退步（v6.247 救得到、它救不到）。
  ⇒ 再加一道【最後救援窗】（見下），逐秒掃 R=1..300 之後致命區間 **10 s → 0 s**。

### 【最後救援窗】`casualResyncInLastChance(sinceLastActionMs, forfeitThresholdMs)`

距離棄權門檻只剩 `RESYNC_LAST_CHANCE_MS = 30000` 以內時，退避讓路、回到 8 秒全速。

- ⚠⚠ 只**讀** `thresholdMs` 與 `_lastActionAt`（棄權倒數用的同一個時鐘），不寫 `oppInactivityWarn`、
  不改門檻算式、不碰 `claimOpponentForfeit` ⇒ **棄權三處逐字不變**（守衛有字面＋行為兩層）。
- ⚠ 上界用**閉區間 `<=`**：過了門檻仍全速的話，300 秒會回到 24~30 次，退避等於白做
  （突變測試 3 專門證明這一點）。
- ⚠ 關閉這道窗做對照時**必須把常數設 -1，不可設 0** —— 閉區間在 `since === threshold`
  那一格仍然成立，會憑空多一次 t=180s 的重訂閱，把對照組的致命區間洗成 0（我第一版就被騙過）。
- 代價：每次卡住多 2~4 趟全量房間 GET，只發生在「已經卡住而且即將輸掉」那條線上；
  300 秒總量仍是 30 → **18**（比 v6.247 少四成）。健康路徑請求數 **0 次，逐字不變**。

### 【2】審查者說「下一次卡住第一發仍是 8 秒不成立」——**成立**；但他建議的修法**無效**

- ⭐ 他是對的：`_resyncStreak` 只在「`game.log` 有變動」時歸零，而**對手長考本身就沒有 log 變動**
  ⇒ 對手想超過 30 秒 streak 就已經 ≥3。v6.248 寫在 `+page.svelte` 的那段註解是錯的，已更正。
  實跑（守衛 `[HEAD-FAIL④]`）：對手長考 100 秒後斷線 ⇒ 第一次救援 v6.247 是 110s、
  **v6.248 是 145s**、v6.249 是 110s。
- ⚠⚠ 但他建議的「只在**真的做了重訂閱卻沒有換來進展**時才累加」**改不掉這件事**，而且我把它
  實際換上去跑過：時間軸**逐格相同**（量測腳本第 ③ 段、守衛 `[HEAD-FAIL⑤]`）。
  真正的原因是：對客戶端而言「對手在長考」與「我收不到了」是**同一個可觀測狀態**
  （房間版本一樣、重訂閱一樣抓不到新東西、對手心跳一樣新鮮），
  「重訂閱沒換來進展」在**兩種情況下都成立** ⇒ 那個條件恆為真。
  ⇒ 正確處理是「承認起跑點可能已經很高」，把上限壓低＋加最後救援窗，**不是**改累加規則。
- 新增守衛：**從 streak≥3 起跑**（L=40/100/140/170 秒的長考尾聲斷線）——
  現有的「短暫卡 30 秒」正對照是從 streak=0 起跑的，蓋不到這個情境。

### 【3】在途 fail-safe：1,500,750 ms（25.01 分鐘）→ **240,000 ms（4 分鐘）**

`ORACLE_TX_MAX_TOTAL_MS` 是「五輪全 409 × 每發 401 重登 × 每發用滿預算」的**數學最壞值**，
比 3 分鐘棄權門檻大 **8 倍** ⇒ 有 bug 時玩家先輸掉、fail-safe 才動＝等於沒有 fail-safe。
（佐證：v6.247/6.248 的突變測試必須把上限偷換成 40 秒才驗得動這個機制。）

取值依據（Rule 37：必須大於實測過的最慢**成功**案例）：
① nginx log 實測最慢的成功推送是 **86.954 秒**（48KB PUT）；
② `oracleTx` 允許 409 重試 ⇒ 實務最壞 ≈ 2 輪 ×（GET 幾秒 + PUT 87 秒）≈ **184 秒**；
③ 取 **2 × `ORACLE_API_TIMEOUT_MAX_MS` = 240,000 ms** ＝「容得下連續兩輪的大 PUT」，
   對 ① 有 2.76 倍餘裕、對 ② 有 1.30 倍，且只有棄權門檻的 **1.33 倍**（不是 8 倍）。

⚠⚠ **誠實記錄取捨**：超過 240 秒才送達的推送，保護會到期，那一手可能被 force-adopt 退回攻擊前
（實測時間軸 `t=250s 11→10 , t=300s 10→11`）。守衛 `[取捨邊界/v6.249]` 把它**明寫成一條測試**，
並斷言「盤面最後仍收斂回玩家打完的那一手」（不會永久遺失）。線上從來沒觀測過 >120 秒的成功推送。
⚠ 常數搬到 `oracle-client.ts`（見【5】）；`ORACLE_TX_MAX_TOTAL_MS` 保留，作為註解與守衛的推導依據。
⚠ 突變測試 6 **不再需要偷換上限**（改成用真常數 + 拉長觀測窗到 3 個上限週期）。

### 【4】兩處守衛安慰劑（審查者抓到，實測成立，這是最傷的）

`scripts/test-v6248-selfheal-followups.mjs`：

1. **L146** `/…/.source ? A : null` 是**恆真三元**（`.source` 永遠是非空字串）＝死碼。
2. 那一整條 `[HEAD-FAIL①]` **從頭到尾沒有求值過 `ORACLE_TX_MAX_TOTAL_MS`**，
   只比對三個分量常數，最後一條斷言在前兩條成立後是恆真的。
   **實測：把 `* (1 + ORACLE_API_MAX_AUTH_RETRIES)` 從運算式刪掉，34 條照樣全綠。**
3. harness 第 245 行 `PUSH_INFLIGHT_FAILSAFE_MS: o.failsafeMs ?? 1500750` 把上限寫死
   ⇒ 出貨碼改了值，模擬世界也照舊。

修法：新增 `evalConsts(src, names)` —— 把 `export const NAME = <運算式>;` 從原始碼取出來
**實際求值**，再拿執行結果比對。harness 改讀真常數。
**突變複驗：刪掉那個乘數 ⇒ `FAIL … ORACLE_TX_MAX_TOTAL_MS 求值 = 750750，但推導 = 1500750`。**

### 【5】隱性耦合：`PUSH_INFLIGHT_FAILSAFE_MS` 的宣告位置

它必須留在 `const PUSH_RETRY_MAX = 3;` **之前**，否則會落進 `test-v6245:509` 的
pushWithRetry 抽取視窗、在沙盒裡被求值。**實測**把它移到後面：v6245 由 30 PASS 變
**28 PASS / 2 FAIL**，訊息是 `ORACLE_TX_MAX_TOTAL_MS is not defined`（完全指不到真因），
而 v6.248 的 34 條**全部照綠**。

修法有兩層：
- 結構上根除：常數搬到 `oracle-client.ts`（它本來就是那邊推導出來的協定常數），
  視窗內再也沒有「需要外部識別字的模組層級 const」。
- 補守衛 `[HEAD-FAIL⑧]`：**實跑**那個抽取視窗（同一組錨點），求值失敗時的訊息直接說出真因
  與修法；另有正對照 `[HEAD-FAIL⑧b]`（塞一個壞 const 進去必須翻紅）。

### 【6】枚舉邊界寫成**明示例外**

掃 `room-oracle.ts` 裡每一個寫入**非 null** `gameState` 的 export function，共 **6 處**，
每一處都要在守衛的 `DISPOSITION` 表裡有處置：

| 函式 | 處置 | 理由 |
|---|---|---|
| `pushGameState` / `pushUndoRollback` | **tracked** | 走 `pushTracked()` / `pushUndoTracked()` |
| `startGame` | 明示排除 | `createGame` 產的是 `phase==='setup'` 的新局，`setupDone=[false,false]` 時 `isWaitingOnOpponent` 回 false ⇒ 那一輪走不到自癒；force-adopt 的採用端也明文拒收 `setup`；另有 v5.492 canonical 保護與 v6.055 看門狗 |
| `checkAndAcceptRestart` | 明示排除 | 同上；而且換局的 `$effect` 會 `_resetPushTracking()`，追蹤它**反而**會壓住新局的自癒 |
| `claimOpponentForfeit` / `leaveRoom` | 明示排除 | 寫的是終局盤面 + `status:'ended'`，屬於站長裁定「一行都不准動」的棄權語意；終局後沒有回捲可言 |

⚠ 掃描器**不可**寫成 `/gameState:\s*(?!null)/` —— `\s*` 會回溯到零長度，`gameState: null`
照樣命中（實測：`createRoom` / `checkAndAcceptRematch` / `checkAndAcceptReturnToRoom`
三個「清盤面」的函式全被誤收）。改成逐處抓出後面接的是什麼再判，並有兩條反對照。
另有 `[HEAD-FAIL⑨b]`：**排除的前提**要真的成立（行為端驗 `isWaitingOnOpponent(setup 新局)===false`、
原始碼驗 force-adopt 採用端仍判 `phase === 'setup'`）。

### 【7】HEAD-FAIL 的形態

v6.248 的守衛對 v6.247 那棵樹跑會**頂層 throw**（`找不到錨點：function _beginPushTrack(`，L82）
⇒ 整支中止，單一 crash **證明不了「六項各有覆蓋」**。
修法：抽不到錨點時換成「一被使用就丟例外」的**同步**毒藥值（⚠ 不可用 async function，
它的 throw 會變成 unhandled rejection 而炸到 try/catch 之外，我第一版就踩到），
再加一條專門列出所有抽取失敗的自我驗證項。

實測（同一支守衛跑三棵樹）：

| 守衛 | 對 v6.249（HEAD） | 對 v6.248 | 對 v6.247 |
|---|---|---|---|
| `test-v6248-selfheal-followups.mjs` | 37 PASS / 0 FAIL | — | **9 PASS / 28 FAIL（各項各自紅，無 crash）** |
| `test-v6249-resync-backoff-and-failsafe.mjs` | 25 PASS / 0 FAIL | **8 PASS / 17 FAIL（各項各自紅）** | — |

⚠ 順帶補了一條 Rule 25 的下限斷言：R-sweep 在兩邊都是空陣列時「致命區間 = 0」是**空真**
（對 v6.248 那棵樹跑時真的假綠過一次），現在先斷言 `SHIP.at.length >= 10 && V247.at.length >= 20`。

### 動到的檔案

- `src/lib/game/sync-guards.ts`：`RESYNC_MAX_MS` 60000→20000；新增 `RESYNC_LAST_CHANCE_MS`
  與 `casualResyncInLastChance()`；更正 streak 語意的註解（【B】段）。
- `src/lib/game/oracle-client.ts`：新增 `PUSH_INFLIGHT_FAILSAFE_MS = 2 * ORACLE_API_TIMEOUT_MAX_MS`。
- `src/routes/game/+page.svelte`：改 import；拿掉模組層級的 `PUSH_INFLIGHT_FAILSAFE_MS`；
  `_resyncGapMs` 接上最後救援窗；更正兩段錯誤／過期註解。
- `scripts/test-v6248-selfheal-followups.mjs`：修兩處安慰劑＋毒藥化＋參數同步（37 條）。
- `scripts/test-v6247-selfheal-inflight.mjs`：注入新述詞、常數改求值、接線斷言跟著搬家（22 條）。
- `scripts/test-v6249-resync-backoff-and-failsafe.mjs`（新，25 條）。
- `scripts/perf-v6249-resync-backoff-forfeit.mjs`（新，量測腳本）。
- `package.json` / `src/lib/version.ts` / `oracle-admin/admin.html`。

### 站長要跑的 bat

- 測試站綠燈後：`redeploy-oracle.bat`（前端；主站是 VM 的 nginx，不是 Pages）。
- `update-admin-full.bat`（可離峰再跑）：只為了讓 admin 的 `SITE_VERSION_HINT` 對上 6.249，
  不跑不影響玩家。⚠ 它會 `pm2 restart`，請避開比賽時段。
- 這一版**沒有動**伺服器邏輯（`oracle-admin/server_admin_patch.js` 一個字都沒改），
  不需要 `update-tournament.bat`。


## v6.248 — 獨立審查者複驗 v6.247 的六個問題（在途上限假陰性／逐發計時／中央收斂／重訂閱退避）

v6.247 上線後由**獨立對抗性審查者**複驗，找到 6 個實作者沒提到的問題。這一版逐條處理，
每一條都先自己複驗過才動手（Rule 25：掃描器／審查結論自身要先驗）。

### 【1】自癒仍留在 `isWaitingOnOpponent` gate 底下 —— **決定不拆**（量過才決定）

站長已裁定棄權誤判**不修**（「還是照樣判A輸，畢竟塞住的是A，也有責任」），
所以「拆出來」剩下的收益只有「回合中途讓伺服器早點追上」。量測腳本
`scripts/perf-v6248-split-tradeoff.mjs`（虛擬時鐘實跑真原始碼）：

| 我方回合中途推送失敗 300 秒 | force-adopt | 盤面回捲 | 重訂閱 | 推送 | 伺服器 log |
|---|---|---|---|---|---|
| 現況（有 gate） | 0 | 否 | 0 | 1 | 10（本地 11） |
| 拆掉 gate | 5 | **是** | 12 | 3 | 10 |
| 謹慎版拆法（force-adopt 另外自己判 isWaitingOnOpponent） | 0 | 否 | 8 | 3 | **10（仍沒追上）** |

- 真正會傷害玩家的是「攻擊完、結束回合」那一手 —— 而結束回合後 `activePlayerIndex`
  已經是對手 ⇒ `isWaitingOnOpponent` 為 true ⇒ **那一格 gate 本來就是開的**。
- 回合中途推失敗，下一個動作的推送送的是**更新**的盤面，一發成功就自然覆蓋
  （實測：第一發失敗 server=10/local=11，第二發成功後兩邊都 12）。
- 拆出來的收益是 0（重推被同一條塞住的上行砍掉），成本是多出來的全量房間 GET
  與 48KB 重送，**全壓在已經塞住的那條線上** ⇒ 違反「絕不可讓玩家端變慢」。
⇒ 保持現狀，改成「補守衛鎖住現況＋更正註解」。守衛 `[現況鎖/【1】]` 釘住三件事：
  那一行 gate 還在、8 秒重訂閱在 gate 之後、`_forceAdoptNext = true` 在 gate 之後。

### 【2】v6.247 的在途上限是**假陰性**（120 秒對 >120 秒的在途零覆蓋）

`ORACLE_API_TIMEOUT_MAX_MS`＝**單一發 HTTP 請求**的預算，而一發 `pushGameState` 走
`oracleTx`。真實最壞總時長逐項拆開（每一項都能在原始碼指到）：

| 項 | 出處 | 值 |
|---|---|---|
| 迴圈輪數 | `for (let attempt = 0; attempt < 5; attempt++)` | 5 |
| 每輪 GET | `oracleGetRoom`（無 body ⇒ 基底預算） | 30,000 ms |
| 每輪 PUT | `oracleUpsertRoom`（48KB ⇒ 上限預算） | 120,000 ms |
| 每發請求的 401 重登重試 | `oracleApi` 收到 401 遞迴一次，**新的計時器與預算** | ×2 |
| 409 退避 | `50 * (attempt + 1)` 五輪加總 | 750 ms |

⇒ `ORACLE_TX_MAX_TOTAL_MS = 5 × (30,000 + 120,000) × 2 + 750 = 1,500,750 ms`（約 25.0 分鐘）。
⚠ **401 那一項是 v6.247 與審查者雙方都漏掉的**；只算 GET+PUT 會少算一半。
⚠ 逾時重試（`TX_TIMEOUT_RETRY_MAX`）不會更長：它只在**基底預算**的逾時才走，那一輪的 PUT
  只花 30 秒，換來 1000 ms 退避 ⇒ 總量嚴格小於全 409 的路徑。
⚠ 為什麼不設無限大：標記萬一沒還原，自癒就永遠不動。這是**推導出來的有限值**；
  而且比它更久的卡住一定早就被 3 分鐘的棄權門檻接手（對局不可能真的永遠卡著）。

實測（`scripts/perf-v6248-resync-and-inflight.mjs`，同一支腳本在三棵樹上跑）：

| pushMs | v6.246 | v6.247 | v6.248 |
|---|---|---|---|
| 87 s | `t=30s 11→10 , t=90s 10→11` | 無變動 | 無變動 |
| 120 s | `t=30s 11→10 , t=120s 10→11` | 無變動 | 無變動 |
| **150 s** | `t=30s 11→10 , t=150s 10→11` | **`t=120s 11→10 , t=150s 10→11`** | **無變動** |
| **200 s** | 同上型 | **`t=120s 11→10 , t=200s 10→11`** | **無變動** |
| **300 s** | 同上型 | **`t=120s 11→10 , t=300s 10→11`** | **無變動** |

### 【3】`_pushInFlightSince` 只在 0→1 時更新 ⇒ 重疊推送凍結時間戳

保護會**靜默過期**：舊那一發超過上限後，整個保護就被關掉，即使新那一發才剛起飛。
⇒ 改成 `_pushInFlightMarks: { at }[]`，**每一發各記自己的起始時刻**，
判定＝「有任何一發還在自己的預算內」。守衛 `[HEAD-FAIL④]` 用行為端驗：
A 在 t=0 起飛、B 在 t=100s 起飛，t=150s 時（模擬上限 120 秒）保護必須仍然成立，
t=230s 兩發都過期後必須放行（不可 fail-open）。

### 【4】漏標在途的推送呼叫點：審查者點名 2 處，全站枚舉是 **3 處**

`git grep pushGameState <sha>` / `pushUndoRollback <sha>`（**指定 rev，不用工作樹**）全站枚舉，
`+page.svelte` 共 5 個推送呼叫點：`pushWithRetry`（已標）、自癒重推（已標）、
`merge-setup` advance、祭典樂舞 promote、**悔棋 rollback `pushUndoRollback`**（審查者沒點到）。
⇒ **中央收斂**成 `pushTracked()` / `pushUndoTracked()`，呼叫端一律走它，不再逐處手動加旗標；
守衛用「剝註解後掃裸呼叫」枚舉，斷言**只剩 2 處且都在那兩支 helper 內**（掃描器自身另有正對照）。

### 【5】換局沒有重設在途追蹤

上一局還沒落地的推送最久會壓住新局的自癒 `ORACLE_TX_MAX_TOTAL_MS`。
⇒ 換局的 `$effect` 加 `_resetPushTracking()` 與 `_resyncStreak = 0`。
清空是安全的：真的還在飛的那一發，`finally` 會呼叫 `_endPushTrack()`，`indexOf` 找不到就是 no-op。

### 【6】首頁 changelog 的歸因錯誤

v6.247 那則寫「上一版起…」——**錯的**。休閒 `oracleApi` 在 v6.244 以前**根本沒有逾時**
（`oracle-client.ts` 自己的註解寫「休閒版從來沒治過」），而 25 秒 force-adopt 是 v5.587 就有的，
連線慢時傳送本來就會超過 25 秒 ⇒ **同樣的一退一跳早就存在**，v6.246 只是改變了它的時間點。
⇒ 已更正該則的摘要與內文，並新增 v6.248 那則。首頁維持 50 則，最舊的 v6.181 搬進封存頁。

### 【7】卡住期間的重訂閱變多 —— 接受成因，但加退避（**不削弱脫困能力**）

`oraclePollRoom` 每次重訂閱都把 `lastVersion` 歸 -1 ＝ 多一發**全量**房間 GET。
實測 300 秒（推送 87 秒才送達）：v6.246 **24 次** → v6.247 **30 次**。
⚠ 成因不是「新增了呼叫」，而是 v6.247 讓玩家**不再被回捲** ——
以前那次 force-adopt 會換掉盤面、順手更新 `_lastSyncAt`，等於幫忙壓下了幾次重訂閱。
⚠⚠ 重訂閱是卡住的玩家**唯一的脫困手段**，不可以為了數字好看關掉。
⇒ `casualResyncGapMs(streak)`：前 3 次維持 8 秒（真正有救援效果的窗口逐字不變），
之後 16s→32s→60s（夾在 60 秒），同步一有進展就把 streak 歸零（歸零那一行放在棄權 gate **之前**，
所以我方回合中途也會歸零 ⇒ 下一次卡住時第一發重訂閱仍是 8 秒）。

| 300 秒 | v6.246 | v6.247 | v6.248 |
|---|---|---|---|
| 推送 87 秒才送達 | 24 次 | 30 次 | **8 次**（10, 20, 30, 50, 85, 145, 205, 265 秒） |
| 推送逾時 30 秒 | 5 次 | 9 次 | **6 次** |
| 健康對局 | 0 | 0 | **0** |

### 站長裁定：棄權誤判**不修**

> 還是照樣判A輸，畢竟塞住的是A，也有責任

⇒ `oppInactivityWarn` / 棄權按鈕 / `claimOpponentForfeit` **逐字不變**，
v6.247 的現況鎖保留（仍綠）；v6.248 另加三條字面斷言把棄權門檻與觸發條件釘住。

### 守衛

- `scripts/test-v6248-selfheal-followups.mjs`（**34 條**）：抽取器自我驗證 2、上限推導 2、
  >120 秒行為 3、回歸/正對照 5、重疊計時 2、全站枚舉 2、換局重設 2、退避 3、
  硬約束 2、現況鎖 5、changelog 2、**突變 6**。
- `scripts/test-v6247-selfheal-inflight.mjs`：22 條全綠（只有字面斷言與模擬狀態欄位跟著搬家）。
- 量測腳本：`scripts/perf-v6248-resync-and-inflight.mjs`、`scripts/perf-v6248-split-tradeoff.mjs`。
- ⚠ 兩支守衛都**只讀工作樹**（CI `fetch-depth: 1` 拿不到歷史 blob），抽不到錨點時**直接丟例外中止**，
  不是 `catch { return }` 的靜默 SKIP。

### 部署

- 前端 bundle：**必須跑 `redeploy-oracle.bat`**（主站是 VM 的 nginx 在服務，不是 GitHub Pages）。
- admin：`oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 已同步成 6.248。
- 錦標賽 bundle 未動 ⇒ **不必**跑 `update-tournament.bat`。


## v6.247 — 休閒線上：推送還在途中就 force-adopt ⇒ 盤面退回攻擊前

**這一輪的任務是查證，不是急著改。** 獨立審查者在複驗 v6.245 時指出：
`pushWithRetry` 失敗後的復原路徑整段被 5 秒 interval 開頭的
`if (!isWaitingOnOpponent(game, mySeatIdx)) ... return;` 擋著，
「回合中途自己的動作推失敗時，那條復原路徑根本不會執行」。

### 查證方法
把 `src/routes/game/+page.svelte` 的 **5 秒 interval callback、`pushWithRetry`、
`isWaitingOnOpponent`**，以及 `room-oracle.ts` 的 `_waitingOnOpp`，
用括號配對**原樣抽出來**、esbuild 轉譯後以 `with(state)` 綁上模擬狀態，
配**虛擬時鐘**實跑（不是重寫一份模擬）。守衛 `scripts/test-v6247-selfheal-inflight.mjs`
就是這支工具，對 v6.246 的檔案跑 **12 PASS / 9 FAIL**，修後 **21 PASS / 0 FAIL**。

### 七條查證的結果
1. **對手誤拿棄權勝：成立（真傷害）。** 我方上行塞死、回合中途連做 8 個動作（本地 log 10→18）
   期間伺服器停在 10；對手端 `oppInactivityWarn` 在 **181 秒**跳出，
   按下宣告後 `claimOpponentForfeit` 的伺服器端再驗證（`_waitingOnOpp` 讀的是**伺服器**盤面）
   回 `true` ⇒ **核准**。房主可把門檻調到 60 秒，那時 61 秒就成立。
   ⚠ 但把重推從 gate 拆出來**救不了它**：`_repushAttempts` 上限 2、集中在 t≈30~40s，
   實測（對照組）仍然 `granted:true`。要根治得動棄權判定本身 ⇒ **本版不動，留給站長裁定**。
2. **本地盤面被輪詢拉回：不會。** `resolveRoomUpdate` 對「log 嚴格較短」的 snapshot 判
   `stale-snapshot` 拒收；而且伺服器 `_version` 沒動，`shouldDeliverRoomPoll` 根本不遞送。
3. **`pendingSelection.actorIdx === opp` 時 gate 變 true：實測會走重推、不會 force-adopt 到回捲**
   （重推的是我自己剛做完的那份，冪等；推端 `shouldSkipStalePush` 擋倒退）。
4. **回合結束那一刻自癒補跑：會，但實測會被下面第 6 條擋掉。**
5. **邊界**：`game===null` / `phase!=='playing'` / `game-over` / 觀戰座位 gate 皆為 false；
   `setup` 階段有 v5.697 的專門分支。實測沒有「因為 gate 回 false 而真的卡死」的路徑。
6. ⭐⭐⭐ **真正的缺口在別處，而且 v6.246 把它放大了。**
   `_unpushedState` 只在 push **確定失敗之後**才被設定；push 還在飛的期間它是 `null`
   ⇒ 25 秒的 `decideStuckSelfHeal` 拿到 `hasUnpushedLocal:false` ⇒ 直接 `_forceAdoptNext`
   ⇒ 繞過全部 stale 守衛採用伺服器（＝攻擊前）那份。
   實測時間軸（48KB、87 秒才送達，v6.245 記錄的真實案例）：
   `t=30s 本地 11->10（退回攻擊前）, t=90s 10->11（又跳回來）`。
   v6.246 把 48KB 的預算放寬到 120 秒之後，這個「在途窗口」從 30 秒變成最長 120 秒，
   而且那些推送**真的會送到**（以前 30 秒就被砍掉）⇒ 這個回捲比 v6.245 之前更常發生。
   ⇒ v6.212 宣稱修掉的症狀，對「逾時型」失敗其實從來沒有生效過。
7. **`tournament-dumps/` 找不到能對上的玩家回報 —— 因為根本沒有儀器。**
   `_tSendClientDiag` 開頭就是 `if (!isTournament || ...) return;`，
   所以 `stale-version` / `setup-watchdog-repeat` / `manual-sync` / `stale-board-drop`
   **全部只有錦標賽會送**。休閒對戰佔全站 94% 流量，卻一個指紋都沒有。
   （最新一份 `monitor_20260827_104828`：stale-version 53 次/31 人、
   setup-watchdog-repeat 12/10、manual-sync 5/4、stale-board-drop 3/3 —— 全是錦標賽路徑。）
   ⇒ 「dump 裡沒有」不可以讀成「沒發生」。**待辦：休閒端要有自己的指紋。**

### 這一版改了什麼（只改一件事）
新增 `_pushInFlight` / `_pushInFlightSince`：`pushWithRetry` 與自癒重推在送出前 `++`、
用 `finally` / `.finally` 還原；25 秒的方向決策加一個條件 `&& !_pushStillInFlight`。
- **不新增任何請求**、interval 仍是 5 秒、8 秒重訂閱那一段一字未動。
- 只會讓 force-adopt／重推**變少**：自癒重推從「併發送兩份 48KB」改成串行，
  總次數仍由 `_repushAttempts`（上限 2）控制。
- **不動 `isWaitingOnOpponent`**（它服務的是棄權判定，v5.328/5.697/5.698 逐步修出來的，
  爆炸半徑大），也不動 `decideStuckSelfHeal`、`_forceAdoptNext`、`oppInactivityWarn`、
  `claimOpponentForfeit`。錦標賽走 `tournamentDispatch`，完全不經過這段程式。
- **fail-safe 不是 fail-open**：在途判定帶 `< ORACLE_API_TIMEOUT_MAX_MS`（120 秒）上限，
  旗標萬一沒還原，最多延後 120 秒就恢復原行為，不會變成新的卡死。突變測試有驗這一條。

### 守衛 scripts/test-v6247-selfheal-inflight.mjs（21 條）
抽取器自我驗證 2、核心 HEAD-FAIL 4、force-adopt 硬約束 2、正對照 4、接線 4、
v6.212 回歸 1、突變測試 4（含「同一個突變不可以把不相干的斷言也弄紅」的定位檢查）、
現況鎖 1（把「棄權誤判仍在」寫成斷言，將來修掉時會提醒更新）。
⚠ 突變測試只捕捉 `assert.AssertionError`，其它例外照樣往上丟 —— 不用無差別 try/catch。

### 未修、留給站長裁定
- **棄權誤判**（查證第 1 條）：中途推送失敗期間，對手宣告棄權會被伺服器核准。
  可能的方向：房間另存一個「玩家最後一次動作的本地時間」由客戶端心跳更新，
  棄權再驗證時一併看；或宣告前先要求對方端確認。兩者都會動到棄權語意，需要決定。
- **休閒端沒有任何診斷指紋**（查證第 7 條）：現在無法用資料判斷上面這些情境的真實頻率。


## v6.246 — 獨立審查者對 v6.245 的複驗：三項修正 ＋ 兩個守衛弱點 ＋ 一筆待辦

> BASE（寫死）= `3937a1e5e141c13977b03b38897f4e569a264905`（v6.245）
> 守衛：`scripts/test-v6246-oracle-timeout-followups.mjs`（38 PASS）
> 金絲雀：`scripts/test-v6245-oracle-api-timeout.mjs`（30 PASS，本版順便修了它自身的兩個弱點）
> 效能量測腳本：`scripts/perf-v6246-oracle-timeout-overhead.mjs`（Rule 32）

### 【問題1】401 分支還留著一發沒有任何上限的 `oracleAuth()` — 審查者判斷正確

`oracle-client.ts` BASE:215 的 `await oracleAuth();` **不帶 signal、沒有任何時間上限**。
自行複驗（`401` ＋ auth 端點黑洞）：BASE 推進 **10 分鐘仍未 settle**，
且那一發 auth 的 `init.signal` 是 `undefined`（＝「按了沒反應」在這條路上原封不動存活）。

「多餘」也查證屬實：`oracleSignOut()` 已把 `_token` / `_uid` / localStorage 全清，
遞迴那發 `oracleApi` 開頭的 `await oracleAuth(_ac.signal)` **必定**重新跟伺服器要 token，
不可能沿用舊 token（守衛用 `Authorization` 標頭序列 `['Bearer T0','Bearer T9']` 實跑證明）。
終止條件 `_retry = false` 仍在：連續兩次 401 只打 2 發 `/api/rooms`，不可能無窮遞迴。

⇒ **刪除該行**。刪掉之後還有一個附加好處：重新登入那一發吃的是**呼叫端的預算**
（建房／進場／入座／開局的 60 秒逃生口），不再是硬寫的 30 秒。

**順帶項一起收斂了**：`oracleAuth` 在「沒有外部 signal」時自己開一顆 30 秒計時器。
這一次涵蓋 `room-oracle.ts getMyUid()`、`auth-facade.ts:37/55`、`game/+page.svelte` onMount
四個裸呼叫點。選擇這個做法而不是逐點改的理由：

- 爆炸半徑**小**——只有「快取沒命中且要發網路請求」那一條分支會建計時器；
  快取命中（絕大多數）在函式開頭就 return，**一顆計時器都不會建**（守衛有正對照）。
- 有外部 signal 時**不另外開計時器**，`oracleApi` 那條路的行為與 v6.245 逐字相同。
- 四個裸呼叫點原本都已經有 `catch`（onMount 那個尤其重要：它是 `await`，
  掛住會把後面的卡包載入整串堵死）。

### 【問題2】逾時訊息含 path，被誤判成「房間不存在」— 審查者判斷正確

自行複驗（黑洞 fetch ＋ `logh=4042abc-9f1-12`）：BASE **回 `null`**、不丟錯
⇒ `oraclePollRoom` 走 `callback(null)` ⇒ `handleRoomUpdate` 設
`onlineError = '房間不存在或連線中斷'`。

自行量到的觸發率（20,000 次抽樣，`probe/hash404`）：`logChainHash` 產出含 `404` 的比例 **0.215%**
（審查者是 0.26%，同一個數量級）。⚠ 但**曝險時間比這個比率更長**：`logh` 只在 log 長度改變時才變，
一旦某個長度算出含 `404` 的雜湊，**那段期間的每一發輪詢都中招**。
另外還有兩個審查者沒點名的觸發源，守衛都補了 HEAD-FAIL：
`?since=<房間版本>`（版本每次寫入 +1，打久了必然走到 404）與 `logSince=<log 則數>`（第 404 則）。

**選了哪個修法**：兩個候選（先判 `isOracleTimeout` ／ 改比對 `→ 404`）**都還是字串比對**，
`→ 404` 只是把誤判機率壓小，沒有消除它（回應 body 若含 `→ 404` 一樣中招）。
⇒ 改成**結構化的單一可靠來源**：`oracleApi` 丟錯時把 `res.status` 掛上去
（**錯誤訊息逐字不變**，UI 與內部診斷都在讀它），新增 `oracleErrorStatus(err)` 當唯一判準，
並在它之前先 `if (isOracleTimeout(err)) throw err;` 當第二道（自我說明用，零成本）。

**同型缺陷枚舉**（`git grep` 一律指定 rev = BASE，禁工作樹）：
`includes('4` / `includes("4` / `includes('5` / `includes('3` / `includes('2` /
`indexOf('<3 碼>')` / `.match(/\d{3}/)` 全掃過，`src` + `oracle-admin` + `functions` 底下
**用字串比對 HTTP 狀態碼的只有這兩處**（`oracle-client.ts:326` 與 `:350`），已全部收斂。
其餘 `includes('4')` 命中都是牌組張數上限／傷害數字之類的測試字串，與狀態碼無關。
守衛 ① 把這條做成永久掃描器（含「掃描器要先抓得到 BASE 的已知樣本」的下限斷言）。

### 【問題3】慢上行玩家修後比修前更糟 — 審查者判斷正確，但**他建議的 60 秒解不了**

`48285 B ÷ 86.954 s = 555 B/s`。60 秒只送得出 **33.3 KB（69%）**，那位玩家**還是送不到**。
⇒ 改成**依 body 大小算預算**（審查者列的第二個選項）：

```
budget(bytes) = bytes <= 4096 ? 30000
              : min(30000 + ceil((bytes - 4096) * 1000 / 500), 120000)
_toMs = max(options.timeoutMs ?? 30000, budget)        // 逃生口是「放寬」，不可反過來砍
bytes ≈ JSON.stringify(body).length * 2                 // UTF-8 位元組的保守估計
```

- `* 2` 的依據：實測以中文為主的盤面 JSON 是 **1.646~1.707 倍**，取 2 倍留餘裕。
  **高估只會多給預算，不會誤殺**。精算（`TextEncoder`）要 256µs，估算 **38 ns** —— 差 6800 倍，
  而 `JSON.stringify` 本來就要 379µs（量測腳本 `scripts/perf-v6246-oracle-timeout-overhead.mjs`）。
- **上界 120 秒**的依據（Rule 37）：必須大於實測過的最慢**成功**案例 86.954 秒，取約 38% 餘裕。
- **最壞情況上界**：單發 120 秒；且「大預算」的逾時**不吃 `oracleTx` 的重試額度**
  （`isOracleUploadBudgetTimeout`），所以不會變成 120+1+120 = 241 秒。
- ⚠ **上界也是保證上限**：500 B/s 時 120 秒最多只送得完約 **60 KB**，更大的封包仍會失敗。

**為什麼這不會把黑洞情境拖長**（站長紅線的關鍵）：nginx log 那 45 筆真黑洞是
`60.001 - 408 /api/rooms/W6JC PUT **1091**` —— body 只有 1091 B，**遠小於 4096 的免加額**
⇒ 預算仍是 30 秒，**等待時間一秒都沒有變長**（守衛有這條正對照）。
而 nginx 的 `client_body_timeout` 本來就會在 60 秒把停滯的上傳打成 408，
所以 120 秒的上界在現實中很難走到。

#### 那位 4.4 kbps 玩家修後的完整時間軸（實跑量出來的）

| 動作 | v6.244 | v6.245 | **v6.246** |
|---|---|---|---|
| 建房（~1 KB） | 送達 | 60s 內送達 | 60s 內送達 ✓ |
| 開局 startGame（~40 KB，72s） | 送達 | **60s 砍掉 ⇒ 失敗** | 預算 120s ⇒ **送達** ✓ |
| 每一步 pushGameState（48 KB，87s） | 送達（然後 409） | **30s×2 ⇒ 永遠送不到** | 預算 120s ⇒ **送達** ✓ |
| 輪詢 GET | — | 30s | 30s（不變） |

⚠⚠ **誠實的結論：他還是不能好好玩。** 修後「動作送得到伺服器」了（v6.245 是保證送不到），
但**每一步要 87 秒**，對手每 87 秒才看到一手；一局幾十步 ⇒ 實務上仍然近乎無法遊玩。
而且 87 秒後盤面可能已變 ⇒ 伺服器回 409 ⇒ `oracleTx` 重新拉盤面再送一次 87 秒（既有行為，最多 5 輪）。
**「修後不比修前差」達成了；「能正常遊玩」沒有達成，也不是前端逾時值能解決的**——
那是他的上行頻寬問題（4.4 kbps 連 3G 都不如）。

### 【問題4】首頁公告改寫（v6.245 那則過度宣稱已整則換掉）

v6.245 寫「最多等三十秒」，但實跑量到的 UI 鎖住時間是：

| 情境 | 實跑解鎖時刻 | PUT 次數 |
|---|---|---|
| 輪詢／讀盤面黑洞（GET） | 30,000 ms | 0 |
| 小型寫入（基底預算，仍吃 1 次重試） | 61,500 ms | 2 |
| 盤面同步 pushGameState（大預算，不重試） | 120,500 ms | 1 |
| 入座／進場（60 秒逃生口，小 body） | **121,500 ms**（最大值） | 2 |
| 開局 startGame（逃生口＋大 body） | 120,500 ms | 1 |

⇒ 公告寫「最長約兩分鐘」，並在內文列出 30／61／120／121 四個數字。
守衛 ⑦b 把這四個數字做成**行為端**斷言（首頁改字沒改行為、或行為改了沒改字，都會翻紅）。
⚠ 這一則是**整則取代** v6.245（不是新增），理由：v6.245 描述的行為已經不存在，
留著就是掛在首頁的過度宣稱；首頁維持 50 則上限。

### 【問題5】v6.245 守衛自身的兩個弱點（會讓下一版假綠）

1. `mutantMustBreak` 是**無差別 try/catch** ⇒ 任何例外都算「突變被抓到」。
   自行複驗：`ESBUILD_BINARY_PATH` 指到不存在的檔（＝平台不符）時 **M1~M4 全部假 OK**。
   ⇒ 兩道修正：(a) **基準線必須先綠**（同一個 probe 先跑未突變的原始碼）；
   (b) 突變後丟出的訊息必須符合 `expectRe`，且不得命中 `TOOLCHAIN_RE`（工具鏈錯誤）。
   證明：把 esbuild 弄壞後重跑，M1~M5 **全部 FAIL** 並印出「基準線就紅了」。
   守衛 ⑤ 用 `spawnSync` 把這件事做成常設斷言（附「工具鏈正常時必須全綠」的正對照）。
2. `takeSeat` 與 `startGame` **共用同一個錨點字串**，只靠 `n >= 5` 計數兜底。
   ⇒ 改成「先切出每個函式的 body，再逐一斷言」（`fnBody()`），並加「抽取器真的分得出四個」的正對照。
   ⚠ 順帶抓到第三個弱點：M3 的突變用字串版 `replace`（只換第一個），v6.246 之後
   `if (_timedOut && _isAbortError(e))` 在 `oracleAuth` 與 `oracleApi` **各有一份**
   ⇒ 突變只改到 `oracleAuth`、probe 測的是 `oracleApi` ⇒ 突變存活。已改 `replaceAll`。

### 【問題5 後記】「弄壞工具鏈」的手法**本身**也會說謊（v6.246 第一顆 commit 讓 CI 紅了）

第一版的 ⑤ 用 `ESBUILD_BINARY_PATH=<不存在的路徑>` 去弄壞子行程的 esbuild。
沙盒裡這招有效（沙盒裝的是 win32 的 esbuild，本來就得靠這個環境變數指到 linux 執行檔），
**但 GitHub Actions 上 esbuild 能原生解析 `@esbuild/linux-x64`，它會忽略那個壞路徑照樣跑起來**
⇒ 子行程全綠 ⇒「M1~M5 必須全部 FAIL」這條反而自己翻紅 ⇒ `npm test` 失敗、deploy 被 skip。

⚠ 諷刺但重要：**這正是它自己要防的東西的同型** —— 我用一個「在我的環境下才成立」的手段
去證明「守衛在別的環境不會假綠」。教訓：

- **弄壞被測系統的手段，要先證明它真的把系統弄壞了**（Rule 33 正對照）。
  新版第一條斷言就是 `ok(/another platform/.test(out))` ＋ `ok(status !== 0)`。
- **不要用環境變數當破壞手段**：同一個變數在不同環境的語意不同。
  改成把 test-v6245 原封不動複製一份、只把 `esbuild` 換成「transformSync 一定丟平台不符錯誤」
  的替身（其餘逐字不動，測的還是出貨的守衛碼），副本放 `os.tmpdir()` 執行，不污染 repo。
- 這次靠「**step 耗時**」定位：BASE 的測試步驟 338 秒成功、失敗那次 326 秒
  ⇒ 幾乎跑到最後才炸 ⇒ 鎖定新加在鏈尾的 test-v6246（拿不到 CI log 時這招很有用）。
- 之後**用三種環境對跑守衛**才算過：完整 clone＋外部 esbuild／淺複製／
  「原生 esbuild ＋ 沒有 `ESBUILD_BINARY_PATH` ＋ 沒有 `.git`」（＝最接近 CI 的那一種）。

---

## 🔨 待辦（v6.246 刻意不動，但站長要知道）

### (1) v6.212 的「卡住自癒」在回合中途根本不會執行 —— **既有**問題

`game/+page.svelte` 的自癒（8 秒重建訂閱／25 秒 `decideStuckSelfHeal`）整段寫在
`if (!isWaitingOnOpponent(game, mySeatIdx)) { ...; return; }` **之後**
⇒ **輪到自己、動作推失敗**時那條復原路徑不會跑；要等到下一次真的進入「等對手」狀態才會啟動。

v6.245 在 `pushWithRetry` 的註解裡寫「⇒ 交給既有的卡住自癒」，**那句話是錯的**。
v6.246 已更正該註解（守衛 ⑦ 有斷言：註解必須提到這個 gate、且不得再有那句話，
並附「gate 真的排在自癒之前」的正對照）。

⚠ **本版不動它的理由**：改自癒的觸發條件會影響 v5.360／v5.587／v6.212 三層既有邏輯，
爆炸半徑遠大於本版三項修正，且沒有玩家回報指向它。
建議下一版單獨處理，並先想清楚「回合中途自癒」會不會跟樂觀更新／slice 回滾打架。

### (2) CI 有一個盲點：`test-v6234-resistance-label-and-coin-cap.mjs` 在完整 clone 下是紅的

- 完整 clone：**1 FAIL**（`engine.ts` 已較 v6.234 漂移）。
- CI 是 `fetch-depth: 1` 淺複製 ⇒ 那條會 **SKIP**，於是 **CI 看起來是綠的**。
- BASE(v6.245) 樹同樣紅 ⇒ **與逾時改動無關**，是 engine 那邊的事。
- ⚠ 這代表「CI 綠」在這一支上不等於「本機綠」。本版不修（那是 engine 的範圍），
  但**必須有人去看**，否則它會一直當作綠的。

---

## v6.245 — 休閒對戰 `oracleApi()` 加逾時（AbortController，預設 30 秒）

> 站長裁定（2026-08-27）：照 nginx 慢請求 log 的證據修，做法固定，不換方案。

### 【A】證據（nginx 慢請求 log，實測，非推測）

格式：`時間 $request_time $upstream_response_time $status $uri $method $request_length`

```
2026-08-26T15:45:05+00:00 60.001 -     408 /api/rooms/W6JC PUT 1091   ← 這種 45 筆，10 分鐘內同一間房
2026-08-25T18:19:44+00:00 86.954 0.007 409 /api/rooms/XTCT PUT 48285
```

- 第一種：`upstream_response_time = "-"` ⇒ 請求**從來沒送到 node**；`408` ＝ nginx 等 client
  送完 body 等滿 60 秒沒等到 ⇒ 伺服器／node／隧道全部洗清，卡的是**玩家的上行**。
  同一秒多筆重複 ⇒ 前端在重送。
- 第二種：`request_time 86.9 秒`、node 只花 `0.007 秒`、`request_length=48285`（48KB）
  ⇒ 上行約 **4.4 kbps**；等它傳到盤面早就變了 → 409 → 前端重抓重做。

### 【B】病因（已於 BASE=v6.244 逐行查證）

`src/lib/game/oracle-client.ts` 的 `oracleApi()` ——休閒對戰所有請求的**唯一出口**——
BASE:99-152 完全沒有 AbortController、沒有任何 timeout。

⚠ 後果不是「慢」，是**永久停擺**。三個 tick 迴圈都是「await 完才排下一發」：

| 迴圈 | BASE 位置 | 掛住的後果 |
|---|---|---|
| `oraclePollRoom.tick` | `oracle-client.ts` BASE:409-471（`timer = setTimeout(tick,_d)` 在 await 之後） | 對戰盤面再也不更新 |
| `oraclePollMessages.tick` | `oracle-client.ts` BASE:528-542 | 聊天再也不更新 |
| `subscribeOpenRooms.tick / legacyTick` | `room-oracle.ts` BASE:732-787 | **大廳再也打不開**（長期待辦「線上休閒大廳偶發打不開」的其中一條路徑） |

錦標賽的 `tApi`（`src/routes/game/+page.svelte` BASE:4899-4969）在 v6.135/v6.179 已經治過
同一個病（12s/8s）；註解把後果寫得很清楚（`tBusy` 永久 true、按鈕不會變灰）。
**休閒版從來沒治過，而休閒佔全站 94% 流量。**

### 【C】呼叫點枚舉 → 逾時值 → 理由

全站 `git grep -n oracleApi <BASE>` 只有兩個檔案有呼叫點（`decks/+page.svelte` 與
`game/+page.svelte` 都**沒有**）。

| # | 呼叫點（BASE 行號） | 端點 | 逾時 | 理由 |
|---|---|---|---|---|
| 1 | `oracle-client.ts:66` `oracleAuth` | POST `/api/auth/anonymous` | 隨呼叫端（signal 傳入） | 它掛住＝整支 `oracleApi` 掛住，而那時計時器還沒武裝 ⇒ 必須一起蓋 |
| 2 | `oracle-client.ts:240` `oracleGetRoom` | GET `/api/rooms/:code` | 30s | body 幾乎為 0，上行塞住也拉得回來 |
| 3 | `oracle-client.ts:263` `oracleGetRoomDelta` | GET（盤面輪詢） | 30s | 休閒側**沒有**長輪詢，伺服器不會故意掛起 |
| 4 | `oracle-client.ts:289` `oracleUpsertRoom` | PUT `/api/rooms/:code` | 30s（可覆寫） | 40~48KB 上行，正是病灶 |
| 5 | `oracle-client.ts:314` `oracleDeleteRoom` | DELETE | 30s | 小請求 |
| 6 | `oracle-client.ts:319` `oracleListRooms` | GET `/api/rooms` | 30s | 大廳（舊協定） |
| 7 | `oracle-client.ts:342` `oracleListRoomsCombined` | GET `/api/rooms` | 30s | 大廳（v6.217 合併協定） |
| 8 | `oracle-client.ts:360` `oracleRoomArchetypes` | GET | 30s | 大廳標籤 |
| 9 | `oracle-client.ts:496` `oracleSendMessage` | POST messages | 30s | 小請求 |
| 10 | `oracle-client.ts:511` `oracleListMessages` | GET messages | 30s | 聊天輪詢 |
| 11 | `room-oracle.ts:865` `sendMessage` | POST messages | 30s | 小請求 |
| **A** | `room-oracle.ts:116` `createRoom` | PUT（建房） | **60s** | 失敗**有狀態副作用**：伺服器其實建好了、client 以為失敗 → 換房號再建一間 ⇒ 大廳孤兒房 |
| **B** | `room-oracle.ts:137` `joinRoom` | PUT（進場） | **60s** | 同上（座位可能已寫入） |
| **C** | `room-oracle.ts:173` `takeSeat` | PUT（入座） | **60s** | 同上 |
| **D** | `room-oracle.ts:591` `startGame` | PUT（開局） | **60s** | 封包最大（整包盤面）且失敗有狀態副作用 |

**明確查證過的豁免（它們根本不走 `oracleApi`，所以本版動不到）：**

| 對象 | 走哪裡 | 查證方式 |
|---|---|---|
| **長輪詢**（伺服器故意掛起 25 秒） | 錦標賽 `tApi`，`game/+page.svelte:6391-6392` 帶 `&wait=1` 與 `{ timeoutMs: T_LP_CLIENT_TIMEOUT_MS }`(30s) | `git grep -n "wait=1" <BASE>`；`oracle-client.ts` 全檔沒有 `wait=`／`longPoll` |
| **`/api/decode-tw-deck`** | `decks/+page.svelte:1058` 裸 `fetch` + 自己的 `twImportAbort` | `git grep -n "tw-deck" <BASE>` |
| **`/api/encode-tw-deck`** | `decks/+page.svelte:1177` 裸 `fetch` | 同上（v6.230/6.231 的三段 20s＋總預算 50s 完全不受影響） |
| 錦標賽報名／進場／`/state`／`/action` | 全部走 `tApi`（另一套 12s/8s） | `tApi(` 與 `oracleApi(` 是兩個獨立出口 |

### 【D】逾時之後做什麼（站長裁定：不當硬失敗、走既有 409 路徑、不新增狀態機／旗標）

1. `oracleApi` reject 一個帶 `oracleTimeout: true` 標記的 Error（`isOracleTimeout()` 判別）。
   **reject 本身就是「解鎖 UI」**：呼叫端的 `finally`（例如 `isSyncing = false`）才跑得到。
2. `room-oracle.ts` 的 `oracleTx` 迴圈**本來**每一輪就是
   「`oracleGetRoom` 重新拉最新盤面 → 對**新**盤面重跑 `fn` → 再寫」。逾時直接 `continue`
   進入這條既有路徑 ⇒ **重新同步再重做**，不是把同一包 48KB 原樣重送。
   ⚠ 上限：逾時只吃掉 **1 次**重試（`TX_TIMEOUT_RETRY_MAX = 1`，與 409 的 5 次分開計數），
   退避 1 秒（比 409 的 50ms 長）。
3. `pushWithRetry`（`game/+page.svelte`）逾時 ⇒ **立刻 break，不重送**。
   （原本 3 次重試 × 30 秒 ＝ 再多鎖 90 秒，對 4.4 kbps 的玩家是純粹的傷害。）
   之後交給**既有**的卡住自癒（v5.360 / v5.587 / v6.212）：
   8 秒重建訂閱＝重新同步 → `decideStuckSelfHeal` 上限 2 次重推 → `force-adopt` 拉伺服器
   最新盤面讓玩家重做。**沒有新增任何狀態機或旗標。**

### 【E】4.4 kbps／48KB 玩家在修後會經歷什麼（逐步）

1. 出招 → 樂觀更新，本地盤面立刻變（與現在相同）。
2. `pushGameState` → `oracleTx` 第 1 輪：GET 最新盤面（body ~0，拉得回來）→ PUT 48KB。
3. 30 秒後 abort（`408` 那批玩家原本要等滿 60 秒才被 nginx 砍）。
4. 退避 1 秒 → 第 2 輪：**重新 GET 最新盤面**（若對手已經動了，`shouldSkipStalePush` 會
   讓這一輪變成 no-op ⇒ 不會用舊盤面蓋掉新的）→ 再 PUT 一次。
5. 第 2 次也逾時 ⇒ 丟出逾時錯誤 ⇒ `pushWithRetry` **不再重送** ⇒ `finally` 解開 `isSyncing`
   ⇒ 「⏳ 同步中」消失、畫面可以操作。總計約 61 秒（BASE 是**無限**）。
6. `_unpushedState` 記下那一手 → 8 秒後自癒重建訂閱（GET，拉得回來）→ 最多 2 次重推 →
   仍失敗就 `force-adopt` 伺服器盤面，玩家在最新盤面上重做。
7. ⚠ 誠實說：他的網路本來就打不了這個遊戲（48KB 要 87 秒）。這一版讓他**知道**、
   而且不會把 UI 鎖死，不是讓他變得能玩。

### 【F】守衛

`scripts/test-v6245-oracle-api-timeout.mjs` — **30 條，全部斷言到行為層**（虛擬時鐘實跑，
不是 grep 字串）。BASE=v6.244 實跑 **8 PASS / 22 FAIL**；本版 **30 PASS / 0 FAIL**。

- HEAD-FAIL：永不 resolve 的 fetch stub ⇒ BASE 推進 10 分鐘仍未 settle；本版 30 秒 abort。
- 正對照：200ms 回應 ⇒ BASE 與本版的回傳值／fetch 次數／完成時刻**完全相同**，
  且成功之後虛擬時鐘上 0 顆殘留計時器（＝`clearTimeout` 真的在 `finally`）。
- 豁免對照：40 秒才回的 stub ⇒ 預設 30s 被砍、`timeoutMs: 60000` 不可被砍。
- 401 對照：第一發 401、第二發 200 ⇒ 成功，且斷言 `signal[0] !== signal[1]` 且第二顆未 abort。
- 204／304／409 回傳值逐字對照。
- 「別人的 AbortError 不可被誤判成逾時」（`_timedOut` 旗標）。
- 突變測試 M1~M5：逾時值改 0／拿掉 `clearTimeout`／拿掉 `_timedOut` 判別／`fetch` 不帶
  `signal`／`TX_TIMEOUT_RETRY_MAX` 改 5 ⇒ 全部必須翻紅（每一條都實測翻紅）。

⚠ CI 是 `fetch-depth: 1`，拿不到 BASE blob ⇒ 守衛自動改用「把逾時機制拿掉」的突變版當
等價 BASE（不 fail-open 成假綠）。

### 【F2】部署（站長要跑哪幾支 bat）

| bat | 這一版要不要跑 | 理由 |
|---|---|---|
| **`redeploy-oracle.bat`** | **要（本版的重點）** | 修的是**前端** `src/lib/game/oracle-client.ts` / `room-oracle.ts` / `routes/game/+page.svelte`。不跑這一支，正式站 `www.ptcg-tw-sim.com` 的 `/game` bundle 仍是 v6.244（＝逾時保護沒生效），只有測試站（GitHub Pages）有 |
| **`update-admin-full.bat`** | 要（可離峰再跑） | `oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 跟著 bump 到 6.245；不跑只會讓 admin 的版本紅字提示對不上，不影響玩家。⚠ 它會 `pm2 restart`，請避開比賽時段 |
| `update-tournament.bat` | **不用** | 沒有動 `src/lib/game/engine.ts` / `effects.ts` / `server-engine.cjs` 的任何 export，也沒有動 `static/cards/` |

⚠ `oracle-admin/server_admin_patch.js` 這一版**完全沒動** —— 逾時純粹是 client 端的事，
伺服器不需要任何配合（nginx 也不用改）。

---

### 【G】已知風險 / 沒查到的

- ⚠ Rule 37 說「逾時值必須大於實測過的最慢**成功**案例」。我們手上**沒有**休閒 PUT
  「慢但成功」的樣本 —— nginx log 裡的慢筆全是 408／409（失敗）。30 秒是拿健康批的
  net 中位數 273ms 反推的（100 倍餘裕），不是拿慢成功案例反推的。
  ⇒ 若日後出現「30 秒內原本會成功」的筆數，`ORACLE_API_TIMEOUT_MS` 要往上調。
- ⚠ 30 秒只保護「上行送不出去」。若是**下行**慢（拉盤面拉不回來），重新同步一樣會逾時，
  最後就是 force-adopt 拿不到新盤面、維持原樣 —— 行為不會比 BASE 差，但也治不好。
- ⚠ `oracleAuth` 現在吃 `oracleApi` 的 signal；被 abort 時 `_token` 維持 null，
  下一次呼叫會重新登入（既有行為）。


## v6.244 — 賽事日期的時間基準：**開賽時間**取代「冠軍產生時間」

> 站長 2026-08-27 回報：網站賽-95【21:00 瑞士制】在台灣時間 **8/26 21:00** 開打，
> 胡說樹-史小寶奪冠顯示為 **2026/08/27**。原因是名人堂拿「冠軍誕生那一刻」當賽事日期，
> 而決賽經常打過台灣的午夜。⇒ 全站改以**開賽時間**為賽事日期。
> 首頁 changelog **要寫**（這是玩家看得到的顯示錯誤）。

### 【A】枚舉：全站有哪些地方在顯示／寫入「賽事日期」

| # | 檔案 | 位置 | 改版前用什麼 | 本版 |
|---|---|---|---|---|
| 1 | `src/routes/game/+page.svelte` | 網站賽歷屆冠軍列 | `new Date(c.finishedAt).toLocaleDateString('zh-TW')` | `tournamentDateTW(c)` |
| 2 | `src/routes/game/+page.svelte` | 社群自辦歷屆冠軍列 | 同上 | 同上 |
| 3 | `src/routes/game/+page.svelte` | 個人資料頁「參賽紀錄」 | `new Date(ev.date).toLocaleDateString('zh-TW')` | `formatDateTW(ev.date)`（`date` 改為開賽時間） |
| 4 | `oracle-admin/admin.html` | 名人堂管理列 | `new Date(c.finishedAt).toLocaleDateString('zh-TW')` | `tournDateTW(c)` |
| 5 | `oracle-admin/admin.html` | 奪冠報告圖（單頁版＋完整版） | `miDate(c.finishedAt)` | `miDate(c.startedAt)` |
| 6 | `oracle-admin/admin.html` | 玩家總覽的錦標賽列表「日期」欄 | `fmtD(e.finishedAt)` | `twDateStr(tournStartMs(e))` |
| 7 | `oracle-admin/admin.html` | 賽事歸檔列表「**完賽時間**」欄 | `_tsFmtDateTime(a.finishedAt)` | **語義本來就對，只釘死時區**（欄名就叫完賽時間） |
| 8 | `oracle-admin/server_admin_patch.js` | `recordChampion` 寫入 | 只有 `finishedAt` | **新增** `startedAt` |
| 9 | `oracle-admin/server_admin_patch.js` | `/api/tournament/champions` | 只回 `finishedAt` | 多回 `startedAt`（缺欄者讀取時補） |
| 10 | `oracle-admin/server_admin_patch.js` | `_aggregateArchives` 的 `date` | `a.finishedAt` | `a.startedAt || a.createdAt || finishedAt` |
| 11 | `oracle-admin/server_admin_patch.js` | `/api/admin/player-profile` | 只回 `finishedAt` | 多回 `startedAt` |
| 12 | `oracle-admin/server_admin_patch.js` | `champions/restore-from-archive` | `$setOnInsert` 無 `startedAt` | 補上 |

⚠ 刻意**不動**的：`_aggregateArchives` 的 `winsAt` / `champOfficialAt` / `champCommunityAt` /
`lastFinishedAt`。它們不是顯示欄位，是排行榜同分時「誰比較近期」的 tie-break；
改成開賽時間會靜默動到榜單順序，而那不在這次的回報範圍內。

### 【B】「開賽時間」這個資料**存不存在**（最關鍵的一步）

存在，而且在**歸檔**裡已經存了很久：

- `recordTournamentArchive()` 一直寫 `startedAt: ev.startedAt || ev.createdAt || null`
  （`oracle-admin/server_admin_patch.js`）。這行是 commit `ee9239d9`（2026-06-12，admin v1.39）
  加的，而錦標賽功能本身是 2026-06-11 才上線（`1307784e` 名人堂／`88e603f0` 歸檔）
  ⇒ **幾乎所有歷史賽事都有這個欄位**。
- `ev.startedAt` 的寫入點只有一個：`_seedEventBracketImpl` 的
  `{ status:'running', currentRound:1, rounds, roundStartedAt, startedAt: Date.now() }`
  —— 也就是「報到結束、賽程產生、第 1 輪開打」那一刻。**型別是毫秒數（`Date.now()`）**，
  不是 Date 物件、不是字串。
- **`tournamentChampions` 沒有任何開賽時間欄位**（`recordChampion` 只寫 `finishedAt: Date.now()`）。
  這就是站長看到的那個 bug 的直接來源。
- 賽事名稱裡的「21:00」只有時分、沒有日期，**單獨定不了日**，本版完全沒有去解析它。

⚠ 沙盒連不到正式站 MongoDB，以上全部是從程式碼推導的。**不確定的只有一件事**：
極早期（2026-06-11～12，`ee9239d9` 之前）歸檔的那幾場有沒有 `startedAt`。
沒有的話會退到 `createdAt`，再沒有才退回 `finishedAt`（＝與 v6.243 相同，不會變空白）。
站長可在 VM 上跑這一行確認（一次一行）：

```
mongosh --quiet ptcg --eval 'db.tournamentArchives.countDocuments({startedAt:{$in:[null,0]}})'
```

預期輸出：`0`（或個位數＝最早那幾場）。

### 【C】修法：**純顯示層**，零資料遷移

874 筆既有 `tournamentChampions` **一個欄位都沒有被改寫**。

- `recordChampion` 從本版起**多寫**一個 `startedAt`（新欄位，`$set` 不影響其他欄位）。
- `/api/tournament/champions` 讀取時：`cs.filter(c => !c.startedAt)` 才去 `tournamentArchives`
  以 `_id: {$in: ['arch_'+eventId, …]}` 補（projection 只取 `eventId/startedAt/createdAt`，
  **不碰 `players`／`matches` 這兩個大欄位**）。`_needIds` 為空時**完全不發這一發查詢**，
  所以等舊紀錄自然補完後，這條路徑會自己消失。
- 排行榜／個人戰績本來就是直接讀 `tournamentArchives`（`startedAt` 已在），改一個欄位名即可。

⇒ **不需要任何 backfill**。若站長仍希望把 874 筆補齊欄位（讓上面那一發查詢永遠不發生），
可以按一次 admin 名人堂的「♻️ 從歸檔還原名人堂」—— 但**那支只 `$setOnInsert`**、
對已存在的紀錄不會補欄位，所以真的要補得另外寫一次 `updateMany`。
**本版沒有做，也沒有留任何會改寫既有資料的路徑**，等站長裁定。

### 【D】時區：原本吃的是「執行環境」

`toLocaleDateString('zh-TW')` **不帶 `timeZone` 選項時吃的是執行環境時區**：

- 伺服器在新加坡（UTC+8）── 剛好與台灣相同，所以伺服器端看不出問題。
- 玩家的瀏覽器 ── 只要不在 +8（出國、裝置時區設錯），看到的日期就會再偏一天。

⇒ 新的中央 helper `src/lib/tournament/event-date.ts` 固定 `+8` 並用 `getUTC*`，
**連 `Intl` 的時區資料都不依賴**。`admin.html` 是單檔 `<script type="module">`、載不了 ESM，
所以同語義各留一份（`twOffsetMs()`／`twDateStr()`／`tournStartMs()`／`tournDateTW()`）。
⚠ 偏移寫成**函式**不是模組層級 `var` —— 模組層級變數在賦值前被呼叫會拿到 `undefined`（NaN 日期）。

### 【E】守衛 `scripts/test-v6244-tournament-date-basis.mjs`

斷言全部到**輸出字串**，不是「字串存在」：

- **HEAD-FAIL**：fixture ＝ 開賽 8/26 21:00 TW（`Date.UTC(2026,7,26,13,0)`）、
  冠軍產生 8/27 00:30 TW（`Date.UTC(2026,7,26,16,30)`）⇒ BASE 顯示 `2026/8/27`（紅），
  修後 `2026/08/26`（綠）。
- **正對照**：開賽 8/26 14:00、冠軍產生 8/26 16:00（沒跨午夜）⇒ 修前修後都是 8/26，
  證明不是把全部日期往前推一天。
- **時區突變**：整支測試在 `TZ=UTC` 與 `TZ=America/Los_Angeles` 下各跑一次，結果必須一模一樣。
- **突變測試**：把中央 helper 改回吃 `finishedAt` ⇒ 必須翻紅。
- **資料保全**：斷言本版沒有新增任何 `deleteMany`／`updateMany`／`$unset` 到
  `tournamentChampions`／`tournamentArchives` 的路徑。

順手修好的三支既有守衛（**只補測試腳手架，出貨碼沒被將就**）：
`test-v6111` / `test-v6168` / `test-v6169` / `test-v6226` 會把 `admin.html` 的繪圖區段
切出來在沙箱裡跑，而新的日期 helper 定義在切片範圍之外 ⇒ 一律注入**真的那一份**
（不是 stub —— stub 會讓「日期基準被改錯」在那幾支守衛裡完全看不出來）。

### 【F】部署

`oracle-admin/server_admin_patch.js` 與 `oracle-admin/admin.html` 都有改
⇒ **`update-admin-full.bat`**（scp 兩支 + pm2 restart；端點要回 `startedAt`、admin 前端才顯示得出來）。
`src/lib/version.ts` 有改 ⇒ **`redeploy-oracle.bat`**（讓 www.ptcg-tw-sim.com 的版本號跟著走）。
沒有動 `src/lib/tournament/swiss.ts`、沒有新增 `server-engine.cjs` 的 export、`static/cards/` 沒動
⇒ **不需要** `update-tournament.bat`。

⚠ 兩支的先後：先 `update-admin-full.bat`。在它跑完之前，玩家端拿到的 `champions` 回應還沒有
`startedAt`，新前端會走 fail-open 退回 `finishedAt` ⇒ 行為與 v6.243 相同（不會壞、也不會空白），
只是日期還沒修好。

### 【G】要不要回填？（**站長裁定，本版沒有動手**）

不回填也完全正確 —— 讀取端會補。若希望連那一發補欄查詢都不要有，可以擇一：

| 方案 | 做法 | 風險 |
|---|---|---|
| A（建議）| **什麼都不做** | 0。每次開名人堂多一發 `_id` 索引查詢（≤200 個 id、3 個小欄位） |
| B | 一次性 `updateMany`：對 `startedAt` 缺席的 champ，用同 eventId 的歸檔補 | 要寫一支只 `$set` 新欄位的腳本；⚠ 絕不可碰既有欄位 |

⚠ **不能**用 admin 現有的「♻️ 從歸檔還原名人堂」代替 B —— 那支是 `$setOnInsert`，
對**已存在**的紀錄不補欄位（這是刻意的：不覆蓋站長手動改過的冠軍名／牌組名）。


## v6.243 — `recentLimit` 查證：它是**顯示**上限，不是統計上限 ⇒ 聚合與顯示都不動

> 站長交辦：把 `/api/admin/stats/players/:email` 的 `recentLimit` 一起修，讓「常用卡」與
> 「勝率走勢」吃全量。**查證結果是前提不成立** —— 那兩個統計本來就是全量，而且這一頁
> 根本沒有「勝率走勢」。站長交辦裡也已經先寫了「先查證」「若確認不會失真就不要動」。
> 首頁 changelog **不寫**（純 admin 後台）。

### 【A】`recentLimit` 到底控制什麼

`server_admin_patch.js` 這支 handler 裡，`recentLimit` 在**程式碼**中只出現兩次
（第三次是註解「summary（全部對戰，不限 recentLimit）」，剝註解後不算）：

| 產物 | 資料怎麼來 | 受 `recentLimit` 影響？ |
|---|---|---|
| `recentMatches`（畫面「最近 N 場對戰」表格） | `find({$or:[p1.email,p2.email]}).sort({endedAt:-1}).limit(recentLimit)` | **是**（這就是顯示上限） |
| `summary`（總場次／勝／負／平／勝率） | `aggregate([$match(email) … $group])` | 否，**生涯全量** |
| `topCards`（常用卡 Top 20） | `aggregate([$match(email) … $unwind … $group … $sort … $limit 50])` | 否，**生涯全量**（那個 `$limit 50` 限的是**卡種數**，在 `$group` 之後，不是母體） |

⇒ 上一輪【F】表的判斷是錯的。錯的來源是**出貨碼自己的註解**：
`// 2.2 個人戰績頁 — 最近 N 場 + 常用卡 Top 20 + 勝率走勢`。
`admin.html` 的 `showPlayerDetail` 只畫「總覽卡片＋最近 N 場表格＋常用卡 Top 20＋儲存的牌組」，
**沒有勝率走勢**（站台唯一的 trend 是 2.5 `/api/admin/stats/trends`，那是全站對戰量，與玩家無關）。
⇒ 這一版把那句註解與內部文件一起更正 —— 不改掉的話，下一輪還會再誤判一次。

### 【B】⚠ 這一版**刻意不做**的事，以及為什麼

若照原本的交辦「把統計放大到全量」去做，唯一還能動的地方其實只剩 `recentMatches`，
而那正是站長同一份交辦裡點名**不可以**做的：把顯示列表改成全量。
守衛的**突變 B** 實測了這個代價（137 場的假玩家）：

| | 回應體積 | node 端物化筆數 |
|---|---|---|
| 現況（顯示 30 筆） | **6,579 bytes** | 33 筆（30 顯示 + 1 summary 列 + 2 卡列） |
| 若改成全量 | **30,650 bytes（4.7 倍）** | 140 筆 |

matchRecord 每筆都帶雙方的 `cardCounts`（各 ~60 張），所以體積幾乎與場次成正比；
真實老玩家的場次遠多於 137，倍率只會更高。而這支端點是「admin 點一下玩家 email 就會打」。

### 【C】事件迴圈：這一支**沒有**地方掛 `adminScanYield`

v6.241／v6.242 需要讓路，是因為那兩支在 **node 端有 `for await (const m of cursor)` 的逐筆迴圈**。
這一支不同：統計在 **mongod 行程**裡算完才回 node，node 端只物化
「30 筆顯示 + 1 筆 summary + ≤50 筆卡列」。沒有逐筆迴圈 ⇒ 沒有東西可以讓路，
硬加一個 `setImmediate` 只是多一輪事件迴圈、沒有任何收益。

⚠ Rule 33（否定型斷言要配正對照）：守衛⑦除了斷言「這一支測不到 cursor 迴圈」，
還**同時**去抽 v6.242 的 `/api/admin/deck-archetype-detail`，要求那一支**必須**被偵測到
有 `for await` 迴圈與 `adminScanYield` —— 否則「偵測不到」與「偵測器壞了」長得一模一樣。

實測（沙盒；⚠ 假 driver 把聚合放在 node 端算，正式站沒有這段成本）：
只餵該玩家的 137 筆時，handler 端到端 **8ms**、並行探針最大延遲 **0.0ms**。
（全站 25,000 筆餵進迷你直譯器是 301ms／133.7ms，那是**測試自己的**成本，不是線上行為。）

### 【D】`/api/admin/player-profile` 的 `tournamentArchives` `.limit(200)`：**判定不會失真，不動**

站長 2026-08-27 在 VM 實測的量級：`tournamentArchives` 全站 **875 筆**。
該查詢是 `ARCH.find({ 'players.email': email }, {projection…}).sort({finishedAt:-1}).limit(200)`
—— **有 email 過濾**，所以單一玩家的筆數上界就是「他參加過的賽事數」，而那又 ≤ 全站 875。
要撞到 200，必須有人參加過全站 **23%** 的賽事。⇒ 現況不失真，**不動**（別為了改而改）。

⚠ 但它是「靜默截斷」型，所以改用守衛鎖住三件事，而不是靠記憶：
上限**不得被改小**、`players.email` 過濾**不得消失**、projection **不得把 `deckEntries` 讀回來**
（那是 v6.240 讀放大事故的主因）。
⚠ 重新評估的觸發點：等 `tournamentArchives` 逼近 **870 × 幾倍**，或站長看到某位玩家的
「錦標賽參賽」數字剛好卡在 200，就要回來處理。

### 【E】守衛

`scripts/test-v6243-player-detail-scope.mjs`（14 條）—— 一律斷言到**行為**：
把 handler 從出貨檔抽出來，配一個**迷你 mongo aggregate 直譯器**真的跑
（只實作這兩條 pipeline 用到的 stage／運算子，遇到沒實作的一律 throw，
**不靜默略過** —— 否則「聚合被改壞」會長得跟「測試沒測到」一樣）。

fixture：全站 25,000 筆，目標玩家 **137 場**散落其中、輪流當 p1／p2；
只在「第 31 場以後」的舊場才有 `old_only` 這張卡，對手側另有 `c_opp`、其他玩家另有 `c_other`。
⇒ 一組 fixture 同時驗四件事：統計吃到全部 137（`old_only` 必須進得了 Top 20）、
顯示只回最新 30、`$cond` 取的是自己那一側（`c_opp` 不得出現）、email 過濾有效（`c_other` 不得出現）。

儀器：①`aggregate` 的 `$match` 之後／第一個 `$group` 之前**不得有任何** `$limit`／`$skip`／`$sample`
②`find` 實際命中幾筆 vs 實際物化幾筆 ③回應體積 bytes。

⚠ **沒有 HEAD-FAIL 的功能性缺陷**（出貨碼本來就是對的），所以正對照改用**突變測試**：
- 突變 A：在 `$match` 後插 `{ $limit: 30 }` ⇒ ①②③ 必須翻紅（實測 `summary.matches` 137→30、`old_only` 消失）
- 突變 B：把 `recentMatches` 換成全量 ⇒ ④⑤ 必須翻紅（實測體積 4.7 倍）

真正的 HEAD-FAIL 有兩條：⑧（本文件與出貨碼註解已更正那句錯誤描述）與⑪（版本 ≥ 6.243）。
BASE（v6.242）上實測 **12 PASS / 2 FAIL**。

⚠⚠ 本版**沒有任何刪除資料的路徑**，也沒有動到任何玩家端程式碼
（只改 `oracle-admin/` 的註解、`docs/`、`version.ts`／`SITE_VERSION_HINT`、新增一支測試）。

## v6.242 — 休閒側 `matchRecords` 的 `.limit(20000)` 也拿掉；⭐ 順便修掉一個既有的事件迴圈阻塞

> 站長裁定：v6.240／v6.241 收掉的統計上限，休閒側這一支「一起處理」。
> 首頁 changelog **不寫**（純 admin 後台工具，玩家看不到）。

### 【A】改了什麼

`/api/admin/deck-archetype-stats`（總表）與 `/api/admin/deck-archetype-detail`（明細）的
**休閒來源**原本是：

```js
.find(q, { projection: { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })
.sort({ endedAt: -1 }).limit(20000).toArray();
```

與 v6.240／v6.241 同一類毛病：這兩支是**統計聚合**（原型使用次數／勝率、原型內每張卡的
採用率與條件勝率差），限制筆數不是「少顯示幾列」，而是讓**統計數字本身失真**
（只算最新 20000 場）。⇒ 改 cursor 逐筆餵給**既有聚合程式碼（一字未動）**。

### 【B】⭐⭐ 但這一支跟前兩支有一個關鍵差異：**cursor 解決記憶體，不解決時間**

v6.241 的結論「改 cursor 就好」在**這一支不成立**，因為量級差一個數量級。實測（守衛 ⑤ 內附
量測腳本，沙盒；⚠ 沙盒 CPU 約為正式 VM 的 10 倍慢）：fixture 60,000 筆、mongo 一批 8,000 筆
（16MB ÷ 每筆約 443B），並行探針模擬「玩家的請求每 5ms 要被服務一次」：

| | 進入統計 | handler 耗時 | ⭐ 玩家被連續擋住 |
|---|---|---|---|
| **改前** `limit(20000).toArray()` | 20,000（失真） | 431 ms | **max 431 ms**（一發同步阻塞） |
| 改後・只有 cursor、不讓路 | 60,000 | 1,304 ms | **max 176 ms**（每批一次） |
| **改後・出貨碼**（每 200 筆 `setImmediate`） | 60,000 | 1,354 ms | **max 6~7 ms／p99 ~6 ms** |

**為什麼純 cursor 不夠**：mongo 是一批一批送的，一批進到 node 之後，批內每一次
`cursor.next()` 都是「**已解決**的 promise」⇒ `await` 只排空 **microtask**，事件迴圈
**不會**回頭去跑玩家的 socket 回呼。⇒ 新增中央 `adminScanYield(n)`：每 200 筆回一個
`setImmediate` 的 Promise（**macrotask**，check 階段，pending I/O 會先跑），
不到節拍回 `null`（連 microtask 都不排）。額外成本：總耗時 +約 4%。

⭐ **這一版同時修掉一個既有的風險**：`limit(20000).toArray()` 本來就是一發 431ms（沙盒）
／約 43ms（VM 換算）的**連續同步阻塞**。所以「全量掃描比較危險」這個直覺是反的 ——
改後每一段阻塞都比改前短兩個數量級。

### 【C】上限／時間範圍：**不加新上限，沿用既有的 `?since`**

- `?since` **早就有**，逐字查證（BASE `887a4c08`）：`deck-archetype-stats` 與
  `deck-archetype-detail` 都讀 `req.query.since`（缺席＝`0`＝不限），往下傳給
  `buildCasualCleanFilter({ excludeAI, since })` → `endedAt: { $gte: since }`（L957）。
  admin UI 的下拉 `#arch-since` 是「**全部時間**（預設）／7／30／90 天」，
  由 `currentArchSince()` 換算成 epoch 毫秒（`admin.html` L2668、L4857）。
  ⚠ 更正一個容易混淆的點：站長印象中的「v0.26、24h／7d／不限」是**2.3 卡牌勝率**那組
  （`winrateRange`，`/api/admin/stats/cards/winrate`），跟這一支是**兩套不同的下拉**。
  ⇒ **不另起爐灶**：要縮範圍站長自己選，要全量就選「全部時間」並自行承擔耗時。
- **不保留硬上限**。理由：①有上限就有「數字是錯的但看不出來」的風險（這正是站長要修的事）
  ②端點是 admin 專用 + 60 秒 TTL 快取 ③讓路之後最長阻塞已在毫秒級，`Rule 30` 的紅線守得住。
- `scanned.casualMatches` / `scannedSrc` 誠實回報實際掃了幾筆（總表在畫面上就有一行
  「掃描 N 場對戰、M 副牌組」）。

### 【D】`MI_SCAN_CAP.casual` 的示警：從「準確」變成「會說謊」⇒ 必須改

`admin.html` 的報告圖趨勢推導在「寬窗掃描筆數 ≥ 上限」時會停用趨勢箭頭。
上限是**寫死在前端**的數字，後端一改就靜默失準 —— 留著 `20000` 的話，等 `matchRecords`
超過 2 萬筆，明明已經是全量掃描，趨勢卻會被永遠關掉並謊稱「已達伺服器查詢上限」。
⇒ `casual` 由 `20000` 改 `Infinity`（與 v6.241 對 `tourn` 的處理一致）。

⚠ **機制本身刻意保留、不刪**：只要哪天有人把 limit 加回去，把數字換回去趨勢就會自動停用。
為了不讓它變成「永遠綠的安慰劑」，`test-deck-meta-image.mjs` 改用**突變**做正對照
（把上限塞回 20000 ⇒ 那道閘必須真的按得動），並新增一條「出貨值 Infinity 時掃到 20000 筆
不可以被誤判成撞上限」。

### 【E】⚠ `matchRecords` 到底有幾筆 —— **量不到，只能給下界**

沙盒**連不到正式站的 MongoDB**（admin 端點要 Firebase admin token，沙盒也沒有 mongo URI）。
可觀測的下界：v6.240 實測 Oracle 房間「已結束」**82,031 筆**；`matchRecords` 由 client 在
game-over 時上報，**線上房＋本機雙人＋對 AI 都會寫**（淨化 filter 只在統計時排除無房號的）
⇒ 量級**至少 10⁴、上看 10⁵**。設計是照 20 萬筆的上界做的（沙盒 4.7 秒／VM 換算約 0.5 秒，
且期間最長阻塞在毫秒級）。⚠ 站長若能在 VM 上跑一次
`db.matchRecords.countDocuments({})`，可以把這個數字釘死。

### 【F】順手掃過的其他 `.limit(N)`（**本版不動**，列出來給站長裁定）

| 位置 | 是「統計失真」還是「顯示上限」 | 建議 |
|---|---|---|
| L1577 `/api/admin/stats/players/:email` `matchRecords…limit(recentLimit)`（預設 30、上限 200） | ~~**兩者之間**~~ ⇒ **v6.243 查證後更正：純顯示**。它只套在 `recentMatches`；`summary` 與「常用卡 Top 20」走另外兩支 aggregate、本來就是全量，而且這一頁**沒有「勝率走勢」區塊** | **不動**（理由見 v6.243） |
| L1911 `/api/admin/player-profile` `tournamentArchives…limit(200)` | **統計失真候選**（跨賽事戰績摘要）；但一筆＝一場賽事，200 場賽事還很遠 | 暫不動 |
| L2163 `/api/admin/deck-rules/preview` `limit(20~1000)` | **顯示／試算**：卡面就寫「對最近 N 場試算」，本來就不是統計 | 不動 |
| L6547/6548 `/api/tournament/champions` `limit(100)`×2 | **顯示上限**（名人堂列表） | 不動 |
| L7329 `dpEligibility` `limit(20)` | **顯示**（我最近可投稿的賽事） | 不動 |
| L593/618/698/5543/5549/7192… 聊天／留言／訂閱／掃描批次 | 全是**營運用**，與統計無關 | 不動 |
| 2.3 卡牌勝率 `/api/admin/stats/cards/winrate` | ⭐ **本來就沒有上限**（走 mongo `aggregate`，伺服器端算完才回） | 無事 |

### 守衛

`scripts/test-v6242-casual-fullscan-eventloop.mjs`（11 條）——一律斷言到行為：
把兩支 handler 從 patch 檔抽出來，餵 **25,000 筆假 matchRecords 真的跑**，
用「這次查詢實際物化幾筆／有沒有走 `toArray`／projection 有沒有被動過」當儀器；
⑤ 用**並行探針**量事件迴圈（⚠ `monitorEventLoopDelay` 在完全同步的區段量不到東西，
「沒東西」與「儀器壞了」長得一樣 —— Rule 33），並含兩組正對照（拿掉讓路／還原成
`limit(20000).toArray()` 都必須量得到 >40ms 的連續阻塞）。含突變測試：把
`limit(20000).toArray()` 加回去 ⇒ ①③ 必須翻紅。BASE(v6.241) 上 **2 PASS / 9 FAIL**
（那 2 條是保護性斷言：淨化規則未被繞過 + 資料保全）。

⚠ 一併更新兩支既有守衛（**判準沒有放寬，只是把過期的常數換成不變量**）：
- `test-v6241-…` 的「`MI_SCAN_CAP.casual` 必須維持 20000」已隨本次裁定過期（且 regex 的
  `(\d+)` 吃不下 `Infinity`）⇒ 只守原始意圖「`tourn` 不可被改回 200」；
  版本斷言由寫死 `'6.241'` 改成 `≥ 6.241`（寫死會讓下一版無故翻紅，接著就會有人去 skip 它）。
- `test-deck-meta-image.mjs` 見【D】。

⚠⚠ 全程**沒有任何刪除資料的路徑**：`matchRecords` 沒有 TTL 索引、沒有 `deleteMany`／`drop`，
唯一的刪除點是 admin 手按的 `DELETE /api/admin/match-records/:matchId`（`deleteOne`，1 處）。

### 部署

`oracle-admin/server_admin_patch.js` ＋ `oracle-admin/admin.html` 有改
⇒ **`update-admin-full.bat`**（scp 兩支 + pm2 restart，端點與 admin 前端都要新的才對得上）。
`src/lib/version.ts` 有改 ⇒ **`redeploy-oracle.bat`**（讓 www.ptcg-tw-sim.com 的版本號跟著走）。
`static/cards/` 與 `engine`／`effects`／`server-engine` **一個字都沒動**
⇒ **不需要** `update-tournament.bat`。

⚠ 兩支 bat 的先後不影響正確性（admin 前端在新舊伺服器上都不會壞：`scanned` 欄位新舊皆有，
`MI_SCAN_CAP` 只是把閘放寬），但建議先 `update-admin-full.bat`。

## v6.241 — 捷拉奧拉「麻麻關節」卡面文字更正（官方頁面自己打錯）；牌組原型統計改全量

> 站長的兩項裁定。【A】玩家看得到（卡面文字）⇒ 首頁 changelog 寫一則；
> 【B】純 admin 後台 ⇒ **只寫這裡**。

---

### 【A】🔴 `捷拉奧拉｜麻麻關節`（SVQP，cardId 13145）

#### 站長原話

> `SVQP` 應該是「**擲1次硬幣若為正面，則將對手的戰鬥寶可夢【麻痺】。**」
> 會出錯的原因是**官方訓練家網站的文字出錯**，導致我們的爬蟲當時也跟著錯，**不是我們的問題**，
> 但請你還是改成正確的內容。

#### 改前／改後逐字（先讀原文再改，確認除了「可」字沒有別的差異）

| | 逐字 |
|---|---|
| 改前（我們的 DB＝官方頁面原文） | `擲1次硬幣若為正面，則可將對手的戰鬥寶可夢【麻痺】。` |
| 改後（站長指定） | `擲1次硬幣若為正面，則將對手的戰鬥寶可夢【麻痺】。` |

**逐碼位比對的結論：只差那一個「可」（U+53EF），其餘完全相同** ——
逗號都是全形 `，`(U+FF0C)、括號都是 `【】`(U+3010/U+3011)、句號 `。`(U+3002)、
數字 `1` 是半形 (U+0031)，長度 26 → 25。`cur.replace('則可將','則將') === 目標` 為 true。
⇒ **沒有其他差異要請站長裁定。**

同名同招式的另外兩個印刷本來就正確，改完三者逐字相同：

| 卡包 | cardId | effect |
|---|---|---|
| MC | 16737 | `…則將…` ✅ |
| SV5M | 9870 | `…則將…` ✅ |
| SVQP | **13145** | `…則可將…` → **`…則將…`** |

#### 官方頁面現況（v6.241 實抓）

`https://asia.pokemon-card.com/tw/card-search/detail/13145/` 用 repo 自己的
`scripts/scrape/parse-card.js` 重新解析（不另寫解析器），**官方今天仍然寫「則可將」**。
⇒ 稽核工具下次跑到 SVQP 一定會把它報成 `attacks` 欄差異。

#### ⭐⭐ 必做：登記進「刻意偏離官方」白名單

`scripts/audit-card-data-vs-official.mjs` 的 `KNOWN_INTENTIONAL_DIVERGENCES`
（v6.232 為「老大的指令」建立的同一份）新增一筆 `{ id:'13145', field:'attacks', ours, official, reason }`。

⚠ **不加的後果**：下次跑稽核會被報成差異 → 然後被「修」回官方那個錯字。這一步不可省。

⚠ **fail-open 性質確認仍在**：比對條件是
`w.id===id && w.field===f && normText(w.ours)===d.ours && normText(w.official)===d.official`
—— **兩側值逐字匹配才豁免**。所以

- 官方哪天把錯字修掉（或改成別的字）⇒ `official` 對不上 ⇒ **回到差異報告**
- 我們自己的資料被誰動到 ⇒ `ours` 對不上 ⇒ **回到差異報告**
- 官方修成跟我們一樣 ⇒ `diffField` 直接回 null ⇒ 根本沒有差異

⚠ `field:'attacks'` 的 `d.ours` / `d.official` 是**整個 attacks 陣列**經
`normAttacks` 正規化後的 `JSON.stringify`（`cost` 會被排序成 `Colorless+Lightning+Lightning`），
不是單一招式的 effect —— 白名單那兩個字串必須照這個格式寫，寫錯就永遠命中不了。

守衛 ⑤ 是這條性質的**正對照**：分別突變「官方側」「我方側」「白名單那一筆的值」，
三種情況都必須回到 `gameDiff`。

#### ⚠ 實戰行為完全沒有改變

`effects.ts` L3854：`regPost('捷拉奧拉|麻麻關節', coinStatusPost('paralyzed'))` ——
擲 1 次幣、正面就**必定**施加【麻痺】（走 `canApplyEffectToTarget('attack-effect')` 免疫閘），
反面只寫 log。**本來就沒有「要不要麻痺」的選擇視窗**。
⇒ 改文字之後**資料與實作反而一致了**，不是行為改變。

守衛 ⑦⑧ 是行為端斷言（不是讀字串）：用 `_retryInjectedFlipsQueue` 固定擲幣結果真的跑那一招，
斷言正面 ⇒ `status==='paralyzed'` 且 `pendingSelection===null`；再與卡面本來就寫「則將」的
`火斑喵|擊掌奇襲` 逐項對照，兩張卡結果必須完全相同。
⚠ 這兩條在 BASE(v6.240) 上就是綠的 —— 那正是「行為沒變」要證明的事。

#### 順手清一個死條目

`scripts/audit-samename-collision.mjs` 的 `KNOWN` 有一筆
`'捷拉奧拉|麻麻關節', // 「可」字差異，效果同`。三個印刷逐字一致之後它**不再是碰撞**，
留著會是永遠命中不了的死條目（Rule 28）⇒ 移除，改成一行說明。
該工具是純報告（`process.exit(0)`、不在 `npm test` 內），已知無害組數由 5 降為 4。

---

### 【B】牌組原型統計移除 `limit(200)`（站長裁定：「一起拿掉」）

v6.240 把這兩處列為「同樣是統計失真，但屬牌組原型分頁 ⇒ 本版不動，待站長裁定」。這一版做掉。

#### 先分辨：這兩處是「統計」還是「顯示」

| 位置（BASE v6.240 行號） | 端點 | 那些歸檔拿去做什麼 | 判定 |
|---|---|---|---|
| **L2282** | `/api/admin/deck-archetype-detail` | 逐副牌 `absorb()` 累積成「原型內每張卡的採用率／眾數張數／代表 60 張／遺珠之憾的條件勝率差」 | **統計** |
| **L2608** | `/api/admin/deck-archetype-stats` | 逐副牌 `tally()` 累積成「每個原型的使用次數／勝／負／平／勝率」＋未分類高頻卡 | **統計** |

（v6.239 的行號是 L2217 / L2536；v6.240 動過這個檔，行號往後位移。）

兩支的**回應大小都與掃了幾場歸檔無關**（明細回 `cards.slice(0,120)`＋60 張牌表；
總表回每個原型一列）⇒ 拿掉上限不會讓回應變肥，只會讓數字變正確。

#### 怎麼處理：cursor 逐筆，不搬去 mongo aggregate

⚠⚠ 紅線是 v6.240 才抓到的事故：admin 的端點把 **1.1 GB** 讀進**玩家共用的** node 行程。
所以不能只是把 `.limit(200)` 刪掉了事（那會變成 `toArray()` 整包全量）。

- ⭐ **不搬去 mongo aggregate**：分類走的是本檔 node 端的 `deckToSets` / `classifyDeck`
  （`classifyDeck` 的註解已經寫明：總表與明細若不同版，同一副牌會被分到不同原型）。
  搬去 mongo 會多出第三份口徑，必然漂移。
- ⇒ **改用 cursor 逐筆餵給既有的聚合程式碼**（v6.240 champion-report 就是這樣做的）：
  `const _cursor = db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 });`
  `for await (const a of _cursor) { … }`。**聚合程式碼一字未動**，只換「資料怎麼來」。

#### 讓「是不是全量」看得見

- 總表：`scanned.tournEvents` 由 `archives.length` 改成迴圈內 `++`（口徑不變，值變成全量）。
- 明細：**新增** `scannedSrc`（錦標賽＝歸檔場數／休閒＝對戰場數）。原本這支完全沒有回報掃了幾筆，
  一旦有上限就是靜默失真。
- `admin.html` 的 `MI_SCAN_CAP.tourn` 由 `200` 改成 `Infinity` ——
  那是「撞到查詢上限就示警」的誠實標示；不改的話歸檔一超過 200 場就會**永遠**誤報
  「資料量已達伺服器查詢上限，前期不完整」。休閒側的 `20000` 不動（見下）。

#### 量化（守衛 ①③ 的 fixture ＋ ⑦ 的 benchmark，都是真的跑 handler）

| | 進入統計的歸檔 | 進入統計的牌組 | 同時駐留 | handler 耗時 |
|---|---|---|---|---|
| 改前（`limit(200).toArray`） | 200 場 | 4,800 副次 | 一次物化 200 筆 ≈ **1.15 MB** | 81 ms |
| 改後（cursor 全量） | **3,000 場** | **72,000 副次** | 同時只有 1 筆 ≈ **5.9 KB** | 499 ms |

（fixture＝3,000 場、每場 8 人 × 60 張 × 12 局，每筆歸檔約 5.9 KB；沙盒 CPU 約為正式 VM 的數倍慢。）

⇒ **同時駐留量由 O(N) 變成 O(1)**（1.15 MB → 5.9 KB，而且改前那 1.15 MB 還是「只算 200 場」的版本；
若只把 limit 刪掉不改 cursor，3,000 場就會是 ~17 MB 一次進記憶體）。
每場歸檔的處理成本 **166 µs**（沙盒），端點本來就有 **60 秒 TTL 快取**，
站長在那一頁切換原型不會重算 ⇒ **admin 不會變慢**。

⚠ **線上實際的歸檔場數本工作階段查不到**（沒有 DB 連線，`tournament-dumps/` 裡的 dump 是對戰紀錄不是歸檔統計）。
可推論的下界：站長回報「賽事統計只顯示 500 筆」⇒ 歸檔**超過 500 場**
⇒ 牌組原型那一頁改前只吃到**最新 200 場**（不到全量四成），改後 100%。
確切數字改版後直接看那一頁新回的 `scanned.tournEvents`（總表）與 `scannedSrc`（明細）。

⚠ 站長已知「拿掉之後那一頁的統計數字會變（變成正確的）」——這是預期的。
使用次數與勝負場數會**變多**，勝率會往真值移動；原本被 200 場窗口切掉的舊原型會重新出現。

#### 刻意不動的部分

| 位置 | 為什麼不動 |
|---|---|
| 休閒側 `matchRecords … .limit(20000)`（兩支端點各一處） | **不在站長這次的裁定範圍**。它同樣是統計失真的候選，但 `matchRecords` 的量級與 `tournamentArchives` 差很多，改法要另外評估（`MI_SCAN_CAP.casual` 仍會誠實示警「已達伺服器查詢上限」）。 |
| `/api/tournament/admin/stats`、`champion-report` | v6.240 已處理。 |
| 玩家端任何路徑 | 完全沒碰。這兩支都是 `requireFirebaseAdmin`。 |

#### ⚠⚠ 資料保全

**沒有刪除任何資料**。`tournamentArchives` / `tournamentChampions` 仍然沒有 TTL 索引、
沒有 `deleteMany`／`drop`，唯一的刪除點還是 admin 手按的三個 `deleteOne`。守衛 ⑥ 把這件事鎖住。

---

### 守衛

`scripts/test-v6241-zeraora-text-and-archetype-fullscan.mjs`（18 條，掛進 `npm test` 末端）

- 【A】①逐字（含逐碼位）②三個印刷一致 ③全站同型措辭掃描（附下限斷言 ≥60，Rule 25）
  ④白名單真的命中（把 audit 的白名單＋`diffField`／`normAttacks` 抽出來**真的跑**）
  ⑤**fail-open 正對照**（突變官方側／我方側／白名單值，三者都必須回到差異報告）
  ⑥同名碰撞豁免清單不得留死條目 ⑦⑧**行為端**實跑該招（正面必麻痺、無選擇視窗；與同族卡逐項相同）
  ⑨校驗和（4,935 張、42 個卡包逐包張數）
- 【B】前提（無 `limit(200)`＋有 `for await`）①②明細全量＋**`toArray` 必須為 0 筆**
  ③總表全量 ④**突變測試**（把 `limit(200).toArray()` 加回去 ⇒ ①②③ 必須翻紅）
  ⑤`MI_SCAN_CAP.tourn` ⑥資料保全 ⑦benchmark
- 版本一致（`version.ts` = `SITE_VERSION_HINT`）

**HEAD-FAIL（BASE `e5add494` v6.240）：14 FAIL / 4 PASS。**
那 4 條綠的分別是 ⑦⑧（行為未變 —— 本來就該綠）、⑨（校驗和）、【B】⑥（資料保全），
全部是保護性斷言，不是漏網。

### 部署

`static/cards/` 有改 ⇒ **必須跑 `update-tournament.bat`**（否則錦標賽伺服器端的卡片文字仍是舊的）。
`oracle-admin/` 有改 ⇒ `update-admin-full.bat` + `redeploy-oracle.bat`。

## v6.240 — admin 兩支「撈太多」的端點改伺服器端分頁；賽事統計終於是全量

> 站長回報兩件事，都是同一類毛病：**把整個 collection 撈回來再在記憶體裡切**。
> 首頁 changelog **不寫**（純 admin 後台工具，玩家看不到 —— 站長已裁定）。

### 【A】📈 賽事統計只顯示 500 筆 —— 資料**沒有**被刪，是讀取查詢的上限

站長最在意的是「多餘的是被刪除了嗎」。逐項查證（`git grep` 全 repo，BASE `51758797`）：

| 檢查項 | 結果 |
|---|---|
| `tournamentArchives` / `tournamentChampions` 有沒有 **TTL 索引** | **沒有**。全檔只有兩條 TTL：`tournamentClientDiag`（7 天，L4541）、`tournamentReplayTurns`（90 天，L5739） |
| 有沒有 `deleteMany` / `drop` 動到它們 | **沒有**（全檔 `deleteMany` 共 11 處，對象是 rooms / messages / TREGS / TMATCH / TCHAT / TPUSH / TREPLAY） |
| 有沒有排程／清理會動到它們 | **沒有**。`startZombieRoomCleanup` 只刪 `rooms`（ended > 90 天）；scheduler 只刪「已結束賽事底下沒打完的 TMATCH」 |
| 刪賽事會不會連歸檔一起刪 | **不會** —— L5367 明文 `// 註：tournamentArchives 永久歸檔不刪` |
| 唯一的刪除點 | admin「🗑️ 刪除」按鈕：`TARCHIVE.deleteOne` + `TCHAMPS.deleteOne`（站長自己按的） |

⇒ **賽事歸檔一筆都沒有被自動刪過**。500 是 `/api/tournament/admin/stats` 的 `.limit(500)`。

### 【A】哪些 limit 影響「統計正確性」、哪些只影響「顯示」

⚠ 這一頁的**每一個數字**（完成賽事／累計報名人次／不重複玩家／對戰場數／平均人數／
冠軍榜／玩家戰績排行／主力寶可夢使用率＋勝率／賽果分佈）都是 **admin.html 拿整包
`archives` 在瀏覽器端算的**（`renderTournamentStats`）。所以：

| 位置 | 性質 | 處理 |
|---|---|---|
| L7713 `TARCHIVE…limit(500)` | **影響統計正確性**（前端整包聚合） | 改伺服器端分頁 `skip/limit` + 回 `total`；前端 `fetchAllTournamentStats` **逐頁累積成全量**再聚合 |
| L7714 `TCHAMPS…limit(500)` | 只影響顯示，而且 **admin.html 從未讀取這個欄位**（名人堂走 `/api/tournament/champions`） | 直接移除上限（每筆很小） |
| L2448 `champion-report…limit(500)` | **影響統計正確性**（奪冠／四強牌組原型，伺服器端算） | 移除上限，並改 **cursor 逐筆聚合**，不把含 `deckEntries` 的全部歸檔一次讀進 node |
| L528 / L633 `messages…limit(500)` | 單一房間的聊天訊息，與賽事統計無關 | **不動** |
| L2217 / L2536 `tournamentArchives…limit(200)`（牌組原型統計） | 同樣是統計失真，但屬「牌組原型」分頁 | **本版不動**，待站長裁定（改了那一頁的數字會跟著變） |

⭐ 為什麼不是「在 DB 端 aggregate 算完再回」：聚合邏輯（主力寶可夢偵測 `detectMainPokemon`
依賴 `cardInfoMap` + `cardTagsCache`，兩份都是**瀏覽器端**才有的資料）搬到 mongo 會變成
兩份口徑、必然漂移。分頁累積讓**聚合程式碼一字未動**，只換「資料怎麼來」。

⚠ 向後相容：`/api/tournament/admin/stats` 沒帶 `?page=` ⇒ page 1 / pageSize 500 ⇒
`archives` 與 v6.239 逐字相同（舊快取頁面不會壞）。

### 【B】🎮 Oracle 對戰「已結束」8 萬多筆，點進去就當掉

真因不是「前端沒分頁」（v5.276 就有每頁 50 筆了），是 **`/api/admin/oracle/rooms`
`find(_filter).sort().toArray()` 完全沒有上限**，而且 projection 還帶著 `gameState.log`
（v6.220 實測第 9 回合 202 則 ≈ 29.2KB，佔房間 doc 約 60%）。

量測（守衛 ⑨ 內附的 benchmark，4,000 筆樣本線性外推到 82,031 筆；沙盒 CPU ≈ 正式 VM 的 10 倍慢）：

| | mongo→node | 下行 JSON | node 序列化 | 瀏覽器 `JSON.parse` |
|---|---|---|---|---|
| 改前（整包撈） | **1,166 MB** | **111 MB** | ~1,826 ms | ~1,500 ms（還沒開始建 8 萬列 DOM） |
| 改後（一頁 50 筆） | 0.7 MB | 0.1 MB | ~1.1 ms | ~0.9 ms |

⚠⚠ 那 1.1 GB 是讀進**共用的 API 行程**（沙盒重現時直接被 OOM kill，exit 137）——
這不只是 admin 自己的問題，有機會把玩家一起拖下水。

**修法**
1. **伺服器端分頁**：`?page=&pageSize=`（預設 50、上限 200），`countDocuments` 回 `total`／`totalPages`。
2. **時間範圍**：`?range=7d|30d|90d|all`，條件用 `updatedAt`（與 sort 同欄位才走得到索引）。
   admin UI 預設 **近 7 天**，可切 30／90／全部。`counts`（toolbar 的三狀態計數）套用同一個範圍。
3. **搜尋改伺服器端**：分頁之後前端手上只有 50 筆，本機搜尋只搜得到那一頁。
   比對房號／房間名／玩家名／email／**牌組卡名**（卡名→cardId 解析放伺服器端，
   沿用 v6.218 牌組公布欄的做法，client 不必為了搜尋載 4.6MB 卡片DB）；debounce 350ms。
4. **索引**：`rooms` 除了 `_id` 沒有任何索引。啟動時 best-effort 建 `{status:1, updatedAt:-1}`
   （比照 TEVENTS/TREGS 先例，不放進 request handler）。
5. **舊路徑（沒帶 `?page=`）**：保留，但加 `ROOMS_LEGACY_CAP = 2000` 硬上限 + `truncated` 哨兵。
   理由見上面那 1.1 GB —— 讓「瀏覽器快取到舊 admin.html」也不可能再打爆共用行程（Rule 30）。
6. 回應帶 **`paged` 哨兵**：舊伺服器不會有它 ⇒ 新前端自動退回 v6.239 的前端切頁，
   而不是把「伺服器只回的一頁」誤當成全部（v6.218 教訓）。

⚠ Firebase 對戰分頁**完全不動**（`renderRoomsTab` 只在 `srv` 非 null 時走新路徑）。

### 守衛

`scripts/test-v6240-admin-pagination.mjs`（18 條）——一律斷言到行為：把兩支 handler 從
patch 檔抽出來，餵 **82,431 筆假房間 / 1,234 筆假歸檔真的跑**，用「這次查詢實際物化了幾筆」
當儀器；前端的 `fetchAllTournamentStats` 也是**抽出來真的跑**（不是重寫一份）。
含突變測試：把 `skip/limit` 拿掉、把 `limit(500)` 加回去 ⇒ 對應斷言必須翻紅。
BASE(v6.239) 上 **15 FAIL / 2 PASS**（那 2 條是保護性斷言：版本一致 + 歸檔不得有 TTL/批次刪除）。

⚠ `scripts/test-v6229-admin-archetype-parity.mjs` 只改 **harness stub**（假 cursor 補
`skip/limit`、`filterRoomsBySearch` 的 prelude 補 `oracleRoomsSrv = null`），判準一字未改。

## v6.239 — 傷害公式收斂成單一來源；「若希望」招式的預估不再替玩家決定

### 【A】站長回報：「波動突刺 有列出數值了，但是不像超級勇氣那樣有列出完整的算式」

**實跑重現**（harness，超級路卡利歐ex + 極限腰帶 + 力量蛋白飲，打弱【鬥】的伊布ex）：

| 招式 | 走哪條路徑 | 對戰紀錄 | 預估 |
|---|---|---|---|
| 超級勇氣 | engine ATTACK 主管線 | `…造成 700 點傷害！【[270(基礎) +50(極限腰帶) +30(力量蛋白飲)] ×2(弱點) = 700】` | `預估 700（極限腰帶 +50、力量蛋白飲 +30、弱點 ×2）` |
| 波動突刺 | 中央 `dealAttackDamageToTarget` | `波動突刺：伊布ex 被擊倒！+2 張獎賞卡。`（**傷害數字都沒有**） | `預估 420`（`formula: ''`） |

**真因**：`composeFormula` 原本是 engine.ts `ATTACK` handler 內的**區域閉包**（BASE L5807），
effects.ts 拿不到 ⇒ 中央 helper 那條路徑**從來沒寫過公式 log**。
`damage-estimate.ts` 的 `pickFormula` 是從 log 解析算式的 ⇒ 解析不到就只剩數字。
⭐ 所以這不只是預估的問題：**對戰紀錄本身也少了那一行**，修好同時改善兩邊。
（長期記憶「傷害公式漏減傷項；helper 減傷也要寫 log」講的是 v5.900 補的**個別減傷 log**，
那次補的是「鐵之防禦 -30」這種單項說明，**沒有**補整段公式 —— 這一版才把公式本身接上。）

**修法（中央收斂，不是在預估端再拼一份字串）**
1. `composeFormula` → 提升成模組層級的 `export function composeAttackFormula`（engine.ts），
   引擎主管線與 `dealAttackDamageToTarget` **共用同一支**。突變測試把它改一個字元，
   兩條管線的輸出必須**同時**跟著變（守衛 ⑤）。
2. `dealAttackDamageToTarget` 收集公式項：`applyAttackerActiveDamageBonuses` 本來就回傳
   `formula`（被丟掉）、`applyDefenderReductionsBlockA` 的 `_fm` 自 v5.544 起建了就丟、
   `applyWeakRes` 新增可選 out-param（label 逐字沿用引擎的「弱點」「抵抗力」）、
   「下次被擊減傷」「變硬」各補一項。
3. `attackFormulaReconstructs` fail-closed：逐項算下來 ≠ 最終傷害就**不印公式**
   （擲幣免傷等少數來源沒把自己寫成項；寧可沒有算式，也不猜一個標籤把帳湊平）。
4. `pickFormula` 收緊處**改判準**：v6.238 用「含 `(基礎)`」認公式，但 `breakdown` 型招式的
   基礎項標籤不叫「基礎」（倫琴貓｜猛力進攻 `280(已取獎賞 4×70)`、故勒頓｜原生亂打
   `90(古代寶可夢 3×30)`）⇒ 那些招式的預估同樣少了理由。改成**形狀**比對。

**對戰紀錄不會多出新的一行**：`【…】` 接在這條路徑本來就會寫的那一行後面
（未昏厥＝「造成 N 傷害」／昏厥＝「被擊倒！+N 張獎賞卡。」）。

**全卡池行為比對**（2093 招，攻擊方一律附極限腰帶讓每招都有修正項）：
BASE 有 8 招「對手戰鬥位有傷害卻沒有公式」→ 修後剩 2 招，且那 2 招（倫琴貓｜猛力進攻、
故勒頓｜原生亂打）其實**有**公式，只是掃描器的 `(基礎)` regex 認不得（見上面第 4 點，
Rule 25「掃描器自身要先驗」的實例）⇒ 實質 0 缺口。
預估文案掃描 2590 招：25 招變好（18 招多出理由、7 招從單一數字改成「若希望」範圍），**0 招退步**。

### 【B】站長裁定：弦月光芒「應該要讓玩家選擇要不要翻」

⚠ **逐字查證後，對戰中其實已經會問**（不是漏做）：
`ATTACK_PRE_DISCARD_CHOICE.set('克雷色利亞|弦月光芒', { scope: 'binary-yes-no', … })`
（`v2760_h_wave3_complex.ts` L162，v5.878~v5.882 就實裝了），UI 由
`+page.svelte` `initiateAttack()`（L7004~7017）開 modal、模板在 L12221（縮排 2＝
與手機直式區塊平行，兩種版面都會顯示），手機直式經 `onInitiateAttack` 走同一支。
實跑：送 `discardedEnergyIids: []` → 80 傷害且獎賞不翻；送 `['yes-token']` → 160 且翻 1 張。

**真正沒問的是「預估傷害」的乾跑**：它送出的 `ATTACK` 不帶答覆，而這一族的
`regPost` 對「沒帶答覆」一律當成「希望」（AI／舊 state 的 fallback，見
`slowking_lucario_deck.ts` L118~127 的 v5.720 註解）⇒ 預估永遠只報 160，
玩家看不到「不翻＝80」，而發動是有代價的（獎賞被翻開）。
⇒ 預估對「有 `ATTACK_PRE_DISCARD_CHOICE` 宣告」的招式多跑一次「否」（送空陣列，
與玩家按下「否」時送出的 action 逐字相同），兩邊不同就報範圍並標「若希望」。
⚠ 能量 picker 型（激流水泵等）的「沒帶答覆」本來就等於「選 0 個」＝否 ⇒ 兩次一樣、
結論與 v6.238 逐字相同（不會為了湊上界去替玩家挑能量）。

### 【C】audit：卡面「若希望」是不是都真的問玩家 → **乾淨**

枚舉（H/I/J + live 卡包，只認卡面實際用字）：`若希望` 共 **60 張**（招式 56、特性 2、訓練家 2）。
逐張比對實作：**60/60 都會問玩家**，0 個 outlier。
・51 招走 `ATTACK_PRE_DISCARD_CHOICE`（44 招 `binary-yes-no`、7 招能量/手牌 picker，min=0）
・5 招走 picker／modal-choice：好啦魷｜惡作劇觸手（modal 兩選項）、岩狗狗｜挖回、
  燭光靈｜光照燃燒（`deck-top-reveal-discard` min=0）、櫻花魚｜漸強波（`hand-choose` min=0）、
  魔牆人偶｜相仿秀（`hand-choose` min=0）
・特性 2：胖嘟嘟｜深海抽出（`hand-discard` min=0）、莫魯貝可｜搜尋點心（modal-choice）
・訓練家 2：火箭隊的妨礙機器人（modal-choice「不互換／互換」）、琵魯（`hand-discard` min=0）

其他官方措辭一併掃過（不自己發明同義詞，全部從卡面歸納）：
`則可` 25 條（多為「若…則**可使用**1次」＝玩家主動發動；力之沙漏 minCount 0、
壯偉碩木兩段都 minCount 0、閃焰王牌｜瞬間爆發力已是互動式開局）、
`可不`（＝「可不限次數使用」，與可選性無關）、`若不希望`（馬志士的交易，由**對手**用
modal-choice 決定）、`可選擇`（夜間學院＝玩家主動）。**皆無 outlier。**

⚠ **需站長裁定的卡面歧義**：捷拉奧拉｜麻麻關節 三個印刷版本中，
`SVQP 13145` 寫「擲1次硬幣若為正面，**則可**將對手的戰鬥寶可夢【麻痺】」，
而 `MC 16737` 與 `SV5M 9870` 寫「則將」，全站另外 37 張同型擲幣狀態招式**一律**是「則將」。
研判是該印刷的字面差異，實作維持「必定麻痺」未改動 —— 請站長確認。

### 守衛
`scripts/test-v6239-central-attack-formula-and-optin-estimate.mjs`（33 項）：
含 HEAD-FAIL（BASE 的 effects.ts ⇒ 波動突刺 一段公式都沒有）、
兩組突變測試（改 `composeAttackFormula` 一個字元 ⇒ 兩條管線同時變／拿掉「否」那次乾跑 ⇒
預估退回單一數字）、全卡池公式自洽掃描（含下限斷言與正對照）、
以及【C】的全卡池 audit（含正對照；⚠ 第一版盤面太貧瘠曾誤報 櫻花魚｜漸強波 與
魔牆人偶｜相仿秀 —— 候選為空時「不問」是正確行為，掃描盤面必須夠有料）。

完整 `npm test` 558 步全綠、`tsc` 與 BASE 逐字相同。


## v6.238 — 預估傷害：延後結算的招式讀不到傷害；桌機加放大鏡（觸控）

### 【A】站長回報：超級路卡利歐ex 只有第二招顯示預估，第一招完全沒有

**實跑印出的欄位**（harness，超級路卡利歐ex vs 超級袋獸ex）：

| 情境 | `lastDealtDamage` | `pendingSelection` | `logAdded` | 對手實際掉血 | v6.237 判定 |
|---|---|---|---|---|---|
| 棄牌區**有**基本【鬥】能量 | 0 | 有（`pulse-thrust-energies-picked`） | 2 | 0（還沒結算） | ② `pending && dmg===0` → `depends/selection` |
| 棄牌區**無**基本【鬥】能量 | 0 | 無 | 3 | **260** | ④ `dmg===0` → **`none`（完全不顯示）** |
| 備戰區空 | 0 | 無 | 3 | **260** | 同上 → `none` |

⇒ 站長看到的「完全沒有預估文字」＝第二、三種盤面（`none`）。

**真因**：`波動突刺` 走的是站內「regPre 傷害設 0 →（效果／picker）→ 最後才
`dealAttackDamageToTarget`」的延後範本（v5.508 起，弦月光芒 v5.881 也是這條，
為的是「翻獎賞卡要先於 KO 取獎」）。
`lastDealtDamage` **只有 engine 的 ATTACK 主管線會寫**（engine.ts 的傷害套用點），
中央 helper 那條路徑一個字都沒寫 ⇒ 乾跑讀到 0。

⭐ 站長的懷疑（「傷害後開 picker 時 `lastDealtDamage` 有沒有被設」）**方向對、但更嚴重**：
它不只是「開 picker 時沒設」——**只要傷害是由 `dealAttackDamageToTarget` 造成的，
不管有沒有 picker，都不會被設**。

**修法（兩段，各自獨立、各有突變測試）**
1. 新欄位 `GameState.attackDamageToDefActive`＝「這一次招式總共對對手戰鬥位造成的傷害」。
   engine 主管線**指派**（等同每次攻擊歸零）、`dealAttackDamageToTarget` **累加**。
   ⚠ helper 那一側必須加 `actorIdx === st.activePlayerIndex`：自傷型招式會反過來呼叫
   同一支 helper（把自己當「對手戰鬥位」），不加這一關會把自傷算成打對手。
2. 預估在乾跑裡**用真實引擎把選擇視窗一路回答到底**，而且跑三種都合法的答覆
   （選最少/選最多/選最少但從後面取）；三者傷害一致且 > 0 才採用，否則維持「依選擇而定」。
   ⚠ 「> 0」這一關是刻意的：跑完仍是 0 的話分不出「本來就沒傷害」與「傷害由選擇決定」，
   少了它，狩獵鳳蝶｜能量吸管、風妖精ex｜奇跡棉花會從「依選擇而定」掉成「完全不顯示」，
   而「有沒有顯示」本身就是看得出來的訊號（v6.236 的精神）。
3. 順手修 `pickFormula`：`【】`在 log 裡不是公式專用（「基本【鬥】能量」也是），
   跑到底之後掃到的 log 變多，波動突刺一度把「鬥」當成公式顯示出來。

**同型卡掃描（行為端，全卡池 2156 招）**：與 v6.237 逐招比對，**7 招**結論改變、
**0 招**退步：波動突刺 / 忍之利刃 / 烈箭鷹ex｜鉤爪搜尋 / 貓頭夜鷹｜鉤爪搜尋 /
詛咒娃娃｜玩偶捕捉（以上原本「依選擇而定」→ 現在給數字）、
弦月光芒 / 漸強波（原本完全不顯示 → 現在給數字）。
另外「對手戰鬥位真的掉血卻讀到 0」的招式從 11 支降到 6 支，剩下 6 支全是
**放置傷害指示物**型（胡地｜手之力量、鬼斯通｜纏擾、斯魔茶｜無聲加害、由克希｜痛楚記憶、
恰雷姆ex｜氣功指壓、蜈蚣王｜偏道一回）—— 官方判準「放置指示物不是傷害」，維持不報。

### 【B】桌機 hover → 放大鏡按鈕（平板／觸控）

站長原話：有玩家用 iPad，「只要觸碰就會使用了，無法模擬出滑鼠放在上面的效果」。

- 放大鏡是招式鈕的**兄弟節點**（不是子節點）⇒ DOM 上沒有祖先關係，click 結構上
  不可能冒泡到招式鈕；再加 `type="button"` 與 handler 內的 stopPropagation/preventDefault。
- 開合狀態記成 `{ turn, i }` ⇒ 換回合自動失效，不必在各處手動清。
- 觸控目標：可視 34×34（要塞進 Fable 版面 38px 的固定槽位），用不佔版面的 `::after`
  外擴 5px ⇒ 可點區 44×44。
- **hover 保留**：滑鼠玩家沿用 v6.233 的習慣，兩條路徑顯示的是同一塊內容、同一個位置。
- 三種桌機版面：用 svelte 編譯器的 unused-CSS 警告當儀器，與 BASE 逐條比對
  ——警告集合完全相同（7 條，全是 v6.237 就有的）。守衛把這件事釘住，
  正對照是「把 Fable 槽位選擇器改回 `.btn-act.atk:nth-of-type(1)`」時必須紅。
  ⚠ 實測：svelte 5 對**純 class 選擇器**很保守（本檔有動態 class ⇒ 隨便塞一條
  `.foo{}` 不會報 unused），拿那種當自我驗證會得到永遠綠的安慰劑。

### 守衛
`scripts/test-v6238-estimate-deferred-damage-and-magnifier.mjs`（57 項）。
HEAD-FAIL 用 BASE blob（淺複製時 SKIP），另有兩組突變測試各自對應上面的修法 1 / 2。
⚠ `test-v6237-estimate-state-proxy.mjs` 的錨點 `<span class="atk-slot">` 寫死了結尾的 `>`，
本版在同一個元素加了 `class:est-open` ⇒ 錨點放寬成不含 `>`（斷言意思一個字沒變）。

## v6.237 預估傷害「從來沒有顯示過」的真因：Svelte 5 的 `$state` 是 Proxy

BASE = `da59a0552e53a7668181a45f1f224891c7f42104`（v6.236）。
站長實測 beta 站 v6.236：**桌機 hover 沒有、手機直式也沒有**（手機不需要 hover，
所以一開始就排除了 CSS/hover 的可能）。

### 真因（已用真的 Svelte 代理實測復現）

`src/routes/game/+page.svelte` L828：`let game = $state<GameState | null>(null);`
⇒ Svelte 5 的 `$state` 變數在執行期是一個 **Proxy**（深層反應式代理；
編譯後就是 `svelte/internal/client` 的 `proxy()`）。

`src/lib/game/damage-estimate.ts` 的乾跑第一件事是 `structuredClone(base)`。
依 HTML 規格，**帶有 `[[ProxyHandler]]` 內部欄位的物件不可結構化序列化** ⇒
一律拋 `DataCloneError`。

於是每一招都走 `runOnce → { ok: false } → { kind: 'unknown' }`
⇒ `hasEstimateToShow` 永遠 false ⇒ **v6.233／v6.234／v6.236 三個版本什麼都沒顯示過**。

而且 `runOnce` 的 `catch {}` 與 `+page.svelte` 的 `catch { return null; }`
**兩層都是無聲的** —— 連 console 都不留一行，所以沒有任何人察覺。

實測（Node，svelte 5.55.4，`svelte/internal/client` 的 `proxy()`）：

| 傳進去的盤面 | `estimateAttackDamage` 回傳 |
|---|---|
| 普通物件 | `{ kind: 'exact', value: 40, formula: '20(基礎) ×2(弱點) = 40' }` |
| 真的 Svelte 代理 | `{ kind: 'unknown' }` ← 就是線上的狀況 |
| `$state.snapshot()` 之後 | `{ kind: 'exact', value: 40, … }`，與普通物件逐欄位相同 |

### 【A】修法：在呼叫端 `$state.snapshot()`

`+page.svelte` 的 `damageEstimates` 改成 `const _plain = $state.snapshot(game) as GameState;`
再交給 `estimateAllAttacks`。

- **為什麼修在呼叫端**：`damage-estimate.ts` 也被 Node 守衛直接呼叫，
  讓它 import svelte 會綁死框架、也會被打包進錦標賽 server-engine。維持框架無關。
- **`structuredClone` 不可以拿掉**：它是給非 Svelte 呼叫端（守衛／AI／伺服器端）的保險，
  而且乾跑一招要 2~5 份互不干擾的複本，本來就不可能共用同一份。
- **複製次數**：`$state.snapshot` 每次盤面變動**只做一次**；乾跑本身每一招 4 次
  （全反面／全正面 ×（原牌況／換牌況）），能量不足時再多 1 次（見【D】）。
  沙盒實測：`$state.snapshot` 一次 **0.54 ms**、`structuredClone` 一次 **0.067 ms**、
  一招完整預估 **1.0~1.6 ms**（能量 0 時 1.2~2.4 ms）。
  ⇒ 多出來的那一次深拷貝佔比極小，**不做「跳過重複複製」的最佳化**
  （那會需要一個「傳進來的必須已是純物件」的隱形約定，風險大於收益）。
  量測腳本＝`scripts/test-v6237-estimate-state-proxy.mjs` 第 ⑪ 節（Rule 32）。
- **`$state.snapshot` 與 `structuredClone` 等價嗎**：對 GameState 這種資料等價。
  ⚠ 已知差異：svelte 的 `snapshot`（`src/internal/shared/clone.js`）對 `Map`／`Set`
  只做**淺**複製、對 `Date` 才轉呼叫 `structuredClone`。
  ⇒ 只要 GameState 含 Map／Set 兩者就不等價 —— 所以守衛用**遞迴掃描**釘死
  「`createGame` 的盤面／`applyAction` 之後的盤面裡沒有 Map／Set／Date／類別實體」
  （GameState 本來就必須 Firestore-safe，見 Iron Rule 13）。

### 【B】不可再靜靜吞掉錯誤

新增 `warnEstimateOnce(tag, err)`：每一種失敗原因**只噴一次** `console.warn`
（`$derived` 會在每次盤面變動時重算，每次都噴等於把主控台洗掉）。
接的三處：深複製失敗、引擎在乾跑中丟例外、`+page.svelte` 的 derived catch。
⚠ 行為維持 fail-closed：算不出來就不顯示，絕不拿錯數字騙玩家。

其他仍然靜默吞錯的地方（本版**未改**，列在這裡備查）。
⚠ 以下是**實測數字**，不是印象：`src/routes/game/+page.svelte` 全檔有 **205** 個 `catch`，
其中**完全空**的 7 個（`catch {}` 6 個、`catch (e) {}` 1 個）、`catch { return null; }` 5 個。
絕大多數的吞掉**是對的**（sessionStorage 無痕模式會 throw、剪貼簿權限、`JSON.parse` 舊格式）。
真正值得再看的是同一類「功能整個不運作、但完全無聲」型 ——
`src/lib/game/optimistic.ts`（1 個 catch）與 `src/lib/game/ai-eval.ts`（5 個），
以及 `src/lib/audio/sfx-events.ts`。判準只有一句：
**「這個 catch 一旦命中，玩家會不會什麼都看不到、又完全不知道為什麼」**。
本版只改預估這條路徑，其餘留待下一輪逐一判斷（不在沒查證前就宣稱它們有問題）。

### 【C】補上能抓到「框架環境差異」的驗證

`scripts/test-v6237-estimate-state-proxy.mjs`（62 條）。核心是第 ④ 節：
把 `+page.svelte` 裡 `damageEstimates` 的 `$derived.by` **本體原樣抽出來執行**，
`with` 綁一組 ctx（含 `$state = { snapshot }`），餵一個**真的 Svelte 代理**當 `game`，
斷言它算得出可顯示的預估。
⚠ 刻意**不是**「原始碼裡有沒有 `$state.snapshot` 字串」的檢查。
配三組對照：負對照（snapshot 換成原樣回傳 ⇒ 全部顯示不出來）、
正對照（餵普通物件 ⇒ 新舊都會過，這正是舊守衛結構性抓不到的原因）、
突變（把 `$state.snapshot(game)` 改回 `game` ⇒ ④ 變紅）。
HEAD-FAIL 那一節更直接把 **BASE 的 derived 本體**抽出來跑，證明它真的算不出東西。

跑在 BASE(v6.236) 的原始碼上：**PASS 41 / FAIL 17**。

⚠⚠ 另外第 ⑧b 節拿 **svelte 編譯器的 unused-CSS 警告當儀器** ——
這是寫這一版時真的踩到的事故，見下面【D】。

### 【D】能量還沒附夠也要顯示

站長的原始需求正好是**出招前的規劃**：「有時候沒看到本來想說可以一拳打掉對手，
結果發現對方抗屬性」。引擎的 ATTACK 在 `canAffordAttack` 那一關直接原樣 return
⇒ 乾跑零 log ⇒ 舊版一律 `unknown`，**在最需要它的時候不顯示**。

- `damage-estimate.ts` 新增 `topUpEnergyForCost()`：只在**丟棄用的複本**上，
  依 cost 逐格補對應屬性的基本能量（【無】用攻擊方自己的屬性），
  補到 `canAffordAttack` 成立為止，末尾多留 3 格給「鼓擊／夜間礦山」這類**加費**效果。
  既有的能量一顆都不動（特殊能量的效果照樣算得到）。
- 標記 `assumedEnergy` ⇒ 文案前綴「附滿能量後」，不假裝是現況。
- **正確性**：傷害本身取決於附著能量數的招式（例：拉普拉斯ex｜水炮迴旋
  ＝每顆能量 30），算出來的是「剛好附滿費用」那一種情形。
  偵測是**行為端**的：多附 2 顆再跑一次，數字有變就標 `energyScaled`
  ⇒ 文案再加「（傷害依附著的能量而定）」。實測
  `附滿能量後預估 30（傷害依附著的能量而定）`。不靠卡名清單、不靠卡面 regex。
- **桌機 hover**：提示原本掛在按鈕裡、靠 `.btn-act.atk:hover` 顯示，
  但能量不足的按鈕是**原生 `disabled`** —— disabled 表單元件不派送滑鼠事件、
  各家瀏覽器對 `:hover` 的處理也不一致。
  ⇒ 改用外層容器 `.atk-slot`（沒有 disabled，hover 一定成立）承接 hover，
  **按鈕本身維持原生 `disabled`**（沒有改成 `aria-disabled` 那種「看起來不能按、
  其實按得到」的做法）—— 絕不可讓玩家真的按得下不能使用的招式。
- **手機直式**：本來就把預估接在招式名後面，而且能量不足的招式是 `disabled` 而不是
  不 render ⇒ 只要算得出數字就看得到，元件一行都不用改。

⚠⚠ **包一層容器踩到的事故**：`.playmat.layout-fable .action-bar > .action-btns >
`.btn-act.atk:nth-of-type(1..3)`（Fable 版面把招式鈕鎖在固定 grid 槽位的三條規則）
用的是**直接子選擇器**，多包一層之後整組失聯 —— 而桌機**預設**就是 Fable 版。
靜態字串比對抓不到；**svelte 編譯器的 unused-CSS 警告抓到了**。
修法：那三條改成 `> .atk-slot:nth-of-type(N)`，另加 `.atk-slot > .btn-act.atk{ flex:1 1 auto; }`
讓按鈕在被拉寬的槽位裡填滿。編譯前後的 unused 清單**逐條完全一致**（新增 0、消失 0）。
守衛第 ⑧b 節把這件事釘死（附試紙自驗＋反向自驗）。

### 首頁 changelog 的處理

v6.233／v6.234 的條目描述的功能**從 v6.237 起才真的成立**。
沒有回頭改寫那兩則（改寫等於在公告裡討論公告本身，屬於規範②要擋的 meta），
改成在 v6.237 條目裡**明講**「預估傷害提示先前在畫面上一直沒有出現，已修正」——
玩家看得懂、也不必知道為什麼。首頁滿 50 則，最舊的 v6.172 已搬進封存頁。

### 驗證

- 完整 `npm test` 557 步（分批）全綠；新守衛 62 條全綠、BASE 上 17 紅。
- `tsc --noEmit` 與 BASE **逐行相同**（新增 0 條），TS2304 = 0。
- `anti-pattern-lint` 無違規；免疫網三支（damage／attack-effect／opp-debuff）全綠。
- `test-v6233`（62）／`test-v6234`（58）／`test-v6236`（28）全綠。
  ⚠ `test-v6233` 的「桌機是 CSS :hover 顯示」那一條跟著改成斷言外層容器
  （`.atk-slot:hover .dmg-est` 存在**且**舊的 `.btn-act.atk:hover .dmg-est` 已移除）。
- `+page.svelte` 用 svelte 編譯器實編通過（模板沒有沒跳脫的特殊字元），
  unused-CSS 清單與 BASE 完全一致。


## v6.236 預估傷害：隱藏資訊防護補上「組成」這一維（獨立審查發現）

BASE = `ed3f03f3d2d231bd51a6a278a2fdec8ce3cf3ece`（v6.235）。**上線前的第二雙眼睛**在審查
v6.233~v6.235 時實跑掃出來的，v6.233 從未部署 ⇒ 玩家沒受過影響。

### 真因

v6.233 的隱藏資訊防護是「再跑一次**把隱藏區順序反轉**的乾跑，結果不同就降級」。
順序反轉只擋得住**依牌序**的招式（呆呆王｜耀閃挑戰＝自己牌庫頂那一張），
擋不住**依內容／組成**的招式 —— 因為把對手手牌的順序倒過來，
「裡面有幾張能量卡」一張都不會變。實測掃出兩張：

| 卡 | 卡面 | v6.235 的預估 |
|---|---|---|
| 狩獵鳳蝶｜能量吸管 | 查看對手的手牌，造成其中**能量卡**的張數×80 點傷害 | `預估 240`（對手手牌 3 張能量）／`預估 80`（1 張） |
| 風妖精ex｜奇跡棉花 | 查看對手的手牌，造成其中**訓練家卡**的張數×50 點傷害 | `預估 50`／`預估 150` |

＝**出招前**就把對手手牌的組成換算成數字印在畫面上。卡面的「查看對手的手牌」是
**使用招式之後**才看得到的，預估把它提前了。

### 修法（只動乾跑路徑，實戰一行都沒碰）

`permuteHiddenZones` 從「各區各自 reverse」改成
「**把同一側的隱藏區串成一串、反轉、再按原本各區的張數切回去**」：

- 自己這一側＝牌庫＋獎賞卡；對手那一側＝牌庫＋獎賞卡＋手牌（自己的手牌是公開的，不動）。
- **各區張數不變** ⇒「對手手牌有幾張」「牌庫剩幾張」這種**公開**資訊不受影響，
  只看張數的招式（超級雪妖女ex｜怨言）不會被誤判 —— 已列為正對照。
- 牌只在同一側的隱藏區之間搬家 ⇒ 換出來的是一個**玩家無法排除的可能牌況**，沒有憑空生卡。
- 順序**與組成**同時改變 ⇒ 兩型都偵測得到。

順帶修第二個小洞：**`hidden` 檢查原本排在「沒有傷害就不顯示」後面**，
所以依隱藏資訊的招式只要在當下牌況剛好打 0，就會走「不顯示」——
而「有沒有出現提示」本身就是看得出來的訊號（等於告訴玩家牌庫頂不是那一張）。
改成 `hidden` 先判。代價是純效果招式多跑兩次乾跑；實測 1174 個預估只有 **2 個**結論改變。

文案：`預估：依未知的牌序而定` → `預估：依看不到的牌而定`（現在不只牌序）。
`static/changelog.html` 的 v6.233 條目那一句同步更新（該版從未部署，比照 v6.235 的處理）。

### 量測（都附腳本，Rule 32）

- 800 個盤面 × 1174 個預估：**盤面污染 0**；突變測試（拿掉 `structuredClone`）＝ 800 個全被抓到。
- 預估 vs 實戰：exact 2065 次、range 618 次、open 72 次 ⇒ **全部相符／落在區間內**。
- 誤判成本：修正前後型態分佈 `exact 838 / range 50 / open 8` 完全不變，
  只有 `depends 97→99`、`none 135→133`。
- 一次完整重算（50 張牌庫、雙方滿備戰）1.5~7.7 ms／招式數。

### 守衛

新增 `scripts/test-v6236-estimate-hidden-composition.mjs`（已接進 `npm test`，24 條）：
①素材自驗 ②**正對照**：真打一次證明這兩招確實依組成算傷害
③**突變測試**：只反轉順序後傷害一點都沒變 ⇒ 舊判準必然漏掉（不是恆真）
④主張：兩招一律不給數字 ⑤反向正對照：一般招式與「只看張數」的招式照常給數字
⑥`hidden` 排在 `none` 前面（行為端用呆呆王驗）⑦盤面零污染 ⑧HEAD-FAIL（BASE blob，
淺複製自動 SKIP，不會炸 CI）。

### 版本與部署

- `version.ts` / `admin.html` 的 `SITE_VERSION_HINT` 一起到 `6.236`。
- **不新增首頁條目**：這是公平性／防偷看的修正，依既有規範不寫公開 changelog；
  而且 v6.233 從未上線，玩家從來沒看過會洩漏的版本。
- 沒有動錦標賽伺服器邏輯 ⇒ 不需要 `update-tournament.bat`；
  但 `admin.html` 有改 ⇒ 仍需 `update-admin-full.bat`。


## v6.235 首頁 v6.233 條目的文案更正（純文案，不新增公告）

BASE = `539ee0364c5b439b638f389e11bf832fa80735c1`（v6.234）。**沒有動任何 src/ 程式**，只改一句公開文案。

### 為什麼要改

v6.233 首頁條目的詳細說明裡寫著：

> 「擲硬幣直到出現反面」這類沒有次數上限的招式**只顯示下限並註明無上限**，不會給出誤導的範圍。

那描述的是 v6.233 當時的實作（`預估 0+（擲到反面為止，無上限）`）。v6.234 依站長裁定
已改成「傷害依擲幣次數而定」（基礎 0 → `預估：傷害依擲幣次數而定`；基礎非 0 →
`預估 200 起，傷害依擲幣次數而定`）。

**關鍵事實：v6.233 從未部署到正式站。** 正式站是站長本機跑三支 bat 才上線的，
v6.233 → v6.233 hotfix → v6.234 這一段沒有經過那個流程 ⇒ **玩家從來沒看過舊行為**。
⇒ 站長裁定：那則公告描述的是一個從不存在過的行為，**直接更新文案**，
不寫成「後來又改了」（玩家沒有前情提要，寫了反而更亂）。

### 實際改動

`static/changelog.html` 第 7 行、v6.233 的 `<div class="log-body">` 內一句：

| | 逐字 |
|---|---|
| 改前 | 「擲硬幣直到出現反面」這類沒有次數上限的招式只顯示下限並註明無上限，不會給出誤導的範圍。 |
| 改後 | 「擲硬幣直到出現反面」這類沒有次數上限的招式，預估顯示「傷害依擲幣次數而定」；基礎傷害不為 0 的招式會先標示起始值，例如「預估 200 起，傷害依擲幣次數而定」，不會給出誤導的範圍。 |

- v6.233 的 `<summary>`（標題那一行）本來就沒提到「無上限」，**未動**。
- **其餘 49 則一個字都沒動**。驗法：用 `git cat-file -p <BASE>:static/changelog.html` 取原檔，
  Python 斷言「只有這一個字串被取代、且取代前後的檔案差異只有這一段」，再逐則比對 50 則的
  `<summary>` 與 `<div class="log-body">` 全等（只有 v6.233 那一則的 log-body 不等）。
- ⚠ **v6.234 那一則刻意不動**：它是「這一版改了什麼」的歷史敘述，本來就必須引述舊文案
  「0+（擲到反面為止，無上限）」才講得清楚。把它一起改掉會讓那則變成廢話。

### 建議（尚未執行，等站長裁定）

v6.233 與 v6.234 兩則有明顯重疊：v6.233 介紹「預估傷害」這個功能，v6.234 又花了半則
在講同一個功能的文案。由於 **v6.233 從未上線**，對玩家而言這兩則其實是**同一次上線**的內容。
合併成一則（標題留「對戰新增『預估傷害』提示」、把 v6.234 的「抵抗力」用語統一併進去）
會比兩則清楚。**但站長只裁定「更新文案」、沒有裁定合併，所以這一版不合併**，僅提出建議。

### 版本與守衛

- **純文案改動仍然要 bump 版本**（6.234 → 6.235）：不 bump 的話 Service Worker
  會繼續餵舊的 `changelog.html`（v6.222 的教訓）。
- `oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 一起跟到 `6.235`
  （`test-v6160-checkin-version-gate` ★ 那條會比對兩者一致）。
- **不為這次更正新增首頁條目**：純文案更正屬於「更新記錄自己」的 meta 題材，
  依 v6.121 規範整則不上首頁（`test-changelog-size-and-archive` ⑬ 正是擋這類）。
  首頁最新條目維持 v6.234，`test-v6223-layout-fixes` 的斷言是「最新條目版本 ≤ 當前版本」⇒ 不會紅。
- 沒有動到卡效果／引擎／錦標賽伺服器邏輯 ⇒ **不需要跑 `update-tournament.bat`**，
  但仍需要跑 `update-admin-full.bat`（admin.html 的 `SITE_VERSION_HINT` 有改）。

## v6.234 用語統一「抵抗力」＋無上限文案＋擲幣迴圈上限收斂

BASE = `cad2bba07942ffcf70bc52df1107e9a9cdbb668d`（v6.233）。站長對 v6.233 留下的三個待裁定事項給了明確答覆，這一版執行。

### 【A】「屬性相剋」→「抵抗力」（引擎戰鬥紀錄 ＋ 預估，一起改）

**卡面查證（唯一權威＝`static/cards`）**：272 張卡的 effect 原文出現「抵抗力」
（例：`[在備戰區不計算弱點・抵抗力。]`、鹽石壘｜岩石投擲「這個招式的傷害不計算抵抗力」），
**「屬性相剋」在全卡池 0 張**；`PTCG RULES/PTCG_RULES.md` L138 也是「**抵抗力**：指的是在對戰中
對這隻寶可夢有利的屬性…」。⇒ 官方用語就是「抵抗力」，站長的裁定與卡面一致。

改動只有一個字串：`engine.ts` L5534 的 `formula.push({ …, label: '屬性相剋' })` → `'抵抗力'`。

- ⚠ **改前的全站 grep 要用 `git grep <rev>` 而不是工作樹 grep** —— 工作樹的 mount 讀取會漏檔，
  我第一次 `git grep '屬性相剋' -- .` 只回 2 個檔，`git grep '屬性相剋' cad2bba0` 才回 4 個
  （多出 `scripts/test-v6233-damage-estimate.mjs` 與 `damage-estimate.ts`）。
  漏掉的那一個正是**會打紅 npm test 的既有守衛斷言**。
- 四處全部處理：engine.ts（label 本體）、damage-estimate.ts（型別註解舉例）、
  effects.ts L11429（那句其實講的是**弱點**被 ×2，用詞本來就寫錯，改成「打到弱點時」）、
  test-v6233 的 CASES 期望 label。
- **沒有任何邏輯依賴這個字串**：label 只被 `composeFormula` 拿去拼字串；
  `coinAnimation.ts` / `log_format.ts` / `log_zoom.ts` 三個紀錄解析器都不認得這個詞；
  預估取公式是靠 `【…】` 括號而不是 label 字面 ⇒ **已歸檔的舊紀錄／回放仍是舊用語，照樣解析、照樣顯示**，
  新舊並存不會壞。舊紀錄是歷史文字，不改也不該改。
- **計算行為未變的證明**（守衛 ⑨）：把新增的那一段（4 行註解 ＋ 新 label）**原樣回推**成 BASE 的
  那一行後，`engine.ts` 與 BASE **逐位元組完全相同** ⇒ 不可能改到任何算式。
  另外行為端釘死：大岩蛇｜怪力（印刷 100）打 凱西（抵抗力【鬥】-30）＝ **70**，前後一致，
  並附正對照（換成無抵抗力的對手＝100，差正好 30）。

### 【B】無上限招式文案 →「傷害依擲幣次數而定」

站長：「預估 0+（擲到反面為止，無上限）」的「0+」讀起來很怪。`estimateShortText` 的 `open` 分支改成：

| 情境 | 實際文案 |
|---|---|
| 基礎 0（胖丁｜滾球） | `預估：傷害依擲幣次數而定` |
| 基礎非 0（超級袋獸ex｜機關槍合擊 200+） | `預估 200 起，傷害依擲幣次數而定` |
| 有上限的擲幣（喵喵｜亂抓，擲3次×20）＝不受影響 | `預估 0～60（擲幣）` |

手機直式與桌機都是呼叫 `estimateShortText`，**字面量只存在 damage-estimate.ts 一處**
（守衛靜態斷言兩個 svelte 都不含「依擲幣次數」「擲到反面為止」字樣）。

### 【C】擲幣迴圈上限收斂到 `flipCoinsUntilTails`

**先查同族到底有幾種上限、為什麼不同**（答案：四種，而且沒有任何卡面上的理由，純粹是各批次各寫各的）：

| 上限 | 實作處 |
|---|---|
| **10** | `墓揚犬｜恐怖啃咬`（v2670，註解寫「保留原本 10 次的安全上限」） |
| **20** | `coinUntilTailsMultiplyPre`（effects.ts，8 張）／同名 local（v2620，4 張）／`flipUntilTails`（v2346、v2349）／`超級袋獸ex｜機關槍合擊`／`火箭隊的地鼠｜狂潛`／`賽富豪｜抓到飽` |
| **30** | `coinHeadsUntilTailsPre`＋`coinHeadsUntilTailsBonusPre`（v2750）／`卡蒂狗｜連續火焰`（v3700） |
| **無** | `怪顎龍｜亂暴`（v2355 L246）**與 `洛奇亞ex｜破壞潮旋`（v155 L572）** |

⚠ **站長只點名了亂暴，實際上無上限的有兩張** —— 破壞潮旋是同一個 `while (true)` 寫法，一起修。

- 新增 `export function flipCoinsUntilTails(state, aIdx, label, maxFlips)`（effects.ts，緊接
  `flipCoinsWithLog`）。`maxFlips` **必填、不給預設值**：同族上限本來就不一致，給預設值等於
  默默改掉某些卡的行為（IRON_RULES Rule 28 —— 共用 factory 加必填參數，強迫呼叫端回去讀自己那一張）。
- 13 處呼叫端**逐處宣告原本的上限**（10／20／30 三種都原封不動保留）⇒ **既有卡一張都沒有行為改變**。
  原本兩種寫法（`for (let i = 0; i < N; i++)` 與 `while (true) { …; if (heads >= N) break; }`）
  逐次等價，都是「最多擲 N 次」。
- **兩張無上限的卡改宣告 30**：理由是「同族既有上限的最大值 ⇒ 最貼近原本的『無上限』，
  而且是已經在線上跑過的數字」。30 連正面的機率約 **9.3e-10**；守衛用 3000 次真隨機實測，
  最多只擲到 11 次、平均 1.97 次（理論值 2.0）⇒ **實戰行為與 BASE 相同**。
  ⚠ 嚴格說任何上限都改變了「理論上的」行為，這一點必須講清楚，不是零改動。
- 這是**潛在風險而非現行 bug**：真隨機必然收斂；但只要有人把擲幣固定住
  （v6.233 的預估乾跑、AI 評估、測試）就會無窮迴圈、分頁卡死。
- `damage-estimate.ts` 的 `COIN_BUDGET`（256）**保留**：它擋的是「未來又有人寫出無上限迴圈」的通例，
  是乾跑自己的安全網，不依賴卡片實作端永遠做對。註解已同步更新（原本寫「只有亂暴沒有上限」已過時）。

### 守衛 `scripts/test-v6234-resistance-label-and-coin-cap.mjs`（58 PASS）

- ⓪ 掃描器自驗（大檔未截斷、卡池下限、樣本存在）。
- ①【A】卡面／規則書逐字查證（272 張含「抵抗力」、0 張含「屬性相剋」）。
- ②【A】行為端：真的打一場，讀引擎寫的公式字串；**傷害數值釘死 70**＋正對照。
- ③【A】src 全域已無舊詞；label 沒有被拿去做任何比較；三個紀錄解析器都不認得這兩個詞。
- ④【B】三種情境的文案逐字斷言 ＋ 手機/桌機同源（字面量只在一個檔）。
- ⑤【C】靜態掃「迴圈裡呼叫 flipCoinsWithLog」＝手寫擲幣迴圈，殘留必須 0；
  下限斷言中央 helper 呼叫點 ≥12；並釘死「上限值仍是 10/20/30 三種」（防未來被統一掉）。
- ⑥【C】行為端：把 `Math.random` 換成「全正面 + 400 次預算就 throw」，兩張卡都在 30 次內結束。
- ⑦【C】正對照：3000 次真隨機的最大擲幣次數 / 平均值。
- ⑧ **突變測試**：M1 把文案改回舊的、M2 把中央 helper 的上限拿掉，
  都是**真的把 src 複製一份改掉再 esbuild 重新打包**跑，不是嘴上說說。M2 實測會撞到 401 次預算。
- ⑨ HEAD-FAIL ＋ engine.ts 逐位元組回推比對（⚠ 用得到 git 歷史，CI 淺複製時明講 SKIP —— v6.233
  第一發就是忘了這件事把 build 弄紅）。

### 驗證

`tsc --noEmit` 的錯誤清單與 BASE **逐行相同**（91 條全是既有的）；TS2304 掃描 0；
免疫測試網三支全綠；完整 `npm test` 555 步分批全綠。

## v6.233 對戰「預估傷害」（只在休閒對戰）

BASE = `4ed788b19b1ba416b3bab1cda17cf57752d350cc`（v6.232）。

**做法＝乾跑，不是抽公式。** 傷害計算整段寫在 `engine.ts` 的 ATTACK handler 裡
（`composeFormula` L5807 是那個 handler 內的區域閉包，不是可重用的函式），另寫一份必然漂移，
而玩家會照著錯的數字下決定 —— 比沒有預估更糟。
新檔 `src/lib/game/damage-estimate.ts`：深複製盤面 → 用**真實的 `applyAction`** 打那一招 →
讀引擎自己寫下的 `lastDealtDamage` 與傷害公式字串 → 丟掉那份盤面。**零新計算邏輯**。

- **深複製**：`structuredClone`。`handlePlaying`（L3166）只做淺複製，內層 `CardInstance`
  是共用參照，就地修改會污染真盤面。守衛用 `JSON.stringify` 深比對釘死「跑完逐位元組不變」，
  並附**突變測試**（拿掉深複製 ⇒ 污染守衛變紅）。
- **擲幣**：不動實戰路徑。乾跑期間把 `Math.random` 換成**帶狀 PRNG**
  （heads → `[0,0.5)`、tails → `[0.5,1)`），`try/finally` 還原。
  用帶狀而不是固定值，是因為固定值會讓 `Math.random().toString(36).slice(2,10)`
  產生相同 iid、洗牌也退化成常數。先例：`ai-eval.ts` / `optimistic.ts`。
- **「擲硬幣直到出現反面」不給範圍**：偵測用**行為端**——全正面與全反面的**擲幣次數不同**
  ⇒ 次數本身取決於擲幣結果 ⇒ 無上限，顯示 `N+（擲到反面為止，無上限）`。
  卡面 regex `直到出現反面`（H/I/J 共 38 個印刷、25 個招式名）只在守衛裡當**交叉驗證**（Rule 25）。
  枚舉結果：H/I/J 含「硬幣」的招式印刷 481 個，措辭只有
  `擲N次硬幣`／`擲1次硬幣若為正面|反面`／`與…數量相同次數的硬幣`／`擲硬幣直到出現反面` 四型，
  **只有最後一型無上限**。
- **會跳選擇視窗**：乾跑回 `pendingSelection` 且此刻傷害為 0 ⇒ 顯示「依選擇而定」，**不顯示成 0**。
  （先造成傷害、之後才開 picker 的招式傷害已定案，照常顯示數字。）
- **⚠ 不得洩漏隱藏資訊**：瀏覽器端那份 GameState **含有玩家不該知道的東西**
  （雙方牌庫順序、獎賞卡、對手手牌）。實例：呆呆王｜耀閃挑戰 的傷害取決於自己牌庫頂那一張。
  ⇒ 再跑一次「把隱藏區順序反轉」的乾跑，結果不同就降級成「依未知的牌序而定」。
  只反轉順序、不換卡 ⇒「牌庫還剩幾張能量」這種玩家推得出來的資訊不會被誤判。
- **gate**：`+page.svelte` 既有的中央述詞 `isTournament`（不新寫判斷）＋觀戰/回放/非我方回合。
- **UI 兩套、計算一份**：桌機 `.dmg-est`（`position:absolute` + `:hover` 顯示，
  不佔版面、hover 不做運算）；手機直式把文案接在 sheet 的招式標籤後面。
  **沒有用 `@media` 當「是不是手機」的開關**（沿用既有的 `isPortraitMobile` 分支）。
- 效能：`$derived.by` ⇒ 只在盤面/視角變動時重算。沙盒實測每招 2~4 次乾跑約 2~7ms
  （首次含 JIT 暖機約 20ms），量測腳本 `scripts/test-v6233-damage-estimate.mjs`（Rule 32）。

## v6.232 卡片資料稽核修正：三張 M-P-J 被 clone 汙染的卡＋9 張基本能量標記 I→J＋稽核白名單

BASE = `82b6722d66c3fc0b061e89fd836aa677ad557b95`（稽核工具版）。資料來源＝
2026-08-26 重跑 `scripts/audit-card-data-vs-official.mjs`（fresh、無快取；試金石 PASS）。

【A】以官方卡面逐欄修正 `static/cards/M-P-J.json`（影響實戰的 clone 汙染）：
- 19536 菊草葉 155/M-P：attacks「飛葉快刀 20【草】」→「叫聲【無】（下回合受招方招式 -20）＋
  種子炸彈 30【草草】」；illustrator Makura Tami→Kariya。hp/弱點/撤退與官方一致不動。
  引擎既有 `菊草葉|叫聲` 實作（regPre/regPost）本來就在，資料修正後自動接上。
- 19539 暖暖豬 158/M-P：hp 70→80；attacks「撞擊 10／滾動 30」→「吐火 20【火】」；
  retreatCost 1→2；illustrator Teeziro→Uninori。
- 19542 小鋸鱷 161/M-P：hp 70→80；attacks「咬緊 10【水】（無法撤退）」→
  「撞一下 40【水水】（自傷 10）」；illustrator MINAMINAMI Take→REND。
  `小鋸鱷|撞一下`（selfHitPost(10)）與 `小鋸鱷|咬緊`（其餘印刷版本仍在用）都已有實作，零死 key。
- 修正後重跑稽核：M-P-J 遊戲性差異 0 張。

【B】18965／18969：**本來就已於 v6.194 進 `HIDDEN_FROM_PLAYERS`**（visibility.ts），
本版零改動；行為守衛在 test-v6194-hidden-cards-and-energy-metadata.mjs（卡池仍載入、
編輯器／卡庫不列出、回放不炸）。稽核報告的 pageGone 區改為註記「已處理」。

【C】9 張基本能量（14102/14103/14104/14428/14429/14430/14433/14434/14435）
regulationMark I→J（官方卡片頁 alpha 已印 J，實抓非 fallback）。查證結論：
`validateDeck`（validation.ts L281-286）對基本能量**完全豁免**標記檢查，且 I／J 都在
STANDARD_MARKS ⇒ 舊牌組不可能因此變不合法。依 v6.194 SV-P 搬檔前例與
「檔名標＝卡片標」守衛（拆檔規則），整卡搬入 M-P-J.json 並同步 setCode、
card-set-map.json、index.json 定點數字（M-P-I 59→50、M-P-J 92→101；總數 4935 不變、
index.json **未重生**）。test-v6194 硬編數字同步（92→101、90→99）。

【D】19630「老大的指令」**維持不改名**（站長 v6.193 裁定；effectKey 依卡名）。
稽核工具新增 `KNOWN_INTENTIONAL_DIVERGENCES` 白名單：id＋欄位＋兩側值逐字匹配才豁免，
任一側改變即自動回到差異報告（fail-open）。重跑稽核後 19630 列在白名單區、
不再計入遊戲性差異。

守衛：`scripts/test-v6232-card-data-official-fix.mjs`（HEAD-FAIL：BASE 資料上跑會紅；
突變測試：把 19539 hp 改回 70 會紅）。行為端實跑 叫聲/種子炸彈/吐火/撞一下 四招。
部署：站長需跑 `update-tournament.bat`（卡 DB 有動，tournament-pool.json 要重建）＋
`update-admin-full.bat`（admin.html 版本提示）。server_admin_patch.js 未動。

## v6.231 更正 v6.230 逾時設計的依據說明（nginx 60 秒之說有誤；行為零變更）

BASE = `46bed878da0452906ed7afda7b8bf73cfc4dcea6`（v6.230）。獨立審查 v6.230 時查證：
v6.230 為總預算 50 秒給的理由「三段相加 60 秒會超過 nginx 等待上游的時間」**不成立**——
nginx 的 `/api/` 實際是 `proxy_read_timeout 24h`（2026-08-22 VM 實查，見
reference-vm-infra-ops-lessons / reference-peak-shared-path-lag-v6216），不會在 60 秒切斷。
真正的上游天花板是 **Cloudflare 邊緣代理（約 100 秒回 524）**。

- 結論不變、理由更正：總預算真正要守的排序是
  **後端總預算 50s ＜ 前端逾時 55s ＜ Cloudflare ~100s**。沒有總預算時最壞情況
  三段相加 60 秒 ＞ 前端 55 秒，玩家會先被前端切斷、看不到後端的分段訊息
  （尤其第三段「可能已發行」的提醒）。50s／55s／20s 三個數值**全部維持原樣**。
- 一併記錄刻意取捨：`min(20s, 剩餘預算)` 使前兩段合計 >30 秒時第三段被壓縮
  （理論下限約 10 秒，低於匯入端實測過的 11.974 秒慢成功）；發生條件是前兩段
  各拖近 20 秒，實測成功案例三段合計僅 1.2~1.4 秒，機率極低，不為此加大總預算
  （加大＝玩家最壞等待時間變長）。
- 改動範圍：server_admin_patch.js 註解、守衛 test-v6230-deck-export-timeout.mjs 的
  註解與斷言訊息（**數值區間 [15,60)/[40,60) 不變**）、本檔。無任何行為變更；
  審查另以 BASE/HEAD 沙盒實跑複驗三段 fetch 的 URL/headers/body/順序逐字相同
  （HEAD 唯一差異＝多帶 signal）、六組突變（M1~M6，鎖定 encode 端）全紅、
  decode 端同名行對照突變全綠（v6.230 自承的 M2 首輪逃逸＝突變腳本切錯行，非守衛漏洞）。
- 首頁 changelog 不寫（純說明修正，玩家無感）。部署：站長跑 redeploy-oracle.bat 時
  自然帶到（與 v6.230 同一支檔案）。

## v6.230 /api/encode-tw-deck（匯出官網牌組代碼）三段外部 fetch 加逾時保護

BASE = `503d1e06d2979156e390a5cef76b28d60a66880b`（v6.229）。v6.224 修了匯入端
（/api/decode-tw-deck）的雙胞胎問題，本版比照同一套做法補匯出端，保持兩支端點一致。

- 現況：handler（server_admin_patch.js registerTwDeckExport）內三個接續的 await fetch
  打官網（① GET deck-build/ 拿 token ② POST beforecheck/ 驗證 ③ POST register/ 發行），
  全部沒有逾時 —— 任一段掛住玩家無限期乾等，且三段接續、風險比單一 fetch 更高。
- 取值（Rule 37）：nginx 計時 log 2026-08-25 實測三筆成功 1.198／1.397／1.399 秒
  （三段合計；log 只記 >1 秒、樣本很少）；同一官網主機在匯入端實測過 11.974 秒仍成功
  回 200 ⇒ 單段逾時保守沿用 20 秒（單看本端點樣本不足，以同主機最慢成功案例為準）。
  三段各自計時（前段慢不會餓死後段），另設 50 秒總預算（每段實際逾時＝
  min(20 秒, 剩餘預算)）：避免最壞情況三段相加 60 秒 ≥ nginx 等待上游的時間，
  讓本端的友善訊息先到；50 秒也高於「三段都慢但仍成功」的極端外推（3×12＝36 秒）。
- 逾時回 504、AbortError／TimeoutError 特判成人話，且分得出是哪一段（不洩內部實作）：
  ①「官網頁面載入逾時」②「牌組驗證逾時」（皆註明牌組尚未發行）
  ③「牌組發行逾時」—— register/ 已對官網送出、官網端可能已建立成功但代碼沒能傳回，
  訊息提醒「可能已在官網發行成功；若重試，官網會多產生一份新的牌組紀錄」。
  （發行是匿名的、代碼是唯一憑據 ⇒「請先去官網確認」對玩家不可行；多一份紀錄與
  平常重複匯出等價，前端本來就警告每次匯出都會在官網永久留下紀錄。措辭是否要再調
  → 需站長裁定。）
- timer 統一在外層 finally 清光（任何 return 路徑不留 handle）；已完成段的殘留 timer
  觸發只是 no-op abort，逾時訊息由「真正造成中止的那段」在觸發當下寫入。
- 前端 exportToTwOfficialCode：原本有 loading 狀態但沒有逾時。加 AbortController
  逾時 55 秒（> 後端總預算 50 秒，讓後端的分段訊息先到）、AbortError 特判、
  finally clearTimeout。
- 成功路徑與 400/422/429/502×4/500 各分支行為逐字不變（守衛 B2 以 BASE blob 在
  node:vm 內實跑同一組輸入 deep-equal 對照）。
- 守衛 scripts/test-v6230-deck-export-timeout.mjs：三段各自掛住的行為級測試
  （fetch 替身只有收到 abort 才 reject；逾時後真的中止、回 504、不繼續打後面的段）、
  總預算假時鐘驗證（前兩段耗 38 秒後第三段被壓縮到 12 秒）、成功路徑 timer 全清、
  BASE 行為快照對照、前端靜態斷言。BASE 上 10 FAIL（HEAD-FAIL）；突變 M1~M6
  （拿掉第二段 signal／拿掉 AbortError 特判／拿掉 finally clearTimeout／單段改 10 秒／
  前端 ≤ 後端總預算／總預算出界）全紅。
- 部署：伺服器端要生效需站長跑 redeploy-oracle.bat（server_admin_patch.js）；
  前端頁面照常兩段式部署。

## v6.229 admin「🎮 Oracle 對戰」牌組標籤改用牌組原型分類（與一般對戰大廳同一份結果）

BASE = `a9ffd949cbd61ec4ee224a57264bf2ffe42a3d4f`（v6.228）。站長需求：admin 的
🎮 Oracle 對戰分頁原本用「剔除訓練家／能量／手動標記支援型後推測主力打手」
（admin.html `detectMainPokemon`）代表牌組——改成比照一般對戰大廳：用「牌組原型」
規則庫（deckRules）分類。首頁 changelog 不寫（admin 後台功能，玩家看不到）。

- 大廳實際樣式（查證 src/routes/game/+page.svelte L9890 一帶）：玩家名後接
  `<span class="or-arch">【原型名】</span>`（金黃 #ffd97a 粗體）；回傳語義：
  字串（含 '未分類'）＝已比對出結果、`null`／不在回應裡＝還不知道 → **不顯示任何標籤**。
  兩種「沒有」靠這個分得出來，前端絕不可把 null 當成「未分類」。
- **改在後端**（server_admin_patch.js v1.21）：registerDeckRules IIFE 內抽出中央
  `archetypeNameOf(entries, nameMap, rules)`；/api/rooms-archetypes 的 `nameOf` 改為
  薄轉呼叫（行為逐字不變，v6115 守衛照跑）；另掛 `app.locals._archetypeEnrichRooms`，
  /api/admin/oracle/rooms 於 enrichSeats 後為每個 seat 補 `archetype` 欄位。
  不在前端重算——classifyDeck 與規則庫都在後端，前端重算＝第二份實作必然漂移。
- 不直接打 /api/rooms-archetypes 的原因：那支有 40-id 上限，且刻意只回
  playing＋gameState.phase==='playing' 的房（防牌組狙擊）——admin 的等待中／已結束房
  會永遠「還不知道」。admin 本來就有 🃏 牌組 modal 可看整副牌，沒有狙擊問題，
  故 enrich 不套那兩條限制。
- admin.html（v1.74）renderRoomRow：seat 有 archetype 欄位→【原型名】badge
  （淺色主題用深金 #b8860b）；null→不顯示；欄位缺席（Firebase 分頁／舊伺服器）→
  退回舊 ⚔️ 主力打手 badge ⇒ Firebase 分頁行為不變；admin.html 與 server patch 若
  部署順序錯開也只是暫時顯示舊樣式，不會壞。搜尋：原型名可搜，主力打手搜尋**保留**
  （保守：站長沒說要移除，兩者都能搜）；placeholder 改「牌組(原型/主力)」。
- 效能：nameMap 全行程一次、rules 30s TTL（規則 CRUD 即 invalidateRulesCache）、
  分類純記憶體 set 運算，整份列表一次 enrich；守衛 benchmark 見下（600 副/輪 毫秒級）。
- **仍在用舊「主力打手」做法的地方（本版刻意不動，供站長日後決定）**：
  ①Firebase 對戰分頁 badge／搜尋（退路共用）②賽事統計每人主力牌型（admin.html L1560）
  ③名人堂冠軍牌型 champMain（L1727）④奪冠報告圖 `deckLabel` 的 fallback（L4191，
  archetype 缺時退 detectMainPokemon）⑤對戰歷史 matchRecord 主力牌組（L5630）
  ⑥統計「4. 主力寶可夢使用率」與 main/support 篩選（L1636／L6325／L6959）。
  支援型寶可夢清單編輯器（openSupportPokemonEditor L3194）仍被「牌組原型統計」
  未分類高頻卡使用——**不可刪**，只是 Oracle 對戰分頁不再依賴它。
- 守衛：`scripts/test-v6229-admin-archetype-parity.mjs`——BASE 上 HEAD-FAIL；
  三情境（命中規則／未分類／null）**兩端逐字相同（===）**用「同一副 deckEntries 餵
  兩個端點實跑」斷言到行為層；UI 端 renderRoomRow 實跑驗 DOM 輸出（【名稱】／null
  無標籤／undefined 退回 ⚔️）；突變測試四組（server null→'未分類'／拔 enrich／
  UI 改回主力打手／UI 把 null 當未分類）全紅才算數；另附 enrich benchmark（Rule 32）。

## v6.228 瞪眼效用漏擋「手牌特性放備戰」路徑（USE_HAND_ABILITY）——中央收斂修正

BASE = `754f117e5ed6e2a632747facdae9b0d5b6988908`（v6.227）。站長回報：對手戰鬥場有
火箭隊的阿柏怪（SV10#12807，I 標，瞪眼效用）時，仍可從手牌用 烈箭鷹ex｜激動俯衝（M6#19612）
把自己放上備戰區。卡面：「只要這隻寶可夢在戰鬥場上，對手不可從手牌將擁有特性的寶可夢
（「火箭隊的寶可夢」除外）放置於場上。」

- 真因（站長判斷正確）：中央述詞 `isOppEvilEyeBlocking` 已接 PLAY_BASIC／EVOLVE／
  getPlayableBasics／getEvolvableTargets／神奇糖果（v5.887），唯獨 v6.080 新增的手牌特性
  路徑（`getHandActivatableAbilities`＋`USE_HAND_ABILITY` handler）漏接。
- 修法（中央收斂）：engine.ts 新增中央述詞 `getHandPlacementBlockReason(state, aIdx, card,
  pool)`（回傳 '全能靈魂'｜'瞪眼效用'｜null），PLAY_BASIC／EVOLVE／getHandActivatableAbilities／
  getPlayableBasics／getEvolvableTargets 五個消費點全部改走同一份；engine handler 與兩套 UI
  本就共用 getHandActivatableAbilities ⇒ 單點修，log 文案逐字不變。
- 附帶收斂（「五件事」比對的第 4 項）：`makeHandToBenchAbility` 裸化改走 toBareCard 白名單
  （原黑名單漏 extraTools／cantAttackThisTurn／healedThisTurn／immune* 旗標，v5.993 同型）；
  `klingerAbility_EmergencyRotate` 改為 `makeHandToBenchAbility('緊急迴轉')`（消除重複實作）。
- 不改的路徑（皆查證過卡面）：全能變身＝與**牌庫**互換上場，不在瞪眼「從手牌」射程；
  化石（PLAY_FOSSIL）無 abilities ⇒ 述詞恆放行；神奇糖果維持 effects.ts 內同一
  isOppEvilEyeBlocking（import 方向不可反向拉 engine）；BENCH_PLACE_TRIGGERS／
  promptPlayAbilities 不接 USE_HAND_ABILITY 路徑（齒輪怪／烈箭鷹ex 均無 on-bench-place
  註冊，接了是死碼，留待真的有卡需要時再接）。
- 守衛：`scripts/test-v6228-evileye-hand-ability.mjs`——BASE 上 2 FAIL（HEAD-FAIL 證明：
  激動俯衝／緊急迴轉都放得上）；修後 8 PASS。正對照四組：阿柏怪在備戰區不擋、
  「火箭隊的急凍鳥」不擋、無特性不擋、特性被消除（abilityNullifiedThisTurn＋振翼髮 passive
  兩種來源）不擋；另鎖 PLAY_BASIC 既有 gate 不因收斂鬆動。

## v6.227 診斷回報帶上 Cloudflare 邊緣節點（colo）——分辨「節點劣化」vs「cloudflared 劣化」

BASE = `1a065938ade5dd9ac0675a3186525f8cac4b1c59`（v6.226）。純觀測遙測（玩家看不到），
依站長裁定不上首頁 changelog。

- 背景（已實測）：台灣 HiNet 出口被 Cloudflare 導去**美西 SJC**（8/8、`connect` 148~155ms
  ＝台灣↔SJC 一趟，與玩家 `net` p50 138~151ms 吻合），隧道端在新加坡。「偶發 3~4 秒尾巴」
  剩兩個競爭假說：(a) cloudflared 內部狀態隨 uptime 劣化（重啟可解）vs (b) 特定 CF 邊緣節點
  劣化（重啟只是碰巧換節點）。目前沒有任何資料能區分 ⇒ 本版把 colo 記進既有診斷回報。
  ⭐ 判準：慢的人**集中在特定 colo** ⇒ (b)；**跨所有 colo** ⇒ (a) 或更上游。
- 做法（零額外請求）：`cf-ray` 是**回應標頭**（`a2fb6ea96b799913-SJC`，`-` 之後就是 colo），
  同源 ⇒ 全部讀得到。沿用 `X-Srv-Ms` → `_srvMs` 同一條路，在 tApi 收回應時順手讀，
  **不打** `/cdn-cgi/trace`、不加任何請求。守衛用 tApi 端點白名單＋剝註解後禁 cdn-cgi 雙重鎖住。
- 收什麼：payload 新增頂層 `colo: { last, seen:{SJC:18,TPE:2}, miss } | null`。
  `seen` ＝這場（熱路徑成功往返）看過的 colo 計數——單筆玩家可能在對局中換節點，記逐筆會
  吃爆 8192 上限，記計數最壞情況（8 個相異 colo）實測 131 字元。`miss` ＝成功往返但沒有
  cf-ray（SW 快取／不經 CF），本身就是有用的指紋。記錄函式 `_tRecordColoSample` 的三行
  範圍守衛與 `_tRecordApiSegments`/`_tRecordSrvSample` 逐字相同（母體一致才能對照 net）；
  離場（tLeaveMatch）清空（跨場殘留會把上一場的節點掛到下一場）。
  ⚠ 欄位刻意放 payload 前段（ver 之後）：8192 截斷砍尾端，關鍵欄位不能陪葬。
  ⚠ 異常批（slow-rtt 等）與健康取樣批（perf-sample）走同一個 payload builder ⇒ 兩批都有。
- 伺服器端零改動：/clientdiag 原樣存 JSON（8192 cap／per-(uid,reason) 60 秒節流／截斷偵測
  全部維持）。舊 client 沒這欄 ⇒ 欄位缺席＝「不知道」，報表顯示「—」不當成 0。
- `dump-client-monitor.cjs` 新增 ②-e colo 分組表（異常批／取樣批分開；每 colo 的樣本數、
  net典型＝各筆 p50 中位數、net尾巴＝各筆 p95 中位數、RTT p95 中位、slow-rtt 佔比、
  換節點筆數；母體不可相加），JSON 輸出帶 `colo:{anomaly,sample}`；純函式
  `coloOf`/`coloSummary`/`coloTableLines` 匯出供守衛實跑。
- 守衛：`scripts/test-v6227-colo-telemetry.mjs`——餵假回應實跑 cf-ray 解析（含無標頭／
  垃圾字串／headers.get throw 不爆）、記錄函式（範圍守衛／鍵數上限 8）、payload 算式、
  端到端（假回應⇒解析⇒計數⇒payload）、dump 分組（含截斷列不爆）。HEAD-FAIL 已驗證
  （v6.226 上 17 FAIL）；突變（拔接線／解析改壞／分組漏 slow-rtt）皆紅。

## v6.226（admin v1.73）報告圖文字：長名不必要截斷＋置中註腳左右被裁

BASE = `23e199c70d1d17eeb50f27a1016257f24a663262`（v6.225）。純 admin 後台工具改動，
依既有政策不上首頁 changelog（`test-v6223` 的「changelog 含當前版本」斷言同步放寬為
「最新條目版本 ≤ 當前版本且 ≥ 6.223」）。

- 站長回報【A】：奪冠報告完整版（1920 多頁 ZIP）玩家名顯示「拼key拼key拼…」，但該列
  右側到「28 人 · 4 勝 0 負」之間一大片空白。真因＝`mpDrawChampion` 冠軍逐場列
  `miFit(ctx, c.name, 300)` 寫死 300px；單頁奪冠報告 `crDraw` 同型（名字 260px）。
  修法＝名字／牌組名**共享該列實際可用寬**（右緣 − 起點 − 間距；多頁版 1632px、單頁版 912px），
  分配策略「名字優先、牌組名保底 DECK_MIN（多頁 380／單頁 300）」：名字放得下就完整顯示；
  名字過長時其餘全給名字＝極端長名硬上限（多頁 1252px ≈ 31 全形字），絕不撞右側成績欄。
  第一行賽事名上限也改依右欄成績實寬動態算（原寫死 420／300）。
  名次頁原型名 900 → 1016（可用寬到長條起點）。
- 站長回報【B】：單頁環境報告底部註腳「本期為單期成績…不顯示勝率」開頭「本」結尾「率」
  都被切掉。真因＝`miDraw` 註腳**置中單行直畫、零寬度處理**（置中溢出＝左右同時被裁）。
  修法＝新增 `miWrap`（中文逐字斷行、英數 run 不硬切），長註腳換成兩行**完整顯示**；
  兩行時頁腳（logo＋網址＋註腳）整塊上移（網址 1284→1266、註腳 1301/1329），
  第二行下緣 ≈1342 仍在畫布 1350 內；**單行時版位與 v1.72 完全相同**（正對照）。
  若未來文案長到 22px 兩行塞不下：自動縮 19px 再換行，仍超過才對尾行 miFit（唯一允許截斷處）。
- 【C】全面掃描三種報告圖的 fillText／miFit 上限 vs 實際可用空間：其餘呼叫點
  （miDraw 原型名 360、mpDrawMeta 原型名 500、mpFrame 副標／註腳、crDraw 名次列 IW−300、
  crNotes 註腳 IW、各置中頁腳字串）逐一核對均在可用寬內，不改。
- 守衛：`scripts/test-v6226-report-text-fit.mjs` —— 沿用 v6168/v6169 的記錄型假 ctx
  **真的畫一遍**（全形 1.0em／半形 0.55em 量寬模型）：全部文字左右緣不得出畫布、
  20 全形字玩家名不得有「…」、40 字極端名要截但名字寬必 >800px 且牌組名保底 ≥300px、
  長註腳兩行拼回原文一字不差且不撞網址列不出下緣、短註腳單行版位 byte 級不變（正對照）、
  每個 draw 有畫出字數下限（Rule 25）。HEAD-FAIL 已驗證；突變（動態寬改回寫死常數／
  換行改回單行／1016 改回 900）皆紅。

## v6.225 手牌特性「每回合限 1 次」追蹤鍵改 per-instance（iid）

BASE = `91007b6432ee0e02c43609c452e897abf4c4c297`（v6.224）。

- 站長回報：戰鬥場超級袋獸ex＋手牌 2 張烈箭鷹ex（M6#19612，J，特性「激動俯衝」），
  回合中只能放 1 隻到備戰區，第 2 隻按不出來。齒輪怪（SV7#10964，H，「緊急迴轉」）同型。
- 真因：`engine.ts` 的 `getHandActivatableAbilities`（`usedNames.includes(ab.name)`）與
  `USE_HAND_ABILITY` handler（寫入 `abilityNamesUsedThisTurn`）用**特性名**記在玩家層級
  ⇒ 整個玩家側一回合只能用一次。卡面主詞是「若手牌有**這張卡**…則可使用 1 次」＝ per-instance。
  與 v2.91→v2.93 土龍節節事故同型（場上路徑當年已用 `SHARED_ONCE_PER_TURN_ABILITY_NAMES`
  白名單修正，手牌路徑漏修）。
- 修法（中央收斂，單一判斷）：新增 `PlayerState.handAbilityUsedIidsThisTurn?: string[]`
  （純 string[]，Firestore 安全；END_TURN 與 `abilityNamesUsedThisTurn` 一同清除），
  engine.ts 新增成對中央函式 `isHandAbilityOncePerTurnUsed`（判定端，getHandActivatableAbilities 用）
  ＋ `markHandAbilityUsed`（標記端，USE_HAND_ABILITY handler 用）：
  `SHARED_ONCE_PER_TURN_ABILITY_NAMES` 內＝特性名共享（卡面明寫「使用了其他的『XX』的回合
  無法使用」），名單外＝以 iid 各自計次。兩套 UI（桌機／手機直式）都走
  `getHandActivatableAbilities`，零 UI 改動。
- 【B】全站 audit「每回合限 1 次的追蹤鍵」：
  - 場上主動特性 `USE_ABILITY`：per-instance `abilityUsedThisTurn` ＋ SHARED／UNLIMITED 白名單 ✓。
  - `USE_HAND_DISCARD_ABILITY`：name-based，但 `ON_DISCARD_FROM_HAND_ABILITIES` 自 v5.510 起為
    **空 Map**（誘導之尾／熱浪鱗粉已改走 regA per-instance）⇒ 死碼路徑，無玩家可見影響，不動。
  - 觸發型（ON_PLAY／ON_EVOLVE／ON_RETREAT／ON_PROMOTE）：per-trigger 天然一次；
    霸者咆哮 v6.083 已有正確對照註解 ✓。殺手鐧捕捉的 ad-hoc name 記錄＝卡面明寫 shared ✓。
  - 重試徽章（player-level flag）：卡面主詞「這張卡」理論上 per-tool，但同回合第二次攻擊
    只有祭典樂舞能造成，其持有者（裹蜜蟲草／角金魚水／金魚王水／綿綿泡芙超）皆非【無】屬性，
    而徽章只對【無】寶可夢招式生效 ⇒ 現行卡池行為等價，不動（記錄備查）。
  - 力之沙漏（戰鬥場限定、END_TURN 觸發一次）／stadiumUsedThisTurn（規則層）／
    festivalDance*（雙攻窗機制）／attackUsedThisTurn（招式冷卻，另一維度已掃）✓ 乾淨。
  - 白名單複驗（逐張對卡面）：SHARED 8 條全部卡面明寫（音速搜索／裝酷重抽為 G 標 live，留置無害）；
    live H/I/J 全掃描含「使用了其他／已經使出」措辭的特性全部已在名單內，無「該在不在」。
    UNLIMITED 7 條與 live 掃描出的 7 個「可不限次數使用」完全一致。
- 守衛：`scripts/test-v6225-hand-ability-per-instance.mjs`（6 測；已加入 npm test 鏈）。
  HEAD-FAIL：BASE 上 4 FAIL（重現站長情境）。突變：per-iid 改回 name→紅；
  手牌 SHARED 分支旁路→紅；場上 SHARED gate 單層旁路→仍綠（v6.181 起 handler＋
  getUsableAbilities 雙層防禦，第二層擋住）、兩層皆旁路→紅。

## v6.224 官網代碼匯入逾時保護（後端 20s + 前端 25s）

BASE = `a7dbc1549a63be48bfd80251c380c43658b921c4`（v6.223）。

- 證據：nginx 計時 log 2026-08-23 一筆 `11.974s → 200 /api/decode-tw-deck/...`，第 3 欄＝等 node
  ⇒ 全部耗在 `oracle-admin/server_admin_patch.js` registerTwDeckImport 對
  `asia.pokemon-card.com` 的外部 fetch（await 外部 I/O，不阻塞事件迴圈、其他玩家不受影響，
  但 Node 的 fetch 預設沒有時間上限 ⇒ 官網掛住時該玩家無限期乾等）。
- 後端：`AbortController + setTimeout(20s)` ＋ `finally clearTimeout`；逾時回 504
  「官網回應太慢，請稍後再試」（`err.name === 'AbortError' || 'TimeoutError'` 特判，不吐原文）。
  20 秒依據：官網實測慢到 11.97 秒仍成功回 200，逾時設 10 秒會把「慢但能成功」切成失敗；
  20 秒亦低於 nginx proxy 預設 60 秒，由本端先逾時、訊息才有意義。
  相容性：VM 的 Node 版本無法在沙盒直接查證；handler 既有程式用全域 fetch ⇒ 必為 Node 18+
  （AbortSignal.timeout 理論上可用），仍選相容性最保守的 AbortController + setTimeout。
- 前端 `src/routes/decks/+page.svelte` importFromTwOfficialCode：同法 25 秒
  （比後端稍長，讓後端先逾時回覆有意義訊息）；AbortError 特判 alert；
  等待期間原本就有「⏳ 解析中…」＋按鈕停用，不另補 UI。
- 順手查證皆正確：限流（5/min per IP）在昂貴 fetch 之前扣；400 格式驗證又在限流之前
  （無效格式不白扣額度）；deckCache TTL 5 分鐘、命中不重打官網。
- 守衛 `scripts/test-v6224-deck-import-timeout.mjs`：node:vm 實際執行 handler、fetch 替身
  真掛住（僅在收到 abort 時 reject）。HEAD-FAIL＝BASE 上 7 紅（handler 永不回應，行為級）；
  成功路徑與 400/404/422/429/500/快取各分支對 BASE 行為快照 deep-equal；
  突變 M1 去 signal／M2 去 AbortError 特判／M3 去 clearTimeout／M4 逾時改 10s／
  M5 前端逾時 ≤ 後端 → 全數被抓（exit=1）。

## v6.223 版面三修：fable 卡背同源尺寸 / 桌墊版高度自適應 / 桌機預設版面改 fable

BASE = `1dcb862e2a37503f32777dbd1287c48a4c2c980a`（v6.222）。全部結論來自 headless Chromium
對測試站（github.io, v6.222）的真實渲染量測（本機 AI 對局），非純靜態推算。

### 【A】fable setup 卡背過大（站長截圖）
- 真因：`.card-back-lg{105×140}` / `.card-back-sm{96×128}`（+2px border）是全域固定 px；
  fable 的 `.active-card` 被鎖成 `--active-w/--active-h`（隨視窗縮放），卡背不縮 →
  1180×820 時正面卡 72px、卡背 109px（+51%），比例也不同。
- 修法：fable scope 加 `.card-back-active .card-back` / `.card-back-slot .card-back`
  `width/height:100% + box-sizing:border-box` → 與正面卡同尺寸源。
- 量測：修後 back == front 完全相等（1912×836:100.8 / 1867×831:99.8 / 1366×768:83.6 /
  1440×900:88.2 / 1024×768:72.2）。classic/tabletop 卡背走 gameZoom 同步縮放，本來就一致，不動。

### 【B】超框系統掃描（3 版面 × 10 viewport，真實渲染）
- 桌墊版（tabletop）＝最大災區：內容在 zoom=1 需 ~886px 高。h<=850 時 tablet-layout 的
  `:global(.battle-root.tablet-layout .playmat){grid-template-rows:minmax(0,1fr) auto minmax(0,1fr)}`
  寫在檔案較後面，把桌墊版 4-row grid 蓋掉 → row 被壓縮、固定高的 active 溢出軌道 →
  上下戰鬥場重疊（1366×768 重疊 67px / 1867×831 55px / 1912×836 39px）＋對手 bench 出上緣。
  修法：(1) recomputeZoom auto 模式 targetH：tabletop=900（classic 在非 tablet-layout=945、
  tablet-layout 維持 768）；(2) `:global(.battle-root.tablet-layout:has(.playmat.layout-tabletop) .playmat)`
  還原 4 auto row；(3) `:global(.battle-root.zoomed:has(.playmat.layout-tabletop))` 高度
  `calc(100dvh / var(--game-zoom))` —— zoom 對 vh 定高容器不會增加 CSS px 空間（經典版
  1024×768 縮放後底部留黑即同一效應），必須換算才能真的多出可用高度。
- classic：1440×900（非 tablet-layout 縫隙 851~941px 高）整頁捲動 42px（scrollHeight=942）
  → targetH 945 讓此區間自動 zoom（0.952），tablet-layout 行為不變。
- fable：>=1024 全部視窗實測無超框（1024×768 ~ 1920×1080 共 8 種）。<1024 fallback 兩處補洞：
  空 bench 槽塌成 ~8px 細條（基礎規則 width:auto 在 fallback flex 列的後果）、log-col 浮在
  畫面中間 → 槽寬固定 var(--card-w)、log 滿寬限高 220px。
- 已知未修：真 iPad 直式（coarse pointer 601~950 直向）有全螢幕 rotate-prompt 蓋台，
  fallback 只影響桌機窄視窗；classic 內容高 942 是行為現況，僅以 zoom 吸收，未改版面。

### 【C】桌機預設版面 classic → fable
- 只動「從未選過」者：onMount 讀 `ptcg_battle_layout`，命中三值之一 → 沿用玩家選擇（不覆蓋）；
  沒存過且 innerWidth>=1024 → fable；窄視窗維持 classic（fable 完整 grid 的 media 分界就是 1024）。
- 預設值不寫 localStorage —— 玩家實際切換才由 setBattleLayout 寫入。
- 手機直式零影響：MobilePortraitBattle.svelte 不讀 battleLayout（grep=0）；recomputeZoom 對
  mobile 兩條路徑（fable 早退 / isPortraitMobile 早退）都回 1，值不變。

### 守衛
- scripts/test-v6223-layout-fixes.mjs：recomputeZoom 抽出來「實際執行」斷言 zoom 數值
  （tabletop@1366×768→0.853、classic@1440×900→0.952、fable→1、mobile→1）；
  【C】localStorage 分支抽出執行（已選 classic 不被覆蓋＝正對照）；CSS 修規則存在＋
  cascade 順序（在被蓋規則之後）＋specificity 高於對手規則；手機分支純淨（MobilePortraitBattle
  無 battleLayout）。BASE 上跑全紅（HEAD-FAIL），突變（900→768、100%→50%、fable→classic 預設）全紅。

## v6.222 根治「強制更新後又退回舊版」：SW 預快取 HTML 強制回源（cache:'reload'）

BASE = `06da8d19e75275b314ea019e5cc834295f7cfa7e`（v6.221）。

### 真因鏈（站長手機實測：強制更新→6.221→關 App 重開→退回 6.219）
- 實測正式站回應標頭：`/` `/cards` `/decks` `/tournament` 等 HTML **完全沒有 Cache-Control**
  （只有 last-modified、cf-cache-status: DYNAMIC）⇒ 瀏覽器套 RFC 9111 §4.2.2 啟發式新鮮度
  （常見實作＝距 Last-Modified 時間的 10%）。
- `cache.add(url)` 功能等同 `fetch(url)` 成功後 `cache.put`（MDN Cache.add），fetch 預設
  cache 模式 `'default'` **會先查瀏覽器 HTTP 快取** ⇒ 新版 SW install 可能把 HTTP 快取裡的
  **舊版 HTML** 存進新版 CACHE_NAME。
- PWA start_url='.'＝`/`，`/` 在 PRECACHE、fetch handler 對 PRECACHE 是 cache-first ⇒
  冷啟動吃到舊 HTML → 舊 chunk hash（immutable、HTTP 快取一年）→ 整個 app 退回舊版。
- `hardRefreshNow()` 清 Cache API＋`?_v=` 重載當下有效，但**清不掉瀏覽器 HTTP 快取**（JS 做不到），
  reload 後 SvelteKit 重新註冊 SW、install 又被同一份舊 HTML 下毒 ⇒「關閉再開又變舊」。
  這也是監控中大量玩家停在 v6.210 的最合理解釋：**每次日常 SW 更新的 install 都可能被下毒**，
  與強制更新無關。
- 已排除的其他解釋：SW 腳本本身被 CDN 快取（v6.160 時 `/service-worker.js` 曾是 cf HIT
  max-age=14400，現實測 DYNAMIC＋etag，且瀏覽器對 SW 主腳本預設繞過 HTTP 快取、上限 24h）；
  install 失敗（v5.354 起 allSettled，單檔失敗不擋 install）；cachesToDelete 誤刪（保留現行版＋前一版）。

### 修法（src/service-worker.ts）
- `FRESH_HTML = prerendered − /card/* − *.xml`（實際＝`/` `/admin/feedbacks` `/cards` `/decks`
  `/tournament`，合計約 51KB）在 install 改 `cache.add(new Request(absUrl, { cache: 'reload' }))`
  —— MDN Request.cache 文件的標準 cache-busting 寫法：繞過 HTTP 快取直接回源。
- build（hash 不可變 ~9MB）與 files（cards JSON 等，伺服器明示 max-age=86400）**維持原語義**：
  強制回源只會白抓流量、拖慢 install。`/sitemap-cards.xml`（563KB，爬蟲用）同理排除。
- try/catch：Request 建構子對 cache 選項丟例外的環境退回原寫法（寧可舊語義也不讓 install 掛）。
- install 影響：多 5 個必回源的小請求（~51KB），對 ~9MB 的 install 可忽略。

### 同型漏洞（本版不動，留待後續）
- fetch handler 的 network-first 分支 `fetch(event.request)` 對**非 PRECACHE 頁**（`/game`、
  `/card/*`）同樣可能從 HTTP 快取拿到啟發式「仍新鮮」的舊 HTML 並 cache.put —— 根治要靠伺服器
  對 HTML 補 `Cache-Control: no-cache`（nginx）；SW 端強制 reload 會犧牲頻寬與離線語義，暫不做。
- `/cards/*.json` `max-age=86400`＋CF HIT：新卡上線最多 24h（CF 邊緣另計）舊資料，屬既有取捨。

### 建議的 nginx 設定（站長自行判斷後執行，本版未動 VM）
- HTML 補 `Cache-Control: no-cache`（每次 revalidate，搭配既有 Last-Modified/ETag 走 304，
  頻寬近乎零）；`/_app/immutable/` 維持 `max-age=31536000, immutable` 不可動。

### 守衛
- `scripts/test-v6222-sw-precache-fresh-html.mjs`（行為級）：esbuild 打包真 SW＋假 HTTP 快取層，
  dispatch install，斷言 prerendered HTML 的 Request.cache==='reload'、舊版內容不入 precache、
  build/files/sitemap 不強制回源、/card//covers/music 不預快取、單檔失敗不擋 install、
  舊瀏覽器退路；**突變測試**（把 reload 改回 default）必須觀察到假 HTTP 快取層下毒。
  BASE 上實跑 HEAD-FAIL：2 條核心斷言紅（'/' 存進 precache 的是 OLD_HTML_v6219）。

## v6.220 休閒對戰減量【A】gameState.log 增量下發＋【B】seats[].email 不下發玩家端（隱私，首頁不寫）

BASE = `62023cbca95f36d80d922c6231796367761c5e5f`（v6.219）。

### 背景（v6.216 尖峰翻案的延續）
- 真因鏈已實測定案：台灣玩家 → Cloudflare 美西 SJC（149ms）→ CF 內網 → 新加坡 VM；
  VM 內部尖峰 nginx 5~7ms、CPU 19% ⇒ 機器清白，**省位元組/省往返才是投報率最高的方向**。
- 休閒對戰佔全站 94% 流量（v6.178 實測）；`gameState.log` 佔房間 doc ~60%（第 9 回合
  202 則 ≈ 29.2KB）且隨對局**線性成長** —— 每 0.5~1s 的盤面輪詢每次都整包重傳。

### 【A】log 增量下發（三道防線，正確性 > 效能）
- client（`oracle-client.ts` 的 `oraclePollRoom`）第二發起帶 `logSince=<已有則數>` 與
  `logh=<前綴鏈雜湊>`；伺服器（`server_admin_patch.js` v1.20 的 PTCG-ROOMS-OUT 區塊，
  hoist 到第一個 route 之前、包裝 `res.json`）對自己 log 的前 n 則算同款雜湊，
  **逐字相同才**把 log 換成 `log.slice(n)` 並附 `logDelta{since,total,fh}`。
- 雜湊 = FNV-1a 雙 32bit，對每則 log 的 `JSON.stringify` 逐字元累積＋每則分隔符；
  兩端逐字元同演算法（JSON round-trip 保序保值，守衛用同一份資料實跑兩端比對）。
  為什麼安全：①只比長度會漏「等長但內容不同」，前綴雜湊直接把內容納入判準；
  ②`fh` 是伺服器對「完整 log」算的雜湊，client 重組後**必須複驗**，等於端到端
  逐位元組等價檢查（擋中途突變、競態、兩端演算法漂移；雙 32bit 碰撞率 ~2^-64，
  且碰撞後果只是「多沿用一發舊前綴」，下一發內容再變即自癒）；
  ③複驗不過 → client 丟棄整包並**立刻改抓一次全量**（不帶增量參數）。
- fail-open 全表（任一即回全量，行為與 v6.219 逐字相同）：舊 client 不帶參數／參數解析
  不了／n>伺服器 log 長度（悔棋）／等長但前綴雜湊不同（重置/重開一局）／gameState 或
  log 缺席（大廳房）／`res.json` 轉換中任何例外／middleware hoist 失敗（旗標整組停用）。
- 觀戰者/重新整理/換裝置/重連：新輪詢閉包 lastLog=null ⇒ 第一發永遠全量。
- 與既有機制逐一確認：`?since=ver` 204 不動（核心端點先回，包裝層根本沒 body 可轉）；
  樂觀更新不受影響（重組鏈是輪詢層私有的「伺服器回應鏈」，本地樂觀 log 不進鏈）；
  `stale-keep`／`decideBoardAdopt`／對手回合面板／回放全部吃到「重組後的完整 log」，
  一行未改；`oracleTx` 讀改寫與 `pushGameState` 走 `oracleGetRoom`（永遠全量）；
  錦標賽路徑（`/api/tournament/state`）不動 —— v0.71 起本來就只送最近 60 行 log，
  wire 已有界，這次只做休閒。⚠ 儲存端完全不截（v6.178 v1.11 的教訓：回放靠房間
  gameState.log 當 fallback）。
- 實測（守衛 `scripts/test-v6220-log-delta-and-email-privacy.mjs` 內建量測，Rule 32）：
  202 則 log 的房間、新到 1 則時：全量 raw 62.3KB/gzip1 4.04KB → 增量 raw 18.5KB/
  gzip1 0.73KB ⇒ **raw −70%、gzip −82%**（合成 doc 的 log 佔比 71%；線上實 doc log 佔
  60%，前一輪以真實房間 doc 估測為 wire −49~−52%，兩者相符）。
- ⭐ **更正（v6.221）**：上面 −70%/−82% 是**合成 doc** 量出來的，填充資料的壓縮率失真、
  高估了幅度。獨立審查以 **383 場真實對局**重量的結果是 **raw −60%、gzip −53%**
  （與本節自己記的「真實 doc 估 −49~−52%」相符）。首頁文案原寫「約減少五到八成」屬誇大，
  v6.221 已改為「約減少五成」（純文案更正，不另寫首頁 changelog）。

### 【B】seats[].email 不再下發玩家端
- 前端唯一消費點 = `game/+page.svelte` 的 `fireMatchRecord`（把雙方 email 送進
  matchRecords 供 admin 以 email join）→ 改由**伺服器**在 `/api/match-result` 從房間
  doc 補 email（舊 client 有送以送來的值優先）；前端零改動、admin 統計口徑不變。
- 剝除點：GET `/api/rooms/:code`、GET `/api/rooms`、PUT 回應（同一個 res.json 包裝層），
  v1.17 combined 大廳列表（該 mw 直接回應、自帶同款剝除）。`/api/admin/*` 不經此層。
- ⚠ 關鍵配套：client 是「GET 整包→改→PUT 整包」，GET 剝掉後寫回會把 DB 的 email 洗光
  ⇒ 新增 PUT 回填 middleware（incoming seat 有 uid、沒帶 email、DB 同座位同 uid 有
  email → 回填；uid 不同＝換人/離座，一律不回填）。兩支 mw 有任一 hoist 失敗則整組
  停用，避免「GET 已剝但 PUT 沒回填」的半套狀態。
- admin 房間檢視本就走 `enrichSeats`（Firebase uid 反查 email，seat.email 只是 fallback）
  ＋ admin 專用端點，不受影響。

### 守衛（14 項，全行為層實跑）
- `scripts/test-v6220-log-delta-and-email-privacy.mjs`：抽 server 區塊＋client 區塊實跑
  整條「轉換→走線(JSON round-trip)→重組」管線，**逐則**比對；涵蓋多輪成長/空增量/悔棋/
  等長不同內容/舊 client/空 log/大廳房/參數壞掉/`oraclePollRoom` 四發實跑（含壞 fh 時
  立刻改抓全量）。突變測試兩件：client 前綴反轉（長度不變）→ fh 必攔；server 多切一則
  → client 必拒。HEAD-FAIL 已於 BASE 實跑確認（抽不到區塊直接紅）。
- 【B】守衛：三種 GET/PUT 回應 email 全剝、原 doc 不被改、PUT 回填三分支、
  combined 列表剝除、match-result 補 email 四分支。

### 部署注意
- 需跑 `redeploy-oracle.bat`（或既有更新 VM patch 的流程）讓 server_admin_patch.js v1.20
  生效；**不需要** update-tournament.bat（未動 engine/effects/卡 DB）。
- 驗證行：pm2 log `[rooms] rooms-out transform middleware (v1.20) hoisted=true`。
- 舊 client×新伺服器/新 client×舊伺服器 皆全量 fail-open，部署順序無要求。


## v6.219 admin 總覽 /api/admin/stats 提速（users 統計快取；純後台，玩家無感 ⇒ 首頁不寫）

BASE = `fd708e93d93030a9f567265d2e9fa9d29da69abf`（v6.218）。

### 症狀與判定（先判嚴重性，不假設）
- nginx 計時 log（2026-08-22）全站最慢前三筆全是 `/api/admin/stats`：15.862／15.393／14.683 秒，
  第三欄（等 node）≈ 第二欄 ⇒ 15 秒全部在 node 內。node 是 pm2 fork 單執行緒，
  若是同步運算會卡住全站 ⇒ 必須先實測分辨。
- ⭐ **實測判定：是 await 的網路 I/O，不是同步阻塞（不會卡玩家）**：
  - handler 內唯一同步 JS 段（50k 使用者的 Set/filter/Date 聚合）沙盒實測中位數 ~51ms
    （沙盒約 10 倍慢 ⇒ VM 約 5ms）；`res.json` 序列化 0.013ms／339 bytes
    —— 與 15 秒差超過兩個數量級（量測腳本 `/tmp/bench1_sync_agg.mjs`）。
  - 把 50 頁循序 await 的掃描迴圈原樣重演並掛事件迴圈監測：總耗時 1075ms 期間，
    事件迴圈超額延遲 max 僅 1.7ms（p50 0.23／p95 0.85）⇒ 等待期間事件迴圈是空的
    （量測腳本 `/tmp/bench2_eventloop.mjs`）。
  - 線上旁證：同時段全站平均 5ms、其他慢請求的第三欄僅 0.005~0.069s
    —— 若事件迴圈被卡 15 秒，不可能只有這一支慢。
- 真因：users 統計用 `adminAuth.listUsers(1000, pageToken)` 逐頁抓全部使用者
  （上限 sane safety 50,000 ⇒ 最多 50 頁），每頁一趟**循序** HTTPS 往返；
  三筆樣本緊聚 14.7~15.9 秒 ⇔ 固定 ~50 頁 × ~300ms RTT（頁數固定所以耗時穩定）。
  ⇒ **不是會卡全站的定時炸彈**；但 admin 每開一次總覽就白等 15 秒＋對 Firebase Auth 打 ~50 發循序請求。

### 修法（`oracle-admin/server_admin_patch.js` v1.19）
- 比照 v0.95 `/firebase/users-all` 既有先例：users 統計結果快取 **5 分鐘 TTL + single-flight +
  過期先回舊值、背景刷新**。除進程重啟後的第一發外，admin 不再等掃描。
- ⭐ 口徑一致：掃描與聚合程式碼一字未動（含 50,000 上限），只改「什麼時候算」；
  回應多帶 `users.at`（計算時刻），admin 總覽的用戶統計區標示「資料時間 …（最多 5 分鐘更新一次）」。
- oracle（mongo）／firebase rooms／feedback 統計**不快取**，維持即時（進行中／等待中要看即時數）。
- 玩家端零改動：本端點僅 admin 白名單可打；快取只減少 Firebase Auth 呼叫，不增加任何負載。

### 守衛（`scripts/test-v6219-admin-stats-users-cache.mjs`，已進 npm test）
- **行為層**：把 patch 檔的快取 helpers 與整支 handler 抽出來真的跑（可計數 listUsers stub）：
  ①正對照：冷啟動真的掃滿頁數且數字與 fixture 期望一致（口徑）②⭐第二發不重掃且耗時 < 冷啟一半
  （HEAD-FAIL：BASE 上 5 紅；蓄意破壞快取後守衛也抓得到）③TTL 過期先回舊值、背景刷新後拿到新值
  ④mongo／feedback 每發即時重查（不被快取波及）⑤admin.html 讀 `users.at` 標示資料時間。

### 同型風險（把大量資料撈回 node 的 admin 端點；本版不動，僅列管）
- `/api/admin/rooms`（mongo `.toArray()` 無 limit，v0.20 拿掉 300 上限）與
  `/api/admin/firebase/rooms`（Firestore `.get()` 全撈無 limit）：房間數成長後會越來越慢（同為 I/O）。
- `/api/admin/firebase/users-all`：已有 5 分快取＋single-flight，但 cache-miss 那發仍是全量掃（15 秒級）。
- `/api/admin/firestore-write-audit`（listCollections × 5 個 count 逐一 await）、
  牌組原型統計（matchRecords `limit(20000).toArray()`）：重 I/O，但一個是按鈕觸發、一個已有 60s TTL。


## v6.218 牌組公布欄關鍵字搜尋（伺服器端、涵蓋全部投稿）

BASE = `99dc17559b2708e0301b6110a3d207195ac79abc`（v6.217）。玩家可見新功能 ⇒ 首頁一則。

### 語意（站長拍板三條，全數落實）
- 同一個輸入框自動判斷（不分文字／卡牌兩欄）；空白（含全形）分隔多 token 一律 **AND**；
  全部**部分比對**（「路卡利歐」命中「超級路卡利歐ex」）。
- 單 token 命中（OR）＝牌組名∨作者∨簡介∨**原型名**（合理延伸，超集不違反拍板）含該字，
  ∨ 牌組裡有卡名含該字的卡，∨ 該篇留言含該字。空白輸入＝不篩選。

### 後端（`oracle-admin/server_admin_patch.js` v1.18）
- `GET /api/deck-posts` 新增 `?q=`。q 缺席時 tokens=[] ⇒ 查詢物件與舊版**完全相同**，列表零影響。
- ⭐ 卡名→cardId 解析放**伺服器端**：TPOOL 就是完整卡池（含台灣官方 name），
  client 不必為搜尋載 4.6MB 卡片 DB，也沒有 id 清單塞爆 URL 的問題（原設計傾向前端解析，改）。
- 留言在另一張表（v6.182）：每 token 先 `deckPostComments.distinct('postId', text regex)`
  再以 `_id $in` 併進主查詢的 $or —— 一次 distinct，不是每篇一查的 N+1。
- 中文部分比對用 `$regex` 字串形式（mongo text index 中文分詞切不出詞）；
  現量級 96 篇／26 則留言，regex 在 `{status:1,createdAt:-1}` 索引挑出的集合內過濾即可，
  searchBlob／額外索引在此量級是過度工程，量級破萬再議。
- ⚠ 快取鍵改 `[sort,page,pageSize,arche,tourn,tokens]`：RegExp 進 JSON.stringify 會變 `{}`，
  沿用舊寫法（stringify 整個 q）不同搜尋會撞同一份快取。
- 搜尋另設 60/min per-IP 限流（`dpRate('s:'+ip)`）；回應恆帶 `q` 欄位當**哨兵**。

### 前端（`src/routes/deck-posts/+page.svelte`）
- toolbar 加搜尋框（flex-basis 100% 自成一列，手機靠既有 flex-wrap 全寬，無 @media 開關；
  input 字級 16px 防 iOS 聚焦自動縮放）。debounce 300ms；清除鈕；空結果顯示「沒有符合…」。
- 哨兵：送了 q 但回應沒有 `q` 欄位（舊伺服器）⇒ 顯示「伺服器還不認識搜尋功能」，
  絕不把未過濾列表偽裝成搜尋結果（v6.177／v1.17 同一課）。

### 守衛
- `scripts/test-v6218-deck-post-search.mjs`：抽出 dpSearchTokens／dpTokenOr／整支 GET handler
  **實際執行**（mock DPOSTS/DPCOMM），斷言到行為層：AND 語意、部分比對、留言命中、
  無 q 時查詢物件與舊版逐鍵相同、快取鍵不因 RegExp 而互撞。HEAD-FAIL 已驗證。

## v6.217 尖峰請求減量第二批（大廳合併+204、觀戰 4s、跨房提醒 60s）

BASE = `3d5c3b8937b1275dd6b5a6fbbf574125b5e40a11`（v6.216）。玩家有感（尖峰 lag 改善）⇒ 首頁一則。

### ① ② 休閒大廳列表：合併兩支輪詢＋內容未變回 204（前後端）
- 後端（`oracle-admin/server_admin_patch.js` v1.17）：新 middleware 攔 `GET /api/rooms?status=lobby,playing`
  （核心端點把 `'lobby,playing'` 當字面值查必回空 ⇒ 這個 query 形狀可安全當新協定哨兵）。
  `$in` 一次查兩種狀態、與核心端點同一份 projection（剔 `seats.deckEntries`/`gameState`）/sort/limit(100)。
  回應算「顯示內容 digest」（FNV-1a 雙 32bit，零依賴——ESM host 無 require('crypto')）：
  client 帶 `?h=` 相同→204 零 body；不同→200 `{rooms, combined:true, h}`。
  - ⭐ digest 方向性（fail-safe）：**全欄位都算**（鍵排序後 stringify），只剔已知噪音欄位
    （updatedAt/_version/undoRequest/rematchReady/restartProposed*/returnRoomProposed*）。
    ⚠ lobby 房 `heartbeats` 保留（`isLobbyHostDead` 靠它移死房）；playing 房剔（每 60s bump 一次純噪音）。
    漏剔噪音＝多回 200（現狀）；絕不會 stale。
  - ⚠ `combined:true` 是 client 分辨新舊伺服器的哨兵：舊伺服器回 `{rooms:[]}`，若當真＝v6.177
    「請求失敗偽裝成權威空資料」同型事故。
  - middleware 不自己驗 JWT 簽章，只擋沒有 `Bearer ` header 的裸請求（大廳列表本就對所有匿名登入者
    開放；沒 header 者 next() 給核心 requireAuth 回 401）。hoist 同 v1.11/v1.16 手法。
  - pm2 log 驗證行：`[rooms] combined-list middleware (v1.17) hoisted=true`。
- 前端：`oracle-client.ts` 新增 `oracleListRoomsCombined(h)` 三態（`{rooms,h}` / `ROOMS_UNCHANGED`(204) /
  `ROOMS_COMBINED_UNSUPPORTED`(200 無 combined 旗標)）；`room-oracle.ts` 的 `subscribeOpenRooms` 改為
  先走合併協定，收到 UNSUPPORTED **這一發就**退回舊的兩支輪詢（該訂閱期內不再探測）。
  - ⚠ 網路錯誤**不算**不支援（尖峰最容易網路錯誤，若因此退回舊協定，減量會在最需要時消失）。
  - ⚠ 204 之後仍要 callback：過濾抽成 `filterAndSortOpenRooms` 純函式，**每 tick 重跑**——
    `isLobbyHostDead`(3min)/`isLobbyTooOld`(10min) 是時間函數，資料不變時間也會走，
    死房/殭屍房要靠重跑才會從列表消失。
  - 輪詢節奏維持 2000ms 不變（站長方案③「2s→3s」刻意不做：大廳是配對頁面，新房間出現晚 1 秒
    直接拖慢配對；①②已把該路徑請求砍半＋位元組砍到趨近零，再動節奏的邊際效益不值得體驗風險）。
- 減量估算：大廳頁請求數 −50%（2 支→1 支）；命中 204 時回應體積由 ~11.8KB(gzip ~1.5KB)→0。
  以 lobby 房心跳 60s/房估計，2 秒輪詢的 204 命中率 ~9 成。

### ⑤ 觀戰輪詢 2000 → 4000（`+page.svelte` tPollDesiredMs）
- 觀戰者不參與對局、無任何判定綁在這條輪詢上；`/spectate/state` 未命中版本比對時回全量 redact
  盤面，是觀戰人數 × 每 2 秒的大宗。game-over 10000 檔位不動。base tick 400ms，4000 為整數倍。
- 既有守衛 `test-v6161-lobby-poll-downshift.mjs` 原本釘「觀戰頻率完全不變(2000)」——該斷言為
  當時的正對照而非產品需求，已同步更新為 4000 並註明版本。

### ④ 跨房提醒 /event 輪詢 30s → 60s（`+page.svelte` tAlertPollTimer）
- 這條是「人在一般對戰頁的登入者」全體都在打的備援輪詢；主通道是 Web Push（v0.85）＋
  錦標賽頁自己的 3s 輪詢。最壞晚 60s 發現新對戰，vs 未進場容許窗硬地板 120s（NOSHOW_FLOOR_MIN）
  且預設 3~5 分鐘 ⇒ 不會因此被判未進場。
- 刻意不拉到 90~120s：120s 會貼死硬地板窗，Web Push 被瀏覽器擋掉的玩家只剩這條。

### 沒做的項目（站長裁定用）
- ③ 大廳輪詢 2s→3s：不做，理由見上。
- ⑥ /bracket 只回當前輪：不做——賽程表的歷史輪次與瑞士排名是玩家會翻看的內容，只回當前輪＝
  功能退化；且 /bracket 已有 gzip＋3s TTL 快取（~1.9KB/req），減量效益小、改動面大。
- ⑦ nginx upstream keepalive：VM 設定非 repo，只提供操作單（見交付報告），不代跑。

### 守衛
- 新增 `scripts/test-v6217-lobby-combined-and-alert.mjs`（HEAD-FAIL 已於 BASE 驗證）：
  後端 middleware 抽 `PTCG-ROOMS-COMBINED-BLOCK` 於模擬 Express stack 實跑（204/200/fail-open/hoist/
  噪音欄位不觸發、lobby 心跳觸發）；前端 esbuild 轉譯後實跑 `subscribeOpenRooms`
  （合併一發、204 重跑過濾、UNSUPPORTED 退回兩支、節奏 2000 不變）與 `oracleListRoomsCombined` 三態；
  `+page.svelte` 觀戰 4000 由更新後的 v6161 守衛實跑釘住；tAlert 60000 斷言。

## v6.216 尖峰請求減量三件（8/17 起晚間尖峰 lag 的共享路徑瓶頸）

BASE = `1eba3359ba531857c2657cf15f9820466868c6e5`（v6.215）。玩家有感（尖峰 lag 改善）⇒ 首頁一則。

### 診斷前提（已定案，本版不重推）
- 惡化自 8/17 晚間起、只在尖峰、跨玩家同步，2.5s 全落在 wire(TTFB) ⇒ 共享路徑；引擎無辜（事件迴圈使用率實測 2.4%）。
- 尖峰 115 req/s 絕大多數是輪詢；v6.178 實測休閒對戰佔全站 94% 流量。
- 候選：整機 CPU 尖峰飽和 或 cloudflared 隧道壅塞——減少請求量/回應量對兩者都有效。

### ① gzip 壓縮等級 6→1（`oracle-admin/server_admin_patch.js` v1.16）
- 原設定 `_compression({ threshold: 1024, filter })` 未指定 level ⇒ zlib 預設 6。改為 `level: 1`，
  threshold 與 SSE filter 逐字保留。壓縮 CPU 約省 1/2~2/3，體積約 +15%。
- v1.11 的 hoist（搬到第一個 route 前）不動 ⇒ 全域（含 /api/rooms/*）都吃到新等級。

### ② 休閒聊天輪詢增量化（前後端）
- 後端（同檔 v1.16）：新 middleware 攔 `GET /api/rooms/:code/messages?since=<ms>`，
  `findOne+projection` 判「有沒有比 since 新的訊息」：沒有→204 零 body；有→`next()` 交既有端點回全量
  （格式/排序/limit 逐字一致）。fail-open 三層（不帶 since／解析不了／任何錯誤→next() 全量），
  舊 client 聊天絕不會壞。與 gzip 同手法 hoist；自己 parse query（route 前拿不到 req.query）；
  路徑判斷用 originalUrl/url 禁 req.path。
- 前端：`oracle-client.ts` 的 `oracleListMessages` 加 since overload（204→null，比照 oracleGetRoom）；
  `room-oracle.ts` 的 `subscribeMessages` 記 lastTs、帶 since、null 不 callback。
  ⚠ 輪詢節奏維持 1.5s 不變——砍體積不砍即時性。聊天絕大多數時間無新訊息 ⇒ 該路徑回應體積趨近歸零。

### ③ 休閒盤面輪詢自適應（500ms → 等待自己輸入時 1000ms）
- 查證結論：自己回合時對手仍可能寫盤面的路徑＝(a) 我方效果把選擇權交給對手（pendingSelection／
  pendingChainQueue）——需要即時；(b) 對手投降／悔棋請求——低頻、晚半秒無感；(c) 心跳／聊天——不走
  盤面 callback 或另有輪詢。⇒ 降頻條件取「有任何 pending 一律不降」（比逐項判 actorIdx 更保守），
  且 setup（雙方並行）/game-over/觀戰/身分未明一律不降。
- `room-oracle.ts` 新純函式 `computeCasualRoomPollMs(bg, spectator, waitingSelfInput)`：
  觀戰 4000/6000、背景 2500、前景 waiting?1000:500——既有檔位全部不變，只新增 1000 檔。
  `subscribeRoom` 加第 4 參數 `isWaitingSelfInput`（缺席/丟例外一律當 false=不降頻，fail-open）。
- `game/+page.svelte` 新 `casualWaitingSelfInput()`，三處 subscribeRoom 呼叫全部接上。
- 檔位取任務允許區間（1000~1500）的下界 1000ms＝最保守的降頻檔。

### 預估減量（尖峰、以休閒對戰為主體）
- ①：不減請求數，減每請求 CPU（壓縮段 ~50-70%）。
- ②：聊天輪詢（1.5s/人）絕大多數時間改回 204 ⇒ 該路徑回應體積 ~-95%，伺服器端由全量查詢+序列化
  改為單筆 findOne ⇒ CPU 亦降。
- ③：對局中約一半時間處於「等待自己輸入」⇒ 盤面輪詢請求數約 -25%（500→1000 只覆蓋該半場）。

### 守衛 `scripts/test-v6216-peak-request-reduction.mjs`（HEAD-FAIL 實證）
- 全部斷言到行為層：抽出 gzip／chat-since 兩個 block 在模擬 Express stack + 模擬 db 上實跑
  （204/next()/fail-open/hoist 位置）；抽出 subscribeMessages／subscribeRoom／
  computeCasualRoomPollMs／casualWaitingSelfInput 以 esbuild 轉譯後實跑（帶 since、204 不
  callback、節奏 1500 不變、檔位 500/1000/2500/4000、pending 時不降頻）。
- 於 BASE（v6.215）實跑確認紅（HEAD-FAIL），修後全綠；各含正對照（舊 client 全量、有新訊息仍
  全量、等對手時仍 500ms）。

### 部署
- 站長需跑：`redeploy-oracle.bat`（server_admin_patch.js）＋ `update-admin-full.bat`（前端）。
  不需 `update-tournament.bat`（未動 engine/effects/server-engine）。
- pm2 log 驗證行：`[rooms] chat since-204 middleware (v1.16) hoisted=true`。

## v6.215 官方序：招式效果先於「受到傷害時」的寶可夢道具效果（幸運頭盔／逆境保險／手持循環扇）

BASE = `7144cbcf89b95d39b536b5e95b87277294fd73cb`（v6.214）。玩家有感（結算順序改變）⇒ 首頁 changelog 放一則。

### 官方依據（`PTCG RULES/PTCG_RULES.md` 逐字）

- **§17.22.A L1530-1531**：
  Q:「若對手的阿柏怪ex對附有寶可夢道具卡『幸運頭盔』的自己的戰鬥寶可夢使出了招式『脅迫獠牙』，
  那麼因寶可夢道具卡『幸運頭盔』的效果從牌庫抽卡，和因招式『脅迫獠牙』的效果將自己的手牌丟棄，何者先執行？」
  A:「先因招式『脅迫獠牙』的效果將自己的手牌丟棄。／之後，因寶可夢道具卡『幸運頭盔』的效果從牌庫抽卡。」
- **§18.D L2916**：「會在招式造成傷害後才執行寶可夢道具卡『幸運頭盔』的效果處理」。
- 同方向的跨個案判例：§17.2.A L606-607（學習裝置：先丟棄能量）、
  §17.2.A L604-605（特性反擊針：先恢復30點HP）、§16.1 L549（先處理發動方的招式效果）。
- ⚠ 官方**沒有**寫成通則條文，上述是跨個案一致的方向；站長 2026-08-22 裁定接受為實作準則。

### 引擎原狀

`engine.ts` ATTACK 主流程行內硬編：KO 分支 `TOOL_ON_KO` → ／ 非 KO 分支 `TOOL_ON_DAMAGED`
→ `SPECIAL_ENERGY_ON_DAMAGED` → 反傷 KO 攻擊方檢查 → 龐克頭盔 → **`ATTACK_POST`（招式效果）**
→ `PASSIVE_RETALIATION` / `PASSIVE_ON_DAMAGED` → `sanityKOSweep`。
⇒ 道具在招式效果**之前**（與官方相反），特性反擊卻在**之後**（符合官方）——引擎自己不一致。

### 這一版做了什麼

新增 `TOOL_FIRE_AFTER_ATTACK_EFFECT`（`effects/cards/tools.ts`）＝**延後觸發名單**：
幸運頭盔／逆境保險／手持循環扇。engine 的 KO 與非 KO **兩個分支**都改成：名單內的道具
不當場跑，改推進 `_deferredToolFires`，等 `ATTACK_POST` ＋ 免疫還原 sweep 跑完之後才統一觸發。

- 幸運頭盔／逆境保險：純抽牌，不碰攻擊方、不開 picker ⇒ 不影響昏厥時序。
- 手持循環扇：會開 picker、會動攻擊方的能量 ⇒ 見下方「自我互換」。
- ⚠ **反傷型（凸凸頭盔／奢華炸彈／豪邁炸彈／龐克頭盔）與火箭隊的催眠裝置刻意不動** ——
  它們牽動昏厥判定／獎賞卡／補位／雙 KO，站長裁定暫緩（原批 3）。

### ⚠ 手持循環扇：目標必須用「攻擊當下的 iid 快照」

`selfSwapPost`（自身與備戰互換）**不是同步互換**，它在 ATTACK_POST 開一個 `do-switch`
picker。延後之後，扇子的 pending 會排在 `do-switch` 之後 ⇒ 玩家**先**解完互換，
此刻 `players[aIdx].active` 已經是換上場的那一隻。原 resolver 讀 `ap.active` ⇒ 打錯人。

修法：
1. `TOOL_ON_DAMAGED` / `TOOL_ON_KO` 的簽名多收一個可選 `attackerIid`；engine 傳攻擊當下的 iid。
2. 新增 `findAttackerInstance(state, aIdx, attackerIid)` —— 先找 active、再找 bench；找不到（已離場）就不發動。
3. step1 的 option id 由**陣列索引**改成**能量 iid**（索引會因招式自丟能量而位移），
   pending `params.attackerIid` 帶著快照；step2 不變。
   保留一條窄相容：只有在 `params.attackerIid === undefined`（＝ v6.214 以前留下的 pending）
   時才用索引解讀。
4. `effects.ts` 的 `fireDefenderOnDamaged` / `fireDefenderOnKO`（狙擊／多目標／延後傷害路徑）
   也一併把攻擊方 iid 傳下去。⚠ **那條路徑不需要延後** —— 它本來就是從 ATTACK_POST 內被呼叫的。

### 實測差異（`scripts/test-v6215-tool-fire-after-attack-effect.mjs`）

| 情境 | v6.214 | v6.215 |
|---|---|---|
| 三首惡龍ex｜粉碎頭（丟對手牌庫頂 3）× 幸運頭盔，牌庫 A~E | 抽 A,B；丟 C,D,E | 丟 A,B,C；抽 D,E |
| 同上但一擊 KO（走 KO 分支） | 抽 A,B | 丟 A,B,C；抽 D,E |
| 酷豹｜拍落（丟對手手牌 1 張）× 逆境保險，對手手牌 0 張 | 抽 3 → 被丟 1 ⇒ 剩 2 | 手牌空丟不到 → 抽 3 ⇒ 剩 3 |
| 蒼炎刃鬼ex｜紫水晶激怒（自丟全部能量）× 手持循環扇 | 先開 picker 搬走 1 顆（等於幫攻擊方保住一顆） | 沒有能量可搬，不開 picker |
| 鍬農炮蟲｜伏特替換（自我互換）× 手持循環扇 | 扇子先解、互換後解 | 互換先解、扇子後解（目標仍是使用招式的那一隻） |

正對照：同一盤面**不帶這些道具**時，牌庫／手牌／棄牌／傷害／pending 全部與 v6.214 相同；
凸凸頭盔（不在名單內）仍在招式效果**之前**反傷 20。

### ⚠ Fable 5 審查抓到的連帶（已修）：排隊中的 picker 候選會過時

`withPending` 排隊的那一筆，其 `params`（候選清單）是**排隊當下**算好的。
v6.214 以前不會遇到，因為道具永遠第一個開 picker；v6.215 把道具排到招式效果之後，
招式自己的 resolver 就有機會在道具的 picker 浮上檯面之前動到同一批資源。

實證（我自己重跑確認）：土地雲｜螺旋關節「選擇1個這隻寶可夢身上附加的能量，放回手牌。」
× 手持循環扇 —— 被放回手牌的那顆仍列在扇子的候選裡，選下去只得到「選擇無效，效果取消」。

修法：新增中央 `PENDING_REFRESH_ON_POP`（`_shared.ts`）——
engine 從 `pendingChainQueue` 取出 picker 前，若該 `effectKey` 有登記 refresher 就重算一次；
回傳 `sel: null` 代表已無對象 ⇒ 整筆丟掉、換下一筆（並補一行取消 log）。
沒登記的 effectKey 走 `if (!_refresh) { _picked = cand; break; }`，行為完全不變
（`test-v6215` L 段是這條分支的正對照）。

### ⚠ opus 審查抓到的假綠（已修）

- `findAttackerInstance` 原本「沒帶快照就退回讀 active」＝ fail-open，呼叫端忘了傳會**測不出來**。
  改成 **fail-closed**（沒快照就不發動）。4 個呼叫端（engine KO/非 KO、`fireDefenderOnDamaged`／
  `fireDefenderOnKO`）現在**各自都有專屬的破壞測試會紅**。舊版留下的 pending 由 resolver／refresher
  端顯式補當下 active（相容路徑寫在呼叫點，不藏在 helper 裡）。
- 原本 refresher 有一條「內容沒變就回傳原物件（省一次換 token）」的短路 —— 實測
  `stampPendingToken` 每次 pop 本來就會重新蓋章，那條短路**沒有任何可觀察效果**（＝測不到的死分支），
  已移除。改為斷言「重算只准動 `params.options`，身分欄位逐欄不變」。
- H 段的正對照原本是對自己造的 Set 做恆真斷言。改成把判準抽成 `judge()` 函式，
  真名單與違規樣本走**同一份**判準；且不再用 `for (const n of set)` 跑斷言
  （export 消失時斷言數會縮水＝分母污染）。
- 順手還債：`cycle-fan-step2-place-energy`（`opp-bench-choose`, minCount 1）原本沒宣告
  `params.validIids`，只靠 v6.176 兜底。補宣告後 `test-v6175` F 段棘輪維持 55。

### 既有守衛的同步更新

`scripts/test-v6211-pending-clobber-and-printing-gap.mjs` 的 A 段原本斷言
「pendingSelection ＝ 手持循環扇、queue ＝ 招式自己的 picker」——那正是舊順序。
已改成新順序（招式 picker 先、扇子排 queue），**要防的東西沒變**：兩個 picker 都要在、
兩邊效果都要真的發生（v6.211 的 bug 是道具 log 印了但 picker 被蓋掉＝假 log）。
第 2 案的 `selectedIids: ['0']` 也改成讀 `params.options[0].id`（現在是能量 iid）。

### ⚠ 已知、本版**不處理**（列給站長）

1. **逆境保險在 KO 分支從來不觸發**：KO 分支跑 `TOOL_ON_KO` 時 `defenderState.active` 早已設為
   `null`（engine.ts KO 分支），而該卡的 fn 第一行就是 `if (!dp.active || !ap.active) return state`。
   延後之後 active 仍是 null ⇒ **行為與 v6.214 完全相同**，本版沒有改動它。
   依 PTCG「受到傷害時」含 KO 情境，這應是既有漏洞，但屬另一個題目。
2. **手持循環扇在自我互換之後，攻擊方的備戰區包含「使用招式的那一隻」**。卡面只寫
   「改附於對手的備戰寶可夢身上」，沒有寫「除這隻以外」⇒ 目前允許選它自己（等於原地不動）。
3. **鍬農炮蟲｜伏特替換**卡面是「將這隻寶可夢與備戰區的【雷】寶可夢互換」，
   實作走通用 `selfSwapPost`，**沒有【雷】屬性過濾**。與本版無關，但掃到了。

## v6.214 ①已結束的舊局不自動採納 ②未進場容許窗縮短（admin 可調）③建局時間改用伺服器時鐘（相容欄位）④診斷取樣率 1% → 10%

BASE = `b0beb26dbfda4653ad3584dcd3d441e53df04852`（v6.213）。①②玩家有感 ⇒ 首頁 changelog 放一則；③④純內部。

### ① 「早就結束的對局會突然跳回去」

真因是 v6.212 的 A-2 已經指出、但當時裁定不動的那一條：
`sync-guards.ts:173` 第 9 步 `return { kind: 'adopt', game: incoming }`，
而它上面**每一條**守衛都寫著 `if (local && …)` ⇒ 本地 `game === null`（大廳畫面／剛重整）時
那些守衛一條都不會執行，房間裡殘留的、早就結束的舊局 snapshot 直接被採納。

**判準（站長要的那條分界）** —— 新增純函式 `isStaleFinishedGame(local, incoming, activeGameId)`，
作用範圍刻意開得很窄，只有兩個條件同時成立才介入：

- **(a) 只在本地沒有局時才管**。本地已經有局 ⇒ 第 4/5/6/9 條一個字都沒改
  ⇒ 「剛結束、玩家還在該局頁面」的終局畫面**不可能**因此消失（那時 local 非 null）。
- **(b) 只擋 `phase === 'game-over'`**。`setup` / `playing` 一律照舊 adopt
  ⇒ 「重新加入進行中的對局」（重整、換裝置、斷線回來）完全不受影響。

剩下唯一會被擋的格子裡還有一個合法情形：**玩家剛在那一局按 F5，想看終局盤**。
用 `ctx.activeGameId` 分辨 —— 那是本裝置寫在 **sessionStorage** 的「我剛剛在看的那一局」：

| 情境 | sessionStorage | 結果 |
|---|---|---|
| 同一分頁按 F5 | 還在（`_seenGameOnce` 為 false 時**不清**） | adopt ⇒ 看得到終局盤 |
| 玩家回大廳（`game` 由非 null 變 null） | 清掉 | reject ⇒ 不會被拉回去 |
| 關掉分頁／新分頁／別台裝置 | 天生沒有 | reject |
| 同一分頁離開再回來超過 5 分鐘 | TTL 過期 | reject |

⚠ `activeGameId` 缺席一律 **fail-closed**（拒收）。拒收的代價是「玩家自己點一次才看得到終局盤」，
採納的代價是「被丟進一局陌生的舊對局」——後者嚴重得多。
⚠ TTL 用的是**同一台裝置自己的** `Date.now()` 差值：v6.198 實證的時鐘偏差是**跨玩家**比較才會出事，
同一顆時鐘算 elapsed 不受影響。
⚠ 接線用 `$effect(() => { _noteActiveGame(game); })` 當**單一接線點** —— `game` 在該檔有數十處賦值，
逐一手動呼叫必定漏接，而漏接的症狀跟原本的 bug 長得一模一樣、查不出來。
⚠ `_forceAdoptNext`（25 秒自癒，刻意繞過 resolveRoomUpdate 的那條）**也問同一個述詞**。
不補這一道，自癒就是另一個「跳回舊局」的入口。

**已知且刻意接受的行為**：同一分頁在 5 分鐘內離開對戰頁再回到同一個房間，仍會看到那一局的終局盤。
以及**觀戰者**進到一個已結束的房間會停在大廳而不是看到終局盤（站長裁定的直接後果，若要放行請裁示）。

### ② 未進場容許窗 5 分鐘 → 3 分鐘（**admin 可調**，預設開啟）

**等待鏈的實際結構**（逐行複驗，BASE 版）：
`enterOpenAt = roundStartedAt + roundCountdownMin(預設 3 分)`；玩家在那之前**按鈕根本不出現**
（`+page.svelte:9117` `{#if _waitMs > 0}` 只畫倒數）⇒ 真正的「可進場容許窗」就是 `noShowMin`（預設 5 分）。
判負在 `server_admin_patch.js:7257` `deadline = roundStartedAt + (cdMin + nsMin) * 60000`，
scheduler tick 30 秒（`:7524`）。

**建議值 3 分鐘的依據**（不是拍腦袋，也不是官方規則）：

1. 站上既有的 `idleForfeitMin` 預設就是 **3 分鐘** —— 那是判「已經在對戰中、輪到你動作卻沒動作」的人。
   未進場者手上的資訊**更明確**：有 Web Push（`⚔️ 第 N 輪可進場`，`requireInteraction`，`:7238`）
   ＋大廳一直在跑的「⏰ 請於 X:XX 內進場，逾時判負離席」。用同一個 3 分鐘是**對稱**的，不比既有標準嚴格。
2. 硬地板 `NOSHOW_FLOOR_MIN = 2`，admin 填 0.5 也不會生效。
3. `Math.min(base, …)` ⇒ **只會縮短、永遠不會拉長**：某場賽事自己把 `noShowMin` 設成 2 分時，全域設定不會把它變回 3。
4. 設定讀不到／值不合法 ⇒ 一律回 base（＝ v6.213 的 5 分鐘）＝**比較寬鬆**的方向，絕不會因為設定壞掉而提早判人輸。

⚠⚠ **顯示端與判定端必須是同一支函式**。`/event` 回給玩家的 `noShowDeadline` 與排程器的 `deadline`
現在都走 `noShowGraceMin(evNoShowMin, tune)`，守衛逐字釘住兩處。
只改一邊的後果就是「畫面說還有 2 分鐘、伺服器已經判你輸」—— 那正是站長最在意的誤判。

⚠ **這一版沒有做「只縮最後一場」**。原本的設計是「本輪只剩 1 場未完成時才縮」，
但那需要 per-round 的未完成場數，而顯示端（`/event`，3 秒快取）與判定端（排程器，即時查）
拿到的數字會有時間差 ⇒ 別場剛結束的瞬間，玩家的倒數會**從 5 分鐘瞬間跳到 3 分鐘、下一秒就被判負**。
⇒ 改成整輪一致的固定值：玩家從輪次開始就知道自己有幾分鐘，數字**永遠不會中途變短**。
（實務上效果一樣：整輪的結束時間由最慢的那一場決定。）

⚠ **不動輪詢頻率**（v6.212 已確認不是元兇）、**不動 `roundCountdownMin`（休息倒數）**、
**不動 `idleForfeitMin`** —— 後兩者本來就是 per-event 設定，請在 admin「賽事設定」裡改。
30 秒的 scheduler tick 也沒動（它是全站排程的心跳，縮短它等於全面提高 DB 負載，換不到 30 秒以上的效益）。

**admin**：`tournamentConfig.noShowTune = { enabled, minutes }`＋
`GET/POST /api/tournament/admin/noshow`＋admin.html「📡 對戰連線監控」新增一塊。
⚠ 與其他灰度旗標不同，**預設是開的** —— 站長裁定要縮短，預設關著等於這一版什麼都沒做。
要退回 v6.213 的 5 分鐘按一下「關閉」即可。

**順手補一個一直缺的東西**：`TMATCH.enteredAt`（進場時刻，**純遙測、不參與任何判定**）。
站上到今天為止只存 `entered` 布林 ⇒ **完全沒有玩家實際進場時間的分佈可以佐證**，
上面那個 3 分鐘只能用既有門檻推論。下一版起就有真實資料可以再調。
守衛有一條專門釘住「未進場判負那一段裡不可以出現 enteredAt」（防止它哪天被拉進判定）。

### ③ 建局時間改用伺服器時鐘 —— **相容欄位**，既有對局零影響

`engine.ts:2386` `createdAt: Date.now()`（全檔唯一寫入處）跑在**建局那一端的瀏覽器**上，
而跨局防舊（`sync-guards.ts:43` 推端、`:102` 收端）拿兩局的 `createdAt` 比大小。
v6.198 實證玩家時鐘偏差有 **-11 秒 / -77 秒 / -4.9 小時** ⇒ 兩局由不同玩家建立時，判斷可能整個反向。

**⚠⚠ 直接把 `createdAt` 換成伺服器時鐘是危險的**：一個時鐘快 4.9 小時的玩家，
手上「舊格式的進行中對局」`createdAt` 在未來 4.9 小時，而新局用修正後的時間 ⇒ 新局反而被判成殘留舊局而拒收
＝ **打斷玩家的對局**。所以本版採**並存欄位**：

- 新增 `GameState.createdAtSrv?: number`（伺服器時鐘估計值）。`createGame` **只在同步得到伺服器時鐘時才寫**，
  沒同步過（本機對戰／vs AI／單元測試／伺服器端 bundle）**整個欄位不寫** —— 「不知道」與「知道」必須分得出來。
- 跨局比較收斂成 `sync-guards.isOlderGame(a, b)`：**兩局都有** `createdAtSrv` 才用它；
  **任一邊缺席就逐字退回原本的 `createdAt` 比較**。
  ⇒ 舊局、混版期間、本機對局走的都是**與 v6.213 逐字相同**的那一條，不可能被打斷。
  ⇒ 刻意**不**做「一邊有一邊沒有就混著比」—— 那等於拿伺服器時鐘去跟偏差 4.9 小時的瀏覽器時鐘比，比原本更錯。
- 偏移量來源：新增 **leaf** 模組 `src/lib/game/server-clock.ts`（除註解外**零 import**，比照 v6.213 的
  stage2-index.ts，杜絕 v6.078 的循環 import／TDZ）。`oracleUpsertRoom` 寫入成功時，
  伺服器蓋的 `room.updatedAt` 必定落在「我送出」與「我收到」之間 ⇒
  `offset ≈ srvMs − (sentAt + recvAt)/2`，誤差上界 RTT/2（幾百毫秒），而要對抗的偏差是 11 秒～4.9 小時，
  差三個數量級以上。只採信 `ok` 分支（`conflict` 回的是別人上一次寫入的時戳，會把偏移量估偏後）、
  RTT > 10 秒的樣本丟棄、非 epoch 值丟棄、**只保留 RTT 最小的那一筆**（平均會被塞車樣本拉歪）。
- 欄位缺席／格式不對 ⇒ `noteServerTime` 自己拒收 ⇒ 從沒同步過 ⇒ 不寫 `createdAtSrv` ⇒ 逐字現況（fail-open）。

**差分實跑**（守衛內）：10 萬組隨機 `{createdAt?, createdAtSrv?}` 組合，只要任一邊缺 `createdAtSrv`，
`isOlderGame` 與手抄的 v6.213 舊式**逐字相同**（0 組不同；且 fuzz 確實涵蓋到 4 萬組「兩邊都有」的樣本）。
真的跑 `createGame`：沒同步過 ⇒ `'createdAtSrv' in state === false`；同步過（注入 +123456ms）⇒
`createdAtSrv − createdAt === 123456`。

**做了幾成**：休閒線上路徑做滿。**錦標賽路徑沒動也不需要動** ——
`server_admin_patch.js:5695/5854` 的 `gs` 是伺服器端 `TENG.createGame` 產生的，
`createdAt` **本來就是伺服器時鐘**，同一場賽事的兩局都來自同一顆時鐘，舊路徑的比較本來就正確。
（代價是錦標賽的局不會有 `createdAtSrv` ⇒ 一律走舊路徑 ⇒ 行為零變更。）

### ④ 診斷取樣率 1% → 10%

`+page.svelte` `PERF_SAMPLE_RATE = 0.01` → `0.1`。**自行複算的總量**（守衛會把三種情境印出來）：

| 每週賽事數 | 取樣筆數/週 | 比 1% 多 | 佔既有 993 筆 | 7 天常駐量（最壞：每列都塞滿 8192 字元） |
|---|---|---|---|---|
| 2 | 30 | +27 | +2.7% | 8.0 MB |
| 5 | 75 | +68 | +6.8% | 8.3 MB |
| 10 | 150 | +135 | +13.6% | 8.9 MB |

- 母數 993 筆/週是 v6.184 的實測值；每場賽事約 150 場對戰、每場對戰最多 1 發（v6.213）。
- **8192 是「每一列的字元上限」，不是列數上限** ⇒ 調高取樣率在結構上不可能「撐爆 8192」。
  v6.184 已實測 payload 結構上界約 4.1KB，上表的 MB 數是把每列都當成塞滿 8KB 的最壞情況。
- **不會擠掉真異常**：取樣走 `_isExempt`（不佔每頁 3 發的異常配額），而伺服器節流的 key 是
  **per-(uid, reason)**（`server_admin_patch.js` `_thKey = uid + '|' + reason`，v6.160 起）
  ⇒ `perf-sample` 有自己的 60 秒桶，不可能把別的指紋擋掉。反向也成立。
- 取樣要累積 20 發成功往返（≈24 秒以上）才送，且每場對戰只擲一次骰 ⇒ 同一玩家兩發之間必定隔著一整場對戰。

### ⚠⚠ 兩輪審查抓到的問題（這一段留著，它是本輪最有價值的產出）

#### Fable：②的 helper 放進了**錯誤的作用域** —— v0.94 / v1.01 事故的第三次重演

第一版把 `NOSHOW_FLOOR_MIN` 與 `noShowGraceMin` 放在 `buildCasualCleanFilter` 旁邊，
我以為那是「最外層」。用 acorn 實際解析才發現：那裡是
`import('firebase-admin').then(async (…) => {…})` 這個 **箭頭函式 callback**（字元範圍 24875–147533），
而兩個呼叫端都在錦標賽的 `(async () => {…})()` 內（163356–442073）—— **兄弟作用域，互相看不見**。

線上會發生什麼（逐條追過 try/catch）：

- `/api/tournament/event`（每人每 3 秒的最高頻端點）在「有 running 賽事且我本輪有未完成對戰」時
  丟 ReferenceError → 被 handler 最外層 catch → **回 500** ⇒ 開賽期間所有有對戰的玩家大廳整個壞掉。
- 排程器 tick 在同一行丟例外 → 被 per-event catch 吃掉 ⇒ **那一行之後整段跳過**：
  未進場判負、閒置判負、60 秒警告、對局時限、輪次推進全失效 ⇒ **整場賽事卡死**。

⚠⚠ **既有防線全部漏接**：`node --check` 只驗語法；`npx tsc` 不掃這支 server JS；
本版守衛是用 `new Function(抽出的函式文字)` 執行的，**完全繞過原始作用域**（84 條全綠）；
`test-admin-helper-scope.mjs` 只認得**具名** IIFE `(function name(){…})()`，
箭頭函式 callback 與匿名 async IIFE 它都看不到。

⇒ 修法：把兩個符號搬進錦標賽 IIFE；並在 `test-admin-helper-scope.mjs` 新增一條
**通用 acorn 作用域檢查**：凡「全檔只宣告一次、且名字沒當過任何參數／catch 變數」的 helper，
其宣告處的函式鏈必須是**每一個使用處**函式鏈的前綴。
BASE 與 HEAD 實測都是 **0 違規**（可判定的 helper 162 個 / 函式節點 560 個），
把 helper 搬回錯誤位置則精準報出兩處使用點（破壞測試 M36）。
⚠ 這條測試**刻意寫成同步的**：`T()` 是 `fn()` 不是 `await fn()`，寫成 async 的話
assert 失敗會變成未處理的 rejection、照樣印 PASS ＝ 又一個假綠。所以用 `createRequire` 同步載入 acorn。

#### opus（專審「守衛有沒有假綠」）：抓到 **6 個假綠**，全部修掉

1. **③ 的 10 萬組差分把「兩局都有 `createdAtSrv`」那條分支 `continue` 跳過** ⇒
   把 `a < b` 改成 `a <= b` 兩套守衛全綠。而 `<=` 是真 bug（守衛自己的註解寫「採較新／**同齡局**」，
   `<=` 會把同齡局判成舊局而 reject）。⇒ 該分支改成與手抄的伺服器時鐘式做差分，並補「相等 ⇒ false」的手挑斷言。
2. **③ 的 `isFinite` / `typeof === 'number'` 型別守門是零覆蓋死碼** ——
   fuzz 只餵正整數，把兩道守門拿掉、或放寬成 `a != null && b != null`（字串會走字典序，`"9" < "10"` 為 false）
   都全綠。而 `createdAtSrv` 是**從房間過網回來的外部資料**，髒值正是它們存在的理由。
   ⇒ 輸入分佈補上 `NaN / Infinity / '123' / null / true / {} / 負數 / 0`，另加一批手挑斷言。
3. **② 的「判定段不可出現 enteredAt」是恆真的空跑** ——
   `SRV.slice(indexOf(A), indexOf(B))` 在錨點註解被改名時 `indexOf` 回 -1，
   `slice(-1, …)` 長度為 0，`!/enteredAt/.test('')` 恆真。實測「錨點改名 ＋ 判定段塞進 `enteredAt`」全綠。
   ⇒ 先斷言兩個錨點都找得到、順序正確、切出來的段落夠長。
4. **① 的 force-adopt「正對照」只驗字串** —— 把述詞改寫成 `(true || isStaleFinishedGame(…))`
   （＝自癒路徑永遠放行）照樣命中 regex。⇒ 改成用括號配對抽出**整個 `if` 條件式**、注入真的
   `isStaleFinishedGame` **實際執行**，驗四種輸入的回傳值。
5. **② 的兩個消費端只有文字比對、零行為斷言** —— 保留原字面不動、後面**再加一行覆寫**
   `myMatch.noShowDeadline = …舊式…` 就全綠，而那正是這兩條宣稱要防的事。
   ⇒ 補「該區塊內 `noShowDeadline` 只出現一次」「排程器那段 `deadline` 只被賦值一次」
   （**先去註解再數** —— 註解裡提到不算用到），並把兩端的算式各自抽出來跑 27 組輸入證明結果相同。
6. **④ 的「7 天常駐量 < 20 MB」是 placebo** —— 實測把 RATE 開到 **1.0**（每場都送）也只有 19.5 MB，
   那條在任何 RATE 下都不會紅。⇒ 降級成計算輸出，改釘住「取樣率落在站長裁定的 0 < RATE ≤ 0.2」；
   同節近乎恆真的 `/_cdiagPack/ && /truncated/` 改成把 `_cdiagPack` 真本抽出來跑
   （短 payload 不切且 `truncated:false`／超長 payload 切到 ≤ 8192 字元且 `truncated:true`、`rawLen` 保留原長）。

另外修掉一個**守衛會崩掉而不是變紅**的問題（型態③）：`grabFn` 是天真的大括號計數，
函式裡放一個含 `}` 的字串就會抽出不合法的 JS ⇒ `new Function` SyntaxError ⇒
腳本從第 3 節中止、後面約 40 條沒跑、也不印 `SCRIPT-END`。
⇒ `grabFn` 改成會跳過字串／範本字串／行註解／區塊註解；所有 `new Function` 一律包 `safeFn`，
抽壞就變**紅**（並附錯誤訊息），絕不讓腳本崩掉。

⚠ 一開始想用「把新守衛丟到整棵 BASE 樹上跑」當 HEAD-FAIL 證明，但新模組在 BASE 不存在
⇒ esbuild 直接 build 失敗 ⇒ 同樣是「崩掉」不是「變紅」，證明不了任何事。改成**逐項破壞**。

### 守衛

`scripts/test-v6214-stale-finished-and-server-clock.mjs`（111 條）：
①的純函式路由 ＋ **三條正對照**（重新加入進行中／終局畫面不消失／重整看終局盤）
＋ 把 `_readActiveGameId` / `_noteActiveGame` 的**真碼**抽出來跑（sessionStorage stub、TTL 邊界、
壞資料、無痕模式 throw）；②把 `noShowGraceMin` 的**真碼**抽出來跑 ＋ 10 萬組差分（關閉時等於舊式）
＋ 反證（開啟時結果**確實不同**，證明差分不是恆真式）＋ 兩個消費端逐字釘住；
③server-clock 行為 ＋ `isOlderGame` 10 萬組差分 ＋ 真的跑 `createGame`；④取樣率 ＋ 總量複算。
`scripts/test-online-sync-guards.mjs` 63 → **71** 條（①③的路由進入正式的同步守衛網）。
`scripts/test-v6213-perf-sample-and-srv-timing.mjs` 契約更新：機率常數 0.01 → 0.1，
自我驗證與中籤率的門檻改成由 `RATE` 算出的 ±5σ（不再寫死數字，下次再調不用手改）。

`scripts/test-admin-helper-scope.mjs` 8 → **9** 條（新增通用 acorn 作用域檢查）。

**破壞測試：37 項全部如預期變紅、0 項逃脫**（腳本印 `=== MUTATION-SCRIPT-END ===`；
第一輪 28 項 ＋ 依 opus 審查補的 9 項）。
其中 6 項是**正對照**方向的破壞（把①的作用範圍放寬到「本地有局也擋」／「非 playing 都擋」
⇒ 終局畫面與重新加入的斷言必須紅；把 `isOlderGame` 改成「一邊有就混著比」⇒ 相容路徑差分必須紅；
把 `createdAtSrv` 改成無條件寫 ⇒ 舊局格式的正對照必須紅）。
補的 9 項全部是**「字面還在、行為沒了」**這一類：`<` 改 `<=`、型別守門拿掉、註解錨點改名、
述詞短路成永遠放行、顯示端事後覆寫、函式裡塞含 `}` 的字串、helper 搬回錯誤作用域、取樣率偷開到 1.0。
另外修掉一個**守衛自己會崩**的問題：把 `_readActiveGameId` 的 try/catch 拿掉之後，
抽出來的真碼直接往上炸 ⇒ 腳本崩掉而不是變紅。已加 `safe()` 包裝。

### 部署

⚠⚠ **`update-admin-full.bat` 這一版一定要跑**：②整段（含 `/event` 與排程器）都在
`oracle-admin/server_admin_patch.js` 裡，不重新部署的話 admin 端點不存在、判定窗也不會縮短。
改到 `oracle-admin/server_admin_patch.js` ＋ `oracle-admin/admin.html` ⇒ 需 `update-admin-full.bat`；
`src/lib/game/*`（含 engine.ts 新 import）有改 ⇒ 一併跑 `redeploy-oracle.bat` 與 `update-tournament.bat`。

### 待站長裁定

1. **②只省了 2 分鐘**（8 分 → 6 分）。另一半是 `roundCountdownMin`（休息倒數，預設 3 分），
   它是 per-event 設定、隨時可改，但它是玩家的休息時間，要不要一起縮請站長決定。
2. **①觀戰者**進到一個已結束的房間現在會停在大廳而不是看到終局盤。要不要對觀戰者放行？
3. **③錦標賽路徑沒有 `createdAtSrv`**（不需要，見上）。若哪天錦標賽改成 client 建局，要記得補。
4. `enteredAt` 累積一兩場賽事之後，可以用真實分佈回頭檢查 3 分鐘是不是太緊（或還可以更短）。

## v6.213 ① isStage2 全卡池線性掃描 → per-pool 索引 ② 低頻無條件取樣（健康對照組） ③ 伺服器 per-request 處理時間 ④ 手機版牌組編輯器橫向溢出與 iOS 聚焦縮放

BASE = `efd6979202da62748d4fb24154ebb8c16001dbd1`（v6.212）。①②③純內部；④玩家有感 ⇒ 首頁 changelog 放一則。

### ① `isStage2` 全卡池線性掃描 → 記憶化（純效能，行為零變更）

真因：三份逐字相同的實作，每呼叫一次就對**整個卡池（4935 張）線性掃描**，
迴圈內每張卡再跑一次名稱正規化（v3001 那份連迴圈不變量 `a` 都每輪重算）：

- `src/lib/game/effects/cards/v3001_g3_wave3.ts:355` `isStage2`（海兔獸｜黏著束縛的特性消除閘）
  —— 站長實測 **634.6 µs/call、1.42 次/action、佔 engine+AI 總時間 52.7%**。
- `src/lib/game/engine.ts:1043` `isStage2PokemonCard`（同型）
- `src/lib/game/effects/cards/draw_supporters.ts:26` `isStage2PokemonCardLocal`（同型，鳴依的勉勵）

修法：新增 **leaf** 模組 `src/lib/game/stage2-index.ts`（除 `import type` 外零 import
⇒ 不可能參與循環 import，避開 v6.078 的 TDZ 坑），提供 per-pool 索引：

- 快取鍵 ＝ **pool 物件本身**（`WeakMap<Map<string,Card>, Stage2Index>`）
  ⇒ 錦標賽 bundle 的全卡池與對戰頁按牌組載的子集各有各的索引，**不可能互相污染**；
  pool 被回收時索引一起走。
- 同一個 Map 被塞進新卡（`ensurePoolForStateIds`）⇒ 索引記下建立當下的 `pool.size`，
  對不上就整份重建（自癒）。
- **兩種語義刻意不合併**：`isStage2ByEvoVariant` ＝ `sameEvoName` 語義（會 strip「超級」前綴），
  `isStage2ByPlainEx` ＝ v3001 那份「只 strip 尾綴 ex + trim」的簡化版。
  合併就是行為變更 —— 要不要統一是站長裁定，不是效能改動該做的事。
- 順手收斂：`sameEvoName()` 內的 local `normalize` 搬進 stage2-index 成為單一來源
  （`normalizeEvoVariantName`）—— 索引與 sameEvoName 必須用逐字相同的正規化。
  `sameEvoName(a,b)` ⇔ `normalize(a)===normalize(b)`（`a===b` 那條捷徑蘊含於此），判定結果一字未變。

實測（`scripts/test-v6213-stage2-index-memo.mjs` 的微基準，1000 次呼叫）：
**286.9 µs/call → 0.190 µs/call，約 1500 倍**。
差分：全卡池 **4935 張逐張**比對新舊實作，兩種語義都**逐字相同**；
另比對 sameEvoName 本身（卡名 × evolvesFrom 共 10 萬組以上）也逐字相同。

⚠ 守衛用**手寫的舊碼副本**當對照組（不是 import 新碼再跟自己比 —— 那是恆真式），
並且用「最小 pool」正對照證明那兩份副本的判準**真的不同**。
另有 `__stage2IndexBuildCount()`：同一個 pool 連問 500 次只重建 1 次（證明記憶化不是 placebo），
每換一份新 pool 就 +1（證明計數器不是死的）。

### ② 低頻無條件取樣 —— 把健康對照組放回遙測

站長指出的副作用：**v6.198 收緊 stale-version 判準之後，網路正常的人不送任何回報**
⇒ `tournamentClientDiag` 的母體只剩病人，「往後有沒有變慢」原則上答不出來。

做法（一律沿用既有 `/clientdiag` 管線與既有節流，**不另開端點**）：

- `+page.svelte`：`PERF_SAMPLE_RATE = 0.01`、`PERF_SAMPLE_MIN_CALLS = 20`。
  骰子**以房號當鍵**（`_perfSampleRoom !== tActiveRoom` 才重擲）⇒ 每場對戰只擲一次；
  中籤者在累積 20 發成功往返後送**一發** `reason='perf-sample'`。
  ⚠ 擲骰寫在 `_tRecordSrvSample()` 內而不是 `tEnterMatch`：擲骰與「只算對戰熱路徑」的條件
  在同一個地方，不會有「某條進場路徑忘了擲」的漏接。
  ⚠ 已知可接受偏差：同一場中途重整頁面會再擲一次（期望值 1% ×（1＋重整次數））。
- 取樣**不佔**每頁 3 發的異常配額（`_isExempt`）—— 用對照組把真異常指紋擠靜音，
  會比「沒有對照組」更糟。
- 涵蓋範圍：**只有錦標賽對戰者**。整套 perf 量測（`_tRecordApiSegments`）本來就只掛在這條路徑，
  休閒／本機沒有 tApi 也沒有四段拆分，硬接等於另開一套。

⚠⚠ **分帳（站長特別交代的那一點）**：取樣是健康樣本，混進任何既有統計都會讓那個統計失真
（byReason／合計筆數／RTT 分佈／最慢的玩家／版本與平台分佈／截斷率，分母全部被稀釋）。
所以三個消費端都**從查詢層就分開**：

- `oracle-admin/server_admin_patch.js`：`SAMPLE_REASONS = ['perf-sample']` ＋ `isSampleReason()`；
  `byReason` 濾掉取樣、`rows`（最近 120 筆明細）預設 `$nin` 取樣、取樣走**獨立**的 aggregate 與查詢，
  回應新增 `sample: { reasons, n, players, perf, note }`。
- `oracle-admin/tournament/dump-client-monitor.cjs`：新增 `splitDiagRows()` 當**單一分流出口**，
  main() 第一步就把 `rawAll` 切成 `raw`（異常）／`rawSample`；既有每一個統計只吃 `raw`
  ⇒ **語義與 v6.212 逐字相同、可以跟舊 dump 對帳**。取樣走獨立的 `sampleSummary()`，
  TXT 摘要新增【②-d】區塊並明講「兩批永遠不可以相加」「取樣 0 筆不等於大家都很順」。
- `oracle-admin/admin.html`：新增 `monSampleBlock()`，**獨立**一塊、獨立一張表；
  有異常與零異常兩條路徑都會畫（零異常時最需要對照組）。

⚠ **產能誠實話**：1% × 一場賽事約 150 場對戰 ＝ **每場賽事只會拿到 ~1.5 筆**。
要看趨勢得累積好幾場，或把 `PERF_SAMPLE_RATE` 調高（見下方「待站長裁定」）。

### ③ 伺服器端 per-request 處理時間

`perf.api.net`（送出 → 第一個位元組）把「Cloudflare／隧道／線路慢」與「Node 處理慢」綁死。

- `server_admin_patch.js`：`app.use('/api/tournament', _srvTimingMw)`，
  在 `res.writeHead` 被呼叫時（**不是** `res.on('finish')` —— 那時 header 早就寫死了）
  設回應標頭 `X-Srv-Ms`。整段 try/catch、先檢查 `headersSent`。
  ⚠ 註冊位置在本 IIFE 所有 `/api/tournament` 路由**之前**（v1.11 gzip 掛在 stack 尾端
  永遠輪不到的事故）；守衛用字元位置比對釘住。
  ⚠ **只加量測**：整支中介層沒有 `await`、沒有 DB、沒有任何 `res.json/send/status`。
  負擔實測 **0.8 µs/req**（守衛內 20 萬次；50 人對戰約 42 req/s）。
- `+page.svelte`：`tApi` 讀 `res.headers.get('X-Srv-Ms')`（同源，不需要
  `Access-Control-Expose-Headers`），交給**新的**函式 `_tRecordSrvSample()`。
  ⚠ 刻意不寫進 `_tRecordApiSegments` —— 那支有 v6.159 的行為契約在逐字驗它。
  ⚠ 兩支的三行範圍守衛**必須逐字相同**（守衛會比對文字）：母體不同的話 `net - srv` 沒有意義。
- payload 新增 `perf.srv`（`_sampleStats`）與 `perf.srvHdr: { n, miss }`。
  ⚠ 「舊伺服器沒帶標頭」與「帶了但是 0 ms」必須分得出來：前者是**不知道**、後者是**真的很快**。
  admin 對前者顯示「未部署」而不是 0 ms。

### ④ 手機版牌組編輯器：橫向滑動 ＋ iOS 聚焦縮放

**(A) 左右滑動 ＝ CSS Grid blowout。** `src/routes/decks/+page.svelte`
`.layout` 桌機那行早就是 `minmax(0, 1fr)`，但 `@media (max-width: 900px)` 的手機那行只有 `1fr`
（＝`minmax(auto, 1fr)`，最小值是內容的 min-content）。

Chromium 實測（把 `<style>` 與真實 DOM 結構搬進 headless 量測，320/360/375/390/412/1440）：

| 視窗寬 | v6.212 scrollWidth | v6.213 |
|---|---|---|
| 320 | **401**（溢出 +81） | 320 |
| 360 | **401**（+41） | 360 |
| 375 | **401**（+26） | 375 |
| 390 | **401**（+11） | 390 |
| 412 | 412（OK） | 412 |
| 1440 | 1440 | 1440（字級也逐項相同） |

⇒ **412px 以上的機型看不出來**，這就是「有時可以左右滑動」的來源。
min-content 歸因（360px 下實測）：`.picker` 385px ← `.pk-search-row` **351px**
（`.pk-search` 197 ＋ `.pk-mode-select` 148 ＋ gap），而可用寬度只有 296px。
修法比照 /cards（v6.044 的 `repeat(N, minmax(0,1fr))`）：軌道改 `minmax(0, 1fr)`、
搜尋列 `flex-wrap: wrap`、輸入框 `min-width: 0`、卡包下拉 `max-width: 100%`。
修完 `.pk-search-row` 的 min-content 降到 221px。

**(B) 比例放大 ＝ iOS 對 font-size < 16px 的表單控制項在聚焦時自動放大整個畫面。**
牌組編輯器 7 個可聚焦控制項全部 < 16px（`.pk-search` 0.88rem、`.pk-mode-select` 0.78rem、
`.pk-set-select` 0.82rem、`.deck-title` 手機 1rem、`.text-area` 0.85rem、`.bm-code` 0.72rem、
`.auth-form input` 0.95rem）。
⚠ `app.html` 早就有 `user-scalable=no, maximum-scale=1`，但 iOS 10 之後 Safari 不保證遵守，
且那兩個值本身有無障礙代價 ⇒ **不依賴、也不加碼**（viewport 一個字都沒動）。
⇒ 只在 `@media (max-width: 600px)` 把那 7 個控制項的字級提到 **16px**（用 `px` 不用 `rem`：
門檻是瀏覽器寫死的 16 CSS px，使用者調小根字級時 `1rem` 會靜默失效）。
⚠ 新區塊放在樣式最尾端 —— 同權重後者勝，放前面會被 `.pk-search`（:2743）等舊規則蓋掉而**靜默失效**；
守衛有一條專門釘位置順序。

**正對照（不可影響桌機）**：本版對 /decks 的改動**全部在 @media 內**
⇒ 把所有 @media 整段拿掉之後的 CSS 不含任何本版新增的宣告（守衛逐條比對），
Chromium 1440px 實測 scrollWidth 與四個控制項的 computed font-size 與 v6.212 完全相同。

### 第二輪審查（opus 專審「守衛有沒有假綠」）抓到的三個假綠，已全部修掉

⚠ 這一段留著，因為它是本輪最有價值的產出：**三支新守衛第一版全綠，但其中兩條是假綠**。

1. **④ 的「桌機逐字未動」正對照根本抓不到桌機改動**。原本只寫了四條
   「桌機區不得出現本版新增宣告」的否定式 —— 實測把 `.picker` 改成
   `background:#ff0000; width:3000px;`，守衛照樣 43 PASS / 0 FAIL。
   ⇒ 改成 **sha256 指紋鎖**：`6ac52437ce962826`（bare.length = 25315）。
   這個值是在 **v6.212 上算出來的**，v6.213 算出來一模一樣 —— 這才是逐字證明。
   實測改一個顏色（`#fff` → `#fefefe`）就會紅。
2. **① 的結構掃描把迴圈變數寫死成 `const c`、而且只掃 3 個檔**。
   實測把 v3001 的 `isStage2` 還原成線性掃描、變數名改成 `zz`、import 留著 ⇒ 全綠。
   ⇒ 改成掃 `src/lib/game/**` ＋ `src/routes/**`、變數名放寬成 `\w+`。
   **這一改當場又掃出 4 份沒收斂的**（effects.ts ×3、v3070 ×1）——
   也就是說第一版不只守衛假綠，收斂本身也沒做完。
   ⚠ 一開始用「整檔豁免 effects.ts」（因為它另有三處**鏈結推導**的迴圈），
   但破壞測試立刻證明整檔豁免太粗：把 effects.ts 的神奇糖果改回線性掃描仍然全綠。
   ⇒ 改成**用 pattern 分辨**（2 階判定會 `return true`；鏈結推導是 `basicName = …; break;`），
   豁免表因此可以清空。
3. **① 的差分／微基準比的全是中央 helper，真正的消費端零覆蓋**。
   v3001 的 `isStage2` 是 module-private，把它改回線性掃描不會有任何一條斷言紅。
   ⇒ 新增第 7 節：把 `isAbilityNullifiedBySticky`（海兔獸｜黏著束縛的閘）真的 import 進來跑，
   驗行為（2 階被消除／1 階不被消除）＋ 驗它**真的吃到記憶化**（2000 次呼叫索引重建 0 次、3.8ms）。

另外幾個【弱】也一併修掉：
- 機率實測原本是「守衛自己寫一個 LCG 擲 20 萬次」＝ `0.01 === 0.01` 的 placebo。
  改成把 `_tRecordSrvSample` 裡**真正那一段擲骰程式碼**抽出來跑 20 萬「場」（每場換房號）。
  ⚠ 第一次改完量到 1.18% —— 那是 LCG **低位元週期短**，不是程式碼的問題；
  換成 xorshift32 取全 32 位元後是 0.985%，並補一條「亂數來源本身要均勻」的自我驗證。
- tApi 讀 `X-Srv-Ms` 原本只有字串斷言（而 v6.172 的測試又把 `_tRecordSrvSample` stub 掉了）
  ⇒ 全站沒有任何一條在驗這條線。新增行為端：抽那 6 行真碼跑，驗
  有值／缺席／垃圾字串／負數／`"0"`／沒有 headers 六種輸入。
- `_pushSample` 原本是**手抄**進 harness 的（漂移點）⇒ 改成 `grabFn` 抽真本。
- 「沒有另開端點」的否定式改成 **tApi 端點字面量白名單**（換個名字就繞過的問題）。
- `test-v6184` 的 `SRC.slice(i, i+N)` 魔術數字切窗改成**大括號配對**取端點本體，
  並加一條自我驗證「沒有多切到下一支端點」。

### 守衛

- `scripts/test-v6213-stage2-index-memo.mjs`（27 條）—— 三種語義的全卡池差分、跨 pool 不污染、
  size 自癒、非 placebo 的重建計數、微基準、全站結構掃描、**消費端實跑**。
- `scripts/test-v6213-perf-sample-and-srv-timing.mjs`（97 條）—— 真碼機率實測 20 萬場、行為端把
  client 取樣函式／tApi 讀標頭／伺服器中介層／dump 分帳函式／admin 區塊**全部實跑**。
- `scripts/test-v6213-mobile-deck-editor.mjs`（46 條）—— CSS 解析器自我驗證、桌機 sha256 指紋鎖。

破壞測試：**28 項全部如預期變紅、0 項逃脫**（腳本會印 `=== MUTATION-SCRIPT-END ===`）。
其中 8 項是第二輪審查之後針對新守衛補的（改桌機一個顏色／之後加小斷點覆寫字級／
effects.ts 改回線性掃描／v3070 改回線性掃描／exactName 偷加 supertype 檢查／
消費端繞過索引／tApi 讀了標頭卻不傳／偷開新端點）。

既有守衛的**契約更新**（都是「真的多了東西」，不是放寬）：
`test-v6159` / `test-v6179` 的 `CELLS` 13 → 14（admin 表新增「伺服器」欄，並補三條新欄位的行為斷言）；
`test-v6184` 的端點切窗由魔術數字 4200 改成**大括號配對**取端點本體（＋自我驗證沒多切）；
`test-v6203` 的 `sameEvoName` 呼叫點下限 8 → 3（**真的少了五個**，另補 7a-2 釘住「那五處必須已改走中央索引、
且 effects.ts 剛好 3 處」）；
`test-v6210` 的「超級」前綴豁免表把 `_shared.ts` 換成 `stage2-index.ts`（normalize 搬家，豁免仍是 3 處）；
`test-v6172` 的 tApi 測試 PRELUDE 補 `_tRecordSrvSample` stub。

### 待站長裁定

1. **取樣機率**：1% 依站長指示實作，但一場賽事只會產生 ~1.5 筆。若要能看趨勢，
   建議把 `PERF_SAMPLE_RATE` 調到 0.1（一場約 15 筆；7 天總量從 ~993 筆增加約 3%，負擔可忽略）。
2. **viewport 的 `user-scalable=no, maximum-scale=1`**：本版沒動它。它從 iOS 10 起就不保證被遵守、
   對無障礙也有代價，是否整個拿掉（影響全站含 /game）請站長裁示。
3. `/cards` 的搜尋框（`input[type=search]` 0.95rem）與模式下拉（0.85rem）也 < 16px，
   同樣會在 iOS 聚焦時放大 —— 本版**沒有**動它（站長只交辦牌組編輯器）。
4. `effects.ts` 還有**三處**「由 Stage1 名字回推 Basic 名字」的全卡池線性掃描（神奇糖果的鏈結推導，
   `effects.ts:1927 / 1953 / 1989`）。那**不是** 2 階判定、語義不同，本版刻意沒動；
   要不要一起做成索引（例如 name → card 的反查表）請站長裁示。
5. 三種 2 階比對規則（`sameEvoName` 語義／只 strip 尾綴 ex／逐字相等且不看 supertype）
   是原碼就存在的差異，本版原封保留。要不要統一成一種是**規則問題**，請站長裁定。

## v6.212 自癒方向反過來（本地領先先重推、不回捲）＋ 輪詢版本閘單調 ＋ 賽程 game-over 對帳

BASE = `cae142da479aa539f45cac0b347571fcbae3078b`（v6.211）。玩家有感 ⇒ 首頁 changelog 放一則。

### A. 休閒線上「回合都結束了，過一下子又跳回攻擊前」

真因鏈（每一段都複驗過行號，BASE 版）：

1. `src/routes/game/+page.svelte:6552-6555` —— `pushGameState` 失敗只 `console.error`，
   **完全不重試**。伺服器因此停在攻擊前那份盤面，而本地已經前進。
2. 本地領先 ⇒ `isWaitingOnOpponent()`（同檔 `:7456`）判成「在等對手」⇒ log 不再增長
   ⇒ `_lastSyncAt` 不再更新。
3. 同檔 `:7527`：`if ((Date.now() - _lastSyncAt) >= 25000) _forceAdoptNext = true;`
   —— **無條件**設定強制採納旗標。
4. 同檔 `:7685-7694`：`_forceAdoptNext` 為真時**直接 `game = incoming; return;`**，
   `resolveRoomUpdate` 的每一條 stale 守衛都被跳過 ⇒ 攻擊前的盤面覆蓋現況＝回捲。

v5.587 當年的註解寫「只在『正等對手』時走到這（上方已 gate），**我方沒有未推送的手**，
故不會丟手」。這個前提在 push 失敗／在途時**不成立**，而 (1) 保證了它一定會發生。
時間量級 25~33 秒，與玩家「過一下子」的描述吻合。

修法（三項）：

- `sync-guards.ts` 新增純函式 `decideStuckSelfHeal({hasUnpushedLocal, repushAttempts, maxRepushAttempts=2})`。
  本地領先且未達上限 ⇒ `repush`；否則 `force-adopt`。
  ⚠ 上限是必要的：本地領先也可能是伺服器**合法**拒收（對手已用別的路徑推進），
  無限重推＝永遠不同步。達上限交還給 force-adopt。
- `+page.svelte` 新增 `pushWithRetry()`：3 次、400/800ms backoff；三次都失敗才把那份盤面
  記進 `_unpushedState`（＝本地領先的證據）。成功一次就清空。換局（`gid !== _prevGameId`）
  也清空，避免上一局殘留讓新局誤判。
- 25 秒自癒改成先問 `decideStuckSelfHeal`，`repush` 分支**不設** `_forceAdoptNext`。

### A-2（本輪**不動**，待站長裁定）

`sync-guards.ts:173-174` 第 9 步 `return { kind: 'adopt', game: incoming }`，
而它上面每一條守衛都寫著 `if (local && ...)` ⇒ **本地 `game === null` 時全部跳過、無條件 adopt**。
症狀是「早就結束的舊局被採納」。要不要擋牽涉「重新加入想看終局盤」vs「防跳回」的取捨，
本輪維持現狀。

### A-3 `createdAt` 時鐘偏差假說 —— **成立**（但這一版沒有動它）

`engine.ts:2383` `createdAt: Date.now()`，全檔只有這一處寫入，且 `createGame` 是在
**建局那一端的瀏覽器**跑的 ⇒ `createdAt` 用的是該玩家的本機時鐘。
跨局守衛（`sync-guards.ts:102` 與 `:43`）拿兩局的 `createdAt` 比大小來決定誰新誰舊。
v6.198 已實證線上玩家時鐘有 -11 秒 / -77 秒 / -4.9 小時的偏差 ⇒ 兩局由**不同玩家**建立時
（再來一局的建局者可能換人），比較結果可能反向 ⇒ 舊局騙過守衛、或新局被誤擋。
⚠ 這一版刻意不改：要改就得換成伺服器單一時鐘（房間 `_version` 或伺服器 `createdAt`），
牽涉推/收兩端與 `shouldSkipStalePush`，風險大於本輪範圍。列入待辦。

### A-4 輪詢版本閘（`oracle-client.ts`）

BASE `:257` 是 `if (room._version !== lastVersion)` —— **不等於**就遞送，
所以比較舊的 `_version` 照樣會被交給 `handleRoomUpdate`。平常有 stale 守衛擋著，
但 `_forceAdoptNext` 這條路徑是刻意繞過守衛的 ⇒ 兩者疊在一起就是回捲。
改成單調 `shouldDeliverRoomPoll()`：同一個房間實體只收嚴格較新的版本。
⚠ 房號可被刪後重建（建房寫死 `_version: 1`，見 `server_admin_patch.js:433`），
只比大小會讓重建後的房間永遠被擋 ⇒ 先用 `createdAt` 認房間實體，不同實體一律遞送並重設基準。

### B. 賽程：獲勝後仍出現「回到對戰」、新一輪等很久

- `server_admin_patch.js:3914`：`onMatchGameOver` 包在 try/catch 裡，**拋錯只 warn 就吞掉**
  （edge-triggered）。一旦拋錯，`TMATCH` 永遠停在 `status:'playing'`。
- `:4275` `/event` 的 myMatch 用 `status: { $ne: 'done' }` 濾 ⇒ 那筆卡住的 match 一直被回傳
  ⇒ 前端 `:8915` 只看 `tMyMatch.entered` ⇒ 一直畫「⚔️ 回到對戰」。
- 同時 `checkRoundAdvance` 要本輪全部 done 才排下一輪 ⇒「新一輪等很久」。
- `:7226` 的閒置掃描對 `phase==='game-over'` 的房間是 `continue`，也不會處理它。

修法（level-triggered 對帳，比照 v6.157）：在閒置掃描既有的輕量讀上多帶一個
`'gameState.phase': 1`（純讀、不寫回，符合 v6.119 的注意事項），
房間 `game-over` 而對戰仍 `playing` ⇒ 讀完整 doc 後**補跑 `onMatchGameOver`**
（它本身對 `m.status==='done'` 冪等）。無勝方（平手／系統死角）不自作主張，只 warn 一次。

前端保險：`tMatchAlreadyDone(brk, mm)` —— 賽程表上該場已標 `status==='done'` 就不畫進場鈕。
⚠ 只在賽程表確實載到時才隱藏；`:8999` 那個「賽程沒載到就頂層獨立渲染」的保底**一字未動**
（v5.937 的教訓：進場鈕消失會直接吃未進場判負）。

### B-2 「新賽程等很久」的真因不是輪詢頻率

有 `tMyMatch` 時輪詢仍是 3 秒（`+page.svelte:6053`），差異偵測會立即 resume。
真因是設計上的等待鏈：最後一場若無人進場要等 `noShowMin`（預設 5 分、v6.156 情境可到 8 分）
＋ 30 秒 scheduler tick，之後還有 `roundCountdownMin`（預設 3 分）休息倒數。
⇒ **本輪不動輪詢頻率、也不動 no-show 窗**（屬產品決策，請站長裁定）。

### 部署

改到 `oracle-admin/server_admin_patch.js` ⇒ 需 `update-admin-full.bat`；
未動 engine/卡效果，但 `src/lib/game/*` 有改 ⇒ 一併跑 `redeploy-oracle.bat` 與 `update-tournament.bat`。

## v6.211 「hook 內直接覆寫 pendingSelection」＝假 log（青草命令蓋掉手持循環扇）＋ SV-P 四張特典卡漏收招式

BASE = `2255c590a25216366b87a74b0ac99798a03cddf5`（v6.210）。玩家有感 ⇒ 首頁 changelog 放一則。

### ① 玩家回報：君主蛇ex｜青草命令 不會觸發手持循環扇的丟能量 picker（log 有、效果沒發生）

卡面逐字（`static/cards` 台灣官方）：
- 君主蛇ex｜青草命令 `attacks[0]`：cost `[Grass,Colorless,Colorless,Colorless]`、damage `150`、
  effect「若希望，從自己的牌庫任意選擇最多3張卡加入手牌。並且重洗牌庫。」（SV11B 12945/13764/13772、MC 16513，I 標）
- 手持循環扇 `rulesText`（Trainer/PokemonTool，SV6 10509，H 標）：
  「附有這張卡的寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，選擇1個使用招式的寶可夢身上附加的能量，改附於對手的備戰寶可夢身上。」

**真因**：`engine.ts:6305` 的 `TOOL_ON_DAMAGED` 在傷害結算當下就 `withPending(...)` 開好 picker；
`engine.ts:6485` 的 `ATTACK_POST` 比它晚跑。而
`src/lib/game/effects/cards/v2590_i_wave9_misc3.ts:384`（BASE 版）寫的是
`return { ...s, pendingSelection: {…} }` —— **直接覆寫**，繞過 `withPending` 的 `pendingChainQueue`。
⇒ 手持循環扇的 log 已印出、picker 被蓋掉、效果從未發生。

**同族**：`v2490_i_wave3a_conditional.ts:117`（BASE 版）的 `snipeOneBenchPost` 是同樣寫法，
5 張卡共用：巨石丁｜岩石踢、長耳兔｜魯莽踢、雪暴馬｜冰之射擊、赫普的蒼響ex｜剎那斬、波皇子｜瞄準俯衝。
行為端實測 赫普的蒼響ex｜剎那斬 一樣把手持循環扇的 picker 蓋掉。

**修法**：兩處改走 `withPending`（共 6 張卡）。`_shared.ts` 的 `withPending` 上方補完整說明。

**掃描結果**：`src/lib/game/effects/**` 直接覆寫只剩 `_shared.ts` 的 `addPendingPrize`
（它自帶 `!state.pendingSelection` 前置閘，是刻意的 v5.889 行為）。
`engine.ts` 有 18 處，全部落在 `handlePlaying` 開頭那道
「已有 pendingSelection 就只收 `RESOLVE_SELECTION`」的全域閘之後（`enforceBenchLimit` 另有自帶閘），
結構上安全 ⇒ 守衛改成「處數凍結在 18 ＋ 全域閘必須還在」。

### ⚠⚠ 待站長裁定：道具「受到傷害時」與招式效果的先後順序（本版**沒有**改）

`PTCG RULES/PTCG_RULES.md` L1530-1531 §17.22.A 逐字：
> **Q**: 若對手的阿柏怪ex對附有寶可夢道具卡「幸運頭盔」的自己的戰鬥寶可夢使出了招式「脅迫獠牙」，
> 那麼因寶可夢道具卡「幸運頭盔」的效果從牌庫抽卡，和因招式「脅迫獠牙」的效果將自己的手牌丟棄，何者先執行？
> **A**: 先因招式「脅迫獠牙」的效果將自己的手牌丟棄。／之後，因寶可夢道具卡「幸運頭盔」的效果從牌庫抽卡。

L2916 另證：「會在招式造成傷害後才執行寶可夢道具卡『幸運頭盔』的效果處理」。
⇒ 官方順序是 **招式效果 → 道具效果**；站內是 **道具 → 招式**（v4.933 起的既有行為，非本版引入）。
差異看得到（例：青草命令會搜牌庫並重洗，幸運頭盔先抽/後抽會抽到不同卡）。
要真的修正必須動 engine 的 hook 順序，且 凸凸頭盔 反傷可能 KO 攻擊方 ⇒ 不能單純搬到 KO 結算之後。
**不要**只把 ATTACK_POST 的 pending 插到隊首 —— 那會讓「有 picker」與「沒 picker」的效果走兩種順序。

### ② 玩家回報：猛雷鼓ex 只能用第一招 —— 真因是**卡片資料漏收**，不是手機端判定

`static/cards/SV-P-H.json` 連號四張（scraper 同一批壞掉），除 `attacks` 外每個欄位都與正常印刷逐字相同：

| promo | 原本 | 補齊後 | 對照來源 |
|---|---|---|---|
| 10100 鐵頭殼ex 078/SV-P | **0 招** | 雙刃劍 | MC 16832 |
| 10101 故勒頓 079/SV-P | 撕裂 | 原生亂打、撕裂 | MC 17021 |
| 10102 密勒頓 080/SV-P | 暴衝高點 | 暴衝高點、閃雷攻擊 | MC 17023 |
| 10103 猛雷鼓ex 081/SV-P | 濺射咆哮 | 濺射咆哮、**極降駕** | MC 17025 |

【極降駕】cost 逐字 = `["Lightning","Fighting"]`、damage `70×`、
effect「將自己的場上寶可夢身上附加的任意數量的基本能量卡丟棄，造成其張數×70點傷害。」

⚠ 順帶：故勒頓 10101 補回的「原生亂打」插在 `attackIndex 0`，把「撕裂」推到 1。
`attackIndex` 是位置性的，但回放存的是盤面快照＋finalLog（不存 action），線上也只有出招方算完整包推送 ⇒ 無影響。

### ③ 「手機端與引擎判定不一致」維度：本輪掃出 **0 處**

`MobilePortraitBattle.svelte` 與 `+page.svelte` 五個「能不能做這個動作」全部同源（都讀 engine/中央述詞）：
招式 `getAvailableAttacks`（mobile:307 / desktop:2969）、撤退 `canRetreat`（mobile:285 / desktop:3042）、
特性 `getUsableAbilities`（mobile:287）、出牌 `getHandCardOps`（v6.201 收斂，mobile:293）、
進化 `getEvolvableTargets`（mobile:286）。攻擊宣告的 `initiateAttack` 也是 desktop 那一份直接傳給 mobile
（`+page.svelte:9964 onInitiateAttack={initiateAttack}`），`ATTACK_PRE_DISCARD_CHOICE` 的三個 modal
都在 `{#if isPortraitMobile}…{:else}…{/if}`（9942–10870）**之外**，兩種版面共用。
唯一小差異：desktop 的 derived 有 `poolReady` 前綴、mobile 沒有（pool 未載完時 mobile 招式全灰，不會誤放行）。

### ④ 守衛 `scripts/test-v6211-pending-clobber-and-printing-gap.mjs`（15 條）

A 行為端（青草命令／剎那斬 + 手持循環扇，斷言到盤面真的變了）、B 正對照（無道具時行為不變）、
C 靜態接線（effects/** 禁字面量 ＋ engine 18 處凍結 ＋ 全域閘 ＋ 三條正對照 ＋ 掃描器下限）、
D 卡庫重印完整性（含人工弄壞一張卡的正對照）。
HEAD-FAIL 逐項證明：只還原 v2590 → 3 紅；只還原 v2490 → 2 紅；只還原 SV-P-H.json → 2 紅。


### ③（本輪追加）大蔥鴨｜臨場背負 選的道具不會附上

卡面逐字：大蔥鴨（SV6 083/101 · id 10497 · H）`abilities[0].effect`
「在自己的回合，從手牌將這張卡放置於備戰區時，可使用1次。從自己的牌庫選擇1張「寶可夢道具」卡，附於這隻寶可夢身上。並且重洗牌庫。」

**真因**：`v2998_g2.ts` 的 `regR('farfetchd-on-spot-tool-attach')` 再驗證寫
`toolCard?.subtype !== 'Tool'`。`'Tool'` 是 **picker 的 filter key**
（`selection-filter.ts:118` `'Tool': (c)=> c.supertype==='Trainer' && c.subtype==='PokemonTool'`），
卡庫實際的 `subtype` 值只有 `Basic/Item/PokemonTool/Special/Stadium/Stage1/Stage2/Supporter/ex`
⇒ 這條判斷**恆為真** ⇒ 100% 走「所選非寶可夢道具，跳過並重洗」，道具永遠附不上、還留在牌庫。
（＝ v6.109「filter 顯示什麼必須 === 能勾什麼」的 resolver 版。）

**修法**：picker 的 `filter` 與 resolver 的再驗證共用同一個常數 `FARFETCHD_TOOL_FILTER`，
再驗證改呼叫中央 `evaluateSelectionFilter('deck-search', FARFETCHD_TOOL_FILTER, toolInst, toolCard)`。
全站掃描（`.subtype/.supertype` 比對的字面量必須是卡庫真的存在的值）確認**只有這一處**。
`'Other'`(8)/`'Pokémon'`(2)/`'None'`(1) 都在排除路徑（恆假只會更寬鬆），列 legacy 白名單。

### 第二支守衛 `scripts/test-v6211-selected-but-no-effect.mjs`（17 條）

§1 臨場背負完整三段行為（附「不選」與「送非道具」兩個正對照）；
§2 subtype/supertype 字面量掃描（下限 ≥880、正對照 ×2，其中一個專門測 URL `https://` 不被誤砍）；
§3 **行為端** clobber 掃描：每個 ATTACK_POST 餵一個既有 pending，跑完必須還在
（下限①「零例外、零非 state、scanned ≥1100」、下限②「真的會開 picker 的 ≥300」＝真分母、正對照 ×1）；
§4 桌機／手機六個動作判定同源（版面檔用 glob 取並凍結為 2 個；正對照 ×3 分別打
「本地重寫」「改從本地檔 import」「只在字串裡出現」三條分支）。
HEAD-FAIL：還原 `v2998_g2` → §1+§2 紅；還原 `v2590`+`v2490` → §3 紅。

### 子代理審查抓到、我已查證並處理的

1. **Fable**：`SNIPE_ONE_BENCH` 註冊 5 個 key，但 `巨石丁|岩石踢`／`長耳兔|魯莽踢`／`雪暴馬|冰之射擊`
   被 `v2640_i_wave14_misc7.ts` 的中央 `snipeOneOppBenchPost` 重新註冊（`effects.ts` import 730 > 717，
   `regPost` 是 `Map.set` 覆寫）⇒ v2490 那 3 條是死碼，真正走這裡的只有 剎那斬 與 瞄準俯衝。
   我用行為端 clobber 掃描獨立驗證（只列出這 2 個 + 青草命令）⇒ **原註解「五張一次收斂」不實，已改**。
2. **Fable**：波皇子｜瞄準俯衝 damage 為空（0），`TOOL_ON_DAMAGED` gate 是 `baseDamage > 0`
   ⇒ 它與手持循環扇本來就不會同幀開 pending。改掉仍正確（防其他 pending 來源），但別誇大戰果。
3. **opus**：舊版掃描器的 `scanned` 是**分母污染** —— 1185 個 ATTACK_POST 裡只有約 328 個
   在測試盤面上真的會開 picker，其餘 857 個是恆真通過。新守衛改量 `openers` 並下限 ≥300。
4. **opus**：`try{}catch{continue}` 與 `!('players' in st)` 是靜默豁免（今天都是 0）⇒ 改成收集並斷言為 0。
5. **opus**：`stripComments` 的 `([^:])` 讓「檔案第一個字元就是 `//`」的那行砍不掉 ⇒ 改 `(^|[^:])/gm`，
   並補一條 URL 正對照防止反向誤砍。
6. **opus**：正對照要寫暫存檔會在 repo 留垃圾（`walkSrc` 自己會跳過點開頭檔名，連自己都偵測不到）
   ⇒ 掃描器改吃 `[名稱, 原始碼]` 字串陣列，**零檔案 I/O**。
7. **opus**：UI 同源守衛的檔案清單寫死 ⇒ 改 glob `src/routes/game/*.svelte` 並凍結為 2 個；
   `imported` 改成只在「來自 `$lib/game/engine` / `$lib/game/hand-card-ops` 的 import 區塊」內比對
   （原本掃全檔，字串字面量就能騙過）。
8. **opus**：clobber 掃描的獎賞卡改設 `faceUp: true`（取獎 picker 只有在有正面朝上的獎賞時才開，
   不設等於整條 `addPendingPrize` 路徑幾乎掃不到）。

### ⚠⚠ 要請站長裁定的兩件事

**(a) 促銷卡回填**：`static/cards/SV-P-H.json` 的 10100/10101/10102/10103 是用**同一張卡的正規印刷版**
逐字補上招式的。台灣官方促銷頁（`.../detail/10103/` 等）的 `skillInformation` 區塊自己就少了那些招式，
而四張與正規版在 name/hp/stage/evolvesFrom/illustrator/retreatCost/weakness/resistance/tags 全部逐字相同。
Fable 另外抓了官方卡圖 `card-img/tw00010100~10103.png` 目視確認四張實印都有那些招式。
若站長不同意「用他版補官方頁殘缺」，這 4 張的 JSON 改動可單獨回退。

**(b) 招式效果 vs 道具「受到傷害時」效果的先後**：`PTCG RULES/PTCG_RULES.md` L1530-1531 §17.22.A 逐字：
「先因招式『脅迫獠牙』的效果將自己的手牌丟棄。／之後，因寶可夢道具卡『幸運頭盔』的效果從牌庫抽卡。」
（L2916 另證。）⇒ 官方是**招式效果先、道具後**；但 engine 的 hook 順序是 `TOOL_ON_DAMAGED` 先、
`ATTACK_POST` 後，排隊出來剛好相反。這是 v4.933 起的既有行為，本版只是把漏網的卡納入同一條隊伍
（本批 6 張兩效果互不相干，順序不影響結果）。要真正修正得動 engine hook 順序（凸凸頭盔反傷可能 KO
攻擊方 ⇒ 不能單純搬到 KO 結算之後），風險不小，**這一版不動，等裁定**。

## v6.210 藏隱／深度下潛接特性消除中央閘 ＋「基本能量屬性」「Mega ex」兩族卡名判斷整批收斂

BASE = `665af67543a3930acbe70e24ab4fd0c4b55cf19b`（v6.209）。
玩家幾乎無感（純收斂＋防脆化）⇒ 首頁 changelog **不放**。
⚠ 唯一的行為改變是 ③ 的 AI bug（AI 端，非規則判定）。

### ① 斯魔茶｜藏隱 ／ 小霞的鯉魚王｜深度下潛 —— 比照 v6.209 岩石宮殿收尾

卡面（`abilities[].effect` 逐字）：「只要這隻寶可夢在備戰區，不會受到對手的寶可夢招式的傷害與效果的影響。」
持有者 6 個現役印刷：斯魔茶 SV5a 10255/10701、SV8a 11542/12332（H，Grass/Basic/hp30）；
小霞的鯉魚王 MC 16628、SV9a 12683（I，Water/Basic/hp30，tags=['訓練家冠名']）
⇒ 兩張都是**非規則的【基礎】寶可夢**，卡面把持有者鎖在備戰區。

**七種消除來源逐一行為端實跑**（完整 `ATTACK` → `RESOLVE_SELECTION`，每項附正對照）：

| 來源 | 打得到？ | 理由 |
|---|---|---|
| 鐵荊棘ex｜初始化 | ❌ | 只消「擁有規則的寶可夢」 |
| 火箭隊的監視塔 | ❌ | 只消【無】（或 `fossilOnField`）；這兩張是【草】/【水】 |
| 傳說的熔岩洞 | ❌ | 只消**進化**；兩張 `stage='Basic'` |
| 招式版暗夜羽擊 | ❌ | 中央閘限 `location==='active'`；持有者恆在備戰 |
| passive 振翼髮｜暗夜羽擊 | ❌ | 同上，限對手戰鬥場 |
| 海兔獸｜黏著束縛 | ❌ | 只消備戰的【2階進化】 |
| **可達鴨／哥達鴨｜濕氣（第七種）** | ❌ | 卡面只消「**將自己【昏厥】的效果的特性**」，ability-scoped、走 `isSelfKOEffectBlocked` 獨立那條；藏隱／深度下潛不是那一類 |

⇒ 事實判斷成立，但「不可達」是依賴其他卡條件的脆弱不變式 ⇒ **仍接上中央閘**
（`isAbilityHolderEffective(..., 'bench', ...)`），今天是保證的 no-op。

修法：`v3060_deferred_wave_b.ts` 的 `getBenchImmunityAbilityName` 改成
`(state, ownerIdx, targetInst, targetCard, pool)` 並在特性名字面量旁邊過閘；
只回 boolean 的 `hasBenchAttackImmunityAbility` 因此**零呼叫端 ⇒ 整支刪除**（v6.098/6.099 死入口教訓），
`anti-pattern-lint` Check O 白名單同步縮一格。兩個消費點
（`effects.ts` `resolveBenchGuard` L598／`hitBenchAll` L1304）都改問同一份判準。
定論與七項查證結果寫進該函式上方註解；**test-v6202 的兩條豁免表條目已刪除**。

**差分實跑：0 行為變更** —— 守衛在 HEAD 樹上 84 PASS，在新樹上 99 PASS，
差的 15 條全部落在「絆線（B 段）＋ 新簽名（E 段）」，A/C/D 段（真卡 × 七來源 × 三條消費路徑）
兩邊逐條相同。
守衛 `scripts/test-v6210-bench-immunity-ability-nullify-gate.mjs`（99 斷言，HEAD 紅 15，其中絆線 8 條）：
A 段七來源 × {snipe(resolveBenchGuard) / benchAll(hitBenchAll) / counter(attack-effect)} ×
兩張卡 ＋ 每組**反安慰劑**（同盤面無免疫的對照組必須照樣挨打）；
B 段用合成持有者（斯魔茶改成【無】／2 階／規則寶可夢）反向證明那行閘真的會擋；
C 段同樣合成持有者但不放來源 → 必須仍免疫；E 段釘住 6 個印刷都被同一份判準涵蓋。

### ② 「基本能量屬性」49 處逐字複本 → 中央 `isBasicEnergyOfType`

現役 68 張基本能量的 `pokemonType` **恆 `undefined`**，屬性只能從卡名【X】推（v6.008 事故），
所以全站散著 `supertype==='Energy' && subtype==='Basic' && name.includes('【X】')` 這個三段式。
本版把它**全部**換成中央述詞（`selection-filter.ts`）：

| 檔 | 處數 |
|---|---|
| `selection-filter.ts`（中央檔內部自己的複本） | 9 |
| `engine.ts` | 12 |
| `effects.ts` | 6 |
| `ai.ts` | 8 |
| 卡檔（items_misc 4／slowking 2／v2650 2／v3050 2／v2660 2／v2930 2／v169／v2306／v2380／v3000 各 1） | 19 |
| `src/routes/game/+page.svelte`（含**本地重複定義**的 `isBasicEnergyOfType` ＋ 自帶 `ZH_BY_TYPE`／`zhMap`） | 14＋1 |

**不換（逐處判讀）**：
- `m2_dragon_charizard_batch.ts:40`／`m5_preview.ts:257` `providesFireEnergy`、
  `v2660:235` `_isLightningEnergy` —— **沒有** `subtype==='Basic'` 護欄，語義是「這張能量提不提供【火】/【雷】」
  （含燃料【火】能量等特殊能量），與 `isBasicEnergyOfType` **不同問題**。
- `ai.ts:1326/1361-1373`（計算場上附加能量的屬性分佈）—— 同樣沒有 Basic 護欄，涵蓋特殊能量。
- `ai.ts:202`（AI 附能時偏好同屬性）—— 那行的 `【${targetType}】` 也是英文型別名（與 ③ 同型的 latent bug），
  但它只影響 AI 偏好、不影響規則，改了**會**變 AI 行為 ⇒ 本版不動，列進待辦。
- `v158_energy_chain.ts` 的「卡名 → 屬性」對照 ＋ `+page.svelte`/`MobilePortraitBattle.svelte`
  能量計數用的 `zhMap` —— 那是中央 `getBasicEnergyType` 的複本，屬**第三族**，不在本輪授權內。

**差分實跑：0 mismatch** —— 把被換掉的歷史表達式凍結成 lambda，與中央述詞在**全現役 4,935 張卡**
逐張比對，98,700 個比對點 0 mismatch（`isBasicEnergyOfType` 的 `ZH_ENERGY_TYPE` 同時收「鬥」與「格」，
比舊碼寬，但現役沒有任何「基本【格】能量」印刷 ⇒ 外延相同）。

### ③ ⚠ 收斂過程順帶抓到一個**真 bug**（AI 端）：`ai.ts` 的 `Energy:<T>` 牌庫搜尋永遠選 0 張

```
if (f.startsWith('Energy:')) {  // ← HEAD
  if (card.supertype !== 'Energy' || card.subtype !== 'Basic') return false;
  const t = f.slice(7);                       // t = 'Fire' / 'Psychic' …（英文）
  return card.pokemonType === t || card.name.includes(`【${t}】`);   // 「【Fire】」永遠對不上
}
```
基本能量 `pokemonType` 恆 null ⇒ 前半永遠 false；卡名是「基本【火】能量」⇒ 後半拼出「【Fire】」也永遠 false。
`Energy:<T>` 在 **deck-search** 這一區**沒有**被中央 evaluator 收錄（`evaluateSelectionFilter` 回 `null` 走 inline）
⇒ 這條是**活的**，不是死碼。全站有 18+ 張卡用 `filter: 'Energy:<T>'` 牌庫搜尋。
**行為端實測**（`getAIAction`，牌庫放 2 張基本【火】能量）：HEAD 回 `selectedIids: []`，修後回 `['i1']`。
UI（`+page.svelte`）早就用 `isBasicEnergyOfType` ⇒ 這是典型的 UI/AI 漂移（同 v6.008／v6.129 家族）。
⇒ 本版一併修（改呼叫中央述詞）。**這是本版唯一的行為改變**，且只影響 AI 的候選挑選。

### ④ 「`startsWith('超級')` 判 Mega ex」24 處 → 中央 `isMegaExCard`

`isMegaExCard`（`selection-filter.ts:59`）＝ `supertype 是 Pokemon && subtype==='ex' && name.startsWith('超級')`。
現役有「超級信號」(Item)、「超級烈空坐帽子」(PokemonTool) ⇒ 單看前綴會誤判；
HEAD 各站點都另配了 `subtype==='ex'` 或 `endsWith('ex')` 擋住 ⇒ 今天沒 bug，但是七種不同寫法的漂移溫床。
換掉的 24 處：`engine.ts` 7（含 `prizesForKO`）／`effects.ts` 3（含 `koPrizeCount`、`prizesForKOLocal`）／
`ai.ts` 2／卡檔 9（tools 2／mega_decks 2／v2995 2／v172 2／m2 1／pokemon_search 1）／svelte 3
（對戰頁 MegaEx filter、卡庫頁與牌組頁的「超級進化」tag filter）。

**不換**：`selection-filter.ts:62`（中央定義本身）、`cards/evolutionChain.ts:22` 與
`effects/_shared.ts:984`（那兩處是把「超級」前綴**切掉**求同源卡名 `slice(2)`，不是在問「是不是 Mega ex」）。

**差分實跑：0 mismatch** —— 七種歷史寫法（`endsWith('ex')`／`endsWith('EX')`／`includes('ex')`／
`/ex|ＥＸ/i`／`subtype==='ex'` 各種組合）與 `isMegaExCard` 在全卡池雙向比對全部相等；
`endsWith('ex') ⟺ subtype==='ex'` 也仍是雙向零錯配（v6.209 的觀察在 v6.210 仍成立）⇒ 本輪順手一併吃掉。

### ⑤ 枚舉守衛（防這一族復發）

`scripts/test-v6210-central-card-predicate-convergence.mjs`（47 斷言，**HEAD 紅 6 條**：B1/B2/C1/C2/C4/D1）：
- **A 段等價鎖**：把被換掉的 20 條歷史表達式凍結，與中央述詞在全卡池逐張比對（≥60,000 比對點）——
  中央述詞日後若漂走（例如有人拿掉卡名 fallback）**這裡先紅**，而不是等玩家回報。
- **B 段禁複本掃描**（否定型）：`src/lib` ＋ `src/routes` 所有 `.ts`/`.svelte`，
  ①「Energy＋Basic＋`name.includes('【X】')`」一律 0；②`startsWith('超級')` 只准出現在 3 個豁免檔（附理由，且**不得有死條目**）。
  ⚠ 配 7 條**掃描器自我驗證**：單行違規／跨行（先 `!==` 早退再 includes）違規／合規寫法不得誤報／
  剝註解／剝零寬字元（v6.117 事故）／`超級` 違規樣本／`超級` 合規樣本。
- **C 段消費端覆蓋**：`isBasicEnergyOfType` 呼叫點 ≥45（實測 106）、`isMegaExCard` ≥22（實測 31）——
  沒有這段，「把中央述詞全部改回手刻」會讓 B 段**照樣全綠**（去中央化零偵測）。
- **D 段行為端接線**：AI 的 `Energy:Fire` 牌庫搜尋必須真的選到那張基本【火】能量（③ 的回歸鎖），
  配 `BasicEnergy:Fire` 正對照與 `Energy:Water`（牌庫沒有）反安慰劑。

### ⑥ 兩輪 opus 自我審查抓到的事（**都已修進本版**）

**第一輪（審正確性）**
- 🔴 `scripts/test-v6207-onfield-effective-type-consumers.mjs` 的 8b 凍結清單過期（`npm test` 會紅）——
  ② 把「豐收漁網 validIids 的基本【水】能量」收斂掉之後，那一行從清單消失。已刪該條目（清單過期，不是新技術債）。
- 🟡 ② 的收斂**不完整**：全站另有 **44 處同語義的「正則形」**（`/【X】/.test(name)`），
  `.includes('【X】')` 的判準看不到它們。本輪授權範圍只到 v6.209 列的 `.includes` 那一族，
  且其中至少 `ai.ts` 波動突刺那處**沒有** Basic 護欄（語義是「這張能量提不提供【鬥】」，不能一律換）
  ⇒ 逐處判讀留待下一輪，本版在守衛加 **B4c 棘輪**（正則形數量只准降不准升，凍結 44）＋
  **B4b 下限斷言**（掃得到 ≥30，掃到 0＝棘輪是死的）＋ **B12 正對照**。
  ⚠ 沒有這條，B1 就是一個有系統性假陰性的安慰劑。
- 🟢 逐 hunk 覆核 21 個檔、①的 ownerIdx／fail-open／七來源卡面、`Check O` leaf 純度
  （`selection-filter` 單獨 bundle = 856 bytes / 2 modules，卡庫頁不會被拖進引擎）、
  `test-ts2304-scan` 兩樹皆 0 —— 均無問題。

**第二輪（專審守衛假綠，含 12 項破壞測試逐項還原）**
- 🔴 **`hitBenchAll` 那個消費點是零覆蓋**：把 v6.210 新加的 inline 閘整段刪掉，守衛仍 99 PASS。
  真因 —— 測試用的雷吉艾斯｜暴風雪走 `v2750 allOppBenchAddDamagePost → dealAttackDamageToTarget
  → resolveBenchGuard`，**根本不經 hitBenchAll**；而真走 hitBenchAll 的電飛鼠｜天空波，
  刪掉那段後行為也 **0 差異** —— 因為同一輪迴圈約 30 行後的 v6.141
  `resolveMultiTargetDamageGuard(…isBench:true…)` 會走同一條 `resolveBenchGuard` 擋掉同一件事。
  ⇒ 那段是**行為上不可觀測**的縱深防禦。處置：**不假裝有兩個消費點** ——
  （a）測試檔頭與路徑標籤改成誠實版；（b）`effects.ts` 該段補「誠實標註」註解說明它被遮蔽、
  以及為什麼仍要保留（兩份判準不得漂移，日後有人調順序時未過閘的那份會變成生效版）；
  （c）新增 **F 段靜態接線斷言**（必須仍呼叫 `getBenchImmunityAbilityName` 且**五個參數**全傳），
  配 F4/F5 正對照。破壞驗證：整段刪除 → F2/F3 紅；改回 `(card)` 單參數無閘版 → F3 紅。
- 🟡 `prev.count` 是**死表達式**：`pendingSelection` 沒有 `count` 欄位
  （實際欄位 type/actorIdx/sourcePlayerIdx/minCount/maxCount/effectKey/params/token）⇒ 已改讀 `minCount`。
  （所幸不是假綠：resolver 會再開第二個 picker，2 個指示物仍有放滿，對照組實測 20。）
- 🟡 `C1/C2` 門檻太鬆（45/22 vs 實測 106/31）⇒ 改成**棘輪** ≥100 / ≥30
  （破壞測試 D6/D9 把呼叫點打掉時，舊門檻照樣綠）。
- 🟡 `C3` 是安慰劑（掃整個檔）⇒ 改成只看 `isBasicEnergyOfType` **函式本體**，並加 C3b 正對照。
  破壞驗證：拿掉卡名 fallback → 由 17 紅變 18 紅（C3 也紅了）。
- 🟢 已證實有效的絆線（破壞 → 紅幾條）：拿掉中央閘那行 → 守衛1 紅 8；改 `if (false && …)` → 紅 8；
  `resolveBenchGuard` 消費點改 fail-open → 紅 8；拿掉中央述詞卡名 fallback → 守衛2 紅 18；
  月光丘陵改回手刻 → B1 紅；`isMegaExCard` 拿掉 subtype → A 段紅 7；
  `ai.ts` `Energy:` 改回 HEAD → 紅 2；UI 去中央化 → C4 紅；`stripComments` 改成 `s=>s` → B8 紅；
  `runPath` 恆回 0 → 守衛1 紅 24（反安慰劑組擋住）；對 `test-v6202` 做同樣破壞 → 20d 紅並指名該檔。
  破壞腳本全程未崩潰／未無限迴圈，跑完印出 `DESTRUCT_ALL_DONE`，`diff -rq` 與 baseline 逐行相同。

### 部署提醒
卡效果／引擎有改（`effects.ts` / `engine.ts` / 多個卡檔）⇒ **請站長跑 `update-tournament.bat`**，
另外兩支 bat 照舊流程。

## v6.209 化石採掘場改走中央述詞 ＋ 岩石宮殿特性消除閘定論（結束 v6.202/v6.208 判讀衝突）

BASE = `997eebf3b6517f879bbcaffe9975c54743b8af4e`（v6.208）。
兩件都是**防脆化 ＋ 註記**，玩家幾乎無感 ⇒ 首頁 changelog 不放。

### ① 化石採掘場：「能不能放上備戰」的 double-check 改用 `isFossilItemCard`

`m5_preview.ts` 的 `regR('m5-fossil-excavation')` 原本用
`card.supertype==='Trainer' && card.subtype==='Item' && card.name.includes('陳舊的')`
判斷選中的卡「是不是化石」，然後直接轉成 `fossilOnField` 的備戰實例。

⚠ 這裡有**兩層語義不同**的條件，本版刻意只改第二層：

| 層 | 位置 | 判準 | 本版 |
|---|---|---|---|
| picker 候選 | `engine.ts` `filter:'NameContains:陳舊的'` | **卡面逐字**（M5 19223 rulesText：「選擇最多2張**名稱中有「陳舊的」的物品卡**」） | **不動** |
| 放置前 double-check | `m5_preview.ts` resolver | 「可作為 HP60【無】【基礎】寶可夢放置於場上」＝化石 | **改 `isFossilItemCard`** |

`isFossilItemCard`（`engine.ts:925`）＝ `supertype==='Trainer' && subtype==='Item' &&
FOSSIL_ITEM_NAMES.has(name)`，白名單 7 張（陳舊的 根狀／背蓋／羽毛／顎之／鰭之／頭蓋／盾甲 化石）。
全站的 `PLAY_FOSSIL`（`engine.ts:3448`）、手牌操作（`hand-card-ops.ts:203`）本來就走它，
本版讓化石採掘場加入同一份判準 —— 新化石只要登錄一次 `FOSSIL_ITEM_NAMES` 就三處同時生效。

**差分實跑：現有 7 張化石行為 0 mismatch**（放上備戰／`fossilOnField=true`／牌庫 −1／
無「不符合條件」log，換判準前後逐張比對一致）。
守衛 `scripts/test-fossil-excavation-central-predicate.mjs`（42 斷言，HEAD 紅 4 條）：
合成一張「陳舊的地圖」（名字含「陳舊的」的普通物品卡）→ 舊碼會把它變成非法的 HP60 備戰幽靈，
新碼拒絕；並附**絆線**：凡現役 H/I/J 中名稱含「陳舊的」的 Item 都必須被 `isFossilItemCard`
認得，出新化石卻忘了登錄 → 這條變紅。

### ② 岩石宮殿：**定論 = 六種消除來源今天確實都打不到，但仍接上中央閘**

v6.202 判「結構上不可達 ⇒ 刻意不加閘」，v6.208 又把它列為舊帳 —— 兩輪相反。本版重新查證：

持有者 **大吾的小碎鑽**（`static/cards/SVOD.json` id 12583，I 標）：
`supertype=Pokemon` / `stage=subtype='Basic'` / `pokemonType='Psychic'` / hp 80 /
`tags=['訓練家冠名']` ⇒ **非規則寶可夢**；卡面「只要這隻寶可夢**在備戰區**」⇒ location 恆 `'bench'`。

六種來源**行為端逐一實跑**（完整 `ATTACK`，量測「備戰有無小碎鑽」的傷害差，每項附**正對照**
證明該來源在同一盤面確實會消除它打得到的卡）：

| 來源 | 條件 | 打得到？ | 正對照 |
|---|---|---|---|
| 鐵荊棘ex｜初始化 | 只消「擁有規則的寶可夢」 | ❌ | 超級甲賀忍蛙ex 被消 |
| 火箭隊的監視塔 | 只消【無】（或 `fossilOnField`） | ❌ | 探探鼠（Colorless）被消 |
| 傳說的熔岩洞 | 只消**進化** | ❌ | 大竺葵（Stage2）被消 |
| 招式版暗夜羽擊 | 中央閘限 `location==='active'` | ❌ | active 帶旗標者被消 |
| passive 振翼髮｜暗夜羽擊 | 限對手**戰鬥場** | ❌ | 探探鼠（active）被消 |
| 海兔獸｜黏著束縛 | 只消備戰的【2階進化】 | ❌ | 大竺葵被消 |

⇒ **v6.202 的事實判斷是對的**。但「不可達」是一條依賴其他六張卡條件的**脆弱不變式**，
中央閘則是**自我維護**的 ⇒ 本版仍接上 `isAbilityHolderEffective(..., 'bench', ...)`
（沿用既有那份，與同檔的 捲牆／守護之鐘／齒輪塗層／盾之守護 一致），今天是**保證的 no-op**。
定論與六項查證結果**寫進 `v2999_g3_wave1.ts` 函式上方註解**，標明「後續 audit 看到即可跳過」。

守衛 `scripts/test-steelix-palace-ability-nullify-gate.mjs`（33 斷言，HEAD 紅 4 條）：
- A 段：六來源 × delta 必須仍是 30 ＋ 每項正對照（**修前修後都綠 ⇒ 這就是 0 行為差異的證明**）。
- B 段（**絆線**）：合成持有者（把小碎鑽改成【無】／2 階／規則寶可夢）＋ 對應來源 → delta 必須變 0。
  這一段反向證明新加那行閘**真的會擋**，不是永遠 true 的死碼；HEAD 無閘時 4 條全紅。
- C 段（**反安慰劑**）：同樣的合成持有者、**不放**消除來源 → 必須仍 −30，
  排除「B 段的 0 只是合成卡本身壞掉」。
- ⚠ 合成 2 階必須 `evolvesFrom` 一張真的 Stage1 —— `isStage2` 的判準是「上一階自己也有
  `evolvesFrom`」，不是直接讀 `stage` 欄位（第一版測試就是這樣假紅的）。

### ③ 同型掃描：全站「用卡名字串判卡片類別／族群」清單與判讀（本版只列，不亂改）

| 樣態 | 代表位置 | 判讀 |
|---|---|---|
| 冠名前綴 `startsWith('大吾的'/'瑪俐的'/'莉佳的'/'阿響的'/'火箭隊的'/'奇樹的'/'小霞的'/'N的'/'赫普的'/'莉莉艾的'/'派帕的')` | `v2999_g3_wave1.ts:218`、`tools.ts:152/298/354`、`six_decks.ts:634` 等 14 處 | ✅ **正確，別動**。卡面逐字用卡名前綴，`tags` 只有籠統的 `'訓練家冠名'` 分不出是誰。⚠ 其中 `火箭隊的/N的/小霞的/赫普的/莉莉艾的/派帕的/阿響的` **有同前綴的訓練家卡**，但這些站點的定義域全是「場上寶可夢」或已顯式 `supertype==='Pokemon'`（如 `v172_hij_batch.ts:52` 火箭隊的超級球）⇒ 逐一查證後無誤判 |
| `includes('瓦斯彈')/('雙彈瓦斯')` `v2660:178` | 一併爆炸 | ✅ 卡面逐字「名稱中有「瓦斯彈」或者「雙彈瓦斯」的寶可夢」 |
| `includes('招式學習器')` `items_misc.ts:1191` | 招式學習器機 | ✅ 卡面逐字，且已配 `subtype==='PokemonTool'` |
| `includes('陳舊的')` `m5_preview.ts` resolver | 化石採掘場 | ❌ **本版已改**（見 ①） |
| `endsWith('ex'/'EX')` ~20 處 | ex 判定 | ⚪ 現役 H/I/J 4693 張**雙向零錯配**（`name.endsWith('ex') ⟺ subtype==='ex'`）⇒ 今天不是 bug，只是 `isRulePokemon` 的冗餘複本。中央述詞 `isRulePokemon` 本身也保留這條 fallback |
| `startsWith('超級')` ~15 處 | Mega ex 判定 | ⚠ **單獨用會誤判**：現役有 `超級信號`(Item)、`超級烈空坐帽子`(PokemonTool)。逐一查證後**全部**都另外配了 `subtype==='ex'` 或 `endsWith('ex')` ⇒ 今天無誤判。中央述詞 `isMegaExCard`(`selection-filter.ts:59`) 已存在，**建議下一輪收斂**（不在本版授權內） |
| `Energy && Basic && name.includes('【X】')` ~14 處（`engine.ts:4181/4425/4601/4720/9929/10039/10162`、`items_misc.ts:1470/1485/1495`、`v3050:190/226`、`slowking_lucario_deck:280/319`、`v169_supporters:258`、`effects.ts:17722`） | 基本能量屬性 | ⚠ 這是中央 `isBasicEnergyOfType`(`selection-filter.ts:46`) 的**逐字複本**（現役基本能量 `pokemonType` 恆 `undefined`，只能靠卡名【X】推）。`subtype==='Basic'` 的護欄都在 ⇒ 今天行為一致、**不是 bug**，但是 14 份可漂移的複本。**建議下一輪整批收斂**（不在本版授權內） |

### 部署提醒
卡效果／引擎有改（`m5_preview.ts` / `v2999_g3_wave1.ts`）⇒ **請站長跑 `update-tournament.bat`**，
另外兩支 bat 照舊流程。

## v6.208 威嚇之牙「只在戰鬥場」收斂成中央宣告 ＋ 手牌特性禁止點擊發動 ＋ 化石在場上是【無】屬性

BASE = `a10ed839de1c4e041b496bf2c5121ee10e57e016`（v6.207）。站長裁定四件（2026-08-18）。

### ① ⚠ 玩家回報「熔岩洞沒消掉【神秘石居】」—— **本版在引擎端測不出來**，需站長補資訊

回報：「場上有【傳說的熔岩洞】，用【烈箭鷹ex】的【鉤爪搜尋】仍然無法對【岩殿居蟹】造成傷害。」

先釐清路徑（這點回報是對的、值得記下來）：**鉤爪搜尋不走引擎主傷害管線**。
`registerDamageThenOptionalDeckSearchToHand` 讓 `regPre` 回 `damage:0`，真正的 150 點在
`regR('damage-after-deck-search-to-hand')`（`effects.ts:15540`）裡由 `dealAttackDamageToTarget`
補打 —— 也就是 v6.204 修的那一條（`passiveImmunityDamageBlock`）而不是 v5.471 修的那一條。

**但這條路徑在 BASE 樹上是通的**，逐項行為端重現（全部 `applyAction ATTACK` → `RESOLVE_SELECTION` 完整流程）：

| 重現面向 | 組數 | 結果 |
|---|---|---|
| 熔岩洞兩個印刷（19623/19626）× 座位 0/1 × 場地擁有者 0/1 | 8 | **全部打得動（150 → 岩殿居蟹 150HP 被擊倒）** |
| 從手牌用 `PLAY_TRAINER` 真的打出兩張合一競技場再攻擊 | 1 | 同上（partner 也正確就位） |
| 岩殿居蟹 6 個印刷 | 6 | 有熔岩洞全 KO、沒熔岩洞全免疫 |
| 進化來的（帶 `evolvedFromStack`）岩殿居蟹 | 1 | 同上 |
| **全卡池 715 張寶可夢【ex】× 每一招** × 岩殿居蟹在戰鬥場 | 1,000+ | 沒有任何一招「有熔岩洞卻仍被神秘石居擋下」 |
| 同上 × 岩殿居蟹在**備戰** | 1,000+ | 0 筆 |
| `passiveImmunityDamageBlock` / `resolveBenchGuard` 直接驅動 × {active,bench} × {有/無熔岩洞} | 4 | 有熔岩洞一律 `blocked:false` |

`神秘石居` 全 repo **只有一份實作**（`effects.ts:4270` 的 `PASSIVE_IMMUNITY` entry），
沒有第二／第三份；消費它的三條路徑（engine 主管線 5657／`passiveImmunityDamageBlock`／
`passiveImmunityByDamageAmount`）**都有**中央消除閘。

⇒ 本版**不改任何東西**，改成把上述矩陣寫成**回歸鎖**（守衛 ⑤ 段，8+6+4 組）。
**要請站長補的資訊**（列進回報，不擅自歸咎環境）：
1. 這一局是**休閒／單機**還是**錦標賽**？錦標賽是伺服器權威，引擎是
   `oracle-admin/tournament/server-engine.cjs`，只有跑 `update-tournament.bat` 才會重建 ——
   v6.204 的部署清單有列這支，若當時沒跑，錦標賽伺服器上的引擎還停在 v6.203。
2. 當下**場上的競技場真的是熔岩洞**嗎（有沒有被對手覆蓋掉）？
3. 對手那隻**確定是「神秘石居」版本**嗎（岩殿居蟹另有 SV11B「結實」版，那是避免昏厥、不是免疫）？

### ② 手牌特性「點一下就放到場上」（站長裁定：比照其他手牌卡）

**先查證比照對象的實際行為**（`+page.svelte` v6.207 的 `.hand-card` onclick）：

| 手牌卡種類 | 點一下的實際行為 |
|---|---|
| 能量卡 | 只切換 `selectedEnergyIid`（選取／取消選取），**不會**附上去 |
| 基礎／化石／訓練家／道具／進化 | onclick **沒有對應分支＝什麼都不做**，一律拖曳 |
| **手牌特性** | `triggerHandActivateAbility()` → **直接 dispatch，卡片當場上備戰** |

⇒ 手牌特性比照「什麼都不做」。改動：
- onclick 刪掉 `if(canHandActivate && !dragging){triggerHandActivateAbility(...);return;}`；
- `triggerHandActivateAbility` 隨之零呼叫端 ⇒ **整支刪掉**（v6.098／v6.099 死入口的教訓：
  函式還在會讓人以為入口還在）；
- `title` 從「點擊或拖到備戰格使用特性」改成「拖到備戰格使用特性」，手牌提示改「⚡ 拖到備戰發動特性」
  （UI 不可以說跟行為不同的話）。

⚠ **手機直式保住**：`MobilePortraitBattle.svelte` **不走這個 onclick** ——
手機點卡片是開 sheet 選單，再按「⚡ ⟨特性名⟩ (放備戰)」才發動，可用性同樣讀中央
`ops.has('hand-ability')`。守衛 `4g` 正對照釘住它沒被一起關掉。

⚠ 這其實**不是 v6.200 新增的**：點擊入口是 v5.511（緊急迴轉）就有的，v6.200 只是把
「拖不動」補起來 —— 在那之前點擊是唯一入口，補上拖曳之後它才變成純誤觸來源。回報的因果
（「v6.200 讓點擊也直接觸發」）與程式史不符，但**站長要的結果一樣**，照做。

連帶更新兩支既有守衛：
- `test-v6200`：`runBothUiPaths` 的點擊側改成執行 template **真正的 onclick body**，
  斷言從「兩條路徑送出相同動作」改成「拖曳送出、點擊一個都不送」。
  ⚠ `triggerHandActivateAbility` 必須當**參數**傳進去而且忠實鏡射舊行為（會 dispatch）——
  不傳 ⇒ BASE 直接 ReferenceError 讓測試「當掉」而不是「亮紅」；傳空函式 ⇒ BASE 也拿到
  `clickAct===null` ⇒ **假綠**。兩個坑都踩過才寫成現在這樣。
- `test-v6147`：送出點清單刪掉「手牌特性(點擊)」（那個入口不存在了），
  busy gate 由「手牌拖曳 gate」＋「手牌 onclick」兩條接手。

### ③ 火炎獅｜威嚇之牙 限定戰鬥場（站長裁定）＋ 與威嚇之顎共用同一份宣告

卡面逐字（`abilities[].effect`）與 陳舊的顎之化石｜威嚇之顎 **完全相同**：
> 只要這隻寶可夢在戰鬥場上，對手的戰鬥寶可夢使用的招式的傷害「-30」點。

`PASSIVE_DAMAGE_REDUCE` 有**兩個**消費點：
`engine.ts applyDefenderReductionsBlockA`（防守方必為戰鬥位，天然正確）與
`effects.ts _applyBenchAbilityReduce`（狙擊／多目標／hitBenchAll 打**備戰**）——
後者不分位置地掃 `victimCard.abilities` ⇒ **威嚇之牙在備戰被狙擊也 -30**。
行為端實測：備戰火炎獅受 100 點 → 只吃到 **70**。

⚠ `_applyBenchAbilityReduce` 上方的區塊註解白紙黑字寫著
「不涵蓋 (戰鬥位 only, 卡面明確): 火炎獅|威嚇之牙」—— **註解在說謊，程式其實有涵蓋**
（audit 必看實際碼、不可信註解）。註解已改成誠實版。

修法（**一份宣告、三個消費點**，禁各寫一份 `location === 'active'`）：
`effects.ts` 新增 `ACTIVE_ONLY_PASSIVE_REDUCE_ABILITIES`（威嚇之牙／威嚇之顎）＋
中央述詞 `passiveReduceAppliesAtLocation(abilityName, location)`；
`_applyBenchAbilityReduce`、`engine.ts` 戰鬥位 `PASSIVE_DAMAGE_REDUCE` 迴圈、
`engine.ts` 化石那份手刻 -30 三處都問它。

⚠ 這**不是白名單**：守衛 `2g` 掃全卡池 H/I/J，凡是「被動減傷路徑會消費到
（`PASSIVE_DAMAGE_REDUCE` ∪ `_COND` ∪ `_BY_ATTACKER` ∪ 化石手刻）且卡面以
『只要這隻寶可夢在戰鬥場上』開頭」的特性一律必須在清單裡（新卡自動抓得到），
且清單不得有零消費點的死條目。`2h` 拿偽造樣本自我驗證掃描器（含「G 標不列入」）。

### ④ 化石在場上是【無】屬性（站長裁定）

卡面 rulesText 逐字：「這張卡可作為HP60的【無】屬性的【基礎】寶可夢放置於場上。」
但卡片本身 `supertype='Trainer'`／`subtype='Item'`／`pokemonType=null`
⇒ v6.206 建的中央述詞 `getEffectivePokemonTypes` 對化石回 **`[]`（完全沒有屬性）**。

修法：述詞最前面加 `if (attackerActive?.fossilOnField) return ['Colorless'];`
⚠ 判準**只認 `inst.fossilOnField`**（v6.145 教訓：化石的「在場上身分」不能從卡片欄位推，
`stage` 是 undefined、`subtype` 是 'Item'）。破壞測試 E5 就是拿「改讀卡片欄位」當反例。

### ⑤ 差分實跑（**離線 BASE vs HEAD 同盤面對跑**，`scripts/_dump.mjs` 暫存腳本，未進 repo）

| 家族 | 比對點 | 組數 | 差異 | 逐筆解釋 |
|---|---|---|---|---|
| 中央有效屬性述詞（全卡池 × {戰鬥場,備戰}） | `getEffectivePokemonTypes` | 9,870 | **22** | 11 個化石印刷 × 2 個位置，`[]`→`["Colorless"]`，**只有化石** |
| 眷戀雲｜愛之同感（全流程 ATTACK，化石當對手戰鬥位 × 我方備戰化石/一般） | 加不加 120 | 24 | **22** | 全部 `no`→`MATCH`（化石是【無】、我方也有【無】⇒ 卡面成立）。其中顎之化石那組 `80-30=50` → `200-30=170` KO |
| 逆境保險（化石當對手戰鬥位 × 60 個持有者 × 4 種化石） | 抽不抽 3 張 | 240 | **0** | 全卡池**沒有任何一張的弱點是【無】**（守衛 3g 釘住，日後出了會紅） |
| 神秘花園（【超】計數，備戰放 2 隻化石） | 抽牌 log | 22 | **0** | 化石是【無】不是【超】 |
| 被動減傷：全卡池逐一當**備戰**被狙擊 100 | 實際受傷 | 3,942 | **1** | 火炎獅 `70`→`100`（＝③ 的預期效果） |
| 被動減傷：全卡池逐一當**戰鬥場**被打 100 | 實際受傷 | 3,942 | **0** | 「應該不變」的正對照組 |
| **合計** | | **18,040** | **45** | 逐筆都落在上表，無非預期差異 |

⚠ 差分模型踩過的坑（寫在此以免重犯）：
1. 第一版沒釘隨機源 ⇒ 擲幣型免疫（變隱龍｜躲藏高手 ×2、奇諾栗鼠ex｜順滑大衣）
   誤報 3 筆。改固定種子 LCG（**不可**用恆正面，flip-until-tails 會無窮迴圈把腳本掛住）。
2. 第一版的「乾淨對照寶可夢」條件寫 `hp>=200` ⇒ 全卡池挑不到、`PLAIN=null` ⇒
   `attackerCard` undefined ⇒ `applyDefenderReductionsBlockA` 整段被 `if (_atkCardR && targetCard)`
   跳過，**戰鬥場的火炎獅看起來「沒有減傷」**，差一點就誤判成另一個 bug。fixture 一定要斷言抓得到。
3. 眷戀雲第一版用 `attackIndex:0`（愛心標誌）＋【無】能量付不起【超】費 ⇒ 22 組全 0 差異的假綠。

### ⑤-b ④ 的連鎖：兩個「卡面寫【無】卻讀不到化石」的消費點（**兩輪審查抓到，本版一併修**）

站長裁定「化石在場上是【無】」之後，全站掃「卡面寫【無】寶可夢」的 H/I/J 卡共 5 張，
其中兩張**沒有**走中央述詞：

| 卡 | 卡面 | 舊行為（實跑） | 新行為（實跑） |
|---|---|---|---|
| **傳說的山頂**（M6 19622/19625） | 「雙方的【無】寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，被獲得的獎賞卡減少1張。」 | 化石被 KO **仍給 1 張獎賞** | **0 張**（印刷【無】的對照不變、非【無】的對照仍 1 張） |
| **玻璃喇叭**（SV7 10984 等） | 「選擇最多2隻自己的**備戰區的【無】寶可夢**…」 | 備戰只有化石時 regG **回 false**（用不出來） | **true**（印刷【無】對照仍 true、【火】對照仍 false） |

`legendPeakPrizeReduction` 原本簽名只收 `Card`，**結構上看不到 `inst.fossilOnField`** ⇒ 加**必填**的
`koInst` 與 `koOwnerIdx`（TS 逼兩個呼叫端 `effects.ts:896` / `engine.ts:5769` 回來補），
並改走中央述詞。⚠ `_shared.ts` 不能 import `effects.ts`（循環相依，Check O）⇒ 沿用本檔既有的
注入模式新增 `setEffectivePokemonTypesFn`／`effectivePokemonTypesShared`，轉接**同一支**
`getEffectivePokemonTypes`（**不是第二份實作**）；守衛 `6f` 行為端釘住「注入點真的接上了」
（v6.204 的 G2 教訓：注入點沒接上時所有測試照樣全綠）。

⚠ 順帶查證到、寫進註解免得再被誤導：**被 KO 進棄牌區的化石仍保有 `fossilOnField`**
（`toBareCard` 只服務「回手牌／牌庫」那條路徑），傳說的山頂正是靠這一點才判得出來；
`_shared.ts` 的 `toBareCard` 註解原本寫「stadiumHalf 與 fossilOnField…必須保留」——
白名單裡從來沒有 `fossilOnField`，**註解在說謊**，已改成誠實版。

### ⑥ 守衛 `scripts/test-v6208-active-only-passive-reduce-and-fossil-colorless.mjs`（40 檢查，全行為端）

①卡面逐字錨（兩張卡面逐字相同／11 個化石 rulesText／神秘石居・熔岩洞・鉤爪搜尋）；
②③ 威嚇之牙 位置限定（備戰 100、戰鬥場 70）＋ 顎之化石正反對照 ＋ 三張無位置限制的減傷仍生效
＋ 枚舉守衛與掃描器自我驗證 ＋ `2g2` field-wide 兩張（盾之守護限戰鬥場／岩石宮殿限備戰）的行為端；
③④ 化石【無】（述詞、只認 fossilOnField、全卡池**精確集合**不變式、眷戀雲／傳說的山頂／玻璃喇叭
三個行為端消費點、四組正對照）；④② 點擊回歸（**真的執行 template 的 onclick body**）；
⑤① 神秘石居回歸鎖；⑥ 位置限定 passive 全站下限＋中央宣告逐字＋去中央化偵測＋注入點行為端。

**HEAD-FAIL（逐項還原、逐項確認會紅、腳本跑得完 `/tmp/destroy.py` 印出 SCRIPT-END）**：

| 破壞 | 腳本跑得完？ | v6208 | v6200 | m6-legend |
|---|---|---|---|---|
| 5 個 src 檔**全部**還原 BASE | ✅ | **15 FAIL** | 3 FAIL | 1 FAIL |
| 只還原 `+page.svelte`（②） | ✅ | 3 FAIL | 3 FAIL | 0 |
| E1 `passiveReduceAppliesAtLocation` 恆真（**接線在、行為不在**） | ✅ | 2 FAIL | 0 | 0 |
| E2 備戰消費點拆掉接線 | ✅ | 2 FAIL | 0 | 0 |
| E3 中央清單漏掉「威嚇之顎」 | ✅ | 3 FAIL（含枚舉守衛 2g） | 0 | 0 |
| E4 化石【無】短路拿掉 | ✅ | 6 FAIL | 0 | 1 FAIL |
| E5 化石判準改讀卡片欄位（v6.145 的錯法） | ✅ | 6 FAIL | 0 | 1 FAIL |
| E6 **去中央化**（本地硬編特性名，行為對、接線沒了） | ✅ | 1 FAIL（6c） | 0 | 0 |
| E7 中央有效屬性**注入點沒接上** | ✅ | 2 FAIL（3h/6f） | 0 | 0 |
| E8 傳說的山頂退回印刷屬性 | ✅ | 2 FAIL（3h/6f） | 0 | 1 FAIL |
| E9 玻璃喇叭退回印刷屬性 | ✅ | 1 FAIL（3i） | 0 | 0 |
| E10 engine 兩處中央呼叫刪掉 | ✅ | 1 FAIL（6e） | 0 | 0 |
| E11 盾之守護 位置抄成備戰 | ✅ | 1 FAIL（2g2） | 0 | 0 |
| 全部還原後複驗 | ✅ | 0 FAIL | 0 FAIL | 0 FAIL |

⚠ `effects.ts` **單獨**還原會讓 `engine.ts` import 不到新符號而 build 失敗（同 v6.206），
所以改用「全部還原」＋ E1~E11 定點破壞，全部跑得完。

### ⑥-b 兩輪 opus 自我審查抓到、且已修的假綠／缺口

| 項目 | 判定 | 修法（都配了破壞複驗） |
|---|---|---|
| `3f` 神秘花園正對照 | **雙重恆真**：`hand: []` 讓 engine 第一道閘「手牌沒有能量卡」就 early-return，**根本沒跑到【超】計數**；而且成功路徑是開 `hand-discard` picker、當下不抽牌 ⇒ 拿 `hand.length===0` 當判準毫無鑑別力 | 手牌放 1 張基本【超】能量，改看 `pendingSelection` 與 log；補「真【超】⇒ 會開丟棄視窗」的正對照 |
| `4b` 核心條目 | **anchor 失效時恆真**：`handOnClickBody` 抓不到回 `null`，`new Function('null' + ';return …')` 是**合法 JS** ⇒ 三條斷言全過 | `4b/4c/4d` 各補 `assert.ok(HAND_ONCLICK)`；破壞複驗：改壞 anchor ⇒ 4b 也紅 |
| `3c` 不變式 | **單邊、無下界**：只擋「多改」；把既有兩族雙屬性實作整個刪掉 `changed` 變 0 仍全綠 | 改成**精確卡名集合**斷言（多改少改都紅） |
| `2g` 枚舉守衛 | **自稱的覆蓋範圍不成立**：`consumed` 只含三張 map ＋ 威嚇之顎，但 field-wide 型的 **盾之守護** 也符合「卡面只要…在戰鬥場上＋減傷」卻不被要求入列 | 加 `FIELD_WIDE` 白名單 ＋ 新增 `2g2` **行為端**驗證那兩張的位置判斷是真的（E11 破壞複驗會紅） |
| `2h` 掃描器自我驗證 | **盲點**：只餵自造 Map ⇒「對真 pool 作弊、對假 pool 誠實」的實作也全綠 | 補「複製真 pool、把一張真卡的 effect 前綴改成位置限定 ⇒ 必須抓得到」 |
| `6b` | `size >= 2` 而字面量正好 2 ⇒ 零資訊量 | 改成逐字集合斷言 |
| 中央宣告可被**去中央化** | 把 `_applyBenchAbilityReduce` 的中央呼叫換成本地硬編 `ab.name === '威嚇之牙' && _vloc !== 'active'`，行為完全正確、**33 條一條都不紅** | 新增 `6c/6d`：只掃該函式 body（全檔掃會把 engine 那句合法的「這張卡有沒有這個特性」誤判成違規 —— 第一版就假紅過），配四條自我驗證（含「strip 不得動字串內容」「字串裡的 `//` 不是註解」） |
| engine 兩處中央呼叫是恆真接線 | 兩行全刪 ⇒ **0 紅**（設計上就是「未來用」，本身回傳恆真） | 新增靜態守衛 `6e`（呼叫次數 == 2）＋ 註解寫明「此處恆真、寫出來是為了位置規則只有一份」 |
| `test-v6147` 的「手牌 onclick」 | 全檔搜尋、沒綁定手牌卡元素 | 限縮到 `class="hand-card"` 後 2500 字元內 |
| 兩個真 bug（傳說的山頂／玻璃喇叭） | 見 ⑤-b | 已修並各配行為端守衛 `3h`/`3i` |
| 過時／說謊的註解 3 處 | `_shared.ts` toBareCard（說保留 fossilOnField，其實沒有）／`v154_decks.ts`（說走 `filterType='Colorless'`，全站早已無此用法）／`+page.svelte`（說「點卡發動」） | 全部改成誠實版 |

⚠ **審查提出但查證後判定不修的**：
1. `4g`（手機直式）與 `4e`（死碼清除）是純 regex、沒有執行手機路徑 —— 手機的行為由
   `test-v6201-mobile-hand-ops-and-ability-gate` 負責，這裡只做「入口沒被一起關掉」的接線確認，維持現狀。
2. `m5_preview.ts:2216` 化石採掘場的 gate（`name.includes('陳舊的')`）比 `isFossilItemCard` 鬆 ——
   實掃全 live 卡池：H/I/J 內名稱含「陳舊的」的 Trainer/Item **只有那 7 張化石**，今天不會誤設；
   收緊屬於另一個維度，**列給站長**。
3. `steelixPalaceReduce`（岩石宮殿）沒接特性消除閘 —— 舊帳、非本版範圍，**列給站長**。

### ⑦ 整體 audit：「位置限定的 passive」與「特性消除閘漏路徑」

**A. 位置限定 passive**：掃全卡池 H/I/J，`abilities[].effect` 以
「只要這隻寶可夢在戰鬥場上／在備戰區」開頭的共 **23 個特性名**（另有 12 個
「這隻寶可夢**在戰鬥場**受到…時」的受傷反擊型）。逐維檢查結果：

| 維度 | 位置閘在哪 | 結論 |
|---|---|---|
| 被動減傷（`PASSIVE_DAMAGE_REDUCE` 家族） | 本版新建 `ACTIVE_ONLY_PASSIVE_REDUCE_ABILITIES` | ⚠ **本版修掉 1 個（威嚇之牙）** |
| 受傷反擊（毒刺／灼熱之軀／反擊針／尖刺盔甲／甲殼刺／警備濁霧／頭蓋尖刺／自動用武…） | `fireDefenderOnDamaged` **只在 active 觸發**；卡面沒寫「在戰鬥場」的例外走 `ANYWHERE_RETALIATION`（v5.980 已建） | 已收斂，無新缺口 |
| 主動特性（「若這隻寶可夢在戰鬥場上／備戰區，則在自己的回合可使用1次」） | `getUsableAbilities`（v6.181 整批修過） | 已收斂 |
| 備戰限定免疫（羽毛守護／藏隱／深度下潛／太古防壁／岩石宮殿／森林秘道） | `resolveBenchGuard`／各自 helper 自帶 bench gate | 已收斂 |
| 戰鬥場限定 field-wide（初始化／暗夜羽擊／爆大身軀／海之詛咒／瞪眼效用／廣域堡壘／揚沙／劇毒支配／自動治癒／漩渦言靈／盾之守護／原始根） | 各自 helper 已判 active | 已收斂（盾之守護 v6.206、威嚇之顎 v6.207 才補上） |

**B. 特性消除閘的路徑覆蓋**：以 `神秘石居` 當探針做全路徑掃描（見 ① 段），
主攻擊／狙擊／多目標／hitBenchAll／延後型 resolver 五條路徑答案一致，**沒有掃出漏接**。

### ⑧ 部署
`update-tournament.bat`（卡效果／引擎改動）、`update-admin-full.bat`（admin.html 版本提示）。
`redeploy-oracle.bat` 本版**不需要**（沒動 `server_admin_patch.js`）。
⚠ 另請站長確認 v6.204 之後**有沒有跑過** `update-tournament.bat` —— 見 ① 段第 1 點。

## v6.207 v6.206 ⑦ 段那份「直讀印刷 pokemonType 的場上消費點」清單落實 ＋ 逆境保險吃弱點改寫 ＋ 威嚇之顎接消除閘

BASE = `90a3de9ff34fc862b69156c4d7ec8bcba6e11ec6`（v6.206）。站長裁定三件（2026-08-18）。

### ① 76 處逐處判讀：換 24 處／刻意不換的理由／剩下的清單

判準（站長給的）：**這個判斷是在問「場上這隻現在是什麼屬性」嗎？** 是 ⇒ 換；
問「這張卡印的是什麼屬性」（牌庫／手牌／棄牌區／UI 顯示／牌組驗證）⇒ **不換**。

**換掉的（24 處 / 10 個檔）**：

| 卡（卡面主詞） | 位置 | 現在的行為差異 |
|---|---|---|
| 由紫「自己的1隻【超】寶可夢」 | `v168_supporters.ts` regG＋validIids | 小碎鑽 **選得到了**（v6.206 已實跑證明現況打不出來） |
| 神秘花園「自己場上【超】寶可夢的數量」 | `engine.ts` USE_STADIUM gate ＋ **`stadiums.ts` 抽牌 resolver** | gate 從「擋下」變「可用」，抽牌數也對得上 |
| 奇跡修正檔「備戰區的【超】寶可夢」 | `items_misc.ts` regG＋step2 validIids | 備戰小碎鑽成為合法目標 |
| 奇異時鐘「自己的**進化的**【超】寶可夢」 | `items_misc.ts` `psychicEvoIids`＋step1 複驗 | 目前 0 差異（小碎鑽是【基礎】），語意先對齊 |
| 感應【超】能量「附於【超】寶可夢身上時」 | `energy_cards.ts` 附加 gate | 附到小碎鑽會觸發搜尋（原本靜靜地 `return st`） |
| 美洛耶塔｜治癒旋律「備戰區的1隻【超】」 | `effects.ts` | validIids 收得到小碎鑽 |
| 大吾的巨金怪ex｜X啟動「自己的【超】或者【鋼】」 | `lopunny…ts` gate ＋ **`v158_energy_chain.ts` 中央 `pokemonMatchesType`** | 能量鏈的合法目標含小碎鑽 |
| 風妖精｜柔柔治癒「自己的戰鬥場的【草】寶可夢」 | `v2998_g2.ts` | 狠辣椒ex 在戰鬥場時可發動（原本直接拒絕） |
| 屬性條件型防禦道具（福祿果/巧可果/…/渾厚鱗片） | `engine.ts` 戰鬥位管線 ＋ `effects.ts` 備戰管線（兩份獨立實作） | 小碎鑽攻擊時福祿果（對【超】-60）會觸發並丟棄 |
| 活力森林「【草】寶可夢…進化成【草】寶可夢」 | `engine.ts` EVOLVE handler ＋ `getEvolvableTargets` | **實測 0 差異**（卡池沒有從狠辣椒ex 進化的卡），語意先對齊；⚠ `evoCard` 還在**手牌** ⇒ 維持印刷屬性 |

⚠ **v6.206 的清單漏了 `stadiums.ts` 的神秘花園 resolver** —— 只改 engine 的 gate 會讓
「可不可以用」與「實際抽幾張」分岔。本版兩端同 commit（守衛 2d 同時斷言兩端）。

**刻意不換（判讀後認定印刷屬性才對）**：
- `selection-filter.ts:296/318/322`、`ai.ts:721-728`、`+page.svelte` 的 `Pokemon:<屬性>` 系列 ——
  這些 zone 全是 **deck-search / hand-discard / discard-search**，主詞是「牌庫/手牌/棄牌區裡的卡」。
  （v6.205 曾把它們列為疑慮，本版查證後確認不該動。）
- `energy_cards.ts:61` 感應【超】能量的**牌庫**搜尋條件（卡面「從自己的牌庫選擇…【超】屬性的【基礎】寶可夢卡」）。
- `engine.ts:9290` / `3586` 的 `evoCard.pokemonType`（進化卡還在手牌）。
- `routes/cards`、`routes/decks`、`routes/card/[id]`、`sfx-events.ts` 的屬性顯示／音效取色。
- 全部 `ec.pokemonType`（能量卡的屬性）與 `isBasicEnergyOfType` 系列 —— 主詞是能量卡不是寶可夢。

**判讀後認定「該換、但本輪不換」（列給站長，下一輪）**：
1. **【鬥】家族**：`six_decks.ts:412/439` 岩石武裝目標、`engine.ts:10059` 岩石武裝 gate、
   `engine.ts:5401` 力量蛋白飲、`effects.ts:4135` 力之鹽。
   ⚠ **更正 v6.206 的說法**：這幾處**現在沒有行為差異** —— 唯一能多出【鬥】的是鐵轍跡，
   而它要附「驅勁能量 未來」，那張卡三個印刷全是 **G 標的 Trainer/PokemonTool**，
   `hasIronTracksDualCore` 又只掃 `energyAttached` ⇒ 合法牌組打不出來（v6.206 ⑧-1 已凍結）。
   ⇒ 改了是純粹的語意對齊、零行為收益，本輪按「寧可少做」原則不動。
2. `energy_cards.ts:103` 磁鐵【鋼】能量（`SPECIAL_ENERGY_RETREAT_MOD` 只收 `holder: Card`，
   要像 v6.206 的 `SPECIAL_ENERGY_HP_BONUS` 那樣加必填 ctx，屬於簽名改動）。
   同理 `energy_cards.ts:130`（泡沫水【水】能量的狀態免疫）。
3. 其餘同型但目前無差異的：【惡】8 處、【鋼】9 處、【龍】7 處、【雷】7 處、【無】8 處、
   【水】3 處、【火】3 處（詳見 v6.206 ⑦ 段）。

### ② 逆境保險吃「弱點改寫」（站長裁定）

`tools.ts` holder 側原本讀 `dCard.weakness?.type`（印刷值）。改成**共用傷害引擎那一份**
`getEffectiveWeaknessType(state, aIdx, dp.active, dCard, pool)`（`effects.ts:394`，
引擎主管線 5462 行與中央 `applyWeakRes` 都用它），並比照引擎的 `!w.disabled && …`
在 `disabled` 時不觸發 —— 鋁鋼橋龍ex｜金屬防禦強化卡面是「這隻寶可夢的**弱點全部消除**」，
此刻沒有弱點就不可能匹配。

實跑證明（同一盤面、同一份 log）：
- 掌握弱點覆寫成【鬥】：BASE 傷害已 `60×2=120` 但 `hand=0`；HEAD `120` ＋ `hand=3`。
- 妖精領域（對手【龍】→【超】）：BASE `30×2=60` 但 `hand=0`；HEAD `60` ＋ `hand=3`。
- 弱點失效：兩者都不 ×2、都不抽。

### ③ 陳舊的顎之化石｜威嚇之顎 接特性消除閘（站長裁定）

`engine.ts` `applyDefenderReductionsBlockA` 那段原本只判 `fossilOnField` ＋ 卡名，
**完全沒有消除閘**。補上 `defenderCard.abilities?.some(a => a.name === '威嚇之顎')` ＋
中央 `isAbilityHolderEffective(workingState, defender.active, defenderCard, dIdx, '威嚇之顎', 'active', pool)`
（＝隔壁 v6.206 盾之守護 `shieldFossilGuardReduce` 用的同一份閘，**沒有新建**）。

| 消除來源 | 打不打得到 | 理由（v6.145：化石在場上是【基礎】【無】） | 實跑 |
|---|---|---|---|
| 火箭隊的監視塔（消【無】） | **打得到** | 中央閘的 `isNullifiedByRocketWatchtower` 已讀 `fossilOnField` | 50-30=20 → **50** |
| 招式版暗夜羽擊 / passive 振翼髮 | **打得到** | location='active' | 減傷消失 |
| 傳說的熔岩洞（消進化） | 打不到 | `fossilOnField` ⇒ 判為【基礎】 | 仍 20 |
| 鐵荊棘ex｜初始化（消規則寶可夢） | 打不到 | 化石卡是 Trainer/Item，非規則寶可夢 | 仍 20 |
| 海兔獸｜黏著束縛（消備戰 Stage2） | 打不到 | 本特性只在戰鬥場生效 | 仍 20 |

⚠ 連帶把 v6.205 守衛 `7e` 的死條目清掉：這段現在同時出現卡名與特性名，
候選判準不再把它列為「疑似未實裝」。該守衛在 BASE 樹會紅（7d），HEAD 全綠 —— 兩端有耦合。

### ④ 差分實跑（**離線 BASE vs HEAD 同盤面對跑**，不是自己跟自己比）

`scripts/_diffdump.mjs`（暫存腳本，未進 repo）在兩棵樹跑同一批盤面 dump JSON 後 diff：

| 家族 | 比對點 | 差異 | 逐筆解釋 |
|---|---|---|---|
| 由紫 gate（全卡池當備戰） | 3,942 | **2** | 小碎鑽兩個印刷 false→true |
| 奇跡修正檔 gate | 3,942 | **2** | 同上 |
| 奇異時鐘 gate | 3,942 | 0 | 小碎鑽是【基礎】⇒ 本來就不該過 |
| 感應【超】能量 附加 | 3,942 | **2** | 小碎鑽 `-`→開搜尋 |
| 神秘花園 gate | 3,942 | **2** | 小碎鑽 blocked→open |
| 治癒旋律 validIids 長度 | 3,942 | **2** | 小碎鑽 0→1 |
| 大吾的巨金怪ex 能量鏈目標 | 3,942 | **2** | 小碎鑽 false→true |
| 柔柔治癒（全卡池當戰鬥位） | 3,942 | **3** | 狠辣椒ex 三個印刷 80→0（被恢復） |
| 福祿果（全流程 ATTACK） | 3,810 | **2** | 小碎鑽 `N\|340`→`Y\|280` |
| 逆境保險（**無**弱點改寫） | 3,810 | **0** | 「應該不變」的對照組 |
| 活力森林 可進化目標 | 1,516 | **0** | 卡池沒有從狠辣椒ex 進化的卡 |
| 化石減傷 × 3 場地 | 33 | **1** | 顎之化石＋監視塔 20→50 |
| 逆境保險 × 弱點覆寫成【鬥】 | 409 | **325** | 全部 `0→3`（＝②的預期效果）；另 84 筆印刷弱點本來就是【鬥】⇒ 不變 |
| **合計** | **41,114** | **343** | 逐筆都落在上表，無非預期差異 |

### ⑤ 守衛 `scripts/test-v6207-onfield-effective-type-consumers.mjs`（41 檢查）＋ HEAD-FAIL

| 破壞 | 腳本跑得完？ | 結果 |
|---|---|---|
| 10 個 src 檔**全部**還原 BASE | ✅ | **19 FAIL** |
| `engine.ts` 單獨還原 | ✅ | 6 FAIL |
| `effects.ts` 單獨還原 | ✅ | 2 FAIL（2i / 4c） |
| `v168_supporters.ts` 單獨還原 | ✅ | 4 FAIL |
| `v158_energy_chain.ts` 單獨還原 | ✅ | 3 FAIL |
| `tools.ts` 單獨還原 | ✅ | 3 FAIL |
| `stadiums.ts` / `items_misc.ts` / `energy_cards.ts` / `v2998_g2.ts` 單獨還原 | ✅ | 各 2 FAIL |
| `lopunny…ts` 單獨還原 | ✅ | 1 FAIL |
| E1 逆境保險退回印刷弱點（**接線在、行為不在**） | ✅ | 2 FAIL（5b/5d） |
| E2 威嚇之顎拿掉消除閘 | ✅ | 2 FAIL（6c/6e） |
| E3 中央述詞退化成印刷屬性 | ✅ | 14 FAIL |
| E4 能量鏈屬性比對退回印刷 | ✅ | 1 FAIL（2j） |
| E5 在清乾淨的檔裡塞回一行舊寫法 | ✅ | 2 FAIL（2d ＋ **8b**，見下） |
| E6 拿掉一個中央述詞 import | ✅ | 5 FAIL（含 8c） |
| E7 神秘花園只改 gate 不改 resolver | ✅ | 1 FAIL（2d） |
| E8 塞回 `pokemonMatchesType(pool.get(...), filter)` 舊呼叫 | ✅ | 1 FAIL（8d） |

### ⑥ 兩輪 opus 自我審查抓到、且已修的假綠

| 項目 | 判定 | 修法 |
|---|---|---|
| `8b` 否定型掃描器 | **假綠**（E5 破壞測試逼出來）：舊 `strip` 先把字串字面量清成 `''`，判準要比對的 `'Psychic'` 一起被清掉 ⇒ 把違規樣本塞回去仍全綠 | 改成**逐字元掃描**：只砍註解、字串內容原樣保留、字串裡的 `//` 不誤判。`8a` 補兩條正對照（「字串內容必須保留」「字串裡的 `//` 不是註解」）。破壞複驗：E5 ⇒ **8b 紅** |
| `7b` 差分模型 | **誤報 40+ 張**：舊模型寫成「印刷是【超】」，但福祿果卡面是「受到…招式的**傷害**時」，0 傷害招式本來就不觸發 | 舊模型改成「印刷【超】**且**同盤面真的打出 >0 傷害」 |
| `7b` 隨機源 | **腳本跑不完**：`Math.random=()=>0.25`（恆正面）讓 flip-until-tails 招式無限迴圈，測試掛住**不會紅** | 改固定種子 LCG（可重現且必定出反面） |
| `4c` 期望值 | 第一版寫 `100×2(弱點)-60=140` —— 備戰**不計算弱點**（官方規則），正確是 40 | 改 40，並在註解寫明理由 |
| `effects.ts` 備戰管線零覆蓋 | 單獨還原 `effects.ts` 只紅 1 條 ⇒ 備戰傷害管線（狙擊/多目標）**沒有任何測試** | 補 `4c/4d`（直接驅動 `dealAttackDamageToTarget`），單獨還原變 2 FAIL |
| `2b/2f/2h` 負對照 | **推理錯**：暗夜羽擊卡面是「對手的**戰鬥**寶可夢的特性全部消除」⇒ 打不到**備戰**的小碎鑽，原本的負對照恆綠 | 負對照改用「小碎鑽在戰鬥場」；備戰型消費點改用「非【超】寶可夢」；另加 `2b2` 不變式（**備戰的小碎鑽全站無任何消除來源打得到**，日後出新消除卡會紅） |
| `2j` | 只斷言「沒有出現『場上無可附目標』」＝弱斷言 | 改成走完兩段牌庫搜尋、直接斷言能量鏈 `params.validIids` **含**小碎鑽、**不含**非【超】非【鋼】的 |
| `7a/7b` 差分 | 只跑述詞層 ⇒ 不能證明消費點接上了 | 7a 改跑真的 `TRAINER_GUARDS`、7b 改跑全流程 `applyAction ATTACK` |
| v6.206 ⑦「現在就有行為差異」的【鬥】那三行 | **over-claim**（見 ①-延後-1） | 本檔更正並保留證據 |

### ⑦ 其他

- `tsc` 逐行 diff 與 BASE **完全一致**（只有行號位移），新 `TS2304` = **0**。
- 首頁 changelog 放一則（玩家有感）；50 則上限已滿 ⇒ v6.141 移進 `changelog-archive.html`。

## v6.206 tag 三把尺的站長裁定落實 ＋「屬性改變」收斂成中央述詞 ＋ 盾之守護補實裝

BASE = `0c12dcf47b1e74b65050aae94e6081d90f479f5d`（v6.205）。

### ① 站長裁定（2026-08-18，逐字）：tag 不用補，現況是對的

> 「我判定，**不用補標籤**，這些卡片的**卡圖上面都沒有古代和未來的標籤**，所以都是正確的，
>  你如果改了反而是錯的。」

v6.205 那 11 筆（密勒頓 16754/18373/19171/19235、密勒頓ex 16755/18259、故勒頓 19189、
故勒頓ex 12142/16896/18272、鐵脖頸 12419）**一個都沒有動**。

**尺 (c)「同名平權」整段移除**。裁定之外，資料本身也否證了它的前提：
「密勒頓」在卡池裡是**兩種完全不同的卡**——【龍】110HP（SV5M 9893／SV8a 11648／MC 17023／
SV-P-H 10102，有「未來」、官方 filter 也列出）與【雷】120HP（MC 16754／MJ 18373／M5 19171／
M-P-J 19235，招式各不相同、卡圖沒有標籤）。故勒頓ex 亦然（svhk 10061【龍】230「古代」 vs
MC 16896／18272【鬥】230「太晶」，招式完全不同）。同名 ≠ 同一張卡 ⇒ 這把尺會每輪叫人去改**正確**的資料。

**另外兩把尺逐一查證：沒有同樣的問題，保留。**

| 尺 | 查證結果 | 處置 |
|---|---|---|
| (a) 官方快照 | 方向單向「官方說有 ⇒ 我方必須有」。**11 筆官方一筆都沒列**；而且 16754/16755/16896/18272 四筆就在官方 filter **有涵蓋**的 MC 卡包裡（MC 實際被列了 古代 16／未來 14／ACE SPEC 16 筆）⇒ **官方資料本身與站長裁定一致** | 保留 |
| (b) 印刷平權 | 指紋含 HP／屬性／特性／招式／rulesText ⇒ 密勒頓/故勒頓那種「同名不同卡」指紋本來就不同，不會誤報。實測**跨世代（SV↔MC）同指紋且含古代/未來的 31 組全部一致**（MC 重印確實會帶標籤）；唯二不一致的 2 組都是 G 標（驅勁能量 未來 SV8a 12436／弗圖博士的劇本 SV8a 12452），已在例外表 | 保留 |

⚠ v6.205 曾寫「M 系列 26 個卡包完全沒覆蓋」，**MC 不在其中**（MC 有覆蓋）—— 這點本版更正。

### ② 「屬性改變」從一維擴大成中央述詞 `getEffectivePokemonTypes`

v6.205 只把狠辣椒ex 接在**弱點/抵抗力**那一維，但卡面是「只要這隻寶可夢**在場上**」。
本版在 `effects.ts` 新增中央述詞（`getEffectivePokemonTypes` / `hasEffectivePokemonType`），
`getAttackerEffectiveTypes` 變成它的別名（參數名保留 `attacker*` 只為了不動 v6.204/6.205 的字串錨點），
消除閘沿用 v6.204 的 `hasEffectiveAbilityByInst`（location 它自己從 state 推 ⇒ **備戰一體適用**），
**沒有新建第五份述詞**。

收斂的消費點（站長核准的三處）：

| 位置 | 舊寫法 | 行為差異 |
|---|---|---|
| `effects.ts` 土台龜ex｜森林行進 | `countOwnPokemon(…, c => c.pokemonType === 'Grass')` | 場上（含**備戰**）的狠辣椒ex 現在算 1 隻【草】⇒ +30 |
| `energy_cards.ts` 增強【草】能量 | `holder.pokemonType === 'Grass' ? 20 : 0` | 狠辣椒ex 附上後最大 HP 260 → **280** |
| `tools.ts` 逆境保險（③） | `weakness !== aCard.pokemonType` | 三張雙屬性卡**全部**漏判，現在都認得 |

配套簽名改動：
- `countOwnPokemon` 的 `filterFn` 多收 `inst`（既有 caller 一個參數，TS 相容）。
- `SPECIAL_ENERGY_HP_BONUS` 的 fn 多收**必填** `ctx: SpecialEnergyHolderCtx`
  （含 `effectiveTypes`）⇒ TS 逼呼叫端回去讀卡面，不會靜默 fail-open。
  唯二呼叫端都在 `engine.ts getEffectiveHP`（化石分支＋一般分支），`+page.svelte` 沒有用到這張 map。
- `getEffectiveHP` 內新增 `_v6206OwnerIdx`（從 state 推），兩條分支共用同一份 ctx；
  state 缺席的 UI 路徑 ⇒ ownerIdx undefined ⇒ 中央述詞回印刷屬性＝維持舊行為。

⚠ **刻意不做**：中央述詞**不處理**「化石在場上是【無】屬性」（rulesText 那句）。
現行消費點都不需要，而加進來會直接改變 逆境保險／森林行進 對化石的判定 ⇒ 交站長裁定。

### ③ 逆境保險（`tools.ts`）

卡面：「若附有這張卡的寶可夢的**弱點屬性**與對手戰鬥寶可夢的**屬性**相同，則…從自己的牌庫抽出3張卡。」
只換「攻擊方屬性」這一側走中央述詞。**holder 的弱點維持卡面印刷值** —— 妖精領域／掌握弱點／
弱點失效 這類「改寫弱點」的效果要不要算進來，卡面沒寫 ⇒ **列給站長裁定**，本版不動。

### ④ 陳舊的盾甲化石｜盾之守護（M5 19216，J）補實裝

卡面逐字（`abilities[].effect`）：「只要這隻寶可夢在**戰鬥場**上，自己的所有寶可夢受到對手的
寶可夢招式的傷害「-10」點。」
rulesText：「這張卡可作為HP60的【無】屬性的【基礎】寶可夢放置於場上。…」

實作 `shieldFossilGuardReduce(state, defenderIdx, pool)`（`v2999_g3_wave1.ts`，與 `bronzongShelterReduce`
同族），兩條管線各接一次：`engine.ts` 戰鬥位傷害管線、`effects.ts` 備戰傷害管線。

⚠ **條件是「在戰鬥場上」，不是青銅鐘｜守護之鐘 的「在場上」** —— helper 只認 `owner.active`
且要求 `inst.fossilOnField`。疊加問題不存在（戰鬥位只有 1 隻）⇒ 恆為 -10，刻意不寫 count×10。

特性消除閘（沿用中央 `isAbilityHolderEffective`，逐一行為端驗證）：

| 來源 | 打不打得到 盾之守護 | 理由 |
|---|---|---|
| 火箭隊的監視塔（消【無】） | **打得到** | 中央閘的 `isNullifiedByRocketWatchtower` 已讀 `fossilOnField`（v6.145） |
| 招式版暗夜羽擊 / passive 振翼髮 | **打得到** | location='active' |
| 傳說的熔岩洞（消進化） | 打不到 | `fossilOnField` ⇒ 中央閘判為【基礎】 |
| 鐵荊棘ex｜初始化（消規則寶可夢） | 打不到 | 化石卡是 Trainer/Item，非規則寶可夢 |
| 海兔獸｜黏著束縛（消備戰 Stage2） | 打不到 | 本特性只在戰鬥場生效 |

⇒ v6.205 的 `KNOWN_UNIMPLEMENTED` 清空：**全站已無「卡面有效果但完全沒實裝」的 H/I/J 卡**。

### ⑤ 差分實跑（守衛 `scripts/test-v6206-effective-type-central-and-shield-fossil.mjs`，43 檢查）

| 差分 | 組數 | mismatch | 解釋 |
|---|---|---|---|
| 全卡池 × {戰鬥場,備戰} × 3 場地：有效屬性 vs 印刷屬性 | 12,000+ | 只有小碎鑽／狠辣椒ex 偏離，期望值逐一釘死 | 三張 dual 都**包含**印刷屬性 ⇒ 純新增 |
| 森林行進（全卡池逐一當備戰第 1 隻） | 3,942 | **3**（狠辣椒ex 三個印刷 30→60） | 其餘 0 |
| 增強【草】能量（全卡池逐一當 holder） | 3,942 | **3**（狠辣椒ex Δ0→Δ20） | 其餘 0 |
| 盾之守護（全部化石逐一當戰鬥位） | 7 | 0 | 只有盾甲化石有減傷、顎之化石維持既有 -30 |

⚠ 差分模型自己踩過兩個坑（寫在守衛註解裡）：
1. 增強【草】能量的「舊值」**不可**寫成 `card.hp + 20` —— 怖納噬草｜雜草魂 這類「最大HP 特性」
   會讓基準值本來就不是 `card.hp`（第一版誤報 3 張）。
2. 改成「附 / 不附」的差值仍不對 —— 怪顎龍｜暴龍根性「身上附有**特殊能量**卡 ⇒ 最大HP +150」
   ⇒ 對照組必須換成**另一張特殊能量**（磁鐵【鋼】能量，沒有 HP hook）。

### ⑥ HEAD-FAIL / 破壞測試（逐項還原、確認會紅、**腳本本身跑得完**）

| 破壞 | 結果 |
|---|---|
| 全部 6 個 src 檔還原 BASE | **17 FAIL**（2a/3b/3d/4b-4d/5b/5d/6a/6b/6e/6f/6g/7a-7d） |
| `engine.ts` 單獨還原 BASE | 11 FAIL |
| `tools.ts` 單獨還原 BASE | 2 FAIL（5b/5d） |
| `energy_cards.ts` 單獨還原 BASE | 4 FAIL（4b/4c/4d/7c） |
| E1 `shieldFossilGuardReduce` 變死碼 `return 0` | 6 FAIL |
| E2 中央述詞退化成印刷屬性（**接線在、行為不在**） | 11 FAIL |
| E3 盾之守護**拿掉消除閘** | 2 FAIL（6c/6d）⇒ 證明閘不是裝飾 |
| E4 盾之守護條件抄成青銅鐘的「在場上」（含備戰） | 1 FAIL（6b） |
| v6.205 守衛還原 BASE | 1 FAIL（8e：尺 (c) 還在） |

⚠ `effects.ts` / `v2999_g3_wave1.ts` **單獨**還原時 esbuild build 會失敗（engine/tools 還 import 新符號），
那不是有效的 HEAD-FAIL ⇒ 改用「全部還原」＋「E1/E2 定點破壞」兩種方式取代，兩種腳本都**跑得完**。

### ⑦ 整體 audit：全站仍直接讀印刷屬性 `pokemonType` 的**場上**消費點（本版刻意不動，列給站長）

掃描條件＝「主詞是場上寶可夢實體、且不是能量卡比對」，共 **76 處**。
其中**現在就有行為差異**的（比對的屬性正好是三張 dual 卡會多出來的那幾種）：

- **【超】（小碎鑽會多出來）**：`items_misc.ts:372/395/1772`、`engine.ts:4286`、`energy_cards.ts:44`（感應【超】能量 附加 gate）
- **【草】（狠辣椒ex 會多出來）**：`engine.ts:9276`（`forestBypassBase`，繁茂森林 從手牌進化的 gate）
- **【鬥】（鐵轍跡＋驅勁能量 未來 會多出來）**：`six_decks.ts:412/439`、`engine.ts:5401`（`damageBoostFightingThisTurn`）、`engine.ts:10059`
- **屬性條件型防禦道具（雙向都吃）**：`effects.ts:1199/1201`、`engine.ts:8512-8515`（`defense.types` / `defense.holderTypes`）
- 其他同類但目前無差異：【惡】8 處、【鋼】9 處、【龍】7 處、【雷】7 處、【無】8 處、【水】3 處、【火】3 處。

⚠ **順手發現、本版沒動**：`engine.ts:8267` 陳舊的顎之化石｜威嚇之顎（-30）是按卡名手刻、
**沒有接特性消除閘** —— 化石在場上是【無】⇒ 火箭隊的監視塔應該消得掉它，現行消不掉。
與本版新增的盾之守護就在隔壁，屬同一族缺口，**列給站長裁定**。

⚠ **子代理審查另外實跑證明「現在就打得出來」的一個**（不需任何附加物）：
`v168_supporters.ts:104-118` 由紫「將自己的 1 隻【超】寶可夢恢復 150 HP」——
小碎鑽在場上是【鬥】＋【超】，但由紫**選不到它**（picker 開不出來）。同理
`engine.ts:4286` 神秘花園（數場上【超】）、`items_misc.ts:372/395` 奇跡修正檔。

### ⑧ 兩輪 opus 審查抓到、且已修的「守衛假綠 / 措辭誇大」

| 項目 | 審查判定 | 修法（都配了破壞測試複驗） |
|---|---|---|
| `8d` 正對照 | **安慰劑**：把 8c 的判準改成恆假（`sets=new Set(['FROZEN'])`）仍 43 全綠 —— 8d 只在 local 重做一次比對 | 判準抽成 `checkPrintParityFlags(cards)`，8d 真的把偽造樣本餵進去跑。破壞複驗：判準恆假 ⇒ **8d 紅** |
| `8b` 措辭 | **over-claim**：官方 tag filter 對 SVM/M5/MJ/M-P-J **零涵蓋** ⇒ 11 筆裡有 5 筆「官方沒列」是結構性恆真、零資訊量 | 標題降級成「不會點名這 11 筆」；補「MC 涵蓋 ≥40 筆」的**真**斷言（原本那行 `mcListed` 其實是 `listed∩全卡池`，與 MC 無關＝變數名說謊）；並斷言那四個卡包仍是 0 涵蓋（哪天有了要回來改寫說明） |
| `8e` strip | **窄假綠**：`'https://…'` 裡的 `//` 會讓同一行後面的真碼被當註解砍掉 | strip 先剝字串字面量再剝行註解；加正對照②（URL＋真碼同一行）與正對照③（純註解不得誤判）。破壞複驗：strip 退回舊版 ⇒ **8e 紅** |
| `5e` | 選卡條件（**存在某個**便宜招式）與實跑（固定 `attackIndex:0`）不一致 ⇒ 卡池漂移會靜默恆真 | 先 `assert.ok(r.dmg>0)` 確認招式真的打出去 |
| `7a` 標題 | 全程沒附「驅勁能量 未來」⇒ **鐵轍跡那條路徑零覆蓋**，標題卻像掃過三張 | 標題改成「兩張無條件雙屬性卡」；鐵轍跡由 v6.205 守衛 4b 負責 |
| `2b~2f` 標題 | 標〔核心〕誇大：BASE 的 `getAttackerEffectiveTypes` 本來就吃 inst、備戰也回雙屬性 ⇒ 全還原 BASE 時第②段只有 2a 紅 | 段標題改成「回歸鎖，非 HEAD-FAIL」，拿掉〔核心〕 |
| `7c` 對照能量 | 選磁鐵【鋼】的**前提**沒寫下來 | 註解寫明「全卡池沒有掛【鋼】能量的最大HP 特性」（實測成立），日後出這種卡會**假紅**不是假綠 |
| `effects.ts` 註解 | 寫「所有場上屬性比對的**唯一入口**」是假的（只接了 3 個消費點） | 改成誠實版並把仍有差異的清單寫進註解 |
| 首頁 changelog | 寫「擴大到**所有場合**」超出實作 | 改成照實列舉三個地方，並註明其他仍在逐步調整 |

⚠ **審查抓到但本版刻意不修**（G 標／需站長裁定）：
1. **「驅勁能量 未來」是 `Trainer/PokemonTool` 不是 Energy**（三個印刷 svhm 10091／SV8a 12436／SV5M 9906，
   **全部 G 標**），而 `hasIronTracksDualCore` 只掃 `inst.energyAttached` ⇒ 真實牌局掛在 `toolAttached`
   時二重核心**永遠不發動**；v6.204/v6.205 的 fixture 也是用 `energyAttached`，綠燈沒有證明力。
   站規只維護 H/I/J ⇒ 合法牌組打不出來。已加**絆線** 7e（印刷型態一變就紅）。
2. **逆境保險 holder 側的「弱點屬性」**：子代理實跑證明同一盤面引擎自己已認定弱點被改寫並吃了 ×2
   （火恐龍打 超級噴火龍Xex，掌握弱點把弱點改成【火】⇒ 40→80），逆境保險卻不抽 3 張。
   卡面只寫「弱點屬性」沒說算不算被改寫過的 ⇒ **交站長裁定**。
3. `engine.ts:8267` 陳舊的顎之化石｜威嚇之顎 沒接消除閘（同上）。


## v6.205 狠辣椒ex｜雙重屬性「完全沒實裝」補上（含消除閘）＋ 卡庫 tag 缺漏與三把 tag 尺

BASE = `113c63d5fc4767d0884be4d4c031c556ed1b92f0`（v6.204）。

### ① 狠辣椒ex｜雙重屬性 —— 這是**漏實作**，不是漏接閘

卡面（`static/cards/SV8.json` 11203／11473、`MC.json` 16618，H 標）：
「只要這隻寶可夢在場上，改為【草】與【火】2種屬性。」
`getAttackerEffectiveTypes`（`effects.ts:410`）自 v2.388 起**只認【小碎鑽】那一張**，
狠辣椒ex 的弱點／抵抗力永遠照印刷的【火】算 —— 不會報錯，只是靜靜地不生效。

修法：加一條分支回 `['Grass','Fire']`，判「特性此刻還在不在」沿用 **v6.204 剛收斂好的**
`_v6196HasEffAbilByInst`（= `defense.hasEffectiveAbilityByInst`，location 由它自己從 state 推），
**沒有新建第五份述詞**。

⚠ 狠辣椒ex 比小碎鑽多吃兩個消除來源（逐一行為端測 + 正對照）：

| 消除來源 | 對狠辣椒ex（Stage1 /【火】/ ex） | 對小碎鑽（Basic /【鬥】/ 非規則） |
|---|---|---|
| 傳說的熔岩洞（消進化） | **打得到** | 打不到 |
| 鐵荊棘ex｜初始化（消「擁有規則的寶可夢」） | **打得到** | 打不到 |
| passive 振翼髮｜暗夜羽擊 / 招式版 | 打得到 | 打得到 |
| 火箭隊的監視塔（只消【無】） | 打不到 | 打不到 |
| 海兔獸｜黏著束縛（只消備戰【2階進化】） | 打不到 | 打不到 |

**本輪刻意不做（風險過高，交站長裁定）**：卡面說的是「屬性改變」，但全站還有其他讀
`pokemonType` 的消費點會受影響 —— 子代理審查逐一 grep 出來的清單：
`effects.ts:5695` 土台龜ex｜森林行進（數自己場上【草】）、
`energy_cards.ts:92` 增強【草】能量 HP+20、
`tools.ts:367` 逆境保險（**自己手刻弱點比對、沒走中央 ⇒ 連小碎鑽/鐵轍跡都漏，是既有 bug**）、
`selection-filter.ts:296/318/322` 與 `ai.ts:721-728` 的 `Pokemon:<Type>` 場上篩選。
另外本函式只在**攻擊路徑**被呼叫 ⇒ 卡面「在場上」的備戰情境不生效。

### ② 卡庫 tag 缺漏

「古代／未來／ACE SPEC」**只存在於官方 card-search 的 list filter**，單張 detail 頁看不到
（`scripts/scrape/tag-filters.js` 開頭早已載明）。實抓（2026-08-17）：古代 116／未來 103／
ACE SPEC 52；三組 filter 名（pokemonTag/trainersTag/energiesTag）**只看 value**，回傳完全相同。

補了 6 筆（4 張卡）：

| id | 卡 | 依據 |
|---|---|---|
| 11641 SV8a 116/187 | 鐵轍跡 → 未來 | **官方 filter 直接列出** |
| 11648 SV8a 123/187 | 密勒頓 → 未來 | **官方 filter 直接列出** |
| 12405 / 12410 SV8a | 同上兩張的重複 id | 逐欄位核對：除 id/imageUrl/sourceUrl/scrapedAt 外**完全相同**（連 setCode 與收藏編號都一樣）|
| 9904 SV5M 063/071 | 重新啟動箱 → 未來 | 官方 filter 列了 MC 重印 17142，SV5M 這張漏；兩者 rulesText 逐字相同 |
| 17188 MC 717/742 | 探險家的嚮導 → 古代 | 同卡其餘 4 個印刷都有；官方 filter 對 MC 重印覆蓋不完整 |

⚠⚠ **官方 filter 的語意是單向的**：「官方說有 ⇒ 我方必須有」。反向不成立 —— 實測
官方 tag 清單只涵蓋 **16 個 live 卡包**，M 系列（M1L/M1S/M2/M2a/M3/M4/M5/M6/MJ/M-P-*）
與 SV9~SV11/SVM/SVOD/SVOM… 共 **26 個 live 卡包完全沒有任何 id 出現在官方 tag 清單裡**。

### ③ 三把尺（守衛 `scripts/test-v6205-chilispice-dualtype-and-tag-parity.mjs`，34 檢查）

- **尺 (a) 官方快照**：`scripts/data/official-tag-manifest.json`（新增，用
  `node scripts/refresh-official-set-manifest.mjs --tags --write` 重抓）。官方說有 ⇒ 我方必須有。
  ⚠ 加了「比對筆數 ≥200」下限 —— 沒有這條，卡池載入壞掉時它會靜默全綠。
- **尺 (b) 印刷平權**（純離線）：同 supertype＋卡名＋HP＋特性集合＋招式集合＋rulesText 的
  不同印刷，tags 必須完全一致。這是補官方 filter 對合集重印覆蓋不完整的那把尺。
- **尺 (c) 同名平權**（純離線，新增）：同一隻寶可夢（supertype=Pokemon＋同 name）的所有卡，
  「古代／未來」必須一致（物種固有屬性）。⚠ 只限這兩個 tag：「太晶／ACE SPEC／訓練家冠名」
  是**印刷**屬性，同名寶可夢可以只有某些版本是太晶。

尺 (c) 現況抓到 **5 組／11 筆缺口，本輪刻意不補**（凍結進 `NAME_TAG_GAPS`，交站長裁定）：
密勒頓 19235/19171/16754/18373、密勒頓ex 16755/18259、故勒頓 19189、
故勒頓ex 16896/18272/12142、鐵脖頸 12419（G 標）。
**不擅自補的理由**：這些卡包官方 tag filter 零覆蓋 ⇒ 沒有官方依據；而且
鐵荊棘ex｜初始化 的卡面是「擁有規則的寶可夢（『未來』寶可夢除外）」——
替 密勒頓ex／故勒頓ex 這種 ex 補上 tag ＝**直接改變「初始化消不消得掉它」的規則判定**。

### ④ 維度 A：「卡面有效果但完全沒實裝」的 H/I/J 卡（本輪全站掃描結果）

招式層 0 未實裝（`coverage-unimplemented.mjs` 權威 map 比對：1771 註冊 key vs 1687 有 effect 招式）；
非 Stadium 的 H/I/J Trainer 242 張全部有 `TRAINER_EFFECTS` 註冊；Energy＋Stadium 59 個卡名全部在 src 出現。
特性層以「特性名的所有出現點是否都被硬綁到別張卡名」為判準，收斂後只剩兩張：

1. **狠辣椒ex｜雙重屬性** —— 本版已補。
2. **陳舊的盾甲化石｜盾之守護**（M5 19216，J）—— 卡面「只要這隻寶可夢在戰鬥場上，自己的
   所有寶可夢受到對手的寶可夢招式的傷害「-10」點。」**全站零實作**：卡名只出現在
   `FOSSIL_ITEM_NAMES`（engine.ts:919）與 `FOSSIL_NAMES_LOCAL`（items_misc.ts:1873）
   兩張「可放置成寶可夢」的名單裡。青銅鐘｜守護之鐘 是同數值但條件為「**在場上**」，
   條件不同不能沿用 ⇒ **待站長決定是否補**（已凍結進 `KNOWN_UNIMPLEMENTED`）。

其餘 7 個候選逐一查證後判定為**有實裝、只是按卡名而非按特性名**，放進
`ADJUDICATED_IMPLEMENTED`（附實作位置）：伊布ex｜虹色DNA、勒克貓｜鬥志戰吼、
陳舊的羽毛/背蓋/頭蓋/顎之/鰭之化石各自的特性。

⚠ **這把尺的能力邊界已寫進守衛檔頭**：它抓得到「完全沒接線」與「被別張卡壟斷」，
**抓不到**「有接線但實作被改壞／變死碼」（審查實測：291 個「已實裝」中約 69% 有 ≥2 個
無卡名綁定的出現點，刪掉實作也不會紅）。所以 7c 另外加了一條**行為端**複核。

### ⑤ 兩輪 opus 審查抓到、且已修的「守衛假綠」

| 項目 | 審查判定 | 修法 |
|---|---|---|
| 5c / 6c 正對照 | **恆真式**：把 5b/6b 判準改成 `if(false)` 仍全綠 —— 兩條只在自己 local 重做一次比對 | 判準抽成 `checkTagManifest(poolLike)` / `checkParity(groupsLike)`，正對照餵**壞資料副本**進去真的跑判準（破壞測試 E2/E3 已證會紅）|
| ④ 段差分 | **死碼＋虛胖**：`oldTypes`/`_oldEff`/`_probe`/`_oldTracks` 全檔零呼叫，且 `exp=now` 讓小碎鑽/鐵轍跡零覆蓋 | 刪死碼；標題改成誠實的「全卡池只有這三張偏離印刷屬性」；期望值**逐一釘死字面量**；加 `hitDual` 斷言兩張雙屬性卡都真的被走到；另立 4b 釘死鐵轍跡三態 |
| 3c | 用同一份公式回算期望＝自證 | 期望值釘死 `170`，並先斷言對照靶卡面是「弱點【火】×2／抵抗力【草】-30」|
| 5b | 卡池壞掉時 `if(!c) continue` 會靜默降成零覆蓋 | 加「比對筆數 ≥200」下限 |
| 7c | 只驗字串在不在，分支變死碼仍綠 | 追加行為端複核（破壞測試 E1 已證會紅）|

### ⑥ HEAD-FAIL / 破壞測試（逐項還原、確認會紅、腳本自身跑得完）

| 破壞 | 結果 |
|---|---|
| effects.ts 還原 BASE | 9 FAIL（2a/2f/3a/3c/3d/3e/7a/7c/7d）|
| 分支保留字面量但變死碼 `_dead6205=false` | 8 FAIL（含 4a、7c 行為端）|
| **加了分支但拿掉消除閘** | 6 FAIL（2b/2c/2d/2e/3d/3f）⇒ 證明閘不是裝飾 |
| SV8a.json / SV5M.json / MC.json 各自還原 BASE | 2 / 1 / 1 FAIL |
| 刪掉 official-tag-manifest.json | 3 FAIL |
| 5b 判準 `if(false)` / 6b 判準 `sets.size>99` / 8b 判準 `if(false)` | 5c / 6c / 8a+8c 各自紅 |
| KNOWN_UNIMPLEMENTED 清空 | 7d FAIL |

### ⑦ 順帶：v6.204 守衛 0c 的斷言反轉（金絲雀）

`test-v6204-…:142` 原本斷言「至少一張鐵轍跡印刷**缺**未來 tag」（當時作者刻意留的缺口提醒）。
tag 補齊後它會紅 —— 改成「三張都要有」，並在註解重申：**讓初始化打不到鐵轍跡的理由
從來不是 tag，是「它不是擁有規則的寶可夢」**（`isInitializeNullified` 第一道就擋掉）。
`v2999_g3_wave1.ts` 內同一段過時註解一併更新。


## v6.204 passive 特性消費點沒接「特性消除」中央閘 —— **要改函式簽名**的那一組（v6.202 的 C 段整段做完）

BASE = `201cdec92dcfdd28d3f0a4fe153e06acdc663abd`（v6.203）。
用的是 v6.196 既有中央 helper（`isAbilityHolderEffective` / `hasEffectiveAbilityByInst` /
`hasAbilityOnSide` / `hasAbilityOnActive`），**沒有新建第五份述詞**。

### ⭐⭐⭐ A. 最優先：兩份免疫實作的漂移收斂（直接影響傷害結算與勝負）

`engine.ts` 主傷害管線（戰鬥位，5634/5662 行）從 v5.471 起就**逐個特性**過
`isAbilityHolderEffective`；而 `effects.ts` 的 `passiveImmunityDamageBlock` /
`passiveCoinImmunity`（`resolveBenchGuard`／狙擊／多目標／UI 預覽共用）只**手刻**了
「初始化」＋「火箭隊的監視塔」兩個來源，擲幣那份**連初始化都沒有** ⇒ 同一張卡在兩條路徑上
對「特性還在不在」給出不同答案。

| 特性（持有者，static/cards 逐字） | stage / type / subtype | 漏掉的消除來源 |
|---|---|---|
| 神秘石居（岩殿居蟹） | Stage1 /【草】 | **熔岩洞**、暗夜羽擊兩型 |
| 全能硬殼（肋骨海龜） | **Stage2** /【水】 | **熔岩洞**、**黏著束縛**、暗夜羽擊兩型 |
| 璀璨鱗片（美納斯ex） | Stage1 /【水】/ ex | **熔岩洞**、暗夜羽擊兩型 |
| 尾甲（奇麒麟ex） | Stage1 /【惡】/ ex | 同上 |
| 神秘守護（仙子伊布） | Stage1 /【超】 | 同上 |
| 礎石之勢（厄鬼椪 礎石面具ex） | Basic /【鬥】/ ex | 暗夜羽擊兩型 |
| 順滑大衣（奇諾栗鼠ex，擲幣型） | Stage1 /【無】/ ex | **熔岩洞、初始化**、暗夜羽擊兩型（監視塔本來就有） |

⚠ **子代理審查在這張表上判錯過一次，記下來免得下次重犯**：它說「`PASSIVE_IMMUNITY` 的
Map 字面量裡沒有全能硬殼 ⇒ 這一列是錯的」。實際上**全能硬殼是在 `registerV3060DeferredWaveBPassives()`
裡用 `PASSIVE_IMMUNITY.set('全能硬殼', …)` 掛進去的**（Iron Rule 12：對 effects.ts 的 Map 做 set
一律包進 register fn 以避 TDZ）—— 只讀字面量會看不到。守衛 `1c/1d/1f` 是行為端實跑，
`1d` 正對照拿到的 reason 就是「全能硬殼（不受對手該寶可夢招式的傷害）」。
⚠ `PASSIVE_IMMUNITY` 另有「神秘之盾」（堅盾劍怪），但它只印在 **G 標** SV8a 12400
（M3 18034 那張 J 標的堅盾劍怪**沒有特性**）⇒ 不在 H/I/J 維護範圍，刻意不列。

修法：兩支的簽名各插入一個**必填**的 `targetInst: CardInstance`，內部刪掉 inline 的
初始化／監視塔手刻，改逐個特性問 `_v6196HasEffAbilByInst`（＝`defense.hasEffectiveAbilityByInst`，
location 由它自己從 state 推 —— 呼叫端自己算 location 正是 v6.202 抓到的另一個 bug 源頭）。
`resolveBenchGuard` 的 `opts` 一併改成**必填**並帶 `targetInst`（TS 逼所有呼叫端回來補），
4 個呼叫端（`defense.ts:355` / `effects.ts:1440` bench-hit-N / `effects.ts:4451` 死碼
`manualDamageImmunity` / `effects.ts:7136` 精刺奇襲）逐一確認都握有場上實體。
`manualDamageImmunity` 全 `src/` **零呼叫端＝死碼**，簽名一併收斂（行為零變化）。

### B. 雙重屬性／二重核心（弱點・抵抗力比對）

`getAttackerEffectiveTypes` 加 `state / attackerIdx`（2 個呼叫端：`effects.ts applyWeakRes`、
`engine.ts:5447`，兩處都握有 state 與 actorIdx）；`hasIronTracksDualCore` 加 `state / ownerIdx`
（唯一呼叫端就是前者）。

- 小碎鑽 = Basic /【鬥】/ 非規則 ⇒ 熔岩洞・監視塔・初始化・黏著束縛都打不到，只有暗夜羽擊兩型。
- 鐵轍跡 = Basic /【鋼】/ **非規則寶可夢** ⇒ 熔岩洞・監視塔・初始化・黏著束縛全部打不到，
  同樣只有暗夜羽擊兩型。（守衛 3f 是這條的**正對照**：初始化在場時仍必須是【鬥】＋【鋼】，
  而且**逐印刷**各跑一次。）
  ⚠ **不可**拿「tags 含『未來』」當理由 —— 子代理審查抓到：「未來」tag 只印在 SV5M 9892，
  **SV8a 11641／12405 兩張現役 H 標印刷完全沒有 tags 欄位**（卡庫資料缺口，另列給站長）。
  ⚠ 另：`hasIronTracksDualCore` 的 location 原本硬寫 `'active'`，本版改成從 state 推
  （與小碎鑽那條對稱），避免日後呼叫端變動時兩條給出不同答案。

⚠ **順手發現、本版沒動**：`getAttackerEffectiveTypes` 只實作了**小碎鑽**的雙重屬性，
**狠辣椒ex｜雙重屬性**（卡面「只要這隻寶可夢在場上，改為【草】與【火】2種屬性。」SV /H）
**完全沒有實裝** —— 那是「漏實作」而不是「漏 gate」，屬另一個維度，列給站長裁定。

### C. 其餘 8 項（全部完成）

| helper | 新簽名 | 呼叫端 | 可達的消除來源 |
|---|---|---|---|
| `isConfusionImmune` | `(state, ownerIdx, inst, pool)` | 5（`statusPost`／`applyStatusToOppActive`／`applyStatusToSelfActive`／`coinStatusPost`／`m5_preview` 暗黑鈴） | 呆呆獸 Basic/【超】⇒ 只有暗夜羽擊兩型 |
| `isSleepImmune` | 同上 | 4 | 咕咕 Basic/**【無】** ⇒ ＋**監視塔** |
| `isImmuneToOppTrainer` | `(state, ownerIdx, targetInst, pool)` | 9（v3080 `isImmuneToOppSupporter`／items_misc ×4／effects ×4） | 斧牙龍 Stage1 ⇒ **熔岩洞**；浩大鯨ex Stage1+ex ⇒ ＋**初始化** |
| `getOppTrainerImmunityAbilityName` | 同上 | 0（死碼，順手同步以免復活時漏 gate） | 同上 |
| `hasArchaeoglobinDiveMemory` | `(state, ownerIdx, pool)`（原本收 `PlayerState`） | 1（`engine.ts:8915`，該處已算出 ownerIdx） | 古空棘魚 Basic/【鬥】⇒ 暗夜羽擊兩型（原碼只手刻了 `abilityNullifiedThisTurn`，**漏 passive 振翼髮**）。改走中央 `hasAbilityOnSide` |
| `hasMeloettaExDebut` | `(state, ownerIdx, pool)` | 2（`engine.ts:4901 ATTACK` ／ `9126 getAvailableAttacks`，兩處都是該玩家 active） | 美洛耶塔ex Basic/【超】/**ex** ⇒ **初始化** ＋ 暗夜羽擊兩型。改走中央 `hasAbilityOnActive` |
| `resolveInfiniteShadowKo` | `(koInst, pool, eligible, state, ownerIdx, location)` | 4（`engine.ts:5932` 主管線／`effects.ts` hitBenchAll・bench-hit-N・`dealAttackDamageToTarget`） | 耿鬼 **Stage2**/【惡】⇒ **熔岩洞**、**黏著束縛**（備戰）、暗夜羽擊兩型（戰鬥場） |
| `hasShellinkEvolveBypass` | `(baseCard, baseInst, state, ownerIdx, pool)` | 3（全在 engine.ts：`EVOLVE` ×2 ＋ `getEvolvableTargets` UI） | 小嘴蝸／蓋蓋蟲 Basic/【草】⇒ 只有暗夜羽擊兩型 |
| `_dcSelfDiver`（`fireDefenderOnKO` 內） | 就地加 gate（用該函式既有的 `isActive` 當 location） | 1 | 獵斑魚 **Stage1**/【水】⇒ **熔岩洞** ＋ 暗夜羽擊兩型 |

**兩個 v6.202 說「需先裁定」的，本版查證後認為沒有歧義**：
`resolveInfiniteShadowKo` 與 `_dcSelfDiver` 的疑慮是「KO 當下持有者是否還算在場上」，
但**這三個可達來源（熔岩洞／黏著束縛／暗夜羽擊）全是持續性場上效果** ——
在這一擊命中**之前**特性就已經被消除，時序問題根本不成立。
⚠ 兩處的持有者在呼叫時可能**已被呼叫端移出場**，所以**不可**讓中央述詞自推 location：
`_shared.ts` 新增一個**指定 location** 的注入點 `setAbilityHolderEffectiveAtFn`
（Check O：`_shared.ts` 不能 import `v3001`／`defense`），與既有 `setAbilityHolderEffectiveFn`
一樣轉接到同一支 `isAbilityHolderEffective`，**不是第五份實作**；
`_dcSelfDiver` 在 `effects.ts` 內，直接用 `isAbilityHolderEffective` ＋ `isActive`。

`hasShellinkEvolveBypass` 的 **partner 那一段刻意不加 gate** —— 卡面只寫「若自己的場上有
『蓋蓋蟲』」，沒有要求 partner 也持有特性 ⇒ 只有「這隻寶可夢」（＝base 持有者）要問中央閘。

### D. 結構上不可達／刻意不改（沿用 v6.202 的判定，本版未動）

`岩石宮殿`（大吾的小碎鑽，卡面限備戰區）、`藏隱`／`深度下潛`（同型）、
`engine.ts` 冰冷之帳的化隱、`m6_wave8` 大洋增輝／深海抽出（上游 `getUsableAbilities` 已過閘）、
`hasEffectShield`（皇帝之勢，死碼）、`hasAbilityOnBench`（**黏著束縛偵測本體，加 gate 會無窮遞迴**）。

### 守衛 `scripts/test-v6204-passive-ability-gate-signatures.mjs`（63 檢查）

①卡面逐字錨：16 個持有者的 `stage`/`pokemonType`/`subtype` 逐一釘死（那正是「哪些來源打得到它」
的唯一依據）＋ 5 個消除來源的 `rulesText`/`effect` 逐字 ＋ 14 條特性 `effect` 逐字
＋ 28 張依賴卡的下限斷言（抓不到就紅，不做安慰劑綠燈）。
②行為端逐項：**消除 ⇒ 失效** 與 **正常 ⇒ 仍生效** 成對出現（含「監視塔只消【無】、
黏著束縛只消備戰 2 階、初始化不消『未來』」三條**方向性正對照**，防改過頭）。
③差分實跑：舊述詞逐字轉錄自 BASE。`passiveImmunityDamageBlock` **3168 組**盤面
（11 個防守者 × 6 個攻擊者 × 3 種競技場 × 攻方特殊能量 × `abilityNullifiedThisTurn` ×
海兔獸在不在 × active/bench）—— **沒有任何消除來源在場的 mismatch = 0**，
帶來源的 mismatch = 460（分佈逐項印出，每一筆都對應到至少一個消除來源）；
`getAttackerEffectiveTypes` 48 組，乾淨 mismatch = 0、帶來源 12。
④`hasAbilityOnBench` 例外：行為端證明黏著束縛仍生效且不爆堆疊，靜態端斷言它**維持沒有 gate**
（並附正對照證明判準抓得到違規）。
⑤靜態：兩支免疫實作**必須**呼叫中央述詞且**不得再出現** `ROCKET_WATCHTOWER_STADIUMS` /
`isInitializeNullified` 的 inline 手刻（附違規樣本正對照）；所有呼叫端不得傳 `undefined/null`；
`_shared.ts` 不得反向 import `defense`／`v3001`。

**HEAD-FAIL（逐項破壞測試，腳本 `/tmp/destroy2.py`）**：把 **13 個 gate ＋ 6 個「接線」逐一**
改回錯的寫法重跑 v6204＋v6202 兩支守衛：

| 破壞項 | 亮紅數 | 破壞項 | 亮紅數 |
|---|---|---|---|
| A 免疫傷害閘 | 7 | G 無限之影閘 | 5 |
| A2 免疫擲幣閘 | 6 | G2 **注入點沒接上** | 4 |
| B 雙重屬性閘 | 3 | H 刺激進化閘 | 2 |
| B2 二重核心閘 | 3 | I 潛者捕捉閘 | 3 |
| C 憨憨臉閘 | 3 | W1 defense 傳錯 targetInst | 1 |
| C2 不眠閘 | 2 | W3 緊張感 location 硬寫 active | 1 |
| D 緊張感／融合為雪閘 | 6 | W4 潛者捕捉 location 硬寫 bench | 1 |
| E 潛入記憶閘 | 2 | W6 除蟲噴霧 regG 傳錯 idx | 1 |
| F 出道演出閘 | 3 | | |

全部正對照維持綠、還原後 0 紅 ⇒ 證明它們不是恆真式。

**兩輪 opus 子代理審查抓到的（已全部處理）**：
1. ⚠ **假綠**：`1g` 原本把鐵荊棘ex 放成**攻擊方**，但璀璨鱗片要求攻擊方是**太晶**
   ⇒ 兩邊都回 false、斷言恆真。已改成「攻擊方維持太晶、鐵荊棘ex 放防守方戰鬥場、
   美納斯ex 放防守方備戰」，還原 gate 後才會紅。
2. ⚠ **接線零覆蓋**（第二輪抓到，本檔已補 `5e`/`5f`/`5g`/`5h`/`10d` 五條）：
   `defense.ts` 的 `targetInst`、`items_misc` regG 的 ownerIdx、`isImmuneToOppTrainer`
   與 `_dcSelfDiver` 的 location 推導，原本改壞了**一條測試都不會紅**。
   `5e`/`5h` 改成真的從 `TRAINER_GUARDS` 取出 regG 來跑（原本只是自己重寫 filter，
   還留了一行 `assert.ok(g===undefined||true)` 的恆真死碼）。
3. ⚠ **`hasIronTracksDualCore` 的 gate 被註解推離特性名字面量 9 行**
   ⇒ v6.202 枚舉守衛（±8 行視窗）判成沒接閘、20d 亮紅。已把 gate 上移緊貼字面量；
   隨之「驅勁能量 未來」那行又落回 ±6 行 abilities 視窗 ⇒ 豁免條目照 BASE 補回（**非**特性名）。
4. **兩個破壞後仍 0 紅、查證後判定為結構上測不出來，刻意不硬湊測試**：
   ・`W2` 頂尖捕捉器/寶可夢捕捉器/反擊捕捉器 regG 的 ownerIdx —— 目標永遠在**備戰**，
     而 緊張感／融合為雪 可達的來源（熔岩洞・初始化）都與持有者屬於哪一方無關，
     且備戰 inst 永遠推不出 `'active'` ⇒ 傳錯也做不出行為差異。已改用**戰鬥場**目標的
     除蟲噴霧（`5h`/`W6`）覆蓋同一支述詞的 ownerIdx 接線。
   ・`W5` `hasIronTracksDualCore` 的 location —— 唯一呼叫端 `getAttackerEffectiveTypes`
     拿到的一定是該玩家的 active。仍改成推導而非硬寫，只是測不出差異。
5. 第一輪的兩條指正經自行查證後**不成立**，已寫進上面 A 段的警語（`PASSIVE_IMMUNITY` 的
   全能硬殼是用 register fn `.set()` 掛進去的、神秘之盾只印在 G 標），另外三條（鐵轍跡
   「未來」tag 缺口、location 不對稱、狠辣椒ex 未實裝）已採納或列給站長。

### v6.202 枚舉守衛同步更新
GATE_RE 加入 `_abilityHolderEffectiveFnLoc`；**豁免表刪掉 17 個死條目**（C 段整段做完）；
`20c` 的標題與斷言對齊（≥63）；`20b` 的 pattern1 下限 55 → 50（本版把 6 支 helper 的字面量整段換成中央述詞呼叫，
是消費點消失、不是掃描器變瞎；20f~20k 六條掃描器自我驗證仍釘住掃得到違規樣本），
`20c`「已接閘」下限 55 → 63。

### 部署
`update-tournament.bat`（卡效果／引擎改動）、`update-admin-full.bat`（admin.html 版本提示）。
`redeploy-oracle.bat` 本版**不需要**（沒動 `server_admin_patch.js`）。

## v6.203 進化來源比對被過度放寬（sameEvoName 被誤用成進化 gate）

**回報**：玩家可以把伊布ex 直接進化成葉伊布 —— 連**沒有**特性【虹色DNA】的
「伊布ex（M-P-J · 172/M-P · J 標）」也可以。

**站長裁定（2026-08-17，逐字）**：
> 「伊布ex 如果特性有【虹色DNA】是可以進化為葉伊布的，但如果沒有這個特性就不能進化，
>  例如 伊布ex M-P-J · 172/M-P · J 這張就不能進化。」

### 真因
`_shared.ts` 的 `sameEvoName()` 會把卡名尾端的 `ex`、開頭的「超級」strip 掉：
- `stripEx` 是 **v2.35（f69808f7）** 由前一位 AI 引入的，註解寫
  「PTCG 規則：ex 和非 ex 同名卡是同一進化階級。例：伊布 / 伊布ex 都是 Basic，
   兩個都可進化為 火伊布ex」—— **那句規則是錯的**（若成立，【虹色DNA】這個特性就沒有存在意義）。
- `超級` prefix strip 是 **v5.307（bb02b985）** 加的；那個 commit 真正的修正其實是**資料**
  （M5.json：超級龍頭地鼠ex.evolvesFrom 龍頭地鼠ex → 螺釘地鼠），
  prefix strip 是為了「超級XXXex / XXXex / XXX 同階」這條**stage 分類**規則。

engine.ts EVOLVE handler 用 `sameEvoName(evoCard.evolvesFrom, baseCard.name)` 當進化 gate ⇒
`sameEvoName('伊布','伊布ex') === true` ⇒ 標準路徑一定先命中，
卡面【虹色DNA】的例外分支（`prismaticDNAException`）**永遠走不到**
（v6.202 曾把它記成死碼並寫進豁免表 —— 它其實本來就寫對了，只是被上游蓋掉）。

### 官方依據
- `PTCG RULES/PTCG_RULES.md` §6 L305/L307/L315：
  「將進化卡重合至與左上方記載的進化前寶可夢**相同名稱**的寶可夢身上完成進化後，即可放置於場上。」
- 同檔 §17.45.I：「『達摩狒狒』和『N的達摩狒狒』視為兩種不同名稱的寶可夢。」
⇒ 進化來源比對必須**逐字**。

### 修法（分界判準）
**超級進化該放行、一般進化不該放行 的分界不在字串正規化，而在卡面資料本身。**
枚舉全 live H/I/J：每一張進化卡（含 47 張「超級XXXex」）的 `evolvesFrom` 都**逐字**對得到
一張實際存在的前階卡名（超級呆殼獸ex→呆呆獸、超級龍頭地鼠ex→螺釘地鼠、超級大竺葵ex→月桂葉…；
唯 9 筆化石指向 Item 卡名，同樣逐字命中）。
⇒ **逐字比對足以支撐全部合法進化，包含超級進化**；正規化只會多放行卡面不允許的組合。

- 新增中央述詞 `canEvolveOnto(evolvesFromName, baseCardName)`（`_shared.ts`，逐字）。
- 手牌路徑再包一層 `canEvolveFromHandOnto(state, ownerIdx, baseInst, baseCard, evoCard, pool)`
  （`engine.ts`，**唯一** 例外＝虹色DNA）。EVOLVE handler 與 `getEvolvableTargets`（黃框/AI）共用。
- 虹色DNA 例外三條件：`evolvesFrom === '伊布'` ＋ `evoCard.subtype === 'ex'`
  ＋ **`hasEffectiveAbilityByInst(...,'虹色DNA')`**（伊布ex 是【無】屬性，
  火箭隊的監視塔／暗夜羽擊打得到它 —— 特性被消除就不該還能進化）。
- ⚠ `sameEvoName` **原封不動**（stage 分類 / 神奇糖果鏈結推導仍靠它；動它會打壞超級進化同階判定）。

### 跨卡 audit（維度＝「進化來源比對被過度放寬」）
data-driven 枚舉全 live H/I/J：`evolvesFrom` 與場上卡名「逐字不同、正規化後相同」的組合共 **5 組**：

| 場上（舊 gate 誤放行） | 進化卡 |
|---|---|
| 伊布ex | 葉伊布/葉伊布ex/火伊布ex/水伊布ex/雷伊布ex/冰伊布(ex)/仙子伊布(ex)/太陽伊布ex/月亮伊布ex（11 個卡名） |
| 喵喵ex | 貓老大 |
| 新葉喵ex | 蒂蕾喵 |
| 皮卡丘ex | 雷丘 |
| 超級花葉蒂ex | 花潔夫人 |

同一份誤用散在 8 個檔 12 個消費點，全部收斂：
engine.ts EVOLVE / getEvolvableTargets、v2650（雙卵細胞球｜細胞進化 ×2、細胞覺醒、
火箭隊的尼多娜｜惡之覺醒）、v2360（小木靈｜怨恨進化 ×2）、v172（壯偉碩木 ×2）、
effects.ts（神奇糖果 regG / reg / resolver 的「場上基礎目標」比對 ×3）、
ai.ts ＋ +page.svelte（`EvilAwakening:EvolveFrom` filter 的 inline stripEx —— 顯示端必須 === 能勾端）。

**反向（該放行卻被擋）＝ 0**：守衛 3b 逐一實跑全站 **300+ 條** evolvesFrom 進化線
（含 4b 的 47 張超級進化 ×24 組），全部仍 `ui && engine` 為真。
唯一排除項是【海豚俠ex｜全能靈魂】（v5.342 卡面「只能由『全能變身』放上場」，本來就不可一般進化）。

### 守衛
`scripts/test-v6203-evolve-source-exact.mjs`（27 步）；HEAD（c9700bb）跑 **12 FAIL**，修後 0 FAIL。
含：卡面逐字錨、有/無虹色DNA、ex/非ex、特性被消除、全站進化線正對照、超級進化正對照、
違規組合 data-driven 枚舉、神奇糖果／細胞進化 牌庫路徑、
以及靜態守衛「`sameEvoName` 呼叫點第一參數必須是 `X.name`（＝stage 分類用途）」＋掃描器正對照。
v6.202 的豁免表死條目（engine.ts|虹色DNA）同步刪除（20e 會抓）。

### 審查子代理（opus）抓到、已修的兩點
1. **守衛 5b 的「應放行」正對照是死碼**：`nameToIds.get('伊布ex')[0]` 取到 **19383（沒有虹色DNA 那張）**，
   ⇒ 51 筆 violations 裡 `dnaOk===true` 命中 **0** 筆，5b 實質只剩否定分支。
   已改成枚舉**同名的每一張印刷**，並新增 `5a2` 斷言「兩支分支都要真的跑到」（allow≥4 / deny≥20）。
2. **另有 5 處 evolve-source 比對行為已逐字、但沒收斂到中央述詞**（7b 只凍結 `sameEvoName`，管不到它們）：
   `effects.ts` 賽吉 ×4 ＋ 自我進化 deck-search factory ×2、`v2750_h_wave2_full.ts`（蛋蛋）×2、
   `engine.ts:9863`（怨恨進化的 promptPlayAbilities gate，與 v2360 的 regA resolver 是兩份）。全部改 `canEvolveOnto`。

另自查抓到一個**測試鏈抓不到**的坑：`+page.svelte` 用了 `canEvolveOnto` 卻沒加進
`import … from '$lib/game/engine'` —— 這種只有 vite build 才會炸（v6.095 事故同型）。
已補 import，並加守衛 `7d2`（拿掉 import 實測會 FAIL）。

### 驗證
完整 `npm test` 521 步全綠（沙盒分 12+ 批跑）；`npx tsc -p` 新 TS2304 = 0；`test-ts2304-scan` 綠；
四張免疫網（damage 25 / attack-effect 19 / selection-ui 35 / selection-candidates 8）全綠；
`+page.svelte` svelte compile warning 數與 HEAD 相同（98 → 98）；`build-server-engine` 產出成功。

### ⚠ 待站長裁定
站長那句「可以進化為**葉伊布**」與卡面逐字「從「伊布」進化而來的『寶可夢**【ex】**』」不一致。
本版**依卡面**實作：有虹色DNA 的伊布ex 只能進化成**【ex】**（葉伊布ex 可、葉伊布不可）。
若站長的意思是非 ex 也可以，改 `engine.ts canEvolveFromHandOnto` 內
`if (evoCard.subtype !== 'ex') return false;` 一行即可（守衛 2e 需同步改）。

## v6.202 passive 特性消費點沒接「特性消除」中央閘 —— 清掉「不必改簽名」的那組（14 個特性／20 個消費點）

v6.201 C 段掃出 38 處沒接閘的消費點並列了待辦清單。本版只做**不必改函式簽名**的那組。
用的是 v6.196 的既有中央 helper（`hasEffectiveAbilityByInst` / `isAbilityHolderEffective`），
**沒有新建第四份述詞**。

### A. 本版修好的消費點（8 個特性 / 13 處）

| 消費點（BASE 24cc81b） | 特性（持有者） | 打得到它的消除來源 |
|---|---|---|
| `engine.ts:2026 hasFestivalDanceActive` | 祭典樂舞（裹蜜蟲 Stage1／角金魚 Basic／金魚王 Stage1／綿綿泡芙 Basic） | 招式版暗夜羽擊、passive 振翼髮 |
| `engine.ts:2042 _isFestivalDanceFirstAttack` | 同上 | 同上 |
| `effects.ts:8045 _isFestivalDanceFirstAttackLocal` | 同上（effects 不能 import engine 的本地複製） | 同上 |
| `engine.ts:10156` 衝衝鼓 gate | 祭典樂舞（**跨隻**讀戰鬥位） | 上述 ＋ 監視塔／熔岩洞（partial → full） |
| `lopunny…:111` 衝衝鼓 regA | 同上 | 同上 |
| `engine.ts:3501` EVOLVE handler | 提升進化（伊布 Basic **Colorless**） | **火箭隊的監視塔**、暗夜羽擊兩型 |
| `engine.ts:9182` getEvolvableTargets | 提升進化（UI 鏡射，與上一列同 commit） | 同上 |
| `engine.ts:8404` | 同步脈衝（電龍 **Stage2**） | **傳說的熔岩洞**、暗夜羽擊兩型 |
| `_shared.ts:623 hasOakEye` | 監視之眼（探探鼠 Basic Colorless） | 暗夜羽擊兩型（監視塔原本已 inline，改走中央） |
| `ai.ts:1308` | 監視之眼（AI 的**第二份**判定，整段刪掉改呼叫中央述詞） | 同上 |
| `_shared.ts:2219 hasMultiToolRelay` | 多重轉接（洛托姆ex Basic **ex**） | **初始化**、暗夜羽擊兩型（原本**完全沒有** gate） |
| `v2999…:171 curlWallReduce` | 捲牆（爆炸頭水牛 Basic Colorless） | 暗夜羽擊兩型 |
| `v3080…:127 hasBroadFortressOnActive` | 廣域堡壘（超甲狂犀 **Stage2**） | **傳說的熔岩洞**、passive 振翼髮（原本只擋 abilityNullifiedThisTurn） |

⚠ **祭典樂舞打不到熔岩洞**：祭典樂舞的成立條件是場上有「祭典會場」，兩張都是競技場卡、
`state.activeStadium` 只有一格 ⇒ 不可能同時在場。它的可達來源只有暗夜羽擊兩型（持有者必在戰鬥場）。

### A-2. 子代理審查補抓的第二批（掃描器**結構上看不到**的兩類措辭）

我第一版的掃描器只認「`abilities` 與 `.name === '…'` 在**同一行**」，於是
**多行 for-of**（`for (const a of card.abilities) { if (a.name === 'X') … }`）與
**registry 查表**（`PASSIVE_XXX.get(ab.name)`，根本沒有 `.name ===`）兩大類完全隱形。
子代理用別的措辭變體重掃 + harness 實跑，抓出下面 6 處（全部同樣不必改簽名，本版一併修）：

| 位置 | 特性（持有者） | 打得到它的消除來源 |
|---|---|---|
| `engine.ts:5143 PASSIVE_ATTACKER_BUFF` ＋ `effects.ts:16597` 的 regPre wrapper | 藏青浪濤（波盪水ex，Basic ＋ **ex**） | 初始化、暗夜羽擊兩型 |
| `engine.ts:5811 PASSIVE_PREVENT_KO`（主傷害管線） | 結實（岩殿居蟹 **Stage1**）／勤奮之心（皮卡丘ex）／堅忍之軀（超級摔角鷹人ex）／不朽之軀（棄世猴） | **熔岩洞**、初始化、暗夜羽擊兩型 |
| `effects.ts:8240 applyPreventKOToVictim`（狙擊／延後傷害的第二份） | 同上 | 同上（＋備戰 Stage2 的黏著束縛） |
| `effects.ts:364 hasFairyZoneField` | 妖精領域（莉莉艾的皮皮ex，Basic ＋ **ex**） | 初始化、暗夜羽擊兩型 |
| `_shared.ts:830 OPP_ENERGY_ATTACH_PASSIVE` | 侵蝕詛咒（耿鬼ex，**Stage2 ＋ ex**） | **熔岩洞**、初始化、暗夜羽擊兩型、黏著束縛 |
| `mega_decks.ts:595 PASSIVE_ATTACK_BONUS` | 大晴天（裙兒小姐 **Stage1**）等 | **熔岩洞**（effects.ts:8149 的同一段早就有閘，這份漂了） |

⚠ **藏青浪濤有兩份實作**：`PASSIVE_ATTACKER_BUFF` entry ＋ `regPre('波盪水ex|宣洩吼嘯')` 的
wrapper 直接硬寫 `skipDefEffects: true`。**只修 registry 那份會被 wrapper 蓋回去**
（波盪水ex 只有這一招 ⇒ wrapper 才是實際生效的路徑）——兩份都接了才有行為差異，
守衛 15b 驗的就是 wrapper 那條；registry 那份的覆蓋來自枚舉守衛（20d）。

⚠ **順手修好的一個 bug（子代理實跑證明）**：`effects.ts` 對 `_shared.setAbilityHolderEffectiveFn`
的注入原本把 `location` **寫死 `'active'`**，但 `_shared.tryPromptPromoteActive` 有一條餵的是
**備戰**持有者（`ON_ACTIVE_PROMOTE_BENCH_WATCHER`：超級拉帝亞斯ex 上場、holder 拉帝歐斯在備戰）
⇒ 拉帝歐斯明明在備戰，卻被「對手戰鬥場振翼髮消除我方 **active** 特性」誤壓，潔淨支援發不動。
改成呼叫 `hasEffectiveAbilityByInst`（自己從 state 推 location）後修好；
`ON_PROMOTE_TO_ACTIVE_ABILITIES` 那一圈的持有者本來就是 active，推出來仍是 `'active'`，**行為零變化**。

⚠ **`_shared.ts` 不能 import v3001／defense**（anti-pattern-lint Check O：底層模組反向 import 白名單
只准縮不准擴）⇒ hasOakEye／hasMultiToolRelay 走**既有注入點** `_abilityHolderEffectiveFn`。
順手把 `effects.ts` 的注入從「寫死 location='active'」改成呼叫 `hasEffectiveAbilityByInst`
（由它自己從 state 推 location）—— 原本 `tryPromptPromoteActive` 的**備戰持有者**那一條
（潔淨支援：拉帝歐斯在備戰）餵的是 bench 實體卻被當成 active 判，黏著束縛判定漏掉。

### B. 查證後「結構上不可達」，**不硬改**（改了做不出行為差異 ⇒ 沒有辦法證明它是對的）

| 消費點 | 理由 |
|---|---|
| `v2999…:204 steelixPalaceReduce`（岩石宮殿） | 大吾的小碎鑽 = Basic／Psychic／非規則，且卡面要求持有者**在備戰區**。現行 6 個消除來源：熔岩洞只打進化、監視塔只打【無】、初始化只打規則、招式版暗夜羽擊與 passive 振翼髮只打 active、黏著束縛只打備戰 **Stage2** ⇒ 沒有一個打得到。harness 實測：加 `abilityNullifiedThisTurn` ＋ 熔岩洞在場，`hasEffectiveAbilityByInst` 仍回 `true`。 |
| `engine.ts:3533 / 9195`（虹色DNA） | `prismaticDNAException` 只在 `!sameEvoName(evo.evolvesFrom, baseCard.name)` 時才有作用，而 `sameEvoName` 會 strip 掉 `ex` 後綴（v5.307 為超級進化寶可夢加的），`sameEvoName('伊布','伊布ex') === true` ⇒ **標準路徑一定先命中，例外分支是死碼**。實測 `伊布ex → 葉伊布ex` 在把 gate 加上去後行為完全不變。 |
| `m6_wave8.ts:33 / 56 / 57`（大洋增輝／深海抽出） | regA handler 內對**同一隻**的自我複核（同名卡陷阱防護）。`USE_ABILITY` 在 dispatch 前先跑 `getUsableAbilities`（engine.ts:9693 已過 `isAbilityHolderEffective`）⇒ 特性被消除時根本進不到 handler。⚠ 對照組：衝衝鼓那兩處讀的是**戰鬥位另一隻**的特性，上游那道閘蓋不到 ⇒ 必須修。 |
| `effects.ts:2350`（皇帝之勢，`hasEffectShield`） | `hasEffectShield` **全 `src/` 零呼叫端＝死碼**（只剩兩處註解提到它）。live 路徑是 `ATTACK_EFFECT_IMMUNITY` 的 `self-ability`，effects.ts:2531 早就過了 `isAbilityHolderEffective`。 |
| `engine.ts` 冰冷之帳區塊（化隱） | v6.201 已查證，本版原封不動。 |

### C. 需要**改函式簽名 ＋ 全部呼叫端**，留給站長裁定（本版不動）

| helper（簽名沒有 state） | 特性（持有者） | 可達的消除來源 | 呼叫端數 |
|---|---|---|---|
| `isConfusionImmune(inst, pool)` | 憨憨臉（呆呆獸 Basic/Psychic/J） | 暗夜羽擊兩型 | 6 |
| `isSleepImmune(inst, pool)` | 不眠（咕咕 Basic/**Colorless**/H） | 監視塔、暗夜羽擊兩型 | 5 |
| `getAttackerEffectiveTypes(inst, card, pool)` ＋ `hasIronTracksDualCore(inst, card, pool)` | 雙重屬性（小碎鑽 Basic/Fighting/J）、二重核心（鐵轍跡） | 暗夜羽擊兩型（攻擊者必在戰鬥場） | **只有 2 個**（`effects.ts:426` 在 `applyWeakRes` 內、`engine.ts:5399`），兩處都握有 state/actorIdx ⇒ **成本其實很低** |
| `isImmuneToOppTrainer(targetInst, pool)`（＋`getOppTrainerImmunityAbilityName`） | 緊張感（斧牙龍 **Stage1**）／融合為雪（浩大鯨ex **Stage1 + ex**） | **熔岩洞**、**初始化**、暗夜羽擊 | 經 `isImmuneToOppSupporter` 等多處 |
| `hasArchaeoglobinDiveMemory(player, pool)` | 潛入記憶（古空棘魚 Basic/Fighting） | 暗夜羽擊兩型 | 參數是 `PlayerState`、連 ownerIdx 都沒有 |
| `hasMeloettaExDebut(inst, pool)` | 出道演出（美洛耶塔ex Basic/Psychic/**ex**） | **初始化**、暗夜羽擊兩型 | engine 2 處 |
| `resolveInfiniteShadowKo(koInst, pool, eligible)` | 無限之影（耿鬼 **Stage2**/J） | **熔岩洞**、**黏著束縛**（備戰 Stage2） | ⚠ 另需先裁定「KO 當下持有者是否還算在場上」 |
| `hasShellinkEvolveBypass(baseCard, state, ownerIdx, pool)` | 刺激進化（小嘴蝸／蓋蓋蟲 Basic/Grass） | 暗夜羽擊兩型（僅 active） | 有 state 但**缺 holder inst**；3 個呼叫端全在 engine.ts ⇒ 成本低 |
| `effects.ts:7957 _dcSelfDiver` | 潛者捕捉（獵斑魚自身昏厥那條） | — | ⚠ KO 當下該隻已離場、算不出 location，需站長裁定 |
| `passiveImmunityDamageBlock` / `passiveCoinImmunity`（`effects.ts:4208 / 4293`） | PASSIVE_IMMUNITY 全族（神秘石居＝岩殿居蟹 Stage1、璀璨鱗片＝美納斯ex Stage1+ex、順滑大衣…） | **熔岩洞**、暗夜羽擊兩型、黏著束縛（已 inline 擋了初始化＋監視塔） | 簽名只收 `targetCard`，沒有 inst／ownerIdx。⚠ engine 主管線那份（`engine.ts:5596`）**有**接中央閘，這份（中央／狙擊／UI 預覽）沒接 ⇒ 兩份已經在漂 |

### D. 順手發現、**本版沒動**的另一個議題（請站長裁定）

`sameEvoName` 會把 `伊布ex` 正規化成 `伊布`（v5.307 為「超級XXXex／XXXex／XXX 視為同一階變體」加的），
於是 **伊布ex 可以直接進化成非 ex 的葉伊布**（harness 實測 `true`）。
而【伊布ex】的卡面「虹色DNA」只寫「可從手牌使出從『伊布』進化而來的『寶可夢【ex】』」——
沒有這條特性的話，伊布ex 本來就不該當成「伊布」被進化。這是另一個維度（進化同名判定），
牽動所有超級進化寶可夢，**不宜順手改**。

### 守衛 `scripts/test-v6202-passive-ability-gate.mjs`（53 檢查）

①卡面逐字錨 ＋ 下限斷言（抓不到卡就紅，不做安慰劑綠燈）；每張卡的 `stage`/`pokemonType`
逐一釘住 —— 那正是「哪些消除來源打得到它」的依據。
②行為端逐張：**特性被消除 ⇒ 效果失效**，且每一條都配**正對照**（特性正常 ⇒ 仍生效）。
祭典樂舞走完整 `applyAction ATTACK`；衝衝鼓判定端（`getUsableAbilities`）與動作端
（`USE_ABILITY`）各驗一次；提升進化同時驗 `getEvolvableTargets`（UI 黃框）與 `EVOLVE`；
多重轉接驗「卡面寫的丟棄多附道具」真的發生；監視之眼另用願增猿｜腎上腺腦力跑真流程。
捲牆多一條**回歸**（備戰那隻仍有效時照樣 -60）防修過頭。
③`hasAbilityOnBench` 的**刻意無 gate 例外**：行為端證明黏著束縛仍生效且不爆堆疊，
靜態端斷言該函式維持沒有 gate（配正對照證明判準抓得到違規）。
④**枚舉守衛**（20a~20k）：剝註解 ＋ 剝零寬字元後掃 `src/lib/game/**/*.ts`，
**兩種 pattern**（① `X.name === '特性名'`，含**多行 for-of** ② `PASSIVE_*` 等
**registry 查表** `MAP.get(ab.name)`）。每個消費點必須「±8 行內有中央閘呼叫，
且那一行帶著同一個特性名字面量**或**同一個 `ab.name` 變數」，否則就得出現在本檔的
`EXEMPT` 表並寫明理由。
⚠ 這裡刻意**不用**「±16 行內出現任何 gate 名稱」那種窗口判準 —— v6.201 就吃過虧
（`engine.ts` 冰冷之帳的化隱被同區塊的 `hasAnyEffectiveAbility` 蓋掉而漏報）；
本版修完 `engine.ts:9182` 之後，`9195` 也會因為同一個窗口污染而假綠。
⚠ 「帶著同一個特性名」不能只認字面量：`engine.ts selfAttackPreconditionBlock` 是
`gate(..., ab.name, ...)` 的合法寫法，只認字面量會誤報（20i 是這條的正對照）。
另有：豁免表**不得有死條目**（修好了就要從表裡刪掉）、掃描器下限斷言（≥90 個消費點／
兩種 pattern 各有下限／≥55 個已接閘）、六條掃描器自我驗證
（違規樣本必須被抓到／多行 for-of 不得再隱形／registry 查表不得再隱形／
gate 用變數傳特性名不得誤報／註解裡的假樣本不算／零寬字元要剝掉）。

**HEAD-FAIL**：把 8 個改動檔還原成 BASE blob 重跑 → **20 條紅**
（1b/2b/3b/4b/5b/6b/6c/7b/8b/9b/12b/13b/14b/15b/16b/17b/18b/19b/20c/20d），
所有正對照維持綠 ⇒ 證明它們不是恆真式。
另做**逐 hunk 反轉**：只還原 `ai.ts` 那個 hunk（AI 的第二份監視之眼判定，屬啟發式、無行為斷言）
⇒ 20d 亮紅 ⇒ 它確實被枚舉守衛守住。

### 部署
`update-tournament.bat`（卡效果／引擎改動）、`update-admin-full.bat`（admin.html 版本提示）。
`redeploy-oracle.bat` 本版**不需要**（沒動 `server_admin_patch.js`）。

## v6.201 手機直式手牌述詞收斂 ＋ ACE消弭／濕氣 補上「特性是否生效」中央閘

### A. 手機直式收斂到 `getHandCardOps()`（玩家零可見變化以外的部分見下）

v6.200 建了 `src/lib/game/hand-card-ops.ts` 當桌機（classic＋fable 共用 markup）的唯一述詞，
但 `src/routes/game/MobilePortraitBattle.svelte` 仍自帶**第三份**：

| 刪掉的 | 位置(BASE 4f3c7c2) |
|---|---|
| `playableTrainerIids / playableBasicIids / playableFossilIids / playableEvoIids` | L284~287 |
| `handAbilityActivatableIids` | L291~296 |
| `aceCancelActiveLocal`（鏡射 engine `isAceCancelActive`） | L454~471 |
| `isAceSpecEnergyCard` | L472~474 |
| `isEnergy / isTrainer / isToolCard / isEvoMon`（只為了組可用性條件而存在） | L447~452 |

手機沒有拖曳 ⇒ 當下沒有 v6.200 那種「點得動拖不動」，但三份判定遲早漂移
（烈箭鷹ex 三度出包 v6.080 / v6.098 / v6.200 全同源）。

**prop 怎麼傳**：手機是子元件，但這次**不需要新 prop** —— `game / pool / myIdx / isSpectator`
都是既有的 props，`getHandCardOps` 在子元件內自己算。真正的接線風險在另一處：
手機的 `isMyTurn = !isSpectator && game.activePlayerIndex === myIdx`，而 **setup 是雙方同時擺場**
（`activePlayerIndex` 只指得到一個人），所以 v2.287 起手機的 setup 條件**刻意不寫 isMyTurn**。
直接把手機的 `isMyTurn` 餵進中央述詞會把另一方在 setup 完全鎖死。
⇒ `HandCardOpsCtx` 新增 **選填** `isMySetupTurn`；桌機不傳＝退回 `isMyTurn`（`isMyTurn()` 本身
已含 setup 分支 `setupActorSide`）⇒ **這一項對桌機零影響**。手機傳 `!isSpectator`。

另外把 engine `handleSetup` 的 `BENCH_POKEMON` 備戰上限 gate 補進中央述詞
（`basic-setup` 加 `!benchFull`）。
⚠ **這一項桌機也吃得到**（`+page.svelte` 一行沒改，但它讀同一支述詞）：
setup 階段備戰已滿時，基礎卡不再亮黃框／不再可拖。`basic-setup` 的釋放區是 `bench-empty`，
滿位時本來就沒有空格可放 ⇒ 移除的是死動作，不是功能。**本版對桌機的唯一行為差異就是這個。**

**差分實跑**（`scripts/test-v6201-*.mjs` ⑥）：老述詞逐字轉錄自 BASE，4000 個隨機盤面 /
**9963 張手牌狀態**比對，mismatch **490** 筆，全部落在兩類、**行為退步 0**：

| 類別 | 筆數 | 說明 |
|---|---|---|
| 死按鈕（applyAction 實跑證明盤面不變） | 352 | 見下表 |
| 觀戰唯讀（v6.197 fail-closed） | 96 | setup 階段觀戰者原本仍亮黃框、sheet 仍給按鈕 |

死按鈕的 5 個成因（舊版給了、引擎一律 `return state`）：
1. `setup && setupDone[我] && !mulliganPostBenchOpen` → 仍給「放到備戰區／放到戰鬥場」
2. `setup && 沒有戰鬥寶可夢` → 仍給「放到備戰區」（`BENCH_POKEMON` 要求先有 active）
3. `playing && active===null` → 仍給「放到戰鬥場」（`PLACE_ACTIVE` 只在 setup 生效）
4. `setup && setupDone` 的閃焰王牌｜瞬間爆發力 → 仍給「放到戰鬥場（瞬間爆發力）」
5. `pendingSelection` 期間 → 仍給「進化」（`getEvolvableTargets` 自己沒擋 pending）

反向唯一的「新增」是**黃框**：`setup && setupDone && mulliganPostBenchOpen` 時舊版黃框不亮
但按鈕在（自相矛盾），新版兩者一致亮起 —— 那個動作引擎本來就允許（v5.138 例外）。

### B. ACE消弭／濕氣：passive 特性消費點沒過中央 gate（v6.196 那一族的漏網）

| 位置 | 特性 | 卡面（`static/cards`） |
|---|---|---|
| `engine.ts isAceCancelActive` | 蓋諾賽克特｜ACE消弭（SV6a 040/064，H，**Basic**，Metal） | 「若這隻寶可夢附有『寶可夢道具』卡，則對手無法從手牌使出『【ACE SPEC】』卡。」 |
| `engine.ts isSelfKOEffectBlocked` | 可達鴨／哥達鴨｜濕氣（哥達鴨 **Stage1**） | 「只要這隻寶可夢在場上，雙方所有寶可夢的將自己【昏厥】的效果的特性，全部消除。」 |

兩處原本都只比對 `card.abilities.some(a => a.name === 'X')`，**沒問特性此刻有沒有被消除**。
harness 行為端重現（BASE 4f3c7c2）：

- ACE消弭：對手戰鬥場蓋諾賽克特＋道具，我方戰鬥場放 **振翼髮｜暗夜羽擊**（或給它
  `abilityNullifiedThisTurn`＝招式版暗夜羽擊）⇒ `isAceCancelActive` 仍回 `true`，
  `getPlayableTrainers` 不列、`PLAY_TRAINER` 與 `ATTACH_ENERGY` 都被擋。
- 濕氣：對手戰鬥場哥達鴨，我方戰鬥場振翼髮 ⇒ `isSelfKOEffectBlocked` 仍回 `true`，
  彷徨夜靈｜咒詛炸彈 被「被可達鴨的濕氣消除」擋下。

⚠ 子代理當初舉的例子「傳說的熔岩洞」對**蓋諾賽克特不成立**（stage=Basic，熔岩洞只消除
進化寶可夢；火箭隊的監視塔只消除【無】，它是 Metal）。真正踩得到的是暗夜羽擊那兩條路徑。
**哥達鴨 Stage1** 則確實會被熔岩洞消除。

修法：兩處都改走 v6.196 的中央 helper `hasEffectiveAbilityByInst`（defense.ts），**不另建第四份**。
另外刪掉 `effects/_shared.ts canPlayTrainer` 裡 v2.113 的**第三份** ACE 判定
（只比對卡名＋`toolAttached`，沒查特性名、漏 `extraTools`、也沒有 gate）——
它的兩個呼叫端 `PLAY_TRAINER` handler 與 `getPlayableTrainers` **都已經先問過** `isAceCancelActive`，
留著只會把本版的修正在 `PLAY_TRAINER` 這條路上擋回去。

### C. 重跑 v6.196 維度（passive 特性消費點有沒有問中央 gate）

剝註解 + 剝零寬字元後掃 `src/lib/game/**/*.ts` 裡 `abilities … .name === '…'` 共 **58 處**，
上下 ±16 行沒有任何 gate 呼叫的 **38 處**。逐一讀 handler body 後分類：

- **豁免**：手牌／牌庫／棄牌區的卡（瞬間爆發力 setup 判定、緊急迴轉、激動俯衝、全能靈魂）、
  消除來源本身（初始化、黏著束縛 ← **v6.196 的 `hasAbilityOnBench` 例外，本版原封不動**）、
  已在下游 gate（懶怠個性 → `selfAttackPreconditionBlock`）。
- **本版修掉**：ACE消弭、濕氣（`isSelfKOEffectBlocked`）。
- **仍待裁定／下一輪**（皆為場上 passive、目前無 gate，列給站長排序）：
  小碎鑽｜雙重屬性（弱點比對）、呆呆獸｜憨憨臉（混亂免疫）、帝王拿波ex｜皇帝之勢、
  咕咕｜不眠、電龍｜同步脈衝(+80)、伊布｜提升進化、伊布ex｜虹色DNA、
  小嘴蝸/蓋蓋蟲｜刺激進化、祭典樂舞（4 處）、探探鼠｜監視之眼（`_shared.ts` 與 ai.ts 各一份）、
  無限之影、多重轉接、廣域堡壘、潛入記憶、化隱(m5_preview)、二重核心、捲牆、岩石宮殿、
  出道演出、緊張感／融合為雪、大洋增輝、深海抽出。
  ⚠ 其中 `isConfusionImmune` / `hasEffectShield` / `isSleepImmune` 的簽名**沒有 state**，
  要加 gate 得改所有呼叫端 —— 風險不小，不併進本版。
  ⚠ `_shared.ts` 的繁茂 fallback（L368）是 `_bloomEffectiveFn` 沒注入時的退路，
  正常執行一定走 effects.ts 注入的**有 gate** 版本，不算 live 漏網。
  ⚠ 子代理審查補抓到一處我的掃描器漏報：`engine.ts` 冰冷之帳區塊的 `hasHuayinAbility`
  （化隱）沒過 gate —— 我的 ±16 行視窗被同區塊的 `hasAnyEffectiveAbility` 蓋掉了
  （典型的 window-grep 假陰性）。實際上同一支 `isFrosmothCheckupTarget` 會先過
  `hasAnyEffectiveAbility`，而現行所有特性消除來源都是「整隻的特性全消」，
  所以「化隱被消除但這隻仍有其他有效特性」的盤面**構造不出來** ⇒ 結構上不可達，
  列入待裁定清單，本版不動。

### 守衛

`scripts/test-v6201-mobile-hand-ops-and-ability-gate.mjs`（52 檢查）：
①卡面逐字錨 ②ACE消弭 四個消費點 × 三種特性狀態（含正對照）③濕氣 ④`hasAbilityOnBench`
例外正對照（黏著束縛仍生效且不遞迴）⑤手機枚舉守衛＋自我驗證 ⑥差分實跑。
**HEAD-FAIL**：把四個改動檔還原成 BASE blob → **20 條紅**（含 ⑥ 差分那條，證明它不是恆真式）。
⚠ 子代理審查指出 ⑥ 原本對「動作集合相同、只有黃框不同」的 mismatch 完全不斷言（死角）——
已補上結構不變式（新版黃框 ⟺ 有可用操作）與方向斷言（78 筆全是「舊不亮→新亮」）。
`test-v6200` 的手機那條斷言同步改成「讀 getHandCardOps」（80 PASS）。


## v6.200 手牌卡「拖曳」與「點擊」收斂成單一可用性述詞（烈箭鷹ex｜激動俯衝 桌機拖不動）

### 玩家回報
桌機（Windows）：烈箭鷹ex 的特性【激動俯衝】條件成立時，手牌卡**點擊可以**放到備戰區，
**拖曳完全拉不動**，連拖曳動畫都不會出現。

### 卡面逐字（static/cards/M6.json id=19612，特性讀 abilities[].effect）
> 在自己的回合，若手牌有這張卡，且自己的場上有【無】屬性的「超級進化寶可夢【ex】」，
> 則可使用1次。將這張卡放置於備戰區。

### 真因（v6.199 `src/routes/game/+page.svelte`）
手牌卡有**兩份互不相干**的可用性判定：

| 路徑 | 判定 | 位置(v6.199) |
|---|---|---|
| 拖曳 | `dragKind = canEnergy ? … : canBasic ? … : canFossil ? … : canEvolve ? … : canTrainer ? … : null` | L10845~10852 |
| 點擊 | `canHandActivate = handActivateAbilities.has(inst.iid)` | L10858 |

`dragKind` 那串**完全沒有** `canHandActivate` ⇒ `.draggable` 不加、`onpointerdown` 也不會呼叫
`startDrag`，所以「拖不動、連動畫都沒有」。而 `class:can-actionable={isActionable || canHandActivate}`
讓黃框照亮 ⇒ 玩家看得到「可用」卻拖不動。
v6.080 把**判定**收斂進 engine `getHandActivatableAbilities` 時只接上了點擊那一半
（與 v6.098 手機版漏按鈕、v6.131 特性 gate vs regA、v6.109 filter vs validIids 同族）。

### 跨卡 audit（維度：手牌卡「點擊做得到但拖曳做不到」）
桌機手牌能觸發的全部路徑共 9 種（附能 / 放基礎(playing) / 放基礎(setup) / 放戰鬥場(setup) /
化石 / 道具 / 訓練家 / 進化 / 手牌特性）。逐一比對後**只有「手牌特性」這一種**被拖曳端漏掉；
其餘 8 種拖曳端都有。受影響的卡＝`ON_HAND_ACTIVATE_ABILITIES` 全部 **2 張**：
**烈箭鷹ex｜激動俯衝**（M6/J）與**齒輪怪｜緊急迴轉**（SV7/H）—— 兩張都拖不動，一起修好。
反向（拖得到但點不到）的 basic/fossil/trainer/tool 是桌機的既有操作設計（需要選釋放目標），
不是 bug；進化另有場上寶可夢的「進化」按鈕作為點擊入口。

### 修法（中央收斂）
新增 `src/lib/game/hand-card-ops.ts`：
- `getHandCardOps(state, myIdx, pool, { isMyTurn })` → `Map<iid, Set<HandCardOp>>`，
  **這是手牌卡可用性的唯一述詞**；黃框、`.draggable`、`onpointerdown`、`onclick`、
  提示文字、drop-zone 高亮全部只讀它。
- `handCardDraggable()` / `handCardDragKind()` / `handOpForDropTarget()` +
  `HAND_OP_DROP_TARGET`（op → 釋放區的唯一對照表）。釋放結算改成
  「先問這個釋放區、問不到再退回整張桌墊」，保住 v1.03 起「支援者蓋在寶可夢上放開也算使用」。
- `engine.ts` 的 `isAceCancelActive` 改 export；UI 端自己鏡射的 `aceCancelActiveLocal`
  以及 `playableTrainerIids / playableBasicIids / playableFossilIids / playableEvoIids`
  四份 derived 一併刪除（都是第二份判定的溫床）。
- ⚠ 沒有硬編任何卡名／特性名，v6.098／v6.125「UI 端禁硬編手牌特性」的守衛仍然綠。
  新增同型卡一律只改 engine 的 `HAND_ACTIVATE_GATES`。

### 三種版面
- 桌機 **classic** 與 **fable**（v5.956）共用**同一份 markup**（fable 只是 `.playmat` 上多一個
  `layout-fable` class 的純 CSS 版面）⇒ 一次修好兩種，守衛有斷言釘住「可操作手牌卡 template 只有一份」。
- **手機直式** `MobilePortraitBattle.svelte` 沒有卡片拖曳（走 sheet 選單），
  入口本來就讀中央 `getHandActivatableAbilities`，行為不變；守衛斷言它沒有 `startDrag`／`DragKind`。

### 守衛 `scripts/test-v6200-hand-drag-click-parity.mjs`（73 條，HEAD-FAIL 17 條）
① 卡面逐字；② 行為端逐張枚舉 `ON_HAND_ACTIVATE_ABILITIES`（含完備性斷言：登錄卡沒有 fixture 就亮紅）
—— 可用時拖曳與點擊兩條路徑都要能上備戰且最終盤面一致，不可用／非我方回合時兩條路徑都不行；
③ 結構＋三版面；④ 否定型判準的正對照自我驗證；
⑤ **行為端求值**：把 template 的 `dragKind` / `isActionable` / `onpointerdown` handler
**真的執行一次**，斷言「只有手牌特性可用時 `startDrag` 真的被呼叫」——
HEAD 跑同一段會得到 `dragKind=null`、`startDrag` 呼叫 0 次，正是玩家回報的症狀。
⚠ 連帶更新 `test-v6147`（拖曳 gate 的 regex）與 `test-v6172`（handler 求值的注入名），
兩者驗的都是 `actionBusy`，語義不變。

## v6.199 錦標賽排行榜「顯示筆數」下拉（5 / 10 / 20）

### 真因定位（先查再動手）
站長回報「排行榜都只顯示前五名」。**截斷點不在前端**：
`src/routes/game/+page.svelte` 的排行榜分頁是 `{#each rows}`，伺服器回幾筆就畫幾筆；
真正的 `slice(0, 5)` 有**兩處**，都在 `oracle-admin/server_admin_patch.js`
的 `GET /api/tournament/leaderboard`（`topN()` 與 `communityHost`）。
⇒ 只在前端加下拉會完全沒有效果，必須前後端一起改。

⚠ 不要改錯對象：站內另有「網站賽歷屆冠軍 / 社群自辦歷屆冠軍」（`/champions`，最近 100 位、
預設收合），以及「瑞士制排名」（`/bracket` 的 standings，OWP/OOWP 那張表，**本來就沒有截斷**）。
這一版兩者都沒有動到，守衛 6a/6b 有正面斷言釘住。

### 做法
- 伺服器：`?limit=`（1~20）。**沒帶 limit 仍回 5** —— 線上還有被 Service Worker 卡住舊 bundle
  的 client，它們照單全收伺服器回的筆數，預設放大會讓那些人的版面無聲變長。
- 快取只存「上限 20 筆」那一份，回應時才 `_lbSliceResult()` 切片 ⇒ 不管同時有幾種 limit，
  60 秒內都只掃一次 TARCHIVE（per-limit 快取會讓全表聚合次數乘上筆數種類）。
- 前端固定要 `?limit=20`，**切換筆數只做本地 slice、不發任何請求** ⇒ 不重抓、不清空、不閃，
  v6.177 的 stale-keep 那份好資料原封不動留在 `tLeaderboard`。
- ⭐**回應帶 `limit` 欄位，前端據此決定畫不畫那顆下拉**：舊伺服器（還沒跑 `redeploy-oracle.bat`）
  會忽略未知的 query 參數、照回 5 筆而且不會有 `limit` 欄位 ⇒ 新前端就不畫下拉，
  版面與 v6.198 完全相同。沒有這道閘的話會出現本專案最討厭的那種 bug：
  **控制項畫得出來、按了完全沒反應，而且查不出原因**。
- `_lbSliceResult` 是「先 `...full` 再覆寫要切的欄位」，不是白名單投影 ——
  將來端點多加第六個榜卻忘了同步這支 helper，那個榜會「原樣送出（只是沒切片）」，
  而不是被靜默丟掉；「多送幾筆」看得見，「整個榜消失」看不見。
- 中央單一來源 `src/lib/ui/leaderboard-top.ts`（選項／預設／上限／localStorage 讀寫／切片），
  純計算 + localStorage 兩件事、不碰 UI ⇒ 守衛可以**真的跑起來求值**。
- localStorage 一律 try/catch（Safari 無痕 `setItem` 會 throw；停用儲存時 `getItem` 同樣可能 throw）。
- 下拉沿用站內既有寫法：`value={...} onchange={...}`（同 `#bgm-select`），
  色票沿用 `.tourn-field .deck-select`（#142414 底／#4a6a4a 框／#eaf5ea 字／8px 圓角），
  只把版型從「整列填滿」換成「靠右內嵌」。

### 版面（求值算出來的，不是「看 CSS 覺得沒問題」）
`.tourn-lb-row` 的高度由 `.tourn-lb-rank` 的固定 `height:22px` 決定
（`.tourn-lb-name` .9rem、`.tourn-lb-cnt` .82rem 的行框即使用 line-height 1.5 也只有
21.6 / 19.7px，撐不高列）⇒ 每列 22 + 5 + 5 + 1(border) = **33px**，與筆數、字體度量都無關。
- 桌機（viewport 1280）：`.lobby.tourn-lobby` content box 640px；
  `repeat(auto-fit, minmax(230px,1fr))` + 12px gap ⇒ **2 欄、每欄 314px**（3 欄需 714px，放不下）。
- 手機直式（viewport 390，`@media (max-width:600px) and (orientation: portrait)` 把 `.lobby` padding 壓到 0.8rem）：
  content 364.4px ⇒ **1 欄 364.4px**；`@media (max-width:560px)` 讓冠軍榜兩欄也變單欄。
  新增的下拉列實測寬約 168px，遠小於 364px，不會擠爆。
- **橫向不爆**：`.tourn-lb-name` 有 `overflow:hidden` ⇒ flex 的 auto 最小尺寸變成 0，
  長暱稱會被 ellipsis 切掉而不是把列撐開；`.tourn-lb-rank` 是 `flex:0 0 22px` 固定寬，
  兩位數名次（.78rem，兩字元約 15px）仍在 22px 圈內。
- 實際高度見守衛 3f/3g 的輸出（每次跑都會印出來，不寫死在文件裡）。

### 取捨：手機不做內部捲動
20 筆在手機是四千多 px（約 5 個螢幕）。**刻意不加 `max-height + overflow-y`**：
① 頁面本來就是捲動的，內部再套一層捲動在觸控上是已知的操作陷阱（捲不動／捲錯層）；
② 站內既有的「歷屆冠軍」一次列 100 筆，也是走頁面捲動；
③ 預設維持 5 筆 ⇒ 沒動過選單的人版面一格都不會變，長度只發生在明確要求的人身上。
若站長實機看過後覺得太長，再回頭加「每個榜獨立收合」比加內部捲軸安全。

### 沒有新增任何 @media
既有的兩條（`max-width:600px` 的 `.lobby` 緊縮、`max-width:560px` 的冠軍榜單欄）原封不動；
新的 `.tourn-lb-bar` 用 flex 自然收合，不需要手機分支。守衛 4a 釘住 `@media` 總數 = 16
（以本守衛的剝註解器計；原文含註解內的是 21），4b 是正對照（真的多加一條會被抓到）。

### 子代理審查抓到的三個假綠（已補）
① **`$state` 被拿掉也全綠**：實測把 `let tLbTop = $state(loadLbTop())` 改成
   `let tLbTop = loadLbTop()`，48 條守衛原本全部照過 —— 但瀏覽器裡下拉會完全沒反應
   （Svelte 5 只給 `non_reactive_update` **警告**，build 照樣綠）。純函式求值的 2c 驗不到
   響應式接線 ⇒ 新增 2i／2i-2 把宣告本身釘死並附正對照。
② **3f 的「橫向不爆」是恆真式**：`colW*cols+gap <= container` 就是 `auto-fit` 的定義，
   `X <= X` 永遠成立。改成驗「這個欄數真的塞得下」＋「再多一欄就塞不下」＋
   「一列的最小內容（22px 名次 + 兩個 gap + 次數欄）塞得進欄寬」，並補 320px 實機寬度。
③ **2g 只切到函式第一行**：改用大括號配對切整支函式（`sliceBlock`），並加正對照
   （把重抓寫在第 2 行必須被抓到）。另補 3e-2（`boardHeights` 與手算 fixture 對照）、
   3h（3f/3g 依賴的兩條既有 @media 前提必須還在）、2b-2（區塊內不得有繞過 `lbTopRows` 的 each）、
   5d-2/5d-3（回應帶 limit、未來新榜不被吃掉）。

### 已知但接受的限制
- 列高 33px 的推導假設 `line-height: normal ≈ 1.2~1.5em`（實測字體約 1.33~1.46em，
  上界 1.5 只剩 0.4px 餘裕）。若哪天加了全域 `line-height: 1.6`，列高會變 34px 而守衛抓不到。
- 守衛印出的「整塊高」只含 `.tourn-lb-grid`，不含新的下拉列（約 40px）與底部說明行。
- 冠軍榜兩欄（網站賽／社群賽）共用同一個筆數；若一邊只有 2~3 人，選 20 時另一邊會留白。
  這一版先不處理，等站長實機看過再決定要不要兩欄各自截斷。

### 部署
`update-admin-full.bat`（admin.html 版本提示）、`redeploy-oracle.bat`（**必跑**，端點改在
server_admin_patch.js）、`update-tournament.bat`。⚠ 沒跑 oracle 那支的話，前端要 `?limit=20`
但伺服器不認識這個參數 ⇒ 仍然只回 5 筆，下拉會看起來「選了沒反應」。

# v6.198 收緊 `stale-version` 的送出判準（純診斷，玩家零可見變化）

## 為什麼要動
`stale-version` 是站長在 admin「📡 監控」判讀「盤面是不是真的卡住」的唯一管道。
v6.151 起的判準是：看門狗連續觸發 3 次 ∧ `phase==='playing'` ∧ `tVersion` 沒前進 ∧
盤面 60 秒沒動（v6.158 由 36 秒拉上來）＋ per-version 去重。

拿 `tournament-dumps/monitor_20260816_194120.json`（7 天窗、944 筆回報，其中
`stale-version` **407 筆 / 93 人**）逐筆回放，成因分佈是：

| 成因 | 筆數 | 佔比 |
| --- | --- | --- |
| 對手回合停滯（**對手在長考**） | 157 | 38.6% |
| 自己回合停滯（**自己在長考**） | 79 | 19.4% |
| 舊 client（判準更寬） | 82 | 20.1% |
| 輪詢真的不通 | 68 | 16.7% |
| **真漏接（伺服器有動作我沒更新）** | **4** | **1.0%** |

⚠ **措辭要精確**（審查抓到我第一版寫混了）：**長考類合計 236 筆 ＝ 58.0%**；
「89%」講的是收緊後的**降幅**（407→43＝降 89.4%），**不是假陽性率**，兩個數字不可混用。
另外 202/407（49.6%）是同一間房**雙方各報一次**的鏡像重複。
根本問題是「盤面 60 秒沒動」本身**不是異常** —— 對局裡想 60 秒是家常便飯。

## 新判準（三取一，缺一不報）
新檔 `src/lib/tournament/stale-diag.ts` 的 `staleVersionDiagWhy()`：

- **(a)** `env.vis === 'visible'` ∧ `sincePollOk >= 15000` —— 前景卻 15 秒收不到輪詢回應。
- **(b)** `sinceStateChange - sinceLastAction > 15000` —— 伺服器上真的有人動作、比我的盤面
  最後一次變動晚 15 秒以上（＝「漏接」的定義）。
- **(c)** `srvActor !== tCurrentActorSeat(game)` —— 誰該動作，伺服器與本地認知分岔。

⚠⚠ **(b) 必須 `sinceLastAction > 0`**：那個值是 `Date.now() - tLastActionAt`，而
`tLastActionAt` 是**伺服器**時間 —— 裝置時鐘慢的人算出來是負數（dump 裡實測有 -11 秒、
-77 秒、甚至 -4.9 小時），負數會讓差值無條件爆表，把「時鐘不準」誤報成「漏接」。
少了這道守衛，同一份 dump 會多命中 4 筆、全部是時鐘偏差。
⚠ (c) 兩邊都必須是數字才比：`srvActor` 在 v6.157 以前的 client／被截斷的列是缺席的，
「拿不到」不可以被讀成「不一致」（fail-closed：不確定就不送）。

**回放結果（scripts/test-v6198-… 4b 用同一份資料釘住）：407 筆 / 93 人 → 43 筆 / 25 人**
（a 39 筆、b 4 筆、c 2 筆且那 2 筆同時也命中 a；被截斷的 21 筆一律判不出條件 ⇒ 不送）。

## ⚠⚠ 只收緊「送不送診斷」，自癒一個字都沒動
`+page.svelte` 的新鮮度看門狗結尾長這樣（收緊前後都一樣）：

    if (…舊四道前置… && _staleDiagVersion !== tVersion) {
      const _why = _staleVersionWhyNow();
      if (_why) { … _tSendClientDiag('stale-version'); }
    }
    tForceResync();          // ⭐ 在 if **之外**
    startTournamentPoll();   // ⭐ 在 if **之外**

`_tSendClientDiag()` 全身只有一件事：`void tApi('/clientdiag', payload).catch(…)`。
它不動任何 $state、不觸發重新同步、不顯示任何橫幅 ⇒ 判準再嚴都不可能讓卡住的畫面
失去自救能力。守衛 3a 用**括號配對**證明那兩行在 if 之外（不是只驗字串存在），
3b 證明自癒與判準之間沒有新的耦合，3c 釘住看門狗自己的 20 秒 / 3.5 秒 / 8 秒門檻沒動。

⚠ 判準不成立時**不**設 `_staleDiagVersion` —— 條件 (a) 會隨時間累積，同一個卡住的版本
稍後若真的惡化成「輪詢不通」仍然報得出來（守衛 3e）。

## ⚠⚠ 三個必須誠實記下來的盲區（審查抓到，站長已接受這些代價）
1. **「伺服器根本沒動作、但 client 真的壞掉」三條都抓不到**。例如 v6.175 的 pending-token
   死鎖（我的答案被丟掉、雙方都在等我）：那時 `sinceStateChange ≈ sinceLastAction`（b 假）、
   `srvActor === localActor`（c 假）、輪詢健康（a 假）。這一類在舊判準裡被歸進
   「自己在長考 79 筆」那一格 —— 站長是在知道這件事的前提下核准收緊的。
   殘存偵測路徑只有玩家自己按「等待對手 🔄」（manual-sync，不佔配額、自帶 60 秒節流）。
   **若日後想補，建議加第 (d) 條：「pendingSelection.actorIdx === 我 且 60 秒沒動」。**
2. **長輪詢一旦啟用，(a) 幾乎變成死條件**。整段新鮮度看門狗被 `!_lpInFlight` gate 住
   （v6.155 就是這樣，舊判準同樣受制），而長輪詢一回來就立刻重送 ⇒ tick 進得來的那一刻
   `_tLastPollOkAt` 剛更新、`sincePollOk≈0`。⚠ 目前 `tournamentConfig.longPoll.enabled`
   實測是 **false**（dump 的 config 區塊），所以 (a) 現在是有效的。
3. **(a) 的門檻比上一輪的分類寬**。上一輪標的「輪詢真的不通 68 筆」用的是
   `sincePollOk >= 5000`；(a) 用 15000 且要求前景 ⇒ 只命中 39 筆。差額 29 筆＝
   13 筆背景頁籤（該排除）＋ 16 筆落在 5~15 秒之間（**這 16 筆從此靜音**）。

## 代價：鏡像回報從此看不見（站長已接受）＋ 替代欄位
以前「對手斷線」是靠**在線那一方也跟著報 stale-version** 間接看到的，那正是鏡像重複的來源。
收緊之後看不到了 ⇒ payload 的 `poll` 補上 **`oppQuiet`**（＝伺服器權威的
`oppQuietSec`，「對手已經幾秒沒來要盤面」，0 ＝正常在輪詢；資料源是
`server_admin_patch.js` 的 `_oppQuietSec()`，門檻由長輪詢設定推導）。
玩家端本來就有 v6.170 的 📶 提示在用這個值，但它從來沒被寫進診斷 ⇒ 站長事後看不到。
dump 摘要新增【②-c 📶 對手掉線】一段。

⚠⚠ **但要誠實標示它的極限（審查抓到，三處文案都已改）**：`oppQuiet` 是**順帶**的判讀欄，
**不是「對手掉線指紋」**。「我這邊正常、只有對手斷線」時新判準三條都不成立
（盤面與伺服器 `lastActionAt` 一起停在對手最後一步）⇒ **那個情境根本不會有任何回報被送出**。
它真正的用途是：**已經因為別的理由送出來的每一筆**，都能一眼看出「其實是對面掉線」，
不必再靠「在線那一方也跟著報 stale-version」去反推。
要**系統性**統計對手掉線，得另開指紋或在伺服器端統計 —— 本版刻意沒做。
⚠ `oppQuietOf()` 對「欄位缺席」回 `null`（不知道），**不是** 0（對手正常）。

## ⚠⚠ 新舊 client 會永遠混在同一張表裡
v6.151~v6.197 的 bundle 已經發布出去、改不了，它們會**繼續**用舊判準送。
兩批數字加在一起看是沒有意義的（舊那批光是長考類就佔 58%、真漏接只有 1%）⇒ 三處都要分得出來：

1. payload 的 `poll.staleWhy` 記錄觸發的是哪一條（`'a'`／`'ab'`…）；其他 reason 一律寫 `null`。
   **判定依據刻意不是版本號字串**（截斷列抽不到 ver、也可能有測試站 build），
   而是「有沒有 `staleWhy` 這個 key」。
2. admin 明細每一列標徽章：`monStaleBadge()` ⇒【新判準 a】／【舊判準·多為長考】／
   【判準不明·資料殘缺】。⚠ 第三種是「不知道」，**不可以**併進舊判準去數（守衛 5d）。
3. `dump-client-monitor.cjs` 新增 `staleGateOf()` + JSON 的 `staleVersion` 區塊 +
   摘要【②-b】段落，`new`/`legacy`/`unknown` 三欄分開列，並在文字上寫明不可加總。

## 順帶查證的一件事（沒有發現、不必修）
上一輪注意到 b 類 4 筆全部落在 v6.167（該版 54 筆中 4 筆＝7%，其他版本 0/224）。
查證結果是**時間巧合，不是 v6.167 的程式問題**：
- 那 4 筆全部落在 2026/8/11 21:15~22:34 的**同一場賽事**（該晚 stale 共 59 筆，其中
  47 筆是 v6.167 —— 因為 v6.167 就是那天下午 18:14 上線的當期版本）。
- `git show 2bcfc196 -- src/routes/game/+page.svelte` 逐行看過：v6.167 只動了
  報到版本閘提示視窗的**版面分支位置**與 `tApi` 的 `getIdToken` 6 秒上限，
  完全沒有碰 `tLastActionAt`／`_tLastStateChangeAt`／`tAdopt`／版本採納。

## 審查（opus 子代理）抓到、已逐條查證並修正的
- 【文案】「89% 是正常的長考」把**降幅**與**假陽性率**混為一談（括號裡的 38.6%+19.4% 只有 58%）。
  已在 `stale-diag.ts`／`admin.html`／dump 摘要與 JSON note／本檔四處改成精確措辭。
- 【文案】`oppQuiet` 原本寫「唯一還看得到對手掉線的欄位」是誤導（見上一節），四處已改。
- 【一致性】`monStaleBadge()` 對「有 `staleWhy` 這個 key 但值為空」原本回空字串（不標徽章），
  而 dump 的 `staleGateOf()` 把它算成 `'new'` ⇒ 兩張表對不起來。已改成標【新判準·未記條件】，
  並補守衛 5e-2 釘住兩邊同調；順手修掉那段錯誤的註解理由（其他 reason 在函式開頭就早退了）。
- 【守衛假綠】4c 原本是 `Math.round((1-43/407)*1000)/10` 的**恆真式**（兩個字面量都寫死、
  與程式無關）。改成用 4b **實算**的 `REPLAY.hits / FIX.rows.length`，並多釘一條
  「a+b+c − 總命中 = 2」（＝c 那 2 筆全被 a 涵蓋的重疊關係）。
- 【守衛假綠】4d 原本對 21 筆截斷列一律餵常數 ⇒ 同一個斷言重跑 21 遍。改成餵那一列自己的欄位。
- 【守衛假綠】2a 原本只驗「helper 裡有 `sincePollOk:` 這個字串」，卻在註解裡宣稱「與 payload
  逐字同一算式」。已改成把 payload 區塊切出來**逐字比對三個欄位的 RHS 原始碼**，
  並釘住 `srvActor` 兩邊的缺值語義（payload 寫 `'n/a'`、判準寫 `null`，都代表拿不到）。
- 【措辭】守衛檔頭原本寫「用 AST 括號配對」，實際只是括號計數 ⇒ 改成「用括號配對（不是 AST）」。
- 【紀律】`_staleDiagWhy` 補進 `tLeaveMatch()` 的重置（與 `_staleDiagVersion` 同生命週期）。
- 【已知、不改】`_tSendClientDiag` 走 `tApi` ⇒ 會呼叫 `_tMarkServerAlive()`，(a) 送出時那一發
  POST 若成功會把失聯橫幅壓掉一輪。這是既有行為，且舊判準是新判準的**超集**（送得更頻繁）
  ⇒ 本版只會讓這個副作用**變少**，不是新引入的。

## 驗證
- 新守衛 `scripts/test-v6198-stale-version-gate.mjs`（47 項）已進 npm test 鏈（第 516 支）。
  **HEAD-FAIL 對照**：BASE `074edfd6` 只過 9 項、**失敗 38 項**。
  （3a~3d 這四條自癒正對照在 BASE 也是綠的 —— 那正是它們的用途：證明本版沒動到自癒。）
- 回放用的 fixture `scripts/fixtures/v6198-stale-version-replay.json`：只留 407 筆判準會用到
  的 6 個欄位，uid 取 SHA1 前 10 碼，email／UA／room 一律不留。
- 完整 `npm test` 516 步分批全綠；`npx tsc` 新增 TS2304 為 0；
  svelte compile（client／server）通過且警告數與 BASE 相同（98→98、14→14）。
- ⚠ 兩支既有守衛的**切片視窗**跟著放寬（斷言內容一個字都沒放寬，理由都寫在該行上方）：
  `test-v6158-…mjs` 的 stale-version 前置條件視窗 400→900（送出點前面多了判準求值），
  admin 說明視窗 700→2500（那段說明被改寫成三倍長）。
- ⚠ vite build 在沙盒跑不完，由 CI Deploy 把關。

---

# v6.197 觀戰者長出操作按鈕 —— 真因是「觀戰判定」是 fail-open 的

## 玩家回報
> 「現在進去一般對戰的觀戰，按離開的時候會出現投降的按鈕，甚至有的時候可以按攻擊、結束回合的按鈕，很奇怪，以前似乎不會這樣。」

## 真因（實跑求值，不是讀碼推論）
`src/routes/game/+page.svelte` 的舊述詞：

    isSpectator = isTournSpectator || (mode === 'online' && (mySeatIdx >= 2 || isAdminMode))

它要求「拿得出觀戰位的證據（座位 >= 2）」才算觀戰者 ⇒「認不出自己的座位」(mySeatIdx === -1)
這個**不確定**狀態被歸成「玩家」。把 BASE 的這行運算式切出來實跑：

    休閒觀戰 seat 2   ⇒ isSpectator=true  ｜桌機投降鈕=false｜手機 isMyTurn=false
    ⭐認不出座位 -1   ⇒ isSpectator=false ｜桌機投降鈕=true ｜手機 isMyTurn=true

- 桌機頂欄 `{#if mode === 'online' && !isSpectator}` ⇒ 冒出「🏳 投降離開」。
- 手機直式 `isMyTurn = !isSpectator && game.activePlayerIndex === myIdx`，觀戰時父層的
  `myIdx` 會退回 `myPlayerIndex ?? 0` ⇒ **有一半的回合**會長出「⏭ 結束回合」與招式鈕
  （＝玩家說的「有的時候」）。
- 更嚴重：`dispatch` 的唯一擋線就是 `isSpectator`，它一旦為 false，動作是**真的會被套用**的。

## mySeatIdx 為什麼會變成 -1
`oracle-client.ts` 的 401 自動重登（v5.628）會 `oracleSignOut()` + 重新匿名登入，
伺服器發的是**全新的 uid**；而 `+page.svelte` 的 `myUid` 只在 onMount 取過一次、
從此不再更新 ⇒ `findMySeatIdx(room.seats, myUid)` 一路回 -1。玩家與觀戰者都會中。

## 修法（中央收斂 + fail-closed）
1. 新檔 `src/lib/game/viewer-role.ts`：`isViewerSpectator` / `canViewerAct` /
   `isSeatUnknownOnline` —— 線上模式下**只有明確認得出自己是 P1/P2**（且 mySeatIdx
   與 myPlayerIndex 一致）才算玩家，其餘一律唯讀。本機雙人／AI 不受影響。
2. `+page.svelte`：`isSpectator`/`canAct` 都由中央述詞產生；`dispatch`、`initiateAttack`、
   `surrenderLeave` 全部改問 `canAct`；認不出座位時頂欄顯示「⚠ 認不出你的座位（唯讀）」。
3. `leaveOnlineGame`：**先把 game/roomData/mySeatIdx 清乾淨，再 await leaveRoom**
   （舊順序在那一次 HTTP 往返期間畫面還是整個對戰盤、身分卻半清）。
4. `oraclePollRoom`：`await` 之後補 `if (!alive) return;` —— unsubscribe 擋不住在途那一發，
   少了它玩家離開後會被彈回對戰頁。
5. `leaveRoom`（room-oracle.ts + room.ts 兩份同步）：對戰中的**觀戰位**離開要真的釋放
   （舊碼 `if (data.status !== 'lobby') return;` 讓 8 個觀戰位會被殘留佔滿）。
   ⚠ P1/P2 在 playing 的離場語義（棄賽判對手勝）一個字都沒動。
6. `oracle-client.ts`：新增 `onOracleUidChange`，兩條取得 uid 的路徑都走 `_setUid`；
   `+page.svelte` 訂閱後同步 `myUid`（真因修）。

## 伺服器端防線
- 錦標賽 `/api/tournament/action` 早就有：`const seat = doc.seats.indexOf(pid); if (seat < 0) → 403`
  （server_admin_patch.js），`/match/forfeit` 也只查得到呼叫者自己的對戰 ⇒ 觀戰者送動作打不進去。
- ⚠ **休閒房的 `/api/rooms` CRUD 不在本 repo**（在 VM 的主 server），本版沒辦法補；
  休閒房的 `PUT /api/rooms/:code` 目前只驗 JWT、不驗座位 ⇒ 這條縱深防線仍缺，待站長在 VM 端補。

## 審查抓到的兩件事（已修，並各自補守衛）
- ⚠⚠ **第一版的「真因修」修過頭了**：我原本讓 `myUid` 跟著 `onOracleUidChange` 無條件更新。
  但**座位裡存的是加入當下那個舊 uid**（room-oracle.ts:163），401 重登換到新 uid 之後把
  `myUid` 換成新的，等於親手把**對戰中的真 P1/P2** 打成「認不出座位」——而 fail-closed
  之後那就是直接鎖成唯讀（BASE 反而不會，因為 BASE 的 myUid 永遠不更新、一直對得上舊座位）。
  ⇒ 改成**只補空白**：`if (!myUid) myUid = uid;`。這樣只救得到「onMount 的 oracleAuth() 失敗、
  myUid 永遠停在 null」那條真實路徑，不會動到一個還在用的身分。守衛 9b 用實跑求值釘住。
- **桌機的休閒觀戰根本走不到 leaveRoom**：桌機頂欄對觀戰者只有一條 `← 首頁` 的 `<a>`，
  整頁換掉、不呼叫任何離開流程 ⇒ 上面第 5 點的觀戰位釋放在桌機是死碼。補上專屬
  `← 離開觀戰` 鈕（錦標賽觀戰早就有 tourn-return-bar，休閒這邊補齊）。守衛 3b。
- 另修：`onOracleUidChange` 的解除函式原本被丟掉、onDestroy 也沒解除 ⇒ 每次重進 /game 疊一個
  listener。守衛 9b2。

## 已知、本版沒有處理的
- **休閒觀戰仍看得到雙方手牌／牌庫／獎賞**：休閒房的 `/api/rooms` 直接回完整 gameState，
  觀戰端沒有 redact（錦標賽的 `/spectate/state` 才有 `_stateForSeat(-1)` 全遮）。這是既有設計，
  本版一個字都沒動；要改是伺服器端的事。
- **休閒房 `PUT /api/rooms/:code` 只驗 JWT、不驗座位**（伺服器不在本 repo），縱深防線仍缺。

## 守衛
`scripts/test-v6197-spectator-readonly.mjs`：PASS 39 / HEAD-FAIL 19。
行為端求值（不是只驗字串）：桌機頂欄條件、手機直式 isMyTurn、onLeave 分流、surrenderLeave、
leaveOnlineGame 的清除順序、oraclePollRoom 的在途回應、leaveRoom 的觀戰位釋放，
每一項都有「真玩家不受影響」的正對照。

# v6.196 【傳說的熔岩洞】沒有消除【護城龍｜太古防壁】—— v6.145 的翻版：中央述詞寫好 ≠ 消費點有接

## 玩家回報

> 「傳說的熔岩洞 沒有消除掉 護城龍 的【特性】太古防壁。」

## 卡面查證（只採 `static/cards` 台灣官方卡面）

| 卡 | 欄位 | 逐字 |
|---|---|---|
| 傳說的熔岩洞 (M6 075/076 id=19623、076/076 id=19626，兩張 `rulesText` 完全相同) | `rulesText` | 「雙方場上所有進化寶可夢的特性全部消除。」 |
| 護城龍 (M5 19204 / 19256、M-P-J 19237) | `stage` / `subtype` / `evolvesFrom` | `Stage2` / `Stage2` / `盾甲龍` ⇒ **進化寶可夢** |
| 護城龍｜太古防壁 | `abilities[].effect` | 「只要這隻寶可夢在備戰區，自己的所有寶可夢不會受到對手身上附加的能量為2個以下的寶可夢招式的傷害。」 |

⇒ **卡面判定：熔岩洞應消除太古防壁。玩家回報成立。**（與 v6.145 的化石案相反方向：
化石在場上是【基礎】寶可夢所以**不該**被消除，護城龍是 Stage2 所以**該**被消除。）

## 真因（指到行號，行號為 BASE 62d437cd 的座標）

中央述詞 `isAbilityHolderEffective`（`v3001_g3_wave3.ts:208`）判得**完全正確** ——
行為端實測有熔岩洞時對護城龍｜太古防壁回 `false`。壞的是**消費點**：

| 消費點 | 位置（BASE） | 原本寫法 |
|---|---|---|
| 太古防壁 | `defense.ts:129` `taikoBariBlocksAttackDamage` | `c?.abilities?.some(a => a.name === '太古防壁')` |
| 光之翼 | `defense.ts:174` / `effects.ts:7819`、`7996` / `engine.ts:5993`、`6505`、`7058` | 同上，只比對特性名 |
| 球形盾牌／潛者捕捉／奇跡之吻／熔岩波動 | `v3000_g3_wave2.ts:73` local `hasAbilityOnSide` + `:89` local `hasAbilityOnActive` | 同上 |
| 爆大身軀／瞪眼效用／海之詛咒／熔岩地域／漩渦言靈／凹洞／黑暗脈衝 | `v3001_g3_wave3.ts:61` local `hasAbilityOnSide`；`:88` `hasAbilityOnActive`（只接了「暗夜羽擊」一個消除來源） | 同上 |

**全部都沒問「這個特性此刻有沒有被消除」。** 而這一族的持有者查下來幾乎全是**進化寶可夢**：
蟲甲聖 Stage1／獵斑魚 Stage1／波克基斯 Stage2／鴨嘴炎獸 Stage1／大王銅象 Stage1／
火箭隊的阿柏怪 Stage1／胖嘟嘟ex Stage1／熔岩蝸牛 Stage1／夢妖魔ex Stage1／
火箭隊的三地鼠 Stage1／火箭隊的電龍 Stage2／超級皮可西ex Stage1／護城龍 Stage2
⇒ **13 個同型 outlier，不是只有太古防壁一張。**

## 跨卡 audit 維度：「場地卡／特性消除特性」的消費點涵蓋度

H/I/J live 卡面枚舉「消除特性」的來源共 6 種：
傳說的熔岩洞（進化）／火箭隊的監視塔（【無】）／鐵荊棘ex｜初始化（規則寶可夢，未來除外）／
振翼髮｜暗夜羽擊（對手戰鬥位）／海兔獸｜黏著束縛（備戰【2階進化】）／可達鴨・哥達鴨｜濕氣（將自己昏厥的特性）。

逐一檢查每個「防禦型／field-passive 型」特性的消費點：

| 特性 | 持有者 | 消費點狀態 |
|---|---|---|
| 花之帷幔 | 謝米 Basic | ✅ 已 gate（`effects.ts:298`） |
| 抵抗之幕 | 火箭隊的急凍鳥 Basic | ✅ 已 gate（`effects.ts:326`） |
| 化隱 | 斯魔茶／來悲粗茶／怨影娃娃／詛咒娃娃 Basic | ✅ 已 gate（`defense.ts:189`） |
| 守護之鐘／齒輪塗層 | 青銅鐘／齒輪怪 | ✅ 已 gate（`v2999:234`／`:278`） |
| **太古防壁** | 護城龍 Stage2 | ❌ **無 gate → 本次修正** |
| **光之翼** | 超級皮可西ex Stage1+ex | ❌ **無 gate → 本次修正**（熔岩洞＋初始化 兩個來源都應消除） |
| **球形盾牌** 等 v3000 家族 4 個 | 全 Stage1/Stage2 | ❌ **無 gate → 本次修正** |
| **爆大身軀** 等 v3001 家族 7 個 | 全 Stage1/Stage2 | ❌ **只接了暗夜羽擊 → 本次修正** |
| 藏隱／深度下潛 | 斯魔茶 Basic(Grass)／小霞的鯉魚王 Basic(Water) | ⚠ 無 gate，但**目前無任何 live 消除來源打得到**（非進化、非【無】、非規則、非備戰2階；而暗夜羽擊只作用 active、這兩個特性 bench-only）→ 本輪不動，記錄在案 |

## 收斂做法

新增中央述詞 `hasEffectiveAbilityByInst(state, ownerIdx, inst, pool, abilityName)`，
`location` 由 inst 是否等於該玩家 active **自動判定**（呼叫端自己算就會漂）。

⚠ 放在 `defense.ts` 而非 v3001 卡檔：`anti-pattern-lint` **Check O**（底層模組反向 import 卡檔的
symbol 白名單「只准縮不准擴」）。`defense.ts` 早已合法持有 `isAbilityHolderEffective`，
`engine.ts` / `effects.ts` 也早已 `import … from './defense'` ⇒ 不新增任何反向 edge。
（第一版把它寫在 v3001 並讓 defense/effects import，lint 直接紅。）

- `defense.ts`：`taikoBariBlocksAttackDamage` 與光之翼分支改走新述詞。
- `engine.ts` ×3、`effects.ts` ×2：光之翼全部改走新述詞。
- `v3001_g3_wave3.ts`：`hasAbilityOnSide` 加 gate 並 export；`hasAbilityOnActive` 的
  `isOppActiveAbilityNullifiedByMoonsenne` 升級為 `isAbilityHolderEffective(...,'active')`
  （嚴格擴充：中央述詞 step1/step2 已含原本那兩個來源）。
- `v3000_g3_wave2.ts`：**整份刪掉 local `hasAbilityOnSide`/`hasAbilityOnActive`**，改 import
  v3001 中央帶 gate 版 —— 杜絕 local helper 遮蔽中央版。

⚠ **遞迴分析**（改前就先做，否則會炸）：`isAbilityHolderEffective` 的 sticky(黏著束縛) 分支
只在 `location === 'bench'` 觸發，且它偵測持有者走的是 `hasAbilityOnBench`（**未加 gate 的版本**）；
暗夜羽擊分支對 `abilityName === '暗夜羽擊'` 早退 ⇒ 兩條可能的自我遞迴路徑都不成立。
**`hasAbilityOnBench` 刻意不加 gate**，加了就是無窮遞迴。

## 守衛

`scripts/test-v6196-legend-cave-passive-gate.mjs`（13 步）進 test chain。
HEAD-FAIL 證明：把 5 個改過的檔還原成 BASE blob 重跑 → **8 FAIL / 5 PASS**；修後 13 PASS。
含：卡面逐字錨（rulesText／stage／effect 變了要紅）、掃描器下限斷言（抓不到卡＝紅，不是安慰劑綠）、
完整 `applyAction ATTACK` 流程（不是只手動戳 helper）、v6.145 化石豁免回歸、
否定型守衛「v3000 不得再有 local helper」**配正對照**（餵違規樣本確認判準抓得到）。

## 沒有改的

`static/cards` 卡面資料、AI、UI、錦標賽伺服器邏輯皆未動。
`oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 已同步 bump 到 6.196。

# v6.195 跑馬燈的 ✕ 被動態島吃掉 —— v6.187 只修了「容器」，沒修「容器裡的按鈕」

## 站長回報

> 「手機版的跑馬燈，似乎在 v6.187 改版後，跑馬燈的 ✕ 就按不到了（受 iPhone 動態島的影響）。」

「跑馬燈」= `.admin-broadcast-bar`（`src/routes/game/+page.svelte`）。
站內只有這一個會跑動、有 ✕、貼在畫面最上方的元件：管理員系統廣播（紫粉底）與
玩家社群賽募集（`.community` 綠底）共用同一條 bar，桌機與手機直式也共用同一段
template（在 `.battle-root` 內、`MobilePortraitBattle` 的 `{#if}` **之前**），
所以一處修好兩邊都好。`marquee` 這個字全 repo 只出現在這個元件的
`marqueeDur()` / `broadcastMarquee`，交叉驗證無其他候選。

## 真因（求值，不是猜）

v6.187 把 bar 本身改成：

```
box-sizing:border-box; padding-top:var(--safe-top, 0px);
height:calc(34px + var(--safe-top, 0px));
```

**整條 bar 讓開了動態島**，所以跑馬燈文字從「看不到」變成「看得到」。
但同一版**沒有動裡面那顆 ✕**：

```
.admin-broadcast-close{ position:absolute; right:6px; top:50%; transform:translateY(-50%); 22x22 }
```

絕對定位的 `top:50%` 是相對 **containing block 的 padding box**，
而 padding box 已經被 v6.187 撐成 `34 + 59 = 93px` ⇒
圓心 `93 x 50% = 46.5px`、整顆佔 `35.5px ~ 57.5px`，**完全落在 iPhone 15 Pro 的
59px 安全區裡** ⇒ 按不到。新守衛的內建 fixture 用 v6.194 的舊 CSS 算出的就是這組數字。

### ⚠ 誠實對照：v6.187 **之前**也按不到

v6.187 之前 `.admin-broadcast-bar` 是 `height:34px`、沒有任何 safe-area，
整條 bar（含 ✕）都在 59px 動態島底下 ⇒ ✕ 一樣按不到，只是連文字都看不到。
所以**嚴格說「✕ 按不到」不是 v6.187 造成的新回歸**；v6.187 是「把容器修好、
把裡面的按鈕留在原地」，讓這個一直存在的問題從「整條看不見」變成
「看得見卻按不掉」，因此才在 v6.187 之後被察覺。實作上仍算 v6.187 的**未竟修正**。

## 修法（沿用 v6.187 的同一個單一來源，不另寫一份）

`.admin-broadcast-bar`：內容列高度改成 `34px + min(10px, var(--safe-top, 0px))`

- `--safe-top: 0px`（電腦／Android／非瀏海機）→ `min(10px, 0px) = 0` ⇒ 內容列 34px、
  bar 高 34px，**與 v6.194 逐像素相同**（正對照守衛②實際求值比對）。
- `--safe-top: 59px`（動態島）→ 內容列 44px、bar 高 `59 + 44 = 103px`。

`.admin-broadcast-close`：

- `top:var(--safe-top, 0px)`（不再用 `50%`，因為 50% 會把 padding-top 一起算進去）
- `height: 34px + min(10px, var(--safe-top, 0px))`、`width: 44px`
  ⇒ iPhone 上可點區 = `y 59~103`、`44 x 44`，**完全在安全區之外**，
  且下緣剛好等於 bar 的 padding box 下緣（bar 是 `overflow:hidden`，超出會被裁掉點不到，
  守衛有釘住這一條）。
- `right: var(--safe-right, 0px)`（橫放時右側瀏海也讓開）。
- 可見的 22px 圓圈改由 `::before` 畫；`::before` 的 `top:50%` 相對的是**按鈕自己**的
  內容列，所以 `--safe-top:0` 時圓心仍在 17px、距右緣仍 6px、直徑仍 22px。
  按鈕本體 `font-size:0` 以免文字節點與 `::before` 畫出兩個 ✕；`aria-label` 保留。
- bar 另加 `padding-left:var(--safe-left, 0px)`（橫放左瀏海），`--safe-left:0` 時無影響。

⚠ 觸控區在 `--safe-top:0` 時是 **44x34**（bar 只有 34px 高，且 `overflow:hidden` 會裁）。
要在桌機也做到 44x44 就得把 bar 加高，那會動到非 iPhone 版面 ⇒ 不做。
**44x44 只保證在真正需要的動態島情境成立。**

## z-index 現況（沒有改，但要記著）

v6.187 把 `.opp-inactive-banner` 從 1000 提到 100000，**高於** `.admin-broadcast-bar`(99999)。
兩者同時出現時（對手掛機 + 剛好在播廣播），紅鈕橫幅會蓋住跑馬燈整條、連 ✕ 一起。
這是 v6.187 的**刻意取捨**（紅鈕影響勝負，必須在最上層），本版維持不動。

## 順手收乾淨：全站零裸 `env(safe-area-inset-*)`

v6.187 的守衛③只掃 `game/+page.svelte` 與 `MobilePortraitBattle.svelte`，
而且只看「有明確 `top`/`bottom` 的 fixed 元素」。實跑枚舉全站 11 個 `.svelte` 後：

- **貼上/下緣的 bar 共 19 條，v6.187 全部都已經讀 `var(--safe-*)`** ——
  這一類**沒有漏網**（`.admin-broadcast-bar` / `.admin-spy-banner` / `.tourn-alert-banner` /
  `.tourn-toast` / `.tourn-idle-warn` / `.opp-inactive-banner` / `.restart-waiting-strip` /
  `.treplay-mob` / `.chat-fab` / `.chat-panel` / `.opp-turn-panel` / `.opp-turn-toggle-btn` /
  `.restart-rejected-toast` / `.tourn-return-bar` / `.tourn-still-here` / `.mp` …）。
- 真正漏的是 **31 處還各自寫 `env(safe-area-inset-*)`** 的地方
  （`src/routes/+page.svelte` 1、`cards` 4、`decks` 4、`deck-posts` 10、`game/+page.svelte` 15、
  `+layout.svelte` 自己 2），
  以及其中 4 個 **`inset:0` 全螢幕遮罩且 `align-items:flex-start`**（內容靠上，
  最上面那排會被動態島吃掉）：`game` 的 `.zoom-overlay` / `.lightbox-overlay` / `.pv-overlay`、
  `decks` 的 `.pv-overlay`、`cards` 的 `.modal`。
  全部改讀 `var(--safe-*, 0px)`。⚠ 對**支援 env() 的瀏覽器**（= 所有 iOS/Chrome/Safari）
  數值完全相同；只有「不支援 env()」的老瀏覽器從 `2rem` 變成 `0`，而那些規則本來就
  另有一行不含 env 的 fallback 宣告（例如 `.lightbox-close{ top:4rem; top:calc(env(...)+1.5rem) }`）。
  `env(safe-area-inset-top, 0)`（無單位 0，在 `calc()` 內其實是 invalid）也一併修正成 `0px`。

## 守衛 `scripts/test-v6195-marquee-close-tap-target.mjs`（81 條）

HEAD-FAIL 實證：對 v6.194 樹跑 ⇒ **17 條紅**（含 ✕ 可點區上緣算出 35.5 < 59、
觸控區只有 22x22、6 個檔案仍有裸 env、4 個靠上遮罩沒讓開、`.mp-sheet` 下緣沒讓開、
④b2 算出 `.admin-broadcast-close` 上緣 35.5）。對本版跑 ⇒ 81 綠。

1. **自我先驗**：剝註解器、CSS 長度求值器（`calc`/`min`/`max`/`var`/`%`/`translateY`）、
   規則解析器（含 `::before`）、`<style>` 切點（必須切在標籤**之後**，否則會靜默漏掉第一條規則）。
2. **內建 HEAD-FAIL fixture**：把 v6.194 的舊 CSS 直接餵進版面模型，
   必須算出 `hitTop=35.5 / hitBottom=57.5 / 22x22` —— 證明偵測器真的偵測得到。
3. **①核心（求值）**：`--safe-top:59px` ⇒ ✕ 可點區上緣 ≥ 59、尺寸 ≥ 44x44、
   下緣 ≤ bar padding box（不被 `overflow:hidden` 裁）、可見圓圈上緣也 ≥ 59。
4. **②正對照**：`--safe-top:0px` ⇒ bar 高 34px、圓心 17px、距右 6px、直徑 22px
   —— 與 v6.194 逐像素相同（非 iPhone 版面 0 位移）。
5. **③template 端**：✕ 還在、`onclick` 仍會把 `broadcastMarquee` 清成 `''`、`aria-label` 還在
   （按鈕本體 `font-size:0` 之後，輔助技術只剩 aria-label）。
6. **④枚舉守衛（防未來漏網）**：走訪 `src/` 全部 `.svelte`，
   （a）除 `+layout.svelte` 外**不得**再出現 `env(safe-area-inset-*)`；
   （b）每一條 `position:fixed` 且貼上/下緣的規則逐條求值，必須讀對應的 `var(--safe-*)`
   （只看 top/padding-top/height/inset，不是整條規則亂找）；四邊釘死的全螢幕遮罩豁免，
   但 `align-items:flex-start`（內容靠上）／`flex-end`（內容靠下）者不豁免。
   （b2）貼上緣容器內的 `position:absolute` 子元素，代入 59px 求出的上緣必須 ≥ 59。
   另有「枚舉真的掃到 ≥15 條」「④b2 真的掃到 ≥1 個」的反空轉斷言 —— 掃不到跟全綠長得一樣。
7. **⑤沒有新增 `@media` 當手機開關**：`game` ≤ 19、`MobilePortraitBattle` 維持 0。

## 審查子代理（opus）抓到的、以及我逐條查證的結果

1. 🔴 **真漏網：`MobilePortraitBattle.svelte` 的 `.mp-sheet`（手機直式底部動作面板）**。
   實查 `.mp-sheet-overlay{ position:fixed; inset:0; align-items:flex-end }`（:1831）⇒ sheet 貼齊
   螢幕**下緣**，而 `.mp-sheet{ padding: 0.8rem 1rem 1.2rem }`（:1846）的下緣只留 19.2px
   < home indicator 的 34px ⇒ 最後一顆「取消」鈕（`.mp-sheet-cancel`，高約 34px）下半部壓在
   home indicator 上。**與本版完全同型**（容器貼邊、裡面的鈕沒讓開）。
   ⇒ 改成 `padding: 0.8rem 1rem calc(1.2rem + var(--safe-bottom, 0px))`；`--safe-bottom:0` 時仍是 1.2rem。
   ⇒ 守衛 ④b 新增「`inset:0` + `align-items:flex-end` 的遮罩，其 sheet 的 padding-bottom 必須讀
     `var(--safe-bottom)`」，對 v6.194 樹跑會紅。
2. ✅ **其他貼邊 bar 實查乾淨**：自寫掃描器枚舉全站 `.svelte`，
   `.tourn-alert-banner` / `.opp-inactive-banner` / `.treplay-mob` / `.tourn-toast` /
   `.admin-spy-banner` / `.tourn-idle-warn` / `.restart-waiting-strip` / `.mp`
   的子元素**全都是 flex item、沒有任何 `position:absolute`**
   （實跑 `/tmp/w/kids.mjs`：全站只有 `.admin-broadcast-*` 這一族有 absolute 子元素）。
3. 🔴 **守衛假綠 (a)**：④b 原本把整條規則 `JSON.stringify` 後找 `var(--safe-top`，
   結果 `max-height:calc(100vh - var(--safe-top))` 這種與位置無關的宣告也算過。
   實測注入 `.zz-probe-a{ position:fixed; top:0; max-height:calc(100vh - var(--safe-top,0px)) }` ⇒ 舊版全綠。
   ⇒ 改成只看 `top` / `padding` / `padding-top` / `height` / `inset`（下緣同理），注入後實測轉紅。
4. 🔴 **守衛假綠 (b)（最重要）**：本版的 bug 型態**沒有被通則化** ——
   ④b 只掃 `position:fixed`，完全不看貼邊容器裡的 `position:absolute` 子元素；
   `.admin-broadcast-close` 只靠 ①/② 硬寫選擇器保護，換個類名就掉出保護網。
   ⇒ 新增 **④b2**：Svelte 的 CSS 是扁平 class 選擇器，所以依專案命名慣例把
   `.admin-broadcast-bar` 推導成前綴 `.admin-broadcast`，找同族的 `position:absolute` 規則，
   代入 `--safe-top:59px` 求出上緣（含 `translateY` 位移）必須 ≥ 59。
   ⚠ 偽元素 `::before`/`::after` 跳過（containing block 是宿主，不是這條 bar）。
   ⚠ 前綴至少要含一個 `-`（避免 `.tourn-toast` → `.tourn` 這種過寬前綴誤傷）。
   實測注入 `.zz-probe-b-bar` + `.zz-probe-b-x{ absolute; top:50%; translateY(-50%) }` ⇒ 轉紅，
   訊息直接印出「算出 35.5（bar 高 93）」。另加「④b2 掃到 0 個就紅」的反空轉斷言。
5. 🔴 **④a 原本整檔豁免 `+layout.svelte`** ⇒ 同檔案的 `.beta-banner`(:169) 與
   `.migration-banner`(:200) 兩條真的還在寫裸 `env()` 卻永遠掃不到。
   ⇒ 兩條改讀 `var(--safe-top, 0px)`；守衛改成**只豁免那一段 `@supports`**，
   並加「切掉的字元數 > 0 且切完真的沒有 `--safe-top: env(`」的自我驗證。
6. ✅ **`::before` 的 `font-size:.78rem` 是 rem 不是 em** ⇒ 不受按鈕 `font-size:0` 影響（查證屬實）。
   `background:none` 只是把原本畫在按鈕本體的底色搬到 `::before`，外觀不變。
   Svelte 沒有把 `::before` 當 unused selector 剪掉：base 與 work 的 compile warning 數
   **完全相同（game 98 / 98，MPB 0 / 0，layout 0 / 0）**。
7. ⚠ **沒改、但記著**：`.treplay-bar`（`+page.svelte:13349`）是 `position:sticky; top:0` 且沒讀
   `--safe-top`（桌機回放列，手機走 `.treplay-mob`）；首頁 `.modal-overlay` 沒讀
   `--safe-left/--safe-right`（橫向瀏海）。兩者都不是本版 `position:fixed` 貼邊的守備範圍，
   風險低，本版不動以免擴大改動面。

## 沒能驗證的

- **真機**：沒有 iPhone 動態島實機可測，全部結論來自 CSS 版面模型求值
  （`env(safe-area-inset-top)` 在 iPhone 15 Pro PWA 直式 = 59px 為已知值）。
- `::before` 的觸控命中：桌面瀏覽器行為明確（偽元素屬於按鈕的命中區），
  但本版的可點區本來就是**按鈕本體** 44x44，`::before` 只負責畫圓圈，不依賴偽元素命中。

---

# v6.194 站長改判：港版重複卡「資料留著、玩家選不到」＋ 基本能量 metadata 對齊官方

## 為什麼要改 v6.193

v6.193 依站長當時的裁定把 18965／18969 **從 `static/cards/M-P-J.json` 刪掉**，
並用 `RETIRED_DUP_TO_TW_ID` 把牌組裡的舊 id 對照回台版。站長本輪改判（原文照抄）：

> 「那 2 組港版就先存在資料裡面就好，但請從卡牌資料庫和牌組編輯器裡面把連結移除，
>   讓之後的玩家不會再誤選到。」

**改判是對的，而且 v6.193 有一個當時沒被涵蓋的破口**：`RETIRED_DUP_TO_TW_ID` 只在
`migrateDeck` / `createGame` / `deckEntriesAllInPool` / `loadDeckSets` 這幾個
「以 **牌組 entry** 為單位」的入口生效，但**對戰回放不是**。
`tournament-dumps` 的 dump\_20260720\_094446.json 裡有玩家真的用過這張卡的場次，
回放快照長這樣（原文照抄）：

```
{"iid":"tp8phnwl","cardId":"18965","damage":630,"energyAttached":[...]}
```

`tReplayGoto()` 是把快照**直接**塞回 `game`，中間沒有任何 migrate 機會；
卡池裡沒有 18965 時，engine 的 `getCard()` 會 throw（v5.336 同一條路徑）。
新守衛 ④ 用行為端實跑釘住這一條，並附「真的查無的 id 必須 throw」的正對照 ——
否則「沒有 throw」跟「這條斷言根本沒跑到」長得一樣。

⇒ **下架 ≠ 刪除**。資料留在卡庫（因此也留在 `tournament-pool.json`），
只是不出現在任何「玩家挑得到」的清單裡。

## 中央收斂：全站只有一份「這張卡要不要對玩家開放」

新檔 `src/lib/cards/visibility.ts`（零 import 的葉子模組，不會造成循環相依／TDZ）：

- `HIDDEN_FROM_PLAYERS`：`{ id → { replacementId, reason } }` ——**唯一**的排除清單。
- `isHiddenFromPlayers(id)` / `resolvePlayerFacingCardId(id)` / `filterPlayerSelectable(cards)`。

`src/lib/decks/cardIdMigration.ts` 的 `RETIRED_DUP_TO_TW_ID` 改成**由它推導**
（`Object.fromEntries(...)`），不再是第二份字面量清單。守衛用剝註解後的枚舉掃 `src/` 全樹，
除了 `visibility.ts` 之外任何檔案出現 `'18965'` / `'18969'` 字面量就紅（含正對照與剝註解自驗）。

### 接上的消費點

| 消費點 | 檔案 | 做法 |
|---|---|---|
| 卡牌資料庫 `/cards`（ALL 與單一卡包兩條路徑） | `src/routes/cards/+page.ts` | `filterPlayerSelectable()` |
| 牌組編輯器的候選／搜尋 | `src/routes/decks/+page.svelte` | `pool = filterPlayerSelectable(allCards)` |
| SEO 卡片頁預渲染 + sitemap | `src/lib/server/cardIndex.ts` | `getStdCardIds()` 跳過 |
| 貼卡表匯入 `{count} {name} #{id}` | `src/routes/decks/+page.svelte` | `resolvePlayerFacingCardId()` |
| 官網代碼匯入 | 同上 | 同上（冪等） |
| 既有牌組載入 | `cardIdMigration.migrateDeck` | 沿用 v6.193 的對照 |

⭐ **分界在 `pool` 與 `poolById`**：
`pool`（陣列）＝可挑選／可搜尋，**濾**；`poolById`（Map）＝畫得出來的卡，**不濾**。
`filteredPool` / `poolBySetNum` / `poolByName` / `sameNameVariants` / `previewChain` /
`chainNames` 全部由 `pool` 衍生 ⇒ 濾一處、所有候選一起消失；
而 `activeEntries` / `validateDeck` / `deckStats` 走 `poolById` ⇒ 已存牌組**不會變成缺卡**。
若把 `poolById` 也濾掉，那張卡的 entry 會直接從畫面消失、張數少 N —— 守衛把這兩行都釘住了。

## 基本能量 metadata（16 張）

取值方式：`curl` 台灣官方
`asia.pokemon-card.com/tw/card-search/detail/{id}/`，
解 `span.pageHeader`（卡名）／`span.alpha`（賽制標）／`span.collectorNumber`（卡號）三個欄位，
16 張逐頁實測（**沒有憑印象、沒有查外文 Wiki**）。

- `7815~7822`：`collectorNumber` 由 `257~264/SV-P` 改成官方的
  `GRA` / `FIR` / `WAT` / `LIG` / `PSY` / `FIG` / `DAR` / `MET`。標本來就是 J，正確。
- `13128~13135`：`regulationMark` 由 `I` 改成官方的 `J`。

### 搬檔（做了，理由如下）

拆檔規則來源 `scripts/split-mp-v116.mjs`：M-P / SV-P 的 promo 依**卡片的** `regulationMark`
分檔，`setCode = \`SV-P-${mark}\``。實測 BASE 的 6 個 promo 檔（M-P-H/I/J、SV-P-H/I/J）
**每一張卡的標都與檔名相符，零例外**；只改標不搬檔，就會由我親手打破這條不變式。
另有 `test-card-db-integrity.mjs` 的「setCode 必須等於所在檔名」硬性守衛。
⇒ 13128~13135 從 `SV-P-I.json` 搬到 `SV-P-J.json`（`setCode` 同步改）。

搬運校驗和：搬過去的 8 張逐欄位 diff，**變動欄位集合恰為 `{setCode, regulationMark}`**；
全庫逐張 sha256 比對，內容有變的剛好 16 張（8 張改號 + 8 張搬檔），其餘 4919 張雜湊不變。
`index.json` 手術式更新（**沒有跑 build-sets-index.js**）：
`M-P-J` 90→92、`SV-P-I` 30→22（Energy 8→0，該鍵移除）、`SV-P-J` 13→21（Energy 8→16）；
`card-set-map.json` 4933→4935。live 總張數 4935 = index.json 宣告值。

⚠ 副作用：舊的文字牌表若寫成 `4 基本【草】能量 SV-P-J 257/SV-P` 會對不上 (setCode, 卡號)。
⇒ 匯入的 Format A 加了「對不上就退回卡名精確比對」的 fallback（與既有 Format E 同一手法，
會列進歧義提示），免得玩家手上存的牌表整份匯不進來。

⚠ **卡名刻意不動**：官網對 GRA/FIR/… 那批印刷顯示的是「基本草能量」（無【】），
但 `getBasicEnergyType()` 是**讀卡名**推屬性，全庫 80 張基本能量一律用「基本【X】能量」；
只改這 8 張會讓屬性推不出來。守衛把「不要順手改」也釘住了。

## 守衛

新增 `scripts/test-v6194-hidden-cards-and-energy-metadata.mjs`（20 PASS）進 test 鏈。
在 BASE 上跑：不補 `visibility.ts` 直接 build 失敗；補上讓它 build 得起來後 **FAIL 13 條**。
既有守衛同步：`test-v6193-hk-dup-and-boss-rename.mjs` 的 ①（原本斷言「必須從卡庫消失」）
反轉成「必須還在卡庫」並改註解說明改判緣由；`test-card-db-integrity.mjs` 的
`IMG_EXCEPTIONS` 把兩筆 hk 圖床網址放回來。

# v6.193 港版重複卡下架 ＋「老大的指令（烏羽）」改名（站長兩個裁定）

站長 2026-08-15 兩個裁定：
1. `M-P-J.json` 裡兩筆**香港版重複卡**刪掉，只留台版
   —— 18965 超級妖火紅狐ex 103/M-P（台版 18560）、18969 古歷 107/M-P（台版 18564）。
   > 「就算影響玩家的牌組也沒關係，那張牌本來就少人用。」
2. `M-P-I.json` id 19630（215/M-P，I 標）`name` 從「老大的指令（烏羽）」改成「老大的指令」。

這兩筆早在 v6.191 的內部紀錄就被列為待裁定（「官方查無此 id、與 18560/18564 編號完全重複，
疑似 v6.116 大量 clone 時多產的；沒有動它們，等站長決定」）。

## 刪卡前先查證「兩張是不是真的同一張卡」

逐欄位比對（排除 `id` / `imageUrl` / `sourceUrl` / `scrapedAt`）：**18560 vs 18965 完全相同、
18564 vs 18969 完全相同**。差別只有圖床（`…/hk/card-img/hk000*.png` vs `…/tw/…/tw000*.png`）。

連帶處理：`index.json` M-P-J 92→90（含 supertypeCounts Pokemon 75→74 / Trainer 8→7，
手術式改那一個物件，**沒有用 build-sets-index.js 重生**）、`card-set-map.json` 4935→4933、
`test-card-db-integrity.mjs` 的 `IMG_EXCEPTIONS` 移除那兩筆（否則「例外表腐爛項」會紅）、
`test-dual-status-converge.mjs` 的測試卡 id 18965→18560。

## ⭐⭐⭐ 這一版真正的重點：刪卡的優雅降級（比刪卡本身重要）

**行為端實測**（不是讀碼推論）：把那兩個 id 從 pool 拿掉、牌組仍引用它 ⇒
`engine.ts` 的 `getCard()` 找不到卡**直接 throw**，那張卡一上戰鬥位攻擊就
`Card not found in pool: 18965` —— **整局卡死**。這與 v5.336 的事故是同一條路徑
（當時的註解就寫著「UI 顯示『？/HP 0/0』，且一旦行動立即 throw → 整局卡死」）。

⇒ 修法沿用站內既有的中央機制（`migrateCardId` 的對照表），新增
`RETIRED_DUP_TO_TW_ID`（18965→18560、18969→18564）。既然兩者是同一張卡，
對照回台版是最無感的降級：**玩家牌組張數不變、對戰照打**，不是「顯示缺卡」。

三個連帶的洞（審查子代理抓到、我逐條查證屬實）：

| 入口 | 不修會怎樣 | 修法 |
|---|---|---|
| `migrateDeck()` | 牌組同時有 18560 與 18965 ⇒ 對照後**兩筆同 cardId**，牌組編輯器 `{#each …(card.id)}` 重複 key = 整頁 runtime error | 新增 `mergeDuplicateEntries()`，merge 排在 two-card-stadium split **之前** |
| `deckEntriesAllInPool()`（`cards/pool.ts`） | 線上房建局 gate 用**未 migrate** 的 `seat.deckEntries`，那張卡永遠補不進 pool ⇒ 重試 6 次後「建局卡住：缺少卡片 id：18965」，**房間開不了局**（不崩潰但玩不了） | gate 內先 `migrateCardId` |
| `loadDeckSets()`（同檔） | `card-set-map` 查不到 18965 ⇒ 進 `missingIds`、卡包永遠載不到；牌組公布欄舊投稿那列顯示「本站沒有這張卡」 | 查表前先 `migrateCardId`；`deck-posts` 顯示端加一層 fallback |

⚠ `deckEntriesAllInPool` / `loadDeckSets` 是**不經 `createGame`** 的 cardId 入口 ——
`createGame` 的 migrate（v5.336 加的）擋不到它們。教訓：**加對照表時要問「還有哪些入口
不經過那個咽喉點」**，不能只修咽喉點就宣告安全。

## 改名：reg key 是卡名，所以改名＝換一把鑰匙

v6.191 為「老大的指令（烏羽）」在 `gust-supporters.ts` 的 `GUST_SUPPORTER_NAMES` 加了一項，
由 `registerGustSupporter()` factory 逐名登錄。改名後那一項變成**零產出的死條目**
（清單裡的卡名在卡庫已不存在）⇒ 刪掉，只留「老大的指令」；19630 自動吃到既有那份註冊。

**行為端驗證**（不是驗字串）：用 `pool.get('19630').name` 當 key 實跑
→ gate ＝ true → 開 `opp-bench-choose` picker（`effectKey: 'gust-opp'`、minCount/maxCount 1、
validIids ＝ 對手備戰 2 隻）→ `RESOLVE_SELECTION` → 對手備戰真的換上戰鬥位、原 active 回備戰。
另驗 fail log 含「化石/」指紋，證明生效的是 `supporters_gust.ts` 的 factory 版
（不是被別的檔重複註冊覆蓋掉的舊版）。

`v6191_official-completeness` 的靜態守衛原本只掃 `'老大的指令（烏羽）'` 這個字面量 ——
改名後它會變成**永遠綠燈的安慰劑** ⇒ 放寬成掃任何 `reg…('老大的指令` 開頭，並補正對照。

## v6.192 的 `sameNameKey()`：保留不動，但守衛要改寫

站長指示保留（通則守衛，官方再發括號卡名時要擋得住）。但改名後**卡庫一個括號卡名都沒有**了：
- `test-v6192-same-name-art-variant.mjs` 的 ①②③ 原本拿真卡跑 ⇒ 改用**合成卡**
  （真卡複製一份、只換 name/id，只存在於測試的 byId 副本）驗機制。
  以 mutation 驗過保護力沒退化：把 `ART_SUFFIX_RE` 停用後該守衛 10 條紅。
- ⑦「已判讀括號卡名」清單清空（留著會被它自己的「腐爛項」那條抓紅）。清單一空，⑦ 就變成
  **永遠 PASS 的安慰劑** ⇒ 補了用同一條判準（括號正則 ＋ 查表）的正／反對照。
  ⚠ 第一版的正對照寫成 `['…（赤日）'].filter(n => !REVIEWED.has(n)).length === 1`，
  清單空時對**任何字串**都成立（連空字串都過）—— 是審查子代理抓到的，這種套套邏輯要特別警覺。

## 官方完整性守衛沒有受影響

`scripts/data/official-set-manifest.json` 的 M-P 快照（163 個 id）**本來就沒有 18965/18969**
（官方 detail 頁 404），也不在 `knownNonHIJ` 豁免表 ⇒ 刪卡後
`test-official-set-completeness` 仍 8 PASS，**不必動快照、不必加豁免**。
「豁免表腐爛項」那條也不會誤報（本來就沒列管）。

## 只回報、沒有動的（等站長裁定）

- admin 三份「去括號」副本（`server_admin_patch.js` 的 `normCardName`、
  `admin.html` L526/L564 的 `computeCanonicalKey`/`displayName`）：三份都是**先 strip 括號再比對**，
  所以改名前後 canonical key 相同，**缺口自動消失、行為零差異**。
- `server_admin_patch.js` 的 `deckToSets` / `deckMatchesRule` 用的是**未正規化**的原始卡名 ⇒
  改名讓比對**變準**（原本只放 19630 的牌組會漏命中 `includes:['老大的指令']` 的原型規則）。
  ⚠ 唯一殘餘風險：Mongo `deckRules` 若有人手寫過「老大的指令（烏羽）」，那條規則從此永不命中。
- 全庫仍有約 500 組 `(卡名|編號|卡包)` 完全相同的重複 id（M2a / MC / SV8a / SV11B / SV11W 等）。
  本版的判據是「hk 圖床」（現為 0 張），沒有一併處理那些。

# v6.192 「括號冠名 ＝ 同名卡」收斂成單一分組 key（站長裁定）

站長 2026-08-15 裁定：**「老大的指令」和「老大的指令（烏羽）」算同名卡**
⇒ 牌組「同名卡最多 4 張」必須共用同一份額度（合計 4 張，不是各 4 張）。

## 先查證：現行行為到底是什麼（沒有只讀碼推論）

| 查證項 | 結果 |
|---|---|
| 兩張卡的 `name` 實際字串 | `老大的指令`（13 個印刷）／ `老大的指令（烏羽）`（1 個，`static/cards/M-P-I.json` id 19630、215/M-P、I 標）。括號是**全形** `（）`，就寫在 `name` 欄裡，不是另一個欄位。 |
| `validation.ts` 的分組 key | BASE L213 `byName.set(card.name, …)` —— **逐字 `card.name`**，沒有任何正規化／別名。 |
| **行為端實跑** `validateDeck` | 老大的指令×4 ＋（烏羽）×4 ＋ 1 基礎寶可夢 ＋ 51 基本能量 = 60 張 ⇒ **`legal=true`、`issues=[]`**。`sameNameTotal(deck,'老大的指令')` 回 4（不是 8）、`remainingCapacity(deck,（烏羽）)` 回 4。**確認是漏洞，8 張真的過。** |
| 全站括號卡名枚舉 | live 卡包（`index.json` 42 包 / 4935 張 / 1506 個卡名）裡帶括號的卡名**只有這一個**。 |

## 為什麼敢一般化（而不是為「老大的指令」寫死特例）

1. **站內早就有同一條規則**：`src/routes/decks/+page.svelte` L316 的 `stripArtSuffix()`
   （v5.381）就是 `/[（(][^（()）]*[）)]\s*$/`，註解寫著「去藝術版本後綴（例：
   「老大的指令（赤日）」→「老大的指令」）」。⇒ 一般化不是我發明的，是把既有規則收斂。
2. 卡庫零反例（上表）。
3. ⚠ 但「今天沒有反例」≠「永遠不會有」⇒ 留 `SAME_NAME_PAREN_EXCEPTIONS`（今天空的）
   ＋ **枚舉守衛**：`test-v6192` 第 ⑦ 條掃出卡庫裡**每一個**帶括號的卡名，
   比對一份「已人工判讀」的 `REVIEWED` 表；官方發新括號卡名 ⇒ **CI 直接紅**，
   逼下一個人決定「併額度」還是「進例外表」，一般化規則不會靜默套上去。

## ⚠⚠ 正對照：**前綴**冠名是完全不同的一件事

`PTCG RULES/PTCG_RULES.md` L2686 官方裁定：
「**達摩狒狒」和「N的達摩狒狒」視為兩種不同名稱的寶可夢**。
`N的◯◯` / `赫普的◯◯` / `竹蘭的◯◯` 是**卡名本身的一部分**，各自獨立算 4 張。
本版只動**結尾的括號段**，前綴沒有括號 ⇒ 原樣回傳。守衛第 ④ 條實跑
「達摩狒狒×4 ＋ N的達摩狒狒×4 ＝ 8 張 ⇒ **仍然合法**」，而且這條在 **BASE 就是綠的**
（＝不是被我改綠的，是真的沒被改壞）。

## 改了什麼（中央收斂：只有一份述詞）

- `src/lib/decks/validation.ts` 新增 `sameNameKey(name)` ＋ `SAME_NAME_PAREN_EXCEPTIONS`。
  消費點全部改走它：`sameNameTotal()`（兩端都正規化 ⇒ 呼叫端**不必**改簽名）、
  `validateDeck()` 的 `byName` 分組、`isStandardReprintLegal()`。
  `remainingCapacity()` 因為呼叫 `sameNameTotal` 自動跟上（UI 的「＋」按鈕）。
- `src/routes/decks/+page.svelte`：`stripArtSuffix` 改成 `(s) => sameNameKey(s)`，
  **刪掉那份本地正則**（守衛第 ⑧ 條鎖住「不得再出現第二份去括號正則」）。
  同名上限的 alert 訊息改顯示 `sameNameKey(card.name)`（本名），否則玩家會看到
  「同名卡片『老大的指令（烏羽）』已達 4 張上限」但畫面上明明只有 1 張。
- `isStandardReprintLegal` 這條**只會放寬不會收緊**（原本合法的卡名一張都不會變不合法）。

## 消費點盤點（為什麼不用再改別的地方）

- **牌組頁 UI**（`decks/+page.svelte` L755/L760/L1936/L1937）走 `remainingCapacity`/`sameNameTotal` ⇒ 自動生效。
- **對戰入場**（`game/+page.svelte` L877/L882/L7259/L9657）、**牌組公布欄**
  （`deck-posts/+page.svelte` L317/L439）走 `validateDeck` ⇒ 自動生效。
- **伺服器端**（`oracle-admin/server_admin_patch.js` L6014 `dpValidateDeck`）走
  **引擎 bundle 匯出的同一支 `validateDeck`**（`scripts/build-server-engine.mjs` L28 有 export）
  ⇒ ⚠ **要跑 `update-tournament.bat` 重建 bundle 才會生效**；沒跑之前它是 fail-open
  （只驗 60 張），不會爆，只是新規則暫時沒套到投稿驗證上。
- admin 的**牌組原型統計**是「這副牌像哪個原型」，不是 4 張額度，刻意不動。

## 既有牌組會不會被影響

- **不會被刪、也不會讀不到**：牌組存的是 `cardId`，`validateDeck` 只回 `issues`。
- 唯一影響：若真有人在 v6.191 之後組出「合計 ≥5 張」的牌組，那副牌會被標成不合法
  ⇒ 對戰入場（`deckIsLegal`）擋、公布欄投稿擋；牌組頁照常開啟、照常編輯，改完就能用。
- **賽事歸檔牌組的投稿路徑不受影響**（`dpInsert` 對 `tournament` 路徑本來就只做結構檢查）。
- 56 副 `PRESET_DECKS` 實跑 `validateDeck` ⇒ **0 副不合法**（改前改後都是 0）。

## 守衛（HEAD-FAIL 已證明）

`scripts/test-v6192-same-name-art-variant.mjs`（進 `npm test` 第 510 步）：
**BASE 跑 27 過 / 13 紅**，套上修正後 **40 過 / 0 紅**。
紅的那 13 條全部是①②③⑦⑧（新行為），④⑤⑥（前綴冠名 / ex 非 ex / 兩張合一場地 /
Reprint exception 的正對照）在 BASE 就是綠的 —— 這才證明沒有修過頭。

# v6.191 官方卡牌檢索完整性補收（M-P 4 張 ＋ SV8a 1 張）＋ 可重複執行的缺口檢查

站長回報：「asia.pokemon-card.com/tw 的 M-P 有新卡沒收錄，例如【玳蘿】。請實裝，
並做整體 audit 確認有沒有類似的問題。」

## 官方資料怎麼取得的（成功）

- **list 頁是 server-rendered**：`web_fetch` / `curl` 直接拿得到 HTML（含 `搜尋結果 N 個` 與
  每張卡的 `/tw/card-search/detail/<id>/` 連結），不需要瀏覽器。
- **detail 頁這次也拿得到**：既有的 `scripts/scrape/parse-card.js` 直接吃 HTML 就解得出
  卡名／supertype／subtype／rulesText／regulationMark／collectorNumber。
  （ptcg-push skill 裡「detail 頁 client-rendered、web_fetch 回空」那條**現在已不成立**，
  沙盒 `curl` + cheerio 全程可用。）
- 古代／未來／ACE SPEC tag 一樣只能從 list 的 `trainersTag` filter 回填 —— 沿用既有
  `scripts/scrape/tag-filters.js`，確認 11697 探險家的嚮導帶「古代」、其餘 4 張無 tag。

## 缺口盤點（逐包官方 vs live，不憑印象）

38 個官方 expansionCode（M-P-H/I/J 與 SV-P-H/I/J 對應官方的 M-P / SV-P）共 5114 個 id，
與我方**全站**所有 id（4930 張，B-3：不能只跟同名 set 檔比）比對：

| 官方包 | 官方 | 我方 | 缺 | 其中 H/I/J |
|---|---|---|---|---|
| SV-P | 238 | 104 | 134 | **0**（全是 A~G 標） |
| SV8a | 381 | 334 | 47 | **1**（11697 探險家的嚮導 H） |
| SV11B | 254 | 253 | 1 | 0（G） |
| M-P | 163 | 158 | 4+ | **4** |
| 其餘 34 包 | — | — | 0 | 0 |

⇒ **全站 H/I/J 只缺 5 張**，本版一次補完。其餘 181 張全是 G 標以下（站規不維護），
已逐張抓 detail 確認 regulationMark 後列進豁免表。

補進來的 5 張：

| id | 卡 | 編號 | 標 | 檔 |
|---|---|---|---|---|
| 19627 | 探探鼠 | 212/M-P | J | M-P-J |
| 19628 | 特殊紅牌 | 213/M-P | J | M-P-J |
| 19629 | **玳蘿** | 214/M-P | J | M-P-J |
| 19630 | **老大的指令（烏羽）** | 215/M-P | I | M-P-I |
| 11697 | 探險家的嚮導 | 172/187 | H | SV8a |

- 19624/19625/19626（傳說的海溝／山頂／熔岩洞）官方同時掛在 M-P 與 M6 底下，
  我方已收在 M6 ⇒ **不是缺卡**（正是 B-3 說的「只比同名 set 檔會誤判」）。
- 11697 與已收的 12449 是同一個 collectorNumber 的兩個官方 id —— SV8a 本來就有
  11xxx/12xxx 兩套 id（97 組），補它是既有慣例，不是製造重複。
- index.json 用**手術式更新**（只改 M-P-I / M-P-J / SV8a 三包的 cardCount/count/
  supertypeCounts），並在 build script 內對「沒動到的卡包」做 HEAD 逐欄斷言。
  **沒有跑 build-sets-index.js**（B-4）。
- JSON 序列化用 `dump_like()`：先以**原始物件**重跑一次、必須逐字還原原檔
  （M-P-I 是 indent=2、M-P-J/SV8a/index 是 indent=1、card-set-map 是單行）
  —— 否則整份檔會被重排，diff 爆炸、review 看不出實際改了什麼。

## 玳蘿（M-P 214/M-P，J）

卡面（台灣官方 rulesText 逐字）：

> 這張卡必須在上個對手的回合自己的「超級進化寶可夢【ex】」【昏厥】了才可使用。
>
> 從自己的牌庫選擇最多2張基本能量卡，附於自己的1隻「超級進化寶可夢【ex】」身上。並且重洗牌庫。

**gate**（判準①：訓練家卡效果完全無法執行 ⇒「不可以使用」）：

1. `oppAttackKOdMyMegaExInLastOppTurn + oppAbilityKOdMyMegaExInLastOppTurn > 0`
2. `deck.length > 0` —— 官方 L821 電氣發生器（牌庫 0 張）「不可以」
3. 場上（含戰鬥位）有「超級進化寶可夢【ex】」—— 官方 L805 電氣發生器（備戰無【雷】寶可夢）「不可以」

⚠「牌庫裡有沒有基本能量卡」是**隱藏資訊**，不進 gate；由 picker 的 fail-to-find 處理。

**KO 計數**：中央 `recordOppKO`（`effects/_shared.ts`）加一組 Mega ex 計數，
判準沿用整個家族（火箭隊／赫普／阿響）：只計對手主回合的招式 KO ＋ 主動特性 KO，
不含寶可夢檢查階段（檢查不屬於任何一方的回合），自 KO 不計。
「超級進化寶可夢【ex】」一律走中央述詞 `isMegaExCard`（`selection-filter.ts`，
與 prizesForKO 給 3 張獎賞／deck-search `'MegaEx'` filter 同一條）。
⚠ `_shared.ts` → `selection-filter.ts` 是單向（後者只 import types），無循環 import。

**效果**：`deck-search` filter `'BasicEnergy'`、`minCount 0`（判準②：**帶條件**的牌庫搜尋
可宣告找不到）、`maxCount 2`、`params.allowSkipZero: true`（v6.125 逐卡表態規約）。
resolver 直接交給中央 `startEnergyChain(..., { source:'deck', scope:'any-own',
targetIids: <場上 Mega ex>, singleTarget: true })` —— 卡面是「附於自己的**1隻**」，
不是「以任意方式」，走 v6.105 的 singleTarget 分支（全部附同一隻，禁分散）。
能量搬移／重洗牌庫／0 張分支／場上無合法目標的 leftover log 全部沿用中央，**沒有手刻附能**。

## 老大的指令（烏羽）（M-P 215/M-P，I）

rulesText 與「老大的指令」**逐字相同**（守衛有斷言）。但 reg key 是**卡名**逐字比對，
冠名不同 ＝ 兩個 key ⇒ 不會自動生效。
`supporters_gust.ts` 原本是兩段硬寫的 `regG`/`reg`，這版抽成 `registerGustSupporter(name)`
factory（gate 與 effect 共用 `gustValidOppBenchIids`：化石／緊張感／融合為雪／廣域堡壘
免疫過濾一份），卡名清單放在**零 import 的葉子模組** `src/lib/game/gust-supporters.ts`。

⚠ 為什麼要葉子模組：`ai.ts` 的 `_hasGustInHand` 也要這份清單，但 `ai.ts` 直接 import 卡檔會
① 讓「載入 AI」觸發 effects 註冊副作用 ② 有循環 import 風險（循環下模組層級 const 會 TDZ）。

## 同維度連帶找到的真 bug：ai.ts 的 `bench-choose` 漏 `includeActive`

`opp-bench-choose` 在 v5.874 就修過「要尊重 `params.validIids` ＋ `includeActive`」，
**自己這側的 `bench-choose` 一直沒修**：它只讀 `actorPlayer.bench`。
UI 的 `fieldPickerBaseCandidates` 與 engine 的 `sanitizeSelectedIids` 兩端早就都吃這個旗標。

後果：卡面允許選戰鬥位的 15 個 picker（`energy-coin-attach`／`energy-sticker-attach`／
`waitress-attach`／`sturdy-might-tree-pick-base`／`flame-dance-attach-*` …），
AI 在備戰區為空時會送 `[]` 回去 ⇒ **卡整張白打**。這版補齊，行為端有回歸測試。

## 可重複執行的缺口檢查（站長要的「一勞永逸」）

| 檔 | 何時跑 | 做什麼 |
|---|---|---|
| `scripts/data/official-set-manifest.json` | — | 官方卡包→卡片 id 的**離線快照**（38 包 / 5114 id）＋ `knownNonHIJ` 豁免表（181 張，附實際 regulationMark） |
| `scripts/test-official-set-completeness.mjs` | **每次 npm test / CI** | 離線：快照裡每個 id 要嘛在卡庫、要嘛在豁免表；豁免表不得藏 H/I/J、不得有腐爛項；live 每包都要被快照涵蓋 |
| `scripts/refresh-official-set-manifest.mjs` | 手動（需要網路） | 重抓官方 list 分頁 → 對 diff 出來的每張抓 detail 判 regulationMark → **直接印出「該補哪幾張」** |

- CI 不爬官網（不禮貌 ＋ flaky ＝ 假紅燈）；離線守衛擋的是「快照更新了但卡沒補」與「卡被誤刪」。
- 掃描器自驗（v6.124~126 教訓）：下限斷言（≥30 包 / ≥4500 id / 我方 ≥4500 張）＋ 兩條正對照。
- refresh 腳本**先過參數閘**（B-1 教訓）：`--help` 只印用法、未知參數 exit 1、**沒有 `--write` 什麼都不寫**。

## ⭐⭐⭐ Fable 5 審查抓到、我自行查證屬實：一份「早就寫好、正好會覆蓋掉新版」的舊註冊

`src/lib/game/effects/cards/v168_supporters.ts` L185-210 **在 BASE 就有**一份
`regG('老大的指令（烏羽）')` + `reg('老大的指令（烏羽）')`（檔頭註解還寫著 `(18351)`
—— 那個 id 在卡庫裡是「老大的指令」，不是冠名版，所以這份長期是**死碼**）。

`effects.ts` 的 import 順序是 `supporters_gust`（L570）→ `v168_supporters`（L598），
`reg()` 是裸 `Map.set` ⇒ **卡一補進來，實際生效的會是舊那份**，factory 版被靜默覆蓋。

- 兩份行為其實等價：陳舊的鰭之化石免疫在 v3.21 就整併進 `isImmuneToOppSupporter` 首行
  （我讀了 `v3080_deferred_wave_c.ts` 該函式確認），舊版只是 fail log 少「化石/」三字。
- 但這正是「grep 到兩份 reg、不知哪份生效」的坑 ⇒ **刪掉舊那份**，只留 factory。
- 守衛用**行為端**驗（v6.154 教訓：只驗字串存在擋不住接線沒接上）：
  跑 `TRAINER_EFFECTS.get(name)` 看 fail log 有沒有「化石/」，兩個卡名都驗。

⚠ **`test-no-new-duplicate-registrations.mjs` 對這個案例是假綠**：它的 regex 只抓
字面量 key，factory 的 `regG(cardName, …)` 掃不到。（v6.124~126「掃描器盲點」再一次。）
待辦：那支守衛應該補上「變數 key 的 factory 呼叫」的解析，或改成 runtime 端比對註冊表。

## 需要站長裁定 / 待辦（沒有自作主張）

1. **「老大的指令」與「老大的指令（烏羽）」算不算同名卡？** 牌組 4 張上限目前依
   `validation.ts` 的**逐字卡名**分組 ⇒ 現行行為是「兩種名字、各 4 張」。
   `PTCG RULES/PTCG_RULES.md` L2686 只裁定了「達摩狒狒」vs「N的達摩狒狒」是不同名稱，
   **沒有**括號冠名的判例。這版**沒有改任何 deck validation**，維持現狀待裁定。
2. **M-P-J 有兩張官方查無此 id 的卡**：`18965`（超級妖火紅狐ex 103/M-P）與
   `18969`（古歷 107/M-P）—— detail 頁 404 導回列表，且它們與 `18560` / `18564`
   **collectorNumber 完全重複**。疑似 v6.116 大量 clone 時多產的。
   沒有動它們（刪掉會讓已存的牌組讀不到卡）；等站長決定要不要清。
   ⚠ 它們不在官方快照裡，所以完整性守衛的「豁免表腐爛項」那條不會誤報。

# v6.190 對戰回放：獎賞卡檢視視窗（手機直式 + 桌機共用）

玩家回報「錦標賽回放時，手機版看不到獎賞卡內容」，站長建議「回放時點 🎁 圖示查看獎賞卡」。

## ⚠⚠ 這一版最重要的不是新功能，是那道閘

獎賞卡在正式對戰中是蓋著的機密資訊（`prizes[].faceUp`，只有特定卡效果會翻開）。
**伺服器端的玩家盤面遮蔽 `_redactStateForSeat` 是預設關閉的灰度旗標**
（v6.150 加入、v6.153 站長裁定改預設關：本站是練習站，防作弊優先度低）。
⇒ **對戰中的 client 手上本來就有對手獎賞的 `cardId`**，
   client 端這道 `isTReplay` 閘就是唯一防線，破了就是直接洩漏。

三道獨立的閘，任何一道單獨都足以擋住：
1. `openPrizeView()` 早退 —— `if (!isTReplay) { prizeViewOpen = false; return; }`
   （不是「不開」，是**強制關閉**：避免任何殘留狀態被帶進非回放情境）
2. 觸發按鈕包在 `{#if isTReplay}` 內（桌機）／`{#if isTReplay && onOpenPrizes}`（手機）
3. 視窗本體 `{#if isTReplay && prizeViewOpen && game}` —— 非回放時這段 DOM **根本不存在**

## 現況查證（行號以 v6.189 為準）

- `isTReplay` 宣告在 `src/routes/game/+page.svelte:474`，**只有** `tStartReplay()`（L5068）
  會設成 `true`。`tSpectate()`（L5085~）只設 `isTournSpectator = true`。
  ⇒ **回放與觀戰是兩個獨立旗標**，回放蘊含觀戰、觀戰不蘊含回放。誤放行的風險在
  「拿 `isTournSpectator` 當回放判據」，本版完全沒有用到那個旗標。
- 桌機回放**本來就看得到**獎賞卡正面（L10238 / L10447 的 `(_pz.faceUp || isTReplay)`），
  但那是 32×45px 的縮圖、而且是 `<div>` 不能點開 ⇒ 桌機其實也不好看，一併處理。
- 手機直式（`MobilePortraitBattle.svelte` L913 / L1075）的獎賞區**只有一個 `🎁 N` 的
  數字 chip，從頭到尾沒有渲染過任何卡片內容**。不是空間不夠、不是被蓋住 ——
  是根本沒畫。這就是玩家看不到的原因。

## 實作

- 視窗本體畫在 `+page.svelte` 的 **modal 區**（`.battle-root` 內、
  `{#if isPortraitMobile && game} … {:else} … {/if}` 這組版面分支**之外**，
  與 `zoom-modal` 同一層）。⚠ v6.167 教訓：畫在錯的分支＝有一種版面永遠顯示不出來。
  同一位置旁邊就有 v6.107 留下的同型警語。
- 手機直式只負責觸發：新 prop `onOpenPrizes`，父層以 `onOpenPrizes={openPrizeView}` 傳入。
  ⚠ 子元件的 prop 沒傳＝靜默失效，守衛 E4 直接斷言父層那個 tag 裡有這個屬性。
- 樣式沿用站內既有的 `.zoom-overlay` / `.zoom-modal.discard-modal` / `.sel-grid` /
  `.sel-card`（＝棄牌區檢視那一套），卡圖照規矩掛 `use:retryImg`，點卡片走既有 `openZoom`。
- 安全區讀單一來源 `var(--safe-top/--safe-bottom)`（v6.187，宣告在 `+layout.svelte`）。
- **沒有新增任何 `@media`**：手機/桌機是兩套獨立分支，開關是 `isPortraitMobile` 不是斷點。

## 守衛 `scripts/test-v6190-replay-prize-view.mjs`（PASS 150）

不是比字串：內建 Svelte 區塊樹解析器（含 `{:else if}` 的前分支否定）＋條件求值器，
對「某段 DOM 在某情境下會不會被渲染」實際求值。解析器與剝註解器都先自我驗證
（IRON_RULES Rule 25）。10 個情境：回放（桌機/手機）、正式對戰（自己回合/對手回合）、
錦標賽觀戰（桌機/手機）、對戰結束但未進回放、setup 階段、錦標賽對戰中（桌機/手機）。

`openPrizeView` 的函式本體是**真的被跑起來**的（`new Function` 包成 IIFE 後執行），
不是看有沒有寫 `isTReplay`。

**HEAD-FAIL 與突變測試（全部確認會紅）**：
| 對照 | 結果 |
|---|---|
| v6.189 原始碼 | FAIL 12 |
| 拿掉視窗的 `isTReplay` 閘 | FAIL 8 |
| 拿掉 `openPrizeView` 早退 | FAIL 9 |
| 父層不傳 `onOpenPrizes` | FAIL 1 |
| 桌機按鈕不包 `{#if isTReplay}` | FAIL 6 |
| 手機 chip 不包 `isTReplay` | FAIL 8 |
| 手機自己去讀 `prizes[0].cardId` | FAIL 1 |
| 把視窗搬進手機版面分支內 | FAIL 3 |

## 順手確認：回放時手機版還有哪些區域看不到

| 區域 | 手機直式 | 桌機 | 結論 |
|---|---|---|---|
| 獎賞卡 | ❌ 只有張數 | 縮圖（小） | **本版修掉** |
| 棄牌區 | ✅ chip 可點開網格 | ✅ | 沒問題 |
| 牌庫 | 只有張數 | 只有張數 | 兩邊一致，牌庫順序連回放也不攤（不動） |
| 主視角手牌 | ✅ v5.954 已攤開 | ✅ v5.940 | 沒問題 |
| **非行動方的手牌** | ❌ 看不到 | ⚠ 可用「看 P1／看 P2」切 | **手機缺視角切換鈕**，見下 |

⚠ **未修（列給站長裁定）**：`spectatorView` 的「看 P1／看 P2／自動切換」三顆按鈕
（`+page.svelte` L9969~9974）畫在**桌機分支內**，手機直式沒有對應 UI。
手機回放只能看當前行動方的手牌，要看另一邊得等下一步換手。
這是另一個獨立的 UI 缺口（要新增手機工具列按鈕 + 新 prop），與本版的洩漏風險無關，
故不混在同一版動 —— 而且 `spectatorView` **同時被觀戰用到**，改動面比獎賞卡大。

## 部署

`update-admin-full.bat` / `redeploy-oracle.bat` / `update-tournament.bat` 三支都要跑
（`oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 有改）。
⚠ 本版**沒有動 engine / 卡效果 / 錦標賽伺服器邏輯**，但版本提示一致性靠守衛鎖著。

---

# v6.189 收尾批次：棄賽公告文案／`/checkin` 收進 seed 鎖／admin 對帳按鈕／lint 的 CRLF 誤報

四件累積下來的小問題一次清掉。**首頁 changelog 不放** —— 一件是罕見系統公告的措辭更正
（玩家沒有任何要做的事、也沒有規則差異），其餘三件是後端／後台／本機工具。

## ① 棄賽情境的完賽公告不再說謊（`checkRoundAdvance`）

`winners` 被濾成 0 時，公告一律播「最後一場雙方皆未進場，無冠軍」。
**v6.188 之後同一個出口有四種成因**，只有第一種是對的：

| 成因 | 資料上的痕跡 | 舊文案 |
|---|---|---|
| 雙方皆未出賽 | `doubleNoShow` | ✅ 對 |
| **兩人都棄賽** | `doubleDrop`（v6.188 新增） | ❌ 說成未進場 |
| 時限到而平手 | `draw` / `timeLimit` | ❌ 說成未進場 |
| **本輪勝方全部棄賽** | `winners` 被 `dropped` 濾光 | ❌ 說成未進場 |

⇒ 新增純字串 helper `noChampionReason(ms, droppedWinners)`，依實際旗標措辭。
新增的 `_droppedWinners` **只是計數**，不參與任何判定；判定邏輯、旗標、寫入一個字都沒動。

⚠ 刻意**不**分辨「未進場」與「雙方閒置逾時」—— 這兩條路徑在資料上共用同一個
`doubleNoShow` 旗標（v6.156 只把「系統死角」拆成 `deadlockDraw` 出去），
**沒有旗標可判就不硬猜**，措辭改成同時涵蓋兩者（「雙方皆未出賽（未進場或閒置逾時）」）。
想真的分開，得先在雙方閒置那條路徑上加一個新旗標，而那就不是「只改文案」了。

## ② `/checkin` 收進 seed 序列鎖（同一類臨界區只留一套做法）

v6.188 把新的 `register-and-checkin` 收進 `runInSeedChain`，但**既有的 `/checkin` 沒有**，
還停在 v0.46 的做法。v0.46 的註解說「搶占瞬間報到窗口即關閉（checkin 端點要求
`status === 'checkin'`）」—— 但那是一次**讀**，不是原子寫，擋不住這個交錯：

```
t0  /checkin  讀 ev.status === 'checkin'        ← 通過
t1  排程器    CAS checkin → bracket_ready
t2  排程器    seed 進鎖，讀 TREGS               ← 這個人還沒 checkedIn，被排除
t3  /checkin  寫 checkedIn: true，回 200        ← 太遲了
```

⇒ 玩家看到報到成功，卻沒有出現在賽程上。收進同一條鎖之後只剩兩種結局：
報到先拿到鎖 ⇒ 寫入必定早於 seed 讀 `TREGS` ⇒ **一定在賽程裡**；
seed 先拿到鎖 ⇒ 報到拿到鎖時重讀已是 `bracket_ready` ⇒ **明確 409**。

### 為什麼判斷「該收」（併發與死鎖都查過才收）

- **鎖內只有 3 個本機 mongo 操作**：重讀 `status`／讀 reg／寫 `checkedIn`。
- ⚠⚠ **`tournIdentity`（會打 Firebase 驗權杖，是這支端點最慢的一段）與 `resolveEventFromReq`
  一律留在鎖外**。收進去等於讓每個人排隊等別人的網路往返 —— 那才是會把報到卡住的做法。
- **不可重入**：鎖內完全不呼叫 `seedEventBracket` / `runInSeedChain`，不會自己等自己。
- `runInSeedChain` 對 rejection 有 `.then(() => {}, () => {})` 兜底，
  單一報到丟例外不會把整條鏈卡住（守衛 ②-d 實測）。
- 尖峰試算：報到 30~50 人同時按，排隊的是毫秒級 DB 操作。守衛 ②-c 用 20 人併發實跑，
  全部在 8 秒內完成、且 seed 之後仍拿得到鎖。

⚠ 行為差異（刻意）：窗口在讀完之後才關上的那批人，從「回 200 但沒得玩」變成
「回 409 報到已截止」。這是修正，不是回歸。

## ③ admin：牌組公布欄「數字對帳」按鈕

`POST /api/admin/deck-posts/recount` 從 v6.182 就存在，但**一直沒有任何 UI** ——
站長不是工程師，沒有按鈕的端點等於不存在。
加在【總覽】分頁 Firestore Audit 底下，沿用 `btn btn-primary` 樣式與 `confirm` 流程，
結果寫進 `#dp-recount-result`（⚠ v6.154 教訓：沒有內容容器＝按了沒反應）。

⚠ `api()` **從不 reject**（非 2xx 回 `{ error }`）⇒ 一律看 `error` 欄，
用 `try/catch` 判斷是死碼。⚠ POST 一定要帶 `Content-Type: application/json`（v1.02 事故）。

## ④ `anti-pattern-lint.mjs` 的 CRLF 誤報（站長本機 `npm test` 第一步就紅）

**根因**：JS 的 `.` **不吃 `\r`**（`\r` 是 line terminator），而不帶 `m` 旗標的 `$` 只認字串結尾。
於是 `line.replace(/\/\/.*$/, '')` 這種「剝行內註解」的寫法在 CRLF 下
**整條匹配失敗、註解一個字都沒被剝掉** ⇒ 註解裡提到的字樣被當成真程式碼。
Check W 因此在 `m6_wave14.ts` 誤報 2 筆 —— 而那兩行正是在**講解這個反模式**的註解。
Windows（CRLF checkout）紅、CI（LF）0 違規，同一份程式碼兩種結論。

**修法**：不逐條 regex 補 `\r?`（一定會漏；全檔有 6 個同型的剝註解點）。
改在**讀檔的唯一入口**正規化 —— 把 `readFileSync` 改名 import 成 `_readFileSyncRaw`，
再定義一個同名的 wrapper 做 `.replace(/\r\n?/g, '\n')`。
32 個既有呼叫點與所有未來新增的 check 自動涵蓋。

**順手修**：`rel()` 寫成 `f.slice(ROOT.length + 1)`，但 `ROOT` 是 `new URL('..')` 推出來的、
**結尾本來就有分隔符** ⇒ 多吃掉一個字元，所有違規訊息的路徑都少了開頭那個 `s`
（印出 `rc/lib/game/...`，複製貼上開不了檔）。收斂成 Check W 用的那種正確寫法。

## 守衛

`scripts/test-v6189-finishing-batch.mjs`（17 條）
- ①：把 `checkRoundAdvance` + `noChampionReason` 接上假 mongo 真的跑，
  **讀聊天室裡真的被貼出來的那句話**（不是比字串）。四種成因各一條 + 混合 + 有冠軍的回歸保護。
- ②：核心不變式「回 200 ⇒ 一定在第 1 輪賽程裡」。用一個 gate 把報到卡在
  「已確認可以報到、還沒寫入」的瞬間，再把 CAS + seed 插進去跑。
  另有 20 人併發不卡死、例外不卡鏈、`tournIdentity` 在鎖外三條。
- ③：把 admin 的 handler 抽出來接上假 `api()` 跑，斷言**打到哪個 URL、用什麼方法**。

`scripts/test-lint-crlf-neutral.mjs`（7 條）
- 把 lint **原封不動搬進臨時工作區**（改 `import.meta.url` 推出來的 ROOT），
  用 LF / CRLF 各真跑一次，比對 exit code 與違規清單。
- ⚠ **正對照**：只驗「兩邊都乾淨」可以靠「把 Check W 刪掉」作弊 ⇒
  另外注入一個真的 Check W 違規，斷言兩種換行都抓得到、而且抓到同一批。

### HEAD-FAIL（都用**行為端**證明，不是靠函式不存在）

- ①：只把公告那一行換回舊字串（helper 仍在）⇒ ①-a~e 五條 FAIL。
- ②：只把 `/checkin` 端點換回 v6.188 版（其餘全新）⇒ ②-b FAIL，
  訊息是 `code=200 inBracket=false` —— 競態真的重現得出來。
- ③：對 v6.188 的 `admin.html` ⇒ ③-a~d FAIL。
- ④：對 v6.188 的 lint ⇒ CRLF 多出 2 筆 `[W]`、LF 是 0，前兩條 FAIL。

## Fable 5 審查採納 / 未採納（每一項我都自己 grep 查證過）

**採納（中）① 收進全域序列鎖之後，一個「掛住不 settle」的 mongo 操作會凍結所有人的報到。**
mongo driver 預設 `socketTimeoutMS=0`（無限），TCP 半開時就是這型態；
`runInSeedChain` 的 `.then(() => {}, () => {})` 只兜得住 **rejection**，兜不住「永不 settle」。
v6.189 之前被凍結的只有低頻的 seed，現在玩家面向的 `/checkin` 也在同一條鏈上。
⇒ 臨界區自帶 15 秒上限（`CHECKIN_LOCK_CAP_MS`），逾時就 reject、讓鏈往下走。
⚠ 計時寫在 `fn` **內部**（拿到鎖之後才起算），不會把「排隊等 seed」算進來誤殺。
⚠ 逾時不取消底層寫入 ⇒ 可能「看到錯誤但其實已報到」，再按一次拿到 200；
反過來的「回 200 卻沒進賽程」才是不能接受的，這裡沒製造那種情況。
守衛 ②-g 用「第一筆 `updateOne` 永不 settle」實跑（只把上限數字換成 150ms）。

**採納（可忽略）② lint wrapper 改判「回傳值是不是字串」**，不是判「第二參數等於 `'utf8'`」——
將來有人寫 `readFileSync(p, { encoding: 'utf8' })` 時後者比不中、會靜默回未正規化的字串。

**查證後未採納 / 只記錄**
- 「`test-source-encoding` 的位元組檢查會不會被正規化改壞」⇒ **不會**：它是獨立腳本，
  自己 import `readFileSync` 且用 **Buffer 形式（無 encoding）**，完全不經這個 wrapper。實際 grep 確認。
- 「lint 有沒有 check 靠 `\r` 或原始位元組判斷」⇒ **沒有**：全檔 30+ 個呼叫點的第二參數都是字面 `'utf8'`。
- 🔨 **`/drop` 的 `dropped` 寫入（L5658）與它的消費點都在鎖外** —— 棄賽回 200 之後，
  若對手那場剛好觸發建下一輪（`checkRoundAdvance` 讀完 `dropped` 名單、`insertMany` 之前），
  棄賽者仍會被排進下一輪、之後被未進場判負，與 v6.188「移出配對池」的承諾不符。
  **這是 v6.188 遺留的缺口，不是這一版引入的**，修它要動到配對／建輪那段 ⇒ **另案，待站長裁定**。
- 混合成因時 `droppedWinners > 0` 無條件優先，同輪其他無勝方場次的成因不會被提到（文案取捨，賽程表標記仍正確）。

## 部署

改到 `oracle-admin/` 兩個檔 ⇒ 站長要跑 `update-admin-full.bat` 與 `redeploy-oracle.bat`。
沒有動 engine / 卡效果 / `static/cards`，**不需要** `update-tournament.bat`。

---

# v6.188 錦標賽：報到階段補報名＋直接報到／瑞士制中途棄賽

兩件事同版出，因為它們動到**同一份 TREGS 報名紀錄**，分開做必然衝突。

## 功能 A：`POST /api/tournament/register-and-checkin`

- gate `status === 'checkin'`，走 `resolveEventFromReq`（`TEVENTS.findOne` 新鮮讀），
  **不吃 `/event` 那份 3 秒共用快取** —— 會寫入的端點絕不用 3 秒前的狀態做決策。
- 驗證**完全複用** `/register` 那一套：60 張牌組、暱稱 16 字、coinPref 白名單、maxPlayers 上限。
- **單筆 `insertOne`** 一次寫到位（`checkedIn:true` + `lateJoin:true` + `checkedInAt` + `clientVer`），
  **不做兩段**：兩段之間掉線 ＝ 報了名沒報到，比不給補報還糟。

### TOCTOU 怎麼關死（兩道，缺一不可）

1. 整段臨界區跑在 **`runInSeedChain`（原 `_seedChain` seed 序列鎖）** 內，
   與 `_seedEventBracketImpl` 讀 `TREGS` 互斥。
2. 臨界區內 **insertOne 之後再讀一次 `status`**，已非 `checkin` 就 `deleteOne` 自己並回 409。

只有第 2 道是不夠的：若 seed 已經把 `regs` 讀進記憶體，我們刪掉 reg 它照樣把人排進賽程，
結果是**最惡劣的孤兒**（`TREGS` 沒這個人、`TMATCH` 有）。第 1 道就是為了排除這個交錯。

反過來只有第 1 道也不夠：CAS（`checkin → bracket_ready`）**發生在鎖外**，
所以「我拿到鎖時 CAS 已經過了」是可能的，此時必須靠第 2 道把自己收回去。

兩道合起來，結局只有兩種：**要嘛被收進賽程、要嘛明確被拒**。

- 窗口關閉點沿用既有那次 `checkin → bracket_ready` 的 CAS，**沒有新增任何關閉邏輯**。
- 三條分支：既有報名者 → 409（導去既有 `/checkin`，且**絕不覆蓋**他鎖定的暱稱／牌組）；
  `autoRemovedConflict` 者 → 409（不給他從補報這道側門回來）；`maxPlayers` 已滿 → 409。

## 功能 B：`POST /api/tournament/drop`

### ⭐ 真因：大部分早就寫好了，只是沒接線

`src/lib/tournament/swiss.ts` 的檔頭註解就寫著「Wilson 拍板：棄賽者後續不再配對」，
`dropped` 欄位（L17）、`pairSwissRound` 的 `players.filter((p) => !p.dropped)`（L94）、
`buildSwissPlayersFromMatches` 收 `dropped` 參數（L155-158）**全部都在**。
唯一缺的是伺服器 `advanceSwiss` 那一行 —— 它把 `regs` 餵進去時只給了 `uid` 與 `name`，
`dropped` 從來沒被傳過去。這一版就是把那條線接上。

### 為什麼是方案 B（移出配對池），不是「照排然後自動判勝」

照排會有三個副作用：①棄賽者勝率被打到 0.25 地板；②**拖累所有前對手的 OWP**；
③每輪隨機一人白拿 3 分。移出配對池才是官方 Play! Pokémon 的做法。

### 站長裁定

1. **不做「取消棄賽」**：本檔刻意沒有任何取消端點，誤按由站長在後台處理。
   玩家端唯一保護是按下去前的確認框（按鈕只開框、確認鈕才送出，守衛實跑驗證）。
2. 棄賽者**從 Top Cut 資格剔除**：`computeStandings(全部人)` 之後才 `filter(!dropped)` ——
   **順序不能反**，OWP/OOWP 要靠棄賽者的戰績才算得對。
3. **只剩 1 位未棄賽 ⇒ 直接判該人冠軍完賽**（兩個時機各一份檢查，見下）。
4. 「對手先被判勝、我方才棄賽 ⇒ 勝場保留」——接受（本版不回溯改動任何已完成輪次）。
5. **單淘汰賽也加棄賽鈕**（語意＝投降）：`checkRoundAdvance` 收集 winners 後濾掉 dropped，
   否則棄賽者會一路輪空到決賽。

### 邊界

- **對戰中棄賽**：沿用既有 forfeit 收場（對手勝 + 房間盤面推成 game-over）。
  `pending`（還沒進場）的場一起收 —— 不收本輪永遠打不完。
- **兩人都棄賽**：`status:'done', winnerUid:null` + **新旗標 `doubleDrop`**。
  ⚠⚠ **絕不重用 `doubleNoShow`**（v6.156 明確教訓）：那旗標語意是「兩人都沒出現」，
  混用會讓事後對帳分不出「掛機」與「棄賽」。計分邏輯 swiss.ts 現成
  （`done` 且無 winner ⇒ 雙方各記一敗、都不得分）。
- 賽事已 `finished` 後才按 ⇒ 409；連點第二次 ⇒ 409（`dropped: { $ne: true }` 條件式搶占）。
- admin `match/restart`（重賽）遇到 dropped 玩家 ⇒ 409，且 `$unset` 一併清 `doubleDrop`/`dropForfeit`。
- 歸檔 `recordTournamentArchive` 的 `players` 補 `dropped/droppedAt/lateJoin`、
  `matches` 補 `doubleDrop/dropForfeit`，否則事後對帳看到「某人第 3 輪起憑空消失」完全解釋不了。

## ⚠⚠ 順手修的既有 bug：存活 <= 1 時賽事永久卡死

`TENG.seedTopCut(standings, K)` 在存活 <= 1 時回 `[]`，
而 mongodb 的 **`insertMany([])` 會 throw**（`Invalid BulkOperation, Batch cannot be empty`）
⇒ `advanceSwiss` 整支拋例外 ⇒ 賽事永遠停在最後一輪，沒有任何路徑救得回來
（`checkRoundAdvance` 每次被呼叫都會再炸一次）。

修法配合裁定 3：
- `advanceSwiss` 開頭算 `alive = players.filter(!dropped)`，`alive.length <= 1` 直接
  `finishSwissWithSurvivor` 判冠軍完賽。
- 兩個 `insertMany` 前各加一道空陣列守衛（就算未來有別的路徑產生空配對也不會炸）。
- 另加 `finishIfLastSurvivor(eventId)`：**「棄賽當下」**的即時檢查。
  兩個時機都要有 —— 在輪次之間棄賽時沒有任何一輪會結束，只靠 `advanceSwiss` 那份會卡住。

## 已知限制（誠實記錄）

- `pairSwissRound` 內部第 2 輪起用的是 `computeStandings(active)`（只含未棄賽者），
  所以**配對排序**用到的 OWP 不含棄賽對手。這只影響配對順序，
  對外顯示（`/bracket` standings）與 Top Cut 種子都是 `computeStandings(全部人)`，不受影響。
- `/checkin`（既有報名者報到）**沒有**放進 seed 序列鎖，維持 v0.46 的行為不動。
  它本來就有 CAS 先翻 status 再讀 regs 的保護，殘窗與本版之前完全相同。

# v6.186 手機直式 setup/playing 戰鬥位卡面尺寸收斂（真因：div vs button 的 UA box-sizing）

## 症狀

手機直式開局 setup 階段，**對手戰鬥場的卡背**比正式開打後的卡圖大一圈，
雙方準備完成切到 playing 時版面會「縮一下」。

## 真因（不是刻意放大，是 UA 預設值差異）

`MobilePortraitBattle.svelte` 裡：

| 階段 | 對手戰鬥位外框 | 卡面元素 |
|---|---|---|
| setup | `<div class="mp-active">` | `<div class="mp-card-back mp-active-card-back">` |
| playing | `<button class="mp-active">` | `<img>` |

`<button>` 的 **UA 預設 `box-sizing` 是 `border-box`**，`<div>` 是 `content-box`，
而專案**沒有全域 `* { box-sizing: border-box }`**。
於是同一句 `height: 100%`：

* button 版：內容高 = 160 − padding 8 − border 4 = **148**
* div 版：內容高 = **160**（外框反而撐成 172，比 row 還高）

裡面 `height:100%` 的卡面就跟著差 12px。真實 Chrome 量測（390px 寬、row 內容高 160）：

| | setup 卡背 | playing 卡圖 | 差 |
|---|---|---|---|
| 寬 x 高 | **118.53 x 164** | **105.98 x 148** | +12.55 x +12（面積 +24%）|

同一族還有：對手備戰位 `.mp-slot`（92x112 vs 90x110）、
觀戰/回放手牌卡背 `.mp-hand-card`（66x88 vs 64x86）、`.mp-chip`（span vs button）。

## 修法（單一來源，不是把數字改成一樣）

1. `.mp` 宣告 `--mp-card-ar: 63 / 88`（實體卡尺寸）作為**唯一的比例來源**。
2. 卡面幾何收斂成**同一條規則區塊**：

   ```css
   .mp-active img,
   .mp-active .mp-active-card-back { height:100%; width:auto;
     aspect-ratio: var(--mp-card-ar, 63 / 88); max-width:120px; flex-shrink:0; }
   ```

   舊的 `.mp-card-back.mp-active-card-back { height:100%; aspect-ratio:63/88; }` 刪除。
3. `.mp-active` / `.mp-slot` / `.mp-hand-card` / `.mp-chip` / `.mp-card-back`
   **明寫 `box-sizing: border-box`** —— 讓 div 版與 button 版解出同一個盒。

修正後 Chrome 實測兩階段皆為 **105.95 x 148**、備戰位皆 90x110、手牌卡背皆 64x86。

## 守衛 `scripts/test-v6186-mobile-card-size-single-source.mjs`

* 內建 **box-model 求值器**（實際算出 w/h，不是比字串）。
* ⭐ 求值器**自我驗證**：餵 v6.185 舊 CSS fixture 必須重現 Chrome 實測 118.55x164 / 105.99x148，
  否則直接 FAIL（IRON_RULES Rule 25：掃描器自己要先被驗）。
* 釘住：兩階段 w/h 相等、`height` 與 `aspect-ratio` 來自**同一條規則區塊**、
  比例讀 `--mp-card-ar`。
* 家族守衛：markup 中**同時用在 `<button>` 與非 button** 且有幾何宣告的 class，
  一律要求明寫 `box-sizing`（這次的真因通則化）。
* 桌機正對照：`+page.svelte` 完全沒有這些 class。
* 禁 `@media` 當手機開關（先剝 CSS 註解，剝除器亦自我驗證）。

HEAD-FAIL：在 v6.185 原檔上 11 條 FAIL。

# v6.185 ①牌組公布欄「最新留言」排序 ②對戰通知收斂成「不需要操作 → 需要操作」單一述詞

## ① 最新留言排序

`deckPosts` 新增非正規化欄位 `lastCommentAt`，排序值 `sort=comments` ⇒
`{ lastCommentAt: -1, createdAt: -1 }`（並補上 `{status:1, lastCommentAt:-1}` 索引）。
**列表頁不查 `deckPostComments`**（v6.119 讀放大／v6.182 已定的規矩）。

防漂移的三道：

| 事件 | 作法 | 為什麼 |
|---|---|---|
| 新增留言 | `$max: { lastCommentAt: now }` | `$set` 在兩則幾乎同時寫入時會讓「後寫入但時間較早」那發把新值蓋回去；`$max` 天生單調 |
| 刪除留言 | 對該 postId 取「還活著的最新一則」重算後 `$set` | `$max` 沒有反向操作。刪掉的**剛好是最後一則**是唯一會漂移的路徑；刪除是低頻單筆操作，一次 `limit(1)` 點查詢（已有 `{postId,status,createdAt}` 索引）完全付得起，**不是**列表頁的 N+1 |
| 事後對帳 | 沿用 v6.182 的 `/api/admin/deck-posts/recount`，同一趟 `$group` 多算一個 `$max: '$createdAt'` | 權威永遠是明細表 |

⚠ **新投稿一定要寫 `lastCommentAt: 0`，不可以留空。** mongo 的 descending 把「欄位缺席」
當 null 排在 0 **之後** ⇒ 新舊投稿會分裂成兩群、無留言者的相對名次不穩定。
舊投稿（欄位缺席）由 recount 回填 —— 所以 recount 的比對條件除了「值不等」還要多一條
「`typeof p.lastCommentAt !== 'number'`」，否則 `(undefined || 0) !== 0` 恆為 false，永遠補不進去。

**無留言的怎麼排**：`lastCommentAt = 0` ⇒ 全部排在有留言的之後，彼此再依 `createdAt` 由新到舊。
兩個排序鍵都是不會浮動的值 ⇒ 名次完全確定。

## ② 通知：真因與收斂

**真因**：`src/routes/game/+page.svelte` 唯一的 `notifyTurn` 呼叫掛在
`_prevTurnPlayerIdx !== game.activePlayerIndex` 的 `$effect` 裡（v6.022）——
是 **edge-trigger**。而昏厥補位（`SEND_NEW_ACTIVE`）**根本不會改 `activePlayerIndex`**
⇒ edge 永遠不 fire。同一個 edge 也漏掉了：對手回合中對手效果要我做選擇
（`pendingSelection.actorIdx = 我`）、開局階段輪到我、要我選取獎賞卡。
＝ 站長回報的「補位不跳通知」與另外三個從來沒人回報過的缺口是**同一個** bug。

**收斂**：對戰頁改成每次盤面落地跑一次 level 掃描 → `buildActNeed()` → `notifyAct()`。

- 「誰該動作」**只問既有的 `tCurrentActorSeat(game)`**（與伺服器 `currentActorSeat` 逐行同步、
  閒置判負在用的那一份），notify 這一側**不再拄第二份判準**。
- 唯一例外且已標註：`iMustPromote`（我方 active 為 null 且備戰非空）。`tCurrentActorSeat`
  的語義是「閒置判負該判誰」所以只回**一個**座位，雙方同時昏厥時固定先回 P1 ⇒ P2 永遠收不到。
  這一條只讓通知**早一點**發、不會漏，而且不改任何 gate/判負。

### 去重／冷卻（決策全在 `notify-core.ts` 的 `decideActNotify`，純函式）

1. 需求消失 ⇒ 清「已響過」旗標。
2. 同一個需求 key 再次觀察到 ⇒ skip（輪詢每 1.2 秒一發不會轟炸）。
3. **上一次觀察就已經需要操作** ⇒ 同一串連鎖 ⇒ 靜默更新（同 tag 覆蓋、不再響）。

站長問的「補位完成後馬上輪到我會不會再通知一次」被規則③擋掉；
「補位完成後對手還有動作、之後才輪到我」中間必然觀察到一次「我不需要操作」⇒ 規則①清旗標 ⇒ **照響**。
分界靠**機制**（中間有沒有經過「不需要操作」），不是靠猜時間 —— 時間分不出這兩件事。

### 為什麼不用 30 秒最小間隔，改成「60 秒內最多出聲 6 次」

沿用 `TURN_MIN_INTERVAL_MS`（30s）會把上面那個**完全正當**的正對照情境變成無聲
（對手十幾秒內結束回合是常態）。改成爆量上限，數字推導：
一個玩家回合內「我需要操作」的需求最多三段（取獎賞卡／補位／對手效果要我做選擇——
這是 PTCG「一回合最多攻擊一次」的結構上界），本專案實測最快回合節奏約 30 秒／回合
（`notify-core.ts` 既有註解，v6.022 依實際賽事觀察寫下）⇒ 一分鐘最多兩個回合段 ⇒ 3 × 2 = 6。
**合法對局產不出第 7 次**。

### ⚠ 兩條「絕不漏發」的設計決定

- **爆量上限只降級成靜默，絕不 drop。** 舊的 `decideNotify` throttle 是直接不發，而
  v6.022 的呼叫點是 edge ⇒ 被 throttle 掉的那一回合**永遠不會有人再呼叫一次** ⇒ 永久漏。
- **act 的 key 只放記憶體，不寫 localStorage `seen`。** 持久化的 seen 一旦兩個不同需求
  撞 key 就是永久漏發；只放記憶體最壞是重整後多響一次，而重整必然在前景、前景本來就不發。
  失效方向永遠是「多響」。
- 離開對戰呼叫 `resetActNotify()`：殘留的 `prevKey` 會把下一場的第一個需求誤判成
  「同一串的延續」而只靜默更新 ⇒ 那就是漏響。

### ⚠ 上線當天就會壞的那條：舊投稿的 lastCommentAt 是**缺席**不是 0

v6.182 起就有留言了，那些 doc 沒有 `lastCommentAt`。descending 把缺席當 null 排在 0 之後
⇒ **已經有留言的舊投稿會排在「完全沒有留言」的新投稿後面**，剛好是反的。
`/api/admin/deck-posts/recount` 修得回來，但它是個**沒有按鈕的端點** ⇒ 等於功能一上線就是壞的。
⇒ deckPosts 區段註冊時 fire-and-forget 跑一次 `dpBackfillLastCommentAt()`：
只挑 `{ lastCommentAt: { $exists: false } }` 的 doc（補完就不再有 ⇒ 天然冪等），
用一次 `$group/$max` 算出每篇的最新留言時間再逐筆 `$set`。全程 best-effort，
失敗只讓排序退化成「舊投稿排最後」，絕不能讓整個 deckPosts 區段註冊失敗（那連公布欄都打不開）。

## 守衛

`scripts/test-v6185-act-notify-and-comment-sort.mjs`，26 條，HEAD（v6.184）跑出 **20 FAIL**。
兩半都是行為端：deck-posts 抽 handler 餵記憶體 mongo mock 真的跑（斷言 DB 裡的
`lastCommentAt` 變成多少）；通知把對戰頁的 `tCurrentActorSeat`/`setupActorSeat`
**原文抽出來**和真正的 `notify-core` + `notify.ts` glue 一起 bundle、用假的 `Notification`
攔截，斷言「有沒有真的發出通知、出不出聲」。
extractFn／mongo mock（`$max` 單調）／排序器（mongo 的 null-before-number 語義）
三個工具都先用已知答案的合成輸入**自我驗證**過。

---

# v6.184 診斷回報不再被靜默切掉（clientdiag 2KB → 8KB ＋ 截斷留痕）

**玩家零可見變化 ⇒ 首頁 changelog 不放。** 純診斷管線修正。

## 真因

`oracle-admin/server_admin_patch.js` 的 `/api/tournament/clientdiag` 從 v0.77 起就是
`JSON.stringify(req.body).slice(0, 2048)`。v6.171 加了 `svelteWarn.first`（最多 3 筆 ×
700 字元的 stack）、v6.179 又把 `perf.res.seg` 拆成四段之後，payload 撐破了那個上限。

2026-08-13 的 dump（`tournament-dumps/monitor_20260813_201351.json`，7 天 993 筆）實測：

| 項目 | 數字 |
|---|---|
| 明細總筆數 / 玩家數 | 993 筆 / 142 人 |
| diag 長度 p50 / p90 / max | 674 / 1330 / **2048（＝剛好卡在上限）** |
| 被截斷筆數 | **16 筆，全部集中在 v6.179 / 6.180 / 6.182** |
| 被截斷的人 | vice910504（4 筆）、s3360389（3 筆）、love6525022（3 筆）、t12211908763（3 筆）、ueishun（3 筆） |

payload 的 key 順序是 `reason → room → ts → ver → state → render → poll → perf →
svelteWarn → env`，所以切掉的**一定是尾端的 perf / svelteWarn / env.ua**，而且
**切過的字串不再是合法 JSON**。`/api/tournament/admin/clientdiag` 建 slowRtt 那張表時
對 `JSON.parse` 失敗的列是「直接略過」⇒ 那 16 列**不會出現在 RTT 表上**，
而且 perf 四段內容已經毀掉、任何工具都算不回來。
上一輪「wire 是兇手」的結論因此是靠其他 11 人外推的 —— 尾巴最重那位（vice910504）
的四段資料整組不見。

⚠ **措辭更正（Fable 5 審查提出、已自行查證）**：不是「在 📡 分頁上完全看不到」。
`byReason` 統計 group 的是**獨立的 `reason` 欄位**（`server_admin_patch.js` 的 aggregate），
「最近 120 筆明細」也是原樣吐 `diag` 字串（`admin.html:2921` `escapeHtml(r.diag)`）
⇒ **那兩處看得到**。真正看不到的是 **slowRtt 那張 RTT 表**，以及那筆 payload 裡
真正有價值的 `perf` / `env` 內容。原始回報的描述偏重，這裡照實修正。

⚠ 真兇不是 `perf.res.seg`（結構上界只有 ~1.8KB，實測最長的完整列 1757 字元），
是 **`svelteWarn.first`**：3 筆 × 700 字元的 stack ≈ 2.3KB，單它一項就大於整個 2048 上限。

## 改了什麼

### ① 上限 2048 → 8192，並收斂成 `_cdiagPack()`

```
function _cdiagPack(body) → { s, truncated, rawLen }
```

- `LIMIT = 8192`。結構上界 ≈ 1.8KB（非 svelteWarn）＋ 2.3KB（svelteWarn）≈ **4.1KB**，
  8KB 留 2 倍餘裕。
- ⚠ **完全不影響頻寬**：client 本來就把完整 payload 送上來，上限只決定「存多少」。
- 循環參照 / `JSON.stringify(undefined)` 一律退回 `'{}'`，絕不 throw（診斷不可以影響對戰）。
- ⚠ **surrogate pair 不會被切一半**（Fable 5 審查提出）：`slice` 切的是 UTF-16 code unit，
  emoji 可能被切成兩半。實測前提查證：`JSON.stringify` 從 ES2019 起是 well-formed
  （孤兒 surrogate 會被跳脫成 `\ud83d` 六個字元）⇒ 孤兒**只可能**由這一刀製造、
  而且只會在最後一個 code unit。實測 `Buffer.from('ab\uD83D','utf8')` → `61 62 ef bf bd`
  （替換成 U+FFFD，**不會 throw**）⇒ 就算留著也不會讓 `insertOne` 爆掉，
  而且這個切法在 v6.184 之前的 `slice(0, 2048)` 也一樣存在、不是新引入的。
  但既然一個判斷就能完全避免，就避免：尾端是高位 surrogate 時退一格。

### ② 截斷不再靜默 —— doc 上一律寫 `truncated` / `rawLen`

`TCDIAG.insertOne({ …, diag: _p.s, truncated: _p.truncated, rawLen: _p.rawLen })`。

⚠ **一律寫入，不是只有被切時才寫**：欄位缺席只能代表「這是 v6.184 之前的舊列」，
不可以被讀成「這列沒被切」。`rawLen` 是「截斷前有多長」—— 它逼近 8192 就代表該再放大，
不必再等到有人的資料整組不見才發現。

### ②-b 讀出端也看得見（Fable 5 審查抓到的殘餘缺口）

寫入端留了痕跡，但 `/api/tournament/admin/clientdiag` 的 `rows.map` 原本只挑
`ts/email/room/reason/diag` ⇒ 未來真的有 >8KB 的 payload 時，它在 📡 分頁上仍然只是
「一串壞掉的 JSON」而沒有任何標示。

- API 的 `rows` 多帶 `truncated`（**正規化成布林**，`undefined` 會被 `JSON.stringify`
  整個吃掉，畫面就分不出「舊列」與「這列沒被切」）與 `rawLen`（缺席回 `null`）。
- `admin.html` 的明細列標題加一個紅色 `⚠ 已截斷（原始 N 字元）`。舊列一律 falsy，不會誤標。

### ③ `dump-client-monitor.cjs`：兩層合判 ＋ 報出來

- 新增 `DIAG_CAP` / `classifyTrunc()` / `truncSummary()`：
  `srvFlag`（伺服器旗標，**紀錄**）、`parseFail`（JSON.parse 失敗，舊列唯一線索）、
  `legacy`（parse 失敗但沒旗標 ⇒ 舊列）三者分開算。
- 既有的「用文字比對盡量救回 ver / ua / poll.rtt」邏輯**原樣保留且仍相容**（守衛有實跑驗）。
- 摘要 ⑥ 現在會印：截斷總數 / 伺服器明確標記幾筆 / 只能推論幾筆 /
  **頂到目前上限 8192 幾筆** / **卡在舊上限 2048 幾筆** /
  **截斷前最長一筆用掉上限的百分之幾**。JSON `totals` 多出
  `truncatedFlaggedByServer`、`truncatedLegacyGuess`、`rowsAtCap`、`rowsAtLegacyCap`、
  `legacyDiagCap`、`maxRawLen`、`diagCap`。
  ⚠ 兩個上限**一定要分開數**（Fable 5 抓到）：舊列卡的是 2048，永遠不可能 `>= 8192`，
  只數「頂到目前上限」的話會出現「舊列 16 筆、卡在上限 0 筆」這種自相矛盾的報表。
  實跑（拿 `monitor_20260813_201351.json` 當假 mongo 餵進去）現在會印
  `頂到目前上限 8192：0 筆 / 卡在舊上限 2048：16 筆 / 截斷前最長 3282 字元（用掉 40%）`。
- `loadMongo()` 由頂層搬進 `main()`，並加 `if (require.main === module)` ＋ `module.exports`
  ⇒ 守衛可以 `require` 進來**實跑**判定邏輯而不需要資料庫；VM 上直接執行的行為完全不變。

## 儲存成本（7 天 TTL，有上界）

以上面那份實測 dump 為基準（~142 筆／日、7 天 993 筆、diag 合計 **744 KB**）：

| 情境 | 7 天總量 |
|---|---|
| 現況（2048 上限） | 744 KB |
| 放大到 8192 後（只有那 1.6% 會變長） | **≈ 780 KB（+4~5%）** |
| 理論最壞（每一筆都塞滿 8192） | 993 × 8192 ＝ **8.1 MB** |
| 新增的 `truncated` + `rawLen` 兩欄 | ≈ 20 B × 993 ＝ **20 KB** |

TTL 是 `expireAfterSeconds: 604800`（7 天，既有），所以總量恆有上界，不會累積。
單筆 doc 就算 8192 字元全是中文（3 bytes/字元）也只有 ~24 KB ≪ **16 MB 的 BSON 上限**；
`diag` 不在任何索引裡（唯一的索引是 `{ts:1}` 的 TTL）⇒ 沒有索引鍵長度問題。

⚠ **`/admin/clientdiag` 的回應會變大**（我一開始漏算，Fable 5 補上）：
該端點 `rows` 是 `.limit(120)`。實測最近 120 筆 `diag` 合計 **129,941 字元**，
16 筆卡頂列全都落在這 120 筆內 ⇒ 放大後約 **+37 KB ≈ 167 KB**。
理論最壞 120 × 8192 ＝ **983 KB** 未壓縮，但這條路由**有 gzip**（v6.178 的 hoist，
filter 只排除 SSE 與 `/stream`）⇒ 線上約 150 KB。單一管理員、手動載入，不構成風險。

⚠ 「完全不影響頻寬」這句要加註腳：**client → server 成立**（client 一直都送完整 payload），
但 **server → admin** 的回應確實會微幅變大（就是上面那 +37 KB）。

## 其他大小限制（查過，都不會擋）

- **express.json()**：掛在 VM 的 `server.js`（不在本 repo），預設上限 **100 KB** ≫ 8 KB。
  而且 client 送的 body 大小**本來就沒變**（一直都是完整 payload），這一版只改「存多少」。
- **nginx**：本站沒有 nginx，前面是 **Cloudflare Tunnel（cloudflared）**，
  免費方案 body 上限 100 MB。repo 內 `oracle_admin_install.sh` / `oracle_admin_update.sh`
  沒有任何 body/limit 設定。

## client 端：這一輪**不動**（理由）

- `res`（v6.170 加的連線資訊）**沒有**存整包 entries —— `_resTimingStats()` 回的每一欄都是
  `_sampleStats()` 的 `{n,p50,p95,max}` 聚合，加上 `proto`（協定→次數的小 map）與幾個計數器。
  實測完整 `perf` 區塊只有 855 字元。**沒有冗餘可瘦。**
- 真正的大戶是 `svelteWarn.first`（3 × 700 字元），而那正是 `derived_inert` 追查的原始素材，
  砍掉＝犧牲診斷價值。三筆 stack 內容高度重複（同一條 stack、只有 `+NNNms` 不同），
  技術上可以「同 stack 只留一筆 + 記次數」省下 ~1.4KB，
  但那會改變「是不是玩家點出來的」這個判讀依據 ⇒ **留給站長決定，本輪不動**（低風險優先）。

## 守衛

`scripts/test-v6184-clientdiag-cap.mjs`。
⚠ 不是只驗字串（v6.154 的教訓）：

1. 從原始碼抽出 `_cdiagPack` **真的執行** —— 正常大小原文照存、超大切到 8192、
   邊界剛好 8192 不算截斷、循環參照 / undefined 不 throw。
2. 整支 `/clientdiag` handler 抽出來**真的執行**（注入假 `tournIdentity` / 節流 Map /
   假 collection），斷言到**寫進 DB 的那份 doc** 上有 `truncated: true` 與 `rawLen`。
   ⚠ `_cdiagPack` 不存在時**也照跑**（注入絕不標旗標的替身）⇒ 舊版走 inline slice
   會在這裡直接 FAIL，而不是整段被跳過（跳過＝假綠）。
3. 正對照：正常大小的 payload 一個字元都沒少、`truncated` 為 `false`；
   既有的 per-(uid, reason) 60 秒節流沒被改壞。
3b. surrogate：先斷言前提（`JSON.stringify` 是 well-formed），再用四種對齊逐一實跑
   6000 個 emoji 的 payload，確認尾端不會留下孤兒高位 surrogate、且長度不超過上限。
3c. 讀出端：把 `/admin/clientdiag` 的 `rows.map` 回呼抽出來**實跑**，
   斷言舊列（沒有欄位）回 `truncated:false / rawLen:null`（不是 `undefined`）。
4. `require` dump 腳本**實跑** `truncSummary` / `classifyTrunc`，
   斷言四種列（新列被切 / 新列正常 / 舊列被切 / 舊列正常）分別數對。
5. 掃描器自我驗證四條：停在 2048 的樣本會被判不合格；只靠 parse 失敗的舊做法數不出
   伺服器旗標；`stripComments` 剝得掉註解、又不會誤剝字串
   （⚠ 否定型斷言「2048 已消失」必須先剝註解 —— 註解裡本來就會提到舊值）。

守衛數：**58 條全綠**；對 BASE（`2b3a860d`）重跑 **21 條 HEAD-FAIL**。

## ⚠ 部署

`server_admin_patch.js` 與 `dump-client-monitor.cjs` **不在 GitHub Pages 的部署範圍**，
push 綠燈不代表已生效：

- **`oracle-admin/update-admin-full.bat`** —— SCP `admin.html` ＋ `server_admin_patch.js`
  ＋ `oracle_admin_update.sh` 上 VM 並重啟 pm2。
  **8KB 上限、`truncated`/`rawLen` 的寫入與讀出、admin 明細的「⚠ 已截斷」標示，
  全部要跑這一支才生效。**
- **`oracle-admin/redeploy-oracle.bat`** —— 站台本體（`/game` 的 bundle），本版只有 `VERSION`
  字串變動，站長要不要順手跑自行決定。
- `oracle-admin/dump-monitor.bat` 每次執行時**自己**把 `dump-client-monitor.cjs` SCP 到
  `/tmp/` 再跑（`node /tmp/dump-client-monitor.cjs`），**不必另外部署**；
  `require.main === module` 在這條路徑下成立，行為與以前完全相同。

⚠ 本版**沒有**動 `server-engine.cjs` 的任何 export ⇒ 不需要跑 `update-tournament.bat`。

---

# v6.183 全站換上新識別（屬性色環 logo）

站長已驗收通過方案 4「屬性色環」：**8 段屬性色環（草火水雷超鬥惡鋼，⚠無妖）＋中央金框深藍卡＋白色四芒星**。
素材、產生器、規格與踩坑史全部進 repo：`logo-final/`（含 `skill/SKILL.md`，一份可獨立重現這套識別的說明）。

## 換了哪些檔

| 檔案 | 來源 | 驗證 |
|---|---|---|
| `static/icons/icon-32.png` | `logo-final/logo-32-light.png`（簡化版構圖） | 32×32 |
| `static/icons/icon-180.png` | 完整版母檔以 180 重新光柵化 | 180×180 |
| `static/icons/icon-192.png` | 完整版母檔以 192 重新光柵化 | 192×192 |
| `static/icons/icon-512.png` | 完整版母檔以 512 重新光柵化 | 512×512 |
| `static/icons/icon-512-maskable.png` | 淺底 96% 版 | 512×512 |
| `static/og-image.png` | `og-image-1200x630.png` | 1200×630 |
| `oracle-admin/icons/site-icon-192.png` | 同 `icon-192.png`（報告圖落款的同源副本） | 位元相同 |

⚠ **180/192 不是拿 512 縮放存檔**，是在 `gen_logo.py` 加了 `site-icons/` 這一組 render 行、
以目標尺寸重新光柵化（完整版的光澤、細縫、小星在縮圖時會糊掉；32px 更是一律用簡化版構圖）。
五顆 icon 與 `logo-final/site-icons/` 位元相同，任何人重跑 `python3 gen_logo.py` 都能重現。

## 快取三層

1. `?v=`：`src/app.html` 6 處（manifest／apple-touch-icon／32／192／512／splash）與
   `static/manifest.json` 3 處，全部 `4.993 → 6.183`。iOS 對 apple-touch-icon 的快取極頑固，
   URL 不換就永遠是舊圖。
2. SW precache：`CACHE_NAME = ptcg-tw-sim-${version}`，`static/` 下的檔案都在 `files` 裡，
   版本一 bump 就是新的 cache key ⇒ `notify.ts`／`service-worker.ts` 的通知 icon 路徑不必改碼。
3. Cloudflare：icons 沒有 bypass 規則 ⇒ 靠 `?v=` 換 URL 繞開。

`oracle-admin/admin.html`：`SITE_VERSION_HINT` 跟到 6.183；報告圖落款 `icons/site-icon-192.png?v=1.65 → 1.66`。
⚠ admin 自身的紫色 ADMIN favicon（head 4 條 `icons/icon-*.png`）與主站 logo 無關，**沒有動**。

## 守衛 `scripts/test-v6183-site-logo-assets.mjs`（16 項，已進 npm test）

「檔案存在／字串出現」擋不住這一類事故，所以守衛**自己解 PNG 看像素**（node:zlib + 手工 unfilter）：

- ⓪ 解碼器先自我驗證：合成一張已知像素的 PNG 解回來比對，並用壞檔做正對照。
- ④ 五顆 icon 各取 8 個扇形取樣點，做**最近鄰分類**確認「12 點鐘起順時針＝草火水雷超鬥惡鋼」。
  ⚠ 取樣點會被光澤層洗淡，直接比 RGB 會把草段誤判成鋼段；改比
  `(c-min)/(max-min)` 正規化彩度 —— 與白／黑做線性混合時它是不變量，實測 8 段誤差 0.000。
  色票一律回頭讀 `src/lib/cards/energy.ts` 的 `ENERGY_COLOR`，不在守衛裡硬寫。
- ⑥ maskable：r=195 在環上、r=204 已是底色（＝內容真的縮到 96%），而 icon-512 在 r=204 仍是環
  ⇒ 兩顆不可能是同一個構圖。⑦ icon-32 的 8 段必須**接近原始色票**（簡化版沒有光澤層）
  且 r=132 仍在環上（簡化版內半徑 120，完整版是 144）⇒ 證明不是把 512 縮下來。
- ⑧ 五顆 icon 與 `logo-final/site-icons/` 位元相同；⑨⑩ `?v=` ≥ 6.183 且 app.html 與 manifest 一致、
  三個 src 都指得到實際存在且尺寸相符的檔案；⑪ og-image 1200×630 且底部 8 色條＝ENERGY_COLOR；
  ⑫ site-icon-192 與 icon-192 位元相同、admin `?v=` ≥ 1.66；⑬ admin 自身 favicon 沒被改掉；
  ⑮ 全部換過的 PNG 都能完整解碼（magic bytes／IEND／zlib 流）—— 二進位被當文字處理過就會炸。

HEAD-FAIL：在 v6.182 上跑同一支守衛 **11 項 FAIL**（④⑤⑥⑦⑧⑨⑩⑪⑫⑭⑮）。

## 沒有動的

- `static/line-group-qr.png`：實際解碼檢查過，是純黑白 QR（650×650、1.8KB），**中央沒有嵌任何 logo**，
  不需要重出。
- repo 根 `YouTube縮圖_1280x720.png`：**沒有被 git 追蹤**（站長本機的行銷素材）。已在本機換成新縮圖，
  舊檔另存 `YouTube縮圖_1280x720.舊識別備份.png`；進 repo 的是 `logo-final/youtube-thumb-*.png`
  （底圖無標題，供 Canva 每週疊字）。
- `src/lib/notify.ts` L176/L256、`src/service-worker.ts` L149：路徑沿用 `icons/icon-192.png`，
  不改碼（SW cache key 跟著版本走）。

## ⚠ 玩家端何時看得到

一般瀏覽器：`?v=` 換了 URL，重新整理即是新 icon。
**已安裝的 iOS PWA 例外**：主畫面捷徑的圖示是安裝當下存下來的，不會因為 manifest 更新而換 ——
必須移除捷徑後重新加入。首頁 changelog 已用玩家看得懂的說法寫了這一點。

# v6.182 牌組公布欄「玩家留言板」

站長需求（原話）：
> 牌組公佈欄，請幫我在牌組點選進去後可以增加一個玩家的留言板，可以留言討論。
> 介面除了也顯示愛心、下載數，也請顯示留言數，供玩家們參考。

## 資料模型

新增 collection `deckPostComments`（**軟刪**）：
```
{ _id:'dc_…', postId, uid, email, authorName, admin:bool, text, status:'published'|'deleted', createdAt, deletedAt?, deletedBy?:'author'|'admin' }
```
索引 `{postId:1, status:1, createdAt:-1}`（列表查詢的形狀就是這個）與 `{uid:1, createdAt:-1}`。

`deckPosts` 新增非正規化欄位 `commentCount`。

## 端點（⚠ 路徑遮蔽）

```
GET    /api/deck-posts-comments?postId=&before=&limit=
POST   /api/deck-posts-comments            { postId, text }
DELETE /api/deck-posts-comments/:cid
GET    /api/admin/deck-posts-comments?postId=&status=
```

⚠⚠ **一律用連字號獨立前綴**，絕不寫 `/api/deck-posts/comments`。
`/api/deck-posts/:id` 是**單段** pattern，任何**同段數**的 `/api/deck-posts/具名字串`
都會被它整個吃掉，而且回的是 404「找不到這篇投稿」—— v6.138 的
`tournament-eligibility` 就是這樣 100% 打不到、連錯誤 log 都沒有。

⚠ Express 的實際語義要講精確（本輪把它寫進守衛的模擬器）：
`/a/:id` **只吃同段數**的路徑，`/a/x/comments`（4 段）**不會**被 `/a/:id`（3 段）吃掉。
真正的地雷是「段數相同、其中一段是具名字串」。守衛用這一點做**自我驗證**：
先餵一組合成路由表 `['/api/deck-posts/:id', '/api/deck-posts/comments']`，
確認模擬器真的判出遮蔽，再拿它去驗真實路由表。

## 限流順序（v6.140 教訓）

`dpCommentCreate` 的順序是刻意的：
① `dpIdentity` → ② **純同步、不碰 DB 的內容驗證** → ③ 通過了才 `dpRate`。
③ 之後才發生的 404（投稿不存在／已下架）會 `dpRateRefund` 退回。
守衛用 mock 的 `dpRate` 記錄呼叫次數，**行為端**斷言「空白/超長被拒時 rateCalls 為 0」。

`dpCommentDelete` 的 no-op（找不到／已經是 deleted）同樣退回額度 —— 否則連點兩下吃兩格。

## 刪除冪等（v6.140 教訓）

「找不到」與「已經是 deleted」一律回 **200 `{ok:true, changed:false}`**，不回 404。
只有真正發生 `published → deleted` 轉換（`matchedCount === 1`）才：
- `commentCount -1`
- `_dpListCache.clear()`
- 回 `changed:true`

⇒ 連點 N 次，`commentCount` 不會被扣成負的。前端也只在 `r.changed` 為真時才扣本地計數。

## 留言數怎麼不漂移

1. `+1` 只發生在 `insertOne` 成功之後；`-1` 只發生在真正的狀態轉換之後（嚴格配對）。
2. 軟刪 ⇒ **明細表永遠是權威**，快照壞了隨時算得回來。
3. `/api/admin/deck-posts/recount` 一併對帳 `commentCount`
   （`$match status != deleted` → `$group by postId`）。這支已抽成具名函式 `dpAdminRecount`，
   守衛**人為製造漂移（塞 99）再跑它**，斷言修回 1 且軟刪的沒被算回來。
4. 讀取端 `dpPublic` 夾 `Math.max(0, …)`，歷史髒資料不會顯示成負數。

## 列表不得 N+1

`commentCount` 直接掛在 `deckPosts` 上，`dpPublic`（**同步函式**）逐欄挑出來。
守衛兩道：① 靜態斷言 `/api/deck-posts` 列表 handler 完全沒有出現 `DPCOMM`；
② 行為端斷言 `dpPublic` 不是 async（是 async 就有機會在列表逐筆 await 查 DB）。

## 權限

- 留言：**只有 `dpIdentity` 通過（email 帳號、verified）的玩家**。匿名／未登入 401/403。
- 刪除：**作者本人或 admin**（`isTournAdmin`）。其他人 403 且留言不受影響。
- admin 的刪除按鈕：`GET /api/deck-posts-comments` 回 `isAdmin`，前端據此**畫按鈕**；
  ⚠ 那只是 UI 提示，真正的授權在 `dpCommentDelete` 內部，不靠 client。
  admin 刪除不另開端點 —— 兩條路徑會漂移。
- 公開回應永不含 `uid` / `email`：`dpCommentPublic` 是白名單，`mine` 由伺服器比對後只回布林。

## 政策參數（Wilson 可調）

| 參數 | 值 | 位置 |
|---|---|---|
| 單則字數上限 | 300 | `DP_CMT_MAX` ＋ 前端 `COMMENT_MAX`（兩處要一起改） |
| 一次回幾則 | 50（上限 100） | `DP_CMT_PAGE` |
| 每人每分鐘留言數 | 10 | `DP_CMT_PER_MIN` |
| 保留名（只有 admin 可用） | 系統管理員 | `DP_CMT_RESERVED_NAME` |
| 刪除操作 | 30 次/分 | `dpRate('cx:'+uid, 60000, 30)` |
| 列表讀取 | 120 次/分 per IP | `dpRate('cl:'+ip, 60000, 120)` |

## 前端

- `/deck-posts` 明細 modal 的 `modal-foot` **之後**加留言區（主要動作不被留言擠下去）。
- 列表（全部投稿／我的投稿）與明細都顯示 `💬 n`，與 `♥`／`⬇` 並列。
- 未登入 ⇒ 顯示「登入 email 帳號後可以留言討論。」，**不畫輸入框**。
- 載入失敗 ⇒ 走 v6.177 中央 `adoptOrKeep`（`$lib/ui/stale-keep`），保留上一份好資料並標「更新中」，
  **不清空、不另寫一套**。
- 錯誤隔離：留言區的錯誤**只寫 `commentError`**。寫 `detailError` 會讓 modal 的
  `detailLoading → detailError → openPost` 分支把整份牌表換成一行錯誤（v6.140 按讚踩過）。
- 送出失敗**不清空輸入框**（v6.175：使用者輸入被丟棄）。
- `commentSeq` 代次：切換／關閉明細時遞增，遲到的回應不會畫到另一篇上。
- 手機：不新增任何 `@media`（本頁一直是單一自適應版面）；靠 `flex-wrap` ＋
  `width:100%/box-sizing:border-box` ＋ `overflow-wrap:anywhere`（長英數字串會撐爆 modal）。

## XSS

全頁**零 `{@html}`**（守衛剝註解後做否定型掃描，並先自我驗證剝註解真的有作用）。
留言內文與名稱都是 `{c.text}` / `{c.authorName}` 純插值，走 Svelte 預設跳脫。
不做關鍵字過濾（練習站），管理手段＝admin 可刪任何一則。

## Fable 5 review 抓到的（逐項自行查證後才改）

| 發現 | 我的查證 | 處置 |
|---|---|---|
| `submitComment` 沒有代次守衛 | **屬實**。fetchComments/openDetail/closeDetail 都有，唯獨寫入路徑漏了；送出中切到另一篇，遲到的成功回應會把 A 篇的留言接到 B 篇列表 | 補 `const seq = commentSeq` ＋ 寫回前比對；`deleteComment` 一併補。守衛新增「代次要蓋到寫入路徑」且斷言比對發生在寫回之前 |
| refund 讓「不消耗就能無限打 DB」 | **屬實**。create 404 與 delete no-op 都退額度 ⇒ 淨消耗 0，拿假 id 跑迴圈每發吃一次 verifyIdToken＋findOne | **兩個 refund 全拿掉**。v6.140 要救的是「內容不合格 → 改好再送」（400），而 400 在驗證階段就擋掉、本來就沒消耗；404／no-op 不是那種情境 |
| insert 成功但 `$inc` 失敗會回 500 | **屬實**。留言已寫入卻回報失敗 ⇒ 玩家重送變兩則 | `$inc` ＋ cache clear 包 try/catch，失敗只 warn 仍回 200（計數交給 recount）。delete 的 `-1` 同樣處理 |
| 「系統管理員」可被冒名 | **屬實**。`authorName` 來自玩家自填的報名暱稱 | 新增 `DP_CMT_RESERVED_NAME`，非 admin 的名字正規化（去半形／全形空白）後等於保留名就改成「玩家」。⚠ 大廳聊天 `/api/tournament/chat` 有同一缺口，**本版沒動**，另案 |
| 明細標題數字可能與列表不一致 | 部分屬實，但**它說的原因是錯的**：它說 header 讀 30 秒快取的列表 payload；實際上 `/api/deck-posts/:id`（L5755~5759）是 `no-store` ＋ 直接 findOne，開啟當下是新鮮的。真正的窗口是「開明細」與「抓留言」兩發之間別人留言了 | 仍採納：`fetchComments` 成功時用伺服器回的 `total` 校正 `openPost.commentCount` |
| `dpAdminRecount` 不原子 | 屬實，但這是既有 likeCount/downloadCount 對帳就有的性質（aggregate 快照 → 逐篇 `$set` 絕對值）。admin 手動、低頻 | 不改，記錄在此。若日後要自動排程，要先改成 diff 式 `$inc` |
| 分頁游標 `$lt: createdAt` 同毫秒會跳過 | 屬實，機率極低（每人 10 則/分） | 不改，記錄 |
| `dpIp` 信任 `cf-connecting-ip` | 既有設計（v6.138 就這樣），前提是 origin 只走 cloudflared | 不改 |

## 守衛

`scripts/test-v6182-deck-post-comments.mjs`（43 項，已進 npm test）。
HEAD-FAIL 實測：還原 HEAD 的 `server_admin_patch.js` ⇒ FAIL 25；
還原 HEAD 的 `+page.svelte` ⇒ FAIL 12。
另外 `scripts/test-deck-posts.mjs` 的 recount 斷言 anchor 改抓 `async function dpAdminRecount`
（v6.182 把它抽成具名函式），並加驗 `DPCOMM.aggregate`；下載／rename 兩處的結尾 anchor
也收窄，避免留言板整段被切進否定型斷言的掃描範圍。還原 HEAD ⇒ 該檔 FAIL 2。

⚠ 本輪自己踩到一次：handler 的 `try/catch` 會把 `ReferenceError` 吞成 500 ——
沙盒少注入一個閉包相依（`DP_CMT_RESERVED_NAME`）時，下游斷言表現成「筆數不對：0」，
完全看不出真因。已在環境自我驗證那一項加上 `statusCode !== 500` 的明確斷言。

做法上兩點值得沿用：
- **router 模擬器**：把全檔 `app.<method>('<path>'` 依序抓出來，用 Express 語義比對，
  求值「這個 URL 會命中哪一支」。模擬器自己先用合成路由表驗過。
- **記憶體 mongo mock**：`dpCommentNormalize` / `dpCommentList` / `dpCommentCreate` /
  `dpCommentDelete` / `dpAdminRecount` / `dpPublic` 全部從原始碼抽出來注入 mock **真的跑**，
  斷言的是 HTTP status、DB 內容與計數值，不是「有沒有呼叫某個函式」。

## 部署

⚠ 改了 `oracle-admin/server_admin_patch.js` ⇒ 站長要跑 `oracle-admin/update-tournament.bat`
（伺服器端不會自己更新）。前端走一般部署流程。

# v6.181 特性可用性收斂成單一述詞 ＋「拒絕 = 完全 no-op」單一出口

## 回報（玩家原話）
> 戰槌龍ex 的【特性】破壞頭錘，要在戰鬥場上時才能使用。但現在在備戰區時系統也會提供發動特性的
> 選項，在按下後會表示「必須在戰鬥場才能使用」，且同一回合移動到戰鬥場上會顯示已使用特性，
> 導致不能發動。

卡面（`static/cards/M5.json` id 19187 / 19263，J 標）逐字：
「**若這隻寶可夢在戰鬥場上**，則在自己的回合時可使用1次。擲1次硬幣若為正面，
則選擇1個對手的戰鬥寶可夢身上附加的能量，將其丟棄。」

## 真因（兩層，都行為端重現過）

### 維度 A — 「能不能用」有兩份述詞
UI（`+page.svelte` L3012、`MobilePortraitBattle.svelte` L279）與本機 AI（`ai.ts` L229）
都讀 `engine.getUsableAbilities`；但 `getUsableAbilities` 的 per-card gate 清單裡
**沒有** `破壞頭錘` 這條，位置限制只寫在 `m5_preview.ts` 的 regA 內部 early-return。
⇒ 備戰時按鈕照亮。這是 v6.127 幸福切換／v6.131 日光轉移／v6.132 平靜之光的**同一家族**
（「gate 與 regA 是兩份獨立條件，改了一邊忘了另一邊」）。

### 維度 B — 動作被拒絕卻留下副作用
`engine.ts` 的 `USE_ABILITY` 是**先**標記 `abilityUsedThisTurn = true`（L4534~4545）
**再**呼叫特性函式。特性函式 early-return 一行 log 時，特性權已經沒了
⇒ 同回合移到戰鬥場也不能再用。這一維比單張卡嚴重得多：站內
`regA` 內部「條件不符 → 只 log」的早退共 **141 處**（掃描器見下）。

## 修法（中央收斂，兩條）

1. **單一述詞**：`USE_ABILITY` 直接以 `getUsableAbilities(state, pool)` 為唯一可用性判準
   —— 不在那份清單裡就 `return state`（完全 no-op）。UI／AI／引擎從此不可能漂移。
   （從手牌使出／進化／回備戰觸發的特性走 `promptPlayAbilities` 的 modal，本來就被
   `getUsableAbilities` 排除，不經過這條路徑。）
2. **單一拒絕出口**：新增 `_shared.ts` 的 `rejectAbilityUse(state, msg, idx)`（在 state 上
   蓋 transient 旗標 `_abilityUseRejected`），`applyAction` 出口偵測到旗標就
   **原樣回傳動作前的 state**、只補那一行原因 log。
   ⚠ 若這個 action 是在解析既有 `pendingSelection`，整包回捲會把 picker 一起還原、
   把玩家鎖在同一個永遠答不完的選擇視窗 ⇒ 該情況只清旗標＋記原因，不回捲。
   141 處早退已機械式改為 `rejectAbilityUse`。

### 轉換的判準（掃描器規則，寫在測試裡當永久守衛）
只轉「效果**根本沒開始執行**」的分支：`return addLog(<第一個參數名>, …)` 且該變數在此之前
**沒有被重新賦值**。這條規則自動排除了所有危險案例：
- 擲幣之後（`st = r.state` / `r.state`）：破壞頭錘反面、穹天狩獵反面、母親的誘引反面、
  花潔夫人 全部條件判斷（它是**先擲幣再判對手備戰**）
- 代價已付之後：奇樹的大電海燕｜閃光抽出「牌庫已空，無法抽牌」（自身能量已棄）
另手動排除兩則「已發動、只是沒有結果」：西獅海壬｜全滿旋律（註解明寫仍消耗 1 次）、
莉莉艾的蝶結萌虻｜邀請眨眼（對手手牌已揭示）。

## 一併補上的 gate（維度 A 掃描結果，逐張都只用卡面逐字或公開／已知資訊）
| 卡｜特性 | 補的條件 | 依據 |
|---|---|---|
| 戰槌龍ex｜破壞頭錘 | 必須在戰鬥場 | 卡面逐字 |
| 弱丁魚ex｜大洋增輝 | 必須在戰鬥場 ＋ 有傷害 | 卡面逐字 ＋ 治癒類既有 gate（飛葉治癒／甜點之禮） |
| 尼多后｜母親的誘引、花潔夫人｜媚惑引誘 | 對手有戰鬥寶可夢且備戰非空 | 同型 毒粉蛾｜微風吹拂 的既有 gate |
| 鴨嘴炎獸｜拍檔提升 | 手牌有基本【火】或【雷】＋ 場上有電擊魔獸／鴨嘴炎獸 | 已知區（判準③） |
| 杖尾鱗甲龍｜鱗片律動 | 牌庫非空 ＋ 場上有【龍】 | 牌庫張數公開（L821）＋ 已知區 |
| 銀伴戰獸｜拍檔呼喚 | 手牌 0 張 ＋ 牌庫非空 | 卡面逐字 ＋ 牌庫張數公開 |
| 竹蘭的尖牙陸鯊｜王者呼聲、蓋諾賽克特ex｜金屬信號、銃嘴大鳥｜天空抽出 | 牌庫非空 | v6.132 站長裁定（只判張數不看內容） |

⚠ **破壞頭錘另外補了「對手戰鬥位要有能量」**（Fable 5 審查指出的站內不一致）：
毒粉蛾｜微風吹拂卡面與破壞頭錘**逐字同構**（「擲1次硬幣若為正面，則選擇1個對手的戰鬥寶可夢
身上附加的能量，…」，只差丟棄／放回手牌），而微風吹拂**站內既有**這條 gate（v2.996 起）。
只 gate 一張會變成同句型兩種行為 ⇒ 採既有判準拉平。
⚠ **請站長複核**：若裁定「擲幣是無條件的第一步、這類不該 gate」，
則破壞頭錘／微風吹拂／母親的誘引／媚惑引誘**四張要一起改**，不可只改一張。
⚠ 夢幻ex｜重啟同型但是 **G 標**，依鐵律不維護 → 沒有加 gate（regA 的早退仍照機械規則轉換）。
⚠ 同版順手修官方特性名（玩家可見 log）：`m5_preview.ts` 的「破壞**之**頭錘」→「破壞頭錘」（5 處）、
銃嘴大鳥的「天空**抽牌**」→「天空**抽出**」（4 處）。兩者卡面逐字見 `static/cards/M5.json`。

## Fable 5 審查（結論已自行查證）
- ✅ ability fn 的呼叫點全站只有 4 個（`engine.ts:4536` USE_ABILITY、`effects.ts:17585`
  play-ability prompt、`_shared.ts:2352` promote prompt、`v3050:304` retreat prompt）。
  後三個都在 `RESOLVE_SELECTION` 內（`RESOLVERS.get` 全站唯一呼叫點 `engine.ts:3141`）
  ⇒ 一定走「只清旗標、不回捲」那條 ⇒ transient 旗標不會外洩到 Firestore。
- ⚠ 那三條 prompt 路徑本來就是「先標記 abilityUsedThisTurn 再呼叫 fn」，reject 時標記會留著。
  實務上不可達（潔淨支援／全能變身／返回重載都不在手動清單），**未在本版改動**，記在這裡待下輪。
- ⚠ 回捲的前提是 immutability：`v2306_meta_pokemon.ts:381` 遠古巨蜓ex 有
  `p.active.abilityUsedThisTurn = true` 的**就地變異**（目前寫在 reject 之後，安全）。
  已加守衛 (N)：regA 內對 `abilityUsedThisTurn / damage / energyAttached` 的就地賦值
  不得出現在 `rejectAbilityUse` **之前**。
- 🔨 下輪 audit：`PLAY_TRAINER`（`engine.ts:4011~`）是「先進棄牌＋先標 supporterPlayedThisTurn，
  再跑 effectFn」，與特性修前**完全同型**的兩份獨立條件（gate 在 `canPlayTrainer`/regG）。
  目前沒有實證 bug，但同一判準應該掃一輪。

## 守衛
`scripts/test-v6181-ability-gate-and-reject-noop.mjs`（38 斷言，HEAD 端 14 條 FAIL）：
行為端逐張驗新 gate 的**正反兩面**（條件不符要消失、條件符合要出現且效果真的發生）、
`rejectAbilityUse` 的完全 no-op（盤面／特性權／log 行數／transient 旗標不外洩）、
以及結構掃描（regA 內不得再有未走 `rejectAbilityUse` 的拒絕早退）。
⚠ 掃描器自帶**正對照**（餵違規樣本必須被抓到）＋**下限斷言**（`regA` 註冊數 > 100），
避免變成永遠綠燈的安慰劑。

# v6.180 錦標賽盤面「跳回上一步」：採納收斂成單一中央閘（版本必須前進）

## 回報
站長轉述：「蠻多玩家反應最近會一直跳回上一步，不確定他們的版本。」

## 真因（兩條，都行為端重現過）

### ① 盤面採納有 4 個入口，版本守衛只有 1 個
`+page.svelte` 會把 `game` 指成伺服器盤面的地方一共 4 處，而只有 `tAdopt`（L5271）有
`version < tVersion` 的早退。另外三條都是刻意「繞過版本檢查」的強制回正路徑，
而且**全部是 `?v=-1` 的請求、與主輪詢並行**（主輪詢是 `setInterval(...,400)`，不等前一發完成）：

| 路徑 | v6.179 的寫法 | 守衛 |
|---|---|---|
| 輪詢停擺救援（v5.593，L579） | `game = fr.gameState; tVersion = fr.version;` | **完全沒有** |
| `tForceResync`（v5.618，L5740） | `if (fr.version !== tVersion) { game = …; }` | **`!==` 連較舊的也照收** |
| 主輪詢 else 分支（v5.593，L5970） | `r.version < tVersion && reqV === tVersion` | v6.135 有亂序守衛 |
| `tAdopt`（L5271） | `version < tVersion` return | 有 |

⇒「救援／重新同步的回應（版本 N）晚於主輪詢的回應（版本 N+1）抵達」是很普通的時序，
盤面就被指回 N ＝ **畫面倒退一步**，下一發輪詢再推回 N+1 ＝ 玩家說的「跳回上一步」。
`tForceResync` 的呼叫點很多（新鮮度看門狗、玩家點「等待對手行動 🔄」、「我還在」確認框、
動作送不出去、v6.170 的回前景／`online` 事件）⇒ 會**反覆**發生。

⚠ **這不是 v6.170~v6.179 新造成的回歸**：v6.121（`e8475ca3`）逐字比對，三條路徑一模一樣，
而且它的主輪詢 else 分支**連 v6.135 的 `reqV === tVersion` 都沒有**（v6.121 也沒有 v6.148 的
`_pollBusy` 防自我壅塞 ⇒ RTT 一高就同時在途 3 發）⇒ 舊 client 只會更嚴重。

### ② v6.137 的樂觀更新回滾守衛是**死碼**（Fable 5 審查抓到，我實跑證實）
`_tRestorePrediction` 的 `if (ctx.predicted && game === ctx.predictedRef)`：
`game` 是 Svelte 5 的**深層** `$state`，編譯產物是 `$.set(game, pr.predicted, true)`
（`should_proxy=true`）⇒ 存進去的是 `proxy(pr.predicted)`，而 `proxy(raw) !== raw`
（`svelte/src/internal/client/proxy.js`，5.55.4 實跑驗證）⇒ 讀回來的 `game` 永遠不等於
`ctx.predictedRef`（存的是原始物件）⇒ **那道還原從上線至今一次都沒有執行過**。

後果就是同一型症狀的另一半：動作最終送不出去時紅字寫「畫面已還原」，畫面上卻**還留著**
伺服器根本沒套用的動作；等下一次版本前進（對手動作／看門狗）才被伺服器盤面洗掉
⇒ 「過一下子突然跳回上一步」。`tActCancel`（停止重送）同理 —— 它接著呼叫的 `tForceResync`
在版本沒變時（動作真的沒套用）`fr.version !== tVersion` 不成立，也不會回正。

⚠ 我原本的假說是「v6.173 的 `shareStateIdentity` 沿用 prev 物件 ⇒ 打壞了那道 identity 守衛」，
**這個假說是錯的**：守衛在 v6.173 之前就已經是死碼。我第一版的守衛用 plain 物件模擬 `game`，
測到的是假語義（IRON_RULES Rule 25「掃描器自身要先驗」的重演）。已改成帶真 svelte proxy 的實跑。

## 修法（中央收斂）

`src/lib/game/sync-guards.ts` 新增純函式 `decideBoardAdopt({localVersion, incomingVersion, expectVersion})`：

- `incomingVersion` 非有限數 ⇒ `no-version`（fail-open，維持改動前行為）
- `localVersion < 0` ⇒ `first`（換房間／進場）
- `incomingVersion >= localVersion` ⇒ `forward`
- 否則 `expectVersion === localVersion` ⇒ `client-ahead`（送出到現在本地一次都沒採納過東西
  ⇒ 是真的 client 超前，不是亂序 ⇒ 讓伺服器權威回正）
- 否則 `out-of-order` ⇒ **丟棄**

`tAdopt(state, version, { expectV, reason })` 成為**唯一**採納出口；四條路徑全部改走它。

### 為什麼「版本必須前進」是安全的（查證，不是假設）
`oracle-admin/server_admin_patch.js` 裡 `TROOMS.version` 的**每一個**寫入點都是 +1：
`/action` 套用 `doc.version + 1`（CAS）、`/reset` `(prev.version || 0) + 1`（**不是歸零**）、
排程器判負警告／level-triggered 補推／admin 裁定／重賽全是 `+1`。沒有任何路徑讓它變小。

### 合法的「版本重置」怎麼放行（比原 bug 更容易修壞的地方）
- **換房間**：`tEnterMatch` / `tSpectate` / `tournamentJoin` 進場時一律 `tVersion = -1`
  （離場點本來就有；但「觀戰中發現是自己的場 → 直接 tEnterMatch」不經任何離場點）⇒ 走 `first`。
- **client 真的超前**：`client-ahead` 逃生口（原 v6.135 的判準，升級成所有採納點共用）。
- **伺服器沒給版本**：`no-version` 照收。

### ⚠ `>=` 的「等於」刻意保留（Fable 5 建議收緊成 `>`，查證後不採納）
`/action` 的 `rejected` / `notyourturn` / `invalid` 三種回應都帶**版本沒變**的權威盤面，
而 `_tActAttempt` 正是靠那一發 `tAdopt` 把「引擎拒絕了、畫面上卻還畫著」的樂觀預測洗掉
（下一行就把 `ctx.predicted` 設 false，之後沒有人會再還原它）。改成 drop ⇒ 被拒絕的動作
**永遠留在畫面上**，正是本版要根治的症狀。

## 一起修的（Fable 5 審查）
1. `ctx.predictedRef = game`（存讀回來的 proxy）＋ `tVersion === ctx.baseV` 才可還原
   ⇒ 回滾**真的**會執行，而且不會把伺服器已確認的動作洗掉。
2. `tForceResync` 與停擺救援補**代次/房間快照**（`_rGen !== tPollGen || _rRoom !== tActiveRoom` 即作廢）：
   版本閘天生擋不住跨房 —— 離場後 `tVersion` 歸 -1，晚到的回應反而會走 `first` 被照收，
   把 `game` 復活、`tStep` 拉回 `'playing'`（玩家被彈回已結束的對戰）。主輪詢從 v5.586 就有這道，
   這兩條一直沒有。`tournamentReset` 也補 `tPollGen++`。
3. 觀戰輪詢收進同一條管線（觀戰者沒有 resync／看門狗可以自救，`client-ahead` 對他們更重要）。
4. 診斷指紋 `stale-board-drop`：**累積 3 次**才送（偶發 1 次是守衛正常工作），且**不佔**
   每頁 3 發配額（v6.158「真指紋被 manual-sync 吃掉」的教訓）；每一發診斷的 `poll` 區塊
   都會帶 `staleAdopt` 計數與最後一筆 `來源:版本<本地版本`。

## 沒有動到
卡效果／引擎／伺服器端一行都沒動（本版是純 client）。休閒線上（`room-oracle.ts`）的
`oraclePollRoom` 是**序列化**輪詢（await 完才排下一發）⇒ 結構上不存在這種亂序，
收端 `resolveRoomUpdate` 的 log 長度單調守衛照舊；守衛裡有正反對照釘住。

## 守衛
`scripts/test-v6180-board-monotonic-adopt.mjs`：**PASS 50 / 在 v6.179 樹上 FAIL 21**。
A 純函式判準（含 4 條正對照，防止修成「畫面永遠不更新」）｜
B 行為端實跑 `tAdopt`｜C 行為端實跑 `tForceResync`（假 tApi 製造真正的亂序時序，
v6.179 上實測 `v=20` ＝ 盤面真的倒退了）｜D 真 svelte proxy 語義下的回滾守衛｜
E 接線否定型掃描（先剝註解）＋ 掃描器自我驗證｜F 休閒線上兩條正反對照｜G 版本標示。

# v6.179 把「網路」那 1.3 秒拆開：queue / wire / sw / lag（純量測，玩家零可見變化）

## 為什麼要再拆一次

v6.159 的四段拆分已經把範圍縮到一點上：`net`（送出 → 第一個位元組）中位 **1.3 秒**、最大 **14.9 秒**，
而 `dl`（body 下載）只有 **27ms**、`parse` 1ms、`adopt` 3ms、`paint` 50ms、`lt` 中位 0。
⇒ **時間全在「等第一個位元組」**，既不是體積也不是主執行緒。
伺服器與隧道實測也無罪（VM 上 node 3.7ms、繞 Cloudflare 一圈 65ms；nginx 5xx=0、event loop 0.16ms、Mongo queued 0）。
所以剩下的可能全部落在「請求真的送出去之前」那一段 —— 而 `perf.api.net` 是用 `performance.now()`
包在 `fetch` 前後量的，那個區間裡其實藏了四件不同的事。本版把它們分開量。

| 欄位 | 算式 | 代表什麼 |
|---|---|---|
| `seg.queue` | `requestStart - fetchStart` | DNS＋TCP＋TLS＋瀏覽器連線排隊（**請求還沒送出去**） |
| `seg.wire` | `responseStart - requestStart` | 真正的請求往返（Cloudflare、隧道、VM） |
| `seg.sw` | `fetchStart - workerStart` | **Service Worker 派送成本** |
| `seg.lag` | `net(JS 量的) - (responseStart - startTime)` | 瀏覽器時間軸解釋不了的殘差＝`await` 續行在等主執行緒空檔 |

## ⚠⚠⚠ 本輪最重要的更正：SW 派送成本**不在** `queue` 裡

任務假設是「`queue = requestStart - fetchStart` ⇒ 瀏覽器排隊 **+ Service Worker 派送**」。
查證後**這一半是錯的**：

- W3C Resource Timing §3.3：`workerStart` 取 fetch timing info 的 **final service worker start time**；
  `fetchStart` 取 **post-redirect start time**；`requestStart` 取 **final network-request start time**。
  時間軸順序是 `startTime → workerStart → fetchStart → domainLookup… → requestStart → responseStart`。
- MDN `PerformanceResourceTiming.workerStart` 的官方範例逐字寫著
  `const workerProcessingTime = entry.fetchStart - entry.workerStart;`。

⇒ SW 派送（含 Android 冷啟動 SW 執行緒的數百 ms）落在 **`workerStart → fetchStart`**，
`requestStart - fetchStart` 完全不含它。若照原假設把它算進 `queue`，
下一輪會得到**與事實相反**的結論。所以 `sw` 是**獨立一欄**，
而且只在 `fetchStart - workerStart > 0` 才記，不合這個順序的瀏覽器記進 `swOdd`（不硬算）。

⚠ 但 `perf.api.net` **確實包含** SW 那一段（它是 `performance.now()` 包在 fetch 前後量的），
所以「`net` 大但 `queue`＋`wire` 都小」時，要去看 `sw` 與 `lag`。

## 對齊策略（對不上就丟，絕不硬湊）

Resource Timing 的 entry 必須對回「哪一發 fetch」才有意義：

1. `tApi` 在 `_segT1`（token 段結束、fetch 即將送出）開一個時間窗 `{ u, t1, t2, used }`，
   `_segT2`（header 回來）時關窗。範圍守衛與 `_tRecordApiSegments` 逐字一致
   （只有 `/action` 與短輪詢 `/state`，排除 `wait=1`）—— 母體不一致的話「對不上」的比例會變假訊號。
2. entry 進來時先做**逐筆自我驗證**：`startTime ≤ fetchStart ≤ requestStart ≤ responseStart`
   且 `fetchStart > 0`，不成立就丟棄計入 `seg.bad`。
3. 用 `entry.name`（絕對 URL）比字尾 + `entry.startTime` 落在 `[t1-2, t2+2]`（±2ms 容忍 Safari 的時戳粗化），
   取 `|startTime - t1|` 最小的那個窗，**一對一認領**（`used`）。
4. 對不上就 `seg.bad++` **並丟棄**。逾時／abort 的那一發永遠不會關窗（`t2` 維持 0）⇒ 直接跳過，
   與 rtt／四段拆分同一條紀律：**只記成功的往返**。

`seg.bad` 大 ⇒ 那一列的 `queue`／`wire` **不可採信**（而不是「很順」）。

## 量測本身的成本

- **不新開 PerformanceObserver**：沿用 v6.170 那顆 `resource` observer 的回呼（全站仍然只有 2 顆）。
- 每發 fetch 只多配置一個四欄小物件，環形上限 16 筆。
- 對齊是對 ≤16 筆的線性掃描，沒有 DOM 存取、沒有字串配置（用 `slice` 比字尾）。
- 拿不到一律填 `null`，整段包 `try/catch`，**絕不 throw**。

## 順帶修掉一個假零：`svelteWarn` 的計數器

v6.171 用 `window.__ptcgSvelteWarnHook` 防止 hook 重複安裝，
但計數器 `_svelteWarnCounts` / `_svelteWarnFirst` / `_lastPointerAt` 是**元件實例變數**。
`/game` 重新掛載後，被包裝過的 `console.warn` 仍然閉包在**舊實例**的容器上，
新實例讀到的永遠是初值 ⇒ 回報的 `svelteWarn.counts` 恆為 `{}`、`first` 恆為空、`+NNNms` 恆為 `-1`。
**假說成立**（原始碼 `+page.svelte` v6.178 的 5440–5464 行逐行可驗）。
⇒ 計數器搬到 `window.__ptcgSvelteWarn`，與 hook 同一個生命週期。

## Fable 5 審查抓到的三件事（都已修，且都自行查證過）

1. **⭐⭐⭐`/spectate/state` 會無上限污染 `seg.bad`。**
   entry 端的過濾是 **substring**（`e.name.indexOf('/state') < 0`），開窗端是 **prefix**
   （`path.indexOf('/state') === 0`）⇒ 觀戰輪詢（2 秒一發）每一發都必然對不上、全部記進 `bad`；
   而 `tLeaveSpectate` 又不清計數器。後果：先觀戰十分鐘再打自己那場的玩家，
   第一份診斷就揹著幾百的 `bad`，admin 會照我們**自己寫的規則**顯示「不可採信」——
   假警報，正好打死這一版要的數字。
   ⇒ entry 端排除 `/spectate/`，而且歸零收斂成單一的 `_tResetResSeg()`，
   `tLeaveMatch` 與 `tLeaveSpectate` **共用同一份**（各寫一套必然漂移）。
2. **逾時／abort 被算進 `bad`。** 較新的瀏覽器會給失敗 fetch 一筆 `requestStart > 0` 但
   `responseStart === 0` 的 entry ⇒ 網路最爛的那群玩家（**正是我們在查的人**）`bad` 天然偏高。
   ⇒ 分流成獨立的 `seg.abort`。
3. **`startTime → workerStart` 沒有任何一欄承接** ⇒ 四欄加起來對不上 `net`，站長一對帳就會困惑。
   ⇒ 補 `seg.pre`。現在**逐筆** `pre + sw + queue + wire + lag = net` 恰好成立（守衛有釘）。

順帶（也照做了）：`e.name.slice(...)` 改成 `endsWith`（不配置字串）；
`lag` 的微小負值 clamp 成 0 而不是丟掉（丟掉會讓分布系統性偏高），
明顯負值（< -2ms）記進 `seg.lagNeg` 讓算式／時鐘的問題**看得見**；
`seg.lag` 補上 admin 表格（只放在原始 JSON 裡等於沒量）。

已知但**本版不修**（記錄下來）：
- `svelteWarn.counts` 現在是**分頁生命週期**（跨場累積、`first` 永遠是本分頁最早三則）。
  在「原本完全看不到」的基準上這已經是淨改善；要分場歸因需要 per-match snapshot diff，那是行為改動。
- `tApi` 的 `/state?room=${tActiveRoom}` 沒有 `encodeURIComponent`。現行 room id 是 ASCII 安全的；
  哪天 room id 含需編碼字元，字尾比對會 100% 對不上（會表現為 `seg.bad` 全紅，不是靜默）。
- v6.170 的 `res.n` / `freshPct` 是頁面級、且從不歸零（既有行為，本版不動）。

## admin 顯示

📡 監控分頁的往返表新增 **排隊／傳輸／SW／續行** 四欄（共 13 欄，`min-width` 放寬到 1360px）。
判讀規則寫在表格上方：
- **排隊**大 ⇒ 卡在請求送出去之前（DNS／TCP／TLS／連線排隊），搭「連線」欄的重建 % 一起看；
- **傳輸**大 ⇒ 卡在真正的往返（Cloudflare／隧道／VM）；
- **SW** 單獨一欄且**不含在排隊裡**，顯示「未經 SW」代表那些請求根本沒進 Service Worker；
- **續行**大 ⇒ **不是網路**，是那台裝置的主執行緒忙到沒空處理回應，再修伺服器都沒有效果；
- 「排隊」旁的橘色 **⚠N** ＝ 對不上的筆數（**已丟棄**）⇒ 這一列不可採信，**不是**「很順」。

舊 client 的 payload 沒有這些欄位 ⇒ 一律「—」，不空白也不爆版（守衛把 `monPerfCells`
抽出來**實跑**四種半殘 payload，斷言 13 格、無 `undefined`／`NaN`）。

## 首頁 changelog

**不放**（純量測，玩家零可見變化）。

---

# v6.178 休閒對戰終於有 gzip（v0.72 加、v0.75 修載入、順序錯了整整 100 版）

## 真因：`app.use(compression())` 的**位置**，不是它有沒有被載入

`oracle_admin_update.sh` 把整份 `oracle-admin/server_admin_patch.js` 插進 `/opt/ptcg/api/server.js`
的 **`app.listen()` 之前**（server.js 裡那行註解寫得很清楚：
`// Inserted before app.listen() by oracle_admin_install.sh (or _update.sh)`）。

而休閒對戰的路由是在 `start()` 開頭就註冊完的：

| server.js 行號 | 路由 |
|---|---|
| 68 | `GET /api/rooms` |
| 76 | `GET /api/rooms/:code` |
| 88 | `PUT /api/rooms/:code` |
| 126 | `DELETE /api/rooms/:code` |
| 135 / 147 | `GET/POST /api/rooms/:code/messages` |
| 167 / 214 | `GET /api/rooms/:code/stream`、`/messages/stream`（SSE） |

patch 從第 263 行才開始，gzip 的 `app.use` 又在 patch 內部很後面。
Express 是依 **註冊順序** 逐層走 `app._router.stack` 的 layer：`/api/rooms/*` 的 handler 在更前面
就 `res.json()` 把回應結束掉了，掛在 stack 尾端的 compression **永遠輪不到**。

- v0.72 的註解甚至把這件事寫成優點（「本 app.use 只套用其後註冊的錦標賽路由，雙保險」），
  所以沒有人回頭去看它其實同時也代表「休閒對戰永遠不會被壓縮」。
- v0.75 修的是**另一件事**（patch 包在 `import().then(async)` 裡＝ESM host 沒有 `require`，
  `require('compression')` 拋錯被 try/catch 吞掉）。修完之後錦標賽有 gzip 了，
  於是「gzip 已經修好」變成一個錯誤的共識。

實測（有 SSH 權限的另一支 AI 量的，已用程式碼交叉驗證）：

| 端點 | 每次請求大小 | 有沒有 gzip |
|---|---|---|
| `/api/rooms/:CODE` | 26.9 KB | ✗ |
| `/api/rooms?…` | 11.8 KB | ✗ |
| `/api/tournament/state` | 1.9 KB | ✓ |

休閒對戰佔全站 **94%** 流量（88MB / 3min），錦標賽只有 3.3MB。

## 修法：`app.use` 之後把 layer 搬到「第一個 route layer 之前」

```js
app.use(_gzipMw);
const _selfIdx = _stack.map((l) => (l && l.handle)).lastIndexOf(_gzipMw);
const _firstRouteIdx = _stack.findIndex((l) => !!(l && l.route));
if (_selfIdx > 0 && _firstRouteIdx >= 0 && _firstRouteIdx < _selfIdx) {
  const _layer = _stack.splice(_selfIdx, 1)[0];
  _stack.splice(_firstRouteIdx, 0, _layer);
}
```

⚠ **為什麼不是 index 0**：stack 最前面是 Express 自己的 `query` / `expressInit`，接著才是
`cors` / `express.json`。`expressInit` 才會把 express 的 request 原型裝上去（`req.path` 就是那時候才有的）。
插在「第一個 `app.get`/`app.post` 之前」同時滿足「在所有路由之前」與「在內建 middleware 之後」。
⇒ 因此 filter 內一律用 `req.originalUrl` / `req.url`（原生 http 就有），**不准用 `req.path`**。

⚠ Express 4 的 `app.router` 是**會 throw 的 deprecated getter**，所以取 stack 一定要
`app._router` 先試、且兩個各自包 try/catch（Express 5 才是 `app.router`）。

⚠ 搬不動（拿不到 stack／找不到任何 route layer）就原樣留在尾端並 `console.warn`，
退化成 v0.75 行為，絕不因此讓服務起不來。

## SSE 排除：兩道，不是一道

`/api/rooms/:code/stream` 與 `/api/rooms/:code/messages/stream` 是 SSE，gzip 會緩衝、會把即時串流打死。

1. `Content-Type` 含 `text/event-stream` → 不壓（原本就有）。
2. **新增**：路徑（去掉 query）以 `/stream` 結尾 → 不壓。

第 2 道是必要的：compression 的 filter 是靠 `on-headers` 在**寫 header 時**才跑，
不能賭「那個時間點 Content-Type 一定已經設好」。這兩支 SSE 用的是
`res.set({...}); res.flushHeaders();`，順序上沒問題，但不該把正確性押在別人的寫法上。

（順帶一提：休閒對戰實際上走的是 `subscribeRoom` 的**輪詢**，不是 SSE；
`src/lib/game/oracle-client.ts:207` 的註解就寫「每 intervalMs 拉一次 GET /api/rooms/:code」。
這兩支 SSE 端點目前沒有前端在用，但仍然照樣排除。）

## CPU 成本評估

- 27KB 的 JSON 用 zlib level 6（預設）壓一次約 0.5～1ms。117 req/s ⇒ 約 0.06～0.12 個核心。
- **關鍵**：Node 的 zlib **stream** 跑在 libuv threadpool，不是 event loop
  ⇒ 目前 event loop lag 0.16ms 不會被這件事拖住。
- API CPU 目前約 20%，有餘裕。`threshold: 1024` 讓 204 / `{ok:true}` / v0.68 的 `unchanged`
  精簡回應完全不進壓縮器。

## ⚠ 這一項對「TTFB 1.2 秒」的誠實估計

玩家端 v6.159 的拆段計時：**下載（body）中位數只有 22ms，`net`（送出→第一個位元組）中位數 1.2 秒**。
⇒ **payload 體積不是主因**（是的話慢的會是下載段）。gzip 對 TTFB 幾乎沒有直接幫助。

### ⚠⚠ 而且受益者**不是玩家**（實測，v6.178 才發現）

`/api/*` 是掛在 `www.ptcg-tw-sim.com` 底下、走 Cloudflare 進來的：

```
curl -s -o /dev/null -D- -H 'Accept-Encoding: gzip, br' https://www.ptcg-tw-sim.com/api/health
  HTTP/2 200 · server: cloudflare · cf-cache-status: DYNAMIC · content-encoding: br
```

（`/api/health` 的 body 只有 79 bytes，origin 的 threshold 1024 根本不會壓它，
所以那個 `br` 一定是 Cloudflare 自己加的。）

⇒ **Cloudflare 本來就會替所有 `/api/*` 回應壓縮再送給瀏覽器。**
那位 AI 量到的「26.9KB/req 沒有 gzip」是 **origin → Cloudflare** 這一段，不是玩家那一段。

所以這一版真正省下來的是：
- **cloudflared 隧道的頻寬**（117 req/s × 27KB ≈ 3MB/s → 降到 ~0.4MB/s）。
  隧道壅塞正好是 TTFB 1.2 秒的嫌疑之一，所以這一項有機會間接幫上忙，但**沒有證據**。
- VM 對外流量（88MB/3min 的大部分）。

⇒ **玩家端量不到差別**。因此 **v6.178 沒有寫首頁更新記錄** ——
首頁是給玩家的公告，寫「更省流量、同步更順」會是假的。
（另外確認過不會有 br 被降級成 gzip 的副作用：錦標賽端點 origin 早就 gzip 了，
Cloudflare 回給瀏覽器的仍然是 `br`，代表 CF 會自己重壓。）

## 沒有做：nginx upstream keepalive（設定檔不在 repo）

`git ls-files` 在整個 repo 裡找不到任何 nginx 設定檔。已改為產出
**`docs/nginx-keepalive-runbook.md`**（站長逐步操作單，含備份／`nginx -t`／reload／驗證／還原）。
`keepalive 64` 的依據、以及為什麼 `proxy_set_header Connection "";` 少了就完全不會生效，都寫在那份裡。

⚠⚠ **`keepalive_timeout` 必須設 3s，不能設 60s（Fable 抓到、已查證）**：
Node 的 `http.Server` 預設 `keepAliveTimeout = 5000ms`。upstream 的閒置逾時只要大於它，
就會出現「Node 先關掉連線、nginx 還沒收到 FIN 就把下一個請求寫進去」的競態
⇒ `upstream prematurely closed connection`。GET 會被 nginx 自動改送到新連線，
但 **PUT/POST 預設不重試（nginx 1.9.13 起）** —— 而 `PUT /api/rooms/:code`（存盤面）
正是休閒對戰最熱的寫入路徑 ⇒ 玩家會吃到原本不存在的 502。
設 3s（< Node 的 5s）讓 nginx 永遠先放手，競態就不存在；117 req/s 下連線幾乎不會閒置到 3 秒。

⚠ `keepalive_timeout` / `keepalive_requests` 寫在 `upstream` 區塊內需要 **nginx ≥ 1.15.3**，
操作單裡加了 `nginx -v` 這一步（真的太舊的話 `nginx -t` 會擋下來，不會弄壞網站）。

⚠ `proxy_pass http://ptcg_api;` 會讓送往 Node 的 `Host` 從 `127.0.0.1:3000` 變成 `ptcg_api`。
已逐檔 grep 確認 `server.js` 與 `server_admin_patch.js` **沒有任何一行**讀
`req.headers.host` / `req.hostname`，CORS 也是 `cors()` 萬用設定 ⇒ 無影響。

⚠ **誠實估計**：nginx→Node 是本機迴環，省下的交握成本大約 0.05～1ms，
對「TTFB 中位數 1.2 秒」**幾乎沒有直接幫助**。它的價值是把 ephemeral port
（現在 TIME-WAIT 佔 20.8%）從耗盡邊緣拉回來 —— 真的耗盡時是 SYN 重傳 1 秒起跳。
這是預防針，不是止痛藥。

## 沒有做（且**不建議**做）：`gameState.log` 儲存端截斷

v0.71 只截**回應**（`_trimLogForWire`，`TOURN_LOG_CAP = 60`），儲存仍是完整的。
評估結論：**現在不能截**，因為回放同時依賴這兩份：

1. `TMATCH.finalLog` 是在 `onMatchGameOver` 直接寫 `finalLog: gs.log`
   ⇒ 儲存端一截，快照下來的 finalLog 就已經是殘的。
2. **投降／時限／閒置判負／pending-admin 的場根本不會走 `onMatchGameOver`**，
   `/api/tournament/replay` 與 `/admin/match-log`、`/match-log` 三處都是 fallback 去讀
   `TROOMS('mr_<matchId>').gameState.log`（patch 6239 / 6269 / 6297 行）⇒ 直接缺行。
3. 更致命的是 `tournamentReplayTurns` 每格快照存的 **`logLen` 是 finalLog 的索引**
   （v0.82，前端靠它切片讓對戰 log 跟著回放進度走）。儲存端截斷會讓所有既有快照的 logLen
   全部指到錯的位置 ⇒ 不是缺行，是**錯行**。
4. v6.119 的守衛已經為了同一件事釘死過一次（「閒置判負的完整讀取不得加 projection，
   殘缺盤面寫回去會永久洗掉 log」）。

要做的話唯一安全的切法是**只截休閒房（`rooms` collection）的 `gameState.log`**——
休閒對戰沒有回放功能，`matchRecords` 也不存 log。錦標賽房（`TROOMS`）一行都不能動。
**這一版沒有做任何截斷，交給站長裁定下一輪要不要只做休閒那半邊。**

## 守衛

`scripts/test-v6178-rooms-gzip-hoist.mjs`（17 條，HEAD v6.177 上 **FAIL 8**）。
⚠ 它**不是**去 grep「有沒有寫 `app.use(compression)`」——那是 v0.75 就有的、而且沒生效。
它用哨兵註解把 patch 裡那一段 gzip 區塊**原封抽出來**，`new Function` 實跑在一個
模擬真實註冊順序的 Express router stack 上，然後斷言「compression 的 layer index
真的小於每一條 `/api/rooms` 路由的 index」。抽不到哨兵時會退回舊版形狀的抽法，
所以 HEAD 版也跑得起來、失敗在「順序」而不是「找不到」。另含正對照
（只 `app.use` 不搬的樣本必須被判為不合格）。

## Fable 審查（站長硬性要求）與逐項查證

| Fable 提的 | 我怎麼查證 | 結論 |
|---|---|---|
| ⚠ Node `keepAliveTimeout` 5s vs upstream `keepalive_timeout` 60s ⇒ 偶發 502，且 PUT 不重試 | Node 官方預設值確為 5000ms；`PUT /api/rooms/:code` 確實是休閒最熱寫入路徑（`server js.txt` 第 88 行） | **採納**，操作單改成 `keepalive_timeout 3s` 並寫明理由，守衛釘住 |
| ⚠ upstream 內的 `keepalive_timeout`/`keepalive_requests` 需 nginx ≥ 1.15.3 | 對照 nginx 文件的 "This directive appeared in version 1.15.3" | **採納**，加 `nginx -v` 步驟 |
| ⚠ `proxy_pass` 改指 upstream 會改變 `Host` | `grep -n "headers.host\|req.hostname"` 掃 `server js.txt` 與 patch，**零命中** | 無影響，寫進操作單備註 |
| ⚠ 長輪詢若中途 `res.write` 心跳，hoist 後會被 gzip 緩衝住 | `grep "res\.write("` 掃整份 patch → **零命中**（只有註解提到 event-stream）；`/state?wait=1` 是掛起後單次 `res.json()` | 不成立，但確實是對的疑慮方向 |
| 建議改用 nginx `gzip on` 取代 hoist | 成立且更標準，但那要再改一次 VM 設定；本版的 hoist 已有 17 條行為守衛且能用 `update-tournament.bat` 部署 | **不改**，寫進操作單附錄當備案 |
| 建議改安裝腳本的插入錨點 | `oracle_admin_install.sh` 在 VM 上、不在 repo 裡 ⇒ 這輪動不到 | 記錄，不做 |
| gzip 對 1.2 秒 TTFB「幾乎沒有幫助」 | 與我方 v6.159 拆段量測一致（下載段中位數 22ms）；再加上 Cloudflare 已經在壓（實測見上） | **完全同意**，因此不寫首頁 |
| 真兇建議先量 Resource Timing 的 `fetchStart→requestStart` vs `requestStart→responseStart`、鏈路二分、cloudflared metrics | 未做（超出本輪範圍） | **列為下一輪待辦** |

Fable 說的「compression 內建會跳過 HEAD、跳過已有 Content-Encoding 的回應、
ETag 是壓縮前算的所以 304 照常」這幾點我沒有逐行去讀 compression 原始碼，
但它們都不是本版改動引入的（v0.72 起錦標賽就一直這樣跑），所以不擋這一版。

## 下一輪待辦（站長裁定）

1. **TTFB 1.2 秒的真兇**：先用 Resource Timing 把 `net` 拆成
   `fetchStart→requestStart`（排隊 + Service Worker）與 `requestStart→responseStart`（真 TTFB）。
   ⚠ Service Worker 有前科（v6.146~149「SW 沒排除 `/api/`」），先開 DevTools
   「Bypass for network」對照跑一次。
2. 鏈路二分：VM 上分別 `curl -w '%{time_starttransfer}'` 打 `127.0.0.1:3000` / 經 nginx / 站外探針打
   `www.ptcg-tw-sim.com`，看 1.2 秒掉在哪一段。
3. cloudflared metrics（隧道 RTT、in-flight 併發、重連紀錄）。
4. `gameState.log` 截斷：**只截休閒房**那半邊（見上）。

---

# v6.177 「抓取中／抓取失敗不清空已顯示資料」中央收斂（stale-while-revalidate）

## 真因（玩家回報：賽程／排名整區消失、好幾秒才回來）

`src/routes/game/+page.svelte` 的 `tBracketLoad()`（HEAD 版第 4776~4785 行）是**清空型**：

```ts
const rs = await Promise.all(evs.map(ev => tApi('/bracket?eventId='+ev._id).catch(() => null)));
tBrackets = rs.filter(r => r && Array.isArray(r.matches) && r.event);   // ← 失敗那筆被 filter 掉
```

- 任一支 `/bracket` 逾時／500（`.catch(() => null)`）⇒ 那場賽程從陣列消失。
- 伺服器在查不到賽事時回 `{event:null, matches:[]}`（`server_admin_patch.js` `/api/tournament/bracket`）
  ⇒ 同樣被 filter 掉。
- 畫面是 `{#each tBrackets as brk (brk.event._id)}`，而且**完全沒有空狀態**
  ⇒ 陣列一空就整區憑空消失（連「載入中」都沒有）。
- 另有 `if (!evs || evs.length === 0) { tBrackets = []; return; }`，而
  `tEvents = Array.isArray(r.events) ? r.events : []` 讓一發壞回應就能把整個大廳清空。

**行為端重現**（把 `tBracketLoad` 切出來 esbuild 剝型別後實跑，見守衛 2b~2f）：
兩支都失敗 ⇒ `tBrackets.length` 由 2 變 0；只有一場失敗 ⇒ 該場消失；`{event:null}` ⇒ 同樣消失。

## v6.161 有沒有讓空白期變長：**有**

把大廳輪詢的 `setInterval` 回呼實跑 40 個 base tick 數請求（守衛外的驗證腳本）：

| 情境 | `/bracket` 實際間隔 |
|---|---|
| 本輪有對戰（`tMyMatch`） | 9 秒（與 v5.637 相同，沒變差） |
| 出局／輪空／本輪已打完 | **27 秒**（v6.161 前是 9 秒） |
| 背景分頁 | **63 秒** |

`_brMs = tPollDesiredMs(false,'lobby') * 3`。所以「清空後要等下一次輪詢」的空白期被放大 3~7 倍。
回報者說的「好幾秒」對得上 9 秒；本輪已打完的人會到 27 秒。

## 修法：中央模組 `src/lib/ui/stale-keep.ts`

- `adoptOrKeep(prev, next)`：`next` 為 `null`/`undefined`（＝這一發不可信）⇒ 沿用 `prev` 並回 `stale:true`；
  `next` 是空陣列（＝伺服器權威地說沒有）⇒ 採納空的。
  ⚠ 約定：呼叫端必須把「不可信」統一表達成 `null`，**不可以**自己塞空陣列進來
  ——「權威的空」與「抓不到」分不出來，正是這一類 bug 的共同根。
- `mergeKeyedOrKeep(prev, keyOf, incoming)`：`incoming` 是 `{key, value}[]`，`value` 為 `null` 代表那筆失敗
  ⇒ 沿用 `prev` 裡同 key 的舊資料；**`prev` 有但 `incoming` 沒提到的 key 一律移除**
  （賽事真的結束就要消失，否則「保留舊資料」會變成「永遠留著一場不存在的賽事」）。

### 接上的 7 個呼叫點（同型掃描結果）

| 檔案 | 位置 | HEAD 的清空寫法 |
|---|---|---|
| `+page.svelte` | `tBracketLoad` | `tBrackets = rs.filter(...)` |
| `+page.svelte` | `tournLoadEvent` | `tEvents = Array.isArray(r.events) ? r.events : []` |
| `+page.svelte` | `tLeaderboardLoad` | `catch { tLeaderboard = null }` |
| `+page.svelte` | `tProfileLoad` | `catch { tProfile = null }` |
| `+page.svelte` | `tChampionsLoad` | `? r.champions : []` |
| `+page.svelte` | `tSpectateLoad` | `? r.matches : []`（自 v0.79 起未被呼叫，一併收斂） |
| `room-oracle.ts` | `subscribeOpenRooms` | `oracleListRooms(k).catch(() => [])` |

⚠ **`subscribeOpenRooms` 那條可能就是「線上休閒大廳偶發打不開」的一部分**：
失敗被偽裝成空清單後，大廳顯示的是「目前沒有公開房間」——一個**假的空狀態**，
玩家完全看不出是連線問題，而且每 2 秒重跑一次。改成逐 kind 保留上一份好資料
（不是整發放棄——若 `playing` 那一支長期壞掉，整發放棄會讓大廳完全凍結）。

## 保留舊資料不可以變成誤導

- **輪次號碼一律用權威值**：新增 `liveRoundOf(brk)`，優先讀 `tEvents`（`/event` 每 3 秒更新、
  且 v6.177 起只會被成功回應改寫）裡同 `_id` 的 `currentRound`；`pageOf` / `setBracketPage` /
  標題「第 X/Y 輪」/ pager 的「進行中」標記全部改用它。少了這條，`/bracket` 連續失敗時
  畫面會停在舊輪、還把舊輪標成「進行中」。
- **進場鈕不受影響**：`myMatchBox` 讀的是 `tMyMatch`（`/event`，伺服器權威），
  而且 template 第 8519 行本來就有「`tMyMatch` 對不到已載入 bracket 就頂層獨立渲染」的保底。
  ⇒ 保留舊賽程不會害人錯過進場而被判未進場。
- **輕量提示**：標題列 inline `<span class="tourn-stale">· 更新中</span>`，
  CSS 只有 `font-size/color/margin-left/white-space`，**無 `display:block`、無 `height`** ⇒ 不造成版面跳動。
- **空狀態**：`tBrackets` 真的空而又有進行中賽事時顯示「賽程載入中…」（曾成功過則顯示「賽程更新中…」）。

## 立即拉回輪詢頻率（沿用 v6.161 的 `tLobbyResume()`，不另寫一份）

`stale` 時呼叫 `tLobbyResume()` 把三個節奏錨點歸零 ⇒ 下一個 base tick（≤3 秒）就重抓。

⚠⚠ 上限是「**每一段連續失敗期最多拉一次**」（`_tBracketFailStreak`），不是「每 N 秒拉一次」：
40 人賽事 `/bracket` 正在噴 500 時，「越失敗→越加速→越失敗」是正回饋，會把掙扎中的端點推倒
（Fable 5 審查點名，已採納）。背景分頁（`_tTabHidden`）不加速——那正是 v6.161 要省的人口。

## 其他閃爍路徑（Fable 5 指出，已查證屬實並修）

1. `{#each brk.standings as s (s.name + '_' + s.rank)}` —— **key 含每輪都會變的 `rank`**，
   結算洗牌時所有 key 全變 ⇒ 整張排名表被拆掉重建。改用 `standingsKeyed()` 產生
   以玩家名為身分、同名加出現序後綴的 `_k`（重複 key 會讓 Svelte 直接拋 `each_key_duplicate`）。
2. `{#each _roundMatches as m}` 沒有 key ⇒ 補 `(m.round + '_' + m.idx)`。
3. `tBracketLoad` 沒有代次守衛：`tLobbyResume` 會讓下一發提早送出，慢的那一發後到時，
   **合併版**會把舊回應當成權威新資料收編（比舊的 filter 版更難察覺）⇒ 補 `_tBracketSeq`
   （比照 v6.139 deck-posts 的 `listSeq`）。
4. Fable 擔心的「`mergeKeyedOrKeep` 每次產生新物件參考造成整區重畫」**不成立**：
   Svelte 5 的 keyed each 依 key 保留 block，只重算 `{@const}` 與細粒度 diff。

## Fable 5 提出但**未採納**的一點

「`tSwitchTab` 的 `!tLeaderboard` / `!tProfile` 會讓收斂後變成永不刷新的快取」——
查證後只有一半成立：載入失敗時 `tLeaderboard` 本來就還是 `null`（從沒被寫過），
所以重試路徑沒壞。但條件仍改成 `(!tLeaderboard || tLeaderboardStale)` 讓「成功過之後失敗」
的情況也能重試，且不增加常態負載。

## 守衛

`scripts/test-v6177-keep-last-good.mjs`（已進 `npm test`）：**PASS 43 / FAIL 0**，
把 HEAD 版的 `+page.svelte` 與 `room-oracle.ts` 換回去 ⇒ **FAIL 28**。
斷言全部走行為端（把 `tBracketLoad` / `subscribeOpenRooms` / `stale-keep` / `liveRoundOf` /
`standingsKeyed` 切出來 esbuild 剝型別後真的跑起來求值），否定型斷言一律先剝註解，
且剝註解器本身有 3 條自我驗證。

## 尚未處理／待站長裁定

- `tRunningEvents` 包含 `finished` 的賽事 ⇒ 已結束賽事的 `/bracket` 仍會被輪詢。
  這是 v5.620 以來的既有行為（賽後還要看賽程表），但 stale-keep 讓它更「黏」。
  若要改，得先確認伺服器 `/event` 何時把 `finished` 賽事移出清單。
- 保留舊資料時 `VS👁` 觀戰鈕可能指向已結束的房；`tSpectate`（4967 行）已有快速失敗回大廳的防呆，
  只是 UX 噪音，本版不動。

# v6.176 跨 zone 同 iid 去重 + 場上目標型 picker 的中央消毒閘兜底

## ① 跨 zone 幻影卡：v6.175 只做了「同區」，一半的案例逃掉

`normalizeNonFieldStacks` 的 `seen` 是 **per-zone** 的，所以它只抓得到
「扁平與巢狀同時落在**同一個** zone」的重複。

行為端 3 行即可重現（`scripts/test-v6176-…` A 段）：
獵斑魚｜潛者捕捉在確認選單選「是」時，把暫存的基本【水】能量**副本**加進**手牌**，
而 KO 實例（連同身上巢狀的那一份）留在**棄牌區**
⇒ 同一個 iid：`hand` 一份 + `discard/<KO 實例>.energy` 一份。
（選「否」時兩份都落在棄牌區，才會被 v6.175 蓋到 —— 所以 v6.175 只修掉一半。）

**修法**：`normalizeNonFieldStacks` 改成三個 pass（單一出口仍是 `applyAction`）：
- pass A：四個非場區各自攤平 `evolvedFromStack` + **同區**頂層去重，
  再**跨區**收集所有頂層（扁平）iid。
  ⚠ 頂層去重刻意維持「同區」語意 —— 跨區兩張扁平同 iid 該留哪一份無從判斷，亂刪 = 掉卡。
- pass B：收集 `active` + `bench` 的頂層與巢狀 iid（場上是**合法**的巢狀位置）。
- pass C：非場區卡的巢狀附加物，iid 只要在 pass A/B 已經有一份，就把**巢狀那一份**剝掉。

⚠⚠ **不可以**把「只有巢狀、別處都沒有」的攤平出來 —— 那是潛者捕捉**刻意**的暫存
（KO 實例上的基本【水】能量在玩家確認前既不進棄牌也不進手牌）。
守衛 A 段第 2 條就是釘這件事：確認未決時去重必須**什麼都不做**。
（也因此 Fable 建議的「KO 生成源直接 toBareCard」不可行 —— 站長上一輪已實測 `test-sakura-relicanth` 會紅。）

## ② 場上目標型 picker：80 個 occurrence 完全不經中央閘

`sanitizeSelectedIids` 對非 `deck-search` 型是「**有** `params.validIids` 才濾」。
站內 `heal-target` / `bench-choose` / `opp-bench-choose` / `opp-poke-choose` 這四型，
minCount≥1 卻沒宣告 `validIids` 的有 **110 個 occurrence（80 個不同 effectKey）**
⇒ client 送任何 iid 都原封進 resolver，v6.175 的 pending 蓋章對**舊版 client** 是 fail-open。

**修法（中央單點）**：沒宣告 `validIids` 時，用 UI 產候選的**同一份述詞**即時算出「該側場上」當白名單。
- 述詞下沉 `selection-candidates.ts` 的 `fieldPickerBaseCandidates` / `fieldPickerBaseIids`；
  `+page.svelte` 的四個 case 與 `engine.sanitizeSelectedIids` 都 import 它
  ⇒ 結構上不可能再發生 v6.109「看得到卻勾不動」。
- **即時算、不寫進 params**：不會有快照過期把玩家鎖住的問題，線上 payload 也沒變大。
- ⚠ 這是**兜底不是卡面**：卡面比「該側場上」窄的仍必須逐張宣告 `validIids`。

### ⚠ v6.175 的枚舉守衛掃描器有盲點（Rule 25 再一次）
舊掃描器「effectKey 往前 1500 字元找第一個 `type:` + `blk.includes('validIids')`」
會抓到**鄰居物件**的欄位（假陽性 + 假陰性），而且 dedupe by key
⇒ 同一個 key 有 10 個 producer 時只看得到 1 個。
新掃描器：先 mask 掉註解／字串／模板，再從 `effectKey` 錨點**往回**括號配對取出**該物件**，
逐 occurrence 統計，並附「鄰居污染」正對照。數字因此從 56 變成 110（誠實的數字）。

## ③ 這一輪逐張補的兩張（都是卡面帶條件、原本 UI 列出超出卡面的目標）

| 卡 | 卡面（static/cards） | 原本 | 修後 |
|---|---|---|---|
| 冰伊布ex｜藍柱石 | 「選擇1隻對手的**身上放置有6個傷害指示物的**寶可夢，將其【昏厥】」 | pending 只帶 `exactCounters: 6`，UI 列出對手全部寶可夢；勾錯 → resolver `return st` 靜默把招式吃掉 | `validIids` = gate 用的同一份 candidates |
| 振翼髮｜蠱惑挪移 | 「選擇1隻自己的**備戰區的『古代』寶可夢**，將…傷害指示物全部改放於對手的戰鬥寶可夢身上」 | 沒有 validIids，**resolver 也沒有檢查古代** ⇒ 可以搬非古代備戰的指示物（違反卡面） | `validIids` = `ancientWithDmg`（與 gate 同一份） |

⚠ 同檔上方的「吼叫尾｜唱歌鼓勵」v5.929 就已經傳了 validIids —— 蠱惑挪移是同一批裡漏網的那張。

⚠ **待站長裁定**：蠱惑挪移的 `validIids` 目前用 `ancientWithDmg`（古代**且**有指示物），
與 gate「沒有這種備戰就不觸發」同一份。卡面只說「古代」，沒說「有指示物」。
選一隻沒有指示物的古代在規則上合法但效果為 0。要不要放寬成「全部古代備戰」請裁示。

## 剩下的（棘輪列管，未逐張補）
108 個 occurrence 仍未宣告 `validIids`，全部由 ② 的中央兜底保護（不再裸奔），
但「卡面比該側場上窄」的還沒逐張查完。守衛 F 段釘住上限 110 與「已補的三張不准退回」
（`lanzhushi-ko` / `h-wave3-move-bench-dmg-to-opp-active` / `greninja-shuriken-6`）。

# v6.175 選擇必須綁定它回答的那個 picker（沸騰鬥志「附給 ?」真因）+ 非場區巢狀附加物收斂

## ① 真因（站長的質疑是對的：候選從來沒有空過）
玩家回報 v6.173 錦標賽「薪水小偷 R2」火焰雞ex｜沸騰鬥志出現
`沸騰鬥志：將 基本【超】能量 附給 ?` 之後對局卡住。
v6.174 把它修成「安全 no-op」，但那是治標。

從 `tournament-dumps/dump_20260812_102715.json`（match `evt_mspfw1mturzw_r2_m0`，
2026-08-12 10:22 TW）逐行還原：
- log 121~123：進化出 94iqs0uq 火焰雞ex、放備戰 48h5nkce、撤退換 ravmbo09 上場
  ⇒ 事發當下自己場上有 **1 戰鬥位 + 5 備戰**；引擎的 `params.validIids` 也確實是 6 個。
  **候選從來沒有空過，「沒有目標」這個前提本身不成立。**
- log 125 →（3.7 秒）→ 126「（繼續選擇下一步）」→（31.2 秒）→ 127「附給 ?」。
- finalState 牌張守恆 61 vs 60、且 `pp5i8egq` 同一個 iid 在棄牌區出現兩份。

真因是 **`RESOLVE_SELECTION` 完全沒有「這個選擇是在回答哪一個 picker」的資訊**：
engine 收到就套到「當下那一個」pending。多段 picker（第 1 段選能量 → 第 2 段選目標）
兩段的 payload 形狀一模一樣（都是 iid 陣列）⇒ 第 1 段的答案只要遲到 / 被重按 / 排隊後才送達，
就會被當成第 2 段的答案吃下去，engine 拿「能量的 iid」去場上找寶可夢 ⇒ 必然找不到。

行為端 byte-exact 重現（v6.173 樹）：
`USE_ABILITY → RESOLVE(['wnoipo9e']) → RESOLVE(['wnoipo9e'])`
⇒ log 一字不差是 `沸騰鬥志：將 基本【超】能量 附給 ?`，牌張 11 vs 12（能量從遊戲中消失）。

為什麼是「現在」才炸：v6.172 把 in-flight 期間的第二個手勢從「靜默丟棄」改成「排隊後送出」，
把這條路徑從偶發變成常見（重按會拿到**自己的 actId**，伺服器的冪等去重擋不住）。
monitor 顯示 `stale-version（對戰中盤面不再更新）` 162 次 / 55 人 —— 玩家看到畫面沒動就再按一次，
正是這一版的常態。

## ② 修法（中央、兩層）
1. `PendingSelection.token`：engine 在 `applyAction` **單一出口** `stampPendingToken` 蓋章。
   規則只有一條——**pendingSelection 只要不是動作前那一個物件，就是新的 picker ⇒ 換新號**。
   client（`_pendingTok()`，現讀現帶）在 `RESOLVE_SELECTION` 回帶 `pendingToken`；
   對不上一律 `return state`（pending 留在原地）。舊 client 不帶 ⇒ fail-open。
2. 保護**所有** client（monitor 顯示大量玩家停在 v6.13x~v6.16x）：
   client 送了東西、卻被 `sanitizeSelectedIids` **整批消毒成空**、而 `minCount>=1`
   ⇒ 這必然是錯位／版本落差／竄改，**不是「玩家選 0」** ⇒ 不執行、不關 pending、寫一行說明。
   ⚠ 有上限 `RESOLVE_REJECT_STREAK_MAX = 3`（本機 AI／舊 client 可能持續送不合法選擇，
   無條件保留會變死結）；超過就退回舊行為，任何情況下都不會軟鎖。

## ③ 同維度 audit：非場上區的「巢狀附加物」= 同一張卡同 iid 兩份
v5.735 只把 `evolvedFromStack` 攤平，**漏了同一種形狀的 `energyAttached` / `toolAttached` /
`extraTools`**。KO 路徑把寶可夢連同身上附加物整包丟進棄牌區、又另外把每張能量攤平成獨立棄牌卡
⇒ 同一個 iid 在同一區出現兩份。行為端 3 行可重現；上述 dump 的 440 個玩家側裡 **239 個**中招。
後果與 v5.735 完全同型（前端 each key、picker 去重、盤面守恆）。
⇒ `normalizeNonFieldStacks` 收斂：非場區一律不留巢狀附加物；已有扁平同 iid 就丟掉巢狀那份，
沒有的才**append 到區尾**補成扁平卡（既有棄牌區順序完全不動）。

## ④ 站長裁定 A：寶可夢道具可以反悔
`attach-tool` 的 resolver 從 v5.465 起就有「空選擇 ⇒ 道具退回手牌」，UI 也備好文案，
但 `minCount=1` 被 `selectionAllowsSkip` 的 `minCount>=1` 短路擋掉 ⇒ 那顆鈕永遠渲染不出來、
那條 0-branch 是死碼（audit skill 線索 ②）。
⇒ 新增中央述詞 `selectionAllowsCancel`（語義是「取消整個動作」，**不是**「選 0 張」，
所以不能混進 `OPTIONAL_SELECTION_EFFECT_KEYS`），`attach-tool` 的 pending 宣告 `params.allowCancel`。
乾淨退回已行為端驗證：道具回手牌、沒附到任何寶可夢、牌張守恆、可再打一次同一張。

## ⑤ 站長裁定 B：必殺手裡劍 —— 卡面順序不動，改成原子化（詳見回報，需站長複裁）
卡面逐字（M4 18442 / M-P-J 18516）：「…**從自己的手牌將1張「基本【水】能量」卡丟棄，
則可使用1次**。在對手的1隻寶可夢身上放置6個傷害指示物。」
⇒ 丟能量是**使用條件（代價）**，卡面順序就是「先付代價 → 才可使用 → 然後放指示物」。
把它改成「先選目標再付代價」會違背卡面，故**未照字面執行站長指示**，改為達成同一目的的原子化：
目標解析不到（空選擇／iid 失效）⇒ 能量退回手牌 + 解除 `abilityUsedThisTurn`，整個動作完全還原。
免疫擋下（光之翼等）**不算解析失敗**：依站長 2026-08-07 裁定，代價照付、效果不發動。
另補上 `params.validIids`（原本沒有 ⇒ 完全不經中央消毒閘）。

## ⑥ 同維度枚舉（既有債，棘輪列管）
場上目標型 pending（heal-target / bench-choose / opp-bench-choose / opp-poke-choose）
`minCount>=1` 卻**沒有宣告 `params.validIids`` 者共 56 個 —— 它們的 client payload 完全不經
中央消毒閘。這一輪只修在 scope 內的必殺手裡劍；其餘以守衛棘輪列管（數量不准再變多，新卡一律宣告）。
⚠ 不做全域「一律限場上」的一刀切：`bench-basic-from-deck` / `reorder-deck-top-apply` 等
確實用 heal-target 型 pending 承載**跨區** iid，一刀切會誤殺。

## ⑦ Fable 5 審查抓到的（已全部修掉，且每一條我都自己回查驗證過）
1. **本機 AI 軟鎖（最嚴重，真的會出事）**：`+page.svelte` 的 v5.617「無進展防呆」signature
   刻意**不含 log.length**（v5.639 的教訓），而本版第 ② 條閘只動 log ⇒ AI 送出不合法選擇時
   sig 完全不變 ⇒ 連兩次無進展就進防呆分支，但該分支的強制 END_TURN 要求 `!pendingSelection`
   ⇒ **直接 return、不 dispatch、不 scheduleAI，AI 從此不再有任何 tick**（我逐 tick 追過，成立）。
   ⇒ 修：pending 還在時先用空選擇把它推掉（＝v6.174 以前的行為），保證一定有進展。
2. token 不符原本是**完全靜默**的 `return state` ⇒ 將來「按了沒反應」查不出來 ⇒ 補一行 log。
3. `_pendingSeq` 會被「整包還原成攻擊前快照」的路徑（重試徽章）**倒退** ⇒ 重號 ⇒
   排隊中的舊答案能對上不同的 picker ⇒ 發號機改 `Math.max(after, before)`，只前進。
4. `_rejectedResolveStreak` 是全域計數、不綁 pending ⇒ 換 picker 時殘值會吃掉保護額度 ⇒
   新增 `_rejectedResolveTok`，token 不同就重新計數。
5. 必殺手裡劍 `_hit` 在 `selectedIids[0] === undefined && def.active === null` 時
   `undefined === undefined` 誤判命中 ⇒ 補 `_tid != null &&`。

### Fable 的兩條建議我**沒有**採納（自行查證後判定不對／不在本輪 scope）
- 「KO 生成源直接 toBareCard」：不行。`engine.ts` 的 koDiscard 是
  `[ko, ...ko.energyAttached.filter(e => !heldIds.has(e.iid)), ...]` ——
  **獵斑魚｜潛者捕捉的暫存水能量就是靠「留在 ko 身上、不進扁平清單」實作的**，
  在生成源裸化會直接打死那張卡（守衛 test-sakura-relicanth 會紅，我實測過）。
  所以本版維持「出口只刪同區重複、不搬卡」。
- 潛者捕捉選「是」時把 `heldEnergy` 加進手牌、而 ko 身上巢狀那份仍在棄牌區 ⇒
  **跨 zone 同 iid 兩份**。這條 Fable 說得對，但屬另一維度（跨區去重），本輪不動，
  留給下一輪（已記在待辦）。

## ⑧ ⚠⚠⚠ 部署提醒（Fable 也點到，且這一條決定本版有沒有效）
錦標賽伺服器跑的是 `scripts/build-server-engine.mjs` 產出的 `oracle-admin/tournament/server-engine.cjs`
（**不在 repo 裡**，由 `update-tournament.bat` 現場重建）。
**沒跑 update-tournament.bat ⇒ token 蓋章／比對、拒收閘、非場區去重在錦標賽端全部不存在（fail-open），
出事現場的原始 bug 原樣存在。** 這正是 v6.157 踩過的坑。

## 守衛
`scripts/test-v6175-pending-token-and-nonfield-stacks.mjs`（52 條，全行為端實跑 applyAction）
—— 對 v6.174 樹 6 條紅 + `selectionAllowsCancel` 直接 TypeError；對 v6.173 樹 10 條紅
（含 byte-exact 的「附給 ?」與牌張 11 vs 12）。
掃描器兩處都有**下限斷言 + 正對照**（違規樣本必須被抓到），避免「掃不到 = 全綠」的安慰劑。

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

## v6.174 — picker「目標解析失敗」不得留下半套盤面（中央收斂）＋ pending 出口補洞

**玩家回報**：錦標賽「薪水小偷 R2：南崁大雞雞 vs 蛋蛋戰隊-起士蛋」最後一回合，使用
火焰雞ex｜沸騰鬥志後 log 出現 `沸騰鬥志：將 基本【超】能量 附給 ?`，然後無法繼續操作。
dump：`tournament-dumps/dump_20260812_102715.json`（match idx 219，logSource=live-room，128 行 log）。

**卡面查證**（`static/cards`，SVM 12086，H 標）：
沸騰鬥志＝「在自己的回合時可使用1次。從自己的棄牌區選擇1張基本能量卡，附於自己的寶可夢身上。」
→ 不限能量屬性（所以「基本【超】能量」配火屬性是**正確**的）、目標不限備戰／戰鬥場。

**真因**（`src/lib/game/effects/cards/six_decks.ts` 舊 `blaziken-boiling-attach`）：
resolver **先**把能量從棄牌區 `filter` 掉、**後**才用 `selectedPokeIids[0]` 找目標；
目標解析失敗時只把 log 的名字寫成 `?` 就 return ⇒ 能量既沒留在棄牌區也沒附到任何寶可夢
= **整張卡從遊戲中永久消失**（牌張不守恆）。行為端已完整重現：
`applyAction USE_ABILITY → RESOLVE_SELECTION(['ENG1']) → RESOLVE_SELECTION([])`
產出的 log 與玩家 dump 逐字相同。

**這是維度不是單卡**。同型（先破壞、後解析、失敗只寫 `?`）在 `six_decks.ts` 一檔就有四張：
沸騰鬥志（棄牌區）／龜足巨鎧｜岩石武裝（手牌）／顫弦蠑螈｜惡棍衝天（牌庫）／N的ＰＰ提升劑（棄牌區）。
換場型（老大的指令 `gust-opp`／頂尖捕捉器 `top-catcher-opp`）是另一個變體：**先 addLog 宣告
已經換好、後 findIndex 靜默不換** ⇒ log 騙玩家。實戰 dump 已出現過
（`dump_20260723_164942.json`：`將對手戰鬥場的 願增猿 換到備戰區，呼叫 ? 到對手戰鬥場`），
且頂尖捕捉器在對手根本沒換的情況下還會繼續開「我方換誰上場」的 picker（半套盤面）。

**中央收斂**：
1. `_shared.ts` 新增 `findFieldInstance()`（場上目標 iid → CardInstance，找不到回 null）。
2. `_shared.ts` 新增 `attachEnergyFromZoneToOwnPokemon()` —— **先解析、全部成功才動盤面**；
   `zone`（discard/hand/deck）是**必填**參數，強迫呼叫端回去讀卡面；
   `opts.allowedTargetIids` 做 resolver 端自驗（v6.009 原則，不信 client 送的 iid）；
   `opts.extraDamage` 給惡棍衝天的「放置2個傷害指示物」。四張卡全部改走它。
3. `_shared.ts` 新增 `promoteOppBenchToActive()` —— 解析失敗＝完全 no-op ＋ 據實 log，
   回傳 `ok` 讓呼叫端決定要不要往下走。`gust-opp` / `top-catcher-opp` 收斂進去。
4. `engine.ts` `sanitizeSelectedIids`：**非 deck-search 型別不再原封放行**，一律再套一層
   `params.validIids` 交集。validIids 是「這個 picker 能勾什麼」的權威（UI 的
   `selectionItemsRaw` 與 `ai.ts` 都只從它產候選），不在其中的 iid 沒有任何合法情境。
   這一刀讓 150+ 個場上目標型 resolver 一次拿到「要嘛有效、要嘛空」的輸入。
   ⚠ 三類排除：damage-distribute / energy-distribute（合法用重複 iid 編碼計數，且 resolver
   內已各有 allowSet）、modal-choice（payload 是選項字串）、reorder-deck-top（來源是
   `params.candidateIids` 且 payload 帶順序語義）。

**「pending 開了卻沒有出口」這一維**：`game/+page.svelte` 的 `pendingStuckEmpty` 是全域安全網
（候選為空且 minCount>0 → 給「放棄（無符合卡）」鈕），但它**明文排除 damage-distribute 與
energy-distribute**。那兩型候選為空時「確認」鈕同樣永遠 disabled、`selectionAllowsSkip` 也
因 minCount>=1 短路而不給【不選】⇒ **一顆能按的按鈕都沒有＝真卡死**。已把判斷下沉成
`selection-ui.ts` 的純函式 `selectionHasNoExit(input, candidateCount)` 並涵蓋那兩型，
`+page.svelte` 改呼叫它（純函式才測得到）。

**守衛**：`scripts/test-v6174-selection-target-resolve.mjs`（47 條，已進 `npm test` 鏈）。
HEAD-FAIL 逐檔證明：six_decks.ts revert → 12 FAIL；supporters_gust.ts → 1 FAIL；
items_misc.ts → 2 FAIL；engine.ts → 1 FAIL；selection-ui.ts → 4 FAIL。
斷言以行為端為主（完整 `USE_ABILITY → RESOLVE_SELECTION` 流程 ＋ **全域牌張守恆計數**，
含附加能量/道具/進化鏈），靜態掃描只用在「四張卡必須走中央 helper」，且附下限斷言與
否定型判準的正對照。

**Fable 5 審查抓到、本版一併修掉的三件事**（結論全部由我自己開檔查證過）：
1. **接線沒接上（他抓得對，最重要）**：`selectionHasNoExit` 述詞雖然對 distribute 回 true，
   但「放棄（無符合卡）」按鈕只渲染在 footer 的 `{:else}` 分支，`{:else if isDmgDist}` /
   `{:else if isEnergyDist}` 兩個分支裡根本沒有那段 —— 修正等於 no-op。已把逃生鈕補進那兩個
   分支，並加一條**模板層接線斷言**（切出 footer 的兩個分支、要求含 `pendingStuckEmpty` +
   `abandonSelection`，附 anchor 長度上下限與正對照）。這就是 v6.154 的教訓：純函式回傳 true
   ≠ 畫面上真的有那顆按鈕。
2. **兩個同型漏網**（我逐行看過確認屬實）：
   `v2630_i_wave13_misc6.ts` 的 `wave13-deck-energy-attach`（厄鬼椪 碧草/火灶/水井面具｜草・火・水之神樂，
   共用 `deckSearchBasicEnergyAttachOnePost`）與 `v2610_i_wave11_misc4.ts` 的
   `v313-stone-kagura-attach`（厄鬼椪 礎石面具｜石之神樂）——都是「無條件 `shuffle(deck.filter(去掉能量))`
   → 再分別判 active/bench」，而且 pending **完全沒有 validIids** ⇒ 連新的中央閘都罩不到。
   兩者都改走中央 helper，並補上 validIids。卡面（I 標）：「從自己的牌庫選擇1張『基本【X】能量』卡，
   附於自己的寶可夢身上。並且重洗牌庫。」→ 目標＝自己場上任一隻；重洗是獨立句，不論成敗都洗。
3. **log 雙冒號**：`promoteOppBenchToActive` 失敗訊息原本自加「：」，而 `top-catcher-opp` 傳進來的
   label 已含冒號 ⇒「頂尖捕捉器：：」。改成 helper 不自加，由呼叫端帶完整前綴，並加守衛斷言。

**Fable 提出但我查證後維持原樣的**：
・`attachEnergyFromZoneToOwnPokemon` 同時 map active 與 bench 的理論 aliasing（同一 iid 同時出現在
  兩處才會附兩份）—— 引擎出口有 `normalizeNonFieldStacks` 與 iid 守恆測試，正常盤面不可達。
・惡棍衝天 `extraDamage` 不做昏厥判定 —— BASE 版即如此（非回歸），且 engine 每個 action 出口有
  雙邊 sanity KO sweep 兜底。
・`active-energy-discard` 的「validIids 為空陣列」語義分歧（`selection-candidates.ts` 當成不限制、
  新 gate 當成全擋）—— 我掃過全部 42 個建立點，設 validIids 的都同時設了 scope/targetIid/fromDiscard
  且必非空，現況不可達；記在這裡供日後統一。
・`greninja-shuriken-6`（水能量代價在開 picker 前就已棄）目標失效時代價付了效果沒發生 —— 屬「代價
  已付」而非「卡片消失」，且要改動代價時點，**列進待站長裁定**，本版不動。

**仍待站長裁定（未動）**：`attach-tool`（打出寶可夢道具後選附加目標）的 `minCount` 是 1，
但它同時在 `OPTIONAL_SELECTION_EFFECT_KEYS` 白名單、UI 也寫了專屬文案「取消（道具退回手牌）」。
`selectionAllowsSkip` 的 `minCount>=1` 短路（官方判準②，SKILL 明列「不能拆」）讓那顆按鈕
**永遠顯示不出來** ⇒ 玩家誤把道具拖到場上就再也收不回。要不要開放取消，屬於規則裁定，未自行更動。

## v6.173 — 錦標賽同步：`tAdopt` 改為「結構共享合併」，不再每 tick 全量重繪

**問題（有數字）**：同情境動作往返 p95 中位數 v6.155 265ms → v6.156 376ms → v6.167 818ms。
19 位跨版本玩家 10 位變差／5 位變好／4 位持平。

**真因**：`tAdopt()` 收到伺服器盤面後直接 `game = state`，而 `state` 是剛 `JSON.parse`
出來的**全新物件**。`game` 是 Svelte 5 的深層 `$state` proxy —— 換掉根物件，等於每一個
子物件都變成新的 proxy ⇒ 模板裡每一個 `{@const b = myPlayer.bench[i]}`、
`{@const bc = getCard(b.cardId)}`、`energyPips(b)`… 全部拿到不同 identity、全部重算
⇒ 每 400~800ms 一次**全量重繪**，把所有 `await` 續行都墊高（連帶把「網路時間」灌了水）。
本機／休閒對戰沒這問題，是因為引擎是 immutable 更新：沒動到的子樹本來就沿用同一個物件；
**錦標賽這條路徑獨缺這個性質**。

**修法**：新增純函式 `src/lib/game/state-share.ts` 的 `shareStateIdentity(prev, next)` ——
回傳一份與 `next` **逐位元組等價**、但「內容和 `prev` 一樣的子樹一律沿用 `prev` 那一份物件」
的盤面（也就是沿用既有的 Svelte proxy）。`tAdopt` 改成
`game = (prev ? untrack(() => shareStateIdentity(prev, state)) : state)`。
陣列比對先試「同 `iid`」（否則 `bench`／`hand` 一有插入刪除，後面全部位移就一個都共享不到），
同一個 iid 的 prev 元素**最多只取用一次**，避免 alias。

等價性由構造保證：函式只會回傳 ① `next` 本身 ② 逐鍵逐序遞迴確認過完全一致的 `prev` 子樹
③ 用 `next` 的鍵、依 `next` 的鍵順序新建的物件。鍵順序不同就不沿用 —— 所以連
`JSON.stringify` 的位元組都一樣，不只是深度相等。

**量到的效果**（jsdom + 真 Svelte 5.55.4，仿戰場結構的 micro-benchmark，120 次 adopt）：
每 tick flush 8.4ms → 2.5ms，模板 helper 呼叫次數 9840 → 796（**-92%**）。
守衛用「真的自對局跑出來的連續盤面」量到平均每步沿用 **96%** 的容器節點。

**順手做的兩件小事**
- 戰場四個 `{#each Array(...)}`（雙方備戰列、雙方獎賞列）補上穩定 key `(i)`。
- 對手備戰位／對手戰鬥位移除 `out:scale` 離場動畫。

**⚠⚠ 本輪推翻的一條假說（別再重走）**
「離場動畫窗內的 fragment-owned derived 被下一發 tAdopt 標髒重算 ⇒ `derived_inert`」
—— 用真 Svelte 5.55.4 + jsdom **實跑重現不到（0 次）**。原因在
`reactivity/batch.js`：排程階段對 `(effect.f & (DESTROYED | INERT)) !== 0` 的 effect
一律跳過（第 927／955／972 行），離場中的子樹根本不會被重算。
實跑唯一能重現 `derived_inert` 的形狀是：**在非 effect 情境（事件處理器／計時器回呼）
讀取 owner effect 已 INERT/DESTROYED 的 fragment derived** —— 此時 `execute_derived`
會 warn 並回傳**過期值**（`return derived.v`），這正好對應玩家說的「按了沒反應」。
⚠ 所以正式站那 284 次的來源**仍未定位**；本版移除對手側離場動畫只是消滅了兩個 INERT 窗，
**不宣稱**已經解掉那 284 次。

**守衛**：`scripts/test-v6173-adopt-structural-share.mjs`（21 條）
- A 等價性：4000 組 fuzz 樹 ＋ 一整局自對局連續盤面，逐步比對 `JSON.stringify` 完全相同；
  另有「鍵順序不同不沿用」「重複 iid 不產生 alias」「prev 多鍵不沿用」的定點案例。
- B 有效性：⚠ 不是斷言「有呼叫 shareStateIdentity」，而是直接數**真的 `===` 沿用**的節點數
  （> 60%），並反向釘住「內容有變時根物件一定是新物件」。
- C 接線：`tAdopt` 內每一處 `game =` 都經過 `shareStateIdentity`（先剝註解再判，
  因為註解裡就寫著 `game = state`）、有 `untrack`、有 `game` 為 null 的退路、
  `_tRecordAdopt` 仍是最後一行（合併成本被誠實計入 perf 儀器）。
- D/E 模板：AST 掃描 `{#each Array(...)}` 全部 keyed、對手側無 `out:`/`transition:`。
- F 掃描器自我驗證：把 key 拿掉／把 out: 加回去／把 shareStateIdentity 換掉，都必須 FAIL。

沒有動到卡效果／引擎／錦標賽伺服器邏輯。`SITE_VERSION_HINT` 與 `version.ts` 一起 bump。

## v6.171 — derived_inert 事故：只加診斷，不做行為修正（真因**尚未定位**）

**回報**：2026-08-11 正式站 `/tournament`，站長 Console 實拍
`284 https://svelte.dev/e/derived_inert` ＋ `5` 次同碼（另一個呼叫點）＋ 一次
`[PTCG] ⚠ 主執行緒卡 922ms`。玩家回報「一直出現與伺服器失聯 xx 秒」
「拖曳附加能量、放寶可夢到場上都沒辦法動作」。同時段 nginx 1min 6383 req、5xx=0、
CPU load 1.08、uptime 沒重啟 ⇒ 伺服器無罪。另有玩家用 v6.121 說「今天都很順」。

**`derived_inert` 的確切語意（查 svelte 5.55.4 原始碼，不是猜的）**
- `reactivity/deriveds.js` `execute_derived()`：
  `if (!is_destroying_effect && parent !== null && (parent.f & (DESTROYED | INERT)) !== 0) w.derived_inert()`
  ⇒ 兩個條件同時成立才會噴：① 這個 derived **需要重算**（dirty）② 它的 owner effect
  已 **DESTROYED 或 INERT**。讀到的值是 `derived.v`，也就是**過期值**。
- `INERT` 由 `effects.js` 的 `pause_children()` 設，也就是分支正在跑離場動畫那段期間；
  **沒有 transition 的分支是同步 destroy 的，沒有窗口**。
- `warnings.js` 的 non-DEV 分支也會 `console.warn('https://svelte.dev/e/derived_inert')`
  ⇒ 正式 build 一樣看得到，站長看到的就是這一行。

**⚠⚠ 走過一條死路，寫下來避免下一個人重走**
一度認定是「離場動畫的 220～360ms 期間，delegated 的 onpointerdown/onclick 打到還留在
DOM 的卡片，讀到 owner 已 INERT 的 `{@const}`」。用 jsdom 最小重現確實能噴出 derived_inert，
但**那是假的**：`transitions.js` 的 `out(fn)` 第一件事就是同步 `element.inert = true`
（在 `outrostart` 派發之前），jsdom 沒有實作 inert 的 hit-testing 才會過。
用**真實 Chromium 實測**（headless，兩個重疊 div）：
`el.inert = true` 之後 pointerdown 直接打到後面那個元素、`document.elementFromPoint` 也回傳
後面那個。⇒ 離場中的節點**本來就點不到、也不會被拖曳落點命中**，
原本準備的 `use:inertOnOutro`（outrostart 時設 `pointer-events:none`）**整個撤回**：
它不但多餘，而且 out-only 的元素在 outro 被 abort 時 `in()` 因 `is_intro === false` 早退、
**不會派發 `introstart`** ⇒ `pointer-events:none` 會永久殘留，反而把備戰格／戰鬥位的
拖放目標弄死。（Fable 5 審查指出，已自行用 Chromium 覆核成立。）

**本版做了什麼：只加量測**
- 攔 `console.warn`（call through 原函式、不吞任何一則、全包 try/catch、自己絕不再 warn），
  收集 `svelte.dev/e/xxx` 的**次數**與**前 3 筆 stack**，併進既有 `/clientdiag`
  的 `svelteWarn`（不另開管線，比照 v6.170 的 Resource Timing）。
- 每筆 stack 帶「距離上一次 pointerdown 幾 ms」⇒ 分辨「玩家點出來的」vs「背景 burst」。
  背景 burst ＝ 殭屍計時器／輪詢的 await 續行讀到**已銷毀元件**的 derived（parent DESTROYED），
  那是目前最合理、且能一次解釋 284 次量級的假說。
- `svelteWarn.inertNodes` ＝ `document.querySelectorAll('[inert]').length`。
  `pause_effect` 要等所有 outro callback 回來才 `destroy_effect`；若某個 outro 的 onfinish
  沒回來，該分支會**永久 INERT 但 DOM 還在**（畫面凍結＋該區塊點不到＋裡面的 derived 一直 inert）。
  這一欄若持續 > 0 就是直接證據。

**⚠ 誠實的結論：284 次的來源尚未定位。**
本機用**未混淆的 svelte**（把 `derived.fn` 的原始碼直接印出來）＋ headless Chromium
實跑 AI 對局（擲硬幣、拖曳擺出場、擺備戰、準備完成、附能量、結束回合）
**一次都沒重現到**。錦標賽限定的路徑（伺服器權威輪詢、樂觀更新回滾、看門狗、重連 remount）
在本機起不來，那才是最可疑的區域。下次事故請直接看 `/clientdiag` 的 `svelteWarn.first`。

**已定位、但本版刻意不動的兩件事（留給站長裁定）**
1. **「拖曳沒辦法動作」**：`actionBusy = isTournament && tInFlight`（v6.147）直接 gate 住
   手牌的 `onpointerdown`（`if(dragKind && !actionBusy)startDrag(...)`）。
   v6.170 的重送狀態機讓 `tInFlight` 最長可以真的撐到
   `TACT_RETRY_MS = 25000` ＋ 最後一發 `TACT_POST_TIMEOUT = 8000` ≈ **33 秒**，
   這段期間**所有拖曳都被靜默丟棄**（只有 `.hand-card.action-busy{opacity:.5}` 這個很弱的提示）。
   v6.121 完全沒有 `tInFlight`／`actionBusy` ⇒ 這正是「舊版順、新版卡」最直接的差異。
   ⚠ 放行有重複送出的風險：重送用**同一個** actId 去重，但玩家的新手勢是**新的** actId，
   伺服器會照套 ⇒ 真的會生效兩次。所以不擅自改。
2. **「與伺服器失聯 xx 秒」是誤報**：`tOfflineSec = (tNow - _tLastPollOkAt)/1000` 是**牆鐘**，
   而 `_tLastPollOkAt` 只在 `/state` 輪詢成功、新鮮度看門狗、手動 resync 三處更新；
   **動作往返成功（`_tActAttempt` 拿到 `r.gameState`）不會更新它**。
   ⇒ 主執行緒被長任務塞住（例如那個 922ms）讓輪詢的 await 續行延後、或背景頁籤被節流時，
   即使每個動作都成功、伺服器 5xx=0，橫幅照樣會跳。它量的是
   「距離上次**處理到**輪詢回應多久」，不是「有沒有請求失敗」。
   ⚠ v6.149 的註解明講這個錨點不可以被「自我安撫」地重置，改法會同時影響新鮮度看門狗
   ⇒ 交由站長裁定，本版只回報不動手。

**守衛**：`scripts/test-v6171-svelte-warn-diag.mjs`（已進 `npm test`）
- A 行為層：把 hook 原始碼抓出來**實跑** —— 計數正確、非 svelte 的 warning 不計數也不改參數、
  三則全部 call through、stack 有帶「距上次 pointerdown 幾 ms」、`first` 有上限、無遞迴。
- B 接線層：在**編譯後**的 `_tSendClientDiag` 裡，`tApi('/clientdiag')` 之前的 payload
  真的含 `svelteWarn` / `inertNodes`（不是只驗原始碼有這個字串）。
- C 正對照：釘住「本版不加 pointer 防護」的兩個前提 —— svelte `out()` 仍同步
  `element.inert = true`、`derived_inert` 的 guard 條件仍是 `(DESTROYED | INERT)`。
  未來 svelte 升級動到任一個，這條就會 FAIL，提醒要重新評估。
- D 掃描器自我驗證：拿掉計數行，A 必須抓得到。
- HEAD-FAIL 證明：在 v6.170 原始碼上跑 ⇒ **6 條失敗、exit 1**。

## v6.170（server v1.11）— 連線韌性：動作冪等重試、對手心跳、Resource Timing 自動回報

**問題定位（承 v6.159 的量測，不重驗）**
- 伺服器與隧道無罪：賽中 40 人時 node 3.7ms、繞 Cloudflare 一圈 65ms。
- `net`(TTFB) p50 **289ms**、p75 417、p90 985、p99 3641、max 4328 ⇒ **典型請求正常**，
  「每次固定 800ms」的舊前提**已被推翻**。
- 壞樣本 15/54 集中在 **10/26 人**；同一人同一窗內 net 中位 141ms 但最大 14.8s
  ⇒ **間歇性斷流**（丟包／無線斷訊）。`net95` 與 `dl95` Spearman 0.57 ⇒ 整條路徑停滯，不是 TLS 成本。
- **鏡像效應**：`stale-version` 138 筆中 **94 筆在對手回合、108 筆自己輪詢健康**
  ⇒ 多數「卡」是**對面那個人斷線**的投影，一個爛連線讓兩人一起喊卡。

⇒ 玩家的網路我們修不了，這一版的目標是**讓斷流的代價趨近於零**。

**A. 自動回報網路細節（取代「請玩家按 F12」）**
- 併進**既有** `/clientdiag` 的 `perf.res`，沿用 v6.159 的結構與節流，**不另開管線**。
- ⭐ **實測結論**：頁面與 API **同源**（都在 `www.ptcg-tw-sim.com`，`/api/tournament/*` 由
  Cloudflare 轉到 VM；curl 實測回應無 `Timing-Allow-Origin`，但同源本來就不需要）
  ⇒ `nextHopProtocol` / `connectStart|End` / `domainLookup*` / `secureConnectionStart`
  **全部拿得到**，不必動伺服器 header。
- 用 `PerformanceObserver('resource')` 而不是 `getEntriesByType`：預設 buffer 只有 250 筆，
  對戰頁每 1.2 秒一發、**幾分鐘就滿**，滿了之後靜默不再收錄 ⇒ 長對局後段會全空而被誤讀成「沒問題」。
- 判別「重建 vs 重用連線」：規範上重用時 `connectStart === connectEnd`；門檻取 1ms
  （Safari 時戳粗化 ~1ms，而真的建連至少一個往返 65ms，不可能誤判）。
- ⚠ 誠實原則：`requestStart === 0` ＝ timing 被閹割 ⇒ **丟棄並計入 `bad`**，
  絕不把一堆恆為 0 的欄位送上去假裝有量到；observer 掛不上時整包回 **null**（不是 0）。
- admin 監控分頁新增「連線」欄：`協定 · 重建 N%（樣本數）`，≥20% 標紅。
  三種「沒有數字」分得出來：舊 client「—」／不支援「不支援」／被閹割「無權限(n)」。

**B-1. 動作冪等重試（主菜）**
- client 對**一個使用者手勢**產生 `actId`（`crypto.randomUUID`，有兩層退路），
  **跨所有重送 attempt 保持同一個**。⚠ 絕不可改成拿動作內容做 hash——連續兩次附能量是
  兩個各自合法的動作、payload 可能一模一樣，用內容當鍵會把第二次誤判成重複而靜默吞掉。
- 伺服器 `recentActs.s0` / `recentActs.s1` 存已套用的 actId；命中 ⇒ 回 `duplicate` + 最新盤面。
- ⭐ **與既有 CAS 相容的關鍵**：去重紀錄與盤面**寫在同一次 CAS `updateOne` 的 `$set` 裡**（原子）。
  兩發同 actId 並發 ⇒ 都算過 applyAction，但 CAS 只有一發寫得進去；落敗方回 stale、
  用**同一個 actId** 重送 ⇒ 這次讀到的 doc 已含該 actId ⇒ duplicate。**淨結果永遠只套用一次。**
- ⚠ **查重排在 `canSeatAct` 之前**：重送抵達時動作早已套用、已輪到對手，
  先跑 canSeatAct 會回「現在不是你能操作的時機」＝把成功的動作回報成錯誤（正是要修的病）。
- ⚠ 淘汰**只看年齡**（120 秒）不看筆數 —— Fable 5 審查抓到的第一個洞：共用的環形陣列
  會被對手一個手忙腳亂的回合沖掉，我在途的重送就查不到紀錄 ⇒ 重複套用。
  per-seat 點路徑 `$set` ＋ 年齡淘汰同時堵掉它（伺服器保存 120s ＝ client 重送窗 25s 的 4.8 倍）。
- ⚠ 其他 8 個寫盤面的地方（閒置判負／時限／投降／管理員裁定／setup 自癒）用的都是
  `$set: {gameState, version, ...}`，`$set` 只覆蓋列出的欄位 ⇒ `recentActs` 原樣保留，**逐一比對過**。
  房間重建（`/reset`、管理員重賽）額外清空。
- ⚠ 舊 client 不送 actId ⇒ 不查重、不寫紀錄，行為與 v6.169 逐字相同（fail-open）。
- POST 逾時 **12s → 8s**：p99 的 net 是 3.6 秒，等 12 秒才知道要重試太久；
  有了冪等鍵，「提早放棄並重送」不再有重複套用的風險。

**B-2. 恢復偵測**
- `online` 事件與 `visibilitychange`→visible：卡在退避等待中的動作**立刻**重送，不等計時器。
- ⚠ 只用**事件**當觸發，絕不拿 `navigator.onLine === false` 去封鎖送出（誤判會把玩家鎖死）。

**B-3. UI 不因為一發卡住就鎖死**
- 重送期間橫幅「🔁 連線不穩，正在自動重送（第 N/5 次）」，**刻意不做全畫面遮罩**：
  盤面、設定、放大鏡、離開全部照常。
- 「停止重送」逃生鈕**立刻**解鎖。⚠⚠ 這**不是 undo**——按下的瞬間動作可能已在伺服器生效、
  只是回應沒回來 ⇒ 文案寫「已停止重送。這個動作可能已經生效…」，
  **絕不可寫「已取消」**（會誘導玩家再做一次，那才是真的送出兩個動作）。
- 終止條件三個（缺一不可）：attempt ≥ 5、牆鐘 ≥ 25 秒、**盤面已 game-over**。
  只靠前兩個的話，被判負的玩家會對著「重送中」再空等十幾秒。

**B-4. 鏡像效應緩解**
- `/state` 帶 `s=<座位>` 當心跳，伺服器 in-memory 記錄 per-room per-seat 最後連上時間
  （與 `_lpWaiters`／觀戰心跳同一前提：pm2 fork 單 instance）。
- ⚠ 心跳記在**請求抵達**當下，不是回應當下——長輪詢刻意掛起 8~25 秒，
  記在回應端會讓健康的等待者看起來像斷線了 25 秒。
- ⚠⚠ 門檻由**伺服器自己的長輪詢設定**推導（`max(20s, maxWaitMs×2+8s)`），不讓 client 猜死數字：
  站長把掛起秒數從 25 秒改成 8 秒（或改回去），寫死門檻的版本就會開始誤報。
- client 顯示條件：`oppQuietSec > 0` **且** 伺服器權威 `actorSeat` 是對手。
  ⇒ 自己回合不跳、正常長考不跳（長考的對手仍每 1.2 秒在輪詢，`oppQuietSec` 恆為 0）。
- ⚠ 沒紀錄／未達門檻時伺服器**省略整個欄位**（不是回 0/false）⇒ pm2 重啟後不會對全場誤報。
- ⚠ 不透露任何盤面資訊；不碰 `lastActionAt` ⇒ 與閒置判負完全不打架（純視覺）。

**Fable 5 審查採納／否決**
- 採納：per-seat 年齡淘汰（洞 1）、「取消 ≠ undo」的文案與清排程（洞 2）、
  game-over 當第三個終止條件（洞 4）、stale-retry 併進同一台狀態機共用 attempt 預算（洞 6）、
  POST 逾時砍半（①f）、用「重建/重用」分層驗證假說（③）。
- **否決**：①(b) request hedging —— 同源下第二發幾乎必然重用同一條連線，h2 底下與第一發同生共死，
  對「整條路徑停滯」近乎無效；②WebSocket/SSE —— half-open 連線瀏覽器不會主動發現，
  對間歇性斷流是變差不是變好，且輪詢本身就是天然的 liveness probe；
  ③JSON diff 增量 —— 對「路徑停滯」零幫助，複雜度不划算；
  ④「伺服器收到 duplicate 就重置閒置計時」—— **會讓任何人靠重放舊 actId 無限續命**，判負機制直接失效。
- **未採納但值得後續驗證**：備用 hostname（逾時重試強拿新連線，繞開陷入 RTO 退避的舊連線）。
  這需要 DNS/Cloudflare 設定，且該不該做**由這一版新增的 `res.freshPct` 資料決定**——
  若壞樣本集中在「重用連線」上，才坐實「舊連線退避」假說。**先量測再決定，不憑猜測動架構。**

**洞 3 的實際查證結果（與 Fable 的假設不同）**
- Fable 假設「整包寫回」會抹掉 `recentActs`。實際比對後**不成立**：全檔房間寫入一律是
  `$set` 指定欄位、沒有 `replaceOne`，`$set` 不會動未列出的欄位。已加守衛釘住。

**守衛**：`scripts/test-v6170-idempotent-action-retry.mjs`（68 條，HEAD-FAIL 18 條）。
- 伺服器冪等核心 `tActionApplyOnce` **抽成不碰 express/身分/遮蔽的純邏輯**，
  配一份會做 CAS 與點路徑 `$set` 的假 collection **真的跑起來**，斷言「盤面只前進一版」這個**結果**。
- 變異測試：把 dedupe 拿掉的實作必須被抓到會套用兩次（否則守衛是假綠）。
- client 的重送狀態機、Resource Timing 收集器同樣用 esbuild 轉出來實跑。
- 模板綁定驗到 **Svelte 編譯產物**（字串出現在 render code 裡），不是驗原始檔有這行字。

⚠ **部署**：需要跑 `oracle-admin/update-tournament.bat`（server_admin_patch.js 有改）
與 `oracle-admin/update-admin-html.bat`（admin.html 有改）。

## v6.169（admin v1.72）— 報告圖完整版：每頁 7 筆、量詞校正、分段可勾選與排序

站長對 v6.168 留下的三個問題全部裁定「都做」。

### ① 名次類每頁 8 → 7 筆（字更大，頁數多約 14%）

站長選了「字更大」的方案。可用列區是 `MP.TOP`(296) 到註腳分隔線 `MP.NOTE_Y-22`(936) ＝ **640px**：

| | 每頁筆數 | 列高 | 實際佔用 | 原型名 | 勝率 |
|---|---|---|---|---|---|
| v6.168 | 8 | 72 | 8×72+7×8 = 632px | 38px | 46px |
| **v6.169** | **7** | **83** | 7×83+6×8 = **629px**（底 925，離分隔線 936 還有 11px） | **42px** | **50px** |

其餘等比放大（×1.10~1.15）：名次 38→42、較上期 32→35、使用率 32→35、使用次數 30→33、
「—　資料太少」30→33、欄位表頭 24→26、長條高 18→20；奪冠名次頁的名次／牌組名 38→42、
次數 44→50、段落標 34→38。影片會被觀眾在手機上以約 400px 寬觀看（縮 0.21 倍），
42px 的原型名只剩 8.8px、38px 只剩 7.9px —— 字級是這裡唯一該優先保住的東西。

**冠軍（逐場）維持每頁 5 筆**：列高 116（一列兩行），5×116+4×10 = 620px 已幾乎吃滿那 640px；
6 列要 746px，放不下。守衛把「6 列放不下」也斷言起來，這個理由日後不會變成沒人查證的口號。

⚠ 每頁尺寸仍是完全一致的 1920×1080，最後一頁不足額就留白、不縮版。

⚠ 段落標 34→38px 之後上緣變成 268−19 = **249**，剛好貼上 mpFrame 副標的下緣（234+30/2 = 249）；
段落標開頭是 emoji（🏆🥈👥），emoji 字形常超出 em box ⇒ baseline 挪到 **272**（離副標 4px、
離列區起點 296 還有 5px）。這是 Fable 審查抓到、我實測確認的（見 ④）。

### ② 「N 位」→ 語意正確的量詞（**逐處判斷，不是整檔取代**）

依 `crBuild` 的實際聚合方式逐處判：

| 位置 | n 的語意 | 判定 |
|---|---|---|
| `champRank` 冠軍牌組次數榜 | 每場網站賽的冠軍依牌組聚合 ⇒ 該牌組**奪冠幾次** | 位 → **次** |
| `t4Rows` 四強牌組 | 每場賽事的 top4 逐筆累加（同一人在兩場賽事各算一次）⇒ **進四強幾次** | 位 → **次** |
| `commRank` 社群賽奪冠牌組 | 社群賽冠軍依牌組聚合 ⇒ **奪冠幾次** | 位 → **次** |
| `t4Total` 四強區塊抬頭「共 N 位」 | t4Rows 的 n 加總 ＝ top4 席次總數 ⇒ **人次**（不是幾個人） | 位 → **人次** |
| `crNotes`「四強＝準決賽的 4 位選手」 | 真的是活生生的 4 個人 | **維持「位」** |
| admin 玩家排行榜「共 N 位玩家」、「一位選手一場賽事…」 | 真的在數人 | **維持「位」** |

單頁版與完整版一起改（同一週發出去的兩張圖不能對同一筆資料寫不同單位）：
單頁版 `rankRows` 的單位從硬寫「位」改成**由三個呼叫端各自宣告**，完整版則收斂進新的
`CR_SECTIONS` 表。⚠ 單頁版**只動文字**，行為一行沒改（`roomFor` 動態砍列、MI 尺寸、
`slice(0, MI.TOPN)` 全部原樣，守衛照舊釘住）。

### ③ 奪冠完整版：分段改成站長自己勾選與排序

站長沒有固定的影片腳本 ⇒ 不替他決定順序。按「🎬 奪冠報告・完整版」改成先開一個設定視窗：

- 四段各一列，**勾選**要不要輸出、**▲▼** 上下移動調整順序（⚠ 刻意**不做拖曳**：admin 是
  單一 HTML 檔，拖曳要一整組 pointer/touch 事件與捲動相容處理，兩顆按鈕就能達成同樣的事）
- 全不選時「產生 ZIP」鈕 **disabled** 並顯示「⚠ 至少要勾選一個段落才能產圖」
- 設定存 `localStorage['ptcgAdminChampFullSections']`，下次打開沿用
- 頁碼「第 X / N 頁」的 N 由 `mpNumber` 在整批頁面組完後才寫入 ⇒ 只勾兩段時分母自動變小

實作要點（全部是「做錯了不會報錯」的地方）：

- `mpPlanChampion(d, perChamp, perRank, sel)`：`sel === null/undefined` ＝沒指定 → 四段全出
  （既有呼叫端與舊守衛的預設）；**`[]` ＝一段都不出、回 0 頁**。這兩者一定要分開 ——
  若把 `[]` 也當成「全出」，就會出現「一段都沒勾卻產出四段」這種最難察覺的錯。
  未知 key（舊設定殘留／手動改壞 localStorage）忽略，不讓整批產圖炸掉。
- ⚠⚠ **Safari 無痕的 `localStorage.setItem` 會 throw**（QuotaExceededError），某些內嵌情境
  連讀 `localStorage` 這個屬性本身都會 throw ⇒ `mpLsGet`／`mpLsSet` 一律 try/catch。
  狀態的真實來源是記憶體裡的 `_crFullSel`，localStorage 只負責持久化 ⇒ 存不進去也只是
  「下次要重勾」，當下的勾選／排序／產圖完全正常。
- `mpNormalizeSel`：保留舊設定的順序、丟掉未知 key、去重，**新增的區段補在最後且預設勾選**
  （升級不該讓某一段靜默消失）。壞 JSON／非陣列 → 退回四段全勾、預設順序。
- 這五支函式（`openChampionReportFullExport`／`renderChampFullPicker`／`champFullToggle`／
  `champFullMove`／`runChampionReportFullExport`）寫成**具名函式宣告 + window 別名**，
  不是 `window.x = function`：它們彼此互相呼叫，裸名稱要在模組作用域內就解析得到；
  只掛 window 是靠「找不到就往全域找」才碰巧能動，而且守衛抽不出來跑。

### ④ Fable 審查抓到的三件事（每一件都自己查證後才改）

1. 🟢→已修：**段落標 38px 貼上副標**（上緣 249 = 副標下緣 249）。實測確認後 baseline 268→272。
   守衛新增「整頁任兩段水平有重疊的文字，上下至少留 2px」的碰撞檢查 ——
   把 272 改回 268 會 FAIL（實跑驗證過），這條不是紙上談兵。
2. 🟡→已修：**勾了 `champRank` 卻靜默不出頁**。`crSectionRows` 在只有 1 場網站賽時回 `[]`
   （與逐場完全等價，這規則本身沒錯），但 v1.72 的契約已經變成「勾什麼出什麼」⇒ 靜默少一段
   ＝站長剪片時才發現素材缺一塊。新增 `crSkipReason(d, k)`：產完圖把「勾了但沒出」的段落
   連同原因寫進完成訊息；全部沒東西可出時也逐段講原因（而不是含糊的「沒有任何資料」——
   那句話在「只有 1 場網站賽」的情形下根本是錯的，資料明明有）。
3. 🟡→已修：**產圖進行中點勾選／▲▼ 會把「產生中… 3/12」那顆按鈕整個換掉**。
   `mpExportPages` 是把進度寫進 `#champ-full-run-btn` 這個**元素**，重繪後舊按鈕 detach ⇒
   進度寫進空氣、再按又被 `_mpBusy` 靜默擋掉，畫面看起來就是「卡住了」。
   改成產圖中整個視窗鎖住（勾選框／▲▼／取消／產生鈕全 disabled、modal 背景點擊也擋掉），
   `champFullToggle`／`champFullMove` 再各加一道 `if (_mpBusy) return`。

Fable 另外逐項驗過沒問題的（我自己複算一遍相符）：垂直 629/640、水平各欄在極端值
（使用次數 5 位數、勝率 100.0%、牌組名撞上 miFit 上限）都不相撞、`sel` 的 undefined/[] 分歧、
`mpNumber` 的計算時機、▲▼ 的 index 位移（單執行緒、無 await）。

### ⑤ 守衛 `scripts/test-v6169-report-full-7rows-sections.mjs`（25 條）

BASE `873d3f04` 實跑 **PASS 2 / FAIL 23**，本版 **PASS 25 / FAIL 0**。
（那 2 條在 BASE 就過的是「列底不撞註腳」與「不越界不疊字」—— 8 筆版本本來就沒有版面問題，
它們要抓的是**這次放大字級後**才可能出現的越界，不是拿來證明有沒有改。）

⚠ 沿用 v6.168 的做法並加嚴：
- 分頁純函式直接跑；繪圖層餵**記錄型假 ctx 真的畫一遍**，再回頭數畫出來的東西。
- 假 ctx 的 `measureText` 用「全形 1.0em／半形 0.55em」近似量寬，所以可以真的**排一遍版**：
  斷言每一列的文字都不越界、同一行相鄰欄不相疊、整頁任兩段文字上下至少留 2px。
- 「勾了卻沒出」那條是**跑完整條匯出流程**（產圖 → PNG → ZIP → 下載）再讀完成訊息，
  不是查有沒有呼叫某函式。
- localStorage 用會 throw 的 stub **實際餵進去**（`localStorage` 當參數傳給抽出的區段），
  再斷言勾選與排序仍然生效、視窗仍畫得出來 —— 不是只讀原始碼找 `try` 字樣。
- 15 個非空子集 × 2 種順序 ＝ 30 組全跑：只出勾到的段、順序照設定、頁碼分母正確、
  段內一筆不少且名次連號。

`test-v6168-report-full-pages.mjs` 同步改了 3 條判準（單位詞由「位」改「次」、
產圖本體的錨點從 `window.openChampionReportFullExport` 搬到 `runChampionReportFullExport`）；
BASE 跑這份改後的檔是 **PASS 26 / FAIL 3**，本版 29/29。

### ⑥ 部署

`oracle-admin/admin.html` 是 admin 後台 ⇒ 要跑 `update-admin-full.bat`。
沒有動到卡效果／引擎／錦標賽伺服器邏輯，但 `SITE_VERSION_HINT` 與 `version.ts` 一起 bump 了，
所以照慣例三支 bat 一起跑最保險。

⚠ **首頁 changelog 不放**：站長自己用的後台功能，玩家沒有任何要做的事、也感受不到規則差異。

## v6.168（admin v1.71）— 報告圖「完整版（多頁）」匯出：每週宣傳影片的素材

### ① 站長的需求

> 「我現在想要自己用 canva 製作，但需要素材。最適合的素材是 admin →牌組原型規則→牌組使用率與勝率。
> 目前能依天數匯出環境報告圖和奪冠報告圖，但內容都會因為圖面格式的限制容納不下全部內容，
> 導致許多排名被省略。做成影片就沒有這個問題了 —— 希望能產出**完整的**環境報告圖與奪冠報告圖，
> 可以有好幾頁（用影片播放的方式播每一頁），再用 canva 配上背景音樂，就是每週可產出的宣傳影片。」

流程是：admin 按一下 → 拿到一疊 PNG → 拖進 Canva → 配樂 → 上 YouTube。

### ② 做法：多一顆按鈕，單頁版一行都不動

「牌組原型規則」分頁的統計範圍那一列，原本兩顆（🖼️ 環境報告圖 / 🏆 奪冠報告圖）之後，
新增兩顆 **🎬 …完整版（多頁 ZIP）**。單頁版（1080×1350、4:5、給 LINE／FB 轉發）行為完全不變。

| | 單頁版 | 完整版（新） |
|---|---|---|
| 尺寸 | 1080×1350（4:5）、2× 輸出 | **1920×1080（16:9）、1× 輸出** |
| 筆數 | 環境圖 `slice(0, MI.TOPN)`＝前 10 名；奪冠圖依剩餘空間 `roomFor` 動態砍列 | **一筆都不砍** |
| 輸出 | 預覽 modal → 單張 PNG | 直接下載 **ZIP**（`01.png`、`02.png`…） |

尺寸取捨：成品是 1080p 影片，畫布就等於影片的一個 frame，所以用 1× 的 1920×1080 —— 再放大 2×
只會被 Canva／YouTube 縮回去，而且一張 1920×1080 的 canvas 就佔約 8MB，多頁不釋放會把分頁吃爆
（`mpExportPages` 每頁轉完 blob 就把 canvas 縮成 1×1 讓 GC 回收）。

**每頁 8 筆（不是 10）**：1080 高扣掉品牌帶（0–140）、標題帶（140–290）、註腳與頁腳的硬保留區
（928–1080）後只剩約 630px。8 列可以給到 72px 列高、原型名 38px、勝率 46px；10 列會壓到 55px
列高、字級掉到 30px 以下。影片會被觀眾在手機上以約 400px 寬觀看（縮 0.21 倍），字級是這裡唯一
該優先保住的東西。奪冠報告的「冠軍逐場」列資訊較多（列高 116），每頁 5 筆。

每一頁都有：站名＋logo＋網址（頂部小、頁腳大，共兩次）、資料截至日、資料範圍（天數／起訖）、
**頁碼「第 X / N 頁」**、本頁涵蓋的名次區間（「第 9–16 名（全部 37 種牌組）」）、口徑註腳。
排名跨頁連續（第 2 頁從第 9 名開始）。

奪冠報告完整版分四段依序出頁：冠軍牌組次數榜 → 冠軍（逐場）→ 四強牌組 → 社群賽奪冠牌組。
頁碼跨段連續（影片是一路播下去的），名次在段內連續。

### ③ 統計口徑：收斂成一份，不是抄第二份

這是同一份資料的不同排版，**絕不可以自己重算**。因此把原本寫死在 `miDraw` 裡的分母／佔比抽成
純函式，單頁版與完整版都吃它：

- `miDeckKey(srcKey)` — `casualDecks` / `tournDecks` 的唯一字面量（`miTrend` 也改吃它）。
  守衛釘住 `'casualDecks'` 全檔只能出現 1 次。
- `miComputeRows(srcKey, cur)` — 回 `{ blk, rows, total, share }`。分母是 `scanned` 的副數，
  **不是** rows 的 usage 加總（未分類那一大塊不在 rows 裡，用加總當分母會把佔比灌水）。
- 奪冠側：`crLoadData()`（補載 tournStatsCache → ensureCardIndex/Tags → champion-report →
  `crBuild` 全量 archives）與 `crNotes(d)`（口徑註腳）抽出，單頁版與完整版共用。

⚠ 這個重構把兩支既有守衛原本盯的字串搬走了，判準同步搬到新的唯一來源：
`test-deck-meta-image` 的「分母用 scanned」改查 `miComputeRows`＋確認 `miDraw` 有接上；
`test-v6111-champion-report` 的兩條（補載快取、await 卡片索引）錨點從
`window.openChampionReportExport` 改成 `async function crLoadData`。

### ④ ZIP：自己寫 store-only，不引入 CDN 函式庫

`admin.html` 目前唯一的外部相依是 gstatic 的 firebase SDK。為了打包再拉一支 CDN 函式庫進來
等於多一個單點失敗（VM 端網路不穩就整個功能死掉）。PNG 本來就已壓縮，store（method 0）不會變大，
所以 `mpZip()` 自己組 local file header／central directory／EOCD，含 CRC32 與真的 DOS 時間戳
（填 0 等於 1980-00-00，部分解壓工具會抱怨）。檔名依總頁數補零（`01.png`…，超過 99 頁補到 3 位），
否則 Canva 匯入時 `10.png` 會排在 `2.png` 前面。

### ⑤ 守衛 `scripts/test-v6168-report-full-pages.mjs`（25 條，HEAD 全紅）

BASE `2bcfc196` 實跑 **PASS 0 / FAIL 25**，本版 **PASS 25 / FAIL 0**。

⚠ 這功能的失敗模式全都是「產得出來、看起來也對，但素材是壞的」，而且
**斷言「有呼叫某函式」≠「那件事發生了」** —— 所以：

- 分頁是純函式（`mpPaginate` / `mpPlanMeta` / `mpPlanChampion`），守衛**直接跑**：
  餵 37+23 筆 → 斷言所有頁的筆數加總 === 60、各資料源 37／23、頁數 5+3、
  最後一頁剩 5 筆、名次序列剛好是 1..37 與 1..23、`page`／`pageTotal` 連號。
- 畫圖層餵一個**記錄型的假 ctx 真的畫一遍**，再回頭數畫出來的東西：
  60 個牌組名一個不漏也不重複；每頁的滿版底色都是 `1920×1080`（尺寸一跳，剪成影片會抖）；
  每頁「第 X / N 頁」剛好出現一次且連號；每頁都有站名、兩次網址、資料截至、資料範圍。
  奪冠側同樣跑一遍：43 筆全到、尺寸一致、全圖不出現百分比。
- ZIP 實跑：`mpZip` → `arrayBuffer` → 走 central directory 把每一筆的內容**真的取回來**比對，
  並驗 CRC32（`hello` = 0x3610a686）與 `cdOff + cdSize === EOCD 位移`。
- 長條的滿長基準必須是**全體**最大佔比（每頁各自歸一化的話，第 3 頁的第 21 名會畫得跟第 1 名
  一樣長，直接騙人）—— 斷言同一資料源各頁的 `peak` 相同。
- 單頁版沒被動到：`MI` 仍是 1080×1350×2、`miDraw` 仍 `slice(0, MI.TOPN)`、六支既有 window 函式都在。

### ⑥ 部署

`oracle-admin/admin.html` 是 admin 後台，Wilson 要跑 `update-admin-full.bat`。
沒有動到卡效果／引擎／錦標賽伺服器邏輯，但 `SITE_VERSION_HINT` 與 `version.ts` 一起 bump 了，
所以照慣例三支 bat 一起跑最保險。

⚠ **首頁 changelog 不放**：這是站長自己用的後台功能，玩家沒有任何要做的事、也感受不到規則差異。

## v6.167 — 🔴 P0：報到版本閘的提示視窗放錯版面分支 ⇒ 玩家「按了報到沒反應」＝被鎖在賽外

### ① 回報與真因

站長回報：「報到時如果版本落後，並不會出現提示（或是提示不夠明顯？），玩家反應**不能按報到按鈕**（沒有看到提示）。」

真因（`src/routes/game/+page.svelte`，v6.166 行號）：

- 「✋ 我要報到」鈕在 **L7870**，其 if-chain 最外層是 **L7739 `{#if isTournament && tStep !== 'playing'}` 的 then 分支**（＝賽事大廳）。
- v6.160 的版本閘提示視窗在 **L8282**，其 if-chain 最外層是 **同一個 L7739 的 `{:else}` 分支**（＝對戰畫面）。

兩者條件互斥 ⇒ **提示視窗在「可以報到」的那一刻永遠不可能出現在畫面上**。
於是 `tCheckinBlockedByVersion()` 一旦回 true：`tCheckin()` 只設了 `tVerModalEventId` 就 `return`，
**不呼叫 API、不設 `tBusy`、不寫 `tError`** ⇒ 按鈕外觀完全沒變、畫面完全沒變、再按幾次都一樣
⇒ 玩家的描述必然是「按不了報到按鈕」。

⚠ 這正是 v6.160 設計時寫明的**唯一失敗模式**（「把玩家鎖在賽外」）。當時做了五條 fail-open，
但 ①~④ **全部建立在「視窗顯示得出來」這個前提上** —— 前提一破，五條一條都沒救到人。

### ② A/B 分辨（先做，沒有跳過）

- **(A) 版本閘**：機制成立且是 100% 決定性的 —— 只要閘擋人，**每一位**被擋的玩家都會被靜默鎖住。
- **(B) 其他原因**：報到鈕的 `disabled` 只綁 `tBusy`（AST 求值確認，見守衛 ②），
  而 `tBusy` 的每一處 `= true` 都有 `finally { tBusy = false }`，且 `tApi` 自 v6.135 起有 8/12 秒逾時 ⇒ 卡死機率低。
  後端 `/checkin`（`server_admin_patch.js`）**沒有任何版本相關的拒絕邏輯**，`/event` 在
  `minClientVer.enabled !== true` 時一律回空字串（L4053）⇒ 舊 client 與關閘情況下後端不會造成誤判。

⚠ **誠實記錄**：閘是否真的被開著，**沙盒查不到**（要讀 Mongo 的 `tournamentConfig/minClientVer`，
或看 admin「🔄 報到版本閘」的現值）。所以無法 100% 排除玩家遇到的是別的狀況。
但 (A) 是一個確定存在、確定會鎖人的 P0 缺陷，且與回報症狀逐字吻合，先修它。
**如果站長那邊確認閘從未開啟，請把這一則的診斷降級為「修掉一顆定時炸彈」，並回頭查 (B)。**

### ③ v6.161 的大廳輪詢降頻：**沒有**造成報不了到

`tPollDesiredMs(_, 'lobby')` 的 ⑤ 降頻分支（3s → 9s，背景 21s）確實會讓
「registration → checkin」這個狀態轉換最壞晚 9 秒（背景 21 秒）才被發現，
期間報到鈕還沒被 render 出來。但那是**延遲**不是**鎖住**：
`tournLoadEvent()` 一旦看到 `_sig` 變動就呼叫 `tLobbyResume()`，之後 60 秒一律 3 秒頻率；
而報到窗本身是分鐘級。且症狀是「按鈕不存在」而不是「按了沒反應」，與回報不符。⇒ 排除。

### ④ 修正

1. **把提示視窗搬到所有版面分支之外**（緊接在 `{#if isTournament && tStep !== 'playing'}` 之前，
   fragment 的頂層），大廳與對戰兩邊都畫得出來。
   同族事故：v6.149（失聯橫幅寫進桌機分支）、v6.154（監控分頁沒有內容容器）。
2. **新增第 ⑤ 條 fail-open：同一場賽事最多只擋一次**（`_tVerPrompted: Set<string>`）。
   這一條**不依賴 UI**：就算視窗因為任何理由（版面、CSS、未來重構）沒被畫出來，
   玩家再按一次「我要報到」就一定會走到 `tCheckinCommit()` ⇒ 最壞情況收斂成「白按一次」。
   刻意用非響應式的 `Set`（不驅動畫面），且只存在於本次頁面生命週期（重載後可再提示一次）。
3. **報到鈕下方加一行自救說明**：「按了沒反應請再按一次；如仍無法報到，請至首頁更新版本。」
   ⚠ 站長授權的原句是「如無法報到，請至首頁更新版本」。這裡**前面加了「按了沒反應請再按一次」**，
   因為修正 2 之後那才是真正有效的第一步；只叫玩家去更新版本，在「真因不是版本」的情況下會誤導。

### ⑤ 守衛 `scripts/test-v6167-checkin-never-locked.mjs`（已進 npm test，HEAD 9 FAIL）

- ⓪ **掃描器自我驗證**（Rule 25）：互斥偵測器對合成的 then/else 範例要抓得到，對同層範例不可冤枉（正對照）。
- ① **版面可達性用 svelte 編譯器 AST 實跑求值**：算出報到鈕與提示視窗各自的 if-chain，
  只要出現「同一個條件、一個走 then 一個走 else」就 FAIL。**不是字串比對**。
- ② 報到鈕的 `disabled` 表達式必須恰好是 `tBusy`（擋住日後有人加入可能永久成立的新條件）。
- ③ **行為端**：把 `+page.svelte` 裡 `tCheckinBlockedByVersion` / `tCheckin` / `tCheckinCommit`
  三支**真的抽出來執行**（esbuild transform TS），斷言的是 **`/checkin` 這一發 API 有沒有被送出**，
  不是「有沒有呼叫某函式」。情境矩陣：閘關閉／閘開啟但 client 夠新／client 太舊／門檻是垃圾值／
  門檻 null／剛強制更新過／剩不到 30 秒／找不到該場賽事／`checkInDeadline` 為 null／判定丟例外／
  `VERSION` 解析不出來 —— **每一種都必須在 ≤2 次按下完成報到**。
  另有正對照：該擋的時候第一次按確實只開視窗、沒有直接報到（否則全綠可能只是閘壞掉）。
- ④ 自救說明文字與版本 bump。

HEAD（v6.166）實跑 **16 passed / 9 failed**，其中 `★★★連按 5 次也一定至少報到一次` 的實測值是
**Infinity** —— 這就是「玩家被鎖在賽外」的行為端證據。

### ⑥ Fable 5 審查抓到、經自行查證後一併修的兩項

**(a) 🔴 `tApi` 的 `getIdToken()` 在逾時計時器之前 ⇒ `tBusy` 可能永久 true。**
`src/routes/game/+page.svelte` 的 `tApi()`：v6.135 加的 `AbortController` 逾時（POST 12s／GET 8s）
只保護 `fetch`，但它是在 `await firebaseUser.getIdToken()` **之後**才建立的。
Firebase 在 token 過期時會發真的網路請求；隧道黑洞／裝置睡眠喚醒時它可能既不 resolve 也不 reject
⇒ 整支 `tApi` 掛住 ⇒ 呼叫端的 `finally { tBusy = false }` 永遠不執行
⇒ **大廳每一顆鈕（含「✋ 我要報到」）永久 disabled、卡在「報到中…」**。
這是與版本閘完全無關的**第二條**「報不了到」路徑，而且 disabled 是真的（不是「按了沒反應」）。
⇒ 改成 `Promise.race([getIdToken(), 6 秒])`：逾時就不帶 `Authorization` 送出去，
伺服器要嘛走 playerId fallback、要嘛回一個**看得見、按得動**的錯誤。可用性優先。
⚠ 這一改動連帶讓 `test-v6159-client-perf-instrumentation.mjs` 的第 ② 條（原本用 regex 比對
「`getIdToken());` 之後 80 字內接 `_segT1`」）失效。已把該條改成**判斷意圖**：
`_segT1` 必須在 `getIdToken()` 之後、且中間不可以再有別的 `await`（否則那一段就不只是 token 段）。

**(b) ⚠ 報到失敗的訊息看不到。**
大廳的 `tError` 只印在 `<main>` 最底下的 in-flow `<p class="warn">`（對戰分支那個 fixed 的
`.tourn-toast` 在 `{:else}` 裡、大廳看不到），賽事卡一多就捲出畫面
⇒ 玩家按報到、後端回 409（不在報到階段／未報名／`autoRemovedConflict`），他看到的**還是**「按了沒反應」。
⇒ 新增 `tCheckinErrId`，報到失敗時把訊息貼在報到鈕正下方。

Fable 另外三項經查證**不需要動**：提示視窗搬到頂層後 CSS 是 `position:fixed; z-index:10000`，
大廳唯一更高層的 `hof-modal`(100000) 要手動開啟且有關閉鈕、`rotate-prompt`(99999) 需要 `game !== null`；
`tVerModalSkip` 先清 `tVerModalEventId` 再 commit，不會卡在視窗；輪詢降頻結論同上面 ③。

### ⑦ 守衛因這一版一併更新的三支

- `test-v6167-checkin-never-locked.mjs`（新，29 條）：另補 Fable 指出的兩個盲點 ——
  ①提示視窗的 if-chain **深度必須恰好為 1**（比「字面互斥」強，任何巢狀都 FAIL；
  原本的字面比對抓不到「語義互斥但字面不同」）；②逃生鈕 `tVerModalSkip` 納入行為端切片，
  斷言它真的送出 `/checkin`、真的關掉視窗、且**沒有**順手觸發 `hardRefreshNow`。
- `test-v6160-checkin-version-gate.mjs`：⑩ 區塊的 harness 補注入 `_tVerPrompted`。
  ⚠ 沒補的話，抽出來的函式會 ReferenceError，**而那個錯誤會被函式自己的 `catch { return false; }` 吞掉**
  ⇒ 六條斷言一起變紅，看起來像「門檻壞了」，實際是 harness 沒跟上（fail-open 的副作用）。
- `test-v6159-client-perf-instrumentation.mjs`：第 ② 條改判意圖（見上面 (a)）。

另：`oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 跟著 bump 到 `6.167`
（v6.160 守衛釘住它與 `version.ts` 一致，否則 admin 會誤發紅字警告）；
首頁 changelog 加到 51 則超過上限，最舊的 v6.095 依慣例搬進 `changelog-archive.html`。

### ⑥ 未動的部分（誠實列出）

- 後端 `server_admin_patch.js` **一行未改**（本版純 client；後端本來就不因版本拒絕報到）⇒ 不需要跑 `update-tournament.bat`。
- ⚠ **`vite build` 沒能在沙盒跑完**：這次沙盒會在約 3 分鐘處砍掉背景程序，`rendering chunks` 階段每次都被中斷。
  替代驗證：用 svelte 編譯器對改動後的 `+page.svelte` 跑 `compile(generate:'client')` 與 `'server'` **都通過**，
  且警告數與 BASE 完全相同（98 → 98，無新增）——那正是 vite build 會對這個檔做的事，也是
  「模板裡的裸 `<` `>` `{` `}` 弄壞 build」這個歷史坑的攔截點。另 `npx tsc --noEmit` 新增 TS2304 為 0、
  改動檔零錯誤。真正的 build 由 CI 的 Deploy workflow 把關（push 後看 `conclusion`）。
- v6.161 的降頻沒有調整（結論是與本次回報無關）。若站長希望「報到一開放就馬上看得到按鈕」，
  可另外把 `tPollDesiredMs` 的 lobby ④ 條件放寬成「已報名且賽事在 registration 且接近 `registrationCloseAt`」，
  但那是效能取捨，本版不動。

## v6.166 — 首頁嵌入 YouTube 最新影片（lazy facade，點擊前零播放器負擔）

站長需求：把 @ptcg-tw-sim 頻道的**最新**宣傳影片放在首頁「玩家社群 QR Code 之下、版本更新記錄之上」，
但**不能增加玩家進站的載入負擔**，原則是「勿擾民、確定要看才載入」。

頻道 channelId = `UCddJpPmz3z66MHTRpuVr17A`（從頻道頁 HTML 取得，並以 RSS 回傳的 `yt:channelId` 交叉驗證）。

### ① 為什麼不直接嵌 iframe

直接放 `<iframe src="https://www.youtube.com/embed/...">` 會在首頁載入時就把 YouTube 播放器拉進來
（約 1MB 以上的 JS、十幾個第三方請求、還會種 cookie），而這一區在版面下方、多數玩家根本不會看。
改用 **lazy facade**：先畫一張 `i.ytimg.com/vi/<id>/hqdefault.jpg` 縮圖 ＋ 純 CSS 播放鍵，
**按下去才把 iframe 換上來**（`youtube-nocookie.com/embed/<id>?autoplay=1&rel=0`）。

縮圖選 `hqdefault`（實測 17,020 bytes）而不是 `maxresdefault`（168,245 bytes）。
`hqdefault` 是 4:3、上下有黑邊，用 `object-fit: cover` 裁成 16:9；載入失敗才退 `mqdefault`。

### ② 實測負擔（vite build 前後對照，同一台機器、同一份 node_modules）

| 項目 | BASE v6.165 | v6.166 | 差 |
|---|---|---|---|
| 首頁 route node JS（gzip） | 6,238 | 7,289 | **+1,051** |
| 首頁 CSS（gzip） | 2,932 | 3,324 | **+392** |
| 未捲到／未點擊時的額外 HTTP 請求 | — | — | **0** |

- 捲到影片區時：**1 個**跨域請求 `i.ytimg.com` 17,020 bytes（`loading="lazy"`，沒捲到就不下載）
- SW install 會多預快取一份 `static/home-video.json`（117 bytes，每版一次，不在首頁載入路徑上）
- 對 YouTube 播放器的請求：**只有按下播放鍵之後才有**

⚠措辭要精確：「對 YouTube 網域零請求」只在**未捲動且未點擊**時成立 ——
縮圖的 `i.ytimg.com` 就是 Google 網域，捲近這一區時 IP/UA 就會送給 Google（該網域不設 cookie）。

### ③ 「最新影片」三個方案的取捨 —— 選 (a) 建置時抓一次

| 方案 | runtime 成本 | 站長操作 | 風險 |
|---|---|---|---|
| (a) build 時抓 RSS，編進 bundle | **0 個額外請求** | 發片後跟著出下一版即可 | build 多一次外部請求（已 fail-open） |
| (b) admin 後台手動填影片 ID | 首頁多一次 Firestore 讀取 | 每次發片都要開後台貼 ID | 忘了貼就永遠是舊片 |
| (c) Oracle 代理 RSS + 伺服器快取 | 首頁多一次跨服務請求 | 全自動 | 首頁目前**完全不依賴** Oracle，等於新增一個失敗面 |

站長的優先序是「勿擾民、不增加負擔」＞「一定要即時最新」，(a) 是唯一能做到
**玩家端對 YouTube 零 runtime 依賴**的：YouTube 掛掉、變慢、被擋，首頁都不受影響。
本站幾乎每天出版，發片之後只要跟著出下一版，影片就會自動換成最新的。

⭐**且刻意不做 runtime fetch**（初版做過，Fable 覆核時要求拿掉，查證後採納）：
這份資料建置時就定案，runtime 再抓一次換不到任何即時性，卻要多一個請求，
而且區塊會在首繪之後才插進「社群區」與「更新記錄」之間，把下面的內容往下推（＝CLS）。
改成 `import homeVideoData from '$lib/home-video.json'` 讓 vite 編進 bundle：
**首繪就決定畫不畫這一區，零額外請求、零位移。**

### ④ fail-open，而且不可以「倒退」

`scripts/fetch-latest-video.mjs` 是 `npm run build` 的第一步。初版只有兩層（RSS → repo 內舊值），
Fable 覆核抓到破口：第 N 版抓到新片 X ⇒ 站上顯示 X；第 N+1 版 RSS 掛了 ⇒ 退回 commit 裡的舊片，
**站上影片會倒退**。因此改成三個候選、取 `publishedAt` 最新者：

1. YouTube 頻道 RSS
2. 正式站現行的 `https://www.ptcg-tw-sim.com/home-video.json`（＝上一次成功發布的值）
3. repo 內既有的 `src/lib/home-video.json`（最後保底）

所以 build 會把同一份內容寫兩個地方：`src/lib/home-video.json`（給 bundle import，玩家端唯一用到的）
與 `static/home-video.json`（**玩家端不讀**，只是把「本次成功發布的值」發佈出去，給下一次 build 當備援）。

三個全部拿不到才寫空值 ⇒ 首頁整區不顯示。任何一步都不丟例外、不讓 build 失敗。
前端那一側也一樣：`videoId` 不是合法的 11 碼就當作沒有影片，元件整個不渲染。

⚠已知風險（記著，不修）：GitHub Actions 是 datacenter IP，YouTube 的 feeds 端點對這類 IP 有 429 前科；
真被長期擋住的話會停在「正式站現行值」而不會壞掉，但 console 那行 log 沒人會看到。
另外測試站與正式站是各自 build 各自抓，兩站顯示的影片有可能短暫不同。
RSS 第一個 entry 也可能是 Shorts／排程首映，那種情況縮圖在、按下去 embed 會說無法播放。

### ⑤ CLS 與手機直式

`.hv-stage` 是 `aspect-ratio: 16 / 9` 的固定比例容器，縮圖與 iframe 都 `position:absolute; inset:0`
填滿它 ⇒ 縮圖載入前後高度一樣，點擊換成 iframe 也不抽動。
⚠`.hv-stage` **刻意不設 flex**（v6.030 首頁 changelog 爆版就是把裝內容的容器設成 flex）。
手機直式：`width:100%` + `max-width:640px`，沒有任何寫死的像素寬；
`@media (max-width: 480px)` 只縮播放鍵與內距（首頁允許 `@media`，「禁用 @media 當手機開關」是針對對戰頁）。

### ⑥ 版面數量：首頁只有一套（長期記憶要更新）

記憶寫的是「首頁有新舊雙版面，改首頁兩套都要處理」——**這條已經過時**：
`v6.044` 已把 classic 版與切換鈕整套移除（見 `scripts/test-home-layout-switch.mjs` 開頭的沿革）。
本版守衛第 ⑨ 條把這件事釘住：日後若又變回雙版面，`homeLayout` / `ptcg_home_layout` /
`setHomeLayout` / `hm-switch` 任一出現就 FAIL，提醒必須兩套都補上影片區。

### ⑦ 守衛 `scripts/test-v6166-home-video-facade.mjs`（19 條）

⚠不用 grep。這支守衛**真的把元件 SSR 渲染出來**
（`svelte compile → generate:'server'` → `svelte/server` 的 `render()`），對渲染出的 HTML 下斷言：

- ① 預設狀態的 HTML **不得含 iframe**，且「會發出網路請求的資源」恰好只有 1 個（縮圖）
- ② `initiallyPlaying=true` 渲染出的 iframe，src 必須以 `https://www.youtube-nocookie.com/embed/<id>` 開頭且含 `autoplay=1`
- ③ `videoId=''` 渲染輸出必須是空字串（連空殼容器都不能留）
- ④ **template AST 祖先鏈**：iframe 必須在 `{#if playing}` 的 consequent 內、且同時在 `{#if videoId}` 內；
  facade 按鈕的 `onclick` 必須把 `playing` 設為 true —— 補上 SSR 點不到的那一段
- ⑩ 首頁**不得**出現 `fetch(...home-video...)`（擋「改回 runtime fetch」造成的請求與位移）
- ⑭ `pickNewest` 的「不倒退」語意：RSS 掛掉時要退到正式站現行值而非 repo 舊值

`initiallyPlaying` 這個 prop 只為了讓守衛能渲染出「已按下播放」的 DOM；
第 ⑧ 條反過來鎖住**首頁不得傳它**，且該條先剝註解再掃、並附自我驗證正反例。

最後有 5 條 **mutation 自我驗證**：拿刻意寫壞的元件變體（iframe 不包在 if 內／換成 www.youtube.com／
沒影片仍渲染／拿掉 `loading="lazy"`）重跑同一組檢查函式，壞樣本必須被擋下 —— 抓不到就代表守衛失效。

HEAD-FAIL 證明（BASE `53628879782c966ec338eb8063e0450a502c66cc`）：
- BASE 全樹：頂層 assert 直接失敗（`src/lib/HomeVideo.svelte` 不存在）
- 情境 A「元件都在但 `+page.svelte` 沒接線」：⑦⑩ FAIL —— 這正是「接線沒接上」那類事故
- 情境 B「接線接好但元件改成 naive 直接嵌 iframe」：①④ FAIL

### ⑧ 其他順手處理

- `scripts/test-v6101-img-retry.mjs` 的 `EXEMPT` 加 `class="hv-thumb"`：`retryImg` 是為**官網卡圖 CDN**
  寫的（切代理、加 cache-buster、套重試佔位樣式），套在 YouTube 縮圖上只會做出錯誤的代理請求；
  這張圖失敗有自己的處理（`onerror` → `mqdefault`），再失敗也只剩深色底＋播放鍵。
- `oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 跟到 6.166（`test-v6160-checkin-version-gate` 鎖住）。
- changelog.html 加第 51 則會超過 50 則上限，最舊的 v6.094 已搬進 `static/changelog-archive.html`。
- 加了 `svelte-ignore state_referenced_locally`（`$state(initiallyPlaying)` 刻意只取初值）；
  按下播放後把焦點移到 iframe（原本的 button 已離開 DOM，焦點會掉回 body）。
- 已知限制：iOS Safari 對「點 facade 才建 iframe」的 `autoplay=1` 常不生效，玩家可能要再按一次播放
  —— 這是 facade 模式的通病，不是壞掉。

## v6.165 — 站長裁定三項：①迴旋充能「這隻寶可夢」用 iid 追蹤 ②鐵壁硬殼在手動傷害路徑失效 ③自動治癒維持現狀

### ① 大電海燕ex｜迴旋充能 — 互換要真的發生，能量要附給「本體」

卡面（`static/cards/SV-P-H.json` id 10518，台灣官方中文，唯一權威）：

> 「將這隻寶可夢與備戰寶可夢互換。然後，從自己的手牌選擇最多2張「基本【雷】能量」卡，附於這隻寶可夢身上。」

**上一輪（v6.164）的診斷有一半是錯的，本輪複驗推翻**：
「`selfSwapPostInline` 開的互換 picker 被緊接著的 `withPending(hand-choose)` 覆蓋 ⇒ 互換根本沒發生」——
**不成立**。`withPending`（`_shared.ts`）在 `state.pendingSelection` 已存在時會把新的 pending
push 進 `pendingChainQueue` 排隊，`RESOLVE_SELECTION` 解完第一個之後 engine 會自動 pop。
行為端實測（完整 `applyAction ATTACK → RESOLVE_SELECTION`）：互換確實發生，順序也正確。

**真正的 bug 只有一半**：resolver `h-wave2-attach-from-hand` 把附能目標寫死成
`state.players[aIdx].active`。互換之後大電海燕ex 本體人在**備戰區**，於是 2 張基本【雷】能量
全附到「剛換上來的那一隻」。實測：本體 energy=1（只剩攻擊費用），新上場那隻 energy=2。

**修法（中央收斂）**：`_shared.ts` 新增兩支中央 helper——
- `findOwnFieldPokemon(state, idx, iid)`：依 iid 在自己場上（戰鬥位＋備戰區）找一隻，回 `{ inst, zone }`。
- `attachEnergyToOwnPokemonByIid(state, idx, hostIid, energies)`：依 iid 附能，戰鬥位／備戰區都涵蓋。

`regPost` 在**互換前**抓住本體 iid，放進 `pendingSelection.params.hostIid`；resolver 改用它定位。
舊 state（升版前已經開好的 pending）沒有 `hostIid` → fallback 回舊行為，不讓進行中的對局卡住。
找不到本體時**不動手牌**（能量不可以憑空消失）。

⭐ **通則**：凡是「跨越一個 `pendingSelection` 之後才結算」的自體目標，一律 **iid 追蹤、禁用位置**。

### ② 「picker 開了又被後續 withPending 覆蓋」這一維的掃描結果

寫了掃描器（剝註解 → 遞迴求出所有「會開 pending」的 helper 閉包 → 掃每個
`regPost/regA/regR` body 內 opener 出現次數 ≥2 者），49 個候選逐一讀 body。

結論：**`withPending` 的 queue 機制讓「覆蓋」這件事整站不存在**；真正會出事的是
**「第一個 pending 改變了盤面位置，第二個 pending 的 resolver 卻用位置定位」**。
會改變自己戰鬥位的 opener 只有 `selfSwapPostInline`（6 個呼叫點）、`tryPromptPromoteActive`、
`selfKOInstance`。逐一檢查：

| 卡 | 第二個 pending | 判定 |
|---|---|---|
| 大電海燕ex｜迴旋充能 | hand-choose 附能給「這隻寶可夢」 | **BUG（本版修）** |
| 鐵包袱｜內部噴射 | 強制對手互換（對手側） | OK（不受自互影響） |
| 遠古巨蜓｜陀螺音波／風妖精｜急速折返／音波龍ex｜狡兔三窟 | 無 | OK |
| 激流旋渦／烏栗／m6-sigana-swap | 換位本身，不再指涉本體 | OK |
| 阿羅拉 椰蛋樹ex｜嗡嗡榍石／千面避役｜擊斃／伊裴爾塔爾ex｜死亡靈魂 | KO 對手，目標帶 iid | OK |

⇒ 這一維 **outlier 只有 1 張**。

### ③ 暴噬龜｜鐵壁硬殼 — 依傷害量判定的免疫在所有手動傷害路徑失效

卡面（`static/cards/SV7.json` id 10921・H）：

> 「這隻寶可夢不會受到對手的寶可夢「200」以上的招式的傷害。」

官方裁定（`PTCG RULES/PTCG_RULES.md`，唯一權威）：
- §17.27.D L1750-1751：故勒頓ex「瘋狂衝擊」220 −「硬硬束帶」30 ＝ 190 → **可以造成傷害**
  ⇒ 判準是**減傷之後實際造成的傷害**，不是招式印刷值。
- §17.27.D L1762-1763：電燈怪「閃電伏特」140 對【雷】弱點的暴噬龜 → **不可以造成傷害**，
  「由於先計算弱點」⇒ **弱點×2 也計入**。
- §17.27.B L1730-1731：古簡蝸ex「追擊蔦」對**備戰區**的暴噬龜 → **不可以造成傷害**
  ⇒ **備戰區同樣適用**。

**根因**：`passiveImmunityDamageBlock` 以假值 `baseDamage = 1` 探測述詞（它同時服務會被
UI 預覽呼叫的 `resolveBenchGuard`，那裡拿不到真實傷害）⇒ `1 >= 200` 恆 false ⇒ 鐵壁硬殼在
**所有**手動結算傷害的路徑上永遠不成立。引擎主傷害管線（`engine.ts` 5400 附近）有傳真實
`baseDamage`，且位置正好在弱點／抵抗／防守方減傷**之後** —— 那裡一直是對的，也就是官方三條
判例都能通過的原因；漏的是狙擊／多目標／備戰 AOE／油之機關槍這些自跑傷害迴圈的路徑。

**修法（中央收斂）**：
1. `DAMAGE_AMOUNT_DEPENDENT_IMMUNITY`（逐卡宣告，目前只有「鐵壁硬殼」）。
2. `passiveImmunityDamageBlock` **跳過**表內特性 —— **行為等價**（`1 >= 200` 本來就恆 false），
   所以 **UI 預覽端（`resolveBenchGuard`）零行為變化**，並以測試釘住預期值（不得 blocked）。
3. 新增 `passiveImmunityByDamageAmount(state, actorIdx, targetCard, pool, finalDamage)`，
   前置判定（初始化消除／火箭隊的監視塔）與 `passiveImmunityDamageBlock` 完全一致。
4. 接到 5 條自跑傷害迴圈的**最終傷害算完之後、擲幣免傷與 on-damaged 之前**（鏡射引擎順序）：
   `dealAttackDamageToTarget`（狙擊／延後型，active＋bench）、`snipe-multi`、
   `clone-strike-multi-hit`、`hitBenchAll`、油之機關槍（`mega_decks.ts`）。
   flat／`skipDefEffects`（「不計算受傷寶可夢身上的附加效果」）招式一律 bypass，
   與同一段的擲幣免傷判準一致。

**為什麼不塞進 `resolveMultiTargetDamageGuard`**：那支閘在算傷害**之前**跑（要決定整個 target
跳不跳過），那時候還沒有傷害量。早於弱點判會把「110×弱點2＝220」誤判成 110 而漏擋。

### ④ 「以假傷害值探測被動免疫」這一維

全站掃 `PASSIVE_IMMUNITY` 述詞的呼叫點，只有兩處傳字面量：`passiveImmunityDamageBlock`（本版修）
與 `passiveCoinImmunity`（唯一 entry「順滑大衣」不看傷害量，無害）。其餘 hook
（`PASSIVE_DAMAGE_REDUCE*` / `TOOL_PREVENT_KO` …）都傳真實傷害。**維度乾淨。**

守衛 `test-v6165-damage-threshold-immunity.mjs` 掃 `PASSIVE_IMMUNITY` 每個述詞的**第 2 個參數名**：
不以 `_` 開頭 ＝ 有在用傷害量，卻沒登記進 `DAMAGE_AMOUNT_DEPENDENT_IMMUNITY` ⇒ FAIL。
含掃描器自我驗證（正對照：故意餵「有用／沒用／只有一個參數」三種樣本）、下限斷言、死條目檢查。

### ⑤ 瑪機雅娜｜自動治癒（站長裁定：維持現狀）

已確認 v6.164 就是 per-energy-card：`applyMagearnaHandAttachHeal` 的 `energyCardCount` 參數
→ `perCard × N`（附 2 張回 180），比照耿鬼ex｜侵蝕詛咒（官方 §17.21.F 一次附 2 張放 4 個指示物）。
測試已釘住：`test-hand-attach-percard-reaction.mjs` 兩處 90×2＝180 斷言。**本版不動。**

### ⑥ Fable 5 審查後補強（逐項自行查證過才採納）

**採納（真洞）**：
1. **`passiveImmunityByDamageAmount` 缺特性有效性 gate。** engine 主管線逐特性過
   `isAbilityHolderEffective`（含**傳說的熔岩洞**：雙方場上所有**進化**寶可夢特性全部消除），
   新 helper 原本只做 `isInitializeNullified` ＋ 監視塔。暴噬龜是 **Stage1**（查 `SV7.json`）⇒
   熔岩洞在場時鐵壁硬殼應失效，否則兩條路徑對「特性還在不在」給出不同答案。
   → helper 改收 `target: CardInstance` ＋ `opts.isBench`，迴圈內走 `isAbilityHolderEffective`。
   （舊 `passiveImmunityDamageBlock` 也有同款缺口，但它對鐵壁硬殼恆 false，這個缺口是本版才「可達」。）
2. **`bench-hit-N`（`hitBenchPickPost` 的 resolver）是第 6 條自跑傷害迴圈，漏接。**
   目前 caller 最大 130 ⇒ 今天打不到門檻、不是 live bug，仍一併接上。
3. **守衛枚舉盲點**：原掃描器只用 `applyDefenderCoinAvoid(` 當錨點且只掃 `effects.ts` ⇒
   hitBenchAll／bench-hit-N（走 `passiveCoinImmunity`）與油之機關槍（在 `mega_decks.ts`）
   永遠掃不到，「把那兩行刪掉守衛照樣全綠」。→ 改用 `_applyBenchAbilityReduce(`（每條迴圈恰好一個，
   往**後**找）＋ `applyDefenderCoinAvoid(`（往**前**找）雙錨點，跨兩檔掃，下限 ≥8，四種正對照。
4. **迴旋充能沒觸發 瑪機雅娜｜自動治癒。** `applyMagearnaHandAttachHeal` 的舊註解假設
   「攻擊型從手牌附能的攻擊者自己佔住戰鬥位 ⇒ 不可能與自動治癒共存」——**迴旋充能會先互換**，
   換上來的那一隻可以是瑪機雅娜，是該假設的例外（v6.164 的幸福禮物已是同款先例）。
   → resolver 補呼叫，per-energy-card（附 2 張回 180），測試釘住。
5. **resolver 未自驗 client 送來的 iids**（v6.009 紀律）→ 補「只認手上的基本【雷】能量」再驗一次。
6. 註解筆誤的守衛檔名修正。

**不採納（附理由）**：
- 「`dealAttackDamageToTarget` 的 `noWeakness` 應比照 snipe-multi 的 `!flat` bypass 新免疫」——
  **不改**。`noWeakness` 的卡面語意是「這個招式的傷害**不計算弱點・抵抗力**」（重磅驟雨／橄欖石音波），
  與 flat/`skipDefEffects` 的「**不計算受傷寶可夢身上的附加效果**」是兩回事；只有後者才 bypass 防禦方
  的免疫。維持現狀＝正確。
- 「declaredHost 有值但不在場時應留手牌而非 fallback 到 active」—— fallback 是為了**舊 state 相容**
  （升版前已開好、沒有 hostIid 的 pending），不加此分支對局才不會卡住；且該情境不可達。

### 守衛（皆有 HEAD-FAIL 證明）

- `scripts/test-v6165-swirl-charge-host-iid.mjs`（8 項）— 還原 v2750＋_shared 至 BASE ⇒ **5 FAIL**。
- `scripts/test-v6165-damage-threshold-immunity.mjs`（19 項）— 移除 effects.ts 的 2 個插入點
  （保留 export，證明「插入點」本身必要）⇒ **5 FAIL**。
  含：宣告表掃描器（第 2 參數名判準 ＋ 三種正對照 ＋ 死條目檢查）、傷害迴圈枚舉（雙錨點跨檔 ＋ 四種正對照
  ＋ 下限 ≥8）、UI 預覽端零行為變化的釘樁、官方三條判例的行為斷言、熔岩洞消除特性的對照。

## v6.164 — 兩個玩家回報：①「每次附能」的反應要 per-energy-card ②多目標招式對戰鬥位漏 PASSIVE_IMMUNITY

### 回報 1：耿鬼ex｜侵蝕詛咒 對「金色火焰填 2 顆火能量」只放 2 個指示物（應為 4 個）

**卡面（static/cards，台灣官方中文）**
- 耿鬼ex｜侵蝕詛咒（MC/SV5K，H 標，特性）：「只要這隻寶可夢在場上，**每次**對手從手牌將能量卡附於寶可夢身上時，在那隻寶可夢身上放置2個傷害指示物。」
- 阿響的鳳王ex｜金色火焰（SV9a/M2a，I 標，特性）：「在自己的回合時可使用1次。從自己的手牌選擇最多2張「基本【火】能量」卡，附於備戰區的1隻「阿響的寶可夢」身上。」
- 瑪機雅娜｜自動治癒（I 標，特性）：「只要這隻寶可夢在戰鬥場上，**每次**從自己的手牌將能量卡附於寶可夢身上時，將那隻寶可夢恢復「90」HP。」
- 帕奇利茲｜麻痺門牙（M1S/MC，I 標，**招式**）：「在下個對手的回合，**每次**對手從手牌將能量卡附於受到這個招式的寶可夢身上時，在那隻寶可夢身上放置8個傷害指示物。」

**官方裁定（`PTCG RULES/PTCG_RULES.md`，唯一權威）**
- §17.21.F L1511-1512：對手場上有【侵蝕詛咒】耿鬼ex 時，用支援者「菜種的活力」為 1 隻備戰附 **2 張**【草】能量 → 放置的傷害指示物為 **4 個**。
- §17.37.A L2196-2197：櫻花魚｜漸強波 造成傷害前從手牌附 **5 張**基本【水】能量 → 侵蝕詛咒放置 **10 個**指示物（該櫻花魚剩餘 HP 歸 0，但仍先結算漸強波的傷害）。
⇒ 「每次」＝**每一張能量卡各一次**，不是「每一次效果一次」。

**真因**：中央 helper `fireOnHandEnergyAttached()`（`effects/_shared.ts`）與
`applyMagearnaHandAttachHeal()`（`effects/cards/v3000_g3_wave2.ts`）都是「呼叫一次＝觸發一次」，
而所有 bespoke 附能 resolver 在附完 N 張之後**只呼叫一次**。一次只附 1 張的卡（碧綠之舞／
玉樹臨風／烈火亂舞／嫩葉之恩／吃飽先…）剛好正確，一次附多張的卡全部 under-count。
（v5.782 的記憶裡其實已經留下「gold-flame 等 bespoke handler 每次 attach fire 一次，
侵蝕詛咒對多能量可能 under-count；全站一致性另案」——本版把那個「另案」做完。）

**中央收斂**
- `fireOnHandEnergyAttached(state, attacherIdx, targetIid, pool, energyCardCount = 1)`
  ——整段反應（① OPP_ENERGY_ATTACH_PASSIVE ② 麻痺門牙）包進 `for (_rep < reps)`，
  每個 rep 重讀場面（前一次的指示物可能已造成昏厥／場面變動）。
- `applyMagearnaHandAttachHeal(..., energyCardCount = 1)`——恢復量 = 90 × 張數。
- 8 個呼叫端改傳**實際張數**（禁手刻）：
  `gold-flame`（fast-path 與 picker path 兩條都要）、`sakura-crescendo-attach`（漸強波）、
  `h-wave2-attach-from-hand`（迴旋充能）、`clamperl-bombard-attach`（返回重載）、
  經驗法則（effects.ts inline）、`v158-energy-chain` **4 處**
  （tally per-target 兩處＋「唯一合法目標全附」「singleTarget 全附」兩處，
  涵蓋 滿載心田／熱帶狂燒／莫魯貝可 等「以任意方式」型）。
- **順帶補零觸發**：信使鳥｜幸福禮物（`lucky-gift-attach`）卡面「雙方玩家若希望，各自
  **從自己的手牌**選擇最多3張基本能量卡，以任意方式附於自己的寶可夢身上」——
  整條 resolver **完全沒有** `fireOnHandEnergyAttached`（v5.782 那輪的漏網）。
  本 resolver 逐張遞迴，故 count = 1，雙方 phase 都觸發（attacherIdx 用 actorIdx）。

**為什麼不改成「必填參數」**：TS 必填會強迫 20+ 個一次只附 1 張的呼叫端一起改，
風險大於收益；改用**卡面驅動的枚舉守衛**鎖住（見下），新卡出現就會紅燈。

### 回報 2：酋雷姆｜三重冰霜 打得到戰鬥場的 厄鬼椪 礎石面具ex

**卡面**
- 厄鬼椪 礎石面具ex｜礎石之勢（MC/SV6/SV8a，H 標）：「這隻寶可夢不會受到對手的擁有特性的寶可夢招式的傷害。」
- 酋雷姆｜反等離子（SV6a，H 標）：「若對手的棄牌區有名稱中有「阿克羅瑪」的卡，則這隻寶可夢使用「三重冰霜」所需的能量，改為1個【無】能量。」
- 酋雷姆｜三重冰霜：「將這隻寶可夢身上附加的能量卡全部丟棄，對手的3隻寶可夢各受到110點傷害。[在備戰區不計算弱點・抵抗力。]」
⇒ 酋雷姆**擁有特性**（有沒有滿足發動條件無關），三重冰霜造成的是**傷害** ⇒ 礎石面具ex 應完全不受。**玩家回報成立。**

**真因**：`regR('snipe-multi')` 的守衛只呼叫 `canApplyEffectToTarget(...)`。
`PASSIVE_IMMUNITY` 這一層（礎石之勢／神秘之盾／神秘石居／神秘守護／璀璨鱗片／尾甲／
鐵壁硬殼）在**備戰側**早在 v5.367 就併進 `resolveBenchGuard`，**戰鬥位側從來沒有**；
擲幣型免疫（順滑大衣，`passiveCoinImmunity`）同樣漏。
v6.141 已經為了同型 bug（閃光屏障擋不住油之機關槍）建了中央閘
`resolveMultiTargetDamageGuard`，但只有 damage-distribute 那條接上去。

**跨卡維度掃描**：剝註解後掃全 `src/lib/game` 的 1564 個 `regR`/`regPost` 區塊，
找「手動累加 damage 且會打到 active 且沒有任何 damage-immunity helper」者，得 14 個候選，
逐一對卡面判讀後 **真 outlier 只有 2 個**：
- `snipe-multi`（三重冰霜；月亮伊布｜出奇一擊 與 鐵頭殼ex｜雙刃劍 是 `flat` 招式，
  卡面「不計算……身上的附加效果」⇒ 本來就 bypass，不受影響）
- `clone-strike-multi-hit`（甲賀忍蛙ex｜分身連打、三海地鼠ex｜三色炮、吼叫尾｜大吼大叫）
其餘 12 個是**放置傷害指示物**（attack-effect / ability-effect：手之力量／必殺手裡劍／
亂咬／腎上腺腦力／幻影奇襲／咒詛炸彈…）或換位／治癒 —— 礎石之勢那類卡面**只寫「傷害」**，
不該擋招式效果，維持原狀是正確的。

**中央收斂**
- `resolveMultiTargetDamageGuard` 加 `kind?: DamageKind`（預設 `'attack-damage'`）與
  `counterPlacement?: boolean`；**只有 `attack-damage` 才套第 1/2/4 層**
  （中立中心／PASSIVE_IMMUNITY／擲幣免疫），`attack-effect` 只走 `canApplyEffectToTarget`。
- `snipe-multi`、`clone-strike-multi-hit` 兩個 resolver 改走這支中央閘。
- ⚠ 已確認 `passiveCoinImmunity`（PASSIVE_IMMUNITY 的擲幣型 entry＝順滑大衣）與
  這兩個 resolver 原本就有的 `applyDefenderCoinAvoid`（`PASSIVE_COIN_AVOID`＝躲藏高手／
  腎上腺費洛蒙）是**兩張不同的表**，不會 double-flip。

### 守衛（皆有 HEAD-FAIL 證明）

- `scripts/test-hand-attach-percard-reaction.mjs`（10 項）：金色火焰 2 張→40／1 張→20（正對照）、
  自動治癒 90×2、漸強波 3 張→60、滿載心田集中→40 與分散→各 20、迴旋充能→40、幸福禮物→40，
  外加**卡面枚舉守衛**（regex 只認「從自己的手牌選擇…能量」＋「最多≥2張／任意數量」，
  排除「從手牌使出這張卡並完成進化時」那種來源其實是牌庫的進化特性；有 `scanned > 3000`
  下限斷言與 8 張的固定清單，新卡出現即紅燈）。
- `scripts/test-multitarget-active-passive-immunity.mjs`（7 項）：三重冰霜 vs 礎石之勢
  （戰鬥位／備戰位）、分身連打 vs 神秘石居，**外加三條正對照**——一般寶可夢仍受 110、
  神秘石居擋不住非 ex 的酋雷姆、甲賀忍蛙ex 沒有特性 ⇒ 礎石面具ex 照樣受傷（防過度免疫）。
- **HEAD-FAIL 實測**：把 9 個改過的檔全部還原成 BASE blob，
  第一支 6/10 條紅、第二支 2/7 條紅，正對照在 BASE 就是綠（證明不是「全綠假象」）。

### Fable 5 審查（v6.164）抓到、經自行查證後追加的修正

1. **【必須修，已修】官方 §17.37.A 的處理順序**：漸強波 regPre 傷害延後（damage:0）、由
   `sakura-crescendo-attach` 自己結算傷害，而原本「附能 → fire → 算傷害」的順序在
   per-energy-card 化之後，附 5 張 = 100 點指示物**必然打死櫻花魚**（HP 90）→ `active` 變 null
   → `cnt=0` → 對手 0 傷害。官方 L2196-2197 明文「**會**造成傷害／應**先處理漸強波的傷害，
   再處理櫻花魚的[昏厥]**」。已把 `fireOnHandEnergyAttached` 移到 `dealAttackDamageToTarget`
   之後。**沙盒實測**：修前 耿鬼ex 受 0 傷害且我方直接判負，修後受 150（5×30）、櫻花魚隨後昏厥。
   ⇒ 通則寫進註解：**regPre 延後傷害、自行結算的招式，若同一招還會從手牌附能，
   附能反應一律排在自己的傷害結算之後**（走 engine 主管線的固定傷害招式沒這問題）。
2. **【建議修，已修】信使鳥｜幸福禮物 漏 `applyMagearnaHandAttachHeal`**：卡面是「雙方玩家
   ……各自從自己的手牌選擇……附於自己的寶可夢身上」，對手 phase 時對手戰鬥場若是瑪機雅娜
   就該回 90 HP。
3. **【建議修，已修】`v158 startEnergyChain`（source:'hand'）整條管線從未接自動治癒**：
   4 個 hand-source 分支全補（與 fire 一起 nested 呼叫）。實害是**鴨嘴炎獸｜拍檔提升**
   （J 標**特性**，「基本【火】能量卡與基本【雷】能量卡最多**各1張**」）—— 特性型的持有者不佔
   active，瑪機雅娜可同時在戰鬥場。已補行為測試（附火+雷 2 張 → 回 180）。
4. **【建議修，已修】枚舉守衛 regex 漏「最多各N張」措辭**：補 `最多各[1-9]張`，
   清單因此多出 鴨嘴炎獸｜拍檔提升 與 烈焰猴｜火焰蹈舞（後者兩階段各 1 張、各自 fire 一次，
   本來就是 per-card 正確）。⇒ 列管卡數 8 → 10。
5. **【建議修，已修（改註解）】`resolveMultiTargetDamageGuard` 註解原本宣稱涵蓋「鐵壁硬殼」**：
   `passiveImmunityDamageBlock` 是用 `baseDamage = 1` 探測述詞（它同時服務會被 UI 預覽呼叫的
   `resolveBenchGuard`，拿不到真實傷害），所以**依傷害量判定**的鐵壁硬殼（≥200）在這條路徑
   永不成立。engine 主傷害管線有傳真實 baseDamage，那裡是對的。現行 H/I/J 沒有單次 ≥200 的
   多目標招式 ⇒ 無實害，本版只修正註解，不動架構。
6. **`anti-pattern-lint` Check G 的掃描器盲點（已修）**：它「往回找函式開頭再數大括號」的
   span 偵測，在「for 迴圈內的單行 nested 呼叫」會提早收掉 span → 對
   `fireOnHandEnergyAttached(applyMagearnaHandAttachHeal(...), …)` 這種**正是它自己建議的寫法**
   誤報。加一條「本行自己就含 `fireOnHandEnergyAttached` ⇒ 已成對」。
   **已用正對照驗證**：刻意拿掉 返回重載 的 fire，lint 仍抓得到（1 筆 [G]）。

### ⚠ 本輪順帶發現、**未在本版修**的獨立 bug（待站長裁定）

**大電海燕ex｜迴旋充能：互換其實不會發生，附能目標也可能不對**
（`effects/cards/v2750_h_wave2_full.ts:1624-1660`）
卡面：「將這隻寶可夢與備戰寶可夢互換。**然後**，從自己的手牌選擇最多2張「基本【雷】能量」卡，
附於**這隻寶可夢**身上。」
實作先呼叫 `selfSwapPostInline('迴旋充能')` 開一個 `bench-choose` picker（effectKey
`h-wave2-self-swap`），**緊接著又 `withPending(hand-choose)` 把它整個覆蓋掉** ⇒ 互換從未發生。
而且 `h-wave2-attach-from-hand` 的附能目標寫死 `players[aIdx].active`，
若互換真的修好了，能量會附給**換上來的新戰鬥寶可夢**而不是卡面指的大電海燕ex 本體。
本版只把測試斷言改成「自方場上總傷害」，**刻意不用測試固化任何一種行為**。

### 測試 fixture 的坑（記給下一輪）

`byName()` 只用卡名找卡會抓到**沒有那個招式的印刷版本**：甲賀忍蛙ex 的 MC 版只有
「變幻手裏劍」，SV5a 版才有「分身連打」→ `attackIndex` 對不上、`applyAction` 靜默不動作、
log 是空的。需要特定招式時必須帶 `attackName` 一起找。

## v6.163 — 補 v6.162 漏掉的第 5 處「90 秒」：首頁 changelog（玩家看得到的那份）

v6.162 把報到版本閘的門檻由 90 秒改成 30 秒，並同步了「90 秒」這個**說法**的四處：
`src/routes/game/+page.svelte` 的註解、`oracle-admin/admin.html` 兩處、
`oracle-admin/server_admin_patch.js` 的 v1.10 檔頭敘述。

**漏掉第 5 處**：`static/changelog.html` 的 v6.160 條目仍寫著
「或報到只剩不到 **90 秒**時，都會直接放行」。這一處和前面四處性質不同 ——
前四處是給站長／開發者看的，這一處是**玩家直接看得到的公告**，
等於在對玩家講一條錯的規則。（正式站尚未部署過 v6.160，所以還沒有玩家真的看到 90 秒的說法。）

**改法**：只把該條目裡的數字 90 → 30，**不新增 changelog 條目**
（門檻微調對玩家無感，屬於首頁規範②「玩家不需要知道的整則不放」）。
⚠ 但**仍然 bump 版本**：只改 `static/changelog.html` 而不 bump，
Service Worker 會繼續餵舊的 changelog.html（既有慣例，見本檔 v6.121 段）。
`oracle-admin/admin.html` 的 `SITE_VERSION_HINT` 一併跟到 6.163
（既有守衛斷言它必須等於 `version.ts` 的 VERSION，否則 admin 的紅字警告會誤發）。

**守衛**：`scripts/test-v6160-checkin-version-gate.mjs` 新增一條
「首頁 changelog 不得殘留『只剩不到 90 秒』且必須出現『只剩不到 30 秒』」。
v6.162 已有的那條只掃 `+page.svelte`，掃不到 `static/`。

**教訓**：改一個數字時，「說法」散落的範圍比「常數」大得多，而且
**玩家可見的那一份最容易被漏掉**——因為它不在 `src/` 也不在 `oracle-admin/`，
grep 範圍常常沒帶到 `static/`。下次做這種數值裁定，枚舉範圍要含 `static/`。

## v6.162 — 報到版本閘的「剩餘時間門檻」90 秒 → 30 秒（站長裁定）

站長裁定：**更新不需要那麼久，給玩家 30 秒去更新綽綽有餘**。v6.160 加報到版本閘時，
fail-open ③「報到剩不到 90 秒就不再提示更新」的 90 秒是憑感覺抓的保守值，實際效果是
**報到最後一分半鐘完全不擋人**——而報到通常就是最後一分鐘才擠進來的，等於這個閘在
最需要的時候形同關閉。改成 30 秒。

改動一覽（**同一個數字散在五處，這一版全部一起改**）：

| 檔案 | 位置 | 內容 |
|---|---|---|
| `src/routes/game/+page.svelte` | `tCheckinBlockedByVersion` | `_left < 90000` → `_left < 30000` |
| 同上 | 上方 `⚠⚠⚠` 註解第 ③ 條 | 「剩不到 90 秒」→「剩不到 30 秒」 |
| `oracle-admin/admin.html` | 指紋說明 `checkin-stale-deadline-near` | 「剩不到 90 秒」→「剩不到 30 秒」 |
| 同上 | ⚙️ 連線設定「🔄 報到版本閘」說明段 | 「只剩不到 90 秒時一律直接放行」→ 30 秒 |
| `oracle-admin/server_admin_patch.js` | v1.10 檔頭的 fail-open 列舉 | 「報到剩不到90秒」→ 30秒 |

⭐ 這一版真正的重點不是那個數字，是**「改了數字沒改註解 ⇒ 下一個人被註解騙」**。
`_left < 90000` 只有一處，但「90 秒」這個**說法**有四處，其中兩處是站長會直接看到的
admin UI 文字。單純 grep `90000` 只找得到一處。

### 守衛：從「grep 數字」升級成「真的跑」

原本 v6.160 的守衛是 `ok('★報到剩不到 90 秒不擋', /_left < 90000/.test(PAGE))` ——
**這種寫法實作改成幾就綠成幾，等於假綠**，它只釘住「原始碼裡有這串字」，不釘住
「門檻在那個位置真的生效」。這一版改成行為端（新增 ⑩ 區塊，7 條）：

- 把 `tCheckinBlockedByVersion` 的原始碼**原封不動抽出來**（esbuild `transform` 去掉 TS
  型別註記），注入 stub（真的 `isClientTooOld` / `recentlyHardRefreshed`、假的 `tEvents`
  / `tNow` / `tSendLobbyDiag`）後**實際執行**。
- 剩 31 秒 ⇒ 回 `true`（仍提示更新）；剩 29 秒 ⇒ 回 `false`（放行）；剛好 30 秒 ⇒ `true`。
- 放行時必須留下 `checkin-stale-deadline-near` 診斷（否則站長看不到有人踩到）。
- 沒有 `checkInDeadline` ⇒ 剩餘時間 `Infinity` ⇒ 照常提示更新。
- ⭐ **變異測試**：同一份原始碼把門檻換回 `90000` 再編一份，斷言它在「剩 31 秒」會放行。
  這條才是證明「第一條真的擋得住回退」的關鍵 —— 沒有它，第一條有可能永遠會過。
- 另加一條「註解也要講 30 秒」的文字守衛（`剩不到 30 秒還把人推去重載` 存在、
  `剩不到 90 秒` 與 `_left < 90000` 都不得殘留）。

### ⚠ 站長要知道的取捨：30 秒夠不夠？

按下「🔄 更新並重新載入」之後實際會發生的事，逐段算：

1. `hardRefreshNow()` 卸 SW ＋ 清 Cache API，最多 **2.5 秒**（有逾時保險）。
2. `location.replace` 重載 —— 這是**冷載入**：SW 剛被卸掉、Cache API 剛被清空，
   所有 chunk 都要重新走網路。手機 4G 下不是「十幾秒」就一定回得來。
3. 回來以後還要**等 Firebase auth 還原**才會顯示賽事卡與「✋ 我要報到」。
4. ⭐ **重載不會自動幫他報到**（v6.160 的設計，重載後版本才是新的，玩家自己再按一次）
   ⇒ 還要加上他「看到頁面、找到按鈕、點下去」的反應時間。

也就是說 30 秒的預算裡，真正屬於「等網路」的其實只有 20 幾秒。順帶一提，
`recentlyHardRefreshed` 的「剛更新過」時間窗是 **10 分鐘**，註解寫的理由正是
「重載＋重新登入可能要好一會」—— 那個 10 分鐘與現在的 30 秒是同一件事的兩種估計。

**但這不會把人鎖在賽外**：就算他真的來不及，v6.160 的逃生口全都還在 ——
視窗上永遠有「先不更新，直接報到」（一按就直接送 `/checkin`，零等待），後端也
**永遠不會**因為版本拒絕報到。最壞情況是「他按了更新、沒趕上，這一場沒報到」。
⇒ 30 秒是站長的裁定，已照裁定實作；若日後真的收到「按了更新結果報不了到」的回報，
第一個要調的就是這個數字（單一常數 `_left < 30000`，守衛 ⑩ 會跟著要改成新值）。

### 部署

`src/` 有改 ⇒ 測試站自動部署；`oracle-admin/` 兩檔有改（都只是說明文字）⇒ 正式站要跑
`update-admin-full.bat`。**沒有動任何卡效果／引擎／`server-engine`**，
`update-tournament.bat` 這一版不是必要的（照例三支一起跑最省事）。

## v6.161 — 「沒有在對戰的人」大廳輪詢降頻（3 秒 → 9 秒，背景 21 秒）

**問題**：40 人賽打到第四輪時，出局／輪空／本輪已打完的玩家逐輪累積，
卻仍以「對戰中」的頻率在輪詢：`/event` 3s、`/chat` 3s、`/bracket` 9s。
這正對應玩家回報的「人多、輪次靠後才卡」。

**改法**：沒有新寫一份節奏判準 —— 在 v6.148 就已收斂的中央述詞 `tPollDesiredMs`
加第二個參數 `mode: 'battle' | 'lobby'`（預設 'battle'，既有兩個呼叫點完全不動）。
大廳輪詢同時把 v5.637 的 `_tPollTick % 3` 輪數計數器改成時間判準
（與 v6.148 對戰端同一套做法：base tick 固定 3 秒，實際間隔由中央述詞決定）。

lobby 分支的五條判準（順序有意義，全部 **fail-open**）：
1. `_tEventOkAt <= 0` 或距離上次 `/event` 成功回應 > 30 秒 ⇒ **3000**（判斷不出來）
2. `_tLobbyResumeAt` 在 60 秒內 ⇒ **3000**（剛輪次推進／剛回前景／剛進大廳）
3. `tMyMatch` 非空 ⇒ **3000**（伺服器的 myMatch 查的是 status ≠ done 的本輪對戰，
   是權威資料；這是「還沒進場」那群最不能降的人）
4. 已報名且該賽事在 `checkin` / `bracket_ready` ⇒ **3000**
5. 其餘 ⇒ **9000**（背景分頁 **21000**）

**為什麼這不會害人被判未進場**（最大的風險，逐條查證）：
- 最壞多晚 6 秒（9s − 3s）發現輪次推進；而伺服器端 `roundCountdownMin` 預設 **3 分**
  休息倒數、`noShowMin` 預設 **5 分**遲到容許（oracle-admin/server_admin_patch.js 的
  `/event` 與 scheduler 未進場判負都讀這兩個值），共 480 秒 ⇒ 6 秒佔 1.25%。
- 伺服器 scheduler 的 v0.85 推播②「本輪可進場」**已經涵蓋「下一場開始了」**：
  `enterOpenAt` 一到就對尚未進場者 `sendPushToUids`（標題「第 N 輪可進場｜對手：X」，
  以 `enterPushedAt` 原子搶占去重）。所以這一版**不加任何新推播**。
- 一般對戰頁的跨房提醒 `tAlertPollTimer` 本來就是 30 秒一次 —— 大廳的 9 秒還比它快很多。

**不影響今晚 probe 量測的可比性**：只改 client 送請求的**頻率**，
端點行為、盤面同步邏輯、回應內容一行都沒動。probe 量的是單發請求的往返時間，
負載降低只會讓它持平或變好、不會變差（這也正是這一版想驗證的事）。

**Fable 5 審查抓到、已修的一項**：三個節奏錨點都用牆鐘 `Date.now()`，
NTP 或使用者把系統時間**往回**校時，`_now - 錨點` 會變成負數 ⇒ `/event` `/chat` `/bracket`
三支一起停發，最壞停到牆鐘追上來為止 —— 舊版每個 tick 無條件送、沒有這個弱點。
⇒ tick 開頭補一條：任一錨點跑到「未來」就走 `tLobbyResume()` 重錨（fail-open），
並加了對應守衛（把牆鐘往回撥 10 分鐘，斷言下一個 tick 就要送出）。

**Fable 5 指出、不改程式但要講清楚的一項**：今晚在賽中量到的 RTT 是
「v6.161 的賽中 RTT」。機制上不受影響（probe 是單發請求，`tApi` 量測管線一行沒動），
但這一版本來就會削掉輪次尾段的無效負載 ⇒ 數字若變好，**分不出**是隧道本來就沒問題、
還是這一版把負載遮掉了。今晚的量測請定位成「驗證解方」，不要用來回推 v6.160 的病因；
若要診斷病因，需要同時記伺服器端各端點的請求數作對照。

**守衛** `scripts/test-v6161-lobby-poll-downshift.mjs`（已進 npm test 鏈）。
⚠ 它**不是**只驗字串：把 `tPollDesiredMs` 的原始程式碼從 .svelte 切出來、
用 esbuild 剝掉 TS 型別後**實際跑起來驗回傳值**；大廳 setInterval 的回呼也同樣切出來
跑 30 個 tick，**數實際發出了幾發請求**（「有呼叫某函式」≠ 那件事發生了）。
正對照：對戰／觀戰的回傳值（800 / 1200 / 2000 / 6000 / 10000 / 12000）必須一字不改。

**已知缺口（本版刻意不動）**：推播只在 `enterOpenAt` 那一刻發一次，
而且要玩家已訂閱 web-push；沒訂閱的人仍只能靠大廳輪詢發現。
那仍在 480 秒的預算內，但若日後要把降頻拉得更大，必須先補上這個缺口。

## v6.160 — 錦標賽「報到」的 client 版本閘（提示更新，但絕不擋人）

站長：「有辦法在錦標賽報到的時候，強制玩家去更新版本嗎？是否能把首頁那個強制更新版本的
按鈕功能，一起套用到報到這邊？」

動機：監控顯示線上仍有停在 **v6.141 / v6.144** 的 client（現行 v6.159）。他們的 Service
Worker 卡住舊 bundle ⇒ 拿不到任何修正，而且**會拖累對手**（一台舊/慢 client 讓對戰雙方都覺得卡）。
報到是最好的攔截點：比賽還沒開始，重載零代價。

### ⚠⚠⚠ 這一版的核心紀律：唯一的失敗模式是「把玩家鎖在賽外」
報不了到 ＝ 那場比賽他打不了。所以每一條路徑都 fail-open，站長裁定「本站是練習站，
**可用性優先於版本一致性**，寧可放一個舊 client 進來，也不要把人擋在賽外」。
具體四條：
1. **絕不自動重載** —— 重載後版本仍舊 ⇒ 無限重載迴圈 ⇒ 那位玩家永遠報不了到。
   一律跳視窗、由玩家自己點。守衛直接斷言「判定函式裡不得出現 `hardRefreshNow(`」。
2. **更新過一輪仍太舊 ⇒ 不再擋**，並記一筆 `checkin-stale-after-update` 診斷。
3. **報到剩不到 90 秒 ⇒ 不擋**。按更新要重載＋重新登入，整輪十幾秒；剩不到 90 秒還把人
   推去重載，等他回來 `ev.status` 已不是 `checkin`、後端回 409 ⇒ 等於我們親手害他報不了到。
4. 視窗上永遠有「先不更新，直接報到」的逃生口。

### 沿用既有實作：清快取收斂成全站唯一一份
新增 `src/lib/hard-refresh.ts` 的 `hardRefreshNow()`（卸 SW → 清 caches → `Promise.race`
2.5 秒逾時保險 → 帶 `_v=<ts>` `location.replace`）。原本站上其實有**三份**：
- `src/routes/+page.svelte` 的 `hardRefresh()`（首頁那顆鈕，v5.197/v5.909，最完整的一份）
- `oracle-admin/admin.html` 的 `hardReloadAdmin()`（v1.60，另一個 repo 面向，維持原樣）
- ⭐ `src/routes/game/+page.svelte` 的 `hardReloadBrokenReg()`（v5.991「特性註冊不完整」自救鈕）
  —— 這份**少了 2.5 秒逾時保險、且用 `location.reload()` 沒有 cache-bypass**，偏偏它正是
  「特性按鈕靜默消失」時玩家唯一的自救管道。一併收斂。

### ⭐ 版本比較是「十進位小數」，不是 semver 段落
`version.ts` 的規則明寫小更新 +0.01、大更新 +0.1、重大 +1，歷史上真的出現過 `1.09` → `1.1`。
照 semver 逐段當整數比會得到 [1,9] > [1,1] ⇒ **判反**。
⇒ `isClientTooOld()` 把 minor **右側補 0 到等長**再當整數比（不用 parseFloat，避開浮點誤差）：
`'6.9' vs '6.159'` → `900 vs 159`；`'1.09' vs '1.1'` → `09 vs 10`；`'10.0' vs '6.159'` 先比 major。
⭐ 正面副作用：Mongo 若把門檻存成數字，`String(6.150)` → `'6.15'`，而兩者在本語義下**相等**
⇒ 尾隨零遺失不會讓門檻靜默降級。
⚠ 解析不出來（空字串、`'6.'`、`'.9'`、三段式、超長、非字串）一律回 `false` ＝ 不擋。

### 「剛更新過」的訊號：URL 的 `_v=`，**不是** sessionStorage
Fable 5 審查抓到的鎖死路徑：Safari 無痕／儲存被政策關閉時 `sessionStorage.setItem` 會 **throw**，
而逃生鈕若把 setItem 放第一步，那一 throw 就把「先不更新，直接報到」整條路徑打斷 ⇒ 玩家被鎖在賽外。
⇒ 改讀 `hardRefreshNow()` 本來就會加的 `_v=<timestamp>`（10 分鐘窗）。讀 URL 不會 throw、
不需要權限、清快取也清不掉它。整個版本閘**零 Web Storage 依賴**，守衛明文鎖住這件事。
⚠ 未來時間戳也放行 —— 這個述詞回 true ＝ 不擋人，寬鬆的一邊才是安全的一邊。

### 後端（`server_admin_patch.js` v1.10）
- 新灰度旗標 `tournamentConfig._id='minClientVer'` `{enabled, min}`，`minVerConfig()` 10 秒 TTL，
  完全比照 `lpConfig()` / `redactEnabled()` 的慣例（只有明確 `true` 才算開、寫入後 `_mvCfgAt = 0`）。
  **預設 `enabled:false` 且 `min:''`** ⇒ 沒設定不擋任何人。
- `/event` 回 `minClientVer`（關閉時回空字串）。⚠ 改門檻最長 ~13 秒生效（10s TTL ＋ /event 3s 共用快取）。
- `/checkin` 收下 `ver` 寫進 reg doc 的 `clientVer`。**永遠不因版本回 4xx** —— 在後端加 gate
  等於製造「玩家自己救不了自己」的死路。守衛直接斷言 `/checkin` 區段裡 ver/clientVer 附近沒有 `res.status(4`。
- admin `GET/POST /api/tournament/admin/minclientver`；啟用但沒有有效門檻回 400（不可靜默假開）。

### ⚠⚠⚠ 最重要的限制：門檻**只對 v6.160 以上的 client 生效**
擋人的判斷寫在 client，而 v6.159 以下的 bundle 根本沒有那段程式碼、也不會送 `ver`。
⇒ 這一版**擋不到現在那些 6.141/6.144 的人**，它是給「下一次」用的基礎建設。
⭐ 唯一能識別他們的訊號：`/checkin` 沒帶 `ver` ⇒ 記成 `clientVer: 'pre-gate'`。這是這一版
真正立刻有用的東西，別把它拿掉。

### ⚠⚠ Cloudflare / Service Worker：這顆鈕到底有沒有用？（實測）
`curl -I https://www.ptcg-tw-sim.com/…`：
| 資源 | 結果 | 判讀 |
|---|---|---|
| `/`、`/game`、`/tournament`（含帶 `?_v=`） | `cf-cache-status: DYNAMIC` | Cloudflare **不快取 HTML** ⇒ 重載一定拿得到最新 HTML ⇒ **這顆鈕是有效的** |
| `/_app/immutable/*` | `max-age=31536000`、`HIT` | 檔名含 content hash，新版是新檔名 ⇒ 正確且無害 |
| `/service-worker.js` | `HIT`、`max-age=14400`、實測 `age: 2425` | ⚠ **邊緣快取 4 小時** |

⇒ 結論：**按了有效**。清 SW ＋ HTML 走 origin ＋ chunk 是新 hash，當下那次載入必定拿到新版。
⚠ 但 `/service-worker.js` 4 小時的邊緣快取代表：重載後重新註冊到的 SW 腳本可能是最多 4 小時前
那一版 build 的。而 `/tournament` 是 `prerender = true` ⇒ 它在 SW 的 `PRECACHE` 名單裡
⇒ SW 對它是 **cache-first**（不是 network-first —— 這點審查時被誤判過，已用 `service-worker.ts`
第 114~120 行複驗）。這正是玩家日後再度變舊的來路。
⇒ **根治要在 Cloudflare 對 `/service-worker.js` 設 bypass cache 的 Cache Rule（站長端操作）**，
client 端沒有任何寫法能繞過邊緣快取。

### 守衛
`scripts/test-v6160-checkin-version-gate.mjs`（57 條，**HEAD 52 FAIL**），已進 npm test。
版本比較與「剛更新過」是**行為端**斷言（esbuild 轉譯真模組、跑真輸入），只有接線用結構掃描。
⚠ 模組不存在時不讓守衛以 ENOENT 爆掉 —— 「還沒做」要看起來像測試沒過，不能像測試環境壞了。

### Fable 5 審查（逐項複驗後採納）
| # | 指出 | 複驗結果 |
|---|---|---|
| P1 | 門檻只對 v6.160+ 生效，擋不到現在那批人 | **屬實**，已改預設 `min:''` ＋ 補 `pre-gate` 訊號 ＋ 寫進文件 |
| P2 | `sessionStorage.setItem` 會 throw ⇒ 逃生口壞死 | **屬實**，改用 URL `_v`，整層 Web Storage 拿掉 |
| P3 | 主張「SW 對 HTML 是 network-first，不會釘住舊版」 | ⚠ **反駁**：`/tournament` 是 `prerender = true` ⇒ 在 `PRECACHE` 內 ⇒ **cache-first**。已複驗 `+page.ts` 與 `service-worker.ts` |
| P4 | Mongo 存數字會讓 `6.150` 變 `6.15` | 屬實但**十進位語義下兩者相等**、不會降級；仍加 regex 驗證擋垃圾 |
| P5 | 報到快截止時叫人去更新＝害他報不了到 | **屬實**，加 90 秒門檻 |
| P6 | 診斷指紋語義混淆 | 屬實，拆成 prompted / skipped / stale-after-update / deadline-near 四種 |
| P8 | admin 誤填超高版本 | 架構上安全（不會鎖人），加現行版本對照與紅字警告 |

### ⚠ 部署
動到 `src/**` ⇒ 網站本體照常出版；另動到 `oracle-admin/server_admin_patch.js`（**`redeploy-oracle.bat`**）
與 `oracle-admin/admin.html`（**`update-admin-html.bat`**）。三支 bat 一律由站長自己跑。

## v6.159 — 只加量測，不做效能修正：把「網路慢」和「主執行緒慢」分開量

> ⚠ **這一版刻意不修任何東西。** 錦標賽的 lag 修了十幾版都沒處理好，
> 每一版都在修伺服器，而伺服器端指標一直是全綠的 —— 我們連續多版憑假說出手都沒中。
> 本版唯一的目的：**讓下一場賽事的數據能決定性地分辨「網路慢」vs「client 主執行緒慢」**。
> 不重構 `tAdopt`、不改輪詢、不改 Svelte 結構、不新增任何自動回報觸發條件。

### 為什麼懷疑是 client 主執行緒（Fable 5 診斷）

1. `tAdopt`（`src/routes/game/+page.svelte`）每次同步把**整棵全新的 JSON 樹**指給 `game`
   ⇒ 物件同一性整批換掉 ⇒ Svelte 無法細粒度更新 ⇒ **每次版本變動＝整個盤面全量重繪**。
   本機對戰因為引擎有結構共享沒這問題，**只有錦標賽路徑缺這優勢**。
2. v6.151 加的 `rtt` 是從 `tApi` **進函式**起算的 —— 它**包含**
   `await firebaseUser.getIdToken()`、`res.json()` 解析、以及 await 續行還要排隊等主執行緒空檔。
   ⇒ 它從來就不是純網路時間，我們一直誤讀它（把「主執行緒塞住」讀成「網路慢」）。
3. 旁證：2026-08-10 賽事的 RTT 表，多數玩家中位數 0.2~0.8 秒、少數 3~7 秒
   ⇒ **per-裝置**成因，不是共用基礎設施。

### 加了什麼（全部併進**既有**的 `/clientdiag` 管線，沒有新開第二條）

`payload.perf`（新區塊）與 `payload.env` 的兩個新欄位：

| 欄位 | 量的是什麼 |
|---|---|
| `perf.api.tok` | `await firebaseUser.getIdToken()` 的耗時 |
| `perf.api.net` | `fetch` 送出 → response **header** 回來 |
| `perf.api.dl` | `res.text()`：body 下載（**網路吞吐量**）|
| `perf.api.parse` | `JSON.parse`（**純主執行緒 CPU**）|
| `perf.api.total` | `tApi` 函式總耗時（前四段 ＋ 等主執行緒空檔）|
| `perf.adopt` | `tAdopt` 自己的同步執行時間 |
| `perf.paint` | `tAdopt` 開始 → 下一個 animation frame（**重繪成本的代理指標**）|
| `perf.lt` | 最近 60 秒 longtask 的數量／總時長／最長一筆 |
| `env.hc` / `env.dm` | `navigator.hardwareConcurrency` / `navigator.deviceMemory` |

五段與 adopt/paint 全部沿用 v6.151 `rtt` 的**同一組** p50/p95/max 與 30 筆滾動窗
（`_sampleStats` / `_pushSample`）—— 各寫一套必然漂移，admin 端也就沒辦法用同一種讀法判讀。
`_rttStats()` 改成呼叫 `_sampleStats(_rttSamples)`，行為不變（樣本本來就是整數毫秒，`round` 是 identity）。

### ⭐⭐⭐ Fable 5 審查抓到的兩個「會做出相反結論」的坑（都已修）

**① `fetch` 在 header 到達就 resolve —— body 下載其實落在 `res.json()` 裡。**
我第一版把 `res.json()` 整段當成「解析」。實測（本地 http server 故意分兩段送 body）：
`fetch` 62ms / `res.json()` 298ms —— **body 傳輸時間確實在 `res.json()` 那一段**。
⇒ 行動網路 + 大盤面時，「解析」欄會被**下載時間**灌爆，而「網路」欄反而很小，
而 admin 說明寫著「解析＝發生在玩家自己的裝置上」 ⇒ 會把**網路慢誤診成裝置慢**，
正好與這一版唯一的目的相反。
**修法**：改成 `const _txt = await res.text(); … JSON.parse(_txt)`，
把「下載 body（網路）」與「純 `JSON.parse`（主執行緒）」拆成兩段。
規範上 `res.json()` 就是 UTF-8 解碼後再 `JSON.parse`，壞 JSON 一樣丟 `SyntaxError`
一樣落到同一個 catch ⇒ **行為等價**，拆開的唯一理由就是量測。

**② `tApi` 是所有端點的共同入口 —— 長輪詢會 by design 毒化「網路」欄。**
`/state?…&wait=1`（v6.152 灰度）伺服器**刻意把請求掛起最多 25 秒**（client 逾時放寬到 30 秒）。
記進去的話 `api.net` 的 p95 會 by design 變成 ~25000ms ⇒
「網路欄大＝真的網路慢」立刻變成假訊號，而下一場賽事正好可能開這個灰度實測。
大廳端點（`/chat` `/event` `/bracket` `/leaderboard`…）也不是對戰熱路徑，混進來只會稀釋。
**修法**：`_tRecordApiSegments` 加路徑閘 —— 帶 `wait=1` 一律不記；
只記 `/action` 與**短輪詢**的 `/state`。
⚠ 因此 `perf.api.*` 涵蓋「動作 ＋ 短輪詢」，而 `poll.rtt` 只涵蓋動作，**兩者不可直接相減**
（admin 說明已寫明）。

另外採納的三項（都是 Fable 5 抓到的）：
- admin 的長任務欄，**舊 client**（整包沒有 `perf`）原本也顯示「不支援」，
  與說明「不支援＝那台是 iPhone/Safari」直接衝突 ⇒ 站長會把舊版 client 誤讀成 Safari 裝置。
  改成：沒有 `perf` → 「—」；有 `perf` 但 `lt` 是 `null` → 「不支援」。
- `tLeaveMatch` 補清 `_paintPending`（離場瞬間的在途 rAF 會把上一場尾端那筆推進下一場）。
- 欄位變多（表格 13 欄）⇒ 外面包一層 `overflow-x:auto` + `min-width`，窄螢幕不爆版。
- admin 判讀說明補一句：**主執行緒忙的時候「網路」「下載」也會跟著變大**
  （每個切點都是 await 續行），所以看到「網路」大要**同時看「長任務」「重繪」**再下結論；
  以及「重繪」本來就有一個 vsync（8~16ms）的底線。

### 量測本身不可以變成負擔（這一版最需要小心的地方）

- **longtask 共用既有那顆 observer**（v5.350 的主執行緒卡死偵測器），**沒有新開第二顆**。
  多開一顆 PerformanceObserver 等於替主執行緒再加一份回呼負擔，而本版整個重點就是量主執行緒。
- **rAF 防重入**：`_paintPending` 保證同時只掛一個 rAF。
- **背景頁籤完全不排 rAF**（背景時 rAF 根本不 fire），且用 `_visSeq` 代次把
  「期間切過背景」的樣本丟掉 —— 否則量到的是「切回前景的等待時間」不是重繪成本。
- 計時只是 `performance.now()` 相減：沒有 await、沒有物件配置、沒有任何分支改變。
  `tApi` / `tAdopt` 的控制流程與 v6.158 逐字相同。

### ⚠ Safari/iOS 沒有 longtask —— 而且 `observe()` 不會 throw

`PerformanceObserver` 在 Safari 存在，但 `longtask` 不在它的 `supportedEntryTypes` 裡，
而 `observe({ entryTypes: ['longtask'] })` 對不支援的 entryType **只在 console 警告、不 throw**。
⇒ **絕不可以用「observe 沒爆」當支援判據**，那會把整批 Safari 使用者誤記成
「主執行緒完全沒有長任務」（假綠）。唯一可信的判據是 `supportedEntryTypes`；
查不到就保守當作不支援，回報 **`null`（不是 0）** —— 0 會被判讀成「這台裝置很順」。

### payload 大小

伺服器端 `/clientdiag` 有 **2048 bytes 的 cap**（`JSON.stringify(req.body).slice(0, 2048)`），
超過會截斷成無法 `JSON.parse` 的字串 ⇒ **連既有的 rtt 一起讀不出來**。
實測最壞情況：v6.158 是 827 bytes，v6.159 是 **1257 bytes**（新增 430），餘裕 791 ⇒ **不必動 cap**。
⚠ cap 是 `slice(0, 2048)` ＝**截斷不是拒收**：一旦超標整筆會變成壞 JSON，
admin 端 `JSON.parse` 失敗 ⇒ 該筆從統計裡**靜默消失**（連既有的 rtt 一起讀不到）。
以後再加欄位務必先重算。

### admin「📡 監控」分頁

往返時間表格右邊加 8 欄：網路／下載／權杖／解析／採納／重繪／長任務／裝置，
外加一段**寫給站長的判讀規則**。伺服器端 `/api/tournament/admin/clientdiag`
把 `perf` / `env.hc` / `env.dm` 一併帶出來，**缺欄一律正規化成 `null` 而不是 undefined**
（undefined 會被 `JSON.stringify` 整個吃掉，顯示端就分不出「舊 client」與「這欄真的是 0」）。

⚠ **舊 client 的 payload 沒有這些欄位** ⇒ 顯示端 `monPerfCells()` 對 undefined / null /
半殘物件一律回「—」或「不支援」，守衛餵五種殘缺 payload 實跑並斷言不 throw、`<td>` 欄數不變。
表頭 `<th>` 數與資料列 `<td>` 數有對帳斷言（欄數不對＝整張表格錯位）。

### 下一場賽事怎麼讀這些數字（判讀規則）

- `api.net`（到 header）或 `api.dl`（body 下載）**大** ⇒ 真的是**網路／隧道**。
- 這兩者**小**，但 `api.parse` / `api.total` / `adopt` / `paint` / `lt` **大**
  ⇒ 瓶頸在**那台裝置的主執行緒**，**再修伺服器不會有任何效果**。
- `api.total` 遠大於 `tok + net + dl + parse` 的和 ⇒ 差額就是「await 續行在排隊等主執行緒」。
- ⚠ 每個切點都是 await 續行 ⇒ 主執行緒被長任務佔住時 `net`／`dl` **也會被灌水**。
  所以「網路欄大」**不可以單獨當結論**，要同時看 `lt` 與 `paint`。
- `paint` 大而 `adopt` 小 ⇒ 成本在 Svelte 重繪（＝`tAdopt` 全新物件樹那個假說），
  這就是「該不該重構 `tAdopt`」的決定性證據。
- `lt` 是 `null` ＝ 那台是 Safari/iOS，**不是**「沒有長任務」；改看 `paint`。
- 欄位是「—」＝那位玩家的畫面還是 v6.159 以前的版本。

### 守衛

`scripts/test-v6159-client-perf-instrumentation.mjs`（107 條，已進 `npm test` 鏈）。
⚠ 刻意**不只驗字串存在**（v6.154 的教訓：22 條守衛全綠、分頁卻打不開）：
七個新量測函式用 esbuild 轉成 JS **實際執行**，驗五段入帳、**長輪詢與大廳端點不入帳**、
滾動窗 30 筆、壞樣本不入帳、Safari 回 null、窗外樣本被濾掉、rAF 防重入、
可見性代次丟樣本、觀戰者不記；
admin 顯示端與伺服器端的正規化也都是**實跑**。否定型掃描先剝註解並自我驗證。
對 v6.158 原始碼跑：**32 FAIL**（HEAD-FAIL 證明）。

### 部署

**不影響對戰邏輯**，但 `oracle-admin/server_admin_patch.js` 與 `oracle-admin/admin.html`
都有改 ⇒ 需要 `redeploy-oracle.bat` ＋ `update-admin-full.bat`。
`update-tournament.bat` 本版沒有新的必要性（沒動 engine／卡庫），但 v6.157 那次仍未跑的話要補。

---

## v6.158 — setup「誰該動作」單一判準 ＋ 開局全螢幕遮罩不再擋住該動作方

> ⚠ 本版只動 **client**（`src/routes/game/+page.svelte`）與 admin 監控說明。
> `oracle-admin/server_admin_patch.js` 完全沒動 —— v6.157 的 `update-tournament.bat` 仍必須跑。

### 事故資料（2026-08-10 賽事，線上跑的是 v6.156，v6.157 尚未部署）

監控 24 小時：`stale-version` 75 次/33 人、`setup-watchdog-repeat` 64 次/36 人、
`slow-rtt` 25 次/15 人（RTT 表 20 筆裡 14 個不同玩家 p95 ≥ 3 秒，3.1s~11.8s，橫跨 21:08~22:56）。

兩間房完全同簽名的「開局卡住」指紋：

```
ver 6.156  mySeatIdx 1
tVersion=1, phase=setup, setupDone=[false,false],
pendingMulliganDraw=[2,0], mulliganRevealConfirmed=[false,true],
actorSeat=-1, selfPending="setup-not-done", rtt=null
```

### 實跑查證（不是讀碼推論）

把 `oracle-admin/server_admin_patch.js` 的 `currentActorSeat`（L3314）用 `new Function` 抽出來，
餵這兩組盤面：

| 盤面 | 伺服器 currentActorSeat | client `setupActorSeat` | client `tCurrentActorSeat`（診斷用） |
|---|---|---|---|
| pmd=[2,0] mc=[0,2] | **0** | 0 | **-1** |
| pmd=[1,0] mc=[0,1] | **0** | 0 | **-1** |

`mulliganCounts` 由引擎公式反推：`engine.ts` L2231 `pendingMulliganDraw[0] = max(0, m2-m1)`、
L2225 `mulliganRevealConfirmed = [m2===0, m1===0]` ⇒ `pmd=[2,0]` 且 `mrc=[false,true]`
唯一解就是 `mulliganCounts=[0,2]`（座位 1 重抽 2 次）。依 PTCG 規則 mulligan 較少方先放，
所以**正解是座位 0**，`actorSeat=-1` 不是伺服器的判斷。

⇒ **三個結論**：

1. **`actorSeat=-1` 是 client 診斷自己算錯的**。payload 用的是 `tCurrentActorSeat`
   （v5.569 舊副本，setup 只看 `setupDone`，雙方都沒完成就一律 -1）。
   它同時是 v6.151 倒數方向的 fallback。**修法：setup 分支直接呼 `setupActorSeat`**
   （那一份與伺服器逐行同步）。守衛用 896 組 setup 狀態做三方等價比對。
2. **`selfPending='setup-not-done'` 是假陽性**。回報者是座位 1＝重抽較多方，
   `engine.ts` L2605 的 `PLACE_ACTIVE` gate（`myMul > oppMul && !setupDone[oppIdx]`）
   本來就擋著他 ——「規則叫他等」不是卡住。`_setupSelfPending` 改成先問 `setupActorSeat`：
   actor 不是 -1 且不是我 ⇒ 回 null。這會把 64 次裡的一大塊直接消掉。
3. **真 bug（v6.158 主修）**：`{:else if ... pendingMulliganDraw?.[oppIdx] > 0 && mode==='online' ...}`
   那一層「⏳ 等待對手決定補抽」是 `.selection-overlay`（`position:fixed; inset:0; z-index:100`）。
   `pendingMulliganDraw[對手]` 在 **makeGame 當下就已經 > 0**，所以重抽方整個開局都被蓋住；
   等對手按下【準備完成】，`setupActorSeat` 就指向重抽方了（`sd=[true,false]`、`m=[0,2]` ⇒ 回 1），
   遮罩卻還在 ⇒ **他什麼都按不到，而伺服器同時在倒數判他閒置敗**。
   修法：加 `&& setupActorSeat(game) === oppIdx`。文案也改成對手真正卡在哪一步
   （舊文案不論如何都寫「正在決定是否多抽」，但那時候對手其實還在選出場寶可夢）。

### 未定位（誠實列出）

「兩間房 tVersion 都停在 1 超過 60 秒」這件事，**從這兩筆指紋無法斷定伺服器端有 bug**：

- 兩筆都來自座位 1（正在合法等待的一方），`rtt=null` 是「等待方本來就不送動作」的必然結果，
  不能當成「送不出去」的證據。
- 座位 0 那一側的 UI 實查過**沒有任何遮罩**（補抽視窗要 `mrc[0]===true`、揭示視窗要 `setupDone[0]`，
  兩個在這個盤面都不成立），`isMyTurn()` 也是 true ⇒ 座位 0 是**能動作的**。
- 最省事的解釋是座位 0 尚未進場／人不在，而那正是 3 分鐘閒置判負該處理的情境。
- ⇒ 需要下一場帶著 v6.158 新增的 `srvActor` / `sinceLastAction` 欄位再看一次。

### `stale-version` 門檻（同一類雜訊）

舊判準＝看門狗連續觸發 3 次且版本沒動。實際換算：playing 門檻 20 秒 + 節流 8 秒 × 2
⇒ **盤面只要 36 秒沒動就報**，而且雙方的 client 會各報一次。對手長考 40 秒完全符合。
75 次/33 人（還受「每頁 3 發」與伺服器 per-uid 60 秒節流壓過）就是這個量級。
⇒ 門檻拉齊 v6.155 的 setup 指紋（60 秒），並在 payload 補
`srvActor`（伺服器權威該動作座位）、`sinceLastAction`（伺服器上多久沒人動作）、`longPoll`，
下一場才分得出「對手在長考」與「真的卡住」。admin 監控的說明同步改寫。

### slow-rtt 的判斷（量測 vs 假說）

- **已量測（client 端）**：`_tRecordRtt` 記的是 `POST /action` 的完整往返，
  只記成功的樣本。20 筆裡 14 個不同玩家 p95 ≥ 3 秒、橫跨整場 ⇒ 依既有判準**不是個別玩家的網路**。
- **已排除**：長輪詢佔用連線 —— 當下只掛著 6 條／3 房，`_lpWait` 的保險輪詢是
  `pollMs`（預設 1500ms）一次的 `findOne` + projection version，6 條 ≈ 4 q/s，量級不對。
- **仍是假說（本次無法量測，沒有 VM 端存取）**：cloudflared 隧道排隊、VM CPU（gzip + 每次
  `/action` 都整份 `gameState` 讀寫）、Express event loop 被定時掃描搶走。
  要證實需要在 VM 上量 `/action` 的 handler 內耗時 vs 端到端耗時的差；**本版沒有做這件事**。

### Fable 5 審查後追加的兩項（它抓到、我逐行查證過才採納）

**① `stale-version` 沒有 per-stall 去重。** 看門狗每 8 秒觸發一次，條件持續成立就連發，
一次 70 秒的長考就把 `_diagSentCount` 的 3 發配額燒光 ⇒ 之後 `invisible-hand` 等真指紋全部靜音。
與 v6.155 把 `manual-sync` 移出配額時點名的是同一型缺陷。
⇒ 新增 `_staleDiagVersion`：同一個卡住的版本只報一次，版本一前進自動失效；`tLeaveMatch` 歸零。

**② ⭐⭐⭐`/action` 403 是「開局停在 v1」最有力的可查證解釋（本版做了可觀測性，沒有動後端）。**

- `server_admin_patch.js` `/action`：`if (doc.matchId && !_id.verified) return res.status(403)`（v6.150）。
- `/state`：`const _vseat = _redactOn() ? await _viewerSeat(req, doc) : TSEAT_NO_REDACT;`
  —— **遮蔽關閉時（這場就是關的）`/state` 完全不驗身分，永遠 200**。
- `tApi` 只在 `firebaseUser && !firebaseUser.isAnonymous` 時帶 Bearer；取 token 失敗是 `catch {}` 吞掉。
- ⇒ 只要憑證過期／`firebaseUser` 為 null（**記憶裡「線上休閒大廳偶發打不開，疑 firebaseUser 為 null」是同一個現象**），
  就會出現：**輪詢正常、畫面正常、輪到我、但每一發動作都 403，版本永遠停在 1**。
- 舊版的可見度：只有一則會被下一個動作蓋掉的紅色 toast。失聯橫幅（連同它唯一的自救鈕
  「立即重新同步」＝`getIdToken(true)` 強制換憑證）因為 `tOfflineSec` 恆為 0 **永遠不會出現**；
  `tAuthLost` 只認 401，而且輪詢每次成功都把它清成 false。診斷指紋也完全沒有這一類。
- ⇒ 本版：401/403 → `_tActionAuthErr` 旗標（**只有 `/action` 成功回應才准清**，輪詢成功不算，
  因為 `/state` 根本不驗身分）→ 橫幅亮起並優先顯示這一種文案 → 送出一次 `action-forbidden` 指紋。
  admin 監控加上這個指紋的說明（含「不是掛機、該場閒置判負要人工複核」）。
- ⚠ **這仍是假說**，不是已證實的當晚成因 —— 要確認請查 VM 上那段時間 `/action` 有沒有 403。
  下一場只要再發生，`action-forbidden` 就會直接出現在監控分頁。

### 守衛

`scripts/test-v6158-setup-actor-single-source.mjs`（18 條，已進 `npm test`）：
掃描器自我驗證 → 伺服器 `currentActorSeat` 實跑正對照 → `tCurrentActorSeat` 等價 →
`_setupSelfPending` 不再誤報且四種真待辦仍認得 → **896 組 setup 狀態三方等價** →
把 `{:else if}` 的條件字串抽出來 `new Function` 求值，斷言「輪到我時遮罩必須不顯示、
真的在等對手時必須顯示」（斷言的是**行為**不是「有沒有呼叫某函式」）→ 門檻與 payload 欄位 →
admin 說明。另含伺服器 `/action` 403 gate 與 `/state` 不驗身分的**前提查證**（前提一變守衛就紅），
以及把 `tNetBannerOn` 的 `$derived` 運算式抽出來實跑的行為斷言。
HEAD-FAIL：還原成 v6.157 blob 重跑 = **13 條 FAIL**。

## v6.157 — 根治錦標賽「開局死角」（伺服器端 level-triggered 補推）

### 症狀

錦標賽偶發：雙方都已經放好戰鬥場、都按過「準備完成」，畫面卻一直停在準備階段不開打。
兩個人都以為在等對方，誰也不會再送任何動作，最後被閒置掃描判掉
（v6.156 之後是改記平手 `pending-admin`、丟給站長人工裁定）。

### 真因：`tryAdvanceToPlaying` 是 **edge-triggered**

`src/lib/game/engine.ts` 的 `tryAdvanceToPlaying(state)` 是 setup → playing 的守門員，
要五個條件同時成立才推進：
①互動式開局已定案 ②雙方 `setupDone` ③`pendingMulliganDraw` 皆 0
④`mulliganRevealConfirmed` 雙 true ⑤`mulliganPostBenchOpen` 皆 false。
條件沒到就**原樣回傳**（冪等、安全）。

問題不在條件，而在**誰來呼叫它**：全站只有 `applyAction` 內 4 個 handler 結尾會呼叫
（FINISH_SETUP / MULLIGAN_DRAW_DECISION / CONFIRM_MULLIGAN_REVEAL /
FINISH_MULLIGAN_POST_BENCH），`oracle-admin/server_admin_patch.js` 的呼叫次數是 **0**。
於是只要「讓五個條件湊齊的最後一筆狀態變化」走的是**不呼叫它**的路徑
（線上 setup 合併 `mergeSetupMonotonic`／CAS 寫回／版本 skew 補寫），
而兩位玩家又都在等對方、不會再送 action ⇒ **永遠沒有人來推它**。

⚠ 先前一度懷疑是「引擎與伺服器的判準不一致」，已被反證推翻，別再往那個方向查：
`effectiveOpeningDone` 是 `openingDone[i] || setupDone[i]`，所以 `setupDone` 為 true
就視為開局已定案 ⇒ 死角當下 `isOpeningInProgress` 必為 false ⇒ 五個條件其實全部成立、
引擎**願意**推進；伺服器 `currentActorSeat` 的 opening 分支同樣被 `&& !setupDone` 收掉，
兩邊一致。純粹是沒有人去按那個開關。

### 改動（兩處）

**(A) `scripts/build-server-engine.mjs`**：entry 加上 `tryAdvanceToPlaying` 的 import/export。
在此之前伺服器端根本拿不到這個函式。

**(B) `oracle-admin/server_admin_patch.js`**（v1.08）：既有的閒置掃描裡，掃到
`gs.phase === 'setup'` 就先跑一次 `TENG.tryAdvanceToPlaying(gs)`（level-triggered）。
推得動就：**CAS 寫回** + bump 版本 + **更新 `lastActionAt`** + 房間 log 留一則系統訊息
+ 大廳聊天室公告 + `continue`（本輪不判任何人輸贏）。推不動就原樣落回 v6.156 的
`pending-admin` 行為，一字未改。

幾個踩過坑才有的細節：

- **必須 CAS**。這是繼 v6.151 `idleWarn60` 之後第二個「非終局的整包寫回」。
  讀 doc 到寫回之間玩家可能剛好送出動作，沒有 CAS 會把它整個蓋掉，
  **而且版本號一樣**（都是 `room.version + 1`）⇒ client 的 `?v=cv` 版本比對全回
  unchanged，自癒完全失效。CAS 未命中 ⇒ 盤面本來就在動 ⇒ 這場根本不是死角。
- **`lastActionAt` 一定要更新**。行動權才剛交給先手方，閒置倒數必須從現在重新起算，
  否則 30 秒後的下一輪掃描會拿「卡住的那段時間」直接把剛拿到行動權的人判負。
  （這與 v6.151 的 60 秒警告刻意**不動** `lastActionAt` 剛好相反 —— 那邊動了等於幫
  掛機方重置倒數；這邊不動等於處罰無辜的人。判準是「盤面有沒有因為我而前進」。）
- **判「有沒有真的推進」用 `phase`，不用物件同一性**。條件不滿足時引擎回的是同一個
  參考，但哪天改成回淺拷貝，比同一性就會靜默失效（v6.148 gate⑤b 的教訓）。
- **fail-open 且必須出聲**。舊的 `server-engine.cjs` 沒有這個 export，
  `typeof TENG.tryAdvanceToPlaying !== 'function'` 就跳過（比照 `validateDeck` 的既有寫法），
  但要 `console.warn` 提示跑 `update-tournament.bat`。
  ⚠ 只 warn 一次（`global.__ptcgSetupAdvanceWarned`）—— 伺服器引擎是所有對局共用，
  每 30 秒對每一場印一行會灌爆 pm2 log（v5.636 就是這樣把 error.log 灌爆的）。
- **讀 room 不加 projection**（v6.119 教訓：整包寫回會把 log 永久洗掉）。
- 補推的觸發時點沿用既有閒置掃描 ⇒ 最晚會在「閒置門檻（預設 3 分鐘）+ 一個 tick」內自癒，
  而且**搶在** `pending-admin` 之前。不另外加一條每 30 秒掃全部 playing match 的迴圈，
  那會把 v6.119 的降載整個吃回去。

### 守衛 `scripts/test-v6157-setup-advance-level-triggered.mjs`（39 條）

把兩個改過的檔還原成 v6.156 重跑 ⇒ **17 條 FAIL**（HEAD-FAIL 已實測）。

- 靜態端：entry 有 import/export；伺服器**真的呼叫**了它；呼叫點在「算 actor」與
  `pending-admin` **之前**；寫回**在** `if (advanced.phase === 'playing')` 區塊內
  （用括號平衡切區塊，斷言的是**位置**——「有呼叫某函式」不等於「那件事有發生」，
  v6.137 假回滾就是這樣亮綠燈的）；CAS filter、`version+1`、`lastActionAt`、`actorSeat`
  逐項；fail-open 與去重旗標。
- 行為端：把補推區塊的**真程式碼**切出來，配**真引擎** + 假 DB 實跑 8 個情境
  （死角 / 條件沒滿足 / 只有一方 done / playing 房 / 舊 bundle / CAS 未命中 / version 非數值）。
  死角盤面是用真實成因造的：雙方各自 `FINISH_SETUP`，再把兩半合起來。
- 剝註解的掃描器**保長度**（剝除後索引與原檔逐字元對齊，位置關係斷言才成立），
  並附 6 條自我驗證：`//` 註解裡的 `/api/*` 不會被當 block comment 吃掉真程式碼、
  多行 block comment 要整段剝掉、`http://` 不會被誤判、`mode='all'` 與 `'comments'`
  行為正確、剝完既有真程式碼還在（沒剝爆）。
- ⚠ 第 3 節（引擎行為）在 v6.156 **也會 PASS**，檔內已明確標註它不算 HEAD-FAIL 證明。

### 部署

改到 bundle 進入點與 Oracle 伺服器 ⇒ Wilson 需跑 `update-tournament.bat`（重建
`server-engine.cjs`，否則新 export 不存在、補推被 fail-open 跳過）與 `redeploy-oracle.bat`。

### 首頁 changelog

**不放**。判準是「玩家看了之後有任何要做的事、或感受得到的規則差異嗎」——
這是伺服器端自癒，玩家沒有任何要做的事。

## v6.156 — 閒置判負前的「我還在」確認框 ＋ Fable 5 最終審查修正

站長 2026-08-10 的裁定：「我不會一直去監控啊，應該是要提醒他們『系統已經計時囉』，
然後彈出一個框框讓玩家點選。沒點選表示人在掛機不在，就可以判敗；相反的，如果玩家在、
只是在思考，就可以點那個框框，證明還在。」

⇒ 把「事後看監控」換成「**當場問玩家**」。真掛機照樣判負，在思考的人不會被冤枉。

### ① 新端點 `POST /api/tournament/still-here`

倒數剩 60 秒（與 v6.151 的推播同一時點）→ client 彈確認框 → 按下去就重置閒置倒數，
**不限次數**（站長裁定①）。

**⚠⚠ 交接文件沒寫、實作時查證後補上的一條規則：只有「該動作的那一方」能重置。**
閒置倒數的語意就是「該動作方沒動作」。若放行等待方呼叫，等待方就能替**掛機的對手**
無限續命 —— 判負機制直接失效，而且是對手幫他做的，掛機者本人什麼都不用做。
`actor === -1`（雙方都該動作＝系統死角）時兩邊都放行，那正是這個功能要救的情境。

**⚠ 只 `$set: { lastActionAt }`，不整包寫回 gameState**（v6.151 `idleWarn60` 的教訓：
非終局的整包寫回一定要 CAS，否則會蓋掉玩家剛送出的動作、而且版本號一樣讓自癒失效）。
只碰一個純量欄位 ⇒ 不需要 CAS。**也刻意不 bump version** —— 盤面一個位元都沒變，
bump 了只會讓兩邊 client 各抓一份完整盤面，白花流量。

**⚠ 對局時限（`timeLimitReached`）之後不再重置**：這是交接文件點名的漏洞。時限到之後
要「打完最後回合」才判定，而拖延方只要每 3 分鐘點一次「我還在」，最後回合就永遠打不完
⇒ 對局時限形同虛設。時限到之後按鈕還在，但只回「對局時限已到，請盡快完成最後回合」。

權限與 /action、/join 同標準：正式賽房要求 verified 身分；不在該房 seats 內 → 403。

### ② 死角改判**平手**（站長裁定③）

閒置掃描原本在 `currentActorSeat(gs) === -1` 一律走「雙方皆閒置 → 雙淘汰（doubleNoShow）」。
但 setup 階段**雙方都已按過準備、卻誰也推不動**的情況不是「兩個人都在掛機」，是系統把
局面卡住了 —— 用雙敗處理等於處罰兩個無辜的人。

⇒ 改判平手（`winnerUid: null` + `draw: true` + `deadlockDraw: true`），並在聊天室
請站長人工裁定。**刻意不重用 `doubleNoShow`**：那個旗標在賽果頁與歸檔裡的語意是
「兩人都沒出現」，混用會讓事後對帳分不出「掛機」與「系統卡住」。
非死角的雙方閒置**仍走原本的 doubleNoShow**，舊行為一個字沒改。

### ③ client：彈窗與新診斷指紋

- ⚠ 彈窗放在**手機／桌機版面分支之外**（v6.149 剛踩過：失聯橫幅寫在桌機的 else 分支裡，
  手機玩家整個看不到）。它與既有的 `tourn-idle-warn` 同層，兩者互斥 —— 一個是
  「對手在被倒數」、一個是「我在被倒數」，方向由**伺服器權威**的 `actorSeat` 決定。
- 死角情境點了「我還在」之後會強制重抓盤面，並送新指紋 **`setup-stalled-both-done`**
  —— 點了還是推不動，那才是真 bug。admin 監控分頁已加對應白話說明。
- ⚠ 手機在背景／鎖屏看不到任何畫面 ⇒ 仍要靠 v6.151 的 60 秒推播叫醒。彈窗是補強不是取代。
- ⚠ 正常出牌本來就會更新 `lastActionAt`，沒有因為加了彈窗就改動那條路徑 —— 正常行動的人
  不該被要求額外點確認。

### ④ 同批併入：Fable 5 最終審查的三項修正

v6.150~v6.155 全部完成後做的最終一輪 Fable 5 審查（伺服器端／前端／admin＋守衛三個
獨立視角並行），15 個發現逐一自行複驗後確認並修掉三項：

**⭐ 新鮮度看門狗會把長輪詢的效益整個吃掉**（只在長輪詢旗標打開後才現形）：
20 秒新鮮度看門狗沒有長輪詢守衛。長輪詢的語意就是「盤面一變伺服器立刻回」，所以
「20 秒沒更新」在長輪詢模式下是**對手在長考**的正常狀態。少了守衛會 ①每 20 秒白抓一份
`?v=-1` 全量盤面（正好抵銷長輪詢要省的流量）②順帶的 `startTournamentPoll()` 會
`++tPollGen`，把掛在伺服器上、對手一動就會回的那一發判為過期丟棄 ⇒ 反而多等一個 RTT
③`_freshWatchdogFires` 累加到 3 而 `tVersion` 沒動 ⇒ **誤發 `stale-version` 指紋**，
污染站長在監控分頁用來判讀「版本是不是真的卡住」的訊號。修法：條件加 `&& !_lpInFlight`。

**⭐⭐ 三條守衛安慰劑**（把修正還原掉，測試照樣全綠，均以突變實測確認）：

| 測試 | 原斷言 | 為什麼假 | 還原修正後 |
|---|---|---|---|
| `test-v6152` | 全 `/state` 區段比對「掛起後重讀盤面版本」 | 掛起**之前**的第一次輕量讀含一模一樣的字面 | 44 PASS / **0 FAIL** |
| `test-v6152` | 全檔比對 `_lpCfgAt = 0;` | 被**宣告行** `let _lpCfg = null, _lpCfgAt = 0;` 滿足 | 44 PASS / **0 FAIL** |
| `test-v6151` | 負向 `!/catch[\s\S]{0,200}_tRecordRtt/` | 只防 catch 一種拼法，改 `try/finally` 一樣把逾時的 12 秒記進統計 | 71 PASS / **0 FAIL** |

第一條的後果最重：長輪詢被 `_lpNotify` 叫醒後拿**舊** `light.version` 比對 → 判「沒變」
→ 回 `unchanged` → client 立刻再掛一發 ⇒ **長輪詢退化成忙碌空轉**，而測試全綠。
第二條是 v6.150 已經修過一次的同款坑（`_redactAt = 0;`），v6.152 那支當時沒跟著修。
三條全部改成 scope 到正確區段的正向斷言，並各補一條**有內容的**自我驗證。

**admin 監控分頁**：旗標開關失敗時按鈕永遠停在「處理中…」（失敗路徑只放開 `disabled`）。

### ⑤ ⭐ 第二輪 Fable 5 審查：「請站長人工裁定」原本做不到

死角平手第一版把 match 設成 `status: 'done'` —— 但 `admin/match/resolve` 開頭就
`if (m.status === 'done') return 409`，`admin/pending-matches` 也只列 `status: { $ne: 'done' }`。
⇒ 那場**既不會出現在待裁定清單、也無法被裁定端點改判**，而且 `checkRoundAdvance` 立刻推進，
單淘汰下這兩個人會直接從賽程消失。「請站長人工裁定」變成純文案，實質仍是雙淘汰。

修法：死角場改設 **`status: 'pending-admin'`**（閒置／時限掃描都只找 `'playing'`，不會重複
觸發；pending 清單列得到；resolve 進得去），而且**不呼叫 `checkRoundAdvance`** ——
輪次等站長裁定完再由 resolve 那條路徑推進。

同一輪還修掉三項：

- **`draw` / `deadlockDraw` 沒進歸檔與 summary 的 mapping** ⇒ 賽果頁會把死角場顯示成
  「正常分勝負」。而「不重用 doubleNoShow」的理由正是要分得出「掛機」與「系統卡住」，
  漏了 mapping 等於白做。admin 的 `_tsMatchOutcome` 與賽果分佈也一併加上。
- **死角時兩個方向相反的提示同時出現**：`tIdleWarnSec` 對 `actor === -1` 也會算出秒數 ⇒
  頂部橫幅「對手閒置中，將自動判你勝」（在死角情境這句是錯的）與底部「剩 N 秒被判負」
  同時在畫面上。改成 `-1` 一律由「我還在」確認框負責。
- **`setup-stalled-both-done` 指紋會誤發並吃光診斷配額**：伺服器回 `-1` 不等於「雙方都完成
  準備」（雙方同 mulligan 數、都還沒放出場也是 -1）；而且它走每頁 3 發的一般配額，死角裡
  玩家每 2.5 分鐘點一次，三次就把配額吃光 ⇒ 之後真正的 `stale-version` 全部靜音。
  改成「真的雙方 setupDone 才送」＋每場只送一次。另補 `tStillHereNote` 等跨場清理。

守衛跟著補到 **62 項**，突變實測 7 個全紅（死角改回 done／改回無條件推進輪次／
`tIdleWarnSec` 拿掉 -1／指紋拿掉 setupDone 判準／彈窗包進 `{#if isPortraitMobile}`／
歸檔 mapping 漏改一處／admin 賽果文字拿掉 deadlockDraw）。
其中「彈窗在版面分支之外」的斷言也從**檔案先後順序**（Fable 指出是安慰劑：原地包進
`{#if isPortraitMobile}` 順序不變、測試照綠）改成**巢狀深度證明** —— 從對戰畫面根分支的
`{:else}` 到彈窗自己的 `{#if}` 之間，`{#if}` 與 `{/if}` 必須成對。

### 守衛

新增 `scripts/test-v6156-still-here.mjs`（**62 項**，測試鏈 471 → 472 步）。
行為端把 `/still-here` 的 handler 從 patch 抽出來、注入假的 TROOMS / TMATCH /
tournIdentity / currentActorSeat 實跑 —— 純字串比對擋不住的兩個真漏洞（等待方續命、
時限天花板）由行為端釘住。突變實測 4 個全紅：①拿掉「只有該動作方能重置」的 gate
②拿掉時限天花板 ③死角改回一律 doubleNoShow ④把寫入改成整包寫回 gameState。
另外 `test-v6152` 44 → **52 項**、`test-v6151` 71 → **74 項**（安慰劑修正，突變 5 個全紅）。

### 部署

伺服器端有改（`/still-here` 端點 + 死角平手）⇒ **必跑 `redeploy-oracle.bat`**；
admin.html 有改 ⇒ **必跑 `update-admin-full.bat`**。

---

## v6.155 — 監控分頁第一次上線就被自己的誤報淹沒（setup 指紋收斂）

**事故**：v6.154 的監控分頁上線後 24 小時內 `setup-watchdog-repeat` 收到 **118 次 / 59 人**，
幾乎每個參賽者都中，站長以為是「開局同步卡住」的真 bug。

**判讀**（兩筆真實 payload）：`sincePollOk` 只有 **211ms / 944ms** ⇒ 輪詢完全正常、沒斷線；
`sinceStateChange` 12.3s / 15.2s ⇒ 伺服器盤面真的沒動，因為**在等某個人做開局選擇**。
舊判準 `_freshWatchdogFires >= 2 && phase === 'setup'`，而 setup 門檻 3500ms + 節流 8000ms
⇒ 實際是「盤面連續約 11.5 秒沒變就回報」。人類看揭示／選出場／放備戰本來就超過 11.5 秒。
⭐ **雜訊最大的傷害不是吵，是把真訊號淹掉** —— 下次真的有人卡住會埋在 118 筆裡找不到。

**修法（只改「要不要回報」，看門狗的自癒完全不動）**：
- 新增中央述詞 `_setupSelfPending(g, seat)`，回傳我這邊卡在哪一步（四種）或 `null`（都做完了）。
  欄位缺席一律回 `null` —— **fail-closed 到不回報**，寧可漏報也不製造新雜訊。
- 判準改成三條同時成立：①我這邊確實還有動作沒做 ②盤面 60 秒沒動 ③每場只報一次。
- payload 加 `selfPending`，讓「等對手」與「我卡住」日後分得出來。
- `tLeaveMatch` 重置 `_setupDiagSent` / `_invisibleHandDiagSent`（跨場次殘留會讓下一場漏報）。

**⚠ `visHand` 一直是假證據**：選擇器只認桌機的 `.hand-strip .hand-card`，
手機直式用的是 `.mp-hand-card` ⇒ **手機上這個數字恆為 0**。所以樣本裡 iPhone 的 `visHand:0`
不能當「手牌隱形」的證據，而且 `invisible-hand` 指紋在手機上等於無條件成立。
已抽成 `_countVisibleHandCards()` 同時數兩套 class。
⚠ `.mp-hand-card.arriving` 是**死查詢**（arrivingIids 只接在桌機），手機端 `arrivingDom` 恆 0，
判讀手機 payload 要看 `render.arrivingSize`（那是 state 不是 DOM）。已在碼上註明。

**⭐⭐ Fable 5 審查抓到的漏報路徑（同版補上）**：
`manual-sync` 會吃掉每頁 3 發的診斷配額，而**玩家覺得卡的時候最愛按「等待對手 🔄」**；
更糟的是伺服器的 per-uid 60 秒節流**不分 reason** ⇒ 剛按過手動同步、緊接著觸發的
`setup-watchdog-repeat` 會被 throttle 丟掉，而 client 已把 `_setupDiagSent` 設 true 不會重送
⇒ **真訊號被 manual-sync 吃掉**。改成 manual-sync 不佔配額 + 自帶 60 秒節流。

**Fable 5 指出、留到下一版的靜音死角**：雙方 `setupDone=true`、mulligan 旗標全清、
但 `openingFinalized`/tryAdvanceToPlaying 卡住 ⇒ 兩邊 `selfPending` 都是 null、**永遠不報**。
建議加降級指紋 `setup-stalled-both-done`（雙方都做完 + 120 秒沒動）。

admin 的指紋說明文字同步改成新語意（⚠ admin 走 `update-admin-full.bat` 另一條部署路），
版本 v1.67 → v1.68。順手把 `docs/handoff-v6150-v6154-錦標賽lag與監控.md` 帶進版控。

**守衛** `scripts/test-v6155-setup-diag-noise.mjs`（14 項，對 v6.154 跑 10 FAIL）——
把 `_setupSelfPending` 從原始碼抽出來用 `new Function` **實跑**，含兩筆真實樣本重演。

## v6.154 — admin 新增「📡 監控」分頁（連線設定 ＋ 玩家端異常指紋）

站長要求把兩件事都放進 https://www.ptcg-tw-sim.com/admin 的獨立分頁，不要再下指令。

### ① 連線設定

長輪詢（v6.152）與盤面遮蔽（v6.153）兩個伺服器端灰度旗標的開關，改完**立即生效**
（不必重啟、不必重新部署）。長輪詢那塊順便顯示 **現在掛著幾條連線 / 幾個房間**，
開啟後拿它觀察負載。掛起上限可直接在頁面上調（建議先 8 秒觀察，沒問題再加到 25）。

### ② 玩家端回報的異常指紋 ⭐

`tournamentClientDiag` 從 v0.77 起就一直在寫，但**從來沒有讀的地方** ——
「很卡」的回報一直只能靠玩家口述還原（v6.134 就是這樣查的）。這一版把它接出來：

- 新端點 `GET /api/tournament/admin/clientdiag?hours=`（`isTournAdmin` gate，hours clamp 1~168）。
- 回三塊：**各指紋的次數與受影響人數**（⚠ 人數比次數重要：同一人重複觸發不代表全站問題）、
  **slow-rtt 的往返時間分佈**、最近 120 筆明細（可展開看原始 payload）。
- ⚠ 統計走 `aggregate` 對**整個時間窗**算，不是拿「最近 N 筆明細」來數 —— 那會被 limit 截斷而失真。
- 頁面對每個指紋都寫了**白話解釋與怎麼判讀**，例如：
  「多位不同玩家同時出現 slow-rtt ⇒ 瓶頸在隧道或 VM；只有固定那幾位 ⇒ 他們自己的網路」。

### ⚠⚠ Fable 5 審查抓到的兩個真 bug（第一版寫完時 22 條守衛**全綠**，但分頁根本不能用）

1. **只加了分頁按鈕與 switchTab 分派、沒加內容容器**，而且 `loadMonitor` 抓的是一個不存在的
   `id="content"` ⇒ 點進去**整頁空白、而且完全沒有錯誤訊息**（`switchTab` 把所有 `.tab-content`
   隱藏、`getElementById` 回 null 被 `if (el)` 靜默擋掉）。
   ⇒ 補 `<div id="tab-monitor" class="tab-content">`，`loadMonitor` 改抓自己的容器。
2. **`api()` 從不 reject** —— 非 2xx 會回 `{ error: text }`（v1.65 就是這樣設計的）。
   所以我寫的三個 `.catch(() => null)` 是**死碼**，「伺服器還是舊版」那條提示不可達；
   舊版伺服器（端點 404）會被呈現成「關閉／沒有任何異常回報 👍」＝**假綠**。
   ⇒ 改用 `_ok(r) = (r && !r.error) ? r : null`。

⭐ 這兩個一起說明了一件事：**只驗字串存在的守衛擋不住「接線沒接上」**。
所以這一版補了一條通用的：**每個分頁按鈕都必須同時有「內容容器」與「switchTab 分派」**，
掃全部 `data-tab` 逐一比對 —— 以後任何人新增分頁漏了其中一件都會紅。

### 守衛

`scripts/test-v6154-monitor-tab.mjs`（30 項）。其中幾條是通用價值比較高的：

- **inline `on*` 呼叫的函式一定要掛在 `window`** —— admin.html 是 module script，
  模組層級的函式寫進 onclick 會**靜默失效**（v1.60 的既有事故）。這條掃監控分頁區段裡
  所有 `onclick="xxx("`，逐一確認 `window.xxx =` 存在，並附故意壞掉的樣本自我驗證。
- **client 送的每一種指紋，admin 都要有對應的白話說明** —— 以後在前端新增
  `_tSendClientDiag('新指紋')` 卻忘了在 admin 補說明，這條會紅。

**部署**：動到 `server_admin_patch.js` ⇒ `redeploy-oracle.bat`；動到 `admin.html` ⇒
`update-admin-full.bat`（或 `update-admin-html.bat`）。

## v6.153 — 玩家端盤面遮蔽改為**預設關閉**的灰度旗標

> 站長裁定（原話大意）：本站是**練習性質**、不是專業競賽站，對手手牌被 devtools 看到其實沒關係；
> 為了修這件事去冒高風險並不划算，重點應該放在**降低多人錦標賽的卡／lag／延遲**。

### 做了什麼

v6.150 的遮蔽整套程式碼保留，但加上總開關 `_redactFlag`（`tournamentConfig` 的 `redactState` doc，
`enabled` 必須是 boolean `true` 才算開），**預設關閉**。關閉時：

- **玩家視角原樣回**（`_redactStateForSeat` 直接 `return gs`，連物件都不換）⇒ 不遮手牌／牌庫／獎賞、
  不打亂牌庫順序、不剝 `privateMessage`，行為與 v6.149 逐字相同。
- **`/state` 完全不做身分判定**（`_vseat` 直接走「不遮」的哨兵值，順帶省掉每一發完整回應的
  `verifyIdToken` 開銷）。
  ⚠⚠ Fable 5 審查抓到：**只把那個 401 拿掉是不夠的** —— `_viewerSeat` 認不出座位會回 `-1`，
  而 `-1` 在 `_redactStateForSeat` 裡是「觀戰視角 ⇒ 兩邊都遮」⇒ 玩家會拿到一份**連自己手牌
  都是卡背**的 200，而且因為不是 401，前端的 `tAuthLost` 橫幅與「刷新 token 自救」入口都不會
  出現（靜默壞盤面，比 v6.149 還差）。
- **原本那個 401 保留給遮蔽開啟時** —— 那個 401 本來就是為遮蔽服務的
  （不回一份連自己都遮的盤面）。功能沒啟用就不該多一種失敗模式。

### ⚠ 兩件**不受旗標影響**的事

1. **觀戰端（seat = -1）永遠遮**。那是 v6.149 就有的既有行為（v6.150 只是把牌庫與獎賞一起補上）。
   關掉旗標不可以退化成「觀戰者看得見雙方手牌」。守衛有專門一條釘住這件事。
2. **`/action` 與 `/join` 的 verified 身分要求保留**。那擋的是「**替對手送動作**」——
   未驗證身分可以填對手 uid 直接送 action，那是會直接破壞別人對局的，與「偷看手牌」不是同一件事。

### 旗標刷新的方式

`_redactFlag` 由 `/state` 每 10 秒刷新一次（對戰中每 1.2 秒就有一發，快取一定新鮮）；
`/action`、`/join`、`/spectate` 讀同一份快取，不必各自 await。伺服器剛啟動、還沒有任何 `/state`
進來時是 `false` ＝ 安全的預設。admin 端點 `GET/POST /api/tournament/admin/redact` 切換，
改完立刻失效不必等快取。

### ⚠ 一個嚴格說「不完全相同」的地方

`/join` 與 `/action` 的四條錯誤路徑（actor gate 拒絕／動作無效／引擎拒絕／CAS stale）在 v6.149
回的是**未截尾**的 log，v6.150 收斂進 `_stateForSeat` 後一律先 `_capLog`（只留最近 60 行），
旗標關閉時仍然會截尾。實務上無害（`/state` 本來就截尾、動畫游標自 v0.71 起用 timestamp），
只是玩家中途重整經 `/join` 進房時對戰 log 只載最近 60 行。記在這裡避免日後對照時誤判。

### 前端的部分**保留不動**（它們與遮蔽無關，或是順手修好的既有問題）

- `ensurePoolForStateIds` 過濾佔位 cardId —— 修的是**觀戰端從 v0.68 起就一直在做**的
  「每次盤面更新都把 40 個卡包重灌進一份新 Map」，那個是真的會讓觀戰者的手機卡。
- 選擇視窗的 `{#if c || concealed}` —— 沒有卡面資料也畫得出卡背，本來就比較穩。
- `/spectate/state` 拒絕當事人觀戰自己的房、`tAuthLost`（401 與網路失聯分流）—— 都無害。

### 守衛

`test-v6150-state-redact` 擴充到 114 項：`_redactOn` 改成從 BLOCK 外注入，
新增「旗標關閉時玩家視角原樣回（連物件都不換）」「★關閉時觀戰仍然遮」「預設是 false」
「只有明確 true 才算開」「關閉時不回 401」「/action 的 verified 不受旗標影響」。
`test-v6150-optimistic-under-redaction` 注入「已開啟」以維持原本的驗證意圖。

⚠ Fable 5 同時抓到守衛自己的一條**安慰劑**：`/_redactAt = 0;/` 全檔比對會被宣告行
`let _redactFlag = false, _redactAt = 0;` 滿足 —— 把 admin 端點裡真正的快取失效那行刪掉照樣 PASS。
連同另外兩條全檔比對的弱斷言，一律改成 **scope 到各自的區段**再比對，並補上自我驗證。

## v6.152 — `/state?wait=1` 長輪詢（灰度，**伺服器端預設關閉**）

（交接文件 `docs/handoff-錦標賽伺服器三批次.md` 的**批次 2**。）

> ⚠ 這一版**沒有**首頁 changelog：旗標關著時玩家感受不到任何差異，開了之後也只是「對手的動作
> 出現得更快」，沒有任何要玩家做的事。

### 它解決什麼

等待端目前的可視延遲 = 對手送出動作 → 我下一次輪詢（最壞一個完整週期）。長輪詢把它降到 ~RTT：
`/state?wait=1` 在**版本相符**時不立刻回，掛起最多 25 秒，盤面一變就回。**請求數反而下降**
（一發請求覆蓋 25 秒，而不是每 1.2 秒一發）。

### 喚醒有兩條路，缺一不可

1. `/action` CAS 寫入成功後的 **in-process 通知**（快，~RTT）。
   ⚠ 通知必須寫在 CAS 成功**之後** —— 寫入前通知會叫醒對方去讀到舊版本、白跑一趟。
2. 掛起期間**每 `pollMs`（預設 1.5 秒）自己查一次版本**（保險）。這條不是多餘的：
   - **pm2 若是 cluster 模式**，寫入與掛起可能落在不同 process，in-process 通知跨不過去；
   - scheduler 的**判負／時限／投降／管理員裁定**寫入根本不經 `/action`，不會發通知。
   沒有這條，上述情況會一路等到 25 秒逾時才回 —— 比現在還慢。

### 灰度與安全閥

- 開關存 `tournamentConfig` 的 `longPoll` doc（`enabled` 必須是 boolean `true` 才算開，
  `"true"` 字串不算）；`maxWaitMs` / `pollMs` / `maxHold` 都有 clamp。10 秒快取，
  admin 改設定後立刻失效。
- admin 端點 `GET/POST /api/tournament/admin/longpoll`（`isTournAdmin` gate）。
  GET 會回**目前掛著幾條**（`held`）與涉及幾個房間，開啟後拿它觀察負載。
- **掛起數上限**（預設 200）：超過就立即回，**退化成原本的短輪詢**而不是拒絕服務。
- client 中途離開（關頁、切走）⇒ `req` 的 `close` 事件立刻釋放，不會佔著連線等滿逾時；
  且該情況**不寫回應**（避免 write-after-end）。
- **client 只有在伺服器回應宣告 `longPoll: true` 之後才會送 `wait=1`**，
  所以旗標關著時 client 的行為與 v6.151 逐字相同（也不會把逾時放寬）。

### client 端的三個配套

1. 長輪詢模式**不套 `tPollDesiredMs` 節流** —— 回來就立刻再送一發，延遲才降得到 ~RTT。
   `_pollBusy`（v6.148 的防自我壅塞）仍然擋住重疊送出。
2. 逾時**只在長輪詢模式**放寬到 30 秒（比伺服器上限多一點餘裕）。
   一般模式維持 8 秒 —— 不然網路黑洞要 30 秒才發現。
3. ⚠ **輪詢停擺看門狗（6 秒）必須豁免長輪詢在途的那一發** —— 它本來就會掛 25 秒，
   不豁免的話每 6 秒就會誤判一次停擺、送一發 `v=-1` 全量救援（失聯時反而加重，v6.149 教訓）。
   若真的黑洞，30 秒逾時後在途旗標歸零，看門狗自動恢復。
4. 對戰結束後不長輪詢 —— 那時要的是 v6.146 的降頻，不是低延遲。

### ⚠⚠ 開啟前必須在測試站實測的三件事（我在沙盒無法驗）

1. **pm2 是不是單一 instance**。cluster 模式下 in-process 通知跨不了 process，
   只剩保險輪詢 ⇒ 延遲退化成 `pollMs`（1.5 秒），比現在的 1.2 秒還差。
   要嘛確認是單 instance，要嘛把 `pollMs` 調到 600ms 以下再開。
2. **cloudflared 隧道與 Express 會不會砍掉 25 秒的閒置連線**。被砍的話 client 會看到
   連線錯誤而不是 `unchanged` ⇒ 先把 `maxWaitMs` 調到隧道 idle timeout 以下。
3. **50 人賽 = 50 條掛起連線**，VM 的連線數／記憶體撐不撐得住（用 admin GET 的 `held` 觀察）。

建議開啟順序：先把 `maxWaitMs` 設短（例如 8000）在測試站開 → 觀察 `held` 與實際延遲 →
逐步拉長。任何一項不對就把 `enabled` 設回 `false`，立刻回到原本的短輪詢。

### 守衛

`scripts/test-v6152-longpoll.mjs`（44 項）：LONGPOLL BLOCK 用 `new Function` 抽出來注入假的
TCONFIG / TROOMS **實跑**四條喚醒路徑（通知／保險輪詢／逾時／client 斷線）、掛起上限、
以及「釋放後計數與 waiters map 都歸零」（不洩漏連線與記憶體）。靜態端釘住
「掛起的三個條件缺一不可」「通知在 CAS 之後」「client 沒有伺服器宣告就不送 wait=1」。
HEAD-FAIL：對 v6.151 的檔案跑 → 4 FAIL。

**部署**：動到 `oracle-admin/server_admin_patch.js` ⇒ 要跑 `redeploy-oracle.bat`。

## v6.151 — 伺服器權威 `actorSeat` ＋ 判負前 60 秒警告 ＋ 對戰收尾三項

（交接文件 `docs/handoff-錦標賽伺服器三批次.md` 的**批次 3**。）

### ① 伺服器權威 `currentActorSeat`（根治 v6.149 事故的鏡像）

閒置判負是**伺服器**用它自己那份盤面算的，而 client 各自跑一份 `tCurrentActorSeat(game)` ——
只要 client 版本落後，「誰在倒數」就會反向（v6.149 當事人看到「對手閒置中」，伺服器其實在倒數他）。

- `/action` 寫盤面時一併 `actorSeat: currentActorSeat(newGs)` 存進房間 doc 頂層。
- `/state` 的 **`unchanged` 精簡回應**讀那個欄位；**完整回應**直接用同一支 `currentActorSeat` 現算
  （有盤面時現算最權威，也不依賴欄位存不存在）。
- 建局（`/match/enter` 的 `$setOnInsert`）與 admin 重建房都寫入初始值。
- client：`tServerActorSeat`（`undefined` = 舊伺服器沒回這欄位 ⇒ 退回本地推算），
  `tIdleWarnSec` 的方向改讀它。
- ⚠ 樂觀更新期間本地盤面會比 `tServerActorSeat` 前進一步 —— 方向是**安全的那一邊**：
  伺服器還認為輪到我 ⇒ 不會誤顯示「對手閒置中」。

### ② 判負前 60 秒警告

- 推播給「該動作的那一方」（`actor === -1` 時雙方都推）。**client 連線全掛時 web-push 是唯一
  到得了的通道**。
- 同時在房間 `gameState.log` 塞一則系統訊息 —— 這會 bump 版本，**順便打醒「還活著但版本卡住」
  的 client**（盤面一變，前端的自癒路徑就會跑）。
- ⚠ **不動 `lastActionAt`** —— 動了就等於幫掛機方把閒置倒數重置。
- ⚠ 讀完整 doc（不能加 projection：整包寫回會把 log 永久洗掉，v6.119 教訓）。
- ⚠ 冪等用 `idleWarnAt` 原子搶占，判準是 `idleWarnAt < _lastLight` 而不是「存在與否」——
  對手一動作 `lastActionAt` 就前進，**下一個閒置窗口必須能再警告一次**。
- ⚠ 整段掛在 v6.119 那個輕量讀早退的**前面**，但只有在「最後 60 秒」才會走進去讀完整 doc，
  所以降載維持不變。守衛有釘住「警告寫在早退之前」（寫在之後＝永遠走不到的死碼）。

### ③ 新鮮度看門狗：playing 8 秒 → 20 秒

這一發是**單發成本最大**的（每次都是整份 `v=-1` 全量盤面），而輪詢本身的版本比對已經涵蓋
「漏接」自癒 —— 這條只是最後的保險網。`setup` 維持 3.5 秒（歷史事故最密集、而且盤面小）。

### ④ `visibilitychange`：回前景立即對盤面

背景頁籤的 `setInterval` 會被瀏覽器節流到分鐘級，回來時畫面可能落後好幾個版本 ——
而閒置判負的倒數是伺服器在算，不會跟著暫停。回前景時：先把 `tNow` 拉回現在 →
`tForceResync()` → `startTournamentPoll()`。
⚠ 回前景後 3 秒內不顯示「剩 N 秒」：`tNow` 是每秒 tick 算的，背景期間沒更新，
一回來會先算出「剩 0 秒」嚇人。
⚠ `onMount` 有回傳 cleanup 解除 listener（全站原本只有 `src/lib/img-retry.ts` 掛過
`visibilitychange`）。

### ⑤ RTT 量測 ＋ `stale-version` 診斷指紋

- `tournamentDispatch` 頭尾量動作往返時間；只在 p95 ≥ 3 秒時回報**一次** `slow-rtt`
  診斷（正常是幾十毫秒）。⚠ 逾時那一發不計入（12 秒會扭曲統計）。
  伺服器端指標一直是全綠的，但那不含隧道排隊與網路往返 —— 這正是 v6.134「第四輪很卡」
  一直缺的那份資料。
- 新增 `stale-version` 指紋：**playing 階段的版本卡住**原本不屬於任何現有診斷指紋，
  什麼都不會回傳（v6.149 就是這一類，只能靠玩家口述還原）。判準＝看門狗連續觸發 3 次
  且 `tVersion` 一步都沒前進。

### Fable 5 審查抓到的（同版一起修）

1. **⭐`idleWarn60` 的寫回沒有 CAS**（高）。全檔的整包寫回都是 game-over 終局（被蓋掉無害），
   **這是第一個「非終局」的**。讀 doc 到寫回之間有數十毫秒窗口，而那個時機（剛要提醒玩家）
   正是他最可能突然送出動作的時候 ⇒ 會把玩家剛寫進去的動作整個蓋掉，**而且版本號一樣**
   （兩邊都是 `room.version + 1`）⇒ client 的 `?v=cv` 版本比對全回 `unchanged`，那條自癒
   完全失效，只剩新鮮度看門狗能救 —— 而本版剛好把它從 8 秒放寬到 20 秒，**兩個改動互相放大**。
   ⇒ 改 `updateOne({ _id, version: room.version }, …)`；CAS 未命中就整個放棄，**連推播都不發**
   （對方剛動作過 ⇒ 他根本沒閒置）。
2. **⭐`unchanged` 分支把「欄位缺席」壓成 `null`**（中）。client 只把 `undefined` 當「伺服器沒講」，
   `null` 會被當成權威的「無人該動作」⇒ 閒置倒數整條消失。而**掛機中的房永遠不會有 `/action`
   來補寫這個欄位**（v6.151 部署前就已開打的房、測試房都一樣）⇒ 正好在最需要倒數的情境失效。
   ⇒ 欄位缺席就**省略這個鍵**，client 的 `'actorSeat' in r` 判準自然退回本地推算。
3. **回前景 3 秒抑制用了混時鐘**（中低）：`tNow` 是伺服器域、`_tForegroundAt` 原本寫 `Date.now()`
   是本機域，兩者差值就等於 `tClockOffset` ⇒ 裝置時鐘慢 3 秒以上抑制永遠不生效、快 30 秒則
   抑制長達 33 秒。⇒ `_tForegroundAt = tNow`（同域，而且仍隨每秒 tick 反應式更新）。
4. `/action` 回應原本不帶 `actorSeat`，方向最多落後一個輪詢週期（≤1.2 秒）。順手補上。
5. `tServerActorSeat` / RTT 樣本跨場次不清 ⇒ 下一場的第一個輪詢回來之前方向會用上一場的值、
   `slow-rtt` 指紋會掛在錯誤的場次上。⇒ `tLeaveMatch` 一併清掉。

### 未處理（判斷後決定不動）

- `actorSeat === -1`（雙方都該動作，setup 常見）時 client 仍會顯示「對手閒置中」——
  這是 v6.150 之前就有的既有行為，不是本版引入，不在這批改。

### 守衛

`scripts/test-v6151-server-actor-and-idle-warn.mjs`（71 項）：`idleWarn60` 用 `new Function`
抽出來注入假的 TROOMS / sendPushToUids **實跑**（推給誰、log 寫了什麼、有沒有動到
`lastActionAt`、game-over 不動作的正對照），其餘為靜態＋掃描器自我驗證。
HEAD-FAIL：對 v6.150 的檔案跑 → 3 FAIL。

**部署**：動到 `oracle-admin/server_admin_patch.js` ⇒ 要跑 `redeploy-oracle.bat`。

## v6.150 — 錦標賽玩家端盤面遮蔽（公平性缺口）＋ /action 未驗證身分可假冒座位

> ⚠ **公平性／作弊類修正，依既有規則不寫首頁 changelog**（寫出來等於教人怎麼鑽）。

**缺口**：`/api/tournament/state` 與 `/api/tournament/action` 一直是**直接回傳整份
`doc.gameState`**，只有 `/spectate/state` 會把手牌蓋成卡背。⇒ 對戰中任一方打開 devtools 就能讀到
**對手的手牌內容、牌庫順序、獎賞內容**。而且不必猜房號 —— `/bracket` 從 v0.79 起就把每場
`playing` 的 `roomId` 公開回給所有人（觀戰按鈕用的）。

**第二個缺口（順手一起修）**：`/action` 的身分是 `tournIdentity(req)`，它在沒有 Bearer token 時
會退回 `req.body.playerId` 且 `verified:false`。而**雙方的 uid 就寫在 `/state` 回應的 `seats` 裡** ⇒
任何人抄下對手 uid、用 `playerId` 送 `/action`，就能**替對手送動作**。這也讓遮蔽本身失效
（假冒座位即可換到未遮蔽盤面），所以兩件事必須同一版修。

### 遮蔽規則（每一條都對應卡面或既有 UI 行為，不是「一律蓋掉」）

中央函式 `_stateForSeat(gs, seat)`（`server_admin_patch.js`，`REDACT BLOCK BEGIN/END` 之間）：

1. **只遮對手的 `hand` / `deck` / `prizes` 的內容**，換成 `{ iid, cardId:'__HIDDEN__', damage:0,
   energyAttached:[] }`（與觀戰端同一個佔位 id）。**長度與 iid 一律保留** —— 對戰頁有雙方手牌張數
   chip、牌庫/獎賞張數；iid 保留才不會動到 `assertIidIntegrity` 那一類卡片守恆網。
2. **`phase === 'game-over'` 完全不遮**（攤牌）。與 `/replay` 的既有決策一致，
   同時讓對戰結束時 client 上報 `matchRecords` 的雙方牌組統計維持正確（`fireMatchRecord` 會掃
   雙方全區 cardId；若那時還遮著，牌組原型統計會被 `__HIDDEN__` 汙染）。
3. **面朝上的獎賞（`faceUp`）不遮** —— 那本來就是雙方可見的。
4. **效果已合法揭示給我看的卡不遮**：`pendingSelection` / `pendingChainQueue` 裡
   `actorIdx === 我 && sourcePlayerIdx === 對手` 的那幾筆。`params` 裡點名的 iid 逐一放行；
   `hand-discard` / `hand-choose` 型再整手牌放行（枇琶、能量撢子、莉莉艾的蝶結萌虻 …
   UI 會畫「對手手牌其餘 N 張」）。
   ⚠ `params.concealed === true`（卡面「在不看正面的情況下」）一律**不**放行 —— 遮蔽在這裡
   剛好與卡面同向。
   ⚠ 故意**不用 params key 白名單**（`validIids` / `top5Iids` / `candidateIids`…）：那種白名單一定
   漂移（IRON_RULES Rule 25／28）。改成把 `params` 底下所有字串收成 Set，對手隱藏區某張卡的 iid
   若**完整相符**就放行（完整字串比對，不用 `indexOf` 以免短 iid 誤中）。
5. **火箭隊的貓老大ex｜高傲指令**（Wilson 裁定）：這張卡的完整版 picker 在 **client 端攔截**，
   直接讀 `game.players[對手].deck.slice(0, 10)` 自己畫（engine 端只有 binary-yes-no），
   那個時間點**還沒有 pendingSelection 可以當揭示依據**。⇒ 依卡面條件式放行對手牌庫頂 10 張：
   `phase==='playing'` ∧ `activePlayerIndex===我` ∧ 我的**戰鬥場**卡帶有「高傲指令」。
   他本來就能立刻用這招看到，差別只在「看了可以選擇不用」。
   ⚠ 也涵蓋 **狐大盜｜技能大盜**（engine gate：手牌 0）借用對手場上貓老大ex 的招式那條路徑。
   ⚠ **沒有做能量足夠與否的判斷** —— 伺服器端沒有能量單位計算的中央 helper（特殊能量提供
   多單位／多屬性），自己寫近似值只要偏嚴就會讓卡直接壞掉，偏鬆又沒有意義。
6. **座位只認 `verified`（Bearer token 驗過）的 uid**。理由見上面第二個缺口。
7. **認不出座位的（正式賽房）⇒ 兩邊都遮（fail-closed）**；**沒有 `matchId` 的測試房**
   （`TOURNAMENT-TEST`，走 playerId fallback）維持原行為完全不遮，開發測試不受影響。

套用點：`/state`（完整回應）、`/action`（**五處**：actor gate 拒絕、動作無效、引擎拒絕、
CAS stale、成功）、`/join`。`/state` 的 `unchanged` 精簡回應本來就不含盤面，不受影響；
`/spectate/state` 與 `/replay` 不動。

### 前端配套（一行，但不改會有效能回歸）

`ensurePoolForStateIds` 會把盤面上所有 cardId 收起來、`ids.every(pool.has)` 為 false 就補載卡包。
佔位 id 永遠不在 pool 裡 ⇒ **每次盤面更新都會走到 `loadAllSets()`**，把 40 個卡包重新灌進一份新的
Map。加一行過濾即可。⚠ 這不是新 bug —— **觀戰端從 v0.68 起就一直在做這件事**，一起修掉。

### 查證與守衛

- `scripts/test-v6150-state-redact.mjs`（62 項）：把 REDACT BLOCK 用 `new Function` 抽出來跑純函式。
  含**掃描器自我驗證**（抽到的區塊必須真的含那幾個函式）、**正對照**（未遮蔽的輸入必須被判為
  洩漏）、以及靜態掃描「每一個 `res.json` 的 `gameState:` 都走 `_stateForSeat`」＋該掃描器的
  故意壞掉樣本。HEAD-FAIL：對 v6.149 的檔案跑 → 9 FAIL。
- `scripts/test-v6150-optimistic-under-redaction.mjs`（21 項）：**真 pool + 真 engine 實跑**。
  client 的樂觀更新會拿遮蔽後的盤面跑一次 `applyAction`，只要引擎有任何一條路徑去查對手手牌/
  牌庫的卡就會 throw ⇒ 樂觀更新會**靜默全滅**。實測 `ATTACH_ENERGY` / `PLAY_BASIC` / `RETREAT` /
  `PLAY_FOSSIL` 遮蔽前後都 `ok:true`，且自己那一側逐欄相同。
  對手隱藏區故意混入「有特性的寶可夢」與訓練家（最容易讓引擎去查 pool 的形狀）。
  順帶釘住「白名單仍是那四個」——白名單長大就必須重跑這支實測。
- handoff 文件裡列的風險 1（gate ②b 會不會被佔位卡擋掉）**查證結果是不會**：
  `missingFromPool` 註解與程式碼都寫明**只查場上與場地**，手牌/牌庫/棄牌/獎賞一律不查。

### Fable 5 審查抓到的（同版一起修）

1. **`/spectate/state` 是整條繞道**（既有洞，但它讓本版的遮蔽等於白做）：那個端點**沒有**檢查
   請求者是不是這場對戰的當事人（排除自己的邏輯只做在 `/spectate/list` 的 query），而且它**只蓋
   `hand`、牌庫順序與獎賞內容照樣送**。房號由 `/bracket` 公開回傳 ⇒ 對戰中的玩家打
   `spectate/state?room=<自己的房>` 就拿到對手的完整牌庫序與獎賞。
   ⇒ 收斂到同一條 `_stateForSeat(gs, -1)`（雙方三區都遮）＋ 當事人一律 403（gate 放在
   `markSpectator` 之前，否則自己還會被算進觀戰人數）。
   ⚠ 行為變更：觀戰者在**對局結束後**看得到雙方手牌（`game-over` 攤牌），與 `/replay` 一致。
2. **`gs.log` 的 `privateMessage` 從來沒被遮**：`addPrivateLog` 會把「搜到 XX 加入手牌」這種
   **含具體卡名**的版本寫進共享 log，client 只是靠 `entry.playerIndex === myIdx` 決定顯示哪一版 ——
   資料本身早就在 payload 裡。公開的 `/match-log` 端點早就有剝除，live 對戰路徑卻沒有。
   ⇒ `_redactLogForSeat`：非本人的 `privateMessage` 一律拿掉（觀戰視角全拿掉）。
3. **`/join` 漏了 verified gate**：`/join` 的 `seat` 是 `doc.seats.indexOf(pid)` 算的，`pid` 在
   沒有 token 時來自未驗證的 `playerId` ⇒ 任何人 POST `/join {room:'mr_xxx', playerId:'<對手uid>'}`
   就能拿到「以對手視角遮蔽」的盤面（＝對手三區全開），還能覆寫該座位的暱稱與牌組。
   `/state`、`/action` 都補了就它沒補。⇒ 比照補上。
4. **`/state` 原本 fail-closed 回「雙邊都遮」的 200**：token 取不到的瞬間（頁面重載空窗、
   token 過期且刷新失敗）client 會照單全收 ⇒ **玩家自己的手牌整排變卡背**，正是 clientdiag
   在抓的「隱形手牌」指紋。⇒ 改回 401，讓前端走 v6.149 的失聯處理與重新登入。
5. **⭐本版引入的實質回歸：concealed picker 會整片空白、使用者被閒置判負**。
   `+page.svelte` 的選擇視窗是 `{@const c=getCard(item.cardId)}` 之後「有卡面才渲染整格」。
   卡面「在不看正面的情況下」那類招式（太陽伊布ex｜精神出局、拍落 ×3、占為己有、驚嚇 ×2、
   鈴鈴吵鬧、咬棄、不法之足 —— 共 10 招）的 pending 是 `concealed:true`，伺服器**正確地不放行**
   ⇒ `getCard('__HIDDEN__')` 回 undefined ⇒ 一張卡背都畫不出來；`selectionItems.length` 又不是 0，
   連「（沒有符合條件的卡牌）」都不會顯示；minCount ≥ 1、攻擊中途的 pending 沒有取消鈕
   ⇒ **使用該招式的玩家卡死到被 3 分鐘閒置判負**。
   ⇒ 改成「有卡面**或** concealed」才渲染（concealed 分支本來就只畫卡背與 ???，不需要卡面資料）。
   ⚠ 只改 `sel-grid` 那一個 each；另外三個 `retreat-grid` 是場上寶可夢、不會被遮，維持原樣
   （守衛有釘住「另外三處仍是舊寫法」）。

### Fable 5 第二輪複審抓到的（也一起修）

6. **對手牌庫的「順序」還是洩漏 —— 經由刻意保留的 iid**。棄牌區與場上是公開區，
   任何**曾經公開過的卡**（例如被效果從棄牌區洗回牌庫的能量）其 iid↔卡片對應對方早就知道；
   照原順序回傳牌庫等於告訴他「那張卡現在在牌庫第 3 張」，還能跨輪詢一路追蹤。
   實體遊戲洗回去就是不知道位置 —— 這是超出規則的資訊。
   ⇒ 新增 `_redactDeckZone`：被遮的那些卡**依 iid 字典序重排**後填回原本那幾個位置。
   ⚠ 必須是確定性排序（不能用亂數），否則 client 每次輪詢都會看到牌庫「換了一批卡」。
   ⚠ 被放行的卡（pending 點名／高傲指令的牌庫頂 N 張）維持**原索引**，否則「牌庫頂 10 張」
   會指到別的地方。⚠ 手牌與獎賞**不需要**這樣處理：靠 iid 追蹤對手手上還留著哪張看過的卡，
   等同於實體遊戲裡的記憶，本來就合法；獎賞則是開局分配後不再洗。
7. **401 在前端會被畫成「與伺服器失聯」，而且按重新同步也沒反應**：`tApi` 對非 2xx 一律
   `throw new Error('401: …')`，status 沒有外露，輪詢與 `tForceResync` 的 catch 都是靜默的。
   玩家（在其他分頁登出／憑證被撤銷）只會看到失聯橫幅、按鈕無效、閒置倒數照跑，然後被判負，
   全程沒有一句「請重新登入」。⇒ `tApi` 把 `status` 掛到 Error 上；新增 `tAuthLost` 旗標
   （⚠ 並確認 template 真的有消費它 —— v6.148 的 `tInFlight` 就是加了旗標卻零綁定）；
   橫幅在身分失效時換專屬文案；「立即重新同步」鈕改成**先 `getIdToken(true)` 強制刷新**再重試，
   憑證過期就能就地自救（重新登入等於離開對戰，很可能直接被判負）。
8. **守衛自己的兩個洞**（Rule 25：掃描器要先被驗證會不會漏）：
   - 「當事人 gate 在 markSpectator 之前」原本只比 `indexOf` 大小 —— 訊息文字一改就變 `-1`，
     而 `-1 < 任何正數` 恆成立 ⇒ 從此永遠 PASS。改成先斷言兩個錨點都存在。
   - `res.json` 的 gameState 掃描器原本**逐行**掃、要求 `res.json(` 與 `gameState:` 同一行 ——
     同檔的 `/replay` 就是多行 `res.json({ … })`，那種寫法會整個被漏掉。改成往前找最近的
     `res.json(` / DB 寫入關鍵字來歸類，並補上「跨多行的壞樣本也要被抓到」「DB 寫入不可誤判成
     回應」兩條自我驗證。
   - fixture 也修了一個安慰劑：牌庫的 iid 原本是 `D0…D19`，剛好等於字典序 ⇒
     「順序有沒有被打亂」那條永遠測不出東西。改成不照字典序排。

### 未處理（Fable 提出、判斷後決定不動）

- **高傲指令的放行時機比卡面寬**：只要輪到我、戰鬥場是貓老大ex 就常駐放行整個回合，而不是
  「宣告該招式時」。要收緊就得先讓 client 在宣告前先跟伺服器要一次揭示（＝把這張卡改成
  伺服器端 pending），那是 Wilson 已裁定不在本批做的選項。
- **`/action` 要求 verified 的代價**：超過 1 小時的長對局、且瀏覽器連不上 Google 的 token 刷新端點
  （但連得到 Oracle VM）時，玩家會被 403 擋住所有動作直到判負。改版前這種玩家靠 fallback 還能打完。
  安全性換來的已知代價，屬邊緣案例。

### 已知缺口（留給下一批）

- **自己的牌庫順序與獎賞內容，client 端仍看得到**。這個**不能**照樣遮：站上「牌庫裡沒有可搜尋
  對象 ⇒ 訓練家不能使用」這類 gate（Rule 26a）是**在 client 算的**，遮掉自己的牌庫會讓那些 gate
  全部誤判。要根治得把可用性判定搬到伺服器（＝既有待辦「伺服器單邊建局」）。
- `/state` 回應仍含 `seats`（雙方 Firebase uid）。因為座位判定已改成只認 verified token，知道 uid
  也無法假冒；列在這裡是提醒它還在。

**部署**：動到 `oracle-admin/server_admin_patch.js` ⇒ Wilson 要跑 `redeploy-oracle.bat`
（另兩支 bat 照常）。

## v6.149 — 事故根治：Service Worker 把 `/api/` 的斷線偽裝成正常回應 ＋ 失聯零提示

**事故**（2026-08-09 網站賽-61 R6，`mr_evt_mskq8zkv_r6_m1`，dump 已存檔）：
村村 22:45:55 拿到回合後畫面凍結，22:52 回報「直接卡死」、22:54「我這邊顯示對方閒置超過時間，
結果我重新整理 變成我閒置超過」。伺服器 22:49 依權威盤面（`activePlayerIndex=1`）判他閒置逾時。

**伺服器沒判錯**（`server_admin_patch.js` L5801-5845 用 `currentActorSeat(gs)` + `lastActionAt`）。
問題在他的 client 停在版本 < 15 的舊盤面（那時還是對手回合），本地把「對手閒置倒數」走到 0。

**根因（Fable 5 找到、我逐行查證）**：`/api/tournament/…` 是**同源**路徑，
`src/service-worker.ts` 的 fetch handler 只跳過 `/music/`、跨域、vite dev ⇒ API 落到 network-first：
成功寫進 cache、**失敗就把同 URL 的舊 200 回給頁面**。連鎖：
1. `tApi` 拿到假成功 → `_tLastPollOkAt` 被更新 ⇒ **唯一偵測斷線的 6 秒看門狗永遠不會 fire**；
2. 進場抓的 `v=-1` 全量也被快取，而兩個看門狗的救援都是 `v=-1` 且**繞過版本檢查直接覆蓋 game**
   ⇒ 斷線時會把盤面倒轉回開局快照 —— **自癒機制變成餵毒機制**；
3. 三處失敗路徑（poll／兩個看門狗）**全部靜默 catch** ⇒ 失聯八分鐘畫面零像素變化。

**修法**：
- SW fetch handler 在 `respond()` 之前 `if (url.pathname.startsWith('/api/')) return;`（直接 return，
  交還瀏覽器原生 fetch）。⚠ 這行的註解**不能寫成 `/api/…/` 加星號** —— 在 `//` 行註解裡出現
  「斜線＋星號」會被「先剝區塊註解」的掃描器當成 block comment 開頭、一路吃掉底下的真程式碼
  （本版守衛就是這樣抓到我的）。
- 輪詢停擺看門狗不再自我安撫：改用獨立的 `_tPollStallGuardAt` 節流，`_tLastPollOkAt` 只在
  **真的收到伺服器回應**時更新。
- 新增連線健康橫幅：失聯 ≥10 秒顯示紅色提示 + 「立即重新同步」+「✕」，並明講**閒置倒數仍在計算**。

**⭐⭐⭐ Fable 5 審查抓到我這批自己的兩個缺口（已修）**：
- **(a) 橫幅寫在桌機 `{:else}` 分支內，手機直式玩家完全看不到** —— 而我的註解還寫著
  「不在 isPortraitMobile 分支內」（**又一次註解與碼相反**）。事故當事人很可能就是手機玩家 ⇒
  這批對他等於 0% 改善。已移到分支外（同 v6.122 補位 modal 的既定做法），
  **守衛補「位置」斷言**（v6.148 才學到的：守衛要斷言位置，不是只斷言「有渲染」）。
- **(b) 高延遲活鎖**：RTT 持續 ≥6 秒時，看門狗每 6 秒 `++tPollGen`，在途 poll 全被
  `gen !== tPollGen` 丟棄而**不記存活** ⇒ `_tLastPollOkAt` 永遠不前進 ⇒ 橫幅一直爬升、
  每 6 秒再送一發 `v=-1` 全量（失聯時反而加重）。已在看門狗救援與 `tForceResync` 成功時
  補上 `_tLastPollOkAt` 更新（那是貨真價實的伺服器回應），順帶讓「立即重新同步」按了能馬上收掉橫幅。
- `_tNetBannerDismissAt` 改 `$state`（plain let 要等下一次重算才收掉，按 ✕ 最多延遲 1 秒）。

**⚠ 上線後的預期變化（不是回歸）**：SW 修好後，以前被假 200 掩蓋的失敗會真的浮現，
`tournamentDispatch` 的「網路錯誤」提示頻率會上升 —— 那是誠實，不是新 bug。

**守衛** `scripts/test-v6149-sw-api-bypass-and-net-banner.mjs`（9 項，對 v6.148 跑 8 FAIL）。
另修 `test-v6146` 兩個因排版/呼叫點數變動而失效的錨點（把長錨點縮成不鎖排版的短錨點；
呼叫點 5→6 並註明新增的是橫幅手動同步、且橫幅已排除 game-over）。

**⚠ 事故當下正式站是 v6.144**（Fable 量 index.html/SW 的 last-modified：含 v6.148 的 build 是
8/10 00:16 才上，在事故之後）⇒ 與 v6.146/147/148 無因果關係，那三版也救不了這個失效模式。

## v6.148 — 輪詢節奏中央化（活躍期加密＋防自我壅塞）＋ 預測前的 pool 完整性 gate

延續 v6.147 的「等待端」。Fable 5 上輪列的 C3/C4 與它實測抓到的 pool 缺口，這批一起做。

### ① 輪詢節奏收斂成單一中央述詞 `tPollDesiredMs(spectate)`
v6.146 的 game-over 降頻是用「每 N 輪」的 closure 計數器實作，這批改成**時間判準**，
主輪詢與觀戰共用同一個述詞（base tick 統一 400ms，實際多久送一次由述詞決定）：
- 對戰已結束：有勝負 12s／平手待裁定 6s／觀戰 10s（維持 v6.146 的裁定，只是換實作）
- **活躍期間 → 800ms**（1.2 秒 → 0.8 秒）。⚠ 快檔三個條件缺一不可：只在 `playing`、
  只在「等對手」（自己回合走 dispatch 本來就即時，快 poll 是白費，這條把快檔人口砍半）、
  且盤面 15 秒內**真的**變動過。長考／掛機自動退回 1200ms。
  ⚠ base tick 是 400ms，寫 600 會被量化成 800 ⇒ 直接寫 800，避免文件與行為不符。

### ② C4 防自我壅塞
`setInterval` **不等前一發完成**，RTT 飆高時會一直疊送、在隧道排隊，延遲雪上加霜。
v6.135 只修了亂序的**正確性**（`reqV === tVersion` 守衛），沒防壅塞本身。
主輪詢與觀戰各加一個 in-flight 旗標，`finally` 一定放掉（漏放會讓輪詢永久停擺，守衛有釘）。

### ③ 預測前的 pool 完整性 gate（gate ②b）
Fable 5 實測：引擎讀對手特性用 `pool.get(inst.cardId)`，卡包還沒載入時拿到 undefined 會
**靜默當成「沒有這個特性」**。實證——對手備戰有【黏美龍】｜黏滑失足時，full pool 正確回
`randomness:1`（撤退要擲幣），把黏美龍從 pool 拿掉就變成「預測成功」。
`ensurePoolForStateIds` 是 async void，進場／對手換卡包時有 race 窗。
不是公平性問題（伺服器權威、回滾健全），但會造成畫面閃爍 ⇒ fail-closed 擋掉。
⚠ **只查場上（雙方 active/bench）與場地**，不查對手手牌/牌庫/獎賞 —— 那是隱藏區，
client 拿到的本來就是遮蔽資料，拿它當判準會讓預測全面失效。守衛兩個方向都有正對照。

### ⭐⭐⭐ Fable 5 審查抓到我自己這批的兩個「改了卻沒生效」

**(a) C4 的早退寫在 `try` 內 ⇒ 防壅塞完全失效。**
`return` 在 try 內一樣會執行 `finally`，於是每個「因為忙碌而跳過」的 tick 都會把
**在途那一發設的旗標**清掉。Fable 模擬：RTT 2 秒時同時在途最高 **3 發**（目標是 1 發），
修正（早退移到 try 之外）後才是 1 發。
⚠⚠ **我的守衛第一版正是斷言那個壞掉的 pattern 為「正確」** —— v6.137「斷言有呼叫 ≠ 事情有發生」
的翻版。守衛已加「早退必須在 `try {` 之前」的位置斷言。

**(b) `_tLastStateChangeAt` 被看門狗每 8 秒推一次 ⇒ 快檔變常態。**
`tForceResync()` 末尾原本**無條件**更新 anchor，而 playing 階段的新鮮度看門狗每 8 秒觸發一次
resync ⇒「盤面最近有變動」永遠成立。Fable 模擬（對手長考 120 秒、盤面零真更新）：
現行寫法 **93% 的時間都落在快檔**、1.22 req/s/人；把 anchor 移進「版本真的不同」的分支後 0%。
（這行正是 v6.146 診斷 8 秒無限迴圈時看到的同一行 —— 當時只擋了 game-over，playing 這邊還在。）

其他一併修：大廳聊天刷新從「每 5 輪」改**時間判準**（節奏一變就漂移）、
`optimistic.ts` 註解寫「只查場上與自己手牌」但碼裡沒查手牌（註解與碼相反）、一個死三元。

### ⚠⚠ Fable 查證時發現、**與本批無關但必須另案處理**的公平性缺口
玩家端 `/api/tournament/state` **完全沒有 redact**（`server_admin_patch.js` 直接回 `doc.gameState`，
只有 `/spectate/state` 有遮手牌）⇒ 對手手牌、甚至牌庫順序，用 devtools 就看得到。
依既有規則（公平性/作弊類不寫公開 changelog）只記在這裡；修正屬伺服器端，要另開一批。

### 守衛 `scripts/test-v6148-poll-cadence-and-pool-gate.mjs`（8 項，對 v6.147 跑 4 FAIL）
行為端三條（pool 缺卡要擋／pool 完整不得誤擋／隱藏區未知卡不得擋）＋靜態三條
（中央述詞的三個數值、base tick 必須小於最短間隔、in-flight 旗標與 finally）。
另把 `test-v6146` 的兩條斷言改寫成對新中央述詞的檢查（判準不變，只換實作錨點）。

## v6.147 — 「按了沒反應」的兩個真因：tInFlight 零 template 綁定 ＋ 樂觀更新只放行一種動作

**站長原話**：「這個 lag 的問題修了好多次都沒處理好」。前幾輪修的都是**伺服器負載端**
（v6.118 誤訂閱大廳輪詢、v6.119/120 降載、v6.146 對戰結束後的空轉），
但玩家喊的「卡」在**自己回合按下按鈕到畫面更新**這一段。Fable 5 獨立診斷 + 我方逐行查證。

### ① `tInFlight` 加了旗標，卻沒有任何 template 綁定
v6.137 引進 `tInFlight`（對戰動作的網路單發鎖），但 **`disabled={tInFlight}` 在整份
`+page.svelte` 出現 0 次**（grep 確認）⇒ 往返期間按鈕外觀完全不變，玩家第二次點擊還會被
`tournamentDispatch` 開頭直接丟棄並跳一行紅字。體感就是「按了沒反應、要再按一次」。

修法：建立**唯一**的中央述詞 `const actionBusy = $derived(isTournament && tInFlight)`，
桌機 13 類送出點 + 手機直式 4 類全部綁上，狀態列加「⏳ 送出中…」chip。
⚠ 刻意**不做全畫面遮罩** —— `tApi` 有 12 秒逾時保護，全域鎖會讓網路卡住時玩家連
設定／離開／放大鏡都按不了。手機版是子元件，必須新增 `actionBusy` prop 傳進去
（不傳就永遠是 false ＝ 靜默失效，守衛有釘住父層有沒有傳）。

### ② 樂觀更新白名單第二批
放行 `PLAY_BASIC` / `RETREAT` / `PLAY_FOSSIL`（`ATTACH_ENERGY` 是第一批）。
**白名單一律用 harness 對真盤面實跑決定，不照直覺列**，實跑結論：
- `EVOLVE` —— 30 條進化鏈 30/30 `randomness:1`。進化建新實例、新 iid 來自 `uid()`
  ⇒ 同時踩 gate ⑩。本地 iid 與伺服器必然不同，玩家若拿預測 iid 送 `RESOLVE_SELECTION`
  會被伺服器 sanitize 清空 → 效果**靜默消失**（v6.129「validIids 死資料」的鏡像）。**結構性，不放行。**
- `PLAY_TRAINER`（含只附道具）—— `opens-pending`，第一段就開 picker。它本來就是
  「兩個串行往返」的結構，要改善得改成單段動作，不是放寬白名單能解決。
- `END_TURN` —— `turn-flipped`，本來就該等伺服器。

### ⭐⭐ 順手抓到的 gate 漏洞：gate ⑤ 只比物件同一性
`USE_STADIUM` 第一次實跑顯示「可預測」，差點就放行了。**真相是 fixture 場上沒有場地卡、
引擎其實什麼都沒做，卻回了一份淺拷貝** —— 舊的 gate ⑤（`predicted === base`）判不出來，
於是把「什麼都沒發生」當成有效預測畫上去。備戰已滿的 `PLAY_BASIC` 也是同一形狀。
⇒ 新增 **gate ⑤b**：用輕量指紋（雙方 active/bench/各區張數 + log 長度 + 回合 + 場地 iid）
比對，盤面完全沒變一律判成不預測。不用 `JSON.stringify`（盤面含整份 log，太重）。
**通則：「引擎拒絕」不能只看物件同一性 —— 有的 handler 拒絕時仍會回新物件。**

### Fable 5 審查追加（同版補上）
- ⭐**點擊派附能整條沒 gate**：我只擋了手牌的 `onpointerdown`（拖曳派），但「點手牌能量 → 點目標」
  這條 `onclick → onAttachEnergy` 完全沒查 —— 而附能是最高頻動作。已在 `onAttachEnergy` 與
  `triggerHandActivateAbility` 兩個函式端 + 手牌 `onclick` 三處補 `if (actionBusy) return;`。
- **setup / mulligan 六顆按鈕沒綁**（準備完成／完成補抽／開局重抽／用牠開局，桌機＋手機）。
  setup 是 CAS 衝突歷史事故最密集的區段，「按了沒反應」的回報有一部分來自這裡。已補。
- **兩個自動計時器**（自動取獎、自動結束回合）撞上 in-flight 會被丟棄並跳「上一個動作還在送出中」
  紅字，玩家完全不知道那是計時器發的。已改成 `if (actionBusy) return;`（計時器會再排）。
- Fable 實測發現、**列為下一批**的一條：`tryPredictAction` 沒有「盤面上的 cardId 是否都在 pool」
  的 gate —— 對手卡包尚未載入時（`ensurePoolForStateIds` 是 async void，有 race 窗），
  引擎讀不到對手特性會**靜默當成沒有**，於是像「對手黏美龍｜黏滑失足」這種本該擋下預測的情境
  會被誤放行。不是公平性問題（伺服器權威、回滾健全），是低機率的畫面閃爍。
- Fable 確認的兩件事：①`actionBusy` 只在錦標賽為真是對的（休閒線上的 dispatch 本來就是
  先本地 applyAction 再 push，天生樂觀，掛上去反而鎖住即時 UI）；
  ②我調整兩個既有守衛前提的判斷正確，沒有「把 bug 固化成契約」的成分。

### 守衛 `scripts/test-v6147-optimistic-batch2-and-busy.mjs`（17 項，v6.146 跑 11 FAIL）
- A 行為端：四個放行動作各一條正對照；負對照包含「對手【黏美龍】｜黏滑失足在場時撤退要擲幣」。
  ⚠ 這裡刻意**不用**「混亂狀態撤退」當負對照 —— 現行規則的混亂只影響使用招式，
  撤退不受影響，那條路徑本來就是確定性的，拿它當負對照是錯的期待（我第一版就寫錯，被實跑打臉）。
- 三條「不得放行」的鎖（EVOLVE / PLAY_TRAINER / END_TURN），其中 EVOLVE 還加了
  「就算有人硬放進白名單，底層 gate 也必須擋住」的雙保險。
- B 靜態：`actionBusy` 必須由 `isTournament && tInFlight` 算出、13 類桌機送出點逐一釘住、
  手機 Props/解構/父層傳遞三處都要有、且**禁止**改成全畫面遮罩。全部在 stripComments 之後比對。

## v6.146 — 對戰結束後三條迴圈仍在全速跑（含一個 8 秒抓全量盤面的無限迴圈）

**來源**：站長回報「很多玩家反應錦標賽很卡」，營運端 AI 觀測到「對戰已 `status=done`，
玩家前端仍高頻 poll `/api/tournament/state`」，一場賽事三場對戰同時掛著，5 分鐘 819 個無效 request。

**逐行查證結果**（`src/routes/game/+page.svelte`）：
- 勝負視窗出現後**沒有自動跳轉**，玩家要自己按「🏆 返回賽事大廳」（11239）—— 這是設計不是 bug，
  但玩家不知道要按，於是掛著。
- 停 `tPollTimer` 只有 5 處，全部是「主動離開」（onDestroy 3877／tLeaveMatch 4384／tLeaveSpectate 4549／
  登出／重建 timer），**沒有任何一處看 `phase === 'game-over'`**。
- ⭐⭐ 更關鍵：新鮮度看門狗（8 秒盤面沒動 → `tForceResync()` 抓 `v=-1` 全量盤面）也沒排除 game-over，
  而 `tForceResync()` 末尾是**無條件**把 `_tLastStateChangeAt` 推到現在（4694）
  ⇒「8 秒 stale → 抓全量 → 重設計時 → 再 8 秒」的**無限迴圈**，而且每次還 `startTournamentPoll()` 重建 timer。
  伺服器 log 裡週期性出現的 4~5KB `?v=-1` 就是這個，**不是玩家在按 F5**。
- 觀戰輪詢 2 秒一次，done 之後照抓，且 `/spectate/state` 一律回全量 redact 盤面。

**修法**：三條迴圈都改成「game-over 時降頻」而**不是** clearInterval —
⚠ `winner == null` 的平手要「等待管理員裁定」，裁定會 bump 伺服器盤面版本
（`oracle-admin/server_admin_patch.js:4651`），停掉輪詢那些玩家就永遠等不到結果。
⇒ 有勝負→每 10 輪（約 12 秒）；平手待裁定→每 5 輪（約 6 秒）；觀戰→每 5 輪（約 10 秒）。省 90%+。

**Fable 5 審查追加**：`_goTick` 是 `startTournamentPoll()` 的 closure 變數，任何人重建 timer 就會歸零。
目前 4 個呼叫點中兩個看門狗已被 `!_tOver` 擋住、另兩個是人為進場 —— 但這是隱性耦合，
所以守衛加一條「`startTournamentPoll()` 出現次數 === 5（1 定義 + 4 呼叫）」的枚舉鎖。

**守衛** `scripts/test-v6146-gameover-poll-throttle.mjs`（8 項，HEAD 跑 6 FAIL）。
⚠ 本檔與被測檔的註解裡都寫滿 `game-over`，所有斷言都在 **stripComments 之後**的原始碼上比對，
並附四條自我驗證（剝註解有效／沒把程式碼一起剝掉／等長替換／被測檔註解確實消失）——
v6.139 就是被頁面註解餵成假綠過。

**⚠ 這一版治的是伺服器負載端，不是玩家喊的「卡」。** Fable 5 獨立診斷的真因排序見下一節。

### 玩家「卡」的真因排序（Fable 5 診斷 + 我方查證，尚未實作）

- **B1（最大宗）自己回合每個動作 = 一次阻塞式 RTT，且往返期間 UI 零回饋、連點被丟棄。**
  樂觀更新白名單只有 `ATTACH_ENERGY` 一種（`src/lib/game/optimistic.ts:33`）。
  ⭐ **`disabled={tInFlight}` 在整份 `+page.svelte` 出現 0 次**（我 grep 確認）——
  往返期間按鈕外觀完全不變，第二擊還會被 4796 分支丟棄並跳紅字。玩家翻譯＝「按了沒反應」。
  物品/支援者幾乎都是 `PLAY_TRAINER` + `RESOLVE_SELECTION` **兩個串行 RTT**，重物品牌組一回合 10~15 次。
- **B2 跨玩家互動 = 輪詢間隔疊加**：pendingSelection ping-pong 一次 2~3 秒起跳。
- **B3 渲染端可排除**：hot derived 都是線性掃描、主要 each 都有 iid key、`ensurePoolForStateIds` 有早退。
- B4 每個 `tApi` 都 `await getIdToken()`（4230），token 每小時刷新那發多一次 Google 往返。

**下一批建議順序**：①`tInFlight` 接視覺 busy 態（純前端、風險最低、體感最大）
②樂觀更新第二批白名單（`PLAY_BASIC`／`EVOLVE`／`RETREAT`／化石／`USE_STADIUM`／
`PLAY_TRAINER` 僅限 `PokemonTool`；**不要放** `RESOLVE_SELECTION`）
③等待端 burst 輪詢，中期做伺服器長輪詢 `/state?wait=1`
④poll 防自我壅塞（上一發未回就跳過本 tick）⑤RTT 量測經 `/clientdiag` 採樣上報。

## v6.145 — 「改寫招式所需能量」的特性整族漏掉特性生效閘（7 個點行為端 7/7 中）

**觸發**：Wilson 回報「狙射樹梟ex 特性發動疑似有誤」。

**先排除的假設**：條件本身沒錯。行為端四案（對手手牌 4 / 3 / 5、以及「自己 4 對手 7」的
讀錯對象診斷案）跑 `canAffordAttack`，結果 true / false / false / false —— 「恰為 4 張」
與「讀的是對手的手牌」都正確。

**真因（整族）**：`engine.ts` `canAffordAttack` 內所有**特性型**費用改寫點，全部只比對
卡名或特性名，**沒有問這個特性此刻有沒有被消除**。把持有者標上 `abilityNullifiedThisTurn`
（招式版暗夜羽擊）後行為端實測 7/7 照樣生效：

| 特性 | 卡 | 效果 |
|---|---|---|
| 狙擊手之眼 | 狙射樹梟ex | 對手手牌恰 4 張 → 全消【無】 |
| 化身團結 | 龍捲雲／雷電雲／土地雲／眷戀雲 | 四化身雲齊聚 → 全消【無】 |
| 喧鬧競技 | 熾焰咆哮虎ex | 減對手備戰數個【無】 |
| 事先準備 | 好勝毛蟹／輕身鱈 | 減棄牌區「海岱」張數個【無】 |
| 老練招式 | 月月熊 赫月ex | 減對手已取獎賞數個【無】 |
| 反等離子 | 酋雷姆 | 對手棄牌區有阿克羅瑪 → 改為 1【無】 |
| 原始根 | 陳舊的根狀化石 | 對手【基礎】+1【無】（方向相反） |
| 亮亮泡 / 調諧迴響 | 瑪力露麗／音波龍 | 同族，一併接閘 |

同檔的鄰居早就有閘：被動最大 HP（v5.999）、大竺葵繁茂（v5.601）、撤退費歸零（v6.070）都走
`isAbilityHolderEffective`。費用改寫是唯一漏網的一族 —— 典型的「中央述詞寫好了，但消費點沒接」。

**修法（中央收斂）**：
- `effects.ts` 新增 `isCostModifierAbilityEffective(state, inst, card, ownerIdx, abilityName, pool)`，
  內部自行判定 active/bench 後委派 `isAbilityHolderEffective`（涵蓋初始化／監視塔／熔岩洞／
  暗夜羽擊／黏著束縛全部來源）。缺場上脈絡或卡上沒印該特性 → 回 true（維持既有行為）。
- `engine.ts` `canAffordAttack` 建立區域述詞 `abilityOn(特性名)`，7 個點全部接上；
  `原始根` 因為是**對手**化石的特性，用 defender 的 instance 判。
- `getDecidueyeSnipeEffectiveCost` 的生效述詞設成**必填參數**（刻意不給預設值）——
  新呼叫端忘了傳會編譯錯，而不是靜默退回沒有 gate 的舊行為。
- 同輪鄰居缺口：`黏美龍｜黏滑失足`（撤退擲幣）也只比對特性名，一併補閘。
  黏美龍是 Stage2 → 傳說的熔岩洞在場時本來就不該擋撤退。

**不接閘的（刻意）**：觸手激怒／反撲剪是**招式自帶**條件（八爪武師／鐵螯龍蝦沒有特性）、
夜間礦山是場地、反擊增幅器／赫普的講究頭帶是道具 —— 都不是特性，不走這個閘。

**守衛** `scripts/test-v6145-cost-modifier-ability-gate.mjs`（12 項，HEAD 跑 10 FAIL）：
- A 行為端 7 案，每案都有「特性有效→打得出來」的正對照（否則 fixture 壞掉會變假綠）。
- B 靜態枚舉：從 `static/cards` 掃出所有 H/I/J live 且效果含「能量＋所需/必要」、
  排除【撤退】族的特性名，要求每個都出現在 `abilityOn('…')` 或 `ABILITY_COLORLESS_COST_ZERO`。
  掃描器自我驗證兩條（枚舉非空且含七個已知成員／不存在的特性名必須被判為沒接閘），
  避免 Rule 25 的「枚舉守衛自己有洞」。

**Fable 5 審查追加（同版一起修）**：把原始根接上閘之後，反而暴露出中央閘自己的兩個化石誤判。
化石卡 `rulesText` 明文「這張卡可作為 HP60 的**【無】屬性的【基礎】寶可夢**放置於場上」，但：
- `isNullifiedByLegendCave` 讀 `stage ?? subtype` → 化石取到 `'Item'` ≠ `'Basic'` → 被當成**進化**寶可夢，
  傳說的熔岩洞誤消除化石特性。⚠ 該函式的註解自己寫「化石放到備戰後是 Basic → 不消除」，
  **與實際程式碼相反**（又一次「註解不可信、要看實際碼」）。
- `isNullifiedByRocketWatchtower` 讀 `card.pokemonType`（化石卡是 null）→ 監視塔**漏**消除化石特性。
兩者都改為多傳 `holderInst` 並讀 `fossilOnField`。這個 bug 從 v6.077 就在，只是原始根原本沒接閘所以看不出來
（也影響羽毛守護／背蓋等所有化石特性）。守衛補了兩條場地情境。
另外把枚舉措辭加寬到「需要」，並先剝掉方括號提醒文（否則古空棘魚｜潛入記憶的
「[需要有足夠使用招式的能量。]」會變成假陽性）。


## v6.144 — 顯示名稱預設用最近一次報名暱稱（不再是 email 前綴）＋ 說明可編輯 ＋ 既有投稿回填

玩家回報：公布欄顯示的還是 email。

### 真根因：正確做法早就有，只是沒接上

`tournIdentity` 的 `name` 在 Firebase token 沒有 displayName 時會退成
**`dec.email.split('@')[0]`**（email 前綴）。v6.143 只改了賽事投稿（用歸檔的報名暱稱），
**一般投稿仍走 `id.name`** ⇒ 顯示 email 前綴。

而 **v0.76 早就為聊天室做了正確版本**（查 TREGS 最近一次報名暱稱＋5 分鐘快取），
但那段是寫死在聊天 handler 裡的 inline 實作，公布欄自然接不到。
⇒ 抽成中央 helper **`getLastRegisteredNick(uid)`**，聊天與公布欄共用同一份；
守衛加一條「全站不得有第二份 inline 的最近報名暱稱查詢」。

### 回填既有投稿

`POST /api/admin/deck-posts/backfill-names`（admin，支援 `?dry=1` 預覽）。
⚠ 判準**只改 `authorName === email 的 @ 前面那段`** 的投稿 —— 那正是 fallback 的產物；
玩家自己設定的名稱不會剛好等於它，所以不會覆蓋任何人的手動設定。
查不到報名暱稱的一律略過（**不亂編名字**）。回應含 `skipped` 三種原因與前 50 筆 diff。

### 說明內容也開放編輯（Wilson 追加）

`/:id/rename` 端點擴充成同時可改 `authorName` 與 `notes`，兩者都是「有送才改」。
⚠ **`entries` 與 `deckName` 永遠不可改** —— 換皮繼承讚的風險在**牌組內容**：
拿一篇高讚投稿把 60 張換掉，讚數就白白繼承了。說明文字不影響「這是哪一副牌」，
內容不當則有 admin 下架兜底。守衛把「不得出現 `$set.entries`／`$set.deckName`」釘死。
路徑維持 `/rename`（已上線 API，改名的破壞性大於命名精確性）。

前端「我的投稿」的改名輸入框改成展開式編輯區（名稱＋說明兩欄）。

守衛：後端 41 項、前端 29 項。HEAD-FAIL 4 紅／2 紅。完整 `npm test` 全綠。

⚠ 需跑 `redeploy-oracle.bat`。部署後請到 admin 呼叫一次回填端點
（先 `?dry=1` 看要改幾筆，確認無誤再不帶參數執行）。

## v6.143 — 公布欄顯示名稱改用「報名那場賽事時的暱稱」，且可自行修改

Wilson 指定兩件事（已用選項確認過語意，避免我猜錯）：
① 賽事投稿顯示的玩家名稱要用**比賽當時的名稱** ② 玩家可以自己編輯修改。

### 後端

- `dpInsert` 新增可選 `authorName`；`tournament-submit` 傳歸檔的 **`players[].name`**
  （報名那場賽事時填的暱稱）。原本用的是 `tournIdentity` 回的帳號當下顯示名 ——
  玩家改過帳號暱稱後，公布欄的名字會跟賽程表對不起來。一般投稿沒有這個來源，仍退回帳號名。
- 新端點 `POST /api/deck-posts/:id/rename`。
  ⚠ **只 `$set` authorName**：牌組內容與說明維持不可編輯 —— 能改內容就能拿高讚投稿換皮繼承
  別人給的讚，那是當初把投稿設計成 immutable 的唯一理由；改名字沒有這個問題。
  限本人、排除已刪除、限流 10/min、改完清列表快取（否則公開列表最多 30 秒還顯示舊名）。
  ⚠ 路徑 `/:id/rename` 是**兩段**，不會被 `/:id` 單段 pattern 吃掉（比照 `/:id/like`；v6.138 的坑）。

### 前端

「我的投稿」每一列可就地編輯顯示名稱（Enter 儲存、Esc 取消），存檔後同時重抓公開列表。

### ⚠ 守衛自己的第三種踩法：**切片 anchor 不能用註解**

`sliceFn` 的結尾 anchor 我一開始寫成 `'  // ── 投稿'`，但掃描的是**剝過註解**的版本
⇒ `indexOf` 回 -1，而 `slice(start, -1)` 是合法的「切到倒數第一個字元」
⇒ 斷言靜默地變成**在掃全檔**，於是「saveRename 不得出現 deckName」當然紅。
加了 `sliceFn` helper，兩端 anchor 都找不到就直接報錯，不再靜默退化成全檔掃描。
（前兩種是：參數解構害 `extractFn` 只抽到參數列、註解裡的字騙過否定型斷言。）

守衛：後端 +3（38 項）、前端 +2（29 項）。HEAD-FAIL 各 3 紅／2 紅。完整 `npm test` 全綠。

⚠ 需跑 `redeploy-oracle.bat`（新端點）。

## v6.142 — 牌組公布欄手機版避開 iOS 動態島

玩家回報：有動態島的 iPhone 上，公布欄頁最上方的「← 首頁」被系統 UI 蓋住按不到。

`/deck-posts` 是新頁，我寫的時候 `main` 直接用 `padding: 12px 16px 48px`，**沒有帶
`env(safe-area-inset-top)`** —— 而全站其他頁早就有這個標準：`/cards` 是
`calc(1rem + env(safe-area-inset-top, 0))`、`/decks` 是 1.5rem、首頁是 2rem，
`app.html` 也早就有 `viewport-fit=cover`（`env()` 要有它才有值）。照同一套補上。

三處都補：
- `main` 的 padding（上緣＋左右，左右處理橫向瀏海）
- `.modal-backdrop` / `.modal`（modal 貼齊上緣時關閉鈕同樣會被蓋住；`max-height` 也要扣掉
  上下安全區，否則內容會被推出畫面）
- ⚠ **手機斷點**：原本 `@media (max-width: 600px)` 裡寫的是 `padding: 10px 12px 40px`，
  這會把上面那條 safe-area **整條覆蓋掉** —— 也就是說只補桌機版的話，動態島機種依然按不到。
  這是這類修正最容易漏的地方，守衛專門釘了一條。

守衛 `test-deck-posts-page.mjs` +3 項（27 項）。HEAD-FAIL：還原頁面後恰好那 3 條紅。
完整 `npm test` 全綠。

## v6.141 — 閃光屏障擋不住油之機關槍（＋同維度第二個漏網：球形盾牌）

玩家回報：雷電獸使用「閃光屏障」後仍被奧利瓦ex「油之機關槍」打死。**屬實**，行為端已重現。

### 卡面（`static/cards` 台灣官方，唯一權威）

- 雷電獸｜閃光屏障（M5，J）：「在下個對手的回合，這隻寶可夢不會受到**進化寶可夢招式的傷害**。」
- 奧利瓦ex｜油之機關槍（I）：「選擇6次對手的寶可夢，對所選的所有寶可夢**不計算弱點・抵抗力**，
  造成其選擇次數×20點傷害。」奧利瓦ex `stage='Stage2'` ⇒ 是進化寶可夢 ⇒ 應該被擋。

### 根因兩層

1. `regPre` 帶了 **`skipDefEffects: true`**，但卡面逐字**只有**「不計算弱點・抵抗力」，
   **沒有**「不計算對手的戰鬥寶可夢身上的附加效果」—— 而後者正是 `skipDefEffects` 的語意
   （會 bypass 全部 defender 免疫與減傷）。判準是卡面有沒有那句話，不是實作方便。
2. 更關鍵：`regR('olive-oil-distribute')` 的傷害迴圈**自己手刻**，檢查了中立中心／
   `passiveImmunityDamageBlock`／`resolveBenchGuard`（僅 bench）／`passiveCoinImmunity` 四段，
   **獨漏 active 的 per-turn 免疫旗標**（閃光屏障就在那一組，還有飛翔／要害斬／阿塞蘿拉／
   精神防護／熔岩牆／防護代碼／塗層攻擊）。v4.18 曾移除 `canApplyAttackEffectToTarget`
   —— 理由正確（薄霧能量那類只擋招式效果、不該擋傷害），但**沒有換成 `attack-damage`
   語意的版本**，於是連純傷害免疫也一起丟了。

### 中央收斂

新增 `resolveMultiTargetDamageGuard`（effects.ts），四層一次到位：中立中心 → 特性免疫 →
`canApplyEffectToTarget('attack-damage', {isBench})`（內含備戰守衛與 active 的 per-turn 旗標）→
擲幣免疫。⚠ 用 `attack-damage` 而非 `attack-effect`，才不會重蹈 v4.18 的誤擋。
⚠ 附 `skipCoin` 選項：擲幣層**會真的消耗亂數**，caller 已擲過就必須跳過（v6.120「同一效果
掛兩個 hook」的同型陷阱）。

### 維度掃描：14 張候選，13 張是正確行為

行為端掃全部 HIJ 進化寶可夢招式，抓到 14 張「閃光屏障擋不住」，逐張查卡面後：
7 張卡面明文寫「不計算對手的戰鬥寶可夢身上的**附加效果**」（跳躍扣殺／偉大剪／星雲光束／
高速星星／打垮／鑽破壞）⇒ 穿透正確；4 張是「**放置傷害指示物**」（纏擾／氣功指壓／偏道一回／
詛咒水滴）⇒ 閃光屏障擋的是「招式的**傷害**」，不擋放指示物（`PTCG_RULES.md` L620／L705／L713
散佈詛咒 Q&A 與 L510 太晶段同一二分法）；2 張根本不是傷害（陣風返＝放回牌庫、同命戰鬥＝效果昏厥）。
**真漏網只有油之機關槍一張。**

⚠ 我原本把棄世猴｜幽靈打擊的「無屏障 150 / 有屏障 50」列為存疑，Fable 5 指出那是**全場加總**：
戰鬥位吃 100（有屏障時被擋）＋備戰吃 5×10=50（指示物照放）。數字完全對得上，不是 bug。

### Fable 5 review 行為端抓到同維度第二個漏網（已自行重現確認）

`hitBenchAll`（effects.ts）手刻了太晶／藏隱・深度下潛／花之帷幔／神秘石居／擲幣／太古防壁，
但**漏掉整組 per-turn 與 passive 的備戰免疫**。實測：電飛鼠｜天空波（「雙方的所有備戰寶可夢
也各受到10點傷害」）對**蟲甲聖｜球形盾牌**（「只要這隻寶可夢在場上，自己的所有備戰寶可夢
不會受到對手的寶可夢招式的傷害與效果的影響」）保護下的備戰，仍照打 10。已接同一支中央閘。

⚠ 兩件必須保留的分流：`attackerIdx !== targetIdx`（中央閘是「對手側」語意，自傷 bench 的
地震／燃燒熱浪不可套用，否則自己的備戰會被自己的盾牌擋住）與 `skipCoin: true`（該函式已有
自己的擲幣段）。守衛兩條都釘住了。

### 守衛

`scripts/test-v6141-multitarget-damage-guard.mjs`（11 項，**行為端為主**）。
HEAD-FAIL：BASE 版 **4 PASS / 7 FAIL**，修後 11/0；**正對照在 BASE 版仍綠**，證明測試盤面有效
而不是整批紅。完整 `npm test` 460 步全綠。

### 🔨 Fable 指出、本版未收（下輪）

`bench-hit-N`（effects.ts:1365）與 `snipe-60-ex` 直呼 `resolveBenchGuard`，漏 v5.828 那層
per-turn 旗標與暗影【惡】能量 —— 靜態確認，未行為重現，下輪收斂前要先重現一例。
另 `manualDamageImmunity`（effects.ts:4287）目前零呼叫點且同樣缺 per-turn 層，建議標 deprecated。

⚠ 需跑 `update-tournament.bat`（引擎改動）。

## v6.140 — 牌組公布欄 批次 3（投稿、按讚、我的投稿、賽事名次一鍵分享）

功能到此完整。後端新增 `GET /api/deck-posts-mine`（⚠ 又是**連字號前綴**，寫成
`/api/deck-posts/mine` 會被 `/:id` 吃掉，v6.138 的坑）。前端加「全部投稿／我的投稿」分頁、
投稿 modal、明細按讚鈕、以及登入後才出現的賽事名次橫幅。

### Fable 5 code review（均自行查證屬實）

- **BLOCKING：刪除是裸按鈕**。緊貼 ♥/⬇ 統計、手機極易誤觸，一下就軟刪且讚數歸零，玩家端
  無復原路徑。更糟的是沒有 busy 防護 —— 連點第二下會撞伺服器的 `status: { $ne: 'deleted' }`
  回 404「找不到你的這篇投稿」⇒ **刪除明明成功了卻對玩家報錯**。補 confirm ＋ `deleteBusy`。
- **按讚失敗會把整份牌表炸掉**：`toggleLike` 的 catch 寫 `detailError`，而 modal 分支順序是
  `detailLoading → detailError → openPost` ⇒ 遇到 429 或這篇剛被下架時，玩家眼前的 60 張牌表
  會被一行錯誤取代，看起來像明細壞了。改用獨立的 `likeError` 顯示在按鈕旁。
- **被下架的投稿會把玩家永遠關在門外**：`ALIVE_CAP` 用 `status:{$ne:'deleted'}` 計，hidden 算在內；
  DELETE 端點其實允許刪 hidden，但前端只在 `published` 時渲染刪除鈕 ⇒ 被下架 10 篇的人
  從此不能投稿也無法自救。改成 `status !== 'deleted'` 都可刪。
- **投稿冷卻在驗證失敗時也被扣掉**：`dpRate` 在任何驗證**之前**就消耗 ⇒ 挑到一副不合法的牌
  被退回後，換一副合法的立刻撞 429，看起來像系統在刁難人。新增 `dpRateRefund`，
  **只在 400（內容不合格）時退**；409／429 照扣。
- **`fetchMine` 無代次防護**：auth callback 與切分頁可能同時在飛兩發，而 `deleteMine` 只改本地
  狀態 ⇒ 遲到的舊回應會把「已刪除」蓋回「published」，刪除鈕重新出現，再點就是上面那個假 404。
  補 `mineSeq`（頁內已有 `listSeq`/`detailSeq` 樣板）。
- **守衛對本批幾乎零覆蓋**：尤其「如果有人把 `-mine` 改成 `res.json(docs)` 裸回，uid/email 直接
  外流，而現有 32 項照樣全綠」—— 守衛①只測 `dpPublic` 函式本身，不測「`-mine` 有沒有走它」。
  後端 +3 項、前端 +8 項。

Fable 查證後確認無誤的：契約全對齊；`-mine` 有 projection ＋ `dpPublic` 雙層防護；
按讚是**伺服器權威寫回**（以 `r.likeCount` 為準、寫回前確認還是同一篇）不是本地 +1；
`countDownload` 刻意用裸 `fetch` 而非 `api()` 是對的（204 無 content-type，走 `api()` 會誤觸
`apiUnavailable` 把整頁藏掉）；`onAuthStateChanged` 不在 token refresh 時觸發，無重發也無漏發。

守衛：`test-deck-posts.mjs` 35 項、`test-deck-posts-page.mjs` 24 項。完整 `npm test` 全綠。

⚠ 需跑 `redeploy-oracle.bat`（`-mine` 端點與冷卻退還）。

## v6.139 — 牌組公布欄 批次 2（頁面上線：瀏覽 ＋ 匯入）

新頁 `/deck-posts`。本批**只做瀏覽與匯入**；投稿入口、按讚按鈕、「我的投稿」在批次 3。
入口放在首頁卡片列與牌組編輯器頁首。

明細用 `loadDeckSets` 只載這副牌用到的卡包（不是 `loadAllSets` 的 40 包 4.6MB），
牌表是純文字列表不渲染 60 張卡圖 —— `/cards` 全量渲染是既有效能事故源（v6.118）。
投稿內容是玩家自由輸入，**全頁禁 `{@html}`**，守衛釘住。

### Fable 5 code review 抓到的（均自行查證屬實）

- **載入中的 modal 關不掉，關掉後還會自己彈回來**：modal 顯示條件含 `detailLoading`，
  但那個分支只有一行「載入中…」沒有關閉鈕，而 `closeDetail` 又不清 `detailLoading`
  ⇒ tunnel 慢時玩家被全屏 backdrop 鎖死；而且「以為關掉了」之後遲到的回應會把 modal 重開。
- **列表切排序／換頁有亂序**：慢的舊回應最後到就蓋掉新的，tab 與內容對不上
  （與 v6.135 錦標賽輪詢是同一類 bug）。
  ⇒ 兩者共用同一套解法：`listSeq` / `detailSeq` 請求代次，只有「仍是最新一發」才寫回狀態。
- **正式站 5xx 會被說成「你在測試站」**：舊寫法把「回應不是 JSON」一律當成 API 不存在。
  但 Cloudflare tunnel 掛掉回的 502/530 也是 HTML ⇒ 正式站玩家會看到一段斷言他在測試站的
  公告，而且 `apiUnavailable` 一設就永久隱藏整個 UI、沒有重試路徑。改成 `status >= 500` 走
  「伺服器暫時無法連線」。
- **匯入的牌組會被「從雲端載入」無聲洗掉**：編輯器只在**儲存時**才 `syncDeckToCloud`，
  而它的「從雲端載入」是 `decks = sortDecks(cloud)` 整包覆蓋 ⇒ 匯入後沒編輯過的牌組會消失。
  改成匯入當下就 best-effort 同步。
- **匯入沒有置頂**：`sortDecks` 把 `order === undefined` 排在所有已設 order 的**後面**
  ⇒ 會沉到最底，與設計定案 §6 寫的「置頂」相反。補 `order: min(existing) - 1`。
- **首頁沒有入口**：定案 §6 寫的是「/decks 工具列＋首頁」，我原本只加了前者。

Fable 另外逐欄核對過 API 契約（`dpPublic` 白名單、列表 projection、明細 extras、
download 語意）與 SW／prerender（`/deck-posts` 無動態參數會自動 prerender 進 PRECACHE，
不需要動 `sw.js`；v5.966 的白屏是 `/card/` 動態子樹，這裡不適用），都無問題。

### 守衛

`scripts/test-deck-posts-page.mjs`（16 項）。
⚠ **又被註解騙了一次**：頁面頂部註解寫著「全頁不得出現 `{@html}`」與「不是 `loadAllSets`」，
掃描器把註解裡的字當成真的用到 → 兩項假紅。加 `stripComments` 並附四條自我驗證
（剝過頭／沒剝到／剝完仍看得到註解文字）。**否定型斷言必須先剝註解**；
反過來若是肯定型斷言，同一段註解會給出假綠，那更危險。
反向對照：人工注入 `{@html}` 與 `loadAllSets`，確認守衛真的抓得到。

完整 `npm test` 全綠。

## v6.138 — 牌組公布欄 批次 1（後端，玩家還看不到）

**純後端，前端零變更**；批次 2 才會有玩家看得到的頁面。設計定案見 `docs/牌組公布欄-設計定案.md`。

Wilson 拍板四項：① 名次標示＝**冠軍／亞軍／四強**（單敗淘汰沒有季軍賽，3 與 4 名本來就分不出）
② 賽事投稿**鎖定比賽當時那副**（報名時已存進 `TREGS.deckEntries` → 歸檔 `players[]`，玩家不必重傳）
③ 先發後審 ④ 名次投稿只開網站賽（`champion-report` 的名次推導本來就排除社群賽）。

### 實作

新 IIFE 掛在**賽事段閉包內**（要用 `tournIdentity` / `TPOOL` / `TENG` / `TARCHIVE` / `_detectCutPlacements`），
但**自帶 try/catch** —— 賽事段那個 catch 一觸發會連「休閒閒置自動判負」一起停用。
三個 collection：`deckPosts` / `deckPostLikes` / `deckPostDownloads`，
後兩者用 **`_id = postId + '__' + uid` 複合唯一鍵**（比照 `TREG._id: eventId+'__'+uid` 的既有慣例）
⇒ 每帳號每篇恆為 0 或 1，client 重放幾次都一樣；權威在明細表，`recount` 端點可對帳。
下載數的語意因此是「**多少個不同帳號拿過**」，不是「按了幾次」。

**牌組合法性走 `TENG.validateDeck`** —— 本版在 `build-server-engine.mjs` 的 entry 加
`export { validateDeck } from '$lib/decks/validation'`。`validation.ts` 只 import 型別、零 runtime 依賴，
可以安全打包。⚠ 這是為了**不在伺服器抄第二份規則**（v0.88／v0.93 的 `classifyDeck` 就是這個教訓）。
舊 bundle（還沒跑 `update-tournament.bat`）時 fail-open，只驗 60 張＋卡片存在，但會 `console.warn`
並在 doc 記 `validated: false` —— **fail-open 不能是靜默的**（v3.84／v6.130 同一類教訓）。

### 自行查證推翻了三處我照設計文件寫的介面

`DeckValidationResult` 的欄位是 **`legal`** 不是 `valid`（寫錯會恆為 `undefined`，整條驗證靜默失效）；
`deckToSets(cardCounts, nameMap)` 吃陣列＋Map，不是物件；`classifyDeck` 回 **`{rule, all}`** 不是 `{name}`。
三個都是「接中央 helper 前必須讀實作，不能憑印象」。

### Fable 5 code review 抓到一個擋刀級 bug（已查證屬實）

**`/api/deck-posts/tournament-eligibility` 是死路由**：Express 依註冊順序比對，
`/api/deck-posts/:id`（4932 行）在它（5103 行）之前 ⇒ 100% 被單段 pattern 吃掉，
變成 `findOne({_id:'tournament-eligibility'})` → 永遠回 **404「找不到這篇投稿」**。
不是 500、沒有 log，批次 2 一接就是全體玩家的「賽事投稿」入口壞死。
修法選**改前綴** `/api/deck-posts-tournament/*` 而不是「調整註冊順序」—— 後者是隱性契約，
日後再加「我的投稿」之類的具名 GET 就會重蹈覆轍。守衛加了一條掃「有沒有人再把具名子路徑掛回 `/api/deck-posts/`」。

其餘採納（均自行查證）：
- **瑞士制邊角會鑄出錯的公開頭銜**：`_detectCutPlacements` 是為單敗淘汰設計的，
  cut 覆寫成 top2 或小人數瑞士時，「最後一輪瑞士」會被當成四強輪，整輪的人（含輪空者，
  `playersIn` 會把 bye 的 p1 也算進去）都被標成「四強」。改成要求**結構恰好是標準四強**
  （`finals.size === 2 && top4.size === 4`）。統計頁算錯還能人工看出來，這裡是自動鑄造公開頭銜。
- **同一副牌連兩場拿名次會永遠 409**：`entriesHash` 去重補上 `tournament.eventId` 維度。
- **賽事投稿不跑合法性驗證**：那副牌是伺服器歸檔給的，而報名端點當初只驗 `deckCount !== 60`
  ⇒ 擋下來等於把有真名次的玩家永遠關在門外，而設計上又規定必須用那副。
- **限流 key 改讀 `CF-Connecting-IP`**：`x-forwarded-for` 第一段是 client 可任意填的
  （Cloudflare 是 append 到尾端），拿它當 key 每個請求換一個假 IP 就完全穿透；
  且假 key 灌爆後舊的淘汰迴圈會**把別人還在生效的投稿冷卻一起刪掉**（改成先刪過期）。

### 守衛

`scripts/test-deck-posts.mjs`（32 項）。名次判定那組是**抽出真函式跑真值**
（`_detectCutPlacements` 與 `dpPlacementOf` 都用括號配對抽出來 `new Function` 求值），
含正對照與 fail-closed 案例。

⚠ **守衛自己有過兩個 bug**：① `extractFn` 遇到**參數解構** `function f(id, { a, b })` 會把參數列的
`{}` 當函式主體，只抽到參數列 → 後續斷言全在檢查一段不是函式主體的文字（本輪造成兩項假紅；
若是否定型斷言就會變假綠）。② 「client 不得送名次」那條原本用 `req.body[^;]*placement` 跨句掃，
誤命中回應那一行的 `placementLabel` → 假紅。

⚠ 另外修了 `test-admin-helper-scope` 的**假陽性**：它的跨作用域偵測把 `H.deckToSets(...)`
（正確地從 `app.locals` 取出 helper 後呼叫）當成裸呼叫 —— 它想鼓勵的正解反而被它判成事故。
加「前一個非空白字元是 `.` 就跳過」，並用**人工注入裸呼叫**驗證它仍抓得到真陽性。

完整 `npm test` **458 步全綠**。

### ⚠ 部署

本版需要跑 `redeploy-oracle.bat`（新端點）與 `update-tournament.bat`（`server-engine.cjs` 要重建才有
`validateDeck`；沒跑的話功能仍可用，只是完整驗證停用並在 log 出現警告）。
**beta 測試站（github.io）沒有這些 API，驗不到** —— 與 `/tournament` 同一限制。

## v6.137 — 錦標賽樂觀更新 slice 1（PR-2，只放行 ATTACH_ENERGY）

承 v6.134 診斷（錦標賽對戰完全沒有樂觀更新）與 v6.135（PR-1 網路層止血）。

### 核心設計：不枚舉「哪些 action 可預測」，改**執行期試跑**

新模組 `src/lib/game/optimistic.ts` 的 `tryPredictAction()`：本地先跑一次 `applyAction`，
期間把 `Math.random` 換掉並**計數**，**碰到任何隨機就放棄預測**退回現行行為（等伺服器）。
⇒ 擲幣招式、洗牌搜尋、混亂撤退、有灼傷/睡眠的回合結束…全部自動被擋，不必逐卡維護清單。
手法在本 repo 有先例（`ai-eval.ts` 的 `withIsolatedRandom`，引擎試打評估）。

十道 gate，全部 **fail-closed**（判不出來就不預測，最壞情況與改動前完全相同）：
① 白名單（第一批只有 `ATTACH_ENERGY`）② `phase === 'playing'` ③ 沒有 pendingSelection 開著
④ 引擎 throw ⑤ **rng 計數 > 0** ⑥ 引擎拒絕（回傳同一物件）⑦ 階段改變 ⑧ 開啟 pendingSelection
⑨ **換手** ⑩ **pendingPrizes 變動** ⑪ **iid 集合改變**

### ⚠ Fable 5 審查抓到一個擋刀級問題：**假回滾**（已修）

原本 catch 路徑只呼叫 `tForceResync()` 就宣稱「畫面已還原」。但 `tForceResync` 只在
`fr.version !== tVersion` 才覆蓋 `game` —— 動作**沒送達伺服器**時版本根本沒動 ⇒ 版本相等
⇒ **預測畫面不會被還原**。而且 `tForceResync` 還無條件更新 `_tLastStateChangeAt` 把看門狗
安撫掉 ⇒ 幽靈能量永久掛在畫面上；`energyAttachedThisTurn` 已被預測設 true、UI 把附能鎖灰，
「請重試」的提示與畫面自相矛盾。

修法：`restorePrediction()` 用**物件同一性**判斷 —— `if (tPredicted && game === predictedRef) game = prev`。
⚠ 不能無條件 `game = prev`：若輪詢在 await 期間已帶回更新盤面（動作其實成功、只是回應丟了），
盲目還原會把畫面倒退到比 `tVersion` 還舊。三條路徑都接上：catch、`r` 沒帶 gameState、stale 重試前。

⚠⚠ **守衛原本為這個假回滾亮綠燈** —— 它只斷言「catch 裡有出現 `tForceResync()`」。
這是 IRON_RULES Rule 25「掃描器本身要先驗會不會漏」的活教材；已改成斷言**真回滾**
（`game === predictedRef` 與 `game = prev` 兩個字面都必須在）。

### Fable 5 其餘採納項（均自行查證屬實）

- **`tPredicted` / `predictedRef` 改函式內區域變數**：伺服器有一條 `{ error:'對局尚未開始', waiting }`
  **不帶 gameState**（房間剛被 reset 的競態），不進任何清除點 → 元件層級旗標會殘留到下一次
  dispatch，害下次誤跳音效、誤觸回滾。
- **gate ⑨ 換手**：`engine.ts` 的 ATTACH_ENERGY handler 內部有一條「引夢貘人｜白日夢」路徑
  （目標帶 `endTurnOnOppAttachEnergyThisTurn` 時**直接呼叫 `applyAction(END_TURN)`**）。
  若當下 checkup 沒有要擲幣的狀態，整條是確定性的 ⇒ rng gate 放行 ⇒「只放 ATTACH_ENERGY」
  實際會預測出「換手＋checkup＋對手抽牌」。同構於伺服器所以不是正確性 bug，但完全違背
  slice 1「把爆炸半徑鎖在一張能量」的意圖。
- **gate ⑩ pendingPrizes**：附能仍可能間接造成昏厥（對手侵蝕詛咒、白日夢路徑的 checkup 毒傷），
  牽涉獎賞與補位一律讓伺服器裁定。

Fable 查證但**不需要**改的（我複驗過）：音效不會因輪詢搶先而雙重播放
（附能音效是 action-based，`switch (action?.type)`，輪詢那條 action 為 null）；
觀戰／回放三層都封死（`dispatch()` 在 `isTournament` 分支**之前**擋 `isSpectator`）；
ATTACH_ENERGY 全程無 `uid()`，iid 不變；`normalizeAction` 對它是 no-op。

### 其他接線

- 拆 `tInFlight`（對戰動作網路鎖）與 `tBusy`（大廳操作，保留原用途與 template 綁定）
- 新鮮度看門狗加 `&& !tInFlight`：送出中不強制重抓，否則會把預測畫面倒回、回應到達又前進＝閃爍
- **`tVersion` 完全沒動** —— 它的語義永遠是「伺服器確認過的版本」，動了會讓 v6.135 才修好的
  輪詢亂序守衛誤判。守衛有一條專門盯這個。

### 守衛

`scripts/test-v6137-optimistic-predict.mjs`（30 項，行為端 + 靜態）。關鍵幾條：
- 預測結果與再跑一次 `applyAction` **逐位元等價**（去 log 時戳）
- **rng gate 本體**：灼傷狀態的 `END_TURN`（用 `allowedTypes` 臨時放行）→ `randomness:1` 被擋；
  **正對照**：無狀態的 `END_TURN` 可預測（證明計數器不是恆真）
- 白日夢旗標 → `turn-flipped`；正對照：一般盤面仍可預測
- `Math.random` 在正常與 throw 路徑都還原
- 靜態：真回滾、區域變數、`tVersion` 不得遞增、看門狗 gate、stale 前清旗標

HEAD-FAIL：保留 `optimistic.ts`、只還原 `+page.svelte` → 接線端 **9 條紅**。

⚠ `test-v6135` 的 ③ 因變數改名（tBusy → tInFlight）而假紅，已把斷言改成
「in-flight 分支（兩個名字都接受）不得靜默吞點擊」—— 守衛盯的是**意圖**不是變數名。

### 驗證

完整 `npm test` **457 步分 4 批全綠**；免疫網（25/0、19/0）、selection-ui 35/0、
anti-pattern-lint 無違規、tsc TS2304 = 0。

### 🔨 下一批（PR-3）候選

`SEND_NEW_ACTIVE`（KO 後補位是體感重災區，但與獎賞/pending 交錯較多）、`PLAY_BASIC`、`EVOLVE`、
`RETREAT`（gate ⑤ 會自動擋混亂撤退）。⚠ 每批各自附 fixture 守衛；
`RESOLVE_SELECTION` 與 pending queue 留到最後，且要先跑「兩端 sanitize 收斂」的對照實驗。
⚠ 另有一條 Fable 提的既有問題（非本 PR 引入）：預測沒發動時，
「輪詢先帶回 ＋ `dispatchSfxForAction` 再播一次」的雙重音效在 v6.136 基準版就存在，可另開 slice。


## v6.136 — 沉重接力棒漏判「【撤退】所需的能量為4個」＋ 撤退費維度 audit

玩家回報：撤退費不是 4 的寶可夢附上沉重接力棒後也會發動。**屬實**。

### 卡面三個條件，實作只漏了第一個

卡面（`static/cards/SV5M.json`，H 標）：
> 附有這張卡的**【撤退】所需的能量為4個**的寶可夢，**在戰鬥場上**受到**對手的寶可夢招式的傷害**而【昏厥】時…

`effects/cards/tools.ts` 的 `TOOL_ON_KO.set('沉重接力棒')` 只判了「備戰不為空」與「koInst 有基本能量」。
呼叫端 `fireDefenderOnKO`（`effects.ts`）本來就有 `isActive`（在戰鬥場上）與 `koByAttackDamage`
（招式傷害）兩個 gate ⇒ **三個條件裡只漏了撤退費這一條**。

### 判定基準＝「昏厥當下的**有效**撤退費」（官方裁定，不是印刷值）

`PTCG RULES/PTCG_RULES.json` 逐字：
> Q：因特性「調節」的效果，附有 **3 張「重力之玉」**和「沉重接力棒」的自己戰鬥場上的普隆隆姆ex，
>    受到對手的寶可夢的招式的傷害[昏厥]時，可以將基本能量卡全部改附至備戰寶可夢身上嗎？
> **A：可以。**

重力之玉是「撤退所需的能量各增加 1 個」，疊 3 張 = +3 ⇒ 官方判可以，代表要**算入所有修正**。
另三則裁定也確認了現有 gate 正確：退化導致 HP 不足昏厥 → 不可以（非招式傷害）；
對手「送回」打死 → 可以（是招式傷害）。

### 中央收斂：`computeRetreatCostForKOedActive`

⚠ **不能直接呼叫 `computeActiveRetreatCostFor`**：`fireDefenderOnKO` 被呼叫時，
防守方的 `active` **已經被設成 null**（中央 KO 結算是「先 `newDefender.active = null`，
再 `fireDefenderOnKO`」）→ 會命中 `if (!player.active) return 0` → 條件永遠不成立。

新 helper（engine.ts）把 koInst **暫時放回 active**，再走**同一支**中央函式 ——
不複製任何修正邏輯，氣球／緊急滑板／重力之玉／天空徑線／N的城堡／樂園度假地／
磁鐵【鋼】能量／特性類（咒縛火焰・大網・一身輕…）／鼓擊 全部自動一致。

### 同維度 audit：8 張「讀取撤退費」的招式**全部已走中央**，沉重接力棒是唯一漏網

枚舉 HIJ 卡面含「【撤退】所需的能量」的共 26 筆，其中「讀取」型 9 張。逐一 diff 結果：
瑪夏多／長毛巨魔｜影繩結、尖牙籠｜整隻咬、超級水晶燈火靈ex｜幻影迷宮、投摔鬼｜背負上投、
阿利多斯｜線帶纏繞、烈箭鷹｜氣旋競爭、鐵包袱｜瞬風衝激 —— 8 張全部在 v5.362／v5.690／v5.711
那幾波已收斂到 `computeActiveRetreatCostFor`。全站 grep `retreatCost.length` 的非中央用法只剩註解。

⚠ **為什麼上次收斂沒掃到它**：那幾波掃的是**招式 effect**，沉重接力棒的條件寫在**道具的 rulesText**。
⇒ 守衛④把枚舉範圍擴到 `rulesText`，同型漏網一勞永逸。

### 守衛（兩支，均 HEAD-FAIL 驗證過）

`test-v6136-heavy-baton-retreat-cost.mjs`（10 項，靜態）：中央 helper 存在且是**包裝**而非複製、
沉重接力棒判 `!== 4`、反向對照（不得用 base `retreatCost.length`）、6 張讀取型招式仍走中央、
**④ 枚舉守衛擴到 rulesText**、自我驗證。改前 4/4，改後 10/0。

`test-v6136-heavy-baton-behavior.mjs`（7 項，**行為端**跑 `fireDefenderOnKO`）：
A 撤退費 2 → 不觸發／B 撤退費 4 → 開 pending／C 撤退費 1 + 重力之玉×3 → 觸發（官方裁定案例）／
C2 撤退費 1 + 重力之玉×2 = 3 → 不觸發（邊界）／D 備戰為空 → 不觸發（既有行為回歸）。
**HEAD-FAIL 決定性證據**：舊實作下 **A 與 C2 紅**（撤退費 2、3 也會開 pending ＝ 玩家回報的 bug
被行為端重現），B／C／D 綠（既有正確行為零回歸）。

⚠ **fixture 坑**：道具欄位是 `toolAttached`（主）＋ `extraTools`（溢出），**不是 `tools`**。
第一版寫成 `tools` → `getAllAttachedTools` 讀不到 → 沉重接力棒根本沒被觸發 →
「不觸發」的斷言**全部假 PASS**。逐欄對齊 `types.ts` 後才是真的。

### 既有測試 fixture 補正（不是把 bug 固化成契約）

`test-v6120-ondamaged-tool-double-fire.mjs` 的「真正的『昏厥時』道具不得被誤跳過」原本用
「HP ≤ 60 的基礎寶可夢」當持有者，撤退費不一定是 4 → 新 gate 一上就紅（base 10/0 → 改後 9/1）。
**先跑 base 對照確認是新改動造成**，再補正 fixture：動態找「撤退費 4 且無特性的基礎寶可夢」。
它要驗的是「鏡射跳過邏輯不得誤傷沉重接力棒」，不是撤退費條件本身，補正前提後回到 10/0。

### 驗證

完整 `npm test` **456 步分 4 批全綠**；免疫網（傷害 25/0、招式效果 19/0）、selection-ui 35/0、
撤退費相關 4 支（9/0、5/0、5/0、4/0）、anti-pattern-lint 無違規、tsc TS2304 = 0。

### 🔨 待查（未影響本次）

官方裁定第四則提到「場上放置有競技場卡『**災禍荒野**』時 → 不可以」，
但**我方卡庫全 sets 都找不到這張卡**（可能是 G 標以前、或譯名不同）。
若日後補進 HIJ 卡池，要確認它對沉重接力棒的交互（該卡疑似讓道具/特性失效）。


## v6.135 — 錦標賽網路層三項防護（PR-1，不含樂觀更新）

承 v6.134 的診斷。**樂觀更新是大改動、留給 PR-2**；這一版先修三個「現行就存在、與樂觀更新無關」的問題。

### ① `tApi` 完全沒有 timeout → `tBusy` 可能永久鎖死

`fetch` 預設沒有 timeout（瀏覽器要幾百秒才放棄）。隧道排隊/黑洞時 `await fetch` **既不 resolve
也不 reject** → `tournamentDispatch` 的 `finally { tBusy = false }` 永遠不執行 → `tBusy` 永久 true
→ 之後**所有**點擊被 `if (tBusy) return` 靜默吞掉。而 `tBusy` 沒有任何 template 綁定（按鈕不會變灰）
⇒ 玩家只會看到「按了沒反應」，且完全看不出自己被吞了。

修：`AbortController` + `setTimeout`，POST 12s / GET 8s，`AbortError` 轉成可讀訊息。

⚠ `return res.json()` 改成 `return await res.json()` **是正確性關鍵不是風格**：沒有 `await` 的話
try block 在 headers 到達就結束、`finally` 立刻 `clearTimeout`，計時器只保護到 headers ——
而黑洞常發生在 **body 傳輸中途**，那時 `res.json()` 永不 settle、`tBusy` 照樣永鎖，等於白改。

⚠ 兩個 Fable 5 審查後補的收尾：
- `_timedOut` 旗標：只認「**這顆**計時器造成的 abort」，避免其他來源的 AbortError 被誤報成逾時。
- `tApi` 加 `opts.timeoutMs`，`tEnterMatch` 的 `/match/enter` 與 `/state?v=-1` 兩發放寬到 **20s**
  —— 它的 catch 會 `tStep = 'lobby'` **把玩家踢回大廳**，8s 誤殺代價是慢網路玩家進不了場（可能吃 noShow 判負）。
  其餘呼叫端逐一掃過，全部有 try/catch 且失敗是靜默忽略或顯示 tError，不會因 throw 壞掉。
  回放 `tStartReplay` 走裸 fetch **不經 tApi**，最大 payload 不受影響。

### ② 輪詢亂序會把盤面倒回舊版本（現行閃爍源，符合「重整無效」）

`startTournamentPoll` 的 `setInterval(…, 1200)` **不等前一發完成**，RTT 抖動時多發並行。
情境：A、B 兩發並行，B 帶回 v12（採納，`tVersion=12`），A 晚到帶回 v11 → 舊條件
`r.version < tVersion` 成立 → **盤面倒回 v11**，1.2 秒後又跳回 v12 ⇒ 玩家看到「動作出現又消失」。
既有的 `gen !== tPollGen` 只擋「離開對戰後的舊回應」，擋不住同一輪詢內的亂序。

修：捕捉送出當下的 `const reqV = tVersion`，回正分支加 `&& reqV === tVersion`。
真 desync 的特徵是「送出當下 client 就已經超前」——**單發情況下 `reqV === tVersion` 恆真**，
所以守衛只會擋掉「期間有另一發改過版本」的亂序，房重置/離場重進都不受影響；
就算真被擋到，下一輪輪詢（1.2s）必回正，另有 6s 輪詢看門狗與 8s 新鮮度看門狗兜底。

🔨 **PR-2 待辦**：兩條 `v=-1` 路徑（輪詢看門狗、`tForceResync`）**繞過這個守衛也繞過 tAdopt 的
stale 擋板**，自己就有同款亂序倒退風險（`fr.version !== tVersion` 包含倒退方向）。機率低
（8s 節流＋觸發條件是盤面停滯），但該補同款 reqV 守衛。

### ③ in-flight 不再靜默吞點擊

`if (tBusy) return;` → 改成寫 `tError` 顯性提示。
⚠ 並加 2 秒自動清除：**成功路徑不會清 `tError`**，而 `.tourn-toast` 沒有任何自動消失計時器
（唯一特例是複製回放連結的 2.5s）——不自動清會讓紅色 toast 在「動作其實已經成功」之後
一直掛著，玩家可能整段對手回合都看著它。

### 守衛

`scripts/test-v6135-tournament-net-hardening.mjs`（17 項）：三項各自的正面斷言＋反向對照
（舊寫法不得存在）、`tEnterMatch` 放寬的**正對照**（確認它失敗真的會踢回大廳，理由成立）、
以及一條前瞻斷言「`tVersion` 不得被 client 自行遞增」——**釘住 PR-2 樂觀更新的前提**：
`tVersion` 語義必須永遠是「伺服器確認過的版本」，本地預測絕不 bump，否則回正分支會誤判。
含掃描器下限斷言（檔案 < 500KB 視為 mount 截斷直接 exit 1）。

HEAD-FAIL：改前 PASS 2 / FAIL 15，改後 17 / 0。v6.134 守衛金絲雀 7/0（確認 base 沒抓錯）。

### 🔨 PR-2（樂觀更新）的設計要點（Fable 5 已審，尚未實作）

- **不要枚舉哪些 action 可預測，改執行期試跑**：dispatch 前本地跑一次 `applyAction`，期間把
  `Math.random` 暫時換掉並計數，**碰到任何隨機就放棄預測**退回現行行為。擲幣招式、洗牌搜尋、
  混亂撤退、有灼傷的回合結束全自動被擋。此手法 repo 有先例（`ai-eval.ts:46` 引擎試打評估）。
- 第一批只放 `ATTACH_ENERGY`（高頻、零隨機、零 pending、無連鎖）。
- `tVersion` 絕不因預測 bump；伺服器 state 無條件贏；回滾機制免費（伺服器每條失敗路徑都附權威 gameState）。
- 回滾把卡塞回手牌會誤觸 draw-fly 動畫＋`arrivingIids` opacity:0（v5.932 隱形手牌事故家族）→ 需 `noDrawAnim` 路徑。

### ⚠ 另記（不進公開 changelog）

Fable 5 查證：`/api/tournament/state` 與 `/action` 回給 client 的 gameState **完全未遮蔽**
（`server_admin_patch.js:3310/3352` 只做 log 截尾），對手手牌與雙方牌庫順序全在 client 記憶體，
開發者工具讀得到。redact 只做在 `/spectate/state` 與回放。樂觀更新**不加劇也不改善**這一點
（它不需要任何新資訊）。要真正封死需要 per-seat redact ＋「洗牌結果延遲決定」，是大工程，
且會讓 PR-2 的抽卡類動作永遠無法預測 —— 若日後要做 redact，分批順序應把抽卡類永遠留在白名單外。


## v6.134 — 休閒大廳輪詢 gate 補 `mode === 'online'`（錦標賽 lag 調查的第一項）

**現象**：玩家回報錦標賽瑞士制第四輪開始很卡。能連 Oracle 的工程師實測伺服器端全綠
（HTTP P95 8ms、event loop p95 1.21ms、Mongo queued 0/0、nginx 5xx 0、5 分鐘 38,694 req 零錯誤），
但抓到 5 分鐘內流量最大的端點是 `/api/rooms`：**74.9 MB / 5942 req，佔總頻寬約 60%**。

**根因**：`src/routes/game/+page.svelte` 的 `subscribeOpenRooms` gate 是

```js
if (!isTournament && onlineStep === 'join' && myUid) {
```

三個條件都成立得太容易：
- `mode` 初始值是 `null`（行 434）
- `onlineStep` 初始值就是 `'join'`（行 575）
- 正式站 onMount 無條件 `oracleAuth()` 設好 `myUid`

⇒ **任何開著 `/game` 的分頁都在輪詢**——停在「本機／線上」模式選擇畫面、選牌組、打 AI 對戰中、
本機雙人對戰中，全部每 2 秒打兩支 `GET /api/rooms`（`?status=lobby` + `?status=playing`，
`room-oracle.ts:644` 的 tick 是 2000ms），直到分頁關掉。
19.8 req/s ÷ 1 req/s per client ≈ 20 個開著 /game 的分頁，與觀測吻合。

而**大廳列表 UI 本來就只在 `mode === 'online'` 分支渲染**
（模板結構：`{#if mode === null}` → `{:else if mode === 'local'}` → `{:else}`（線上），
`{#each lobbyRooms}` 在最後那個分支裡）⇒ 這些請求的資料一筆都沒被用到。

**修正**：gate 補上 `mode === 'online'`。**零 UI 行為變更**——只停掉「畫面上沒有顯示大廳列表時」
的輪詢。

**這不是 v6.118 漏修**：v6.118 加的 `!isTournament` 還在、也有效（錦標賽頁與錦標賽對戰中都不會輪詢）。
這次是**另一個範圍問題**：gate 少判了「有沒有真的進到線上模式」。
同型教訓仍然適用——**共用頁面用旗標切模式時，每一條 `$effect` 都要問「另一個模式需要嗎」**。

**守衛** `scripts/test-v6134-lobby-poll-gate.mjs`（7 項）：
① gate 四個條件逐一斷言（`!isTournament` / `mode === 'online'` / `onlineStep === 'join'` / `myUid`）
② `subscribeOpenRooms` 全站呼叫點唯一（新增呼叫點會紅 → 強迫重新審 gate）
③ 自我驗證：舊 gate 字串不得存在（反向對照）
④ 正對照：大廳列表 UI 必須位於 mode 線上分支之後（UI 若搬家會紅 → 提醒重審 gate）
＋掃描器下限斷言（檔案 < 500KB 視為 mount 截斷，直接 exit 1）

HEAD-FAIL 已驗證：未改 gate 時 PASS 5 / FAIL 2；改後 PASS 7 / FAIL 0。

**⚠ 這一項不是玩家回報「卡」的主因，只是省下 60% 的浪費頻寬。**
真正的主因另記：**錦標賽對戰完全沒有樂觀更新**——`dispatch()`（行 4735）對錦標賽直接走
`tournamentDispatch()`，`await tApi('/action')` 等伺服器回應才更新畫面，期間 `tBusy` 還會
吃掉所有後續點擊；對手的動作則要等 1.2 秒一次的 `/state` 輪詢。人一多、往返一長，
體感就是「按下去沒反應、對手動作很久才出現」，且**重新整理無效**（結構性，不是狀態累積）。
這條要另開一輪處理，需先設計好「本地預測 vs 伺服器權威」的對帳與衝突回滾。


## v6.133 — 首頁 changelog 的 `.log-body` 沒有樣式（字體爆大）＋ 根治守衛

站長回報：v6.132 那則的「這幾個特性每回合只能用一次…」那段字**特別大**。

### 根因
首頁的 changelog 是 `fetch()` + `{@html}` 注入的（v5.969 為了縮小 bundle）。
**Svelte 的 scoped CSS 只作用在編譯期就存在的標記上** —— 執行期注入的 HTML 拿不到 scope hash，
所以樣式一律得寫成 `.changelog-list :global(...)`。

我從 v6.129 起用 `<div class="log-body">` 放「展開才看到的補充說明」，**卻沒有加對應的 `:global` 規則**
⇒ 它吃瀏覽器預設的 `1rem`(16px)，而周圍的 summary 是 `0.9rem`、`details ul` 是 `0.85rem`，
並排就明顯大一截。v6.129～v6.132 四則全中。

⚠ 這種缺陷的麻煩之處：**不會報錯、不會壞版、測試也不會紅**，只是安靜地變醜 —— 靠人眼每次都抓到不現實。

### 修法
`.changelog-list :global(.log-body) { padding: 0 0.85rem 0.7rem 1.95rem; font-size: 0.85rem; color: #555; line-height: 1.7; }`

### 一勞永逸：`test-changelog-html-classes-have-global-css`
**`static/changelog.html` 用到的每個 class，都必須在 `+page.svelte` 有對應的 `:global()` 規則。**
這條網一寫完就當場抓到**第二例**：`.changelog-archive-link`（「查看更早的更新紀錄」那個連結）
同樣沒有規則、同樣在吃瀏覽器預設樣式 —— 一併補上。

⚠ 守衛自身的兩個坑（都當場踩到、都修了）：
1. 第一版把 `changelog-archive.html` 也納入掃描 → 4 條假 FAIL。它是 `<!DOCTYPE html>` 開頭的
   **獨立完整頁面**、有自己的 `<style>`，根本不走首頁 CSS。
   ⇒ 只掃 `changelog.html`（片段），並加一條**前提檢查**：archive 必須仍是「有自己 `<style>` 的獨立頁面」，
   哪天若被改成片段，守衛會提醒把它加回掃描範圍。
2. 下限斷言 `PAGE.length > 50000` 設太高（`+page.svelte` 實際 34KB）→ 假 FAIL。改 20000。
   （Rule 25 說掃描器要有下限斷言防假綠，但**下限值本身設錯就會變成假紅**，一樣要驗。）

HEAD-FAIL：拿掉 `.log-body` 那條規則 → 守衛紅。完整 `npm test` 452 步全綠、lint 無違規、svelte compile 通過。

⚠ 本版**不寫首頁 changelog** —— 純樣式修正、無規則差異，依 changelog 規範第 2 條
（「玩家不需要知道的整則不放」）。但仍 bump 版本（SW 快取）。

## v6.132 — 站長裁定四條特性 gate（v6.131 的同維度收尾）

站長裁定（2026-08-08），全部是 v6.131 由 Fable 5 指出、當時列為「待裁定」的同維度漏網：

| 特性 | 裁定 | 類型 |
|---|---|---|
| 燈罩夜菇｜**平靜之光** | 對手戰鬥寶可夢**已經【睡眠】**時不能使用 | gate 太鬆（白按吃特性權） |
| 波爾凱尼恩ex｜**燒灼蒸汽** | 對手戰鬥寶可夢**已經【灼傷】**時不能使用 | 同上 |
| 光電傘蜥｜**頸傘發電** | **牌庫 0** 時不能使用 | 同上 |
| 顫弦蠑螈｜**惡棍衝天** | **牌庫 0** 時不能使用 | 同上 |

前兩張是每回合 1 次，而 `USE_ABILITY` 是「先標記本回合已用特性、再執行特性函式」
⇒ 白按一次就把特性權吃掉。判定必須**跨三槽** → `hasStatusInAnySlot`
（與熱浪鱗粉 v5.842 同一判準；直接讀 `.status` 會漏掉 secondary/tertiary）。

⚠ **免疫不算進 gate** —— 沿用 v6.127 站長對暗黑鈴的裁定：免疫是防禦方的能力，
不該讓攻擊方連按都不能按。這裡只判「狀態已經**存在**」。

後兩張只判**張數**（公開資訊，官方 L821 電氣發生器同判準），**不掃牌庫內容**
（帶條件搜尋可宣告「找不到」，見 v6.131）。

### ⚠⚠ 教訓：守衛的抽取器盲點讓我對現況做出**錯誤判斷**，差點寫進 changelog
我一度認定「平靜之光／燒灼蒸汽**完全沒有 gate**，連卡面白紙黑字的『若這隻寶可夢在戰鬥場上』
都沒擋，regA 的註解是空頭支票」—— 並已經把這段寫進 engine 註解、regA 註解與 changelog 草稿。

**那是錯的。** engine 裡本來就有一條**複合** gate 涵蓋它：
```ts
if (ab.name === '瞬間移動者' || ab.name === '平靜之光' || ab.name === '燒灼蒸汽' || ab.name === '勸誘羽') {
  if (player.active?.iid !== pk.iid) return;
}
```
是 v6.131 守衛的 gate 抽取器只認 `if (ab.name === 'X') {` 這種**單一名稱**形式，
複合條件整條被靜默跳過 ⇒ 我查現況時「查無此 gate」，就誤以為沒有。

修了兩層：
1. **抽取器改成以每個 `ab.name === 'NAME'` 為錨點往前找 `if (`、括號配對**，複合條件的每個名稱
   各自 map 到同一份 body；並加正對照（餵 `A || B` 樣本確認抽得出兩個名稱）。
2. **`gates` 改成累積語意**（同一個特性可能被**多條** gate 涵蓋 —— 例：「在戰鬥場上」一條、
   「對手已處於該狀態」另一條）。原本的覆蓋語意只會留最後一條，對前面那條完全盲。

⇒ 這是「掃描器自身盲點」第 4 次咬人（v6.124 regex 漏措辭變體／v6.125 template literal ＋
engine 直寫 pendingSelection／v6.130 抓到註解裡的字／本次只認單一形式）。
**IRON_RULES Rule 25 再加一條：抽取器不得假設程式只有一種寫法；同一 key 可能有多筆，用累積別用覆蓋。**

### 其他
- 首頁 v6.130 那則文案改成「**本站**原創曲」，並拿掉「是站長自己作詞作曲的原創歌曲」一句（站長要求）。
- 守衛 `test-v6131-ability-gate-not-stricter-than-card.mjs` 新增 ②c 站長裁定段（含「免疫不得算進 gate」
  的反向斷言），263 項。HEAD-FAIL：還原 engine.ts → 4 條紅。
- 完整 `npm test` 451 步全綠、lint 無違規、兩張免疫網全過、tsc 無 TS2304。

## v6.131 — 特性 gate 比卡面嚴：4 張卡按不下去（玩家回報過度放電）

玩家回報：「三合一磁怪的特性**過度放電**無法使用，我確認過棄牌區有能量、備戰區有【雷】屬性寶可夢。」

### 根因：gate（能不能按）與 regA（按下去做什麼）是兩份獨立條件，改了一邊忘了另一邊
卡面（三合一磁怪 H 標 14706）：「…從自己的棄牌區選擇最多3張**基本能量卡**，以任意方式附於自己的
**【雷】寶可夢**身上。」→ **屬性限制只在附加目標，不在來源能量**。
`regA` 端 v5.500 早就改對了（註解明寫「卡面『基本能量卡』任意屬性(雷限制只對附加目標)」），
但 `engine.ts` 的 `getUsableAbilities` gate 仍要求「棄牌區有基本**【雷】**能量」⇒ 玩家棄牌區只有
非雷的基本能量時整個特性按不下去。

這個 bug 型的後果不對稱、兩邊都很糟：
- **gate 太嚴** → 玩家完全用不了（本次回報）
- **gate 太鬆** → `USE_ABILITY` 是「先標記本回合已用特性、再執行特性函式」⇒ 白按一次、**特性權被吃掉**（v6.127）

### 同型全掃，共修 4 張
| 卡 | 卡面 | 舊 gate | 類型 |
|---|---|---|---|
| 三合一磁怪｜過度放電 | 「最多3張**基本能量卡**」 | 要求棄牌區有基本【雷】能量 | 太嚴（玩家回報） |
| 金屬怪｜金屬製造者 | 「附於自己的**寶可夢**身上」（無屬性限制） | 要求場上有【鋼】寶可夢 | 太嚴（regA v4.29 已移除該誤限制，gate 沒跟著改） |
| 哈克龍｜進化指引 | 「從自己的牌庫選擇1張進化寶可夢卡」 | 掃牌庫內容要求「牌庫裡有進化寶可夢」 | 太嚴＋違反 fail-to-find（regA 明寫「即使 cand=0 也仍開 picker」） |
| 超級妙蛙花ex｜日光轉移 | 「改附於自己的**其他**寶可夢身上」 | 沒檢查「需要接收方」 | 太鬆（regA 有 `all.length < 2` 擋，gate 漏） |

### ⚠⚠ 我一度改錯，Fable 5 用官方 Q&A 擋下來
我原本在過度放電的 gate 加了「排除即將昏厥的自己」（想對齊 regA 的「self KO 後才判」）。
**那與官方相反** —— `PTCG RULES/PTCG_RULES.md:1959-1960 §17.29.F` 逐字：
> Q: 使用三合一磁怪的特性「過度放電」時，可以將基本能量卡附加給使用了特性的三合一磁怪**自己**嗎？
> A: **可以。**

⇒ gate 不得排除自己（磁怪本身就是【雷】，這個條件實質恒真）。守衛裡留了一條**反向**斷言把這個
直覺釘死（「自己都要昏厥了怎麼當目標」看起來很合理，但官方說可以）。

🔨 **已知偏差（既有、非本版引入，待站長裁定）**：`regA` 是在 `selfKOInstance` **之後**才判「場上還有
【雷】寶可夢」，所以「場上只有這隻磁怪是【雷】」時 regA 會擋 ⇒ gate 放行但效果不發生。照官方應該
要能附給自己。要修得動 regA 的 KO/附加順序，本版**不動**（寧可保留既有偏差，也不引入與官方相反的新行為）。

### 順帶：禿鷹娜｜瞄準獵物 gate 讀**對手手牌內容**（資訊洩漏）
卡面「查看對手的手牌，從其中選擇1張HP為70以下的【基礎】寶可夢卡…」。舊 gate 掃對手手牌內容決定
按鈕亮暗 ⇒ **按鈕的亮/暗直接把對手手牌的組成洩漏給使用者**。
判準：**張數是公開資訊、內容是隱藏資訊**（官方 L821「電氣發生器牌庫 0 張不可以」能成立正是因為張數
公開；而 v2.324 對「金屬信號／王者呼聲」已明寫 `no gate needed — deck content is hidden info`）。
⇒ 改成只判 `opp.hand.length === 0`。

### 順帶：三處 `regG` 死碼（lint Check Y 抓出來的）
`regG` 註冊進 `TRAINER_GUARDS`，只有 `canPlayTrainer`（出**訓練家**卡）會查；**寶可夢**的特性 gate 走
`getUsableAbilities`。所以 `regG('金屬怪')`／`regG('啪咚猴')`／`regG('超級妙蛙花ex')` 永遠不會被呼叫。
（Fable 5 逐一確認 `TRAINER_GUARDS` 的 runtime 消費點只有 `_shared.ts:854`（canPlayTrainer）與
`tools.ts:958`（註冊期防覆蓋，只遍歷道具卡名），移除零行為變更。）
⇒ 新增 **lint Check Y**：`regG` 的對象是寶可夢卡名（且非同名訓練家）即報違規。

### 守衛
`scripts/test-v6131-ability-gate-not-stricter-than-card.mjs`（241 項，進 npm test chain）：
- ① **卡面驅動的單向判準**：gate 裡出現的每個屬性【X】，卡面該特性的 effect 必須也有【X】。
  單向是刻意的 —— 卡面有而 gate 沒有是「保守放行」，安全；反過來才會擋掉玩家。
- ②  逐卡回歸（含上述官方 Q&A 的反向斷言）
- ②b **gate 不得讀隱藏區的「內容」**（對手手牌／任一方牌庫）—— 只能判張數。這條一寫完就當場
  抓出「進化指引」這第四張（守衛自己找到的，不是人工看出來的）。
- ③  掃描器自我驗證（正對照＋剝註解器驗證）
含掃描器下限斷言（gate ≥60 條、帶屬性判斷者 ≥15 條、隱藏區掃描 ≥60 條）。
⚠ 一律先剝註解 —— 說明文字裡常引用卡面／舊寫法的屬性字樣（同型：v6.130 被註解裡的
`<audio autoplay>` 騙、v6.112 被舊寫法註解騙）。

HEAD-FAIL：還原 `engine.ts` → 3 條紅。完整 `npm test` 451 步全綠、lint 無違規、兩張免疫網全過。

### 🔨 Fable 5 指出、本版未動的同維度漏網（下批處理）
- 燒灼蒸汽／平靜之光：對目標已有該狀態時仍可按（每回合1次會白吃特性權），與熱浪鱗粉 v5.842 的判準矛盾 → 方向待站長裁定
- 頸傘發電（engine.ts:9479）／惡棍衝天（9665）：漏 `deck > 0` gate（同型的風扇呼喚/振翅高飛/增長繭都有）
- 更根本的方向：在 `USE_ABILITY` 中央做行為端兜底 —— regA 執行後若 state 只差 markUsed＋log（無盤面 diff、
  無 pendingSelection）即偵測為「白按」，可把整類「gate 太鬆」從根上消滅，不再依賴逐卡對齊

## v6.130 — BGM 上架站長原創曲【最後一張牌】＋ 真的移除三首官方 BGM 檔案

站長自行作詞作曲了【最後一張牌】，要上架到「設定 → 背景音樂 (BGM)」，**預設仍是關閉**，
且**玩家點選之後才下載**（5.5MB，不能讓所有人進站就吃）。方案先請 Fable 5 規劃，逐項自行查證後採用。

### ⚠ 順帶發現：v3.84 的版權處理其實沒做完
v3.84 註解寫「為避免版權風險，移除 3 首官方 BGM」，但**只拿掉了選單的 option，mp3 檔案還躺在
`static/music/`**（Aim to Be a Pokemon Master / Pokemon XYZ Opening / We Go，共約 10MB）——
`static/` 會被完整部署，任何人打網址就能直接下載。這是**持續中的公開散布**，和「選單看不到」無關。
站長裁定：一併從 HEAD 移除（不改寫 git 歷史 —— filter-repo/BFG 會換掉全部 sha，直接毀掉本專案
「以 sha 當 patch base」的推送紀律，見 IRON_RULES Rule 24；歷史殘留的風險量級遠低於線上任人下載）。

### 檔名用 ASCII：`最後一張牌.mp3` → `last-card.mp3`
中文檔名技術上其實可行（CJK 沒有 NFC/NFD 分解形，瀏覽器自動 percent-encode，SW 的 Cache key
與 `event.request.url` 一致）。改 ASCII 的真正理由是：**曲目代號會寫進玩家的 localStorage
（`ptcg.audio.bgm.track`）並拼進網址** —— 用中文會把這個持久化鍵綁死在中文檔名上，日後改名
就讓舊玩家指向 404；而且本專案有過零寬字元混進字串的前科（v6.117），ASCII 是肉眼可驗的。

### 三處必須同步（少一處就壞）
`BGM_TRACKS` 白名單 ⟺ `<option value>` ⟺ `static/music/<代號>.mp3`。
onMount 讀回 localStorage 後會用白名單過濾，舊值/壞值一律退回 `none`（避免拼出 404）；
所以只加 option 不加白名單 ＝ 玩家「選了重整就跳回關閉」。守衛對三方做雙向斷言。

### ⚠ 最大的行為變化：拿掉 `autoplay` 屬性
玩家選過曲目後 localStorage 會記住，**下次重整進頁面時 `bgmTrack !== 'none'`，audio 會在
沒有任何使用者手勢的情況下嘗試播放** → Chrome/Safari/iOS 的 autoplay policy 都會擋。
以前沒有任何曲目可選，所以這條路徑從沒被走過。

關鍵：**`<audio autoplay>` 屬性被擋是「靜默」的**（拿不到 promise，無從偵測）；
只有程式呼叫 `el.play()` 才會得到可 catch 的 `NotAllowedError`。
⇒ 拿掉屬性，改 `tryPlayBgm()` → `play().then().catch()`，被擋時設 `bgmBlocked`，
並掛一次性的 `pointerdown` 解鎖（對戰頁玩家必然會點，體感幾乎無感）+ 畫面上給一行提示。
`onBgmTrackChange` 用 `tick()` 等 `<audio>` 掛上去再 play（此時仍在 select change 的手勢窗內，必成功）。

### 「點選後才下載」的保證
`{#if bgmTrack !== 'none'}` 為 false 時 DOM 裡**根本沒有 `<audio>` 元素**，不發任何請求 ——
這是唯一的保證，守衛用「audio 標籤往回 600 字必須有這個 {#if}」釘住（一旦改成永遠渲染、
只切換 src，所有玩家進站就會吃流量）。SW 端 `HEAVY_MEDIA` 另有一道，把 `/music/` 排除在安裝預快取外。
`preload` 明寫 `auto`（各瀏覽器缺省值不一致）。

### Service Worker：`/music/` 完全繞過 SW
fetch handler 早退（不 respondWith）→ 走瀏覽器原生 fetch + HTTP cache + Range。
理由不是省空間，是 **`CACHE_NAME` 含 `version`、activate 只保留現行版＋前一版**，本站幾乎日更，
音樂若走「用到才快取」，每次出版快取就蒸發、常聽的玩家反覆重抓 5.5MB。原生 HTTP cache 跨 SW
版本存活，之後都是 304。

另外兩個 Range/Cache API 的地雷（查證後確認現況）：
- `cache.put()` 對 206 回應會直接 reject；現行 `status === 200` gate 剛好擋掉，不會炸，
  但也意味著**音樂其實從沒被成功快取過**（媒體元素首個請求通常帶 `Range: bytes=0-`，Pages 回 206）。
- `cache.match()` 預設無視 Range header，會把整包 200 回給帶 Range 的請求，Safari 媒體管線可能播不動。
早退後這兩條路徑都不存在。代價：音樂不支援離線播放（可接受）。

### 歌詞
mp3 的 ID3 內有 USLT 歌詞 frame（1.6KB），但**瀏覽器沒有任何 API 讀得到**，要顯示就得先抓整個
mp3 再用 JS 解析 ID3 —— 直接違反「點選後才下載」。站長裁定這版先不放；日後要放就手動貼一份靜態文字。

### 守衛
`scripts/test-v6130-bgm-lazy-and-licensing.mjs`（31 項，進 npm test chain）三條不變式：
① 版權（`static/music/` 白名單 ＋ 三首官方曲名寫死黑名單「不得復活」）
② 延遲載入（`{#if}` 包住 audio ＋ SW 預快取排除 ＋ fetch 早退）
③ autoplay（禁屬性、必須有 play().then().catch()、必須掛/清 pointerdown）
＋ 白名單/option/實體檔三方雙向一致 ＋ 預設值必須是 none。

⚠ **守衛第一版自己踩坑**：`indexOf('<audio')` 抓到的是**註解裡**的「`<audio autoplay>` 屬性被擋
是靜默的」那行說明文字，導致三條斷言假 FAIL。改成**先剝註解**（`<!-- -->`、`/* */`、`//`）
＋ 用 `/<audio\b[\s\S]*?<\/audio>/` 取真標籤 ＋ 斷言「剝完後剛好 1 個 audio 元素」。
守衛內另含自我驗證段（餵違規樣本確認判準抓得到、餵合法樣本確認不誤報、驗剝註解器本身）。
同型教訓：v6.112 的「舊寫法不得復活」守衛也被修正說明裡引用的舊寫法抓到過。

HEAD-FAIL：還原 +page.svelte → 6 條紅；還原 service-worker → fetch 早退那條紅；
把 `We Go.mp3` 放回來 → 版權兩條紅。完整 npm test 450 步全綠、lint 無違規、svelte compile 通過。

## v6.129 — AI 抓錯卡：7 個 picker 篩選條件只有玩家端有、AI 端沒有

玩家回報：跟 AI 對戰時，**蓋諾賽克特ex(I)｜金屬信號**（卡面「從自己的牌庫選擇最多2張
**【鋼】屬性的進化寶可夢卡**」）AI 卻抓到「火箭隊的拉姆達」(支援者)、「火箭隊的接收器」(物品)。

### 根因
pending 宣告 `filter: 'Stage1Or2:Metal'`。這個 filter **只有 UI（`+page.svelte` 的
`selectionItemsRaw`）有 inline case**，`ai.ts` 的 `case 'deck-search'` 完全沒有對應分支
→ 落到該 chain 尾端的 `return true;` fallthrough ＝ **AI 把整副牌庫當候選**，
再依 `_usefulness` 排序取前 N（非寶可夢 usefulness=1，排在「無上一階的進化寶可夢」=0 之前）
⇒ 抓到訓練家卡。

### 掃法：行為端，不是靜態 grep
刻意**實際跑 `getAIAction`**（餵一副含 10 種代表卡的牌庫，看 AI 選走幾類），因為 ai.ts 有
`f.startsWith('Trainer:')` / `'Pokemon:'` 等 generic prefix 分支 —— 字面量 grep 會把
`'Trainer:Supporter'` 誤判成「AI 沒有」（假陽性），也看不出「有 case 但寫錯」（假陰性）。
掃出同型漂移共 **7 個**（皆 H/I/J，逐字查證台灣官方卡面）：

| filter | 卡 |
|---|---|
| `Stage1Or2:Metal` | 蓋諾賽克特ex(I)｜金屬信號 |
| `EvolutionPokemon` | 哈克龍(I)｜進化指引 |
| `GrassPokemonOrStadium` | 時拉比(I)｜時間輪轉 |
| `FirePokemonOrBasicFireEnergy` | 熔蟻獸(I)｜舔舔捕捉 |
| `DarknessPokemon:TOP7` | 越橘的一步棋(I) |
| `BasicMetalEnergy:TOP4` | 金屬怪(H)｜金屬製造者 |
| `Basic:SameName` | 一家鼠(H)｜家族行軍 等（deckSameNameBenchPost） |

### 中央收斂
7 個 predicate 全部收進 `selection-filter.ts`（逐字對齊 UI 的 inline，UI 那三個早退分支不動＝
零 UI 行為變更）。為了讓 **TOP 型**收得進來，predicate 簽名加第三參數 `inst`（要 iid 才比對得了
`params.topNIids`）—— 沒有這個參數，這一整類 filter 永遠只能留在 UI/AI 各一份 inline。
同時 `DECK_SEARCH_NAME_PREFIXES` 補上 `'Stage1Or2:'` 與 `'Tool:NameContains='`
（後者 evaluator 本來就有處理、只是沒列進這個陣列 → `isKnownSelectionFilter` 回 false）。
Check S 凍結白名單 25 → 18。

⚠ **最大回歸點**：`engine.ts` 的 `sanitizeSelectedIids`（Stage2 語義閘）原本傳空 ctx `{}`
給 evaluator。TOP 型收進中央後，topN 集合會是空的 ⇒ **玩家合法選的卡也被濾掉**、
越橘的一步棋／金屬製造者會靜默失效。改傳 `pending.params`（對既有已收錄 filter 零行為變更，
唯一讀 ctx 的 `BasicEnergy:DistinctTypes` 讀的是 `excludeEnergyTypes`，engine 不傳）。
零產能守衛 `test-filter-yields-candidates` 同步餵 `TOPN_PARAMS`，否則 TOP 型會永遠零產能假 FAIL。

### 順帶修：`validIids` 寫在 pending **頂層**＝死資料（4 張卡，Fable 5 審出）
`PendingSelection` 型別**沒有頂層 `validIids` 欄位**，UI／AI／engine 三端一律只讀
`params.validIids`。寫在頂層 ＝ 那份「可勾範圍」限制完全失效，而且靜默（picker 照開、效果照跑）。

- **密勒頓(J)｜光子纜線**（最嚴重，公平性）：卡面「選擇最多2張**這隻寶可夢身上附加的**
  『基本【雷】能量』卡，改附於1隻備戰寶可夢」。原本 ①沒有 `filter` ②`validIids` 在頂層
  ③phase1 resolver 不驗卡型 ⇒ UI 顯示**整個棄牌區**、resolver 照單全收，
  **棄牌區任意卡（訓練家／寶可夢）都能被當能量附到備戰寶可夢身上**。行為端已重現。
  修：補 `filter: 'BasicEnergy:Lightning'` ＋ validIids 移進 params ＋ phase1 resolver
  自驗交集（`discard-search` 不走 engine 的 sanitize 閘，resolver 是唯一防線）。
- **龍頭地鼠ex(I)｜貫通鑽**：卡面「對手1隻**受傷**備戰」→ 限制失效，可打沒受傷的。
- **龍之猛暴**：卡面限【龍】寶可夢 → 可附給任何自己場上寶可夢。
- **重新啟動箱**：卡面限「未來」寶可夢 → 可附給任何寶可夢。

⚠ 三支既有測試（`test-photon-code-energy-picker` / `test-restart-box-player-distribute` /
`test-photon-cable-lightning`）原本**照抄了錯誤寫法**去斷言頂層 `validIids`，等於把 bug
固化成契約 —— 一併改成 `params.validIids`。

### 一勞永逸：lint **Check X**
`anti-pattern-lint` 新增：pending 物件的**頂層**不得出現 `validIids`。
以 `effectKey:` 為唯一錨點**往回**配對物件開頭（不用「withPending 後第一個 `{`」——
template literal 的 `${}` 會打亂括號配對，且 engine.ts 有直接寫 pendingSelection 的地方），
含**掃描器下限斷言**（配對到的 pending 物件 <300 就報錯）＋**正對照**（餵違規樣本確認抓得到）
＋**反向對照**（合法的 `params.validIids` 不得誤報）。

⚠ tsc 的 excess property check 本該擋下這型錯誤，但本專案 `tsc -p` 依賴
`.svelte-kit/tsconfig.json`（需先 svelte-kit sync），常態假綠 → 只能靠 lint。

### 守衛
新增 `scripts/test-v6129-deck-search-filter-parity.mjs`（114 項，進 npm test chain）：
① 行為端跑 `getAIAction`，斷言每個現役 deck-search filter 都不得選走全部候選
（`any`/`Any` 白名單例外）＋ filter 全集**數量下限斷言**（≥70）防掃描器假綠
② 逐卡正對照（含「【鋼】ex 進化寶可夢 subtype='ex' 必須靠 stage 判」「TOP 範圍外不可選」）
③ 既有 filter 未被 `inst` 參數擴充改壞 ＋ 未收錄仍回 `null`（三態契約）
④ 行為端：engine 閘不得誤殺 TOP 型合法選擇 ＋ 反向對照（TOP 外仍要被清掉）
⑤ 行為端：光子纜線 —— client 送 validIids 外的棄牌區卡不得被當能量附上去 ＋ 正對照

HEAD-FAIL 證明：把 `selection-filter.ts` 還原成 v6.128 → 77 PASS / 32 FAIL；
把 engine 改回空 ctx → ④ 兩項紅；把 `effects.ts` 還原 → Check X 紅。
完整 `npm test` 449 步全綠、兩張免疫網全過、`anti-pattern-lint` 無違規。

## v6.128 — 多部效果卡灰區三張：牌庫空時不能執行（站長裁定）

v6.127 留下的灰區，站長 2026-08-08 裁定：**納莉／丹瑜／小霞的朝氣 牌庫空時不能執行**。

這三張牌庫空時仍有第二段可以執行，依官方 L833 阿楓／L1712 夜間學院的
「一部分能執行就可用」通則，原本**可能**該放行：
- **納莉(H)**「抽4張。回合結束時若手牌≥5則全棄」→ 剩「回合結束棄手牌」
- **丹瑜(H)**「將自己的手牌全部丟棄，從牌庫抽出5張卡」→ 剩「棄全手牌」
- **小霞的朝氣(H)**「若使用了這張卡，則自己的回合結束。從牌庫選最多4張基本【水】能量…」→ 剩「回合結束」

但那半段對玩家**只有壞處**（棄自己的手牌／直接結束回合）。站長裁定：主效果無法執行就不能使用，
**不讓玩家誤按而只吃到代價**。⇒ 三張都加 `regG = deck.length > 0`。

守衛 `test-v6127-trainer-ability-gate.mjs` 加 3 條（17 → 20 項）。

## v6.127 — 效果完全無法執行時，訓練家卡／特性必須「不能使用」（補 14 處 gate）

站長的論述（本版起點，**成立且有大量官方判例背書**）：

> 「如果棄牌區沒有對應的卡牌，這張牌根本就不能使用。因此就算卡面寫『任意數量／若希望／
>   以任意方式／任意選擇』，只要**已知資訊（棄牌區／自己手牌／自己場上）的狀況不符合**，
>   特性、手牌就應該直接 gate 住不能使用；而**如果是招式，就是直接不發動效果**。」

### 官方判例（`PTCG RULES/PTCG_RULES.md`，逐條查證）
| 行 | 卡 | 裁定 |
|---|---|---|
| L805 | 電氣發生器（備戰無【雷】寶可夢） | 「不可以」 |
| L819 | 野餐籃（雙方場上都沒有傷害指示物） | 「不可以」 |
| L821 | 電氣發生器（牌庫 0 張） | 「不可以」 |
| L1957 | 三合一磁怪｜過度放電（棄牌區無基本能量）**特性** | 「不可以」 |
| L2321 | 危險光線（對手已經灼傷＋混亂） | 「不可以」 |
| **L1578** | 鐵斑葉｜補全之網（棄牌區只有1張）**招式** | **「可以」** |

⇒ 站長對「招式不禁用、只是效果不發動」的判斷也正確（L1578 與訓練家的直接對照）。

### 這條也回答了上一版留給站長的 23 張
已知區**不存在「找不到」**（雙方都能確認內容），官方的 fail-to-find（L832）明文限定牌庫。
所以 gate 放行 ⇒ 必定有候選 ⇒ **「必選 ≥1」本來就對，那 23 張不必逐張裁定**。
反向佐證：L837 米莫莎（不能「選 0 張寶可夢然後抽卡」）、L2073 釀光市（只開放「少於上限」，從未開放 0）。

### ⚠ 兩個不套用此判準的例外（官方明文，已寫進守衛檔頭）
1. **多部效果卡**只要有一部分能執行就可以用：奇樹 L1401／阿楓 L833／夜間學院 L1712。
   ⇒ **管理員** 牌庫 0 但場上有「居民會館」時**仍可使用**（把這張卡放回牌庫那半段有效果）。
2. **但「先從已知區選擇 → 然後…」結構**前段失敗會封殺整張：米莫莎 L837。
⇒ gate 一律 **per-card 寫**，不可寫成自動通則。

### 補上的 gate（14 處，全部是「原本完全沒有 gate」）
**依場上／手牌狀態**：
- **覺醒戰鼓(H)**「抽出與場上『古代』寶可夢相同數量的卡」→ 0 隻古代＝抽 0 張＝白白消耗一張卡
- **手部修剪器(H)**「雙方各將手牌丟棄直到 5 張」→ 雙方手牌都 ≤5 ＝沒有卡會被丟
  （⚠ gate 時這張卡還在自己手上，自己那側要 −1）
- **火箭隊的雅典娜(H)**「抽到手牌滿 5（全火箭隊則 8）張」→ 已達標或牌庫空＝抽 0 張＝**浪費支援者權**
- **暗黑鈴(H)**「將雙方的戰鬥寶可夢（【惡】除外）【混亂】」→ 雙方都是【惡】或都已混亂＝無變化
  ⚠ **站長裁定（2026-08-07）：混亂「免疫」不算進 gate** —— 免疫是防禦方的能力，
  不該讓攻擊方連卡都打不出來；官方 L2321 只涵蓋「狀態已經存在」。

**牌庫空＝完全無效果**（官方 L821 同型）：黑連、野餐女孩、帕底亞的夥伴、蓋伊、
高級香氛、黑暗球、精靈球、小剛的發掘；**管理員**＝`牌庫>0 || 場上有居民會館`。

**特性**：
- ⭐⭐⭐ **幸福蛋ex｜幸福切換(H)**「選擇1個自己的場上寶可夢身上附加的基本能量，改附於**其他**
  寶可夢身上」—— `getUsableAbilities` **完全沒有這條 gate**。而 `USE_ABILITY` 是
  **先標記「本回合已用特性」再執行特性函式**，所以場上沒有基本能量時按下去
  ＝只 log 一行、**特性權已經被吃掉**（玩家白白損失，這是本版最嚴重的一項）。
  官方同型鐵證 L1957 過度放電，而過度放電站內**有** gate ⇒ 這是**一致性缺口**，不是新規則。

### 待站長裁定（本版**未**動，屬「多部效果卡」灰區）
- **納莉(H)**「抽4張。回合結束時若手牌≥5則全棄」—— 牌庫 0 時第二段（棄手牌）仍會執行
- **丹瑜(H)**「將自己的手牌全部丟棄，從牌庫抽出5張卡」—— 牌庫 0 時第一段（棄手牌）仍會執行
- **小霞的朝氣(H)**「若使用了這張卡，則自己的回合結束。從牌庫選最多4張基本【水】能量…」
  —— 牌庫 0 時「回合結束」仍會發生
這三張都有「第二段效果／代價」能執行，依官方 L833/L1712 的通則**可能仍可使用**，
但那半段對玩家不利，玩家不會想只做那個。保守維持現狀。

### 守衛 `scripts/test-v6127-trainer-ability-gate.mjs`（17 項，v6.126 版 FAIL 16）
逐卡行為端「條件不符→擋住 / 條件符合→放行」雙向斷言、暗黑鈴的免疫裁定（讀 regG 原始碼確認
沒把 immune 算進去）、幸福切換的 gate 內容、對照組（過度放電本來就有 gate）、
以及**枚舉守衛**：卡面正好是「從自己的牌庫抽出N張卡。」的 HIJ 訓練家都必須有牌庫非空 gate。

### 線索：`pendingStuckEmpty` 安全網
`+page.svelte` 有個全域安全網（候選為空且 minCount>0 時給「放棄（無符合卡）」按鈕）。
**如果 gate 都做對了，那個按鈕永遠不該出現** —— 它的存在本身就是 gate 有洞的證據。
Fable 5 就是用這個角度找出本批缺口的。

## v6.126 — 牌庫搜尋可否選 0：判準是「搜尋對象帶不帶條件」，不是「是不是從牌庫」

站長裁定：「凡是從牌庫搜尋的，因為牌庫是未知內容，應該都要可以不選。請再確認雙卵細胞球和
火箭隊的尼多娜，並且請 fable 5 確認，**我剛才的判斷不一定正確**。」

### ⚠ 上一版我判錯了（誠實記錄）
v6.125 我以「卡面逐字沒有『若希望／任意數量／任意方式』」為由，否決了 Fable 把
**雙卵細胞球｜細胞進化(I)** 與 **火箭隊的尼多娜｜惡之覺醒(I)** 判為可選 0。**Fable 是對的。**
實查後發現這兩張的 **resolver 的 0-branch、`titleOverride`、`addLog` 三處都已寫「（可跳過）」**
—— 實作端早就承諾可跳過，只有 UI 不給鈕（phase A 是 `bench-choose`＝選場上底座＝已知資訊，
站規預設擋）。resolver 的 0-branch 因此成為永遠走不到的死碼。

### ⭐⭐⭐ 但站長的通則也要收窄 —— 官方有明文反例
`PTCG RULES/PTCG_RULES.md` 四條（逐條查證屬實）：
| 行 | 卡 | 裁定 |
|---|---|---|
| L1454 | 親送無人機 | 「不可以。這個情況下，必須選擇1張卡。」 |
| L1708 | 仙后 | 「不可以。必須選擇1張以上的卡加入手牌中。」 |
| L2333 | **君主蛇ex｜青草命令** | 「不可以。必須選擇1張以上的卡牌加入手牌。」 |
| L1373 | 呆呆王ex｜才智頭擊 | 「不可以。**若查看牌庫，必須選擇1張以上**。」 |

⚠⚠ 最關鍵的是君主蛇ex：卡面寫「**若希望**，從自己的牌庫**任意選擇**最多3張卡加入手牌」，
官方卻裁定**不可以選 0**。⇒ **卡面有「若希望」不等於可以選 0**（這也推翻了 v6.125 的直覺判準）。

**官方真正的判準**：
・**帶條件**的搜尋（找寶可夢卡／能量卡／特定名稱…）→ 可宣告「找不到」而選 0（fail-to-find，L832）
・**無條件「任意選擇」**（任何卡都行）→ 牌庫非空一定找得到 ⇒ **必須選 1 張以上**

站內既有的 `minCount >= 1` 短路（v5.607 啪咚猴｜衝衝鼓案例）正是在做這件事，**不能拆**。

### 修掉的：10 張違反官方裁定（可跳過 → 必選 ≥1）
中央 helper `registerDamageThenOptionalDeckSearchToHand` 一改修 4 張
（烈箭鷹ex／貓頭夜鷹｜鉤爪搜尋、甲賀忍蛙ex｜忍之利刃、詛咒娃娃｜玩偶捕捉）；
其餘逐張：君主蛇ex｜青草命令、焰后蜥ex｜詭計、白蓬蓬｜微風之禮（`selfReturnToDeckThenSearchPost`）、
賽富豪｜抓到飽、頭巾混混｜偷竊、叉字蝠｜夜間工作、仙后、桃歹郎｜最後鎖鏈。
一律寫成 `Math.min(1, maxCount)`。

**站長裁定的兩個例外**：
① **完全體攪拌器(H)**「任意選擇最多5張卡，將其**丟棄**」—— 官方四條判例都是「加入手牌」（拿利益），
   丟棄是**代價**，不類推 → **維持可選 0**。
② **賽富豪｜抓到飽(I)** 擲幣 0 個正面時 maxCount=0，`Math.min(1, 0)=0` 自然不卡死 picker。

### 放行的：3 處「程式自己承諾可跳過、UI 卻不給」
雙卵細胞球｜細胞進化、火箭隊的尼多娜｜惡之覺醒（phase A）、密勒頓｜光子纜線 phase 1。
密勒頓走**站長裁定的 B 案**（兩段一致可跳過）—— phase 2 早就在 OPTIONAL 白名單，
phase 1 卻強制，玩家會被迫選能量再在第二步跳過（淨零效果），半套必錯。

### 守衛 `scripts/test-v6126-deck-anysearch-mandatory.mjs`（6 項）
① **卡面驅動枚舉**：掃 live HIJ 卡面含「從牌庫任意選擇」者，逐卡跑真流程驗不得可跳過
   （附驅動數下限，避免「驅不動所以全過」的假綠）
② 站長例外：完全體攪拌器維持可選 0
③ 對照組：帶條件搜尋仍可選 0
④ ⭐ **新判準**：「程式自己（resolver 0-branch／titleOverride／log）寫了『可跳過／可不選』，
   UI 就必須真的給【不選】鈕」—— 完全不需猜卡面，程式自己宣告了。本版就是用它抓到那 3 處。
⑤ 清 Fable 指出的技術債：v6125 守衛的 `MANDATORY_BY_SITE_RULE` 收了
   `brailliant-attach`／`m5-mirieton-photon-code`，但它們**在 OPTIONAL 白名單裡**（判定順序在前），
   是講反話的死註解 → 移除 + 加守衛「兩份清單不得同時收錄同一個 key」。
   ⚠ 抽 key 前要先剝註解，否則註解裡的 `'…'` 會被誤算成還在清單裡（第一版守衛就誤報了）。

### ⚠⚠ 本輪踩到的工具事故（記憶：mount round-trip）
v6.125 是用 `git push <sha>:refs/heads/main` 推的（mount 上 `.git/HEAD.lock` 殘留且無權刪除），
**本地 ref 沒更新**。v6.126 的 patch 一開始用 `HEAD:` 當 base → 讀到的是 v6.124，
**把 v6.125 的改動整批回捲了**（v6125 守衛從 9 PASS 掉到 4 PASS 才發現）。
→ 改用 `git cat-file -p d2949c2:<path>`（v6.125 的 commit sha）當 base 重做。
**教訓：用 sha push 之後，後續 patch 的 base 必須是那個 sha，不是 HEAD。**

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

---

# v6.172 —— 我們自己造成的兩個回歸：拖曳被 actionBusy 鎖死、失聯橫幅誤報

## (1) 拖曳被 `actionBusy` 鎖死最長 33 秒（v6.147 引入、v6.170 放大）

`actionBusy = isTournament && tInFlight` 直接 gate 住手牌 `onpointerdown`。
v6.170 的重送狀態機讓 `tInFlight` 最長撐 `TACT_RETRY_MS 25s + TACT_POST_TIMEOUT 8s ~= 33 秒`，
期間所有拖曳（附能量、放寶可夢到場上）被**靜默丟棄**。v6.121 沒有這個旗標
=> 這就是玩家說「舊版順、新版卡」的直接原因。

### 為什麼不能單純放行
兩個邏輯動作同時在途 => 伺服器依抵達順序套用 => 順序一亂就是另一場對局。
v6.170 的冪等只保證「同一個 actId 只套用一次」，**不保證順序**。

### 修法：佇列（收斂在 3 支函式）
- `tournamentDispatch` 開頭的 `if (tInFlight)` 由「丟掉 + 紅字」改成 `tActQueue` 排隊；
- `_tActDrain()` 在每一發**成功**完成後放下一個出去 —— 一次一個，`tInFlight` 單發鎖完全沒動；
- `_tActClearQueue(why)` 在「最終失敗 / 401,403 / 停止重送 / 對局已結束」四條路徑丟棄佇列並**說明**。

安全性根據（三條同時成立才安全）：
1. 網路上同時只有一個動作 => v6.170 的 actId 冪等語義原封不動；
2. 每個手勢**出佇列時才**走 `tournamentDispatch` => 各自產生自己的 actId，
   不同手勢絕不共用鍵（共用鍵才會被伺服器誤判成重複而吞掉＝動作遺失）；
3. 佇列長度上限 `TACT_QUEUE_MAX = 3`，每次 drain 必定移除一個 => 自我重呼叫鏈有明確上限。

### `actionBusy` 拆成兩個述詞
| 述詞 | 問題 | 用途 |
|---|---|---|
| `actionSending` | 現在有動作在網路上嗎 | 只顯示送出中提示，**不擋任何東西** |
| `actionBusy` | 這一下真的不能做嗎 | **唯一**可以 disable／擋拖曳的述詞 = `tInFlight && 佇列已滿` |

=> 「拖曳在什麼情況下才會被擋」的答案只有一句：**前面已經排了 3 個手勢還沒送出**，
而且擋下來一定跳 `TACT_BLOCKED_MSG`（明講「剛剛這一下沒有生效」）。

## (2) 「與伺服器失聯 xx 秒」誤報

`tOfflineSec = (tNow - _tLastPollOkAt)/1000`，而 `_tLastPollOkAt` **只在 /state 輪詢、
看門狗、手動 resync 更新** => 動作全部成功、伺服器 5xx=0，橫幅照樣跳。
更嚴重的是站長已開啟長輪詢（伺服器 by design 掛起最多 25 秒）=> 對手每次長考
都會被算成「失聯 25 秒」=> 橫幅常駐。這是玩家回報「一直出現失聯」的直接原因。

### 修法：單一中央述詞
- `_tMarkServerAlive()` 是連線健康的**唯一寫入點**，掛在 `tApi` 的成功出口
  => /state、長輪詢正常回應、`POST /action`、看門狗與手動 resync 全部自動涵蓋，
  呼叫端一行都不用改，也不可能有第二份判準漂移。
- `_tLpHangUntil = 送出時間 + T_LP_CLIENT_TIMEOUT_MS`：**在途的長輪詢在它自己的逾時
  到期前不構成失聯的證據**。因為它是未來的時間戳，掛起期間 `tConnStaleMs` 恆為 0。
- `tConnStaleMs = max(0, (tNow - tClockOffset) - max(_tLastServerOkAt, _tLpHangUntil))`
  —— 順帶修掉舊式子拿伺服器時鐘減本機時間戳的偏移問題。
- `_tLastPollOkAt` **語義刻意不動**（仍只給「輪詢停擺看門狗」用）：
  若讓它被 /chat 之類的成功往返推進，看門狗就再也偵測不到「輪詢 timer 死了」。

=> 「玩家在什麼情況下才會看到失聯橫幅」的答案：
**連續 10 秒沒有任何一次成功的伺服器往返**（在途長輪詢逾時前不算），
或伺服器明確拒絕身分（`_tActionAuthErr`，那是另一條、文案也不同）。

正對照（真的斷線仍要跳，而且更早）：斷線時那一發長輪詢會在 30 秒逾時 -> `finally`
清掉掛起窗 -> 秒數立刻從「上次成功往返」起算（已 >=30 秒）=> 橫幅**立刻**出現。

## 守衛 `scripts/test-v6172-action-queue-and-conn-health.mjs`
六個核心全部**行為端實跑**（把函式抽出來 esbuild 轉譯後真的跑），不是驗字串：
(1) 重送期間玩家仍可操作（`actionBusy` 為 false、手勢真的進佇列）
(2) 動作不會重複套用（同一手勢一個 actId、佇列項目各自不同 actId、單發鎖仍成立）
(3) 被擋下的手勢不會靜默消失（每條擋下路徑都要有 notice 文字）
(4) 長輪詢掛起期間不得觸發失聯橫幅
(5) 成功的 `POST /action` 會更新連線健康
(6) 正對照：真的斷線時橫幅仍要跳。

## 部署
`update-admin-full.bat` / `redeploy-oracle.bat` / `update-tournament.bat`
（本版沒有動 engine 與伺服器邏輯，但 admin.html 的版本提示有改）。


---

# v6.187 — iPhone 動態島把「宣告對手棄權獲勝」紅鈕整條吃掉

## 玩家回報
手機（iPhone）上方的動態島「按不到」`⚠️ 對手長時間無回應【宣告對手棄權獲勝】`那顆紅色按鈕
=> 對手掛機時**無法宣告獲勝**，直接影響勝負。

## 真因（求值，不是猜）
`src/routes/game/+page.svelte` 的 `.opp-inactive-banner`：

    position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
    padding: 10px 20px;      /* <= 完全沒有 safe-area */

`src/app.html` 的 viewport meta 帶 `viewport-fit=cover`，且
`apple-mobile-web-app-capable=yes` + `apple-mobile-web-app-status-bar-style=black-translucent`
=> 玩家「加到主畫面」以 PWA 全螢幕開啟時，網頁內容會延伸到動態島底下。
iPhone 14/15/16 Pro 直式的 `env(safe-area-inset-top)` 約 **59px**，
而這條橫幅的總高度只有 `10 + 21(15px 字的行高) + 10 ≈ 41px`
=> **整條橫幅（含那顆紅鈕）都在 59px 的安全區內**，被動態島的硬體遮蔽壓住，一格都按不到。
（不是「按鈕偏上一點」，是整顆都在裡面 —— 所以玩家形容成「按不到」而不是「難按」。）

⚠ 一般 Safari 分頁（沒有加到主畫面）`env(safe-area-inset-top)` 是 0，
   所以在瀏覽器裡試通常**重現不出來**；要用 PWA 模式才會發生。

## 順帶掃出來的同型問題
以「`position:fixed` 且貼齊螢幕上/下緣」為口徑掃 `game/+page.svelte`：

| 元件 | 原本 | 問題 |
|---|---|---|
| `.opp-inactive-banner` | `top:0`，無 safe-area | ⭐ 本次回報（勝負） |
| `.tourn-alert-banner` | `padding: 10px 14px calc(10px + env(...top))` | safe-area **寫錯邊**（三值 padding 的第三值是**下**邊），「⚔️ 前往入場」連結照樣被蓋 |
| `.admin-broadcast-bar` | `top:0; height:34px`，無 safe-area | 廣播文字整條在動態島下 |
| `.tourn-toast` / `.tourn-idle-warn` / `.admin-spy-banner` | `top:8px` | 8px < 59px，全在安全區內 |
| `.restart-waiting-strip` | `top:60px`（`@media<=768px` 再壓成 `top:50px`） | 手機那條 50px < 59px |
| `.tourn-return-bar` / `.tourn-still-here` / `.restart-rejected-toast` / `.chat-fab` / `.chat-panel` / `.opp-turn-toggle-btn` / `.opp-turn-panel` | `bottom:18~92px` | 壓在 home indicator 上 |

## 收斂：單一來源 `--safe-*`
`src/routes/+layout.svelte` 的 `:global(:root)`：

    :global(:root){ --safe-top:0px; --safe-bottom:0px; --safe-left:0px; --safe-right:0px; }
    @supports (padding-top: env(safe-area-inset-top)) {
      :global(:root){ --safe-top: env(safe-area-inset-top, 0px); ... }
    }

⚠ **fallback 為什麼要用 `@supports` 而不是「同一條規則寫兩次」**：
custom property 的值是寬鬆 token stream，不支援 `env()` 的瀏覽器**照樣會接受**
`--safe-top: env(...)`，等到 `var()` 代入時才變成 *invalid at computed-value time*，
整條 `padding` 直接掉回初始值（10px 也一起沒了）。用 `@supports` 包起來，
不支援的瀏覽器根本不會看到那段，變數維持字面 `0px`，所有 `calc()` 照常求值
=> **非 iPhone 版面 0 位移**（守衛②是這件事的正對照）。
消費端一律寫 `var(--safe-top, 0px)`，多一層保險。

⚠ 沒有新增任何 `@media` 當手機開關（守衛④把 `@media` 出現次數釘死：
`game/+page.svelte` 19 個、`MobilePortraitBattle.svelte` 0 個）。
手機直式與桌機仍是兩套獨立分支，本版只改樣式數值來源，不動任何分支條件。

## 遮擋因素（第 4 點：不只看位置）
同樣貼 `top:0` 的 `.admin-broadcast-bar`（z-index **99999**）與
`.tourn-alert-banner`（z-index **99990**）都比 `.opp-inactive-banner` 的
z-index **1000** 高 => 這兩者只要出現就會蓋掉整顆鈕。
本版把 `.opp-inactive-banner` 提到 **100000**（全檔最高），並確認：
`.opp-inactive-banner` / `.opp-inactive-btn` 都沒有 `pointer-events:none`；
`MobilePortraitBattle` 的 `.mp` 是 `position:fixed`（自成堆疊脈絡）且 `z-index:auto`，
其內部最大 `z-index:9000` 被夾在 `.mp` 這一層之內，蓋不到 banner。

## 守衛 `scripts/test-v6187-safe-area-single-source.mjs`
① **求值**（不是比字串）：內建 CSS 解析 + box-model 求值器，代入 `--safe-top=59px`
   算出紅鈕可點區的視窗座標上緣，必須 `>= 59`；且用 v6.186 的舊 CSS fixture
   自我驗證，舊值必須算出 `10 < 59`（HEAD-FAIL 內建正對照，IRON_RULES Rule 25）。
② **正對照**：`--safe-top=0` 時上緣必須**剛好等於 10px**（＝ v6.186 的值）
   => 非 iPhone 版面一格都不動；並檢查 `:root` 先宣告 `0px`、`env()` 覆寫在 `@supports` 內。
③ 貼上緣（`top` <= 64px）與貼下緣（`bottom` <= 100px）的 `position:fixed` 規則
   逐條檢查有無 `var(--safe-*)`，並禁止這些規則再出現裸 `env(safe-area-inset-*)`。
④ `@media` 次數釘死；`.opp-inactive-banner` 的 z-index 必須 >= 所有其他貼上緣元件。

## 部署
`update-admin-full.bat`（admin.html 版本提示有改）。
engine / 伺服器邏輯本版**沒有動**。
⚠ **需要真機驗證**：`env(safe-area-inset-top)` 與 `@supports (padding-top: env(...))`
   在 iOS Safari PWA 模式下的實際值，沙盒無法測；請站長用 iPhone
   「加到主畫面」開啟、製造對手掛機情境，確認紅鈕在動態島下方且可按。
