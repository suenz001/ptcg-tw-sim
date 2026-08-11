/**
 * v6.166 守衛：首頁「最新影片」lazy facade。
 *
 * ⭐這一版最核心、也最容易在日後被改壞的保證是：
 *   **玩家沒按下播放鍵以前，DOM 裡不存在任何 iframe。**
 *   一旦有人「順手」把 facade 改回直接嵌 iframe，首頁每位訪客就會多背約 1MB 的
 *   YouTube 播放器 JS ＋ 十幾個第三方請求 —— 而且畫面看起來一模一樣，人工很難發現。
 *
 * ⚠為什麼不是 grep：長期記憶的教訓是「只驗字串存在的守衛擋不住接線沒接上」。
 *   這支守衛因此**真的把元件 SSR 渲染出來**（svelte compile → generate:'server' → svelte/server render），
 *   直接對「渲染出來的 HTML」下斷言：
 *     ・預設狀態的 HTML 不得出現 iframe，且必須有縮圖 facade
 *     ・playing=true 的 HTML 必須出現 iframe，網域必須是 youtube-nocookie
 *     ・videoId 為空的 HTML 必須整段不存在
 *   「按下去才會 playing=true」這一段沒有 DOM 可以點，改用 **template AST 祖先鏈**
 *   證明 iframe 確實被 `{#if playing}` 包住、且 playing 只由 facade 的 onclick 設為 true。
 *
 * ⚠自我驗證（否定型檢查的必要條件）：本檔最後會拿三個**刻意寫壞**的元件變體
 *   重跑同一組檢查函式，若壞樣本竟然通過，代表檢查失效 → 整支測試 FAIL。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { createRequire } from 'node:module';

// ⚠用 CJS require 載入 svelte compiler：沙盒測試環境（node_modules 為 symlink）下
//   `import('svelte/compiler')` 會卡住不回應，CJS 路徑正常（沿用 test-home-layout-switch 的做法）。
const require = createRequire(import.meta.url);
const { compile, parse } = require('svelte/compiler');
const { render } = await import('svelte/server');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CMP_PATH = join(ROOT, 'src/lib/HomeVideo.svelte');
const PAGE_PATH = join(ROOT, 'src/routes/+page.svelte');
const JSON_PATH = join(ROOT, 'src/lib/home-video.json');
const JSON_PUBLIC = join(ROOT, 'static/home-video.json');
const PKG_PATH = join(ROOT, 'package.json');
const FETCH_PATH = join(ROOT, 'scripts/fetch-latest-video.mjs');
// 編譯產物必須放在專案內，否則 `import 'svelte/internal/server'` 解析不到
const TMP_DIR = join(ROOT, 'node_modules/.cache/ptcg-v6166');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

assert.ok(existsSync(CMP_PATH), 'src/lib/HomeVideo.svelte 必須存在');
const CMP = readFileSync(CMP_PATH, 'utf8');
const PAGE = readFileSync(PAGE_PATH, 'utf8');

// ══════════════════════════════════════════════════════════════════
// 共用：把一份 .svelte 原始碼 SSR 渲染成 HTML
// ══════════════════════════════════════════════════════════════════
let seq = 0;
async function renderSvelte(source, props) {
  mkdirSync(TMP_DIR, { recursive: true });
  const file = join(TMP_DIR, `c${seq++}.server.js`);
  const out = compile(source, { generate: 'server', filename: 'HomeVideo.svelte' });
  writeFileSync(file, out.js.code, 'utf8');
  const mod = await import(pathToFileURL(file).href);
  return render(mod.default, { props }).body;
}

/**
 * 共用：template AST 走訪，回傳每個元素節點連同「祖先 if 條件鏈」。
 * chain 元素形如 { test: 'playing', branch: 'consequent' }。
 */
function collectElements(source) {
  const ast = parse(source, { modern: true });
  const found = [];
  const walkFragment = (frag, chain) => {
    if (!frag?.nodes) return;
    for (const node of frag.nodes) walkNode(node, chain);
  };
  const walkNode = (node, chain) => {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'IfBlock': {
        const test = source.slice(node.test.start, node.test.end).trim();
        walkFragment(node.consequent, [...chain, { test, branch: 'consequent' }]);
        if (node.alternate) walkFragment(node.alternate, [...chain, { test, branch: 'alternate' }]);
        return;
      }
      case 'RegularElement':
      case 'SvelteElement':
        found.push({ name: node.name, node, chain });
        walkFragment(node.fragment, chain);
        return;
      case 'Component':
      case 'SvelteComponent':
        found.push({ name: node.name, node, chain });
        walkFragment(node.fragment, chain);
        return;
      case 'EachBlock':
      case 'KeyBlock':
      case 'SnippetBlock':
        walkFragment(node.body ?? node.fragment, chain);
        return;
      case 'AwaitBlock':
        for (const k of ['pending', 'then', 'catch']) walkFragment(node[k], chain);
        return;
      default:
        walkFragment(node.fragment, chain);
        return;
    }
  };
  walkFragment(ast.fragment, []);
  return { ast, elements: found };
}

/** 取某元素某屬性的原始碼片段（含表達式）。 */
function attrSource(source, node, attrName) {
  const a = (node.attributes ?? []).find((x) => x.type === 'Attribute' && x.name === attrName);
  if (!a) return null;
  return source.slice(a.start, a.end);
}

/** 剝掉 JS 行/區塊註解與 HTML 註解 —— 否定型掃描前的必要步驟。 */
export function stripComments(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ══════════════════════════════════════════════════════════════════
// 核心檢查函式（同一份會拿去跑「刻意寫壞」的變體做自我驗證）
// ══════════════════════════════════════════════════════════════════

/** ① 預設狀態（沒按播放）渲染出來的 HTML 不得有 iframe，且必須有縮圖 facade。 */
async function checkNoIframeBeforeClick(source) {
  const html = await renderSvelte(source, { videoId: 'zv7BTH2Quzg', title: '測試影片' });
  assert.ok(!/<iframe/i.test(html),
    '未按播放鍵時渲染出的 HTML 竟然含 iframe —— 這就是「直接嵌 YouTube」，每位訪客都會被拉去下載播放器');
  // ⚠只看「會真的發出網路請求」的屬性（iframe/script/img/link/source…的 src/href）；
  //   文字說明裡指向 youtube.com/watch 的 <a> 連結不會發請求，不算負擔。
  const resourceUrls = [...html.matchAll(/<(?:iframe|script|img|link|source|video|embed|object)\b[^>]*\s(?:src|href|data)="([^"]+)"/gi)].map((m) => m[1]);
  const ytRes = resourceUrls.filter((u) => /youtube(-nocookie)?\.com|ytimg\.com\/.*player/i.test(u));
  assert.deepStrictEqual(ytRes, [],
    '未按播放鍵時不該載入任何 YouTube 網域資源（縮圖 i.ytimg.com 除外），實際：' + ytRes.join('、'));
  assert.strictEqual(resourceUrls.length, 1,
    '未按播放鍵時這一區只該有 1 個外部資源（縮圖），實際 ' + resourceUrls.length + ' 個：' + resourceUrls.join('、'));
  assert.ok(/<img[^>]+i\.ytimg\.com\/vi\/zv7BTH2Quzg\//.test(html), '應該畫出 YouTube 縮圖當 facade');
  assert.ok(/loading="lazy"/.test(html), '縮圖必須 loading="lazy"（沒捲到就不下載）');
  assert.ok(/decoding="async"/.test(html), '縮圖必須 decoding="async"');
  assert.ok(/<button/.test(html), 'facade 必須是可按的 button（鍵盤也要能觸發）');
  return html;
}

/** ② 已按下播放（playing=true）才有 iframe，且網域必須是 youtube-nocookie。 */
async function checkIframeAfterClick(source) {
  const html = await renderSvelte(source, { videoId: 'zv7BTH2Quzg', title: '測試影片', initiallyPlaying: true });
  assert.ok(/<iframe/i.test(html), 'playing=true 時必須真的有 iframe（否則按了播放鍵沒反應）');
  const m = html.match(/<iframe[^>]*\ssrc="([^"]+)"/i);
  assert.ok(m, 'iframe 必須有 src');
  assert.ok(m[1].startsWith('https://www.youtube-nocookie.com/embed/zv7BTH2Quzg'),
    'iframe 網域必須是 youtube-nocookie.com（隱私），實際：' + m[1]);
  assert.ok(m[1].includes('autoplay=1'), '按下播放鍵後應自動開始播放（autoplay=1），實際：' + m[1]);
  assert.ok(!/<img[^>]+ytimg/.test(html), 'iframe 上場後 facade 縮圖不該還留著（會疊在播放器上）');
  return html;
}

/** ③ 沒有影片（videoId 空）時整區不顯示，而且不能丟例外。 */
async function checkEmptyRendersNothing(source) {
  const html = await renderSvelte(source, { videoId: '', title: '' });
  const visible = html.replace(/<!--[\s\S]*?-->/g, '').trim();
  assert.strictEqual(visible, '',
    '沒有影片設定時整區必須完全不渲染（連標題與空容器都不能留），實際輸出：' + JSON.stringify(visible.slice(0, 120)));
  return html;
}

/** ④ AST：iframe 必須被 `{#if playing}` 的 consequent 包住，且 playing 只由 facade 的 onclick 設 true。 */
function checkIframeGatedByPlaying(source) {
  const { elements } = collectElements(source);
  const iframes = elements.filter((e) => e.name === 'iframe');
  assert.strictEqual(iframes.length, 1, `應恰好有 1 個 iframe，實得 ${iframes.length}`);
  const chain = iframes[0].chain;
  const gate = chain.find((c) => c.branch === 'consequent' && /\bplaying\b/.test(c.test));
  assert.ok(gate,
    'iframe 沒有被以 playing 為條件的 {#if} 包住 —— 代表它會無條件出現在 DOM 裡。祖先條件鏈：'
    + JSON.stringify(chain));
  // 同時要在 videoId 的 gate 底下（沒影片就整區不畫）
  assert.ok(chain.some((c) => c.branch === 'consequent' && /\bvideoId\b/.test(c.test)),
    'iframe 應同時在 {#if videoId} 之內');
  // facade 按鈕：onclick 必須把 playing 設成 true
  const buttons = elements.filter((e) => e.name === 'button');
  assert.ok(buttons.length >= 1, '應有 facade 按鈕');
  const onclicks = buttons.map((b) => attrSource(source, b.node, 'onclick')).filter(Boolean);
  assert.ok(onclicks.some((s) => /playing\s*=\s*true/.test(s)),
    '沒有任何按鈕的 onclick 會把 playing 設為 true —— 播放鍵按下去不會有反應。實際 onclick：'
    + JSON.stringify(onclicks));
  // playing 的初值只能來自 prop（預設 false），不能寫死 true
  assert.ok(/let\s+playing\s*=\s*\$state\(\s*initiallyPlaying\s*\)/.test(source),
    'playing 應為 $state(initiallyPlaying)（預設 false）');
  assert.ok(/initiallyPlaying\s*=\s*false/.test(source), 'initiallyPlaying 的預設值必須是 false');
}

// ══════════════════════════════════════════════════════════════════
// 正式斷言
// ══════════════════════════════════════════════════════════════════
console.log('── v6.166 首頁最新影片 lazy facade ──');

await TA('①⭐⭐⭐未按播放前，渲染出的 DOM 完全沒有 iframe（不增加載入負擔的核心保證）', () => checkNoIframeBeforeClick(CMP));
await TA('②⭐⭐按下播放後才建立 iframe，且網域是 youtube-nocookie + autoplay', () => checkIframeAfterClick(CMP));
await TA('③⭐⭐取不到影片時整區不顯示（渲染輸出為空，且不丟例外）', () => checkEmptyRendersNothing(CMP));
T('④⭐⭐AST：iframe 確實被 {#if playing} 包住，playing 只由播放鍵的 onclick 設為 true', () => checkIframeGatedByPlaying(CMP));

T('⑤⭐固定 16:9 舞台 + 縮圖 cover ⇒ 縮圖載入前後高度不變（不會有版面跳動 CLS）', () => {
  assert.ok(/aspect-ratio:\s*16\s*\/\s*9/.test(CMP), '.hv-stage 必須設 aspect-ratio: 16 / 9');
  const i = CMP.indexOf('.hv-stage {');
  assert.ok(i > 0, '應有 .hv-stage 樣式');
  const block = CMP.slice(i, CMP.indexOf('}', i));
  assert.ok(/position:\s*relative/.test(block), '.hv-stage 要 position: relative（縮圖/iframe 絕對填滿）');
  // v6.030 首頁爆版根因：把「裝內容的容器」設成 flex
  assert.ok(!/display:\s*(flex|grid)/.test(block), '.hv-stage 不可設 flex/grid（v6.030 爆版根因）');
  assert.ok(/object-fit:\s*cover/.test(CMP), '縮圖是 4:3，需要 object-fit: cover 裁成 16:9');
  assert.ok(/position:\s*absolute[\s\S]{0,120}inset:\s*0/.test(CMP), 'iframe/facade 要絕對填滿舞台');
});

T('⑥⭐手機直式不會壞版：整區用百分比寬度，沒有寫死的像素寬', () => {
  const i = CMP.indexOf('.hv-stage {');
  const block = CMP.slice(i, CMP.indexOf('}', i));
  assert.ok(/width:\s*100%/.test(block), '.hv-stage 應為 width: 100%');
  assert.ok(/max-width:\s*\d+px/.test(block), '.hv-stage 應以 max-width 限制桌機寬度（而非固定 width）');
  assert.ok(!/(?<!max-)\bwidth:\s*\d{3,}px/.test(block), '.hv-stage 不可寫死像素寬（手機會被撐爆）');
  assert.ok(/@media \(max-width: 480px\)/.test(CMP), '應有手機直式的樣式微調');
});

T('⑦⭐⭐影片區位於「玩家社群」之下、「版本更新記錄」之上（站長指定位置），且只有一份', () => {
  const n = (PAGE.match(/<HomeVideo\b/g) ?? []).length;
  assert.strictEqual(n, 1, `首頁應恰好放一個 HomeVideo，實得 ${n}`);
  const iCommunity = PAGE.indexOf('class="community-section"');
  const iVideo = PAGE.indexOf('<HomeVideo');
  const iChangelog = PAGE.indexOf('class="changelog-section"');
  assert.ok(iCommunity > 0 && iChangelog > 0, '前提：社群區與更新記錄區都在');
  assert.ok(iVideo > iCommunity, '影片區必須在玩家社群 QR Code 之下');
  assert.ok(iVideo < iChangelog, '影片區必須在版本更新記錄之上');
});

T('⑧⭐⭐⭐首頁不得傳 initiallyPlaying（那等於一進站就載入播放器）', () => {
  const clean = stripComments(PAGE);
  assert.ok(!/initiallyPlaying/.test(clean),
    '首頁把 initiallyPlaying 傳進去了 —— 這個 prop 只給守衛做渲染驗證用');
  // 自我驗證：同一條檢查對「刻意寫壞」的樣本必須抓得到
  const bad = '<!-- initiallyPlaying 只出現在註解 -->\n<HomeVideo videoId={x} initiallyPlaying={true} />';
  assert.ok(/initiallyPlaying/.test(stripComments(bad)), '自我驗證：掃描器應抓到寫在程式碼裡的 initiallyPlaying');
  const onlyComment = '<!-- initiallyPlaying 只出現在註解 -->\n<HomeVideo videoId={x} />';
  assert.ok(!/initiallyPlaying/.test(stripComments(onlyComment)), '自我驗證：只出現在註解時不該誤判');
});

T('⑨⭐首頁是單一版面（v6.044 起已移除新舊切換），沒有第二套版面漏掉這一區', () => {
  const clean = stripComments(PAGE);
  for (const dead of ['homeLayout', 'ptcg_home_layout', 'setHomeLayout', 'hm-switch']) {
    assert.ok(!clean.includes(dead),
      `首頁出現版面切換程式碼「${dead}」—— 若首頁又變成雙版面，影片區必須兩套都補上`);
  }
});

T('⑩⭐⭐⭐影片設定是**建置時** import 進 bundle，首頁不得為它多發任何 runtime 請求', () => {
  const clean = stripComments(PAGE);
  assert.ok(/import\s+homeVideoData\s+from\s+'\$lib\/home-video\.json'/.test(clean),
    '應在建置時 import $lib/home-video.json（讓 vite 編進 bundle）');
  // ⭐這條擋的是「改回 runtime fetch」：那會多一個請求，而且區塊要等 fetch 回來才插進版面，
  //   把下面的「版本更新記錄」往下推（CLS）。這份資料建置時就定案，runtime 抓換不到任何即時性。
  assert.ok(!/fetch\([^)]*home-video/i.test(clean),
    '首頁不得在 runtime fetch home-video.json —— 那是白付一個請求外加版面跳動');
  assert.ok(!/fetch\([^)]*(youtube|ytimg)/i.test(clean),
    '首頁不得在 runtime 直接連 YouTube（CORS 擋不說，也是多餘的負擔）');
  assert.ok(/\[A-Za-z0-9_-\]\{11\}/.test(clean), '必須驗證影片 ID 格式後才綁進網址');
  // 自我驗證：正反樣本
  assert.ok(/fetch\([^)]*home-video/i.test("fetch(`${base}/home-video.json`)"), '自我驗證：應抓得到 runtime fetch 寫法');
  assert.ok(!/fetch\([^)]*home-video/i.test("import x from '$lib/home-video.json';"), '自我驗證：import 寫法不該誤判');
});

await TA('⑪⭐⭐首頁整份仍編譯得過（Svelte 模板裡的裸角括號會讓 vite build 失敗）', async () => {
  for (const [nm, src] of [['首頁', PAGE], ['HomeVideo', CMP]]) {
    const r = compile(src, { generate: 'client', filename: nm });
    assert.ok(r.js?.code, `${nm} 應產出 JS`);
  }
});

T('⑫⭐建置流程：build 第一步會更新最新影片，且靜態設定檔存在又夠小', () => {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  assert.ok(/scripts\/fetch-latest-video\.mjs/.test(pkg.scripts.build),
    'npm run build 必須先跑 scripts/fetch-latest-video.mjs（否則影片永遠停在 commit 當時那支）');
  assert.ok(pkg.scripts.build.indexOf('fetch-latest-video') < pkg.scripts.build.indexOf('vite build'),
    '抓影片必須在 vite build 之前（static/ 要先就位才會被複製進 build 產物）');
  assert.ok(existsSync(JSON_PATH), 'src/lib/home-video.json 必須被 commit（抓取失敗時的最後保底值）');
  const size = statSync(JSON_PATH).size;
  assert.ok(size < 1024, `home-video.json 應遠小於 1KB（實際 ${size} bytes）—— 它會被編進首頁 bundle`);
  const j = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  // ⚠腳本在「三個來源全掛」時會寫空 videoId（合法的 fail-open 狀態），但**那種狀態不該被 commit**：
  //   commit 進 repo 的這份是保底值，空的就等於首頁永遠不顯示影片。
  assert.ok(/^[A-Za-z0-9_-]{11}$/.test(j.videoId), 'commit 進 repo 的保底值必須是合法的 11 碼影片 ID：' + j.videoId);
  // 靜態發佈的那份只給下一次 build 當「上次成功發布的值」，玩家端不會讀它
  assert.ok(existsSync(JSON_PUBLIC), 'static/home-video.json 也要在（下次 build 的次要 fallback 來源）');
  assert.strictEqual(readFileSync(JSON_PUBLIC, 'utf8'), readFileSync(JSON_PATH, 'utf8'),
    '兩份必須一致（由 writeBoth 同時寫出）');
});

await TA('⑬⭐抓取腳本 fail-open：垃圾／空回應一律回 null，不會把壞資料寫進設定', async () => {
  const mod = await import(pathToFileURL(FETCH_PATH).href);
  assert.strictEqual(mod.parseLatestEntry(''), null, '空字串應回 null');
  assert.strictEqual(mod.parseLatestEntry('<html>404</html>'), null, 'HTML 錯誤頁應回 null');
  assert.strictEqual(mod.parseLatestEntry('<entry><yt:videoId>短</yt:videoId></entry>'), null, '非法 ID 應回 null');
  const ok = mod.parseLatestEntry(
    '<feed><entry><yt:videoId>zv7BTH2Quzg</yt:videoId><title>a &amp; b</title><published>2026-08-09T03:55:47+00:00</published></entry>'
    + '<entry><yt:videoId>8j3g48Om-Ro</yt:videoId><title>舊片</title></entry></feed>'
  );
  assert.strictEqual(ok.videoId, 'zv7BTH2Quzg', '應取第一個 entry（最新影片）');
  assert.strictEqual(ok.title, 'a & b', 'XML escape 應還原');
  assert.ok(mod.CHANNEL_ID === 'UCddJpPmz3z66MHTRpuVr17A', 'channelId 應為 @ptcg-tw-sim 的頻道 ID');
});

await TA('⑭⭐⭐⭐fail-open 不得「倒退」：RSS 掛掉時要退回上次成功發布的值，不是 repo 內的舊值', async () => {
  const { pickNewest } = await import(pathToFileURL(FETCH_PATH).href);
  const oldRepo = { videoId: 'AAAAAAAAAAA', title: '舊片', publishedAt: '2026-01-01T00:00:00+00:00' };
  const live = { videoId: 'BBBBBBBBBBB', title: '上次發布', publishedAt: '2026-06-01T00:00:00+00:00' };
  const rss = { videoId: 'CCCCCCCCCCC', title: '最新', publishedAt: '2026-08-09T00:00:00+00:00' };
  assert.strictEqual(pickNewest([rss, live, oldRepo]).videoId, 'CCCCCCCCCCC', '三個都在 → 取 RSS 的最新片');
  assert.strictEqual(pickNewest([null, live, oldRepo]).videoId, 'BBBBBBBBBBB',
    'RSS 掛掉 → 必須是正式站現行值（退回 repo 舊值＝站上影片倒退）');
  assert.strictEqual(pickNewest([null, null, oldRepo]).videoId, 'AAAAAAAAAAA', '只剩 repo 值 → 用它');
  assert.strictEqual(pickNewest([null, null, null]), null, '全掛 → null（首頁整區不顯示）');
  // publishedAt 缺漏也不能讓比較炸掉
  assert.ok(pickNewest([{ videoId: 'DDDDDDDDDDD', title: '', publishedAt: '' }, live]).videoId === 'BBBBBBBBBBB',
    '沒有日期的候選不該蓋掉有日期的較新值');
});

// ══════════════════════════════════════════════════════════════════
// ⭐自我驗證：拿刻意寫壞的變體重跑同一組檢查，抓不到就代表守衛失效
// ══════════════════════════════════════════════════════════════════
const MUTANTS = [
  {
    name: 'iframe 沒被 {#if playing} 包住（等於直接嵌 YouTube）',
    src: CMP.replace('{#if playing}', '{#if true}').replace('{:else}', '{#if false}').replace('{/if}\n    </div>', '{/if}\n      {/if}\n    </div>'),
    checks: ['noIframe', 'gated'],
  },
  {
    name: 'iframe 換成 www.youtube.com（沒有隱私模式）',
    src: CMP.replace('https://www.youtube-nocookie.com/embed/', 'https://www.youtube.com/embed/'),
    checks: ['afterClick'],
  },
  {
    name: '沒有影片時仍然渲染整區（空殼佔位）',
    src: CMP.replace('{#if videoId}', '{#if true}'),
    checks: ['empty'],
  },
  {
    name: '縮圖拿掉 loading="lazy"（沒捲到也會下載）',
    src: CMP.replace(/\n\s*loading="lazy"/, ''),
    checks: ['noIframe'],
  },
];
const RUN = {
  noIframe: checkNoIframeBeforeClick,
  afterClick: checkIframeAfterClick,
  empty: checkEmptyRendersNothing,
  gated: async (s) => checkIframeGatedByPlaying(s),
};
for (const m of MUTANTS) {
  for (const c of m.checks) {
    await TA(`⭐自我驗證：壞樣本「${m.name}」必須被 ${c} 擋下`, async () => {
      let threw = false;
      try { await RUN[c](m.src); } catch { threw = true; }
      assert.ok(threw, `壞樣本竟然通過 ${c} —— 這條檢查是失效的，等於沒守衛`);
    });
  }
}

console.log(`\n=== v6.166 home-video facade: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
