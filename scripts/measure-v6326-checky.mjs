// 量測腳本（鐵律 Rule 32：效能／等價性數字必附量測腳本）：
//   v6.326 批 3「anti-pattern-lint Check Y 的剝除器遷移」的三項證明，全部**唯讀**、不寫任何檔。
//
//   ① 命中集合逐項相同：遷移前後 `regG('…')` 的 (檔|卡名) 多重集合完全一致（不是只比總數）。
//   ② 行號正確性：舊剝除器把區塊註解**整段刪掉**（含換行）⇒ 違規訊息的行號整體上移；
//      新的等長留白版行號直接對得回原檔。這裡逐筆比對並印出錯了幾筆。
//   ③ 洞內注入：把一個**真違規**（`regG('皮卡丘')`，皮卡丘是寶可夢）注入 effects.ts 的假區塊之內，
//      舊剝除器數不到（假綠）、新剝除器抓得到 —— 這就是這一支的**真 HEAD-FAIL**。
//      ⚠ 本腳本是在記憶體裡複刻 Check Y 的 regex 迴圈（唯讀）；跑真 lint 子行程的版本
//        （含 rc 與訊息）記在 docs/changelog-internal.md 的 v6.326 那一節。
//
// 用法：node scripts/measure-v6326-checky.mjs
import { readFileSync as _R, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const readFileSync = (p) => _R(p, 'utf8').replace(/\r\n?/g, '\n');
const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : (e.endsWith('.ts') && o.push(p)); } return o; };
const files = walk(join(ROOT, 'src/lib/game'));
const rel = (f) => f.slice(ROOT.length).split('\\').join('/');

/** 遷移前：Check Y 自寫的貪婪區塊正則（第 13 種安慰劑）。 */
const OLD = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
/** 遷移後：中央 helper 的等長留白版 ＋ 原本那一條行尾 `//`（逐字相同，不放寬）。 */
const NEW = (s, label) => stripCommentsBlankChecked(s, { label }).replace(/(^|[^:])\/\/.*$/gm, '$1');
const RE = /\bregG\(\s*'([^']+)'/g;

const hits = (strip) => {
  const out = [];
  for (const f of files) {
    const src = strip(readFileSync(f), rel(f));
    for (const m of src.matchAll(RE)) out.push({ file: rel(f), name: m[1], line: src.slice(0, m.index).split('\n').length });
  }
  return out;
};
const a = hits(OLD), b = hits(NEW);
const key = (x) => x.file + '|' + x.name;
const sa = a.map(key).sort(), sb = b.map(key).sort();
console.log(`① 命中數：舊 ${a.length} → 新 ${b.length}`);
console.log(`   (檔|卡名) 多重集合逐項相同：${JSON.stringify(sa) === JSON.stringify(sb) ? '✅ 是' : '❌ 否'}`);
const A = new Set(sa), B = new Set(sb);
console.log(`   只在舊：${[...A].filter((x) => !B.has(x)).join(', ') || '(無)'}`);
console.log(`   只在新：${[...B].filter((x) => !A.has(x)).join(', ') || '(無)'}`);

// ② 行號：以「原檔裡該 regG 呼叫真正在第幾行」為裁判
let okOld = 0, okNew = 0, worst = null;
const rawLines = new Map();
for (const f of files) rawLines.set(rel(f), readFileSync(f).split('\n'));
for (let i = 0; i < b.length; i++) {
  const truth = rawLines.get(b[i].file).findIndex((l, k) => k + 1 >= 1 && new RegExp("\\bregG\\(\\s*'" + b[i].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(l)) + 1;
  if (a[i].line === truth) okOld++;
  if (b[i].line === truth) okNew++;
  const d = Math.abs(a[i].line - truth);
  if (!worst || d > worst.d) worst = { d, ...b[i], truth, old: a[i].line };
}
console.log(`② 行號正確筆數：舊 ${okOld}/${a.length}、新 ${okNew}/${b.length}；舊版最大偏差 ${worst.d} 行`
  + `（${worst.file} regG('${worst.name}') 實際 :${worst.truth}，舊報 :${worst.old}）`);

// ③ 洞內注入（記憶體）：真違規放進 effects.ts 的假區塊之內 ⇒ 舊版數不到、新版數得到
const EFF = 'src/lib/game/effects.ts';
const effSrc = readFileSync(join(ROOT, EFF));
const INJ = "const _y6326 = () => regG('皮卡丘', () => true);";
const countPika = (s) => (s.match(/\bregG\(\s*'皮卡丘'/g) || []).length;
for (const [where, ln] of [['洞內（:27 假區塊）', 55], ['洞內（:7905 假區塊）', 8125], ['洞外（對照組）', 9000]]) {
  const L = effSrc.split('\n'); L.splice(ln, 0, INJ);
  const s = L.join('\n');
  const o = countPika(OLD(s)), n = countPika(NEW(s, EFF));
  console.log(`③ 注入 ${EFF}:${ln + 1} ${where}：舊剝除器數到 ${o} 個（${o ? '抓得到' : '❌ 假綠'}）／新剝除器數到 ${n} 個（${n ? '✅ 抓得到' : '漏'}）`);
}
