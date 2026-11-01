#!/usr/bin/env node
// 重抓「台灣官方卡牌檢索」的卡包 → 卡片 id 快照，並列出「官方有、我們沒有」的卡。
//
// ⚠⚠ B-1 教訓：老腳本沒有參數解析 = 任何參數都等於「直接執行」。
//     這支一律先過參數閘：--help 只印用法；未知參數 exit 1；**沒有 --write 什麼都不寫**。
//
// 用法：
//   node scripts/refresh-official-set-manifest.mjs             # 只比對，印報告，不寫檔
//   node scripts/refresh-official-set-manifest.mjs --write     # 同上 + 覆寫快照
//   node scripts/refresh-official-set-manifest.mjs --delay 500 # 每次請求間隔（預設 250ms）
//   node scripts/refresh-official-set-manifest.mjs --tags       # ⭐ v6.205：只重抓「tag 白名單」
//   node scripts/refresh-official-set-manifest.mjs --tags --write#   並覆寫 scripts/data/official-tag-manifest.json
//
// 產出：
//   scripts/data/official-set-manifest.json
//   scripts/data/official-tag-manifest.json（--tags）
//   stdout：缺的 H/I/J 卡逐張列出（卡名／編號／標）——這就是「該補哪幾張」的清單。
//   stdout：⭐ v6.616 官方商品清單比對 —— 站上沒收錄、但官方「標準」篩選有卡的新商品（全新商品不會再漏掉）。
//
// ⚠ 只有 list 頁是 server-rendered；detail 頁也吃得到（parse-card.js 直接解 HTML）。
// ⚠ regulationMark 一律由官方 detail 頁決定，禁憑印象、禁外部 Wiki。
import * as cheerio from 'cheerio';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from './scrape/parse-card.js';
import { findSameFace } from './lib/official-reprint-match.mjs';
// ⭐ v6.205：tag（古代105／未來106／ACE SPEC104）**只存在於 list filter**，單張 detail 頁看不到
//   （scripts/scrape/tag-filters.js 開頭已載明）⇒ 想查證某張卡有沒有 tag，唯一官方來源就是這個 filter。
import { TAG_FILTERS, collectTaggedIds } from './scrape/tag-filters.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'scripts/data/official-set-manifest.json');
const TAG_OUT = join(ROOT, 'scripts/data/official-tag-manifest.json');
const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (PTCG-TW-Sim manifest refresh; contact: github.com/suenz001/ptcg-tw-sim)';

const USAGE = `用法：
  node scripts/refresh-official-set-manifest.mjs            只比對並印報告（不寫檔）
  node scripts/refresh-official-set-manifest.mjs --write    比對後覆寫 scripts/data/official-set-manifest.json
  node scripts/refresh-official-set-manifest.mjs --delay N  每次請求間隔毫秒（預設 250）
  node scripts/refresh-official-set-manifest.mjs --tags     只重抓 tag 白名單（古代/未來/ACE SPEC）
                                                           搭配 --write 覆寫 official-tag-manifest.json
`;

const argv = process.argv.slice(2);
let write = false, delayMs = 250, tagsOnly = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  else if (a === '--write') write = true;
  else if (a === '--tags') tagsOnly = true;
  else if (a === '--delay') { delayMs = parseInt(argv[++i], 10); if (!Number.isFinite(delayMs)) { console.error('--delay 需要數字'); process.exit(1); } }
  else { console.error('未知參數：' + a + '\n' + USAGE); process.exit(1); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ⭐ v6.205 `--tags`：重抓官方 tag 白名單。
 *
 * ⚠ 查證結果（2026-08-17 實跑）：官網的三組 filter 名（pokemonTag / trainersTag / energiesTag）
 *   **只看 value**，同一個 value 在三組下回傳的 id 完全相同（古代116／未來103／ACE SPEC52）。
 *   所以快照按 **label** 收斂，並在抓取時逐組比對；哪天官網改成真的分 supertype，
 *   下面的 `_filterNamesAgree` 會變 false，守衛就會看到而不是無聲吃掉。
 *
 * ⚠ 這份快照的語意是**單向**的：「官方說有 ⇒ 我方必須有」。反向不成立 ——
 *   實測官方 filter 對合集重印（MC）與部分重複 id（SV8a 12405/12410）覆蓋不完整，
 *   所以「官方沒列」**不能**當成「我方不該有」。反向那把尺由「印刷平權」離線守衛負責。
 */
async function refreshTagManifest() {
  const byLabel = new Map();          // label -> { setsOfIds: [Set], filters: [] }
  for (const def of TAG_FILTERS) {
    process.stderr.write('  ' + def.filter + '=' + def.id + ' (' + def.label + ') … ');
    const ids = await collectTaggedIds(def.filter, def.id, delayMs);
    process.stderr.write(ids.size + '\n');
    if (!byLabel.has(def.label)) byLabel.set(def.label, { sets: [], filters: [] });
    byLabel.get(def.label).sets.push(ids);
    byLabel.get(def.label).filters.push(def.filter + '[' + def.id + ']');
    await sleep(delayMs);
  }
  const tags = {}, agree = {};
  for (const [label, v] of byLabel) {
    const union = new Set();
    for (const s of v.sets) for (const i of s) union.add(i);
    agree[label] = v.sets.every((s) => s.size === union.size);
    tags[label] = [...union].sort((a, b) => +a - +b);
  }
  // 與我方卡庫比對：官方說有、我方有那張卡卻沒 tag ⇒ 待補
  const todo = [];
  for (const [label, ids] of Object.entries(tags)) {
    for (const id of ids) {
      const c = OURS_CARD.get(String(id));
      if (!c) continue;
      if (!(c.tags ?? []).includes(label)) todo.push({ id, label, name: c.name, mark: c.regulationMark });
    }
  }
  console.log('\n=== 官方說有 tag、我方卡庫缺的：' + todo.length + ' 張 ===');
  for (const t of todo) console.log(`  #${t.id} ${t.name}  缺「${t.label}」  ${t.mark}`);
  if (write) {
    mkdirSync(dirname(TAG_OUT), { recursive: true });
    writeFileSync(TAG_OUT, JSON.stringify({
      _note: '台灣官方卡牌檢索 list filter 的 tag → 卡片 id 白名單。tag 只存在於 filter，單張 detail 頁看不到。',
      _source: `${BASE}/tw/card-search/list/?<filter>[0]=<value>（古代105／未來106／ACE SPEC104）`,
      _semantics: '單向：官方說有 ⇒ 我方必須有。官方沒列 ≠ 我方不該有（合集重印/重複 id 覆蓋不完整）。',
      _filterNamesAgree: agree,
      fetchedAt: new Date().toISOString().slice(0, 10),
      counts: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, v.length])),
      tags,
    }, null, 1) + '\n', 'utf8');
    console.log('已寫入 ' + TAG_OUT);
  } else {
    console.log('（未帶 --write，沒有寫任何檔）');
  }
}
async function html(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.text();
}

/** 走完分頁，收集某個 expansionCode 的所有 detail id。 */
async function collectIds(expansionCode) {
  const ids = new Set();
  let pageNo = 1;
  while (true) {
    const url = `${BASE}/tw/card-search/list/?expansionCodes=${encodeURIComponent(expansionCode)}&pageNo=${pageNo}`;
    const $ = cheerio.load(await html(url));
    const before = ids.size;
    $('a[href*="/detail/"]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/detail\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    if (ids.size === before) break;                       // 這一頁沒有新 id → 到底了
    const hasNext = $(`a[href*="pageNo=${pageNo + 1}"]`).length > 0;
    pageNo++;
    if (!hasNext) break;
    await sleep(delayMs);
  }
  return [...ids].sort((a, b) => +a - +b);
}

// ⭐ v6.616（站長 2026-11-01：「新卡包偵測改成連官方商品清單一起比對」）
// ─────────────────────────────────────────────────────────────────────────────
// 舊版只走「站上已有的卡包」⇒ 官方出了全新商品（例：v6.615 的戰術牌組 MTL／MTS／MTH／MTK）永遠抓不到。
// 現在多一步：讀官方卡牌檢索頁的「商品」勾選清單（value＝expansionCode、label＝商品名），
// 對每一個「站上沒有收錄」的商品，用官方自己的「標準」賽制篩選（regulation=1）列出卡片，再逐張比對：
//   ・0 張 ⇒ 全部已退標，不必收
//   ・⚠ 2026-11-01 實測：regulation=1 也會列出舊商品裡、官方認定標準賽可用的重印
//     （例：AC1a 的高級球、SVD 的寶可夢交替）⇒ 不能只看張數，要逐張看「站上有沒有同名同卡面」
//     （判準唯一一份：scripts/lib/official-reprint-match.mjs）
//   ・站上找不到的卡面（newFaces）非空 ⇒ 要嘛收錄、要嘛由站長裁定不收（快照的 productsNotCollected，附理由）
// 結果寫進快照的 products，由離線守衛 test-official-set-completeness ③ 檢查（CI 不連官網）。

/** 官方卡牌檢索頁的商品清單（勾選框 class="expansionCode"）：[{ code, label }] */
async function collectProducts() {
  const $ = cheerio.load(await html(`${BASE}/tw/card-search/`));
  const out = [];
  $('input.expansionCode').each((_, el) => {
    const code = $(el).attr('value');
    const label = $(`label[for="${$(el).attr('id')}"]`).text().trim();
    if (code) out.push({ code, label });
  });
  return out;
}

/** 某商品在官方「標準」賽制篩選下的卡片 id（regulation=1；走完分頁） */
async function collectStandardIds(expansionCode) {
  const ids = new Set();
  let pageNo = 1;
  while (true) {
    const url = `${BASE}/tw/card-search/list/?expansionCodes=${encodeURIComponent(expansionCode)}&regulation=1&pageNo=${pageNo}`;
    const $ = cheerio.load(await html(url));
    const before = ids.size;
    $('a[href*="/detail/"]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/detail\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    if (ids.size === before) break;
    const hasNext = $(`a[href*="pageNo=${pageNo + 1}"]`).length > 0;
    pageNo++;
    if (!hasNext) break;
    await sleep(delayMs);
  }
  return [...ids].sort((a, b) => +a - +b);
}

// live 卡包 → 官方 expansionCode（M-P-H/I/J 與 SV-P-H/I/J 是我方為了濾標拆的檔）
const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const offCode = (c) => (c.startsWith('M-P') ? 'M-P' : c.startsWith('SV-P') ? 'SV-P' : c);
const groups = new Map();
for (const e of INDEX) {
  const k = offCode(e.code);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(e.code);
}

const liveCodes = new Set(INDEX.map((e) => e.code));
const OURS = new Set();
const OURS_CARD = new Map();   // v6.205：--tags 需要整張卡（要看 tags 欄位）
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    OURS.add(String(c.id));
    OURS_CARD.set(String(c.id), c);
  }
}

if (tagsOnly) { await refreshTagManifest(); process.exit(process.exitCode ?? 0); }

const sets = {};
const missingIds = [];
for (const [code, localSetCodes] of [...groups.entries()].sort()) {
  process.stderr.write('  ' + code + ' … ');
  const ids = await collectIds(code);
  sets[code] = { total: ids.length, localSetCodes: localSetCodes.sort(), ids };
  const miss = ids.filter((i) => !OURS.has(String(i)));
  process.stderr.write(ids.length + ' 張，缺 ' + miss.length + '\n');
  for (const i of miss) missingIds.push([code, i]);
  await sleep(delayMs);
}

// 缺的卡逐張抓 detail，用官方 regulationMark 分流
// ⭐ v6.616：官方 detail 頁的標記欄位對「舊商品裡的重印」不可靠——它會標成現行可用的 I／J
//   （2026-11-01 實測：S4a 阿球顯示 I、AS5D 觀光客顯示 J，站長查證卡面是 D 標；
//    SVI 的訓練家卡圖印 G、基本能量卡圖無標記，官網卻標 I／J）。
//   ⇒ 人工看過卡圖、確認印的不是 H／I／J 的，列在快照的 printedMarkOverrides（人工維護，refresh 原樣保留），
//     這裡直接跳過，不當成待補卡。
const _prevForOverrides = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return {}; } })();
const printedMarkOverrides = _prevForOverrides.printedMarkOverrides ?? {};
const knownNonHIJ = {};
const todo = [];
for (const [code, id] of missingIds) {
  if (printedMarkOverrides[String(id)]) continue;
  try {
    const url = `${BASE}/tw/card-search/detail/${id}/`;
    const card = parseCard(await html(url), id, url);
    if (['H', 'I', 'J'].includes(card.regulationMark)) todo.push({ code, ...card });
    else knownNonHIJ[String(id)] = { regulationMark: card.regulationMark ?? null, name: card.name };
  } catch (e) {
    console.error('  ! detail ' + id + ' 失敗：' + e.message);
    process.exitCode = 1;
  }
  await sleep(delayMs);
}

console.log('\n=== 官方有、我們沒有的 H/I/J 卡：' + todo.length + ' 張 ===');
for (const c of todo) {
  console.log(`  ${c.code} #${c.id} ${c.name}  ${c.collectorNumber}  ${c.regulationMark}  ${c.supertype}/${c.subtype}`);
}
console.log('（非 H/I/J 的 ' + Object.keys(knownNonHIJ).length + ' 張已列入 knownNonHIJ 豁免表）');
console.log('（卡圖印的不是 H/I/J、人工列管的 ' + Object.keys(printedMarkOverrides).length + ' 張已跳過）');
console.log('⚠ 補卡前一定要看卡圖上印的標記：官網標記欄位對舊商品的重印不可靠（站長 2026-11-01：「收之前，先確認是不是h i j標！」）');

// ⭐ v6.616：官方商品清單 —— 站上沒收錄的商品，用官方「標準」篩選數張數
const prevManifest = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return {}; } })();
const notCollected = prevManifest.productsNotCollected ?? {};   // 站長裁定不收的商品（人工維護，附理由）
const officialProducts = await collectProducts();
// ⚠ 官方代號大小寫會改：站上的 svhk／svhm 在官方商品清單是 SVHK／SVHM ⇒ 一律大小寫不敏感比對
const groupsLC = new Set([...groups.keys()].map((k) => k.toLowerCase()));
const productsLC = new Set(officialProducts.map((p) => p.code.toLowerCase()));
const products = {};
const newProducts = [];
for (const p of officialProducts) {
  const covered = groupsLC.has(p.code.toLowerCase());
  const entry = { label: p.label, covered };
  if (!covered) {
    await sleep(delayMs);
    const std = await collectStandardIds(p.code);
    entry.standardCount = std.length;
    // 逐張比對：站上已有同 id ⇒ 已收錄；同名同卡面 ⇒ 重印（記下對應的站上 id，守衛離線核對）；
    // 其餘 ⇒ newFaces（站上找不到的卡面，要嘛收錄、要嘛站長裁定不收）
    const reprintOf = {};
    const newFaces = [];
    for (const id of std) {
      if (OURS.has(String(id))) continue;
      await sleep(delayMs);
      const url = `${BASE}/tw/card-search/detail/${id}/`;
      const card = parseCard(await html(url), id, url);
      const same = findSameFace(card, OURS_CARD.values());
      if (same) reprintOf[String(id)] = { site: same, name: card.name };   // 存官方卡名 ⇒ 守衛離線可核「同名」
      else newFaces.push({ id: String(id), name: card.name, regulationMark: card.regulationMark ?? null, supertype: card.supertype });
    }
    entry.reprintOf = reprintOf;
    entry.newFaces = newFaces;
    // ⭐ 站長裁定不收是「當時那幾張」：裁定釘住 ruledNewFaces（id 清單），之後同一商品多出新卡面照樣要報
    const ruled = new Set(notCollected[p.code]?.ruledNewFaces ?? []);
    const unruled = newFaces.filter((f) => !ruled.has(f.id));
    if (unruled.length > 0) newProducts.push({ ...p, standardCount: std.length, newFaces: unruled });
  }
  products[p.code] = entry;
}
const uncovered = Object.values(products).filter((v) => !v.covered).length;
console.log('\n=== 官方商品清單：' + officialProducts.length + ' 項（站上已收錄 ' + (officialProducts.length - uncovered) + '、未收錄 ' + uncovered + '）===');
for (const [code, r] of Object.entries(notCollected)) console.log(`  站長裁定不收：${code} ${products[code]?.label ?? '（官方清單已無此商品）'}（標準賽 ${products[code]?.standardCount ?? '?'} 張）— ${r.reason}`);
if (newProducts.length === 0) console.log('  ✓ 沒有「未收錄、且有站上沒有的標準賽卡面」的商品（其餘未收錄商品的標準賽卡不是 0 張，就是站上已有同名同卡面的重印）');
for (const p of newProducts) {
  console.log(`  ★ 新商品待處理：${p.code} ${p.label} —— 標準賽可用 ${p.standardCount} 張，其中站上沒有的卡面 ${p.newFaces.length} 張（收錄，或由站長裁定後列入 productsNotCollected）`);
  for (const f of p.newFaces) console.log(`      #${f.id} ${f.name}（${f.regulationMark ?? '?'}／${f.supertype}）`);
}
for (const code of groups.keys()) if (!productsLC.has(code.toLowerCase())) console.log(`  ⚠ 站上的卡包 ${code} 不在官方商品清單裡（官方改了代號？）`);

if (write) {
  const prev = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return {}; } })();
  const manifest = {
    _note: prev._note ?? '台灣官方卡牌檢索（asia.pokemon-card.com/tw）的卡包→卡片 id 快照。',
    _source: `${BASE}/tw/card-search/list/?expansionCodes=<expansionCode>`,
    fetchedAt: new Date().toISOString().slice(0, 10),
    sets,
    _knownNonHIJNote: prev._knownNonHIJNote ?? '官方有、我們沒收錄，但 regulationMark 不是 H/I/J ⇒ 列管豁免。',
    knownNonHIJ: Object.fromEntries(Object.entries(knownNonHIJ).sort((a, b) => +a[0] - +b[0])),
    _printedMarkOverridesNote: prev._printedMarkOverridesNote ?? '官網標成 H／I／J、但卡圖上印的標記不是 H／I／J 的卡（人工看卡圖確認；refresh 原樣保留）。printed＝卡圖實際印的標記（none＝無標記，例：基本能量）。',
    printedMarkOverrides,
    _productsNote: '官方卡牌檢索頁的商品清單（expansionCode → 商品名）。covered＝站上已收錄；未收錄的附 standardCount＝官方「標準」賽制篩選（regulation=1）的張數、reprintOf＝站上已有同名同卡面的重印（官方 id → 站上 id）、newFaces＝站上找不到的卡面。守衛：newFaces 非空的未收錄商品必須列在 productsNotCollected（站長裁定，附理由）。',
    products,
    _productsNotCollectedNote: prev._productsNotCollectedNote ?? '站長裁定不收的商品（人工維護；refresh 會原樣保留）。',
    productsNotCollected: notCollected,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(manifest, null, 1) + '\n', 'utf8');
  console.log('已寫入 ' + OUT);
} else {
  console.log('（未帶 --write，沒有寫任何檔）');
}
