import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

export const DIR_RESULTADOS = path.join(import.meta.dirname, '..', 'capturas');
mkdirSync(DIR_RESULTADOS, { recursive: true });
const RELATORIO = path.join(DIR_RESULTADOS, 'relatorio.txt');

export const SENHA_DEMO = 'demo123';

/**
 * Registra erros de console e respostas HTTP >= 400 da API no relatório.
 * `esperados` são trechos de URL cujo 4xx é esperado no teste (ex.: estouro de limite = 403).
 */
export function monitorar(page: Page, info: TestInfo, esperados: RegExp[] = []) {
  const registrar = (linha: string) => appendFileSync(RELATORIO, `[${info.title}] ${linha}\n`);
  page.on('console', (m) => {
    if (m.type() === 'error') registrar(`CONSOLE ${m.text().slice(0, 400)}`);
  });
  page.on('pageerror', (e) => registrar(`PAGEERROR ${e.message}`));
  page.on('response', async (r) => {
    const url = r.url();
    if (!url.includes('/api/') || r.status() < 400) return;
    const esperado = esperados.some((re) => re.test(`${r.request().method()} ${url} ${r.status()}`));
    let corpo = '';
    try {
      corpo = (await r.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    registrar(`${esperado ? 'HTTP(esperado)' : 'HTTP'} ${r.status()} ${r.request().method()} ${url.replace(/^.*\/api/, '')} ${corpo}`);
  });
}

export async function foto(page: Page, nome: string, fullPage = true) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(DIR_RESULTADOS, `${nome}.png`), fullPage });
}

export async function loginClinica(page: Page, email: string, senha = SENHA_DEMO) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function loginAdmin(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill('admin@sistema.local');
  await page.getByLabel('Senha').fill('admin123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Espera um toast (sonner) com o texto. */
export async function toast(page: Page, texto: string | RegExp) {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: texto }).first()).toBeVisible();
}

/** Clica num item de Select (Radix). */
export async function escolher(page: Page, gatilho: ReturnType<Page['getByLabel']>, opcao: string | RegExp) {
  await gatilho.click();
  await page.getByRole('option', { name: opcao }).first().click();
}
