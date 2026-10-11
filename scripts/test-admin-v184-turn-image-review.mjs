#!/usr/bin/env node
/**
 * admin v1.84 守衛：補做 v1.83（先後攻匯出圖）的 Fable 5.1 審查後的修正（站長 2026-10-11：「一定都要審查」）。
 *
 * 審查發現：①五位數場數會疊到勝率（P2-1）②v1.83 守衛只攔「字串與順序」，欄位座標對調、紅綠顏色對調、樣本不足不變灰、
 *   all／tourn 的場數算錯都抓不到（P2-2）③差值依浮點決定正負號與顏色（「+0.0 點」綠字）、樣本不足時差值仍是飽和色（P3-1／2）
 *   ④註腳用截斷（P3-3）⑤known 公式抄兩份、0 場時圖與網頁不一致、舊伺服器按鈕仍可按（P3-4）。
 *
 * 本守衛攔截 canvas fillText 時一併記 x、y、textAlign、fillStyle（不是只記字串）：
 *   G1 欄位：先攻格的字落在先攻欄中心、後攻格落在後攻欄中心；勝率與場數同 x、不同 y（分兩行）
 *   G2 顏色：+40.0 點＝K.up、-20.0 點＝K.dn
 *   G3 樣本不足（minGames=100）：勝率字與差值都是 K.dim
 *   G4 五位數場數：「12,345 場」與勝率不在同一行（y 差 ≥ 18）
 *   G5 所有文字都在畫布內（y < 高、x 在左右邊界內）
 *   G6 資料源 all：匯出鈕的場數＝一般＋錦標賽
 *   G7 mxDiffView／mxKnownTurn 純函式（含 ±0.00008 邊界、樣本不足灰字）
 *   G8 單一牌組對戰表圖：0 場也畫先攻／後攻那一行（與網頁一致）
 *   G9 舊伺服器（沒有 turnOrder）時「匯出先後攻圖」鈕不啟用
 * 【H】BASE（admin v1.83）：G1、G3、G4、G7～G9 逐條紅（G2、G6 是 v1.83 本來就對、但舊守衛測不到的回歸鎖，由突變證明）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.525（admin v1.83）。
const BASE_SHA = 'bb15549e';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// k1：先攻 4 勝 1 負、後攻 2 勝 3 負 ⇒ +40.0 點；k2：先攻 2 勝 3 負、後攻 3 勝 2 負 ⇒ -20.0 點
const DATA = {
  // k3 名稱刻意超長：G5 的正對照（名字沒截斷就會畫出右緣，G5 必須紅）
  names: { k1: '袋獸型', k2: '老大型', k3: '冷門型' + '超長名稱'.repeat(30) }, unclassifiedKey: '_u',
  casual: { usage: { k1: [6, 5, 0], k2: [4, 6, 0], k3: [1, 0, 0] }, pairs: { k1: { k2: [3, 2, 0] }, k2: { k1: [2, 3, 0] } },
            turnOrder: { k1: { first: [4, 1, 0], second: [2, 3, 0] }, k2: { first: [2, 3, 0], second: [3, 2, 0] } } },
  tourn: { usage: { k1: [1, 0, 0] }, pairs: {}, turnOrder: { k1: { first: [1, 0, 0], second: [0, 0, 0] } } },
  scanned: { casualTurnKnown: 20, tournTurnKnown: 5 },
};
const BIG = JSON.parse(JSON.stringify(DATA));
BIG.casual.turnOrder.k1 = { first: [6000, 6345, 0], second: [6100, 6245, 0] };   // 12,345 場
BIG.scanned.casualTurnKnown = 30000;
const OLD = JSON.parse(JSON.stringify(DATA)); delete OLD.casual.turnOrder; delete OLD.tourn.turnOrder;

async function judge(browser, HTML) {
  const cut = (a, b) => { const i = HTML.indexOf(a); const j = HTML.indexOf(b, i); return i >= 0 && j > i ? HTML.slice(i, j) : ''; };
  const code = cut('const MI_URL', '// ══ MP-PURE-BEGIN') + cut('let _miLogo = null', '/**\n * 由「本期')
    + cut('// ══ v1.80 常用牌組對戰勝率', 'window.loadArchetypeStats');
  const pg = await browser.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  try {
    await pg.setContent('<html><head><meta charset="utf-8"></head><body>'
      + '<select id="mx-src"><option value="casual">c</option><option value="all">a</option></select>'
      + '<select id="mx-topn"><option value="20">20</option></select><select id="mx-min"><option value="1">1</option><option value="100">100</option></select>'
      + '<button id="mx-img-btn" disabled></button><button id="mx-focus-btn" disabled></button><button id="mx-turn-img-btn" disabled></button><datalist id="mx-name-list"></datalist>'
      + '<div id="mx-box"></div><div id="mx-turn-box"></div><div id="modal-container"></div></body></html>');
    const r = await pg.evaluate(async ([code, data, big, old]) => {
      window.currentArchSince = () => 30; window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
      window.twOffsetMs = () => 8 * 3600000; window.closeModal = () => {};
      const alerts = []; window.alert = (m) => alerts.push(String(m));
      let apiResp = data; window.api = async () => JSON.parse(JSON.stringify(apiResp));
      let T = [];
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
        const m = this.getTransform();
        T.push({ t: String(t), x: (x * m.a + m.e) / m.a, y: (y * m.d + m.f) / m.d, align: this.textAlign, fs: String(this.fillStyle).toLowerCase(), H: this.canvas.height / m.d, W: this.canvas.width / m.a, w: this.measureText(String(t)).width });
        return orig.call(this, t, x, y);
      };
      (0, eval)(code + '\nwindow.__mx = { mxBuild, mxTurnOrder: typeof mxTurnOrder === "function" ? mxTurnOrder : null, mxDrawFocus,'
        + ' mxDrawTurnOrder: typeof mxDrawTurnOrder === "function" ? mxDrawTurnOrder : null,'
        + ' mxDiffView: typeof mxDiffView === "function" ? mxDiffView : null, mxKnownTurn: typeof mxKnownTurn === "function" ? mxKnownTurn : null,'
        + ' K: MI.K, W: MI.W, PAD: MI.PAD };'
        + '\nwindow.__setData = (d) => { _mxData = d; };');
      const out = { K: __mx.K, W: __mx.W, PAD: __mx.PAD };
      const draw = async (d, minGames) => {
        T = [];
        const t = __mx.mxTurnOrder(d, 'casual', { topN: 20, minGames });
        await __mx.mxDrawTurnOrder(t, 'casual', { known: 20, minGames });
        return T.slice();
      };
      out.norm = await draw(data, 1);
      out.insuff = await draw(data, 100);
      out.big = await draw(big, 1);
      // G6：資料源 all 經匯出鈕
      __setData(data);
      document.getElementById('mx-src').value = 'all';
      T = []; await window.exportArchTurnImage();
      out.allTexts = T.map((x) => x.t);
      document.getElementById('mx-src').value = 'casual';
      // G7 純函式
      if (__mx.mxDiffView && __mx.mxKnownTurn) {
        const L = (d, ok1, ok2) => ({ diff: d, first: { ok: ok1 }, second: { ok: ok2 } });
        out.dv = [L(0.4, true, true), L(-0.2, true, true), L(0.00008, true, true), L(-0.00008, true, true), L(0.0006, true, true), L(0.3, false, true), L(null, true, true), L(0.0005, true, true), L(-0.0005, true, true)].map((l) => __mx.mxDiffView(l));
        out.kn = [__mx.mxKnownTurn({ casualTurnKnown: 3, tournTurnKnown: 4 }, 'casual'), __mx.mxKnownTurn({ casualTurnKnown: 3, tournTurnKnown: 4 }, 'tourn'), __mx.mxKnownTurn({ casualTurnKnown: 3, tournTurnKnown: 4 }, 'all'), __mx.mxKnownTurn(null, 'all')];
      }
      // G8：單一牌組（k3 沒有任何先後攻資料）
      window._mxFocusKey = 'k3';
      T = []; await window.exportArchFocusImage();
      out.focus0 = T.map((x) => x.t);
      // G10：網頁表（複審 P3-3／P3-4）——場數千分位；資料源 all 在舊伺服器時要說「伺服器還沒更新」
      __setData(big); window.renderArchTurnOrder(); out.webBig = document.getElementById('mx-turn-box').innerText;
      __setData(old); document.getElementById('mx-src').value = 'all'; window.renderArchTurnOrder(); out.webOldAll = document.getElementById('mx-turn-box').innerText;
      document.getElementById('mx-src').value = 'casual';
      // G9：舊伺服器 → 按鈕
      apiResp = old;
      document.getElementById('mx-turn-img-btn').disabled = true;
      await window.loadArchMatchups();
      out.btnOld = document.getElementById('mx-turn-img-btn').disabled;
      apiResp = data;
      await window.loadArchMatchups();
      out.btnNew = document.getElementById('mx-turn-img-btn').disabled;
      CanvasRenderingContext2D.prototype.fillText = orig;
      out.alerts = alerts;
      return out;
    }, [code, DATA, BIG, OLD]);
    const K = Object.fromEntries(Object.entries(r.K).map(([k, v]) => [k, String(v).toLowerCase()]));
    const fX = 520, cw = 170, sX = fX + cw + 16;
    const find = (arr, t, from = 0) => { for (let i = from; i < arr.length; i++) if (arr[i].t === t) return i; return -1; };
    const N = r.norm;
    // G1：袋獸型那一列
    const iName = find(N, '袋獸型');
    const pF = find(N, '80.0%', iName), pS = find(N, '40.0%', pF + 1);
    const gF = pF >= 0 ? N[pF + 1] : null;
    const G1 = iName >= 0 && pF > 0 && pS > 0
      && Math.abs(N[pF].x - (fX + cw / 2)) < 0.5 && N[pF].align === 'center' && Math.abs(N[pS].x - (sX + cw / 2)) < 0.5
      && Math.abs(N[pF].y - N[pS].y) < 0.5 && Math.abs(N[pF].y - N[iName].y) < 15
      && !!gF && /場$/.test(gF.t) && Math.abs(gF.x - N[pF].x) < 0.5 && gF.y - N[pF].y >= 18;
    // G2：顏色
    const up = N.find((x) => x.t === '+40.0 點'), dn = N.find((x) => x.t === '-20.0 點');
    const G2 = !!up && !!dn && up.fs === K.up && dn.fs === K.dn && K.up !== K.dn;
    // G3：樣本不足
    const I = r.insuff;
    const i80 = I.find((x) => x.t === '80.0%'), d40 = I.find((x) => x.t === '+40.0 點');
    const G3 = !!i80 && !!d40 && i80.fs === K.dim && d40.fs === K.dim && N.find((x) => x.t === '80.0%').fs !== K.dim;
    // G4：五位數場數
    const B = r.big;
    const bg = B.find((x) => x.t === '12,345 場');
    const bIdx = B.indexOf(bg);
    const bp = bIdx > 0 ? B[bIdx - 1] : null;
    const G4 = !!bg && !!bp && /%$/.test(bp.t) && bg.y - bp.y >= 18 && Math.abs(bg.x - bp.x) < 0.5;
    // G5：都在畫布內
    // 複審 P3-1：連文字寬度一起算（原本只擋起點，註腳不換行超出右緣 2000px 也綠）
    const span = (x) => x.align === 'right' ? [x.x - x.w, x.x] : x.align === 'center' ? [x.x - x.w / 2, x.x + x.w / 2] : [x.x, x.x + x.w];
    const inside = (arr) => arr.every((x) => { const [x0, x1] = span(x); return x.y > 0 && x.y < x.H - 10 && x0 >= r.PAD - 8 - 0.5 && x1 <= x.W - r.PAD + 0.5; });
    const G5 = inside(N) && inside(I) && inside(B) && N.length > 20;
    // G6
    const G6 = (r.allTexts || []).some((t) => t === '知道誰先攻的對戰 25 場');
    // G7
    const dv = r.dv || [];
    const G7 = dv.length === 9 && dv[7].text === '+0.1 點' && dv[8].text === '-0.1 點'   // 正負對稱捨入（複審 P3-2）
      && dv[0].text === '+40.0 點' && dv[0].sign === 1 && !dv[0].dim
      && dv[1].text === '-20.0 點' && dv[1].sign === -1
      && dv[2].text === '0.0 點' && dv[2].sign === 0 && dv[3].text === '0.0 點' && dv[3].sign === 0
      && dv[4].text === '+0.1 點' && dv[4].sign === 1
      && dv[5].dim === true && dv[6].text === '—' && dv[6].dim === true
      && JSON.stringify(r.kn) === '[3,4,7,0]';
    // G8
    const G8 = (r.focus0 || []).some((t) => t.indexOf('先攻勝率 —（0 場）') >= 0);
    // G9
    const G9 = r.btnOld === true && r.btnNew === false;
    const G10 = /12,345 場/.test(r.webBig || '') && /v1\.59/.test(r.webOldAll || '');
    return { G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, errs,
      raw: JSON.stringify({ n: N && N.slice(iName, iName + 8), up, dn, i80, d40, bg, bp, all: (r.allTexts || []).filter((t) => /知道/.test(t)), dv, kn: r.kn, f0: (r.focus0 || []).filter((t) => /先攻/.test(t)), btn: [r.btnOld, r.btnNew] }).slice(0, 2000) };
  } catch (e) {
    return { errs: errs.concat([e.message]), raw: e.message };
  } finally { await pg.close(); }
}

const HTML = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8').replace(/\r\n/g, '\n');
const _tv = /<title>PTCG Oracle Admin v1\.(\d+)<\/title>/.exec(HTML), _hv = /PTCG Oracle Admin <span class="small">v1\.(\d+)<\/span>/.exec(HTML);
ok('★[V] admin 版本號 ≥ v1.84（title 與 h1 一致）', !!_tv && !!_hv && _tv[1] === _hv[1] && Number(_tv[1]) >= 84);
const chromium = pwChromium('admin v1.84');
const browser = chromium ? await pwLaunchWith(chromium, 'admin v1.84') : null;
if (browser) {
  try {
    const E = await judge(browser, HTML);
    ok('★★★[G1] 欄位：先攻格的字在先攻欄中心、後攻格在後攻欄中心；勝率與場數同欄上下兩行', !!E.G1, E.raw);
    ok('★★★[G2] 顏色：正差＝K.up、負差＝K.dn', !!E.G2);
    ok('★★★[G3] 樣本不足：勝率與差值都是灰字', !!E.G3);
    ok('★★★[G4] 五位數場數（12,345 場）不與勝率同一行', !!E.G4);
    ok('★★[G5] 所有文字都在畫布內（含註腳）', !!E.G5);
    ok('★★★[G6] 資料源「一般＋錦標賽」：場數＝兩者相加', !!E.G6);
    ok('★★★[G7] mxDiffView／mxKnownTurn：正負號依顯示值、樣本不足灰、三個資料源場數', !!E.G7);
    ok('★★[G8] 單一牌組對戰表圖：0 場也畫先攻／後攻那一行（與網頁一致）', !!E.G8);
    ok('★★[G9] 舊伺服器（沒有 turnOrder）時「匯出先後攻圖」鈕不啟用；新伺服器啟用', !!E.G9);
    ok('★★[G10] 網頁表：場數千分位；資料源「一般＋錦標賽」在舊伺服器時提示更新（不是一張全「—」的表）', !!E.G10, E.raw);
    ok('[G0] 沒有 JS 例外', E.errs.length === 0, E.errs.slice(0, 3).join(' | '));
    console.log('\n【H】HEAD-FAIL');
    if (hasBaseCommit(ROOT, BASE_SHA)) {
      const ba = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/admin.html');
      if (ba.ok) {
        const BE = await judge(browser, ba.out.replace(/\r\n/g, '\n'));
        // G2（顏色）、G6（all 場數）v1.83 本來就對 ⇒ 是回歸鎖（舊守衛測不到；由突變測試證明會紅），不列入 HEAD-FAIL
        ok('★★★[H1] admin v1.83：G1、G3、G4、G7～G10 逐條紅', !BE.G1 && !BE.G3 && !BE.G4 && !BE.G7 && !BE.G8 && !BE.G9 && !BE.G10,
          JSON.stringify({ G1: BE.G1, G2: BE.G2, G3: BE.G3, G4: BE.G4, G6: BE.G6, G7: BE.G7, G8: BE.G8, G9: BE.G9 }));
      } else shallowSkip('admin-v184 H', '讀不到 BASE blob');
    } else shallowSkip('admin-v184 H', '需要 bb15549e commit');
  } finally { await browser.close(); }
} else ok('[E0] 需要 Chromium', false);

console.log(`\n=== admin v1.84 先後攻匯出圖（審查後修正）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
