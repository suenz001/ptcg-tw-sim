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
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

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

/**
 * ⭐ v6.343 中央 helper：把 `destSrcDir`（已經 cpSync 過去的 src 副本）底下、`prefix`
 *   這個子樹的**每一個檔案**都換成 BASE 版本，並刪掉「BASE 沒有、HEAD 才有」的檔案。
 *
 * 為什麼需要它（v6.342 的實況，會**一再**重演）：
 *   HEAD-FAIL 段的舊寫法是「cpSync 整棵 src，再把一份**寫死的檔案清單**換成 BASE blob」。
 *   那份清單通常含 `src/lib/game/effects.ts`，卻**不含**那些「後來才被收斂到 effects.ts
 *   新中央 helper」的卡檔。只要後續版本把某張既有卡改成
 *     `import { 新helper } from '../../effects'`，
 *   BASE 的 effects.ts 就沒有那個符號 ⇒ **esbuild build failed** ⇒ 整支守衛爆掉，
 *   而且紅的原因是 harness 壞掉、不是判準。v6.342 一次打斷三支
 *   （v6334／v6337／v6338：`prizesTakenMultiplyPre`、`healOneOwnBenchFullPost`、
 *    `damageTakenLastOppTurnPlusPre`）。
 *   ⚠ 這不是「某一版的錯」——「把 inline 複本收斂到中央出口」是站長明確要求的方向，
 *     每收斂一次就會再打斷一次。所以要修的是 harness：**整個效果子樹一起換**才自洽。
 *
 * ⚠⚠ 本 helper **不決定**測試的紅綠，也**絕不靜默吞掉**失敗：任何一步出錯都回
 *   `{ ok:false, reason }`，由呼叫端把它變成一條紅。把 build 失敗當成「BASE 是紅的」
 *   而讓斷言過，是最嚴重的安慰劑。
 *
 * ⚠ `prefix` 的 pathspec 語意：`git ls-tree -- src/lib/game/effects` 只會匹配**目錄**
 *   `src/lib/game/effects/`，**不含**同名檔案 `src/lib/game/effects.ts`（已實測）。
 *   需要連 effects.ts 一起換的話，請另外呼叫一次，或留在呼叫端原本的逐檔清單裡。
 *
 * @param {string} ROOT        專案根目錄（git 工作樹）
 * @param {string} BASE_SHA    BASE commit
 * @param {string} destSrcDir  已 cpSync 的 src 副本（例如 <tmp>/base-src）
 * @param {string} prefix      以 `src/` 起頭的子樹路徑（例如 src/lib/game/effects）
 * @returns {{ ok: boolean, replaced: number, removed: number, reason?: string }}
 */
export function restoreBaseSubtree(ROOT, BASE_SHA, destSrcDir, prefix) {
  const bad = (reason, replaced = 0, removed = 0) => ({ ok: false, replaced, removed, reason });

  // ① prefix 必須位於 src/ 底下（dest 路徑要去掉 src/ 前綴，比照既有寫法）
  if (prefix !== 'src' && !prefix.startsWith('src/')) {
    return bad(`prefix 必須是 src 或以 src/ 起頭，收到：${prefix}`);
  }

  // ② 取 BASE 上該子樹的檔案清單
  const ls = _git(ROOT, ['ls-tree', '-r', '--name-only', BASE_SHA, '--', prefix]);
  if (!ls.ok) return bad(`git ls-tree 失敗（${prefix} @ ${BASE_SHA.slice(0, 8)}）—— 物件庫可能沒有這顆 commit`);
  const baseFiles = ls.out.split('\n').map(x => x.trim()).filter(Boolean);
  if (!baseFiles.length) return bad(`BASE(${BASE_SHA.slice(0, 8)}) 上 ${prefix} 一個檔案都沒有（prefix 打錯？）`);

  // ③ 逐檔 readBaseBlob 寫回 destSrcDir
  const keep = new Set();
  let replaced = 0;
  for (const rel of baseFiles) {
    if (!rel.startsWith('src/')) return bad(`ls-tree 回傳了 src/ 以外的路徑：${rel}`, replaced);
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    if (!b.ok) return bad(`讀不到 BASE blob：${rel}`, replaced);
    const dest = join(destSrcDir, rel.slice(4).split('/').join(sep));
    try {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, b.out, 'utf8');
    } catch (e) { return bad(`寫檔失敗 ${dest}：${e && e.message ? e.message : e}`, replaced); }
    keep.add(dest);
    replaced++;
  }

  // ④ 刪掉「BASE 沒有、HEAD 才有」的檔案
  //    （否則新卡檔會 import BASE 還沒有的中央 helper，一樣 build failed）
  const localRoot = prefix === 'src' ? destSrcDir : join(destSrcDir, prefix.slice(4).split('/').join(sep));
  let removed = 0;
  try {
    if (existsSync(localRoot)) {
      const st = lstatSync(localRoot);
      if (st.isDirectory()) {
        const walk = (d) => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (!keep.has(p)) { rmSync(p, { force: true }); removed++; }
          }
        };
        walk(localRoot);
      } else if (!keep.has(localRoot)) {
        rmSync(localRoot, { force: true }); removed++;
      }
    }
  } catch (e) { return bad(`清除 BASE 不存在的檔案失敗：${e && e.message ? e.message : e}`, replaced, removed); }

  return { ok: true, replaced, removed };
}
