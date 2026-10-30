import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const hub = process.env.AGENT_HUB_DEV_TARGET ?? 'http://127.0.0.1:7780';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: hub, changeOrigin: true },
      '/ca.crt': { target: hub, changeOrigin: true },
      '/ws': { target: hub.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
