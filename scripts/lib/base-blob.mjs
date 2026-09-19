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

/**
 * git 說「這個物件／路徑不在」的訊息樣式。⚠ **不能用 exit code 分辨** ——
 * 實測：物件不存在、tree 不是 tree、路徑不存在、**連「不是 git repo」**全部都是 `exit 128`。
 * 唯一能分辨的是 stderr 的文字。
 *
 * ⚠⚠ 這是**白名單**，漏一個樣式就會把預期的失敗誤判成非預期 ⇒ 假紅。
 *   第一版就漏了最重要的一個：**檔案在磁碟上存在、但 BASE 那顆 commit 沒有**
 *   （＝本版新增的檔）git 給的是
 *       fatal: path 'src/lib/game/copy-attack.ts' exists on disk, but not in '<sha>'
 *   而不是 `Not a valid object name`（後者只在「磁碟上也沒有」時出現）。
 *   實測跑全套時當場打斷 8 支守衛（v6337／v6384／v6391／v6392／v6267／v6336／v6233／v6273）。
 *   ⭐ 教訓（安慰劑型態 10 的變形）：**枚舉語義不要枚舉字面** —— 同一件事
 *     「這個路徑在那顆 commit 上沒有」，git 會依「磁碟上有沒有」給出**兩種**訊息。
 *   ⭐ 白名單漏列 ⇒ 假紅（吵但安全）；黑名單漏列 ⇒ 假綠（回到本版要修的問題）。
 *     所以這裡刻意選白名單，並由 test-base-blob-git-errors 的 B4／B4b 把兩種樣式都釘住。
 */
/**
 * git 說「這個環境壞了」的訊息樣式 —— 這一類**必須**丟出來，不可以被當成「拿不到歷史」。
 * ⚠ 這是**黑名單**，刻意只列「確定是環境問題」的樣式；分不出來的走下面的 GIT-UNCLEAR。
 */
const ENV_BROKEN = /not a git repository|index\.lock|permission denied|dubious ownership|unable to read|cannot open|no such file or directory/i;

const EXPECTED_MISS = new RegExp([
  'not a valid object name',         // 磁碟上也沒有這個路徑／sha 根本不存在
  'invalid object name',             // 同上（部分 git 版本的措辭）
  'exists on disk, but not in',      // ⭐ 檔案在工作樹裡、但那顆 commit 沒有（本版新增的檔）
  'does not exist in',               // 同上（部分 git 版本的措辭）
  'not a tree object',
  'bad object',
  'unknown revision',
].join('|'), 'i');

/**
 * ⚠⚠ 這支原本寫成 `try { … } catch { return { ok:false, out:'' }; }` ——
 *   **吞掉一切** git 失敗，一律降級成「拿不到歷史」⇒ SHALLOW-SKIP ⇒ 整段不跑但**條數不變**。
 *   問題是：「物件不在」只是眾多失敗原因裡的一種。git 不在 PATH、這裡不是 git repo、
 *   index.lock 殘留、權限不足、maxBuffer 爆掉 —— 全部長得一模一樣，而**72 支守衛**
 *   在用這支 helper。CI 現在已經是 `fetch-depth: 0`（完整 clone）⇒ SHALLOW-SKIP 應該恆為 0，
 *   這時候任何一次「非預期失敗」被當成淺複製跳過，就是不折不扣的假綠。
 *   （與 IRON_RULES Rule 59 修掉的 createSandbox 空 catch 是**同一個**安慰劑型態 2，
 *    規模大一個數量級。）
 *
 * ⇒ 現在分流：
 *   - `missOk` 且 stderr 符合 EXPECTED_MISS ⇒ 回 { ok:false, expected:true }（呼叫端照舊）
 *   - `soft`   ⇒ 任何失敗都回 { ok:false, expected:false }，不丟（只給純診斷用途）
 *   - 其餘     ⇒ **throw**，讓它大聲，而且訊息裡帶 git 自己的 stderr
 *
 * ⚠ stdio 的 stderr 從 'ignore' 改成 'pipe'：不然連分辨的依據都拿不到。
 */
/**
 * 把一次 git 失敗分成三類。**判準只有這一份**（Rule 38）：正式路徑與守衛的表格測試
 * 都呼叫它，不另外抄一份。
 *   'miss'    明確的「物件／路徑不在」⇒ 這就是淺複製要跳過的那件事，靜默回 ok:false
 *   'env'     明確的「環境壞了」⇒ **丟**，不可以被當成拿不到歷史
 *   'unclear' 分不出來（最典型：git 可執行但 exit≠0 而且**沒有任何 stderr**）
 *             ⇒ 回 ok:false（維持「拿不到歷史時條數不變」這個保證），但**印一行醒目的
 *               GIT-UNCLEAR 並計數**，讓它可見而不是靜默。
 *
 * ⚠⚠ 為什麼 'unclear' 不能一律丟：`test-v6263-shallow-clone-ci-guards` 的 ④ 會把
 *   `git` 換成 `#!/bin/sh\nexit 1` 的 PATH shim，實跑 5 支守衛並斷言**條數完全相同**
 *   （那一段只在 POSIX 跑 ⇒ Windows 本機看不到，CI 才會執行）。那個 shim 是
 *   「git 可執行但失敗、沒有 stderr」⇒ 一律丟的話，CI 上那 5 支會集體爆掉。
 *   ⭐ 第一版就是這樣把 CI 弄紅的（本機 738/738 全綠，CI 的 npm test 紅）。
 *   「git 完全不能用」本來就是「拿不到歷史」的極端情況，不是環境異常的證據。
 */
export function classifyGitFailure(err, code) {
  const e = String(err || '');
  if (code === 'ENOENT') return 'env';          // git 根本不在 PATH
  if (ENV_BROKEN.test(e)) return 'env';
  if (EXPECTED_MISS.test(e)) return 'miss';
  return 'unclear';
}

const _unclear = [];
let _unclearHooked = false;
/** 分不出來的 git 失敗：大聲印一行並登記，但**不**擋。 */
function _noteUnclear(root, args, err, status) {
  const what = `git ${args.join(' ')}（在 ${root}）exit=${status}`
    + (err ? `：${String(err).split('\n')[0].slice(0, 160)}` : '（沒有任何 stderr）');
  _unclear.push(what);
  console.log(`  ⚠⚠ GIT-UNCLEAR  ${what}`);
  console.log('  ⚠⚠ 分不出是「物件不在」還是「環境壞了」⇒ 當成拿不到歷史處理（條數不變），但列管。');
  if (!_unclearHooked) {
    _unclearHooked = true;
    process.on('exit', () => {
      if (!_unclear.length) return;
      console.log(`\n⚠⚠⚠ [GIT-UNCLEAR] 本次執行有 ${_unclear.length} 次分不出原因的 git 失敗：`);
      for (const u of _unclear) console.log('⚠⚠⚠   - ' + u);
    });
  }
}
/** 目前為止有幾次分不出原因的 git 失敗（給 meta 守衛用）。 */
export function gitUnclearCount() { return _unclear.length; }

function _git(root, args, opts = {}) {
  try {
    return {
      ok: true,
      expected: true,
      err: '',
      out: execFileSync('git', ['-C', root, ...args],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'),
    };
  } catch (e) {
    const err = String((e && e.stderr) || '').trim();
    const status = e && typeof e.status === 'number' ? e.status : null;
    const kind = classifyGitFailure(err, e && e.code);
    if (opts.soft) return { ok: false, expected: false, kind, err, out: '' };
    if (kind === 'env') {
      throw new Error(`git ${args.join(' ')}（在 ${root}）失敗，而且**不是**「物件不在」：`
        + `exit=${status} ${err || String((e && e.message) || e)}`
        + '\n  ⚠ 這不可以被當成淺複製跳過（那樣 72 支讀歷史的守衛會集體假綠）。'
        + '\n  ⭐ 常見原因：這裡不是 git repo、git 不在 PATH、.git/**/index.lock 殘留、權限不足。');
    }
    if (!opts.missOk) {
      throw new Error(`git ${args.join(' ')}（在 ${root}）失敗：exit=${status} `
        + (err || String((e && e.message) || e)));
    }
    if (kind === 'unclear') _noteUnclear(root, args, err, status);
    return { ok: false, expected: kind === 'miss', kind, err, out: '' };
  }
}

/** 物件庫裡有沒有這顆 commit（淺複製時沒有）。 */
export function hasBaseCommit(root, sha) {
  return _git(root, ['cat-file', '-e', sha + '^{commit}'], { missOk: true }).ok;
}

/** 讀某顆 commit 底下的檔案內容。回傳 { ok, out }（拿不到時 ok=false，**不丟例外**）。 */
export function readBaseBlob(root, sha, path) {
  return _git(root, ['cat-file', '-p', `${sha}:${path}`], { missOk: true });
}

/** 這個 checkout 是不是淺複製（只拿來寫診斷訊息，不當判準）。 */
export function isShallowCheckout(root) {
  // 純診斷字串，不當判準 ⇒ 用 soft：壞掉時回 false 而不是讓整支守衛爆掉。
  return _git(root, ['rev-parse', '--is-shallow-repository'], { soft: true }).out.trim() === 'true';
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
  // ⚠ 這裡用 missOk：呼叫端本來就會把 ok:false 變成一條紅（不是靜默跳過），
  //   而「非預期的 git 失敗」仍然會從 _git 丟出來、帶著 git 自己的 stderr。
  const ls = _git(ROOT, ['ls-tree', '-r', '--name-only', BASE_SHA, '--', prefix], { missOk: true });
  if (!ls.ok) return bad(`git ls-tree 失敗（${prefix} @ ${BASE_SHA.slice(0, 8)}）—— 物件庫可能沒有這顆 commit`
    + (ls.err ? `：${ls.err}` : ''));
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
