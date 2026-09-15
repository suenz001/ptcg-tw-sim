// ═══════════════════════════════════════════════════════════════════════════
// v6.387 部署驗收的**判準單一來源**（IRON_RULES Rule 38：同一個判準只能有一份）
//
// 這裡**零 I/O**：只有「怎麼從文字解析出版本號」與「四條線怎麼判定」。
//   ・scripts/verify-deploy.mjs      → 負責抓網頁、印報告（站長跑的那支）
//   ・scripts/test-v6387-…mjs 守衛   → 直接 import 這裡的函式測判準
// ⇒ 守衛驗的就是站長實際跑的那一份判準，不是抄一份到測試裡（那是安慰劑）。
//
// ⚠⚠ **fail-closed**：抓不到／解析不出來一律算「不通過」。
//    「查不到 ⇒ 大概沒事」是這個專案最容易釀成事故的推論。
// ═══════════════════════════════════════════════════════════════════════════

/** 從 src/lib/version.ts 取 VERSION（例：6.386）。取不到回 null。 */
export const verFromVersionTs = (s) =>
  (String(s ?? '').match(/VERSION\s*=\s*'([0-9][0-9.]*)'/) || [])[1] ?? null;

/** 從 changelog.html 取**第一則**的版本徽章（例：v6.386）。取不到回 null。 */
export const firstChangelogVer = (s) =>
  (String(s ?? '').match(/<span class="ver-badge">(v[0-9][0-9.]*)<\/span>/) || [])[1] ?? null;

/** 從 admin.html 取 window.SITE_VERSION_HINT（例：6.386）。取不到回 null。 */
export const adminHint = (s) =>
  (String(s ?? '').match(/SITE_VERSION_HINT\s*=\s*'([0-9][0-9.]*)'/) || [])[1] ?? null;

/**
 * 四條線的判定。每一條都對應一支 bat（或「不必跑 bat」）。
 *
 * @param {object} v
 *   localVer / ghVer / prodHint   —— 版本號字串（6.386）或 null
 *   localFirst / testFirst / prodFirst —— changelog 徽章（v6.386）或 null
 *   errs —— { gh, test, prod, admin } 抓取失敗的原因字串（可缺）
 * @returns {Array<{no,name,want,got,ok,bat,note?}>}
 */
export function evaluate(v) {
  const e = v.errs ?? {};
  const miss = (val, err, what) => val ?? `(${err ?? '解析不出' + what})`;
  // ⚠ 兩邊都拿得到**而且**相等才算過 —— 任一邊是 null 就不過（fail-closed）
  const eq = (a, b) => !!(a && b && a === b);

  return [
    {
      no: '①',
      name: '本機 → GitHub（push 了沒）',
      want: v.localVer ?? '(本機讀不到)',
      got: miss(v.ghVer, e.gh, '版本號'),
      ok: eq(v.localVer, v.ghVer),
      bat: null,
      batHint: '（不必跑 bat，是 git push 的事）',
    },
    {
      no: '②',
      name: 'GitHub → 測試站（GitHub Pages）',
      want: v.localFirst ?? '(本機讀不到)',
      got: miss(v.testFirst, e.test, '版本號'),
      ok: eq(v.localFirst, v.testFirst),
      bat: null,
      batHint: '（不必跑 bat，等 deploy.yml 的兩個 job 都 success）',
    },
    {
      no: '③',
      name: '⭐ 測試站 → 正式站【玩家前端】',
      want: v.testFirst ?? '(測試站抓不到)',
      got: miss(v.prodFirst, e.prod, '版本號'),
      ok: eq(v.testFirst, v.prodFirst),
      bat: 'redeploy-oracle.bat',
      note: '休閒對戰跑的是玩家瀏覽器裡的前端引擎 ⇒ 動了 src/lib/game/** 就必須跑這一支',
    },
    {
      no: '④',
      name: '本機 → 正式站【admin／伺服器線】',
      want: v.localVer ?? '(本機讀不到)',
      got: miss(v.prodHint, e.admin, ' SITE_VERSION_HINT'),
      ok: eq(v.localVer, v.prodHint),
      bat: 'update-tournament.bat',
      note: '⚠ 這條只證明 admin.html 上去了，**不證明** server-engine.cjs 真的重建了'
        + '（同一支 bat 做兩件事，是代理指標）',
    },
  ];
}

/** 從 evaluate() 的結果算出「要跑哪幾支 bat」，順序固定為先伺服器後前端。 */
export function batsToRun(rows) {
  const want = new Set(rows.filter((r) => !r.ok && r.bat).map((r) => r.bat));
  return ['update-tournament.bat', 'redeploy-oracle.bat'].filter((b) => want.has(b));
}
