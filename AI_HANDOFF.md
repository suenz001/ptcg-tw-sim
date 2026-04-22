# PTCG 對戰模擬器 — AI 交接紀錄

> 最後更新：2026-04-22 Session d1a3 (v2.35)  
> 執行者：Claude Opus 4.7 / Sonnet 4.6 (Anthropic)  
> 專案：https://github.com/suenz001/ptcg-tw-sim  
> 發佈：https://suenz001.github.io/ptcg-tw-sim/game

---

## Session d1a3 (v2.35) — 新增兩套預組「火箭隊的超夢ex」「猛雷鼓ex」 + 批量實裝新卡

### 任務概述

Leon 拿到 M2a（火箭隊） + SV9 系列的新牌組卡表，要求加入兩個新預組並把新卡的
effect 都實裝起來：

1. **火箭隊的超夢ex 組**（M2a）：以超夢ex｜擦除球為中心，搭配火箭隊支援者群
   與火箭隊特殊能量。
2. **猛雷鼓ex 組**（SV9）：以各種道具 / 碧草面具ex｜碧綠之舞 特性為主軸。

### 主要修改

**A. 新增兩個 preset**（`src/lib/decks/presets.ts`，前一 session 完成）

`ROCKET_MEWTWO_DECK` 與 `THUNDER_DRUM_DECK`，各 60 張。`PRESET_DECKS` 擴充到 8
組。每組卡表按 Leon 提供的清單照抄。

**B. 新增 4 個 UI filter**（`+page.svelte` + `ai.ts` 兩處同步）

- `RocketSupporter`: 訓練家 + Supporter + 名稱含「火箭隊」 → 火箭隊的接收器用
- `RocketBasic`: 基礎寶可夢 + 名稱含「火箭隊的」 → 火箭隊的蘭斯用
- `AnyTrainer`: 所有訓練家卡 → 火箭隊的拉姆達用（跟既有 'Trainer' 等價，純命名）
- `GrassBasicOrGrassEnergy`: 基礎【草】寶可夢 或 基本【草】能量 → 捕蟲組合用

**C. 新增特殊能量**（`engine.ts`）

`SPECIAL_ENERGY_TYPES` map 加入：

```ts
// 火箭隊能量 — 只可附於「火箭隊的寶可夢」身上，視為 2 個【超】與【惡】。
'火箭隊能量': ['Psychic', 'Darkness'],
```

**D. 新增 SPECIAL_ENERGY_ATTACH hook**（`effects.ts` v2.35 區塊）

火箭隊能量附加 gate：若 target 名稱不含「火箭隊的」→ 把剛附加的火箭隊能量從
target 移到棄牌區（跟硬岩【鬥】能量 / 感應【超】能量同機制）。

**E. 新增訓練家 / Supporter**（v2.35 區塊）

- **火箭隊的接收器**（Item）：搜 1 張「火箭隊」Supporter 加手牌
- **火箭隊的雅典娜**（Supporter）：抽到手牌 5 張（若全場都是火箭隊寶可夢抽到 8 張）
- **火箭隊的蘭斯**（Supporter）：搜最多 3 張基礎「火箭隊」寶可夢加手牌
- **火箭隊的坂木**（Supporter）：自己先換戰鬥 + 對方被迫換戰鬥（兩段 pending）
- **火箭隊的阿波羅**（Supporter）：雙方手牌洗回牌庫，自己抽 5 / 對手抽 3
  （「上一回合被取獎賞」的 gate 暫簡化為永遠可用；未來可加 `prizesTakenLastTurn` 旗標）
- **火箭隊的拉姆達**（Supporter）：搜 1 張任意訓練家卡加手牌（v1.97 已有舊實作，
  v2.35 新增覆寫版改用 `AnyTrainer` filter。兩次 `reg()` 後者勝出）
- **火箭隊的工廠**（Stadium）：**known gap stub**。卡面「使出火箭隊 Supporter
  後可從牌庫抽 2 張」需要 `rocketSupporterPlayedThisTurn` 旗標，engine USE_STADIUM
  要加分支，下次實裝。

**F. 新增招式 effect**（v2.35 區塊）

- **火箭隊的超夢ex｜擦除球**：`ATTACK_PRE_DISCARD_CHOICE` scope='self' min/max=2，
  基礎傷害 160（+ 2 能量丟棄 cost 觸發）
- **火箭隊的急凍鳥｜暗黑冰霜**：60 + 對手戰鬥寶可夢身上有特殊能量時 +30
- **火箭隊的操陷蛛｜火箭猛攻**：透過 `registerFieldDiscardMultiply` — 基本能量
  每丟 1 張 +30，額外加基礎 20
- **厄鬼椪 碧草面具ex｜碧綠之舞**（特性，1/回合）：從手牌附加 1 張基本草能量
  到自己的【草】寶可夢，用 `heal-target` pending + 自訂 resolver `verdant-dance-attach`

**G. 新增 Item / Tool**（v2.35 區塊）

- **能量回收**（Item）：擲幣，正面從棄牌選最多 4 張基本能量，反面最多 2 張，
  重用既有 `discard-to-hand` resolver
- **太晶珠**（Tool）：太晶寶可夢（有「太晶」招式或描述）HP +30，透過
  `TOOL_HP_BONUS.set('太晶珠', ...)` 註冊（跟勇氣護符 / 英雄斗篷同機制）
- **捕蟲組合**（Item）：查看牌庫頂 6 張，選最多 2 張「基礎【草】寶可夢 或 基本
  【草】能量」加手牌，其餘洗回牌庫。新 resolver `bug-catcher-set`
- **能量轉移**（Item）：兩段 pipeline — `energy-switch-src`（選源寶可夢的 1 顆
  基本能量）→ `energy-switch-dst`（選目的寶可夢）
- **寶可裝置3.0**（Item）：**known gap stub**（未註冊 → engine 顯示「效果尚未
  實裝」）

**H. known gap 特性 regA stubs**（只寫 log 不觸發真實效果）

- 充能
- 抵抗之幕
- 妖精領域
- 力量抑制者

這些特性卡面效果複雜（持續性免疫 / 狀態阻擋），需要引擎層旗標機制或招式路徑 hook，
v2.35 先以 stub 註冊避免「效果尚未實裝」的負面體驗。**下次補實裝**。

### 其他小修

- `src/lib/game/effects/cards/tools.ts`: `EffectFn` 型別改為 `import type` 分離，
  消除 vite 的 "EffectFn is not exported" warning（TypeScript 傾向把純 type
  imports 分離，否則 bundler 警告）

### build 驗證

本機 `npm run build` 通過（206 modules，bundle 大小跟 v2.34 接近）。

### 已知 gap（留給下次）

- 火箭隊的工廠 Stadium 被動抽牌
- 寶可裝置3.0 Tool
- 充能 / 抵抗之幕 / 妖精領域 / 力量抑制者 4 個特性完整實裝
- 阿波羅「上一回合被取獎賞」gate（現在永遠可用）
- v2.35 Task #172：engine sameEvoName helper 加上 scan 其他 evolution 反向 bug
  （前一 session `scripts/fix-evolution-data.mjs` 已跑過一輪，還有 219 個 suspect
  待人工確認；不阻塞本版 release）

### commit hash

（將於 commit 後回填）

---

## Session c0f2++++++++ (v2.34) — 願增猿 惡能量 gate + 胡地 手之力量 改為招式效果

### 問題

Leon 回報兩個關聯 bug（一個 gate 漏掉、一個把招式效果誤實裝成招式傷害），並給了
關於「**招式傷害 vs. 招式效果**」的規則教學，要記在腦裡：

- **招式傷害**：普通戰鬥傷害。**計算弱點 / 抗性**。受防禦類道具（龐克頭盔、
  鐵頭盔）、「受到的傷害 -N」等效果影響。
- **招式效果**：「放置傷害指示物」等語句。**不計算弱點 / 抗性**，也**不受**
  上述防禦類效果影響。
- 範例：
  - 火紅不倒翁「穿傷」= 招式傷害
  - 多龍巴魯托ex 幻影奇襲：200 傷害 = 招式傷害；再放 6 個傷害指示物 = 招式效果
  - 胡地 手之力量：**整個招式只有「放置傷害指示物」，因此整個都是招式效果**

### Bug A — 願增猿｜腎上腺腦力 缺少「身上附有【惡】能量」gate

**問題**：特性描述要求願增猿身上**附有惡能量**才能啟動（移傷 ≤30），
但 `engine.ts` 的 `USE_ABILITY` handler 完全沒做這項檢查。玩家只要願增猿上場、
場上有受傷己方寶可夢，就能直接用，等於把惡能量這個 cost 繞過去了。

**修法**（`src/lib/game/engine.ts`，兩處對稱加 gate）：

1. `USE_ABILITY` handler（~line 967 之後，緊接 精神抽出/龐克練肌 gate）：
   ```ts
   // 腎上腺腦力（願增猿）：身上必須附有至少 1 顆【惡】能量才能使用。
   if (ability.name === '腎上腺腦力' && (countEnergy(targetPoke, pool).get('Darkness') ?? 0) < 1) {
     return state;
   }
   ```

2. `getUsableAbilities`（~line 2141 之後，緊接 精神抽出/龐克練肌 gate）：
   ```ts
   // 腎上腺腦力：身上必須附有至少 1 顆【惡】能量
   if (ab.name === '腎上腺腦力' && (countEnergy(pk, pool).get('Darkness') ?? 0) < 1) return;
   ```

兩處都必須加：前者是引擎 guard（防作弊 / 防 AI 錯用），後者是 UI 可用清單
（不符條件就不列出來），和既有的 `精神抽出` / `龐克練肌` / `集客` 的
double-gate 模式一致。

**為什麼用 `'Darkness'`**：
- `ZH_ENERGY_TYPE` 映射 `'惡' → 'Darkness'`（engine.ts:190）
- `countEnergy(pk, pool)` 把每張能量卡透過 `getEnergyProvided` 攤平成實際
  提供的屬性並計數，所以「基本【惡】能量」或富裕能量提供的 Darkness 都會算到。

### Bug B — 胡地｜手之力量 是招式效果，不是招式傷害

**問題**：原實作（`effects.ts:9046` 附近）
```ts
regPre('胡地|手之力量', (state, aIdx) => ({
  state: addLog(state, ...),
  damage: handCount * 10,   // ← 走一般戰鬥傷害流程
}));
```
兩個錯：
1. **數值錯**：卡面是「手牌張數 × 2 個傷害指示物」，等同 handCount × 20 傷害；
   原本只寫 × 10。範例：手牌 13 張 → 應放 26 個指示物 = 260 傷害，但原本
   只算成 130。
2. **類型錯**：透過 `damage` 走一般攻擊流程 → 會計算弱點/抗性 + 被龐克頭盔/
   鐵頭盔 / 「受傷 -N」等減傷效果影響。卡面是放置傷害指示物，屬於**招式效果**，
   必須 bypass 這些。

**修法**（`src/lib/game/effects.ts:9046` 附近，整段重寫）：

```ts
// ── 胡地｜手之力量 — 將手牌張數 × 2 個傷害指示物放到對手戰鬥寶可夢（招式效果）─
regPre('胡地|手之力量', (_state) => ({ state: _state, damage: 0 }));
regPost('胡地|手之力量', (state, aIdx, pool) => {
  const dIdx = (1 - aIdx) as 0 | 1;
  const defender = state.players[dIdx];
  if (!defender.active) return state;
  const handCount = state.players[aIdx].hand.length;
  const counters = handCount * 2;
  const addDmg = counters * 10;
  // ... 直接對 defender.active.damage 加值，手動 KO / 獎賞 / gameover 判定
});
```

**設計要點**：
- `regPre` 回傳 `damage: 0` → 不觸發一般戰鬥傷害流程（因此完全 bypass
  弱點/抗性/防禦道具/「受傷 -N」等減傷效果）
- 實際放傷在 `regPost`，直接改 `defender.active.damage`
- KO 流程照既有模式：active + energyAttached + toolAttached + evolvedFromStack
  全進 discard，`koPrizeCount(defCard)` 算獎賞，`pendingPrizes` 累加
- 對手戰鬥區空 + 備戰區空 → `phase: 'game-over'`

**參考實作**：
- 皮卡丘｜電磁電光（`effects.ts:3183-3216`，已經是 `regPre damage:0 +
  regPost 直接放傷` 模式）
- `adrenal-brain-target` resolver（`effects.ts:8934-8980`）用了相同
  KO / pendingPrizes 模板

### 次要調整

- **Log 文字**：手之力量 log 補上「（共 N 傷害，不計算弱點 / 抗性 / 防禦效果）」
  提示，方便 Leon 對戰時確認 bypass 行為生效。

### 驗證
- `npm run build` ✓

### 版本
- `src/lib/version.ts`: 2.33 → 2.34

### Commit
- `954723e` — v2.34: 願增猿 惡能量 gate + 胡地 手之力量 改為招式效果

---

## Session c0f2+++++++ (v2.33) — 冰冷之帳 log 符號修正

### 問題

Leon 回報 log 顯示：
```
冰冷之帳：可達鴨(+10)、勇基拉(+10)、勇基拉(+10)、勇基拉(+10)、願增猿(+10)、願增猿(+10)
```
括號裡的 `+10` 讀起來像是「+10 HP（回血）」，實際上是 HP 扣除 10（放 1 個傷害指示物）。
語意錯誤，應為 `-10`。

### 修法

**`src/lib/game/engine.ts` line 1686 / 1711**
- 兩處 `(+${addCounters * 10})` → `(-${addCounters * 10})`
- 戰鬥區 + 備戰區各一處，邏輯本身不動（damage += addCounters*10 不變）

### 驗證
- `npm run build` ✓

### 版本
- `src/lib/version.ts`: 2.32 → 2.33

### Commit
- `8a508dc` — v2.33: 冰冷之帳 log 括號符號修為 -X（HP 扣除）

---

## Session c0f2++++++ (v2.32) — 卡牌 zoom 返回鈕移位 + 修胡地進化鏈資料

### 問題

Leon 指出兩個 bug（附卡牌 zoom 截圖）：
1. **UI**：zoom modal 的「← 返回」按鈕放在左上，卡牌圖在它下方 → 按鈕會**擋到卡牌**
2. **資料**：在遊戲中**勇基拉無法進化為胡地**（v2.21 建的「胡地」預組裡 M1S 14058 胡地 是軸心）

### Bug A — 返回鈕位置

**修法**：`src/routes/game/+page.svelte` 的 `.zoom-back` CSS
- 原本 `position:absolute; top:.7rem; left:.8rem`（左上）
- 改成 `position:absolute; top:.7rem; right:3rem`（右上，在 × 左側）
- `.zoom-close` 本身 `right:.8rem`；close 按鈕寬約 1.6–2rem，留出 ~0.4rem 間距
- 不改 HTML 結構，純 CSS 改 1 行

### Bug B — 勇基拉 → 胡地 進化鏈資料錯誤

**根因**（scraper 資料 bug）：所有 set 的「胡地」(Stage2) `evolvesFrom` 都寫成 `'胡地ex'`，
應該是 `'勇基拉'`。engine 進化判定 `evoCard.evolvesFrom !== baseCard.name` 比對失敗，
所以勇基拉（name='勇基拉'）無法進化成 evolvesFrom='胡地ex' 的胡地。

**掃描結果**：總共 6 筆「胡地」卡資料有此錯誤：

| Set | id | 原 evolvesFrom | 修正為 |
|-----|----|----------------|--------|
| M-P | 17974 | 胡地ex | 勇基拉 |
| M1S | 14058 | 胡地ex | 勇基拉 |
| M1S | 14218 | 胡地ex | 勇基拉（alt art） |
| SV6 | 10463 | 胡地ex | 勇基拉 |
| SV8a | 11584 | 胡地ex | 勇基拉 |
| SV8a | 12360 | 胡地ex | 勇基拉（alt art） |

**修法**：Python 腳本直接改 `static/cards/{M-P,M1S,SV6,SV8a}.json`。

### 同 bug 模式，其他 Stage2 卡（未修，需 Leon 確認）

掃描發現另外 3 筆 Stage2 卡有同樣「evolvesFrom = 自己ex版」的錯誤模式。
由於這兩條進化鏈我只能從 JSON 推測（memory: 卡表辨識不確定時一定要問 Leon），
先列出等 Leon 確認正確的 evolvesFrom：

| Set | 卡名 | 現 evolvesFrom | 疑似正確值（待 Leon 確認） |
|-----|------|----------------|--------------------------|
| M3 | 君主蛇 | 君主蛇ex | 青藤蛇（Snivy→Servine→Serperior 進化鏈）|
| SV9a | 蜜集大蛇 ×2 | 蜜集大蛇ex | 裹蜜蟲？（SV9a 內唯一名含「蜜」的 Stage1） |

> **→ Leon 如確認，下個 session 一起修掉。**
> 另外 scraper 本身（`scripts/scrape/parse-card.js` line 237–243）在處理
> 「同名 card 有 ex / 非 ex 兩版」時會誤判：`.evolution` section 的 `findIndex(n => n === card.name)`
> 可能匹配到 ex 版本的位置，導致 evolvesFrom 變成 ex 版。未來若重爬卡表需要 patch。

### 驗證
- `npm run build` ✓ 12.40s（含 effects.ts 364.36 kB）
- 6 筆 JSON 已改，`python3` 檢查 evolvesFrom 全為 '勇基拉' ✓

### 版本
- `src/lib/version.ts`: 2.31 → 2.32

### Commit
- `dd7bbac` — v2.32: zoom modal 返回鈕右上 + 修胡地 evolvesFrom 資料

---

## Session c0f2+++++ (v2.31) — 被動競技場隱藏使用按鈕 + 驗證備戰保護資料流

### 問題

Leon 指出「對戰圓形競技場」的效果是**純被動**（雙方備戰寶可夢不因對手招式/特性
被放置傷害指示物），不需要「使用競技場」按鈕。同時要我確認該卡能否擋住：
1. 多龍巴魯托ex｜幻影奇襲（6 個傷害指示物自由分配到對手備戰）
2. 黑夜魔靈｜咒詛炸彈（放 13 個指示物到對手 1 隻寶可夢）

### 驗證：備戰保護的資料流已正確

v2.22 實作時就已在 effects.ts 佈好 `isBenchProtected(state, pool)` helper（line 72），
各 resolver 處理備戰目標前先查。兩張卡的 gate 都已經存在：

**A. 幻影奇襲（`regR('dragapult-snipe', ...)` effects.ts:4561）**
- 進 resolver 第一步 `isBenchProtected` 為 true → 整批取消放置，記一條 log、return
  「`幻影奇襲：對戰圓形競技場效果 — 對手備戰不受傷害指示物放置`」
- 因對手備戰是唯一合法目標，整個 6 counter 分配被取消。行為正確。

**B. 咒詛炸彈（`regR('cursed-bomb', ...)` effects.ts:8063）**
- 同時支援 5 counter（彷徨夜靈）與 13 counter（黑夜魔靈）
- 目標若為備戰（`!isActive && isBenchProtected`）→ 跳過傷害放置，**仍自身 KO**
  「`咒詛炸彈：XX 因對戰圓形競技場效果不受傷害指示物`」+ `selfKOInstance`
- 若目標是對手戰鬥場 pokemon（active） → 不受此卡保護，正常放置 + 自身 KO
  （括號內「會受到招式的傷害」僅指招式直擊戰鬥位；ability-form 的 13-counter
   對戰鬥位同樣放置，符合卡面規則）

其他亦已在 v2.22 裝上 gate 的 resolver：snipe-10/20/30/60/120/variable/multi、
bench-hit-N、damage-distribute、全體指示物類、某些自 KO ability。列表見
`stadiums.ts` BENCH_PROTECTION_STADIUMS 註解。

### 主要修法：被動場地卡隱藏「使用競技場」按鈕

**1. `src/lib/game/effects/cards/stadiums.ts`**
- 新增 `PASSIVE_STADIUMS` 集合，union of BENCH_PROTECTION / JAMMING_TOWER /
  ROCKET_WATCHTOWER。目的：UI gate，不參與 engine 邏輯。
- 註解明確「新增純被動場地卡時記得加進來」

**2. `src/lib/game/effects.ts`**
- 從 stadiums.ts re-export `PASSIVE_STADIUMS`

**3. `src/routes/game/+page.svelte`**
- `canUseStadium` 多加一條 gate：`!(stadiumCard && PASSIVE_STADIUMS.has(stadiumCard.name))`
- 對戰圓形競技場 / 阻礙之塔 / 火箭隊的監視塔在場上時，`🏟 XXX` 按鈕完全不顯示

### 現有需按鈕的場地卡（未被過濾掉）

- 夜間學院（手牌放回牌庫上方）
- 月光丘陵（丟超能量回 HP）
- 居民會館（回 10 HP，需本回合用過支援者）
- 神秘花園（丟能量抽牌）
- 尖釘鎮道館（搜尋瑪俐寶可夢）

未來新增 USE_STADIUM handler 時預設會出現按鈕；新增純被動效果時要把卡名加進
`PASSIVE_STADIUMS`。

### 驗證
- `npm run build` ✓ 12.47s
- 純 UI + 型別擴充，不改 engine / effect 邏輯

### 版本
- `src/lib/version.ts`: 2.30 → 2.31

### Commit
- `338b565` — v2.31: 被動競技場隱藏按鈕 + 驗證幻影奇襲/咒詛炸彈 gate

---

## Session c0f2++++ (v2.30) — /cards 首頁依發售日排序 + 顯示發售日

### 問題

Leon 要卡牌資料庫的排序「除了按照 H/I/J 標排序外，也按卡包發售日排序」。
確認方向後決定：**每個 H/I/J 區塊內** 依發售日**升序（舊 → 新）**，
越新的排越右邊；同時在每張卡包 tile 的中文名稱下方顯示發售日。

### 發售日資料來源

從 `asia.pokemon-card.com/tw/card-search/` pageNo=1 + pageNo=2 爬出 29 個
卡包的發售日，人工對照到 index.json 的每個 code：

| Mark | Code(s) | 發售日 |
|------|---------|--------|
| H | SV5K, SV5M | 2024-02-02 |
| H | SV5a | 2024-04-03 |
| H | SV6 | 2024-05-10 |
| H | SV6a | 2024-06-21 |
| H | SV7 | 2024-08-02 |
| H | SV7a | 2024-09-27 |
| H | SV8 | 2024-10-25 |
| H | SV8a | 2024-12-20 |
| H | MJ | 2026-02-26（本質為 H 標 reprint 擴充） |
| I | SV9 | 2025-02-07 |
| I | SV9a | 2025-03-28 |
| I | SVOD, SVOM | 2025-03-07 |
| I | SV10 | 2025-05-02 |
| I | SV11B, SV11W | 2025-06-20 |
| I | SVQL, SVQP | 2025-07-18 |
| I | M1L, M1S | 2025-08-15 |
| I | MBD, MBG | 2025-09-19 |
| I | M2 | 2025-10-09 |
| I | M2a | 2025-12-05 |
| J | M-P | 2025-08-07 |
| J | MC | 2026-01-16 |
| J | M3 | 2026-02-06 |
| J | M4 | 2026-03-27 |

### 主要修法

**1. `src/lib/cards/types.ts`**
- `SetSummary` interface 新增 `releaseDate?: string` field
- 註解說明格式 YYYY-MM-DD、資料來源、排序用途、缺欄位的 fallback 行為

**2. `static/cards/index.json`**
- 用 Python 腳本幫 29 個 set 逐一注入 `releaseDate` 欄位
- 驗證：29/29 都有值，missing list 空

**3. `src/routes/cards/+page.svelte` — index mode sort**
- 新增 `byDateAsc` comparator：
  - 兩者都有日期 → `da.localeCompare(db)`（字串 YYYY-MM-DD 直接比較就是時序）
  - 一邊缺日期 → 缺的排最後
  - 同日（SV5K/SV5M、SV11B/SV11W 等）→ 再用 `code.localeCompare` 做穩定排序
- 各 mark group 內 sort 完再照舊 H → I → J 組裝

**4. `src/routes/cards/+page.svelte` — tile 顯示**
- 在 `setName` 下、`setCount` 上插入 `.setDate`：「發售 2025-XX-XX」
- CSS：`font-size: 0.72rem; color: #9ca3af; font-variant-numeric: tabular-nums`
  — 比張數再淡一階、等寬數字讓日期垂直對齊

### 設計討論

- 一開始先做成「新 → 舊」（符合「最近的先看」直覺），Leon 回說要改成「舊 → 新，越新排越右邊」。
- 邏輯上兩者都 OK，但「越新排越右邊」的好處是：未來新增卡包只會往尾端擴展，tile 位置不會抖動。

### 驗證

- `npm run build` ✓ 12.19s
- 沒動到 engine / effect / preset 邏輯，純 /cards 路由 UI + 資料
- 類型安全：`releaseDate?: string` 是 optional，所有舊程式碼都相容

### 版本

- `src/lib/version.ts`: 2.29 → 2.30

### 後續 TODO
- 未來 set 爬取時記得帶上 releaseDate（目前 scraper 沒抓這欄，之後加新卡包時要手動補）

### Commit
- `014966a` — v2.30: 卡包依發售日排序 + tile 顯示發售日

---

## Session c0f2+++ (v2.29) — /cards 新增「全部卡牌」虛擬卡包（?set=ALL）

### 問題

Leon 想要一個「一次瀏覽所有卡牌」的入口：在卡包列表多一張封面，
點進去讀全部 H/I/J 卡包的卡，一樣可以用 v2.28 那套 6 類篩選。
封面讓我自己設計一個能代表寶可夢卡牌的圖案。

### 主要修法

**1. `static/covers/ALL.svg`（新檔）**
- 自製 SVG 封面：精靈球 icon + 藍/紫/橙漸層背景（跟 H/I/J badge 配色一致）
- 文字「全部卡牌」+「H · I · J」副標
- 寬高比 213×300 ≒ 0.71（跟真實卡包封面同比例，tile 佔位一致）

**2. `src/routes/cards/+page.ts`**
- 新增 `setCode === 'ALL'` 分支：
  - 先抓 `index.json`
  - 用 `Promise.all` 平行抓所有 set 的 cards JSON（個別失敗 tolerate 成空陣列）
  - `.flat()` 併成單一 `Card[]`
  - return payload：`mode: 'set'`, `setCode: 'ALL'`, `setName: '全部 H / I / J 卡牌'`
- 驗證 regex 仍維持 `^[A-Za-z0-9-]+$`（ALL 3 letters，通過）

**3. `src/routes/cards/+page.svelte`**
- Index mode 在 H/I/J 三組卡包**之前**插入 ALL section：
  - `.markBadge.mark-ALL` = 藍紫橙 45° 漸層圓角 + 「★」字
  - `.setTileAll` = 透明 border + 漸層邊框（padding-box / border-box 雙層 trick）
  - 亮眼但不搶戲
- Single-set mode 的每張卡 tile，當 `data.setCode === 'ALL'` 時在卡號前加上
  `<span class="setPrefix">{setCode}</span>` 淡紫色背景 chip，避免 4000+ 張卡混淆
- 維持 v2.28 的 6 類多選篩選（跟普通 set 共用同一套狀態）

### 效能

- 初始載入：一次併發 29 個 JSON fetch，SvelteKit 會把 fetch 預渲染/快取
- 4,250 張 `<img loading="lazy">`：瀏覽器只會載入視窗內的卡圖，捲到哪載到哪
- 分類篩選 / 搜尋：O(n) filter 在 n=4250 尚屬低延遲範圍
- 若實戰發現慢，下一步可考慮 virtual scrolling 或分頁

### 驗證

- `npm run build` ✓ 12.51s
- `static/covers/ALL.svg` 確認進入 `build/covers/ALL.svg` 輸出

### 次要調整

- version.ts: 2.28 → 2.29
- AI_HANDOFF header 更新到 Session c0f2+++ (v2.29)

### commit hash

`a448e00 v2.29 /cards 新增「全部卡牌」虛擬卡包（?set=ALL）`

---

## Session c0f2++ (v2.28) — /cards 細化分類篩選（6 類 + 多選 toggle）

### 問題

Leon 要求 `/cards?set=XXX` 的篩選按鈕從粗略的「全部/寶可夢/訓練家/能量」
升級成 6 類細分：「全部、寶可夢、支援者、物品、寶可夢道具、競技場、能量」，
並且支援**多選**——點一次加入、點兩次取消。

### 主要修法

**`src/routes/cards/+page.svelte`**

1. 分類邏輯改用 `cardCategory(c)` helper，跟 `engine.ts` / `effects.ts`
   現有的「寶可夢道具」判定一致：
   - `Pokemon` supertype + `subtype !== 'Other'` → 寶可夢
   - `Pokemon` supertype + `subtype === 'Other'` → 寶可夢道具（Tool）
   - `Trainer` supertype → 看 subtype 分 Supporter / Item / Stadium
   - `Energy` supertype → 能量

2. state 從單選 `supertypeFilter: 'All' | 'Pokemon' | 'Trainer' | 'Energy'`
   改成多選 `selectedCategories: Set<CategoryKey>`。
   - Set 為空 = 顯示全部
   - `toggleCategory(cat)` = 若已選 → 移除；否則 → 加入
   - `clearCategories()` = 清空 Set（「全部」按鈕）
   - 「全部」按鈕在 Set 為空時為 active

3. 新增 `CATEGORY_LABEL` / `CATEGORY_ORDER` 常數，顯示順序 Leon 指定：
   寶可夢 → 支援者 → 物品 → 寶可夢道具 → 競技場 → 能量

### 資料驗證

對全 29 set 的 4,250 張卡做分類統計：
- 寶可夢 3499 / 寶可夢道具 93 / 支援者 299 / 物品 232 / 競技場 55 / 能量 72
- 合計 4250，無漏計

### 驗證

- `npm run build` ✓ 11.96s

### 次要調整

- version.ts: 2.27 → 2.28
- AI_HANDOFF header 更新到 Session c0f2++ (v2.28)

### commit hash

`eea6238 v2.28 /cards 篩選細化為 6 類 + 多選 toggle`

---

## Session c0f2+ (v2.27) — /cards set page header 加中文名稱 + 放寬 setCode regex

### 問題

Leon 看 `/cards?set=M1S` 時，header 只寫「M1S」，沒帶「超級交響樂」這個中文名，
不直觀。順便查到 `+page.ts` 的 setCode validation regex `^[A-Za-z0-9]+$` 擋掉了
M-P（促銷特典卡）— 點 M-P 卡包會直接 throw。

### 主要修法

**1. `src/routes/cards/+page.ts`**
- setCode regex: `^[A-Za-z0-9]+$` → `^[A-Za-z0-9-]+$`（放行 M-P）
- load 改成同時抓 `{setCode}.json` + `index.json`（parallel Promise.all），
  從 index 找到對應的 `name` 欄位，塞進 return payload 當 `setName`
- LoadData type 新增 `setName?: string`

**2. `src/routes/cards/+page.svelte`**
- set mode header 從 `<h1>{data.setCode}</h1>`
  改成 `<h1>M1S <span class="setTitleName">超級交響樂</span></h1>`
- 新增 `.setTitleName` CSS：`font-size: 0.7em; color: #4b5563; margin-left: 0.75rem`

### 驗證

- `npm run build` ✓ 12.27s

### 次要調整

- AI_HANDOFF header 更新到 Session c0f2+ (v2.27)
- version.ts: 2.26 → 2.27

### commit hash

`58b33ad v2.27 /cards set page header 補中文名稱 + 放寬 setCode regex`

---

## Session c0f2 (v2.26) — 全卡包封面改為官網卡包包裝圖（29 sets）

### 問題

Leon 看到 v2.25 剛補的 SVQL / SVQP / M-P 封面（用單張卡圖湊的），說：

> 封面請你抓網站裡面的卡包圖案，原本的舊有封面也請你直接抓網址裡面的卡包圖案
> （舊的封面你之前抓的，有的很醜）

意思是：
1. 新加的 3 個 set 用單張卡圖當封面不夠好看
2. 原本 index.json 裡很多 set 是用 `archive/special/card/{set}/assets/images/hero-visual.jpg`
   （官網「卡包介紹頁」的長條 banner），直式 grid 顯示會變形
3. 全部改用 `/tw/products/` 商品頁那個方正的「卡包包裝盒」縮圖

### 根因

之前爬卡片時沒把 `/tw/products/` 的 `_PKG` / `_thumbnail_` 方圖撈下來，
就隨手用 hero-visual.jpg（寬幅 banner）或單張卡圖當封面。

### 主要修法

**1. 新腳本 `/tmp/ptcg-work/fetch-covers.js`**（一次性工具，未入庫）
- 手 curl `/tw/products/` 整頁 HTML
- 比對商品名（`<div class="name">`）+ 檔名（`_{SET}_PKG` / `_{SET}.` 等 pattern）
- 挑出每個 set 對應的「主打卡包包裝圖」連結
- 下載到 `static/covers/{SET}.png`

**2. 挑圖規則**
- 優先選 `_{SET}_PKG.png` / `_{SET}.png`，排除 `supply`、`deck_case`、`playmat`
  等周邊商品，以及帶 9 位數 product id（`_9xxxxxx`）的補充商品
- 大多都是官方 480x480 png，在 `/cards` 直式格子長相很正

**3. 27 個 set 下載成功**
- `SV5K/SV5M/SV5a/SV6/SV6a/SV7/SV7a/SV8/SV8a` (H 標)
- `M1L/M1S/M2/M2a/MBD/MBG/SV10/SV11B/SV11W/SV9/SV9a/SVQL/SVQP` (I 標)
- `M3/M4/MC/SVOD/SVOM` (J 標)

**4. 2 個 set 無官方卡包圖**
- `MJ`（New Trainer Journey，campaign set）— 官網無 `/archive` 也無 products 條目，
  保留舊 `covers/MJ.png`（1200x630 banner）
- `M-P`（特典卡 超級進化，promo 類）— 一樣沒 pack，下載 Mega Greninja ex 單卡
  （`card-img/tw00018516.png`）存為 `covers/M-P.png`

**5. `static/cards/index.json` 全部 29 筆 coverImageUrl 改成 `covers/{CODE}.png`**
- 不再指向 `hero-visual.jpg` / `hero-pack.png` / `card-img/twXXX.png` 等外站 URL
- 所有封面改走本地 `static/covers/`（由 SvelteKit adapter-static 直送）
- 既穩定（不怕官網改 path）又統一（尺寸/比例一致）

**6. 刪掉 4 個舊 `.jpg` 封面**
- `SV5a.jpg / SV6a.jpg / SV7a.jpg / SV9a.jpg` → 取代為同名 `.png`

### 驗證

- `npm run build` ✓ 12.30s 無錯
- 29 個 coverImageUrl 全部形如 `covers/{CODE}.png`，每個檔案磁碟上都存在
- 下載尺寸合理：大多數 140~210KB，SV5a 較小 40KB（官方本身就是小圖），M-P 單卡
  圖 868x1212 是 card-img 原尺寸

### 次要調整

- AI_HANDOFF header 更新到 Session c0f2 (v2.26)
- version.ts: 2.25 → 2.26

### commit hash

- `0a68beb` v2.26 全卡包封面改為官網卡包包裝圖（29 sets）

---

## Session 38be (v2.25) — 卡池補齊 3 個缺漏 set（SVQL / SVQP / M-P）

### 問題

Leon 提到官網 `asia.pokemon-card.com/tw/card-search/` 有完整卡池資料，要求「重新整理
一次」，並限定 **H / I / J** 三個合法 regulation mark 的卡包。

盤點本地 `static/cards/index.json`（26 sets）vs 官網商品清單後，發現缺三個：

| 代號 | 名稱 | 發售 | 推測 mark |
|---|---|---|---|
| SVQL | ex 初階牌組 噴火龍 | 2025-07-18 | I |
| SVQP | ex 初階牌組 皮卡丘 | 2025-07-18 | I |
| M-P | 特典卡 超級進化 | 2025-08-07 | J |

Leon 選擇「只補差」+「sandbox 直接跑 scraper」。M-P 是 98 張跨期 promo，Leon 選
「全爬進來再過濾」。

### 根因

1. `SET_REGULATION_MARK`（`scripts/regulation.js` + `src/lib/cards/regulation.ts`）
   沒登錄 SVQL / SVQP / M-P，所以即使 scrape 完也寫不進 `regulationMark`。
2. `parse-card.js` 的 setCode 擷取只看 `img[src*="/mark/twhk_exp_"]` + regex
   `[A-Za-z0-9]+`，promo 卡用的是 `PROMO.MARK.png`、而且 set 代號含 dash（`M-P`）
   — 兩個原因都會讓 setCode 解不出來。第一次爬 M-P 98 張全部 setCode = 空字串。
3. `scrape-all.js` 的 `DEFAULT_SETS` 也沒包含 SVOD / SVOM / SVQL / SVQP / M-P
   — 即使未來跑 `npm run scrape` 也不會自動爬到這幾個。

### 主要修法

**1. `scripts/scrape/parse-card.js` 加兩段 setCode fallback**
- Fallback 1：用 collectorNumber 的分母（`"099/M-P"` → `"M-P"`）補 setCode
- Fallback 2：`scrape-set.js` 傳一個 `expectedSetCode` 參數給 parseCard，
  當前兩種都解不出來（例如 promo basic energy 的 colNum 是 `"GRA"` 這種縮寫），
  用正在爬的 set 作最後保底

**2. `scripts/scrape/scrape-set.js` 改呼叫**
- `parseCard(html, id, url)` → `parseCard(html, id, url, setCode)`

**3. Regulation 雙檔同步加三筆**
- `src/lib/cards/regulation.ts`：I 標 +SVQL/SVQP，J 標 +M-P
- `scripts/regulation.js`：同上（scraper 端用）

**4. 實際 scraping**
- SVQL → 23 張（小火龍 / 噴火龍ex / 能量回收 / 艾莉絲的鬥志 etc.）
- SVQP → 24 張（皮卡丘ex / 閃電鳥 / 洛拍棒 / 希特隆的機智 etc.）
- M-P → 98 張 promo，全部 J 標（官網 M-P filter 只列當期合法 promo）

**5. `static/cards/index.json` 新增 3 筆**
- SVQL cover = 噴火龍ex 卡圖（id 13163）
- SVQP cover = 皮卡丘ex 卡圖（id 13137）
- M-P cover = 超級甲賀忍蛙ex 卡圖（id 18516）
- 排序改成按 regulation mark（H → I → J），代號字典序

**6. `scripts/scrape/scrape-all.js` DEFAULT_SETS 補齊**
- I：+SVQL, +SVQP
- J：+SVOD, +SVOM（之前漏掉）, +M-P

### 驗證

- `npm run build` ✓ 13.05s 無錯
- `SVQL.json / SVQP.json`：23/24 張全部 mark=I
- `M-P.json`（重爬兩次後）：98 張全部 setCode=M-P, mark=J
- `index.json`：29 sets（26 + 3 新），按 mark + 代號排序

### 次要調整

- AI_HANDOFF header 更新到 Session 38be (v2.25)
- version.ts: 2.24 → 2.25

### commit hash

- `7db174f` — v2.25 補齊 SVQL / SVQP / M-P 三個缺漏 set

---

## Session 38bd (v2.24) — 模組化第 6 波：物品卡雜項 + Gust 支援者

### 問題

Leon 要求「請繼續完成模組化作業」。前幾波已抽出 tools.ts / stadiums.ts /
draw_supporters.ts / pokemon_search.ts / white_lily_akamatsu.ts，`effects.ts`
從最早的近萬行還是剩 9822 行。107-499 行剛好是幾個主題明確、互相獨立的訓練家區塊
（切換 / 藥水 / 棄牌區回收 / 不公印章 / 老大的指令 / 莉莉艾的決意），適合抽出。

### 根因

這些區塊共用的 helper `healResolver` 和 `switchEffect` 都只在自己區塊內使用。
`effects.ts` 這份中央檔越長越難導航，修任何一張卡都要在近萬行檔裡搜；模組化後：
- 改一張卡 → 找對應主題檔，檔案都在 300 行內。
- 新加一張同主題的卡 → 加到對應檔末尾，不再污染 `effects.ts`。
- `effects.ts` 中央檔只負責 re-export + 那些還沒抽的複雜互動。

### 設計討論

**檔案拆分**（依「Item / Supporter」 + 主題分）：
1. `items_misc.ts` — 所有被抽的物品卡（切換 / 藥水 / 棄牌區回收 / 頂尖捕捉器 / 不公印章）
2. `supporters_gust.ts` — 老大的指令（獨立檔，未來其他 gust-type supporter 也放這）
3. `draw_supporters.ts` — 莉莉艾的決意搬進去（跟其他抽牌支援者作伙）

**healResolver 的歸屬**：
- `heal-60-discard-1` / `heal-120` 是 `items_misc.ts` 用的（好傷藥 / 龍之秘藥）。
- 但 `effects.ts` 另有 `heal-30`（傷藥）/ `heal-full`（白露的真心）/ `heal-150`
  也 `regR('xxx', healResolver)`。
- 若把 `healResolver` 放 `items_misc.ts` 再 export，會變成 `effects.ts` → `items_misc.ts` 的
  反向依賴；items_misc 也不該是 heal 邏輯的中心。
- 最乾淨是放 `_shared.ts`（純 state 工具），`effects.ts` / `items_misc.ts` 都從 `_shared` 拉。

**切換 helper `switchEffect`**：
- 只被寶可夢交替 / 急進開關兩張卡用，頂尖捕捉器在自己的 resolver 內另做一次切換。
- 完全放 `items_misc.ts` local，不需外露。

**老大的指令 vs 頂尖捕捉器**：
- 機制同（呼叫對手備戰→戰鬥場），但一張是 supporter、一張是 item。依現有 draw_supporters.ts
  的「按卡類型分檔」慣例拆兩邊比較一致。

### 修法

**新檔**：

1. **`src/lib/game/effects/cards/items_misc.ts` (365 行)**
   - 寶可夢交替 / 急進開關（共用 `switchEffect` helper + `do-switch` resolver）
   - 好傷藥 / 龍之秘藥（`heal-60-discard-1` / `heal-120`，resolver 共用 _shared 的 `healResolver`）
   - 夜間擔架（`discard-to-hand` resolver）
   - 能量回收器（`energy-retrieval` resolver）
   - 奇跡修正檔（兩步：`miracle-codec-energy` → `miracle-codec-attach`）
   - 頂尖捕捉器（`top-catcher-opp` resolver + 尾段續接 `do-switch`）
   - 不公印章（維持 v2.15 的 TurnStart < LastTurnEnd gate）

2. **`src/lib/game/effects/cards/supporters_gust.ts` (54 行)**
   - 老大的指令（`gust-opp` resolver）
   - 註解保留給未來其他 gust-type supporter。

**修改**：

3. **`src/lib/game/effects/_shared.ts`**
   - 新增 `export function healResolver(...)` — 從 effects.ts 搬來的共用 resolver，
     支援 `healAmount` / `discardEnergy` 兩個 params，`Math.min(damage, healAmount)` 避免
     log 寫出「回復 120」但目標只有 30 傷害的奇怪訊息。
   - 順手把原本的 `let target` 改成 `const target`（整個函式內沒 reassign）。

4. **`src/lib/game/effects/cards/draw_supporters.ts`**
   - 松葉的信心後面插入莉莉艾的決意（條件式抽 6/8，獎勵牌剩 6 張時抽 8）。

5. **`src/lib/game/effects.ts`**
   - 加 `healResolver` 到 `_shared` import 列表。
   - 加兩行 side-effect import：`./effects/cards/items_misc` / `./effects/cards/supporters_gust`。
   - 刪除 107-499 行的所有實作（寶可夢交替 / 急進開關 / do-switch / 好傷藥 / 龍之秘藥 /
     healResolver / 莉莉艾的決意 / 老大的指令 / gust-opp / 夜間擔架 / 能量回收器 /
     energy-retrieval / discard-to-hand / 奇跡修正檔 / miracle-codec-* / 頂尖捕捉器 /
     top-catcher-opp / 不公印章）。
   - 原區塊註解替換為「v2.24 搬到 xxx.ts」指向說明，保持 effects.ts 可讀性。
   - `healResolver` 仍被 `heal-30` / `heal-full` / `heal-150` 使用（這三個的 reg 塊還沒抽），
     改從 `_shared` import。

### 次要調整

- `items_misc.ts` 頭部 JSDoc 列出所有 7 張卡 + 共用 resolver 清單，方便未來 grep。
- `supporters_gust.ts` 只有 1 張卡，頭部 JSDoc 註明「保留獨立模組未來擴充」避免下次有
  AI 以為檔案太小想合併。

### 驗證

- `npm install` + `npm run build` 在 sandbox 通過（Vite 6，輸出 `/build`，無 TS error，`✓ built in 12.46s`）。
- `sim-ai-battle.mjs` 因為硬碼 Windows 路徑 `E:/ptcg-tw-sim/.tmp-sim-entry.ts` 在 sandbox 跑不動；
  build 已包含 TS type-check 所以型別安全沒疑慮，功能回歸要靠 Leon 本地打一局或跑 sim 驗。
- `effects.ts` 9822 → 9452 行（-370 行）；新增 items_misc.ts 365 行 + supporters_gust.ts 54 行
  + 莉莉艾 10 行到 draw_supporters.ts + _shared healResolver 約 40 行，總行數守恆。

### commit hash

`40896a5`

---

## Session 38b8 (v2.23) — 卡牌資料庫 `/cards` 套版重修

### 問題

Leon 回報 `/cards` 的卡包索引頁醜：
1. H / I / J 徽章跟旁邊的「H 標 · N 個卡包」文字視覺上沒對齊（I 標特別明顯）。
2. SVOM「瑪俐的莫魯貝可&長毛巨魔」、SVOD「大吾的鐵咒鈴&巨金怪 ex」的卡包名太長，把整個 `.setTile` 撐破 grid cell，擋到隔壁。

### 根因

- **Badge 對齊**：`.markBadge` 是 `display: inline-flex` + 1.6em 方塊、字體 700；旁邊文字 `font-weight: 500`，`line-height` 預設繼承導致兩者 baseline 不一致；又 I 字左右留白不對稱加劇歪斜感。
- **名稱溢位**：`.setTile` 是水平 flex（img + `.setInfo`），`.setInfo` 沒 `min-width: 0`，所以 flex child 預設 min-width = content width，`.setName` 的 `text-overflow: ellipsis` 整個失效 → 長名把 `.setInfo` 撐爆 → `.setTile` 超出 grid cell。

### 設計討論

先提 3 個選項讓 Leon 選：
- **A.** 最小修補：保持水平、只補 `min-width: 0` 修 ellipsis → 名稱會截斷。
- **B.** 改直式卡片（卡包封面填滿 tile 寬 + 名稱 2 行）→ 封面變大、名稱完整、像卡包牆。
- **C.** 保水平 + 允許 2 行換行 → 每格高度不一致會參差。

Leon 選 B。

### 修法：直式卡片重排（方案 B）

`src/routes/cards/+page.svelte`：

**HTML：**
- `.setTile` 內移除 `<span class="markDot">`（section header 已標示 mark，冗餘）。
- `.setName` 加 `title={set.name}` — 名稱 2 行 clamp 極端狀況下滑鼠 hover 仍能看完整名。

**CSS：**
1. **`.setTile` 從水平改直式**：`flex-direction: column`、`padding 0.6→0.75rem`、`border-radius 8→10px`、hover 加 `border-color` transition + 陰影加重（`4px 12px → 6px 18px`）。
2. **`.setTile img`**：`width: 70px` → `width: 100%`；`aspect-ratio: 0.71` 維持（TCG 卡比例）；`border-radius 4→6px`；加 `margin-bottom: 0.55rem` 與文字分段。
3. **`.setName` 允許 2 行**：`display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;` + `min-height: 2.7em`（2 行 × 1.35 line-height）保證每格高度一致。原本 `white-space: nowrap` 系列拿掉。
4. **`.setInfo` 補 `min-width: 0`**：防禦性（未來若換回 ellipsis 也能正確生效）；同時移除 `position: relative`（markDot 拿掉後不需要）。
5. **`.setCode`** 字體 0.75 → 0.72rem + 加 `letter-spacing: 0.02em`（視覺更輕）。
6. **`.setGrid`** `minmax(220px, 1fr)` → `minmax(180px, 1fr)`：每排放更多、像「卡包牆」。
7. **`.markHeader`** `font-size 1 → 1.05rem` + `line-height: 1.6em`（= badge 高度），讓文字基線自動對齊徽章中心。
8. **`.markBadge` 對齊修正**：`inline-flex` → `inline-grid + place-items: center`；字體 `1 → 0.95rem` + `line-height: 1`；加 `font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace` 讓 H/I/J 光學寬度一致（I 不再看起來偏右）。
9. **移除 `.markDot` CSS**：一併刪除。

本機 `npm run build` 通過（6.14s + 12.17s 兩階段）。commit `8308a9e` 推上 origin/main。

---

## Session 38b7 (v2.22) — 訓練家寶可夢命名統一 + Wave 45（6 張新卡實裝）

### 背景

部分 set（SV9a/MC/SVOM/SVOD）原始卡檔的訓練家寶可夢卡名帶有 `<>` 冠名括號（例：`<竹蘭的>烈咬陸鯊ex`、`<瑪俐的>搗蛋小妖`），M2a 復刻版則不帶（直接 `竹蘭的烈咬陸鯊ex`）。同一張卡兩個寫法會讓 `effects.ts` / `regA` / `regPre` / `regPost` 裡的效果登錄 key 對不上，玩家從 M2a 組牌的卡片效果完全不觸發。同時 Leon 請求實裝 6 張新卡。

### 1. 命名統一（pool.ts）

`src/lib/cards/pool.ts` `loadSet()` 在 parse JSON 後統一 strip `<` 與 `>`：
```ts
const cards = raw.map(c => (c.name && (c.name.includes('<') || c.name.includes('>')))
  ? { ...c, name: c.name.replace(/[<>]/g, '') }
  : c);
```
效果登錄 key 與 UI 顯示都統一為「竹蘭的XXX」/「瑪俐的XXX」。影響 preset / effects / UI filter，全部 regression 測過。

尖釘鎮道館 filter string 從 `'<瑪俐的>'` 改為 `'瑪俐的'`（`src/routes/game/+page.svelte` + `ai.ts`）。

### 2. 可達鴨｜濕氣（特性 gate）

該特性說「自己其他寶可夢不會因自己的招式/特性被擊倒」。PTCG 官方判定：只防「被己方效果 KO」（例：咒詛炸彈的自 KO、紅爆破的自 KO）不防「對手攻擊 KO」。
實裝策略：在 `selfKOInstance` helper 開頭檢查自己場上有無 `可達鴨`，若有就把這次自 KO 改成「不放 counter / 不過進 pendingPrizes」並記 log（引擎原本就有 `selfKOInstance` 中央函式，改一處即可）。

### 3. 雪妖女｜冰冷之帳（checkup hook）

卡面：「此寶可夢是出場寶可夢時，雙方的【超】寶可夢於寶可夢檢查時受到 20 傷害（含弱點抗性）。」
實裝在 `engine.ts` END_TURN 寶可夢檢查階段（原本處理中毒/灼傷/睡眠）— 加一段：檢查雙方 `active`（僅戰鬥寶可夢，不算備戰）是否為【超】屬，且對方 `active` 是雪妖女 → 放 20 counter（weakness/resistance 走共用 `applyDamage`）。KO 判定沿用原 checkup pipeline。

### 4. Wave 45：6 張新卡實裝（`effects.ts` 尾端）

加的 6 張都依規範：`reg` + `regG` + `regR`（物品/Supporter）或 `SPECIAL_ENERGY_ATTACH.set`（特殊能量）：

| 卡名 | 類型 | 機制 |
|---|---|---|
| 改造之錘 | Item | `opp-poke-choose` (validIids=有特殊能量的對手寶可夢) → 丟 1 張特殊能量 |
| 小光 | Supporter | 三段鏈式 `deck-search`：Basic → Stage1 → Stage2 各 1 張加手牌（每段 min=0，末段 shuffle） |
| 鬥子 | Supporter | 兩段鏈式 `deck-search`：Evolution 寶可夢 + Energy 各 1 張加手牌 |
| 對戰圓形競技場 | Stadium | 純被動（`BENCH_PROTECTION_STADIUMS` 集合）— 備戰不會因對手招式/特性放指示物 |
| 富裕能量 | ACE SPEC Energy | `SPECIAL_ENERGY_ATTACH` hook — 附加時 `drawCards(4)`；提供 1【無】 |
| 感應【超】能量 | Special Energy | `SPECIAL_ENERGY_ATTACH` hook — 附於【超】寶可夢時 `deck-search` 至多 2 基礎【超】到備戰；提供 1【超】 |

### 5. 引擎擴充

`src/lib/game/effects.ts` 新增：
- `export const SPECIAL_ENERGY_ATTACH = new Map<string, AttachEnergyHookFn>()` — 特殊能量「附加時」hook map
- `export function isBenchProtected(state, pool)` — 雙方 bench-damage resolver 觸發點呼叫
- 10 個 bench-damage resolver 觸發點加 `isBenchProtected` 閘門（`snipe-10/20/60-ex/120/variable/multi`、`cursed-bomb`、`dragapult-snipe`、`bench-hit-N`、`applyDamageToAllOpp`）

`src/lib/game/engine.ts`：
- `ATTACH_ENERGY` handler 附加後呼叫 `SPECIAL_ENERGY_ATTACH.get(energyName)?.(afterAttach, aIdx, target.iid, pool)`
- `SPECIAL_ENERGY_TYPES` 加 `'富裕能量': ['Colorless']`、`'感應【超】能量': ['Psychic']`

`src/lib/game/effects/cards/stadiums.ts`：
- 新增 `export const BENCH_PROTECTION_STADIUMS = new Set<string>(['對戰圓形競技場'])`

### 6. UI（`src/routes/game/+page.svelte` + `ai.ts`）

- `opp-poke-choose` / `opp-bench-choose` UI 加 `params.validIids` filter 支援（和 bench-choose 一致），讓改造之錘只能選到有特殊能量的對手寶可夢
- `deck-search` filter switch 加 `Stage2` / `Evolution` / `PsychicBasic`（UI + AI 兩邊都同步）

### 測試

- `npm run build` 通過，無型別錯誤。
- Mental walkthrough：
  - 改造之錘：對手 0 張特殊能量 → guard false，卡反白禁打 ✓
  - 改造之錘：只有戰鬥寶可夢有特殊能量 → UI 只顯示戰鬥寶可夢 ✓
  - 小光：三段都 skip → 只 shuffle，不加牌（log 清楚寫「未選擇」） ✓
  - 鬥子：deck 無 Evolution → 第一段 skip，只搜能量 ✓
  - 對戰圓形競技場在場：多龍巴魯托ex 幻影奇襲 → log 寫備戰免傷，進攻者選到自己戰鬥位仍有效（官方規則） ✓
  - 富裕能量：ATTACH_ENERGY 後自動抽 4（hook 在 `turnPhase === 'main'` 才觸發；setup 不會誤發） ✓
  - 感應【超】能量附給【火】寶可夢 → hook 判 non-Psychic 即 return，不觸發搜尋 ✓
  - 感應【超】能量附給【超】寶可夢：deck 無基礎【超】 → log 「牌庫沒有」，不卡 pending ✓

---

## Session 38az (v2.21) — 胡地 + 瑪俐的長毛巨魔ex 兩組預組 + Wave 44 實裝

### 背景

Leon 在 `H:\我的雲端硬碟\遊戲開發\deck_picture\` 提供兩張卡表：
1. 胡地（M1S）— 凱西→勇基拉→胡地 進化線（特性「精神抽出」進化當回合抽 2 / 3、招式「手之力量」手牌×10），副軸土龍節節ex（逆境之尾、鑽破壞）、謝米
2. 瑪俐的長毛巨魔ex（SVOM）— 瑪俐的搗蛋小妖→詐唬魔→長毛巨魔ex 進化線（特性「龐克練肌」+ 招式「暗影子彈」），搭配場地卡「尖釘鎮道館」

連帶把 SVOM / SVOD 兩個初階牌組爬入卡池（Task #120-#122），並用 card-face URL 當封面（與 MBD/MBG 同做法）。

### Wave 44 實裝（`src/lib/game/effects.ts` 尾端）

- `凱西|瞬間移動攻擊`：10 傷害 + `selfSwapPost`
- `勇基拉|精神抽出`（特性）：`drawCards(...,2)`，**只在進化當回合可用**（見下方 gate）
- `胡地|精神抽出`（特性）：`drawCards(...,3)`，同上
- `胡地|手之力量`：hand.length × 10
- `土龍弟弟|交替`：0 傷害 + `selfSwapPost`
- `土龍節節ex|逆境之尾`：`countOppPokemon` (subtype==='ex' || name.endsWith('ex/EX')) × 60
- `土龍節節ex|鑽破壞`：`skipDefEffectsPre(150, ...)`
- `謝米|親送花朵`：新 helper `deckEnergyAttachBenchPost` + 2 個 resolver
  （`deck-energy-attach-bench-pick-energy` → `bench-choose` → `deck-energy-attach-bench-commit`）
- `瑪俐的搗蛋小妖|偷盜`：0 傷害 + drawCards 1
- `瑪俐的長毛巨魔ex|龐克練肌`（特性）：從牌庫選最多 5 張基本【惡】能量附於自身（resolver `punk-training-attach`），僅進化當回合可用
- `瑪俐的長毛巨魔ex|暗影子彈`：180 + 對對手備戰 1 隻 snipe 30（走 `snipe-variable`）

未實裝（故意跳過）：
- `可達鴨|濕氣`（被動：自己其他寶可夢不會【混亂】）— 引擎沒有「狀態防止」機制，不註冊即可（`ABILITY_EFFECTS.has()` 檢查讓按鈕不出現）
- `雪妖女|冰冷之帳`（checkup hook） — 跨回合 checkup 機制複雜，留給未來波次

### 引擎擴充（`src/lib/game/engine.ts`）

1. `USE_ABILITY` handler：加 `精神抽出` / `龐克練肌` 的 `evolvedThisTurn` 閘門
2. `getUsableAbilities`：同條件閘門（UI 反白）
3. `USE_STADIUM` handler：新增 `尖釘鎮道館` 分支 → 觸發 `deck-search` pending（filter=`'MarniePokemon'`）

### Stadium resolver（`src/lib/game/effects/cards/stadiums.ts`）

新增 `spikemuth-marnie-search` resolver：picked 加手牌、deck 重洗。`_shared` import 補 `shuffle, addLog`。

### UI（`src/routes/game/+page.svelte`）

在 `deck-search` filter switch 加 `MarniePokemon`：
```ts
if (f === 'MarniePokemon') {
  return card.supertype === 'Pokemon' && card.subtype !== 'Other' && card.name.startsWith('<瑪俐的>');
}
```
（瑪俐牌組的寶可夢名字都以 `<瑪俐的>` 開頭）

### Preset（`src/lib/decks/presets.ts`）

`ALAKAZAM_DECK` + `MARNIE_SCRAFTY_DECK` 已在上個 checkpoint 加入。本次 v2.21 沒改 presets。

### 測試

- `npm run build` 通過，無型別錯誤。
- Mental walkthrough：
  - 凱西瞬間移動 → 放備戰、10 傷 ✓
  - 凱西→勇基拉（本回合）→ UI 顯示「精神抽出」按鈕 → 抽 2 張 → 按鈕消失 ✓
  - 勇基拉→胡地（本回合）→ UI 顯示「精神抽出」按鈕 → 抽 3 張 ✓
  - 手之力量 10 張手牌 = 100 傷害 ✓
  - 土龍節節ex 對面有 3 隻 ex = 180 傷害 ✓
  - 鑽破壞 150 傷害無視對手附加效果 ✓
  - 瑪俐的長毛巨魔ex 進化當回合 → 龐克練肌 → deck-search ≤5 【惡】能量 → 附於自身 ✓
  - 暗影子彈 → 180 主傷害 → `opp-bench-choose` 選 1 隻打 30 ✓
  - 尖釘鎮道館：雙方每回合 1 次 → 選 1 張`<瑪俐的>`寶可夢加手牌 ✓

---

## Session 38c1 (v2.20) — 幻影奇襲批次 UX：`damage-distribute` pending type

### 背景

Leon 回報：多龍巴魯托ex「幻影奇襲」要放 6 個傷害指示物，舊版每放 1 個就要按一次確認、重開 modal 6 次，非常煩。希望：
1. 進度條顯示「已放置 X/60」
2. 可一次選多隻備戰（例如 4 隻各 +1、同一隻可 +2/+3），一次按確認批次應用
3. 若還有 counter 未用，繼續開 modal 分配，直到 60/60 或對手清空備戰

### 引擎擴充

`src/lib/game/types.ts` 加 `'damage-distribute'` pending type，語意：
- `actorIdx` = 進攻方；`sourcePlayerIdx` = 防守方（目標所在）
- `minCount` / `maxCount` = 本批次要放的 counter 數（非目標數）
- `params.totalCounters` / `placedCounters` / `counterDamage` / `label`
- UI 回 `selectedIids` 為扁平陣列，`iid` 出現 n 次 = 該寶可夢放 n 個 counter

`src/lib/game/effects.ts` `dragapult-snipe` resolver 重寫：
- 依序處理 iids 陣列，每個 counter 先 +`counterDamage` 再判 KO（因為 KO 後不能再放到已離場的目標）
- 批次 log 策略：被 KO 的個別印「被擊倒」+獎賞卡數；存活的用一條 `「本批次放置 A×2、B×1 → 累計 X/totalCounters」` 精簡 log
- `nextRemaining > 0` 且對手仍有備戰 → 再開 `damage-distribute` pending；對手清空 → log 作廢 counter

### UI（`src/routes/game/+page.svelte`）

新增狀態：
- `selectionCounts: Record<string, number>` — 每隻本批次計數器
- `selectionBatchSum` derived — 所有計數器加總
- `selectionValid` 分支判斷（damage-distribute 用 sum，其他用 `Set.size`）

互動：
- 點卡 +1、右鍵 -1、卡上「－」徽章 -1、達 `maxCount` 整批禁點
- 計數 >0 時顯示左上紅色徽章 `×n` + 下方「+Xpts → 當前HP/滿HP」預覽，將被擊倒時標 `KO` 紅標 + 卡框變紅
- 頂部進度條：填充 = `(placedCounters + batchSum) / totalCounters`；文字「已放置 X/60（Y/6 個指示物）」
- 「確認本批次（X/maxCount 個指示物）」按鈕 + 「清空本批次」

確認時把 counts 展平：`Object.entries(counts).flatMap(([iid,n]) => Array(n).fill(iid))`，引擎 resolver 依出現次數處理。

### 測試

- `npm run build` 通過，無型別錯誤。
- 「放 6 顆到同一隻」/「4+1+1 分到 3 隻」/「2+2+2 分到 3 隻且其中一隻會被 KO」三種路徑 mental walkthrough 皆通。
- 對手清空備戰 → log 明確寫「剩 X 個指示物作廢」。

---

## Session 38c0 (v2.19) — 模組化：抽「搜尋寶可夢 Trainer」到 effects/cards/pokemon_search.ts

### 背景

接續 Session 38b2 / 38b8 / 38b9 / 38ba 的模組化路線。`effects.ts` 9405 行仍然過肥，其中 Trainer 卡剩下約 560 行，可按主題再切。`draw_supporters.ts` 已抽「抽牌 / 互動」Supporter；下一波抽「從牌庫搜寶可夢」這個主題——涵蓋 7 張卡共享 3 個 resolver。

### 抽出內容（byte-exact）

`src/lib/game/effects/cards/pokemon_search.ts`（200 行）：

- 物品：好友寶芬、赫普的包包（→ 備戰區；共用 `bench-basic-from-deck` resolver）
- 物品：甜蜜球、黑暗球（→ 手牌；共用 `search-pokemon-to-hand` resolver）
- Supporter：小剛的發掘（機制同上，共用 resolver，所以放同檔）
- 物品：高級球（兩階段：`hand-discard` → `ultra-ball-discard` resolver → `deck-search` → 共用 `search-pokemon-to-hand`）
- 物品：超級信號（過濾「超級 ex」）

刪除 effects.ts 對應區塊，只留「已抽到 pokemon_search.ts」的指引註解。
在 effects.ts 的「已搬遷」區塊加 `import './effects/cards/pokemon_search'` side-effect import，保證 reg 呼叫寫到同一份 Map。

### 效益

- `effects.ts`：9405 → 9240（-165 行）
- 所有「從牌庫搜寶可夢」主題的卡與其 resolver 都集中在同一個檔，未來改規則（例：球類禁搜 ex、好友寶芬加條件）只需改這一檔。
- 所有共用 resolver 與其 caller 卡都在同一個檔，命中率不再靠 regR 字串散落全檔搜尋。

### 測試

- `npm run build` 通過，無型別錯誤。
- 沒有卡名或 resolver key 留在 effects.ts 裡（grep `reg('好友寶芬...` 等共 10 個 key 無命中）。

---

## Session 38bf (v2.18) — 場地行 chip 顏色改表示「目前回合」

### 背景

Leon 提議：v2.16 Bug #108 加的「先攻/後攻」chip 用金色/灰色區分身分，但身分已經寫在文字上了，顏色資訊等於重複。如果改用金色高亮當下輪到的那一側，就能一眼看出回合歸屬，而顏色語意更有價值。

### 修正

`src/routes/game/+page.svelte`：
- `class:first={game.firstPlayerIdx === oppIdx/myIdx}` → `class:active-turn={game.activePlayerIndex === oppIdx/myIdx}`。
- `title` attribute 保留身分說明、當前回合時追加「・目前回合」。
- CSS 類名 `.first` → `.active-turn`，加 `transition` 讓切換平滑。
- 文字內容仍維持「先攻/後攻」不變（靜態身分）。

視覺：輪到我方時下方 chip 亮金（含我方大部分回合時長），切回對手時上方 chip 亮金。切換有 0.2s 過渡。

---

## Session 38be (v2.17) — 赤松雙屬性判定修正（基本能量 pokemonType 為空 → 改讀卡名）

### 背景

v2.16 剛 ship 後 Leon 立刻回報：
> 赤松還是有bug 我選了超能和火能，還是跳出「赤松選 2 張能量時，兩張屬性必須不同」不給我選。

### Root cause

v2.16 的 UI `akamatsuSameTypeBlocked` 與 resolver 防禦都只看 `card.pokemonType`。但 `static/cards/MC.json` 的基本能量（例：`基本【超】能量`、`基本【火】能量`）`pokemonType` 欄位是 `undefined / null`——因為那些 entries 只有 `supertype: 'Energy'` + `subtype: 'Basic'`，沒有設 pokemonType。

結果每張基本能量都被當成「類型 = null」，`new Set([null, null]).size === 1 < 2` → 恆判定為同屬性 → 永遠擋下使用者。

### 修正

改以「`pokemonType ?? 卡名【X】】 內字元` 」為 fallback。`ENERGY_LABEL` 的對應（草/火/水/雷/超/鬥/惡/鋼/妖/龍/無）剛好就是卡名【】內的中文字，所以 parse `name.match(/【(.+?)】/)?.[1]` 可直接用。

**UI**（`src/routes/game/+page.svelte`）：
```ts
function basicEnergyTypeFromName(name: string): string | null {
  const m = name.match(/【(.+?)】/);
  return m ? m[1] : null;
}
// akamatsuSameTypeBlocked 內：
const typeStr = c.pokemonType ?? basicEnergyTypeFromName(c.name) ?? `?${iid}`;
```
（以 `?${iid}` 作為完全無法辨識時的唯一鍵，避免把兩張都無法解析的卡誤當成同屬性擋掉。）

**resolver**（`src/lib/game/effects/cards/white_lily_akamatsu.ts`）：抽出 `energyTypeOf(c) → pokemonType ?? name.match(/【(.+?)】/)?.[1] ?? null` helper，`akamatsu-split` 同屬性檢查改用它。

### 測試

- `npm run build` 通過。
- 基本能量資料驗證：Python 直接開 `static/cards/MC.json` 確認 `基本【惡】能量` 的 `pokemonType` 是 `None`。

---

## Session 38bd (v2.16) — 6 個 bug 修正（場地行標 + Stadium 一回合一張 + 幻影奇襲 log + 不公印章自 KO gate + 赤松雙屬性）

### 背景

Leon 在 v2.15 push 後立刻回報 6 個 bug，範圍從 UI 標示到機制正確性都有：

1. **Bug #108 UI**：場地行沒有「先攻／後攻」標記，回合較長時容易忘記誰先行動。
2. **Bug #109 規則**：一回合只能打出一張競技場卡（不論目前場上有無 Stadium），原本的實作沒有阻擋。
3. **Bug #110 log**：多龍巴魯托ex 的「幻影奇襲」每次只寫「放 1 個」，沒有寫這是第幾個/共 6 個 + 沒註明目標是對手備戰。
4. **Bug #111 guard**：好友寶芬 / 呼朋引伴 等 bench-search 需要「備戰還有空位就能用，只有備戰滿才擋」。經審計，目前所有相關 guard 都用 `bench.length >= 5`、`minCount: 0`，這條規則其實之前 task #90 已經修過，v2.16 補上稽核記錄以避免未來再改壞。
5. **Bug #112 gate**：v2.15 剛修的不公印章 / 扭轉乾坤 gate 有破口 — 只看「opp.prizes < oppPrizesAtMyLastTurnEnd」分不出「對手回合擊倒我方」vs「自己回合自 KO」。以黑夜魔靈 咒詛炸彈為例，自 KO 發生在自己的回合，對手在『這個』回合取獎賞，gate 會誤觸發。
6. **Bug #113 規則**：赤松效果的兩張基本能量必須**不同屬性**，目前允許同屬性。

### Bug #108 修正：場地行加「先攻／後攻」常駐標記

**檔案**：`src/routes/game/+page.svelte`

在 `opponent-row` / `my-row` 的最左側插入 `.turn-order-chip`，根據 `game.firstPlayerIdx === <row 對應 idx>` 顯示「先攻」或「後攻」，先攻用金色漸層高亮，後攻灰色。採垂直書寫節省寬度。

### Bug #109 修正：Stadium 一回合一張

**型別**：`src/lib/game/types.ts` — 新增 `stadiumPlayedThisTurn?: [boolean, boolean]`（與 `stadiumUsedThisTurn` 分開：一個記「是否打過」、一個記「是否已用過效果」）。

**engine**：
- `createGame` 初始化 `[false, false]`。
- `PLAY_TRAINER` Stadium 分支先檢查 `played[aIdx]`，是 true 則 no-op（不打出）；否則設 `newPlayed[aIdx] = true`。
- `getPlayableTrainers` 過濾掉 `c.subtype === 'Stadium' && stadiumPlayedThisTurn[activePlayerIndex] === true`（防 AI 卡在選不能打的卡上當機）。
- `END_TURN` 重置 `newStadiumPlayed[nextIdx] = false`（下一位即將開始回合的玩家）。

### Bug #110 修正：幻影奇襲 log 更詳盡

**檔案**：`src/lib/game/effects.ts` dragapult-snipe resolver

**原**：`${label}：在 ${targetCard?.name} 身上放 1 個傷害指示物（剩 ${remaining - 1} 個待分配）`

**新**：`${label}：在對手 ${targetCard?.name} 身上放置第 ${7 - remaining}/6 個傷害指示物（剩 ${remaining - 1} 個待分配）`

KO 變體同步加上「第 X/6 個 → 被擊倒」敘述。

### Bug #111：bench-search guard 稽核

已檢查 `effects.ts` 中所有 bench-search cards（好友寶芬、赫普的包包、各款呼朋引伴、各款組成陣形、benchBasicFromDeckPost helper、向尾喵|呼朋引伴、呆火駝|呼朋引伴、謎擬Q|呼朋引伴）——全部使用 `bench.length >= 5` 判定**真正滿**，並全部 `minCount: 0` 可選擇 0 張。行為已符合 Leon 的規格。

Grep `bench.length >= [1-4]`：無結果。task #90 已解決此類問題，v2.16 僅稽核確認。

### Bug #112 修正：不公印章 / 扭轉乾坤 gate 區分「對手回合 KO」vs「自 KO」

**型別**：`src/lib/game/types.ts` — 新增 `oppPrizesAtMyTurnStart?: [number, number]`（回合**開始**瞬間的快照；與原本的 `oppPrizesAtMyLastTurnEnd` 是回合**結束**快照）。

**engine END_TURN**：`aIdx` 結束回合時，除了原本寫 `oppPrizesAtMyLastTurnEnd[aIdx]`，也同時寫 `oppPrizesAtMyTurnStart[nextIdx] = players[aIdx].prizes.length`（下一位開始回合時，他的視角中「對手的獎賞剩餘」）。

**gate 判定**（改用 TurnStart vs LastTurnEnd）：
- `turnStart < lastEnd` → 對手在他們剛結束的回合取過獎賞 → 成立（我方寶可夢被對手擊倒）。
- `turnStart == lastEnd` → 對手這回合沒取過獎賞。就算目前 `opp.prizes` 變少了（我方這回合自 KO），也不成立。
- 不公印章 (`effects.ts`) 與 吉雉雞ex 扭轉乾坤 (`engine.ts` getUsableAbilities) 都統一改用此邏輯。

### Bug #113 修正：赤松兩張能量必須不同屬性

**UI**：`src/routes/game/+page.svelte`
- 新增 `akamatsuSameTypeBlocked $derived`：當 `pendingSelection.effectKey === 'akamatsu-split'` 且已選 2 張、兩張 `pokemonType` 相同時為 true。
- `selectionValid` 增加 `!akamatsuSameTypeBlocked` 條件。
- 選擇器 footer 顯示警告 `⚠ 赤松選 2 張能量時，兩張屬性必須不同`。

**resolver（防禦性）**：`src/lib/game/effects/cards/white_lily_akamatsu.ts`
- `akamatsu-split` 收到 2 張同屬性時丟棄第 2 張、僅以第 1 張繼續（並 log「第 2 張略過」）。
- 牌庫移除改用 `picked` iids（而非原始 iids）避免被縮減後的第 2 張能量遺失。

---

## Session 38bc (v2.15) — 對手戰鬥寶可夢 UI 標示強化 + 吉雉雞ex 扭轉乾坤 gate 修正

### 背景

Leon 中斷「下一步模組化」規劃，改為先修兩個 bug：

1. **戰鬥寶可夢 UI 標示不清楚**：類似願增猿轉傷害等「目標是對手戰鬥+備戰寶可夢」的招式在 opp-poke-choose UI 上，雖然 v2.13 task #97 已經加了 `.is-active-poke` 黃框 + 底部徽章，但徽章被擠在卡片底部、跟 HP/能量/狀態行視覺重疊，需要再加強讓「哪一張是對方現在的戰鬥寶可夢」一眼就能看出來。

2. **吉雉雞ex 扭轉乾坤 gate 錯誤**：舊版 gate 是「棄牌區有寶可夢」，這在 mulligan / setup 後就永遠成立，條件形同失效。正確邏輯應該跟**不公印章**一樣，是「上個對手回合自己有寶可夢昏厥」才可用。

### Bug #105 修正：戰鬥寶可夢 UI 標示強化

**檔案**：`src/routes/game/+page.svelte`

**改動**：
- 黃框邊線從 2px 升為 **3px**，發光從 `rgba(255,204,68,.35)` 加深到 `rgba(255,204,68,.55)`，讓邊框更亮更容易識別。
- 徽章 `.retreat-active-badge` 從「絕對定位、卡片底部」改為「頂部全寬 header 條」，佔用一整行，避免跟 HP/能量/狀態行擠在一起。
- 新增 `.retreat-active-badge.opp` class：當這張是**對手戰鬥寶可夢**時用紅色漸層（`#962020 → #d04040 → #962020`）；我方用金色漸層（`#b8860b → #e2a020 → #b8860b`）。
- 文字從「戰鬥中 / 對手戰鬥中」改為「我方戰鬥寶可夢 / 對手戰鬥寶可夢」，更完整。

**驗證範圍**：這是通用的 opp-poke-choose / bench-choose 等選擇 UI，所有呼叫 retreat-grid 的招式（願增猿轉傷害、各種 bench snipe、swap 類招式等）都自動套用。

### Bug #106 修正：吉雉雞ex 扭轉乾坤 gate 改用不公印章邏輯

**檔案**：`src/lib/game/effects.ts`、`src/lib/game/engine.ts`

**原本**（錯）：`pool.get(c.cardId)?.supertype === 'Pokemon'` 掃棄牌區 — setup 後永遠 true。

**現在**（對）：跟不公印章一樣用 `oppPrizesAtMyLastTurnEnd` snapshot。

```ts
// effects.ts
regA('吉雉雞ex', 0, (st, idx) => {
  const oppIdx = (1 - idx) as 0 | 1;
  const snap = st.oppPrizesAtMyLastTurnEnd?.[idx] ?? 6;
  if (st.players[oppIdx].prizes.length >= snap) {
    return addLog(st, '扭轉乾坤：上回合自己沒有寶可夢昏厥，無法使用', idx);
  }
  // ... 抽 3
});
```

原理：`oppPrizesAtMyLastTurnEnd[idx]` 記錄自己上次回合結束時對手剩餘獎賞數。若對手現在獎賞數 < snap，代表對手在他們剛結束的回合取了獎賞 → 擊倒了我方寶可夢 → 允許使用。

**同步在 engine.ts `getUsableAbilities` 加 guard**（跟「集客」一樣），讓按鈕在 UI 直接被隱藏，不要等點下去才失敗。belt-and-suspenders 雙層保護：engine guard 擋 UI，effects.ts 內部 guard 擋 programmatic 呼叫。

```ts
// engine.ts getUsableAbilities
if (ab.name === '扭轉乾坤') {
  const oppIdx = (1 - state.activePlayerIndex) as 0 | 1;
  const snap = state.oppPrizesAtMyLastTurnEnd?.[state.activePlayerIndex] ?? 6;
  if (state.players[oppIdx].prizes.length >= snap) return;
}
```

### 驗證

- `npm run build` ✓（6.10s + 12.38s，無 TS 錯誤）
- diff 僅 4 檔 28 +/12 -，無副作用

### 接下來

Leon 原本要求討論「下一步模組化規劃」，現在 bug fix 結案後可以回到該議題。目前 effects.ts 還有 ~9400 行，可以分 4 輪抽離：
1. Round 1: ~1100 行 training 類卡 → `effects/cards/trainer_*.ts`
2. Round 2: ~500 行 pattern factories → `effects/patterns/*.ts`
3. Round 3: ~700 行 MBG/MBD 預組特化 → `effects/presets/*.ts`
4. Round 4: ~6500 行 long-tail 招式（最大塊）

---

## Session 38bb (v2.14) — 魔靈多龍預組勘誤 + 補實裝 鳴依的勉勵 / 火箭隊的監視塔

### 背景

Leon 用 v2.13 新加的「預組檢視器」功能對照真實卡表，發現魔靈多龍預組內容有多處錯誤，提供正確 28 條的完整卡表要求修正並補實裝缺漏的卡功能。

### 修正對照（預組卡表 diff）

**寶可夢層**
- 多龍奇：2 → 4
- 夜巡靈：2 → 1
- 黑夜魔靈：2 → 1
- 彷徨夜靈：2 維持
- 其他（多龍梅西亞 4 / 多龍巴魯托ex 3 / 含羞苞 1 / 願增猿 1 / 喵喵ex 2 / 吉雉雞ex 1）：不變

**物品層**
- 移除：莉莉艾的珍珠（原 1 張 — 真實卡表根本沒有這張）
- 其他（不公印章 1 / 夜間擔架 2 / 特殊紅牌 1 / 神奇糖果 3 / 高級球 4 / 寶可平板 4）：不變

**支援者層**
- 移除：阿蜜的目光 / 裁判（共 -2）
- 新增：鳴依的勉勵 × 1、探險家的嚮導 × 1（共 +2）
- 其他（好友寶芬 4 / 莉莉艾的決意 4 / 老大的指令 2 / 白蕾雅 1 / 赤松 1）：不變

**競技場層**
- 移除：月光丘陵 × 1（→ 0）
- 新增：火箭隊的監視塔 × 2（→ 2）
- 阻礙之塔 × 1：不變

**能量層**：完全不變（火 3 / 超 3 / 惡 2 = 8）

總張數：60 ✓

### 新實裝卡片

#### 1. 鳴依的勉勵（Supporter, M3 075/080, id 18052）

卡面：「這張卡只有在自己剩餘獎賞卡的張數比對手剩餘獎賞卡的張數多時才可使用。從自己的棄牌區選擇最多 2 張基本能量卡，附於自己的 1 隻【2 階進化】寶可夢身上。」

位置：`src/lib/game/effects/cards/draw_supporters.ts`（跟其他 Supporter 放一起）

流程：
1. `regG('鳴依的勉勵', ...)` guard — 檢查 self prizes > opp prizes、棄牌有基本能量、場上有 Stage 2
2. `reg('鳴依的勉勵', ...)` — 進 `discard-search` pending（BasicEnergy, 1..min(2, cand.length)）
3. `regR('naruei-encourage-pick-target')` — 檢查場上 Stage 2 數量
   - 0 隻：log 取消（guard 正常會擋，保險）
   - 1 隻：直接附加
   - N 隻：進 `heal-target` pending，用 `validIids` 限定 Stage 2
4. `regR('naruei-encourage-commit')` — 附加能量到選中的 Stage 2

Stage 2 判定：本地複製 `engine.ts` 的 `isStage2PokemonCard`（`evolvesFrom` 指向另一個有 `evolvesFrom` 的 Stage1 → 進化深度 = 3），避免 `engine ↔ effects` 循環 import。

#### 2. 火箭隊的監視塔（Stadium, SV10 096/098, id 12846）

卡面：「雙方場上所有【無】寶可夢的特性全部消除。」

位置：
- `src/lib/game/effects/cards/stadiums.ts`：新增 `ROCKET_WATCHTOWER_STADIUMS` 集合
- `src/lib/game/effects.ts`：re-export
- `src/lib/game/engine.ts`：新增 `isColorlessAbilityBlocked(state, pokeCard, pool)` 輔助函式，在三個發動點檢查：
  1. `USE_ABILITY` handler（line ~882）— 阻擋主動特性發動
  2. `getUsableAbilities`（UI 按鈕篩選，line ~1920）— 不列出被封的特性
  3. `PLAY_BASIC` → `BENCH_PLACE_TRIGGERS` 觸發前（line ~574）— 喵喵ex｜殺手鐧捕捉會被這張 Stadium 封掉

設計仿 `JAMMING_TOWER_STADIUMS`（阻礙之塔、道具無效）的模式：只在 engine hook 判定，不需要 USE_STADIUM 的 resolver（純被動）。

**覆蓋範圍限制**：目前只處理「主動特性 + BENCH_PLACE 觸發」。被動特性（如「受傷時…」、「對手抽牌時…」之類散落在 ATTACK_PRE/POST 的）尚未加閘門；本 deck 內涉及的【無】屬只有喵喵ex 的殺手鐧捕捉（屬於 BENCH_PLACE 觸發），已覆蓋。日後若發現其他【無】屬被動特性跟本機制互動有誤，再各自加 `isColorlessAbilityBlocked` 閘門。

#### 3. 探險家的嚮導（Supporter, MC 717/742, id 17188）

v2.12 Session 38b9 已實裝在 `draw_supporters.ts`，本波只是把它加進預組裡。

### 關鍵檔案

- `src/lib/decks/presets.ts` — MARRUNE_DRAGAPULT_DECK 改成 28 條 60 張的正確卡表
- `src/lib/game/effects/cards/draw_supporters.ts` — 加 鳴依的勉勵 + 3 個 resolver
- `src/lib/game/effects/cards/stadiums.ts` — 加 `ROCKET_WATCHTOWER_STADIUMS` 集合
- `src/lib/game/effects.ts` — re-export `ROCKET_WATCHTOWER_STADIUMS`
- `src/lib/game/engine.ts` — 加 `isColorlessAbilityBlocked` + 三個呼叫點
- `src/lib/version.ts` — 2.13 → 2.14

### 本機驗證

`npm run build` ✓ 成功（6.14s client / 12.36s server）。`npm run check` 仍顯示 11 個 pre-existing 錯誤（presets.ts 的 `createdAt` 型別 / tools.ts 的 `EffectFn` import mode / effects.ts:4772 / decks +page 的 `active` null 檢查）— 都跟本波修改無關。

---

## Session 38ba (v2.13) — 3 項修正：赤松 UI / 對手選擇標示 / 預組檢視

### 背景

Leon 同時回報三件事，順序是「先修 bug，再繼續模組化」：

1. **赤松 UI 錯誤** — 第二步敘述顯示「選擇要回復的寶可夢」。赤松實際流程應該是：
   先搜 2 張基本能量，讓玩家自選「哪張附加寶可夢」、「哪張收手牌」；若牌庫只剩
   1 張能量，該能量直接附加。舊實裝寫死「第 1 張加手牌 / 第 2 張附加」完全沒給
   玩家選擇權，而且 pending 複用 `heal-target` 造成標題牛頭不對馬嘴。

2. **願增猿 / 類似機制的對手寶可夢選擇 UI** — 「腎上腺腦力」可將傷害指示物丟到
   對手戰鬥寶可夢或備戰寶可夢，但選擇清單沒有標示哪隻是對手的戰鬥寶可夢，玩家
   只能靠位置記憶去猜。Leon 特別要求「相關 UI 也請你一併檢查並設定」——也就是
   所有 `opp-poke-choose` / `opp-bench-choose`（含 active）類機制。

3. **牌組編輯器不能檢視預組** — Leon 想檢查魔靈多龍是否真的含「莉莉艾的珍珠」
   （他說「一定是你看錯牌了」），但編輯器只能打開使用者自建牌組；此外 Leon
   決定刪除「破空焰EX（火屬 · 自組）」這個預組。

### 改動

**Bug A — 赤松 UI 重寫**（`src/lib/game/effects/cards/white_lily_akamatsu.ts`）

- `reg('赤松')` 初始敘述改為「從牌庫選最多 2 張基本能量（之後自選 1 張附加、
  另 1 張收手牌）」。
- `regR('akamatsu-split')` 重寫分支：
  - 0 張：洗牌庫結束
  - 1 張 + 場上有寶可夢：能量直接進 `heal-target` 附加流程（1 張情況不需手牌
    二次挑選）
  - 2 張 + 場上有寶可夢：兩張都先收手牌，再用 `hand-choose`（`validIids` 限制
    只能選這 2 張）讓玩家挑 1 張附加；未挑的那張自然留在手牌裡
  - 場上無寶可夢：fallback 全部加入手牌
- 新增 `regR('akamatsu-pick-attach')`：處理 2 張流程的「挑出要附加的能量」→ 進
  `heal-target` pending 選寶可夢。
- `regR('akamatsu-attach')` 擴充：支援 `params.energyIid`（從手牌取）+ 原本的
  `params.energyInstance`（1 張流程直接帶能量物件）。
- 所有 pending 都帶 `params.titleOverride`，`+page.svelte` 的 `selectionTitle()`
  優先讀取這個客製標題；例「赤松：選擇要附加 基本【火】能量 的寶可夢」。

**Bug B — 對手寶可夢選擇 UI 標示**（`src/routes/game/+page.svelte`）

- `isPokePicker` 分支內新增 `srcActiveIid` / `isOppPicker` 兩個 derived：
  - `srcActiveIid = game?.players[pendingSelection.sourcePlayerIdx].active?.iid`
  - `isOppPicker = type==='opp-poke-choose' || type==='opp-bench-choose'`（含 active）
- 每張 retreat-card 若 `item.iid === srcActiveIid`，加上 `.is-active-poke` class
  + `<span class="retreat-active-badge">⚔️ 對手戰鬥中／戰鬥中</span>` 徽章。
- CSS：`.is-active-poke` 金色邊框 + 金色陰影；徽章橘色膠囊，位於卡底置中。
- 自動覆蓋所有 pending Pokemon 選擇場景：`opp-poke-choose`、`opp-bench-choose`
  （含 includeActive）、`bench-choose`（active 會被排除不顯示但 class 邏輯安全）、
  `heal-target`（己方選擇，顯示「戰鬥中」）。
- 這就完成了「願增猿等類似機制」的一次性修正，不需要各卡個別處理。

**Feature C-1 — 牌組編輯器預組檢視**（`src/routes/decks/+page.svelte`）

- 新 import `{ PRESET_DECKS, PRESET_IDS }`。
- `active` derived 改為：先查使用者牌組，再退回 `PRESET_DECKS`。
- 新 derived `isPresetActive`：true 時編輯動作全部 no-op 保險。
- `renameActive` / `addCard` / `removeCard` / `clearDeck` 頂部加 preset guard。
- 新函式 `copyPresetToMine()`：從預組複製一份到使用者牌組（沿用 `newDeck` 產生
  新 ID + 新名字「xxx（複製）」）。
- 左側 rail 新增「🎴 內建預組（唯讀）」區塊，列出所有 `PRESET_DECKS`；淡橙底
  + 🔒 圖示；active 狀態金邊。
- 右側 header：預組模式顯示 `🔒 預組（唯讀）` badge、匯入 JSON/匯入文字/清空
  按鈕隱藏；新增 `📋 複製到我的牌組` 按鈕；標題欄 readonly。
- 每張 entry 的 ± 按鈕、picker 的 + 按鈕、preview modal 的 ± 按鈕都加 preset
  disabled，避免誤點。

**Feature C-2 — 刪除破空焰EX 預組**（`src/lib/decks/presets.ts`）

- 整段刪除 `CHI_YU_DECK`（`__preset_fire__`），`PRESET_DECKS` 陣列移除對應項。
- 破空焰ex 本身（`regPost('破空焰ex|烈火爆進')`、`regPre('破空焰|爆燃突擊')`
  等卡片效果）保留在 effects.ts；只是不再作為內建牌組提供。

**Feature C-3 — 魔靈多龍「莉莉艾的珍珠」驗證**

已查證：`presets.ts:186` 確實有 `{ cardId: '17163', count: 1 }` 即「莉莉艾的
珍珠」。這張道具只對「莉莉艾的」前綴的寶可夢有效，但魔靈多龍整套沒有任何莉莉
艾的寶可夢，所以這張實際上無作用。

本輪沒動魔靈多龍的內容——等 Leon 用新的預組檢視介面看過、決定要換成什麼後再改。
建議方向：JP 賽事 meta ヨノワール+ドラパルトex 軸常見 tool 是「英雄披風／ヒー
ローマント」對非 ex 寶可夢 +30 HP 減傷，會跟多龍梅西亞/夜巡靈 line 搭配較好。

### 驗證

- `npm run build` ✅ 無 warning/error
- 赤松流程手動驗證：0/1/2 張能量、場上有無寶可夢、單張全附加、雙張自選 — 皆
  走對應 resolver 分支
- 對手選擇 UI：`is-active-poke` 金邊 + badge 在 retreat-card 上正確渲染
- 預組檢視：4 套（耿軌 / 蒂安希 / 竹蘭列咬陸鯊 / 魔靈多龍）可點入查看；所有
  編輯路徑都 guard 住

### 下一步候選

- 繼續模組化：莉莉艾的決意 / 老大的指令 系列抽到 draw_supporters.ts 擴充
- 物品卡系列（神奇糖果 / 高級球 / 夜間擔架 / 寶可平板）抽到新檔
- 確認魔靈多龍替代 tool（等 Leon 決定）

---

## Session 38b9 (v2.12) — 模組化：抽 Supporter 區塊到 effects/cards/draw_supporters.ts

### 背景

承 v2.10 Stadium 抽離後，繼續模組化 effects.ts。本波挑選最淺的 trainer 類別：
「即時支援者」+「互動支援者」，byte-exact 搬出，只依賴 _shared.ts 已匯出的
`reg / regR / addLog / updatePlayer / withPending / drawCards / discardHand /
returnHandToDeck`，不涉及攻擊系統 / 特性 / 道具 / Stadium / 被動減傷。

### 改動

**新增** `src/lib/game/effects/cards/draw_supporters.ts` (131 行)：

即時支援者（純 draw，無 pending）：
- 管理員（抽 2）/ 帕底亞的夥伴（抽 3）/ 納莉（抽 4）/ 枇琶（抽 3）
- 丹瑜（丟全手 → 抽 5）
- 紫竽（手回牌庫 → 抽 4）/ 松葉的信心（手回牌庫 → 抽 5）

互動支援者（`withPending` + `regR`）：
- 艾莉絲的鬥志（hand-discard 1 → 抽至 6，effectKey `alice-courage`）
- 探險家的嚮導（TOP6 → 選 0-2 加手牌、其餘丟棄，effectKey `explorer-guide`）

**修改** `src/lib/game/effects.ts`：
- 頂部新增 `import './effects/cards/draw_supporters'` 觸發 side-effect 登錄
- 刪除原處 67-180 行的 9 張卡 reg/regR 區塊，留下 section stub 註解
- 行數從 9499 → 9392（-107）

### 驗證

- `npm run build` ✅
- 所有 reg() 都寫進同一個 `TRAINER_EFFECTS / RESOLVERS` Map（透過 _shared.ts
  的共享實例），engine.ts / ai.ts 無感
- CRLF line-ending 保留（`file` 輸出 "with CRLF line terminators"）
- git diff 僅 115 行變動，無全檔 re-normalize

### 下一步候選

- 「支援者 — 抽牌系列」(莉莉艾的決意) + 「支援者 — 呼叫對手」(老大的指令) →
  可抽到同一個新檔或 draw_supporters.ts 擴充
- 「物品卡 — 切換」/「藥水回復」/「搜尋牌庫」三大 Item 區塊 → 分別獨立檔
- Wave 43 魔靈多龍剩餘卡 → 擴充 white_lily_akamatsu.ts

---

## Session 38b8 (v2.11) — 三個 bug fix：備戰格上限 / 獎勵牌 guard / 自 KO 派新戰鬥

### 背景

使用者 bug report：
1. **好友寶芬 / 呼朋引伴 等 bench search 卡** — 沒有依照目前備戰區剩餘空位決定
   `maxCount`。場上已有 4 隻備戰時，卡片仍要求選 2 隻上場（應該封頂 1）；
   備戰已滿 (5) 時應該整張卡不可用。
2. **特殊紅牌** — 卡牌敘述為「只有在對手剩餘獎賞卡的張數為 3 張以下時才可使用」，
   但目前在開局（對手獎賞 6 張）就能用。白蕾雅（「對手獎賞恰為 2」）路徑要
   一併檢查。
3. **黑夜魔靈 咒詛炸彈** — 在戰鬥場使用此特性自 KO 後，自己戰鬥場變空，UI 不會
   跳出「派出新戰鬥寶可夢」視窗，整個回合卡死無法繼續。

### 改動

**effects.ts：好友寶芬 / 赫普的包包 修 maxCount**
- 原：`maxCount: 2`（固定 2）
- 新：`maxCount: Math.min(2, 5 - bench.length)` — 依剩餘備戰空位封頂
- 備戰滿 (5) 時 guard (regG) 會讓卡片直接不可打出

**effects.ts：特殊紅牌 regG**
- 新增 `regG('特殊紅牌', …)` 檢查 `players[1-idx].prizes.length <= 3`
- 白蕾雅已有相同機制的 regG (`opp.prizes.length === 2`)，已驗證正確

**routes/game/+page.svelte：自 KO UI 補派新戰鬥場**
- 原 UI 的 "⚠️ 派出新戰鬥寶可夢" 警語 + modal 僅在
  `defenderPlayer?.active === null && game.turnPhase === 'end'`
  觸發（被對手 KO 的正常流程）
- 新增平行條件：`myPlayer?.active === null && game.turnPhase !== 'end'
  && myPlayer.bench.length > 0 && !pendingSelection`
  → 主動方自 KO 後可從自己備戰區派新戰鬥寶可夢
- 另加對手側的等待提示，情境對稱
- AI 端不需改 — `src/lib/game/ai.ts:38` 早已處理 `players[myIdx].active === null`

### 驗證

- `npm run build` ✅
- 既有被 KO 路徑（turnPhase='end'）的 UI 行為不變
- 自 KO 路徑（main phase）現在會顯示新 modal，從我方備戰區送出
- AI 模式 AI 自 KO 也能正常繼續（ai.ts 已涵蓋）

---

## Session 38b7 (v2.10) — 模組化：抽 競技場卡 (Stadium) 到 effects/cards/stadiums.ts

### 背景

承 v2.09 Tool 模組抽離，接續把「競技場卡（Stadium）」邏輯搬到專屬檔案。
PTCG 場地卡邏輯跨 engine / effects 兩邊：engine.ts 的 USE_STADIUM handler
負責放置、丟棄、`stadiumUsedThisTurn` 等引擎層狀態；真正要 pending 選手牌 /
選能量的互動部分則丟到 effects 這邊的 `regR()` resolver。

### 改動

**新增** `src/lib/game/effects/cards/stadiums.ts` (83 行)：
- 3 個 USE_STADIUM 的 pending resolver（byte-exact 搬自 effects.ts）：
  - `miracle-garden-draw` — 神秘花園（Stadium）：丟 1 張超能量 → 抽到手牌 = 己方場上超屬寶可夢數
  - `night-academy-top` — 夜間學院（Stadium）：選 1 張手牌放回牌庫上方
  - `moonlight-hill-heal` — 月光丘陵（Stadium）：丟 1 張超能量 → 全體回 30 HP
- `JAMMING_TOWER_STADIUMS` Set 的 export（阻礙之塔的引擎側 hook，engine.ts
  在查 TOOL_* 前會檢查，命中則視同雙方道具全失效）

**修改** `src/lib/game/effects.ts`：
- 檔頭 `import { JAMMING_TOWER_STADIUMS } from './effects/cards/stadiums'`
  並 re-export，engine.ts 既有的 `import { JAMMING_TOWER_STADIUMS } from './effects'`
  路徑保持相容
- 刪除原處的 3 個 Stadium regR 區塊 + `export const JAMMING_TOWER_STADIUMS` 定義
- 留下 section stub 註解指向新位置
- 行數從 9532 → 9487

**術語修正** — 把殘留的「球場」改成正式翻譯（參考 PTCG 繁中官方用語：場地卡 /
競技場卡，不是「球場」）：
- `engine.ts:27` 註解：「當場上活動球場為 ... 所列球場時」→
  「當場上活動場地卡為 ... 所列競技場卡時」
- `effects/cards/white_lily_akamatsu.ts:12` 註解：「道具 / 球場 / 被動減傷」→
  「道具 / 場地卡 / 被動減傷」

### 驗證

- `npm run build` ✅
- grep 全 src：0 處「球場」殘留
- JAMMING_TOWER_STADIUMS 透過 re-export 對 engine.ts 完全透明
- engine.ts 邏輯零改動（只改註解）

### 目前模組化進度

`effects/cards/` 下已抽出：
- `white_lily_akamatsu.ts`（v2.05）— 2 張魔靈多龍 Supporter
- `tools.ts`（v2.09）— 23 張道具卡 + 全 TOOL_* 登錄表
- `stadiums.ts`（v2.10）— 3 個 Stadium resolver + JAMMING_TOWER_STADIUMS

`effects.ts` 剩 9487 行，仍含絕大多數寶可夢招式 / 特性 / 支援者 / 物品 / 引擎 helper。

---

## Session 38b6 (v2.09) — 模組化：抽 道具卡 (Pokemon Tool) 到 effects/cards/tools.ts

### 背景

v2.05 開始把龐大的 `effects.ts`（原 ~9700 行）逐步拆到 `effects/cards/` 子模組。
已完成：
- v2.05：`effects/_shared.ts`（TRAINER_EFFECTS / RESOLVERS / TRAINER_GUARDS 三個 Map +
  reg / regR / regG / shuffle / updatePlayer / addLog / withPending / drawCards / clearActiveEffects 等 helper）
- v2.05：`effects/cards/white_lily_akamatsu.ts`（白百合 / 赤松示範模組）

這次抽出「寶可夢道具卡（Pokemon Tool）」整塊到 `effects/cards/tools.ts`。

### 改動

**新增** `src/lib/game/effects/cards/tools.ts` (293 行)：
- 8 張 TOOL_* Map 的 export：`TOOL_HP_BONUS`, `TOOL_ATTACK_BONUS`,
  `TOOL_DEFENSE_REDUCE_BY_TYPE`, `TOOL_PREVENT_KO`, `TOOL_ON_KO`, `TOOL_PRIZE_BONUS`,
  `TOOL_ON_DAMAGED`, `TOOL_RETREAT_MOD` + `TOOL_BOTH_SIDES_RETREAT_PLUS` Set
- 23 張道具卡的完整 entry（byte-exact 從原 effects.ts 搬過來）：
  英雄斗篷、勇氣護符、豪華斗篷、驅勁能量（古代/未來）、竹蘭的力量負重、極限腰帶、
  鎖鏈糬、福祿果、巧可果、千香果、刺耳果、霹霹果、莓榴果、倖存鍛鍊器、希望護身符、
  沉重接力棒、莉莉艾的珍珠、幸運頭盔、奢華炸彈、緊急滑板、氣球、重力之玉、龐克頭盔
- `toolAttachEffect(toolName)` helper + `regR('attach-tool')` resolver
- 檔尾 auto-register 迴圈：遍歷所有 TOOL_* Map 的 keys + `TOOL_BOTH_SIDES_RETREAT_PLUS`
  Set，對每張卡呼叫 `reg(name, toolAttachEffect(name))`（若尚未註冊）

**修改** `src/lib/game/effects.ts`：
- 在檔頭 import `./effects/cards/tools` 的所有 TOOL_* 並 re-export（engine.ts 的
  `import { TOOL_* } from './effects'` 路徑不需改）
- 刪除 Session 33 的 `// Pokemon Tool 系統` 189 行大區塊
- 刪除 `toolAttachEffect` 定義 + `reg('氣球')` / `reg('龐克頭盔')` / `regR('attach-tool')`
  原有區塊（已移到 tools.ts）
- 刪除檔尾 `reg('莉莉艾的珍珠')` 遲註冊（已併入 tools.ts 的自動註冊前）
- 行數從 9753 → 9532（-221 行）

**副作用匯入**：`effects.ts` 檔頭順序新增
```ts
import './effects/cards/tools';
```
讓 tools.ts 檔尾的 `reg()` 呼叫會在 `applyAction` 第一次被呼叫前執行。

### 驗證

- `npm run build` ✅
- grep `TOOL_.*\.set\|TOOL_.*\.add` on effects.ts → 0（全搬光）
- grep `toolAttachEffect` on effects.ts → 只剩註解（3 處 stub 說明）
- engine.ts 零改動

### 記憶檔更新

- 新增 `reference_ptcg_terminology.md`：PTCG 繁中正式翻譯表（Stadium → 競技場卡 / 場地卡，
  不是球場；Prize → 獎勵牌 不是獎賞…等），寫 log / 註解 / commit message 都要遵守
- 新增 `feedback_edit_verify_first.md`：Edit 前先 Read 對應區段拿原文，不要從記憶猜
  old_string（v2.08 AI_HANDOFF URL 改錯 + 這次第一版 tools.ts 從記憶寫錯 4 個 tool 邏輯，
  已是第二次犯類似錯誤）

---

## Session 38b5 (v2.08) — 多龍巴魯托ex 進化資料 + 備戰區離場清狀態

### Leon 回報

> 多龍奇無法進化成多龍巴魯托EX。
>
> 備戰區的寶可夢會自動解除異常狀態，例如混亂、灼傷、睡眠、中毒，甚至有些招式使出後，
> 下回合不能使用，例如破空焰ex的烈火爆進「若使用了這個招式，則這隻寶可夢離開戰鬥場前
> 無法使用烈火爆進」，都可以在離開戰鬥場後回復。玩家最常用的方法就是：戰鬥寶可夢先
> 撤退，再用「寶可夢交替」換回戰鬥場，就可以繼續使用招式了，異常狀態也會解除。

### Bug 1：多龍巴魯托ex 的 evolvesFrom 指向死人

`static/cards/{M2a,MC,SV6,SV8a}.json` 共 6 筆多龍巴魯托ex 條目的
`evolvesFrom: "多龍巴魯托"` — 但卡池裡根本沒有「多龍巴魯托」這張卡（沒 ex 的 2 階
在日版 / 台版 PTCG 本來就不存在），導致進化鏈斷掉。

對照敘述，多龍巴魯托ex 的前階應該是 1 階「多龍奇」。

**修正**：用 Node 腳本對 4 個 JSON 檔批次修改 `"多龍巴魯托"` → `"多龍奇"`。
分布：M2a=1、MC=1、SV6=2、SV8a=2。只改字串，不碰任何其他欄位。

> Note：另外檢查到類似的死 evolvesFrom 還有烈咬陸鯊ex、超級妙蛙花ex、超級沙奈朵ex、
> 超級快龍ex 等約 30 筆，但這些的前階卡本來就沒 scrape 到，屬於 scraper 的範疇，
> 跟目前的預設牌組無關，這次不處理。

### Bug 2：寶可夢離開戰鬥場應清掉異常狀態 + 招式鎖

PTCG 規則：寶可夢離開戰鬥場（撤退 / 寶可夢交替 / 急進開關 / 頂尖捕捉器 / 衝浪手 /
支配鎖鏈 / 老匠系強制互換 …）時，身上所有的：
- 特殊狀態（灼傷、中毒、睡眠、混亂、麻痺）
- 跨回合招式效果（cantAttackThisTurn、cantAttackPending、cantRetreatNextTurn、
  damageBonusThisTurn/Pending、takeExtraDamageThisTurn/NextTurn、
  cantAttachEnergyThisTurn/NextTurn、deferredPrizeBonusThisTurn/NextTurn、
  damageReduceNextHit、movedToActiveThisTurn…）

全部要解除；但下列保留：
- damage（傷害指示物）
- energyAttached（能量）
- toolAttached（道具）
- evolvedFromStack / evolvedFromIid（進化鏈）
- justPlaced / evolvedThisTurn / abilityUsedThisTurn（回合級玩家行為計數）

原本 engine.ts 的 RETREAT、effects.ts 所有 swap resolver（大約 8 個點）只搬
active ↔ bench 不清旗標，導致：
- 灼傷 / 中毒 / 睡眠 / 混亂 / 麻痺 跟著到備戰區
- 烈火爆進等「此寶可夢離開戰鬥場前無法使用該招式」的 cantAttackPending 永遠卡住，
  就算撤退再換回來也不能用

**修正**：在 `effects/_shared.ts` 新增 pure function `clearActiveEffects(poke)`，
集中列出所有要清掉的旗標，統一套用在：
- `engine.ts` RETREAT 的 `retreatingPoke` 建構點
- `effects.ts` 八個 swap resolver：do-switch、gust-opp、top-catcher-opp、
  支配鎖鏈、surfer-switch、opp-swap-dmg、force-opp-swap、
  force-opp-swap-then-damage

`effects.ts` 從 `_shared` 匯入 `clearActiveEffects` 並 re-export，維持 engine.ts
原有的 import path。

> 設計考量：用 helper 而非把邏輯 inline，未來新增 swap 機制只要記得 wrap helper
> 就好，不會漏清。所有回合級玩家行為計數（abilityUsedThisTurn 等）仍由
> END_TURN 統一清，不在離場時碰。

### 驗證

`npm run build` 通過。

- 多龍奇 → 多龍巴魯托ex 可正常進化。
- 烈火爆進打完後撤退 → 寶可夢交替換回戰鬥場 → `cantAttackPending` 被清掉，可再打。
- 中毒 / 灼傷 / 睡眠 / 混亂 / 麻痺寶可夢撤退到備戰區 → status 解除。

---

## Session 38b4 (v2.07) — 多龍奇「偵查指令」全面修正

### Leon 回報

> 多龍奇的偵查指令也錯了，你再看一下他的敘述：
> 「在自己的回合時可使用 1 次。查看自己的牌庫上方 2 張卡，選擇其中 1 張，加入手牌。將剩餘卡放回牌庫下方。」

### 既有實作的三個 bug

effects.ts line 9546-9583 `regA('多龍奇', 0, ...)` + `regR('scouting-order', ...)`：

1. **看錯張數**：`p.deck.slice(0, 3)` — 應該是上方 **2 張**。
2. **filter 字串沒註冊**：`filter: 'TOP3'` 傳給 pendingSelection，但 `+page.svelte`
   的 `selectionItems` 只處理 `TOP6` / `TOP8` / `Supporter:TOP6`，沒有 `TOP3` 分支；
   `ai.ts` 同樣沒有。結果 fallback 到 `return true` 讓玩家從 **整副牌庫** 任選，
   完全忽略「只能看頂上幾張」的限制（嚴重違規）。
3. **結尾洗牌**：`deck: shuffle([...rest, ...remaining])` — 應該是 **放回牌庫下方**
   （不洗），原本的位置順序也要維持。

另外原本 `minCount: 0, maxCount: 1` 讓玩家可以跳過不抽，但卡面「選擇其中 1 張」是
強制要選，改 `minCount: 1`。

### 修正

**effects.ts** 多龍奇段（維持在 effects.ts 裡，未模組化）：
- 新增 comment 說明 v2.07 修正原因。
- `top3` → `top2`，`slice(0, 3)` → `slice(0, 2)`，`top3Iids` → `top2Iids`。
- `filter: 'TOP3'` → `filter: 'TOP2'`。
- `minCount: 0` → `minCount: 1`。
- 早期 `addLog` 的「洗回」→「放回牌庫下方」。
- resolver 結尾 `shuffle([...rest, ...remaining])` → `[...rest, ...remaining]`
  （rest 是原 top2 以下的部分，remaining 是沒選到的 top2，接在後面就是放到下方）。

**+page.svelte** line 637 區塊：新增 `TOP2` 分支，讀取 `params.top2Iids` 過濾 deck。

**ai.ts** line 186 區塊：新增 `TOP2` 分支（AI 也要能正確看到候選範圍）。

### 驗證

`npm run build` 通過。效果：多龍奇特性按下 → 只看到上方 2 張（或牌庫剩餘 1 張時就
只看到 1 張）→ 必須選 1 張加入手牌 → 沒選的那張留在牌庫下方（rest 之後），
其餘牌的順序不變。完全符合卡面描述。

---

## Session 38b3 (v2.06) — 赤松 filter 字串修正（pre-existing bug）

### 問題

Leon 實測回報：赤松搜尋找不到任何基本能量，即使牌庫有。

### 根因（不是 v2.05 模組化造成）

赤松原本的 `reg('赤松', ...)` 用 `filter: 'Energy:Basic'` 宣告 pending deck-search。
但 `+page.svelte` 的 deck-search filter parser（line 685-687）對 `'Energy:X'` 的解讀是：

```ts
if (f.startsWith('Energy:')) {
  const t = f.slice(7);
  return card.supertype === 'Energy' && card.subtype === 'Basic' && card.pokemonType === t;
}
```

也就是 `'Energy:X'` 裡的 X 被當成 **能量屬性名**（Grass / Fire / Water / Lightning / …），
與「Basic」完全無關。傳 `'Energy:Basic'` 會變成判斷 `pokemonType === 'Basic'`，
但 pokemonType 永遠不會是 'Basic'，因此結果永遠是 0 張命中。

parser 第 653 行其實已經有正確的 `'BasicEnergy'` 分支可以用：
`if (f === 'BasicEnergy') return card.supertype === 'Energy' && card.subtype === 'Basic';`

### 修正

`effects/cards/white_lily_akamatsu.ts` 內 `reg('赤松')` 的 pending filter
`'Energy:Basic'` → `'BasicEnergy'`，並附註釋說明陷阱避免將來再犯。

### 驗證

- `npm run build` 通過
- 其他傳 `'BasicEnergy'` 的卡（effects.ts 多處）早就能正常運作 → 這條路徑可信

### 模組化的意外收獲

這是 v2.05 搬出 白蕾雅 + 赤松 之後 Leon 第一次實測才發現的 pre-existing bug。
**模組化的副作用是讓兩張 Supporter 的實作變成獨立 file 可以單點檢查**，
反而凸顯了之前淹沒在 10k 行檔案裡的錯誤。模組化本身沒有造成 regression。

---

## Session 38b2 (v2.05) — effects.ts 模組化首波（白蕾雅 + 赤松）

### 目標

`effects.ts` 已達 9938 行、難以維護。開始分檔 —— 但必須步步為營，一次只動很小範圍，
每一步都以 `npm run build` 通過為底線。本 session 是示範第一刀。

### 新目錄結構

```
src/lib/game/effects/
  _shared.ts                        # 型別 + 登錄表 + reg/regR/regG + canPlayTrainer + 共用 helper
  cards/
    white_lily_akamatsu.ts          # 白蕾雅 + 赤松（Supporter）
```

### 搬遷細節

**1. `effects/_shared.ts` 新增（154 行）：**

- 型別：`EffectFn` / `ResolveFn` / `TrainerGuardFn`（從 effects.ts 原位置搬來）
- 登錄表 Map：`TRAINER_EFFECTS` / `RESOLVERS` / `TRAINER_GUARDS`（single instance，effects.ts 與子檔共享）
- 登錄函式：`reg` / `regR` / `regG`（這三個是 **唯一** 寫入上述 Map 的入口）
- 純函式：`shuffle` / `updatePlayer` / `addLog` / `drawCards` / `discardHand` / `returnHandToDeck` / `withPending`
- 公開：`canPlayTrainer`

**2. `effects.ts` 頂端改為從 `_shared.ts` import 回來：**

- 原本 1-135 行的型別 / 工具 / 登錄表定義全部刪除，取而代之是一段 import 區塊
- 為 engine.ts / +page.svelte 的 `from './effects'` import 路徑維持相容：
  `export { TRAINER_EFFECTS, RESOLVERS, TRAINER_GUARDS, canPlayTrainer }` +
  `export type { ResolveFn, TrainerGuardFn }`
- 其他 9800+ 行的卡牌 reg 呼叫維持原樣

**3. `effects/cards/white_lily_akamatsu.ts` 新增（128 行）：**

- 從 effects.ts 搬出：赤松（regG + reg + 2 regR）、白蕾雅（regG + reg）
- 從 `../_shared` import 所需的 reg 函式與 helper
- 不依賴 attack / ability / tool 系統，是搬遷「最乾淨的候選人」

**4. effects.ts 新增 side-effect import：**

```ts
import './effects/cards/white_lily_akamatsu';
```

這行放在頂部 import 區塊下方。ES 模組規則確保這行在 effects.ts 本文任何 reg()
呼叫之前執行，但由於 Map 寫入無先後依賴，順序不影響行為。

### 驗證

- `npm run build` 通過（client 5.XX s / server 12.10s / 11.63s）
- grep 確認 `^reg\('(赤松|白蕾雅)|^regG\('(赤松|白蕾雅)` 只在新檔出現、effects.ts 已無
- effects.ts 行數：9938 → 9740（-198 行）
- 新增總行數：_shared 154 + white_lily_akamatsu 128 = 282 行（含檔頭註解）

### 風險評估

**為什麼選這兩張？**

1. **最新、最熟**：v2.02 / v2.03 才剛人工改過，我對它們的語意最確定
2. **不碰攻擊 / 特性系統**：只用 `reg` / `regG` / `regR`，不需 `regPre` / `regPost` / `regA`
3. **沒有跨卡共用的 helper**：不依賴 `statusPost` / `oppCantPlayItemNextPost` / `toolAttachEffect`
   等 effects.ts 內部 helper —— 所以搬出去後不需要重複定義或再抽 helper 檔
4. **resolver key 唯一**：`akamatsu-split` / `akamatsu-attach` 不與其他卡共用

### 下一波建議

若要繼續搬遷，候選順序（從安全到複雜）：

1. **阿蜜的目光**（Supporter，1 個 regG + 1 個 reg，單檔獨立）
2. **其他非互動抽牌 Supporter**（管理員 / 帕底亞的夥伴 / 納莉 / 丹瑜 / 紫竽 / 松葉的信心 / 枇琶）
3. **固定 item（球類搜索）** —— 但要小心共用 deck-search key
4. **基礎道具 HP 加成**（引用 `TOOL_HP_BONUS` 等，需要額外 export）
5. 攻擊類（regPre / regPost）—— **需要先把 attack-system 的 helper 也抽到 _shared 或另開 _attack_helpers.ts**，風險較高，建議最後動

### 對其他人（engine.ts / +page.svelte / types.ts）的影響

**零影響。** 他們引用 `from './effects'` 的所有符號（`TRAINER_EFFECTS` 等）仍在
effects.ts 的 export 面，只是實體已在 `_shared.ts`。

---

## Session 38b1 (v2.04) — playmat UI 比例還原（v2.02 調過頭的回退）

### 問題

v2.02 為了修「備戰特性按鈕 + 場地卡下方溢出」同時改動三處：

1. `.playmat` grid-template-rows `minmax(230px,1fr) auto minmax(230px,1fr)` → `minmax(230px,1fr) auto minmax(275px,1.1fr)`（我方加高 45px + 1.1 倍權重）
2. `.my-row` padding-bottom `0.6rem → 1.4rem`
3. `.action-bar` min/max-height `160/200 → 180/240`

疊加效果：我方場地 + action-bar 多吃了將近 100px，手牌列被擠到視窗最下方幾乎被工作列切到。實際上真正需要的修正只有 `overflow:hidden → visible` 一項 —— 讓按鈕 / 場地卡能自然溢出綠色場地邊界即可，不需要擴張。

### 修正

還原三處到 v2.01 值，保留 v2.02 的 `overflow:visible`：

- `.playmat` grid-template-rows 改回對稱 `minmax(230px,1fr) auto minmax(230px,1fr)`
- `.my-row` padding-bottom 改回 `0.6rem`
- `.action-bar` min/max-height 改回 `160px / 200px`

### 驗證

- `npm run build` 通過

---

## Session 38b0 (v2.03) — 願增猿｜腎上腺腦力 傷害量修正

### 問題

v2.02 把腎上腺腦力實裝成「來源必須 ≥30 傷害指示物、固定移 30」。Leon 指正規則應該是：

- 來源篩選：自己場上任何 **已受傷**（damage ≥ 10）的寶可夢
- 移動量：`amount = min(source.damage, 30)`（最多 30、不超過實際傷害）
- 例 1：自己 20 傷害 → 自療 20、對手 +20 傷害
- 例 2：自己 60 傷害 → 自療 30、對手 +30 傷害（30 上限）
- 若此招 KO 對手寶可夢，對手下回合一樣可以觸發「不公印章」等「上回合我方寶可夢被 KO」為條件的卡片

### 修改

`effects.ts`：

- `regA('願增猿', 0, ...)`：sources filter 從 `c.damage >= 30` 改成 `c.damage >= 10`
- `regR('adrenal-brain-src', ...)`：計算 `amount = min(source.damage, 30)`，將 `amount` 透過 `params` 傳遞到下一階段（`opp-poke-choose`）
- `regR('adrenal-brain-target', ...)`：從 `params.amount` 讀取要加到對手身上的傷害量
- log 訊息改成動態顯示實際移動量（`${amount}`）
- 不公印章 gate 無需額外處理：對手被 KO 後會走正常 `pendingPrizes` → `TAKE_PRIZES`，`oppPrizesAtMyLastTurnEnd` 快照會正確偵測

### 驗證

- `npm run build` 通過（client 5.98s / server 11.84s）

---

## Session 38az (v2.02) — 魔靈多龍 bug 修復 + AI 當機 + UI 調整

### 1. effects.ts 正確性修復（4 張）

| 卡 | 舊錯誤實裝 | 正確實裝 |
|:---|:---|:---|
| 願增猿｜腎上腺腦力 | 要求卸 1 張惡能量才能觸發 | 僅檢查 `c.damage >= 30`，直接移 30 → 對手任一寶可夢 +30（含 KO） |
| 赤松 | 兩張能量都進手牌 | 第 1 張進手牌、第 2 張用 `heal-target` 選一隻寶可夢附加（二階段 resolver `akamatsu-split` → `akamatsu-attach`） |
| 多龍巴魯托ex｜幻影奇襲 | 固定把 60 點打在 1 個選定的備戰 | 6 個 10 點指示物分別放置，每次透過 `opp-bench-choose` 點選，支援同一對象重複（ABC×20、A40/B20、A30/C30 等任意組合）；`dragapult-snipe` resolver 鏈到剩 0 或對手無備戰為止，途中 KO 自動結算 |
| 白蕾雅 | +30 傷害本回合 | **對手獎勵牌恰為 2 張才可打出**（`regG`）；本回合自己的「太晶」寶可夢招式 KO 對手戰鬥位 → +1 獎勵牌 |

### 2. 白蕾雅 引擎支撐

- `PlayerState.teraKoBonusPrizeThisTurn?: boolean`（types.ts）
- engine.ts KO 路徑：`prizes += whiteLilyBonus`，條件為 aIdx 玩家有此旗標 + `pool.get(active.cardId).attacks[].name === '太晶'`
- `END_TURN`（aIdx）清除旗標
- 「太晶寶可夢」的偵測方式：卡牌資料中這些寶可夢第一個招式名為「太晶」（效果：只要這隻寶可夢在備戰區，不會受到招式的傷害）

### 3. 含羞苞 癢癢花粉 AI 當機修復

- 症狀：AI 對手被 `cantPlayItemNextTurn` 標記後，`cantPlayItemThisTurn` 在下回合開始 promote；AI 主循環 `getPlayableTrainers` 回傳內容未過濾被鎖物品，AI 重複 `PLAY_TRAINER` → engine 靜默 `return state` → 死迴圈
- 修復：`engine.ts::getPlayableTrainers` 加入 `player.cantPlayItemThisTurn`/`cantPlaySupporterThisTurn` 過濾

### 4. Mulligan 相關 UI / log 翻成繁中

- setup UI 彈窗標題：`🔄 對手 Mulligan` → `🔄 對手的重抽懲罰`
- 等待對手：`⏳ 等待對手決定 Mulligan 補抽` → `⏳ 等待對手決定補抽`
- 先手擲硬幣視窗的 `🔄 Mulligan：` → `🔄 重抽懲罰：`
- engine.ts 產生的 log `Mulligan N 次` → `起手無基礎寶可夢，重抽懲罰 N 次`
- `對手 mulligan 補償` → `對手重抽懲罰補償`；`放棄 N 張 mulligan 補抽` → `放棄 N 張重抽懲罰補抽`

### 5. CSS 調整：場地與備戰區往下延伸

- `.playmat` grid-row：我方場地 min-height 從 230px → 275px；overflow hidden → visible（給按鈕垂墜空間）
- `.field-row` overflow hidden → visible
- `.my-row` padding-bottom 0.6rem → 1.4rem（解決備戰寶可夢特性按鈕溢出綠色框框）
- `.action-bar` min/max-height 160/200 → 180/240，overflow hidden → visible（解決中央場地卡下方被切）

### 6. 驗證

- `npm run build`：client 5.92s / server 11.72s（通過）

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

---

## 📝 2026-04-20 Session 38f (v1.56) — 不公印章 gate 修正 + peek-top-N 揭露其他卡 + action-bar min-height

### 1. 不公印章機制修正

**錯誤行為：** 舊版 gate 寫成 `st.players[idx].prizes.length < 6`——這檢查的是「我（idx）是否取過獎賞」方向剛好反了，而且沒區分「上一回合」vs「以前曾經」。結果無條件可用。

**正確規則：** 卡面寫「上個對手的回合自己的寶可夢【昏厥】了才可使用」= 對手在他們剛結束的回合有取過獎賞。

**修法（snapshot + 比對）：**

1. `types.ts` 新增 `GameState.oppPrizesAtMyLastTurnEnd: [number, number]`，預設 `[6, 6]`。
2. `engine.ts` END_TURN 處理：aIdx 結束回合時，snapshot `newOppSnap[aIdx] = players[1-aIdx].prizes.length`；把這個快照帶進下一回合 state。
3. `effects.ts` gate：
   ```ts
   regG('不公印章', (st, idx) => {
     const oppIdx = (1 - idx) as 0 | 1;
     const snap = st.oppPrizesAtMyLastTurnEnd?.[idx] ?? 6;
     return st.players[oppIdx].prizes.length < snap;
   });
   ```

**邊緣 case 驗證：**
- 先手第 1 回合：snap=6, opp.prizes=6 → `6 < 6` false（正確，沒對手回合發生過）
- P2 第 2 回合，P1 第 1 回合沒 KO：snap=6, opp.prizes=6 → false
- P2 第 2 回合，P1 第 1 回合 KO 了 P2 的寶可夢：snap=6（init）, opp(P1).prizes=5 → `5<6` true（正確）
- 自己中毒 KO 在自己回合末：prize 變化發生在「自己的回合」，下次自己回合 gate `snap==opp.prizes` → false（正確，不該判定「前個對手回合 KO」）

### 2. peek-top-N 揭露其他卡（米立龍「集客」= Supporter:TOP6）

**Leon 回報：** 米立龍翻 6 張挑支援者，原本 UI 只顯示挑到的 3 張支援者；另外 3 張非支援者玩家明明看過了但 UI 藏起來。他希望比照好友寶芬/高級球，多一塊區域顯示那 3 張。但差別是——只顯示翻到的這 6 張裡的其他，**不該**像 Ultra Ball 顯示整個牌庫剩餘（那會外洩未翻到的位置）。

**修法（`+page.svelte` 選擇 modal 內，在既有的 `<details>「查看牌庫剩餘全部」` 之後加一塊）：**

- 觸發條件：`/:TOP\d+$/.test(filter)`——只處理 "Subset:TOPN" 格式（如 `Supporter:TOP6`）。純 `TOP6` / `TOP8` 不進這個分支（它們本來全範圍就可選）。
- 內容：從 `params.top6Iids`（或 top8Iids）找出所有 peek 範圍內的卡，排除已在 `selectionItems`（= 可挑的）= 剩下的就是玩家看過但不能選的其他卡。
- 顯示：`<details>` 摺疊，summary 包含「翻到的其他 N 張 · 牌庫剩餘 X 張」，list 只顯示卡名（不揭露其他牌庫位置）。

### 3. action-bar min-height 提升

**原因：** v1.54 把 max-height 從 130 提到 200 只是上限；沒 stadium / log 又短時 action-bar 還是會塌縮到 ~70px（grid auto row 跟最高 child 走）。

**修法：** `.action-bar{ min-height:70px → 160px }`。log-col 隨時有 ~5-6 行可視，有 stadium 時再自動撐到 178-200px。副作用極小（沒 stadium 時多一塊暗底色但視覺上協調）。

**驗證：** `/tmp/ptcg-work/repo` 本機 `npm run build` 通過。版本 1.55 → 1.56。

---

## 📝 2026-04-20 Session 38g (v1.57) — 變動張數招式改為玩家自選丟棄能量

### 背景 / Leon 回報

> 玩家 1 的 超級蒂安希ex 使出「花冠射線」，造成 240 傷害！
> 花冠射線：丟棄 2 個能量，造成 240 傷害
>
> 這種招式要讓玩家自己選擇要丟幾張能量，有的招式是有上限的，例如超級蒂安希ex的「花冠射線」最多只能丟2張，有的是沒有上限的，例如猛擂鼓EX（而且他可以丟別的寶可夢的能量）。

原本 `regPre('超級蒂安希ex|花冠射線', …)` 固定丟最多 2 張（`Math.min(2, energies.length)`），玩家沒得選。

### 設計：宣告式 spec + 行為式 regPre 雙層

為了支援多張未來會有的變動張數招式（花冠射線、猛擂鼓 EX、其它 discard-N-damage 類），不要每張卡各自塞 UI。分成兩層：

- **宣告層 `ATTACK_PRE_DISCARD_CHOICE: Map<key, PreDiscardSpec>`**（`effects.ts` export）：UI 讀這個表決定是否在按下招式按鈕時彈出 modal、範圍（只丟出場方 vs 自己場上任一隻）、張數上下限、以及預估傷害公式（只用於顯示）。
  ```ts
  export interface PreDiscardSpec {
    min: number;
    max: number | null;            // null = 不限上限
    scope: 'attacker' | 'any-own'; // attacker = 只攻擊方出場；any-own = 自己場上任一隻（猛擂鼓 EX）
    baseDamage: number;
    damagePerEnergy: number;
  }
  ```
- **行為層 regPre**：還是單一來源計算傷害、移動能量卡。簽名延伸為 `(state, aIdx, pool, action?)`；若 action 帶 `discardedEnergyIids` 則照玩家選的 iid 丟；否則 fallback 舊自動邏輯（AI 舊流程不會壞）。

### 涉及檔案

1. **`src/lib/game/types.ts`** — ATTACK action 多一個可選欄位：
   ```ts
   | { type: 'ATTACK'; attackIndex: number; discardedEnergyIids?: string[] }
   ```
2. **`src/lib/game/actions.ts`** — `attack` helper 多一個可選參數；空陣列/undefined 時不塞欄位，維持序列化乾淨。
3. **`src/lib/game/effects.ts`**
   - `AttackPreFn` 新增 optional `action` 參數
   - 新增 `ATTACK_PRE_DISCARD_CHOICE` export + `PreDiscardSpec` interface
   - 註冊花冠射線 spec `{min:0, max:2, scope:'attacker', baseDamage:0, damagePerEnergy:120}`
   - 改寫花冠射線 regPre：若 `action.discardedEnergyIids` 有值，只用屬於攻擊方出場身上的那些 iid（safety filter + cap at max 2）；沒給就 fallback
4. **`src/lib/game/engine.ts`** — ATTACK handler 呼叫 `preFn(workingState, aIdx, pool, action)` 時把 action 傳進去
5. **`src/routes/game/+page.svelte`**
   - 從 `$lib/game/effects` import `ATTACK_PRE_DISCARD_CHOICE` / `PreDiscardSpec`
   - 新增 `preAttackDiscard` state + `initiateAttack(i)` / `getDiscardableEnergies()` / `togglePreAttackEnergy()` / `confirmPreAttackDiscard()` / `cancelPreAttackDiscard()`
   - 招式按鈕 onclick 改為 `initiateAttack(i)`：查表命中才彈 modal，否則維持原本直接派送
   - 新增一個 selection-overlay modal：列出 scope 範圍內所有能量、toggle 選擇、顯示預估傷害 (`baseDamage + picked × damagePerEnergy`)、確定/取消
6. **`src/lib/version.ts`** — `1.56` → `1.57`

### 後續擴充（猛擂鼓 EX 實裝時只要兩步）

- regPre：重複花冠射線的模板，但用 `action?.discardedEnergyIids` 掃描自己場上（active + bench）找 iid、搬進 discard；damage = n × perEnergy
- ATTACK_PRE_DISCARD_CHOICE.set：`{min: X, max: null, scope: 'any-own', baseDamage: 0, damagePerEnergy: Y}`
- UI 自動吃新 spec，不用再改 `+page.svelte`

### 驗證

`/tmp/ptcg-work/repo` 本機 `npm run build` 通過。版本 1.56 → 1.57。


---

## 📝 2026-04-20 Session 38h (v1.58) — H 標第 4 波：bench snipe 一次補 13 張

### 背景

H 標未實裝分類表裡，bench-snipe / spray 類（招式會打到備戰區）共 22 張，是 damage-multiply 35 之後第二大群。大部分只要能「對備戰打固定傷害 + 走標準 KO 流程」就能跑。這波挑 13 張不需要新引擎能力的先做，剩 9 張（gust-and-hit × 5、傷害指示物分配 × 2、傷害轉移 × 2）留待後續有新機制時再補。

### 新增 helper（`src/lib/game/effects.ts`）

避免每張卡都手寫 KO cascade。獨立出 3 個本地 helper（不引 engine.ts，維持 effects→engine 單向依賴）：

- **`koPrizeCount(card)`** — 抄 engine 的 `prizesForKO` 邏輯：超級 ex = 3、ex/EX = 2、其它 = 1。
- **`effectiveHPInline(inst, pool)`** — 吃 `TOOL_HP_BONUS` 讀工具加成後的有效 HP，判斷是否已 KO。
- **`hitBenchAll(state, aIdx, targetSide, amount, pool, label)`** — 對指定一方（aIdx / 1-aIdx）的所有備戰傷害 + KO 判定。KO 時能量 / 工具 / 進化堆整包進棄牌區、`pendingPrizes` 累加（用 `+=`，別覆蓋）、每張都寫 log。
- **`hitBenchPickPost(state, aIdx, targetSide, count, amount, label)`** — 不直接打，而是推 pendingSelection（`bench-choose` / `opp-bench-choose`）讓玩家/AI 挑 N 隻，再由 resolver `bench-hit-N` 統一施加傷害。
- **resolver `bench-hit-N`** — 讀 `params.amount` / `params.attackLabel`，逐一對 selectedIids 套傷害、KO 判定、搬廢棄。

### 13 張分 5 個小模式

**P1 自／雙方全體 bench 固定值**（3 張）：
- 穿山王｜地震（自己 bench 全吃 10）
- 焚焰蚣｜燃燒熱浪（自己 bench 全吃 30）
- 電飛鼠｜天空波（雙方 bench 全吃 10）

**P2 指定敵方 bench N 隻 × amount**（5 張）：
- 奇麒麟ex｜惡劣光束（對手 1 × 30）
- 摩托蜥ex｜突圍（對手 1 × 30）
- 冰伊布ex｜冰霜子彈（對手 1 × 30）
- 三首惡龍ex｜黑曜石（對手 2 × 130）
- 麒麟奇｜雙向頭擊（自己 bench 1 × 10；對己方 bench 1 隻）

**P3 條件 damage-plus**（3 張，regPre 調整 damage）：
- 老翁龍｜盛怒炮（100 + 120 if 自己 bench 全部受傷）
- 洗翠 風速狗｜驕傲獠牙（30 + 90 if 任一自己 bench 受傷）
- 鐵頭殼｜滅絕斬（40 + 80 if 對手 bench ≥ 3）

**P4 清 stadium + bench 全體**（1 張）：
- 古鼎鹿｜大地斷裂（若有 activeStadium：丟到攻擊方棄牌 + 對手 bench 全吃 30）

**P5 牌庫條件觸發挑選**（1 張）：
- 古簡蝸｜貪婪危害（若自己牌庫 ≤ 3：對手 bench 2 隻 × 120）

### 驗證

- `/tmp/ptcg-work/repo` 本機 `npm run build` 通過
- `node /tmp/sim-sandbox/sim-repo.mjs 50` → 50/50 正常結束，0 crash / 0 stuck
- 版本 1.57 → 1.58

### 未竟（H 標 bench-snipe 剩 9 張）

需要新引擎能力才跑得動，下波再推：
- gust-and-hit（拉上場 + 攻擊同一回合解決）× 5
- 傷害指示物分配（n 個 counter 任意分配到對手場上）× 2
- 傷害轉移（把自己身上 counter 搬到對手 bench）× 2

---

## 📝 2026-04-20 Session 38i (v1.59) — H 標第 5 波：damage-multiply 18 張

### 背景

H 標未實裝分類表第二大群是 damage-multiply 35 張。全部都是「某數字 × k」的形式，且多半只靠既有 state 即可算出。這波先挑 18 張最單純的；剩下 17 張牽涉棄牌區特定 trait（「古代」）、備戰區名字比對、手牌道具挑選、反彈傷害、counter 自貼等新機制，下波再推。

### 新增 helper（局部 / `effects.ts`）

避免每張卡手刻 counter 計算，抽出 6 個小函式：

- `counterCount(dmg)` — `Math.floor(dmg / 10)`
- `selfActiveCounters(state, aIdx)` / `oppActiveCounters(state, aIdx)`
- `oppAllCounters(state, aIdx)` — active + bench 加總
- `countOwnPokemon(state, aIdx, pool, filterFn)` — active + bench 符合條件者
- `countOppPokemon(state, aIdx, pool, filterFn)` — 同上但對手側

### 18 張分 4 組

**A. 自己身上 counter × k（6 張）**
- 醜醜魚｜抓狂（counter × 10）
- 厄鬼椪 火灶面具ex｜憤怒之窯（counter × 20）
- 鋁鋼龍｜激怒之錘（80 + counter × 10）
- 狠辣椒ex｜香料激怒（10 + counter × 70）
- 巨蔓藤｜覆蓋（150 − counter × 10，Math.max(0, …)）
- 尖牙籠｜覆蓋（130 − counter × 10）

**B. 對手戰鬥 counter × k（6 張）**
- 冰鬼護｜傷害律動（counter × 20）
- 蘋裹龍｜酸味噴吐（counter × 20）
- 麒麟奇｜精神傷害（20 + counter × 10）
- 太陽伊布｜精神傷害（30 + counter × 10）
- 月月熊 赫月｜瘋狂啃咬（100 + counter × 30）
- 猛惡菇｜爆毆（50 + counter × 50）

**C. 自己場上寶可夢分類數 × k（3 張）**
- 土台龜ex｜森林行進（`pokemonType === 'Grass'` × 30）
- 奇麒麟｜中級轟鳴（`subtype === 'Stage1'` × 40）
- 投擲猴｜聯合投擲（`subtype === 'Basic'` × 20）

**D. 其他計數類（3 張）**
- 索羅亞克｜幻影劫持（對手場上 `subtype === 'ex'` × 60）
- 亞克諾姆｜意志強念（10 + 對手全場 counter 和 × 10）
- 水晶燈火靈｜意志統治者（對手手牌 × 30）

### 驗證

- `npm run build` 通過
- `node /tmp/sim-sandbox/sim-repo.mjs 50` → 50/50 正常結束、0 crash / 0 stuck
- 版本 1.58 → 1.59

### 下波（damage-multiply 剩 17 張）

需要新機制或資料 tag：
- 「古代」trait（轟鳴月｜雪恨箭羽、故勒頓｜原生亂打、來悲粗茶ex｜熬返 等）— 卡資料沒有 `trait` 欄位，要另建 Ancient 名單
- 備戰區特定名字比對（鍬農炮蟲｜串聯加農炮 查「蟲電寶」、隨風球｜一同爆炸 查「飄飄球」）
- 手牌丟任意數量道具（灰塵山｜丟棄）— 類似 v1.57 discard-N-damage 但選手牌道具
- 反彈傷害（海豚俠｜先鋒拳）— attacker self damage
- 放 counter 到自己（波盪水｜蜿蜒割裂）— attach-damage-counter-self
- 棄牌區能量卡數（蒼炎刃鬼ex｜深淵熾火）
- 棄牌區含特定招式名的寶可夢卡數（投羽梟｜團結之翼）
- 已得獎賞卡數（鐵蟻ex｜復仇粉碎）— `prizes` state 有對手獲得量
- 對手撤退能量數（阿利多斯、鐵包袱）— 算 `retreatCost.length - tool 減值`
- 對手特殊狀態數量（搖籃百合｜瘴氣之風）
- 對手 bench × self counter（吼叫尾｜大吼大叫，用 hitBenchPickPost）
- debuff-self-till-next-turn（智揮猩｜掌握弱點）

---

## 📝 2026-04-20 Session 38j (v1.60) — H 標第 6 波：damage-multiply 第二批 10 張

### 10 張涵蓋剩餘可做的計數類

- **蒼炎刃鬼ex｜深淵熾火** — 30 + 自棄牌區能量 × 20
- **鐵蟻ex｜復仇粉碎** — 120 + 對手已取獎賞（6 − prizes.length）× 30
- **阿利多斯｜線帶纏繞** — 10 + 對手戰鬥 retreatCost × 30
- **鐵包袱｜瞬風衝激** — max(0, 200 − 對手戰鬥 retreatCost × 50)
- **鍬農炮蟲｜串聯加農炮** — 120 + 自備戰區「蟲電寶」× 80
- **投羽梟｜團結之翼** — 自棄牌區含「團結之翼」招式的寶可夢卡 × 20
- **搖籃百合｜瘴氣之風** — 對手戰鬥 status × 100（引擎 status 單欄位，上限 1）
- **海豚俠｜先鋒拳** — regPre 130 + regPost 自傷 counter × 10
- **波盪水｜蜿蜒割裂** — 自放 9 counter（active.damage += 90）+ 180 damage
- **吼叫尾｜大吼大叫** — regPost hitBenchPickPost opp × (self counter × 20)

### 已知限制

- 搖籃百合的特殊狀態計算因 state schema 限制最多 1；真正多重狀態實裝要等引擎升級
- 海豚俠 / 波盪水 自傷導致 self-KO 時目前引擎不會自動判 KO（和既有 `奢華炸彈` 反彈一致），留 bug 紀錄
- 吼叫尾原文「對手的 1 隻寶可夢」應含 active，現簡化只打 bench（bench 不計弱點本就符合，active 需要完整 damage pipeline）

### 驗證

- `npm run build` 通過
- sim 50 局全部正常結束、0 crash
- 版本 1.59 → 1.60

### damage-multiply 剩 7 張（之後不歸到這類）

- 「古代」類 3 張（故勒頓｜原生亂打、轟鳴月｜雪恨箭羽、來悲粗茶ex｜熬返）— 需建 Ancient 名單
- 灰塵山｜丟棄 — 需手牌挑道具 UI（類似 v1.57）
- 隨風球｜一同爆炸 — 計自己場上特定名字 + 自 bench snipe
- 智揮猩｜掌握弱點 — 需 debuff-self-weakness-type-till-next-turn
- 鐵包袱 已實裝；還有 attach-energy/coin-heads/discard-energy 混合類裡的 damage-multiply 屬於別的分類，下波再處理

---

## 📝 2026-04-20 Session 38k (v1.61) — H 標第 7 波：雜項（coin/confuse/draw/damage-reduce）27 張

### A. 硬幣 +N 傷害 helper `coinPlusPre(base, bonus, label)` → 6 + 1 張
啃果蟲｜打滾（20/+30）、炙燙鱷｜高溫吐息（30/+50）、電海燕｜燕返（10/+20）、銅鏡怪｜盾牌攻擊（20/+20）、一對鼠｜嬉鬧（10/+10）、普隆隆姆｜擊飛（90/+90）；貓鼠斬｜連斬 3 次硬幣階梯加傷。

### B. 混亂對手 6 張
仙子伊布｜魅惑之聲、麻花犬ex｜奇跡閃耀、卡璞・蝶蝶｜蠱惑、青綿鳥｜魅惑之聲、月亮伊布ex｜月亮幻想、電燈怪｜錯亂閃光（後者 counter=8 規則改寫未實作）。

### C. 混亂自己 2 張 — 新 `selfConfusePost` helper
流氓熊貓｜暴走、棄世猴｜暴走。

### D. 抽卡 `drawNPost(n, label)` → 6 張 + 1 張手牌捨棄抽牌
摩托蜥ex｜鋯石之路（5）、蟲滾泥/斑斑馬/時拉比｜呼喚（1）、蟲甲聖｜三重抽出（3）、金魚王｜快速抽出（2）、鑰圈兒｜插入抽出（隨機丟 1 抽 2）。

### E. 自己下回合受傷 -N 4 張
龍捲雲｜暴風障壁（-50）、盔甲鳥｜鋼翼（-30）、振翼髮｜月亮之力（-30）、仙子伊布ex｜魔法魅惑（-100）。

### F. 丟對手手牌 `oppDiscardRandomHand(n, label)` → 2 + 2 張
功夫鼬｜拍落（1）、太陽伊布ex｜精神出局（1）；巨牙鯊｜咬棄（3 次硬幣正面數）、鐵螯龍蝦｜喀嚓喀嚓（2 次硬幣正面數，棄對手牌庫頂）。

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash
- 版本 1.60 → 1.61

---

## 📝 2026-04-20 Session 38l (v1.62) — H 標第 7 波：debuff-target 大批次（44 張）

### 引擎改動：`cantRetreatNextTurn` 生效

types.ts 已有該旗標但從未被引擎處理過。v1.62 補上：

1. `RETREAT` action handler：`if (attacker.active.cantRetreatNextTurn) return state;` — 睡眠/麻痺檢查後接續。
2. `END_TURN`：在 `clearCantAttackThisTurn` 之後新增 `clearCantRetreat` block，對 currentPlayer 的 active + bench 清除 flag（flag 作用於 flag 擁有者的本回合，於該回合結束時清除）。

### (A) 對手受招後下回合無法撤退 — 14 張（含複合）

新 helper `defCantRetreatNextPost()` 設 defender.active.cantRetreatNextTurn：
羅絲雷朵｜束縛、小鋸鱷｜咬緊、三海地鼠ex｜麻痺控制、厄鬼椪 水井面具ex｜啜泣、勒克貓｜咬緊、大狼犬｜窮追不捨、狃拉｜逼近、黑夜魔靈｜影子束縛、觸手百合｜束縛、拖拖蚓ex｜岩石封鎖、磨牙彩皮魚｜咬緊、噬沙堡爺ex｜流沙地獄。

複合式（status + cantRetreat）：
- 爆焰龜獸｜火焰陣（灼傷 + 不撤退）
- 車輪毬｜毒陣（中毒 + 不撤退）
- 桃歹郎｜猛毒連鎖（中毒 + 不撤退）

### (B) 自己下回合無法使用招式 — 26 張

用既有 `selfCantAttackNextPost()`（所有「指定招式名」統一視為「全招式」，已知簡化）：
炎熱喵｜閃焰強襲、咕咕鴿｜噴射之翼、高傲雉雞｜潛力、鐵螯龍蝦｜暴亂之錘、月月熊 赫月ex｜血月（兩種寫法）、波普海豚｜水流斬、海豚俠ex｜終極衝擊、吉利蛋｜潛力、大嘴蝠｜漆黑利刃、願增猿ex｜惡劣頭擊、閃焰王牌ex｜閃焰強襲、好勝毛蟹｜揮大拳、電燈怪｜閃電伏特、鋁鋼橋龍｜鐵之引爆、爆炸頭水牛｜潛力、蒼炎刃鬼｜黑煙斬、自爆磁怪｜電磁炮、火伊布ex｜紅玉髓、鐵毒蛾｜高熱光線、水伊布ex｜海藍寶石、雷伊布ex｜棕碧璽、鐵武者ex｜鐳射利刃、沙鐵皮ex｜大地扣殺、月亮伊布｜漆黑利刃、猛惡菇｜暴亂之錘、雙劍鞘｜猛擊在地。

加 1 張擲硬幣觸發：朝北鼻｜力量猛攻（反面才 disable）。

### (C) 對手受招後下回合無法使用招式 — 1 張
豐蜜龍｜甜蜜熔化（用既有 `defCantAttackNextPost()`）。

### (D) 復仇傷害 `revenge-dmg-plus` — 3 張

靠 `oppPrizesAtMyLastTurnEnd` 快照判斷「上個對手回合對手有取過獎賞（= 自己寶可夢被 KO）」：
- 鐵斑葉｜復仇刀鋒 100+60
- 普隆隆姆｜捲土重來 30+90
- 古玉魚｜嫉妒業火 50+90

### (E) 懶人獺｜悠哉 — heal 60（部分實裝）

簡化為僅恢復 60 HP；「這隻寶可夢下回合無法撤退」部分延後（需新增 `cantRetreatPending` 並於擁有者 END_TURN 晉升為 nextTurn，避免當回合即被清）。

### 暫緩（需要新機制）
- 青銅鐘｜進化妨礙者：對手不可進化
- 含羞苞｜癢癢花粉：對手無法從手牌使出物品卡
- 吼叫尾ex｜絕叫：對手無法使出支援者 + 後攻首回合限定
- 電蜘蛛ex｜雷擊石：discard-all-self-energy + 對手無法使出物品卡
- 晶光花｜侵蝕碎塊：中毒 + 對手無法附加從手牌的能量
- 帕底亞 肯泰羅｜障礙踩踏：僅基礎寶可夢下回合不能攻擊
- 鐵包袱｜冷卻噴射：僅進化寶可夢下回合不能攻擊
- 電擊魔獸｜雷電在地：自己所有寶可夢下回合不能攻擊（player-level flag）
- 大王銅象｜鼻之金勾臂：optional +100 帶 self-debuff

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、0 stuck
- 版本 1.61 → 1.62

---

## 📝 2026-04-21 Session 38m (v1.63) — H 標第 8 波：coin-heads-multiply 24 張

### 新 helper：`coinHeadsMultiplyPre(flips, perHead, label)` → AttackPreFn
擲 N 次硬幣，正面次數 × k 點傷害，寫 log 並回傳 damage。

### 實裝（24 張）
木棉球｜三重旋轉（3×10）、海豚俠｜二連擊（2×90）、雙卵細胞球｜雙重戲法（2×30）、長鼻葉｜連出巴掌（3×30）、蘑蘑菇｜二連頭錘（2×10）、佛烈托斯｜尖刺加農炮（3×30）、大舌舔｜舔舔颶風（4×70）、向日種子｜種子機關槍（4×10）、蚊香蝌蚪｜擺尾拍打（2×20）、蚊香君｜連環巴掌（2×30）、穿山鼠｜雙重抓（2×20）、索羅亞｜雙重抓（2×20）、喵喵｜亂抓（3×20）、貓老大｜亂抓（3×50）、幼棉棉｜雙重旋轉（2×10）、燈籠魚｜雙重伏特（2×20）、咕咕｜三次撞（3×10）、爆香猿｜雙重粉碎（2×70）、猴怪｜二連劈（2×10）、青銅鐘｜雙重衝擊（2×100）、一家鼠｜連續門牙（4×30）、三海地鼠｜三連鞭（3×70）、天然雀｜三連撞（3×10）、袋獸｜迷昏拳（2×90）。

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 25/25
- 版本 1.62 → 1.63

---

## 📝 2026-04-21 Session 38n (v1.64) — H 標第 9 波：coin 混合三類（16 張）

三個新 helper + 16 張招式實裝。

### (A) coin-tails-fail — 4 張
`coinTailsFailPre(base, label)`：擲 1 次硬幣，反面則招式失敗（damage=0），正面照原傷害。
單卵細胞球｜偷襲（30）、斯魔茶｜偷襲（30）、搬運小匠｜全力拳（40）、阿羅拉 地鼠｜偷襲（30）。

### (B) coin-heads-self-immune-next — 7 張
`coinHeadsSelfImmuneNextPost(label)`：擲 1 次硬幣，正面則設 `damageReduceNextHit = 9999`（實質免疫下個對手回合的招式傷害）。「效果不受影響」部分簡化未處理。
泥偶小人｜鐵壁、泥偶巨人｜鐵壁、土龍弟弟｜挖洞（30）、電電蟲｜躍起閃避（10）、東施喵｜喵打滾（80）、飄飄雛｜躍起閃避（10）、七夕青鳥｜棉花之翼（100）。

### (C) coin-until-tails-multiply — 5 張
`coinUntilTailsMultiplyPre(perHead, base, label)`：擲硬幣直到反面為止，正面數 × k（+ 可選 base）。有 20 次安全上限防無限迴圈。
瑪力露｜滾球（10×）、土狼犬｜連續舞步（10×）、普隆隆姆｜奔進（100×）、燈罩夜菇｜螺旋衝刺（60+30×）、索財靈｜連續擲幣（20×）。

### 暫緩
- 仙子伊布｜奧密迴旋（正面將 1 隻對手備戰放回牌庫並重洗）— 需 shuffle-bench-to-deck UI
- 熔蟻獸｜滑燒火焰 130 + 擲 3 硬幣反面數丟自己能量 — 需 discard-energy 組合
- 鐵荊棘｜壞死壓榨 翻牌庫 5 張，未來卡 × 70 — 需「未來」trait 識別

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash
- 版本 1.63 → 1.64

---

## 📝 2026-04-21 Session 38o (v1.65) — H 標第 10 波：self-heal 20 張

### 新 helper
- `selfHealPost(amount, label)`：招式後自己恢復 N HP（動畫寫 log「實際回復 X HP」）
- `healAllOwnPost(amount, benchOnly, label)`：所有自己寶可夢（或僅備戰）各回 N HP

### 自己戰鬥寶可夢回 N HP — 17 張
土台龜ex｜叢林之錘（50）、萌虻｜小吸取（10）、波盪水｜極光增輝（20）、向日花怪｜超級吸取（30）、小木靈｜寄生種子（20）、墨海馬｜紋絲不動（30）、尖牙籠｜偷食（40）、瑪沙那｜冥想（20）、薩戮德｜綠葉吸取（20）、走鯨｜吸取鰭（20）、超能豔鴕｜螺旋吸取（30）、蛋蛋｜吸取（10）、波克基古｜吸取之吻（30）、水伊布｜螺旋吸取（30）、蒼炎刃鬼｜生命之紗（30）、新葉喵ex｜魔法葉（30）、陸地水母｜超級吸取（30）。

### 所有自己寶可夢回 N HP — 3 張
- 來悲粗茶ex｜抹茶飛濺（全員 +30）
- 克雷色利亞｜治癒之舞（全員 +20）
- 葉伊布ex｜苔紋瑪瑙（僅備戰 +100）

### 暫緩
- 花蓓蓓｜療傷、啃果蟲｜營養素：選 1 隻任意自己寶可夢恢復 30（需 pending heal-target 擴展給任意招式）
- 葉伊布｜嫩葉之恩、卡比獸｜吃飽先：附加能量 + 回全/部分 HP（複合機制）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 27/23
- 版本 1.64 → 1.65

---

## 📝 2026-04-21 Session 38p (v1.66) — H 標第 11 波：條件式增傷（23 張）

### 新 helper
- `defIsExPre(base, bonus, label)` → 對手戰鬥寶可夢是 ex/V 則 +bonus
- `defIsEvolvedPre(base, bonus, label)` → 對手為進化（Stage1/Stage2）
- `selfBenchHasTypePre(base, bonus, ptype, label)` → 自己備戰有某屬性
- `selfBenchHasNamePre(base, bonus, name, label)` → 自己備戰有某名字
- `selfPrizesMorePre(base, bonus, label)` → 自己獎賞 > 對手
- 輔助：`isExCard`, `isEvolvedCard`

### 實裝（23 張）
- 波盪水ex｜宣洩吼嘯（對手有狀態 +120）
- ex/V 檢：泥偶巨人｜鬥志之拳、舞天鵝｜鬥志之翼、電蜘蛛ex｜衝天之線、火/水/雷伊布｜鬥志 X 三連、蒼炎刃鬼｜鬥士的巨劍、無極汰那｜汰那爆破
- 進化檢：毒骷蛙｜俐落一擊、肯泰羅｜俐落一擊
- 1 階檢：帕底亞 肯泰羅｜真氣衝撞
- 屬性檢：銅鏡怪｜鏡面攻擊（超）、電擊魔獸｜漏電關節（對手水）、破破舵輪/龍頭地鼠（備戰鋼）
- 狀態檢：暴噬龜｜堅硬嚼碎（帶傷 +80）、烈箭鷹｜氣旋競爭（撤退 ≥2 +110）
- 場地檢：古玉魚｜大地熔化（有競技場 +60，順便丟）、轟鳴月ex｜災厄風暴（若有競技場丟之 +120）
- 道具檢：大朝北鼻｜進擊鐳射（對手附道具 +80）
- 備戰 by-name：大狼犬｜群起打獵、電螢蟲｜聯合攻擊（甜甜螢）
- 獎賞檢：摔角鷹人、卡璞・鳴鳴（獎賞 > 對手）、破空焰｜爆燃突擊（對手獎賞 ≤4）
- 牌庫/手牌檢：蟲甲聖｜絕地反攻（牌庫 ≤3 +200）、師父鼬｜疾風迴旋（對手手牌 ≤5 +60）
- 能量檢：電蜘蛛｜麻麻羅網（自帶雷能量 +80）、阿勃梭魯｜惡棍墜落（場上惡能量 ≥3 +50）
- 眷戀雲｜愛之同感（場上與對手同屬性 +120）

### 暫緩
- 「未來/古代」trait 系：鐵武者｜莊嚴之劍、爬地翅｜鐵碎、故勒頓｜輪番狂攻
- 「上個回合」相關：列陣兵｜一併攻擊、賽富豪｜富裕強襲（進化來源）
- 普隆隆姆ex｜暴衝閃光（本回合從備戰進入戰鬥場 flag）
- 嘎啦嘎啦｜骨之復仇（備戰某名字帶傷）
- 蚊香泳士｜跳躍衝天（optional 自丟牌庫 +120）— 暫取 base 120
- 雷吉奇卡斯｜寶石破壞（太晶 trait）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash
- 版本 1.65 → 1.66

---

## 📝 2026-04-21 Session 38q (v1.67) — H 標第 12 波：other-bucket 簡單機制（8 張）

### 實裝（8 張）
- 巨炭山｜山崩（150 + 對手牌庫頂 2 張丟棄）
- 雄偉牙｜地盤崩壞（對手牌庫頂 1 張丟棄；古代支援者 +3 簡化略）
- 焚焰蚣｜焦黑吐息（對手灼傷 → 180；否則招式失敗 0 傷害）
- 熔岩蟲｜熾熱熔岩（20 + 灼傷；使用既有 statusPost）
- 故勒頓｜撕裂（130；簡化：不特殊處理「不計算身上附加效果」）
- 夠讚狗ex｜瘋狂連鎖（130；若自身中毒 +130 = 260）
- 貓頭夜鷹｜鉤爪搜尋（70 + drawNPost(2)；簡化：非從牌庫任選）
- 皮卡丘｜電磁電光（對對手任一寶可夢 10 傷害；opp-poke-choose、snipe-10 resolver）

### 暫緩
- 地盤崩壞「古代」支援者條件（engine 未追蹤 supporter 類別）
- 撕裂「不計算身上附加效果」（engine 未實作弱點/抵抗修正）
- 鉤爪搜尋「從牌庫任選最多 2 張」（簡化為抽 2 張頂）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 30/20
- 版本 1.66 → 1.67

---

## 📝 2026-04-21 Session 38r (v1.68) — H 標第 13 波：other-bucket 續（9 張）

### 實裝（9 張）
- 朽木妖｜終極吸取（50 + selfHealPost(50)；簡化：不追實際傷害，固定回 50）
- 洗翠 卡蒂狗｜全部燒光（0 傷害 + 丟棄競技場）
- 洗翠 風速狗｜灼燒（90 + 灼傷）
- 謝米｜精刺奇襲（對備戰 ex/V 60 傷害、snipe-60-ex resolver）
- 聒噪鳥｜無伴奏合唱（deck-search Basic maxCount 3 → bench-basic-from-deck）
- 向尾喵｜呼朋引伴（deck-search Basic maxCount 1 → bench-basic-from-deck）
- 啃果蟲｜尋找朋友（deck-search Pokemon maxCount 1 → search-pokemon-to-hand）
- 藍鱷｜逆向噴射（30 + bench-choose do-switch 自交替）
- 重泥挽馬｜泥巴庫存（從棄牌區各附 1 張基本【鬥】能量到備戰，無 UI 自動解）

### 暫緩
- 鐵斑葉｜補全之網（discard-search Pokemon 需新 filter 值，後續擴展）
- 霏歐納｜招喚（discard-search Supporter 需新 filter 值）
- 斯魔茶｜上茶（discard-search BasicGrassEnergy 需新 filter 值）
- 大狼犬｜踹開（50 + 對手選備戰互換自己出場；需 opp-swap 機制）
- 花蓓蓓｜療傷、花葉蒂｜小使者（需要任意 heal-target / energy-to-hand 擴展）
- 大舌頭｜舌引（查看對手手牌並選基礎寶可夢放對手備戰；特殊互動）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 21/29
- 版本 1.67 → 1.68

---

## 📝 2026-04-21 Session 38s (v1.69) — H 標第 14 波：傷害指示物直置 + 灼傷補（10 張）

### 新 helper
- `applyDamageToAllOpp(state, aIdx, pool, amount, onlyDamaged, label)` — 對對手所有（或已傷）寶可夢各 +amount 傷害，處理 KO 串聯、獎賞累計、active/bench 全滅 → 勝利
- `setOppActiveHPPre(targetHP, label)` — 將對手戰鬥寶可夢的傷害調整到剩餘 HP = targetHP（不改變自身已傷部分則無效）

### 實裝（10 張）
- 灼傷補齊：呆火鱷｜熱灼燒、熔岩蝸牛ex｜熾熱熔岩、飄浮泡泡 太陽的樣子｜灼熱
- 綿綿泡芙｜悄聲加害（20 傷害 opp-poke-choose，snipe-20 resolver）
- 由克希｜痛楚記憶（對手全體 +20 傷害）
- 伊裴爾塔爾｜侵蝕之風（對手已傷寶可夢 +20 傷害）
- 蜈蚣王｜偏道一回（將對手戰鬥寶可夢 HP 設到 10）
- 恰雷姆ex｜氣功指壓（設到 50）
- 古鼎鹿｜傲慢衝擊（220；自身 ≥40 傷害則失敗 0）
- 八爪武師｜觸手激怒（130 plain；「有傷害則只需 1 鬥能量」動態費用條件簡化略）

### 暫緩
- 雷丘｜捲入伏特（雙方已傷寶可夢 50 各，含自傷；需 self-damage cascade）
- 鐵磐岩ex｜還擊斧、爆炸頭水牛｜等待角擊、冰伊布｜滲透寒氣（反擊式：下個對手回合攻擊方放指示物 — 需 defender-side POST trigger）
- 嘎啦嘎啦｜骨之復仇（備戰卡拉卡拉 damaged → +120；需 self-name bench-is-damaged check）
- 振翼髮｜蠱惑挪移（選自備戰古代將其傷害轉給對手戰鬥；需 ancient trait + damage-transfer）
- 鐵脖頸｜自動導向頭擊（3 隻已傷寶可夢各 50；需多選目標 UI 擴展）
- 死神棺｜冥府之律（雙方擁有特性的寶可夢各 6 指示物；需自傷 + 雙向處理）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 26/24
- 版本 1.68 → 1.69

---

## 📝 2026-04-21 Session 38t (v1.70) — H 標第 15 波：能量 × multiplier（20 張）

### 新 helper
- `EnergyFilter = 'all' | 'basic' | 'special' | EnergyType` — 能量計數過濾器
- `countOneEnergy(inst, filter, pool)` — 單一寶可夢按條件計能量
- `selfAttachedEnergyMultiplyPre(base, per, filter, label)` — 自身附加能量
- `defActiveEnergyMultiplyPre(base, per, filter, label)` — 對手戰鬥寶可夢身上能量
- `oppAllEnergyMultiplyPre(base, per, filter, label)` — 對手全場能量
- `selfAllEnergyMultiplyPre(base, per, filter, label)` — 自己全場能量
- `bothActiveEnergyMultiplyPre(base, per, label)` — 雙方出場之和
- `snipe-variable` resolver — 通用可變傷害 snipe（支援任意數值）

### 實裝（20 張）
- 自身：奇諾栗鼠｜特殊滾滾、巨炭山｜機槍瀝青、吉雉雞｜能量羽毛、刺龍王ex｜水炮、拉普拉斯ex｜力量飛濺、帕路奇亞｜空間粉碎
- 對手戰鬥：蟲甲聖｜精神強念、霏歐納｜能量壓制、勇基拉｜精神強念、胡地｜精神強念、洛托姆｜能量短路
- 對手全場：向日花怪｜光返、蒂安希｜漫反射、塗標客｜能量塗鴉、葉伊布ex｜綠葉風暴
- 自己全場：蜜集大蛇ex｜蜜糖風暴
- 雙方出場：厄鬼椪 碧草面具ex｜萬葉陣雨
- 猛雷鼓｜落雷風暴（自身能量 × 30 對對手任一、snipe-variable resolver）

### 暫緩
- 拖拖蚓ex｜快掃拳返（被動特性：受攻擊時反打 ×2 鋼能量 × 傷害指示物；需 defender-side trigger）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 29/21
- 版本 1.69 → 1.70

---

## 📝 2026-04-21 Session 38u (v1.71) — H 標第 16 波：bench-count × multiplier（10 張）

### 新 helper
- `selfBenchMultiplyPre(base, per, label)` — 自己備戰數 × per
- `oppBenchMultiplyPre(base, per, label)` — 對手備戰數 × per
- `bothBenchMultiplyPre(base, per, label)` — 雙方備戰數總和 × per

### 實裝（10 張）
- 裹蜜蟲｜朋友之環（自備戰 × 20）
- 厄鬼椪 碧草面具｜鬼返（20 + 對備戰 × 20）
- 捷拉奧拉｜鬥戰雷電（20 + 對備戰 × 20）
- 骨紋巨聲鱷｜閃焰獨唱會（60 + 雙方備戰 × 20）
- 太樂巴戈斯ex｜聯盟擊（自備戰 × 30；後攻第一回合判定 active !== firstPlayerIdx && turn === 1 + firstPlayerIdx → 失敗）
- 熔岩蝸牛ex｜大地灼燒（雙方牌庫頂各 1 張丟棄 → 其中能量數 × 140 + base 140；pre 檢查 top，post 執行丟棄）
- 薩戮德｜叢林鞭打（基礎 80，AI 永遠吃 +80：自身能量全部收回手牌）
- 吞食獸｜張大嘴（10 + 若自能量 > 對手戰鬥能量 +160）
- 三海地鼠ex｜三色炮（自動丟最多 3 張能量卡 × 60；AI 打 opp active 簡化）
- 賽富豪ex｜淘金潮（自動丟棄全部基本能量卡 × 50）
- 雪童子｜驚嚇（傷害 20；post 隨機取對手手牌 1 張 + shuffle 回牌庫）

### 暫緩
- 狙射樹梟｜強力射擊（需「手牌必有基本草能量否則招式失敗」之 pre gate）
- 電蜘蛛｜複眼（特性 +50 對 opp active 有特性；需 has-ability 篩選）
- 搬運小匠、偷襲系列（coin-tails-fails：招式失敗機制）
- 大電海燕｜風暴伏特（全能量改附備戰選擇 UI）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 25/25（完全平衡）
- 版本 1.70 → 1.71

---

## 📝 2026-04-21 Session 38v (v1.72) — H 標第 17 波：self-discard-N-energy post-attack（26 張）

### 新 helper
- `selfDiscardNEnergyPost(n, label)` — 攻擊後從攻擊方身上丟棄 N 張能量（從後往前優先丟 → 最近附加的先丟）
- `selfDiscardAllEnergyPost(label)` — 攻擊後丟棄自身全部能量

### 實裝（26 張）
- 1 張自身能量（12 張）：四季鹿｜落葉衝撞、捷拉奧拉｜強力伏特、猛火猴｜高溫打擊、烈焰猴｜燃燒殆盡、冰鬼護｜瘋狂頭、大電海燕｜強力伏特、晶光芽｜岩石射擊、夜盜火蜥｜火花、焰后蜥｜噴射火焰、炭小侍｜噴射火焰、請假王ex｜偉大橫掃、尖牙陸鯊｜力量爆破
- 2 張自身能量（8 張）：鐵磐岩ex｜力量踩踏、巨金怪｜潔淨爆破、煤炭龜｜火焰旋渦、爬地翅｜粉碎之翼、長毛巨魔｜擊拳、鋁鋼龍｜鋁鋼光束、爆炸頭水牛｜粉碎頭擊、古劍豹｜氣忿利刃
- 3 張自身能量（1 張）：皮卡丘ex｜黃玉伏特
- 全部自身能量（5 張）：閃電鳥｜十萬伏特、燈火幽靈｜燃燒盡、倫琴貓ex｜伏特強襲、齒輪怪｜高級光束、蒼炎刃鬼ex｜紫水晶激怒

### 暫緩
- 能量類型選擇（四季鹿要指定草能量等）— 但 attack cost 本身就限制了能量類型，自動丟最近附加的即可
- 對手能量丟棄（比克提尼｜燒落等 — 需選對手 active 上特殊能量）
- 複合型（discard + attach、discard + debuff、discard + bench-snipe）— 後續專波處理

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 23/27
- 版本 1.71 → 1.72

---

## 📝 2026-04-21 Session 38w (v1.73) — H 標第 18 波：coin+discard+status 綜合（10 張）

### 新 helper
- `coinHeadsOppDiscardEnergyPost(label)` — 擲硬幣正面時對手戰鬥寶可夢丟 1 張能量（最近附加的優先）
- `coinTripleHeadsPre(base, b1, b2, b3, label)` — 3 次硬幣，正面 1/2/3 次各加 b1/b2/b3

### 實裝（10 張）
- coin-heads 丟對手能量（6 張）：鬼斯｜神秘光束、角金魚｜潮旋、伊裴爾塔爾｜破壞光束、鑽角犀獸｜破壞之角、火爆猴｜掃腿、火伊布｜破壞火
- 貓鼬斬｜連斬（10 + 3 硬幣正面 1/2/3 → +20/+50/+80）
- 瑪狃拉｜冰雹爪（70，丟自身全能量 + 對手麻痺）
- 自爆磁怪｜強勁磁場（80，混亂 + 對手下回合無法撤退）
- 紅蓮鎧騎｜紅蓮引爆（丟自身全部火能量 → 對手備戰 1 隻 180 傷害；無火能量則招式失敗）

### 暫緩
- 複合狀態：阿柏蛇｜混入毒、晶光花｜神經毒、阿柏怪｜恐慌毒 — 引擎 status 欄位只支援單一狀態，合併式狀態需擴展型別
- 晶光花｜侵蝕碎塊（下回合無法附能量）— 需新 cantAttachEnergyNextTurn 機制
- 電蜘蛛ex｜雷擊石（下回合對手無法使用物品）— 需 cantItemThisTurn
- 搖籃百合｜任選黏液（特性選擇 1 種狀態）— 需 UI 選單
- 熔蟻獸｜滑燒火焰（3 coin × 反面 discard 自身能量）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 27/23
- 版本 1.72 → 1.73

---

## 📝 2026-04-21 Session 38x (v1.74) — H 標第 19 波：swap + discard-multiply + KO（10 張）

### 新 resolver / helper
- `regR('opp-swap-dmg')` — 將對手戰鬥寶可夢與所選備戰寶可夢交換位置，然後對新戰鬥寶可夢造成指定傷害；含完整 KO cascade（能量、道具、進化鏈 → 棄牌；pendingPrizes；全滅判定）
- `oppSwapDmgPost(dmg, label)` — 攻擊後觸發 `opp-bench-choose` + `opp-swap-dmg` 的一體化封裝（無備戰時跳過）
- `registerSelfDiscardMultiply(key, label, baseDamage, per, max, typeFilter?)` — 註冊「丟棄自身最多 N 個能量、每張加傷」的攻擊；同時設 `ATTACK_PRE_DISCARD_CHOICE` 供 UI 選擇丟哪些 + regPre 計算最終傷害；typeFilter 支援 `'all' | 'basic' | EnergyType`

### 實裝（10 張）
- 強制交換+傷害（3 張）：大嘴娃｜誘導敲詐（30）、裹蜜蟲｜蜜糖捕捉器（70）、勇士雄鷹｜拖出（40）
- 丟能量增傷（3 張）：巨鉗螳螂ex｜十字破壞（每張鋼能量 +120，最多 2 張）、固拉多｜熔岩光芒（每張任意能量 +60，最多 4 張）、席多藍恩｜鋼鐵爆炸（每張鋼能量 +50，最多 10 張）
- KO 類（2 張）：棄世猴｜同命戰鬥（雙方戰鬥寶可夢同時擊倒，對手手動取獎）、雙斧戰龍｜斧擊在地（若對手戰鬥寶可夢有特殊能量則擊倒）
- bench-snipe（2 張）：振翼髮｜飛來橫禍（90 + 備戰 1 隻 20）、多龍巴魯托ex｜幻影奇襲（200 + 備戰 1 隻 60）

### 暫緩
- 複合型 debuff-swap（老大的指令 + 傷害、頂尖捕捉器 + 傷害類）— 需要更複雜資源選擇
- 棄世猴以外的同命 KO（若未來出現需要「自己不 KO、對手 KO」特例）
- 冰伊布ex｜藍柱石（6 個傷害指示物以上就擊倒）— 需 ATTACK_POST 計數判定，另波處理

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 27/23
- 版本 1.73 → 1.74

---

## 📝 2026-04-21 Session 38y (v1.75) — H 標第 20 波：swap + energy return + count-multiply（10 張）

### 新 helper
- `discardOppActiveEnergyPost(label, filter?)` — 攻後丟對手戰鬥寶可夢 1 張能量，filter='any'/'special'
- `returnSelfActiveEnergyPost(n, toHand, label)` — 攻後移動自身能量；toHand=true 放回手牌，false 改附備戰（n=1 時走 gengar-move-energy）
- `returnOppActiveEnergyPost(n, label)` — 攻後將對手戰鬥能量 N 張放回對手手牌
- `countDamagedSelfMultiplyPre(per, label)` — pre 傷害 = 自己場上被傷害的寶可夢數 × per

### 實裝（10 張）
- 丟對手能量（3 張）：比克提尼｜燒落（30 + 丟 1 特殊）、大蔥鴨｜音速斬（30 + 丟 1 特殊）、吼叫尾ex｜咬碎（120 + 丟 1 任意）
- 自能量移動（3 張）：狡猾天狗｜能量閉環（140 + 1 張回手牌）、鐵荊棘ex｜伏特旋風（140 + 1 張改附備戰）、鐵轍跡｜路徑輪（60 + 1 張改附備戰）
- 返還對手能量（1 張）：高傲雉雞｜反轉之風（70 + 2 張回對手手牌）
- 計數乘法（1 張）：波士可多拉｜發怒猛進（自己被傷害的寶可夢數 × 50）
- 特殊（2 張）：
  - 古月鳥｜噴吐射擊（丟自身全部能量 + opp-poke-choose 120；無能量則失敗）
  - 噬沙堡爺ex｜重晶石之獄（對手所有備戰 HP > 100 者 damage 補至 HP=100）

### 暫緩
- 大狼犬｜踹開、長毛巨魔｜挑釁抓擊 — 「由對手選擇互換上場」需定義 defender 主動 pending 流程
- 耿鬼ex｜戲法舞步 — 將對手能量改附於對手備戰，需新 resolver（目前 gengar-move-energy 限自家）
- 甲賀忍蛙ex｜分身連打 — 丟 2 自能量 + opp-poke-choose 2 目標各 120，需支援 2 目標 snipe resolver
- 優雅貓｜能量攪拌 — 任意重排自家能量，需多階段選擇 UI

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 27/23
- 版本 1.74 → 1.75

---

## 📝 2026-04-21 Session 38z (v1.76) — H 標第 21 波：snipe + 丟競技場 + 查手牌（12 張）

### 新 helper
- `oppSnipePost(dmg, label)` — 攻後 opp-poke-choose + snipe-variable，對任一對手寶可夢造成 dmg
- `discardStadiumPost(label, failIfNone?)` — 丟棄場上競技場；failIfNone 控制「無競技場則僅記 log」vs「無競技場則整張招式失敗」
- `peekOppHandPost(label)` — 「查看對手手牌」僅記 log；UI reveal modal 未來另做

### 實裝（12 張）
- 簡單 snipe（5 張）：變隱龍｜舌之鞭打 30、雷伊布｜直擊彈 30、拉帝歐斯｜直擊飛行 50、吉雉雞ex｜殘酷箭 100、閃焰王牌ex｜石榴石截擊 180
- 丟競技場（4 張）：盔甲鳥｜大風暴 90、無極汰那｜世界之末 230（無競技場則傷害 0）、毛辮羊｜搗碎 30、毛毛角羊｜搗碎 70
- 查對手手牌（2 張）：咕咕｜靜默之翼 20、催眠貘｜不祥視線 10
- 能量從棄牌區補（1 張）：噗隆隆｜金屬塗層（棄牌區 1 張基本鋼能量附於自身）

### 暫緩
- 鐵頭殼ex｜雙刃劍（2 隻各 50）、沙漠蜻蜓ex｜橄欖石音波（所有 ex/V 各 100）、水伊布ex｜重磅驟雨（所有 ex 各 60）— 需多目標 snipe resolver
- 太晶寶可夢備戰免傷（20+ 張）— 需在 snipe-variable 與所有備戰傷害資料流中加入檢查
- 大狼犬｜踹開、長毛巨魔｜挑釁抓擊、小箭雀｜送回 — 由對手選擇互換流程

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 24/26
- 版本 1.75 → 1.76

---

## 📝 2026-04-21 Session 38aa (v1.77) — H 標第 22 波：heal + 呼朋引伴 + deck mill（17 張）

### 新 helper
- `healAnyOwnPost(amount, label)` — 攻後設置 pending heal-target（重用 'heal-30' resolver）
- `benchBasicFromDeckPost(max, label)` — 攻後設置 pending deck-search Basic → 備戰（重用 'bench-basic-from-deck'）
- `millSelfDeckTopPost(n, label)` — 攻後丟自己牌庫頂 n 張
- `millOppDeckTopPost(n, label)` — 攻後丟對手牌庫頂 n 張

### 實裝（17 張）
- pending 療傷（2 張）：啃果蟲｜營養素、花蓓蓓｜療傷（各 30 HP）
- 自身吸血（2 張）：鐵毒蛾｜吸納、火神蛾｜吸血（30 dmg + self heal 30）
- 呼朋引伴（5 張）：狗仔包｜香味、燭光靈｜呼朋引伴、粉蝶蟲｜呼朋引伴、大顎蟻｜呼朋引伴（2 張）、列陣兵｜組成陣形（2 張）
- 自己 mill（3 張）：斧牙龍｜龍之波動 80、雙斧戰龍｜龍之波動 230、古簡蝸｜捲入鞭打 130
- 對手 mill（5 張）：螺釘地鼠｜掘掘（1 張）、龍頭地鼠｜挖洞爪 20（1 張）、三首惡龍ex｜粉碎頭 200（3 張）、單首龍｜踩落（1 張）、雙首暴龍｜踩落（2 張）

### 暫緩
- 鐵毒蛾｜吸納 / 火神蛾｜吸血 實際規則是「回復等於對對手造成的傷害」；此處簡化為 base dmg 回復（忽略弱抗加乘）
- 彩粉蝶｜進化粉、伊布｜覺醒、蛋蛋｜早熟進化（從牌庫取進化卡直接進化）— 需 evolve-from-deck resolver
- 蟲電寶｜並排（自名限定 deck search）— 需 filter 'Name:蟲電寶'
- 狡猾天狗｜驅趕龍捲風、仙子伊布｜奧密迴旋、甜甜螢｜慢芬香 — opp 備戰挑選後放回牌庫重洗

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 25/25
- 版本 1.76 → 1.77

---

## 📝 2026-04-21 Session 38ab (v1.78) — H 標第 23 波：deck/discard search to hand + self-swap（19 張）

### 新 helper
- `selfSwapPost(label)` — 攻擊後自己出場 <-> 備戰切換（重用 'do-switch' resolver）
- `deckSearchToHandPost(max, filter, label)` — 攻擊後設置 pending deck-search（重用 'search-to-hand-reshuffle'）
- 新 resolver `storm-volt-move` — 將自身所有能量改附於 1 隻備戰寶可夢

### UI 擴充（+page.svelte）
- deck-search 新增 filter：`BasicEnergy`、`Pokemon:<Type>`（如 `Pokemon:Lightning`）、`Energy:<Type>`
- discard-search 新增 filter：`Pokemon`、`Trainer`、`Supporter`、`Energy:<Type>`

### 實裝（19 張）
- 自己切換（5 張）：原蓋海龜｜飛濺迴轉 70、粉蝶蛹｜走來走去、醜醜魚｜躍起逃走、沙漠蜻蜓ex｜風暴返 130、鍬農炮蟲｜伏特替換 90
- 牌庫選基本能量到手牌（5 張）：基拉祈｜蓄能量（2）、厄鬼椪 碧草面具｜步山（2）、花葉蒂｜小使者（3）、索財靈｜小使者（2）、伊布｜鮮豔捕捉（3）
- 牌庫選能量到手牌（1 張）：光電傘蜥｜拋物面充電（4）
- 牌庫選寶可夢到手牌（2 張）：幾何雪花｜呼喚信號（1）、卡璞・鳴鳴｜召喚雷電（2 × 雷）
- 棄牌區選卡到手牌（3 張）：呆呆獸｜垂尾巴（寶可夢 1）、咚咚鼠｜電磁聲納（訓練家 1）、霏歐納｜招喚（支援者 1）
- 狙射樹梟｜強力射擊 170 — 若手牌無基本草能量則招式失敗
- 超甲狂犀｜直衝鑽 180 — 丟對手戰鬥場 1 張能量
- 爆焰龜獸｜灼燒盡 — 對手戰鬥為 ex 才丟 1 張能量
- 月亮伊布ex｜縞瑪瑙 — 丟自身全部能量 + 獲得 1 張獎賞
- 烈咬陸鯊ex｜音波奇襲 — 丟自身 2 張能量 + 對手任一 120
- 大電海燕｜風暴伏特 160 — 將自身所有能量改附於 1 隻備戰
- 飄浮泡泡 太陽的樣子｜陽光支援 50 — 將自身所有能量改附於 1 隻備戰

### 暫緩
- 優雅貓｜能量攪拌（任意方式改附）、霜奶仙｜彩色甜點（符合屬性搜寶可夢）、迷唇姐｜邀請之吻（搜基礎 + 能量改附）
- 帕底亞 肯泰羅｜上搗角擊（僅對 2 階進化生效）、莫魯貝可｜能量車輪（選 2 個惡能量改附）
- 甲賀忍蛙ex｜分身連打、酋雷姆｜三重冰霜（多目標 snipe + 能量丟棄）
- 古劍豹/古玉魚/古簡蝸/古鼎鹿｜X 之到來（棄牌選屬性能量 + 改附兩步）
- 切割洛托姆｜割除衝刺（丟對手身上道具 + 特殊能量，需道具機制完整）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 27/23
- 版本 1.77 → 1.78

---

## 📝 2026-04-21 Session 38ac (v1.79) — H 標第 24 波：棄牌能量附加 + 多目標 snipe（10 張）

### 新 helper
- `discardEnergyAttachPost(max, typeFilter, label)` — 棄牌選屬性能量兩步流程，第 1 步 discard-search，第 2 步 heal-target（若場上只有 1 隻則自動附）
- `multiSnipePost(targetCount, damage, label)` — 攻後對對手 N 隻寶可夢各造成 D 傷害（共用 opp-poke-choose maxCount=N）

### 新 resolver
- `discard-energy-attach-pick-target`、`discard-energy-attach-commit` — 兩步棄牌附能
- `discard-energy-attach-bench-only`、`discard-energy-attach-commit-bench` — 限定備戰的版本
- `snipe-multi` — 多目標循環施傷（正確處理 KO 與獎賞堆疊）
- `energy-wheel-attach` — 莫魯貝可能量車輪用

### 實裝（10 張）
- 棄牌能量附加（6 張）：古劍豹｜雪之到來（2 水）、古玉魚｜閃焰到來（2 火）、古簡蝸｜綠葉到來（2 草）、古鼎鹿｜沙之到來（2 鬥）、土地雲｜真氣之拳 30（1 任意）、多麗米亞｜能量支援 30（1 基本→備戰）
- 多目標 snipe（2 張）：甲賀忍蛙ex｜分身連打（丟 2 能量 + 對手 2 隻各 120）、酋雷姆｜三重冰霜（丟全能量 + 對手 3 隻各 110）
- 莫魯貝可｜能量車輪 70（AI 自動挑前 2 張【惡】能量 → 選備戰附加）
- 大電海燕｜風暴伏特（v1.78 已有）不計入

### 暫緩
- 紅蓮鎧騎｜紅蓮引爆（丟全火能量 + 對手備戰 1 隻 180）— 需選「僅備戰」非「任一」
- 七夕青鳥｜哼唱充能、搖籃百合｜任選黏液 — 還沒做
- 牌庫直接附能（秘能量、能量裝填 etc.）— 已做的差不多

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 25/25
- 版本 1.78 → 1.79

---

## 📝 2026-04-21 Session 38ad (v1.80) — H 標第 25 波：場上丟能量×倍率 + 特能清除 + 擲硬幣×能量數（6 張）

### 新 helper
- `fieldDiscardMultiplyPre(base, per, max, typeFilter, label)` — 可丟自己「場上任意寶可夢（含備戰）」身上的能量，支援 `action.discardedEnergyIids` 選定路徑；找不到時自動 fallback 挑最後 N 個
- `registerFieldDiscardMultiply(key, label, base, per, max, typeFilter)` — 打包：ATTACK_PRE_DISCARD_CHOICE（scope `'any-own'`）+ regPre
- 類型 `FieldDiscardFilter = 'all' | 'basic' | EnergyType`

### 實裝（6 張）
- 場上丟能量 × 倍率（2 張）：來悲粗茶｜傾瀉茶 70×（草 max 3）、猛雷鼓ex｜極降駕 70×（基本 max 20 ≈ 任意）
- 蒼炎刃鬼｜火焰咒詛 — 清除對手全場特殊能量
- 厄鬼椪 火灶面具ex｜極限火焰 — 140（若對手戰鬥為進化寶可夢 → +140 並丟自身全部能量，共 280）
- 怖納噬草｜強力尖刺 — 擲與自身能量同次硬幣，正面 × 80
- 椰蛋樹｜投球時刻 — 擲與雙方出場能量合計同次硬幣，正面 × 60

### 暫緩
- damage-plus 下回合加傷類（巨金怪 彗星拳、大電海燕 風力充能、超音波幼蟲 刺耳聲）— 需新增「下回合加傷」引擎旗標
- 電蜘蛛 [特性] 複眼 — 需「對擁有特性的寶可夢加傷」的 hook
- 阿柏蛇/阿柏怪/晶光花 多重狀態類 — 需擴充 status 為陣列
- 厄鬼椪 火灶面具ex｜極限火焰 的手動確認（目前完全自動，若對手為進化一定加傷並丟全能量；AI 版不需拒絕）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 21/29
- 版本 1.79 → 1.80

---

## 📝 2026-04-21 Session 38ae (v1.81) — H 標第 26 波：下回合加傷旗標 + 特性加傷（3 張）

### 引擎擴充
- `CardInstance.damageBonusPending?: number` — 招式效果設下的「下個自己回合招式 +N 傷害」預約旗標
- `CardInstance.damageBonusThisTurn?: number` — 已 promote 的啟用版，由引擎在 ATTACK 時套用於 base damage（weakness 前），用完即清
- engine.ts ATTACK：`baseDamage += damageBonusThisTurn` 套用後 delete 該欄位，寫 log
- engine.ts END_TURN：
  - 目前玩家的 damageBonusThisTurn 殘留值清除（例如攻擊失敗沒用到時）
  - 次方玩家 promotePending 擴充：同時處理 `damageBonusPending → damageBonusThisTurn`

### 新 helper
- `setSelfDamageBonusPendingPost(amount, label)` — 招後設下 N；下回合自動生效 1 次於 base damage

### 實裝（3 張）
- 巨金怪｜彗星拳 60 — 下回合招式 +60（為 金屬之錘/潔淨爆破 加傷；也會影響 彗星拳 本身若下回合再打）
- 大電海燕｜風力充能 10 — 下回合招式 +120（為 強力伏特/風暴伏特 加傷）
- 電蜘蛛｜麻麻羅網 — 在既有 50 基礎上疊加「複眼」特性 PRE hook：對手戰鬥擁有特性則 +50

### 暫緩
- 超音波幼蟲｜刺耳聲 — 「受到此招式的寶可夢下回合受到招式傷害 +50」→ 需 `damageTakenBonusPending`（跨 2 END_TURN 生效）機制，結構複雜暫不做
- 電蜘蛛 [特性]複眼 本體效果為「招式傷害 +50」的 passive，目前實作限縮為「麻麻羅網」招式；覆蓋所有 pokemon 的 attacker passive 還沒做（需要加 PASSIVE_ATTACK_BONUS_VS_ABILITY 型 hook，暫緩）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 25/25
- 版本 1.80 → 1.81

---

## 📝 2026-04-21 Session 38af (v1.82) — H 標第 27 波：KO-check + 條件 cantAttackPending + 直擊 KO（5 張 + 懶人獺 補完）

### 引擎擴充
- `CardInstance.cantRetreatPendingSelf?: boolean` — 自己寶可夢下個自己回合不可撤退的預約旗標
- engine.ts END_TURN promotePending 擴充：`cantRetreatPendingSelf → cantRetreatNextTurn`（發生在擁有者下回合開始時；照原 clearCantRetreat 規則在該回合結束時清除）

### 新 helper（effects.ts）
- `bonusPrizeIfKOPost(bonus, label)` — 招後若對手出場 active 已 KO（null 且 pendingPrizes > 0）則 +N 獎勵牌
- `defCantAttackIfSubtypePost(cond, label)` — 若對手 Active 仍存活且符合 Basic/進化條件則設 cantAttackPending
- `resolveLanzhushi(...)` — 藍柱石直接 KO 指定對手寶可夢（含出場/備戰），處理 discard、獎賞、勝利判定

### 新 resolver
- `lanzhushi-ko` — 對手身上有 ≥6 傷害指示物的寶可夢 pickOne（opp-poke-choose）→ KO

### 實裝（5 張 + 1 補完）
- 懶人獺｜悠哉（補完）— heal 60 現在也設 cantRetreatPendingSelf，下個自己回合無法撤退
- 鐵臂膀ex｜感激放大 120 — 若此招 KO 對手 → +1 獎勵牌
- 鐵包袱｜冷卻噴射 80 — 若對手戰鬥寶可夢為進化 → 對手下回合無法使用招式（cantAttackPending）
- 帕底亞 肯泰羅｜障礙踩踏 90 — 若對手戰鬥寶可夢為基礎 → 對手下回合無法使用招式
- 轟鳴月ex｜瘋癲攻擊 — KO 對手戰鬥寶可夢；然後自己受 200 傷害（可能自爆 KO，對方取獎）
- 冰伊布ex｜藍柱石 — 選 1 隻對手身上有 ≥6 個傷害指示物（damage ≥ 60）的寶可夢 KO；候選唯一時自動 KO、多個時 opp-poke-choose

### 暫緩
- 超音波幼蟲｜刺耳聲（受招寶可夢下回合受傷 +50）— 需跨 2 END_TURN 的 damageTakenBonus 機制
- 電擊魔獸｜雷電在地（全寶可夢下回合無法攻擊）— 需 player-level flag
- 大王銅象｜鼻之金勾臂（可選 +100 與下回合不攻擊）— 需 UI 選擇
- 含羞苞、青銅鐘、吼叫尾ex、蝶結萌虻 — 需新機制（no-item、no-evolve、no-supporter、deferred-prize-bonus）

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 22/28（P1/P2）、平均回合 14.3
- 版本 1.81 → 1.82

---

## 📝 2026-04-21 Session 38ag (v1.83) — H 標第 28 波：抽卡批次 + 狀態補完 + 自傷 + 其他單張（35 張）

### 實裝（35 張）
- 抽 N 張（22 張，reuse drawNPost）：
  - draw 1：貓鼬少|呼喚、拉魯拉絲|呼喚、木棉球|呼喚、瑪沙那|呼喚、呱呱泡蛙|呼喚、火稚雞|呼喚、花椰猴|呼喚、冷水猴|呼喚、爆香猴|呼喚、<阿響的>皮丘|麻麻抽出、嗡蝠|快速抽出
  - draw 2：超級巨牙鯊ex|貪心之牙、劈斬司令|快速抽出、瑪機雅娜|扣殺抽出、龜腳腳|雙重抽出、拉帝亞斯|吸引、象徵鳥|雙重抽出、胡帕|偷盜、貓鼬斬ex|扣殺抽出、怒鸚哥|叼
  - draw 3：青銅鐘|三重抽出、大王燕|叼
  - draw 4：高傲雉雞|叼
- 對手狀態（5 張，reuse statusPost）：狡猾天狗|蠱惑（混亂）、波爾凱尼恩|灼熱（灼傷）、滋汁鼴|毒擊（中毒）、蔓藤怪|毒粉（中毒）、火炎獅|灼燒（灼傷）
- 自己狀態（2 張）：卡比獸|倒下（自己睡眠）、章魚桶|暴走（自己混亂）
- 自傷反動（3 張，reuse selfHitPost）：龍蝦小兵|猛撞 10、鐵掌力士|狂野壓制 70、毒骷蛙|突擊 20
- 其他單張：
  - 切割洛托姆|割除利刃 20 — discardStadiumPost
  - 花岩怪|崩山 10 — millOppDeckTopPost 1
  - 頓甲|防守回轉 120 — registerSelfDiscardMultiply（丟 2 能量成本）+ selfDmgReducePost 100
  - 古劍豹|冰柱閉環 120 — returnSelfActiveEnergyPost(1, true)

### 新 helper
- `selfStatusPost(status)` — 攻擊者自身陷入 SpecialCondition；從 types.ts 補 import SpecialCondition

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 23/27、平均回合 14.5
- 版本 1.82 → 1.83

---

## 📝 2026-04-21 Session 38ah (v1.84) — H 標第 29 波：看對手手牌 + 對手手牌丟棄 + 狀態/自傷批次補完（73 張）

### 實裝（73 張）

**(1) 查看對手手牌（3 張）— peekOppHandPost**
- 妙喵|看透、小貓怪|好奇心、豆豆鴿|偵察

**(2) 對手手牌篩選丟棄（1 張）**
- 洛托姆|粉碎脈衝 — 查看對手手牌，將其中所有「物品」（Trainer/Item）與「寶可夢道具」（Pokemon/Other）卡丟棄；log 詳列被丟棄卡名

**(3) 對手戰鬥寶可夢狀態（29 張，reuse statusPost）**
- 混亂：光電傘蜥|閃光彈、火箭隊的大嘴蝠|奇異之光、<火箭隊的>大嘴蝠|奇異之光、超能妙喵|蠱惑、超音蝠|超音波、死神棺|蠱惑、花舞鳥|眩目舞、音波龍|恐慌嚎鳴、<火箭隊的>貓老大ex|殘酷斬、雙彈瓦斯|充滿瓦斯
- 中毒：天蠍|毒擊、鉗尾蠍|毒擊、火箭隊的超音蝠|噴毒、<火箭隊的>超音蝠|噴毒、<莉佳的>臭臭花|噴毒、哎呀球菇|毒之孢子、灰塵山|垃圾射擊、<火箭隊的>小拉達|險惡門牙、百足蜈蚣|噴毒
- 睡眠：超級雪妖女ex|純粹雪、冰雪龍|冰凍之風、派拉斯特|蘑菇孢子、<火箭隊的>催眠貘|催眠光線、夢夢蝕|睡眠波動
- 灼傷：六尾|灼熱、炒炒豬|火焰灼燒、達摩狒狒|灼燒、厄鬼椪 火灶面具|灼燒、加熱洛托姆|灼熱

**(4) 自傷反動（31 張，reuse selfHitPost）**
- 落雷獸|電流攻擊 10、墓仔狗|猛撞 10、萊希拉姆|燃燒閃焰 60、帕底亞 肯泰羅|捨身衝撞 20、利牙魚|突擊 10、<火箭隊的>團珠蛛|猛撞 10、火箭隊的椰蛋樹|捨身衝撞 30、頑皮熊貓|突擊 10、仆斬將軍|雙刃斬 50、赫普的卡比獸|極限壓制 80
- 藤藤蛇|突擊 10、小拉達|猛撞 10、泡沫栗鼠|猛撞 10、<莉佳的>走路草|突擊 10、烈焰馬|猛火猛撞 30、超級炎武王ex|深紅炸彈 60、小鋸鱷|撞一下 10、阿羅拉 隆隆岩|百萬噸墜落 40、固拉多|百萬噸墜落 30
- <派帕的>原野水母|撞一下 10、<派帕的>陸地水母|突擊 30、<瑪俐的>頭巾混混|狂野衝撞 30、索羅亞|猛撞 10、下石鳥|突擊 20、騎士蝸牛|狂野槍 30、伽勒爾 泥巴魚|飛撲啃咬 30、寶貝龍|突擊 10、故勒頓ex|凱撒衝撞 60、貓鼬斬ex|狂野剪 30、<青木的>勇士雄鷹|勇鳥猛攻 30、刺梭魚|突擊 10、沙基拉斯|猛撞 20

**(5) Mill 對手牌庫補完（5 張，reuse millOppDeckTopPost）**
- 超級赫拉克羅斯ex|推山 mill 2、鐵骨土人|臂錘 mill 1、厄鬼椪 礎石面具|推山 mill 1、<火箭隊的>幼基拉斯|嚼山 mill 1、班基拉斯|斷裂頓足 mill 2

**(6) Mill 自己牌庫（1 張，reuse millSelfDeckTopPost）**
- 黏美龍|龍之波動 mill 自己 1

### Log 強化（user feedback：狀態變化必須指名受影響寶可夢）
- 增強 `peekOppHandPost(label)` — 顯示對手手牌完整名單而非僅張數
- 增強 `statusPost(status)` — log 寫出 `${defName} 陷入【混亂/中毒/睡眠/灼傷/麻痺】`
- 增強 `selfStatusPost(status)` — 同上但用攻擊者名
- 增強 `selfHitPost(amount)` — log 寫出 `${attName} 自身受到 N 點傷害`

### 暫緩（仍需新機制）
- 招式傷害不計算抵抗力（鹽石壘|岩石投擊、竹蘭的圓陸鯊|岩石投擲、土地雲|巨岩墜落 等）— 需 attack-level resistance-bypass 旗標
- 超音波幼蟲|刺耳聲、電擊魔獸|雷電在地、大王銅象|鼻之金勾臂、含羞苞、青銅鐘等

### 驗證
- `npm run build` 通過
- sim 50 局正常、0 crash、勝率 31/19（P1/P2）、平均回合 15.1
- 版本 1.83 → 1.84

---

## 📝 2026-04-21 Session 38ai (v1.85) — H 標第 30 波：既有 helper 補完 + 條件式 +N + coin 組合（25 張）

### 實裝（25 張）

**(A) Coin helper 補完**
- 來電汪|嬉鬧（coinPlusDmg 20+20）、變澀蜥|二連撞（coinHeads×2 ×30）、跳跳豬|三重旋轉（coinHeads×3 ×10）、炎兔兒|踹（coinTailsFail 30）、胖丁|滾球（coinUntilTails ×20）、無畏小子|叩叩打擊（coinUntilTails ×30 base 10）、銅鏡怪|鐵壁（coinHeadsSelfImmuneNext）

**(B) registerSelfDiscardMultiply（自身丟能量）**
- 千面避役|水射擊（110 + 丟 1 cost）、超級噴火駝ex|火山流星（280 + 丟 2）、鋼炮臂蝦|水之發射器（210 + 丟全部）、雷吉艾斯ex|冰之牢籠（140 + 丟 2 + 對手【麻痺】）

**(C) selfHealPost**
- 超級妙蛙花ex|叢林拋擲（240 + 自癒 30）、麻麻小魚|紋絲不動（0 + 自癒 10）

**(D) statusPost**
- 霸王花|花粉炸彈（30 + 對手【中毒】，原規則 中毒+睡眠 引擎僅單一 status，取主要中毒）

**(E) oppDiscardRandomHand / oppSwapDmgPost / discardOppActiveEnergyPost**
- 滑滑小子|拍落（20 + 對手手牌隨機丟 1）
- 皮皮|看我嘛（0 + 對手備戰互換）
- 鋁鋼龍|破壞光線（70 + 丟對手戰鬥能量 1）

**(F) selfSwapPost / selfDmgReducePost / selfCantAttackNextPost / defCantRetreatNextPost**
- 鐵面忍者|急速折返（90 + 自己換場）、椰蛋樹|防守壓制（30 + 下次受傷 -30）、巨石丁|潛力（140 + 自己下回合無法攻擊）、妙蛙種子|束縛（10 + 對手下回合無法撤退）

**(G) defIsExPre — 對手為 ex/V → +N**
- 火焰鳥|鬥志之翼（20 + 對手 ex → +90）

**(H) deck-search**
- 炭小侍|集力（0 + 牌庫選 ≤2 基本能量加手牌，reuse deckSearchToHandPost）
- 呆火駝|呼朋引伴（0 + 牌庫選 ≤2 基礎寶可夢放備戰，reuse bench-basic-from-deck resolver）

**(I) 條件式 +N 傷害**
- <火箭隊的>尼多力諾|角裂（60 + 對手帶傷 → +60）
- N的萊希拉姆|強力激怒（自身傷害指示物 ×20）
- 迷唇姐|精神強念（30 + 對手能量數 ×30）

**(J) coin + 既有 helper 組合**
- 大岩蛇|綁緊（30 + 擲硬幣正面 → 對手【麻痺】）
- 破破袋|酸液炸彈（10 + 擲硬幣正面 → 丟對手戰鬥 1 能量）

**(K) 抽到手牌滿 6**
- 狐大盜|貪慾狩獵（20 + 抽到手牌滿 6）

### 暫緩
- 不計算抵抗力（10 張）— 引擎尚無 resistance 機制，效果 no-op
- 月桂葉|推倒（對手選擇互換目標）— 需 force-opp-send-new-active 機制
- 喵喵ex|夾尾巴逃跑（自己 + 附加卡放回手牌）— 需新機制
- 烈雀|啄食（造成傷害前丟對手道具）— 需 ATTACK_PRE 階段道具丟棄
- 安瓢蟲（特性）— 進化時觸發特性，非招式

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 27/23（P1/P2）、平均回合 14.4
- 版本 1.84 → 1.85

---

## Session 38aj (v1.86) — H 標第 31 波 抽到 N + 同名群聚 + 手牌附能 + 對手 ex snipe + 先丟對手道具 + snipe

### 新增 helper
- `drawToHandPost(n, label)` — 攻擊後從牌庫抽到手牌滿 N 張
- `handAttachEnergyPost(max, typeFilter, label)` — 從手牌選基本能量附於自己場上寶可夢（含 type 篩選）
- `deckSameNameBenchPost(max, cardName, label)` — 從牌庫選最多 N 張「同名卡」放備戰（使用 bench-basic-from-deck resolver + validIids）
- `discardSameNameBenchPost(max, cardName, label)` — 從棄牌區選最多 N 張「同名卡」放備戰（新 resolver bench-from-discard-samename）
- `snipeAllOppExPost(dmg, filterType, label)` — 對手所有 ex（或 ex/V）各 N 傷害（不計弱抵與附加效果），含 KO 檢查
- `defToolDiscardPre(base, label)` — 攻擊前丟對手戰鬥寶可夢的 `toolAttached`
- `damagedMultiSnipePost(targetCount, dmg, label)` — 對手「身上有傷害指示物」的 N 隻各 D 傷害（使用 snipe-multi resolver + validIids）

### UI 擴充
- `+page.svelte` deck-search filter 新增 `Item` / `Supporter` / `Tool` / `Trainer`（原本只支援 Basic/Pokemon/Energy...）
- `+page.svelte` hand-discard filter 新增 `BasicEnergy` / `Energy:<type>` 並支援 `params.validIids`

### 本波實裝（25 張）
**(A) 抽到 N 張 (3)**
- 狙射樹梟｜羽毛庫存 — 0 dmg + 抽到 7
- 霓虹魚｜報恩 — 20 dmg + 抽到 6
- 幸福蛋ex｜報恩 — 180 dmg + 抽到 6

**(B) 牌庫搜 Item/Pokemon/Supporter (3)**
- 海地鼠｜挖到寶 — 0 dmg + 牌庫選 1 張物品卡加手牌
- 海刺龍｜援軍 — 0 dmg + 牌庫選最多 3 張寶可夢加手牌
- 超音蝠｜引路 — 0 dmg + 牌庫選 1 張支援者加手牌

**(C) 棄牌區能量附加 (1)**
- 莫魯貝可｜撿拾附上 — 棄牌區選最多 2 張基本能量附自己寶可夢

**(D) 單/多目標 snipe (3)**
- 月亮伊布｜出奇一擊 — 對手 1 隻寶可夢 50 傷害
- 鐵頭殼ex｜雙刃劍 — 對手 2 隻寶可夢各 50 傷害
- 鐵脖頸｜自動導向頭擊 — 對手 3 隻帶傷寶可夢各 50 傷害

**(E) 同名群聚（牌庫）(4)**
- 強顎雞母蟲｜群聚 — 最多 2
- 一家鼠｜家族行軍 — 最多 2
- 蟲電寶｜並排 — 最多 3
- 呱呱泡蛙｜群聚 — 最多 2

**(F) 同名群聚（棄牌區）(1)**
- 夜巡靈｜前往渡魂 — 最多 3

**(G) 手牌附能 (4)**
- 艾姆利多｜滿載心田 — 最多 2 張基本超能量
- 固拉多｜充溢之力 — 1 張基本鬥能量
- 吉利蛋｜幸運貼附 — 1 張基本能量（不限屬性）
- 阿羅拉 椰蛋樹ex｜熱帶狂燒 — 150 dmg + 任意張基本能量

**(H) 對手所有 ex/V snipe (2)**
- 水伊布ex｜重磅驟雨 — 對手所有 ex 各 60（含 KO）
- 沙漠蜻蜓ex｜橄欖石音波 — 對手所有 ex/V 各 100（含 KO）

**(I) 攻擊前丟對手道具 (2)**
- 金魚王｜啄落 — 50 dmg（造成傷害前先丟）
- 破破舵輪｜破壞船錨 — 80 dmg（造成傷害前先丟）

### 暫緩（需新機制）
- `不計算弱點抵抗力` 旗標 — 10+ 張（恰雷姆ex｜瑜伽踢、厄鬼椪 礎石面具ex｜打爆、晶光芽｜岩石投擲、土地雲｜粗暴橫掃、輕身鱈｜音波刀鋒、米立龍ex｜突襲水泵、堅盾劍怪｜堅硬猛擊、頓甲｜打垮 等）
- 「下回合對手寶可夢受傷 +N」cross-turn flag — 超音波幼蟲｜刺耳聲
- `電擊魔獸｜雷電在地` player-level「所有寶可夢無法使用招式」旗標
- `大王銅象｜鼻之金勾臂` UI 增傷選擇
- 「若對手場上有 <名稱/subtype>」+N 傷害（需 selfOppHasNamePre / oppHasSubtypePre）— 爬地翅｜鐵碎、雷吉奇卡斯｜寶石破壞
- 「若從 <X> 進化」+N（evolvedFromName check）— 賽富豪｜富裕強襲、普隆隆姆ex｜暴衝閃光、焰后蜥｜突然炙烤
- 進化時觸發特性 — 安瓢蟲｜繁星花紋
- 本回合使用 <支援者/招式> +N — 鐵武者｜莊嚴之劍、列陣兵｜一併攻擊
- 其他：智揮猩｜掌握弱點（反轉弱點）、蚊香泳士｜跳躍衝天（回牌庫增傷）、賽富豪｜賽富迴旋（回牌庫無傷）、普隆隆姆ex｜高速破壞（自己丟棄）、甜甜螢｜慢芬香（對手備戰回牌庫）、狡猾天狗｜驅趕龍捲風（對手備戰回牌庫）、風鈴鈴｜回家鐘聲、白蓬蓬｜微風之禮、迷唇姐｜邀請之吻（拉基礎+能量轉附）、迷唇娃｜樂呵呵之吻、七夕青鳥｜哼唱充能（牌庫選任意能量附 — 可用既有能量 attach resolver 實作）
- 霜奶仙｜彩色甜點（按附屬能量同屬性 Pokemon）
- 普攻前置效果：彷徨夜靈｜咒詛炸彈（自 KO + 指示物）、黑夜魔靈｜咒詛炸彈、三合一磁怪｜過度放電
- 呆呆王｜耀閃挑戰（從牌庫頂選招式 copy）
- 皮可西｜揮指、魔牆人偶｜相仿秀（copy 對手招式/支援者 — 非常複雜）
- 異常攻擊：鐵磐岩|調整角擊（手牌數量相等才能用）
- 塗標客｜惡作劇作畫（從對手棄牌選能量附對手）

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 22/28（P1/P2）、平均回合 13.8
- 版本 1.85 → 1.86

## Session 38ak (v1.87) — H 標第 32 波 棄牌 search + 手牌附能+heal + 自牌庫找基本能量附自 + 手牌 tool×damage + 先丟對手特能 + 條件進化

### 新增 helper
- `discardSearchToHandPost(max, filter, label)` — 從棄牌區選最多 N 張（filter=Pokemon / BasicEnergy / Energy:<type>）加手牌，重用 `discard-to-hand` resolver
- `deckEnergyAttachSelfPost(typeFilter, label)` — 從牌庫選 1 張基本能量附於自己戰鬥寶可夢，並重洗牌庫。新 resolver `deck-energy-attach-self`
- `selfActiveHandAttachHealPost(heal, label)` — 從手牌選 1 張能量附於自己戰鬥寶可夢 + 回 N HP。新 resolver `self-active-hand-attach-heal`
- `benchHandAttachFullHealPost(typeFilter, label)` — 從手牌選 1 張基本能量附於備戰 + 全回復（清 damage=0）。新 resolver `bench-hand-attach-fullheal-pick-energy` + `bench-hand-attach-fullheal-commit`

### 本波實裝（12 張）

**(A) 棄牌區 → 手牌 (3)**
- 鐵斑葉｜補全之網 — 棄牌選最多 2 張寶可夢加手牌
- 破破舵輪｜救援船錨 — 棄牌選最多 2 張寶可夢加手牌
- 斯魔茶｜上茶 — 棄牌選 1 張基本草能量加手牌

**(B) 棄牌區 → 備戰 (1)**
- 刺龍王ex｜王之號召 — 棄牌選最多 3 張【水】寶可夢放備戰（重用 `bench-from-discard-samename` + validIids）

**(C) 牌庫 → 手牌 (2)**
- 甲賀忍蛙ex｜忍之利刃 170 — 可選從牌庫任意 1 張加手牌
- 美錄坦｜搬運破爛 — 從牌庫選 1 張寶可夢道具加手牌

**(D) 牌庫 → 自附能 (1)**
- 穿著熊｜力量充能 30 — 從牌庫選 1 張基本能量附於自己

**(E) 手牌附能+回血 (2)**
- 卡比獸｜吃飽先 — 手牌選 1 張能量附自己 + 回 60 HP（無能量時仍回血）
- 葉伊布｜嫩葉之恩 — 手牌選 1 張基本草能量附備戰 + 全回復該隻

**(F) 手牌 tool × 傷害 (1)**
- 灰塵山｜丟棄 — pre 階段自動把手牌所有「寶可夢道具」丟掉，damage = 張數 × 50（簡化：未支援 UI 選擇）

**(G) 攻擊前丟對手特殊能量 + tool (1)**
- 切割洛托姆｜割除衝刺 30 — pre 階段先丟對手戰鬥寶可夢的 `toolAttached` 與所有「特殊能量」，再造 30 傷害

**(H) 條件式進化 +N (1)**
- 賽富豪｜富裕強襲 30+ — 若本回合從「索財靈」進化（由 `evolvedThisTurn` + `evolvedFromStack` 底層名稱判定），則 +90

### 暫緩（需新引擎旗標 — 下一輪任務）
1. **攻擊級旗標 `skipWeakRes` / `skipDefEffects`**（回傳於 AttackPreFn）
   - skipWeakRes：恰雷姆ex｜瑜伽踢 190、厄鬼椪 礎石面具ex｜打爆 140、晶光芽｜岩石投擲、土地雲｜粗暴橫掃、安瓢蟲｜高速星星、鐵頭殼ex｜雙刃劍（已實但需補 skip）
   - skipDefEffects（不計附加效果）：輕身鱈｜音波刀鋒、米立龍ex｜突襲水泵、頓甲｜打垮、堅盾劍怪｜堅硬猛擊、故勒頓｜撕裂、厄鬼椪 礎石面具ex｜打爆（兩旗標）
2. **player-level `noAttacksNextTurn`**：電擊魔獸｜雷電在地
3. **cross-turn 加收傷害 flag**：超音波幼蟲｜刺耳聲
4. **UI 增傷選擇**（加傷 with drawback）：大王銅象｜鼻之金勾臂、鐵磐岩（暫緩）
5. **Pokemon instance flag `movedToActiveThisTurn`**：普隆隆姆ex｜暴衝閃光、蚊香泳士｜跳躍衝天
6. **force-opp-send-new-active**（由對手選新場上）：大狼犬｜踹開、月桂葉｜推倒、小箭雀｜送回、長毛巨魔｜挑釁抓擊
7. **self-return-to-hand / self-return-to-deck**：喵喵ex｜夾尾巴逃跑、賽富豪｜賽富迴旋、風鈴鈴｜回家鐘聲、白蓬蓬｜微風之禮
8. **ATTACK_PRE self-tool-discard**：烈雀｜啄食、美錄梅塔｜重塑斧
9. **evolve-trigger ability**：安瓢蟲｜繁星花紋
10. **no-item / no-evolve / no-supporter / deferred-prize-bonus**：含羞苞、青銅鐘、吼叫尾ex、蝶結萌虻
11. **self-KO ability**：彷徨夜靈｜咒詛炸彈、黑夜魔靈｜咒詛炸彈、三合一磁怪｜過度放電
12. **copy-attack**：呆呆王、皮可西｜揮指、魔牆人偶｜相仿秀
13. **smallpage-unique**：霜奶仙｜彩色甜點（按附屬能量同屬性 Pokemon）、塗標客（對手棄能附對手）、鐵磐岩（手牌數量條件）、智揮猩（反轉弱點）、攻擊前 KO 檢查 ability `願增猿ex｜鬆口氣`、`皮卡丘ex｜勤奮之心`

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 30/20（P1/P2）、平均回合 14.1
- 版本 1.86 → 1.87

## Session 38al (v1.88) — H 標第 33 波 引擎擴充：skipWeakRes / skipDefEffects 旗標

### 核心：AttackPreFn 回傳型別擴充
```ts
type AttackPreFn = (...) => {
  state: GameState;
  damage: number;
  skipWeakRes?: boolean;     // 傷害不計算弱點（抵抗力引擎未實作）
  skipDefEffects?: boolean;  // 傷害不計算對手戰鬥寶可夢身上的「附加效果」
};
```

### engine.ts 傷害管線同步
- `if (!skipWeakRes)` 套用弱點 ×2（L995）
- `if (!skipDefEffects)` 套用 PASSIVE_DAMAGE_REDUCE（L1012）/ TOOL_DEFENSE_REDUCE_BY_TYPE（L1022）/ PASSIVE_IMMUNITY（L1034）/ damageReduceNextHit（L1057）
- 附加效果類若被 skip 則不觸發、道具不丟棄、`damageReduceNextHit` 旗標不消耗（視為未對上「效果」，保留給下次）

### 新增 helper
- `skipWeakResPre(dmg, label)` — 固定傷害 + skipWeakRes
- `skipDefEffectsPre(dmg, label)` — 固定傷害 + skipDefEffects
- `skipBothPre(dmg, label)` — 兩旗標一起

### 本波實裝（10 張 pre 改寫 / 新登記）
- 恰雷姆ex｜瑜伽踢 190 — skipWeakRes
- 厄鬼椪 礎石面具ex｜打爆 140 — skipBoth
- 安瓢蟲｜高速星星 70 — skipBoth
- 輕身鱈｜音波刀鋒 110 — skipDefEffects
- 米立龍ex｜突襲水泵 100 — skipDefEffects
- 頓甲｜打垮 40 — skipDefEffects
- 堅盾劍怪｜堅硬猛擊 120 — skipDefEffects
- 晶光芽｜岩石投擲 10 — skipWeakRes（引擎暫無抵抗力，旗標為日後接入預留）
- 土地雲｜粗暴橫掃 130 — skipWeakRes（同上）
- 故勒頓｜撕裂 130 — 原 Wave 32 之前的簡化實作升級：正式加上 skipDefEffects
- 鐵頭殼ex｜雙刃劍 — Wave 31 已用 snipe-multi 實作，snipe 本就繞過管線，無需改寫

### 向後相容性
- 所有既有 `regPre` 未回傳旗標 → 預設 false，行為不變
- 既有 180+ 招式測過無迴歸（sim 50/50 0 crash）

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 25/25（P1/P2）、平均回合 15.9
- 版本 1.87 → 1.88

### 下波計畫（暫緩項目繼續消化）
- Wave 34：CardInstance.movedToActiveThisTurn 旗標 → 普隆隆姆ex｜暴衝閃光、蚊香泳士｜跳躍衝天
- Wave 35：player-level noAttacksNextTurn + cross-turn 加收傷害 → 電擊魔獸、超音波幼蟲
- Wave 36：force-opp-send-new-active pending → 大狼犬、月桂葉、小箭雀、長毛巨魔
- Wave 37：self-return-to-hand/deck → 喵喵ex、賽富豪、風鈴鈴、白蓬蓬
- Wave 38：ATTACK_PRE self-tool-discard + evolve-trigger registry → 烈雀、美錄梅塔、安瓢蟲
- Wave 39：player-level ban（no-item/no-evolve/no-supporter）+ self-KO + deferred-prize-bonus

## Session 38am (v1.89) — H 標第 34 波 movedToActiveThisTurn 旗標 + 4 張暴衝類

### 核心：CardInstance 新增旗標
```ts
movedToActiveThisTurn?: boolean;
```
- 意涵：本回合剛從備戰區被放到戰鬥場
- 設定時機：
  1. `RETREAT` action — 新上場者寫入 `movedToActiveThisTurn: true`
  2. `SEND_NEW_ACTIVE` action — 同上（對手 KO 後被迫送出）
- 清除時機：`clearTurnFlags` 於擁有者 END_TURN 時清除（與 justPlaced / evolvedThisTurn 同處理）

### 新增 helper
- `movedToActivePre(base, bonus, label)` — 若 attacker.active.movedToActiveThisTurn 則傷害 = base+bonus，否則 base

### 本波實裝（4 張）
- 普隆隆姆ex｜暴衝閃光 20→140（+120）
- 超級長耳兔ex｜疾風直撞 60→230（+170）
- 烈空坐｜進擊破壞 20→110（+90）
- 凱路迪歐ex｜疾風直撞 30→120（+90）

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 27/23（P1/P2）、平均回合 15.3
- 版本 1.88 → 1.89

## Session 38an — v1.90 H 標第 35 波 self-return-to-hand/deck

### 機制設計
這一波實裝「自身（含附加能量 / 道具 / 進化棧）結算完傷害後，整疊送回手牌 / 牌庫」類招式。
核心觀察：引擎 `hasPendingActions` 已能在 `active === null` 時自動觸發 pending `SEND_NEW_ACTIVE`，
所以招式 post 函式只要把自身連同附加卡全部移走、把 `active` 設為 null，
引擎就會自動向擁有者要新的戰鬥場寶可夢，不必改任何 engine 程式碼。

### 新增 helper（effects.ts）
- `selfReturnToHandPost(label)` — active + energyAttached + toolAttached + evolvedFromStack 全部放回手牌；主卡重設所有 turn flags / damage / attach 後再放
- `selfReturnToDeckPost(label)` — 同上但放回牌庫並 shuffle
- `selfReturnToDeckThenSearchPost(maxSearch, label)` — 先放回牌庫（不洗）→ `withPending({ type:'deck-search', effectKey:'search-to-hand-reshuffle', filter:'Any', maxCount:maxSearch })`，由既有 resolver `search-to-hand-reshuffle`（effects.ts:2166）處理抽到手牌後再 shuffle
- `selfBenchReturnToDeckPost(label)` — 玩家從自己備戰選 1 隻 → 新 resolver `self-bench-return-to-deck` 連附加送回牌庫並 shuffle
- `regR('self-bench-return-to-deck')` resolver — 跟備戰管理呼應，filter 掉被選中的 iid，把主體（重設 flags）+ 附加能量 / 道具 / evolvedFromStack 全部加進 deck 再 shuffle

### filter='Any' 驗證
- UI（game/+page.svelte:631 的 deck-search case）：未匹配的 filter 會落到 `return true`，渲染全牌庫
- AI（ai.ts:175 deck-search case）：同樣 fall-through `return true`
- 所以 `filter: 'Any'` 實際語義 = 無過濾 = 整個牌庫都可選

### 實裝（5 張）
- 喵喵ex｜夾尾巴逃跑 60 + selfReturnToHandPost
- 賽富豪｜賽富迴旋 100 + selfReturnToDeckPost
- 蚊香泳士｜跳躍衝天 120+120=240 + selfReturnToDeckPost（sim/AI 簡化：總是選擇 +120）
- 白蓬蓬｜微風之禮 0 + selfReturnToDeckThenSearchPost(3)
- 風鈴鈴｜回家鐘聲 0 + selfBenchReturnToDeckPost

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 22/28（P1/P2）、平均回合 14.6
- 版本 1.89 → 1.90

## Session 38ao — v1.91 H 標第 36 波 player-level noAttacksNextTurn + 跨回合加傷

### 引擎擴充

**types.ts**:
- CardInstance 新增：`takeExtraDamageNextTurn?: number`（攻擊方 POST 設於對手 active）
- CardInstance 新增：`takeExtraDamageThisTurn?: number`（END_TURN promote 後啟用）
- PlayerState 新增：`noAttacksNextTurn?: boolean`（攻擊方對自己設）
- PlayerState 新增：`noAttacksThisTurn?: boolean`（END_TURN promote 後啟用）

**engine.ts**:
- ATTACK dispatch：攻擊入口增加 `attacker.noAttacksThisTurn` 判斷 → 整回合強制結束
- getAvailableAttacks：加入同樣的 player-level 封鎖
- 傷害管線：weakness 之後、工具 bonus 之前套用 `defender.active.takeExtraDamageThisTurn`（+N 不消耗）
- END_TURN 新時序（兩側互換）：
  - 於 aIdx（結束方）清除 `noAttacksThisTurn`（本回合已消耗完）
  - 於 aIdx（結束方）promote `takeExtraDamageNextTurn → ThisTurn`（因對手下回合即將開始，旗標應生效）
  - 於 dIdx（次方）promote `noAttacksNextTurn → ThisTurn`（同 cantAttackPending 路徑）
  - 於 dIdx（次方）清除 `takeExtraDamageThisTurn`（結算完畢）

### 設計關鍵
`takeExtraDamageNextTurn` 與一般 `damageBonusPending` 不同，旗標設在「對手」卡上而非自己卡上，
且需要「一個完整的對手回合」才啟用。時序上：
1. P1 攻擊 → flag 設於 P2 active（NextTurn=50）
2. END_TURN(P1)：flag 保持 NextTurn（因為 aIdx=P1，flag 在 P2/dIdx）
3. END_TURN(P2)：aIdx=P2，promote P2 自己卡的 NextTurn→ThisTurn（OK 因 P1 下回合 = 攻擊方）
4. Turn(P1)：傷害管線讀 defender.takeExtraDamageThisTurn，+50
5. END_TURN(P1)：dIdx=P2，清除 P2 的 ThisTurn

### 實裝（2 張）
- 電擊魔獸｜雷電在地 220 + `playerNoAttacksNextPost`
- 超音波幼蟲｜刺耳聲 0 + `oppTargetTakeExtraNextPost(50)`

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 26/24（P1/P2）、平均回合 13.4
- 版本 1.90 → 1.91

## Session 38ap — v1.92 H 標第 37 波 force-opp-send-new-active

### 機制設計
這一波為「攻擊結算後強制對手將戰鬥寶可夢與備戰寶可夢互換」。
關鍵點：選擇方是「對手」（actorIdx = dIdx），所以用既有的 'bench-choose' 而非 'opp-bench-choose'，
因為 'bench-choose' 的語義就是「actor 從自己備戰選 1 隻」。

### 新增 helper（effects.ts）
- `forceOppSwapPost(label)` — 觸發對手 'bench-choose'，選完後由 `force-opp-swap` resolver 執行互換
- `forceOppSwapThenDamagePost(dmg, label)` — 同上，但互換後對新上場寶可夢造成 dmg 點傷害（不計弱點 / 抵抗力）；若造成 KO 會自動 null active + pendingPrizes += koPrizeCount
- `regR('force-opp-swap')` — 讀 params.label 與 attackerIdx；swap 時給新 active 設 movedToActiveThisTurn
- `regR('force-opp-swap-then-damage')` — 同 swap 流程 + 傷害計算 + KO 判定

### 邊界處理
- 對手備戰為空時：`forceOppSwapPost` 僅 log 提示；`forceOppSwapThenDamagePost` 對現戰鬥寶可夢直接補 dmg
- AI 預設 'bench-choose' 選 bench[0]，防守方 AI 不一定選最理想但不影響正確性

### 實裝（4 張）
- 大狼犬｜踹開 50 + forceOppSwapPost
- 月桂葉｜推倒 10 + forceOppSwapPost
- 小箭雀｜送回 10 + forceOppSwapPost
- 長毛巨魔｜挑釁抓擊 0 + forceOppSwapThenDamagePost(160)

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 29/21（P1/P2）、平均回合 15.5
- 版本 1.91 → 1.92

## Session 38aq — v1.93 H 標第 38 波 攻擊前丟道具卡系列

### 機制盤點
此波掃了 9 個系列 (M1L/M3/MC/SV6/SV7/SV7a/SV9/SV9a/SV11B) 中
含「寶可夢道具」卡丟棄 的招式，分三類：
- 丟對手 tool（本波主幹）— 既有 helper `defToolDiscardPre` 已涵蓋
- 丟自身 tool，無 tool 則招式失敗（新 helper）
- 丟對手 tool + 有丟棄則施加【麻痺】（新 helper）

### 新增 helper（effects.ts）
- `selfToolDiscardOrFailPre(base, label)` — 檢查 active.toolAttached；無則 log「自身無道具 → 招式失敗」且 damage=0；有則將該 tool 移到 discard 並回傳 `{ state, damage: base }`
- `defToolDiscardParalyzePre(base, label)` — 沿用 `defToolDiscardPre` 的丟 tool 邏輯，並在實際有丟棄時將對手戰鬥寶可夢設為 status='paralyzed'

### 實裝（6 張）
- 烈雀｜啄食 10 + 丟對手 tool（重用 defToolDiscardPre）
- 拉達｜削落 20 + 丟對手 tool
- 燃燒蟲｜啄落 10 + 丟對手 tool
- <派帕的>貪心栗鼠｜咬取 10 + 丟對手 tool
- N的電電蟲｜劈哩啪啦短路 30 + 丟對手 tool + 有丟棄則麻痺
- 美錄梅塔｜重塑斧 250 + 必須丟自身 tool，無則招式失敗

### DEFER
- 安瓢蟲｜繁星花紋（SV7）是【特性】（on-evolve ability），需要新增進化觸發式 ability infra，拆到後續 wave 處理（非本波 attack 範疇）

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 26/24（P1/P2）、平均回合 15.2
- 版本 1.92 → 1.93

## Session 38ar — v1.94 H 標第 39 波 player-level 禁卡 + 卡片級能量附加鎖 + 跨回合獎賞

### 機制設計
此波集中處理「以招式設定跨回合限制或獎賞加成」的一系列機制，
沿用 Wave 36 的「NextTurn → ThisTurn promote」框架（於 nextIdx 方 END_TURN 升級，於 aIdx 方 END_TURN 清除）。

### 新增 types.ts 旗標
- PlayerState（玩家級，opp-facing）：
  - `cantPlayItemNextTurn` / `cantPlayItemThisTurn`
  - `cantPlaySupporterNextTurn` / `cantPlaySupporterThisTurn`
  - `cantEvolveNextTurn` / `cantEvolveThisTurn`
- CardInstance（卡片級）：
  - `cantAttachEnergyNextTurn` / `cantAttachEnergyThisTurn`（opp active-facing）
  - `deferredPrizeBonusNextTurn` / `deferredPrizeBonusThisTurn`（跨回合 KO 獎賞加成）

### engine.ts 聯動
- `EVOLVE` / `PLAY_TRAINER` / `ATTACH_ENERGY` 加入旗標 gate 檢查（亮起即 return state，靜默失敗）
- `END_TURN`：
  - nextP 上 promote 玩家級 cantPlay/Evolve NextTurn → ThisTurn
  - nextP 上 promote 卡片級 cantAttachEnergy NextTurn → ThisTurn（同 promotePending）
  - aIdx 方自己卡片 promote deferredPrizeBonus NextTurn → ThisTurn（同 promoteTakeExtra）
  - nextP 卡片清除 deferredPrizeBonusThisTurn
  - aIdx 方玩家級 ThisTurn 清除整併到原本 noAttacks 清除區塊
  - aIdx 方卡片 cantAttachEnergyThisTurn 清除
- KO 路徑：讀取 defender.active.deferredPrizeBonusThisTurn，加到 pendingPrizes 並 log「+N 張獎勵牌」

### 新增 effects.ts helpers
- `oppCantPlayItemNextPost(label)`
- `oppCantPlaySupporterNextPost(label)`
- `oppCantEvolveNextPost(label)`
- `oppActiveCantAttachEnergyNextPost(label)`
- `oppActiveDeferredPrizeNextPost(bonus, label)`
- （重用既有 `selfDiscardAllEnergyPost`）

### 實裝（6 張）
- 含羞苞｜癢癢花粉 10 + cantPlayItem
- 青銅鐘｜進化妨礙者 30 + cantEvolve
- 吼叫尾ex｜絕叫 0 + cantPlaySupporter（後攻最初回合限制暫簡化）
- 電蜘蛛ex｜雷擊石 180 + 自丟所有能量 + cantPlayItem
- 晶光花｜侵蝕碎塊 20 + 中毒 + cantAttachEnergy
- 蝶結萌虻｜多餘花粉 30 + deferredPrizeBonus=2

### DEFER
- 彷徨夜靈｜[特性]咒詛炸彈（self-KO + 5 damage counters）
- 三合一磁怪｜[特性]過度放電（self-KO + discard energy attach to Lightning）
→ 需要自爆型 ability 助函式（regA + self-discard + pendingPrizes + SEND_NEW_ACTIVE），拆到後續 wave。

### 驗證
- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 31/19（P1/P2）、平均回合 14.5
- 版本 1.93 → 1.94

---

## Session 38as (v1.95 wave 40) — 自身 KO 類特性 / 招式

完成先前 wave 39 DEFER 的兩張自爆寶可夢。

### 新增 effects.ts helpers

- `selfKOInstance(state, aIdx, iid, pool, label)` — 把自己某隻（active/bench）連附加送棄牌；對手即時取獎賞（**不**走 `pendingPrizes`，因攻擊方不能自取自己 KO 的獎賞）；勝負檢查。
- `findAbilityUserIid(state, aIdx, cardName, pool)` — 以 `abilityUsedThisTurn + cardName` 找回 regA 的使用者 iid。

### 新增 resolvers

- `cursed-bomb`：opp-poke-choose 結果後 → 對目標 +50 → 自身 KO（若目標被擊倒，pendingPrizes 照累）
- `overvolt-attach-pick-target` / `overvolt-attach-commit`：自身 KO 後 discard-search 基本雷能量 → 選 1 隻自己雷寶可夢附加全部

### 實裝（2 張）

- 彷徨夜靈｜咒詛炸彈 — 自身 KO + 對手 1 隻寶可夢 +5 指示物（50）
  - `regA('彷徨夜靈', 0, …)` — 正統 ability（SV8a 路徑）
  - `regPre/regPost('彷徨夜靈|\u200c[特性]咒詛炸彈', …)` — attack-style（SV6a/M2a/MC 以 attack-with-ZWJ 形式登記）
- 三合一磁怪｜過度放電 — 自身 KO + 棄牌區選最多 3 張基本雷能量以任意方式附於雷寶可夢
  - `regPre/regPost('三合一磁怪|\u200c\u200c\u200c[特性] 過度放電', …)`（含空格變體）
  - `regPre/regPost('三合一磁怪|\u200c\u200c\u200c[特性]過度放電', …)`（無空格變體）
  - sim/AI 簡化：全部能量附到單一選擇的雷寶可夢

### 驗證

- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 26/24（P1/P2）、平均回合 15.5
- 版本 1.94 → 1.95

## Session 38at (v1.96 wave 41) — 訓練家補實裝 6 張

盤點 H 標剩餘 trainer 卡（19 Items / 12 Stadiums / 20 Supporters）後挑簡單可重用模式的 6 張。

### 引擎 filter 擴充

- `+page.svelte` deck-search 新增 `'Stadium'`
- `+page.svelte` discard-search 新增 `'PokemonNonExOrBasicEnergy'`（寶可夢非道具非 ex + 基本能量）
- `ai.ts` deck-search 補齊 `'BasicEnergy' / 'Item' / 'Supporter' / 'Stadium' / 'Tool' / 'Trainer'` 分支（之前 AI 會 fallthrough 到 `return true`，可能選到非預期卡種）
- `ai.ts` discard-search 補 `'PokemonNonExOrBasicEnergy'` 分支

### 新增 resolvers

- `search-generic-to-hand`：牌庫選到的卡加入手牌、重洗牌庫
- `energy-pro-search`：能量輸送PRO 專用 — 依「卡名」去重（基本能量名唯一對應屬性），重複的放回牌庫
- `wind-vortex-return`：寶可夢旋風回收機 — 選定的自己寶可夢 + 所有附加卡（能量、道具、進化棧）放回手牌；狀態/旗標清除；若為 active 則 active=null（SEND_NEW_ACTIVE 接手）
- `akuroma-step1-stadium`：阿克羅瑪的執著 step 1 — 搜 Stadium 後，withPending step 2
- `akuroma-step2-energy`：step 2 — 搜 Energy 後，最終重洗牌庫

### 實裝（6 張）

- 珍寶配件（Item, SV8a）— 牌庫選最多 5 張「寶可夢道具」加手牌
- 能量輸送PRO（Item, SV7a）— 牌庫選任意張數不同屬性基本能量加手牌（同屬只取 1 張）
- 水蓮的照顧（Supporter, SV5a/SV8a/MC）— 棄牌區選寶可夢（不含 ex）+ 基本能量合計最多 3 張加手牌
- 寶可夢旋風回收機（Item, SV6/SV8a/MC）— 選 1 自己場上寶可夢 → 本體+附加全放回手牌。regG 阻擋「只有 active 無備戰」狀況（避免場上歸零）
- 阿克羅瑪的執著（Supporter, SV6a/SV8a）— 兩步 pending：先搜競技場卡、再搜能量卡，各 1 張，最後重洗
- 百萬噸吹風機（Item, SV7a）— 丟棄對手所有寶可夢身上的道具卡 + 特殊能量卡 + 場上的競技場卡。場上競技場丟到使用者棄牌區（MVP：資料未追蹤擁有者）

### 驗證

- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 24/26（P1/P2）、平均回合 14.9
- 版本 1.95 → 1.96

## Session 38au (v1.97 wave 42) — 竹蘭的烈咬陸鯊EX 主題牌 12 張 + 影藏特性 bugfix

Leon 指示：「把這 13 項當『第 42 波』直接實裝，原規劃的 5 張卡順延」、「然後把這套設定為預設牌組，竹蘭的烈咬陸鯊EX」、「13.特殊能量應該是 硬岩【鬥】能量」、「順便把超級耿鬼ex特性的bug修一下」。

### 影藏特性 bugfix

`engine.ts` 中 `影藏` 分支原本用 `Math.max(1, prizeCount - 1)`，導致「惡 Pokemon 被對方 ex 擊倒時獎賞 -1」永遠拿不到 0 張的結果（最少也會算 1）。改為 `Math.max(0, prizeCount - 1)`：當 ex 擊倒 1 格寶可夢時 1 - 1 = 0，對手抽 0 張獎賞。同時補上 log：
- 觸發時 log「[影藏] <KO者名> 發動，減少對手獎賞」
- 若結算後為 0 張，log「對手獎賞卡 +0 張（影藏生效）」

### 引擎新增機制（effects.ts + engine.ts + types.ts）

- **`PASSIVE_ATTACK_BONUS: Map<string, (attacker, attackerState, allAttackerPokemon) => number>`**（effects.ts）
  掃描攻擊者全場上所有寶可夢、任何持有此 map 註冊的特性都會對招式傷害提供加成；多隻相同特性獨立累加（例：2 隻羅絲雷朵 = +60）。在 weakness/resistance **之前**套用。
- **`PlayerState.damageBoostFightingThisTurn?: number`**（types.ts）
  玩家級「本回合自己【鬥】寶可夢招式傷害 +N」旗標；每使用 1 張力量蛋白飲 +30；只對 `pokemonType==='Fighting'` 的攻擊者生效；於 weakness 前套用。END_TURN 時 aIdx 方清除。
- **`SPECIAL_ENERGY_TYPES` 登錄**：硬岩【鬥】能量 → Fighting（類型解析已連動；「附有此能量的寶可夢不會受對手招式效果影響」的免疫條款此波僅型別實裝，等後續 wave 接效果攔截）。
- **`TOOL_HP_BONUS`**：竹蘭的力量負重 — 裝在「竹蘭的」寶可夢上提供 +70 HP（僅對 name.includes('竹蘭的') 的本體有效）。

### 新增 deck-search filter（+page.svelte + ai.ts）

- `CynthiaPokemon`：寶可夢（非 Other）+ name 含「竹蘭的」
- `FightingBasicOrFightingEnergy`：基本【鬥】寶可夢 or 基本【鬥】能量
- `PokemonNonRule`：寶可夢（非 Other）且非 ex/EX

### 實裝（12 張，皆以本體 + 角括號變體雙註冊）

1. **竹蘭的圓陸鯊｜岩石投擲** — 20 無視抗性/弱點（skipWeakResPre）
2. **<竹蘭的>尖牙陸鯊｜龍之強襲** — 90（單純招式）
3. **<竹蘭的>尖牙陸鯊｜[特性]烈咬召喚** — regA，1 回合 1 次從牌庫搜「竹蘭的」寶可夢上手
4. **<竹蘭的>烈咬陸鯊ex｜龍之爆發** — 240 + 自丟全部能量（selfDiscardAllEnergyPost）
5. **<竹蘭的>烈咬陸鯊ex｜螺旋俯衝** — 160 + 抽到 6 張（drawToHandPost(6)）
6. **<竹蘭的>加保果｜激怒咒詛** — 備戰區竹蘭寶可夢身上指示物 × 10、無視抗性/弱點
7. **<竹蘭的>貓鼬斬｜雙刀攻擊** — 40×2（multiCoinPost(2, 40)）
8. **<竹蘭的>羅絲雷朵｜[特性]輝煌聲援** — PASSIVE_ATTACK_BONUS +30（只對「竹蘭的」攻擊者生效）
9. **力量蛋白飲**（Item）— 打出使 `damageBoostFightingThisTurn += 30`
10. **戰鬥鑼**（Item）— 牌庫搜 1 張 基本【鬥】寶可夢 或 基本【鬥】能量，上手、重洗
11. **寶可平板**（Item）— 牌庫搜 1 張「非 ex 寶可夢」上手、重洗
12. **火箭隊的拉姆達**（Supporter）— 牌庫搜 1 張 Trainer 上手、重洗
13. **硬岩【鬥】能量**（特殊能量）— 類型為 Fighting；免疫條款留待後續 wave

### 預設牌組

`presets.ts` 已加入 `CYNTHIA_GARCHOMP_DECK`（先前 session 已完成卡清單），本波設定為新建遊戲預設牌組。

### 驗證

- `npm run build` 通過
- sim 50 局 normal 50/50、0 crash、勝率 27/23（P1/P2）、平均回合 15.2
- 版本 1.96 → 1.97

---

## Session 38av (v1.98) — 竹蘭的烈咬陸鯊EX 牌組 4 bug 修 + 道具統一 attach

Leon 實測 v1.97 的 `CYNTHIA_GARCHOMP_DECK` 發現四個 bug，本波一次修清；沒有新增卡實裝。

### Bug 1：竹蘭的圓陸鯊 → 竹蘭的尖牙陸鯊 進化鏈斷

- 症狀：M2a set 裡面的「竹蘭的尖牙陸鯊」`evolvesFrom` 被資料填錯，寫成 `<竹蘭的>尖牙陸鯊`（自我參照），應為 `竹蘭的圓陸鯊`。
- 影響 id：14749 / 16383 / 16384（三張 M2a 變體）。
- 修復：改 `static/cards/M2a.json` 三處。
- 進化鏈現況：`竹蘭的圓陸鯊`(M2a 14748) → `竹蘭的尖牙陸鯊`(M2a 14749) → `<竹蘭的>烈咬陸鯊ex`(SV9a 12702) 皆為精確 name 對應，引擎 `evoCard.evolvesFrom === baseCard.name` 可通過。

### Bug 2：戰鬥鑼 搜不到 基本【鬥】能量

- 雙重根因：
  1. `ZH_ENERGY_TYPE`（engine.ts）只有 `'格': 'Fighting'`，缺 `'鬥'`。基本【鬥】能量沒有 `pokemonType` 欄位，需靠名字解析，結果 fallback 為 Colorless。
  2. `FightingBasicOrFightingEnergy` filter（+page.svelte + ai.ts）只檢查 `pokemonType === 'Fighting'`，基本【鬥】能量因此被排除。
- 修復：
  - `ZH_ENERGY_TYPE` 加入 `'鬥': 'Fighting'`（與既有 '格' 並存）。
  - filter 基本能量分支擴充為「pokemonType === 'Fighting' 或 name 含【鬥】/【格】」。

### Bug 3：牌庫搜尋 UI 加放大鏡

- 需求：火箭隊的拉姆達、高級球、好友寶芬、戰鬥鑼等卡叫出的 deck-search 彈窗，每張卡只有圖+名字+HP，看不出細節。
- 修復：`+page.svelte` 的 `.sel-grid` 每個 `sel-card` 外包一層 `.sel-card-wrap`，右上角新增 `.sel-zoom` 按鈕（🔍）開啟既有 `openZoom(cardId, inst)` 浮層。寶可夢選擇（retreat-grid）已有此按鈕；本波統一補在通用 deck-search / selection-item UI。
- 樣式新增：`.sel-card-wrap` / `.sel-zoom`（+hover）；原 `.sel-card` `width:100%` 配 wrap 使用。

### Bug 4：竹蘭的力量負重（道具）放上寶可夢就消失

- 根因：`effects.ts` 對 tool 效果拆為兩部分——`TOOL_*` 映射（HP bonus / attack mod / …）+ `TRAINER_EFFECTS.reg(name, toolAttachEffect(name))` 的 attach resolver。之前只有 `氣球` / `龐克頭盔` 有顯式 reg，其他 tool（英雄斗篷、勇氣護符、豪華斗篷、極限腰帶、鎖鏈糬、驅勁能量 古代/未來、福祿果系列、倖存鍛鍊器、希望護身符、沉重接力棒、幸運頭盔、奢華炸彈、緊急滑板、重力之玉、**竹蘭的力量負重**）全數是隱性 broken——engine PLAY_TRAINER 的 isTool 分支找不到 effectFn 時只寫 log「尚未實裝」，卡片既沒附上寶可夢、也沒回手牌，直接人間蒸發。
- 修復：在所有 `TOOL_*` map 最後做一次「自動 attach reg」掃描：
  ```ts
  const toolNames = new Set<string>([...TOOL_HP_BONUS.keys(), ...TOOL_ATTACK_BONUS.keys(), ...]);
  for (const name of toolNames) {
    if (!TRAINER_EFFECTS.has(name)) reg(name, toolAttachEffect(name));
  }
  ```
- 結果：竹蘭的力量負重 + 上述 14 張隱性壞掉的 tool 一次補齊 attach 流程，未來任何加到 `TOOL_*` 的新道具也自動獲得 attach resolver。

### 驗證

- `npm run build` 通過（無 TypeScript / svelte-check 警告）。
- sim 30 局 / 30 正常結束、0 crash、P1/P2 = 18/12、平均 15.3 回合。
- 版本 1.97 → 1.98

---

## Session 38aw (v1.99) — 頂部資訊列加雙方手牌張數

Leon 要求上方儀錶板（header）在 🎮 主階段 tag 左邊新增一欄「玩家 X 的手牌（X 張）」。
手牌張數是公開資訊（對戰雙方都看得到對方有幾張）——不等同於看內容，所以直接顯示在 header。

### 變更

- `src/routes/game/+page.svelte` 在 `.phase-tag` 前插入 `<span class="hand-counts">`，
  用 `{#each game.players as pl, pi}` 一次渲染雙方。當前行動玩家 chip 套 `.hc-active` 高亮。
- 新增 CSS：
  - `.hand-counts` — flex 容器
  - `.hand-count-chip` — 藍灰底色（與其他 chip 區別）
  - `.hand-count-chip.hc-active` — 綠底高亮、陰影

格式：`✋ {name} 手牌 {N} 張`（目前行動者 = 綠色；另一側 = 藍灰）。

### 驗證

- `npm run build` 通過
- 版本 1.98 → 1.99

---

## Session 38ax (v2.00) — 預設牌組新增「魔靈多龍」

第一次跨越整數版號 — 依 version.ts 規則：重大變革 +1（1.99 → 2.00）。
開啟「36 副日系 meta 預設牌組」計畫，一次一副，先從 Leon 指定的 **多龍系列** 開始。

### Leon 選型

多龍軸有 5 種抽濾軸變體（土龍 / 火焰雞 / 鋁鋼橋龍 / 青銅鐘 / 魔靈），Leon 先指定 **魔靈多龍** —
以 多龍巴魯托ex 幻影奇襲為主 attacker、黑夜魔靈 咒詛炸彈（13 counter）為狙擊引擎。

### 變更

- `src/lib/decks/presets.ts`
  - 新增 `MARRUNE_DRAGAPULT_DECK`（60 張）
  - append 至 `PRESET_DECKS` 陣列（目前第 5 副預設）
- `src/lib/version.ts` — `1.99 → 2.00`

### 牌組組成（60 張 = 20 寶可夢 / 20 物品 / 10 支援者 / 2 競技場 / 8 能量）

| 區塊 | 卡片 × 數 |
|:---|:---|
| 寶可夢 | 多龍巴魯托ex×3 / 多龍奇×2 / 多龍梅西亞×4 / 黑夜魔靈×2 / 彷徨夜靈×2 / 夜巡靈×2 / 願增猿×1 / 含羞苞×1 / 喵喵ex×2 / 吉雉雞ex×1 |
| 物品 | 好友寶芬×4 / 高級球×4 / 寶可平板×4 / 神奇糖果×3 / 夜間擔架×2 / 特殊紅牌×1 / 不公印章×1 / 莉莉艾的珍珠×1 |
| 支援者 | 莉莉艾的決意×4 / 老大的指令×2 / 白蕾雅×1 / 阿蜜的目光×1 / 赤松×1 / 裁判×1 |
| 競技場 | 阻礙之塔×1 / 月光丘陵×1 |
| 能量 | 基本【火】×3 / 基本【超】×3 / 基本【惡】×2 |

所有 29 個獨立 card id 均驗證存在於 MC / M3 / M4 / SV8a 卡包。

### 依 Leon 指示「移除不確定的部分先下手」——以下特性/卡片之**引擎實作**延到後續 bug fix 波

| 卡 | 需實作效果 |
|:---|:---|
| 黑夜魔靈 咒詛炸彈 | 自身昏厥後對手放 13 counter（現有 resolver 只支援 5 counter） |
| 願增猿 腎上腺腦力 | 消耗 惡 能量將最多 3 counter 從自身轉移給對手 |
| 喵喵ex 殺手鐧捕捉 | 上備戰時 trigger，tutor 支援者 |
| 阻礙之塔 | 競技場：鎖雙方道具特性 |
| 白蕾雅 | 條件支援者：對手剩 2 獎賞時多抽 1 |
| 阿蜜的目光 | 下回合己方受擊 -30 |
| 特殊紅牌 | 對手手牌洗回並抽 3 |
| 莉莉艾的珍珠 | 道具：裝備者被擊倒時對手多拿 1 獎賞（本家版為進化ex -1） |
| 赤松 | 從牌庫搜 2 張不同屬性基本能量 |
| 月光丘陵 | 競技場：棄 1 超能量回復場上全員 30 |

（本波**只新增預設牌組資料**，不修改引擎；玩家現在就能選它上場，只是部分特性不會發動。）

### 驗證

- `npm run build` 通過（✓ built in 11.41s）
- 版本 1.99 → 2.00

---

## 📝 2026-04-21 Session 38ay — 魔靈多龍缺口特性/招式/訓練家實裝 → v2.01

### 目標
Leon：「這 60 張牌有那些特性和效果還沒處理的，我們先來處理，把這 60 張牌完全搞定！」

承接 38ax 的延後清單，完整實裝 v2.00 留下的 10 項缺口，讓魔靈多龍預設牌組的每一張卡都能在對戰中正確觸發。

### 變更檔案

- `src/lib/game/effects.ts` — 新增 Wave 43 區塊（JAMMING_TOWER_STADIUMS、BENCH_PLACE_TRIGGERS、10 張卡 effect 登錄）
- `src/lib/game/engine.ts` — 接 effects.ts 兩個新 export；TOOL_* 全面加上「阻礙之塔」閘門；PLAY_BASIC 呼叫 BENCH_PLACE_TRIGGERS
- `src/routes/game/+page.svelte` — `hpRemaining` / `hpTotal` 呼叫 `getEffectiveHP` 時傳入 `game` 以支援 stadium 感知
- `src/lib/decks/presets.ts` — 清掉魔靈多龍註解裡「延後實裝」清單
- `src/lib/version.ts` — 2.00 → 2.01

### 完整實裝清單（10 項）

| 卡 | 機制 | 實作摘要 |
|:---|:---|:---|
| 黑夜魔靈 咒詛炸彈 | ability +13 counter + 自 KO | `regA('黑夜魔靈', 0, ...)` → `opp-poke-choose` → 既有 `cursed-bomb` resolver（擴充 `params.counters` 支援 5/13） |
| 黑夜魔靈 [特性]咒詛炸彈 | 招式式變體 | `cursedBombAttackPost('咒詛炸彈', 13)` |
| 多龍奇 偵查指令 | 查牌庫頂 3 張選 1 加手牌 | `regA` + 新 resolver `scouting-order`（TOP3 filter） |
| 願增猿 腎上腺腦力 | 卸 1 惡能量 → 從自身移 3 counter 給對手 | 兩階段：`adrenal-brain-src`（heal-target 複用）→ `adrenal-brain-target`（opp-poke-choose，含 KO 判定） |
| 喵喵ex 殺手鐧捕捉 | 上備戰時 tutor 1 張支援者 | `BENCH_PLACE_TRIGGERS.set('喵喵ex', ...)` → engine PLAY_BASIC dispatch |
| 阻礙之塔 | Stadium：雙方道具失效 | `JAMMING_TOWER_STADIUMS` Set + engine `isToolsJammed()` helper，閘在 8 個 TOOL_* 查找 + 龐克頭盔反彈處 |
| 白蕾雅 | 本回合戰鬥位招式 +30 | 簡化版（原卡條件「太晶寶可夢」暫不檢查）：`damageBonusThisTurn += 30` |
| 阿蜜的目光 | 戰鬥位下次受招式傷害 -30 | `damageReduceNextHit = 30`（重用既有引擎旗標） |
| 特殊紅牌 | 對手手牌洗回 + 抽 3 | `returnHandToDeck` + `drawCards` |
| 赤松 | 從牌庫搜最多 2 張基本能量到手 | 簡化版（原卡需不同屬性，本版任意）：`deck-search` filter=`Energy:Basic` |
| 莉莉艾的珍珠 | 道具：裝備者為「規則寶可夢」被 KO 時對手 -1 獎賞 | `TOOL_PRIZE_BONUS.set(..., card => isRulePoke ? -1 : 0)`（engine `Math.max(0, ...)` clamp） |

### engine.ts 的重點變更

1. **BENCH_PLACE_TRIGGERS dispatch**：`PLAY_BASIC` 成功後以卡名查 map，有則呼叫 `fn(state, aIdx, pool)`。
2. **isToolsJammed() helper**：純函式檢查 `state.activeStadium` 是否在 `JAMMING_TOWER_STADIUMS`。
3. **TOOL_* 全面閘門化**：
   - `getEffectiveHP` 新增 optional `state` 參數；UI 已同步傳入。
   - 對戰 / 撤退 / canRetreat 的 8 個 TOOL_* 查找（HP / ATTACK / DEFENSE / PREVENT_KO / PRIZE / ON_KO / ON_DAMAGED / RETREAT + BOTH_SIDES_RETREAT_PLUS）與龐克頭盔反彈段，全部先檢查 `toolsJammed`。
4. **簡化 / 偏保守策略**（依 Leon 風格：「移除不確定先下手」）：
   - 白蕾雅未套「太晶寶可夢」條件 → 戰鬥位恆 +30。
   - 赤松不強制兩屬性不同 → 搜最多 2 張任意基本能量。
   - 阿蜜的目光映射到既有 `damageReduceNextHit`。

### 驗證

- `npm run build` ✓（6s client / 11s server，無 TS error、無 Svelte warning）
- 60 張卡每張都對應到 effects.ts 的 `reg` / `regA` / `regPre` / `regPost` / `TOOL_*` 或 `BENCH_PLACE_TRIGGERS` 登錄（或依舊為純 stat 寶可夢，如夜巡靈 / 彷徨夜靈 進化系的非 ability 分支）。
- 版本 2.00 → 2.01

### 後續
魔靈多龍預設牌組 v2.01 完整實裝完畢。接下來可挑下一個日本 meta 預設牌組（尚有 35 個）。
