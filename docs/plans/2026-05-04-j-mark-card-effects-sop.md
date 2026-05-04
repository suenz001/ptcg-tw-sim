# J 標卡片效果實裝 SOP 與執行計畫

> **For Hermes:** 實作時必須載入 `ptcg-card-verification`、`ptcg-card-implementation-sop`、`ptcg-card-implementation`、`test-driven-development`。若分派子任務，再載入 `subagent-driven-development`。

**Goal:** 將 `static/cards/` 內所有 `regulationMark === "J"` 的卡片效果完整實裝到 PTCG Taiwan Simulator。

**Architecture:** 以 `static/cards/` 作為網站卡牌資料庫的原始資料來源；每張卡先驗證資料，再分類效果型態，最後以 TDD 實裝到 `src/lib/game/effects.ts`、`src/lib/game/effects/_shared.ts` 或必要的 `src/lib/game/engine.ts` 鉤子。

**Tech Stack:** SvelteKit / TypeScript / Node.js 腳本；主要遊戲邏輯位於 `src/lib/game/`。

---

## 0. 不可違背的鐵律

1. **實作前一定要驗證卡牌內容**：
   - 網站：`https://suenz001.github.io/ptcg-tw-sim/cards?set=ALL`
   - 或原始資料：`/tmp/ptcg-work/repo/static/cards/`
2. `static/cards/` 是網站卡牌資料庫來源，可作為卡名、特性、招式、費用、HP、屬性的原始依據。
3. 禁止先憑記憶或猜測宣稱卡牌效果。
4. **G 標卡不實裝**；本計畫只處理 `regulationMark === "J"`。
5. 每批實裝都要有測試、build、回歸測試與 commit。

---

## 1. 目前盤點狀態（2026-05-04）

以 `/tmp/ptcg-work/repo/static/cards/*.json` 盤點：

- J 標卡總數：**355 張**
- J 標特性數：**58 個**
- J 標招式數：**416 個**
- 含效果文字的 J 標招式：**290 個**
- 無效果文字的純傷害招式：**126 個**
- 以現有 `effects.ts` / `effects/_shared.ts` 字串粗略比對：
  - 疑似已實裝特性：26 / 58
  - 疑似已實裝招式：69 / 416
  - 疑似尚需處理的特性/招式候選：約 253 項

> 注意：以上「已實裝」是字串粗略比對，正式開工前必須由 audit 腳本重新產出工作清單，並人工確認同名卡、同名招式、純傷害招式是否真的不需特殊邏輯。

---

## 2. 工作總流程

每一批卡片都照以下流程：

```text
A. 產生工作清單
B. 驗證卡牌原文
C. 分類效果型態
D. 寫 failing test
E. 實作最小功能
F. 跑單項測試
G. 跑 build + 回歸測試
H. 更新 audit 狀態
I. commit
```

---

## 3. Task 1：建立 J 標 audit 工作清單

**Objective:** 產出所有 J 標卡、特性、招式、是否疑似已實裝、優先級與批次資訊。

**Files:**
- Create: `scripts/audit-j-mark-effects.mjs`
- Create output: `docs/reports/j-mark-effects-audit.json`
- Create output: `docs/reports/j-mark-effects-audit.md`

**Step 1：讀取 `static/cards/`**

掃描所有 JSON，挑出：

```js
card.regulationMark === 'J'
```

每筆紀錄至少包含：

```json
{
  "id": "17978",
  "setFile": "M3.json",
  "setCode": "M3",
  "name": "圓絲蛛",
  "kind": "Attack",
  "effectName": "緊纏之絲",
  "damage": "10",
  "effectText": "在下個對手的回合，受到這個招式的寶可夢無法撤退。",
  "cost": ["Grass"],
  "implementedGuess": false,
  "priority": "P1",
  "category": "cannot-retreat"
}
```

**Step 2：比對現有程式碼**

搜尋以下 key：

```text
卡名|效果名
卡名｜效果名
效果名
```

搜尋範圍：

```text
src/lib/game/effects.ts
src/lib/game/effects/_shared.ts
src/lib/game/engine.ts
```

**Step 3：分類優先級**

- `P0`：規則基礎能力、會影響大量卡片的通用機制
- `P1`：簡單可批量實作的效果
- `P2`：需要玩家選擇、牌庫/棄牌區/手牌操作的效果
- `P3`：需要 engine 新鉤子、持續狀態、跨回合限制、特殊被動
- `P4`：不確定、資料歧義、需要人工確認

**Step 4：驗證**

Run:

```bash
cd /tmp/ptcg-work/repo
node scripts/audit-j-mark-effects.mjs
```

Expected:

```text
J cards: 355
Reports written:
- docs/reports/j-mark-effects-audit.json
- docs/reports/j-mark-effects-audit.md
```

---

## 4. Task 2：先做通用效果模板，不直接逐張硬寫

**Objective:** 先補齊可重用 helper，避免 253 個效果重複實作。

**Files:**
- Modify: `src/lib/game/effects.ts`
- Modify: `src/lib/game/effects/_shared.ts`
- Test: `scripts/test-j-effect-patterns.mjs`

**優先抽象的模板：**

1. 狀態異常：中毒、睡眠、麻痺、灼傷、混亂
2. 不能撤退：下個對手回合不能撤退
3. 擲硬幣：
   - 反面招式失敗
   - 正面次數 × 傷害
   - 擲到反面為止
4. 自傷 / 自己寶可夢受傷
5. 回復 HP：自己、場上、備戰、指定屬性
6. 備戰狙擊傷害
7. 棄能 / 移能 / 附能
8. 從牌庫找卡：寶可夢、基本寶可夢、能量、指定屬性
9. 查看/棄對手手牌
10. 傷害加成：依能量數、傷害指示物、場上數量、手牌數、獎賞卡等
11. 下回合限制：不能使用同招式、受到攻擊反擊、減傷/免疫
12. 特性：主動特性、常駐被動、攻擊時被動、受傷時被動、附能時被動

**TDD 原則：**
每新增一種模板，先寫 `scripts/test-j-effect-patterns.mjs` 的 failing case，再實作 helper。

---

## 5. Task 3：分批實裝順序

### Batch A：純模式、低風險、可快速完成

範圍：

- 狀態異常
- 不能撤退
- 自傷
- 簡單回復
- 簡單擲硬幣
- 簡單備戰狙擊

目標：每批約 15–25 個效果。

驗證：

```bash
npm run build
node scripts/test-j-effect-patterns.mjs
node scripts/test-all-presets.mjs
```

Commit 範例：

```bash
git commit -m "feat: implement J-mark batch A simple attack effects"
```

### Batch B：牌庫、手牌、棄牌區操作

範圍：

- 從牌庫找寶可夢/能量/指定卡
- 棄牌區附能或回收
- 查看或棄對手手牌
- 手牌丟棄作為代價

必須使用 `withPending` + `regR`，並測試取消、無合法目標、數量不足。

### Batch C：變動傷害公式

範圍：

- `50+`、`90×`、依能量數/傷害指示物/場上寶可夢數量/獎賞卡數量等。

實作位置通常是 `regPre`。

### Batch D：主動特性

範圍：

- 「在自己的回合時可使用 1 次」
- 選擇目標、移動能量、回復、抽牌、進化等。

實作位置：`regA` + resolver。

### Batch E：被動與 engine 層效果

範圍：

- 減傷
- 免疫
- 增傷
- 最大 HP 變動
- 撤退限制
- 下回合限制
- 反擊傷害
- rule box / 特性封鎖等全局規則

實作位置：

```text
src/lib/game/effects/_shared.ts
src/lib/game/engine.ts
```

### Batch F：訓練家 / 物品 / 支援者 / 道具 / 場地

範圍：J 標非寶可夢卡，例如 SVM、SV5a、MJ 等。

實作位置視現有 trainer/tool/stadium 架構而定，開工前先 audit 現有訓練家卡註冊模式。

---

## 6. 每張卡的實作紀錄格式

每處理一張卡，必須在 batch notes 中留下：

```markdown
## [setCode] [id] 卡名

來源：static/cards/M3.json
regulationMark：J

### 特性 / 招式原文
- 招式：緊纏之絲
- 費用：[Grass]
- 傷害：10
- 效果：在下個對手的回合，受到這個招式的寶可夢無法撤退。

### 分類
- category: cannot-retreat
- priority: P1
- implementation: regPost + turn marker

### 測試
- test: `scripts/test-j-effect-patterns.mjs::cannot-retreat`
- build: pass
- regression: pass
```

---

## 7. 每批完成標準 Definition of Done

一批卡完成必須同時滿足：

1. 該批所有卡都已從網站或 `static/cards/` 驗證。
2. 每個非純傷害效果都有對應實作或明確標記為「現有引擎不支援 / 延後」。
3. 新效果有測試。
4. 以下指令通過：

```bash
cd /tmp/ptcg-work/repo
npm run build
node scripts/test-j-effect-patterns.mjs
node scripts/test-p2-abilities.mjs
node scripts/test-all-presets.mjs
node scripts/sim-sandbox.mjs
```

5. `scripts/audit-j-mark-effects.mjs` 重新執行後，該批項目狀態更新為 implemented / deferred。
6. 已 commit，commit message 清楚列出 batch 與張數。

---

## 8. 建議的第一個實作批次

先從 **M3 前 20 個 P1 簡單效果** 開始，原因：

- M3 是主要 J 標包之一。
- 早期卡片可建立大量模板。
- 效果型態包含不能撤退、中毒、附能、回復、純傷害與簡單倍率，適合建立測試基礎。

第一批不要直接碰最複雜的被動、最大 HP、跨回合或 trainer 全局效果。

---

## 9. 執行節奏

建議節奏：

```text
1. 先做 audit 腳本
2. 產生完整 J 標缺口表
3. 批次 A：簡單招式 15–25 個
4. 跑完整驗證
5. commit
6. 批次 B/C/D/E/F 依序推進
```

每批完成後回報：

```text
本批完成：N 個效果 / M 張卡
剩餘候選：X 個效果
新增測試：Y 個
build：PASS/FAIL
回歸：PASS/FAIL
commit：hash
```
