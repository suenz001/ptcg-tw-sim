#!/usr/bin/env node
/**
 * v6.388d 突變測試 —— 自證 test-v6371-guard-hygiene 的【F】節（守衛路徑根的跨平台守門）
 * 不是安慰劑。
 *
 * 為什麼要有這支：v6.388 的 CI 連紅兩版、deploy 被 skip、測試站整版沒更新，
 * 根因是一支守衛的 ROOT 用了 Windows-only 的 `pathname.slice(1)`（IRON_RULES Rule 46）。
 * 【F】節是那件事的防回歸守衛；這支腳本負責證明它真的會紅。
 *
 * ⚠ 本檔**不進 npm test chain**（它會寫暫存探針檔、跑得慢），但**必須留在 repo**，
 *   因為 Rule 46 明文要求「查法要一併寫進文件，讓下一個人能複驗」。
 *   跑法：`node scripts/mutcheck-v6388d-guard-root.mjs`
 *
 * ⚠ 本檔裡的壞寫法一律用**字串拼接**組出來（'import.meta' + '.url'），
 *   否則本檔自己就會被【F】節的 F5 判成違規。
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUARD = join(ROOT, 'scripts/test-v6371-guard-hygiene.mjs');

const IMU = 'import.meta' + '.url';
const PN = '.path' + 'name';

const run = () => {
  try { return execFileSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
};
const lineFor = (out, key) => (out.split(/\r?\n/).find((x) => x.includes(key)) || '(找不到這條斷言)').trim();
const isRed = (out, key) => lineFor(out, key).startsWith('FAIL');

let allOk = true;
function expectRed(tag, keys, out) {
  for (const k of keys) {
    const ok = isRed(out, k);
    console.log(`${ok ? '✅' : '❌'} ${tag} → 「${k}」${ok ? '如預期翻紅' : '居然還是綠的'}`);
    console.log('   ' + lineFor(out, k).slice(0, 150));
    if (!ok) allOk = false;
  }
}

// ── M1：把 v6.388 那個壞 ROOT 放回 test-v6388（F1 與 F5 都該紅）────────────────
{
  const p = join(ROOT, 'scripts/test-v6388-mf-wave1.mjs');
  const orig = readFileSync(p, 'utf8');
  const from = "const ROOT = fileURLToPath(new URL('..', " + IMU + '));';
  const to = 'const ROOT = join(dirname(new URL(' + IMU + ')' + PN + '.slice(1)), \'..\');';
  if (orig.split(from).length - 1 !== 1) { console.log('❌ M1 錨點不唯一，這一條不算數'); allOk = false; }
  else {
    try { writeFileSync(p, orig.replace(from, to), 'utf8'); expectRed('M1 壞 ROOT 放回 test-v6388', ['F1 ⭐⭐⭐', 'F5 ⭐⭐⭐'], run()); }
    finally { writeFileSync(p, orig, 'utf8'); }
  }
}

/**
 * 寫一支暫時的探針守衛檔，跑一次【F】節，然後刪掉。
 * ⚠v6.388g：`eol` 可以指定 —— 行尾字元曾經讓 F0d 的判準失效（CRLF 下誤紅），
 *   所以 CRLF 這條路徑必須有人守。
 */
function withProbe(name, lines, fn, eol = '\n') {
  const p = join(ROOT, 'scripts/' + name);
  try { writeFileSync(p, lines.join(eol) + eol, 'utf8'); fn(run()); }
  finally { if (existsSync(p)) unlinkSync(p); }
}
/**
 * ★v6.388g（Opus 5 複審 🟡3）「這一輪真的掃到那個探針了」的見證。
 * ⚠ 沒有它，M9／M11 這種「必須維持綠」的反對照會在**探針根本沒被掃到**時照樣通過
 *   （withProbe 寫錯位置、isFormal() 日後改嚴把 zz-* 排除掉…）。
 * 作法：探針檔裡故意放一行**真的**壞寫法當見證 —— F5 必須紅，才證明這個檔進了掃描母體。
 */
const WITNESS_LINE = 'const WITNESS = witnessUrl' + PN + '.slice(1);';

// ── M2：變數名／縮排／export 三種變形（Fable 5 在 v6.388c 指出的漏洞）──────────
withProbe('zz-mut-probe-a.mjs', [
  '// v6.388d 突變探針（mutcheck 產生，跑完自動刪除）',
  "import { dirname } from 'node:path';",
  'const REPO_ROOT = dirname(new URL(' + IMU + ')' + PN + '.slice(1));',
  'export const ROOT3 = new URL(' + IMU + ')' + PN + '.slice(1);',
  '  const INDENTED = new URL(' + IMU + ')' + PN + '.slice(1);',
  'console.log(REPO_ROOT, ROOT3, INDENTED);',
], (out) => expectRed('M2 REPO_ROOT／export const／縮排 三變形', ['F1 ⭐⭐⭐', 'F5 ⭐⭐⭐'], out));

// ── M3：跨行定義 —— F1 的單行解析器抓不到，必須由 F5 字串層攔下 ────────────────
withProbe('zz-mut-probe-b.mjs', [
  '// v6.388d 突變探針2：跨行定義',
  "import { join, dirname } from 'node:path';",
  'const ROOT = join(',
  '  dirname(new URL(' + IMU + ')' + PN + ".slice(1)), '..');",
  'console.log(ROOT);',
], (out) => expectRed('M3 跨行定義（只有 F5 守得到）', ['F5 ⭐⭐⭐'], out));

// ── M4：關鍵字分行 —— 規則② 專門為這種寫法而設（v6.388c 的兩層防線守不到）──────
withProbe('zz-mut-probe-c.mjs', [
  '// v6.388d 突變探針3：先把 url 存起來，下一行才取 pathname',
  "import { join, dirname } from 'node:path';",
  'const u = ' + IMU + ';',
  "const ROOT = join(dirname(new URL(u)" + PN + ".slice(1)), '..');",
  'console.log(ROOT);',
], (out) => expectRed('M4 關鍵字分行（規則②）', ['F5 ⭐⭐⭐'], out));

// ── M5：Windows 分隔符拼接 —— 求得出絕對路徑，但 Linux 上是不存在的目錄 ─────────
withProbe('zz-mut-probe-d.mjs', [
  '// v6.388d 突變探針4：反斜線拼接（F1 只驗 isAbsolute 的話會假綠）',
  "import { dirname } from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const ROOT = dirname(fileURLToPath(" + IMU + ")) + '\\\\..';",
  'console.log(ROOT);',
], (out) => expectRed('M5 反斜線拼接（F1 的期望值集合 ＋ F5 規則③）', ['F1 ⭐⭐⭐', 'F5 ⭐⭐⭐'], out));

// ── M6：區塊註解剝除的決定性突變（Fable 5 複審 v6.388d 抓到的倒退）─────────────
// v6.388d 用正則剝 /* */，被 `//` 行註解或字串裡的 `/*` 觸發後會一路吃到下一個 `*/`，
// 把 56 支守衛的真程式碼剝成空白 —— 其中這 4 支的 `const ROOT =` 行整行消失：
//   test-ai-playbook-contract / test-v6149-sw-api-bypass-and-net-banner
//   test-v6211-pending-clobber-and-printing-gap / test-v6296-lobby-friends-tab
// 把壞寫法放進其中任何一支，v6.388d 照樣 154/0 全綠（＝那 4 支對 F 節完全隱形）。
// v6.388e 改用 acorn 之後必須紅。
for (const victim of [
  'scripts/test-ai-playbook-contract.mjs',
  'scripts/test-v6149-sw-api-bypass-and-net-banner.mjs',
  'scripts/test-v6211-pending-clobber-and-printing-gap.mjs',
  'scripts/test-v6296-lobby-friends-tab.mjs',
]) {
  const p = join(ROOT, victim);
  const orig = readFileSync(p, 'utf8');
  const from = "const ROOT = fileURLToPath(new URL('..', " + IMU + '));';
  const to = 'const ROOT = join(dirname(new URL(' + IMU + ')' + PN + '.slice(1)), \'..\');';
  if (orig.split(from).length - 1 !== 1) { console.log('❌ M6 錨點不唯一：' + victim); allOk = false; continue; }
  try { writeFileSync(p, orig.replace(from, to), 'utf8'); expectRed('M6 壞 ROOT 放進 ' + victim.replace('scripts/', ''), ['F1 ⭐⭐⭐', 'F5 ⭐⭐⭐'], run()); }
  finally { writeFileSync(p, orig, 'utf8'); }
}

/**
 * 跑一次守衛，要求指定的斷言**全部是綠的**（反對照用）。
 * ⚠v6.388g（Opus 5 複審 🟡2）：原本是 `!isRed(...)` —— **fail-open**。
 *   `lineFor()` 找不到那條斷言時回 '(找不到…)'，`isRed` 就是 false，這裡就 ✅ ——
 *   只要有人改掉斷言標題、刪掉那條檢查、或守衛整支 crash，反對照照樣印 ✅。
 *   ⇒ 改成**必須真的看到 PASS 開頭的那一行**。
 */
function expectGreen(tag, keys, out) {
  for (const k of keys) {
    const ok = lineFor(out, k).startsWith('PASS');
    console.log(`${ok ? '✅' : '❌'} ${tag} → 「${k}」${ok ? '如預期維持綠燈' : '居然紅了（誤紅！）'}`);
    console.log('   ' + lineFor(out, k).slice(0, 150));
    if (!ok) allOk = false;
  }
}

// ── M7：F0b 的正對照 —— 右側用到白名單外的函式（split）⇒ 必須紅，不可以無聲跳過 ──────
withProbe('zz-mut-probe-e.mjs', [
  '// v6.388f 突變探針5：白名單外的識別字（split）',
  "import { fileURLToPath } from 'node:url';",
  "const ROOT = fileURLToPath(new URL('..', " + IMU + ")).split('/').slice(0, -1).join('/');",
  'console.log(ROOT);',
], (out) => expectRed('M7 白名單外識別字（F0b 正對照）', ['F0b ★★'], out));

// ── M8：F0e 的正對照 —— 語法錯誤的守衛檔 ⇒ 必須紅（parse 不過 ⇒ 註解剝不乾淨 ⇒ 盲區）─
withProbe('zz-mut-probe-f.mjs', [
  '// v6.388f 突變探針6：故意的語法錯誤',
  'const x = ;',
], (out) => expectRed('M8 語法錯誤檔（F0e 正對照）', ['F0e ★'], out));

// ── M9：F0d 的**反對照** —— 寫在區塊註解裡的壞 ROOT **不得**讓 F0d 紅 ────────────────
//   ⚠ 這是 Opus 5 複審 v6.388e 抓到的地雷：本 repo 守衛檔頭清一色是 /** … */，
//     而這一整串版本的敘事正是在鼓勵大家把那個壞寫法寫進檔頭說明。
//     v6.388e 的 F0d（剝前 vs 剝後）會把它判成「剝壞了」⇒ 假紅 ⇒ CI 紅 ⇒ deploy 被 skip。
withProbe('zz-mut-probe-g.mjs', [
  '/**',
  ' * v6.388f 突變探針7：檔頭說明裡逐字引用壞寫法（這是**合法**的，不可以紅）',
  ' *   const ROOT = join(dirname(new URL(' + IMU + ')' + PN + ".slice(1)), '..');",
  ' */',
  "import { fileURLToPath } from 'node:url';",
  "const witnessUrl = new URL('file:///witness');",   // ⚠ 不可以用 import.meta.url —— 那會讓這一行自己被 F1 納入求值
  "const ROOT = fileURLToPath(new URL('..', " + IMU + '));',
  WITNESS_LINE,
  'console.log(ROOT, WITNESS);',
], (out) => {
  expectGreen('M9 區塊註解裡的壞 ROOT（F0d 反對照，不得誤紅）', ['F0d ★★★', 'F1 ⭐⭐⭐'], out);
  expectRed('M9 見證：這個探針檔確實進了掃描母體', ['F5 ⭐⭐⭐'], out);
});

// ── M10：F0d 的正對照 —— 把剝除器退回 v6.388d 的正則版 ⇒ 必須紅 ──────────────────────
{
  const p = join(ROOT, 'scripts/test-v6371-guard-hygiene.mjs');
  const orig = readFileSync(p, 'utf8');
  const from = "    let out = s;";
  const to = "    let out = s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, (m) => m.replace(/[^\\n]/g, ' '));   // [MUTANT] 退回 v6.388d 的正則版";
  if (orig.split(from).length - 1 !== 1) { console.log('❌ M10 錨點不唯一，這一條不算數'); allOk = false; }
  else {
    try { writeFileSync(p, orig.replace(from, to), 'utf8'); expectRed('M10 剝除器退回正則版（F0d 正對照）', ['F0d ★★★'], run()); }
    finally { writeFileSync(p, orig, 'utf8'); }
  }
}

// ── M11：F1 的反對照 —— Node 官方的 __filename 寫法**不得**被判成壞 ────────────────────
//   ⚠ Opus 5 複審 v6.388e 抓到：goodRoot 原本要求結果 ∈ {repo, repo/scripts, repo/scripts/lib}，
//     但 const __filename = fileURLToPath(import.meta.url) 算出來是**檔案**路徑 ⇒ 假紅。
withProbe('zz-mut-probe-h.mjs', [
  '// v6.388f 突變探針8：Node 官方的 __filename 寫法（合法，不可以紅）',
  "import { fileURLToPath } from 'node:url';",
  "const witnessUrl = new URL('file:///witness');",   // ⚠ 不可以用 import.meta.url —— 那會讓這一行自己被 F1 納入求值
  'const SELF = fileURLToPath(' + IMU + ');',
  WITNESS_LINE,
  'console.log(SELF, WITNESS);',
], (out) => {
  expectGreen('M11 __filename 官方寫法（F1 反對照，不得誤紅）', ['F1 ⭐⭐⭐', 'F0b ★★'], out);
  expectRed('M11 見證：這個探針檔確實進了掃描母體', ['F5 ⭐⭐⭐'], out);
});

// ── M12／M13：F0d 的行尾／半行註解反對照（v6.388g 修的那個 🔴）──────────────────
// v6.388f 的 inComment 拿「整行的 [a,b) 有沒有被某個 span 包住」比，而 b 是下一行的起始 offset、
// 判準寫成 `b <= s1 + 1`（假設註解結束在行尾、後面只有一個 \n）。實測：
//   ・CRLF 下 b = s1 + 2  ⇒ **本機誤紅、CI 綠**（守衛行為跟行尾字元綁在一起）
//   ・註解結束在**行中間**、後面還有程式碼 ⇒ **LF 也紅** ⇒ CI build 紅 ⇒ deploy 被 skip
// 這兩條就是那兩個形狀的回歸守衛。
{
  const commentBad = [
    '/*',
    ' * 檔頭說明裡逐字引用壞寫法（合法）：',
    ' *   const ROOT = join(dirname(new URL(' + IMU + ')' + PN + ".slice(1)), '..');",
    ' */',
    "import { fileURLToPath } from 'node:url';",
    "const witnessUrl = new URL('file:///witness');",   // ⚠ 不可以用 import.meta.url —— 那會讓這一行自己被 F1 納入求值
    "const ROOT = fileURLToPath(new URL('..', " + IMU + '));',
    WITNESS_LINE,
    'console.log(ROOT, WITNESS);',
  ];
  withProbe('zz-mut-probe-i.mjs', commentBad, (out) => {
    expectGreen('M12 同樣的檔頭說明，但檔案是 **CRLF** 行尾（F0d 不得因行尾字元誤紅）', ['F0d ★★★'], out);
    expectRed('M12 見證：這個探針檔確實進了掃描母體', ['F5 ⭐⭐⭐'], out);
  }, '\r\n');

  // 註解結束在行中間、後面還有程式碼
  const halfLine = [
    '/*',
    ' *   const ROOT = join(dirname(new URL(' + IMU + ')' + PN + ".slice(1)), '..');",
    " */ import { fileURLToPath } from 'node:url';",
    "const witnessUrl = new URL('file:///witness');",   // ⚠ 不可以用 import.meta.url —— 那會讓這一行自己被 F1 納入求值
    "const ROOT = fileURLToPath(new URL('..', " + IMU + '));',
    WITNESS_LINE,
    'console.log(ROOT, WITNESS);',
  ];
  for (const [tag, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
    withProbe('zz-mut-probe-j.mjs', halfLine, (out) => {
      expectGreen('M13 註解結束在**行中間**、後面還有程式碼（' + tag + '）（F0d 不得誤紅）', ['F0d ★★★'], out);
      expectRed('M13 見證：這個探針檔確實進了掃描母體（' + tag + '）', ['F5 ⭐⭐⭐'], out);
    }, eol);
  }
}

// ── 還原後必須回到全綠 ──────────────────────────────────────────────────────
const clean = run();
const tail = clean.split(/\r?\n/).filter((l) => l.includes('guard-hygiene]')).pop() || '(找不到總結行)';
const cleanOk = /FAIL 0\s*$/.test(tail.trim());
console.log(`${cleanOk ? '✅' : '❌'} 還原後回到全綠：${tail.trim()}`);
if (!cleanOk) allOk = false;

console.log('');
console.log(allOk ? '✅ v6.388d 突變測試全數通過' : '❌ 有未通過項');
process.exit(allOk ? 0 : 1);
