import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: process.env.VITE_DISABLE_HMR === '1' ? false : {
      host: '127.0.0.1',
      port: 5173,
      clientPort: 5173,
    },
  },
});
