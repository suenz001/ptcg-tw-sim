// ⭐ v6.263 中央 helper：讀取「歷史 commit 的 blob」，並讓「拿不到」這件事無所遁形。
//
// 背景（v6.263 調查）：`.github/workflows/deploy.yml` 的 build job 用 `actions/checkout@v4`
//   且**沒有 `with:`** ⇒ 走 action 預設的 `fetch-depth: 1`（淺複製），物件庫裡只有 HEAD 一顆
//   commit。所有「跟舊版比對」的守衛在 CI 上都拿不到 BASE blob。
//   過去各支自己 try/catch，分成兩種下場：
//     (a) 印 SKIP 後整節不跑 —— 條數變少，至少還看得出來；
//     (b) `catch { console.log('…'); return; }` —— **條數不變、整體綠燈**，
//         那條斷言在 CI 上其實**從來沒有在守**（v6.224:198 / v6.230:264 就是這樣）。
//
// 這支 helper 做兩件事：
//   1. 把「讀歷史 blob」收斂成**單一入口**，讓 `test-v6263-shallow-clone-ci-guards.mjs`
//      的掃描器可以列管（誰在讀歷史、誰沒有走這裡）。
//   2. 每一次跳過都印醒目的 `⚠⚠ SHALLOW-SKIP` 行，並在 process 結束時再印一次總結。
//
// ⚠ 這支 helper **不決定**測試的紅綠 —— 由呼叫端自己決定。
// ⭐ 新守衛請優先用「內嵌快照 ／ 突變測試」這種**不需要歷史**的作法
//   （見 test-v6224 的 B2／B2b、test-v6239 的 ⑥）：那樣淺複製下條數不變且仍然在守。
import { execFileSync } from 'node:child_process';

const _skipped = [];
let _hooked = false;

function _git(root, args) {
  try {
    return {
      ok: true,
      out: execFileSync('git', ['-C', root, ...args],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'),
    };
  } catch { return { ok: false, out: '' }; }
}

/** 物件庫裡有沒有這顆 commit（淺複製時沒有）。 */
export function hasBaseCommit(root, sha) {
  return _git(root, ['cat-file', '-e', sha + '^{commit}']).ok;
}

/** 讀某顆 commit 底下的檔案內容。回傳 { ok, out }（拿不到時 ok=false，**不丟例外**）。 */
export function readBaseBlob(root, sha, path) {
  return _git(root, ['cat-file', '-p', `${sha}:${path}`]);
}

/** 這個 checkout 是不是淺複製（只拿來寫診斷訊息，不當判準）。 */
export function isShallowCheckout(root) {
  return _git(root, ['rev-parse', '--is-shallow-repository']).out.trim() === 'true';
}

/**
 * 宣告「這一段因為拿不到歷史而沒有跑」。**大聲印出來**並登記進總結。
 * @param {string} what  哪一段沒跑（要能讓人一眼認出是哪支守衛的哪一節）
 * @param {string} [why] 補充說明（例如「由 ⑥ 的突變測試涵蓋同一件事」）
 */
export function shallowSkip(what, why = '') {
  _skipped.push(what);
  console.log(`  ⚠⚠ SHALLOW-SKIP  ${what}${why ? '　—— ' + why : ''}`);
  console.log('  ⚠⚠ 這一段在本次執行【沒有在守】：物件庫沒有那顆歷史 commit（fetch-depth:1 淺複製）。');
  if (!_hooked) {
    _hooked = true;
    process.on('exit', () => {
      if (!_skipped.length) return;
      console.log(`\n⚠⚠⚠ [SHALLOW-CLONE] 本次執行有 ${_skipped.length} 段守衛因為淺複製被跳過：`);
      for (const s of _skipped) console.log('⚠⚠⚠   - ' + s);
      console.log('⚠⚠⚠ ⇒ 這幾條斷言在這台機器上沒有在守。修法：deploy.yml 的 actions/checkout');
      console.log('⚠⚠⚠   加上 `with: { fetch-depth: 0 }`（見 docs/changelog-internal.md v6.263）。');
    });
  }
}

/** 目前為止跳過幾段（給 meta 守衛用）。 */
export function shallowSkipCount() { return _skipped.length; }
