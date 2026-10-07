// @ts-nocheck — vite.config.js 用 plain JS plugin，不需要 tsc 檢查
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import { createHash } from 'crypto';
import { readdirSync, readFileSync, existsSync } from 'fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// v4.67: 用 resolveId plugin 取代 alias regex
//   v4.64 alias `find: /^\$lib\/game\/room$/` 失敗 — SvelteKit 的 $lib plugin
//   會先把 `$lib/...` 解成絕對路徑，到我的 regex 檢查時 source 已是絕對路徑 →
//   永遠匹配不到。
//   改用 plugin resolveId hook + enforce='pre'，比 SvelteKit alias 更早攔截。
function oracleSwapPlugin() {
  const oracleRoomPath = path.resolve(__dirname, 'src/lib/game/room-oracle.ts');
  return {
    name: 'oracle-room-swap',
    enforce: 'pre',  // 比其他 plugin 先 run
    resolveId(source, importer) {
      // room-oracle 內部 import './room' 是要拿 types 跟 helpers，不能換成自己
      if (importer && importer.includes('room-oracle')) return null;

      // 攔截三種情況：
      //   1. `$lib/game/room`（page.svelte 等用 $lib alias 的）
      //   2. `./room`（從 src/lib/game/ 下某檔 relative import 的）
      //   3. 絕對路徑 .../src/lib/game/room[.ts]（SvelteKit alias 解析後的）
      let hit = false;
      if (source === '$lib/game/room') {
        hit = true;
      } else if (source === './room' && importer && importer.includes('src/lib/game/')) {
        hit = true;
      } else if (/[\\/]src[\\/]lib[\\/]game[\\/]room(\.ts)?$/.test(source)) {
        hit = true;
      }
      if (hit) {
        // eslint-disable-next-line no-console
        console.log('[oracle-room-swap]', source, '→ room-oracle.ts');
        return oracleRoomPath;
      }
      return null;
    },
  };
}

// ⭐v6.509 卡包資料改用「內容」當快取依據（站長 2026-10-07：「卡片資料沒變就不用重新下載。以後只有補新卡包時才會重抓」）。
//   原本 /cards/*.json、/card-set-map.json 一律帶 ?v=網站版本 ⇒ 每出一版（就算卡片一張都沒動），玩家都要整批重抓。
//   改成建置時算每個檔的內容雜湊（sha1 前 10 碼），以 __CARD_DATA_HASHES__ 注入前端；網址帶 ?v=雜湊
//   ⇒ 檔案內容沒變，網址就不變，瀏覽器／Service Worker／CDN 的快取都可以一直沿用。
//   ⚠ 只讀 static/ 下的檔案；build 指令裡沒有任何步驟會在 vite 啟動後改寫卡包資料。
export function cardDataHashes(root = __dirname) {
  const out = {};
  const h = (p) => createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 10);
  const dir = path.join(root, 'static', 'cards');
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.json')) out['cards/' + f] = h(path.join(dir, f));
  const map = path.join(root, 'static', 'card-set-map.json');
  if (existsSync(map)) out['card-set-map.json'] = h(map);
  return out;
}

export default defineConfig(({ mode }) => {
  // loadEnv 才能讀 .env.local（v4.66 修這層）
  const env = loadEnv(mode, process.cwd(), '');
  const isOracleMode = env.VITE_BACKEND_MODE === 'oracle';

  // eslint-disable-next-line no-console
  console.log('[vite.config] mode=' + mode + ' VITE_BACKEND_MODE=' + (env.VITE_BACKEND_MODE || '(empty)') + ' isOracleMode=' + isOracleMode);

  const plugins = [sveltekit()];
  if (isOracleMode) {
    plugins.unshift(oracleSwapPlugin());  // 放在第一個確保 enforce:pre 先 run
  }

  // ⭐v6.509 合併過小的共用程式片段（< 1.5KB）：v6.507 起共用元件讓 Rollup 把 Svelte 執行環境切得更碎，
  //   首頁第一批 modulepreload 從 12 變 13（test-v6474 E0），本機 300ms 延遲量測冷進站多一輪約 0.3 秒。
  //   合併後首頁 1.89→1.55 秒、錦標賽 1.92→1.62 秒、牌組 1.90→1.61 秒（4 次皆同）。
  //   Rollup 只在「不會多執行任何副作用」時才合併（官方 output.experimentalMinChunkSize 的保證）。
  return {
    plugins,
    define: { __CARD_DATA_HASHES__: JSON.stringify(cardDataHashes()) },
    build: { rollupOptions: { output: { experimentalMinChunkSize: 1500 } } },
  };
});
