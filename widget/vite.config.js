import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// publicDir points at the repo's generated data/ so feed.json is served in
// dev and copied into dist at build time. One mechanism for both.
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: '../data',
});
