import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'url';

// v4.66 Hotfix: 改用 loadEnv 讀 .env.local（process.env 在 vite.config 裡讀不到）
//   v4.64 用 process.env.VITE_BACKEND_MODE 是錯的 — vite 的 dotenv 只 inject 到
//   client 的 import.meta.env，並不會填 Node 端的 process.env。
//   正確做法：用 defineConfig(({ mode }) => {}) 的 callback form + loadEnv()。
export default defineConfig(({ mode }) => {
  // loadEnv 會依序載入：.env → .env.local → .env.[mode] → .env.[mode].local
  // 第三個參數 '' 代表載入所有 prefix（不只 VITE_）。
  const env = loadEnv(mode, process.cwd(), '');
  const isOracleMode = env.VITE_BACKEND_MODE === 'oracle';

  // 印出來方便 debug build 路徑
  // eslint-disable-next-line no-console
  console.log('[vite.config] mode=' + mode + ' VITE_BACKEND_MODE=' + (env.VITE_BACKEND_MODE || '(empty)') + ' isOracleMode=' + isOracleMode);

  return {
    plugins: [sveltekit()],
    resolve: {
      // Oracle build：把所有 `import from '$lib/game/room'` 透明替換為 room-oracle.ts
      alias: isOracleMode
        ? [
            {
              find: /^\$lib\/game\/room$/,
              replacement: fileURLToPath(new URL('./src/lib/game/room-oracle.ts', import.meta.url)),
            },
          ]
        : [],
    },
  };
});
