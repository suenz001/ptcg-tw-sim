/**
 * ⭐v6.512 對比掃描（瀏覽器內執行）：找出畫面上「文字顏色對背景的對比 < 門檻」的元素。
 *   背景＝往上找祖先，把半透明的背景色一層層疊到第一個不透明底；遇到背景圖（卡圖、漸層）就記為「圖片底」不判定。
 *   只看自己有直接文字節點、看得見（有尺寸、visibility／opacity 正常、在視窗裡或可捲動到）的元素。
 *   回傳 [{ sel, text, color, bg, cr }]（依對比由低到高）。
 *   這個函式會被序列化後丟進 page.evaluate ⇒ 不可以引用外部變數。
 */
export function scanContrastInPage(minCr) {
  const parse = (c) => { const m = String(c).match(/[\d.]+/g); if (!m) return null; const [r, g, b, a] = m.map(Number); return { r, g, b, a: a === undefined ? 1 : a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        // 純色漸層（同一個顏色）以外的背景圖不判定
        const stops = cs.backgroundImage.match(/rgba?\([^)]*\)/g) || [];
        if (!/gradient/.test(cs.backgroundImage) || stops.length === 0) return null;
        const c = parse(stops[0]); if (c && c.a > 0) layers.push(c);
        if (c && c.a >= 0.99) break;
        continue;
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
      if (e.tagName === 'IMG' || e.tagName === 'VIDEO' || e.tagName === 'CANVAS') return null;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    if (layers.length && layers[layers.length - 1].a >= 0.99) base = layers.pop();
    else { const hc = parse(getComputedStyle(document.documentElement).backgroundColor); if (hc && hc.a > 0.99) base = hc; }
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const sel = (e) => e.tagName.toLowerCase() + [...e.classList].filter((c) => !/^svelte-/.test(c)).map((c) => '.' + c).join('');
  const out = new Map();
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!txt || !/[\p{L}\p{N}]/u.test(txt)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.2) continue;                      // 幾乎透明（動畫中／收起）的不判定
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;   // 停用的按鈕本來就淡
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); if (!bg) continue;
    const fgc = fg.a < 1 ? over(fg, bg) : fg;
    const L1 = lum(fgc), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (cr >= minCr) continue;
    const k = sel(el) + '|' + cs.color;
    if (!out.has(k) || out.get(k).cr > cr) out.set(k, { sel: sel(el), text: txt.slice(0, 24), color: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, cr: +cr.toFixed(2) });
  }
  return [...out.values()].sort((a, b) => a.cr - b.cr);
}
