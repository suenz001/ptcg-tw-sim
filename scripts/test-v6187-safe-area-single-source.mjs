// v6.187 守衛：iOS 安全區（動態島／瀏海／home indicator）必須走**單一來源** --safe-*，
//   且「宣告對手棄權獲勝」紅鈕的可點區**不得落在安全區內**。
//
// ⚠ 真因（v6.186 以前）：
//   src/app.html 的 viewport meta 帶 viewport-fit=cover，加上 apple-mobile-web-app-capable=yes
//   與 status-bar-style=black-translucent ⇒ 玩家「加到主畫面」以 PWA 全螢幕開啟時，
//   網頁內容會延伸到動態島底下。而 .opp-inactive-banner 是 `position:fixed; top:0`
//   且 `padding: 10px 20px`（完全沒有 safe-area），整條橫幅高度僅約 41px，
//   全部落在 iPhone 15 Pro 的 59px 安全區內 ⇒ 那顆決定勝負的紅鈕**一格都按不到**。
//
// ⚠ 本守衛不是「比字串」：內建 CSS 長度求值器（calc / max / min / var 巢狀），
//   代入 --safe-top=59px 實際算出紅鈕可點區上緣的視窗座標再比對。
//   求值器與剝註解器都先自我驗證（IRON_RULES Rule 25：掃描器自身要先驗）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sectionInner, GAME_INLINE_STYLE } from './lib/strip-markup-sections.mjs';   // ⭐v6.320 中央 helper（護欄①～⑨）

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAYOUT = process.env.V6187_LAYOUT || join(ROOT, 'src/routes/+layout.svelte');
const GAME   = process.env.V6187_GAME   || join(ROOT, 'src/routes/game/+page.svelte');
const MPB    = process.env.V6187_MPB    || join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const APPHTML = join(ROOT, 'src/app.html');

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; } else { fail++; console.log('  ❌', t, extra); } };

// ── 剝註解（CSS + Svelte HTML 註解）＋自我驗證 ────────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
{
  const f = 'a{c:red} /* .zz{top:1px} */ <!-- @media x --> b{d:2}';
  const out = stripComments(f);
  chk('自我驗證：剝註解真的有拿掉 CSS 註解', !/\.zz/.test(out), out);
  chk('自我驗證：剝註解真的有拿掉 HTML 註解', !/@media/.test(out), out);
  chk('自我驗證：剝註解沒有誤刪正文', /a\{c:red\}/.test(out) && /b\{d:2\}/.test(out), out);
}

// ── CSS 長度求值器（支援 calc / max / min / var 巢狀）＋自我驗證 ──────────
function splitTop(s, seps) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
// 以頂層 +/- 切開後相加（CSS 規定 +/- 兩側必須有空白，這裡照規矩用 ' + ' / ' - '）
function evalExpr(src, vars) {
  const s = String(src).trim();
  if (!s) return null;
  let depth = 0, terms = [], cur = '', sign = 1, signs = [1];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (ch === '+' || ch === '-') && i > 0 && s[i - 1] === ' ' && s[i + 1] === ' ') {
      terms.push(cur); signs.push(ch === '+' ? 1 : -1); cur = ''; i++; continue;
    }
    cur += ch;
  }
  terms.push(cur);
  let total = 0;
  for (let i = 0; i < terms.length; i++) {
    const v = evalAtom(terms[i].trim(), vars);
    if (v === null) return null;
    total += signs[i] * v;
  }
  return total;
}
function evalAtom(s, vars) {
  if (s === '0') return 0;
  let m = /^(-?\d+(?:\.\d+)?)px$/.exec(s);
  if (m) return parseFloat(m[1]);
  m = /^calc\(([\s\S]*)\)$/.exec(s);
  if (m) return evalExpr(m[1], vars);
  m = /^(max|min)\(([\s\S]*)\)$/.exec(s);
  if (m) {
    const args = splitTop(m[2], ',').map((a) => evalExpr(a, vars));
    if (args.some((a) => a === null)) return null;
    return m[1] === 'max' ? Math.max(...args) : Math.min(...args);
  }
  m = /^var\(([\s\S]*)\)$/.exec(s);
  if (m) {
    const parts = splitTop(m[1], ',');
    const name = parts[0].trim();
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    if (parts.length > 1) return evalExpr(parts.slice(1).join(',').trim(), vars);
    return null;
  }
  return null; // 例如 env(...) / 50% / auto → 無法求值
}
{
  const V = { '--safe-top': 59, '--safe-bottom': 34, '--safe-left': 0, '--safe-right': 0 };
  chk('自我驗證：求值器 純 px', evalExpr('10px', V) === 10);
  chk('自我驗證：求值器 calc(a + var)', evalExpr('calc(10px + var(--safe-top, 0px))', V) === 69);
  chk('自我驗證：求值器 max(a, var)', evalExpr('max(20px, var(--safe-top, 0px))', V) === 59);
  chk('自我驗證：求值器 max(var + a, b)', evalExpr('max(var(--safe-bottom, 0px) + 60px, 70px)', V) === 94);
  chk('自我驗證：求值器 var fallback（變數未定義時走 fallback）',
    evalExpr('calc(10px + var(--nope, 7px))', V) === 17);
  chk('自我驗證：求值器 對 env() 回 null（＝不可求值，會被判為沒走單一來源）',
    evalExpr('calc(10px + env(safe-area-inset-top, 0px))', V) === null);
  chk('自我驗證：求值器 對 50% 回 null', evalExpr('50%', V) === null);
  chk('自我驗證：求值器 減法', evalExpr('calc(100px - 40px)', V) === 60);
}

// ── 極小 CSS 規則解析器（只取最內層 { } 區塊，at-rule prelude 自動被跳過）────
function parseRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const rawSel = m[1].trim();
    const decls = {};
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':');
      if (k < 0) continue;
      decls[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim();
    }
    for (const sel of rawSel.split(',').map((x) => x.trim()).filter(Boolean)) {
      out.push({ sel, decls, raw: m[2] });
    }
  }
  return out;
}
{
  const r = parseRules('@media (max-width: 600px) { .a { top: 1px } } .b{ bottom: 2px }');
  chk('自我驗證：解析器抓得到 @media 內的規則', r.some((x) => x.sel === '.a' && x.decls.top === '1px'), JSON.stringify(r));
  chk('自我驗證：解析器抓得到一般規則', r.some((x) => x.sel === '.b'), JSON.stringify(r));
}

// ⚠ 必須切在 <style> **標籤之後**：切在標籤之前的話，第一條規則的選擇器會變成
//   "<style>\n  .mp"，掃描器就會靜默漏掉整個檔案的第一條規則（＝掃不到就全綠的盲點）。
// ⭐v6.320：改走中央 helper sectionInner（v6.319 以前這裡自帶正則：抓不到 <style 就 `: src` **拿整檔當 CSS**（fail-open），
//   而且先對整檔剝 /* */ 再找最後一個 <style>）。現在抽不到 style 區段 ⇒ minSections:1 直接紅；區段被提前收尾／被註解吞掉 ⇒ 護欄⑧⑨紅。
//   CSS 註解仍在抽出的內文上剝（CSS 裡的 /* */ 語意就是註解）。
const styleOf = (file) => {
  const src = readFileSync(file, 'utf8');
  const allowResidual = /game[\\/]\+page\.svelte$/.test(file) ? [GAME_INLINE_STYLE] : [];
  return stripComments(sectionInner(src, 'style', { label: file, minSections: 1, allowResidual }));
};
{
  // 自我驗證：styleOf 必須抓得到 <style> 之後的**第一條**規則（曾因切在標籤前而漏掉）
  const fakeRules = parseRules('  .first { position: fixed; top: 0px }  .second { color: red }'
    .replace(/^/, ''));
  chk('自我驗證：解析器抓得到第一條規則', fakeRules.some((r) => r.sel === '.first'), JSON.stringify(fakeRules.map(r=>r.sel)));
}
const gameCss = styleOf(GAME);
const mpbCss  = styleOf(MPB);
const layoutSrc = stripComments(readFileSync(LAYOUT, 'utf8'));
const gameRules = parseRules(gameCss);
const mpbRules  = parseRules(mpbCss);
const findRule = (rules, sel) => rules.filter((r) => r.sel === sel).pop();

// ═══ 前提：viewport-fit=cover 真的存在（沒有它 env() 全是 0，整個問題不成立）═══
{
  const app = readFileSync(APPHTML, 'utf8');
  chk('前提：app.html 的 viewport meta 有 viewport-fit=cover', /viewport-fit\s*=\s*cover/.test(app));
  chk('前提：app.html 有 black-translucent 狀態列（PWA 全螢幕才會延伸到動態島下）',
    /apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/.test(app));
}

// ═══ ① 核心（求值）：紅鈕可點區不得與安全區重疊 ═══════════════════════════
// 版面模型：.opp-inactive-banner 是 position:fixed; top:0; display:flex; align-items:center。
//   內容盒上緣 = top + border-top + padding-top。
//   .opp-inactive-btn 的 min-height(44px) 是列中最高的項目 ⇒ 按鈕上緣 == 內容盒上緣。
const IPHONE_SAFE = { '--safe-top': 59, '--safe-bottom': 34, '--safe-left': 0, '--safe-right': 0 };
const ZERO_SAFE   = { '--safe-top': 0,  '--safe-bottom': 0,  '--safe-left': 0, '--safe-right': 0 };
function bannerContentTop(decls, vars) {
  const top = evalExpr(decls.top ?? '0', vars);
  const padTop = decls['padding-top'] !== undefined
    ? evalExpr(decls['padding-top'], vars)
    : (decls.padding !== undefined ? evalExpr(splitTop(decls.padding, ' ').filter(Boolean)[0], vars) : 0);
  const bw = decls['border-top-width'] !== undefined ? evalExpr(decls['border-top-width'], vars) : 0;
  if (top === null || padTop === null || bw === null) return null;
  return top + padTop + bw;
}
// 求值器自我驗證：拿 v6.186 的**舊 CSS** 當 fixture，必須算出「在安全區內」＝ HEAD-FAIL
{
  const oldDecls = { position: 'fixed', top: '0', padding: '10px 20px' };
  const oldTop = bannerContentTop(oldDecls, IPHONE_SAFE);
  chk('自我驗證(HEAD-FAIL 內建)：v6.186 舊 CSS 算出的鈕上緣必須 < 59（＝真的被動態島吃掉）',
    oldTop === 10, '算出 ' + oldTop);
}
{
  const r = findRule(gameRules, '.opp-inactive-banner');
  chk('① .opp-inactive-banner 規則存在', !!r);
  if (r) {
    chk('① 它仍是 position:fixed 貼齊上緣', r.decls.position === 'fixed' && evalExpr(r.decls.top ?? '', ZERO_SAFE) === 0,
      JSON.stringify(r.decls.top));
    const t59 = bannerContentTop(r.decls, IPHONE_SAFE);
    chk('①⭐ iPhone(--safe-top:59px)：紅鈕可點區上緣必須 >= 59（不與動態島安全區重疊）',
      t59 !== null && t59 >= 59, '算出 ' + t59);
    const t0 = bannerContentTop(r.decls, ZERO_SAFE);
    chk('② 正對照：--safe-top:0（非 iPhone）時上緣必須剛好 10px ＝ v6.186 原值，版面 0 位移',
      t0 === 10, '算出 ' + t0);
    // 左右安全區（橫放時的瀏海）也要讓開，且不得比原本的 20px 小
    const padL = evalExpr(splitTop(r.decls.padding ?? '', ' ').filter(Boolean)[3] ?? '', ZERO_SAFE);
    const padR = evalExpr(splitTop(r.decls.padding ?? '', ' ').filter(Boolean)[1] ?? '', ZERO_SAFE);
    chk('① 左右 padding 在無安全區時維持 20px（版面不變）', padL === 20 && padR === 20, `${padL}/${padR}`);
  }
  const b = findRule(gameRules, '.opp-inactive-btn');
  chk('① .opp-inactive-btn 存在', !!b);
  if (b) {
    const mh = evalExpr(b.decls['min-height'] ?? '', ZERO_SAFE);
    chk('① 紅鈕 min-height >= 44px（Apple HIG 最小觸控目標；也是上面版面模型的前提）',
      mh !== null && mh >= 44, '算出 ' + mh);
    chk('① 紅鈕沒有 pointer-events:none', (b.decls['pointer-events'] ?? '') !== 'none');
  }
}

// ═══ ② 單一來源：:root 先 0px、env() 只在 @supports 內覆寫 ═══════════════
{
  const rootIdx = layoutSrc.indexOf(':global(:root)');
  chk('② +layout.svelte 有定義全站唯一來源 :global(:root)', rootIdx >= 0);
  const rootBlock = rootIdx >= 0 ? layoutSrc.slice(rootIdx, layoutSrc.indexOf('}', rootIdx)) : '';
  for (const v of ['--safe-top', '--safe-bottom', '--safe-left', '--safe-right']) {
    chk(`② :root 無條件先宣告 ${v}: 0px（不支援 env() 的瀏覽器 fallback 為 0）`,
      new RegExp(v + '\\s*:\\s*0px').test(rootBlock), rootBlock.slice(0, 200));
  }
  const sup = /@supports\s*\(\s*padding-top\s*:\s*env\(safe-area-inset-top\)\s*\)\s*\{([\s\S]*?)\n  \}/.exec(layoutSrc);
  chk('② env() 覆寫必須包在 @supports 內（否則不支援的瀏覽器會 invalid-at-computed-value，連 10px 都掉）', !!sup);
  if (sup) {
    chk('② @supports 區塊裡覆寫 :root', sup[1].includes(':global(:root)'));
    for (const v of ['top', 'bottom', 'left', 'right']) {
      chk(`② @supports 內 --safe-${v} 讀 env(safe-area-inset-${v}, 0px)`,
        new RegExp('--safe-' + v + '\\s*:\\s*env\\(safe-area-inset-' + v + ',\\s*0px\\)').test(sup[1]));
    }
    chk('② @supports 必須出現在 :root 預設宣告之後（後者才蓋得掉前者）', layoutSrc.indexOf('@supports') > rootIdx);
  }
}

// ═══ ③ 其他貼邊元素也走同一個來源（逐條求值，不是抓關鍵字）═════════════
{
  const scan = (rules, label) => {
    for (const r of rules) {
      if (r.decls.position !== 'fixed') continue;
      const topPin = r.decls.top !== undefined ? evalExpr(r.decls.top, ZERO_SAFE) : null;
      const botPin = r.decls.bottom !== undefined ? evalExpr(r.decls.bottom, ZERO_SAFE) : null;
      const isTop = topPin !== null && topPin <= 64;
      const isBot = botPin !== null && botPin <= 100;
      if (!isTop && !isBot) continue;
      const all = JSON.stringify(r.decls);
      chk(`③ [${label}] ${r.sel} 貼邊(top=${topPin} bottom=${botPin}) 不可再寫裸 env(safe-area-inset-*)`,
        !/env\(safe-area-inset/.test(all), all.slice(0, 160));
      if (isTop) {
        chk(`③ [${label}] ${r.sel} 貼上緣 → 必須讀 var(--safe-top)`,
          /var\(--safe-top/.test(`${r.decls.top ?? ''} ${r.decls.padding ?? ''} ${r.decls['padding-top'] ?? ''} ${r.decls.height ?? ''}`),
          all.slice(0, 160));
      }
      if (isBot) {
        chk(`③ [${label}] ${r.sel} 貼下緣 → 必須讀 var(--safe-bottom)`,
          /var\(--safe-bottom/.test(`${r.decls.bottom ?? ''} ${r.decls.padding ?? ''} ${r.decls['padding-bottom'] ?? ''}`),
          all.slice(0, 160));
      }
    }
  };
  scan(gameRules, 'game');
  scan(mpbRules, 'mpb');
  // 這幾條是本版特別點名的，明確釘住（避免將來規則被刪掉導致掃描器「掃不到＝全綠」）
  for (const sel of ['.opp-inactive-banner', '.tourn-alert-banner', '.admin-broadcast-bar',
                     '.tourn-toast', '.tourn-idle-warn', '.admin-spy-banner']) {
    const r = findRule(gameRules, sel);
    chk(`③ 點名檢查：${sel} 存在且有 var(--safe-top)`, !!r && /var\(--safe-top/.test(JSON.stringify(r.decls)));
  }
  const mp = findRule(mpbRules, '.mp');
  chk('③ 手機直式主容器 .mp 改讀 var(--safe-*)（不再各自寫 env）',
    !!mp && /var\(--safe-top/.test(mp.decls['padding-top'] ?? '') && !/env\(safe-area-inset/.test(JSON.stringify(mp.decls)));
  // @media 內的覆寫（解析器會把它當獨立規則）— 手機那條 restart 提示條也要讓開
  chk('③ @media(<=768px) 的 .restart-waiting-strip 覆寫也走 var(--safe-top)',
    /\.restart-waiting-strip\s*\{\s*top:calc\(50px \+ var\(--safe-top/.test(gameCss), 'gone?');
}

// ═══ ④ 沒有新增 @media 當手機開關；紅鈕不會被同樣貼上緣的元件蓋住 ═══════
{
  const nGame = (gameCss.match(/@media/g) || []).length;
  const nMpb  = (mpbCss.match(/@media/g) || []).length;
  chk('④ game/+page.svelte 的 @media 數量沒有增加（v6.186 基準 19）', nGame <= 19, '實際 ' + nGame);
  chk('④ MobilePortraitBattle.svelte 仍然 0 個 @media（手機直式是獨立分支，不靠斷點）',
    nMpb === 0, '實際 ' + nMpb);

  const banner = findRule(gameRules, '.opp-inactive-banner');
  const zOf = (r) => parseInt(r?.decls['z-index'] ?? '', 10);
  const zBanner = zOf(banner);
  let worst = null;
  for (const r of gameRules) {
    if (r.sel === '.opp-inactive-banner') continue;
    if (r.decls.position !== 'fixed') continue;
    const t = r.decls.top !== undefined ? evalExpr(r.decls.top, ZERO_SAFE) : null;
    if (t === null || t > 64) continue;
    const z = zOf(r);
    if (!Number.isFinite(z)) continue;
    if (worst === null || z > worst.z) worst = { sel: r.sel, z };
  }
  chk('④ 紅鈕 banner 的 z-index 必須 >= 所有其他貼上緣的 fixed 元件（否則會被蓋住點不到）',
    Number.isFinite(zBanner) && (worst === null || zBanner >= worst.z),
    `banner=${zBanner} 最高的其他貼上緣元件=${worst ? worst.sel + '(' + worst.z + ')' : '無'}`);
  chk('④ banner 本身沒有 pointer-events:none', (banner?.decls['pointer-events'] ?? '') !== 'none');
}

console.log(`\nv6.187 safe-area single source: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
