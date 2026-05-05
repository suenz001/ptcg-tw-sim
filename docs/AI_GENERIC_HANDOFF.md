# PTCG 通用交接提示詞

> 每次邀請新 AI agent 協助前，請將本檔提供給它閱讀。
> 本檔為通用準則，適用於所有任務。如有任務專用的交接提示詞（例如 J 標實裝），兩者應同時提供，**任務專用提示詞優先於本通用提示詞**。

---

## 基本資訊

- **工作路徑**：`/tmp/ptcg-work/repo`
- **正式網址**：https://suenz001.github.io/ptcg-tw-sim/game
- **卡牌資料庫**：https://suenz001.github.io/ptcg-tw-sim/cards?set=ALL
- **本地卡牌資料**：`static/cards/`（JSON，網站資料庫來源）
- **版本檔**：`src/lib/version.ts`（只改這個，**不改 package.json**）
- **當前版本**：請在 `src/lib/version.ts` 第 1 行確認

---

## 開始工作前必做

```bash
cd /tmp/ptcg-work/repo
git pull --ff-only
git status --short
```

---

## 鐵律（任何任務都必須遵守）

### 1. 實作前必須驗證卡牌內容
**禁止**從記憶或猜測卡名、招式、特性或效果。
每次實作卡牌相關功能前，必須：
1. 查 `static/cards/` 原始 JSON 確認卡名、ID、regulationMark、費用、HP、屬性、招式原文
2. 或查線上卡表 https://suenz001.github.io/ptcg-tw-sim/cards?set=ALL
3. 確認後才能動手實作

### 2. G 標卡不實裝
所有卡名含「G」或卡面有 G 標示的卡片，**一律跳過，不實裝**。

### 3. 不使用錯誤的部署網址
**正確**：`suenz001.github.io`
**錯誤**：`ptcg-tw-sim.web.app`（從未使用，請勿提及）

### 4. 所有破壞性變更或版本更新
- 小改 / bug fix → `+0.01`
- 新功能 / 機制 → `+0.1`
- 破壞性變更 → `+1`
- 只改 `src/lib/version.ts`，不改 `package.json`

---

## 開發規範（重要）

### 判斷基礎寶可夢
**永遠用** `isBasicPokemonCard(card)`
**禁止** `card.subtype === 'Basic'`
原因：ex / V / VMAX 等亞種的基礎寶可夢 subtype 不是 'Basic'。

### Stage 判斷
**永遠用** `isStage2PokemonCard(card, pool)`
**禁止** 直接用 `card.stage === 'Stage 2'` 或類似寫法。

### ex 判斷（得 2 張獎賞）
可用 `card.subtype === 'ex'` 或 `name.endsWith('ex')`。

### 進化鏈資料（KO 時必讀）
進化鏈用 `evolvedFromStack: CardInstance[]`（完整 instance，非 cardId 陣列）。
**所有 KO 處理**（引擎正常擊倒、中毒、灼傷、snipe resolver）都必須加：
```ts
...target.evolvedFromStack ?? []   // 進棄牌區
```
未來任何新增的 KO 路徑都必須加這一行。

### HP 計算
**所有 KO 判定**用 `getEffectiveHP(state, playerIdx, card, pool)`
**禁止**直接讀 `card.hp`。
原因：場上 HP 受 PASSIVE 效果影響（夠讚狗 +100、特性加成等）。

### 隱藏資訊規則
- **牌庫內容為隱藏資訊**，禁止用 `regG` 檢查牌庫是否含合法目標（即使有也不能擋出牌）。
- 搜尋動作啟動時，統一使用中性日誌（「從牌庫搜尋 X 卡...」），直到 resolver 完成後才記錄結果。
- **看牌庫前 N 張、看對手手牌**等效果的展示 UI 不對另一方顯示。

### TRAINER_GUARDS
新卡若需要遊戲前期驗證（如只有 2 張手牌才能出卡），應實作 `TRAINER_GUARDS`。
guard 回傳 `false` 時，卡片從 UI 消失、打出前驗證，防止玩家白送卡。

### 線上多人模式
- `RESOLVE_SELECTION`、`setup action` 等 action **必須帶 `senderIdx`**，否則 P1/P2 互踩。
- P2（join 方）使用招式或跳過攻擊後，UI 必須立即送出 `END_TURN`，不等 AI scheduler。

### 日誌完整性
凡是效果「修改特定寶可夢狀態」（附加能量、附加道具、回血、派出上場），log **必須指名目標寶可夢名稱**。

### 【無】費用（Colorless Cost）
【無】費用可由**任意屬性**的能量支付。
PTCG 規則如此，請勿錯誤回退此行為。

### 先手第 1 回合判斷
```ts
state.isFirstTurn && aIdx === state.firstPlayerIdx
```
`firstPlayerIdx` 由 `createGame` 固定不變，不是動態變數。

### 攻擊方自身 damageReduceNextHit
攻擊方自身的 `damageReduceNextHit`（如吠、大聲咆哮後的傷害削減）在傷害計算管線中**不受 `skipDefEffects` 保護**，必須在弱點計算前先行套用。

### 牌庫搜尋 Guard
牌庫為隱藏資訊，搜尋前不可用 `regG` 檢查目標是否存在。啟動時統一用中性日誌。

---

## 測試要求

每次實作完成後，至少跑以下測試：
```bash
node scripts/audit-j-mark-effects.mjs   # 僅 J 標實裝時需要
npm run build
node scripts/test-p2-abilities.mjs
node scripts/test-colorless-cost-regression.mjs
node scripts/test-all-presets.mjs
node scripts/sim-sandbox.mjs
```

如有 UI 修改或新功能，須額外確認：
- Build 不报错
- 本地跑 `npm run dev` 視覺驗證

---

## 完成後必做

1. 確認 `src/lib/version.ts` 版本號已更新
2. 更新 `AI_HANDOFF.md`（如有實質變更）：
   - 版本歷史（新增一列）
   - 最後更新日期與版本號
   - 若有任務專用的交接提示詞，也一併更新
3. Commit 並 push：
   ```bash
   git add .
   git commit -m "feat/fix/docs: <簡述>"
   git push
   ```
   - Build 與 Push 用兩個獨立終端機執行（`npm run build` 視窗會自動關閉）
4. 若 commit 訊息需要多個改動類型前綴，用 `/` 分隔（如 `feat: add X / fix: resolve Y`）

---

## 常用參考檔案

| 檔案 | 用途 |
|------|------|
| `AI_HANDOFF.md` | 本專案最新交接狀態 |
| `src/lib/version.ts` | 版本號 |
| `src/lib/game/effects.ts` | 招式/特性 resolver 總匯 |
| `src/lib/game/effects/_shared.ts` | 可複用 helper |
| `src/lib/game/effects/cards/` | 各卡包 batch resolver |
| `src/lib/engine.ts` | 引擎核心（攻擊、傷害計算、KO） |
| `src/lib/game/state.ts` | GameState 結構定義 |
| `static/cards/` | 卡牌 JSON 原始資料庫 |
| `docs/reports/j-mark-effects-audit.json` | J 標實裝缺口報告 |
| `scripts/audit-j-mark-effects.mjs` | J 標 audit 指令 |
| `scripts/test-p2-abilities.mjs` | P2 特性回歸測試 |
| `scripts/test-colorless-cost-regression.mjs` | Colorless 費用回歸測試 |
| `scripts/test-all-presets.mjs` | 全預設盤面測試 |
| `scripts/sim-sandbox.mjs` | 對戰模擬沙盒 |

---

## 遇到不確定的卡面效果時

1. 先在 `static/cards/` 找到該卡 JSON，確認 `name`、`regulationMark`、招式/特性原文。
2. 若仍有疑慮，查線上卡表確認。
3. 禁止猜測或從其他來源推斷效果內容。
4. 若某卡片效果需要新 UI 或引擎鉤子，請先回報再開發，勿自行假設實作路徑。

---

## 本檔更新原則

- 本檔為通用準則，維護於 `docs/AI_GENERIC_HANDOFF.md`。
- 當發現新規範或錯誤模式，應同步更新本檔，而非只在單次交接時提及。
- 任務專用的 SOP（例如新卡包發售流程、J 標實裝流程）應作為附錄或獨立檔案維護。
