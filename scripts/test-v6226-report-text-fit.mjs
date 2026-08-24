// v6.226 / admin v1.73 守衛：報告圖文字「溢出／不必要截斷」維度。
//
// 站長回報兩個症狀（2026-08-24）：
//   【A】奪冠報告完整版（1920 多頁 ZIP）：玩家名被 miFit 寫死 300px 截成「…」，
//       但該列右側到成績欄之間明明一大片空白（「這個版面容納玩家的長名稱綽綽有餘」）。
//       單頁奪冠報告同型（名字寫死 260px）。
//   【B】單頁環境報告：底部註腳**置中單行直畫、無任何寬度處理** ⇒ 文字比畫布寬時
//       左右兩端同時被裁掉（「本期…」的「本」與「…勝率」的「率」都消失）。
//
// 修法（v1.73）：
//   【A】名字／牌組名改共享該列實際可用寬（右緣 − 起點 − 間距），策略＝
//       「名字優先、牌組名保底 DECK_MIN」：名字放得下就完整顯示；名字過長時只保證
//       牌組名最少 DECK_MIN，其餘全給名字＝長名的硬上限，絕不撞右緣。
//   【B】新增 miWrap 逐字換行（英數 run 不硬切）；兩行時頁腳整塊上移，
//       第二行仍收在畫布下緣之內。站長要「完整內容」⇒ 不可用 miFit 截斷。
//
// ⚠ 本檔沿用 v6168/v6169 的做法：把繪圖層抽出來接記錄型假 ctx **真的畫一遍**再量，
//   量寬模型與 v6169 相同（全形 1.0em／半形 0.55em）。「有呼叫 miFit」≠「沒截錯」。
// ⚠ IRON_RULES Rule 25：每個 draw 都有「畫出來的字數下限」斷言，抽取器壞掉不給假綠。
// HEAD-FAIL（對 v6.225 / admin v1.72 跑本檔）：
//   miWrap 不存在、20 全形字玩家名被截成「…」、長註腳左右出界 —— 全部紅。
// 突變測試（手動）：動態寬改回寫死 300／260／900、換行改回單行 ⇒ 都要紅。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADM_PATH = process.env.V6226_ADMIN || join(ROOT, 'oracle-admin/admin.html');
const ADM = readFileSync(ADM_PATH, 'utf8');

let pass = 0, fail = 0;
const asyncChecks = [];
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function TA(name, fn) { asyncChecks.push([name, fn]); }
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function slice(src, a, b) {
  const i = src.indexOf(a); if (i < 0) return '';
  const j = b ? src.indexOf(b, i + a.length) : -1;
  return src.slice(i, j > 0 ? j : src.length);
}

// ── 工廠：與 v6169 同一招 —— 每呼叫一次是一份全新模組作用域 ─────────────────
let FACTORY = null;
try {
  const src = slice(ADM, "const MI_URL = 'www.ptcg-tw-sim.com';", 'window.loadArchetypeStats = async function');
  if (src.length > 5000 && src.includes('mpDrawChampion')) {
    FACTORY = new Function('window', 'document', 'alert', 'detectMainPokemon', 'localStorage',
      src
      + '\nmiLogo = async function () { return null; };'
      + '\nreturn { MI, MP, CR, miFit, miDraw, crDraw, mpDrawChampion, crNotes,'
      + " miWrap: (typeof miWrap === 'function' ? miWrap : null) };");
  }
} catch (e) { console.log('  ✗ 工廠建立失敗 :: ' + (e && e.message)); fail++; }

// ── 記錄型假 ctx（量寬模型與 v6169 相同）────────────────────────────────────
const WIDE = (cp) => cp >= 0x1100;
function mkCtx() {
  const rec = { texts: [], rects: [], images: 0 };
  const noop = () => {};
  let _font = '16px sans-serif', _align = 'left';
  const px = () => { const m = /(\d+(?:\.\d+)?)px/.exec(_font); return m ? Number(m[1]) : 16; };
  const measure = (s) => {
    const p = px(); let w = 0;
    for (const ch of String(s)) w += (WIDE(ch.codePointAt(0)) ? 1.0 : 0.55) * p;
    return w;
  };
  const ctx = {
    fillStyle: '', strokeStyle: '', textBaseline: '', lineWidth: 1, globalAlpha: 1,
    get font() { return _font; },
    set font(v) { _font = v; },
    get textAlign() { return _align; },
    set textAlign(v) { _align = v; },
    fillText(s, x, y) {
      const w = measure(s);
      const left = _align === 'right' ? x - w : (_align === 'center' ? x - w / 2 : x);
      rec.texts.push({ s: String(s), x, y, w, left, right: left + w, px: px(), align: _align });
    },
    measureText(s) { return { width: measure(s) }; },
    fillRect(x, y, w, h) { rec.rects.push([x, y, w, h]); },
    strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    arc: noop, arcTo: noop, rect: noop, fill: noop, stroke: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setLineDash: noop, clip: noop,
    drawImage() { rec.images++; },
    createLinearGradient() { return { addColorStop: noop }; },
  };
  return { rec, ctx };
}
/** miDraw / crDraw 自己 createElement('canvas')，把我們的 ctx 餵進去。 */
function mkApiWithCanvas() {
  ok(FACTORY, '抽不到報告圖區段（admin.html 的 MI_URL … loadArchetypeStats 那一段）');
  const { rec, ctx } = mkCtx();
  const doc = { createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx } : {}) };
  const api = FACTORY({}, doc, () => {}, () => null, { getItem: () => null, setItem: () => {} });
  return { api, rec, ctx };
}
/** 全部文字都要在畫布內（水平）。置中溢出＝左右同時出界，這條左右都抓。 */
function assertInBounds(rec, W, tag) {
  for (const t of rec.texts) {
    if (!t.s) continue;
    ok(t.left >= -0.5, tag + '「' + t.s.slice(0, 24) + '」左緣 ' + t.left.toFixed(1) + ' 超出畫布左界 0');
    ok(t.right <= W + 0.5, tag + '「' + t.s.slice(0, 24) + '」右緣 ' + t.right.toFixed(1) + ' 超出畫布右界 ' + W);
  }
}
const findT = (rec, sub) => rec.texts.filter((t) => t.s.includes(sub));

// ── 測資 ───────────────────────────────────────────────────────────────────
const NAME20 = '這是一個總共有二十個全形字的玩家名字喔耶';   // 20 全形字
const NAME40 = NAME20 + NAME20;                                // 40 全形字（極端）
const NAME24 = NAME20 + '延長四字';                            // 24 全形字
const DECK7 = '瑪俐的長毛巨魔';                                // 7 全形字
const DECK11 = '超級噴火龍高速再生型式';                       // 11 全形字
const CAP_REASON = '資料量已達伺服器查詢上限，前期不完整';

function mkCur() {
  return {
    scanned: { casualDecks: 100, casualMatches: 500, tournDecks: 40, tournEvents: 10 },
    casual: {
      rows: [{ ruleId: 'a', name: '測試原型', usage: 30, winRate: 0.55, sampleOk: true }],
      unclassified: { usage: 10, winRate: 0.5 },
    },
  };
}
function mkChampD(champs) {
  return {
    siteChamps: champs,
    champRank: [], t4Rows: [{ name: '原型甲', n: 3 }], commRank: [{ name: '原型乙', n: 2 }],
    nSite: champs.length, nComm: 2, entries: 40, t4Total: 8,
    from: Date.now() - 7 * 86400000, to: Date.now(),
    t4Skipped: 0, noCut: 0, noChamp: 0, capped: false,
  };
}
const mkChamp = (name, deck, ev) => ({
  name, deck, eventName: ev, finishedAt: Date.now(), players: 28, w: 4, l: 0,
});

console.log('① miWrap：換行 helper（中文逐字、英數 run 不硬切、內容一字不丟）');

T('⭐ miWrap 存在（v1.72 只有 miFit＝截斷，站長要的是「完整顯示」）', () => {
  const { api } = mkApiWithCanvas();
  ok(api.miWrap, 'admin.html 還沒有 miWrap（註腳仍會被裁切）');
});

T('⭐⭐ 60 全形字 → 每行都不超寬、拼回去一字不少', () => {
  const { api, ctx } = mkApiWithCanvas();
  ok(api.miWrap, '沒有 miWrap');
  ctx.font = '22px x';
  const input = '甲'.repeat(60);
  const lines = api.miWrap(ctx, input, 984);
  ok(lines.length === 2, '60×22=1320px 應斷成 2 行，實得 ' + lines.length);
  for (const ln of lines) ok(ctx.measureText(ln).width <= 984, '「' + ln.slice(0, 10) + '…」超寬');
  ok(lines.join('') === input, '換行後內容遺失（站長要完整內容，不是截斷）');
});

T('⭐⭐ 中英數混排：英文單字與數字串不被硬切、空白不留在行首行尾', () => {
  const { api, ctx } = mkApiWithCanvas();
  ok(api.miWrap, '沒有 miWrap');
  ctx.font = '22px x';
  const run = 'abcdefg1234567';
  const input = '前置文字前置文字前置文字前置文字前置文字前置文字前置文字前置文字前置 ' + run + ' 後續文字後續文字';
  const lines = api.miWrap(ctx, input, 500);
  ok(lines.some((ln) => ln.includes(run)), '英數 run「' + run + '」被硬切：' + JSON.stringify(lines));
  for (const ln of lines) ok(!/^[\s　]/.test(ln) && !/[\s　]$/.test(ln), '行首/行尾殘留空白：' + JSON.stringify(ln));
  const strip = (s) => s.replace(/[\s　]+/g, '');
  ok(strip(lines.join('')) === strip(input), '內容遺失');
});

console.log('②【B】單頁環境報告：長註腳完整顯示（換行），不再左右被裁');

TA('⭐⭐⭐ 撞查詢上限的長註腳：完整內容、兩行、不出界、不壓網址、不超畫布下緣', async () => {
  const { api, rec } = mkApiWithCanvas();
  const cv = await api.miDraw('casual', mkCur(), { ok: false, reason: CAP_REASON }, 30);
  ok(cv, 'miDraw 回 null');
  ok(rec.texts.length >= 14, 'Rule25：只畫出 ' + rec.texts.length + ' 段文字，抽取／繪製壞了？');
  assertInBounds(rec, api.MI.W, '單頁環境報告');
  // 開頭與結尾都要看得到（站長回報「本」「率」被切）
  ok(findT(rec, '本期為單期成績').length === 1, '註腳開頭「本期為單期成績」沒畫出來');
  ok(findT(rec, '牌組不顯示勝率').length === 1, '註腳結尾「…牌組不顯示勝率」沒畫出來');
  // 完整內容：把註腳行拼回去必須等於原文（去空白比對；不可有「…」）
  const foot = '本期為單期成績，未與上期比較（' + CAP_REASON + '）　・　使用不到 10 次的牌組不顯示勝率';
  const footLines = rec.texts.filter((t) => t.align === 'center' && t.px <= 24 && t.y > 1240);
  ok(footLines.length === 2, '長註腳應為 2 行，實得 ' + footLines.length + '（1＝沒換行會被裁；>2＝擠不進頁腳）');
  const strip = (s) => s.replace(/[\s　]+/g, '');
  ok(strip(footLines.map((t) => t.s).join('')) === strip(foot), '註腳拼回去與原文不符（被截斷或丟字）：'
    + JSON.stringify(footLines.map((t) => t.s)));
  ok(footLines.every((t) => !t.s.includes('…')), '註腳出現「…」—— 站長要的是完整內容不是截斷');
  // 垂直：不超過畫布下緣、與網址列不相碰（textBaseline=middle ⇒ 帶寬 y ± px/2）
  for (const t of footLines) ok(t.y + t.px / 2 <= api.MI.H - 2, '註腳 y=' + t.y + ' 超出畫布下緣 ' + api.MI.H);
  const url = rec.texts.filter((t) => t.s === 'www.ptcg-tw-sim.com' && t.align === 'center');
  ok(url.length === 1, '底部網址沒畫出來');
  for (const t of footLines) {
    const gap = (t.y - t.px / 2) - (url[0].y + url[0].px / 2);
    ok(gap >= 2, '註腳第一行與網址列垂直間隙只有 ' + gap.toFixed(1) + 'px（會相碰）');
  }
});

TA('⭐ 正對照：短註腳＝單行、版位與 v1.72 完全相同（網址 1284／註腳 1322）', async () => {
  const { api, rec } = mkApiWithCanvas();
  const cv = await api.miDraw('casual', mkCur(), { ok: false, reason: '' }, 30);
  ok(cv, 'miDraw 回 null');
  assertInBounds(rec, api.MI.W, '單頁環境報告(短註腳)');
  const footLines = rec.texts.filter((t) => t.align === 'center' && t.px <= 24 && t.y > 1240);
  ok(footLines.length === 1, '短註腳應維持單行，實得 ' + footLines.length);
  ok(footLines[0].y === 1322 && footLines[0].px === 22, '短註腳版位變了（y=' + footLines[0].y + ' px=' + footLines[0].px + '，應 1322/22px）');
  const url = rec.texts.find((t) => t.s === 'www.ptcg-tw-sim.com' && t.align === 'center');
  ok(url && url.y === 1284, '短註腳時網址列應留在 1284，實得 ' + (url && url.y));
});

console.log('③【A】奪冠報告完整版（1920 多頁）：名字／牌組名共享可用寬');

function mkChampPage(api, champs) {
  const d = mkChampD(champs);
  return {
    kind: 'champ', icon: '🏆', title: '網站賽　冠軍', accent: 'a1',
    page: 1, pageTotal: 1, startRank: 1, sectionTotal: champs.length,
    rows: champs, d, notes: api.crNotes(d), unit: '',
  };
}

TA('⭐⭐⭐ 20 全形字玩家名：完整顯示、無「…」（v1.72 寫死 300px 必截＝HEAD-FAIL）', async () => {
  const { api } = mkApiWithCanvas();
  const { rec, ctx } = mkCtx();
  await api.mpDrawChampion(ctx, mkChampPage(api, [mkChamp(NAME20, DECK7, '第 12 屆週末例行賽')]));
  ok(rec.texts.length >= 12, 'Rule25：只畫出 ' + rec.texts.length + ' 段文字');
  assertInBounds(rec, api.MP.W, '奪冠完整版');
  const nm = findT(rec, NAME20);
  ok(nm.length === 1, '20 字玩家名沒有完整畫出（被截成「…」＝不必要的截斷，右側明明還很空）');
  ok(!nm[0].s.includes('…'), '玩家名含「…」');
  const dk = findT(rec, DECK7);
  ok(dk.length === 1 && !dk[0].s.includes('…'), '牌組名沒完整畫出');
  ok(nm[0].right + 2 <= dk[0].left, '玩家名（止 ' + nm[0].right.toFixed(0) + '）與牌組名（起 ' + dk[0].left.toFixed(0) + '）疊在一起');
  ok(dk[0].right <= api.MP.W - api.MP.PAD - 20 + 0.5, '牌組名右緣 ' + dk[0].right.toFixed(0) + ' 撞到列右緣');
});

TA('⭐⭐ 40 全形字極端名：仍要截、但上限=可用寬−牌組名保底，兩者都不撞右緣', async () => {
  const { api } = mkApiWithCanvas();
  const { rec, ctx } = mkCtx();
  await api.mpDrawChampion(ctx, mkChampPage(api, [mkChamp(NAME40, DECK11, '這是一個名字也非常長的社群自辦循環賽第十五期決賽日')]));
  assertInBounds(rec, api.MP.W, '奪冠完整版(極端長名)');
  const nm = rec.texts.find((t) => t.s.startsWith(NAME20.slice(0, 8)) && t.px === 40);
  ok(nm, '找不到玩家名');
  ok(nm.s.includes('…'), '40 字極端名應截斷（硬上限），實際完整畫出＝會撞右緣');
  ok(nm.w > 800, '玩家名寬只有 ' + nm.w.toFixed(0) + 'px —— 動態分配沒生效（寫死 300 的舊行為）');
  const dk = rec.texts.find((t) => t.px === 38 && t.y === nm.y && t.left > nm.left);
  ok(dk, '找不到牌組名');
  ok(dk.w >= 300, '牌組名只剩 ' + dk.w.toFixed(0) + 'px（保底 DECK_MIN 沒生效）');
  ok(nm.right + 2 <= dk.left, '名字與牌組名疊在一起');
  ok(dk.right <= api.MP.W - api.MP.PAD - 20 + 0.5, '牌組名右緣 ' + dk.right.toFixed(0) + ' 撞到列右緣');
  // 第一行：賽事名不得壓到右欄成績
  const recT = rec.texts.find((t) => t.align === 'right' && t.s.includes(' 人・'));
  const evT = rec.texts.find((t) => t.align === 'left' && t.s.includes('屆') === false && t.s.includes('循環賽'));
  ok(recT, '右欄成績沒畫出來');
  if (evT) ok(evT.right + 4 <= recT.left, '賽事名（止 ' + evT.right.toFixed(0) + '）壓到成績（起 ' + recT.left.toFixed(0) + '）');
});

TA('⭐ 名次頁：原型名可用寬放寬到長條起點（>900px 且不撞 1200 的長條）', async () => {
  const { api } = mkApiWithCanvas();
  const { rec, ctx } = mkCtx();
  const d = mkChampD([]);
  const LONGA = '超級長原型名稱測試'.repeat(4);   // 36 全形字
  await api.mpDrawChampion(ctx, {
    kind: 'rank', icon: '🥈', title: '網站賽　四強牌組', accent: 'a2', unit: '次',
    page: 1, pageTotal: 1, startRank: 1, sectionTotal: 1, peak: 5,
    rows: [{ name: LONGA, n: 5 }], d, notes: api.crNotes(d),
  });
  assertInBounds(rec, api.MP.W, '奪冠名次頁');
  const nm = rec.texts.find((t) => t.x === 168 && t.px === 42);
  ok(nm, '找不到原型名');
  ok(nm.w > 920, '原型名寬只有 ' + nm.w.toFixed(0) + 'px —— 仍是寫死 900 的舊上限（可用寬其實有 1016）');
  ok(nm.right <= 1200 - 8, '原型名右緣 ' + nm.right.toFixed(0) + ' 撞到長條（起點 1200）');
});

console.log('④【A】單頁奪冠報告：同型修正（名字寫死 260 → 動態）');

TA('⭐⭐ 20 全形字玩家名：完整顯示、無「…」、牌組名與右欄成績都不重疊', async () => {
  const { api, rec } = mkApiWithCanvas();
  const cv = await api.crDraw(mkChampD([
    mkChamp(NAME20, DECK7, '第 12 屆週末例行賽'),
    mkChamp('Wilson', '天晴雨勢', '例行賽'),
  ]));
  ok(cv, 'crDraw 回 null');
  ok(rec.texts.length >= 25, 'Rule25：只畫出 ' + rec.texts.length + ' 段文字');
  assertInBounds(rec, api.MI.W, '單頁奪冠報告');
  const nm = findT(rec, NAME20);
  ok(nm.length === 1, '20 字玩家名沒有完整畫出（v1.72 寫死 260px 必截）');
  const dk = findT(rec, DECK7);
  ok(dk.length === 1 && !dk[0].s.includes('…'), '牌組名沒完整畫出');
  ok(nm[0].right + 2 <= dk[0].left, '名字與牌組名疊在一起');
  ok(dk[0].right <= api.MI.W - api.MI.PAD - 12 + 0.5, '牌組名右緣 ' + dk[0].right.toFixed(0) + ' 撞到列右緣');
});

TA('⭐ 24 全形字：截斷上限正確（名字讓出牌組名實寬）、全部在界內', async () => {
  const { api, rec } = mkApiWithCanvas();
  const cv = await api.crDraw(mkChampD([mkChamp(NAME24, DECK7, '例行賽')]));
  ok(cv, 'crDraw 回 null');
  assertInBounds(rec, api.MI.W, '單頁奪冠報告(24字)');
  const nm = rec.texts.find((t) => t.s.startsWith(NAME20.slice(0, 8)) && t.px === 34);
  ok(nm, '找不到玩家名');
  ok(nm.s.includes('…'), '24 字（816px）＋牌組名（224px）> 可用寬 932，應截名字');
  ok(nm.w > 500, '玩家名寬只有 ' + nm.w.toFixed(0) + 'px —— 動態分配沒生效（寫死 260 的舊行為）');
  const dk = findT(rec, DECK7);
  ok(dk.length === 1 && !dk[0].s.includes('…'), '牌組名應完整（比保底 300 窄，名字只讓出實寬）');
});

// ── 收尾 ───────────────────────────────────────────────────────────────────
const runAsync = async () => {
  for (const [name, fn] of asyncChecks) {
    try { await fn(); console.log('  ✓ ' + name); pass++; }
    catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
  }
  console.log('\n' + (fail === 0 ? '✅' : '❌') + ' v6226 report-text-fit: ' + pass + ' pass / ' + fail + ' fail');
  if (fail > 0) process.exit(1);
};
runAsync();
