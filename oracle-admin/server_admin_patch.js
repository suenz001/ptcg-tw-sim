// === ORACLE ADMIN ENDPOINTS === v1.41 (v6.291 錦標賽報名可被冒名修正:tournIdentity 在沒有 Bearer 時會退回 req.body.playerId 並回 verified:false(那條 fallback 是給測試房的 /join,/still-here,/action,/reset 用的),而 /register,/register-and-checkin,/checkin 從來沒有檢查 verified;玩家 uid 又由 /bracket 公開回傳 ⇒ 拄一個 uid 就能帶自己的 60 張牌把別人報名進去,受害者本人再報名會撞 409 「你已經報名了」⇒ 報不了名。新增 helper tournRequireVerified(插在 tournIdentity 正下方,**在兩把區塊 sha256 鎖的錪點之前**),三支端點各接一行 ⇒ 403 + code:tourn-needs-verified + 可行動文案 + console.warn(端點與 uid 前 8 碼,不記完整 uid/email)。查證:這三支的請求體從 v6.048 至今從來沒帶過 playerId,拿不到 token 時 tournIdentity 本來就回 401「需要登入」⇒ 本閘不會多擋任何真玩家(站長裁定:可用性優先)。守衛 scripts/test-v6291-tourn-verified-gate.mjs 行為端實跑;錦標賽區塊除這 3 行之外逐位元未動(revert-diff 證明)) ← v1.40 (v6.289 解除封鎖也一併刪私聊:站長裁定 unblock 的語義是「關係歸零」,與 v1.39 的 remove 同一條紀律 ⇒ unblock 的 deleteOne 真刪那一列之後(deletedCount>0)接同一支 _frPurgeDm(fid,'unblock');冷卻內「還原成 rejected」的分支列還在 ⇒ 不刪。守衛 scripts/test-v6289-unblock-purge.mjs 行為端實跑:lobby 逐 id 不少、別段 dm 不少、冷卻內不刪、deletedCount=0 不刪、purge 丟例外仍 200。錦標賽區塊逐位元未動) ← v1.39 (v6.288 remove→_frPurgeDm) ← v1.38 (v6.287 好友私聊【P0：伺服器端＋admin 檢視，玩家完全無感】:站長需求「好友要能在沒有開房間的狀況下直接密語私聊」。新增 PTCG-FRIENDS-DM 區塊(插在 FRIENDS 區塊之後、/api/tournament/join 之前 ⇒ 錦標賽區塊三把 sha256 鎖逐位元未動):POST /api/friends/dm/send {fid,text}／GET /api/friends/dm/list?fid=&since=&before=(since>0 且無新訊息 ⇒ 204 零 body,沿用 v6.216 手法;首發回最新 50 則＋before 分頁)／GET /api/friends/admin/dm[?fid=](isTournAdmin,總覽＋展開)／GET+POST /api/friends/admin/dm-config(子開關 friendsConfig.dm,⚠預設 false,關閉 503 不帶哨兵)。訊息沿用 tournamentChat,room='dm:'+fid;查證:全 repo 會刪／改 tournamentChat 的只有 pruneLobbyChat 與 admin chat/clear 兩處且都只過濾 room:'lobby' ⇒ 私聊不會被誤刪;既有 {room,ts} 索引正好是 {room,ts>since} 要的。⚠⚠ TTL:MongoDB 只刪 BSON Date 型別 ⇒ tournamentClientDiag 的 ts 是 Date.now() 數字,那個 7 天 TTL 從未生效(另案不修);私聊一律 expireAt:new Date(now+90天)＋{expireAt:1} expireAfterSeconds:0(lobby 訊息沒有此欄位不受影響)。每次讀寫都走 _frFindMine(fid 由兩個 email 就算得出來,只驗 room key 等於沒驗);只有 accepted 才能收發,其餘 403(被封鎖方看到的與被解除好友相同);被封鎖方 send 回 200 但一個位元都不寫。防濫用:200 字、\s+ 折單空白、每人 1.2 秒 1 則＋每分鐘 20＋每天 500(記憶體 Map)。玩家端白名單 _frDmPublic {id,mine,text,ts} 永不含 email;admin 端 _frDmAdminRow 可含 email(兩條白名單分開)。admin 總覽 aggregate 在 mongod 分組、node 端逐筆走中央 adminScanYield(app.locals,取不到 503)、硬上限 500 段對話 truncated 誠實回報;friendships 補 {fid:1} 索引。哨兵 friendsDm:1。全程零刪除／零改寫既有資料。) | 前版 v1.37 (v6.286 好友功能對抗性審查六修：nick 不再吃 playerIdentity／rejected 列不可 remove／冷卻只擋被拒方／500 固定文案；v6.282 好友功能【P0：純伺服器端，玩家完全無感】:計劃書 docs/plan-friends-feature.md 站長已核准。本版只上伺服器端、src/ 只動 version.ts、不做任何 client UI —— 鐵律:白名單會丟掉 client 送來的新欄位,server 必須先上。①新 collection `friendships`(_id=兩個正規化(trim+小寫)email 排序串接 a|b;欄位 a/b/status(pending|accepted|blocked|rejected)/requester/blockedBy/nickA/nickB/addedVia(battle|email)/fid/createdAt/updatedAt;索引 {a:1,status:1}{b:1,status:1} 比照 v6.240/v6.266 只在啟動時 lazy createIndex、不 await、.catch() 兜底)。②新 collection `playerIdentity`(_id=email,uid=最近 uid,uids=最近 5 個 {uid,at},nick=最近暱稱):**為什麼需要**——大廳列表回應只有 seats[].uid(email 已被 v1.20 _stripSeatEmails17 剝成 null),好友表以 email 為 key ⇒ 好友清單回應必須附上每個好友目前的 uid,client 才比對得出「哪一間是好友的房」(B 級在線狀態,零新輪詢)。**接點**=/api/match-result 的 PTCG-MATCH-EMAIL-ENRICH 段:那一發 findOne 本來就投影 seats.uid+seats.email,且 v6.220 起線上 client 送來的 email 一律 null ⇒ _needEmail 恆真 ⇒ 每場線上對局都會發 ⇒ 零額外查詢、不在熱路徑(每場一次)、fire-and-forget(不 await、.catch());暱稱取 payload 的 p1/p2.name(同索引對應 seats[0]/[1]),刻意不動 enrich 段的 projection(test-v6266 C2 逐字鎖住它)。**不選** PUT /api/rooms 回填 middleware:那是每個動作都走的熱路徑(佔全站 94% 流量),建房 POST 又在核心 server.js(不在 repo)沒有掛點,而兩邊的 seat.email 同樣是 client 自報、可信度相同。查證:makePlayerDoc **不存 uid**(只有 name/email/cardCounts/deckId)⇒ uid 只能從 seats[] 拿。⚠⚠ 查證時發現計劃書的一個假設不成立:正式站 seats[].uid 是 **Oracle 匿名 JWT 發的 per-瀏覽器 uid**(oracle-client.ts /api/auth/anonymous → localStorage ptcg_oracle_uid),不是 Firebase uid,換裝置/清資料/401 續簽都會換 ⇒ 對照表記的是「最近一次完成對局的瀏覽器」,並附最近 5 個 uids 給 client 一起比對;P1 動工前要知道這件事。③六支端點 /api/friends/{list,request,accept,reject,remove,block,unblock}(＋admin GET/POST /api/friends/admin/config —— ⚠ 交辦原寫 /api/tournament/admin/friendsconfig,但 test-v6272 ⑨/v6265/v6275 三把 sha256 鎖以第一支 /api/tournament 的 app.get 字面當錦標賽區塊起點(連註解都算),掛在那個字首會把錨點往前挪、三把鎖全紅;改掛 /api/friends 字首、gate 仍是 isTournAdmin):全部要求 Firebase ID token 驗過且有 email(走同 closure 的 tournIdentity),匿名/playerId fallback 一律 401 code=friends-auth-required;request 三種入口 {roomCode}(伺服器從 rooms.seats[0/1] 取對方 email,要求者必須以驗過的 email 對上其中一位對戰位、不信 client 送的 uid)/{matchId}(錦標賽:tournamentMatches._id → p1uid/p2uid 對上我的 Firebase uid → TREGS `${eventId}__${oppUid}` 取對方 email;TMATCH 被 v0.58 清掃時退到 tournamentArchives `arch_<eventId>`)/{email}(輸入 email 加好友)。④⚠⚠隱私:**所有 /api/friends/* 回應一律不含 email**,回應建構走唯一白名單 _frPublic()(fid/status/nick/uid/uids/requestedByMe/blockedByMe/via/at);對外識別碼 fid=pair id 的 FNV 雜湊(24 hex),handler 一律再用 a/b=我 過濾 ⇒ fid 不是憑證;暱稱來源禁用 tournIdentity 的 email 前綴 fallback(那是半個 email)。守衛用含 email 的假資料實跑七支 handler,序列化後掃 `@`。⑤防濫用:同一對 pending 只准一筆(_id 唯一;對方已先邀我 ⇒ 直接成立);被拒後 24 小時冷卻(留一列 status=rejected+rejectedAt,記憶體會在重啟後消失所以落地;list 不回它);好友上限 100 雙方各自 countDocuments(limit 101,走索引);被封鎖方的所有請求靜默失敗(回 200 但 DB 一個位元都不動,且 remove/unblock 都不讓他刪掉封鎖列);{email} 入口每人每分鐘 3 次、每天 30 次(記憶體 Map,限流在查詢之前消耗);查無此帳號明講 code=friends-no-such-account(站長裁定)—— 先查 playerIdentity(零網路),查不到才走 Firebase **Auth** getUserByEmail(⚠ Auth 不是 Firestore,不吃讀取額度;正負結果都快取 10 分鐘)。⑥開關 tournamentConfig.friendsConfig.enabled **預設 false**(比照長輪詢/redactState 灰度先例;10 秒快取);關閉時端點回 503 且**不帶哨兵**(比照 v6.266 deck-stats 自我停用);開啟時所有成功回應帶哨兵 friendsApi:1 ⇒ 下一版 client 靠它決定顯不顯示 UI;admin 端點不受開關 gate(否則關了就打不開)。⑦⚠⚠絕不拖累錦標賽(pm2 fork_mode 單 instance):所有查詢走索引且有硬上限(list 上限 250 筆;playerIdentity 走 _id $in);唯一的逐筆迴圈仍掛中央 adminScanYield 每 200 筆讓路;⚠⚠ 跨 IIFE:adminScanYield 在 firebase-admin 的 then-callback 內、端點在錦標賽 IIFE ⇒ 本版新掛 app.locals._adminScanYield、handler 執行時才取、取不到一律 fail-closed 回 503 code=friends-helper-missing(v0.94/v1.01/v6.269 三次事故);benchmark(scripts/perf-v6282-friends-eventloop.mjs)量 handler 的事件迴圈阻塞 p50/p99/max。⚠ 區塊插在第一支 /api/tournament 的 app.get 之前 ⇒ 錦標賽區塊逐位元未動(test-v6272 ⑨ 與 test-v6278 I1 兩把 sha256 鎖原封不動)。⚠⚠ 全程沒有任何刪除或改寫既有資料的路徑:remove/unblock 只 deleteOne friendships 自己那一列;matchRecords/rooms/TREGS/TARCHIVE 一個位元都沒改。⚠ 站長已裁定:key=email/B 級在線狀態/解除=真刪除/不推播/上限 100/錦標賽入口本版只要端點支援/查無此帳號明講+限流/零 Firebase 讀寫。) | 前版 v1.35 (v6.281 Firestore 讀取減量【定案輪】:admin feedbacks 快取 TTL 5 分鐘 → 30 分鐘(站長裁定)。2026-09-02 用三份真實資料交叉定案讀取額度的去向:①Firebase「用量與帳單」:讀取 2.8 萬/5 萬(56.6%),截圖時間台灣 9/2 02:48;官方配額 reset around midnight Pacific time(=台灣 15:00)⇒ 該週期已跑 11h48m ⇒ 全天推估 4 萬多讀。②Firestore「用量洞察」30 天:總讀取 94,811(每天約 3,160),其中 /feedbacks 佔 92,129(97.2%)、全部 users/*/decks 加總僅約 1,100、/rooms 452 —— 實際每天 4 萬多 ⇒ 30 天應為 120 萬 ⇒ **儀表板只顯示 7.9%**;官方明文「Queries that return zero results incur a cost of one read operation. This usage is billed but does not appear in the usage dashboard.」⇒ 看不見的大宗是首頁 config/homeChangelog 這份 404 文件(約 3.7 萬讀/天、佔免費額度 74%),client 端本版已把負結果快取 6 小時 → 30 天+綁站台版本(src/lib/home-changelog-cache.ts;v6.273 的 6 小時 TTL 對「一天來一次」的玩家是零命中)。③admin 總覽:意見總數 341 筆 ⇒ 92,129÷341≈269 次全撈(每天約 9 次)≈每天 3,070 讀 ⇒ **儀表板看得到的讀取幾乎全是 admin 的 feedbacks 全撈**。本檔的修法:只把 FEEDBACKS_TTL_MS 由 5 分鐘改 30 分鐘 ⇒ admin 掛著總覽/意見分頁的日子由每天約 9 輪全撈降到約 1.5 輪(每輪 341 讀),約省 2,500 讀/天。⚠ FEEDBACKS_CAP=2000 刻意不動:意見總數 341 遠低於上限,現況不會截斷;動了反而可能讓「未回覆數」失真,且沒有實際收益。⚠ invalidateFeedbacksCache 原封不動 —— admin 回覆/刪除後仍立刻看到;single-flight、「過期先回舊值背景刷新」、unrepliedAt/unrepliedTruncated 回應欄位全部保留。⚠⚠ 錦標賽區塊逐位元未動(本版只改一個常數與本註解)。) | 前版 v1.34 (v6.278 休閒 PUT 上行增量【伺服器端 3a:深路徑】:v6.268(server)+v6.270(client)上線後實測只省 26~40%,真因**不是層數不夠而是深度不夠** —— buildRoomPatch 只做兩層(top 與 gameState.<子鍵>),而 GameState.players 是一個**陣列**裝著雙方完整盤面(src/lib/game/types.ts:766 players:[PlayerState,PlayerState])⇒ 任何一個動作都會 set['gameState.players']=整包約 10KB,delta 真正省到的只有 log。伺服器端 _dpApplyPatch 的 splitPath 又寫死最多兩段、且明確拒絕寫進陣列(throw dp-set-into-nonobject)⇒ **client 就算想送深路徑也送不出去**。本版把伺服器端的門打開,讓 gameState.players.0.hand / gameState.players.1.active.damage 這種路徑可用。⚠⚠ **client 這一版不會送深路徑 ⇒ 玩家完全無感**(站長已裁定 server 先上是硬約束)。⚠⚠ 最大風險是寫壞玩家盤面,六道防護:①兩層路徑(segs<=2)走**與 v1.29 逐字相同**的既有分支 ⇒ 舊 client(v6.270~v6.277)的 patch 逐位元不變;②深路徑(segs>=3)才走新走訪器,中間節點**必須已存在**且是物件/陣列,**絕不自動建**(自動建=憑空生出盤面)⇒ 不存在一律 throw 退全量;③父節點是陣列時 segment 必須是**規範的非負整數字串**(禁前導 0/負號/小數/科學記號)且 **< 既有長度** ⇒ 陣列永遠不會被寫成物件({0:…})、永遠不會 sparse、**不允許擴張**(bench 加一隻這種長度變動,client 一律改送整個陣列當一個值 ⇒ 那是「對父物件的一次 set」不是「寫進陣列」);④父節點是陣列時**禁止 del**(刪元素會留洞=sparse);⑤路徑段數上限 _DP_MAX_PATH_SEGS=8 ＋既有 set/del<=256、logAppend<=512、hash 1M 字元、遞迴深度 32 全部保留;⑥__proto__/constructor/prototype 三個名字在 _dpBadSeg 一律拒(v1.29 已擋,本版逐條實測)。⭐ **最後防線 canonical hash 複驗維持有效**:伺服器套完 patch 重建全量、hash 與 client 送的 fullHash 不符一律 deltaReject ⇒ 任何走訪器的漏洞都會在這裡被攔下來改送全量。⚠ 哨兵:**deltaPut 維持 1**(v6.270 client 的判斷是 `deltaPut === 1` 嚴格比較,改成 2 會讓 v6.270~v6.277 全部靜默退回全量=上行倒退),新協定另掛 **deltaPutDeep:1**;舊 client 只讀 deltaPut、對多出來的 key 無感(守衛抽 v6.270 的 _noteDeltaPutSentinel 實跑證明)。⭐ kill switch 不變:_DELTA_PUT_ENABLED=false ⇒ 兩個哨兵一起消失、全站回全量。⚠ 落庫仍是全量 doc、CAS/_version/長輪詢/下行 logSince 全不動;v1.20 email 回填規則原封不動;錦標賽區塊逐位元未動(守衛以內嵌 sha256 鎖住)。玩家端零改動(src/ 只動 version.ts)。) | 前版 v1.33 (v6.276 套牌戰績【伺服器端 P3a：錦標賽勝率】:v6.266 的 /api/deck-stats 錦標賽欄一直回 not-collected(累積中),本版把它變成真數字。站長已核准動 TREGS 報名寫入路徑。三件事:①報名端收 deckId —— /register、/register-and-checkin、/propose 三個 TREGS.insertOne 各加一個**條件式** deckId 欄位(client v6.277+ 才會送;沒送/不合格/淨化 helper 取不到 ⇒ **欄位缺席**,絕不寫 null,絕不因 deckId 擋報名;⚠⚠ 淨化走 app.locals._sanitizeDeckId —— sanitizeDeckId 定義在 firebase-admin 的 then-callback 內,錦標賽是**另一個 IIFE**,直接呼叫會 ReferenceError(v0.94/v1.01/v6.269 同型事故),handler 執行時才取、取不到 fail-closed 不寫)。②歸檔帶下去 —— recordTournamentArchive 的 players[] 對「reg 有 deckId」的玩家附加 deckId(其餘欄位逐字不動)。③/api/deck-stats 錦標賽段 —— 從 tournamentArchives(永久歸檔,自包含 players[]+matches[];TMATCH 會被 v0.58 排程清掃且無 deckId 對照,不能當來源)算,口徑與 /api/admin/deck-archetype-stats 錦標賽側完全一致(非 bye 且有 winnerUid 才計;平手場無 winnerUid ⇒ 不計,draws 恆 0);對手原型直接拿歸檔 players[].deckEntries(本來就是陣列形狀)走 v6.229 中央 archetypeNameOf,絕不抄第二份分類。⚠⚠ 絕不拖累錦標賽(pm2 fork_mode 單 instance)四道:新 sparse 索引 {players.deckId:1}(multikey,舊歸檔無此欄 ⇒ 索引從 0 筆長);索引缺席時**只把錦標賽段 fail-closed 回 not-collected、休閒段照常**(不像 matchRecords 整支停用);cursor 逐筆+players/matches 逐元素走中央 adminScanYield 每 200 讓路;硬上限 DECK_STATS_TARCH_CAP=300 場歸檔(超過 truncated:true 誠實回報)。⚠ 回應相容:tournament 物件前六個 key(status/games/wins/losses/draws/winRate)順序不變,新 key(since/vsArchetype/events/scanned/truncated/scanCap)一律附加在後;查無資料維持 status not-collected ⇒ 舊 client(v6.267 寫死顯示「累積中」)行為零改變;tournament.since=v6.276,不做歷史回填(email+牌表近似比對會誤配)。⚠ 錦標賽區塊只有上述 ①② 兩類共 6 處**純 additive** 插入,守衛 test-v6276 以「revert-diff」證明:把這 6 處逐字還原後,區塊 sha256 與 v6.265~v6.275 一路未動的 54cd1226… 逐位元相同。⚠⚠ 全程沒有任何刪除或改寫既有資料的路徑。) | 前版 v1.32 (v6.275 /api/admin/firebase/users-all 的 15 秒同步等待與雙份 Auth 全量掃描收斂:站長 dump 的 nginx 計時 log(2026-08-30)抓到 users-all 一發 15.7 秒/回應 1.24MB —— v6.272 的枚舉漏了它(當時只掃 Firestore 讀取字面,而它是 Firebase **Auth** 的 listUsers 逐頁全量掃描,不消耗 Firestore 讀取額度,但 TTL 過期後的第一發要**同步等**整輪循序 HTTPS 掃描)。修法:掃描收斂為單一來源 getRawUsersCached()(5 分鐘 TTL+single-flight+過期先回舊值背景刷新,比照 v1.19),/api/admin/stats 與 users-all 共用同一輪掃描(Auth 請求數減半);補 50,000 安全上限(與 v1.19 同值),截斷回 capped:true 且 admin 畫面標明(絕不靜默截斷);?refresh=1 仍同步等最新資料;映射迴圈每 200 筆走中央 adminScanYield 讓路(v6.242 手法)。聚合與映射的欄位程式碼逐字保留(口徑不變)。⚠ v1.19 已實測 15 秒幾乎全是 await 網路 I/O,事件迴圈不被佔住⇒ 不卡玩家;本版修的是 admin 白等與 Auth 請求量,並把 5 萬筆上限的同步映射段也掛上讓路。錦標賽區塊(第一支 /api/tournament 端點起至檔尾)逐位元未動,守衛以內嵌 sha256 鎖住。) | 前版 v1.31 (v6.272 Firestore 讀取減量【P1：admin 端止血】:站長回報 Firebase 免費額度逼近上限,而吃緊的是「讀取數」。三處止血 —— /api/admin/firebase/rooms 加伺服器端上限(比照 v1.22 Oracle 分頁的哨兵做法,絕不靜默截斷);每房 count() messages 改預設不算(?msgCounts=1 才算);feedbacks 全撈改快取(比照 v1.19 getUsersStatsCached)。⚠⚠ 並更正 v0.20 那行錯誤註解:Admin SDK 繞過的是安全規則,讀取照樣計費。) + v1.30 (v6.269 admin「📡 監控」分頁的【🎮 休閒對戰批】子表:站長交辦「把休閒批加進 admin 的 📡 分頁」——v6.261 只做在 dump 的【②-e】區塊,站長每次要看得跑 dump-monitor.bat。⚠ 複驗 v6.261「後端已備好 ?mode=casual」這句話:**只成立一半** —— `_wantCasual`/`q.mode` 確實有,但 `q` 只餵給 `rows`(.limit(120) 明細);byReason 的來源寫死 `_aggAll.filter(!isCasualReason)`、sampleRttRows 寫死 `mode:{$ne:'casual'}` ⇒ 帶了參數也**拿不到任何休閒統計**。⇒ 本版補一條**完全獨立**的路徑:新增 `_buildCasualDiagReport(coll,since,hours)`(＋`_casualUaShort`/`_casualQuant`,兩支逐字對齊 dump 的 uaShort/quant,守衛拿同一批 UA 對跑兩邊),端點在 `q.mode = …` 之後**早退**⇒ 錦標賽那一整段(byReason/slowRtt/sample/rows)**逐位元未動**(守衛以內嵌 sha256 4848 字元鎖住)。⚠⚠ **絕不可拖累錦標賽**(pm2 fork_mode 單 instance)⇒ 三道:①cursor 逐筆不 toArray;②每 200 筆走中央 adminScanYield 讓路(v6.242:cursor 只解決記憶體、讓路才解決時間);③硬上限 CASUAL_DIAG_SCAN_CAP=5000,超過回 capped:true(**不靜默截斷**)。實測(沙盒 5000 筆,正式 VM 約快 10 倍):總耗時約 31ms、讓路 25 次、阻塞 p50 1.1ms/p99 3.8ms;拿掉讓路的突變體讓路 **0 次**、max 阻塞 29~33ms。⚠⚠ **跨 IIFE**:helper 必須與中央 adminScanYield 同一個 closure(firebase-admin 區塊內),而端點在檔尾另一個 IIFE ⇒ 掛 `app.locals._buildCasualDiagReport`、handler 執行時才取(v0.94/v1.01 兩次線上事故;本版實際踩到,是既有守衛 test-admin-helper-scope 的 acorn 掃描抓到的),取不到一律 **fail-closed 回 503**。⚠ 早退排在 isTournAdmin gate **之後**(休閒明細含玩家 email)。回應帶哨兵 `casualApi:1` ⇒ 畫面分得出「伺服器舊版」與「真的 0 筆」。⚠ 沒有新端點/新 collection/新索引(沿用 tournamentClientDiag 與 7 天 TTL)。⚠⚠ admin 畫面上**印出**四條判讀警語:①母體不同不可相加或比較 ②只有已登入 email 帳號的休閒玩家會送 ③倖存者偏差(要 10 發成功推送才送得出指紋 ⇒ 上行完全爆掉的人看不見) ④「對手棄權」是頻率下界不是上界。⚠ 玩家端零改動(src/ 只動 version.ts)) + v1.29 (v6.268 休閒 PUT 上行增量【伺服器端先行】:新增 PTCG-DELTA-PUT 區塊 -- 收 {patchProto:1,patch,fullHash,expectedVersion},套在 DB 現 doc 的 client 視角上重建全量、canonical hash(遞迴排序鍵)複驗後原樣交給既有核心 PUT;GET /api/rooms/:code 回應加哨兵 deltaPut:1(=kill switch,撤 _DELTA_PUT_ENABLED 全站自動回全量);任何一步失敗回 deltaReject 讓 client 送全量;本版 client 還不會送 patch,玩家完全無感;落庫仍是全量 doc、下行一個字不動) + v1.28 (v6.266 套牌戰績【伺服器端 P1】:玩家許願「牌組列表的 ✕ 旁邊放一個 🔍,看這一副牌的休閒勝率/錦標賽勝率/對各原型勝率」,且「勝敗紀錄跟著套牌走,更新套牌不重置、按 ✕ 刪除才消失」。⭐**跟著檔案走天然成立、零遷移零覆寫**:Deck.id 早就是 client 端 crypto.randomUUID() 的穩定 UUID(src/lib/decks/storage.ts:65-80),upsertDeck 依 id 就地更新(:47-56)⇒ 編輯不換 id;複製/匯入走 newDeck()=新 UUID ⇒ 勝率天然不跟。既有牌組全部都有 id。本版只做**伺服器端**三件事(站長同意 server 先上;白名單會丟掉 client 送來的新欄位,順序反了 client 上了也收不到):①makePlayerDoc 白名單收 deckId ——⚠⚠**沒送就一個位元都不動**(絕不寫 deckId:null;欄位缺席才是「舊列/本機對戰」的唯一表示法,寫 null 會被 sparse 索引收進去),守衛用 JSON.stringify 逐字比對證明舊 payload 產出的 doc 與 v6.265 逐位元相同(含 key 順序);②**房間 seat enrich**併進既有那一發 findOne(projection 加 seats.deckId)——⚠⚠不能只靠 payload:/api/match-result 是 $setOnInsert,只有先送到的那一發會落地,而每個 client 只知道自己用哪一副牌(對手的 deckId 在對手的 localStorage)⇒ 只靠 payload 慢的那一側永遠缺;成本=**零額外查詢**(v6.220 起 seats[].email 不下發玩家端 ⇒ 線上 client 送來的 email 一律 null ⇒ 那個條件本來就恆真、這一發本來每場就會發);seats[].deckId 是**下一版 client 才會寫入**的欄位,現在補不到就什麼都不寫;③新端點 **GET /api/deck-stats?deckId=**(免登入+per-IP 30/min 限流:deckId 是猜不到的 UUID=憑證,而牌組存在玩家 localStorage、伺服器根本沒有「這副牌屬於誰」的對照,要求登入也判不出誰有權看)。⚠⚠**絕不可拖累錦標賽**(pm2 是 fork_mode 單 instance ⇒ 同一個 node 行程)⇒ 四道防線:(a)兩支 **sparse** 索引 {p1.deckId:1}/{p2.deckId:1}(⚠一定要 sparse:matchRecords 已 18.5 萬筆舊列沒有這個欄位,非 sparse 會把每一筆都以 null 鍵收進索引;sparse ⇒ **索引從 0 筆開始長**),比照 v6.240 只在服務啟動時建一次、不 await、.catch() 兜底,建構跑在 mongod 行程、node 端零阻塞;(b)⚠⚠**端點自驗索引存在,否則自我停用**(回 503 且不帶哨兵)——無索引=對 18.5 萬筆 COLLSCAN=上百 MB 的連續阻塞,絕不可以上;listIndexes 成功快取 60s、失敗退避 10s;(c)cursor 逐筆(不 toArray)+每 200 筆走中央 adminScanYield 讓路(v6.242:cursor 只解決記憶體、**讓路才解決時間**);(d)硬上限 5000 筆(超過回 truncated:true)+per-deckId 60s 快取+per-IP 限流。⚠休閒勝率口徑=**只算線上對戰**(站長裁定):沿用中央 buildCasualCleanFilter ⇒ roomCode 有值才算(vsAI 與本機雙人一律不計入)、離開場只排除 finalTurn<=2。⚠⚠buildCasualCleanFilter 回傳的物件**自己就帶一個 $or**(離開場那條),deckId 的 $or 直接塞同一層會把它整條覆蓋掉 ⇒ 一律用 $and 併。⚠⚠對手原型**不可以**把 cardCounts 物件直接丟給 archetypeNameOf:它第一行是 `if (!entries || !entries.length) return null`,那是為 deckEntries **陣列**寫的;matchRecords 存的是 cardCounts **物件**,.length 恆為 undefined ⇒ 每一筆都回 null、整張表靜默全空(不報錯、不 500,只是永遠沒資料)。⭐修法是**轉形狀不是抄一份分類邏輯**:先把 {cardId:張數} 轉成 [{cardId,count}],再走 v6.229 的**中央** archetypeNameOf ⇒ 全站分類語義只有一份(抄第二份會讓同一副牌在不同畫面被分到不同原型,也會讓 v6.229 守衛的單一錨點突變測試失效——那支守衛在本版實際抓到過我);端點放在同一個 IIFE 內也是這個理由。⚠端點回應帶哨兵 **deckStatsApi:1**,下一版 client 用 typeof===number 判斷伺服器支不支援,缺席就把放大鏡整個藏起來。⚠**錦標賽勝率本版沒有資料來源**(要收得到得先讓 TREGS 報名紀錄與 tournamentArchives 的 players[] 也帶 deckId,那會動到錦標賽寫入路徑)⇒ 回 tournament.status=`not-collected` 讓 client 顯示「累積中」,而不是顯示 0 勝 0 敗騙玩家。⚠**既有牌組不做歷史回填**(回填只能靠「email+60 張完全吻合」的近似比對,會誤配到別人的牌組)⇒ 回應帶 since:`v6.266`,UI 之後要明講「自 v6.266 起計」。⚠白名單建構:回應只有數字與**原型名稱字串**,對手的 email/暱稱/房號/牌表一個位元都不出去。⚠⚠全程沒有任何刪除或改寫既有資料的路徑:matchRecords 舊列一筆不動、沒有 deleteMany、沒有 TTL、沒有欄位改寫;錦標賽區塊**逐位元未動**(守衛以 diff 證明)) + v1.27 (v6.261 休閒對戰終於有診斷指紋:client 端的 _tSendClientDiag 從 v0.77 起開頭就是 `if (!isTournament || isTournSpectator || !tActiveRoom) return;` ⇒ tournamentClientDiag 這張表(含 v6.213 的健康對照組)**從來只涵蓋錦標賽路徑**,而休閒對戰佔全站 94% 流量 ⇒「dump 裡沒有」不等於「沒發生」(對手誤拿棄權勝量不到頻率、v6.245~v6.249 的休閒同步修正沒有任何線上資料可驗成效)。本版**不新增端點、不新增 collection、不新增索引**:休閒批走同一支 POST /api/tournament/clientdiag、同一張 tournamentClientDiag、同一個 7 天 TTL,靠 reason 的 `casual-` 前綴分帳(casual-slow-push／casual-perf-sample／casual-forfeit-claim)。⚠⚠ **兩批數字永遠不可以相加**(休閒是 client-authoritative、每動作上傳整包盤面 40~48KB;錦標賽是 /action ——母體不同):①insertOne 多寫一個 mode 欄位(casual|tournament,由 reason 前綴推導);②GET /api/tournament/admin/clientdiag 預設只回 mode!=casual(`q.mode = {$ne:'casual'}`,**舊列沒有這個欄位也會被 $ne 收進來**⇒ v6.260 以前的每一個數字逐字不變、可以跟舊 dump 對帳),要看休閒批得明確帶 ?mode=casual;③byReason／sampleAgg 在 aggregate 之後先整批濾掉 casual(既有那兩行 filter 一個字都沒動);④sampleRttRows 的查詢補 mode:{$ne:'casual'}(SAMPLE_REASONS 新增了 casual-perf-sample,不補就會污染健康對照組)。⚠ 容量:休閒批每場最多 3 發、每個頁面實例最多 6 發,client 端還有 10% 的取樣骰與「p95≥5 秒才報」的門檻;以線上實測的房間量級推估約 +30~100 筆/日,7 天 TTL 下 collection 由約 5 千筆成長到約 1 萬筆 ⇒ 既有 {ts:1} TTL 索引的範圍掃描仍在毫秒級,**刻意不加新索引**(寫入放大換不到可觀測的收益)。⚠⚠ 玩家端熱路徑零接觸:寫入仍是既有那一支 fail-silent 端點,沒有任何新的同步工作) + v1.26 (v6.244 賽事日期的時間基準更正:名人堂/個人戰績/奪冠報告圖顯示的「日期」原本取 finishedAt=**冠軍產生時間**,但網站賽 21:00(台灣時間)開打、決賽常打過台灣的午夜 ⇒ 8/26 舉辦的賽事會被記成 8/27(站長回報:網站賽-95)。改以 **startedAt=開賽時間**(_seedEventBracketImpl 寫入,語義=報到結束、賽程產生、第1輪開打)為賽事日期。⭐**純顯示層、零資料遷移**:①recordChampion 從本版起多寫一個 startedAt(新欄位,既有 874 筆一個欄位都沒改寫);②/api/tournament/champions 對「缺欄的舊紀錄」在**讀取端**用同一場賽事的歸檔補(_id:{$in:[arch_<eventId>]},projection 只取 eventId/startedAt/createdAt,不碰 players/matches;沒有缺欄就完全不發這一發查詢 ⇒ 舊紀錄補完後這條路徑自動消失);③_aggregateArchives 顯示用的 date 改 a.startedAt||a.createdAt||finishedAt;④/api/admin/player-profile 的賽事列表多回 startedAt;⑤champions/restore-from-archive 的 $setOnInsert 補 startedAt。⚠ 刻意不動 winsAt/champOfficialAt/champCommunityAt/lastFinishedAt —— 那些不是顯示欄位,是排行榜同分時的近期性 tie-break,改了會靜默動到榜單順序。⚠ finishedAt 一個都沒拿掉:兩個時間的語義從此分開,註解逐處寫明「開賽時間」vs「冠軍產生時間」。⚠ 時區:顯示端(admin.html / src/lib/tournament/event-date.ts)固定 UTC+8 並用 getUTC*,不再吃執行環境時區(伺服器在新加坡剛好也是 +8,但玩家瀏覽器不一定)。⚠⚠ 全程沒有任何刪除或改寫既有欄位的路徑) + v1.25 (v6.243 `/api/admin/stats/players/:email` 的 `recentLimit` **查證後判定不必改**,本版只更正註解與內部文件。v6.242 的掃描筆記把這一支列為「同一份資料同時餵了常用卡 Top 20 ＋ 勝率走勢」——**寫錯了**。實測(守衛 scripts/test-v6243-player-detail-scope.mjs 把 handler 抽出來真的跑):①`recentLimit` 只套在 `find(...).sort({endedAt:-1}).limit(recentLimit)` 這一條,產物只有 `recentMatches`(畫面上的「最近 N 場對戰」表格)=純顯示;②`summary` 與 `topCards`(常用卡 Top 20)走的是**另外兩支 mongo aggregate**,`$match` 只有 email 條件、之後沒有任何 $limit/$skip/$sample ⇒ 本來就是該玩家的生涯全量;③個人戰績頁**根本沒有「勝率走勢」這個區塊**(admin.html 的 showPlayerDetail 只有總覽卡片＋最近 N 場表格＋常用卡 Top 20＋儲存的牌組)。⇒ 聚合程式碼、顯示上限、快取、口徑一律不動。⚠ 特別記下**不可以**做的那個修法:把顯示列表也改成全量 ——每筆 matchRecord 都帶雙方 60 張的 cardCounts,守衛的突變測試實測回應體積會變 **4.7 倍**(137 場的假資料:6,579 → 30,650 bytes),而 admin 只要點一次玩家 email 就會打這一支。⚠ 事件迴圈:這支 handler 的 node 端**沒有逐筆迴圈**(統計在 mongod 行程算完才回,node 端只物化 30+1+≤50 筆),沒有地方掛得上 v6.242 的中央 adminScanYield;守衛用「v6.242 那兩支偵測得到 cursor 迴圈」當正對照,證明偵測器不是安慰劑。⚠ `/api/admin/player-profile` 的 tournamentArchives `.limit(200)` 一併查證:全站 tournamentArchives 僅 875 筆(站長 2026-08-27 於 VM 實測),且該查詢有 `players.email` 過濾 ⇒ 單一玩家的上界就是全站賽事數,要撞到 200 必須是「一個人參加過全站 23% 的賽事」⇒ **現況不會失真,本版不動**,改以守衛鎖住「不得被改小、不得拿掉 email 過濾、projection 不得把 deckEntries 讀回來」。⚠⚠ 全程沒有任何刪除資料的路徑) + v1.24 (v6.242 休閒側 matchRecords 的 limit(20000) 移除,牌組原型【總表】/deck-archetype-stats 與【明細】/deck-archetype-detail 的休閒來源改 cursor 逐筆全量:與 v6.240/v6.241 同一類——這兩支是**統計聚合**(原型使用次數/勝率、原型內每張卡的採用率與條件勝率差),限制筆數不是「少顯示幾列」而是讓統計數字本身失真(只算最新 20000 場)。聚合程式碼一字未動,只換「資料怎麼來」。⚠⚠ 但這一支與 v6.241 有一個關鍵差異:**cursor 解決記憶體(O(1))、不解決時間**。實測(bench 腳本附在守衛內):mongo 一批(16MB/443B 約 8000 筆)進到 node 之後,批內每次 cursor.next() 都是**已解決的 promise**,await 只排空 microtask、事件迴圈不會去跑玩家的 socket 回呼 ⇒ 純 cursor 仍會整批連續阻塞(沙盒 20 萬筆:阻塞 max 200ms、p50 172ms)。⇒ 新增中央 adminScanYield():每 200 筆 setImmediate 一次(check 階段的 macrotask,會讓 pending I/O 先跑) ⇒ 同一份資料阻塞 max 降到 14.8ms/p99 6.6ms(沙盒;正式 VM 約快 10 倍 ⇒ 約 1.5ms),總耗時只多 1.5%。⚠ 對照:**改前**的 limit(20000).toArray() 其實是一發 470ms 的連續同步阻塞(沙盒),所以這一版是連玩家端的既有風險一起修掉,不是新增風險。⚠ 保留既有 ?since(全部時間/7/30/90 天,預設全部時間)不另起爐灶、60s TTL 快取與 buildCasualCleanFilter淨化規則一律不動;scanned.casualMatches / scannedSrc 誠實回報實際掃了幾筆。admin.html 的 MI_SCAN_CAP.casual 由 20000 改 Infinity(兩個資料源都已無查詢上限,留著 20000 會在matchRecords 超過 2 萬筆之後永遠誤報「已達伺服器查詢上限」而關掉趨勢箭頭)。⚠⚠ 全程沒有任何刪除資料的路徑) + v1.23 (v6.241 牌組原型【統計】與【明細】兩支端點移除 tournamentArchives 的 limit(200):與 v6.240 同一類毛病——那兩支都是**統計聚合**(原型使用次數/勝率、原型內每張卡的採用率與條件勝率差),限制筆數不是「少顯示幾列」而是讓統計數字本身失真(只算最新 200 場歸檔)。⚠ 兩支都改 cursor 逐筆吃、**不 toArray**:歸檔 doc 含 players[].deckEntries(每場 N×60 張),整包讀進玩家共用的 node 行程正是 v6.240 抓到的 1.1GB 事故;回應大小只跟原型數/卡種數有關,與掃幾場無關。⚠ 刻意不搬去 mongo aggregate:分類走 node 端 deckToSets/classifyDeck,搬過去會變成兩份口徑、同一副牌會被分到不同原型。明細端點新增 scannedSrc(掃了幾筆來源資料)當儀器;admin.html 的 MI_SCAN_CAP.tourn 由 200 改成 Infinity(否則歸檔一超過 200 場就會誤報「已達查詢上限」)。⚠ 休閒側的 limit(20000) 維持不動(不在本次裁定範圍),MI_SCAN_CAP.casual 仍會誠實示警。⚠⚠ 全程沒有任何刪除資料的路徑) + v1.22 (v6.240 admin 兩支「撈太多」的端點改伺服器端分頁:①/api/admin/oracle/rooms 已結束房 8 萬多筆、原本 find().toArray() 無上限且 projection 帶 gameState.log⇒ 一次回數百 MB、admin 分頁當掉;改 skip/limit 分頁(每頁 50)+updatedAt 時間範圍(7d/30d/90d/all)+伺服器端搜尋(房號/房名/玩家名/email/卡名,卡名→cardId 解析在伺服器端沿用 v6.218 手法)+lazy createIndex{status:1,updatedAt:-1};counts 套同一時間範圍;⚠沒帶 ?page= 一律走 v1.21 舊路徑(舊 client 零影響),回應帶 paged 哨兵讓新前端分辨舊伺服器。②/api/tournament/admin/stats 與 /api/admin/champion-report 的 limit(500) 是**統計失真**不是顯示截斷(賽事總覽/冠軍榜/玩家戰績/主力寶可夢使用率全在前端拿整包 archives 算):stats 改分頁+回 total,前端逐頁累積成全量再聚合;champion-report 直接移除 limit 並改 cursor 逐筆聚合(不把含 deckEntries 的全部歸檔讀進 node)。⚠⚠ 全程沒有任何刪除資料的路徑——tournamentArchives/tournamentChampions 沒有 TTL 索引、沒有 deleteMany、沒有任何排程會動它們,唯一的刪除點是 admin 手按的『🗑️ 刪除』(deleteOne)) + v1.21 (v6.229 admin「🎮 Oracle 對戰」房間列表的牌組標籤改用【牌組原型】分類——與一般對戰大廳同一份結果:registerDeckRules IIFE 內抽出中央 archetypeNameOf(entries,nameMap,rules)(回傳語義:字串(含'未分類')=有牌表且已比對完成;null=還不知道(沒牌表/卡名對照或規則庫沒載入)),/api/rooms-archetypes 的 nameOf 改為薄轉呼叫它(行為逐字不變,v6115 守衛照跑),另掛 app.locals._archetypeEnrichRooms 供 IIFE 外的 /api/admin/oracle/rooms 在 enrichSeats 後為每個 seat 就地補 archetype 欄位。admin 不套大廳「只限 playing/gameState.phase」兩條防狙擊限制——admin 本來就有 🃏 牌組 modal 可看整副牌,等待中/已結束房也要能分類(這也是不直接打 /api/rooms-archetypes 的原因:那支刻意不回非 playing 房,admin 的 ended 房會永遠「還不知道」)。handler 執行時才從 app.locals 取(v0.94 教訓),helper 未掛上或 enrich 失敗→不加欄位,admin 前端視同「還不知道」退回舊 ⚔️ 主力打手 badge(Firebase 分頁與舊伺服器同一條退路,行為不變)。效能:nameMap 全行程只載一次、rules 走 30s TTL(規則 CRUD 即 invalidateRulesCache),之後每副牌只是純記憶體 set 運算,整份列表一次 enrich 不做 per-seat await;守衛附 benchmark(Rule 32)) + v1.20 (v6.220 休閒對戰減量+隱私兩件:①對戰紀錄 gameState.log 增量下發——log 佔房間 doc ~60% 且隨對局線性成長(第9回合202則≈29.2KB),而輪詢絕大多數回應的 log 前綴與 client 已有的逐字相同。新 rooms-out middleware 包裝 res.json:client(v6.220+)輪詢帶 logSince=<已有則數>&logh=<前綴鏈雜湊(FNV-1a 雙32bit,每則 JSON.stringify 逐字元+分隔符)>,伺服器對自己 log 前 n 則算同款雜湊**逐字相同才**把 log 換成 log.slice(n) 並附 logDelta{since,total,fh};fh=完整 log 的鏈雜湊,client 重組後必須複驗,驗不過丟棄並立刻改抓全量(端到端第二道防線,擋中途突變/競態/演算法漂移)。fail-open 全表:舊 client 不帶參數/參數解析不了/悔棋致 n>len/等長但前綴雜湊不同/gameState 或 log 缺席/轉換任何例外→一律回全量,行為與 v6.219 逐字相同;auth/404/?since=ver 的 204 全部留在核心端點,本層只轉換「已要送出的 body」。⚠沿 v0.71 教訓:只動下發、**不動儲存**——房間 doc 的 log 仍完整,回放/悔棋/finalLog 不受影響。②seats[].email 不再下發玩家端(GET /api/rooms/:code、GET /api/rooms、PUT 回應、v1.17 combined 列表全剝;它原本會把對手/觀戰者/大廳所有人的 email 下發到別人的瀏覽器,4房實測2房有)。DB 內保留(admin 以 email join 三邊)。配套A:PUT 寫入前把 DB 既有 seat.email 回填進 incoming seats(uid 相同且 incoming 沒帶時)——client 是「GET 整包→改→PUT 整包」,GET 剝掉後寫回會把 DB 的 email 洗光,回填才守得住。配套B:/api/match-result 改由伺服器從房間 doc 補 p1/p2 email(新舊 client 讀到的 seats email 都已是 null;舊 client 若有送 email 以送來的值優先=行為不變);admin 端點 /api/admin/* 不經此層、完全不受影響。⚠hoist 同 v1.11/v1.16/v1.17;兩支 mw 有任一沒 hoist 成功則整組停用(旗標),避免「GET 已剝但 PUT 沒回填」的半套狀態把 email 洗掉。pm2 log 驗證行:`[rooms] rooms-out transform middleware (v1.20) hoisted=true`) + v1.19 (v6.219 admin 總覽提速:/api/admin/stats 的 users 統計改快取——nginx 計時 log 全站最慢前三筆全是這支(14.7~15.9 秒,全部耗在 node)。真因:adminAuth.listUsers(1000) 逐頁抓全部使用者(上限 50,000=50 頁),每頁一趟**循序** HTTPS 往返≈50×~300ms≈15 秒。⚠實測判定是 await 網路 I/O 非同步阻塞:同步聚合段 50k 筆沙盒僅 ~51ms(≈VM ~5ms)、50 頁循序 await 重演期間事件迴圈超額延遲 max 1.7ms ⇒ 不卡玩家(pm2 fork 單執行緒也安全),慢的只有 admin 這一發;但每開總覽就白等 15 秒+對 Firebase Auth 打 ~50 發。修:比照 v0.95 users-all 先例=5 分鐘 TTL+single-flight+過期先回舊值背景刷新(除進程重啟後第一發外 admin 不再等掃描);⭐掃描與聚合程式碼一字未動(口徑不變),只改「何時算」;回應多帶 users.at,admin 總覽標示資料時間;oracle/firebase rooms/feedback 統計不快取維持即時) + v1.18 (v6.218 牌組公布欄關鍵字搜尋:GET /api/deck-posts 新增 ?q=——空白(含全形)分隔多 token 一律 AND;單 token 命中=牌組名/作者/簡介/原型名 含該字 ∨ 牌組內含「卡名含該字」的卡 ∨ 該篇留言含該字,全部部分比對。⭐卡名→cardId 解析放**伺服器端**:TPOOL 就是完整卡池(含官方 name),不必叫 client 為搜尋載 4.6MB 卡片DB、也沒有 id 清單塞爆 URL 的問題。留言命中=先查 deckPostComments distinct postId 再併主查詢(一次 distinct,不是每篇一查的 N+1)。⚠q 缺席時 tokens=[],查詢物件與舊版完全相同 ⇒ 列表既有行為零影響;⚠快取鍵改用 [sort,page,pageSize,arche,tourn,tokens](RegExp 經 JSON.stringify 會變 {} ⇒ 不同搜尋會撞同一鍵,$regex 一律用字串形式);搜尋另設 60/min per-IP 限流;回應恆帶 q 欄位當哨兵——舊伺服器沒有,前端據此明講「伺服器尚未支援搜尋」,而不是靜默回未過濾列表騙玩家。中文部分比對用 $regex 不用 text index(mongo 中文分詞切不出詞);現量級 96 篇投稿/26 則留言,regex 在 {status:1,createdAt:-1} 索引挑出的集合內過濾即可,不值得預算 searchBlob——過度工程) + v1.17 (v6.217 休閒大廳列表輪詢減量:新 middleware 攔 GET /api/rooms?status=lobby,playing——①合併:client 一發同時要 lobby+playing($in 查詢,與核心端點同 projection/sort),大廳輪詢請求數砍半;②增量化:回應帶內容 digest h,client 下一發帶 ?h=,內容沒變回 204 零 body。digest 全欄位計算、只剔已知噪音欄位(updatedAt/_version/對局協商欄位;⚠lobby 房 heartbeats 保留——isLobbyHostDead 靠它,playing 房剔除),漏剔噪音只會多回 200 絕不 stale。⚠回應必帶 combined:true 哨兵:核心端點會把 "lobby,playing" 當字面值回空陣列,client 靠這個旗標分辨「新伺服器」與「舊伺服器」,拿不到就自動退回兩支舊輪詢(fail-open 不能靠 next()——next 會回空列表,v6.177 教訓:空列表會被誤讀成「伺服器權威說沒房間」)。⚠hoist 同 v1.11/v1.16;純函式 digest 零依賴(ESM host 無 require)。pm2 log 驗證行:`[rooms] combined-list middleware (v1.17) hoisted=true`) + v1.16 (v6.216 尖峰請求減量兩件(伺服器端):①gzip 壓縮等級 6(zlib 預設)→1(速度檔)——尖峰 115 req/s 幾乎全是輪詢 JSON,level 1 的壓縮 CPU 約為預設的 1/2~1/3,JSON 壓縮率仍有 ~5-7×(體積約 +15%),threshold 1024 與 SSE filter 全部保留;②休閒對戰聊天輪詢增量化——新 middleware 攔 GET /api/rooms/:code/messages?since=<ms>,用 findOne+projection 只判斷「有沒有比 since 新的訊息」:沒有→直接回 204(零 body);有→next() 交給既有端點回全量(回應格式/排序/limit 與舊行為逐字一致,前端合併零改動)。⚠fail-open 三層:舊 client 不帶 since/since 解析不了/middleware 內任何錯誤→一律 next() 走既有全量端點,舊版聊天絕不會壞。⚠與 v1.11 gzip 同手法把 layer hoist 到第一個 route layer 之前(既有 messages route 註冊在 patch 之前,不搬永遠輪不到),搬不動就 warn 放棄(退化成全量,功能不受影響)。⚠hoist 到 route 之前拿不到 express 的 req.query→自己 parse query string;路徑判斷用 req.originalUrl/req.url 不用 req.path(同 v1.11 的 expressInit 原型問題)。pm2 log 驗證行:`[rooms] chat since-204 middleware (v1.16) hoisted=true`) + v1.15 (v6.199 錦標賽排行榜可看到前 20 名:/api/tournament/leaderboard 新增 ?limit= 參數(1~20)。⭐先定位再動手——五個榜「都只顯示前五名」的截斷點**不在前端**,前端的 each 是伺服器回幾筆就畫幾筆,真正的 slice(0,5) 有兩處、都在這支端點裡(topN 與 communityHost);只在前端加下拉會完全沒有效果。⚠**沒帶 limit 仍然回 5**:線上還有被 Service Worker 卡住舊 bundle 的 client,那些頁面照單全收伺服器回的筆數,預設放大到 20 會讓他們的版面無聲變長 ⇒ 向後相容優先,放大只發生在有明確要求的新 client。⚠**快取只存上限那一份**(_LB_MAX=20),回應時才切片 —— 若改成 per-limit 快取,每多一種筆數就多一次全 TARCHIVE 聚合;現在不管幾種 limit,60 秒內都只掃一次。⚠ 兩支 helper 與端點定義在**同一個作用域**(緊鄰 _aggregateArchives),沒有 v0.94/v1.01 的跨 IIFE 問題;都是純函式、無外部相依,守衛可以抽出來真的跑) + v1.14 (v6.189 收尾兩件事：①**棄賽情境的完賽公告不再說謊** —— checkRoundAdvance 在 winners 被濾成 0 時一律播「最後一場雙方皆未進場」，但 v6.188 之後同一個出口還有另外三種成因（兩人都棄賽 doubleDrop／時限平手 draw／本輪勝方全部棄賽被 dropped 濾掉），玩家看到的結論會與賽程表上的標記互相矛盾。改成依實際旗標措辭（新 helper noChampionReason）。⚠ 只改字：判定邏輯、旗標、寫入一個字都沒動；新增的 _droppedWinners 只是計數，不參與任何判斷。⚠ 刻意**不**分辨「未進場」與「雙方閒置逾時」—— 這兩件事在資料上共用 doubleNoShow 旗標（v6.156 只把『系統死角』拆出去），沒有旗標可判就不硬猜，措辭同時涵蓋兩者。②**/checkin 收進 seed 序列鎖** —— v6.188 只把新的 register-and-checkin 收進 runInSeedChain，既有的 /checkin 還停在 v0.46 的做法（讀 status → 寫 checkedIn，兩步之間沒有互斥）。殘窗是真的：報到端點讀到 status==='checkin' 之後、寫入之前，排程器可能剛好 CAS 成 bracket_ready 並開始 seed，而 seed 讀 TREGS 是在鎖內 ⇒ 那筆 checkedIn 寫得再快也已經來不及被讀到，玩家收到 200 卻沒被排進賽程（v0.46 想擋的正是這件事，但『端點要求 status===checkin』是一次**讀**、不是原子寫，擋不住）。收進同一條鎖之後兩者被序列化：報到先拿到鎖 ⇒ 寫入必定早於 seed 讀 TREGS；seed 先拿到鎖 ⇒ 報到重讀已是 bracket_ready ⇒ 明確 409。同一類臨界區從此只有一套做法。⚠⚠ 效能與死鎖都查過才收：鎖內只有 3 個本機 mongo 操作（重讀 status／讀 reg／寫 checkedIn），**權杖驗證 tournIdentity（會打 Firebase，是這支端點最慢的一段）與事件解析一律留在鎖外**；鎖內不呼叫 seedEventBracket/runInSeedChain，不可能自己等自己；runInSeedChain 對 rejection 有 `.then(()=>{},()=>{})` 兜底，單一報到失敗不會卡住整條鏈。報到尖峰 30~50 人同時按，排隊的是毫秒級 DB 操作，不是網路往返) + v1.13 (v6.188 錦標賽兩件事,共用同一份 TREGS 報名紀錄所以同版出:①**補報名＋直接報到** POST /api/tournament/register-and-checkin —— 報到階段對未報名者開放,驗證完全複用 /register(60 張/暱稱/coinPref/maxPlayers),**單筆 insertOne** 一次寫到位(checkedIn:true+lateJoin:true),不做兩段。⚠⚠ TOCTOU 用兩道關死:整段跑在 **seed 序列鎖 runInSeedChain** 內(與 _seedEventBracketImpl 讀 TREGS 互斥)+ **寫入後重讀 status**,已非 checkin 就把剛寫的 reg 刪掉回 409 ⇒ 只會有「被收進賽程」或「明確被拒」兩種結局,絕不會有「顯示成功卻沒排進賽程」。單靠重讀不夠——若 seed 已把 regs 讀進記憶體,刪 reg 也擋不住它把人排進去,序列鎖就是為了排除這個交錯。窗口關閉點沿用既有 checkin→bracket_ready 的 CAS,不新增關閉邏輯。既有報名者/被 autoRemovedConflict 剔除者一律 409。②**中途棄賽** POST /api/tournament/drop —— 採方案 B **移出配對池**(官方 Play! Pokémon 做法),不是「照排然後自動判勝」(照排會把棄賽者勝率打到 0.25 地板、拖累所有前對手的 OWP,且每輪隨機一人白拿 3 分)。⭐真因:src/lib/tournament/swiss.ts 的 dropped 欄位/pairSwissRound 過濾/buildSwissPlayersFromMatches 參數**早就全部寫好了**,只是 advanceSwiss 從來沒把 dropped 從 TREGS 傳進去 ⇒ 這一版就是把那條線接上。棄賽**不可逆**(本檔刻意沒有任何取消棄賽端點,誤按由站長後台處理);既有戰績保留、對手 OWP 不受影響(先 computeStandings 全員再 filter);Top Cut 種子濾掉 dropped;單淘汰的 winners 也濾掉 dropped;對戰中棄賽走既有 forfeit 收場;**兩人都棄賽用新旗標 doubleDrop,絕不重用 doubleNoShow**(v6.156 教訓:那旗標語意是「兩人都沒出現」,混用會讓對帳分不出掛機與棄賽);admin rematch 遇 dropped 玩家一律 409;歸檔補 dropped/droppedAt/lateJoin/doubleDrop/dropForfeit。⚠⚠**順手修一個現行就會炸的既有 bug**:存活 <=1 時 TENG.seedTopCut 回 [],而 mongodb 的 insertMany([]) **會 throw** ⇒ advanceSwiss 拋例外 ⇒ 賽事永久卡死。改為存活 <=1 直接判冠軍完賽(站長裁定③),並在兩個 insertMany 前都加空陣列守衛) + v1.12 (v6.184 玩家端診斷回報不再被靜默切掉:/api/tournament/clientdiag 的儲存上限 2048 → 8192 字元,並新增 truncated/rawLen 兩個欄位。真因是 v6.179 拆出 perf.res.seg 之後 payload 變長,最近一批 dump 有 16 筆剛好卡在 2048、全部集中在 v6.179/180/182 —— 被切掉的一定是尾端的 perf/env,而切過的字串不再是合法 JSON,/api/tournament/admin/clientdiag 建 slowRtt 表時對 JSON.parse 失敗是**直接略過** ⇒ 那幾列**不會出現在 RTT 表上**、且 perf 內容已毀,剛好毀掉尾巴最重那位玩家的全部四段資料。⚠ 上限不是拿掉是放大(它擋的是 client 灌爆 DB):實測 payload 結構上界約 4.1KB(非 svelteWarn 1.8KB + v6.171 的 svelteWarn.first 3×700 字元 2.3KB),8KB 有 2 倍餘裕;7 天 TTL 下實測 993 筆/週(~142 筆/日),放大後只有那 1.6% 的列會變長,總量由 ~744KB 升到 ~780KB,即使全部塞滿 8KB 也只有 8.1MB。⚠ 完全不影響頻寬——client 本來就送完整 payload,上限只決定**存多少**。⚠ truncated/rawLen 一律寫入(不是只有被切時才寫):欄位缺席只能代表「這是舊列」,不可以被讀成「這列沒被切」) + v1.11 (v6.178 休閒對戰終於有 gzip:v0.72 加了 compression、v0.75 修好了「載入」(ESM host 沒有 require),但**順序**一直是錯的——oracle_admin_update.sh 把整段 patch 插在 app.listen() 之前,而 /api/rooms、/api/rooms/:code(含 PUT/DELETE/messages)全部是在 start() 裡遠早於本段就註冊完的;Express 依註冊順序逐層走 layer,掛在 stack 尾端的 app.use(compression()) 對這些路由**永遠輪不到**(它們在更前面就把回應 end 掉)。⇒ 佔全站 94% 流量的休閒對戰從頭到尾沒有壓縮:實測 /api/rooms/:CODE 26.9KB/req、/api/rooms 11.8KB/req,而有 gzip 的 /api/tournament/state 只有 1.9KB/req。修法:app.use 之後把剛掛上的 layer 從 stack 尾端 splice 到**第一個 route layer 之前**(不是 index 0——前面還有 Express 的 query/expressInit 與 cors/express.json,expressInit 才會裝上 express 的 request 原型)。⚠ 因此 filter 內一律用 req.originalUrl/req.url,**不准用 req.path**。⚠ SSE 兩道排除:Content-Type text/event-stream + 路徑以 /stream 結尾(/api/rooms/:code/stream 等),gzip 會緩衝、會把即時串流打死。⚠ 搬不動就原樣留在尾端並 warn,退化成 v0.75 行為,絕不讓服務起不來。驗證:pm2 log 有一行 `[tournament] gzip compression enabled (v1.11) hoisted=true`;false 就是沒生效。⚠⚠ 這一版**沒有**動 gameState.log 的儲存端截斷——回放在投降/時限/閒置判負場是靠房間 gameState.log 當 fallback,且快照的 logLen 是 finalLog 的索引,截了會缺行、也會對不上。) + v1.10 (v6.160 錦標賽報到的 client 版本閘:線上仍有停在 v6.141/v6.144 的 client(Service Worker 對 /tournament 是 cache-first ⇒ 卡住舊 bundle ⇒ 拿不到任何修正,而且會拖累對手)。報到是最好的攔截點——比賽還沒開始,重載零代價。後端只做三件事:①新灰度旗標 tournamentConfig.minClientVer{enabled,min}(**預設關閉且 min 為空 ⇒ 不擋任何人**),經 /event 回 minClientVer 給 client;②/checkin 收下並記錄 client 版本到 reg doc 的 clientVer;③admin GET/POST /api/tournament/admin/minclientver。⚠⚠⚠ **後端永遠不因為版本拒絕報到** —— 擋人的判斷全在 client 且處處 fail-open(沒設門檻/版本解析不了/剛按過更新仍太舊/報到剩不到30秒(v6.162 由 90 秒調整) → 一律放行),視窗上也永遠有『先不更新,直接報到』的逃生口。站長裁定:本站是練習站,可用性優先於版本一致性,寧可放一個舊 client 進來也不要把人擋在賽外。⚠⚠ 門檻**只對 v6.160 以上的 client 生效**——更舊的 bundle 根本沒有那段判斷程式碼、也不會送 ver;想找出那些人請看 clientVer==='pre-gate'(沒帶 ver 就是 v6.159 以下)。⚠ 門檻是十進位小數語義(見 src/lib/version-compare.ts),'6.15' 與 '6.150' 相等;admin 改門檻最長 ~13 秒生效(minVerConfig 10s TTL + /event 3s 共用快取)) + v1.09 (v6.159 只加量測不做效能修正:admin 的 clientdiag 端點把 client 新回報的 perf 區塊(tApi 四段拆分 token/網路/JSON解析/總計、tAdopt 採納耗時、tAdopt→下一個 animation frame 的重繪代理、longtask 統計)與裝置等級(hardwareConcurrency/deviceMemory)一起帶給 admin 監控分頁 —— 錦標賽的『卡』修了十幾版都在修伺服器,而伺服器指標一直全綠;新結論是瓶頸可能在 client 主執行緒,而 v6.151 的 rtt 從 tApi 進函式起算、包含 getIdToken 與 res.json() 解析,根本不是純網路時間。⚠ 舊版 client 的 payload 沒有這些欄位 ⇒ 一律可能是 null/undefined,顯示端必須容忍) + v1.08 (根治錦標賽「開局死角」:雙方都按過準備、盤面卻停在 setup 不開打。真因是 engine 的 tryAdvanceToPlaying 為 **edge-triggered** —— 只在 applyAction 的 4 個 handler 結尾被呼叫,本檔呼叫次數為 0。當「讓推進條件湊齊的最後一筆狀態變化」走的是不呼叫它的路徑(線上 setup 合併 mergeSetupMonotonic／CAS 寫回／版本 skew 補寫),而兩位玩家都以為在等對方、不會再送任何 action ⇒ 沒有任何人會來推它,房間就一路卡到閒置判負(v6.156 改判 pending-admin 待站長裁定)。⇒ 閒置掃描掃到 phase='setup' 的房間時,主動跑一次 TENG.tryAdvanceToPlaying(level-triggered);推得動就 **CAS 寫回**+bump 版本+更新 lastActionAt+在房間 log 留一則系統訊息,本輪不判任何人輸贏。推不動(條件真的沒滿足)則原樣落回 v6.156 的 pending-admin 行為。⚠ 需跑 update-tournament.bat 重建 server-engine.cjs(新 export);舊 bundle 沒有這個函式時 fail-open 並 warn 一次) + v1.07 (admin 監控分頁的後端:新增 GET /api/tournament/admin/clientdiag —— 把 client 端回傳的異常指紋(slow-rtt/stale-version/invisible-hand/setup-watchdog-repeat/manual-sync)整理成**各指紋的次數與受影響人數** + slow-rtt 的往返時間分佈 + 最近 N 筆明細。v0.77 起這些資料一直寫進 tournamentClientDiag,但**從來沒有讀的地方**——『很卡』的回報只能靠玩家口述還原,這支就是把它接出來) + v1.06 (玩家端盤面遮蔽改為**預設關閉的灰度旗標**(站長裁定:本站是練習性質不是專業競賽站,對手手牌被 devtools 看到沒關係;為了防這件事去動對戰核心路徑不划算)。旗標關閉時**玩家端**回應與 v6.149 完全相同(不遮、不剝 privateMessage、/state 認不出座位也不回 401)。⚠ **觀戰端不受旗標影響、永遠遮**——那是 v6.149 就有的既有行為(而且 v6.150 才把牌庫與獎賞一起補上)。/action 與 /join 的 verified 身分要求也保留:那擋的是「替對手送動作」,不是偷看,是會直接破壞別人對局的。開關存 tournamentConfig.redactState,admin 端點 GET/POST /api/tournament/admin/redact) + v1.05 (錦標賽 /state 長輪詢(預設**關閉**的灰度功能):版本相符時不立刻回,掛起最多 25 秒等盤面變動,盤面一變就立刻回 ⇒ 對手動作的可視延遲由「最多一個輪詢週期」降到 ~RTT,而且請求數反而下降(一發請求覆蓋 25 秒)。喚醒有兩條路:①/action 寫入成功後 in-process 通知 ②掛起期間每 1.5 秒自己查一次版本(保險——pm2 若是 cluster 模式,寫入與掛起可能在不同 process,通知跨不過去;scheduler 的判負/時限寫入也不經 /action)。掛起數有上限,超過就立即回、退化成原本的短輪詢。開關存 tournamentConfig.longPoll,admin 端點 GET/POST /api/tournament/admin/longpoll 可切換;**client 只有在伺服器宣告已啟用時才會送 wait=1**,所以旗標關著的時候行為與上一版完全相同。⚠ 開之前必須在測試站實測三件事:①pm2 是不是單一 instance ②cloudflared 隧道與 Express 會不會砍掉 25 秒的閒置連線 ③50 條掛起連線 VM 撐不撐得住) + v1.04 (錦標賽對戰收尾三項:①**伺服器權威 currentActorSeat**——/action 寫入時把 actorSeat 存進房間 doc 頂層,/state(含 unchanged 精簡回應)一併回傳,client 的閒置倒數**方向**改讀它、本地推算只當 fallback。根治 v6.149 事故的「我看到對方在倒數、伺服器其實在倒數我」鏡像:兩邊各自用自己那份盤面推算,只要 client 版本落後就必然對不上。②**判負前 60 秒警告**——推播給該動作方(client 全掛時 web-push 是唯一到得了的通道)+ 在房間 log 塞一則系統訊息(會 bump 版本,順便打醒「還活著但版本卡住」的 client);per-match 原子搶占冪等,**不動 lastActionAt**(動了等於幫掛機方把倒數重置);只在最後 60 秒才讀完整 doc,v6.119 的降載不受影響。③建局/重建房時一併寫入初始 actorSeat) + v1.03 (錦標賽玩家端盤面遮蔽:/state 與 /action 原本直接回整份 gameState,只有 /spectate/state 會蓋手牌 ⇒ 對戰中任一方能讀到對手的手牌內容、牌庫順序、獎賞內容(roomId 由 /bracket 公開回傳,連猜都不用猜)。新增中央 _stateForSeat:只遮對手的 hand/deck/prizes 內容(長度與 iid 一律保留);game-over 攤牌不遮;面朝上的獎賞不遮;效果已合法揭示給我看的卡不遮(pendingSelection/pendingChainQueue 中 actorIdx=我 且 sourcePlayerIdx=對手者,但 concealed=true 的「不看正面」一律不放行);火箭隊的貓老大ex|高傲指令 picker 在 client 端攔截、那個時間點沒有 pending → 依卡面條件式放行對手牌庫頂 10 張。對手的 log privateMessage(搜牌/看牌的具體卡名)一併剝除。座位只認 verified(Bearer token 驗過)的 uid——/state 回應本來就含 seats(=雙方 uid),若採信 playerId fallback 任何人都能填對手 uid 換到未遮蔽盤面;同理 /action 與 /join 在正式賽房改為一律要求 verified(未驗證身分本來就能替對手送動作)。/spectate/state 收斂到同一條出口(原本只蓋 hand,牌庫順序與獎賞照送)並拒絕當事人觀戰自己的房。認不出座位的正式賽房請求回 401(不回一份連自己都遮的盤面);無 matchId 的測試房維持原行為) + v1.02 (修「點了支援型寶可夢卻沒從未分類清單消失」:真根因在前端 —— POST /admin/support-pokemon **漏帶 Content-Type: application/json**(全站 20 個 POST 只有這 2 個漏),express.json() 因此不解析 body → 後端 req.body.names 不是陣列 → 舊寫法『不是陣列就當空陣列』**靜默把整份清單存成空的、還回 ok:true**,使用者只看到「點了沒反應」且完全查不出原因。後端改為:body 未被解析 / names 不是陣列一律回 400 並講明原因 —— 「使用者要清空」送空陣列,與「body 沒收到」必須分得出來;前端則在 api() 統一自動補 header(字串 body 才補,FormData 不能碰)) + v1.01 (hotfix:牌組原型統計一按就『getCardNameMap is not defined』——v1.00 新增的 getPokemonNameSet() 定義在所有 IIFE 之外,但它呼叫的 getCardNameMap 當時還關在 registerStatsEndpoints 的 IIFE 內,外層看不到 → 整個 deck-archetype-stats 端點 500。把 getCardNameMap + _cardNamePromise 一起移到外層(IIFE 內原有 caller 靠閉包仍讀得到,與 v0.94 同一手法)。⚠這是 v0.94 的鏡像事故:當時是『helper 在 IIFE 內、caller 在外』,這次是『helper 在外、它依賴的東西在 IIFE 內』。node --check 只驗語法、既有守衛只逐一點名少數 helper,兩者都抓不到 → 本版把守衛改成**通用**掃描:凡定義在 IIFE 外的函式,其呼叫到的本檔函式必須也在外層可見) + v1.00 (牌組原型「未分類高頻卡」只列**寶可夢**+可維護的「支援型寶可夢」排除清單:原本把老大的指令/莉莉艾的決意/基本能量這些每副牌都有的通用卡也列進去,對「該開什麼新規則」毫無鑑別度。①卡片屬性表補 isPokemon(⚠supertype 值是 'Pokemon' **沒有重音**,寫成 'Pokémon' 會整份比不中變空清單) ②新增 getPokemonNameSet() 把 cardId→卡名 與 cardId→屬性 接起來(cardFreq 的 key 是卡名不是 cardId) ③新 collection deckRuleSettings 存支援型清單(吉雉雞ex/喵喵ex 這類功能性寶可夢同樣沒有鑑別度),存 mongo 而非寫死因為環境會變 ④端點 GET/POST /admin/support-pokemon,改清單即清統計快取。⚠**先過濾再 slice(20)**——反過來會先被通用卡佔滿名額) + v0.99 (Wilson 更正 v0.98 的選擇:社群賽開辦通知**跳過正在對戰中的玩家**。新增 getBusyUids() 同時查錦標賽 TMATCH(status:playing 的 p1uid/p2uid)與休閒 rooms(status:playing 的 memberUids/hostUid);⚠休閒房必須加 updatedAt 15 分鐘時間窗——status:'playing' 會有殭屍殘留(startZombieRoomCleanup 正在清的就是這種),不加時間窗的話一個幾天前卡住的房間會讓那兩位玩家從此永遠收不到通知。broadcastPush 的 excludeUid/excludeUids 合併成單一 $nin 避免條件互相覆蓋) + v0.98 (社群賽開辦通知:玩家發起社群賽時廣播推播給全站(排除發起者本人、已關閉此類通知者不推)。新增 broadcastPush(推給所有訂閱者,對比 sendPushToUids 是推給指定 uid)+ /push/prefs 端點(偏好**必須存伺服器**——推播是伺服器主動發的,只存 localStorage 沒有意義;同一玩家多裝置用 updateMany 一次更新,偏好是人層級不是裝置層級)。⚠欄位缺席視為開啟($ne:false),因 Wilson 裁定新通知預設開,否則既有訂閱者全部收不到=功能等於沒上線。單次推播 cap 500 防訂閱數暴增時送爆) + v0.97 (Wilson 裁定取消社群賽發起者冷卻:原本的 30 分鐘冷卻其實從未生效——判斷依據 myLast[0].finishedAt,但全檔 12 個 status:'finished' 的寫入點沒有任何一處寫過 TEVENTS.finishedAt,線上行為一直都是沒有冷卻。整段移除讓程式碼與實際一致,不留誤導人的死碼;濫用防護仍靠「全站同時僅 1 場社群賽」) + v0.96 (修 admin 賽事統計的『官方賽/社群自辦賽』篩選完全無效——每一場都被歸成官方賽:/api/tournament/admin/stats 的 archives.map **沒有把 communityEvent 回傳給前端**(歸檔本身有存),前端拿到 undefined 自然全判官方。一併補回 format。通則:新增前端篩選條件時必須回頭確認端點有回傳該欄位,已加資料契約守衛) + v0.95 (玩家帳號改「伺服器一次撈完＋5分鐘快取＋single-flight」端點 /firebase/users-all:原本前端自己跑 while(pageToken) 迴圈、每頁還只抓 100 筆,帳號一多就是十幾次瀏覽器↔VM↔Firebase 往返 → 載入極慢;伺服器端單頁可抓 1000 筆且與 Firebase 延遲低一個量級。這同時根治「名單重複顯示」:前端兩條路徑(primeEmailMap 背景預熱 + loadUsers)各自寫 allUsers 又不共用 guard,先開房間分頁再進玩家帳號必定整批 concat 兩次) + v0.94 (hotfix:buildCasualCleanFilter/getCardAttrMap 兩個 helper 誤放進 registerMatchRecords 的 IIFE 內,而牌組原型【統計】與【明細】兩個端點在該 IIFE 之外 → 一點就 ReferenceError『buildCasualCleanFilter is not defined』。移到 IIFE 之前的外層(IIFE 內既有 caller 靠閉包仍讀得到)。⚠node --check 只驗語法、單元測試只抽函式文字執行,兩者都抓不到跨 closure 的作用域問題;已補結構守衛斷言 helper 必須定義在 IIFE 之外) + v0.93 (Wilson 拍板:牌組原型多規則同時命中時改用【條件較嚴格者優先】自動判定,不必再手填優先序。嚴格度=includes+excludes+includeIds+excludeIds 的條件總數(更多約束=更特定=優先);優先序降為同嚴格度時的 tie-break、UI 隱藏但欄位保留。兩個統計端點新增 multiHit 計數(有幾副牌同時命中>=2條規則)——為 0 就代表規則本來就互斥、完全不用管優先序。⚠classifyDeck 是總表與明細共用的中央函式,兩者必須同版否則同一副牌會被分到不同原型) + v0.92 (牌組原型明細:GET /api/admin/deck-archetype-detail?ruleId= —— 點選原型後展開①代表 60 張(採用率排序+眾數張數+貪婪湊60,同名4張/ACE SPEC 1張上限,基本能量無上限)②只看獲勝場次的 60 張③【遺珠之憾】推薦。⭐遺珠指標**不是**沿用既有的全域卡牌勝率(那個被原型效應與玩家實力完全混雜、無法回答『這張卡值不值得放』),改用**同一原型內的條件勝率差**:含此卡的勝率 Wilson 90%單尾下界 − 不含此卡的勝率,自動壓抑小樣本;排除必含卡/基本能量/已進 60 張者,出現率窗口 8~60%、雙側樣本各 >=8。回應含 per-card n/inclusion/wr_with/wr_without 供人工判讀是否為子變體。單次掃描算完三塊,60s TTL 快取) + v0.91 (休閒統計淨化規則收斂 buildCasualCleanFilter 單一來源[原 regex 在 2.3 卡牌勝率與牌組原型統計各寫一份=漂移風險] + Wilson 拍板調整:『中途離開致勝』場改為【只排除 finalTurn<=2】,雙方各完成 2 個完整回合後(finalTurn>=3)的離開場仍納入統計——原本一律排除,會把「打到一半才斷線」的真實對局也丟掉。finalTurn 語義查證:engine 只在後攻結束回合時 +1,故 turn>=3 ⇔ 雙方各完成 2 回合) + v0.90 (玩家總覽補「曾使用過的暱稱」:跨四個來源彙整去重——休閒對戰顯示名(matchRecords 該側 name,用 $addToSet 併進既有 aggregate 零額外查詢)、錦標賽報名暱稱(TREGS)、賽事歸檔當時暱稱(TARCHIVE players[].name)、Firebase 帳號顯示名;每個暱稱標來源與最後使用時間,依最近使用排序) + v0.89 (admin 牌組原型統計:GET /api/admin/deck-archetype-stats?source=casual|tourn|all —— 依 deckRules 分類每一副牌,回每個原型的使用次數/勝/負/平/勝率+未分類彙總+未分類高頻主力卡(供 Wilson 就地開新規則)。休閒源 matchRecords 沿用既有淨化規則(只算有房號的對戰以排 AI/本機、排除中途離開致勝場、可設 since);錦標賽源 tournamentArchives(排除 bye/無勝方);兩者分開統計並排顯示。統計即時算+60s TTL 快取(規則一改即刻生效,免重算批次);比對走批次2 的同一份 deckMatchesRule 不另寫) + v0.88 (admin 牌組原型規則引擎:新 collection deckRules{name,includes[],excludes[],includeIds[],excludeIds[],priority,enabled} + CRUD + 命中預覽端點。規則以【卡名】比對(Wilson 拍板:同名 reprint 極多,用 cardId 每條規則要枚舉所有印刷版本且新卡一出就靜默失準),必要時可用 includeIds/excludeIds 鎖特定印刷版本。cardId→卡名對照從 tournament-pool.json lazy 載入(CJS/ESM 雙寫法,v0.75 教訓)。preview 端點對最近 N 場休閒對戰即時試算命中數,讓 Wilson 存檔前就發現打錯卡名。統計端點在批次3) + v0.87 (admin 玩家總覽:新增 GET /api/admin/player-profile?email= —— 一次回該玩家跨【休閒對戰(matchRecords)／錦標賽(tournamentArchives)／意見回饋(Firestore feedbacks)／儲存牌組數】的完整摘要,供 admin 任一頁點 email 直接開玩家檔案。四路平行查詢無 N+1、TARCHIVE 以 projection 排除 deckEntries 大欄位、per-email 30s 記憶體快取(比照 leaderboard 60s 先例);明細一律由既有端點懶載,不在此端點膨脹) + v0.86 (推播診斷+缺口修補:①GET push/status 回本人訂閱筆數/通道host/登記時間/現行VAPID公鑰前綴 ②POST push/selftest 由伺服器實際推一則給自己並回 per-endpoint statusCode(60s節流)——這兩支才能分清『訂閱沒登記到伺服器』與『有訂閱但推不到』 ③修缺口:admin 手動把賽事切到報到/進行中時,原本不推播、也不設 checkInDeadline/roundStartedAt(致報到階段永不結束、可進場推播與未進場判負全失效)→ 比照排程器自動轉換補齊 ④sendPushToUids 非404/410錯誤補 console.warn,不再全部靜默) + v0.85 (錦標賽推播通知 Web Push:只推②低頻事件[報到開始/本輪可進場],換手不推降載;web-push CJS/ESM 雙寫法+vapid.json 缺檔自動停用;訂閱端點 push/subscribe|unsubscribe|pubkey;失效訂閱 404/410 自動清;可進場用 enterPushedAt 原子搶占去重) + v0.84 (錦標賽:報名暱稱預填——/event 的 me 附上 lastName=最近一次報名暱稱[從已抓 myRegs 取最新,零額外查詢;從沒報過退帳號顯示名 id.name],前端未報名任何賽事時預填,免每次重打) + v0.83 (錦標賽對戰回放-半回合快照[Fable審補強:重賽deleteMany清舊快照/game-over不重存/濾舊格避混排/投降場finalLog+finalState讀房間fallback]+攤牌手牌獎賞+log逐步:snapshot 觸發由回合邊界改 activePlayerIndex 換手邊界=先攻/後攻各存一格+開局(setup→playing)格;key _t{turn}_p{active}唯一(與舊 _t{turn} 不衝突);新增 logLen 存 log 長度→前端逐步切片 finalLog 讓對戰log跟隨回放進度;/replay 依 logLen 排序回 activePlayerIndex+logLen) + v0.81 (錦標賽對戰回放-Phase1後端:①逐回合盤面快照存獨立 collection tournamentReplayTurns(不塞TMATCH避免既有無projection查詢讀放大;TTL 90天自動過期;冪等upsert;/action 回合邊界 fire-and-forget 不await;strip log佔73%,逐回合文字由finalLog供);②公開 GET /replay?matchId= 回 snapshots+finalLog+finalState(攤牌不redact手牌,Wilson決策;gate:賽事已歸檔或該場done才開放,比照match-log)。純新增,不動對戰/判負熱路徑讀取。前端回放檢視器Phase2另做) + v0.80 (錦標賽:每場比賽顯示觀戰人數——觀戰者輪詢 /spectate/state 當心跳,記錄 per-room distinct uid(8s內),/bracket 每場 playing match 即時算 viewers 回傳(不含2位對戰者,他們走/state);前端賽程表 VS👁 旁顯示(N)=N人觀戰中。純顯示,記憶體心跳 map 上限200房+lazy prune) + v0.79 (錦標賽:①/bracket 支援官方+社群賽並行——前端改每個進行中賽事各抓一次(帶eventId,伺服器本就 per-eventId 快取);②/bracket 每場 match 補 roomId(僅 status='playing' 才回,done/pending 回 null 免殘留)供前端把觀戰按鈕併入賽程表 VS(點 VS👁 即觀戰);移除獨立觀戰清單輪詢降載,/spectate/list 端點保留向後相容) + v0.78 (錦標賽:輪空(bye)玩家的大廳也顯示本輪進場倒數+可觀戰提示——/event 回應新增 myBye{round,enterOpenAt};僅在無 myMatch 時以單一 $in 查詢我本輪 bye match(status=done,bye,p1uid=我),讓輪空者知道其他對戰何時開打、可去觀戰。純顯示不影響配對/判負) + v0.77 (錦標賽:新增 client 端診斷回傳端點 /api/tournament/clientdiag——client 只在真異常指紋[隱形手牌/setup看門狗連續觸發/手動同步]才回傳一小包,寫 tournamentClientDiag[TTL 7天自動清];tournIdentity 驗證+per-uid 60s 記憶體節流+body 2KB cap+fail-silent,與對戰路徑完全隔離不影響) + v0.76 (錦標賽:非報名者(已登入)聊天暱稱改用【最近一次錦標賽報名的暱稱=個人資料分頁名稱】,不再顯示 email 帳號名;從沒報過賽事才退回 email 前綴;5分鐘記憶體快取避免每則訊息查 TREGS) + v0.75 (錦標賽:修 v0.72 gzip 從未生效根因——整段 patch 包在 import().then(async) 內=ESM host 無 require,v0.72 gzip 只用 require 載 compression 拋 require-is-not-defined 被吞→gzip 沒開;compression 套件其實已裝。修:改比照 TENG 的 try-require→catch-dynamic-import 雙寫法,ESM host 用 await import。裝後 JSON 壓 6~9× 降頻寬改善進場 lag) + v0.74 (錦標賽：修 setup 開局「一方 mulligan 補抽後加備戰(mpb)、對手還沒放出場」時 currentActorSeat 因 mpb 最優先誤把 mpb 擁有者當唯一該動作者→3分鐘誤判他閒置敗,且對手放置UI被誤 gate 掉→deadlock(信諺vs慶仔實例)。修:mpb 但對手未 setupDone→回 -1(雙方都可動作、閒置判負不單判、mpb 鍵與對手放置 UI 都啟用),對手已 setupDone 才由 mpb 擁有者單獨;前後端 setupActorSeat 逐行同步) + v0.73 (錦標賽：修「官方賽已淘汰出局的玩家卻無法報名新社群賽」——防同時被兩場召喚的衝突判據,由『在其他未結束賽事有任何對戰』收緊為『有【進行中(status!=done)】的對戰』;已出局者(對戰皆done)不算衝突,可正常報名新賽事;仍在比者維持原行為[移出新場、保留舊場],Fable 三輪審過的並行防護不動) + v0.72 (錦標賽降載:回應 gzip 壓縮(防呆 require compression,未裝自動略過;SSE/小回應不壓;瀏覽器自動解壓前端不用改)——盤面/大廳/聊天 JSON 壓 ~6-9×降頻寬;VM 需 npm install compression 才生效) + v0.71 (錦標賽降載:對戰 log 佔完整盤面~73%(長對局累積數百行);/state /action /spectate 回應只送最近 60 行 log(TROOMS 儲存盤面+finalLog 快照仍完整);前端動畫游標改用 timestamp 偵測新事件故截尾透明) + v0.70 (錦標賽：官方賽與社群賽改為可【並行】舉辦——移除 v0.45 全域自動順延+propose 的官方賽避讓(1h/進行中禁辦);為避免同一玩家被兩場同時召喚,改在 seedEventBracket 開賽配對前移除「已在開賽時間較早且未結束的其他賽事報到」的重複玩家(保留較早的、取消較晚的=本場),標 autoRemovedConflict+公告) + v0.69 (錦標賽降載續:/event(大廳最重端點,原每呼叫8~12次mongo含N+1)共用重查詢加 3s TTL 快取+per-user改批次查詢;/bracket 的 standings 重算(O(n²)OWP/OOWP)加 3s TTL 快取(per event,含20上限淘汰)——輪次交替 ~50 人同時回大廳打 /bracket 不再各自重算,只算一次;currentRound/status 變即失效;per-user mine 回應時再貼) + v0.68 (錦標賽降載+社群:①/state 端點加 client 版本比對(v=cv)——相符只回精簡 unchanged(免序列化/傳輸整個 gameState),先以 projection 排除 gameState 取輕量 doc 比版本,不同才第二次查完整盤面→對戰中每 1.2s×N 人輪詢大降 CPU/頻寬/mongo傳輸;②/spectate/state 同加版本比對(相符免深拷貝蓋手牌);③對戰中大廳聊天輪詢由每 1.2s 改每 ~6s(前端);④聊天室放寬:賽事期間只要已登入即可留言(不限報名者,未報名仍顯示暱稱);⑤社群賽避讓官方賽事的禁辦期由開賽前 2h 縮為 1h) + v0.67 (錦標賽：修 setup 階段閒置判負漏洞——閒置判負原要求「雙方都已進場」才判,但 setup 時若一方已進場鋪好場在線等待、另一方掛著卻還沒按「進入對戰」,該掛著方逃過 3 分鐘閒置判負、只受 8 分鐘未進場保護→在線方空等且輪到自己時反被判(丞龍 vs 承瀚 實例)。修:setup 階段只要「該動作方」逾時未動作且【對手已進場】即判該方敗(currentActorSeat 於 setup 一律回未完成 setup 那方,故被判者必為掛著方);對局中維持雙方都進場才判) + v0.66 (錦標賽：大廳聊天室懶載入——/chat 改成 since=0/初始回「最新」一頁(原回最舊80則要多輪才追到最新、費流量又慢)；新增 ?before=ts 上滑載更舊 + hasMore 旗標；前端預設只載最新一頁，滑到頂才續載舊訊息，省流量+載入快) + v0.65 (錦標賽：admin 編輯賽事設定新增「賽制」選項——可在開賽前(draft/registration)把單敗淘汰⇄瑞士制互改+設瑞士輪數/TopCut;已開賽則 disabled 且後端 gate 回 409(賽程已依賽制產生)。/event/update 接收 format/swissRounds/topCut) + v0.64 (錦標賽：/event/status 端點加防護——已開賽/已結束(checkin/bracket_ready/running/finished)的賽事禁止退回 draft/registration[會讓排程器因 registrationCloseAt 已過而重新產生賽程、刪掉進行中對戰並從第1輪重排,毀掉比賽];回 409 提示改用強制結束後重建。Wilson 手滑在進行中賽事按「開放報名」觸發) + v0.63 (錦標賽：勝負公告統一用「獲勝」取代「(自動)晉級」——因有瑞士制(無晉級/淘汰概念),投降/未進場/閒置/時限/管理員裁定的公告把「自動晉級」「勝出並自動晉級」改為「獲勝」,避免玩家誤會;瑞士制分支本就用獲勝) + v0.62 (錦標賽：setup『誰該動作』判定改成與實際 engine gating 一致——放出場階段依 PTCG 規則 mulligan 較少方先放+按準備(較多方需等),雙方都 setupDone 後才進揭示確認/補抽;修正 v0.60 用 mulligan 旗標判序錯誤,並讓前端 isMyTurn/提示共用同邏輯→提示與敗場判定一致) + v0.61 (錦標賽名人堂可看當初賽程：/champions 補回傳 eventId；新增公開 GET /api/tournament/champion-bracket?eventId= 從歸檔 TARCHIVE 取該賽事每輪 matches+勝負(winner 由 winnerUid 對 p1/p2uid 導出)，供前端名人堂點選後翻頁顯示) + v0.60 (錦標賽：修 setup 階段「等對方補抽」倒數到時誤判雙敗——閒置判負用的 currentActorSeat 在 setup 只看 setupDone，雙方都 false 就回 -1 雙敗，完全忽略 mulligan 子階段；實況是只有一方欠補抽/確認揭示、對手只是在等，卻被一起判雙敗。修：setup 先判 mulligan 待辦(pendingMulliganDraw/mulliganRevealConfirmed/mulliganPostBenchOpen)，只有欠 mulligan 的一方算「該動作」→ 單判該方敗、等待方獲勝；mulligan 都完成才退回看 setupDone) + v0.59 (錦標賽名人堂可從歸檔還原：新增 /admin/champions/restore-from-archive[從 TARCHIVE 重建 TCHAMPS,只補缺漏不覆蓋既有,救回被誤刪的冠軍];歸檔 recordTournamentArchive 補存 communityEvent 旗標供還原;admin.html 名人堂管理加「♻️從歸檔還原」鈕) + v0.58 (錦標賽：定期清掃「已結束賽事底下、沒打完(非done)的對戰」殘留——賽事 finished 後不清 TMATCH，致這種 pending 對戰累積、被監控誤算成「等開打」死資料(排程器本就以 listOpenEvents 排除 finished，故這些殘留零功能影響、不會幽靈開打)；scheduler 每~5分刪除 finished 賽事的非done對戰，一次涵蓋正常完賽/force-finish/取消所有結束路徑+自動清掉歷史殘留) + v0.57 (錦標賽：大廳聊天效能——①為 tournamentChat 建 {room,ts} 索引,讓 /chat 的 ts>since+sort 走索引範圍掃描,不再每次全表掃+記憶體排序[訊息越多越慢→高流量輪詢拖慢];②scheduler 每~5 分鐘定期修剪大廳聊天,只保留最近 800 則,避免 collection 無限長大) + v0.56 (錦標賽：修『打到一半被判未進場』——進場標記 entered 原是 read-modify-write 整包寫回,兩人同時進場時後者用讀到的舊值覆蓋掉前者的旗標→某方進場記錄遺失→未進場 tick 誤判已開打的對局[實例 Eg vs Gali]。修(A根因)進場端改原子 positional $set 只更新自己座位+建 match 時初始化 entered:[false,false];修(B保險)未進場判負前若房間 gameState 已 playing/game-over[雙方都完成 setup 確實到場]即不判未進場) + v0.55 (錦標賽：社群賽發起公告措辭微調[「就自動開賽（人越多越熱鬧）」→「就能開賽」] + 新增 /api/tournament/cancel-proposal[發起者本人，報名階段且報名人數未達門檻時可手動取消社群賽；原子搶占 status=registration→finished 防與 scheduler 開賽競態；不收 30 分冷卻、釋放全站 1 場名額] + /event 每場補 isProposer 旗標供前端顯示取消鈕) + v0.54 (錦標賽：社群賽發起公告文字修正——募集窗口會跑滿,期間都可報名,時間到達門檻才開賽[非一達標即開],避免『集滿即開賽』誤導) + v0.53 (錦標賽：玩家發起社群賽[createdByPlayer]——/propose 限email帳號/全站同時僅1場/發起者30分冷卻/官方賽事開賽前2h內或未結束時禁止/選format+募集窗口15-30-60分/自動報名發起者;募集截止響應<門檻 or 報到<門檻自動取消;門檻單淘汰4瑞士8;名人堂冠軍帶 communityEvent 旗標) + v0.52 (錦標賽：修瑞士制排名把『剛配好還沒打的下一輪 pending 對戰』誤當雙敗計分[GG 1-1/aa 0-2 應為 1-0/0-1]——buildSwissPlayersFromMatches 改只計已結束;伺服器把 status 一併傳入) + v0.51 (錦標賽：瑞士制報到結束(確定簽到人數)時,在聊天室系統廣播——本場選手數、預計瑞士輪數、取前幾名進 Top Cut) + v0.50 (錦標賽：瑞士制階段的未進場/閒置判負文字改成不用「淘汰/晉級」字眼[輸贏都繼續比賽,雙未進場以雙敗處理];cut 階段下一輪廣播用 Top Cut 字樣) + v0.49 (錦標賽：/event events[] 補 format/swissRounds/topCut,讓大廳賽事卡正確顯示『瑞士制』而非一律單敗) + v0.48 (錦標賽：/bracket 回傳瑞士制即時排名表 standings[名次/戰績/積分/OWP] + event.format/phase/swissRounds/topCut + 每場 phase,供前端顯示瑞士排名與輪次標籤) + v0.47 (錦標賽：新增瑞士制+單淘汰Top Cut賽制[format='swiss-then-cut']——建賽事可選瑞士制,輪數/切牌依人數自動且admin可覆寫,每輪依戰績配對避重賽、勝3負0不平手、破同分OWP/OOWP,打完固定輪數依排名取前K名進單敗淘汰;純函式來自bundle TENG.*,單敗淘汰行為完全不變) + v0.46 (錦標賽：報到截止 seed 改原子搶占 checkin→bracket_ready，修『報到回200但 seedEventBracket 已讀完 regs→沒被排進賽程』的 TOCTOU 競態 + 防重疊 tick 重複 seed 洗掉賽程) + v0.45 (錦標賽：較晚賽事自動順延——若有開賽時間較早且尚未結束的其他賽事仍在進行，接近開賽前 10 分鐘內自動把本場開賽順延 10 分鐘並在聊天室公告，直到前場結束，避免同一玩家被兩場同時要求進場) + v0.44 (錦標賽：對局時限改官方「打完剩餘回合」制[時間到先打完當前回合，後攻方再結束他的下一個回合才比獎賞] + 平手自動判雙敗[雙方淘汰、下一輪對手輪空，不需管理員]) + v0.43 (錦標賽：/spectate/list 排除自己參賽的場,防參賽者誤觀戰自己對局看不到手牌) + v0.42 (錦標賽：/admin/match-log 取某場逐回合log供賽事統計下鑽) + v0.41 (錦標賽：/event events[] 補 myName+checkInDeadline 供前端每場卡片) + v0.40 (錦標賽：可同時公布多場賽事(時間不重疊)，玩家各自報名；scheduler 迴圈所有開放賽事；端點吃 eventId) + v0.36 (錦標賽：/event+/state 回 serverNow 給前端對時(倒數同步) + /chat 回 clearedAt(admin清空即時生效))
// v0.35 (錦標賽：報名 coinPref 先後攻偏好 + admin /match/restart 重賽 + 完整賽事歸檔 tournamentArchives 永久保存)
// v0.34 (錦標賽：報名名單回 deckText 可複製匯入 + 未進場判負勝方房間設 game-over 顯示勝利畫面)
// v0.33 (錦標賽名人堂：歷屆冠軍 TCHAMPS + /champions 公開列表 + admin 編輯/刪除)
// v0.32 (錦標賽：/state 回 lastActionAt 給等待方倒數 + admin 強制裁定任意場 /admin/pending-matches + /admin/event/force-finish 安全閥)
// v0.31 (錦標賽：投降即時判負 /match/forfeit + 閒置逾3分鐘自動判負 currentActorSeat)
// v0.30 (admin v1.25 — 1.4 勝因分佈：離開類依 finalTurn<=1 細分「第一回合離開(開房掛機)」vs「中途離開(認輸)」；「取得所有獎勵牌」正名「取得所有獎賞卡」) (v0.29 — admin v1.23 — 對戰歷史全站搜尋：match-records 加 q(房號/玩家名/email 模糊 regex) + cardIds(牌組含此卡) 全站篩選) (v0.28 — admin v1.15 — 意見回饋 email 改「當前頁批次 uid 查詢」端點 /users/lookup，免載全量 users) (v0.27 — admin v1.12 — 2.3 卡牌勝率排除「玩家中途離開」獲勝場：臨時離開/斷線不代表真實卡牌勝率) (v0.26 — winrate/archetype 加 ?since 時間範圍篩選 24h/7d/不限) (v0.25 — 2.3 卡牌→代表牌組聚合端點 archetype)
// Inserted before app.listen() by oracle_admin_install.sh (or _update.sh)
//
// Changes:
//   v0.2 - Auth: admin token → Firebase ID token + email whitelist (ADMIN_EMAILS env)
//   v0.2 - Room list includes gameState summary (turn, winner, winReason, phase, prizeRemain)
//   v0.2 - Added /api/admin/whoami for client login verification
//   v0.3 - Sortable user columns, status badges, winner highlight, message count
//   v0.4 - Overview 三大類別、意見回覆/刪除 API、card name translation
//   v0.5 - 加 ZOMBIE ROOM CLEANUP 區塊（檔尾），每 5 分鐘掃 MongoDB 清殭屍房
//   v0.6 - rooms API enrich seat 加 email/isAnonymous/provider（admin v0.78）—
//          bypass listUsers cache 可能遺漏，用 adminAuth.getUsers() 即時 lookup +
//          5 分鐘 TTL 避免 N+1。
//   v0.7 - enrichSeats 認 'anon_*' prefix 為 session anon id（client 自產，非 Firebase
//          Auth uid），不查 Firebase。修 v0.6 全部誤標「已刪除」的 bug。
//   v0.71 - 修 enrichSeats session-anon 分支強制覆蓋 email/displayName=null，會把
//          v4.961 client 寫的 seat.email 蓋掉。改為由 `...s` spread 保留 client 寫入值。
//   v0.8  - zombie cleanup 加 ended 房 90 天 retention（之前永久保留，避免 db 無限成長）。
//   v0.9  - matchRecords Phase 1（client game-over fire POST /api/match-result 永久存 MongoDB
//          matchRecords collection，admin 用 GET /api/admin/match-records 讀）。
//          IMPORTANT: 必須跟 requireFirebaseAdmin 同閉包，故 inline 在主 .then() 內。
//   v0.10 - matchRecords schema: cardIds → cardCounts (張數 Object) for 牌組 modal 顯示「× N」。
//          validateRecord 兩種都接受 (backward compat 給 v5.005 舊客戶端 + 已存的 2 筆測試資料)。
//   v0.11 - matchRecords: 加 DELETE /api/admin/match-records/:matchId (測試資料清理用)；
//          ?mode=online/local filter 改用 roomCode 有無判斷（玩家語意：有房號=線上、無=本機）。
//   v0.12 - Phase 2a Tier 1 統計：加 GET /api/admin/stats/overview (1.1-1.4) +
//          GET /api/admin/stats/cards (1.5-1.8) + cardTags collection CRUD（支援型寶可夢標記）。
//   v0.13 - Phase 2b Tier 2 統計：加 5 個 endpoints
//          GET /api/admin/stats/players (2.1 玩家排行榜)
//          GET /api/admin/stats/players/:email (2.2 個人戰績頁)
//          GET /api/admin/stats/cards/winrate (2.3 卡牌勝率)
//          GET /api/admin/stats/heatmap (2.4 時段熱力圖 — Asia/Taipei tz)
//          GET /api/admin/stats/trends (2.5 對戰量趨勢 — day/week/month)

import('firebase-admin').then(async ({ default: admin }) => {
  const fs = await import('fs');
  if (!admin.apps.length) {
    const keyPath = '/opt/ptcg/api/firebase-admin-key.json';
    if (fs.existsSync(keyPath)) {
      const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(key) });
      console.log('[admin] firebase-admin initialized for project:', key.project_id);
    } else {
      console.warn('[admin] firebase-admin-key.json not found; firebase admin endpoints disabled');
    }
  }
  const fbInitialized = admin.apps.length > 0;
  const adminAuth = fbInitialized ? admin.auth() : null;
  const adminDb = fbInitialized ? admin.firestore() : null;

  // Parse ADMIN_EMAILS whitelist
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (ADMIN_EMAILS.length === 0) {
    console.warn('[admin] ADMIN_EMAILS env var not set — no one can access admin (set in .env)');
  } else {
    console.log('[admin] Whitelist:', ADMIN_EMAILS.join(', '));
  }

  // Firebase ID token auth middleware
  async function requireFirebaseAdmin(req, res, next) {
    if (!fbInitialized || !adminAuth) {
      return res.status(503).json({ error: 'firebase admin not initialized' });
    }
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/);
    if (!m) {
      return res.status(401).json({ error: 'missing Authorization Bearer token' });
    }
    try {
      const decoded = await adminAuth.verifyIdToken(m[1]);
      const email = (decoded.email || '').toLowerCase();
      if (!email || !ADMIN_EMAILS.includes(email)) {
        return res.status(403).json({ error: 'not in admin whitelist: ' + (decoded.email || 'no email') });
      }
      req.adminUser = { uid: decoded.uid, email: decoded.email };
      next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid token: ' + err.message });
    }
  }
  function requireFb(req, res, next) {
    if (!fbInitialized) return res.status(503).json({ error: 'firebase admin disabled (key missing)' });
    next();
  }
  function tsToMillis(v) {
    if (!v) return v;
    if (typeof v === 'number') return v;
    if (v.toMillis) return v.toMillis();
    if (v._seconds) return v._seconds * 1000;
    return v;
  }

  // ── v0.6 (admin v0.78): seat enrich — 對每個 seat.uid 用 adminAuth.getUsers() ────
  //   batch lookup，回傳 email / isAnonymous / provider，bypass listUsers cache 的可能
  //   遺漏。5 分鐘 TTL 避免重複查（rooms API 每次叫都跑 enrich 會慢）。
  const userInfoCache = new Map();  // uid -> { info, ts }
  const USER_INFO_TTL = 5 * 60 * 1000;  // 5 min

  async function lookupUserInfoBatch(uids) {
    const out = new Map();
    if (!adminAuth) return out;
    const now = Date.now();
    const toFetch = [];
    for (const uid of uids) {
      const c = userInfoCache.get(uid);
      if (c && now - c.ts < USER_INFO_TTL) {
        out.set(uid, c.info);
      } else {
        toFetch.push(uid);
      }
    }
    // 批次 lookup，每批 100（getUsers API 上限）
    for (let i = 0; i < toFetch.length; i += 100) {
      const batch = toFetch.slice(i, i + 100).map(uid => ({ uid }));
      try {
        const result = await adminAuth.getUsers(batch);
        for (const u of result.users) {
          const info = {
            email: u.email || null,
            displayName: u.displayName || null,
            isAnonymous: !u.providerData || u.providerData.length === 0,
            provider: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || 'anonymous',
            disabled: !!u.disabled,
          };
          userInfoCache.set(u.uid, { info, ts: now });
          out.set(u.uid, info);
        }
        // notFound：uid 在 Firebase Auth 已被刪除（殘留在房間 seats 內）
        for (const nf of (result.notFound || [])) {
          if (nf.uid) {
            const info = { email: null, displayName: null, isAnonymous: false, provider: 'not-found', disabled: false };
            userInfoCache.set(nf.uid, { info, ts: now });
            out.set(nf.uid, info);
          }
        }
      } catch (e) {
        console.warn('[admin] getUsers batch failed:', e.message);
      }
    }
    return out;
  }

  // v0.7：判斷 uid 是否為 client 自產 session anon id（前綴 `anon_`）。
  //   這些 id 由 main-site client 給未登入訪客用，跟 Firebase Auth uid 是不同 namespace —
  //   丟給 adminAuth.getUsers() 一定 notFound（會被誤標「已刪除」）。
  //   先 filter 掉，不浪費 6 個 batch call。
  function isSessionAnonUid(uid) {
    return typeof uid === 'string' && uid.startsWith('anon_');
  }

  // 給 rooms 陣列的 seats 加 email / isAnonymous / provider 欄位
  async function enrichSeats(rooms) {
    if (!adminAuth || !Array.isArray(rooms) || rooms.length === 0) return rooms;
    // v0.7：分流 — session anon (anon_*) 不查 Firebase，其他才丟 batch lookup
    const firebaseUidSet = new Set();
    for (const r of rooms) {
      for (const s of (r.seats || [])) {
        if (s && s.uid && !isSessionAnonUid(s.uid)) firebaseUidSet.add(s.uid);
      }
    }
    const uidMap = firebaseUidSet.size > 0
      ? await lookupUserInfoBatch([...firebaseUidSet])
      : new Map();
    for (const r of rooms) {
      r.seats = (r.seats || []).map(s => {
        if (!s || !s.uid) return s;
        // v0.7：session anon 直接給 session-anon provider，不算「已刪除」
        // v0.71 修：原本強制 email=null/displayName=null 會把 v4.961 client 寫的
        //   seat.email 覆蓋掉。改為「不主動覆蓋」— 由 `...s` spread 保留 client 寫的值，
        //   只 enrich isAnonymous/provider/disabled 三個 server 推斷的欄位。
        if (isSessionAnonUid(s.uid)) {
          return {
            ...s,
            isAnonymous: true,
            provider: 'session-anon',
            disabled: false,
          };
        }
        const u = uidMap.get(s.uid);
        if (u) {
          // v0.71：firebase auth 拿到的 email 優先；若 lookup 沒 email 但 client 寫了 seat.email，
          //   保留 client 寫的（fallback）。display name 同理。
          return {
            ...s,
            email: u.email ?? s.email ?? null,
            displayName: u.displayName ?? s.displayName ?? null,
            isAnonymous: u.isAnonymous,
            provider: u.provider,
            disabled: u.disabled,
          };
        }
        return s;
      });
    }
    return rooms;
  }

  // gameState 摘要：抽 turn / winner / winReason / phase / prizeRemain
  function summarizeRoom(r) {
    const gs = r.gameState || null;
    if (gs) {
      r.gameStateSummary = {
        turn: gs.turn ?? null,
        winner: gs.winner ?? null,
        winReason: gs.winReason ?? null,
        phase: gs.phase ?? null,
        prizeRemain: (gs.players || []).map(p => Array.isArray(p?.prize) ? p.prize.length : null),
        logCount: Array.isArray(gs.log) ? gs.log.length : 0,
      };
    } else {
      r.gameStateSummary = null;
    }
    delete r.gameState;
    return r;
  }

  // ── whoami ────────────────────────────────────────────────────────
  app.get('/api/admin/whoami', requireFirebaseAdmin, (req, res) => {
    res.json({ ok: true, user: req.adminUser });
  });

  // ── v1.19 (v6.219) users 統計快取（/api/admin/stats 提速）→ v1.32 (v6.275) 收斂單一掃描來源 ──
  // v1.19 前情：nginx 計時 log（2026-08-22）全站最慢前三筆全是 /api/admin/stats（14.7~15.9 秒、
  //   全在 node 內）。真因：users 統計用 adminAuth.listUsers(1000) 逐頁「循序」掃全部使用者
  //   （~N 頁 × ~300ms）。v1.19 已實測：這 15 秒幾乎全是 await 的網路 I/O，事件迴圈不被佔住
  //   （同步聚合段 50k 筆沙盒僅 ~51ms ≈ VM ~5ms）⇒ 不卡玩家；但 admin 要白等、Auth 要挨 N 發。
  // ⚠⚠ v1.32 (v6.275)：站長 dump 的 nginx log（2026-08-30）顯示 /api/admin/firebase/users-all
  //   一發 15.7 秒、回應 1.24MB —— v0.95 的它與 v1.19 的這裡**各自**維護一份互不相通的
  //   listUsers 全量掃描：users-all 在 TTL 過期後的第一發要**同步等**整輪掃描（沒有 v1.19 的
  //   「過期先回舊值」），且 admin 開頁（總覽＋玩家帳號）要對 Firebase Auth 掃**兩輪**。
  //   本版把「掃描」收斂成單一來源 getRawUsersCached()：
  //   ① 5 分鐘 TTL ＋ single-flight ＋ 過期先回舊值、背景刷新（v1.19 的手法，兩支共用）；
  //   ② /api/admin/stats 與 /api/admin/firebase/users-all 共用同一份 raw ⇒ Auth 掃描輪數減半；
  //   ③ 補上 users-all 原本沒有的 50,000 安全上限（與 v1.19 同值）；被截斷時回 capped:true，
  //      admin 畫面標明（絕不靜默截斷，v6.240／v6.272 慣例）；
  //   ④ ?refresh=1 仍**同步等**最新資料（站長刪帳號後按 Refresh 要立刻看到）。
  //   ⚠ listUsers 是 Firebase **Auth** 不是 Firestore：不消耗 Firestore 讀取額度（v6.272 的
  //     枚舉漏掉它，正是因為當時只掃 Firestore 讀取字面）；它的問題是「慢」與「循序請求數」。
  //   ⚠ 統計聚合（aggregateUsersStats）與列表映射（users-all 的欄位）程式碼逐字保留，口徑不變。
  const USERS_STATS_TTL_MS = 5 * 60 * 1000;   // raw 掃描的 TTL（沿用 v1.19／v0.95 的 5 分鐘）
  const RAW_USERS_MAX = 50000;                // 掃描安全上限（v1.19 的 sane safety，v1.32 起兩支共用）
  const _rawUsersCache = { at: 0, users: null, capped: false, inFlight: null };

  /** 唯一真的打 adminAuth.listUsers 的地方（v1.32）。掃描迴圈與 v1.19 逐字同款。 */
  async function scanAllAuthUsers() {
    const users = [];
    let pageToken = undefined;
    while (users.length < RAW_USERS_MAX) {
      const result = await adminAuth.listUsers(1000, pageToken);
      users.push(...result.users);
      pageToken = result.pageToken;
      if (!pageToken) break;
    }
    // capped=true ⇔ 迴圈因上限退出且 Firebase 還有下一頁（真的沒掃完，回應必須標明）
    return { users, capped: !!pageToken, at: Date.now() };
  }

  /**
   * raw 使用者清單（單一來源）：TTL 內直接回；過期先回舊值、背景刷新；
   * force=true（?refresh=1）一律等「正在進行／新發起」的掃描完成才回。
   * 冷啟動（進程重啟後第一發）沒有舊值可回，只能等第一輪掃完（與 v1.19 相同）。
   */
  async function getRawUsersCached(force) {
    const now = Date.now();
    if (!force && _rawUsersCache.users && now - _rawUsersCache.at < USERS_STATS_TTL_MS) {
      return _rawUsersCache;                            // 新鮮：直接回
    }
    if (!_rawUsersCache.inFlight) {                     // single-flight：同時多發只掃一輪
      _rawUsersCache.inFlight = scanAllAuthUsers()
        .then((r) => { _rawUsersCache.users = r.users; _rawUsersCache.capped = r.capped; _rawUsersCache.at = r.at; return r; })
        .finally(() => { _rawUsersCache.inFlight = null; });
    }
    if (!force && _rawUsersCache.users) {
      // 過期但有舊值：先回舊值，讓刷新在背景跑完（失敗只記 log，下一發再試）
      _rawUsersCache.inFlight.catch((e) => console.warn('[admin] users 掃描背景刷新失敗:', e && e.message));
      return _rawUsersCache;
    }
    await _rawUsersCache.inFlight;                      // 冷啟動或 force：等掃描完成
    return _rawUsersCache;
  }

  /** users 統計聚合 —— 算法與 v0.4→v1.19 的原始碼一字不差（口徑不變），只是輸入改吃共用 raw。 */
  function aggregateUsersStats(allUsers, at) {
    const h24 = Date.now() - 86400000;
    const uniqUids = new Set(allUsers.map(u => u.uid));
    const memberUids = new Set(allUsers.filter(u => u.email).map(u => u.uid));
    const active24hUids = new Set(
      allUsers.filter(u => u.metadata.lastSignInTime && new Date(u.metadata.lastSignInTime).getTime() > h24).map(u => u.uid)
    );
    return {
      enabled: true,
      total: uniqUids.size,
      members: memberUids.size,
      anonymous: uniqUids.size - memberUids.size,
      active24h: active24hUids.size,
      at,   // 資料時間＝raw 掃描時刻（admin 畫面標示；語意同 v1.19 的 at）
    };
  }

  // 聚合結果的 per-掃描 memo：同一份 raw 只聚合一次（並發多發拿到同一個物件參考）
  const _usersStatsView = { at: -1, data: null };
  async function getUsersStatsCached() {
    const raw = await getRawUsersCached(false);
    if (_usersStatsView.at !== raw.at) {
      _usersStatsView.data = aggregateUsersStats(raw.users, raw.at);
      _usersStatsView.at = raw.at;
    }
    return _usersStatsView.data;
  }

  // ── v1.31 (v6.272) feedbacks 快取（Firestore 讀取減量）──────────────
  // 為什麼：「未回覆數」需要 client-side filter（Firestore 不支援
  //   「reply == null OR reply 這個欄位不存在」的 OR），所以 /api/admin/stats 原本
  //   **每開一次總覽就把 feedbacks 整包撈回來**；/api/admin/firebase/feedback 也是全撈。
  //   ⚠⚠ Firestore 是「讀幾份文件算幾次」，Admin SDK **不豁免**
  //   （它繞過的是安全規則，不是計費）—— 見 https://cloud.google.com/firestore/pricing
  //   「Free tier … Document reads 50,000 per day」。
  // 修法：完全比照 v1.19 的 getUsersStatsCached —— 結果快取 ＋ single-flight ＋
  //   「過期先回舊值、背景刷新」。**查詢與欄位映射一字未動**，只是「什麼時候讀」改變。
  //   ⚠ admin 自己按回覆／刪除後必須立刻看到 ⇒ 那兩支端點會呼叫 invalidateFeedbacksCache()。
  //   ⚠ 另加一道 2000 筆安全上限（原註解說「通常 < 200 筆」，但無上限就是無上限），
  //     回應帶 truncated 讓畫面標示，**絕不靜默截斷**（v6.218／v6.240 教訓）。
  const FEEDBACKS_TTL_MS = 30 * 60 * 1000;  // v1.35 (v6.281)：5 分鐘 → 30 分鐘，與 USERS_STATS_TTL_MS 脫鉤（詳見檔頭）
  const FEEDBACKS_CAP = 2000;
  const _feedbacksCache = { at: 0, data: null, inFlight: null };

  async function computeFeedbacksAll() {
    // ↓ 排序與欄位映射與 v0.4 的原始碼一字不差，只多了 .limit(FEEDBACKS_CAP)
    const snap = await adminDb.collection('feedbacks')
      .orderBy('createdAt', 'desc').limit(FEEDBACKS_CAP).get();
    const items = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id, ...data,
        createdAt: tsToMillis(data.createdAt),
        updatedAt: tsToMillis(data.updatedAt),
        repliedAt: tsToMillis(data.repliedAt),
      };
    });
    return { items, truncated: items.length >= FEEDBACKS_CAP, at: Date.now() };
  }

  async function getFeedbacksCached() {
    const now = Date.now();
    if (_feedbacksCache.data && now - _feedbacksCache.at < FEEDBACKS_TTL_MS) {
      return _feedbacksCache.data;                     // 新鮮：直接回（0 次 Firestore 讀取）
    }
    if (!_feedbacksCache.inFlight) {                   // single-flight：同時多發只撈一輪
      _feedbacksCache.inFlight = computeFeedbacksAll()
        .then((data) => { _feedbacksCache.data = data; _feedbacksCache.at = data.at; return data; })
        .finally(() => { _feedbacksCache.inFlight = null; });
    }
    if (_feedbacksCache.data) {
      // 過期但有舊值：先回舊值，讓刷新在背景跑完（失敗只記 log，下一發再試）
      _feedbacksCache.inFlight.catch((e) => console.warn('[admin] feedbacks 背景刷新失敗:', e && e.message));
      return _feedbacksCache.data;
    }
    return _feedbacksCache.inFlight;                   // 冷啟動：等第一次撈
  }

  /** admin 自己改動 feedbacks 之後叫它，讓下一發一定重新讀（不然站長會看到自己的回覆消失）。 */
  function invalidateFeedbacksCache() { _feedbacksCache.at = 0; _feedbacksCache.data = null; }

  // ── Combined stats v0.4 (含三大類別) ───────────────────────────────
  app.get('/api/admin/stats', requireFirebaseAdmin, async (req, res) => {
    try {
      const h24 = Date.now() - 86400000;

      // ── Oracle (mongo) ──
      const [oLobby, oPlaying, oEnded, oNew24h, msgCount] = await Promise.all([
        db.collection('rooms').countDocuments({ status: 'lobby' }),
        db.collection('rooms').countDocuments({ status: 'playing' }),
        db.collection('rooms').countDocuments({ status: 'ended' }),
        db.collection('rooms').countDocuments({ createdAt: { $gt: h24 } }),
        db.collection('messages').countDocuments({}),
      ]);
      const oTotal = oLobby + oPlaying + oEnded;

      // ── Firebase ──
      let firebase = { enabled: false };
      let users = { enabled: false };
      let feedback = { enabled: false };
      if (fbInitialized) {
        // rooms 統計
        try {
          const [lobbySnap, playingSnap, endedSnap] = await Promise.all([
            adminDb.collection('rooms').where('status', '==', 'lobby').count().get(),
            adminDb.collection('rooms').where('status', '==', 'playing').count().get(),
            adminDb.collection('rooms').where('status', '==', 'ended').count().get(),
          ]);
          // 24h 新增（用 updatedAt 替代 createdAt 因為 firestore Timestamp 比較需要特殊處理）
          const since = admin.firestore.Timestamp.fromMillis(h24);
          const new24hSnap = await adminDb.collection('rooms').where('updatedAt', '>', since).count().get();
          firebase = {
            enabled: true,
            lobby: lobbySnap.data().count,
            playing: playingSnap.data().count,
            ended: endedSnap.data().count,
            new24h: new24hSnap.data().count,
            total: lobbySnap.data().count + playingSnap.data().count + endedSnap.data().count,
          };
        } catch (e) { firebase = { enabled: true, error: e.message }; }

        // users 統計 → v1.19 改走快取（見上方 getUsersStatsCached；聚合算法一字未動）
        try {
          users = await getUsersStatsCached();
        } catch (e) { users = { enabled: true, error: e.message }; }

        // feedback 統計
        try {
          const since = admin.firestore.Timestamp.fromMillis(h24);
          const [totalSnap, new24hSnap] = await Promise.all([
            adminDb.collection('feedbacks').count().get(),
            adminDb.collection('feedbacks').where('createdAt', '>', since).count().get(),
          ]);
          // 未回覆數：需要 client-side filter，因為 firestore 不支援 OR (reply == null OR reply does not exist)
          // 改抓全部 doc 內存計算（feedback 通常 < 200 筆，可接受）
          // ⚠⚠ v1.31 (v6.272)：這一行原本是 `adminDb.collection('feedbacks').get()`
          //   —— **每開一次總覽分頁就把整個 collection 讀一次**，是 Firebase 讀取額度的
          //   實際消耗者之一。改走 getFeedbacksCached()（TTL 5 分鐘），filter 條件逐字不變。
          //   total / new24h 仍走 count() aggregation（各 1 次讀取、永遠精確、算法一字未動），
          //   只有「未回覆數」是快取值 ⇒ 回應多帶 unrepliedAt 讓畫面標示資料時間。
          const _fbAll = await getFeedbacksCached();
          const unreplied = _fbAll.items.filter(d => !d.reply).length;
          feedback = {
            enabled: true,
            total: totalSnap.data().count,
            new24h: new24hSnap.data().count,
            unreplied,
            unrepliedAt: _fbAll.at,
            unrepliedTruncated: _fbAll.truncated,
          };
        } catch (e) { feedback = { enabled: true, error: e.message }; }
      }

      res.json({
        oracle: { total: oTotal, lobby: oLobby, playing: oPlaying, ended: oEnded, new24h: oNew24h, messages: msgCount },
        firebase, users, feedback,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── v0.21: Firestore 寫入 audit ────────────────────────────────
  // 列各 top-level collection 的 total + 過去 1h / 24h 內新增/更新 doc 數
  // 用 aggregate count() query，每個 query 只算 1 read，總成本約 5×N reads
  // 目的：定位寫入暴量元兇（v5.072 後 users 不應該再寫，但寫入仍高 → 找其他 collection）
  //
  // v0.22：timestamp query 加 ISO string fallback — decks 等 client 寫的 collection
  //   schema 用 new Date().toISOString() 而非 serverTimestamp → 直接 Timestamp 比對 fail
  //   ISO string lex sort 跟時間順序一致，string '>' compare 完全 work
  app.get('/api/admin/firestore-write-audit', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const now = Date.now();
      const h1Ts = admin.firestore.Timestamp.fromMillis(now - 3600000);
      const h24Ts = admin.firestore.Timestamp.fromMillis(now - 86400000);
      const h1Iso = new Date(now - 3600000).toISOString();
      const h24Iso = new Date(now - 86400000).toISOString();

      async function tryCount(query) {
        try {
          const s = await query.count().get();
          return s.data().count;
        } catch (e) {
          return { error: e.message };
        }
      }

      // v0.22：嘗試兩種 timestamp 比對 — Timestamp 失敗 fallback 試 ISO string
      async function tryCountWithFallback(collRef, field, tsValue, isoValue) {
        const r1 = await tryCount(collRef.where(field, '>', tsValue));
        if (typeof r1 === 'number') return r1;
        // Timestamp 比對失敗 → 嘗試 ISO string 比對
        const r2 = await tryCount(collRef.where(field, '>', isoValue));
        if (typeof r2 === 'number') return r2;
        // 兩種都失敗（field 不存在 / 其他錯誤）
        return r1;
      }

      async function auditCollection(collRef, name) {
        const row = { collection: name };
        row.total = await tryCount(collRef);
        row.createdAt_1h = await tryCountWithFallback(collRef, 'createdAt', h1Ts, h1Iso);
        row.createdAt_24h = await tryCountWithFallback(collRef, 'createdAt', h24Ts, h24Iso);
        row.updatedAt_1h = await tryCountWithFallback(collRef, 'updatedAt', h1Ts, h1Iso);
        row.updatedAt_24h = await tryCountWithFallback(collRef, 'updatedAt', h24Ts, h24Iso);
        return row;
      }

      // 列出全部 top-level collections
      const colls = await adminDb.listCollections();
      const results = [];
      for (const coll of colls) {
        results.push(await auditCollection(coll, coll.id));
      }

      // 也查已知的 subcollection groups
      const knownGroups = ['decks', 'messages', 'chats'];
      for (const grp of knownGroups) {
        try {
          const grpRef = adminDb.collectionGroup(grp);
          const row = await auditCollection(grpRef, `(group) ${grp}`);
          results.push(row);
        } catch (e) {
          results.push({ collection: `(group) ${grp}`, error: e.message });
        }
      }

      // 排序：1h 寫入數最多的在前（讓元兇浮上）
      results.sort((a, b) => {
        const aH = (typeof a.createdAt_1h === 'number' ? a.createdAt_1h : 0)
                 + (typeof a.updatedAt_1h === 'number' ? a.updatedAt_1h : 0);
        const bH = (typeof b.createdAt_1h === 'number' ? b.createdAt_1h : 0)
                 + (typeof b.updatedAt_1h === 'number' ? b.updatedAt_1h : 0);
        return bH - aH;
      });

      res.json({ at: now, h1_window_ms: 3600000, h24_window_ms: 86400000, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });


  // ── Feedback reply / delete ─────────────────────────────────────
  app.put('/api/admin/firebase/feedbacks/:id/reply', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const { reply } = req.body || {};
      if (typeof reply !== 'string' || !reply.trim()) {
        return res.status(400).json({ error: 'reply required' });
      }
      await adminDb.collection('feedbacks').doc(req.params.id).update({
        reply: reply.trim(),
        repliedAt: admin.firestore.FieldValue.serverTimestamp(),
        repliedBy: req.adminUser.email,
      });
      invalidateFeedbacksCache();   // v1.31：站長寫完回覆必須立刻看得到，不能等 TTL
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/admin/firebase/feedbacks/:id', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      await adminDb.collection('feedbacks').doc(req.params.id).delete();
      invalidateFeedbacksCache();   // v1.31：刪掉的那則必須立刻從列表消失
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Oracle MongoDB ────────────────────────────────────────────────
  // v1.22（v6.240）「🎮 Oracle 對戰」房間列表改【伺服器端分頁 ＋ 時間範圍 ＋ 伺服器端搜尋】。
  //   事故：已結束房間累積到 8 萬多筆，而這支端點原本是 find(_filter)…**完全沒有上限**，
  //   projection 還帶著 gameState.log（房間 doc 的大宗，第 9 回合就 ~29KB）
  //   ⇒ 一次回傳數百 MB，站長一點「✅ 已結束」就讀到當掉。
  //   ⚠ 分頁**一定要在伺服器端做**（skip/limit）—— 撈 8 萬筆回前端再 slice 正是當掉的原因。
  //   ⚠ 向後相容：**沒帶 ?page= 就完全走 v1.21 的舊路徑**（不 skip/limit、counts 不套時間範圍），
  //     舊 admin.html／舊快取頁面的行為逐字不變；新 admin.html 一律帶 page/pageSize/range。
  // v1.22 分頁查詢的形狀＝status 等值 ＋ updatedAt 範圍 ＋ sort updatedAt desc ⇒ 複合索引 {status:1,updatedAt:-1}。
  //   ⚠ rooms 已累積 8 萬多筆，而本檔既有的索引沒有一條是它的（只有 _id）——
  //     沒有這條，分頁會退化成整集合掃描 ＋ 記憶體排序。
  //   索引不改變查詢結果（只換 query plan），且比照 TEVENTS/TREGS 的先例
  //   **只在服務啟動時建一次**、best-effort（已存在即略過），不放進 request handler。
  try { db.collection('rooms').createIndex({ status: 1, updatedAt: -1 }).catch(() => { /* best-effort，已存在即略過 */ }); } catch (e) { /* db 尚未就緒時略過，不影響服務啟動 */ }
  app.get('/api/admin/oracle/rooms', requireFirebaseAdmin, async (req, res) => {
    // ⚠ 這幾個常數與 helper 刻意放在 handler **內部**：既有守衛（v6.229 原型一致性）
    //   是「把 app.get(...) 整段抽出來真的跑」，handler 依賴外層變數會讓它抽出空殼。
    const ROOMS_RANGE_MS = { '7d': 7 * 86400000, '30d': 30 * 86400000, '90d': 90 * 86400000 };
    const ROOMS_MAX_PAGE_SIZE = 200;
    const ROOMS_LEGACY_CAP = 2000;   // 沒帶 ?page= 的舊 client 上限（見下方 else 分支的說明）
    const _escapeRegExpLiteral = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      // v1.18: 接受 ?status=playing|lobby|ended → 只撈該 status 子集（admin 進行中分頁 Refresh 加速）。
      const _sq = (req.query.status || '').trim();
      const _filter = (_sq && _sq !== 'all') ? { status: _sq } : {};
      // v1.22 時間範圍：一律用 updatedAt（與 sort 同一個欄位，才走得到上面那條索引）。
      //   'all' 或認不得的值 → 不加條件（＝舊行為）。
      const _range = String(req.query.range || 'all');
      const _win = ROOMS_RANGE_MS[_range] || 0;
      const _since = _win ? (Date.now() - _win) : 0;
      if (_since) _filter.updatedAt = { $gte: _since };
      // v1.22 搜尋改伺服器端 —— 分頁之後前端手上只有 50 筆，本機搜尋只搜得到那一頁。
      const _q = String(req.query.q || '').trim();
      if (_q) {
        const _rx = new RegExp(_escapeRegExpLiteral(_q), 'i');
        const _or = [{ _id: _rx }, { roomName: _rx }, { 'seats.name': _rx }, { 'seats.email': _rx }];
        // 牌組搜尋：卡名→cardId 的解析放**伺服器端**（沿用 v6.218 牌組公布欄的做法），
        //   client 不必為了搜尋去載 4.6MB 卡片DB。⚠ 上限 2000 個 id，避免 $in 無限膨脹。
        try {
          const _nm = await getCardNameMap();
          const _lc = _q.toLowerCase(); const _ids = [];
          for (const _e of _nm) {
            if (String(_e[1]).toLowerCase().includes(_lc)) { _ids.push(String(_e[0])); if (_ids.length >= 2000) break; }
          }
          if (_ids.length) _or.push({ 'seats.deckEntries.cardId': { $in: _ids } });
        } catch (e) { console.warn('[admin] rooms 卡名搜尋略過:', e && e.message); }
        _filter.$or = _or;
      }
      const _projection = {
        _id: 1, roomName: 1, hostName: 1, hostUid: 1, status: 1,
        seats: 1, memberUids: 1, createdAt: 1, updatedAt: 1,
        _version: 1, schemaVersion: 1, spectatorsAllowed: 1,
        'gameState.turn': 1,
        'gameState.winner': 1,
        'gameState.winReason': 1,
        'gameState.phase': 1,
        'gameState.players.prize': 1,
        'gameState.log': 1,
      };
      const _pageRaw = req.query.page;
      const _paged = _pageRaw != null && String(_pageRaw) !== '';
      let _total = null, _page = 1, _pageSize = 50, _totalPages = 1;
      let _cur = db.collection('rooms').find(_filter, { projection: _projection }).sort({ updatedAt: -1 });
      if (_paged) {
        _pageSize = Math.min(Math.max(1, Math.floor(Number(req.query.pageSize)) || 50), ROOMS_MAX_PAGE_SIZE);
        _total = await db.collection('rooms').countDocuments(_filter);
        _totalPages = Math.max(1, Math.ceil(_total / _pageSize));
        _page = Math.min(Math.max(1, Math.floor(Number(_pageRaw)) || 1), _totalPages);
        _cur = _cur.skip((_page - 1) * _pageSize).limit(_pageSize);
      } else {
        // ⚠⚠ 舊路徑（沒帶 page）現在只剩「瀏覽器快取到舊 admin.html」會走到，
        //   但它會讓 node 一口氣把 8 萬筆含 gameState.log 的 doc 讀進記憶體
        //   （實測序列化前就 ~1.2GB，沙盒直接被 OOM kill）——那是**共用的 API 行程**，
        //   有機會把玩家一起拖下水（Rule 30：絕不拿玩家的體驗當實驗）。
        //   ⇒ 加一道 ROOMS_LEGACY_CAP 上限；counts 仍是全量真值，回應另帶 truncated 講明白，
        //     絕不靜默回一份截斷的列表假裝是全部（v6.218 哨兵教訓）。
        _cur = _cur.limit(ROOMS_LEGACY_CAP);
      }
      const rooms = await _cur.toArray(); // v0.20: 拿掉 limit 300 — Oracle 主機沒額度限制
      rooms.forEach(summarizeRoom);
      // v0.3: 用單一 aggregation 算每房間訊息數
      try {
        const codes = rooms.map(r => r._id);
        const counts = await db.collection('messages').aggregate([
          { $match: { roomCode: { $in: codes } } },
          { $group: { _id: '$roomCode', count: { $sum: 1 } } },
        ]).toArray();
        const m = Object.fromEntries(counts.map(c => [c._id, c.count]));
        for (const r of rooms) r.messageCount = m[r._id] || 0;
      } catch (e) {
        console.warn('[admin] oracle messageCount agg failed:', e.message);
      }
      // v0.6: 用 adminAuth.getUsers() 直接 enrich 每個 seat.uid 的 email / isAnonymous
      await enrichSeats(rooms);
      // v1.21：牌組原型 enrich —— 與大廳 /api/rooms-archetypes 走同一份分類（archetypeNameOf）。
      //   helper 掛在 registerDeckRules IIFE 的 app.locals，handler 執行時才取（v0.94 教訓）；
      //   還沒掛上（載入順序異常）或失敗 → 不加欄位，admin 前端視同「還不知道」退回舊 badge。
      try {
        const _archEnrich = (app.locals || {})._archetypeEnrichRooms;
        if (typeof _archEnrich === 'function') await _archEnrich(rooms);
      } catch (e) { console.warn('[admin] oracle rooms archetype enrich failed:', e.message); }
      // v1.18: 三狀態計數（cheap countDocuments，與 rooms 子集無關），供 toolbar 顯示。
      // v1.22: 有帶時間範圍時計數要套**同一個**範圍，否則 toolbar 的「已結束 (82431)」
      //   會和列表的「共 312 筆」互相矛盾。沒帶 range ⇒ 與 v1.21 逐字相同的全量計數。
      let counts = { lobby: 0, playing: 0, ended: 0 };
      try {
        const _cf = (s) => (_since ? { status: s, updatedAt: { $gte: _since } } : { status: s });
        const [lobby, playing, ended] = await Promise.all([
          db.collection('rooms').countDocuments(_cf('lobby')),
          db.collection('rooms').countDocuments(_cf('playing')),
          db.collection('rooms').countDocuments(_cf('ended')),
        ]);
        counts = { lobby, playing, ended };
      } catch (e) { console.warn('[admin] oracle counts failed:', e.message); }
      // ⚠ paged 是**哨兵**：新 admin.html 靠它分辨「伺服器支援分頁」與「舊伺服器」。
      //   舊伺服器不會有這個欄位 → 前端自動退回舊的前端切頁（v6.218 教訓：不可以
      //   靜默回一份未分頁的結果，讓前端誤以為那就是全部）。
      res.json({ rooms, counts, paged: _paged, truncated: (!_paged && rooms.length >= ROOMS_LEGACY_CAP),
        total: _total, page: _page, pageSize: _pageSize, totalPages: _totalPages, range: _range, q: _q });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/oracle/rooms/:code', requireFirebaseAdmin, async (req, res) => {
    try {
      const room = await db.collection('rooms').findOne({ _id: req.params.code.toUpperCase() });
      res.json({ room });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/oracle/messages/:code', requireFirebaseAdmin, async (req, res) => {
    try {
      const messages = await db.collection('messages')
        .find({ roomCode: req.params.code.toUpperCase() })
        .sort({ createdAt: 1 }).limit(500).toArray();
      res.json({ messages });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/admin/oracle/rooms/:code', requireFirebaseAdmin, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      await db.collection('rooms').deleteOne({ _id: code });
      await db.collection('messages').deleteMany({ roomCode: code });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v0.19: DELETE Firebase room (含 messages subcollection cascade)
  //   原本 admin.html 只能刪 Oracle room，Firebase rooms 因 firestore rules v2.81
  //   設定「ended 房永久保留」而無刪除路徑。zombie ended 房積累時無法清理。
  //   此 endpoint 使用 firebase-admin SDK 繞過 client-side rules（admin 全權）。
  //   先 batch 刪 messages 子集合，再刪 room doc（Firestore 不會自動 cascade）。
  app.delete('/api/admin/firebase/rooms/:code', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const msgsRef = adminDb.collection('rooms').doc(code).collection('messages');
      let totalDeleted = 0;
      while (true) {
        const snap = await msgsRef.limit(400).get();
        if (snap.empty) break;
        const batch = adminDb.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        totalDeleted += snap.size;
        if (snap.size < 400) break;
      }
      await adminDb.collection('rooms').doc(code).delete();
      res.json({ ok: true, code, deletedMessages: totalDeleted });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Firebase Firestore ────────────────────────────────────────────
  // v1.31（v6.272）Firestore 讀取減量【P1：admin 端止血】—— 純伺服器端，玩家零改動。
  //
  // ⚠⚠ **更正一行錯誤註解**：v0.20 在下面那行寫的「admin SDK 不吃 client quota」是**錯的**。
  //   Firebase Admin SDK 繞過的是 **Firestore 安全規則（firestore.rules）**；
  //   **文件讀取照樣計費，照樣吃掉專案每日 50,000 次的免費讀取額度**。
  //   出處 https://cloud.google.com/firestore/pricing（2026-08-30 查證）：
  //     ・「Free tier … Document reads 50,000 per day」
  //     ・「There is a minimum charge of one document read for each query that you perform」
  //     ・「For aggregation queries such as count(), sum(), and avg(), you are charged for
  //        index entries read by the query … you are charged one read operation for each
  //        batch of up to 1000 index entries read by a query」
  //        ⇒ 一間房的 messages 少於 1000 則時，一次 count() 就是 **1 次讀取**。
  //
  // 事故：已結束的房 rules v2.81 起**永久保留**，而這支端點原本按「✅ 已結束 / 全部」
  //   是 **無上限 .get()**，再對每一間房各打一次 count() ⇒ 每點一次 ≈ 2 × N 次讀取，
  //   N 只會越長越大。站長回報 Firebase 額度逼近上限，這裡是最大宗。
  // 修法：比照 v1.22（v6.240）Oracle 分頁 —— **伺服器端加上限 ＋ 回應帶哨兵欄位**。
  //   ⚠⚠ 絕不靜默截斷（v6.218／v6.240 教訓：不可以讓站長以為看到的是全部）。
  //   ⚠⚠ Firestore **不可以照 Mongo 那樣 skip 分頁**：同一份官方文件明講
  //     「when you send a query that includes an offset, you are charged a read for each
  //      skipped document」⇒ offset 分頁比全撈還貴。所以這裡**只用 limit**。
  //   ⚠ 每房 count() 改成**預設不算**（?msgCounts=1 才算）。admin.html 自 v0.3 起
  //     對 `messageCount === undefined` 就有既有退路（畫成「💬 訊息」按鈕），
  //     所以關掉它不會有壞掉的畫面；要看數字時前端有按鈕可開（並標明會多花讀取）。
  app.get('/api/admin/firebase/rooms', requireFirebaseAdmin, requireFb, async (req, res) => {
    // ⚠ 常數刻意放在 handler **內部**：既有守衛（v6.229／v6.240）是把 app.get(...) 整段
    //   抽出來真的跑，handler 依賴外層變數會讓它抽出空殼。
    const FB_ROOMS_CAP_DEFAULT = 300;   // 上限依據見下方 res.json 上面的說明
    const FB_ROOMS_CAP_MAX = 1000;
    try {
      // v1.18: ?status= 過濾。
      const _sq = (req.query.status || '').trim();
      const _capRaw = Math.floor(Number(req.query.cap));
      const _cap = Math.min(Number.isFinite(_capRaw) && _capRaw > 0 ? _capRaw : FB_ROOMS_CAP_DEFAULT, FB_ROOMS_CAP_MAX);
      // ⚠ 排序欄位要**誠實回報**：帶 where 時 orderBy('updatedAt') 需要複合索引
      //   {status,updatedAt}，而 firestore.indexes.json 只宣告了 {status,createdAt}
      //   ⇒ 依序退階。退階**不會多花讀取**：缺索引的查詢回 FAILED_PRECONDITION，
      //   在讀到任何文件之前就被拒絕。
      //   ⚠⚠ 最後那層沒有 orderBy 的 limit 會照文件 id 取樣（等於隨機取 N 間房）——
      //   那種情況一定要讓前端知道，否則站長會以為自己看的是「最近的房」。
      let _orderedBy = 'updatedAt';
      let snap;
      if (_sq && _sq !== 'all') {
        const _q0 = adminDb.collection('rooms').where('status', '==', _sq);
        try {
          snap = await _q0.orderBy('updatedAt', 'desc').limit(_cap).get();
        } catch (e1) {
          try {
            snap = await _q0.orderBy('createdAt', 'desc').limit(_cap).get();
            _orderedBy = 'createdAt';
          } catch (e2) {
            snap = await _q0.limit(_cap).get();
            _orderedBy = '__name__';
          }
        }
      } else {
        snap = await adminDb.collection('rooms').orderBy('updatedAt', 'desc').limit(_cap).get();
      }
      const rooms = snap.docs.map(d => {
        const data = d.data();
        const r = {
          _id: d.id,
          ...data,
          updatedAt: tsToMillis(data.updatedAt),
          createdAt: tsToMillis(data.createdAt),
        };
        summarizeRoom(r);
        return r;
      });
      // v1.18: status 過濾時排序欄位不一定是 updatedAt → JS 一律補 updatedAt desc 排序。
      if (_sq && _sq !== 'all') rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      // v0.3: 並行用 count() aggregation 拿每房間訊息數（subcollection）
      // ⚠⚠ v1.31：這一段是 **N 次額外 Firestore 讀取**（每房 1 次 count()，官方計費見上方註解）。
      //   改成預設**不算**，?msgCounts=1 才算 —— 而且只對這份已經套過上限的清單算，
      //   最多就是 _cap 次。前端不給這個參數時 messageCount 會是 undefined，
      //   admin.html 的既有分支會畫成「💬 訊息」按鈕（點進去才真的讀那一房的訊息）。
      const _msgCounts = String(req.query.msgCounts || '') === '1';
      if (_msgCounts) {
        try {
          await Promise.all(rooms.map(async r => {
            try {
              const snap = await adminDb.collection('rooms').doc(r._id).collection('messages').count().get();
              r.messageCount = snap.data().count;
            } catch { r.messageCount = 0; }
          }));
        } catch (e) {
          console.warn('[admin] firebase messageCount failed:', e.message);
        }
      }
      // v0.6: 用 adminAuth.getUsers() 直接 enrich 每個 seat.uid 的 email / isAnonymous
      await enrichSeats(rooms);
      // v1.18: 永遠回全量三狀態計數（cheap count() aggregation），供 toolbar 顯示。
      let counts = { lobby: 0, playing: 0, ended: 0 };
      try {
        const [l, p, e2] = await Promise.all([
          adminDb.collection('rooms').where('status', '==', 'lobby').count().get(),
          adminDb.collection('rooms').where('status', '==', 'playing').count().get(),
          adminDb.collection('rooms').where('status', '==', 'ended').count().get(),
        ]);
        counts = { lobby: l.data().count, playing: p.data().count, ended: e2.data().count };
      } catch (e) { console.warn('[admin] firebase counts failed:', e.message); }
      // ⚠⚠ 哨兵欄位（比照 v1.22 的 paged／truncated）：
      //   capped     → 新伺服器才有；舊 admin.html 拿不到它就照舊行為（不會誤判）。
      //   matchedTotal → 目前這個 status 篩選底下的**全量真值**（來自上面的 count()，
      //                  與清單上限無關）⇒ 前端才能寫出「顯示最新 300 / 共 5,231」。
      //   truncated  → 有沒有被截斷。**絕不靜默截斷讓站長以為是全部**。
      //   orderedBy  → 這 N 筆是「依哪個欄位取的最前面 N 筆」。退到 '__name__' 時
      //                等於隨機取樣，畫面必須講明白。
      // 【上限 300 的依據】admin.html 每頁 50 筆 ⇒ 300 = 6 頁，足夠一眼掃過最近的活動；
      //   300（清單）+ 3（counts）≈ 303 次讀取／點一次，佔每日 50,000 次免費額度的 0.6%，
      //   站長一天點 100 次也只用掉 ~60%。原本「已結束全撈 × 2」是隨房數線性成長、無上界。
      //   不夠看時前端可以帶 ?cap=（硬上限 FB_ROOMS_CAP_MAX = 1000）。
      const _matchedTotal = (_sq && _sq !== 'all')
        ? (counts[_sq] != null ? counts[_sq] : null)
        : ((counts.lobby || 0) + (counts.playing || 0) + (counts.ended || 0));
      res.json({ rooms, counts, capped: true, cap: _cap, orderedBy: _orderedBy,
        msgCounts: _msgCounts, matchedTotal: _matchedTotal,
        truncated: rooms.length >= _cap || (_matchedTotal != null && _matchedTotal > rooms.length) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/rooms/:code', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const doc = await adminDb.collection('rooms').doc(req.params.code.toUpperCase()).get();
      if (!doc.exists) return res.json({ room: null });
      const data = doc.data();
      const room = {
        _id: doc.id,
        ...data,
        updatedAt: tsToMillis(data.updatedAt),
        createdAt: tsToMillis(data.createdAt),
      };
      res.json({ room });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/messages/:code', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const snap = await adminDb.collection('rooms').doc(code).collection('messages')
        .orderBy('createdAt', 'asc').limit(500).get();
      const messages = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: tsToMillis(data.createdAt),
        };
      });
      res.json({ messages });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/users', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const pageToken = req.query.pageToken;
      const result = await adminAuth.listUsers(100, pageToken);
      const users = result.users.map(u => ({
        uid: u.uid, email: u.email || null, emailVerified: u.emailVerified,
        displayName: u.displayName || null,
        anonymous: u.providerData.length === 0,
        createdAt: u.metadata.creationTime,
        lastSignIn: u.metadata.lastSignInTime,
        disabled: u.disabled,
      }));
      res.json({ users, pageToken: result.pageToken || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });


  // ══ v0.95 玩家帳號：一次撈完 + 記憶體快取（取代前端逐頁 pageToken 迴圈）══════════
  // 為什麼：前端原本自己跑 while(pageToken) 迴圈，而且每頁只抓 100 筆 —— 帳號一多就是
  //   十幾次「瀏覽器 → VM → Firebase」的往返，載入要等很久。伺服器與 Firebase 之間
  //   的延遲低一個量級，且每頁可抓到 1000 筆，改在這裡跑完再一次回傳快得多。
  // ⚠⚠ v1.32 (v6.275)：改吃中央 getRawUsersCached()（定義見 v1.19→v1.32 區塊）——
  //   ① TTL 過期不再同步等 15 秒級掃描（過期先回舊值、背景刷新；nginx 計時 log 2026-08-30
  //      的兩發 14.6／15.7 秒就是過期後的同步等待）；
  //   ② 與 /api/admin/stats 共用同一輪掃描（原本兩支各自掃一輪）；
  //   ③ 補 50,000 安全上限，被截斷回 capped:true（admin 畫面標明，絕不靜默截斷）；
  //   ④ ?refresh=1 仍同步等最新資料（刪帳號後按 Refresh 要立刻看到）。
  //   欄位映射與 v0.95 逐字相同；映射迴圈每 200 筆走中央 adminScanYield 讓路（v6.242 手法：
  //   50k 上限的最壞情況同步映射是數十 ms 級，讓路後事件迴圈單次阻塞降到毫秒級）。
  // 映射結果的 per-掃描 memo：同一份 raw 只映射一次
  const _usersAllView = { at: -1, users: null };

  async function mapRawUsersForList(rawUsers) {
    const out = [];
    for (const u of rawUsers) {
      out.push({
        uid: u.uid, email: u.email || null, emailVerified: u.emailVerified,
        displayName: u.displayName || null,
        anonymous: u.providerData.length === 0,
        createdAt: u.metadata.creationTime,
        lastSignIn: u.metadata.lastSignInTime,
        disabled: u.disabled,
      });
      const _y = adminScanYield(out.length); if (_y) await _y;   // ⚠ 每 200 筆讓路（v6.242）
    }
    return out;
  }

  app.get('/api/admin/firebase/users-all', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const force = String(req.query.refresh || '') === '1';
      const raw = await getRawUsersCached(force);
      if (_usersAllView.at !== raw.at) {
        _usersAllView.users = await mapRawUsersForList(raw.users);
        _usersAllView.at = raw.at;
      }
      res.json({ users: _usersAllView.users, cachedAt: raw.at, cached: true, capped: !!raw.capped });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v0.28: 批次 uid → email 查詢（意見回饋分頁只查「當前頁可見」的少數 uid，免載全量 users）。
  //   重用 lookupUserInfoBatch（5 分鐘 TTL 快取 + adminAuth.getUsers 每批 100）。
  //   body: { uids: string[] } → res: { emails: { [uid]: email|null } }（null=匿名/查無）。
  app.post('/api/admin/firebase/users/lookup', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const raw = Array.isArray(req.body && req.body.uids) ? req.body.uids : [];
      const uids = raw.filter(u => typeof u === 'string').slice(0, 200);  // 上限保護
      const emails = {};
      const realUids = [];
      for (const uid of uids) {
        if (isSessionAnonUid(uid)) emails[uid] = null;  // client 自產 anon id，無 Firebase email
        else realUids.push(uid);
      }
      if (realUids.length) {
        const info = await lookupUserInfoBatch(realUids);
        for (const uid of realUids) {
          const i = info.get(uid);
          emails[uid] = (i && i.email) || null;
        }
      }
      res.json({ emails });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/users/:uid/decks', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const snap = await adminDb.collection('users').doc(req.params.uid).collection('decks').get();
      const decks = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, name: data.name,
          entryCount: (data.entries || []).reduce((s, e) => s + (e.count || 0), 0),
          createdAt: tsToMillis(data.createdAt),
          updatedAt: tsToMillis(data.updatedAt),
          entries: data.entries,
        };
      });
      res.json({ decks });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/firebase/feedback', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      // v0.4: 不限上限（fetch all），讓 client 顯示完整列表
      // ⚠⚠ v1.31 (v6.272)：這裡原本每點一次「💬 意見回饋」分頁就把整個 collection
      //   讀一次（N 次 Firestore 讀取）。改走 getFeedbacksCached()：排序（createdAt desc）
      //   與欄位映射一字未動，TTL 5 分鐘內是 0 次讀取。
      //   回應多帶 at / truncated，讓畫面標示資料時間與「有沒有被 2000 筆上限截斷」。
      const _fbAll = await getFeedbacksCached();
      res.json({ feedback: _fbAll.items, at: _fbAll.at, truncated: _fbAll.truncated, cached: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // v0.9 MATCH RECORDS Phase 1
  //   inline 在主 .then() 內，才能用 requireFirebaseAdmin closure。
  //   POST /api/match-result   (公開 + rate-limit；client game-over fire)
  //   GET  /api/admin/match-records (admin auth)
  // ═════════════════════════════════════════════════════════════════════════════
  // ⚠v0.94：以下兩個 helper 必須定義在 registerMatchRecords 的 IIFE **之外** ——
  //   牌組原型「統計」與「明細」兩個端點在該 IIFE 之外，放進去會 ReferenceError。
  //   （IIFE 內的既有 caller 靠閉包仍然讀得到，所以往外移是安全的。）
  // ══ v0.92 卡片屬性表（湊 60 張時判斷「同名 4 張上限」的例外）════════════
  //   基本能量無張數上限、ACE SPEC 整副只能 1 張 —— 這兩個例外必須查卡片屬性才知道。
  //   ⚠不能用錦標賽段的 TPOOL（在另一個閉包，admin 段取不到會 ReferenceError），
  //     這裡從同一份 tournament-pool.json 自建輕量屬性表（CJS/ESM 雙寫法，v0.75 教訓）。
  let _cardAttrPromise = null;
  function getCardAttrMap() {
    if (!_cardAttrPromise) {
      _cardAttrPromise = (async () => {
        const P = '/opt/ptcg/api/tournament/tournament-pool.json';
        let poolObj = null;
        try { poolObj = require(P); }
        catch (e1) {
          try { const _fs = await import('fs'); poolObj = JSON.parse(_fs.readFileSync(P, 'utf8')); }
          catch (e2) { console.warn('[deck-detail] 卡片屬性表載入失敗:', e2 && e2.message); return new Map(); }
        }
        const m = new Map();
        for (const k of Object.keys(poolObj || {})) {
          const c = poolObj[k];
          if (!c) continue;
          m.set(String(k), {
            basicEnergy: c.supertype === 'Energy' && c.subtype === 'Basic',
            aceSpec: Array.isArray(c.tags) && c.tags.includes('ACE SPEC'),
            // v1.00 未分類高頻卡只列寶可夢用。⚠值是 'Pokemon'（**沒有重音符**），
            //   寫成 'Pokémon' 會全部比不中、整個清單變空。
            isPokemon: c.supertype === 'Pokemon',
          });
        }
        return m;
      })();
    }
    return _cardAttrPromise;
  }

  // ══ v1.01 cardId → 卡名對照 ═══════════════════════════════════════════
  //   ⚠**必須定義在所有 IIFE 之外**（v1.01 事故）：v1.00 新增的 getPokemonNameSet()
  //     在外層，但它呼叫的 getCardNameMap 當時還關在 registerStatsEndpoints 的 IIFE 內，
  //     外層完全看不到 → 一按「計算統計」就 ReferenceError『getCardNameMap is not defined』。
  //     IIFE 內原有的 caller 靠閉包仍讀得到外層，所以往外移是安全的（與 v0.94 同一手法）。
  //   ⚠CJS/ESM 雙寫法：本 patch 可能被插進 ESM host，那裡沒有 require（v0.75 gzip 教訓）。
  let _cardNamePromise = null;
  function getCardNameMap() {
    if (!_cardNamePromise) {
      _cardNamePromise = (async () => {
        const P = '/opt/ptcg/api/tournament/tournament-pool.json';
        let poolObj = null;
        try { poolObj = require(P); }
        catch (e1) {
          try { const _fs = await import('fs'); poolObj = JSON.parse(_fs.readFileSync(P, 'utf8')); }
          catch (e2) { console.warn('[deck-rules] 卡池載入失敗，規則比對將無法運作:', e2 && e2.message); return new Map(); }
        }
        const m = new Map();
        for (const k of Object.keys(poolObj || {})) {
          const c = poolObj[k];
          if (c && c.name) m.set(String(k), String(c.name));
        }
        console.log('[deck-rules] 卡名對照載入:', m.size, 'cards');
        return m;
      })();
    }
    return _cardNamePromise;
  }

  // ══ v1.00 寶可夢卡名集合 ═════════════════════════════════════════════
  //   未分類高頻卡的統計 key 是**卡名**（deckToSets 產出的 sets.names），
  //   而屬性表的 key 是 cardId → 需要用 cardId→卡名 對照把兩者接起來。
  //   用途：未分類高頻卡只列寶可夢，把老大的指令／莉莉艾的決意／基本能量這類
  //   「每副牌都有」的通用卡濾掉——它們對「該開什麼新規則」毫無鑑別度。
  let _pokemonNamePromise = null;
  function getPokemonNameSet() {
    if (!_pokemonNamePromise) {
      _pokemonNamePromise = (async () => {
        const [nameMap, attrMap] = await Promise.all([getCardNameMap(), getCardAttrMap()]);
        const s = new Set();
        for (const [cardId, name] of nameMap.entries()) {
          const a = attrMap.get(String(cardId));
          if (a && a.isPokemon && name) s.add(String(name));
        }
        return s;
      })();
    }
    return _pokemonNamePromise;
  }

  // ══ v1.00 「支援型寶可夢」排除清單 ══════════════════════════════════════
  //   吉雉雞ex、喵喵ex 這類幾乎每副牌都會放的功能性寶可夢，出現在「未分類高頻卡」
  //   同樣沒有鑑別度（它們不代表任何特定牌組）。清單由 Wilson 自行維護。
  //   存 mongo 而非寫死：新的支援型寶可夢會隨環境變動，寫死就得改程式碼重新部署。
  function getSupportPokemonCol() { return db.collection('deckRuleSettings'); }
  async function getSupportPokemonNames() {
    try {
      const doc = await getSupportPokemonCol().findOne({ _id: 'supportPokemon' });
      return new Set((doc && Array.isArray(doc.names) ? doc.names : []).map((x) => String(x)));
    } catch { return new Set(); }
  }

  // ══ v0.91 休閒統計「資料淨化」單一來源 ══════════════════════════════════
  //   原本這組條件在「2.3 卡牌勝率」與「牌組原型統計」各手寫一份，v0.39 補措辭時就得改兩處
  //   ＝典型漂移風險。收斂成一個 helper，兩邊共用。
  //
  //   ① excludeAI：只算「有房號」的對戰。client 端的 vsAI 旗標不可靠（v0.98 玩家規則），
  //      有房號＝線上對玩家；本機對戰（含本機 vs AI）一律排除。
  //   ② 中途離開致勝場（Wilson v0.91 裁定）：
  //      ・finalTurn <= 2 → **排除**。這段常見情形是「房主開了局卻不在」或對手一看開局就跑，
  //        勝負與牌組實力無關，會污染統計。
  //      ・finalTurn >= 3 → **納入**。雙方各已完成 2 個完整回合、都實際操作過，
  //        中途斷線仍是一場有意義的對局。
  //      ⚠finalTurn 是「完整回合數」不是半回合：engine 只在**後攻方**結束回合時才 +1，
  //        故先攻與後攻的第 1 回合 finalTurn 都是 1；turn>=3 ⇔ 雙方各完成 2 回合。
  //      ⚠舊資料若無 finalTurn 欄位，$gte 判定為 false → 維持「排除」的舊行為（向後相容）。
  const CASUAL_LEAVE_RE = /中途離開|離開房間|斷線|斷開|退出|不在場|disconnect|技不如人|先行離開/i;
  function buildCasualCleanFilter(opts) {
    const o = opts || {};
    const q = {};
    if (o.excludeAI !== false) q.roomCode = { $type: 'string' };
    if (o.since) q.endedAt = { $gte: o.since };
    if (o.winnerOnly) q.winner = { $in: [0, 1] };
    q.$or = [
      { winReason: { $not: CASUAL_LEAVE_RE } },   // 不是離開場 → 一律納入（含無 winReason 的舊場）
      { finalTurn: { $gte: 3 } },                 // 是離開場但雙方各已完成 2 回合 → 仍納入
    ];
    return q;
  }

  // ══ v6.242：admin 全量掃描的「讓路」節拍（Rule 30：絕不可讓玩家變慢）══════════
  //   ⚠⚠ cursor 只解決**記憶體**（同時駐留由 O(N) 變 O(1)），**不解決時間**：
  //     mongo 是一批一批送的（16MB / 每筆約 443B ≈ 上萬筆），一批進到 node 之後，
  //     批內每一次 cursor.next() 都是「**已解決**的 promise」⇒ `await` 只排空 microtask，
  //     事件迴圈**不會**回頭去跑玩家的 socket 回呼 ⇒ 整批期間玩家一律被擋住。
  //     實測（守衛內附 bench，沙盒 20 萬筆）：純 cursor 阻塞 max 200ms / p50 172ms。
  //   ⇒ 每 N 筆讓出一次。用 setImmediate（check 階段的 **macrotask**）而不是 await null／
  //     Promise.resolve()（那兩個只是 microtask，對 I/O 完全沒有幫助）。
  //     同一份資料改後阻塞 max 14.8ms / p99 6.6ms（沙盒；正式 VM 約快 10 倍 ⇒ ~1.5ms），
  //     總耗時只增加約 1.5%。
  //   ⚠ N 不是越小越好：每次 setImmediate 都是一輪事件迴圈，200 在「阻塞夠短」與
  //     「額外開銷可忽略」之間；實測 500 的 p99 是 20.3ms、200 是 6.6ms、總時間差 1%。
  const ADMIN_SCAN_YIELD_EVERY = 200;
  /** 回 Promise（該讓路了）或 null（還不用）。呼叫端寫 `const y = adminScanYield(n); if (y) await y;`
   *  —— 回 null 而不是 Promise.resolve()，是為了在不讓路的那 199 筆連 microtask 都不排。 */
  function adminScanYield(n) {
    if (n % ADMIN_SCAN_YIELD_EVERY !== 0) return null;
    return new Promise((resolve) => setImmediate(resolve));
  }

  // ══ v1.28（v6.266）套牌戰績 GET /api/deck-stats 的兩支索引 ═════════════════
  //   查詢形狀＝`$or:[{'p1.deckId':X},{'p2.deckId':X}]` ⇒ 兩支單欄索引，planner 走 index union。
  //   ⚠⚠ **一定要 sparse**：matchRecords 已累積 18 萬筆，那些舊列沒有 deckId 這個欄位；
  //     非 sparse 索引會把每一筆都以 null 鍵收進去（索引白白多 18 萬個 entry，
  //     而且 `{'p1.deckId': null}` 這種查詢會掃到全部舊列）。sparse ⇒ 索引**從 0 筆開始長**，
  //     只有 v6.266 之後真的帶 deckId 的新列才進去。
  //   ⚠ 不阻塞事件迴圈：索引的實際建構跑在 **mongod 行程**，node 這端只是送一發非同步命令；
  //     這裡不 await、`.catch()` 兜底，且比照 rooms/TEVENTS 的先例**只在服務啟動時建一次**、
  //     絕不放進 request handler。
  //   ⚠ 索引不改變任何查詢結果（只換 query plan），既有 18.5 萬筆一個位元都沒動。
  //   ⚠⚠ 位置刻意**不**放在 rooms 索引旁邊：test-v6240 的抽取器把「rooms 索引那一行到
  //     /api/admin/oracle/rooms 註冊之間」整段當成 pre 區段抽出來執行（並斷言只建 1 條索引），
  //     插在那裡會讓那支既有守衛紅（本版實際踩過）。放在 matchRecords 自己的區塊旁邊也更合理。
  try {
    db.collection('matchRecords').createIndex({ 'p1.deckId': 1 }, { sparse: true }).catch(() => { /* best-effort，已存在即略過 */ });
    db.collection('matchRecords').createIndex({ 'p2.deckId': 1 }, { sparse: true }).catch(() => { /* best-effort，已存在即略過 */ });
  } catch (e) { /* db 尚未就緒時略過，不影響服務啟動 */ }

  // ══ v1.33（v6.276）錦標賽勝率的 sparse 索引 ═════════════════════════════════
  //   查詢形狀＝{'players.deckId': X}（multikey）。⚠⚠ 一定要 sparse：既有 ~875 筆歸檔的
  //   players[] 沒有 deckId 欄位 ⇒ 索引**從 0 筆開始長**，只收 v6.276 之後的新歸檔。
  //   同上一段：只在服務啟動時建一次、不 await、catch 兜底；實際建構跑在 mongod 行程。
  try {
    db.collection('tournamentArchives').createIndex({ 'players.deckId': 1 }, { sparse: true }).catch(() => { /* best-effort，已存在即略過 */ });
  } catch (e) { /* db 尚未就緒時略過，不影響服務啟動 */ }

  // ══ v1.28（v6.266）deckId 的單一淨化出口 ═════════════════════════════════════
  //   ⚠⚠ 定義在**所有 IIFE 之外**：消費端有兩個且分屬不同 closure ——
  //     makePlayerDoc（registerMatchRecords IIFE 內）與 GET /api/deck-stats
  //     （registerStatsEndpoints IIFE 內）。放進任何一個 IIFE 都會讓另一邊
  //     ReferenceError（v0.94／v1.01 兩次線上事故就是這樣炸的；node --check 抓不到）。
  //   ⚠ 允許的字元集刻意涵蓋 client 端 newDeck() 的**兩種** id：
  //     ①`crypto.randomUUID()`（36 字元，含 `-`）
  //     ②沒有 randomUUID 時的 fallback `d_<base36>_<base36>`（含 `_`）
  //     —— 只收白名單字元，長度 8~64；不合格一律回 null（**不是**丟例外、也不是回 400，
  //     見 /api/match-result 的用法：戰績本身絕不可以因為一個附加欄位寫不進去）。
  const DECK_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
  function sanitizeDeckId(v) {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return DECK_ID_RE.test(t) ? t : null;
  }
  // ⭐v6.276：把淨化出口掛上 app.locals 供【錦標賽 IIFE】使用 —— 錦標賽區塊是**另一個**
  //   closure（v0.94／v1.01／v6.269 的跨 IIFE 教訓），在那裡直接呼叫 sanitizeDeckId 會
  //   ReferenceError。消費端（/register 等）一律 handler 執行時才取，取不到 fail-closed
  //   ＝不寫 deckId（絕不因此擋報名）。
  try { app.locals = app.locals || {}; app.locals._sanitizeDeckId = sanitizeDeckId; } catch (e) { /* app 尚未就緒時略過 */ }
  // ⭐v6.282 好友功能：把中央讓路節拍掛上 app.locals 供【錦標賽 IIFE】內的 /api/friends/* 使用 ——
  //   同 v6.269 的跨 IIFE 教訓（adminScanYield 在本 closure，端點在另一個 IIFE）；消費端
  //   handler 執行時才取、取不到 fail-closed 回 503（絕不 fail-open 成「沒有讓路的迴圈」）。
  try { app.locals = app.locals || {}; app.locals._adminScanYield = adminScanYield; } catch (e) { /* app 尚未就緒時略過 */ }

    // ══ ⭐⭐⭐v6.269 休閒批的彙總（admin 📡 分頁的「🎮 休閒」子表）══════════════════
  //   ⚠ v6.261 雖然備好了 `?mode=casual`，但那個參數**只換掉 `rows`（120 筆明細）的來源**：
  //     byReason 走 `_aggAll.filter(!isCasualReason)`、sampleRttRows 寫死 `mode:{$ne:'casual'}`
  //     ⇒ 帶了 `?mode=casual` 也**拿不到任何休閒統計**（次數／上行分佈／棄權宣告全是空的）。
  //     所以本版不是「把既有回應換個 mode」，而是補一條**完全獨立**的路徑。
  //   ⭐ 錦標賽那一整段（byReason／slowRtt／sample／rows）一個位元都沒動 —— 走的是早退，
  //     守衛用內嵌 sha256 逐位元證明。
  //   ⚠⚠ 絕不可拖累錦標賽（pm2 是 fork_mode 單 instance ⇒ 與錦標賽同一個 node 行程）：
  //     ① cursor 逐筆（**不 toArray**）⇒ 同時駐留的記憶體是 O(1)；
  //     ② 每 200 筆走中央 `adminScanYield` 讓路（v6.242 的實測結論：
  //        **cursor 只解決記憶體、讓路才解決時間** —— 批內 `cursor.next()` 是已解決的
  //        promise，`await` 只排空 microtask，事件迴圈不會回頭跑玩家的 socket 回呼）；
  //     ③ 硬上限 `CASUAL_DIAG_SCAN_CAP` 筆，超過回 `capped:true` 讓畫面明講「只算了最近 N 筆」
  //        （**不可以**靜默截斷 —— 那會讓統計數字自己失真而沒人知道，v6.240~v6.242 的教訓）。
  //   ⚠ 量級：v6.261 估 +30~100 筆/日、7 天 TTL ⇒ 正常情況一次掃幾百筆，上限是保險不是常態。
  const CASUAL_DIAG_SCAN_CAP = 5000;
  const CASUAL_DIAG_ROWS_SHOWN = 120;
  // ⚠ 逐字對齊 oracle-admin/tournament/dump-client-monitor.cjs 的 uaShort()／quant()，
  //   否則 admin 畫面與 dump 的同一個數字會對不起來（兩份口徑漂移正是 v6.213/v6.261 要防的）。
  function _casualUaShort(ua) {
    if (!ua) return '(未知)';
    const s = String(ua);
    if (/iPhone|iPad|iPod/.test(s)) return 'iOS / Safari 系';
    if (/Android/.test(s)) return 'Android';
    if (/Windows/.test(s)) return 'Windows';
    if (/Macintosh|Mac OS/.test(s)) return 'macOS';
    if (/Linux/.test(s)) return 'Linux';
    return s.slice(0, 30);
  }
  function _casualQuant(arr, q) {
    if (!arr || !arr.length) return null;
    const a = arr.slice().sort(function (x, y) { return x - y; });
    return a[Math.min(a.length - 1, Math.floor(a.length * q))];
  }
  /**
   * ⚠⚠ 回傳的每一個數字都**只算休閒列**，永遠不可以跟錦標賽那幾塊相加或互相比較：
   *   ・錦標賽走 /action（伺服器權威推進，一次往返＝一個動作）；
   *   ・休閒是 client-authoritative（一個動作＝把整包盤面 40~48KB PUT 上去，最多 5 輪 GET+PUT）。
   * ⚠ 母體再縮一層：**只有已登入 email 帳號的休閒玩家會送**（tournIdentity 丟棄匿名身分）。
   * ⚠ 倖存者偏差：client 要累積 10 發**成功**推送才可能送出指紋
   *   ⇒ **上行完全爆掉的人在這裡看不見**（他們連指紋都送不出來）。
   * @param coll  tournamentClientDiag（傳進來而不是吃閉包，守衛才能餵假的 collection 實跑）
   */
  async function _buildCasualDiagReport(coll, since, hours) {
    const out = {
      hours: hours, mode: 'casual', casualApi: 1,   // casualApi ＝哨兵：舊伺服器沒有這個欄位
      rows: 0, players: 0, truncated: 0, scanned: 0, scanCap: CASUAL_DIAG_SCAN_CAP, capped: false,
      byReason: [], byVersion: [], byPlatform: [],
      push: { rowsWithPush: 0, p50med: null, p95med: null, p95max: null, maxmax: null, fail: 0 },
      forfeitClaim: { total: 0, granted: 0, rejected: 0, unknown: 0 },
      list: [],
      note: '休閒批與錦標賽批是兩個母體（client-authoritative 整包 PUT vs /action 伺服器權威），'
        + '兩邊的數字永遠不可以相加或互相比較。母體只涵蓋已登入 email 帳號的休閒玩家，'
        + '而且要累積 10 發成功推送才送得出指紋（上行完全爆掉的人看不見）。',
    };
    const uids = Object.create(null);
    const rMap = new Map(), verMap = new Map(), uaMap = new Map();
    const p50s = [], p95s = [], maxs = [];
    const cur = coll.find({ ts: { $gte: since }, mode: 'casual' }).sort({ ts: -1 }).limit(CASUAL_DIAG_SCAN_CAP);
    let scanned = 0;
    while (await cur.hasNext()) {
      const r = await cur.next();
      scanned++;
      // ⚠ 逐字對齊 dump 的 parseDiag()：**空字串也算解析不出來**（不是「這列內容是空物件」）。
      //   寫成 `JSON.parse(r.diag || '{}')` 會把空 diag 當成合法列 ⇒ 截斷數少算。
      let o = null;
      try { o = (r && r.diag) ? JSON.parse(r.diag) : null; } catch (e) { o = null; }
      if (!o || typeof o !== 'object') { o = null; }
      // ⚠ 截斷判定與 dump 的 classifyTrunc 同調：伺服器旗標 or JSON.parse 失敗。
      //   ⚠ 欄位缺席**不可以**被讀成「這列沒被切」（那只代表這是 v6.184 以前的舊列）。
      if ((r && r.truncated === true) || !o) out.truncated++;
      if (r && r.uid) uids[r.uid] = 1;
      const rk = (r && r.reason) || '(未標)';
      rMap.set(rk, (rMap.get(rk) || 0) + 1);
      const ver = (o && typeof o.ver === 'string') ? o.ver : '(未知)';
      verMap.set(ver, (verMap.get(ver) || 0) + 1);
      const plat = _casualUaShort(o && o.env && o.env.ua);
      uaMap.set(plat, (uaMap.get(plat) || 0) + 1);
      const ph = (o && o.push && typeof o.push === 'object') ? o.push : null;
      if (ph) {
        out.push.rowsWithPush++;
        if (typeof ph.p50 === 'number' && isFinite(ph.p50) && ph.p50 >= 0) p50s.push(ph.p50);
        if (typeof ph.p95 === 'number' && isFinite(ph.p95) && ph.p95 >= 0) p95s.push(ph.p95);
        if (typeof ph.max === 'number' && isFinite(ph.max) && ph.max >= 0) maxs.push(ph.max);
        // ⚠ 失敗／逾時那幾發**沒有**進 p50/p95（進去會把分佈整個灌爆），所以要單獨累加。
        if (typeof ph.fail === 'number' && isFinite(ph.fail)) out.push.fail += ph.fail;
      }
      if (rk === 'casual-forfeit-claim') {
        out.forfeitClaim.total++;
        const c = (o && o.claim && typeof o.claim === 'object') ? o.claim : null;
        if (!c || typeof c.granted !== 'boolean') out.forfeitClaim.unknown++;
        else if (c.granted) out.forfeitClaim.granted++;
        else out.forfeitClaim.rejected++;
      }
      if (out.list.length < CASUAL_DIAG_ROWS_SHOWN) {
        out.list.push({
          ts: (r && r.ts) || 0, email: (r && r.email) || null, room: (r && r.room) || '', reason: rk,
          ver: (o && typeof o.ver === 'string') ? o.ver : null,
          push: ph, claim: (o && o.claim) || null,
          truncated: !!(r && r.truncated === true),
          rawLen: (r && typeof r.rawLen === 'number' && isFinite(r.rawLen)) ? r.rawLen : null,
          diag: (r && r.diag) || '',
        });
      }
      const _y = adminScanYield(scanned); if (_y) await _y;   // ⚠ 每 200 筆讓路（v6.242）
    }
    out.scanned = scanned;
    out.rows = scanned;
    out.capped = scanned >= CASUAL_DIAG_SCAN_CAP;
    out.players = Object.keys(uids).length;
    out.push.p50med = _casualQuant(p50s, 0.5);
    out.push.p95med = _casualQuant(p95s, 0.5);
    out.push.p95max = p95s.length ? Math.max.apply(null, p95s) : null;
    out.push.maxmax = maxs.length ? Math.max.apply(null, maxs) : null;
    const _toArr = function (m, key) {
      return [...m.entries()].map(function (e) { const o2 = { n: e[1] }; o2[key] = e[0]; return o2; })
        .sort(function (a, b) { return b.n - a.n; });
    };
    out.byReason = _toArr(rMap, 'reason');
    out.byVersion = _toArr(verMap, 'ver');
    out.byPlatform = _toArr(uaMap, 'platform');
    return out;
  }
  // ⚠⚠ 跨 IIFE 橋接（v0.94／v1.01 的教訓，與 v6.229 的 _archetypeEnrichRooms 同一手法）：
  //   本 helper 必須定義在**這個**區塊（中央 adminScanYield 在這裡），
  //   但消費端 `/api/tournament/admin/clientdiag` 在檔尾的另一個 IIFE 裡、看不到這個 closure
  //   ⇒ 掛 app.locals，由那邊在 **handler 執行時**才取（註冊時取會拿到 undefined）。
  app.locals = app.locals || {};
  app.locals._buildCasualDiagReport = _buildCasualDiagReport;

  (function registerMatchRecords() {
    // Rate-limit POST /api/match-result：避免惡意 client 灌資料
    const MR_RATE_WINDOW = 60 * 1000;
    const MR_RATE_MAX = 10;           // 每分鐘最多 10 筆 per IP（正常一場結束才 1 筆）
    const mrRateBuckets = new Map();

    function mrRateLimitCheck(ip) {
      const now = Date.now();
      const arr = (mrRateBuckets.get(ip) || []).filter(t => now - t < MR_RATE_WINDOW);
      if (arr.length >= MR_RATE_MAX) {
        mrRateBuckets.set(ip, arr);
        return false;
      }
      arr.push(now);
      mrRateBuckets.set(ip, arr);
      return true;
    }

    // 讀 JSON body helper
    function mrReadJsonBody(req) {
      return new Promise((resolve, reject) => {
        if (req.body && typeof req.body === 'object') return resolve(req.body);
        let data = '';
        req.on('data', chunk => { data += chunk; if (data.length > 100 * 1024) { reject(new Error('payload too large')); req.destroy(); } });
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
        req.on('error', reject);
      });
    }

    // 驗證 payload — 必要欄位 + 型別 sanity
    // v0.10: 接受 cardCounts (新格式 Record<id,count>) 或 cardIds (舊格式 string[])，兩者擇一即可
    function mrValidateRecord(rec) {
      if (!rec || typeof rec !== 'object') return 'payload not object';
      if (typeof rec.matchId !== 'string' || !rec.matchId) return 'matchId required';
      if (typeof rec.endedAt !== 'number' || rec.endedAt < 0) return 'endedAt required';
      if (rec.winner !== null && rec.winner !== 0 && rec.winner !== 1) return 'winner must be 0|1|null';
      if (typeof rec.finalTurn !== 'number') return 'finalTurn required';
      if (!rec.p1 || !rec.p2) return 'p1/p2 required';
      for (const side of ['p1', 'p2']) {
        const s = rec[side];
        if (typeof s.name !== 'string') return side + '.name required';
        const hasCounts = s.cardCounts && typeof s.cardCounts === 'object' && !Array.isArray(s.cardCounts);
        const hasIds = Array.isArray(s.cardIds);
        if (!hasCounts && !hasIds) return side + '.cardCounts or .cardIds required';
        if (hasCounts) {
          const keys = Object.keys(s.cardCounts);
          if (keys.length > 100) return side + '.cardCounts has too many keys';
          for (const k of keys) {
            if (typeof s.cardCounts[k] !== 'number' || s.cardCounts[k] < 0 || s.cardCounts[k] > 60) {
              return side + '.cardCounts[' + k + '] out of range (0-60)';
            }
          }
        }
        if (hasIds && s.cardIds.length > 100) return side + '.cardIds too long';
      }
      if (rec.mode !== 'local' && rec.mode !== 'online') return 'mode must be local|online';
      return null;
    }

    // v0.10: 把 client 端 p1/p2 payload 整成存進 DB 的 doc shape
    //   - 接受 cardCounts (新) 或 cardIds (舊)
    //   - 若兩者都沒 → 存空 cardCounts {}
    //   - 字元限長：name 60, email 120
    //   - cardCounts 最多 100 keys，每個 count 0-60（validate 已過濾，這裡再 sanitize 一次）
    function makePlayerDoc(p) {
      const doc = {
        name: String(p.name).substring(0, 60),
        email: p.email ? String(p.email).substring(0, 120) : null,
        cardCounts: {},
      };
      if (p.cardCounts && typeof p.cardCounts === 'object' && !Array.isArray(p.cardCounts)) {
        // 直接 sanitize cardCounts
        const keys = Object.keys(p.cardCounts).slice(0, 100);
        for (const k of keys) {
          const v = Number(p.cardCounts[k]);
          if (Number.isFinite(v) && v > 0 && v <= 60) {
            doc.cardCounts[String(k)] = Math.floor(v);
          }
        }
      } else if (Array.isArray(p.cardIds)) {
        // 舊客戶端 fallback：cardIds[] → cardCounts (每張視為 1)
        for (const id of p.cardIds.slice(0, 100)) {
          doc.cardCounts[String(id)] = 1;
        }
      }
      // v1.28（v6.266）套牌戰績：收下 client 送來的 deckId（牌組的穩定 UUID）。
      // ⚠⚠ **只有真的送來且合格才加這個欄位** —— 沒送就一個位元都不動，
      //   舊 payload 產出的 doc 與 v6.265 逐位元相同（守衛 test-v6266 的【正對照】
      //   用 JSON.stringify 逐字比對過，含 key 的順序）。
      // ⚠ 絕不寫 `doc.deckId = null`：欄位缺席才是「這是舊列／本機對戰」的唯一表示法，
      //   寫成 null 會讓 sparse 索引把它收進去（sparse 只跳過**缺席**，不跳過 null）。
      const _did = sanitizeDeckId(p && p.deckId);
      if (_did) doc.deckId = _did;
      return doc;
    }

    // >>> PTCG-PLAYER-IDENTITY-START (守衛 test-v6282-friends-p0.mjs 會把這一段抽出來實跑)
    // v1.36（v6.282）好友功能 P0：`playerIdentity` 對照表（email ↔ 最近 uid ↔ 最近暱稱）。
    //   為什麼需要：大廳列表回應裡只有 seats[].uid（email 已被 v1.20 剝成 null），而好友表以
    //   email 為 key ⇒ 好友清單回應要附上每個好友「目前的 uid」，client 才比對得出哪一間是好友的房。
    //   ⭐ 接點＝下方 /api/match-result 的 PTCG-MATCH-EMAIL-ENRICH 段：那一發 findOne 本來就
    //     一起投影 seats.uid＋seats.email（v6.220 起線上 client 送來的 email 一律 null ⇒ _needEmail
    //     恆真 ⇒ 每一場線上對局都會發），這裡只是把已經在手上的 uid/email 順手寫進對照表 ⇒
    //     **零額外查詢、不在熱路徑（每場一次、game-over 才發）、fire-and-forget（不 await、.catch()）**。
    //   ⚠ 不選 PUT /api/rooms 的回填 middleware：那是每個動作都會走的熱路徑（佔全站 94% 流量），
    //     而建房 POST 在核心 server.js（不在 repo 內）沒有掛點；兩者的 seat.email 同樣是 client
    //     自報（Firebase auth.currentUser.email），可信度相同，沒有選它的理由。
    //   ⚠ makePlayerDoc 不存 uid（只有 name/email/cardCounts/deckId）⇒ uid 只能從 seats[] 拿。
    //   ⚠⚠ uid 的真身：正式站的 seats[].uid 是 Oracle 匿名 JWT 發的 per-瀏覽器 uid（localStorage
    //     ptcg_oracle_uid），不是 Firebase uid；換裝置／清資料／401 續簽都會換 ⇒ 這張表記的是
    //     「最近一次完成對局的瀏覽器」，並保留最近 5 個（uids）給 client 一起比對。
    //   ⚠ 只記 p1/p2；email 不合格或 uid 缺席一律跳過；任何失敗都不影響戰績寫入。
    //   ⚠⚠ v1.37（v6.286）對抗性審查【2】：**不再寫 nick**。/api/match-result 沒有任何身分驗證（只有 IP 限流＋
    //     形狀檢查），payload 的 p1/p2.name 與 rooms.seats[].email 都是 client 自報 ⇒ 任何人 POST 一發就能把
    //     受害者在所有人好友名單裡的顯示名改掉（審查者用 harness 實證）。暱稱改由 friendships 自己的 nickA/nickB
    //     快照供應（見 _frPublic）。`names` 參數保留是為了不動 enrich 段的呼叫行（守衛 test-v6282 F1/F3 逐字鎖），
    //     helper 內**忽略**它。⚠ uid 同樣來自這條未驗證路徑（seats[].uid＋seats[].email 都是 client 自報）——
    //     本版保留（大廳「好友的房」標示靠它），但它只能當提示、不能當身分憑證；根治需要 client 改送自己的
    //     Oracle uid 到驗過 token 的 /api/friends/list（server 先上），見 docs/changelog-internal.md v6.286。
    //   ⚠ 既有 playerIdentity 文件裡已寫入的 nick 欄位原樣保留（不刪不改），只是不再有任何消費點。
    function recordPlayerIdentity(db, seats, _namesIgnored) {
      try {
        if (!db || !Array.isArray(seats)) return 0;
        const now = Date.now();
        let n = 0;
        for (let i = 0; i < 2 && i < seats.length; i++) {
          const s = seats[i];
          if (!s || typeof s !== 'object') continue;
          const em = (typeof s.email === 'string') ? s.email.trim().toLowerCase() : '';
          const uid = (typeof s.uid === 'string') ? s.uid.trim() : '';
          if (!em || em.length > 254 || em.indexOf('@') <= 0 || !uid || uid.length > 128) continue;
          const $set = { uid, uidAt: now, updatedAt: now };   // v1.37：不再寫 nick（理由見上）
          n++;
          Promise.resolve().then(() => db.collection('playerIdentity').updateOne(
            { _id: em },
            { $set, $setOnInsert: { createdAt: now }, $push: { uids: { $each: [{ uid, at: now }], $slice: -5 } } },
            { upsert: true },
          )).catch(() => { /* fire-and-forget：對照表寫失敗不影響戰績 */ });
        }
        return n;
      } catch (e) { return 0; }
    }
    // <<< PTCG-PLAYER-IDENTITY-END

    app.post('/api/match-result', async (req, res) => {
      const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
      if (!mrRateLimitCheck(ip)) {
        return res.status(429).json({ error: '請求過於頻繁（每分鐘最多 10 筆）' });
      }
      let body;
      try { body = await mrReadJsonBody(req); }
      catch (e) { return res.status(400).json({ error: 'JSON body 解析失敗：' + e.message }); }

      const err = mrValidateRecord(body);
      if (err) return res.status(400).json({ error: err });

      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });

      try {
        // 用 matchId 為 _id，upsert 防重複（client 端可能多次 fire）。
        const doc = {
          _id: body.matchId,
          roomCode: body.roomCode || null,
          mode: body.mode,
          vsAI: !!body.vsAI,
          aiSide: typeof body.aiSide === 'number' ? body.aiSide : null,
          winner: body.winner,
          winReason: typeof body.winReason === 'string' ? body.winReason.substring(0, 200) : '',
          finalTurn: body.finalTurn,
          durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
          startedAt: typeof body.startedAt === 'number' ? body.startedAt : null,
          endedAt: body.endedAt,
          p1: makePlayerDoc(body.p1),
          p2: makePlayerDoc(body.p2),
          ip,  // for abuse audit
          createdAt: new Date(),
        };
        // >>> PTCG-MATCH-EMAIL-ENRICH-START (守衛會抽出實跑)
        // v1.20(v6.220): seats[].email 已不再下發給玩家端(隱私) → 線上對局的 email 歸屬
        //   改由伺服器從房間 doc 補上(房間 doc 內仍保存 email)。舊 client 若有送 email
        //   以送來的值優先(行為不變);補不到就維持 null;任何失敗都不影響戰績寫入。
        // v1.28(v6.266): **deckId 併進同一發 findOne**(套牌戰績)。
        //   ⚠⚠ 為什麼一定要走「房間 seat」而不能只靠 payload：/api/match-result 是
        //     `$setOnInsert` ⇒ **只有先送到的那一發會落地**，而每個 client 只知道
        //     「自己」用了哪一副牌(對手的 deckId 在對手瀏覽器的 localStorage 裡)
        //     ⇒ 只靠 payload 的話，慢的那一側永遠缺 deckId、對局有一半會是瘸的。
        //   ⚠ 成本＝**零額外查詢**：v6.220 起 seats[].email 已不下發玩家端 ⇒ 線上 client
        //     送來的 p1/p2.email 一律是 null ⇒ 上面那個 email 條件在線上路徑本來就恆真、
        //     這一發 findOne 本來每場就會發。deckId 只是讓同一發多帶兩個小欄位回來。
        //   ⚠ seats[].deckId 是 **client 下一版才會寫入**的欄位(本版 server 先上;
        //     白名單會丟掉 client 送來的新欄位，所以順序不能反)。現在補不到 ⇒ 什麼都不寫。
        //   ⚠ 一律 fail-open：查不到／欄位不合格／DB 掛 → 戰績照常寫入，只是少一個欄位。
        try {
          const _needEmail = !doc.p1.email || !doc.p2.email;
          const _needDeckId = !doc.p1.deckId || !doc.p2.deckId;
          if (doc.roomCode && (_needEmail || _needDeckId)) {
            const _rm = await db.collection('rooms').findOne(
              { _id: String(doc.roomCode).toUpperCase() },
              { projection: { 'seats.uid': 1, 'seats.email': 1, 'seats.deckId': 1 } },
            );
            const _st = _rm && Array.isArray(_rm.seats) ? _rm.seats : [];
            if (!doc.p1.email && _st[0] && _st[0].email) doc.p1.email = String(_st[0].email).substring(0, 120);
            if (!doc.p2.email && _st[1] && _st[1].email) doc.p2.email = String(_st[1].email).substring(0, 120);
            // ⚠ 與 email 同一條規則：client 有送就以 client 為準(它才知道自己按了哪一副)，
            //   沒送才用房間 seat 補；補到不合格的值一律當作沒有。
            if (!doc.p1.deckId && _st[0]) { const _d = sanitizeDeckId(_st[0].deckId); if (_d) doc.p1.deckId = _d; }
            if (!doc.p2.deckId && _st[1]) { const _d = sanitizeDeckId(_st[1].deckId); if (_d) doc.p2.deckId = _d; }
            // v1.36(v6.282) 好友功能:playerIdentity 對照表(email ↔ 最近 uid ↔ 暱稱)順手寫 —— 同一發 findOne
            //   已把 seats.uid+seats.email 拿在手上 ⇒ 零額外查詢;helper 內 fire-and-forget。
            //   typeof 守衛:test-v6220/test-v6266 只用 db/doc/sanitizeDeckId 把這一段抽出來跑,那裡沒有這支 helper。
            if (typeof recordPlayerIdentity === 'function') recordPlayerIdentity(db, _st, [doc.p1 && doc.p1.name, doc.p2 && doc.p2.name]);
          }
        } catch (_e) { /* email/deckId 補寫失敗不影響戰績寫入 */ }
        // <<< PTCG-MATCH-EMAIL-ENRICH-END
        // upsert — 已存在的 matchId 不會 dup（同場 game-over 多次觸發保護）
        const result = await db.collection('matchRecords').updateOne(
          { _id: body.matchId },
          { $setOnInsert: doc },
          { upsert: true }
        );
        const inserted = result.upsertedCount === 1;
        if (inserted) {
          console.log('[match-record] new match ' + body.matchId + ' p1=' + doc.p1.name + ' vs p2=' + doc.p2.name + ' winner=' + body.winner + ' from ' + ip);
        }
        res.json({ ok: true, inserted });
      } catch (e) {
        console.warn('[match-record] insert error:', e.message);
        res.status(500).json({ error: '寫入失敗: ' + e.message });
      }
    });

    app.get('/api/admin/match-records', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const limit = Math.min(parseInt(req.query.limit) || 50, 500);
      const skip = parseInt(req.query.skip) || 0;
      // v0.29：改用 $and 組合條件，支援「全站搜尋」q（房號/玩家名/email 模糊）+ cardIds（牌組含此卡）。
      const and = [];
      // mode filter（roomCode 判斷：有房號=線上、無=本機）
      if (req.query.mode === 'online') and.push({ roomCode: { $type: 'string' } });
      else if (req.query.mode === 'local') and.push({ roomCode: null });
      if (req.query.since) and.push({ endedAt: { $gte: parseInt(req.query.since) } });
      // 向後相容：舊 email 精確 filter
      if (req.query.email) and.push({ $or: [{ 'p1.email': req.query.email }, { 'p2.email': req.query.email }] });
      // v0.29 全站搜尋：q 對 房號/p1+p2 的 name/email 做 case-insensitive 模糊比對；
      //   cardIds（client 把寶可夢名解析成的卡 id 清單）對 p1/p2.cardCounts 做「含此卡」比對（牌組搜尋）。
      const q = String(req.query.q || '').trim();
      const cardIds = req.query.cardIds
        ? String(req.query.cardIds).split(',').map(s => s.trim()).filter(Boolean).slice(0, 300)
        : [];
      if (q || cardIds.length) {
        const or = [];
        if (q) {
          const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          or.push({ roomCode: rx }, { 'p1.name': rx }, { 'p2.name': rx }, { 'p1.email': rx }, { 'p2.email': rx });
        }
        for (const id of cardIds) {
          or.push({ ['p1.cardCounts.' + id]: { $gt: 0 } }, { ['p2.cardCounts.' + id]: { $gt: 0 } });
        }
        if (or.length) and.push({ $or: or });
      }
      const filter = and.length ? { $and: and } : {};
      try {
        const [records, total] = await Promise.all([
          db.collection('matchRecords')
            .find(filter)
            .sort({ endedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
          db.collection('matchRecords').countDocuments(filter),
        ]);
        res.json({ records, total, limit, skip });
      } catch (e) {
        console.warn('[admin match-records] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // v0.11：DELETE 單筆 — admin 測試資料清理用，避免污染後續 Phase 2 統計
    app.delete('/api/admin/match-records/:matchId', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const matchId = String(req.params.matchId || '').trim();
      if (!matchId) return res.status(400).json({ error: 'matchId required' });
      try {
        const result = await db.collection('matchRecords').deleteOne({ _id: matchId });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'matchRecord not found: ' + matchId });
        }
        console.log('[match-record] deleted matchId=' + matchId + ' by admin=' + (req.adminUser?.email || 'unknown'));
        res.json({ ok: true, deletedCount: result.deletedCount });
      } catch (e) {
        console.warn('[match-record delete] error:', e.message);
        res.status(500).json({ error: '刪除失敗: ' + e.message });
      }
    });

    console.log('[match-records] v0.2 endpoints registered: POST /api/match-result + GET/DELETE /api/admin/match-records');
  })();

  // ═════════════════════════════════════════════════════════════════════════════
  // v0.12 Phase 2a — Tier 1 統計 endpoints + cardTags collection
  //   GET /api/admin/stats/overview  (1.1 總場次 / 1.2 先攻後攻勝率 / 1.3 對戰時長回合 / 1.4 勝因)
  //   GET /api/admin/stats/cards     (1.5-1.8 卡牌使用率原始資料，admin 端做 supertype 分群)
  //   GET /api/admin/cards/tags      (列出所有 cardTags — 給 admin 端 cache)
  //   POST /api/admin/cards/tags/:cardId  (toggle/upsert tag — 給「⭐ 標支援型」按鈕用)
  // ═════════════════════════════════════════════════════════════════════════════
  (function registerStatsEndpoints() {
    // 1.1-1.4 對戰總覽 — 單一 aggregate 跑 N 個 $facet
    // v0.12 + 全局 ?mode=online|local 過濾（玩家要區分線上 vs 本機統計）
    app.get('/api/admin/stats/overview', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const now = Date.now();
      const ONE_DAY = 24 * 60 * 60 * 1000;
      // 全局 mode filter — 在 $facet 之前先過濾
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      try {
        const pipeline = [];
        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });
        pipeline.push({ $facet: {
            // 1.1 總場次 — 各類別 count
            totals: [
              { $group: {
                _id: null,
                all: { $sum: 1 },
                online: { $sum: { $cond: [{ $and: [{ $ne: ['$roomCode', null] }, { $ne: ['$roomCode', ''] }] }, 1, 0] } },
                local: { $sum: { $cond: [{ $or: [{ $eq: ['$roomCode', null] }, { $eq: ['$roomCode', ''] }] }, 1, 0] } },
                vsAI: { $sum: { $cond: ['$vsAI', 1, 0] } },
                humanOnly: { $sum: { $cond: ['$vsAI', 0, 1] } },
              }},
              { $project: { _id: 0 } },
            ],
            new24h: [{ $match: { endedAt: { $gte: now - ONE_DAY } } }, { $count: 'n' }],
            // v0.25：前 24h（24–48h 前）給 1.1 成長率比較
            new24hPrev: [{ $match: { endedAt: { $gte: now - 2 * ONE_DAY, $lt: now - ONE_DAY } } }, { $count: 'n' }],
            new7d: [{ $match: { endedAt: { $gte: now - 7 * ONE_DAY } } }, { $count: 'n' }],
            new30d: [{ $match: { endedAt: { $gte: now - 30 * ONE_DAY } } }, { $count: 'n' }],
            // 1.2 先攻後攻勝率（可選 filter：只看真人對戰）
            firstMover: [
              { $group: {
                _id: null,
                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              }},
              { $project: { _id: 0 } },
            ],
            firstMoverHumanOnly: [
              { $match: { vsAI: { $ne: true } } },
              { $group: {
                _id: null,
                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              }},
              { $project: { _id: 0 } },
            ],
            firstMoverOnlineOnly: [
              { $match: { $and: [{ roomCode: { $type: 'string' } }, { vsAI: { $ne: true } }] } },
              { $group: {
                _id: null,
                p1Win: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
                p2Win: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
                draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              }},
              { $project: { _id: 0 } },
            ],
            // 1.3 對戰時長 / 回合（avg + bucket histogram）
            durationAvg: [
              { $match: { durationMs: { $gt: 0 } } },
              { $group: { _id: null, avg: { $avg: '$durationMs' }, count: { $sum: 1 } } },
              { $project: { _id: 0 } },
            ],
            durationHistogram: [
              { $match: { durationMs: { $gt: 0 } } },
              { $bucket: {
                groupBy: '$durationMs',
                boundaries: [0, 300000, 600000, 900000, 1200000, 1500000, 1800000, 2400000, 3000000, 3600000],
                default: '60+',
                output: { count: { $sum: 1 } },
              }},
            ],
            turnsAvg: [
              { $match: { finalTurn: { $gt: 0 } } },
              { $group: { _id: null, avg: { $avg: '$finalTurn' }, count: { $sum: 1 } } },
              { $project: { _id: 0 } },
            ],
            turnsDistribution: [
              { $match: { finalTurn: { $gt: 0 } } },
              { $group: { _id: '$finalTurn', count: { $sum: 1 } } },
              { $sort: { _id: 1 } },
              { $limit: 40 },  // turn 1 - 40, 超過會被截
            ],
            // 1.4 勝因分佈
            winReasons: [
              { $match: { winReason: { $ne: '' } } },
              // v0.30: 加入「是否第一回合(含開局設置)結束」維度，讓 1.4 勝因分佈能區分
              //   第一回合離開(開房者掛機) vs 其他回合離開(中途認輸放棄)。finalTurn<=1 視為第一回合。
              { $group: { _id: { r: '$winReason', ft: { $lte: ['$finalTurn', 1] } }, count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 100 },
            ],
          }});
        const [agg] = await db.collection('matchRecords').aggregate(pipeline).toArray();

        const unwrap = (arr, fallback) => (arr && arr[0]) ? arr[0] : fallback;
        const unwrapCount = (arr) => (arr && arr[0]) ? arr[0].n : 0;

        res.json({
          total: unwrap(agg.totals, { all: 0, online: 0, local: 0, vsAI: 0, humanOnly: 0 }),
          new24h: unwrapCount(agg.new24h),
          new24hPrev: unwrapCount(agg.new24hPrev),
          new7d: unwrapCount(agg.new7d),
          new30d: unwrapCount(agg.new30d),
          firstMover: {
            all: unwrap(agg.firstMover, { p1Win: 0, p2Win: 0, draws: 0 }),
            humanOnly: unwrap(agg.firstMoverHumanOnly, { p1Win: 0, p2Win: 0, draws: 0 }),
            onlineHumanOnly: unwrap(agg.firstMoverOnlineOnly, { p1Win: 0, p2Win: 0, draws: 0 }),
          },
          duration: {
            avgMs: unwrap(agg.durationAvg, { avg: 0 }).avg || 0,
            sampleCount: unwrap(agg.durationAvg, { count: 0 }).count || 0,
            histogram: agg.durationHistogram || [],
          },
          turns: {
            avg: unwrap(agg.turnsAvg, { avg: 0 }).avg || 0,
            sampleCount: unwrap(agg.turnsAvg, { count: 0 }).count || 0,
            distribution: agg.turnsDistribution || [],
          },
          winReasons: (agg.winReasons || []).map(x => ({ reason: x._id.r, firstTurn: !!x._id.ft, count: x.count })),  // v0.30: 帶出 firstTurn 供客戶端細分離開類
        });
      } catch (e) {
        console.warn('[stats overview] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 1.5-1.8 卡牌使用率（admin 端做 supertype/subtype/pokemonType 分群）
    //   server 純算 cardId → { totalCount, deckCount }，回傳前 N 筆。
    //   admin 端拿到後用 cardInfoMap 補名稱 + supertype 等資訊。
    app.get('/api/admin/stats/cards', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const limit = Math.max(1, parseInt(req.query.limit) || 100); // v0.20: 拿掉 default 300 + cap 1000 — Oracle 無額度限制；client 仍 pagination limit=50
      // 可選 mode filter（線上 only / 本機 only）
      const matchStage = {};
      if (req.query.mode === 'online') matchStage.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') matchStage.roomCode = null;
      // 可選 since filter
      if (req.query.since) matchStage.endedAt = { $gte: parseInt(req.query.since) };

      try {
        const pipeline = [];
        if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });
        pipeline.push(
          // 同時展開 p1 + p2 牌組（兩邊都算）
          { $project: { decks: [
            { cardCounts: '$p1.cardCounts' },
            { cardCounts: '$p2.cardCounts' },
          ]}},
          { $unwind: '$decks' },
          // cardCounts: {cardId: count} → array of {k, v}
          { $project: { entries: { $objectToArray: '$decks.cardCounts' } } },
          { $unwind: '$entries' },
          { $group: {
            _id: '$entries.k',
            totalCount: { $sum: '$entries.v' },  // 累計總張數
            deckCount: { $sum: 1 },              // 出現在幾副牌組
          }},
          { $sort: { totalCount: -1 } },
          { $limit: limit },
          { $project: { _id: 0, cardId: '$_id', totalCount: 1, deckCount: 1 } },
        );

        const [cards, deckCountAgg] = await Promise.all([
          db.collection('matchRecords').aggregate(pipeline).toArray(),
          // 總共有幾副牌組（= matches × 2）— 用來算 deck usage %
          db.collection('matchRecords').countDocuments(matchStage),
        ]);
        const totalDecks = deckCountAgg * 2;

        res.json({
          cards,
          totalDecks,
          generatedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[stats cards] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // cardTags：admin 標記某張卡為「支援型」等 tag（用於 1.6 分群顯示）
    //   document shape: { _id: cardId, tags: ['support', ...], updatedAt, updatedBy }
    app.get('/api/admin/cards/tags', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      try {
        const docs = await db.collection('cardTags').find({}).toArray();
        const tagMap = {};
        for (const d of docs) tagMap[d._id] = d.tags || [];
        res.json({ tags: tagMap });
      } catch (e) {
        console.warn('[card tags get] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // POST body: { tag: 'support', action: 'add' | 'remove' }
    app.post('/api/admin/cards/tags/:cardId', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const cardId = String(req.params.cardId || '').trim();
      if (!cardId) return res.status(400).json({ error: 'cardId required' });
      let body;
      try {
        body = await new Promise((resolve, reject) => {
          if (req.body && typeof req.body === 'object') return resolve(req.body);
          let data = '';
          req.on('data', c => { data += c; if (data.length > 10 * 1024) { reject(new Error('payload too large')); req.destroy(); } });
          req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
          req.on('error', reject);
        });
      } catch (e) { return res.status(400).json({ error: 'JSON body 解析失敗：' + e.message }); }
      const tag = String(body?.tag || '').trim();
      const action = String(body?.action || 'add');
      if (!tag || !/^[a-z_]+$/i.test(tag) || tag.length > 30) return res.status(400).json({ error: 'invalid tag (alphanumeric, ≤30 chars)' });
      if (action !== 'add' && action !== 'remove') return res.status(400).json({ error: 'action must be add|remove' });
      try {
        const now = new Date();
        const admin = req.adminUser?.email || 'unknown';
        const update = action === 'add'
          ? { $addToSet: { tags: tag }, $set: { updatedAt: now, updatedBy: admin } }
          : { $pull: { tags: tag }, $set: { updatedAt: now, updatedBy: admin } };
        await db.collection('cardTags').updateOne({ _id: cardId }, update, { upsert: true });
        const doc = await db.collection('cardTags').findOne({ _id: cardId });
        res.json({ ok: true, cardId, tags: doc?.tags || [] });
      } catch (e) {
        console.warn('[card tags post] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    // v0.13 Phase 2b — 5 個 Tier 2 endpoints
    // ────────────────────────────────────────────────────────────────────────

    // 2.1 玩家排行榜 — 用 p1/p2 email 聚合，含勝/負/平/勝率
    //   ?mode=online|local (default 全部)
    //   ?excludeAI=true (default false — true 則排除 vsAI 場)
    //   ?minMatches=N (default 1 — 最少對戰場次，過濾雜訊)
    app.get('/api/admin/stats/players', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      // v0.17: excludeAI 改用「roomCode 有值 OR vsAI != true」— 線上對戰一律算真人（不可能有 AI 配對）
      //   背景：v0.16 diagnostic 顯示 134 筆線上對戰被 client 誤標 vsAI=true（aiPlayerIndex 殘留 bug）
      //   roomCode 才是線上對戰 source of truth，繞過 vsAI 旗標誤判
      if (req.query.excludeAI === 'true') {
        baseMatch.$or = [
          { roomCode: { $type: 'string' } },  // 線上對戰必為真人
          { vsAI: { $ne: true } },             // 本機非 AI 場
        ];
      }
      const minMatches = Math.max(1, parseInt(req.query.minMatches) || 1);
      try {
        const pipeline = [];
        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });
        pipeline.push({ $facet: {
          // v0.15 P1 視角：email 為主鍵；email 缺則用 name (prefix "name:" 避免與 email 碰撞)
          //   實況：多數玩家為 Firebase 匿名登入（無 email），但有 displayName。
          //   PM2 log 確認 asP1=0 asP2=0 而 match log 有 p1=ええ vs p2=雷電獸來了!! 等多場
          //   → 完全沒 email、name 為唯一身份。改 name fallback 才能呈現排行。
          //   AI 玩家以 name 開頭含 '🤖' 排除（vsAI 旗標其實上層 baseMatch 已擋了，這層作雙保險）
          asP1: [
            // 必須有 name 才有資格上榜（AI 玩家用 '🤖 AI 對手' 此處不擋，靠 baseMatch.vsAI 擋）
            { $match: { 'p1.name': { $nin: [null, ''] } } },
            { $group: {
              _id: { $ifNull: ['$p1.email', { $concat: ['name:', '$p1.name'] }] },
              name: { $last: '$p1.name' },
              email: { $last: '$p1.email' },
              matches: { $sum: 1 },
              wins: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
              losses: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
              draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              // v0.39 中離：p1 為敗方(winner=1) 且 winReason 含「中途離開」→ p1 該場中離
              midLeaves: { $sum: { $cond: [ { $and: [ { $eq: ['$winner', 1] }, { $regexMatch: { input: { $ifNull: ['$winReason', ''] }, regex: '中途離開|離開房間|斷線|斷開|退出|不在場|disconnect|技不如人|先行離開', options: 'i' } } ] }, 1, 0 ] } },
            }},
          ],
          asP2: [
            { $match: { 'p2.name': { $nin: [null, ''] } } },
            { $group: {
              _id: { $ifNull: ['$p2.email', { $concat: ['name:', '$p2.name'] }] },
              name: { $last: '$p2.name' },
              email: { $last: '$p2.email' },
              matches: { $sum: 1 },
              wins: { $sum: { $cond: [{ $eq: ['$winner', 1] }, 1, 0] } },
              losses: { $sum: { $cond: [{ $eq: ['$winner', 0] }, 1, 0] } },
              draws: { $sum: { $cond: [{ $eq: ['$winner', null] }, 1, 0] } },
              // v0.39 中離：p2 為敗方(winner=0) 且 winReason 含「中途離開」→ p2 該場中離
              midLeaves: { $sum: { $cond: [ { $and: [ { $eq: ['$winner', 0] }, { $regexMatch: { input: { $ifNull: ['$winReason', ''] }, regex: '中途離開|離開房間|斷線|斷開|退出|不在場|disconnect|技不如人|先行離開', options: 'i' } } ] }, 1, 0 ] } },
            }},
          ],
        }});
        const [agg] = await db.collection('matchRecords').aggregate(pipeline).toArray();
        // merge p1 + p2 by composite key (server-side JS) — key 即 _id，可能是 email 或 "name:xxx"
        const merged = new Map();
        for (const src of [agg.asP1, agg.asP2]) {
          for (const row of (src || [])) {
            const key = row._id;
            if (!merged.has(key)) merged.set(key, { key, email: row.email || null, name: row.name, matches: 0, wins: 0, losses: 0, draws: 0, midLeaves: 0 });
            const m = merged.get(key);
            m.matches += row.matches;
            m.wins += row.wins;
            m.losses += row.losses;
            m.draws += row.draws;
            m.midLeaves += row.midLeaves || 0;
            if (row.name) m.name = row.name;  // 後寫贏（取最新 name）
            if (row.email && !m.email) m.email = row.email;  // 補 email
          }
        }
        // v0.15 過濾掉 AI 玩家（'🤖 AI 對手' / '玩家 1' 等 default name 也 OK — 至少能看）
        //   注意：vsAI=true 在 baseMatch 已過濾整場，這裡額外擋名字含 🤖 的兜底
        const isAIPlayer = (n) => typeof n === 'string' && n.includes('🤖');
        const list = [...merged.values()]
          .filter(p => p.matches >= minMatches)
          .filter(p => !isAIPlayer(p.name))  // v0.15 排除 AI 玩家
          .map(p => {
            const decisive = p.wins + p.losses;  // 排除平局算勝率
            p.winRate = decisive > 0 ? p.wins / decisive : null;
            return p;
          })
          .sort((a, b) => b.matches - a.matches);
        // v0.15 diagnostic — 部署後可用 PM2 log 觀察排行榜資料分佈
        const _p1Count = (agg.asP1 || []).length;
        const _p2Count = (agg.asP2 || []).length;
        const _withEmail = list.filter(p => p.email).length;
        // v0.16 完整診斷 — 各階段 record 數，找出資料在哪一步被過濾掉
        //   執行 4 個獨立 countDocuments，每個 ~10ms，admin 統計用 OK
        const [totalAll, onlineAll, localAll, vsAIAll, nonAIAll, afterBaseMatch] = await Promise.all([
          db.collection('matchRecords').countDocuments({}),
          db.collection('matchRecords').countDocuments({ roomCode: { $type: 'string' } }),
          db.collection('matchRecords').countDocuments({ roomCode: null }),
          db.collection('matchRecords').countDocuments({ vsAI: true }),
          db.collection('matchRecords').countDocuments({ vsAI: { $ne: true } }),
          db.collection('matchRecords').countDocuments(baseMatch),
        ]);
        // 取 1 筆 sample 看實際 shape（檢查 p1.name / p1.email 等 field 結構）
        const sample = await db.collection('matchRecords').findOne(baseMatch, {
          projection: { _id: 1, roomCode: 1, vsAI: 1, mode: 1, winner: 1, 'p1.name': 1, 'p1.email': 1, 'p2.name': 1, 'p2.email': 1, endedAt: 1 },
          sort: { endedAt: -1 },
        });
        const fullDebug = {
          asP1Count: _p1Count,
          asP2Count: _p2Count,
          mergedCount: list.length,
          withEmail: _withEmail,
          // v0.16 新增
          query: { mode: req.query.mode || 'all', excludeAI: req.query.excludeAI === 'true' },
          dataBreakdown: {
            totalRecords: totalAll,
            onlineRecords: onlineAll,
            localRecords: localAll,
            vsAIRecords: vsAIAll,
            nonAIRecords: nonAIAll,
            afterBaseMatchFilter: afterBaseMatch,
          },
          sampleAfterBaseMatch: sample,
        };
        console.log('[stats players] q=' + JSON.stringify({mode:req.query.mode,excludeAI:req.query.excludeAI}) + ' total=' + totalAll + ' online=' + onlineAll + ' local=' + localAll + ' nonAI=' + nonAIAll + ' afterFilter=' + afterBaseMatch + ' asP1=' + _p1Count + ' asP2=' + _p2Count + ' merged=' + list.length + ' withEmail=' + _withEmail);
        res.json({ players: list, generatedAt: Date.now(), debug: fullDebug });
      } catch (e) {
        console.warn('[stats players] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.2 個人戰績頁 — 最近 N 場（顯示）+ 生涯總戰績 + 常用卡 Top 20（統計）
    //   path param: :email
    //   ?recent=30 (default，上限 200)
    // ⚠⚠ v6.243 查證（原註解寫「勝率走勢」，那個區塊根本不存在，v6.242 的掃描筆記照著它誤判成統計失真）：
    //   `recentLimit` **只**控制下面那一條 find 的顯示筆數，產物只有 recentMatches
    //   （admin 畫面上的「最近 N 場對戰」表格）。summary 與 topCards 走的是另外兩支 aggregate，
    //   $match 只有 email 條件、之後沒有任何 $limit ⇒ 本來就是這位玩家的**生涯全量**。
    //   ⚠ 因此**不要**把 recentMatches 改成全量：每筆 matchRecord 都帶雙方 60 張的 cardCounts，
    //     實測回應體積會變 4.7 倍，而 admin 點一次玩家 email 就會打這一支。
    //   守衛：scripts/test-v6243-player-detail-scope.mjs
    app.get('/api/admin/stats/players/:email', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const email = decodeURIComponent(String(req.params.email || '')).trim();
      if (!email) return res.status(400).json({ error: 'email required' });
      const recentLimit = Math.min(parseInt(req.query.recent) || 30, 200);
      try {
        // 玩家所有對戰（p1.email 或 p2.email match）
        const playerMatches = await db.collection('matchRecords').find({
          $or: [{ 'p1.email': email }, { 'p2.email': email }],
        }).sort({ endedAt: -1 }).limit(recentLimit).toArray();

        // summary（全部對戰，不限 recentLimit）
        const summaryPipeline = [
          { $match: { $or: [{ 'p1.email': email }, { 'p2.email': email }] } },
          { $project: {
            isP1: { $eq: ['$p1.email', email] },
            winner: 1,
            cardCounts: { $cond: [{ $eq: ['$p1.email', email] }, '$p1.cardCounts', '$p2.cardCounts'] },
          }},
          { $project: {
            isWin: { $or: [
              { $and: ['$isP1', { $eq: ['$winner', 0] }] },
              { $and: [{ $not: '$isP1' }, { $eq: ['$winner', 1] }] },
            ]},
            isLoss: { $or: [
              { $and: ['$isP1', { $eq: ['$winner', 1] }] },
              { $and: [{ $not: '$isP1' }, { $eq: ['$winner', 0] }] },
            ]},
            isDraw: { $eq: ['$winner', null] },
            cardCounts: 1,
          }},
        ];
        const [counts] = await db.collection('matchRecords').aggregate([
          ...summaryPipeline,
          { $group: {
            _id: null,
            matches: { $sum: 1 },
            wins: { $sum: { $cond: ['$isWin', 1, 0] } },
            losses: { $sum: { $cond: ['$isLoss', 1, 0] } },
            draws: { $sum: { $cond: ['$isDraw', 1, 0] } },
          }},
        ]).toArray();

        // 常用卡 Top 20（從玩家牌組的 cardCounts 聚合）
        const topCards = await db.collection('matchRecords').aggregate([
          ...summaryPipeline,
          { $project: { entries: { $objectToArray: '$cardCounts' } } },
          { $unwind: '$entries' },
          { $group: {
            _id: '$entries.k',
            totalCount: { $sum: '$entries.v' },
            deckCount: { $sum: 1 },
          }},
          { $sort: { totalCount: -1 } },
          { $limit: 50 },
          { $project: { _id: 0, cardId: '$_id', totalCount: 1, deckCount: 1 } },
        ]).toArray();

        const summary = counts || { matches: 0, wins: 0, losses: 0, draws: 0 };
        delete summary._id;
        const decisive = (summary.wins || 0) + (summary.losses || 0);
        summary.winRate = decisive > 0 ? summary.wins / decisive : null;

        res.json({
          email, summary,
          recentMatches: playerMatches,
          topCards,
        });
      } catch (e) {
        console.warn('[stats player detail] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.3 卡牌勝率 — 該卡在勝方牌組出現次數 / 在所有牌組出現次數
    //   ?mode=online (default 全部，但建議用 online)
    //   ?minDecks=10 (default — 至少 N 副才算統計顯著)
    //   ?excludeAI=true (default true — AI 對戰會污染勝率)
    app.get('/api/admin/stats/cards/winrate', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      // v0.91：改用中央 buildCasualCleanFilter（含「離開場 finalTurn>=3 仍納入」的新規則）
      const baseMatch = { winner: { $in: [0, 1] } };  // 只算分出勝負的場（排除平局）
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      // 預設排除 AI 對戰（AI 勝率不應算入統計）
      const excludeAI = req.query.excludeAI !== 'false';
      // v0.98: 玩家規則 — 「只要有 roomCode 就不是 AI」.
      //   vsAI field 不可靠 (client 寫入可能誤判), 改用 roomCode 存在判定.
      //   excludeAI=true 等同 「只算有房號的對戰」(本機 vs 玩家也排除, 因為 client 端不太可靠分辨).
      if (excludeAI) baseMatch.roomCode = { $type: 'string' };
      // v0.26：時間範圍篩選（避免新卡包後仍看舊統計）— ?since=<ms epoch> → endedAt >= since
      if (req.query.since) baseMatch.endedAt = { $gte: parseInt(req.query.since) };
      // v0.27：排除「玩家中途離開」獲勝的場 — winReason 形如「<玩家名> 中途離開」
      //   （臨時有事/斷線等非實力因素，會污染真實卡牌勝率）。
      //   $not + regex：同時保留 winReason 不存在的舊場（不影響歷史資料）。
      // v0.91：離開場改由中央 helper 判定（finalTurn<=2 排除、>=3 納入），不再整類排除
      Object.assign(baseMatch, { $or: buildCasualCleanFilter({}).$or });
      const minDecks = Math.max(1, parseInt(req.query.minDecks) || 5);
      try {
        const pipeline = [
          { $match: baseMatch },
          // 同時展開 p1 + p2 兩副牌，標記是否為勝方
          { $project: {
            decks: [
              { cardCounts: '$p1.cardCounts', isWinner: { $eq: ['$winner', 0] } },
              { cardCounts: '$p2.cardCounts', isWinner: { $eq: ['$winner', 1] } },
            ],
          }},
          { $unwind: '$decks' },
          { $project: {
            entries: { $objectToArray: '$decks.cardCounts' },
            isWinner: '$decks.isWinner',
          }},
          { $unwind: '$entries' },
          { $group: {
            _id: '$entries.k',
            totalDecks: { $sum: 1 },
            winDecks: { $sum: { $cond: ['$isWinner', 1, 0] } },
          }},
          // v0.93: 拿掉 minDecks server-side filter — admin 合併 canonical (老大的指令多版本)
          //   後再 filter, 否則同名多版本各自被 filter 留下太少, 數字小不合理.
          //   limit 也從 1000 提升到 10000.
          { $project: {
            _id: 0,
            cardId: '$_id',
            totalDecks: 1,
            winDecks: 1,
            winRate: { $cond: [{ $gt: ['$totalDecks', 0] }, { $divide: ['$winDecks', '$totalDecks'] }, 0] },
          }},
          { $sort: { totalDecks: -1 } },
          { $limit: 10000 },
        ];
        const cards = await db.collection('matchRecords').aggregate(pipeline).toArray();
        // v0.97: 完整 diagnostic — 顯示資料源 breakdown
        //   (Wilson v0.94 diag 看到 totalMatchRecords=8 才發現是排除 AI 後樣本太少,
        //    不是統計 bug. 本版加 absolute db 數字 + 各 filter 後數字, 一眼看清)
        let diagnostics = {};
        try {
          const [diag] = await db.collection('matchRecords').aggregate([
            { $facet: {
              allDb: [{ $count: 'n' }],
              afterFilter: [{ $match: baseMatch }, { $count: 'n' }],
              vsAITotal: [{ $match: { vsAI: true } }, { $count: 'n' }],
              nonAITotal: [{ $match: { vsAI: { $ne: true } } }, { $count: 'n' }],
              onlineTotal: [{ $match: { roomCode: { $type: 'string' } } }, { $count: 'n' }],
              localTotal: [{ $match: { roomCode: null } }, { $count: 'n' }],
              withCardCountsFilter: [
                { $match: baseMatch },
                { $match: { $or: [
                  { 'p1.cardCounts': { $exists: true, $not: { $size: 0 } } },
                  { 'p2.cardCounts': { $exists: true, $not: { $size: 0 } } },
                ] } },
                { $count: 'n' },
              ],
              sampleP1: [
                { $match: { 'p1.cardCounts': { $exists: true } } },
                { $limit: 1 },
                { $project: { _id: 0, sampleSize: { $size: { $objectToArray: { $ifNull: ['$p1.cardCounts', {}] } } } } },
              ],
            }},
          ]).toArray();
          diagnostics = {
            // 資料源 absolute
            dbTotalAllTime: diag.allDb?.[0]?.n || 0,
            dbVsAI: diag.vsAITotal?.[0]?.n || 0,
            dbNonAI: diag.nonAITotal?.[0]?.n || 0,
            dbOnline: diag.onlineTotal?.[0]?.n || 0,
            dbLocal: diag.localTotal?.[0]?.n || 0,
            // 當前 filter 後
            afterFilterCount: diag.afterFilter?.[0]?.n || 0,
            withCardCountsCount: diag.withCardCountsFilter?.[0]?.n || 0,
            // 樣本
            sampleP1CardCountSize: diag.sampleP1?.[0]?.sampleSize || 0,
            topCardTotalDecks: cards[0]?.totalDecks || 0,
            cardsReturnedCount: cards.length,
            // 當前查詢
            currentMode: req.query.mode || 'all',
            currentExcludeAI: excludeAI,
            currentMinDecks: minDecks,
          };
        } catch (de) { diagnostics = { error: de.message }; }
        res.json({ cards, minDecks, mode: req.query.mode || 'all', excludeAI, generatedAt: Date.now(), diagnostics });
      } catch (e) {
        console.warn('[stats winrate] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // v0.23：2.3 卡牌→代表牌組聚合。給定一組 cardId（同 canonical 的多版本），
    //   找出「含其中任一張」的所有牌組（p1/p2 cardCounts 任一），聚合每張卡的
    //   出現牌組數 (deckCount) 與張數分佈 (countDist)，admin 端再依 canonical 合併、
    //   取眾數張數、貪婪湊成代表性 60 張牌組。mode 與 excludeAI 鏡射 winrate（玩家從
    //   winrate 表點進來，scope 一致＝只算有房號的對戰）。
    app.get('/api/admin/stats/cards/archetype', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const idSet = String(req.query.ids || '')
        .split(',').map(x => x.trim()).filter(Boolean).slice(0, 50);
      if (idSet.length === 0) return res.status(400).json({ error: 'ids 必填（逗號分隔 cardId）' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      const excludeAI = req.query.excludeAI !== 'false';
      if (excludeAI) baseMatch.roomCode = { $type: 'string' };  // 同 winrate：只算有房號
      // v0.24：只從獲勝牌組篩選 — 排除平局 + unwind 後只留「勝方」那一副牌
      const winnerOnly = req.query.winnerOnly === 'true';
      if (winnerOnly) baseMatch.winner = { $in: [0, 1] };
      // v0.26：時間範圍篩選 — ?since=<ms epoch> → endedAt >= since（與 winrate 同）
      if (req.query.since) baseMatch.endedAt = { $gte: parseInt(req.query.since) };
      try {
        const pipeline = [
          { $match: baseMatch },
          // 展開 p1 + p2 兩副牌，標記是否為勝方
          { $project: { decks: [
            { cc: '$p1.cardCounts', win: { $eq: ['$winner', 0] } },
            { cc: '$p2.cardCounts', win: { $eq: ['$winner', 1] } },
          ] } },
          { $unwind: '$decks' },
        ];
        // winnerOnly：unwind 後只留勝方那副
        if (winnerOnly) pipeline.push({ $match: { 'decks.win': true } });
        pipeline.push(
          { $project: { entries: { $objectToArray: { $ifNull: ['$decks.cc', {}] } } } },
          // 只保留「含目標卡（任一 variant id）」的牌組
          { $match: { 'entries.k': { $in: idSet } } },
          { $facet: {
            // 符合的牌組總數（樣本數）
            totalDecks: [ { $count: 'n' } ],
            // 每張卡 → deckCount + 張數分佈
            cards: [
              { $unwind: '$entries' },
              { $group: { _id: { card: '$entries.k', cnt: '$entries.v' }, n: { $sum: 1 } } },
              { $group: {
                _id: '$_id.card',
                deckCount: { $sum: '$n' },
                countDist: { $push: { cnt: '$_id.cnt', n: '$n' } },
              }},
              { $sort: { deckCount: -1 } },
              { $limit: 3000 },
            ],
          }},
        );
        const [agg] = await db.collection('matchRecords').aggregate(pipeline).toArray();
        const totalDecks = agg && agg.totalDecks && agg.totalDecks[0] ? agg.totalDecks[0].n : 0;
        const cards = ((agg && agg.cards) || []).map(c => ({
          cardId: c._id, deckCount: c.deckCount, countDist: c.countDist,
        }));
        res.json({ totalDecks, cards, ids: idSet, mode: req.query.mode || 'all', excludeAI, winnerOnly, generatedAt: Date.now() });
      } catch (e) {
        console.warn('[stats archetype] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.4 時段熱力圖 — 24 小時 × 7 星期幾 對戰量分佈
    //   使用 Asia/Taipei 時區（玩家活動時間貼合台灣）
    //   ?mode=online|local
    // v0.94: 玩家儲存的牌組 list (從 Firestore users/{uid}/decks)
    app.get('/api/admin/users/by-email/:email/decks', requireFirebaseAdmin, requireFb, async (req, res) => {
      try {
        const email = req.params.email;
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'email 必填' });
        const user = await adminAuth.getUserByEmail(email).catch(() => null);
        if (!user) return res.status(404).json({ error: 'Firebase Auth 找不到此 email' });
        const snap = await adminDb.collection('users').doc(user.uid).collection('decks').get();
        const decks = snap.docs.map(d => {
          const data = d.data() || {};
          return {
            id: data.id || d.id,
            name: data.name || '(未命名)',
            entries: data.entries || [],
            updatedAt: data.updatedAt || null,
          };
        });
        res.json({ uid: user.uid, decks });
      } catch (e) {
        console.warn('[users/decks] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // ══ v0.87 玩家總覽（admin 批次1）══════════════════════════════════════════
    //   GET /api/admin/player-profile?email=xxx
    //   目的：admin 任何頁面點玩家 email → 一頁看完他的所有資料。
    //   為什麼用 email 當主鍵：它是**唯一**能同時 join 休閒對戰(matchRecords 只存 email 不存 uid)、
    //     錦標賽(TREGS/TARCHIVE 有 email)、Firebase 帳號 三邊的欄位。回饋(feedbacks)只有 uid，
    //     故先用 email 換 uid 再查。⚠本機對戰的 P2／匿名玩家沒有 email，天生無法建檔（已知限制）。
    //   效能：四路平行 Promise、零迴圈查詢；TARCHIVE 排除 players.deckEntries（每筆 60 張，讀放大主因）；
    //     per-email 30s 記憶體快取（比照 leaderboard 60s／userInfo 5min 既有先例），上限 200 筆防長大。
    const _profileCache = new Map();
    app.get('/api/admin/player-profile', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const email = String((req.query && req.query.email) || '').trim();
      if (!email || !email.includes('@')) return res.status(400).json({ error: 'email 必填' });
      const now = Date.now();
      const cached = _profileCache.get(email);
      if (cached && now - cached.at < 30000) return res.json({ ...cached.data, cached: true });
      try {
        const MR = db.collection('matchRecords');
        const ARCH = db.collection('tournamentArchives');
        const REGS = db.collection('tournamentRegistrations');
        const orMe = { $or: [{ 'p1.email': email }, { 'p2.email': email }] };

        // ① Firebase 帳號（可能不存在：純本機玩家用過 email 但沒註冊）
        const pAuth = (typeof adminAuth !== 'undefined' && adminAuth)
          ? adminAuth.getUserByEmail(email).catch(() => null) : Promise.resolve(null);

        // ② 休閒對戰戰績（沿用 stats/players/:email 的判勝邏輯，含 AI 場，另回 online-only 一份）
        const pCasual = MR.aggregate([
          { $match: orMe },
          { $project: {
            isP1: { $eq: ['$p1.email', email] }, winner: 1, vsAI: 1, roomCode: 1, endedAt: 1,
            // v0.90：順便收集這位玩家在對戰中用過的顯示名（$addToSet 天然去重，不必另開查詢）
            myName: { $cond: [{ $eq: ['$p1.email', email] }, '$p1.name', '$p2.name'] },
          }},
          { $project: {
            online: { $ne: ['$roomCode', null] },
            isWin: { $or: [ { $and: ['$isP1', { $eq: ['$winner', 0] }] }, { $and: [{ $not: '$isP1' }, { $eq: ['$winner', 1] }] } ] },
            isLoss: { $or: [ { $and: ['$isP1', { $eq: ['$winner', 1] }] }, { $and: [{ $not: '$isP1' }, { $eq: ['$winner', 0] }] } ] },
            isDraw: { $eq: ['$winner', null] },
            endedAt: 1, myName: 1,
          }},
          { $group: {
            _id: null,
            matches: { $sum: 1 },
            wins: { $sum: { $cond: ['$isWin', 1, 0] } },
            losses: { $sum: { $cond: ['$isLoss', 1, 0] } },
            draws: { $sum: { $cond: ['$isDraw', 1, 0] } },
            onlineMatches: { $sum: { $cond: ['$online', 1, 0] } },
            onlineWins: { $sum: { $cond: [{ $and: ['$online', '$isWin'] }, 1, 0] } },
            onlineLosses: { $sum: { $cond: [{ $and: ['$online', '$isLoss'] }, 1, 0] } },
            firstAt: { $min: '$endedAt' },
            lastAt: { $max: '$endedAt' },
            names: { $addToSet: '$myName' },
          }},
        ]).toArray();

        // ③ 錦標賽：已歸檔賽事逐場戰績（projection 排除 deckEntries 大欄位）
        const pArch = ARCH.find(
          { 'players.email': email },
          { projection: { eventName: 1, finishedAt: 1, startedAt: 1, format: 1, playerCount: 1,
                          championUid: 1, championName: 1, communityEvent: 1,
                          'players.uid': 1, 'players.email': 1, 'players.name': 1, 'players.deckName': 1,
                          matches: 1 } },
        ).sort({ finishedAt: -1 }).limit(200).toArray();

        // ④ 報名紀錄（含未結束賽事；只取輕量欄位）
        const pRegs = REGS.find({ email }, { projection: { eventId: 1, name: 1, deckName: 1, checkedIn: 1, registeredAt: 1 } })
          .sort({ registeredAt: -1 }).limit(50).toArray();

        const [authUser, casualArr, archives, regs] = await Promise.all([pAuth, pCasual, pArch, pRegs]);

        // ⑤ 回饋與儲存牌組數（要 uid，故須等 authUser）
        let feedbacks = [], feedbackCount = 0, savedDeckCount = null, uid = authUser ? authUser.uid : null;
        if (uid && typeof adminDb !== 'undefined' && adminDb) {
          const [fbSnap, deckSnap] = await Promise.all([
            adminDb.collection('feedbacks').where('uid', '==', uid).get().catch(() => null),
            adminDb.collection('users').doc(uid).collection('decks').get().catch(() => null),
          ]);
          if (fbSnap) {
            const all = fbSnap.docs.map((d) => {
              const x = d.data() || {};
              return { id: d.id, content: String(x.content || '').slice(0, 400),
                       createdAt: tsToMillis(x.createdAt), reply: x.reply ? String(x.reply).slice(0, 400) : null,
                       repliedAt: tsToMillis(x.repliedAt) };
            }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            feedbackCount = all.length;
            feedbacks = all.slice(0, 5);
          }
          if (deckSnap) savedDeckCount = deckSnap.size;
        }

        const c = casualArr[0] || { matches: 0, wins: 0, losses: 0, draws: 0, onlineMatches: 0, onlineWins: 0, onlineLosses: 0, firstAt: null, lastAt: null };
        delete c._id;
        const dec = (c.wins || 0) + (c.losses || 0);
        c.winRate = dec > 0 ? c.wins / dec : null;
        const odec = (c.onlineWins || 0) + (c.onlineLosses || 0);
        c.onlineWinRate = odec > 0 ? c.onlineWins / odec : null;

        // 錦標賽逐賽事戰績：用該玩家的 uid（歸檔內 players 有 uid）比對 matches 的 winnerUid
        const tourn = { events: 0, wins: 0, losses: 0, championships: 0, list: [] };
        for (const a of archives) {
          const me = (a.players || []).find((p) => p && p.email === email);
          if (!me) continue;
          let w = 0, l = 0;
          for (const m of (a.matches || [])) {
            if (!m || m.bye) continue;
            const inIt = m.p1uid === me.uid || m.p2uid === me.uid;
            if (!inIt || !m.winnerUid) continue;
            if (m.winnerUid === me.uid) w++; else l++;
          }
          const champ = a.championUid && me.uid && a.championUid === me.uid;
          tourn.events++; tourn.wins += w; tourn.losses += l; if (champ) tourn.championships++;
          tourn.list.push({ eventId: String(a._id || '').replace(/^arch_/, ''), eventName: a.eventName || '',
                            // v6.244：startedAt＝開賽時間（admin 列表的「日期」欄用這個）；
                            //   finishedAt＝冠軍產生時間，欄位保留不動。
                            startedAt: a.startedAt || a.createdAt || null,
                            finishedAt: a.finishedAt || a.startedAt || null, format: a.format || null,
                            playerCount: a.playerCount || null, communityEvent: !!a.communityEvent,
                            deckName: me.deckName || '', regName: me.name || '', wins: w, losses: l, champion: !!champ });
        }
        const tdec = tourn.wins + tourn.losses;
        tourn.winRate = tdec > 0 ? tourn.wins / tdec : null;

        // ── v0.90 曾使用過的暱稱（去重）──────────────────────────────────────
        //   同一位玩家在不同情境會用不同名字：休閒對戰的顯示名、每場賽事的報名暱稱、
        //   Firebase 帳號顯示名。這裡全部彙整、去重，並標明來源與最後使用時間，
        //   方便從舊 log／舊截圖裡的名字反查是同一個人。
        const nickMap = new Map();
        const addNick = (raw, src, at) => {
          const n = String(raw || '').trim();
          if (!n) return;
          const cur = nickMap.get(n) || { name: n, sources: [], lastAt: null };
          if (!cur.sources.includes(src)) cur.sources.push(src);
          if (at && (!cur.lastAt || at > cur.lastAt)) cur.lastAt = at;
          nickMap.set(n, cur);
        };
        for (const n of (c.names || [])) addNick(n, '對戰', c.lastAt || null);
        for (const r of regs) addNick(r.name, '報名', r.registeredAt || null);
        for (const e of tourn.list) addNick(e.regName, '賽事', e.finishedAt || null);
        if (authUser && authUser.displayName) addNick(authUser.displayName, '帳號', null);
        const nicknames = [...nickMap.values()].sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
        delete c.names;   // 明細已彙整進 nicknames，不重複傳

        const data = {
          email, uid, nicknames,
          account: authUser ? {
            uid: authUser.uid, displayName: authUser.displayName || null,
            emailVerified: !!authUser.emailVerified, disabled: !!authUser.disabled,
            createdAt: authUser.metadata ? Date.parse(authUser.metadata.creationTime) || null : null,
            lastSignInAt: authUser.metadata ? Date.parse(authUser.metadata.lastSignInTime) || null : null,
          } : null,
          casual: c,
          tournament: tourn,
          regs,
          feedbackCount, feedbacks,
          savedDeckCount,
        };
        _profileCache.set(email, { at: now, data });
        if (_profileCache.size > 200) { const k = _profileCache.keys().next().value; _profileCache.delete(k); }
        res.json(data);
      } catch (e) {
        console.warn('[player-profile] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // ══ v0.88 牌組原型規則引擎（admin 批次2）══════════════════════════════════
    //   Wilson 需求：自訂「必須含哪些卡 AND 不能含哪些卡」來識別牌組原型，
    //   例：祭典熱舞 = 含【果蜜蟲】【角金魚】且不含【蜜集大蛇ex】。
    //   ⭐用**卡名**比對（Wilson 拍板）：同一張卡的印刷版本極多（一個補充包就可能 30+ 張同名 clone），
    //     用 cardId 每條規則都要枚舉所有版本、且**每次出新印刷規則就會靜默漏掉**。
    //     真的需要區分同名不同效果的卡時，才用選填的 includeIds/excludeIds 鎖特定 cardId。
    //   資料來源：休閒對戰 matchRecords.p{1,2}.cardCounts（cardId→張數，每場雙方各 60 張全紀錄）
    //     與錦標賽 tournamentArchives.players[].deckEntries（批次3 使用）。
    const TRULES = db.collection('deckRules');
    // v6.119：deckRules 幾乎不變，但這裡以前每次 cache-miss 都重查一次 mongo。
    //   ⚠ miss 比想像多：setup 階段的房間永遠不會進 _roomArchCache（見下方 phase gate），
    //   所以大廳只要有一間房在開局，每輪輪詢都會觸發一次 TRULES 查詢。
    //   加 30 秒 TTL；規則 CRUD 時主動失效（比原本「本端點結果已被 per-room 快取 5 分鐘」更即時）。
    let _rulesCache = { at: 0, rules: null };
    function invalidateRulesCache() { _rulesCache = { at: 0, rules: null }; }
    async function getEnabledRulesCached() {
      const now = Date.now();
      if (_rulesCache.rules && now - _rulesCache.at < 30000) return _rulesCache.rules;
      const rules = await TRULES.find({ enabled: { $ne: false } }).sort({ priority: 1 }).toArray();
      _rulesCache = { at: now, rules };
      return rules;
    }


    /** 把一副牌的 cardCounts / deckEntries 正規化成 {names:Set, ids:Set}。 */
    function deckToSets(cardCounts, nameMap) {
      const ids = new Set(), names = new Set();
      if (!cardCounts) return { ids, names };
      const keys = Array.isArray(cardCounts)
        ? cardCounts.map((e) => e && e.cardId)          // deckEntries 形式 [{cardId,count}]
        : Object.keys(cardCounts);                       // cardCounts 形式 {cardId: 張數}
      for (const k of keys) {
        if (k == null) continue;
        const id = String(k);
        ids.add(id);
        const nm = nameMap.get(id);
        if (nm) names.add(nm);
      }
      return { ids, names };
    }

    /** 單條規則比對。includes/excludes 用卡名；includeIds/excludeIds 用 cardId（選填，鎖特定印刷版本）。 */
    function deckMatchesRule(sets, rule) {
      for (const n of (rule.includes || [])) if (!sets.names.has(n)) return false;
      for (const n of (rule.excludes || [])) if (sets.names.has(n)) return false;
      for (const i of (rule.includeIds || [])) if (!sets.ids.has(String(i))) return false;
      for (const i of (rule.excludeIds || [])) if (sets.ids.has(String(i))) return false;
      return true;
    }
    /** 休閒對戰某一側的勝負：winner 為 0(=p1 勝) / 1(=p2 勝) / null(平局)。 */
    function casualSideResult(winner, isP1) {
      if (winner === null || winner === undefined) return 'draw';
      if (winner !== 0 && winner !== 1) return 'draw';
      return ((isP1 && winner === 0) || (!isP1 && winner === 1)) ? 'win' : 'loss';
    }
    /** 錦標賽某一側的勝負：以 winnerUid 是否等於該側 uid 判定（字串比對，防型別不一致）。 */
    function tournSideResult(winnerUid, uid) {
      return String(winnerUid) === String(uid) ? 'win' : 'loss';
    }
    /**
     * 規則的「嚴格度」＝條件總數。條件越多代表描述越特定，
     * 例如「含A且含B」比「只含A」更能精確描述一副牌，命中兩者時應歸給前者。
     */
    function ruleStrictness(r) {
      return (r.includes || []).length + (r.excludes || []).length
           + (r.includeIds || []).length + (r.excludeIds || []).length;
    }
    /**
     * 多規則同時命中時決定主原型；回 {rule, all[]}。零命中回 {rule:null}。
     * v0.93 排序改三段（Wilson 拍板）：
     *   ① 嚴格度高者優先 —— 自動判定「大原型 vs 子變體」，使用者不必手填優先序
     *   ② 嚴格度相同 → priority 小者優先（欄位保留為 tie-break，UI 已隱藏）
     *   ③ 仍相同 → _id 字典序（穩定排序，避免同分時順序隨資料庫回傳順序飄動）
     * ⚠本函式同時被「原型統計總表」與「原型明細」使用，改動會同時影響兩邊（刻意如此，
     *   兩者若不同版，同一副牌會在總表與明細被分到不同原型）。
     */
    function classifyDeck(sets, rules) {
      const all = [];
      for (const r of rules) if (deckMatchesRule(sets, r)) all.push(r);
      if (!all.length) return { rule: null, all: [] };
      all.sort((a, b) =>
        ruleStrictness(b) - ruleStrictness(a)
        || (a.priority || 0) - (b.priority || 0)
        || String(a._id).localeCompare(String(b._id)));
      return { rule: all[0], all };
    }
    // 供批次3 統計端點重用（同一份比對邏輯，避免兩處漂移）
    app.locals = app.locals || {};
    app.locals._deckRuleHelpers = { getCardNameMap, deckToSets, deckMatchesRule, classifyDeck, ruleStrictness, casualSideResult, tournSideResult };

    function sanitizeRule(b) {
      const arr = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n,，]/))
        .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 30);
      const name = String((b && b.name) || '').trim().slice(0, 40);
      if (!name) return { error: '請填規則名稱' };
      const includes = arr(b.includes), excludes = arr(b.excludes);
      const includeIds = arr(b.includeIds), excludeIds = arr(b.excludeIds);
      if (!includes.length && !includeIds.length) return { error: '至少要有一張「必須包含」的卡，否則會match到所有牌組' };
      return {
        doc: {
          name, includes, excludes, includeIds, excludeIds,
          priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 100,
          enabled: b.enabled !== false,
          note: String((b && b.note) || '').slice(0, 200),
        },
      };
    }

    app.get('/api/admin/deck-rules', requireFirebaseAdmin, async (req, res) => {
      try {
        const rules = await TRULES.find({}).sort({ priority: 1, name: 1 }).toArray();
        res.json({ rules });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/admin/deck-rules', requireFirebaseAdmin, async (req, res) => {
      try {
        const s = sanitizeRule(req.body || {});
        if (s.error) return res.status(400).json({ error: s.error });
        const id = String((req.body && req.body.id) || '').trim()
          || ('rule_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7));
        const doc = { ...s.doc, updatedAt: Date.now(), updatedBy: ((req.adminUser && req.adminUser.email) || null) };
        await TRULES.updateOne({ _id: id }, { $set: doc }, { upsert: true });
        invalidateRulesCache();   // v6.119：規則一改就讓 rooms-archetypes 的 30s 快取立刻失效
        res.json({ ok: true, id, rule: { _id: id, ...doc } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/admin/deck-rules', requireFirebaseAdmin, async (req, res) => {
      try {
        const id = String((req.query && req.query.id) || '');
        if (!id) return res.status(400).json({ error: '需要 id' });
        await TRULES.deleteOne({ _id: id });
        invalidateRulesCache();   // v6.119：規則一改就讓 rooms-archetypes 的 30s 快取立刻失效
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 命中預覽：存檔前先對最近 N 場（雙方各一副）試算，讓打錯卡名當場就看得出來（全滅＝0 命中）。
    app.post('/api/admin/deck-rules/preview', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      try {
        const s = sanitizeRule(req.body || {});
        if (s.error) return res.status(400).json({ error: s.error });
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 20), 1000);
        const nameMap = await getCardNameMap();
        if (!nameMap.size) return res.status(503).json({ error: '伺服器卡名對照尚未載入，稍後再試' });
        // 卡名有效性檢查：規則裡打錯／不存在的卡名，直接指出來（最常見的 0 命中原因）
        const known = new Set(nameMap.values());
        const unknown = [...s.doc.includes, ...s.doc.excludes].filter((n) => !known.has(n));
        const recent = await db.collection('matchRecords')
          .find({}, { projection: { 'p1.cardCounts': 1, 'p1.name': 1, 'p1.email': 1, 'p2.cardCounts': 1, 'p2.name': 1, 'p2.email': 1, endedAt: 1, roomCode: 1 } })
          .sort({ endedAt: -1 }).limit(limit).toArray();
        let decks = 0, hits = 0;
        const samples = [];
        for (const m of recent) {
          for (const side of ['p1', 'p2']) {
            const p = m[side];
            if (!p || !p.cardCounts || !Object.keys(p.cardCounts).length) continue;
            decks++;
            if (deckMatchesRule(deckToSets(p.cardCounts, nameMap), s.doc)) {
              hits++;
              if (samples.length < 8) samples.push({ name: p.name || '', email: p.email || null, endedAt: m.endedAt || null, roomCode: m.roomCode || null });
            }
          }
        }
        res.json({ ok: true, scannedMatches: recent.length, scannedDecks: decks, hits, samples, unknownCardNames: unknown });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ══ v0.92 牌組原型「明細」：代表 60 張 / 勝場版 / 遺珠之憾 ═══════════════
    //   Wilson 需求：點選某個原型後，看到「依我的規則分類出來、最多人用的 60 張」，
    //   可切換成只看獲勝場次，並推薦沒進 60 張但值得搭配的 15 張，且能一鍵複製牌表。
    //
    //   ⭐為什麼不沿用既有的「2.3 卡牌勝率」來做推薦（Fable 5 稽核結論）：
    //     那張表的分母是全站的 deck-場次，沒有按牌組原型分層 → 一張卡的勝率同時被
    //     「它所屬原型的強度」與「使用它的玩家實力」支配，量不到卡本身的邊際貢獻；
    //     且雙方都帶同一張卡時同時 +1 勝 +1 負，熱門通用卡會被機械性拉向 50%。
    //     正確的統計量是**同一原型內的條件勝率差**（把原型當分層變數，控制掉最大的混雜）：
    //         Δ = P(勝 | 本原型 且 含卡c) − P(勝 | 本原型 且 不含卡c)
    //     再對前項取 Wilson score 的 90% 單尾下界，讓小樣本自動被壓低，
    //     不必另設「勝率差要多大才算數」這種武斷門檻。
    const _archDetailCache = new Map();

    /** Wilson score 區間下界（單尾）。n=0 回 0。用於壓抑小樣本的高勝率假象。 */
    function wilsonLower(w, n, z) {
      if (!n) return 0;
      const p = w / n, z2 = z * z;
      const denom = 1 + z2 / n;
      const centre = p + z2 / (2 * n);
      const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
      return Math.max(0, (centre - margin) / denom);
    }

    /** 卡名正規化：去掉括號註解，讓「老大的指令（烏羽）」等同名不同插畫合併成同一張。 */
    function normCardName(n) {
      return String(n || '').replace(/[（(][^）)]*[）)]/g, '').trim() || String(n || '');
    }

    app.get('/api/admin/deck-archetype-detail', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const ruleId = String((req.query && req.query.ruleId) || '');
      if (!ruleId) return res.status(400).json({ error: '需要 ruleId' });
      const source = String(req.query.source) === 'tourn' ? 'tourn' : 'casual';
      const since = req.query.since ? parseInt(req.query.since) : 0;
      const excludeAI = req.query.excludeAI !== 'false';
      const ck = ruleId + '|' + source + '|' + since + '|' + excludeAI;
      const now = Date.now();
      const hit = _archDetailCache.get(ck);
      if (hit && now - hit.at < 60000) return res.json({ ...hit.data, cached: true });
      try {
        const nameMap = await getCardNameMap();
        if (!nameMap.size) return res.status(503).json({ error: '伺服器卡名對照尚未載入，稍後再試' });
        const rules = await TRULES.find({ enabled: { $ne: false } }).sort({ priority: 1 }).toArray();
        const target = rules.find((r) => String(r._id) === ruleId);
        if (!target) return res.status(404).json({ error: '找不到這條規則（可能已刪除）' });

        // 規則的必含卡（恆 100% 出現，不可能有「不含」對照組）→ 遺珠候選要排除
        const mustHave = new Set((target.includes || []).map(normCardName));

        // per-卡名 累積器
        const C = new Map();   // 卡名 → { repId, repCount, nWith, wWith, dist:Map(張數→n), distWin:Map }
        const bump = (name, cardId, copies, isWin, countWin) => {
          let e = C.get(name);
          if (!e) { e = { name, ids: new Map(), nWith: 0, wWith: 0, dist: new Map(), distWin: new Map() }; C.set(name, e); }
          e.ids.set(String(cardId), (e.ids.get(String(cardId)) || 0) + 1);
          e.nWith++; if (isWin) e.wWith++;
          e.dist.set(copies, (e.dist.get(copies) || 0) + 1);
          if (countWin) e.distWin.set(copies, (e.distWin.get(copies) || 0) + 1);
        };
        let decks = 0, wins = 0, losses = 0, draws = 0, winDecks = 0;
        // v6.241：掃了幾筆來源資料（錦標賽＝歸檔場數／休閒＝對戰場數）。
        //   統計端點一旦有上限就會靜默失真，把「實際掃了幾筆」回出去才看得見。
        let scannedSrc = 0;

        /** 把一副牌（cardCounts 物件 或 deckEntries 陣列）累積進統計。 */
        function absorb(cardsRef, result) {
          const sets = deckToSets(cardsRef, nameMap);
          const cls = classifyDeck(sets, rules);            // ⚠只算一次（分類是本端點最重的運算）
          if (!cls.rule || String(cls.rule._id) !== ruleId) return;
          decks++;
          const isWin = result === 'win';
          if (isWin) { wins++; winDecks++; } else if (result === 'loss') losses++; else draws++;
          // 同一卡名可能有多個印刷版本 → 先併成「卡名 → 總張數」
          const byName = new Map();
          const entries = Array.isArray(cardsRef)
            ? cardsRef.map((x) => [x && x.cardId, x && x.count])
            : Object.keys(cardsRef).map((k) => [k, cardsRef[k]]);
          for (const [cid, cnt] of entries) {
            if (cid == null) continue;
            const nm = normCardName(nameMap.get(String(cid)) || '');
            if (!nm) continue;
            const cur = byName.get(nm) || { copies: 0, id: String(cid) };
            cur.copies += Number(cnt) || 0;
            byName.set(nm, cur);
          }
          for (const [nm, v] of byName) bump(nm, v.id, v.copies, isWin, isWin);
        }

        if (source === 'casual') {
          const q = buildCasualCleanFilter({ excludeAI, since });
          // v6.242：**移除 limit(20000)** —— 與 v6.241 對錦標賽側的處理同一個理由：
          //   這支算的是「這個原型內每張卡的採用率／眾數張數／條件勝率差」＝**統計聚合**，
          //   限制筆數不是「少顯示幾列」，而是讓統計數字本身失真（只算最新 20000 場）。
          // ⚠ 改 cursor 逐筆（不 toArray）＋ 每 200 筆 adminScanYield 讓路，
          //   理由與實測數字見 adminScanYield 的註解（cursor 解決記憶體、讓路才解決時間）。
          // ⚠ 下面的聚合（雙方各一副 → absorb）**一字未動**，避免出現兩份口徑。
          const _cursor = db.collection('matchRecords')
            .find(q, { projection: { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })
            .sort({ endedAt: -1 });
          for await (const m of _cursor) {
            scannedSrc++;
            const _y = adminScanYield(scannedSrc); if (_y) await _y;
            for (const side of ['p1', 'p2']) {
              const cc = m[side] && m[side].cardCounts;
              if (!cc || !Object.keys(cc).length) continue;
              absorb(cc, casualSideResult(m.winner, side === 'p1'));
            }
          }
        } else {
          const q = {};
          if (since) q.finishedAt = { $gte: since };
          // v6.241：**移除 limit(200)**。這支算的是「這個原型內每張卡的採用率／眾數張數／
          //   條件勝率差（遺珠之憾）」＝**統計聚合**，不是列表顯示；限制筆數不是「少顯示幾列」，
          //   而是讓**統計數字本身失真**（只算最新 200 場歸檔）。回應大小只跟卡種數有關、
          //   與掃了幾場歸檔無關 ⇒ 拿掉上限不會讓回應變肥。
          // ⚠ 改用 cursor 逐筆吃（同 v6.240 champion-report 的手法），**不 toArray**：
          //   歸檔 doc 內含 players[].deckEntries（每場 N×60 張），整包讀進**玩家共用的**
          //   node 行程正是 v6.240 抓到的 1.1GB 事故（Rule 30：不可讓 admin 拖累玩家）。
          // ⚠ 刻意**不**搬去 mongo aggregate：分類走的是本檔 node 端的 deckToSets/classifyDeck，
          //   搬過去會變成「總表一份、明細一份」兩套口徑，同一副牌會被分到不同原型。
          const _cursor = db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 });
          for await (const a of _cursor) {
            scannedSrc++;
            const deckByUid = new Map();
            for (const p of (a.players || [])) if (p && p.uid) deckByUid.set(String(p.uid), p.deckEntries || []);
            for (const m of (a.matches || [])) {
              if (!m || m.bye || !m.winnerUid) continue;
              for (const uid of [m.p1uid, m.p2uid]) {
                if (!uid) continue;
                const entries = deckByUid.get(String(uid));
                if (!entries || !entries.length) continue;
                absorb(entries, tournSideResult(m.winnerUid, uid));
              }
            }
          }
        }

        if (!decks) {
          const empty = { ruleId, name: target.name, source, since, scannedSrc, sample: { decks: 0, wins: 0, losses: 0, draws: 0 },
                          cards: [], representative60: [], representative60Win: [], winSample: 0, hiddenGems: [] };
          _archDetailCache.set(ck, { at: now, data: empty });
          return res.json(empty);
        }

        // 眾數張數（只在「有放這張卡」的牌組內取）＋ 代表印刷版本 id
        const modeOf = (m) => {
          let best = 0, bestN = -1;
          for (const [cnt, n] of m) if (n > bestN || (n === bestN && cnt > best)) { best = cnt; bestN = n; }
          return best;
        };
        const cards = [...C.values()].map((e) => {
          let repId = null, repN = -1;
          for (const [id, n] of e.ids) if (n > repN) { repId = id; repN = n; }
          return {
            name: e.name, repCardId: repId,
            inclusion: e.nWith / decks,
            modalCount: modeOf(e.dist),
            modalCountWin: e.distWin.size ? modeOf(e.distWin) : null,
            nWith: e.nWith, wWith: e.wWith,
            nWithout: decks - e.nWith, wWithout: wins - e.wWith,
            isInclude: mustHave.has(e.name),
            _distWinN: [...e.distWin.values()].reduce((a, b) => a + b, 0),
          };
        }).sort((a, b) => b.inclusion - a.inclusion || b.nWith - a.nWith);

        // 貪婪湊 60（同名 4 張上限；ACE SPEC 整副 1 張；基本能量無上限）
        // ⚠TPOOL 定義在錦標賽段的另一個閉包，admin 段取不到（用了會 ReferenceError）→ 走本段自建的屬性表
        const attrMap = await getCardAttrMap();
        const isBasicEnergy = (id) => !!(id != null && attrMap.get(String(id))?.basicEnergy);
        const isAceSpec = (id) => !!(id != null && attrMap.get(String(id))?.aceSpec);
        function build60(list, useWinMode) {
          const picked = []; let total = 0, aceUsed = false;
          for (const c of list) {
            if (total >= 60) break;
            let copies = useWinMode ? (c.modalCountWin ?? c.modalCount) : c.modalCount;
            if (!copies) continue;
            if (isAceSpec(c.repCardId)) { if (aceUsed) continue; copies = 1; }
            else if (!isBasicEnergy(c.repCardId)) copies = Math.min(copies, 4);
            if (copies > 60 - total) copies = 60 - total;   // 尾端調整：砍張數優於漏整張卡
            picked.push({ name: c.name, repCardId: c.repCardId, copies, inclusion: c.inclusion });
            total += copies;
            if (isAceSpec(c.repCardId)) aceUsed = true;
          }
          // 湊不滿（4 張 cap 砍過後可能 <60）→ 用採用率最高的基本能量補（唯一無上限、永遠合法）
          if (total < 60) {
            const be = picked.find((p) => isBasicEnergy(p.repCardId)) || list.find((c) => isBasicEnergy(c.repCardId));
            if (be) {
              const inList = picked.find((p) => p.repCardId === be.repCardId);
              if (inList) inList.copies += (60 - total);
              else picked.push({ name: be.name, repCardId: be.repCardId, copies: 60 - total, inclusion: be.inclusion });
              total = 60;
            }
          }
          return { list: picked, total };
        }
        const rep = build60(cards, false);
        const repWin = build60(cards.filter((c) => c._distWinN > 0)
          .sort((a, b) => (b._distWinN / (winDecks || 1)) - (a._distWinN / (winDecks || 1)) || b.nWith - a.nWith), true);
        const in60 = new Set(rep.list.map((x) => x.name));

        // ── 遺珠之憾：同原型內條件勝率差（Wilson 下界 − 基線）──
        const gems = cards.filter((c) =>
            !in60.has(c.name) && !c.isInclude && !isBasicEnergy(c.repCardId)
            && c.inclusion >= 0.08 && c.inclusion <= 0.60
            && c.nWith >= 8 && c.nWithout >= 8)
          .map((c) => {
            const wrWith = c.nWith ? c.wWith / c.nWith : 0;
            const wrWithout = c.nWithout ? c.wWithout / c.nWithout : 0;
            return { name: c.name, repCardId: c.repCardId, modalCount: c.modalCount,
                     nWith: c.nWith, inclusion: c.inclusion, wrWith, wrWithout,
                     score: wilsonLower(c.wWith, c.nWith, 1.64) - wrWithout };
          })
          .filter((g) => g.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 15);

        const data = {
          ruleId, name: target.name, source, since, scannedSrc,
          sample: { decks, wins, losses, draws }, winSample: winDecks,
          cards: cards.map((c) => { const { _distWinN, ...rest } = c; return rest; }).slice(0, 120),
          representative60: rep.list, representative60Total: rep.total,
          representative60Win: repWin.list, representative60WinTotal: repWin.total,
          hiddenGems: gems,
        };
        _archDetailCache.set(ck, { at: now, data });
        if (_archDetailCache.size > 50) { const k = _archDetailCache.keys().next().value; _archDetailCache.delete(k); }
        res.json(data);
      } catch (e) {
        console.warn('[deck-archetype-detail] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // ══ v0.89 牌組原型統計（admin 批次3）══════════════════════════════════════
    //   單位＝「每場對戰的每一側牌組」＝1 筆使用（一場貢獻 2 筆），勝負記到各側。
    //   休閒與錦標賽**分開**統計（資料品質不同：休閒含 AI/本機，錦標賽是正式對局）。
    //   即時計算 + 60s 快取：規則一改就立刻反映，不需要重算批次、也不會有落地欄位失效問題。
    const _archStatsCache = new Map();
    // ══ v6.111 奪冠報告資料端點（給 admin 的「匯出奪冠報告圖」用）══════════════
    //   卡面上的定位：這支只回**分類結果**（每場的冠軍／四強 → 牌組原型），**不回 deckEntries**。
    //   賽事名稱／時間／人數／賽制／matches 前端已經有一份（/api/tournament/admin/stats
    //   的 tournStatsCache），再傳一次會很肥（每場 N×60 張卡）。前端用 eventId + uid 對照即可。
    //
    //   ⭐ 為什麼放在 registerDeckRules 這個 IIFE 內：分類要用 deckToSets/classifyDeck/TRULES/
    //     getCardNameMap，它們都在這個作用域。**不可以**為了「放在錦標賽區塊比較順」而把分類
    //     邏輯抄一份過去——classifyDeck 的註解已經寫明：總表與明細若不同版，同一副牌會被分到
    //     不同原型。名次推導反過來走 app.locals（同一個理由，方向相反）。
    //   ⚠ 作用域陷阱（v0.94/v1.01 兩次事故）：跨 IIFE 的東西一律在 **handler 執行時**才從
    //     app.locals 取，不要在註冊時就解構——那時另一個 IIFE 可能還沒跑完。
    // ── v6.115 大廳「對戰中的房間」牌組原型標籤 ────────────────────────────────
    // 玩家許願：在房間外就能看出裡面雙方在打什麼牌組，想學特定牌組的人比較好找對局觀戰。
    //
    // ⭐ 為什麼一定在後端算：分類規則存在 mongo 的 deckRules，讀取端點掛 requireFirebaseAdmin
    //    （admin 私有），前端拿不到；而且分類要吃整副 60 張牌表，那是隱藏資訊，不能送到大廳。
    //    本端點**只回原型名稱字串**，牌表一張都不出去（白名單建構，不是 delete 私有欄位）。
    //    放在 registerDeckRules 這個 IIFE 內是因為 deckToSets/classifyDeck/TRULES/getCardNameMap
    //    都在這個作用域 —— 不可以為了「放在房間區塊比較順」而把分類邏輯抄第二份
    //    （classifyDeck 的註解已寫明：兩份若不同版，同一副牌會被分到不同原型）。
    //
    // ⚠⚠ 兩條刻意的限制：
    //   ① 只處理 status === 'playing' 的房間。等待中的房間雙方已選牌組但還沒開打，
    //      先看到對方牌組再決定加不加入＝牌組狙擊（Wilson 裁定：只對戰中顯示）。
    //   ② 連 playing 房也要 gameState.phase === 'playing' 才回。開局放置階段對戰畫面本身是
    //      oppHidden（雙方互相看不到場面），若大廳先報出牌組，玩家另開一個分頁就能依對手
    //      牌組決定自己的開局策略。
    //
    // 回傳語義（前端靠這個分辨兩種「沒有」）：
    //   ・字串（含 '未分類'）＝ 有牌表且已比對完成
    //   ・null / 該 roomId 不在回應裡 ＝ 還不知道（未開打、規則庫沒載入、房間不存在）
    const _roomArchCache = new Map();   // roomId -> { at, p1, p2 }；一場對戰內牌組不會變
    // ── v6.229 中央分類出口：大廳標籤與 admin 房間列表共用同一份結果 ────────────
    //   回傳語義（兩個消費端都靠它分辨兩種「沒有」，前端不可把 null 當「未分類」）：
    //   ・字串（含 '未分類'）＝ 有牌表且已比對完成
    //   ・null ＝ 還不知道（沒牌表／卡名對照或規則庫沒載入）
    function archetypeNameOf(entries, nameMap, rules) {
      if (!entries || !entries.length) return null;         // 沒牌表 ＝ 不知道
      if (!nameMap.size || !rules.length) return null;      // 規則庫沒載入 ＝ 不知道
      const c = classifyDeck(deckToSets(entries, nameMap), rules);
      return c.rule ? (c.rule.name || '未分類') : '未分類'; // 有牌表就一定給得出答案
    }
    // ── v6.229 admin「🎮 Oracle 對戰」房間列表的原型 enrich ──────────────────
    //   /api/admin/oracle/rooms 定義在本 IIFE 之外 ⇒ 掛 app.locals、handler 執行時才取
    //   （v0.94 教訓：不可在註冊時解構）。admin 不套大廳的「只限 playing／phase」兩條
    //   防狙擊限制——admin 本來就有 🃏 牌組 modal 可看整副牌，等待中／已結束房也要能分類。
    //   效能：nameMap 全行程只載一次、rules 走 30s TTL（規則 CRUD 即失效），
    //   之後每副牌只是純記憶體 set 運算；整份列表一次 enrich，不做 per-seat await。
    app.locals = app.locals || {};
    app.locals._archetypeEnrichRooms = async (roomsArr) => {
      const nameMap = await getCardNameMap();
      const rules = nameMap.size ? await getEnabledRulesCached() : [];
      for (const r of (roomsArr || [])) {
        const seats = Array.isArray(r && r.seats) ? r.seats : [];
        for (const s of seats) {
          if (s) s.archetype = archetypeNameOf(s.deckEntries, nameMap, rules);
        }
      }
    };
    // ══ v1.28（v6.266）套牌戰績（P1，只有伺服器端）：GET /api/deck-stats?deckId= ══
    //   玩家許願：牌組列表的 ✕ 旁邊放一個 🔍，看這一副牌的休閒勝率／對各原型勝率。
    //   ⭐ 「勝敗紀錄跟著套牌走」天然成立：Deck.id 是 client 端 `crypto.randomUUID()`
    //     產的穩定 UUID（src/lib/decks/storage.ts:65-80），`upsertDeck` 依 id 就地更新
    //     （:47-56）⇒ 編輯不換 id；複製／匯入走 `newDeck()`＝新 UUID ⇒ 勝率天然不跟。
    //     **零遷移、零覆寫**，既有牌組本來就都有 id。
    //
    //   ⭐ 為什麼放在這個 IIFE 內（與 v6.229/v6.111 同一個理由）：對手原型分類要用
    //     deckToSets／classifyDeck／TRULES／getCardNameMap，它們都在這個作用域。
    //     **不可以**為了「放在 match-record 區塊比較順」而把分類邏輯抄第二份 ——
    //     classifyDeck 的註解已寫明：兩份若不同版，同一副牌會被分到不同原型。
    //
    //   ⚠⚠ 事件迴圈（站長最在意的紅線；pm2 是 **fork_mode 單 instance** ⇒ 這支端點與
    //     錦標賽跑在**同一個 node 行程**，任何連續阻塞都會直接變成錦標賽的 lag）。
    //     四道防線，缺一不可：
    //       ① 兩支 **sparse** 索引（見檔案上方的服務啟動段）⇒ IXSCAN 而不是 COLLSCAN。
    //       ② **啟動自驗：沒有索引就自我停用**（回 503）。無索引 ＝ 對 18.5 萬筆
    //          matchRecords 做 COLLSCAN，那是上百 MB 的連續阻塞，絕不可以上線。
    //       ③ cursor 逐筆（不 toArray）＋ 每 200 筆走中央 adminScanYield 讓路
    //          （v6.242：cursor 只解決記憶體、**讓路才解決時間**）。
    //       ④ 硬上限 DECK_STATS_SCAN_CAP 筆 ＋ per-deckId 60s 快取 ＋ per-IP 限流。
    //
    //   ⚠ 免登入（站長覆核中）：deckId 是 client 端產的 UUID、猜不到 ⇒ 它本身就是憑證；
    //     而且牌組存在玩家 localStorage，伺服器根本沒有「這副牌屬於誰」的對照，
    //     就算要求登入也判斷不出誰有權看。改以「不可猜 ＋ 限流」防刷。
    //   ⚠ 白名單建構：回應只有數字與**原型名稱字串**；對手的 email／暱稱／房號／
    //     牌表一個位元都不出去（同 /api/rooms-archetypes 的原則）。
    const DECK_STATS_SCAN_CAP = 5000;      // 單發最多掃幾筆（超過就 truncated:true 誠實回報）
    const DECK_STATS_TTL = 60000;          // per-deckId 快取（比照 v0.89 統計端點的 60s）
    const DS_RATE_WINDOW = 60 * 1000, DS_RATE_MAX = 30;
    const _deckStatsCache = new Map();     // deckId -> { at, data }
    const _dsRateBuckets = new Map();      // ip -> number[]
    function dsRateLimitCheck(ip) {
      const now = Date.now();
      const arr = (_dsRateBuckets.get(ip) || []).filter((t) => now - t < DS_RATE_WINDOW);
      if (arr.length >= DS_RATE_MAX) { _dsRateBuckets.set(ip, arr); return false; }
      arr.push(now); _dsRateBuckets.set(ip, arr);
      if (_dsRateBuckets.size > 5000) {                       // lazy prune，別讓 map 無限長大
        for (const [k, v] of _dsRateBuckets) if (!v.length || now - v[v.length - 1] > DS_RATE_WINDOW) _dsRateBuckets.delete(k);
      }
      return true;
    }
    // ⚠⚠ 索引自驗。**沒有索引就不可以查**（見上面第②道防線）。
    //   listIndexes 本身也不能每發都打 ⇒ 成功結果快取 60s；失敗結果退避 10s
    //   （剛開機時索引可能還在建，不要一次失敗就整天停用，也不要狂打 listIndexes）。
    let _dsIndexOk = { at: 0, ok: false };
    async function deckStatsIndexReady() {
      const now = Date.now();
      if (_dsIndexOk.ok && now - _dsIndexOk.at < DECK_STATS_TTL) return true;
      if (!_dsIndexOk.ok && _dsIndexOk.at && now - _dsIndexOk.at < 10000) return false;
      try {
        const idx = await db.collection('matchRecords').indexes();
        const keys = (idx || []).map((i) => JSON.stringify(i && i.key));
        const ok = keys.includes('{"p1.deckId":1}') && keys.includes('{"p2.deckId":1}');
        _dsIndexOk = { at: now, ok };
        if (!ok) console.warn('[deck-stats] 缺 p1.deckId／p2.deckId 索引 ⇒ 端點自我停用（避免 COLLSCAN 拖垮錦標賽）');
        return ok;
      } catch (e) { _dsIndexOk = { at: now, ok: false }; return false; }
    }
    // ══ ⭐v6.276（P3a）錦標賽勝率 ═══════════════════════════════════════════════
    //   資料來源＝tournamentArchives（永久歸檔、自包含 players[]＋matches[]；TMATCH 會被
    //   v0.58 排程清掃、且沒有 deckId 對照，不能當來源）。口徑與 /api/admin/deck-archetype-stats
    //   的錦標賽側完全一致：**非 bye 且有勝方**的對局才計（平手場沒有 winnerUid ⇒ 不計）。
    //   ⚠ 上線前的歸檔沒有 players[].deckId ⇒ 查不到＝維持 status:'not-collected'（累積中），
    //     絕不做歷史回填（email＋牌表吻合的近似比對會誤配到別人的牌組）。
    //   ⚠⚠ 索引缺席時只把錦標賽段 fail-closed 成 not-collected，休閒段照常回應 ——
    //     對舊 client 的可見行為與 BASE 完全相同；但絕不容許無索引查詢
    //     （COLLSCAN 會把含 deckEntries 的大 doc 整批吃進 node）。
    const DECK_STATS_TARCH_CAP = 300;      // 單發最多掃幾場歸檔（超過 truncated:true 誠實回報）
    let _dsTarchIdxOk = { at: 0, ok: false };
    async function deckStatsTarchIndexReady() {
      const now = Date.now();
      if (_dsTarchIdxOk.ok && now - _dsTarchIdxOk.at < DECK_STATS_TTL) return true;
      if (!_dsTarchIdxOk.ok && _dsTarchIdxOk.at && now - _dsTarchIdxOk.at < 10000) return false;
      try {
        const idx = await db.collection('tournamentArchives').indexes();
        const keys = (idx || []).map((i) => JSON.stringify(i && i.key));
        const ok = keys.includes('{"players.deckId":1}');
        _dsTarchIdxOk = { at: now, ok };
        if (!ok) console.warn('[deck-stats] 缺 players.deckId 索引 ⇒ 錦標賽段 fail-closed（維持 not-collected）');
        return ok;
      } catch (e) { _dsTarchIdxOk = { at: now, ok: false }; return false; }
    }
    app.get('/api/deck-stats', async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
      if (!dsRateLimitCheck(ip)) return res.status(429).json({ error: '請求過於頻繁（每分鐘最多 30 次）' });
      const deckId = sanitizeDeckId(req.query && req.query.deckId);
      if (!deckId) return res.status(400).json({ error: 'deckId required' });
      // ⚠⚠ 自我停用：回 503 且**不帶 deckStatsApi 哨兵** ⇒ client 一律當「伺服器不支援」處理。
      if (!(await deckStatsIndexReady())) return res.status(503).json({ error: 'deck-stats 尚未就緒（索引未建立）' });
      const now = Date.now();
      const hit = _deckStatsCache.get(deckId);
      if (hit && now - hit.at < DECK_STATS_TTL) return res.json({ ...hit.data, cached: true });
      try {
        const nameMap = await getCardNameMap();
        const rules = nameMap.size ? await getEnabledRulesCached() : [];   // 30s TTL
        // ── 休閒勝率口徑＝**只算線上對戰**（站長裁定）────────────────────────
        //   沿用中央 buildCasualCleanFilter（單一來源）：`roomCode:{$type:'string'}`
        //   ⇒ vsAI 與本機雙人一律不計入；離開場只排除 finalTurn<=2（v0.91 裁定）。
        //   ⚠⚠ buildCasualCleanFilter 回傳的物件**自己就帶一個 `$or`**（離開場那條），
        //     直接把 deckId 的 $or 塞進同一層會把它整條**覆蓋掉** ⇒ 一律用 $and 併。
        const q = { $and: [buildCasualCleanFilter({}), { $or: [{ 'p1.deckId': deckId }, { 'p2.deckId': deckId }] }] };
        // ⚠⚠ **不可以**把 cardCounts 物件直接丟給 archetypeNameOf：它的第一行是
        //   `if (!entries || !entries.length) return null`，那是為 deckEntries **陣列**寫的；
        //   matchRecords 存的是 cardCounts **物件**，`.length` 恆為 undefined
        //   ⇒ 每一筆都會回 null、整張表**靜默全空**（不報錯、不 500，只是永遠沒有資料）。
        // ⭐ 修法是「轉形狀」不是「抄一份分類邏輯」：先把 {cardId: 張數} 轉成
        //   [{cardId,count}]（deckToSets 兩種形狀都吃），再走 v6.229 的**中央**
        //   archetypeNameOf ⇒ 全站分類語義只有一份（含「null ＝ 還不知道」的回傳語義），
        //   與 admin 房間列表／大廳標籤／牌組原型統計是同一份結果。
        //   ⚠ 抄第二份會讓同一副牌在不同畫面被分到不同原型（classifyDeck 的註解已寫明），
        //     而且會讓 v6.229 守衛的「單一錨點」突變測試失效。
        const ccToEntries = (cc) => (cc && typeof cc === 'object' && !Array.isArray(cc)
          ? Object.entries(cc).map(([cardId, count]) => ({ cardId, count }))
          : []);
        const oppArchetypeOf = (cc) => archetypeNameOf(ccToEntries(cc), nameMap, rules);
        const overall = { games: 0, wins: 0, losses: 0, draws: 0 };
        const byArch = new Map();
        let scanned = 0, truncated = false;
        const _cursor = db.collection('matchRecords')
          .find(q, { projection: { 'p1.deckId': 1, 'p2.deckId': 1, 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })
          .sort({ endedAt: -1 });
        for await (const m of _cursor) {
          if (scanned >= DECK_STATS_SCAN_CAP) { truncated = true; break; }
          scanned++;
          const _y = adminScanYield(scanned); if (_y) await _y;   // ⚠ 每 200 筆讓路（v6.242）
          // 這副牌坐哪一側。⚠ 不採信查詢條件、自己再判一次（v6.009 教訓）。
          const isP1 = !!(m.p1 && m.p1.deckId === deckId);
          const isP2 = !!(m.p2 && m.p2.deckId === deckId);
          if (!isP1 && !isP2) continue;
          const r = casualSideResult(m.winner, isP1);            // 雙方同一副牌時以 p1 側為準
          overall.games++;
          if (r === 'win') overall.wins++; else if (r === 'loss') overall.losses++; else overall.draws++;
          // 對手原型。⚠ null ＝「還不知道」，一律**不記帳**，絕不可以混進「未分類」那一列。
          const opp = isP1 ? m.p2 : m.p1;
          const an = oppArchetypeOf(opp && opp.cardCounts);
          if (an === null) continue;
          const v = byArch.get(an) || { games: 0, wins: 0, losses: 0, draws: 0 };
          v.games++;
          if (r === 'win') v.wins++; else if (r === 'loss') v.losses++; else v.draws++;
          byArch.set(an, v);
        }
        const wr = (w, l) => ((w + l) > 0 ? w / (w + l) : null);
        // ── ⭐v6.276 錦標賽勝率（來源與口徑見上方 DECK_STATS_TARCH_CAP 的說明）────────
        //   ⚠ 迴圈變數刻意用 _ta／_tm（不是 _cursor／m）：G2 守衛以「for await (const m of
        //     _cursor)」計數全檔 cursor 逐筆處，名字撞上會讓那支守衛失準。
        const _tourn = {
          status: 'not-collected', games: 0, wins: 0, losses: 0, draws: 0, winRate: null,
          // ⭐ 新欄位一律附加在**既有六個 key 之後**：舊 client（v6.267）的 normalize 只讀
          //   已知欄位，且畫面上錦標賽欄寫死「累積中」⇒ 舊 client 行為零改變。
          since: 'v6.276', vsArchetype: [], events: 0, scanned: 0, truncated: false, scanCap: DECK_STATS_TARCH_CAP,
        };
        if (await deckStatsTarchIndexReady()) {
          const tByArch = new Map();
          let _tn = 0;                                   // 讓路節拍計數（players＋matches 逐元素）
          const _tc = db.collection('tournamentArchives')
            .find({ 'players.deckId': deckId },
                  { projection: { 'players.uid': 1, 'players.deckId': 1, 'players.deckEntries': 1, matches: 1 } })
            .sort({ finishedAt: -1 });
          for await (const _ta of _tc) {
            if (_tourn.events >= DECK_STATS_TARCH_CAP) { _tourn.truncated = true; break; }
            _tourn.events++;
            // 這副牌在這場賽事屬於哪個 uid。⚠ 不採信查詢條件、自己再判一次（v6.009 教訓）。
            const _myUids = new Set(); const _entriesByUid = new Map();
            for (const _tp of ((_ta && _ta.players) || [])) {
              if (!_tp || _tp.uid == null) continue;
              _tn++; const _y1 = adminScanYield(_tn); if (_y1) await _y1;   // ⚠ 每 200 個元素讓路（v6.242）
              _entriesByUid.set(String(_tp.uid), Array.isArray(_tp.deckEntries) ? _tp.deckEntries : []);
              if (_tp.deckId === deckId) _myUids.add(String(_tp.uid));
            }
            if (!_myUids.size) continue;
            for (const _tm of ((_ta && _ta.matches) || [])) {
              _tn++; const _y2 = adminScanYield(_tn); if (_y2) await _y2;   // ⚠ 每 200 個元素讓路（v6.242）
              // 口徑同 /api/admin/deck-archetype-stats 錦標賽側：非 bye 且有勝方才計。
              if (!_tm || _tm.bye || !_tm.winnerUid) continue;
              const _p1Mine = _tm.p1uid != null && _myUids.has(String(_tm.p1uid));
              const _p2Mine = _tm.p2uid != null && _myUids.has(String(_tm.p2uid));
              if (!_p1Mine && !_p2Mine) continue;
              const _myUid = _p1Mine ? String(_tm.p1uid) : String(_tm.p2uid);  // 雙方同副牌時以 p1 側為準（同休閒）
              const _r = tournSideResult(_tm.winnerUid, _myUid);
              _tourn.games++;
              if (_r === 'win') _tourn.wins++; else _tourn.losses++;           // 平手場已被「有勝方」濾掉 ⇒ draws 恆 0
              // 對手原型：歸檔的 deckEntries 本來就是陣列形狀，直接走 v6.229 的中央 archetypeNameOf。
              const _oppUid = _p1Mine ? _tm.p2uid : _tm.p1uid;
              const _oppEntries = _oppUid != null ? _entriesByUid.get(String(_oppUid)) : null;
              const _an = (_oppEntries && _oppEntries.length) ? archetypeNameOf(_oppEntries, nameMap, rules) : null;
              if (_an === null) continue;                 // 「還不知道」一律不記帳（同休閒段）
              const _tv = tByArch.get(_an) || { games: 0, wins: 0, losses: 0, draws: 0 };
              _tv.games++;
              if (_r === 'win') _tv.wins++; else _tv.losses++;
              tByArch.set(_an, _tv);
            }
          }
          _tourn.scanned = _tn;
          if (_tourn.games > 0) {
            _tourn.status = 'ok';
            _tourn.winRate = wr(_tourn.wins, _tourn.losses);
            _tourn.vsArchetype = [...tByArch.entries()]
              .map(([name, v]) => ({ name, games: v.games, wins: v.wins, losses: v.losses, draws: v.draws, winRate: wr(v.wins, v.losses) }))
              .sort((a, b) => b.games - a.games || String(a.name).localeCompare(String(b.name)));
          }
        }
        const data = {
          ok: true,
          // ⭐ 哨兵：舊伺服器沒有這個欄位 ⇒ 下一版 client 用
          //   `typeof body.deckStatsApi === 'number'` 判斷「伺服器支援了嗎」，
          //   缺席就把放大鏡整個藏起來（不要顯示一張全 0 的表騙玩家）。
          deckStatsApi: 1,
          deckId,
          casual: {
            scope: 'online-only',        // 站長裁定：vsAI 與本機雙人不計入
            games: overall.games, wins: overall.wins, losses: overall.losses, draws: overall.draws,
            winRate: wr(overall.wins, overall.losses),
          },
          vsArchetype: [...byArch.entries()]
            .map(([name, v]) => ({ name, games: v.games, wins: v.wins, losses: v.losses, draws: v.draws, winRate: wr(v.wins, v.losses) }))
            .sort((a, b) => b.games - a.games || String(a.name).localeCompare(String(b.name))),
          // ⭐v6.276（P3a）：錦標賽勝率上線 —— TREGS 報名與歸檔 players[] 從本版起帶 deckId。
          //   查得到資料 ⇒ status:'ok'＋真數字；查不到（含上線前的賽事）⇒ 維持
          //   status:'not-collected'（舊 client 顯示「累積中」，行為與 v6.266 相同）。
          tournament: _tourn,
          // ⚠ 誠實回報：既有牌組**不做歷史回填**（回填只能靠「email＋60 張吻合」的近似比對，
          //   會誤配到別人的牌組）⇒ 統計一律「自 v6.266 起算」。
          since: 'v6.266',
          scanned, truncated, scanCap: DECK_STATS_SCAN_CAP, at: now,
        };
        _deckStatsCache.set(deckId, { at: now, data });
        if (_deckStatsCache.size > 500) {
          for (const [k, v] of _deckStatsCache) if (now - v.at > DECK_STATS_TTL) _deckStatsCache.delete(k);
        }
        res.json({ ...data, cached: false });
      } catch (e) {
        console.warn('[deck-stats] error:', e.message);
        res.status(500).json({ error: String((e && e.message) || e) });
      }
    });

    app.get('/api/rooms-archetypes', async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      try {
        const ids = String(req.query.ids || '').split(',')
          .map((s) => String(s || '').trim().toUpperCase())
          .filter((s) => /^[A-Z0-9]{1,8}$/.test(s))
          .slice(0, 40);
        if (!ids.length) return res.json({ rooms: {} });
        const now = Date.now();
        const out = {};
        const need = [];
        for (const id of ids) {
          const hit = _roomArchCache.get(id);
          if (hit && now - hit.at < 300000) out[id] = { p1: hit.p1, p2: hit.p2 };
          else need.push(id);
        }
        if (need.length) {
          const nameMap = await getCardNameMap();
          const rules = nameMap.size ? await getEnabledRulesCached() : [];   // v6.119：30s TTL
          const docs = await db.collection('rooms').find(
            { _id: { $in: need }, status: 'playing' },
            { projection: { 'seats.deckEntries': 1, 'gameState.phase': 1, status: 1 } },
          ).toArray();
          // v6.229：改走中央 archetypeNameOf —— admin 房間列表與這裡必須是同一份分類結果
          const nameOf = (entries) => archetypeNameOf(entries, nameMap, rules);
          for (const r of docs) {
            if (!r.gameState || r.gameState.phase !== 'playing') continue;   // ⚠ 限制②
            const seats = Array.isArray(r.seats) ? r.seats : [];
            const p1 = nameOf(seats[0] && seats[0].deckEntries);
            const p2 = nameOf(seats[1] && seats[1].deckEntries);
            _roomArchCache.set(String(r._id), { at: now, p1, p2 });
            out[String(r._id)] = { p1, p2 };   // ⭐ 白名單：只有這兩個字串會離開伺服器
          }
          if (_roomArchCache.size > 500) {
            for (const [k, v] of _roomArchCache) if (now - v.at > 600000) _roomArchCache.delete(k);
          }
        }
        res.json({ rooms: out });
      } catch (e) {
        res.status(500).json({ error: String((e && e.message) || e) });
      }
    });

    app.get('/api/admin/champion-report', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      try {
        const since = req.query.since ? parseInt(req.query.since) : 0;
        const nameMap = await getCardNameMap();
        if (!nameMap.size) return res.status(503).json({ error: '伺服器卡名對照尚未載入，稍後再試' });
        const rules = await TRULES.find({ enabled: { $ne: false } }).sort({ priority: 1 }).toArray();
        const detectCut = (app.locals || {})._detectCutPlacements;
        const q = {};
        if (since) q.finishedAt = { $gte: since };
        // v6.240：**移除 limit(500)**。這支是「冠軍／四強 → 牌組原型」的**統計聚合**，
        //   限制筆數不是「少顯示幾列」，是讓**統計數字本身失真**（只算最新 500 場）。
        //   ⚠ 改用 cursor 逐筆處理，不把全部歸檔（含 players[].deckEntries，每場 N×60 張）
        //     一次 toArray 讀進 node 記憶體；回應本來就只回每場一小包摘要，不會變大。
        const _cursor = db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 });
        const archetypeOf = (entries) => {
          if (!entries || !entries.length) return null;
          const c = classifyDeck(deckToSets(entries, nameMap), rules);
          return c.rule ? (c.rule.name || null) : null;
        };
        const events = [];
        let _scanned = 0;
        for await (const a of _cursor) {
          _scanned++;
          events.push(((a) => {
          const deckByUid = new Map();
          for (const p of (a.players || [])) if (p && p.uid) deckByUid.set(String(p.uid), p.deckEntries || []);
          const champUid = a.championUid ? String(a.championUid) : null;
          // ⚠ detectCut 拿不到（載入順序異常）時一律回「判不出名次」，不要自己補一套。
          const cut = (typeof detectCut === 'function' && a.matches)
            ? detectCut(a.matches) : { finals: new Set(), top4: new Set(), top8: new Set() };
          const top4 = [...(cut.top4 || [])].map((uid) => ({
            uid: String(uid), archetype: archetypeOf(deckByUid.get(String(uid))),
          }));
          return {
            eventId: a.eventId,
            championUid: champUid,
            championArchetype: champUid ? archetypeOf(deckByUid.get(champUid)) : null,
            finals: [...(cut.finals || [])].map(String),
            top4,
            // 名次推不出來時（決賽非單一場＝賽程結構異常）明確標出來，讓圖上可以誠實說明，
            // 而不是靜默把那場當成「沒有四強」。
            placementsOk: (cut.top4 || new Set()).size > 0,
          };
        })(a));
        }
        res.json({ events, scannedEvents: _scanned, ruleCount: rules.length, generatedAt: Date.now() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/admin/deck-archetype-stats', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const source = ['casual', 'tourn', 'all'].includes(String(req.query.source)) ? String(req.query.source) : 'all';
      const since = req.query.since ? parseInt(req.query.since) : 0;
      const excludeAI = req.query.excludeAI !== 'false';
      const ck = source + '|' + since + '|' + excludeAI;
      const now = Date.now();
      const hit = _archStatsCache.get(ck);
      if (hit && now - hit.at < 60000) return res.json({ ...hit.data, cached: true });
      try {
        const nameMap = await getCardNameMap();
        if (!nameMap.size) return res.status(503).json({ error: '伺服器卡名對照尚未載入，稍後再試' });
        const rules = (await TRULES.find({ enabled: { $ne: false } }).sort({ priority: 1 }).toArray());
        const mk = () => ({ usage: 0, wins: 0, losses: 0, draws: 0 });
        const stat = { casual: new Map(), tourn: new Map() };
        const unclassified = { casual: { usage: 0, wins: 0, losses: 0, draws: 0, cardFreq: new Map() },
                               tourn: { usage: 0, wins: 0, losses: 0, draws: 0, cardFreq: new Map() } };
        const scanned = { casualMatches: 0, casualDecks: 0, tournEvents: 0, tournDecks: 0 };
        // v0.93：有幾副牌同時命中 >=2 條規則。為 0 就代表規則彼此互斥、完全不需要優先序。
        let multiHit = 0;

        /** 把一副牌歸類並記帳。result: 'win'|'loss'|'draw' */
        function tally(bucket, cardsRef, result) {
          const sets = deckToSets(cardsRef, nameMap);
          const c = classifyDeck(sets, rules);
          if (c.all.length >= 2) multiHit++;
          const target = c.rule ? (stat[bucket].get(String(c.rule._id)) || stat[bucket].set(String(c.rule._id), mk()).get(String(c.rule._id)))
                                : unclassified[bucket];
          target.usage++;
          if (result === 'win') target.wins++; else if (result === 'loss') target.losses++; else target.draws++;
          if (!c.rule) {   // 未分類：記錄高頻卡，方便 Wilson 就地開新規則
            for (const n of sets.names) unclassified[bucket].cardFreq.set(n, (unclassified[bucket].cardFreq.get(n) || 0) + 1);
          }
        }

        // ── 休閒（matchRecords）──沿用既有淨化規則（v0.98 只算有房號＝排 AI 與本機；v0.27/0.39 排中途離開）
        if (source === 'casual' || source === 'all') {
          // v0.91：改用中央 buildCasualCleanFilter（單一來源，含離開場 finalTurn 門檻）
          const q = buildCasualCleanFilter({ excludeAI, since });
          // v6.242：**移除 limit(20000)** —— 同明細端點：這是「每個原型的使用次數／勝負／
          //   勝率」的統計聚合，限制筆數＝統計數字本身失真（只算最新 20000 場）。
          // ⚠ cursor 逐筆（不 toArray）＋ 每 200 筆 adminScanYield 讓路（見該函式註解）。
          // ⚠ 下面的聚合（tally）**一字未動**；淨化規則仍走中央 buildCasualCleanFilter。
          const _cursor = db.collection('matchRecords')
            .find(q, { projection: { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })
            .sort({ endedAt: -1 });
          for await (const m of _cursor) {
            scanned.casualMatches++;
            const _y = adminScanYield(scanned.casualMatches); if (_y) await _y;
            for (const side of ['p1', 'p2']) {
              const cc = m[side] && m[side].cardCounts;
              if (!cc || !Object.keys(cc).length) continue;
              scanned.casualDecks++;
              tally('casual', cc, casualSideResult(m.winner, side === 'p1'));
            }
          }
        }

        // ── 錦標賽（tournamentArchives）──每場非 bye 且有勝方的對局，雙方各記一副（報名鎖定的那副）
        if (source === 'tourn' || source === 'all') {
          const q = {};
          if (since) q.finishedAt = { $gte: since };
          // v6.241：**移除 limit(200)** —— 與明細端點同一個理由：這是「每個原型的使用次數／
          //   勝負／勝率」的統計聚合，限制筆數＝統計數字本身失真（只算最新 200 場）。
          //   同樣改 cursor 逐筆，不把含 deckEntries 的整批歸檔 toArray 進記憶體。
          const _cursor = db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 });
          for await (const a of _cursor) {
            scanned.tournEvents++;
            const deckByUid = new Map();
            for (const p of (a.players || [])) if (p && p.uid) deckByUid.set(String(p.uid), p.deckEntries || []);
            for (const m of (a.matches || [])) {
              if (!m || m.bye || !m.winnerUid) continue;
              for (const uid of [m.p1uid, m.p2uid]) {
                if (!uid) continue;
                const entries = deckByUid.get(String(uid));
                if (!entries || !entries.length) continue;
                scanned.tournDecks++;
                tally('tourn', entries, tournSideResult(m.winnerUid, uid));
              }
            }
          }
        }

        // v1.00 未分類高頻卡的兩道過濾（在輸出階段做，不影響 tally 效能；
        //   清單一改也不必重掃資料）：①只留寶可夢 ②排除玩家自訂的支援型寶可夢。
        const [pokeNames, supportNames] = await Promise.all([getPokemonNameSet(), getSupportPokemonNames()]);
        const pack = (bucket) => {
          const out = [];
          for (const r of rules) {
            const v = stat[bucket].get(String(r._id));
            if (!v) continue;
            const dec = v.wins + v.losses;
            out.push({ ruleId: String(r._id), name: r.name, usage: v.usage, wins: v.wins, losses: v.losses,
                       draws: v.draws, winRate: dec > 0 ? v.wins / dec : null, sampleOk: v.usage >= 10 });
          }
          out.sort((a, b) => b.usage - a.usage);
          const u = unclassified[bucket];
          const udec = u.wins + u.losses;
          // ⚠先過濾再 slice(15) —— 反過來的話會先被通用卡佔滿名額、寶可夢一張都不剩。
          const allFreq = [...u.cardFreq.entries()].sort((a, b) => b[1] - a[1]);
          const topCards = allFreq
            .filter(([name]) => pokeNames.has(name) && !supportNames.has(name))
            .slice(0, 20)
            .map(([name, n]) => ({ name, decks: n }));
          // 一併回報「被濾掉幾張」，讓人知道清單有在作用（不然會懷疑是不是壞了）
          const filteredOut = {
            nonPokemon: allFreq.filter(([n]) => !pokeNames.has(n)).length,
            support: allFreq.filter(([n]) => pokeNames.has(n) && supportNames.has(n)).length,
          };
          return { rows: out, unclassified: { usage: u.usage, wins: u.wins, losses: u.losses, draws: u.draws,
                   winRate: udec > 0 ? u.wins / udec : null, topCards, filteredOut } };
        };

        const data = { source, since, excludeAI, ruleCount: rules.length, scanned, multiHit,
                       casual: (source === 'tourn') ? null : pack('casual'),
                       tourn: (source === 'casual') ? null : pack('tourn') };
        _archStatsCache.set(ck, { at: now, data });
        if (_archStatsCache.size > 50) { const k = _archStatsCache.keys().next().value; _archStatsCache.delete(k); }
        res.json(data);
      } catch (e) {
        console.warn('[deck-archetype-stats] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // v1.00 支援型寶可夢清單（未分類高頻卡的排除名單）
  app.get('/api/admin/support-pokemon', requireFirebaseAdmin, async (req, res) => {
    if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
    try { res.json({ names: [...(await getSupportPokemonNames())].sort() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/admin/support-pokemon', requireFirebaseAdmin, async (req, res) => {
    if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
    try {
      // ⚠v1.02:原本寫成「不是陣列就當空陣列」,結果 body 根本沒被解析時
      //   (前端漏帶 Content-Type: application/json,express.json() 就不解析)
      //   會**靜默把整份清單存成空的**、還回 ok:true —— 使用者只看到「點了沒反應」。
      //   「使用者真的要清空」與「body 沒收到」必須分得出來:前者送 names: [],
      //   後者連 names 這個欄位都沒有 → 一律回 400 講清楚原因。
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: '請求 body 未被解析（是否漏了 Content-Type: application/json？）' });
      }
      if (!Array.isArray(req.body.names)) {
        return res.status(400).json({ error: 'names 必須是陣列（清空請送空陣列 []）' });
      }
      const raw = req.body.names;
      // 去重、去空白、上限 300（避免誤貼整份牌表）
      const names = [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 300);
      await getSupportPokemonCol().updateOne({ _id: 'supportPokemon' },
        { $set: { names, updatedAt: Date.now() } }, { upsert: true });
      _archStatsCache.clear();   // 清單一改，統計要立刻反映
      res.json({ ok: true, names });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/stats/heatmap', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      try {
        const pipeline = [];
        if (Object.keys(baseMatch).length > 0) pipeline.push({ $match: baseMatch });
        pipeline.push(
          { $match: { endedAt: { $gt: 0 } } },
          { $project: {
            // $endedAt 是 Date.now() millisecond，$toDate 轉成 Date
            dayOfWeek: { $dayOfWeek: { date: { $toDate: '$endedAt' }, timezone: 'Asia/Taipei' } },  // 1-7 (1=Sunday)
            hour: { $hour: { date: { $toDate: '$endedAt' }, timezone: 'Asia/Taipei' } },           // 0-23
          }},
          { $group: {
            _id: { day: '$dayOfWeek', hour: '$hour' },
            count: { $sum: 1 },
          }},
          { $project: { _id: 0, day: '$_id.day', hour: '$_id.hour', count: 1 } },
        );
        const cells = await db.collection('matchRecords').aggregate(pipeline).toArray();
        res.json({ cells, timezone: 'Asia/Taipei', generatedAt: Date.now() });
      } catch (e) {
        console.warn('[stats heatmap] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // 2.5 對戰量趨勢 — 按天/週/月 分桶
    //   ?mode=online|local
    //   ?granularity=day|week|month (default day)
    //   ?days=30 (default — 看近 N 天；max 365)
    app.get('/api/admin/stats/trends', requireFirebaseAdmin, async (req, res) => {
      if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready' });
      const baseMatch = {};
      if (req.query.mode === 'online') baseMatch.roomCode = { $type: 'string' };
      else if (req.query.mode === 'local') baseMatch.roomCode = null;
      const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
      const granularity = ['day', 'week', 'month'].includes(req.query.granularity) ? req.query.granularity : 'day';
      const fmt = granularity === 'day' ? '%Y-%m-%d' : (granularity === 'week' ? '%G-W%V' : '%Y-%m');
      try {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const pipeline = [
          { $match: { ...baseMatch, endedAt: { $gte: cutoff } } },
          { $project: {
            bucket: { $dateToString: { date: { $toDate: '$endedAt' }, format: fmt, timezone: 'Asia/Taipei' } },
            isOnline: { $cond: [{ $or: [{ $eq: ['$roomCode', null] }, { $eq: ['$roomCode', ''] }] }, false, true] },
            vsAI: { $ifNull: ['$vsAI', false] },
          }},
          { $group: {
            _id: '$bucket',
            total: { $sum: 1 },
            online: { $sum: { $cond: ['$isOnline', 1, 0] } },
            local: { $sum: { $cond: ['$isOnline', 0, 1] } },
            vsAI: { $sum: { $cond: ['$vsAI', 1, 0] } },
          }},
          { $sort: { _id: 1 } },
          { $project: { _id: 0, bucket: '$_id', total: 1, online: 1, local: 1, vsAI: 1 } },
        ];
        const buckets = await db.collection('matchRecords').aggregate(pipeline).toArray();
        res.json({ buckets, granularity, days, mode: req.query.mode || 'all', generatedAt: Date.now() });
      } catch (e) {
        console.warn('[stats trends] error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    console.log('[stats] v0.2 endpoints registered (Phase 2a + 2b): /api/admin/stats/{overview,cards,players,players/:email,cards/winrate,heatmap,trends} + /api/admin/cards/tags');
  })();

  console.log('[admin] v0.13 endpoints registered (firebase ' + (fbInitialized ? 'ON' : 'OFF') + ', matchRecords cardCounts + DELETE + roomCode mode filter, Phase 2a + 2b stats + cardTags)');
}).catch(err => {
  console.error('[admin] firebase-admin import failed:', err);
});

// === TW DECK CODE IMPORT === v0.1
// 公開 endpoint（無需 admin auth）— 玩家貼台灣官網 deck code 自動解析牌組。
// 對應 client: src/routes/decks/+page.svelte 的「🎫 官網代碼匯入」按鈕。
//
// 官網 URL pattern: https://asia.pokemon-card.com/tw/deck-build/recipe/{code}/
//   - 直接 SSR 出完整牌組 HTML，無需走 JS API
//   - HTML 內每張卡有 <a href="/tw/card-search/detail/<numericId>/">卡名</a>
//     + 緊接 setCode collectorNumber + count 數字
//
// Cache: 5 分鐘 TTL（同 code 不重複爬官網）
// Rate-limit: 5 reqs/min per IP（防爬蟲行為，避免被官網封 IP）
// User-Agent: 偽裝正常瀏覽器
(function registerTwDeckImport() {
  const DECK_CACHE_TTL = 5 * 60 * 1000;
  const RATE_WINDOW = 60 * 1000;
  const RATE_MAX = 5;
  const deckCache = new Map();           // code -> { entries, fetchedAt }
  const rateBuckets = new Map();          // ip -> [timestamps]

  function rateLimitCheck(ip) {
    const now = Date.now();
    const arr = (rateBuckets.get(ip) || []).filter(t => now - t < RATE_WINDOW);
    if (arr.length >= RATE_MAX) {
      rateBuckets.set(ip, arr);
      return false;
    }
    arr.push(now);
    rateBuckets.set(ip, arr);
    return true;
  }

  // Parse 官網 deck-recipe HTML 抽出每張卡的 cardId/setCode/number/count
  function parseDeckHtml(html) {
    const entries = [];
    // 找所有 <a href="/tw/card-search/detail/<id>/"> 鏈接
    const linkRegex = /href="(?:https?:\/\/asia\.pokemon-card\.com)?\/tw\/card-search\/detail\/(\d+)\/?"[^>]*>([^<]+)<\/a>/g;
    const positions = [];
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      positions.push({ id: m[1], name: m[2].trim(), endIdx: linkRegex.lastIndex });
    }
    for (let i = 0; i < positions.length; i++) {
      const cur = positions[i];
      const nextStart = i + 1 < positions.length ? html.indexOf('href=', cur.endIdx) : html.length;
      const segment = html.substring(cur.endIdx, nextStart > 0 ? nextStart : html.length);
      // setCode + collectorNumber pattern: 字母數字組合，後面接 數字/[數字或字母]
      //   e.g. "M4 002/083" / "SVTM 001/022" / "SVM WAT"
      const setMatch = segment.match(/>\s*([A-Za-z0-9\-]+)\s+(\d+\/[\w\d]+|[A-Z]+)\s*</);
      // count: 1~60 範圍內的整數（卡片張數，能量卡最多 59）
      const countMatch = segment.match(/>\s*(\d{1,2})\s*</);
      if (!countMatch) continue;
      const count = parseInt(countMatch[1], 10);
      if (!count || count > 60) continue;
      entries.push({
        cardId: cur.id,
        name: cur.name,
        setCode: setMatch ? setMatch[1] : null,
        collectorNumber: setMatch ? setMatch[2] : null,
        count,
      });
    }
    return entries;
  }

  app.get('/api/decode-tw-deck/:code', async (req, res) => {
    const code = req.params.code;
    // 代碼格式驗證：XXXXXX-XXXXXX-XXXXXX
    if (!/^[A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: '代碼格式錯誤（應為 XXXXXX-XXXXXX-XXXXXX）' });
    }
    // Rate-limit
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    if (!rateLimitCheck(ip)) {
      return res.status(429).json({ error: '請求過於頻繁，請稍候再試（每分鐘最多 5 次）' });
    }
    // Cache hit
    const cached = deckCache.get(code);
    if (cached && Date.now() - cached.fetchedAt < DECK_CACHE_TTL) {
      return res.json({ code, entries: cached.entries, cached: true });
    }
    // Fetch 官網
    // v6.224：外部 fetch 加逾時保護 —— Node 的 fetch 預設沒有時間上限，官網掛住時
    //   玩家會無限期乾等（nginx 計時 log 2026-08-23 實測有一筆 11.974 秒才回 200，
    //   全部耗在等官網）。逾時取 20 秒而非 10 秒：既然官網慢到 12 秒仍能成功回應，
    //   10 秒會把「慢但能成功」的匯入切成失敗；20 秒也仍低於 nginx proxy 預設 60 秒，
    //   由本端先逾時、回覆對玩家有意義的訊息。用 AbortController + setTimeout
    //   （相容所有支援全域 fetch 的 Node 版本），無論成敗都 clearTimeout 不留 handle。
    const FETCH_TIMEOUT_MS = 20 * 1000;
    const fetchAbort = new AbortController();
    const fetchTimer = setTimeout(() => fetchAbort.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = 'https://asia.pokemon-card.com/tw/deck-build/recipe/' + code + '/';
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: fetchAbort.signal,
      });
      if (!r.ok) {
        return res.status(r.status === 404 ? 404 : 502).json({ error: '官網回應異常 (HTTP ' + r.status + ')' });
      }
      const html = await r.text();
      const entries = parseDeckHtml(html);
      if (entries.length === 0) {
        return res.status(422).json({ error: 'HTML 解析失敗（可能代碼無效或官網結構變動）' });
      }
      deckCache.set(code, { entries, fetchedAt: Date.now() });
      const totalCards = entries.reduce((s, e) => s + e.count, 0);
      console.log('[deck-import] ' + code + ' → ' + entries.length + ' 種卡 (' + totalCards + ' 張) from ' + ip);
      res.json({ code, entries, cached: false });
    } catch (err) {
      // v6.224：逾時（AbortError／TimeoutError）給玩家看得懂的訊息 ——
      //   AbortError 的原文（This operation was aborted）對玩家沒有意義。
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        console.warn('[deck-import] fetch timeout ' + FETCH_TIMEOUT_MS + 'ms: ' + code);
        return res.status(504).json({ error: '官網回應太慢，請稍後再試' });
      }
      console.warn('[deck-import] fetch error:', err.message);
      res.status(500).json({ error: '無法連線到官網: ' + err.message });
    } finally {
      clearTimeout(fetchTimer);
    }
  });

  console.log('[deck-import] v0.1 endpoint /api/decode-tw-deck/:code registered');
})();

// === TW OFFICIAL DECK CODE EXPORT === v0.1 (v4.973 主站 - 牌組編輯器「📤 匯出為官網代碼」)
//
// 流程（透過抓 deckCreate.js / HTML 反推）：
//   1. GET https://asia.pokemon-card.com/tw/deck-build/
//      → 拿 Set-Cookie 的 PHPSESSID + HTML 內 <input name="token" value="..."> CSRF token
//   2. POST /tw/deck-build/beforecheck/ (form-urlencoded, deckData[N][cardId/cardName/count])
//      → response {"success":{"code":200,"errors":[]}}；errors 非空代表牌組違規（不到 60 / 違反賽季 etc）
//   3. POST /tw/deck-build/register/ (form-urlencoded, token=...&deckData=<JSON.stringify(array)>)
//      → 302 redirect to /tw/deck-build/code/?deckCode=XXXXXX-XXXXXX-XXXXXX
//
// 注意：register/ 會在官網 DB 永久寫入這筆牌組，所以 rate-limit 比 import 嚴：
//   - 3 reqs/min per IP（防爛用）
//   - 12 reqs/hour per IP（每天上限 ~288 次以避免我們 IP 被官網風控）
//
// 沒 cache — 同樣 deck 每次 export 拿到的 deckCode 不同（官網每次都 register 新 entry）。
// 玩家在 client 端拿到 code 後應該自己留存，不要無限 re-export。
//
// User-Agent 偽裝 Chrome（同 import endpoint）。
(function registerTwDeckExport() {
  const RATE_MIN_WINDOW = 60 * 1000;
  const RATE_MIN_MAX = 3;
  const RATE_HR_WINDOW = 60 * 60 * 1000;
  const RATE_HR_MAX = 12;
  const exportRateBuckets = new Map(); // ip -> [timestamps]
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  function rateLimitExport(ip) {
    const now = Date.now();
    // 雙窗：min + hr
    const arr = (exportRateBuckets.get(ip) || []).filter(t => now - t < RATE_HR_WINDOW);
    const minCount = arr.filter(t => now - t < RATE_MIN_WINDOW).length;
    if (minCount >= RATE_MIN_MAX) {
      exportRateBuckets.set(ip, arr);
      return { ok: false, reason: '請求過於頻繁（每分鐘最多 3 次）' };
    }
    if (arr.length >= RATE_HR_MAX) {
      exportRateBuckets.set(ip, arr);
      return { ok: false, reason: '每小時匯出上限已達（最多 12 次）' };
    }
    arr.push(now);
    exportRateBuckets.set(ip, arr);
    return { ok: true };
  }

  // 驗證 entries：cardId 純數字 / cardName 非空 / count 1~60 / 總數 ≤ 60
  function validateEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '牌組空白';
    if (entries.length > 60) return '卡牌種類超過 60';
    let total = 0;
    for (const e of entries) {
      if (!e || typeof e !== 'object') return 'entry 格式錯誤';
      if (!/^\d+$/.test(String(e.cardId))) return `cardId 須為純數字（收到 "${e.cardId}"）`;
      if (typeof e.cardName !== 'string' || !e.cardName.trim()) return 'cardName 不可空白';
      if (e.cardName.length > 50) return `cardName 過長（${e.cardName}）`;
      const c = Number(e.count);
      if (!Number.isInteger(c) || c < 1 || c > 60) return `count 須為 1~60 整數（收到 ${e.count}）`;
      total += c;
    }
    if (total > 60) return `總卡數超過 60（目前 ${total}）`;
    return null;
  }

  // Express 預設不 parse 自訂 JSON body，server.js 應該已掛 express.json()；保險起見手動讀 stream。
  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      if (req.body && typeof req.body === 'object') return resolve(req.body);
      let data = '';
      req.on('data', chunk => { data += chunk; if (data.length > 100 * 1024) { reject(new Error('payload too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  // 從 Set-Cookie header 抽 Cookie 字串（PHPSESSID=...; otherCookie=...）
  function cookiesFromResponse(r) {
    // Node 18+ has getSetCookie(); fallback to raw header parse
    const arr = (typeof r.headers.getSetCookie === 'function')
      ? r.headers.getSetCookie()
      : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    return arr.filter(Boolean).map(c => c.split(';')[0]).join('; ');
  }

  app.post('/api/encode-tw-deck', async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    const rateRes = rateLimitExport(ip);
    if (!rateRes.ok) {
      return res.status(429).json({ error: rateRes.reason });
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return res.status(400).json({ error: 'JSON body 解析失敗：' + e.message });
    }
    const entries = body && body.entries;
    const errMsg = validateEntries(entries);
    if (errMsg) {
      return res.status(400).json({ error: errMsg });
    }
    // v6.230：三段外部 fetch 加逾時保護（比照 v6.224 的 /api/decode-tw-deck）——
    //   Node 的 fetch 預設沒有時間上限，官網任一段掛住時玩家會無限期乾等，
    //   而且三段接續、風險比單一 fetch 更高。單段逾時取 20 秒：本端點實測成功案例
    //   三段合計僅 1.2~1.4 秒（nginx 計時 log 2026-08-25，樣本少且只記 >1 秒者），
    //   但同一官網主機在匯入端實測過 11.974 秒仍成功回 200（v6.224），故保守沿用
    //   20 秒，避免把「慢但能成功」的匯出切成失敗。三段「各自」計時（各有自己的
    //   20 秒，不共用同一顆 timer），另設 50 秒總預算。
    //   ⚠ 總預算依據（v6.231 更正）：nginx 的 /api/ 是 proxy_read_timeout 24h
    //   （2026-08-22 VM 實查），不會在 60 秒切斷；真正的上游天花板是 Cloudflare
    //   邊緣代理（約 100 秒回 524）。要守住的排序是
    //     後端總預算 50s ＜ 前端逾時 55s ＜ Cloudflare ~100s
    //   ——沒有總預算時最壞情況三段相加 60 秒 ＞ 前端 55 秒，玩家會先被前端切斷、
    //   看不到本端的分段訊息。代價：前兩段合計超過 30 秒時，第三段會被剩餘預算
    //   壓縮（理論下限約 10 秒）；實測成功案例三段合計僅 1.2~1.4 秒，屬刻意取捨。
    const STEP_TIMEOUT_MS = 20 * 1000;
    const TOTAL_BUDGET_MS = 50 * 1000;
    const exportDeadline = Date.now() + TOTAL_BUDGET_MS;
    const stepTimers = [];
    let timeoutStage = '';
    let timeoutMsg = '官網回應太慢，請稍後再試';
    // 每段 fetch 前呼叫：回傳該段專用的 abort signal；逾時值＝min(單段, 剩餘總預算)。
    // 逾時訊息在 timer 真正觸發時才寫入 —— 只有實際逾時的那一段會決定回覆內容。
    // timer 不逐段提前清（已完成段的 abort 是 no-op、訊息會被真正逾時的那段覆寫），
    // 統一在外層 finally 清光，任何 return 路徑都不留 handle。
    const armStep = (stage, msg) => {
      const ac = new AbortController();
      const ms = Math.max(1, Math.min(STEP_TIMEOUT_MS, exportDeadline - Date.now()));
      stepTimers.push(setTimeout(() => { timeoutStage = stage; timeoutMsg = msg; ac.abort(); }, ms));
      return ac.signal;
    };
    try {
      // Step 1: GET /tw/deck-build/ → cookie + token
      const r1 = await fetch('https://asia.pokemon-card.com/tw/deck-build/', {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        },
        signal: armStep('step1-token-page', '官網回應太慢（官網頁面載入逾時），請稍後再試；牌組尚未發行'),
      });
      if (!r1.ok) {
        return res.status(502).json({ error: '官網拿 token 失敗 (HTTP ' + r1.status + ')' });
      }
      const cookieHeader = cookiesFromResponse(r1);
      const html = await r1.text();
      const tokenMatch = html.match(/<input[^>]*name="token"[^>]*value="([^"]+)"/);
      if (!tokenMatch) {
        return res.status(502).json({ error: '官網 token 抽取失敗（HTML 結構變動？）' });
      }
      const token = tokenMatch[1];

      // Step 2: POST beforecheck/ — 驗證 entries 合法
      const checkBody = new URLSearchParams();
      entries.forEach((e, i) => {
        checkBody.set(`deckData[${i}][cardId]`, String(e.cardId));
        checkBody.set(`deckData[${i}][cardName]`, String(e.cardName));
        checkBody.set(`deckData[${i}][count]`, String(e.count));
      });
      const r2 = await fetch('https://asia.pokemon-card.com/tw/deck-build/beforecheck/', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://asia.pokemon-card.com',
          'Referer': 'https://asia.pokemon-card.com/tw/deck-build/',
          'Cookie': cookieHeader,
        },
        body: checkBody.toString(),
        signal: armStep('step2-beforecheck', '官網回應太慢（牌組驗證逾時），請稍後再試；牌組尚未發行'),
      });
      if (!r2.ok) {
        return res.status(502).json({ error: 'beforecheck/ HTTP ' + r2.status });
      }
      const checkJson = await r2.json().catch(() => null);
      const checkErrors = checkJson && checkJson.success && Array.isArray(checkJson.success.errors) ? checkJson.success.errors : null;
      if (checkErrors === null) {
        return res.status(502).json({ error: 'beforecheck/ response 結構異常（' + JSON.stringify(checkJson).substring(0, 200) + '）' });
      }
      if (checkErrors.length > 0) {
        return res.status(422).json({ error: '官網拒絕此牌組：' + checkErrors.join('; '), officialErrors: checkErrors });
      }

      // Step 3: POST register/ — 真正寫入，拿 deckCode
      const deckJsonStr = JSON.stringify(entries.map(e => ({
        cardId: String(e.cardId),
        cardName: String(e.cardName),
        count: Number(e.count),
      })));
      const regBody = new URLSearchParams();
      regBody.set('token', token);
      regBody.set('deckData', deckJsonStr);
      const r3 = await fetch('https://asia.pokemon-card.com/tw/deck-build/register/', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': 'https://asia.pokemon-card.com',
          'Referer': 'https://asia.pokemon-card.com/tw/deck-build/',
          'Cookie': cookieHeader,
        },
        body: regBody.toString(),
        redirect: 'manual',
        signal: armStep('step3-register', '官網回應太慢（牌組發行逾時）——牌組可能已在官網發行成功但未能取得代碼；若重試，官網會多產生一份新的牌組紀錄'),
      });
      if (r3.status !== 302) {
        return res.status(502).json({ error: 'register/ 預期 302 但拿到 HTTP ' + r3.status });
      }
      const location = r3.headers.get('location') || '';
      const codeMatch = location.match(/deckCode=([A-Za-z0-9]{6}-[A-Za-z0-9]{6}-[A-Za-z0-9]{6})/);
      if (!codeMatch) {
        return res.status(502).json({ error: 'register/ redirect 無 deckCode（location=' + location.substring(0, 200) + '）' });
      }
      const deckCode = codeMatch[1];
      const totalCards = entries.reduce((s, e) => s + Number(e.count), 0);
      console.log('[deck-export] ' + deckCode + ' ← ' + entries.length + ' 種卡 (' + totalCards + ' 張) from ' + ip);
      res.json({ deckCode, totalKinds: entries.length, totalCards });
    } catch (err) {
      // v6.230：逾時（AbortError／TimeoutError）給玩家看得懂的訊息（比照 v6.224 匯入端）——
      //   AbortError 原文（This operation was aborted）對玩家沒有意義；依逾時發生的
      //   段落給不同提示（第三段 register/ 已對官網送出發行請求、結果不明，特別提醒）。
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        console.warn('[deck-export] fetch timeout at ' + (timeoutStage || 'unknown') + ' from ' + ip);
        return res.status(504).json({ error: timeoutMsg });
      }
      console.warn('[deck-export] fetch error:', err.message);
      res.status(500).json({ error: '無法連線到官網: ' + err.message });
    } finally {
      // 無論成敗（含所有提前 return 分支）都清掉三段的逾時 timer，不留 handle
      for (const t of stepTimers) clearTimeout(t);
    }
  });

  console.log('[deck-export] v0.1 endpoint POST /api/encode-tw-deck registered');
})();

// === ZOMBIE ROOM CLEANUP === v0.3 (Oracle 主機無 firebase 額度限制，頻率提高)
// 定期清理 MongoDB 殭屍房間，避免 lobby 一堆死房 + playing 房雙方斷線後永遠卡在那。
// v0.2：加 ended 房 90 天 retention（之前永久保留，但歷史資料無限累積會吃 disk）。
// v0.3：firebase 額度限制已不適用（搬到 Oracle 主機）— 頻率提高、lobby 閾值降低，避免殭屍堆積。
//
// 規則（v0.3 更新）：
//   - status='lobby' 且 updatedAt > 5 min 前 → 清掉（從 10 min 降到 5 min — 玩家關瀏覽器沒解房）
//   - status='playing' 且 updatedAt > 5 min 前 → 清掉（雙方都斷線，心跳全停；不改避免殺活房）
//   - status='ended' 且 updatedAt > 90 天 前 → 清掉
//   - 連帶清掉孤兒 messages（roomCode 對應的 room 已被清掉）
//
// 啟動延遲 15s 跑首次（從 30s 降），之後每 2 分鐘掃一次（從 5 min 降）。
(function startZombieRoomCleanup() {
  const ZOMBIE_INTERVAL_MS = 2 * 60 * 1000;             // v0.3: 每 2 分鐘掃（從 5 → 2）
  const LOBBY_STALE_MS = 5 * 60 * 1000;                 // v0.3: lobby 5 分鐘無動作（從 10 → 5）
  // ⭐ v1.03：5 分鐘 → 20 分鐘。原本 playing 房 5 分鐘沒寫入就整個刪掉，但「對手掛機、我在等」
  //   的場景雙方都零寫入（對戰中不送心跳），於是房間在閒置判負門檻（最長 5 分鐘）之後很快被
  //   蒸發 —— 玩家按宣告鈕只會拿到「對手其實已經行動了」，沒有人被判勝負。
  //   現在由 startCasualIdleForfeit 先把它判成 game-over + ended（玩家看得到結果），
  //   這裡只負責清「連判都判不出來」的真殭屍（actor=-1/null，例如雙方都掉線）。
  const PLAYING_STALE_MS = 20 * 60 * 1000;              // playing 20 分鐘無動作才刪（v1.03 從 5 分鐘拉長）
  const ENDED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;  // ended 房保留 90 天（不改）

  async function sweepZombies() {
    if (typeof db === 'undefined' || !db) return;
    try {
      const now = Date.now();
      const lobbyCutoff = now - LOBBY_STALE_MS;
      const playingCutoff = now - PLAYING_STALE_MS;
      const endedCutoff = now - ENDED_RETENTION_MS;     // v0.2

      // 一次性查出殭屍 room IDs（lobby + playing + ended retention 合併 query）
      // 注意：updatedAt 在 mongo 內存的是 number（毫秒 epoch），由 oracle server.js 寫入時就是 Date.now()
      const zombies = await db.collection('rooms').find(
        {
          $or: [
            { status: 'lobby', updatedAt: { $lt: lobbyCutoff } },
            { status: 'playing', updatedAt: { $lt: playingCutoff } },
            { status: 'ended', updatedAt: { $lt: endedCutoff } },  // v0.2: 90 天 retention
          ],
        },
        { projection: { _id: 1, status: 1, updatedAt: 1 } }
      ).toArray();

      if (zombies.length === 0) return;

      const codes = zombies.map(r => r._id);
      // 並行刪除 rooms + 對應 messages
      const [roomResult, msgResult] = await Promise.all([
        db.collection('rooms').deleteMany({ _id: { $in: codes } }),
        db.collection('messages').deleteMany({ roomCode: { $in: codes } }),
      ]);

      const lobbyCount = zombies.filter(r => r.status === 'lobby').length;
      const playingCount = zombies.filter(r => r.status === 'playing').length;
      const endedCount = zombies.filter(r => r.status === 'ended').length;  // v0.2
      console.log(
        '[zombie-cleanup] 清掉 ' + roomResult.deletedCount + ' 個房 ' +
        '(lobby:' + lobbyCount + ', playing:' + playingCount + ', ended>90d:' + endedCount + ') + ' +
        msgResult.deletedCount + ' 則孤兒訊息'
      );
    } catch (err) {
      console.warn('[zombie-cleanup] sweep error:', err.message || err);
    }
  }

  // 啟動：延遲 15 秒讓 server.js / mongo 連線完整 init，之後每 2 分鐘掃一次（v0.3 提高頻率）
  setTimeout(() => {
    sweepZombies();
    setInterval(sweepZombies, ZOMBIE_INTERVAL_MS);
  }, 15 * 1000);
  console.log('[zombie-cleanup] v0.4 已啟動：lobby>5min / playing>20min / ended>90天 自動清，每 2 分鐘掃一次');
})();

// ════════════════════════════════════════════════════════════════════════════
// v0.31 錦標賽 — 伺服器權威（測試，限定 /game/tournament）
//   引擎跑在伺服器：收動作 → applyAction → 存 tournamentRooms collection → 回傳唯一盤面。
//   引擎 bundle + 卡池放 /opt/ptcg/api/tournament/（server-engine.cjs + tournament-pool.json）。
//   ★ 獨立 collection、獨立路由；載入失敗只停用錦標賽，正常對戰/admin 完全不受影響（金絲雀）。
// ════════════════════════════════════════════════════════════════════════════
(async () => {
  try {
    const TDIR = '/opt/ptcg/api/tournament';
    let TENG, poolObj;
    try {
      // CJS host
      TENG = require(TDIR + '/server-engine.cjs');
      poolObj = require(TDIR + '/tournament-pool.json');
    } catch (eReq) {
      // ESM host
      const _m = await import(TDIR + '/server-engine.cjs');
      TENG = (_m.default && _m.default.createGame) ? _m.default : _m;
      const _fs = await import('fs');
      poolObj = JSON.parse(_fs.readFileSync(TDIR + '/tournament-pool.json', 'utf8'));
    }
    const TPOOL = new Map(Object.entries(poolObj));
    const TROOMS = db.collection('tournamentRooms');
    // ⭐⭐⭐ v6.213【③ per-request 伺服器處理時間】—— **只加量測，不動任何業務邏輯**。
    //   問題：client 量到的 `perf.api.net`（送出 → 第一個位元組）把「Cloudflare／隧道／線路慢」
    //   與「Node 自己處理慢」**綁死**。伺服器端指標一直全綠，但那是 pm2/系統層的平均值，
    //   對不上「某一發請求」；而 client 只看得到往返總和 ⇒ 兩邊永遠兜不起來（v6.134 的老問題）。
    //   ⇒ 在回應標頭帶上這一發**在 Express 裡待了多久**（進中介層 → 準備送出 header）。
    //     client 收下寫進診斷 payload 的 `perf.srv`，`net - srv` 就是純線路時間。
    //   ⚠ 負擔：每個請求兩次 process.hrtime.bigint()、一次 setHeader、一個閉包。
    //     以 50 人同時對戰、每人 ~1 發/1.2 秒估算約 42 req/s ⇒ 量級是**每秒數十微秒**。
    //     沒有 I/O、沒有 await、沒有計時器、不碰 DB。
    //   ⚠ 這支**只掛在 /api/tournament**（app.use 的路徑前綴），休閒對戰路由完全不經過。
    //   ⚠ 註冊位置必須在本 IIFE 的所有 /api/tournament 路由**之前**（Express 依註冊順序走 layer；
    //     v1.11 gzip 那次事故就是掛在 stack 尾端永遠輪不到）。這裡是本區塊第一行 app.use。
    //   ⚠ 長輪詢 `/state?wait=1` 會 by design 掛起最多 25 秒 ⇒ 那一發的 X-Srv-Ms 也會是 ~25000。
    //     client 端的 `_tRecordApiSegments` 本來就把 wait=1 整發排除（v6.159），`srv` 與 `net`
    //     的母體因此**完全一致**、可以直接相減。
    //   ⚠ 同源（頁面與 API 都在 www.ptcg-tw-sim.com）⇒ 不需要 Access-Control-Expose-Headers。
    const SRV_MS_HEADER = 'X-Srv-Ms';
    app.use('/api/tournament', function _srvTimingMw(req, res, next) {
      try {
        const _t0 = process.hrtime.bigint();
        const _origWriteHead = res.writeHead;
        // ⚠ 一定要包 writeHead 而不是掛 res.on('finish')：finish 是**送出之後**才觸發，
        //   那時候 header 早就寫死了，setHeader 會拋 ERR_HTTP_HEADERS_SENT。
        res.writeHead = function () {
          try {
            if (!res.headersSent) {
              res.setHeader(SRV_MS_HEADER, (Number(process.hrtime.bigint() - _t0) / 1e6).toFixed(1));
            }
          } catch (e) { /* 量測絕不影響回應 */ }
          return _origWriteHead.apply(this, arguments);
        };
      } catch (e) { /* 量測絕不影響回應 */ }
      next();
    });
    console.log('[tournament] per-request timing header enabled (v6.213) header=' + SRV_MS_HEADER);
    // v0.71 降載：對戰 log 佔完整盤面約 73%(一場打久了累積數百行)。/state /action /spectate 回應只送最近
    //   TOURN_LOG_CAP 行 log(儲存於 TROOMS 的盤面 + onMatchGameOver 的 finalLog 快照仍保留完整)。前端動畫游標
    //   已改用 timestamp 偵測新事件(非 log 長度),故截尾對前端透明、動畫/音效不受影響。
    const TOURN_LOG_CAP = 60;
    function _capLog(gs) {
      if (!gs || !Array.isArray(gs.log) || gs.log.length <= TOURN_LOG_CAP) return gs;
      return { ...gs, log: gs.log.slice(-TOURN_LOG_CAP) };
    }
    // ── v6.153 玩家端遮蔽的總開關（**預設關閉**）──────────────────────────────
    // 站長裁定：本站是練習性質、不是專業競賽站，對手手牌被 devtools 看到沒關係；
    //   為了防這件事去動對戰核心路徑（picker、卡效果、身分驗證）不划算。
    // ⚠ 這個旗標**只管玩家視角**（seat 0/1）。觀戰視角（seat = -1）不受它影響、永遠遮 ——
    //   那是 v6.149 就有的既有行為（v6.150 只是把牌庫與獎賞一起補上）。
    // ⚠ `_redactFlag` 由 `/state` 每 10 秒刷新一次（對戰中每 1.2 秒就有一發，快取一定新鮮）；
    //   其他呼叫點（/action、/join、/spectate）讀的是這份快取，不必各自 await。
    //   伺服器剛啟動、還沒有任何 /state 進來時是 false ＝ 安全的預設。
    let _redactFlag = false, _redactAt = 0;
    function _redactOn() { return _redactFlag; }
    async function redactEnabled() {
      const now = Date.now();
      if (now - _redactAt < 10000) return _redactFlag;
      try {
        const d = await TCONFIG.findOne({ _id: 'redactState' });
        _redactFlag = !!(d && d.enabled === true);   // 只有明確 true 才算開
      } catch (e) { /* 讀不到就維持現值 */ }
      _redactAt = now;
      return _redactFlag;
    }
    // ── v6.150 REDACT BLOCK BEGIN ──
    // 玩家端盤面遮蔽（公平性）。/state 與 /action 原本直接回傳整份 doc.gameState，
    // 只有 /spectate/state 會蓋手牌 ⇒ 對戰中任一方用 devtools 就能讀到對手的手牌內容、
    // 牌庫順序、獎賞內容。規則每一條都對應卡面或既有 UI 行為，不是「一律蓋掉」：
    //   ① 只遮**對手**的 hand / deck / prizes 的**內容**；長度、iid 一律保留
    //      （對戰頁有雙方手牌張數 chip、牌庫/獎賞張數；iid 保留才不會動到卡片守恆守衛）。
    //   ② phase === 'game-over' 不遮 —— 攤牌，與 /replay 的既有決策一致；
    //      也讓對戰結束時 client 上報的 matchRecords 牌組統計維持正確。
    //   ③ 面朝上的獎賞（faceUp）本來就雙方可見 → 不遮。
    //   ④ 效果已合法揭示給我看的卡不遮：pendingSelection / pendingChainQueue 裡
    //      actorIdx === 我 且 sourcePlayerIdx === 對手 的那幾筆（枇琶、能量撢子、
    //      莉莉艾的蝶結萌虻、配樂之笛…）。params 裡點名的 iid 逐一放行；
    //      hand-discard / hand-choose 則整手牌放行（UI 會畫「對手手牌其餘 N 張」）。
    //      ⚠ params.concealed === true（卡面「在不看正面的情況下」）一律**不**放行 ——
    //        遮蔽在這裡剛好與卡面同向（UI 端本來就畫卡背）。
    //      ⚠ 故意不用 params key 白名單（validIids / top5Iids / candidateIids …）——
    //        那種白名單一定漂移（IRON_RULES Rule 25／28）。改成把 params 底下所有字串收起來，
    //        對手隱藏區某張卡的 iid 若**完整相符**就放行（完整字串比對，不用 indexOf 以免誤中）。
    //   ⑤ 火箭隊的貓老大ex｜高傲指令的完整版 picker 在 client 端攔截（直接讀對手牌庫頂
    //      10 張），那個時間點還沒有 pendingSelection ⇒ 依卡面條件式放行牌庫頂 10 張。
    //   ⑥ 對手的 log privateMessage（「搜到 XX 加入手牌」這種只給本人看的版本）一併剝除 ——
    //      client 只是靠 playerIndex 決定顯示哪一版，資料本身早就在 payload 裡了。
    //   ⑦ 座位只認 **verified**（Bearer token 驗過）的 uid。playerId fallback 可以隨便填 uid，
    //      而 /state 回應本來就含 seats（＝雙方 uid）⇒ 若採信 fallback，任何人都能填對手 uid
    //      換到未遮蔽盤面，遮蔽等於沒做。
    //   ⑧ 認不出座位的（正式賽房）⇒ 兩邊都遮（fail-closed，觀戰端就是走這條）；
    //      沒有 matchId 的測試房（TOURNAMENT-TEST，走 playerId fallback）維持原樣不遮。
    const TREDACT_CARD_ID = '__HIDDEN__';   // 與 /spectate/state 同一個佔位 id
    const TSEAT_NO_REDACT = -2;             // 「這個房不做遮蔽」的哨兵值（測試房）
    function _redactInst(c) {
      const o = { iid: c.iid, cardId: TREDACT_CARD_ID, damage: 0, energyAttached: [] };
      if (c.faceUp) o.faceUp = true;
      return o;
    }
    function _collectStrings(v, out, depth) {
      if (depth > 6 || out.size > 20000) return;
      if (typeof v === 'string') { out.add(v); return; }
      if (Array.isArray(v)) { for (const x of v) _collectStrings(x, out, depth + 1); return; }
      if (v && typeof v === 'object') { for (const k of Object.keys(v)) _collectStrings(v[k], out, depth + 1); }
    }
    function _pendingReveal(gs, seat) {
      const opp = 1 - seat;
      const iids = new Set();
      let oppHandAll = false;
      const list = [];
      if (gs.pendingSelection) list.push(gs.pendingSelection);
      if (Array.isArray(gs.pendingChainQueue)) for (const q of gs.pendingChainQueue) { if (q) list.push(q); }
      for (const ps of list) {
        if (!ps || ps.actorIdx !== seat || ps.sourcePlayerIdx !== opp) continue;
        const params = ps.params || {};
        if (params.concealed === true) continue;
        _collectStrings(params, iids, 0);
        if (ps.type === 'hand-discard' || ps.type === 'hand-choose') oppHandAll = true;
      }
      return { iids: iids, oppHandAll: oppHandAll };
    }
    function _cardHasAttackNamed(inst, atkName) {
      if (!inst) return false;
      const card = TPOOL.get(String(inst.cardId));
      const atks = (card && card.attacks) || [];
      for (const a of atks) { if (a && a.name === atkName) return true; }
      return false;
    }
    function _oppDeckTopReveal(gs, seat) {
      if (!gs || gs.phase !== 'playing' || gs.activePlayerIndex !== seat) return 0;
      const me = gs.players[seat], opp = gs.players[1 - seat];
      if (!me || !opp || !me.active) return 0;
      if (_cardHasAttackNamed(me.active, '高傲指令')) return 10;
      // 狐大盜｜技能大盜（engine gate：手牌 0）可複製對手場上寶可夢的招式；若對手場上有帶
      //   「高傲指令」的寶可夢，同一個 client picker 也需要對手牌庫頂 10 張才畫得出來。
      if (_cardHasAttackNamed(me.active, '技能大盜') && ((me.hand || []).length === 0)) {
        const pokes = [opp.active].concat(opp.bench || []);
        for (const p of pokes) { if (_cardHasAttackNamed(p, '高傲指令')) return 10; }
      }
      return 0;
    }
    function _redactZone(arr, keepIids, keepAll) {
      if (!Array.isArray(arr)) return arr;
      if (keepAll) return arr;
      return arr.map(function (c) { return (c && !keepIids.has(c.iid)) ? _redactInst(c) : c; });
    }
    /**
     * 牌庫專用：遮蔽之外**還要打亂順序**。
     * 為什麼：iid 是刻意保留的（卡片守恆守衛、動畫 diff 都靠它），但棄牌區與場上是公開區 ——
     *   任何「曾經公開過的卡」被效果洗回牌庫後，它的 iid↔卡片對應對方早就知道了。
     *   照原順序回傳牌庫 ⇒ 對手能算出那張卡在牌庫第幾位、還能跨輪詢一路追蹤。
     *   實體遊戲裡洗回去就是不知道位置，這是超出規則的資訊。
     * ⚠ 排序必須是**確定性**的（依 iid 字典序），不能用亂數 —— 同一份盤面每次回應都要給出
     *   同樣的順序，否則 client 每次輪詢都會看到牌庫「換了一批卡」。
     * ⚠ 被放行的卡（pending 點名 / 高傲指令的牌庫頂 N 張）維持**原本的索引**，否則
     *   「牌庫頂 10 張」會指到別的地方。
     */
    function _redactDeckZone(arr, keepIids) {
      if (!Array.isArray(arr)) return arr;
      const hiddenIdx = [];
      for (let i = 0; i < arr.length; i++) { const c = arr[i]; if (c && !keepIids.has(c.iid)) hiddenIdx.push(i); }
      if (hiddenIdx.length === 0) return arr;
      const hidden = hiddenIdx.map(function (i) { return arr[i]; })
        .sort(function (a, b) { return a.iid < b.iid ? -1 : (a.iid > b.iid ? 1 : 0); });
      const out = arr.slice();
      for (let k = 0; k < hiddenIdx.length; k++) out[hiddenIdx[k]] = _redactInst(hidden[k]);
      return out;
    }
    /** 剝除「不是給這個座位看」的 privateMessage；seat 非 0/1（觀戰）⇒ 全部剝除。 */
    function _redactLogForSeat(gs, seat) {
      if (!gs || !Array.isArray(gs.log)) return gs;
      let changed = false;
      const log = gs.log.map(function (e) {
        if (!e || e.privateMessage == null) return e;
        if ((seat === 0 || seat === 1) && e.playerIndex === seat) return e;
        changed = true;
        const o = Object.assign({}, e);
        delete o.privateMessage;
        return o;
      });
      return changed ? Object.assign({}, gs, { log: log }) : gs;
    }
    /** seat: 0/1 = 該座位玩家視角；TSEAT_NO_REDACT = 不遮；其他（-1）= 認不出身分/觀戰 ⇒ 兩邊都遮。 */
    function _redactStateForSeat(gs, seat) {
      if (!gs || !Array.isArray(gs.players) || gs.players.length < 2) return gs;
      if (seat === TSEAT_NO_REDACT) return gs;
      // v6.153 旗標關閉 ⇒ 玩家視角原樣回（＝ v6.149 行為）。觀戰視角（-1）不受旗標影響。
      if ((seat === 0 || seat === 1) && !_redactOn()) return gs;
      if (gs.phase === 'game-over') return gs;
      const mine = (seat === 0 || seat === 1);
      const sides = mine ? [1 - seat] : [0, 1];
      const rv = mine ? _pendingReveal(gs, seat) : { iids: new Set(), oppHandAll: false };
      const topN = mine ? _oppDeckTopReveal(gs, seat) : 0;
      const players = gs.players.slice();
      for (const idx of sides) {
        const p = players[idx];
        if (!p) continue;
        const deckKeep = new Set(rv.iids);
        if (topN > 0 && Array.isArray(p.deck)) for (const c of p.deck.slice(0, topN)) { if (c) deckKeep.add(c.iid); }
        const prizeKeep = new Set(rv.iids);
        if (Array.isArray(p.prizes)) for (const c of p.prizes) { if (c && c.faceUp) prizeKeep.add(c.iid); }
        players[idx] = Object.assign({}, p, {
          hand: _redactZone(p.hand, rv.iids, rv.oppHandAll),
          deck: _redactDeckZone(p.deck, deckKeep),
          prizes: _redactZone(p.prizes, prizeKeep, false),
        });
      }
      return _redactLogForSeat(Object.assign({}, gs, { players: players }), seat);
    }
    /** 玩家端唯一出口：先截 log 再遮（兩者都只做淺層複製，不改 DB 裡的物件）。 */
    function _stateForSeat(gs, seat) { return _redactStateForSeat(_capLog(gs), seat); }
    // ── v6.150 REDACT BLOCK END ──
    /** 請求者在這個房間的座位；正式賽房只認 verified 身分，否則 -1（呼叫端自行決定拒絕或雙邊遮）。 */
    async function _viewerSeat(req, doc) {
      if (!doc || !doc.matchId) return TSEAT_NO_REDACT;   // 測試房：維持原行為
      let id = null;
      try { id = await tournIdentity(req); } catch (e) { id = null; }
      if (!id || id.error || !id.verified || !Array.isArray(doc.seats)) return -1;
      const s = doc.seats.indexOf(id.uid);
      return (s === 0 || s === 1) ? s : -1;
    }
    console.log('[tournament] engine + pool loaded:', TPOOL.size, 'cards');
    // ── A1：身分驗證（重用 admin 既有 firebase-admin + /opt/ptcg/api/firebase-admin-key.json）──
    let TADMIN = null;
    try { TADMIN = (await import('firebase-admin')).default; } catch (e) { console.warn('[tournament] firebase-admin import failed (auth fallback to playerId):', e && e.message); }
    async function tournIdentity(req) {
      const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
      const m = /^Bearer\s+(.+)$/.exec(h);
      if (TADMIN && TADMIN.apps && TADMIN.apps.length && m) {
        try {
          const dec = await TADMIN.auth().verifyIdToken(m[1]);
          if (dec.firebase && dec.firebase.sign_in_provider === 'anonymous') return { error: '錦標賽不開放匿名帳號，請用 email 帳號登入', code: 403 };
          const nm = dec.name || (dec.email ? String(dec.email).split('@')[0] : '玩家');
          return { uid: dec.uid, email: dec.email || null, name: String(nm).slice(0, 24), verified: true };
        } catch (e) { return { error: '登入憑證無效或過期，請重新登入', code: 401 }; }
      }
      const pid = (req.body && req.body.playerId) || (req.query && req.query.playerId);
      if (pid) return { uid: String(pid), email: null, name: String((req.body && req.body.name) || '玩家').slice(0, 24), verified: false };
      return { error: '需要登入', code: 401 };
    }
    // ── v6.291 TOURN VERIFIED GATE BEGIN ──
    /**
     * ⭐⭐⭐v6.291 報名／報到類端點的「身分必須是已驗證」閘。
     *
     * 【漏洞】`tournIdentity` 在**沒有 Bearer token** 時會退回 `req.body.playerId`／
     *   `req.query.playerId` 並回 `verified:false`。那條 fallback 是給**測試房**用的
     *   （/join、/still-here、/action、/reset 才會送 playerId，而 /join、/action、
     *   /still-here 各自有 `doc.matchId && !verified ⇒ 403` 把正式賽房擋掉）。
     *   但 `/register`、`/register-and-checkin`、`/checkin` **從來沒有檢查 `verified`**，
     *   而玩家 uid 又由 `/bracket` 公開回傳 ⇒ 任何人抄一個 uid、用
     *   `playerId=<受害者 uid>` 打 /register 並附上**自己的 60 張牌**，就能把別人報名進去。
     *   受害者本人真的要報名時會撞「你已經報名了（牌組已鎖定，整賽不可更換）」⇒ **報不了名**；
     *   沒發現的話會被排進賽程、**用攻擊者的牌組比賽**。
     *
     * 【⚠⚠⚠ 站長更高的裁定（v6.160）】「本站是練習站，可用性優先於版本一致性，
     *   寧可放一個舊 client 進來也不要把人擋在賽外」⇒ 這道閘擋到真玩家的話，比漏洞本身更慘。
     *   v6.291 逐一核對過所有呼叫點與 git 歷史，確認它對真玩家是 **no-op**：
     *     ① 這三支端點的請求體（tournEnroll／tLateJoin／tCheckinCommit）從 v6.048 至今
     *        **從來沒有帶過 playerId**；帶 playerId 的只有 /still-here、/join、/action、/reset，
     *        那四支不在本閘範圍內、一個字都不動。
     *     ② 拿不到 token 又沒帶 playerId 時，`tournIdentity` 早就回
     *        `{ error: '需要登入', code: 401 }` ⇒ 真玩家在「取不到 token」的情況下
     *        **本來就已經被擋**，本閘沒有讓任何人多被擋一次。
     *     ③ token 過期／無效時 `tournIdentity` 回 401「登入憑證無效或過期，請重新登入」，
     *        也走不到這裡。
     *   ⇒ 唯一會被這道閘擋下的，是「沒有 token 卻硬帶 playerId」的偽造請求。
     *
     * 【HTTP 碼】用 403 而不是 401，理由有二：
     *   ・同一區塊既有的三處相同判斷（/join、/action、/still-here 的
     *     `doc.matchId && !verified`）就是回 403，沿用同一種慣例，不製造第二套判準；
     *   ・401 在這支伺服器已經被 `tournIdentity` 用來表示「憑證無效／過期」，
     *     而 client 的輪詢路徑只把 401 認成 `tAuthLost`（v6.150）—— 兩個訊號分開比較好查。
     *   ⚠ client 的 `tApi` 對非 2xx 一律 throw `${status}: ${body}`，呼叫端會把它顯示在
     *     `tError` ⇒ **不會有無訊息畫面**；所以訊息本身必須寫成「玩家看得懂、知道怎麼自救」。
     *
     * 【log】被擋下來時記一行 `console.warn`，讓站長能在 pm2 log 分辨
     *   「真的有人在冒名」與「我們誤擋了真玩家」。
     *   ⚠ 只記 uid 前 8 碼，**絕不記完整 uid、絕不記 email**（v6.220 隱私紀律）。
     *
     * @param {object|null} id  tournIdentity(req) 的回傳
     * @param {object} res      express response
     * @param {string} ep       端點短名（只進 log，不進回應）
     * @returns {boolean} true ＝ 已經回應完畢，呼叫端必須立刻 `return`
     */
    function tournRequireVerified(id, res, ep) {
      if (id && id.verified === true) return false;
      // ⚠ 前 8 碼足夠讓站長把同一個來源的多次嘗試串起來，又不足以還原身分。
      const _uid8 = String((id && id.uid) || '').slice(0, 8);
      console.warn('[tournament] verified-gate blocked ep=' + ep + ' uid8=' + (_uid8 || '(none)'));
      res.status(403).json({
        error: '請先用 email 帳號登入後再報名／報到；若剛才已經登入過，請重新整理頁面再試一次。',
        code: 'tourn-needs-verified',
      });
      return true;
    }
    // ── v6.291 TOURN VERIFIED GATE END ──

    // ── 工具：用雙方真實牌組建一局完整遊戲（引擎 createGame → setup 階段）──
    function makeGame(decks, names, prefs) {
      const d0 = { name: (names && names[0]) || 'P1', entries: decks[0] };
      const d1 = { name: (names && names[1]) || 'P2', entries: decks[1] };
      const fc = Array.isArray(prefs) ? [prefs[0] || 'random', prefs[1] || 'random'] : ['random', 'random'];
      // v6.057：錦標賽放行互動式開局（伺服器權威；client 送 OPENING_* → 這裡 applyAction）
      //   ⚠需跑 update-tournament.bat 重建 server-engine.cjs 才生效。
      return TENG.createGame(d0, d1, TPOOL, { firstChoicePreferences: fc });
    }
    // ── v6.151 IDLE WARN BLOCK BEGIN ──
    /**
     * v6.151 判負前 60 秒警告的**窗口判斷 + 冪等搶占**。
     * ⚠ 這一段刻意抽成函式而不是寫在 scheduler 迴圈裡：那個迴圈的輕量讀早退
     *   （`if (now <= _lastLight + idleMin * 60000) continue;`）被 v6.119 的守衛用
     *   「輕量讀後 600 字元的窗口」比對字面，把判斷內聯進去會把早退擠出窗口 ⇒ 假紅。
     * ⚠ 冪等判準用 `idleWarnAt < lastAt` 而不是「存在與否」—— 對手一動作 lastActionAt
     *   就前進，**下一個閒置窗口必須能再警告一次**。
     * 回傳「這一次有沒有真的送出警告」（給守衛與測試用）。
     */
    async function maybeIdleWarn60(m, idleMin, now, lastAt) {
      const deadline = lastAt + idleMin * 60000;
      if (!(now > deadline - 60000 && now <= deadline)) return false;
      const claim = await TMATCH.updateOne(
        { _id: m._id, $or: [{ idleWarnAt: { $exists: false } }, { idleWarnAt: { $lt: lastAt } }] },
        { $set: { idleWarnAt: now } });
      if (!claim || claim.modifiedCount !== 1) return false;
      try { await idleWarn60(m, idleMin, now); } catch (e) { console.warn('[tournament] idle warn failed:', e && e.message); }
      return true;
    }
    /**
     * v6.151 閒置判負前 60 秒警告。
     * ① 推播給「該動作的那一方」—— client 連線全掛時 web-push 是唯一到得了的通道。
     * ② 在房間 log 塞一則系統訊息 —— 這會 bump 版本，順便打醒「還活著但版本卡住」的 client
     *    （盤面一變，前端的自癒路徑就會跑）。
     * ⚠ **不動 lastActionAt** —— 動了就等於幫掛機方把閒置倒數重置。
     * ⚠ 讀的是完整 doc（不能用 projection：整包寫回會把 log 永久洗掉，v6.119 教訓）。
     */
    async function idleWarn60(m, idleMin, now) {
      const room = await TROOMS.findOne({ _id: m.roomId });
      const gs = room && room.gameState;
      if (!gs || gs.phase === 'game-over') return;
      const actor = currentActorSeat(gs);
      const targets = [];
      if (actor === 0 || actor === 1) targets.push(actor);
      else if (actor === -1) { targets.push(0); targets.push(1); }   // -1 = 雙方都該動作
      else return;
      const names = [m.p1name, m.p2name];
      const who = (targets.length === 2) ? '雙方' : (names[targets[0]] || '一方');
      const og = JSON.parse(JSON.stringify(gs));
      if (!Array.isArray(og.log)) og.log = [];
      og.log.push({ turn: og.turn || 0, playerIndex: null, timestamp: now,
        message: '\u23f0 ' + who + ' 再約 60 秒未行動就會被判負（閒置 ' + idleMin + ' 分鐘）' });
      // ⚠⚠ 必須 CAS（Fable 5 審查抓到）：這是全檔第一個「**非終局**」的整包寫回。
      //   讀 doc 到寫回之間有數十毫秒窗口，而這個時機（剛要提醒玩家）正是他最可能突然
      //   送出動作的時候。沒有 CAS 會把玩家剛寫進去的動作整個蓋掉，**而且版本號一樣**
      //   （都是 room.version + 1）⇒ client 的 `?v=cv` 版本比對全回 unchanged，
      //   那條自癒完全失效，只剩新鮮度看門狗能救（而本版剛好把它從 8 秒放寬到 20 秒）。
      //   CAS 未命中 ⇒ 對方剛動作過 ⇒ 他根本沒閒置，連推播都不該發。
      const _wr = await TROOMS.updateOne({ _id: m.roomId, version: room.version },
        { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } });
      if (!_wr || _wr.matchedCount === 0) return;
      for (const seat of targets) {
        const uid = (seat === 0) ? m.p1uid : m.p2uid;
        const oppName = (seat === 0) ? m.p2name : m.p1name;
        if (!uid) continue;
        sendPushToUids([uid], {
          title: '\u23f0 剩約 60 秒就會被判負',
          body: '第 ' + m.round + ' 輪對戰' + (oppName ? '（對手：' + oppName + '）' : '') + ' 輪到你行動，請立即回到對戰。',
          tag: 'ptcg-t-idle-' + m._id,
          requireInteraction: true,
        });
      }
    }
    // ── v6.151 IDLE WARN BLOCK END ──

    // ── 伺服器權威 actor gate：防止玩家替對手送動作 ──
    function canSeatAct(gs, seat, action) {
      if (!gs || gs.phase === 'game-over') return false;
      const t = action && action.type;
      const SELF = (action && Object.prototype.hasOwnProperty.call(action, 'senderIdx'))
        || t === 'RESOLVE_SELECTION' || t === 'TAKE_PRIZES' || t === 'SEND_NEW_ACTIVE';
      if (gs.phase === 'setup') return SELF;          // setup 只收自我識別動作
      if (gs.phase !== 'playing') return false;
      if (SELF) return true;
      if (gs.pendingSelection) return gs.pendingSelection.actorIdx === seat;
      if (gs.pendingPrizes && (gs.pendingPrizes[seat] || 0) > 0) return true;
      if (gs.players[seat] && gs.players[seat].active === null) return true;
      return gs.activePlayerIndex === seat;
    }
    // v0.31：閒置判負用 — 算「當前該動作的座位」(沿用 canSeatAct 的優先序)。回傳 0/1；setup 雙方都未完成回 -1；無法判定回 null。
    function currentActorSeat(gs) {
      if (!gs || gs.phase === 'game-over') return null;
      if (gs.phase === 'setup') {
        // v0.62：setup「誰該動作」要和實際 engine gating + UI 提示一致(原 v0.60 用 mulligan 旗標判,但揭示/補抽
        //   其實 gate 在 setupDone 之後,順序不對)。正確：①放出場階段(尚未雙方 setupDone)→ 依 PTCG 規則
        //   mulligan「較少」方先放戰鬥場+按準備,較多方需等(engine PLACE_ACTIVE 擋 myMul>oppMul && !setupDone[opp])
        //   →較少方未準備=較少方該動(較多方在等);②雙方都 setupDone 後才進揭示確認/補抽,欠者該動。
        const sd0 = !!(gs.setupDone && gs.setupDone[0]), sd1 = !!(gs.setupDone && gs.setupDone[1]);
        // v6.053 批4：互動式開局（閃焰王牌｜瞬間爆發力）尚未定案 → 該動作的是「還要做選擇」那一側。
        //   ⚠必須排在下面的 mulligan 次數比較之前。實測（v6.053 前的碼）：
        //     openingChoicePending=[true,false]、mulliganCounts=[1,0]、雙方 setupDone=false 時，
        //     舊邏輯走 m0!==m1 分支回傳 lessIdx=1 —— 但座位 1 已經選完在等，且被引擎的
        //     opening gate 擋住什麼都不能做 → 3 分鐘後**等待方**被誤判閒置敗。
        //     這是 v0.60/v0.62/v0.67/v0.74 同款事故的第五種路徑。
        //   ⚠判準含「尚未 setupDone」：舊版 client 沒有 opening 流程，會直接 PLACE_ACTIVE +
        //     FINISH_SETUP，它的 openingChoicePending 永遠停在 true；只看 pending 會把
        //     「其實已經完成」的舊 client 誤判成掛機（與引擎 effectiveOpeningDone 同一判準）。
        //   ⚠與前端 setupActorSeat 逐行同步。
        const oc = gs.openingChoicePending;
        const oPend0 = !!(oc && oc[0]) && !sd0;
        const oPend1 = !!(oc && oc[1]) && !sd1;
        if (oPend0 || oPend1) {
          if (oPend0 && !oPend1) return 0;
          if (oPend1 && !oPend0) return 1;
          return -1;
        }
        const pmd = gs.pendingMulliganDraw || [0, 0];
        const mrc = gs.mulliganRevealConfirmed || [true, true];
        const mpb = gs.mulliganPostBenchOpen || [false, false];
        // v5.911：mulligan 補抽後加備戰(mpb) 是「已按過準備、擁有者必須完成」的動作。
        //   v0.74 修:但若【對手尚未 setupDone(還欠放出場)】則對手也欠必要動作→回 -1(雙方都該動作;
        //   -1 時 isMyTurn 雙方皆 true→mpb 擁有者仍拿得到按鈕[不回歸 v5.911]、對手放置 UI 也啟用[解 deadlock];
        //   閒置判負對 -1 不單判任一方,待在線方動作後 actor 自動收斂到掛機方座位再單判)。對手已 setupDone 才由 mpb 擁有者單獨。
        const p0mpb = !!mpb[0], p1mpb = !!mpb[1];
        if (p0mpb || p1mpb) { if (p0mpb && !p1mpb) return sd1 ? 0 : -1; if (p1mpb && !p0mpb) return sd0 ? 1 : -1; return -1; }
        if (!(sd0 && sd1)) {
          const m0 = (gs.mulliganCounts && gs.mulliganCounts[0]) || 0;
          const m1 = (gs.mulliganCounts && gs.mulliganCounts[1]) || 0;
          if (m0 === m1) { if (!sd0 && !sd1) return -1; return !sd0 ? 0 : 1; }
          const lessIdx = m0 < m1 ? 0 : 1;
          if (!(lessIdx === 0 ? sd0 : sd1)) return lessIdx;
          const moreIdx = 1 - lessIdx;
          if (!(moreIdx === 0 ? sd0 : sd1)) return moreIdx;
        }
        const owes = (i) => (Number(pmd[i]) > 0) || !mrc[i];
        if (owes(0) || owes(1)) {
          const b0 = owes(0), b1 = owes(1);
          if (b0 && !b1) return 0;
          if (b1 && !b0) return 1;
          return -1;
        }
        return -1;
      }
      if (gs.phase !== 'playing') return null;
      if (gs.pendingSelection && (gs.pendingSelection.actorIdx === 0 || gs.pendingSelection.actorIdx === 1)) return gs.pendingSelection.actorIdx;
      if (gs.pendingPrizes && (gs.pendingPrizes[0] || 0) > 0) return 0;
      if (gs.pendingPrizes && (gs.pendingPrizes[1] || 0) > 0) return 1;
      if (gs.players && gs.players[0] && gs.players[0].active === null) return 0;
      if (gs.players && gs.players[1] && gs.players[1].active === null) return 1;
      return (gs.activePlayerIndex === 0 || gs.activePlayerIndex === 1) ? gs.activePlayerIndex : null;
    }
    // ════════════════════════════════════════════════════════════════════════
    // v1.03 ⭐ 休閒線上對戰「閒置自動判負」（Wilson 裁定：改成伺服器自動判，門檻沿用房主設定）
    // ════════════════════════════════════════════════════════════════════════
    // 玩家回報：一般（休閒）對戰遇到掛機的人，掛十分鐘都沒有任何結果。
    //
    // 為什麼會這樣（三個獨立斷點，任一個都足以致死）：
    //   ① 休閒原本只有「手動宣告」制：等待方要自己按「宣告對手棄權獲勝」。
    //   ② 那個按鈕**只渲染在桌機版面**，手機直式版完全沒有（同版一併補上）。
    //   ③ 對戰中 client 不送心跳（v2.83 為避免與 pushGameState race），而「對手掛機、我在等」
    //      時雙方都零寫入 ⇒ 房間的 updatedAt 不再更新 ⇒ **startZombieRoomCleanup 在 5 分鐘後
    //      把整個房間刪掉**。房沒了之後按宣告鈕只會拿到「對手其實已經行動了」的錯誤訊息，
    //      沒有人被判勝負、掛機者零代價。這就是「掛十分鐘沒結果」的完整解釋。
    //
    // ⭐ 中央收斂：判「現在該誰動作」**直接複用錦標賽的 currentActorSeat**（同一個 scope）。
    //    那個函式已被 v0.60/v0.62/v0.67/v0.74/v6.053 五次事故淬鍊過，正確處理
    //    setup／mulligan 不對稱／互動式開局（閃焰王牌）各子階段 —— 休閒過去的判定
    //    （前端 _waitingOnOpp）從未跟上這些修正，正是「開局掛機完全無解」的原因。
    //    ⚠ 絕對不要在這裡另寫一份判定，那就是新一輪漂移的開始。
    //
    // 安全設計：
    //   ・actor 為 -1（雙方都該動作）或 null（判不出來）→ **不判**，留給殭屍清掃。
    //   ・只把房間寫成 game-over + status:'ended'（**不刪房**），雙方都能看到結果畫面。
    //   ・門檻＝房主設定的 idleTimeoutSec（60~300，預設 180），與畫面上那行說明一致。
    //   ・多加 15 秒緩衝，避免和前端「剛好在門檻邊緣送出動作」打架。
    (function startCasualIdleForfeit() {
      const TICK_MS = 30 * 1000;          // 每 30 秒掃一次（門檻最短 60 秒，取樣要夠密）
      const GRACE_MS = 15 * 1000;         // 門檻外的緩衝
      let running = false;                // 重入鎖：DB 慢查詢時不讓兩個 tick 重疊
      async function sweepCasualIdle() {
        if (running) return;
        if (typeof db === 'undefined' || !db) return;
        running = true;
        try {
          const now = Date.now();
          // 只看對戰中、且至少已經超過最短門檻（60s）的房，避免每 tick 撈全部
          const rooms = await db.collection('rooms').find(
            { status: 'playing', updatedAt: { $lt: now - 60000 } },
            { projection: { _id: 1, gameState: 1, _version: 1, updatedAt: 1, idleTimeoutSec: 1 } }
          ).limit(200).toArray();
          for (const room of rooms) {
            const gs = room && room.gameState;
            if (!gs || gs.phase === 'game-over') continue;
            const sec = Math.min(300, Math.max(60, Number(room.idleTimeoutSec) || 180));
            if (now <= (room.updatedAt || 0) + sec * 1000 + GRACE_MS) continue;
            const actor = currentActorSeat(gs);
            // -1（雙方都欠動作）/ null（判不出）→ 不判任何一方
            if (actor !== 0 && actor !== 1) continue;
            const winSeat = (1 - actor);
            const nameOf = (i) => (gs.players && gs.players[i] && gs.players[i].name) || ('P' + (i + 1));
            const loserName = nameOf(actor), winnerName = nameOf(winSeat);
            const mins = Math.round(sec / 60 * 10) / 10;
            const reason = loserName + ' 閒置逾 ' + mins + ' 分鐘無動作，' + winnerName + ' 獲勝';
            const og = JSON.parse(JSON.stringify(gs));
            og.phase = 'game-over';
            og.winner = winSeat;
            og.winReason = reason;
            og.log = (Array.isArray(og.log) ? og.log : []).concat([
              { turn: og.turn, playerIndex: null, message: '⏰ ' + reason },
            ]);
            // ⚠⚠ 休閒房的版本欄位是 **_version**（不是 version，那是錦標賽 TROOMS 的欄位名）。
            //   client 的輪詢只在 `room._version !== lastVersion` 才回呼（oracle-client.ts），
            //   而且 server 對 ?since=_version 相同時直接回 204 無 body。
            //   ⇒ 沒 bump _version 的話：判負寫進 DB 了，但**兩邊玩家都看不到結果**，
            //     而且掛機者醒來時用舊 _version 當 expectedVersion 的 PUT 還會把 game-over 整包蓋回 playing。
            // ⚠ 樂觀鎖同時比對 updatedAt + _version：這一輪讀到之後對方若剛好動作了，更新不會命中，
            //   下一輪 tick 用新值重算 —— 不會誤判剛好在邊緣行動的人。
            await db.collection('rooms').updateOne(
              { _id: room._id, updatedAt: room.updatedAt, _version: room._version, status: 'playing' },
              { $set: { gameState: og, status: 'ended', _version: (room._version || 0) + 1, updatedAt: now } }
            );
            console.log('[casual-idle] ' + room._id + ' → ' + reason);
          }
        } catch (err) {
          console.warn('[casual-idle] sweep error:', (err && err.message) || err);
        } finally {
          running = false;
        }
      }
      console.log('[casual-idle] v1.0 已啟動：休閒房閒置逾房主設定（60~300 秒）自動判負，每 30 秒掃一次');
      setTimeout(() => { sweepCasualIdle(); setInterval(sweepCasualIdle, TICK_MS); }, 20 * 1000);
    })();

    // 強制 senderIdx/playerIdx = 自己 seat，防偽造替對手操作
    function normalizeAction(action, seat) {
      const a = Object.assign({}, action);
      if (Object.prototype.hasOwnProperty.call(a, 'senderIdx')) a.senderIdx = seat;
      if (a.type === 'TAKE_PRIZES') a.playerIdx = seat;
      if ((a.type === 'RESOLVE_SELECTION' || a.type === 'SEND_NEW_ACTIVE') && a.senderIdx == null) a.senderIdx = seat;
      return a;
    }
    // doc：{ _id, seats:[pid0,pid1], names:[n0,n1], decks:[e0,e1], gameState, version, updatedAt }
    function freshDoc(room) {
      return { _id: room, seats: [null, null], names: [null, null], decks: [null, null], gameState: null, version: 0, updatedAt: Date.now() };
    }
    async function maybeStartGame(room, doc) {
      if (doc.gameState) return doc;
      if (doc.seats[0] && doc.seats[1] && doc.decks[0] && doc.decks[1]) {
        let gs;
        try { gs = makeGame(doc.decks, doc.names); }
        catch (e) { throw new Error('建立對局失敗(牌組可能含未支援卡): ' + (e && e.message)); }
        const nv = (doc.version || 0) + 1;
        await TROOMS.updateOne({ _id: room }, { $set: { gameState: gs, version: nv, updatedAt: Date.now() } });
        doc.gameState = gs; doc.version = nv;
      }
      return doc;
    }

    // ── gzip 壓縮 ─────────────────────────────────────────────────────────────
    // v0.72 起:回應多為 JSON(盤面/大廳/聊天/房間),gzip 壓縮率 ~6-9×,大幅省頻寬。
    //   ①防呆:compression 套件未安裝→try/catch 略過,不影響服務(VM 需 npm install compression 才生效)。
    //   ②threshold 1KB:精簡回應(v0.68 unchanged、204、{ok:true})免壓,省 CPU。
    //   ③瀏覽器自動送 Accept-Encoding:gzip 並自動解壓,前端無需改。
    //   ④zlib 的壓縮是跑在 libuv threadpool、不是 event loop ⇒ 不會把 event loop 拖住。
    //
    // ⚠⚠⚠ v1.11(v6.178)真正的修正:**把 compression 搬到第一個路由之前**。
    //   v0.75 只修好了「載入」(ESM host 沒有 require),沒有修「順序」:
    //   oracle_admin_update.sh 把整段 patch 插在 `app.listen()` 之前,而休閒對戰的
    //   `/api/rooms`、`/api/rooms/:code`(含 PUT/DELETE/messages)全部是在 start() 裡、
    //   遠早於本段就 app.get/app.put 註冊完的。Express 依 **註冊順序** 逐層走 layer,
    //   掛在 stack 尾端的 compression 對這些路由永遠輪不到 —— 它們在更前面就把回應 end 掉了。
    //   ⇒ 佔全站 94% 流量的休閒對戰從頭到尾沒有 gzip:實測 /api/rooms/:CODE 26.9KB/req、
    //     /api/rooms 11.8KB/req,而有 gzip 的 /api/tournament/state 只有 1.9KB/req。
    //   修法:app.use 之後,把剛掛上的那個 layer 從 stack 尾端搬到 **第一個 route layer 之前**。
    //   ⚠ 為什麼是「第一個 route 之前」而不是 index 0:stack 最前面是 Express 自己的
    //     query / expressInit,接著才是 cors / express.json。expressInit 才會把 express 的
    //     request 原型(req.path 等)裝上去;插在它們之前會拿到還沒被 express 加工過的 req。
    //     插在第一個 app.get/app.post 之前,同時滿足「在所有路由之前」與「在內建 middleware 之後」。
    //   ⚠ 所以 filter 內一律用 req.originalUrl / req.url(原生 http 就有),**不准用 req.path**。
    //   ⚠ 搬不動(拿不到 stack、或找不到任何 route layer)就原樣留在尾端並 warn ——
    //     退化成 v0.75 行為(錦標賽有 gzip、休閒沒有),絕不因此讓服務起不來。
    //   ⚠ SSE 一律不壓(gzip 會緩衝,即時串流會被打死):
    //     ①Content-Type text/event-stream ②路徑以 /stream 結尾
    //       (/api/rooms/:code/stream、/api/rooms/:code/messages/stream)。
    //     兩條都要,因為 filter 是在寫 header 時才跑,不能只賭 Content-Type 一定已經設好。
    //   驗證:pm2 log 會有一行 `[tournament] gzip ... hoisted=true`;false 就是沒生效。
    // >>> PTCG-GZIP-HOIST-BLOCK-START  (守衛 test-v6178-rooms-gzip-hoist.mjs 會把這一段抽出來實跑)
    try {
      // v0.75 根因修:整段 patch 包在 import(...).then(async () => {}) 內 = ESM host,沒有 require。
      //   比照上方 TENG 載入:try require(CJS host) → catch 用 dynamic import(ESM host,default=compression 函式,含 .filter)。
      let _compression;
      try { _compression = require('compression'); }
      catch (_eReq) { _compression = (await import('compression')).default; }
      const _gzipMw = _compression({
        // v1.16(v6.216)①: 壓縮等級固定 1(zlib 最快檔)。不設時 zlib 預設 level 6,CPU 成本約為
        //   level 1 的 2~3 倍;而輪詢 JSON 這種高重複文本 level 1 仍有 ~5-7× 壓縮率(體積約 +15%)。
        //   尖峰 115 req/s 幾乎全是輪詢 ⇒ 整機壓縮 CPU 直接砍半以上,回應體積端玩家無感。
        level: 1,
        threshold: 1024,
        filter: (req, res) => {
          const _ct = String((res && res.getHeader && res.getHeader('Content-Type')) || '');
          if (_ct.includes('text/event-stream')) return false;
          const _url = String((req && (req.originalUrl || req.url)) || '');
          const _path = _url.split('?')[0];
          if (/\/stream$/.test(_path)) return false;
          return _compression.filter(req, res);
        },
      });
      app.use(_gzipMw);
      // 把剛掛上的 layer 搬到第一個 route layer 之前(Express 4 = app._router,Express 5 = app.router;
      // ⚠ Express 4 的 app.router 是會 throw 的 deprecated getter,所以一律先試 _router 且各自包 try)。
      let _stack = null;
      try { _stack = (app._router && app._router.stack) || null; } catch (_e1) { _stack = null; }
      if (!_stack) { try { _stack = (app.router && app.router.stack) || null; } catch (_e2) { _stack = null; } }
      let _hoisted = false, _firstRouteIdx = -1;
      if (Array.isArray(_stack)) {
        const _selfIdx = _stack.map((l) => (l && l.handle)).lastIndexOf(_gzipMw);
        _firstRouteIdx = _stack.findIndex((l) => !!(l && l.route));
        if (_selfIdx > 0 && _firstRouteIdx >= 0 && _firstRouteIdx < _selfIdx) {
          const _layer = _stack.splice(_selfIdx, 1)[0];
          _stack.splice(_firstRouteIdx, 0, _layer);
          _hoisted = true;
        }
      }
      console.log('[tournament] gzip compression enabled (v1.11) hoisted=' + _hoisted
        + ' firstRouteIdx=' + _firstRouteIdx
        + ' stackLen=' + (Array.isArray(_stack) ? _stack.length : -1));
      if (!_hoisted) {
        console.warn('[tournament] gzip 沒能搬到路由之前 —— /api/rooms/* 仍不會被壓縮(退化成 v0.75 行為)');
      }
    } catch (e) {
      console.warn('[tournament] gzip 啟用失敗,略過(不影響服務):', e && e.message);
    }
    // <<< PTCG-GZIP-HOIST-BLOCK-END

    // ── v1.16(v6.216)② 休閒對戰聊天輪詢增量化 ────────────────────────────────────────
    // 背景:休閒對戰聊天每 1.5s GET /api/rooms/:code/messages 抓全量 100 則,而絕大多數時間
    //   根本沒有新訊息(v6.178 實測休閒對戰佔全站 94% 流量)。
    // 作法:client(v6.216+)帶 ?since=<最後一則 createdAt(ms)>。本 middleware 只用
    //   findOne+projection 判斷「有沒有比 since 新的訊息」(比全量查詢+序列化便宜一個量級):
    //   - 沒有 → 直接回 204(零 body) ⇒ 聊天輪詢絕大多數請求由數 KB JSON 變成 204。
    //   - 有   → next() 交給既有端點回全量(格式/排序/limit 與舊行為逐字一致,前端合併零改動)。
    // ⚠ fail-open 三層:舊 client 不帶 since / since 解析不了 / middleware 內任何錯誤
    //   → 一律 next() 走既有全量端點,舊版聊天絕不會壞。
    // ⚠ 與 v1.11 gzip 同手法 hoist 到第一個 route layer 之前(既有 messages route 註冊在
    //   patch 之前,不搬永遠輪不到);搬不動就 warn 放棄(退化成全量,功能不受影響)。
    // ⚠ hoist 到 route 之前拿不到 express 的 req.query(那是 route 層才保證的)→自己 parse
    //   query string;路徑判斷用 req.originalUrl/req.url,不准用 req.path(v1.11 同一個雷)。
    // >>> PTCG-CHAT-SINCE-BLOCK-START  (守衛 test-v6216-peak-request-reduction.mjs 會把這一段抽出來實跑)
    try {
      const _chatSinceMw = async (req, res, next) => {
        try {
          if (String((req && req.method) || '').toUpperCase() !== 'GET') return next();
          const _url = String((req && (req.originalUrl || req.url)) || '');
          const _qi = _url.indexOf('?');
          const _path = _qi >= 0 ? _url.slice(0, _qi) : _url;
          const _m = /^\/api\/rooms\/([^\/]+)\/messages$/.exec(_path);
          if (!_m) return next();
          const _qs = _qi >= 0 ? _url.slice(_qi + 1) : '';
          let _sinceRaw = null;
          for (const _kv of _qs.split('&')) {
            if (_kv.indexOf('since=') === 0) { _sinceRaw = _kv.slice(6); break; }
          }
          if (_sinceRaw === null || _sinceRaw === '') return next(); // 舊 client 不帶 since → 全量(fail-open)
          const _since = Number(_sinceRaw);
          if (!Number.isFinite(_since) || _since < 0) return next(); // 解析不了 → 全量(fail-open)
          const _code = decodeURIComponent(_m[1]).toUpperCase();
          const _hasNew = await db.collection('messages').findOne(
            { roomCode: _code, createdAt: { $gt: _since } },
            { projection: { _id: 1 } },
          );
          if (_hasNew) return next();      // 有新訊息 → 既有端點回全量(格式不變)
          return res.status(204).end();    // 沒新訊息 → 204 零 body
        } catch (_e) { return next(); }    // 任何錯誤 → fail-open 全量
      };
      app.use(_chatSinceMw);
      let _cs = null;
      try { _cs = (app._router && app._router.stack) || null; } catch (_e1) { _cs = null; }
      if (!_cs) { try { _cs = (app.router && app.router.stack) || null; } catch (_e2) { _cs = null; } }
      let _csHoisted = false;
      if (Array.isArray(_cs)) {
        const _mi = _cs.map((l) => (l && l.handle)).lastIndexOf(_chatSinceMw);
        const _fr = _cs.findIndex((l) => !!(l && l.route));
        if (_mi > 0 && _fr >= 0 && _fr < _mi) {
          const _ly = _cs.splice(_mi, 1)[0];
          _cs.splice(_fr, 0, _ly);
          _csHoisted = true;
        }
      }
      console.log('[rooms] chat since-204 middleware (v1.16) hoisted=' + _csHoisted);
      if (!_csHoisted) {
        console.warn('[rooms] chat since-204 沒能搬到路由之前 —— 聊天維持全量(功能不受影響)');
      }
    } catch (e) {
      console.warn('[rooms] chat since-204 啟用失敗,略過(不影響服務):', e && e.message);
    }
    // <<< PTCG-CHAT-SINCE-BLOCK-END

    // ── v1.17(v6.217)① 休閒大廳列表:合併兩支輪詢+內容未變回 204 ────────────────
    // 背景:大廳頁每 2 秒打兩支 GET /api/rooms?status=lobby / ?status=playing(v6.178 實測
    //   11.8KB/req 級),而列表「對玩家有意義的內容」變動頻率遠低於 2 秒。
    // 作法:client(v6.217+)改打一支 GET /api/rooms?status=lobby,playing[&h=<上次 digest>]。
    //   核心端點會把 'lobby,playing' 當字面值查 ⇒ 必回空陣列,所以這個 query 形狀可以安全
    //   當「新協定哨兵」。本 middleware 攔下它,用 $in 一次查兩種狀態(與核心端點同一份
    //   projection:剔除 seats.deckEntries 與 gameState、limit/sort 同款),算「顯示內容 digest」:
    //   - client 帶的 h 與 digest 相同 → 204(零 body) ⇒ 大廳輪詢絕大多數請求零位元組。
    //   - 不同(或沒帶 h)→ 200 {rooms, combined:true, h}。⚠ combined:true 是 client 用來分辨
    //     「新伺服器合併回應」與「舊伺服器把 'lobby,playing' 當字面值回的空列表」的哨兵,
    //     拿掉它 client 會誤判成不支援而退回兩支舊輪詢(功能沒壞,減量歸零)。
    // ⭐ digest 的方向性(fail-safe):**全欄位都算**(鍵排序後 stringify),只剔除「已知高頻
    //   噪音欄位」——updatedAt/_version(每次心跳與盤面寫入都 bump)與對局內協商欄位
    //   (undoRequest/rematchReady/restartProposed* 等,大廳列表不顯示)。
    //   ⚠ lobby 房的 heartbeats **必須保留**:前端 isLobbyHostDead 靠它把死房從列表移走,
    //     剔了會讓「房主其實還活著」的房被 client 端的舊心跳快照誤判成死房而消失;
    //     playing 房的 heartbeats 剔除(列表顯示用不到,卻每 60 秒 bump 一次)。
    //   漏剔噪音欄位的後果只是「多回幾次 200」(=退化成現狀),永遠不會讓玩家看到過期列表。
    // ⚠ fail-open:非這個 query 形狀/沒帶 Authorization(讓核心 requireAuth 回 401)/任何
    //   錯誤 → 一律 next() 走核心端點;舊 client 的單一 status 輪詢完全不受影響。
    // ⚠ hoist 同 v1.11/v1.16 手法(核心 /api/rooms route 註冊在本 patch 之前,不搬永遠輪
    //   不到);搬不動就 warn 放棄——client 收不到 combined:true 會自動退回兩支舊輪詢。
    // pm2 log 驗證行:`[rooms] combined-list middleware (v1.17) hoisted=true`
    // >>> PTCG-ROOMS-COMBINED-BLOCK-START  (守衛 test-v6217-lobby-combined-and-alert.mjs 會把這一段抽出來實跑)
    try {
      // 大廳列表顯示不需要的「對局內高頻/協商欄位」——digest 一律剔除(⚠ heartbeats 另有
      // lobby/playing 分流,不在此清單)。漏剔=多回 200(現狀);多剔=可能回 stale 列表,禁。
      const _ROOMS_DIGEST_NOISE = ['updatedAt', '_version', 'gameState', 'undoRequest', 'lastUndoApplyAt',
        'rematchReady', 'restartProposed', 'restartProposedAt', 'restartProposalCount', 'restartRejectedAt',
        'returnRoomProposed', 'returnRoomProposedAt', 'returnRoomRejectedAt'];
      // 純函式:列表 → digest 字串(FNV-1a 雙 32bit,零依賴——本檔跑在 ESM host,沒有 require('crypto'))。
      // 碰撞的後果只是「內容變了卻回了一次 204」,而內容再變 digest 就再變,下一發即自癒。
      const _roomsListDigest = (rooms) => {
        let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0;
        const mix = (s) => {
          for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
            h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
          }
        };
        for (const r of (rooms || [])) {
          const t = {};
          for (const k of Object.keys(r || {}).sort()) {
            if (_ROOMS_DIGEST_NOISE.indexOf(k) >= 0) continue;
            if (k === 'heartbeats' && r.status !== 'lobby') continue;  // playing 房心跳=噪音;lobby 房心跳=死房判定資料
            t[k] = r[k];
          }
          mix(JSON.stringify(t) || ''); mix('|');
        }
        return h1.toString(16) + '-' + h2.toString(16) + '-' + (rooms ? rooms.length : 0);
      };
      // v1.20(v6.220):seats[].email 不下發給玩家端(詳見下方 PTCG-ROOMS-OUT 區塊)。
      //   本 middleware 直接回應、輪不到 rooms-out 的 res.json 包裝,所以自帶同款剝除;
      //   digest 仍以未剝除的原 doc 計算(email 不隨時間變動,不影響 204 判定)。
      const _stripSeatEmails17 = (room) => {
        if (!room || typeof room !== 'object' || !Array.isArray(room.seats)) return room;
        let _has = false;
        for (const s of room.seats) { if (s && typeof s === 'object' && s.email != null) { _has = true; break; } }
        if (!_has) return room;
        return { ...room, seats: room.seats.map((s) => (s && typeof s === 'object' && s.email != null) ? { ...s, email: null } : s) };
      };
      const _roomsCombinedMw = async (req, res, next) => {
        try {
          if (String((req && req.method) || '').toUpperCase() !== 'GET') return next();
          const _url = String((req && (req.originalUrl || req.url)) || '');
          const _qi = _url.indexOf('?');
          const _path = _qi >= 0 ? _url.slice(0, _qi) : _url;
          if (_path !== '/api/rooms') return next();
          const _qs = _qi >= 0 ? _url.slice(_qi + 1) : '';
          let _status = null, _h = null;
          for (const _kv of _qs.split('&')) {
            if (_kv.indexOf('status=') === 0) _status = decodeURIComponent(_kv.slice(7));
            else if (_kv.indexOf('h=') === 0) _h = decodeURIComponent(_kv.slice(2));
          }
          if (_status !== 'lobby,playing') return next();  // 舊 client 的單一 status → 核心端點(fail-open)
          // 沒帶 token → 交給核心 requireAuth 回 401(本 middleware 不自己驗簽:大廳列表本來就
          // 對所有匿名登入者開放,這裡只擋「連 header 都沒有」的裸請求,語義與核心端點一致)。
          const _auth = String((req && req.headers && req.headers.authorization) || '');
          if (_auth.indexOf('Bearer ') !== 0) return next();
          const _rooms = await db.collection('rooms')
            .find({ status: { $in: ['lobby', 'playing'] } }, { projection: { 'seats.deckEntries': 0, gameState: 0 } })
            .limit(100).sort({ updatedAt: -1 }).toArray();
          const _dg = _roomsListDigest(_rooms);
          if (_h && _h === _dg) return res.status(204).end();  // 內容沒變 → 零 body
          return res.status(200).json({ rooms: _rooms.map(_stripSeatEmails17), combined: true, h: _dg });
        } catch (_e) { return next(); }  // 任何錯誤 → fail-open 走核心端點
      };
      app.use(_roomsCombinedMw);
      let _rc = null;
      try { _rc = (app._router && app._router.stack) || null; } catch (_e1) { _rc = null; }
      if (!_rc) { try { _rc = (app.router && app.router.stack) || null; } catch (_e2) { _rc = null; } }
      let _rcHoisted = false;
      if (Array.isArray(_rc)) {
        const _mi = _rc.map((l) => (l && l.handle)).lastIndexOf(_roomsCombinedMw);
        const _fr = _rc.findIndex((l) => !!(l && l.route));
        if (_mi > 0 && _fr >= 0 && _fr < _mi) {
          const _ly = _rc.splice(_mi, 1)[0];
          _rc.splice(_fr, 0, _ly);
          _rcHoisted = true;
        }
      }
      console.log('[rooms] combined-list middleware (v1.17) hoisted=' + _rcHoisted);
      if (!_rcHoisted) {
        console.warn('[rooms] combined-list 沒能搬到路由之前 —— client 會自動退回兩支舊輪詢(功能不受影響)');
      }
    } catch (e) {
      console.warn('[rooms] combined-list 啟用失敗,略過(不影響服務):', e && e.message);
    }
    // <<< PTCG-ROOMS-COMBINED-BLOCK-END

    // ── v1.20(v6.220) 休閒房間回應出口統一轉換:log 增量下發 + seats[].email 剝除 ──────
    // 【減量】GET /api/rooms/:code?logSince=<n>&logh=<前綴鏈雜湊>:
    //   gameState.log 佔房間 doc ~60% 且隨對局線性成長,輪詢絕大多數回應的 log 前綴與
    //   client 已有的逐字相同。伺服器對自己 log 的前 n 則算同一鏈雜湊,**相同才**把 log
    //   換成 log.slice(n) 並附 logDelta{since,total,fh}(fh=完整 log 鏈雜湊,client 重組後複驗)。
    //   fail-open 全表:舊 client 不帶參數/解析不了/n 超界(悔棋)/前綴雜湊不同(等長但內容不同)/
    //   gameState 或 log 缺席/任何例外 → 一律回全量,行為與 v6.219 逐字相同。
    // 【隱私】GET /api/rooms/:code、GET /api/rooms、PUT /api/rooms/:code 的回應把 seats[].email
    //   置為 null(DB 內保留;/api/admin/* 不經此層)。配套:PUT 寫入前把 DB 既有 email 回填進
    //   incoming seats(client 是 GET 整包→改→PUT 整包,不回填會把 DB 的 email 洗光)。
    // ⚠ 做法是包裝 res.json(不自己查 DB、不自己驗身分):auth/404/?since=ver 的 204 全部留在
    //   核心端點;本層只轉換「已經要送出去的 body」,轉換途中任何例外 → 原 body 原樣送出。
    // ⚠ hoist 同 v1.11/v1.16/v1.17;req.query 在 route 層之前不可用 → 自己 parse query string;
    //   路徑判斷用 req.originalUrl/req.url,不准用 req.path。
    // ⚠ 兩支 mw 有任一沒 hoist 成功 → _roomsOutActive 維持 false,兩支都自動停用(單純 next()),
    //   避免「GET 已剝 email 但 PUT 沒回填」的半套狀態把 DB 的 email 洗掉。
    // pm2 log 驗證行:`[rooms] rooms-out transform middleware (v1.20) hoisted=true`
    // >>> PTCG-ROOMS-OUT-BLOCK-START  (守衛 test-v6220-log-delta-and-email-privacy.mjs 會把這一段抽出來實跑)
    try {
      let _roomsOutActive = false;  // 兩支 mw 都 hoist 成功才啟用(見上方 ⚠)
      // 純函式:seats[].email → null(shallow copy,不動原 doc;完全沒 email 就原物回傳)
      const _stripSeatEmails = (room) => {
        if (!room || typeof room !== 'object' || !Array.isArray(room.seats)) return room;
        let _has = false;
        for (const s of room.seats) { if (s && typeof s === 'object' && s.email != null) { _has = true; break; } }
        if (!_has) return room;
        return { ...room, seats: room.seats.map((s) => (s && typeof s === 'object' && s.email != null) ? { ...s, email: null } : s) };
      };
      // 純函式:log 前 n 則的鏈雜湊(FNV-1a 雙 32bit;每則 JSON.stringify 逐字元累積、每則之後
      // 混入分隔符)。⚠ 與 client 端 oracle-client.ts 的 logChainHash **逐字元同演算法**,
      // 守衛用同一份資料實跑兩端比對輸出;JSON round-trip(stringify→parse→stringify)保序保值,
      // 所以兩端對同一份 log 必得同雜湊,差一個字元就整包退回全量。
      const _logChainHash = (log, n) => {
        let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0;
        for (let i = 0; i < n; i++) {
          const s = JSON.stringify(log[i]) ?? 'null';
          for (let j = 0; j < s.length; j++) {
            const c = s.charCodeAt(j);
            h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
            h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
          }
          h1 = Math.imul(h1 ^ 10, 16777619) >>> 0;
          h2 = Math.imul(h2 ^ 10, 16777619) >>> 0;
        }
        return h1.toString(16) + '-' + h2.toString(16) + '-' + n;
      };
      // 純函式:對「即將送出的 body」做轉換。任何路徑都回傳完整合法 body;
      // 增量條件不滿足=只剝 email、log 原樣全量。
      const _transformRoomsBody = (body, kind, logSince, logh) => {
        if (!body || typeof body !== 'object') return body;
        if (kind === 'list') {
          if (!Array.isArray(body.rooms)) return body;
          return { ...body, rooms: body.rooms.map(_stripSeatEmails) };
        }
        if (!body.room || typeof body.room !== 'object') return body;
        let room = _stripSeatEmails(body.room);
        let delta = null;
        if (kind === 'get' && logSince !== null && typeof logh === 'string' && logh !== '') {
          const gs = room.gameState;
          const log = gs && Array.isArray(gs.log) ? gs.log : null;
          if (log && Number.isInteger(logSince) && logSince > 0 && logSince <= log.length
              && _logChainHash(log, logSince) === logh) {
            delta = { since: logSince, total: log.length, fh: _logChainHash(log, log.length) };
            room = { ...room, gameState: { ...gs, log: log.slice(logSince) } };
          }
        }
        return delta ? { ...body, room, logDelta: delta } : { ...body, room };
      };
      const _roomsOutMw = (req, res, next) => {
        try {
          if (!_roomsOutActive) return next();
          const _method = String((req && req.method) || '').toUpperCase();
          const _url = String((req && (req.originalUrl || req.url)) || '');
          const _qi = _url.indexOf('?');
          const _path = _qi >= 0 ? _url.slice(0, _qi) : _url;
          let _kind = null;
          if (_path === '/api/rooms' && _method === 'GET') _kind = 'list';
          else if (/^\/api\/rooms\/[^\/]+$/.test(_path)) {
            if (_method === 'GET') _kind = 'get';
            else if (_method === 'PUT') _kind = 'put';
          }
          if (!_kind) return next();
          let _logSince = null, _logh = null;
          if (_kind === 'get' && _qi >= 0) {
            for (const _kv of _url.slice(_qi + 1).split('&')) {
              if (_kv.indexOf('logSince=') === 0) { const _v = Number(_kv.slice(9)); _logSince = Number.isFinite(_v) ? Math.floor(_v) : null; }
              else if (_kv.indexOf('logh=') === 0) { try { _logh = decodeURIComponent(_kv.slice(5)); } catch (_e) { _logh = null; } }
            }
          }
          const _origJson = res.json.bind(res);
          res.json = (body) => {
            let _out = body;
            try { _out = _transformRoomsBody(body, _kind, _logSince, _logh); }
            catch (_e) { _out = body; }   // 轉換失敗 → 原 body 全量送出(fail-open)
            return _origJson(_out);
          };
          return next();
        } catch (_e) { return next(); }
      };
      // PUT 寫入前回填 email(見上方【隱私】配套)。incoming seat 有 uid、沒帶 email,且 DB 同
      // 座位是同一個 uid 且有 email → 回填;uid 不同(換人/離座/清位)一律不回填。
      const _roomsPutKeepEmailMw = async (req, res, next) => {
        try {
          if (!_roomsOutActive) return next();
          if (String((req && req.method) || '').toUpperCase() !== 'PUT') return next();
          const _url = String((req && (req.originalUrl || req.url)) || '');
          const _path = (_url.indexOf('?') >= 0 ? _url.slice(0, _url.indexOf('?')) : _url);
          const _m = /^\/api\/rooms\/([^\/]+)$/.exec(_path);
          if (!_m) return next();
          const _seats = req.body && req.body.data && Array.isArray(req.body.data.seats) ? req.body.data.seats : null;
          if (!_seats) return next();
          let _need = false;
          for (const s of _seats) { if (s && typeof s === 'object' && s.uid && s.email == null) { _need = true; break; } }
          if (!_need) return next();
          const _code = decodeURIComponent(_m[1]).toUpperCase();
          const _cur = await db.collection('rooms').findOne({ _id: _code }, { projection: { 'seats.uid': 1, 'seats.email': 1 } });
          const _old = _cur && Array.isArray(_cur.seats) ? _cur.seats : [];
          for (let i = 0; i < _seats.length; i++) {
            const s = _seats[i], o = _old[i];
            if (s && typeof s === 'object' && s.uid && s.email == null && o && o.uid === s.uid && o.email != null) {
              s.email = o.email;
            }
          }
          return next();
        } catch (_e) { return next(); }   // 回填失敗 → 照常寫入(絕不擋對戰)
      };
      app.use(_roomsOutMw);
      app.use(_roomsPutKeepEmailMw);
      let _ro = null;
      try { _ro = (app._router && app._router.stack) || null; } catch (_e1) { _ro = null; }
      if (!_ro) { try { _ro = (app.router && app.router.stack) || null; } catch (_e2) { _ro = null; } }
      let _roHoisted = 0;
      if (Array.isArray(_ro)) {
        for (const _h of [_roomsOutMw, _roomsPutKeepEmailMw]) {
          const _mi = _ro.map((l) => (l && l.handle)).lastIndexOf(_h);
          const _fr = _ro.findIndex((l) => !!(l && l.route));
          if (_mi > 0 && _fr >= 0 && _fr < _mi) {
            const _ly = _ro.splice(_mi, 1)[0];
            _ro.splice(_fr, 0, _ly);
            _roHoisted++;
          }
        }
      }
      _roomsOutActive = (_roHoisted === 2);
      console.log('[rooms] rooms-out transform middleware (v1.20) hoisted=' + _roomsOutActive);
      if (!_roomsOutActive) {
        console.warn('[rooms] rooms-out 沒能搬到路由之前 —— 兩支一起停用:回應維持全量且 email 照舊(功能不受影響)');
      }
    } catch (e) {
      console.warn('[rooms] rooms-out 啟用失敗,略過(不影響服務):', e && e.message);
    }
    // <<< PTCG-ROOMS-OUT-BLOCK-END

    // ── v1.29(v6.268) 休閒 PUT 上行增量【伺服器端先行;client 下一版才會送】──────────────
    // 背景:v6.245/v6.246 定案「尖峰卡頓慢在**玩家上行**」(nginx 實錄 86.954s 的 409 PUT
    //   request_length=48285;408+upstream=- 的請求根本沒送達 node)。下行 v6.220 已增量化,
    //   上行仍是每次整包 30~48KB。v6.264 沙盒對 1,690 次真實推送重放實測:
    //   兩層欄位 patch + log 只送 append => p50 30.0KB->1.5KB、p90 46.9KB->4.5KB(省 93~96%)。
    // 信任模型不變:伺服器把 patch 套在「DB 現 doc 的 client 視角」上重建**全量**,
    //   以 canonical hash(遞迴排序鍵,免疫 BSON/JS 鍵序漂移)複驗後,把 req.body 改寫成
    //   與舊 client 全量 PUT **同形**的 { data, expectedVersion },原樣交給既有核心 PUT
    //   (CAS/_version bump/長輪詢/回應格式全不動)。**落庫仍是全量 doc,形狀不變。**
    // 協定(client v6.269+ 才會送;本版玩家完全無感):
    //   PUT body = { patchProto:1, expectedVersion:<n>, fullHash:'h1-h2',
    //                patch:{ set:{ '<top>' 或 '<top>.<sub>': 值 }, del:[路徑...], logAppend:[...] } }
    //   回應三態:
    //     版本不符 -> 409 { conflict:true, currentVersion, deltaReject:1, deltaReason:'version' }
    //               (刻意**不回 room** -- 免得繞過 v1.20 的 email 剝除;client 重新 GET 再送全量)
    //     hash 不符/格式不對/停用/任何例外 -> 422 { deltaReject:1, deltaReason:'hash'|'bad-patch'|'disabled'|'error' }
    //     正常 -> 改寫 req.body 後 next() => 核心 PUT 的既有回應 { ok, version, room }
    //   GET /api/rooms/:code 的 { room } 回應加哨兵 deltaPut:1。
    //   ⭐ 伺服器端 kill switch:把下面 _DELTA_PUT_ENABLED 改 false 重佈 => 哨兵消失、
    //   全站 client 自動回全量;殘留的在途 patch PUT 也由本層回 422 deltaReject,
    //   **絕不會流進核心 PUT**(那會變成 400 missing data)。
    // 基底=「client 視角」而不是裸 DB doc:client 看到的 room 是 res.json 序列化 + v1.20
    //   email 剝除後的樣子 => 基底 = JSON round-trip(_dpStripSeatEmails(doc))。重建成功後
    //   再按 v1.20 _roomsPutKeepEmailMw 的同款規則把 email 從 DB doc 回填(同 uid 才回填);
    //   不做回填的話 delta PUT 會把 DB 的 email 洗成 null(v1.20 那支回填 mw 排在本層之前,
    //   看到的還是 patchProto body、幫不上忙)。
    //   ⚠ client 端(下一版)的 fullHash 必須對 JSON.parse(JSON.stringify(newData)) 計算,
    //     與伺服器的 JSON 視角定義一致(undefined 欄位被丟掉、Date 變字串)。
    // fail-open 全表:沒帶 patchProto -> 原樣 next()(舊 client 的 body 逐位元不變);
    //   路徑不匹配(含 /api/tournament/*) -> 原樣 next();帶 patchProto 但任何一步失敗
    //   -> deltaReject(client 改送全量,行為退回 v6.267)。
    // 事件迴圈:套用+雜湊是純 CPU,有三道上限(patch 條數/遞迴深度/雜湊字元數),
    //   超限一律 deltaReject;p99 實測見守衛 test-v6268-delta-put-server.mjs 的 perf 節。
    // >>> PTCG-DELTA-PUT-BLOCK-START  (守衛 test-v6268-delta-put-server.mjs 會把這一段抽出來實跑)
    try {
      const _DELTA_PUT_ENABLED = true;   // ⭐ kill switch:改 false 重佈=全站自動回全量
      const _DP_MAX_SET = 256, _DP_MAX_DEL = 256, _DP_MAX_LOGAPPEND = 512;   // patch 條數上限
      const _DP_MAX_MIX = 1000000;       // canonical hash 工作量上限(字元數;實測 48KB doc 約 5 萬字元)
      const _DP_MAX_DEPTH = 32;          // 遞迴深度上限
      const _dpBadSeg = (s) => (typeof s !== 'string' || s === '' || s.length > 256
        || s === '__proto__' || s === 'constructor' || s === 'prototype');
      // ⭐v1.34(v6.278) 深路徑:段數上限與「總長度」上限(先擋長度才 split,免得惡意超長字串先配置記憶體)。
      //   合法路徑的長度上界 = 8 段 × 256 字元 + 7 個點 = 2055 ⇒ 2100 對**任何合法路徑**都不會誤擋,
      //   對 v1.29 的兩層路徑更是遠遠寬鬆(上界 513)⇒ 舊 client 行為零改變。
      const _DP_MAX_PATH_SEGS = 8, _DP_MAX_PATH_LEN = 2100;
      // ⭐v1.34 陣列索引判定:必須是**規範的**十進位非負整數字串。
      //   拒:'' / '-1' / '+1' / '1.5' / '1e3' / ' 1' / '01'(前導 0) / 超過 9 位數 / 非數字字元。
      //   回傳 -1 表示「不是合法索引」(呼叫端一律 throw ⇒ deltaReject 退全量)。
      const _dpArrIdx = (s) => {
        if (typeof s !== 'string' || s.length === 0 || s.length > 9) return -1;
        for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 48 || c > 57) return -1; }
        if (s.length > 1 && s.charCodeAt(0) === 48) return -1;   // '01' / '007' 一律拒(非規範形式)
        return Number(s);
      };
      // 純函式:seats[].email -> null(與 v1.20 _stripSeatEmails 同款;算 client 視角基底用)
      const _dpStripSeatEmails = (room) => {
        if (!room || typeof room !== 'object' || !Array.isArray(room.seats)) return room;
        let _has = false;
        for (const s of room.seats) { if (s && typeof s === 'object' && s.email != null) { _has = true; break; } }
        if (!_has) return room;
        return { ...room, seats: room.seats.map((s) => (s && typeof s === 'object' && s.email != null) ? { ...s, email: null } : s) };
      };
      // 純函式:canonical hash(FNV-1a 雙 32bit)。物件鍵**遞迴排序**後才餵進雜湊 =>
      //   MongoDB 回傳的鍵序(BSON 插入序)與 client 端物件鍵序不同也得同雜湊;陣列保序。
      //   超過 _DP_MAX_MIX 字元或 _DP_MAX_DEPTH 層 -> throw(呼叫端接住回 deltaReject)。
      const _dpCanonHash = (v) => {
        let h1 = 0x811c9dc5 >>> 0, h2 = 0xcbf29ce4 >>> 0, n = 0;
        const mix = (s) => {
          n += s.length;
          if (n > _DP_MAX_MIX) throw new Error('dp-hash-too-big');
          for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
            h2 = Math.imul(h2 ^ ((c + 131) & 0xffff), 16777619) >>> 0;
          }
        };
        const ser = (x, d) => {
          if (d > _DP_MAX_DEPTH) throw new Error('dp-hash-too-deep');
          if (x === null || x === undefined) { mix('n'); return; }
          const t = typeof x;
          if (t === 'boolean') { mix(x ? 't' : 'f'); return; }
          if (t === 'number') { mix(Number.isFinite(x) ? 'd' + String(x) : 'n'); return; }
          if (t === 'string') { mix('s' + JSON.stringify(x)); return; }
          if (Array.isArray(x)) { mix('['); for (const it of x) { ser(it, d + 1); mix(','); } mix(']'); return; }
          if (t === 'object') {
            const ks = Object.keys(x).sort();
            mix('{');
            for (const k of ks) {
              if (x[k] === undefined) continue;   // JSON.stringify 會丟掉 undefined 欄位 => 兩端視角一致
              mix(JSON.stringify(k) + ':'); ser(x[k], d + 1); mix(',');
            }
            mix('}');
            return;
          }
          mix('n');   // function/symbol 等不該出現的型別 -> 當 null(JSON 視角)
        };
        ser(v, 0);
        return h1.toString(16) + '-' + h2.toString(16);
      };
      // 純函式:把 patch 套在 base 上(就地改;base 必須是私有 clone)。
      //   ⭐v1.34(v6.278):路徑由「最多兩層」放寬到最多 _DP_MAX_PATH_SEGS(8)段,並支援**陣列索引**
      //   (gameState.players.0.hand / gameState.players.1.active.damage)。
      //   ⚠⚠ **向後相容是硬約束**:segs<=2 的分支與 v1.29 **逐字相同**(連 undefined/null 自動建物件
      //   這個舊語義都保留),舊 client(v6.270~v6.277)的 patch 因此逐位元不變。
      //   深路徑(segs>=3)才走新的走訪器,規則全部 fail-closed —— 任何一條不符一律 throw,
      //   呼叫端回 deltaReject,client 改送全量(=今天已在線上跑的路徑,絕不會比 BASE 更糟)。
      const _dpApplyPatch = (base, patch) => {
        const set = patch && typeof patch === 'object' ? patch.set : null;
        const del = patch && typeof patch === 'object' ? patch.del : null;
        const logAppend = patch && typeof patch === 'object' ? patch.logAppend : null;
        if (set != null && (typeof set !== 'object' || Array.isArray(set))) throw new Error('dp-bad-set');
        if (del != null && !Array.isArray(del)) throw new Error('dp-bad-del');
        if (logAppend != null && !Array.isArray(logAppend)) throw new Error('dp-bad-logappend');
        const delArr = del || [], setKeys = set ? Object.keys(set) : [], appendArr = logAppend || [];
        if (setKeys.length > _DP_MAX_SET || delArr.length > _DP_MAX_DEL || appendArr.length > _DP_MAX_LOGAPPEND) throw new Error('dp-too-many');
        const splitPath = (p) => {
          if (typeof p !== 'string') throw new Error('dp-bad-path');
          if (p.length > _DP_MAX_PATH_LEN) throw new Error('dp-bad-path');   // 先擋長度再 split
          const segs = p.split('.');
          if (segs.length > _DP_MAX_PATH_SEGS) throw new Error('dp-bad-path');
          // _dpBadSeg 已擋 ''/超長/__proto__/constructor/prototype;split 後每段必無 '.'
          for (const s of segs) { if (_dpBadSeg(s)) throw new Error('dp-bad-path'); }
          return segs;
        };
        // ⭐v1.34 走到「最後一段的父節點」。六道防護的①②在這裡:
        //   ①中間節點**必須已經存在**且是物件或陣列 —— 絕不自動建(自動建=憑空生出盤面);
        //   ②父節點是陣列時 segment 必須是規範非負整數字串且 < 既有長度(禁擴張、禁 sparse)。
        const _dpParentOf = (root, segs) => {
          let cur = root;
          for (let i = 0; i < segs.length - 1; i++) {
            const s = segs[i];
            if (Array.isArray(cur)) {
              const idx = _dpArrIdx(s);
              if (idx < 0 || idx >= cur.length) throw new Error('dp-bad-index');
              cur = cur[idx];
            } else if (cur !== null && typeof cur === 'object') {
              // hasOwnProperty:絕不沿著原型鏈走(toString/valueOf 之類一律當「不存在」)
              if (!Object.prototype.hasOwnProperty.call(cur, s)) throw new Error('dp-missing-node');
              cur = cur[s];
            } else {
              throw new Error('dp-set-into-nonobject');
            }
            if (cur === null || typeof cur !== 'object') throw new Error('dp-set-into-nonobject');
          }
          return cur;
        };
        for (const p of delArr) {
          const segs = splitPath(p);
          if (segs.length === 1) { delete base[segs[0]]; continue; }
          if (segs.length === 2) {   // ⚠ 兩層:與 v1.29 逐字相同(含「父不是純物件就靜默略過」)
            const o = base[segs[0]];
            if (o && typeof o === 'object' && !Array.isArray(o)) delete o[segs[1]];
            continue;
          }
          const par = _dpParentOf(base, segs);
          // ④父節點是陣列時**禁止 del** —— delete arr[i] 會留一個洞(sparse array)
          if (Array.isArray(par)) throw new Error('dp-del-into-array');
          delete par[segs[segs.length - 1]];
        }
        for (const p of setKeys) {
          const segs = splitPath(p);
          if (segs.length === 1) { base[segs[0]] = set[p]; continue; }
          if (segs.length === 2) {   // ⚠ 兩層:與 v1.29 逐字相同(含 undefined/null 自動建物件的舊語義)
            let o = base[segs[0]];
            if (o === undefined || o === null) { o = {}; base[segs[0]] = o; }
            if (typeof o !== 'object' || Array.isArray(o)) throw new Error('dp-set-into-nonobject');
            o[segs[1]] = set[p];
            continue;
          }
          const par = _dpParentOf(base, segs);
          const last = segs[segs.length - 1];
          if (Array.isArray(par)) {
            // ③寫進陣列:索引必須合法且**在既有長度內** => 陣列不會變物件、不會 sparse、不會被擴張。
            //   長度真的要變(例如備戰加一隻)時,client 一律改送**整個陣列當一個值**
            //   (那是「對父物件的一次 set」,走的是上面的 par[last]=… 或兩層分支),不走這裡。
            const idx = _dpArrIdx(last);
            if (idx < 0 || idx >= par.length) throw new Error('dp-bad-index');
            par[idx] = set[p];
            continue;
          }
          par[last] = set[p];
        }
        if (appendArr.length > 0) {
          const gs = base.gameState;
          if (!gs || typeof gs !== 'object' || !Array.isArray(gs.log)) throw new Error('dp-no-log');
          gs.log = gs.log.concat(appendArr);
        }
        return base;
      };
      const _dpMw = async (req, res, next) => {
        try {
          const _method = String((req && req.method) || '').toUpperCase();
          const _url = String((req && (req.originalUrl || req.url)) || '');
          const _qi = _url.indexOf('?');
          const _path = _qi >= 0 ? _url.slice(0, _qi) : _url;
          const _m = /^\/api\/rooms\/([^\/]+)$/.exec(_path);
          if (!_m) return next();   // 含 /api/tournament/* 在內,一律原樣通過
          if (_method === 'GET') {
            // 哨兵:只在啟用時、且回應是 { room } 形狀時加(404/204/list 都不動)。
            // ⚠⚠ deltaPut **必須維持 1**:v6.270 client 的判斷是 `b.deltaPut === 1` 嚴格比較
            //   (src/lib/game/oracle-client.ts 的 _noteDeltaPutSentinel),改成 2 會讓
            //   v6.270~v6.277 全部靜默退回全量 = 上行位元組數倒退。深路徑另掛 deltaPutDeep:1,
            //   舊 client 對多出來的 key 完全無感(守衛抽它的判斷式實跑證明)。
            if (!_DELTA_PUT_ENABLED) return next();
            try {
              const _oj = res.json.bind(res);
              res.json = (body) => (body && typeof body === 'object' && body.room && typeof body.room === 'object')
                ? _oj({ ...body, deltaPut: 1, deltaPutDeep: 1 }) : _oj(body);
            } catch (_e) { /* 包不上就算了 => 沒有哨兵 = client 視同不支援(全量) */ }
            return next();
          }
          if (_method !== 'PUT') return next();
          const _b = req.body;
          if (!_b || typeof _b !== 'object' || _b.patchProto !== 1) return next();   // 舊 client:逐位元原樣通過
          // ── 從這裡起是 delta PUT:任何失敗都回 deltaReject,絕不流進核心 PUT ──
          if (!_DELTA_PUT_ENABLED) return res.status(422).json({ deltaReject: 1, deltaReason: 'disabled' });
          const _ev = _b.expectedVersion;
          if (!Number.isInteger(_ev) || _ev < 1) return res.status(422).json({ deltaReject: 1, deltaReason: 'bad-patch' });
          if (typeof _b.fullHash !== 'string' || !/^[0-9a-f]{1,8}-[0-9a-f]{1,8}$/.test(_b.fullHash)
              || !_b.patch || typeof _b.patch !== 'object') {
            return res.status(422).json({ deltaReject: 1, deltaReason: 'bad-patch' });
          }
          const _code = decodeURIComponent(_m[1]).toUpperCase();
          const _doc = await db.collection('rooms').findOne({ _id: _code });
          if (!_doc || _doc._version !== _ev) {
            return res.status(409).json({ conflict: true, currentVersion: _doc ? (_doc._version ?? null) : null, deltaReject: 1, deltaReason: 'version' });
          }
          // 基底=client 視角(JSON round-trip = res.json 的序列化基準;email 剝除同 v1.20)
          const _base = JSON.parse(JSON.stringify(_dpStripSeatEmails(_doc)));
          const _rebuilt = _dpApplyPatch(_base, _b.patch);
          if (_dpCanonHash(_rebuilt) !== _b.fullHash) {
            return res.status(422).json({ deltaReject: 1, deltaReason: 'hash' });
          }
          // email 回填(v1.20 _roomsPutKeepEmailMw 同款規則:同 uid 且 DB 有 email 才回填)
          if (Array.isArray(_rebuilt.seats) && Array.isArray(_doc.seats)) {
            for (let i = 0; i < _rebuilt.seats.length; i++) {
              const s = _rebuilt.seats[i], o = _doc.seats[i];
              if (s && typeof s === 'object' && s.uid && s.email == null && o && typeof o === 'object' && o.uid === s.uid && o.email != null) {
                s.email = o.email;
              }
            }
          }
          // 改寫成與舊 client 全量 PUT 同形,交給既有核心 PUT(CAS/_version bump/回應全不動)
          req.body = { data: _rebuilt, expectedVersion: _ev };
          return next();
        } catch (_e) {
          // fail-open:帶 patchProto 的一律 deltaReject(client 改送全量);其餘原樣通過
          try {
            if (req && req.body && typeof req.body === 'object' && req.body.patchProto === 1 && res && !res.headersSent) {
              return res.status(422).json({ deltaReject: 1, deltaReason: 'error' });
            }
          } catch (_e2) { /* fallthrough */ }
          return next();
        }
      };
      app.use(_dpMw);
      // hoist 到第一個 route layer 之前(同 v1.11/v1.16/v1.17/v1.20 的成熟手法;
      // 核心 /api/rooms 路由註冊在本 patch 之前,不搬永遠輪不到)
      let _dps = null;
      try { _dps = (app._router && app._router.stack) || null; } catch (_e1) { _dps = null; }
      if (!_dps) { try { _dps = (app.router && app.router.stack) || null; } catch (_e2) { _dps = null; } }
      let _dpHoisted = false;
      if (Array.isArray(_dps)) {
        const _mi = _dps.map((l) => (l && l.handle)).lastIndexOf(_dpMw);
        const _fr = _dps.findIndex((l) => !!(l && l.route));
        if (_mi > 0 && _fr >= 0 && _fr < _mi) {
          const _ly = _dps.splice(_mi, 1)[0];
          _dps.splice(_fr, 0, _ly);
          _dpHoisted = true;
        }
      }
      console.log('[rooms] delta-put middleware (v1.29) hoisted=' + _dpHoisted + ' enabled=' + _DELTA_PUT_ENABLED
        + ' deepSegs=' + _DP_MAX_PATH_SEGS);   // ⭐v1.34:前綴逐字保留(test-v6268 A1 靠它定位)
      if (!_dpHoisted) {
        console.warn('[rooms] delta-put 沒能搬到路由之前 -- 哨兵不會出現、殘留 patch PUT 會被核心端點 400(client 退回全量);服務不受影響');
      }
    } catch (e) {
      console.warn('[rooms] delta-put 啟用失敗,略過(不影響服務):', e && e.message);
    }
    // <<< PTCG-DELTA-PUT-BLOCK-END

    // >>> PTCG-FRIENDS-BLOCK-START  (守衛 test-v6282-friends-p0.mjs 會把這一段抽出來實跑)
    // ══ v1.36（v6.282）好友功能【P0：純伺服器端，玩家完全無感】═══════════════════════
    //   計劃書 docs/plan-friends-feature.md（站長已核准）。本版只上伺服器端：
    //   ① `friendships` collection（key＝兩個正規化 email 排序串接）＋ `playerIdentity`
    //      （email ↔ 最近 uid ↔ 最近暱稱；更新接點在 /api/match-result 的 enrich 段，零額外查詢）
    //   ② 六支端點 /api/friends/{list,request,accept,reject,remove,block,unblock}
    //   ③ kill switch friendsConfig.enabled（⚠ 預設 false）＋ admin GET/POST /api/friends/admin/config
    //      （⚠ 交辦原本寫 /api/tournament/admin/friendsconfig；但 test-v6272 ⑨／v6265／v6275 三把鎖以
    //        **第一支 /api/tournament 的 app.get 字面**當錦標賽區塊的起點（連註解裡的字面都算），放在那個
    //        字首下會把錨點往前挪、三把鎖全紅；用 app.route 繞字面又是在躲守衛 ⇒ 改掛 /api/friends 字首，
    //        gate 仍是 isTournAdmin）；關閉時端點回 503 且**不帶哨兵**（比照 v6.266）
    //   ④ 哨兵 friendsApi:1 ⇒ 下一版 client 靠它決定顯不顯示 UI
    //   ⚠⚠ 隱私最高優先：**所有回應一律不含 email**（只回暱稱、uid、fid）。
    //     用 email 加好友的人本來就知道那個 email，但在對戰中加的好友絕不該因此得知
    //     對方 email ⇒ 規則一致才安全。回應建構一律走白名單 _frPublic()。
    //   ⚠⚠ 絕不可拖累錦標賽（pm2 fork_mode 單 instance ⇒ 同一個 node 行程）：
    //     ・所有查詢走索引且有硬上限（{a:1,status:1}/{b:1,status:1}；playerIdentity 走 _id $in）
    //     ・唯一的逐筆迴圈（好友清單 ≤ 100＋待確認）仍掛中央 adminScanYield 每 200 筆讓路
    //     ・adminScanYield 在 firebase-admin 的 then-callback 內（另一個 closure）⇒ 走
    //       app.locals._adminScanYield、handler 執行時才取、取不到 fail-closed 回 503
    //       （v0.94／v1.01／v6.269 三次跨 IIFE 事故）
    //   ⚠ 本區塊位置在第一支 /api/tournament 的 app.get 之前 ⇒ 錦標賽區塊逐位元未動
    //     （test-v6272 ⑨／test-v6278 I1 兩把 sha256 鎖都不動）。
    //   ⚠ 同一個 closure 內可直接用的：tournIdentity（Firebase ID token 驗證）、isTournAdmin、
    //     TADMIN（firebase-admin；查無此帳號時的 Auth fallback，⚠ Auth 不是 Firestore，不吃讀取額度）。
    //   ⚠⚠ 站長裁定不可更動：key＝email／B 級在線狀態／解除＝真刪除／不推播／上限 100／
    //     錦標賽入口本版只要端點支援（{matchId}）／查無此帳號明講＋限流／零 Firebase 讀寫。
    //   ⚠ 站長裁定之外、本版自己補的兩個決定（見 docs/changelog-internal.md）：
    //     (a) status 多一個 `rejected`：被拒絕後 24 小時冷卻需要落地（記憶體會在重啟後消失），
    //         留一列 status=rejected+rejectedAt 是最省的做法；list 一律不回 rejected。
    //     (b) 對方已先送出邀請給我、我再送邀請給對方 ⇒ 直接成立（雙方都要 ⇒ 沒有理由再等一次確認）。
    //   ══ v1.37（v6.286）對抗性審查六修（守衛 scripts/test-v6286-friends-hardening.mjs 逐條行為端實跑）══
    //     【2】_frPublic 的 nick 不再吃 playerIdentity.nick（那張表由未驗證的 /api/match-result 寫入，可被冒名竄改），
    //         改用 friendships 自己的 nickA/nickB 快照（建立時＝seat/報名/Auth 名，accept 時被驗過 token 的暱稱覆寫）；
    //         {email} 入口的 nick 也不再吃 playerIdentity（對照表只當「帳號存在」的零網路判據）。
    //     【3】remove 對 status=rejected 一律 409（否則被拒方拿 fid 刪掉列就能立刻重送＝兩步繞過 24 小時冷卻）；
    //         block→unblock 同型繞過：block 時保留 rejectedAt，unblock 在冷卻期內只把列還原成 rejected、不刪。
    //     【4】所有 500 路徑固定文案（Mongo E11000 訊息會帶 _id="a@x|b@y" ⇒ 原文只進伺服器 log）。
    //     【5】冷卻只擋**被拒的那一方**（requester）；拒絕方自己想邀回去 ⇒ 放行。
    //   ══ v1.39（v6.288）站長裁定「解除好友就連對話一起刪」（守衛 scripts/test-v6288-friends-dm-ui.mjs 行為端實跑）══
    //     ・remove 在 friendships 那一列**真的刪掉之後**（deletedCount > 0），一併 deleteMany({ room: 'dm:' + fid })。
    //       ⚠⚠ 這是全站唯一被授權刪除既有資料的路徑，room 用**等值**比對（不是前綴／正則）⇒ 'lobby' 與別段對話一筆都碰不到。
    //     ・刪對話失敗**不可**讓 remove 整支失敗（關係已經刪了）：_frPurgeDm 自己 try/catch、只 log。
    //     ・block **不刪**（站長裁定：封鎖可以解除）。
    //   ══ v1.40（v6.289）站長裁定「解除封鎖（真刪分支）也一併刪對話」（守衛 scripts/test-v6289-unblock-purge.mjs 行為端實跑）══
    //     ・unblock 有兩條路徑：冷卻外＝deleteOne 真刪那一列（關係歸零）⇒ deletedCount > 0 之後接同一支 _frPurgeDm(fid, 'unblock')；
    //       冷卻內＝updateOne 還原成 rejected（列還在，只是回到「被拒絕過」）⇒ **不刪**對話（刪除授權只綁「那一列真的刪掉」）。
    //       ⚠ 帶 rejectedAt 的 blocked 列在封鎖前必是 rejected（block 只在 cur.status === 'rejected' 時帶 rejectedAt），
    //         而 rejected 列在本列生命週期內不可能 accepted 過（reject 只收 pending）⇒ 冷卻內分支底下本來就不會有私聊，語義自洽。
    const FR_COLL = 'friendships';
    const FR_ID_COLL = 'playerIdentity';
    const FR_CFG_ID = 'friendsConfig';
    const FR_MAX_FRIENDS = 100;                       // 站長裁定：好友上限
    const FR_REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 站長裁定：被拒後 24 小時冷卻
    const FR_EMAIL_RATE_MIN = 3, FR_EMAIL_RATE_DAY = 30; // 站長裁定：{email} 入口每人每分鐘 3 次、每天 30 次
    const FR_CFG_TTL_MS = 10000;                      // 開關快取（比照 redactEnabled 的 10 秒）
    const FR_LIST_CAP = FR_MAX_FRIENDS + 150;         // list 查詢硬上限：100 好友＋待確認/送出/封鎖
    const FR_AUTH_LOOKUP_TTL_MS = 10 * 60 * 1000;     // Firebase Auth getUserByEmail 快取（正負結果都快取）
    const FR_EMAIL_RE = /^[^\s@\/\\"'<>]{1,64}@[^\s@\/\\"'<>]{1,190}$/;
    // ── 索引：比照 v6.240／v6.266 先例 —— 只在服務啟動時 lazy 建一次、不 await、.catch() 兜底 ──
    //   實際建構跑在 mongod 行程；collection 從 0 筆開始長，node 端零阻塞。
    try {
      db.collection(FR_COLL).createIndex({ a: 1, status: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
      db.collection(FR_COLL).createIndex({ b: 1, status: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    } catch (e) { /* db 尚未就緒時略過，不影響服務啟動 */ }
    /** email 正規化：trim＋小寫；不合格回 null。⚠ 全站唯一的 key 出口，friendships._id/a/b 與 playerIdentity._id 都靠它。 */
    function _frNormEmail(v) {
      if (typeof v !== 'string') return null;
      const t = v.trim().toLowerCase();
      if (!t || t.length > 254 || !FR_EMAIL_RE.test(t)) return null;
      return t;
    }
    /** 同一對只有一筆：兩個正規化 email 排序後串接。 */
    function _frPairId(e1, e2) { return e1 < e2 ? (e1 + '|' + e2) : (e2 + '|' + e1); }
    /** 對外用的不透明識別碼（回應只回這個，絕不回 _id/a/b —— 那三個都含 email）。 */
    function _frFid(pairId) { return _frHash(pairId).slice(0, 24); }
    function _frHash(s) {
      // FNV-1a 雙 32bit（與 v1.20 logh 同款手法）—— 不需要 crypto 也能在 ESM/CJS host 都跑；
      // fid 只是「在我自己的好友列裡挑一筆」的識別碼，不是安全憑證（handler 一律再用 a/b＝我 過濾）。
      let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x7fffffff;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= (c * 31 + i) & 0xffff; h2 = Math.imul(h2, 0x01000193) >>> 0;
      }
      const h3 = Math.imul(h1 ^ h2, 0x9e3779b1) >>> 0;
      return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + h3.toString(16).padStart(8, '0');
    }
    function _frNick(v) { return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 40) : null; }
    /** v1.37【4】唯一的 500 出口：固定文案，原始訊息只進伺服器 log（Mongo 的 E11000 訊息會把 _id＝兩個 email 吐出來）。 */
    function _frFail(res, e, where) {
      try { console.warn('[friends] ' + where + ' error:', (e && e.message) || String(e)); } catch (_) { /* log 失敗不影響回應 */ }
      res.status(500).json({ error: '好友功能暫時無法使用，請稍後再試', code: 'friends-error' });
    }
    /** v1.37【2】Firebase Auth displayName 也套同一條「不得等於 email 前綴」規則（Auth 的 displayName 是使用者自己設的，理論上不會等於前綴；保險）。 */
    function _frAuthNick(name, email) {
      const n = _frNick(name);
      if (!n) return null;
      if (email && n === String(email).split('@')[0]) return null;
      return n;
    }
    /** tournIdentity 的 name 在沒有 displayName 時會退成 email 前綴 —— 那等於半個 email，禁用。 */
    function _frMyNick(id) {
      const n = _frNick(id && id.name);
      if (!n) return null;
      if (id && id.email && n === String(id.email).split('@')[0]) return null;
      return n;
    }
    // ── 開關（⚠ 預設 false；只有 tournamentConfig.friendsConfig.enabled === true 才開）──
    let _frCfgFlag = false, _frCfgAt = 0;
    async function friendsEnabled() {
      const now = Date.now();
      if (now - _frCfgAt < FR_CFG_TTL_MS) return _frCfgFlag;
      try {
        const d = await db.collection('tournamentConfig').findOne({ _id: FR_CFG_ID });
        _frCfgFlag = !!(d && d.enabled === true);
      } catch (e) { /* 讀不到就維持現值 */ }
      _frCfgAt = now;
      return _frCfgFlag;
    }
    // ── {email} 入口限流（記憶體；比照 clientdiag 的 per-uid 節流）──────────────────
    const _frEmailRate = new Map();   // key(email of requester) -> { m: [ts...], d: [ts...] }
    function _frEmailRateCheck(me, now) {
      now = typeof now === 'number' ? now : Date.now();
      if (_frEmailRate.size > 5000) {   // lazy prune：只留最近一天內有活動的
        for (const [k, v] of _frEmailRate) { if (!v.d.length || now - v.d[v.d.length - 1] > 86400000) _frEmailRate.delete(k); }
      }
      const r = _frEmailRate.get(me) || { m: [], d: [] };
      r.m = r.m.filter((t) => now - t < 60000);
      r.d = r.d.filter((t) => now - t < 86400000);
      if (r.m.length >= FR_EMAIL_RATE_MIN || r.d.length >= FR_EMAIL_RATE_DAY) { _frEmailRate.set(me, r); return false; }
      r.m.push(now); r.d.push(now); _frEmailRate.set(me, r);
      return true;
    }
    // ── 身分：一律要求 Firebase ID token 驗過且有 email；匿名／playerId fallback 一律 401 ──
    async function _frAuth(req, res) {
      let id = null;
      try { id = await tournIdentity(req); } catch (e) { id = null; }
      const email = id && !id.error && id.verified ? _frNormEmail(id.email) : null;
      if (!email) { res.status(401).json({ error: '好友功能需要以 email 帳號登入', code: 'friends-auth-required' }); return null; }
      return { uid: String(id.uid), email, nick: _frMyNick(id) };
    }
    /** 端點共用前置：開關（503 不帶哨兵）→ 身分（401）→ 讓路 helper（503 fail-closed）。回 null 表示已回應。 */
    async function _frGate(req, res) {
      if (typeof db === 'undefined' || !db) { res.status(503).json({ error: 'db not ready', code: 'friends-db-not-ready' }); return null; }
      if (!(await friendsEnabled())) { res.status(503).json({ error: '好友功能尚未開放', code: 'friends-disabled' }); return null; }
      const me = await _frAuth(req, res);
      if (!me) return null;
      // ⚠⚠ 跨 IIFE：adminScanYield 在 firebase-admin 的 then-callback 內；handler 執行時才取，取不到 fail-closed。
      const y = app.locals && app.locals._adminScanYield;
      if (typeof y !== 'function') { res.status(503).json({ error: '好友功能尚未就緒（讓路 helper 未掛載）', code: 'friends-helper-missing' }); return null; }
      me.yield = y;
      return me;
    }
    // ── 回應白名單（⚠⚠ 唯一的對外形狀；守衛把含 email 的假資料丟進來、序列化後掃 `@`）──
    //   v1.37【2】nick 只用 friendships 自己的 nickA/nickB 快照：playerIdentity.nick 由未驗證的 /api/match-result 寫入，
    //   任何人都能把它改成任意字串（冒名）。uid/uids 仍來自 playerIdentity（同一條未驗證路徑）⇒ 只當大廳提示用。
    function _frPublic(doc, me, ident) {
      const otherEmail = doc.a === me ? doc.b : doc.a;
      const otherNick = doc.a === me ? doc.nickB : doc.nickA;
      const idn = ident && ident.get(otherEmail);
      const uids = idn && Array.isArray(idn.uids) ? [...new Set(idn.uids.map((u) => u && u.uid).filter((u) => typeof u === 'string'))] : [];
      return {
        fid: doc.fid || _frFid(doc._id),
        status: doc.status,
        nick: _frNick(otherNick) || '玩家',
        uid: (idn && typeof idn.uid === 'string') ? idn.uid : null,
        uids,
        requestedByMe: doc.requester === me,
        blockedByMe: doc.status === 'blocked' && doc.blockedBy === me,
        via: doc.addedVia || null,
        at: doc.updatedAt || doc.createdAt || null,
      };
    }
    async function _frCountAccepted(email) {
      const c = db.collection(FR_COLL);
      const n1 = await c.countDocuments({ a: email, status: 'accepted' }, { limit: FR_MAX_FRIENDS + 1 });
      const n2 = await c.countDocuments({ b: email, status: 'accepted' }, { limit: FR_MAX_FRIENDS + 1 });
      return n1 + n2;
    }
    // ── 目標解析：{roomCode}（休閒房，伺服器從 seats[] 取對方 email）／{matchId}（錦標賽）／{email} ──
    async function _frResolveTarget(body, me, res) {
      const b = body || {};
      if (typeof b.roomCode === 'string' && b.roomCode.trim()) {
        const code = b.roomCode.trim().toUpperCase().slice(0, 16);
        const room = await db.collection('rooms').findOne({ _id: code }, { projection: { 'seats.uid': 1, 'seats.email': 1, 'seats.name': 1 } });
        if (!room || !Array.isArray(room.seats)) { res.status(404).json({ error: '找不到這個房間', code: 'friends-room-not-found' }); return null; }
        // 只認 p1/p2 兩個對戰位；要求者必須就是其中一位（以驗過的 email 比對，不信 client 送來的 uid）
        const s0 = room.seats[0] || {}, s1 = room.seats[1] || {};
        const e0 = _frNormEmail(s0.email), e1 = _frNormEmail(s1.email);
        let mine = -1;
        if (e0 === me.email) mine = 0; else if (e1 === me.email) mine = 1;
        if (mine < 0) { res.status(403).json({ error: '只能對自己對戰過的對手送出好友邀請', code: 'friends-not-in-room' }); return null; }
        const opp = mine === 0 ? s1 : s0, oppEmail = mine === 0 ? e1 : e0;
        if (!opp || !opp.uid) { res.status(409).json({ error: '對戰位上沒有對手', code: 'friends-opponent-missing' }); return null; }
        if (!oppEmail) { res.status(409).json({ error: '對方沒有以 email 帳號登入，無法加為好友', code: 'friends-opponent-anonymous' }); return null; }
        return { email: oppEmail, nick: _frNick(opp.name), myNick: _frNick((mine === 0 ? s0 : s1).name), via: 'battle' };
      }
      if (typeof b.matchId === 'string' && b.matchId.trim()) {
        const mid = b.matchId.trim().slice(0, 120);
        let oppUid = null, oppName = null, eventId = null, myName = null;
        const m = await db.collection('tournamentMatches').findOne({ _id: mid }, { projection: { eventId: 1, p1uid: 1, p2uid: 1, p1name: 1, p2name: 1 } });
        if (m) {
          eventId = m.eventId;
          if (m.p1uid === me.uid) { oppUid = m.p2uid; oppName = m.p2name; myName = m.p1name; }
          else if (m.p2uid === me.uid) { oppUid = m.p1uid; oppName = m.p1name; myName = m.p2name; }
          else { res.status(403).json({ error: '只能對自己對戰過的對手送出好友邀請', code: 'friends-not-in-match' }); return null; }
        } else {
          // TMATCH 會被 v0.58 排程清掃 ⇒ 退到永久歸檔（_id 形狀 evId_r<round>_m<idx>）
          const mm = /^(.+)_r(\d+)_m(\d+)$/.exec(mid);
          const arch = mm ? await db.collection('tournamentArchives').findOne({ _id: 'arch_' + mm[1] },
            { projection: { eventId: 1, 'players.uid': 1, 'players.email': 1, 'players.name': 1, 'matches.round': 1, 'matches.idx': 1, 'matches.p1uid': 1, 'matches.p2uid': 1 } }) : null;
          const am = arch && Array.isArray(arch.matches) ? arch.matches.find((x) => x && String(x.round) === mm[2] && String(x.idx) === mm[3]) : null;
          if (!am) { res.status(404).json({ error: '找不到這場對戰', code: 'friends-match-not-found' }); return null; }
          eventId = arch.eventId;
          if (am.p1uid === me.uid) oppUid = am.p2uid; else if (am.p2uid === me.uid) oppUid = am.p1uid;
          else { res.status(403).json({ error: '只能對自己對戰過的對手送出好友邀請', code: 'friends-not-in-match' }); return null; }
          const pl = (arch.players || []).find((p) => p && p.uid === oppUid);
          if (pl) { oppName = pl.name; }
          if (pl && pl.email) {
            const oe = _frNormEmail(pl.email);
            if (!oe) { res.status(409).json({ error: '對方沒有 email 帳號，無法加為好友', code: 'friends-opponent-anonymous' }); return null; }
            return { email: oe, nick: _frNick(oppName), myNick: null, via: 'battle' };
          }
        }
        if (!oppUid) { res.status(409).json({ error: '對戰位上沒有對手（輪空）', code: 'friends-opponent-missing' }); return null; }
        const reg = await db.collection('tournamentRegistrations').findOne({ _id: eventId + '__' + oppUid }, { projection: { email: 1, name: 1 } });
        const oe = _frNormEmail(reg && reg.email);
        if (!oe) { res.status(409).json({ error: '對方沒有 email 帳號，無法加為好友', code: 'friends-opponent-anonymous' }); return null; }
        return { email: oe, nick: _frNick(reg.name) || _frNick(oppName), myNick: _frNick(myName), via: 'battle' };
      }
      if (typeof b.email === 'string' && b.email.trim()) {
        const te = _frNormEmail(b.email);
        if (!te) { res.status(400).json({ error: 'email 格式不正確', code: 'friends-bad-email' }); return null; }
        // ⭐ 站長裁定：查無此帳號**明講**＋限流（每人每分鐘 3 次、每天 30 次）；限流在查詢之前消耗。
        if (!_frEmailRateCheck(me.email)) { res.status(429).json({ error: '用 email 加好友的次數過於頻繁（每分鐘 3 次、每天 30 次）', code: 'friends-rate-limited' }); return null; }
        if (te === me.email) { res.status(400).json({ error: '不能加自己為好友', code: 'friends-self' }); return null; }
        // 先查對照表（零網路），查不到才走 Firebase Auth（⚠ Auth 不是 Firestore，不吃讀取額度；有快取）
        // v1.37【2】：對照表只當「帳號存在」的判據，**不再拿它的 nick**（可被冒名竄改）；nick 留空，
        //   對方 accept 時會用驗過 token 的暱稱補上（accept 端既有邏輯）。Auth 路徑的 displayName 是可信來源，照用。
        const idn = await db.collection(FR_ID_COLL).findOne({ _id: te }, { projection: { _id: 1 } });
        if (idn) return { email: te, nick: null, myNick: null, via: 'email' };
        const au = await _frAuthLookup(te);
        if (!au.exists) { res.status(404).json({ error: '查無此 email 的帳號', code: 'friends-no-such-account' }); return null; }
        return { email: te, nick: _frAuthNick(au.name, te), myNick: null, via: 'email' };
      }
      res.status(400).json({ error: '需要 roomCode、matchId 或 email 其中之一', code: 'friends-bad-request' });
      return null;
    }
    const _frAuthCache = new Map();   // email -> { at, exists, name }
    async function _frAuthLookup(email) {
      const now = Date.now();
      const c = _frAuthCache.get(email);
      if (c && now - c.at < FR_AUTH_LOOKUP_TTL_MS) return c;
      if (_frAuthCache.size > 2000) _frAuthCache.clear();
      let out = { at: now, exists: false, name: null };
      try {
        if (TADMIN && TADMIN.apps && TADMIN.apps.length) {
          const u = await TADMIN.auth().getUserByEmail(email);
          out = { at: now, exists: !!(u && u.uid), name: (u && u.displayName) || null };
        }
      } catch (e) {
        // user-not-found ⇒ 明確不存在；其他錯誤（網路）不快取太久：視為不存在但 30 秒後可重試
        const nf = e && (e.code === 'auth/user-not-found' || /not.?found/i.test(String(e.message || '')));
        out = { at: nf ? now : now - FR_AUTH_LOOKUP_TTL_MS + 30000, exists: false, name: null };
      }
      _frAuthCache.set(email, out);
      return out;
    }
    // ── 端點 ─────────────────────────────────────────────────────────────────
    // GET /api/friends/list：我的好友（accepted）＋待我確認（pending 且我不是 requester）＋我送出的（pending 且我是 requester）＋我封鎖的
    app.get('/api/friends/list', async (req, res) => {
      try {
        const me = await _frGate(req, res); if (!me) return;
        const c = db.collection(FR_COLL);
        const q = { $or: [{ a: me.email }, { b: me.email }], status: { $in: ['accepted', 'pending', 'blocked'] } };
        const cur = c.find(q, { projection: { _id: 1, a: 1, b: 1, status: 1, requester: 1, blockedBy: 1, nickA: 1, nickB: 1, addedVia: 1, createdAt: 1, updatedAt: 1, fid: 1 } }).limit(FR_LIST_CAP);
        const docs = []; let n = 0;
        for await (const d of cur) {
          if (d.status === 'blocked' && d.blockedBy !== me.email) continue;   // 被封鎖方看不到任何痕跡
          docs.push(d);
          const y = me.yield(++n); if (y) await y;
        }
        // email → 最近 uid（供 client 比對大廳 seats[].uid；一發 $in，走 _id 索引）
        const others = docs.map((d) => (d.a === me.email ? d.b : d.a));
        const ident = new Map();
        if (others.length) {
          const ic = db.collection(FR_ID_COLL).find({ _id: { $in: others } }, { projection: { _id: 1, uid: 1, uids: 1 } }).limit(FR_LIST_CAP);   // v1.37：不再讀 nick
          let k = 0;
          for await (const d of ic) { ident.set(d._id, d); const y = me.yield(++k); if (y) await y; }
        }
        const friends = [], incoming = [], outgoing = [], blocked = [];
        for (const d of docs) {
          const p = _frPublic(d, me.email, ident);
          if (d.status === 'accepted') friends.push(p);
          else if (d.status === 'pending') (d.requester === me.email ? outgoing : incoming).push(p);
          else if (d.status === 'blocked') blocked.push(p);
        }
        res.json({ friendsApi: 1, me: { uid: me.uid, nick: me.nick }, friends, incoming, outgoing, blocked, limit: FR_MAX_FRIENDS, truncated: docs.length >= FR_LIST_CAP });
      } catch (e) { _frFail(res, e, 'list'); }
    });
    // POST /api/friends/request {roomCode} | {matchId} | {email}
    app.post('/api/friends/request', async (req, res) => {
      try {
        const me = await _frGate(req, res); if (!me) return;
        const tgt = await _frResolveTarget(req.body, me, res); if (!tgt) return;
        if (tgt.email === me.email) return res.status(400).json({ error: '不能加自己為好友', code: 'friends-self' });
        const c = db.collection(FR_COLL);
        const pid = _frPairId(me.email, tgt.email);
        const now = Date.now();
        const cur = await c.findOne({ _id: pid });
        // ⚠ 封鎖：被封鎖方的任何請求**靜默失敗**（回 200 但 DB 一個位元都不動，不讓對方知道被封鎖）
        if (cur && cur.status === 'blocked') {
          if (cur.blockedBy === me.email) return res.status(409).json({ error: '你已封鎖對方，請先解除封鎖', code: 'friends-blocked-by-you', friendsApi: 1 });
          return res.json({ ok: true, friendsApi: 1, status: 'pending' });
        }
        if (cur && cur.status === 'accepted') return res.json({ ok: true, friendsApi: 1, status: 'accepted', already: true, fid: cur.fid || _frFid(pid) });
        if (cur && cur.status === 'pending') {
          if (cur.requester === me.email) return res.json({ ok: true, friendsApi: 1, status: 'pending', already: true, fid: cur.fid || _frFid(pid) });
          // 對方已先邀我 ⇒ 雙方都要 ⇒ 直接成立（同時檢查雙方上限）
          if (await _frCountAccepted(me.email) >= FR_MAX_FRIENDS) return res.status(409).json({ error: '好友已達上限（' + FR_MAX_FRIENDS + ' 人）', code: 'friends-limit-reached', friendsApi: 1 });
          if (await _frCountAccepted(tgt.email) >= FR_MAX_FRIENDS) return res.status(409).json({ error: '對方的好友已達上限', code: 'friends-target-full', friendsApi: 1 });
          await c.updateOne({ _id: pid, status: 'pending' }, { $set: { status: 'accepted', acceptedAt: now, updatedAt: now } });
          return res.json({ ok: true, friendsApi: 1, status: 'accepted', fid: cur.fid || _frFid(pid) });
        }
        // v1.37【5】冷卻只擋**被拒的那一方**（rejected 列的 requester）；拒絕方自己想邀回去 ⇒ 放行（建立新的 pending，requester 換成他）。
        if (cur && cur.status === 'rejected' && cur.requester === me.email && typeof cur.rejectedAt === 'number' && now - cur.rejectedAt < FR_REJECT_COOLDOWN_MS) {
          return res.status(429).json({ error: '對方最近拒絕過這個邀請，24 小時後才能再送出', code: 'friends-cooldown', friendsApi: 1 });
        }
        if (await _frCountAccepted(me.email) >= FR_MAX_FRIENDS) return res.status(409).json({ error: '好友已達上限（' + FR_MAX_FRIENDS + ' 人）', code: 'friends-limit-reached', friendsApi: 1 });
        if (await _frCountAccepted(tgt.email) >= FR_MAX_FRIENDS) return res.status(409).json({ error: '對方的好友已達上限', code: 'friends-target-full', friendsApi: 1 });
        const a = me.email < tgt.email ? me.email : tgt.email, b = me.email < tgt.email ? tgt.email : me.email;
        const nickA = a === me.email ? (tgt.myNick || me.nick) : tgt.nick;
        const nickB = b === me.email ? (tgt.myNick || me.nick) : tgt.nick;
        const doc = { _id: pid, fid: _frFid(pid), a, b, status: 'pending', requester: me.email, blockedBy: null, nickA: nickA || null, nickB: nickB || null, addedVia: tgt.via, createdAt: cur ? (cur.createdAt || now) : now, updatedAt: now };
        // ⚠ 用 replaceOne+upsert 而不是 insertOne：rejected 冷卻期滿要重用同一列（同一對只准一筆）
        await c.replaceOne({ _id: pid }, doc, { upsert: true });
        res.json({ ok: true, friendsApi: 1, status: 'pending', fid: doc.fid });
      } catch (e) { _frFail(res, e, 'request'); }
    });
    /**
     * v1.39 刪掉一段關係的私聊（站長裁定：解除好友就連對話一起刪）。⚠⚠ 全站唯一被授權刪除既有資料的路徑。
     *   ・room 一律 **等值** 'dm:' + fid（fid 先驗格式；絕不用前綴／$regex）⇒ room:'lobby' 與其他 fid 的對話一筆都碰不到。
     *   ・失敗只 log、回 -1，**絕不 throw**（呼叫端的關係列已經刪掉，這裡失敗不能讓 remove／unblock 整支變 500）。
     *   ・字面 'tournamentChat'／'dm:' 與 DM 區塊的 FR_DM_COLL／FR_DM_ROOM_PREFIX 相同（守衛比對）；不直接引用那兩個 const，
     *     因為 DM 區塊在本區塊之後、且守衛會單獨抽本區塊實跑（引用會變 TDZ／ReferenceError）。
     */
    async function _frPurgeDm(fid, why) {
      if (typeof fid !== 'string' || !/^[0-9a-f]{8,32}$/.test(fid)) return 0;
      try {
        const r = await db.collection('tournamentChat').deleteMany({ room: 'dm:' + fid });
        return (r && typeof r.deletedCount === 'number') ? r.deletedCount : 0;
      } catch (e) {
        console.warn('[friends] purge dm failed (' + why + ', fid=' + fid + '): ' + (e && e.message));
        return -1;
      }
    }
    /** 用 fid 在「我自己的列」裡找那一筆（a/b＝我 ⇒ 走索引；fid 只在這個小集合內過濾）。 */
    async function _frFindMine(c, me, fid) {
      if (typeof fid !== 'string' || !/^[0-9a-f]{8,32}$/.test(fid)) return null;
      return await c.findOne({ fid, $or: [{ a: me }, { b: me }] });
    }
    // POST /api/friends/accept {fid}
    app.post('/api/friends/accept', async (req, res) => {
      try {
        const me = await _frGate(req, res); if (!me) return;
        const c = db.collection(FR_COLL);
        const cur = await _frFindMine(c, me.email, req.body && req.body.fid);
        if (!cur) return res.status(404).json({ error: '找不到這筆邀請', code: 'friends-not-found', friendsApi: 1 });
        if (cur.status === 'blocked') return res.json({ ok: true, friendsApi: 1 });   // 靜默
        if (cur.status !== 'pending' || cur.requester === me.email) return res.status(409).json({ error: '這筆邀請不是待你確認的狀態', code: 'friends-not-pending', friendsApi: 1 });
        const other = cur.a === me.email ? cur.b : cur.a;
        if (await _frCountAccepted(me.email) >= FR_MAX_FRIENDS) return res.status(409).json({ error: '好友已達上限（' + FR_MAX_FRIENDS + ' 人）', code: 'friends-limit-reached', friendsApi: 1 });
        if (await _frCountAccepted(other) >= FR_MAX_FRIENDS) return res.status(409).json({ error: '對方的好友已達上限', code: 'friends-target-full', friendsApi: 1 });
        const now = Date.now();
        const $set = { status: 'accepted', acceptedAt: now, updatedAt: now };
        if (me.nick) $set[cur.a === me.email ? 'nickA' : 'nickB'] = me.nick;
        await c.updateOne({ _id: cur._id, status: 'pending' }, { $set });
        res.json({ ok: true, friendsApi: 1, status: 'accepted', fid: cur.fid });
      } catch (e) { _frFail(res, e, 'accept'); }
    });
    // POST /api/friends/reject {fid}：留一列 rejected（24 小時冷卻的依據；list 不回它）
    app.post('/api/friends/reject', async (req, res) => {
      try {
        const me = await _frGate(req, res); if (!me) return;
        const c = db.collection(FR_COLL);
        const cur = await _frFindMine(c, me.email, req.body && req.body.fid);
        if (!cur) return res.status(404).json({ error: '找不到這筆邀請', code: 'friends-not-found', friendsApi: 1 });
        if (cur.status === 'blocked') return res.json({ ok: true, friendsApi: 1 });
        if (cur.status !== 'pending' || cur.requester === me.email) return res.status(409).json({ error: '這筆邀請不是待你確認的狀態', code: 'friends-not-pending', friendsApi: 1 });
        const now = Date.now();
        await c.updateOne({ _id: cur._id, status: 'pending' }, { $set: { status: 'rejected', rejectedAt: now, updatedAt: now } });
        res.json({ ok: true, friendsApi: 1, status: 'rejected', fid: cur.fid });
      } catch (e) { _frFail(res, e, 'reject'); }
    });
    // POST /api/friends/remove {fid}：⭐ 真刪除（deleteOne）friendships 那一列；v1.39 起成功後一併刪 room='dm:'+fid 的私聊（_frPurgeDm）
    app.post('/api/friends/remove', async (req, res) => {
      try {
        const me = await _frGate(req, res); if (!me) return;
        const c = db.collection(FR_COLL);
        const cur = await _frFindMine(c, me.email, req.body && req.body.fid);
        if (!cur) return res.status(404).json({ error: '找不到這位好友', code: 'friends-not-found', friendsApi: 1 });
        if (cur.status === 'blocked') {
          if (cur.blockedBy === me.email) return res.status(409).json({ error: '這是封鎖狀態，請用解除封鎖', code: 'friends-use-unblock', friendsApi: 1 });
          return res.json({ ok: true, friendsApi: 1 });   // 被封鎖方：靜默，且**絕不**讓他刪掉封鎖列
        }
        // v1.37【3】rejected 列是 24 小時冷卻的唯一依據 —— 冷卻期內誰都不能 remove（被拒方拿 request 回應裡的 fid 刪掉它就能立刻重送）；
        //   冷卻已過才准刪（那時本來就可以重送，刪掉等於歸零）。
        if (cur.status === 'rejected' && typeof cur.rejectedAt === 'number' && Date.now() - cur.rejectedAt < FR_REJECT_COOLDOWN_MS) {
          return res.status(409).json({ error: '這筆邀請已被拒絕，24 小時內無法移除或重送', code: 'friends-not-removable', friendsApi: 1 });
        }
        const del = await c.deleteOne({ _id: cur._id, $or: [{ a: me.email }, { b: me.email }] });
        // v1.39 站長裁定：解除好友就連對話一起刪 —— 只在那一列**真的刪掉**之後才刪；失敗只 log（_frPurgeDm 不 throw）。
        if (del && del.deletedCount > 0) await _frPurgeDm(cur.fid || _frFid(cur._id), 'remove');
        res.json({ ok: true, friendsApi: 1, removed: true });
      } catch (e) { _frFail(res, e, 'remove'); }
    });
    // POST /api/friends/block {fid} | {roomCode} | {matchId} | {email}：任何狀態都可封鎖（沒有關係也可以）
    app.post('/api/friends/block', async (req, res) => {
      try {
        const me = await _frGate(req, res); if (!me) return;
        const c = db.collection(FR_COLL);
        const now = Date.now();
        let cur = null, other = null, nick = null, via = null;
        if (req.body && typeof req.body.fid === 'string') {
          cur = await _frFindMine(c, me.email, req.body.fid);
          if (!cur) return res.status(404).json({ error: '找不到這位玩家', code: 'friends-not-found', friendsApi: 1 });
          other = cur.a === me.email ? cur.b : cur.a;
        } else {
          const tgt = await _frResolveTarget(req.body, me, res); if (!tgt) return;
          if (tgt.email === me.email) return res.status(400).json({ error: '不能封鎖自己', code: 'friends-self', friendsApi: 1 });
          other = tgt.email; nick = tgt.nick; via = tgt.via;
          cur = await c.findOne({ _id: _frPairId(me.email, other) });
        }
        if (cur && cur.status === 'blocked') {
          if (cur.blockedBy === me.email) return res.json({ ok: true, friendsApi: 1, status: 'blocked', already: true, fid: cur.fid });
          return res.json({ ok: true, friendsApi: 1 });   // 對方已封鎖我：靜默（不覆蓋、不透露）
        }
        const pid = _frPairId(me.email, other);
        const a = me.email < other ? me.email : other, b = me.email < other ? other : me.email;
        const doc = {
          _id: pid, fid: _frFid(pid), a, b, status: 'blocked', requester: cur ? cur.requester : me.email, blockedBy: me.email,
          nickA: cur ? cur.nickA : (a === me.email ? me.nick : nick), nickB: cur ? cur.nickB : (b === me.email ? me.nick : nick),
          addedVia: cur ? cur.addedVia : via, createdAt: cur ? (cur.createdAt || now) : now, updatedAt: now, blockedAt: now,
        };
        // v1.37【3】從 rejected 轉成 blocked 時把 rejectedAt 帶著走：unblock 時才有依據把冷卻還原（否則 block→unblock＝繞過冷卻）
        if (cur && cur.status === 'rejected' && typeof cur.rejectedAt === 'number') doc.rejectedAt = cur.rejectedAt;
        await c.replaceOne({ _id: pid }, doc, { upsert: true });
        res.json({ ok: true, friendsApi: 1, status: 'blocked', fid: doc.fid });
      } catch (e) { _frFail(res, e, 'block'); }
    });
    // POST /api/friends/unblock {fid}：只有封鎖方可解除；解除＝真刪除那一列（關係歸零，要重新邀請）；v1.40 起真刪分支一併刪 room='dm:'+fid 的私聊（_frPurgeDm）
    app.post('/api/friends/unblock', async (req, res) => {
      try {
        const me = await _frGate(req, res); if (!me) return;
        const c = db.collection(FR_COLL);
        const cur = await _frFindMine(c, me.email, req.body && req.body.fid);
        if (!cur || cur.status !== 'blocked') return res.status(404).json({ error: '找不到這筆封鎖', code: 'friends-not-found', friendsApi: 1 });
        if (cur.blockedBy !== me.email) return res.json({ ok: true, friendsApi: 1 });   // 被封鎖方：靜默
        // v1.37【3】這一列在封鎖前是 rejected 且冷卻未過 ⇒ 還原成 rejected（保留 rejectedAt／requester），不刪 —— 否則被拒方
        //   用「block 再 unblock」兩步就能把冷卻清掉。冷卻已過 ⇒ 照舊真刪除（關係歸零）。
        const _now = Date.now();
        if (typeof cur.rejectedAt === 'number' && _now - cur.rejectedAt < FR_REJECT_COOLDOWN_MS) {
          await c.updateOne({ _id: cur._id, status: 'blocked', blockedBy: me.email }, { $set: { status: 'rejected', blockedBy: null, updatedAt: _now } });
          return res.json({ ok: true, friendsApi: 1, removed: true });
        }
        const del = await c.deleteOne({ _id: cur._id, status: 'blocked', blockedBy: me.email });
        // v1.40 站長裁定：解除封鎖（真刪分支）也連對話一起刪 —— 與 remove 同一條紀律：只在那一列**真的刪掉**之後才刪；失敗只 log（_frPurgeDm 不 throw）。
        //   ⚠ 上面冷卻內「還原成 rejected」的分支已經 return，走不到這裡 ⇒ 列還在就不刪。
        if (del && del.deletedCount > 0) await _frPurgeDm(cur.fid || _frFid(cur._id), 'unblock');
        res.json({ ok: true, friendsApi: 1, removed: true });
      } catch (e) { _frFail(res, e, 'unblock'); }
    });
    // ── admin：開關（比照 redact／longpoll 的 isTournAdmin gate；⚠ 不受開關本身 gate，否則關了就打不開）──
    //   ⚠ 路徑掛在 /api/friends 字首（理由見區塊開頭 ③）。
    app.get('/api/friends/admin/config', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        _frCfgAt = 0;
        res.json({ enabled: await friendsEnabled(), friendsApi: 1, maxFriends: FR_MAX_FRIENDS });
      } catch (e) { _frFail(res, e, 'admin-config'); }
    });
    app.post('/api/friends/admin/config', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const b = req.body || {};
        if (typeof b.enabled !== 'boolean') return res.status(400).json({ error: '需要 enabled（true/false）' });
        await db.collection('tournamentConfig').updateOne({ _id: FR_CFG_ID }, { $set: { enabled: b.enabled, updatedAt: Date.now() } }, { upsert: true });
        _frCfgAt = 0;   // 立刻失效，不必等 10 秒快取
        res.json({ ok: true, enabled: await friendsEnabled(), friendsApi: 1 });
      } catch (e) { _frFail(res, e, 'admin-config'); }
    });
    console.log('[friends] endpoints registered (v1.40) enabled-by-default=false');
    // <<< PTCG-FRIENDS-BLOCK-END

    // >>> PTCG-FRIENDS-DM-BLOCK-START  (守衛 test-v6287-friends-dm.mjs 會把 FRIENDS 區塊＋這一段一起抽出來實跑)
    // ══ v1.38（v6.287）好友私聊【P0：純伺服器端＋admin 檢視，玩家完全無感】═══════════════════
    //   站長需求：「好友要能在沒有開房間的狀況下，直接密語私聊」。本版只上伺服器端（src/ 只動 version.ts），
    //   鐵律：client 送新欄位一律 server 先上；下一版 client 靠哨兵 friendsDm:1 決定顯不顯示聊天面板。
    //   站長已裁定：admin 完全看得到私聊內容（比照休閒房聊天）／即時性 3 秒且只在聊天視窗開著時輪詢
    //   （沿用 v6.216 的 204 零 body 手法）／對戰中未讀提示本版不做／全部 Oracle MongoDB、零 Firebase。
    //   ① 訊息存哪：沿用 tournamentChat，room key＝'dm:' + fid（fid＝v6.282 的 pair hash）。
    //      ⭐ 自己查證過的三件事（2026-09-02，BASE 5271432d）：
    //        ・既有索引 {room:1, ts:1}（v0.57，在錦標賽區塊啟動時建、best-effort catch）正好就是 {room, ts>since} 要走的索引。
    //        ・全 repo 會刪／改 tournamentChat 的地方只有兩處，且都只過濾 room:'lobby'：
    //            pruneLobbyChat 的 deleteMany({ room:'lobby', ts:{$lt} })、
    //            POST /api/tournament/admin/chat/clear 的 deleteMany({ room:'lobby' })。
    //          ⇒ 'dm:*' 不會被誤刪（守衛把這兩段出貨碼抽出來對假資料實跑，斷言 dm 筆數不變）。
    //        ・doc 只存 side:'a'|'b'（相對 pair id）**不存 email**；玩家端回應只回 {id, mine, text, ts}。
    //   ② ⚠⚠⚠ TTL 的陷阱：MongoDB 的 TTL monitor **只會刪 BSON Date 型別**的欄位；tournamentClientDiag 的
    //      TTL 索引建在 ts 上，而 ts 存的是 Date.now()（數字）⇒ 那個「7 天自動清」從來沒有生效過（另案，本版不修）。
    //      ⇒ 私聊一律寫 expireAt: new Date(now + 90 天)，並在 tournamentChat 上建 {expireAt:1}+expireAfterSeconds:0
    //         （既有 lobby 訊息沒有 expireAt 欄位 ⇒ TTL monitor 不會碰它們；索引建構跑在 mongod 行程、不 await、.catch() 兜底）。
    //   ③ 端點（全部掛在 /api/friends 字首 —— 錦標賽區塊的三把 sha256 鎖以第一支 /api/tournament 的 app.get 字面當錨點，
    //      本區塊整段插在 FRIENDS 區塊之後、/api/tournament/join 之前 ⇒ 錦標賽區塊逐位元未動）：
    //        POST /api/friends/dm/send {fid, text}
    //        GET  /api/friends/dm/list?fid=&since=&before=   —— since>0 且無新訊息 ⇒ 204 零 body；首發回最新 50 則＋before 分頁
    //        GET  /api/friends/admin/dm[?fid=&before=]        —— isTournAdmin；總覽（誰對誰、幾則、最後時間）／展開單一對話
    //        GET/POST /api/friends/admin/dm-config             —— 子開關 friendsConfig.dm（⚠ 預設 false）
    //      ⚠⚠ fid 由兩個已知 email 就算得出來 ⇒ 每次讀寫都走 _frFindMine（a/b＝我 過濾）；只驗 room key 等於沒驗。
    //      只有 status==='accepted' 才能收發，其餘 403（含「關係已不存在」：被封鎖方看到的與被解除好友一模一樣，不洩漏封鎖）；
    //      被封鎖方 send ⇒ 回 200 但一個位元都不寫（比照既有靜默失敗）。
    //   ④ 防濫用：200 字（與兩套既有聊天一致）；\s+ 折單空白；每人 1.2 秒 1 則＋每分鐘 20 則＋每天 500 則（記憶體 Map，
    //      比照 _frEmailRateCheck）；限流在文字驗證之後、DB 查詢之前消耗。
    //   ⑤ 開關：friendsConfig.dm 子開關（預設 false）；關閉 ⇒ 503 且**不帶哨兵**；順序＝好友總開關 → dm 子開關 → 身分
    //      （兩個開關都關著時連 Firebase token 都不驗）。admin 端點不受開關 gate（否則關了就打不開）。
    //   ⑥ ⚠⚠ 絕不拖累錦標賽（pm2 fork_mode 單 instance）：玩家端每發最多 50 則、走 {room,ts} 索引；
    //      admin 總覽用 aggregate 在 mongod 行程分組（$match 前綴 → $group → $sort → $limit 硬上限＋1），node 端只逐筆
    //      走中央 adminScanYield（app.locals，取不到 fail-closed 503）；超過上限回 truncated:true（絕不靜默截斷）；
    //      friendships 補 {fid:1} 索引（admin 用 fid $in 反查 a/b；玩家端仍走 a/b 索引）。
    //   ⑦ 兩條白名單分開：玩家端 _frDmPublic() 永不含 email；admin 端 _frDmAdminRow() 可含 email（admin 本來就到處有 email）。
    //   ⚠⚠ 本區塊沒有任何刪除或改寫既有資料的路徑（只 insertOne 進 tournamentChat、只 $set friendsConfig.dm）；
    //      v1.39 起唯一的刪除在 FRIENDS 區塊的 remove → _frPurgeDm（等值 room:'dm:'+fid）；v1.40 起 unblock 的真刪分支也接同一支。
    //   ⚠ P1（client 聊天面板）動工前要知道：純文字渲染禁 {@html}；輪詢只在面板開著時 3 秒一發、關掉零請求；
    //      since 用「我已有的最後一則 ts」；204 不帶哨兵是正常（哨兵只在 200 上）；同一對玩家永遠用同一個 fid，但 remove（v1.39）／unblock 真刪（v1.40）都會把對話刪掉 ⇒ 加回後從零開始。
    const FR_DM_COLL = 'tournamentChat';                  // ⭐ 沿用（理由見 ①）
    const FR_DM_ROOM_PREFIX = 'dm:';
    const FR_DM_TTL_MS = 90 * 24 * 60 * 60 * 1000;         // 保留 90 天（站長裁定）
    const FR_DM_MAX_LEN = 200;                             // 與 /api/tournament/chat、休閒房聊天一致
    const FR_DM_PAGE = 50;                                 // 玩家端每發最多 50 則
    const FR_DM_RATE_GAP_MS = 1200, FR_DM_RATE_MIN = 20, FR_DM_RATE_DAY = 500;   // 每人 1.2 秒 1 則／每分鐘 20／每天 500
    const FR_DM_ADMIN_CONV_CAP = 500;                      // admin 總覽硬上限（對話數）
    const FR_DM_ADMIN_PAGE = 200;                          // admin 展開單一對話每發最多 200 則
    // ── 索引：比照 FRIENDS 區塊 —— 只在服務啟動時 lazy 建一次、不 await、.catch() 兜底 ──
    //   ⚠ {expireAt:1}+expireAfterSeconds:0 才是「到點就刪」的正確寫法（tournamentReplayTurns 同款）；
    //     既有 lobby 訊息沒有 expireAt 欄位 ⇒ TTL monitor 不會碰它們。
    try {
      db.collection(FR_DM_COLL).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { /* best-effort，已存在即略過 */ });
      db.collection(FR_COLL).createIndex({ fid: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    } catch (e) { /* db 尚未就緒時略過，不影響服務啟動 */ }
    // ── 子開關（⚠ 預設 false；只有 tournamentConfig.friendsConfig.dm === true 才開；10 秒快取同 friendsEnabled）──
    let _frDmFlag = false, _frDmAt = 0;
    async function friendsDmEnabled() {
      const now = Date.now();
      if (now - _frDmAt < FR_CFG_TTL_MS) return _frDmFlag;
      try {
        const d = await db.collection('tournamentConfig').findOne({ _id: FR_CFG_ID });
        _frDmFlag = !!(d && d.dm === true);
      } catch (e) { /* 讀不到就維持現值 */ }
      _frDmAt = now;
      return _frDmFlag;
    }
    /** 端點共用前置：好友總開關（503）→ dm 子開關（503，不帶哨兵）→ 身分／讓路（_frGate）。回 null 表示已回應。 */
    async function _frDmGate(req, res) {
      if (typeof db === 'undefined' || !db) { res.status(503).json({ error: 'db not ready', code: 'friends-db-not-ready' }); return null; }
      if (!(await friendsEnabled())) { res.status(503).json({ error: '好友功能尚未開放', code: 'friends-disabled' }); return null; }
      if (!(await friendsDmEnabled())) { res.status(503).json({ error: '好友私聊尚未開放', code: 'friends-dm-disabled' }); return null; }
      return await _frGate(req, res);
    }
    // ── 限流（記憶體；key＝我的 email）：1.2 秒間隔＋每分鐘 20＋每天 500 ──
    const _frDmRate = new Map();   // email -> { last, m: [ts...], d: [ts...] }
    function _frDmRateCheck(me, now) {
      now = typeof now === 'number' ? now : Date.now();
      if (_frDmRate.size > 5000) {   // lazy prune：只留最近一天內有活動的
        for (const [k, v] of _frDmRate) { if (!v.d.length || now - v.d[v.d.length - 1] > 86400000) _frDmRate.delete(k); }
      }
      const r = _frDmRate.get(me) || { last: 0, m: [], d: [] };
      r.m = r.m.filter((t) => now - t < 60000);
      r.d = r.d.filter((t) => now - t < 86400000);
      let why = null;
      if (now - r.last < FR_DM_RATE_GAP_MS) why = 'gap';
      else if (r.m.length >= FR_DM_RATE_MIN) why = 'minute';
      else if (r.d.length >= FR_DM_RATE_DAY) why = 'day';
      if (why) { _frDmRate.set(me, r); return why; }
      r.last = now; r.m.push(now); r.d.push(now); _frDmRate.set(me, r);
      return null;
    }
    /** 文字正規化：只收字串（數字／物件一律當空白 ⇒ 400，不讓 '[object Object]' 落地）；\s+ 折成單空白、trim、截 200 字。 */
    function _frDmText(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, FR_DM_MAX_LEN) : ''; }
    /** 找「我有權讀寫的那一段關係」：_frFindMine（a/b＝我）＋ 必須 accepted。回 {cur, room, side} 或 {deny}。 */
    async function _frDmResolve(me, fid) {
      const c = db.collection(FR_COLL);
      const cur = await _frFindMine(c, me.email, fid);
      // ⚠ 關係不存在／pending／rejected／被我封鎖 ⇒ 403 同一個 code（被封鎖方看到的與被解除好友一模一樣，不洩漏封鎖）
      if (!cur) return { deny: 'not-friends' };
      if (cur.status === 'blocked' && cur.blockedBy !== me.email) return { deny: 'silent', cur };   // 被封鎖方：靜默
      if (cur.status !== 'accepted') return { deny: 'not-friends', cur };
      const rfid = cur.fid || _frFid(cur._id);
      return { cur, room: FR_DM_ROOM_PREFIX + rfid, side: cur.a === me.email ? 'a' : 'b', fid: rfid };
    }
    // ── 玩家端回應白名單（⚠⚠ 唯一的對外形狀；永不含 email／side／room）──
    function _frDmPublic(m, mySide) {
      return { id: String(m._id), mine: m.side === mySide, text: typeof m.text === 'string' ? m.text : '', ts: typeof m.ts === 'number' ? m.ts : 0 };
    }
    // ── admin 端回應白名單（可含 email —— admin 專用；與玩家端那份分開，守衛分別斷言）──
    function _frDmAdminRow(m, pair) {
      const from = pair ? (m.side === 'a' ? pair.a : pair.b) : null;
      return { id: String(m._id), side: m.side === 'a' ? 'a' : 'b', from: from || null, text: typeof m.text === 'string' ? m.text : '', ts: typeof m.ts === 'number' ? m.ts : 0, expireAt: (m.expireAt instanceof Date) ? m.expireAt.getTime() : null };
    }
    // ── 端點 ─────────────────────────────────────────────────────────────────
    // POST /api/friends/dm/send {fid, text}
    app.post('/api/friends/dm/send', async (req, res) => {
      try {
        const me = await _frDmGate(req, res); if (!me) return;
        const text = _frDmText(req.body && req.body.text);
        if (!text) return res.status(400).json({ error: '訊息不可空白', code: 'friends-dm-empty', friendsDm: 1 });
        // 限流在文字驗證之後、DB 查詢之前消耗（打錯字不吃額度；洪水不打到 DB）
        const now = Date.now();
        const why = _frDmRateCheck(me.email, now);
        if (why) return res.status(429).json({ error: why === 'gap' ? '發言太快，請稍候' : (why === 'minute' ? '每分鐘最多 ' + FR_DM_RATE_MIN + ' 則私聊' : '今天的私聊額度已用完（每天 ' + FR_DM_RATE_DAY + ' 則）'), code: 'friends-dm-rate-' + why, friendsDm: 1 });
        const r = await _frDmResolve(me, req.body && req.body.fid);
        if (r.deny === 'silent') return res.json({ ok: true, friendsDm: 1 });   // 被封鎖方：回 200 但一個位元都不寫
        if (r.deny) return res.status(403).json({ error: '只能和目前的好友私聊', code: 'friends-dm-not-friends', friendsDm: 1 });
        // ⭐⭐ expireAt 必須是 Date（TTL 只刪 Date 型別；守衛正對照：改成數字要紅）
        const doc = { room: r.room, side: r.side, text, ts: now, expireAt: new Date(now + FR_DM_TTL_MS) };
        const ins = await db.collection(FR_DM_COLL).insertOne(doc);
        res.json({ ok: true, friendsDm: 1, id: String((ins && ins.insertedId) || doc._id || ''), ts: now });
      } catch (e) { _frFail(res, e, 'dm-send'); }
    });
    // GET /api/friends/dm/list?fid=&since=&before=
    //   since>0：只回比 since 新的（升序，最多 50）；**沒有新訊息 ⇒ 204 零 body**（v6.216 手法；client 只在面板開著時 3 秒一發）。
    //   since=0：回「最新」一頁（before>0 ⇒ ts<before 的更舊一頁）＋ hasMore。
    app.get('/api/friends/dm/list', async (req, res) => {
      try {
        const me = await _frDmGate(req, res); if (!me) return;
        const q0 = req.query || {};
        const r = await _frDmResolve(me, typeof q0.fid === 'string' ? q0.fid : '');
        if (r.deny) return res.status(403).json({ error: '只能和目前的好友私聊', code: 'friends-dm-not-friends', friendsDm: 1 });
        const since = Math.max(0, Number(q0.since) || 0);
        const before = Math.max(0, Number(q0.before) || 0);
        const c = db.collection(FR_DM_COLL);
        const proj = { projection: { _id: 1, side: 1, text: 1, ts: 1 } };
        if (since > 0) {
          const docs = await c.find({ room: r.room, ts: { $gt: since } }, proj).sort({ ts: 1 }).limit(FR_DM_PAGE).toArray();
          if (!docs.length) return res.status(204).end();
          return res.json({ friendsDm: 1, fid: r.fid, messages: docs.map((m) => _frDmPublic(m, r.side)), serverNow: Date.now() });
        }
        const q = { room: r.room };
        if (before > 0) q.ts = { $lt: before };
        const docs = (await c.find(q, proj).sort({ ts: -1 }).limit(FR_DM_PAGE).toArray()).reverse();
        const hasMore = docs.length > 0 ? (await c.countDocuments({ room: r.room, ts: { $lt: docs[0].ts } }, { limit: 1 })) > 0 : false;
        res.json({ friendsDm: 1, fid: r.fid, messages: docs.map((m) => _frDmPublic(m, r.side)), hasMore, serverNow: Date.now() });
      } catch (e) { _frFail(res, e, 'dm-list'); }
    });
    // ── admin：檢視（isTournAdmin；不受開關 gate）──
    //   GET /api/friends/admin/dm            總覽：每段對話一列 {fid, a, b, nickA, nickB, status, count, first, last}
    //   GET /api/friends/admin/dm?fid=&before= 展開：該對話最新 200 則（before 分頁）
    app.get('/api/friends/admin/dm', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        if (typeof db === 'undefined' || !db) return res.status(503).json({ error: 'db not ready', code: 'friends-db-not-ready' });
        const y = app.locals && app.locals._adminScanYield;   // ⚠⚠ 跨 IIFE：handler 執行時才取，取不到 fail-closed
        if (typeof y !== 'function') return res.status(503).json({ error: '讓路 helper 未掛載', code: 'friends-helper-missing' });
        const q0 = req.query || {};
        const c = db.collection(FR_DM_COLL), fc = db.collection(FR_COLL);
        if (typeof q0.fid === 'string' && q0.fid) {
          if (!/^[0-9a-f]{8,32}$/.test(q0.fid)) return res.status(400).json({ error: 'fid 格式不對', friendsDm: 1 });
          const pair = await fc.findOne({ fid: q0.fid }, { projection: { _id: 1, fid: 1, a: 1, b: 1, status: 1, nickA: 1, nickB: 1 } });
          const before = Math.max(0, Number(q0.before) || 0);
          const q = { room: FR_DM_ROOM_PREFIX + q0.fid };
          if (before > 0) q.ts = { $lt: before };
          const docs = (await c.find(q, { projection: { _id: 1, side: 1, text: 1, ts: 1, expireAt: 1 } }).sort({ ts: -1 }).limit(FR_DM_ADMIN_PAGE).toArray()).reverse();
          const out = []; let n = 0;
          for (const m of docs) { out.push(_frDmAdminRow(m, pair)); const w = y(++n); if (w) await w; }
          const hasMore = docs.length > 0 ? (await c.countDocuments({ room: q.room, ts: { $lt: docs[0].ts } }, { limit: 1 })) > 0 : false;
          return res.json({ friendsDm: 1, fid: q0.fid, pair: pair ? { a: pair.a, b: pair.b, nickA: pair.nickA || null, nickB: pair.nickB || null, status: pair.status } : null, messages: out, hasMore, page: FR_DM_ADMIN_PAGE });
        }
        // 總覽：分組在 mongod 行程做（$match 前綴走 {room,ts} 索引 → $group → $sort last desc → $limit 硬上限＋1）
        const groups = await c.aggregate([
          { $match: { room: { $regex: '^' + FR_DM_ROOM_PREFIX } } },
          { $group: { _id: '$room', count: { $sum: 1 }, first: { $min: '$ts' }, last: { $max: '$ts' } } },
          { $sort: { last: -1 } },
          { $limit: FR_DM_ADMIN_CONV_CAP + 1 },
        ]).toArray();
        const truncated = groups.length > FR_DM_ADMIN_CONV_CAP;
        if (truncated) groups.length = FR_DM_ADMIN_CONV_CAP;
        const rows = []; let n = 0;
        for (const g of groups) {
          rows.push({ fid: String(g._id).slice(FR_DM_ROOM_PREFIX.length), count: g.count, first: g.first, last: g.last });
          const w = y(++n); if (w) await w;
        }
        // fid → a/b（走 {fid:1} 索引；一發 $in，硬上限同對話數）
        const pairs = new Map();
        if (rows.length) {
          const cur = fc.find({ fid: { $in: rows.map((r) => r.fid) } }, { projection: { _id: 1, fid: 1, a: 1, b: 1, status: 1, nickA: 1, nickB: 1 } }).limit(FR_DM_ADMIN_CONV_CAP);
          let k = 0;
          for await (const d of cur) { pairs.set(d.fid, d); const w = y(++k); if (w) await w; }
        }
        const conversations = rows.map((r) => {
          const p = pairs.get(r.fid);
          return { fid: r.fid, a: p ? p.a : null, b: p ? p.b : null, nickA: p ? (p.nickA || null) : null, nickB: p ? (p.nickB || null) : null, status: p ? p.status : 'gone', count: r.count, first: r.first, last: r.last };
        });
        res.json({ friendsDm: 1, enabled: await friendsEnabled(), dm: await friendsDmEnabled(), conversations, truncated, cap: FR_DM_ADMIN_CONV_CAP, retentionDays: Math.round(FR_DM_TTL_MS / 86400000) });
      } catch (e) { _frFail(res, e, 'admin-dm'); }
    });
    // ── admin：子開關（比照 /api/friends/admin/config；⚠ 不受開關 gate）──
    app.get('/api/friends/admin/dm-config', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        _frCfgAt = 0; _frDmAt = 0;
        res.json({ enabled: await friendsEnabled(), dm: await friendsDmEnabled(), friendsDm: 1, retentionDays: Math.round(FR_DM_TTL_MS / 86400000) });
      } catch (e) { _frFail(res, e, 'admin-dm-config'); }
    });
    app.post('/api/friends/admin/dm-config', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const b = req.body || {};
        if (typeof b.dm !== 'boolean') return res.status(400).json({ error: '需要 dm（true/false）' });
        await db.collection('tournamentConfig').updateOne({ _id: FR_CFG_ID }, { $set: { dm: b.dm, dmUpdatedAt: Date.now() } }, { upsert: true });
        _frCfgAt = 0; _frDmAt = 0;   // 立刻失效，不必等 10 秒快取
        res.json({ ok: true, enabled: await friendsEnabled(), dm: await friendsDmEnabled(), friendsDm: 1 });
      } catch (e) { _frFail(res, e, 'admin-dm-config'); }
    });
    console.log('[friends] dm endpoints registered (v1.38) dm-enabled-by-default=false');
    // <<< PTCG-FRIENDS-DM-BLOCK-END

    app.post('/api/tournament/join', async (req, res) => {
      try {
        const room = String((req.body && req.body.room) || 'TOURNAMENT-TEST');
        const _id = await tournIdentity(req);
        if (_id.error) return res.status(_id.code || 401).json({ error: _id.error });
        const pid = _id.uid;
        const name = _id.name;
        const deckEntries = req.body && req.body.deckEntries;
        if (!Array.isArray(deckEntries) || deckEntries.length === 0) return res.status(400).json({ error: '請先選擇牌組' });
        let doc = await TROOMS.findOne({ _id: room });
        if (!doc) { doc = freshDoc(room); await TROOMS.insertOne(doc); }
        // v6.150 正式賽房（有 matchId）一律要求 verified：seat 是用 doc.seats.indexOf(pid) 算的，
        //   而 pid 在沒有 Bearer token 時來自未驗證的 playerId ⇒ 任何人填上對手 uid 就能拿到
        //   「以對手視角遮蔽」的盤面（＝對手的手牌/牌庫/獎賞全開），也能覆寫該座位的暱稱與牌組。
        //   正式賽的進場路徑本來就是 /match/enter，不會走到這裡。
        if (doc.matchId && !_id.verified) return res.status(403).json({ error: '請用 email 帳號登入後再操作' });
        // v0.41 自我修復：舊版 doc 可能缺 names/decks 陣列（preset 時期殘留）→ 補齊避免 undefined[idx]
        doc.seats = Array.isArray(doc.seats) ? doc.seats : [null, null];
        doc.names = Array.isArray(doc.names) ? doc.names : [null, null];
        doc.decks = Array.isArray(doc.decks) ? doc.decks : [null, null];
        let seat = doc.seats.indexOf(pid);
        if (seat < 0) {
          if (doc.seats[0] == null) seat = 0;
          else if (doc.seats[1] == null) seat = 1;
          else return res.status(409).json({ error: '測試房已滿(2人)，請按「重置房」或換另一台/瀏覽器。' });
        }
        doc.seats[seat] = pid; doc.names[seat] = name; doc.decks[seat] = deckEntries;
        // 整陣列寫回（避免 dotted $set 在缺欄位時把 names/decks 建成物件而非陣列）
        await TROOMS.updateOne({ _id: room }, { $set: { seats: doc.seats, names: doc.names, decks: doc.decks, updatedAt: Date.now() } });
        doc = await maybeStartGame(room, doc);
        return res.json({ seat, gameState: _stateForSeat(doc.gameState, doc.matchId ? seat : TSEAT_NO_REDACT), version: doc.version, waiting: !doc.gameState, seats: doc.seats, names: doc.names });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── v6.152 LONGPOLL BLOCK BEGIN ──
    // `/state?wait=1`：版本相符時**不立刻回**，掛起最多 maxWaitMs 等盤面變動。
    // ⚠ 預設關閉。開之前要在測試站確認三件事（見檔頭 v1.05 說明）。
    // ⚠ 喚醒有兩條路，缺一不可：
    //   ① `/action` 寫入成功後的 in-process 通知（快，~RTT）
    //   ② 掛起期間每 pollMs 自己查一次版本（保險）——pm2 若是 cluster，寫入與掛起可能落在
    //      不同 process，通知跨不過去；scheduler 的判負／時限寫入也不經 `/action`。
    //      沒有這條，那些情況會一路等到逾時才回。
    // ⭐⭐⭐v6.160 報到版本閘（灰度旗標，預設**關閉**）。
    //   ⚠⚠ 預設 `enabled:false` 且 `min:''` —— 沒設定就**不擋任何人**。這條 fail-open 是硬約束：
    //     被擋在報到之外的玩家＝那場比賽他打不了，代價遠高於放一個舊 client 進來。
    //   ⚠⚠⚠ 這個門檻**只對 v6.160 以上的 client 有效** —— 擋人的判斷寫在 client，
    //     而 v6.159 以下的 bundle 根本沒有那段程式碼。想找出那些人請看 reg doc 的
    //     `clientVer`：沒帶 ver 的報到會被記成 `'pre-gate'`，那就是 v6.159 以下。
    //   ⚠ 門檻語義是十進位小數（見 src/lib/version-compare.ts），故 '6.15' 與 '6.150' 相等。
    const TMINVER_DEFAULT = { enabled: false, min: '' };
    const TMINVER_RE = /^\d{1,4}\.\d{1,9}$/;
    let _mvCfg = null, _mvCfgAt = 0;
    async function minVerConfig() {
      const now = Date.now();
      if (_mvCfg && now - _mvCfgAt < 10000) return _mvCfg;
      let doc = null;
      try { doc = await TCONFIG.findOne({ _id: 'minClientVer' }); } catch (e) { /* 讀不到就用預設（關閉） */ }
      const cfg = Object.assign({}, TMINVER_DEFAULT, doc || {});
      cfg.enabled = cfg.enabled === true;                 // 只有明確 true 才算開
      // ⚠ Mongo 可能存成數字（6.150 → '6.15'）。十進位語義下兩者相等，不會靜默降級；
      //   但仍要過 regex，垃圾值一律變空字串 ⇒ client 解析不出來 ⇒ 不擋任何人。
      cfg.min = TMINVER_RE.test(String(cfg.min == null ? '' : cfg.min)) ? String(cfg.min) : '';
      _mvCfg = cfg; _mvCfgAt = now;
      return cfg;
    }
    // ⭐⭐⭐v6.214② 未進場判負的「容許窗」分鐘數 —— **判定端與顯示端的單一來源**。
    //   ⚠⚠ 這支必須被**兩個地方**呼叫，而且只能有這一支：
    //     ①排程器的未進場判負（真正會判人輸的那一段）
    //     ②/event 回給玩家的 `noShowDeadline`（大廳上「請於 X:XX 內進場」那個倒數）
    //   兩邊如果各算各的，玩家就會看到「還剩 2 分鐘」卻被判負 —— 那正是站長最在意的誤判。
    //
    //   語義（每一條都是為了「絕不誤判」而寫的）：
    //     ・`tune.enabled !== true` ⇒ 直接回 base ⇒ **與 v6.213 逐字相同**（灰度可一鍵退回）。
    //     ・`Math.min(base, …)` ⇒ 只會**縮短**，永遠不會把賽事設定的窗拉長
    //       （站長把某場的 noShowMin 設成 2 分時，全域設定不可以把它變回 3 分）。
    //     ・`Math.max(NOSHOW_FLOOR_MIN, …)` ⇒ **硬地板**，admin 誤填 0.1 也不會生效。
    //     ・數值不合法（NaN／<=0）⇒ 回 base，不是回 0（回 0 等於「一開放進場就判負」）。
    //   ⚠ 純函式、零外部相依 ⇒ 守衛可以把它整段抽出來真的跑。
  //   ⚠⚠ **位置**：這支必須定義在錦標賽這個 IIFE **裡面**。第一版誤放在
  //     `import('firebase-admin').then(...)` 那個 callback 內（就在 buildCasualCleanFilter 旁邊），
  //     那是**兄弟作用域** —— `node --check` 過、單元測試也全綠（守衛是把函式字串抽出來自己跑的），
  //     但線上一呼叫就 ReferenceError：/event 直接 500、排程器整段 tick 從這一行之後全部跳過
  //     ⇒ 未進場/閒置/時限判負與輪次推進全失效。這是 v0.94 / v1.01 的第三次重演。
  //     守衛已補一條 acorn 作用域斷言（定義的函式鏈必須是每個呼叫點的前綴）。
    const NOSHOW_FLOOR_MIN = 2;
    function noShowGraceMin(evNoShowMin, tune) {
      const base = Number(evNoShowMin) > 0 ? Number(evNoShowMin) : 5;   // 逐字沿用既有 fallback
      if (!tune || tune.enabled !== true) return base;
      const want = Number(tune.minutes);
      if (!isFinite(want) || want <= 0) return base;
      return Math.min(base, Math.max(NOSHOW_FLOOR_MIN, want));
    }

    // ⭐⭐⭐v6.214② 未進場容許窗的全域設定（站長可在 admin「📡監控」分頁自行微調，不必出新版）。
    //   ⚠ 與其他灰度旗標不同，這一支**預設就是開的** —— 站長裁定「縮短判定窗」，
    //     預設關著等於這一版什麼都沒做。要退回 v6.213 的 5 分鐘只要把它關掉即可。
    //   ⚠ 3 分鐘的依據（不是拍腦袋）：
    //     ①站上既有的 `idleForfeitMin` 預設就是 **3 分鐘** —— 那是判「已經在對戰中、
    //       輪到你動作卻沒動作」的人。未進場者手上的資訊更明確（有 Web Push
    //       「⚔️ 第 N 輪可進場」requireInteraction ＋大廳一直在跑的「請於 X:XX 內進場」倒數），
    //       用同一個 3 分鐘是對稱的、不會比既有標準嚴格。
    //     ②硬地板 2 分鐘 ＋ 只會縮短不會拉長（見 noShowGraceMin）。
    //   ⚠⚠ 我們**沒有**玩家實際進場時間的分佈可以佐證 —— TMATCH 只存 entered 布林。
    //     本版順手補記 `enteredAt`（純遙測、不參與任何判定），下一版起就有真實分佈可以再調。
    const TNS_DEFAULT = { enabled: true, minutes: 3 };
    let _nsCfg = null, _nsCfgAt = 0;
    async function noShowConfig() {
      const now = Date.now();
      if (_nsCfg && now - _nsCfgAt < 10000) return _nsCfg;
      let doc = null;
      try { doc = await TCONFIG.findOne({ _id: 'noShowTune' }); } catch (e) { /* 讀不到就用預設 */ }
      const cfg = Object.assign({}, TNS_DEFAULT, doc || {});
      cfg.enabled = cfg.enabled !== false;                       // 只有明確 false 才算關
      const _m = Number(cfg.minutes);
      cfg.minutes = (isFinite(_m) && _m > 0) ? Math.max(NOSHOW_FLOOR_MIN, Math.min(60, _m)) : TNS_DEFAULT.minutes;
      _nsCfg = cfg; _nsCfgAt = now;
      return cfg;
    }
    const TLP_DEFAULT = { enabled: false, maxWaitMs: 25000, pollMs: 1500, maxHold: 200 };
    let _lpCfg = null, _lpCfgAt = 0;
    async function lpConfig() {
      const now = Date.now();
      if (_lpCfg && now - _lpCfgAt < 10000) return _lpCfg;
      let doc = null;
      try { doc = await TCONFIG.findOne({ _id: 'longPoll' }); } catch (e) { /* 讀不到就用預設（關閉） */ }
      const cfg = Object.assign({}, TLP_DEFAULT, doc || {});
      cfg.enabled = cfg.enabled === true;                                   // 只有明確 true 才算開
      cfg.maxWaitMs = Math.max(1000, Math.min(60000, Number(cfg.maxWaitMs) || TLP_DEFAULT.maxWaitMs));
      cfg.pollMs = Math.max(300, Math.min(10000, Number(cfg.pollMs) || TLP_DEFAULT.pollMs));
      cfg.maxHold = Math.max(1, Math.min(2000, Number(cfg.maxHold) || TLP_DEFAULT.maxHold));
      _lpCfg = cfg; _lpCfgAt = now;
      return cfg;
    }
    // 掛起中的等待者：roomId → Set<finish>。⚠ 用自己維護的 Map 而不是 EventEmitter，
    //   才數得出「現在掛著幾條」——要有上限，否則一波連線就把 VM 的 socket 吃光。
    const _lpWaiters = new Map();
    let _lpHeld = 0;
    function _lpNotify(room) {
      const set = _lpWaiters.get(room);
      if (!set) return;
      for (const fn of Array.from(set)) { try { fn('event'); } catch (e) { /* 單一等待者失敗不影響其他 */ } }
    }
    /** 掛起等待「這個房間的版本不再等於 cv」。回傳喚醒原因：event / poll / timeout / closed / full。 */
    async function _lpWait(room, cv, cfg, req) {
      if (_lpHeld >= cfg.maxHold) return 'full';   // 退化成原本的短輪詢，不是壞掉
      _lpHeld++;
      let timer = null, poller = null, finish = null, onClose = null;
      try {
        return await new Promise((resolve) => {
          let done = false;
          finish = (why) => { if (done) return; done = true; resolve(why); };
          let set = _lpWaiters.get(room);
          if (!set) { set = new Set(); _lpWaiters.set(room, set); }
          set.add(finish);
          timer = setTimeout(() => finish('timeout'), cfg.maxWaitMs);
          poller = setInterval(async () => {
            try {
              const d = await TROOMS.findOne({ _id: room }, { projection: { version: 1 } });
              if (!d || d.version !== cv) finish('poll');
            } catch (e) { /* 忽略單次查詢失敗，下一輪再試 */ }
          }, cfg.pollMs);
          // client 中途離開（關頁、切換對戰）⇒ 立刻釋放，不要佔著連線等滿逾時
          onClose = () => finish('closed');
          try { req.on('close', onClose); } catch (e) { /* */ }
        });
      } finally {
        _lpHeld--;
        if (timer) clearTimeout(timer);
        if (poller) clearInterval(poller);
        if (onClose) { try { req.off ? req.off('close', onClose) : req.removeListener('close', onClose); } catch (e) { /* */ } }
        const set = _lpWaiters.get(room);
        if (set && finish) { set.delete(finish); if (set.size === 0) _lpWaiters.delete(room); }
      }
    }
    // ── v6.152 LONGPOLL BLOCK END ──

    // ── v6.170 CONNECTION RESILIENCE BLOCK BEGIN ──
    /**
     * ⭐⭐⭐v6.170【對手心跳】—— 「鏡像效應」的解藥。
     *
     * v6.159 的資料說得很清楚：`stale-version` 指紋 138 筆裡，**94 筆發生在對手回合、
     * 108 筆自己的輪詢是健康的** ⇒ 多數玩家喊「卡住」其實是**對面那個人斷線**的投影。
     * 一個爛連線讓兩個人一起喊卡，而喊卡的那一位什麼問題都沒有，只看到畫面不動。
     *
     * ⇒ 記錄「每個座位上一次向伺服器要盤面是什麼時候」，讓等待方知道自己在等什麼。
     * ⚠ 心跳記在請求**抵達**當下，不是回應當下 —— 長輪詢會刻意把請求掛起 8~25 秒，
     *   記在回應端的話，一個健康的等待者看起來就會像斷線了 25 秒。
     * ⚠ in-memory：與 `_lpWaiters`／觀戰心跳同一個前提（pm2 fork 單 instance）。
     *   重啟後 map 是空的 ⇒ **一律回「不知道」而不是一個大數字**，否則重啟那一瞬間
     *   全場每個人都會看到「對手連線不穩」——誤報一次，這個提示以後就沒人信了。
     */
    const _seatSeen = new Map();
    function _seatSeenMark(room, seat) {
      if (seat !== 0 && seat !== 1) return;
      // 上限保護：一輪賽事最多幾十個房間，400 是很寬鬆的天花板。超過就丟最舊的鍵。
      if (_seatSeen.size > 400) { const k = _seatSeen.keys().next().value; _seatSeen.delete(k); }
      _seatSeen.set(room + '|' + seat, Date.now());
    }
    /**
     * 對手安靜了幾秒（未達門檻回 0 ＝ 不提示）。
     * ⚠⚠ 門檻由**伺服器自己的長輪詢設定**推導，不讓 client 拿一個寫死的數字去猜：
     *   站長把 maxWaitMs 從 25 秒改成 8 秒（或改回去），寫死門檻的那一版就會開始誤報。
     *   一個健康的長輪詢客戶端最壞情況是「掛滿 maxWaitMs ＋ 一個往返 ＋ 下一次節流」，
     *   所以門檻取 `maxWaitMs * 2 + 8 秒`，且不低於 20 秒（短輪詢是 1.2 秒一發，20 秒＝漏了 16 發）。
     */
    function _oppQuietSec(room, mySeat, lpCfg) {
      if (mySeat !== 0 && mySeat !== 1) return 0;
      const t = _seatSeen.get(room + '|' + (1 - mySeat));
      if (!t) return 0;                       // 沒紀錄 ⇒ 不知道 ⇒ 不提示（fail-closed）
      const quiet = Date.now() - t;
      const hold = (lpCfg && lpCfg.enabled) ? (Number(lpCfg.maxWaitMs) || 0) : 0;
      const th = Math.max(20000, hold * 2 + 8000);
      return quiet >= th ? Math.round(quiet / 1000) : 0;
    }

    /**
     * ⭐⭐⭐v6.170【動作冪等鍵】—— 這一版的主菜。
     *
     * 問題：`POST /action` 逾時或連線斷掉時，玩家**根本不知道那一發有沒有送到**。
     * v6.169 的行為是「回滾樂觀畫面 ＋ 跳一行紅字『動作可能未送達，請重試』」，
     * 也就是把這個不確定性**原封不動丟給玩家**。玩家如果重按，就有機率把同一個動作
     * 套用兩次（附兩次能量、抽兩次牌）；如果不按，動作就真的遺失、然後被閒置判負。
     * ⇒ 只要動作可以安全地自動重送，「間歇性斷流」的代價就從「毀掉一局」降到「延遲幾秒」。
     *
     * 做法：client 對**一個使用者手勢**產生一個 actId，跨所有重送 attempt **保持同一個**；
     * 伺服器把已套用的 actId 記在房間 doc 裡，重送時認出來就不再套用、直接回最新盤面。
     *
     * ⚠⚠⚠ 去重紀錄與盤面**寫在同一次 CAS updateOne 的 $set 裡**（原子），這是整個設計的地基：
     *   兩發同 actId 並發 → 兩發都讀到舊 doc、都沒看到 actId、都算了一次 applyAction，
     *   但 CAS（filter 帶 version）只有一發寫得進去；落敗那發回 stale、client 用**同一個 actId**
     *   重送 → 這次讀到的 doc 已含該 actId → 回 duplicate。**淨結果永遠只套用一次。**
     * ⚠ 用 `recentActs.s0` / `recentActs.s1` 的**點路徑** $set：只碰自己座位那一格，
     *   對手的紀錄一個位元都不會動（也就不可能被對手的動作沖掉，見下面的 TTL 說明）。
     * ⚠ 其他寫盤面的地方（閒置判負／時限／投降／管理員裁定／setup 自癒）用的都是
     *   `$set: {gameState, version, ...}` —— `$set` 只覆蓋列出的欄位，`recentActs`
     *   會原樣留著，所以那些路徑不會抹掉去重歷史（已逐一比對過那 8 個寫入點）。
     * ⚠ 舊 client 不會送 actId ⇒ 完全退回 v6.169 的行為（不查重、不寫紀錄），fail-open。
     */
    // 淘汰一律**只看年齡**：client 端的重送窗上限是 25 秒（見 +page.svelte 的 TACT_RETRY_MS），
    //   120 秒的保存期是它的 4.8 倍 ⇒ 在途的重送絕不可能被淘汰掉。
    //   （若改成「只留最近 N 筆」，對手一個手忙腳亂的回合就能把我在途的紀錄沖掉 ⇒ 重複套用。
    //     這正是 Fable 5 審查抓到的第一個洞；點路徑 $set ＋ 年齡淘汰同時堵掉它。）
    const TACT_RING_TTL_MS = 120000;
    const TACT_RING_MAX = 100;      // 純粹是 doc 大小的天花板（120 秒內超過 100 個動作才會碰到）
    function _actDupHit(doc, seat, actId) {
      if (!actId) return null;
      const ring = (doc && doc.recentActs && doc.recentActs['s' + seat]) || [];
      for (const e of ring) if (e && e.i === actId) return { v: e.v, t: e.t };
      return null;
    }
    function _actRingPush(doc, seat, actId, version, now) {
      const ring = (doc && doc.recentActs && doc.recentActs['s' + seat]) || [];
      const next = [];
      for (const e of ring) {
        if (!e || e.i === actId) continue;
        if (now - (e.t || 0) > TACT_RING_TTL_MS) continue;
        next.push(e);
      }
      next.push({ i: String(actId).slice(0, 64), v: version, t: now });
      while (next.length > TACT_RING_MAX) next.shift();
      return next;
    }
    /**
     * 冪等動作核心。**刻意抽成不碰 express/身分/遮蔽的純邏輯**，守衛才能真的把它跑起來
     * 驗「同一個 actId 送兩次只套用一次」，而不是只驗某個字串存在
     * （v6.154 的教訓：22 條守衛全綠、分頁卻打不開）。
     * ⚠⚠ 查重必須排在 canAct **之前**：重送抵達時動作早就套用完、已經輪到對手了，
     *   先跑 canAct 會回「現在不是你能操作的時機」—— 那等於把一個**成功的動作**
     *   回報成錯誤給玩家看，正好是這一版要修掉的病。
     */
    async function tActionApplyOnce(doc, seat, actId, deps) {
      const dup = _actDupHit(doc, seat, actId);
      if (dup) {
        const fresh = await deps.reload();
        return { kind: 'duplicate', gs: (fresh && fresh.gameState) || doc.gameState, version: fresh ? fresh.version : doc.version };
      }
      if (!deps.canAct(doc.gameState)) return { kind: 'notyourturn', gs: doc.gameState, version: doc.version };
      let newGs;
      try { newGs = deps.applyAction(doc.gameState); }
      catch (e) { return { kind: 'invalid', message: (e && e.message) || String(e), gs: doc.gameState, version: doc.version }; }
      if (newGs === doc.gameState) return { kind: 'rejected', gs: doc.gameState, version: doc.version };
      const now = deps.now();
      const nv = doc.version + 1;
      const set = { gameState: newGs, version: nv, updatedAt: now, lastActionAt: now, actorSeat: deps.actorSeat(newGs) };
      if (actId) set['recentActs.s' + seat] = _actRingPush(doc, seat, actId, nv, now);
      const wr = await deps.cas(doc.version, set);
      if (!wr || wr.matchedCount === 0) {
        const fresh = await deps.reload();
        return { kind: 'stale', gs: (fresh && fresh.gameState) || doc.gameState, version: fresh ? fresh.version : doc.version };
      }
      return { kind: 'applied', gs: newGs, version: nv, prevGs: doc.gameState };
    }
    // ── v6.170 CONNECTION RESILIENCE BLOCK END ──

    app.get('/api/tournament/state', async (req, res) => {
      try {
        const room = String(req.query.room || 'TOURNAMENT-TEST');
        const cv = Number(req.query.v);
        // v0.68 降載：先取「不含 gameState 大欄位」的輕量 doc 比對版本。client 版本相符(cv===version)→
        //   回精簡 unchanged(免序列化/傳輸整個盤面,亦免從 mongo 拉大欄位),大幅降低對戰中每 1.2s×N 人
        //   輪詢的 CPU/頻寬。僅版本不同(或 cv<0 強制重抓)才第二次查詢取完整 gameState。
        let light = await TROOMS.findOne({ _id: room }, { projection: { gameState: 0 } });
        if (!light) return res.json({ version: -1, waiting: true });
        // ⭐v6.170 對手心跳：在**這裡**（請求剛抵達、長輪詢還沒掛起）記下我這一座位還活著。
        //   `s` 是 client 自報的座位；只影響「要不要顯示連線提示」這件純視覺的事，
        //   既不進遮蔽判定、也不碰閒置判負，所以不需要（也刻意不做）身分驗證——
        //   /state 在遮蔽關閉時本來就不驗身分，為了一個提示去加 verifyIdToken 是本末倒置。
        const _hbSeat = Number(req.query.s);
        _seatSeenMark(room, _hbSeat);
        // ── v6.152 長輪詢：版本相符 且 client 明確要求 且 旗標已開 → 掛起等盤面變動 ──
        //   旗標關著時這一整段不會執行，行為與上一版逐字相同。
        const _lpCfgNow = await lpConfig();
        await redactEnabled();   // v6.153 順便刷新遮蔽旗標（10 秒快取）
        let _waited = 0;
        if (_lpCfgNow.enabled && String(req.query.wait || '') === '1'
            && Number.isFinite(cv) && cv >= 0 && cv === light.version) {
          const _lpT0 = Date.now();
          const _why = await _lpWait(room, cv, _lpCfgNow, req);
          if (_why === 'closed') return;              // client 走了，不要再寫回應（會 ERR_STREAM_WRITE_AFTER_END）
          _waited = Date.now() - _lpT0;
          if (_why !== 'full') {
            light = await TROOMS.findOne({ _id: room }, { projection: { gameState: 0 } });
            if (!light) return res.json({ version: -1, waiting: true });
          }
        }
        if (Number.isFinite(cv) && cv >= 0 && cv === light.version) {
          const _un = { version: light.version, unchanged: true, seats: light.seats, names: light.names, lastActionAt: light.lastActionAt || null, idleForfeitMin: light.idleForfeitMin || 3, serverNow: Date.now() };
          // ⭐v6.170 對手安靜太久 ⇒ 帶一個秒數給 client 顯示「對手連線不穩」。
          //   ⚠ 未達門檻／沒紀錄時**整個欄位省略**（不是回 0 或 false）——
          //     client 的判準是「有這個欄位才提示」，省略即 fail-closed，舊 client 也自然無感。
          const _oq = _oppQuietSec(room, _hbSeat, _lpCfgNow);
          if (_oq) _un.oppQuietSec = _oq;
          // ⚠ 欄位缺席（v6.151 部署前就已開打的房、或測試房）**不要**回 null ——
          //   client 會把 null 當成權威的「無人該動作」而不是「伺服器沒講」，閒置倒數會整條消失。
          //   而挂機中的房永遠不會有 /action 來補寫這個欄位 ⇒ 正好在最需要倒數的情境失效。
          //   省略這個鍵，client 的 `'actorSeat' in r` 判準就會自然退回本地推算。
          if (typeof light.actorSeat === 'number') _un.actorSeat = light.actorSeat;
          // v6.152：longPoll 告訴 client「伺服器已啟用長輪詢」（它據此決定要不要送 wait=1 並放寬逾時）；
          //   waited 則是這一發實際掛了多久（0 = 沒掛起）。
          _un.longPoll = _lpCfgNow.enabled;
          if (_waited) _un.waited = _waited;
          return res.json(_un);
        }
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc) return res.json({ version: -1, waiting: true });
        // v6.153 ⚠ 遮蔽關閉時**完全不做身分判定**，直接走「不遮」的哨兵值。
        //   只把 401 關掉是不夠的：`_viewerSeat` 認不出座位會回 -1，而 -1 在 _redactStateForSeat
        //   裡是「觀戰視角 ⇒ 兩邊都遮」——玩家會拿到一份連自己手牌都是卡背的 200，
        //   而且因為不是 401，前端的 tAuthLost 橫幅與「刷新 token 自救」入口都不會出現（靜默壞盤面）。
        //   順帶：關閉時省掉每一發完整回應的 verifyIdToken 開銷。
        const _vseat = _redactOn() ? await _viewerSeat(req, doc) : TSEAT_NO_REDACT;
        // v6.150 ⚠ 認不出座位時**不能**回一份雙邊都遮的 200 —— client 會照單全收，
        //   玩家自己的手牌整排變成卡背（正是 clientdiag 在抓的「隱形手牌」指紋）。
        //   回 401 讓前端走既有的失聯處理與重新登入，比靜默給錯盤面誠實。
        if (_vseat === -1) return res.status(401).json({ error: '登入狀態已失效，請重新登入後再回到對戰' });
        // v6.151 actorSeat：完整回應這裡有盤面，直接用同一支 currentActorSeat 現算（最權威，
        //   也不依賴 doc 欄位存不存在）；unchanged 精簡回應沒有盤面，才讀存下來的欄位。
        const _actorSeat = doc.gameState ? currentActorSeat(doc.gameState) : null;
        const _oqFull = _oppQuietSec(room, _hbSeat, _lpCfgNow);   // v6.170 同上：0 ⇒ 省略欄位
        res.json({ longPoll: _lpCfgNow.enabled, waited: _waited || undefined, gameState: _stateForSeat(doc.gameState, _vseat), version: doc.version, seats: doc.seats, names: doc.names, actorSeat: _actorSeat, waiting: !doc.gameState, lastActionAt: doc.lastActionAt || null, idleForfeitMin: doc.idleForfeitMin || 3, serverNow: Date.now(), oppQuietSec: _oqFull || undefined });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/tournament/action', async (req, res) => {
      try {
        const room = String((req.body && req.body.room) || 'TOURNAMENT-TEST');
        const _id = await tournIdentity(req);
        if (_id.error) return res.status(_id.code || 401).json({ error: _id.error });
        const pid = _id.uid;
        const action = req.body && req.body.action;
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc) return res.status(404).json({ error: 'no room' });
        const seat = doc.seats.indexOf(pid);
        if (seat < 0) return res.status(403).json({ error: '你不在這個房間' });
        // v6.150 正式賽房一律要求 verified 身分：tournIdentity 的 playerId fallback 可以隨便填 uid，
        //   而雙方 uid 就在 /state 的 seats 裡 ⇒ 未驗證身分本來就能替對手送動作、也能換到未遮蔽盤面。
        if (doc.matchId && !_id.verified) return res.status(403).json({ error: '請用 email 帳號登入後再操作' });
        const _vseat = doc.matchId ? seat : TSEAT_NO_REDACT;   // v6.150 回應一律走遮蔽出口
        const gs = doc.gameState;
        if (!gs) return res.json({ error: '對局尚未開始', waiting: true, version: doc.version });
        if (!action || !action.type) return res.status(400).json({ error: 'no action' });
        // ⭐⭐⭐v6.170 冪等鍵（client 產生，跨所有重送 attempt 不變）。舊 client 不送 ⇒ 空字串 ⇒
        //   `tActionApplyOnce` 不查重也不寫紀錄，行為與 v6.169 逐字相同（fail-open）。
        const actId = String((req.body && req.body.actId) || '').slice(0, 64);
        const _verdict = await tActionApplyOnce(doc, seat, actId, {
          reload: function () { return TROOMS.findOne({ _id: room }); },
          canAct: function (g) { return canSeatAct(g, seat, action); },
          applyAction: function (g) { return TENG.applyAction(g, normalizeAction(action, seat), TPOOL); },
          // v6.151 伺服器權威 actorSeat：寫盤面的同時把「現在輪到誰」一起存進 doc 頂層。
          actorSeat: currentActorSeat,
          now: Date.now,
          // v5.598 樂觀並發控制（CAS）：filter 帶 version，只在版本沒被其他並發動作改寫時才寫入。
          cas: function (expectVer, set) { return TROOMS.updateOne({ _id: room, version: expectVer }, { $set: set }); },
        });
        if (_verdict.kind === 'duplicate') {
          // ⭐ 重送抵達、而這個動作**早就成功套用過**了 ⇒ 回最新盤面，不是回錯誤。
          //   這一行就是「玩家網路斷了 12 秒卻不會毀掉一局」的差別所在。
          return res.json({ duplicate: true, gameState: _stateForSeat(_verdict.gs, _vseat), version: _verdict.version, actorSeat: _verdict.gs ? currentActorSeat(_verdict.gs) : null });
        }
        if (_verdict.kind === 'notyourturn') return res.json({ error: '現在不是你能操作的時機', gameState: _stateForSeat(_verdict.gs, _vseat), version: _verdict.version });
        if (_verdict.kind === 'invalid') return res.json({ error: '動作無效：' + _verdict.message, gameState: _stateForSeat(_verdict.gs, _vseat), version: _verdict.version });
        if (_verdict.kind === 'rejected') return res.json({ rejected: true, gameState: _stateForSeat(_verdict.gs, _vseat), version: _verdict.version });
        if (_verdict.kind === 'stale') return res.json({ rejected: true, stale: true, gameState: _stateForSeat(_verdict.gs, _vseat), version: _verdict.version });
        const newGs = _verdict.gs;
        const nv = _verdict.version;
        _lpNotify(room);   // v6.152 盤面已寫入 → 立刻叫醒掛在這個房間的長輪詢（~RTT 就看得到）
        // v0.82 回放:半回合快照(先攻/後攻各一格)——activePlayerIndex 改變=回合換手邊界;開局(setup→playing)也存一格。fire-and-forget 不 await 不影響回應。
        if (doc.matchId) {
          const _enteredPlay = gs.phase !== 'playing' && newGs.phase === 'playing';
          const _halfTurnBoundary = newGs.activePlayerIndex !== gs.activePlayerIndex;
          if (_enteredPlay || _halfTurnBoundary) snapshotTurn(doc.matchId, doc.eventId, newGs);
        }
        if (newGs.phase === 'game-over' && doc.matchId) { try { await onMatchGameOver(doc, newGs); } catch (e) { console.warn('[tournament] match advance failed:', e && e.message); } }
        res.json({ gameState: _stateForSeat(newGs, _vseat), version: nv, actorSeat: currentActorSeat(newGs) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── v6.156 STILL HERE BLOCK BEGIN ──
    /**
     * v6.156「我還在」：閒置判負倒數剩 60 秒時 client 彈確認框，玩家按下去就重置倒數。
     * 站長裁定：①點了就重置、**不限次數** ②所有閒置情境都彈 ③死角點了仍卡住 → 改判平手＋通知站長。
     *
     * ⚠⚠ **只有「該動作的那一方」能重置**（這一條交接文件沒寫，是實作時查證後補的）：
     *   閒置倒數的語意就是「該動作方沒動作」。若放行等待方呼叫，等待方就能替**掛機的對手**
     *   無限續命 —— 判負機制直接失效，而且是對手幫他做的，掛機者本人什麼都不用做。
     *   `actor === -1`（雙方都該動作＝死角）時兩邊都放行，那正是這個功能要救的情境。
     * ⚠ 只 `$set: { lastActionAt }`，**不整包寫回 gameState**（v6.151 idleWarn60 的教訓：
     *   非終局的整包寫回一定要 CAS，否則會蓋掉玩家剛送出的動作、而且版本號一樣讓自癒失效）。
     *   只碰一個純量欄位 ⇒ 不需要 CAS。**也刻意不 bump version** —— 盤面一個位元都沒變，
     *   bump 了只會讓兩邊 client 各抓一份完整盤面，白花流量。
     * ⚠ 對局時限已到（timeLimitReached）之後**不再重置**：否則拖延方每 3 分鐘點一次，
     *   「打完最後回合」就永遠打不完，對局時限這個天花板形同虛設。
     */
    app.post('/api/tournament/still-here', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const room = String((req.body && req.body.room) || '');
        if (!room) return res.status(400).json({ error: '缺少房間' });
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc) return res.status(404).json({ error: '房間不存在' });
        // 正式賽房一律要求已驗證身分（與 /action、/join 同一標準：擋「替對手按我還在」）
        if (doc.matchId && !id.verified) return res.status(403).json({ error: '請重新登入後再試' });
        const seat = Array.isArray(doc.seats) ? doc.seats.indexOf(id.uid) : -1;
        if (seat !== 0 && seat !== 1) return res.status(403).json({ error: '你不在這場對戰中' });
        const gs = doc.gameState;
        if (!gs || gs.phase === 'game-over') return res.json({ ok: false, reason: 'game-over' });
        const actor = currentActorSeat(gs);
        if (!(actor === seat || actor === -1)) return res.json({ ok: false, reason: 'not-your-turn' });
        if (doc.matchId) {
          const _m = await TMATCH.findOne({ _id: doc.matchId }, { projection: { timeLimitReached: 1 } });
          if (_m && _m.timeLimitReached) return res.json({ ok: false, reason: 'time-limit' });
        }
        const now = Date.now();
        await TROOMS.updateOne({ _id: room }, { $set: { lastActionAt: now } });
        res.json({ ok: true, lastActionAt: now, actorSeat: (typeof actor === 'number' ? actor : null) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // ── v6.156 STILL HERE BLOCK END ──

    app.post('/api/tournament/reset', async (req, res) => {
      try {
        const room = String((req.body && req.body.room) || 'TOURNAMENT-TEST');
        const prev = await TROOMS.findOne({ _id: room });
        const nv = ((prev && prev.version) || 0) + 1;
        // v6.170 房間重建 ⇒ 一併清掉冪等去重紀錄（留著不會造成錯誤——actId 是 UUID，
        //   舊紀錄只可能讓一個「屬於上一局的重送」被正確地擋下來——但留著純粹是垃圾）。
        await TROOMS.updateOne({ _id: room }, { $set: { seats: [null, null], names: [null, null], decks: [null, null], gameState: null, version: nv, updatedAt: Date.now(), recentActs: { s0: [], s1: [] } } }, { upsert: true });
        res.json({ ok: true, version: nv, waiting: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // v0.77 客戶端診斷回傳(client 端 desync 定根因/確認用)——client 只在真異常指紋才回傳,寫 tournamentClientDiag
    //   (TTL 7天自動清)。tournIdentity 驗證擋匿名 + per-uid 60s 記憶體節流 + body 8KB cap(v6.184 由 2KB 放大) + fail-silent,絕不影響對戰路徑。
    const TCDIAG = db.collection('tournamentClientDiag');
    TCDIAG.createIndex({ ts: 1 }, { expireAfterSeconds: 604800 }).catch(() => { /* TTL index best-effort */ });
    // ⭐⭐⭐ v6.213【② 低頻無條件取樣的指紋】——**唯一來源**，admin 端點與
    //   oracle-admin/tournament/dump-client-monitor.cjs 都必須用同一份清單。
    //   ⚠⚠ 這一類 reason 是「健康對照組」，**不是異常**。把它混進既有的
    //     byReason／slowRtt／版本分佈裡看，會讓**所有既有數字失真**（分母突然多了一批
    //     完全健康的樣本）—— v6.198 的教訓就是分母污染會讓人做出相反的結論。
    //     ⇒ 從查詢層就分開，不是在畫面上再挑。
    //   ⭐v6.261 休閒批也有自己的健康對照組（casual-perf-sample）——同樣是「不是異常」，
    //     一樣要從查詢層就排除在異常統計之外。
    const SAMPLE_REASONS = ['perf-sample', 'casual-perf-sample'];
    function isSampleReason(r) { return SAMPLE_REASONS.indexOf(String(r || '')) >= 0; }
    // ⭐⭐⭐v6.261 休閒批的判準：reason 以 `casual-` 為前綴（client 端 CASUAL_DIAG_REASONS 全部照這個規則命名）。
    //   ⚠⚠ 休閒與錦標賽是**兩個母體**：休閒是 client-authoritative、每個動作上傳整包盤面（40~48KB），
    //     錦標賽走 /action 由伺服器權威推進 —— 「一次往返」的定義根本不同 ⇒ **兩批數字永遠不可以相加**。
    //   ⚠ 分帳一律從**查詢層**做（同 v6.213 的紀律），不是在畫面上再挑。
    //   ⭐ /api/tournament/admin/clientdiag 的預設是 `q.mode = { $ne: 'casual' }`＝錦標賽批，
    //     而且**把沒有 mode 欄位的舊列也收進來**（欄位缺席＝v6.260 以前的舊列，不是休閒）
    //     ⇒ v6.260 以前的每一個數字逐字不變、可以跟舊 dump 對帳。
    //     要看休閒批必須明確帶 `?mode=casual`，或用 oracle-admin/tournament/dump-client-monitor.cjs。
    const CASUAL_REASON_PREFIX = 'casual-';
    function isCasualReason(r) { return String(r || '').indexOf(CASUAL_REASON_PREFIX) === 0; }
    // ⭐⭐v6.160 節流 key 由 uid 改成 **uid|reason**。
    //   原本 per-uid 不分 reason 會讓「後送的那一則」被前一則吃掉，而後送的往往才是真訊號：
    //     ・既有案例（v6.155 已在 client 端繞過）：剛按過手動同步 ⇒ 緊接著的 setup-watchdog-repeat 被丟掉。
    //     ・v6.160 新案例：checkin-update-prompted（開視窗）→ 玩家幾秒內按下選擇 ⇒
    //       checkin-update-skipped / checkin-stale-after-update **必然**落在同一個 60 秒窗內 ⇒ 100% 被丟掉，
    //       而 checkin-stale-after-update 正是這一版最該追的一則（＝清了快取還是舊版）。
    //   每個 reason 各自 60 秒，防洪水的效果不變（單一玩家仍無法用同一種指紋洗版）。
    const _cdiagThrottle = new Map();  // `${uid}|${reason}` -> lastAt(記憶體節流)
    // ⭐⭐⭐v6.184 診斷 payload 上限 2048 → 8192，而且**截斷不再靜默**。
    //   事故：v6.179 把 `perf.res.seg`（連線分段）拆出來之後，最近一批 dump 有 16 筆剛好卡在
    //   2048 字元 —— 全部集中在 v6.179/180/182，其中一位玩家（尾巴最重的那位）的**四段資料
    //   整組不見**。真兇是 v6.171 的 `svelteWarn.first`（最多 3 筆 × 700 字元的 stack）：
    //   payload 的 key 順序是 … perf → svelteWarn → env，超過上限被切掉的一定是尾端，
    //   而**切過的字串不再是合法 JSON** ⇒ /admin/clientdiag 建 slowRtt 那張表時，
    //   JSON.parse 失敗的列是「直接略過」⇒ 那幾列**不會出現在 RTT 表上**，
    //   而且 perf 四段資料已經毀掉、任何工具都算不回來。
    //   ⚠ 措辭要精確（Fable 5 審查更正，已自行查證）：`byReason` 統計 group 的是獨立的
    //     `reason` 欄位，「最近 120 筆明細」也是原樣吐 diag 字串 ⇒ **那兩處看得到**；
    //     看不到的是 RTT 表，以及那筆 payload 裡真正有價值的 perf/env 內容。
    //   ⚠ 上限存在的理由沒有變（擋 client 灌爆 DB），所以不是拿掉而是放大：
    //     實測 payload 的結構上界 ≈ 非 svelteWarn 1.8KB ＋ svelteWarn 2.3KB ≈ 4.1KB，8KB 有 2 倍餘裕。
    //   ⚠⚠ 這**不會**增加任何頻寬：client 本來就把完整 payload 送上來，2048 只影響「存多少」。
    //   ⚠⚠ 一律回傳 `truncated` / `rawLen` 兩個欄位（**不是只有被切時才寫**）——
    //     欄位缺席只能代表「這是 v6.184 之前的舊列」，不可以被讀成「這列沒被切」。
    function _cdiagPack(body) {
      let raw;
      try { raw = JSON.stringify(body || {}); } catch (e) { raw = null; }   // 循環參照 / toJSON 拋錯
      // JSON.stringify(undefined) 會回 undefined（不是字串）⇒ 一律正規化，絕不讓 .length 炸。
      if (typeof raw !== 'string') raw = '{}';
      const LIMIT = 8192;   // 8KB。⚠ 改這個數字要同步 oracle-admin/tournament/dump-client-monitor.cjs 的 DIAG_CAP。
      if (raw.length <= LIMIT) return { s: raw, truncated: false, rawLen: raw.length };
      // ⚠⚠ slice 切的是 **UTF-16 code unit**，emoji（surrogate pair）可能被切成兩半。
      //   JSON.stringify 從 ES2019 起是 well-formed（孤兒 surrogate 會被跳脫成 \udXXX 六個字元），
      //   所以孤兒 surrogate **只可能**由這一刀製造出來，而且只會落在最後一個 code unit。
      //   實測 Buffer.from('ab\uD83D','utf8') → 61 62 ef bf bd（替換成 U+FFFD，不會 throw），
      //   所以留著也不至於讓 insertOne 爆掉；但既然一個判斷就能完全避免，就避免。
      //   （這個切法在 v6.184 之前的 slice(0, 2048) 也一樣存在，不是這一版新引入的。）
      let cut = LIMIT;
      const _last = raw.charCodeAt(cut - 1);
      if (_last >= 0xD800 && _last <= 0xDBFF) cut = LIMIT - 1;   // 高位 surrogate 落在尾端 ⇒ 退一格
      return { s: raw.slice(0, cut), truncated: true, rawLen: raw.length };
    }
    app.post('/api/tournament/clientdiag', async (req, res) => {
      try {
        const _id = await tournIdentity(req);
        if (_id.error) return res.json({ ok: false });  // 未驗證靜默丟棄,不擋
        const uid = _id.uid, now = Date.now();
        const _thKey = uid + '|' + String((req.body && req.body.reason) || '');   // v6.160 per-(uid,reason)
        if (now - (_cdiagThrottle.get(_thKey) || 0) < 60000) return res.json({ ok: true, throttled: true });  // 每種指紋各自 60s
        _cdiagThrottle.set(_thKey, now);
        // key 變細了（uid × reason），上限跟著放大；仍是 FIFO 淘汰最舊的一筆。
        if (_cdiagThrottle.size > 2000) { const k = _cdiagThrottle.keys().next().value; _cdiagThrottle.delete(k); }  // 防 map 無限長大
        const _p = _cdiagPack(req.body);   // v6.184：8KB cap，且把「有沒有被切／原本多長」一起存下來
        // ⭐v6.261 `mode` 由 reason 前綴推導（**伺服器推導，不採信 client 送上來的 mode 欄位**：
        //   reason 本來就決定了分帳，多一個可被偽造的欄位只會多一種對不起來的可能）。
        //   ⚠ v6.260 以前的舊列沒有這個欄位 ⇒ 查詢端一律用 `{$ne:'casual'}` 把它們收進錦標賽批（欄位缺席＝舊列，不是休閒）。
        await TCDIAG.insertOne({ ts: now, uid, email: _id.email || null, room: String((req.body && req.body.room) || ''), reason: String((req.body && req.body.reason) || ''), mode: isCasualReason((req.body && req.body.reason)) ? 'casual' : 'tournament', diag: _p.s, truncated: _p.truncated, rawLen: _p.rawLen });
        res.json({ ok: true });
      } catch (e) { try { res.json({ ok: false }); } catch (_e2) { /* */ } }
    });

    // ── v6.154 admin 監控：把 client 回傳的異常指紋讀出來 ──────────────────
    // v0.77 起這些資料一直在寫，但**從來沒有讀的地方** —— 「很卡」的回報只能靠玩家口述還原。
    // 回三塊：①各指紋的次數與**受影響人數**（人數比次數重要：同一人重複觸發不代表全站問題）
    //         ②slow-rtt 的往返時間分佈（伺服器端指標不含隧道排隊與玩家網路，這才對得上體感）
    //         ③最近 N 筆明細（diag 是 client 存的 JSON 字串，原樣回傳給 admin 頁展開）
    app.get('/api/tournament/admin/clientdiag', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const hours = Math.max(1, Math.min(168, Number(req.query.hours) || 24));
        const since = Date.now() - hours * 3600000;
        const q = { ts: { $gte: since } };
        const _wantCasual = String(req.query.mode || '') === 'casual';   // v6.261 分帳見 isCasualReason
        q.mode = _wantCasual ? 'casual' : { $ne: 'casual' };
        // ⭐⭐⭐v6.269 休閒批走**完全獨立**的一條路徑（早退）；理由與紀律見 _buildCasualDiagReport。
        //   ⚠⚠ 跨 IIFE：那支 helper 必須定義在 firebase-admin 區塊內（中央 adminScanYield 在那裡），
        //     而本區塊是**另一個** IIFE ⇒ 一律在 **handler 執行時**從 app.locals 取
        //     （v0.94／v1.01 兩次線上事故；node --check 抓不到跨 closure 的作用域問題）。
        //   ⚠ 取不到一律 **fail-closed 回 503**：絕不退回去跑一份沒有讓路節拍的掃描。
        if (_wantCasual) {
          const _cb = (app.locals || {})._buildCasualDiagReport;
          if (typeof _cb !== 'function') return res.status(503).json({ error: '休閒批彙總尚未就緒（伺服器仍在啟動，或 admin 區塊尚未載入完成）' });
          return res.json(await _cb(TCDIAG, since, hours));
        }
        if (req.query.reason) q.reason = String(req.query.reason);
        else q.reason = { $nin: SAMPLE_REASONS };   // v6.213 見檔案下方 SAMPLE_REASONS 的說明
        const rows = await TCDIAG.find(q).sort({ ts: -1 }).limit(120).toArray();
        // ⚠ 統計要對**整個時間窗**算，不能只算上面那 120 筆（不然數字會被 limit 截斷而失真）
        const _aggAll = await TCDIAG.aggregate([
          { $match: { ts: { $gte: since } } },
          { $group: { _id: '$reason', n: { $sum: 1 }, uids: { $addToSet: '$uid' } } },
        ]).toArray();
        const agg = _aggAll.filter(function (a) { return !isCasualReason(a._id); });   // v6.261 休閒批整批拿掉
        const byReason = agg
          .filter(function (a) { return !isSampleReason(a._id); })   // v6.213 分帳：這一份只留**異常**
          .map(function (a) { return { reason: a._id || '(未標)', n: a.n, players: (a.uids || []).length }; })
          .sort(function (x, y) { return y.n - x.n; });
        // slow-rtt 的往返時間：diag 內的 poll.rtt（v6.151 起才有）
        const rttRows = await TCDIAG.find({ ts: { $gte: since }, reason: 'slow-rtt' }).sort({ ts: -1 }).limit(200).toArray();
        const p95s = [];
        for (const r of rttRows) {
          try {
            const d = JSON.parse(r.diag || '{}');
            const rt = d && d.poll && d.poll.rtt;
            if (rt && typeof rt.p95 === 'number') p95s.push({
              ts: r.ts, email: r.email || null, p50: rt.p50, p95: rt.p95, max: rt.max, n: rt.n,
              // ⭐v6.159：client 把往返拆成 token/網路/JSON 解析/總計，另外回報 tAdopt 採納耗時、
              //   重繪代理與 longtask ⇒ 這才分得出「網路慢」與「這台裝置的主執行緒慢」。
              //   ⚠ 舊版 client 送上來的 payload **沒有** perf / env.hc / env.dm ⇒ 一律可能不存在。
              //     這裡一律正規化成 null（不要留 undefined：JSON.stringify 會把欄位整個吃掉，
              //     顯示端就分不出「舊 client」與「這欄真的是 0」）。
              perf: (d && d.perf) || null,
              hc: (d && d.env && typeof d.env.hc === 'number') ? d.env.hc : null,
              dm: (d && d.env && typeof d.env.dm === 'number') ? d.env.dm : null,
            });
          } catch (e) { /* 舊格式或壞掉的 payload 直接略過 */ }
        }
        // ⭐⭐⭐v6.213 分帳：取樣列走**完全獨立**的一份 aggregate、一份查詢、一份陣列。
        //   刻意不共用 byReason／p95s —— 共用就等於把健康樣本混進「異常次數」與「最慢的玩家」，
        //   那兩張表的意義會整個變掉（分母污染，v6.198 的教訓）。⚠ 兩邊的數字永遠不可相加。
        const sampleAgg = agg.filter(function (a) { return isSampleReason(a._id); });
        const sampleTotals = sampleAgg.reduce(function (acc, a) {
          acc.n += a.n; (a.uids || []).forEach(function (u) { acc.uidSet[u] = 1; }); return acc;
        }, { n: 0, uidSet: {} });
        // ⚠⚠ v6.261 這一發**必須**補 mode 條件：SAMPLE_REASONS 從此含 'casual-perf-sample'，
        //   不補就會把休閒的健康樣本混進錦標賽的健康對照組（正是 v6.213 要防的分母污染，只是換了一批）。
        const sampleRttRows = await TCDIAG.find({ ts: { $gte: since }, mode: { $ne: 'casual' }, reason: { $in: SAMPLE_REASONS } }).sort({ ts: -1 }).limit(200).toArray();
        const samplePerf = [];
        const _extract = function (r, out) {
          try {
            const d = JSON.parse(r.diag || '{}');
            const rt = d && d.poll && d.poll.rtt;
            out.push({
              ts: r.ts, email: r.email || null, reason: r.reason || '',
              p50: (rt && typeof rt.p50 === 'number') ? rt.p50 : null,
              p95: (rt && typeof rt.p95 === 'number') ? rt.p95 : null,
              max: (rt && typeof rt.max === 'number') ? rt.max : null,
              n: (rt && typeof rt.n === 'number') ? rt.n : null,
              perf: (d && d.perf) || null,
              hc: (d && d.env && typeof d.env.hc === 'number') ? d.env.hc : null,
              dm: (d && d.env && typeof d.env.dm === 'number') ? d.env.dm : null,
              ver: (d && typeof d.ver === 'string') ? d.ver : null,
            });
          } catch (e) { /* 被截斷／壞掉的 payload 直接略過 */ }
        };
        for (const r of sampleRttRows) _extract(r, samplePerf);
        res.json({
          hours: hours, byReason: byReason, slowRtt: p95s,
          // ⭐⭐⭐v6.213 健康對照組（低頻無條件取樣）。⚠ **不可以**與 byReason／slowRtt 相加。
          //   n=0 有兩種完全不同的可能：①這段期間真的沒有人中籤（1% × 場次數）
          //   ②玩家的畫面還沒更新到 v6.213 —— 看 `rows` 裡的 ver 分佈才分得出來。
          sample: {
            reasons: SAMPLE_REASONS,
            n: sampleTotals.n,
            players: Object.keys(sampleTotals.uidSet).length,
            perf: samplePerf,
            note: '低頻無條件取樣（每場對戰 1%）＝健康對照組，與異常指紋分開統計，兩者不可加總。',
          },
          rows: rows.map(function (r) {
            // ⭐v6.184：把伺服器寫入時記下的截斷痕跡一併回給畫面。
            //   ⚠ 舊列沒有這兩個欄位 ⇒ truncated 一律正規化成布林（undefined 會被
            //     JSON.stringify 整個吃掉，畫面就分不出「舊列」與「這列沒被切」）。
            return {
              ts: r.ts, email: r.email || null, room: r.room || '', reason: r.reason || '', diag: r.diag || '',
              truncated: r.truncated === true,
              rawLen: (typeof r.rawLen === 'number' && isFinite(r.rawLen)) ? r.rawLen : null,
            };
          }),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ════════════════════════════════════════════════════════════════════
    // Phase1-B：賽事 collections + 報名（一次一 active 賽事；單敗淘汰 Bo1）
    // ════════════════════════════════════════════════════════════════════
    const TEVENTS = db.collection('tournamentEvents');
    // v6.120：TEVENTS 原本**除了 _id 完全沒有索引**，但 status 是全站最常被過濾的欄位
    //   （listOpenEvents 的 $ne:'finished'、排程器每 tick 的 find({status:'running'})、
    //     社群賽的 createdByPlayer + status）。賽事只增不減，久了每次都是全集合掃描。
    //   索引不改變查詢結果（只換 query plan），且只在服務啟動時建一次。
    TEVENTS.createIndex({ status: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    const TREGS = db.collection('tournamentRegistrations');
    // v6.119 效能：TREGS 從來沒有索引，但它是**永久累積**的（正常完賽不刪報名，
    //   而且 v0.84 預填暱稱、v0.90 聊天暱稱都刻意依賴歷史報名）。熱路徑全是全表掃：
    //     ・/event 每人每 3 秒 find({ uid })          ← 最痛，人數 × 歷屆報名量
    //     ・getEventShared 的 countDocuments({ eventId })、報到名單 find({ eventId })
    //   索引不可能改變查詢結果（只換 query plan），且只在服務啟動時建一次（部署本來就會重啟）。
    TREGS.createIndex({ uid: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    TREGS.createIndex({ eventId: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    const TADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    function isTournAdmin(id) { return !!(id && id.verified && id.email && TADMIN_EMAILS.includes(String(id.email).toLowerCase())); }
    // v0.40 多賽事：可同時公布多場（時間不重疊），玩家各自報名。
    //   listOpenEvents＝所有未結束賽事；getEventById＝精確定位；resolveEventFromReq＝端點優先吃 body/query 的 eventId，
    //   無 eventId 時 fallback getActiveEvent（向後相容尚未多賽事化的舊前端）。
    async function listOpenEvents() {
      return await TEVENTS.find({ status: { $ne: 'finished' } }).sort({ createdAt: 1 }).toArray();
    }
    async function getEventById(eventId) {
      if (!eventId) return null;
      return await TEVENTS.findOne({ _id: String(eventId) });
    }
    // 舊前端相容：多場開放時挑「最該顯示」的一場（running > checkin > bracket_ready > registration > draft，同階取 createdAt 最早）。
    const _EV_RANK = { running: 0, checkin: 1, bracket_ready: 2, registration: 3, draft: 4 };
    // v6.120 中央收斂：把「挑最該顯示的一場」的排序抽成純函式，讓 /event 可以直接餵 3 秒快取的
    //   openList（不必再打一次未快取的 listOpenEvents）。getActiveEvent 改呼叫它 ⇒ 排序規則只有
    //   一份，兩條路徑不會漂移。
    //   ⚠ **必須 slice() 再 sort**：呼叫端可能傳進來的是 _eventShared.openList（快取物件本身），
    //     in-place 排序會把快取的順序改成「顯示優先序」，而 /event 回傳的 events 清單依賴
    //     原本的 createdAt 順序 ⇒ 會靜默改變前端賽事列表的排列。
    function pickActiveFromList(list) {
      if (!list || !list.length) return null;
      const all = list.slice();
      all.sort((a, b) => ((_EV_RANK[a.status] != null ? _EV_RANK[a.status] : 9) - (_EV_RANK[b.status] != null ? _EV_RANK[b.status] : 9)) || ((a.createdAt || 0) - (b.createdAt || 0)));
      return all[0];
    }
    async function getActiveEvent() {
      return pickActiveFromList(await listOpenEvents());
    }
    // 端點解析目標賽事：優先 body/query 的 eventId（多賽事化的 admin/前端），否則 fallback 舊單場行為。
    async function resolveEventFromReq(req) {
      const eid = (req.body && req.body.eventId) || (req.query && req.query.eventId) || null;
      if (eid) return await getEventById(eid);
      return await getActiveEvent();
    }
    // v0.34：把 deckEntries 轉成可貼回「編輯我的牌組」匯入功能的文字格式
    function deckEntriesToText(entries, deckName) {
      const lines = ['// ' + (deckName || '牌組'), ''];
      if (Array.isArray(entries)) {
        for (const e of entries) {
          const c = TPOOL.get(String(e.cardId));
          if (c) lines.push(e.count + ' ' + (c.name || '') + ' ' + (c.setCode || '') + ' ' + (c.collectorNumber || ''));
          else lines.push(e.count + ' (未知卡 ' + e.cardId + ')');
        }
      }
      return lines.join('\n');
    }
    function deckCount(entries) {
      if (!Array.isArray(entries)) return -1;
      let n = 0; for (const e of entries) n += (e && e.count) || 0; return n;
    }

    // 玩家：目前賽事 + 我的報名狀態
    // 玩家：報到（僅報到階段；已報名者才能報到）
    app.post('/api/tournament/checkin', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (tournRequireVerified(id, res, 'checkin')) return;   // ⭐⭐⭐v6.291 冒名報名閘（helper 定義在 tournIdentity 正下方）
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(409).json({ error: '目前沒有賽事' });
        if (ev.status !== 'checkin') return res.status(409).json({ error: '目前不在報到階段' });
        // ⭐⭐v6.160 記錄報到當下的 client 版本。
        //   ⚠⚠ **後端永遠不因為版本拒絕報到** —— 擋人的判斷只在 client，且處處 fail-open。
        //     在這裡加 gate 等於製造「玩家自己救不了自己」的死路，硬約束明文禁止。
        //   ⭐ 沒帶 ver ＝ 對方是 v6.159 以下的舊 bundle（那些版本的報到請求不送這個欄位）。
        //     這是目前**唯一**能識別出「線上還有誰停在版本閘之前」的訊號，一定要留下來。
        const _rawVer = (req.body && typeof req.body.ver === 'string') ? req.body.ver.trim().slice(0, 16) : '';
        const _clientVer = _rawVer ? (TMINVER_RE.test(_rawVer) ? _rawVer : 'invalid') : 'pre-gate';
        // ⭐⭐⭐v6.189：報到收進**同一條 seed 序列鎖**（v6.188 只收了補報名端點，
        //   同一類臨界區留兩套做法本身就是隱患）。原本的殘窗：這裡讀到 status==='checkin' 之後、
        //   TREGS 寫入之前，排程器可能剛好 CAS 成 bracket_ready 並開始 seed —— 而 seed 讀 TREGS
        //   是在鎖內，寫得再快也來不及，玩家會拿到 200 卻沒被排進賽程。
        //   收進鎖之後只剩兩種結局：報到先拿到鎖 ⇒ 寫入必定早於 seed 讀 TREGS ⇒ 一定在賽程裡；
        //   seed 先拿到鎖 ⇒ 報到拿到鎖時重讀已非 checkin ⇒ 明確 409。
        //   ⚠⚠ **權杖驗證與事件解析一律留在鎖外**：tournIdentity 會打 Firebase，是這支端點最慢的一段，
        //     收進鎖等於讓每個人排隊等別人的網路往返。鎖內只有 3 個本機 mongo 操作。
        //   ⚠ 不可重入：鎖內完全不呼叫 seedEventBracket / runInSeedChain，不會自己等自己。
        // ⚠⚠ Fable 5 審查（中）：收進全域序列鎖之後，一個**掛住不 settle** 的 mongo 操作
        //   會凍結**所有人**的報到（driver 預設 socketTimeoutMS=0 即無限，TCP 半開就是這型態）。
        //   runInSeedChain 只對 **rejection** 有兌底，對「永不 settle」沒辦法 ⇒ 臨界區自帶上限，
        //   逾時就 reject（鏈會繼續往下走，排在後面的人不會被連坐）。
        //   ⚠ 計時在**拿到鎖之後**才開始（寫在 fn 內），不會把「排隊等 seed」算進來誤殺。
        //   ⚠ 逾時不會取消底層寫入 ⇒ 可能「看到錯誤但其實已報到」，再按一次就拿到 200；
        //     反過來的「回 200 卻沒進賽程」才是不能接受的，這裡沒有製造那種情況。
        const CHECKIN_LOCK_CAP_MS = 15000;
        const out = await runInSeedChain(() => {
          const _job = (async () => {
          // 臨界區內一律重讀（鎖外讀到的 status 都可能已經過期）。
          const _fresh = await TEVENTS.findOne({ _id: ev._id }, { projection: { status: 1 } });
          if (!_fresh || _fresh.status !== 'checkin') return { code: 409, error: '報到已截止，本場賽程即將產生。' };
          const reg = await TREGS.findOne({ _id: ev._id + '__' + id.uid });
          if (!reg) return { code: 409, error: '你未報名本賽事，無法報到' };
          if (reg.autoRemovedConflict) return { code: 409, error: '你仍在其他進行中的賽事，本場已自動取消你的報名（避免同時被兩場召喚，待其他賽事結束後可再參加）。' };
          await TREGS.updateOne({ _id: reg._id }, { $set: { checkedIn: true, clientVer: _clientVer, checkedInAt: Date.now() } });
          return { ok: true };
          })();
          // Promise.race 會對兩邊都掛 handler，所以 _job 就算晚一步 reject 也不會變成 unhandledRejection。
          let _t = null;
          const _cap = new Promise((_r, _rj) => { _t = setTimeout(() => _rj(new Error('報到暫時無法處理（資料庫沒有回應），請再按一次')), CHECKIN_LOCK_CAP_MS); });
          return Promise.race([_job, _cap]).finally(() => { if (_t) clearTimeout(_t); });
        });
        if (out && out.ok) return res.json({ ok: true });
        return res.status((out && out.code) || 409).json({ error: (out && out.error) || '報到失敗' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.69 降載：/event 是大廳最重端點——原每次呼叫 8~12 次 mongo(對每個開放賽事各 findOne+countDocuments
    //   的 N+1、重複 listOpenEvents、每個 running event 各一次 TMATCH.findOne)。輪次交替 ~50 人同時在大廳每 3s
    //   打一次 → 尖峰。改:①「共用重查詢」(所有使用者相同:開放賽事清單+每場 regCount+running events)3s TTL 快取;
    //   ②per-user(我的報名/我的對戰)改單次批次查詢(我的所有報名一次抓、跨 running 賽事用 $in 一次抓我的對戰),
    //   取代 N+1 findOne。使用者自身狀態(registered/checkedIn/myMatch)仍每請求新鮮,只有聚合(清單/count)快取 ≤3s。
    let _eventShared = { at: 0, openList: [], regCounts: {}, runningEvents: [] };
    const EVENT_SHARED_TTL_MS = 3000;
    async function getEventShared() {
      const now = Date.now();
      if (_eventShared.at && (now - _eventShared.at) <= EVENT_SHARED_TTL_MS) return _eventShared;
      const openList = await listOpenEvents();
      const regCounts = {};
      for (const _e of openList) regCounts[_e._id] = await TREGS.countDocuments({ eventId: _e._id });
      const runningEvents = await TEVENTS.find({ status: 'running' }).toArray();
      _eventShared = { at: now, openList, regCounts, runningEvents };
      return _eventShared;
    }
    app.get('/api/tournament/event', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        // v6.120 降載：/event 是全站最高頻的端點（每人每 3 秒）。原本第一行 resolveEventFromReq
        //   會走 getActiveEvent → listOpenEvents，也就是**每個請求各一次未快取的**
        //   `TEVENTS.find({ status: { $ne: 'finished' } })`；而下一行的 getEventShared() 早就把
        //   **同一份清單**快取了 3 秒。改成先取 shared、再從 shared.openList 解析現行賽事。
        //   ⚠ 只改這個唯讀端點。`resolveEventFromReq` 本身一個字都不動 —— register/checkin/
        //     admin 那些**會寫入**的端點仍走未快取的新鮮讀取，絕不用 3 秒前的狀態做寫入決策。
        //   ⚠ 帶了 eventId 但不在開放清單裡（例如查看已結束的賽事）→ 仍用 getEventById 精確補查，
        //     行為與原本的 resolveEventFromReq 完全相同。
        const shared = await getEventShared();
        const _reqEid = (req.body && req.body.eventId) || (req.query && req.query.eventId) || null;
        let ev;
        if (_reqEid) ev = shared.openList.find((e) => e._id === String(_reqEid)) || await getEventById(_reqEid);
        else ev = pickActiveFromList(shared.openList);
        // per-user：一次抓我的所有報名（取代原對每個開放賽事各一次 findOne 的 N+1）
        // v6.119 降載：以前這裡把「本人所有歷屆報名」的完整 doc（含各 60 張 deckEntries）
        //   整包拉回來，但 handler 只用到 eventId/name/deckName/checkedIn/autoRemovedConflict/
        //   registeredAt，**只有「當前賽事那一筆」需要 deckEntries**（算 deckCount）。
        //   老玩家累積數十筆報名 ≈ 每 3 秒白拉上百 KB。改成 projection 掉 deckEntries，
        //   需要的那一筆再用 _id 點查補回（走主鍵，極便宜）。
        const myRegs = await TREGS.find({ uid: id.uid }, { projection: { deckEntries: 0 } }).toArray();
        const myRegBy = new Map(myRegs.map((r) => [r.eventId, r]));
        let me = { registered: false, checkedIn: false };
        if (ev) {
          const reg = myRegBy.get(ev._id);
          // v6.119：deckEntries 已被 projection 掉，這一筆單獨補查（_id 點查）。
          //   ⚠ deckCount(undefined) 會回 -1（非 0），前端會誤顯示 → 一定要補回來。
          const _regDeck = reg ? await TREGS.findOne({ _id: reg._id }, { projection: { deckEntries: 1 } }) : null;
          if (reg) me = { registered: true, checkedIn: !!reg.checkedIn, deckCount: deckCount(_regDeck && _regDeck.deckEntries), name: reg.name, deckName: reg.deckName || null, autoRemovedConflict: !!reg.autoRemovedConflict, dropped: !!reg.dropped, lateJoin: !!reg.lateJoin };
        }
        // v0.84 預填暱稱:附「最近一次報名的暱稱」供前端未報名任何賽事時預填(從已抓的 myRegs 取最新,無額外查詢);從沒報過退帳號顯示名 id.name
        const _lastReg = myRegs.filter((r) => r.name).sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0))[0];
        me.lastName = (_lastReg && _lastReg.name) || id.name || null;
        let regCount = 0;
        if (ev) regCount = (shared.regCounts[ev._id] != null) ? shared.regCounts[ev._id] : await TREGS.countDocuments({ eventId: ev._id });
        // myMatch：跨所有 running 賽事，一次 $in 查詢我的未完成對戰（取代每 running event 各一次 findOne）
        let myMatch = null;
        // ⭐v6.214②：讀一次設定給下面的 noShowDeadline 用。讀不到就傳 null ⇒ noShowGraceMin
        //   回 base ⇒ 與 v6.213 逐字相同（fail-open：設定掛掉時只會變回比較寬鬆的舊值）。
        let _nsTuneForEvent = null;
        try { _nsTuneForEvent = await noShowConfig(); } catch (e) { /* 用 base */ }
        if (shared.runningEvents.length) {
          const _runIds = shared.runningEvents.map((e) => e._id);
          const _myMatches = await TMATCH.find({ eventId: { $in: _runIds }, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null }, $or: [{ p1uid: id.uid }, { p2uid: id.uid }] }).toArray();
          for (const _e of shared.runningEvents) {
            const mm = _myMatches.find((m) => m.eventId === _e._id && m.round === _e.currentRound);
            if (mm) {
              const cdMin = (_e.roundCountdownMin != null ? _e.roundCountdownMin : 3);
              // ⭐v6.214②：這裡算的是玩家**看到的**倒數，必須與排程器判負用的是同一支函式、
              //   同一份設定，否則就會出現「畫面說還有 2 分鐘、伺服器已經判你輸」。
              const nsMin = noShowGraceMin(_e.noShowMin, _nsTuneForEvent);
              const enterOpenAt = (_e.roundStartedAt || 0) + cdMin * 60000;
              const mySeat = (mm.p1uid === id.uid) ? 0 : 1;
              myMatch = { matchId: mm._id, eventId: _e._id, round: mm.round, oppName: (mm.p1uid === id.uid ? mm.p2name : mm.p1name), enterOpenAt, noShowDeadline: enterOpenAt + nsMin * 60000, entered: !!(mm.entered && mm.entered[mySeat]), roomId: mm.roomId || null };
              break;
            }
          }
        }
        // v0.40：附上所有開放中賽事清單（多賽事前端用；舊前端忽略此欄、仍讀單一 event）
        const _events = shared.openList.map((_e) => {
          const _reg = myRegBy.get(_e._id);
          return { _id: _e._id, name: _e.name, status: _e.status, maxPlayers: _e.maxPlayers, regCount: shared.regCounts[_e._id] || 0, registrationOpenAt: _e.registrationOpenAt || null, registrationCloseAt: _e.registrationCloseAt || null, roundLimitMin: _e.roundLimitMin, currentRound: _e.currentRound, rounds: _e.rounds, championName: _e.championName || null, registered: !!_reg, checkedIn: !!(_reg && _reg.checkedIn), autoRemovedConflict: !!(_reg && _reg.autoRemovedConflict), dropped: !!(_reg && _reg.dropped), lateJoin: !!(_reg && _reg.lateJoin), myDeckName: (_reg && _reg.deckName) || null, myName: (_reg && _reg.name) || null, checkInDeadline: _e.checkInDeadline || null, format: _e.format || 'single-elim', swissRounds: _e.swissRounds || null, topCut: _e.topCut || null, createdByPlayer: !!_e.createdByPlayer, minPlayers: _e.minPlayers || null, proposerName: _e.proposerName || null, isProposer: !!(_e.proposerUid && _e.proposerUid === id.uid) };
        });
        // v0.78 輪空玩家也看倒數:無 myMatch 時查我本輪的輪空 match(bye,p1uid=我),回輪次進場窗(enterOpenAt)供前端顯示倒數+提示可觀戰。
        let myBye = null;
        if (!myMatch && shared.runningEvents.length) {
          const _runIdsB = shared.runningEvents.map((e) => e._id);
          const _byes = await TMATCH.find({ eventId: { $in: _runIdsB }, bye: true, p1uid: id.uid }).toArray();
          for (const _e of shared.runningEvents) {
            const _bm = _byes.find((m) => m.eventId === _e._id && m.round === _e.currentRound);
            if (_bm) { const _cd = (_e.roundCountdownMin != null ? _e.roundCountdownMin : 3); myBye = { eventId: _e._id, round: _bm.round, enterOpenAt: (_e.roundStartedAt || 0) + _cd * 60000 }; break; }
          }
        }
        // ⭐v6.160 報到版本閘門檻。關閉／未設定 ⇒ 回空字串 ⇒ client 不擋任何人。
        //   ⚠ 這個值最長會有 ~13 秒的延遲才生效（minVerConfig 10 秒 TTL ＋ /event 3 秒共用快取），
        //     admin 改完別急著判定「沒生效」。
        let _mvc = null;
        try { _mvc = await minVerConfig(); } catch (e) { /* 讀不到 ⇒ 當作沒設定，不擋人 */ }
        const _minClientVer = (_mvc && _mvc.enabled) ? (_mvc.min || '') : '';
        res.json({ event: ev || null, me, regCount, isAdmin: isTournAdmin(id), myMatch, myBye, events: _events, minClientVer: _minClientVer, serverNow: Date.now() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 玩家：報名（鎖定牌組，一帳號一名額）
    app.post('/api/tournament/register', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (tournRequireVerified(id, res, 'register')) return;   // ⭐⭐⭐v6.291 冒名報名閘（helper 定義在 tournIdentity 正下方）
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(409).json({ error: '目前沒有開放報名的賽事' });
        if (ev.status !== 'registration') return res.status(409).json({ error: '目前不在報名階段' });
        const deckEntries = req.body && req.body.deckEntries;
        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });
        const nickname = String((req.body && req.body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 16);
        if (!nickname) return res.status(400).json({ error: '請填寫錦標賽暱稱' });
        const regId = ev._id + '__' + id.uid;
        const existing = await TREGS.findOne({ _id: regId });
        if (existing) return res.status(409).json({ error: '你已經報名了（牌組已鎖定，整賽不可更換）' });
        // 人數上限（maxPlayers=null 表示不限）
        if (ev.maxPlayers != null) {
          const cnt = await TREGS.countDocuments({ eventId: ev._id });
          if (cnt >= ev.maxPlayers) return res.status(409).json({ error: '報名人數已滿（' + ev.maxPlayers + ' 人）' });
        }
        const deckName = String((req.body && req.body.deckName) || '').slice(0, 40);
        const cp = String((req.body && req.body.coinPref) || 'random');
        const coinPref = (cp === 'first' || cp === 'second') ? cp : 'random'; // 硬幣勝出時 先攻/後攻/隨機
        // ⭐v6.276 套牌戰績（P3a）：client（v6.277+）報名可附 deckId。⚠⚠ 純 additive ——
        //   沒送／不合格／淨化 helper 取不到（跨 IIFE：v0.94/v1.01/v6.269 教訓，handler 執行時
        //   才從 app.locals 取）⇒ **欄位缺席**（絕不寫 null；缺席才是「舊 client」的唯一表示法，
        //   也才不會被歸檔側的 sparse 索引收進去）。既有欄位一個字都不動、絕不因 deckId 擋報名。
        const _sanDid = (app.locals && app.locals._sanitizeDeckId) || null;
        const _deckId = _sanDid ? _sanDid(req.body && req.body.deckId) : null;
        await TREGS.insertOne({ _id: regId, eventId: ev._id, uid: id.uid, email: id.email || null, name: nickname, deckName, deckEntries, coinPref, checkedIn: false, registeredAt: Date.now(), ...(_deckId ? { deckId: _deckId } : {}) });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ⭐⭐⭐v6.188 補報名＋直接報到（站長核准，網站賽與社群賽都開放）。
    //   報到階段才發現「啊我忘了報名」的人，過去只能乾等下一場；此時賽程還沒產生，收進來零成本。
    //   ⚠⚠ 這支端點唯一的死線是「絕不能有顯示成功卻沒排進賽程」：
    //     ①驗證**完全複用** /register（60 張、暱稱、coinPref、maxPlayers）—— 不另寫一套會漂移的規則。
    //     ②**單筆 insertOne** 一次寫到位（checkedIn:true ＋ lateJoin:true），不做「先報名再報到」兩段
    //       （兩段之間掉線＝報了名沒報到，比不給補報還糟）。
    //     ③整段跑在 **seed 序列鎖** 內，與 _seedEventBracketImpl 讀 TREGS 互斥；
    //       寫入後**再讀一次 status**，已非 checkin 就把剛寫的 reg 刪掉並回 409。
    //       兩者合起來只會有兩種結局：**要嘛被收進賽程、要嘛明確被拒**。
    //       （單靠重讀是不夠的：若 seed 已把 regs 讀進記憶體，我們刪了 reg 它照樣把人排進賽程
    //         ⇒ 那才是最惡劣的「TREGS 沒人、TMATCH 有人」孤兒。序列鎖就是為了排除這個交錯。）
    //   ⚠ 窗口關閉點沿用既有那次 checkin→bracket_ready 的 CAS，這裡不新增任何關閉邏輯。
    app.post('/api/tournament/register-and-checkin', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (tournRequireVerified(id, res, 'register-and-checkin')) return;   // ⭐⭐⭐v6.291 冒名報名閘（helper 定義在 tournIdentity 正下方）
        // ⚠ 走 resolveEventFromReq（TEVENTS.findOne 新鮮讀），**不是** /event 那份 3 秒共用快取——
        //   會寫入的端點絕不用 3 秒前的狀態做決策（見 getEventShared 上方註解）。
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(409).json({ error: '目前沒有賽事' });
        if (ev.status !== 'checkin') return res.status(409).json({ error: '目前不在報到階段' });
        // ── 驗證：與 /register 逐條相同 ──
        const deckEntries = req.body && req.body.deckEntries;
        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });
        const nickname = String((req.body && req.body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 16);
        if (!nickname) return res.status(400).json({ error: '請填寫錦標賽暱稱' });
        const deckName = String((req.body && req.body.deckName) || '').slice(0, 40);
        const cp = String((req.body && req.body.coinPref) || 'random');
        const coinPref = (cp === 'first' || cp === 'second') ? cp : 'random';
        const _rawVer = (req.body && typeof req.body.ver === 'string') ? req.body.ver.trim().slice(0, 16) : '';
        const _clientVer = _rawVer ? (TMINVER_RE.test(_rawVer) ? _rawVer : 'invalid') : 'pre-gate';
        // ⭐v6.276：deckId 同 /register（純 additive；沒送／不合格／取不到 helper ⇒ 欄位缺席）。
        const _sanDid = (app.locals && app.locals._sanitizeDeckId) || null;
        const _deckId = _sanDid ? _sanDid(req.body && req.body.deckId) : null;
        const regId = ev._id + '__' + id.uid;
        const out = await runInSeedChain(async () => {
          // 臨界區內一律重讀，鎖外讀到的值都可能過期。
          const _fresh0 = await TEVENTS.findOne({ _id: ev._id }, { projection: { status: 1 } });
          if (!_fresh0 || _fresh0.status !== 'checkin') return { code: 409, error: '報到已截止，本場賽程即將產生。' };
          const existing = await TREGS.findOne({ _id: regId });
          if (existing) {
            // 三條分支之二：被衝突剔除者一律拒絕（與 /checkin 同一套說法，不給他從側門回來）。
            if (existing.autoRemovedConflict) return { code: 409, error: '你仍在其他進行中的賽事，本場已自動取消你的報名（避免同時被兩場召喚，待其他賽事結束後可再參加）。' };
            // 三條分支之一：既有報名者走既有 /checkin，不從這裡蓋掉他鎖定的牌組。
            return { code: 409, error: '你已經報名了（牌組已鎖定），請直接按「✋ 我要報到」。' };
          }
          // 三條分支之三：人數上限（maxPlayers=null 表不限）—— 與 /register 同一條規則。
          if (ev.maxPlayers != null) {
            const cnt = await TREGS.countDocuments({ eventId: ev._id });
            if (cnt >= ev.maxPlayers) return { code: 409, error: '報名人數已滿（' + ev.maxPlayers + ' 人）' };
          }
          const _now = Date.now();
          await TREGS.insertOne({
            _id: regId, eventId: ev._id, uid: id.uid, email: id.email || null, name: nickname,
            deckName, deckEntries, coinPref, checkedIn: true, lateJoin: true,
            registeredAt: _now, checkedInAt: _now, clientVer: _clientVer,
            ...(_deckId ? { deckId: _deckId } : {}),
          });
          // ⚠⚠ 這一手把 TOCTOU 關死：窗口若在我們寫入的同時關上，就把自己收回去並明確拒絕。
          const _fresh1 = await TEVENTS.findOne({ _id: ev._id }, { projection: { status: 1 } });
          if (!_fresh1 || _fresh1.status !== 'checkin') {
            await TREGS.deleteOne({ _id: regId });
            return { code: 409, error: '報到已截止，本場賽程即將產生。' };
          }
          return { ok: true };
        });
        if (out && out.ok) return res.json({ ok: true, lateJoin: true });
        return res.status((out && out.code) || 409).json({ error: (out && out.error) || '補報名失敗' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.53 玩家發起社群賽。
    app.post('/api/tournament/propose', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!id.email) return res.status(403).json({ error: '發起社群賽需要 email 帳號（不開放匿名）' });
        const b = req.body || {};
        const now = Date.now();
        const deckEntries = b.deckEntries;
        if (deckCount(deckEntries) !== 60) return res.status(400).json({ error: '牌組需為 60 張' });
        const nickname = String(b.nickname || '').replace(/\s+/g, ' ').trim().slice(0, 16);
        if (!nickname) return res.status(400).json({ error: '請填寫錦標賽暱稱' });
        const fmt = (b.format === 'swiss' || b.format === 'swiss-then-cut') ? 'swiss-then-cut' : 'single-elim';
        // v0.95 新增 5 分鐘：給「已經在聊天室約好人、只想快點走完流程」的情境。
        //   ⚠白名單與前端的下拉必須同時更新，否則前端送 5 會被這裡靜默 fallback 成 30。
        const rallyMin = [5, 15, 30, 60].includes(Number(b.rallyMin)) ? Number(b.rallyMin) : 30;
        const minPlayers = fmt === 'swiss-then-cut' ? 8 : 4;
        // 全站同時僅 1 個社群賽
        const liveComm = await TEVENTS.findOne({ createdByPlayer: true, status: { $ne: 'finished' } });
        if (liveComm) return res.status(409).json({ error: '目前已有一場社群賽進行中，請等它結束後再發起。' });
        // v0.97 Wilson 裁定：**取消發起者冷卻**，社群賽可連續發起。
        //   ⚠原本這裡有一段「30 分鐘冷卻」，但它其實**從來沒有生效過**——判斷依據是
        //   `myLast[0].finishedAt`，而全檔 12 個把賽事設成 status:'finished' 的寫入點
        //   **沒有任何一處**寫過 TEVENTS.finishedAt（finishedAt 只寫進 TCHAMPS / TARCHIVE）。
        //   也就是說線上行為一直都是「沒有冷卻」，這段只是誤導人的死碼，直接移除讓程式碼與實際一致。
        //   濫用防護仍在：**全站同時只允許 1 場社群賽**（上面那道 liveComm 檢查）。
        // v0.70：官方＋社群賽改為可並行舉辦，原「官方賽事避讓」(開賽前 1h / 進行中禁辦) 已移除。
        //   同一玩家被兩場同時召喚的問題改由 seedEventBracket 開賽配對前自動移除較晚那場的重複玩家處理。
        // 建賽事 + 自動把發起者報名
        const ev = {
          _id: 'evt_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
          createdAt: now,
          name: String(b.eventName || (nickname + ' 的社群賽')).slice(0, 60),
          format: fmt, bestOf: 1,
          createdByPlayer: true, proposerUid: id.uid, proposerName: nickname, minPlayers,
          status: 'registration',
          registrationOpenAt: null, registrationCloseAt: now + rallyMin * 60000,
          maxPlayers: null, roundLimitMin: 25, noShowMin: 5, roundCountdownMin: 3,
          checkInEnabled: true, currentRound: 0,
          createdBy: id.email || id.uid,
        };
        if (fmt === 'swiss-then-cut') { ev.swissRounds = 0; ev.topCut = 0; ev.phase = 'swiss'; }
        await TEVENTS.insertOne(ev);
        // ⭐v6.276：發起者自動報名同樣可附 deckId（純 additive；規則同 /register）。
        const _sanDid = (app.locals && app.locals._sanitizeDeckId) || null;
        const _deckId = _sanDid ? _sanDid(b.deckId) : null;
        const cp0 = String(b.coinPref || 'random');
        await TREGS.insertOne({ _id: ev._id + '__' + id.uid, eventId: ev._id, uid: id.uid, email: id.email || null, name: nickname, deckName: String(b.deckName || '').slice(0, 40), deckEntries, coinPref: (cp0 === 'first' || cp0 === 'second') ? cp0 : 'random', checkedIn: false, registeredAt: now, ...(_deckId ? { deckId: _deckId } : {}) });
        await postSystemChat('📣 玩家發起社群賽「' + ev.name + '」（' + (fmt === 'swiss-then-cut' ? '瑞士制+TopCut' : '單淘汰') + '）！募集 ' + rallyMin + ' 分鐘、期間都可報名，時間到達 ' + minPlayers + ' 人以上就能開賽，快來「響應」報名～');
        // v0.98 推播給全站（排除發起者本人；已關閉此類通知者不推）。
        //   Wilson 裁定內容＝賽事名稱＋賽制與開賽門檻＋募集剩餘時間（不含發起人暱稱），
        //   （原 v0.98 是「對戰中也推」，Wilson 於 v0.99 更正為跳過。）
        //   fire-and-forget：推播失敗絕不能影響賽事建立本身。
        //   v0.99 Wilson 更正:**跳過正在對戰中的玩家**(錦標賽與休閒皆是),不打擾比賽中的人。
        void (async () => {
          const busy = await getBusyUids();
          await broadcastPush({
            title: '📣 有人發起社群賽',
            body: ev.name + '｜' + (fmt === 'swiss-then-cut' ? '瑞士制+TopCut' : '單淘汰')
              + '・滿 ' + minPlayers + ' 人開賽・' + rallyMin + ' 分鐘內募集',
            tag: 'ptcg-t-community',
            url: '/game?tournament=1',
          }, { excludeUid: id.uid, excludeUids: busy, prefKey: 'notifyCommunity' });
        })();
        res.json({ ok: true, event: ev });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 玩家：退賽（僅報名階段）
    app.post('/api/tournament/unregister', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await resolveEventFromReq(req);
        if (!ev || ev.status !== 'registration') return res.status(409).json({ error: '目前無法退賽' });
        await TREGS.deleteOne({ _id: ev._id + '__' + id.uid });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // v0.55 發起者取消社群賽（僅 createdByPlayer 社群賽、報名階段、報名人數未達門檻；
    //   原子搶占 status registration→finished 防與 scheduler 開賽競態；釋放全站 1 場名額）
    app.post('/api/tournament/cancel-proposal', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await resolveEventFromReq(req);
        if (!ev || !ev.createdByPlayer) return res.status(404).json({ error: '找不到社群賽' });
        if (ev.proposerUid !== id.uid) return res.status(403).json({ error: '只有發起者本人可以取消這場社群賽' });
        if (ev.status !== 'registration') return res.status(409).json({ error: '比賽已開始，無法取消' });
        const minP = ev.minPlayers || 4;
        const regN = await TREGS.countDocuments({ eventId: ev._id });
        if (regN >= minP) return res.status(409).json({ error: '報名人數已達門檻（' + regN + '/' + minP + ' 人），比賽即將開始，無法取消' });
        // 原子搶占：只有「仍在 registration」才取消，避免與排程器同一刻開賽的競態
        const r = await TEVENTS.updateOne({ _id: ev._id, status: 'registration' }, { $set: { status: 'finished', cancelled: true, championUid: null, championName: null } });
        if (r.matchedCount !== 1) return res.status(409).json({ error: '比賽狀態剛變更，無法取消（可能已達門檻開賽）' });
        await postSystemChat('🚫 發起者取消了社群賽「' + ev.name + '」（報名 ' + regN + '/' + minP + ' 人，未達門檻）。');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：建立賽事
    // v6.153 玩家端遮蔽開關（預設關閉）。⚠ 開啟前請留意：遮蔽會讓「前端自己攔截去讀對手隱藏區」
    //   的卡片相依浮現（v6.150 已修過 concealed picker 那一類，但無法保證沒有漏網的）。
    app.get('/api/tournament/admin/redact', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        res.json({ enabled: await redactEnabled() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/admin/redact', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const b = req.body || {};
        if (typeof b.enabled !== 'boolean') return res.status(400).json({ error: '需要 enabled（true/false）' });
        await TCONFIG.updateOne({ _id: 'redactState' }, { $set: { enabled: b.enabled } }, { upsert: true });
        _redactAt = 0;   // 立刻失效，不必等 10 秒快取
        res.json({ ok: true, enabled: await redactEnabled() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v6.152 長輪詢灰度開關。⚠ 開之前務必在測試站實測：pm2 instance 數／隧道 idle timeout／連線數。
    //   held 是「現在掛著幾條」，開啟後拿它觀察負載。
    app.get('/api/tournament/admin/longpoll', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        res.json({ config: await lpConfig(), held: _lpHeld, rooms: _lpWaiters.size });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/admin/longpoll', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const b = req.body || {};
        const $set = {};
        if (typeof b.enabled === 'boolean') $set.enabled = b.enabled;
        if (b.maxWaitMs != null) $set.maxWaitMs = Number(b.maxWaitMs);
        if (b.pollMs != null) $set.pollMs = Number(b.pollMs);
        if (b.maxHold != null) $set.maxHold = Number(b.maxHold);
        if (Object.keys($set).length === 0) return res.status(400).json({ error: '沒有可更新的欄位（enabled / maxWaitMs / pollMs / maxHold）' });
        await TCONFIG.updateOne({ _id: 'longPoll' }, { $set }, { upsert: true });
        _lpCfgAt = 0;   // 立刻失效，不必等 10 秒快取
        res.json({ ok: true, config: await lpConfig() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // ⭐⭐⭐v6.214② 未進場容許窗（**預設開啟**；關掉就退回 v6.213 的行為）。
    //   ⚠ 這支只調「未進場容許窗」，不動休息倒數 roundCountdownMin、也不動閒置判負 idleForfeitMin
    //     ——那兩個是 per-event 設定，請在「賽事設定」裡改。
    app.get('/api/tournament/admin/noshow', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        res.json({ config: await noShowConfig(), floorMin: NOSHOW_FLOOR_MIN, defaultMin: TNS_DEFAULT.minutes });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/admin/noshow', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const b = req.body || {};
        const $set = {};
        if (typeof b.enabled === 'boolean') $set.enabled = b.enabled;
        if (b.minutes != null && b.minutes !== '') {
          const _m = Number(b.minutes);
          // ⚠ 明確回 400 而不是靜默夾到地板：「站長想設 1 分鐘」與「系統只給 2 分鐘」必須分得出來。
          if (!isFinite(_m) || _m < NOSHOW_FLOOR_MIN || _m > 60) {
            return res.status(400).json({ error: '容許窗需為 ' + NOSHOW_FLOOR_MIN + ' ~ 60 分鐘（硬地板是為了不誤判正常玩家）' });
          }
          $set.minutes = _m;
        }
        if (Object.keys($set).length === 0) return res.status(400).json({ error: '沒有可更新的欄位（enabled / minutes）' });
        await TCONFIG.updateOne({ _id: 'noShowTune' }, { $set }, { upsert: true });
        _nsCfgAt = 0;   // 立刻失效，不必等 10 秒快取
        res.json({ ok: true, config: await noShowConfig() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // ⭐⭐⭐v6.160 報到版本閘（預設關閉的灰度旗標）。
    //   ⚠⚠ 這支只設定「門檻」；**擋人的判斷全在 client**，而且每一條失敗路徑都 fail-open。
    //     所以即使把 min 誤填成 '99.0'，結果也只是所有玩家被提示一次、按逃生鈕照樣報到，
    //     不會有人被鎖在賽外。（admin 頁會拿現行部署版本對照並紅字警告。）
    //   ⚠⚠ 門檻**只對 v6.160 以上的 client 生效** —— 更舊的 bundle 沒有那段程式碼。
    app.get('/api/tournament/admin/minclientver', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        res.json({ config: await minVerConfig() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/admin/minclientver', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const b = req.body || {};
        const $set = {};
        if (typeof b.enabled === 'boolean') $set.enabled = b.enabled;
        if (b.min != null) {
          // ⚠ 一律存成**字串**。存成數字的話 6.150 會被 Mongo 收成 6.15；十進位語義下雖然相等，
          //   但 admin 頁再讀回來會顯示成 '6.15'，看起來像被偷改過。
          const _m = String(b.min).trim();
          if (_m !== '' && !TMINVER_RE.test(_m)) return res.status(400).json({ error: '版本格式需為 主版.次版（例 6.160）' });
          $set.min = _m;
        }
        if (Object.keys($set).length === 0) return res.status(400).json({ error: '沒有可更新的欄位（enabled / min）' });
        // 開啟但沒有有效門檻 ＝ 什麼都擋不到，直接講明而不是靜默假開。
        if ($set.enabled === true) {
          const _eff = ($set.min != null) ? $set.min : ((await minVerConfig()).min || '');
          if (!TMINVER_RE.test(_eff)) return res.status(400).json({ error: '要啟用請同時填寫最低版本（例 6.160）' });
        }
        await TCONFIG.updateOne({ _id: 'minClientVer' }, { $set }, { upsert: true });
        _mvCfgAt = 0;   // 立刻失效，不必等 10 秒快取
        res.json({ ok: true, config: await minVerConfig() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/admin/event/create', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可建立賽事' });
        // v0.40：移除「一次只辦一個」限制 — 可同時公布多場（時間不重疊），玩家各自報名。
        const b = req.body || {};
        const regOpen = Number(b.registrationOpenAt) > 0 ? Number(b.registrationOpenAt) : null;
        const regClose = Number(b.registrationCloseAt) > 0 ? Number(b.registrationCloseAt) : null;
        const initStatus = (regOpen && regOpen > Date.now()) ? 'draft' : 'registration';
        const ev = {
          _id: 'evt_' + Date.now().toString(36),
          createdAt: Date.now(),
          name: String(b.name || '錦標賽').slice(0, 60),
          format: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? 'swiss-then-cut' : 'single-elim', bestOf: 1,
          // 瑞士制(swiss-then-cut)專屬：swissRounds/topCut 為 0 = 「依人數自動」(seed 時算)，admin 填數字則覆寫；phase 隨賽程 swiss→cut。
          swissRounds: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? (Number(b.swissRounds) > 0 ? Number(b.swissRounds) : 0) : undefined,
          topCut: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? (Number(b.topCut) > 0 ? Number(b.topCut) : 0) : undefined,
          phase: (b.format === 'swiss' || b.format === 'swiss-then-cut') ? 'swiss' : undefined,
          status: initStatus,
          registrationOpenAt: regOpen, registrationCloseAt: regClose,
          maxPlayers: (b.maxPlayers == null || b.maxPlayers === '' || Number(b.maxPlayers) <= 0) ? null : Math.min(64, Number(b.maxPlayers)),
          roundLimitMin: Number(b.roundLimitMin) > 0 ? Number(b.roundLimitMin) : 25,
          noShowMin: Number(b.noShowMin) > 0 ? Number(b.noShowMin) : 5,
          roundCountdownMin: (b.roundCountdownMin != null && b.roundCountdownMin !== '' && Number(b.roundCountdownMin) >= 0) ? Number(b.roundCountdownMin) : 3,
          checkInEnabled: b.checkInEnabled !== false,
          currentRound: 0,
          createdBy: id.email || id.uid, createdAt: Date.now(),
        };
        await TEVENTS.insertOne(ev);
        res.json({ ok: true, event: ev });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：轉換賽事階段
    app.post('/api/tournament/admin/event/status', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        const st = String((req.body && req.body.status) || '');
        const valid = ['draft', 'registration', 'checkin', 'bracket_ready', 'running', 'finished'];
        if (!valid.includes(st)) return res.status(400).json({ error: 'invalid status' });
        // v0.64 防護：已開賽/已結束的賽事禁止退回「報名中/籌備中」——否則排程器會因 registrationCloseAt
        //   已過而把賽事重新產生賽程(刪掉目前對戰、從第 1 輪重排)，毀掉進行中的比賽。
        //   (Wilson 手滑在進行中的賽事按了「開放報名」→ 差點整場被重排。)
        const _startedStatuses = ['checkin', 'bracket_ready', 'running', 'finished'];
        const _preStartStatuses = ['draft', 'registration'];
        if (_startedStatuses.includes(ev.status) && _preStartStatuses.includes(st) && st !== ev.status) {
          const _stLabel = ({ checkin: '簽到中', bracket_ready: '賽程已公布', running: '進行中', finished: '已結束' })[ev.status] || ev.status;
          return res.status(409).json({ error: '賽事已進入「' + _stLabel + '」階段，不可退回「' + (st === 'draft' ? '籌備中' : '報名中') + '」——這會讓系統重新產生賽程、刪掉進行中的對戰並從第 1 輪重排。如需重辦請改用「強制結束」後重新建立賽事。' });
        }
        // v0.86 缺口修補：手動切換階段原本只寫 status，會漏掉排程器自動轉換時一併設定的欄位——
        //   ① 切到 checkin 沒有 checkInDeadline → 報到階段永遠不會結束（:3740 的 gate 讀該欄位），
        //      而且不會推播「開放報到」（推播①唯一觸發點在排程器的自動轉換）。
        //   ② 切到 running 沒有 roundStartedAt → 「本輪可進場」推播與未進場判負都讀該欄位，雙雙失效。
        const _set86 = { status: st };
        const _cdMin86 = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
        if (st === 'checkin' && !ev.checkInDeadline) _set86.checkInDeadline = Date.now() + Math.max(1, _cdMin86) * 60000;
        if (st === 'running' && !ev.roundStartedAt) _set86.roundStartedAt = Date.now();
        await TEVENTS.updateOne({ _id: ev._id }, { $set: _set86 });
        if (st === 'checkin' && ev.status !== 'checkin') {
          try {
            await postSystemChat('🔔 「' + ev.name + '」開放報到！請於 ' + Math.max(1, _cdMin86) + ' 分鐘內按「我要報到」，逾時未報到者不列入賽程。');
            const _pr86 = await TREGS.find({ eventId: ev._id }).project({ uid: 1 }).toArray();
            sendPushToUids(_pr86.map((r) => r.uid).filter(Boolean), {
              title: '🏆 ' + ev.name + ' 開放報到',
              body: '請於 ' + Math.max(1, _cdMin86) + ' 分鐘內完成報到，逾時將無法參賽。',
              tag: 'ptcg-t-checkin-' + ev._id,
            });
          } catch (e) { /* 推播/公告失敗不影響賽事 */ }
        }
        res.json({ ok: true, status: st });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // v0.38 管理員：即時修改賽事參數 + 名稱（建錯名稱／已有人報名時皆可改，不影響既有報名）
    app.post('/api/tournament/admin/event/update', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        const b = req.body || {};
        const set = {};
        if (typeof b.name === 'string' && b.name.trim()) set.name = b.name.trim().slice(0, 60);
        if (b.maxPlayers !== undefined) set.maxPlayers = (b.maxPlayers == null || b.maxPlayers === '' || Number(b.maxPlayers) <= 0) ? null : Math.min(64, Number(b.maxPlayers));
        if (b.roundLimitMin !== undefined && Number(b.roundLimitMin) > 0) set.roundLimitMin = Number(b.roundLimitMin);
        if (b.noShowMin !== undefined && Number(b.noShowMin) > 0) set.noShowMin = Number(b.noShowMin);
        if (b.roundCountdownMin !== undefined && b.roundCountdownMin !== '' && Number(b.roundCountdownMin) >= 0) set.roundCountdownMin = Number(b.roundCountdownMin);
        if (b.registrationOpenAt !== undefined) set.registrationOpenAt = Number(b.registrationOpenAt) > 0 ? Number(b.registrationOpenAt) : null;
        if (b.registrationCloseAt !== undefined) set.registrationCloseAt = Number(b.registrationCloseAt) > 0 ? Number(b.registrationCloseAt) : null;
        if (b.checkInEnabled !== undefined) set.checkInEnabled = b.checkInEnabled !== false;
        // v0.65 賽制可在「開賽前」(draft/registration)變更；已開賽不可改(賽程已依賽制產生，改了會與既有賽程矛盾)。
        if (b.format !== undefined && b.format !== null && b.format !== '') {
          const newFmt = (b.format === 'swiss' || b.format === 'swiss-then-cut') ? 'swiss-then-cut' : 'single-elim';
          const curFmt = ev.format || 'single-elim';
          const preStart = (ev.status === 'draft' || ev.status === 'registration');
          if (newFmt !== curFmt && !preStart) {
            return res.status(409).json({ error: '賽事已開始，無法變更賽制（賽程已依原賽制產生）。如需更改請用「強制結束」後重新建立賽事。' });
          }
          if (preStart) {
            set.format = newFmt;
            if (newFmt === 'swiss-then-cut') {
              set.swissRounds = Number(b.swissRounds) > 0 ? Number(b.swissRounds) : 0;  // 0=依人數自動
              set.topCut = Number(b.topCut) > 0 ? Number(b.topCut) : 0;
              set.phase = 'swiss';
            }
            // 切回單敗淘汰：只改 format；瑞士欄位(swissRounds/topCut/phase)在 format=single-elim 時引擎一律忽略，保留無害。
          }
        }
        if (!Object.keys(set).length) return res.status(400).json({ error: '沒有要更新的欄位' });
        await TEVENTS.updateOne({ _id: ev._id }, { $set: set });
        res.json({ ok: true, set: set });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：刪除賽事（含報名）
    app.post('/api/tournament/admin/event/delete', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        await TREGS.deleteMany({ eventId: ev._id });
        await TMATCH.deleteMany({ eventId: ev._id });
        await TEVENTS.deleteOne({ _id: ev._id });
        res.json({ ok: true }); // 註：tournamentArchives 永久歸檔不刪
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：列出目前賽事的報名名單
    app.get('/api/tournament/admin/event/registrations', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.json({ event: null, regs: [] });
        const regs = await TREGS.find({ eventId: ev._id }).toArray();
        res.json({ event: ev, regs: regs.map((r) => ({ uid: r.uid, email: r.email, name: r.name, checkedIn: !!r.checkedIn, deckCount: deckCount(r.deckEntries), deckText: deckEntriesToText(r.deckEntries, r.deckName), registeredAt: r.registeredAt })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // v0.40 管理員：列出所有開放中（未結束）賽事 — 多賽事管理用（admin 頁切換顯示）
    app.get('/api/tournament/admin/events', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const evs = await listOpenEvents();
        const out = [];
        for (const e of evs) {
          const cnt = await TREGS.countDocuments({ eventId: e._id });
          out.push({ _id: e._id, name: e.name, status: e.status, maxPlayers: e.maxPlayers, regCount: cnt, roundLimitMin: e.roundLimitMin, noShowMin: e.noShowMin, roundCountdownMin: e.roundCountdownMin, registrationOpenAt: e.registrationOpenAt || null, registrationCloseAt: e.registrationCloseAt || null, currentRound: e.currentRound, rounds: e.rounds, createdAt: e.createdAt || 0 });
        }
        res.json({ events: out });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Phase1-C：大廳聊天室（全站登入者共用 room='lobby'）──
    const TCHAT = db.collection('tournamentChat');
    const TCONFIG = db.collection('tournamentConfig'); // v0.36 聊天清空標記等
    const _chatRate = new Map(); // uid -> last post ts（記憶體限速）
    const _chatNickCache = new Map(); // v0.76 uid -> { name, at }：非報名者聊天暱稱(最近一次錦標賽報名暱稱)5分鐘快取
    /**
     * v6.144【中央收斂】取某個 uid「最近一次錦標賽報名時填的暱稱」。
     *
     * ⚠ 這是全站「該顯示什麼名字」的單一來源。`tournIdentity` 回的 `name` 在 Firebase token
     *   沒有 displayName 時會退成 **email 前綴**（`dec.email.split('@')[0]`），拿它當顯示名
     *   等於把帳號名貼在公開頁面上 —— 玩家回報牌組公布欄顯示的就是 email 前綴。
     *   v0.76 早就為聊天室做了正確的版本，但只寫在那一支 handler 裡，公布欄沒接到；
     *   本版抽成 helper，聊天與公布欄共用同一份（禁再抄第三份）。
     *
     * 回 null 代表這個人從沒報名過任何賽事，caller 自行決定 fallback。
     */
    async function getLastRegisteredNick(uid) {
      if (!uid) return null;
      const now = Date.now();
      const c = _chatNickCache.get(uid);
      if (c && (now - c.at) < 300000) return c.name;
      let nick = null;
      try {
        const lr = await TREGS.find({ uid }, { projection: { name: 1, registeredAt: 1 } })
          .sort({ registeredAt: -1 }).limit(1).toArray();
        nick = (lr[0] && lr[0].name) || null;
      } catch (_e) { /* best-effort：查不到就當沒報過 */ }
      _chatNickCache.set(uid, { name: nick, at: now });
      return nick;
    }
    // v0.57 大廳聊天效能：①建 {room,ts} 索引→/chat 的 `ts > since` + sort 走索引範圍掃描，不再每次全表掃+記憶體排序
    //   （訊息越多越慢，高流量下每位玩家每 3s 都打一次會拖垮）。索引建立冪等，重啟重複呼叫安全。
    TCHAT.createIndex({ room: 1, ts: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    // ②定期修剪：大廳只保留最近 N 則，避免 tournamentChat 無限長大（錦標賽狂發系統訊息）。
    let _lastChatPruneAt = 0;
    async function pruneLobbyChat() {
      const KEEP = 800;  // 前端本來也只顯示最近 200，伺服器保留 800 綽綽有餘
      const total = await TCHAT.countDocuments({ room: 'lobby' });
      if (total <= KEEP) return;
      const cut = await TCHAT.find({ room: 'lobby' }).sort({ ts: -1 }).skip(KEEP).limit(1).toArray();
      if (cut.length) {
        const r = await TCHAT.deleteMany({ room: 'lobby', ts: { $lt: cut[0].ts } });
        if (r.deletedCount) console.log('[chat-prune] 大廳聊天修剪 ' + r.deletedCount + ' 則（保留最近 ' + KEEP + '）');
      }
    }
    app.get('/api/tournament/chat', async (req, res) => {
      try {
        const since = Number(req.query.since) || 0;
        const before = Number(req.query.before) || 0; // v0.66 懶載入：before>0=上滑載更舊；since=before=0=初始載「最新」一頁
        const cfg = await TCONFIG.findOne({ _id: 'chatMeta' });
        const clearedAt = (cfg && cfg.clearedAt) || 0;
        let docs, hasMore;
        if (since > 0) {
          // 增量輪詢：只回比 since 新的訊息（升序），高頻輪詢低流量。
          docs = await TCHAT.find({ room: 'lobby', ts: { $gt: since } }).sort({ ts: 1 }).limit(80).toArray();
        } else {
          // 初始/上滑：取 ts<before（before=0→無上限=最新）的「最近」一頁，降序撈再反轉成升序顯示。
          //   原本 since=0 回「最舊」80 則 → 玩家要等多輪才追到最新（費流量又慢）；改回最新一頁。
          const q = { room: 'lobby' };
          if (before > 0) q.ts = { $lt: before };
          docs = (await TCHAT.find(q).sort({ ts: -1 }).limit(80).toArray()).reverse();
          // 還有沒有更舊的（供前端決定是否在往上滑時續載）。
          hasMore = docs.length > 0 ? (await TCHAT.countDocuments({ room: 'lobby', ts: { $lt: docs[0].ts } })) > 0 : false;
        }
        const out = { messages: docs.map((m) => ({ id: String(m._id), name: m.name, text: m.text, ts: m.ts, uid: m.uid, sys: !!m.sys, admin: !!m.admin })), clearedAt, serverNow: Date.now() };
        if (hasMore !== undefined) out.hasMore = hasMore;
        res.json(out);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/chat', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!text) return res.status(400).json({ error: '訊息不可空白' });
        // 只有報名者（或管理員）可發言；未報名僅能觀看
        // v0.40 多賽事：在任一開放中賽事報名者即可發言
        // v0.68：賽事期間放寬——只要已登入(tournIdentity 已驗證身分)即可留言，不限報名者。
        //   報名者顯示其報名暱稱、未報名者顯示帳號暱稱(id.name)。
        const _openEv = await listOpenEvents();
        const _openIds = _openEv.map((e) => e._id);
        const regc = _openIds.length ? await TREGS.findOne({ eventId: { $in: _openIds }, uid: id.uid }) : null;
        const now = Date.now();
        if (now - (_chatRate.get(id.uid) || 0) < 1200) return res.status(429).json({ error: '發言太快，請稍候' });
        _chatRate.set(id.uid, now);
        const isAdm = isTournAdmin(id);  // v0.31：管理員發言統一顯示「系統管理員」+ admin 標記(前端專屬顏色+icon)
        // v0.76 聊天暱稱：①管理員固定「系統管理員」②本場報名者用報名暱稱 regc.name
        //   ③其餘(未報名/賽事間空檔)改用【最近一次錦標賽報名的暱稱】(=個人資料分頁名稱),而非 email 帳號名;
        //   從沒報過任何賽事才退回 email 前綴(不露完整 email)。5 分鐘記憶體快取避免每則訊息查 TREGS。
        let chatName;
        if (isAdm) chatName = '系統管理員';
        else if (regc && regc.name) chatName = regc.name;
        else {
          // v6.144：收斂到 getLastRegisteredNick（原本這段 inline 版是全站唯一一份，
          //   公布欄因此沒接到、顯示成 email 前綴）。行為等價。
          const _nick = await getLastRegisteredNick(id.uid);
          chatName = _nick || (id.email ? String(id.email).split('@')[0] : (id.name || '玩家'));
        }
        await TCHAT.insertOne({ room: 'lobby', uid: id.uid, name: chatName, text, ts: now, admin: isAdm || undefined });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post('/api/tournament/admin/chat/clear', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        await TCHAT.deleteMany({ room: 'lobby' });
        await TCONFIG.updateOne({ _id: 'chatMeta' }, { $set: { clearedAt: Date.now() } }, { upsert: true });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });


    // ════════════════════════════════════════════════════════════════════
    // Phase1-D：賽程引擎（單敗淘汰 Bo1，含 bye 湊 2 次方，伺服器權威自動晉級）
    // ════════════════════════════════════════════════════════════════════
    const TMATCH = db.collection('tournamentMatches');

    // ══ v0.85 錦標賽推播通知（Web Push）══════════════════════════════════════════
    //   只推兩個低頻事件：①報到開始 ②本輪可進場（每人每輪各一次）。
    //   ⚠「換手」不推（Wilson 決策：避免對戰熱路徑推播量壓垮主機，改由前端本地通知處理）。
    //   ⚠載入比照 TENG/compression 的 CJS/ESM 雙寫法（v0.75 教訓：patch 包在 ESM import() 內時
    //     單用 require 會拋 require-is-not-defined 被吞→功能靜默失效）。
    //   私鑰在 VM 的 /opt/ptcg/api/vapid.json（chmod 600，不進 git）；缺檔/未裝套件則自動停用推播，
    //   絕不影響賽事流程。
    const TPUSH = db.collection('tournamentPushSubs');
    try { await TPUSH.createIndex({ uid: 1 }); } catch (e) { /* 索引已存在 */ }
    let _webpush = null;
    try {
      try { _webpush = require('web-push'); }
      catch (_eReq) { _webpush = (await import('web-push')).default; }
      let _vapid = null;
      try { _vapid = require('/opt/ptcg/api/vapid.json'); }
      catch (_eV) { const _fs2 = await import('fs'); _vapid = JSON.parse(_fs2.readFileSync('/opt/ptcg/api/vapid.json', 'utf8')); }
      if (_webpush && _vapid && _vapid.publicKey && _vapid.privateKey) {
        _webpush.setVapidDetails(_vapid.subject || 'mailto:ueishun@gmail.com', _vapid.publicKey, _vapid.privateKey);
        console.log('[tournament] web-push ready (推播已啟用)');
      } else { _webpush = null; console.warn('[tournament] vapid.json 不完整 → 推播停用'); }
    } catch (e) { _webpush = null; console.warn('[tournament] web-push 未啟用（未裝套件或無 vapid.json）:', e && e.message); }

    // 推播給一批 uid。失效訂閱(404/410)自動清除。fire-and-forget：任何錯誤都不影響賽事流程。
    /**
     * v0.99 取得「此刻正在對戰中」的玩家 uid（廣播通知要跳過他們，免得干擾比賽）。
     *
     * 兩個來源都要查：
     *   ① 錦標賽對戰 TMATCH.status === 'playing' → p1uid / p2uid
     *   ② 休閒對戰 rooms.status === 'playing' → memberUids / hostUid
     *
     * ⚠**必須加 updatedAt 時間窗**：`status:'playing'` 會有殭屍殘留
     *   （startZombieRoomCleanup 就是在清這種東西，清掃有間隔、且掃不到剛卡住的）。
     *   不加時間窗的話，一個幾天前卡住的房間會讓那兩位玩家**從此再也收不到通知**。
     *   取 **15 分鐘**：既有的殭屍判定是「playing 5 分鐘無動作」（PLAYING_STALE_MS），
     *   15 分鐘足以涵蓋清掃間隔內尚未被清掉的殘留，又不會讓玩家被誤鎖太久。
     *   ⚠不能直接引用 PLAYING_STALE_MS —— 它定義在 startZombieRoomCleanup 的 IIFE 內，
     *     跨閉包取不到（這個坑踩過，見 test-admin-helper-scope）。
     */
    async function getBusyUids(windowMs = 15 * 60 * 1000) {
      const since = Date.now() - windowMs;
      const busy = new Set();
      try {
        const ms = await TMATCH.find(
          { status: 'playing' },
          { projection: { p1uid: 1, p2uid: 1 } }
        ).limit(200).toArray();
        for (const m of ms) { if (m.p1uid) busy.add(String(m.p1uid)); if (m.p2uid) busy.add(String(m.p2uid)); }
      } catch (e) { console.warn('[push] getBusyUids tourn failed', e && e.message); }
      try {
        const rooms = await db.collection('rooms').find(
          { status: 'playing', updatedAt: { $gte: since } },
          { projection: { memberUids: 1, hostUid: 1 } }
        ).limit(200).toArray();
        for (const r of rooms) {
          if (r.hostUid) busy.add(String(r.hostUid));
          if (Array.isArray(r.memberUids)) for (const u of r.memberUids) if (u) busy.add(String(u));
        }
      } catch (e) { console.warn('[push] getBusyUids casual failed', e && e.message); }
      return busy;
    }

    /**
     * v0.98 廣播型推播：推給**所有**有訂閱、且沒有關閉該類通知的人。
     *
     * 與 sendPushToUids 的差別：那支是「推給指定的幾個 uid」（報到／進場，對象明確）；
     * 這支是「推給全站」，用於社群賽開辦這種公告型事件。
     *
     * @param payload      推播內容
     * @param excludeUid   要排除的單一 uid（通常是發起者自己）
     * @param excludeUids  要排除的一組 uid（v0.99：正在對戰中的玩家，避免干擾比賽）
     * @param prefKey      訂閱文件上的偏好欄位名；用 `$ne: false` 判定
     *                     → **未設定過的舊訂閱視為開啟**（Wilson 裁定新通知預設開，
     *                       否則既有玩家全部收不到、功能等於沒上線）
     * @param cap          單次推播上限，防未來訂閱數暴增時一次送爆
     */
    async function broadcastPush(payload, { excludeUid = null, excludeUids = null, prefKey = null, cap = 500 } = {}) {
      if (!_webpush) return { sent: 0 };
      try {
        // v0.99：單一排除與批次排除合併成同一個 $nin，避免兩個條件互相覆蓋掉
        const excl = new Set(excludeUids ? [...excludeUids] : []);
        if (excludeUid) excl.add(String(excludeUid));
        const q = {};
        if (excl.size) q.uid = { $nin: [...excl] };
        if (prefKey) q[prefKey] = { $ne: false };
        const subs = await TPUSH.find(q).limit(cap).toArray();
        if (!subs.length) return { sent: 0 };
        const body = JSON.stringify(payload);
        await Promise.allSettled(subs.map(async (row) => {
          try { await _webpush.sendNotification(row.sub, body); }
          catch (err) {
            const code = err && err.statusCode;
            if (code === 404 || code === 410) { try { await TPUSH.deleteOne({ _id: row._id }); } catch (e2) { /* */ } }
            else console.warn('[push] broadcast failed', code, err && err.message);
          }
        }));
        return { sent: subs.length };
      } catch (e) {
        console.warn('[push] broadcast error', e && e.message);
        return { sent: 0 };
      }
    }

    async function sendPushToUids(uids, payload) {
      if (!_webpush || !Array.isArray(uids) || uids.length === 0) return;
      try {
        const subs = await TPUSH.find({ uid: { $in: uids } }).toArray();
        if (!subs.length) return;
        const body = JSON.stringify(payload);
        await Promise.allSettled(subs.map(async (row) => {
          try { await _webpush.sendNotification(row.sub, body); }
          catch (err) {
            const code = err && err.statusCode;
            if (code === 404 || code === 410) { try { await TPUSH.deleteOne({ _id: row._id }); } catch (e2) { /* */ } }
            // v0.86：其餘錯誤原本完全靜默（403 VAPID 金鑰不符、400 payload 問題、逾時…）→ 補 log，
            //   否則推播失敗在 VM 上完全查不出來。
            else { try { console.warn('[push] send fail uid=' + row.uid + ' code=' + code + ' ' + String((err && err.body) || (err && err.message) || '').slice(0, 200)); } catch (e3) { /* */ } }
          }
        }));
      } catch (e) { /* 推播永不影響賽事 */ }
    }

    // 訂閱／取消訂閱端點（前端開啟通知時呼叫）
    app.post('/api/tournament/push/subscribe', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const sub = req.body && req.body.subscription;
        if (!sub || !sub.endpoint) return res.status(400).json({ error: 'bad subscription' });
        const key = id.uid + '__' + Buffer.from(String(sub.endpoint)).toString('base64').slice(-40);
        await TPUSH.updateOne({ _id: key }, { $set: { uid: id.uid, sub, ts: Date.now() } }, { upsert: true });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.98 推播偏好：**必須存在伺服器**——推播是伺服器主動發的，只存 localStorage 沒有意義。
    //   目前只有一個 notifyCommunity（社群賽開辦通知）；欄位缺席＝視為開啟（預設開）。
    app.post('/api/tournament/push/prefs', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const b = req.body || {};
        const set = {};
        if (typeof b.notifyCommunity === 'boolean') set.notifyCommunity = b.notifyCommunity;
        if (!Object.keys(set).length) return res.status(400).json({ error: '沒有可更新的偏好' });
        // 同一個玩家可能有多台裝置（多筆訂閱）→ 一次全部更新，偏好是「人」層級不是「裝置」層級
        const r = await TPUSH.updateMany({ uid: id.uid }, { $set: set });
        res.json({ ok: true, updated: r.modifiedCount || 0, prefs: set });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/tournament/push/unsubscribe', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ep = req.body && req.body.endpoint;
        if (ep) await TPUSH.deleteOne({ _id: id.uid + '__' + Buffer.from(String(ep)).toString('base64').slice(-40) });
        else await TPUSH.deleteMany({ uid: id.uid });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 公開端點：前端取 VAPID 公鑰（公鑰可公開；私鑰永不外流）
    app.get('/api/tournament/push/pubkey', async (req, res) => {
      try {
        if (!_webpush) return res.json({ enabled: false, publicKey: null });
        let pk = null;
        try { pk = require('/opt/ptcg/api/vapid.json').publicKey; }
        catch (_e) { const _fs3 = await import('fs'); pk = JSON.parse(_fs3.readFileSync('/opt/ptcg/api/vapid.json', 'utf8')).publicKey; }
        res.json({ enabled: !!pk, publicKey: pk || null });
      } catch (e) { res.json({ enabled: false, publicKey: null }); }
    });
    // v0.86 診斷①：本人在伺服器上的訂閱現況。前端診斷面板顯示，用來揪出「本機有訂閱、伺服器沒登記」。
    app.get('/api/tournament/push/status', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const rows = await TPUSH.find({ uid: id.uid }).toArray();
        let pk = null;
        try { pk = require('/opt/ptcg/api/vapid.json').publicKey; }
        catch (_e) { try { const _fs4 = await import('fs'); pk = JSON.parse(_fs4.readFileSync('/opt/ptcg/api/vapid.json', 'utf8')).publicKey; } catch (_e2) { /* */ } }
        res.json({
          enabled: !!_webpush,
          vapidPrefix: pk ? String(pk).slice(0, 16) : null,
          subs: rows.map((r) => {
            let host = '';
            try { host = new URL(r.sub && r.sub.endpoint).hostname; } catch (e) { /* */ }
            return { host, ts: r.ts || 0 };
          }),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.86 診斷②：伺服器實際推一則給自己，回 per-endpoint 狀態碼。
    //   2xx = 已交給 Apple/Google 推播服務（沒跳出＝裝置端 SW 或系統設定問題）；
    //   403 = VAPID 金鑰不符（舊訂閱綁舊公鑰）；410/404 = 訂閱已失效（本次會順手清掉）。
    const _pushTestThrottle = new Map();
    app.post('/api/tournament/push/selftest', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!_webpush) return res.json({ ok: false, enabled: false, results: [] });
        const now = Date.now();
        if (now - (_pushTestThrottle.get(id.uid) || 0) < 60000) return res.json({ ok: false, throttled: true, results: [] });
        _pushTestThrottle.set(id.uid, now);
        if (_pushTestThrottle.size > 500) { const k = _pushTestThrottle.keys().next().value; _pushTestThrottle.delete(k); }
        const rows = await TPUSH.find({ uid: id.uid }).toArray();
        const body = JSON.stringify({ title: '🔔 伺服器推播測試', body: '這則是由賽事伺服器推送的。看得到就代表關掉 App 時也收得到報到與進場通知。', tag: 'ptcg-t-selftest' });
        const results = [];
        for (const row of rows) {
          let host = '';
          try { host = new URL(row.sub && row.sub.endpoint).hostname; } catch (e) { /* */ }
          try { const r2 = await _webpush.sendNotification(row.sub, body); results.push({ host, code: (r2 && r2.statusCode) || 201 }); }
          catch (err) {
            const code = (err && err.statusCode) || 0;
            if (code === 404 || code === 410) { try { await TPUSH.deleteOne({ _id: row._id }); } catch (e2) { /* */ } }
            results.push({ host, code, err: String((err && err.body) || (err && err.message) || '').slice(0, 80) });
          }
        }
        res.json({ ok: true, sent: results.length, results });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.81 對戰回放:逐回合盤面快照存獨立 collection(不塞TMATCH避免既有無projection查詢讀放大);TTL 90天;冪等upsert;fire-and-forget。
    const TREPLAY = db.collection('tournamentReplayTurns');
    TREPLAY.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { /* TTL index best-effort */ });
    // v6.119：回放快照是全站最大的 collection 之一（90 天 × 每半回合一份完整盤面），
    //   但 find({ matchId })（看回放，行為公開端點）與 deleteMany({ matchId })（重賽清舊局）
    //   以前都是全表掃。
    TREPLAY.createIndex({ matchId: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    const REPLAY_SNAPSHOT_ENABLED = true;  // 出事一鍵關
    const REPLAY_TTL_MS = 90 * 24 * 3600 * 1000;
    function snapshotTurn(matchId, eventId, gs) {
      if (!REPLAY_SNAPSHOT_ENABLED || !matchId || !gs) return;
      if (gs.phase === 'game-over') return;  // v0.83 game-over 由 finalState 補末格,不重複存(消 logLen tie/重複畫面)
      try {
        const turn = gs.turn || 1;
        const ap = (gs.activePlayerIndex == null ? 0 : gs.activePlayerIndex);  // 半回合行動方(先攻/後攻)
        const logLen = Array.isArray(gs.log) ? gs.log.length : 0;  // v0.82 存 log 長度→前端逐步切片 finalLog(每半回合各自進度)
        const state = Object.assign({}, gs); state.log = [];  // strip log(佔~73%;逐回合文字由 finalLog 供)
        // key 每半回合唯一:同 turn 的先攻/後攻靠 activePlayerIndex 區分,不碰撞(舊 v0.81 的 _t{turn} 格式不同→不衝突)
        TREPLAY.updateOne({ _id: matchId + '_t' + turn + '_p' + ap }, { $setOnInsert: { matchId, eventId: eventId || null, turn, activePlayerIndex: ap, logLen, state, createdAt: Date.now(), expireAt: new Date(Date.now() + REPLAY_TTL_MS) } }, { upsert: true }).catch(() => { /* fire-and-forget,缺回合回放端 fallback */ });
      } catch (e) { /* 絕不影響對戰 */ }
    }
    try { await TMATCH.createIndex({ eventId: 1 }); } catch (e) { /* v0.70：去重查詢走 eventId,建索引(best-effort) */ }
    // v6.120：排程器每 30 秒對每個 running 賽事做 find({ eventId, status }) / find({ eventId, round, status })。
    //   TMATCH 隨賽事場次永久累積，單靠 eventId 索引仍要把該賽事所有輪次的 match 全撈出來再過濾。
    TMATCH.createIndex({ eventId: 1, status: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    TMATCH.createIndex({ eventId: 1, round: 1 }).catch(() => { /* best-effort，已存在即略過 */ });
    const TCHAMPS = db.collection('tournamentChampions'); // v0.33 名人堂（歷屆冠軍）
    const TARCHIVE = db.collection('tournamentArchives'); // v0.35 完整賽事歸檔（永久保存，刪賽事不影響）
    // 每輪動態配對：⌊n/2⌋ 場對戰；n 為奇數 → 落單 1 人輪空保送下一輪（優先給「還沒輪空過的人」，避免同一人連續被保送）。
    //   players: [{ uid, name, byes }]（byes＝至今累計輪空次數）。回傳本輪 match 陣列（含輪空 match，status='done'）。
    function buildRoundMatches(players, evId, roundNum) {
      const pool = players.slice();
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }  // 洗牌公平配對
      const matches = []; let idx = 0; let byePlayer = null;
      if (pool.length % 2 === 1) {
        // 落單 1 人輪空：挑「輪空次數最少」者（洗牌後同分取先者）
        let mn = Infinity, bi = 0;
        for (let i = 0; i < pool.length; i++) { const b = (pool[i].byes || 0); if (b < mn) { mn = b; bi = i; } }
        byePlayer = pool.splice(bi, 1)[0];
      }
      for (let i = 0; i + 1 < pool.length; i += 2) {
        const a = pool[i], b = pool[i + 1];
        matches.push({ _id: evId + '_r' + roundNum + '_m' + idx, eventId: evId, round: roundNum, idx, p1uid: a.uid, p1name: a.name, p2uid: b.uid, p2name: b.name, roomId: null, winnerUid: null, winnerName: null, status: 'pending', bye: false, entered: [false, false] }); idx++;
      }
      if (byePlayer) {
        matches.push({ _id: evId + '_r' + roundNum + '_m' + idx, eventId: evId, round: roundNum, idx, p1uid: byePlayer.uid, p1name: byePlayer.name, p2uid: null, p2name: null, roomId: null, winnerUid: byePlayer.uid, winnerName: byePlayer.name, status: 'done', bye: true }); idx++;
      }
      return matches;
    }
    // v0.50：瑞士制(swiss)階段判定文字用「不淘汰」措辭；cut 階段與單敗用原本「晉級/淘汰」。
    function swissPhase(ev) { return !!(ev && ev.format === 'swiss-then-cut' && ev.phase === 'swiss'); }
    async function postSystemChat(text) {
      try { await TCHAT.insertOne({ room: 'lobby', uid: 'system', name: '系統', text: String(text).slice(0, 200), ts: Date.now(), sys: true }); }
      catch (e) { /* best-effort 通知 */ }
    }
    // v0.70 R1：全域 seed 序列鎖——所有 seed 呼叫(tick / admin 手動 / bracket_ready 回收)排隊執行，使
    //   「衝突去重查詢 + TMATCH.insertMany」對其他 seed 為原子，杜絕 admin 手動 seed 與 tick seed 並發的雙重召喚殘窗。
    let _seedChain = Promise.resolve();
    // ⭐⭐v6.188 中央：把一段工作排進 seed 序列鎖。原本只有 seedEventBracket 用得到，
    //   v6.188 的「補報名＋直接報到」必須排進**同一條鎖**：補報的 insertOne 若能與
    //   _seedEventBracketImpl 讀 TREGS 交錯，就會出現「玩家看到報到成功、卻沒被排進賽程」
    //   （v0.46 那次 TOCTOU 的翻版）。排進同一條鎖之後兩者互斥。
    function runInSeedChain(fn) {
      const _p = _seedChain.then(fn, fn);
      _seedChain = _p.then(() => {}, () => {});  // rejection 不卡住鏈
      return _p;
    }
    async function seedEventBracket(ev, opts) {
      return await runInSeedChain(() => _seedEventBracketImpl(ev, opts));
    }
    async function _seedEventBracketImpl(ev, opts) {
      opts = opts || {};
      // v0.70 R1b：臨界區內重讀狀態——序列鎖只防交錯,不防「排在後面的 seed 對已 running 事件重跑 deleteMany+insertMany
      //   洗掉賽程 + 重發公告」(admin POST /bracket 無 status guard、與 tick seed 同時排隊)。已 running/finished 直接放棄
      //   (回 alreadySeeded,呼叫端靜默);admin 要刻意重排走 opts.force。
      const _fresh = await TEVENTS.findOne({ _id: ev._id }, { projection: { status: 1 } });
      if (!_fresh) return { error: '賽事不存在' };
      if ((_fresh.status === 'running' || _fresh.status === 'finished') && !opts.force) return { ok: false, alreadySeeded: true };
      let regs = await TREGS.find({ eventId: ev._id }).toArray();
      if (opts.checkedInOnly) regs = regs.filter((r) => r.checkedIn);  // 報到制：只列入「已報到」者，排除報名但沒到的人
      const _rawHadRemoved = regs.some((r) => r.autoRemovedConflict);  // v0.70 C1 加固：這場曾因衝突剔過人
      regs = regs.filter((r) => !r.autoRemovedConflict);  // v0.70 R4：已被判衝突移除者持久排除(不再重判/重公告/回歸配對)
      // v0.70：官方＋社群賽可並行——本場開賽配對前，移除「已在其他未結束賽事中被召喚(TMATCH 有其對戰)」的重複玩家。
      //   ⭐判據用 TMATCH(被召喚的事實來源)——非 checkedIn(關報到制的賽事恆 false 會漏)、非預定開賽時間(seed 順序交錯會漏)。
      //   只有「真的 seed 出對戰」的場才算衝突(較早場若報名不足取消/無對戰不會誤剔)。R1 序列鎖+R2 fail-closed 保證原子與安全。
      let _conflictRemoved = false;
      try {
        if (regs.length) {
          const _myUidSet = new Set(regs.map((r) => r.uid));
          const _liveOthers = await TEVENTS.find({ _id: { $ne: ev._id }, status: { $ne: 'finished' } }, { projection: { _id: 1 } }).toArray();
          const _liveIds = _liveOthers.map((o) => o._id);
          if (_liveIds.length) {
            const _myUids = Array.from(_myUidSet);
            const _theirMatches = await TMATCH.find({ eventId: { $in: _liveIds }, status: { $ne: 'done' }, $or: [{ p1uid: { $in: _myUids } }, { p2uid: { $in: _myUids } }] }, { projection: { p1uid: 1, p2uid: 1 } }).toArray();  // v0.73：只算【進行中(未done)】的對戰→已淘汰出局者(對戰皆done)不算衝突,可正常報名參加新賽事(修「官方賽已出局卻無法報名新社群賽」)
            const _conflictUids = new Set();
            for (const m of _theirMatches) {
              if (m.p1uid && _myUidSet.has(m.p1uid)) _conflictUids.add(m.p1uid);
              if (m.p2uid && _myUidSet.has(m.p2uid)) _conflictUids.add(m.p2uid);
            }
            if (_conflictUids.size) {
              _conflictRemoved = true;
              const _removedNames = regs.filter((r) => _conflictUids.has(r.uid)).map((r) => r.name || '玩家');
              await TREGS.updateMany({ eventId: ev._id, uid: { $in: Array.from(_conflictUids) } }, { $set: { checkedIn: false, autoRemovedConflict: true } });
              regs = regs.filter((r) => !_conflictUids.has(r.uid));
              await postSystemChat('⚠️ 「' + ev.name + '」開賽：' + _removedNames.join('、') + ' 仍在其他進行中的賽事，為避免同時被召喚，已自本場移除（待該場結束即可再參賽）。');
            }
          }
        }
      } catch (e) {
        // v0.70 R2：去重是唯一防線 → fail-closed。查詢失敗一律放棄本次 seed(保留 bracket_ready，由 R3 回收重試)，絕不 fail-open。
        console.warn('[tournament] seed conflict-check failed → 放棄本次 seed 稍後重試:', ev && ev._id, e && e.message);
        return { error: '衝突檢查失敗，稍後重試', retry: true };
      }
      if (regs.length < 2) return { error: '至少需要 2 位' + (opts.checkedInOnly ? '報到者' : '報名者'), conflictBelowMin: _conflictRemoved || _rawHadRemoved };
      const players = regs.map((r) => ({ uid: r.uid, name: r.name || '玩家', byes: 0 }));
      const sw = ev.format === 'swiss-then-cut';  // 瑞士制（單敗淘汰時 sw=false，行為完全不變）
      const swissRounds = sw ? ((ev.swissRounds > 0) ? ev.swissRounds : TENG.swissRoundsForCount(players.length)) : 0;
      const topCut = sw ? ((ev.topCut > 0) ? ev.topCut : TENG.topCutSizeForCount(players.length)) : 0;
      const rounds = sw ? swissRounds : Math.max(1, Math.ceil(Math.log2(players.length)));  // 單敗＝⌈log2(N)⌉；瑞士＝固定輪數
      const matches = buildRoundMatches(players, ev._id, 1);  // 第 1 輪（瑞士=隨機配對，與單敗第 1 輪相同）
      if (sw) matches.forEach((m) => { m.phase = 'swiss'; });
      await TMATCH.deleteMany({ eventId: ev._id });
      await TMATCH.insertMany(matches);
      // 報到制：休息時間已用於報到 → 第 1 輪立即可進場（roundStartedAt 回推 cdMin，使 enterOpenAt=now）
      const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
      const roundStartedAt = opts.immediateEnter ? (Date.now() - cdMin * 60000) : Date.now();
      const _set = { status: 'running', currentRound: 1, rounds, roundStartedAt, startedAt: Date.now() };
      if (sw) { _set.swissRounds = swissRounds; _set.topCut = topCut; _set.phase = 'swiss'; }
      await TEVENTS.updateOne({ _id: ev._id }, { $set: _set });
      // v0.51：瑞士制確定簽到人數後，廣播預計輪次數 + 取前幾名晉級。
      if (sw) {
        const _tc = Math.min(topCut, players.length);
        await postSystemChat('🎲 「' + ev.name + '」採【瑞士制 + Top Cut】！共 ' + players.length + ' 名選手出賽 → 先打 ' + swissRounds + ' 輪瑞士制（全員每輪都打、不淘汰，依戰績配對）→ 依積分排名取前 ' + _tc + ' 名進入單敗淘汰 Top Cut，決出冠軍。');
      }
      return { ok: true, rounds, players: players.length };
    }
    // 名人堂：賽事誕生冠軍時永久記錄（以 eventId 為鍵 upsert，重複完賽不重覆）
    //  ⚠⚠ v6.244 時間欄位的語義（別再混用）：
    //    ・startedAt ＝ **開賽時間**（賽程產生、第 1 輪開打）＝ 這場賽事「是哪一天辦的」＝ 顯示用的賽事日期。
    //    ・finishedAt ＝ **冠軍產生時間**（決賽結束那一刻）。網站賽 21:00（台灣時間）開打、
    //      決賽常跨過午夜 ⇒ 拿它當賽事日期會把 8/26 的比賽記成 8/27（站長 2026-08-27 回報：網站賽-95）。
    //  ⭐ startedAt 是本版才開始寫的**新欄位**，既有 874 筆一個欄位都不動；
    //    舊紀錄由 /api/tournament/champions 讀取時去歸檔補（見該端點），零資料遷移。
    async function recordChampion(ev, champUid, champName) {
      if (!ev || !champUid) return;
      try {
        const reg = await TREGS.findOne({ eventId: ev._id, uid: champUid });
        const playerCount = await TREGS.countDocuments({ eventId: ev._id });
        await TCHAMPS.updateOne({ _id: 'champ_' + ev._id }, { $set: {
          _id: 'champ_' + ev._id, eventId: ev._id, eventName: ev.name || '錦標賽',
          championUid: champUid, championName: champName || (reg && reg.name) || '冠軍',
          deckName: (reg && reg.deckName) || '', playerCount: playerCount || 0,
          startedAt: ev.startedAt || ev.createdAt || null,   // 開賽時間（賽事日期用這個）
          finishedAt: Date.now(),                            // 冠軍產生時間（⚠ 不是賽事日期）
          communityEvent: !!ev.createdByPlayer,
        } }, { upsert: true });
      } catch (e) { /* best-effort 名人堂 */ }
    }
    // 完整賽事歸檔（永久保存：日期/名稱/人數/玩家名/牌組內容/勝敗，供日後資料庫運用）
    async function recordTournamentArchive(ev) {
      if (!ev) return;
      try {
        const regs = await TREGS.find({ eventId: ev._id }).toArray();
        const matches = await TMATCH.find({ eventId: ev._id }).sort({ round: 1, idx: 1 }).toArray();
        await TARCHIVE.updateOne({ _id: 'arch_' + ev._id }, { $set: {
          _id: 'arch_' + ev._id, eventId: ev._id, eventName: ev.name || '錦標賽',
          createdAt: ev.createdAt || null, startedAt: ev.startedAt || ev.createdAt || null, finishedAt: Date.now(),
          format: ev.format || 'single-elim', bestOf: ev.bestOf || 1, playerCount: regs.length,
          championUid: ev.championUid || null, championName: ev.championName || null, communityEvent: !!ev.createdByPlayer,
          // ⭐v6.188 歸檔補 dropped/lateJoin：少了它，事後對帳看到「某人第 3 輪起憑空消失」
          //   會完全解釋不了（棄賽？被剔除？系統掉人？），對帳鏈就斷在這裡。
          // ⭐v6.276 套牌戰績（P3a）：報名有帶 deckId 的玩家，歸檔也帶下去（/api/deck-stats 的
          //   錦標賽勝率從歸檔算）。⚠⚠ 純 additive：reg 沒有 deckId ⇒ 欄位缺席（絕不寫 null，
          //   sparse 索引 {'players.deckId':1} 才不會把舊形狀收進去）；其餘欄位逐字不動。
          players: regs.map((r) => ({ uid: r.uid, name: r.name, email: r.email || null, deckName: r.deckName || '', coinPref: r.coinPref || 'random', dropped: !!r.dropped, droppedAt: r.droppedAt || null, lateJoin: !!r.lateJoin, deckEntries: r.deckEntries || [], ...(typeof r.deckId === 'string' && r.deckId ? { deckId: r.deckId } : {}) })),
          matches: matches.map((m) => ({ round: m.round, idx: m.idx, p1uid: m.p1uid, p1name: m.p1name, p2uid: m.p2uid, p2name: m.p2name, winnerUid: m.winnerUid, winnerName: m.winnerName, status: m.status, bye: !!m.bye, noShow: !!m.noShow, doubleNoShow: !!m.doubleNoShow, draw: !!m.draw, deadlockDraw: !!m.deadlockDraw, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved, doubleDrop: !!m.doubleDrop, dropForfeit: !!m.dropForfeit })),
        } }, { upsert: true });
      } catch (e) { /* best-effort 歸檔 */ }
    }
    // 某場結束（winner 已由 caller 設好）→ 交給 checkRoundAdvance 判斷本輪是否打完、要不要動態建下一輪或產生冠軍。
    //   （動態賽制：不再預建整棵樹、不填 parent；下一輪在本輪全部完成時才用贏家名單建立。）
    async function advanceOrFinish(m, winnerUid, winnerName) {
      await checkRoundAdvance(m.eventId);
    }
    // 瑞士配對 → TMATCH docs（沿用單敗 match 結構；p2=null=Bye 直接 done+判 p1 勝，積分由 buildSwissPlayersFromMatches 重建）。
    function pairingsToMatches(pairings, evId, round, phase, nameOf) {
      const out = []; let idx = 0;
      for (const pr of pairings) {
        const base = { _id: evId + '_r' + round + '_m' + idx, eventId: evId, round, idx, phase, roomId: null };
        if (pr.p2 == null) {
          out.push({ ...base, p1uid: pr.p1, p1name: nameOf(pr.p1), p2uid: null, p2name: null, winnerUid: pr.p1, winnerName: nameOf(pr.p1), status: 'done', bye: true });
        } else {
          out.push({ ...base, p1uid: pr.p1, p1name: nameOf(pr.p1), p2uid: pr.p2, p2name: nameOf(pr.p2), winnerUid: null, winnerName: null, status: 'pending', bye: false, entered: [false, false] });
        }
        idx++;
      }
      return out;
    }
    // ⭐v6.188 把「把房間盤面推成 game-over」抽成中央 helper（投降／裁定／判負各自複製貼上已經三份）。
    async function _forceGameOver(m, winSeat, reason) {
      if (!m || !m.roomId) return;
      try {
        const room = await TROOMS.findOne({ _id: m.roomId });
        if (!room || !room.gameState) return;
        const og = JSON.parse(JSON.stringify(room.gameState));
        og.phase = 'game-over';
        og.winner = (winSeat === 0 || winSeat === 1) ? winSeat : null;
        og.winReason = reason;
        await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: Date.now() } });
      } catch (e) { /* best-effort */ }
    }
    // ⭐⭐⭐v6.188 站長裁定③：只剩 1 位未棄賽者 ⇒ 直接判該人冠軍完賽。
    //   ⚠⚠ 這同時修掉一個**現行就會炸**的既有 bug：存活 <= 1 時 TENG.seedTopCut 回 []，
    //     而 mongodb 的 insertMany([]) **會 throw**（Invalid BulkOperation, Batch cannot be empty）
    //     ⇒ advanceSwiss 整支拋例外 ⇒ 賽事永久卡在最後一輪，沒有任何路徑救得回來。
    async function finishSwissWithSurvivor(ev, survivor) {
      await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', championUid: survivor ? survivor.uid : null, championName: survivor ? survivor.name : null } });
      if (survivor) {
        await recordChampion(ev, survivor.uid, survivor.name);
        await recordTournamentArchive({ ...ev, championUid: survivor.uid, championName: survivor.name });
        await postSystemChat('🏆 其餘選手皆已棄賽，「' + (survivor.name || '?') + '」獲得冠軍，賽事結束！');
      } else {
        await recordTournamentArchive(ev);
        await postSystemChat('⚠️ 全部選手皆已棄賽，賽事結束（無冠軍）。');
      }
    }
    // ⭐⭐v6.188「棄賽當下」的即時完賽檢查（advanceSwiss 內另有一份是「輪次結束時」的檢查；
    //   兩個時機都要有：在輪次之間棄賽時沒有任何一輪會結束，只靠 advanceSwiss 那份會卡住）。
    async function finishIfLastSurvivor(eventId) {
      const ev = await TEVENTS.findOne({ _id: eventId });
      if (!ev || ev.status !== 'running') return;
      const regs = await TREGS.find({ eventId, checkedIn: true }).toArray();
      const alive = regs.filter((r) => !r.dropped && !r.autoRemovedConflict);
      if (alive.length > 1) return;
      // 還有沒打完的對戰 ⇒ 交給既有流程收（絕不硬砍別人正在打的局）。
      const _open = await TMATCH.countDocuments({ eventId, status: { $ne: 'done' } });
      if (_open > 0) return;
      const champ = alive[0] || null;
      await TEVENTS.updateOne({ _id: eventId }, { $set: { status: 'finished', championUid: champ ? champ.uid : null, championName: champ ? champ.name : null } });
      if (champ) {
        await recordChampion(ev, champ.uid, champ.name);
        await recordTournamentArchive({ ...ev, championUid: champ.uid, championName: champ.name });
        await postSystemChat('🏆 其餘選手皆已棄賽，「' + (champ.name || '?') + '」獲得冠軍，賽事結束！');
      } else {
        await recordTournamentArchive(ev);
        await postSystemChat('⚠️ 全部選手皆已棄賽，賽事結束（無冠軍）。');
      }
    }
    // 瑞士制晉級：本輪打完 → 由所有瑞士輪 TMATCH 重建 standings → 未達輪數配下一瑞士輪、達到則依排名取前 K 進 Top Cut(單敗)。
    async function advanceSwiss(ev, cur) {
      const swissMatches = await TMATCH.find({ eventId: ev._id, phase: 'swiss' }).toArray();
      const regs = await TREGS.find({ eventId: ev._id, checkedIn: true }).toArray();
      const nameOf = (uid) => { const r = regs.find((x) => x.uid === uid); return (r && r.name) || '玩家'; };
      const players = TENG.buildSwissPlayersFromMatches(
        swissMatches.map((m) => ({ round: m.round, p1uid: m.p1uid, p2uid: m.p2uid, winnerUid: m.winnerUid, bye: !!m.bye, status: m.status })),
        // ⭐⭐⭐v6.188 接線：`dropped` 一直存在於 src/lib/tournament/swiss.ts（欄位 L17、
        //   pairSwissRound 的過濾 L94、buildSwissPlayersFromMatches 的參數 L155 都寫好了），
        //   **就是沒有人把它從 TREGS 傳進來** ⇒ 棄賽者照樣被排進下一輪。這一行就是那條斷掉的線。
        regs.map((r) => ({ uid: r.uid, name: r.name || '玩家', dropped: !!r.dropped })),
      );
      const alive = players.filter((p) => !p.dropped);
      const swissRounds = (ev.swissRounds > 0) ? ev.swissRounds : TENG.swissRoundsForCount(players.length);
      const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
      // 站長裁定③：只剩 1 位未棄賽 ⇒ 直接判冠軍完賽（也不可能再配得出對手）。
      if (alive.length <= 1) return await finishSwissWithSurvivor(ev, alive[0] || null);
      if (cur < swissRounds) {
        const next = cur + 1;
        const pairings = TENG.pairSwissRound(players, next);
        const _swMatches = pairingsToMatches(pairings, ev._id, next, 'swiss', nameOf);
        if (!_swMatches.length) return await finishSwissWithSurvivor(ev, alive[0] || null);  // ⚠ insertMany([]) 會 throw
        await TMATCH.insertMany(_swMatches);
        await TEVENTS.updateOne({ _id: ev._id }, { $set: { currentRound: next, roundStartedAt: Date.now() } });
        await postSystemChat('⚔️ 瑞士制第 ' + next + ' / ' + swissRounds + ' 輪配對完成！休息倒數 ' + cdMin + ' 分鐘，時間到才可進場。');
      } else {
        const standings = TENG.computeStandings(players);
        // ⭐⭐v6.188 站長裁定②：棄賽者從 Top Cut 資格剔除。
        //   ⚠ **先 computeStandings(全部人) 再 filter** —— OWP/OOWP 要靠棄賽者的戰績才算得對，
        //     先把人拿掉會讓所有跟他打過的人 OWP 失真（這正是不採「照排＋自動判勝」方案的理由）。
        const cutPool = standings.filter((s) => !s.dropped);
        const K = (ev.topCut > 0) ? ev.topCut : TENG.topCutSizeForCount(cutPool.length);
        const next = cur + 1;
        const _cutMatches = pairingsToMatches(TENG.seedTopCut(cutPool, K), ev._id, next, 'cut', nameOf);
        if (!_cutMatches.length) return await finishSwissWithSurvivor(ev, cutPool[0] || null);  // ⚠ 存活 <= 1：seedTopCut 回 [] ⇒ insertMany 會 throw
        await TMATCH.insertMany(_cutMatches);
        await TEVENTS.updateOne({ _id: ev._id }, { $set: { phase: 'cut', currentRound: next, roundStartedAt: Date.now() } });
        await postSystemChat('🏆 瑞士制 ' + swissRounds + ' 輪結束！依積分(破同分 OWP/OOWP)取前 ' + K + ' 名進入單敗淘汰 Top Cut，休息倒數 ' + cdMin + ' 分鐘後開打！');
      }
    }
    // 本輪全部 done → 收集贏家（含輪空者）。剩 1 人＝冠軍完賽；>1 人＝動態建下一輪（每輪只 1 人輪空，優先未輪空者）。
    // ⭐v6.189 只改文案的 helper：winners 被濾成 0 的成因不只一種，公告要照實際旗標講。
    //   ①doubleNoShow —— 雙方皆未出賽。⚠ 這個旗標同時被「兩人都沒進場」與「兩人都閒置逾時」
    //     兩條路徑寫入（v6.156 只把『系統死角』拆成 deadlockDraw 出去），資料上分不出來 ⇒
    //     措辭同時涵蓋兩者，不硬猜。
    //   ②doubleDrop —— v6.188 的「兩人都棄賽」。原本的文案會把棄賽說成未進場，直接誤導玩家。
    //   ③draw / timeLimit —— 時限到而平手。
    //   ④droppedWinners > 0 —— 本輪明明有人贏，但勝方全部棄賽（v6.188 的 dropped 過濾）。
    //   ⚠ 本函式**只產生字串**，不讀寫 DB、不參與任何判定。
    function noChampionReason(ms, droppedWinners) {
      if (droppedWinners > 0) return droppedWinners > 1 ? '本輪勝出的選手都已棄賽' : '最後一場的勝方已棄賽';
      const noWin = (ms || []).filter((m) => !m.winnerUid);
      if (!noWin.length) return '本輪沒有可晉級的選手';
      const kinds = new Set(noWin.map((m) => (m.doubleDrop ? 'drop' : ((m.draw || m.timeLimit) ? 'draw' : (m.doubleNoShow ? 'noshow' : 'other')))));
      if (kinds.size === 1) {
        const pfx = noWin.length > 1 ? '最後各場' : '最後一場';
        for (const only of kinds) {
          if (only === 'drop') return pfx + '雙方皆棄賽';
          if (only === 'draw') return pfx + '平手（時限到，雙方未分出勝負）';
          if (only === 'noshow') return pfx + '雙方皆未出賽（未進場或閒置逾時）';
        }
      }
      return '最後一輪沒有任何人勝出（棄賽／未出賽／平手）';
    }
    async function checkRoundAdvance(eventId) {
      const ev = await TEVENTS.findOne({ _id: eventId });
      if (!ev || ev.status !== 'running') return;
      const cur = ev.currentRound;
      const curMatches = await TMATCH.find({ eventId, round: cur }).toArray();
      if (!curMatches.length) return;
      if (curMatches.some((m) => m.status !== 'done')) return;  // 本輪還沒打完
      // 瑞士制階段：走瑞士晉級(重算 standings→配下一輪/進 Top Cut)。cut 階段與純單敗都走下方原邏輯。
      if (ev.format === 'swiss-then-cut' && ev.phase === 'swiss') { return await advanceSwiss(ev, cur); }
      // 收集本輪贏家（雙未進場的場無 winner → 兩人皆淘汰，不列入）
      const winners = [];
      for (const m of curMatches) { if (m.winnerUid) winners.push({ uid: m.winnerUid, name: m.winnerName }); }
      // ⭐⭐v6.188 站長裁定⑤：單淘汰／Top Cut 階段也可棄賽（語意＝投降）。棄賽者即使本輪贏了
      //   也不再被排進下一輪 —— 否則他會一路輪空到決賽，把整個賽程打壞。
      //   ⚠ 這裡只影響「還沒建的下一輪」，已完成輪次的勝負一個字都不動（裁定④：勝場保留）。
      let _droppedWinners = 0;  // v6.189：只給公告文案用的計數，不參與任何判定。
      if (winners.length) {
        try {
          const _droppedRegs = await TREGS.find({ eventId, dropped: true }, { projection: { uid: 1 } }).toArray();
          if (_droppedRegs.length) {
            const _dset = new Set(_droppedRegs.map((r) => r.uid));
            for (let i = winners.length - 1; i >= 0; i--) { if (_dset.has(winners[i].uid)) { winners.splice(i, 1); _droppedWinners++; } }
          }
        } catch (e) { /* 查不到棄賽名單 ⇒ 維持原行為，絕不因此卡住賽程 */ }
      }
      if (winners.length <= 1) {
        const champ = winners[0] || null;
        await TEVENTS.updateOne({ _id: eventId }, { $set: { status: 'finished', championUid: champ ? champ.uid : null, championName: champ ? champ.name : null } });
        if (champ) {
          await recordChampion(ev, champ.uid, champ.name);
          await recordTournamentArchive({ ...ev, championUid: champ.uid, championName: champ.name });
          await postSystemChat('🏆 賽事結束！冠軍：' + (champ.name || '?') + ' 🎉 恭喜！');
        } else {
          await recordTournamentArchive(ev);
          await postSystemChat('⚠️ 賽事結束（' + noChampionReason(curMatches, _droppedWinners) + '，無冠軍）。');
        }
        return;
      }
      // 還有 >1 人 → 建下一輪。算每人至今累計輪空數（輪空優先給最少者）。
      const allMatches = await TMATCH.find({ eventId }).toArray();
      const byeCount = {};
      // cut 階段(swiss-then-cut)只計 cut 期 Bye；純單敗 ev.phase 為空 → 計全部(行為不變)。
      for (const m of allMatches) { if (m.bye && m.winnerUid && (!ev.phase || m.phase === ev.phase)) byeCount[m.winnerUid] = (byeCount[m.winnerUid] || 0) + 1; }
      const next = cur + 1;
      const nextPlayers = winners.map((w) => ({ uid: w.uid, name: w.name, byes: byeCount[w.uid] || 0 }));
      const nextMatches = buildRoundMatches(nextPlayers, eventId, next);
      if (ev.phase) nextMatches.forEach((m) => { m.phase = ev.phase; });  // cut 階段標記，供 byeCount 範圍判定
      await TMATCH.insertMany(nextMatches);
      await TEVENTS.updateOne({ _id: eventId }, { $set: { currentRound: next, roundStartedAt: Date.now() } });
      const cd = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
      await postSystemChat((ev.format === 'swiss-then-cut' && ev.phase === 'cut') ? ('⚔️ Top Cut 下一輪賽程已產生！休息倒數 ' + cd + ' 分鐘，時間到才可進場。') : ('⚔️ 第 ' + next + ' 輪賽程已產生！休息倒數 ' + cd + ' 分鐘，時間到才可進場。'));
    }
    // 對局結束 → 記勝者 + 晉級
    async function onMatchGameOver(doc, gs) {
      if (!doc.matchId) return;
      const m = await TMATCH.findOne({ _id: doc.matchId });
      if (!m || m.status === 'done') return;
      const wSeat = (gs.winner === 0 || gs.winner === 1) ? gs.winner : null;
      if (wSeat == null) return;
      const winnerUid = doc.seats[wSeat]; const winnerName = (doc.names && doc.names[wSeat]) || '';
      // v0.37 永久快照：把最終盤面 + 逐回合對戰 log 寫進 match 紀錄，供日後 debug（即使房間被清也留得住）。
      await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid, winnerName, status: 'done',
        finalLog: Array.isArray(gs.log) ? gs.log : [], finalState: gs, finalWinReason: gs.winReason || null, finalTurn: gs.turn || null, endedAt: Date.now() } });
      await advanceOrFinish(m, winnerUid, winnerName);
    }

    // 管理員：產生賽程（報名名單 → 隨機種子 → 單敗淘汰，含 bye）
    app.post('/api/tournament/admin/bracket/seed', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        const r = await seedEventBracket(ev);
        if (r.alreadySeeded) return res.status(409).json({ error: '賽事已開賽（賽程已存在）。如需重排請用強制重建。' });
        if (r.error) return res.status(400).json({ error: r.error });
        await postSystemChat('🔔 「' + ev.name + '」賽程已公布，第 1 輪開始！');
        res.json({ ok: true, rounds: r.rounds, players: r.players });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 賽程表
    // v0.69 降載：/bracket 的 standings 重算(buildSwissPlayersFromMatches + computeStandings,O(n²) OWP/OOWP)
    //   原每次呼叫都算;輪次交替時 ~50 人同時回大廳每 9s 打一次 → 重算風暴。改 3s TTL 快取(per event):
    //   多人同時打只算一次;currentRound/status 變(輪次推進)即刻失效。per-user 的 mine 旗標於回應時再貼(便宜 O(n))。
    const _bracketCache = new Map(); // eventId -> { at, round, status, matchesRaw, standingsRaw(含uid) }
    // v0.80 觀戰人數:觀戰者輪詢 /spectate/state 當心跳;countSpectators=最近 8s 內 distinct uid 數(2位對戰者走 /state 不計入)。
    const _specHeartbeat = new Map(); // room -> Map<uid, lastSeenTs>
    const SPEC_HEARTBEAT_STALE_MS = 8000;
    function markSpectator(room, uid) {
      if (!room || !uid) return;
      let m = _specHeartbeat.get(room);
      if (!m) { m = new Map(); _specHeartbeat.set(room, m); }
      m.set(uid, Date.now());
      if (_specHeartbeat.size > 200) { const k = _specHeartbeat.keys().next().value; if (k !== room) _specHeartbeat.delete(k); }  // 防記憶體長大
    }
    function countSpectators(room) {
      const m = _specHeartbeat.get(room);
      if (!m) return 0;
      const now = Date.now(); let n = 0;
      for (const [uid, ts] of m) { if (now - ts <= SPEC_HEARTBEAT_STALE_MS) n++; else m.delete(uid); }
      if (m.size === 0) _specHeartbeat.delete(room);
      return n;
    }
    const BRACKET_TTL_MS = 3000;
    app.get('/api/tournament/bracket', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.json({ event: null, matches: [] });
        const _now = Date.now();
        let _cache = _bracketCache.get(ev._id);
        if (!_cache || (_now - _cache.at) > BRACKET_TTL_MS || _cache.round !== ev.currentRound || _cache.status !== ev.status) {
          const matches = await TMATCH.find({ eventId: ev._id }).sort({ round: 1, idx: 1 }).toArray();
          // v0.48：瑞士制賽事附即時排名表(由 swiss 階段對戰紀錄重建 → computeStandings)。
          let standingsRaw = null;
          if (ev.format === 'swiss-then-cut') {
            try {
              const regs = await TREGS.find({ eventId: ev._id, checkedIn: true }).toArray();
              const players = TENG.buildSwissPlayersFromMatches(
                matches.filter((m) => m.phase === 'swiss').map((m) => ({ round: m.round, p1uid: m.p1uid, p2uid: m.p2uid, winnerUid: m.winnerUid, bye: !!m.bye, status: m.status })),
                regs.map((r) => ({ uid: r.uid, name: r.name || '玩家', dropped: !!r.dropped })),
              );
              standingsRaw = TENG.computeStandings(players).map((p) => ({
                uid: p.uid, rank: p.rank, name: p.name, matchPoints: p.matchPoints, dropped: !!p.dropped,
                w: p.results.filter((r) => r === 'W' || r === 'BYE').length,
                l: p.results.filter((r) => r === 'L').length,
                owp: Math.round(p.owp * 1000) / 10,
                oowp: Math.round(p.oowp * 1000) / 10,
              }));
            } catch (e) { standingsRaw = null; }
          }
          const matchesRaw = matches.map((m) => ({ round: m.round, idx: m.idx, phase: m.phase || null, p1uid: m.p1uid, p2uid: m.p2uid, p1name: m.p1name, p2name: m.p2name, winnerName: m.winnerName, winnerUid: m.winnerUid, status: m.status, bye: m.bye, roomId: m.roomId || null }));
          _cache = { at: _now, round: ev.currentRound, status: ev.status, matchesRaw, standingsRaw };
          _bracketCache.set(ev._id, _cache);
          // v0.69：上限 20 個 event(防歷史/社群賽 eventId 累積漏記憶體);超過刪最舊(插入序)。
          if (_bracketCache.size > 20) { const _oldest = _bracketCache.keys().next().value; if (_oldest !== ev._id) _bracketCache.delete(_oldest); }
        }
        res.json({
          event: { _id: ev._id, name: ev.name, status: ev.status, currentRound: ev.currentRound, rounds: ev.rounds, championName: ev.championName || null, format: ev.format || 'single-elim', phase: ev.phase || null, swissRounds: ev.swissRounds || null, topCut: ev.topCut || null },
          matches: _cache.matchesRaw.map((m) => ({ round: m.round, idx: m.idx, phase: m.phase, p1name: m.p1name, p2name: m.p2name, winnerName: m.winnerName, winner: (m.winnerUid && m.winnerUid === m.p1uid) ? 'p1' : (m.winnerUid && m.winnerUid === m.p2uid) ? 'p2' : null, status: m.status, bye: m.bye, mine: (m.p1uid === id.uid || m.p2uid === id.uid), roomId: m.status === 'playing' ? (m.roomId || null) : null, viewers: (m.status === 'playing' && m.roomId) ? countSpectators(m.roomId) : 0 })),
          standings: _cache.standingsRaw ? _cache.standingsRaw.map((s) => ({ rank: s.rank, name: s.name, matchPoints: s.matchPoints, w: s.w, l: s.l, owp: s.owp, oowp: s.oowp, dropped: !!s.dropped, mine: s.uid === id.uid })) : null,
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 觀戰：列出進行中的對戰（任何登入者可看）
    app.get('/api/tournament/spectate/list', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.json({ matches: [] });
        // v0.43：排除「自己參賽」的對戰 — 參賽者不該觀戰自己的對局(會拿到 redact 手牌→誤以為變觀戰看不到手牌)。
        const ms = await TMATCH.find({ eventId: ev._id, status: 'playing', roomId: { $ne: null }, p1uid: { $ne: id.uid }, p2uid: { $ne: id.uid } }).toArray();
        res.json({ matches: ms.map((m) => ({ roomId: m.roomId, round: m.round, p1name: m.p1name, p2name: m.p2name })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 觀戰：取對局盤面（雙方手牌 redact 成卡背，防作弊；觀戰者不可操作）
    app.get('/api/tournament/spectate/state', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const room = String(req.query.room || '');
        const cv = Number(req.query.v);
        // v0.68 降載：先比對版本，相符則免深拷貝蓋手牌，回精簡 unchanged。
        const light = await TROOMS.findOne({ _id: room }, { projection: { gameState: 0 } });
        if (!light) return res.json({ version: -1, waiting: true });
        // v6.150：當事人不得走觀戰端點。/spectate/list 從 v0.43 就排除自己的場、前端也有防呆，
        //   但端點本身沒擋 —— 房號是 /bracket 公開回傳的，對戰中的玩家直接打這裡就繞過了玩家端遮蔽。
        if (Array.isArray(light.seats) && light.seats.indexOf(id.uid) >= 0) return res.status(403).json({ error: '不能觀戰自己的對戰' });
        markSpectator(room, id.uid);  // v0.80 觀戰人數:記錄此觀戰者心跳
        if (Number.isFinite(cv) && cv >= 0 && cv === light.version) {
          return res.json({ version: light.version, unchanged: true, seats: [null, null], names: light.names, spectate: true });
        }
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc || !doc.gameState) return res.json({ version: -1, waiting: true });
        // v6.150：收斂到玩家端同一條中央出口（seat=-1 ⇒ 雙方的 hand/deck/prizes 都遮、
        //   privateMessage 全剝除）。原本只蓋 hand —— **牌庫順序與獎賞內容照樣送給觀戰者**，
        //   而房號是公開的，等於玩家端的遮蔽可以整條繞過。log 截尾也由 _capLog 一併處理。
        res.json({ gameState: _stateForSeat(doc.gameState, -1), version: doc.version, seats: [null, null], names: doc.names, spectate: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 進入我這輪的對戰（建/取伺服器權威房）
    app.post('/api/tournament/match/enter', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        // v0.40 多賽事：玩家可能同時報名多場 → 跨所有「進行中」賽事找「我這輪可進場」的對戰。
        const _runEv = await TEVENTS.find({ status: 'running' }).toArray();
        let ev = null, m = null;
        for (const _e of _runEv) {
          const _mm = await TMATCH.findOne({ eventId: _e._id, round: _e.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null }, $or: [{ p1uid: id.uid }, { p2uid: id.uid }] });
          if (_mm) { ev = _e; m = _mm; break; }
        }
        if (!ev) return res.json({ error: '賽事尚未開始或已結束' });
        if (!m) return res.json({ error: '你目前沒有可進行的對戰（可能在等對手、等下一輪、或已淘汰）' });
        // 倒數休息 gate：到 enterOpenAt 才可進場
        const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
        const enterOpenAt = (ev.roundStartedAt || 0) + cdMin * 60000;
        if (Date.now() < enterOpenAt) return res.json({ error: '本輪休息倒數中，時間到才可進場', enterOpenAt });
        // 標記本人已進場（未進場判負用）— v0.56 原子化：兩人同時進場時不可 read-modify-write 整包覆蓋
        //   (曾致先進場者旗標被後進場者讀到的舊值覆蓋→打到一半被誤判未進場)。先確保 entered 為陣列，
        //   再用 positional $set 只更新自己那一格，兩座位互不干擾。
        const mySeat0 = (id.uid === m.p1uid) ? 0 : 1;
        await TMATCH.updateOne({ _id: m._id, entered: { $exists: false } }, { $set: { entered: [false, false] } });
        await TMATCH.updateOne({ _id: m._id }, { $set: { ['entered.' + mySeat0]: true } });
        // ⭐v6.214② **純遙測**：第一次進場的時刻。目前站上完全沒有「玩家實際多久才進場」的資料
        //   （TMATCH 只有 entered 布林），所以「容許窗要縮到幾分鐘」只能用既有門檻推論。
        //   ⚠ 這個欄位**不參與任何判定**（未進場判負一律只看 entered），純粹是為了讓下一次
        //     調整有真實分佈可以依據。只寫第一次（條件是那一格還是 null）。
        try {
          await TMATCH.updateOne({ _id: m._id, enteredAt: { $exists: false } }, { $set: { enteredAt: [null, null] } });
          await TMATCH.updateOne({ _id: m._id, ['enteredAt.' + mySeat0]: null }, { $set: { ['enteredAt.' + mySeat0]: Date.now() } });
        } catch (e) { /* 遙測失敗絕不可以擋住玩家進場 */ }
        let roomId = m.roomId;
        if (!roomId) {
          roomId = 'mr_' + m._id;
          const reg1 = await TREGS.findOne({ _id: ev._id + '__' + m.p1uid });
          const reg2 = await TREGS.findOne({ _id: ev._id + '__' + m.p2uid });
          if (!reg1 || !reg2) return res.status(500).json({ error: '找不到玩家牌組' });
          let gs;
          try { gs = makeGame([reg1.deckEntries, reg2.deckEntries], [m.p1name, m.p2name], [reg1.coinPref || 'random', reg2.coinPref || 'random']); }
          catch (e) { return res.status(500).json({ error: '建立對局失敗（牌組可能含未支援卡）：' + e.message }); }
          // v5.597 競態修正：兩位玩家(或玩家+觀戰)幾乎同時 enter 時，都會讀到 m.roomId=null 而各自
          //   makeGame()（各自洗牌/擲幣＝兩個不同對局），原本用 $set 後者覆蓋前者 → 兩端拿到「同版本號
          //   但內容不同」的分歧狀態，版本式 adopt 永遠收斂不了 → 其中一方卡死/觀戰拿到瞬時 null 卡在等待。
          //   改為 $setOnInsert：gameState 等建局欄位只在「第一次 insert」寫入，並發的第二次 enter 不覆蓋，
          //   兩端必收斂到同一局。upsert 的 insert 在 MongoDB 層級是原子的（同 _id 只有一個 insert 成功）。
          await TROOMS.updateOne({ _id: roomId }, {
            $setOnInsert: { _id: roomId, seats: [m.p1uid, m.p2uid], names: [m.p1name, m.p2name], decks: [reg1.deckEntries, reg2.deckEntries], gameState: gs, version: 1, matchId: m._id, eventId: ev._id, lastActionAt: Date.now(), idleForfeitMin: (ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3), actorSeat: currentActorSeat(gs) },   // v6.151 初始 actorSeat
            $set: { updatedAt: Date.now() },
          }, { upsert: true });
          await TMATCH.updateOne({ _id: m._id }, { $set: { roomId, status: 'playing', gameStartedAt: Date.now() } });
        }
        const seat = (id.uid === m.p1uid) ? 0 : 1;
        res.json({ roomId, seat });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 玩家投降：對戰中按「投降離開」→ 立即判對手勝 + 晉級（不必等對局時限）
    app.post('/api/tournament/match/forfeit', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        // v0.40 多賽事：跨所有進行中賽事找我「對戰中」的場
        const _runEv = await TEVENTS.find({ status: 'running' }).toArray();
        let ev = null, m = null;
        for (const _e of _runEv) {
          const _mm = await TMATCH.findOne({ eventId: _e._id, status: 'playing', $or: [{ p1uid: id.uid }, { p2uid: id.uid }] });
          if (_mm) { ev = _e; m = _mm; break; }
        }
        if (!ev || !m) return res.json({ ok: true, note: '無進行中對戰' });
        if (!m) return res.json({ ok: true, note: '無進行中對戰' });
        const mySeat = (id.uid === m.p1uid) ? 0 : 1;
        const winSeat = 1 - mySeat;
        const wUid = winSeat === 0 ? m.p1uid : m.p2uid, wName = winSeat === 0 ? m.p1name : m.p2name;
        const lName = mySeat === 0 ? m.p1name : m.p2name;
        await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', forfeit: true } });
        if (m.roomId) { try { const room = await TROOMS.findOne({ _id: m.roomId }); if (room && room.gameState) { const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '對手') + ' 投降，' + wName + ' 勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: Date.now() } }); } } catch (e) { /* best-effort */ } }
        await postSystemChat('🏳 ' + (lName || '一方') + ' 投降，' + wName + ' 獲勝。');
        await advanceOrFinish(m, wUid, wName);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ⭐⭐⭐v6.188 中途棄賽（瑞士制＝退出後續配對；單淘汰＝投降退出）。
    //   採**方案 B：移出配對池**，而不是「照排然後自動判勝」——
    //   照排會把棄賽者勝率壓到 0.25 地板、連帶拖累**所有前對手的 OWP**，
    //   而且每輪都有一個人白拿 3 分。移出配對池才是官方 Play! Pokémon 的做法。
    //   ⚠⚠ 站長裁定①：**棄賽不可逆**。本檔刻意**沒有**任何取消棄賽的端點，
    //     誤按的個案由站長在後台處理；玩家端唯一的保護是按下去前的確認框。
    app.post('/api/tournament/drop', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(409).json({ error: '目前沒有賽事' });
        if (ev.status === 'finished') return res.status(409).json({ error: '賽事已結束，無法棄賽' });
        // ⚠ 措辭要誠實（Fable 審查）：/unregister 只在 registration 階段開放，
        //   報到階段叫人去「退賽」等於指了一條不存在的路。
        if (ev.status !== 'running') return res.status(409).json({ error: ev.status === 'registration' ? '賽事尚未開賽，請改用賽事卡片上的「退賽」取消報名' : '賽事尚未開賽，此階段無法棄賽' });
        const reg = await TREGS.findOne({ _id: ev._id + '__' + id.uid });
        if (!reg) return res.status(409).json({ error: '你未參加本賽事' });
        if (reg.dropped) return res.status(409).json({ error: '你已經棄賽了（棄賽無法復原）' });
        const _now = Date.now();
        // ⚠ 條件式更新搶占：只有真的把 dropped 從「非 true」翻成 true 的那一次才往下收尾，
        //   防連點造成重複公告／重複收場（v6.140「刪除連點 → 成功卻報錯」的同族防護）。
        const _claim = await TREGS.updateOne({ _id: reg._id, dropped: { $ne: true } }, { $set: { dropped: true, droppedAt: _now } });
        if (!_claim || _claim.modifiedCount !== 1) return res.status(409).json({ error: '你已經棄賽了（棄賽無法復原）' });
        const myName = reg.name || '一位選手';
        await postSystemChat('🏳 ' + myName + ' 已中途棄賽，後續輪次不再排入配對。');
        // 收掉我當前尚未結束的那一場（含還沒進場的 pending）—— 否則本輪永遠打不完。
        const m = await TMATCH.findOne({ eventId: ev._id, status: { $in: ['pending', 'playing'] }, $or: [{ p1uid: id.uid }, { p2uid: id.uid }] });
        if (m) {
          const mySeat = (id.uid === m.p1uid) ? 0 : 1;
          const oppUid = mySeat === 0 ? m.p2uid : m.p1uid;
          const oppName = mySeat === 0 ? m.p2name : m.p1name;
          const oppReg = oppUid ? await TREGS.findOne({ _id: ev._id + '__' + oppUid }) : null;
          const oppDropped = !!(oppReg && oppReg.dropped);
          // ⚠⚠v6.188（Fable 審查抓到）：從 findOne 到 updateOne 之間，這一場可能已經被別的路徑收掉
          //   （正常打完的 onMatchGameOver、對手同時投降、雙方同時棄賽交錯）。沒有 CAS 就會**無條件
          //   覆寫已經 done 的結果** —— 最壞是「我正贏、盤面剛判我勝，我同時按棄賽」把自己的勝場
          //   改寫成對手 forfeit 勝。⇒ 兩處 updateOne 都加 status 條件，沒搶到就不做任何收場副作用
          //   （不推 game-over、不公告），直接交給既有流程。reg 端的 dropped 早就是條件式搶占了。
          const _mFilter = { _id: m._id, status: { $in: ['pending', 'playing'] } };
          if (!oppUid || oppDropped) {
            // ⚠⚠ 兩人都棄賽 ⇒ 雙敗，用**新旗標 doubleDrop**。
            //   **絕不重用 doubleNoShow**：那個旗標在賽果頁與歸檔裡的語意是「兩人都沒出現」，
            //   混用會讓事後對帳分不出「棄賽」與「掛機沒出現」（v6.156 明確教訓）。
            //   計分邏輯 swiss.ts 現成：status==='done' 且 winnerUid===null ⇒ 雙方各記一敗、都不得分。
            const _w = await TMATCH.updateOne(_mFilter, { $set: { status: 'done', winnerUid: null, winnerName: null, doubleDrop: true } });
            if (_w && _w.matchedCount === 1) {
              await _forceGameOver(m, null, '雙方皆已棄賽，本場雙敗');
              await postSystemChat('🏳 第 ' + m.round + ' 輪 ' + (m.p1name || 'P1') + ' vs ' + (m.p2name || 'P2') + '：雙方皆已棄賽，本場以雙敗處理。');
            }
          } else {
            // 對戰中棄賽 ⇒ 沿用既有 /match/forfeit 的收場方式（對手勝 + 房間盤面推成 game-over）。
            const _w = await TMATCH.updateOne(_mFilter, { $set: { winnerUid: oppUid, winnerName: oppName, status: 'done', forfeit: true, dropForfeit: true } });
            if (_w && _w.matchedCount === 1) {
              await _forceGameOver(m, 1 - mySeat, myName + ' 棄賽，' + oppName + ' 勝');
              await postSystemChat('🏳 ' + myName + ' 棄賽，本場由 ' + oppName + ' 獲勝。');
            }
          }
          await checkRoundAdvance(ev._id);
        } else {
          // 沒有進行中的對戰（例如輪次之間的休息時間）⇒ 本輪不需要收尾。
          await checkRoundAdvance(ev._id);
        }
        await finishIfLastSurvivor(ev._id);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：裁定平手場(時限到雙方獎賞相同)的勝者
    app.post('/api/tournament/admin/match/resolve', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可裁定' });
        const matchId = String((req.body && req.body.matchId) || '');
        const winnerSeat = Number(req.body && req.body.winnerSeat);
        const m = await TMATCH.findOne({ _id: matchId });
        if (!m) return res.status(404).json({ error: '找不到該場次' });
        if (m.status === 'done') return res.status(409).json({ error: '該場次已結束' });
        if (winnerSeat !== 0 && winnerSeat !== 1) return res.status(400).json({ error: 'winnerSeat 需 0 或 1' });
        const wUid = winnerSeat === 0 ? m.p1uid : m.p2uid, wName = winnerSeat === 0 ? m.p1name : m.p2name;
        if (!wUid) return res.status(400).json({ error: '該座位無玩家，無法判勝' });
        await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', adminResolved: true } });
        if (m.roomId) { try { const room = await TROOMS.findOne({ _id: m.roomId }); if (room && room.gameState) { const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winnerSeat; og.winReason = '管理員裁定：' + wName + ' 勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: Date.now() } }); } } catch (e) { /* best-effort */ } }
        await postSystemChat('⚖️ 管理員裁定：' + wName + ' 獲勝。');
        await advanceOrFinish(m, wUid, wName);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：列出所有「未結束」場次（強制裁定卡死場用，不限平手）
    app.get('/api/tournament/admin/pending-matches', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.json({ pending: [] });
        const ms = await TMATCH.find({ eventId: ev._id, status: { $ne: 'done' } }).sort({ round: 1, idx: 1 }).toArray();
        res.json({ pending: ms.map((m) => ({ matchId: m._id, round: m.round, idx: m.idx, p1name: m.p1name, p2name: m.p2name, hasP1: !!m.p1uid, hasP2: !!m.p2uid, status: m.status })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：重賽（從擲幣重新開始該場對局；只限尚未結束的場）
    app.post('/api/tournament/admin/match/restart', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const matchId = String((req.body && req.body.matchId) || '');
        const m = await TMATCH.findOne({ _id: matchId });
        if (!m) return res.status(404).json({ error: '找不到該場次' });
        if (m.status === 'done') return res.status(409).json({ error: '已結束的場次無法重賽（請改用強制裁定／完賽）' });
        if (!m.p1uid || !m.p2uid) return res.status(400).json({ error: '此場尚未湊齊兩位玩家，無法重賽' });
        const ev = await TEVENTS.findOne({ _id: m.eventId });
        const reg1 = await TREGS.findOne({ _id: m.eventId + '__' + m.p1uid });
        const reg2 = await TREGS.findOne({ _id: m.eventId + '__' + m.p2uid });
        if (!reg1 || !reg2) return res.status(500).json({ error: '找不到玩家牌組' });
        // ⭐v6.188 棄賽不可逆：rematch 會 $unset 一整排結果旗標並把場子重新開打，
        //   對已棄賽的玩家等於把他抓回賽程（而他很可能早就離線了）⇒ 一律擋下。
        if (reg1.dropped || reg2.dropped) return res.status(409).json({ error: '此場有玩家已中途棄賽，無法重賽（需先在資料庫清除該玩家的 dropped 標記）' });
        let gs;
        try { gs = makeGame([reg1.deckEntries, reg2.deckEntries], [m.p1name, m.p2name], [reg1.coinPref || 'random', reg2.coinPref || 'random']); }
        catch (e) { return res.status(500).json({ error: '建立對局失敗：' + e.message }); }
        const roomId = m.roomId || ('mr_' + m._id);
        const prev = await TROOMS.findOne({ _id: roomId });
        await TROOMS.updateOne({ _id: roomId }, { $set: { _id: roomId, seats: [m.p1uid, m.p2uid], names: [m.p1name, m.p2name], decks: [reg1.deckEntries, reg2.deckEntries], gameState: gs, version: ((prev && prev.version) || 0) + 1, matchId: m._id, eventId: m.eventId, updatedAt: Date.now(), lastActionAt: Date.now(), recentActs: { s0: [], s1: [] }, idleForfeitMin: (ev && ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3), actorSeat: currentActorSeat(gs) } }, { upsert: true });   // v6.151 初始 actorSeat
        await TMATCH.updateOne({ _id: m._id }, { $set: { roomId, status: 'playing', winnerUid: null, winnerName: null, gameStartedAt: Date.now(), entered: [true, true] }, $unset: { noShow: '', doubleNoShow: '', forfeit: '', idleForfeit: '', timeLimit: '', adminResolved: '', timeLimitReached: '', timeLimitTurn: '', timeLimitCalledAt: '', draw: '', doubleDrop: '', dropForfeit: '' } });
        await TREPLAY.deleteMany({ matchId: m._id }).catch(() => {});  // v0.83 重賽重用 matchId→清舊局快照,避免 $setOnInsert 冪等把兩局混成一場
        await postSystemChat('🔄 管理員將「' + m.p1name + ' vs ' + m.p2name + '」重新開賽（從擲幣重新開始）。');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：強制完賽（賽事卡死的最終安全閥；可指定冠軍 seat，或無冠軍結束）
    app.post('/api/tournament/admin/event/force-finish', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(404).json({ error: '沒有進行中的賽事' });
        const champUid = (req.body && req.body.championUid) || null;
        const champName = (req.body && req.body.championName) || null;
        await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', championUid: champUid, championName: champName, forceFinished: true } });
        if (champUid) await recordChampion(ev, champUid, champName);
        await recordTournamentArchive({ ...ev, championUid: champUid, championName: champName });
        await postSystemChat(champName ? ('🏆 管理員強制完賽，冠軍：' + champName) : '⚠️ 管理員強制結束賽事（無冠軍）。');
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 名人堂：歷屆冠軍列表（公開，登入即可看）
    app.get('/api/tournament/champions', async (req, res) => {
      try {
        // v0.85：官方賽與社群賽各取最近 100 位冠軍(原為混合上限 200 → 某類多時會擠掉另一類)。
        //   communityEvent!=true(含缺欄/false/null)=官方賽；communityEvent=true=社群自辦賽。前端依同旗標分流渲染。
        const _officialC = await TCHAMPS.find({ communityEvent: { $ne: true } }).sort({ finishedAt: -1 }).limit(100).toArray();
        const _communityC = await TCHAMPS.find({ communityEvent: true }).sort({ finishedAt: -1 }).limit(100).toArray();
        const cs = _officialC.concat(_communityC);
        // ⭐v6.244：名人堂顯示的日期＝**開賽日**（startedAt），不是冠軍產生時間（finishedAt）。
        //   startedAt 是本版才開始寫進 TCHAMPS 的新欄位 ⇒ 舊紀錄在**讀取端**用同一場賽事的
        //   歸檔（TARCHIVE，_id = 'arch_' + eventId）補上，**零資料遷移、不改寫任何既有文件**。
        //   ⚠ 效能：這一發只在真的有缺欄時才發、只吃 _id 索引、projection 只取 3 個小欄位
        //     （不碰 players/matches 這兩個大欄位）；等舊紀錄都補完欄位後，_needIds 為空、
        //     這一發會自動消失。⚠ finishedAt 照舊回傳、欄位一個都沒拿掉。
        const _needIds = [];
        for (const c of cs) if (!c.startedAt && c.eventId) _needIds.push('arch_' + c.eventId);
        const _startByEvent = new Map();
        if (_needIds.length) {
          const _arcs = await TARCHIVE.find({ _id: { $in: _needIds } },
            { projection: { eventId: 1, startedAt: 1, createdAt: 1 } }).toArray();
          for (const a of _arcs) _startByEvent.set(String(a.eventId), a.startedAt || a.createdAt || 0);
        }
        res.json({ champions: cs.map((c) => ({ id: c._id, eventId: c.eventId, eventName: c.eventName, championName: c.championName, deckName: c.deckName || '', playerCount: c.playerCount || 0, startedAt: c.startedAt || _startByEvent.get(String(c.eventId)) || 0, finishedAt: c.finishedAt || 0, communityEvent: !!c.communityEvent })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.61 公開：名人堂點選 → 取該賽事「當初賽程」(從歸檔 TARCHIVE，永久保存)。回每輪 matches + 勝負，前端翻頁顯示。
    app.get('/api/tournament/champion-bracket', async (req, res) => {
      try {
        const eid = String((req.query && req.query.eventId) || '');
        if (!eid) return res.status(400).json({ error: '缺少 eventId' });
        const a = await TARCHIVE.findOne({ _id: 'arch_' + eid });
        if (!a) return res.status(404).json({ error: '找不到該賽事的賽程歸檔' });
        const ms = (a.matches || []).slice().sort((x, y) => (x.round - y.round) || (x.idx - y.idx));
        const rounds = ms.reduce((mx, m) => Math.max(mx, m.round || 1), 1);
        res.json({
          eventName: a.eventName || '錦標賽', championName: a.championName || null,
          playerCount: a.playerCount || 0, finishedAt: a.finishedAt || 0, format: a.format || 'single-elim', rounds,
          matches: ms.map((m) => ({
            round: m.round, idx: m.idx, p1name: m.p1name || null, p2name: m.p2name || null, bye: !!m.bye, status: m.status || 'done',
            winner: (m.winnerUid && m.winnerUid === m.p1uid) ? 'p1' : ((m.winnerUid && m.winnerUid === m.p2uid) ? 'p2' : null),
          })),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // ── v0.66 玩家戰績聚合 helpers ──────────────────────────────────────────
    // 從某場 matches 推導 Top Cut 名次（決賽/4強/8強）。回傳 { finals, top4, top8 }（皆 Set<uid>）。
    function _detectCutPlacements(matches) {
      const out = { finals: new Set(), top4: new Set(), top8: new Set() };
      if (!matches || !matches.length) return out;
      const byRound = new Map(); let maxRound = 0;
      for (const m of matches) { const r = m.round || 1; if (!byRound.has(r)) byRound.set(r, []); byRound.get(r).push(m); if (r > maxRound) maxRound = r; }
      const playersIn = (r) => { const s = new Set(); for (const m of (byRound.get(r) || [])) { if (m.bye) { if (m.p1uid) s.add(m.p1uid); continue; } if (m.p1uid) s.add(m.p1uid); if (m.p2uid) s.add(m.p2uid); } return s; };
      const winnersIn = (r) => { const s = new Set(); for (const m of (byRound.get(r) || [])) if (m.winnerUid) s.add(m.winnerUid); return s; };
      const nonByeCount = (r) => (byRound.get(r) || []).filter((m) => !m.bye).length;
      const subset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };
      if (nonByeCount(maxRound) !== 1) return out;             // 非單一決賽場 → 結構異常，保守不判
      out.finals = playersIn(maxRound);
      const sr = maxRound - 1;
      if (byRound.has(sr) && nonByeCount(sr) <= 2 && subset(out.finals, winnersIn(sr))) {
        out.top4 = playersIn(sr);
        const qr = maxRound - 2;
        if (byRound.has(qr) && nonByeCount(qr) >= 3 && nonByeCount(qr) <= 4 && subset(out.top4, winnersIn(qr))) {
          out.top8 = playersIn(qr);
        }
      }
      return out;
    }
    // ⭐ v6.111：名次推導是**唯一來源**，掛到 app.locals 供「奪冠報告」端點重用。
    //   ⚠ 絕對不要在別處再抄一份 —— 這個函式的保守條件（決賽必須是單一場、四強必須是
    //   決賽兩人的上一輪、八強同理）是刻意寫死的；抄一份出去、哪天只改一邊，
    //   兩處就會對同一場賽事算出不同名次，而且沒有任何錯誤訊息。
    app.locals = app.locals || {};
    app.locals._detectCutPlacements = _detectCutPlacements;

    // ════════════════════════════════════════════════════════════════════
    // v6.138 批次1：牌組公布欄（deckPosts）後端
    //
    // 設計定案見 docs/牌組公布欄-設計定案.md。四項 Wilson 拍板：
    //   ① 名次標示＝冠軍／亞軍／四強（單敗淘汰沒有季軍賽，3 與 4 名本來就分不出）
    //   ② 賽事投稿鎖定「比賽當時那副」（報名時已存進 TREGS.deckEntries → 歸檔 players[]）
    //   ③ 先發後審：即時上架，admin 可下架
    //   ④ 名次投稿只開網站賽（champion-report 的名次推導本來就排除社群賽）
    //
    // ⚠ 整段包在自己的 try/catch 內。這裡是**賽事段閉包內部**（要用 tournIdentity /
    //   TPOOL / TARCHIVE / TEVENTS / _detectCutPlacements），而賽事段的外層 catch 一掛
    //   會連「休閒閒置自動判負」一起停用 —— 所以本段任何 throw 都必須就地吞掉，
    //   絕不能往上冒泡。
    // ════════════════════════════════════════════════════════════════════
    try {
      const DPOSTS = db.collection('deckPosts');
      const DPLIKES = db.collection('deckPostLikes');
      const DPDOWNS = db.collection('deckPostDownloads');
      // v6.182 留言板：留言另存一張表（軟刪），deckPosts 上的 commentCount 只是非正規化快照。
      const DPCOMM = db.collection('deckPostComments');
      // 列表查詢的三種排序都要索引；status 一定在 filter 裡。
      DPOSTS.createIndex({ status: 1, createdAt: -1 }).catch(() => { /* best-effort */ });
      DPOSTS.createIndex({ status: 1, likeCount: -1 }).catch(() => { /* best-effort */ });
      DPOSTS.createIndex({ status: 1, downloadCount: -1 }).catch(() => { /* best-effort */ });
      // ⭐v6.185 「最新留言」排序 —— 沒有這條索引就會整表掃描 + 記憶體排序。
      DPOSTS.createIndex({ status: 1, lastCommentAt: -1 }).catch(() => { /* best-effort */ });

      /**
       * ⭐⭐v6.185 一次性回填 lastCommentAt（啟動時 fire-and-forget，冪等）。
       *
       * ⚠ 為什麼一定要有這個：v6.182 起就有留言了，但那些投稿的 doc **沒有 lastCommentAt**
       *   這個欄位。mongo 的 descending 把「欄位缺席」當 null 排在 0 之後 ⇒
       *   **已經有留言的舊投稿會排在「完全沒有留言」的新投稿後面**，正好是反的。
       *   靠站長手動打 /api/admin/deck-posts/recount 才會好 —— 那是個沒有按鈕的端點，
       *   等於這個功能上線當天就是壞的。所以改成自己補。
       * ⚠ 冪等：補完之後就不再有缺席的 doc ⇒ 下次啟動第一個查詢就回 0 筆、直接結束。
       * ⚠ 全程 best-effort：任何一步失敗只會讓排序退化成「舊投稿排最後」，
       *   絕不能讓整個 deckPosts 區段註冊失敗（那會連公布欄都打不開）。
       */
      async function dpBackfillLastCommentAt() {
        const stale = await DPOSTS.find({ lastCommentAt: { $exists: false } }, { projection: { _id: 1 } }).limit(5000).toArray();
        if (!stale.length) return 0;
        const rows = await DPCOMM.aggregate([
          { $match: { status: { $ne: 'deleted' } } },
          { $group: { _id: '$postId', last: { $max: '$createdAt' } } },
        ]).toArray();
        const lm = new Map(rows.map((x) => [x._id, x.last || 0]));
        let n = 0;
        for (const p of stale) {
          await DPOSTS.updateOne({ _id: p._id }, { $set: { lastCommentAt: lm.get(p._id) || 0 } });
          n++;
        }
        _dpListCache.clear();
        return n;
      }
      Promise.resolve().then(dpBackfillLastCommentAt).then((n) => {
        if (n) console.log('[deck-posts] lastCommentAt 回填完成：' + n + ' 筆（v6.185 一次性，之後不再執行）');
      }).catch((e) => console.warn('[deck-posts] lastCommentAt 回填失敗（可改用 admin 的 recount 端點）:', e && e.message));
      DPOSTS.createIndex({ uid: 1 }).catch(() => { /* best-effort */ });
      DPOSTS.createIndex({ 'tournament.eventId': 1, uid: 1 }).catch(() => { /* best-effort */ });
      DPLIKES.createIndex({ postId: 1 }).catch(() => { /* best-effort */ });
      DPDOWNS.createIndex({ postId: 1 }).catch(() => { /* best-effort */ });
      // 留言列表恆為「某一篇 × 未刪除 × 依時間」⇒ 這支複合索引就是全部查詢的形狀。
      DPCOMM.createIndex({ postId: 1, status: 1, createdAt: -1 }).catch(() => { /* best-effort */ });
      DPCOMM.createIndex({ uid: 1, createdAt: -1 }).catch(() => { /* best-effort */ });

      const DP_MAX_NOTES = 200;
      const DP_MAX_NAME = 40;
      const DP_TOURN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;   // 賽後 30 天內可投稿
      const DP_PER_DAY = 3;          // 每人每日投稿上限
      const DP_ALIVE_CAP = 10;       // 每人未刪投稿總量上限
      const DP_POST_COOLDOWN = 60 * 1000;
      const DP_LIST_TTL = 30 * 1000;
      // v6.182 留言板。⚠ 這三個值是 Wilson 可調的政策參數，改動請一併更新前端的 COMMENT_MAX。
      const DP_CMT_MAX = 300;        // 單則留言字數上限（trim 後計算）
      const DP_CMT_PAGE = 50;        // 一次回幾則（預設值；上限 100）
      const DP_CMT_PER_MIN = 10;     // 每人每分鐘可送出的留言數
      const DP_CMT_RESERVED_NAME = '系統管理員';   // 只有 admin 的留言可以掛這個名字
      const DP_PLACEMENT = { CHAMPION: '冠軍', FINALS: '亞軍', TOP4: '四強' };

      // ── 限流：記憶體滑動窗（比照 rateLimitExport / mrRateLimitCheck 的既有慣例，本檔無 Redis）──
      const _dpBuckets = new Map();   // key -> [timestamps]
      function dpRate(key, windowMs, max) {
        const now = Date.now();
        const arr = (_dpBuckets.get(key) || []).filter((t) => now - t < windowMs);
        if (arr.length >= max) { _dpBuckets.set(key, arr); return false; }
        arr.push(now); _dpBuckets.set(key, arr);
        // ⚠ 淘汰要**先刪已過期的**。舊寫法按插入序砍 1000 個 key，被大量假 key 灌爆時
        //   會把別人（和自己）還在生效的投稿冷卻一起刪掉 —— 限流反而被沖掉。
        if (_dpBuckets.size > 5000) {
          for (const [k, v] of _dpBuckets) if (!v.length || now - v[v.length - 1] > 3600000) _dpBuckets.delete(k);
          if (_dpBuckets.size > 5000) { for (const k of _dpBuckets.keys()) { _dpBuckets.delete(k); if (_dpBuckets.size <= 4000) break; } }
        }
        return true;
      }
      // ⚠ 正式站走 cloudflared tunnel，origin 看到的 req.ip 是 localhost。
      //   但 x-forwarded-for 的**第一段是 client 可以任意填的**（Cloudflare 是 append 到尾端），
      //   拿它當限流 key ⇒ 每個請求換一個假 IP 就完全穿透。CF-Connecting-IP 由 Cloudflare
      //   覆寫、外部偽造不了，優先用它。（Fable 5 review 指出）
      /**
       * 退回一次 dpRate 的額度。
       * ⚠ 投稿冷卻在**任何驗證之前**就被消耗，所以「挑錯牌組被退回」也會吃掉 60 秒
       *   —— 玩家換一副合法的立刻撞 429，看起來像系統在刁難他（Fable 5 review 指出）。
       *   純粹是使用者輸入不合法時才退，濫用者送出的請求仍然照算。
       */
      function dpRateRefund(key) {
        const arr = _dpBuckets.get(key);
        if (arr && arr.length) arr.pop();
      }
      function dpIp(req) {
        const h = req.headers || {};
        const cf = h['cf-connecting-ip'];
        if (cf) return String(cf).trim();
        return String(h['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
      }

      // ── 身分：投稿／按讚／計數一律要 verified（tournIdentity 對沒帶 token 的請求會回
      //    verified:false 的 playerId 身分，那種身分可以隨便捏造 uid ⇒ 不能拿來當唯一鍵）──
      async function dpIdentity(req) {
        const id = await tournIdentity(req);
        if (!id || id.error) return { error: (id && id.error) || '需要登入', code: (id && id.code) || 401 };
        if (!id.verified) return { error: '請用 email 帳號登入後再操作', code: 403 };
        return id;
      }
      // 只讀身分：拿不到就回 null，不當錯誤（公開讀允許未登入）
      async function dpIdentitySoft(req) {
        try { const id = await tournIdentity(req); return (id && !id.error && id.verified) ? id : null; }
        catch (_e) { return null; }
      }

      // ── entries 正規化：只留 {cardId, count}，丟掉 role 等前端欄位 ──
      function dpNormalizeEntries(raw) {
        if (!Array.isArray(raw) || raw.length === 0 || raw.length > 120) return null;
        const merged = new Map();
        for (const e of raw) {
          if (!e || typeof e !== 'object') return null;
          const cid = String(e.cardId == null ? '' : e.cardId);
          const n = Number(e.count);
          if (!/^[0-9]+$/.test(cid)) return null;
          if (!Number.isInteger(n) || n < 1 || n > 60) return null;
          merged.set(cid, (merged.get(cid) || 0) + n);
        }
        const out = [...merged.entries()].map(([cardId, count]) => ({ cardId, count }));
        out.sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
        return out;
      }

      // ── 牌組合法性：走引擎 bundle 匯出的**同一支** validateDeck（src/lib/decks/validation.ts）──
      //   ⚠ 絕不在這裡抄一份規則。同名 4 張／重印例外／ACE SPEC 1 張／兩張合一偶數
      //      這些規則只要有第二份實作就一定漂移（v0.88／v0.93 的 classifyDeck 是同一個教訓）。
      //   ⚠ fail-open：舊版 server-engine.cjs 還沒 export validateDeck（要跑
      //      update-tournament.bat 重建）。此時只做結構檢查就放行 —— 投稿一副不合法的牌組
      //      後果是內容品質，不是安全漏洞；讓功能在舊 bundle 上直接 500 才是真的糟。
      function dpValidateDeck(entries, deckName) {
        const total = entries.reduce((n, e) => n + e.count, 0);
        if (total !== 60) return '牌組必須剛好 60 張（目前 ' + total + ' 張）';
        for (const e of entries) if (!TPOOL.get(e.cardId)) return '牌組含有本站沒有的卡片（id ' + e.cardId + '）';
        if (typeof TENG.validateDeck !== 'function') return null;   // 舊 bundle：只做結構檢查
        try {
          const r = TENG.validateDeck({ id: 'dp', name: deckName || '牌組', entries, createdAt: 0, updatedAt: 0 }, TPOOL);
          // ⚠ 欄位名是 legal（不是 valid）—— 寫錯會恆為 undefined ⇒ 驗證整條靜默失效
          if (r && r.legal === false && Array.isArray(r.issues) && r.issues.length) return r.issues[0];
        } catch (_e) { /* 驗證器本身出錯不擋投稿 */ }
        return null;
      }

      // ── 內容 hash：同一人重複投稿同一副牌時去重。不用 crypto（v0.75：ESM host 沒有 require）──
      function dpHash(entries) {
        const s = entries.map((e) => e.cardId + 'x' + e.count).join(',');
        let h1 = 0x811c9dc5, h2 = 0x01000193;
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          h1 = ((h1 ^ c) * 16777619) >>> 0;
          h2 = ((h2 + c) * 2654435761) >>> 0;
        }
        return h1.toString(36) + h2.toString(36) + '_' + s.length;
      }

      // ── 序列化白名單：uid / email 絕不出現在任何公開回應 ──
      //   （比照 /api/rooms-archetypes 與 champion-report 的既有作法：逐欄挑，不 spread 整份 doc）
      function dpPublic(doc, extra) {
        const o = {
          id: doc._id,
          authorName: doc.authorName || '玩家',
          deckName: doc.deckName || '牌組',
          notes: doc.notes || '',
          archetype: doc.archetype || '',
          cardTotal: doc.cardTotal || 0,
          likeCount: doc.likeCount || 0,
          downloadCount: doc.downloadCount || 0,
          // ⚠ 留言數走 deckPosts 上的非正規化欄位，**列表頁絕不可以為了它去查 deckPostComments**
          //   —— 那就是每頁 20 次的 N+1（v6.119 讀放大的同一個教訓）。
          //   夾在 0 以下是防守性的：真正的權威是明細表，admin 的 recount 端點負責修正漂移。
          commentCount: Math.max(0, doc.commentCount || 0),
          // ⭐v6.185 最近一則留言時間（0 = 從來沒有留言）。「最新留言」排序就是照它排。
          lastCommentAt: Math.max(0, doc.lastCommentAt || 0),
          createdAt: doc.createdAt || 0,
          tournament: doc.tournament
            ? { eventId: doc.tournament.eventId, eventName: doc.tournament.eventName, finishedAt: doc.tournament.finishedAt || 0, placementLabel: doc.tournament.placementLabel }
            : null,
        };
        if (extra) for (const k of Object.keys(extra)) o[k] = extra[k];
        return o;
      }

      // ── 原型分類：重用 admin 段的 classifyDeck（跨 IIFE helper 一律在**執行時**才從
      //    app.locals 取，不可在註冊時解構 —— v0.94／v1.01 兩次事故都是這樣炸的）──
      async function dpClassify(entries) {
        try {
          const H = (app.locals || {})._deckRuleHelpers;
          if (!H || typeof H.classifyDeck !== 'function' || typeof H.deckToSets !== 'function') return '';
          const rules = await db.collection('deckRules').find({ enabled: { $ne: false } }).toArray();
          if (!rules.length) return '';
          if (typeof H.getCardNameMap !== 'function') return '';
          const nameMap = await H.getCardNameMap();
          // ⚠ 簽名是 deckToSets(cardCounts, nameMap)，且回傳是 { rule, all } —— 不是 { name }。
          //    這兩個介面我一開始都寫錯，查了實作才對上（別憑印象接中央 helper）。
          const sets = H.deckToSets(entries, nameMap);
          const hit = H.classifyDeck(sets, rules);
          return (hit && hit.rule && hit.rule.name) ? String(hit.rule.name) : '';
        } catch (_e) { return ''; }
      }

      // ── v6.218 關鍵字搜尋 ─────────────────────────────────────────────
      //   語意（站長拍板三條）：①同一個輸入框自動判斷 ②部分比對（「路卡利歐」要中
      //   「超級路卡利歐ex」）③空白分隔多條件一律 AND。單 token 命中（OR）＝
      //   牌組名∨作者∨簡介∨原型名 含該字，∨ 牌組裡有卡名含該字的卡，∨ 該篇留言含該字。
      //   ⚠ 搜尋必須是伺服器端的、涵蓋全部投稿 —— 公布欄分頁載入，前端只篩得到當頁。
      //   ⚠ 卡名→cardId 解析放伺服器端：TPOOL 就是完整卡池（含官方 name）。
      let _dpCardNamePairs = null;   // [{ id, n }]，n=小寫卡名；卡池行程內不變 ⇒ 建一次
      function dpCardNamePairs() {
        if (!_dpCardNamePairs) {
          _dpCardNamePairs = [];
          for (const [cid, c] of TPOOL) {
            if (c && c.name) _dpCardNamePairs.push({ id: String(cid), n: String(c.name).toLowerCase() });
          }
        }
        return _dpCardNamePairs;
      }
      /** 輸入字串 → token 陣列：空白（含全形 \u3000）分隔、小寫、去重、每個截 30 字、最多 5 個。 */
      function dpSearchTokens(raw) {
        const s = String(raw == null ? '' : raw).slice(0, 80);
        const out = [];
        for (const t of s.split(/[\s\u3000]+/)) {
          const tok = t.trim().toLowerCase().slice(0, 30);
          if (tok && !out.includes(tok)) out.push(tok);
          if (out.length >= 5) break;
        }
        return out;
      }
      /** regex 特殊字元逐字轉義 —— 玩家輸入「+」「(」不可以變成語法錯誤或萬用比對。 */
      function dpSearchEscape(tok) { return String(tok).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      /** 卡名含 token（部分比對、不分大小寫）的所有 cardId。 */
      function dpCardIdsForToken(tok, pairs) {
        const ids = [];
        for (const p of pairs) if (p.n.includes(tok)) ids.push(p.id);
        return ids;
      }
      /**
       * 單一 token 的 $or 條件（純函式，守衛直接抽出來跑行為）。
       * ⚠ $regex 一律用**字串形式**：RegExp 物件經 JSON.stringify 會變 {}，
       *   拿去組快取鍵時不同搜尋會撞成同一份快取。
       */
      function dpTokenOr(tok, cardIds, commentPostIds) {
        const re = { $regex: dpSearchEscape(tok), $options: 'i' };
        return {
          $or: [
            { deckName: re },
            { authorName: re },
            { notes: re },
            { archetype: re },
            { 'entries.cardId': { $in: cardIds || [] } },
            { _id: { $in: commentPostIds || [] } },
          ],
        };
      }

      // ════════ 公開讀 ════════
      const _dpListCache = new Map();   // key -> { at, payload }
      app.get('/api/deck-posts', async (req, res) => {
        try {
          // ⚠ 正式站走 Cloudflare tunnel，公開 GET 曾被快取住（index.json 被快取 4 天）。
          res.set('Cache-Control', 'no-store');
          // ⭐v6.185 新增 comments =「最新留言」：lastCommentAt 由新增/刪除留言時維護的
          //   非正規化欄位（**絕不 N+1 去查 deckPostComments**，那是 v6.119 的讀放大教訓）。
          //   ⚠ 沒有任何留言的投稿 lastCommentAt = 0 ⇒ 一律排在所有「有留言」的投稿之後，
          //     彼此再依 createdAt 由新到舊 ⇒ 名次完全確定，不會每次重整就亂跳。
          const sort = ({
            new: { createdAt: -1 },
            likes: { likeCount: -1, createdAt: -1 },
            downloads: { downloadCount: -1, createdAt: -1 },
            comments: { lastCommentAt: -1, createdAt: -1 },
          })[String((req.query && req.query.sort) || 'new')] || { createdAt: -1 };
          const page = Math.max(1, Math.min(200, parseInt((req.query && req.query.page) || '1', 10) || 1));
          const pageSize = Math.max(1, Math.min(50, parseInt((req.query && req.query.pageSize) || '20', 10) || 20));
          const q = { status: 'published' };
          const arche = String((req.query && req.query.archetype) || '').slice(0, 60);
          if (arche) q.archetype = arche;
          if (String((req.query && req.query.tournamentOnly) || '') === '1') q.tournament = { $ne: null };
          // v6.218 關鍵字搜尋：q 缺席時 qTokens=[] ⇒ 整段搜尋邏輯不執行，查詢物件與舊版完全相同。
          const qTokens = dpSearchTokens((req.query && req.query.q) || '');
          if (qTokens.length && !dpRate('s:' + dpIp(req), 60000, 60)) return res.status(429).json({ error: '搜尋太頻繁，請稍候再試' });
          // ⚠ 快取鍵不可放 q 物件本身：$and 裡若混進 RegExp，JSON.stringify 會把它變 {}，
          //   不同搜尋就撞成同一份快取。改放 token 原文（$regex 也一律用字串形式，雙保險）。
          const ck = JSON.stringify([sort, page, pageSize, arche, q.tournament ? 1 : 0, qTokens]);
          const hit = _dpListCache.get(ck);
          if (hit && Date.now() - hit.at < DP_LIST_TTL) return res.json(hit.payload);
          if (qTokens.length) {
            // 留言命中：先查留言表拿 postId 集合，再併進主查詢 —— 一次 distinct，
            //   不是每篇一查的 N+1（v6.119 讀放大教訓）。deckPostComments 目前只有幾十則、
            //   沒有 text 索引 ⇒ 這是小集合掃描；搜尋是玩家主動觸發＋60/min 限流＋30 秒
            //   列表快取，付得起。若量級成長到數萬再考慮 searchBlob／索引，現在做是過度工程。
            const pairs = dpCardNamePairs();
            q.$and = await Promise.all(qTokens.map(async (tok) => {
              let cIds = [];
              try {
                cIds = await DPCOMM.distinct('postId', { status: { $ne: 'deleted' }, text: { $regex: dpSearchEscape(tok), $options: 'i' } });
              } catch (_se) { /* 留言查詢失敗只是「留言命中」這一路少了，其餘 OR 分支照常 */ }
              return dpTokenOr(tok, dpCardIdsForToken(tok, pairs), cIds);
            }));
          }
          // ⚠ 列表**不回 entries**：每筆 60 張 × 每頁 20 筆是純浪費（v6.119 的讀放大教訓）。
          const [docs, total] = await Promise.all([
            DPOSTS.find(q, { projection: { entries: 0, uid: 0, email: 0, entriesHash: 0 } }).sort(sort).skip((page - 1) * pageSize).limit(pageSize).toArray(),
            DPOSTS.countDocuments(q),
          ]);
          // ⚠ q 欄位是**哨兵**：舊伺服器的回應沒有它，前端據此分辨「伺服器還不支援搜尋」。
          const payload = { posts: docs.map((d) => dpPublic(d)), total, page, pageSize, q: qTokens.join(' ') };
          _dpListCache.set(ck, { at: Date.now(), payload });
          if (_dpListCache.size > 200) _dpListCache.clear();
          res.json(payload);
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      app.get('/api/deck-posts/:id', async (req, res) => {
        try {
          res.set('Cache-Control', 'no-store');
          if (!dpRate('d:' + dpIp(req), 60000, 60)) return res.status(429).json({ error: '請求過於頻繁' });
          const doc = await DPOSTS.findOne({ _id: String(req.params.id), status: 'published' });
          if (!doc) return res.status(404).json({ error: '找不到這篇投稿' });
          const id = await dpIdentitySoft(req);
          const extra = { entries: (doc.entries || []).map((e) => ({ cardId: e.cardId, count: e.count })) };
          if (id) {
            const [lk, dn] = await Promise.all([
              DPLIKES.findOne({ _id: doc._id + '__' + id.uid }, { projection: { _id: 1 } }),
              DPDOWNS.findOne({ _id: doc._id + '__' + id.uid }, { projection: { _id: 1 } }),
            ]);
            extra.likedByMe = !!lk; extra.downloadedByMe = !!dn; extra.mine = (doc.uid === id.uid);
          }
          res.json({ post: dpPublic(doc, extra) });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // ════════ 投稿（一般）════════
      async function dpInsert(id, { deckName, entries, notes, tournament, authorName }) {
        const norm = dpNormalizeEntries(entries);
        if (!norm) return { error: '牌組資料格式不正確', code: 400 };
        // ⚠ 賽事名次投稿的牌組來自**伺服器歸檔**，不是 client 送的。而報名端點當初只驗
        //   「60 張」（沒跑 validateDeck），所以歸檔那副在今天的標準下可能已經不合法
        //   （卡片輪替、或報名時就沒驗）。若在這裡擋下來，玩家會拿著真名次卻永遠投不出去，
        //   而設計上又規定必須用那副 —— 等於把合法使用者關在門外。
        //   ⇒ 賽事路徑只做結構檢查，合法性不擋（Fable 5 review 指出，我查證報名端點
        //     3568／3596 行確實只有 deckCount !== 60）。
        const bad = tournament ? null : dpValidateDeck(norm, deckName);
        if (bad) return { error: bad, code: 400 };
        const hash = dpHash(norm);
        // ⚠ 去重要帶 eventId 維度：同一副 60 張連兩場拿名次是常態，兩篇投稿的內容一樣但
        //   代表不同賽事。只比 hash 會讓第二場永遠 409，而 eligibility 又顯示「可投稿」。
        const dupQ = { uid: id.uid, entriesHash: hash, status: { $ne: 'deleted' } };
        dupQ['tournament.eventId'] = tournament ? tournament.eventId : null;
        const dup = await DPOSTS.findOne(dupQ, { projection: { _id: 1 } });
        if (dup) return { error: '你已經投稿過同樣內容的牌組了', code: 409 };
        const now = Date.now();
        const [dayCount, aliveCount] = await Promise.all([
          DPOSTS.countDocuments({ uid: id.uid, createdAt: { $gt: now - 86400000 } }),
          DPOSTS.countDocuments({ uid: id.uid, status: { $ne: 'deleted' } }),
        ]);
        if (dayCount >= DP_PER_DAY) return { error: '今天的投稿次數已達上限（每日 ' + DP_PER_DAY + ' 篇）', code: 429 };
        if (aliveCount >= DP_ALIVE_CAP) return { error: '你的投稿數已達上限（' + DP_ALIVE_CAP + ' 篇），請先刪除舊的', code: 429 };
        const doc = {
          _id: 'dp_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 10),
          status: 'published',
          uid: id.uid,
          email: id.email || null,
          // ⚠ 賽事投稿要用「**報名這場賽事時填的暱稱**」（歸檔的 players[].name），
          //   不是帳號當下的顯示名 —— 玩家改過帳號暱稱時，公布欄上的名字才會跟賽程表對得起來。
          //   一般投稿由呼叫端帶「最近一次報名的暱稱」；都沒有才退回 id.name
          //   （⚠ 那可能是 email 前綴，是最後手段而不是預設值）。
          authorName: String(authorName || id.name || '玩家').slice(0, 24),
          deckName: String(deckName || '牌組').slice(0, DP_MAX_NAME),
          notes: String(notes || '').slice(0, DP_MAX_NOTES),
          entries: norm,
          entriesHash: hash,
          archetype: await dpClassify(norm),
          cardTotal: norm.reduce((n, e) => n + e.count, 0),
          tournament: tournament || null,
          // 記錄這篇進來時完整驗證有沒有開（舊 bundle 期間為 false）→ 事後可回溯補驗／清理
          validated: typeof TENG.validateDeck === 'function',
          likeCount: 0,
          downloadCount: 0,
          commentCount: 0,
          // ⭐v6.185 **一定要寫 0 而不是留空**：mongo 的 descending 排序把「欄位缺席」
          //   當成 null 排在 0 之後 ⇒ 新舊投稿會分裂成兩群，無留言者的相對名次就不穩定。
          lastCommentAt: 0,
          createdAt: now,
          updatedAt: now,
        };
        await DPOSTS.insertOne(doc);
        _dpListCache.clear();
        return { doc };
      }

      app.post('/api/deck-posts', async (req, res) => {
        try {
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('p:' + id.uid, DP_POST_COOLDOWN, 1)) return res.status(429).json({ error: '投稿太頻繁，請稍候再試' });
          const b = req.body || {};
          if (JSON.stringify(b).length > 32768) return res.status(413).json({ error: '資料過大' });
          // v6.144：一般投稿的顯示名預設用「最近一次報名的暱稱」。
          //   ⚠ 不能直接用 id.name —— token 沒 displayName 時它是 email 前綴（玩家回報的就是這個）。
          const _defaultNick = await getLastRegisteredNick(id.uid);
          const r = await dpInsert(id, {
            deckName: b.deckName, entries: b.entries, notes: b.notes, tournament: null,
            authorName: _defaultNick || undefined,
          });
          if (r.error) {
            // 400 = 內容不合格（牌組不合法／格式錯）⇒ 不該扣冷卻，否則玩家換一副就撞 429。
            // 409/429 是「你已經投過了／太頻繁」⇒ 照扣。
            if (r.code === 400) dpRateRefund('p:' + id.uid);
            return res.status(r.code).json({ error: r.error });
          }
          res.json({ ok: true, id: r.doc._id });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // ── 刪除：本人軟刪（明細表保留，計數可對帳）──
      app.delete('/api/deck-posts/:id', async (req, res) => {
        try {
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('x:' + id.uid, 60000, 10)) return res.status(429).json({ error: '操作過於頻繁' });
          const r = await DPOSTS.updateOne({ _id: String(req.params.id), uid: id.uid, status: { $ne: 'deleted' } }, { $set: { status: 'deleted', updatedAt: Date.now() } });
          if (!r.matchedCount) return res.status(404).json({ error: '找不到你的這篇投稿' });
          _dpListCache.clear();
          res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // ════════ 按讚／收藏計數 ════════
      //   ⚠ 唯一鍵 postId__uid：insert 撞 DuplicateKey 就代表按過了。
      //     每帳號每篇恆為 0 或 1，client 重放幾次都一樣 —— 這是不靠 client 誠實的關鍵。
      async function dpToggle(coll, field, postId, uid, on) {
        const key = postId + '__' + uid;
        if (on) {
          try { await coll.insertOne({ _id: key, postId, uid, at: Date.now() }); }
          catch (e) { if (e && e.code === 11000) return false; throw e; }
          await DPOSTS.updateOne({ _id: postId }, { $inc: { [field]: 1 } });
          return true;
        }
        const r = await coll.deleteOne({ _id: key });
        if (!r.deletedCount) return false;
        await DPOSTS.updateOne({ _id: postId }, { $inc: { [field]: -1 } });
        return true;
      }

      async function dpLikeHandler(req, res, on) {
        try {
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('l:' + id.uid, 60000, 30)) return res.status(429).json({ error: '操作過於頻繁' });
          const postId = String(req.params.id);
          const doc = await DPOSTS.findOne({ _id: postId, status: 'published' }, { projection: { _id: 1 } });
          if (!doc) return res.status(404).json({ error: '找不到這篇投稿' });
          const changed = await dpToggle(DPLIKES, 'likeCount', postId, id.uid, on);
          if (changed) _dpListCache.clear();
          const cur = await DPOSTS.findOne({ _id: postId }, { projection: { likeCount: 1 } });
          res.json({ ok: true, changed, likeCount: (cur && cur.likeCount) || 0, likedByMe: on });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      }
      app.post('/api/deck-posts/:id/like', (req, res) => dpLikeHandler(req, res, true));
      app.delete('/api/deck-posts/:id/like', (req, res) => dpLikeHandler(req, res, false));

      // 下載計數：語意是「多少個**不同帳號**拿過」，不是「按了幾次」。
      //   未登入者照樣可以匯入，只是不計數（回 204）。
      app.post('/api/deck-posts/:id/download', async (req, res) => {
        try {
          const id = await dpIdentitySoft(req);
          if (!id) return res.status(204).end();
          if (!dpRate('n:' + id.uid, 60000, 30)) return res.status(204).end();
          const postId = String(req.params.id);
          const doc = await DPOSTS.findOne({ _id: postId, status: 'published' }, { projection: { _id: 1 } });
          if (!doc) return res.status(404).json({ error: '找不到這篇投稿' });
          const changed = await dpToggle(DPDOWNS, 'downloadCount', postId, id.uid, true);
          if (changed) _dpListCache.clear();
          const cur = await DPOSTS.findOne({ _id: postId }, { projection: { downloadCount: 1 } });
          res.json({ ok: true, changed, downloadCount: (cur && cur.downloadCount) || 0 });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // ── 編輯投稿的顯示名稱與說明 ─────────────────────────────────────
      //   Wilson 指定：投稿後仍可隨時改「顯示的玩家名稱」與「說明內容」。
      //   ⚠ **`entries` 與 `deckName` 永遠不可改**：換皮繼承讚的風險在**牌組內容**
      //     —— 拿一篇高讚投稿把 60 張換掉，讚數就白白繼承了。這是當初把投稿設計成
      //     immutable 的唯一理由。顯示名稱與說明文字不影響「這是哪一副牌」，可以開放；
      //     內容不當則有 admin 下架機制（先發後審）兜底。
      //   ⚠ 路徑維持 /:id/rename（兩段，不會被 `/:id` 單段 pattern 吃掉）。雖然現在管兩個
      //     欄位、名字略窄，但路徑是已上線的 API，改名的破壞性大於命名精確性。
      app.post('/api/deck-posts/:id/rename', async (req, res) => {
        try {
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('r:' + id.uid, 60000, 10)) return res.status(429).json({ error: '操作過於頻繁' });
          const b = req.body || {};
          const $set = { updatedAt: Date.now() };
          // 兩個欄位都是「有送才改」：只想改說明的人不必連名字一起送。
          if (b.authorName !== undefined) {
            const nm = String(b.authorName || '').trim().slice(0, 24);
            if (!nm) return res.status(400).json({ error: '名稱不能空白' });
            $set.authorName = nm;
          }
          if (b.notes !== undefined) $set.notes = String(b.notes || '').slice(0, DP_MAX_NOTES);
          if ($set.authorName === undefined && $set.notes === undefined) {
            return res.status(400).json({ error: '沒有要修改的內容' });
          }
          const r = await DPOSTS.updateOne(
            { _id: String(req.params.id), uid: id.uid, status: { $ne: 'deleted' } },
            { $set },
          );
          if (!r.matchedCount) return res.status(404).json({ error: '找不到你的這篇投稿' });
          _dpListCache.clear();
          res.json({ ok: true, authorName: $set.authorName, notes: $set.notes });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // ════════ 留言板（v6.182）════════
      //
      // ⚠⚠⚠ 路徑用**獨立前綴** `/api/deck-posts-comments`，絕不寫成 `/api/deck-posts/comments`。
      //   Express 依註冊順序比對，上面的 `/api/deck-posts/:id` 是**單段** pattern，會把任何
      //   同段數的 `/api/deck-posts/具名字串` 整個吃掉，而且回的是 404「找不到這篇投稿」
      //   —— v6.138 的 tournament-eligibility 就是這樣 100% 打不到的。這裡沿用當時定下的
      //   解法（`/api/deck-posts-mine`、`/api/deck-posts-tournament/*` 同一套）：換前綴，
      //   讓遮蔽在**結構上不可能發生**，而不是靠「記得註冊順序」。
      //   守衛 scripts/test-v6182-deck-post-comments.mjs 會把全檔的註冊路徑照順序抓出來，
      //   用行為端的 router 模擬真的跑一次比對（不是驗字串），而且模擬器本身先用一組
      //   「已知會被遮蔽」的合成路由表自我驗證過。

      /**
       * 留言內容正規化（**純函式**，守衛直接跑真值）。回 `{ text }` 或 `{ error }`。
       * ⚠ 先把 \r\n 收斂成 \n 再 trim —— 否則「只按了幾個換行」會被當成有內容送出去。
       */
      function dpCommentNormalize(raw) {
        const t = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').trim();
        if (!t) return { error: '留言不能空白' };
        if (t.length > DP_CMT_MAX) return { error: '留言最多 ' + DP_CMT_MAX + ' 字（目前 ' + t.length + ' 字）' };
        return { text: t };
      }

      /**
       * 公開序列化：與 dpPublic 同一個原則 —— **uid / email 絕不出現在任何公開回應**。
       * `mine` 由伺服器比對後只回布林值，前端拿不到別人的 uid。
       */
      function dpCommentPublic(doc, viewerUid) {
        return {
          id: doc._id,
          postId: doc.postId,
          authorName: doc.authorName || '玩家',
          text: doc.text || '',
          createdAt: doc.createdAt || 0,
          admin: !!doc.admin,
          mine: !!(viewerUid && doc.uid === viewerUid),
        };
      }

      /** 列出某一篇投稿的留言。公開讀（未登入也看得到），只是拿不到 mine/isAdmin。 */
      async function dpCommentList(req, res) {
        try {
          res.set('Cache-Control', 'no-store');
          const postId = String((req.query && req.query.postId) || '');
          if (!postId) return res.status(400).json({ error: '缺少 postId' });
          if (!dpRate('cl:' + dpIp(req), 60000, 120)) return res.status(429).json({ error: '請求過於頻繁' });
          // 只有 published 的投稿才看得到留言：被站長下架或作者刪掉的投稿，留言也要跟著消失。
          const post = await DPOSTS.findOne({ _id: postId, status: 'published' }, { projection: { _id: 1, commentCount: 1 } });
          if (!post) return res.status(404).json({ error: '找不到這篇投稿' });
          const before = Number((req.query && req.query.before) || 0) || 0;
          const limit = Math.max(1, Math.min(100, parseInt((req.query && req.query.limit) || String(DP_CMT_PAGE), 10) || DP_CMT_PAGE));
          const q = { postId, status: { $ne: 'deleted' } };
          if (before > 0) q.createdAt = { $lt: before };
          // 降序撈最新一頁再反轉成升序顯示（比照大廳聊天 /api/tournament/chat 的既有作法：
          //   初次載入要看到**最新**的留言，不是最舊的）。
          const docs = (await DPCOMM.find(q, { projection: { email: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray()).reverse();
          const hasMore = docs.length
            ? (await DPCOMM.countDocuments({ postId, status: { $ne: 'deleted' }, createdAt: { $lt: docs[0].createdAt } })) > 0
            : false;
          const viewer = await dpIdentitySoft(req);
          res.json({
            comments: docs.map((d) => dpCommentPublic(d, viewer && viewer.uid)),
            hasMore,
            total: Math.max(0, post.commentCount || 0),
            // 站長要能刪掉任何一則留言（先發後審的公開版面必須有管理手段）。
            //   ⚠ 這只是**畫不畫按鈕**的提示；真正的授權在 dpCommentDelete 裡，不靠 client。
            isAdmin: !!(viewer && isTournAdmin(viewer)),
          });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      }

      /**
       * 新增留言。**只有登入（且 verified）的玩家可以留言**。
       *
       * ⚠ 三段的順序是刻意的（v6.140 的教訓：限流在驗證之前就被消耗，玩家把內容改好之後
       *   立刻撞 429，看起來像系統在刁難他）：
       *     ① 身分 → ② **純同步、不碰 DB 的內容驗證** → ③ 通過了才消耗限流額度。
       *   ⚠ **但 404 不退額度**。第一版寫成「404 也 dpRateRefund」，被 Fable 5 review 指出
       *     那讓淨消耗變成 0 —— 一個登入帳號拿不存在的 postId 跑迴圈，每發都吃一次
       *     verifyIdToken ＋ 一次 findOne，限流卻永遠不會觸發。v6.140 要救的是
       *     「內容不合格 → 改好再送」那種情境（400），而 400 在 ② 就擋掉、本來就沒消耗；
       *     404 不是那種情境（投稿真的不存在／已下架），吃掉 1/10 格完全可以接受。
       */
      async function dpCommentCreate(req, res) {
        try {
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          const b = req.body || {};
          if (JSON.stringify(b).length > 8192) return res.status(413).json({ error: '資料過大' });
          const postId = String(b.postId || '');
          if (!postId) return res.status(400).json({ error: '缺少 postId' });
          const norm = dpCommentNormalize(b.text);
          if (norm.error) return res.status(400).json({ error: norm.error });
          if (!dpRate('c:' + id.uid, 60000, DP_CMT_PER_MIN)) return res.status(429).json({ error: '留言太頻繁，請稍候再試' });
          const post = await DPOSTS.findOne({ _id: postId, status: 'published' }, { projection: { _id: 1 } });
          if (!post) return res.status(404).json({ error: '找不到這篇投稿' });
          const isAdm = isTournAdmin(id);
          // 顯示名沿用 v6.144 定下的規則：最近一次報名賽事時填的暱稱 > 帳號暱稱。
          //   ⚠ 不能直接用 id.name —— token 沒 displayName 時它是 email 前綴。
          const nick = isAdm ? null : await getLastRegisteredNick(id.uid);
          // ⚠ authorName 來自玩家自己填的報名暱稱 ⇒ 有人可以取名叫「系統管理員」，
          //   留言就會頂著跟站長一模一樣的名字出現（只差一個紅色樣式，玩家分不出來）。
          //   （Fable 5 review 指出；大廳聊天 v0.31 有同一個缺口，那邊另案處理。）
          let nm = String(nick || id.name || '玩家').slice(0, 24);
          if (!isAdm && nm.replace(/[\s\u3000]/g, '') === DP_CMT_RESERVED_NAME) nm = '玩家';
          const now = Date.now();
          const doc = {
            _id: 'dc_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 10),
            postId,
            uid: id.uid,
            email: id.email || null,
            authorName: isAdm ? DP_CMT_RESERVED_NAME : nm,
            admin: isAdm || false,
            text: norm.text,
            status: 'published',
            createdAt: now,
          };
          await DPCOMM.insertOne(doc);
          // ⚠ 計數只在**真的寫進去之後**才 +1，而且與 dpCommentDelete 的 -1 嚴格配對
          //   （只有 published → deleted 這個轉換才減）⇒ 連點刪除不會把它扣成負的。
          //   權威永遠是 deckPostComments；/api/admin/deck-posts/recount 用明細重算修正漂移。
          // ⚠⚠ 這一段**必須自己吞掉錯誤**。留言已經寫進去了，這裡再 throw 會讓外層回 500，
          //   玩家看到「失敗」就再送一次 ⇒ 同一則留言變兩則。計數只是快照，壞了 recount 修得回來；
          //   「已經成功卻回報失敗」修不回來（Fable 5 review 指出）。
          //   ⭐v6.185 lastCommentAt 用 **$max** 不是 $set —— 兩則留言幾乎同時寫入時
          //     $set 會讓「後寫入但時間較早」那一發把較新的值蓋回去（時間戳倒退）；
          //     $max 天生單調，永遠只會前進。
          try {
            await DPOSTS.updateOne({ _id: postId }, { $inc: { commentCount: 1 }, $max: { lastCommentAt: now } });
            _dpListCache.clear();         // 列表上要顯示留言數 ⇒ 30 秒快取要作廢
          } catch (_ce) { console.warn('[deck-posts] commentCount +1 failed（recount 可修）:', _ce && _ce.message); }
          res.json({ ok: true, comment: dpCommentPublic(doc, id.uid) });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      }

      /**
       * 刪除留言：**作者本人或 admin**。軟刪（明細保留，計數可對帳）。
       *
       * ⚠ **必須冪等**。v6.140 踩過「刪除連點 → 第二發找不到目標就噴 404」——
       *   玩家看到的是「明明刪掉了卻報錯」。這裡「找不到」與「已經是 deleted」一律回 200
       *   `changed:false`，只有真正發生轉換時才 `changed:true` 並把 commentCount -1。
       * ⚠ 限流：**no-op 也照算**。退額度會讓「拿假 cid 跑迴圈」的淨消耗變成 0
       *   （Fable 5 review 指出）；連點兩下吃兩格、上限 30/分鐘，實務上綽綽有餘。
       */
      async function dpCommentDelete(req, res) {
        try {
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('cx:' + id.uid, 60000, 30)) return res.status(429).json({ error: '操作過於頻繁' });
          const cid = String((req.params && req.params.cid) || '');
          const c = await DPCOMM.findOne({ _id: cid });
          if (!c) return res.json({ ok: true, changed: false });
          const isAdm = isTournAdmin(id);
          if (c.uid !== id.uid && !isAdm) return res.status(403).json({ error: '只能刪除自己的留言' });
          const r = await DPCOMM.updateOne(
            { _id: cid, status: { $ne: 'deleted' } },
            { $set: { status: 'deleted', deletedAt: Date.now(), deletedBy: (c.uid === id.uid ? 'author' : 'admin') } },
          );
          const changed = !!(r && r.matchedCount);
          if (changed) {
            // 同 dpCommentCreate：計數失敗不可以害得「已經刪掉」被回報成失敗。
            // ⭐⭐v6.185 lastCommentAt 的漂移只可能發生在「刪掉的剛好是最後一則」——
            //   $max 沒有反向操作，只能重算。這裡**用明細重算**：對單一 postId 取還活著的
            //   最新一則（已有索引 {postId,status,createdAt}，是一次 limit(1) 的點查詢，
            //   不是列表頁的 N+1 —— 刪除是低頻的單筆操作，這一次查詢完全付得起）。
            //   全都刪光就寫回 0（不是 unset —— 見上面「欄位缺席會排到 0 之後」的理由）。
            try {
              const _newest = await DPCOMM.find({ postId: c.postId, status: { $ne: 'deleted' } })
                .sort({ createdAt: -1 }).limit(1).toArray();
              const _lca = (_newest && _newest[0] && _newest[0].createdAt) || 0;
              await DPOSTS.updateOne({ _id: c.postId }, { $inc: { commentCount: -1 }, $set: { lastCommentAt: _lca } });
              _dpListCache.clear();
            } catch (_ce) { console.warn('[deck-posts] commentCount -1 failed（recount 可修）:', _ce && _ce.message); }
          }
          res.json({ ok: true, changed, postId: c.postId });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      }

      app.get('/api/deck-posts-comments', dpCommentList);
      app.post('/api/deck-posts-comments', dpCommentCreate);
      app.delete('/api/deck-posts-comments/:cid', dpCommentDelete);

      // ════════ 賽事名次投稿 ════════
      //   client 只送 eventId。名次與牌組**全部由伺服器從歸檔推導**，
      //   沒有任何一條路徑可以讓玩家自報名次或換掉牌組。
      async function dpEligibility(uid) {
        const out = [];
        const since = Date.now() - DP_TOURN_WINDOW_MS;
        const detectCut = (app.locals || {})._detectCutPlacements;   // ⚠ 執行時取，不在註冊時解構
        const archives = await TARCHIVE.find(
          { finishedAt: { $gt: since }, communityEvent: { $ne: true }, 'players.uid': uid },
          { projection: { 'players.uid': 1, matches: 1, championUid: 1, eventName: 1, eventId: 1, finishedAt: 1, communityEvent: 1 } },
        ).sort({ finishedAt: -1 }).limit(20).toArray();
        for (const a of archives) {
          const label = dpPlacementOf(a, uid, detectCut);
          if (!label) continue;
          out.push({ eventId: a.eventId || String(a._id || '').replace(/^arch_/, ''), eventName: a.eventName || '賽事', finishedAt: a.finishedAt || 0, placementLabel: label });
        }
        return out;
      }

      // 名次判定（純函式，守衛可直接驗）。回 null＝此人沒有可投稿的名次。
      //   ⚠ placementsOk=false（賽程結構推不出名次，例如最後一輪不只一場）時 **fail-closed**：
      //     只放行冠軍 —— championUid 是歸檔的明確欄位，不靠推導。
      function dpPlacementOf(archive, uid, detectCut) {
        if (!archive || !uid) return null;
        if (archive.communityEvent === true) return null;                 // ④ 只開網站賽
        if (archive.championUid && archive.championUid === uid) return DP_PLACEMENT.CHAMPION;
        if (typeof detectCut !== 'function') return null;
        let cut = null;
        try { cut = detectCut(archive.matches || []); } catch (_e) { return null; }
        if (!cut || !cut.finals || !cut.top4) return null;
        // ⚠ _detectCutPlacements 是為**單敗淘汰**設計的保守推導。瑞士制邊角
        //   （cut 覆寫成 top2、小人數瑞士）會讓「最後一輪瑞士」被當成四強輪，
        //   把整輪的人（含輪空者，playersIn 會把 bye 的 p1 也算進去）標成「四強」。
        //   統計頁算錯還能人工看出來，這裡是**自動鑄造公開頭銜**，標準不同 ⇒ 要求結構
        //   恰好是標準四強：決賽 2 人、四強 4 人。任何一邊對不上就 fail-closed 回冠軍那條路。
        //   （Fable 5 review 指出，我查證歸檔確實有存 format 且瑞士制邊角成立。）
        if (cut.finals.size !== 2 || cut.top4.size !== 4) return null;
        if (cut.finals.has(uid)) return DP_PLACEMENT.FINALS;              // 打進決賽但不是冠軍 ⇒ 亞軍
        if (cut.top4.has(uid)) return DP_PLACEMENT.TOP4;                  // ① 3、4 名分不出 ⇒ 一律「四強」
        return null;
      }

      // ⚠⚠⚠ 路徑用獨立前綴 /api/deck-posts-tournament/*，**不是** /api/deck-posts/xxx。
      //   Express 依註冊順序比對，`/api/deck-posts/:id` 是單段 pattern，會把任何
      //   `/api/deck-posts/具名子路徑` 整個吃掉 —— 第一版寫成 /api/deck-posts/tournament-eligibility
      //   時它 100% 打不到，而且回的是 404「找不到這篇投稿」，連錯誤 log 都不會有
      //   （Fable 5 code review 抓到）。改前綴比「小心註冊順序」可靠：日後再加
      //   「我的投稿」之類的具名 GET 也不會重蹈覆轍。
      // 「我的投稿」：含被 admin 下架（hidden）與自己刪掉（deleted）的，讓玩家知道發生什麼事。
      //   ⚠ 路徑同樣用 /api/deck-posts-mine 這種獨立前綴，**不能**寫成 /api/deck-posts/mine
      //     —— 那會被上面的 `/:id` 單段 pattern 整個吃掉（v6.138 踩過一次）。
      app.get('/api/deck-posts-mine', async (req, res) => {
        try {
          res.set('Cache-Control', 'no-store');
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('m:' + id.uid, 60000, 30)) return res.status(429).json({ error: '請求過於頻繁' });
          const docs = await DPOSTS.find({ uid: id.uid }, { projection: { entries: 0, email: 0, entriesHash: 0 } })
            .sort({ createdAt: -1 }).limit(100).toArray();
          // status 是自己的資料，回給本人沒有洩漏問題（dpPublic 白名單不含它，這裡顯式補上）
          res.json({ posts: docs.map((d) => dpPublic(d, { status: d.status })) });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      app.get('/api/deck-posts-tournament/eligibility', async (req, res) => {
        try {
          res.set('Cache-Control', 'no-store');
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('e:' + id.uid, 60000, 20)) return res.status(429).json({ error: '請求過於頻繁' });
          const list = await dpEligibility(id.uid);
          const posted = list.length
            ? await DPOSTS.find({ uid: id.uid, status: { $ne: 'deleted' }, 'tournament.eventId': { $in: list.map((x) => x.eventId) } }, { projection: { 'tournament.eventId': 1 } }).toArray()
            : [];
          const done = new Set(posted.map((p) => p.tournament && p.tournament.eventId));
          res.json({ events: list.map((x) => ({ ...x, alreadyPosted: done.has(x.eventId) })) });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      app.post('/api/deck-posts-tournament/submit', async (req, res) => {
        try {
          const id = await dpIdentity(req);
          if (id.error) return res.status(id.code).json({ error: id.error });
          if (!dpRate('t:' + id.uid, 60000, 1)) return res.status(429).json({ error: '操作太頻繁，請稍候再試' });
          const eventId = String((req.body && req.body.eventId) || '');
          if (!eventId) return res.status(400).json({ error: '缺少 eventId' });
          const a = await TARCHIVE.findOne({ _id: 'arch_' + eventId });
          if (!a) return res.status(404).json({ error: '找不到這場賽事的歸檔' });
          if (a.communityEvent === true) return res.status(403).json({ error: '社群自辦賽暫不開放名次投稿，可改用一般投稿' });
          if (!a.finishedAt || Date.now() - a.finishedAt > DP_TOURN_WINDOW_MS) return res.status(403).json({ error: '這場賽事已超過投稿期限（賽後 30 天內）' });
          const label = dpPlacementOf(a, id.uid, (app.locals || {})._detectCutPlacements);
          if (!label) return res.status(403).json({ error: '這場賽事沒有查到你的四強以上名次' });
          const me = (a.players || []).find((p) => p && p.uid === id.uid);
          if (!me || !Array.isArray(me.deckEntries) || !me.deckEntries.length) return res.status(404).json({ error: '找不到你在這場賽事登記的牌組' });
          const dup = await DPOSTS.findOne({ uid: id.uid, 'tournament.eventId': eventId, status: { $ne: 'deleted' } }, { projection: { _id: 1 } });
          if (dup) return res.status(409).json({ error: '你已經投稿過這場賽事的牌組了' });
          // ② 牌組固定用歸檔那副，client 送什麼都不採用
          const r = await dpInsert(id, {
            deckName: me.deckName || '牌組',
            authorName: me.name,              // 報名這場賽事時填的暱稱
            entries: me.deckEntries,
            notes: String((req.body && req.body.notes) || '').slice(0, DP_MAX_NOTES),
            tournament: { eventId, eventName: a.eventName || '網站賽', finishedAt: a.finishedAt || 0, placementLabel: label },
          });
          if (r.error) return res.status(r.code).json({ error: r.error });
          res.json({ ok: true, id: r.doc._id, placementLabel: label });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // ════════ admin（③ 先發後審：下架／復原／計數對帳）════════
      app.get('/api/admin/deck-posts', async (req, res) => {
        try {
          const id = await tournIdentity(req);
          if (!isTournAdmin(id)) return res.status(403).json({ error: '需要管理員權限' });
          const q = {};
          const st = String((req.query && req.query.status) || '');
          if (st) q.status = st;
          const docs = await DPOSTS.find(q, { projection: { entries: 0 } }).sort({ createdAt: -1 }).limit(300).toArray();
          res.json({ posts: docs.map((d) => ({ ...dpPublic(d), status: d.status, email: d.email || '', updatedAt: d.updatedAt || 0 })) });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });
      async function dpAdminSetStatus(req, res, status) {
        try {
          const id = await tournIdentity(req);
          if (!isTournAdmin(id)) return res.status(403).json({ error: '需要管理員權限' });
          const r = await DPOSTS.updateOne({ _id: String(req.params.id) }, { $set: { status, updatedAt: Date.now() } });
          if (!r.matchedCount) return res.status(404).json({ error: '找不到這篇投稿' });
          _dpListCache.clear();
          res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      }
      app.post('/api/admin/deck-posts/:id/hide', (req, res) => dpAdminSetStatus(req, res, 'hidden'));
      app.post('/api/admin/deck-posts/:id/restore', (req, res) => dpAdminSetStatus(req, res, 'published'));
      // v6.144 回填：把既有投稿裡「當初退成 email 前綴」的顯示名，換成該玩家最近一次報名的暱稱。
      //   ⚠ 判準必須精確：**只改 `authorName === email 的 @ 前面那段`** 的投稿。
      //     那正是 tournIdentity fallback 的產物；玩家自己改過的名字不會剛好等於它，
      //     所以這條件不會覆蓋任何人手動設定的名稱。查不到報名暱稱的一律略過（不亂編）。
      app.post('/api/admin/deck-posts/backfill-names', async (req, res) => {
        try {
          const id = await tournIdentity(req);
          if (!isTournAdmin(id)) return res.status(403).json({ error: '需要管理員權限' });
          const dry = String((req.query && req.query.dry) || '') === '1';
          const docs = await DPOSTS.find({ status: { $ne: 'deleted' } },
            { projection: { _id: 1, uid: 1, email: 1, authorName: 1 } }).toArray();
          const changed = [];
          const skipped = { notEmailPrefix: 0, noNick: 0, sameName: 0 };
          for (const d of docs) {
            const prefix = d.email ? String(d.email).split('@')[0] : '';
            if (!prefix || d.authorName !== prefix) { skipped.notEmailPrefix++; continue; }
            const nick = await getLastRegisteredNick(d.uid);
            if (!nick) { skipped.noNick++; continue; }
            if (nick === d.authorName) { skipped.sameName++; continue; }
            changed.push({ id: d._id, from: d.authorName, to: nick });
            if (!dry) await DPOSTS.updateOne({ _id: d._id }, { $set: { authorName: String(nick).slice(0, 24), updatedAt: Date.now() } });
          }
          if (!dry && changed.length) _dpListCache.clear();
          res.json({ ok: true, dryRun: dry, scanned: docs.length, changed: changed.length, skipped, detail: changed.slice(0, 50) });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // 計數對帳：likeCount/downloadCount/commentCount 都是非正規化快照，權威永遠是明細表。
      //   ⚠ 抽成具名函式是為了讓守衛能把它抽出來**真的跑一遍**（先人為製造漂移再驗它修好），
      //     而不是只斷言「檔案裡有出現 commentCount 這個字」。
      async function dpAdminRecount(req, res) {
        try {
          const id = await tournIdentity(req);
          if (!isTournAdmin(id)) return res.status(403).json({ error: '需要管理員權限' });
          const [likes, downs, cmts] = await Promise.all([
            DPLIKES.aggregate([{ $group: { _id: '$postId', n: { $sum: 1 } } }]).toArray(),
            DPDOWNS.aggregate([{ $group: { _id: '$postId', n: { $sum: 1 } } }]).toArray(),
            // ⚠ 留言是**軟刪**，對帳一定要先濾掉 deleted，否則「重算」反而會把已刪的算回來。
            //   ⭐v6.185 同一趟順便算出每篇的最新留言時間（$max）⇒ lastCommentAt 也能對帳。
            DPCOMM.aggregate([{ $match: { status: { $ne: 'deleted' } } }, { $group: { _id: '$postId', n: { $sum: 1 }, last: { $max: '$createdAt' } } }]).toArray(),
          ]);
          const lm = new Map(likes.map((x) => [x._id, x.n]));
          const dm = new Map(downs.map((x) => [x._id, x.n]));
          const cm = new Map(cmts.map((x) => [x._id, x.n]));
          const km = new Map(cmts.map((x) => [x._id, x.last || 0]));
          const all = await DPOSTS.find({}, { projection: { _id: 1, likeCount: 1, downloadCount: 1, commentCount: 1, lastCommentAt: 1 } }).toArray();
          let fixed = 0;
          for (const p of all) {
            const l = lm.get(p._id) || 0, d = dm.get(p._id) || 0, c = cm.get(p._id) || 0, k = km.get(p._id) || 0;
            // ⭐v6.185 lastCommentAt 一併對帳。⚠ 比對用 `!==` 而不是「有值才修」——
            //   舊投稿的欄位是**缺席**（undefined），`(p.lastCommentAt || 0) !== 0` 為 false，
            //   若只在不等時才寫就永遠補不進去；所以缺席時額外強制回填一次。
            const needBackfill = typeof p.lastCommentAt !== 'number';
            if (needBackfill || (p.likeCount || 0) !== l || (p.downloadCount || 0) !== d
                || (p.commentCount || 0) !== c || (p.lastCommentAt || 0) !== k) {
              await DPOSTS.updateOne({ _id: p._id }, { $set: { likeCount: l, downloadCount: d, commentCount: c, lastCommentAt: k } });
              fixed++;
            }
          }
          _dpListCache.clear();
          res.json({ ok: true, checked: all.length, fixed });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      }
      app.post('/api/admin/deck-posts/recount', dpAdminRecount);

      // admin 留言巡檢：跨投稿看最近的留言（含已刪），站長要能一眼掃過公開版面上的內容。
      //   ⚠ 刪除不另開 admin 端點 —— 直接用 /api/deck-posts-comments/:cid，
      //     授權在 dpCommentDelete 內部（作者或 admin），兩條路徑不會漂移。
      app.get('/api/admin/deck-posts-comments', async (req, res) => {
        try {
          const id = await tournIdentity(req);
          if (!isTournAdmin(id)) return res.status(403).json({ error: '需要管理員權限' });
          const q = {};
          const pid = String((req.query && req.query.postId) || '');
          if (pid) q.postId = pid;
          const st = String((req.query && req.query.status) || '');
          if (st) q.status = st;
          const docs = await DPCOMM.find(q).sort({ createdAt: -1 }).limit(300).toArray();
          res.json({ comments: docs.map((d) => ({ ...dpCommentPublic(d, null), status: d.status || 'published', email: d.email || '' })) });
        } catch (e) { res.status(500).json({ error: e && e.message }); }
      });

      // 守衛與未來的管理端會用到；比照 _detectCutPlacements 的作法掛出去。
      app.locals._dpPlacementOf = dpPlacementOf;
      // ⚠ fail-open 必須出聲。v3.84「以為版權素材移掉了」、v6.130「以為 autoplay 有效」
      //   都是同一類靜默失效 —— 沒有訊號就沒有人會發現驗證其實沒開。
      if (typeof TENG.validateDeck !== 'function') {
        console.warn('[deck-posts] ⚠ 目前的 server-engine.cjs 沒有 validateDeck → 牌組完整驗證停用'
          + '（只驗 60 張與卡片存在）。請跑 update-tournament.bat 重建 bundle。');
      }
      console.log('[deck-posts] endpoints registered');
    } catch (_dpe) {
      console.warn('[deck-posts] init failed → 牌組公布欄停用（賽事與對戰不受影響）:', _dpe && _dpe.message);
    }

    // 把多筆 archives 聚合成 Map<email, stat>。
    function _aggregateArchives(archives) {
      const acc = new Map();
      const ensure = (email) => { if (!acc.has(email)) acc.set(email, { email, displayName: '', lastFinishedAt: -1, champOfficial: 0, champOfficialAt: -1, champCommunity: 0, champCommunityAt: -1, wins: 0, winsAt: -1, losses: 0, finals: 0, finalsAt: -1, top4: 0, top4At: -1, top8: 0, top8At: -1, communityEntered: 0, officialEntered: 0, eventsPlayed: 0, events: [] }); return acc.get(email); };
      const _mx = (a, b) => (a > b ? a : b);
      for (const a of archives) {
        const emailByUid = new Map();
        for (const p of (a.players || [])) if (p.email) emailByUid.set(p.uid, p.email);
        const fin = a.finishedAt || 0; const isComm = !!a.communityEvent;
        // ⭐v6.244：顯示用的「賽事日期」＝**開賽時間**（跨午夜的決賽不該把日期推到隔天）。
        //   ⚠ 下面那些 *At（winsAt / champOfficialAt / lastFinishedAt）刻意**維持 fin**：
        //     它們不是顯示欄位，是排行榜同分時的「誰比較近期」tie-break，改了會動到榜單順序。
        const evDate = a.startedAt || a.createdAt || fin;
        const cut = !isComm ? _detectCutPlacements(a.matches || []) : { finals: new Set(), top4: new Set(), top8: new Set() };
        const evW = new Map(), evL = new Map();
        for (const m of (a.matches || [])) {
          if (m.bye) continue;
          if (m.winnerUid && m.p1uid && m.p2uid) {
            const lUid = m.winnerUid === m.p1uid ? m.p2uid : m.p1uid;
            const we = emailByUid.get(m.winnerUid), le = emailByUid.get(lUid);
            if (we) { const sw = ensure(we); sw.wins++; sw.winsAt = _mx(sw.winsAt, fin); evW.set(we, (evW.get(we) || 0) + 1); }
            if (le) { ensure(le).losses++; evL.set(le, (evL.get(le) || 0) + 1); }
          } else if (m.status === 'done' && m.p1uid && m.p2uid && !m.winnerUid) {
            const a1 = emailByUid.get(m.p1uid), a2 = emailByUid.get(m.p2uid);
            if (a1) { ensure(a1).losses++; evL.set(a1, (evL.get(a1) || 0) + 1); }
            if (a2) { ensure(a2).losses++; evL.set(a2, (evL.get(a2) || 0) + 1); }
          }
        }
        const champEmail = a.championUid ? emailByUid.get(a.championUid) : null;
        for (const p of (a.players || [])) {
          if (!p.email) continue;
          const s = ensure(p.email);
          s.eventsPlayed++; if (isComm) s.communityEntered++; else s.officialEntered++;
          if (fin > s.lastFinishedAt) { s.lastFinishedAt = fin; s.displayName = p.name || s.displayName; }
          const isChamp = champEmail === p.email;
          if (isChamp) { if (isComm) { s.champCommunity++; s.champCommunityAt = _mx(s.champCommunityAt, fin); } else { s.champOfficial++; s.champOfficialAt = _mx(s.champOfficialAt, fin); } }
          if (!isComm) { if (cut.finals.has(p.uid)) { s.finals++; s.finalsAt = _mx(s.finalsAt, fin); } if (cut.top4.has(p.uid)) { s.top4++; s.top4At = _mx(s.top4At, fin); } if (cut.top8.has(p.uid)) { s.top8++; s.top8At = _mx(s.top8At, fin); } }
          let result = '';
          if (isChamp) result = '冠軍';
          else if (!isComm && cut.finals.has(p.uid)) result = '亞軍';
          else if (!isComm && cut.top4.has(p.uid)) result = '4強';
          else if (!isComm && cut.top8.has(p.uid)) result = '8強';
          s.events.push({ eventName: a.eventName || '錦標賽', date: evDate, format: a.format || 'single-elim', communityEvent: isComm, wins: evW.get(p.email) || 0, losses: evL.get(p.email) || 0, result });
        }
      }
      return acc;
    }

    // ── v0.66 公開：排行榜（各榜前 N；依 email 聚合、顯示最後暱稱、不回 email）──
    //   v0.68：加 60 秒記憶體快取——排行榜只在賽事結束才變,掃全 TARCHIVE 聚合較重,降低 Oracle 負載。
    //   ⭐v1.15（v6.199）：筆數改由 client 指定 ?limit=（1~_LB_MAX）。
    //     ⚠ **沒帶 limit 一律回 5** —— 線上仍有被 Service Worker 卡住舊 bundle 的 client,
    //       它們是伺服器回幾筆就畫幾筆,預設放大會讓那些人的版面無聲變長。向後相容優先。
    //     ⚠ 快取一律存「_LB_MAX 筆」那一份,回應時才切片 ⇒ 不管同時有幾種 limit,
    //       60 秒內都只掃一次 TARCHIVE（不會因為多一種筆數就多一次全表聚合）。
    const _LB_MAX = 20;
    const _LB_DEFAULT = 5;
    function _lbClampLimit(raw) {
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n) || n < 1) return _LB_DEFAULT;
      return n > _LB_MAX ? _LB_MAX : n;
    }
    //     ⚠ 回傳 limit 給 client:舊伺服器不認識 ?limit= 也不會回這個欄位 ⇒ 新前端據此判斷
    //       「這台伺服器支援不支援」,不支援就不畫那顆下拉(不留一顆按了沒反應的控制項)。
    function _lbSliceResult(full, limit) {
      if (!full) return full;
      const cut = (a) => (Array.isArray(a) ? a.slice(0, limit) : a);
      const ch = full.champions || {};
      // ⚠ 先 spread 再覆寫:將來端點多加一個榜卻忘了改這裡,那個榜會**原樣送出**(只是沒切片),
      //   而不是被白名單靜默丟掉 —— 「多送幾筆」看得見,「整個榜消失」看不見。
      return {
        ...full,
        champions: { ...ch, official: cut(ch.official), community: cut(ch.community) },
        wins: cut(full.wins), top8: cut(full.top8), finals: cut(full.finals),
        communityHost: cut(full.communityHost),
        limit,
      };
    }
    let _lbCache = { at: 0, data: null };
    app.get('/api/tournament/leaderboard', async (req, res) => {
      try {
        const _limit = _lbClampLimit(req.query && req.query.limit);
        if (_lbCache.data && (Date.now() - _lbCache.at) < 60000) return res.json(_lbSliceResult(_lbCache.data, _limit));
        const archives = await TARCHIVE.find({}, { projection: { 'players.deckEntries': 0 } }).toArray();
        const all = [..._aggregateArchives(archives).values()];
        const topN = (key, atKey) => all.filter((x) => x[key] > 0).sort((a, b) => (b[key] - a[key]) || ((b[atKey] || 0) - (a[atKey] || 0))).slice(0, _LB_MAX).map((x) => ({ displayName: x.displayName || '（未命名）', count: x[key] }));
        const commEvents = await TEVENTS.find({ createdByPlayer: true }).toArray();
        const hostMap = new Map();
        for (const ev of commEvents) { const e = ev.createdBy; if (!e) continue; if (!hostMap.has(e)) hostMap.set(e, { displayName: ev.proposerName || e, count: 0, last: -1 }); const h = hostMap.get(e); h.count++; if ((ev.createdAt || 0) > h.last) { h.last = ev.createdAt || 0; h.displayName = ev.proposerName || h.displayName; } }
        const communityHost = [...hostMap.values()].sort((a, b) => (b.count - a.count) || ((b.last || 0) - (a.last || 0))).slice(0, _LB_MAX).map((x) => ({ displayName: x.displayName, count: x.count }));
        const result = { champions: { official: topN('champOfficial', 'champOfficialAt'), community: topN('champCommunity', 'champCommunityAt') }, wins: topN('wins', 'winsAt'), top8: topN('top8', 'top8At'), finals: topN('finals', 'finalsAt'), communityHost };
        _lbCache = { at: Date.now(), data: result };
        res.json(_lbSliceResult(result, _limit));
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── v0.66 個人資料（需登入；只回本人 email 的聚合戰績）──
    app.get('/api/tournament/profile', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!id.email) return res.status(403).json({ error: '需要 email 帳號才能查看個人戰績' });
        const archives = await TARCHIVE.find({ 'players.email': id.email }, { projection: { 'players.deckEntries': 0 } }).toArray();
        const s = _aggregateArchives(archives).get(id.email);
        if (!s) return res.json({ email: id.email, displayName: id.name || String(id.email).split('@')[0], championsOfficial: 0, championsCommunity: 0, finals: 0, top4: 0, top8: 0, communityEntered: 0, totalWins: 0, totalLosses: 0, eventsPlayed: 0, events: [] });
        res.json({ email: s.email, displayName: s.displayName || '（未命名）', championsOfficial: s.champOfficial, championsCommunity: s.champCommunity, finals: s.finals, top4: s.top4, top8: s.top8, communityEntered: s.communityEntered, totalWins: s.wins, totalLosses: s.losses, eventsPlayed: s.eventsPlayed, events: s.events.slice().sort((a, b) => (b.date || 0) - (a.date || 0)) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 管理員：編輯名人堂紀錄（冠軍名/賽事名/牌組名）
    app.post('/api/tournament/admin/champions/update', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const cid = String((req.body && req.body.id) || '');
        if (!cid) return res.status(400).json({ error: '缺少 id' });
        const set = {};
        if (req.body && typeof req.body.championName === 'string') set.championName = req.body.championName.slice(0, 40);
        if (req.body && typeof req.body.eventName === 'string') set.eventName = req.body.eventName.slice(0, 60);
        if (req.body && typeof req.body.deckName === 'string') set.deckName = req.body.deckName.slice(0, 60);
        if (!Object.keys(set).length) return res.status(400).json({ error: '無可更新欄位' });
        const r = await TCHAMPS.updateOne({ _id: cid }, { $set: set });
        if (!r.matchedCount) return res.status(404).json({ error: '找不到該紀錄' });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：刪除名人堂紀錄
    app.post('/api/tournament/admin/champions/delete', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const cid = String((req.body && req.body.id) || '');
        if (!cid) return res.status(400).json({ error: '缺少 id' });
        await TCHAMPS.deleteOne({ _id: cid });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.59 管理員：從賽事歸檔(TARCHIVE,永久保存)還原名人堂(TCHAMPS) — 救回被誤刪的冠軍。
    //   只用 $setOnInsert 補回「缺漏」的紀錄,不覆蓋既有(避免蓋掉 admin 手動改過的)。冪等可重跑。
    app.post('/api/tournament/admin/champions/restore-from-archive', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const archives = await TARCHIVE.find({}).toArray();
        let restored = 0;
        for (const a of archives) {
          if (!a || !a.championUid) continue;  // 無冠軍(雙敗/取消)場不還原
          const cid = 'champ_' + a.eventId;
          const champPlayer = (a.players || []).find((p) => p.uid === a.championUid);
          const r = await TCHAMPS.updateOne({ _id: cid }, { $setOnInsert: {
            _id: cid, eventId: a.eventId, eventName: a.eventName || '錦標賽',
            championUid: a.championUid, championName: a.championName || (champPlayer && champPlayer.name) || '冠軍',
            deckName: (champPlayer && champPlayer.deckName) || '', playerCount: a.playerCount || 0,
            startedAt: a.startedAt || a.createdAt || null,          // v6.244 開賽時間＝賽事日期
            finishedAt: a.finishedAt || Date.now(),                 // 冠軍產生時間（⚠ 不是賽事日期）
            communityEvent: !!a.communityEvent,
          } }, { upsert: true });
          if (r.upsertedCount) restored++;
        }
        res.json({ ok: true, restored });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：賽事統計 — 回傳所有賽事歸檔(TARCHIVE) + 名人堂(TCHAMPS)，前端用卡片索引聚合各項數據
    // v0.42 管理員：取某場對戰的逐回合 log（賽事統計下鑽用）
    //   優先 TMATCH.finalLog（自然結束的場 v0.37 已快照），fallback 房間 mr_<matchId>.gameState.log
    //   （投降/時限/未進場等沒走 onMatchGameOver 的場，log 仍在房間盤面裡）。
    app.get('/api/tournament/admin/match-log', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        let matchId = req.query.matchId ? String(req.query.matchId) : '';
        if (!matchId && req.query.eventId && req.query.round != null && req.query.idx != null) {
          matchId = String(req.query.eventId) + '_r' + Number(req.query.round) + '_m' + Number(req.query.idx);
        }
        if (!matchId) return res.status(400).json({ error: '需要 matchId 或 eventId+round+idx' });
        const m = await TMATCH.findOne({ _id: matchId });
        let log = (m && Array.isArray(m.finalLog)) ? m.finalLog : null;
        let winReason = (m && m.finalWinReason) || null;
        let turn = (m && m.finalTurn) || null;
        let p1name = m ? m.p1name : null, p2name = m ? m.p2name : null, winnerName = m ? m.winnerName : null, status = m ? m.status : null;
        if (!log || !log.length) {
          const room = await TROOMS.findOne({ _id: 'mr_' + matchId });
          if (room && room.gameState) {
            if (Array.isArray(room.gameState.log)) log = room.gameState.log;
            winReason = winReason || room.gameState.winReason || null;
            turn = turn || room.gameState.turn || null;
            if (!p1name && room.names) { p1name = room.names[0] || null; p2name = room.names[1] || null; }
          }
        }
        res.json({ matchId, p1name, p2name, winnerName, status, winReason, turn, log: log || [], found: !!(log && log.length) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── v0.67 公開：對戰戰報（文字 log）—— 只開放已結束(已歸檔)賽事，剝除私有訊息防作弊 ──
    // v0.81 對戰回放:公開端點,回逐回合盤面快照+finalLog(文字)+finalState(攤牌,不 redact 手牌——Wilson 決策)。
    //   gate:賽事已歸檔(TARCHIVE) 或 這場已 done 才開放(防偷看進行中);比照 match-log。缺快照的舊場前端 fallback 成文字。
    app.get('/api/tournament/replay', async (req, res) => {
      try {
        const matchId = String((req.query && req.query.matchId) || '');
        if (!matchId) return res.status(400).json({ error: '需要 matchId' });
        const m = await TMATCH.findOne({ _id: matchId });
        if (!m) return res.status(404).json({ error: '找不到這場對戰' });
        const arch = await TARCHIVE.findOne({ _id: 'arch_' + m.eventId }, { projection: { _id: 1 } });
        if (!arch && m.status !== 'done') return res.status(403).json({ error: '此對戰尚未結束,暫不開放回放' });
        let snaps = await TREPLAY.find({ matchId }).sort({ logLen: 1, turn: 1 }).toArray();  // v0.82 依 log 長度=時序排(先攻/後攻各半回合正確順序)
        // v0.83 有新格式(logLen 半回合快照)就只回新格,避免與舊 v0.81 整回合格混排錯亂;純舊資料場整批回(前端 turn fallback)
        if (snaps.some((x) => x.logLen != null)) snaps = snaps.filter((x) => x.logLen != null);
        // v0.83 finalLog/finalState fallback:投降/時限/閒置判負場沒走 onMatchGameOver→m.finalLog/finalState 空,補讀房間 gameState(與快照 logLen 同一份 log 累積,索引對得上)
        let finalLog = Array.isArray(m.finalLog) ? m.finalLog : [];
        let fs = null; if (m.finalState) { fs = Object.assign({}, m.finalState); fs.log = []; }
        if (!finalLog.length || !fs) {
          const _room = await TROOMS.findOne({ _id: 'mr_' + matchId });
          if (_room && _room.gameState) {
            if (!finalLog.length && Array.isArray(_room.gameState.log)) finalLog = _room.gameState.log;
            if (!fs) { fs = Object.assign({}, _room.gameState); fs.log = []; }
          }
        }
        res.json({
          meta: { matchId, eventId: m.eventId, p1name: m.p1name || null, p2name: m.p2name || null, winnerName: m.winnerName || null, finalWinReason: m.finalWinReason || null, finalTurn: m.finalTurn || null, round: m.round, endedAt: m.endedAt || null },
          finalLog,
          finalState: fs,
          snapshots: snaps.map((x) => ({ turn: x.turn, activePlayerIndex: (x.activePlayerIndex == null ? null : x.activePlayerIndex), logLen: (x.logLen == null ? null : x.logLen), state: x.state })),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.get('/api/tournament/match-log', async (req, res) => {
      try {
        const eventId = String((req.query && req.query.eventId) || '');
        const round = Number(req.query && req.query.round);
        const idx = Number(req.query && req.query.idx);
        if (!eventId || !Number.isFinite(round) || !Number.isFinite(idx)) return res.status(400).json({ error: '需要 eventId + round + idx' });
        // 只開放已結束(已歸檔 TARCHIVE)的賽事，進行中不給（防偷看作弊）
        const arch = await TARCHIVE.findOne({ _id: 'arch_' + eventId }, { projection: { _id: 1 } });
        if (!arch) return res.status(403).json({ error: '此賽事尚未結束，暫不開放戰報' });
        const matchId = eventId + '_r' + round + '_m' + idx;
        const m = await TMATCH.findOne({ _id: matchId });
        let log = (m && Array.isArray(m.finalLog)) ? m.finalLog : null;
        let turn = (m && m.finalTurn) || null;
        let p1name = m ? m.p1name : null, p2name = m ? m.p2name : null, winnerName = m ? m.winnerName : null;
        if (!log || !log.length) {
          const room = await TROOMS.findOne({ _id: 'mr_' + matchId });
          if (room && room.gameState && Array.isArray(room.gameState.log)) {
            log = room.gameState.log; turn = turn || room.gameState.turn || null;
            if (!p1name && room.names) { p1name = room.names[0] || null; p2name = room.names[1] || null; }
          }
        }
        // 公開只回 public message（剝除 privateMessage：搜牌/手牌等隱藏資訊）
        const pub = (log || []).map((e) => ({ turn: e.turn, playerIndex: e.playerIndex, message: e.message || '', sourceIid: e.sourceIid || null }));
        res.json({ matchId, p1name, p2name, winnerName, turn, log: pub, found: !!(log && log.length) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/tournament/admin/stats', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        // v6.240：**移除 limit(500)** —— 改成伺服器端分頁，前端逐頁累積回全量再聚合。
        //   ⚠ 這裡的統計（總覽／冠軍榜／玩家戰績／主力寶可夢使用率／賽果分佈）是
        //     **前端拿整包 archives 算的**，所以舊的 limit(500) 不只是「歷屆賽事列表少了幾列」，
        //     連上面那些**數字本身都是錯的**（只算最新 500 場）。分頁＋累積才算得到全量。
        //   ⚠ 向後相容：沒帶 ?page= ⇒ page=1 / pageSize=500 ⇒ archives 與 v1.21 逐字相同。
        //     （champions 這個欄位 admin.html 從未讀取——名人堂走 /api/tournament/champions——
        //       所以一併把它的 500 上限也拿掉，不會影響任何既有讀者。）
        const _pgRaw = (req.query && req.query.page);
        const _pgOn = _pgRaw != null && String(_pgRaw) !== '';
        const _pgSize = _pgOn
          ? Math.min(Math.max(1, Math.floor(Number(req.query.pageSize)) || 200), 500)
          : 500;
        const _arcTotal = await TARCHIVE.countDocuments({});
        const _arcPages = Math.max(1, Math.ceil(_arcTotal / _pgSize));
        const _arcPage = _pgOn ? Math.min(Math.max(1, Math.floor(Number(_pgRaw)) || 1), _arcPages) : 1;
        const archives = await TARCHIVE.find({}).sort({ finishedAt: -1 })
          .skip((_arcPage - 1) * _pgSize).limit(_pgSize).toArray();
        // 名人堂只在第 1 頁回（逐頁重傳同一份沒有意義）。沒帶 page 的舊 client 必定是第 1 頁 ⇒ 有值。
        const champions = _arcPage === 1 ? await TCHAMPS.find({}).sort({ finishedAt: -1 }).toArray() : [];
        res.json({
          total: _arcTotal, page: _arcPage, pageSize: _pgSize, totalPages: _arcPages, paged: _pgOn,
          archives: archives.map((a) => ({
            eventId: a.eventId, eventName: a.eventName || '錦標賽',
            createdAt: a.createdAt || null, startedAt: a.startedAt || a.createdAt || null, finishedAt: a.finishedAt || 0,
            playerCount: a.playerCount || 0,
            // v0.96 這兩個欄位原本沒回傳 → admin 的「官方賽／社群自辦賽」篩選拿到的永遠是
            //   undefined，於是每一場都被歸類成官方賽。歸檔本身有存（recordTournamentArchive
            //   寫 communityEvent: !!ev.createdByPlayer），純粹是這裡的 map 漏掉。
            //   ⚠新增前端篩選條件時，一定要回頭確認端點真的有回傳那個欄位。
            communityEvent: !!a.communityEvent, format: a.format || null,
            championUid: a.championUid || null, championName: a.championName || null,
            players: (a.players || []).map((p) => ({ uid: p.uid, name: p.name, email: p.email || '', deckName: p.deckName || '', coinPref: p.coinPref || 'random', deckEntries: p.deckEntries || [] })),
            matches: (a.matches || []).map((m) => ({ round: m.round, idx: m.idx, p1uid: m.p1uid, p1name: m.p1name, p2uid: m.p2uid, p2name: m.p2name, winnerUid: m.winnerUid, winnerName: m.winnerName, status: m.status, bye: !!m.bye, noShow: !!m.noShow, doubleNoShow: !!m.doubleNoShow, draw: !!m.draw, deadlockDraw: !!m.deadlockDraw, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved })),
          })),
          champions: champions.map((c) => ({ eventId: c.eventId, eventName: c.eventName, championUid: c.championUid, championName: c.championName, deckName: c.deckName || '', playerCount: c.playerCount || 0, finishedAt: c.finishedAt || 0 })),
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：刪除某場賽事的歸檔（連同名人堂紀錄）— 測試賽事清除，刪除後完全不計入賽事統計
    app.post('/api/tournament/admin/stats/archive/delete', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const eventId = String((req.body && req.body.eventId) || '');
        if (!eventId) return res.status(400).json({ error: '缺少 eventId' });
        await TARCHIVE.deleteOne({ _id: 'arch_' + eventId });
        await TCHAMPS.deleteOne({ _id: 'champ_' + eventId });  // 一併移除名人堂該筆，統計與冠軍榜都不再計入
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // 管理員：列出待裁定平手場
    app.get('/api/tournament/admin/tie-matches', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
        if (!isTournAdmin(id)) return res.status(403).json({ error: '只有管理員可操作' });
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.json({ ties: [] });
        const ties = await TMATCH.find({ eventId: ev._id, status: 'tie' }).toArray();
        res.json({ ties: ties.map((m) => ({ matchId: m._id, round: m.round, p1name: m.p1name, p2name: m.p2name })) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    // v0.40：把單一賽事的排程處理抽成 per-event，scheduler 迴圈所有開放賽事 → 多場同時並行推進。
    async function _processEventTick(ev) {
        const now = Date.now();
        // v0.70：移除 v0.45「全域自動順延」——官方＋社群賽改為可並行舉辦，賽事依排定時間開賽、不再等前一場結束。
        //   同一玩家被兩場同時召喚改由 seedEventBracket 開賽配對前「移除較晚那場的重複玩家」處理（保留較早的那場）。
        if (ev.status === 'draft' && ev.registrationOpenAt && now >= ev.registrationOpenAt) {
          await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'registration' } });
          await postSystemChat('📋 「' + ev.name + '」報名開始！快來報名～');
          return;
        }
        if (ev.status === 'registration' && ev.registrationCloseAt && now >= ev.registrationCloseAt) {
          // v0.53 社群賽：募集截止先檢查「響應(報名)人數 ≥ 門檻」，不足直接取消（不需管理員）。
          if (ev.createdByPlayer) {
            const _regN = await TREGS.countDocuments({ eventId: ev._id });
            if (_regN < (ev.minPlayers || 4)) {
              await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', cancelled: true, championUid: null, championName: null } });
              await postSystemChat('🚫 社群賽「' + ev.name + '」響應不足（' + _regN + '/' + (ev.minPlayers || 4) + '），募集取消。');
              return;
            }
          }
          const cdMin0 = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
          if (ev.checkInEnabled !== false && cdMin0 > 0) {
            // 報到制：先進「報到階段」，給 cdMin 分鐘讓參賽者按報到鈕；逾時未報到者不列入賽程
            await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'checkin', checkInDeadline: now + cdMin0 * 60000 } });
            await postSystemChat('🔔 「' + ev.name + '」報名截止！請於 ' + cdMin0 + ' 分鐘內按「我要報到」，逾時未報到者不列入賽程。');
            // v0.85 推播①：報到開始 → 推給本場所有已報名者（fire-and-forget，不 await 不阻塞 tick）
            try {
              const _pr = await TREGS.find({ eventId: ev._id }).project({ uid: 1 }).toArray();
              sendPushToUids(_pr.map((r) => r.uid).filter(Boolean), {
                title: '🏆 ' + ev.name + ' 開放報到',
                body: '請於 ' + cdMin0 + ' 分鐘內完成報到，逾時將無法參賽。',
                tag: 'ptcg-t-checkin-' + ev._id,
              });
            } catch (e) { /* 推播失敗不影響賽事 */ }
          } else {
            // 無報到制（admin 關閉 或 休息時間=0）→ 沿用舊行為：直接以全部報名者開賽
            const r = await seedEventBracket(ev);
            if (r.ok) await postSystemChat('🔔 「' + ev.name + '」報名截止，賽程已公布，第 1 輪開始！');
            else if (r.retry) { /* R2：去重查詢失敗，下次 tick 重試 */ }
            else if (r.conflictBelowMin) { await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', cancelled: true, championUid: null, championName: null } }); await postSystemChat('🚫 「' + ev.name + '」多數選手仍在其他進行中的賽事，可出賽人數不足，本場取消。'); }
            else if (r.alreadySeeded) { /* R1b：已被其他路徑 seed → 靜默 */ }
            else if (!ev._closeWarned) { await TEVENTS.updateOne({ _id: ev._id }, { $set: { _closeWarned: true } }); await postSystemChat('⚠️ 「' + ev.name + '」報名人數不足 2 人，請管理員處理。'); }
          }
          return;
        }
        // v0.70 R3：bracket_ready 卡死回收——正常 CAS→bracket_ready 後同 tick 立即 seed→running；若 seed 因去重查詢
        //   逾時(retry)或 insertMany 後 crash 使 event 卡 bracket_ready，>90s 後重試 seed(seedEventBracket 先 deleteMany 冪等)。
        //   避免卡死場殘留的 match 讓其玩家被之後每場永久剔除(幽靈佔有)。
        if (ev.status === 'bracket_ready') {
          if (now - Number(ev.bracketReadyAt || ev.startedAt || ev.createdAt || 0) > 90000) {
            const r = await seedEventBracket(ev, { checkedInOnly: true, immediateEnter: true });
            if (r.ok) { await postSystemChat('⚔️ 「' + ev.name + '」賽程已產生，第 1 輪開始，可直接進場！'); }
            else if (r.retry) { /* 續等下次回收 */ }
            else if (r.conflictBelowMin) { await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', cancelled: true, championUid: null, championName: null } }); await recordTournamentArchive(ev); await postSystemChat('🚫 「' + ev.name + '」可出賽人數不足，本場取消。'); }
            else if (r.alreadySeeded) { /* R1b：已被其他路徑 seed → 靜默 */ }
            else { /* crash 回收失敗且無足夠人:一律取消,刻意不走「1人發冠軍」(避免不戰而冠) */ await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', championUid: null, championName: null } }); await recordTournamentArchive(ev); await postSystemChat('⚠️ 「' + ev.name + '」無法產生賽程，賽事取消。'); }
          }
          return;
        }
        // 報到截止 → 以「已報到者」產生賽程開賽（排除報名但沒到的人，第 1 輪即可進場）
        if (ev.status === 'checkin' && ev.checkInDeadline && now >= ev.checkInDeadline) {
          // v0.53 社群賽：報到截止先檢查「報到人數 ≥ 門檻」，不足直接取消。
          // ⚠⚠v6.188（Fable 審查抓到）：這段的「數人數」與「取消」原本在鎖外、也不是 CAS，
          //   與新的補報名端點會有真實競態 —— 數到 3/4 的同時有人補報成功（他的兩次 status 重讀
          //   都還是 checkin ⇒ 回 200），下一秒賽事卻因為「少他一人」被取消。那就多出第三種結局，
          //   直接打臉補報端點宣稱的「要嘛被收進賽程、要嘛明確被拒」。
          //   ⇒ 整段排進**同一條 seed 序列鎖**：補報若排在前面，這裡數得到他（湊滿門檻就不取消）；
          //     排在後面則他會看到 finished 而被明確拒絕。取消的寫入一併加上 status:'checkin' 條件，
          //     避免與下方的 CAS 互踩。
          if (ev.createdByPlayer) {
            const _ciFail = await runInSeedChain(async () => {
              const _ciN = await TREGS.countDocuments({ eventId: ev._id, checkedIn: true });
              if (_ciN >= (ev.minPlayers || 4)) return null;
              const _r = await TEVENTS.updateOne({ _id: ev._id, status: 'checkin' }, { $set: { status: 'finished', cancelled: true, championUid: null, championName: null } });
              return (_r && _r.matchedCount === 1) ? _ciN : null;
            });
            if (_ciFail != null) {
              await postSystemChat('🚫 社群賽「' + ev.name + '」報到不足（' + _ciFail + '/' + (ev.minPlayers || 4) + '），取消開賽。');
              return;
            }
          }
          // v0.46：原子搶占 checkin → bracket_ready（過渡狀態，seed 成功後 seedEventBracket 內改 running）。
          //   (A) 防 TOCTOU 競態：搶占瞬間「報到窗口」即關閉（checkin 端點要求 status==='checkin'），
          //       之後到的報到一律回 409，杜絕「報到回 200 但 seedEventBracket 已讀完 regs → 沒被排進賽程」
          //       （玩家以為報到成功卻直接沒得玩）。搶占成功後才會去讀 regs，確保有報到者都被收進賽程。
          //   (B) 防重疊 tick 重複 seed：只有成功把 checkin→bracket_ready 的那次 tick 繼續（matchedCount===1）；
          //       其餘 tick 看到 status 已非 checkin → matchedCount===0 → return，避免 deleteMany+重洗重配洗掉賽程。
          const _claim = await TEVENTS.updateOne({ _id: ev._id, status: 'checkin' }, { $set: { status: 'bracket_ready', bracketReadyAt: now } });
          if (!_claim || _claim.matchedCount !== 1) return;
          const r = await seedEventBracket(ev, { checkedInOnly: true, immediateEnter: true });
          if (r.retry) return;  // R2：去重查詢失敗 → 保留 bracket_ready，由 R3 回收重試
          if (r.alreadySeeded) return;  // R1b：已被其他路徑 seed → 靜默(不重排/不取消)
          if (r.ok) {
            await postSystemChat('⚔️ 報到結束！依 ' + r.players + ' 名已報到者產生賽程，第 1 輪開始，可直接進場！');
          } else if (r.conflictBelowMin) {
            // C1：多數報到者仍在其他進行中賽事被移除、可出賽者不足 → 取消(不發不戰而冠)
            await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', cancelled: true, championUid: null, championName: null } });
            await recordTournamentArchive(ev);
            await postSystemChat('🚫 「' + ev.name + '」多數選手仍在其他進行中的賽事，可出賽人數不足，本場取消（待其他賽事結束後可另行開賽）。');
          } else {
            const checked = await TREGS.find({ eventId: ev._id, checkedIn: true }).toArray();
            if (checked.length === 1) {
              await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', championUid: checked[0].uid, championName: checked[0].name } });
              await recordChampion(ev, checked[0].uid, checked[0].name);
              await recordTournamentArchive({ ...ev, championUid: checked[0].uid, championName: checked[0].name });
              await postSystemChat('🏆 僅 1 人報到，「' + (checked[0].name || '?') + '」直接獲得冠軍！');
            } else {
              await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', championUid: null, championName: null } });
              await recordTournamentArchive(ev);
              await postSystemChat('⚠️ 報到人數不足 2 人，賽事取消。');
            }
          }
          return;
        }
        // v0.85 推播②：本輪可進場（enterOpenAt 已到、尚未進場者）。每場每人各一次，用 enterPushedAt 去重。
        //   放在未進場判負之前：這正是「休息倒數結束、該進場了」的時刻。
        if (_webpush && ev.status === 'running' && ev.roundStartedAt) {
          try {
            const _cdM = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
            const _openAt = ev.roundStartedAt + _cdM * 60000;
            if (now >= _openAt) {
              const _due = await TMATCH.find({
                eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' },
                p1uid: { $ne: null }, p2uid: { $ne: null }, enterPushedAt: { $exists: false },
              }).toArray();
              for (const m of _due) {
                // 原子搶占：只有搶到的 tick 會推，避免重疊 tick 重複推播
                const _claim = await TMATCH.updateOne({ _id: m._id, enterPushedAt: { $exists: false } }, { $set: { enterPushedAt: now } });
                if (!_claim || _claim.modifiedCount !== 1) continue;
                const _e0 = !!(m.entered && m.entered[0]), _e1 = !!(m.entered && m.entered[1]);
                const _targets = [];
                if (!_e0 && m.p1uid) _targets.push({ uid: m.p1uid, opp: m.p2name });
                if (!_e1 && m.p2uid) _targets.push({ uid: m.p2uid, opp: m.p1name });
                for (const t of _targets) {
                  sendPushToUids([t.uid], {
                    title: '⚔️ 第 ' + m.round + ' 輪可進場' + (t.opp ? '｜對手：' + t.opp : ''),
                    body: '點此進入對戰。未在時限內進場將被判負。',
                    tag: 'ptcg-t-enter-' + m._id,
                    requireInteraction: true,
                  });
                }
              }
            }
          } catch (e) { /* 推播失敗不影響賽事 */ }
        }
        // 未進場判負：倒數(roundCountdownMin)+遲到容許(noShowMin) 過後，本輪未進場者判負
        if (ev.status === 'running' && ev.roundStartedAt) {
          const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
          // ⭐⭐⭐v6.214②：與 /event 回給玩家的倒數共用同一支 noShowGraceMin ＋ 同一份設定。
          //   ⚠ 讀設定失敗 ⇒ 傳 null ⇒ 回 base（＝ v6.213 的 5 分鐘）＝**比較寬鬆**的方向，
          //     絕不會因為設定讀不到而把人提早判負。
          let _nsTune = null;
          try { _nsTune = await noShowConfig(); } catch (e) { /* 用 base */ }
          const nsMin = noShowGraceMin(ev.noShowMin, _nsTune);
          const deadline = ev.roundStartedAt + (cdMin + nsMin) * 60000;
          if (now > deadline) {
            const pend = await TMATCH.find({ eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null } }).toArray();
            for (const m of pend) {
              let e0 = !!(m.entered && m.entered[0]), e1 = !!(m.entered && m.entered[1]);
              // v0.56 防呆：對局若其實已開打(房間 gameState 進入 playing/game-over = 雙方都完成 setup 確實到場)，
              //   不可因 entered 旗標異常而誤判未進場(根因已於進場端原子化修正，此為第二道保險)。
              if ((!e0 || !e1) && m.roomId) {
                try { const _rm = await TROOMS.findOne({ _id: m.roomId }, { projection: { 'gameState.phase': 1 } }); const _ph = _rm && _rm.gameState && _rm.gameState.phase;  /* v6.119：這裡是純讀（只看 phase、不寫回），可安全 projection；下面設 game-over 的那次仍讀完整 doc */ if (_ph === 'playing' || _ph === 'game-over') { e0 = true; e1 = true; } } catch (e) { /* best-effort */ }
              }
              if (e0 && e1) continue; // 雙方都進場 = 對戰中，不判負
              if (e0 || e1) {
                const wUid = e0 ? m.p1uid : m.p2uid, wName = e0 ? m.p1name : m.p2name, lName = e0 ? m.p2name : m.p1name;
                await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', noShow: true } });
                // v0.34：勝方已進場(卡在 setup 等待)→把房間設 game-over 讓勝方看到勝利畫面 + 返回賽事大廳
                if (m.roomId) { try { const room = await TROOMS.findOne({ _id: m.roomId }); if (room && room.gameState && room.gameState.phase !== 'game-over') { const winSeat = e0 ? 0 : 1; const og = JSON.parse(JSON.stringify(room.gameState)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '對手') + ' 未進場，判定你獲勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } } catch (e) { /* best-effort */ } }
                await postSystemChat(swissPhase(ev) ? ('⏰ ' + (lName || '一方') + ' 未進場，本場由 ' + wName + ' 獲勝（瑞士制：雙方仍繼續後續輪次）。') : ('⏰ ' + (lName || '一方') + ' 未進場判負，' + wName + ' 獲勝。'));
                await advanceOrFinish(m, wUid, wName);
              } else {
                await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, doubleNoShow: true } });
                await postSystemChat(swissPhase(ev) ? '⏰ 本場雙方皆未進場，以雙敗處理（瑞士制：雙方仍可繼續比賽）。' : '⏰ 本場雙方皆未進場，雙淘汰，無人晉級。');
                await checkRoundAdvance(ev._id);
              }
            }
          }
        }
        // 閒置判負：對局中(雙方都已進場)，輪到動作的一方逾 idleForfeitMin(預設3)分鐘無動作 → 判負(含斷線)。
        if (ev.status === 'running') {
          const idleMin = (ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3);
          const playingI = await TMATCH.find({ eventId: ev._id, status: 'playing', roomId: { $ne: null } }).toArray();
          for (const m of playingI) {
            // ── v6.119 降載：先用「輕量讀」判掉「還沒到閒置門檻」的絕大多數情況 ──────────
            //   以前每 30 秒對**每一場** playing match 都整份 TROOMS doc 拉出來（gameState 的 log
            //   佔約 73%），只為了算 currentActorSeat。30 人賽 ≈ 15 場 × 每 30 秒 × 數百 KB。
            //   ⚠⚠ **不能**直接對下面那個 findOne 加 projection：判負分支會
            //     `JSON.parse(JSON.stringify(gs))` 整包寫回（見下方 og），projection 過的殘缺盤面
            //     寫回去會把 log 永久洗掉 → 投降/閒置場的回放（靠房間 gameState.log fallback）會壞。
            //   所以改成兩段式：輕量讀只做門檻判斷，**過了門檻才走原本一字未改的完整路徑**，
            //   判負與否的每一個決策仍由完整 doc 決定 ⇒ 零行為變更。
            //   門檻判斷用的 fallback 鏈與下面的 `last` 逐字相同；_light 為 null（房不見了）就
            //   直接落到完整讀，由原本的 `!gs → continue` 處理。
            const _light = await TROOMS.findOne({ _id: m.roomId }, { projection: { lastActionAt: 1, updatedAt: 1, 'gameState.phase': 1 } });
            // ── ⭐⭐⭐v6.212 GAMEOVER RECONCILE BLOCK BEGIN（level-triggered 對帳）──────
            //   /action 只在**那一次請求**裡呼叫 onMatchGameOver，而且外面包著 try/catch
            //   只印一行 warn 就吞掉（edge-triggered）。它一旦拋錯，對戰紀錄就永遠停在
            //   status:'playing' —— /event 的 myMatch 是用 status:{$ne:'done'} 濾的，
            //   於是玩家明明贏了，大廳還是一直畫著「⚔️ 回到對戰」，而且沒有任何人會再試一次。
            //   下一輪也不會排（checkRoundAdvance 要本輪全部 done）＝「新一輪等很久」。
            //   ⇒ 比照 v6.157 的做法改成 level-triggered：每次掃描都拿「房間實際 phase」
            //     跟「對戰紀錄 status」對帳，對不上就**補跑一次** onMatchGameOver（它本身
            //     對 m.status==='done' 冪等，補跑不會重複結算）。
            //   ⚠ 這裡的 projection 只是**純讀**（判 phase），不會被寫回；下面判負分支要整包
            //     寫回的那個 findOne 仍然讀完整 doc（v6.119 的注意事項）。
            //   ⚠ 房間已 game-over 卻沒有勝方（平手／系統死角）：那些路徑都會自己寫 TMATCH，
            //     走到這裡代表資料不一致，**不自作主張判勝負**，只出聲讓站長看得到。
            if (_light && _light.gameState && _light.gameState.phase === 'game-over') {
              const _rcRoom = await TROOMS.findOne({ _id: m.roomId });
              const _rcGs = _rcRoom && _rcRoom.gameState;
              if (_rcGs && _rcGs.phase === 'game-over') {
                if (_rcGs.winner === 0 || _rcGs.winner === 1) {
                  try {
                    await onMatchGameOver(_rcRoom, _rcGs);
                    console.warn('[tournament] \u2699 對帳：房間已 game-over 但對戰仍是 playing → 補跑結算 match=' + m._id);
                  } catch (_rcE) {
                    console.warn('[tournament] \u26a0 對帳補跑結算失敗 match=' + m._id + ' :: ' + (_rcE && _rcE.message));
                  }
                } else if (!global.__ptcgReconcileNoWinnerWarned) {
                  global.__ptcgReconcileNoWinnerWarned = true;
                  console.warn('[tournament] \u26a0 房間已 game-over 且無勝方，但對戰仍是 playing（需人工確認）match=' + m._id);
                }
              }
              continue;   // 已結束的房間本來就不進閒置判負（原本由下方 gs.phase==='game-over' 的 continue 處理）
            }
            // ── ⭐v6.212 GAMEOVER RECONCILE BLOCK END ──────────────────────────────
            if (_light) {
              const _lastLight = _light.lastActionAt || _light.updatedAt || m.gameStartedAt || now;
              await maybeIdleWarn60(m, idleMin, now, _lastLight);   // v6.151 判負前 60 秒警告（只在最後 60 秒才讀完整 doc）
              if (now <= _lastLight + idleMin * 60000) continue;
            }
            const room = await TROOMS.findOne({ _id: m.roomId });
            const gs = room && room.gameState;
            if (!gs || gs.phase === 'game-over') continue;
            const last = room.lastActionAt || room.updatedAt || m.gameStartedAt || now;
            if (now <= last + idleMin * 60000) continue;
            // ── ⭐v6.157 SETUP ADVANCE BLOCK BEGIN（開局死角的 level-triggered 補推）──────────
            //   engine 的 tryAdvanceToPlaying 是 setup→playing 五個條件的守門員，但它是
            //   **edge-triggered**：只在 applyAction 的 4 個 handler 結尾被呼叫。當「讓條件湊齊的
            //   最後一筆狀態變化」走的是不呼叫它的路徑（線上 setup 合併 mergeSetupMonotonic／
            //   CAS 寫回／版本 skew 補寫），而兩位玩家都以為在等對方、不會再送任何 action，
            //   ⇒ **永遠沒有人來推它**，房間一路停在 setup 直到被閒置掃描判掉。
            //   ⇒ 掃到 setup 房就自己跑一次（level-triggered）。
            //   ⚠ 這不是繞過規則：條件沒滿足時 tryAdvanceToPlaying **原樣回傳**（冪等、安全），
            //     所以推不動的情況行為與本版之前一字不差（照樣落到下面的 pending-admin 分支）。
            //   ⚠ fail-open：舊的 server-engine.cjs 還沒 export tryAdvanceToPlaying（要跑
            //     update-tournament.bat 重建）。比照 validateDeck 的既有寫法判型別後跳過，
            //     但**必須出聲**（v3.84／v6.130 教訓：沒有訊號就沒有人會發現功能其實沒開）。
            //     只 warn 一次：伺服器引擎是所有對局共用，每 30 秒對每一場印一行會灌爆 pm2 log
            //     （v5.636 就是這樣把 error.log 灌爆的）。
            if (gs.phase === 'setup') {
              if (typeof TENG.tryAdvanceToPlaying !== 'function') {
                if (!global.__ptcgSetupAdvanceWarned) {
                  global.__ptcgSetupAdvanceWarned = true;
                  console.warn('[tournament] \u26a0 目前的 server-engine.cjs 沒有 tryAdvanceToPlaying'
                    + ' \u2192 開局死角自動補推停用。請跑 update-tournament.bat 重建 bundle。');
                }
              } else if (typeof room.version === 'number') {
                let advanced = null;
                try { advanced = TENG.tryAdvanceToPlaying(gs); }
                catch (e) { console.warn('[tournament] setup 補推失敗:', e && e.message); }
                // ⚠ 判「有沒有真的推進」用 phase，不用物件同一性：條件不滿足時引擎回傳的是**同一個**
                //   state 參考，但未來若改成回淺拷貝，比同一性就會靜默失效（v6.148 gate⑤b 的教訓）。
                if (advanced && advanced.phase === 'playing') {
                  const og = JSON.parse(JSON.stringify(advanced));
                  if (!Array.isArray(og.log)) og.log = [];
                  og.log.push({ turn: og.turn || 0, playerIndex: null, timestamp: now,
                    message: '\u2699\ufe0f 雙方都已完成準備，但盤面沒有自動開始 \u2192 由伺服器接手推進到對戰階段。' });
                  // ⚠⚠ 必須 CAS（同 v6.151 idleWarn60）：這是**非終局**的整包寫回。讀 doc 到寫回之間
                  //   玩家可能剛好送出動作，沒有 CAS 會把它整個蓋掉，**而且版本號一樣**（都是
                  //   room.version + 1）⇒ client 的 ?v=cv 版本比對全回 unchanged、自癒完全失效。
                  //   CAS 未命中 ⇒ 盤面本來就在動 ⇒ 這一場根本不是死角，下一輪掃描再說。
                  // ⚠ lastActionAt **一定要更新**：剛把行動權交給先手方，閒置倒數必須從現在重新起算，
                  //   否則 30 秒後的下一輪掃描會拿「卡住那段時間」直接把剛拿到行動權的人判負。
                  const _adv = await TROOMS.updateOne({ _id: m.roomId, version: room.version },
                    { $set: { gameState: og, version: room.version + 1, updatedAt: now, lastActionAt: now, actorSeat: currentActorSeat(og) } });
                  if (_adv && _adv.matchedCount > 0) {
                    await postSystemChat('\u2699\ufe0f 第 ' + m.round + ' 輪 ' + (m.p1name || 'P1') + ' vs ' + (m.p2name || 'P2')
                      + '：雙方都已完成準備、盤面卻沒有自動開始，已由伺服器推進到對戰階段，請雙方回到對戰。');
                  }
                  // ⚠ 本輪**不判任何人輸贏**：行動權才剛給出去，要重新給滿一整個閒置時限。
                  continue;
                }
              }
            }
            // ── ⭐v6.157 SETUP ADVANCE BLOCK END ──
            const actor = currentActorSeat(gs);
            // v0.67 進場門檻：一般情況(對局中/雙方都該動)仍要求「雙方都已進場」才判(單方未進場由未進場判負處理)。
            //   setup 階段例外——只要「該鋪場/該準備的一方」逾時未動作、且【對手已進場】(在線空等)，
            //   即使該動作方尚未按「進入對戰」也判其敗。修丞龍 vs 承瀚：承瀚 setup 掛著卻因原 both-entered
            //   gate 逃過 3 分鐘閒置、只受 8 分鐘未進場保護→在線的丞龍空等、之後輪到自己反被判。
            //   註：currentActorSeat 於 setup 一律回傳「尚未完成 setup 的那方」，故被判者必為掛著方、非在線方。
            const e0 = !!(m.entered && m.entered[0]), e1 = !!(m.entered && m.entered[1]);
            let allowJudge = e0 && e1;
            if (!allowJudge && gs.phase === 'setup' && (actor === 0 || actor === 1)) {
              const oppEntered = actor === 0 ? e1 : e0; // 對手(勝方)在線
              if (oppEntered) allowJudge = true;
            }
            if (!allowJudge) continue;
            if (actor === 0 || actor === 1) {
              const winSeat = 1 - actor;
              const wUid = winSeat === 0 ? m.p1uid : m.p2uid, wName = winSeat === 0 ? m.p1name : m.p2name, lName = actor === 0 ? m.p1name : m.p2name;
              await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', idleForfeit: true } });
              try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = (lName || '一方') + ' 閒置逾 ' + idleMin + ' 分鐘判負，' + wName + ' 勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
              await postSystemChat(swissPhase(ev) ? ('⏰ ' + (lName || '一方') + ' 閒置逾 ' + idleMin + ' 分鐘判負，本場由 ' + wName + ' 獲勝（瑞士制：雙方仍繼續後續輪次）。') : ('⏰ ' + (lName || '一方') + ' 閒置逾 ' + idleMin + ' 分鐘判負，' + wName + ' 獲勝。'));
              await advanceOrFinish(m, wUid, wName);
            } else if (actor === -1) {
              // ⭐v6.156 站長裁定③：setup 階段**雙方都已按過準備、卻誰也推不動**的死角，
              //   不是「兩個人都在掛機」而是系統把局面卡住了 —— 用雙敗處理等於處罰兩個無辜的人。
              //   ⇒ 改判**平手**（winnerUid: null + draw），並在聊天室請站長人工裁定。
              //   ⚠ 刻意**不重用** doubleNoShow：那個旗標在賽果頁與歸檔裡的語意是「兩人都沒出現」，
              //     混用會讓事後對帳分不出「掛機」與「系統卡住」。
              const _sd = gs.setupDone || [];
              const _deadlock = gs.phase === 'setup' && !!_sd[0] && !!_sd[1];
              // ⚠⚠ Fable 5 審查（嚴重）：死角場**不能**設成 status:'done' ——
              //   `admin/match/resolve` 開頭就 `if (m.status === 'done') return 409`，
              //   `admin/pending-matches` 也只列 `status: { $ne: 'done' }` ⇒ 設成 done 之後
              //   這場既不會出現在待裁定清單、也無法被裁定端點改判，「請站長人工裁定」
              //   會變成純文案，實質仍是雙淘汰。
              //   ⇒ 用 **'pending-admin'**：閒置／時限掃描都只找 `status: 'playing'`，不會再重複觸發；
              //     pending 清單（$ne 'done'）會列出它；resolve（status 非 done）可以裁定。
              await TMATCH.updateOne({ _id: m._id }, { $set: _deadlock
                ? { status: 'pending-admin', winnerUid: null, draw: true, deadlockDraw: true, deadlockAt: now }
                : { status: 'done', winnerUid: null, doubleNoShow: true } });
              try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = null; og.winReason = _deadlock ? '雙方皆已完成準備卻無人可行動（系統死角），本場改判平手，待站長人工裁定' : ('雙方皆閒置逾 ' + idleMin + ' 分鐘，雙淘汰'); await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
              await postSystemChat(_deadlock ? ('\u2696\ufe0f 第 ' + m.round + ' 輪 ' + (m.p1name || 'P1') + ' vs ' + (m.p2name || 'P2') + '：雙方皆已完成準備卻無人可行動（系統死角），本場暫記**平手**並保留給管理員裁定 —— 請到 admin 的「待裁定場次」處理，處理完賽程才會往下走。') : (swissPhase(ev) ? ('⏰ 本場雙方皆閒置逾 ' + idleMin + ' 分鐘，以雙敗處理（瑞士制：雙方仍可繼續比賽）。') : ('⏰ 本場雙方皆閒置逾 ' + idleMin + ' 分鐘，雙淘汰，無人晉級。')));
              // ⚠ 死角場**不推進輪次**：它還沒有結果，等站長裁定完由 resolve 那條路徑推進。
              //   （單淘汰下若照推，這兩個人會直接從賽程消失。）
              if (!_deadlock) await checkRoundAdvance(ev._id);
            }
          }
        }
        // v0.44 對局時限：官方「打完剩餘回合」制 + 平手自動判雙敗。
        //   時間到先標記、進行最後回合；打到「後攻方結束他的下一個回合」(gs.turn 前進過時間到當下值)才比獎賞。
        //   turn 只在後攻方 END_TURN +1 → 「gs.turn > timeLimitTurn」同時涵蓋官方兩情況：
        //   (a)先攻方回合喊停→先攻打完+後攻補一完整回合；(b)後攻方回合喊停→後攻打完即可。免追蹤誰先攻。
        if (ev.status === 'running') {
          const limitMin = (ev.roundLimitMin > 0 ? ev.roundLimitMin : 25);
          const playing = await TMATCH.find({ eventId: ev._id, status: 'playing', roomId: { $ne: null }, gameStartedAt: { $ne: null } }).toArray();
          for (const m of playing) {
            if (now <= m.gameStartedAt + limitMin * 60000) continue;
            // ── v6.120 降載：兩段式讀取（同 v6.119 閒置判負的做法）─────────────────────
            //   時限一到，**該輪還在打的每一場**都會走到這裡，每 30 秒各拉一份完整 gameState
            //   （log 佔約 73%）。而絕大多數 tick 只是在等「後攻方結束他的下一個回合」，
            //   判斷只需要 phase 與 turn 兩個純量。
            //   ⚠⚠ **不能**直接對下面那支 findOne 加 projection：底下三個判定分支都會
            //     `JSON.parse(JSON.stringify(gs))` 把盤面整包 `$set` 回去，殘缺盤面寫回會永久
            //     洗掉 log（回放靠它）。所以只加「輕量早退」，**過了早退就走原本一字未改的完整讀取**，
            //     真正的判定（平手/比獎賞/標記時限）全部仍由完整 doc 決定 ⇒ 零行為變更。
            //   早退條件與下面原本的 continue 條件逐字對應：
            //     (a) 房間不存在 / 無盤面 / 已 game-over → 原本就 continue
            //     (b) 已標記時限、且最後回合還沒打完 → 原本就 continue
            //   `_lt` 為 null（房間不見了）也直接 continue，等同原本 `!gs → continue`。
            const _lt = await TROOMS.findOne({ _id: m.roomId }, { projection: { 'gameState.phase': 1, 'gameState.turn': 1 } });
            const _ltgs = _lt && _lt.gameState;
            if (!_ltgs || _ltgs.phase === 'game-over') continue;
            if (m.timeLimitReached && typeof _ltgs.turn === 'number' && _ltgs.turn <= (m.timeLimitTurn || 0)) continue;
            const room = await TROOMS.findOne({ _id: m.roomId });
            const gs = room && room.gameState;
            if (!gs || gs.phase === 'game-over') continue;
            // 第一次到時限 → 標記 + 記下當下 turn，進行最後回合（不立即比、不動盤面，避免干擾雙方出招的版本 CAS）
            if (!m.timeLimitReached) {
              const turnAtCall = (typeof gs.turn === 'number') ? gs.turn : 0;
              await TMATCH.updateOne({ _id: m._id }, { $set: { timeLimitReached: true, timeLimitTurn: turnAtCall, timeLimitCalledAt: now } });
              await postSystemChat('⏰ 「' + m.p1name + ' vs ' + m.p2name + '」對局時限(' + limitMin + '分)到！進行最後回合：後攻方結束他的下一個回合後，依雙方剩餘獎賞卡判定。');
              continue;
            }
            // 最後回合尚未打完（後攻方還沒結束他的下一個回合）→ 繼續等
            if (typeof gs.turn === 'number' && gs.turn <= (m.timeLimitTurn || 0)) continue;
            // 最後回合已結束 → 依剩餘獎賞卡判定
            const p0rem = ((gs.players[0] && gs.players[0].prizes) || []).length;
            const p1rem = ((gs.players[1] && gs.players[1].prizes) || []).length;
            if (p0rem === p1rem) {
              // 平手 → 自動判雙敗（雙方淘汰，不需管理員）。bracket 對「無 winner 場」天生支援：兩人皆不晉級、下一輪對手輪空。
              await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, winnerName: null, timeLimit: true, draw: true, endedAt: now } });
              try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = null; og.winReason = '對局時限到，最後回合結束後雙方剩餘獎賞卡相同 → 自動判雙敗（雙方淘汰）'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
              await postSystemChat('⏰ 對局時限到，最後回合結束後仍平手 → 自動判雙敗，雙方淘汰（下一輪對手輪空）。');
              await advanceOrFinish(m, null, null);
              continue;
            }
            const winSeat = (p0rem < p1rem) ? 0 : 1;
            const wUid = winSeat === 0 ? m.p1uid : m.p2uid, wName = winSeat === 0 ? m.p1name : m.p2name;
            await TMATCH.updateOne({ _id: m._id }, { $set: { winnerUid: wUid, winnerName: wName, status: 'done', timeLimit: true, endedAt: now } });
            try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = winSeat; og.winReason = '對局時限到（最後回合結束），依取得獎賞卡數判定（取得較多者勝）：' + wName + ' 勝'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
            await postSystemChat('⏰ 對局時限到（最後回合結束）：' + wName + ' 取得的獎賞卡較多（剩餘較少），獲勝。');
            await advanceOrFinish(m, wUid, wName);
          }
        }
    }
    // v0.58 清掉「已結束賽事底下、沒打完(非 done)的對戰」殘留。這種 pending 對戰在賽事 finished 後
    //   不再被排程器處理(listOpenEvents 排除 finished)，但會一直被監控算成「等開打」且累積成死資料。
    //   定期掃(每~5分)刪除，涵蓋所有結束路徑+自動清歷史殘留。賽事歸檔(recordTournamentArchive)在
    //   finish 當下已快照，故刪除 live TMATCH 殘留不影響歷史。
    let _lastStaleMatchSweepAt = 0;
    async function sweepFinishedEventLeftoverMatches() {
      const finished = await TEVENTS.find({ status: 'finished' }).toArray();
      if (!finished.length) return;
      const ids = finished.map((e) => e._id);
      const r = await TMATCH.deleteMany({ eventId: { $in: ids }, status: { $ne: 'done' } });
      if (r.deletedCount) console.log('[stale-match-sweep] 清掉已結束賽事殘留的未完成對戰 ' + r.deletedCount + ' 筆');
    }
    async function tournamentSchedulerTick() {
      try {
        const evs = await listOpenEvents();
        for (const ev of evs) {
          try { await _processEventTick(ev); }
          catch (e) { console.warn('[tournament] event tick failed:', ev && ev._id, e && e.message); }
        }
      } catch (e) { console.warn('[tournament] scheduler tick failed:', e && e.message); }
      // v0.57 順帶定期修剪大廳聊天（每 ~5 分鐘一次，避免無限長大拖慢 /chat）
      if (Date.now() - _lastChatPruneAt > 5 * 60000) { _lastChatPruneAt = Date.now(); try { await pruneLobbyChat(); } catch (e) { /* best-effort */ } }
      // v0.58 順帶清掉已結束賽事殘留的未完成對戰（避免一直被算成「等開打」死資料 + 累積）
      if (Date.now() - _lastStaleMatchSweepAt > 5 * 60000) { _lastStaleMatchSweepAt = Date.now(); try { await sweepFinishedEventLeftoverMatches(); } catch (e) { /* best-effort */ } }
    }
    // v0.70：重入鎖——tick 內若有 DB 慢查詢,setInterval 不等前次完成→避免兩 tick 重疊造成不同賽事並發 seed
    //   (v0.46 CAS 只防同場;並發 seed 會讓 seed 前去重的 TMATCH 判據誤判)。單一 in-flight。
    let _schedTicking = false;
    setInterval(async () => {
      if (_schedTicking) return;
      _schedTicking = true;
      try { await tournamentSchedulerTick(); } catch (e) { /* tick 內各步驟已自帶 try/catch */ } finally { _schedTicking = false; }
    }, 30000);
    console.log('[tournament] endpoints registered: join/state/action/reset + event/register/unregister + chat + bracket/seed/match-enter + admin event/chat');
  } catch (_te) {
    console.warn('[tournament] init failed → 錦標賽停用；⚠ 休閒閒置自動判負也住在這個區塊內，會一併停用（其餘正常對戰/admin 不受影響）:', _te && _te.message);
  }
})();

// === ORACLE ADMIN PATCH END ===
// 上面這行是 oracle_admin_update.sh 用的 patch 結尾標記，請勿刪除。
// install script 會 strip 從 patch 起點 marker 到本 END marker 之間的全部內容，
// 避免歷史殘留 IIFE 堆疊。（起點 marker 名字故意不寫在這裡，避免 sanity check 誤把
// 註解內的字串提及當成第 2 個真實 marker — v0.82 修。）
