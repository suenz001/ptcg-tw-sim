// ⭐⭐⭐ v6.194 站長兩個裁定的守衛（2026-08-15，**改判** v6.193 的做法）
// ⚠ v6.232：M-P-I 的 9 張基本能量官方標改 J ⇒ 依拆檔規則搬入 M-P-J.json，
//   M-P-I 59→50、M-P-J 92→101（對玩家 99）。本檔硬編數字同步更新。
//
//  ① 「那 2 組港版就先存在資料裡面就好，但請從卡牌資料庫和牌組編輯器裡面把連結移除，
//     讓之後的玩家不會再誤選到。」
//     ⇒ 18965 超級妖火紅狐ex／18969 古歷 **回到** static/cards（v6.193 把它們刪了），
//       改成「下架（hidden）」：/cards、牌組編輯器、搜尋、匯入、SEO 卡片頁都看不到，
//       但卡池、對戰、回放、比賽紀錄照常。
//     ⚠⚠ 為什麼一定要留在資料裡：tournament-dumps 的 3 份 dump 有玩家真的用它打過的場，
//       回放快照裡直接寫著 {"cardId":"18965"}；回放**不經** migrateDeck／createGame，
//       卡池沒有那個 id 就 getCard() throw。本檔 ② 用行為端實跑釘住這條。
//  ② 基本能量 metadata 對齊台灣官方（asia.pokemon-card.com/tw/card-search/detail/{id}/
//     的 span.pageHeader / span.alpha / span.collectorNumber，2026-08-15 逐頁實測）：
//     7815~7822 的 collectorNumber 是 GRA/FIR/WAT/LIG/PSY/FIG/DAR/MET（本站原本抄成 257~264/SV-P）；
//     13128~13135 的 alpha 是 J（本站原本寫 I）⇒ 依 M-P/SV-P 的拆檔規則（split-mp-v116.mjs：
//     setCode = `SV-P-{卡片的 regulationMark}`）從 SV-P-I.json 搬到 SV-P-J.json。
//
// HEAD-FAIL 依據（在 BASE = v6.193 = 4ad2618a 上跑，以下每一條都會紅）：
//   ・BASE 的 static/cards 沒有 18965/18969                      → ②③⑥ FAIL
//   ・BASE 沒有 $lib/cards/visibility                            → 整份 import FAIL
//   ・BASE 的 /cards +page.ts 不濾下架卡                          → ① FAIL
//   ・BASE 的 7815 collectorNumber 是 257/SV-P、13128 標是 I      → ⑤ FAIL
//   ・BASE 的 13128 在 SV-P-I.json                               → ⑤ FAIL
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6194-s.js'), E = join(ROOT, '.x6194-e.ts'), O = join(ROOT, '.x6194-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export * as VIS from './src/lib/cards/visibility';\n"
  + "export * as MIG from './src/lib/decks/cardIdMigration';\n"
  + "export { loadAllSets, buildCardIndex, loadDeckSets } from './src/lib/cards/pool';\n"
  + "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { validateDeck } from './src/lib/decks/validation';\n"
  + "export { PRESET_DECKS } from './src/lib/decks/presets';\n"
  + "export { getStdCardIds } from './src/lib/server/cardIndex';\n"
  + "export { load as cardsPageLoad } from './src/routes/cards/+page';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const INDEX = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const liveCodes = INDEX.map((e) => e.code);
const live = new Set(liveCodes);
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const CSM = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));

/** /cards +page.ts 與 pool.ts 都用 fetch 抓 static —— 這裡接成讀本機檔。 */
const fetchShim = async (url) => {
  const m = String(url).split('?')[0].match(/(cards\/[^/]+|card-set-map\.json)$/);
  const file = m[1] === 'card-set-map.json' ? join(ROOT, 'static/card-set-map.json') : join(ROOT, 'static', m[1]);
  return { ok: true, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
const ok = (c, m) => { if (!c) throw new Error(m); };

const HID = ['18965', '18969'];
const REPL = { '18965': '18560', '18969': '18564' };

// ── 掃描器自驗（v6.124~126 教訓：先證明自己看得到東西）────────────────────
T('自驗：live 卡庫載得到（≥4900 張）、下架卡與其台版都在資料裡', () => {
  ok(pool.size >= 4900, '只掃到 ' + pool.size + ' 張 —— 掃描器壞了？');
  for (const id of [...HID, ...Object.values(REPL)]) ok(pool.get(id), '卡庫沒有 id ' + id);
});

console.log('① 唯一述詞：全站只有一份「這張卡要不要對玩家開放」的清單');

T('⭐⭐⭐ $lib/cards/visibility 是唯一來源，函式語義正確（含 String(id) 比對）', () => {
  const V = mod.VIS;
  ok(V.HIDDEN_FROM_PLAYERS && Object.keys(V.HIDDEN_FROM_PLAYERS).sort().join() === HID.sort().join(),
    'HIDDEN_FROM_PLAYERS 內容不對：' + JSON.stringify(Object.keys(V.HIDDEN_FROM_PLAYERS || {})));
  for (const id of HID) {
    ok(V.isHiddenFromPlayers(id) === true, id + ' 應為下架');
    ok(V.isHiddenFromPlayers(Number(id)) === true, id + ' 傳 number 也要判得出來（比對必須 String()）');
    ok(V.resolvePlayerFacingCardId(id) === REPL[id], id + ' 應導向 ' + REPL[id]);
  }
  ok(V.isHiddenFromPlayers('18560') === false, '台版被誤判為下架');
  ok(V.isHiddenFromPlayers(null) === false && V.isHiddenFromPlayers(undefined) === false, 'null/undefined 應為 false');
  ok(V.resolvePlayerFacingCardId('19630') === '19630', '不在表上的 id 必須原樣回傳');
  // 冪等：導向後的 id 本身不得再被導向（否則是死循環／資料設錯）
  for (const id of HID) ok(V.resolvePlayerFacingCardId(REPL[id]) === REPL[id], '替代卡本身也被列為下架');
});

T('⭐⭐⭐ cardIdMigration 的 RETIRED_DUP_TO_TW_ID 由 visibility 推導（不是第二份清單）', () => {
  const R = mod.MIG.RETIRED_DUP_TO_TW_ID;
  ok(JSON.stringify(R) === JSON.stringify(REPL), '對照表內容漂移：' + JSON.stringify(R));
  const src = readFileSync(join(ROOT, 'src/lib/decks/cardIdMigration.ts'), 'utf8');
  ok(/HIDDEN_FROM_PLAYERS/.test(src), 'cardIdMigration 沒有引用 HIDDEN_FROM_PLAYERS —— 又寫了第二份');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/['"]18965['"]/.test(strip(src)), 'cardIdMigration 的程式碼裡仍有 18965 字面量（第二份清單）');
});

T('⭐⭐⭐ 枚舉：src/ 全樹除了 visibility.ts 之外，不得再出現下架 id 的字面量', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (f.isDirectory()) walk(d + '/' + f.name);
      else if (/\.(ts|svelte|js)$/.test(f.name)) files.push(d + '/' + f.name);
    }
  };
  walk('src');
  ok(files.length >= 100, '只掃到 ' + files.length + ' 個檔 —— 掃描器壞了？');
  // ⚠ 剝註解（v6.126 教訓：註解裡的字面量會讓否定型守衛誤報）
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const RE = /['"](?:18965|18969)['"]/;
  const bad = files.filter((p) => p !== 'src/lib/cards/visibility.ts' && RE.test(strip(readFileSync(join(ROOT, p), 'utf8'))));
  ok(bad.length === 0, '這些檔各自寫了一份排除清單（必然漂移）：' + bad.join(', '));
  // 正對照 + 剝註解自驗
  ok(RE.test(strip("const x = { '18965': 1 };")), '正對照失效 —— 判準抓不到違規樣本');
  ok(!RE.test(strip("// 例：'18965' 港版重複卡")), '剝註解失效，會誤報');
  ok(RE.test(strip(readFileSync(join(ROOT, 'src/lib/cards/visibility.ts'), 'utf8'))), '自驗失效：唯一來源裡竟然沒有 id 字面量');
});

console.log('② 行為端：/cards（卡牌資料庫）真的看不到這兩張');

const allView = await mod.cardsPageLoad({ fetch: fetchShim, url: new URL('https://x/cards?set=ALL') });
const setView = await mod.cardsPageLoad({ fetch: fetchShim, url: new URL('https://x/cards?set=M-P-J') });
const idxView = await mod.cardsPageLoad({ fetch: fetchShim, url: new URL('https://x/cards') });

T('⭐⭐⭐ 實跑 /cards?set=ALL 的 load()：下架卡不在回傳的 cards 裡（其餘一張不少）', () => {
  const ids = new Set(allView.cards.map((c) => String(c.id)));
  for (const id of HID) ok(!ids.has(id), '/cards?set=ALL 仍列出下架卡 ' + id);
  ok(ids.has('18560') && ids.has('18564'), '台版被連帶濾掉了');
  // 正對照：不濾的話它們一定在（證明這條斷言真的測到東西）
  const rawAll = liveCodes
    .filter((c) => ['H', 'I', 'J'].includes(INDEX.find((e) => e.code === c).regulationMark))
    .flatMap((c) => JSON.parse(readFileSync(join(dir, c + '.json'), 'utf8')));
  ok(rawAll.some((c) => String(c.id) === '18965'), '正對照失效：原始資料裡本來就沒有 18965？');
  ok(rawAll.length - allView.cards.length === 2, '濾掉的張數不是剛好 2：' + (rawAll.length - allView.cards.length));
});

T('⭐⭐⭐ 實跑 /cards?set=M-P-J 的 load()：單一卡包檢視同樣看不到（走同一份述詞）', () => {
  const ids = new Set(setView.cards.map((c) => String(c.id)));
  for (const id of HID) ok(!ids.has(id), '/cards?set=M-P-J 仍列出下架卡 ' + id);
  ok(setView.cards.length === 99, 'M-P-J 對玩家應顯示 99 張（101 − 2），實際 ' + setView.cards.length);
  ok(idxView.mode === 'index' && idxView.sets.length === INDEX.length, '卡包列表模式壞了');
});

T('⭐⭐ SEO：下架卡不預渲染卡片頁、不進 sitemap（getStdCardIds）', () => {
  const ids = new Set(mod.getStdCardIds());
  ok(ids.size > 3000, '只拿到 ' + ids.size + ' 個 id —— 掃描器壞了？');
  for (const id of HID) ok(!ids.has(id), 'sitemap／/card/' + id + ' 仍會產生');
  ok(ids.has('18560') && ids.has('18564'), '台版被連帶濾掉了');
});

console.log('③ 牌組編輯器：候選來自「已濾過的 pool」，但畫得出來的 poolById 不濾');

T('⭐⭐⭐ 接線：pool = filterPlayerSelectable(allCards)、poolById = buildCardIndex(allCards)', () => {
  const src = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const body = strip(src);
  ok(/pool\s*=\s*filterPlayerSelectable\(allCards\)/.test(body),
    '牌池沒有套用唯一述詞 —— 牌組編輯器仍選得到下架卡');
  ok(/poolById\s*=\s*buildCardIndex\(allCards\)/.test(body),
    'poolById 被一起濾掉了 —— 已存牌組裡的那張卡會變成「缺卡」（entry 消失、張數變少）');
  // 正對照：舊寫法必須抓得出來
  ok(!/pool\s*=\s*filterPlayerSelectable\(allCards\)/.test('  pool = allCards;'), '正對照失效');
});

// ⚠⚠ 審查子代理抓到、查證屬實：這條原本用「往後取 1400 字元的固定視窗 + 未剝註解」來判斷，
//   視窗會吃到**下一個** $derived 的內容 ⇒ 我把 poolBySetNum 改成讀未濾的 poolById，
//   守衛照樣 20 PASS（假綠）。現在改成「括號配對取出該 $derived 的完整定義 + 剝註解 +
//   斷言不得出現 poolById／allCards」，並附破壞樣本的正對照。
const DECKS_SRC = readFileSync(join(ROOT, 'src/routes/decks/+page.svelte'), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** 從 `const <name> = $derived` 起，做括號配對取出**恰好這一個**宣告（不會吃到下一個）。 */
function derivedBody(src, name) {
  const i = src.indexOf('const ' + name + ' = $derived');
  if (i < 0) return null;
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '(' || ch === '{' || ch === '[') { depth++; started = true; }
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (started && depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

T('⭐⭐⭐ 資料流：候選／搜尋衍生值一律讀已濾的 pool，不得讀 poolById／allCards', () => {
  const DERIVED = ['filteredPool', 'poolBySetNum', 'poolByName', 'sameNameVariants', 'previewChain', 'chainNames'];
  for (const name of DERIVED) {
    const raw = derivedBody(DECKS_SRC, name);
    ok(raw, '找不到 ' + name + ' 的 $derived 定義 —— 掃描器對不上原始碼了');
    // 抓過頭的判準用「片段裡不得出現第二個 $derived 宣告」，比字元數上限可靠
    //（filteredPool 本身就有 ~2.5KB，用長度當上限會誤報）。
    ok((raw.match(/=\s*\$derived/g) || []).length === 1,
      name + ' 的括號配對吃到了下一個宣告 —— 掃描器壞了（原本的假綠成因）');
    const body = stripComments(raw);
    ok(/\bpool\b(?!ById|BySetNum|ByName|Ready|Error)/.test(body),
      name + ' 沒有從已濾過的 pool 取材');
    ok(!/\bpoolById\b/.test(body),
      name + ' 直接讀了未濾的 poolById ⇒ 下架卡會從這條路回到玩家面前');
    ok(!/\ballCards\b/.test(body), name + ' 直接讀了未濾的 allCards');
  }
  // 正對照：把 poolBySetNum 改讀 poolById 的樣本必須被抓出來
  const probe = 'const poolBySetNum = $derived(\n new Map([...poolById.values()].map((c) => [c.setCode, c]))\n);';
  const pb = derivedBody(probe, 'poolBySetNum');
  ok(pb && /\bpoolById\b/.test(stripComments(pb)), '正對照失效 —— 判準抓不到「改讀 poolById」的破壞樣本');
  // 括號配對自驗：兩個相鄰宣告不可以被當成同一個
  const two = 'const a = $derived(f(pool));\nconst b = $derived(g(poolById));';
  ok(!/\bpoolById\b/.test(derivedBody(two, 'a')), '括號配對失效 —— 會吃到下一個宣告（原本的假綠成因）');
});

T('⭐⭐⭐ 匯入入口：每個 poolById.get() 的引數都要嘛已導向、要嘛是「顯示既有牌組」', () => {
  // ⚠ 審查子代理抓到：原本這兩處接線**零覆蓋**（把 resolvePlayerFacingCardId 拿掉守衛照樣全綠）。
  //   ⇒ 改成**枚舉全檔**所有 poolById.get(...)，逐一比對白名單；新增第三個入口也會被抓到。
  const body = stripComments(DECKS_SRC);
  // ⚠ 引數本身會有括號，必須做括號配對；用 /\(([^)]*)\)/ 會在第一個 ) 就截斷。
  const calls = [];
  for (const m of body.matchAll(/poolById\.get\(/g)) {
    let depth = 1, j = m.index + m[0].length;
    for (; j < body.length && depth > 0; j++) {
      if (body[j] === '(') depth++;
      else if (body[j] === ')') depth--;
    }
    calls.push(body.slice(m.index + m[0].length, j - 1).trim());
  }
  ok(calls.length >= 3, '只找到 ' + calls.length + ' 個 poolById.get() —— 掃描器對不上原始碼了');
  // 「顯示既有牌組的某一筆 entry」不必導向（那是要畫得出來，導向了反而會改動玩家的牌組內容）。
  const DISPLAY_ONLY = new Set(['entry.cardId']);
  // 「拿一個外來 id 變成新的牌組 entry」＝匯入 ⇒ 一定要先導向。
  const bad = [];
  for (const a of calls) {
    if (DISPLAY_ONLY.has(a)) continue;
    if (a.startsWith('resolvePlayerFacingCardId(')) continue;
    // 允許先存進區域變數再用，但那個變數必須是導向過的（例：const cardId = resolvePlayerFacingCardId(mId[3])）
    if (/^[A-Za-z_$][\w$]*$/.test(a)
        && new RegExp('(?:const|let)\\s+' + a + '\\s*=\\s*resolvePlayerFacingCardId\\(').test(body)) continue;
    bad.push(a);
  }
  ok(bad.length === 0,
    '這些 poolById.get() 的 id 沒有先過 resolvePlayerFacingCardId ⇒ 匯入會把下架卡加進牌組：'
    + JSON.stringify(bad) + '（全部呼叫點：' + JSON.stringify(calls) + '）');
  // 兩個已知匯入入口必須都還在（少了代表被整段刪掉，上面的迴圈就掃不到、變成空綠）
  ok(/const cardId = resolvePlayerFacingCardId\(mId\[3\]\)/.test(body), '貼卡表 Format C 的入口不見了或沒導向');
  ok(calls.includes('resolvePlayerFacingCardId(e.cardId)'), '官網代碼匯入的入口不見了或沒導向');
  ok(calls.includes('entry.cardId'), '掃描器自驗失效：應該還看得到「顯示既有牌組」那種不必包的呼叫');
  // 正對照：未導向的樣本必須被抓出來
  const probe = 'card = poolById.get(mId[3]);';
  const parg = probe.match(/poolById\.get\(([^)]*)\)/)[1];
  ok(!DISPLAY_ONLY.has(parg) && !parg.startsWith('resolvePlayerFacingCardId('), '正對照失效');
});

T('⭐⭐ /cards 卡包摘要張數必須扣掉下架卡（磚上寫 101、內頁只有 99 ＝自相矛盾）', () => {
  const V = mod.VIS;
  // 述詞裡的 setCode 不可以與實際資料漂移
  for (const [id, info] of Object.entries(V.HIDDEN_FROM_PLAYERS)) {
    ok(pool.get(id).setCode === info.setCode, id + ' 的 setCode 與卡庫不符：' + info.setCode);
    ok(CSM[id] === info.setCode, id + ' 的 setCode 與 card-set-map 不符：' + CSM[id]);
  }
  const adjusted = V.applyHiddenCountsToSets(INDEX);
  const mpj = adjusted.find((e) => e.code === 'M-P-J');
  ok(mpj.cardCount === 99 && mpj.count === 99, 'M-P-J 對玩家應顯示 99 張，實際 ' + mpj.cardCount + '/' + mpj.count);
  ok(mpj.cardCount === setView.cards.length, '卡包磚(' + mpj.cardCount + ') 與內頁實際張數(' + setView.cards.length + ') 對不上');
  const untouched = adjusted.find((e) => e.code === 'SV-P-J');
  ok(untouched.cardCount === 21, '沒有下架卡的卡包被動到了：' + untouched.cardCount);
  ok(adjusted.reduce((s, e) => s + e.cardCount, 0) === 4933, '對玩家的總張數應為 4933（4935 − 2）');
  // 行為端：index 模式與 set 模式回傳的 sets 都要是扣過的
  ok(idxView.sets.find((e) => e.code === 'M-P-J').cardCount === 99, '/cards 卡包列表沒有扣');
  ok(setView.sets.find((e) => e.code === 'M-P-J').cardCount === 99, '/cards?set=… 帶的 sets 沒有扣');
  ok(allView.sets.find((e) => e.code === 'M-P-J').cardCount === 99, '/cards?set=ALL 帶的 sets 沒有扣');
  // ⚠ index.json 本身不可以被改（卡庫完整性守衛靠它對帳）
  ok(INDEX.find((e) => e.code === 'M-P-J').cardCount === 101, 'index.json 被改掉了 —— 資料層張數必須維持 101');
});

T('⭐⭐⭐ 行為端：filterPlayerSelectable 對真實卡庫的輸出剛好少掉那兩張', () => {
  const all = [...pool.values()];
  const sel = mod.VIS.filterPlayerSelectable(all);
  ok(all.length - sel.length === 2, '濾掉的張數不是 2：' + (all.length - sel.length));
  const ids = new Set(sel.map((c) => String(c.id)));
  for (const id of HID) ok(!ids.has(id), '候選裡還有 ' + id);
  // 牌組編輯器的搜尋是在 pool 上做 filter ⇒ 任何搜尋條件都不可能把它們找回來
  for (const id of HID) {
    const c = pool.get(id);
    ok(!sel.some((x) => x.name === c.name && String(x.id) === id), '用卡名搜尋仍找得到 ' + id);
    ok(sel.some((x) => x.name === c.name), '同名的台版被一起藏掉了（玩家會找不到這張卡）');
  }
});

T('⭐⭐ 內建預組不得含下架卡（否則玩家複製預組就又拿到一張選不到的卡）', () => {
  let n = 0;
  for (const d of mod.PRESET_DECKS) for (const e of d.entries) {
    n++;
    ok(!mod.VIS.isHiddenFromPlayers(e.cardId), '預組「' + d.name + '」含下架卡 ' + e.cardId);
  }
  ok(n > 100, '只掃到 ' + n + ' 筆預組 entry —— 掃描器壞了？');
});

console.log('④ 行為端：卡片仍在 pool 裡，對戰／回放／已存牌組都不炸');

let iidN = 0;
const inst = (cardId, extra = {}) => ({
  iid: 'i' + (++iidN), cardId: String(cardId), damage: 0, energyAttached: [], toolAttached: null, ...extra,
});
const mkState = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
  ...extra,
});
const BASIC = [...pool.values()].find(
  (c) => c.supertype === 'Pokemon' && !c.evolvesFrom && c.subtype !== 'Other' && ['H', 'I', 'J'].includes(c.regulationMark));
const ENERGY = [...pool.values()].find((c) => c.supertype === 'Energy' && c.subtype === 'Basic');

T('⭐⭐⭐ 回放路徑：快照裡直接寫著 cardId 18965（不經 migrate）也能攻擊、不 throw', () => {
  // 這就是 tournament-dumps 裡真實存在的形狀：
  //   {"iid":"tp8phnwl","cardId":"18965","damage":630,"energyAttached":[...]}
  // tReplayGoto() 是把快照直接塞回 game，**沒有**任何 migrate 機會。
  const play = (cardId) => mod.applyAction(
    mkState({ active: inst(cardId, { energyAttached: [inst(ENERGY.id), inst(ENERGY.id), inst(ENERGY.id)] }) },
            { active: inst(BASIC.id) }),
    { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  const out = play('18965');
  ok(out && out.players, '18965 上戰鬥位攻擊時炸了');
  ok(pool.get('18965').name === '超級妖火紅狐ex', '卡池拿到的不是那張卡');
  // 正對照：真的查無的 id 必須 throw，否則「沒 throw」證明不了任何事
  let threw = false;
  try { play('99999991'); } catch (e) { threw = /Card not found/.test(e.message); }
  ok(threw, '正對照失效 —— 連完全不存在的 id 都不 throw，代表這條斷言沒測到崩潰路徑');
});

T('⭐⭐⭐ 已存牌組帶著下架 id：驗證合法、張數不變、不出現「查無資料」', () => {
  // 刻意**不**跑 migrateDeck —— 模擬「牌組公布欄明細／比賽紀錄」這種不經遷移的顯示路徑
  const deck = { id: 'x', name: 'x', createdAt: '', updatedAt: '', entries: [
    { cardId: '18965', count: 2 }, { cardId: '18969', count: 2 },
    { cardId: String(BASIC.id), count: 4 }, { cardId: String(ENERGY.id), count: 52 } ] };
  const r = mod.validateDeck(deck, pool);
  ok(r.totalCount === 60, '張數 ' + r.totalCount + '（下架卡被當成缺卡就會少 4 張）');
  ok(!r.issues.some((s) => s.includes('查無資料')), '出現「查無資料」：' + JSON.stringify(r.issues));
  ok(r.legal === true, JSON.stringify(r.issues));
});

T('⭐⭐ 牌組遷移仍把下架 id 換成台版（既有牌組無感、下次存檔後不再帶下架 id）', () => {
  const out = mod.MIG.migrateDeck({ id: 'x', name: 'x', createdAt: '', updatedAt: '', entries: [
    { cardId: '18560', count: 2 }, { cardId: '18965', count: 2 } ] }).entries;
  ok(out.length === 1 && out[0].cardId === '18560' && out[0].count === 4,
    '沒有合併成台版 4 張：' + JSON.stringify(out));
});

const _lds = await mod.loadDeckSets(['18965', '18969'], fetchShim);
T('⭐⭐ 對戰「按牌組只載必要卡包」：帶下架 id 也解得出卡包，且卡包裡就有那張卡', () => {
  ok(_lds.missingIds.length === 0, '下架 id 被當成查無：' + JSON.stringify(_lds.missingIds));
  const ids = new Set(_lds.cards.map((c) => String(c.id)));
  for (const id of HID) ok(ids.has(id), '載進來的卡包裡沒有 ' + id + ' —— 回放會缺卡');
});

console.log('⑤ 基本能量 metadata 與台灣官方逐字相符');

// 2026-08-15 由 asia.pokemon-card.com/tw/card-search/detail/{id}/ 逐頁實測，
// 取 span.alpha（賽制標）與 span.collectorNumber（卡號）兩個欄位。
const OFFICIAL = {
  '7815': ['GRA', 'J'], '7816': ['FIR', 'J'], '7817': ['WAT', 'J'], '7818': ['LIG', 'J'],
  '7819': ['PSY', 'J'], '7820': ['FIG', 'J'], '7821': ['DAR', 'J'], '7822': ['MET', 'J'],
  '13128': ['257/SV-P', 'J'], '13129': ['258/SV-P', 'J'], '13130': ['259/SV-P', 'J'], '13131': ['260/SV-P', 'J'],
  '13132': ['261/SV-P', 'J'], '13133': ['262/SV-P', 'J'], '13134': ['263/SV-P', 'J'], '13135': ['264/SV-P', 'J'],
};

T('⭐⭐⭐ 16 張基本能量的 collectorNumber／regulationMark 逐字等於官方值', () => {
  for (const [id, [num, mark]] of Object.entries(OFFICIAL)) {
    const c = pool.get(id);
    ok(c, '卡庫沒有 ' + id);
    ok(c.collectorNumber === num, id + ' collectorNumber 應為「' + num + '」，實際「' + c.collectorNumber + '」');
    ok(c.regulationMark === mark, id + ' regulationMark 應為「' + mark + '」，實際「' + c.regulationMark + '」');
    ok(c.supertype === 'Energy' && c.subtype === 'Basic', id + ' 不是基本能量了？');
  }
});

T('⭐⭐⭐ SV-P / M-P 的拆檔規則：檔名的標必須等於每一張卡的 regulationMark', () => {
  // 規則來源：scripts/split-mp-v116.mjs（setCode = `M-P-${c.regulationMark}`）。
  // 13128~13135 的官方標是 J ⇒ 必須待在 SV-P-J.json，不能留在 SV-P-I.json。
  const bad = [];
  for (const code of liveCodes) {
    const m = code.match(/^(?:M|SV)-P-([HIJ])$/);
    if (!m) continue;
    for (const c of JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8'))) {
      if (c.regulationMark !== m[1]) bad.push(code + '/' + c.id + ' 標=' + c.regulationMark);
      if (c.setCode !== code) bad.push(code + '/' + c.id + ' setCode=' + c.setCode);
    }
  }
  ok(bad.length === 0, '特典卡拆檔規則被破壞：' + bad.slice(0, 6).join('; '));
  for (const id of ['13128', '13135']) ok(CSM[id] === 'SV-P-J', 'card-set-map 的 ' + id + ' 是 ' + CSM[id]);
});

T('⭐ 基本能量卡名沿用站內慣例「基本【X】能量」（engine 靠卡名推屬性，不可跟著官網改）', () => {
  // ⚠ 官網對 GRA/FIR/… 那批印刷顯示的是「基本草能量」（無【】），但 getBasicEnergyType()
  //   是**讀卡名**推屬性，全庫 80 張基本能量一律用【】格式；只改這 8 張會讓屬性推不出來。
  //   ⇒ 本版刻意不動卡名，這條守衛把「不要順手改」釘住。
  for (const id of Object.keys(OFFICIAL)) {
    ok(/^基本【[草火水雷超鬥惡鋼]】能量$/.test(pool.get(id).name), id + ' 卡名格式跑掉了：' + pool.get(id).name);
  }
});

console.log('⑥ 校驗和：張數／對照表／id 唯一性全部自洽');

T('⭐⭐⭐ index.json 逐包張數 = 實際檔案；三個動到的卡包數字正確', () => {
  const want = { 'M-P-J': 101, 'SV-P-I': 22, 'SV-P-J': 21 };
  for (const e of INDEX) {
    const arr = JSON.parse(readFileSync(join(dir, e.code + '.json'), 'utf8'));
    ok(e.cardCount === arr.length && e.count === arr.length,
      e.code + ' 張數不同步：index=' + e.cardCount + '/' + e.count + ' 實際=' + arr.length);
    const sum = Object.values(e.supertypeCounts || {}).reduce((a, b) => a + b, 0);
    ok(sum === arr.length, e.code + ' supertypeCounts 加總 ' + sum + ' ≠ ' + arr.length);
    ok(e.regulationMark && e.name && e.name !== e.code, e.code + ' 的手工欄位被重生洗掉了');
    if (want[e.code]) ok(arr.length === want[e.code], e.code + ' 應為 ' + want[e.code] + ' 張，實際 ' + arr.length);
  }
});

T('⭐⭐ live 總張數 / card-set-map 零落差 / id 全站唯一', () => {
  const total = INDEX.reduce((s, e) => s + e.cardCount, 0);
  ok(total === pool.size, 'index.json 宣告 ' + total + ' 張，實際掃到 ' + pool.size);
  ok(total === 4935, 'live 總張數應為 4935（v6.193 的 4933 + 放回來的 2 張），實際 ' + total);
  const missing = [...pool.keys()].filter((k) => !(k in CSM));
  const extra = Object.keys(CSM).filter((k) => !pool.has(k));
  ok(missing.length === 0 && extra.length === 0,
    'card-set-map 落差：缺 ' + missing.slice(0, 3) + ' / 多 ' + extra.slice(0, 3));
  const wrong = [...pool.entries()].filter(([k, c]) => CSM[k] !== c.setCode);
  ok(wrong.length === 0, 'card-set-map 指錯：' + wrong.slice(0, 3).map(([k, c]) => k + '→' + CSM[k] + ' 應為 ' + c.setCode));
});

console.log('\n=== v6.194 下架卡（資料留著／玩家選不到）＋ 基本能量 metadata：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
