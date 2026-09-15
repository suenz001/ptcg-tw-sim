// ═══════════════════════════════════════════════════════════════════════════
// v6.387 守衛：部署驗收工具（verify-deploy）
//
// 站長 2026-09-15 交辦。背景（IRON_RULES Rule 43）：
//   部署說明把 update-admin-full.bat 誤當成「前端」，v6.384／v6.385／v6.386
//   三版的玩家端前端一版都沒上線，正式站的首頁更新紀錄第一則卡在 v6.382 三天，
//   而 bat 從頭到尾沒有報過錯。⇒ 唯一可靠的驗收是實測正式站。
//
// ⚠ 本守衛**不連外網**（CI 沒有外網保證，而且會 flaky）：
//   只測 scripts/lib/verify-deploy-core.mjs 的純判準 ＋ 兩個檔案的硬規範。
//   對外抓取那一段由站長手動跑 oracle-admin/verify-deploy.bat 時驗證。
//
// 分層：
//   【A】解析函式（真實樣本 ＋ 反對照）
//   【B】evaluate 判準（含 fail-closed，與 2026-09-15 事故的重現）
//   【C】不得矯枉過正
//   【D】收斂（Rule 38：判準只有一份）＋ 掃描器正/負對照
//   【E】.bat 的硬規範（純 ASCII ＋ CRLF）＋ 反對照
//   【F】鐵律錨（Rule 43 逐字）
//   【G】在 npm test chain 裡
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verFromVersionTs, firstChangelogVer, adminHint, evaluate, batsToRun,
} from './lib/verify-deploy-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const chk = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); return true; }
  fail++; console.log(`  FAIL ${name}${extra ? '  — ' + extra : ''}`);
  return false;
};

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】解析函式：真實樣本解得出來，垃圾輸入要回 null');
// ═══════════════════════════════════════════════════════════════════════════
const realVersionTs = read('src/lib/version.ts');
const realChangelog = read('static/changelog.html');
const realAdmin = read('oracle-admin/admin.html');

const aVer = verFromVersionTs(realVersionTs);
const aFirst = firstChangelogVer(realChangelog);
const aHint = adminHint(realAdmin);

chk('A1 解得出本機 version.ts 的版本號', /^\d+\.\d+$/.test(String(aVer)), `拿到 ${aVer}`);
chk('A2 解得出首頁更新紀錄第一則的版本徽章', /^v\d+\.\d+$/.test(String(aFirst)), `拿到 ${aFirst}`);
chk('A3 解得出 admin 的版本提示', /^\d+\.\d+$/.test(String(aHint)), `拿到 ${aHint}`);
chk('A4 ⭐ 這三個值彼此對得上（本機自身一致）',
  aVer !== null && aHint !== null && aFirst !== null && aVer === aHint && `v${aVer}` === aFirst,
  `ver=${aVer} hint=${aHint} first=${aFirst}`);

for (const [fn, label] of [[verFromVersionTs, 'verFromVersionTs'], [firstChangelogVer, 'firstChangelogVer'], [adminHint, 'adminHint']]) {
  chk(`A5 ★ 反對照：${label} 餵垃圾要回 null（不可以回假值）`,
    fn('') === null && fn('隨便一段沒有版本號的文字') === null && fn(null) === null && fn(undefined) === null);
}

// 第一則 vs 第二則：一定要拿第一個
const twoEntries = realChangelog;
const allBadges = [...twoEntries.matchAll(/<span class="ver-badge">(v[0-9][0-9.]*)<\/span>/g)].map((m) => m[1]);
chk('A6 ⭐ 首頁有多則時，取的是**第一則**（不是最後一則、不是任意一則）',
  allBadges.length >= 2 && aFirst === allBadges[0] && aFirst !== allBadges[allBadges.length - 1],
  `共 ${allBadges.length} 則，第一則=${allBadges[0]}，最後一則=${allBadges[allBadges.length - 1]}`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】evaluate 判準：行為層（含 fail-closed）');
// ═══════════════════════════════════════════════════════════════════════════
const ALL_OK = {
  localVer: '6.400', ghVer: '6.400',
  localFirst: 'v6.400', testFirst: 'v6.400', prodFirst: 'v6.400',
  prodHint: '6.400',
};
const by = (rows, no) => rows.find((r) => r.no === no);

{
  const rows = evaluate(ALL_OK);
  chk('B1 全部對得上 ⇒ 四條線都綠', rows.length === 4 && rows.every((r) => r.ok));
  chk('B1b 全綠時不需要跑任何 bat', batsToRun(rows).length === 0);
}

{
  // ⭐⭐⭐ 2026-09-15 事故的重現：測試站已是 v6.386，正式站前端還停在 v6.382
  const rows = evaluate({ ...ALL_OK, prodFirst: 'v6.382' });
  chk('B2 ⭐⭐⭐ 事故重現：正式站前端落後 ⇒ ③紅', by(rows, '③').ok === false);
  chk('B2b ⭐ 其餘三條不受影響（不得連坐）',
    by(rows, '①').ok && by(rows, '②').ok && by(rows, '④').ok);
  chk('B2c ⭐⭐⭐ 要跑的是 redeploy-oracle.bat（不是 update-admin-full.bat）',
    JSON.stringify(batsToRun(rows)) === JSON.stringify(['redeploy-oracle.bat']));
}

{
  const rows = evaluate({ ...ALL_OK, prodHint: '6.383' });
  chk('B3 admin／伺服器線落後 ⇒ ④紅', by(rows, '④').ok === false);
  chk('B3b 要跑的是 update-tournament.bat',
    JSON.stringify(batsToRun(rows)) === JSON.stringify(['update-tournament.bat']));
}

{
  const rows = evaluate({ ...ALL_OK, ghVer: '6.399' });
  chk('B4 忘了 push ⇒ ①紅，而且①不綁任何 bat',
    by(rows, '①').ok === false && batsToRun(rows).length === 0);
}
{
  const rows = evaluate({ ...ALL_OK, testFirst: 'v6.399', prodFirst: 'v6.399' });
  chk('B5 測試站落後 ⇒ ②紅（③因為測試站＝正式站所以仍綠，這是對的）',
    by(rows, '②').ok === false && by(rows, '③').ok === true);
}

// ⭐⭐ fail-closed：抓不到一律算不通過
{
  const rows = evaluate({ ...ALL_OK, prodFirst: null, errs: { prod: 'HTTP 503' } });
  chk('B6 ⭐⭐ fail-closed：正式站抓不到 ⇒ ③必須紅（絕不可以當成通過）', by(rows, '③').ok === false);
  chk('B6b 錯誤原因要出現在報告裡', String(by(rows, '③').got).includes('HTTP 503'));
}
{
  const rows = evaluate({
    localVer: null, ghVer: null, localFirst: null, testFirst: null, prodFirst: null, prodHint: null,
  });
  chk('B7 ⭐⭐⭐ 兩邊都拿不到 ⇒ 四條全紅（null === null 絕不可以算「相等」）',
    rows.every((r) => r.ok === false));
}
{
  const rows = evaluate({ ...ALL_OK, testFirst: null, prodFirst: null, errs: { test: 'x', prod: 'y' } });
  chk('B8 ⭐ 測試站與正式站都抓不到 ⇒ ②③都紅（不可以因為「兩邊一樣是 null」就放行）',
    by(rows, '②').ok === false && by(rows, '③').ok === false);
}

{
  const rows = evaluate({ ...ALL_OK, prodFirst: 'v6.382', prodHint: '6.383' });
  chk('B9 ⭐ 兩條線都落後 ⇒ bat 順序必須是「先伺服器後前端」',
    JSON.stringify(batsToRun(rows)) === JSON.stringify(['update-tournament.bat', 'redeploy-oracle.bat']));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】不得矯枉過正');
// ═══════════════════════════════════════════════════════════════════════════
{
  const rows = evaluate(ALL_OK);
  chk('C1 ①②永遠不綁 bat（那是 push / CI 的事，不是部署）',
    by(rows, '①').bat === null && by(rows, '②').bat === null);
  chk('C2 ③綁 redeploy-oracle.bat、④綁 update-tournament.bat（沒有綁錯邊）',
    by(rows, '③').bat === 'redeploy-oracle.bat' && by(rows, '④').bat === 'update-tournament.bat');
  chk('C3 ★ 沒有任何一條綁到 update-admin-full.bat（它不碰玩家前端）',
    rows.every((r) => r.bat !== 'update-admin-full.bat'));
  chk('C4 ④要誠實標注它只是代理指標（不得宣稱證明了引擎已重建）',
    String(by(rows, '④').note || '').includes('不證明'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】收斂：判準只有一份（Rule 38）');
// ═══════════════════════════════════════════════════════════════════════════
const runner = read('scripts/verify-deploy.mjs');
const core = read('scripts/lib/verify-deploy-core.mjs');

chk('D1 ⭐⭐ 站長跑的那支必須 import 判準核心，不得自己再寫一份',
  /from\s+'\.\/lib\/verify-deploy-core\.mjs'/.test(runner));
chk('D1b 它必須用到 evaluate 與 batsToRun（不是 import 了卻不用）',
  /\bevaluate\s*\(/.test(runner) && /\bbatsToRun\s*\(/.test(runner));

// 掃描：runner 裡不可以出現這三個判準的 regex 字面（出現＝判準被複製成第二份）
// ⚠ 這幾個樣式刻意用組字串的方式拼出來，避免掃描器掃到本檔自己以外的東西時誤判。
const DUP_PATTERNS = [
  ['ver' + '-badge', '首頁徽章'],
  ['SITE_' + 'VERSION_HINT', 'admin 版本提示'],
  ['VERSION' + '\\\\s*=', 'version.ts 版本號'],
];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const runnerCode = stripComments(runner);
for (const [pat, label] of DUP_PATTERNS) {
  chk(`D2 ⭐⭐ runner 的程式碼裡沒有「${label}」的判準複本`, !runnerCode.includes(pat), `找到 ${pat}`);
}
chk('D2b ★ 掃描器正對照：合成一段「複製了判準」的假程式碼，掃描器要抓得到',
  DUP_PATTERNS.every(([pat]) => stripComments(`const x = /${pat}/;`).includes(pat)));
chk('D2c ★ 掃描器負對照：判準寫在**註解**裡不算複本（不可誤紅）',
  DUP_PATTERNS.every(([pat]) => !stripComments(`// 這裡提到 ${pat} 只是說明\nconst y = 1;`).includes(pat)));

chk('D3 ⭐ 核心檔零 I/O（不得 import fs / fetch，否則守衛就跑不動了）',
  !/from\s+'node:fs'/.test(core) && !/\bfetch\s*\(/.test(core));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】.bat 的硬規範：純 ASCII ＋ CRLF');
// ═══════════════════════════════════════════════════════════════════════════
const batBuf = readFileSync(path.join(ROOT, 'oracle-admin/verify-deploy.bat'));
const batStr = batBuf.toString('latin1');
const nonAscii = (b) => b.filter((x) => x > 127).length;
const loneLf = (s) => (s.match(/(?<!\r)\n/g) || []).length;

chk('E1 ⭐⭐ .bat 是純 ASCII（cmd 用系統 ANSI 字碼頁解析 .bat，中文會讓它爆）',
  nonAscii(batBuf) === 0, `有 ${nonAscii(batBuf)} 個非 ASCII 位元組`);
chk('E2 ⭐⭐ .bat 全部是 CRLF 行尾（裸 LF 會讓 cmd 把行拆錯）',
  loneLf(batStr) === 0 && (batStr.match(/\r\n/g) || []).length > 20, `裸 LF ${loneLf(batStr)} 個`);
chk('E3 .bat 真的有呼叫那支 mjs', /node\s+scripts\\verify-deploy\.mjs/.test(batStr));
chk('E4 .bat 先切到 repo 根目錄（否則相對路徑會跑掉）', /cd \/d "%~dp0\.\."/.test(batStr));
chk('E5 .bat 把報告寫成檔案再開記事本（console 顯示不了 UTF-8 中文）',
  /> "%OUT%"/.test(batStr) && /notepad/.test(batStr));
chk('E6 ★ 反對照：E1 的判準真的測得出中文', nonAscii(Buffer.from('中文', 'utf8')) > 0);
chk('E7 ★ 反對照：E2 的判準真的測得出裸 LF', loneLf('a\nb') === 1 && loneLf('a\r\nb') === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】鐵律錨');
// ═══════════════════════════════════════════════════════════════════════════
const iron = read('IRON_RULES.md');
chk('F1 ⭐ IRON_RULES 有 Rule 43', /^## Rule 43:/m.test(iron));
chk('F2 ⭐ Rule 43 逐字寫著「bat 沒報錯 ≠ 部署成功」', iron.includes('bat 沒報錯 ≠ 部署成功'));
chk('F3 ⭐ Rule 43 逐字寫著「休閒對戰跑的是」那句關鍵事實', iron.includes('休閒對戰跑的是'));
chk('F4 ★ 反對照：這個檔裡沒有一條不存在的 Rule 99（證明 F1 不是恆真）', !/^## Rule 99:/m.test(iron));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
const pkg = JSON.parse(read('package.json'));
const chain = String(pkg.scripts.test);
const hits = chain.split('&&').filter((c) => c.includes('test-v6387-verify-deploy.mjs')).length;
chk('G1 ⭐ scripts.test 裡**恰好**有本檔一次', hits === 1, `找到 ${hits} 次`);

console.log(`\n=== v6.387 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
