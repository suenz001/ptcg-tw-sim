#!/usr/bin/env node
/**
 * v6.189 守衛：anti-pattern-lint 對 **CRLF 與 LF 兩種輸入必須得到完全相同的結果**。
 *
 * 事故：Windows 是 CRLF checkout，行尾多一個 \r。JS 的 `.` 不吃 \r（\r 是 line terminator），
 *   不帶 m 旗標的 `$` 又只認字串結尾 ⇒ `line.replace(/\/\/.*$/, '')`（剝行內註解）在 CRLF 下
 *   **整條匹配失敗、註解一個字都沒剝掉** ⇒ 註解裡提到的字樣被當成真程式碼。
 *   實測：Check W 在 m6_wave14.ts 誤報 2 筆（那兩行正是在講解該反模式的註解），
 *   站長本機 `npm test` 第一步就紅，CI（LF）卻是 0 違規 —— 同一份程式碼兩種結論。
 *
 * ⚠⚠ 本檔**不是**「檔案裡有沒有出現 replace(/\r/)」這種字串斷言 ——
 *   那擋不住「接線沒接上」。這裡是把 lint **原封不動搬進臨時工作區，用兩種換行各真跑一次**，
 *   比對 stdout 與 exit code。
 * ⚠⚠ 而且一定要有**正對照**：只驗「兩邊都乾淨」是可以靠「把 Check W 整個刪掉」作弊的。
 *   所以另外注入一個**真的違規**，斷言兩種換行都抓得到、而且抓到的是同一批。
 *
 * HEAD-FAIL：對 v6.188 的 anti-pattern-lint.mjs 跑本檔 —— 第①條會 FAIL
 *   （CRLF 多出 2 筆 [W] 誤報，LF 是 0）。
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, symlinkSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); console.log('  PASS ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n        ' + (e && e.message)); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ── 臨時工作區：lint 的 ROOT 是由自己的 import.meta.url 推的，所以把它複製過去就換了根 ──
const WORK = mkdtempSync(join(tmpdir(), 'lintnl-'));
process.on('exit', () => { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* */ } });

mkdirSync(join(WORK, 'scripts'), { recursive: true });
cpSync(join(ROOT, 'scripts/anti-pattern-lint.mjs'), join(WORK, 'scripts/anti-pattern-lint.mjs'));
// lint 掃 src/lib/game 全部 .ts（會被換行改寫的對象）＋ Check R 額外納入兩個對戰 svelte。
cpSync(join(ROOT, 'src/lib/game'), join(WORK, 'src/lib/game'), { recursive: true });
mkdirSync(join(WORK, 'src/routes/game'), { recursive: true });
for (const f of ['+page.svelte', 'MobilePortraitBattle.svelte']) {
  cpSync(join(ROOT, 'src/routes', 'game', f), join(WORK, 'src/routes/game', f));
}
// static/cards 只被 Check Y 讀（JSON，換行無關）⇒ 用 junction/symlink 省掉 4.8MB 複製。
// ⚠ Windows 上目錄要用 'junction' 才不需要管理員權限。
try { symlinkSync(join(ROOT, 'static'), join(WORK, 'static'), 'junction'); }
catch { cpSync(join(ROOT, 'static/cards'), join(WORK, 'static/cards'), { recursive: true }); }

function targets() {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|svelte)$/.test(e)) out.push(p); } };
  walk(join(WORK, 'src'));
  return out;
}
const FILES = targets();
ok(FILES.length > 100, '前提：臨時工作區應有 >100 個待掃檔，實得 ' + FILES.length);

function setEol(mode) {
  for (const f of FILES) {
    const lf = readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');
    writeFileSync(f, mode === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf);
  }
}
function runLint() {
  const r = spawnSync(process.execPath, [join(WORK, 'scripts/anti-pattern-lint.mjs')], { encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
function bothEols() {
  setEol('lf'); const lf = runLint();
  setEol('crlf'); const crlf = runLint();
  return { lf, crlf };
}
// 違規清單（去掉標題行、排序）—— 只比實質內容，不比那一長串 check 說明。
const viol = (o) => o.out.split('\n').filter((l) => /^\s*\[[A-Z]\] /.test(l)).map((l) => l.trim()).sort();

console.log('\n① 現況：CRLF 與 LF 必須得到完全相同的結果');
{
  const { lf, crlf } = bothEols();
  T('★★★ exit code 相同', () => ok(lf.code === crlf.code, 'LF exit=' + lf.code + ' / CRLF exit=' + crlf.code));
  T('★★★ 違規清單逐字相同（CRLF 不得多報也不得少報）', () => {
    const a = viol(lf), b = viol(crlf);
    ok(JSON.stringify(a) === JSON.stringify(b),
      '不一致：\n  LF(' + a.length + ')  ：' + (a.join('\n           ') || '(無)')
      + '\n  CRLF(' + b.length + ')：' + (b.join('\n           ') || '(無)'));
  });
  T('現況本身是乾淨的（CI 基準 0 違規）', () => ok(lf.code === 0 && viol(lf).length === 0, 'LF 應 0 違規，實得 ' + viol(lf).length + '：' + viol(lf).join(' / ')));
}

console.log('\n② 正對照：注入一個真的 Check W 違規 ⇒ 兩種換行都必須抓到（不可因為正規化而漏抓）');
{
  const INJ = join(WORK, 'src/lib/game/effects/cards/__lint_selftest_w.ts');
  writeFileSync(INJ,
    'export function __lintSelfTestW(st: any, withPending: any) {\n'
    + '  withPending(st, {\n'
    + "    type: 'deck-search',\n"
    + "    filter: 'TOP7',\n"
    + '    count: 1,\n'
    + '    params: { validIids: [1, 2, 3] },\n'
    + '  });\n'
    + '}\n');
  FILES.push(INJ);
  const { lf, crlf } = bothEols();
  const a = viol(lf), b = viol(crlf);
  T('★★★ LF 抓得到注入的 [W] 違規（掃描器沒有被改壞）', () => {
    ok(lf.code === 1, 'LF 應 exit 1，實得 ' + lf.code);
    ok(a.some((l) => l.startsWith('[W]') && l.includes('__lint_selftest_w.ts')), 'LF 沒抓到注入的違規：' + (a.join(' / ') || '(無)'));
  });
  T('★★★ CRLF 也抓得到，且與 LF 抓到的完全相同', () => {
    ok(crlf.code === 1, 'CRLF 應 exit 1，實得 ' + crlf.code);
    ok(JSON.stringify(a) === JSON.stringify(b), '不一致：\n  LF  ：' + a.join(' / ') + '\n  CRLF：' + b.join(' / '));
  });
  // v6.189 順手修的 rel()：ROOT 結尾本來就有分隔符，`slice(ROOT.length + 1)` 會多吃一個字元 ⇒
  //   訊息裡的路徑變成 `rc/lib/...`，複製貼上開不了檔。
  T('★ 違規訊息裡的路徑是可用的相對路徑（src/… 開頭，不是被吃掉一個字元的 rc/…）', () => {
    const paths = a.map((l) => (/^\[[A-Z]\] (\S+):/.exec(l) || [])[1]).filter(Boolean);
    ok(paths.length > 0, '前提：注入後應有帶路徑的違規訊息');
    ok(paths.every((x) => x.startsWith('src/')), '路徑應以 src/ 開頭，實際：' + paths.join(' / '));
  });
  unlinkSync(INJ);
  FILES.pop();
}

console.log('\n③ 正規化只動換行（不可順手改壞檔案內容）');
{
  T('CRLF 版讀進來後與 LF 版逐位元組相同（\\r 以外沒有差異）', () => {
    const f = join(WORK, 'src/lib/game/effects/cards/m6_wave14.ts');
    setEol('lf'); const a = readFileSync(f, 'utf8');
    setEol('crlf'); const b = readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');
    ok(a === b, 'm6_wave14.ts 在兩種換行下正規化後應完全相同');
  });
}

console.log('\n' + (fail === 0 ? '✅ 全部通過' : '❌ 有失敗') + `（PASS ${pass} / FAIL ${fail}）`);
process.exit(fail === 0 ? 0 : 1);
