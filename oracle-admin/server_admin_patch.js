// === ORACLE ADMIN ENDPOINTS === v1.02 (修「點了支援型寶可夢卻沒從未分類清單消失」:真根因在前端 —— POST /admin/support-pokemon **漏帶 Content-Type: application/json**(全站 20 個 POST 只有這 2 個漏),express.json() 因此不解析 body → 後端 req.body.names 不是陣列 → 舊寫法『不是陣列就當空陣列』**靜默把整份清單存成空的、還回 ok:true**,使用者只看到「點了沒反應」且完全查不出原因。後端改為:body 未被解析 / names 不是陣列一律回 400 並講明原因 —— 「使用者要清空」送空陣列,與「body 沒收到」必須分得出來;前端則在 api() 統一自動補 header(字串 body 才補,FormData 不能碰)) + v1.01 (hotfix:牌組原型統計一按就『getCardNameMap is not defined』——v1.00 新增的 getPokemonNameSet() 定義在所有 IIFE 之外,但它呼叫的 getCardNameMap 當時還關在 registerStatsEndpoints 的 IIFE 內,外層看不到 → 整個 deck-archetype-stats 端點 500。把 getCardNameMap + _cardNamePromise 一起移到外層(IIFE 內原有 caller 靠閉包仍讀得到,與 v0.94 同一手法)。⚠這是 v0.94 的鏡像事故:當時是『helper 在 IIFE 內、caller 在外』,這次是『helper 在外、它依賴的東西在 IIFE 內』。node --check 只驗語法、既有守衛只逐一點名少數 helper,兩者都抓不到 → 本版把守衛改成**通用**掃描:凡定義在 IIFE 外的函式,其呼叫到的本檔函式必須也在外層可見) + v1.00 (牌組原型「未分類高頻卡」只列**寶可夢**+可維護的「支援型寶可夢」排除清單:原本把老大的指令/莉莉艾的決意/基本能量這些每副牌都有的通用卡也列進去,對「該開什麼新規則」毫無鑑別度。①卡片屬性表補 isPokemon(⚠supertype 值是 'Pokemon' **沒有重音**,寫成 'Pokémon' 會整份比不中變空清單) ②新增 getPokemonNameSet() 把 cardId→卡名 與 cardId→屬性 接起來(cardFreq 的 key 是卡名不是 cardId) ③新 collection deckRuleSettings 存支援型清單(吉雉雞ex/喵喵ex 這類功能性寶可夢同樣沒有鑑別度),存 mongo 而非寫死因為環境會變 ④端點 GET/POST /admin/support-pokemon,改清單即清統計快取。⚠**先過濾再 slice(20)**——反過來會先被通用卡佔滿名額) + v0.99 (Wilson 更正 v0.98 的選擇:社群賽開辦通知**跳過正在對戰中的玩家**。新增 getBusyUids() 同時查錦標賽 TMATCH(status:playing 的 p1uid/p2uid)與休閒 rooms(status:playing 的 memberUids/hostUid);⚠休閒房必須加 updatedAt 15 分鐘時間窗——status:'playing' 會有殭屍殘留(startZombieRoomCleanup 正在清的就是這種),不加時間窗的話一個幾天前卡住的房間會讓那兩位玩家從此永遠收不到通知。broadcastPush 的 excludeUid/excludeUids 合併成單一 $nin 避免條件互相覆蓋) + v0.98 (社群賽開辦通知:玩家發起社群賽時廣播推播給全站(排除發起者本人、已關閉此類通知者不推)。新增 broadcastPush(推給所有訂閱者,對比 sendPushToUids 是推給指定 uid)+ /push/prefs 端點(偏好**必須存伺服器**——推播是伺服器主動發的,只存 localStorage 沒有意義;同一玩家多裝置用 updateMany 一次更新,偏好是人層級不是裝置層級)。⚠欄位缺席視為開啟($ne:false),因 Wilson 裁定新通知預設開,否則既有訂閱者全部收不到=功能等於沒上線。單次推播 cap 500 防訂閱數暴增時送爆) + v0.97 (Wilson 裁定取消社群賽發起者冷卻:原本的 30 分鐘冷卻其實從未生效——判斷依據 myLast[0].finishedAt,但全檔 12 個 status:'finished' 的寫入點沒有任何一處寫過 TEVENTS.finishedAt,線上行為一直都是沒有冷卻。整段移除讓程式碼與實際一致,不留誤導人的死碼;濫用防護仍靠「全站同時僅 1 場社群賽」) + v0.96 (修 admin 賽事統計的『官方賽/社群自辦賽』篩選完全無效——每一場都被歸成官方賽:/api/tournament/admin/stats 的 archives.map **沒有把 communityEvent 回傳給前端**(歸檔本身有存),前端拿到 undefined 自然全判官方。一併補回 format。通則:新增前端篩選條件時必須回頭確認端點有回傳該欄位,已加資料契約守衛) + v0.95 (玩家帳號改「伺服器一次撈完＋5分鐘快取＋single-flight」端點 /firebase/users-all:原本前端自己跑 while(pageToken) 迴圈、每頁還只抓 100 筆,帳號一多就是十幾次瀏覽器↔VM↔Firebase 往返 → 載入極慢;伺服器端單頁可抓 1000 筆且與 Firebase 延遲低一個量級。這同時根治「名單重複顯示」:前端兩條路徑(primeEmailMap 背景預熱 + loadUsers)各自寫 allUsers 又不共用 guard,先開房間分頁再進玩家帳號必定整批 concat 兩次) + v0.94 (hotfix:buildCasualCleanFilter/getCardAttrMap 兩個 helper 誤放進 registerMatchRecords 的 IIFE 內,而牌組原型【統計】與【明細】兩個端點在該 IIFE 之外 → 一點就 ReferenceError『buildCasualCleanFilter is not defined』。移到 IIFE 之前的外層(IIFE 內既有 caller 靠閉包仍讀得到)。⚠node --check 只驗語法、單元測試只抽函式文字執行,兩者都抓不到跨 closure 的作用域問題;已補結構守衛斷言 helper 必須定義在 IIFE 之外) + v0.93 (Wilson 拍板:牌組原型多規則同時命中時改用【條件較嚴格者優先】自動判定,不必再手填優先序。嚴格度=includes+excludes+includeIds+excludeIds 的條件總數(更多約束=更特定=優先);優先序降為同嚴格度時的 tie-break、UI 隱藏但欄位保留。兩個統計端點新增 multiHit 計數(有幾副牌同時命中>=2條規則)——為 0 就代表規則本來就互斥、完全不用管優先序。⚠classifyDeck 是總表與明細共用的中央函式,兩者必須同版否則同一副牌會被分到不同原型) + v0.92 (牌組原型明細:GET /api/admin/deck-archetype-detail?ruleId= —— 點選原型後展開①代表 60 張(採用率排序+眾數張數+貪婪湊60,同名4張/ACE SPEC 1張上限,基本能量無上限)②只看獲勝場次的 60 張③【遺珠之憾】推薦。⭐遺珠指標**不是**沿用既有的全域卡牌勝率(那個被原型效應與玩家實力完全混雜、無法回答『這張卡值不值得放』),改用**同一原型內的條件勝率差**:含此卡的勝率 Wilson 90%單尾下界 − 不含此卡的勝率,自動壓抑小樣本;排除必含卡/基本能量/已進 60 張者,出現率窗口 8~60%、雙側樣本各 >=8。回應含 per-card n/inclusion/wr_with/wr_without 供人工判讀是否為子變體。單次掃描算完三塊,60s TTL 快取) + v0.91 (休閒統計淨化規則收斂 buildCasualCleanFilter 單一來源[原 regex 在 2.3 卡牌勝率與牌組原型統計各寫一份=漂移風險] + Wilson 拍板調整:『中途離開致勝』場改為【只排除 finalTurn<=2】,雙方各完成 2 個完整回合後(finalTurn>=3)的離開場仍納入統計——原本一律排除,會把「打到一半才斷線」的真實對局也丟掉。finalTurn 語義查證:engine 只在後攻結束回合時 +1,故 turn>=3 ⇔ 雙方各完成 2 回合) + v0.90 (玩家總覽補「曾使用過的暱稱」:跨四個來源彙整去重——休閒對戰顯示名(matchRecords 該側 name,用 $addToSet 併進既有 aggregate 零額外查詢)、錦標賽報名暱稱(TREGS)、賽事歸檔當時暱稱(TARCHIVE players[].name)、Firebase 帳號顯示名;每個暱稱標來源與最後使用時間,依最近使用排序) + v0.89 (admin 牌組原型統計:GET /api/admin/deck-archetype-stats?source=casual|tourn|all —— 依 deckRules 分類每一副牌,回每個原型的使用次數/勝/負/平/勝率+未分類彙總+未分類高頻主力卡(供 Wilson 就地開新規則)。休閒源 matchRecords 沿用既有淨化規則(只算有房號的對戰以排 AI/本機、排除中途離開致勝場、可設 since);錦標賽源 tournamentArchives(排除 bye/無勝方);兩者分開統計並排顯示。統計即時算+60s TTL 快取(規則一改即刻生效,免重算批次);比對走批次2 的同一份 deckMatchesRule 不另寫) + v0.88 (admin 牌組原型規則引擎:新 collection deckRules{name,includes[],excludes[],includeIds[],excludeIds[],priority,enabled} + CRUD + 命中預覽端點。規則以【卡名】比對(Wilson 拍板:同名 reprint 極多,用 cardId 每條規則要枚舉所有印刷版本且新卡一出就靜默失準),必要時可用 includeIds/excludeIds 鎖特定印刷版本。cardId→卡名對照從 tournament-pool.json lazy 載入(CJS/ESM 雙寫法,v0.75 教訓)。preview 端點對最近 N 場休閒對戰即時試算命中數,讓 Wilson 存檔前就發現打錯卡名。統計端點在批次3) + v0.87 (admin 玩家總覽:新增 GET /api/admin/player-profile?email= —— 一次回該玩家跨【休閒對戰(matchRecords)／錦標賽(tournamentArchives)／意見回饋(Firestore feedbacks)／儲存牌組數】的完整摘要,供 admin 任一頁點 email 直接開玩家檔案。四路平行查詢無 N+1、TARCHIVE 以 projection 排除 deckEntries 大欄位、per-email 30s 記憶體快取(比照 leaderboard 60s 先例);明細一律由既有端點懶載,不在此端點膨脹) + v0.86 (推播診斷+缺口修補:①GET push/status 回本人訂閱筆數/通道host/登記時間/現行VAPID公鑰前綴 ②POST push/selftest 由伺服器實際推一則給自己並回 per-endpoint statusCode(60s節流)——這兩支才能分清『訂閱沒登記到伺服器』與『有訂閱但推不到』 ③修缺口:admin 手動把賽事切到報到/進行中時,原本不推播、也不設 checkInDeadline/roundStartedAt(致報到階段永不結束、可進場推播與未進場判負全失效)→ 比照排程器自動轉換補齊 ④sendPushToUids 非404/410錯誤補 console.warn,不再全部靜默) + v0.85 (錦標賽推播通知 Web Push:只推②低頻事件[報到開始/本輪可進場],換手不推降載;web-push CJS/ESM 雙寫法+vapid.json 缺檔自動停用;訂閱端點 push/subscribe|unsubscribe|pubkey;失效訂閱 404/410 自動清;可進場用 enterPushedAt 原子搶占去重) + v0.84 (錦標賽:報名暱稱預填——/event 的 me 附上 lastName=最近一次報名暱稱[從已抓 myRegs 取最新,零額外查詢;從沒報過退帳號顯示名 id.name],前端未報名任何賽事時預填,免每次重打) + v0.83 (錦標賽對戰回放-半回合快照[Fable審補強:重賽deleteMany清舊快照/game-over不重存/濾舊格避混排/投降場finalLog+finalState讀房間fallback]+攤牌手牌獎賞+log逐步:snapshot 觸發由回合邊界改 activePlayerIndex 換手邊界=先攻/後攻各存一格+開局(setup→playing)格;key _t{turn}_p{active}唯一(與舊 _t{turn} 不衝突);新增 logLen 存 log 長度→前端逐步切片 finalLog 讓對戰log跟隨回放進度;/replay 依 logLen 排序回 activePlayerIndex+logLen) + v0.81 (錦標賽對戰回放-Phase1後端:①逐回合盤面快照存獨立 collection tournamentReplayTurns(不塞TMATCH避免既有無projection查詢讀放大;TTL 90天自動過期;冪等upsert;/action 回合邊界 fire-and-forget 不await;strip log佔73%,逐回合文字由finalLog供);②公開 GET /replay?matchId= 回 snapshots+finalLog+finalState(攤牌不redact手牌,Wilson決策;gate:賽事已歸檔或該場done才開放,比照match-log)。純新增,不動對戰/判負熱路徑讀取。前端回放檢視器Phase2另做) + v0.80 (錦標賽:每場比賽顯示觀戰人數——觀戰者輪詢 /spectate/state 當心跳,記錄 per-room distinct uid(8s內),/bracket 每場 playing match 即時算 viewers 回傳(不含2位對戰者,他們走/state);前端賽程表 VS👁 旁顯示(N)=N人觀戰中。純顯示,記憶體心跳 map 上限200房+lazy prune) + v0.79 (錦標賽:①/bracket 支援官方+社群賽並行——前端改每個進行中賽事各抓一次(帶eventId,伺服器本就 per-eventId 快取);②/bracket 每場 match 補 roomId(僅 status='playing' 才回,done/pending 回 null 免殘留)供前端把觀戰按鈕併入賽程表 VS(點 VS👁 即觀戰);移除獨立觀戰清單輪詢降載,/spectate/list 端點保留向後相容) + v0.78 (錦標賽:輪空(bye)玩家的大廳也顯示本輪進場倒數+可觀戰提示——/event 回應新增 myBye{round,enterOpenAt};僅在無 myMatch 時以單一 $in 查詢我本輪 bye match(status=done,bye,p1uid=我),讓輪空者知道其他對戰何時開打、可去觀戰。純顯示不影響配對/判負) + v0.77 (錦標賽:新增 client 端診斷回傳端點 /api/tournament/clientdiag——client 只在真異常指紋[隱形手牌/setup看門狗連續觸發/手動同步]才回傳一小包,寫 tournamentClientDiag[TTL 7天自動清];tournIdentity 驗證+per-uid 60s 記憶體節流+body 2KB cap+fail-silent,與對戰路徑完全隔離不影響) + v0.76 (錦標賽:非報名者(已登入)聊天暱稱改用【最近一次錦標賽報名的暱稱=個人資料分頁名稱】,不再顯示 email 帳號名;從沒報過賽事才退回 email 前綴;5分鐘記憶體快取避免每則訊息查 TREGS) + v0.75 (錦標賽:修 v0.72 gzip 從未生效根因——整段 patch 包在 import().then(async) 內=ESM host 無 require,v0.72 gzip 只用 require 載 compression 拋 require-is-not-defined 被吞→gzip 沒開;compression 套件其實已裝。修:改比照 TENG 的 try-require→catch-dynamic-import 雙寫法,ESM host 用 await import。裝後 JSON 壓 6~9× 降頻寬改善進場 lag) + v0.74 (錦標賽：修 setup 開局「一方 mulligan 補抽後加備戰(mpb)、對手還沒放出場」時 currentActorSeat 因 mpb 最優先誤把 mpb 擁有者當唯一該動作者→3分鐘誤判他閒置敗,且對手放置UI被誤 gate 掉→deadlock(信諺vs慶仔實例)。修:mpb 但對手未 setupDone→回 -1(雙方都可動作、閒置判負不單判、mpb 鍵與對手放置 UI 都啟用),對手已 setupDone 才由 mpb 擁有者單獨;前後端 setupActorSeat 逐行同步) + v0.73 (錦標賽：修「官方賽已淘汰出局的玩家卻無法報名新社群賽」——防同時被兩場召喚的衝突判據,由『在其他未結束賽事有任何對戰』收緊為『有【進行中(status!=done)】的對戰』;已出局者(對戰皆done)不算衝突,可正常報名新賽事;仍在比者維持原行為[移出新場、保留舊場],Fable 三輪審過的並行防護不動) + v0.72 (錦標賽降載:回應 gzip 壓縮(防呆 require compression,未裝自動略過;SSE/小回應不壓;瀏覽器自動解壓前端不用改)——盤面/大廳/聊天 JSON 壓 ~6-9×降頻寬;VM 需 npm install compression 才生效) + v0.71 (錦標賽降載:對戰 log 佔完整盤面~73%(長對局累積數百行);/state /action /spectate 回應只送最近 60 行 log(TROOMS 儲存盤面+finalLog 快照仍完整);前端動畫游標改用 timestamp 偵測新事件故截尾透明) + v0.70 (錦標賽：官方賽與社群賽改為可【並行】舉辦——移除 v0.45 全域自動順延+propose 的官方賽避讓(1h/進行中禁辦);為避免同一玩家被兩場同時召喚,改在 seedEventBracket 開賽配對前移除「已在開賽時間較早且未結束的其他賽事報到」的重複玩家(保留較早的、取消較晚的=本場),標 autoRemovedConflict+公告) + v0.69 (錦標賽降載續:/event(大廳最重端點,原每呼叫8~12次mongo含N+1)共用重查詢加 3s TTL 快取+per-user改批次查詢;/bracket 的 standings 重算(O(n²)OWP/OOWP)加 3s TTL 快取(per event,含20上限淘汰)——輪次交替 ~50 人同時回大廳打 /bracket 不再各自重算,只算一次;currentRound/status 變即失效;per-user mine 回應時再貼) + v0.68 (錦標賽降載+社群:①/state 端點加 client 版本比對(v=cv)——相符只回精簡 unchanged(免序列化/傳輸整個 gameState),先以 projection 排除 gameState 取輕量 doc 比版本,不同才第二次查完整盤面→對戰中每 1.2s×N 人輪詢大降 CPU/頻寬/mongo傳輸;②/spectate/state 同加版本比對(相符免深拷貝蓋手牌);③對戰中大廳聊天輪詢由每 1.2s 改每 ~6s(前端);④聊天室放寬:賽事期間只要已登入即可留言(不限報名者,未報名仍顯示暱稱);⑤社群賽避讓官方賽事的禁辦期由開賽前 2h 縮為 1h) + v0.67 (錦標賽：修 setup 階段閒置判負漏洞——閒置判負原要求「雙方都已進場」才判,但 setup 時若一方已進場鋪好場在線等待、另一方掛著卻還沒按「進入對戰」,該掛著方逃過 3 分鐘閒置判負、只受 8 分鐘未進場保護→在線方空等且輪到自己時反被判(丞龍 vs 承瀚 實例)。修:setup 階段只要「該動作方」逾時未動作且【對手已進場】即判該方敗(currentActorSeat 於 setup 一律回未完成 setup 那方,故被判者必為掛著方);對局中維持雙方都進場才判) + v0.66 (錦標賽：大廳聊天室懶載入——/chat 改成 since=0/初始回「最新」一頁(原回最舊80則要多輪才追到最新、費流量又慢)；新增 ?before=ts 上滑載更舊 + hasMore 旗標；前端預設只載最新一頁，滑到頂才續載舊訊息，省流量+載入快) + v0.65 (錦標賽：admin 編輯賽事設定新增「賽制」選項——可在開賽前(draft/registration)把單敗淘汰⇄瑞士制互改+設瑞士輪數/TopCut;已開賽則 disabled 且後端 gate 回 409(賽程已依賽制產生)。/event/update 接收 format/swissRounds/topCut) + v0.64 (錦標賽：/event/status 端點加防護——已開賽/已結束(checkin/bracket_ready/running/finished)的賽事禁止退回 draft/registration[會讓排程器因 registrationCloseAt 已過而重新產生賽程、刪掉進行中對戰並從第1輪重排,毀掉比賽];回 409 提示改用強制結束後重建。Wilson 手滑在進行中賽事按「開放報名」觸發) + v0.63 (錦標賽：勝負公告統一用「獲勝」取代「(自動)晉級」——因有瑞士制(無晉級/淘汰概念),投降/未進場/閒置/時限/管理員裁定的公告把「自動晉級」「勝出並自動晉級」改為「獲勝」,避免玩家誤會;瑞士制分支本就用獲勝) + v0.62 (錦標賽：setup『誰該動作』判定改成與實際 engine gating 一致——放出場階段依 PTCG 規則 mulligan 較少方先放+按準備(較多方需等),雙方都 setupDone 後才進揭示確認/補抽;修正 v0.60 用 mulligan 旗標判序錯誤,並讓前端 isMyTurn/提示共用同邏輯→提示與敗場判定一致) + v0.61 (錦標賽名人堂可看當初賽程：/champions 補回傳 eventId；新增公開 GET /api/tournament/champion-bracket?eventId= 從歸檔 TARCHIVE 取該賽事每輪 matches+勝負(winner 由 winnerUid 對 p1/p2uid 導出)，供前端名人堂點選後翻頁顯示) + v0.60 (錦標賽：修 setup 階段「等對方補抽」倒數到時誤判雙敗——閒置判負用的 currentActorSeat 在 setup 只看 setupDone，雙方都 false 就回 -1 雙敗，完全忽略 mulligan 子階段；實況是只有一方欠補抽/確認揭示、對手只是在等，卻被一起判雙敗。修：setup 先判 mulligan 待辦(pendingMulliganDraw/mulliganRevealConfirmed/mulliganPostBenchOpen)，只有欠 mulligan 的一方算「該動作」→ 單判該方敗、等待方獲勝；mulligan 都完成才退回看 setupDone) + v0.59 (錦標賽名人堂可從歸檔還原：新增 /admin/champions/restore-from-archive[從 TARCHIVE 重建 TCHAMPS,只補缺漏不覆蓋既有,救回被誤刪的冠軍];歸檔 recordTournamentArchive 補存 communityEvent 旗標供還原;admin.html 名人堂管理加「♻️從歸檔還原」鈕) + v0.58 (錦標賽：定期清掃「已結束賽事底下、沒打完(非done)的對戰」殘留——賽事 finished 後不清 TMATCH，致這種 pending 對戰累積、被監控誤算成「等開打」死資料(排程器本就以 listOpenEvents 排除 finished，故這些殘留零功能影響、不會幽靈開打)；scheduler 每~5分刪除 finished 賽事的非done對戰，一次涵蓋正常完賽/force-finish/取消所有結束路徑+自動清掉歷史殘留) + v0.57 (錦標賽：大廳聊天效能——①為 tournamentChat 建 {room,ts} 索引,讓 /chat 的 ts>since+sort 走索引範圍掃描,不再每次全表掃+記憶體排序[訊息越多越慢→高流量輪詢拖慢];②scheduler 每~5 分鐘定期修剪大廳聊天,只保留最近 800 則,避免 collection 無限長大) + v0.56 (錦標賽：修『打到一半被判未進場』——進場標記 entered 原是 read-modify-write 整包寫回,兩人同時進場時後者用讀到的舊值覆蓋掉前者的旗標→某方進場記錄遺失→未進場 tick 誤判已開打的對局[實例 Eg vs Gali]。修(A根因)進場端改原子 positional $set 只更新自己座位+建 match 時初始化 entered:[false,false];修(B保險)未進場判負前若房間 gameState 已 playing/game-over[雙方都完成 setup 確實到場]即不判未進場) + v0.55 (錦標賽：社群賽發起公告措辭微調[「就自動開賽（人越多越熱鬧）」→「就能開賽」] + 新增 /api/tournament/cancel-proposal[發起者本人，報名階段且報名人數未達門檻時可手動取消社群賽；原子搶占 status=registration→finished 防與 scheduler 開賽競態；不收 30 分冷卻、釋放全站 1 場名額] + /event 每場補 isProposer 旗標供前端顯示取消鈕) + v0.54 (錦標賽：社群賽發起公告文字修正——募集窗口會跑滿,期間都可報名,時間到達門檻才開賽[非一達標即開],避免『集滿即開賽』誤導) + v0.53 (錦標賽：玩家發起社群賽[createdByPlayer]——/propose 限email帳號/全站同時僅1場/發起者30分冷卻/官方賽事開賽前2h內或未結束時禁止/選format+募集窗口15-30-60分/自動報名發起者;募集截止響應<門檻 or 報到<門檻自動取消;門檻單淘汰4瑞士8;名人堂冠軍帶 communityEvent 旗標) + v0.52 (錦標賽：修瑞士制排名把『剛配好還沒打的下一輪 pending 對戰』誤當雙敗計分[GG 1-1/aa 0-2 應為 1-0/0-1]——buildSwissPlayersFromMatches 改只計已結束;伺服器把 status 一併傳入) + v0.51 (錦標賽：瑞士制報到結束(確定簽到人數)時,在聊天室系統廣播——本場選手數、預計瑞士輪數、取前幾名進 Top Cut) + v0.50 (錦標賽：瑞士制階段的未進場/閒置判負文字改成不用「淘汰/晉級」字眼[輸贏都繼續比賽,雙未進場以雙敗處理];cut 階段下一輪廣播用 Top Cut 字樣) + v0.49 (錦標賽：/event events[] 補 format/swissRounds/topCut,讓大廳賽事卡正確顯示『瑞士制』而非一律單敗) + v0.48 (錦標賽：/bracket 回傳瑞士制即時排名表 standings[名次/戰績/積分/OWP] + event.format/phase/swissRounds/topCut + 每場 phase,供前端顯示瑞士排名與輪次標籤) + v0.47 (錦標賽：新增瑞士制+單淘汰Top Cut賽制[format='swiss-then-cut']——建賽事可選瑞士制,輪數/切牌依人數自動且admin可覆寫,每輪依戰績配對避重賽、勝3負0不平手、破同分OWP/OOWP,打完固定輪數依排名取前K名進單敗淘汰;純函式來自bundle TENG.*,單敗淘汰行為完全不變) + v0.46 (錦標賽：報到截止 seed 改原子搶占 checkin→bracket_ready，修『報到回200但 seedEventBracket 已讀完 regs→沒被排進賽程』的 TOCTOU 競態 + 防重疊 tick 重複 seed 洗掉賽程) + v0.45 (錦標賽：較晚賽事自動順延——若有開賽時間較早且尚未結束的其他賽事仍在進行，接近開賽前 10 分鐘內自動把本場開賽順延 10 分鐘並在聊天室公告，直到前場結束，避免同一玩家被兩場同時要求進場) + v0.44 (錦標賽：對局時限改官方「打完剩餘回合」制[時間到先打完當前回合，後攻方再結束他的下一個回合才比獎賞] + 平手自動判雙敗[雙方淘汰、下一輪對手輪空，不需管理員]) + v0.43 (錦標賽：/spectate/list 排除自己參賽的場,防參賽者誤觀戰自己對局看不到手牌) + v0.42 (錦標賽：/admin/match-log 取某場逐回合log供賽事統計下鑽) + v0.41 (錦標賽：/event events[] 補 myName+checkInDeadline 供前端每場卡片) + v0.40 (錦標賽：可同時公布多場賽事(時間不重疊)，玩家各自報名；scheduler 迴圈所有開放賽事；端點吃 eventId) + v0.36 (錦標賽：/event+/state 回 serverNow 給前端對時(倒數同步) + /chat 回 clearedAt(admin清空即時生效))
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

        // users 統計（loop 抓全部 — 上限 sane safety: 50,000）
        try {
          const allUsers = [];
          let pageToken = undefined;
          while (allUsers.length < 50000) {
            const result = await adminAuth.listUsers(1000, pageToken);
            allUsers.push(...result.users);
            pageToken = result.pageToken;
            if (!pageToken) break;
          }
          const uniqUids = new Set(allUsers.map(u => u.uid));
          const memberUids = new Set(allUsers.filter(u => u.email).map(u => u.uid));
          const active24hUids = new Set(
            allUsers.filter(u => u.metadata.lastSignInTime && new Date(u.metadata.lastSignInTime).getTime() > h24).map(u => u.uid)
          );
          users = {
            enabled: true,
            total: uniqUids.size,
            members: memberUids.size,
            anonymous: uniqUids.size - memberUids.size,
            active24h: active24hUids.size,
          };
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
          const allSnap = await adminDb.collection('feedbacks').get();
          const unreplied = allSnap.docs.filter(d => !d.data().reply).length;
          feedback = {
            enabled: true,
            total: totalSnap.data().count,
            new24h: new24hSnap.data().count,
            unreplied,
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
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/admin/firebase/feedbacks/:id', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      await adminDb.collection('feedbacks').doc(req.params.id).delete();
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Oracle MongoDB ────────────────────────────────────────────────
  app.get('/api/admin/oracle/rooms', requireFirebaseAdmin, async (req, res) => {
    try {
      // v1.18: 接受 ?status=playing|lobby|ended → 只撈該 status 子集（admin 進行中分頁 Refresh 加速）。
      const _sq = (req.query.status || '').trim();
      const _filter = (_sq && _sq !== 'all') ? { status: _sq } : {};
      const rooms = await db.collection('rooms')
        .find(_filter, {
          projection: {
            _id: 1, roomName: 1, hostName: 1, hostUid: 1, status: 1,
            seats: 1, memberUids: 1, createdAt: 1, updatedAt: 1,
            _version: 1, schemaVersion: 1, spectatorsAllowed: 1,
            'gameState.turn': 1,
            'gameState.winner': 1,
            'gameState.winReason': 1,
            'gameState.phase': 1,
            'gameState.players.prize': 1,
            'gameState.log': 1,
          }
        })
        .sort({ updatedAt: -1 }).toArray(); // v0.20: 拿掉 limit 300 — Oracle 主機沒額度限制
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
      // v1.18: 永遠回全量三狀態計數（cheap countDocuments，與 rooms 子集無關），供 toolbar 顯示。
      let counts = { lobby: 0, playing: 0, ended: 0 };
      try {
        const [lobby, playing, ended] = await Promise.all([
          db.collection('rooms').countDocuments({ status: 'lobby' }),
          db.collection('rooms').countDocuments({ status: 'playing' }),
          db.collection('rooms').countDocuments({ status: 'ended' }),
        ]);
        counts = { lobby, playing, ended };
      } catch (e) { console.warn('[admin] oracle counts failed:', e.message); }
      res.json({ rooms, counts });
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
  app.get('/api/admin/firebase/rooms', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      // v1.18: ?status= 過濾。帶 where 時不加 orderBy（免複合索引），改 JS 排序。
      const _sq = (req.query.status || '').trim();
      const snap = (_sq && _sq !== 'all')
        ? await adminDb.collection('rooms').where('status', '==', _sq).get()
        : await adminDb.collection('rooms').orderBy('updatedAt', 'desc').get(); // v0.20: 拿掉 limit 300 — admin SDK 不吃 client quota
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
      // v1.18: status 過濾時沒帶 orderBy → JS 補 updatedAt desc 排序。
      if (_sq && _sq !== 'all') rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      // v0.3: 並行用 count() aggregation 拿每房間訊息數（subcollection）
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
      res.json({ rooms, counts });
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
  // single-flight：多個請求同時進來只會真的打一輪 Firebase，其餘共用同一個 promise。
  // ?refresh=1 可強制重新抓（admin 的 Refresh 鈕、刪帳號後用）。
  let _usersAllCache = null;        // { at, users }
  let _usersAllInflight = null;     // 進行中的 promise（single-flight）
  const USERS_ALL_TTL = 5 * 60 * 1000;

  async function fetchAllFirebaseUsers() {
    const out = [];
    let pageToken;
    do {
      const result = await adminAuth.listUsers(1000, pageToken);   // 1000 = Firebase 單頁上限
      for (const u of result.users) {
        out.push({
          uid: u.uid, email: u.email || null, emailVerified: u.emailVerified,
          displayName: u.displayName || null,
          anonymous: u.providerData.length === 0,
          createdAt: u.metadata.creationTime,
          lastSignIn: u.metadata.lastSignInTime,
          disabled: u.disabled,
        });
      }
      pageToken = result.pageToken || undefined;
    } while (pageToken);
    return out;
  }

  app.get('/api/admin/firebase/users-all', requireFirebaseAdmin, requireFb, async (req, res) => {
    try {
      const force = String(req.query.refresh || '') === '1';
      const fresh = _usersAllCache && (Date.now() - _usersAllCache.at) < USERS_ALL_TTL;
      if (!force && fresh) {
        return res.json({ users: _usersAllCache.users, cachedAt: _usersAllCache.at, cached: true });
      }
      if (!_usersAllInflight) {
        _usersAllInflight = fetchAllFirebaseUsers()
          .then((users) => { _usersAllCache = { at: Date.now(), users }; return users; })
          .finally(() => { _usersAllInflight = null; });
      }
      const users = await _usersAllInflight;
      res.json({ users, cachedAt: _usersAllCache ? _usersAllCache.at : Date.now(), cached: false });
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
      const snap = await adminDb.collection('feedbacks')
        .orderBy('createdAt', 'desc').get();
      const items = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, ...data,
          createdAt: tsToMillis(data.createdAt),
          updatedAt: tsToMillis(data.updatedAt),
          repliedAt: tsToMillis(data.repliedAt),
        };
      });
      res.json({ feedback: items });
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
      return doc;
    }

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

    // 2.2 個人戰績頁 — 最近 N 場 + 常用卡 Top 20 + 勝率走勢
    //   path param: :email
    //   ?recent=20 (default)
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
        res.json({ ok: true, id, rule: { _id: id, ...doc } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/admin/deck-rules', requireFirebaseAdmin, async (req, res) => {
      try {
        const id = String((req.query && req.query.id) || '');
        if (!id) return res.status(400).json({ error: '需要 id' });
        await TRULES.deleteOne({ _id: id });
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
          const rows = await db.collection('matchRecords')
            .find(q, { projection: { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })
            .sort({ endedAt: -1 }).limit(20000).toArray();
          for (const m of rows) {
            for (const side of ['p1', 'p2']) {
              const cc = m[side] && m[side].cardCounts;
              if (!cc || !Object.keys(cc).length) continue;
              absorb(cc, casualSideResult(m.winner, side === 'p1'));
            }
          }
        } else {
          const q = {};
          if (since) q.finishedAt = { $gte: since };
          const archives = await db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 }).limit(200).toArray();
          for (const a of archives) {
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
          const empty = { ruleId, name: target.name, source, since, sample: { decks: 0, wins: 0, losses: 0, draws: 0 },
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
          ruleId, name: target.name, source, since,
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
          const rows = await db.collection('matchRecords')
            .find(q, { projection: { 'p1.cardCounts': 1, 'p2.cardCounts': 1, winner: 1 } })
            .sort({ endedAt: -1 }).limit(20000).toArray();
          scanned.casualMatches = rows.length;
          for (const m of rows) {
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
          const archives = await db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 }).limit(200).toArray();
          scanned.tournEvents = archives.length;
          for (const a of archives) {
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
    try {
      const url = 'https://asia.pokemon-card.com/tw/deck-build/recipe/' + code + '/';
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
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
      console.warn('[deck-import] fetch error:', err.message);
      res.status(500).json({ error: '無法連線到官網: ' + err.message });
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
    try {
      // Step 1: GET /tw/deck-build/ → cookie + token
      const r1 = await fetch('https://asia.pokemon-card.com/tw/deck-build/', {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
        },
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
      console.warn('[deck-export] fetch error:', err.message);
      res.status(500).json({ error: '無法連線到官網: ' + err.message });
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
  const PLAYING_STALE_MS = 5 * 60 * 1000;               // playing 5 分鐘無動作（不改）
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
  console.log('[zombie-cleanup] v0.3 已啟動：lobby>5min / playing>5min / ended>90天 自動清，每 2 分鐘掃一次');
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
    // v0.71 降載：對戰 log 佔完整盤面約 73%(一場打久了累積數百行)。/state /action /spectate 回應只送最近
    //   TOURN_LOG_CAP 行 log(儲存於 TROOMS 的盤面 + onMatchGameOver 的 finalLog 快照仍保留完整)。前端動畫游標
    //   已改用 timestamp 偵測新事件(非 log 長度),故截尾對前端透明、動畫/音效不受影響。
    const TOURN_LOG_CAP = 60;
    function _capLog(gs) {
      if (!gs || !Array.isArray(gs.log) || gs.log.length <= TOURN_LOG_CAP) return gs;
      return { ...gs, log: gs.log.slice(-TOURN_LOG_CAP) };
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

    // ── 工具：用雙方真實牌組建一局完整遊戲（引擎 createGame → setup 階段）──
    function makeGame(decks, names, prefs) {
      const d0 = { name: (names && names[0]) || 'P1', entries: decks[0] };
      const d1 = { name: (names && names[1]) || 'P2', entries: decks[1] };
      const fc = Array.isArray(prefs) ? [prefs[0] || 'random', prefs[1] || 'random'] : ['random', 'random'];
      // v6.053 批4：錦標賽放行互動式開局（伺服器權威，client 送 OPENING_* → 這裡 applyAction）
      return TENG.createGame(d0, d1, TPOOL, { firstChoicePreferences: fc });
    }
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

    // v0.72 gzip 壓縮(防呆)——錦標賽回應多為 JSON(盤面/大廳/聊天),gzip 壓縮率 ~6-9×,大幅降頻寬。
    //   ①防呆:compression 套件未安裝→try/catch 略過,不影響服務(VM 需 npm install compression 才生效)。
    //   ②SSE 不壓:filter 排除 text/event-stream(避免緩衝破壞即時串流;主 app 的 SSE 路由在本 patch 之前註冊、
    //     本 app.use 只套用其後註冊的錦標賽路由,雙保險)。③threshold 1KB:精簡回應(v0.68 unchanged 等)免壓省 CPU。
    //   ④瀏覽器自動送 Accept-Encoding:gzip 並自動解壓,前端無需改。⑤若前面已有反向代理(nginx/CF)壓縮則此為冗餘但無害
    //     (不會二次壓縮已編碼回應)。
    try {
      // v0.75 根因修:整段 patch 包在 import(...).then(async () => {}) 內 = ESM host,沒有 require。
      //   比照上方 TENG 載入:try require(CJS host) → catch 用 dynamic import(ESM host,default=compression 函式,含 .filter)。
      //   原 v0.72 只用 require 載 compression → ESM host 拋「require is not defined」被 try/catch 吞 → gzip 從未生效
      //   (compression 已裝、package.json 也有,但 curl 無 Content-Encoding:gzip;玩家實測發現)。
      let _compression;
      try { _compression = require('compression'); }
      catch (_eReq) { _compression = (await import('compression')).default; }
      app.use(_compression({
        threshold: 1024,
        filter: (req, res) => {
          const _ct = String(res.getHeader('Content-Type') || '');
          if (_ct.includes('text/event-stream')) return false;
          return _compression.filter(req, res);
        },
      }));
      console.log('[tournament] gzip compression enabled (v0.75)');
    } catch (e) {
      console.warn('[tournament] gzip 啟用失敗,略過(不影響服務):', e && e.message);
    }

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
        return res.json({ seat, gameState: doc.gameState, version: doc.version, waiting: !doc.gameState, seats: doc.seats, names: doc.names });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/tournament/state', async (req, res) => {
      try {
        const room = String(req.query.room || 'TOURNAMENT-TEST');
        const cv = Number(req.query.v);
        // v0.68 降載：先取「不含 gameState 大欄位」的輕量 doc 比對版本。client 版本相符(cv===version)→
        //   回精簡 unchanged(免序列化/傳輸整個盤面,亦免從 mongo 拉大欄位),大幅降低對戰中每 1.2s×N 人
        //   輪詢的 CPU/頻寬。僅版本不同(或 cv<0 強制重抓)才第二次查詢取完整 gameState。
        const light = await TROOMS.findOne({ _id: room }, { projection: { gameState: 0 } });
        if (!light) return res.json({ version: -1, waiting: true });
        if (Number.isFinite(cv) && cv >= 0 && cv === light.version) {
          return res.json({ version: light.version, unchanged: true, seats: light.seats, names: light.names, lastActionAt: light.lastActionAt || null, idleForfeitMin: light.idleForfeitMin || 3, serverNow: Date.now() });
        }
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc) return res.json({ version: -1, waiting: true });
        res.json({ gameState: _capLog(doc.gameState), version: doc.version, seats: doc.seats, names: doc.names, waiting: !doc.gameState, lastActionAt: doc.lastActionAt || null, idleForfeitMin: doc.idleForfeitMin || 3, serverNow: Date.now() });
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
        const gs = doc.gameState;
        if (!gs) return res.json({ error: '對局尚未開始', waiting: true, version: doc.version });
        if (!action || !action.type) return res.status(400).json({ error: 'no action' });
        if (!canSeatAct(gs, seat, action)) return res.json({ error: '現在不是你能操作的時機', gameState: gs, version: doc.version });
        let newGs;
        try { newGs = TENG.applyAction(gs, normalizeAction(action, seat), TPOOL); }
        catch (e) { return res.json({ error: '動作無效：' + e.message, gameState: gs, version: doc.version }); }
        if (newGs === gs) return res.json({ rejected: true, gameState: gs, version: doc.version });
        const nv = doc.version + 1;
        // v5.598 樂觀並發控制（CAS）：filter 加 version:doc.version，只在版本未被其他並發動作改寫時才寫入。
        //   setup 階段雙方會「同時各自擺場」→ 兩個 /action 都讀到 version N、都寫 N+1，原本後寫會覆蓋前寫
        //   (lost update) 抹掉其中一方擺場而卡死。CAS 後只有一個寫成功；落敗者 matchedCount=0，回傳最新狀態
        //   讓 client 重新同步後再試（前端會自動重試一次；雙方擺自己側不衝突故必成功）。
        const wr = await TROOMS.updateOne({ _id: room, version: doc.version }, { $set: { gameState: newGs, version: nv, updatedAt: Date.now(), lastActionAt: Date.now() } });
        if (!wr || wr.matchedCount === 0) {
          const fresh = await TROOMS.findOne({ _id: room });
          return res.json({ rejected: true, stale: true, gameState: fresh ? fresh.gameState : gs, version: fresh ? fresh.version : doc.version });
        }
        // v0.82 回放:半回合快照(先攻/後攻各一格)——activePlayerIndex 改變=回合換手邊界;開局(setup→playing)也存一格。fire-and-forget 不 await 不影響回應。
        if (doc.matchId) {
          const _enteredPlay = gs.phase !== 'playing' && newGs.phase === 'playing';
          const _halfTurnBoundary = newGs.activePlayerIndex !== gs.activePlayerIndex;
          if (_enteredPlay || _halfTurnBoundary) snapshotTurn(doc.matchId, doc.eventId, newGs);
        }
        if (newGs.phase === 'game-over' && doc.matchId) { try { await onMatchGameOver(doc, newGs); } catch (e) { console.warn('[tournament] match advance failed:', e && e.message); } }
        res.json({ gameState: _capLog(newGs), version: nv });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/tournament/reset', async (req, res) => {
      try {
        const room = String((req.body && req.body.room) || 'TOURNAMENT-TEST');
        const prev = await TROOMS.findOne({ _id: room });
        const nv = ((prev && prev.version) || 0) + 1;
        await TROOMS.updateOne({ _id: room }, { $set: { seats: [null, null], names: [null, null], decks: [null, null], gameState: null, version: nv, updatedAt: Date.now() } }, { upsert: true });
        res.json({ ok: true, version: nv, waiting: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // v0.77 客戶端診斷回傳(client 端 desync 定根因/確認用)——client 只在真異常指紋才回傳,寫 tournamentClientDiag
    //   (TTL 7天自動清)。tournIdentity 驗證擋匿名 + per-uid 60s 記憶體節流 + body 2KB cap + fail-silent,絕不影響對戰路徑。
    const TCDIAG = db.collection('tournamentClientDiag');
    TCDIAG.createIndex({ ts: 1 }, { expireAfterSeconds: 604800 }).catch(() => { /* TTL index best-effort */ });
    const _cdiagThrottle = new Map();  // uid -> lastAt(記憶體節流)
    app.post('/api/tournament/clientdiag', async (req, res) => {
      try {
        const _id = await tournIdentity(req);
        if (_id.error) return res.json({ ok: false });  // 未驗證靜默丟棄,不擋
        const uid = _id.uid, now = Date.now();
        if (now - (_cdiagThrottle.get(uid) || 0) < 60000) return res.json({ ok: true, throttled: true });  // per-uid 60s
        _cdiagThrottle.set(uid, now);
        if (_cdiagThrottle.size > 500) { const k = _cdiagThrottle.keys().next().value; _cdiagThrottle.delete(k); }  // 防 map 無限長大
        let s = '{}'; try { s = JSON.stringify(req.body || {}).slice(0, 2048); } catch (e) { /* */ }  // 2KB cap
        await TCDIAG.insertOne({ ts: now, uid, email: _id.email || null, room: String((req.body && req.body.room) || ''), reason: String((req.body && req.body.reason) || ''), diag: s });
        res.json({ ok: true });
      } catch (e) { try { res.json({ ok: false }); } catch (_e2) { /* */ } }
    });

    // ════════════════════════════════════════════════════════════════════
    // Phase1-B：賽事 collections + 報名（一次一 active 賽事；單敗淘汰 Bo1）
    // ════════════════════════════════════════════════════════════════════
    const TEVENTS = db.collection('tournamentEvents');
    const TREGS = db.collection('tournamentRegistrations');
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
    async function getActiveEvent() {
      const all = await listOpenEvents();
      if (!all.length) return null;
      all.sort((a, b) => ((_EV_RANK[a.status] != null ? _EV_RANK[a.status] : 9) - (_EV_RANK[b.status] != null ? _EV_RANK[b.status] : 9)) || ((a.createdAt || 0) - (b.createdAt || 0)));
      return all[0];
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
        const ev = await resolveEventFromReq(req);
        if (!ev) return res.status(409).json({ error: '目前沒有賽事' });
        if (ev.status !== 'checkin') return res.status(409).json({ error: '目前不在報到階段' });
        const reg = await TREGS.findOne({ _id: ev._id + '__' + id.uid });
        if (!reg) return res.status(409).json({ error: '你未報名本賽事，無法報到' });
        if (reg.autoRemovedConflict) return res.status(409).json({ error: '你仍在其他進行中的賽事，本場已自動取消你的報名（避免同時被兩場召喚，待其他賽事結束後可再參加）。' });
        await TREGS.updateOne({ _id: reg._id }, { $set: { checkedIn: true } });
        res.json({ ok: true });
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
        const ev = await resolveEventFromReq(req);
        const shared = await getEventShared();
        // per-user：一次抓我的所有報名（取代原對每個開放賽事各一次 findOne 的 N+1）
        const myRegs = await TREGS.find({ uid: id.uid }).toArray();
        const myRegBy = new Map(myRegs.map((r) => [r.eventId, r]));
        let me = { registered: false, checkedIn: false };
        if (ev) {
          const reg = myRegBy.get(ev._id);
          if (reg) me = { registered: true, checkedIn: !!reg.checkedIn, deckCount: deckCount(reg.deckEntries), name: reg.name, deckName: reg.deckName || null, autoRemovedConflict: !!reg.autoRemovedConflict };
        }
        // v0.84 預填暱稱:附「最近一次報名的暱稱」供前端未報名任何賽事時預填(從已抓的 myRegs 取最新,無額外查詢);從沒報過退帳號顯示名 id.name
        const _lastReg = myRegs.filter((r) => r.name).sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0))[0];
        me.lastName = (_lastReg && _lastReg.name) || id.name || null;
        let regCount = 0;
        if (ev) regCount = (shared.regCounts[ev._id] != null) ? shared.regCounts[ev._id] : await TREGS.countDocuments({ eventId: ev._id });
        // myMatch：跨所有 running 賽事，一次 $in 查詢我的未完成對戰（取代每 running event 各一次 findOne）
        let myMatch = null;
        if (shared.runningEvents.length) {
          const _runIds = shared.runningEvents.map((e) => e._id);
          const _myMatches = await TMATCH.find({ eventId: { $in: _runIds }, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null }, $or: [{ p1uid: id.uid }, { p2uid: id.uid }] }).toArray();
          for (const _e of shared.runningEvents) {
            const mm = _myMatches.find((m) => m.eventId === _e._id && m.round === _e.currentRound);
            if (mm) {
              const cdMin = (_e.roundCountdownMin != null ? _e.roundCountdownMin : 3);
              const nsMin = (_e.noShowMin > 0 ? _e.noShowMin : 5);
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
          return { _id: _e._id, name: _e.name, status: _e.status, maxPlayers: _e.maxPlayers, regCount: shared.regCounts[_e._id] || 0, registrationOpenAt: _e.registrationOpenAt || null, registrationCloseAt: _e.registrationCloseAt || null, roundLimitMin: _e.roundLimitMin, currentRound: _e.currentRound, rounds: _e.rounds, championName: _e.championName || null, registered: !!_reg, checkedIn: !!(_reg && _reg.checkedIn), autoRemovedConflict: !!(_reg && _reg.autoRemovedConflict), myDeckName: (_reg && _reg.deckName) || null, myName: (_reg && _reg.name) || null, checkInDeadline: _e.checkInDeadline || null, format: _e.format || 'single-elim', swissRounds: _e.swissRounds || null, topCut: _e.topCut || null, createdByPlayer: !!_e.createdByPlayer, minPlayers: _e.minPlayers || null, proposerName: _e.proposerName || null, isProposer: !!(_e.proposerUid && _e.proposerUid === id.uid) };
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
        res.json({ event: ev || null, me, regCount, isAdmin: isTournAdmin(id), myMatch, myBye, events: _events, serverNow: Date.now() });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 玩家：報名（鎖定牌組，一帳號一名額）
    app.post('/api/tournament/register', async (req, res) => {
      try {
        const id = await tournIdentity(req);
        if (id.error) return res.status(id.code || 401).json({ error: id.error });
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
        await TREGS.insertOne({ _id: regId, eventId: ev._id, uid: id.uid, email: id.email || null, name: nickname, deckName, deckEntries, coinPref, checkedIn: false, registeredAt: Date.now() });
        res.json({ ok: true });
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
        const cp0 = String(b.coinPref || 'random');
        await TREGS.insertOne({ _id: ev._id + '__' + id.uid, eventId: ev._id, uid: id.uid, email: id.email || null, name: nickname, deckName: String(b.deckName || '').slice(0, 40), deckEntries, coinPref: (cp0 === 'first' || cp0 === 'second') ? cp0 : 'random', checkedIn: false, registeredAt: now });
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
          let _nick = null;
          const _cn = _chatNickCache.get(id.uid);
          if (_cn && (now - _cn.at) < 300000) { _nick = _cn.name; }
          else {
            try {
              const _lr = await TREGS.find({ uid: id.uid }, { projection: { name: 1, registeredAt: 1 } }).sort({ registeredAt: -1 }).limit(1).toArray();
              _nick = (_lr[0] && _lr[0].name) || null;
            } catch (_e) { /* best-effort */ }
            _chatNickCache.set(id.uid, { name: _nick, at: now });
          }
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
    async function seedEventBracket(ev, opts) {
      const _p = _seedChain.then(() => _seedEventBracketImpl(ev, opts), () => _seedEventBracketImpl(ev, opts));
      _seedChain = _p.then(() => {}, () => {});  // rejection 不卡住鏈
      return _p;
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
    async function recordChampion(ev, champUid, champName) {
      if (!ev || !champUid) return;
      try {
        const reg = await TREGS.findOne({ eventId: ev._id, uid: champUid });
        const playerCount = await TREGS.countDocuments({ eventId: ev._id });
        await TCHAMPS.updateOne({ _id: 'champ_' + ev._id }, { $set: {
          _id: 'champ_' + ev._id, eventId: ev._id, eventName: ev.name || '錦標賽',
          championUid: champUid, championName: champName || (reg && reg.name) || '冠軍',
          deckName: (reg && reg.deckName) || '', playerCount: playerCount || 0, finishedAt: Date.now(),
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
          players: regs.map((r) => ({ uid: r.uid, name: r.name, email: r.email || null, deckName: r.deckName || '', coinPref: r.coinPref || 'random', deckEntries: r.deckEntries || [] })),
          matches: matches.map((m) => ({ round: m.round, idx: m.idx, p1uid: m.p1uid, p1name: m.p1name, p2uid: m.p2uid, p2name: m.p2name, winnerUid: m.winnerUid, winnerName: m.winnerName, status: m.status, bye: !!m.bye, noShow: !!m.noShow, doubleNoShow: !!m.doubleNoShow, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved })),
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
    // 瑞士制晉級：本輪打完 → 由所有瑞士輪 TMATCH 重建 standings → 未達輪數配下一瑞士輪、達到則依排名取前 K 進 Top Cut(單敗)。
    async function advanceSwiss(ev, cur) {
      const swissMatches = await TMATCH.find({ eventId: ev._id, phase: 'swiss' }).toArray();
      const regs = await TREGS.find({ eventId: ev._id, checkedIn: true }).toArray();
      const nameOf = (uid) => { const r = regs.find((x) => x.uid === uid); return (r && r.name) || '玩家'; };
      const players = TENG.buildSwissPlayersFromMatches(
        swissMatches.map((m) => ({ round: m.round, p1uid: m.p1uid, p2uid: m.p2uid, winnerUid: m.winnerUid, bye: !!m.bye, status: m.status })),
        regs.map((r) => ({ uid: r.uid, name: r.name || '玩家' })),
      );
      const swissRounds = (ev.swissRounds > 0) ? ev.swissRounds : TENG.swissRoundsForCount(players.length);
      const cdMin = (ev.roundCountdownMin != null ? ev.roundCountdownMin : 3);
      if (cur < swissRounds) {
        const next = cur + 1;
        const pairings = TENG.pairSwissRound(players, next);
        await TMATCH.insertMany(pairingsToMatches(pairings, ev._id, next, 'swiss', nameOf));
        await TEVENTS.updateOne({ _id: ev._id }, { $set: { currentRound: next, roundStartedAt: Date.now() } });
        await postSystemChat('⚔️ 瑞士制第 ' + next + ' / ' + swissRounds + ' 輪配對完成！休息倒數 ' + cdMin + ' 分鐘，時間到才可進場。');
      } else {
        const standings = TENG.computeStandings(players);
        const K = (ev.topCut > 0) ? ev.topCut : TENG.topCutSizeForCount(players.length);
        const next = cur + 1;
        await TMATCH.insertMany(pairingsToMatches(TENG.seedTopCut(standings, K), ev._id, next, 'cut', nameOf));
        await TEVENTS.updateOne({ _id: ev._id }, { $set: { phase: 'cut', currentRound: next, roundStartedAt: Date.now() } });
        await postSystemChat('🏆 瑞士制 ' + swissRounds + ' 輪結束！依積分(破同分 OWP/OOWP)取前 ' + K + ' 名進入單敗淘汰 Top Cut，休息倒數 ' + cdMin + ' 分鐘後開打！');
      }
    }
    // 本輪全部 done → 收集贏家（含輪空者）。剩 1 人＝冠軍完賽；>1 人＝動態建下一輪（每輪只 1 人輪空，優先未輪空者）。
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
      if (winners.length <= 1) {
        const champ = winners[0] || null;
        await TEVENTS.updateOne({ _id: eventId }, { $set: { status: 'finished', championUid: champ ? champ.uid : null, championName: champ ? champ.name : null } });
        if (champ) {
          await recordChampion(ev, champ.uid, champ.name);
          await recordTournamentArchive({ ...ev, championUid: champ.uid, championName: champ.name });
          await postSystemChat('🏆 賽事結束！冠軍：' + (champ.name || '?') + ' 🎉 恭喜！');
        } else {
          await recordTournamentArchive(ev);
          await postSystemChat('⚠️ 賽事結束（最後一場雙方皆未進場，無冠軍）。');
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
                regs.map((r) => ({ uid: r.uid, name: r.name || '玩家' })),
              );
              standingsRaw = TENG.computeStandings(players).map((p) => ({
                uid: p.uid, rank: p.rank, name: p.name, matchPoints: p.matchPoints,
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
          standings: _cache.standingsRaw ? _cache.standingsRaw.map((s) => ({ rank: s.rank, name: s.name, matchPoints: s.matchPoints, w: s.w, l: s.l, owp: s.owp, oowp: s.oowp, mine: s.uid === id.uid })) : null,
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
        markSpectator(room, id.uid);  // v0.80 觀戰人數:記錄此觀戰者心跳
        const cv = Number(req.query.v);
        // v0.68 降載：先比對版本，相符則免深拷貝蓋手牌，回精簡 unchanged。
        const light = await TROOMS.findOne({ _id: room }, { projection: { gameState: 0 } });
        if (!light) return res.json({ version: -1, waiting: true });
        if (Number.isFinite(cv) && cv >= 0 && cv === light.version) {
          return res.json({ version: light.version, unchanged: true, seats: [null, null], names: light.names, spectate: true });
        }
        const doc = await TROOMS.findOne({ _id: room });
        if (!doc || !doc.gameState) return res.json({ version: -1, waiting: true });
        const gs = JSON.parse(JSON.stringify(doc.gameState));
        if (Array.isArray(gs.players)) for (const pl of gs.players) { if (Array.isArray(pl.hand)) pl.hand = pl.hand.map((c) => ({ iid: c.iid, cardId: '__HIDDEN__', damage: 0, energyAttached: [] })); }
        if (Array.isArray(gs.log) && gs.log.length > TOURN_LOG_CAP) gs.log = gs.log.slice(-TOURN_LOG_CAP);  // v0.71 log 截尾
        res.json({ gameState: gs, version: doc.version, seats: [null, null], names: doc.names, spectate: true });
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
            $setOnInsert: { _id: roomId, seats: [m.p1uid, m.p2uid], names: [m.p1name, m.p2name], decks: [reg1.deckEntries, reg2.deckEntries], gameState: gs, version: 1, matchId: m._id, eventId: ev._id, lastActionAt: Date.now(), idleForfeitMin: (ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3) },
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
        let gs;
        try { gs = makeGame([reg1.deckEntries, reg2.deckEntries], [m.p1name, m.p2name], [reg1.coinPref || 'random', reg2.coinPref || 'random']); }
        catch (e) { return res.status(500).json({ error: '建立對局失敗：' + e.message }); }
        const roomId = m.roomId || ('mr_' + m._id);
        const prev = await TROOMS.findOne({ _id: roomId });
        await TROOMS.updateOne({ _id: roomId }, { $set: { _id: roomId, seats: [m.p1uid, m.p2uid], names: [m.p1name, m.p2name], decks: [reg1.deckEntries, reg2.deckEntries], gameState: gs, version: ((prev && prev.version) || 0) + 1, matchId: m._id, eventId: m.eventId, updatedAt: Date.now(), lastActionAt: Date.now(), idleForfeitMin: (ev && ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3) } }, { upsert: true });
        await TMATCH.updateOne({ _id: m._id }, { $set: { roomId, status: 'playing', winnerUid: null, winnerName: null, gameStartedAt: Date.now(), entered: [true, true] }, $unset: { noShow: '', doubleNoShow: '', forfeit: '', idleForfeit: '', timeLimit: '', adminResolved: '', timeLimitReached: '', timeLimitTurn: '', timeLimitCalledAt: '', draw: '' } });
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
        res.json({ champions: cs.map((c) => ({ id: c._id, eventId: c.eventId, eventName: c.eventName, championName: c.championName, deckName: c.deckName || '', playerCount: c.playerCount || 0, finishedAt: c.finishedAt || 0, communityEvent: !!c.communityEvent })) });
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
    // 把多筆 archives 聚合成 Map<email, stat>。
    function _aggregateArchives(archives) {
      const acc = new Map();
      const ensure = (email) => { if (!acc.has(email)) acc.set(email, { email, displayName: '', lastFinishedAt: -1, champOfficial: 0, champOfficialAt: -1, champCommunity: 0, champCommunityAt: -1, wins: 0, winsAt: -1, losses: 0, finals: 0, finalsAt: -1, top4: 0, top4At: -1, top8: 0, top8At: -1, communityEntered: 0, officialEntered: 0, eventsPlayed: 0, events: [] }); return acc.get(email); };
      const _mx = (a, b) => (a > b ? a : b);
      for (const a of archives) {
        const emailByUid = new Map();
        for (const p of (a.players || [])) if (p.email) emailByUid.set(p.uid, p.email);
        const fin = a.finishedAt || 0; const isComm = !!a.communityEvent;
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
          s.events.push({ eventName: a.eventName || '錦標賽', date: fin, format: a.format || 'single-elim', communityEvent: isComm, wins: evW.get(p.email) || 0, losses: evL.get(p.email) || 0, result });
        }
      }
      return acc;
    }

    // ── v0.66 公開：排行榜（各榜前 5；依 email 聚合、顯示最後暱稱、不回 email）──
    //   v0.68：加 60 秒記憶體快取——排行榜只在賽事結束才變,掃全 TARCHIVE 聚合較重,降低 Oracle 負載。
    let _lbCache = { at: 0, data: null };
    app.get('/api/tournament/leaderboard', async (req, res) => {
      try {
        if (_lbCache.data && (Date.now() - _lbCache.at) < 60000) return res.json(_lbCache.data);
        const archives = await TARCHIVE.find({}, { projection: { 'players.deckEntries': 0 } }).toArray();
        const all = [..._aggregateArchives(archives).values()];
        const topN = (key, atKey) => all.filter((x) => x[key] > 0).sort((a, b) => (b[key] - a[key]) || ((b[atKey] || 0) - (a[atKey] || 0))).slice(0, 5).map((x) => ({ displayName: x.displayName || '（未命名）', count: x[key] }));
        const commEvents = await TEVENTS.find({ createdByPlayer: true }).toArray();
        const hostMap = new Map();
        for (const ev of commEvents) { const e = ev.createdBy; if (!e) continue; if (!hostMap.has(e)) hostMap.set(e, { displayName: ev.proposerName || e, count: 0, last: -1 }); const h = hostMap.get(e); h.count++; if ((ev.createdAt || 0) > h.last) { h.last = ev.createdAt || 0; h.displayName = ev.proposerName || h.displayName; } }
        const communityHost = [...hostMap.values()].sort((a, b) => (b.count - a.count) || ((b.last || 0) - (a.last || 0))).slice(0, 5).map((x) => ({ displayName: x.displayName, count: x.count }));
        const result = { champions: { official: topN('champOfficial', 'champOfficialAt'), community: topN('champCommunity', 'champCommunityAt') }, wins: topN('wins', 'winsAt'), top8: topN('top8', 'top8At'), finals: topN('finals', 'finalsAt'), communityHost };
        _lbCache = { at: Date.now(), data: result };
        res.json(result);
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
            finishedAt: a.finishedAt || Date.now(), communityEvent: !!a.communityEvent,
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
        const archives = await TARCHIVE.find({}).sort({ finishedAt: -1 }).limit(500).toArray();
        const champions = await TCHAMPS.find({}).sort({ finishedAt: -1 }).limit(500).toArray();
        res.json({
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
            matches: (a.matches || []).map((m) => ({ round: m.round, idx: m.idx, p1uid: m.p1uid, p1name: m.p1name, p2uid: m.p2uid, p2name: m.p2name, winnerUid: m.winnerUid, winnerName: m.winnerName, status: m.status, bye: !!m.bye, noShow: !!m.noShow, doubleNoShow: !!m.doubleNoShow, forfeit: !!m.forfeit, idleForfeit: !!m.idleForfeit, timeLimit: !!m.timeLimit, adminResolved: !!m.adminResolved })),
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
          if (ev.createdByPlayer) {
            const _ciN = await TREGS.countDocuments({ eventId: ev._id, checkedIn: true });
            if (_ciN < (ev.minPlayers || 4)) {
              await TEVENTS.updateOne({ _id: ev._id }, { $set: { status: 'finished', cancelled: true, championUid: null, championName: null } });
              await postSystemChat('🚫 社群賽「' + ev.name + '」報到不足（' + _ciN + '/' + (ev.minPlayers || 4) + '），取消開賽。');
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
          const nsMin = (ev.noShowMin > 0 ? ev.noShowMin : 5);
          const deadline = ev.roundStartedAt + (cdMin + nsMin) * 60000;
          if (now > deadline) {
            const pend = await TMATCH.find({ eventId: ev._id, round: ev.currentRound, status: { $ne: 'done' }, p1uid: { $ne: null }, p2uid: { $ne: null } }).toArray();
            for (const m of pend) {
              let e0 = !!(m.entered && m.entered[0]), e1 = !!(m.entered && m.entered[1]);
              // v0.56 防呆：對局若其實已開打(房間 gameState 進入 playing/game-over = 雙方都完成 setup 確實到場)，
              //   不可因 entered 旗標異常而誤判未進場(根因已於進場端原子化修正，此為第二道保險)。
              if ((!e0 || !e1) && m.roomId) {
                try { const _rm = await TROOMS.findOne({ _id: m.roomId }); const _ph = _rm && _rm.gameState && _rm.gameState.phase; if (_ph === 'playing' || _ph === 'game-over') { e0 = true; e1 = true; } } catch (e) { /* best-effort */ }
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
            const room = await TROOMS.findOne({ _id: m.roomId });
            const gs = room && room.gameState;
            if (!gs || gs.phase === 'game-over') continue;
            const last = room.lastActionAt || room.updatedAt || m.gameStartedAt || now;
            if (now <= last + idleMin * 60000) continue;
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
              await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, doubleNoShow: true } });
              try { const og = JSON.parse(JSON.stringify(gs)); og.phase = 'game-over'; og.winner = null; og.winReason = '雙方皆閒置逾 ' + idleMin + ' 分鐘，雙淘汰'; await TROOMS.updateOne({ _id: m.roomId }, { $set: { gameState: og, version: (room.version || 1) + 1, updatedAt: now } }); } catch (e) { /* best-effort */ }
              await postSystemChat(swissPhase(ev) ? ('⏰ 本場雙方皆閒置逾 ' + idleMin + ' 分鐘，以雙敗處理（瑞士制：雙方仍可繼續比賽）。') : ('⏰ 本場雙方皆閒置逾 ' + idleMin + ' 分鐘，雙淘汰，無人晉級。'));
              await checkRoundAdvance(ev._id);
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
    console.warn('[tournament] init failed → 錦標賽停用（正常對戰/admin 不受影響）:', _te && _te.message);
  }
})();

// === ORACLE ADMIN PATCH END ===
// 上面這行是 oracle_admin_update.sh 用的 patch 結尾標記，請勿刪除。
// install script 會 strip 從 patch 起點 marker 到本 END marker 之間的全部內容，
// 避免歷史殘留 IIFE 堆疊。（起點 marker 名字故意不寫在這裡，避免 sanity check 誤把
// 註解內的字串提及當成第 2 個真實 marker — v0.82 修。）
