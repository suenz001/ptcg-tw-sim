/**
 * v6.160 版本比較 —— 錦標賽報到的「client 太舊」判定唯一來源。
 *
 * ⚠⚠⚠ 這支函式的每一條失敗路徑都必須 **fail-open**（回 false ＝ 不擋人）。
 *   站長裁定：本站是練習站，「寧可放一個舊 client 進來，也不要把人擋在賽外」。
 *   把玩家擋在報到之外＝他打不了那場比賽，代價遠高於一個舊 client 拖慢對手。
 *
 * ⭐ 版本語義是 **十進位小數**，不是「段落（semver）」。
 *   `src/lib/version.ts` 的規則寫得很明白：小更新 +0.01、大更新 +0.1、重大 +1。
 *   歷史上真的出現過 `1.09` → `1.1`（1.1 比較新）。
 *   若照 semver 的「段落各自當整數比」會得到 [1,9] > [1,1] ⇒ **判反**。
 *   ⇒ minor 一律「右側補 0 到等長」再比，等同比較小數部分：
 *       '1.09' vs '1.1'   → '09' vs '10' ⇒ 1.1 較新   ✅
 *       '6.9'  vs '6.159' → '900' vs '159' ⇒ 6.9 較新 ✅
 *       '6.2'  vs '6.10'  → '20' vs '10'  ⇒ 6.2 較新  ✅
 *     （字串比在上面幾組剛好也對，但 '10.0' vs '6.159' 就會判反 ⇒ 不能用字串比。）
 *   ⭐ 副作用（正面的）：Mongo 若把門檻存成數字，`String(6.150)` 會變 `'6.15'`，
 *     而 '6.15' 與 '6.150' 在本語義下**完全相等** ⇒ 尾隨零遺失不會讓門檻靜默降級。
 */

/** major 與 minor 都不接受超長字串：minor 超過 9 位就退出 Number 的安全整數範圍。 */
const VER_RE = /^(\d{1,4})\.(\d{1,9})$/;

function parseVer(v: unknown): { major: number; minor: string } | null {
  if (typeof v !== 'string') return null;
  const m = VER_RE.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] };
}

/**
 * `cur` 是否比 `min` 舊（＝該提示更新）。
 *
 * ⚠ 任何一邊解析不出來（空字串、undefined、`'6.'`、`'.9'`、`'6.0.1'` 三段式、
 *   超長數字、非字串…）一律回 **false**。「認不出來」永遠等於「不擋」。
 */
export function isClientTooOld(cur: unknown, min: unknown): boolean {
  const a = parseVer(cur);
  const b = parseVer(min);
  if (!a || !b) return false;                 // fail-open：解析不出來就不擋
  if (a.major !== b.major) return a.major < b.major;
  // 十進位小數比較：右側補 0 到等長後當整數比（不用 parseFloat，避免二進位浮點誤差）
  const len = Math.max(a.minor.length, b.minor.length);
  const av = Number(a.minor.padEnd(len, '0'));
  const bv = Number(b.minor.padEnd(len, '0'));
  if (!Number.isSafeInteger(av) || !Number.isSafeInteger(bv)) return false;   // fail-open
  return av < bv;
}

/**
 * 這一次載入是不是「剛剛才按過強制更新」進來的？
 *
 * ⭐ 訊號來源刻意選 URL 上的 `_v=<timestamp>` —— 那是 `hardRefreshNow()` 本來就會加的參數。
 *   **不用 sessionStorage / localStorage**，理由是 fail-open：
 *     ① Safari 無痕／儲存被政策關閉時 `setItem` 會 **throw**。若逃生鈕的第一步是 setItem，
 *        那一 throw 就把「先不更新，直接報到」整條路徑打斷 ⇒ 玩家被鎖在賽外（正是硬約束①要防的）。
 *     ② 讀 URL 不會 throw、不需要任何權限、清快取也清不掉它。
 *   ⇒ 「更新過一輪、版本仍舊」的 fail-open 靠這個判：有新鮮的 `_v` 就不再擋。
 *
 * @param href  完整網址（測試可注入）
 * @param now   現在時間（測試可注入）
 * @param windowMs 視為「剛更新過」的時間窗，預設 10 分鐘（重載＋重新登入可能要好一會）
 */
export function recentlyHardRefreshed(href: unknown, now: number, windowMs = 600000): boolean {
  if (typeof href !== 'string' || !href) return false;
  let raw: string | null = null;
  try {
    raw = new URL(href).searchParams.get('_v');
  } catch {
    // 不是合法網址（測試/非瀏覽器環境）→ 退回字串比對，仍然不 throw
    const m = /[?&]_v=(\d+)/.exec(href);
    raw = m ? m[1] : null;
  }
  if (!raw || !/^\d{1,15}$/.test(raw)) return false;
  const t = Number(raw);
  if (!Number.isSafeInteger(t)) return false;
  // ⚠ 只認「過去 windowMs 內」。未來的時間戳（玩家時鐘偏掉／有人手動塞 `_v`）也放行 ——
  //   方向要選對：這個述詞回 true ＝ **不擋人**，寬鬆的一邊才是安全的一邊。
  if (t > now) return true;
  return now - t < windowMs;
}
