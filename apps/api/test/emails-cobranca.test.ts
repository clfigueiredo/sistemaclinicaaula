/**
 * E-mails transacionais da cobrança do SaaS (modulos/admin-cobranca/emails.ts): pagamento_confirmado (contratação),
 * pagamento_renovado (mensalidade, com nº da parcela) e aviso_renovacao (job diário, 2 dias antes do vencimento).
 * Nenhuma chamada real a gateway nem a SMTP: webhooks Asaas simulados e o enfileirador de e-mail é trocado por um
 * coletor. Cria os próprios dados e apaga no fim; gateways_pagamento, configuracao_email e modelos_email (globais)
 * são salvos no início e restaurados no fim.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConfiguracaoEmail,
  GatewayPagamento as RegistroGateway,
  ModeloEmail,
  Prisma,
  TipoEmail,
} from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenPlataforma } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';
import { executarJobCobrancas, hojeIso, somarDias } from '../src/modulos/admin-cobranca/servico';
import { DIAS_AVISO_RENOVACAO, dispararEmailsCobranca } from '../src/modulos/admin-cobranca/emails';
import { definirEnfileiradorEmail, ID_CONFIGURACAO_EMAIL } from '../src/servicos/email';
import { dataSemHora } from '../src/servicos/financeiroComum';
import { criptografar } from '../src/utils/cripto';

const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
let tokenAdmin: string;
let adminId: string;
let planoMensal: string;
let planoContratado: string;
let snapshotGateways: RegistroGateway[] = [];
let snapshotConfigEmail: ConfiguracaoEmail | null = null;
let snapshotModelos: ModeloEmail[] = [];
const clinicas: string[] = [];
const planos: string[] = [];
let jobsEmail: string[] = [];

const SILENCIO = { info: () => undefined, warn: () => undefined };
const TOKEN_WEBHOOK_ASAAS = `tokenWebhookAsaas_${sufixo}`;
const TIPOS_COBRANCA: TipoEmail[] = ['pagamento_confirmado', 'pagamento_renovado', 'aviso_renovacao'];

async function criarClinica(opcoes: { emailClinica?: string | null; responsavel?: string | null; planoId?: string } = {}) {
  seq++;
  const clinica = await prisma.clinica.create({
    data: {
      nome: `Emails Cobranca ${sufixo} ${seq}`,
      documento: `6${String(seq).padStart(3, '0')}${Date.now()}`.slice(0, 14),
      email: opcoes.emailClinica === undefined ? `clinica.${seq}.${sufixo}@emails.teste` : opcoes.emailClinica,
      responsavel: opcoes.responsavel === undefined ? 'Dra. Responsável' : opcoes.responsavel,
    },
  });
  clinicas.push(clinica.id);
  const assinatura = await prisma.assinatura.create({
    data: { clinica_id: clinica.id, plano_id: opcoes.planoId ?? planoMensal, status: 'ativa', dia_vencimento: 10 },
  });
  // Admin principal = admin ativo mais antigo; o segundo admin não recebe.
  const admin = await prisma.usuario.create({
    data: { clinica_id: clinica.id, nome: 'Admin Principal', email: `adm.${seq}.${sufixo}@emails.teste`, senha_hash: 'x', papel: 'admin' },
  });
  await prisma.usuario.create({
    data: {
      clinica_id: clinica.id,
      nome: 'Admin Adicional',
      email: `adm2.${seq}.${sufixo}@emails.teste`,
      senha_hash: 'x',
      papel: 'admin',
      criado_em: new Date(Date.now() + 60_000),
    },
  });
  return { clinica, assinatura, admin };
}

async function criarCobranca(
  clinicaId: string,
  assinaturaId: string,
  dados: Partial<Prisma.CobrancaUncheckedCreateInput> = {},
) {
  return prisma.cobranca.create({
    data: {
      clinica_id: clinicaId,
      assinatura_id: assinaturaId,
      gateway: 'asaas',
      valor: 149.9,
      vencimento: dataSemHora(somarDias(hojeIso(), 2)),
      status: 'pendente',
      ambiente: 'sandbox',
      ...dados,
    },
  });
}

function webhookPago(idEvento: string, idPagamento: string) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/pagamentos/asaas',
    headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN_WEBHOOK_ASAAS },
    payload: JSON.stringify({
      id: `${idEvento}_${sufixo}`,
      event: 'PAYMENT_RECEIVED',
      payment: { id: idPagamento, status: 'RECEIVED', value: 149.9, paymentDate: hojeIso() },
    }),
  });
}

function emailsDa(referencia: string, tipo?: TipoEmail) {
  return prisma.emailEnviado.findMany({ where: { referencia, ...(tipo && { tipo }) }, orderBy: { destinatario: 'asc' } });
}

async function configurarAsaas() {
  const r = await app.inject({
    method: 'PUT',
    url: '/admin/cobranca/gateways/asaas',
    headers: { authorization: `Bearer ${tokenAdmin}` },
    payload: {
      ambiente: 'sandbox',
      credenciais: { api_key: `$aact_emails_${sufixo}_chave` },
      segredo_webhook: TOKEN_WEBHOOK_ASAAS,
      dias_tolerancia: 5,
      metodos: ['pix', 'boleto', 'cartao'],
    },
  });
  expect(r.statusCode).toBe(200);
}

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  app = await buildApp({ logger: false });
  const admin = await prisma.usuarioPlataforma.create({
    data: { nome: 'Super E-mails', email: `super.${sufixo}@emails.teste`, senha_hash: 'x' },
  });
  adminId = admin.id;
  tokenAdmin = assinarTokenPlataforma(app, admin.id);
  for (const [nome, preco] of [[`Mensal ${sufixo}`, 149.9], [`Contratado ${sufixo}`, 99.9]] as const) {
    const p = await prisma.plano.create({ data: { nome, preco } });
    planos.push(p.id);
  }
  [planoMensal, planoContratado] = planos as [string, string];

  snapshotGateways = await prisma.gatewayPagamento.findMany();
  await prisma.gatewayPagamento.deleteMany({});
  snapshotConfigEmail = await prisma.configuracaoEmail.findUnique({ where: { id: ID_CONFIGURACAO_EMAIL } });
  snapshotModelos = await prisma.modeloEmail.findMany({ where: { tipo: { in: TIPOS_COBRANCA } } });
  await prisma.modeloEmail.deleteMany({ where: { tipo: { in: TIPOS_COBRANCA } } }); // usa os modelos padrão (ligados)
  const config = {
    ativo: true,
    smtp_senha_cifrada: criptografar('senha-smtp-de-teste'),
    smtp_senha_final: 'este',
    remetente_email: 'nao-responda@emails.teste',
  };
  await prisma.configuracaoEmail.upsert({
    where: { id: ID_CONFIGURACAO_EMAIL },
    create: { id: ID_CONFIGURACAO_EMAIL, ...config },
    update: config,
  });
  await configurarAsaas();
});

beforeEach(() => {
  jobsEmail = [];
  definirEnfileiradorEmail(async (job) => {
    jobsEmail.push(job.emailId);
  });
});

afterEach(() => {
  definirEnfileiradorEmail(null);
});

afterAll(async () => {
  definirEnfileiradorEmail(null);
  await prisma.emailEnviado.deleteMany({ where: { clinica_id: { in: clinicas } } });
  if (clinicas.length) await prisma.clinica.deleteMany({ where: { id: { in: clinicas } } });
  await prisma.eventoGateway.deleteMany({ where: { id_evento: { contains: sufixo } } });
  if (planos.length) await prisma.plano.deleteMany({ where: { id: { in: planos } } });
  if (adminId) await prisma.usuarioPlataforma.deleteMany({ where: { id: adminId } });
  await prisma.gatewayPagamento.deleteMany({});
  for (const g of snapshotGateways.sort((a, b) => Number(a.ativo) - Number(b.ativo))) {
    await prisma.gatewayPagamento.create({ data: g });
  }
  await prisma.configuracaoEmail.deleteMany({ where: { id: ID_CONFIGURACAO_EMAIL } });
  if (snapshotConfigEmail) await prisma.configuracaoEmail.create({ data: snapshotConfigEmail });
  for (const m of snapshotModelos) await prisma.modeloEmail.create({ data: m });
  await app.close();
});

// ----------------------------------------------------------------------------- pagamento_confirmado

describe('pagamento_confirmado (contratação)', () => {
  it('contratação paga via webhook ⇒ um e-mail por destinatário (admin principal + e-mail da clínica); repetir não duplica', async () => {
    const { clinica, assinatura, admin } = await criarClinica();
    await prisma.assinatura.update({ where: { id: assinatura.id }, data: { dia_vencimento: null, status: 'teste' } });
    const cobranca = await criarCobranca(clinica.id, assinatura.id, {
      id_externo: `pay_em_${sufixo}_contr`,
      valor: 99.9,
      vencimento: dataSemHora(hojeIso()),
      plano_contratado_id: planoContratado,
      link_pagamento: 'https://pagar.exemplo/contr',
    });

    const r1 = await webhookPago('evt_em_contr', cobranca.id_externo!);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ ok: true });

    const enviados = await emailsDa(cobranca.id);
    expect(enviados.map((e) => e.tipo)).toEqual(['pagamento_confirmado', 'pagamento_confirmado']);
    expect(enviados.map((e) => e.destinatario).sort()).toEqual([admin.email, clinica.email!].sort());
    expect(enviados.every((e) => e.status === 'pendente' && e.clinica_id === clinica.id)).toBe(true);
    expect(jobsEmail.sort()).toEqual(enviados.map((e) => e.id).sort());
    const [primeiro] = enviados;
    expect(primeiro!.assunto).toBe(`Pagamento confirmado — plano Contratado ${sufixo} liberado`);
    expect(primeiro!.texto).toContain('Olá, Dra. Responsável!');
    expect(primeiro!.texto).toMatch(/R\$\s99,90/);
    expect(primeiro!.texto).not.toContain('Próxima mensalidade: —'); // dia_vencimento ligado pela contratação

    // Mesmo evento de novo (duplicado no gateway) e disparo repetido (idempotência por destinatário).
    expect((await webhookPago('evt_em_contr', cobranca.id_externo!)).json()).toEqual({ duplicado: true });
    await dispararEmailsCobranca([{ cobrancaId: cobranca.id, tipo: 'pagamento_confirmado' }]);
    expect(await emailsDa(cobranca.id)).toHaveLength(2);
  });

  it('clínica sem e-mail próprio (ou igual ao do admin) ⇒ só o admin principal recebe', async () => {
    const { clinica, assinatura, admin } = await criarClinica({ emailClinica: null, responsavel: null });
    await prisma.clinica.update({ where: { id: clinica.id }, data: { email: admin.email.toUpperCase() } });
    const cobranca = await criarCobranca(clinica.id, assinatura.id, {
      id_externo: `pay_em_${sufixo}_um`,
      plano_contratado_id: planoContratado,
    });
    await webhookPago('evt_em_um', cobranca.id_externo!);
    const enviados = await emailsDa(cobranca.id);
    expect(enviados.map((e) => e.destinatario)).toEqual([admin.email]);
    expect(enviados[0]!.texto).toContain('Olá, Admin Principal!'); // sem responsável ⇒ nome do admin
  });

  it('assinatura bloqueada manualmente: plano não é liberado ⇒ nenhum pagamento_confirmado', async () => {
    const { clinica, assinatura } = await criarClinica();
    await prisma.assinatura.update({ where: { id: assinatura.id }, data: { status: 'bloqueada' } });
    const cobranca = await criarCobranca(clinica.id, assinatura.id, {
      id_externo: `pay_em_${sufixo}_bloq`,
      plano_contratado_id: planoContratado,
    });
    expect((await webhookPago('evt_em_bloq', cobranca.id_externo!)).statusCode).toBe(200);
    expect(await emailsDa(cobranca.id)).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------- pagamento_renovado

describe('pagamento_renovado (mensalidade)', () => {
  it('mensalidade paga ⇒ parcela conta a contratação paga; estornada não conta', async () => {
    const { clinica, assinatura } = await criarClinica();
    const hoje = hojeIso();
    await criarCobranca(clinica.id, assinatura.id, {
      vencimento: dataSemHora(somarDias(hoje, -40)),
      status: 'paga',
      pago_em: new Date(),
      plano_contratado_id: planoMensal,
    });
    await criarCobranca(clinica.id, assinatura.id, { vencimento: dataSemHora(somarDias(hoje, -10)), status: 'estornada' });
    await criarCobranca(clinica.id, assinatura.id, { vencimento: dataSemHora(somarDias(hoje, 40)), status: 'paga' }); // posterior
    const mensal = await criarCobranca(clinica.id, assinatura.id, {
      id_externo: `pay_em_${sufixo}_mensal`,
      vencimento: dataSemHora(somarDias(hoje, 5)),
    });

    const r = await webhookPago('evt_em_mensal', mensal.id_externo!);
    expect(r.statusCode).toBe(200);
    const enviados = await emailsDa(mensal.id);
    expect(enviados).toHaveLength(2);
    expect(enviados.every((e) => e.tipo === 'pagamento_renovado')).toBe(true);
    expect(enviados[0]!.assunto).toBe(`Pagamento recebido — parcela 2 do plano Mensal ${sufixo}`);
    expect(enviados[0]!.texto).toMatch(/R\$\s149,90/);
    expect(await emailsDa(mensal.id, 'pagamento_confirmado')).toHaveLength(0);
  });

  it('baixa manual também dispara o recibo', async () => {
    const { clinica, assinatura } = await criarClinica();
    const mensal = await criarCobranca(clinica.id, assinatura.id, { vencimento: dataSemHora(somarDias(hojeIso(), 3)) });
    const r = await app.inject({
      method: 'POST',
      url: `/admin/cobranca/cobrancas/${mensal.id}/pagar-manual`,
      headers: { authorization: `Bearer ${tokenAdmin}` },
      payload: {},
    });
    expect(r.statusCode, r.body).toBe(200);
    const enviados = await emailsDa(mensal.id, 'pagamento_renovado');
    expect(enviados).toHaveLength(2);
    expect(enviados[0]!.assunto).toContain('parcela 1');
  });

  it('pagamento de cobrança CANCELADA ⇒ nenhum e-mail', async () => {
    const { clinica, assinatura } = await criarClinica();
    const cancelada = await criarCobranca(clinica.id, assinatura.id, { id_externo: `pay_em_${sufixo}_canc`, status: 'cancelada' });
    const r = await webhookPago('evt_em_canc', cancelada.id_externo!);
    expect(r.statusCode).toBe(200);
    expect(r.json().aviso).toMatch(/CANCELADA/);
    expect(await emailsDa(cancelada.id)).toHaveLength(0);
  });

  it('falha ao enfileirar o e-mail não quebra o webhook', async () => {
    definirEnfileiradorEmail(async () => {
      throw new Error('redis fora do ar');
    });
    const { clinica, assinatura } = await criarClinica();
    const mensal = await criarCobranca(clinica.id, assinatura.id, { id_externo: `pay_em_${sufixo}_falha` });
    const r = await webhookPago('evt_em_falha', mensal.id_externo!);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect((await prisma.cobranca.findUniqueOrThrow({ where: { id: mensal.id } })).status).toBe('paga');
    const enviados = await emailsDa(mensal.id);
    expect(enviados.length).toBeGreaterThan(0);
    expect(enviados.every((e) => e.status === 'falhou' && e.erro?.startsWith('fila_indisponivel'))).toBe(true);
  });
});

// ----------------------------------------------------------------------------- aviso_renovacao

describe('aviso_renovacao (job diário)', () => {
  it(`mensalidade pendente vencendo em ${DIAS_AVISO_RENOVACAO} dias ⇒ aviso com link; rodar 2× não duplica; 3 dias ⇒ nada`, async () => {
    // Sem gateway ativo: o job não tenta gerar cobranças (nenhuma chamada a gateway), mas o aviso roda.
    await prisma.gatewayPagamento.updateMany({ data: { ativo: false } });
    const hoje = hojeIso();
    const { clinica, assinatura } = await criarClinica();
    const vencendo = await criarCobranca(clinica.id, assinatura.id, {
      vencimento: dataSemHora(somarDias(hoje, 2)),
      link_pagamento: `https://pagar.exemplo/aviso-${sufixo}`,
    });
    const depois = await criarCobranca(clinica.id, assinatura.id, {
      vencimento: dataSemHora(somarDias(hoje, 3)),
      link_pagamento: 'https://pagar.exemplo/3dias',
    });
    const semLink = await criarCobranca(clinica.id, assinatura.id, { vencimento: dataSemHora(somarDias(hoje, 2)) });
    const contratacao = await criarCobranca(clinica.id, assinatura.id, {
      vencimento: dataSemHora(somarDias(hoje, 2)),
      link_pagamento: 'https://pagar.exemplo/contr',
      plano_contratado_id: planoContratado,
    });

    const r1 = await executarJobCobrancas(hoje, SILENCIO);
    expect(r1.avisos_renovacao).toBeGreaterThanOrEqual(2);
    const avisos = await emailsDa(vencendo.id, 'aviso_renovacao');
    expect(avisos).toHaveLength(2);
    expect(avisos[0]!.texto).toContain(`https://pagar.exemplo/aviso-${sufixo}`);
    expect(avisos[0]!.html).toContain(`https://pagar.exemplo/aviso-${sufixo}`);
    // data_bloqueio = vencimento + tolerância do gateway (5 dias).
    const bloqueio = somarDias(hoje, 2 + 5).split('-').reverse().join('/');
    expect(avisos[0]!.texto).toContain(bloqueio);

    const r2 = await executarJobCobrancas(hoje, SILENCIO);
    expect(await emailsDa(vencendo.id, 'aviso_renovacao')).toHaveLength(2);
    expect(r2.avisos_renovacao).toBe(0);

    for (const c of [depois, semLink, contratacao]) expect(await emailsDa(c.id)).toHaveLength(0);
  });
});
