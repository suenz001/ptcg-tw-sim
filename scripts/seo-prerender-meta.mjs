/**
 * SEO build 後處理（v5.654）— 為各「內容路由」的預渲染 HTML 差異化 head。
 *
 * 背景：全站 root +layout 是 ssr=false，所以每個路由 prerender 出來的 HTML 都是同一份
 *   app.html 殼（canonical=首頁、title/og/noscript 都是首頁版本）→ Google 把 /cards、/decks、
 *   /tournament 當成首頁的重複頁（「替代頁面」），只索引首頁。
 * 本腳本在 `vite build` 之後，把這幾個路由產出的靜態 HTML 的
 *   <title> / description / canonical / og:* / twitter:* / noscript 主標題段
 *   改成「自我指向 + 各頁專屬」，讓搜尋引擎能各自索引。
 *
 * 設計原則：
 *   - 針對 app.html 中「寫死的首頁字串」做精準字串替換（這些字串會原封不動出現在每個預渲染檔）。
 *   - **絕不丟例外**：找不到 build 目錄 / 檔案 / 字串都只記 log 後略過，確保不會弄壞 build。
 *   - 純靜態檔改寫，零執行期 / 零 SSR 風險。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.ptcg-tw-sim.com';

// app.html 寫死的「首頁」字串（替換來源；與 src/app.html 必須一致）
const HOME = {
  title: 'PTCG 實體賽事演練 — 寶可夢集換式卡牌對戰模擬器 | Pokémon TCG Simulator',
  desc: '專為台灣寶可夢集換式卡牌（PTCG）玩家打造的免費網頁版對戰模擬器。支援 H / I / J 標準賽制環境、繁體中文卡牌資料庫、牌組構築、實戰模擬，免安裝、免登入、即開即戰。Free online Pokémon TCG simulator (PTCG sim) — build decks and battle in your browser, no download required.',
  canonical: SITE + '/',
  ogTitle: 'PTCG 實體賽事演練 — 寶可夢集換式卡牌對戰模擬器 | Pokémon TCG Simulator',
  ogDesc: '專為台灣 PTCG 玩家打造的線上對戰演練平台，支援 H / I / J 標環境，免安裝、即開即戰。',
  ogUrl: SITE + '/',
  twTitle: 'PTCG 實體賽事演練 — 寶可夢集換式卡牌模擬器',
  twDesc: '台灣 PTCG 玩家專屬的免費網頁版對戰演練 — 牌組構築 + 實戰模擬。',
  noscriptH1: 'PTCG 實體賽事演練 — 免費線上寶可夢集換式卡牌對戰模擬器（Pokémon TCG Simulator）',
  noscriptP: '專為台灣寶可夢集換式卡牌（PTCG）玩家打造的免費網頁版對戰模擬器。支援 H / I / J 標準賽制環境、繁體中文卡牌資料庫、牌組構築與線上對戰，免安裝、免登入、即開即戰。A free online Pokémon TCG simulator and deck builder — build decks and battle in your browser, no download required.',
};

// 各路由專屬 meta（route = build 內檔名/資料夾；slug 用於 canonical）
const ROUTES = {
  cards: {
    title: '卡牌資料庫 — PTCG 實體賽事演練｜寶可夢集換式卡牌 H / I / J 標',
    desc: '完整繁體中文寶可夢集換式卡牌（PTCG）資料庫，標準賽 H / I / J 標。可查卡牌招式、特性、卡號與圖片，免費線上瀏覽。',
    ogDesc: '繁體中文 PTCG 卡牌資料庫，標準賽 H / I / J 標，可查招式、特性、卡號。',
    twDesc: '繁體中文 PTCG 卡牌資料庫 — H / I / J 標，查招式特性卡號。',
    h1: 'PTCG 卡牌資料庫 — 繁體中文寶可夢集換式卡牌（標準賽 H / I / J 標）',
    p: '完整的繁體中文寶可夢集換式卡牌（PTCG）資料庫，收錄標準賽 H / I / J 標的卡牌，可查詢卡牌的招式、特性、卡號與圖片，免費線上瀏覽。',
  },
  decks: {
    title: '牌組構築 — PTCG 實體賽事演練｜線上組牌與測試',
    desc: '線上構築、測試與分享你的寶可夢集換式卡牌（PTCG）牌組，支援標準賽 H / I / J 標，免安裝、免費使用。',
    ogDesc: '線上構築、測試與分享你的 PTCG 牌組，支援 H / I / J 標。',
    twDesc: '線上組牌、測試、分享你的 PTCG 牌組 — H / I / J 標。',
    h1: 'PTCG 牌組構築 — 線上組牌、測試與分享（標準賽 H / I / J 標）',
    p: '在瀏覽器裡構築、測試與分享你的寶可夢集換式卡牌（PTCG）牌組，支援標準賽 H / I / J 標，免安裝、免登入即可使用。',
  },
  tournament: {
    title: '錦標賽 — PTCG 實體賽事演練｜線上單敗淘汰／瑞士制賽事',
    desc: '報名 PTCG 線上錦標賽，支援單敗淘汰與瑞士制 + Top Cut 賽制，與其他玩家競技，免費參加。',
    ogDesc: '報名 PTCG 線上錦標賽（單敗淘汰／瑞士制 + Top Cut），與玩家競技。',
    twDesc: 'PTCG 線上錦標賽 — 單敗淘汰／瑞士制，與玩家競技。',
    h1: 'PTCG 線上錦標賽 — 單敗淘汰／瑞士制 + Top Cut',
    p: '報名寶可夢集換式卡牌（PTCG）線上錦標賽，支援單敗淘汰與瑞士制 + Top Cut 賽制，與其他玩家競技，免費參加。',
  },
};

// 純函式：把首頁殼 HTML 改寫成某路由專屬 head（找不到字串就略過該項）。回傳 {html, changed}
export function transform(html, slug, cfg) {
  const canonical = SITE + '/' + slug;
  let changed = 0;
  const rep = (from, to) => {
    if (from !== to && html.includes(from)) { html = html.split(from).join(to); changed++; }
  };
  rep('<title>' + HOME.title + '</title>', '<title>' + cfg.title + '</title>');
  rep('<meta name="description" content="' + HOME.desc + '" />', '<meta name="description" content="' + cfg.desc + '" />');
  rep('<link rel="canonical" href="' + HOME.canonical + '" />', '<link rel="canonical" href="' + canonical + '" />');
  rep('<meta property="og:title" content="' + HOME.ogTitle + '" />', '<meta property="og:title" content="' + cfg.title + '" />');
  rep('<meta property="og:description" content="' + HOME.ogDesc + '" />', '<meta property="og:description" content="' + cfg.ogDesc + '" />');
  rep('<meta property="og:url" content="' + HOME.ogUrl + '" />', '<meta property="og:url" content="' + canonical + '" />');
  rep('<meta name="twitter:title" content="' + HOME.twTitle + '" />', '<meta name="twitter:title" content="' + cfg.title + '" />');
  rep('<meta name="twitter:description" content="' + HOME.twDesc + '" />', '<meta name="twitter:description" content="' + cfg.twDesc + '" />');
  rep('<h1>' + HOME.noscriptH1 + '</h1>', '<h1>' + cfg.h1 + '</h1>');
  rep('<p>' + HOME.noscriptP + '</p>', '<p>' + cfg.p + '</p>');
  return { html, changed };
}

function processRoute(buildDir, slug, cfg) {
  const candidates = [join(buildDir, slug + '.html'), join(buildDir, slug, 'index.html')];
  const file = candidates.find((f) => existsSync(f));
  if (!file) { console.log('[seo] skip ' + slug + '（找不到預渲染檔：' + candidates.join(' / ') + '）'); return; }
  try {
    const orig = readFileSync(file, 'utf8');
    const { html, changed } = transform(orig, slug, cfg);
    if (changed > 0 && html !== orig) {
      writeFileSync(file, html);
      console.log('[seo] ' + slug + ' → ' + file + '（替換 ' + changed + ' 項 head）');
    } else {
      console.log('[seo] ' + slug + ' 無替換（字串未命中，可能 app.html 已改，請更新本腳本 HOME 常數）');
    }
  } catch (e) {
    console.log('[seo] ' + slug + ' 處理失敗（略過，不影響 build）：' + (e && e.message));
  }
}

function main() {
  try {
    const buildDir = join(ROOT, 'build');
    if (!existsSync(buildDir)) { console.log('[seo] 無 build 目錄，略過後處理'); return; }
    for (const [slug, cfg] of Object.entries(ROUTES)) processRoute(buildDir, slug, cfg);
    console.log('[seo] 完成內容路由 head 差異化');
  } catch (e) {
    console.log('[seo] 後處理發生例外（略過，不影響 build）：' + (e && e.message));
  }
}

// --selftest：對 src/app.html 跑 transform 驗證替換生效（不寫檔）
if (process.argv.includes('--selftest')) {
  const sample = readFileSync(join(ROOT, 'src/app.html'), 'utf8');
  let ok = true;
  for (const [slug, cfg] of Object.entries(ROUTES)) {
    const { html, changed } = transform(sample, slug, cfg);
    const wantCanon = SITE + '/' + slug;
    const a = changed >= 8;
    const b = html.includes('<link rel="canonical" href="' + wantCanon + '" />');
    const c = html.includes('<title>' + cfg.title + '</title>');
    const d = html.includes('<h1>' + cfg.h1 + '</h1>');
    const e = !html.includes('<link rel="canonical" href="' + SITE + '/" />'); // 首頁 canonical 應已被換掉
    console.log('  ' + slug + ': changed=' + changed + ' canonical=' + b + ' title=' + c + ' h1=' + d + ' noHomeCanon=' + e);
    if (!(a && b && c && d && e)) ok = false;
  }
  console.log(ok ? '\nSELFTEST PASS' : '\nSELFTEST FAIL');
  process.exit(ok ? 0 : 1);
} else {
  main();
}
