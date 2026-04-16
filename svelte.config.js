import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-static turns the app into a pure SPA (no Node server).
    // `fallback: '404.html'` means any unknown path serves the SPA shell —
    // GitHub Pages picks up 404.html automatically, so client-side routing works.
    adapter: adapter({
      fallback: '404.html',
      strict: false
    }),
    paths: {
      // Local dev: served at /
      // GitHub Pages: served at /ptcg-tw-sim/ (set via BASE_PATH env in CI)
      base: process.env.BASE_PATH ?? ''
    }
  }
};

export default config;
