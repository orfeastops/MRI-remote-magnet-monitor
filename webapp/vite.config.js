import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'https://hetzner.karnagio.org', changeOrigin: true, secure: false },
      '/ws':  { target: 'wss://hetzner.karnagio.org',  changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 600 },
});
