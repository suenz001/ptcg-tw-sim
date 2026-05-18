import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'url';

// v4.64 Phase 3c: Oracle backend mode swap
//   When VITE_BACKEND_MODE=oracle is set at build time, transparently redirect
//   any import of '$lib/game/room' to '$lib/game/room-oracle' (drop-in replacement).
//   Default mode (no env var) keeps firebase room.ts unchanged.
const isOracleMode = process.env.VITE_BACKEND_MODE === 'oracle';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: isOracleMode
      ? [
          {
            find: /^\$lib\/game\/room$/,
            replacement: fileURLToPath(new URL('./src/lib/game/room-oracle.ts', import.meta.url)),
          },
        ]
      : [],
  },
});
