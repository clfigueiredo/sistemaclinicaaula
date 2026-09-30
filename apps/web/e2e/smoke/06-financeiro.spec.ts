/**
 * Fase 2 — fluxo 8: financeiro da Clínica Demo.
 *  - Admin: caixa (entrada, saída, estorno), contas a pagar (parcelado) e a receber (baixa), recorrência,
 *    repasse (percentual), relatórios (gráfico), configurações e recebimento de consulta pelo painel da agenda.
 *  - Recepção: não vê relatórios/repasses/recorrências/configurações.
 *  - Profissional: só a aba Repasses, com os próprios dados.
 */
import { expect, test, type Page } from '@playwright/test';
import { chamarApi, foto, isoData, loginClinica, monitorar, tokenClinica, toast } from './utils';

const sufixo = Date.now().toString().slice(-6);

async function linhaAcao(page: Page, texto: string, acao: string | RegExp) {
  const linha = page.getByRole('row', { name: new RegExp(texto) }).first();
  await expect(linha).toBeVisible();
  await linha.getByRole('button', { name: 'Ações' }).click();
  await page.getByRole('menuitem', { name: acao }).click();
}

test('financeiro como admin', async ({ page, request }, info) => {
  monitorar(page, info);
  await loginClinica(page, 'admin@demo.local');

  // ---------------------------------------------------------------- caixa
  await page.goto('/financeiro');
  await expect(page).toHaveURL(/\/financeiro\/caixa/);
  await page.getByRole('button', { name: 'Nova entrada' }).first().click();
  await page.locator('#mov-valor').fill('150');
  await page.locator('#mov-desc').fill(`Entrada E2E ${sufixo}`);
  await page.getByRole('button', { name: 'Lançar entrada' }).click();
  await toast(page, 'Entrada lançada.');
  await page.getByRole('button', { name: 'Nova saída' }).click();
  await page.locator('#mov-valor').fill('40');
  await page.locator('#mov-desc').fill(`Saída E2E ${sufixo}`);
  await page.getByRole('button', { name: 'Lançar saída' }).click();
  await toast(page, 'Saída lançada.');
  await linhaAcao(page, `Saída E2E ${sufixo}`, 'Estornar');
  await page.getByRole('dialog').getByRole('button', { name: 'Estornar' }).click();
  await toast(page, 'Movimentação estornada.');
  await foto(page, '08-financeiro-caixa');

  // ---------------------------------------------------------------- contas a pagar (parcelado)
  const hoje = new Date();
  await page.getByRole('link', { name: 'Contas a pagar' }).click();
  await page.getByRole('button', { name: 'Nova conta a pagar' }).first().click();
  await page.locator('#tit-desc').fill(`Equipamento E2E ${sufixo}`);
  await page.locator('#tit-valor').fill('300');
  await page.locator('#tit-venc').fill(isoData(hoje));
  await page.locator('#tit-parc').fill('3');
  await page.getByRole('button', { name: 'Criar 3 parcelas' }).click();
  await toast(page, '3 parcelas criadas.');
  await linhaAcao(page, `Equipamento E2E ${sufixo}`, 'Registrar pagamento');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await toast(page, 'Pagamento registrado.');
  await foto(page, '08-financeiro-contas-pagar');

  // ---------------------------------------------------------------- contas a receber (baixa)
  await page.getByRole('link', { name: 'Contas a receber' }).click();
  await page.getByRole('button', { name: 'Nova conta a receber' }).first().click();
  await page.locator('#tit-desc').fill(`Pacote E2E ${sufixo}`);
  await page.locator('#tit-valor').fill('500');
  await page.locator('#tit-venc').fill(isoData(hoje));
  await page.getByRole('button', { name: 'Criar título' }).click();
  await toast(page, 'Título criado.');
  await linhaAcao(page, `Pacote E2E ${sufixo}`, 'Registrar recebimento');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar' }).click();
  await toast(page, 'Recebimento registrado.');
  await foto(page, '08-financeiro-contas-receber');

  // ---------------------------------------------------------------- recorrência
  await page.getByRole('link', { name: 'Recorrências' }).click();
  await page.getByRole('button', { name: 'Nova recorrência' }).first().click();
  await page.locator('#rec-desc').fill(`Aluguel E2E ${sufixo}`);
  await page.locator('#rec-valor').fill('1200');
  await page.locator('#rec-dia').fill('10');
  await page.getByRole('button', { name: 'Criar recorrência' }).click();
  await toast(page, 'Recorrência criada.');
  await foto(page, '08-financeiro-recorrencias');

  // ---------------------------------------------------------------- repasses
  await page.getByRole('link', { name: 'Repasses' }).click();
  await linhaAcao(page, 'Dra. Ana Souza', 'Alterar percentual');
  await page.locator('#pct').fill('40');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await toast(page, 'Repasse de 40% definido.');
  await foto(page, '08-financeiro-repasses');

  // ---------------------------------------------------------------- relatórios e configurações
  await page.getByRole('link', { name: 'Relatórios' }).click();
  await expect(page.getByRole('img', { name: 'Entradas e saídas por período' })).toBeVisible();
  await expect(page.getByText('Fluxo de caixa')).toBeVisible();
  await foto(page, '08-financeiro-relatorios');
  await page.getByRole('link', { name: 'Configurações' }).last().click();
  await expect(page.getByRole('main')).toContainText('Caixa');
  await foto(page, '08-financeiro-configuracoes');

  // ---------------------------------------------------------------- recebimento de consulta pela agenda
  const token = await tokenClinica(request, 'admin@demo.local');
  const [prof] = await chamarApi<{ id: string; nome: string }[]>(request, token, 'GET', '/agendamentos/profissionais');
  const paciente = await chamarApi<{ id: string }>(request, token, 'POST', '/pacientes', { nome: `Paciente Financeiro ${sufixo}` });
  const inicio = new Date();
  inicio.setDate(inicio.getDate() + 40 + Math.floor(Math.random() * 20));
  inicio.setHours(20, Math.floor(Math.random() * 4) * 15, 0, 0);
  const ag = await chamarApi<{ id: string }>(request, token, 'POST', '/agendamentos', {
    paciente_id: paciente.id,
    profissional_id: prof!.id,
    inicio: inicio.toISOString(),
    encaixe: true,
  });
  await page.goto(`/agenda?agendamento=${ag.id}`);
  const painel = page.getByRole('dialog');
  await expect(painel).toContainText(`Paciente Financeiro ${sufixo}`);
  await painel.getByRole('button', { name: 'Registrar recebimento' }).click();
  await page.locator('#rc-valor').fill('180');
  await painel.getByRole('button', { name: 'Registrar', exact: true }).click();
  await toast(page, 'Recebimento registrado.');
  await expect(painel).toContainText('R$ 180,00');
  await foto(page, '08-agenda-recebimento', false);
});

test('financeiro: recepção e profissional', async ({ browser }, info) => {
  const recepcao = await browser.newPage();
  monitorar(recepcao, info);
  await loginClinica(recepcao, 'recepcao@demo.local');
  await recepcao.goto('/financeiro');
  await expect(recepcao).toHaveURL(/\/financeiro\/caixa/);
  const abas = recepcao.getByRole('main');
  for (const aba of ['Caixa', 'Contas a pagar', 'Contas a receber']) await expect(abas.getByRole('link', { name: aba })).toBeVisible();
  for (const aba of ['Relatórios', 'Repasses', 'Recorrências']) await expect(abas.getByRole('link', { name: aba })).toHaveCount(0);
  await recepcao.goto('/financeiro/relatorios');
  await expect(recepcao.getByText('Acesso restrito')).toBeVisible();
  await foto(recepcao, '08-financeiro-recepcao-bloqueado');
  await recepcao.close();

  const prof = await browser.newPage();
  monitorar(prof, info);
  await loginClinica(prof, 'profissional@demo.local');
  await prof.goto('/financeiro');
  await expect(prof).toHaveURL(/\/financeiro\/repasses/);
  await expect(prof.getByRole('main').getByRole('link', { name: 'Caixa' })).toHaveCount(0);
  await expect(prof.getByRole('main')).toContainText('Seu percentual de repasse');
  await prof.goto('/financeiro/caixa');
  await expect(prof.getByText('Acesso restrito')).toBeVisible();
  await foto(prof, '08-financeiro-profissional');
  await prof.close();
});
