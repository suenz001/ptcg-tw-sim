// v6.294 守衛：新增的兩個運維檔（oracle-admin/health-check.sh ＋ check-health.bat）。
//
// 背景：站長部署完 v6.291／v6.292 的冒名閘之後問「要去哪個 bat 看 pm2 log」——
//   既有 11 支 bat **沒有任何一支在看 log**。他用遠端桌面、複製不出終端輸出，
//   所以比照 dump-perf.bat：ssh 進去跑腳本 → 輸出存成檔案 → 用記事本打開。
//
// 這支守衛守的是「這個工具不會靜默失效、也不會動到線上」：
//   【A】兩個檔存在；.bat 是 CRLF、.sh 是 LF（讀 bytes 驗）；.bat 純 ASCII；
//        .gitattributes 把兩者的行尾釘死（站長的 Windows 是 autocrlf=true）。
//   【B】health-check.sh **零寫入**：沒有重導向到檔案、沒有 rm/mv/sudo/chmod/sed -i、
//        沒有 pm2 的寫入類子命令、沒有 mongo 寫入 API。附正對照（塞進去必須被抓到）。
//   【C】⭐最重要：sh 裡 grep 的字串與 server_admin_patch.js 的 console.warn **逐字一致**
//        （字串漂移＝這支工具永遠回報 0 ＝靜默失效）；SITE_VERSION_HINT 的樣式
//        **拿 repo 的 admin.html 實跑**確認只抓到賦值那一行；讀的是 server.js 不是
//        VM 上根本不存在的 server_admin_patch.js。
//   【D】bat ↔ sh 接線（檔名、輸出目錄、CR 保險）。
//   【E】src/routes/game/+page.svelte 與 oracle-admin/server_admin_patch.js 的 blob sha
//        與 BASE 逐位元相同（本版一個位元都不該動到它們）。
//   【F】進了 package.json 的 test chain（只加進 iron-rules-audit.sh 等於沒加）；版本一致。
//   【G】六個突變，每個都必須紅在**預期那一條**（判準寫成純函式，突變在記憶體裡做，
//        不寫任何檔案，淺複製環境下照樣在守）。
//
// ⚠ 紀律：只捕 assert.AssertionError；不 pin 版本號；不 pin 整檔 sha256。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_SH = join(ROOT, 'oracle-admin/health-check.sh');
const P_BAT = join(ROOT, 'oracle-admin/check-health.bat');
const P_GA = join(ROOT, '.gitattributes');
const P_SAP = join(ROOT, 'oracle-admin/server_admin_patch.js');
const P_ADMIN = join(ROOT, 'oracle-admin/admin.html');
const P_PKG = join(ROOT, 'package.json');
const P_VER = join(ROOT, 'src/lib/version.ts');

let pass = 0, fail = 0;
const T = (n, fn) => {
  try { fn(); console.log('  OK  ', n); pass++; }
  // ⚠ 只捕 AssertionError：打錯字／模組壞掉必須直接炸掉，不可被吞成一行 FAIL
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};

// ══════════════════════════════════════════════════════════════════════════
// 判準寫成純函式 —— 【G】的突變才有東西可以餵（不必寫檔）
// ══════════════════════════════════════════════════════════════════════════

/** 行尾判定：回傳 'LF' / 'CRLF' / 'MIXED' / 'NONE'。 */
export function eolOf(buf) {
  let total = 0, crlf = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue;
    total++;
    if (i > 0 && buf[i - 1] === 0x0d) crlf++;
  }
  if (!total) return 'NONE';
  if (crlf === total) return 'CRLF';
  if (crlf === 0) return 'LF';
  return 'MIXED';
}

/** 只剝「整行註解」。⚠ 行內註解不剝 —— 寧可誤報也不要漏報（誤報只要改註解措辭）。 */
function stripFullLineComments(sh) {
  return sh.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

const WRITE_PATTERNS = [
  [/\brm\b/, 'rm'],
  [/\bmv\b/, 'mv'],
  [/\bcp\b/, 'cp'],
  [/\bmkdir\b/, 'mkdir'],
  [/\btouch\b/, 'touch'],
  [/\btee\b/, 'tee'],
  [/\btruncate\b/, 'truncate'],
  [/\bchmod\b/, 'chmod'],
  [/\bchown\b/, 'chown'],
  [/\bsudo\b/, 'sudo'],
  [/\bln\s+-s/, 'ln -s'],
  [/\bsed\s+-i/, 'sed -i'],
  [/\bpm2\s+(restart|reload|stop|delete|del|kill|flush|start|save|resurrect|scale|update)\b/, 'pm2 寫入類子命令'],
  [/\b(insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|bulkWrite|findOneAndUpdate|findOneAndDelete|findOneAndReplace|createIndex|dropIndex|renameCollection|dropDatabase)\b/, 'mongo 寫入 API'],
  [/\.drop\s*\(/, '.drop('],
  [/\bremove\s*\(/, 'remove('],
  [/\bcurl\s+[^\n]*\s-[oO]\b/, 'curl -o'],
  [/\bwget\b/, 'wget'],
];

/** 掃「會改到東西」的指令。回傳命中的說明陣列（空陣列＝唯讀）。 */
export function writeScan(sh) {
  const s = stripFullLineComments(sh);
  const hits = [];
  for (const [re, label] of WRITE_PATTERNS) if (re.test(s)) hits.push(label);
  return hits;
}

/**
 * 掃「寫進檔案的重導向」。
 * ⚠ 不能用「有沒有 `>`」一刀切 —— 內嵌的 node 程式有 `>=`、shell 有 `2>&1`／`2>/dev/null`。
 *   改成**白名單**：每一個 `>` 都必須落在下列四種形態之一，否則就是可疑重導向。
 *     `=>`（JS 箭頭）／`>=`（比較）／`>&1`・`>&2`（fd 複製）／`>/dev/null`
 *   ⇒ `>> file`、`> file`、`>& file` 全部會被抓到。
 */
export function redirectScan(sh) {
  const s = stripFullLineComments(sh);
  const bad = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '>') continue;
    const prev = i > 0 ? s[i - 1] : '';
    const after = s.slice(i + 1, i + 12);
    if (prev === '=') continue;
    if (after.startsWith('=')) continue;
    if (/^&[12](?![\w/.])/.test(after)) continue;
    if (after.startsWith('/dev/null')) continue;
    bad.push(JSON.stringify(s.slice(Math.max(0, i - 14), i + 16)));
  }
  return bad;
}

/** 從 sh 抽出所有 grep 的 verified-gate 字串（去重前後都要看）。 */
export function grepStringsOf(sh) {
  return [...sh.matchAll(/grep (?:-c )?'(verified-gate[^']*)'/g)].map((m) => m[1]);
}

/** 從 server_admin_patch.js 抽出 verified-gate 的 console.warn 字面量。 */
export function warnLiteralOf(sap) {
  const m = /console\.warn\('([^']*verified-gate[^']*)'/.exec(sap);
  return m ? m[1] : null;
}

/** 從 sh 抽出 SITE_VERSION_HINT 的 grep 樣式（原樣，之後直接當 JS regex 跑）。 */
export function hintPatternOf(sh) {
  const m = /grep -ao "(SITE_VERSION_HINT[^"]*)"/.exec(sh);
  return m ? m[1] : null;
}

/** test chain 有沒有這一支。 */
export function chainHas(pkgTxt, rel) {
  return JSON.parse(pkgTxt).scripts.test.includes('node ' + rel);
}

// ⚠ 新檔用「不存在就當空字串」讀 —— HEAD-FAIL 驗證時要把新檔刪掉重跑，
//   直接 readFileSync 會丟 ENOENT（非 AssertionError）而炸掉整支，看不出是哪一條在守。
const readOr = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const bufOr = (p) => (existsSync(p) ? readFileSync(p) : Buffer.alloc(0));
const SH = readOr(P_SH);
const SH_BUF = bufOr(P_SH);
const BAT_BUF = bufOr(P_BAT);
const SAP = readFileSync(P_SAP, 'utf8');
const ADMIN = readFileSync(P_ADMIN, 'utf8');
const PKG = readFileSync(P_PKG, 'utf8');
// v6.296【E】改寫後要讀對戰頁（不再比 blob sha，改比「零引用」）
const GAME = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

console.log('\n【A】檔案／行尾／編碼');
T('A0 掃描器下限：health-check.sh 抓得到內容且分節齊全（掃描器壞掉時這條先紅）', () => {
  assert.ok(SH.length > 3000, 'health-check.sh 只有 ' + SH.length + ' 字元，讀取被截斷？');
  const sections = [...SH.matchAll(/^echo "----- \[(\d)\]/gm)].map((m) => m[1]);
  assert.deepStrictEqual(sections, ['1', '2', '3', '4', '5', '6'], '分節不完整：' + sections.join(','));
});
T('A1 兩個檔都存在', () => {
  assert.ok(existsSync(P_SH), '缺 oracle-admin/health-check.sh');
  assert.ok(existsSync(P_BAT), '缺 oracle-admin/check-health.bat');
});
T('A2 ⭐ check-health.bat 是 CRLF（IRON_RULES Rule 35：LF 的 .bat 會被 cmd 拆錯行）', () => {
  assert.strictEqual(eolOf(BAT_BUF), 'CRLF', 'check-health.bat 行尾＝' + eolOf(BAT_BUF));
});
T('A3 ⭐ health-check.sh 是 LF（CRLF 的 shell script 在 Ubuntu 上會死在 $\'\\r\'）', () => {
  assert.strictEqual(eolOf(SH_BUF), 'LF', 'health-check.sh 行尾＝' + eolOf(SH_BUF));
});
T('A4 掃描器自驗：eolOf 對三種樣本各自判對（上兩條不是恆真式）', () => {
  assert.strictEqual(eolOf(Buffer.from('a\r\nb\r\n')), 'CRLF');
  assert.strictEqual(eolOf(Buffer.from('a\nb\n')), 'LF');
  assert.strictEqual(eolOf(Buffer.from('a\r\nb\n')), 'MIXED');
});
T('A5 check-health.bat 純 ASCII（cmd 用 CP950 解析 .bat，UTF-8 中文會把行拆爛，連 REM 裡也是）', () => {
  const bad = [];
  for (let i = 0; i < BAT_BUF.length; i++) if (BAT_BUF[i] > 0x7f) bad.push(i);
  assert.strictEqual(bad.length, 0, 'check-health.bat 有 ' + bad.length + ' 個非 ASCII 位元組（第一個在 offset ' + bad[0] + '）');
});
T('A6 ⭐⭐ .gitattributes 把兩個檔的行尾釘死（站長的 Windows 是 core.autocrlf=true：不釘的話 checkout 會把 .sh 變 CRLF，scp 上 VM 就跑不動）', () => {
  assert.ok(existsSync(P_GA), '缺 .gitattributes —— 沒有它，A3 在站長的工作樹上會是假的');
  const ga = readFileSync(P_GA, 'utf8');
  assert.ok(/oracle-admin\/health-check\.sh\s+text\s+eol=lf/.test(ga), '.gitattributes 沒把 health-check.sh 釘成 eol=lf');
  assert.ok(/oracle-admin\/check-health\.bat\s+text\s+eol=crlf/.test(ga), '.gitattributes 沒把 check-health.bat 釘成 eol=crlf');
});

console.log('\n【B】health-check.sh 零寫入');
T('B1 ⭐⭐ 沒有任何會改到東西的指令（rm/mv/cp/mkdir/sudo/chmod/sed -i/pm2 寫入子命令/mongo 寫入 API…）', () => {
  assert.deepStrictEqual(writeScan(SH), [], 'health-check.sh 出現寫入操作：' + writeScan(SH).join(', '));
});
T('B2 ⭐⭐ 沒有「寫進檔案」的重導向（只准 2>&1 / 2>/dev/null / JS 的 => 與 >=）', () => {
  assert.deepStrictEqual(redirectScan(SH), [], '可疑重導向：' + redirectScan(SH).join(' | '));
});
T('B3 ⭐ 正對照：把寫入操作塞進去，B1 的掃描器必須抓到（否則 B1 是安慰劑）', () => {
  assert.deepStrictEqual(writeScan(SH + '\nrm -rf /tmp/x\n'), ['rm']);
  assert.deepStrictEqual(writeScan(SH + '\npm2 restart ptcg-api\n'), ['pm2 寫入類子命令']);
  assert.deepStrictEqual(writeScan(SH + '\nsudo systemctl restart nginx\n'), ['sudo']);
  assert.deepStrictEqual(writeScan(SH + "\ndb.tournamentConfig.updateOne({}, {})\n"), ['mongo 寫入 API']);
  assert.deepStrictEqual(writeScan(SH + '\nsed -i s/a/b/ /etc/hosts\n'), ['sed -i']);
});
T('B4 ⭐ 正對照：把寫檔重導向塞進去，B2 的掃描器必須抓到', () => {
  assert.strictEqual(redirectScan(SH + '\necho hi > /tmp/x\n').length, 1);
  assert.strictEqual(redirectScan(SH + '\necho hi >> /tmp/x\n').length, 2);
  assert.strictEqual(redirectScan('cmd 2>/dev/null; cmd2 2>&1').length, 0, '負對照：合法重導向不該被抓');
  assert.strictEqual(redirectScan('var f = function (a) { return a >= 1; };').length, 0, '負對照：>= 不該被抓');
  assert.strictEqual(redirectScan('const f = (a) => a + 1;').length, 0, '負對照：=> 不該被抓');
});
T('B5 刻意不用 set -e（一節失敗要繼續跑完，否則站長只拿到半份報告）', () => {
  assert.ok(!/^\s*set -e/m.test(SH), 'health-check.sh 不該有 set -e');
});

console.log('\n【C】與線上實況逐字對齊（字串漂移＝這支工具靜默失效）');
T('C1 ⭐⭐⭐ grep 的字串與 server_admin_patch.js 的 console.warn 逐字一致', () => {
  const warn = warnLiteralOf(SAP);
  assert.ok(warn, '在 server_admin_patch.js 找不到 verified-gate 的 console.warn（v6.291/6.292 的閘被改掉了？）');
  const greps = grepStringsOf(SH);
  assert.strictEqual(greps.length, 2, 'health-check.sh 應該有兩處 grep（計數＋列出最近 20 筆），實得 ' + greps.length);
  assert.strictEqual(new Set(greps).size, 1, '兩處 grep 的字串不一致：' + greps.join(' / '));
  assert.ok(warn.includes(greps[0]),
    'grep 字串「' + greps[0] + '」不是 console.warn 字面量「' + warn + '」的子字串 ⇒ 這支工具會永遠回報 0');
});
T('C2 掃描器自驗：warnLiteralOf 對「字串被改過」的樣本會抽出不同值（C1 不是恆真式）', () => {
  assert.strictEqual(warnLiteralOf("console.warn('[t] verified-gate blocked ep=' + ep"), '[t] verified-gate blocked ep=');
  assert.strictEqual(warnLiteralOf("console.warn('[t] verified-gate BLOCKED ep=' + ep"), '[t] verified-gate BLOCKED ep=');
  assert.strictEqual(warnLiteralOf("console.warn('nothing here')"), null);
});
T('C3 ⭐⭐ SITE_VERSION_HINT 的 grep 樣式**拿 repo 的 admin.html 實跑**：只抓到賦值那一行', () => {
  const pat = hintPatternOf(SH);
  assert.ok(pat, 'health-check.sh 抽不到 SITE_VERSION_HINT 的 grep 樣式');
  const hits = ADMIN.match(new RegExp(pat, 'g')) || [];
  assert.strictEqual(hits.length, 1, '這個樣式在 admin.html 抓到 ' + hits.length + ' 處（應該剛好 1 處）：' + hits.join(' | '));
  const V = /VERSION = '([\d.]+)'/.exec(readFileSync(P_VER, 'utf8'))[1];
  assert.ok(hits[0].includes("'" + V + "'"), '抓到的不是版本賦值那一行：' + hits[0]);
});
T('C4 ⭐ 正對照：換成寬鬆樣式（brief 原本的 SITE_VERSION_HINT[^,;]*）會抓到 3 處 ⇒ C3 真的在守', () => {
  const loose = (ADMIN.match(/SITE_VERSION_HINT[^,;]*/g) || []).length;
  assert.ok(loose >= 3, '寬鬆樣式只抓到 ' + loose + ' 處，admin.html 結構變了？C3 的意義要重新檢視');
});
T('C5 ⭐⭐ 讀的是 /opt/ptcg/api/server.js（patch 是被**注入**進去的），不是 VM 上根本不存在的 server_admin_patch.js', () => {
  const code = stripFullLineComments(SH);   // ⚠ 註解裡刻意寫了那個「不存在的路徑」在解釋原因，要先剝掉
  assert.ok(code.includes('/opt/ptcg/api/server.js'), 'health-check.sh 沒讀 /opt/ptcg/api/server.js');
  assert.ok(!code.includes('/opt/ptcg/api/server_admin_patch.js'),
    'VM 上沒有 /opt/ptcg/api/server_admin_patch.js —— oracle_admin_update.sh 是把內容注入 server.js，scp 只丟到 /tmp');
  assert.ok(code.includes('=== ORACLE ADMIN ENDPOINTS ==='), '沒有用注入錨點抓版本');
  assert.ok(SAP.startsWith('// === ORACLE ADMIN ENDPOINTS ==='),
    'server_admin_patch.js 的檔頭錨點變了 ⇒ health-check.sh 的 [1] 會抓不到版本');
});
T('C6 admin.html 的線上路徑與 pm2 app 名與既有部署腳本一致', () => {
  assert.ok(SH.includes('/opt/ptcg/web/admin/index.html'), 'admin.html 的線上路徑不對（update-admin-only.bat 裝在這裡）');
  assert.ok(/pm2 logs ptcg-api /.test(SH), 'pm2 app 名不是 ptcg-api');
});
T('C7 ⭐ pm2 log 只抓一次並印出行數（0 行時「攔截 0 次」不可以看起來像沒事）', () => {
  assert.strictEqual((SH.match(/pm2 logs ptcg-api/g) || []).length, 2, 'pm2 logs 應該只有主呼叫＋no-color 失敗時的退路兩處');
  assert.ok(/PM2_LOG_LINES/.test(SH) && /取到 \$PM2_LOG_LINES 行/.test(SH), '沒有把取到幾行 log 印出來 ⇒ 抓不到 log 時會靜默變成「0 次攔截」');
});

console.log('\n【D】bat ↔ sh 接線');
const BAT = BAT_BUF.toString('ascii');
T('D1 bat 上傳的檔名與實際檔名一致', () => {
  assert.ok(/scp -i "%KEY%" health-check\.sh %HOST%:\/tmp\/ptcg-health-check\.sh/.test(BAT), 'scp 那一行對不上');
  assert.ok(/bash \/tmp\/ptcg-health-check\.sh/.test(BAT), 'ssh 執行的路徑對不上 scp 的目的地');
});
T('D2 輸出寫進 ..\\tournament-dumps（與 dump-perf.bat 同一個資料夾）且會自己建目錄', () => {
  assert.ok(BAT.includes('set "OUTDIR=..\\tournament-dumps"'), '輸出目錄不是 ..\\tournament-dumps');
  assert.ok(BAT.includes('if not exist "%OUTDIR%" mkdir "%OUTDIR%"'), '沒有先建目錄（目錄不在時 ssh 的重導向會直接失敗）');
});
T('D3 金鑰 fallback 與 dump-perf.bat 同一套（D:\\ai 優先，退回同目錄）', () => {
  assert.ok(BAT.includes('set "KEY=D:\\ai\\ssh-key-2026-02-11.key"'), '主金鑰路徑不對');
  assert.ok(BAT.includes('if not exist "%KEY%" set "KEY=ssh-key-2026-02-11.key"'), '缺少退回同目錄的 fallback');
  assert.ok(BAT.includes('cd /d "%~dp0"'), '缺 cd /d "%~dp0"（相對路徑會跟著使用者的工作目錄跑掉）');
});
T('D4 ⭐ ssh 端先剝 CR 再跑（雙保險：萬一 .gitattributes 沒生效也不會炸在看不懂的錯誤上）', () => {
  assert.ok(BAT.includes("sed -i 's/\\r$//' /tmp/ptcg-health-check.sh"), 'bat 沒有先剝 CR');
});

console.log('\n【E】這個工具是「純新增」：沒有把手伸進線上那兩個檔');
// ⚠⚠⚠ v6.296 改寫：原本這一節是「兩個檔的 blob sha 必須等於 BASE(v6.293)」——
//   **那是一個會過期的 pin**。v6.295 正當地改了 server_admin_patch.js（好友備註名），
//   這條在有完整歷史的機器上從那一刻起就一直紅，只是 CI 淺複製會 SHALLOW-SKIP 所以看不出來
//   （＝守衛安慰劑：第九種「pin 死版本／sha」）。v6.296 又正當地改了 game/+page.svelte（大廳分頁）。
// ⭐ 改成**不綁版本**的等價條件：這支健康檢查工具的守護意圖是「它只是新增的運維腳本，
//   不會把任何鉤子塞進線上的對戰頁或伺服器補丁」⇒ 直接斷言那兩個檔**零引用**這支工具的任何識別字，
//   而且工具本身不得反過來要求對方配合。這條在淺複製環境下照樣在守，而且永遠不會過期。
const TOOL_TOKENS = ['health-check.sh', 'check-health.bat', 'ptcg-health-check', 'ptcg-health-'];
T('E1 ⭐⭐⭐ 線上那兩個檔（對戰頁／伺服器補丁）零引用這支運維工具的任何識別字（不綁版本、淺複製也在守）', () => {
  for (const [rel, src] of [['src/routes/game/+page.svelte', GAME], ['oracle-admin/server_admin_patch.js', SAP]]) {
    assert.ok(src.length > 10000, '掃描器下限：' + rel + ' 只讀到 ' + src.length + ' 字元');
    for (const tk of TOOL_TOKENS) {
      assert.strictEqual(src.split(tk).length - 1, 0, rel + ' 出現了運維工具的識別字「' + tk + '」⇒ 這支工具不再是「純新增」');
    }
  }
});
T('E1b 掃描器正對照：把識別字塞進去 ⇒ E1 必紅（不是恆真式）', () => {
  const bad = GAME.slice(0, 200) + '\n// health-check.sh\n' + GAME.slice(200);
  let err = null;
  try {
    for (const tk of TOOL_TOKENS) assert.strictEqual(bad.split(tk).length - 1, 0, '出現了運維工具的識別字「' + tk + '」');
  } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err && /識別字/.test(err.message), '掃描器抓不到塞進去的識別字');
});
console.log('\n【F】test chain ／版本一致');
T('F1 ⭐⭐ 本守衛進了 package.json 的 test chain（只加進 iron-rules-audit.sh 等於沒加）', () => {
  assert.ok(chainHas(PKG, 'scripts/test-v6294-health-check.mjs'), 'test chain 沒有 test-v6294-health-check.mjs');
});
T('F2 掃描器自驗：chainHas 對「被拿掉」的 package.json 會回 false', () => {
  const removed = PKG.replace(' && node scripts/test-v6294-health-check.mjs', '');
  assert.strictEqual(chainHas(removed, 'scripts/test-v6294-health-check.mjs'), false);
});
T('F3 版本一致：version.ts 的 VERSION = admin.html 的 SITE_VERSION_HINT（不 pin 版本號）', () => {
  const V = /VERSION = '([\d.]+)'/.exec(readFileSync(P_VER, 'utf8'))[1];
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(ADMIN)[1];
  assert.strictEqual(H, V, 'SITE_VERSION_HINT ' + H + ' ≠ version.ts ' + V);
});

console.log('\n【G】突變（每一個都必須紅在預期那一條）');
const MUT = [
  ['① .sh 改成 CRLF 行尾 ⇒ A3', () => assert.strictEqual(eolOf(Buffer.from(SH.replace(/\n/g, '\r\n'))), 'LF')],
  ['② .bat 改成 LF 行尾 ⇒ A2', () => assert.strictEqual(eolOf(Buffer.from(BAT.replace(/\r\n/g, '\n'))), 'CRLF')],
  ['③ .bat 混進中文 ⇒ A5', () => { const b = Buffer.from(BAT + 'REM 中文\r\n', 'utf8'); let n = 0; for (const x of b) if (x > 0x7f) n++; assert.strictEqual(n, 0); }],
  ['④ grep 字串漂移（verified-gate → verified gate）⇒ C1',
    () => { const s = SH.replace(/verified-gate blocked/g, 'verified gate blocked'); assert.ok(warnLiteralOf(SAP).includes(grepStringsOf(s)[0])); }],
  ['⑤ .sh 塞寫入操作（pm2 restart）⇒ B1', () => assert.deepStrictEqual(writeScan(SH + '\npm2 restart ptcg-api\n'), [])],
  ['⑥ .sh 塞寫檔重導向 ⇒ B2', () => assert.deepStrictEqual(redirectScan(SH + '\npm2 logs ptcg-api > /opt/ptcg/web/x.txt\n'), [])],
  ['⑦ 從 test chain 拿掉本守衛 ⇒ F1',
    () => assert.ok(chainHas(PKG.replace(' && node scripts/test-v6294-health-check.mjs', ''), 'scripts/test-v6294-health-check.mjs'))],
  ['⑧ SITE_VERSION_HINT 改回寬鬆樣式 ⇒ C3',
    () => { const hits = ADMIN.match(/SITE_VERSION_HINT[^,;]*/g) || []; assert.strictEqual(hits.length, 1); }],
];
for (const [name, fn] of MUT) {
  let red = false;
  try { fn(); } catch (e) { if (e instanceof assert.AssertionError) red = true; else throw e; }
  if (red) { console.log('  OK   突變', name, '→ 有紅'); pass++; }
  else { console.log('  FAIL 突變', name, '→ 沒紅（守衛是安慰劑）'); fail++; }
}

console.log('\n══ v6.294 VM 健康檢查工具守衛：' + pass + ' PASS / ' + fail + ' FAIL ══');
if (fail) process.exit(1);
