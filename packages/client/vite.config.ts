import { defineConfig } from 'vite';

// Dev: the browser talks to the dev game server (port 5175) through this proxy, so the client
// always connects to its own host at /ws (production serves both from one port).
export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:5175', ws: true },
      '/plugins': { target: 'http://127.0.0.1:5175' },
    },
  },
});
