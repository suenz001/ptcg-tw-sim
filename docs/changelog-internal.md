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
