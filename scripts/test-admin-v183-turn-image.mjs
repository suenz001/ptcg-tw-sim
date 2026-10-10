#!/usr/bin/env node
/**
 * admin v1.83 守衛（站長 2026-10-11：「Admin先後攻的統計資料，你有做匯出圖片的功能嗎」「直接做，不用預覽 交給你了」）。
 *
 * ① 新增「🖼️ 匯出先後攻圖」：資料就是網頁上那張先攻／後攻表（mxTurnOrder 的全體＋前 N 名），不另算。
 * ② 單一牌組的「🖼️ 匯出對戰表圖」補上先攻／後攻勝率那一行（網頁視窗原本就有、圖上沒有）；沒有先後攻資料時圖與 v1.82 相同。
 *
 * 【U】接線：按鈕在、計算完會跟矩陣圖鈕一起啟用、export 函式掛在 window（module script）
 * 【E】真瀏覽器實跑（攔截 canvas fillText 記下畫上去的字）：
 *      E1 先後攻圖：尺寸、標題、全體與每副牌組的先攻／後攻勝率與差、知道誰先攻的場數
 *      E2 匯出鈕：產生圖片視窗與檔名；舊伺服器（沒有 turnOrder）與 0 場時跳提示、不產圖
 *      E3 對戰表圖：有先後攻資料 ⇒ 多一行先攻／後攻勝率；沒傳 ⇒ 不畫（與 v1.82 相同，高度不變）
 * 【H】BASE（admin v1.82）：U、E1、E2、E3 逐條紅
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：admin v1.82／server v1.61。
const BASE_SHA = '25404351';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// k1：先攻 4 勝 1 負（80.0%）、後攻 2 勝 3 負（40.0%）⇒ +40.0 點
// k2：先攻 2 勝 3 負（40.0%）、後攻 3 勝 2 負（60.0%）⇒ -20.0 點
// 全體：先攻 6 勝 4 負（60.0%）、後攻 5 勝 5 負（50.0%）⇒ +10.0 點
const DATA = {
  names: { k1: '袋獸型', k2: '老大型' }, unclassifiedKey: '_u',
  casual: { usage: { k1: [6, 5, 0], k2: [4, 6, 0] }, pairs: { k1: { k2: [3, 2, 0] }, k2: { k1: [2, 3, 0] } },
            turnOrder: { k1: { first: [4, 1, 0], second: [2, 3, 0] }, k2: { first: [2, 3, 0], second: [3, 2, 0] } } },
  tourn: { usage: {}, pairs: {}, turnOrder: {} },
  scanned: { casualTurnKnown: 20, tournTurnKnown: 0 },
};
const OLD = JSON.parse(JSON.stringify(DATA)); delete OLD.casual.turnOrder; delete OLD.tourn.turnOrder;

function judgeUi(HTML) {
  return {
    U1: /<button id="mx-turn-img-btn" onclick="exportArchTurnImage\(\)"/.test(HTML)
      && /\['mx-img-btn', 'mx-focus-btn', 'mx-turn-img-btn'\]\.forEach/.test(HTML)
      && HTML.includes('window.exportArchTurnImage = async function'),
  };
}

async function judgeBrowser(browser, HTML, tag) {
  const cut = (a, b) => { const i = HTML.indexOf(a); const j = HTML.indexOf(b, i); return i >= 0 && j > i ? HTML.slice(i, j) : ''; };
  const code = cut('const MI_URL', '// ══ MP-PURE-BEGIN') + cut('let _miLogo = null', '/**\n * 由「本期')
    + cut('// ══ v1.80 常用牌組對戰勝率', 'window.loadArchetypeStats');
  const pg = await browser.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  try {
    await pg.setContent('<html><head><meta charset="utf-8"></head><body>'
      + '<select id="mx-src"><option value="casual">c</option></select>'
      + '<select id="mx-topn"><option value="20">20</option></select><select id="mx-min"><option value="1">1</option></select>'
      + '<div id="mx-box"></div><div id="mx-turn-box"></div><div id="modal-container"></div></body></html>');
    const r = await pg.evaluate(async ([code, data, old]) => {
      window.currentArchSince = () => 30; window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
      window.twOffsetMs = () => 8 * 3600000; window.closeModal = () => {};
      const alerts = []; window.alert = (m) => alerts.push(String(m));
      // 攔截畫上去的字
      let texts = [];
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { texts.push(String(t)); return orig.call(this, t, x, y); };
      (0, eval)(code + '\nwindow.__mx = { mxBuild, mxTurnOrder: typeof mxTurnOrder === "function" ? mxTurnOrder : null, mxDrawFocus,'
        + ' mxDrawTurnOrder: typeof mxDrawTurnOrder === "function" ? mxDrawTurnOrder : null };'
        + '\nwindow.__setData = (d) => { _mxData = d; };');
      const out = { alerts };
      __setData(data);
      // E1：先後攻圖本身
      if (__mx.mxDrawTurnOrder) {
        texts = [];
        const t = __mx.mxTurnOrder(data, 'casual', { topN: 20, minGames: 1 });
        const cv = await __mx.mxDrawTurnOrder(t, 'casual', { known: 20, minGames: 1 });
        out.e1 = { w: cv.width, h: cv.height, texts: texts.slice(), png: cv.toDataURL('image/png') };
      }
      // E2：匯出鈕（新伺服器）→ 圖片視窗與檔名
      if (typeof window.exportArchTurnImage === 'function') {
        document.getElementById('modal-container').innerHTML = '';
        await window.exportArchTurnImage();
        const img = document.querySelector('#modal-container img');
        out.e2 = { img: !!img, alerts: alerts.slice() };
        alerts.length = 0;
        // 舊伺服器（沒有 turnOrder）
        __setData(old); document.getElementById('modal-container').innerHTML = '';
        await window.exportArchTurnImage();
        out.e2old = { img: !!document.querySelector('#modal-container img'), alerts: alerts.slice() };
        alerts.length = 0;
        // 0 場知道誰先攻
        const zero = JSON.parse(JSON.stringify(data)); zero.scanned = { casualTurnKnown: 0, tournTurnKnown: 0 };
        __setData(zero); document.getElementById('modal-container').innerHTML = '';
        await window.exportArchTurnImage();
        out.e2zero = { img: !!document.querySelector('#modal-container img'), alerts: alerts.slice() };
        alerts.length = 0;
        __setData(data);
      }
      // E3：對戰表圖（匯出鈕路徑，會帶先後攻）＋直接呼叫不帶 tf（零回歸）
      window._mxFocusKey = 'k1';
      texts = []; document.getElementById('modal-container').innerHTML = '';
      await window.exportArchFocusImage();
      out.e3with = { texts: texts.slice(), img: !!document.querySelector('#modal-container img') };
      texts = [];
      const cvNo = await __mx.mxDrawFocus(__mx.mxBuild(data, 'casual', { topN: 20, minGames: 1, focusKey: 'k1' }), 'casual');
      out.e3without = { texts: texts.slice(), w: cvNo.width, h: cvNo.height };
      CanvasRenderingContext2D.prototype.fillText = orig;
      return out;
    }, [code, DATA, OLD]);
    const T1 = (r.e1 && r.e1.texts) || [];
    const has = (arr, s) => arr.some((t) => t.includes(s));
    const rowPcts = (arr, name) => { const i = arr.indexOf(name); return i < 0 ? null : arr.slice(i + 1).filter((t) => /^\d+\.\d%$/.test(t)).slice(0, 2).join(','); };
    const res = {
      E1: !!r.e1 && r.e1.w === 2160 && r.e1.h > 1000
        && has(T1, '先攻／後攻勝率') && has(T1, '全體') && has(T1, '袋獸型') && has(T1, '老大型')
        && T1.includes('60.0%') && T1.includes('50.0%') && T1.includes('+10.0 點')     // 全體
        && T1.includes('80.0%') && T1.includes('40.0%') && T1.includes('+40.0 點')     // k1
        && T1.includes('-20.0 點') && has(T1, '知道誰先攻的對戰 20 場')
        // 欄位不可對調：每一列名字之後的兩個百分比依序＝先攻、後攻（只驗「有畫上去」擋不住左右對調）
        && rowPcts(T1, '袋獸型') === '80.0%,40.0%' && rowPcts(T1, '老大型') === '40.0%,60.0%' && rowPcts(T1, '全體') === '60.0%,50.0%',
      E2: !!r.e2 && r.e2.img && r.e2.alerts.length === 0
        && !!r.e2old && !r.e2old.img && r.e2old.alerts.some((a) => a.includes('v1.59'))
        && !!r.e2zero && !r.e2zero.img && r.e2zero.alerts.length === 1,
      E3: !!r.e3with && r.e3with.img && has(r.e3with.texts, '先攻勝率 80.0%（5 場）') && has(r.e3with.texts, '後攻勝率 40.0%（5 場）')
        && !!r.e3without && !has(r.e3without.texts, '先攻勝率') && r.e3without.w === 2160 && r.e3without.h === 2700,
      errs, raw: JSON.stringify({ e1: r.e1 && { w: r.e1.w, h: r.e1.h, t: T1.slice(0, 40) }, e2: r.e2, e2old: r.e2old, e2zero: r.e2zero, e3: r.e3with && r.e3with.texts.slice(0, 12) }).slice(0, 1500),
    };
    // 本機目視用：PTCG_SAVE_PNG=目錄 時把先後攻圖存下來
    if (process.env.PTCG_SAVE_PNG && r.e1 && r.e1.png) writeFileSync(join(process.env.PTCG_SAVE_PNG, 'turn-' + tag + '.png'), Buffer.from(r.e1.png.split(',')[1], 'base64'));
    return res;
  } catch (e) {
    return { E1: false, E2: false, E3: false, errs: errs.concat([e.message]), raw: e.message };
  } finally { await pg.close(); }
}

const HTML = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8').replace(/\r\n/g, '\n');
console.log('【U】接線');
const U = judgeUi(HTML);
ok('★★[U1] 「🖼️ 匯出先後攻圖」鈕在、計算完跟矩陣圖鈕一起啟用、export 函式掛在 window', U.U1);
// ⚠ 不釘死某一版（安慰劑型態 9）：≥ v1.83 且 title 與 h1 一致
const _tv = /<title>PTCG Oracle Admin v1\.(\d+)<\/title>/.exec(HTML), _hv = /PTCG Oracle Admin <span class="small">v1\.(\d+)<\/span>/.exec(HTML);
ok('★[U2] admin 版本號 ≥ v1.83（title 與 h1 一致）', !!_tv && !!_hv && _tv[1] === _hv[1] && Number(_tv[1]) >= 83);

console.log('\n【E】真瀏覽器');
const chromium = pwChromium('admin v1.83');
const browser = chromium ? await pwLaunchWith(chromium, 'admin v1.83') : null;
if (browser) {
  try {
    const E = await judgeBrowser(browser, HTML, 'head');
    ok('★★★[E1] 先後攻圖：全體與每副牌組的先攻／後攻勝率、差（正負都有）、知道誰先攻的場數都畫上去', E.E1, E.raw);
    ok('★★★[E2] 匯出鈕：產生圖片；舊伺服器（沒有 turnOrder）與 0 場時只跳提示、不產圖', E.E2, E.raw);
    ok('★★★[E3] 對戰表圖：匯出時多一行先攻／後攻勝率；不帶先後攻時不畫、尺寸與 v1.82 相同', E.E3, E.raw);
    ok('[E9] 沒有 JS 例外', E.errs.length === 0, E.errs.slice(0, 3).join(' | '));

    console.log('\n【H】HEAD-FAIL');
    if (hasBaseCommit(ROOT, BASE_SHA)) {
      const ba = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/admin.html');
      if (ba.ok) {
        const BH = ba.out.replace(/\r\n/g, '\n');
        const BU = judgeUi(BH), BE = await judgeBrowser(browser, BH, 'base');
        ok('★★★[H1] admin v1.82：U1、E1、E2、E3 逐條紅', !BU.U1 && !BE.E1 && !BE.E2 && !BE.E3, JSON.stringify({ U1: BU.U1, E1: BE.E1, E2: BE.E2, E3: BE.E3 }));
      } else shallowSkip('admin-v183 H', '讀不到 BASE blob');
    } else shallowSkip('admin-v183 H', '需要 admin v1.82 commit');
  } finally { await browser.close(); }
} else ok('[E0] 需要 Chromium', false);

console.log(`\n=== admin v1.83 先攻／後攻匯出圖：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
