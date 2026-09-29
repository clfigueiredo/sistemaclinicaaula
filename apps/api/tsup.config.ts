import { defineConfig } from 'tsup';

// Build de produção: gera dist/server.js (API) e dist/worker.js (workers BullMQ em processo separado).
export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
});
