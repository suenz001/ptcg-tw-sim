// v6.027 Check U — 「filter 產能」守衛：抓出**永遠選不到任何卡**的 pending filter。
//
// 為什麼需要這張網（已重複發生兩次的 bug 類別）：
//   ① v3.58：'Pokemon:脫殼忍者' 被 generic 'Pokemon:<屬性>' handler 吃掉 → 比對 pokemonType==='脫殼忍者'
//      永遠 false → 玩家看不到任何候選卡。
//   ② v5.155～v6.025：火箭隊的瓦斯彈｜警備濁霧用 'NameContains:瓦斯彈'，但該 filter 是化石採掘場的
//      專用語義（只列**物品卡**）→ 要搜寶可夢一張都篩不出來 → 空 picker → 玩家體感「特性沒發動」。
//   兩次的共通點：**引擎完全正常、pending 有開、所有既有測試全綠**，只有 picker 是空的。
//   本測試從「現役卡池」這一側檢查：若某 filter 對全卡池零張回 true，它必定開出空視窗。
//
// 判定規則：
//   A. 中央 evaluator 可求值的 filter → 現役卡池零產能即 FAIL。
//   B. filter 的「值」含中文（＝卡名字串型）卻未被中央 evaluator 收錄 → FAIL。
//      （這種最危險：值是卡名，一旦卡型條件對不上就零產能，而 fallthrough 讓中央看不到它。）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.fyc-e.ts'), O = join(ROOT, '.fyc-o.mjs');
process.on('exit', () => { for (const p of [E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(E, "export { evaluateSelectionFilter } from './src/lib/game/selection-filter';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib') }, logLevel: 'error' });
const { evaluateSelectionFilter: ev } = await import(pathToFileURL(O).href);

// 現役卡池（index.json 列出的卡包）
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const cards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) cards.push(c);
}

// 掃 effects 端所有 pending filter 字面量（與 Check S 同一抓法）
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name)) files.push(p);
  }
})(join(ROOT, 'src/lib/game'));
const re = /type:\s*'(deck-search|hand-discard|discard-search)'[\s\S]{0,600}?filter:\s*'([^']+)'/g;
const found = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(src)) !== null) {
    const key = m[1] + '|' + m[2];
    if (!found.has(key)) found.set(key, { zone: m[1], fl: m[2], file: f.slice(ROOT.length).replace(/^[/\\]/, '').replace(/\\/g, '/'), line: src.slice(0, m.index).split('\n').length });
  }
}

// 值含中文＝卡名字串型 filter（危險類：卡名與卡型條件不符就零產能）
const hasCJK = (s) => /[一-鿿]/.test(s);

const violations = [];
let okCount = 0, uncoveredCount = 0;
for (const [, info] of found) {
  let yields = 0, evaluable = false;
  for (const c of cards) {
    const r = ev(info.zone, info.fl, { iid: 'x' }, c, {});
    if (r === true) { yields++; evaluable = true; } else if (r === false) evaluable = true;
  }
  const where = `${info.file}:${info.line}`;
  if (evaluable) {
    if (yields === 0) {
      violations.push(`[U] ${where} — filter '${info.fl}'(${info.zone}) 在現役卡池**零產能**：一張卡都選不到 → picker 必定是空視窗，`
        + `玩家體感「效果沒發動」而引擎測試照樣全綠。請對照卡面確認 filter 的卡型語義（是要寶可夢？物品卡？能量？）與卡名是否相符。`);
    } else okCount++;
  } else {
    uncoveredCount++;
    if (hasCJK(info.fl)) {
      violations.push(`[U] ${where} — filter '${info.fl}'(${info.zone}) 的值是**卡名字串**卻未被中央 selection-filter 收錄 → `
        + `會掉 UI/AI 各自的 inline fallthrough，中央看不到它、產能守衛也驗不到（歷史上這正是「Pokemon:脫殼忍者」與`
        + `「NameContains:瓦斯彈」兩次空 picker 的來源）。請把 predicate 收進 selection-filter.ts。`);
    }
  }
}

console.log(`filter 產能守衛：掃描 ${found.size} 個 filter 字面量｜有產能 ${okCount}｜中央未收錄(非卡名型，走 fallthrough) ${uncoveredCount}`);
if (violations.length === 0) {
  console.log('✅ 無零產能 filter（沒有「開出來就是空的」選卡視窗）');
  process.exit(0);
}
console.log(`❌ 發現 ${violations.length} 處問題\n`);
for (const v of violations) console.log('  ' + v);
process.exit(1);
