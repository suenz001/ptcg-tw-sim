# 待 Leon 確認的卡片清單（H/I/J 標）

> v2.166-v2.173 自動實裝過程中，對效果有疑義或需新引擎機制的卡先跳過，列在此供 Leon 後續確認。
> Leon 指示：g 標跳過，先處理 h/i/j 標。
> 已實裝 v2.166~v2.173 共 58 張；剩餘 H/I/J 36 張需新引擎機制。

## 剩餘 H/I/J 卡 36 張（按需要的引擎升級分組）

### 需「player-level next-turn flag」（已全清，v2.174）
- `[14014/I] 鐵之防禦強化` — ✓ v2.174（PlayerState.metalShieldNextTurn/ThisTurn）
- `[14100/I] 阿塞蘿拉的惡作劇` — ✓ v2.174（CardInstance.immuneToExAttackNextTurn/ThisTurn）
- `[18497/J] 霍米加的演奏` — ✓ v2.174（PlayerState.cantRetreatIfPoisonedNextTurn/ThisTurn）

### 需「Item-as-Pokemon」化石機制（5 張）
- `[18045/J] 陳舊的顎之化石` / `[18046/J] 陳舊的鰭之化石` / `[17128/I] 陳舊的羽毛化石` / `[13947/H] 陳舊的背蓋化石` / `[10985/H] 陳舊的根狀化石`
- 化石 Item 可作為 HP60【無】寶可夢放置場上，自己回合可丟棄

### 需「對手 yes/no 互動」（4 張）
- `[14018/I] 馬志士的交易` (Supporter) — 詢問對手是否互換獎賞
- `[12270] 奧爾迪加` (Supporter) — 看對手手牌+對手選是否抽
- `[12837/I] 火箭隊的妨礙機器人` (Item) — 互換對手手牌+獎賞
- `[10116/H] 泰姆` (Supporter) — 對手猜 HP，正確抽 4

### 需「對手抽卡互動」（1 張）
- `[18051/J] 琵魯` (Supporter) — 棄手牌任意+抽到 5（需 hand-discard 串接）

### 需「holder name/type filter on TOOL_*」（已全清）
v2.176 已實裝：
- `[14393/I] 神聖護符` — ✓ 新 map TOOL_DEFENSE_REDUCE_BY_ATTACKER_ABILITY
- `[14824/I] 渾厚鱗片` — ✓ 擴充 TOOL_DEFENSE_REDUCE_BY_TYPE 加 holderTypes filter
- `[14089/H] 反擊增幅器` — ✓ canAffordAttack inline cost reduction（同 璀璨結晶 pattern）

### 需「attack-injection」（2 張）
- `[18049/J] 核心記憶碟` (Tool) — 給「超級基格爾德ex」額外招式
- `[11281/H] 招式學習器 螢石` (Tool) — 給寶可夢額外招式

### 需「turn-end energy attach」（1 張）
- `[17154/H] 力之沙漏` (Tool) — 自己回合結束從棄牌附 1 基本能量

### 需「passive Stadium hook」（剩 1 張）
- `[18358/H] 樂園度假地` — ✓ v2.177（engine RETREAT/canRetreat 加 stadium 名字 + 寶可夢名字 filter；加入 STATIC_PASSIVE_STADIUMS）
- `[10996/H] 壯偉碩木` — 牌庫鏈式進化（基礎→1階→2階），需新 chain-evolve pending UI

### 需「opp 互動 picker / 進化」（5 張）
- `[14017/I] 除蟲噴霧` (Item) — 對手選擇換哪隻備戰上場
- `[14077/I] 奇異時鐘` (Item) — 進化退化
- `[18494/J] 變化之書` (Item) — 棄牌寶可夢 ↔ 場上寶可夢互換
- `[17112/H] 鬼之假面` (Item) — 棄牌「厄鬼椪ex」↔ 場上「厄鬼椪ex」
- `[10505/H] 配樂之笛` (Item) — 對手牌庫頂 5 任意基礎放對手備戰
- `[10509/H] 手持循環扇` (Tool) — 受傷時對手能量改附其備戰（互動 picker）

### 需「混合 filter」（2 張）
- `[18493/J] 豐收漁網` (Item) — 棄牌【水】寶可夢 + 基本【水】能量各 ≤3
- `[14833/I] 巴貝娜與荷蓮娜` (Supporter) — gate 場上需有 N 系列特定寶可夢（複雜）

### 需「tag detection + bench-distribute」（1 張）
- `[17142/H] 重新啟動箱` (Item) — 棄牌附給「未來」寶可夢各 1 張（tag 偵測 + 多目標分配）

### 需「opp 牌庫操作」（已清）
- `[11085/H] 妨害信函` — ✓ v2.177（items_misc.ts；對手手牌全洗回牌庫底再抽相同數）

### 需「coin → conditional search」（1 張）
- `[17144/I] 火箭隊的超級球` (Item) — 已實裝 ✓ (v2.172)，從 list 移除

### 需「Special Energy 新 hook」（剩 1 張）
v2.175 加入 4 個 hook map（HP_BONUS / RETREAT_MOD / STATUS_IMMUNE / ON_DAMAGED）並實裝 4 張：
- `[18055/J] 增強【草】能量` — 已實裝 ✓ (v2.175, HP_BONUS)
- `[18502/J] 泡沫【水】能量` — 已實裝 ✓ (v2.175, STATUS_IMMUNE，wired into statusPost + 危險光線)
- `[18503/J] 磁鐵【鋼】能量` — 已實裝 ✓ (v2.175, RETREAT_MOD)
- `[17208/I] 扣殺能量` — 已實裝 ✓ (v2.175, ON_DAMAGED)

剩餘：
- `[18501/J] 燃料【火】能量` — 棄牌時放回手牌；需新 energy-discard hook（招式效果丟棄能量時觸發），engine 目前無此 hook 點

### 已實裝但 audit false-positive
- `[12573/I] ‌寶可夢中心的姐姐` — v2.168 實裝；JSON 名前帶 U+200C ZWNJ。v2.172 在 pool.ts 加 ZWNJ strip 後 runtime 正確 match。
