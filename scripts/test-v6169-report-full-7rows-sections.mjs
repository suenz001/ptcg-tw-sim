// v6.169 / admin v1.72 守衛：報告圖完整版的三項站長裁定。
//
//   ① 環境報告（與奪冠的名次類）每頁 8 → **7 筆**，字級等比放大。
//      失敗模式：改了 PER 卻沒改列高 ⇒ 底部空一大塊（字沒變大、只是頁數變多）；
//      或改了列高沒改 PER ⇒ 列區壓到註腳／頁腳上面（產得出來，字疊在一起）。
//   ② 「N 位」→ 語意正確的量詞。**逐處判斷**：指人留「位」、指次數改「次」。
//      失敗模式：整檔取代 ⇒ 註腳「準決賽的 4 位選手」被改成「4 次選手」。
//   ③ 奪冠完整版的分段改成站長可勾選＋排序（localStorage 記憶）。
//      失敗模式：勾了卻沒出、沒勾卻出了、頁碼分母 N 沒跟著重算、
//      Safari 無痕 setItem throw ⇒ 整顆按鈕死掉。
//
// ⚠ 本檔沿用 v6168 的做法：分頁純函式**直接跑**、繪圖層餵記錄型假 ctx **真的畫一遍**，
//   再回頭數畫出來的東西。「有呼叫某函式」≠「那件事發生了」。
// ⚠ 版面檢查不只看常數：假 ctx 的 measureText 用「全形 1.0em／半形 0.55em」近似量寬，
//   把每一列真的排一遍，斷言沒有任何一段文字越界或跟隔壁欄疊到。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADM = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

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

// ⭐v6.244：報告圖的日期改吃 admin.html 的中央日期 helper（賽事日期＝開賽時間、固定 UTC+8）。
//   ⚠ 抽**真的那一份**而不是 stub —— stub 會讓「日期基準被改錯」在這支守衛裡完全看不出來。
const DATE_HELPERS = slice(ADM, 'function twOffsetMs()', 'function _tsFmtDate(ms) {');

// ── 把「報告圖」整段（常數＋純函式＋繪圖＋勾選 UI）抽成一個可重複實例化的工廠 ──
// ⚠ 每呼叫一次就是一份全新的模組作用域（_crFullSel 也是新的）⇒ 各條測試互不汙染。
// ⚠ localStorage 用參數餵進去：在瀏覽器裡這個識別字解析到全域，在這裡解析到我們的 stub，
//   於是「Safari 無痕會 throw」可以真的模擬出來，而不是只讀原始碼找 try 字樣。
let FACTORY = null;
try {
  const src = slice(ADM, "const MI_URL = 'www.ptcg-tw-sim.com';", 'window.loadArchetypeStats = async function');
  if (src.length > 5000 && src.includes('mpDrawChampion')) {
    // ⚠ v1.72 才有的東西一律用 `typeof X !== 'undefined'` 取 —— 這樣對 BASE 跑時
    //   抽取本身仍會成功，①（7 筆／字級／版面）那幾條才會真的量一遍再 FAIL 在數字上，
    //   而不是全部退化成一句「抽不到區段」。
    const opt = (n2) => "(typeof " + n2 + " !== 'undefined' ? " + n2 + " : null)";
    const NEW = ['CR_SECTIONS', 'CR_FULL_LSKEY', 'crSectionRows', 'crSkipReason', 'champFullBusy', 'mpNormalizeSel',
                 'mpLsGet', 'mpLsSet', 'mpParseJson', 'crFullSel', 'crFullKeys',
                 'renderChampFullPicker', 'champFullToggle', 'champFullMove',
                 'runChampionReportFullExport'];
    FACTORY = new Function('window', 'document', 'alert', 'detectMainPokemon', 'localStorage',
      DATE_HELPERS + '\n' + src
      + '\nmiLogo = async function () { return null; };'
      + '\nreturn { MI, MP, mpPaginate, mpPlanMeta, mpPlanChampion, miComputeRows,'
      + ' mpDrawMeta, mpDrawChampion, mpMetaNotes, crNotes, crDraw,'
      + NEW.map((k) => ' ' + k + ': ' + opt(k) + ',').join('')
      + ' setCrLoadData: function (f) { crLoadData = f; } };');
  }
} catch (e) { FACTORY = null; }

function mkDoc() {
  const els = {};
  return {
    _els: els,
    createElement() { throw new Error('不該建立 DOM'); },
    getElementById(id) { return (els[id] = els[id] || { id, innerHTML: '', textContent: '', disabled: false }); },
  };
}
function mk(ls) {
  ok(FACTORY, '抽不到報告圖區段（admin.html 的 MI_URL … loadArchetypeStats 那一段）');
  const doc = mkDoc();
  const win = {};
  const alerts = [];
  const api = FACTORY(win, doc, (m) => alerts.push(String(m)), () => null, ls);
  api._doc = doc; api._win = win; api._alerts = alerts;
  return api;
}
/** 讓整條匯出流程（產圖 → PNG → ZIP → 下載）真的跑得完的環境。 */
function mkExportEnv(A, ctx) {
  const doc = A._doc;
  doc.createElement = (tag) => (tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => ctx,
        toBlob(cb) { cb(new Blob([new Uint8Array([137, 80, 78, 71])])); } }
    : { href: '', download: '', click() {}, remove() {} });
  doc.body = { appendChild() {}, removeChild() {} };
  globalThis.closeModal = () => { doc.getElementById('modal-container').innerHTML = ''; };
}
const need = () => mk(mkLs());
/** 需要 v1.72 才有的符號時，先明確報「這個東西還不存在」而不是一句抽不到。 */
function needNew(A, ...names) {
  for (const k of names) ok(A[k], 'admin.html 還沒有 ' + k + '（v1.72 的可選分段／量詞尚未實作）');
  return A;
}
/** 可用的 localStorage stub。 */
function mkLs() {
  const bag = {};
  return { bag, getItem: (k) => (k in bag ? bag[k] : null), setItem: (k, v) => { bag[k] = String(v); } };
}
/** Safari 無痕：setItem 一定 throw；這裡連 getItem 也 throw，是更嚴格的下界。 */
function mkLsThrow() {
  return {
    getItem() { throw new Error('SecurityError'); },
    setItem() { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; },
  };
}

// ── 記錄型假 ctx：真的畫一遍，並用近似字寬量測 ────────────────────────────
const WIDE = (cp) => cp >= 0x1100;      // CJK／全形標點／▲▼／emoji 一律當 1.0em（保守）
function mkCtx() {
  const rec = { texts: [], rects: [], images: 0, fonts: [] };
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
    set font(v) { _font = v; rec.fonts.push(v); },
    get textAlign() { return _align; },
    set textAlign(v) { _align = v; },
    fillText(s, x, y) {
      const w = measure(s);
      const left = _align === 'right' ? x - w : (_align === 'center' ? x - w / 2 : x);
      rec.texts.push({ s: String(s), x, y, w, left, right: left + w, font: _font, px: px(), align: _align });
    },
    measureText(s) { return { width: measure(s) }; },
    fillRect(x, y, w, h) { rec.rects.push([x, y, w, h]); },
    strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    arc: noop, arcTo: noop, rect: noop,
    fill: noop, stroke: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setLineDash: noop, clip: noop,
    drawImage() { rec.images++; },
    createLinearGradient() { return { addColorStop: noop }; },
  };
  return { rec, ctx };
}
const texts = (rec) => rec.texts.map((t) => t.s);

// ── 假資料 ────────────────────────────────────────────────────────────────
const N_CASUAL = 37, N_TOURN = 23;
function mkStats() {
  const rows = (n, tag) => Array.from({ length: n }, (_, i) => ({
    ruleId: tag + i, name: tag + String(i + 1).padStart(2, '0') + '超級長的原型名稱測試用',
    usage: (n - i) * 3, winRate: i % 3 === 0 ? null : 0.4 + (i % 20) / 100,
    sampleOk: i % 3 !== 0,
  }));
  return {
    scanned: { casualDecks: 900, casualMatches: 1800, tournDecks: 400, tournEvents: 40 },
    casual: { rows: rows(N_CASUAL, 'C'), unclassified: { usage: 120, winRate: 0.5 } },
    tourn: { rows: rows(N_TOURN, 'T'), unclassified: { usage: 40, winRate: 0.48 } },
  };
}
function mkChampData() {
  const mkr = (n, k) => Array.from({ length: n }, (_, i) => ({ name: k + String(i).padStart(2, '0'), n: n - i }));
  return {
    champRank: mkr(9, 'CR'), t4Rows: mkr(19, 'T4'), commRank: mkr(11, 'CM'),
    siteChamps: Array.from({ length: 12 }, (_, i) => ({
      name: 'P' + String(i).padStart(2, '0'), deck: 'DK' + String(i).padStart(2, '0'),
      eventName: 'EV' + i, finishedAt: Date.now(), players: 16, w: 4, l: 1,
    })),
    nSite: 12, nComm: 11, entries: 200, from: Date.now() - 8.64e7, to: Date.now(),
    t4Total: 48, t4Skipped: 1, noCut: 0, noChamp: 0, capped: false,
  };
}

console.log('① 每頁 7 筆：一筆都沒少，而且真的排得下');

T('⭐⭐⭐MP.PER 是 7、列高與可用空間對得上（改了 PER 沒改列高＝字沒變大，只是頁數多）', () => {
  const A = need();
  ok(A.MP.PER === 7, '每頁筆數應為 7，實得 ' + A.MP.PER);
  const band = (A.MP.NOTE_Y - 22) - A.MP.TOP;                 // 296 → 936
  const used = A.MP.PER * A.MP.ROW + (A.MP.PER - 1) * A.MP.GAP;
  ok(used <= band, '7 列共 ' + used + 'px，超出可用列區 ' + band + 'px（會壓到註腳）');
  ok(band - used <= 40, '7 列只用了 ' + used + ' / ' + band + 'px，剩 ' + (band - used)
    + 'px 沒用到 —— 列高應該再放大（改 PER 卻忘了改 ROW 的典型症狀）');
  // 冠軍逐場維持 5 筆：再多一列就放不下
  ok(A.MP.PER_CHAMP === 5, '冠軍逐場應維持每頁 5 筆，實得 ' + A.MP.PER_CHAMP);
  const usedC = A.MP.PER_CHAMP * A.MP.ROW_CHAMP + (A.MP.PER_CHAMP - 1) * A.MP.GAP_CHAMP;
  ok(usedC <= band, '冠軍逐場 5 列共 ' + usedC + 'px 已超出 ' + band + 'px');
  ok((A.MP.PER_CHAMP + 1) * A.MP.ROW_CHAMP + A.MP.PER_CHAMP * A.MP.GAP_CHAMP > band,
    '冠軍逐場其實放得下 6 列 —— 維持 5 的理由不成立，要重新裁定');
});

T('⭐⭐⭐餵 37+23 筆：每頁至多 7 筆、加總一筆不少、名次 1..N 連號', () => {
  const A = need();
  const pages = A.mpPlanMeta(mkStats(), A.MP.PER);
  ok(pages.every((p) => p.rows.length <= 7), '有頁面超過 7 筆：' + pages.map((p) => p.rows.length).join(','));
  const sum = pages.reduce((s, p) => s + p.rows.length, 0);
  ok(sum === N_CASUAL + N_TOURN, '總筆數應為 60，實得 ' + sum);
  for (const src of ['casual', 'tourn']) {
    const seq = [];
    for (const p of pages.filter((x) => x.srcKey === src)) p.rows.forEach((r, i) => seq.push(p.startRank + i));
    ok(JSON.stringify(seq) === JSON.stringify(seq.map((_, i) => i + 1)), src + ' 名次不連續：' + seq.join(','));
  }
  const c = pages.filter((p) => p.srcKey === 'casual');
  ok(c.length === Math.ceil(N_CASUAL / 7), '37 筆 / 每頁 7 應為 ' + Math.ceil(N_CASUAL / 7) + ' 頁，實得 ' + c.length);
  ok(c[c.length - 1].rows.length === N_CASUAL % 7, '最後一頁應剩 ' + (N_CASUAL % 7) + ' 筆');
  pages.forEach((p, i) => ok(p.page === i + 1 && p.pageTotal === pages.length, '頁碼錯：' + p.page));
});

TA('⭐⭐⭐真的畫一遍：每頁 7 列、列底不撞註腳分隔線、尺寸都是 1920×1080', async () => {
  const A = need();
  const cur = mkStats();
  const pages = A.mpPlanMeta(cur, A.MP.PER);
  const sizes = new Set();
  for (const p of pages) {
    p.days = 0; p.trend = null; p.notes = A.mpMetaNotes(p, null);
    const { ctx, rec } = mkCtx();
    await A.mpDrawMeta(ctx, p);
    const bg = rec.rects.find((r) => r[0] === 0 && r[1] === 0);
    ok(bg, '沒有畫滿版底色');
    sizes.add(bg[2] + 'x' + bg[3]);
    // 列底＝最後一列的 y + ROW
    const lastY = A.MP.TOP + (p.rows.length - 1) * (A.MP.ROW + A.MP.GAP) + A.MP.ROW;
    ok(lastY <= A.MP.NOTE_Y - 22, '第 ' + p.page + ' 頁的列底 ' + lastY + ' 撞到註腳分隔線 ' + (A.MP.NOTE_Y - 22));
  }
  ok(sizes.size === 1 && [...sizes][0] === '1920x1080', '頁面尺寸不一致或不是 1920×1080：' + [...sizes].join('/'));
});

TA('⭐⭐⭐字級真的放大了：原型名 >= 42px、勝率 >= 50px（不是只改了常數）', async () => {
  const A = need();
  const cur = mkStats();
  const p = A.mpPlanMeta(cur, A.MP.PER)[0];
  p.days = 0; p.trend = null; p.notes = A.mpMetaNotes(p, null);
  const { ctx, rec } = mkCtx();
  await A.mpDrawMeta(ctx, p);
  const nameT = rec.texts.filter((t) => /^C\d\d/.test(t.s) && t.x === 168);
  ok(nameT.length === p.rows.length, '原型名應畫 ' + p.rows.length + ' 次，實得 ' + nameT.length);
  ok(nameT.every((t) => t.px >= 42), '原型名字級應 >= 42px，實得 ' + [...new Set(nameT.map((t) => t.px))].join('/'));
  const winT = rec.texts.filter((t) => /^\d+\.\d%$/.test(t.s) && t.align === 'right');
  ok(winT.length >= 1, '沒有畫出勝率大數字');
  ok(winT.every((t) => t.px >= 50), '勝率字級應 >= 50px，實得 ' + [...new Set(winT.map((t) => t.px))].join('/'));
  const head = rec.texts.filter((t) => t.s === '牌組' || t.s === '使用次數');
  ok(head.length === 2 && head.every((t) => t.px >= 26), '欄位表頭應 >= 26px');
});

TA('⭐⭐排一遍版：沒有任何一列的文字越界或跟隔壁欄疊到（環境報告＋奪冠名次頁）', async () => {
  const A = need();
  const PAD = A.MP.PAD, W = A.MP.W;
  const bandTop = A.MP.TOP - 40, bandBot = A.MP.NOTE_Y - 22;
  const checkRec = (rec, tag) => {
    const rows = new Map();
    for (const t of rec.texts) {
      if (!(t.y >= bandTop && t.y <= bandBot)) continue;
      if (!t.s) continue;
      const arr = rows.get(t.y) || []; arr.push(t); rows.set(t.y, arr);
    }
    ok(rows.size > 0, tag + '：列區一個字都沒畫到？');
    for (const [y, arr] of rows) {
      arr.sort((a, b) => a.left - b.left);
      for (const t of arr) {
        ok(t.left >= PAD - 8, tag + ' y=' + y + '「' + t.s + '」左緣 ' + t.left.toFixed(0) + ' 超出左邊界 ' + PAD);
        ok(t.right <= W - PAD + 8, tag + ' y=' + y + '「' + t.s + '」右緣 ' + t.right.toFixed(0) + ' 超出右邊界 ' + (W - PAD));
      }
      for (let i = 1; i < arr.length; i++) {
        ok(arr[i].left >= arr[i - 1].right - 1,
          tag + ' y=' + y + '「' + arr[i - 1].s + '」(止 ' + arr[i - 1].right.toFixed(0) + ') 與「'
          + arr[i].s + '」(起 ' + arr[i].left.toFixed(0) + ') 疊在一起');
      }
    }
  };
  /**
   * ⭐ 垂直方向：**整頁**任兩段水平有重疊的文字，上下必須至少留 2px。
   * （字級一放大就會往上下長；「段落標 34→38px」剛好會頂到上面的副標，
   *   只看水平是永遠抓不到的。textBaseline 全圖統一 middle ⇒ 帶寬 = y ± 字級/2。）
   */
  const checkVertical = (rec, tag) => {
    const ts = rec.texts.filter((t) => t.s && t.w > 0);
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i], b = ts[j];
        if (a.right <= b.left + 1 || b.right <= a.left + 1) continue;    // 水平不重疊
        const at = a.y - a.px / 2, ab = a.y + a.px / 2;
        const bt = b.y - b.px / 2, bb = b.y + b.px / 2;
        const gap = at >= bb ? at - bb : (bt >= ab ? bt - ab : -1);
        ok(gap >= 2, tag + '：「' + a.s.slice(0, 20) + '」(y=' + a.y + ' ' + a.px + 'px) 與「'
          + b.s.slice(0, 20) + '」(y=' + b.y + ' ' + b.px + 'px) 垂直間隙只有 '
          + gap.toFixed(1) + 'px（<2px 就會相碰，emoji 字形更會超出 em box）');
      }
    }
  };
  const cur = mkStats();
  for (const p of A.mpPlanMeta(cur, A.MP.PER)) {
    p.days = 30;
    p.trend = { ok: true, by: new Map(cur.casual.rows.concat(cur.tourn.rows).map((r, i) => [String(r.ruleId), i % 4 === 0 ? { isNew: true } : { isNew: false, dPP: i % 2 ? 12.345 : -12.345 }])), prevFrom: Date.now(), prevTo: Date.now() };
    p.notes = A.mpMetaNotes(p, p.trend);
    const { ctx, rec } = mkCtx();
    await A.mpDrawMeta(ctx, p);
    checkRec(rec, '環境報告第 ' + p.page + ' 頁');
    checkVertical(rec, '環境報告第 ' + p.page + ' 頁');
  }
  const d = mkChampData();
  const notes = A.crNotes(d);
  for (const p of A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER)) {
    p.d = d; p.notes = notes;
    const { ctx, rec } = mkCtx();
    await A.mpDrawChampion(ctx, p);
    checkRec(rec, '奪冠報告第 ' + p.page + ' 頁（' + p.title + '）');
    checkVertical(rec, '奪冠報告第 ' + p.page + ' 頁（' + p.title + '）');
  }
});

console.log('② 量詞：逐處判斷，不是一律取代');

T('⭐⭐⭐三個牌組榜的單位是「次」（它們數的是「發生了幾次」不是「幾個人」）', () => {
  const A = needNew(need(), 'CR_SECTIONS');
  const byKey = {};
  for (const s of A.CR_SECTIONS) byKey[s.k] = s;
  for (const k of ['champRank', 't4Rows', 'commRank']) {
    ok(byKey[k], '少了區段 ' + k);
    ok(byKey[k].unit === '次', k + ' 的單位是「' + byKey[k].unit + '」，應為「次」');
  }
  ok(byKey.siteChamps && byKey.siteChamps.unit === '', '逐場列不該有單位詞');
  const d = mkChampData();
  for (const p of A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER)) {
    if (p.kind === 'rank') ok(p.unit === '次', p.title + ' 的頁面單位是「' + p.unit + '」');
  }
});

TA('⭐⭐⭐完整版真的畫出「N 次」、全圖不再出現「N 位」', async () => {
  const A = need();
  const d = mkChampData();
  const notes = A.crNotes(d);
  let hitCi = 0;
  for (const p of A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER)) {
    p.d = d; p.notes = notes;
    const { ctx, rec } = mkCtx();
    await A.mpDrawChampion(ctx, p);
    for (const t of texts(rec)) {
      ok(!/^\d+ 位$/.test(t), p.title + ' 畫出了「' + t + '」（數的是次數，不是人數）');
      if (/^\d+ 次$/.test(t)) hitCi++;
    }
  }
  ok(hitCi >= 30, '「N 次」只畫出 ' + hitCi + ' 次，應該每一列都有（9+19+11=39 列）');
});

TA('⭐⭐單頁版跟著改對：牌組榜是「次」、四強抬頭是「人次」、註腳的「4 位選手」維持「位」', async () => {
  const A = need();
  const d = mkChampData();
  const { ctx, rec } = mkCtx();
  // crDraw 內部會 document.createElement('canvas') → 換成回我們的假 ctx
  const doc = A._doc;
  doc.createElement = () => ({ width: 0, height: 0, getContext: () => ctx });
  const cv = await A.crDraw(d);
  ok(cv, 'crDraw 不該回 null');
  const all = texts(rec);
  ok(all.some((t) => /^\d+ 次$/.test(t)), '單頁版牌組榜沒有畫出「N 次」：' + all.filter((t) => /^\d+ [位次]$/.test(t)).join('|'));
  ok(!all.some((t) => /^\d+ 位$/.test(t)), '單頁版還在畫「N 位」：' + all.filter((t) => /^\d+ 位$/.test(t)).join('|'));
  ok(all.some((t) => t === '共 ' + d.t4Total + ' 人次'),
    '四強抬頭應是「共 N 人次」（t4Total 是 top4 逐筆累加＝人次，不是幾個人），實得：'
    + all.filter((t) => /^共 /.test(t)).join('|'));
  ok(A.crNotes(d).some((t) => t.includes('4 位選手')), '註腳「準決賽的 4 位選手」指的是人，必須維持「位」');
});

T('⭐⭐原始碼裡不再有硬寫的「N 位」單位，且三個呼叫端各自宣告「次」', () => {
  ok(!/r\.n \+ ' 位'/.test(ADM), '單頁版 rankRows 還硬寫著「位」');
  ok(/r\.n \+ ' ' \+ unit/.test(ADM), '單頁版 rankRows 沒有改成由呼叫端宣告單位');
  const draw = slice(ADM, 'async function crDraw(', 'async function crLoadData(');
  const callLines = draw.split('\n').filter((l) => /\brankRows\(/.test(l));
  ok(callLines.length === 3, '單頁版應有 3 處 rankRows 呼叫，實得 ' + callLines.length
    + '：\n  ' + callLines.map((l) => l.trim()).join('\n  '));
  for (const l of callLines) ok(/, '次'\);/.test(l), '這處 rankRows 沒有傳單位「次」：' + l.trim());
});

T('⭐⭐剩下的「位」全都真的在數人（白名單逐處判定，防止未來被整檔取代）', () => {
  const seg = slice(ADM, "const MI_URL = 'www.ptcg-tw-sim.com';", 'window.loadArchetypeStats = async function');
  const lines = seg.split('\n');
  const OKWORD = /欄位|定位|單位|位置|個位數|位移|3 位|位元|各位/;
  const WHITELIST = [
    '4 位選手',              // crNotes：準決賽的 4 個人 → 真的是人
  ];
  const bad = [];
  lines.forEach((l, i) => {
    if (!l.includes('位')) return;
    if (OKWORD.test(l)) return;
    if (WHITELIST.some((w) => l.includes(w))) return;
    if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;   // 說明文字另計
    bad.push('第 ' + (i + 1) + ' 行：' + l.trim().slice(0, 100));
  });
  ok(bad.length === 0, '報告圖區段還有未經判定的「位」：\n  ' + bad.join('\n  '));
});

console.log('③ 可勾選、可排序的分段');

T('⭐⭐⭐任意子集×任意順序：只出勾到的段、順序照設定、頁碼 N 跟著重算', () => {
  const A = needNew(need(), 'CR_SECTIONS', 'crSectionRows');
  const d = mkChampData();
  const keys = A.CR_SECTIONS.map((s) => s.k);
  const titleOf = {};
  for (const s of A.CR_SECTIONS) titleOf[s.k] = s.title;
  let cases = 0;
  for (let m = 1; m < 16; m++) {
    const subset = keys.filter((_, i) => m & (1 << i));
    // 兩種順序：原序與反序 —— 反序才驗得出「有沒有偷偷照 CR_SECTIONS 排」
    for (const order of [subset, subset.slice().reverse()]) {
      cases++;
      const pages = A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER, order);
      // ⭐ 只出勾到的段
      const got = [...new Set(pages.map((p) => p.secKey))];
      ok(got.every((k) => order.indexOf(k) >= 0),
        '出現了沒勾的段：' + got.filter((k) => order.indexOf(k) < 0).join(','));
      ok(order.every((k) => got.indexOf(k) >= 0),
        '勾了卻沒出：' + order.filter((k) => got.indexOf(k) < 0).join(',') + '（order=' + order.join('>') + '）');
      // ⭐ 順序照設定（頁面依序出現的 secKey 去重後應等於 order）
      ok(JSON.stringify(got) === JSON.stringify(order),
        '出頁順序 ' + got.join('>') + ' 與設定 ' + order.join('>') + ' 不符');
      // ⭐ 頁碼 N 重算 + 連號
      pages.forEach((p, i) => {
        ok(p.page === i + 1, '第 ' + (i + 1) + ' 頁的頁碼是 ' + p.page);
        ok(p.pageTotal === pages.length, '頁碼分母應為 ' + pages.length + '，實得 ' + p.pageTotal);
      });
      // ⭐ 段內一筆都沒少
      for (const k of order) {
        const want = A.crSectionRows(d, k).length;
        const gotN = pages.filter((p) => p.secKey === k).reduce((s, p) => s + p.rows.length, 0);
        ok(gotN === want, k + ' 應出 ' + want + ' 筆，實得 ' + gotN);
        const seq = [];
        for (const p of pages.filter((x) => x.secKey === k)) p.rows.forEach((r, i2) => seq.push(p.startRank + i2));
        ok(JSON.stringify(seq) === JSON.stringify(seq.map((_, i2) => i2 + 1)), k + ' 段內名次不連續');
      }
    }
  }
  ok(cases === 30, '應跑 30 組（15 個非空子集 × 2 種順序），實得 ' + cases);
});

T('⭐⭐只勾兩段時頁碼分母真的變小（不是沿用四段的總頁數）', () => {
  const A = needNew(need(), 'CR_SECTIONS');
  const d = mkChampData();
  const all = A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER);
  const two = A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER, ['t4Rows', 'champRank']);
  ok(two.length < all.length, '只勾兩段的頁數 ' + two.length + ' 應少於四段的 ' + all.length);
  ok(two.every((p) => p.pageTotal === two.length), '頁碼分母沒有重算');
  ok(two[0].secKey === 't4Rows', '第一段應是使用者排在前面的 t4Rows，實得 ' + two[0].secKey);
});

T('⭐⭐⭐全不選 = 0 頁（絕不可以退回「四段全出」）；未指定才是四段全出', () => {
  const A = need();
  ok(A.mpPlanChampion.length >= 4, 'mpPlanChampion 沒有第 4 個參數 sel（可選分段尚未實作）');
  const d = mkChampData();
  ok(A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER, []).length === 0,
    '空陣列應回 0 頁 —— 回四段就是「一段都沒勾卻產出四段」');
  ok(A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER).length > 0, '未指定時應四段全出（既有呼叫端的預設）');
  ok(A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER, null).length > 0, 'null 也視為未指定');
  ok(A.mpPlanChampion(d, A.MP.PER_CHAMP, A.MP.PER, ['不存在的段']).length === 0, '未知 key 應被忽略且不炸掉');
});

T('⭐⭐全不選時「產生 ZIP」鈕 disabled 並顯示提示；有勾就解開', () => {
  const A = needNew(need(), 'CR_SECTIONS', 'crFullSel', 'crFullKeys', 'renderChampFullPicker', 'champFullToggle');
  A.crFullSel().forEach((s) => { s.on = false; });
  A._doc.getElementById('modal-container').innerHTML = '';
  A._win.renderChampFullPicker();
  let html = A._doc.getElementById('modal-container').innerHTML;
  ok(/id="champ-full-run-btn"[^>]*\sdisabled/.test(html), '全不選時產圖鈕沒有 disabled：'
    + (html.match(/<button id="champ-full-run-btn"[^>]*>/) || [''])[0]);
  ok(/至少要勾選/.test(html), '全不選時沒有任何提示，站長只會看到一顆按不下去的按鈕');
  A._win.champFullToggle(2);
  html = A._doc.getElementById('modal-container').innerHTML;
  ok(!/id="champ-full-run-btn"[^>]*\sdisabled/.test(html), '勾了一段之後產圖鈕仍 disabled');
  ok(A.crFullKeys().length === 1 && A.crFullKeys()[0] === A.CR_SECTIONS[2].k, '勾到的段不對');
});

TA('⭐⭐一段都沒勾時按下去不會產出壞檔（連 crLoadData 都不該打）', async () => {
  const A = needNew(need(), 'crFullSel', 'runChampionReportFullExport');
  let called = 0;
  A.setCrLoadData(async () => { called++; return mkChampData(); });
  A.crFullSel().forEach((s) => { s.on = false; });
  await A._win.runChampionReportFullExport();
  ok(called === 0, '一段都沒勾卻仍去載資料／產圖（called=' + called + '）');
});

T('⭐勾選 UI 的每一段都掛得到 window（admin 是 module script，inline handler 在全域找函式）', () => {
  for (const fn of ['openChampionReportFullExport', 'renderChampFullPicker', 'champFullToggle',
                    'champFullMove', 'runChampionReportFullExport']) {
    ok(ADM.includes('window.' + fn + ' ='), fn + ' 沒掛 window ⇒ inline onclick 會 ReferenceError');
  }
  ok(/onclick="openChampionReportFullExport\(\)"/.test(ADM), '按鈕的 inline 呼叫點不見了');
  ok(/onclick="runChampionReportFullExport\(\)"/.test(ADM), '產圖鈕沒有接上 runChampionReportFullExport');
  ok(/onchange="champFullToggle\(/.test(ADM) && /onclick="champFullMove\(/.test(ADM), '勾選／排序沒有接線');
});

T('⭐▲▼ 真的換位置，且頭尾的按鈕 disabled（不會把第一段再往上移）', () => {
  const A = needNew(need(), 'crFullSel', 'champFullMove');
  const before = A.crFullSel().map((s) => s.k);
  A._win.champFullMove(0, 1);
  const after = A.crFullSel().map((s) => s.k);
  ok(after[0] === before[1] && after[1] === before[0], '往下移沒有生效：' + before.join('>') + ' → ' + after.join('>'));
  ok(after.length === before.length && new Set(after).size === after.length, '搬移時弄丟或複製了段落');
  A._win.champFullMove(0, -1);
  ok(JSON.stringify(A.crFullSel().map((s) => s.k)) === JSON.stringify(after), '第一段往上移不該有任何變化');
  const html = A._doc.getElementById('modal-container').innerHTML;
  const ups = html.match(/champFullMove\(\d+,-1\)"[^>]*>/g) || [];
  ok(ups.length === 4 && / disabled>/.test(ups[0]), '第一段的 ▲ 沒有 disabled');
  const downs = html.match(/champFullMove\(\d+,1\)"[^>]*>/g) || [];
  ok(downs.length === 4 && / disabled>/.test(downs[3]), '最後一段的 ▼ 沒有 disabled');
});

console.log('④ localStorage：Safari 無痕會 throw');

T('⭐⭐⭐setItem／getItem throw 時整個功能照常運作（只是不記設定）', () => {
  const A = needNew(mk(mkLsThrow()), 'CR_SECTIONS', 'mpLsGet', 'mpLsSet', 'crFullKeys', 'champFullToggle', 'champFullMove');
  ok(A.mpLsGet('x') === null, 'getItem throw 時 mpLsGet 應回 null 而不是往外拋');
  ok(A.mpLsSet('x', '1') === false, 'setItem throw 時 mpLsSet 應回 false 而不是往外拋');
  // 讀不到設定 → 四段全勾、預設順序
  ok(A.crFullKeys().length === 4, '讀不到設定時應四段全勾，實得 ' + A.crFullKeys().length);
  A._win.champFullToggle(0);           // 這一步內部會呼叫 crFullSave → mpLsSet → throw
  ok(A.crFullKeys().length === 3, '在會 throw 的環境下勾選沒有生效（狀態應留在記憶體）');
  A._win.champFullMove(0, 1);
  ok(A.crFullSel().map((s) => s.k).join('>') !== A.CR_SECTIONS.map((s) => s.k).join('>'),
    '在會 throw 的環境下排序沒有生效');
  const html = A._doc.getElementById('modal-container').innerHTML;
  ok(html.includes('champ-full-run-btn'), '在會 throw 的環境下視窗畫不出來');
});

T('⭐完全沒有 localStorage 這個東西（極端內嵌情境）也不會 throw', () => {
  const A = needNew(mk(undefined), 'mpLsGet', 'mpLsSet', 'crFullKeys');
  ok(A.mpLsGet('x') === null && A.mpLsSet('x', '1') === false, '沒有 localStorage 時應安靜降級');
  ok(A.crFullKeys().length === 4, '應退回預設四段全勾');
});

T('⭐⭐設定真的存得進去、下次打開沿用（勾選＋順序都要）', () => {
  const ls = mkLs();
  const A = needNew(mk(ls), 'CR_FULL_LSKEY', 'crFullSel', 'champFullToggle', 'champFullMove');
  A._win.champFullToggle(1);            // 關掉第 2 段
  A._win.champFullMove(3, -1);          // 把第 4 段往上搬
  const want = A.crFullSel().map((s) => s.k + ':' + (s.on ? 1 : 0)).join(',');
  ok(ls.bag[A.CR_FULL_LSKEY], '設定沒有寫進 localStorage（key=' + A.CR_FULL_LSKEY + '）');
  const B = mk(ls);                       // 模擬「下次打開」
  ok(B.crFullSel().map((s) => s.k + ':' + (s.on ? 1 : 0)).join(',') === want,
    '下次打開沒有沿用：' + B.crFullSel().map((s) => s.k + ':' + (s.on ? 1 : 0)).join(',') + ' ≠ ' + want);
});

T('⭐存壞的設定不會讓功能死掉（壞 JSON／未知段／缺段／重複段）', () => {
  const A = needNew(need(), 'CR_SECTIONS', 'mpNormalizeSel', 'mpParseJson');
  const all = A.CR_SECTIONS.map((s) => s.k);
  ok(A.mpNormalizeSel(A.mpParseJson('{壞掉的 json')).map((s) => s.k).join(',') === all.join(','),
    '壞 JSON 應退回預設四段');
  ok(A.mpNormalizeSel(null).length === 4 && A.mpNormalizeSel('x').length === 4, '非陣列應退回預設四段');
  const got = A.mpNormalizeSel([{ k: 'commRank', on: false }, { k: '不存在' }, { k: 'commRank' }]);
  ok(got.length === 4, '正規化後應剛好四段，實得 ' + got.length);
  ok(got[0].k === 'commRank' && got[0].on === false, '舊設定的順序與勾選狀態沒有保留');
  ok(new Set(got.map((s) => s.k)).size === 4, '有重複段');
  ok(got.slice(1).every((s) => s.on === true), '這一版新補進來的段預設應為勾選（升級不該靜默少一段）');
});


console.log('⑤ 勾了卻不出頁：一定要講原因（v1.72 的契約是「勾什麼出什麼」）');

T('⭐⭐⭐crSkipReason 逐段給得出原因（只有 1 場網站賽 vs 這段真的沒資料）', () => {
  const A = needNew(need(), 'crSkipReason', 'crSectionRows');
  const full = mkChampData();
  ok(A.crSkipReason(full, 'champRank') === null, '有 12 場網站賽時次數榜應該會出');
  ok(A.crSkipReason(full, 't4Rows') === null, '四強有資料時不該被跳過');
  const one = { champRank: [{ name: 'A', n: 1 }], siteChamps: [{ name: 'p', deck: 'A' }], t4Rows: [], commRank: [] };
  const why = A.crSkipReason(one, 'champRank');
  ok(why && /只有 1 場網站賽/.test(why),
    '只有 1 場網站賽時次數榜被跳過，原因訊息應說清楚，實得：' + why);
  ok(!/沒有資料/.test(why), '這一段其實**有**資料（1 位冠軍），不可以說成「沒有資料」——站長會以為統計壞了');
  ok(/沒有資料/.test(A.crSkipReason(one, 't4Rows') || ''), '真的沒資料的段落要說沒有資料');
});

TA('⭐⭐⭐勾了 champRank 但只有 1 場網站賽：ZIP 照產，但完成訊息要指名哪一段沒出', async () => {
  const A = needNew(need(), 'crSkipReason', 'crFullSel', 'runChampionReportFullExport');
  const one = {
    champRank: [{ name: 'A', n: 1 }],
    siteChamps: [{ name: 'p', deck: 'A', eventName: 'E', finishedAt: Date.now(), players: 8, w: 3, l: 0 }],
    t4Rows: [], commRank: [], nSite: 1, nComm: 0, entries: 8, from: Date.now(), to: Date.now(),
    t4Skipped: 0, noCut: 0, noChamp: 0, capped: false,
  };
  A.setCrLoadData(async () => one);
  const { ctx } = mkCtx();
  mkExportEnv(A, ctx);
  A.crFullSel().forEach((x) => { x.on = x.k === 'champRank' || x.k === 'siteChamps'; });
  await A.runChampionReportFullExport();
  const msg = A._alerts.join('\n');
  ok(/已產生 1 頁/.test(msg), '逐場那一段有資料，ZIP 應該照產：' + msg);
  ok(/沒有輸出/.test(msg) && /冠軍牌組次數榜/.test(msg) && /只有 1 場網站賽/.test(msg),
    '勾了卻沒出的段落必須指名並說原因（否則站長剪片時才發現素材缺一塊）：' + msg);
});

TA('⭐⭐勾到的段全都沒資料：不產出壞檔，而且逐段講為什麼', async () => {
  const A = needNew(need(), 'crSkipReason', 'crFullSel', 'runChampionReportFullExport');
  const empty = { champRank: [], siteChamps: [], t4Rows: [], commRank: [], nSite: 0, nComm: 0 };
  A.setCrLoadData(async () => empty);
  const { ctx } = mkCtx();
  mkExportEnv(A, ctx);
  let zipped = 0;
  A._doc.createElement = (tag) => { zipped++; return { href: '', download: '', click() {}, remove() {} }; };
  await A.runChampionReportFullExport();
  const msg = A._alerts.join('\n');
  ok(/沒有可輸出的內容/.test(msg), '應該明說沒有可輸出的內容：' + msg);
  ok((msg.match(/沒有資料/g) || []).length >= 3, '應逐段講原因，實得：' + msg);
  ok(zipped === 0, '沒有內容卻仍然建立了元素／產檔（zipped=' + zipped + '）');
});

console.log('⑥ 產圖進行中：不可以讓使用者把「產生中… 3/12」那顆按鈕換掉');

T('⭐⭐產圖中整個視窗鎖住（勾選／▲▼／取消／產生鈕全 disabled）', () => {
  const A = needNew(need(), 'champFullBusy', 'renderChampFullPicker', 'champFullToggle', 'champFullMove');
  // 直接進入「產圖中」狀態：跑 runChampionReportFullExport 但讓 crLoadData 掛在半路
  let release = null;
  A.setCrLoadData(() => new Promise((r) => { release = () => r(null); }));
  const p = A.runChampionReportFullExport();
  ok(A.champFullBusy() === true, '應已進入產圖中狀態');
  const html = A._doc.getElementById('modal-container').innerHTML;
  const boxes = html.match(/<input type="checkbox"[^>]*>/g) || [];
  ok(boxes.length === 4 && boxes.every((b) => / disabled/.test(b)), '產圖中勾選框沒有全部 disabled：' + boxes.join(''));
  ok((html.match(/champFullMove\([^)]*\)"[^>]*disabled/g) || []).length === 8, '產圖中 ▲▼ 沒有全部 disabled');
  ok(/id="champ-full-run-btn"[^>]*\sdisabled/.test(html), '產圖中產生鈕沒有 disabled');
  ok(/&&!champFullBusy\(\)/.test(html), '產圖中點視窗外圍仍會關掉視窗（進度就看不到了）');
  // 第二道保險：就算真的被點到，狀態也不能變、也不能重繪
  const before = A._doc.getElementById('modal-container').innerHTML;
  const keysBefore = A.crFullKeys().join(',');
  A.champFullToggle(0); A.champFullMove(0, 1);
  ok(A.crFullKeys().join(',') === keysBefore, '產圖中勾選／排序竟然改到了狀態');
  ok(A._doc.getElementById('modal-container').innerHTML === before,
    '產圖中重繪了視窗 ⇒ 「產生中… 3/12」那顆按鈕會被換掉、進度從此寫進空氣');
  release();
  return p.then(() => {});
});

// ── 跑 async 條目 ──────────────────────────────────────────────────────────
const run = async () => {
  for (const [name, fn] of asyncChecks) {
    try { await fn(); console.log('  ✓ ' + name); pass++; }
    catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
  }
  console.log('\n=== v6.169 完整版 7 筆／量詞／可選分段：PASS ' + pass + ' / FAIL ' + fail + ' ===');
  if (fail > 0) process.exit(1);
};
run();
