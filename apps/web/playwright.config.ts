/**
 * Smoke test E2E (Playwright). Pré-requisitos: docker compose up, db:migrate + db:seed e
 * `npm run dev` rodando (API :3333 + Web :5173). Rodar: `npm run e2e` (na raiz ou em apps/web).
 * Screenshots e o relatório de erros (console / HTTP 4xx-5xx inesperados) ficam em e2e/capturas/.
 */
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Specs em e2e/smoke (e2e/resultados antigo ficou com ACL travada no SMB e não pode ser varrido).
  testDir: './e2e/smoke',
  // Artefatos (traces/vídeos) fora do disco de rede: o SMB trava na limpeza do diretório.
  outputDir: path.join(os.tmpdir(), 'sistema-clinica-e2e'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:5173',
    headless: true,
    viewport: { width: 1366, height: 820 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } } }],
});
