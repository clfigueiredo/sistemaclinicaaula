/**
 * Cobrança automática do SaaS (admin-cobranca + servicos/pagamentos + worker de cobranças).
 * O fetch dos gateways é SEMPRE mockado (nenhuma chamada real a Asaas/Stripe/Mercado Pago).
 * Cria os próprios dados (nomes/documentos únicos) e apaga no fim; a tabela gateways_pagamento (global)
 * é salva no início e restaurada no fim.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GatewayPagamento as RegistroGateway } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica, assinarTokenPlataforma } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';
import { executarJobCobrancas, hojeIso, proximoVencimento, somarDias, somarMeses } from '../src/modulos/admin-cobranca/servico';
import { definirFabricaGateway, type GatewayPagamento } from '../src/servicos/pagamentos';
import { dataSemHora } from '../src/servicos/financeiroComum';
import { descriptografarJson } from '../src/utils/cripto';

const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
let tokenAdmin: string;
let adminId: string;
let planoId: string;
let snapshotGateways: RegistroGateway[] = [];
const clinicas: string[] = [];
const eventosCriados: string[] = [];

const SILENCIO = { info: () => undefined, warn: () => undefined };
const API_KEY_ASAAS = `$aact_teste_${sufixo}_chaveSecretaAsaas`;
const TOKEN_WEBHOOK_ASAAS = `tokenWebhookAsaas_${sufixo}`;
const SK_STRIPE = `sk_test_${sufixo}ChaveStripe123`;
const WHSEC_STRIPE = `whsec_${sufixo}segredoStripe`;
const TOKEN_MP = `TEST-${sufixo}-tokenMercadoPago`;
const SEGREDO_MP = `segredoMercadoPago_${sufixo}`;

async function criarClinica(opcoes: { email?: string | null } = {}) {
  seq++;
  const clinica = await prisma.clinica.create({
    data: {
      nome: `Cobranca ${sufixo} ${seq}`,
      documento: `7${Date.now()}${seq}`.slice(0, 14),
      email: opcoes.email === undefined ? `clinica.${seq}.${sufixo}@cobranca.teste` : opcoes.email,
    },
  });
  clinicas.push(clinica.id);
  const assinatura = await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  const admin = await prisma.usuario.create({
    data: { clinica_id: clinica.id, nome: 'Admin', email: `adm.${seq}.${sufixo}@cobranca.teste`, senha_hash: 'x', papel: 'admin' },
  });
  const recepcao = await prisma.usuario.create({
    data: { clinica_id: clinica.id, nome: 'Recepção', email: `rec.${seq}.${sufixo}@cobranca.teste`, senha_hash: 'x', papel: 'recepcao' },
  });
  const token = assinarTokenClinica(app, { usuarioId: admin.id, clinicaId: clinica.id, papel: 'admin', profissionalId: null });
  const tokenRecepcao = assinarTokenClinica(app, {
    usuarioId: recepcao.id,
    clinicaId: clinica.id,
    papel: 'recepcao',
    profissionalId: null,
  });
  return { clinica, assinatura, token, tokenRecepcao };
}

function comoAdmin(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${tokenAdmin}` }, payload: payload as object });
}

/** Mock do fetch: responde pela primeira rota cujo padrão casa com "MÉTODO URL". Registra as chamadas. */
function mockarFetch(rotas: [RegExp, (init: RequestInit | undefined, url: string) => { status?: number; corpo: unknown }][]) {
  const chamadas: { metodo: string; url: string; init: RequestInit | undefined }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, init) => {
    const url = String(entrada);
    const metodo = (init?.method ?? 'GET').toUpperCase();
    chamadas.push({ metodo, url, init });
    const rota = rotas.find(([re]) => re.test(`${metodo} ${url}`));
    if (!rota) return new Response(JSON.stringify({ message: 'rota não mockada' }), { status: 404 });
    const r = rota[1](init, url);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return { chamadas, spy };
}

/** Gateway fake (fluxo de negócio sem HTTP). */
function criarFake() {
  const estado = { cobrancas: 0, clientes: 0, cancelamentos: 0 };
  const fabrica = (config: { provedor: 'asaas' | 'stripe' | 'mercado_pago' }): GatewayPagamento => ({
    provedor: config.provedor,
    testarConexao: async () => ({ ok: true, mensagem: 'ok' }),
    criarCliente: async () => ({ clienteExternoId: `cli_fake_${++estado.clientes}` }),
    criarAssinatura: async () => ({ assinaturaExternaId: 'sub_fake' }),
    criarCobranca: async (d) => ({
      idExterno: `pay_fake_${sufixo}_${++estado.cobrancas}`,
      status: 'pendente',
      linkPagamento: `https://pagar.exemplo/${d.referencia}`,
    }),
    cancelar: async () => {
      estado.cancelamentos++;
    },
    validarWebhook: () => true,
    interpretarWebhook: () => null,
  });
  return { estado, fabrica };
}

async function configurarAsaas(extra: Record<string, unknown> = {}) {
  const r = await comoAdmin('PUT', '/admin/cobranca/gateways/asaas', {
    ambiente: 'sandbox',
    credenciais: { api_key: API_KEY_ASAAS },
    segredo_webhook: TOKEN_WEBHOOK_ASAAS,
    dias_tolerancia: 5,
    metodos: ['pix', 'boleto', 'cartao'],
    ...extra,
  });
  expect(r.statusCode).toBe(200);
  return r.json();
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
    data: { nome: 'Super Cobrança', email: `super.${sufixo}@cobranca.teste`, senha_hash: 'x' },
  });
  adminId = admin.id;
  tokenAdmin = assinarTokenPlataforma(app, admin.id);
  const plano = await prisma.plano.create({ data: { nome: `Plano Cobrança ${sufixo}`, preco: 199.9 } });
  planoId = plano.id;
  snapshotGateways = await prisma.gatewayPagamento.findMany();
  await prisma.gatewayPagamento.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
  definirFabricaGateway(null);
});

afterAll(async () => {
  definirFabricaGateway(null);
  if (clinicas.length) await prisma.clinica.deleteMany({ where: { id: { in: clinicas } } });
  await prisma.eventoGateway.deleteMany({ where: { id_evento: { contains: sufixo } } });
  if (eventosCriados.length) await prisma.eventoGateway.deleteMany({ where: { id: { in: eventosCriados } } });
  if (planoId) await prisma.plano.deleteMany({ where: { id: planoId } });
  if (adminId) await prisma.usuarioPlataforma.deleteMany({ where: { id: adminId } });
  // Restaura a configuração global dos gateways.
  await prisma.gatewayPagamento.deleteMany({});
  for (const g of snapshotGateways.sort((a, b) => Number(a.ativo) - Number(b.ativo))) {
    await prisma.gatewayPagamento.create({ data: g });
  }
  await app.close();
});

// ----------------------------------------------------------------------------- acesso

describe('acesso', () => {
  it('rotas de configuração exigem super admin', async () => {
    const { token } = await criarClinica();
    const semToken = await app.inject({ method: 'GET', url: '/admin/cobranca/gateways' });
    expect(semToken.statusCode).toBe(401);
    const comClinica = await app.inject({
      method: 'PUT',
      url: '/admin/cobranca/gateways/asaas',
      headers: { authorization: `Bearer ${token}` },
      payload: { credenciais: { api_key: 'x'.repeat(20) } },
    });
    expect(comClinica.statusCode).toBe(403);
    expect(await prisma.gatewayPagamento.count()).toBe(0);
  });
});

// ----------------------------------------------------------------------------- configuração

describe('configuração dos gateways', () => {
  it('lista os 3 provedores com a URL do webhook e sem configuração', async () => {
    const r = await comoAdmin('GET', '/admin/cobranca/gateways');
    expect(r.statusCode).toBe(200);
    const lista = r.json() as { provedor: string; configurado: boolean; url_webhook: string }[];
    expect(lista.map((g) => g.provedor)).toEqual(['asaas', 'stripe', 'mercado_pago']);
    expect(lista.every((g) => !g.configurado)).toBe(true);
    expect(lista[0]!.url_webhook).toMatch(/\/webhooks\/pagamentos\/asaas$/);
  });

  it('segredos são salvos cifrados e nunca devolvidos em claro; vazio mantém o atual', async () => {
    const salvo = await configurarAsaas({ dia_vencimento_padrao: 15, descricao_cobranca: 'Mensalidade {plano} {competencia}' });
    const texto = JSON.stringify(salvo);
    expect(texto).not.toContain(API_KEY_ASAAS);
    expect(texto).not.toContain(TOKEN_WEBHOOK_ASAAS);
    expect(salvo).toMatchObject({
      configurado: true,
      credenciais_final: API_KEY_ASAAS.slice(-4),
      segredo_webhook_configurado: true,
      segredo_webhook_final: TOKEN_WEBHOOK_ASAAS.slice(-4),
      dia_vencimento_padrao: 15,
      descricao_cobranca: 'Mensalidade {plano} {competencia}',
    });

    const registro = await prisma.gatewayPagamento.findUniqueOrThrow({ where: { provedor: 'asaas' } });
    expect(registro.credenciais_cifradas).not.toContain(API_KEY_ASAAS);
    expect(registro.segredo_webhook_cifrado).not.toContain(TOKEN_WEBHOOK_ASAAS);
    expect(descriptografarJson<{ api_key: string }>(registro.credenciais_cifradas!).api_key).toBe(API_KEY_ASAAS);

    // Edição com campos vazios mantém os segredos.
    const editado = await comoAdmin('PUT', '/admin/cobranca/gateways/asaas', {
      credenciais: { api_key: '' },
      segredo_webhook: '',
      dias_tolerancia: 7,
    });
    expect(editado.statusCode).toBe(200);
    expect(editado.json()).toMatchObject({ configurado: true, dias_tolerancia: 7, segredo_webhook_configurado: true });
    const depois = await prisma.gatewayPagamento.findUniqueOrThrow({ where: { provedor: 'asaas' } });
    expect(descriptografarJson<{ api_key: string }>(depois.credenciais_cifradas!).api_key).toBe(API_KEY_ASAAS);
    expect(depois.segredo_webhook_cifrado).toBe(registro.segredo_webhook_cifrado);

    const lista = await comoAdmin('GET', '/admin/cobranca/gateways');
    expect(lista.body).not.toContain(API_KEY_ASAAS);
    expect(lista.body).not.toContain(TOKEN_WEBHOOK_ASAAS);
    await configurarAsaas(); // volta tolerância 5
  });

  it('valida chaves do Stripe (formato e ambiente)', async () => {
    const r = await comoAdmin('PUT', '/admin/cobranca/gateways/stripe', {
      ambiente: 'sandbox',
      credenciais: { secret_key: `sk_live_${sufixo}abc` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('ambiente_incompativel');
    const semWhsec = await comoAdmin('PUT', '/admin/cobranca/gateways/stripe', {
      credenciais: { secret_key: SK_STRIPE },
      segredo_webhook: 'semPrefixo12345',
    });
    expect(semWhsec.statusCode).toBe(400);
  });

  it('só um gateway ativo; não ativa sem credenciais', async () => {
    const semCred = await comoAdmin('POST', '/admin/cobranca/gateways/mercado_pago/ativar');
    expect(semCred.statusCode).toBe(409);
    expect(semCred.json().erro).toBe('gateway_nao_configurado');

    await configurarAsaas();
    const stripe = await comoAdmin('PUT', '/admin/cobranca/gateways/stripe', {
      ambiente: 'sandbox',
      credenciais: { secret_key: SK_STRIPE },
      segredo_webhook: WHSEC_STRIPE,
      metodos: ['cartao', 'boleto'],
    });
    expect(stripe.statusCode).toBe(200);

    expect((await comoAdmin('POST', '/admin/cobranca/gateways/asaas/ativar')).json().ativo).toBe(true);
    expect((await comoAdmin('POST', '/admin/cobranca/gateways/stripe/ativar')).json().ativo).toBe(true);
    const ativos = await prisma.gatewayPagamento.findMany({ where: { ativo: true } });
    expect(ativos.map((g) => g.provedor)).toEqual(['stripe']);

    expect((await comoAdmin('POST', '/admin/cobranca/gateways/stripe/desativar')).json().ativo).toBe(false);
    expect(await prisma.gatewayPagamento.count({ where: { ativo: true } })).toBe(0);
  });

  it('testar conexão: ok e erro amigável (fetch mockado)', async () => {
    await configurarAsaas();
    const { chamadas } = mockarFetch([[/^GET https:\/\/api-sandbox\.asaas\.com\/v3\/customers\?limit=1$/, () => ({ corpo: { data: [] } })]]);
    const ok = await comoAdmin('POST', '/admin/cobranca/gateways/asaas/testar');
    expect(ok.json()).toMatchObject({ ok: true });
    expect(chamadas).toHaveLength(1);
    expect((chamadas[0]!.init!.headers as Record<string, string>).access_token).toBe(API_KEY_ASAAS);
    vi.restoreAllMocks();

    mockarFetch([[/customers/, () => ({ status: 401, corpo: { errors: [{ description: 'invalid token' }] } })]]);
    const erro = await comoAdmin('POST', '/admin/cobranca/gateways/asaas/testar');
    expect(erro.statusCode).toBe(200);
    expect(erro.json().ok).toBe(false);
    expect(erro.json().mensagem).toMatch(/Credenciais recusadas/);
    expect(erro.body).not.toContain(API_KEY_ASAAS);
    vi.restoreAllMocks();

    // Stripe: GET /v1/balance e ambiente conferido pelo livemode.
    mockarFetch([[/^GET https:\/\/api\.stripe\.com\/v1\/balance$/, () => ({ corpo: { livemode: true } })]]);
    const incompat = await comoAdmin('POST', '/admin/cobranca/gateways/stripe/testar');
    expect(incompat.json()).toMatchObject({ ok: false });

    const naoConfigurado = await comoAdmin('POST', '/admin/cobranca/gateways/mercado_pago/testar');
    expect(naoConfigurado.json().ok).toBe(false);
  });
});

// ----------------------------------------------------------------------------- geração

describe('geração de cobrança', () => {
  it('sem gateway ativo: 409 e nada gravado', async () => {
    await prisma.gatewayPagamento.updateMany({ data: { ativo: false } });
    const { clinica } = await criarClinica();
    const r = await comoAdmin('POST', `/admin/cobranca/clinicas/${clinica.id}/cobrancas`, { vencimento: somarDias(hojeIso(), 5) });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toBe('gateway_inativo');
    expect(await prisma.cobranca.count({ where: { clinica_id: clinica.id } })).toBe(0);
    // O job não quebra sem gateway.
    const resumo = await executarJobCobrancas(hojeIso(), SILENCIO);
    expect(resumo.aviso).toMatch(/Nenhum gateway/);
  });

  it('Asaas (fetch mockado): cria cliente + cobrança e grava com link', async () => {
    await configurarAsaas();
    await comoAdmin('POST', '/admin/cobranca/gateways/asaas/ativar');
    const { clinica } = await criarClinica();
    const { chamadas } = mockarFetch([
      [/^GET https:\/\/api-sandbox\.asaas\.com\/v3\/customers\?cpfCnpj=/, () => ({ corpo: { data: [] } })],
      [/^POST https:\/\/api-sandbox\.asaas\.com\/v3\/customers$/, () => ({ corpo: { id: `cus_${sufixo}` } })],
      [
        /^POST https:\/\/api-sandbox\.asaas\.com\/v3\/payments$/,
        () => ({ corpo: { id: `pay_${sufixo}_1`, status: 'PENDING', invoiceUrl: `https://sandbox.asaas.com/i/${sufixo}` } }),
      ],
    ]);
    const vencimento = somarDias(hojeIso(), 5);
    const r = await comoAdmin('POST', `/admin/cobranca/clinicas/${clinica.id}/cobrancas`, { vencimento, metodo: 'pix' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pendente',
      valor: '199.90',
      vencimento,
      id_externo: `pay_${sufixo}_1`,
      link_pagamento: `https://sandbox.asaas.com/i/${sufixo}`,
    });
    const corpoPagamento = JSON.parse(String(chamadas.find((c) => c.url.endsWith('/payments'))!.init!.body));
    expect(corpoPagamento).toMatchObject({ customer: `cus_${sufixo}`, billingType: 'PIX', value: 199.9, dueDate: vencimento });
    expect(corpoPagamento.externalReference).toBe(r.json().id);
    const assinatura = await prisma.assinatura.findUniqueOrThrow({ where: { clinica_id: clinica.id } });
    expect(assinatura).toMatchObject({ gateway: 'asaas', cliente_externo_id: `cus_${sufixo}` });
  });

  it('falha no gateway não deixa cobrança gravada', async () => {
    await configurarAsaas();
    await comoAdmin('POST', '/admin/cobranca/gateways/asaas/ativar');
    const { clinica } = await criarClinica();
    mockarFetch([
      [/customers\?cpfCnpj=/, () => ({ corpo: { data: [{ id: 'cus_x' }] } })],
      [/payments$/, () => ({ status: 400, corpo: { errors: [{ description: 'Data de vencimento inválida.' }] } })],
    ]);
    const r = await comoAdmin('POST', `/admin/cobranca/clinicas/${clinica.id}/cobrancas`, { vencimento: somarDias(hojeIso(), 3) });
    expect(r.statusCode).toBe(502);
    expect(r.json().mensagem).toMatch(/Data de vencimento inválida/);
    expect(await prisma.cobranca.count({ where: { clinica_id: clinica.id } })).toBe(0);
  });
});

// ----------------------------------------------------------------------------- webhooks

async function criarCobrancaDireta(clinicaId: string, assinaturaId: string, dados: Record<string, unknown>) {
  return prisma.cobranca.create({
    data: {
      clinica_id: clinicaId,
      assinatura_id: assinaturaId,
      gateway: 'asaas',
      valor: 199.9,
      vencimento: dataSemHora(somarDias(hojeIso(), 2)),
      status: 'pendente',
      ...dados,
    },
  });
}

describe('webhooks', () => {
  it('Asaas: token inválido ⇒ 401 e nada muda', async () => {
    await configurarAsaas();
    const { clinica, assinatura } = await criarClinica();
    const cobranca = await criarCobrancaDireta(clinica.id, assinatura.id, { id_externo: `pay_${sufixo}_inv` });
    const corpo = { id: `evt_${sufixo}_inv`, event: 'PAYMENT_RECEIVED', payment: { id: `pay_${sufixo}_inv`, status: 'RECEIVED' } };
    for (const token of [undefined, 'errado', `${TOKEN_WEBHOOK_ASAAS}x`]) {
      const r = await app.inject({
        method: 'POST',
        url: '/webhooks/pagamentos/asaas',
        headers: { 'content-type': 'application/json', ...(token && { 'asaas-access-token': token }) },
        payload: JSON.stringify(corpo),
      });
      expect(r.statusCode).toBe(401);
    }
    expect((await prisma.cobranca.findUniqueOrThrow({ where: { id: cobranca.id } })).status).toBe('pendente');
    expect(await prisma.eventoGateway.count({ where: { id_evento: `evt_${sufixo}_inv` } })).toBe(0);
  });

  it('Asaas: pagamento confirmado ⇒ cobrança paga + assinatura ativa; mesmo evento 2× processa uma vez', async () => {
    await configurarAsaas();
    const { clinica, assinatura } = await criarClinica();
    await prisma.assinatura.update({ where: { id: assinatura.id }, data: { status: 'vencida' } });
    const vencimento = somarDias(hojeIso(), 2);
    const cobranca = await criarCobrancaDireta(clinica.id, assinatura.id, {
      id_externo: `pay_${sufixo}_ok`,
      vencimento: dataSemHora(vencimento),
    });
    const corpo = JSON.stringify({
      id: `evt_${sufixo}_ok`,
      event: 'PAYMENT_RECEIVED',
      payment: { id: `pay_${sufixo}_ok`, status: 'RECEIVED', value: 199.9, paymentDate: hojeIso() },
    });
    const enviar = () =>
      app.inject({
        method: 'POST',
        url: '/webhooks/pagamentos/asaas',
        headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN_WEBHOOK_ASAAS },
        payload: corpo,
      });

    const r1 = await enviar();
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ ok: true });
    const paga = await prisma.cobranca.findUniqueOrThrow({ where: { id: cobranca.id } });
    expect(paga.status).toBe('paga');
    expect(paga.pago_em).not.toBeNull();
    const a = await prisma.assinatura.findUniqueOrThrow({ where: { id: assinatura.id } });
    expect(a.status).toBe('ativa');
    // expira_em = vencimento + 1 mês + tolerância (5 dias), fim do dia em Brasília.
    const esperado = somarDias(somarMeses(vencimento, 1), 5);
    expect(a.expira_em!.toISOString().slice(0, 10) >= esperado).toBe(true);

    // Simula alteração posterior: o reenvio do mesmo evento não pode reaplicar.
    await prisma.assinatura.update({ where: { id: assinatura.id }, data: { status: 'bloqueada' } });
    const r2 = await enviar();
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual({ duplicado: true });
    expect((await prisma.assinatura.findUniqueOrThrow({ where: { id: assinatura.id } })).status).toBe('bloqueada');
    expect(await prisma.eventoGateway.count({ where: { gateway: 'asaas', id_evento: `evt_${sufixo}_ok` } })).toBe(1);

    // Log de eventos no admin.
    const eventos = await comoAdmin('GET', '/admin/cobranca/eventos?gateway=asaas');
    expect(eventos.statusCode).toBe(200);
    expect(eventos.json().itens.some((e: { id_evento: string; processado_em: string | null }) => e.id_evento === `evt_${sufixo}_ok` && e.processado_em)).toBe(true);
  });

  it('Stripe: assinatura HMAC inválida/antiga ⇒ 401; válida ⇒ paga', async () => {
    await comoAdmin('PUT', '/admin/cobranca/gateways/stripe', {
      ambiente: 'sandbox',
      credenciais: { secret_key: SK_STRIPE },
      segredo_webhook: WHSEC_STRIPE,
    });
    const { clinica, assinatura } = await criarClinica();
    const cobranca = await criarCobrancaDireta(clinica.id, assinatura.id, { gateway: 'stripe', id_externo: `in_${sufixo}` });
    const corpo = JSON.stringify({
      id: `evt_${sufixo}_stripe`,
      type: 'invoice.paid',
      data: { object: { id: `in_${sufixo}`, status: 'paid', amount_paid: 19990, metadata: { referencia: cobranca.id } } },
    });
    const assinar = (t: number, segredo = WHSEC_STRIPE) =>
      `t=${t},v1=${createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex')}`;
    const enviar = (assinatura: string, payload = corpo) =>
      app.inject({
        method: 'POST',
        url: '/webhooks/pagamentos/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': assinatura },
        payload,
      });
    const agora = Math.floor(Date.now() / 1000);

    expect((await enviar(assinar(agora, 'whsec_outro'))).statusCode).toBe(401);
    expect((await enviar(assinar(agora - 3600))).statusCode).toBe(401); // fora da tolerância
    expect((await enviar(assinar(agora), corpo.replace('19990', '1'))).statusCode).toBe(401); // corpo adulterado
    expect((await prisma.cobranca.findUniqueOrThrow({ where: { id: cobranca.id } })).status).toBe('pendente');

    const ok = await enviar(assinar(agora));
    expect(ok.statusCode).toBe(200);
    expect((await prisma.cobranca.findUniqueOrThrow({ where: { id: cobranca.id } })).status).toBe('paga');
  });

  it('Mercado Pago: x-signature + consulta do pagamento na API ⇒ paga', async () => {
    const cfg = await comoAdmin('PUT', '/admin/cobranca/gateways/mercado_pago', {
      ambiente: 'sandbox',
      credenciais: { access_token: TOKEN_MP },
      segredo_webhook: SEGREDO_MP,
    });
    expect(cfg.statusCode).toBe(200);
    const { clinica, assinatura } = await criarClinica();
    const cobranca = await criarCobrancaDireta(clinica.id, assinatura.id, { gateway: 'mercado_pago', id_externo: `pref_${sufixo}` });
    const idPagamento = `9${Date.now()}`;
    const { chamadas } = mockarFetch([
      [
        new RegExp(`^GET https://api\\.mercadopago\\.com/v1/payments/${idPagamento}$`),
        () => ({ corpo: { id: Number(idPagamento), status: 'approved', external_reference: cobranca.id, transaction_amount: 199.9 } }),
      ],
    ]);
    const corpo = JSON.stringify({ action: 'payment.updated', type: 'payment', data: { id: idPagamento } });
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `req-${sufixo}`;
    const manifesto = `id:${idPagamento};request-id:${requestId};ts:${ts};`;
    const v1 = createHmac('sha256', SEGREDO_MP).update(manifesto).digest('hex');
    const url = `/webhooks/pagamentos/mercado_pago?data.id=${idPagamento}&type=payment`;

    const invalido = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${'0'.repeat(64)}`, 'x-request-id': requestId },
      payload: corpo,
    });
    expect(invalido.statusCode).toBe(401);
    expect(chamadas).toHaveLength(0); // não consulta a API sem assinatura válida

    const ok = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      payload: corpo,
    });
    expect(ok.statusCode).toBe(200);
    expect(chamadas).toHaveLength(1);
    expect((chamadas[0]!.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN_MP}`);
    expect((await prisma.cobranca.findUniqueOrThrow({ where: { id: cobranca.id } })).status).toBe('paga');
    await prisma.eventoGateway.deleteMany({ where: { gateway: 'mercado_pago', id_evento: { contains: idPagamento } } });
  });
});

// ----------------------------------------------------------------------------- worker

describe('worker de cobranças', () => {
  it('gera a cobrança do próximo ciclo sem duplicar o mês', async () => {
    await configurarAsaas();
    await comoAdmin('POST', '/admin/cobranca/gateways/asaas/ativar');
    const fake = criarFake();
    definirFabricaGateway(fake.fabrica);
    const { clinica } = await criarClinica();

    // Liga a cobrança automática sem gerar agora; o job gera quando faltar ≤ 10 dias.
    const hoje = hojeIso();
    const dia = Number(somarDias(hoje, 5).slice(8, 10));
    const diaVencimento = Math.min(28, Math.max(1, dia));
    const ativar = await comoAdmin('POST', `/admin/cobranca/clinicas/${clinica.id}/assinatura`, {
      dia_vencimento: diaVencimento,
      gerar_agora: false,
    });
    expect(ativar.statusCode).toBe(200);
    expect(ativar.json().assinatura).toMatchObject({ cobranca_automatica: true, dia_vencimento: diaVencimento, gateway: 'asaas' });

    const vencimento = proximoVencimento(hoje, diaVencimento);
    const diaDoJob = somarDias(vencimento, -5);
    const r1 = await executarJobCobrancas(diaDoJob, SILENCIO);
    const r2 = await executarJobCobrancas(diaDoJob, SILENCIO);
    expect(r1.geradas).toBeGreaterThanOrEqual(1);
    expect(r2.erros).toBe(0);
    const doMes = await prisma.cobranca.findMany({ where: { clinica_id: clinica.id } });
    expect(doMes).toHaveLength(1);
    expect(doMes[0]!.vencimento.toISOString().slice(0, 10)).toBe(vencimento);
    expect(doMes[0]!.link_pagamento).toMatch(/^https:\/\/pagar\.exemplo\//);

    // Visão da clínica no admin.
    const visao = await comoAdmin('GET', `/admin/cobranca/clinicas/${clinica.id}`);
    expect(visao.json().cobrancas).toHaveLength(1);

    // Cancelamento: chama o gateway e marca cancelada; o job não recria o mês.
    const cancelar = await comoAdmin('POST', `/admin/cobranca/cobrancas/${doMes[0]!.id}/cancelar`);
    expect(cancelar.statusCode).toBe(200);
    expect(cancelar.json().status).toBe('cancelada');
    expect(fake.estado.cancelamentos).toBe(1);
    await executarJobCobrancas(diaDoJob, SILENCIO);
    expect(await prisma.cobranca.count({ where: { clinica_id: clinica.id } })).toBe(1);

    const desligar = await comoAdmin('DELETE', `/admin/cobranca/clinicas/${clinica.id}/assinatura`);
    expect(desligar.json().assinatura.cobranca_automatica).toBe(false);
  });

  it('tolerância: cobrança em aberto há mais de N dias ⇒ assinatura vencida', async () => {
    await configurarAsaas(); // tolerância 5
    const hoje = hojeIso();
    const atrasada = await criarClinica();
    const dentro = await criarClinica();
    await criarCobrancaDireta(atrasada.clinica.id, atrasada.assinatura.id, { vencimento: dataSemHora(somarDias(hoje, -6)) });
    await criarCobrancaDireta(dentro.clinica.id, dentro.assinatura.id, { vencimento: dataSemHora(somarDias(hoje, -5)) });

    const r = await executarJobCobrancas(hoje, SILENCIO);
    expect(r.assinaturas_vencidas).toBeGreaterThanOrEqual(1);
    expect((await prisma.assinatura.findUniqueOrThrow({ where: { id: atrasada.assinatura.id } })).status).toBe('vencida');
    expect((await prisma.assinatura.findUniqueOrThrow({ where: { id: dentro.assinatura.id } })).status).toBe('ativa');
    const cobrancas = await prisma.cobranca.findMany({ where: { clinica_id: { in: [atrasada.clinica.id, dentro.clinica.id] } } });
    expect(cobrancas.every((c) => c.status === 'vencida')).toBe(true);
  });
});

// ----------------------------------------------------------------------------- clínica

describe('faturas da clínica', () => {
  it('admin da clínica só vê as próprias faturas (sem payload); recepção não acessa', async () => {
    const a = await criarClinica();
    const b = await criarClinica();
    await criarCobrancaDireta(a.clinica.id, a.assinatura.id, { link_pagamento: 'https://pagar/a', payload: { segredo: 'x' } });
    await criarCobrancaDireta(b.clinica.id, b.assinatura.id, { link_pagamento: 'https://pagar/b' });

    const r = await app.inject({ method: 'GET', url: '/cobrancas/minhas', headers: { authorization: `Bearer ${a.token}` } });
    expect(r.statusCode).toBe(200);
    const itens = r.json() as { clinica_id: string; link_pagamento: string; payload?: unknown }[];
    expect(itens).toHaveLength(1);
    expect(itens[0]!.clinica_id).toBe(a.clinica.id);
    expect(itens[0]!.link_pagamento).toBe('https://pagar/a');
    expect(itens[0]).not.toHaveProperty('payload');

    const rec = await app.inject({ method: 'GET', url: '/cobrancas/minhas', headers: { authorization: `Bearer ${a.tokenRecepcao}` } });
    expect(rec.statusCode).toBe(403);

    // Lista do admin com totais e filtro por clínica.
    const lista = await comoAdmin('GET', `/admin/cobranca/cobrancas?clinica_id=${a.clinica.id}`);
    expect(lista.statusCode).toBe(200);
    expect(lista.json()).toMatchObject({ total: 1, totais: { pendente: '199.90' } });
    expect(lista.json().itens[0].clinica.id).toBe(a.clinica.id);
    expect(lista.json().itens[0]).not.toHaveProperty('payload');
  });
});
