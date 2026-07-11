import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// publicDir points at the repo's generated data/ so feed.json is served in
// dev and copied into dist at build time. One mechanism for both.
// Two pages: the tracker (index) and the newsletter digest card, which
// scripts/render-digest.mjs screenshots to dist/digest.png at deploy time.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: '../data',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        digest: fileURLToPath(new URL('./mini-digest.html', import.meta.url)),
      },
    },
  },
});
