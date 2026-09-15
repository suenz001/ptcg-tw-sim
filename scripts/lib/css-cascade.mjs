/**
 * scripts/lib/css-cascade.mjs —— 極小的 CSS 串接（cascade）模擬器
 *
 * 為什麼需要它：v6.389 踩過「新加的 CSS 規則其實是死碼」（.atk-overflow 與
 * .btn-act.primary 同特異度、寫在前面 ⇒ 永遠被蓋掉），而當時的守衛只驗「字串存在」
 * ⇒ 全綠。要守住這一類 bug，守衛必須能回答「這個元素**實際**拿到的是哪一條宣告」。
 *
 * ⚠ 刻意只支援 class／後代／子組合子／偽類，**遇到不支援的形態一律回報 null（fail-closed）**，
 *   由呼叫端決定要不要炸 —— 絕不可以默默當成「不 match」，那會讓守衛變成恆真式。
 */

/** 把 <style> 區塊切成規則陣列（含 at-rule 堆疊、宣告、!important、文件順序）。 */
export function parseCss(css) {
  const rules = [];
  const stack = [];
  let i = 0, buf = '';
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e < 0 ? css.length : e + 2; continue; }
    const ch = css[i];
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      buf = '';
      if (prelude.startsWith('@')) { stack.push(prelude); i++; continue; }
      let d = 1, j = i + 1;
      while (j < css.length && d > 0) {
        if (css[j] === '/' && css[j + 1] === '*') { const e = css.indexOf('*/', j + 2); j = e < 0 ? css.length : e + 2; continue; }
        if (css[j] === '{') d++;
        else if (css[j] === '}') d--;
        j++;
      }
      rules.push({ at: stack.slice(), sel: prelude, decls: parseDecls(css.slice(i + 1, j - 1)), order: rules.length, start: i });
      i = j; continue;
    }
    if (ch === '}') { stack.pop(); buf = ''; i++; continue; }
    buf += ch; i++;
  }
  return rules;
}

/** `a:b; c:d !important;` → { a:{value:'b',important:false}, c:{value:'d',important:true} } */
export function parseDecls(body) {
  const out = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, cur = '';
  const items = [];
  for (const ch of clean) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { items.push(cur); cur = ''; continue; }
    cur += ch;
  }
  items.push(cur);
  for (const it of items) {
    const k = it.indexOf(':');
    if (k < 0) continue;
    const prop = it.slice(0, k).trim();
    if (!prop) continue;
    let value = it.slice(k + 1).trim();
    let important = false;
    if (/!important$/i.test(value)) { important = true; value = value.replace(/!important$/i, '').trim(); }
    out[prop] = { value, important };   // 同一條規則內重複宣告 ⇒ 後者勝（CSS 行為）
  }
  return out;
}

const PSEUDO_OK = new Set(['hover', 'focus', 'active', 'disabled', 'last-child', 'first-child', 'not', 'nth-of-type', 'nth-child']);

function parseCompound(c) {
  const classes = [...c.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const rest = c.replace(/\.[\w-]+/g, '');
  const pseudo = [...rest.matchAll(/:{1,2}([\w-]+)(\([^)]*\))?/g)].map((m) => m[1]);
  const el = rest.replace(/:{1,2}[\w-]+(\([^)]*\))?/g, '').trim();
  return { classes, pseudo, el };
}

/**
 * 單一複合選擇器對 ctx 求值。
 * @returns {number|null} 特異度（match）／-1（不 match）／null（**這支模擬器不支援的形態**）
 */
export function matchOne(sel, ctx) {
  if (/[#\[]|::|,/.test(sel)) return null;                    // id／屬性／偽元素 ⇒ 不支援
  const toks = sel.trim().replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/).filter(Boolean);
  if (toks.some((t) => t === '+' || t === '~')) return null;   // 兄弟組合子 ⇒ 不支援
  const right = parseCompound(toks[toks.length - 1]);
  if (right.el && right.el !== '*') return null;
  if (right.pseudo.some((p) => !PSEUDO_OK.has(p))) return null;
  if (!right.classes.length) return null;
  let spec = right.classes.length * 10 + right.pseudo.length * 10;
  if (!right.classes.every((c) => ctx.self.has(c))) return -1;
  let ai = 0, child = false;
  for (let k = toks.length - 2; k >= 0; k--) {
    const t = toks[k];
    if (t === '>') { child = true; continue; }
    const cmp = parseCompound(t);
    if (cmp.el && cmp.el !== '*') return null;
    if (cmp.pseudo.some((p) => !PSEUDO_OK.has(p))) return null;
    if (!cmp.classes.length) return null;
    spec += cmp.classes.length * 10 + cmp.pseudo.length * 10;
    if (child) {
      if (ai >= ctx.ancestors.length || !cmp.classes.every((c) => ctx.ancestors[ai].has(c))) return -1;
      ai++; child = false;
    } else {
      let found = -1;
      for (let j = ai; j < ctx.ancestors.length; j++) { if (cmp.classes.every((c) => ctx.ancestors[j].has(c))) { found = j; break; } }
      if (found < 0) return -1;
      ai = found + 1;
    }
  }
  return spec;
}

/**
 * 求 ctx 這個元素在 prop 上**實際勝出**的宣告。
 * ctx = { self:Set<class>, ancestors:[Set<class>…]（近→遠）, media:[at-rule 字串…] }
 * @returns {{value,important,spec,order,sel,fullSel,at}|null}
 *   ⚠ sel 是**命中的那個片段**，fullSel 是那條規則的完整選擇器 —— 守衛要斷言
 *     「勝出的宣告來自中央那條群組規則」時，必須比 fullSel，比 sel 會恆真（片段長得一樣）。
 */
export function cascade(rules, prop, ctx, onUnsupported) {
  let best = null;
  for (const r of rules) {
    if (!r.at.every((a) => ctx.media.includes(a))) continue;
    const d = r.decls[prop];
    if (d === undefined) continue;
    for (const s of r.sel.split(',')) {
      const spec = matchOne(s.trim(), ctx);
      if (spec === null) { if (onUnsupported) onUnsupported(r, s.trim()); continue; }
      if (spec < 0) continue;
      const cand = { ...d, spec, order: r.order, sel: s.trim(), fullSel: r.sel, at: r.at };
      if (!best
        || (cand.important && !best.important)
        || (cand.important === best.important && cand.spec > best.spec)
        || (cand.important === best.important && cand.spec === best.spec && cand.order >= best.order)) best = cand;
    }
  }
  return best;
}

/** 取 Svelte 檔案的 <style> 內容（含起點位移）。 */
export function styleBlockOf(src) {
  const a = src.indexOf('<style');
  if (a < 0) return null;
  const b = src.indexOf('>', a);
  const e = src.lastIndexOf('</style>');
  if (b < 0 || e < 0) return null;
  return { css: src.slice(b + 1, e), offset: b + 1 };
}
