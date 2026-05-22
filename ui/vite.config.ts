import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  envDir: '..', // load .env from x402-demo/ root
  plugins: [
    react(),
    nodePolyfills({ include: ['buffer', 'crypto', 'stream', 'util'] }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4022',
        changeOrigin: true,
      },
    },
  },
});
