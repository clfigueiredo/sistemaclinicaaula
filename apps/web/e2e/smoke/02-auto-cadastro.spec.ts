/**
 * Fluxo 2 — Auto-cadastro no plano Teste grátis (tudo limitado a 1): cadastro → onboarding →
 * profissional → grade de horários → convênio → 2º profissional bloqueado → paciente →
 * agendamento → 2º agendamento bloqueado.
 */
import { expect, test } from '@playwright/test';
import { foto, monitorar, toast } from './utils';

function proximoDiaUtil(): string {
  const d = new Date();
  do d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** CNPJ válido aleatório. */
function cnpj(): string {
  const n = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (base: number[]) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = base.reduce((s, v, i) => s + v * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join('');
}

test('auto-cadastro no teste grátis e limites', async ({ page }, info) => {
  // 403 de limite é esperado nas tentativas extras.
  monitorar(page, info, [/ 403$/]);
  const sufixo = Date.now().toString().slice(-6);

  // ---- Cadastro
  await page.goto('/cadastro');
  await foto(page, '02-cadastro');
  await page.getByLabel('Nome da clínica').fill(`Clínica QA ${sufixo}`);
  await page.getByLabel('CNPJ ou CPF').fill(cnpj());
  await page.getByLabel('Telefone').fill('11987654321');
  await page.getByLabel('Seu nome (responsável)').fill('Maria Teste');
  await page.getByLabel('E-mail de acesso').fill(`qa${sufixo}@teste.local`);
  await page.getByLabel('Senha', { exact: true }).fill('senha123');
  await page.getByLabel('Confirme a senha').fill('senha123');
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: /Bem-vindo/ })).toBeVisible();
  await foto(page, '02-onboarding-inicio');

  // ---- Profissional
  await page.goto('/profissionais');
  await page.getByRole('button', { name: 'Novo profissional' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nome').fill('Dr. João QA');
  await dlg.getByLabel('Especialidade').fill('Clínico geral');
  await dlg.getByRole('button', { name: 'Cadastrar profissional' }).click();
  await toast(page, 'Profissional cadastrado!');
  await expect(page).toHaveURL(/aba=horarios/);

  // ---- Grade
  await page.getByRole('button', { name: 'Horário comercial' }).click();
  await page.getByRole('button', { name: 'Salvar grade' }).click();
  await toast(page, 'Grade de horários salva.');
  await foto(page, '02-grade');

  // ---- Convênio
  await page.goto('/convenios');
  await page.getByPlaceholder(/Nome do convênio/).fill('Unimed QA');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await toast(page, /adicionado/);
  await foto(page, '02-convenios');

  // ---- 2º profissional: bloqueado pelo limite
  await page.goto('/profissionais');
  await expect(page.getByText('Limite do plano')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo profissional' }).first()).toBeDisabled();
  await foto(page, '02-limite-profissional');

  // ---- Onboarding atualizado
  await page.goto('/onboarding');
  await expect(page.getByText('1. Cadastre um profissional')).toBeVisible();
  await foto(page, '02-onboarding-progresso');

  // ---- Paciente
  await page.goto('/pacientes');
  await page.getByRole('button', { name: 'Novo paciente' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome completo').fill('Paciente QA Um');
  await page.getByRole('dialog').getByRole('button', { name: 'Cadastrar paciente' }).click();
  await toast(page, 'Paciente cadastrado.');
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}/);

  // ---- Agendamento
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Novo agendamento' }).click();
  const ag = page.getByRole('dialog');
  await ag.getByRole('combobox').first().click();
  await page.getByPlaceholder('Nome, CPF ou telefone…').fill('Paciente QA');
  await page.getByRole('option', { name: /Paciente QA Um/ }).click();
  await ag.getByLabel('Data').fill(proximoDiaUtil());
  await ag.getByRole('button', { name: /^\d\d:\d\d$/ }).first().click();
  await foto(page, '02-dialogo-agendamento', false);
  await ag.getByRole('button', { name: 'Agendar' }).click();
  await toast(page, 'Agendamento criado.');
  await expect(page.getByRole('dialog')).toBeHidden();

  // ---- 2º agendamento: bloqueado
  await expect(page.getByText('Limite do plano')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo agendamento' })).toBeDisabled();
  await foto(page, '02-limite-agendamento');
});
