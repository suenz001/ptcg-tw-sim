// 量測腳本（鐵律 Rule 32）：v6.325 批 2「遷移前後輸出等價性」的**方向性**分類。
//
// ⚠ 「逐位元相同」這個目標本身要先講清楚：中央 helper 的等長留白版把行首 `//` 換成**等寬空白**
//   （為了保住行號／位移），舊自寫版則把它砍成只剩縮排 ⇒ **空白字元數必然不同**。
//   所以比較的單位一律是「**該行去掉 ASCII 空白之後的字元序列**」。
//
// 每一行差異分三類（⭐ 只有 C 類是危險方向）：
//   A【救回】old 空、new 有碼  ⇒ 舊剝除器把真程式碼吃掉了（＝洞）。新版救回。
//   B【保守保留】old 有碼、new 多了行**中**的 `/*…*/` 內容
//     ⇒ 中央 helper 只在**行首**開區塊，行中的 `/*` 一律保留（v6.312 明寫的假紅方向取捨）。
//   C【新版吃更多】old 有碼、new 空或更短，且不是 B ⇒ ⚠ 危險方向，必須逐條交代。
//
// 用法：node scripts/measure-v6325-equiv.mjs <repoRoot>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = process.argv[2] || '.';
const WS = /[ \t\r\n\f\v]/g;
const ZW = /[\u200b-\u200d\ufeff]/g;
const nw = (s) => String(s).replace(WS, '');

const oldA = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
const newA = (s) => stripCommentsBlank(s).replace(/\/\/.*$/gm, '');
const oldB = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/\/\/.*$/gm, '').replace(ZW, '');
const newB = (s) => stripCommentsBlank(s).replace(/\/\/.*$/gm, '').replace(ZW, '');
const oldC = (s) => s.replace(ZW, '').replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
  .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.split('//')[0])).join('\n');
const newC = (s) => stripCommentsBlank(s.replace(ZW, '')).split('\n').map((l) => l.split('//')[0]).join('\n');
const oldD = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const newD = (s) => stripCommentsBlank(s);

const PAIRS = {
  A: [oldA, newA, 'line'], B: [oldB, newB, 'line'], C: [oldC, newC, 'line'],
  // ⚠ D（v6262）舊版是**刪除**區塊註解 ⇒ 後面所有行整體上移，逐行對齊沒有意義。
  //   改比「整份去空白後的字元序列」——這正是 v6262 那些 `.test()` / `.match()` 斷言消費的東西。
  D: [oldD, newD, 'whole'],
};

const TARGETS = {
  'test-v6202': ['A', { dirs: ['src/lib/game'] }],
  'test-v6211': ['B', { dirs: ['src/lib/game/effects'], files: ['src/lib/game/effects.ts', 'src/lib/game/engine.ts'] }],
  'test-v6253': ['A', { files: ['src/lib/game/engine.ts', 'src/lib/game/effects/cards/v3001_g3_wave3.ts'] }],
  'test-v6255': ['A', { files: ['src/lib/game/engine.ts', 'src/lib/game/effects.ts', 'src/lib/game/types.ts', 'src/lib/game/effects/_shared.ts', 'src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts', 'scripts/test-v6253-nullifier-and-survive.mjs'] }],
  'test-v6256': ['A', { files: ['src/lib/game/engine.ts', 'src/lib/game/effects.ts', 'src/lib/game/effects/_shared.ts', 'src/lib/game/types.ts', 'src/lib/game/effects/cards/v2690_i_wave19_engine_hooks.ts', 'src/lib/game/effects/cards/mega_decks.ts'] }],
  'test-v6257': ['C', { dirs: ['src'] }],
  'test-v6258': ['C', { dirs: ['src'] }],
  'test-v6262': ['D', { files: ['src/lib/game/effects.ts', 'src/lib/game/effects/cards/supporters_gust.ts', 'src/lib/game/effects/cards/v172_hij_batch.ts', 'src/lib/game/effects/cards/m5_preview.ts', 'src/lib/game/effects/cards/v2370_mp_promo.ts', 'src/lib/game/engine.ts'] }],
};

const walk = (d, re, out = []) => {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === '.git') continue;
    const q = join(d, e);
    if (statSync(q).isDirectory()) walk(q, re, out); else if (re.test(e)) out.push(q);
  }
  return out;
};
/** B 類：new 多出來的字元全部是行**中**的 `/*…*​/` ⇒ 把它們拿掉就等於 old（保守保留，假紅方向）。 */
const isConservativeKeep = (rawLine, oldTxt, newTxt) =>
  newTxt.length > oldTxt.length && nw(newTxt.replace(/\/\*[\s\S]*?\*\//g, '')) === oldTxt;
/** B2 類：old 多出來的字元全部是 `<!--…-->` ⇒ new 把 HTML 註解也剝掉了（它本來就是註解，正確方向）。 */
const isHtmlCommentStrip = (rawLine, oldTxt, newTxt) =>
  oldTxt.length > newTxt.length && nw(oldTxt.replace(/<!--[\s\S]*?-->/g, '')) === newTxt
  && /<!--/.test(rawLine);

let tot = { A: 0, B: 0, C: 0, wholeSame: 0, wholeDiff: 0 };
for (const [guard, [pk, cfg]] of Object.entries(TARGETS)) {
  const [oldFn, newFn, mode] = PAIRS[pk];
  const set = new Set(cfg.files ?? []);
  for (const d of cfg.dirs ?? []) for (const p of walk(join(ROOT, d), /\.(ts|svelte)$/)) set.add(relative(ROOT, p).split('\\').join('/'));
  let same = 0, ca = 0, cb = 0, cc = 0; const risky = [];
  for (const rel of [...set].sort()) {
    let src; try { src = readFileSync(join(ROOT, rel), 'utf8'); } catch { continue; }
    const O = oldFn(src), N = newFn(src);
    if (mode === 'whole') {
      // 整份去空白後的字元序列：new 必須是 old 的**超集且保序**（新版只會多救回真碼／多保留行中註解）
      const o = nw(O), n = nw(N);
      if (o === n) { same++; tot.wholeSame++; continue; }
      tot.wholeDiff++;
      let i = 0, j = 0, extra = 0, missing = 0;
      while (i < o.length && j < n.length) { if (o[i] === n[j]) { i++; j++; } else { j++; extra++; if (extra > n.length) break; } }
      missing = o.length - i;
      console.log(`   · ${rel}：old ${o.length} 字元 → new ${n.length}；new 多出 ${extra + (n.length - j)} 字元，old 有而 new 沒有 ${missing} 字元 ${missing === 0 ? '✅（超集，方向安全）' : '⚠'}`);
      continue;
    }
    const a = O.split('\n'), b = N.split('\n'), raw = src.split('\n');
    // B3 類：整行落在**多行** `<!-- … -->` 之內 ⇒ 新版剝掉它是正確的（它就是註解），
    //   舊的 C 型剝除器完全不處理 HTML 註解。只在 .svelte 出現。
    const inHtml = new Set();
    for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) {
      const s0 = src.slice(0, m.index).split('\n').length;
      for (let k = s0; k < s0 + m[0].split('\n').length; k++) inHtml.add(k);
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const ot = nw(a[i] ?? ''), nt = nw(b[i] ?? '');
      if (ot === nt) continue;
      if (ot === '' && nt !== '') ca++;
      else if (isConservativeKeep(raw[i] ?? '', ot, nt) || isHtmlCommentStrip(raw[i] ?? '', ot, nt)
               || (nt === '' && inHtml.has(i + 1))) cb++;
      else { cc++; if (risky.length < 8) risky.push(`${rel}:${i + 1}  old=${JSON.stringify(ot.slice(0, 70))}  new=${JSON.stringify(nt.slice(0, 70))}`); }
    }
    if (nw(O) === nw(N)) same++;
  }
  tot.A += ca; tot.B += cb; tot.C += cc;
  if (mode !== 'whole') {
    console.log(`${cc === 0 ? '🟢' : '🔴'} ${guard.padEnd(11)} 掃 ${String(set.size).padStart(3)} 檔｜A救回 ${ca} 行｜B保守保留 ${cb} 行｜⭐C新版吃更多 ${cc} 行`);
    for (const r of risky) console.log(`      ⚠ ${r}`);
  } else {
    console.log(`🟢 ${guard.padEnd(11)} 掃 ${String(set.size).padStart(3)} 檔（整份比對，見上）`);
  }
}
console.log(`\n合計：A救回 ${tot.A} 行｜B保守保留 ${tot.B} 行｜⭐C新版吃更多 ${tot.C} 行（必須為 0）`);
