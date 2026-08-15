// v6.195 守衛：跑馬燈（系統廣播 / 社群賽募集）的 ✕ 關閉鈕，可點區不得落在 iOS 安全區內。
//
// ⚠ 真因（v6.187 ~ v6.194）：
//   v6.187 把 .admin-broadcast-bar 改成 `padding-top:var(--safe-top)` + `height:calc(34px + var(--safe-top))`，
//   **整條 bar 讓開了動態島 → 跑馬燈文字看得到了**，但裡面那顆 ✕ 沒有一起改：
//     .admin-broadcast-close{ position:absolute; right:6px; top:50%; transform:translateY(-50%); 22×22 }
//   絕對定位的 top:50% 是相對**containing block 的 padding box**（= 整條 bar 的 34+59=93px），
//   ⇒ 圓心落在 46.5px、整顆(35.5px~57.5px)都在 iPhone 15 Pro 的 59px 安全區裡 ⇒ **按不到**。
//   （v6.187 之前整條 bar 都在安全區下，✕ 同樣按不到；v6.187 只是讓它「看得到卻按不到」。）
//
// ⚠ 本守衛不是比字串：內建 CSS 長度求值器（calc / min / max / var / 百分比 / translateY），
//   代入 --safe-top=59px 實際算出 ✕ 的可點矩形視窗座標再比對；並用 v6.194 的舊 CSS 當
//   內建 fixture 反證「偵測得出來」（IRON_RULES Rule 25：掃描器自身要先驗）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = process.env.V6195_ROOT || fileURLToPath(new URL('..', import.meta.url));
const GAME   = join(ROOT, 'src/routes/game/+page.svelte');
const LAYOUT = join(ROOT, 'src/routes/+layout.svelte');
const MPB    = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; } else { fail++; console.log('  ❌', t, extra); } };

// ── 剝註解＋自我驗證 ──────────────────────────────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
{
  const out = stripComments("a{c:red} /* .zz{top:1px} env(safe-area-inset-top) */ <!-- @media x --> b{d:2}");
  chk('自我驗證：剝註解拿得掉 CSS 註解（含註解裡的 env()）', !/\.zz/.test(out) && !/env\(safe-area/.test(out), out);
  chk('自我驗證：剝註解拿得掉 HTML 註解', !/@media/.test(out), out);
  chk('自我驗證：剝註解沒有誤刪正文', /a\{c:red\}/.test(out) && /b\{d:2\}/.test(out), out);
}

// ── CSS 長度求值器（calc / min / max / var / % ）＋自我驗證 ───────────
function splitTop(s, seps) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}
function evalExpr(src, vars) {
  const s = String(src).trim();
  if (!s) return null;
  let depth = 0, terms = [], cur = '', signs = [1];
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
  // 百分比：相對「containing block 高度」，由呼叫端用 vars['%base'] 明確帶入
  m = /^(-?\d+(?:\.\d+)?)%$/.exec(s);
  if (m) {
    if (!Object.prototype.hasOwnProperty.call(vars, '%base')) return null;
    return vars['%base'] * parseFloat(m[1]) / 100;
  }
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
  return null; // env(...) / auto / 50vh … → 不可求值
}
// transform:translateY(x) → 垂直位移；%base 為元素自身高度
function translateY(decl, selfH) {
  if (!decl) return 0;
  const m = /translateY\(\s*(-?\d+(?:\.\d+)?)(px|%)\s*\)/.exec(decl);
  if (!m) return 0;
  return m[2] === '%' ? selfH * parseFloat(m[1]) / 100 : parseFloat(m[1]);
}
{
  const V = { '--safe-top': 59, '--safe-bottom': 34, '--safe-left': 0, '--safe-right': 0 };
  chk('自我驗證：求值器 純 px', evalExpr('22px', V) === 22);
  chk('自我驗證：求值器 calc + var', evalExpr('calc(34px + var(--safe-top, 0px))', V) === 93);
  chk('自我驗證：求值器 min(a, var) — 本版新用法',
    evalExpr('calc(34px + min(10px, var(--safe-top, 0px)))', V) === 44);
  chk('自我驗證：求值器 min(a, var) 在安全區為 0 時退回 34（正對照的基礎）',
    evalExpr('calc(34px + min(10px, var(--safe-top, 0px)))', { ...V, '--safe-top': 0 }) === 34);
  chk('自我驗證：求值器 百分比要帶 %base 才算得出來',
    evalExpr('50%', V) === null && evalExpr('50%', { ...V, '%base': 93 }) === 46.5);
  chk('自我驗證：求值器 var fallback', evalExpr('var(--nope, 7px)', V) === 7);
  chk('自我驗證：求值器 對 env() 回 null（＝沒走單一來源就算不出來）',
    evalExpr('calc(1px + env(safe-area-inset-top, 0px))', V) === null);
  chk('自我驗證：translateY(-50%) 位移', translateY('translateY(-50%)', 22) === -11);
  chk('自我驗證：沒有 transform 時位移為 0', translateY(undefined, 22) === 0 && translateY('none', 22) === 0);
}

// ── 極小 CSS 規則解析器（含 ::before）＋自我驗證 ──────────────────────
function parseRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const k = d.indexOf(':');
      if (k < 0) continue;
      decls[d.slice(0, k).trim().toLowerCase()] = d.slice(k + 1).trim();
    }
    for (const sel of m[1].trim().split(',').map((x) => x.trim()).filter(Boolean)) out.push({ sel, decls, body: m[2] });
  }
  return out;
}
{
  const r = parseRules('@media (max-width: 600px){ .a{ top:1px } } .b::before{ content:"x"; top:50% }');
  chk('自我驗證：解析器抓得到 @media 內的規則', r.some((x) => x.sel === '.a' && x.decls.top === '1px'), JSON.stringify(r.map(x=>x.sel)));
  chk('自我驗證：解析器抓得到 ::before 偽元素規則', r.some((x) => x.sel === '.b::before' && x.decls.top === '50%'), JSON.stringify(r.map(x=>x.sel)));
}
// ⚠ 必須切在 <style> **標籤之後**，否則第一條規則的選擇器會黏上 "<style>" 而靜默漏掉
const styleOf = (file) => {
  const src = stripComments(readFileSync(file, 'utf8'));
  const m = [...src.matchAll(/<style[^>]*>/g)].pop();
  return m ? src.slice(m.index + m[0].length) : src;
};
{
  const first = parseRules(' .first{ position:fixed; top:0 } .second{ color:red }');
  chk('自我驗證：解析器抓得到第一條規則', first.some((x) => x.sel === '.first'), JSON.stringify(first.map(x=>x.sel)));
}

const IPHONE = { '--safe-top': 59, '--safe-bottom': 34, '--safe-left': 0, '--safe-right': 0 };
const ZERO   = { '--safe-top': 0,  '--safe-bottom': 0,  '--safe-left': 0, '--safe-right': 0 };

// ── 版面模型：算出 ✕ 的可點矩形（相對視窗上緣 / 右緣）───────────────────
//   bar：position:fixed; top:0; box-sizing:border-box → padding box = [0, height]
//   ✕ ：position:absolute → containing block = bar 的 padding box（高度 = bar height）
//   圓圈：::before（或 v6.194 的按鈕本體）→ containing block = 按鈕自己的 padding box
function geom(bar, btn, before, vars) {
  const barH = evalExpr(bar.decls.height ?? '', vars);
  const barPadTop = evalExpr(bar.decls['padding-top'] ?? '0', vars);
  if (barH === null || barPadTop === null) return null;
  const btnH = evalExpr(btn.decls.height ?? '', { ...vars, '%base': barH });
  const btnW = evalExpr(btn.decls.width ?? '', vars);
  let btnTop = evalExpr(btn.decls.top ?? '', { ...vars, '%base': barH });
  if (btnH === null || btnW === null || btnTop === null) return null;
  btnTop += translateY(btn.decls.transform, btnH);
  const btnRight = evalExpr(btn.decls.right ?? '0', vars);
  if (btnRight === null) return null;
  // 圓圈：沒有 ::before 時（v6.194）按鈕本體就是圓圈
  let dotH = btnH, dotCenter = btnTop + btnH / 2, dotRight = btnRight;
  if (before) {
    const h = evalExpr(before.decls.height ?? '', vars);
    let t = evalExpr(before.decls.top ?? '', { ...vars, '%base': btnH });
    const r = evalExpr(before.decls.right ?? '0', vars);
    if (h === null || t === null || r === null) return null;
    t += translateY(before.decls.transform, h);
    dotH = h; dotCenter = btnTop + t + h / 2; dotRight = btnRight + r;
  }
  return { barH, barPadTop, hitTop: btnTop, hitBottom: btnTop + btnH, hitH: btnH, hitW: btnW,
           hitRight: btnRight, dotH, dotCenter, dotRight };
}

// ═══ 內建 HEAD-FAIL fixture：v6.194 的舊 CSS 必須被判成「落在安全區內」═══
{
  const oldCss = `
    .admin-broadcast-bar{ position:fixed; top:0; box-sizing:border-box; padding-top:var(--safe-top, 0px);
      height:calc(34px + var(--safe-top, 0px)); overflow:hidden; }
    .admin-broadcast-close{ position:absolute; right:6px; top:50%; transform:translateY(-50%);
      width:22px; height:22px; }`;
  const rs = parseRules(oldCss);
  const g59 = geom(rs.find(r => r.sel === '.admin-broadcast-bar'), rs.find(r => r.sel === '.admin-broadcast-close'), null, IPHONE);
  chk('自我驗證(HEAD-FAIL 內建)：v6.194 舊 CSS 的 ✕ 可點區上緣算出 35.5px（< 59 ⇒ 整顆在動態島下）',
    g59 && g59.hitTop === 35.5 && g59.hitBottom === 57.5, JSON.stringify(g59));
  chk('自我驗證(HEAD-FAIL 內建)：v6.194 舊 CSS 的 ✕ 觸控區只有 22×22（< 44 Apple HIG）',
    g59 && g59.hitH === 22 && g59.hitW === 22, JSON.stringify(g59));
  const g0 = geom(rs.find(r => r.sel === '.admin-broadcast-bar'), rs.find(r => r.sel === '.admin-broadcast-close'), null, ZERO);
  chk('自我驗證(正對照基準)：v6.194 在 --safe-top:0 時圓心 17px、right 6px、bar 高 34px',
    g0 && g0.dotCenter === 17 && g0.dotRight === 6 && g0.barH === 34, JSON.stringify(g0));
}

// ═══ ① 核心：現行 CSS 的 ✕ 可點區必須完全在安全區之外，且 >= 44×44 ═══
const gameCss = styleOf(GAME);
const gameRules = parseRules(gameCss);
const findRule = (rules, sel) => rules.filter((r) => r.sel === sel).pop();
const bar    = findRule(gameRules, '.admin-broadcast-bar');
const btn    = findRule(gameRules, '.admin-broadcast-close');
const before = findRule(gameRules, '.admin-broadcast-close::before');
chk('① .admin-broadcast-bar 規則存在', !!bar);
chk('① .admin-broadcast-close 規則存在', !!btn);
if (bar && btn) {
  chk('① bar 仍是 position:fixed 貼上緣 + box-sizing:border-box + overflow:hidden',
    bar.decls.position === 'fixed' && evalExpr(bar.decls.top ?? '', ZERO) === 0
    && bar.decls['box-sizing'] === 'border-box' && bar.decls.overflow === 'hidden',
    JSON.stringify(bar.decls));
  chk('① ✕ 仍是 position:absolute（containing block = bar 的 padding box）', btn.decls.position === 'absolute', JSON.stringify(btn.decls.position));
  chk('① ✕ 沒有 pointer-events:none', (btn.decls['pointer-events'] ?? '') !== 'none');

  const g59 = geom(bar, btn, before, IPHONE);
  chk('①⭐ iPhone(--safe-top:59px)：✕ 可點區上緣必須 >= 59（完全不與動態島安全區重疊）',
    g59 && g59.hitTop >= 59, JSON.stringify(g59));
  chk('①⭐ iPhone：✕ 可點區至少 44×44（Apple HIG 最小觸控目標）',
    g59 && g59.hitH >= 44 && g59.hitW >= 44, JSON.stringify(g59));
  chk('①⭐ iPhone：✕ 可點區下緣不得超過 bar 的 padding box（bar 是 overflow:hidden，超出就被裁掉點不到）',
    g59 && g59.hitBottom <= g59.barH + 0.001, JSON.stringify(g59));
  chk('①⭐ iPhone：可見的 ✕ 圓圈中心也要在安全區之下', g59 && g59.dotCenter - g59.dotH / 2 >= 59, JSON.stringify(g59));

  // ② 正對照：--safe-top:0（電腦／Android／非瀏海機）版面必須與 v6.194 逐像素相同
  const g0 = geom(bar, btn, before, ZERO);
  chk('②⭐ 正對照：--safe-top:0 時 bar 高度仍是 34px（v6.194 原值，0 位移）', g0 && g0.barH === 34, JSON.stringify(g0));
  chk('②⭐ 正對照：--safe-top:0 時 ✕ 圓圈垂直中心仍是 17px（v6.194 原值）', g0 && g0.dotCenter === 17, JSON.stringify(g0));
  chk('②⭐ 正對照：--safe-top:0 時 ✕ 圓圈距右緣仍是 6px、直徑仍是 22px（v6.194 原值）',
    g0 && g0.dotRight === 6 && g0.dotH === 22, JSON.stringify(g0));
  chk('②⭐ 正對照：--safe-top:0 時 ✕ 可點區仍完整落在 bar 內（不被裁）',
    g0 && g0.hitTop >= 0 && g0.hitBottom <= g0.barH + 0.001, JSON.stringify(g0));
  chk('② 圓圈是由 ::before 畫、按鈕本體 font-size:0（避免畫出兩個 ✕）',
    !!before && /^0(px)?$/.test(btn.decls['font-size'] ?? '') && (before.decls.content ?? '').includes('✕'),
    JSON.stringify({ btn: btn.decls['font-size'], before: before && before.decls.content }));
}

// ═══ ③ template 端：✕ 還在、還接得到關閉動作 ═══════════════════════════
{
  const src = readFileSync(GAME, 'utf8');
  const m = /<button class="admin-broadcast-close"[\s\S]*?<\/button>/.exec(src);
  chk('③ template 仍有 .admin-broadcast-close 按鈕', !!m, 'gone?');
  if (m) {
    chk('③ ✕ 按鈕的 onclick 仍會把 broadcastMarquee 清空（＝真的關得掉）',
      /onclick=\{\(\)\s*=>\s*broadcastMarquee\s*=\s*''\}/.test(m[0]), m[0]);
    chk('③ ✕ 按鈕仍有 aria-label（按鈕本體 font-size:0 之後，輔助技術只剩它）',
      /aria-label="/.test(m[0]), m[0]);
  }
  chk('③ 跑馬燈本體（track）仍在 template 內', /class="admin-broadcast-track"/.test(src));
}

// ═══ ④ 枚舉守衛：全站貼邊 fixed 元素一律走單一來源，且零裸 env() ═══════
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.svelte')) out.push(p);
  }
  return out;
}
const SVELTE = walk(join(ROOT, 'src')).sort();
chk('④ 掃描器真的掃到檔案（掃不到＝全綠的盲點）', SVELTE.length >= 8, '找到 ' + SVELTE.length);
chk('④ 掃描範圍含 game/+page.svelte 與 MobilePortraitBattle.svelte',
  SVELTE.some(f => f.endsWith('game/+page.svelte')) && SVELTE.some(f => f.endsWith('MobilePortraitBattle.svelte')));
{
  let pinnedSeen = 0, kidChecked = 0;
  for (const f of SVELTE) {
    const rel = f.slice(ROOT.length).replace(/\\/g, '/');
    const isLayout = rel.endsWith('routes/+layout.svelte');
    const css = styleOf(f);
    const rules = parseRules(css);
    // ④-a 全站零裸 env(safe-area-inset-*)
    // ⚠ +layout.svelte **不是整檔豁免**：只有定義單一來源的那一段 @supports 可以出現 env()。
    //   （整檔豁免會讓 .beta-banner / .migration-banner 這種同檔案的貼邊元件永遠掃不到。）
    const cssForEnv = isLayout
      ? css.replace(/@supports\s*\(\s*padding-top:\s*env\(safe-area-inset-top\)\s*\)\s*\{[\s\S]*?\n  \}/, '')
      : css;
    if (isLayout) {
      chk('④a 自我驗證：+layout.svelte 的 @supports 單一來源區塊真的被切掉了（切不掉＝整檔豁免的假綠）',
        cssForEnv.length < css.length && !/--safe-top:\s*env\(/.test(cssForEnv),
        '切掉 ' + (css.length - cssForEnv.length) + ' 字元');
    }
    chk(`④a [${rel}] 不得再各自寫 env(safe-area-inset-*)（單一來源 = +layout.svelte :root 的 --safe-*）`,
      !/env\(safe-area-inset/.test(cssForEnv),
      (cssForEnv.match(/[^;{}]*env\(safe-area-inset[^;}]*/) || [''])[0].trim().slice(0, 120));

    // ④-b 貼邊 fixed 元素逐條求值
    for (const r of rules) {
      if (r.decls.position !== 'fixed') continue;
      const topPin = r.decls.top !== undefined ? evalExpr(r.decls.top, ZERO) : null;
      const botPin = r.decls.bottom !== undefined ? evalExpr(r.decls.bottom, ZERO) : null;
      const leftPin  = r.decls.left  !== undefined ? evalExpr(r.decls.left, ZERO)  : null;
      const rightPin = r.decls.right !== undefined ? evalExpr(r.decls.right, ZERO) : null;
      const all = JSON.stringify(r.decls);
      // 四邊都釘死（或 inset:0）＝ 全螢幕遮罩：內容由 flex 擺放，置中就不必讓開；
      // 靠上(flex-start)／靠下(flex-end) 就會頂到動態島／home indicator ⇒ 要讓開。
      const fullScreen = (topPin === 0 && botPin === 0 && leftPin === 0 && rightPin === 0)
        || /^0(px)?$/.test((r.decls.inset ?? '').trim());
      if (fullScreen) {
        const ai = (r.decls['align-items'] ?? '').trim();
        if (ai === 'flex-start') {
          pinnedSeen++;
          chk(`④b [${rel}] ${r.sel} 全螢幕遮罩且內容靠上（align-items:flex-start）→ 必須讀 var(--safe-top)`,
            /var\(--safe-top/.test(all), all.slice(0, 150));
        }
        if (ai === 'flex-end') {
          // ⚠ v6.195 審查子代理抓到：MobilePortraitBattle 的 .mp-sheet-overlay 就是這型
          //   —— 遮罩本身沒事，但**貼在下緣的那張 sheet** 的最後一顆鈕會壓在 home indicator 上。
          //   sheet 用命名慣例找（.xxx-overlay → .xxx）；找不到就直接紅（掃不到 ≠ 沒問題）。
          pinnedSeen++;
          const sheetSel = r.sel.replace(/-overlay$/, '');
          const sheet = rules.filter((k) => k.sel === sheetSel).pop();
          chk(`④b [${rel}] ${r.sel} 內容靠下 → 找得到對應的 sheet 規則 ${sheetSel}`, !!sheet, '命名慣例改了？');
          if (sheet) {
            const pb = sheet.decls['padding-bottom'] ?? splitTop(sheet.decls.padding ?? '', ' ').filter(Boolean)[2];
            chk(`④b [${rel}] ${sheetSel} 貼下緣 → padding-bottom 必須讀 var(--safe-bottom)（否則最後一顆鈕壓在 home indicator 上）`,
              /var\(--safe-bottom/.test(pb ?? ''), 'padding-bottom = ' + pb);
          }
        }
        continue;
      }
      const isTop = topPin !== null && topPin <= 64;
      const isBot = botPin !== null && botPin <= 100;
      if (!isTop && !isBot) continue;
      pinnedSeen++;
      // ⚠ 只看**真正把內容推開**的那幾個屬性。原本比對整條規則的 JSON，
      //   結果 `max-height:calc(100vh - var(--safe-top))` 這種與位置無關的宣告也算過（假綠）。
      const topProps = [r.decls.top, r.decls.padding, r.decls['padding-top'], r.decls.height, r.decls.inset].join(' ');
      const botProps = [r.decls.bottom, r.decls.padding, r.decls['padding-bottom'], r.decls.inset].join(' ');
      if (isTop) chk(`④b [${rel}] ${r.sel} 貼上緣(top=${topPin}) → top/padding-top/height 之一必須讀 var(--safe-top)`,
        /var\(--safe-top/.test(topProps), topProps.slice(0, 150));
      if (isBot) chk(`④b [${rel}] ${r.sel} 貼下緣(bottom=${botPin}) → bottom/padding-bottom 之一必須讀 var(--safe-bottom)`,
        /var\(--safe-bottom/.test(botProps), botProps.slice(0, 150));

      // ④-b2 ⭐⭐⭐ 通則化本版的 bug 型態：**容器讓開了，容器裡的按鈕沒讓開**。
      //   Svelte 的 CSS 是扁平 class 選擇器（不會寫成 `.bar .close`），所以用專案的命名慣例
      //   （`.admin-broadcast-bar` → 前綴 `.admin-broadcast`）找同族的 position:absolute 子元素，
      //   代入 --safe-top:59px 求出它的上緣，必須 >= 59。
      //   ⚠ 前綴至少要有一個 '-'（避免 `.tourn-toast` → `.tourn` 這種過寬前綴誤傷）。
      //   ⚠ 偽元素（::before/::after）的 containing block 是**它自己的宿主元素**、不是這條 bar，
      //     宿主已經在上面驗過了 ⇒ 跳過，否則會誤判。
      if (!isTop) continue;
      const segs = r.sel.replace(/^\./, '').split('-');
      if (segs.length < 2) continue;
      const prefix = '.' + segs.slice(0, -1).join('-');
      if (!prefix.includes('-')) continue;
      const barH = evalExpr(r.decls.height ?? '', IPHONE);
      for (const k of rules) {
        if (k.sel === r.sel || !k.sel.startsWith(prefix)) continue;
        if (k.decls.position !== 'absolute') continue;
        if (/::(before|after)/.test(k.sel)) continue;
        const kh = evalExpr(k.decls.height ?? '', { ...IPHONE, '%base': barH ?? 0 });
        let kt = evalExpr(k.decls.top ?? '', { ...IPHONE, '%base': barH ?? 0 });
        if (kt === null) continue;            // 沒有 top（靠 bottom 定位）→ 不在本檢查範圍
        kt += translateY(k.decls.transform, kh ?? 0);
        kidChecked++;
        chk(`④b2 [${rel}] ${r.sel} 內的 ${k.sel}（position:absolute）上緣必須 >= 59 —— 容器讓開了、裡面的鈕也要讓開`,
          kt >= 59, `算出 ${kt}（bar 高 ${barH}）`);
      }
    }
  }
  chk('④ 枚舉真的有掃到貼邊元素（v6.194 實測 19 條，掃到 0 條代表解析器壞了）', pinnedSeen >= 15, '掃到 ' + pinnedSeen + ' 條');
  chk('④b2 真的有掃到「貼邊容器內的 absolute 子元素」（掃到 0 個＝這條檢查空轉）', kidChecked >= 1, '掃到 ' + kidChecked + ' 個');
}
// ④-c 單一來源本體還在
{
  const layout = stripComments(readFileSync(LAYOUT, 'utf8'));
  chk('④c +layout.svelte 仍是唯一來源（:root 先 0px、env 只在 @supports 內覆寫）',
    /:global\(:root\)[\s\S]{0,200}--safe-top:\s*0px/.test(layout)
    && /@supports\s*\(\s*padding-top:\s*env\(safe-area-inset-top\)\s*\)/.test(layout));
}

// ═══ ⑤ 沒有新增 @media 當手機開關 ═══════════════════════════════════
{
  const nGame = (gameCss.match(/@media/g) || []).length;
  const nMpb  = (styleOf(MPB).match(/@media/g) || []).length;
  chk('⑤ game/+page.svelte 的 @media 數量沒有增加（v6.187 基準 19）', nGame <= 19, '實際 ' + nGame);
  chk('⑤ MobilePortraitBattle.svelte 仍然 0 個 @media（手機直式是獨立分支）', nMpb === 0, '實際 ' + nMpb);
}

console.log(`\nv6.195 marquee close tap target: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
