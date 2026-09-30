/**
 * Fluxos 4 e 5 — papéis da Clínica Demo.
 *  - Recepção: não vê prontuário/anexos/alergias nem menus indevidos; vê o sino de avisos.
 *  - Profissional: vê só a própria agenda; acessa o prontuário dos seus pacientes; vê
 *    profissionais em modo somente leitura; e em ~390 px o layout não quebra.
 */
import { expect, test } from '@playwright/test';
import { foto, loginClinica, monitorar, toast } from './utils';

test('recepção: permissões e sino de avisos', async ({ page }, info) => {
  monitorar(page, info);
  await loginClinica(page, 'recepcao@demo.local');
  await expect(page).toHaveURL(/\/agenda/);
  const menu = page.getByRole('navigation').first();
  for (const item of ['Agenda', 'Pacientes', 'Profissionais', 'Convênios']) {
    await expect(menu.getByRole('link', { name: item })).toBeVisible();
  }
  for (const item of ['Usuários', 'WhatsApp', 'Configurações']) {
    await expect(menu.getByRole('link', { name: item })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /Avisos/ })).toBeVisible();
  await page.getByRole('button', { name: /Avisos/ }).click();
  await expect(page.getByText('Cancelamentos feitos pelos pacientes no WhatsApp.')).toBeVisible();
  await foto(page, '04-recepcao-agenda-sino', false);
  await page.keyboard.press('Escape');

  await page.goto('/pacientes');
  await page.getByText('João da Silva').first().click();
  await expect(page.getByRole('tab', { name: 'Dados' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Prontuário' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Anexos' })).toHaveCount(0);
  await expect(page.getByLabel('Alergia', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Alergias/i)).toHaveCount(0);
  await foto(page, '04-recepcao-ficha');

  // rota protegida direta
  await page.goto('/usuarios');
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  await foto(page, '04-recepcao-usuarios-bloqueado');
});

test('profissional: própria agenda e prontuário', async ({ page }, info) => {
  monitorar(page, info, [/\/prontuario\/pacientes\/.* 403$/]);
  await loginClinica(page, 'profissional@demo.local');
  await expect(page).toHaveURL(/\/agenda/);
  await expect(page.getByText('Sua agenda de atendimentos.')).toBeVisible();
  // sem filtro de profissional nem sino
  await expect(page.getByLabel('Filtrar por profissional')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Avisos/ })).toHaveCount(0);
  await foto(page, '05-profissional-agenda');

  // Paciente sem vínculo (nunca agendado com ela): prontuário bloqueado com mensagem.
  await page.goto('/pacientes');
  await page.getByText('João da Silva').first().click();
  await page.getByRole('tab', { name: 'Prontuário' }).click();
  await expect(page.getByText('Acesso ao prontuário restrito')).toBeVisible();

  // Paciente agendado com ela (criado no fluxo 3): escreve e corrige.
  await page.goto('/pacientes');
  await page.getByLabel('Buscar pacientes').fill('Paciente Agenda');
  await page.getByText(/Paciente Agenda \d+/).first().click();
  await page.getByRole('tab', { name: 'Prontuário' }).click();
  const sufixo = Date.now().toString().slice(-5);
  await page.getByLabel('Texto do registro').fill(`Registro E2E ${sufixo}: paciente com cefaleia.`);
  await page.getByRole('button', { name: 'Salvar registro' }).click();
  await toast(page, 'Registro adicionado ao prontuário.');
  await page.getByRole('button', { name: 'Corrigir' }).first().click();
  await page.getByLabel('Texto do registro').fill(`Correção E2E ${sufixo}: cefaleia tensional.`);
  await page.getByRole('button', { name: 'Registrar correção' }).click();
  await toast(page, 'Correção registrada.');
  await expect(page.getByText(`Correção E2E ${sufixo}: cefaleia tensional.`)).toBeVisible();
  await foto(page, '05-profissional-prontuario');

  // profissionais: somente leitura
  await page.goto('/profissionais');
  await expect(page.getByRole('heading', { name: 'Profissionais', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo profissional' })).toHaveCount(0);
  await page.locator('main').getByText('Dra. Ana Souza').first().click();
  await expect(page.getByText('Somente o administrador pode editar.')).toBeVisible();
  await foto(page, '05-profissional-detalhe-profissional');

  // celular (~390 px)
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [rota, nome] of [
    ['/agenda', '05-mobile-agenda'],
    ['/pacientes', '05-mobile-pacientes'],
  ] as const) {
    await page.goto(rota);
    await page.waitForLoadState('networkidle');
    const larguraDoc = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(larguraDoc, `rolagem horizontal em ${rota}`).toBeLessThanOrEqual(392);
    await foto(page, nome);
  }
});
