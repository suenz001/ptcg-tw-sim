#!/usr/bin/env node
/**
 * v6.569 守衛：對戰紀錄裡的玩家暱稱不可以變成卡片連結（站長 2026-10-15 回報：
 *   「如果玩家的暱稱取跟寶可夢相同的名字，會導致對戰log的玩家名稱也可以被點選，連結到寶可夢卡片，這蠻奇怪的」）。
 *   根因：log_format.ts 的卡名子掃描對所有純文字做「最長卡名優先」比對，不知道哪一段是玩家暱稱。
 *
 *   T：tokenizeLogMessage 實跑（同名、暱稱含卡名、較長卡名照樣是連結、marker 卡片照樣是連結、1 字暱稱、沒傳暱稱＝舊行為）
 *   W：三個顯示處（桌機紀錄欄、手機直式、錦標賽戰報）都把雙方暱稱傳進去
 *   【H】BASE（v6.568）逐條紅；零回歸條目在 BASE 上也要綠
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.568。
const BASE_SHA = '2135db938fe4694760e7d15d7bbe1a63f040eba7';
const LF = 'src/lib/game/log_format.ts', PG = 'src/routes/game/+page.svelte', MP = 'src/routes/game/MobilePortraitBattle.svelte';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

async function loadLib(src) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6569-'));
  try {
    const f = join(tmp, 'lf.ts'); writeFileSync(f, src);
    const o = join(tmp, 'o.mjs');
    await build({ entryPoints: [f], outfile: o, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    return await import(pathToFileURL(o).href);
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
const CARDS = ['噴火龍ex', '皮卡丘ex', '噴火龍', '皮卡丘', '雷丘', '伊布'].sort((a, b) => b.length - a.length);
const links = (toks) => toks.filter((t) => t.cls === 'log-card-link').map((t) => t.text);
const joined = (toks) => toks.map((t) => t.text).join('');

function scenT(L) {
  const r = {};
  if (!L || typeof L.tokenizeLogMessage !== 'function') return r;
  const tk = (m, names) => L.tokenizeLogMessage(m, CARDS, names);
  // T1 同名：暱稱「皮卡丘」⇒ 開頭的玩家名稱不是連結；後面的卡名照樣是連結
  const a = tk('皮卡丘 使用了 噴火龍ex 的招式', ['皮卡丘', '小明']);
  r.T1 = JSON.stringify(links(a)) === '["噴火龍ex"]' && joined(a) === '皮卡丘 使用了 噴火龍ex 的招式';
  r.T1n = JSON.stringify(a);
  // T2 暱稱裡含卡名：「我的噴火龍」不可以切出「噴火龍」連結
  const b = tk('回合結束，換 我的噴火龍 行動', ['小明', '我的噴火龍']);
  r.T2 = links(b).length === 0 && joined(b) === '回合結束，換 我的噴火龍 行動';
  r.T2n = JSON.stringify(b);
  // T3 卡名比暱稱長（暱稱「噴火龍」、卡名「噴火龍ex」）⇒ 卡名照樣是連結；暱稱那一段不是
  const c = tk('噴火龍 派出了 噴火龍ex', ['噴火龍', '小明']);
  r.T3 = JSON.stringify(links(c)) === '["噴火龍ex"]';
  r.T3n = JSON.stringify(c);
  // T4 marker（帶 iid 的卡片）一律照樣是連結，即使名字跟暱稱一樣
  const d = tk('皮卡丘 的 iid-1皮卡丘 受到 30 點傷害', ['皮卡丘', '小明']);
  r.T4 = JSON.stringify(d.filter((t) => t.cls === 'log-card-link').map((t) => [t.text, t.iid])) === '[["皮卡丘","iid-1"]]';
  r.T4n = JSON.stringify(d);
  // T5 零回歸：沒傳暱稱 ⇒ 與舊行為一樣（暱稱位置也是連結）；1 字暱稱、空白、null 不影響卡名
  const e = tk('皮卡丘 使用了 噴火龍ex', undefined);
  const f = tk('雷 派出 雷丘', ['雷', null, '  ', undefined]);
  r.T5 = JSON.stringify(links(e)) === '["皮卡丘","噴火龍ex"]' && JSON.stringify(links(f)) === '["雷丘"]';
  r.T5n = JSON.stringify({ e: links(e), f: links(f) });
  // T6 暱稱前後有空白也認得（儲存的暱稱可能帶空白）；兩位玩家同名只處理一次
  const g = tk('伊布 對 伊布 宣告棄權', [' 伊布 ', '伊布']);
  const g2 = tk('伊布 行動', [' 伊布 ', '小明']);   // 只有帶空白的那一份 ⇒ 要靠 trim 才認得
  r.T6 = links(g).length === 0 && joined(g) === '伊布 對 伊布 宣告棄權' && links(g2).length === 0
    && JSON.stringify(L.logProtectedNames?.([' 伊布 ', '伊布', '雷', null, '小明'])) === '["伊布","小明"]';
  r.T6n = JSON.stringify(g);
  return r;
}

function scenW(pg, mp) {
  return {
    W1: /let logPlayerNames = \$derived\(\[game\?\.players\?\.\[0\]\?\.name, game\?\.players\?\.\[1\]\?\.name\]\);/.test(pg)
      && pg.includes("{@const _tokens = tokenizeLogMessage(_msgText ?? '', cardNamesSorted, logPlayerNames)}"),
    W2: mp.includes("{@const _tokens = tokenizeLogMessage(_msgText ?? '', cardNamesSorted, [game?.players?.[0]?.name, game?.players?.[1]?.name])}"),
    W3: pg.includes("{@const _mtk = tokenizeLogMessage(entry.message ?? '', cardNamesSorted, tMatchLogNames)}")
      && /tMatchLogTitle = \(p1 \?\? '\?'\) \+ ' vs ' \+ \(p2 \?\? '\?'\);\n    tMatchLogNames = \[p1, p2\]\.filter\(\(x\) => typeof x === 'string'\);/.test(pg),
    // 所有呼叫點都有傳暱稱（不會漏掉一個新的顯示處）
    W4: [...pg.matchAll(/tokenizeLogMessage\(([^)]*)\)/g), ...mp.matchAll(/tokenizeLogMessage\(([^)]*)\)/g)].filter((m) => !/^msg/.test(m[1])).every((m) => m[1].split(',').length >= 3)
      && [...pg.matchAll(/tokenizeLogMessage\(/g), ...mp.matchAll(/tokenizeLogMessage\(/g)].length >= 3,
  };
}

const LABEL = {
  T1: '★★★ T1 暱稱與寶可夢同名：玩家名稱不是連結，同一行的卡名照樣是連結',
  T2: '★★★ T2 暱稱裡含卡名（我的噴火龍）：不會從暱稱中間切出卡片連結',
  T3: '★★ T3 卡名比暱稱長（噴火龍ex vs 暱稱噴火龍）：卡名照樣是連結',
  T4: '★★ T4 帶 iid 標記的卡片一律照樣是連結（即使名字跟暱稱一樣）',
  T5: '★★ T5 零回歸：沒傳暱稱＝舊行為；1 字／空白／null 暱稱不影響卡名',
  T6: '★ T6 暱稱前後空白也認得；雙方同名只處理一次',
  W1: '★★★ W1 桌機對戰紀錄傳入雙方暱稱',
  W2: '★★★ W2 手機直式對戰紀錄傳入雙方暱稱',
  W3: '★★ W3 錦標賽戰報傳入雙方暱稱',
  W4: '★★ W4 頁面上所有 tokenizeLogMessage 呼叫都有傳暱稱（不漏新顯示處）',
};
const ZERO_REGRESSION = new Set(['T5']);

const rd = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));
const all = async (lf, pg, mp) => {
  const g = async (fn) => { try { return (await fn()) || {}; } catch (e) { return { _err: String(e && e.message) }; } };
  return { ...(await g(async () => scenT(await loadLib(lf)))), ...(await g(() => scenW(pg, mp))) };
};
const R = await all(rd(LF), rd(PG), rd(MP));
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n'] ?? R._err);

console.log('【H】HEAD-FAIL（BASE v6.568）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6569 HEAD-FAIL', '需要歷史 commit');
else {
  const b = (p) => { const x = readBaseBlob(ROOT, BASE_SHA, p); return x.ok ? normEol(x.out) : ''; };
  const B = await all(b(LF), b(PG), b(MP));
  for (const k of Object.keys(LABEL)) {
    if (ZERO_REGRESSION.has(k)) ok(`★★[正對照] v6.568：${k} 在 BASE 上也是綠（舊行為本來就是這樣）`, B[k] === true, B[k + 'n']);
    else ok(`★★★[H] v6.568：${k} 紅`, B[k] !== true, String(B[k]));
  }
}
console.log(`\n=== v6.569 對戰紀錄的玩家暱稱不是卡片連結：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
