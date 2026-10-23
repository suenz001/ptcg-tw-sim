#!/usr/bin/env node
/**
 * v6.594 守衛：牌組公布欄明細「縮圖／文字」牌表與大圖檢視（站長 2026-10-23 核准第一期）
 *
 *   站長裁定：排序依類型「寶可夢 → 物品 → 支援者 → 競技場 → 能量」（同類依卡名），而且與牌組編輯器「共用一份」判準。
 *   計畫：E:\ptcg-tw-sim-local\deck-posts-ui-plan\plan.md 第一期（Astra 6.0 規劃、站長核准）。
 *
 *   U：純邏輯（$lib/deck-posts/detail-view.ts、$lib/decks/deck-order.ts）實跑
 *      ⭐U7 共用排序與 BASE 牌組編輯器原本的就地排序，在全卡池（打亂 5 次）逐張相同 ⇒ 牌組編輯器行為不變
 *   S：接線（/decks 改讀共用判準、沒有第二份；明細縮圖走 cardThumb＋retryImg＋lazy；大圖走 pageScrollLock；換篇／關明細清掉大圖）
 *   B：真瀏覽器（build/，API 與卡圖都用本機假資料，不連外）：
 *      預設縮圖、精確卡號與張數、舊卡號對照、未知卡片、60 種卡不截斷、文字模式零卡圖請求、大圖＋前後卡＋Esc 只關最上層＋焦點、
 *      關明細後換篇不殘留、失敗圖片不換卡背、手機背景鎖引用計數、320／390／430／1280 欄數、短螢幕、深淺色
 *   H：HEAD-FAIL（BASE v6.593：沒有模組 ⇒ U、S 逐條紅）
 *
 * Run: node scripts/test-v6594-deck-post-thumbs.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, statSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build, transform } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';
import { loadLivePool } from './lib/ai-sim-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須留在 main 上（IRON_RULES Rule 45）：v6.593
const BASE_SHA = 'b23f5147c33f1e5ec918f1bc78f47a923bf62333';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));
const DP_REL = 'src/routes/deck-posts/+page.svelte', DECKS_REL = 'src/routes/decks/+page.svelte';

// ── 卡池（真資料）＋挑測試用的卡 ──
const POOL = loadLivePool(ROOT);
ok('★ 前置：卡池載得到（>3000 張）', POOL.size > 3000, POOL.size);
const all = [...POOL.values()].filter((c) => typeof c.imageUrl === 'string' && /^https:\/\/asia\.pokemon-card\.com\/tw\/card-img\/tw\d+\.png$/.test(c.imageUrl))
  .sort((a, b) => String(a.id).localeCompare(String(b.id)));
const pick = (pred, n) => all.filter(pred).slice(0, n);
const isItem = (c) => c.supertype === 'Trainer' && c.subtype !== 'Supporter' && c.subtype !== 'Stadium';
const FIX = {
  energy: pick((c) => c.supertype === 'Energy', 2),
  stadium: pick((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium', 1),
  supporter: pick((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter', 2),
  item: pick(isItem, 2),
  poke: pick((c) => c.supertype === 'Pokemon', 3),
};
ok('★ 前置：五種類型的卡都挑得到', Object.values(FIX).every((a) => a.length >= 1), JSON.stringify(Object.fromEntries(Object.entries(FIX).map(([k, v]) => [k, v.length]))));
// 舊卡號：M5 日版 50220 ⇒ 台版 19145（cardIdMigration 的既有對照）
const MIG_FROM = '50220', MIG_TO = '19145';
const migCard = POOL.get(MIG_TO);
ok('★ 前置：舊卡號對照的目標卡在卡池裡', !!migCard);
// 故意打亂投稿順序（能量 → 競技場 → 支援者 → 物品 → 寶可夢）＋舊卡號＋未知卡號
const ENTRIES = [
  ...FIX.energy.map((c, i) => ({ cardId: String(c.id), count: 4 + i })),
  ...FIX.stadium.map((c) => ({ cardId: String(c.id), count: 2 })),
  ...FIX.supporter.map((c, i) => ({ cardId: String(c.id), count: 3 - i })),
  { cardId: '99999999', count: 2 },
  ...FIX.item.map((c, i) => ({ cardId: String(c.id), count: 4 - i })),
  ...FIX.poke.map((c, i) => ({ cardId: String(c.id), count: 1 + i })),
  { cardId: MIG_FROM, count: 1 },
];
const SIXTY = all.slice(100, 160).map((c) => ({ cardId: String(c.id), count: 1 }));

// ── 純邏輯模組（srcRoot 沒有那支檔 ⇒ null，HEAD-FAIL 用） ──
async function loadMods(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/deck-posts/detail-view.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6594-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export * from '${p('src/lib/deck-posts/detail-view')}';\nexport * from '${p('src/lib/decks/deck-order')}';\nexport { migrateCardId } from '${p('src/lib/decks/cardIdMigration')}';\nexport { cardThumb } from '${p('src/lib/cards/thumb')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return { ...(await import(pathToFileURL(O).href)) };
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

/** BASE 牌組編輯器的就地排序（從 BASE 原始碼切出來實跑，不抄第二份）；切不到 ⇒ null */
async function baseDecksSorter() {
  if (!hasBaseCommit(ROOT, BASE_SHA)) return null;
  const src = normEol(readBaseBlob(ROOT, BASE_SHA, DECKS_REL).out || '');
  const a = src.indexOf('    const rank = (c: Card) => {'), b = src.indexOf('    return result;', a);
  if (a < 0 || b < 0) return null;
  const body = src.slice(a, b).replace('result.sort(', 'return (result) => result.sort(');
  const js = (await transform('function make(){\n' + body + '\n}', { loader: 'ts' })).code;
  return new Function(js + '\nreturn make();')();
}

async function unitChecks(M) {
  const r = {};
  if (!M || typeof M.buildDetailGroups !== 'function') return r;
  const lookup = (id) => POOL.get(id) ?? POOL.get(M.migrateCardId(id));
  const G = M.buildDetailGroups(ENTRIES, lookup);
  const flat = G.flatMap((g) => g.items.map((it) => ({ g: g.group, ...it })));
  const rankOf = (id) => { const c = lookup(id); return c ? M.deckCardRank(c) : 9; };
  const ranks = flat.map((x) => rankOf(x.cardId));
  // U1 分組與順序：寶可夢 → 物品 → 支援者 → 競技場 → 能量 → 未知；組名、每組總張數
  r.U1 = G.map((g) => g.group).join(',') === '寶可夢,訓練家,能量,未知卡片'
    && ranks.every((v, i) => i === 0 || ranks[i - 1] <= v)
    && G.every((g) => g.total === g.items.reduce((n, x) => n + x.count, 0))
    && G.reduce((n, g) => n + g.total, 0) === ENTRIES.reduce((n, e) => n + e.count, 0)
    // ⭐v6.597（Rule 40）：站長裁定寶可夢道具從物品分出來（物品 1 → 寶可夢道具 2 → 支援者 3 → 競技場 4 → 能量 5）⇒ 序號跟著換；這副測試牌組沒有寶可夢道具，意圖（物品 2、支援者 2、競技場 1 依序）不變
    && flat.filter((x) => x.g === '訓練家').map((x) => rankOf(x.cardId)).join('') === (typeof M.DECK_RANK === 'object' ? '11334' : '11223');
  r.U1n = JSON.stringify({ groups: G.map((g) => [g.group, g.total, g.items.length]), ranks });
  // U2 精確卡號：一個條目一格（不依張數展開、不合併）、圖片就是那張印刷；舊卡號用對照後的卡
  const mig = flat.find((x) => x.cardId === MIG_FROM);
  r.U2 = flat.length === ENTRIES.length && flat.every((x) => { const c = lookup(x.cardId); return !c || (x.imageUrl === c.imageUrl && x.name === c.name); })
    && !!mig && mig.imageUrl === migCard.imageUrl && new Set(flat.map((x) => x.key)).size === flat.length
    && flat.every((x) => x.count === ENTRIES.find((e) => x.key.endsWith('_' + e.cardId)).count);
  r.U2n = JSON.stringify(flat.slice(0, 3));
  // U2b 同名不同印刷（不同卡號）：不合併、維持投稿裡的先後（兩種順序都試，證明不是剛好排對）
  const byName = new Map(); for (const c of all) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  const twins = [...byName.values()].find((v) => v.length >= 2);
  if (twins) {
    const [a, b] = twins;
    const o1 = M.buildDetailGroups([{ cardId: String(a.id), count: 1 }, { cardId: String(b.id), count: 2 }], lookup).flatMap((g) => g.items).map((x) => x.cardId);
    const o2 = M.buildDetailGroups([{ cardId: String(b.id), count: 2 }, { cardId: String(a.id), count: 1 }], lookup).flatMap((g) => g.items).map((x) => x.cardId);
    r.U2b = o1.join() === [a.id, b.id].map(String).join() && o2.join() === [b.id, a.id].map(String).join();
  }
  // U3 60 種卡不截斷；同一個卡號出現兩次也是兩格、key 不撞
  const G60 = M.buildDetailGroups(SIXTY, lookup);
  const dup = M.buildDetailGroups([SIXTY[0], SIXTY[0]], lookup);
  r.U3 = G60.reduce((n, g) => n + g.items.length, 0) === 60 && M.zoomableItems(G60).length === 60
    && dup[0].items.length === 2 && dup[0].items[0].key !== dup[0].items[1].key;
  // U4 未知卡片：最後一組、沒有圖片 ⇒ 不能開大圖
  const unk = G[G.length - 1];
  const Z = M.zoomableItems(G);
  r.U4 = unk.group === '未知卡片' && unk.items.length === 1 && unk.items[0].imageUrl === '' && /99999999/.test(unk.items[0].name)
    && Z.length === flat.length - 1 && !Z.some((x) => x.cardId === '99999999');
  // U5 上一張／下一張：依畫面順序、不繞回、找不到 ⇒ null
  r.U5 = M.stepZoomKey(Z, Z[0].key, -1) === null && M.stepZoomKey(Z, Z[0].key, 1) === Z[1].key
    && M.stepZoomKey(Z, Z[Z.length - 1].key, 1) === null && M.stepZoomKey(Z, Z[Z.length - 1].key, -1) === Z[Z.length - 2].key
    && M.stepZoomKey(Z, 'nope', 1) === null && M.stepZoomKey(Z, null, 1) === null;
  // U6 顯示方式的記憶：預設縮圖、記得文字、localStorage 壞掉不丟例外
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const d0 = M.loadDetailView(); M.saveDetailView('text'); const d1 = M.loadDetailView();
  globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  let threw = false; let d2; try { M.saveDetailView('text'); d2 = M.loadDetailView(); } catch { threw = true; }
  delete globalThis.localStorage;
  r.U6 = d0 === 'thumb' && d1 === 'text' && store.get(M.DETAIL_VIEW_KEY) === 'text' && !threw && d2 === 'thumb';
  // U7 ⭐ 共用排序 ＝ BASE 牌組編輯器原本的就地排序（全卡池、打亂 5 次逐張相同）⇒ 牌組編輯器行為不變
  const baseSort = await baseDecksSorter();
  if (!baseSort) r.U7 = 'skip';
  else {
    let same = true; const cards = [...POOL.values()];
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let k = 0; k < 5 && same; k++) {
      const shuffled = cards.map((c) => ({ c, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => ({ entry: { cardId: String(x.c.id), count: 1 }, card: x.c }));
      // ⭐v6.597（Rule 40）：站長裁定寶可夢道具從物品分出來、排在物品後面，牌組編輯器一起改 ⇒ 期望值＝BASE 的順序再把寶可夢道具整段移到物品之後
      //   （對 BASE 結果依新序號做穩定排序：同類別內仍是 BASE 的卡名順序）。意圖（兩頁同一份、其他順序與 BASE 逐張相同）不變。
      const baseOut = baseSort(shuffled.slice());
      //   ⚠（v6.597 審查 P3-1）重排用守衛自己寫的固定類別表（依 supertype／subtype 字串），不用被測的 M.deckCardRank ⇒ 不自我參照
      const fixedRank = (c) => (c.supertype === 'Pokemon' ? 0 : c.supertype !== 'Trainer' ? 5 : c.subtype === 'PokemonTool' ? 2 : c.subtype === 'Supporter' ? 3 : c.subtype === 'Stadium' ? 4 : 1);
      const A = (typeof M.DECK_RANK === 'object' ? baseOut.slice().sort((a, b) => fixedRank(a.card) - fixedRank(b.card)) : baseOut).map((x) => x.entry.cardId).join();
      const B = shuffled.slice().sort((a, b) => M.compareDeckCards(a.card, b.card)).map((x) => x.entry.cardId).join();
      same = A === B;
    }
    r.U7 = same && cards.length > 3000;
  }
  return r;
}

function staticChecks(DP, DECKS) {
  const r = {};
  const dp = stripCommentsBlank(DP), dk = stripCommentsBlank(DECKS);
  const blk = (s, tag) => { const a = s.indexOf('>>> ' + tag), b = s.indexOf('<<< ' + tag); return a >= 0 && b > a ? s.slice(a, b) : ''; };
  const markup = blk(DP, 'v6594-deck-post-thumbs-markup'), zoomMk = blk(DP, 'v6594-deck-post-zoom-markup');
  // S1 /decks 讀共用判準、沒有第二份就地排序
  r.S1 = /import \{ compareDeckCards \} from '\$lib\/decks\/deck-order'/.test(dk) && /result\.sort\(\(a, b\) => compareDeckCards\(a\.card, b\.card\)\)/.test(dk)
    && !/const rank = \(c: Card\)/.test(dk) && !/supertype === 'Trainer'[\s\S]{0,80}subtype === 'Supporter'[\s\S]{0,40}return 2/.test(dk);
  // S2 明細：每一張 <img> 都在本版區塊內；縮圖走 cardThumb＋retryImg＋lazy＋預留尺寸；大圖走 retryImg；文字模式不渲染 <img>
  const imgs = dp.match(/<img\b[^>]*>/g) || [];
  const thumbImg = (markup.match(/<img\b[^>]*>/g) || []);
  // ⭐v6.597（Rule 40）：清單標記搬進 {#snippet cardList}（大類別與訓練家小類別共用）⇒ 縮排改了，錨點不看縮排
  const _tb = markup.search(/\{:else\}\n\s*<ul>/);
  const textBranch = _tb >= 0 ? markup.slice(_tb) : '';
  r.S2 = imgs.length === 2 && thumbImg.length === 1 && /src=\{cardThumb\(it\.imageUrl\)\}/.test(thumbImg[0]) && /use:retryImg=\{it\.imageUrl\}/.test(thumbImg[0])
    && /loading="lazy"/.test(thumbImg[0]) && /width="245" height="342"/.test(thumbImg[0])
    && (zoomMk.match(/<img\b[^>]*>/g) || []).length === 1 && /use:retryImg=\{\{ url: zoomItem\.imageUrl/.test(zoomMk)
    && textBranch.length > 50 && !/<img/.test(textBranch);
  // S3 大圖：pageScrollLock、點背景只關這一層（內層 stopPropagation）、Esc 只關大圖；換篇與關明細清掉 zoomKey
  const od = dp.slice(dp.indexOf('async function openDetail'), dp.indexOf('function closeDetail'));
  const cd = dp.slice(dp.indexOf('function closeDetail'), dp.indexOf('const detailRows'));
  r.S3 = /<div use:pageScrollLock class="dpz-backdrop" role="presentation" onclick=\{closeZoom\}>/.test(zoomMk) && /onclick=\{\(e\) => e\.stopPropagation\(\)\}/.test(zoomMk)
    && /zoomKey = null/.test(od) && /zoomKey = null/.test(cd) && /<svelte:window onkeydown=\{onZoomKey\} \/>/.test(dp);
  // S4 本頁沒有多出媒體查詢（數量被其他守衛釘住）、沒有就地改 body 或攔 wheel
  r.S4 = (dp.match(/@media/g) || []).length === (stripCommentsBlank(normEol(readBaseBlob(ROOT, BASE_SHA, DP_REL).out || '')).match(/@media/g) || []).length
    && !/document\.body\.style/.test(blk(DP, 'v6594-deck-post-zoom')) && !/addEventListener\('wheel'/.test(DP.slice(DP.indexOf('v6594-deck-post-zoom')));
  return r;
}

// ── U、S ──
const M = await loadMods(ROOT);
const U = await unitChecks(M);
const UL = {
  U1: '★★★ U1 分組與順序：寶可夢 → 物品 → 支援者 → 競技場 → 能量 → 未知卡片；每組總張數正確',
  U2: '★★★ U2 一個條目一格（精確卡號、不依張數展開、不合併）；圖片就是那張印刷；舊卡號用對照後的卡',
  U2b: '★★ U2b 同名不同印刷：兩格、維持投稿裡的先後（兩種順序都對）',
  U3: '★★ U3 60 種卡不截斷；同卡號兩個條目是兩格',
  U4: '★★ U4 查不到的卡：放最後、沒有圖片、不能開大圖',
  U5: '★★ U5 上一張／下一張：依畫面順序、到頭到尾停住、找不到回 null',
  U6: '★★ U6 顯示方式：預設縮圖、記得文字、瀏覽器存不了也不丟例外',
};
for (const k of Object.keys(UL)) ok(UL[k], U[k] === true, U[k + 'n']);
if (U.U7 === 'skip') shallowSkip('U7（缺 BASE ' + BASE_SHA + '）');
else ok('★★★ U7 共用排序與 BASE 牌組編輯器原本的就地排序，在全卡池打亂 5 次逐張相同（牌組編輯器行為不變）', U.U7 === true);
const S = staticChecks(R(DP_REL), R(DECKS_REL));
const SL = {
  S1: '★★★ S1 牌組編輯器改讀共用判準 $lib/decks/deck-order，沒有留第二份就地排序（Rule 38）',
  S2: '★★★ S2 明細只有兩張 <img>：縮圖（cardThumb＋retryImg＋lazy＋預留 245×342）與大圖（官方原圖＋retryImg）；文字模式不渲染圖片',
  S3: '★★★ S3 大圖用 pageScrollLock、點背景只關這一層、Esc 只關大圖；換篇與關明細都清掉 zoomKey',
  S4: '★★ S4 本頁媒體查詢數量不變、沒有就地改 body 或自己攔滾輪',
};
for (const k of Object.keys(SL)) ok(SL[k], S[k] === true);

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6594b-'));
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const bU = await unitChecks(await loadMods(tmp));
    const bS = staticChecks(normEol(readFileSync(join(tmp, DP_REL), 'utf8')), normEol(readFileSync(join(tmp, DECKS_REL), 'utf8')));
    const red = [...['U1', 'U2', 'U2b', 'U3', 'U4', 'U5', 'U6'].filter((k) => bU[k] !== true), ...['S1', 'S2', 'S3'].filter((k) => bS[k] !== true)];
    ok('★★★ HEAD-FAIL：BASE（v6.593）上 U1-U6（含 U2b）、S1-S3 逐條紅', red.length === 10, red.join(','));
    ok('★ HEAD-FAIL 正對照：S4（媒體查詢數量）在 BASE 上也成立（這條守的是「本版沒有多加」）', bS.S4 === true);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ── B：真瀏覽器 ──
const BUILD = process.env.V6594_BUILD || join(ROOT, 'build');
const haveBuild = existsSync(join(BUILD, '404.html'));
const chromium = haveBuild ? pwChromium('v6.594') : null;
if (!haveBuild) console.log('  ENV-SKIP B（沒有 build/）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.594');
  if (browser) {
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const mkPost = (id, entries, name) => ({ id, authorName: '阿明', deckName: name, notes: '', archetype: '', cardTotal: entries.reduce((n, e) => n + e.count, 0), likeCount: 0, downloadCount: 0, commentCount: 0, createdAt: 1760000000000, tournament: null, entries });
    const POSTS = { dp_a: mkPost('dp_a', ENTRIES, '測試牌組 A'), dp_b: mkPost('dp_b', ENTRIES, '測試牌組 B'), dp_60: mkPost('dp_60', SIXTY, '六十種卡') };
    const setReq = [];
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const j = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      const m = u.pathname.match(/^\/api\/deck-posts\/(dp_\w+)$/);
      if (m && POSTS[m[1]]) return j({ post: POSTS[m[1]] });
      if (u.pathname === '/api/deck-posts') return j({ posts: Object.values(POSTS), total: 3 });
      if (u.pathname.startsWith('/api/deck-posts-comments')) return j({ comments: [], hasMore: false });
      if (u.pathname.startsWith('/api/')) return j({});
      if (/^\/cards\/[^/]+\.json$/.test(u.pathname)) setReq.push(u.pathname);
      let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const SVG = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"><rect width="245" height="342" fill="${c}"/></svg>`;
    const BAD = FIX.item[0].imageUrl.match(/(tw\d+)\.png$/)[1];   // 這一張的縮圖、原圖、代理全部失敗
    async function open(vp, { theme = 'light', mobile = false, view = null, post = 'dp_a', delayOfficialMs = 0 } = {}) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(([t, v]) => { try { localStorage.setItem('ptcg_ui_theme', t); if (v) localStorage.setItem('ptcg_dp_detail_view_v1', v); } catch { /* */ } }, [theme, view]);
      const imgReq = [];
      await ctx.route(/asia\.pokemon-card\.com|ptcg-tw-sim-img|weserv/, async (r) => {
        const url = r.request().url(); imgReq.push(url);
        if (delayOfficialMs && /asia\.pokemon-card\.com/.test(url)) await new Promise((res) => setTimeout(res, delayOfficialMs));
        if (url.includes(BAD)) return r.fulfill({ status: 404, body: '' });
        return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG(url.includes('ptcg-tw-sim-img') ? '#4a6' : '#a64') });
      });
      await ctx.route(/firebase|googleapis|gstatic/, (r) => r.fulfill({ status: 404, body: '' }));
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/deck-posts${post ? '?post=' + post : ''}`, { waitUntil: 'load' });
      if (post) await pg.waitForSelector('.deck-table section', { timeout: 30000 });
      else await pg.waitForSelector('.post-card', { timeout: 30000 });
      await pg.waitForTimeout(800);
      return { ctx, pg, imgReq, errs };
    }
    const D = { width: 1280, height: 900 };
    try {
      // B0 列表頁（還沒打開明細）一張卡圖都不載
      { const { ctx, imgReq } = await open(D, { post: null }); ok('★★ B0 列表頁（沒打開明細）一張卡圖都不載', imgReq.length === 0, imgReq.length); await ctx.close(); }
      // B1 預設縮圖：每個條目一格、縮圖站網址就是那張印刷、張數徽章、分組總張數、未知卡片是文字格
      { setReq.length = 0;
        const { ctx, pg, imgReq, errs } = await open(D);
        const info = await pg.evaluate(() => ({
          pressed: document.querySelector('.dpv-bar button.active')?.textContent || '',
          tiles: [...document.querySelectorAll('.dpv-grid > li')].map((li) => ({ src: li.querySelector('img')?.getAttribute('src') || '', cnt: li.querySelector('.dpv-cnt')?.textContent || '', nm: li.querySelector('.dpv-nm')?.textContent || '', lazy: li.querySelector('img')?.getAttribute('loading') || '' })),
          heads: [...document.querySelectorAll('.deck-table section h3')].map((h) => h.textContent.replace(/\s+/g, '')),
        }));
        const lookup = (id) => POOL.get(id) ?? POOL.get(M.migrateCardId(id));
        const exp = M.buildDetailGroups(ENTRIES, lookup).flatMap((g) => g.items);
        const okTiles = info.tiles.length === ENTRIES.length && exp.every((it, i) => {
          const t = info.tiles[i];
          // 故意失敗的那一張（BAD）由 retryImg 換過網址 ⇒ 只驗它的 lazy；它的「失敗外觀」由 B6 驗
          if (it.imageUrl.includes(BAD)) return t.cnt === '×' + it.count && t.nm === it.name && t.lazy === 'lazy';
          return t.cnt === '×' + it.count && t.nm === it.name && (it.imageUrl ? t.src === M.cardThumb(it.imageUrl) && /ptcg-tw-sim-img\/w450\/tw\d+\.webp$/.test(t.src) && t.lazy === 'lazy' : t.src === '');
        });
        const exHeads = M.buildDetailGroups(ENTRIES, lookup).map((g) => g.group + g.total + '張');
        ok('★★★ B1 預設縮圖：每個條目一格、縮圖網址就是那張印刷（縮圖站 webp、lazy）、張數徽章、分組總張數；未知卡片是文字格',
          /縮圖/.test(info.pressed) && okTiles && JSON.stringify(info.heads) === JSON.stringify(exHeads) && errs.length === 0, JSON.stringify({ pressed: info.pressed, n: info.tiles.length, heads: info.heads, t0: info.tiles[0], errs }));
        const mig = info.tiles[exp.findIndex((x) => x.cardId === MIG_FROM)];
        ok('★★ B2 舊卡號（M5 日版 50220）顯示對照後那張卡的圖與卡名', !!mig && mig.nm === migCard.name && mig.src === M.cardThumb(migCard.imageUrl), JSON.stringify(mig));
        ok('★★ B10 明細只載縮圖（沒有官方原圖 PNG）、只抓這副牌用到的卡包', imgReq.every((u) => /ptcg-tw-sim-img/.test(u) || u.includes(BAD) || /weserv/.test(u)) && imgReq.filter((u) => /ptcg-tw-sim-img/.test(u)).length <= exp.length
          && setReq.length > 0 && setReq.length <= new Set(ENTRIES.map((e) => (lookup(e.cardId) || {}).setCode).filter(Boolean)).size + 2, JSON.stringify({ img: imgReq.length, sets: setReq }));
        // B6 失敗圖片：掛上「失敗中」外觀（全站共用的暗框＋卡名），不換成卡背
        await pg.waitForTimeout(1500);
        const bad = await pg.evaluate((b) => { const im = [...document.querySelectorAll('.dpv-grid img')].find((x) => (x.getAttribute('src') || '').includes(b) || (x.src || '').includes(b) || (x.src || '').includes('weserv')); return im ? { retry: im.hasAttribute('data-img-retrying'), src: im.src, alt: im.alt } : null; }, BAD);
        ok('★★ B6 圖片載入失敗：掛上全站共用的「失敗中」外觀並保留卡名（alt），不換成卡背', !!bad && bad.retry && !/back|cardback|卡背/i.test(bad.src) && bad.alt === FIX.item[0].name, JSON.stringify(bad));
        // B4 大圖：官方原圖、資訊、前後卡、Esc 只關大圖、焦點回到縮圖、明細捲動位置不變
        await pg.evaluate(() => { const m = document.querySelector('.modal'); if (m) m.scrollTop = 120; });
        const sc0 = await pg.evaluate(() => document.querySelector('.modal')?.scrollTop ?? -1);
        await pg.locator('.dpv-tile').nth(1).click();
        await pg.waitForSelector('.dpz img');
        const z = M.zoomableItems(M.buildDetailGroups(ENTRIES, lookup));
        const z1 = await pg.evaluate(() => ({ src: document.querySelector('.dpz img')?.getAttribute('src'), info: document.querySelector('.dpz-info')?.textContent.replace(/\s+/g, ' '), prevDis: document.querySelector('.dpz-nav button')?.disabled, focus: document.activeElement?.className || '' }));
        await pg.keyboard.press('ArrowRight');
        const z2 = await pg.evaluate(() => document.querySelector('.dpz img')?.getAttribute('src'));
        await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('ArrowLeft');
        const z3 = await pg.evaluate(() => ({ src: document.querySelector('.dpz img')?.getAttribute('src'), prevDis: document.querySelector('.dpz-nav button')?.disabled }));
        await pg.keyboard.press('ArrowLeft');
        const z3b = await pg.evaluate(() => document.querySelector('.dpz img')?.getAttribute('src'));
        await pg.keyboard.press('Escape');
        await pg.waitForTimeout(200);
        const after = await pg.evaluate(() => ({ zoom: !!document.querySelector('.dpz'), detail: !!document.querySelector('.modal .deck-table'), focusTile: document.activeElement?.classList.contains('dpv-tile') || false, sc: document.querySelector('.modal')?.scrollTop ?? -1 }));
        ok('★★★ B4 大圖：官方原圖、卡名／卡號／此牌組張數、← → 換上一張下一張（到頭停住）、Esc 只關大圖、焦點回到縮圖、明細捲動位置不變',
          z1.src === z[1].imageUrl && z1.info.includes(z[1].name) && z1.info.includes('此牌組 ' + z[1].count + ' 張') && z1.prevDis === false && /dpz-close/.test(z1.focus)
            && z2 === z[2].imageUrl && z3.src === z[0].imageUrl && z3.prevDis === true && z3b === z[0].imageUrl
            && !after.zoom && after.detail && after.focusTile && after.sc === sc0 && sc0 > 0, JSON.stringify({ z1, z2, z3, z3b, after, sc0 }));
        // B5 點大圖背景只關大圖
        await pg.locator('.dpv-tile').nth(0).click(); await pg.waitForSelector('.dpz');
        await pg.mouse.click(5, 5);
        await pg.waitForTimeout(200);
        const b5 = await pg.evaluate(() => ({ zoom: !!document.querySelector('.dpz'), detail: !!document.querySelector('.modal .deck-table') }));
        ok('★★ B5 點大圖背景只關大圖（明細還在）', !b5.zoom && b5.detail, JSON.stringify(b5));
        await ctx.close();
        // B7 大圖開著時關掉明細 ⇒ 大圖一起關；再打開另一篇（同樣的條目、同樣的 key）⇒ 大圖不可以復活
        const o2 = await open(D, { post: 'dp_a' });
        // 同一個頁面內換篇：明細開著 A 的大圖 ⇒ 用網址參數換到 B（站內 openDetail）
        await o2.pg.locator('.dpv-tile').nth(0).click(); await o2.pg.waitForSelector('.dpz');
        await o2.pg.evaluate(() => { document.querySelector('.modal .modal-head .close')?.click(); });   // 大圖蓋著 ⇒ 用程式點明細的 ✕
        await o2.pg.waitForTimeout(200);
        const closed = await o2.pg.evaluate(() => ({ zoom: !!document.querySelector('.dpz'), detail: !!document.querySelector('.modal .deck-table') }));
        await o2.pg.locator('.post-card', { hasText: '測試牌組 B' }).click();
        await o2.pg.waitForSelector('.deck-table section'); await o2.pg.waitForTimeout(300);
        const b7 = await o2.pg.evaluate(() => ({ zoom: !!document.querySelector('.dpz'), title: document.querySelector('.modal-head h2')?.textContent }));
        ok('★★★ B7 大圖開著時關掉明細 ⇒ 大圖一起關；再打開另一篇（同樣的 key）大圖不會復活', !closed.zoom && !closed.detail && !b7.zoom && b7.title === '測試牌組 B', JSON.stringify({ closed, b7 }));
        await o2.ctx.close();
      }
      // B13 大圖沒開時鍵盤零動作：列表搜尋框、明細開著時按 Esc／← →，頁面都不可以 preventDefault（搜尋框 Esc 清空等原生行為要留著），Esc 也不可以關掉明細
      { const watch = (pg) => pg.evaluate(() => { window.__dp = []; window.addEventListener('keydown', (e) => { if (/^(Escape|Arrow)/.test(e.key)) window.__dp.push(e.key + ':' + e.defaultPrevented); }); });
        const o = await open(D, { post: null });
        await watch(o.pg);
        await o.pg.locator('.search input').click(); await o.pg.keyboard.type('ab');
        for (const k of ['Escape', 'ArrowLeft', 'ArrowRight']) await o.pg.keyboard.press(k);
        const listKeys = await o.pg.evaluate(() => window.__dp);
        await o.ctx.close();
        const o2 = await open(D);
        await watch(o2.pg);
        for (const k of ['ArrowLeft', 'ArrowRight', 'Escape']) await o2.pg.keyboard.press(k);
        const detKeys = await o2.pg.evaluate(() => ({ keys: window.__dp, detail: !!document.querySelector('.modal .deck-table'), zoom: !!document.querySelector('.dpz') }));
        ok('★★★ B13 大圖沒開時鍵盤零動作：列表搜尋框與明細按 Esc／← → 都沒有被攔（preventDefault false）、Esc 不會關掉明細',
          listKeys.length === 3 && listKeys.every((x) => x.endsWith(':false')) && detKeys.keys.length === 3 && detKeys.keys.every((x) => x.endsWith(':false')) && detKeys.detail && !detKeys.zoom, JSON.stringify({ listKeys, detKeys }));
        // B14 用滑鼠按「下一張」：焦點留在那顆按鈕（可以連按）；按到最後一張（按鈕變 disabled）⇒ 焦點移到「關閉」，不掉到 body
        await o2.pg.locator('.dpv-tile').nth(0).click(); await o2.pg.waitForSelector('.dpz');
        const nextBtn = o2.pg.locator('.dpz-nav button', { hasText: '下一張' });
        await nextBtn.click(); await o2.pg.waitForTimeout(150);
        const f1 = await o2.pg.evaluate(() => document.activeElement?.textContent || document.activeElement?.tagName);
        await nextBtn.click(); await o2.pg.waitForTimeout(150);
        const f2 = await o2.pg.evaluate(() => document.activeElement?.textContent || document.activeElement?.tagName);
        const total = M.zoomableItems(M.buildDetailGroups(ENTRIES, (id) => POOL.get(id) ?? POOL.get(M.migrateCardId(id)))).length;
        for (let i = 3; i < total; i++) { await nextBtn.click(); await o2.pg.waitForTimeout(60); }
        const f3 = await o2.pg.evaluate(() => ({ el: document.activeElement?.textContent || document.activeElement?.tagName, nextDis: [...document.querySelectorAll('.dpz-nav button')].at(-1)?.disabled }));
        // 鍵盤：焦點在「上一張」一路按 ← 到第一張 ⇒ 焦點移到「下一張」（不掉到 body）；之後多按一下 Enter 只是往後一張，不會關掉大圖
        await o2.pg.locator('.dpz-nav button', { hasText: '上一張' }).focus();
        for (let i = 0; i < total + 2; i++) await o2.pg.keyboard.press('ArrowLeft');
        const f4 = await o2.pg.evaluate(() => ({ el: document.activeElement?.textContent || document.activeElement?.tagName, pos: document.querySelector('.dpz-pos')?.textContent }));
        await o2.pg.keyboard.press('Enter');
        const f5 = await o2.pg.evaluate(() => ({ zoom: !!document.querySelector('.dpz'), pos: document.querySelector('.dpz-pos')?.textContent }));
        ok('★★★ B14 滑鼠按「下一張」焦點留在那顆按鈕（可連按）；到底按鈕 disabled ⇒ 焦點移到反方向那顆（不掉到 body、多按 Enter 不會關掉大圖）；← 走到頭同理',
          /下一張/.test(f1) && /下一張/.test(f2) && f3.nextDis === true && /上一張/.test(f3.el) && /^1 \//.test(f4.pos || '') && /下一張/.test(f4.el) && f5.zoom && /^2 \//.test(f5.pos || ''), JSON.stringify({ f1, f2, f3, f4, f5, total }));
        await o2.ctx.close();
      }
      // B15 大圖（官方原圖）還在下載時：img 已經有尺寸、畫面中央就是同一張卡的縮圖（不是空白、零額外請求）；載完後換成原圖、視窗高度不跳
      { const o3 = await open({ width: 390, height: 844 }, { mobile: true, delayOfficialMs: 3500 });
        const px = async (x, y) => {
          const b64 = (await o3.pg.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } })).toString('base64');
          return o3.pg.evaluate(async (d) => { const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode(); const c = document.createElement('canvas'); c.width = 1; c.height = 1; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }, b64);
        };
        const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 24);
        await o3.pg.locator('.dpv-tile').nth(1).click(); await o3.pg.waitForSelector('.dpz'); await o3.pg.waitForTimeout(700);
        const r1 = await o3.pg.evaluate(() => { const im = document.querySelector('.dpz img'); const b = im.getBoundingClientRect(); return { w: b.width, h: b.height, x: b.x + b.width / 2, y: b.y + b.height / 2, complete: im.complete && im.naturalWidth > 0, dlgH: document.querySelector('.dpz').getBoundingClientRect().height }; });
        const c1 = await px(r1.x, r1.y);
        await o3.pg.waitForTimeout(3800);
        const r2 = await o3.pg.evaluate(() => { const im = document.querySelector('.dpz img'); return { complete: im.complete && im.naturalWidth > 0, dlgH: document.querySelector('.dpz').getBoundingClientRect().height }; });
        const c2 = await px(r1.x, r1.y);
        ok('★★ B15 大圖下載中：img 已有尺寸、畫面中央是同一張卡的縮圖（不是空白框）；載完換成原圖、視窗高度不跳',
          !r1.complete && r1.w > 100 && r1.h > 140 && near(c1, [68, 170, 102]) && r2.complete && near(c2, [170, 102, 68]) && Math.abs(r2.dlgH - r1.dlgH) < 1, JSON.stringify({ r1, c1, r2, c2 }));
        await o3.ctx.close();
      }
      // B3 文字模式（瀏覽器記住）：零卡圖請求；卡名可以點開大圖（只載那一張官方原圖）
      { const { ctx, pg, imgReq } = await open(D, { view: 'text' });
        const n0 = imgReq.length;
        const info = await pg.evaluate(() => ({ pressed: document.querySelector('.dpv-bar button.active')?.textContent || '', imgs: document.querySelectorAll('.deck-table img').length, links: document.querySelectorAll('.deck-table .nm-link').length }));
        await pg.locator('.deck-table .nm-link').first().click(); await pg.waitForSelector('.dpz img'); await pg.waitForTimeout(300);
        const after = imgReq.slice(n0);
        ok('★★★ B3 文字模式（記住）：一張卡圖都不載；卡名可以點開大圖，只載那一張官方原圖',
          /文字/.test(info.pressed) && info.imgs === 0 && n0 === 0 && info.links === ENTRIES.length - 1 && after.length === 1 && /asia\.pokemon-card\.com\/tw\/card-img\/tw\d+\.png$/.test(after[0]), JSON.stringify({ info, n0, after }));
        // 切回縮圖會記住
        await pg.keyboard.press('Escape');
        await pg.locator('.dpv-bar button', { hasText: '縮圖' }).click();
        const saved = await pg.evaluate(() => localStorage.getItem('ptcg_dp_detail_view_v1'));
        ok('★ B3b 切換顯示方式會記住', saved === 'thumb', saved);
        await ctx.close();
      }
      // B8 手機：大圖疊在明細上，背景鎖住；關大圖後明細的鎖還在；關明細才解鎖（引用計數）
      { const { ctx, pg } = await open({ width: 390, height: 844 }, { mobile: true });
        const lk = () => pg.evaluate(() => getComputedStyle(document.body).position);
        const l0 = await lk();
        await pg.locator('.dpv-tile').nth(0).click(); await pg.waitForSelector('.dpz');
        const l1 = await lk();
        await pg.locator('.dpz-close').click(); await pg.waitForTimeout(200);
        const l2 = await lk();
        await pg.locator('.modal .modal-head .close').click(); await pg.waitForTimeout(300);
        const l3 = await lk();
        ok('★★ B8 手機：明細與大圖都鎖住背景；關大圖後明細的鎖還在、關明細才解鎖（引用計數）', l0 === 'fixed' && l1 === 'fixed' && l2 === 'fixed' && l3 !== 'fixed', JSON.stringify([l0, l1, l2, l3]));
        await ctx.close();
      }
      // B9 欄數、60 種卡、短螢幕、深淺色、按鈕高度
      const cols = {};
      for (const [w, h, mob] of [[320, 568, true], [390, 844, true], [430, 932, true], [1280, 900, false]]) {
        const { ctx, pg } = await open({ width: w, height: h }, { mobile: mob, post: 'dp_60' });
        cols[w] = await pg.evaluate(() => ({ cols: getComputedStyle(document.querySelector('.dpv-grid')).gridTemplateColumns.split(' ').length, tiles: document.querySelectorAll('.dpv-grid > li').length,
          overflow: document.querySelector('.modal').scrollWidth > document.querySelector('.modal').clientWidth + 1,
          aspect: (() => { const b = document.querySelector('.dpv-img').getBoundingClientRect(); return +(b.width / b.height).toFixed(3); })(),
          btnH: Math.min(...[...document.querySelectorAll('.dpv-bar button')].map((b) => b.getBoundingClientRect().height)) }));
        await ctx.close();
      }
      ok('★★★ B9 欄數：320→2、390→3、430→3、1280→6；60 種卡全部顯示；不橫向溢出；卡面 63:88；切換鈕 ≥44px',
        cols[320].cols === 2 && cols[390].cols === 3 && cols[430].cols === 3 && cols[1280].cols === 6 && Object.values(cols).every((c) => c.tiles === 60 && !c.overflow && Math.abs(c.aspect - 63 / 88) < 0.02 && c.btnH >= 44), JSON.stringify(cols));
      const fit = {};
      for (const [name, vp, mob, theme] of [['320x568', { width: 320, height: 568 }, true, 'light'], ['1280x600', { width: 1280, height: 600 }, false, 'dark']]) {
        const { ctx, pg } = await open(vp, { mobile: mob, theme });
        await pg.locator('.dpv-tile').nth(0).click(); await pg.waitForSelector('.dpz img'); await pg.waitForTimeout(300);
        fit[name] = await pg.evaluate(() => { const d = document.querySelector('.dpz').getBoundingClientRect(); const nav = [...document.querySelectorAll('.dpz-nav button')].map((b) => b.getBoundingClientRect());
          return { top: d.top, bottom: d.bottom, vh: innerHeight, navMinH: Math.min(...nav.map((r) => r.height)), bg: getComputedStyle(document.querySelector('.dpz')).backgroundColor, theme: document.documentElement.dataset.theme }; });
        await ctx.close();
      }
      { const { ctx, pg } = await open({ width: 320, height: 568 }, { mobile: true, view: 'text' });
        const h = await pg.evaluate(() => Math.min(...[...document.querySelectorAll('.deck-table .nm-link')].map((b) => b.getBoundingClientRect().height)));
        ok('★★ B9b 文字模式的卡名按鈕至少 44px 高（手機觸控）', h >= 44, h);
        await ctx.close();
      }
      ok('★★ B11 短螢幕（320×568、1280×600）：大圖視窗整個在畫面內、按鈕 ≥44px；淺／深色的大圖視窗底色跟著主題',
        Object.values(fit).every((f) => f.top >= 0 && f.bottom <= f.vh + 0.5 && f.navMinH >= 44) && fit['320x568'].theme === 'light' && fit['1280x600'].theme === 'dark' && fit['320x568'].bg !== fit['1280x600'].bg, JSON.stringify(fit));
      // B12 既有功能還在：匯入、複製連結、留言區、按讚
      { const { ctx, pg } = await open(D);
        const has = await pg.evaluate(() => ({ imp: !!document.querySelector('.modal-foot button.primary'), share: [...document.querySelectorAll('.modal-foot button')].some((b) => /複製連結/.test(b.textContent)), like: !!document.querySelector('.like-btn') || /♥/.test(document.querySelector('.modal-foot')?.textContent || '') }));
        ok('★ B12 明細原有的匯入、複製連結、讚數都還在', has.imp && has.share && has.like, JSON.stringify(has));
        await ctx.close();
      }
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.594 牌組公布欄明細縮圖／大圖：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
