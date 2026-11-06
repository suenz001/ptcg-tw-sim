#!/usr/bin/env node
/**
 * 新卡包工具組 ①：抓台灣官方 Q&A 資料庫（標準賽制），找出「站上規則書還沒收錄」的官方判例。
 *
 * 為什麼要有這支（2026-11-07，站長：新擴充包「波導探求者」11 月底推出前先準備好）：
 *   2026-10-10 的官方 Q&A 比對是手動抓的（當時 1127 條、站上缺 246 條）。新卡包一上架，官方會陸續
 *   補上該卡包的 Q&A —— 沒有固定工具就只能每次重做一遍，而且容易漏掉「發售後才補上的判例」。
 *
 * 資料來源（唯一權威）：https://asia.pokemon-card.com/tw/rules/search/?regulation=1（標準）
 *   每一筆是 <li class="questionItem">：相關卡牌（含官方卡片 id，與 static/cards 的 id 同一套）／
 *   問題／回答／所屬商品 tag（例：擴充包「朱ex」→ ?tag=2）。官方沒有給每筆編號 ⇒ 以「問題全文」當鍵。
 *
 * 用法：
 *   node scripts/new-set/fetch-official-qa.mjs --set M6a --write       以 M6a 每張卡的卡名逐一查詢，併進快照
 *   node scripts/new-set/fetch-official-qa.mjs --set M7 --staging .new-set/M7/cards.json --write
 *                                                                      新卡包還沒併表時，讀爬蟲暫存檔的卡名
 *   node scripts/new-set/fetch-official-qa.mjs --names 卡名.txt --write  任意卡名清單（一行一個）
 *   node scripts/new-set/fetch-official-qa.mjs --set M6a                不連網：只用既有快照印 M6a 的報告（不寫檔）
 *     ⚠ 有 --set 就會連網查；只想看報告請加 --from-file scripts/data/official-qa.json
 *   node scripts/new-set/fetch-official-qa.mjs --product 30th --from-file scripts/data/official-qa.json
 *   --delay 400   每次請求間隔（預設 350ms，對官網客氣一點）
 *
 * 報告：
 *   ・總筆數／各商品筆數
 *   ・「規則書沒有收錄」的條目（以問題全文比對 PTCG RULES/PTCG_RULES.md 的「- **Q**:」行；正規化空白與全半形標點）
 *   ・與上一份快照相比「新出現」的條目（官方發售後補判例時最有用）
 * ⚠ 這支只讀官網、只寫 scripts/data/official-qa.json（要加 --write），不改任何程式或規則書。
 *   規則書收錄與行為比對要另外做（每一條都要用 applyAction 實跑，見 skill ptcg-rulings-first）。
 */
import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SNAP = join(ROOT, 'scripts/data/official-qa.json');
const RULES_MD = join(ROOT, 'PTCG RULES/PTCG_RULES.md');
const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (PTCG-TW-Sim QA snapshot; contact: github.com/suenz001/ptcg-tw-sim)';

const USAGE = `用法：node scripts/new-set/fetch-official-qa.mjs [--write] [--set CODE] [--product 名稱] [--from-file 檔案] [--staging 暫存卡表.json] [--names 卡名清單.txt] [--delay ms]`;

export function parseArgs(argv) {
  const a = { write: false, set: null, staging: null, names: null, product: null, fromFile: null, delay: 350, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--write') a.write = true;
    else if (k === '--set') a.set = argv[++i];
    else if (k === '--product') a.product = argv[++i];
    else if (k === '--from-file') a.fromFile = argv[++i];
    else if (k === '--delay') a.delay = parseInt(argv[++i], 10);
    else if (k === '--staging') a.staging = argv[++i];
    else if (k === '--names') a.names = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error('未知參數：' + k + '\n' + USAGE);
  }
  if (a.set === undefined || a.product === undefined || a.fromFile === undefined || a.staging === undefined || a.names === undefined || !(a.delay >= 0)) throw new Error('參數缺值\n' + USAGE);
  return a;
}

/** 問題文字正規化：去空白、全形標點與半形統一（官網偶有全半形混用），只用來比對，不改原文。 */
export function normQ(s) {
  return String(s ?? '')
    .replace(/[\s　]+/g, '')
    .replace(/[？]/g, '?').replace(/[，]/g, ',').replace(/[：]/g, ':').replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[​-‍﻿]/g, '');
}

/** 解析一頁 HTML ⇒ { total, pages, items:[{q,a,cards:[{id,name}],tags:[{tag,label}]}] } */
export function parsePage(html) {
  const $ = cheerio.load(html);
  const total = parseInt($('.searchResults .total').first().text().replace(/[^\d]/g, ''), 10);
  const pages = parseInt(($('.searchResults .page .all').first().text().match(/(\d+)/) || [])[1], 10);
  const items = [];
  $('ul.questionList > li.questionItem').each((_, li) => {
    const el = $(li);
    const cards = [];
    el.find('.relation a.card').each((__, a) => {
      const href = $(a).attr('href') || '';
      const m = href.match(/\/detail\/([^/]+)\//);
      cards.push({ id: m ? m[1] : null, name: $(a).text().trim() });
    });
    const tags = [];
    el.find('.tag a').each((__, a) => {
      const href = $(a).attr('href') || '';
      const m = href.match(/[?&]tag=(\d+)/);
      tags.push({ tag: m ? m[1] : null, label: $(a).text().trim() });
    });
    const q = el.find('.question').first().text().trim();
    const ans = el.find('.answer').first().text().trim().replace(/\s+\n/g, '\n');
    if (q) items.push({ q, a: ans, cards, tags });
  });
  return { total, pages, items };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
      if (res.ok) return await res.text();
      last = new Error('HTTP ' + res.status + ' ' + url);
      if (res.status < 500 && res.status !== 429) break;   // 4xx（429 除外）重試也沒用
    } catch (e) { last = e; }
    await sleep(1500 * (i + 1));                          // 官網偶發 502：退避重試
  }
  throw last;
}

/** 同一筆判例的鍵：問題＋回答全文（正規化）。官方沒有給編號。 */
export const qaKey = (it) => normQ(it.q) + '\u0001' + normQ(it.a);

/**
 * ⚠⚠ 2026-11-07 演練實測：官網列表的**翻頁會重疊**——「標準」全列表 59 頁拿到 1164 筆（＝宣告總數），
 *   但只有 1124 筆不重複；重翻 8 輪結果完全相同（不是隨機，是固定漏掉約 40 筆）。
 *   依商品篩選（?tag=2 朱ex 宣告 100 筆 → 只有 47 筆不重複）也一樣。
 *   ⇒ **只有一頁（≤20 筆）的查詢才完整**。改用「卡名關鍵字」逐一查：每張卡的判例通常 ≤20 筆、一頁就完；
 *     超過一頁的查詢一律檢查「不重複筆數 ＝ 宣告總數」，不等就列進 incomplete，**不假裝完整**。
 */
export async function fetchQuery(params, delay, { getText = fetchText } = {}) {
  const uniq = new Map();
  let total = null, pages = null;
  for (let p = 1; ; p++) {
    if (pages !== null && p > pages) break;
    if (p > 1) await sleep(delay);
    const q = new URLSearchParams({ ...params, regulation: '1', ...(p > 1 ? { pageNo: String(p) } : {}) });
    const pg = parsePage(await getText(`${BASE}/tw/rules/search/?${q}`));
    if (p === 1) {
      total = Number.isFinite(pg.total) ? pg.total : 0;
      pages = Number.isFinite(pg.pages) ? pg.pages : (pg.items.length ? 1 : 0);
      if (total > 0 && !(pages >= 1)) throw new Error('官網頁面結構可能變了：有總筆數卻讀不到頁數');
    }
    for (const it of pg.items) if (!uniq.has(qaKey(it))) uniq.set(qaKey(it), it);
  }
  return { total, items: [...uniq.values()], complete: uniq.size === total };
}

/** 依卡名逐一查（重複卡名只查一次）。回傳合併後的條目與「不完整的查詢」。 */
export async function fetchByNames(names, delay, opts = {}) {
  const uniq = new Map(), incomplete = [];
  const list = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
  let i = 0;
  for (const name of list) {
    if (i++) await sleep(delay);
    const r = await fetchQuery({ keyword: name }, delay, opts);
    if (!r.complete) incomplete.push({ name, total: r.total, got: r.items.length });
    for (const it of r.items) if (!uniq.has(qaKey(it))) uniq.set(qaKey(it), it);
    process.stderr.write(`  [${i}/${list.length}] ${name}：${r.items.length}/${r.total}${r.complete ? '' : '（不完整）'}\n`);
  }
  return { items: [...uniq.values()], incomplete, queried: list.length };
}

/** 新條目併進既有快照（以 qaKey 去重；舊條目保留——官網下架的判例也留著當歷史）。 */
export function mergeSnapshot(prev, items, meta = {}) {
  const map = new Map((prev?.items ?? []).map((it) => [qaKey(it), it]));
  let added = 0;
  for (const it of items) if (!map.has(qaKey(it))) { map.set(qaKey(it), it); added++; }
  return { snap: { fetchedAt: new Date().toISOString(), note: '以卡名關鍵字逐一查詢合併（官網列表翻頁會重疊，見 fetch-official-qa.mjs）', ...meta, total: map.size, items: [...map.values()] }, added };
}

/** 規則書裡已收錄的問題（「- **Q**:」開頭的行） */
export function rulesQuestions(md) {
  const set = new Set();
  for (const line of String(md).split('\n')) {
    const m = line.match(/^\s*-\s*\*\*Q\*\*\s*[:：]\s*(.+)$/);
    if (m) set.add(normQ(m[1]));
  }
  return set;
}

/** 某卡包的卡片（站上資料；同一卡包可能按標拆成多檔，例如 M-P-J）。stagingFile 給了就改讀暫存（新卡包還沒併表時）。 */
export function setCards(code, stagingFile = null) {
  if (stagingFile) return JSON.parse(readFileSync(stagingFile, 'utf8'));
  const dir = join(ROOT, 'static/cards');
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json') continue;
    if (!(f === `${code}.json` || f.startsWith(`${code}-`))) continue;
    out.push(...JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  return out;
}
export function setCardIds(code, stagingFile = null) {
  return new Set(setCards(code, stagingFile).filter((c) => c && c.id != null).map((c) => String(c.id).replace(/-\d+$/, '')));
}

export function report(snap, { rulesSet, prev, setIds, product }) {
  const lines = [];
  const byTag = new Map();
  for (const it of snap.items) for (const t of it.tags.length ? it.tags : [{ label: '（無商品）' }]) byTag.set(t.label, (byTag.get(t.label) || 0) + 1);
  lines.push(`官方 Q&A（標準）快照共 ${snap.items.length} 筆；商品 ${byTag.size} 個`);
  const filt = (it) => (!setIds || it.cards.some((c) => setIds.has(String(c.id)))) && (!product || it.tags.some((t) => t.label.includes(product)));
  const scope = snap.items.filter(filt);
  if (setIds || product) lines.push(`篩選後 ${scope.length} 筆` + (setIds ? `（相關卡牌含該卡包 ${setIds.size} 張卡之一）` : '') + (product ? `（商品名含「${product}」）` : ''));
  const missing = scope.filter((it) => !rulesSet.has(normQ(it.q)));
  lines.push(`規則書沒有收錄：${missing.length} 筆`);
  const prevSet = prev ? new Set(prev.items.map((it) => normQ(it.q))) : null;
  const fresh = prevSet ? scope.filter((it) => !prevSet.has(normQ(it.q))) : [];
  if (prevSet) lines.push(`與上一份快照相比新出現：${fresh.length} 筆`);
  const top = [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`);
  lines.push('各商品筆數（前 12）：' + top.join('／'));
  return { text: lines.join('\n'), missing, fresh, scope };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  const prev = existsSync(SNAP) ? JSON.parse(readFileSync(SNAP, 'utf8')) : null;
  let snap = prev, added = 0, incomplete = [];
  if (args.fromFile) snap = JSON.parse(readFileSync(args.fromFile, 'utf8'));
  else if (args.set) {
    const cards = setCards(args.set, args.staging);
    if (!cards.length) throw new Error(`找不到 ${args.set} 的卡片（站上沒有、也沒給 --staging）`);
    const r = await fetchByNames(cards.map((c) => c.name), args.delay);
    incomplete = r.incomplete;
    ({ snap, added } = mergeSnapshot(prev, r.items, { lastQuery: { set: args.set, names: r.queried } }));
    console.log(`查了 ${r.queried} 個卡名，取得 ${r.items.length} 筆，快照新增 ${added} 筆`);
  } else if (args.names) {
    const r = await fetchByNames(readFileSync(args.names, 'utf8').split(/\r?\n/), args.delay);
    incomplete = r.incomplete;
    ({ snap, added } = mergeSnapshot(prev, r.items, { lastQuery: { namesFile: args.names, names: r.queried } }));
    console.log(`查了 ${r.queried} 個卡名，取得 ${r.items.length} 筆，快照新增 ${added} 筆`);
  } else if (!snap) throw new Error('沒有快照：請先用 --set CODE 或 --names 檔案 抓一次');
  const rulesSet = rulesQuestions(readFileSync(RULES_MD, 'utf8'));
  const setIds = args.set ? setCardIds(args.set, args.staging) : null;
  const r = report(snap, { rulesSet, prev: (args.fromFile || !prev || snap === prev) ? null : prev, setIds: setIds && setIds.size ? setIds : null, product: args.product });
  console.log(r.text);
  if (incomplete.length) {
    console.log(`\n⚠ ${incomplete.length} 個卡名的判例超過一頁、而且翻頁有重疊 ⇒ 這幾張卡的判例**可能不完整**，請到官網手動確認：`);
    for (const x of incomplete) console.log(`  ・${x.name}：取得 ${x.got}／宣告 ${x.total}`);
  }
  const show = (title, arr) => {
    if (!arr.length) return;
    console.log(`\n── ${title}（${arr.length}）──`);
    for (const it of arr.slice(0, 300)) {
      console.log(`・[${it.tags.map((t) => t.label).join('、') || '—'}] ${it.cards.map((c) => c.name + '#' + c.id).join('＋')}`);
      console.log(`  Q：${it.q}`);
      console.log(`  A：${it.a.replace(/\s+/g, ' ')}`);
    }
  };
  show('與上一份快照相比新出現', r.fresh);
  show('規則書沒有收錄', r.missing);
  if (args.write) {
    if (args.fromFile) throw new Error('--from-file 不寫快照');
    writeFileSync(SNAP, JSON.stringify(snap, null, 1) + '\n');
    console.log('\n已寫入 ' + SNAP);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
