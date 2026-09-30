/**
 * Fluxo 1 — Super admin: login → dashboard → planos (criar, editar matriz de recursos, marcar como
 * cadastro e voltar o original) → clínicas → detalhe da clínica demo → trocar plano e voltar.
 */
import { expect, test } from '@playwright/test';
import { foto, loginAdmin, monitorar, toast } from './utils';

test('super admin: planos e clínicas', async ({ page }, info) => {
  monitorar(page, info);
  await loginAdmin(page);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await foto(page, '01-admin-dashboard');

  // ---- Planos: criar
  const nomePlano = `Plano QA ${Date.now().toString().slice(-6)}`;
  await page.getByRole('link', { name: 'Planos' }).click();
  await expect(page.getByRole('heading', { name: 'Planos' })).toBeVisible();
  await foto(page, '01-admin-planos');
  await page.getByRole('link', { name: 'Novo plano' }).first().click();
  await expect(page.getByRole('heading', { name: 'Novo plano' })).toBeVisible();
  await page.getByLabel('Nome').fill(nomePlano);
  await page.getByLabel('Descrição').fill('Plano criado pelo teste E2E');
  await page.getByLabel('Preço mensal (R$)').fill('49,90');
  // Matriz: liga Profissionais (limite 3) e WhatsApp
  const switches = page.locator('li').getByRole('switch', { name: 'Recurso incluso no plano' }).filter({ visible: true });
  await switches.nth(0).click();
  await page.getByLabel('Limite de Profissionais').fill('3');
  await switches.nth(4).click();
  await foto(page, '01-admin-plano-novo');
  await page.getByRole('button', { name: 'Criar plano' }).click();
  await toast(page, /criado/);

  // ---- Editar matriz: agendamentos por mês
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeVisible();
  await switches.nth(2).click();
  await page.getByLabel('Limite de Agendamentos').fill('100');
  await page.getByLabel('Período de Agendamentos').click();
  await page.getByRole('option', { name: 'Por mês' }).click();
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await toast(page, 'Plano atualizado.');
  await foto(page, '01-admin-plano-editado');

  // ---- Marcar como plano de cadastro e voltar o original (Teste grátis)
  await page.goto('/admin/planos');
  await page.getByRole('button', { name: `Ações do plano ${nomePlano}` }).click();
  await page.getByRole('menuitem', { name: 'Marcar como plano de cadastro' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Marcar como plano de cadastro' }).click();
  await toast(page, /agora é o plano de cadastro/);
  await page.getByRole('button', { name: 'Ações do plano Teste grátis' }).click();
  await page.getByRole('menuitem', { name: 'Marcar como plano de cadastro' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Marcar como plano de cadastro' }).click();
  await toast(page, /"Teste grátis" agora é o plano de cadastro/);
  await foto(page, '01-admin-planos-final');

  // ---- Excluir o plano de QA (sem clínicas) para não sujar o banco
  await page.getByRole('button', { name: `Ações do plano ${nomePlano}` }).click();
  await page.getByRole('menuitem', { name: 'Excluir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
  await toast(page, /excluído/);

  // ---- Clínicas → detalhe da demo → trocar plano e voltar
  await page.getByRole('link', { name: 'Clínicas' }).click();
  await expect(page.getByRole('heading', { name: 'Clínicas' })).toBeVisible();
  await foto(page, '01-admin-clinicas');
  await page.getByRole('link', { name: /Clínica Demo/ }).first().click();
  await expect(page.getByRole('button', { name: 'Trocar plano' })).toBeVisible();
  await foto(page, '01-admin-clinica-demo');

  // Se uma execução anterior parou no meio, a demo pode estar no Teste grátis: só volta.
  const planoAtual = (await page.getByText(/Consumo atual comparado aos limites do plano/).textContent()) ?? '';
  const destinos = planoAtual.includes('Profissional') ? ['Teste grátis', 'Profissional'] : ['Profissional'];
  for (const destino of destinos) {
    await page.getByRole('button', { name: 'Trocar plano' }).click();
    await page.getByRole('dialog').getByLabel('Novo plano').click();
    await page.getByRole('option', { name: new RegExp(`^${destino} —`) }).click();
    await foto(page, `01-admin-trocar-plano-${destino.replace(/\W/g, '')}`, false);
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar troca' }).click();
    await toast(page, `Plano alterado para "${destino}".`);
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  // A demo precisa terminar no plano Profissional (os outros fluxos dependem dos limites altos).
  await expect(page.getByText('Consumo atual comparado aos limites do plano Profissional')).toBeVisible();
});
