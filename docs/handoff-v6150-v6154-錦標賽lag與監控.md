# 交接：v6.150 ~ v6.154（錦標賽 lag、灰度旗標、admin 監控分頁）

> 建立於 v6.154 push 之後。**已推上 GitHub main = `6051a7d8`（v6.154）**，尚未部署到正式站。
>
> 前一份交接文件 `docs/handoff-錦標賽伺服器三批次.md` 的**三個批次已全部做完**，這份是它的後續。
>
> ⚠⚠ **最新狀態（2026-08-10）：v6.156 已在本機 commit，但 push 失敗** —— 沙盒的
> HTTPS proxy 擋掉 GitHub（403）。本機 `main` 已經指到 v6.156。
> **接手的第一件事就是把它推上去：** `git push origin main:refs/heads/main`
> （內容見第 7、8 節；先用 `git log --oneline -2` 確認 HEAD 是 v6.156、parent 是 `99538b00`）。
>
> ⚠ **下一版的 BASE 用 v6.156 的 sha**（`git rev-parse main` 取得；push 上去之後那就是
> 遠端 main）—— IRON_RULES Rule 24：用 sha push 之後，後續 patch 的 base 必須是那個 sha。
>
> 每一項都標了「已查證 / 未查證」——**標為未查證的一律要自己再確認一次**。

---

## 0. 站長的價值裁定（⭐ 這條會影響所有優先順序判斷）

站長原話大意：

> 「本網站不是專業的競賽網站，只是提供玩家練習而已。所以就算 devtools 看得到對手的手牌，
> 對本網站來說其實也沒什麼關係，本來就是練習性質而已。因此**如果要經過高風險才能修復這個
> 問題的話，我覺得並不划算**。請把重點放在**降低並解決多人錦標賽的卡、lag、延遲等狀況**。」

⇒ 判斷一件事值不值得做，**先問「它對卡／lag／延遲有沒有幫助」**。防作弊類（尤其要動對戰
核心路徑：picker、卡效果、身分驗證）優先度低。v6.150 的盤面遮蔽因此在 v6.153 被改成
**預設關閉的旗標**（程式碼留著，隨時可開）。

---

## 1. 這五版做了什麼（已查證，全部通過完整 npm test 470 步 + vite build）

| 版本 | 內容 | 對 lag 有幫助？ |
|---|---|---|
| v6.150 | 玩家端盤面遮蔽（對手的手牌／牌庫／獎賞） | ❌（但順手修好一個真的會卡的東西，見下） |
| v6.151 | 對戰收尾五項 | ✅ |
| v6.152 | `/state?wait=1` 長輪詢（灰度，**預設關閉**） | ✅✅ 最有感的一發，但要先開 |
| v6.153 | 把 v6.150 的遮蔽改成**預設關閉**的旗標 | —（把風險歸零） |
| v6.154 | admin 新增「📡 監控」分頁 | 🔍 讓 lag 從此有數據可查 |

### v6.151 的五項（部署後立刻生效，不需開任何旗標）

1. **伺服器權威 `actorSeat`** —— 閒置判負是伺服器算的，client 各自本地推算，只要版本落後
   「誰在倒數」就會反向（v6.149 事故）。改成 `/action` 寫盤面時一併存進 doc 頂層，
   `/state` 回傳，client 的倒數方向改讀它。
2. **判負前 60 秒警告** —— 推播給該動作方 ＋ 在房間 log 塞系統訊息
   （bump 版本＝順便打醒「還活著但版本卡住」的 client）。
3. **新鮮度看門狗 playing 8 秒 → 20 秒** —— 這一發是**單發成本最大**的（每次都是整份
   `v=-1` 全量盤面）。setup 維持 3.5 秒。
4. **`visibilitychange`** —— 切回分頁立刻與伺服器對齊；回前景 3 秒內不顯示倒數
   （背景期間時鐘沒更新，會先算出「剩 0 秒」嚇人）。
5. **RTT 量測 ＋ `stale-version` 診斷指紋** —— playing 階段的版本卡住原本不屬於任何指紋、
   什麼都不會回傳。

### v6.150 裡唯一對 lag 有幫助的東西（已生效、與遮蔽旗標無關）

`ensurePoolForStateIds` 過濾佔位 cardId —— 修的是**觀戰端從 v0.68 起就一直在做**的
「每次盤面更新都把 40 個卡包重灌進一份新 Map」。那個真的會讓觀戰者的手機卡。

---

## 2. 站長要做的事（照順序）

### ① 部署（已 push，等綠燈）

- GitHub Actions 的 deploy.yml 應該已經在跑 `6051a7d8`。**用 `conclusion` 欄位判斷綠紅**，
  不要靠時長（掛掉的 run 也會顯示 3 分鐘以上）。
- 綠燈 → 在測試站 https://suenz001.github.io/ptcg-tw-sim/ 打一場確認正常。
- 確認後跑三支 bat，**這次 `redeploy-oracle.bat`（伺服器邏輯）與
  `update-admin-full.bat`（新的監控分頁）都必須跑**，`update-tournament.bat` 照常。

### ② 開長輪詢（這是延遲真正會變好的那一發）

進 https://www.ptcg-tw-sim.com/admin → **📡 監控** 分頁 → 上半「連線設定」：

1. 掛起上限先設 **8 秒** → 按「啟用長輪詢」
2. 打一場，看動作反應有沒有變快、「目前掛著幾條連線」是否合理
3. 沒問題再把上限調到 25 秒
4. 任何時候覺得不對，按「關閉」立刻回到原本的短輪詢

**已查證**：VM 是 `pm2 fork_mode`（單一 instance），所以 in-process 通知送得到，
長輪詢的延遲會真的降下來。（2026-08 由站長在 VM 上跑 `pm2 describe ptcg-api` 確認。）

**未查證、要靠實測的兩件事**：
- cloudflared 隧道與 Express 會不會砍掉 25 秒的閒置連線 →
  所以才建議先用 8 秒（遠低於一般隧道 idle timeout），確認沒事再往上加。
- 50 人賽 ≈ 50 條掛起連線，VM 撐不撐得住 → 用監控分頁的 `held` 觀察。

### ③ 辦一場賽事，然後看監控分頁

**這是回答「lag 到底解決了沒」的唯一方法。** 在那之前任何人（包括 AI）說的都是猜測 ——
伺服器端指標一直都是綠的，但那不包含隧道排隊與玩家端的往返（v6.134 的教訓）。

判讀方式（監控分頁上也寫了）：

| 指紋 | 意思 | 怎麼判讀 |
|---|---|---|
| `slow-rtt` | 動作往返 p95 ≥ 3 秒 | **多位不同玩家**同時出現 ⇒ 隧道／VM；只有固定幾位 ⇒ 他們自己的網路 |
| `stale-version` | 對戰中盤面版本卡住 | 出現＝有人畫面凍結過（v6.149 那一類） |
| `invisible-hand` | 手牌有卡卻一張都沒畫出來 | v5.932 已修根因，再出現要回頭查 |
| `setup-watchdog-repeat` | 開局同步連續卡住 | 強制重抓後仍卡 |
| `manual-sync` | 玩家自己按了「重新同步」 | 不一定是 bug，但次數變多代表玩家覺得畫面不對 |

⚠ **受影響人數比次數重要** —— 同一人重複觸發不代表全站問題。

---

## 3. 接手的 AI 要知道的事

### 3.1 下一版的起點

- **BASE = `6051a7d81e3192b8ea498075a1d4e79eb41d3395`**（v6.154）
- 版本號從 **6.155** 開始
- admin.html 的版本號是獨立的，目前 **v1.67**
- `server_admin_patch.js` 檔頭的版本號也是獨立的，目前 **v1.07**

### 3.2 新增的兩個灰度旗標（都存在 mongo `tournamentConfig`）

| 旗標 | doc `_id` | 預設 | admin 端點 |
|---|---|---|---|
| 長輪詢 | `longPoll` | 關閉 | `GET/POST /api/tournament/admin/longpoll` |
| 玩家端盤面遮蔽 | `redactState` | 關閉 | `GET/POST /api/tournament/admin/redact` |

- 兩個都是 **`enabled` 必須是 boolean `true` 才算開**（`"true"` 字串不算）。
- 遮蔽旗標**只管玩家視角**；**觀戰端永遠遮**（那是 v6.149 就有的既有行為）。
- `/action` 與 `/join` 的 verified 身分要求**不受遮蔽旗標影響** —— 那擋的是
  「替對手送動作」，是會直接破壞別人對局的，與偷看手牌不是同一件事。

### 3.3 ⚠ 這批踩過的坑（別再踩一次）

**關於守衛**

1. **只驗字串存在的守衛擋不住「接線沒接上」**。v6.154 第一版 22 條守衛全綠，但
   admin 監控分頁**點進去是整片空白** —— 只加了分頁按鈕與 switchTab 分派、
   **沒加內容容器 `id="tab-monitor"`**，而 `loadMonitor` 又抓了一個不存在的 id。
   ⇒ 已補一條通用守衛：每個 `data-tab` 都必須同時有容器與分派。
2. `indexOf('中文訊息') < indexOf(...)` —— 訊息一改字就變 `-1`，而 `-1 < 正數` **恆真**。
   比大小前先斷言兩個錨點都 `> -1`。
3. 逐行掃 `res.json(` 要求與欄位同一行 —— 多行 `res.json({…})` 會整個被漏掉。
4. `/_redactAt = 0;/` **全檔**比對會被宣告行 `let _redactFlag = false, _redactAt = 0;`
   滿足 ⇒ 把真正的那行刪掉照樣 PASS。**一律 scope 到區段再比對**。
5. fixture 的 deck iid 排成 `D0…D19` 剛好等於字典序 ⇒「順序有沒有被打亂」永遠測不出東西。

**關於既有守衛會擋路的兩處（不是 bug，是設計）**

- `test-v6146-gameover-poll-throttle` 鎖 `startTournamentPoll()` 的**呼叫點總數**（目前 7）。
  新增呼叫點要回來想清楚「它會不會在 game-over 之後重建 timer」再更新數字。
- `test-v6119-tournament-query-load` 用「輕量讀之後 600 字元的窗口」比對早退的**字面**。
  在那附近內聯任何東西都會把早退擠出窗口而**假紅** ⇒ 新邏輯抽成函式呼叫
  （v6.151 的 `maybeIdleWarn60` 就是為此）。

**關於伺服器**

- **非終局的整包寫回一定要 CAS**。`idleWarn60` 第一版沒加，會把玩家剛送出的動作蓋掉，
  **而且版本號一樣**（都是 `room.version + 1`）⇒ client 的 `?v=cv` 版本比對全回 `unchanged`，
  那條自癒完全失效。
- **`unchanged` 精簡回應的欄位缺席要「省略那個鍵」，不能回 `null`** —— client 只把
  `undefined` 當「伺服器沒講」，`null` 會被當成權威值。
- v6.119 的教訓仍然有效：**「讀出來 → 整包寫回」的 findOne 禁加 projection**（會永久洗掉 log）。

**關於前端**

- 新增狀態旗標必問「**UI 有沒有消費它**」（v6.148 的 `tInFlight` 加了旗標卻零 template 綁定）。
- 兩個時間值相減前先問「**是不是同一個時鐘域**」（`tNow` 是伺服器域、`Date.now()` 是本機域，
  差值就是 `tClockOffset`）。
- 藏資料之前先問「**UI 在沒有這份資料時畫得出來嗎**」（v6.150 的 concealed picker
  一度讓 10 招卡死到閒置判負）。

**關於 admin.html**

- 它是 **module script**：inline `on*` 只看得到掛在 `window` 上的東西，
  模組層級的函式寫進 onclick 會**靜默失效**。
- `api()` **從不 reject** —— 非 2xx 會回 `{ error: text }`。用 `.catch` 判斷是死碼。

---

## 4. 已知缺口 / 未完成（依重要性）

1. **「lag 是否真的改善」還沒有數據** —— 要辦一場賽事後看監控分頁（見 2.③）。
2. **長輪詢還沒開** —— 要站長在測試站按下去（見 2.②）。
3. **自己的牌庫順序，client 端仍然看得到，而且不能照樣遮** ——
   「牌庫裡沒有可搜尋對象 ⇒ 訓練家不能使用」這類 gate（IRON_RULES Rule 26a）是**在 client 算的**，
   遮掉自己的牌庫會讓那些 gate 全部誤判。要根治得把可用性判定搬到伺服器
   （＝既有待辦「Oracle 單邊建局」）。
4. **遮蔽開啟後的已知代價**（目前預設關閉，不急）：
   - 火箭隊的貓老大ex｜高傲指令的放行時機比卡面寬（只要輪到我、戰鬥場是那張卡就常駐放行整個回合，
     而不是「宣告該招式時」）。
   - 狐大盜｜技能大盜 借用對手貓老大ex 的高傲指令那條路徑有涵蓋，但只在「我的戰鬥場是狐大盜
     且手牌 0」時。
   - `/action` 要求 verified 的代價：超過 1 小時的長對局、且瀏覽器連不上 Google 的 token
     刷新端點時，玩家會被 403 擋住所有動作直到判負。
5. 既有待辦（與這批無關，但仍在）：線上休閒大廳偶發打不開、傳說場地卡半張顯示、
   admin 後台重構五批次、從回放學打法強化 AI。

---

## 5. 這一批新增的守衛（都在 `npm test` 鏈上，共 470 步）

| 檔案 | 項數 | 驗什麼 |
|---|---|---|
| `test-v6150-state-redact.mjs` | 114 | 遮蔽行為（旗標開／關）、觀戰端永遠遮、log privateMessage、所有回應出口都走遮蔽函式 |
| `test-v6150-optimistic-under-redaction.mjs` | 21 | **真 pool + 真 engine 實跑**：遮蔽後樂觀更新的四個白名單動作仍可預測 |
| `test-v6151-server-actor-and-idle-warn.mjs` | 71 | `idleWarn60` 行為端實跑（推給誰、CAS、不動 lastActionAt）、actorSeat 接線、看門狗、visibilitychange、RTT |
| `test-v6152-longpoll.mjs` | 44 | 長輪詢四條喚醒路徑行為端實跑、掛起上限、資源不外洩、旗標關閉時零影響 |
| `test-v6154-monitor-tab.mjs` | 30 | 監控分頁的容器／分派／window 掛載、指紋說明表與 client 送出的 reason 對得上 |

---

## 6. ⚠ 一件與程式無關但要處理的事

repo 的 remote URL 直接嵌著 GitHub Personal Access Token：

```
https://suenz001:ghp_xxxxxxxx@github.com/suenz001/ptcg-tw-sim.git
```

它在這次診斷時被讀到過（因此出現在對話紀錄裡）。建議去 GitHub **撤銷該 token 重發**，
並改用 credential helper 或 SSH key，不要把 token 寫在 remote URL 中。

---

# 7. 【✅ 已於 v6.156 實作完成】閒置判負前的「我還在」確認彈窗

> 由站長 2026-08-10 提出並裁定。**已實作完成，見第 8 節。**
> BASE 用 `99538b0062c50aebc9ff5026a21a4d43f3f203a9`（v6.155）。
> 下面保留原始規格，方便與實作對照（實作時多補了一條規格沒寫的規則，見 8.2）。

## 動機（站長原話大意）
> 「我不會一直去監控啊，應該是你要提醒他們『系統已經計時囉』，然後彈出一個框框讓玩家點選。
> 沒點選表示人在掛機不在，就可以判敗；相反的，如果玩家在、只是在思考，就可以點那個框框，證明還在。」

⇒ 把「事後看監控」換成「當場問玩家」。真掛機照樣判敗，在思考的人不會被冤枉。

## 站長的三個裁定

| 項目 | 裁定 |
|---|---|
| 點了「我還在」之後 | **重置閒置倒數，不限次數** |
| 彈窗出現時機 | **所有閒置情境都彈**（對戰中長考、開局卡住、雙方都推不動的死角） |
| 死角情境點了仍卡住 | **改判平手 ＋ 聊天室通知站長人工裁定**（不是雙敗、也不重打） |

## ⚠⚠ 實作前必須解決的一個漏洞（我查證後發現，站長還不知道）

「不限次數重置」的天花板是**對局時限**（`server_admin_patch.js` 的 timeLimit 掃描：
時限到 → 標記 `timeLimitReached` + 記下當下 turn → 廣播「進行最後回合」→
等後攻方結束他的下一個回合 → 依雙方剩餘獎賞卡判定）。**這個機制確實存在且會強制結束對局。**

**但是**：時限到之後要「打完最後回合」才會判定，而拖延方只要每 3 分鐘點一次「我還在」，
最後回合就**永遠打不完** ⇒ 比賽卡死，時限形同虛設。

⇒ **必加規則：`timeLimitReached === true` 之後，「我還在」不再重置倒數**（按鈕可以還在、
但只顯示「對局時限已到，請盡快完成最後回合」）。這樣對局時限才是真正的天花板。

## 設計要點

**伺服器（`server_admin_patch.js`，要跑 `redeploy-oracle.bat`）**
1. 新端點 `POST /api/tournament/still-here`：驗身分 → 確認 uid 在該房 seats 內 →
   `$set: { lastActionAt: Date.now() }`（重用既有欄位，閒置掃描就是讀它）。
   ⚠ **不可整包寫回 gameState**（v6.151 `idleWarn60` 的教訓：非終局的整包寫回一定要 CAS，
   否則會蓋掉玩家剛送出的動作、而且版本號一樣讓自癒失效）。這個端點只碰 `lastActionAt`，最安全。
2. `timeLimitReached` 時拒絕（回 `{ ok:false, reason:'time-limit' }`），由 client 顯示不同文案。
3. 死角判定：`currentActorSeat(gs) === -1` 且 `phase === 'setup'` 且雙方 `setupDone` 皆 true
   → 改判**平手**（`winnerUid: null`、`draw: true`，**不要**用現有的 `doubleNoShow`）
   + `postSystemChat` 通知站長人工裁定。
   ⚠ 現行碼在 `actor === -1` 是走「雙方皆閒置 → 雙淘汰（doubleNoShow）」，要改的就是這一條。

**Client（`src/routes/game/+page.svelte` ＋ `MobilePortraitBattle.svelte`）**
4. 倒數剩 60 秒時彈確認框（v6.151 已經有 60 秒推播，兩者對齊同一時點）。
   ⚠ 彈窗必須放在**手機/桌機版面分支之外**（v6.149 剛踩過：橫幅寫在桌機 else 分支裡，手機看不到）。
5. 死角情境（`actorSeat === -1`）**兩邊都要彈**，而且點下去要**同時 `tForceResync()`**——
   點了「我還在」但盤面還是推不動，才是真 bug；此時送 `setup-stalled-both-done` 診斷。
6. ⚠ 手機在背景/鎖屏看不到彈窗 → 仍要靠 v6.151 的推播叫醒。彈窗是補強不是取代。
7. ⚠ 「有實際動作」本來就會更新 `lastActionAt`，不要因為加了彈窗就改掉那條 —— 正常出牌的人
   不該被要求額外點確認。

**守衛**
8. 行為端：still-here 端點只改 `lastActionAt`、不碰 gameState；`timeLimitReached` 時必須拒絕；
   非該房玩家呼叫必須 403。
9. 靜態：彈窗在版面分支之外（斷言**位置**，不是只斷言「有渲染」——v6.148 的教訓）。
10. 死角改判平手的分支要有 HEAD-FAIL 對照（現行碼是 doubleNoShow）。

---

# 8. v6.156 實作結果（已在本機 commit，⚠ 尚未 push）

> BASE = `99538b0062c50aebc9ff5026a21a4d43f3f203a9`（v6.155）。
> 本機 `main` 已指到 v6.156（sha 用 `git rev-parse main` 取得）。
> 完整 `npm test` **472 步分 4 批全部 exit=0**、`npm run build` 通過。

## 8.1 改到的檔案

```
oracle-admin/server_admin_patch.js   新端點 /still-here（v6.156 STILL HERE BLOCK）＋ 死角改判平手
src/routes/game/+page.svelte         tMyIdleSec ＋ tStillHere() ＋ 彈窗（版面分支之外）＋ CSS
                                     ＋ 新鮮度看門狗加 !_lpInFlight（Fable 審查）
oracle-admin/admin.html              setup-stalled-both-done 指紋說明 ＋ 按鈕文字還原 ＋ title v1.69
src/lib/version.ts                   6.155 → 6.156
docs/changelog-internal.md           新增 v6.156 一段
static/changelog.html                新增 v6.156 一則（玩家感受得到 ⇒ 上首頁），並把最舊的 v6.089 搬進 archive
static/changelog-archive.html        接收 v6.089
scripts/test-v6156-still-here.mjs    新增（47 項）
scripts/test-v6151-…mjs / test-v6152-longpoll.mjs   守衛安慰劑修正（71→74、44→52）
package.json                         測試鏈 471 → 472 步
```

**部署**：伺服器端有改 ⇒ **必跑 `redeploy-oracle.bat`**；admin.html 有改 ⇒ **必跑 `update-admin-full.bat`**。

## 8.2 ⚠⚠ 規格沒寫、實作時查證後補上的一條規則

**只有「該動作的那一方」能按「我還在」重置倒數。**

閒置倒數的語意就是「該動作方沒動作」。若放行等待方呼叫，等待方就能替**掛機的對手**
無限續命 —— 判負機制直接失效，而且是對手幫他做的，掛機者本人什麼都不用做。
`actor === -1`（雙方都該動作＝系統死角）時兩邊都放行，那正是這個功能要救的情境。
守衛已用行為端釘死（等待方呼叫必須 `reason: 'not-your-turn'` **且完全沒有寫入**）。

## 8.3 三個裁定的實作對照

| 站長裁定 | 實作 |
|---|---|
| ①點了就重置、不限次數 | `$set: { lastActionAt: now }`，沒有次數上限。**不整包寫回 gameState、也不 bump version** —— 盤面沒變，bump 只會讓兩邊各抓一份完整盤面白花流量 |
| ②所有閒置情境都彈 | 判準是 `actor === mySeatIdx \|\| actor === -1`，setup／playing／死角都涵蓋 |
| ③死角改判平手＋通知站長 | 閒置掃描的 `actor === -1` 分支分歧：setup 且雙方 setupDone → **`status: 'pending-admin'`** ＋ `draw: true, deadlockDraw: true` ＋ 聊天室請站長到 admin「待裁定場次」處理，**且不推進輪次**；**非死角仍走原本的 doubleNoShow + done**（賽果對帳要分得出「掛機」與「系統卡住」）<br>⚠ 第二輪 Fable 審查抓到：第一版設成 `done` ⇒ resolve 回 409、pending 清單不列 ⇒ 「人工裁定」根本做不到，實質仍是雙淘汰 |
| 交接文件點名的時限漏洞 | `timeLimitReached` 之後伺服器拒絕重置，client 顯示「對局時限已到，請盡快完成最後回合」 |

## 8.4 同批併入：Fable 5 最終審查的三項修正

15 個發現逐一自行複驗後確認並修掉三項（其餘為誤判或已知取捨，見第 7 節之外的 changelog-internal）：

1. **⭐ 新鮮度看門狗會把長輪詢的效益整個吃掉**（只在長輪詢旗標打開後才現形）——
   20 秒看門狗沒有長輪詢守衛，會 ①每 20 秒白抓一份全量 ②丟棄在途的長輪詢回應
   ③**誤發 `stale-version` 指紋**，污染站長要用來判讀「版本卡住」的訊號。修法：加 `&& !_lpInFlight`。
2. **⭐⭐ 三條守衛安慰劑**（把修正還原掉，測試照樣全綠，均以突變實測確認）——
   `test-v6152` 的「掛起後重讀」被掛起**前**的第一次輕量讀誤滿足、`_lpCfgAt = 0;` 被
   **宣告行**誤滿足；`test-v6151` 的 RTT 負向斷言只防 `catch` 一種拼法。
   第一條的後果最重：長輪詢叫醒後拿舊版本比對 → 回 unchanged → client 立刻再掛一發
   ⇒ **長輪詢退化成忙碌空轉**，而測試全綠。
3. admin 監控分頁：旗標開關失敗時按鈕永遠停在「處理中…」。

**Fable 的一項主張複驗後判定為誤判**：「舊世代 `finally` 會誤清新世代在途長輪詢的
`_tLongPollAt`、形成每 6~8 秒迴圈」—— `_pollBusy` 是模組層級旗標，舊那一發沒回來之前
新世代根本送不出去，兩發不會並存。

## 8.4b 第二輪 Fable 5 審查（v6.156 自己的審查）抓到並修掉的四項

1. **⭐ 嚴重：「請站長人工裁定」原本做不到** —— 死角場設成 `status:'done'` 之後，
   `admin/match/resolve` 回 409、`admin/pending-matches` 不列，而且 `checkRoundAdvance`
   立刻推進輪次（單淘汰下兩人直接從賽程消失）。⇒ 改用 `pending-admin` ＋ 不推進輪次。
2. `draw` / `deadlockDraw` 沒進歸檔與 summary 的 mapping ⇒ 賽果頁顯示「正常分勝負」，
   「不重用 doubleNoShow」的目的整個落空。
3. 死角時「對手閒置中→自動判你勝」橫幅與「剩 N 秒被判負」確認框同時出現、方向相反。
4. `setup-stalled-both-done` 指紋在非死角的 `-1` 也會發，而且會吃光每頁 3 發的診斷配額。

守衛跟著補到 **62 項**，突變實測 7 個全紅。其中「彈窗在版面分支之外」的斷言也從
**檔案先後順序**（Fable 指出是安慰劑）改成**巢狀深度證明**。

## 8.5 站長上線後要看的東西

1. 部署（`redeploy-oracle.bat` ＋ `update-admin-full.bat`）。
2. 辦一場賽事，看 admin 監控分頁有沒有出現 **`setup-stalled-both-done`** ——
   有，就代表真的有比賽被系統卡住過（不是玩家掛機）。
   **⚠ 那一場會停在「待裁定」，賽程不會自己往下走** —— 要到 admin 的「待裁定場次」
   把它判掉（判給任一方，或視情況重賽），賽程才會繼續。聊天室也會發一則通知。
3. 長輪詢旗標仍**預設關閉**。要開的話先把掛起上限設 8 秒、`maxHold` 壓小，看監控分頁的
   「掛起數」再往上加（滿載 200 條時保險輪詢約 133 qps 打在 mongo 上）。

## 8.6 下一批的 BASE

v6.156 的 sha（`git rev-parse main`）—— IRON_RULES Rule 24。

⚠ push 之後記得用 GitHub API 的 `conclusion` 欄位確認 build 與 deploy **兩個 job 都 success**，
再提醒站長跑 `redeploy-oracle.bat` ＋ `update-admin-full.bat`。
