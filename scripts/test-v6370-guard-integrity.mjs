// v6.370 守衛：**守衛自身的完整性** —— 把 v6.365~v6.369 期間「CI 全紅、測試站四版沒上線」的三個
//   病灶釘死在行為層。本版出貨碼（src/、oracle-admin/）**一行都沒改**，只動 scripts/。
//
// 背景（實查 GitHub Actions，不是推測）：
//   917874bf (v6.367) Deploy to GitHub Pages ⇒ completed / failure（build job 紅 ⇒ deploy job 被 skip）
//   7fcc1c66 (v6.364) ⇒ 最後一次成功部署。v6.365／6.366／6.367／6.368 **從來沒有上線**。
//   紅的那一條是 `test-v6263-shallow-clone-ci-guards.mjs` ②：
//     「每一支『自己呼叫 git 且寫死歷史 sha』的腳本，不是走中央 helper 就是在白名單裡」
//        ⟵ ["scripts/test-v6365-tournament-draw-double-loss.mjs"]
//   ⇒ 一支**新守衛**違反既有規範，就能把整條出貨管線停掉四個版本。
//
// 本檔守三件事（每一條都要有行為端；結構層只當補充，Rule 28）：
//   【A】(丙) `allowResidualFor` / `isGamePageLabel` ＝「這個 label 是不是 game/+page.svelte」的**唯一**判準。
//        v6.369 的 test-v6297 用 `/(^|\/)src\/routes\/game\/\+page\.svelte$/`，只吃 `/`；
//        Windows 的 label 是 `src\routes\game\+page.svelte` ⇒ allowResidual 空掉 ⇒ 護欄⑦ 誤炸
//        ⇒ D1／D1b／D1c／I3／I3b…**在本機永久紅、在 CI 全綠** ⇒ 本機紅燈變雜訊、那幾條的本機保護力＝0。
//   【B】(甲) 「讀歷史 commit」一律走中央 helper `scripts/lib/base-blob.mjs`（＝上面那條 CI 紅燈的根因）。
//   【C】(乙) ④⑤ 的 PATH shim 在 Windows 結構性無效 ⇒ 只准 Windows 大聲跳過；**POSIX（＝CI）不准跳過**。
//   【D】本檔自己必須在 npm test chain 裡（否則寫了等於沒寫）。
//
// ⚠ 反安慰劑自我要求（IRON_RULES #26/#27/#28）：
//   - 沒有恆真斷言：每一條「必須成立」的旁邊都有一條「必須不成立」的負對照。
//   - 不用 `||` 放寬判準；平台差異用**明確分支**寫死，兩邊各自有斷言。
//   - 掃描器先驗自己（正對照＋負對照），再去掃別人（Rule 25）。
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { templateOnly, GAME_INLINE_STYLE, isGamePageLabel, allowResidualFor } from './lib/strip-markup-sections.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'scripts/test-v6370-guard-integrity.mjs';
const HELPER = 'scripts/lib/strip-markup-sections.mjs';
const V6263 = 'scripts/test-v6263-shallow-clone-ci-guards.mjs';
const V6365 = 'scripts/test-v6365-tournament-draw-double-loss.mjs';
const V6297 = 'scripts/test-v6297-tourn-friends-tab.mjs';
const BASE_SHA = '56329766c11e0e4d313fc6067dfb7e228929e798';   // v6.369（本版的前一版；本檔改動前的樣子）

let n = 0, bad = 0, skipped = 0;
const chk = (label, cond, extra = '') => {
  n++; console.log((cond ? '  PASS ' : '  FAIL ') + label + (cond ? '' : (extra ? '  ⟵ ' + String(extra).slice(0, 300) : '')));
  if (!cond) bad++;
};
const sha12 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
/** 執行 fn，回報有沒有丟例外與訊息（不要用 try/catch 吞掉 ⇒ 這裡把「有沒有丟」變成判準本身）。 */
const attempt = (fn) => { try { fn(); return { threw: false, msg: '' }; } catch (e) { return { threw: true, msg: String((e && e.message) || e) }; } };
/** 剝註解（Rule 25.4）：結構層掃描一律在剝完註解的原始碼上做，避免「註解裡寫了就算數」。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const readRel = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ══════════════════════════════════════════════════════════════════════════════
console.log('【A】(丙) 中央判準 isGamePageLabel／allowResidualFor —— 真值表、負對照、行為端、收斂性');

// ── A-1 真值表 ────────────────────────────────────────────────────────────────
const POSIX_LABEL = 'src/routes/game/+page.svelte';
const WIN_LABEL = 'src\\routes\\game\\+page.svelte';
const ABS_POSIX = '/home/runner/work/ptcg-tw-sim/ptcg-tw-sim/src/routes/game/+page.svelte';
const ABS_WIN = 'E:\\ptcg-tw-sim\\src\\routes\\game\\+page.svelte';
for (const [what, label] of [['相對 POSIX', POSIX_LABEL], ['相對 Windows', WIN_LABEL], ['絕對 POSIX', ABS_POSIX], ['絕對 Windows', ABS_WIN]]) {
  chk(`A1 isGamePageLabel(${what}) === true`, isGamePageLabel(label) === true, label);
  chk(`  └ allowResidualFor(${what}) 恰好回 [GAME_INLINE_STYLE]`,
      Array.isArray(allowResidualFor(label)) && allowResidualFor(label).length === 1 && allowResidualFor(label)[0] === GAME_INLINE_STYLE,
      JSON.stringify(allowResidualFor(label)).slice(0, 120));
}
// ⚠ 負對照（沒有這一組，A1 就只是「恆真」）：
const NEGATIVES = [
  ['別的路由', 'src/routes/friends/+page.svelte'],
  ['別的路由（Windows）', 'src\\routes\\friends\\+page.svelte'],
  ['空字串', ''],
  ['null', null],
  ['undefined', undefined],
  ['前綴黏住（xsrc/…）', 'xsrc/routes/game/+page.svelte'],
  ['尾巴多東西（.bak）', 'src/routes/game/+page.svelte.bak'],
  ['層級不對（少了 routes）', 'src/game/+page.svelte'],
  ['只是同名目錄', 'src/routes/game/settings/+page.svelte'],
];
for (const [what, label] of NEGATIVES) {
  chk(`A2 isGamePageLabel(${what}) === false`, isGamePageLabel(label) === false, String(label));
  chk(`  └ allowResidualFor(${what}) 回空陣列`, Array.isArray(allowResidualFor(label)) && allowResidualFor(label).length === 0, JSON.stringify(allowResidualFor(label)));
}
chk('A2x isGamePageLabel 不會對 null/undefined 丟例外（呼叫端可能拿到空 label）',
    attempt(() => { isGamePageLabel(null); isGamePageLabel(undefined); }).threw === false);

// ── A-3 ⭐ 負對照：把 v6.369 的**舊**正則原樣寫進來，證明本版真的修掉一個病灶（不是恆真）──
//   ⚠ 這一段是「病灶的標本」。它必須留在本檔裡，否則 A1/A2 無法證明「新判準比舊的多守到什麼」。
const V6369_OLD_RE = /(^|\/)src\/routes\/game\/\+page\.svelte$/;
chk('A3 舊正則（v6.369 test-v6297 L246）對 **POSIX** label 成立 ⇒ 它在 CI 上一直是對的',
    V6369_OLD_RE.test(POSIX_LABEL) === true);
chk('A3 ⭐ 舊正則對 **Windows** label === false ⇒ 本機 allowResidual 空掉 ＝ 本版修掉的病灶',
    V6369_OLD_RE.test(WIN_LABEL) === false);
chk('A3 ⭐ 新判準把這個差異補起來（同一個 Windows label ⇒ true）',
    isGamePageLabel(WIN_LABEL) === true && V6369_OLD_RE.test(WIN_LABEL) === false);

// ── A-4 ⭐⭐ 行為端：真的拿 game/+page.svelte 餵進 helper ────────────────────────
const GAME_REL = 'src/routes/game/+page.svelte';
const gameSrc = readRel(GAME_REL);
chk('A4 game/+page.svelte 讀得到且含唯一一處 GAME_INLINE_STYLE（前置條件，不然底下全是空轉）',
    gameSrc.length > 10000 && gameSrc.split(GAME_INLINE_STYLE).length === 2, String(gameSrc.length));
{
  const r1 = attempt(() => templateOnly(gameSrc, { label: WIN_LABEL, minSections: 1, allowResidual: allowResidualFor(WIN_LABEL) }));
  chk('A4 ⭐⭐ templateOnly(game, allowResidualFor(**Windows** label)) 不丟例外（＝(丙) 真的修好了）', r1.threw === false, r1.msg);
  const r2 = attempt(() => templateOnly(gameSrc, { label: POSIX_LABEL, minSections: 1, allowResidual: allowResidualFor(POSIX_LABEL) }));
  chk('A4 templateOnly(game, allowResidualFor(POSIX label)) 不丟例外', r2.threw === false, r2.msg);
  // ⭐ 護欄⑦ 必須還在守：宣告空白名單就要炸。沒有這一條，上面兩條可以靠「把護欄拿掉」造假。
  const r3 = attempt(() => templateOnly(gameSrc, { label: WIN_LABEL, minSections: 1, allowResidual: [] }));
  chk('A4 ⭐⭐⭐ allowResidual: [] **必須丟例外**（護欄⑦ 還在守，沒有被放寬）', r3.threw === true, '沒丟');
  chk('  └ 丟的是護欄⑦「模板層殘留標籤字面」那一條（不是別的錯）', r3.threw && /殘留/.test(r3.msg) && /allowResidual/.test(r3.msg), r3.msg);
  // ⭐ 負對照：allowResidualFor 對「不是 game」的 label 要回空 ⇒ 同一份原始碼必須炸。
  const r4 = attempt(() => templateOnly(gameSrc, { label: 'src/routes/friends/+page.svelte', minSections: 1, allowResidual: allowResidualFor('src/routes/friends/+page.svelte') }));
  chk('A4 ⭐⭐ 用**別的** label 取 allowResidual ⇒ 同一份 game 原始碼必須炸（allowResidualFor 不是恆回白名單）', r4.threw === true, '沒丟');
  // ⭐ 舊正則的行為端重現：用 v6.369 的判準跑 Windows label ⇒ 必炸（＝本機那幾條永久紅的成因）
  const oldAllow = V6369_OLD_RE.test(WIN_LABEL) ? [GAME_INLINE_STYLE] : [];
  const r5 = attempt(() => templateOnly(gameSrc, { label: WIN_LABEL, minSections: 1, allowResidual: oldAllow }));
  chk('A4 ⭐⭐⭐ HEAD-FAIL（判準層）：改用 v6.369 舊正則取 allowResidual ⇒ 同一個呼叫必炸', r5.threw === true, '沒丟');
}

// ── A-5 ⭐ 行為端（子行程）：(丙) 的三個呼叫端真的全綠 ───────────────────────────
const ENVPATH = process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\usr\\bin;' + (process.env.PATH || '')
  : (process.env.PATH || '');
function runGuard(rel, extraEnv = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, rel)], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, timeout: 1800000,
    env: { ...process.env, PATH: ENVPATH, ...extraEnv },
  });
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}
for (const rel of [V6297, 'scripts/test-v6187-safe-area-single-source.mjs', 'scripts/test-v6195-marquee-close-tap-target.mjs']) {
  const r = runGuard(rel);
  chk(`A5 ⭐⭐ 行為端：${rel.replace('scripts/', '')} 子行程 exit=0`, r.code === 0, r.out.slice(-400));
}

// ── A-6 ⭐ 收斂性（Rule 38：一個判準一份）────────────────────────────────────────
/** 列出 scripts/ 與 scripts/lib/ 底下所有 .mjs（相對 ROOT、一律用 `/`）。 */
function allScriptFiles() {
  const out = [];
  const walk = (dir, pre) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = pre + e.name;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(join(dir, e.name), rel + '/'); }
      else if (e.name.endsWith('.mjs')) out.push(rel);
    }
  };
  walk('scripts', 'scripts/');
  return out.sort();
}
/**
 * 偵測「自己判斷是不是 game/+page.svelte，再決定要不要塞 GAME_INLINE_STYLE」的散裝三元式。
 * ⚠ 判準：剝完註解之後，某處出現正則字面 `\+page\.svelte`（`\.` ⇒ 一定是正則而非普通字串），
 *   且同一段附近（±260 字元）同時出現 GAME_INLINE_STYLE 與三元運算子 `?`。
 */
function adHocGameAllow(src) {
  const s = strip(src);
  const hits = [];
  for (const m of s.matchAll(/\\\+page\\\.svelte/g)) {
    const w = s.slice(Math.max(0, m.index - 260), m.index + 260);
    if (/GAME_INLINE_STYLE/.test(w) && /\?/.test(w)) hits.push(w.replace(/\s+/g, ' ').trim().slice(0, 140));
  }
  return hits;
}
// Rule 25：掃描器先驗自己
chk('A6 ★ 掃描器正對照①：v6.369 test-v6297 的原句抓得到',
    adHocGameAllow(`    const allowResidual = /(^|\\/)src\\/routes\\/game\\/\\+page\\.svelte$/.test(label) ? [GAME_INLINE_STYLE] : [];`).length === 1);
chk('A6 ★ 掃描器正對照②：v6.369 test-v6187／v6195 的原句抓得到',
    adHocGameAllow(`  const allowResidual = /game[\\\\/]\\+page\\.svelte$/.test(file) ? [GAME_INLINE_STYLE] : [];`).length === 1);
chk('A6 ★ 掃描器負對照①：改走中央判準的寫法不算違規',
    adHocGameAllow(`  const allowResidual = allowResidualFor(file);`).length === 0);
chk('A6 ★ 掃描器負對照②：常數逐字比對（helper 自驗用，沒有第二份正則）不算違規',
    adHocGameAllow(`  const ar = p === P_GAME ? [GAME_INLINE_STYLE] : [];`).length === 0);
chk('A6 ★ 掃描器負對照③：註解裡寫的舊句子不算違規',
    adHocGameAllow(`  // const allowResidual = /(^|\\/)src\\/routes\\/game\\/\\+page\\.svelte$/.test(label) ? [GAME_INLINE_STYLE] : [];`).length === 0);
const SCAN_FILES = allScriptFiles();
chk('A6 ★ 掃描器有掃到東西（scripts/*.mjs >= 400 支）', SCAN_FILES.length >= 400, String(SCAN_FILES.length));
// ⚠ 唯一的排除是中央 helper 本身 —— 它就是那份「唯一判準」所在地（當然含正則＋GAME_INLINE_STYLE）。
//   ⭐ **本檔不排除自己**：本檔雖然留著 v6.369 舊正則的標本（A3），但那處附近沒有 GAME_INLINE_STYLE，
//     不構成「散裝三元式」；下面 A6x 會把這件事釘住 —— 哪天本檔真的長出那個形狀，一樣會被自己抓到。
const srcOf = new Map();
for (const rel of SCAN_FILES) { try { srcOf.set(rel, readRel(rel)); } catch { /* 下面斷言 */ } }
chk('A6 ★ scripts/*.mjs 全部讀得到', srcOf.size === SCAN_FILES.length, `${srcOf.size}/${SCAN_FILES.length}`);
const adHoc = [];
for (const [rel, src] of srcOf) {
  if (rel === HELPER) continue;
  for (const h of adHocGameAllow(src)) adHoc.push(rel + ' :: ' + h);
}
chk('A6 ⭐⭐ scripts/ 裡沒有第二份「自己判斷 game/+page.svelte 再塞 GAME_INLINE_STYLE」的散裝判準（本檔也在掃描範圍內）',
    adHoc.length === 0, JSON.stringify(adHoc));
// 排除清單不是空頭支票：被排除的那一支必須真的含有那個形狀，否則排除就是多餘的（＝掃描器已經抓不到東西了）。
chk('A6 ★ 排除理由可驗證：中央 helper 本身確實含那個判準', adHocGameAllow(srcOf.get(HELPER) || '').length >= 1);
chk('A6x ★ 本檔留的 v6.369 舊正則標本不會被自己誤判成散裝判準（附近沒有 GAME_INLINE_STYLE）',
    adHocGameAllow(srcOf.get(SELF) || '').length === 0 && /\\\+page\\\.svelte/.test(srcOf.get(SELF) || ''));
// ⭐ 下限斷言：呼叫端真的收斂到中央判準（>= 3 支）
const callers = [...srcOf].filter(([rel, src]) => rel !== HELPER && rel !== SELF && /allowResidualFor\s*\(/.test(strip(src))).map(([rel]) => rel).sort();
console.log('  呼叫 allowResidualFor 的檔案：' + callers.join('、'));
chk('A6 ⭐ 呼叫 allowResidualFor 的檔案數 >= 3（收斂真的發生了）', callers.length >= 3, String(callers.length));
chk('A6 ★ 中央 helper 同時匯出 isGamePageLabel 與 allowResidualFor',
    /export const isGamePageLabel\s*=/.test(srcOf.get(HELPER) || '') && /export const allowResidualFor\s*=/.test(srcOf.get(HELPER) || ''));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】(甲) 讀歷史一律走中央 helper base-blob.mjs —— 行為端 HEAD-FAIL');

// ── B-1 結構層（補充，Rule 28：只當補充，不當主要判準）────────────────────────
{
  const s = strip(readRel(V6365));
  chk('B1 test-v6365 import 了中央 helper lib/base-blob.mjs', /from\s+'\.\/lib\/base-blob\.mjs'/.test(s));
  chk('B1 test-v6365 用到 hasBaseCommit／readBaseBlob／shallowSkip 三支', /hasBaseCommit/.test(s) && /readBaseBlob/.test(s) && /shallowSkip/.test(s));
  chk('B1 ⭐ test-v6365 剝完註解後**零個 `git` 字面**（＝不再自己 shell out）', /['"]git['"]/.test(s) === false, (s.match(/.{0,40}['"]git['"].{0,40}/) || [''])[0]);
  chk('B1 test-v6365 不再 import node:child_process', /child_process/.test(s) === false);
  // 負對照：偵測器不是恆真 —— 對真的含 git 字面的樣本要抓得到
  chk('B1 ★ 負對照：偵測器對 `execFileSync(\'git\', …)` 樣本抓得到', /['"]git['"]/.test(strip(`const r = execFileSync('git', ['show', X]);`)) === true);
}

// ── B-2 ⭐⭐⭐ HEAD-FAIL（行為端）──────────────────────────────────────────────
//   把 test-v6365 暫時換成 BASE(v6.369) 的內容 ⇒ 再跑 test-v6263 ⇒ **必須紅在 ②**。
//   ⚠ 拿不到歷史（CI 淺複製）⇒ shallowSkip，**絕不動工作樹**。
//   ⚠ try/finally ＋ process.on('exit') 雙保險還原；還原後逐位元比對 sha 並重跑確認 exit=0。
const HAS_BASE = hasBaseCommit(ROOT, BASE_SHA);
let v6263Out = null, v6263Code = null;
if (!HAS_BASE) {
  skipped++;
  shallowSkip('test-v6370【B-2】HEAD-FAIL：把 test-v6365 換成 v6.369 內容後 test-v6263 ② 必紅',
    `物件庫裡沒有 ${BASE_SHA.slice(0, 8)}（fetch-depth:1 淺複製）`);
  const r = runGuard(V6263);
  v6263Out = r.out; v6263Code = r.code;
  chk('B2(skip 版) test-v6263 現況 exit=0', r.code === 0, r.out.slice(-400));
} else {
  const nowSrc = readRel(V6365);
  const nowSha = sha12(nowSrc);
  const blob = readBaseBlob(ROOT, BASE_SHA, V6365);
  chk('B2 讀得到 BASE(v6.369) 的 test-v6365 內容', blob.ok && blob.out.length > 1000, String(blob.out.length));
  const crlf = nowSrc.includes('\r\n');
  const baseSrc = crlf ? blob.out.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : blob.out.replace(/\r\n/g, '\n');
  chk('B2 ⭐ BASE 內容與現況**不同**（否則整段 HEAD-FAIL 是空轉）', blob.ok && baseSrc !== nowSrc, `base=${sha12(baseSrc)} now=${nowSha}`);
  if (blob.ok && baseSrc !== nowSrc) {
    const restore = () => { try { writeFileSync(join(ROOT, V6365), nowSrc, 'utf8'); } catch { /* 盡力而為 */ } };
    process.on('exit', restore);                 // 保險①：行程被打斷也還原
    let baseCode = null, baseOut = '';
    try {
      writeFileSync(join(ROOT, V6365), baseSrc, 'utf8');
      const r = runGuard(V6263);
      baseCode = r.code; baseOut = r.out;
    } finally {
      restore();                                 // 保險②：正常路徑
    }
    const back = readRel(V6365);
    chk('B2 ⭐ 還原後內容**逐位元相同**', back === nowSrc, `now=${nowSha} back=${sha12(back)}`);
    chk('B2 ⭐⭐⭐ HEAD-FAIL：test-v6365 換成 v6.369 內容後，test-v6263 必須紅（exit != 0）', baseCode !== 0, 'exit=' + baseCode);
    const redLine = baseOut.split(/\r?\n/).find((l) => /^\s*FAIL /.test(l) && l.includes('走中央 helper 就是在白名單裡'));
    chk('B2 ⭐⭐⭐ 紅的是 test-v6263 ② 那一條，且訊息指名 test-v6365', !!redLine && redLine.includes('test-v6365'), (redLine || '(找不到那條 FAIL)').slice(0, 240));
    // ⭐ 還原後複驗（沒有這一條，上面的 HEAD-FAIL 可能是把工作樹弄壞了才紅）
    const again = runGuard(V6263);
    v6263Out = again.out; v6263Code = again.code;
    chk('B2 ⭐⭐ 還原後重跑 test-v6263 ⇒ exit=0（證明剛才的紅是 BASE 內容造成的）', again.code === 0, again.out.slice(-400));
  } else {
    const r = runGuard(V6263);
    v6263Out = r.out; v6263Code = r.code;
    chk('B2 test-v6263 現況 exit=0', r.code === 0, r.out.slice(-400));
  }
}
// ── B-4 ⭐ 補 test-v6263 ② 的一個洞（本版 mutcheck M5 實測撞到）────────────────
//   ② 的成員判準是 `files.get(rel).includes('lib/base-blob.mjs')` —— 在**含註解**的原始碼上找字面。
//   ⇒ 只要在註解裡寫一句「走中央 helper `scripts/lib/base-blob.mjs`」，就可以一邊自己 shell out 到
//     git、一邊躲過 ②（v6.370 的 test-v6365 註解剛好就有這一句 ⇒ 突變回舊寫法時 ② 竟然不紅）。
//   這裡改用「**真的有 import 語句**」當判準：註解不算數，而且不依賴 naive 剝註解（`/* */` 的貪吃問題）。
{
  const IMPORT_RE = /^[ \t]*import\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*from\s*'[^']*lib\/base-blob\.mjs'\s*;?/m;
  const gitCallsIn = (src) => [...strip(src).matchAll(/(?:execFileSync|execSync|spawnSync|exec)\s*\(\s*['"]git['"]/g)].map((m) => m[0]);
  const hasHistSha = (src) => /['"][0-9a-f]{40}['"]/.test(strip(src));
  const v6263src = readRel(V6263);
  const allowBlock = v6263src.slice(v6263src.indexOf('const ALLOW = new Map(['), v6263src.indexOf('const offenders'));
  const ALLOW = [...allowBlock.matchAll(/\['(scripts\/[^']+)'/g)].map((m) => m[1]);
  chk('B4 ★ 解析得到 test-v6263 ② 的白名單（>= 4 支）', ALLOW.length >= 4, JSON.stringify(ALLOW));
  const chain2 = [...new Set(String(JSON.parse(readRel('package.json')).scripts.test)
    .split('&&').map((x) => x.trim().replace(/^node\s+/, '')).filter(Boolean))];
  const gitUsers = [], histUsers = [];
  for (const rel of chain2) {
    let src = '';
    try { src = readRel(rel); } catch { continue; }
    if (gitCallsIn(src).length === 0) continue;
    gitUsers.push(rel);
    if (hasHistSha(src)) histUsers.push(rel);
  }
  chk('B4 ★ 掃描器有掃到東西（chain 裡自己呼叫 git 的腳本 >= 1）', gitUsers.length >= 1, String(gitUsers.length));
  chk('B4 ★ 掃描器有掃到東西（其中寫死 40 位歷史 sha 的 >= 5）', histUsers.length >= 5, String(histUsers.length));
  const noImport = histUsers.filter((rel) => rel !== V6263 && !ALLOW.includes(rel) && !IMPORT_RE.test(readRel(rel)));
  chk('B4 ⭐⭐ 讀歷史的腳本必須真的有 base-blob 的 **import 語句**（在註解裡提到路徑不算數）',
      noImport.length === 0, JSON.stringify(noImport));
  chk('B4 ★ 偵測器正對照：真的 import 語句判為有',
      IMPORT_RE.test("import { hasBaseCommit } from './lib/base-blob.mjs';\n") === true);
  chk('B4 ★ 偵測器負對照①：只有註解提到路徑 ⇒ 判為沒有',
      IMPORT_RE.test("//   走中央 helper `scripts/lib/base-blob.mjs`\nconst x = 1;\n") === false);
  chk('B4 ★ 偵測器負對照②：字串字面提到路徑 ⇒ 判為沒有',
      IMPORT_RE.test("const HELPER = 'lib/base-blob.mjs';\n") === false);
}
chk('B3 ⭐⭐ 行為端：test-v6263 子行程現況 exit=0（＝CI build job 的那條紅燈已經消失）', v6263Code === 0, String(v6263Code));
chk('B3 test-v6263 ② 那一條在現況是 PASS',
    v6263Out.split(/\r?\n/).some((l) => /^\s*PASS /.test(l) && l.includes('走中央 helper 就是在白名單裡')), '找不到 PASS');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】(乙) ④⑤ 的平台跳過：只准 Windows，POSIX（＝CI）不准跳過');
const WIN = process.platform === 'win32';
const hasSkipMark = /PLATFORM-SKIP/.test(v6263Out || '');
const linePass = (frag) => (v6263Out || '').split(/\r?\n/).some((l) => /^\s*PASS /.test(l) && l.includes(frag));
if (WIN) {
  chk('C1 ⭐⭐ Windows：test-v6263 必須印出 PLATFORM-SKIP（大聲宣告「這一段沒有在守」）', hasSkipMark === true);
  chk('C1 Windows：宣告文字要指名守門人是 CI',
      /守門人是 CI/.test(v6263Out || '') && /ubuntu/.test(v6263Out || ''));
} else {
  chk('C1 ⭐⭐⭐ POSIX（CI）：test-v6263 **不准**出現 PLATFORM-SKIP（④⑤ 必須真的跑）', hasSkipMark === false);
  chk('C1 ⭐⭐ POSIX：`★ shim 自身有效` 那一條必須 PASS（shim 真的套得上）', linePass('★ shim 自身有效'));
  chk('C1 ⭐⭐ POSIX：④ 的行為端對照真的跑過（輸出要有 v6224 的真環境那一條）',
      linePass('test-v6224-deck-import-timeout.mjs：真環境'));
  chk('C1 ⭐⭐ POSIX：⑤ 的突變測試真的跑過', linePass('改壞回應訊息後在**淺複製環境下也會紅**'));
}
// 兩個平台都必須成立的正對照（(乙) 新增的那兩條）
chk('C2 ⭐⭐ 正對照①「④⑤ 行為端在 POSIX 一定要真的執行過」必須 PASS', linePass('④⑤ 行為端在 POSIX 一定要真的執行過'));
chk('C2 ⭐⭐ 正對照②「Windows 跳過的理由實測成立」必須 PASS', linePass('Windows 跳過的理由實測成立'));

// ── C-3 結構層（補充）：WIN 的定義不得被改成看環境變數／CI 旗標 ────────────────
{
  const s = strip(readRel(V6263));
  const winDefs = [...s.matchAll(/\bWIN\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim());
  chk('C3 test-v6263 裡 WIN 只被定義一次', winDefs.length === 1, JSON.stringify(winDefs));
  chk("C3 ⭐⭐ WIN 的定義只能是 `process.platform === 'win32'`（不得改成看環境變數／CI 旗標）",
      winDefs.length === 1 && winDefs[0] === "process.platform === 'win32'", JSON.stringify(winDefs));
  chk('C3 ★ 負對照：偵測器對 `WIN = process.env.SKIP_SHIM === \'1\'` 這種寫法抓得到',
      (() => { const d = [...strip(`const WIN = process.env.SKIP_SHIM === '1';`).matchAll(/\bWIN\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim());
               return d.length === 1 && d[0] !== "process.platform === 'win32'"; })());
  chk('C3 跳過分支確實是 `if (WIN) {`（不是別的條件）', /\bif\s*\(\s*WIN\s*\)\s*\{/.test(s));
  chk('C3 ⭐ 正對照① 的實作是 `WIN || ranBehaviour`（POSIX 上唯一能讓它綠的方式就是真的跑過）',
      /WIN \|\| ranBehaviour/.test(s));
  chk('C3 ★ ranBehaviour 初值必須是 false（否則正對照① 恆真）', /let\s+ranBehaviour\s*=\s*false\s*;/.test(s));
  chk('C3 ★ ranBehaviour 全檔只有一處被設成 true（＝④⑤ 真的跑完才算數）',
      s.split(/ranBehaviour\s*=\s*true/).length === 2, String(s.split(/ranBehaviour\s*=\s*true/).length - 1));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】本守衛自己必須在 npm test chain 裡');
{
  const pkg = JSON.parse(readRel('package.json'));
  const chain = String(pkg.scripts.test || '').split('&&').map((s) => s.trim()).filter(Boolean);
  chk('D1 package.json 的 scripts.test 解析得到 >= 400 步', chain.length >= 400, String(chain.length));
  const mine = chain.filter((s) => s === 'node scripts/test-v6370-guard-integrity.mjs');
  chk('D1 ⭐ scripts.test 裡**恰好**有本檔一次（拆解比對，不是 grep 整串）', mine.length === 1, String(mine.length));
  chk('D1 ★ 負對照：同樣的拆解法對不存在的步驟要回 0',
      chain.filter((s) => s === 'node scripts/test-v9999-does-not-exist.mjs').length === 0);
  chk('D1 chain 裡每一步都是 `node scripts/xxx.mjs` 的形狀（沒有被塞進奇怪的 shell 片段）',
      chain.every((s) => /^node scripts\/[\w.\-]+\.mjs$/.test(s)), JSON.stringify(chain.filter((s) => !/^node scripts\/[\w.\-]+\.mjs$/.test(s)).slice(0, 3)));
  chk('D1 本檔在 chain 裡宣告的路徑真的存在', existsSync(join(ROOT, SELF)) && statSync(join(ROOT, SELF)).size > 3000);
}

console.log(`\n[v6370-guard-integrity] PASS ${n - bad} / FAIL ${bad}` + (skipped ? ` / SHALLOW-SKIP ${skipped}` : ''));
process.exit(bad ? 1 : 0);
