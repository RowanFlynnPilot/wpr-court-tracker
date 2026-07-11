import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// publicDir points at the repo's generated data/ so feed.json is served in
// dev and copied into dist at build time. One mechanism for both.
// Three pages: the tracker (index), the newsletter digest card, and the
// social og-card - scripts/render-cards.mjs screenshots the latter two to
// dist/*.png at deploy time.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: '../data',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        digest: fileURLToPath(new URL('./mini-digest.html', import.meta.url)),
        og: fileURLToPath(new URL('./og-card.html', import.meta.url)),
        editor: fileURLToPath(new URL('./editor.html', import.meta.url)),
      },
    },
  },
});
