/**
 * ⭐⭐⭐v6.198 `stale-version` 診斷指紋的**送出判準** —— 唯一判定點。
 *
 * ⚠⚠ 先講清楚這支**不是**什麼：它只決定「要不要把一包診斷資料送給站長」。
 *   看門狗的自癒行為（tForceResync ＋ startTournamentPoll）在呼叫端的 if **之外**、
 *   無條件執行，與這支完全無關。收緊判準絕不會讓任何一台卡住的畫面失去自救能力。
 *
 * ── 為什麼要收緊 ────────────────────────────────────────────────────────
 *   v6.151 起的舊判準是「看門狗連續觸發 3 次 ∧ playing ∧ 版本沒前進 ∧ 盤面 60 秒沒動」。
 *   拿 2026-08-16 的 7 天 dump（407 筆 / 93 人）逐筆回放，成因分佈是：
 *     ・對手回合停滯（對手在長考）      157 筆 38.6%
 *     ・自己回合停滯（自己在長考）       79 筆 19.4%
 *     ・舊 client（判準更寬）            82 筆 20.1%
 *     ・輪詢真的不通（sincePollOk>=5s）  68 筆 16.7%
 *     ・真漏接（伺服器有動作我沒更新）    4 筆  1.0%
 *   ⚠ 措辭要精確：**長考類合計 236 筆 ＝ 58.0%**；「89%」講的是收緊後的**降幅**
 *   （407→43，降 89.4%），不是假陽性率 —— 兩個數字別混用。
 *   另外 202/407（49.6%）是同一間房雙方各報一次的**鏡像重複**。
 *   「盤面 60 秒沒動」本身不是異常 —— 對局裡想 60 秒是家常便飯。
 *   ⇒ 改成三取一，任何一條都成立不了就**不送**。
 *
 * ── ⚠⚠ 三個必須誠實記下來的盲區（收緊的已知代價，站長已接受）──────────
 *   1. **「伺服器根本沒動作、但 client 真的壞掉」三條都抓不到**（例如 v6.175 的
 *      pending-token 死鎖：我的答案被丟掉、雙方都在等我）。那時
 *      `sinceStateChange ≈ sinceLastAction`（b 假）、`srvActor === localActor`（c 假）、
 *      輪詢健康（a 假）。這一類在舊判準裡被歸進「自己在長考 79 筆」那一格。
 *      殘存的偵測路徑只有玩家自己按「等待對手 🔄」（manual-sync）。
 *   2. **長輪詢一旦啟用，(a) 幾乎變成死條件**：整段新鮮度看門狗被 `!_lpInFlight`
 *      gate 住（v6.155），而長輪詢一回來就立刻重送 ⇒ tick 進得來的那一刻
 *      `_tLastPollOkAt` 剛更新、`sincePollOk≈0`。目前灰度旗標預設關閉所以 (a) 有效；
 *      站長哪天打開長輪詢，(a) 就只剩「長輪詢 30 秒逾時」那條路徑。
 *   3. **對手掉線不會自己產生回報**（見 `oppQuiet` 欄的說明）。
 *
 * ── 三個條件（缺一不報）────────────────────────────────────────────────
 *   (a) 頁面在前景，而且輪詢已經 >= 15 秒沒有成功回應。
 *       ＝這台裝置**真的**連不上（背景頁籤的計時器被瀏覽器節流，那是正常的，所以要求前景）。
 *   (b) 伺服器上「最後一次真的有人動作」比「我的盤面最後一次變動」晚了 15 秒以上。
 *       ＝伺服器動過、我沒跟上 ⇒ 這才是「漏接」的定義。
 *   (c) 伺服器權威的該動作座位，與我這邊算出來的不一致。
 *       ＝我的盤面與伺服器對「現在輪到誰」的認知已經分岔。
 *
 * ⚠⚠ (b) 為什麼要 `sinceLastAction > 0`：那個值是 `Date.now() - tLastActionAt`，
 *   而 `tLastActionAt` 是**伺服器**時間。裝置時鐘慢的人會算出負數（實測 dump 裡有
 *   -11 秒、-77 秒、甚至 -4.9 小時的樣本），負數會讓 (b) 的差值無條件變超大 ⇒
 *   把「裝置時鐘不準」誤報成「漏接」。少了這道守衛，同一份 dump 會多命中 4 筆全是時鐘偏差。
 *   ⚠ 這裡刻意**不**用 tClockOffset 校正：payload 裡的 sinceLastAction 也是用未校正的
 *     Date.now() 算的，兩邊必須逐字一致，站長事後拿 dump 回放才會得到同一個答案。
 *
 * ⚠ (c) 兩邊都必須是數字才比。`srvActor` 在 v6.157 以前的伺服器／截斷列會是
 *   null／缺席 —— 「拿不到」不可以被讀成「不一致」（fail-closed：不確定就不送）。
 */

/** 輪詢多久沒回應才算「這台裝置真的連不上」（條件 a）。 */
export const STALE_POLL_STALL_MS = 15000;
/** 伺服器動作領先本地盤面多久才算「漏接」（條件 b）。 */
export const STALE_ACTION_LEAD_MS = 15000;

export interface StaleDiagInput {
  /** document.visibilityState；拿不到給 null。 */
  vis: string | null;
  /** Date.now() - 上次輪詢成功；沒有紀錄給 -1（與診斷 payload 的 poll.sincePollOk 同一個算式）。 */
  sincePollOk: number;
  /** Date.now() - 盤面上次真的變動；沒有紀錄給 -1（＝payload 的 poll.sinceStateChange）。 */
  sinceStateChange: number;
  /** Date.now() - 伺服器 lastActionAt；沒有紀錄給 -1（＝payload 的 poll.sinceLastAction）。 */
  sinceLastAction: number;
  /** 伺服器權威的該動作座位；拿不到給 null／undefined（＝payload 的 poll.srvActor）。 */
  srvActor: number | null | undefined;
  /** 本地推算的該動作座位；拿不到給 null／undefined（＝payload 的 state.actorSeat）。 */
  localActor: number | null | undefined;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 回傳觸發的條件字母（可能多條，例如 `'ac'`）；三條都不成立回 `null`＝**不要送**。
 * ⚠ 回傳的字串會原樣寫進診斷 payload 的 `poll.staleWhy`，站長／dump 摘要靠它分辨
 *   「這筆是新判準送出的、而且是哪一條」。不要改字母的意義。
 */
export function staleVersionDiagWhy(i: StaleDiagInput | null | undefined): string | null {
  if (!i) return null;
  let why = '';
  // (a) 前景 ∧ 輪詢真的沒回來
  if (i.vis === 'visible' && isNum(i.sincePollOk) && i.sincePollOk >= STALE_POLL_STALL_MS) why += 'a';
  // (b) 伺服器動過、我沒跟上（負值＝裝置時鐘偏差，一律不採信）
  if (isNum(i.sinceStateChange) && isNum(i.sinceLastAction)
    && i.sinceStateChange > 0 && i.sinceLastAction > 0
    && (i.sinceStateChange - i.sinceLastAction) > STALE_ACTION_LEAD_MS) why += 'b';
  // (c) 誰該動作，伺服器與我不一致
  if (isNum(i.srvActor) && isNum(i.localActor) && i.srvActor !== i.localActor) why += 'c';
  return why || null;
}
