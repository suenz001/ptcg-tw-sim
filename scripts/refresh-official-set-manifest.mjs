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
//
// ⚠ 只有 list 頁是 server-rendered；detail 頁也吃得到（parse-card.js 直接解 HTML）。
// ⚠ regulationMark 一律由官方 detail 頁決定，禁憑印象、禁外部 Wiki。
import * as cheerio from 'cheerio';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard } from './scrape/parse-card.js';
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
const knownNonHIJ = {};
const todo = [];
for (const [code, id] of missingIds) {
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

if (write) {
  const prev = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return {}; } })();
  const manifest = {
    _note: prev._note ?? '台灣官方卡牌檢索（asia.pokemon-card.com/tw）的卡包→卡片 id 快照。',
    _source: `${BASE}/tw/card-search/list/?expansionCodes=<expansionCode>`,
    fetchedAt: new Date().toISOString().slice(0, 10),
    sets,
    _knownNonHIJNote: prev._knownNonHIJNote ?? '官方有、我們沒收錄，但 regulationMark 不是 H/I/J ⇒ 列管豁免。',
    knownNonHIJ: Object.fromEntries(Object.entries(knownNonHIJ).sort((a, b) => +a[0] - +b[0])),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(manifest, null, 1) + '\n', 'utf8');
  console.log('已寫入 ' + OUT);
} else {
  console.log('（未帶 --write，沒有寫任何檔）');
}
