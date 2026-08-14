// v6.186 守衛：手機直式「setup 階段對手戰鬥位卡背」與「playing 階段對手戰鬥位卡圖」尺寸必須一致，
//   且必須來自**同一條 CSS 規則**（單一來源），不是兩處各寫各的數字。
//
// ⚠ 真因（v6.185 以前）：
//   setup 的對手戰鬥位是 <div class="mp-active">、playing 是 <button class="mp-active">。
//   <button> 的 UA 預設 box-sizing 是 border-box、<div> 是 content-box，
//   同樣的 height:100% 讓 div 版的內容盒多出 padding 8px + border 4px = 12px，
//   裡面 height:100% 的卡背就跟著大一圈。
//   真實 Chrome 量到：卡背 118.53x164 vs 卡圖 105.98x148（高 +12px、寬 +12.5px）。
//
// ⚠ 本守衛不是「比字串」：內建一個 box-model 求值器，實際算出兩個階段的 (w,h) 再比對。
//   求值器自己先用 v6.185 的舊 CSS fixture 自我驗證，必須重現 Chrome 實測值，
//   否則直接 FAIL（避免「掃描器自己是錯的卻全綠」——IRON_RULES Rule 25）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MPB = process.env.MPB_FILE || join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const DESKTOP = join(ROOT, 'src/routes/game/+page.svelte');

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; } else { fail++; console.log('  ❌', t, extra); } };

// ── 註解剝除（CSS） ───────────────────────────────────────────────
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
// 自我驗證剝註解器：註解裡的東西不可以被算進去
{
  const f = 'a{color:red} /* @media (max-width:600px){} .mp-active img{height:1px} */ b{x:1}';
  const out = stripCssComments(f);
  chk('自我驗證：stripCssComments 有真的把註解拿掉', !/@media/.test(out) && !/height:1px/.test(out), out);
  chk('自我驗證：stripCssComments 沒有誤刪非註解', /a\{color:red\}/.test(out) && /b\{x:1\}/.test(out), out);
}

// ── 極小 CSS 解析器 + box-model 求值器 ────────────────────────────
function parseRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m, i = 0;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const decls = {};
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':');
      if (k < 0) continue;
      decls[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim();
    }
    for (const sel of sels) out.push({ sel, decls, order: i });
    i++;
  }
  return out;
}
// 支援 ".a", ".a.b", "tag", ".a tag", ".a .b"（後代組合子）
function parseCompound(part) {
  const tag = (part.match(/^[a-z][a-z0-9]*/) || [null])[0];
  const classes = [...part.matchAll(/\.([\w-]+)/g)].map(x => x[1]);
  return { tag, classes };
}
function matchCompound(el, c) {
  if (c.tag && c.tag !== el.tag) return false;
  return c.classes.every(cl => el.classes.includes(cl));
}
// el = {tag, classes, ancestors:[{tag,classes}...]}（由外到內）
function selectorMatches(sel, el) {
  if (/[>+~[\]:]/.test(sel)) return false;           // 不支援的組合子 → 視為不匹配（保守）
  const parts = sel.trim().split(/\s+/).map(parseCompound);
  const target = parts[parts.length - 1];
  if (!matchCompound(el, target)) return false;
  let idx = el.ancestors.length - 1;
  for (let p = parts.length - 2; p >= 0; p--) {
    let found = false;
    while (idx >= 0) { const a = el.ancestors[idx--]; if (matchCompound(a, parts[p])) { found = true; break; } }
    if (!found) return false;
  }
  return true;
}
function specificity(sel) {
  return [...sel.matchAll(/\.[\w-]+/g)].length * 10 + [...sel.matchAll(/(^|\s)[a-z][a-z0-9]*/g)].length;
}
// 回傳 {prop: {value, sel, order}}
function cascade(rules, el) {
  const winners = {};
  const scored = rules
    .filter(r => selectorMatches(r.sel, el))
    .map(r => ({ ...r, spec: specificity(r.sel) }))
    .sort((a, b) => (a.spec - b.spec) || (a.order - b.order));
  for (const r of scored) for (const [k, v] of Object.entries(r.decls)) winners[k] = { value: v, sel: r.sel, order: r.order };
  return winners;
}
const num = (v) => { const m = String(v).match(/(-?[\d.]+)px/); return m ? parseFloat(m[1]) : null; };
function edges(w, prop) {
  // 回傳 [TB, LR]
  const short = w[prop];
  let tb = 0, lr = 0;
  if (short) {
    const nums = [...String(short.value).matchAll(/(-?[\d.]+)px/g)].map(x => parseFloat(x[1]));
    if (prop === 'border') { tb = lr = nums.length ? nums[0] : 0; }
    else if (nums.length === 1) { tb = lr = nums[0]; }
    else if (nums.length >= 2) { tb = nums[0]; lr = nums[1]; }
  }
  return [tb, lr];
}
function resolveAspect(v, vars) {
  let s = String(v).trim();
  const vm = s.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  if (vm) s = (vars[vm[1]] ?? vm[2] ?? '').trim();
  const m = s.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (m) return parseFloat(m[1]) / parseFloat(m[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const UA_BORDER_BOX = new Set(['button', 'input', 'select', 'textarea']);
function boxSizing(w, tag) {
  return w['box-sizing'] ? w['box-sizing'].value : (UA_BORDER_BOX.has(tag) ? 'border-box' : 'content-box');
}

// 求值：給定 .mp-active-row 內容盒高 R，算出「戰鬥位卡面」外框 (w,h)
// intrinsicAr：img 沒宣告 aspect-ratio 時用的天然比例（實測 868x1212）
const IMG_INTRINSIC = 868 / 1212;
function evalActiveCardFace(css, phase) {
  const rules = parseRules(stripCssComments(css));
  const vars = {};
  for (const r of rules) if (r.sel === '.mp' ) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--')) vars[k] = v;

  const R = 160; // .mp-active-row 內容盒高（Chrome 實測：row 外框 168 - padding 8）
  const parentTag = phase === 'setup' ? 'div' : 'button';
  const parentEl = { tag: parentTag, classes: ['mp-active', 'mp-active-opp', 'mp-status-none'], ancestors: [{ tag: 'div', classes: ['mp'] }, { tag: 'div', classes: ['mp-active-row'] }] };
  const pw = cascade(rules, parentEl);
  const [pPadTB, pPadLR] = edges(pw, 'padding');
  const [pBdTB] = edges(pw, 'border');
  const pBs = boxSizing(pw, parentTag);
  const pHeightSpec = pw['height'] && pw['height'].value.trim() === '100%' ? R : null;
  if (pHeightSpec === null) throw new Error('.mp-active 沒有 height:100%，求值器前提不成立');
  const parentContentH = pBs === 'border-box' ? pHeightSpec - pPadTB * 2 - pBdTB * 2 : pHeightSpec;

  const anc = [{ tag: 'div', classes: ['mp'] }, { tag: 'div', classes: ['mp-active-row'] }, parentEl];
  const childEl = phase === 'setup'
    ? { tag: 'div', classes: ['mp-card-back', 'mp-active-card-back'], ancestors: anc }
    : { tag: 'img', classes: [], ancestors: anc };
  const cw = cascade(rules, childEl);
  const cBs = boxSizing(cw, childEl.tag);
  const [cPadTB, cPadLR] = edges(cw, 'padding');
  const [cBdTB, cBdLR] = edges(cw, 'border');
  if (!cw['height'] || cw['height'].value.trim() !== '100%') throw new Error(`${phase} 卡面沒有 height:100%`);
  const ar = cw['aspect-ratio'] ? resolveAspect(cw['aspect-ratio'].value, vars) : (childEl.tag === 'img' ? IMG_INTRINSIC : null);
  if (ar === null) throw new Error(`${phase} 卡面算不出長寬比`);

  let outerH, outerW;
  if (cBs === 'border-box') { outerH = parentContentH; outerW = outerH * ar; }
  else {
    const contentH = parentContentH;
    outerH = contentH + cPadTB * 2 + cBdTB * 2;
    outerW = contentH * ar + cPadLR * 2 + cBdLR * 2;
  }
  const maxW = cw['max-width'] ? num(cw['max-width'].value) : null;
  if (maxW !== null && outerW > maxW) outerW = maxW;

  return {
    w: +outerW.toFixed(2), h: +outerH.toFixed(2),
    parentBoxSizing: pBs, childBoxSizing: cBs,
    src: {
      height: cw['height'].sel, heightOrder: cw['height'].order,
      aspect: cw['aspect-ratio'] ? cw['aspect-ratio'].sel : '(intrinsic)',
      aspectOrder: cw['aspect-ratio'] ? cw['aspect-ratio'].order : -1,
    },
  };
}

// ── ① 求值器自我驗證：餵 v6.185 舊 CSS，必須重現 Chrome 實測值 ─────
const V6185_FIXTURE = `
.mp { box-sizing: border-box; }
.mp-active-row { flex: 1.2; min-height: 88px; max-height: 160px; display: flex; justify-content: center; padding: 4px 8px; }
.mp-active { display: flex; gap: 8px; align-items: center; border: 2px solid #3a3a3a; border-radius: 8px; padding: 4px; width: 100%; max-width: 380px; height: 100%; }
.mp-active img { height: 100%; width: auto; max-width: 120px; object-fit: contain; border-radius: 4px; flex-shrink: 0; }
.mp-card-back { border: 2px solid #1a1a1a; border-radius: 6px; display: flex; }
.mp-card-back.mp-active-card-back { height: 100%; aspect-ratio: 63/88; flex-shrink: 0; }
`;
{
  const s = evalActiveCardFace(V6185_FIXTURE, 'setup');
  const p = evalActiveCardFace(V6185_FIXTURE, 'playing');
  const near = (a, b) => Math.abs(a - b) <= 0.1;
  chk('自我驗證：求值器重現 Chrome 實測 setup 卡背 118.53x164',
      near(s.w, 118.55) && near(s.h, 164), JSON.stringify(s));
  chk('自我驗證：求值器重現 Chrome 實測 playing 卡圖 105.98x148',
      near(p.w, 105.99) && near(p.h, 148), JSON.stringify(p));
  chk('自我驗證：求值器抓得到 v6.185 的 div=content-box / button=border-box 差異',
      s.parentBoxSizing === 'content-box' && p.parentBoxSizing === 'border-box',
      `${s.parentBoxSizing} / ${p.parentBoxSizing}`);
  chk('自我驗證：v6.185 fixture 下兩階段尺寸「不」一致（守衛在舊版必 FAIL）',
      !(near(s.w, p.w) && near(s.h, p.h)), `${s.w}x${s.h} vs ${p.w}x${p.h}`);
}

// ── ② 真檔求值：兩階段尺寸必須一致 ───────────────────────────────
const src = readFileSync(MPB, 'utf8');
const style = src.slice(src.lastIndexOf('<style'));
let setupBox = null, playBox = null;
try {
  setupBox = evalActiveCardFace(style, 'setup');
  playBox = evalActiveCardFace(style, 'playing');
} catch (e) {
  chk('求值器能在真檔上跑完（前提沒被改掉）', false, e.message);
}
if (setupBox && playBox) {
  console.log(`  ℹ setup 卡背 ${setupBox.w}x${setupBox.h} / playing 卡圖 ${playBox.w}x${playBox.h}`);
  chk('⭐ setup 卡背與 playing 卡圖「實際求值」高度一致',
      Math.abs(setupBox.h - playBox.h) < 0.5, `${setupBox.h} vs ${playBox.h}`);
  chk('⭐ setup 卡背與 playing 卡圖「實際求值」寬度一致',
      Math.abs(setupBox.w - playBox.w) < 0.5, `${setupBox.w} vs ${playBox.w}`);
  // ③ 單一來源：height / aspect-ratio 必須由同一條規則提供
  // ⚠ 比的是「同一條規則區塊」(order)，不是同一個 selector 字串 —— selector list
  //   `.mp-active img, .mp-active .mp-active-card-back { ... }` 本來就是兩個 selector 共用一份宣告。
  chk('⭐ 兩階段的 height 來自同一條 CSS 規則區塊（單一來源，不是各寫各的）',
      setupBox.src.heightOrder === playBox.src.heightOrder,
      `${setupBox.src.height}(#${setupBox.src.heightOrder}) vs ${playBox.src.height}(#${playBox.src.heightOrder})`);
  chk('⭐ 兩階段的 aspect-ratio 來自同一條 CSS 規則區塊',
      setupBox.src.aspectOrder >= 0 && setupBox.src.aspectOrder === playBox.src.aspectOrder,
      `${setupBox.src.aspect}(#${setupBox.src.aspectOrder}) vs ${playBox.src.aspect}(#${playBox.src.aspectOrder})`);
  chk('⭐ 卡面長寬比讀 --mp-card-ar 變數（單一數字來源）',
      /aspect-ratio:\s*var\(\s*--mp-card-ar/.test(stripCssComments(style)));
  chk('⭐ 舊的「卡背自己一份尺寸」規則已移除',
      !/\.mp-card-back\.mp-active-card-back\s*\{[^}]*(height|aspect-ratio)/.test(stripCssComments(style)));
}

// ── ④ 家族守衛：同一 class 同時用在 <button> 與非 button 且有幾何宣告者，必須明寫 box-sizing ──
{
  const markup = src.slice(0, src.lastIndexOf('<style'));
  const cssNoCmt = stripCssComments(style);
  const tagsOf = new Map();
  for (const m of markup.matchAll(/<(div|span|button|section|footer|header|label|a)\b([^>]*)>/g)) {
    const tag = m[1];
    for (const c of (m[2].match(/class="([^"]*)"/) || ['', ''])[1].replace(/\{[^}]*\}/g, '').split(/\s+/)) {
      if (!c.startsWith('mp-')) continue;
      if (!tagsOf.has(c)) tagsOf.set(c, new Set());
      tagsOf.get(c).add(tag);
    }
  }
  const mixed = [...tagsOf.entries()].filter(([, s]) => s.has('button') && [...s].some(t => t !== 'button')).map(([c]) => c);
  chk('家族掃描：有掃到 div/button 混用的 class（掃描器沒空轉）', mixed.length >= 3, mixed.join(','));
  for (const c of mixed) {
    const rules = cssNoCmt.split('}').filter(r => new RegExp('\\.' + c + '(?![\\w-])').test(r.split('{')[0] || ''));
    const joined = rules.join('}');
    const hasGeom = /(^|[;{\s])(width|height|padding|border)\s*:/.test(joined);
    if (!hasGeom) continue;
    chk(`⭐ .${c} 同時用在 <button> 與 <${[...tagsOf.get(c)].filter(t => t !== 'button')[0]}> 且有幾何宣告 → 必須明寫 box-sizing`,
        /box-sizing\s*:/.test(joined), joined.replace(/\s+/g, ' ').slice(0, 120));
  }
  chk('⭐ .mp-card-back 也明寫 box-sizing（邊框要算進 aspect-ratio 的盒）',
      /\.mp-card-back\s*\{[^}]*box-sizing/.test(cssNoCmt));
}

// ── ⑤ 桌機正對照：桌機完全不吃這些 class（改手機不可能影響桌機） ──
{
  const dsk = readFileSync(DESKTOP, 'utf8');
  for (const c of ['mp-active', 'mp-card-back', 'mp-active-card-back', 'mp-slot', 'mp-hand-card', 'mp-chip']) {
    chk(`桌機 +page.svelte 沒有用到 .${c}（手機改動不會外溢）`,
        !new RegExp('class="[^"]*\\b' + c + '\\b').test(dsk) && !new RegExp('\\.' + c + '(?![\\w-])\\s*[,{]').test(dsk));
  }
}

// ── ⑥ 禁止用 @media 當手機開關（手機/桌機是兩套獨立分支） ──────────
{
  const cssNoCmt = stripCssComments(style);
  const medias = [...cssNoCmt.matchAll(/@media[^{]*/g)].map(m => m[0]);
  const breakpointSwitches = medias.filter(m => /(max|min)-width/.test(m));
  chk('⭐ MobilePortraitBattle 沒有用 @media 斷點當手機開關', breakpointSwitches.length === 0, breakpointSwitches.join(' | '));
}

console.log(`test-v6186-mobile-card-size-single-source: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
