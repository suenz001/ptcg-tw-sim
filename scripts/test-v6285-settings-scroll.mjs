// v6.285 守衛：設定 modal 捲動修正（既有 bug，v3.884 起）／賽後「加好友」鈕改「未知也顯示」／設定 modal 尾端的「👥 好友」section。
//
// 守什麼（能求值就求值、能行為端就行為端；不比字面）：
//   【S】⭐⭐ CSS 級聯求值（不需要瀏覽器，CI 必跑）：把 <style> 區解析成規則（含 @media），對「.zoom-modal.settings-modal」
//        「.zoom-modal.discard-modal」「.zoom-modal.discard-modal.prize-view-modal」「.zoom-modal」四種元素，在五種 viewport
//        （375×812／375×667／1366×768／1536×864／1920×1080）各自依 (important, specificity, order) 算出**每個屬性的最終值**：
//        S1 設定 modal 的 overflow-y 最終值必須是 auto（BASE 是 hidden ⇒ HEAD-FAIL）；
//        S2 ⭐⭐ 其他三種 modal 的**全部屬性最終值**與「拿掉本版新增規則」的求值逐屬性全等（新規則對它們零影響）；
//        S3 設定 modal 除 overflow-y／-webkit-overflow-scrolling／overscroll-behavior 之外全等（本版沒有偷渡尺寸改動）；
//        S4 掃描器下限（規則數、命中 .zoom-modal 的規則數）＋ 正對照（把新規則改成 hidden ⇒ S1 紅；selector 改 .zoom-modal ⇒ S2 紅）。
//   【D】⭐ DOM 量測（有 Playwright 才跑；CI 沒有 ⇒ 醒目 SKIP，**不算綠**也不算紅——核心由【S】守）：
//        五種尺寸設定 modal 全部 section 展開後捲到底，最後一個 section 與其最後一個可操作元素落在內容區內且在畫面內；
//        其他三種 modal 在「拿掉新規則」vs「完整」兩份 CSS 下所有元素 rect／overflow／scrollHeight 全等。
//   【B】friends-api.ts 實跑（esbuild）：賽後鈕 未知 ⇒ 顯示（BASE 為 false ⇒ HEAD-FAIL）／確定不支援（404 HTML）⇒ 藏／
//        disabled ⇒ 藏／匿名 ⇒ 藏；且與大廳入口在 4 態 × 匿名兩組全等（同一條規則）；仍零 setInterval／setTimeout／rAF。
//   【C】game/+page.svelte 結構：好友 section 是設定 modal **最後一個** section、被 {#if friendsEntryOn} 包住、按鈕用同一組
//        狀態（addOpponentAsFriend／friendReqState）、連結新分頁；對戰版面分支區間零 friend；style 區零 friend。
//   【M】突變測試：每一條只捕 AssertionError，且紅在**預期那一條**。
//
// ⚠ 安慰劑型態逐一避開：不 pin 版本號／sha；斷言全部求值不比字面；只捕 AssertionError；掃描器有下限與正對照；
//   DOM 段拿不到瀏覽器時**大聲印 SKIP** 而不是靜默 PASS。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert';
import { extractCss, settingsMarkup, zoomModalFixtures, VIEWPORTS, pageHtml } from './lib/zoom-modal-fixture.mjs';

const esbuild = await import('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P_API = join(ROOT, 'src/lib/friends/friends-api.ts');
const P_GAME = join(ROOT, 'src/routes/game/+page.svelte');
const P_MPB = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');

let pass = 0, fail = 0, skipped = [];
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++; }
  catch (e) {
    if (e instanceof assert.AssertionError) { console.log('  FAIL ' + name + ' :: ' + e.message); fail++; }
    else throw e;
  }
};
const mutantMustBreak = async (name, run, expectFrag) => {
  let err = null;
  try { await run(); } catch (e) { if (e instanceof assert.AssertionError) err = e; else throw e; }
  assert.ok(err, '突變體「' + name + '」沒有讓任何斷言變紅 ⇒ 該斷言是安慰劑');
  assert.ok(String(err.message).includes(expectFrag), '突變體「' + name + '」紅在別條：' + err.message + '（預期含「' + expectFrag + '」）');
};

// ═══════════════════════════════════════════════════════════════════════════
// 迷你 CSS 級聯求值器（只為「單一元素自身的最終屬性值」而寫：純 class 複合選擇器＋@media；後代／偽類等 selector 不會命中元素自身）
function stripCssComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
/** 解析成 [{ media, selector, decls:[{prop,value,important}], order }] */
function parseRules(css) {
  const src = stripCssComments(css);
  const rules = []; let order = 0;
  const walk = (s, media) => {
    let i = 0;
    while (i < s.length) {
      const ob = s.indexOf('{', i);
      if (ob < 0) break;
      const prelude = s.slice(i, ob).trim();
      let d = 1, j = ob + 1;
      while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
      const body = s.slice(ob + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude.slice(6).trim());
      else if (prelude.startsWith('@')) { /* @keyframes 等：跳過 */ }
      else {
        const decls = body.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
          const k = x.indexOf(':'); if (k < 0) return null;
          let value = x.slice(k + 1).trim(); const important = /!important$/.test(value);
          if (important) value = value.replace(/\s*!important$/, '');
          return { prop: x.slice(0, k).trim().toLowerCase(), value, important };
        }).filter(Boolean);
        for (const sel of prelude.split(',').map((x) => x.trim()).filter(Boolean)) rules.push({ media, selector: sel, decls, order: order++ });
      }
      i = j;
    }
  };
  walk(src, null);
  return rules;
}
/** @media 在指定 viewport 下成不成立（只支援 width／orientation／hover／pointer；其餘視為不成立）。 */
function mediaMatches(media, vp) {
  if (!media) return true;
  return media.split(/\s+or\s+|,/).some((alt) => alt.split(/\s+and\s+/).every((q) => {
    const m = q.trim().match(/^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/);
    if (!m) return false;
    const [, k, v] = m; const px = parseFloat(v);
    if (k === 'max-width') return vp.w <= px;
    if (k === 'min-width') return vp.w >= px;
    if (k === 'max-height') return vp.h <= px;
    if (k === 'min-height') return vp.h >= px;
    if (k === 'orientation') return (vp.h >= vp.w ? 'portrait' : 'landscape') === v.trim();
    if (k === 'hover') return (vp.mobile ? 'none' : 'hover') === v.trim();
    if (k === 'pointer') return (vp.mobile ? 'coarse' : 'fine') === v.trim();
    return false;
  }));
}
/** selector 是否「命中元素自身」：只認純 class 複合（.a.b）；其他（後代／偽類／屬性／元素名）一律不命中。回傳 specificity 或 -1。 */
function selfMatch(selector, classes) {
  if (!/^(\.[\w-]+)+$/.test(selector)) return -1;
  const need = selector.slice(1).split('.');
  return need.every((c) => classes.has(c)) ? need.length : -1;
}
/** 對指定元素（class 集合）在指定 viewport 下算出每個屬性的最終值。 */
function cascade(rules, classes, vp) {
  const winner = new Map();   // prop → { value, important, spec, order }
  for (const r of rules) {
    if (!mediaMatches(r.media, vp)) continue;
    const spec = selfMatch(r.selector, classes);
    if (spec < 0) continue;
    for (const d of r.decls) {
      // overflow 簡寫展開成 overflow-x／overflow-y（本守衛只關心 overflow-y 的級聯）
      const props = d.prop === 'overflow' ? ['overflow-x', 'overflow-y'] : [d.prop];
      for (const p of props) {
        const cur = winner.get(p);
        const cand = { value: d.value, important: d.important, spec, order: r.order };
        if (!cur || (cand.important && !cur.important) || (cand.important === cur.important && (cand.spec > cur.spec || (cand.spec === cur.spec && cand.order >= cur.order)))) winner.set(p, cand);
      }
    }
  }
  const out = {};
  for (const [p, w] of [...winner].sort()) out[p] = w.value;
  return out;
}
const ELEMENTS = {
  settings: new Set(['zoom-modal', 'settings-modal']),
  discard: new Set(['zoom-modal', 'discard-modal']),
  prize: new Set(['zoom-modal', 'discard-modal', 'prize-view-modal']),
  zoom: new Set(['zoom-modal']),
};
const NEW_RULE_RE = /^\s*\.zoom-modal\.settings-modal\{[^}]*\}\s*$/m;   // 本版新增的那一條（一整行）
const SCROLL_PROPS = new Set(['overflow-y', '-webkit-overflow-scrolling', 'overscroll-behavior']);
function newRuleLine(css) { const m = css.match(NEW_RULE_RE); assert.ok(m, '找不到本版新增的 .zoom-modal.settings-modal 規則'); return m[0]; }
function withoutNewRule(css) { return css.replace(newRuleLine(css), ''); }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】前置');
let API = '', GAME = '', MPB = '', CSS = '';
await T('F0 檔案存在且沒被截斷；<style> 區抽得出來', () => {
  for (const p of [P_API, P_GAME, P_MPB]) assert.ok(existsSync(p), '缺 ' + p);
  API = readFileSync(P_API, 'utf8'); GAME = readFileSync(P_GAME, 'utf8'); MPB = readFileSync(P_MPB, 'utf8');
  assert.ok(GAME.length > 900000, 'game/+page.svelte 只有 ' + GAME.length + ' 字元 —— 被截斷？');
  CSS = extractCss(GAME);
  assert.ok(CSS.length > 100000, 'style 區只有 ' + CSS.length + ' 字元');
});
if (fail) { console.log('\n══ v6.285 設定 modal 捲動守衛：' + pass + ' PASS / ' + fail + ' FAIL（前置失敗，後續無法進行）══'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【S】CSS 級聯求值（不需要瀏覽器）');
function assertScannerFloor(css) {
  const rules = parseRules(css);
  assert.ok(rules.length > 500, '只解析到 ' + rules.length + ' 條規則 —— 解析器壞了？');
  const hits = rules.filter((r) => selfMatch(r.selector, ELEMENTS.settings) >= 0);
  assert.ok(hits.filter((r) => r.selector === '.zoom-modal').length >= 3, '命中 .zoom-modal 的規則少於 3 條（桌機／手機直式／手機橫式）：' + hits.filter((r) => r.selector === '.zoom-modal').length);
  assert.ok(hits.some((r) => r.selector === '.settings-modal' && r.media), '沒有手機 @media 區的 .settings-modal 規則 —— 掃描器盲點？');
  assert.ok(rules.some((r) => r.media && mediaMatches(r.media, VIEWPORTS[0]) && !mediaMatches(r.media, VIEWPORTS[2])), '@media 求值器分不出手機與桌機');
  return rules;
}
function assertSettingsScrollable(css) {
  const rules = parseRules(css);
  for (const vp of VIEWPORTS) {
    const v = cascade(rules, ELEMENTS.settings, vp);
    assert.strictEqual(v['overflow-y'], 'auto', `${vp.w}×${vp.h}：設定 modal 的 overflow-y 最終值是 ${v['overflow-y']}（不是 auto ⇒ 到 max-height 後被切掉且不能捲）`);
    assert.ok(v['max-height'] && v['max-height'] !== 'none', `${vp.w}×${vp.h}：設定 modal 沒有 max-height（捲動容器沒有上限 ⇒ 會超出畫面）：${v['max-height']}`);
  }
}
/** cssFull＝要驗的 CSS；cssStripped＝「沒有本版新規則」的基準（預設從 cssFull 拿掉那一條；突變體改了 selector 時由呼叫端給原 CSS 的基準）。 */
function assertOthersUntouched(cssFull, cssStripped = withoutNewRule(cssFull)) {
  const full = parseRules(cssFull), stripped = parseRules(cssStripped);
  for (const [name, classes] of Object.entries(ELEMENTS)) {
    for (const vp of VIEWPORTS) {
      const a = cascade(full, classes, vp), b = cascade(stripped, classes, vp);
      const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]);
      if (name === 'settings') {
        assert.deepStrictEqual(diff.filter((p) => !SCROLL_PROPS.has(p)), [], `${vp.w}×${vp.h}：設定 modal 除捲動三屬性外還有屬性被新規則改到：${diff.join(',')}`);
        assert.ok(diff.includes('overflow-y'), `${vp.w}×${vp.h}：新規則沒有改到設定 modal 的 overflow-y`);
      } else {
        assert.deepStrictEqual(diff, [], `⚠⚠ ${vp.w}×${vp.h}：${name} modal 被本版新增規則影響到：` + diff.map((p) => `${p} ${b[p]}→${a[p]}`).join('; '));
      }
    }
  }
}
await T('S0 掃描器下限：規則數 > 500、命中 .zoom-modal ≥ 3 條、手機 @media 的 .settings-modal 存在、@media 求值器分得出手機／桌機', () => { assertScannerFloor(CSS); });
await T('S1 ⭐⭐ 設定 modal 在五種 viewport 的 overflow-y 最終值都是 auto（BASE 為 hidden ⇒ 這一條必紅）、且有 max-height', () => assertSettingsScrollable(CSS));
await T('S2 ⭐⭐ 其他三種 zoom modal（discard／prize-view／zoom）在五種 viewport 的**全部屬性最終值**與「拿掉新規則」全等；設定 modal 只差捲動三屬性', () => assertOthersUntouched(CSS));
await T('S3 新規則只宣告 overflow-y／-webkit-overflow-scrolling／overscroll-behavior；.settings-modal 原規則四個屬性原樣（沒動尺寸）；新規則落在 .zoom-modal 之後', () => {
  const decls = parseRules(newRuleLine(CSS))[0].decls.map((d) => d.prop);
  assert.deepStrictEqual([...decls].sort(), [...SCROLL_PROPS].sort(), '新規則的屬性集合不對：' + decls.join(','));
  const orig = CSS.indexOf('  .settings-modal {\n    max-width: 500px;\n    max-height: 85vh;\n    padding: 2rem;\n    overflow-y: auto;\n    -webkit-overflow-scrolling: touch;\n  }');
  assert.ok(orig > 0, '.settings-modal 原規則（v4.930）被改動了');
  const zm = CSS.indexOf('.zoom-modal{ background:#1a2a1a');
  assert.ok(zm > 0 && CSS.search(NEW_RULE_RE) > zm, '新規則沒有放在桌機 .zoom-modal 規則之後');
});
await T('S4 正對照：新規則改成 overflow-y:hidden ⇒ S1 紅；selector 改成 .zoom-modal ⇒ S2 紅在 discard／prize／zoom 那條', async () => {
  const line = newRuleLine(CSS);
  await mutantMustBreak('hidden', () => assertSettingsScrollable(CSS.replace(line, line.replace('overflow-y:auto', 'overflow-y:hidden'))), '不是 auto');
  await mutantMustBreak('selector→.zoom-modal', () => assertOthersUntouched(CSS.replace(line, line.replace('.zoom-modal.settings-modal{', '.zoom-modal{')), withoutNewRule(CSS)), 'modal 被本版新增規則影響到');
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】DOM 量測（需要 Playwright；CI 沒有 ⇒ 醒目 SKIP）');
let chromium = null;
try { chromium = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium; } catch { chromium = null; }
if (!chromium) {
  skipped.push('【D】DOM 量測（沒有 playwright 模組）');
  console.log('  ⚠⚠ SKIP 【D】：這台機器沒有 Playwright，DOM 量測沒有跑（核心由【S】的 CSS 級聯求值守；沙盒證據見 scripts/measure-v6285-settings-scroll.mjs）');
} else {
  let browser = null;
  try { browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium-headless-shell', args: ['--no-sandbox'] }); }
  catch (e) { skipped.push('【D】DOM 量測（瀏覽器啟動失敗：' + String(e.message).split('\n')[0].slice(0, 80) + '）'); console.log('  ⚠⚠ SKIP 【D】：瀏覽器啟動失敗 —— ' + String(e.message).split('\n')[0].slice(0, 120)); }
  if (browser) {
    try {
      const settings = settingsMarkup(GAME);
      await T('D1 ⭐⭐ 五種尺寸：設定 modal 全部 section 展開後捲到底，最後一個 section 與其最後一個可操作元素都落在內容區內且在畫面內', async () => {
        for (const vp of VIEWPORTS) {
          const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
          const pg = await ctx.newPage();
          await pg.setContent(pageHtml(CSS, settings), { waitUntil: 'load' });
          const r = await pg.evaluate(() => {
            const m = document.querySelector('.settings-modal'); const cs = getComputedStyle(m);
            for (const d of m.querySelectorAll('details')) d.open = true;
            const rect = (el) => { const q = el.getBoundingClientRect(); return { y: +q.y.toFixed(1), b: +(q.y + q.height).toFixed(1) }; };
            const mr = m.getBoundingClientRect();
            const contentBottom = mr.y + mr.height - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
            m.scrollTop = 1e6;
            const last = m.querySelector('details.settings-section:last-of-type');
            const ctls = [...last.querySelectorAll('button, select, input, a')];
            return { ov: cs.overflowY, contentBottom: +contentBottom.toFixed(1), scrollH: m.scrollHeight, clientH: m.clientHeight, scrolled: m.scrollTop, title: last.querySelector('summary').textContent.trim(), last: rect(last), ctl: ctls.length ? rect(ctls[ctls.length - 1]) : null };
          });
          await ctx.close();
          const tag = `${vp.w}×${vp.h}`;
          assert.strictEqual(r.ov, 'auto', tag + '：DOM 上 overflow-y=' + r.ov);
          assert.ok(r.scrollH <= r.clientH || r.scrolled > 0, tag + '：內容溢出卻捲不動');
          assert.ok(r.last.b <= r.contentBottom + 0.6 && r.last.b <= vp.h, `${tag}：最後 section「${r.title}」bottom=${r.last.b} 超出內容底 ${r.contentBottom}／畫面 ${vp.h}`);
          assert.ok(r.ctl && r.ctl.b <= r.contentBottom + 0.6 && r.ctl.y >= 0, `${tag}：最後一個可操作元素 ${JSON.stringify(r.ctl)} 不在內容區內`);
          console.log(`      ${tag} overflow-y=${r.ov} scrollH=${r.scrollH} clientH=${r.clientH} 捲到底 scrollTop=${r.scrolled}；最後 section「${r.title}」bottom=${r.last.b} ≤ 內容底 ${r.contentBottom} ≤ 畫面 ${vp.h}；最後可操作元素 bottom=${r.ctl.b}`);
        }
      });
      await T('D2 ⭐⭐ 其他三種 zoom modal × 五種尺寸：「拿掉新規則」vs「完整 CSS」所有元素 rect／overflow-y／scrollHeight 全等', async () => {
        const stripped = withoutNewRule(CSS);
        for (const [name, html] of Object.entries(zoomModalFixtures())) {
          for (const vp of VIEWPORTS) {
            const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile });
            const pg = await ctx.newPage();
            const probe = async (css) => { await pg.setContent(pageHtml(css, html), { waitUntil: 'load' }); return pg.evaluate(() => { const o = {}; for (const el of document.querySelectorAll('[id]')) { const r = el.getBoundingClientRect(); o[el.id] = [+r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2), getComputedStyle(el).overflowY, el.scrollHeight, el.clientHeight]; } return o; }); };
            const a = await probe(stripped), b = await probe(CSS);
            await ctx.close();
            const ids = Object.keys(a);
            assert.ok(ids.length >= 15, name + '：fixture 只有 ' + ids.length + ' 個元素');
            const diff = ids.filter((id) => JSON.stringify(a[id]) !== JSON.stringify(b[id]));
            assert.deepStrictEqual(diff, [], `⚠⚠ ${name} ${vp.w}×${vp.h}：${diff.length} 個元素 rect 不同：` + diff.map((id) => id + ' ' + JSON.stringify(a[id]) + '→' + JSON.stringify(b[id])).join('; '));
            console.log(`      ${name.padEnd(8)} ${(vp.w + '×' + vp.h).padEnd(9)} ${ids.length} 個元素全等  modal=(${b['z-modal'].slice(0, 4).join(',')}) overflow-y=${b['z-modal'][4]}`);
          }
        }
      });
    } finally { await browser.close(); }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】friends-api.ts 行為端（賽後鈕顯示判定）');
const API_MARKER = "(((import.meta as unknown) as { env?: { VITE_ORACLE_API_URL?: string } }).env?.VITE_ORACLE_API_URL) || ''";
function makeLS() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; }
function loadApi(src, { apiUrl = 'http://t.local', ls = makeLS() } = {}) {
  assert.ok(src.includes(API_MARKER), 'friends-api.ts 的 apiBase() 不是預期的形狀 —— 注入點壞了');
  const js = esbuild.transformSync(src.replace(API_MARKER, JSON.stringify(apiUrl)), { loader: 'ts', format: 'cjs' }).code;
  const m = { exports: {} };
  return { ls, load: (fetchImpl) => { new Function('module', 'exports', 'fetch', 'localStorage', js)(m, m.exports, fetchImpl, ls); return m.exports; } };
}
const mkFetch = (respFn) => async (url, init) => respFn(url, init);
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) }, json: async () => body });
const htmlRes = (status) => ({ status, ok: false, headers: { get: () => 'text/html' }, json: async () => { throw new SyntaxError('x'); } });
const listBody = () => ({ friendsApi: 1, me: { uid: 'FU', nick: '我' }, friends: [], incoming: [], outgoing: [], blocked: [], limit: 100, truncated: false });
const CTX = { uid: 'FU', token: 'TOK' };
async function assertBattleVisibility(src) {
  // ① 未知（沒問過伺服器、沒有快取）⇒ 顯示
  const m1 = loadApi(src).load(mkFetch(() => jsonRes(200, listBody())));
  assert.strictEqual(m1.friendsAvailability('FU'), 'unknown', '前置：應是 unknown');
  assert.strictEqual(m1.friendsBattleEntryVisible('FU', false), true, '未知（沒問過伺服器）時賽後鈕沒顯示 —— 站長裁定「未知也顯示」');
  // ② 確定不支援（404 HTML ⇒ 負向快取）⇒ 藏（反向斷言：確定不支援時必須藏）
  const ls2 = makeLS();
  const m2 = loadApi(src, { ls: ls2 }).load(mkFetch(() => htmlRes(404)));
  await m2.fetchFriendsList(CTX);
  assert.strictEqual(m2.friendsAvailability('FU'), 'unsupported', '前置：404 HTML 應記 unsupported');
  assert.strictEqual(m2.friendsBattleEntryVisible('FU', false), false, '⚠ 確定不支援（負向快取）還顯示賽後鈕');
  const m2b = loadApi(src, { ls: ls2 }).load(mkFetch(() => jsonRes(200, listBody())));   // 重新整理後負向快取仍在
  assert.strictEqual(m2b.friendsBattleEntryVisible('FU', false), false, '⚠ 重新整理後負向快取沒有讓賽後鈕藏起來');
  // ③ 伺服器關閉（friends-disabled）⇒ 藏
  const m3 = loadApi(src).load(mkFetch(() => jsonRes(503, { code: 'friends-disabled', error: 'x' })));
  await m3.fetchFriendsList(CTX);
  assert.strictEqual(m3.friendsBattleEntryVisible('FU', false), false, '⚠ 伺服器關閉好友功能還顯示賽後鈕');
  // ④ 匿名／沒 uid ⇒ 藏（即使正向快取存在）
  const ls4 = makeLS(); ls4.setItem('ptcg_friends_avail:FU', JSON.stringify({ v: 'on', at: Date.now() }));
  const m4 = loadApi(src, { ls: ls4 }).load(mkFetch(() => jsonRes(200, listBody())));
  assert.strictEqual(m4.friendsBattleEntryVisible('FU', false), true, '前置：正向快取應顯示');
  assert.strictEqual(m4.friendsBattleEntryVisible('FU', true), false, '匿名還顯示賽後鈕');
  assert.strictEqual(m4.friendsBattleEntryVisible(null, false), false, '沒 uid 還顯示賽後鈕');
  assert.strictEqual(m4.friendsBattleEntryVisible('OTHER', false), true, '（別的 uid 是 unknown ⇒ 未知也顯示）');
  // ⑤ 與大廳入口同一條規則：4 態 × 匿名兩組全等
  for (const [tag, mk] of [['unknown', () => loadApi(src).load(mkFetch(() => jsonRes(200, listBody())))], ['on', () => { const ls = makeLS(); ls.setItem('ptcg_friends_avail:FU', JSON.stringify({ v: 'on', at: Date.now() })); return loadApi(src, { ls }).load(mkFetch(() => jsonRes(200, listBody()))); }], ['disabled', async () => { const m = loadApi(src).load(mkFetch(() => jsonRes(503, { code: 'friends-disabled', error: 'x' }))); await m.fetchFriendsList(CTX); return m; }], ['unsupported', async () => { const m = loadApi(src).load(mkFetch(() => htmlRes(404))); await m.fetchFriendsList(CTX); return m; }]]) {
    const m = await mk();
    assert.strictEqual(m.friendsAvailability('FU'), tag, '前置：' + tag);
    for (const anon of [false, true]) assert.strictEqual(m.friendsBattleEntryVisible('FU', anon), m.friendsEntryVisible('FU', anon), `賽後鈕與大廳入口在 ${tag}／anonymous=${anon} 不一致（兩套規則漂移）`);
  }
}
await T('B1 ⭐ 賽後鈕：未知 ⇒ 顯示（BASE 只認 on ⇒ 必紅）；確定不支援（404 HTML 負向快取，含重新整理後）⇒ 藏；disabled ⇒ 藏；匿名／沒 uid ⇒ 藏；與大廳入口 4 態×匿名全等', () => assertBattleVisibility(API));
await T('B2 賽後鈕判定是純函式：呼叫 200 次零請求', async () => {
  let calls = 0; const mod = loadApi(API).load(mkFetch(() => { calls++; return jsonRes(200, listBody()); }));
  for (let i = 0; i < 200; i++) { mod.friendsBattleEntryVisible('FU', false); mod.friendsEntryVisible('FU', false); }
  assert.strictEqual(calls, 0);
});
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'); }
await T('B3 friends-api.ts 仍零 setInterval／setTimeout／rAF、零 import（剝註解後數）', () => {
  const c = stripComments(API);
  for (const re of [/setInterval\s*\(/g, /setTimeout\s*\(/g, /requestAnimationFrame\s*\(/g, /^\s*import\s/gm]) assert.strictEqual((c.match(re) || []).length, 0, '出現 ' + re);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】game/+page.svelte 結構');
const BATTLE_START = '  {#if isPortraitMobile && game}\n';
const BATTLE_END = '{/if}<!-- /isPortraitMobile && playing -->';
function battleRegion(game) {
  const s = game.indexOf(BATTLE_START); const e = game.indexOf(BATTLE_END, s);
  assert.ok(s > 0 && e > s, '找不到對戰版面分支的起訖錨點');
  return { s, e: e + BATTLE_END.length, text: game.slice(s, e + BATTLE_END.length) };
}
function assertBattleRegionClean(game) {
  const r = battleRegion(game);
  assert.ok(r.text.length > 20000 && r.text.includes('<MobilePortraitBattle') && r.text.includes('{:else}'), '對戰版面區間抓錯');
  assert.strictEqual((r.text.match(/friend/gi) || []).length, 0, '⚠⚠ 對戰版面分支出現 friend 字樣');
}
function settingsBlock(game) {
  const s = game.indexOf('<!-- Settings Modal (Audio & BGM) -->');
  const e = game.indexOf('<!-- v4.60 對方提議 modal -->', s);
  assert.ok(s > 0 && e > s, '找不到設定 modal 錨點');
  return game.slice(s, e);
}
function assertFriendsSection(game) {
  const seg = settingsBlock(game);
  const secs = [...seg.matchAll(/<details class="settings-section"[^>]*>\s*<summary>([^<]*)<\/summary>/g)].map((m) => ({ title: m[1].trim(), idx: m.index }));
  assert.ok(secs.length >= 6, '設定 modal 只找到 ' + secs.length + ' 個 section');
  const last = secs[secs.length - 1];
  assert.strictEqual(last.title, '👥 好友', '好友 section 不是設定 modal 的最後一個 section（最後一個是「' + last.title + '」⇒ 既有 section 會被推）');
  const before = seg.slice(0, last.idx);
  assert.ok(/\{#if friendsEntryOn\}\s*$/.test(before), '好友 section 沒有被 {#if friendsEntryOn} 直接包住（匿名／確定不支援時要整段不渲染）');
  const secText = seg.slice(last.idx, seg.indexOf('</details>', last.idx));
  assert.ok(secText.includes('{#if friendsBattleOn && friendsBattleTarget}'), '「將對手加為好友」沒有沿用 friendsBattleOn && friendsBattleTarget 條件');
  assert.ok(/onclick=\{addOpponentAsFriend\}/.test(secText) && /friendReqState === 'busy' \|\| friendReqState === 'done'/.test(secText) && /\{friendReqMsg\}/.test(secText), '按鈕沒有共用賽後那組狀態（addOpponentAsFriend／friendReqState／friendReqMsg）');
  assert.ok(/<a class="toggle-btn"[^>]*href="\{base\}\/friends"[^>]*target="_blank"[^>]*rel="noopener"/.test(secText), '好友名單連結不是新分頁（對戰中換頁＝離開房間）');
  assert.strictEqual((secText.match(/<button/g) || []).length, 1, '好友 section 內按鈕數不是 1');
  const noCmt = (x) => x.replace(/<!--[\s\S]*?-->/g, '');   // 註解不算（section 上方那段說明含 friend 字樣）
  const friendsInSettings = (noCmt(seg).match(/friend/gi) || []).length;
  const friendsInSection = (noCmt(seg.slice(before.lastIndexOf('{#if friendsEntryOn}'))).match(/friend/gi) || []).length;
  assert.strictEqual(friendsInSettings, friendsInSection, '設定 modal 內有 friend 字樣落在好友 section 之外（' + (friendsInSettings - friendsInSection) + ' 處）');
}
await T('C1 ⭐ 好友 section 是設定 modal 最後一個 section、被 {#if friendsEntryOn} 包住、按鈕共用賽後那組狀態、連結新分頁、區塊內 friend 全落在 section 內', () => assertFriendsSection(GAME));
await T('C2 ⭐⭐ 手機／桌機兩套對戰版面分支區間零 `friend`（＋塞字正對照）；MobilePortraitBattle.svelte 零 friend', async () => {
  assertBattleRegionClean(GAME);
  const s = GAME.indexOf(BATTLE_START);
  await mutantMustBreak('塞 friend', () => assertBattleRegionClean(GAME.slice(0, s + BATTLE_START.length) + '<!-- friend -->' + GAME.slice(s + BATTLE_START.length)), 'friend 字樣');
  assert.strictEqual((MPB.match(/friend/gi) || []).length, 0, 'MobilePortraitBattle.svelte 出現 friend');
});
await T('C3 零新 CSS：style 區零 friend；設定 modal 區塊沒有 style 屬性以外的新 class（沿用 setting-row／toggle-btn／setting-hint）', () => {
  assert.strictEqual((CSS.match(/friend/gi) || []).length, 0, 'style 區出現 friend');
  const seg = settingsBlock(GAME);
  const sec = seg.slice(seg.lastIndexOf('{#if friendsEntryOn}'));
  const classes = new Set([...sec.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const known = new Set(['settings-section', 'setting-row', 'toggle-btn', 'setting-hint']);
  assert.deepStrictEqual([...classes].filter((c) => !known.has(c)), [], '好友 section 用了新 class：' + [...classes].filter((c) => !known.has(c)).join(','));
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【M】突變測試（每一條只捕 AssertionError，且要紅在預期那一條）');
const mutA = (a, b) => { assert.strictEqual(API.split(a).length - 1, 1, '突變錨點不唯一：' + a.slice(0, 60)); return API.replace(a, b); };
const mutG = (a, b) => { assert.strictEqual(GAME.split(a).length - 1, 1, '突變錨點不唯一：' + a.slice(0, 60)); return GAME.replace(a, b); };
await T('M1 突變：刪掉 .zoom-modal.settings-modal 規則（＝BASE）⇒ S1 紅', () =>
  mutantMustBreak('no-rule', () => assertSettingsScrollable(withoutNewRule(CSS)), '不是 auto'));
await T('M2 突變：新規則 selector 改成 .zoom-modal（波及其他 modal）⇒ S2 紅在 discard／prize／zoom', () => {
  const line = newRuleLine(CSS);
  return mutantMustBreak('selector', () => assertOthersUntouched(CSS.replace(line, line.replace('.zoom-modal.settings-modal{', '.zoom-modal{')), withoutNewRule(CSS)), 'modal 被本版新增規則影響到');
});
await T('M3 突變：新規則偷渡 max-width:500px ⇒ S2 紅在「除捲動三屬性外」那條', () => {
  const line = newRuleLine(CSS);
  return mutantMustBreak('max-width', () => assertOthersUntouched(CSS.replace(line, line.replace('overflow-y:auto;', 'overflow-y:auto; max-width:500px;'))), '除捲動三屬性外');
});
await T('M4 突變：賽後鈕判定改回只認 on（＝BASE）⇒ B1 紅在「未知」那條', () =>
  mutantMustBreak('only-on', () => assertBattleVisibility(mutA('  return friendsEntryVisible(uid, anonymous, now);\n}', "  if (anonymous || !uid) return false;\n  return friendsAvailability(uid, now) === 'on';\n}")), '未知（沒問過伺服器）時賽後鈕沒顯示'));
await T('M5 突變：賽後鈕不看匿名 ⇒ B1 紅在「匿名」那條', () =>
  mutantMustBreak('ignore-anon', () => assertBattleVisibility(mutA('  return friendsEntryVisible(uid, anonymous, now);\n}', '  return friendsEntryVisible(uid, false, now);\n}')), '匿名還顯示賽後鈕'));
await T('M6 突變：賽後鈕無視負向快取（unsupported 也顯示）⇒ B1 紅在「確定不支援」那條', () =>
  mutantMustBreak('ignore-neg', () => assertBattleVisibility(mutA('  return friendsEntryVisible(uid, anonymous, now);\n}', "  if (anonymous || !uid) return false;\n  return friendsAvailability(uid, now) !== 'disabled';\n}")), '確定不支援（負向快取）還顯示賽後鈕'));
await T('M7 突變：好友 section 搬到第一個 section 之前（推動既有 section）⇒ C1 紅', () => {
  const seg = settingsBlock(GAME);
  const s = seg.lastIndexOf('{#if friendsEntryOn}');
  const e = seg.indexOf('{/if}\n', seg.indexOf('</details>', s)) + '{/if}\n'.length;
  const block = seg.slice(s, e);
  const removed = seg.slice(0, s) + seg.slice(e);
  const at = removed.indexOf('<details class="settings-section">');
  const mutated = GAME.replace(seg, removed.slice(0, at) + block + removed.slice(at));
  return mutantMustBreak('section-first', () => assertFriendsSection(mutated), '不是設定 modal 的最後一個 section');
});
await T('M8 突變：好友名單連結拿掉 target="_blank" ⇒ C1 紅在「新分頁」那條', () =>
  mutantMustBreak('no-blank', () => assertFriendsSection(mutG('href="{base}/friends" target="_blank" rel="noopener" title="好友名單（新分頁）"', 'href="{base}/friends" title="好友名單"')), '不是新分頁'));
await T('M9 突變：設定裡的按鈕改用自己的狀態（不共用賽後那組）⇒ C1 紅', () =>
  mutantMustBreak('own-state', () => assertFriendsSection(mutG("            <button class=\"toggle-btn\" onclick={addOpponentAsFriend}", "            <button class=\"toggle-btn\" onclick={addOpponentAsFriend2}")), '沒有共用賽後那組狀態'));

console.log('\n══ v6.285 設定 modal 捲動守衛：' + pass + ' PASS / ' + fail + ' FAIL' + (skipped.length ? '；⚠⚠ SKIP ' + skipped.length + ' 段（' + skipped.join('；') + '）—— 這幾段在這台機器上沒有在守' : '') + ' ══');
process.exit(fail ? 1 : 0);
