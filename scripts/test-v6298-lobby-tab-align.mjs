// v6.298 守衛：**新元素必須與既有版面對齊**（分頁列／分頁內容／既有大廳表單的左右邊界完全一致）
//
// ⚠⚠ 這支守衛補的是 v6.296／v6.297 的盲點：
//   那兩版的量測只斷言了「**既有元素沒有位移**」（dx=dy=dw=dh=0），
//   **沒有斷言「新元素與既有元素對齊」** —— 於是 v6.296 新增的 .lobby-tabs 因為寫了
//   `margin:6px auto 12px`（置中）而 .online-form.lobby-unified 沒有 margin:auto（靠左），
//   分頁列整條右移了幾十像素，**所有守衛都是綠的**，最後是站長用眼睛看出來的。
//
// 做法：CI 沒有瀏覽器（devDependencies 沒有 playwright），所以這裡不用 DOM，
//   改成**把 <style> 區真的解析出來、用 CSS 2.1 §10.3.3 的區塊盒寬度公式算出 left／right**。
//   ⭐ 這不是「檢查字串裡有沒有 auto」那種安慰劑 —— 它是把 margin/padding/max-width/box-sizing
//     的層疊結果算成數字再比較，寫法換成 `margin-inline:auto`／`width:fit-content`／
//     百分比 margin 一樣算得出來。
//
// ⭐⭐ 求解器本身的驗證（Rule 25：掃描器要先被驗證）：
//   ①【內建正對照】把 `margin:auto` 加回去 ⇒ 求解器**必須**算出不對齊（本檔 D 區，會 assert）。
//   ②【瀏覽器交叉驗證】scripts/measure-v6298-lobby-align.mjs（不在 chain，需要 playwright）
//     用真的 chromium 量 getBoundingClientRect()，與本檔匯出的求解器逐項對照，不一致就 exit 1。
//   ③【下限斷言】解析到的規則數、以及每個目標選擇器必須都找得到（找不到＝求解器瞎了）。
//
// ⚠ 不 pin 任何版本號／sha（IRON_RULES 守衛紀律 E）：斷言的是「三者一致」這個不綁版本的等價條件。
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = join(ROOT, 'src/routes/game/+page.svelte');

/* ───────────────────────── CSS 解析 ───────────────────────── */

/** 抽出 .svelte 檔最後一段 <style> 的內容。 */
export function extractStyle(src) {
  const i = src.lastIndexOf('<style');
  assert.ok(i >= 0, '找不到 <style> 區 —— 求解器瞎了');
  const start = src.indexOf('>', i) + 1;
  const end = src.lastIndexOf('</style>');
  assert.ok(end > start, '<style> 區抓錯範圍 —— 求解器瞎了');
  return src.slice(start, end);
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 以頂層逗號／空白切值，遇到括號不切。 */
function splitTop(value, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch))) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseDecls(body) {
  const out = [];
  for (const part of splitTop(body, ';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    const prop = part.slice(0, k).trim().toLowerCase();
    let value = part.slice(k + 1).trim();
    let important = false;
    if (/!\s*important$/i.test(value)) { important = true; value = value.replace(/!\s*important$/i, '').trim(); }
    if (prop) out.push({ prop, value, important });
  }
  return out;
}
// splitTop 只吃 ',' 與空白；分號要另外處理
function splitSemis(body) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 解析成扁平規則清單：{ media:[cond…], selector, decls, order }。@supports 一律視為成立。 */
export function parseRules(css) {
  const rules = [];
  let order = 0;
  const walk = (text, media) => {
    let i = 0;
    for (;;) {
      const brace = text.indexOf('{', i);
      if (brace < 0) break;
      const prelude = text.slice(i, brace).trim();
      let depth = 1, j = brace + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(brace + 1, j - 1);
      if (prelude.startsWith('@')) {
        const at = prelude.split(/[\s(]/)[0].toLowerCase();
        if (at === '@media') walk(body, media.concat(prelude.slice('@media'.length).trim()));
        else if (at === '@supports') walk(body, media);
        // @keyframes / @font-face：忽略
      } else if (prelude) {
        const decls = [];
        for (const part of splitSemis(body)) {
          const k = part.indexOf(':');
          if (k < 0) continue;
          const prop = part.slice(0, k).trim().toLowerCase();
          if (!prop || prop.startsWith('--')) continue;
          let value = part.slice(k + 1).trim();
          let important = false;
          if (/!\s*important$/i.test(value)) { important = true; value = value.replace(/!\s*important$/i, '').trim(); }
          decls.push({ prop, value, important });
        }
        rules.push({ media, selector: prelude, decls, order: order++ });
      }
      i = j;
    }
  };
  walk(stripComments(css).replace(/:global\(([^)]*)\)/g, '$1'), []);
  return rules;
}

/* ───────────────────────── media query 求值 ───────────────────────── */

const SUPPORTED_FEATURES = new Set(['max-width', 'min-width', 'orientation', 'hover', 'pointer', 'prefers-reduced-motion']);

function mediaMatches(cond, env) {
  // 逗號＝或
  return splitTop(cond, ',').some((clause) => {
    const feats = clause.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
    return feats.every((f) => {
      const m = /^\(\s*([a-z-]+)\s*:\s*([^)]+)\)$/i.exec(f);
      if (!m) {
        if (/^(screen|all)$/i.test(f)) return true;
        throw new Error('media 條件看不懂（求解器要修）：' + f);
      }
      const [, feature, rawVal] = m;
      const name = feature.toLowerCase();
      if (!SUPPORTED_FEATURES.has(name)) throw new Error('media 特性沒支援（求解器要修）：' + name);
      const val = rawVal.trim().toLowerCase();
      if (name === 'max-width') return env.width <= parseFloat(val);
      if (name === 'min-width') return env.width >= parseFloat(val);
      if (name === 'orientation') return val === env.orientation;
      if (name === 'hover') return val === env.hover;
      if (name === 'pointer') return val === env.pointer;
      if (name === 'prefers-reduced-motion') return val === 'no-preference';
      return false;
    });
  });
}

/* ───────────────────────── 選擇器比對 ───────────────────────── */

const UNSUPPORTED = /[:[\]#*+~>]|::|\(/;   // '>' 也丟進來單獨處理（見下）

/** 把一個 compound（例：`main.lobby.tourn-lobby`）解析成 {tag, classes}；看不懂回 null。 */
function parseCompound(c) {
  if (!c) return null;
  if (/[[\]#*:()+~]/.test(c)) return null;
  const classes = [];
  let tag = '';
  const parts = c.split('.');
  tag = parts[0].trim().toLowerCase();
  for (const p of parts.slice(1)) {
    if (!p || !/^[\w-]+$/.test(p)) return null;
    classes.push(p);
  }
  if (tag && !/^[a-z][\w-]*$/.test(tag)) return null;
  return { tag, classes };
}

/** el = { tag, classes:[…], parent: el|null }。只支援後代（空白）與子代（>）組合子。 */
function selectorMatches(sel, el) {
  // 切出 compound 與組合子
  const tokens = sel.trim().split(/\s*(>)\s*|\s+/).filter((t) => t !== undefined && t !== '');
  const seq = [];
  for (const t of tokens) {
    if (t === '>') { seq.push({ comb: '>' }); continue; }
    const c = parseCompound(t);
    if (!c) return null;   // 看不懂 ⇒ null（呼叫端要記錄下來）
    seq.push({ comp: c });
  }
  if (!seq.length || !seq[seq.length - 1].comp) return null;
  const matchOne = (comp, node) => (!comp.tag || comp.tag === node.tag) && comp.classes.every((c) => node.classes.includes(c));
  // 從尾往前
  const walk = (idx, node) => {
    if (idx < 0) return true;
    const item = seq[idx];
    if (item.comb === '>') {
      const prev = seq[idx - 1];
      if (!prev || !prev.comp) return false;
      return node.parent && matchOne(prev.comp, node.parent) && walk(idx - 2, node.parent);
    }
    // 後代：找任一祖先
    for (let a = node.parent; a; a = a.parent) if (matchOne(item.comp, a) && walk(idx - 1, a)) return true;
    return false;
  };
  if (!matchOne(seq[seq.length - 1].comp, el)) return false;
  return walk(seq.length - 2, el);
}

function specificity(sel) {
  const compounds = sel.trim().split(/\s*>\s*|\s+/).filter(Boolean);
  let b = 0, c = 0;
  for (const cp of compounds) {
    const parts = cp.split('.');
    if (parts[0]) c++;
    b += parts.length - 1;
  }
  return b * 1000 + c;
}

/* ───────────────────────── 值求值 ───────────────────────── */

const REM = 16;

function toPx(value, cbWidth) {
  const v = String(value).trim().toLowerCase();
  if (v === 'auto') return 'auto';
  if (v === 'none') return 'none';
  if (v === '0') return 0;
  let m = /^(-?[\d.]+)px$/.exec(v); if (m) return parseFloat(m[1]);
  m = /^(-?[\d.]+)rem$/.exec(v); if (m) return parseFloat(m[1]) * REM;
  m = /^(-?[\d.]+)em$/.exec(v); if (m) return parseFloat(m[1]) * REM;   // 只用在無 font-size 覆寫處
  m = /^(-?[\d.]+)%$/.exec(v); if (m) return (parseFloat(m[1]) / 100) * cbWidth;
  m = /^(-?[\d.]+)vw$/.exec(v); if (m) return null;                      // 需要 viewport：呼叫端不會用到
  if (v.startsWith('calc(')) {
    // 極簡 calc：只支援 A +|- B，且 var(--safe-*, X) 取 fallback
    const inner = v.slice(5, -1).replace(/var\(\s*--[\w-]+\s*,\s*([^)]*)\)/g, '$1');
    const parts = inner.split(/\s+([+-])\s+/);
    let acc = toPx(parts[0], cbWidth);
    if (typeof acc !== 'number') return null;
    for (let i = 1; i < parts.length; i += 2) {
      const rhs = toPx(parts[i + 1], cbWidth);
      if (typeof rhs !== 'number') return null;
      acc = parts[i] === '+' ? acc + rhs : acc - rhs;
    }
    return acc;
  }
  return null;
}

const SIDE = { margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'], padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] };

/** 展開 shorthand，回傳 { prop -> {value, important, spec, order} } 的最終層疊結果。 */
function computeStyle(rules, el, env, notes) {
  const winners = new Map();
  const put = (prop, value, important, spec, order) => {
    const cur = winners.get(prop);
    if (cur && (cur.important && !important)) return;
    if (cur && cur.important === important && (cur.spec > spec || (cur.spec === spec && cur.order > order))) return;
    winners.set(prop, { value, important, spec, order });
  };
  for (const rule of rules) {
    if (rule.media.length && !rule.media.every((c) => mediaMatches(c, env))) continue;
    for (const sel of splitTop(rule.selector, ',')) {
      const r = selectorMatches(sel, el);
      if (r === null) { notes.unsupported.push(sel); continue; }
      if (!r) continue;
      const spec = specificity(sel);
      notes.matched.push(sel);
      for (const d of rule.decls) {
        const vals = splitTop(d.value, ' ');
        if (d.prop === 'margin' || d.prop === 'padding') {
          const [t, r2, b, l] = [vals[0], vals[1] ?? vals[0], vals[2] ?? vals[0], vals[3] ?? vals[1] ?? vals[0]];
          const names = SIDE[d.prop];
          [t, r2, b, l].forEach((v, i) => put(names[i], v, d.important, spec, rule.order));
        } else if (d.prop === 'border') {
          for (const s of ['top', 'right', 'bottom', 'left']) put('border-' + s + '-width', vals[0] ?? '0', d.important, spec, rule.order);
        } else if (d.prop === 'border-width') {
          const [t, r2, b, l] = [vals[0], vals[1] ?? vals[0], vals[2] ?? vals[0], vals[3] ?? vals[1] ?? vals[0]];
          ['top', 'right', 'bottom', 'left'].forEach((s, i) => put('border-' + s + '-width', [t, r2, b, l][i], d.important, spec, rule.order));
        } else if (d.prop === 'border-left' || d.prop === 'border-right') {
          put(d.prop + '-width', vals[0] ?? '0', d.important, spec, rule.order);
        } else if (d.prop === 'margin-inline') {
          put('margin-left', vals[0], d.important, spec, rule.order);
          put('margin-right', vals[1] ?? vals[0], d.important, spec, rule.order);
        } else {
          put(d.prop, d.value, d.important, spec, rule.order);
        }
      }
    }
  }
  const out = {};
  for (const [k, v] of winners) out[k] = v.value;
  return out;
}

/** CSS 2.1 §10.3.3 區塊盒寬度公式。回傳相對於 containing block 內容框左緣的 {left,right,width}。 */
function solveBox(style, cbWidth) {
  const num = (prop, dflt) => {
    const v = style[prop];
    if (v === undefined) return dflt;
    const px = toPx(v, cbWidth);
    if (px === null) throw new Error('值算不出來（求解器要修）：' + prop + ':' + v);
    return px;
  };
  const borderBox = (style['box-sizing'] || 'content-box').trim() === 'border-box';
  const pl = num('padding-left', 0), pr = num('padding-right', 0);
  const bl = num('border-left-width', 0), br = num('border-right-width', 0);
  const extra = (typeof pl === 'number' ? pl : 0) + (typeof pr === 'number' ? pr : 0)
    + (typeof bl === 'number' ? bl : 0) + (typeof br === 'number' ? br : 0);
  let ml = num('margin-left', 0), mr = num('margin-right', 0);
  let w = num('width', 'auto');
  let maxW = num('max-width', 'none');
  let minW = num('min-width', 0);

  const solve = (wIn) => {
    let mL = ml, mR = mr, width = wIn;
    if (width === 'auto') {
      mL = mL === 'auto' ? 0 : mL; mR = mR === 'auto' ? 0 : mR;
      width = cbWidth - mL - mR - extra;
    } else {
      if (mL === 'auto' && mR === 'auto') { const rest = cbWidth - width - extra; mL = mR = rest / 2; }
      else if (mL === 'auto') mL = cbWidth - width - extra - mR;
      else if (mR === 'auto') mR = cbWidth - width - extra - mL;
      else mR = cbWidth - width - extra - mL;   // over-constrained：ltr 忽略 margin-right
    }
    return { mL, mR, width };
  };

  let r = solve(w);
  const contentOf = (used) => (borderBox ? Math.max(0, used - extra) : used);
  // max-width / min-width 以「width 屬性所指的盒」比較
  const usedAsWidthProp = borderBox ? r.width + extra : r.width;
  if (maxW !== 'none' && usedAsWidthProp > maxW) r = solve(maxW);
  const usedAsWidthProp2 = borderBox ? r.width + extra : r.width;
  if (minW !== 0 && minW !== 'auto' && usedAsWidthProp2 < minW) r = solve(minW);

  const content = contentOf(r.width);
  const borderBoxW = content + extra;
  return { left: r.mL, right: r.mL + borderBoxW, width: borderBoxW, contentLeft: r.mL + bl + pl, contentWidth: content };
}

/* ───────────────────────── 兩組版面 ───────────────────────── */

const envOf = (w, h) => (w < h
  ? { width: w, orientation: 'portrait', hover: 'none', pointer: 'coarse' }
  : { width: w, orientation: 'landscape', hover: 'hover', pointer: 'fine' });

function rowSolver(css, vw, vh, containerClasses, childSpecs) {
  const rules = parseRules(css);
  assert.ok(rules.length > 500, '只解析到 ' + rules.length + ' 條 CSS 規則 —— 解析器壞了？');
  const env = envOf(vw, vh ?? (vw < 700 ? vw * 2 : Math.round(vw * 0.56)));
  const body = { tag: 'body', classes: [], parent: null };
  const container = { tag: 'main', classes: containerClasses, parent: body };
  const notes = { matched: [], unsupported: [] };
  const cStyle = computeStyle(rules, container, env, notes);
  const cBox = solveBox(cStyle, vw);
  const out = { _container: cBox, _notes: notes, _rules: rules.length };
  for (const [key, spec] of Object.entries(childSpecs)) {
    const el = { tag: spec.tag || 'div', classes: spec.classes, parent: container };
    const n = { matched: [], unsupported: [] };
    const s = computeStyle(rules, el, env, n);
    const b = solveBox(s, cBox.contentWidth);
    out[key] = {
      left: +(cBox.contentLeft + b.left).toFixed(4),
      right: +(cBox.contentLeft + b.right).toFixed(4),
      width: +b.width.toFixed(4),
      _hit: n.matched.length,
    };
  }
  return out;
}

export const solveLobbyRow = (css, vw, vh) => rowSolver(css, vw, vh, ['lobby'], {
  tabs: { classes: ['lobby-tabs'] },
  online: { classes: ['online-form', 'lobby-unified'] },
  panel: { classes: ['lobby-tab-panel'] },
});

export const solveTournRow = (css, vw, vh) => rowSolver(css, vw, vh, ['lobby', 'tourn-lobby'], {
  tabs: { classes: ['tourn-tabs'] },
  panel: { classes: ['tourn-tab-panel'] },
});

/* ───────────────────────── 主測試 ───────────────────────── */

const VPS = [
  { w: 375, h: 812, tag: '375×812' },
  { w: 390, h: 844, tag: '390×844' },
  { w: 1366, h: 768, tag: '1366×768' },
  { w: 320, h: 640, tag: '320×640' },
  { w: 768, h: 1024, tag: '768×1024' },
  { w: 1920, h: 1080, tag: '1920×1080' },
];
const EPS = 1e-6;

function main() {
  let pass = 0;
  const ok = (msg) => { pass++; console.log('  ✓ ' + msg); };
  const src = readFileSync(PAGE, 'utf8');
  const css = extractStyle(src);

  console.log('【A】求解器下限斷言（Rule 25：掃描器自己要先被驗證）');
  const rules = parseRules(css);
  assert.ok(rules.length > 500, 'A1 解析到的 CSS 規則數 ' + rules.length + ' ≤ 500 —— 解析器壞了');
  ok('A1 解析到 ' + rules.length + ' 條 CSS 規則');
  for (const [name, cls] of [['.lobby-tabs', 'lobby-tabs'], ['.lobby-tab-panel', 'lobby-tab-panel'],
    ['.online-form', 'online-form'], ['.tourn-tabs', 'tourn-tabs'], ['.tourn-tab-panel', 'tourn-tab-panel'],
    ['.lobby', 'lobby']]) {
    const n = rules.filter((r) => splitTop(r.selector, ',').some((s) => s.split(/[\s>]+/).some((cp) => cp.split('.').slice(1).includes(cls)))).length;
    assert.ok(n >= 1, 'A2 找不到選擇器 ' + name + ' 的任何規則 —— 求解器瞎了');
  }
  ok('A2 六個目標選擇器都找得到規則');
  {
    const probe = solveLobbyRow(css, 1366, 768);
    for (const k of ['tabs', 'online', 'panel']) {
      assert.ok(probe[k]._hit >= 1, 'A3 ' + k + ' 一條規則都沒命中 —— 選擇器比對壞了');
      assert.ok(probe[k].width > 0, 'A3 ' + k + ' 算出寬度 ' + probe[k].width + ' ≤ 0 —— 盒模型算錯');
    }
    ok('A3 三個元素都命中規則且寬度 > 0');
  }
  {
    // ⭐⭐ A4：**不准把正對照拿掉**。守衛最危險的退化是「有人為了讓它變綠就把正對照刪掉」——
    //   刪掉之後 PASS 條數會變少，但沒有任何一條會紅。這裡讀本檔自己的原始碼把那件事變成紅燈。
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert.ok(self.includes('【D】正對照'), 'A4 【D】正對照區被拿掉了 —— 這支守衛會退化成安慰劑');
    const controls = (self.match(/^\s*ok\('D\d/gm) || []).length;
    assert.ok(controls >= 4, 'A4 正對照只剩 ' + controls + ' 條（至少要 4 條）—— 正對照被砍了');
    ok('A4 【D】正對照區在，且有 ' + controls + ' 條正對照');
  }

  console.log('\n【B】線上大廳：分頁列／線上分頁內容／好友分頁內容 三者左右邊界必須完全一致');
  for (const vp of VPS) {
    const s = solveLobbyRow(css, vp.w, vp.h);
    const line = (k) => k + ' left=' + s[k].left + ' right=' + s[k].right;
    assert.ok(Math.abs(s.tabs.left - s.online.left) < EPS,
      'B ' + vp.tag + ' 分頁列與線上分頁**左邊界不一致**：' + line('tabs') + ' ／ ' + line('online'));
    assert.ok(Math.abs(s.tabs.right - s.online.right) < EPS,
      'B ' + vp.tag + ' 分頁列與線上分頁**右邊界不一致**：' + line('tabs') + ' ／ ' + line('online'));
    assert.ok(Math.abs(s.tabs.left - s.panel.left) < EPS,
      'B ' + vp.tag + ' 分頁列與好友分頁**左邊界不一致**：' + line('tabs') + ' ／ ' + line('panel'));
    assert.ok(Math.abs(s.tabs.right - s.panel.right) < EPS,
      'B ' + vp.tag + ' 分頁列與好友分頁**右邊界不一致**：' + line('tabs') + ' ／ ' + line('panel'));
    ok('B ' + vp.tag + ' 三者一致 left=' + s.tabs.left + ' right=' + s.tabs.right);
  }

  console.log('\n【C】錦標賽大廳：分頁列 vs 分頁內容 左右邊界必須完全一致');
  for (const vp of VPS) {
    const s = solveTournRow(css, vp.w, vp.h);
    assert.ok(Math.abs(s.tabs.left - s.panel.left) < EPS,
      'C ' + vp.tag + ' 錦標賽分頁列與分頁內容**左邊界不一致**：' + s.tabs.left + ' ／ ' + s.panel.left);
    assert.ok(Math.abs(s.tabs.right - s.panel.right) < EPS,
      'C ' + vp.tag + ' 錦標賽分頁列與分頁內容**右邊界不一致**：' + s.tabs.right + ' ／ ' + s.panel.right);
    ok('C ' + vp.tag + ' 錦標賽兩者一致 left=' + s.tabs.left + ' right=' + s.tabs.right);
  }

  console.log('\n【D】正對照：把 margin:auto 加回去 ⇒ 求解器**必須**算出不對齊');
  {
    // D1 分頁列置中、內容靠左（＝ v6.296/v6.297 出貨的那個 bug）
    const bug = css + '\n.lobby-tabs{ margin:6px auto 12px; }\n';
    const s = solveLobbyRow(bug, 1366, 768);
    assert.ok(Math.abs(s.tabs.left - s.online.left) > 1,
      'D1 正對照失效：把 .lobby-tabs 的 margin:auto 加回去之後，求解器仍算出對齊 —— 這支守衛是安慰劑');
    ok('D1 .lobby-tabs margin:auto ⇒ 偏移 ' + (s.tabs.left - s.online.left).toFixed(2) + 'px（正對照有效）');
    // D2 好友分頁置中
    const bug2 = css + '\n.lobby-tab-panel{ margin:0 auto; }\n';
    const s2 = solveLobbyRow(bug2, 1366, 768);
    assert.ok(Math.abs(s2.panel.left - s2.online.left) > 1,
      'D2 正對照失效：把 .lobby-tab-panel 的 margin:auto 加回去之後，求解器仍算出對齊');
    ok('D2 .lobby-tab-panel margin:auto ⇒ 偏移 ' + (s2.panel.left - s2.online.left).toFixed(2) + 'px（正對照有效）');
    // D3 錦標賽側：讓分頁內容變窄置中 ⇒ 必須被 C 抓到
    const bug3 = css + '\n.tourn-tab-panel{ max-width:360px; margin:0 auto; }\n';
    const s3 = solveTournRow(bug3, 1366, 768);
    assert.ok(Math.abs(s3.tabs.left - s3.panel.left) > 1,
      'D3 正對照失效：錦標賽分頁內容改成置中窄版之後，求解器仍算出對齊');
    ok('D3 錦標賽 .tourn-tab-panel 置中窄版 ⇒ 偏移 ' + (s3.panel.left - s3.tabs.left).toFixed(2) + 'px（正對照有效）');
    // D4 手機窄幅也要抓得到「既有版面被推走」
    const bug4 = css + '\n.online-form.lobby-unified{ margin-left:40px; }\n';
    const s4 = solveLobbyRow(bug4, 375, 812);
    assert.ok(Math.abs(s4.online.left - s4.tabs.left) > 1,
      'D4 正對照失效：把既有大廳表單往右推 40px 之後，求解器仍算出對齊');
    ok('D4 375px 下把既有表單右推 40px ⇒ 偏移 ' + (s4.online.left - s4.tabs.left).toFixed(2) + 'px（正對照有效）');
  }

  console.log('\n══ v6.298 分頁對齊守衛：' + pass + ' PASS ══');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
