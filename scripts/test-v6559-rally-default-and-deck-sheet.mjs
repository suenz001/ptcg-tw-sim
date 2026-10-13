#!/usr/bin/env node
/**
 * v6.559 守衛（站長 2026-10-13 兩項要求）：
 *   ①「幫我把錦標賽的玩家建立社群賽預設為5分鐘(目前好像是預設30分鐘，大家都會沒改到，導致一場比賽要等很久才能開賽)」
 *   ②「在 牌組編輯器 匯出的功能，增加匯出牌組構築表的功能，然玩家們去報名道館賽的時候可以直接把這個列印出來」
 *      （預覽站長確認：「你的套牌構築表ok，就照這個製作吧」；並要求注意事項加上網址 www.ptcg-tw-sim.com）
 *
 *   R：社群賽募集時間——預設 5、全檔沒有其他地方改回別的值、送出帶的就是它、伺服器接受 5 且真的用它算截止時間；過時的「網站賽避讓」說明刪除。
 *   D：套牌構築表——deck-sheet.ts 的資料模型與 HTML（實際用預組產生）、牌組編輯器接線（抽出 exportDeckSheet 本體實跑）。
 *   E：真瀏覽器——每一副預組的構築表印成 A4 都是 1 頁、沒有欄位超出紙張。
 * 【H】BASE（v6.558）：R1／R5／R6、D 全紅；R2～R4 綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build, transform } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.558。
const BASE_SHA = 'd3cc3a50';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

// ── R：社群賽募集時間 ─────────────────────────────────────────────────────
function rally(src, server) {
  const m = src.match(/let tProposeRally = \$state\((\d+)\);/);
  const init = m ? Number(m[1]) : null;
  const i = src.indexOf('bind:value={tProposeRally}');
  const sel = i >= 0 ? src.slice(i, src.indexOf('</select>', i)) : '';
  const opts = [...sel.matchAll(/<option value=\{(\d+)\}>/g)].map((x) => Number(x[1]));
  const srvM = server.match(/const rallyMin = \[([\d,\s]+)\]\.includes\(Number\(b\.rallyMin\)\)/);
  const allowed = srvM ? srvM[1].split(',').map((x) => Number(x.trim())) : [];
  // 審查 P2：其他地方把值改掉（開表單、送出後、$effect）玩家看到的就不是 5 ⇒ 宣告以外不得再賦值
  const assigns = (src.match(/\btProposeRally\s*=(?!=)/g) || []).length;
  const declAssign = (src.match(/let tProposeRally\s*=/g) || []).length;
  return {
    R1: init === 5,
    R2: opts.length >= 3 && opts.includes(5) && opts.includes(init ?? 5),
    R3: /tApi\('\/propose', \{[^}]*rallyMin: tProposeRally, /.test(src),          // 審查 P3：只接受原樣傳出
    R4: allowed.includes(5) && /registrationCloseAt: now \+ rallyMin \* 60000/.test(server),
    R5: assigns - declAssign === 0 && declAssign === 1 && init === 5,
    R6: !src.includes('但若接近網站預定賽事舉辦時間則不開放'),
    info: JSON.stringify({ init, opts, allowed, assigns, declAssign }),
  };
}

// ── D：套牌構築表 ─────────────────────────────────────────────────────────
async function loadSheet(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/decks/deck-sheet.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6559-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;export const dev=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export * from '${p('src/lib/decks/deck-sheet')}';\nexport { PRESET_DECKS } from '${p('src/lib/decks/presets')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

async function sheet(M, srcRoot) {
  const r = {};
  if (!M) { for (const k of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']) r[k] = false; return r; }
  // D1：每一副預組都 60 張、各欄小計加總＝總計、寶可夢都有角標與編號（編號不含斜線）、欄位分類照子類型
  const bad = [];
  for (const d of M.PRESET_DECKS) {
    const m = M.buildDeckSheetModel(d.entries, pool);
    const sum = m.subtotal.pokemon + m.subtotal.items + m.subtotal.supporters + m.subtotal.stadiums + m.subtotal.energies;
    if (m.total !== 60 || sum !== 60 || m.unknown.length) bad.push(`${d.name} total=${m.total} sum=${sum} unknown=${m.unknown.length}`);
    for (const p of m.pokemon) if (!p.setCode || !p.number || p.number.includes('/')) bad.push(`${d.name} ${p.name} 缺角標/編號`);
    const want = { Supporter: 'supporters', Stadium: 'stadiums', Item: 'items', PokemonTool: 'items' };
    for (const e of d.entries) { const c = pool.get(String(e.cardId)); if (c?.supertype !== 'Trainer' || !want[c.subtype]) continue;
      if (!m[want[c.subtype]].some((x) => x.name === c.name)) bad.push(`${d.name} ${c.name}(${c.subtype}) 不在 ${want[c.subtype]}`); }
  }
  r.D1 = M.PRESET_DECKS.length >= 5 && bad.length === 0; r.D1n = bad.slice(0, 4).join(' ｜ ');
  // D2：合併規則——同一印刷的寶可夢合併；訓練家依名稱合併（跨印刷）；傳說競技場左右半合成一列
  {
    const pk = M.PRESET_DECKS[0].entries.map((e) => pool.get(String(e.cardId))).find((c) => c?.supertype === 'Pokemon');
    const supIds = [...pool.values()].filter((c) => c.name === '老大的指令').map((c) => String(c.id));
    // 審查：11526／12319 是不同 id 但同名同角標同編號（含羞苞 SV8a 001），要合成一列
    const ents = [{ cardId: '11526', count: 2 }, { cardId: '12319', count: 1 }, { cardId: supIds[0], count: 1 }, { cardId: supIds[supIds.length - 1], count: 2 },
      { cardId: '19622', count: 2 }, { cardId: '19622-1', count: 2 }];
    const m = M.buildDeckSheetModel(ents, pool);
    r.D2 = !!pk && supIds.length >= 2 && m.pokemon.length === 1 && m.pokemon[0].count === 3 && m.pokemon[0].name === '含羞苞' && m.supporters.length === 1 && m.supporters[0].count === 3
      && m.stadiums.length === 1 && m.stadiums[0].name === '傳說的山頂' && m.stadiums[0].count === 4 && m.total === 10;
    r.D2n = JSON.stringify({ pk: m.pokemon, sup: m.supporters, st: m.stadiums, total: m.total, supIds: supIds.length });
  }
  r.D3 = M.sheetCollectorNo('044/074') === '044' && M.sheetCollectorNo('151/103,152/103') === '151,152' && M.sheetCollectorNo('SV-P 12') === 'SV-P 12' && M.sheetCollectorNo('') === '' && M.sheetCollectorNo(undefined) === '';
  // D4：HTML 內容（表頭欄位、注意事項、站長要求的網址、跳脫、不用官方商標字樣、數字正確）
  {
    const m = M.buildDeckSheetModel(M.PRESET_DECKS[2].entries, pool);
    const h = M.deckSheetHtml(m, { deckName: '<b>測試&牌組</b>', date: new Date(2026, 9, 13) });
    const need = ['套牌構築表', '比賽名稱', '舉辦地點', '姓名', '參賽編號', '來自地區', '擴充包角標', '集換NO.', '能量', '物品／寶可夢道具', '支援者', '競技場', '小計', '總計', '注意事項', 'www.ptcg-tw-sim.com', '2026/10/13'];
    const miss = need.filter((x) => !h.includes(x));
    r.D4 = miss.length === 0 && h.includes('&lt;b&gt;測試&amp;牌組&lt;/b&gt;') && !h.includes('<b>測試') && !/Nintendo|GAME FREAK/.test(h)
      && m.pokemon.every((p) => new RegExp(`<td(?: class="c x?s")?>${p.setCode}</td><td(?: class="c x?s")?>${p.number}</td><td class="n">${p.count}</td>`).test(h))
      && h.includes(`<td class="n" style="width:auto">${m.total}</td>`);
    r.D4n = '缺：' + miss.join(',');
  }
  // D5：牌組裡有卡池找不到的卡 ⇒ 表上提醒手寫補上、仍算進總計
  {
    const m = M.buildDeckSheetModel([{ cardId: 'no-such-card', count: 2 }, { cardId: M.PRESET_DECKS[0].entries[0].cardId, count: 1 }], pool);
    const h = M.deckSheetHtml(m, {});
    r.D5 = m.unknown.length === 1 && m.total === 3 && /請手寫補上/.test(h);
  }
  // D8：特典卡角標印卡面的 M-P／SV-P（內部拆檔後綴 -H/-I/-J 不印）；一般角標原樣
  {
    const m = M.buildDeckSheetModel([{ cardId: '17975', count: 1 }], pool);
    r.D8 = typeof M.sheetSetCode === 'function' && M.sheetSetCode('M-P-J') === 'M-P' && M.sheetSetCode('SV-P-I') === 'SV-P' && M.sheetSetCode('SV9a') === 'SV9a'
      && m.pokemon[0]?.setCode === 'M-P' && m.pokemon[0]?.number === '059';
    r.D8n = JSON.stringify(m.pokemon);
  }
  // D9：count 是字串（JSON 匯入）也照數字加；名稱、角標都有跳脫
  {
    const fake = new Map(pool);
    fake.set('xss1', { id: 'xss1', name: '<i>壞</i>', supertype: 'Pokemon', setCode: '<b>', collectorNumber: '1/2' });
    const m = M.buildDeckSheetModel([{ cardId: 'xss1', count: '2' }, { cardId: 'xss1', count: '2' }], fake);
    const h = M.deckSheetHtml(m, {});
    r.D9 = m.total === 4 && m.pokemon[0]?.count === 4 && h.includes('&lt;i&gt;壞&lt;/i&gt;') && /<td(?: class="c x?s")?>&lt;b&gt;<\/td>/.test(h) && !h.includes('<i>壞');
  }
  // D6／D7：牌組編輯器接線——抽出 exportDeckSheet 本體實跑（開新分頁；被擋時改下載 .html）
  const src = readFileSync(join(srcRoot, 'src/routes/decks/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const a = src.indexOf('// >>> v6559-deck-sheet'), b = src.indexOf('// <<< v6559-deck-sheet');
  const blk = a >= 0 && b > a ? (await transform(src.slice(a, b), { loader: 'ts' })).code : '';   // 去掉 TS 型別
  const nBtn = (src.match(/onclick=\{exportDeckSheet\}/g) || []).length;
  r.D6 = nBtn === 2 && (src.match(/onclick=\{exportDeckSheet\} disabled=\{!active \|\| active\.entries\.length === 0 \|\| !poolReady\}/g) || []).length === 2 && /import \{ buildDeckSheetModel, deckSheetHtml \} from '\$lib\/decks\/deck-sheet';/.test(src);
  r.D6n = `按鈕數 ${nBtn}`;
  if (blk) {
    const run = (blocked) => {
      const calls = { open: [], dl: [], blobs: [], revoked: [] };
      const fakeDoc = { createElement: () => ({ set href(v) { this._h = v; }, get href() { return this._h; }, set download(v) { this._d = v; }, get download() { return this._d; }, click() { calls.dl.push(this._d); } }) };
      const fakeWin = { open: (u) => { calls.open.push(u); return blocked ? null : {}; } };
      const URLx = { createObjectURL: (bl) => { calls.blobs.push(bl); return 'blob:x'; }, revokeObjectURL: (u) => calls.revoked.push(u) };
      class B { constructor(parts, opt) { this.parts = parts; this.type = opt?.type; } }
      // eslint-disable-next-line no-new-func
      const fn = new Function('active', 'poolById', 'buildDeckSheetModel', 'deckSheetHtml', 'window', 'document', 'URL', 'Blob',
        blk.replace(/function exportDeckSheet\(\)/, 'return function exportDeckSheet()'));
      const f = fn({ name: '測試牌組', entries: M.PRESET_DECKS[0].entries }, pool, M.buildDeckSheetModel, M.deckSheetHtml, fakeWin, fakeDoc, URLx, B);
      f(); calls.revokedAfter1 = calls.revoked.length; f();   // 第二次匯出才釋放第一次的網址
      return calls;
    };
    let ok1, ok2;
    try { ok1 = run(false); ok2 = run(true); } catch (e) { r.D7 = false; r.D7n = 'ERR ' + e.message; return r; }
    r.D7 = ok1.dl.length === 0 && ok1.blobs[0]?.type?.startsWith('text/html') && String(ok1.blobs[0].parts[0]).includes('套牌構築表')
      && String(ok1.blobs[0].parts[0]).includes('牌組：測試牌組') && ok1.revokedAfter1 === 0 && ok1.revoked.length === 1 && ok1.open.length === 2
      && ok2.dl.length === 2 && /^套牌構築表-測試牌組\.html$/.test(ok2.dl[0]);
    r.D7n = JSON.stringify({ open: ok1.open.length, dl: ok2.dl });
  } else { r.D7 = false; r.D7n = '找不到 v6559-deck-sheet 區塊'; }
  return r;
}

const SERVER = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const GAME = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
const R = rally(GAME, SERVER);
const M = await loadSheet(ROOT);
const D = await sheet(M, ROOT);
const LABEL = {
  R1: '★★★ R1 發起社群賽的募集時間預設 5 分鐘',
  R2: '★★ R2 下拉選單有 5 分鐘、預設值在選項裡',
  R3: '★★ R3 送出時原樣帶 tProposeRally',
  R4: '★ R4 正對照：伺服器接受 5 分鐘，且用 rallyMin 算報名截止',
  R5: '★★★ R5 宣告以外沒有任何地方再改 tProposeRally（開表單、送出後、$effect 都不會改回 30）',
  R6: '★ R6 過時的「接近網站預定賽事時間則不開放」說明已刪除（伺服器 v0.70 起已無此限制）',
  D1: '★★★ D1 每一副預組：總計 60、各欄小計加總正確、寶可夢都有角標與編號、訓練家分欄照子類型',
  D2: '★★★ D2 合併規則：同印刷寶可夢合併、訓練家依名稱合併、傳說競技場左右半合成一列（張數＝實體張數）',
  D3: '★★ D3 集換編號只寫斜線前',
  D4: '★★★ D4 HTML：表頭欄位、注意事項、網址 www.ptcg-tw-sim.com、名稱跳脫、不使用官方商標字樣、寶可夢列與總計數字正確',
  D5: '★★ D5 卡池找不到的卡：表上提醒手寫補上、仍算進總計',
  D6: '★★ D6 牌組編輯器兩個分支都有「匯出套牌構築表」按鈕、import 唯一來源',
  D8: '★★★ D8 特典卡角標印卡面的 M-P／SV-P（不印內部拆檔後綴），編號照斜線前',
  D9: '★★ D9 張數是字串也照數字加；卡名、角標都有跳脫',
  D7: '★★★ D7 exportDeckSheet 實跑：開新分頁；被擋時改下載 .html；網址在下一次匯出時釋放（不開計時器）',
};
const info = { R1: R.info, R2: R.info, R5: R.info, D1: D.D1n, D2: D.D2n, D4: D.D4n, D6: D.D6n, D7: D.D7n, D8: D.D8n };
for (const k of Object.keys(LABEL)) ok(LABEL[k], (k[0] === 'R' ? R : D)[k], info[k]);

// ── E：真瀏覽器，每副預組印成 A4 一頁 ───────────────────────────────────────
console.log('\n【E】真瀏覽器：預組構築表印成 A4');
const chromium = M ? pwChromium('v6.559 套牌構築表') : null;
if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.559 套牌構築表');
  if (browser) {
    try {
      const pg = await browser.newPage();
      const overOf = () => pg.evaluate(() => { const s = document.querySelector('.sheet'); const R = s.getBoundingClientRect();
        return [...s.querySelectorAll('table')].filter((t) => t.getBoundingClientRect().right > R.right + 0.5).length; });
      // 審查：E1 原本不檢查字被截成「…」⇒ 有內容的格子 scrollWidth 不可超過 clientWidth
      const clipOf = () => pg.evaluate(() => [...document.querySelectorAll('.sheet td')].filter((td) => td.textContent.trim() && td.scrollWidth > td.clientWidth + 1).map((td) => td.textContent.trim()));
      const res = [];
      for (const d of M.PRESET_DECKS) {
        await pg.setContent(M.deckSheetHtml(M.buildDeckSheetModel(d.entries, pool), { deckName: d.name }));
        await pg.emulateMedia({ media: 'print' });
        const pdf = await pg.pdf({ format: 'A4' });
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
        res.push({ name: d.name, pages, over: await overOf(), clip: await clipOf() });
      }
      // 極端牌組：物品 40 種、支援者 18 種（列高會自動縮小）——仍必須 A4 一頁
      {
        const items = [...pool.values()].filter((c) => c.supertype === 'Trainer' && c.subtype === 'Item');
        const sups = [...pool.values()].filter((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter');
        const names = new Set(); const ents = [];
        for (const c of items) { if (names.has(c.name)) continue; names.add(c.name); ents.push({ cardId: c.id, count: 1 }); if (ents.length >= 40) break; }
        for (const c of sups) { if (names.has(c.name)) continue; names.add(c.name); ents.push({ cardId: c.id, count: 1 }); if (ents.length >= 58) break; }
        const hm = M.buildDeckSheetModel(ents, pool);
        await pg.setContent(M.deckSheetHtml(hm, { deckName: '極端測試' }));
        await pg.emulateMedia({ media: 'print' });
        const pdf = await pg.pdf({ format: 'A4' });
        res.push({ name: `極端（物品 ${hm.items.length}／支援者 ${hm.supporters.length}）`, pages: (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, over: await overOf(), clip: await clipOf(), heavy: hm.items.length >= 40 });
      }
      // 最長卡名（達克萊伊＆克雷色利亞LEGEND，16 字）＋最長訓練家名，一般密度不可截字
      {
        const longest = (pred) => [...pool.values()].filter(pred).sort((a, b) => b.name.length - a.name.length)[0];
        const ents = [{ cardId: '20059', count: 1 }, { cardId: longest((c) => c.supertype === 'Pokemon').id, count: 1 },
          { cardId: longest((c) => c.supertype === 'Trainer' && c.subtype === 'Item').id, count: 1 },
          { cardId: longest((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter').id, count: 1 },
          { cardId: longest((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium').id, count: 1 },
          { cardId: longest((c) => c.supertype === 'Energy').id, count: 1 }];
        await pg.setContent(M.deckSheetHtml(M.buildDeckSheetModel(ents, pool), { deckName: '長名稱' }));
        await pg.emulateMedia({ media: 'print' });
        const pdf = await pg.pdf({ format: 'A4' });
        res.push({ name: '最長卡名', pages: (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, over: await overOf(), clip: await clipOf(), longest: true });
      }
      // 審查 P3：寶可夢 32 種＋能量 8 種（最長名稱）也要 1 頁；且手寫格在密集排版仍 ≥7mm、長牌組名稱不擠窄手寫區
      {
        const pks = [...pool.values()].filter((c) => c.supertype === 'Pokemon').sort((a, b) => b.name.length - a.name.length);
        const ens = [...new Map([...pool.values()].filter((c) => c.supertype === 'Energy').map((c) => [c.name, c])).values()];
        const seen = new Set(); const ents = [];
        for (const c of pks) { if (seen.has(c.name)) continue; seen.add(c.name); ents.push({ cardId: c.id, count: 1 }); if (ents.length >= 32) break; }
        for (const c of ens.slice(0, 8)) ents.push({ cardId: c.id, count: 1 });
        await pg.setContent(M.deckSheetHtml(M.buildDeckSheetModel(ents, pool), { deckName: '超長的牌組名稱'.repeat(8) }));
        await pg.emulateMedia({ media: 'print' });
        const pdf = await pg.pdf({ format: 'A4' });
        const geo = await pg.evaluate(() => { const mm = 96 / 25.4; const tds = [...document.querySelectorAll('.info td')];
          return { minH: Math.min(...tds.map((x) => x.getBoundingClientRect().height)) / mm, w: document.querySelector('.info').getBoundingClientRect().width / mm, dense: !!document.querySelector('.sheet.dense') }; });
        res.push({ name: '寶可夢 32＋能量 8＋長牌組名', pages: (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, over: await overOf(), clip: await clipOf(), dense32: geo });
        ok('★★[E3] 密集排版時參賽資料手寫格仍 ≥7mm、長牌組名稱不擠窄手寫區（≥80mm）', geo.dense && geo.minH >= 6.9 && geo.w >= 80, JSON.stringify(geo));
      }
      const bad = res.filter((x) => x.pages !== 1 || x.over !== 0 || x.clip.length);
      ok('★★★[E1] 每一副預組＋物品 40 種＋最長卡名：構築表 A4 剛好 1 頁、沒有表格超出紙張、沒有字被截', res.length >= 7 && res.some((x) => x.heavy) && res.some((x) => x.longest) && bad.length === 0, JSON.stringify(bad.slice(0, 4)));
      // 正對照：同一套量測抓得到超出（把一欄寬度撐到 120mm）、抓得到 2 頁（列高撐到 12mm）
      const base0 = M.deckSheetHtml(M.buildDeckSheetModel(M.PRESET_DECKS[0].entries, pool), {});
      await pg.setContent(base0.replace('grid-template-columns: 83mm 48mm 48mm;', 'grid-template-columns: 83mm 48mm 120mm;'));
      await pg.emulateMedia({ media: 'print' });
      const ctl = await overOf();
      await pg.setContent(base0.replace(/--rh:[\d.]+mm/, '--rh:12mm'));
      const pdf2 = await pg.pdf({ format: 'A4' });
      const pages2 = (pdf2.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      ok('★★[E2 正對照] 欄位撐寬／列高撐高時，E1 的量測抓得到超出與分頁', ctl > 0 && pages2 >= 2, JSON.stringify({ ctl, pages2 }));
    } finally { await browser.close(); }
  }
}

console.log('\n【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6559 H', '需要 v6.558 commit');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6559b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src oracle-admin/server_admin_patch.js | tar -x -C "${tmp}"`]);
    const BR = rally(readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n'), readFileSync(join(tmp, 'oracle-admin/server_admin_patch.js'), 'utf8'));
    const BD = await sheet(await loadSheet(tmp), tmp);
    for (const k of ['R1', 'R5', 'R6']) ok(`★★★[H] v6.558：${k} 紅`, BR[k] === false, BR.info);
    for (const k of ['R2', 'R3', 'R4']) ok(`★[H 正對照] v6.558：${k} 綠`, BR[k] === true, BR.info);
    for (const k of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']) ok(`★★★[H] v6.558：${k} 紅（沒有構築表功能）`, BD[k] === false);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
console.log(`\n=== v6.559 社群賽募集預設 5 分鐘＋套牌構築表：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
