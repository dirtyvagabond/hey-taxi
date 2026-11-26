import { defineConfig } from 'vite';

// Production bundle of the game server: one self-contained server.mjs (Node built-ins stay
// external), so a release keeps running exactly the code it was built from.
export default defineConfig({
  ssr: { noExternal: true },
  build: { ssr: 'src/main.ts', target: 'node22', minify: false, rollupOptions: { output: { entryFileNames: 'server.mjs' } } },
});
