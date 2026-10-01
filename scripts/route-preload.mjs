/**
 * v6.463 build 後處理：替「純客戶端（ssr=false）預渲染殼」補上該路由自己的 modulepreload。
 *
 * 背景（fable 5.1 審查第 5 項＋本機量測，2026-10-01）：
 *   根 +layout 是 ssr=false ⇒ /tournament 等頁的預渲染 HTML 只是 app 殼，SvelteKit 只替殼層的
 *   start／app 與共用 chunk 寫 modulepreload。真正的頁面（layout 節點 0 ＋ 路由節點 ＋ 它們的靜態 import，
 *   /tournament 是 1.9MB 的對戰主程式）要等 start.js／app.js **下載並執行完、路由解析完**才開始抓 ⇒ 冷進站多一段序列等待。
 *   本腳本在 vite build 之後，讀 Vite manifest，把「這一頁一定會載」的 JS 補成 modulepreload（CSS 不動，理由見 injectPreload）。
 *
 * 原則（與 seo-prerender-meta.mjs 相同）：
 *   - 純靜態檔字串插入；**絕不丟例外**（找不到 manifest／檔案就 log 後略過，build 照常成功）。
 *   - 只處理「路徑與檔案一一對應」的路由 HTML；**不碰 index.html 與 404.html**（它們可能被當成其他路徑的
 *     SPA fallback，替別的頁面預載會白抓）。
 *   - 只收**靜態** import（dynamicImports 本來就是用到才載，不預載）。
 *   - 每個檔案先確認 build/ 裡真的存在才寫（寫錯也只是一個無效的 preload，不會壞頁面，但守衛要求零無效）。
 *   - 冪等：已經有同一個 href 就不重複寫；整段用標記包起來，重跑會先移除舊的。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.ROUTE_PRELOAD_BUILD_DIR || join(ROOT, 'build');
const KIT = process.env.ROUTE_PRELOAD_KIT_DIR || join(ROOT, '.svelte-kit');
const MANIFEST = join(KIT, 'output/client/.vite/manifest.json');
const NODES_DIR = join(KIT, 'generated/client-optimized/nodes');

/** 預渲染 HTML 檔名 → 路由的 +page.svelte（只列「路徑與檔案一一對應」的頁）。 */
export const ROUTE_HTML = {
  'tournament.html': 'src/routes/tournament/+page.svelte',
  'cards.html': 'src/routes/cards/+page.svelte',
  'decks.html': 'src/routes/decks/+page.svelte',
  'deck-posts.html': 'src/routes/deck-posts/+page.svelte',
  'friends.html': 'src/routes/friends/+page.svelte',
};
const LAYOUT = 'src/routes/+layout.svelte';
const MARK_A = '<!-- route-preload:start -->';
const MARK_B = '<!-- route-preload:end -->';

/** 由 .svelte-kit/generated 的節點檔找出「哪個節點編號對應哪個元件」。 */
export function nodeIdOf(component, nodesDir = NODES_DIR) {
  for (let i = 0; i < 64; i++) {
    const f = join(nodesDir, i + '.js');
    if (!existsSync(f)) continue;
    const src = readFileSync(f, 'utf8');
    if (src.includes('/' + component + '"')) return i;
  }
  return -1;
}

/** 從 manifest 某個鍵出發，收集靜態 import 閉包的 JS 檔與 CSS 檔（依深度優先順序，去重）。 */
export function closure(manifest, keys) {
  const js = [], css = [], seen = new Set();
  const walk = (k) => {
    if (seen.has(k)) return; seen.add(k);
    const e = manifest[k]; if (!e) return;
    if (e.file && e.file.endsWith('.js')) js.push(e.file);
    for (const c of e.css || []) if (!css.includes(c)) css.push(c);
    for (const i of e.imports || []) walk(i);
  };
  for (const k of keys) walk(k);
  return { js, css };
}

/** 對一份 HTML 插入預載標籤；回傳 { html, added }。已有的 href 不重複。 */
export function injectPreload(html, { js }) {
  // 先移除上一次插入的整段（含我們自己補的換行與縮排 '\\n\\t'），重跑才會逐字相同（冪等）。
  html = html.replace(new RegExp(MARK_A + '[\\s\\S]*?' + MARK_B + '\\n\\t'), '');
  const has = (f) => html.includes('"./' + f + '"') || html.includes('"/' + f + '"');
  const tags = [];
  for (const f of js) if (!has(f)) tags.push(`<link href="./${f}" rel="modulepreload">`);
  // ⚠ CSS 刻意**不**預載：本機量測 `<link rel=preload as=style>` 之後 SvelteKit 自己插的 stylesheet 會再抓一次
  //   （兩邊的請求模式對不上 ⇒ 重複下載），得不償失；CSS 很小，留給 SvelteKit 照原本的時機載。
  if (!tags.length || !html.includes('</head>')) return { html, added: 0 };
  const block = MARK_A + '\n\t\t' + tags.join('\n\t\t') + '\n\t\t' + MARK_B + '\n\t';
  return { html: html.replace('</head>', block + '</head>'), added: tags.length };
}

export function run({ out = OUT, kit = KIT, log = console.log } = {}) {
  const manifestPath = join(kit, 'output/client/.vite/manifest.json');
  const nodesDir = join(kit, 'generated/client-optimized/nodes');
  if (!existsSync(manifestPath)) { log('[route-preload] 找不到 Vite manifest，略過'); return { done: 0 }; }
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) { log('[route-preload] manifest 讀取失敗，略過：' + e.message); return { done: 0 }; }
  const keyOfNode = (id) => `.svelte-kit/generated/client-optimized/nodes/${id}.js`;
  const layoutId = nodeIdOf(LAYOUT, nodesDir);
  let done = 0;
  for (const [file, comp] of Object.entries(ROUTE_HTML)) {
    try {
      const p = join(out, file);
      if (!existsSync(p)) { log(`[route-preload] ${file} 不存在，略過`); continue; }
      const id = nodeIdOf(comp, nodesDir);
      if (id < 0 || layoutId < 0 || !manifest[keyOfNode(id)] || !manifest[keyOfNode(layoutId)]) { log(`[route-preload] ${file} 找不到節點，略過`); continue; }
      const c = closure(manifest, [keyOfNode(layoutId), keyOfNode(id)]);
      // 只保留 build/ 裡真的存在的檔
      c.js = c.js.filter((f) => existsSync(join(out, f)));
      c.css = c.css.filter((f) => existsSync(join(out, f)));
      const r = injectPreload(readFileSync(p, 'utf8'), c);
      writeFileSync(p, r.html);
      log(`[route-preload] ${file}：補 ${r.added} 個預載（節點 ${layoutId}+${id}）`);
      done++;
    } catch (e) { log(`[route-preload] ${file} 失敗，略過：${e.message}`); }
  }
  return { done };
}

if (import.meta.url === `file://${process.argv[1]}`) run();
