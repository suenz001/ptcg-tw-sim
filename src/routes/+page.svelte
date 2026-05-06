<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { auth, db } from '$lib/firebase';
  import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
  import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
  import { VERSION } from '$lib/version';

  let user = $state<User | null>(null);
  let error = $state<string | null>(null);
  let status = $state('初始化中...');

  onMount(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (u) => {
        user = u;
        if (u) {
          status = '已連線';
        } else {
          status = '正在匿名登入...';
          signInAnonymously(auth).catch((e: Error) => {
            error = e.message;
            status = '登入失敗';
          });
        }
      },
      (e: Error) => {
        error = e.message;
        status = '連線失敗';
      }
    );
    return unsubscribe;
  });

  // 意見回饋相關狀態
  let showFeedbackModal = $state(false);
  let feedbackText = $state('');
  let feedbackSubmitting = $state(false);
  let feedbackStatus = $state<'idle' | 'success' | 'error'>('idle');

  async function submitFeedback() {
    if (!feedbackText.trim() || feedbackSubmitting) return;
    feedbackSubmitting = true;
    try {
      await addDoc(collection(db, 'feedbacks'), {
        content: feedbackText.trim(),
        createdAt: serverTimestamp(),
        uid: user?.uid || 'anonymous',
        userAgent: navigator.userAgent
      });
      feedbackStatus = 'success';
      feedbackText = '';
      setTimeout(() => {
        showFeedbackModal = false;
        feedbackStatus = 'idle';
      }, 2000);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      feedbackStatus = 'error';
    } finally {
      feedbackSubmitting = false;
    }
  }
</script>

<main>
  <h1>PTCG 實體賽事演練引擎 <span class="version">v{VERSION}</span></h1>
  <p class="tagline">Deck building testing and card database 牌組構築測試與卡牌資料庫</p>

  <section>
    <h2>卡牌資料庫</h2>
    <p>
      <a href="{base}/cards">瀏覽所有卡包 →</a>
      <span class="hint">（標準賽 H / I / J 標，繁體中文）</span>
    </p>
  </section>

  <section>
    <h2>牌組編輯器</h2>
    <p>
      <a href="{base}/decks">建立我的牌組 →</a>
      <span class="hint">（支援 Email 帳號跨裝置同步）</span>
    </p>
  </section>

  <section>
    <h2>⚔️ 對戰演練</h2>
    <p>
      <a href="{base}/game">開始演練 →</a>
      <span class="hint">（牌組實戰測試）</span>
    </p>
  </section>

  <!-- v2.43 社群連結：LINE 群組 + QR Code -->
  <section class="community-section">
    <h2>💬 玩家社群</h2>
    <p class="community-desc">
      想找對手切磋、討論牌組、回報 bug 或追蹤更新嗎？歡迎加入我們的 LINE 群組！
    </p>
    <div class="community-card">
      <div class="qr-block">
        <img src="{base}/line-group-qr.png" alt="LINE 群組邀請 QR Code" class="qr-image" />
        <span class="qr-caption">掃描 QR Code</span>
      </div>
      <div class="link-block">
        <p class="link-label">或點擊連結直接加入：</p>
        <a class="line-button"
           href="https://line.me/ti/g2/UyxBE5oRISqn-Df0t-pmxgGRiOJ-ewkXgzNlIw?utm_source=invitation&utm_medium=link_copy&utm_campaign=default"
           target="_blank"
           rel="noopener noreferrer">
          <span class="line-icon">LINE</span>
          <span>加入 PTCG 演練群組 →</span>
        </a>
        <p class="community-hint">（免費・隨時可退出・歡迎所有玩家）</p>
      </div>
    </div>
  </section>

  <section class="changelog-section">
    <details class="changelog-outer">
    <summary><h2>📋 版本更新記錄</h2></summary>
    <div class="changelog-list">

      <details>
        <summary><span class="ver-badge">v2.5</span> I 標 Wave 3b — 棄能量類批次（18 張）</summary>
        <ul>
          <li>新檔 v2500_i_wave3b_discard.ts — 4 個 helper inline + declarative array</li>
          <li>A 棄自身固定 N 個能量（9 張）：伽勒爾 堵攔熊龐克粉碎/火箭隊的黑魯加燃燒殆盡/舞天鵝空氣斬/雷電雲災難伏特（棄1） + 蓋歐卡漩渦波/象牙豬暴雪刀鋒/噴火駝力量踩踏/卡璞・鳴鳴雷電爆破（棄2） + 巨炭山巨體碰撞（棄3）</li>
          <li>B 棄自身全部能量（2 張）：洛托姆ex十萬伏特(130) / 超級拉帝亞斯ex幻想脈衝(300)</li>
          <li>C 棄對手戰鬥場 1 個能量（4 張）：浮潛鼬潮旋(30)/瑪俐的滑滑小子咬碎(50)/火箭隊的班基拉斯打穿衝撞(180) + 勾帕路翁神聖刀鋒(20，限特殊能量)</li>
          <li>D 棄競技場 +N（2 張）：象牙豬摧毀(120+120)/超級摔角鷹人ex筋斗強襲(120+140)；場上有競技場才 +N，並丟棄</li>
          <li>E 棄手牌能量門檻（1 張）：蘭螳花花切舞(130)，需手牌 2 張基本草，否則招式失敗</li>
          <li>所有 helper inline 在新檔；不動 effects.ts 主檔（只加 1 行 import）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.49</span> I 標 Wave 3a — 條件 +N / 擲幣倍率 / 狙擊備戰 批次實裝（30 張）</summary>
        <ul>
          <li>新檔 v2490_i_wave3a_conditional.ts — 11 個 helper factory + declarative array pattern</li>
          <li>A 擲幣 ×K 倍率（4 張）：大嘴雀機關槍鑽 / 傘電蜥雙重抓 / 豆蟋蟀躍動 / 白海獅摔打</li>
          <li>B 自身能量數 ×K（3 張）：椰蛋樹木之重壓 / 火紅不倒翁/達摩狒狒火炎球</li>
          <li>C 獎賞數條件（3 張）：蒼響界限破壞 / 大鋼蛇歡迎之尾 / 捷克羅姆ex電爆發</li>
          <li>D 對手能量 ×K（1 張）：巨鍛匠大橫掃</li>
          <li>E 對手指示物 ×K（1 張）：脫殼忍者傷害律動</li>
          <li>F 狙擊單隻備戰（5 張）：巨石丁岩石踢 / 長耳兔魯莽踢 / 雪暴馬冰之射擊 / 赫普的蒼響ex剎那斬 / 波皇子瞄準俯衝</li>
          <li>G 對手所有備戰各 +N（1 張）：N的雙倍多多冰暴風雪</li>
          <li>H 雙方所有備戰各 +N（1 張）：臭臭花灑口水</li>
          <li>I 自身下回合受招 -N（8 張）：超級暴雪王ex冰霜屏障 / 大炭車防守壓制 / 齒輪兒/齒輪組堅硬齒輪 / 赫普的鋼鎧鴉鋼翼 / 甲殼龍防守壓制 / 火箭隊的火焰鳥ex火焰屏障 / 珍珠貝硬殼壓制</li>
          <li>J 擲幣全正面 +K（1 張）：穿著熊必殺金勾臂</li>
          <li>K 自方場上條件 +N（2 張）：雷公電氣墜落 / 破破舵輪大地能量</li>
          <li>不動 effects.ts 主檔（只加 1 行 import）；I 標寶可夢招式覆蓋率 ~30 張提升</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.48</span> 實裝仙子伊布ex 兩招（H 標）</summary>
        <ul>
          <li>魔法魅惑 [PCC] 160 點傷害；下個對手回合，受到此招的寶可夢使用招式傷害「-100」 — 復用 defNextAtkReducePost(100)，對手換場 → clearActiveEffects 清旗標</li>
          <li>天仙石 [WLP] 0 點傷害；選 0~2 隻對手備戰寶可夢，連附加卡（能量/道具/進化來源）全部放回對手牌庫並重洗</li>
          <li>天仙石 anti-spam gate：使用後此 attacker 下回合無法再用「天仙石」（per-attacker via blockedAttackNamesNextTurn，跟「烈火爆進」同 pattern）</li>
          <li>清除回 deck 時所有臨時狀態（damage / 異常 / 各種旗標）都清成 fresh，evolvedFromStack 也一併還原</li>
          <li>檔案：effects.ts 在「泥巴魚｜飛撲圈套」附近插入 regPre/regPost + sylveon-skystone-bounce resolver</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.471</span> Bug fix — 麻麻鰻電氣發電機 / 勾帕路翁ex金屬之路 多隻只能發動 1 次</summary>
        <ul>
          <li>玩家回報：場上有複數的麻麻鰻時，特性「電氣發電機」仍然只能發動一次（應該每隻 1 次，總共 N 次）</li>
          <li>原因：v2.386 實作時誤把 per-instance gate（abilityUsedThisTurn）寫成 shared once-per-turn（abilityNamesUsedThisTurn）</li>
          <li>判斷規則：卡面寫「使出其他同名特性則無法使用」 → SHARED；卡面只寫「在自己的回合時可使用 1 次」 → per-instance</li>
          <li>修正 2 個誤判：移除「電氣發電機」「金屬之路」的 ad-hoc abilityNamesUsedThisTurn gate；改回 engine 自動的 per-instance abilityUsedThisTurn 處理</li>
          <li>順手把「扭轉乾坤」「殺手鐧捕捉」（卡面真的明文 SHARED）補進 engine.SHARED_ONCE_PER_TURN_ABILITY_NAMES，未來實作層忘記寫 gate 時 engine 也擋</li>
          <li>場上 2 隻麻麻鰻 → 各可發動 1 次「電氣發電機」（總共 2 次，需棄牌區有 2 張基本【雷】能量）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.47</span> 對戰演練 — 備戰區 8 格自適應（零之大空洞場景）</summary>
        <ul>
          <li>玩家回報：零之大空洞觸發後備戰上限 5→8，8 隻在原 layout 下會被切到</li>
          <li>新增雙保險自適應：bench 上限 &gt;5 時加 .bench-extended class</li>
          <li>(1) slot 自動縮小：min-width 90→78、max-width 128→112，1280px+ 螢幕能 8 隻完整顯示不需捲</li>
          <li>(2) 必要時橫向捲動：overflow-x: auto + 細滾動條（綠色配合遊戲主題）；觸控設備支援慣性捲動</li>
          <li>my + opp 兩個 bench 都套用，捲動互相獨立</li>
          <li>5 格上限的一般場景完全不影響（class 只在限制 &gt;5 才加）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.464</span> 實裝泥巴魚｜飛撲圈套（I 標）</summary>
        <ul>
          <li>卡面：30 點傷害；下個對手回合，受到此招的寶可夢無法撤退；下個自己回合，受到此招的寶可夢受到招式傷害「+100」</li>
          <li>復用既有兩個 helper：defCantRetreatNextPost（cantRetreatNextTurn）+ oppTargetTakeExtraNextPost（takeExtraDamageNextTurn）</li>
          <li>關鍵互動：若對手用「寶可夢交替」/「老大的指令」等強制把該寶可夢換到備戰 → 兩個旗標都會被 clearActiveEffects 清除（既有機制），+100 加成自動失效</li>
          <li>檔案：effects.ts 在「超音波幼蟲｜刺耳聲」附近插入 regPre/regPost</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.463</span> 對戰演練 — 1024×576 解析度 zoom 調更積極 + 加 70/65/60% 手動檔</summary>
        <ul>
          <li>玩家回報：1024×576 在 Mac Safari 上 v2.45 80% zoom 仍會切到右側卡牌（瀏覽器 UI 額外吃掉幾十 px 高度）</li>
          <li>auto 算法基準改 1280×720 → 1366×768；下限 0.6 → 0.55</li>
          <li>新公式：1024×576 → 約 75%；1280×720 → 約 94%；1366×768 → 100%（無縮放）</li>
          <li>設定下拉新增 70% / 65% / 60% 三檔；提示文字加「若還是看到卡牌被切，可手動往下調」</li>
          <li>之前選 80% 的玩家可能要重新設成 auto 或手動 70%；切版仍存在的話可降到 65% 或 60%</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.462</span> Bug fix — 蜜集大蛇ex｜蜜糖風暴永遠只 30 傷</summary>
        <ul>
          <li>玩家回報：蜜集大蛇ex 招式蜜糖風暴怎麼打都只有 30 傷害</li>
          <li>原因：原本只實裝特性（熟成充能），招式沒寫 regPre。卡面 damage 字串是 '30+'，引擎只取 parseInt = 30，無法套用「+30 × 自方所有寶可夢身上的【草】能量數」公式</li>
          <li>修正：lopunny_serperior_flareon_festival.ts 補 regPre('蜜集大蛇ex|蜜糖風暴') 計算 30 + 30 × Σ(grass energies on all own pokemon)</li>
          <li>實際範例：自方共 4 隻草寶可夢、各帶 1 個草能量 → 30 + 4×30 = 150；帶 8 個草能量 → 30 + 8×30 = 270</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.461</span> Hotfix — Svelte 把 changelog 文字 &#123;uid&#125; 當變數導致首頁空白</summary>
        <ul>
          <li>v2.46 changelog 寫了「users/&#123;uid&#125;」，Svelte template 把 &#123;uid&#125; 解析為變數→ uid 未定義 → ReferenceError → 整頁 mount 失敗</li>
          <li>修法：把 &#123; &#125; 換成 HTML entity &amp;#123; &amp;#125;，視覺一樣是大括號但 Svelte parser 不會解析</li>
          <li>新鐵律：Svelte template 內任何 user-facing &#123;…&#125; sample text，一律用 HTML entity 或全形括號，避免被當 expression</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.46</span> 安全性強化 — Firestore rules 收緊 + room 成員驗證</summary>
        <ul>
          <li>玩家個資私有化：users/&#123;uid&#125; 與 users/&#123;uid&#125;/decks 全部改為「only own-or-admin 可讀寫」（之前 read 是 public，導致 email / deviceId / userAgent / loginCount + 雲端牌組任何人可撈）</li>
          <li>意見回饋（feedbacks）讀權限改 admin-only（之前公開可讀）；create 加 content 字串長度驗證 1~5000 字</li>
          <li>對戰房間（rooms）update / delete 收緊：只允許房內成員（在 memberUids 內）或 host 才能寫入；新加 memberUids: string[] 欄位由 room.ts 在所有 seat 變動時自動維護</li>
          <li>聊天訊息（messages）加 schema 驗證：text 必須是字串、長度 1~500；name 字串長度 ≤ 50；防止繞過 client 端 200 字限制塞長文</li>
          <li>建房（rooms create）驗證：hostUid 必須是自己 + memberUids 必須含 hostUid</li>
          <li>不影響現有功能：deck 載入仍走 own uid（cloud.ts loadDecksFromCloud(uid) 不變）；lobby 列表 / 加入房間 / 對戰過程 / 聊天 全都不受影響</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.45</span> 對戰演練 — 1024×576 解析度模式（auto-fit zoom + 手動切換）</summary>
        <ul>
          <li>玩家反映 1024×576 螢幕容納不下原 tablet-layout（設計基準 1280×720），加 CSS zoom 機制</li>
          <li>新增「自動」模式：依視窗大小自動算 ratio = min(w/1280, h/720)，下限 0.6；&gt;0.97 則維持 100%；1024×576 自動會落在約 80%</li>
          <li>新增手動切換：100% / 90% / 80% / 75% 五檔可選；存入 localStorage 跨 session 保留</li>
          <li>UI：對戰演練畫面右上角設定 ⚙️ → 新增「🖥️ 畫面縮放」區塊；下拉選單 + 即時預覽當前縮放比例</li>
          <li>實作：CSS zoom 屬性套用於 .battle-root（modern Chrome/Safari/Edge/Firefox 126+ 都支援）；modal 內容也會跟著縮放，互動座標由瀏覽器自動轉換</li>
          <li>不影響桌機（≥1280×720）使用者；手機直式繼續走 MobilePortraitBattle 元件</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.44</span> SEO 完整化 — Meta tags / sitemap / robots</summary>
        <ul>
          <li>src/app.html 補完整 SEO + 社群預覽 meta（保留現有 PWA 設定）：keywords / robots / canonical / og:type/title/description/url/locale/site_name / twitter:card 等</li>
          <li>新增 static/sitemap.xml — 主路徑 4 條（/, /cards, /decks, /game），priority + changefreq + lastmod；GSC 可直接提交</li>
          <li>新增 static/robots.txt — Allow all + Disallow /_app/（SvelteKit 內部 chunk 對 SEO 無價值）+ Sitemap 指引</li>
          <li>title / description 強化關鍵字密度：PTCG / 寶可夢卡牌 / 台灣 / 繁體中文 / H I J 標 / 線上對戰 / 牌組構築</li>
          <li>v2.431 已 push GSC 驗證檔（static/googlec112ab47fcd31fe0.html）；本版本完成後可回 GSC 點驗證 + Sitemap 提交 sitemap.xml</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.43</span> 新增玩家社群連結 — LINE 群組</summary>
        <ul>
          <li>首頁新增「💬 玩家社群」區塊（在「對戰演練」與「版本更新記錄」之間），含 LINE 群組邀請 QR Code + 直連按鈕</li>
          <li>QR Code 圖片：static/line-group-qr.png（650×650 PNG，error correction H，從邀請 URL 自動產生）</li>
          <li>視覺：綠色漸層卡片背景，LINE 品牌色 #06C755 按鈕；響應式 layout（480px 以下置中）</li>
          <li>歡迎玩家加入群組找對手、討論牌組、回報 bug、追蹤更新</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.422</span> 修正 PASSIVE_ATTACK_BONUS 疊加副作用 — 飯匙蛇激動力量 / 仆斬將軍大將 / 電蜘蛛複眼</summary>
        <ul>
          <li>v2.42 改 engine loop 為「per-source 疊加 + NO_STACK set 例外」後，「這隻寶可夢使用的招式」型特性出現副作用：fn 內 att.name === 'X' gate，但 engine loop 對 bench 同名也 invoke fn 一次 → 場上 2 隻飯匙蛇 → +240 是錯的</li>
          <li>把 PASSIVE_ATTACK_BONUS 條目分成兩類：(A)「自己的 X 寶可夢使用的招式 +N」型 = 友方 attacker 主語，per-source 疊加（輝煌聲援/力之鹽/皇家聲援/勝利聲援/鈷藍指令）；(B)「這隻寶可夢使用的招式 +N」/「自己的『X』攻擊時」型 = 擁有特性者本人，條件式不疊加（激動力量/大將/複眼）</li>
          <li>新增到 PASSIVE_ATTACK_NO_STACK：激動力量（飯匙蛇場上有【惡】Mega ex 時 +120 一次）、大將（仆斬將軍 +30×對手已得獎賞，per-attacker）、複眼（電蜘蛛攻擊「擁有特性」對手 +50 一次）</li>
          <li>規則總結：卡面寫「這隻寶可夢使用的招式 / 自己的『X』攻擊時 +N」→ NO_STACK；卡面寫「自己的 X 寶可夢使用的招式 +N」→ 疊加</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.42</span> Bug fixes — 4 個常用卡互動修正</summary>
        <ul>
          <li>夜間學院 + 越橘的一步棋互動：原 filter 'Pokemon:Type=Darkness' 在 UI deck-search parser 沒有對應 case → 落到 generic Pokemon: 分支後比對 pokemonType==='Type=Darkness' 永遠 false → 即使夜間學院剛把超級耿鬼ex 放牌庫頂也找不到。改用專屬 'DarknessPokemon:TOP7' filter（限定 top7 + 只列【惡】寶可夢）</li>
          <li>超級沙奈朵ex 兩個招式（原本完全沒實裝）：盈溢祈願 — 0 + 從牌庫挑基本【超】能量依序附給每隻備戰寶可夢，重洗牌庫；超級交響樂 — 50 × 自己所有寶可夢身上附加的【超】能量總數。新檔 v2402_mega_gardevoir.ts</li>
          <li>竹蘭的羅絲蕾朵 +30 多隻疊加：原 PASSIVE_ATTACK_BONUS engine loop 對所有特性 dedup by ability name → 場上 2 隻只 +30。新增 PASSIVE_ATTACK_NO_STACK set 只含「大方」（卡面明文「不重複」），其他特性每隻場上擁有者都獨立加成。2 隻竹蘭的羅絲雷朵 → +60；比克提尼｜勝利聲援 / 鐵頭殼ex｜鈷藍指令 等也比照辦理</li>
          <li>閃焰王牌｜瞬間爆發力起手戰鬥場放置：新增 canBeInitialActiveCard helper（基礎 OR 含「瞬間爆發力」特性）；engine setup PLACE_ACTIVE check + dealOpeningHand mulligan 都改用此 helper；UI 增加 canSetupActiveSpecial flag 讓 Stage2 with 瞬間爆發力 可以拖到戰鬥場</li>
          <li>新鐵律：寫入大檔（engine.ts / effects.ts / +page.svelte）後務必驗證 file 完整性（mount layer 偶會截斷尾端 UTF-8 多位元組字元），需用 Python os.write+os.fsync+O_TRUNC pattern 寫入</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.41</span> I 標 Wave 2 — 抽牌/換場/牌庫搜能量批次實裝（11 張）</summary>
        <ul>
          <li>新檔 v2401_i_wave2_draw_swap_search.ts（240 行）— 含 4 個 helper factory + 4 組 declarative 表</li>
          <li>抽 N 張（2 張）：阿響的皮丘｜麻麻抽出 / 赫普的啪嚓海膽ex｜扣殺閃電</li>
          <li>自身換場（1 張）：風妖精｜急速折返</li>
          <li>對手換場（5 張）：駒刀小兵/蓋蓋蟲/怒鸚哥/萌芽鹿｜推倒、哈約克｜吼叫（復用 force-opp-swap resolver）</li>
          <li>牌庫挑基本能量附自身（3 張）：蛋蛋｜果實盈滿、急凍鳥｜冰冷羽擊、雷電雲｜充電</li>
          <li>helper：drawNPost / forceOppSwapPostInline / selfSwapPostInline / deckSearchBasicEnergyPost；resolver wave2-deck-energy-attach-self</li>
          <li>不動 effects.ts 既有實裝（只加 1 行 import）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.40</span> I 標 Wave 1 — Recharge + 狀態類批次實裝（declarative 風格）</summary>
        <ul>
          <li>新檔 v2400_i_wave1_recharge_status.ts — 用 helper factory + declarative array 大幅縮減 code 量（每張卡 1-2 行）</li>
          <li>Recharge 招式 7 張：利歐路｜加速突刺 / 自爆磁怪｜閃光伏特 / 雪暴馬｜冰霜颱風 / 赫普的蒼響ex｜無畏斬 / 厄鬼椪 碧草面具｜鬼之錘 / 派帕的獒教父ex｜大佬頭擊 / 棄世猴｜衝擊打擊</li>
          <li>純狀態（必中）4 張：隨風球｜不祥之風 / N的齒輪組｜轉轉齒輪 / 大吾的念力土偶｜不祥之光 / 火箭隊的臭臭泥｜渾身臭臭</li>
          <li>擲幣狀態 5 張：冰砌鵝｜嚴寒頭錘 / 三合一磁怪｜電擊 / 狩獵鳳蝶｜麻痺粉 / 青藤蛇｜緊束 / 鴨嘴火獸｜灼燒</li>
          <li>helper 復用：effects.ts 既有 statusPost / coinStatusPost（含憨憨臉/硬岩鬥能量/特殊能量 immunity 完整鏈）；本檔自定 inline rechargePost</li>
          <li>架構：對 effects.ts 主檔僅加 3 個 export（statusPost / coinStatusPost / selfHitPost）+ 1 個 import；不改既有實裝</li>
          <li>共 16 張 I 標寶可夢招式 effect 實裝；剩餘 22 張 Wave 1 候選含複雜複合效果留下波</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.389</span> J 標 5 張卡完全互動實裝</summary>
        <ul>
          <li>大嘴娃｜雙重食客 + 超級皮可西ex｜射攻月亮：新增 PreDiscardSpec scope='hand-energy'，+page.svelte UI handler 列出手牌能量卡讓玩家挑 0-2/0-4 張，regPre 改用 action.discardedEnergyIids</li>
          <li>瑪力露麗ex｜收集泡泡 + 白海獅｜沖刷：來源寶可夢身上能量 > 1 張時開 modal-choice 讓玩家選哪張能量；只 1 張走 fast path（仿能量轉移 v2.231 pattern）</li>
          <li>信使鳥｜幸福禮物：跨 player pending chain — Stage A actorIdx=dIdx 對手先選 0-3 張基本能量；Stage A resolver 附加完後觸發 Stage B actorIdx=aIdx 我方選 0-3 張；handle 雙方任一無基本能量的 path</li>
          <li>所有 5 張卡從「簡化版（自動處理）」轉為「完全互動」實裝；J 標真實裝 100%</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.388</span> J 標所有 stub 一口氣補完（光之翼/雙重屬性/鰭之化石/整人擊落）</summary>
        <ul>
          <li>光之翼補完：cursed-bomb resolver 加 immunity（彷徨夜靈/黑夜魔靈咒詛炸彈對超級皮可西ex 不放指示物）</li>
          <li>小碎鑽｜雙重屬性：engine.ts 弱點 + 抵抗力計算改用 attackerEffectiveTypes 陣列（小碎鑽攻擊時對方【鬥】或【超】弱點皆觸發 ×2）</li>
          <li>陳舊的鰭之化石被動：老大的指令（gust supporter）filter 排除鰭之化石（regG + reg validIids 過濾）</li>
          <li>堅果啞鈴｜整人擊落：_shared.ts 加 triggerOakeyeMillIfApplicable helper；effects.ts millOppDeckTopPost + v2360 龍捲風噴射 加 trigger 呼叫</li>
          <li>v2380_j_abilities 檔頭 stub 列表全部標為已真實裝</li>
          <li>J 標 audit 工具持續 100% pattern 命中；功能層真實裝率約 99% 以上</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.387</span> 超級皮可西ex｜光之翼真實裝</summary>
        <ul>
          <li>光之翼：超級皮可西ex 不受對手寶可夢特性效果影響</li>
          <li>engine.ts hook 1：冰冷之帳 checkup（line 3897 isFrosmothCheckupTarget）— 持有光之翼者免疫雪妖女放指示物</li>
          <li>engine.ts hook 2：攻擊 pipeline PASSIVE_RETALIATION（line 3534）— 攻擊方持有光之翼 → 免疫毒刺/灼熱之軀/反擊/尖刺盔甲等對手反擊特性</li>
          <li>未來補完：對手主動特性對此寶可夢造成效果（咒詛炸彈、整人擊落等）的 short-circuit</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.386</span> 麻麻鰻｜電氣發電機真實裝 + 鬥志戰吼確認</summary>
        <ul>
          <li>麻麻鰻｜電氣發電機（M2a/MC/SV11B 4 印）：在自己的回合可使用 1 次，從棄牌區選 1 張基本【雷】能量附於備戰寶可夢</li>
          <li>實作：仿奇跡修正檔兩階段 picker（discard-search BasicEnergy:Lightning → bench-choose → 附能量），一回合 1 次 abilityNamesUsedThisTurn gate</li>
          <li>勒克貓｜鬥志戰吼：v2.384 已實裝（engine.ts EVOLVE gate hasFightingHowl bypass），確認 hook 仍在 line 1622</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.385</span> J 標 2 個 stub 真實裝 + v2.384 重複 hook bug fix</summary>
        <ul>
          <li>狙射樹梟ex｜狙擊手之眼：對手手牌恰為 4 張時，狙射樹梟ex 招式所需的【無】能量全部消除（effects.ts 加 getDecidueyeSnipeEffectiveCost helper，仿酋雷姆三重冰霜 pattern；engine.ts cost 計算處加 overridden4 呼叫）</li>
          <li>耿鬼｜無限之影：受招式 KO 時，本體放回手牌（能量/道具/進化堆仍丟棄、仍給對手獎賞），engine.ts KO 處理 path 加 hook</li>
          <li>BUG FIX：移除 v2.384 加的重複「陳舊的顎之化石 -30」hook（v2.190 line 2903 早已實裝，v2.384 audit 失誤導致對手攻擊時被扣兩次 30 = -60 傷害）</li>
          <li>剩 4 個 stub 待後續：整人擊落 / 光之翼 / 雙重屬性 / 鰭之化石被動（皆需更大範圍 engine 改動）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.384</span> Audit 工具升級 + J 標 3 個 stub 真實裝</summary>
        <ul>
          <li>新增 scripts/audit-card-impl.mjs — 掃描 14 種實裝 pattern 全面 audit script，避免單 pattern 誤判（v2.39 化石/Stadium 教訓）</li>
          <li>AI_HANDOFF.md 補「卡牌實裝 audit 方法論」章節：列出 14 種 pattern + 接手前必跑 audit 鐵律</li>
          <li>陳舊的顎之化石被動：戰鬥場時對手招式傷害 -30（engine.ts 攻擊 pipeline 加 hook，仿 damageReduceNextHit pattern）</li>
          <li>勒克貓｜鬥志戰吼：對手戰鬥場為 ex 時，剛使出 / 最初回合可進化（engine.ts EVOLVE gate 加 hasFightingHowl bypass）</li>
          <li>勾帕路翁ex｜金屬之路：本回合從備戰上戰鬥場時，搬場上鋼能量到自身（regA + movedToActiveThisTurn gate + heal-target picker）</li>
          <li>J 標 audit 結果：221/221 全 pattern 命中（100%）；剩 5 個 stub 仍待 engine 級擴張（光之翼/雙重屬性/狙擊手之眼/無限之影/整人擊落 + 鰭之化石被動）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.383</span> v2.39 J 標訓練家 stub 修正 — 化石/Stadium 既有實裝確認</summary>
        <ul>
          <li>查證使用者反映：化石卡（陳舊的顎/鰭之化石）+ 密阿雷市 + 稜鏡塔之前已實裝過</li>
          <li>v2.39 stub 對這 3 張卡誤加 regG/reg 與「需 v2.4+ 擴張」log，覆蓋既有 noop reg + 留下誤導訊息</li>
          <li>v2390_j_trainers_batch.ts 改寫為純 audit 註解索引（移除所有錯誤 reg/regG 註冊）</li>
          <li>確認既有實裝路徑：化石卡走 items_misc.ts FOSSIL_NAMES_LOCAL + engine PLAY_FOSSIL action；密阿雷市 / 稜鏡塔走 engine USE_STADIUM case + stadiums.ts / mega_decks.ts resolver</li>
          <li>昂主花葉蒂保留 v2.382 真實裝（超級花葉蒂ex HP +150）</li>
          <li>J 標訓練家 audit 命中：29/29（全部正確覆蓋既有實裝路徑）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.382</span> J 標複雜特性續實裝 — 3 個 stub 轉真實裝</summary>
        <ul>
          <li>伊裴爾塔爾ex｜死亡靈魂：OHKO 對手所有 HP ≤50 寶可夢（用 +9999 damage + sanityKOSweep 處理 KO）</li>
          <li>超級呆殼獸ex｜殼捲風旋轉：retaliation 12 indicator（types.ts 加 retaliateCountersOnNextHit flag + engine.ts 在 PASSIVE_RETALIATION 後段套用）</li>
          <li>昂主花葉蒂（Stadium）：超級花葉蒂ex 最大 HP +150（engine.ts getEffectiveHP + effects.ts effectiveHPInline 雙處 hook 同步）</li>
          <li>J 標進度：寶可夢 effect 招式 25/27 完整、特性 27/33 完整（v2.38 24/33 → v2.382 27/33）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.381</span> 修復祭典樂舞第 3 次攻擊 bug</summary>
        <ul>
          <li>修復 bug：裹蜜蟲｜祭典樂舞在 2 次擊倒對手後仍可發第 3 次招</li>
          <li>原因：第 2 次招式 KO 後，TAKE_PRIZES / SEND_NEW_ACTIVE 觸發 maybeResumeFestivalDanceSecondAttack 時，flag 仍為 true → 又把 turnPhase 重設為 main，開放第 3 次攻擊</li>
          <li>修法：types.ts 新增 festivalDanceSecondAttackUsed flag（第 2 次招式 spent 標記），engine.ts 在 startFestivalDanceSecondAttackWindow / maybeResumeFestivalDanceSecondAttack 雙 hook 處檢查；END_TURN 同步清除</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.38</span> J 標補實裝大批次（92.6% 覆蓋）</summary>
        <ul>
          <li>新實裝 J 標寶可夢 effect 招式 25 個：雙重食客 / 殼捲風旋轉 / 閃光伏特 / 射攻月亮 / 巨岩墜落 / 蓋亞波 / 死亡靈魂 / 黑暗打擊 / 狡兔三窟 / 地震 / 九尾狐搬動 / 幸福禮物 / 小使者 / 大地風暴 / 岩石投擲 / 毒液衝擊 / 防守壓制 / 力量衝撞 / 咬碎 / 雷吉充能 / 能量氣球 / 衝擊打擊 / 能量粉碎 / 耳之力 / 勇鳥猛攻</li>
          <li>新實裝 J 標寶可夢特性 5 個：白海獅｜沖刷、瑪力露麗ex｜收集泡泡、青木的樹枕尾熊｜無力充能、超級皮可西ex｜光之翼（stub）、小碎鑽｜雙重屬性（stub）</li>
          <li>J 標訓練家補實裝：化石卡（陳舊的顎/鰭之化石 stub）+ 3 個 Stadium（密阿雷市/昂主花葉蒂/稜鏡塔 stub）</li>
          <li>J 標進度：寶可夢 177/186 完整、訓練家 29/29 完整、特殊能量 6/6 完整 — 整體 212/229（92.6%）</li>
          <li>剩 9 個複雜特性留 stub（狙擊手之眼/鬥志戰吼/無限之影/整人擊落/金屬之路 等需 engine 級 hook）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.374</span> 火箭腦力實裝 + tsc 警告全清 + AI_HANDOFF 鐵律補充</summary>
        <ul>
          <li>新實裝特性：火箭隊的以歐路普｜火箭腦力（移動「火箭隊的」寶可夢身上指示物到自己其他寶可夢）</li>
          <li>tsc 既有警告從 86 個全部清乾淨：v2306 inst undefined gate（51 個）、v168 drawCards 老 API 重構（14 個）、abra_mawile_deck params 型別（7 個）、其他散落 14 個</li>
          <li>AI_HANDOFF.md 補新鐵律：os.write+fsync+O_TRUNC 寫大檔範本 + 接手前自查（避免 mount layer truncation 殘留）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.373</span> UI 補版本更新記錄</summary>
        <ul>
          <li>補回 v2.37 / v2.371 / v2.372 三條紀錄（之前 push 但 changelog 沒同步）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.372</span> 監視之眼通用標籤化 + 修 v172 末尾截斷</summary>
        <ul>
          <li>探探鼠｜監視之眼改用通用標籤 set（MOVE_DAMAGE_COUNTER_ABILITIES）統一 gate 移放傷害指示物類特性</li>
          <li>目前覆蓋：願增猿｜腎上腺腦力、火箭隊的以歐路普｜火箭腦力（全資料庫掃描共 2 條再印 6 套）</li>
          <li>未來新增同類特性只需把名字加進 set 即可自動受監視之眼禁用</li>
          <li>修復 v172_hij_batch.ts 末尾 UTF-8 截斷（v2.360 commit 留下的孤兒 byte）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.371</span> 魔靈寶石海星牌組微調 + 探探鼠監視之眼補實裝</summary>
        <ul>
          <li>魔靈超級寶石海星牌組：基本【惡】能量 3→2 張，補 1 張赤松</li>
          <li>探探鼠｜監視之眼補實裝：場上有探探鼠時，雙方願增猿｜腎上腺腦力等「移放傷害指示物」特性無法使用</li>
          <li>可達鴨｜濕氣：交叉確認 v2.65 既存實裝（hasPsyduckDamp）已涵蓋 M2a 14692 可達鴨</li>
          <li>tsc 既有警告大量清理：updatedAt/createdAt 型別不同步 + sfx.ts 補 Fairy 屬性（從 ~600+ 降至 86）</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.37</span> 新增 5 套預設牌組（魔靈寶石海星/寶石猛雷鼓/月月熊赫月/岩殿居蟹/遠古巨蜓）</summary>
        <ul>
          <li>新增預設牌組：魔靈超級寶石海星 / 寶石猛雷鼓 / 月月熊 赫月 / 岩殿居蟹 / 遠古巨蜓（共 5 套）</li>
          <li>新實裝招式：石居蟹｜覺醒（從牌庫直接進化）、岩殿居蟹｜偉大剪（120 + 跳過附加效果）</li>
          <li>新實裝招式：蜻蜻蜓｜吹飛（強制對手換場）、雷吉奇卡斯｜寶石破壞（對太晶寶可夢 +230）</li>
          <li>班基拉斯牌組微調：競技場「危險密林」改為「險惡廢墟」</li>
          <li>既有實裝交叉確認：雪妖女｜冰冷之帳、岩殿居蟹｜神秘石居、海星星/雪妖女/蜻蜻蜓銳利羽/可達鴨衝撞/探探鼠咬住等純傷害招式</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.363</span> 修復桃歹郎ex｜支配鎖鏈備戰特性</summary>
        <ul>
          <li>修復「支配鎖鏈」備戰特性：移除錯誤的「必須在戰鬥場」限制，桃歹郎ex 在備戰區也能正常使用特性</li>
        </ul>
      </details>
            <details>
        <summary><span class="ver-badge">v2.362</span> 新增 4 套預設牌組 + 特性消除機制</summary>
        <ul>
          <li>新增預設牌組：班基拉斯 / 超級蒂安希 / 寶石大竺葵 / 超級巨牙鯊（共 4 套）</li>
          <li>新實裝效果：振翼髮｜暗夜羽擊（消除對手特性）、班基拉斯｜威迫目光（封對手物品卡）</li>
          <li>新實裝效果：超級巨牙鯊ex｜飢渴下巴、輕飄飄｜海之影、伊裴爾塔爾｜黑暗羽毛、幼基拉斯｜咬碎</li>
        </ul>
      </details>
      <details>
        <summary><span class="ver-badge">v2.361</span> Bug 修復批次 — 5項修正</summary>
        <ul>
          <li>Bug #17 擔架：棄牌區寶可夢取回後，清除 KO 前的狀態異常與傷害指示物</li>
          <li>Bug #18 借用技能（耀閃挑戰/暗黑底牌）：弱點/抗性改依使用者屬性計算</li>
          <li>Bug #19 金屬怪特性：查看牌庫頂 4 張，不再顯示整個牌庫</li>
          <li>Bug #20 捕蟲組合：草系寶可夢（含進化）可正常選取</li>
          <li>Bug #21 AI 卡住：席多藍恩打死對手後，AI 等待對手補場再繼續</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.360</span> J標第5批次 — 8組效果</summary>
        <ul>
          <li>波爾凱尼恩｜強力蒸汽：每次正面 +90 傷（依水能量數量擲幣）</li>
          <li>彩粉蝶｜穿堂風：場地中時 120，無場地 60</li>
          <li>超級火炎獅ex｜大爆炎之火：290 − 自身已受傷</li>
          <li>妙喵｜拍檔攻擊：本回合打出瑪琪艾兒時 70，否則 10</li>
          <li>河馬獸｜龍捲風噴射：本回合打出塔拉剛時，對手牌組頂端 3 張送棄牌堆</li>
          <li>代歐奇希斯｜精神防護：下回合免疫擁有特性的寶可夢招式傷害</li>
          <li>具甲武者｜要害斬：KO 對手時，下回合免疫所有招式傷害與效果</li>
          <li>小木靈｜怨恨進化：從手牌選定進化牌覆蓋自身，繼承能量/道具並 +20 傷</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.359</span> J標第3/4批次 — 33項效果</summary>
        <ul>
          <li>擲幣失敗後觸發的懲罰效果（自傷、換場等）</li>
          <li>封退效果：被指定寶可夢本回合無法撤退</li>
          <li>自愈效果：攻擊後回復自身指定傷害</li>
          <li>條件傷害：依對手狀態/道具/能量數量調整傷害</li>
          <li>能量棄置：攻擊後棄掉自身或對手的能量</li>
          <li>搜尋效果：攻擊後從牌組搜尋特定牌</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.355</span> J標批次 — 多張特殊效果</summary>
        <ul>
          <li>代歐奇希斯｜精神強念：免疫非 EX/V 招式傷害</li>
          <li>哲爾尼亞斯｜大地之門 / 光明角擊</li>
          <li>冰雪巨龍｜冰冷寒氣 / 凍原堡壘</li>
          <li>具甲武者｜潛力：依手牌中招式卡數計算傷害</li>
          <li>鑰圈兒｜記憶之鎖、怪顎龍｜亂暴 / 暴龍根性</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.354</span> J標第2/3批次 — 13張卡效果</summary>
        <ul>
          <li>多張 J 標卡牌攻擊效果與特性實裝（P2/P3 批次）</li>
          <li>包含狀態異常附加、換場指令、能量搜尋等機制</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.353</span> J標第1批次 — 基礎效果群</summary>
        <ul>
          <li>J 標低複雜度效果群首批實裝</li>
          <li>固定傷害、簡單加乘、基礎狀態異常等招式效果</li>
        </ul>
      </details>

      <details>
        <summary><span class="ver-badge">v2.346–2.352</span> J標前期批次</summary>
        <ul>
          <li>v2.352：J標低複雜度效果第二輪</li>
          <li>v2.349：J標 P1 剩餘效果、奇跡修正檔備戰目標修正</li>
          <li>v2.348：J標狀態異常批次</li>
          <li>v2.347：J標備戰區傷害批次</li>
          <li>v2.346：J標簡易效果批次</li>
        </ul>
      </details>

    </div>
    </details>
  </section>
  <section class="feedback-section">
    <h2>💬 意見回饋</h2>
    <p>
      發現 Bug 或是對模擬器有任何建議嗎？
      <button class="link-btn" onclick={() => showFeedbackModal = true}>點此提交意見 →</button>
    </p>
  </section>

  {#if showFeedbackModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="modal-overlay" onclick={() => { if(!feedbackSubmitting) showFeedbackModal = false; }} role="dialog">
      <div class="modal-content" onclick={e => e.stopPropagation()}>
        <h3>提交意見回饋</h3>
        {#if feedbackStatus === 'success'}
          <div class="success-msg">✅ 感謝你的回饋！已成功送出。</div>
        {:else}
          <textarea 
            bind:value={feedbackText} 
            placeholder="請描述你遇到的問題或建議..."
            rows="5"
            disabled={feedbackSubmitting}
          ></textarea>
          {#if feedbackStatus === 'error'}
            <div class="error-msg">❌ 提交失敗，請稍後再試。</div>
          {/if}
          <div class="modal-actions">
            <button class="btn-cancel" onclick={() => showFeedbackModal = false} disabled={feedbackSubmitting}>取消</button>
            <button class="btn-submit" onclick={submitFeedback} disabled={!feedbackText.trim() || feedbackSubmitting}>
              {feedbackSubmitting ? '送出中...' : '送出'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <footer class="disclaimer">
    <p>本站為熱愛 PTCG 的粉絲自製非營利專案，旨在推廣寶可夢集換式卡牌實體遊戲。</p>
    <p>所有卡牌圖像、文字與商標之智慧財產權均歸屬 The Pokémon Company、Nintendo、Creatures Inc. 及 GAME FREAK inc. 所有。<br/>本站之卡牌資料皆取自於 <a href="https://asia.pokemon-card.com/tw/" target="_blank" rel="noopener noreferrer">寶可夢集換式卡牌遊戲官方主頁「訓練家網站」in 台灣</a>。</p>
    <p>本站絕無意侵犯官方權益，若版權方認為有任何不妥，請透過 <a href="mailto:suenz001@yahoo.com.tw">聯絡我們</a> 告知，本站將立即配合下架修改。</p>
  </footer>
</main>

<style>

  .version { font-size: 0.75rem; font-weight: 400; color: #888; font-family: monospace; vertical-align: middle; margin-left: 0.3rem; background: #e8e4ee; padding: 0.1rem 0.4rem; border-radius: 3px; }
  main {
    max-width: 680px;
    margin: calc(2rem + env(safe-area-inset-top, 0)) auto 2rem;
    padding: 0 1.25rem 3rem;
    font-family: system-ui, -apple-system, 'Microsoft JhengHei', sans-serif;
    line-height: 1.6;
    color: #1a1a1a;
  }
  h1 {
    margin-bottom: 0.25rem;
  }
  .tagline {
    color: #666;
    margin-top: 0;
  }
  section {
    margin-top: 1.5rem;
    padding: 1rem 1.25rem;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    background: #fff;
  }
  h2 {
    margin-top: 0;
    font-size: 1.05rem;
    color: #333;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
  }
  dt {
    color: #888;
    font-weight: 500;
  }
  dd {
    margin: 0;
  }
  .uid {
    font-family: ui-monospace, 'Cascadia Code', monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }
  .error {
    color: #c00;
  }
  ol {
    margin: 0;
    padding-left: 1.5rem;
  }
  li {
    margin-bottom: 0.25rem;
  }
  a {
    color: #0066cc;
    text-decoration: none;
    font-weight: 500;
  }
  a:hover, .link-btn:hover {
    text-decoration: underline;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: #0066cc;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .feedback-section {
    background: #f8fbff;
    border-color: #cce0ff;
  }
  .changelog-section {
    background: #fafafa;
    border-color: #e0e0e0;
  }
  .changelog-outer > summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
  }
  .changelog-outer > summary::-webkit-details-marker { display: none; }
  .changelog-outer > summary h2 {
    margin: 0;
    user-select: none;
  }
  .changelog-outer > summary h2::before {
    content: "▶ ";
    font-size: 0.75em;
    color: #888;
    margin-right: 0.3em;
  }
  .changelog-outer[open] > summary h2::before {
    content: "▼ ";
  }
  .changelog-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  details {
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    background: #fff;
    overflow: hidden;
  }
  details[open] {
    border-color: #c8d8f0;
    background: #f5f9ff;
  }
  summary {
    padding: 0.55rem 0.85rem;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    color: #333;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    user-select: none;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before {
    content: '\25B6';
    font-size: 0.65rem;
    color: #999;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  details[open] summary::before {
    transform: rotate(90deg);
  }
  .ver-badge {
    font-family: ui-monospace, 'Cascadia Code', monospace;
    font-size: 0.78rem;
    font-weight: 600;
    background: #e8edf5;
    color: #3a5a8a;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    flex-shrink: 0;
  }
  details[open] .ver-badge {
    background: #d0e3fa;
    color: #1a4a8a;
  }
  details ul {
    margin: 0;
    padding: 0.5rem 0.85rem 0.7rem 1.8rem;
    font-size: 0.85rem;
    color: #444;
    line-height: 1.7;
  }
  details li {
    margin-bottom: 0.1rem;
  }

  .hint {
    color: #888;
    font-size: 0.85rem;
    margin-left: 0.5rem;
  }
  .disclaimer {
    margin-top: 2.5rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid #ddd;
    font-size: 0.8rem;
    line-height: 1.7;
    color: #888;
  }
  .disclaimer p {
    margin: 0.3rem 0;
  }
  .disclaimer a {
    color: #0066cc;
    font-weight: 500;
    font-size: 0.8rem;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal-content {
    background: #fff;
    border-radius: 12px;
    padding: 1.5rem;
    width: 100%;
    max-width: 500px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
  }
  .modal-content h3 {
    margin-top: 0;
    margin-bottom: 1rem;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.75rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-family: inherit;
    resize: vertical;
    margin-bottom: 1rem;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }
  .modal-actions button {
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-cancel {
    background: #f0f0f0;
    border: 1px solid #ccc;
    color: #333;
  }
  .btn-submit {
    background: #0066cc;
    border: 1px solid #005bb5;
    color: white;
  }
  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .success-msg {
    color: #2c7a3c;
    background: #e6f6e6;
    padding: 1rem;
    border-radius: 6px;
    text-align: center;
    font-weight: 500;
  }
  .error-msg {
    color: #c00;
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  /* v2.43 玩家社群區塊 */
  .community-section {
    background: linear-gradient(135deg, #f0f9f0 0%, #e8f5e8 100%);
    border: 1px solid #c8e6c8;
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-top: 1.5rem;
  }
  .community-section h2 {
    margin-top: 0;
  }
  .community-desc {
    margin: 0 0 1rem 0;
    color: #2c4a2c;
    font-size: 0.95rem;
  }
  .community-card {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .qr-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    background: #fff;
    padding: 0.75rem;
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  }
  .qr-image {
    width: 140px;
    height: 140px;
    display: block;
    image-rendering: pixelated;
  }
  .qr-caption {
    font-size: 0.78rem;
    color: #555;
  }
  .link-block {
    flex: 1;
    min-width: 200px;
  }
  .link-label {
    margin: 0 0 0.6rem 0;
    color: #2c4a2c;
    font-size: 0.95rem;
  }
  .line-button {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    background: #06C755;
    color: #fff !important;
    padding: 0.7rem 1.2rem;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    font-size: 1rem;
    transition: background 0.15s, transform 0.1s;
    box-shadow: 0 2px 6px rgba(6,199,85,0.25);
  }
  .line-button:hover {
    background: #05a847;
    transform: translateY(-1px);
  }
  .line-icon {
    background: #fff;
    color: #06C755;
    font-weight: 800;
    font-size: 0.78rem;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    letter-spacing: 0.05em;
  }
  .community-hint {
    margin: 0.6rem 0 0 0;
    font-size: 0.78rem;
    color: #5a7a5a;
  }
  @media (max-width: 480px) {
    .community-card {
      justify-content: center;
    }
    .link-block {
      text-align: center;
    }
  }
</style>
