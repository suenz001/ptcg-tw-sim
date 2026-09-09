// v6.333 守衛：M6a「30th CELEBRATION」進卡庫 ＋「無標卡不能對戰」＋ 分支進化 evolvesFrom
//
// 這一版做了三件會互相牽動的事，三件都必須有**行為級**斷言（只比字串的守衛擋不住接線沒接上）：
//
//   ①【資料】static/cards/M6a.json（168 張）＋ index.json ＋ card-set-map.json 手術式更新。
//      其中 21 張是官網 `.alpha` 顯示 `n/a` 的**純收藏卡**（皮卡丘 136/103、洛奇亞、N、小霞、
//      烈空坐EX、達克萊伊＆克雷色利亞LEGEND …），站長 2026-09-09 明確指示「不能對戰」。
//
//   ②【規則】`decks/validation.ts` 原本寫 `if (card.regulationMark && !STANDARD_MARKS.has(...))`
//      —— **標缺席時整段跳過 ＝ fail-open**。站上在 M6a 之前剛好一張無標卡都沒有（實測 live
//      卡包的 regulationMark 分佈只有 H/I/J/G/F），所以這個洞一直沒發作。M6a 一進來就會發作：
//      玩家可以把 4 張無標皮卡丘組進 60 張牌組打標準賽。
//      修法是把 H/I/J 判準收斂成**唯一一份** isCardMarkStandardLegal()（無標 fail-closed），
//      原本散在 validation.ts / server/cardIndex.ts / decks/+page.svelte 的三份複本全部刪掉。
//
//   ③【爬蟲】官網 .evolution 是**巢狀 <ul class="evolutionStep first|second|third">**，
//      舊 parser 把它攤平成一串名字、取「本人的前一個」，遇到分支進化必錯
//      （同一層會列出所有分支與所有印刷版本，伊布那一層一次列 24 隻）。
//      M6a 168 張裡錯了 9 張。改成讀層級後，resolveEvolvesFrom($) 是唯一判準，
//      守衛直接呼叫它跑真 HTML（不可以在守衛裡自己再抄一份選擇器 ＝ Rule 38）。
//
// HEAD-FAIL 證明：把 static/cards/index.json、static/card-set-map.json、
//   src/lib/decks/validation.ts、src/lib/cards/regulation.ts、src/routes/cards/+page.svelte、
//   scripts/scrape/parse-card.js 任何一支還原成 BASE，都必須有條目翻紅。
//   依 Rule 41：缺席的東西（M6a.json 整個檔）不可以讓整支 throw ——
//     檔案不存在時要**記成 FAIL 繼續跑**，否則只證明得到第一條。

import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import * as LOCKED from './lib/deck-locked-sets.mjs';
/** v6.320 護欄版剝除器（等長留白，行號不位移；剝太多會自己 throw）。 */
const stripComments = (s) => stripCommentsBlankChecked(s);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = join(ROOT, 'static/cards');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  OK  ' + name); pass++; }
  catch (e) { console.log('  XX  ' + name + '\n      ' + (e && e.message)); fail++; }
}
async function TA(name, fn) {
  try { await fn(); console.log('  OK  ' + name); pass++; }
  catch (e) { console.log('  XX  ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(c, m) { if (!c) throw new Error(m); }

const readOr = (p, d) => { try { return readFileSync(p, 'utf8'); } catch { return d; } };
const jsonOr = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

const INDEX = jsonOr(join(D, 'index.json'), []);
const M6A = jsonOr(join(D, 'M6a.json'), null);
const SETMAP = jsonOr(join(ROOT, 'static/card-set-map.json'), {});

console.log('(1) M6a 進卡庫（資料層）');

T('M6a.json 存在且剛好 168 張', () => {
  ok(Array.isArray(M6A), 'static/cards/M6a.json 不存在或不是陣列 —— M6a 還沒進卡庫');
  ok(M6A.length === 168, '應為 168 張，實得 ' + M6A.length);
});

T('index.json 有 M6a，且手工欄位齊全（重生會洗掉）', () => {
  const e = INDEX.find((x) => x.code === 'M6a');
  ok(e, 'index.json 沒有 M6a —— 卡包不會出現在卡牌資料庫的卡包清單');
  ok(e.name === '30th CELEBRATION', 'name 應為「30th CELEBRATION」，實得 ' + e.name);
  ok(e.regulationMark === 'J', '卡包層級的標應為 J，實得 ' + e.regulationMark);
  ok(e.releaseDate === '2026-09-16', 'releaseDate 應為 2026-09-16，實得 ' + e.releaseDate);
  ok(e.cardCount === 168 && e.count === 168, 'cardCount/count 應為 168');
});

T('168 張 id 全在官方連號區間 19913-20080，且都是純數字（不得摻自造 id）', () => {
  ok(Array.isArray(M6A), '沒有 M6a.json');
  const bad = M6A.filter((c) => !/^\d+$/.test(String(c.id))
    || Number(c.id) < 19913 || Number(c.id) > 20080);
  ok(bad.length === 0, bad.length + ' 張 id 不在區間或不是純數字：'
    + bad.slice(0, 3).map((c) => c.id).join(','));
});

T('card-set-map.json：168 張全部指到 M6a', () => {
  ok(Array.isArray(M6A), '沒有 M6a.json');
  const miss = M6A.filter((c) => SETMAP[String(c.id)] !== 'M6a');
  ok(miss.length === 0, miss.length + ' 張不在對照表或指錯：'
    + miss.slice(0, 3).map((c) => c.id).join(',')
    + '\n      -> 對戰「依牌組只載必要卡包」會解析不到這些卡');
});

console.log('(2) 無標卡的資料形狀');

const UNMARKED_SAMPLES = [
  ['20044', '皮卡丘'],
  ['20050', '洛奇亞'],
  ['20058', '耿鬼'],
  ['20060', 'N'],
  ['20046', '小霞'],
  ['20061', '烈空坐EX'],
  ['20059', '達克萊伊＆克雷色利亞LEGEND'],
];

T('無標卡剛好 21 張，且 regulationMark 是「缺席」而不是 空字串/null/"n/a"', () => {
  ok(Array.isArray(M6A), '沒有 M6a.json');
  const unmarked = M6A.filter((c) => !c.regulationMark);
  ok(unmarked.length === 21, '無標卡應為 21 張，實得 ' + unmarked.length);
  const junk = unmarked.filter((c) => 'regulationMark' in c);
  ok(junk.length === 0, junk.length + ' 張把標寫成空字串/null 而不是不寫這個欄位：'
    + junk.slice(0, 3).map((c) => c.id + ' ' + JSON.stringify(c.regulationMark)).join(', '));
  for (const [id, name] of UNMARKED_SAMPLES) {
    const c = M6A.find((x) => String(x.id) === id);
    ok(c, '找不到 id ' + id);
    ok(c.name === name, id + ' 應為「' + name + '」，實得「' + c.name + '」');
    ok(!c.regulationMark, id + ' 「' + name + '」不該有標，實得 ' + c.regulationMark);
  }
});

T('正對照：M6a 主體仍是 J 標（否則「無標」那條判準等於在測空集合）', () => {
  ok(Array.isArray(M6A), '沒有 M6a.json');
  const j = M6A.filter((c) => c.regulationMark === 'J').length;
  ok(j >= 130, 'J 標應有 130 張以上，實得 ' + j);
  // 168 = 137 J + 21 無標 + 8 舊標(A2/C1/D2/E1/F1/G1) + 2 I(高級球101、寶可夢交替103 的重印)
  const olds = M6A.filter((c) => c.regulationMark && !'HIJ'.includes(c.regulationMark));
  ok(olds.length === 8, '帶舊標(A/C/D/E/F/G)的收藏卡應為 8 張，實得 ' + olds.length
    + '：' + olds.map((c) => c.id + c.regulationMark).join(' '));
  const iMark = M6A.filter((c) => c.regulationMark === 'I');
  ok(iMark.length === 2, 'I 標重印應為 2 張（高級球 101/103、寶可夢交替 103/103），實得 ' + iMark.length);
  ok(M6A.filter((c) => !c.regulationMark).length + olds.length + iMark.length + j === 168,
    '四類張數加起來不等於 168 —— 分類判準有漏');
  const solgaleo = M6A.find((c) => String(c.id) === '20065');
  ok(solgaleo && solgaleo.regulationMark === 'A',
    '索爾迦雷歐GX 應為 A 標（官網 .alpha），實得 ' + (solgaleo && solgaleo.regulationMark));
});

console.log('(3) evolvesFrom：分支進化必須讀官網的巢狀層級');

const EVO_EXPECT = [
  ['19914', '阿羅拉 椰蛋樹', '蛋蛋'],
  ['20016', '阿羅拉 椰蛋樹', '蛋蛋'],
  ['19970', '太陽伊布', '伊布'],
  ['19989', '月亮伊布', '伊布'],
  ['19971', '仙子伊布ex', '伊布'],
  ['20039', '仙子伊布ex', '伊布'],
  ['20053', '巨鉗螳螂ex', '飛天螳螂'],
  ['19978', '露奈雅拉', '科斯莫姆'],
  ['20065', '索爾迦雷歐GX', '科斯莫姆'],
  ['19988', '耿鬼ex', '鬼斯通'],
  ['20058', '耿鬼', '鬼斯通'],
  ['19927', '甲賀忍蛙ex', '呱頭蛙'],
  ['20000', '暴飛龍ex', '甲殼龍'],
];

T('分支進化的 evolvesFrom 逐張正確（含站長裁定的耿鬼ex<-鬼斯通）', () => {
  ok(Array.isArray(M6A), '沒有 M6a.json');
  const bad = [];
  for (const [id, name, from] of EVO_EXPECT) {
    const c = M6A.find((x) => String(x.id) === id);
    if (!c) { bad.push(id + ' 不存在'); continue; }
    if (c.name !== name) { bad.push(id + ' 名字是「' + c.name + '」不是「' + name + '」'); continue; }
    if (c.evolvesFrom !== from) bad.push(id + ' ' + name + ' <- ' + c.evolvesFrom + '（應為 ' + from + '）');
  }
  ok(bad.length === 0, bad.join('; ')
    + '\n      -> 官網 .evolution 同一層會列出所有分支，取「前一個名字」必錯');
});

T('反安慰劑：上面那張表本身要抓得到「取到同層隔壁分支」的錯誤樣本', () => {
  const wrong = { 19970: '月亮伊布', 20053: '劈斧螳螂', 19978: '索爾迦雷歐', 19914: '椰蛋樹' };
  let checked = 0;
  for (const [id, , from] of EVO_EXPECT) {
    if (!(id in wrong)) continue;
    checked++;
    ok(wrong[id] !== from, id + ' 的期望值居然等於舊 parser 的錯誤值，判準沒有鑑別力');
  }
  ok(checked === 4, '負對照樣本只比到 ' + checked + ' 筆，應為 4 筆');
});

T('parse-card.js 不得再留「攤平取前一個」的舊啟發式', () => {
  const src = stripComments(readOr(join(ROOT, 'scripts/scrape/parse-card.js'), ''));
  ok(src.length > 1000, '讀不到 parse-card.js');
  ok(/resolveEvolvesFrom/.test(src), '沒有呼叫中央的 resolveEvolvesFrom');
  ok(/li\.step\.active/.test(src), '沒有用官網的 .active 標記定位本人');
  ok(/prevAll/.test(src), '沒有往上一層找前階（prevAll）');
  ok(!/names\.findIndex/.test(src), '舊的攤平啟發式（names.findIndex）還在 —— 兩份判準必然漂移');
  ok(!/for\s*\(let\s+i\s*=\s*idx\s*-\s*1/.test(src), '舊的「往前掃同名版本」迴圈還在');
});

await TA('行為級：直接呼叫 resolveEvolvesFrom 跑官方真頁面（露奈雅拉/太陽伊布/耿鬼ex/蛋蛋）', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'scripts/scrape/parse-card.js')).href);
  ok(typeof mod.resolveEvolvesFrom === 'function',
    'parse-card.js 沒有 export resolveEvolvesFrom —— 守衛只能改抄第二份選擇器（Rule 38）');
  const cheerio = await import('cheerio');
  const cases = [['19978', '科斯莫姆'], ['19970', '伊布'], ['19988', '鬼斯通'], ['19913', null]];
  const offline = [];
  for (const [id, want] of cases) {
    let html;
    try {
      const r = await fetch('https://asia.pokemon-card.com/tw/card-search/detail/' + id + '/',
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-TW' } });
      if (!r.ok) { offline.push(id); continue; }
      html = await r.text();
    } catch { offline.push(id); continue; }
    const got = mod.resolveEvolvesFrom(cheerio.load(html));
    ok(got === want, id + ' 官方頁 -> 期望 ' + JSON.stringify(want) + '，實得 ' + JSON.stringify(got));
  }
  // ⚠⚠ v6.333 事故：這一條原本寫成「四個都連不上就 FAIL」，結果**CI 上直接把 build 打紅**
  //   （GitHub Actions 的 runner 連不到 asia.pokemon-card.com）。
  //   ⭐ 通則：**守衛不可以拿外部網路當 gating 條件** —— 網路不是我們的程式，
  //     它斷掉時該紅的是監控，不是 CI。
  //   ⇒ 連不上就**大聲跳過**。語義本身由下一條「離線 fixture」保證（決定性、永遠會跑），
  //     這一條只是額外的「我方資料是否仍與官網一致」的加值檢查。
  if (offline.length === cases.length) {
    console.log('      ⚠ 連不到官網（' + offline.join(',') + '）⇒ 這一條跳過；'
      + '語義由離線 fixture 那一條保證');
  } else {
    console.log('      官網實測 ' + (cases.length - offline.length) + '/' + cases.length + ' 張相符');
  }
});

await TA('行為級(離線 fixture)：巢狀層級的語義 —— 前階看「上一層」，不是同層鄰居', async () => {
  // ⚠ 這一條刻意**不連網**：官網連不上時，上一條會整條跳過，語義就沒人守了。
  //   fixture 是資料不是判準，仍然只呼叫唯一的 resolveEvolvesFrom（沒有抄第二份選擇器）。
  const mod = await import(pathToFileURL(join(ROOT, 'scripts/scrape/parse-card.js')).href);
  const cheerio = await import('cheerio');
  const wrap = (inner) => '<html><body><div class="evolution">' + inner + '</div></body></html>';

  // (a) 本人在 first 層 ＝ 基礎寶可夢 ⇒ 一律 null。
  //     **即使同層前面還有別的 li.step 也一樣** —— 「同層」是分支／別的印刷版本，不是前階。
  const basic = wrap(
    '<ul class="evolutionStep first">'
    + '<li class="step"><a>同層鄰居</a></li>'
    + '<li class="step active"><a>本人</a></li>'
    + '<li><ul class="evolutionStep second"><li class="step"><a>下一階</a></li></ul></li>'
    + '</ul>');
  ok(mod.resolveEvolvesFrom(cheerio.load(basic)) === null,
    '本人在 first 層卻取到了前階 —— 基礎寶可夢不該有 evolvesFrom');

  // (b) 本人在 second 層，同層有 3 個分支排在前面 ⇒ 前階必須是 first 層那個，不是同層鄰居。
  const branch = wrap(
    '<ul class="evolutionStep first">'
    + '<li class="step"><a>上一階</a></li>'
    + '<li><ul class="evolutionStep second">'
    + '<li class="step"><a>分支甲</a></li><li class="step"><a>分支乙GX</a></li>'
    + '<li class="step"><a>分支丙</a></li><li class="step active"><a>本人ex</a></li>'
    + '</ul></li></ul>');
  const got = mod.resolveEvolvesFrom(cheerio.load(branch));
  ok(got === '上一階', '分支進化取錯了：實得 ' + JSON.stringify(got) + '（同層鄰居不是前階）');

  // (c) 沒有 .evolution 區塊（訓練家／能量）⇒ null，不得 throw。
  ok(mod.resolveEvolvesFrom(cheerio.load('<html><body></body></html>')) === null,
    '沒有進化區塊時應回 null');
});

console.log('(4) 無標卡不能組進標準賽牌組（行為級）');

const S = join(ROOT, '.v6333-s.js'), E = join(ROOT, '.v6333-e.ts'), O = join(ROOT, '.v6333-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { validateDeck, isStandardReprintLegal, isBasicEnergy } from './src/lib/decks/validation';\n"
  + "export { isCardMarkStandardLegal, cardRegMarkFilterKey, NO_REG_MARK_KEY, DECK_LOCKED_SETS,"
  + " isDeckLockedCard, filterDeckSelectable } from './src/lib/cards/regulation';\n");
// ⚠⚠ Rule 41：**不可以讓整支 throw**。
//   把 regulation.ts 還原成 BASE 時（＝中央述詞不存在），esbuild 會直接 build fail；
//   若不接住，這支守衛會在第 (4) 節整個炸掉 —— 後面 8 條就永遠沒跑到，
//   等於「只證明得到第一條」。接住之後改成：V 是空物件，依賴它的條目各自記成 FAIL。
let V = {};
let BUNDLE_ERR = null;
try {
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent',
  });
  V = await import(pathToFileURL(O).href);
} catch (e) {
  BUNDLE_ERR = (e && e.message ? e.message : String(e)).split('\n')[0];
}
T('前提：validation/regulation 打包得起來（打不起來代表中央述詞不存在或簽名壞了）', () => {
  ok(!BUNDLE_ERR, 'esbuild 失敗：' + BUNDLE_ERR);
  for (const n of ['validateDeck', 'isCardMarkStandardLegal', 'cardRegMarkFilterKey']) {
    ok(typeof V[n] === 'function', '缺 export：' + n);
  }
});
/** 打不起來時，下面每一條都直接記 FAIL（而不是讓 TypeError 冒出來）。 */
const needV = (n) => { ok(!BUNDLE_ERR, '打包失敗，這條無法驗證：' + BUNDLE_ERR);
  ok(typeof V[n] === 'function', 'regulation/validation 沒有 export ' + n); };

const POOL = new Map();
for (const e of INDEX) {
  const arr = jsonOr(join(D, e.code + '.json'), []);
  for (const c of arr) if (c && c.id != null) POOL.set(String(c.id), c);
}

function deckWith(swapId, swapCount) {
  const energy = [...POOL.values()]
    .find((c) => c.supertype === 'Energy' && c.subtype === 'Basic' && c.regulationMark === 'J');
  // ⚠ 填充用的基礎寶可夢**不可以**來自不開放組牌的卡包，否則每一副測試牌組都會多一條 issue。
  const basic = [...POOL.values()]
    .find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
      && c.regulationMark === 'J' && !LOCKED.isDeckLockedCard(c) && String(c.id) !== String(swapId));
  const entries = [
    { cardId: String(swapId), count: swapCount },
    { cardId: String(basic.id), count: 1 },
    { cardId: String(energy.id), count: 59 - swapCount },
  ];
  return { id: 'g', name: 'g', entries, createdAt: '', updatedAt: '' };
}

T('無標卡進牌組 -> 必須被判不合法，且訊息講得出「純收藏卡」', () => {
  needV('validateDeck');
  ok(POOL.has('20044'), '卡池沒有 20044（無標皮卡丘）');
  const r = V.validateDeck(deckWith('20044', 4), POOL);
  const hit = r.issues.filter((s) => s.includes('皮卡丘'));
  ok(hit.length > 0,
    '無標卡沒有被擋下來（fail-open）。issues=' + JSON.stringify(r.issues)
    + '\n      -> validation.ts 若寫成 `if (card.regulationMark && !STANDARD_MARKS.has(...))`，'
    + '標缺席時整段跳過，這副牌會被判成合法');
  ok(hit.some((s) => s.includes('純收藏卡')),
    '訊息沒說清楚是「沒有賽制標記的純收藏卡」，實得：' + JSON.stringify(hit));
  ok(r.legal === false, 'legal 應為 false');
});

T('零回歸(1)：同一副牌把那 4 張換成 J 標卡 -> 不得再出現該條 issue', () => {
  needV('validateDeck');
  const j = [...POOL.values()].find((c) => c.setCode === 'M6a' && c.regulationMark === 'J'
    && c.supertype === 'Pokemon' && c.stage === 'Basic');
  ok(j, '找不到 M6a 的 J 標基礎寶可夢');
  const r = V.validateDeck(deckWith(j.id, 4), POOL);
  const bad = r.issues.filter((s) => s.includes('純收藏卡') || s.includes('已退出標準賽'));
  ok(bad.length === 0, 'J 標卡不該被擋：' + JSON.stringify(bad));
});

T('零回歸(2)：G 標卡（非重印豁免）仍然報「已退出標準賽」，不得被新訊息取代', () => {
  needV('validateDeck');
  const g = [...POOL.values()].find((c) => c.regulationMark === 'G'
    && c.supertype === 'Pokemon' && !V.isStandardReprintLegal(c));
  ok(g, '卡池找不到 G 標寶可夢');
  const r = V.validateDeck(deckWith(g.id, 1), POOL);
  ok(r.issues.some((s) => s.includes(g.name) && s.includes('G 標') && s.includes('已退出標準賽')),
    'G 標訊息壞了：' + JSON.stringify(r.issues));
});

T('無標卡的卡名都不在「重印豁免」名單裡（否則上面那條會被豁免繞過去）', () => {
  needV('isStandardReprintLegal');
  ok(Array.isArray(M6A), '沒有 M6a.json');
  const leak = M6A.filter((c) => !c.regulationMark
    && (V.isStandardReprintLegal(c) || V.isBasicEnergy(c)));
  ok(leak.length === 0, leak.length + ' 張無標卡會被重印/基本能量豁免放行：'
    + leak.map((c) => c.id + ' ' + c.name).join(', ')
    + '\n      -> 重印豁免是**照卡名**放行的，新增無標卡時必須重查一次');
});

T('中央述詞 isCardMarkStandardLegal 對「標缺席」是 fail-closed', () => {
  ok(typeof V.isCardMarkStandardLegal === 'function', 'regulation.ts 沒有 export 這個述詞');
  for (const v of [undefined, null, '', 'n/a', 'G', 'F', 'A']) {
    ok(V.isCardMarkStandardLegal(v) === false, JSON.stringify(v) + ' 不該被判成標準合法');
  }
  for (const v of ['H', 'I', 'J']) ok(V.isCardMarkStandardLegal(v) === true, v + ' 應為合法');
});

T('Rule 38：H/I/J 合法性判準只准有一份（不得再有 local 複本）', () => {
  const files = [
    'src/lib/decks/validation.ts',
    'src/lib/server/cardIndex.ts',
    'src/routes/decks/+page.svelte',
  ];
  // 判準是「有沒有把 H/I/J 拿來當**合法性**判斷」，不是「檔案裡出現過 H/I/J 這三個字」。
  //   decks/+page.svelte 另外有 REG_MARK_ORDER / selectedRegMarks 的預設值也是 ['H','I','J']，
  //   那是**篩選鈕的顯示與預設勾選**，跟合法性無關，不該被這條掃到（否則只能靠放寬判準過關）。
  const LEGALITY_COPY = [
    /\[\s*'H'\s*,\s*'I'\s*,\s*'J'\s*\]\s*\.includes\s*\(\s*\w+\.regulationMark/,
    /(?:STANDARD_MARKS|STD_MARKS)\s*=\s*new Set\(/,
    /(?:STANDARD_MARKS|STD_MARKS)\.has\s*\(/,
  ];
  const dup = [];
  for (const f of files) {
    const src = stripComments(readOr(join(ROOT, f), ''));
    ok(src.length > 200, '讀不到 ' + f);
    if (LEGALITY_COPY.some((re) => re.test(src))) dup.push(f);
    ok(/isCardMarkStandardLegal/.test(src), f + ' 沒有呼叫中央述詞');
  }
  ok(dup.length === 0, '這些檔案還留著自己的 H/I/J 複本：' + dup.join(', '));
  const reg = stripComments(readOr(join(ROOT, 'src/lib/cards/regulation.ts'), ''));
  ok(/new Set\(\s*\[\s*'H'\s*,\s*'I'\s*,\s*'J'\s*\]\s*\)/.test(reg),
    'regulation.ts 的唯一來源不見了 —— 上一條的判準會變成恆真');
  // 反安慰劑：LEGALITY_COPY 必須真的抓得到「合法性複本」，也必須放過「顯示順序」。
  ok(LEGALITY_COPY.some((re) => re.test("if (['H', 'I', 'J'].includes(c.regulationMark)) {")),
    '判準抓不到 `[H,I,J].includes(c.regulationMark)` 這種複本');
  ok(LEGALITY_COPY.some((re) => re.test("const STANDARD_MARKS = new Set(['H','I','J']);")),
    '判準抓不到 local 的 STANDARD_MARKS 宣告');
  ok(!LEGALITY_COPY.some((re) => re.test("const REG_MARK_ORDER: RegMarkKey[] = ['H', 'I', 'J'];")),
    '判準把「篩選鈕顯示順序」誤判成合法性複本（會逼人放寬判準）');
});

T('validation.ts 不得再出現 fail-open 的寫法', () => {
  const src = stripComments(readOr(join(ROOT, 'src/lib/decks/validation.ts'), ''));
  ok(src.length > 200, '讀不到 validation.ts');
  ok(!/card\.regulationMark\s*&&\s*!/.test(src),
    '又出現 `card.regulationMark && !…` —— 這正是無標卡被放行的原形');
});

console.log('(5) 卡牌資料庫的【無標】篩選鈕');

T('分組 key：無標回 "none"，其餘回自己的標（站長裁定 A~F 不併進無標）', () => {
  ok(typeof V.cardRegMarkFilterKey === 'function', 'regulation.ts 沒有 export cardRegMarkFilterKey');
  ok(V.NO_REG_MARK_KEY === 'none', 'NO_REG_MARK_KEY 應為 "none"');
  for (const v of [undefined, null, '']) ok(V.cardRegMarkFilterKey(v) === 'none', JSON.stringify(v) + ' 應歸 none');
  for (const v of ['G', 'H', 'I', 'J', 'A', 'F']) ok(V.cardRegMarkFilterKey(v) === v, v + ' 應回自己');
  ok(V.cardRegMarkFilterKey('A') !== 'none',
    '舊標 A 被併進【無標】了 —— 站長裁定【無標】只收真的完全沒有標的');
});

T('/cards 的按鈕列：由左至右＝不限/無標/G標/H標/I標/J標', () => {
  const raw = readOr(join(ROOT, 'src/routes/cards/+page.svelte'), '');
  const src = stripComments(raw);
  ok(src.length > 5000, '讀不到 cards/+page.svelte');
  const m = src.match(/REG_MARK_ORDER\s*:\s*RegMarkKey\[\]\s*=\s*\[([^\]]*)\]/);
  ok(m, '找不到 REG_MARK_ORDER');
  const order = m[1].split(',').map((s) => s.replace(/as RegMarkKey/, '').trim().replace(/^'|'$/g, ''));
  ok(order[0] === 'NO_REG_MARK_KEY' || order[0] === 'none',
    '第一顆（【不限】右邊）必須是【無標】，實得 ' + order[0]);
  ok(order.slice(1).join(',') === 'G,H,I,J',
    '後面四顆應為 G,H,I,J，實得 ' + order.slice(1).join(','));
  ok(/none\s*:\s*'無標'/.test(src), 'REG_MARK_LABEL 沒有把 none 標成「無標」');
  ok(/cardRegMarkFilterKey\(c\.regulationMark\)/.test(src), '篩選沒有走中央的 cardRegMarkFilterKey');
  ok(!/!c\.regulationMark\s*\|\|\s*!marks\.has/.test(src),
    '舊的 `!c.regulationMark || !marks.has(...)` 還在 —— 無標卡在任何鈕下都會被濾掉，'
    + '【無標】鈕會永遠是空的');
});

T('正對照：站上真的有卡會落進【無標】鈕（否則新按鈕是空的）', () => {
  needV('cardRegMarkFilterKey');
  const none = [...POOL.values()].filter((c) => V.cardRegMarkFilterKey(c.regulationMark) === 'none');
  ok(none.length === 21,
    '落進【無標】的卡應為 21 張（全部來自 M6a），實得 ' + none.length
    + (none.length ? '（例：' + none.slice(0, 3).map((c) => c.id + ' ' + c.name).join(', ') + '）' : ''));
  ok(none.every((c) => c.setCode === 'M6a'), '無標卡應該全部來自 M6a');
});


console.log('(6) 同名不同印刷：卡面數字不可寫死在 regPre');

await TA('行為級：皮卡丘ex｜打雷 —— SVM 038/175 打 220、M6a 048/103 打 200（同一個 handler）', async () => {
  // ⚠ 這是 M6a 帶出來的真 bug：引擎用「卡名|招式名」當 key，但同名不同印刷的卡面數字不同。
  //   v6.333 之前 regPre 硬寫 220 ⇒ M6a 那張會多打 20 點。
  const E2 = join(ROOT, '.v6333b-e.ts'), O2 = join(ROOT, '.v6333b-o.mjs');
  try {
    writeFileSync(E2,
      "export { ATTACK_PRE, faceAttackDamage } from './src/lib/game/effects/_shared';\n"
      + "import './src/lib/game/effects';\n");
    await build({ entryPoints: [E2], outfile: O2, bundle: true, format: 'esm', platform: 'node',
      target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
    const { ATTACK_PRE, faceAttackDamage } = await import(pathToFileURL(O2).href + '?t=' + Date.now());
    ok(typeof faceAttackDamage === 'function', '_shared 沒有 export faceAttackDamage');
    const pre = ATTACK_PRE.get('皮卡丘ex|打雷');
    ok(pre, '找不到 皮卡丘ex|打雷 的 ATTACK_PRE');
    let u = 0;
    const inst = (cid) => ({ iid: 'p' + (++u), cardId: String(cid), damage: 0, energyAttached: [] });
    const mk = (cid) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
      turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
      players: [{ name: 'A', active: inst(cid), bench: [], hand: [], deck: [], discard: [], prizes: [] },
                { name: 'B', active: inst(cid), bench: [], hand: [], deck: [], discard: [], prizes: [] }] });
    const face = (id) => {
      const c = POOL.get(id); ok(c, '卡池沒有 ' + id);
      const a = (c.attacks || []).find((x) => x.name === '打雷'); ok(a, id + ' 沒有「打雷」');
      return parseInt(String(a.damage), 10);
    };
    for (const id of ['12108', '19960', '20038']) {
      const want = face(id);
      const got = pre(mk(id), 0, POOL, {}).damage;
      ok(got === want, `${id}（${POOL.get(id).setCode} ${POOL.get(id).collectorNumber}）卡面 ${want}，引擎算出 ${got}`);
    }
    // 反安慰劑：兩張的卡面數字必須真的不同，否則上面那條在測「兩個相同的值」（Rule 39）
    ok(face('12108') !== face('19960'),
      '兩張皮卡丘ex的「打雷」卡面數字一樣 —— 這條斷言失去鑑別力，請換一組真的有分歧的樣本');
    // 複製招式：出招者卡面沒有這一招 ⇒ 走 fallback，行為與 v6.333 之前一致（不得因收斂而回歸）
    const fb = pre(mk('19913'), 0, POOL, {}).damage;
    ok(fb === 220, '出招者卡面沒有「打雷」時應退回舊有的 220，實得 ' + fb);

    // ── faceAttackDamage 的單元行為（上面走 regPre 摸不到這幾條邊界）──
    // (a) 條件式傷害（「120+」「30×」）**不可**被當成純數字硬吃 —— 那種招式的實際傷害
    //     本來就該由各自的 regPre 算，誤吃會把加成前的底數當成最終值。
    const condCard = [...POOL.values()].find((c) => (c.attacks || []).some((a) =>
      /^\d+[+＋×x]/.test(String(a.damage || '').trim())));
    ok(condCard, '卡池找不到「條件式傷害」的樣本（如 120+ / 30×），這條測不到');
    const condAtk = condCard.attacks.find((a) => /^\d+[+＋×x]/.test(String(a.damage || '').trim()));
    ok(faceAttackDamage(mk(String(condCard.id)), 0, POOL, condAtk.name, 777) === 777,
      `條件式傷害「${condAtk.damage}」被當成純數字吃掉了 —— 應該退回 fallback`);
    // (b) 沒有戰鬥寶可夢（複製招式／異常狀態）⇒ 退回 fallback，不可以變成 0
    const noActive = mk('19960');
    noActive.players[0] = { ...noActive.players[0], active: null };
    ok(faceAttackDamage(noActive, 0, POOL, '打雷', 555) === 555,
      '沒有戰鬥寶可夢時應退回 fallback（回 0 會讓招式突然變成不造成傷害）');
    // (c) 正對照：純數字時真的讀得到，而且不是回 fallback
    ok(faceAttackDamage(mk('19960'), 0, POOL, '打雷', 999) === 200,
      '純數字卡面沒有被讀出來');
  } finally { for (const f of [E2, O2]) { try { unlinkSync(f); } catch { /* noop */ } } }
});

T('同名碰撞盤點：M6a 與既有印刷「同招式名但卡面不同」的組合必須全部列管', () => {
  ok(Array.isArray(M6A), '沒有 M6a.json');
  const others = [];
  for (const e of INDEX) {
    if (e.code === 'M6a') continue;
    for (const c of jsonOr(join(D, e.code + '.json'), [])) if (c) others.push(c);
  }
  // ⚠ 官網的卡面文字在不同印刷之間會出現「空行裡多一個半形空格」這種**純排版差異**
  //   （高級球：舊印刷是 `\n \n`、M6a 是 `\n\n`，逐字比會誤報成碰撞）。
  //   ⇒ 比較前把空白全部剝掉；中文卡面沒有語意上的空白，真正的措辭差異一個都不會被蓋掉。
  const norm = (x) => String(x ?? '').replace(/[ \t\u3000\r\n]+/g, '');
  const seen = new Set(); const collisions = [];
  // ⚠ Opus 5 審查指出：只掃 attacks 會漏。效果的載體有三種，三種都要掃
  //   （同「枚舉必含道具 rulesText 等所有載體」那條）。目前特性與訓練家實測 0 筆分歧，
  //   但下一包再撞名時掃描器不能是瞎的。
  for (const c of M6A) {
    for (const a of c.attacks || []) {
      const k = `${c.name}|${a.name}`;
      if (seen.has(k)) continue; seen.add(k);
      const diff = others.some((o) => o.name === c.name && (o.attacks || []).some((b) =>
        b.name === a.name
        && (norm(b.damage) !== norm(a.damage) || norm(b.effect) !== norm(a.effect))));
      if (diff) collisions.push(k);
    }
    for (const a of c.abilities || []) {
      const k = `${c.name}|${a.name}`;
      if (seen.has(k)) continue; seen.add(k);
      const diff = others.some((o) => o.name === c.name && (o.abilities || []).some((b) =>
        b.name === a.name && norm(b.effect) !== norm(a.effect)));
      if (diff) collisions.push(k);
    }
    if (c.supertype === 'Trainer' && String(c.rulesText ?? '').trim()) {
      const k = `${c.name}|(訓練家)`;
      if (!seen.has(k)) {
        seen.add(k);
        const diff = others.some((o) => o.name === c.name && o.supertype === 'Trainer'
          && String(o.rulesText ?? '').trim() && norm(o.rulesText) !== norm(c.rulesText));
        if (diff) collisions.push(k);
      }
    }
  }
  // 逐張比對過官方卡面後列管於此。新卡包若又撞名，這條會逼人回來看。
  const KNOWN_COLLISIONS = [
    '卡比獸|倒下',        // 130 vs M3 160；效果同（自身睡眠），傷害讀卡面 ⇒ 安全
    '呆呆獸|水槍',        // 20 vs SVM 10；兩邊都沒有效果，傷害讀卡面 ⇒ 安全
    '密勒頓|音速伏特',    // 20 vs MC/MJ 60；兩邊都沒有效果 ⇒ 安全
    '巨鉗螳螂ex|鋼翼',    // 40/-20 vs MC/SV5M 70/-50，效果**不同**；但 M6a 這張是無標，打不了
    '皮卡丘ex|十萬伏特',  // 200＋丟能量 vs MC/MJ 120 無效果；新效果列管在待實裝清單
    '皮卡丘ex|打雷',      // 200 vs SVM 220 —— v6.333 修掉的真 bug（改讀卡面）
  ].sort();
  ok(collisions.sort().join(',') === KNOWN_COLLISIONS.join(','),
    '同名碰撞清單有變動：\n      實際 = ' + collisions.join('、')
    + '\n      列管 = ' + KNOWN_COLLISIONS.join('、')
    + '\n      → 每一組都要逐張比對官方卡面，確認 handler 有沒有把別的印刷的數字/效果套上去');
  // 反安慰劑：掃描器要真的掃得到東西
  ok(collisions.length >= 5, '只掃到 ' + collisions.length + ' 組碰撞，掃描器可能壞了');
  // 反安慰劑：norm 只能吃掉空白，不可以把真正的措辭／數字差異也抹平
  ok(norm('\n \n從自己的牌庫') === norm('\n\n從自己的牌庫'), 'norm 沒有把純排版差異正規化');
  ok(norm('200') !== norm('220') && norm('受到30點傷害') !== norm('受到50點傷害'),
    'norm 把真正的差異也抹掉了 —— 這條掃描器會變成瞎的');
});

T('測試端不得再「只用卡名挑印刷」（同名多印刷會靜默挑錯）', () => {
  for (const f of ['scripts/test-retaliation-tail-cdef.mjs', 'scripts/test-hand-attach-percard-reaction.mjs']) {
    const src = stripComments(readOr(join(ROOT, f), ''));
    ok(src.length > 200, '讀不到 ' + f);
    ok(/pickPrinting/.test(src), f + ' 沒有走中央的 pickPrinting');
  }
  const lib = readOr(join(ROOT, 'scripts/lib/pick-printing.mjs'), '');
  ok(/export function pickPrinting/.test(lib), 'scripts/lib/pick-printing.mjs 不存在或沒有 export');
});

await TA('行為級：pickPrinting 真的會依「招式／特性」分辨同名的不同印刷', async () => {
  const { pickPrinting } = await import(pathToFileURL(join(ROOT, 'scripts/lib/pick-printing.mjs')).href);
  // 耿鬼ex：MC/SV5K 的特性是【侵蝕詛咒】，M6a 076/103 的是【死亡宣告】——必須挑到不同張
  const curse = pickPrinting(POOL, '耿鬼ex', { ability: '侵蝕詛咒' });
  const doom = pickPrinting(POOL, '耿鬼ex', { ability: '死亡宣告' });
  ok(curse !== doom, '兩個不同特性挑到同一張耿鬼ex（' + curse + '）—— 判準沒有在看特性名');
  ok((POOL.get(curse).abilities || []).some((a) => a.name === '侵蝕詛咒'), curse + ' 沒有【侵蝕詛咒】');
  ok((POOL.get(doom).abilities || []).some((a) => a.name === '死亡宣告'), doom + ' 沒有【死亡宣告】');
  ok(POOL.get(doom).setCode === 'M6a', '【死亡宣告】那張應該是 M6a 的，實得 ' + POOL.get(doom).setCode);
  // 藏瑪然特：只有 SV10 那張有「強大猛擊」
  const zama = pickPrinting(POOL, '藏瑪然特', { attack: '強大猛擊' });
  ok((POOL.get(zama).attacks || []).some((a) => a.name === '強大猛擊'), zama + ' 沒有「強大猛擊」');
  // 條件對不上時必須 throw（不可以靜默回第一張）
  let threw = false;
  try { pickPrinting(POOL, '藏瑪然特', { attack: '這招不存在' }); } catch { threw = true; }
  ok(threw, '條件對不上時沒有 throw —— 會靜默挑錯印刷，正是這次要修掉的病');
});

console.log('(7) M6a 不開放對戰：不可組牌、卡效果一律不實裝');

await TA('⭐⭐⭐ 行為級：M6a 的卡進牌組 → 不合法，且訊息說得出「暫時無法加入牌組」', async () => {
  needV('validateDeck');
  ok(POOL.has('19960'), '卡池沒有 19960（M6a J 標 皮卡丘ex）');
  const r = V.validateDeck(deckWith('19960', 4), POOL);
  const hit = r.issues.filter((x) => x.includes('皮卡丘ex'));
  ok(hit.length > 0, 'M6a 的 J 標卡沒有被擋下來。issues=' + JSON.stringify(r.issues));
  ok(hit.some((x) => x.includes('不開放用於對戰') && x.includes('暫時無法加入牌組')),
    '訊息沒說清楚原因，實得：' + JSON.stringify(hit));
  ok(r.legal === false, 'legal 應為 false');
});

T('⭐⭐ 零回歸：非 M6a 的 J 標卡照樣可以組進牌組（不得把整個標都擋掉）', () => {
  needV('validateDeck');
  const j = [...POOL.values()].find((c) => c.regulationMark === 'J' && c.setCode !== 'M6a'
    && c.supertype === 'Pokemon' && c.stage === 'Basic');
  ok(j, '找不到非 M6a 的 J 標基礎寶可夢');
  const r = V.validateDeck(deckWith(j.id, 4), POOL);
  const bad = r.issues.filter((x) => x.includes('暫時無法加入牌組') || x.includes('純收藏卡'));
  ok(bad.length === 0, j.setCode + ' 的卡不該被擋：' + JSON.stringify(bad));
});

await TA('⭐⭐ 兩份 DECK_LOCKED_SETS（regulation.ts / deck-locked-sets.mjs）必須逐項相同', () => {
  ok(V.DECK_LOCKED_SETS instanceof Set, 'regulation.ts 沒有 export DECK_LOCKED_SETS');
  const ts = [...V.DECK_LOCKED_SETS].sort();
  const mjs = [...LOCKED.DECK_LOCKED_SETS].sort();
  ok(ts.join(',') === mjs.join(','),
    'runtime 與守衛端的清單漂移了：regulation.ts=[' + ts + '] vs deck-locked-sets.mjs=[' + mjs + ']');
  ok(ts.length > 0 && ts.includes('M6a'), '清單應包含 M6a，實得 [' + ts + ']');
  ok(LOCKED.isDeckLockedCard({ setCode: 'M6a' }) === true
    && LOCKED.isDeckLockedCard({ setCode: 'M6' }) === false
    && LOCKED.isDeckLockedCard(null) === false, 'isDeckLockedCard 判斷壞了');
  ok(LOCKED.allCarriersDeckLocked([]) === false,
    'allCarriersDeckLocked 對空集合回了 true —— 那會變成「找不到就一律豁免」的恆真安慰劑');
  ok(LOCKED.allCarriersDeckLocked([{ setCode: 'M6a' }, { setCode: 'M6' }]) === false,
    '只要有一張是可對戰卡就不該豁免');
});

await TA('⭐⭐⭐ 站上不變量：**不在**不開放清單裡的 live H/I/J 卡，未實裝**招式**必須是 0', async () => {
  // ⚠ 這條把「M6a 之前 1691 招有效果、未實裝 0」這個從沒破過的不變量**明確釘住**。
  //   站長裁定 M6a 全部不實裝 ⇒ 它被排除；但**別的**卡包若哪天悄悄多出未實裝的卡，
  //   或誰把既有 handler 刪了，這裡就會紅。這比「一份會腐爛的待實裝清單」可靠：
  //   清單會過期，不變量不會。
  //
  // ⚠⚠ **只掃招式，不掃特性**（第一版掃了特性，誤報 890 筆）：
  //   招式的判準是**精確**的 —— 引擎用 `ATTACK_PRE/ATTACK_POST/ATTACK_PRE_DISCARD_CHOICE`
  //   查 `卡名|招式名`，**沒有 fallback**（見 scripts/coverage-unimplemented.mjs 的說明），
  //   查不到就等於效果靜默失效。
  //   特性**不是**：實測 registry 只有 by-index 123 + by-name 11 ＝ 134 筆，但站上 H/I/J 特性
  //   有 250 筆以上 —— 被動特性根本沒有 handler，是由引擎的各個 helper 直接讀卡面判定的。
  //   拿 registry 當「有沒有實裝」的判準對特性完全不成立。
  //   ⇒ 特性的覆蓋由 `test-v6205` 第 ⑦ 節（逐張判讀表）負責，那支也已接上同一份 deck-locked 判準。
  const E3 = join(ROOT, '.v6333c-e.ts'), O3 = join(ROOT, '.v6333c-o.mjs');
  let missing = [], scanned = 0;
  try {
    // ⚠ 特性有**兩個** registry：`regA` 寫進 ABILITY_EFFECTS（key＝`卡名|索引`）、
    //   `regAByName` 寫進 ABILITY_EFFECTS_BY_NAME（key＝`卡名|特性名`）。
    //   只查其中一個會把另一半全部誤判成「未實裝」（第一版就這樣誤報了 890 筆）。
    writeFileSync(E3, "export { ATTACK_PRE, ATTACK_POST, ATTACK_PRE_DISCARD_CHOICE }"
      + " from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';\n");
    await build({ entryPoints: [E3], outfile: O3, bundle: true, format: 'esm', platform: 'node',
      target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent' });
    const R = await import(pathToFileURL(O3).href + '?t=' + Date.now());
    const ak = new Set([...R.ATTACK_PRE.keys(), ...R.ATTACK_POST.keys(),
      ...(R.ATTACK_PRE_DISCARD_CHOICE ? R.ATTACK_PRE_DISCARD_CHOICE.keys() : [])]);
    ok(ak.size > 800, '招式 registry 只掃到 ' + ak.size + ' 筆 —— 掃描器壞了？');
    for (const c of POOL.values()) {
      if (!['H', 'I', 'J'].includes(c.regulationMark)) continue;
      if (LOCKED.isDeckLockedCard(c)) continue;
      for (const a of c.attacks || []) {
        if (!String(a.effect || '').trim()) continue;
        scanned++;
        if (!ak.has(`${c.name}|${a.name}`)) missing.push(`${c.setCode} ${c.name}|${a.name}`);
      }
    }
  } finally { for (const f of [E3, O3]) { try { unlinkSync(f); } catch { /* noop */ } } }
  ok(scanned > 1500, '只掃到 ' + scanned + ' 條有效果的招式 —— 掃描器壞了？');
  ok(missing.length === 0,
    '有 ' + missing.length + ' 個可對戰的招式沒有實作：' + missing.slice(0, 8).join('、')
    + '\n      → 引擎對「沒有 handler 的招式」是**靜默略過效果、只結算卡面傷害**，'
    + '代價型招式（自傷／鎖招／丟能量）會變成單方面對出招者有利。'
    + '\n      → 要嘛把它實作出來，要嘛把那個卡包加進 DECK_LOCKED_SETS（兩份都要改）。');
  console.log('        掃描 ' + scanned + ' 條可對戰的招式，未實裝 0');
});

T('⭐⭐ /decks 候選池要濾掉不開放對戰的卡包，但 poolById 不可以濾', () => {
  const src = stripComments(readOr(join(ROOT, 'src/routes/decks/+page.svelte'), ''));
  ok(src.length > 5000, '讀不到 decks/+page.svelte');
  ok(/pool\s*=\s*filterDeckSelectable\(/.test(src),
    '候選池沒有走 filterDeckSelectable —— 玩家還是挑得到 M6a');
  ok(/poolById\s*=\s*buildCardIndex\(allCards\)/.test(src),
    'poolById 被濾了 —— 已存牌組裡的 M6a 卡會變成「缺卡」，而不是被 validateDeck 明確指出來');
});

T('⭐⭐ /cards 卡牌資料庫**不可以**套用組牌閘（站長要求可查卡）', () => {
  const src = stripComments(readOr(join(ROOT, 'src/routes/cards/+page.svelte'), ''));
  ok(src.length > 5000, '讀不到 cards/+page.svelte');
  ok(!/filterDeckSelectable|isDeckLockedCard|DECK_LOCKED_SETS/.test(src),
    '卡牌資料庫套上了組牌閘 —— 站長要的是「可查卡、不可組牌」');
  // 行為面：M6a 的卡（含 21 張無標）必須還在 /cards 用得到的卡池裡
  const m6aLive = [...POOL.values()].filter((c) => c.setCode === 'M6a');
  ok(m6aLive.length === 168, 'M6a 應有 168 張在 live 卡池，實得 ' + m6aLive.length);
});

console.log('\n=== v6.333 M6a + 無標卡：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
