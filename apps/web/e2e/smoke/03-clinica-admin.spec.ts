/**
 * Fluxo 3 — Clínica Demo como admin: agenda (criar, arrastar para remarcar, mudar status, cancelar
 * com motivo), pacientes (buscar, criar, ficha com abas, alergia, prontuário: registro e correção,
 * anexo PDF: upload e download), usuários, convênios, WhatsApp (QR) e configurações.
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { foto, loginClinica, monitorar, toast } from './utils';

/** Próximo dia útil a partir de daqui a `dias` dias. */
function diaUtil(dias = 1): Date {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const PDF_MINIMO = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`;

async function novoAgendamento(page: Page, paciente: string, dia: Date, horario: string) {
  await page.getByRole('button', { name: 'Novo agendamento' }).click();
  const ag = page.getByRole('dialog');
  await ag.getByRole('combobox').first().click();
  await page.getByPlaceholder('Nome, CPF ou telefone…').fill(paciente.split(' ')[0]!);
  await page.getByRole('option', { name: new RegExp(paciente) }).click();
  await ag.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: /Dra\. Ana Souza/ }).click();
  await ag.getByLabel('Data').fill(iso(dia));
  await ag.getByRole('button', { name: horario, exact: true }).click();
  await ag.getByRole('button', { name: 'Agendar' }).click();
  await toast(page, 'Agendamento criado.');
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('clínica demo como admin', async ({ page }, info) => {
  monitorar(page, info);
  await loginClinica(page, 'admin@demo.local');
  await expect(page).toHaveURL(/\/agenda/);
  await expect(page.getByRole('button', { name: 'Avisos' })).toBeVisible();

  // ---------------------------------------------------------------- agenda
  const dia = diaUtil(Math.floor(Math.random() * 20) + 7); // longe o bastante para não colidir entre execuções
  const sufixo = Date.now().toString().slice(-5);
  const nomePaciente = `Paciente Agenda ${sufixo}`;

  // cria um paciente para a agenda (lista de pacientes)
  await page.goto('/pacientes');
  await page.getByRole('button', { name: 'Novo paciente' }).first().click();
  await page.getByRole('dialog').getByLabel('Nome completo').fill(nomePaciente);
  await page.getByRole('dialog').getByRole('button', { name: 'Cadastrar paciente' }).click();
  await toast(page, 'Paciente cadastrado.');

  await page.goto('/agenda');
  await expect(page.locator('.fc')).toBeVisible();
  await novoAgendamento(page, nomePaciente, dia, '09:00');
  await novoAgendamento(page, nomePaciente, dia, '10:00');

  // vai até o dia na visão semanal
  const irPara = async () => {
    for (let i = 0; i < 6; i++) {
      if ((await page.locator('.fc-event', { hasText: nomePaciente }).count()) >= 2) return;
      await page.locator('.fc-next-button').click();
      await page.waitForTimeout(800);
    }
  };
  await irPara();
  const eventos = page.locator('.fc-event', { hasText: nomePaciente });
  await expect(eventos).toHaveCount(2);
  await foto(page, '03-agenda-semana');

  // arrasta o de 09:00 para 11:00 (8 slots de 15 min)
  const primeiro = eventos.filter({ hasText: '09:00' });
  const caixa = (await primeiro.boundingBox())!;
  const altSlot = (await page.locator('.fc-timegrid-slot').first().boundingBox())!.height;
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + 6);
  await page.mouse.down();
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + 6 + altSlot * 4, { steps: 5 });
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + 6 + altSlot * 8, { steps: 10 });
  await page.mouse.up();
  await toast(page, 'Agendamento remarcado.');

  // muda status do remarcado (confirmar) e cancela o outro com motivo
  const remarcado = page.locator('.fc-event', { hasText: nomePaciente }).filter({ hasText: '11:00' });
  const outro = page.locator('.fc-event', { hasText: nomePaciente }).filter({ hasText: '10:00' });
  await remarcado.click();
  const painel = page.getByRole('dialog');
  await painel.getByRole('button', { name: 'Confirmar' }).click();
  await toast(page, /Confirmado/);
  await page.keyboard.press('Escape');
  await expect(painel).toBeHidden();
  await outro.click();
  await painel.getByRole('button', { name: 'Cancelar' }).click();
  await painel.getByLabel('Motivo do cancelamento').fill('Paciente pediu para remarcar');
  await painel.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await toast(page, /Cancelado/);
  await expect(painel.getByText('Paciente pediu para remarcar')).toBeVisible();
  await foto(page, '03-agenda-cancelado', false);
  await page.keyboard.press('Escape');
  await expect(painel).toBeHidden();

  // ---------------------------------------------------------------- pacientes
  await page.goto('/pacientes');
  await page.getByLabel('Buscar pacientes').fill('João');
  await expect(page.getByText('João da Silva').first()).toBeVisible();
  await foto(page, '03-pacientes-busca');
  await page.getByText('João da Silva').first().click();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}/);
  for (const aba of ['Dados', 'Consultas', 'Prontuário', 'Anexos']) {
    await expect(page.getByRole('tab', { name: aba })).toBeVisible();
  }
  // alergia
  const alergia = `Dipirona ${sufixo}`;
  await page.getByLabel('Alergia', { exact: true }).fill(alergia);
  await page.getByLabel('Gravidade').fill('Grave');
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(page.getByText(alergia, { exact: true })).toBeVisible();
  await foto(page, '03-ficha-dados');
  await page.getByRole('button', { name: `Remover alergia ${alergia}` }).click();
  await expect(page.getByText(alergia, { exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Consultas' }).click();
  await foto(page, '03-ficha-consultas');

  // prontuário: admin sem profissional vinculado só consulta (escrita é testada no fluxo do profissional)
  await page.getByRole('tab', { name: 'Prontuário' }).click();
  await expect(page.getByText(/Somente usuários vinculados a um profissional escrevem no prontuário/)).toBeVisible();
  await foto(page, '03-ficha-prontuario');

  // anexo
  await page.getByRole('tab', { name: 'Anexos' }).click();
  const pdf = path.join(os.tmpdir(), `exame-e2e-${sufixo}.pdf`);
  writeFileSync(pdf, PDF_MINIMO);
  await page.locator('input[type="file"]').setInputFiles(pdf);
  await toast(page, /anexado/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `Baixar exame-e2e-${sufixo}.pdf` }).click(),
  ]);
  expect(download.suggestedFilename()).toContain('exame-e2e');
  await foto(page, '03-ficha-anexos');

  // ---------------------------------------------------------------- demais telas
  for (const [rota, titulo, arquivo] of [
    ['/usuarios', 'Usuários', '03-usuarios'],
    ['/convenios', 'Convênios', '03-convenios'],
    ['/profissionais', 'Profissionais', '03-profissionais'],
    ['/configuracoes', 'Configurações', '03-configuracoes'],
  ] as const) {
    await page.goto(rota);
    await expect(page.getByRole('heading', { name: titulo, exact: true })).toBeVisible();
    await foto(page, arquivo);
  }

  // WhatsApp: carrega e mostra QR ao conectar
  await page.goto('/whatsapp');
  await expect(page.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible();
  await foto(page, '03-whatsapp');
  const conectar = page.getByRole('button', { name: /^(Conectar|Gerar novo QR code)$/ });
  if (await conectar.isVisible()) {
    await conectar.click();
    await expect(page.getByAltText('QR code para conectar o WhatsApp')).toBeVisible({ timeout: 90_000 });
    await foto(page, '03-whatsapp-qr');
  }
  // sino de avisos
  await page.getByRole('button', { name: /Avisos/ }).first().click();
  await expect(page.getByText('Cancelamentos feitos pelos pacientes no WhatsApp.')).toBeVisible();
  await foto(page, '03-sino-avisos', false);
});
