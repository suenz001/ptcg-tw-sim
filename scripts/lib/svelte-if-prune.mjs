// ⭐⭐ v6.296：把 Svelte markup 裡「條件只用到已知變數」的 {#if}／{:else if}／{:else} 依**求值結果**剪枝。
//
// 為什麼要這個東西：站長對本版的最高約束是「不要造成現有框架的異常」，而最硬的證明是
// 「**匿名玩家看到的大廳，與上一版一模一樣**」。要證明它，就得把新版 markup 在「匿名」這組
// 變數下實際會渲染出來的東西算出來，再與 BASE 的同一段比對 —— 而不是用肉眼看 diff。
//
// 規則（刻意保守，寧可少剪也不要剪錯）：
//   ・條件裡出現**未知識別字** ⇒ 整個 {#if} 區塊原樣保留（連標記一起），不做任何化簡。
//   ・巢狀：{#if}/{#each}/{#await}/{#key}/{#snippet} 都計入深度；{:else} 只有在最內層是 {#if} 時才算 if 的分支。
//   ・標記若**獨佔一行**（前面只有空白、後面就是換行），連整行一起移除 —— 否則會留下一行只有縮排的殘骸。
//
// ⚠ 這支東西自己也可能有 bug ⇒ 使用它的守衛必須附「正對照」：改動被保護區塊的一個位元，比對必須翻紅。
const OPEN = /\{#(if|each|await|key|snippet)\b/;

function lineExtent(src, start, endExclusive) {
  const ls = src.lastIndexOf('\n', start) + 1;
  const before = src.slice(ls, start);
  if (!/^[ \t]*$/.test(before)) return null;
  let k = endExclusive;
  while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
  if (src[k] !== '\n') return null;
  return [ls, k + 1];
}

/** 從 `{` 開始，配對出對應的 `}`（處理巢狀大括號與引號）。 */
function closeBrace(src, i) {
  let d = 0, q = '';
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return j; }
  }
  return -1;
}

/** 解析從 `{#if` 開始的整個區塊。回傳 { branches:[{cond|null, bodyStart, bodyEnd, marker:[s,e]}], end }。 */
function parseIf(src, start) {
  const close = closeBrace(src, start);
  if (close < 0) return null;
  const cond = src.slice(start + 4, close).trim();
  const branches = [];
  let cur = { cond, marker: [start, close + 1], bodyStart: close + 1 };
  const stack = ['if'];
  let i = close + 1;
  while (i < src.length) {
    const c = src.indexOf('{', i);
    if (c < 0) return null;
    const tail = src.slice(c, c + 12);
    if (/^\{#(if|each|await|key|snippet)\b/.test(tail)) {
      const e = closeBrace(src, c); if (e < 0) return null;
      stack.push(tail.slice(2).match(/^[a-z]+/)[0]); i = e + 1; continue;
    }
    if (/^\{\/(if|each|await|key|snippet)\}/.test(tail)) {
      const e = src.indexOf('}', c);
      stack.pop();
      if (stack.length === 0) {
        cur.bodyEnd = c; branches.push(cur);
        return { branches, end: e + 1, closeMarker: [c, e + 1] };
      }
      i = e + 1; continue;
    }
    if (stack.length === 1 && stack[0] === 'if' && /^\{:else\b/.test(tail)) {
      const e = closeBrace(src, c); if (e < 0) return null;
      cur.bodyEnd = c; branches.push(cur);
      const raw = src.slice(c + 1, e).trim();               // ':else' 或 ':else if XXX'
      const m = /^:else\s+if\s+([\s\S]*)$/.exec(raw);
      cur = { cond: m ? m[1].trim() : null, marker: [c, e + 1], bodyStart: e + 1 };
      i = e + 1; continue;
    }
    i = c + 1;
  }
  return null;
}

const IDENT = /(?<![.'"\w$])([A-Za-z_$][\w$]*)/g;
const LITERAL = new Set(['true', 'false', 'null', 'undefined', 'typeof', 'void', 'in', 'instanceof']);
function idsOf(cond) {
  const out = new Set();
  for (const m of cond.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''").matchAll(IDENT)) {
    if (!LITERAL.has(m[1])) out.add(m[1]);
  }
  return out;
}

/**
 * @param {string} src markup
 * @param {Record<string, unknown>} vars 已知變數（條件用到別的識別字 ⇒ 該區塊原樣保留）
 */
export function pruneIfs(src, vars) {
  const known = new Set(Object.keys(vars));
  let out = '', i = 0;
  while (i < src.length) {
    const rel = src.slice(i).search(/\{#if\b/);
    if (rel < 0) { out += src.slice(i); break; }
    const start = i + rel;
    const blk = parseIf(src, start);
    if (!blk) { out += src.slice(i, start + 4); i = start + 4; continue; }
    const conds = blk.branches.map((b) => b.cond).filter((c) => c !== null);
    const resolvable = conds.every((c) => [...idsOf(c)].every((id) => known.has(id)));
    if (!resolvable) {
      // 保留整個區塊，但**內部**仍要繼續剪（巢狀的可解條件不放過）
      let inner = '';
      for (const b of blk.branches) inner += src.slice(b.marker[0], b.marker[1]) + pruneIfs(src.slice(b.bodyStart, b.bodyEnd), vars);
      out += src.slice(i, start) + inner + src.slice(blk.closeMarker[0], blk.end);
      i = blk.end; continue;
    }
    // 可解：挑第一個為真的分支
    let picked = null;
    for (const b of blk.branches) {
      if (b.cond === null) { picked = b; break; }
      const val = new Function(...known, 'return (' + b.cond + ');')(...[...known].map((k) => vars[k]));
      if (val) { picked = b; break; }
    }
    const openExt = lineExtent(src, blk.branches[0].marker[0], blk.branches[0].marker[1]);
    const headCut = openExt ? openExt[0] : blk.branches[0].marker[0];
    out += src.slice(i, headCut);
    if (picked) {
      const mExt = lineExtent(src, picked.marker[0], picked.marker[1]);
      const bStart = mExt ? mExt[1] : picked.bodyStart;
      const cExt = lineExtent(src, blk.closeMarker[0], blk.closeMarker[1]);
      // body 的尾端：若收尾標記獨佔一行，就把那一行整個切掉
      const bEnd = (picked.bodyEnd === blk.branches[blk.branches.length - 1].bodyEnd && cExt) ? cExt[0] : picked.bodyEnd;
      out += pruneIfs(src.slice(bStart, bEnd), vars);
    }
    const closeExt = lineExtent(src, blk.closeMarker[0], blk.closeMarker[1]);
    i = closeExt ? closeExt[1] : blk.end;
  }
  return out;
}

/** 去掉「不會產生任何元素」的東西：HTML 註解、行尾空白、純空白行。 */
export function normalizeMarkup(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .join('\n');
}
