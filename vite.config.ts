import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5173, strictPort: false },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
