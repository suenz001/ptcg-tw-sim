// v6.264 守衛：首頁「版本更新記錄」較舊條目的補充說明改為**展開時才取得**。
//
// 為什麼要做這件事（結構性的、擋路的）：
//   static/changelog.html 是**每次開啟首頁都會整份 fetch** 的片段，固定 50 則、
//   每出一版「進一則、擠掉最舊一則」。但新條目普遍比被擠掉的舊條目長，於是它只會單向長大：
//   到 v6.263 已達 61,436 bytes，距離既有守衛的 60KB（61,440 bytes）上限只剩 **4 bytes**
//   —— 下一則必爆，任何版本都推不上去。其中「展開才看得到」的補充說明佔了 40,729 bytes（66%）。
//   站長裁定：「首頁只載最新 N 則，其餘展開才拓」。
//
// 新結構（N = 12）：
//   ・static/changelog.html        最新 12 則含完整內文；更舊的 38 則只留標題，details 帶 data-ver
//   ・static/changelog-bodies.html 那 38 則的內文（片段，**不預快取**，展開才 fetch，整份只抓一次）
//   ・static/changelog-archive.html 完整歷史（一則都不可少）
//
// 本守衛刻意**不只驗字串**（v6.154 教訓：只驗「某字串存在」擋不住「接線根本沒接上」）：
//   【C】把 +page.svelte 裡的 loadChangelogBodies／onChangelogToggle **抽出來真的執行**在假 DOM 上，
//        而且 addEventListener 的**捕獲旗標是從原始碼讀出來的**（toggle 不冒泡，寫成 false 就永遠不會觸發）。
//   【D】把 src/service-worker.ts **打包後真的 dispatch install**，斷言 bodies 檔沒有被預快取，
//        並模擬「首次安裝／版本更新／離線」三種情境。
//   【E】六個突變測試，每一個都必須紅在指定的那一條（沒紅就代表守衛是安慰劑）。
import { build, transform } from 'esbuild';
import { readFileSync, existsSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'v6264-'));
// ⭐v6.265 起【F】改成**每一版都適用**的搬運守衛（原本寫死 v6.263/v6.264，出下一版就必紅）：
//   BASE 一律指向**上一版**，斷言改成「首頁只多了最新那一則、封存頁只多了最舊那一則」。
//   ⚠ 出新版時只要把這個 sha 換成上一版的 sha 即可，其餘一律不動。
// ⚠ 出新版搬運 changelog 時，這個 pin 要跟著前移到「上一版」（v6.267 已這樣做過一次）。
//   v6.270 補記：CI 淺複製與沙盒 git archive 都沒有歷史 ⇒ 這一節只在「有完整歷史的環境」
//   才真的在守；結構不變量與突變測試（history-free）才是 CI 上的主守備面。
// ⚠ v6.275 補課：v6.271~v6.274 出版時都忘了前移這個 pin ⇒ 在有完整歷史的環境 F1 會誤紅
//   （BASE 裡沒有 v6.271~v6.273 的條目）。自 v6.275 起：**不動 changelog 的版本**（admin-only）
//   由下方的 F0 短路涵蓋（三檔與 BASE 逐位元相同即無損成立），pin 只需在**動了 changelog**
//   的版本前移到上一版。
const BASE_SHA = '8ccf12552106b4eaebe31d7690c9bcc014be11e5'; // v6.283（v6.284 的前一版；v6.284 動了 changelog ⇒ 依上方規則前移）
const N_INLINE = 12;   // 首頁內嵌完整內文的則數（站長裁定的「最新 N 則」）

let pass = 0, fail = 0;
const T = async (n, fn) => {
  try { await fn(); console.log('  OK  ', n); pass++; }
  // ⚠ 只捕捉 AssertionError：其他例外（打錯字、模組壞掉）必須直接炸掉，不可被守衛吞成 FAIL 一行
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};

const P_HOME = join(ROOT, 'static/changelog.html');
const P_BODIES = join(ROOT, 'static/changelog-bodies.html');
const P_ARC = join(ROOT, 'static/changelog-archive.html');
const P_PAGE = join(ROOT, 'src/routes/+page.svelte');
const P_LIB = join(ROOT, 'src/lib/changelog-lazy.ts');
const P_SW = join(ROOT, 'src/service-worker.ts');

const HOME = readFileSync(P_HOME, 'utf8');
const readOr = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const BODIES = readOr(P_BODIES);
const LIB_SRC = readOr(P_LIB);   // 檔案不存在時給空字串，讓下面每一條各自紅，而不是整支崩掉
const ARC = readFileSync(P_ARC, 'utf8');
const PAGE = readFileSync(P_PAGE, 'utf8');
const SW = readFileSync(P_SW, 'utf8');

// ── 共用切割器（先自我驗證，Rule 25：掃描器自己要先被驗過）─────────────────────
function splitEntries(html) {
  const parts = html.split(/(?=<details\b)/);
  // ⚠ V8 的 String.prototype.split 遇到「位置 0 的零寬比對」不會切出前導空字串，
  //   所以只有在 parts[0] 真的不是條目時才能 shift（第一版就是這樣少算了一則）。
  const head = /^<details\b/.test(parts[0]) ? '' : parts.shift();
  const out = [];
  for (const raw of parts) {
    const k = raw.lastIndexOf('</details>') + '</details>'.length;
    const text = raw.slice(0, k);
    const m = /ver-badge">(v[\d.]+)</.exec(text);
    out.push({ ver: m ? m[1] : null, text, hasBody: text.includes('class="log-body"'),
               dataVer: (/^<details[^>]*\sdata-ver="([^"]*)"/.exec(text) || [])[1] ?? null,
               open: /^<details\s+open>/.test(text) });
  }
  return { head, entries: out };
}
const home = splitEntries(HOME);
const arc = splitEntries(ARC);

console.log('【0】掃描器自我驗證');
await T('0-1 切割器抓得到 50 則、每則都有版本徽章（抓不到就代表下面全部是假綠）', () => {
  assert.strictEqual(home.entries.length, 50, '首頁切出 ' + home.entries.length + ' 則');
  assert.ok(home.entries.every((e) => e.ver), '有條目抓不到版本徽章');
});
await T('0-2 切割器對「人工植入的壞樣本」會判錯（正對照：判準真的在看東西）', () => {
  const probe = splitEntries('<details data-ver="v9.999">\n<summary><span class="ver-badge">v9.999</span> x</summary>\n</details>');
  assert.strictEqual(probe.entries.length, 1);
  assert.strictEqual(probe.entries[0].dataVer, 'v9.999');
  assert.strictEqual(probe.entries[0].hasBody, false);
  const probe2 = splitEntries('<details>\n<summary><span class="ver-badge">v9.998</span> x</summary>\n<div class="log-body">y</div>\n</details>');
  assert.strictEqual(probe2.entries[0].hasBody, true, '有內文卻被判成沒有 → 掃描器壞了');
  assert.strictEqual(probe2.entries[0].dataVer, null);
});

// ─────────────────────────────【A】結構不變量 ─────────────────────────────
console.log('【A】新結構的不變量（history-free，淺複製下照樣在守）');
const inline = home.entries.filter((e) => e.hasBody);
const lazy = home.entries.filter((e) => !e.hasBody);

await T('A1 首頁恰 50 則、恰 1 則預設展開（沿用 v6.223 的不變量，未放寬）', () => {
  assert.strictEqual(home.entries.length, 50);
  assert.strictEqual(home.entries.filter((e) => e.open).length, 1);
});
await T(`A2 恰 ${N_INLINE} 則內嵌內文，而且就是**最前面**那 ${N_INLINE} 則（順序不可亂）`, () => {
  assert.strictEqual(inline.length, N_INLINE, '內嵌內文 ' + inline.length + ' 則');
  for (let i = 0; i < home.entries.length; i++) {
    assert.strictEqual(home.entries[i].hasBody, i < N_INLINE,
      `第 ${i + 1} 則（${home.entries[i].ver}）的內文位置不對 —— 內嵌的必須是最新的連續 ${N_INLINE} 則`);
  }
  assert.ok(home.entries[0].open && home.entries[0].hasBody, '預設展開的那一則必須內嵌內文（否則一進站就要 fetch）');
});
await T('A3 內嵌的那幾則不得有 data-ver；懶載入的每一則 data-ver 必須等於自己的版本徽章', () => {
  for (const e of inline) assert.strictEqual(e.dataVer, null, e.ver + ' 內嵌內文卻還帶 data-ver（會被當成要再抓一次）');
  assert.strictEqual(lazy.length, 50 - N_INLINE);
  for (const e of lazy) assert.strictEqual(e.dataVer, e.ver, e.ver + ' 的 data-ver 是 ' + e.dataVer);
});
const bodyMap = new Map();
for (const m of BODIES.matchAll(/<div class="log-body" data-ver="(v[\d.]+)">([\s\S]*?)<\/div>/g)) bodyMap.set(m[1], m[2]);
await T('A4 bodies 檔與首頁「懶載入那 38 則」**雙向**一一對應（多一則少一則都紅）', () => {
  assert.ok(existsSync(P_BODIES), 'static/changelog-bodies.html 必須存在');
  const want = lazy.map((e) => e.ver).sort();
  const got = [...bodyMap.keys()].sort();
  assert.deepStrictEqual(got, want,
    '差集：首頁有而 bodies 沒有 = [' + want.filter((v) => !bodyMap.has(v)).join(',') + ']；'
    + 'bodies 有而首頁沒有 = [' + got.filter((v) => !want.includes(v)).join(',') + ']'
    + '\n      ⇒ 出新版的搬運順序：①新條目連內文寫進 changelog.html 最上面 '
    + '②把第 ' + (N_INLINE + 1) + ' 則的內文搬進 changelog-bodies.html 最上面（details 補 data-ver）'
    + '③最舊一則（標題＋內文合起來）搬進 changelog-archive.html');
  for (const [v, b] of bodyMap) assert.ok(b.trim().length > 10, v + ' 的內文是空的');
});
await T('A5 內文不得含巢狀 div（pickChangelogBody 抓到第一個結束標籤為止，巢狀會被截斷）', () => {
  for (const [v, b] of bodyMap) assert.ok(!b.includes('<div'), v + ' 的內文含巢狀 div');
  for (const e of inline) {
    const inner = /<div class="log-body">([\s\S]*?)<\/div>/.exec(e.text);
    assert.ok(inner, e.ver + ' 內嵌內文抓不出來');
    assert.ok(!inner[1].includes('<div'), e.ver + ' 內嵌內文含巢狀 div');
  }
});
await T('A6 首頁片段 < 40KB（把 v6.100 的 60KB 上限**收緊**；40 < 60 ⇒ 嚴格更緊，不是放寬）', () => {
  const bytes = statSync(P_HOME).size;
  assert.ok(bytes < 40 * 1024, '實際 ' + (bytes / 1024).toFixed(1) + 'KB');
  assert.ok(bytes > 8 * 1024, '只有 ' + bytes + ' bytes → 檔案疑似被截斷，上面的檢查不可信');
});
await T('A7 封存頁一則都不可少：≥ 324 則、≥ 首頁則數、且仍是可直接開啟的完整頁面', () => {
  assert.ok(/^<!DOCTYPE html>/i.test(ARC.trim()), '封存頁必須是完整 HTML');
  assert.ok(arc.entries.length >= 324, '封存頁只有 ' + arc.entries.length + ' 則（v6.263 當下是 324 則，只能增不能減）');
  assert.ok(arc.entries.length >= home.entries.length);
  // ⚠ 封存頁更早的條目有些用 ul 列表而不是 log-body，所以不能斷言「每則都有 log-body」；
  //   真正的不變量是「自給自足」——封存頁是獨立頁面、不會去抓 bodies 檔，所以不得出現 data-ver。
  assert.ok(arc.entries.every((e) => e.dataVer === null),
    '封存頁出現帶 data-ver 的條目：' + arc.entries.filter((e) => e.dataVer).map((e) => e.ver).join(',')
    + ' —— 封存頁沒有那段 JS，內文會永遠是空的');
  assert.ok(arc.entries.every((e) => /<summary>[\s\S]*<\/summary>/.test(e.text)), '封存頁有條目缺 summary');
  // ⚠ 更早的封存條目把說明整段寫在 summary 裡（沒有 log-body），所以只能用「整體不得被掏空」把關。
  assert.ok(statSync(P_ARC).size > 200 * 1024,
    '封存頁只剩 ' + (statSync(P_ARC).size / 1024).toFixed(0) + 'KB（v6.263 當下是 218KB）—— 歷史疑似被刪掉');
});
await T('A8 bodies 檔是**片段**（不是完整 HTML 頁面）—— 它要被注入首頁，吃的是首頁的樣式', () => {
  assert.ok(!/<!DOCTYPE/i.test(BODIES) && !/<html/i.test(BODIES), 'bodies 檔不該是完整頁面');
  const classes = new Set([...BODIES.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/)));
  assert.ok(classes.size >= 1, 'bodies 檔掃不到任何 class → 檔案不存在或掃描器失效（空集合的「全部通過」是假綠）');
  for (const c of classes) {
    assert.ok(PAGE.includes(':global(.' + c + ')'),
      'bodies 檔用了 class="' + c + '" 但首頁沒有 :global(.' + c + ') 規則（v6.133 教訓：注入的 HTML 吃不到 scoped CSS）');
  }
});

// ─────────────────── 【B】lib 純函式：真的執行（不是看字串）───────────────────
console.log('【B】pickChangelogBody / isValidChangelogVer 行為');
async function loadLib(sourceText = LIB_SRC, tag = 'lib') {
  if (!sourceText) return {};   // 檔案不存在 ⇒ 回空物件，由各條斷言自己紅
  const entry = join(TMP, `changelog-lazy-${tag}.ts`);
  writeFileSync(entry, sourceText);
  const out = join(TMP, `changelog-lazy-${tag}.mjs`);
  await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'neutral', target: 'node18', logLevel: 'error' });
  return import(pathToFileURL(out).href + '?t=' + Date.now());
}
const LIB = await loadLib();

await T('B1 每一則懶載入的版本都取得回**非空**內文（38 則逐則跑，不是抽樣）', () => {
  assert.ok(typeof LIB.pickChangelogBody === 'function', 'src/lib/changelog-lazy.ts 沒有匯出 pickChangelogBody');
  assert.strictEqual(lazy.length, 38, '懶載入則數 ' + lazy.length);
  for (const e of lazy) {
    const got = LIB.pickChangelogBody(BODIES, e.ver);
    assert.ok(typeof got === 'string' && got.trim().length > 10, e.ver + ' 取不到內文（回 ' + got + '）');
  }
});
await T('B2 取回的內文與 bodies 檔裡那一則**逐字相同**（正對照：不是回了別則或截斷）', () => {
  assert.ok(typeof LIB.pickChangelogBody === 'function', 'lib 沒有匯出 pickChangelogBody');
  assert.strictEqual(lazy.length, 38, '懶載入 ' + lazy.length + ' 則 → 這個迴圈會空轉（空陣列空真）');
  for (const e of lazy) assert.strictEqual(LIB.pickChangelogBody(BODIES, e.ver), bodyMap.get(e.ver), e.ver + ' 內文不一致');
});
await T('B3 找不到／格式不合的版本一律回 null（不可回空字串讓玩家看到空白區塊）', () => {
  assert.ok(typeof LIB.pickChangelogBody === 'function' && typeof LIB.isValidChangelogVer === 'function',
    'src/lib/changelog-lazy.ts 沒有匯出 pickChangelogBody / isValidChangelogVer');
  assert.strictEqual(LIB.pickChangelogBody(BODIES, 'v9.999'), null);
  for (const bad of ['', 'v', '6.250', 'v6.250"', 'v6.250"><script>', '../x']) {
    assert.strictEqual(LIB.pickChangelogBody(BODIES, bad), null, '非法版本字串「' + bad + '」竟然回了值');
    assert.strictEqual(LIB.isValidChangelogVer(bad), false, '「' + bad + '」不該被判為合法版本');
  }
  assert.strictEqual(LIB.isValidChangelogVer('v6.250'), true, '正對照：合法版本被誤判為非法');
});
await T('B4 檔名常數由 lib 集中提供，首頁與 SW 都指同一個檔（避免兩邊各寫一份而漂移）', () => {
  assert.ok(typeof LIB.CHANGELOG_BODIES_FILE === 'string', 'lib 沒有匯出 CHANGELOG_BODIES_FILE');
  assert.strictEqual(LIB.CHANGELOG_BODIES_FILE, 'changelog-bodies.html');
  assert.ok(PAGE.includes('CHANGELOG_BODIES_FILE'), '首頁沒有用這個常數');
});

// ───────────── 【C】首頁接線：抽出真正的 handler，在假 DOM 上實際跑 ─────────────
console.log('【C】首頁 details 展開 → 真的抓、真的注入（行為層）');

// 最小 DOM stub。⚠ 它自己也要先被驗（見 C0）：dispatch 必須真的分辨捕獲／冒泡兩個階段，
//   否則「捕獲旗標寫錯也照樣綠」就會變成安慰劑。
class FakeEl {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this._attrs = new Map(); this._text = ''; this._html = ''; this.className = ''; this.open = false; this._ls = new Map(); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this._html = ''; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this._text = ''; }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  remove() { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); this.parentNode = null; }
  querySelectorAll(sel) {
    assert.ok(/^\.[\w-]+$/.test(sel), 'DOM stub 只支援 ".class" 選擇器，收到：' + sel);
    const cls = sel.slice(1), out = [];
    (function walk(n) { for (const c of n.children) { if (String(c.className).split(/\s+/).includes(cls)) out.push(c); walk(c); } })(this);
    return out;
  }
  addEventListener(t, fn, capture) { if (!this._ls.has(t)) this._ls.set(t, []); this._ls.get(t).push({ fn, capture: capture === true }); }
  removeEventListener(t, fn, capture) {
    const L = this._ls.get(t) || []; const i = L.findIndex((x) => x.fn === fn && x.capture === (capture === true));
    if (i >= 0) L.splice(i, 1);
  }
  listenerCount(t) { return (this._ls.get(t) || []).length; }
}
/** 依 DOM 規範跑三個階段：capture（祖先由外而內）→ target → bubble（只有 bubbles 才跑）。 */
function dispatch(target, type, { bubbles = false } = {}) {
  const anc = []; for (let n = target.parentNode; n; n = n.parentNode) anc.push(n);
  const ev = { type, target, bubbles };
  const calls = [];
  for (const n of anc.slice().reverse()) for (const l of (n._ls.get(type) || [])) if (l.capture) calls.push(l.fn);
  for (const l of (target._ls.get(type) || [])) calls.push(l.fn);
  if (bubbles) for (const n of anc) for (const l of (n._ls.get(type) || [])) if (!l.capture) calls.push(l.fn);
  return Promise.all(calls.map((fn) => fn(ev)));
}
const fakeDocument = { createElement: (t) => new FakeEl(t) };

await T('C0 DOM stub 自我驗證：不冒泡的事件只有捕獲聽得到；冒泡的兩邊都聽得到（正/反對照）', async () => {
  const root = new FakeEl('section'), leaf = new FakeEl('details');
  root.appendChild(leaf);
  const hit = [];
  root.addEventListener('toggle', () => hit.push('capture'), true);
  root.addEventListener('toggle', () => hit.push('bubble'), false);
  await dispatch(leaf, 'toggle', { bubbles: false });
  assert.deepStrictEqual(hit, ['capture'], 'stub 沒有正確分辨階段 → 【C】整節都是安慰劑');
  hit.length = 0;
  await dispatch(leaf, 'toggle', { bubbles: true });
  assert.deepStrictEqual(hit, ['capture', 'bubble']);
});

/** 從 +page.svelte 抽出真正的 loadChangelogBodies / onChangelogToggle 並轉成可執行的 JS。 */
async function extractHandlers(pageSrc) {
  const i = pageSrc.indexOf('  let changelogBodiesPromise');
  assert.ok(i > 0, '+page.svelte 找不到 changelogBodiesPromise —— 接線不見了');
  const j = pageSrc.indexOf('async function onChangelogToggle', i);
  assert.ok(j > i, '+page.svelte 找不到 onChangelogToggle');
  const k = pageSrc.indexOf('\n  }\n', j);
  assert.ok(k > j, 'onChangelogToggle 的結尾定位不到');
  const ts = pageSrc.slice(i, k + 5);
  const js = (await transform(ts, { loader: 'ts', target: 'node18' })).code;
  return new Function('env', 'const { base, VERSION, fetch, document, CHANGELOG_BODIES_FILE, isValidChangelogVer, pickChangelogBody } = env;\n'
    + js + '\nreturn { loadChangelogBodies, onChangelogToggle };');
}
/** 從 +page.svelte 讀出 addEventListener 的**捕獲旗標**（不是寫死 true）。 */
function readCaptureFlag(pageSrc) {
  const m = /clSection\?\.addEventListener\(\s*'toggle'\s*,\s*onChangelogToggle\s*,\s*(true|false)\s*\)/.exec(pageSrc);
  assert.ok(m, '+page.svelte 沒有把 onChangelogToggle 掛到 changelogSectionEl 上');
  return m[1] === 'true';
}
/** 依實際檔案內容建一棵「首頁 changelog」的假 DOM，並照原始碼的旗標掛上監聽。 */
async function buildHome(pageSrc, { bodiesText = BODIES, ok = true } = {}) {
  const make = await extractHandlers(pageSrc);
  const fetchLog = [];
  const env = {
    base: '', VERSION: '6.264', document: fakeDocument,
    CHANGELOG_BODIES_FILE: LIB.CHANGELOG_BODIES_FILE,
    isValidChangelogVer: LIB.isValidChangelogVer, pickChangelogBody: LIB.pickChangelogBody,
    fetch: async (u) => { fetchLog.push(u); if (!ok) throw new TypeError('offline'); return { ok: true, status: 200, text: async () => bodiesText }; },
  };
  const api = make(env);
  const section = new FakeEl('section');
  const outer = new FakeEl('details'); outer.className = 'changelog-outer'; section.appendChild(outer);
  const list = new FakeEl('div'); list.className = 'changelog-list'; outer.appendChild(list);
  const nodes = new Map();
  for (const e of home.entries) {
    const d = new FakeEl('details');
    if (e.dataVer) d.setAttribute('data-ver', e.dataVer);
    list.appendChild(d); nodes.set(e.ver, d);
  }
  section.addEventListener('toggle', api.onChangelogToggle, readCaptureFlag(pageSrc));
  const openIt = async (ver) => { const d = nodes.get(ver); d.open = true; await dispatch(d, 'toggle', { bubbles: false }); return d; };
  const bodyOf = (d) => d.children.filter((c) => c.className === 'log-body');
  return { section, outer, nodes, openIt, bodyOf, fetchLog, api };
}

// ⚠ 用 ?? 兜底：BASE（改造前）上 lazy 是空陣列，這裡若直接取值會整支 crash，
//   HEAD-FAIL 就變成「一次崩掉」而不是「各項各自紅」。
const firstLazy = lazy[0]?.ver ?? 'v0.000', secondLazy = lazy[1]?.ver ?? 'v0.001',
      firstInline = home.entries[0]?.ver ?? 'v0.002';

await T('C1 展開較舊的一則：真的發出 fetch，而且內文被注入成 log-body（不是只印個載入中）', async () => {
  const h = await buildHome(PAGE);
  const d = await h.openIt(firstLazy);
  assert.strictEqual(h.fetchLog.length, 1, '發出了 ' + h.fetchLog.length + ' 個請求');
  assert.ok(h.fetchLog[0].includes('changelog-bodies.html'), '抓錯檔：' + h.fetchLog[0]);
  assert.ok(h.fetchLog[0].includes('v=6.264'), '請求沒帶版本查詢字串 → SW/HTTP 快取會餵舊內容：' + h.fetchLog[0]);
  const bodies = h.bodyOf(d);
  assert.strictEqual(bodies.length, 1, '注入了 ' + bodies.length + ' 塊內文');
  assert.strictEqual(bodies[0].innerHTML, bodyMap.get(firstLazy), '注入的內文與 bodies 檔不符（或根本沒注入）');
  assert.strictEqual(d.getAttribute('data-body-state'), 'done');
});
await T('C2 展開最新那幾則（沒有 data-ver）完全不 fetch —— 內文本來就在 HTML 裡（正對照）', async () => {
  const h = await buildHome(PAGE);
  await h.openIt(firstInline);
  await dispatch(h.outer, 'toggle', { bubbles: false });     // 外層折疊也不該觸發
  assert.strictEqual(h.fetchLog.length, 0, '不該發請求，實際 ' + h.fetchLog.length + ' 個');
});
await T('C3 展開第二則較舊條目：整份只抓一次（第二則直接用同一份）', async () => {
  const h = await buildHome(PAGE);
  const a = await h.openIt(firstLazy);
  const b = await h.openIt(secondLazy);
  assert.strictEqual(h.fetchLog.length, 1, '抓了 ' + h.fetchLog.length + ' 次 —— 每展開一則就抓一次會比原本更糟');
  assert.strictEqual(h.bodyOf(a)[0].innerHTML, bodyMap.get(firstLazy));
  assert.strictEqual(h.bodyOf(b)[0].innerHTML, bodyMap.get(secondLazy), '第二則拿到的是別則的內文');
});
await T('C4 同一則反覆開合：不重覆 fetch、不疊第二塊，而且**內文節點原封不動**（不會再閃一次載入中）', async () => {
  const h = await buildHome(PAGE);
  const d = await h.openIt(firstLazy);
  const before = h.bodyOf(d)[0];
  d.open = false; await dispatch(d, 'toggle', { bubbles: false });
  d.open = true; await dispatch(d, 'toggle', { bubbles: false });
  assert.strictEqual(h.fetchLog.length, 1);
  assert.strictEqual(h.bodyOf(d).length, 1, '疊出了 ' + h.bodyOf(d).length + ' 塊內文');
  assert.strictEqual(h.bodyOf(d)[0], before,
    '重新展開時內文節點被換掉了 ⇒ 已經讀過的那一則會再閃一次「補充說明載入中…」');
  assert.strictEqual(before.innerHTML, bodyMap.get(firstLazy), '內文在第二次展開後不見了');
});
await T('C5 離線／抓不到：顯示可重試的提示（不是靜默留白），而且再展開一次會真的再試', async () => {
  const h = await buildHome(PAGE, { ok: false });
  const d = await h.openIt(firstLazy);
  const b = h.bodyOf(d);
  assert.strictEqual(b.length, 1);
  assert.ok(b[0].textContent && b[0].textContent.includes('載入失敗'), '失敗時顯示的是「' + b[0].textContent + '」');
  assert.notStrictEqual(d.getAttribute('data-body-state'), 'done', '失敗卻標成 done ⇒ 玩家永遠重試不了');
  d.open = false; await dispatch(d, 'toggle', { bubbles: false });
  d.open = true; await dispatch(d, 'toggle', { bubbles: false });
  assert.strictEqual(h.fetchLog.length, 2, '重試沒有真的再發請求（實際 ' + h.fetchLog.length + ' 次）');
  assert.strictEqual(h.bodyOf(d).length, 1, '重試後疊出了第二塊');
});
await T('C6 bodies 檔內容缺這一則時，顯示提示而不是把 null 塞進畫面', async () => {
  const h = await buildHome(PAGE, { bodiesText: '<div class="log-body" data-ver="v0.001">x</div>' });
  const d = await h.openIt(firstLazy);
  const b = h.bodyOf(d);
  assert.strictEqual(b.length, 1);
  assert.ok(b[0].textContent.includes('載入失敗'), '顯示的是「' + b[0].textContent + '」');
  assert.ok(!String(b[0].innerHTML).includes('null'), 'null 被塞進畫面');
});
await T('C7 監聽必須掛在捕獲階段（toggle 不冒泡；寫成 false 就永遠不會觸發）＋ 卸載時會移除', async () => {
  assert.strictEqual(readCaptureFlag(PAGE), true, '+page.svelte 的 addEventListener 第三參數不是 true');
  assert.ok(/clSection\?\.removeEventListener\(\s*'toggle'\s*,\s*onChangelogToggle\s*,\s*true\s*\)/.test(PAGE),
    'onMount 的 teardown 沒有移除 toggle 監聽');
  assert.ok(/<section class="changelog-section" bind:this=\{changelogSectionEl\}>/.test(PAGE),
    'section 沒有 bind:this={changelogSectionEl} ⇒ clSection 會是 null，整個機制不會接上');
  assert.ok(!/\.changelog-list[^\n]*addEventListener/.test(PAGE),
    '不可掛在 .changelog-list 上 —— 它在 {#if} 裡，{@html} 重繪會換掉節點');
});

// ───────────── 【D】Service Worker：三種情境實測（打包後真的跑 install / fetch）─────────────
console.log('【D】Service Worker：首次安裝／版本更新／離線');
const STUB_SW = `
export const build = ['/_app/immutable/entry/app.abc123.js'];
export const files = ['/manifest.json', '/changelog.html', '/changelog-bodies.html', '/changelog-archive.html', '/covers/big.png', '/music/bgm.mp3'];
export const prerendered = ['/', '/cards', '/card/1/'];
export const version = SW_VERSION;
`;
async function bundleSW(sourceText, tag, ver) {
  const entry = join(TMP, `sw-${tag}.ts`); writeFileSync(entry, sourceText);
  const stub = join(TMP, `stub-${tag}.js`); writeFileSync(stub, STUB_SW.replace('SW_VERSION', JSON.stringify(ver)));
  const out = join(TMP, `sw-${tag}.mjs`);
  await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'neutral', target: 'node18',
    alias: { '$service-worker': stub, '$lib': join(ROOT, 'src/lib') }, logLevel: 'error' });
  return out;
}
const ORIGIN = 'https://sim.test';
/** 跑一次「安裝 + 可選的執行期 fetch」。caches 由呼叫端帶進來，才能模擬版本更新／離線。 */
async function runSW(bundlePath, { store = new Map(), online = true, requests = [] } = {}) {
  const installed = [], netLog = [];
  const OrigRequest = globalThis.Request;
  const cacheFor = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      async add(info) {
        const req = info instanceof OrigRequest ? info : new OrigRequest(new URL(String(info), ORIGIN).href);
        const p = new URL(req.url).pathname;
        installed.push(p);
        if (!online) throw new TypeError('offline');
        m.set(p, 'FRESH:' + p);
      },
      async match(req) { const key = typeof req === 'string' ? req : new URL(req.url).pathname + new URL(req.url).search; return m.get(key); },
      async put(req, res) { const u = new URL(req.url); m.set(u.pathname + u.search, res.body); },
    };
  };
  const listeners = {};
  globalThis.self = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    skipWaiting: () => {}, location: new URL(ORIGIN + '/service-worker.js'),
    registration: { scope: ORIGIN + '/' }, clients: { claim: async () => {}, matchAll: async () => [] },
  };
  globalThis.caches = { open: async (n) => cacheFor(n), keys: async () => [...store.keys()], delete: async (k) => store.delete(k),
    match: async (req) => { const u = new URL(req.url); for (const m of store.values()) { const v = m.get(u.pathname + u.search); if (v) return v; } return undefined; } };
  globalThis.fetch = async (req) => {
    const u = new URL(typeof req === 'string' ? req : req.url);
    netLog.push(u.pathname + u.search);
    if (!online) throw new TypeError('offline');
    return { status: 200, body: 'NET:' + u.pathname, clone() { return this; } };
  };
  await import(pathToFileURL(bundlePath).href + '?t=' + Date.now() + Math.random());
  const iev = { waitUntil(p) { this._p = p; } };
  for (const fn of listeners.install || []) fn(iev);
  await iev._p;
  const aev = { waitUntil(p) { this._p = p; } };
  for (const fn of listeners.activate || []) fn(aev);
  await aev._p;
  const served = [];
  for (const url of requests) {
    const request = { method: 'GET', url: ORIGIN + url, mode: 'cors' };
    let out = '__not-handled__';
    const fev = { request, respondWith(p) { this._p = p; } };
    for (const fn of listeners.fetch || []) fn(fev);
    if (fev._p) { try { out = await fev._p; } catch (e) { out = 'THROW:' + e.message; } }
    served.push({ url, out: typeof out === 'object' && out && 'body' in out ? out.body : out });
  }
  return { installed, netLog, store, served };
}

const swBundle = await bundleSW(SW, 'main', 'v6264');
const fresh = await runSW(swBundle);
await T('D1 首次安裝：changelog-bodies.html **不得**被預快取（否則等於把省下的位元組搬回 install）', () => {
  assert.ok(fresh.installed.length >= 5, 'install 只抓了 ' + fresh.installed.length + ' 個 → harness 壞了');
  assert.ok(!fresh.installed.includes('/changelog-bodies.html'),
    'install 抓了 /changelog-bodies.html —— 必須加進 service-worker.ts 的 HEAVY_MEDIA');
});
await T('D2 首次安裝：changelog.html 仍照舊預快取（正對照，本版沒有順手改壞既有策略）', () => {
  assert.ok(fresh.installed.includes('/changelog.html'), 'changelog.html 反而不被預快取了');
  assert.ok(!fresh.installed.includes('/changelog-archive.html'), 'v6.100 的封存頁策略被改壞');
  assert.ok(!fresh.installed.includes('/covers/big.png') && !fresh.installed.includes('/music/bgm.mp3'), 'v5.365 重媒體策略被改壞');
  assert.ok(!fresh.installed.includes('/card/1/'), 'v5.966 卡片頁策略被改壞');
});
await T('D3 版本更新：新版 SW install 同樣不抓 bodies（每天出版都不會多這 31KB）', async () => {
  const carried = fresh.store;
  const swNew = await bundleSW(SW, 'v2', 'v6265');
  const upd = await runSW(swNew, { store: carried });
  assert.ok(!upd.installed.includes('/changelog-bodies.html'), '版本更新時抓了 bodies');
  assert.ok(upd.installed.includes('/'), '版本更新沒有重抓 app 殼層 → harness 壞了');
});
await T('D4 執行期：第一次抓 bodies 走 network-first 並寫進快取；之後離線仍讀得到（用到才快取）', async () => {
  const s = new Map();
  const on = await runSW(swBundle, { store: s, requests: ['/changelog-bodies.html?v=6.264'] });
  assert.deepStrictEqual(on.served.map((x) => x.out), ['NET:/changelog-bodies.html'], '線上沒有回網路內容');
  const off = await runSW(swBundle, { store: s, online: false, requests: ['/changelog-bodies.html?v=6.264'] });
  assert.strictEqual(off.served[0].out, 'NET:/changelog-bodies.html', '離線時沒有從快取回舊內容（實得 ' + off.served[0].out + '）');
});
await T('D5 離線且從未抓過 bodies：不得整頁爆掉，只會是這一則的內文抓不到（由 C5 顯示可重試提示）', async () => {
  const off = await runSW(swBundle, { store: new Map(), online: false, requests: ['/changelog-bodies.html?v=6.264'] });
  assert.ok(String(off.served[0].out).startsWith('THROW:'), '離線未快取時應該是這個請求失敗，實得 ' + off.served[0].out);
});

// ───────────── 【F】本版搬運無損（對 BASE 逐字比對；淺複製時大聲跳過）─────────────
console.log('【F】v6.264 搬運無損：對 v6.263 逐字還原');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【F】對 BASE(' + BASE_SHA.slice(0, 8) + ') 的逐字還原比對', '【A】【B】的結構不變量與【E】突變測試不需要歷史，仍在守');
} else {
  const baseHome = readBaseBlob(ROOT, BASE_SHA, 'static/changelog.html');
  const baseArc = readBaseBlob(ROOT, BASE_SHA, 'static/changelog-archive.html');
  const baseHomeSplit = splitEntries(baseHome.out);
  const baseArcSplit = splitEntries(baseArc.out);
  const baseBodiesRaw = readBaseBlob(ROOT, BASE_SHA, 'static/changelog-bodies.html');
  // ⭐ v6.275：admin-only 版（本版完全沒動 changelog）的合法情況 —— 三檔與 BASE 逐位元相同
  //   ⇒ 「搬運無損」trivially 成立，直接 PASS；只要有任何一檔不同，就走完整的 F1~F3 斷言。
  //   ⚠ 這不是弱化：位元組相同是**最強**的無損證明；「動了卻想混過」一定會落到 else 分支。
  const _clUnchanged = baseHome.ok && baseArc.ok
    && baseHome.out === HOME && baseArc.out === ARC
    && (baseBodiesRaw.ok ? baseBodiesRaw.out === BODIES : BODIES === '');
  const baseBodyMap = new Map();
  if (baseBodiesRaw.ok) for (const m of baseBodiesRaw.out.matchAll(/<div class="log-body" data-ver="(v[\d.]+)">([\s\S]*?)<\/div>/g)) baseBodyMap.set(m[1], m[2]);
  const NEW_VER = home.entries[0].ver;
  const droppedVers = baseHomeSplit.entries.map((e) => e.ver).filter((v) => !home.entries.some((e) => e.ver === v));

  if (_clUnchanged) {
    T('F0 ⭐ 本版未動 changelog（admin-only 版）：首頁／封存頁／bodies 三檔與 BASE 逐位元相同', () => {
      assert.strictEqual(HOME, baseHome.out); assert.strictEqual(ARC, baseArc.out);
    });
  } else {
    T('F1 ⭐ 首頁：除了最新那一則以外，每一則都能逐位元組還原回 BASE（搬運沒有動到內文）', () => {
      assert.ok(baseHome.ok, '讀不到 BASE 的 changelog.html');
      const bm = new Map(baseHomeSplit.entries.map((e) => [e.ver, e.text]));
      let checked = 0, movedOut = 0;
      for (const e of home.entries) {
        const orig = bm.get(e.ver);
        // ⭐ 唯一可以是 BASE 沒有的，就是**最新那一則**（＝這一版新增的）
        if (!orig) { assert.strictEqual(e.ver, NEW_VER, '首頁出現 BASE 沒有的條目：' + e.ver); continue; }
        const origLazy = /^<details[^>]*\sdata-ver=/.test(orig);
        let rebuilt = e.text;
        if (e.dataVer && !origLazy) {
          // 這一版被擠出內嵌區的那一則：把搬到 bodies 的內文放回去再比
          movedOut++;
          rebuilt = rebuilt.replace('<details data-ver="' + e.ver + '">', '<details>')
            .replace('</summary>\n', '</summary>\n        <div class="log-body">' + bodyMap.get(e.ver) + '</div>\n');
        }
        assert.ok(!(origLazy && !e.dataVer), e.ver + ' 從懶載入變回內嵌 —— 搬運方向反了');
        if (/^<details open>/.test(orig)) rebuilt = rebuilt.replace(/^<details(?: open)?>/, '<details open>');
        assert.strictEqual(rebuilt, orig, e.ver + ' 還原後與 BASE 不同');
        checked++;
      }
      assert.strictEqual(checked, 49, '只比對到 ' + checked + ' 則（應為 49）');
      assert.strictEqual(movedOut, 1, '這一版把 ' + movedOut + ' 則的內文搬出內嵌區（應恰好 1 則＝搬運步驟②）');
      assert.strictEqual(home.entries.filter((e) => e.open).length, 1, '預設展開的不是恰好一則');
      assert.strictEqual(home.entries[0].open, true, '預設展開的不是最新那一則（上一版的 open 沒有收起來）');
    });
    T('F2 ⭐ 封存頁：恰好多一則，就是掉出首頁的那一則，而且標題＋內文都逐字保留', () => {
      assert.ok(baseArc.ok, '讀不到 BASE 的 changelog-archive.html');
      assert.ok(baseArcSplit.entries.length >= 324, 'BASE 封存頁只有 ' + baseArcSplit.entries.length + ' 則');
      assert.strictEqual(arc.entries.length, baseArcSplit.entries.length + 1, '封存頁應恰好多一則');
      assert.deepStrictEqual(droppedVers, [arc.entries[0].ver], '掉出首頁的與新進封存頁的不是同一則');
      assert.strictEqual(arc.entries.slice(1).map((e) => e.text).join(''), baseArcSplit.entries.map((e) => e.text).join(''),
        '封存頁的舊條目被動到了 —— 歷史一則都不可以改');
      // 新進封存頁的那一則 ＝ BASE 首頁的標題（脫掉 data-ver）＋ BASE bodies 的內文
      const v = droppedVers[0];
      const origTitle = baseHomeSplit.entries.find((e) => e.ver === v).text;
      assert.ok(baseBodiesRaw.ok, '讀不到 BASE 的 changelog-bodies.html');
      const origBody = baseBodyMap.get(v);
      assert.ok(origBody, 'BASE 的 bodies 檔沒有 ' + v + ' 的內文');
      const want = origTitle.replace('<details data-ver="' + v + '">', '<details>')
        .replace('</summary>\n', '</summary>\n        <div class="log-body">' + origBody + '</div>\n');
      assert.strictEqual(arc.entries[0].text, want, v + ' 搬進封存頁時標題或內文被改到了');
    });
    T('F2b ⭐ bodies 檔：只多了「這一版搬出來的那一則」、只少了「搬進封存頁的那一則」，其餘逐字不變', () => {
      assert.ok(baseBodiesRaw.ok, '讀不到 BASE 的 changelog-bodies.html');
      const added = [...bodyMap.keys()].filter((v) => !baseBodyMap.has(v));
      const removed = [...baseBodyMap.keys()].filter((v) => !bodyMap.has(v));
      assert.strictEqual(added.length, 1, 'bodies 檔多了 ' + added.length + ' 則：' + added);
      assert.deepStrictEqual(removed, droppedVers, 'bodies 檔少掉的不是搬進封存頁的那一則');
      for (const [v, b] of baseBodyMap) {
        if (removed.includes(v)) continue;
        assert.strictEqual(bodyMap.get(v), b, v + ' 的內文在搬運中被改到了');
      }
    });
    T('F3 ⭐ 首頁位元組「每版增量 ≈ 0」（v6.264 的結構解要一直有效，不是只有那一版）', () => {
      const before = Buffer.byteLength(baseHome.out, 'utf8'), after = Buffer.byteLength(HOME, 'utf8');
      // ⚠ v6.264 那一版是 61,436 → 31,349（-49%）；從 v6.265 起 BASE 已經是新結構，
      //   真正要守的是「一則進、一則的內文出、一則出封存」之後**不會單向長大**。
      assert.ok(after <= before + 2048,
        before + ' → ' + after + ' bytes（+' + (after - before) + '）—— 單版增量超過 2KB，搬運步驟②③是不是漏做了？');
      console.log(`        首頁片段 ${before} → ${after} bytes（-${(100 - after / before * 100).toFixed(1)}%）；bodies ${Buffer.byteLength(BODIES, 'utf8')} bytes`);
    });

  }
}

// ─────────────────── 【E】突變測試：每一條都必須紅在指定的地方 ───────────────────
//   ⚠⚠ 這個專案已經連續踩到八次「守衛安慰劑」。凡是某個突變**沒有紅**，
//      一律先假設是守衛沒測到，不要假設「剛好等價」。
console.log('【E】突變測試（沒紅 = 守衛是安慰劑）');
async function mustBreak(name, run) {
  // ⚠ catch 區塊裡刻意**不印字也不 return**（v6.263 的「靜默掏空」偵測器會列管這個樣式）；
  //   只把紅的訊息收下來，判紅綠與輸出都放到 catch 外面。
  let red = null;
  try { await run(); }
  catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
    red = e.message.split('\n')[0].slice(0, 70);
  }
  if (red !== null) { console.log('  OK   ' + name + '（如預期紅：' + red + '）'); pass++; return; }
  console.log('  FAIL ' + name + ' :: 突變後竟然還是綠的 —— 這條守衛沒有在守');
  fail++;
}

await mustBreak('E1 SW 拿掉 changelog-bodies 的排除 → 【D1】必須紅', async () => {
  const mut = SW.replace(/\s*\|\|\s*u\.includes\('changelog-bodies'\)/, '');
  assert.notStrictEqual(mut, SW, '突變沒生效（來源找不到那段）');
  const r = await runSW(await bundleSW(mut, 'mut1', 'v6264'));
  assert.ok(!r.installed.includes('/changelog-bodies.html'), 'install 抓了 /changelog-bodies.html');
});
await mustBreak('E2 首頁把捕獲旗標改成 false → 【C1】必須紅（toggle 不冒泡，監聽根本不會被呼叫）', async () => {
  const mut = PAGE.replace("clSection?.addEventListener('toggle', onChangelogToggle, true);",
                           "clSection?.addEventListener('toggle', onChangelogToggle, false);");
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const h = await buildHome(mut);
  const d = await h.openIt(firstLazy);
  assert.strictEqual(h.fetchLog.length, 1, '沒有發出請求（監聽沒被呼叫）');
  assert.strictEqual(h.bodyOf(d).length, 1, '內文沒被注入');
});
await mustBreak('E3 首頁拿掉 innerHTML 注入 → 【C1】必須紅（只剩「載入中」，玩家看不到內文）', async () => {
  const mut = PAGE.replace('      holder.innerHTML = inner;\n', '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const h = await buildHome(mut);
  const d = await h.openIt(firstLazy);
  assert.strictEqual(h.bodyOf(d)[0].innerHTML, bodyMap.get(firstLazy), '注入的內文與 bodies 檔不符');
});
await mustBreak('E4 首頁拿掉「已載入就不再做」的早退 → 【C4】必須紅（已讀過的那一則會被重畫、再閃一次載入中）', async () => {
  const mut = PAGE.replace("    if (st === 'loading' || st === 'done') return;\n", '');
  assert.notStrictEqual(mut, PAGE, '突變沒生效');
  const h = await buildHome(mut);
  const d = await h.openIt(firstLazy);
  const before = h.bodyOf(d)[0];
  d.open = false; await dispatch(d, 'toggle', { bubbles: false });
  d.open = true; await dispatch(d, 'toggle', { bubbles: false });
  assert.strictEqual(h.fetchLog.length, 1, '抓了 ' + h.fetchLog.length + ' 次');
  assert.strictEqual(h.bodyOf(d)[0], before, '內文節點被換掉了（會再閃一次載入中）');
});
await mustBreak('E5 bodies 檔少掉一則 → 【A4】必須紅（雙向比對抓得到）', async () => {
  assert.ok(lazy.length > 5, '沒有懶載入條目 ⇒ 這個突變不適用（結構還沒改）');
  const victim = lazy[5].ver;
  const mutBodies = BODIES.replace(new RegExp('<div class="log-body" data-ver="' + victim.replace('.', '\\.') + '">[\\s\\S]*?</div>\\n'), '');
  assert.notStrictEqual(mutBodies, BODIES, '突變沒生效');
  const mm = new Map();
  for (const m of mutBodies.matchAll(/<div class="log-body" data-ver="(v[\d.]+)">([\s\S]*?)<\/div>/g)) mm.set(m[1], m[2]);
  assert.deepStrictEqual([...mm.keys()].sort(), lazy.map((e) => e.ver).sort(), '少了 ' + victim + ' 卻沒被抓到');
});
await mustBreak('E6 lib 改用 lastIndexOf 找結束標籤 → 【B2】必須紅（會把後面所有則黏在一起）', async () => {
  const src = LIB_SRC;
  assert.ok(src, 'src/lib/changelog-lazy.ts 不存在 ⇒ 這個突變不適用');
  const mut = src.replace("bodiesHtml.indexOf('</div>', from)", "bodiesHtml.lastIndexOf('</div>')");
  assert.notStrictEqual(mut, src, '突變沒生效');
  const L = await loadLib(mut, 'mut6');
  for (const e of lazy) assert.strictEqual(L.pickChangelogBody(BODIES, e.ver), bodyMap.get(e.ver), e.ver + ' 內文不一致');
});

rmSync(TMP, { recursive: true, force: true });
console.log(`\n=== v6.264 首頁 changelog 延後載入：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
