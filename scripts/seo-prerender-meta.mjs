/**
 * SEO build 後處理（v5.654）— 為各「內容路由」與「卡片頁」的預渲染 HTML 差異化 head。
 *
 * 背景：root +layout ssr=false → /cards /decks /tournament 的 prerender 都是同一份 app.html 殼
 *   （canonical=首頁、title/og/noscript 都首頁版）→ Google 當成首頁重複頁，只索引首頁。
 *   卡片頁 /card/{id}/ 是 ssr=true，canonical/og:title/description 已各卡正確，但 og:url / twitter:* /
 *   twitter:image 仍殘留 app.html 的首頁值（社群分享預覽會顯示首頁）。
 * 本腳本在 `vite build` 之後：
 *   (1) 內容路由：改寫 title／description／canonical／og／twitter／noscript 主標題段 → 自我指向 + 各頁專屬。
 *   (2) 卡片頁：把 og:url / twitter:title / twitter:description / twitter:image 改成各卡自己的
 *       （從該頁已正確的 canonical / og:title / description / og:image 取值）。
 * 原則：純靜態檔字串替換；絕不丟例外（找不到檔/字串只 log 後略過，不會弄壞 build）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.ptcg-tw-sim.com';

const HOME = {
  title: 'PTCG 實體賽事演練 — 寶可夢集換式卡牌對戰模擬器 | Pokémon TCG Simulator',
  desc: '專為台灣寶可夢集換式卡牌（PTCG）玩家打造的免費網頁版對戰模擬器。支援 H / I / J 標準賽制環境、繁體中文卡牌資料庫、牌組構築、實戰模擬，免安裝、免登入、即開即戰。Free online Pokémon TCG simulator (PTCG sim) — build decks and battle in your browser, no download required.',
  canonical: SITE + '/',
  ogTitle: 'PTCG 實體賽事演練 — 寶可夢集換式卡牌對戰模擬器 | Pokémon TCG Simulator',
  ogDesc: '專為台灣 PTCG 玩家打造的線上對戰演練平台，支援 H / I / J 標環境，免安裝、即開即戰。',
  ogUrl: SITE + '/',
  ogImage: SITE + '/og-image.png',
  twTitle: 'PTCG 實體賽事演練 — 寶可夢集換式卡牌模擬器',
  twDesc: '台灣 PTCG 玩家專屬的免費網頁版對戰演練 — 牌組構築 + 實戰模擬。',
  twImage: SITE + '/og-image.png',
  noscriptH1: 'PTCG 實體賽事演練 — 免費線上寶可夢集換式卡牌對戰模擬器（Pokémon TCG Simulator）',
  noscriptP: '專為台灣寶可夢集換式卡牌（PTCG）玩家打造的免費網頁版對戰模擬器。支援 H / I / J 標準賽制環境、繁體中文卡牌資料庫、牌組構築與線上對戰，免安裝、免登入、即開即戰。A free online Pokémon TCG simulator and deck builder — build decks and battle in your browser, no download required.',
};

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

// 內容路由：首頁殼 → 各頁專屬 head（找不到字串就略過該項）
export function transform(html, slug, cfg) {
  const canonical = SITE + '/' + slug;
  let changed = 0;
  const rep = (from, to) => { if (from !== to && html.includes(from)) { html = html.split(from).join(to); changed++; } };
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

// 卡片頁：用該頁已正確的 canonical/og:title/description/og:image，補正 og:url + twitter:*
export function transformCard(html) {
  const grab = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const canon = grab(/<link rel="canonical" href="([^"]+)"/);
  const ogTitle = grab(/<meta property="og:title" content="([^"]+)"/);
  const desc = grab(/<meta name="description" content="([^"]+)"/);
  const ogImage = grab(/<meta property="og:image" content="([^"]+)"/);
  if (!canon || !ogTitle) return { html, changed: 0 }; // 非預期卡片頁，略過
  let changed = 0;
  const rep = (from, to) => { if (to && from !== to && html.includes(from)) { html = html.split(from).join(to); changed++; } };
  rep('<meta property="og:url" content="' + HOME.ogUrl + '" />', '<meta property="og:url" content="' + canon + '" />');
  rep('<meta name="twitter:title" content="' + HOME.twTitle + '" />', '<meta name="twitter:title" content="' + ogTitle + '" />');
  if (desc) rep('<meta name="twitter:description" content="' + HOME.twDesc + '" />', '<meta name="twitter:description" content="' + desc + '" />');
  if (ogImage) rep('<meta name="twitter:image" content="' + HOME.twImage + '" />', '<meta name="twitter:image" content="' + ogImage + '" />');
  return { html, changed };
}

function processRoute(buildDir, slug, cfg) {
  const candidates = [join(buildDir, slug + '.html'), join(buildDir, slug, 'index.html')];
  const file = candidates.find((f) => existsSync(f));
  if (!file) { console.log('[seo] skip ' + slug + '（找不到預渲染檔）'); return; }
  try {
    const orig = readFileSync(file, 'utf8');
    const { html, changed } = transform(orig, slug, cfg);
    if (changed > 0 && html !== orig) { writeFileSync(file, html); console.log('[seo] ' + slug + ' 替換 ' + changed + ' 項'); }
    else console.log('[seo] ' + slug + ' 無替換（字串未命中，請檢查 app.html 是否改過）');
  } catch (e) { console.log('[seo] ' + slug + ' 失敗（略過）：' + (e && e.message)); }
}

function processCardPages(buildDir) {
  const cardDir = join(buildDir, 'card');
  if (!existsSync(cardDir)) { console.log('[seo] 無 card 目錄，略過卡片頁'); return; }
  let done = 0, touched = 0;
  let ids = [];
  try { ids = readdirSync(cardDir); } catch (e) { console.log('[seo] 讀 card 目錄失敗（略過）：' + (e && e.message)); return; }
  for (const id of ids) {
    const f = join(cardDir, id, 'index.html');
    if (!existsSync(f)) continue;
    try {
      const orig = readFileSync(f, 'utf8');
      const { html, changed } = transformCard(orig);
      done++;
      if (changed > 0 && html !== orig) { writeFileSync(f, html); touched++; }
    } catch (e) { /* 單張失敗略過，不影響其餘 */ }
  }
  console.log('[seo] 卡片頁處理 ' + done + ' 張，補正 ' + touched + ' 張的 og:url/twitter');
}

function main() {
  try {
    const buildDir = join(ROOT, 'build');
    if (!existsSync(buildDir)) { console.log('[seo] 無 build 目錄，略過'); return; }
    for (const [slug, cfg] of Object.entries(ROUTES)) processRoute(buildDir, slug, cfg);
    processCardPages(buildDir);
    console.log('[seo] 完成');
  } catch (e) { console.log('[seo] 後處理例外（略過，不影響 build）：' + (e && e.message)); }
}

if (process.argv.includes('--selftest')) {
  const sample = readFileSync(join(ROOT, 'src/app.html'), 'utf8');
  let ok = true;
  // 內容路由
  for (const [slug, cfg] of Object.entries(ROUTES)) {
    const { html, changed } = transform(sample, slug, cfg);
    const wantCanon = SITE + '/' + slug;
    const pass = changed >= 8
      && html.includes('<link rel="canonical" href="' + wantCanon + '" />')
      && html.includes('<title>' + cfg.title + '</title>')
      && html.includes('<h1>' + cfg.h1 + '</h1>')
      && !html.includes('<link rel="canonical" href="' + SITE + '/" />');
    console.log('  route ' + slug + ': changed=' + changed + ' ' + (pass ? 'OK' : 'FAIL'));
    if (!pass) ok = false;
  }
  // 卡片頁（合成樣本：canonical/og:title/desc/og:image 已各卡，og:url/twitter 仍首頁）
  let cardSample = sample
    .replace('<link rel="canonical" href="' + SITE + '/" />', '<link rel="canonical" href="' + SITE + '/card/9809/" />')
    .replace('<meta property="og:title" content="' + HOME.ogTitle + '" />', '<meta property="og:title" content="小炭仔 SV5K 039/071｜PTCG 卡牌資料庫" />')
    .replace('<meta name="description" content="' + HOME.desc + '" />', '<meta name="description" content="小炭仔（寶可夢，標準標記 H）。" />')
    .replace('<meta property="og:image" content="' + SITE + '/og-image.png" />', '<meta property="og:image" content="https://asia.pokemon-card.com/tw/card-img/tw00009809.png" />');
  const cr = transformCard(cardSample);
  const cardPass = cr.changed >= 3
    && cr.html.includes('<meta property="og:url" content="' + SITE + '/card/9809/" />')
    && cr.html.includes('<meta name="twitter:title" content="小炭仔 SV5K 039/071｜PTCG 卡牌資料庫" />')
    && cr.html.includes('<meta name="twitter:image" content="https://asia.pokemon-card.com/tw/card-img/tw00009809.png" />')
    && !cr.html.includes('<meta property="og:url" content="' + SITE + '/" />');
  console.log('  card: changed=' + cr.changed + ' ' + (cardPass ? 'OK' : 'FAIL'));
  if (!cardPass) ok = false;
  console.log(ok ? '\nSELFTEST PASS' : '\nSELFTEST FAIL');
  process.exit(ok ? 0 : 1);
} else {
  main();
}
