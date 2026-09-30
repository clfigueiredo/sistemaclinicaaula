/**
 * Fase 2 — fluxos 9, 10 e 11 (Clínica Demo).
 *  - Documentos: profissional emite receita e atestado com pré-visualização e abre o PDF; recepção não vê a aba.
 *  - Retornos: profissional define o retorno num agendamento atendido; /retornos lista; "Agendar na agenda" abre
 *    a agenda pré-preenchida e, ao agendar, o retorno vira "Agendado" na hora.
 *  - Lista de espera: recepção adiciona um paciente; ao cancelar um agendamento, o painel sugere o paciente.
 * Os dados base (pacientes/agendamentos) são criados pela API; as ações testadas são feitas na interface.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import { chamarApi, foto, isoData, loginClinica, monitorar, tokenClinica, toast } from './utils';

const sufixo = Date.now().toString().slice(-6);

/** Dia útil daqui a `dias` dias. */
function diaUtil(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Encaixe (admin) num horário livre por volta de `dias` dias de hoje (negativo = passado), fora da grade
 * (19h–22h) para não ocupar horários da agenda pública. Tenta outros horários se houver conflito.
 */
async function agendarLivre(request: APIRequestContext, token: string, pacienteId: string, profId: string, dias: number) {
  for (let tentativa = 0; tentativa < 15; tentativa++) {
    const inicio = new Date();
    inicio.setDate(inicio.getDate() + dias + (tentativa % 5));
    inicio.setHours(19 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 4) * 15, 0, 0);
    const r = await request.post('/api/agendamentos', {
      headers: { authorization: `Bearer ${token}` },
      data: { paciente_id: pacienteId, profissional_id: profId, inicio: inicio.toISOString(), encaixe: true },
    });
    if (r.status() === 409) continue;
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()) as { id: string };
  }
  throw new Error('Nenhum horário livre para o encaixe de teste.');
}

async function base(request: APIRequestContext) {
  const token = await tokenClinica(request, 'admin@demo.local');
  const [prof] = await chamarApi<{ id: string }[]>(request, token, 'GET', '/agendamentos/profissionais');
  return { token, profId: prof!.id };
}

/** Paciente + consulta de ontem ATENDIDA com a Dra. Ana (criada pelo admin ⇒ vínculo para a profissional). */
async function pacienteAtendido(request: APIRequestContext, nome: string) {
  const { token, profId } = await base(request);
  const paciente = await chamarApi<{ id: string }>(request, token, 'POST', '/pacientes', { nome });
  const ag = await agendarLivre(request, token, paciente.id, profId, -(1 + Math.floor(Math.random() * 25)));
  await chamarApi(request, token, 'PATCH', `/agendamentos/${ag.id}/status`, { status: 'compareceu' });
  await chamarApi(request, token, 'PATCH', `/agendamentos/${ag.id}/status`, { status: 'atendido' });
  return { pacienteId: paciente.id, agendamentoId: ag.id };
}

test('documentos: receita e atestado com pré-visualização (profissional); recepção sem a aba', async ({ browser, request }, info) => {
  const nome = `Paciente Documentos ${sufixo}`;
  const { pacienteId } = await pacienteAtendido(request, nome);

  const page = await browser.newPage();
  monitorar(page, info);
  await loginClinica(page, 'profissional@demo.local');
  await page.goto(`/pacientes/${pacienteId}`);
  await page.getByRole('tab', { name: 'Documentos' }).click();

  // Receita
  await page.getByRole('button', { name: 'Novo documento' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('radio', { name: /Receita/ }).click();
  await dlg.getByRole('textbox', { name: 'Medicamento 1' }).fill('Amoxicilina 500 mg');
  await dlg.getByRole('textbox', { name: 'Quantidade 1' }).fill('1 caixa');
  await dlg.getByRole('textbox', { name: 'Posologia 1' }).fill('Tomar 1 cápsula de 8 em 8 horas por 7 dias.');
  await dlg.getByRole('button', { name: 'Pré-visualizar' }).click();
  await expect(dlg.getByRole('heading', { name: 'Pré-visualização' })).toBeVisible();
  await expect(dlg.locator('iframe[title="Pré-visualização do documento"]')).toBeVisible();
  await foto(page, '09-documento-previa', false);
  await dlg.getByRole('button', { name: 'Emitir documento' }).click();
  await toast(page, /emitido/);

  // Atestado
  await page.getByRole('button', { name: 'Novo documento' }).first().click();
  await dlg.getByRole('radio', { name: /Atestado/ }).click();
  await dlg.locator('#doc-dias').fill('2');
  await dlg.getByRole('button', { name: 'Pré-visualizar' }).click();
  await expect(dlg.locator('iframe[title="Pré-visualização do documento"]')).toBeVisible();
  await dlg.getByRole('button', { name: 'Emitir documento' }).click();
  await toast(page, /emitido/);
  await expect(page.getByRole('button', { name: 'Ver PDF' })).toHaveCount(2);
  await foto(page, '09-documentos-lista');

  // Abrir o PDF (nova aba com o blob)
  // (o Chromium headless não renderiza PDF: confere a resposta da rota autenticada e a aba aberta)
  const [aba, pdf] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse((r) => /\/api\/documentos\/[0-9a-f-]+\/pdf$/.test(r.url())),
    page.getByRole('button', { name: 'Ver PDF' }).first().click(),
  ]);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  await aba.close();
  await page.close();

  // Recepção: sem a aba Documentos
  const rec = await browser.newPage();
  monitorar(rec, info);
  await loginClinica(rec, 'recepcao@demo.local');
  await rec.goto(`/pacientes/${pacienteId}`);
  await expect(rec.getByRole('tab', { name: 'Dados' })).toBeVisible();
  await expect(rec.getByRole('tab', { name: 'Documentos' })).toHaveCount(0);
  await rec.close();
});

test('retornos: definir no atendimento, listar e agendar pela agenda pré-preenchida', async ({ browser, request }, info) => {
  const nome = `Paciente Retorno ${sufixo}`;
  const { agendamentoId } = await pacienteAtendido(request, nome);
  const dataRetorno = diaUtil(30 + Math.floor(Math.random() * 15));

  const page = await browser.newPage();
  monitorar(page, info);
  await loginClinica(page, 'profissional@demo.local');
  await page.goto(`/agenda?agendamento=${agendamentoId}`);
  const painel = page.getByRole('dialog');
  await expect(painel).toContainText(nome);
  await painel.getByLabel('Ou escolha a data').fill(isoData(dataRetorno));
  await painel.getByRole('button', { name: 'Definir retorno' }).click();
  await toast(page, 'Retorno definido.');
  await foto(page, '10-retorno-definido', false);
  await page.keyboard.press('Escape');

  await page.goto('/retornos');
  const linha = page.getByRole('row', { name: new RegExp(nome) });
  await expect(linha).toBeVisible();
  await foto(page, '10-retornos-lista');
  await linha.getByRole('button', { name: `Ações do retorno de ${nome}` }).click();
  await page.getByRole('menuitem', { name: 'Agendar na agenda' }).click();

  await expect(page).toHaveURL(/\/agenda/);
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Novo agendamento');
  await expect(dlg).toContainText(nome);
  await expect(dlg.getByLabel('Data')).toHaveValue(isoData(dataRetorno));
  await foto(page, '10-agenda-pre-preenchida', false);
  const horario = dlg.getByRole('button', { name: /^\d{2}:\d{2}$/ });
  await expect(horario.first()).toBeVisible();
  await horario.nth(Math.floor(Math.random() * (await horario.count()))).click();
  await dlg.getByRole('button', { name: 'Agendar' }).click();
  await toast(page, 'Agendamento criado.');

  // Vínculo na hora: o retorno já aparece como agendado.
  await page.goto('/retornos');
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Agendados' }).click();
  await expect(page.getByRole('row', { name: new RegExp(nome) })).toBeVisible();
  await foto(page, '10-retornos-agendados');
  await page.close();
});

test('lista de espera: adicionar paciente e sugestões ao cancelar', async ({ browser, request }, info) => {
  const { token, profId } = await base(request);
  const esperando = `Paciente Espera ${sufixo}`;
  await chamarApi(request, token, 'POST', '/pacientes', { nome: esperando });
  const outro = await chamarApi<{ id: string }>(request, token, 'POST', '/pacientes', { nome: `Paciente Cancela ${sufixo}` });
  const ag = await agendarLivre(request, token, outro.id, profId, 20 + Math.floor(Math.random() * 20));

  const page = await browser.newPage();
  monitorar(page, info);
  await loginClinica(page, 'recepcao@demo.local');
  await page.goto('/lista-espera');
  await page.getByRole('button', { name: 'Adicionar paciente' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox').first().click();
  await page.getByPlaceholder('Nome, CPF ou telefone…').fill(esperando);
  await page.getByRole('option', { name: new RegExp(esperando) }).click();
  await dlg.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await toast(page, 'Paciente adicionado à lista de espera.');
  await expect(page.getByRole('row', { name: new RegExp(esperando) })).toBeVisible();
  await foto(page, '11-lista-espera');

  // Cancela o agendamento pelo painel da agenda ⇒ sugestões da lista de espera.
  await page.goto(`/agenda?agendamento=${ag.id}`);
  const painel = page.getByRole('dialog');
  await painel.getByRole('button', { name: 'Cancelar' }).click();
  await painel.getByLabel('Motivo do cancelamento').fill('Paciente pediu para desmarcar (E2E).');
  await painel.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await toast(page, /Cancelado/);
  await expect(painel).toContainText('Lista de espera — horário liberado');
  await expect(painel).toContainText(esperando);
  await foto(page, '11-sugestoes-lista-espera', false);
  await page.close();

  // Limpeza: tira o paciente de teste da lista (não acumula entre execuções).
  const lista = await chamarApi<{ itens: { id: string; paciente: { nome: string } }[] }>(
    request, token, 'GET', `/lista-espera?por_pagina=100`,
  );
  for (const item of lista.itens.filter((i) => i.paciente.nome === esperando)) {
    await chamarApi(request, token, 'PATCH', `/lista-espera/${item.id}/status`, { status: 'removido' });
  }
});
