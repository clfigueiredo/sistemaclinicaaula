import { defineConfig } from 'vitest/config';

// Os testes usam um banco SEPARADO (DATABASE_URL_TESTE, padrão clinica_teste), criado e migrado
// automaticamente em test/setup-global.ts. Requer o Postgres do docker-compose de pé.
const urlTeste =
  process.env.DATABASE_URL_TESTE ?? 'postgresql://clinica:clinica@localhost:5432/clinica_teste?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/setup-global.ts'],
    env: { DATABASE_URL: urlTeste, NODE_ENV: 'test', EXECUTAR_WORKERS: 'false' },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
