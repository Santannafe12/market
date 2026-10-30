import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@realtime/auction-sync': path.resolve(__dirname, '../api/src/realtime/auction-sync.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
