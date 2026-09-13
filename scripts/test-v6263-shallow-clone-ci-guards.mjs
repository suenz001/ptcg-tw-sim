// v6.263 守衛：CI 的**淺複製盲點** —— 「讀歷史 commit」的守衛在 fetch-depth:1 下不能靜默掏空
//
// 背景（本版調查，實測而非推論）：
//   `.github/workflows/deploy.yml` 的 build job 用 `actions/checkout@v4` **沒有 `with:`**
//   ⇒ 走 action 預設 `fetch-depth: 1`（淺複製）。`iron-rules-audit.yml` 雖然 fetch-depth:2，
//   但它 `continue-on-error: true`，從來不擋 deploy ⇒ **真正的保護只有 build job 的 npm test**。
//   在**真淺複製**（git fetch --depth=1）下實跑，13 支會 shell out 到 git 的腳本裡：
//     - 6 支印 SKIP 後整節不跑（條數變少，還看得出來）
//     - 2 支（v6.224:198 / v6.230:264）`catch { console.log(); return; }`
//       ⇒ **條數不變、無 SKIP 字樣、整體綠燈** —— 那條斷言在 CI 上從來沒有在守。
//
// 這支守衛守三件事：
//   ① 掃描器：npm test chain 裡「讀歷史 commit」的腳本必須全部走中央 helper
//      `scripts/lib/base-blob.mjs`（單一入口才有辦法列管）。
//   ② 靜態：不得再出現「catch 只印字然後 return」的靜默掏空。
//   ③ ⭐ 行為端（重點）：把 `git` 換成必定失敗的 shim（＝模擬「拿不到任何歷史」），
//      v6.224 / v6.230 的**通過條數必須與真環境完全相同**，而且把被守的東西改壞時
//      **在同一個 shim 下也要紅**。沒有 ③，①② 只是靜態字串比對，擋不住「接線沒接上」。
//
// ⚠ 為什麼不直接改 `fetch-depth: 0`：改下去會讓目前被藏起來的紅燈立刻擋住 deploy。
//   本版先把守衛修對（完整 clone 下全綠），`fetch-depth: 0` 留到下一版。
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let n = 0, bad = 0;
const chk = (label, cond, extra = '') => {
  n++; console.log((cond ? '  PASS ' : '  FAIL ') + label + (cond ? '' : (extra ? '  ⟵ ' + extra : '')));
  if (!cond) bad++;
};

const TMPS = [];
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });
const mkdt = (tag) => { const d = mkdtempSync(join(tmpdir(), 'v6263-' + tag + '-')); TMPS.push(d); return d; };

// ── 剝註解（Rule 25.4）──────────────────────────────────────────────────────
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ══════════════════════════════════════════════════════════════════════════
console.log('① 掃描器：npm test chain 裡有哪些腳本會去讀 git 歷史');
const CHAIN = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test
  .split('&&').map((s) => s.trim()).filter(Boolean)
  .map((s) => s.replace(/^node\s+/, ''));
chk(`test chain 解析到 ${CHAIN.length} 支腳本（下限 400）`, CHAIN.length >= 400, String(CHAIN.length));

/** 判斷一份原始碼有沒有「shell out 到 git」。回傳命中的片段（給正對照用）。 */
function gitCallsIn(src) {
  const s = strip(src);
  return [...s.matchAll(/(?:execFileSync|execSync|spawnSync|exec)\s*\(\s*['"]git['"]/g)].map((m) => m[0]);
}
/** 有沒有寫死 40 位 sha（＝讀的是**歷史**，不是 HEAD）。 */
const hasHistSha = (src) => /['"][0-9a-f]{40}['"]/.test(strip(src));

const files = new Map();
for (const rel of CHAIN) {
  try { files.set(rel, readFileSync(join(ROOT, rel), 'utf8')); } catch { /* 下面會斷言 */ }
}
const CHAIN_UNIQ = [...new Set(CHAIN)];
chk('chain 裡每一支腳本都讀得到', files.size === CHAIN_UNIQ.length, `${files.size}/${CHAIN_UNIQ.length}`);

const HELPER = 'lib/base-blob.mjs';
// ⭐⭐v6.371（丁-1）：舊判準是 `src.includes('lib/base-blob.mjs')` —— 在**含註解**的原始碼上找字面
//   ⇒ 只要在註解裡寫一句那個路徑，就可以一邊自己 shell out 到 git、一邊被算成「走了中央 helper」。
//   實測（v6.370 的 mutcheck M5）：把 test-v6365 突變回「自己 shell out 到 git」，②**竟然沒紅**
//   （它的檔頭註解剛好有那句話）。v6.370 只在新守衛補了更硬的 B4，② 本身沒動。
//   ⇒ 本版把 ② 收斂成**同一個** import 語句偵測器（Rule 38：判準只准有一份）。
//   ⚠ 不依賴 naive 剝註解（`/* */` 的貪吃問題）—— 直接要求**行首的 import … from '…base-blob.mjs'**。
const HELPER_IMPORT_RE = /^[ \t]*import\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*from\s*'[^']*lib\/base-blob\.mjs'\s*;?/m;
const importsHelper = (src) => HELPER_IMPORT_RE.test(String(src));
// 「會去讀歷史」＝ 自己 shell out 到 git（且寫死 40 位 sha），或 import 了中央 helper。
const rawGitUsers = [...files].filter(([, src]) => gitCallsIn(src).length > 0).map(([rel]) => rel);
const rawHistUsers = rawGitUsers.filter((rel) => hasHistSha(files.get(rel)));
const helperUsers = [...files].filter(([, src]) => importsHelper(src)).map(([rel]) => rel);
// ⚠ 排除**本檔自己**：它是掃描器，內含「靜默掏空」與「git 呼叫」的合成樣本字串
//   （③ 的正對照），被自己掃到會誤報。本檔的正確性由 ③ 的正／負對照與 ④⑤ 的行為端保證。
const SELF = 'scripts/test-v6263-shallow-clone-ci-guards.mjs';
const histUsers = [...new Set([...rawHistUsers, ...helperUsers])].filter((r) => r !== SELF).sort();
console.log('  自己呼叫 git 的：' + rawGitUsers.length + ' 支（其中寫死歷史 sha：' + rawHistUsers.length + '）');
console.log('  走中央 helper 的：' + helperUsers.length + ' 支；合計列管 ' + histUsers.length + ' 支');
for (const r of histUsers) console.log('    - ' + r);
// ⚠ 下限斷言（Rule 25.1）：掃描器壞掉時最典型的症狀就是「一個都沒掃到 ⇒ 全綠」
chk('★ 掃描器有掃到東西（自己呼叫 git 的腳本 >= 1）', rawGitUsers.length >= 1, String(rawGitUsers.length));
chk('★ 掃描器有掃到東西（列管的「讀歷史」腳本 >= 9）', histUsers.length >= 9, String(histUsers.length));
// 正對照：掃描器對「明明有」的樣本要抓得到，對「明明沒有」的樣本不得誤報
chk('★ 掃描器正對照：合成樣本（有 git 呼叫）抓得到',
    gitCallsIn(`const r = execFileSync('git', ['-C', ROOT, 'cat-file', '-p', X]);`).length === 1);
chk('★ 掃描器負對照：註解裡的 git 呼叫不算',
    gitCallsIn(`// execFileSync('git', ['cat-file'])\nconst a = 1;`).length === 0);
chk('★ 掃描器負對照：沒有 git 的樣本不誤報',
    gitCallsIn(`readFileSync('x'); const sha = 'aaaa';`).length === 0);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n② 讀歷史的腳本一律走中央 helper scripts/lib/base-blob.mjs');
// 白名單：讀的是 HEAD（淺複製一樣拿得到）⇒ 不受此規範
// ⚠ 白名單：這幾支**不是**沒處理，而是用了更好的作法（不需要歷史的等價對照），
//   所以不強迫它們改走 helper。但白名單不可以是空頭支票 ——
//   ⭐ 下面 ④ 會把每一支都放進「無 git 環境」實跑，證明條數真的沒有變少。
const ALLOW = new Map([
  ['scripts/test-bat-crlf.mjs', '讀的是 ls-tree HEAD（淺複製一樣拿得到），不是歷史'],
  ['scripts/test-v6245-oracle-api-timeout.mjs', '拿不到 BASE 時改用 mutateRemoveTimeout 的等價突變版'],
  ['scripts/test-v6246-oracle-timeout-followups.mjs', '同上，內嵌等價突變版當 BASE 對照'],
  ['scripts/test-v6261-casual-clientdiag.mjs', '拿不到 BASE 時改驗內嵌 sha256，且自己斷言 checked >= 1'],
]);
const offenders = rawHistUsers.filter((rel) => rel !== SELF && !ALLOW.has(rel) && !importsHelper(files.get(rel)));
chk('★★ 每一支「自己呼叫 git 且寫死歷史 sha」的腳本，不是走中央 helper 就是在白名單裡',
    offenders.length === 0, JSON.stringify(offenders));
// ⭐v6.371（丁-1）偵測器自驗（Rule 25：掃描器本身要先被驗證；沒有這三條，改判準只是換一種安慰劑）
chk('★ 偵測器正對照：真的 import 語句判為有',
    importsHelper("import { hasBaseCommit } from './lib/base-blob.mjs';\n") === true);
chk('★ 偵測器負對照①：只有註解提到路徑 ⇒ 判為沒有',
    importsHelper("//   走中央 helper `scripts/lib/base-blob.mjs`\nconst x = 1;\n") === false);
chk('★ 偵測器負對照②：字串字面提到路徑 ⇒ 判為沒有',
    importsHelper("const HELPER = 'lib/base-blob.mjs';\n") === false);
chk('★ 中央 helper 檔案存在且有 shallowSkip 匯出',
    /export function shallowSkip\(/.test(readFileSync(join(ROOT, 'scripts/lib/base-blob.mjs'), 'utf8')));

// ══════════════════════════════════════════════════════════════════════════
console.log('\n③ 不得再出現「靜默掏空」：catch 區塊只印字就 return / continue');
/**
 * 找出 `catch (...) { … }` 區塊裡「只有 console.log + return/continue，沒有任何斷言、
 * 沒有 shallowSkip、沒有把旗標設成 null 讓後面走 SKIP 分支」的寫法。
 * ⚠ 用括號配對抓 body，不用「往後找第一個 }」（Rule 25.3）。
 */
function silentHollow(src) {
  const s = strip(src);
  const hits = [];
  for (const m of s.matchAll(/catch\s*(?:\([^)]*\))?\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < s.length && depth > 0) { const c = s[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
    const body = s.slice(m.index + m[0].length, i - 1);
    if (!/console\.(log|warn|error)/.test(body)) continue;         // 沒印字的不在此列
    if (!/\breturn\b|\bcontinue\b/.test(body)) continue;            // 沒有提早離開的不在此列
    if (/shallowSkip/.test(body)) continue;                         // 走中央 helper ⇒ 已大聲宣告
    hits.push(body.trim().replace(/\s+/g, ' ').slice(0, 90));
  }
  return hits;
}
const hollow = [];
for (const rel of histUsers) for (const h of silentHollow(files.get(rel))) hollow.push(rel + ' :: ' + h);
chk('★★★ 讀歷史的腳本裡沒有「catch 只印字就 return」的靜默掏空', hollow.length === 0, JSON.stringify(hollow));
// 正對照：偵測器對真的壞樣本要抓得到（否則 ③ 是恆真安慰劑）
chk('★ 偵測器正對照：合成的靜默掏空樣本抓得到',
    silentHollow(`try { x(); } catch { console.log('拿不到 BASE blob，跳過'); return; }`).length === 1);
chk('★ 偵測器負對照：改用 shallowSkip 的樣本不算違規',
    silentHollow(`try { x(); } catch { shallowSkip('A'); console.log('x'); return; }`).length === 0);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n④ ⭐⭐ 行為端：把 git 換成「必定失敗」的 shim（＝拿不到任何歷史）');
// ⚠ 這不是「假裝拿不到 blob」的紙上模擬 —— 子行程真的執行、真的呼叫 git、真的失敗，
//   跟 fetch-depth:1 的淺複製對這幾支腳本而言是同一件事（實測過：兩者輸出逐字相同）。
const shim = mkdt('shim');
// ⚠ Windows 的 PATH 分隔符是 ';'，寫死 ':' 會讓 shim 完全沒套上（自驗恆假）。
const PATHSEP = process.platform === 'win32' ? ';' : ':';
writeFileSync(join(shim, 'git'), '#!/bin/sh\nexit 1\n');
chmodSync(join(shim, 'git'), 0o755);

function runGuard(rel, { noGit = false, env = {} } = {}) {
  const e = { ...process.env, ...env };
  if (noGit) e.PATH = shim + PATHSEP + (process.env.PATH || '');
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [join(ROOT, rel)],
      { cwd: ROOT, env: e, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { code = err.status ?? 1; out = String(err.stdout ?? '') + String(err.stderr ?? ''); }
  // 各支守衛的結尾格式不一（`11 pass / 0 fail`、`30 PASS / 0 FAIL`…）⇒ 取最後一個匹配
  const all = [...out.matchAll(/(\d+)\s*(?:pass|PASS)\s*\/\s*(\d+)\s*(?:fail|FAIL)/g)];
  const m = all.length ? all[all.length - 1] : null;
  return { code, pass: m ? Number(m[1]) : -1, fail: m ? Number(m[2]) : -1, out };
}

// ⭐⭐⭐v6.370：④⑤ 這個 PATH shim 在 **Windows 上結構性無效**。
//   Node 的 `execFileSync` 走 CreateProcess，只認 `.exe`/`.com`；shim 寫出來的是無副檔名的
//   `git`（`#!/bin/sh`），Windows 不會執行它，`.cmd`/`.bat` 也要 shell 才跑得起來。
//   ⇒ 在 Windows 上「套上 shim」根本沒發生：子行程拿到的仍然是真的 git
//   ⇒ ④ 的 `nogit` 與 `real` 必然逐字相同、⑤ 的突變也還是看得到歷史
//   ⇒ **這兩段在 Windows 上是恆真安慰劑**，而 shim 自驗那一條則是永久假紅。
//   真正在守這件事的是 **CI（ubuntu-latest）**。
//   ⇒ 依 Rule 40 把判準上移：POSIX 照跑；Windows **大聲宣告「這一段沒有在守」**，
//   並由下面兩條正對照釘住「只有 Windows 准跳過」與「跳過的理由是實測成立的」。
const WIN = process.platform === 'win32';
let ranBehaviour = false;
if (WIN) {
  console.log('  ⚠⚠ PLATFORM-SKIP ④：Windows 的 execFileSync 套不上無副檔名的 PATH shim');
  console.log('  ⚠⚠ ⇒ 這一段在本機【沒有在守】；守門人是 CI（.github/workflows/deploy.yml，ubuntu）。');
  console.log('  ⚠⚠ （⑤ 不受影響：它靠 V6224_SAP／V6230_SAP 環境變數做突變，與 PATH shim 無關 ⇒ 兩個平台都照跑。）');
} else {
// shim 自身先驗（Rule 25：掃描器/工具本身要先被驗證）
{
  let shimWorks = false;
  try {
    execFileSync('git', ['--version'],
      { env: { ...process.env, PATH: shim + PATHSEP + (process.env.PATH || '') }, stdio: 'ignore' });
  } catch { shimWorks = true; }
  chk('★ shim 自身有效：套上 PATH 之後 git 真的會失敗', shimWorks);
}

// ⭐ v6.224/v6.230 是本版修好的兩支（原本靜默掏空）；
//   v6.245/v6.246/v6.261 是**做對的參照組**（白名單成員）—— 一起實跑，白名單才不是空頭支票。
const BEHAVIOR_LIST = [
  'scripts/test-v6224-deck-import-timeout.mjs',
  'scripts/test-v6230-deck-export-timeout.mjs',
  'scripts/test-v6245-oracle-api-timeout.mjs',
  'scripts/test-v6246-oracle-timeout-followups.mjs',
  'scripts/test-v6261-casual-clientdiag.mjs',
];
chk('★ 白名單裡「用等價對照」的每一支都在 ④ 被實跑驗證（白名單不得膨脹）',
    [...ALLOW.keys()].filter((k) => k !== 'scripts/test-bat-crlf.mjs').every((k) => BEHAVIOR_LIST.includes(k)),
    JSON.stringify([...ALLOW.keys()]));
for (const rel of BEHAVIOR_LIST) {
  const real = runGuard(rel);
  const nogit = runGuard(rel, { noGit: true });
  chk(`${rel.replace('scripts/', '')}：真環境 ${real.pass} pass / ${real.fail} fail（exit ${real.code}）`,
      real.code === 0 && real.pass > 0 && real.fail === 0, real.out.slice(-400));
  chk(`  └ ⭐⭐ 拿不到任何歷史時**條數完全相同**（${nogit.pass} pass / ${nogit.fail} fail，exit ${nogit.code}）`,
      nogit.code === 0 && nogit.pass === real.pass && nogit.fail === 0,
      `real=${real.pass}/${real.fail} nogit=${nogit.pass}/${nogit.fail}`);
}

  ranBehaviour = true;
}
// ⭐v6.370 正對照①：CI 跑的是 ubuntu ⇒ ④ 在 CI 永遠會真的執行（跳過只可能發生在 Windows 本機）。
chk('★★ ④ 行為端在 POSIX 一定要真的執行過（只有 Windows 准跳過）', WIN || ranBehaviour);
// ⭐v6.370 正對照②：跳過的**理由**必須實測成立 —— 在 Windows 上，套了 shim 之後 git 仍然跑得起來。
//   哪天 Node/Windows 改成吃得到這種 shim，這一條就會翻紅，強迫回來把 ④⑤ 打開。
chk('★ Windows 跳過的理由實測成立：套上 shim 之後 git 仍然執行得起來（＝shim 沒套上）',
    !WIN || (() => {
      try {
        execFileSync('git', ['--version'],
          { env: { ...process.env, PATH: shim + PATHSEP + (process.env.PATH || '') }, stdio: 'ignore' });
        return true;
      } catch { return false; }
    })());

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ ⭐⭐ 突變測試：把「被守的東西」改壞必須紅（**兩個平台都跑**）');
// ⚠ 我們已連續踩過七次守衛安慰劑 —— ④ 只證明「條數沒少」，不證明「那些條真的在測東西」。
//   這一段把 server_admin_patch.js 的回應訊息改掉（只有 BASE 行為快照那一條會看）再重跑，必須紅。
// ⭐⭐v6.371（丁-2）：v6.370 把 ⑤ 一起關進 Windows 的 PLATFORM-SKIP，但那是**範圍過寬**——
//   ⑤ 的突變靠 V6224_SAP／V6230_SAP 兩個**環境變數**注入，與 PATH shim 完全無關；
//   `noGit:true` 在 Windows 只是沒有效果，不影響突變本身。實測：Windows 上 ⑤ 會跑、而且會過。
//   ⇒ 收斂成「只跳 ④ 與 shim 自驗，⑤ 保留」，標籤也從「在**淺複製環境下**也會紅」
//     改成平台中立的說法（在 Windows 上「淺複製」那個前提是假的，寫在標籤裡會誤導）。
let ranMutation = 0;
const SAP = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const MUTS = [
  ['scripts/test-v6224-deck-import-timeout.mjs', 'V6224_SAP', '官網回應異常 (HTTP ', '官網回應異常了啦 (HTTP '],
  ['scripts/test-v6230-deck-export-timeout.mjs', 'V6230_SAP', '官網 token 抽取失敗（HTML 結構變動？）', '拿不到 token'],
];
for (const [rel, envKey, from, to] of MUTS) {
  chk(`  突變錨點唯一：${from.slice(0, 14)}…`, SAP.split(from).length === 2);
  const d = mkdt('mut');
  const p = join(d, 'server_admin_patch.js');
  writeFileSync(p, SAP.replace(from, to));
  // noGit 在 POSIX 會真的斷掉 git（＝順便驗「淺複製下也會紅」）；在 Windows 套不上，
  //   但突變本身照樣生效 ⇒ 兩個平台都必須紅。
  const r = runGuard(rel, { noGit: true, env: { [envKey]: p } });
  chk(`  ⭐⭐ ${rel.replace('scripts/', '')}：改壞回應訊息後**必須紅**（exit ${r.code}, ${r.fail} fail）`,
      r.code !== 0 && r.fail >= 1, r.out.slice(-400));
  ranMutation++;
}
chk('★★ ⑤ 突變測試在**所有平台**都必須真的跑完（Windows 也不准跳）', ranMutation === MUTS.length, `${ranMutation}/${MUTS.length}`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ CI 設定：checkout 的 fetch-depth 現況必須與本檔宣告一致');
// ⚠ 這一條不是「規定只能淺複製」—— 是**把現況釘住**，讓改 fetch-depth 變成刻意的動作
//   （改了就要回來改這裡，順便被迫確認 8 支守衛在完整 clone 下是綠的）。
{
  const dep = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
  const aud = readFileSync(join(ROOT, '.github/workflows/iron-rules-audit.yml'), 'utf8');
  const buildJob = dep.slice(dep.indexOf('\n  build:'), dep.indexOf('\n  deploy:'));
  chk('抓得到 deploy.yml 的 build job', buildJob.length > 200, String(buildJob.length));
  const co = buildJob.match(/uses:\s*actions\/checkout@v\d+([\s\S]{0,120})/);
  chk('build job 有 actions/checkout', !!co);
  const declaredDepth = /fetch-depth:\s*(\d+)/.exec(co ? co[1] : '');
  chk('⚠ 現況（v6.263 宣告）：build job 沒有指定 fetch-depth ⇒ 預設 1（淺複製）',
      !declaredDepth, declaredDepth ? declaredDepth[0] : '');
  chk('⚠ 現況（v6.263 宣告）：iron-rules-audit 是 continue-on-error ⇒ 不擋 deploy',
      /continue-on-error:\s*true/.test(aud));
  chk('  └ 正對照：deploy.yml 真的有跑完整 npm test（唯一真正的保護）', /run:\s*npm test/.test(dep));
}

console.log(`\n[v6263-shallow-clone-ci-guards] PASS ${n - bad} / FAIL ${bad}`);
process.exit(bad ? 1 : 0);
