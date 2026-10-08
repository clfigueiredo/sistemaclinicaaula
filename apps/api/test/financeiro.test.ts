/**
 * Módulo financeiro (fase 2): recurso do plano, isolamento, papéis, estorno, títulos (parcelas/baixa),
 * recorrências (worker idempotente), repasses e relatórios.
 * Cria os próprios dados (nomes/documentos únicos) e apaga no fim — não limpa o banco.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PapelUsuario, PeriodoLimite } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';
import { hojeNoFuso } from '../src/servicos/financeiroComum';
import { processarRecorrencias } from '../src/workers/recorrenciasFinanceiras';
import { somarMeses } from '../src/modulos/financeiro/comum';
import { dividirParcelas } from '../src/modulos/financeiro/rotasTitulos';

const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
const clinicas: string[] = [];
const planos: string[] = [];
const HOJE = hojeNoFuso('America/Sao_Paulo');
const INICIO_MES = `${HOJE.slice(0, 7)}-01`;
const FIM_MES = somarMeses(INICIO_MES, 0, 31);

type Cfg = { habilitado: boolean; limite: number | null; periodo: PeriodoLimite };

async function criarPlano(financeiro: boolean) {
  const recursos: Partial<Record<CodigoRecurso, Cfg>> = {
    financeiro: { habilitado: financeiro, limite: null, periodo: 'total' },
  };
  const plano = await prisma.plano.create({
    data: {
      nome: `Financeiro ${sufixo} ${++seq}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          ...(recursos[r.codigo] ?? { habilitado: r.tipo === 'limite', limite: null, periodo: 'total' as const }),
        })),
      },
    },
  });
  planos.push(plano.id);
  return plano;
}

async function criarClinica(planoId: string) {
  const clinica = await prisma.clinica.create({
    data: { nome: `Financeiro ${sufixo} ${++seq}`, documento: `7${Date.now()}${seq}`.slice(0, 14) },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  const prof1 = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: `Dra. Um ${sufixo}` } });
  const prof2 = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: `Dr. Dois ${sufixo}` } });
  const paciente = await prisma.paciente.create({ data: { clinica_id: clinica.id, nome: `Paciente ${sufixo} ${seq}` } });
  const convenio = await prisma.convenio.create({ data: { clinica_id: clinica.id, nome: `Plano ${sufixo} ${seq}` } });

  async function usuario(papel: PapelUsuario, profissionalId: string | null = null) {
    const u = await prisma.usuario.create({
      data: {
        clinica_id: clinica.id,
        nome: `${papel} ${seq}`,
        email: `${papel}.${++seq}.${sufixo}@financeiro.teste`,
        senha_hash: 'x',
        papel,
        profissional_id: profissionalId,
      },
    });
    return assinarTokenClinica(app, { usuarioId: u.id, clinicaId: clinica.id, papel, profissionalId });
  }

  const inicio = new Date(Date.now() - 2 * 3600_000);
  const agendamento = await prisma.agendamento.create({
    data: {
      clinica_id: clinica.id,
      paciente_id: paciente.id,
      profissional_id: prof1.id,
      inicio,
      fim: new Date(inicio.getTime() + 30 * 60_000),
      status: 'atendido',
    },
  });
  const agConvenio = await prisma.agendamento.create({
    data: {
      clinica_id: clinica.id,
      paciente_id: paciente.id,
      profissional_id: prof2.id,
      inicio: new Date(inicio.getTime() - 3600_000),
      fim: new Date(inicio.getTime() - 1800_000),
      tipo: 'convenio',
      convenio_id: convenio.id,
      status: 'atendido',
    },
  });
  const agCancelado = await prisma.agendamento.create({
    data: {
      clinica_id: clinica.id,
      paciente_id: paciente.id,
      profissional_id: prof1.id,
      inicio: new Date(inicio.getTime() + 86_400_000),
      fim: new Date(inicio.getTime() + 86_400_000 + 1800_000),
      status: 'cancelado',
    },
  });

  return {
    clinica,
    prof1,
    prof2,
    paciente,
    agendamento,
    agConvenio,
    agCancelado,
    admin: await usuario('admin'),
    recepcao: await usuario('recepcao'),
    profissional: await usuario('profissional', prof1.id),
  };
}

type Cenario = Awaited<ReturnType<typeof criarClinica>>;

function req(token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
}

let A: Cenario;
let B: Cenario;
let semRecurso: Cenario;
let contaA: string;

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  app = await buildApp({ logger: false });
  const comFinanceiro = await criarPlano(true);
  const semFinanceiro = await criarPlano(false);
  A = await criarClinica(comFinanceiro.id);
  B = await criarClinica(comFinanceiro.id);
  semRecurso = await criarClinica(semFinanceiro.id);
});

afterAll(async () => {
  if (clinicas.length) await prisma.clinica.deleteMany({ where: { id: { in: clinicas } } });
  if (planos.length) await prisma.plano.deleteMany({ where: { id: { in: planos } } });
  await app.close();
});

describe('financeiro — acesso', () => {
  it('recurso desligado ⇒ 403 recurso_indisponivel', async () => {
    const r = await req(semRecurso.admin, 'GET', '/financeiro/contas');
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('recurso_indisponivel');
  });

  it('cria conta Caixa e categorias padrão sob demanda', async () => {
    const contas = await req(A.admin, 'GET', '/financeiro/contas');
    expect(contas.statusCode).toBe(200);
    expect(contas.json()).toHaveLength(1);
    expect(contas.json()[0]).toMatchObject({ nome: 'Caixa', saldo_atual: '0.00' });
    contaA = contas.json()[0].id;

    const cats = await req(A.recepcao, 'GET', '/financeiro/categorias?tipo=despesa');
    expect(cats.statusCode).toBe(200);
    expect(cats.json().map((c: { nome: string }) => c.nome)).toContain('Repasses a profissionais');
    // Idempotente
    const todas = await req(A.admin, 'GET', '/financeiro/categorias');
    const de_novo = await req(A.admin, 'GET', '/financeiro/categorias');
    expect(de_novo.json()).toHaveLength(todas.json().length);
  });

  it('recepção: não vê relatórios, recorrências, repasses nem cria contas', async () => {
    for (const url of [
      '/financeiro/relatorios/resumo',
      '/financeiro/relatorios/fluxo-caixa',
      '/financeiro/recorrencias',
      '/financeiro/repasses',
      '/financeiro/profissionais',
    ]) {
      expect((await req(A.recepcao, 'GET', url)).statusCode, url).toBe(403);
    }
    expect((await req(A.recepcao, 'POST', '/financeiro/contas', { nome: 'Banco' })).statusCode).toBe(403);
  });

  it('profissional: sem caixa/títulos; só o próprio repasse', async () => {
    expect((await req(A.profissional, 'GET', '/financeiro/movimentacoes')).statusCode).toBe(403);
    expect((await req(A.profissional, 'GET', '/financeiro/titulos')).statusCode).toBe(403);
    const r = await req(A.profissional, 'GET', `/financeiro/repasses?profissional_id=${A.prof2.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0].profissional.id).toBe(A.prof1.id);
  });

  it('isolamento entre clínicas', async () => {
    const mov = await req(A.admin, 'POST', '/financeiro/movimentacoes', {
      tipo: 'entrada',
      data: HOJE,
      valor: 10,
      conta_financeira_id: contaA,
      forma_pagamento: 'pix',
      descricao: 'Isolamento',
    });
    expect(mov.statusCode).toBe(201);
    // B não usa a conta de A nem vê a movimentação / não estorna
    const usarConta = await req(B.admin, 'POST', '/financeiro/movimentacoes', {
      tipo: 'entrada',
      data: HOJE,
      valor: 10,
      conta_financeira_id: contaA,
      forma_pagamento: 'pix',
    });
    expect(usarConta.statusCode).toBe(404);
    const listaB = await req(B.admin, 'GET', '/financeiro/movimentacoes');
    expect(listaB.json().total).toBe(0);
    expect((await req(B.admin, 'POST', `/financeiro/movimentacoes/${mov.json().id}/estorno`, {})).statusCode).toBe(404);
    // Recebimento com agendamento de outra clínica
    const contaB = (await req(B.admin, 'GET', '/financeiro/contas')).json()[0].id;
    const rec = await req(B.admin, 'POST', '/financeiro/recebimentos', {
      agendamento_id: A.agendamento.id,
      valor: 10,
      forma_pagamento: 'pix',
      conta_financeira_id: contaB,
    });
    expect(rec.statusCode).toBe(404);
    // Percentual de profissional de outra clínica
    expect(
      (await req(B.admin, 'PUT', `/financeiro/profissionais/${A.prof1.id}/repasse`, { percentual_repasse: 10 })).statusCode,
    ).toBe(404);
    // limpa o efeito desta movimentação nos próximos testes
    expect((await req(A.admin, 'POST', `/financeiro/movimentacoes/${mov.json().id}/estorno`, {})).statusCode).toBe(201);
  });
});

describe('financeiro — caixa e estorno', () => {
  it('estorno não altera a original e zera o efeito nos totais', async () => {
    const antes = (await req(A.admin, 'GET', `/financeiro/movimentacoes?inicio=${INICIO_MES}&fim=${FIM_MES}`)).json();
    const mov = await req(A.recepcao, 'POST', '/financeiro/movimentacoes', {
      tipo: 'saida',
      data: HOJE,
      valor: 123.45,
      conta_financeira_id: contaA,
      forma_pagamento: 'dinheiro',
      descricao: 'Compra de material',
    });
    expect(mov.statusCode).toBe(201);
    expect(mov.json()).toMatchObject({ valor: '123.45', origem: 'manual', estornada: false });
    const id = mov.json().id;

    const meio = (await req(A.admin, 'GET', `/financeiro/movimentacoes?inicio=${INICIO_MES}&fim=${FIM_MES}`)).json();
    expect(Number(meio.totais.saidas)).toBeCloseTo(Number(antes.totais.saidas) + 123.45, 2);

    expect((await req(A.recepcao, 'POST', `/financeiro/movimentacoes/${id}/estorno`, {})).statusCode).toBe(403);
    const est = await req(A.admin, 'POST', `/financeiro/movimentacoes/${id}/estorno`, { motivo: 'Lançado errado' });
    expect(est.statusCode).toBe(201);
    expect(est.json()).toMatchObject({ tipo: 'entrada', origem: 'estorno', estorno_de_id: id, valor: '123.45' });

    const original = await prisma.movimentacaoFinanceira.findUniqueOrThrow({ where: { id } });
    expect(original.valor.toFixed(2)).toBe('123.45');
    expect(original.tipo).toBe('saida');

    const depois = (await req(A.admin, 'GET', `/financeiro/movimentacoes?inicio=${INICIO_MES}&fim=${FIM_MES}`)).json();
    expect(depois.totais).toEqual(antes.totais);
    const itemOriginal = depois.itens.find((m: { id: string }) => m.id === id);
    expect(itemOriginal.estornada).toBe(true);

    expect((await req(A.admin, 'POST', `/financeiro/movimentacoes/${id}/estorno`, {})).json().erro).toBe('ja_estornada');
    expect((await req(A.admin, 'POST', `/financeiro/movimentacoes/${est.json().id}/estorno`, {})).json().erro).toBe(
      'estorno_de_estorno',
    );
    // saldo da conta volta ao anterior (soma tudo, inclusive estornos)
    const conta = (await req(A.admin, 'GET', '/financeiro/contas')).json()[0];
    expect(conta.saldo_atual).toBe('0.00');
  });

  it('valida data futura e categoria incompatível', async () => {
    const receita = (await req(A.admin, 'GET', '/financeiro/categorias?tipo=receita')).json()[0];
    const r1 = await req(A.admin, 'POST', '/financeiro/movimentacoes', {
      tipo: 'saida',
      data: HOJE,
      valor: 5,
      conta_financeira_id: contaA,
      forma_pagamento: 'pix',
      categoria_id: receita.id,
    });
    expect(r1.json().erro).toBe('categoria_incompativel');
    const r2 = await req(A.admin, 'POST', '/financeiro/movimentacoes', {
      tipo: 'entrada',
      data: somarMeses(HOJE, 1),
      valor: 5,
      conta_financeira_id: contaA,
      forma_pagamento: 'pix',
    });
    expect(r2.json().erro).toBe('data_futura');
  });

  it('recebimento de consulta (parcial/complementar), cancelado ⇒ 409 e convênio ⇒ título', async () => {
    const url = `/financeiro/recebimentos/agendamento/${A.agendamento.id}`;
    const r1 = await req(A.recepcao, 'POST', '/financeiro/recebimentos', {
      agendamento_id: A.agendamento.id,
      valor: 150,
      forma_pagamento: 'pix',
      conta_financeira_id: contaA,
    });
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({
      origem: 'consulta',
      paciente_id: A.paciente.id,
      profissional_id: A.prof1.id,
      categoria: { nome: 'Consultas' },
    });
    await req(A.recepcao, 'POST', '/financeiro/recebimentos', {
      agendamento_id: A.agendamento.id,
      valor: 50.5,
      forma_pagamento: 'dinheiro',
      conta_financeira_id: contaA,
    });
    const g = await req(A.recepcao, 'GET', url);
    expect(g.json().total).toBe('200.50');
    expect(g.json().itens).toHaveLength(2);

    const canc = await req(A.recepcao, 'POST', '/financeiro/recebimentos', {
      agendamento_id: A.agCancelado.id,
      valor: 10,
      forma_pagamento: 'pix',
      conta_financeira_id: contaA,
    });
    expect(canc.statusCode).toBe(409);

    const particular = await req(A.recepcao, 'POST', '/financeiro/recebimentos/convenio', {
      agendamento_id: A.agendamento.id,
      valor: 80,
      vencimento: HOJE,
    });
    expect(particular.json().erro).toBe('agendamento_particular');
    const conv = await req(A.recepcao, 'POST', '/financeiro/recebimentos/convenio', {
      agendamento_id: A.agConvenio.id,
      valor: 80,
      vencimento: somarMeses(HOJE, 1),
      observacoes: 'Guia 123',
    });
    expect(conv.statusCode).toBe(201);
    expect(conv.json()).toMatchObject({
      tipo: 'receber',
      status: 'aberto',
      agendamento_id: A.agConvenio.id,
      observacoes: 'Guia 123',
      forma_pagamento: 'convenio',
    });
    // Vínculo na coluna titulos.agendamento_id (não mais marcador no texto das observações).
    const gravado = await prisma.titulo.findUniqueOrThrow({ where: { id: conv.json().id } });
    expect(gravado.agendamento_id).toBe(A.agConvenio.id);
    expect(gravado.observacoes).toBe('Guia 123');
    const gc = (await req(A.recepcao, 'GET', `/financeiro/recebimentos/agendamento/${A.agConvenio.id}`)).json();
    expect(gc.titulos).toHaveLength(1);
    expect(gc.total).toBe('0.00');
  });
});

describe('financeiro — títulos', () => {
  it('parcelamento divide o valor (centavos na última) com vencimentos mensais', async () => {
    expect(dividirParcelas(100, 3)).toEqual(['33.33', '33.33', '33.34']);
    const venc = '2027-01-31'; // dia 31 é mantido quando o mês permite (fev ⇒ 28)
    const r = await req(A.admin, 'POST', '/financeiro/titulos', {
      tipo: 'pagar',
      descricao: 'Equipamento',
      valor: 100,
      vencimento: venc,
      fornecedor: 'Loja X',
      parcelas: 3,
    });
    expect(r.statusCode).toBe(201);
    const lista = r.json() as { valor: string; vencimento: string; parcela_numero: number; parcela_total: number; grupo_parcelas_id: string }[];
    expect(lista.map((t) => t.valor)).toEqual(['33.33', '33.33', '33.34']);
    expect(lista.map((t) => t.vencimento)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(lista.map((t) => t.parcela_numero)).toEqual([1, 2, 3]);
    expect(new Set(lista.map((t) => t.grupo_parcelas_id)).size).toBe(1);
    expect((await req(A.recepcao, 'POST', '/financeiro/titulos', { tipo: 'pagar', descricao: 'Proibido', valor: 1, vencimento: HOJE })).statusCode).toBe(403);
  });

  it('baixa gera movimentação e muda status; estorno reabre o título; vencido é derivado', async () => {
    const ontem = new Date(Date.parse(`${HOJE}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const criado = await req(A.admin, 'POST', '/financeiro/titulos', {
      tipo: 'receber',
      descricao: 'Pacote de sessões',
      valor: 300,
      vencimento: ontem,
      paciente_id: A.paciente.id,
    });
    const t = criado.json()[0];
    expect(t.status_exibicao).toBe('vencido');
    const vencidos = (await req(A.recepcao, 'GET', '/financeiro/titulos?tipo=receber&status=vencido')).json();
    expect(vencidos.itens.map((x: { id: string }) => x.id)).toContain(t.id);
    expect(vencidos.totais.vencidos.quantidade).toBeGreaterThanOrEqual(1);

    const baixa = await req(A.recepcao, 'POST', `/financeiro/titulos/${t.id}/baixa`, {
      data: HOJE,
      conta_financeira_id: contaA,
      forma_pagamento: 'cartao_credito',
      juros: 10.5,
      desconto: 0.5,
    });
    expect(baixa.statusCode).toBe(200);
    expect(baixa.json().titulo).toMatchObject({ status: 'pago', valor_pago: '310.00' });
    expect(baixa.json().movimentacao).toMatchObject({ tipo: 'entrada', origem: 'titulo', titulo_id: t.id, valor: '310.00' });

    const de_novo = await req(A.recepcao, 'POST', `/financeiro/titulos/${t.id}/baixa`, {
      data: HOJE,
      conta_financeira_id: contaA,
      forma_pagamento: 'pix',
    });
    expect(de_novo.statusCode).toBe(409);
    expect((await req(A.admin, 'POST', `/financeiro/titulos/${t.id}/cancelar`)).statusCode).toBe(409);

    const est = await req(A.admin, 'POST', `/financeiro/movimentacoes/${baixa.json().movimentacao.id}/estorno`, {});
    expect(est.statusCode).toBe(201);
    const reaberto = await prisma.titulo.findUniqueOrThrow({ where: { id: t.id } });
    expect(reaberto.status).toBe('aberto');
    expect(reaberto.valor_pago).toBeNull();

    const canc = await req(A.admin, 'POST', `/financeiro/titulos/${t.id}/cancelar`);
    expect(canc.json().status).toBe('cancelado');
  });

  it('baixa do título do convênio entra no recebimento da consulta', async () => {
    const gc = (await req(A.recepcao, 'GET', `/financeiro/recebimentos/agendamento/${A.agConvenio.id}`)).json();
    const titulo = gc.titulos[0];
    const b = await req(A.recepcao, 'POST', `/financeiro/titulos/${titulo.id}/baixa`, {
      data: HOJE,
      conta_financeira_id: contaA,
      forma_pagamento: 'transferencia',
    });
    expect(b.json().movimentacao).toMatchObject({ agendamento_id: A.agConvenio.id, profissional_id: A.prof2.id });
    const depois = (await req(A.recepcao, 'GET', `/financeiro/recebimentos/agendamento/${A.agConvenio.id}`)).json();
    expect(depois.total).toBe('80.00');
  });
});

describe('financeiro — recorrências', () => {
  it('gera títulos na criação e o worker não duplica', async () => {
    const r = await req(A.admin, 'POST', '/financeiro/recorrencias', {
      tipo: 'pagar',
      descricao: `Aluguel ${sufixo}`,
      valor: 2500,
      dia_vencimento: 31,
      inicio: INICIO_MES,
    });
    expect(r.statusCode).toBe(201);
    const rec = r.json();
    // dia 31 nunca passou no mês corrente ⇒ mês corrente + próximo
    expect(rec.titulos).toHaveLength(2);
    expect(rec.titulos[0].vencimento).toBe(somarMeses(INICIO_MES, 0, 31));
    expect(rec.titulos[1].vencimento).toBe(somarMeses(INICIO_MES, 1, 31));

    const p1 = await processarRecorrencias({ clinicaId: A.clinica.id });
    const p2 = await processarRecorrencias({ clinicaId: A.clinica.id });
    expect(p1.titulosGerados).toBe(0);
    expect(p2.titulosGerados).toBe(0);
    expect(await prisma.titulo.count({ where: { recorrencia_id: rec.id } })).toBe(2);

    // Um mês depois: gera só o mês seguinte, uma única vez
    const mesQueVem = somarMeses(INICIO_MES, 1);
    const p3 = await processarRecorrencias({ clinicaId: A.clinica.id, data: mesQueVem });
    const p4 = await processarRecorrencias({ clinicaId: A.clinica.id, data: mesQueVem });
    expect(p3.titulosGerados).toBe(1);
    expect(p4.titulosGerados).toBe(0);
    expect(await prisma.titulo.count({ where: { recorrencia_id: rec.id } })).toBe(3);

    // Encerrar não apaga títulos e para a geração
    const enc = await req(A.admin, 'PUT', `/financeiro/recorrencias/${rec.id}`, { ativo: false });
    expect(enc.json().ativo).toBe(false);
    await processarRecorrencias({ clinicaId: A.clinica.id, data: somarMeses(INICIO_MES, 2) });
    expect(await prisma.titulo.count({ where: { recorrencia_id: rec.id } })).toBe(3);
  });

  it('worker ignora clínica sem o recurso', async () => {
    await prisma.recorrencia.create({
      data: {
        clinica_id: semRecurso.clinica.id,
        tipo: 'receber',
        descricao: 'Mensalidade',
        valor: 100,
        dia_vencimento: 31,
        inicio: new Date(`${INICIO_MES}T00:00:00Z`),
      },
    });
    const r = await processarRecorrencias({ clinicaId: semRecurso.clinica.id });
    expect(r.titulosGerados).toBe(0);
    expect(r.ignoradas).toBe(1);
  });
});

describe('financeiro — repasses e relatórios', () => {
  it('repasse calculado sobre as entradas efetivas do profissional', async () => {
    // Percentual (admin) — valida profissional do tenant
    const pct = await req(A.admin, 'PUT', `/financeiro/profissionais/${A.prof1.id}/repasse`, { percentual_repasse: 40 });
    expect(pct.json().percentual_repasse).toBe('40.00');
    expect((await req(A.recepcao, 'PUT', `/financeiro/profissionais/${A.prof1.id}/repasse`, { percentual_repasse: 50 })).statusCode).toBe(403);

    // prof1 tem 200.50 de consulta neste mês (teste anterior)
    const r = (await req(A.admin, 'GET', `/financeiro/repasses?inicio=${INICIO_MES}&fim=${FIM_MES}`)).json();
    const l1 = r.find((l: { profissional: { id: string } }) => l.profissional.id === A.prof1.id);
    expect(l1).toMatchObject({ total_entradas: '200.50', percentual: '40.00', valor_repasse: '80.20', pago: '0.00', saldo: '80.20' });

    const pag = await req(A.admin, 'POST', '/financeiro/repasses/pagamentos', {
      profissional_id: A.prof1.id,
      inicio: INICIO_MES,
      fim: FIM_MES,
      valor: 30,
      data: HOJE,
      conta_financeira_id: contaA,
      forma_pagamento: 'pix',
    });
    expect(pag.statusCode).toBe(201);
    expect(pag.json()).toMatchObject({ tipo: 'saida', origem: 'repasse', categoria: { nome: 'Repasses a profissionais' } });

    const meu = await req(A.profissional, 'GET', `/financeiro/meus-recebimentos?inicio=${INICIO_MES}&fim=${FIM_MES}`);
    expect(meu.statusCode).toBe(200);
    expect(meu.json()).toMatchObject({ total_entradas: '200.50', valor_repasse: '80.20', pago: '30.00', saldo: '50.20' });
    expect(meu.json().itens).toHaveLength(2);
    expect((await req(A.admin, 'GET', '/financeiro/meus-recebimentos')).statusCode).toBe(403);
    expect((await req(A.recepcao, 'GET', '/financeiro/repasses/entradas')).statusCode).toBe(403);
  });

  it('relatórios: resumo, fluxo de caixa e CSV (admin)', async () => {
    const resumo = await req(A.admin, 'GET', `/financeiro/relatorios/resumo?inicio=${INICIO_MES}&fim=${FIM_MES}`);
    expect(resumo.statusCode).toBe(200);
    const s = resumo.json();
    // entradas efetivas: 150 + 50.50 (consulta) + 80 (convênio) ; saídas: 30 (repasse)
    expect(s.receitas).toBe('280.50');
    expect(s.despesas).toBe('30.00');
    expect(s.saldo).toBe('250.50');
    expect(s.por_categoria.find((c: { categoria: string }) => c.categoria === 'Consultas').total).toBe('200.50');

    const fluxo = (await req(A.admin, 'GET', `/financeiro/relatorios/fluxo-caixa?inicio=${INICIO_MES}&fim=${FIM_MES}`)).json();
    expect(fluxo.saldo_inicial).toBe('0.00');
    expect(fluxo.saldo_final).toBe('250.50');
    const conta = (await req(A.admin, 'GET', '/financeiro/contas')).json()[0];
    expect(conta.saldo_atual).toBe('250.50');

    const csv = await req(A.admin, 'GET', `/financeiro/relatorios/exportar?tipo=movimentacoes&inicio=${INICIO_MES}&fim=${FIM_MES}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Data;Tipo;Origem;Valor');
    expect((await req(A.recepcao, 'GET', `/financeiro/relatorios/exportar?tipo=fluxo`)).statusCode).toBe(403);
  });
});

// ----------------------------------------------------------------------------- segurança (auditoria fase 2)

describe('financeiro — segurança (auditoria)', () => {
  let C: Cenario;
  let contaC: string;

  beforeAll(async () => {
    C = await criarClinica((await criarPlano(true)).id);
    contaC = (await req(C.admin, 'GET', '/financeiro/contas')).json()[0].id;
  });

  it('M3: CSV escapa fórmulas em texto (= + - @ TAB CR) e mantém valores numéricos', async () => {
    await prisma.paciente.update({ where: { id: C.paciente.id }, data: { nome: '+SOMA(1;2)' } });
    for (const [tipo, descricao] of [
      ['entrada', '=HYPERLINK("http://mal.teste","clique")'],
      ['saida', '@SUM(1+1)'],
      ['entrada', 'TAB_AQUI'],
      ['entrada', '-2+3'],
    ] as const) {
      const r = await req(C.admin, 'POST', '/financeiro/movimentacoes', {
        tipo,
        data: HOJE,
        valor: 30,
        conta_financeira_id: contaC,
        forma_pagamento: 'pix',
        descricao,
        paciente_id: C.paciente.id,
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    // A API apara espaços/TAB do corpo; TAB inicial só chega por outro caminho (ex.: dado antigo).
    await prisma.movimentacaoFinanceira.updateMany({
      where: { clinica_id: C.clinica.id, descricao: 'TAB_AQUI' },
      data: { descricao: '\tcmd' },
    });
    const csv = await req(C.admin, 'GET', `/financeiro/relatorios/exportar?tipo=movimentacoes&inicio=${INICIO_MES}&fim=${FIM_MES}`);
    expect(csv.statusCode).toBe(200);
    const corpo = csv.body;
    expect(corpo).toContain(`"'=HYPERLINK(""http://mal.teste"",""clique"")"`);
    expect(corpo).toContain(";'@SUM(1+1);");
    expect(corpo).toContain(";'\tcmd;");
    expect(corpo).toContain(";'-2+3;");
    expect(corpo).toContain(`"'+SOMA(1;2)"`);
    expect(corpo).toContain(';-30,00;'); // saída continua número
    expect(corpo).not.toMatch(/;=HYPERLINK|;@SUM|;\+SOMA/);
  });

  it('M4: recepção não vê repasses (nem estorno de repasse) e não usa profissional_id', async () => {
    const pag = await req(C.admin, 'POST', '/financeiro/repasses/pagamentos', {
      profissional_id: C.prof1.id,
      inicio: INICIO_MES,
      fim: FIM_MES,
      valor: 12.34,
      data: HOJE,
      conta_financeira_id: contaC,
      forma_pagamento: 'pix',
      descricao: 'Repasse sigiloso',
    });
    expect(pag.statusCode, pag.body).toBe(201);
    const est = await req(C.admin, 'POST', `/financeiro/movimentacoes/${pag.json().id}/estorno`, { motivo: 'teste' });
    expect(est.statusCode).toBe(201);

    const url = `/financeiro/movimentacoes?inicio=${INICIO_MES}&fim=${FIM_MES}&por_pagina=100`;
    const admin = (await req(C.admin, 'GET', url)).json();
    expect(admin.itens.some((m: { origem: string }) => m.origem === 'repasse')).toBe(true);
    const recep = await req(C.recepcao, 'GET', url);
    expect(recep.statusCode).toBe(200);
    const ids = recep.json().itens.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(pag.json().id);
    expect(ids).not.toContain(est.json().id);
    expect(recep.body).not.toContain('Repasse sigiloso');
    expect(recep.json().total).toBe(admin.total - 2);

    const filtroRepasse = await req(C.recepcao, 'GET', `${url}&origem=repasse`);
    expect(filtroRepasse.statusCode).toBe(403);
    const filtroProf = await req(C.recepcao, 'GET', `${url}&profissional_id=${C.prof1.id}`);
    expect(filtroProf.statusCode).toBe(403);
    expect((await req(C.admin, 'GET', `${url}&origem=repasse`)).statusCode).toBe(200);

    const base = { tipo: 'entrada', data: HOJE, valor: 10, conta_financeira_id: contaC, forma_pagamento: 'dinheiro' };
    const comProf = await req(C.recepcao, 'POST', '/financeiro/movimentacoes', { ...base, profissional_id: C.prof2.id });
    expect(comProf.statusCode).toBe(403);
    const pelaConsulta = await req(C.recepcao, 'POST', '/financeiro/movimentacoes', { ...base, agendamento_id: C.agendamento.id });
    expect(pelaConsulta.statusCode, pelaConsulta.body).toBe(201);
    expect(pelaConsulta.json().profissional?.id ?? pelaConsulta.json().profissional_id).toBe(C.prof1.id);
  });

  it('B8: GET de contas/categorias com assinatura inativa (acesso suspenso) não cria nada', async () => {
    const D = await criarClinica((await criarPlano(true)).id);
    await prisma.assinatura.update({ where: { clinica_id: D.clinica.id }, data: { status: 'vencida' } });
    const contas = await req(D.admin, 'GET', '/financeiro/contas');
    expect(contas.statusCode).toBe(403);
    expect(contas.json().erro).toBe('assinatura_inativa');
    const cats = await req(D.recepcao, 'GET', '/financeiro/categorias');
    expect(cats.statusCode).toBe(403);
    expect(await prisma.contaFinanceira.count({ where: { clinica_id: D.clinica.id } })).toBe(0);
    expect(await prisma.categoriaFinanceira.count({ where: { clinica_id: D.clinica.id } })).toBe(0);
  });
});
