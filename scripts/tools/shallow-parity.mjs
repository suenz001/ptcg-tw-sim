#!/usr/bin/env node
/**
 * ⭐ v6.377 C-15：**兩張免疫測試網**的正式工具（原本只是站長本機的 __m6a\shallow376.bat）。
 *
 * ══ 為什麼要兩張網（這是本工具存在的全部理由，別刪這段）══════════════════════
 *   本機工作樹是 **CRLF**（core.autocrlf=true）、而且是**完整** clone（有全部歷史）。
 *   CI（.github/workflows/deploy.yml）是 **LF** checkout、而且是 **fetch-depth: 1 淺複製**。
 *   ⇒ 有兩類 bug 本機永遠看不到：
 *     ① 行尾類：多行字串錨點在 CRLF 定位失敗 ⇒ 本機紅、CI 綠（假綠，突變層沒跑到）。
 *        反過來也有：只在 LF 才成立的斷言 ⇒ 本機綠、CI 紅。
 *     ② 淺複製類：守衛去拿 BASE commit（git cat-file / git rev-parse）拿不到，
 *        如果它「拿不到就靜默跳過」⇒ CI 全綠但**整支守衛被掏空**（v6.371 實際發生過：
 *        本機 141/0、免疫網 704 步 0 紅，CI 卻紅 2 條、deploy 被 skip）。
 *
 *   ⇒ **推之前要跑兩張網**：
 *       完整 clone（--full）：抓行為回歸，對照本機。
 *       淺複製（預設）      ：抓「只在 CI 才紅」的那一類 —— BASE 拿不到時守衛的行為。
 *   ⚠ 兩張網都用 `core.autocrlf=false`（＝LF 工作樹），這樣才跟 CI 的 checkout 一致。
 *
 * ══ 用法 ═══════════════════════════════════════════════════════════════
 *   node scripts/tools/shallow-parity.mjs              # 淺複製網（--depth 1）
 *   node scripts/tools/shallow-parity.mjs --full       # 完整 clone 網
 *   node scripts/tools/shallow-parity.mjs --dry-run    # 只印出會下的 git 參數，不 clone
 *   node scripts/tools/shallow-parity.mjs --keep       # 跑完不刪工作區（要進去看細節時用）
 *   node scripts/tools/shallow-parity.mjs --dest <dir> # 指定工作區
 *
 * ⚠⚠ **不要把本工具接進 `npm test` chain** —— 它會 clone 整個 repo，太重。
 *   它是「推之前手動跑」的工具。`scripts/test-v6377-*.mjs` 會斷言它**沒有**被接進 chain。
 *
 * ⚠ 跨平台：不寫死 `E:\`（repo 根由自己的 import.meta.url 推）、不用 Windows 的 `mklink`
 *   （改 `fs.symlinkSync(..., 'junction')`，Windows 上不需要管理員權限；POSIX 用 'dir'）。
 *   ⚠ `--depth 1` 只有對 **file:// URL** 有效 —— 直接給本機路徑 git 會走 hardlink 模式並忽略 depth。
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';

export const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/**
 * ⭐ 本工具的**行為核心**：要下給 git 的參數。
 * 守衛就是把 `--dry-run` 跑起來、拿這個陣列來斷言（不是去 grep 原始碼字串）。
 * ⚠ 兩個關鍵旗標不可以被拿掉：
 *   `-c core.autocrlf=false` —— 沒有它，Windows 上 clone 出來是 CRLF，就不是 CI 的環境了。
 *   `--depth 1`              —— 沒有它，淺複製網退化成完整 clone，② 那一類永遠抓不到。
 */
export function buildCloneArgs({ mode, url, dest }) {
  const args = ['clone', '-c', 'core.autocrlf=false'];
  if (mode === 'shallow') args.push('--depth', '1');
  args.push(url, dest);
  return args;
}

export function parseArgv(argv) {
  const o = { mode: 'shallow', dryRun: false, keep: false, dest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--full') o.mode = 'full';
    else if (a === '--shallow') o.mode = 'shallow';
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--dest') o.dest = argv[++i];
  }
  return o;
}

function linkNodeModules(dest) {
  const target = join(ROOT, 'node_modules');
  const link = join(dest, 'node_modules');
  if (!existsSync(target)) throw new Error('本機沒有 node_modules，請先 npm ci');
  if (existsSync(link)) return 'already';
  try {
    symlinkSync(target, link, platform() === 'win32' ? 'junction' : 'dir');
    return 'symlink';
  } catch {
    cpSync(target, link, { recursive: true });   // 不能建連結（權限／跨磁碟）就整份複製
    return 'copy';
  }
}

function main() {
  const o = parseArgv(process.argv.slice(2));
  const url = pathToFileURL(ROOT).href;
  const dest = o.dest ? resolve(o.dest) : join(tmpdir(), 'ptcg-parity-' + o.mode + '-' + process.pid);
  const args = buildCloneArgs({ mode: o.mode, url, dest });

  console.log('NET ' + o.mode);
  console.log('ROOT ' + ROOT);
  console.log('DEST ' + dest);
  console.log('GITARGS ' + JSON.stringify(args));
  if (o.dryRun) { console.log('DRY-RUN：沒有 clone、沒有跑測試。'); return; }

  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  const c = spawnSync('git', args, { stdio: 'inherit' });
  if (c.status !== 0) { console.error('clone 失敗 exit=' + c.status); process.exit(2); }

  console.log('node_modules：' + linkNodeModules(dest));

  const t = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], {
    cwd: dest, stdio: 'inherit', env: { ...process.env },
  });
  console.log('\n════ ' + o.mode + ' 網結果：npm test exit=' + t.status + ' ════');
  if (!o.keep) { try { rmSync(dest, { recursive: true, force: true }); } catch { /* */ } }
  else console.log('工作區保留在 ' + dest);
  process.exit(t.status === 0 ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();