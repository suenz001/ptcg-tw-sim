// v1.66 守衛：admin 後台的卡片索引必須「保證新鮮」且「失敗要看得見」。
//
// 事故：站長在 admin 看牌組明細，出現 `#18594 × 2` 與「特殊紅牌 083 · 106/083」。
//   ・#18594 =「燃火能量」M2 109/080，是 v6.116 才補進卡庫的重印
//   ・setCode「083」是 v6.117 修掉的舊值（原本誤寫成分母）
//   ⇒ 那個分頁手上的卡片索引是**卡庫更新以前**的快照。
//
// 三個放大器（本守衛逐條釘住）：
//   (a) `fetch` 沒有任何 revalidate → 瀏覽器／CDN 可以長期餵舊檔
//   (b) `_cardLoadPromise` 是**分頁生命週期**快取 → 後台分頁開好幾天就永遠是舊的
//   (c) 逐包 `catch {}` 是空的 → 某一包沒載到完全無聲，只看得到一堆 #id
//
// ⚠⚠ 最重要的一條是「① cardLabel 的 fallback 不得長得像機器格式」：
//   牌組明細那段文字是給人複製去「匯入文字」用的**機器格式**
//   （decks/+page.svelte 的 mAdmin regex 逐字依賴「卡名 卡包 · 卡號 · 標 × N」）。
//   fallback 若不小心變成可解析，匯入端就會把它當成一張合法的卡 —— 那比顯示 #id 糟得多。
//   現行行為（解析不了 → 匯入端明確報「無法解析」）是**安全的失敗**，必須保住。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const DECKS = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** 用結構 anchor 取一段（禁寫死行號 —— 上下文一動守衛就腐爛）。 */
function fnBody(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}
/** 去掉行註解與區塊註解，避免否定型檢查被註解裡的字誤導。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('① ⚠⚠ cardLabel 的 fallback 不得被匯入 regex 解析（安全失敗）');

T('⭐⭐⭐ 行為端：fallback 字串餵給匯入 regex 必須「解不出來」，而正常格式必須「解得出來」', () => {
  // 從 decks/+page.svelte 抽出真正在用的那條 mAdmin regex，不自己重寫一份（會漂移）。
  const m = /line\.match\((\/\^\(\.\+\)[^\n]*?\/)\)/.exec(DECKS);
  ok(m, '找不到 decks/+page.svelte 的 mAdmin regex —— 匯入格式改了，請重新檢視本守衛');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);

  // 正對照：cardLabel 解得出卡時的格式，必須仍然是合法的匯入行
  ok(re.test('超級具甲武者ex M6 · 009/076 · J × 3'),
    '正常格式已經不能被匯入解析了 —— cardLabel 的機器格式被改壞');

  // 主斷言：解不出卡時的 fallback，必須**不能**被解析
  const fb = /if \(!info\) return `([^`]+)`/.exec(fnBody(ADMIN, 'function cardLabel(cardId, count)') || '');
  ok(fb, '找不到 cardLabel 的 fallback 字串');
  const sample = fb[1].replace('${cardId}', '18594').replace('${count}', '2');
  ok(!re.test(sample),
    'cardLabel 的 fallback「' + sample + '」會被匯入 regex 當成一張合法的卡！\n'
    + '      這比顯示 #id 糟得多 —— 會靜默匯入到錯的卡片。\n'
    + '      fallback 必須維持「解析不了」，讓匯入端明確報「無法解析」。');
  // 也不能被同檔其他格式吃掉（保守起見再驗一次常見的「N 卡名 …」格式）
  ok(!/^\d+\s/.test(sample), 'fallback 不得以「數字 空白」開頭（會被當成 Format A 的張數）');
});

T('fallback 要能讓人看出「是索引沒載到」而不只是一個裸編號', () => {
  const body = fnBody(ADMIN, 'function cardLabel(cardId, count)');
  ok(body && /索引/.test(body),
    'fallback 沒有任何診斷字樣 —— 只印 #id 會讓人以為是卡片不存在，其實是索引沒載到');
});

console.log('② 卡片 JSON 一律 revalidate（不得再吃到舊檔）');

T('⭐⭐ admin 的卡片 fetch 必須走 no-cache / reload，不得是裸 fetch', () => {
  const helper = fnBody(ADMIN, 'async function _fetchCardJson(');
  ok(helper, '找不到 _fetchCardJson —— 卡片 fetch 沒有收斂到單一入口');
  ok(/cache:\s*forceReload\s*\?\s*'reload'\s*:\s*'no-cache'/.test(helper),
    '_fetchCardJson 沒有指定 cache 模式。\n'
    + '      GitHub Pages 有 ETag，no-cache 只花 header 流量、沒變回 304，不會重抓 4MB；\n'
    + '      而「手動維護的 ?v= 版本號」會因為忘記 bump 而失效。');
  const ensure = fnBody(ADMIN, 'async function ensureCardIndex()');
  ok(ensure, '找不到 ensureCardIndex');
  ok(!/await fetch\(CARDS_BASE/.test(ensure),
    'ensureCardIndex 裡還有繞過 _fetchCardJson 的裸 fetch(CARDS_BASE…)');
});

T('⭐⭐ ensureCardIndex 的快取要有 TTL（分頁開好幾天也要能拿到新資料）', () => {
  const ensure = fnBody(ADMIN, 'async function ensureCardIndex()');
  ok(/CARD_INDEX_TTL_MS/.test(ensure),
    'ensureCardIndex 沒有 TTL —— `if (_cardLoadPromise) return _cardLoadPromise;` 是分頁生命週期快取，\n'
    + '      後台分頁一開好幾天，卡庫更新後永遠進不來（本次事故的主要放大器）。');
  ok(!/^\s*if \(_cardLoadPromise\) return _cardLoadPromise;/m.test(stripComments(ensure)),
    '又出現無條件沿用舊 promise 的寫法');
  const ttl = /const CARD_INDEX_TTL_MS = ([^;]+);/.exec(ADMIN);
  ok(ttl, '找不到 CARD_INDEX_TTL_MS 宣告');
  // eslint-disable-next-line no-eval
  const ms = eval(ttl[1]);
  ok(ms > 0 && ms <= 60 * 60 * 1000, 'TTL 應介於 0～1 小時，實際 ' + ms + ' ms');
});

console.log('③ 載入失敗／半殘不得靜默');

T('⭐⭐ 逐包載入不得再用空 catch（含正對照）', () => {
  const ensure = stripComments(fnBody(ADMIN, 'async function ensureCardIndex()') || '');
  ok(ensure, '找不到 ensureCardIndex');
  ok(!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(ensure),
    'ensureCardIndex 裡還有空的 catch —— 某一包沒載到會完全無聲，畫面只剩一堆 #id');
  // 正對照：這個檢查真的抓得到空 catch
  ok(/catch\s*(\([^)]*\))?\s*\{\s*\}/.test('try { x() } catch {}'), '正對照失效');
  ok(/console\.error\(/.test(ensure), '逐包失敗至少要 console.error 留下線索');
});

T('⭐⭐ 必須用 index.json 宣告的 cardCount 對帳（抓「舊檔／半殘」）', () => {
  const ensure = fnBody(ADMIN, 'async function ensureCardIndex()');
  ok(/s\.cardCount\s*\?\?\s*s\.count/.test(ensure) && /cards\.length !== want/.test(ensure),
    '沒有拿 index.json 的 cardCount 跟實際卡片數對帳。\n'
    + '      本次事故就是「宣告 116 張、實際只有 80 張」—— 有這條會立刻現形。');
  ok(/_fetchCardJson\([^)]*,\s*true\)/.test(ensure),
    '對不上時應該先強制 reload 重抓一次再判定');
});

T('⭐ 整份載入失敗時必須清掉 promise（否則該分頁終身全部 #id、永不重試）', () => {
  const ensure = fnBody(ADMIN, 'async function ensureCardIndex()');
  ok(/_cardLoadPromise = null;/.test(ensure),
    '外層 catch 沒有把 _cardLoadPromise 設回 null —— 失敗會留成「已解決的空結果」，\n'
    + '      這個分頁從此所有卡片永遠是 #id，而且永遠不會再重試。');
});

T('⭐ 失敗要在畫面上說出來（非阻塞，且不得用 alert）', () => {
  ok(/function renderCardIndexWarning\(\)/.test(ADMIN), '沒有畫面警告');
  const warn = fnBody(ADMIN, 'function renderCardIndexWarning()');
  ok(!/alert\(/.test(warn),
    '警告不得用 alert —— ensureCardIndex 被十幾處 modal 呼叫，會反覆彈窗');
  ok(/escapeHtml\(/.test(warn), '警告內容要過 escapeHtml');
});

console.log('④ 全站：任何對卡片 JSON 的 runtime fetch 都要有防舊檔機制');

T('⭐⭐ 全 repo 掃描：fetch 卡片 JSON 必須帶 ?v= 或指定 cache 模式', () => {
  // ⚠ 正式站的 /cards/*.json 走 Cloudflare，實測 age 可達 4 天（遠大於 origin 的 max-age）。
  //   任何「順手 fetch 一下 /cards/xxx」而沒帶防舊檔機制的新程式碼，都會複製本次事故。
  const roots = ['src', 'oracle-admin'];
  const bad = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === 'node_modules' || f.startsWith('.')) continue;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(ts|js|svelte|html|mjs)$/.test(f)) continue;
      const src = readFileSync(p, 'utf8');
      const re = /fetch\(([^;]{0,200}?)\)/g;
      let m;
      while ((m = re.exec(src))) {
        const call = m[1];
        if (!/(cards\/index\.json|card-set-map\.json|CARDS_BASE)/.test(call)) continue;
        if (/\?v=|\?nocache|cache:\s*'|cache:\s*"|forceReload/.test(call)) continue;
        bad.push(p.slice(ROOT.length) + ' :: fetch(' + call.trim().slice(0, 90) + ')');
      }
    }
  };
  for (const r of roots) walk(join(ROOT, r));
  ok(bad.length === 0,
    '有卡片 JSON 的 fetch 沒有任何防舊檔機制：\n      ' + bad.join('\n      ')
    + '\n      → 請加 `?v=${VERSION}`（遊戲站慣例）或 `{ cache: \'no-cache\' }`（admin 慣例）');
});

console.log('\n=== v1.66 admin 卡片索引新鮮度 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
