/**
 * Contratação de plano pela própria clínica (módulo contratacao) + planos da landing (GET /publico/planos).
 * O gateway é SEMPRE fake/mockado (nenhuma chamada real ao Asaas). Cria os próprios dados e apaga no fim;
 * a tabela gateways_pagamento (global) é salva no início e restaurada no fim.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GatewayPagamento as RegistroGateway } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica, assinarTokenPlataforma } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';
import { executarJobCobrancas, hojeIso, somarDias, somarMeses } from '../src/modulos/admin-cobranca/servico';
import { definirFabricaGateway, type GatewayPagamento } from '../src/servicos/pagamentos';
import { dataSemHora } from '../src/servicos/financeiroComum';

const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
let tokenAdmin: string;
let adminId: string;
let snapshotGateways: RegistroGateway[] = [];
const clinicas: string[] = [];
const planos: string[] = [];

const SILENCIO = { info: () => undefined, warn: () => undefined };
const TOKEN_WEBHOOK_ASAAS = `tokenWebhookAsaas_${sufixo}`;

let planoGratis: string; // gratuito, na landing
let planoBasico: string; // pago, contratável, na landing
let planoPro: string; // pago, contratável, fora da landing
let planoOculto: string; // pago, não contratável, fora da landing

async function criarPlano(dados: { nome: string; preco: number; contratavel?: boolean; exibir_landing?: boolean; ativo?: boolean }) {
  const p = await prisma.plano.create({ data: { ...dados, nome: `${dados.nome} ${sufixo}` } });
  planos.push(p.id);
  await prisma.planoRecurso.createMany({
    data: [
      { plano_id: p.id, recurso_codigo: 'max_profissionais', habilitado: true, limite: 3, periodo: 'total' },
      { plano_id: p.id, recurso_codigo: 'financeiro', habilitado: true },
      { plano_id: p.id, recurso_codigo: 'dashboard', habilitado: false },
    ],
  });
  return p.id;
}

async function criarClinica(opcoes: { planoId?: string; status?: 'teste' | 'ativa' } = {}) {
  seq++;
  const clinica = await prisma.clinica.create({
    data: {
      nome: `Contratacao ${sufixo} ${seq}`,
      documento: `8${Date.now()}${seq}`.slice(0, 14),
      email: `clinica.${seq}.${sufixo}@contratacao.teste`,
    },
  });
  clinicas.push(clinica.id);
  const assinatura = await prisma.assinatura.create({
    data: { clinica_id: clinica.id, plano_id: opcoes.planoId ?? planoGratis, status: opcoes.status ?? 'teste' },
  });
  const admin = await prisma.usuario.create({
    data: { clinica_id: clinica.id, nome: 'Admin', email: `adm.${seq}.${sufixo}@contratacao.teste`, senha_hash: 'x', papel: 'admin' },
  });
  const recepcao = await prisma.usuario.create({
    data: { clinica_id: clinica.id, nome: 'Recepção', email: `rec.${seq}.${sufixo}@contratacao.teste`, senha_hash: 'x', papel: 'recepcao' },
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

function como(token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
}

/** Gateway fake (sem HTTP): conta cobranças e cancelamentos. */
function usarGatewayFake() {
  const estado = { cobrancas: 0, cancelamentos: 0, valores: [] as number[], descricoes: [] as string[] };
  definirFabricaGateway(
    (config): GatewayPagamento => ({
      provedor: config.provedor,
      testarConexao: async () => ({ ok: true, mensagem: 'ok' }),
      criarCliente: async () => ({ clienteExternoId: `cli_fake_${sufixo}` }),
      criarAssinatura: async () => ({ assinaturaExternaId: 'sub_fake' }),
      criarCobranca: async (d) => {
        estado.valores.push(d.valor);
        estado.descricoes.push(d.descricao);
        return { idExterno: `pay_ct_${sufixo}_${++estado.cobrancas}`, status: 'pendente', linkPagamento: `https://pagar.exemplo/${d.referencia}` };
      },
      cancelar: async () => {
        estado.cancelamentos++;
      },
      validarWebhook: () => true,
      interpretarWebhook: () => null,
    }),
  );
  return estado;
}

async function ativarAsaas() {
  const r = await como(tokenAdmin, 'PUT', '/admin/cobranca/gateways/asaas', {
    ambiente: 'sandbox',
    credenciais: { api_key: `$aact_hmlg_${sufixo}_chave` },
    segredo_webhook: TOKEN_WEBHOOK_ASAAS,
    dias_tolerancia: 5,
    metodos: ['pix', 'boleto', 'cartao'],
  });
  expect(r.statusCode).toBe(200);
  expect((await como(tokenAdmin, 'POST', '/admin/cobranca/gateways/asaas/ativar')).statusCode).toBe(200);
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
    data: { nome: 'Super Contratação', email: `super.${sufixo}@contratacao.teste`, senha_hash: 'x' },
  });
  adminId = admin.id;
  tokenAdmin = assinarTokenPlataforma(app, admin.id);
  planoGratis = await criarPlano({ nome: 'Grátis', preco: 0, exibir_landing: true });
  planoBasico = await criarPlano({ nome: 'Básico', preco: 99.9, contratavel: true, exibir_landing: true });
  planoPro = await criarPlano({ nome: 'Pro', preco: 199.9, contratavel: true });
  planoOculto = await criarPlano({ nome: 'Sob medida', preco: 500, exibir_landing: false });
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
  if (planos.length) await prisma.plano.deleteMany({ where: { id: { in: planos } } });
  if (adminId) await prisma.usuarioPlataforma.deleteMany({ where: { id: adminId } });
  await prisma.gatewayPagamento.deleteMany({});
  for (const g of snapshotGateways.sort((a, b) => Number(a.ativo) - Number(b.ativo))) {
    await prisma.gatewayPagamento.create({ data: g });
  }
  await app.close();
});

describe('planos na landing (público)', () => {
  it('lista só planos ativos marcados para a landing, sem login, com os recursos inclusos', async () => {
    const r = await app.inject({ method: 'GET', url: '/publico/planos' });
    expect(r.statusCode).toBe(200);
    const lista = r.json() as { id: string; preco: string; gratuito: boolean; recursos: { codigo: string; limite: number | null }[] }[];
    const ids = lista.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([planoGratis, planoBasico]));
    expect(ids).not.toContain(planoPro);
    expect(ids).not.toContain(planoOculto);
    const basico = lista.find((p) => p.id === planoBasico)!;
    expect(basico).toMatchObject({ preco: '99.90', gratuito: false });
    expect(basico.recursos.map((x) => x.codigo)).toEqual(['max_profissionais', 'financeiro']);
    expect(basico.recursos[0]!.limite).toBe(3);
    expect(lista.find((p) => p.id === planoGratis)!.gratuito).toBe(true);
    // Nada interno vaza.
    expect(Object.keys(basico)).not.toContain('total_clinicas');
    expect(Object.keys(basico)).not.toContain('contratavel');
  });

  it('plano inativo some da landing', async () => {
    await prisma.plano.update({ where: { id: planoBasico }, data: { ativo: false } });
    const ids = (await app.inject({ method: 'GET', url: '/publico/planos' })).json().map((p: { id: string }) => p.id);
    expect(ids).not.toContain(planoBasico);
    await prisma.plano.update({ where: { id: planoBasico }, data: { ativo: true } });
  });
});

describe('super admin: opções do plano', () => {
  it('grava contratavel/exibir_landing e recusa plano gratuito contratável', async () => {
    const r = await como(tokenAdmin, 'PUT', `/admin/planos/${planoPro}`, { exibir_landing: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ contratavel: true, exibir_landing: true });
    await como(tokenAdmin, 'PUT', `/admin/planos/${planoPro}`, { exibir_landing: false });

    const gratis = await como(tokenAdmin, 'PUT', `/admin/planos/${planoGratis}`, { contratavel: true });
    expect(gratis.statusCode).toBe(409);
    expect(gratis.json().erro).toBe('plano_gratuito_contratavel');
    // Zerar o preço de um plano contratável também é recusado.
    const zerar = await como(tokenAdmin, 'PUT', `/admin/planos/${planoPro}`, { preco: 0 });
    expect(zerar.statusCode).toBe(409);

    const criado = await como(tokenAdmin, 'POST', '/admin/planos', { nome: `Novo ${sufixo}`, preco: 0, contratavel: true });
    expect(criado.statusCode).toBe(409);
  });
});

describe('contratação pela clínica', () => {
  it('sem gateway ativo: lista os planos mas não deixa contratar', async () => {
    const { token } = await criarClinica();
    const r = await como(token, 'GET', '/contratacao');
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo).toMatchObject({ pode_contratar: false, motivo: 'pagamento_indisponivel', pendente: null });
    expect(corpo.plano_atual.id).toBe(planoGratis);
    const ids = corpo.planos.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([planoBasico, planoPro]));
    expect(ids).not.toContain(planoOculto);
    expect(ids).not.toContain(planoGratis);

    const post = await como(token, 'POST', '/contratacao', { plano_id: planoBasico });
    expect(post.statusCode).toBe(409);
    expect(post.json().erro).toBe('pagamento_indisponivel');
  });

  it('só o admin da clínica acessa', async () => {
    const { tokenRecepcao } = await criarClinica();
    expect((await como(tokenRecepcao, 'GET', '/contratacao')).statusCode).toBe(403);
    expect((await como(tokenRecepcao, 'POST', '/contratacao', { plano_id: planoBasico })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/contratacao' })).statusCode).toBe(401);
  });

  it('gera a cobrança do plano escolhido sem trocar o plano; mesma escolha reaproveita; outra cancela a anterior', async () => {
    await ativarAsaas();
    const fake = usarGatewayFake();
    const { clinica, token } = await criarClinica();

    const r1 = await como(token, 'POST', '/contratacao', { plano_id: planoBasico });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().link_pagamento).toMatch(/^https:\/\/pagar\.exemplo\//);
    expect(r1.json().cobranca).toMatchObject({
      status: 'pendente',
      valor: '99.90',
      vencimento: hojeIso(),
      plano_contratado_id: planoBasico,
    });
    expect(fake.valores).toEqual([99.9]);
    expect(fake.descricoes[0]).toContain(`Básico ${sufixo}`);
    // O plano NÃO muda antes do pagamento.
    const a = await prisma.assinatura.findUniqueOrThrow({ where: { clinica_id: clinica.id } });
    expect(a).toMatchObject({ plano_id: planoGratis, status: 'teste', dia_vencimento: null });

    const situacao = (await como(token, 'GET', '/contratacao')).json();
    expect(situacao.pode_contratar).toBe(true);
    expect(situacao.pendente).toMatchObject({ id: r1.json().cobranca.id, plano_nome: `Básico ${sufixo}` });

    const r2 = await como(token, 'POST', '/contratacao', { plano_id: planoBasico });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().cobranca.id).toBe(r1.json().cobranca.id);
    expect(fake.cobrancas).toBe(1);

    const r3 = await como(token, 'POST', '/contratacao', { plano_id: planoPro });
    expect(r3.statusCode).toBe(201);
    expect(r3.json().cobranca).toMatchObject({ valor: '199.90', plano_contratado_id: planoPro });
    expect(fake.cancelamentos).toBe(1);
    const anterior = await prisma.cobranca.findUniqueOrThrow({ where: { id: r1.json().cobranca.id } });
    expect(anterior.status).toBe('cancelada');
    expect(
      await prisma.cobranca.count({ where: { clinica_id: clinica.id, status: 'pendente', plano_contratado_id: { not: null } } }),
    ).toBe(1);
  });

  it('recusa plano não contratável, inexistente ou clínica que já está em plano pago', async () => {
    await ativarAsaas();
    usarGatewayFake();
    const { token } = await criarClinica();
    expect((await como(token, 'POST', '/contratacao', { plano_id: planoOculto })).json().erro).toBe('plano_indisponivel');
    expect((await como(token, 'POST', '/contratacao', { plano_id: planoGratis })).json().erro).toBe('plano_indisponivel');
    expect((await como(token, 'POST', '/contratacao', { plano_id: randomUUID() })).statusCode).toBe(404);

    const paga = await criarClinica({ planoId: planoPro, status: 'ativa' });
    const g = (await como(paga.token, 'GET', '/contratacao')).json();
    expect(g).toMatchObject({ pode_contratar: false, motivo: 'plano_pago' });
    const p = await como(paga.token, 'POST', '/contratacao', { plano_id: planoBasico });
    expect(p.statusCode).toBe(409);
    expect(p.json().erro).toBe('plano_pago');
  });

  it('pagamento confirmado (webhook Asaas) troca o plano, ativa e liga a cobrança mensal', async () => {
    await ativarAsaas();
    const { clinica, assinatura, token } = await criarClinica();
    const cobranca = await prisma.cobranca.create({
      data: {
        clinica_id: clinica.id,
        assinatura_id: assinatura.id,
        gateway: 'asaas',
        id_externo: `pay_ct_${sufixo}_webhook`,
        valor: 99.9,
        vencimento: dataSemHora(hojeIso()),
        status: 'pendente',
        ambiente: 'sandbox',
        plano_contratado_id: planoBasico,
        link_pagamento: 'https://pagar.exemplo/x',
      },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/pagamentos/asaas',
      headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN_WEBHOOK_ASAAS },
      payload: JSON.stringify({
        id: `evt_${sufixo}_contratacao`,
        event: 'PAYMENT_RECEIVED',
        payment: { id: `pay_ct_${sufixo}_webhook`, status: 'RECEIVED', value: 99.9, paymentDate: hojeIso() },
      }),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });

    expect((await prisma.cobranca.findUniqueOrThrow({ where: { id: cobranca.id } })).status).toBe('paga');
    const a = await prisma.assinatura.findUniqueOrThrow({ where: { id: assinatura.id } });
    expect(a).toMatchObject({
      plano_id: planoBasico,
      status: 'ativa',
      gateway: 'asaas',
      dia_vencimento: Math.min(28, Number(hojeIso().slice(8, 10))),
    });
    expect(a.expira_em!.toISOString().slice(0, 10) >= somarDias(somarMeses(hojeIso(), 1), 5)).toBe(true);

    // Agora a clínica está num plano pago: a página mostra o plano e não deixa contratar de novo.
    const g = (await como(token, 'GET', '/contratacao')).json();
    expect(g).toMatchObject({ pode_contratar: false, motivo: 'plano_pago', pendente: null });
    expect(g.plano_atual.id).toBe(planoBasico);
    // O /me já reflete o plano novo.
    expect((await como(token, 'GET', '/me')).json().plano.id).toBe(planoBasico);
  });

  it('contratação abandonada (em aberto além da tolerância) não deixa a assinatura vencida', async () => {
    await ativarAsaas();
    const { clinica, assinatura } = await criarClinica({ status: 'ativa' });
    await prisma.cobranca.create({
      data: {
        clinica_id: clinica.id,
        assinatura_id: assinatura.id,
        gateway: 'asaas',
        id_externo: `pay_ct_${sufixo}_abandonada`,
        valor: 99.9,
        vencimento: dataSemHora(somarDias(hojeIso(), -20)),
        status: 'pendente',
        ambiente: 'sandbox',
        plano_contratado_id: planoBasico,
      },
    });
    await executarJobCobrancas(hojeIso(), SILENCIO);
    expect((await prisma.assinatura.findUniqueOrThrow({ where: { id: assinatura.id } })).status).toBe('ativa');
  });
});
