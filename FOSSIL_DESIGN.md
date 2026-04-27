# 化石機制設計文件 (v2.187+)

> Leon v2.186 後決定優先做剩 18 張的化石機制（5 張共用 mechanism）。
> 此文件鎖住設計再動工，避免大改寫到一半才發現方向錯。

## 適用卡牌（5 張，全部 Item，supertype=Trainer / subtype=Item）

| ID | regulation | 名稱 | 戰鬥場 / 備戰特殊被動 |
|---|---|---|---|
| 10985 | H | 陳舊的根狀化石 | 戰鬥場：對手【基礎】寶可夢招式 +1【無】能量需求 |
| 10986 | H | 陳舊的背蓋化石 | 不受對手寶可夢招式效果影響 |
| 13947 | H | 陳舊的背蓋化石 (M3) | 同上 |
| 17128 | I | 陳舊的羽毛化石 | 備戰：不受對手寶可夢招式傷害 |
| 18045 | J | 陳舊的顎之化石 | 戰鬥場：對手戰鬥寶可夢招式 -30 傷害 |
| 18046 | J | 陳舊的鰭之化石 | 對手出支援者卡時不受效果影響 |

共通卡面條款：
- 「這張卡可作為 HP60 的【無】屬性的【基礎】寶可夢放置於場上」
- 「這張卡不會陷入特殊狀態」
- 「無法撤退」
- 「若在自己的回合中，則可將場上的這張卡丟棄」

## 設計策略

### CardInstance 加 flag

`types.ts` CardInstance 新增 `fossilOnField?: boolean`：

```typescript
/**
 * v2.187：標明此 instance 雖 cardId 對應 Item 卡（subtype=Item），
 * 但目前作為 HP60【無】屬性【基礎】寶可夢站在場上（戰鬥場或備戰）。
 * 設於 PLAY_FOSSIL action，清於 KO/discard。
 */
fossilOnField?: boolean;
```

不改 Card 卡庫資料（fossil 仍 supertype=Trainer）；只在 instance 加 flag 標明「目前作為寶可夢」。

### 新增兩個 GameAction

```typescript
| { type: 'PLAY_FOSSIL'; iid: string }       // 從手牌打到備戰，視同 PLAY_BASIC 但 instance 設 fossilOnField=true
| { type: 'DISCARD_FOSSIL'; iid: string }    // 自己回合把場上化石丟到棄牌區（含戰鬥場）
```

### Engine hook 點（grep 確認過位置）

| 位置 | 修改 |
|---|---|
| `getEffectiveHP` (engine.ts:302) | 開頭加：if (inst.fossilOnField) return 60 |
| 招式傷害 / HP 路徑讀 `card.hp` 處 | 走 getEffectiveHP，已涵蓋 |
| `pokemonType` 讀取 (effects.ts / engine.ts) | helper `getInstPokemonType(inst)`：fossilOnField → 'Colorless' |
| `card.subtype` Basic 判定 | helper `isInstBasic(inst)`：fossilOnField → true |
| `EVOLVE` action handler (engine.ts:1161) | base 是 fossilOnField → return state（不能進化） |
| `RETREAT` action handler | active fossilOnField → return state |
| `getRetreatCost` 之類 UI helper | fossilOnField → return Infinity |
| `applyStatus` / 中毒/灼傷/睡眠/麻痺/混亂施加處 | fossilOnField → no-op |
| KO 路徑（已走 damage ≥ getEffectiveHP） | 化石被 KO 給 1 張獎賞（無 ex/super/anc tag） |
| `BENCH_PLACE_TRIGGERS`（險惡廢墟等） | fossil 上場不觸發（規則：化石不是「寶可夢」上場） — 待確認 |
| `weakness/resistance` 計算 | 化石無弱抗 — getInstPokemonType 回 Colorless → 對手寶可夢按 Colorless 弱抗判（自動正確） |
| `PLAY_FOSSIL` 新 handler | 同 PLAY_BASIC：bench[] 上限 check、justPlaced=true、fossilOnField=true、log |
| `DISCARD_FOSSIL` 新 handler | 自己回合 + main phase + 場上找到該 iid → 移到 discard、若是 active 走 SEND_NEW_ACTIVE 流程 |
| `applyAutoDraw` mulligan 重抽 | fossil 不算 Basic Pokemon → 手牌全是化石 = mulligan 重抽（PTCG 規則）|

### UI 改動點（+page.svelte）

1. **手牌拖曳**：化石卡能拖到 bench drop zone（同 PLAY_BASIC 路徑），engine dispatch `PLAY_FOSSIL`。
2. **化石卡顯示**：在備戰/戰鬥場，化石顯示為寶可夢樣式 — 卡圖、HP60 條、能量 pip 區（永遠空）、Tool slot（永遠空）。
3. **丟棄按鈕**：自己回合，化石上有額外按鈕「丟棄化石」→ dispatch `DISCARD_FOSSIL`。
4. **不顯示**：撤退按鈕（fossil 隱藏）、進化選項、特性按鈕、招式選擇。

### 各被動效果（v2.188 起逐張實裝）

實裝完核心 scaffold 後，再依下表掛 hook：

| 卡名 | Hook 位置 | 邏輯 |
|---|---|---|
| 根狀化石 | canAffordAttack 對手 active 是 Basic | +1【無】 |
| 背蓋化石 | applyAttackEffect / applySecondaryEffect | 化石為防守者時，跳過所有 effect 區段 |
| 羽毛化石 | bench-snipe 傷害計算 | 化石在 bench 時 damage = 0 |
| 顎之化石 | base damage 計算 | 對手 active 招式 -30 |
| 鰭之化石 | supporter resolver | 化石在場上時，supporter 對「有化石」的玩家無效（罕見）|

## 實裝順序（v2.187 → v2.188 → v2.189）

### v2.187 — 核心 scaffold
- types.ts 加 fossilOnField flag
- engine.ts：getEffectiveHP / EVOLVE / RETREAT / status / KO / mulligan
- 新增 PLAY_FOSSIL / DISCARD_FOSSIL action handler
- 5 張化石 reg：可上場 + 可丟棄（無被動）
- UI 拖曳支援 + 丟棄按鈕 + 顯示為寶可夢

### v2.188 — 各被動 effects
- 5 張被動效果各自 hook

### v2.189+ — 邊角
- 各種 corner case（化石被 ex 招式 KO、AI 不會 PLAY_FOSSIL、險惡廢墟與化石互動）

## Leon 確認的規則（2026-04-27）

1. **險惡廢墟 / bench-place trigger 會觸發** — 化石上場 = 寶可夢上場，所有「放到備戰區」的觸發點都跑。
2. **化石可以附 Tool 和 Energy** — 視為一般寶可夢，無限制。
3. **化石被 KO 給對手 1 張獎賞** — 走正常 KO 流程；白蕾雅之類修飾卡照常生效。
4. **背蓋化石「不受招式效果影響」≠ 不受傷害** — 只擋附加效果（中毒/灼傷/混亂/扣能量/丟道具/降 HP/回手牌等），傷害正常結算。
5. **羽毛化石「備戰區不受招式傷害」包含 bench snipe** — 任何來自對手招式的傷害（戰鬥場直擊或 bench snipe）都過濾。

## 【丟棄】按鈕規則

化石上場後（不分戰鬥場 / 備戰），UI 永遠提供一個【丟棄】按鈕：

- 點擊後該卡直接移到棄牌區，**非昏厥**，對手**不獲得獎賞**。
- 若被丟棄的化石是**戰鬥場**，玩家須從備戰區補 1 隻寶可夢上場（走 SEND_NEW_ACTIVE pending 流程）。
- 若是備戰，直接消失即可。
- 限自己的回合 main phase 操作。
- 不消耗回合行動次數（化石丟棄不算「打 item」）。
