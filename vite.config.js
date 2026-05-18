// @ts-nocheck — vite.config.js 用 plain JS plugin，不需要 tsc 檢查
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

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

  return { plugins };
});
