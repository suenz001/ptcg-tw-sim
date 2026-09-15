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

/** 寫一支暫時的探針守衛檔，跑一次【F】節，然後刪掉 */
function withProbe(name, lines, fn) {
  const p = join(ROOT, 'scripts/' + name);
  try { writeFileSync(p, lines.join('\n') + '\n', 'utf8'); fn(run()); }
  finally { if (existsSync(p)) unlinkSync(p); }
}

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

// ── 還原後必須回到全綠 ──────────────────────────────────────────────────────
const clean = run();
const tail = clean.split(/\r?\n/).filter((l) => l.includes('guard-hygiene]')).pop() || '(找不到總結行)';
const cleanOk = /FAIL 0\s*$/.test(tail.trim());
console.log(`${cleanOk ? '✅' : '❌'} 還原後回到全綠：${tail.trim()}`);
if (!cleanOk) allOk = false;

console.log('');
console.log(allOk ? '✅ v6.388d 突變測試全數通過' : '❌ 有未通過項');
process.exit(allOk ? 0 : 1);
