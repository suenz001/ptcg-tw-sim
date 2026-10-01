#!/usr/bin/env node
/**
 * v6.459 守衛：進對戰／錦標賽頁的卡池預熱（站長 2026-10-01：玩家反應進頁會延遲）
 *
 * 實測（站長電腦、台灣網路、冷快取進 /tournament）：
 *   ① 卡池載入排在 Oracle 登入**之後**才開始，而 card-set-map.json 在 CDN 是 DYNAMIC（每次回源）⇒ 三段往返串在一起；
 *   ② 舊寫法把**內建預組**（PRESET_DECKS）也算進「本機牌組」⇒ 一進頁就抓 35～37 個卡包，「載入卡池中…」要等全部抓完。
 *   本機對照（同一份人造延遲 150／320ms、10Mbps、CPU 1/4）：/game 卡池就緒 8.4 秒 → 4.5 秒（沒有自己的牌組）、
 *   8.5 秒 → 6.0 秒（4 副自己的牌組，7 個卡包）。
 *
 * 修法（src/routes/game/+page.svelte onMount，哨兵 v6459-pool-warm-parallel）：
 *   預熱 IIFE 在 `await oracleAuth()` **之前**發出、只算 `decks`（玩家自己的牌組）；沒有牌組時先抓對照表；
 *   `poolReady = true` 之前 `await _poolWarm`。預組改「選到才載」——靠既有的三張網（下方 N1～N3）。
 *
 * 【S】靜態（HEAD-FAIL 對 v6.458）
 * 【B】行為：把哨兵區塊抽出來（esbuild 去型別）實跑——預熱只拿到自己的牌組、而且在登入完成**之前**就已發出
 * 【N】預組改成選到才載的安全網（三張網都還在；不是本版新增，所以不列 HEAD-FAIL）
 *
 * Run: node scripts/test-v6459-pool-warm-parallel.mjs
 */
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.458。
const BASE_SHA = 'eb493b80f35dac2e7058c2ac5f6e88f72822ee1e';
const PAGE = 'src/routes/game/+page.svelte';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

/** onMount 本體：從 `onMount(async () => {` 到第一個 `poolReady = true;`（含）。抽不到就 throw（fail-closed）。 */
function mountHead(src) {
  const a = src.indexOf('  onMount(async () => {');
  if (a < 0) throw new Error('找不到 onMount');
  const b = src.indexOf('    poolReady = true;', a);
  if (b < 0) throw new Error('onMount 裡找不到 poolReady = true');
  return src.slice(a, b + '    poolReady = true;'.length);
}
/** 哨兵區塊（不含哨兵行）。要恰好一對。 */
function warmBlock(src) {
  const O = '// >>> v6459-pool-warm-parallel', C = '// <<< v6459-pool-warm-parallel';
  if (src.split(O).length !== 2 || src.split(C).length !== 2) throw new Error('v6459 哨兵不是恰好一對');
  const a = src.indexOf(O), b = src.indexOf(C);
  if (b < a) throw new Error('v6459 哨兵順序反了');
  return src.slice(src.indexOf('\n', a) + 1, b);
}
/** 去掉 // 行註解（區塊內的說明文字會提到 allDecks／PRESET_DECKS，不可以拿來誤判）。 */
const code = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// [名稱, 是否列入 HEAD-FAIL, 判準(讀檔函式) → boolean]
const CHECKS = [
  ['S1 哨兵恰好一對，而且預熱 IIFE（const _poolWarm）在 onMount 裡、位於第一個 await oracleAuth() 之前', true, (f) => {
    const m = mountHead(f(PAGE)); warmBlock(f(PAGE));
    const w = m.indexOf('const _poolWarm'), au = m.indexOf('await oracleAuth(');
    return w > 0 && au > 0 && w < au;
  }],
  ['S2 預熱只算玩家自己的牌組：迴圈走 decks，程式碼（去註解）裡不出現 allDecks／PRESET_DECKS', true, (f) => {
    const blk = code(warmBlock(f(PAGE)));
    return /for \(const d of decks\)/.test(blk) && !/\ballDecks\b/.test(blk) && !/\bPRESET_DECKS\b/.test(blk);
  }],
  ['S3 poolReady = true 之前 await _poolWarm；舊的「登入後才串行 await 預熱」整段不在了', true, (f) => {
    const m = code(mountHead(f(PAGE)));
    const aw = m.lastIndexOf('await _poolWarm;'), pr = m.lastIndexOf('poolReady = true;');
    const oldSerial = /for \(const d of allDecks\) for \(const e of d\.entries\) _localEntries\.push/.test(m);
    return aw > 0 && aw < pr && !oldSerial;
  }],
  ['S4 沒有自己的牌組時先抓 card-set-map（loadCardSetMap 有 import、預熱區塊有呼叫）', true, (f) => {
    const src = f(PAGE);
    return /import \{[^}]*\bloadCardSetMap\b[^}]*\} from '\$lib\/cards\/pool';/.test(src) && /loadCardSetMap\(\)/.test(code(warmBlock(src)));
  }],
];

console.log('【S】靜態');
for (const [n, , fn] of CHECKS) { let r = false, err; try { r = !!fn(rd); } catch (e) { err = e.message; } ok(n, r, err); }

console.log('\n【S】HEAD-FAIL（v6.458）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6459 HEAD-FAIL', '需要 v6.458 commit');
else {
  const base = (p) => { const r = readBaseBlob(ROOT, BASE_SHA, p); return r.ok ? r.out.replace(/\r\n/g, '\n') : ''; };
  // 前置：BASE 的 onMount 抽得到（否則「全部不成立」只是抽取器壞了）
  let baseHead = ''; try { baseHead = mountHead(base(PAGE)); } catch { baseHead = ''; }
  ok('★[HEAD-FAIL 前置] v6.458 的 onMount 抽得到，而且裡面確實是「登入後才串行預熱、含預組」的舊寫法',
    baseHead.length > 0 && /for \(const d of allDecks\) for \(const e of d\.entries\) _localEntries\.push/.test(baseHead)
    && baseHead.indexOf('await oracleAuth(') < baseHead.indexOf('_localEntries'));
  const wrong = CHECKS.filter(([, hf, fn]) => { let r = false; try { r = !!fn(base); } catch { r = false; } return hf && r; }).map(([n]) => n);
  ok('★★★[HEAD-FAIL] S1～S4 在 v6.458 全部不成立', wrong.length === 0, wrong.join(' ｜ '));
}

console.log('\n【B】行為：抽出預熱區塊實跑');
{
  const ts = warmBlock(rd(PAGE));
  const js = (await transform(ts, { loader: 'ts', format: 'esm', target: 'es2020' })).code;
  /** 依序：建預熱 → 模擬「登入要 50ms」→ 等預熱。回傳呼叫紀錄。 */
  async function run(decks) {
    const log = [];
    const ensurePoolForDeckEntries = async (lists) => { log.push({ t: 'ensure', ids: lists.flat().map((e) => e.cardId) }); };
    const loadCardSetMap = () => { log.push({ t: 'map' }); return Promise.resolve({}); };
    const fn = new Function('decks', 'ensurePoolForDeckEntries', 'loadCardSetMap', 'log',
      js + '\n log.push({ t: "auth-start" }); return new Promise((r) => setTimeout(r, 50)).then(() => { log.push({ t: "auth-done" }); return _poolWarm; }).then(() => log);');
    return fn(decks, ensurePoolForDeckEntries, loadCardSetMap, log);
  }
  const mine = [{ id: 'm1', entries: [{ cardId: 'A', count: 4 }, { cardId: 'B', count: 2 }] }, { id: 'm2', entries: [{ cardId: 'C', count: 1 }] }];
  const L1 = await run(mine);
  const e1 = L1.find((x) => x.t === 'ensure');
  ok('B1 有自己的牌組 ⇒ 預熱只拿到自己牌組的卡（A、B、C），一張預組都沒有',
    !!e1 && JSON.stringify(e1.ids) === JSON.stringify(['A', 'B', 'C']), JSON.stringify(L1));
  ok('B2 ⭐預熱在「登入完成」之前就已經發出（並行，不再串在登入後面）',
    L1.findIndex((x) => x.t === 'ensure') >= 0 && L1.findIndex((x) => x.t === 'ensure') < L1.findIndex((x) => x.t === 'auth-done'), JSON.stringify(L1.map((x) => x.t)));
  const L2 = await run([]);
  ok('B3 沒有自己的牌組 ⇒ 不叫 ensure，改先抓對照表（map），也是在登入完成之前',
    !L2.some((x) => x.t === 'ensure') && L2.findIndex((x) => x.t === 'map') >= 0 && L2.findIndex((x) => x.t === 'map') < L2.findIndex((x) => x.t === 'auth-done'), JSON.stringify(L2.map((x) => x.t)));
  // 正對照：預熱自己拋例外也不能讓 _poolWarm 變成 rejected（否則 onMount 卡在 await、poolReady 永遠 false）
  {
    const log = [];
    const fn = new Function('decks', 'ensurePoolForDeckEntries', 'loadCardSetMap', 'log',
      js + '\n return _poolWarm.then(() => "resolved", () => "rejected");');
    const origErr = console.error; console.error = () => {};
    const r = await fn(mine, async () => { throw new Error('boom'); }, () => Promise.resolve({}), log);
    console.error = origErr;
    ok('B4 預熱失敗 ⇒ _poolWarm 仍然 resolve（poolReady 不會因此永遠不亮）', r === 'resolved', r);
  }
}

console.log('\n【N】預組「選到才載」的安全網（三張都必須還在）');
{
  const src = code(rd(PAGE));
  ok('N1 選牌組的 $effect：p1DeckObj／p2DeckObj 變動 ⇒ ensurePoolForDeckEntries',
    /if \(p1DeckObj\) es\.push\(p1DeckObj\.entries\);\s*\n\s*if \(p2DeckObj\) es\.push\(p2DeckObj\.entries\);\s*\n\s*if \(es\.length\) ensurePoolForDeckEntries\(es\);/.test(src));
  ok('N2 本機開局前以 forceComplete 補齊雙方牌組', /await ensurePoolForDeckEntries\(\[d1\.entries, d2\.entries\], true\);/.test(src));
  ok('N3 錦標賽／線上盤面依盤面卡號補載（tAdopt 的 ensurePoolForStateIds）', /void ensurePoolForStateIds\(state\);/.test(src));
}

console.log(`\n=== v6.459 卡池預熱並行：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
