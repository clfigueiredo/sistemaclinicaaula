import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

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
  // O login tem rate limit (10/min por IP): com 429, espera a janela e tenta de novo.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(senha);
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Entrar' }).click(),
    ]);
    if (resposta.status() !== 429) break;
    await page.waitForTimeout(61_000);
  }
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

// ----------------------------------------------------------------------------- fase 2: helpers de API (preparação de dados)


const tokens = new Map<string, string>();

/** Token da clínica via API (cacheado por e-mail — o login tem rate limit de 10/min por IP). */
export async function tokenClinica(request: APIRequestContext, email: string, senha = SENHA_DEMO): Promise<string> {
  const salvo = tokens.get(email);
  if (salvo) return salvo;
  let r = await request.post('/api/auth/login', { data: { email, senha } });
  if (r.status() === 429) {
    await new Promise((ok) => setTimeout(ok, 61_000));
    r = await request.post('/api/auth/login', { data: { email, senha } });
  }
  expect(r.ok(), await r.text()).toBeTruthy();
  const token = (await r.json()).token as string;
  tokens.set(email, token);
  return token;
}

/** Chamada à API com o token (caminho SEM /api). Falha o teste se a resposta não for 2xx. */
export async function chamarApi<T = unknown>(
  request: APIRequestContext,
  token: string,
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  caminho: string,
  dados?: unknown,
): Promise<T> {
  const r = await request.fetch(`/api${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}` },
    ...(dados !== undefined && { data: dados }),
  });
  const texto = await r.text();
  expect(r.ok(), `${metodo} ${caminho} → ${r.status()} ${texto}`).toBeTruthy();
  return (texto ? JSON.parse(texto) : null) as T;
}

/** Sem rolagem horizontal na largura atual (tolerância de 2 px). */
export async function semRolagemHorizontal(page: Page, rotulo: string) {
  const larguraDoc = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()?.width ?? 0;
  expect.soft(larguraDoc, `rolagem horizontal em ${rotulo}`).toBeLessThanOrEqual(viewport + 2);
}

export const isoData = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
