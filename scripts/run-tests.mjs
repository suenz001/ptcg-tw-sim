#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// scripts/run-tests.mjs —— 守衛平行執行器（本機開發工具，**不是** CI gate）
//
// 為什麼要這支：`npm test` 那條 36,619 字元的鏈在 Windows cmd.exe 上因為
// 指令長度上限（8191 字元）根本跑不起來（ENAMETOOLONG / -4064），只有 CI 的
// ubuntu-latest 跑得動。本機要驗全套只能逐支序列跑，要 33 分鐘以上。
//
// ⚠⚠ 核心設計：**每個 worker 一個沙盒**（不是資源鍵、不是序列車道）
//   守衛幾乎全部用 `fileURLToPath(new URL('..', import.meta.url))` 推 ROOT
//   （IRON_RULES Rule 46），所以只要讓守衛在各自的沙盒副本裡跑，下面這些
//   併發衝突**全部自動消失、且零改守衛**：
//     ① 117 條重複的暫存檔絕對路徑（18 支共用 .x-s.js/.x-e.ts/.x-o.mjs，
//        19 支共用 .stub-paths.js）—— 各沙盒各寫各的
//     ② 121 對「守衛把另一支守衛當子行程 spawn」—— 父子同在一個沙盒、
//        而且 spawnSync 是 blocking 的 ⇒ 同沙盒內永遠只有一支在跑
//     ③ 6 支會 readdirSync('scripts') 列舉目錄的守衛，看到的是自己沙盒的目錄
//     ④ test-v6394-tsc-clean 的 `svelte-kit sync` 重建 .svelte-kit/ —— 各沙盒各一份
//
// ⚠⚠ 但「沙盒目錄」本身擋不住**硬寫絕對路徑**的守衛。實測（node path.win32）：
//     resolve('E:\\ptcg-sandbox\\w1', '/tmp/x')  →  'E:\\tmp\\x'
//   也就是說 `/tmp/...` 在 Windows 是**相對於當前磁碟機**解析的，六個沙盒
//   會共用同一個 E:\tmp\。有 3 支守衛硬寫 /tmp：
//     test-v6297（MEASURE_OUT=/tmp/measure-v6297.json）
//     test-v6303（MEASURE_OUT=/tmp/measure-v6303.json）
//     test-v6306（OUT=/tmp/v6306-net）
//   而且 test-v6370:130 會 spawn test-v6297 ⇒ 跨沙盒 race（v6370 在 w2 跑
//   v6297 的同時，v6297 本體可能正在 w5 跑，兩邊寫同一個 JSON）。
//
//   ⭐ 解法：**用 subst 給每個沙盒一個磁碟機代號，並以該代號的根當 cwd**。
//      實測（站長 Windows 10.0.26200）：
//        subst P: E:\ptcg-tw-sim ; P: ; node -e "..."
//        → process.cwd() = 'P:\'          （沒有被 realpath 回 E:）
//        → path.resolve('/tmp/x') = 'P:\tmp\x'
//      ⇒ 三支硬寫 /tmp 的守衛自動隔離，仍然零改守衛。
//      ⚠ 代號只能是**單一字母**：path.win32.resolve('W1:\\','/tmp/x') 會掉成
//        '\tmp\x'（代號被丟掉）。所以用 P: Q: R: S: T: U:。
//
// ⚠⚠ 但 subst 的代號**根目錄不能直接當 repo**。實測踩到：
//   test-v6368 的 bundleFrom() 寫
//     const parent = dirname(srcDir); const name = srcDir.slice(parent.length + 1);
//   主樹：dirname('E:\\ptcg-tw-sim\\src') = 'E:\\ptcg-tw-sim'（不帶尾斜線，len 14）
//         → slice(15) = 'src'  ✅
//   代號根：dirname('V:\\src') = 'V:\\'（**磁碟機根一定帶尾斜線**，len 3）
//         → slice(4) = 'rc'    ❌  ⇒ esbuild「Could not resolve ./rc/lib/...」
//   全 chain 有 23 支用 `slice(ROOT.length)`、4 支用 `ROOT.length + 1`，全是同一類。
//   ⭐ 解法：repo 放在代號的**子目錄**——
//       實體 <sandboxRoot>\wN\repo ，subst P: <sandboxRoot>\wN ，cwd = P:\repo
//     這樣 dirname/slice 的形狀與主樹一致（P:\repo ↔ E:\ptcg-tw-sim，都不帶尾斜線），
//     而 `/tmp/x` 仍然解析成 P:\tmp\x（隔離不變，因為磁碟機還是 P:）。
//
// ⚠ 唯一補不掉的沙盒外寫入：test-v6166-home-video-facade.mjs:41 寫
//   join(ROOT,'node_modules/.cache/ptcg-v6166')，而 node_modules 是 junction
//   指向主樹 ⇒ 會穿透寫到主樹。那支從不清理（主樹現在就躺著 c0~c6.server.js）。
//   ⇒ escape 判準對這一條開**具名例外**（只允許那 7 個檔的 mtime 改變），
//     其餘一律零差異。
//
// 用法：
//   node scripts/run-tests.mjs                     平行跑（預設 6 workers）
//   node scripts/run-tests.mjs --workers 1         序列基準
//   node scripts/run-tests.mjs --list              只印清單與分類，不執行
//   node scripts/run-tests.mjs --setup-only        只建沙盒
//   node scripts/run-tests.mjs --teardown-only     只拆沙盒（釋放 subst）
//   node scripts/run-tests.mjs --baseline <json>   跑完逐支比對基準
//   node scripts/run-tests.mjs --report <json>     報表輸出路徑
//
// ⚠ 這支**不改 package.json 的 scripts.test**：它只把那條字串當「清單來源」，
//   因為有 43 支守衛對 scripts.test 做自我存在性斷言（其中三條是「恰好一次」）。
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync,
         copyFileSync, rmSync, utimesSync } from 'node:fs';
import { join, dirname, basename, resolve as pResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import os from 'node:os';
import { parseChain as parseChainCentral } from './lib/chain-parse.mjs';

// Rule 46：ROOT 一律用 fileURLToPath，禁 process.cwd()
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';

// ───────────────────────────────────────────────────────────── 參數
function argVal(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}
function argFlag(name) { return process.argv.includes(name); }

const OPT = {
  workers: Math.max(1, parseInt(argVal('--workers', '6'), 10) || 6),
  sandboxRoot: argVal('--sandbox-root', 'E:\\sb'),   // 短路徑：E:\sb\w1\repo 與主樹 E:\ptcg-tw-sim 同長度級距（MAX_PATH 餘裕）
  drives: String(argVal('--drives', 'P,Q,R,S,T,U')).split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  // ⚠ 報表**不寫主樹**（站長硬性要求：runner 對主樹只讀不寫，除 .git/worktrees/*）
  report: argVal('--report', ''),
  baseline: argVal('--baseline', ''),
  timeoutMul: parseFloat(argVal('--timeout-mul', '3')) || 3,
  timeoutMinMs: parseInt(argVal('--timeout-min', '120000'), 10) || 120000,
  timeoutMaxMs: parseInt(argVal('--timeout-max', '1800000'), 10) || 1800000,
  list: argFlag('--list'),
  setupOnly: argFlag('--setup-only'),
  teardownOnly: argFlag('--teardown-only'),
  only: String(argVal('--only', '')).split(',').map((x) => x.trim()).filter(Boolean),
  dumpOut: argVal('--dump-out', ''),   // 診斷用：把每支的完整輸出存成檔（比對軟差異時用）
  //   ⚠ 會在下面被限制在 sandboxRoot 底下：它若指到主樹／%TEMP%／E:\tmp，
  //     worker A 的 dump 寫入會落在 worker B 的 before/after 快照之間而被誤記成 escape。
  // ⭐ --no-restore：關掉「每支跑完回復沙盒」。
  //   用途是驗證**等價性的語意邊界**：`npm test` 是「一棵樹、一條鏈、殘檔一路累積」，
  //   而 runner 是「735 次獨立執行、每次回復」。逐支比對對這個差異天生盲目
  //   （因為序列基準也有 restore）。用 `--workers 1 --no-restore` 照 chain 原序跑一次，
  //   再跟有 restore 的基準比，才能說「runner 全綠 ⇒ npm test 全綠」而不只是
  //   「⇒ 每一支單獨跑都綠」。這兩句差一個量詞。
  noRestore: argFlag('--no-restore'),
  keep: argFlag('--keep'),           // 跑完不拆沙盒（除錯用）
  noSubst: argFlag('--no-subst'),    // 不用磁碟機代號（Linux 或除錯）
};

if (!OPT.report) OPT.report = join(OPT.sandboxRoot, '__rt', `report-w${OPT.workers}-${Date.now()}.json`);
if (OPT.dumpOut) {
  const abs = pResolve(OPT.dumpOut);
  if (!abs.toLowerCase().startsWith(pResolve(OPT.sandboxRoot).toLowerCase())) {
    throw new Error(`--dump-out 必須在 ${OPT.sandboxRoot} 底下（避免寫入落進別的 worker 的快照窗）`);
  }
  OPT.dumpOut = abs;
}

const log = (...a) => console.log(...a);
const now = () => Date.now();
const fmtS = (ms) => (ms / 1000).toFixed(1) + 's';
const fmtM = (ms) => (ms / 60000).toFixed(1) + '分';

// ════════════════════════════════════════════════════════════════════════════
// 【1】清單：唯一真相是 package.json 的 scripts.test
// ════════════════════════════════════════════════════════════════════════════
function parseChain() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const raw = String(pkg.scripts && pkg.scripts.test || '');
  if (!raw) { throw new Error('package.json 沒有 scripts.test'); }
  // ⭐ IRON_RULES Rule 38：這條鏈的解析判準只有一份，在 scripts/lib/chain-parse.mjs。
  //   這裡**不再**就地 split('&&')；test-runner-and-chain-hygiene 的 C1/C2 在守這件事。
  const parsed = parseChainCentral(raw);
  const steps = parsed.scripts.map((x) => 'node ' + x).concat(parsed.odd);

  // ⭐ 掃描器下限斷言（安慰劑型態 4：空真）
  if (steps.length < 400) {
    throw new Error(`scripts.test 只解析到 ${steps.length} 步 —— 解析器壞了？`);
  }
  // ⭐ 形狀斷言：每一步都必須是裸 `node scripts/xxx.mjs`，沒有 argv、沒有 env 前綴、
  //    沒有 shell 語法。只要有一步不是，就 fail-fast（不猜、不跳過）。
  const odd = parsed.odd;
  const scripts = parsed.scripts;
  if (odd.length) {
    throw new Error(`scripts.test 有 ${odd.length} 步不是裸 node 指令，runner 不敢猜：\n  ` +
      odd.slice(0, 5).join('\n  '));
  }
  // 去重（chain 裡有 2 支重複；已逐位置查證兩次都是逐字相同的裸指令、
  // 無 argv 無 env、`&&` 之間不傳遞狀態 ⇒ 是筆誤，跑一次等價）
  return { stepCount: parsed.stepCount, scripts, uniq: parsed.uniq, dups: parsed.dups };
}

// ════════════════════════════════════════════════════════════════════════════
// 【2】分類：階段二（牆鐘斷言守衛，序列獨占）／heavy（容量 1）／一般
// ════════════════════════════════════════════════════════════════════════════
// ⚠ 名單一律**動態掃描**，不寫死檔名清單 —— 寫死的清單在新守衛加進來之後
//   就靜默失效（安慰劑型態 9：pin 死的斷言過期後不再守任何東西）。
// ⚠ 寧可多列不可少列：多跑一支序列只多幾秒；漏一支就是假紅（或反向假綠）來源。
// ⭐ 明確補充清單：斷言形式不符合下面自動判準、但**確實是牆鐘斷言**的。
//   例：test-v6219:212 `assert.ok(e2 < e1 / 2)` —— 變數叫 e1/e2，自動判準抓不到，
//   而它是**比值型**斷言（同一支內兩段量測互比），門檻訂多寬都沒用，
//   兩段量測踩到不同的 CPU 爭用狀態就翻 ⇒ 必須獨占。
//   ⚠ 這份清單會過期，所以下面**逐支斷言它還在、且還含 Date.now()**：
//     過期時大聲翻紅，而不是靜默縮短名單（安慰劑型態 9：pin 死的斷言過期後不再守）。
const TIMING_EXTRA = [
  'scripts/test-v6219-admin-stats-users-cache.mjs',     // :135 staleMs < 100 ／ :212 e2 < e1/2
  'scripts/test-v6273-firestore-client-read-cache.mjs', // :290 Math.abs(Date.now()-o.at) < 5000
];

function classifyTiming(uniq) {
  const hit = [];
  const missSample = [];
  for (const rel of uniq) {
    const p = join(ROOT, rel);
    let src = '';
    try { src = readFileSync(p, 'utf8'); } catch { missSample.push(rel); continue; }
    // 主判準：用高解析度計時器的一律進獨占名單
    if (/performance\.now|process\.hrtime/.test(src)) { hit.push(rel); continue; }
    // 次判準：用 Date.now() 差值**並且**把那個差值拿去比較的
    //   （只在字串裡出現 "Date.now() - x" 的原始碼比對型不算）
    if (/Date\.now\(\)\s*-\s*[A-Za-z_$][\w$]*/.test(src)) {
      const lines = src.split(/\r?\n/);
      let real = false;
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        if (!/Date\.now\(\)\s*-\s*[A-Za-z_$][\w$]*/.test(L)) continue;
        // 排除：整行被引號包起來（原始碼字面比對 / 突變字串）
        const inQuote = /(^|[^\\])(['"`]).*Date\.now\(\)\s*-\s*[A-Za-z_$][\w$]*.*\2/.test(L);
        if (inQuote) continue;
        real = true; break;
      }
      // 再確認檔內真的有把時間差拿來斷言（門檻比較）
      if (real && /(chk|ok|assert\.ok)\s*\([^\n]*\b(ms|per|elapsed|dur|t\d|took)[\w$]*\s*[<>]/i.test(src)) {
        hit.push(rel);
      }
    }
  }
  // ⭐ 下限斷言：掃描器壞掉的話這裡會爆，而不是靜默給出一份短名單
  if (hit.length < 25) {
    throw new Error(`時序型守衛只掃到 ${hit.length} 支（預期 ≥25）—— 掃描器壞了？`);
  }
  const set = new Set(hit);
  for (const rel of TIMING_EXTRA) {
    if (!uniq.includes(rel)) {
      throw new Error(`TIMING_EXTRA 的 ${rel} 已不在 scripts.test 鏈上 —— 清單過期，請重新檢視`);
    }
    let src2 = '';
    try { src2 = readFileSync(join(ROOT, rel), 'utf8'); } catch {
      throw new Error(`TIMING_EXTRA 的 ${rel} 讀不到 —— 清單過期，請重新檢視`);
    }
    if (!/Date\.now\(\)/.test(src2)) {
      throw new Error(`TIMING_EXTRA 的 ${rel} 已不含 Date.now() —— 清單過期，請重新檢視`);
    }
    set.add(rel);
  }
  return [...set];
}

// 讀既有的逐支耗時（用來做 LPT 長尾優先排程與 per-guard timeout）
function loadDurations() {
  const map = new Map();
  const cands = [];
  if (OPT.baseline) cands.push(OPT.baseline);
  const rtDir = join(OPT.sandboxRoot, '__rt');
  if (existsSync(rtDir)) {
    const files = readdirSync(rtDir).filter((f) => /\.json$/.test(f)).map((f) => join(rtDir, f));
    files.sort((a, b) => (statOf(b)?.mtimeMs ?? 0) - (statOf(a)?.mtimeMs ?? 0));  // 新的優先
    cands.push(...files);
  }
  const legacy = join(ROOT, '__m6a', 'v384_full.out.txt');
  for (const c of cands) {
    try {
      const j = JSON.parse(readFileSync(c, 'utf8'));
      for (const r of (j.results || [])) if (r.script && r.ms > 0 && !map.has(r.script)) map.set(r.script, r.ms);
    } catch { /* 壞掉的報表直接忽略，不讓它擋住執行 */ }
  }
  if (existsSync(legacy)) {
    try {
      for (const L of readFileSync(legacy, 'utf8').split(/\r?\n/)) {
        const m = /^ok \[\d+\] node (scripts\/[^ ]+) \((\d+)ms\)/.exec(L);
        if (m && !map.has(m[1])) map.set(m[1], +m[2]);
      }
    } catch { /* 同上 */ }
  }
  return map;
}

// heavy：吃滿 CPU / 記憶體、或會重建整包 .svelte-kit 的，同時最多 1 支。
// 一樣動態決定（耗時 top-N），外加一支明確列入（它沒有歷史耗時資料）。
const HEAVY_EXPLICIT = new Set(['scripts/test-v6394-tsc-clean.mjs']);
// 子行程 timeout 小於這個值的守衛也算 heavy：它們不是牆鐘斷言守衛（classifyTiming
// 抓不到），但在 6-way 爭用 + heavy tsc 同時跑的情況下，子行程可能超過**自己寫死的**
// timeout ⇒ 假紅。實測 chain 上最緊的是 test-v6246（120 秒）。
const TIGHT_CHILD_TIMEOUT_MS = 300000;
function classifyHeavy(uniq, dur, topN = 4) {
  const rank = uniq.filter((s) => dur.has(s)).sort((a, b) => dur.get(b) - dur.get(a));
  const set = new Set(rank.slice(0, topN));
  for (const s of HEAVY_EXPLICIT) if (uniq.includes(s)) set.add(s);
  for (const rel of uniq) {
    let src = '';
    try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
    if (!/spawnSync|execFileSync|execSync/.test(src)) continue;
    const ms = [...src.matchAll(/timeout:\s*(\d+)/g)].map((m) => +m[1]);
    if (ms.length && Math.min(...ms) < TIGHT_CHILD_TIMEOUT_MS) set.add(rel);
  }
  return set;
}

// ════════════════════════════════════════════════════════════════════════════
// 【3】沙盒：git worktree（只為了 .git 檔與 index）＋ junction ＋ subst
// ════════════════════════════════════════════════════════════════════════════
// ⚠ 內容**不用** `git checkout` 也**不用** robocopy /MIR：站長 Windows 端
//   core.autocrlf=true，checkout 出來的位元組不等於主樹工作檔（blob 是 LF、
//   工作樹是 CRLF），而站內有 99 支守衛做 EOL 相關比對。所以內容一律
//   從主樹**逐檔位元組複製**。
// ⚠ 增量判準必須是「**mtime 或 size 任一不同就覆蓋**」，不可寫成「來源較新
//   才覆蓋」—— 守衛會做等長位元組 mutate，中途被殺會留下同 size 的壞檔，
//   而那個壞檔的 mtime 比主樹**新**，「較新才覆蓋」會漏掉它。
const SKIP_DIRS = new Set(['node_modules', '.git', '.svelte-kit']);

function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
}
function gitLines(args, cwd = ROOT) {
  return git(args, cwd).split(/\r?\n/).filter(Boolean);
}

// 要同步進沙盒的檔案清單（相對路徑，正斜線）
function buildSyncList() {
  const tracked = gitLines(['-c', 'core.quotepath=false', 'ls-tree', '-r', 'HEAD', '--name-only']);
  // ⚠⚠ 範圍必須含**主樹根目錄一層**，不能只有那五個目錄。
  //   實例：test-v6183:294 寫
  //     const root = join(ROOT, 'YouTube縮圖_1280x720.png');
  //     if (existsSync(root)) { …md5 斷言… }
  //   那張圖未追蹤、又在五個目錄之外 ⇒ 沙盒沒有 ⇒ 整段斷言靜默不跑，
  //   而 exit code、PASS/FAIL 條數、輸出指紋**三個判準全部不變** ⇒ 抓不到。
  //   這就是「沙盒特有假綠」，只能靠把檔補進沙盒來根治。
  const untrackedRaw = gitLines(['-c', 'core.quotepath=false', 'ls-files', '--others',
    '--exclude-standard', '--', 'src', 'static', 'scripts', 'oracle-admin', 'docs']);
  const untrackedRoot = gitLines(['-c', 'core.quotepath=false', 'ls-files', '--others',
    '--exclude-standard']).filter((f) => !f.includes('/'));
  const excluded = [];
  const untracked = [];
  const BIG = 5 * 1024 * 1024;
  for (const f of [...untrackedRaw, ...untrackedRoot]) {
    const b = basename(f);
    if (b.startsWith('.')) { excluded.push(f + '（暫存殘檔）'); continue; }
    if (/^scripts\/tmp[a-z0-9_]{4,}\.mjs$/.test(f)) { excluded.push(f + '（tmp*）'); continue; }
    // ⚠ `scripts/_repro_*` / `__smoke*` **不排除**：它們是站長手寫的重現腳本，
    //   而 test-source-encoding 與 test-v6380 掃 scripts/ 時**不會**濾掉它們
    //   （只有 test-v6371 的 isFormal 會濾 /^(tmp|_|\.)/ ）。沙盒少了它們 ⇒
    //   那兩支的母體與主樹不同 ⇒ 是「沙盒特有假綠」的溫床。同步進去才忠實。
    const st = statOf(join(ROOT, f.replace(/\//g, IS_WIN ? '\\' : '/')));
    if (st && st.size > BIG) { excluded.push(f + `（>5MB：${(st.size / 1048576).toFixed(1)}MB）`); continue; }
    untracked.push(f);
  }
  const all = [...new Set([...tracked, ...untracked])].sort();
  if (all.length < 1000) throw new Error(`同步清單只有 ${all.length} 個檔 —— 建構器壞了？`);
  return { all, tracked, untracked, excluded };
}

function statOf(p) { try { return statSync(p); } catch { return null; } }

function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

// 遞迴列出沙盒內的實體檔（排除 node_modules / .git / .svelte-kit，且不下鑽 symlink/junction）
function walkSandbox(root) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? join(root, rel) : root;
    let ents;
    try { ents = readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;                 // junction 不下鑽
      // ⚠⚠ SKIP 檢查必須放在**分辨檔案/目錄之前**：在 git worktree 裡 `.git`
      //   是一個**檔案**（內容是 `gitdir: …`），不是目錄。只在目錄分支排除的話，
      //   下面的「刪除不在清單的檔」會把它刪掉，整個沙盒的 git 就廢了
      //   （git worktree list 會顯示 prunable，所有讀 git 的守衛 exit=128）。
      if (SKIP_DIRS.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { stack.push(r); }
      else if (e.isFile()) { out.push(r); }
    }
  }
  return out;
}

// ⚠⚠ 每個沙盒都要先有 `.svelte-kit/`，否則 esbuild 會對每一支守衛印四行警告：
//     ▲ [WARNING] Cannot find base config file "./.svelte-kit/tsconfig.json"
//   （根 tsconfig.json 的 `extends` 指向它。）
//   為什麼會不一致：`.svelte-kit/` 在 SKIP_DIRS ⇒ 不同步、不刪、不照快照。
//   序列跑時 test-v6394-tsc-clean 早早在 w1 跑過 `svelte-kit sync` 生出它，
//   之後 w1 的守衛就沒警告了；平行跑時 v6394 只落在**某一個**沙盒，其他五個
//   沙盒的 esbuild 守衛全都多印那四行 ⇒ 實測造成 43 支輸出指紋軟差異。
//   結果本身沒受影響（exit code 與條數都一樣），但那會把「指紋」這個假綠偵測器
//   整個淹掉。⇒ 建沙盒時就 sync 一次，讓所有沙盒（含序列用的 w1）狀態相同，
//   也與主樹一致（主樹本來就有 .svelte-kit/）。sync 是冪等的，v6394 自己再跑一次無妨。
function syncSvelteKit(sb) {
  const SK = join(sb, 'node_modules', '@sveltejs', 'kit', 'svelte-kit.js');
  if (!existsSync(SK)) return 'no-kit';
  // ⚠ **不做 `already` 短路**：.svelte-kit 在 SKIP_DIRS ⇒ 不同步、不刪、不照快照，
  //   所以換了 HEAD（路由結構變了）之後那份產物會陳舊而沒人發現。sync 是冪等的、
  //   實測 2.7 秒，每次重跑比留一份看不見的陳舊狀態便宜得多。
  const r = spawnSync(process.execPath, [SK, 'sync'], { cwd: sb, stdio: 'pipe', timeout: 300000, windowsHide: true });
  return r.status === 0 ? 'ok' : ('fail:' + String(r.stderr || '').slice(0, 120));
}

function createSandbox(sb, headSha) {
  if (!existsSync(sb)) {
    ensureDir(dirname(sb));
    git(['worktree', 'add', '--detach', sb, headSha]);
  } else {
    // 已經存在：把它拉回同一個 SHA。
    // ⚠ 註記：HEAD 有變動時 checkout **會**用 blob 位元組覆寫檔案（autocrlf 生效），
    //   所以這一步不是 no-op；但隨後的 (b) 會因為 mtime/size 不同把主樹位元組全部蓋回去，
    //   結果仍然正確。真正決定沙盒內容的是 (b)(c)，不是這一行。
    try { git(['checkout', '-q', '--detach', headSha], sb); } catch { /* tree 相同時是 no-op */ }
  }
  const nm = join(sb, 'node_modules');
  if (!existsSync(nm)) {
    if (IS_WIN) {
      const r = spawnSync('cmd', ['/c', 'mklink', '/J', nm, join(ROOT, 'node_modules')], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`mklink /J 失敗：${r.stderr || r.stdout}`);
    } else {
      spawnSync('ln', ['-sfn', join(ROOT, 'node_modules'), nm]);
    }
  }
}

// 把主樹的位元組同步進沙盒；回傳 {copied, deleted}
function syncSandbox(sb, list) {
  const want = new Set(list.all);
  let copied = 0, deleted = 0;
  for (const rel of list.all) {
    const src = join(ROOT, rel.replace(/\//g, IS_WIN ? '\\' : '/'));
    const dst = join(sb, rel.replace(/\//g, IS_WIN ? '\\' : '/'));
    const ss = statOf(src);
    if (!ss || !ss.isFile()) continue;
    const ds = statOf(dst);
    // ⭐ mtime 或 size 任一不同就覆蓋（不是「來源較新才覆蓋」）
    const same = ds && ds.isFile() && ds.size === ss.size &&
                 Math.abs(ds.mtimeMs - ss.mtimeMs) < 2;
    if (same) continue;
    ensureDir(dirname(dst));
    copyFileSync(src, dst);
    try { utimesSync(dst, ss.atime, ss.mtime); } catch { /* 對不上時間不致命 */ }
    copied++;
  }
  for (const rel of walkSandbox(sb)) {
    if (want.has(rel)) continue;
    try { rmSync(join(sb, rel.replace(/\//g, IS_WIN ? '\\' : '/')), { force: true }); deleted++; } catch { /* 略 */ }
  }
  return { copied, deleted };
}

// ── subst 磁碟機代號 ────────────────────────────────────────────────────────
function substList() {
  if (!IS_WIN) return new Map();
  const r = spawnSync('cmd', ['/c', 'subst'], { encoding: 'utf8' });
  const m = new Map();
  for (const L of String(r.stdout || '').split(/\r?\n/)) {
    const mm = /^([A-Z]):\\?:?\s*=>\s*(.+)$/.exec(L.trim());
    if (mm) m.set(mm[1], mm[2].trim());
  }
  return m;
}
function driveInUse(letter) {
  if (!IS_WIN) return false;
  if (substList().has(letter)) return true;
  return existsSync(letter + ':\\');
}
function substAdd(letter, path) {
  const r = spawnSync('cmd', ['/c', 'subst', letter + ':', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`subst ${letter}: 失敗：${r.stderr || r.stdout}`);
}
function substDel(letter) {
  spawnSync('cmd', ['/c', 'subst', letter + ':', '/D'], { encoding: 'utf8' });
}

// ════════════════════════════════════════════════════════════════════════════
// 【4】快照：leak（沙盒殘檔）與 escape（沙盒外寫入）
// ════════════════════════════════════════════════════════════════════════════
// ⚠ **絕不做遞迴全樹快照**：Windows 的 readdirSync 會把 junction 當目錄，
//   遞迴快照會一路走進 31,280 個檔的 node_modules ⇒ 735 支 × 2 次 × 35,000
//   ≈ 5,170 萬次目錄項，比測試本身還久。
// ⭐ 改成**非遞迴兩層**：沙盒根一層 ＋ 沙盒 scripts/ 一層。
//   117 條碰撞暫存路徑全部落在這兩層（根目錄點檔 385 個、scripts/ 點檔 20 個），
//   所以這是「等價覆蓋」而不是「抽樣」。
function snapLevel(dir) {
  const m = new Map();
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return m; }
  for (const e of ents) {
    // ⚠⚠ 必須擋掉 SKIP_DIRS 的名字，**而且要在 isFile() 之前**：
    //   在 git worktree 裡 `.git` 是一個**檔案**（內容是 `gitdir: …`），不是目錄。
    //   它不在 SYNC_SET 裡（git ls-tree 不含它），所以一旦進了快照，
    //   restoreSandbox 會把它當成「不在清單的新增檔」直接 rmSync ⇒ 整個沙盒的 git 廢掉，
    //   之後該沙盒所有讀 git 的守衛 exit=128（70 支走 lib/base-blob）。
    if (SKIP_DIRS.has(e.name)) continue;
    if (!e.isFile()) continue;
    const st = statOf(join(dir, e.name));
    if (st) m.set(e.name, st.size + ':' + Math.round(st.mtimeMs));
  }
  return m;
}
// ⚠ 面就是 restoreSandbox 的涵蓋範圍：偵測不到的東西也不會被回復。
//   117 條碰撞暫存路徑全在根與 scripts/ 兩層，但守衛若往自己沙盒的
//   src/ oracle-admin/ static/ 寫東西，那會是完全隱形且一路留給後面的守衛
//   ——而序列基準與平行版的執行順序不同 ⇒ 兩邊累積的污染不同 ⇒ 判準本身被污染。
const SNAP_DIRS = ['scripts', 'src', 'oracle-admin', 'static'];
function snapSandbox(sb) {
  const o = { root: snapLevel(sb) };
  for (const d of SNAP_DIRS) o[d] = snapLevel(join(sb, d));
  return o;
}
function diffSnap(before, after) {
  const out = [];
  for (const [k, v] of after) { const b = before.get(k); if (b === undefined) out.push('+' + k); else if (b !== v) out.push('~' + k); }
  for (const k of before.keys()) if (!after.has(k)) out.push('-' + k);
  return out;
}
function diffSandbox(b, a) {
  const out = [...diffSnap(b.root, a.root)];
  for (const d of SNAP_DIRS) out.push(...diffSnap(b[d], a[d]).map((s) => s[0] + d + '/' + s.slice(1)));
  return out;
}

// escape 三小面：主樹根一層、主樹 node_modules/.cache/ptcg-v6166、<代號>:\tmp
// ⚠ 這三個面是**逐支**照得起的（幾百個 entry），所以 escape 能直接歸因到「是哪一支」。
const V6166_CACHE = join(ROOT, 'node_modules', '.cache', 'ptcg-v6166');
const V6166_ALLOW = /^c\d+\.server\.js$/;   // 唯一具名例外（見檔頭）
// ⚠ 面要蓋到四處，缺一個就是靜默盲區：
//   ① 主樹根一層      ② 主樹 node_modules/.cache/ptcg-v6166（junction 穿透的唯一出口）
//   ③ <代號>:\tmp     ④ **實體磁碟機的 \tmp**（萬一 subst 隔離在某個路徑上失效，
//                        硬寫 /tmp 的守衛會落在這裡；實測 subst 沒失效，但面要留著
//                        才算證明，不能靠推論）
//   ⑤ os.tmpdir() 一層（28 支守衛用 mkdtempSync，跨沙盒共用同一個 %TEMP%）
const PHYS_TMP = (() => {
  const m = /^([A-Za-z]):/.exec(OPT.sandboxRoot);
  return m ? m[1] + ':\\tmp' : null;
})();
function snapEscape(slot) {
  return {
    main: snapLevel(ROOT),
    cache: snapLevel(V6166_CACHE),
    tmp: slot && slot.tmpDir ? snapLevel(slot.tmpDir) : new Map(),
    phys: PHYS_TMP ? snapLevel(PHYS_TMP) : new Map(),
    ostmp: snapLevel(os.tmpdir()),
  };
}
function diffEscape(b, a) {
  const hard = [];
  const allowed = [];
  for (const d of diffSnap(b.main, a.main)) hard.push('main/' + d.slice(1) + '|' + d[0]);
  for (const d of diffSnap(b.cache, a.cache)) {
    const name = d.slice(1);
    (V6166_ALLOW.test(name) ? allowed : hard).push('cache/' + name + '|' + d[0]);
  }
  for (const d of diffSnap(b.tmp, a.tmp)) hard.push('tmp/' + d.slice(1) + '|' + d[0]);
  for (const d of diffSnap(b.phys, a.phys)) hard.push('PHYS-tmp/' + d.slice(1) + '|' + d[0]);
  // os.tmpdir() 是 28 支守衛的 mkdtempSync 目標（隨機唯一名，不會碰撞）⇒ 列報不擋，
  // 但要看得見，因為被 timeout 殺掉時那些垃圾會永遠留著而沒人知道。
  for (const d of diffSnap(b.ostmp, a.ostmp)) allowed.push('OSTMP/' + d.slice(1) + '|' + d[0]);
  return { hard, allowed };
}

// ════════════════════════════════════════════════════════════════════════════
// 【5】執行單支守衛
// ════════════════════════════════════════════════════════════════════════════
// ⚠ 站內守衛的輸出樣式不只一種（實測 chain 上的分布）：
//     FAIL 524 支 ／ PASS 360 ／ ✓ 94 ／ ✗ 82 ／ OK 20，
//   而且**有 103 支完全沒有可辨識的逐條樣式**（純 assert，不印）。
//   所以「PASS/FAIL 條數」這個指標本身覆蓋不到全部 ⇒ 再加一個通用指紋。
// ⭐ 每支跑完把沙盒**回復**到同步後的狀態：新增的暫存檔刪掉、被改過的清單內檔
//   從主樹重新複製回來。這消除「同一個沙盒裡，前一支守衛的殘留影響後一支」的
//   順序相依 —— 序列基準與平行版都做同樣的回復，所以比對仍然公平，
//   而且比序列 `npm test`（殘檔會一路累積）更乾淨。
//   實測必要性：test-v6370 會 mutate 別支守衛檔做突變測試（內容有還原、mtime 變），
//   test-v6368 會留下 .stub-paths.js（19 支守衛共用的那個名字）。
let SYNC_SET = new Set();
function restoreSandbox(slot, leak) {
  if (OPT.noRestore) return 0;
  let fixed = 0;
  for (const d of leak) {
    const op = d[0];
    const rel = d.slice(1);
    const abs = join(slot.sb, rel.replace(/\//g, IS_WIN ? '\\' : '/'));
    if (!SYNC_SET.has(rel)) {
      if (op === '+' || op === '~') { try { rmSync(abs, { force: true }); fixed++; } catch { /* 略 */ } }
      continue;
    }
    // 清單內的檔被動過（或被刪掉）⇒ 從主樹補回來
    const src = join(ROOT, rel.replace(/\//g, IS_WIN ? '\\' : '/'));
    const ss = statOf(src);
    if (!ss) continue;
    try {
      ensureDir(dirname(abs));
      copyFileSync(src, abs);
      utimesSync(abs, ss.atime, ss.mtime);
      fixed++;
    } catch { /* 略 */ }
  }
  return fixed;
}

const RE_PASS = /^\s*(?:PASS|OK)\b|^\s*[\u2713\u2714]/;
const RE_FAIL = /^\s*(?:FAIL|NG)\b|^\s*[\u2717\u2718\u2716]/;

// ⭐ 具名的「已知會浮動」清單。
//   為什麼要具名而不是整批無視：軟差異清單一旦長到沒人看，它就變成安慰劑。
//   每一條都要附**實測出來的**理由與證據，不是「看起來像雜訊」。
//   ⚠ 只影響軟差異的列報，硬判準（exit code／PASS-FAIL 條數／SHALLOW-SKIP 次數）不受影響。
const NOISY_OUTPUT = new Map([
  ['scripts/test-corrosion-mist-immune-log.mjs',
   '引擎 createGame 的先攻擲硬幣（Math.random，50/50），log 會印「A 獲勝」或「B 獲勝」。'
   + ' 實測：序列與平行各跑到不同結果，但兩邊都是 2 PASS / 0 FAIL / exit 0 ⇒ 不影響判準。'],
  ['scripts/test-v6182-deck-post-comments.mjs',
   '假 Firestore 的 sort() 對同鍵值不保證穩定順序（:201 的比較函式對相等鍵回 0）⇒'
   + ' 同分留言的先後可能不同。實測兩邊 exit 與條數相同。'],
]);

// ⭐ 通用輸出指紋：抓「少跑了一整段」這種假綠。
//   守衛常寫「拿不到資源就整段跳過」，那時支數還是綠、斷言卻少跑了一批。
//   正規化掉會合理浮動的東西（數字＝耗時／計數、磁碟機代號＝哪個沙盒、絕對路徑），
//   剩下的骨架在序列與平行之間應該逐字相同。
//   ⚠ 這一項是**軟判準**（列報不擋）：少數守衛的輸出本來就含不可重現的內容。
import { createHash } from 'node:crypto';
function fingerprint(out) {
  const raw = out.split(/\r?\n/).filter((L) => L.trim() !== '');
  // (a) 骨架指紋：抹掉會合理浮動的東西（耗時、計數、沙盒代號、mkdtemp 隨機字尾）
  const skel = raw.map((L) => L
    .replace(/[A-Za-z]:[\\/]/g, '<D>/')
    .replace(/file:\/\/\/[^\s'"`)]+/g, '<url>')
    // mkdtempSync 的隨機字尾。多段前綴也要吃到（v6334-base-XXXXXX、v6371-<tag>-XXXXXX）
    .replace(/(v?\d{3,4}[a-z]*(?:-[a-z0-9]+)*-)[A-Za-z0-9]{6}\b/g, '$1<tmp>')
    .replace(/\bpid[=:\s-]*\d+/gi, 'pid=<pid>')
    .replace(/\d+/g, '#')
    // ⚠ 必須壓縮行內連續空白：守衛常用 `x.toFixed(1).padStart(9)` 對齊數字，
    //   數值位數一變，**補的空白數就跟著變**，而抹掉數字之後那個空白差異還在
    //   ⇒ 骨架指紋會為了純粹的對齊而翻紅（實測：test-v6255-perf 在 7 次平行跑裡
    //     中了 1 次，行數相同、斷言結果相同，只有 padStart 的空白數不同）。
    //   縮排對守衛輸出而言是固定的樣板，不帶結構訊息，壓掉是安全的。
    .replace(/[ \t]+/g, ' ')
    .trim());
  // (b) ⭐ 計數向量指紋：**只保留數字**。
  //   骨架指紋把 \d+ 抹成 '#'，於是「掃了 0 個檔」和「掃了 500 個檔」會是同一個指紋
  //   —— 而 chain 上有 103 支守衛完全沒有逐條 PASS/FAIL 樣式，對它們來說
  //   「母體被抽空的空真」就完全沒有東西在守。這一條專門守母體大小。
  //   （這個 repo 自己記錄過同型事故：test-v6224:199「條數不變、無 SKIP 字樣、
  //     整體綠燈，實際上從來沒有在守」。）
  //   ⚠ nums 必須套用**與 skel 完全相同**的前處理，否則 mkdtemp 的隨機字尾、
  //     URL、pid 裡的數字會讓計數向量每次都不同，跟平行與否無關（純雜訊）。
  const nums = skel.map((L) => (L.match(/\d+/g) || []).join(',')).join('|');
  return {
    lines: skel.length,
    sha: createHash('sha256').update(skel.join('\n')).digest('hex').slice(0, 16),
    num: createHash('sha256').update(nums).digest('hex').slice(0, 16),
  };
}

function runOne(script, slot, durMap) {
  return new Promise((done) => {
    const base = durMap.get(script) || 20000;
    const timeoutMs = Math.min(OPT.timeoutMaxMs, Math.max(OPT.timeoutMinMs, Math.round(base * OPT.timeoutMul)));
    const cwd = slot.cwd;
    const sbBefore = snapSandbox(slot.sb);
    const escBefore = snapEscape(slot);   // ⚠ 必須傳 slot 物件：傳字串的話 slot.tmpDir 是 undefined，before 的 tmp 面會恆為空 Map
    const t0 = now();
    const child = spawn(process.execPath, [script.replace(/\//g, IS_WIN ? '\\' : '/')], {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let timedOut = false;
    let settled = false;
    let graceTimer = null;

    // ⚠⚠ 逾時必須殺**整棵子樹**：站內有 18 處守衛會 spawn 子行程（全部 cwd: ROOT），
    //   而 Windows 的 child.kill() 只 TerminateProcess 那一個 PID，孫行程（tsc /
    //   esbuild / svelte-kit sync）會繼續活著繼續寫沙盒。更糟的是孫行程繼承了
    //   stdout 管線 ⇒ 殺掉父行程不會關 pipe ⇒ **'close' 永遠不觸發 ⇒ 這個 Promise
    //   永遠不 settle ⇒ 那個 worker 永久掛住、整輪停在半路且毫無輸出**。
    //   所以：taskkill /T /F 殺整棵，再加一層 grace timer 強制收尾。
    const killTree = () => {
      // ⚠ POSIX：我們沒有用 detached:true spawn，所以子行程與 runner 同一個 process
      //   group，`process.kill(-pid)` 不是「殺這棵樹」——它要嘛 ESRCH，要嘛殺到不相干
      //   的行程組。這裡只殺直接子行程，孫行程交給 grace timer 收尾。
      if (!IS_WIN) { try { child.kill('SIGKILL'); } catch {} return; }
      try { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, timeout: 20000 }); } catch {}
      try { child.kill('SIGKILL'); } catch {}
    };
    const killer = setTimeout(() => {
      timedOut = true;
      killTree();
      // 就算 pipe 沒關，10 秒後也強制收尾，不讓 worker 永久卡住
      graceTimer = setTimeout(() => finishOnce(null), 10000);
    }, timeoutMs);

    const finishOnce = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (graceTimer) clearTimeout(graceTimer);
      // ⚠ 這整段包 try/catch：快照／回復有可能撞到正被孤兒行程寫入的檔而丟例外，
      //   而 ChildProcess 的 handler 裡未捕捉的例外會變成 uncaughtException，
      //   直接讓整輪死掉、報表不寫。
      let r;
      try {
        const ms = now() - t0;
        let pass = 0, fail = 0;
        for (const L of out.split(/\r?\n/)) { if (RE_PASS.test(L)) pass++; else if (RE_FAIL.test(L)) fail++; }
        const fp = fingerprint(out);
        // ⭐ lib/base-blob.mjs 的 _git() 是 `try { execFileSync } catch { return {ok:false} }`
        //   ——吞掉一切錯誤。6-way 爭用下任何一次 git 的暫時性失敗，都會把一段 HEAD-FAIL
        //   斷言靜默降級成 `⚠⚠ SHALLOW-SKIP`，而 PASS/FAIL 條數完全看不到（skip 分支直接
        //   return，不計條）⇒ 這是一個免費、而且比通用指紋精準一個數量級的訊號。
        //
        // ⚠⚠ 但判準**不是「必須為 0」**。實測：本機 `is-shallow-repository` = false，
        //   卻仍有 1 支（test-v6304）回報 2 次 SHALLOW-SKIP ——
        //     ⚠⚠ SHALLOW-SKIP  v6304 F1 三尺寸版面量測 —— 這台機器沒有 playwright
        //   也就是說 `shallowSkip()` 這個機制**被挪用來報告「缺瀏覽器」**，語意不只是淺複製。
        //   主樹與沙盒都是 2 次（我逐一實跑比對過）⇒ 那是既有狀態，不是沙盒或爭用造成的。
        //   ⇒ 正確的判準是「**與序列基準逐支一致**」：既有的 skip 照舊，爭用**新增**的才翻紅。
        const shallowSkips = (out.match(/SHALLOW-SKIP/g) || []).length;
        const leak = diffSandbox(sbBefore, snapSandbox(slot.sb));
        const esc = diffEscape(escBefore, snapEscape(slot));
        const restored = restoreSandbox(slot, leak);
        r = {
          script, ms, exitCode: timedOut ? 'TIMEOUT' : code, pass, fail, timedOut,
          outLines: fp.lines, outFp: fp.sha, numFp: fp.num, shallowSkips,
          timeoutMs, sandbox: slot.name, drive: slot.letter || null,
          leak, restored, escape: esc.hard, escapeAllowed: esc.allowed,
          tail: (code !== 0 || timedOut) ? out.slice(-2500) : '',
        };
        if (OPT.dumpOut) {
          try {
            ensureDir(OPT.dumpOut);
            writeFileSync(join(OPT.dumpOut, basename(script) + '.out.txt'), out);
          } catch { /* 診斷用，失敗不致命 */ }
        }
      } catch (e) {
        r = {
          script, ms: now() - t0, exitCode: 'RUNNER-ERROR', pass: 0, fail: 0, timedOut,
          outLines: 0, outFp: '', numFp: '', timeoutMs, sandbox: slot.name, drive: slot.letter || null,
          leak: [], restored: 0, escape: [], escapeAllowed: [],
          tail: 'runner 在收尾時丟例外：' + (e && e.message || e) + '\n' + out.slice(-1500),
        };
      }
      done(r);
    };

    child.on('error', (e) => { out += '\n[runner] spawn 失敗：' + (e && e.message || e) + '\n'; finishOnce('SPAWN-ERROR'); });
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      finishOnce(code);
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 【6】排程：階段一平行（LPT 長尾優先，heavy 同時最多 1 支）／階段二序列
// ════════════════════════════════════════════════════════════════════════════
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPhase(list, slots, durMap, heavySet, label, onResult) {
  // LPT：長的先派。沒有歷史耗時的排在已知長工之後、短工之前（保守給 15s）
  // --no-restore 是在模擬 `npm test` 的累積語意 ⇒ 必須照 chain 原序，不可以 LPT 重排
  const queue = OPT.noRestore ? [...list] : [...list].sort((a, b) => (durMap.get(b) ?? 15000) - (durMap.get(a) ?? 15000));
  const total = queue.length;
  let heavyBusy = false;
  let doneN = 0;
  const t0 = now();

  async function worker(slot) {
    for (;;) {
      if (!queue.length) return;
      let idx = -1;
      for (let i = 0; i < queue.length; i++) {
        if (heavySet.has(queue[i]) && heavyBusy) continue;
        idx = i; break;
      }
      if (idx < 0) { await sleep(40); continue; }   // 只剩 heavy 且被占用 ⇒ 等
      const script = queue.splice(idx, 1)[0];
      const isHeavy = heavySet.has(script);
      if (isHeavy) heavyBusy = true;
      const qAt = now();
      let r;
      try {
        r = await runOne(script, slot, durMap);
      } catch (e) {
        r = { script, ms: now() - qAt, exitCode: 'RUNNER-ERROR', pass: 0, fail: 0, timedOut: false,
              outLines: 0, outFp: '', numFp: '', sandbox: slot.name, drive: slot.letter || null,
              leak: [], restored: 0, escape: [], escapeAllowed: [],
              tail: 'runOne 丟例外：' + (e && e.message || e) };
      } finally {
        // ⚠ 一定要 finally：runOne 只要沒正常回來（例外／永不 settle 的舊 bug），
        //   heavyBusy 卡在 true 就會讓其餘 worker 全部落進 sleep(40) 空轉＝活鎖。
        if (isHeavy) heavyBusy = false;
      }
      r.phase = label;
      r.queuedAtMs = qAt - t0;
      if (isHeavy) r.heavy = true;
      doneN++;
      onResult(r, doneN, total);
    }
  }
  await Promise.all(slots.map((s) => worker(s)));
  return now() - t0;
}

// ════════════════════════════════════════════════════════════════════════════
// 【7】main
// ════════════════════════════════════════════════════════════════════════════
const slots = [];
let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  for (const s of slots) if (s.letter) { try { substDel(s.letter); } catch {} }
}
process.on('exit', teardown);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => { teardown(); process.exit(130); }); } catch {}
}
process.on('uncaughtException', (e) => { teardown(); console.error(e); process.exit(1); });

async function main() {
  const chain = parseChain();
  const durMap = loadDurations();
  const timing = classifyTiming(chain.uniq);
  const timingSet = new Set(timing);
  const phase1 = [...chain.uniq.filter((s) => !timingSet.has(s))];
  const phase2 = [...chain.uniq.filter((s) => timingSet.has(s))];
  const heavySet = classifyHeavy(phase1, durMap, 4);
  if (OPT.only.length) {
    const keep = (a) => a.filter((x) => OPT.only.some((k) => x.includes(k)));
    phase1.splice(0, phase1.length, ...keep([...phase1]));
    phase2.splice(0, phase2.length, ...keep([...phase2]));
    log(`⚠ --only 生效：只跑 ${phase1.length + phase2.length} 支（這**不是**驗收用的全套）`);
  }

  if (durMap.size < 300) {
    log(`⚠⚠ 只讀到 ${durMap.size} 支的歷史耗時（預期 ≥300）——LPT 長尾優先與 heavy 節流都會退化，`);
    log('   而且 per-guard timeout 會全部落在下限值。第一次跑或報表目錄被清掉時會這樣。');
  }

  const headSha = git(['rev-parse', 'HEAD']).trim();
  const sumMs = (a) => a.reduce((s, x) => s + (durMap.get(x) ?? 15000), 0);

  log('════════════════════════════════════════════════════════════════');
  log(`run-tests.mjs  HEAD=${headSha.slice(0, 8)}  workers=${OPT.workers}`);
  log(`chain ${chain.stepCount} 步 → 去重 ${chain.uniq.length} 支` +
      (chain.dups.length ? `（重複 ${chain.dups.length}：${chain.dups.map((d) => basename(d)).join(', ')}）` : ''));
  log(`階段一 平行：${phase1.length} 支（歷史合計 ${fmtM(sumMs(phase1))}）  heavy=${heavySet.size}`);
  log(`階段二 序列：${phase2.length} 支 牆鐘斷言守衛（歷史合計 ${fmtM(sumMs(phase2))}）`);
  log(`  heavy: ${[...heavySet].map((s) => basename(s)).join(', ')}`);
  log('════════════════════════════════════════════════════════════════');

  if (OPT.list) {
    log('\n【階段二 · 牆鐘斷言守衛（獨占序列）】');
    for (const s of phase2.sort()) log('   ' + basename(s) + '   ' + (durMap.has(s) ? fmtS(durMap.get(s)) : '?'));
    log('\n【階段一 · LPT 前 15】');
    for (const s of [...phase1].sort((a, b) => (durMap.get(b) ?? 0) - (durMap.get(a) ?? 0)).slice(0, 15)) {
      log('   ' + String(durMap.has(s) ? fmtS(durMap.get(s)) : '?').padStart(8) + '  ' + basename(s));
    }
    return 0;
  }

  // ── 沙盒 ──────────────────────────────────────────────────────────────
  const nSb = OPT.workers;
  if (IS_WIN && !OPT.noSubst && OPT.drives.length < nSb) {
    throw new Error(`需要 ${nSb} 個磁碟機代號，--drives 只給了 ${OPT.drives.length} 個`);
  }
  for (let i = 0; i < nSb; i++) {
    const name = 'w' + (i + 1);
    const sbParent = join(OPT.sandboxRoot, name);
    const sb = join(sbParent, 'repo');          // repo 一定在子目錄，不在代號根
    const letter = (IS_WIN && !OPT.noSubst) ? OPT.drives[i] : null;
    if (letter) {
      const inUse = substList().get(letter);
      if (inUse && pResolve(inUse) !== pResolve(sbParent)) {
        throw new Error(`磁碟機代號 ${letter}: 已被占用（→ ${inUse}）—— fail-fast，請換 --drives`);
      }
      if (!inUse && driveInUse(letter)) {
        throw new Error(`磁碟機代號 ${letter}: 已存在（非 subst）—— fail-fast，請換 --drives`);
      }
    }
    slots.push({
      name, sbParent, sb, letter,
      // ⭐ cwd 是代號下的 repo 子目錄（見檔頭「代號根目錄不能直接當 repo」）
      cwd: letter ? letter + ':\\repo' : sb,
      tmpDir: letter ? letter + ':\\tmp' : join(sbParent, 'tmp'),
    });
  }

  // ⭐ 前置斷言 1：index 必須等於 HEAD。
  //   站內有 3 支守衛用 `git ls-files`（讀的是 index 不是 HEAD）：lint-eol-anchors、
  //   test-v6130、test-v6272。而這個站用 Python git plumbing 推版、**不更新 .git/index**
  //   （test-lib-strip-markup-sections:492 自己記著這件事）⇒ 主樹 index 有可能落後。
  //   沙盒 worktree 的 index 是 `worktree add` 當下寫的（新的）⇒ 兩邊會分岔。
  {
    const r = spawnSync('git', ['-C', ROOT, 'diff', '--cached', '--quiet', 'HEAD'], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error('主樹的 git index 與 HEAD 不一致 —— 3 支讀 index 的守衛（lint-eol-anchors／'
        + 'test-v6130／test-v6272）在沙盒與主樹會給出不同答案。請先 `git reset --mixed HEAD` 再跑。');
    }
  }
  // ⭐ 前置斷言 2：記下主樹的 git 狀態。restoreSandbox 會在跑的過程中**即時從主樹補檔**，
  //   所以主樹在這 30 多分鐘裡一被人動過，沙盒就會從那一刻起漂移。跑完再照一次比對。
  const statusBefore = gitLines(['-c', 'core.quotepath=false', 'status', '--porcelain']).join('\n');

  log('\n[沙盒] 建立/同步中…');
  const list = buildSyncList();
  SYNC_SET = new Set(list.all);
  log(`  同步清單 ${list.all.length} 檔（追蹤 ${list.tracked.length} + 未追蹤 ${list.untracked.length}）` +
      `，排除未追蹤 ${list.excluded.length} 個`);
  if (list.excluded.length) {
    for (const f of list.excluded) log('    排除：' + f);
  }
  for (const slot of slots) {
    const t = now();
    createSandbox(slot.sb, headSha);
    const r = syncSandbox(slot.sb, list);
    if (slot.letter && !substList().has(slot.letter)) { ensureDir(slot.sbParent); substAdd(slot.letter, slot.sbParent); }
    // ⚠ <代號>:\tmp 要先建出來。三支硬寫 `/tmp/...` 的守衛（v6297／v6303／v6306）
    //   目前因為這台機器沒裝 playwright 而全部走 SKIP 分支 ⇒ 那條路從未被實際行使
    //   （安慰劑型態 4：空真）。哪天裝了 playwright，沙盒沒有這個目錄就會 ENOENT ⇒
    //   變成**沙盒獨有的假紅**（主樹有 E:\tmp 就會過）。先建好，讓隔離是真的。
    ensureDir(slot.tmpDir);
    const sk = syncSvelteKit(slot.sb);
    // ⚠⚠ fail-fast，不可以只 log 一行：4 個沙盒成功 2 個失敗 ⇒ 又回到剛修掉的那個
    //   狀態不對稱。而且 test-v6394 的 A0b 哨兵（「sync 之後 tsconfig.json 必須存在」）
    //   因為 runner 預先造好了那個檔，在沙盒裡已經變成恆真 ⇒ 那個不變量現在由這裡接手。
    if (!existsSync(join(slot.sb, '.svelte-kit', 'tsconfig.json'))) {
      throw new Error(`${slot.name} 的 svelte-kit sync 沒有產出 .svelte-kit/tsconfig.json（${sk}）`
        + ' —— 沙盒之間會出現狀態不對稱，拒絕繼續。');
    }
    log(`  ${slot.name} ${slot.letter ? slot.letter + ':' : ''} 複製 ${r.copied} / 刪除 ${r.deleted} / .svelte-kit ${sk}  (${fmtS(now() - t)})`);
  }
  if (OPT.setupOnly) { log('\n--setup-only 完成（沙盒保留，subst 未釋放）'); tornDown = true; return 0; }

  // ── 執行 ──────────────────────────────────────────────────────────────
  const results = [];
  const mainBefore = snapEscape(null);   // 整輪前的主樹面
  const bar = (r, n, total) => {
    const flag = r.timedOut ? 'TIMEOUT' : (r.exitCode === 0 ? 'ok  ' : 'FAIL');
    const extra = (r.leak.length ? ` leak=${r.leak.length}` : '') + (r.escape.length ? ` ESCAPE=${r.escape.length}` : '');
    log(`[${String(n).padStart(3)}/${total}] ${flag} ${basename(r.script).padEnd(58)} ${String(fmtS(r.ms)).padStart(8)} ${r.sandbox}${extra}`);
  };

  log(`\n[階段一] 平行 ${OPT.workers} workers，${phase1.length} 支`);
  const t1 = await runPhase(phase1, slots, durMap, heavySet, 'parallel', (r, n, t) => { results.push(r); bar(r, n, t); });
  log(`[階段一] 完成 ${fmtM(t1)}`);

  log(`\n[階段二] 序列獨占，${phase2.length} 支牆鐘斷言守衛`);
  const t2 = await runPhase(phase2, [slots[0]], durMap, new Set(), 'serial-timing', (r, n, t) => { results.push(r); bar(r, n, t); });
  log(`[階段二] 完成 ${fmtM(t2)}`);

  const mainDiff = diffEscape(mainBefore, snapEscape(null));
  const statusAfter = gitLines(['-c', 'core.quotepath=false', 'status', '--porcelain']).join('\n');
  const statusChanged = statusBefore !== statusAfter;
  if (statusChanged) {
    log('\n⚠⚠ 主樹的 git status 在這一輪之間變了 —— 有人（或別的程式）動了主樹，');
    log('   而 restoreSandbox 會即時從主樹補檔 ⇒ 沙盒從那一刻起就漂移了。這一輪的結果不可信。');
  }
  return finish({ chain, timing: phase2, heavySet, results, t1, t2, headSha, mainDiff, durMap, statusChanged });
}

// ════════════════════════════════════════════════════════════════════════════
// 【8】報表與驗收判準
// ════════════════════════════════════════════════════════════════════════════
function finish(ctx) {
  const { chain, timing, heavySet, results, t1, t2, headSha, mainDiff, durMap, statusChanged } = ctx;
  const byScript = new Map(results.map((r) => [r.script, r]));

  const failed = results.filter((r) => r.exitCode !== 0);
  const escaped = results.filter((r) => r.escape.length);
  const leaked = results.filter((r) => r.leak.length);
  const shallow = results.filter((r) => (r.shallowSkips || 0) > 0);
  // --only 是除錯子集，其餘幾百支當然「沒跑到」，那不是缺陷（D12 的另一半）
  const missing = OPT.only.length ? [] : chain.uniq.filter((s) => !byScript.has(s));

  // ── 與基準逐支比對 ────────────────────────────────────────────────────
  let cmp = null;
  if (OPT.baseline) {
    let base = null;
    try { base = JSON.parse(readFileSync(OPT.baseline, 'utf8')); } catch (e) {
      log(`\n⚠ 讀不到基準 ${OPT.baseline}：${e.message}`);
    }
    if (base) {
      const bm = new Map((base.results || []).map((r) => [r.script, r]));
      const diffs = [];
      const soft = [];
      for (const r of results) {
        const b = bm.get(r.script);
        if (!b) { diffs.push({ script: r.script, why: '基準沒有這一支' }); continue; }
        // ⭐ 不只比 exit code —— 也比 PASS/FAIL 條數。
        //   假綠的典型形狀是「支數還是綠、斷言數少跑了一整段」。
        if (b.exitCode !== r.exitCode || b.pass !== r.pass || b.fail !== r.fail
            || (b.shallowSkips || 0) !== (r.shallowSkips || 0)) {
          diffs.push({ script: r.script,
            why: `基準 exit=${b.exitCode} P${b.pass}/F${b.fail} skip${b.shallowSkips || 0}`
               + ` ／ 本次 exit=${r.exitCode} P${r.pass}/F${r.fail} skip${r.shallowSkips || 0}` });
        }
        // ⚠ 兩個偵測器要**各自獨立**判斷，不可以用 else-if 串起來：
        //   骨架差異會把計數向量差異整個遮住（實測 43 支軟差異裡，12 支骨架差異
        //   遮掉了它們自己的計數向量差異，讓人誤以為修掉骨架就只剩 31 支）。
        if (b.outFp && r.outFp && b.outFp !== r.outFp) {
          soft.push({ script: r.script, why: `輸出骨架不同（基準 ${b.outLines} 行/${b.outFp} ／ 本次 ${r.outLines} 行/${r.outFp}）` });
        }
        {
          // ⚠ 階段二那 35 支牆鐘斷言守衛豁免：它們印出來的數字**就是**耗時，
          //   每次都會變，拿它當「母體大小」的訊號只會製造雜訊。
          //   它們的骨架仍然照比（上一個分支），所以「少跑一整段」還是抓得到。
          if (b.numFp && r.numFp && b.numFp !== r.numFp && r.phase !== 'serial-timing') {
            soft.push({ script: r.script, why: `⭐ 計數向量不同（數字變了 —— 母體大小或內容雜湊可能被改變）` });
          }
        }
      }
      // --only 是除錯用的子集，基準裡其餘幾百支當然「沒跑到」，那不是差異
      if (!OPT.only.length) {
        for (const s of bm.keys()) if (!byScript.has(s)) diffs.push({ script: s, why: '本次沒跑到' });
      }
      // 具名已知浮動的挑出來單獨列，其餘留在 soft（那些才需要人看）
      const known = soft.filter((d) => NOISY_OUTPUT.has(d.script));
      const rest = soft.filter((d) => !NOISY_OUTPUT.has(d.script));
      cmp = { baseline: OPT.baseline, baselineCount: bm.size, diffs, soft: rest, known };
    }
  }

  // ── 寫報表 ────────────────────────────────────────────────────────────
  const report = {
    meta: {
      at: new Date().toISOString(), headSha, workers: OPT.workers,
      chainSteps: chain.stepCount, unique: chain.uniq.length, dups: chain.dups,
      phase1Ms: t1, phase2Ms: t2, totalMs: t1 + t2,
      timingGuards: timing, heavy: [...heavySet],
      sandboxRoot: OPT.sandboxRoot, drives: slots.map((s) => s.letter),
      node: process.version, cpus: os.cpus().length,
      totalmemGB: +(os.totalmem() / 2 ** 30).toFixed(1),
    },
    results: results.map((r) => ({
      script: r.script, ms: r.ms, exitCode: r.exitCode, pass: r.pass, fail: r.fail,
      outLines: r.outLines, outFp: r.outFp, numFp: r.numFp, shallowSkips: r.shallowSkips,
      timedOut: r.timedOut, timeoutMs: r.timeoutMs, sandbox: r.sandbox, drive: r.drive,
      phase: r.phase, heavy: !!r.heavy, queuedAtMs: r.queuedAtMs,
      leak: r.leak, restored: r.restored, escape: r.escape, escapeAllowed: r.escapeAllowed,
      tail: r.tail || undefined,
    })),
    mainTree: { hard: mainDiff.hard, allowed: mainDiff.allowed, statusChanged: !!statusChanged },
    compare: cmp,
  };
  ensureDir(dirname(OPT.report));
  writeFileSync(OPT.report, JSON.stringify(report, null, 1));

  // ── 摘要 ──────────────────────────────────────────────────────────────
  log('\n════════════════════════════════════════════════════════════════');
  log(`跑了 ${results.length} / ${chain.uniq.length} 支    總計 ${fmtM(t1 + t2)}` +
      `（階段一 ${fmtM(t1)}　階段二 ${fmtM(t2)}）`);
  const hist = chain.uniq.reduce((s, x) => s + (durMap.get(x) ?? 0), 0);
  if (hist > 0) log(`序列歷史合計 ${fmtM(hist)}  ⇒  加速 ${(hist / (t1 + t2)).toFixed(2)}×`);
  log('────────────────────────────────────────────────────────────────');
  log(`FAIL / TIMEOUT : ${failed.length}`);
  log(`escape（沙盒外寫入，硬判準）: ${escaped.length}`);
  log(`主樹差異（硬判準）: ${mainDiff.hard.length}   已授權例外: ${mainDiff.allowed.length}`);
  log(`leak（沙盒殘檔，列報不擋）: ${leaked.length}`);
  log(`SHALLOW-SKIP: ${shallow.length} 支／共 ${shallow.reduce((n, r) => n + r.shallowSkips, 0)} 次` +
      `（判準是「與基準逐支一致」，不是「為 0」—— 見 runOne 的註解）`);
  if (missing.length) log(`⚠ 沒跑到: ${missing.length}`);
  if (cmp) {
    log(`與基準逐支比對：硬差異 ${cmp.diffs.length} 支／輸出指紋軟差異 ${cmp.soft.length} 支`
      + `／已知浮動 ${(cmp.known || []).length} 支（基準 ${cmp.baselineCount} 支）`);
  }
  log('────────────────────────────────────────────────────────────────');

  if (failed.length) {
    log('\n【FAIL / TIMEOUT】');
    for (const r of failed.slice(0, 30)) {
      log(`  ${basename(r.script)}  exit=${r.exitCode}  P${r.pass}/F${r.fail}  ${fmtS(r.ms)}  @${r.sandbox}`);
      if (r.tail) log('    ' + r.tail.split(/\r?\n/).filter(Boolean).slice(-4).join('\n    '));
    }
    if (failed.length > 30) log(`  …還有 ${failed.length - 30} 支`);
  }
  if (escaped.length) {
    log('\n【ESCAPE：沙盒外寫入】');
    for (const r of escaped.slice(0, 20)) log(`  ${basename(r.script)} → ${r.escape.slice(0, 6).join(' , ')}`);
  }
  if (mainDiff.hard.length) {
    log('\n【主樹被改動（硬判準，應為 0）】');
    for (const d of mainDiff.hard.slice(0, 30)) log('  ' + d);
  }
  if (leaked.length) {
    log('\n【LEAK：沙盒殘檔（列報不擋）】');
    for (const r of leaked.slice(0, 15)) log(`  ${basename(r.script)} → ${r.leak.slice(0, 5).join(' , ')}`);
    if (leaked.length > 15) log(`  …還有 ${leaked.length - 15} 支`);
  }
  if (cmp && (cmp.known || []).length) {
    log('\n【已知會浮動（具名清單，附實測理由）】');
    for (const d of cmp.known) log(`  ${basename(d.script)} —— ${NOISY_OUTPUT.get(d.script)}`);
  }
  if (cmp && cmp.soft.length) {
    log('\n【輸出指紋軟差異（列報不擋，但要人看過）】');
    for (const d of cmp.soft.slice(0, 25)) log(`  ${basename(d.script)}  ${d.why}`);
    if (cmp.soft.length > 25) log(`  …還有 ${cmp.soft.length - 25} 支`);
  }
  if (cmp && cmp.diffs.length) {
    log('\n【與基準不一致】⚠ 不自行放寬判準，逐支列出：');
    for (const d of cmp.diffs.slice(0, 40)) log(`  ${basename(d.script)}  ${d.why}`);
    if (cmp.diffs.length > 40) log(`  …還有 ${cmp.diffs.length - 40} 支`);
  }
  log(`\n報表：${OPT.report}`);

  if (shallow.length) {
    log('\n【SHALLOW-SKIP 明細（與基準比對才是判準；無基準時僅列報）】');
    for (const r of shallow.slice(0, 20)) log(`  ${basename(r.script)} × ${r.shallowSkips}`);
  }
  const bad = failed.length + escaped.length + mainDiff.hard.length + missing.length +
              (statusChanged ? 1 : 0) + (cmp ? cmp.diffs.length : 0);
  return bad === 0 ? 0 : 1;
}

// ════════════════════════════════════════════════════════════════════════════
try {
  if (OPT.teardownOnly) {
    for (const L of OPT.drives) { try { substDel(L); } catch {} }
    log('subst 全部釋放：' + OPT.drives.join(', '));
    tornDown = true;
    process.exit(0);
  }
  const code = await main();
  if (OPT.keep) tornDown = true;   // 讓 process.on('exit') 的 teardown 變成 no-op
  else teardown();
  process.exit(code);
} catch (e) {
  teardown();
  console.error('\n✗ runner 失敗：' + (e && e.message || e));
  if (e && e.stack) console.error(e.stack.split('\n').slice(1, 5).join('\n'));
  process.exit(2);
}
