// v6.168 / admin v1.71 守衛：報告圖「完整版（多頁）」匯出。
//
// 站長每週要用這批 PNG 做宣傳影片（admin 按一下 → 拖進 Canva → 配樂 → 上 YouTube）。
// 這功能的失敗模式全都是「產得出來、看起來也對，但素材是壞的」：
//
//   ① **有原型被吃掉**。單頁版本來就是 slice(0, TOPN)；完整版只要分頁邊界算錯
//      （off-by-one、最後一頁沒補），少掉的那幾名不會有任何錯誤訊息。
//   ② **每頁尺寸不一致** ⇒ 剪成影片會一格一格跳動。
//   ③ **排名跨頁不連續**（第 2 頁又從 1 開始）⇒ 讀者以為有兩個第 1 名。
//   ④ **頁碼錯**（第 3 / 3 頁出現兩次）⇒ 站長排序時會排錯。
//   ⑤ **統計口徑分岔**：完整版自己再算一次分母／佔比 ⇒ 跟單頁版、跟後台表格三個數字。
//   ⑥ **長條每頁各自歸一化** ⇒ 第 3 頁的第 21 名畫得跟第 1 名一樣長，直接騙人。
//
// ⚠ 因此本檔**不做「有沒有呼叫某函式」的字串比對就算數**：分頁是純函式（mpPlanMeta /
//   mpPlanChampion），直接跑；畫圖層則餵一個記錄型的假 ctx **真的畫一遍**，
//   再回頭數「所有頁面上總共出現了幾個牌組名」。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADM = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function slice(src, a, b) {
  const i = src.indexOf(a); if (i < 0) return '';
  const j = b ? src.indexOf(b, i + a.length) : -1;
  return src.slice(i, j > 0 ? j : src.length);
}

// ── 抽出兩個可獨立執行的區塊 ────────────────────────────────────────────────
// ⚠ 抽不出來時不要 throw 到 top-level：那樣對 HEAD 跑會變成一行 stack trace，
//   看不出「少了哪些保護」。改成讓後續每一條各自 FAIL。
let PURE = null, ZIP = null, RENDER = null;
try {
  const src = slice(ADM, '// ══ MP-PURE-BEGIN', '// ══ MP-PURE-END');
  if (src.length > 500) {
    PURE = new Function(src + '\nreturn { miDeckKey, miComputeRows, mpPaginate, mpPlanMeta, mpPlanChampion, mpHoistCapNote };')();
  }
} catch (e) { PURE = null; }
try {
  const src = slice(ADM, '// ══ MP-ZIP-BEGIN', '// ══ MP-ZIP-END');
  if (src.length > 300) ZIP = new Function(src + '\nreturn { mpZip, mpCrc32 };')();
} catch (e) { ZIP = null; }
try {
  // 繪圖層：從 MI_URL 一路到奪冠報告結束。裡面有 window.xxx = 的賦值與 DOM 呼叫，
  // 所以把 window / document / alert / detectMainPokemon 當參數餵進去（都只在呼叫時才用到）。
  const src = slice(ADM, "const MI_URL = 'www.ptcg-tw-sim.com';", 'window.loadArchetypeStats = async function');
  if (src.length > 5000 && src.includes('mpDrawMeta')) {
    RENDER = new Function('window', 'document', 'alert', 'detectMainPokemon',
      src + '\nmiLogo = async function () { return null; };'
          + '\nreturn { MI, MP, mpDrawMeta, mpDrawChampion, mpMetaNotes, crNotes, crBuild, miDraw };')(
      {}, { createElement() { throw new Error('不該建立 DOM'); } }, () => {}, () => null);
  }
} catch (e) { RENDER = null; }

const needPure = () => { ok(PURE, '抽不到 MP-PURE 區塊（完整版多頁分頁尚未實作）'); return PURE; };
const needZip = () => { ok(ZIP, '抽不到 MP-ZIP 區塊（ZIP 打包尚未實作）'); return ZIP; };
const needRender = () => { ok(RENDER, '抽不到繪圖層（mpDrawMeta / mpDrawChampion 尚未實作）'); return RENDER; };

// ── 假資料 ─────────────────────────────────────────────────────────────────
const N_CASUAL = 37, N_TOURN = 23;
function mkStats() {
  const rows = (n, tag) => Array.from({ length: n }, (_, i) => ({
    ruleId: tag + i, name: tag + String(i + 1).padStart(2, '0'),
    usage: (n - i) * 3, winRate: i % 3 === 0 ? null : 0.4 + (i % 20) / 100,
    sampleOk: i % 3 !== 0,
  }));
  return {
    scanned: { casualDecks: 900, casualMatches: 1800, tournDecks: 400, tournEvents: 40 },
    casual: { rows: rows(N_CASUAL, 'C'), unclassified: { usage: 120, winRate: 0.5 } },
    tourn: { rows: rows(N_TOURN, 'T'), unclassified: { usage: 40, winRate: 0.48 } },
  };
}
/** 記錄型假 ctx：真的把一頁畫完，然後回頭檢查畫了什麼。 */
function mkCtx() {
  const rec = { texts: [], rects: [], images: 0 };
  const noop = () => {};
  return {
    rec,
    ctx: {
      fillStyle: '', strokeStyle: '', font: '', textAlign: 'left', textBaseline: '',
      lineWidth: 1, globalAlpha: 1,
      fillText(s) { rec.texts.push(String(s)); },
      measureText(s) { return { width: String(s).length * 14 }; },
      fillRect(x, y, w, h) { rec.rects.push([x, y, w, h]); },
      strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
      arc: noop, arcTo: noop, rect: noop, fill: noop, stroke: noop,
      save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
      setLineDash: noop, clip: noop,
      drawImage() { rec.images++; },
      createLinearGradient() { return { addColorStop: noop }; },
    },
  };
}

console.log('① 分頁純函式：一筆都不能被吃掉');

T('⭐⭐⭐所有頁的筆數加總 === 原始筆數（環境報告，一般對戰 37 + 錦標賽 23）', () => {
  const P = needPure();
  const pages = P.mpPlanMeta(mkStats(), 8);
  const sum = pages.reduce((s, p) => s + p.rows.length, 0);
  ok(sum === N_CASUAL + N_TOURN, '總筆數應為 ' + (N_CASUAL + N_TOURN) + '，實得 ' + sum);
  const c = pages.filter((p) => p.srcKey === 'casual').reduce((s, p) => s + p.rows.length, 0);
  const t = pages.filter((p) => p.srcKey === 'tourn').reduce((s, p) => s + p.rows.length, 0);
  ok(c === N_CASUAL && t === N_TOURN, '各資料源分別應為 37 / 23，實得 ' + c + ' / ' + t);
  ok(pages.length === 5 + 3, '頁數應為 5+3=8，實得 ' + pages.length);
});

T('⭐⭐⭐名次跨頁連續（第 2 頁要從第 9 名開始，不是又從 1 開始）', () => {
  const P = needPure();
  const pages = P.mpPlanMeta(mkStats(), 8);
  for (const src of ['casual', 'tourn']) {
    const seq = [];
    for (const p of pages.filter((x) => x.srcKey === src)) {
      p.rows.forEach((r, i) => seq.push(p.startRank + i));
    }
    const want = seq.map((_, i) => i + 1);
    ok(JSON.stringify(seq) === JSON.stringify(want),
      src + ' 的名次序列不連續：' + seq.slice(0, 12).join(',') + '…');
  }
  const p2 = pages.filter((x) => x.srcKey === 'casual')[1];
  ok(p2.startRank === 9, '每頁 8 筆時第 2 頁應從第 9 名開始，實得 ' + p2.startRank);
});

T('⭐⭐頁碼正確且跨區段連續（第 X / N 頁）', () => {
  const P = needPure();
  const pages = P.mpPlanMeta(mkStats(), 8);
  pages.forEach((p, i) => {
    ok(p.page === i + 1, '第 ' + (i + 1) + ' 頁的 page 欄位是 ' + p.page);
    ok(p.pageTotal === pages.length, 'pageTotal 應為 ' + pages.length + '，實得 ' + p.pageTotal);
  });
});

T('⭐最後一頁不足額也照樣是一頁（不得為了整除而丟掉尾巴）', () => {
  const P = needPure();
  const pages = P.mpPlanMeta(mkStats(), 8).filter((p) => p.srcKey === 'casual');
  ok(pages.length === 5, '37 筆 / 每頁 8 應為 5 頁，實得 ' + pages.length);
  ok(pages[4].rows.length === 5, '最後一頁應剩 5 筆，實得 ' + pages[4].rows.length);
});

T('⭐⭐長條的滿長基準是**全體**最大佔比（每頁各自歸一化 = 後面幾頁全部畫成滿格）', () => {
  const P = needPure();
  const pages = P.mpPlanMeta(mkStats(), 8).filter((p) => p.srcKey === 'casual');
  const peaks = new Set(pages.map((p) => p.peak));
  ok(peaks.size === 1, '同一資料源各頁的 peak 應相同，實得 ' + [...peaks].join(' / '));
});

T('⭐⭐⭐奪冠報告：四個區段全部不截斷、段內名次連續', () => {
  const P = needPure();
  const mk = (n, k) => Array.from({ length: n }, (_, i) => ({ name: k + i, n: n - i }));
  const d = {
    champRank: mk(7, 'CR'),
    siteChamps: Array.from({ length: 12 }, (_, i) => ({ name: 'P' + i, deck: 'D' + i, eventName: 'E' + i, finishedAt: 1, players: 16, w: 4, l: 1 })),
    t4Rows: mk(19, 'T4'), commRank: mk(5, 'CM'),
  };
  const pages = P.mpPlanChampion(d, 5, 8);
  const sum = pages.reduce((s, p) => s + p.rows.length, 0);
  ok(sum === 7 + 12 + 19 + 5, '總筆數應為 43，實得 ' + sum);
  ok(pages.length === 1 + 3 + 3 + 1, '頁數應為 8，實得 ' + pages.length);
  pages.forEach((p, i) => ok(p.page === i + 1 && p.pageTotal === pages.length, '頁碼錯：' + p.page));
  // 段內連續
  const bySec = new Map();
  for (const p of pages) {
    const k = p.title;
    const arr = bySec.get(k) || [];
    p.rows.forEach((r, i) => arr.push(p.startRank + i));
    bySec.set(k, arr);
  }
  for (const [k, seq] of bySec) {
    ok(JSON.stringify(seq) === JSON.stringify(seq.map((_, i) => i + 1)), k + ' 名次不連續：' + seq.join(','));
  }
});

T('空資料也回 1 頁（頁數永遠 >= 1，版面不會因為沒資料而消失）', () => {
  const P = needPure();
  ok(P.mpPaginate([], 8).length === 1, '空陣列應回 1 頁');
  ok(P.mpPaginate([], 8)[0].items.length === 0, '那一頁應是空的');
});

// ⚠ v6.169（站長裁定）：三個牌組榜數的是「發生了幾次」不是「幾個人」⇒ 單位詞由「位」改「次」，
//   單頁版與完整版一起改。逐處語意判斷與更嚴格的斷言在 test-v6169-report-full-7rows-sections。
T('⭐單位詞與單頁版逐字一致（同一週發出去的兩張圖對同一筆資料不能寫不同單位）', () => {
  const P = needPure();
  const mk = (n, k) => Array.from({ length: n }, (_, i) => ({ name: k + i, n: n - i }));
  const d = { champRank: mk(3, 'A'), t4Rows: mk(3, 'B'), commRank: mk(2, 'C'),
              siteChamps: [{ name: 'x', deck: 'y' }, { name: 'z', deck: 'w' }] };
  for (const p of P.mpPlanChampion(d, 5, 8)) {
    if (p.kind === 'rank') ok(p.unit === '次', p.title + ' 的單位是「' + p.unit + '」，單頁版 rankRows 傳的是「次」');
  }
  ok((ADM.match(/r\.n \+ ' ' \+ unit/g) || []).length === 1, '單頁版 rankRows 的單位詞不再由呼叫端宣告');
  ok(!/r\.n \+ ' 位'/.test(ADM), '單頁版 rankRows 還硬寫著「位」');
});

T('⭐只有 1 場網站賽時不重複出「冠軍牌組次數榜」頁（與逐場頁完全等價、每列都是 1）', () => {
  const P = needPure();
  const one = { champRank: [{ name: 'A', n: 1 }],
                siteChamps: [{ name: 'p', deck: 'A' }], t4Rows: [], commRank: [] };
  const pages = P.mpPlanChampion(one, 5, 8);
  ok(pages.length === 1 && pages[0].kind === 'champ',
    '只有 1 場時應只出逐場頁，實得 ' + pages.map((p) => p.title).join(' / '));
  const two = { champRank: [{ name: 'A', n: 2 }],
                siteChamps: [{ name: 'p', deck: 'A' }, { name: 'q', deck: 'A' }], t4Rows: [], commRank: [] };
  ok(P.mpPlanChampion(two, 5, 8).length === 2, '2 場時次數榜有資訊量，應該要出');
});

T('⭐⭐「已達查詢上限」不會被 3 行的註腳版面擠掉（完整版其實不完整的唯一警訊）', () => {
  const P = needPure(), R = needRender();
  const d = { t4Skipped: 2, noCut: 1, noChamp: 1, capped: true };
  const raw = R.crNotes(d);
  ok(raw.length >= 5, 'crNotes 應產出 5 則以上，實得 ' + raw.length);
  ok(!raw.slice(0, 3).some((t) => t.includes('已達查詢上限')),
    '前提不成立：原順序前 3 則就有「已達查詢上限」⇒ 這條測試沒有意義了');
  const fixed = P.mpHoistCapNote(raw);
  ok(fixed.slice(0, 3).some((t) => t.includes('已達查詢上限')), '提前後仍不在前 3 則');
  ok(fixed.length === raw.length && new Set(fixed).size === new Set(raw).size, '搬移時弄丟或複製了註腳');
  ok(raw.some((t) => t.includes('已達查詢上限')) && raw !== fixed, 'mpHoistCapNote 不該就地改動傳入的陣列');
  ok(/mpHoistCapNote\(crNotes\(d\)\)/.test(ADM), '完整版沒有接上 mpHoistCapNote');
});

console.log('② 統計口徑：完整版與單頁版是同一份計算，不是第二份');

T('⭐⭐⭐分母／佔比只有 miComputeRows 一份（單頁版 miDraw 也改吃它）', () => {
  const P = needPure();
  const cur = mkStats();
  const st = P.miComputeRows('casual', cur);
  ok(st.total === cur.scanned.casualDecks, '分母應為 scanned.casualDecks，實得 ' + st.total);
  ok(Math.abs(st.share(90) - 90 / 900) < 1e-12, '佔比算法不對');
  ok(P.miComputeRows('tourn', cur).total === cur.scanned.tournDecks, '錦標賽分母應為 tournDecks');
  ok(P.miComputeRows('casual', { scanned: {}, casual: { rows: [] } }) === null, '沒有命中原型時應回 null');
});

T('⭐⭐⭐miDraw（單頁版）與 mpPlanMeta（完整版）都走 miComputeRows', () => {
  const draw = slice(ADM, 'async function miDraw(', '// ── 匯出流程');
  ok(/miComputeRows\(/.test(draw), '單頁版沒有走 miComputeRows —— 兩份分母遲早漂移');
  ok(!/cur\.scanned/.test(draw), '單頁版裡還有自己讀 scanned 的第二份計算：' + (draw.match(/.*cur\.scanned.*/) || [''])[0].trim());
  const plan = slice(ADM, 'function mpPlanMeta(', 'function mpPlanChampion(');
  ok(/miComputeRows\(/.test(plan), '完整版沒有走 miComputeRows');
  ok(!/reduce\(/.test(plan) && !/cur\.scanned/.test(plan), '完整版自己又算了一份分母');
});

T("⭐'casualDecks' 這個欄位名全檔只出現在 miDeckKey（避免第三份字面量）", () => {
  const hits = (ADM.match(/'casualDecks'/g) || []).length;
  ok(hits === 1, "'casualDecks' 出現 " + hits + " 次，應收斂成 1 次（miDeckKey）");
  ok(/function miDeckKey\(srcKey\)/.test(ADM), '沒有 miDeckKey');
});

T('⭐奪冠報告的資料取得（crLoadData）與註腳（crNotes）單頁／完整版共用', () => {
  ok(/async function crLoadData\(\)/.test(ADM), '沒有 crLoadData');
  ok(/function crNotes\(d\)/.test(ADM), '沒有 crNotes');
  const single = slice(ADM, 'window.openChampionReportExport', 'window.renderChampionReportModal');
  // ⚠ v6.169：完整版的產圖本體搬到 runChampionReportFullExport（按鈕先開勾選視窗）
  const full = slice(ADM, 'async function runChampionReportFullExport()', '\n}\n');
  ok(full.length > 200, '抽不到完整版產圖本體（錨點失效＝這條檢查等於沒做）');
  ok(/crLoadData\(\)/.test(single) && /crLoadData\(\)/.test(full), '兩邊應該都呼叫 crLoadData');
  ok(!/champion-report\?since=/.test(full), '完整版自己又打了一次端點 —— 兩份查詢參數會漂移');
  const defs = (ADM.match(/crBuild\(tournStatsCache/g) || []).length;
  ok(defs === 1, 'crBuild(tournStatsCache…) 有 ' + defs + ' 處，應只有 crLoadData 一處');
});

console.log('③ 畫圖層：真的畫一遍，數畫出來的東西');

const asyncChecks = [];
function TA(name, fn) { asyncChecks.push([name, fn]); }

TA('⭐⭐⭐把所有頁畫完：60 個牌組名一個不漏、不重複（環境報告）', async () => {
  const P = needPure(), R = needRender();
  const cur = mkStats();
  const pages = P.mpPlanMeta(cur, R.MP.PER);
  const seen = [];
  for (const p of pages) {
    p.days = 0; p.trend = null; p.notes = R.mpMetaNotes(p, null);
    const { ctx, rec } = mkCtx();
    await R.mpDrawMeta(ctx, p);
    for (const t of rec.texts) if (/^[CT]\d\d$/.test(t)) seen.push(t);
  }
  ok(seen.length === N_CASUAL + N_TOURN,
    '畫出來的牌組名共 ' + seen.length + ' 個，應為 ' + (N_CASUAL + N_TOURN) + ' 個（有被截斷或重複畫）');
  ok(new Set(seen).size === seen.length, '有重複畫到同一個牌組名');
});

TA('⭐⭐每一頁的畫布尺寸完全一致（尺寸一跳，剪成影片就會抖）', async () => {
  const P = needPure(), R = needRender();
  const cur = mkStats();
  const pages = P.mpPlanMeta(cur, R.MP.PER);
  const sizes = new Set();
  for (const p of pages) {
    p.days = 0; p.trend = null; p.notes = R.mpMetaNotes(p, null);
    const { ctx, rec } = mkCtx();
    await R.mpDrawMeta(ctx, p);
    const bg = rec.rects.find((r) => r[0] === 0 && r[1] === 0);
    ok(bg, '沒有畫滿版底色 ⇒ 這一頁會是透明背景');
    sizes.add(bg[2] + 'x' + bg[3]);
  }
  ok(sizes.size === 1, '各頁尺寸不一致：' + [...sizes].join(' / '));
  ok([...sizes][0] === '1920x1080', '影片素材應為 1920×1080，實得 ' + [...sizes][0]);
  ok(R.MP.W === 1920 && R.MP.H === 1080 && R.MP.S === 1, 'MP 的輸出尺寸常數不是 1920×1080×1');
});

TA('⭐⭐每一頁都畫得出「第 X / N 頁」，且 X 從 1 連號到 N', async () => {
  const P = needPure(), R = needRender();
  const cur = mkStats();
  const pages = P.mpPlanMeta(cur, R.MP.PER);
  const got = [];
  for (const p of pages) {
    p.days = 0; p.trend = null; p.notes = R.mpMetaNotes(p, null);
    const { ctx, rec } = mkCtx();
    await R.mpDrawMeta(ctx, p);
    const m = rec.texts.filter((t) => /^第 \d+ \/ \d+ 頁$/.test(t));
    ok(m.length === 1, '該頁的頁碼出現 ' + m.length + ' 次');
    got.push(m[0]);
  }
  const want = pages.map((p, i) => '第 ' + (i + 1) + ' / ' + pages.length + ' 頁');
  ok(JSON.stringify(got) === JSON.stringify(want), '頁碼序列錯：' + got.join(' | '));
});

TA('⭐每一頁都有品牌元素（logo + 站名 + 網址）與資料範圍', async () => {
  const P = needPure(), R = needRender();
  const cur = mkStats();
  const pages = P.mpPlanMeta(cur, R.MP.PER);
  for (const p of pages) {
    p.days = 30; p.trend = null; p.notes = R.mpMetaNotes(p, null);
    const { ctx, rec } = mkCtx();
    await R.mpDrawMeta(ctx, p);
    const all = rec.texts.join('\n');
    ok(all.includes('PTCG 台灣線上對戰模擬器'), '缺站名');
    ok((rec.texts.filter((t) => t.includes('www.ptcg-tw-sim.com'))).length >= 2, '網址至少要出現兩次（頂部＋頁腳）');
    ok(/資料截至/.test(all), '缺「資料截至」');
    ok(/共 \d+ 副/.test(all), '缺資料範圍（共 N 副）');
    ok(/第 \d+–\d+ 名（全部 \d+ 種牌組）/.test(all), '缺「本頁涵蓋第幾名 / 全部幾種」');
  }
});

TA('⭐⭐奪冠報告：四段全部畫得出來，43 筆一個不漏', async () => {
  const P = needPure(), R = needRender();
  const mk = (n, k) => Array.from({ length: n }, (_, i) => ({ name: k + String(i).padStart(2, '0'), n: n - i }));
  const d = {
    champRank: mk(7, 'CR'), t4Rows: mk(19, 'T4'), commRank: mk(5, 'CM'),
    siteChamps: Array.from({ length: 12 }, (_, i) => ({
      name: 'P' + String(i).padStart(2, '0'), deck: 'DK' + String(i).padStart(2, '0'),
      eventName: 'EV' + i, finishedAt: Date.now(), players: 16, w: 4, l: 1,
    })),
    nSite: 12, nComm: 5, entries: 200, from: Date.now() - 8.64e7, to: Date.now(),
    t4Skipped: 1, noCut: 0, noChamp: 0, capped: false,
  };
  const pages = P.mpPlanChampion(d, R.MP.PER_CHAMP, R.MP.PER);
  const notes = R.crNotes(d);
  const seen = [];
  const sizes = new Set();
  for (const p of pages) {
    p.d = d; p.notes = notes;
    const { ctx, rec } = mkCtx();
    await R.mpDrawChampion(ctx, p);
    for (const t of rec.texts) if (/^(CR|T4|CM|DK)\d\d$/.test(t)) seen.push(t);
    const bg = rec.rects.find((r) => r[0] === 0 && r[1] === 0);
    ok(bg, '沒有滿版底色');
    sizes.add(bg[2] + 'x' + bg[3]);
    ok(rec.texts.some((t) => /^第 \d+ \/ \d+ 頁$/.test(t)), '缺頁碼');
  }
  ok(sizes.size === 1 && [...sizes][0] === '1920x1080', '奪冠完整版的頁面尺寸不一致或不是 1920×1080：' + [...sizes].join('/'));
  ok(seen.length === 7 + 19 + 5 + 12,
    '畫出來的項目共 ' + seen.length + '，應為 43（冠軍列畫的是牌組名 DKxx）');
  ok(new Set(seen).size === seen.length, '有重複');
});

TA('⭐奪冠完整版全圖不出現百分比（奪冠是個位數事件，畫比率必然誤讀）', async () => {
  const P = needPure(), R = needRender();
  const mk = (n, k) => Array.from({ length: n }, (_, i) => ({ name: k + i, n: n - i }));
  const d = { champRank: mk(3, 'A'), t4Rows: mk(3, 'B'), commRank: mk(2, 'C'), siteChamps: [],
              nSite: 3, nComm: 2, entries: 40, from: Date.now(), to: Date.now(),
              t4Skipped: 0, noCut: 0, noChamp: 0, capped: false };
  const pages = P.mpPlanChampion(d, 5, 8);
  const notes = R.crNotes(d);
  for (const p of pages) {
    p.d = d; p.notes = notes;
    const { ctx, rec } = mkCtx();
    await R.mpDrawChampion(ctx, p);
    const bad = rec.texts.filter((t) => t.includes('%'));
    ok(bad.length === 0, '畫出了百分比：' + bad.join(' | '));
  }
});

console.log('④ ZIP 打包：檔名可排序、內容拆得開');

T('⭐ZIP 的 CRC32 算得對（算錯的話解壓工具會說檔案損毀）', () => {
  const Z = needZip();
  const enc = new TextEncoder();
  const files = [
    { name: '01.png', bytes: enc.encode('hello') },
    { name: '02.png', bytes: enc.encode('world!!') },
  ];
  const blob = Z.mpZip(files);
  ok(blob && typeof blob.arrayBuffer === 'function', 'mpZip 沒有回 Blob');
  // ⚠ 同步測不到 arrayBuffer，這條只驗 CRC 與型別；結構在下面的 async 版驗。
  ok(Z.mpCrc32(enc.encode('hello')) === 0x3610a686,
    'CRC32 算錯（hello 應為 0x3610a686，實得 0x' + Z.mpCrc32(enc.encode('hello')).toString(16) + '）');
});

TA('⭐⭐ZIP 真的解得開：檔名依序 01.png / 02.png，內容與 CRC 相符', async () => {
  const Z = needZip();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const files = [
    { name: '01.png', bytes: enc.encode('hello') },
    { name: '02.png', bytes: enc.encode('world!!') },
    { name: '03.png', bytes: enc.encode('') },
  ];
  const buf = new Uint8Array(await Z.mpZip(files).arrayBuffer());
  const dv = new DataView(buf.buffer);
  ok(dv.getUint32(0, true) === 0x04034b50, '開頭不是 local file header');
  // EOCD 在最後 22 bytes（無 comment）
  const eo = buf.length - 22;
  ok(dv.getUint32(eo, true) === 0x06054b50, '找不到 EOCD');
  ok(dv.getUint16(eo + 10, true) === files.length, 'EOCD 的檔案數不對');
  const cdSize = dv.getUint32(eo + 12, true), cdOff = dv.getUint32(eo + 16, true);
  ok(cdOff + cdSize === eo, 'central directory 的位移／長度對不上（解壓工具會直接說檔案損毀）');
  // 逐筆走 central directory，回頭讀 local header 取出內容
  let q = cdOff;
  for (let i = 0; i < files.length; i++) {
    ok(dv.getUint32(q, true) === 0x02014b50, '第 ' + i + ' 筆 central header 壞了');
    const nlen = dv.getUint16(q + 28, true);
    const name = dec.decode(buf.subarray(q + 46, q + 46 + nlen));
    ok(name === files[i].name, '第 ' + i + ' 筆檔名是 ' + name + '，應為 ' + files[i].name);
    const lho = dv.getUint32(q + 42, true);
    ok(dv.getUint32(lho, true) === 0x04034b50, 'central 指到的位置不是 local header');
    const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
    const sz = dv.getUint32(lho + 22, true);
    const data = buf.subarray(lho + 30 + lnlen + lxlen, lho + 30 + lnlen + lxlen + sz);
    ok(dec.decode(data) === dec.decode(files[i].bytes), '第 ' + i + ' 筆內容取不回來');
    ok(dv.getUint32(q + 16, true) === Z.mpCrc32(files[i].bytes), '第 ' + i + ' 筆 CRC 不符');
    q += 46 + nlen + dv.getUint16(q + 30, true) + dv.getUint16(q + 32, true);
  }
});

T('⭐檔名補零可排序（01.png…；超過 99 頁自動補到 3 位）', () => {
  const exp = slice(ADM, 'async function mpExportPages(', '\n}\n');
  ok(/padStart\(pad, '0'\)/.test(exp) && /String\(pages\.length\)\.length/.test(exp),
    '檔名沒有依總頁數補零 —— Canva 匯入時 10.png 會排在 2.png 前面');
  ok(/'\.png'/.test(exp), '副檔名不是 .png');
});

console.log('⑤ 多頁產圖的坑：decode 與記憶體');

T('⭐⭐logo 走既有 miLogo（內含 await img.decode()），不得自己 new Image', () => {
  const mp = slice(ADM, '// ══ v1.71 完整版（多頁）報告圖', 'window.loadArchetypeStats = async function');
  ok(mp.length > 3000, '抓不到完整版區段');
  ok(/await miLogo\(\)/.test(mp), '沒有用 miLogo —— 未 decode 的圖 drawImage 會靜默不畫也不報錯');
  ok(!/new Image\(\)/.test(mp), '自己又寫了一份載圖');
  ok((mp.match(/drawImage\(logo/g) || []).length >= 2, '每頁應該畫 logo（頂部＋頁腳）');
});

T('⭐⭐logo 預熱有逾時、字體先等 ready（唯一沒有失敗出口的 await）', () => {
  const exp = slice(ADM, 'async function mpExportPages(', '\n}\n');
  ok(/Promise\.race\(/.test(exp) && /setTimeout\(r, \d+\)/.test(exp),
    'miLogo 的 img.decode() 沒有逾時 ⇒ icon 請求 hang 住時按鈕會永遠停在「產生中…」，連 finally 都到不了');
  ok(/document\.fonts && document\.fonts\.ready/.test(exp),
    '沒有先等字體 ready ⇒ 之後只要加了 webfont，第 1 頁與後面幾頁的截斷位置會不一樣');
});

T('⭐⭐每頁轉完就釋放 canvas（1920×1080 一張約 8MB，十幾頁不放會把分頁吃爆）', () => {
  const exp = slice(ADM, 'async function mpExportPages(', '\n}\n');
  ok(/cv\.width = 1; cv\.height = 1;/.test(exp), '沒有釋放 canvas backing store');
  ok(/cv\.width = MP\.W \* MP\.S/.test(exp) && /cv\.height = MP\.H \* MP\.S/.test(exp),
    '每頁的畫布尺寸必須來自同一組常數（不得依內容調整）');
  ok(!/devicePixelRatio/.test(exp), '不可用 devicePixelRatio —— 輸出檔跟產圖者的螢幕無關');
});

console.log('⑥ 單頁版不得被動到（站長平常還在用）');

T('⭐單頁版仍是 1080×1350、仍只取前 TOPN、預覽 modal 與下載鈕都還在', () => {
  ok(/W: 1080, H: 1350, S: 2/.test(ADM), '單頁版的 MI 尺寸被改了');
  ok(/st\.rows\.slice\(0, MI\.TOPN\)/.test(ADM), '單頁版不再截到 TOPN（行為被改了）');
  for (const fn of ['openMetaImageExport', 'renderMetaImageModal', 'downloadMetaImage',
                    'openChampionReportExport', 'renderChampionReportModal', 'downloadChampionReport']) {
    ok(ADM.includes('window.' + fn + ' ='), '單頁版的 ' + fn + ' 不見了');
  }
});

T('⭐新按鈕掛 window（admin 是 module script，模組層級 function 全域看不到）', () => {
  for (const fn of ['openMetaImageFullExport', 'openChampionReportFullExport']) {
    ok(ADM.includes('window.' + fn + ' ='), fn + ' 沒掛 window ⇒ inline onclick 會 ReferenceError');
    ok(new RegExp('onclick="' + fn + '\\(\\)"').test(ADM), fn + ' 沒有 inline 呼叫點');
  }
  ok(/id="meta-img-full-btn"/.test(ADM) && /id="champ-img-full-btn"/.test(ADM), '缺按鈕 id');
  // 有統計結果才開放環境報告完整版（跟單頁版同一個開關點）
  ok(/getElementById\('meta-img-full-btn'\);\s*\n\s*if \(_mibf\) _mibf\.disabled = false;/.test(ADM),
    '算完統計後沒有把完整版按鈕解鎖 ⇒ 永遠按不了');
});

// ⚠ v6.169：奪冠完整版的按鈕改成先開「分段勾選」視窗，真正產圖搬到 runChampionReportFullExport
//   （具名函式宣告 + window 別名）⇒ 錨點跟著搬，不然這條會抓到空字串而永遠 PASS。
T('⭐連點防呆＋finally 復原按鈕文字（多頁產圖會跑好幾秒）', () => {
  for (const [fn, anchor] of [['openMetaImageFullExport', 'window.openMetaImageFullExport = async function'],
                              ['runChampionReportFullExport', 'async function runChampionReportFullExport()']]) {
    const body = slice(ADM, anchor, '\n}\n');
    ok(body.length > 200, fn + ' 抽不到函式本體（錨點失效＝這條檢查等於沒做）');
    ok(/_mpBusy/.test(body), fn + ' 沒有 in-flight flag');
    ok(/finally \{/.test(body) && /btn\.textContent = label/.test(body),
      fn + ' 沒有 finally 還原按鈕 ⇒ 一次失敗就永遠停在「產生中…」');
  }
});

// ── 跑 async 條目 ──────────────────────────────────────────────────────────
const run = async () => {
  for (const [name, fn] of asyncChecks) {
    try { await fn(); console.log('  ✓ ' + name); pass++; }
    catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
  }
  console.log('\n=== v6.168 報告圖完整版（多頁）：PASS ' + pass + ' / FAIL ' + fail + ' ===');
  if (fail > 0) process.exit(1);
};
run();
