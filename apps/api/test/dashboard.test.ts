/**
 * Dashboard da clínica (GET /dashboard): recurso, isolamento, escopo por papel, taxas e financeiro efetivo.
 * Cria os próprios dados (nomes/documentos únicos) e apaga no fim — não usa criarCenario().
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PapelUsuario, StatusAgendamento } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';
import { dataSemHora, hojeNoFuso } from '../src/servicos/financeiroComum';
import { somarDias } from '../src/modulos/dashboard/servico';

const FUSO = 'America/Sao_Paulo';
const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
const clinicas: string[] = [];
const planos: string[] = [];

async function criarPlano(habilitados: CodigoRecurso[]) {
  const plano = await prisma.plano.create({
    data: {
      nome: `Dash ${sufixo} ${++seq}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          habilitado: habilitados.includes(r.codigo),
          limite: null,
          periodo: 'total' as const,
        })),
      },
    },
  });
  planos.push(plano.id);
  return plano;
}

async function criarClinica(planoId: string) {
  const clinica = await prisma.clinica.create({
    data: { nome: `Dash ${sufixo} ${++seq}`, documento: `7${String(Date.now()).slice(-9)}${String(seq).padStart(4, '0')}`, fuso_horario: FUSO },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  return clinica;
}

async function criarUsuario(clinicaId: string, papel: PapelUsuario, profissionalId: string | null = null) {
  const u = await prisma.usuario.create({
    data: {
      clinica_id: clinicaId,
      nome: `${papel} ${seq}`,
      email: `${papel}.${++seq}.${sufixo}@dash.teste`,
      senha_hash: 'x',
      papel,
      profissional_id: profissionalId,
    },
  });
  return assinarTokenClinica(app, { usuarioId: u.id, clinicaId, papel, profissionalId });
}

/** 'YYYY-MM-DD' + 'HH:mm' no fuso da clínica → Date UTC. */
const local = (dia: string, hora: string) => fromZonedTime(`${dia}T${hora}:00`, FUSO);

async function agendar(
  clinicaId: string,
  profissionalId: string,
  pacienteId: string,
  dia: string,
  hora: string,
  status: StatusAgendamento,
) {
  const inicio = local(dia, hora);
  return prisma.agendamento.create({
    data: {
      clinica_id: clinicaId,
      profissional_id: profissionalId,
      paciente_id: pacienteId,
      inicio,
      fim: new Date(inicio.getTime() + 30 * 60_000),
      status,
    },
  });
}

const get = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

const MARCO = '/dashboard?inicio=2026-03-01&fim=2026-03-31';

let c1: { id: string };
let tokAdmin: string;
let tokRecepcao: string;
let tokProfA: string;
let tokAdmin2: string;
let tokAdmin3: string;
let profA: { id: string };
let profB: { id: string };
let profOutra: { id: string };
const hoje = hojeNoFuso(FUSO);

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  app = await buildApp({ logger: false });

  const planoCompleto = await criarPlano(CATALOGO_RECURSOS.map((r) => r.codigo));
  const planoSoDashboard = await criarPlano(['dashboard']);
  const planoSemDashboard = await criarPlano(['financeiro']);

  // ---- clínica 1 (tudo habilitado)
  c1 = await criarClinica(planoCompleto.id);
  profA = await prisma.profissional.create({ data: { clinica_id: c1.id, nome: 'Dra. A' } });
  profB = await prisma.profissional.create({ data: { clinica_id: c1.id, nome: 'Dr. B' } });
  const p1 = await prisma.paciente.create({ data: { clinica_id: c1.id, nome: 'Paciente 1' } });
  const p2 = await prisma.paciente.create({ data: { clinica_id: c1.id, nome: 'Paciente 2' } });
  tokAdmin = await criarUsuario(c1.id, 'admin');
  tokRecepcao = await criarUsuario(c1.id, 'recepcao');
  tokProfA = await criarUsuario(c1.id, 'profissional', profA.id);

  // Período anterior (29/01–28/02): 1 agendamento do A com P1 (P1 deixa de ser "novo" para A em março).
  await agendar(c1.id, profA.id, p1.id, '2026-02-15', '10:00', 'atendido');
  // Março — profissional A: 8 agendamentos.
  const a1 = await agendar(c1.id, profA.id, p1.id, '2026-03-02', '09:00', 'atendido');
  const a2 = await agendar(c1.id, profA.id, p2.id, '2026-03-03', '09:00', 'atendido');
  await agendar(c1.id, profA.id, p1.id, '2026-03-04', '10:00', 'atendido');
  await agendar(c1.id, profA.id, p2.id, '2026-03-05', '10:00', 'compareceu');
  await agendar(c1.id, profA.id, p1.id, '2026-03-06', '14:00', 'faltou');
  await agendar(c1.id, profA.id, p2.id, '2026-03-09', '14:00', 'faltou');
  await agendar(c1.id, profA.id, p1.id, '2026-03-10', '15:00', 'cancelado');
  await agendar(c1.id, profA.id, p2.id, '2026-03-11', '15:00', 'confirmado'); // passado, não atualizado
  // Março — profissional B: 3 (um às 23:30 do dia 31 local = 02:30 UTC de 01/04, deve contar em março).
  const b1 = await agendar(c1.id, profB.id, p1.id, '2026-03-12', '08:00', 'atendido');
  await agendar(c1.id, profB.id, p2.id, '2026-03-31', '23:30', 'atendido');
  await agendar(c1.id, profB.id, p1.id, '2026-03-13', '08:00', 'cancelado');
  // Fora do período (00:30 local de 01/04 = 03:30 UTC).
  await agendar(c1.id, profB.id, p2.id, '2026-04-01', '00:30', 'atendido');

  // Financeiro de março.
  const conta = await prisma.contaFinanceira.create({ data: { clinica_id: c1.id, nome: 'Caixa' } });
  const mov = (dados: {
    tipo: 'entrada' | 'saida';
    valor: number;
    data?: string;
    origem?: 'manual' | 'consulta' | 'estorno';
    agendamento_id?: string;
    profissional_id?: string;
    estorno_de_id?: string;
  }) =>
    prisma.movimentacaoFinanceira.create({
      data: {
        clinica_id: c1.id,
        conta_financeira_id: conta.id,
        forma_pagamento: 'pix',
        tipo: dados.tipo,
        valor: dados.valor,
        data: dataSemHora(dados.data ?? '2026-03-15'),
        origem: dados.origem ?? 'manual',
        agendamento_id: dados.agendamento_id,
        profissional_id: dados.profissional_id,
        estorno_de_id: dados.estorno_de_id,
      },
    });
  await mov({ tipo: 'entrada', valor: 100, origem: 'consulta', agendamento_id: a1.id, profissional_id: profA.id });
  await mov({ tipo: 'entrada', valor: 200, origem: 'consulta', agendamento_id: b1.id, profissional_id: profB.id });
  const estornada = await mov({
    tipo: 'entrada',
    valor: 50,
    origem: 'consulta',
    agendamento_id: a2.id,
    profissional_id: profA.id,
  });
  await mov({ tipo: 'saida', valor: 50, origem: 'estorno', estorno_de_id: estornada.id });
  await mov({ tipo: 'saida', valor: 30 });
  await mov({ tipo: 'entrada', valor: 999, data: '2026-04-01' }); // fora do período
  await mov({ tipo: 'entrada', valor: 70, data: '2026-02-10' }); // período anterior

  const titulo = (tipo: 'pagar' | 'receber', valor: number, vencimento: string, status: 'aberto' | 'pago' = 'aberto') =>
    prisma.titulo.create({
      data: { clinica_id: c1.id, tipo, descricao: `T ${valor}`, valor, vencimento: dataSemHora(vencimento), status },
    });
  await titulo('receber', 80, somarDias(hoje, -5));
  await titulo('receber', 120, somarDias(hoje, 3));
  await titulo('receber', 500, somarDias(hoje, 30));
  await titulo('receber', 60, somarDias(hoje, -2), 'pago');
  await titulo('pagar', 40, somarDias(hoje, 2));

  // Pendências.
  await prisma.solicitacaoAgendamento.create({
    data: {
      clinica_id: c1.id,
      profissional_id: profB.id,
      inicio: local(somarDias(hoje, 5), '10:00'),
      fim: local(somarDias(hoje, 5), '10:30'),
      nome: 'Solicitante',
      telefone: '5511999990000',
    },
  });
  await prisma.listaEspera.create({ data: { clinica_id: c1.id, paciente_id: p1.id } });
  await prisma.retorno.create({
    data: {
      clinica_id: c1.id,
      paciente_id: p1.id,
      profissional_id: profA.id,
      agendamento_origem_id: a1.id,
      data_prevista: dataSemHora(somarDias(hoje, -1)),
    },
  });
  await prisma.retorno.create({
    data: {
      clinica_id: c1.id,
      paciente_id: p1.id,
      profissional_id: profB.id,
      agendamento_origem_id: b1.id,
      data_prevista: dataSemHora(somarDias(hoje, 10)),
    },
  });

  // ---- clínica 2 (só dashboard): dados próprios em março que NÃO podem vazar para a clínica 1.
  const c2 = await criarClinica(planoSoDashboard.id);
  profOutra = await prisma.profissional.create({ data: { clinica_id: c2.id, nome: 'Outra' } });
  const pOutra = await prisma.paciente.create({ data: { clinica_id: c2.id, nome: 'Paciente outra' } });
  for (let i = 0; i < 4; i++) await agendar(c2.id, profOutra.id, pOutra.id, '2026-03-02', `1${i}:00`, 'faltou');
  const contaOutra = await prisma.contaFinanceira.create({ data: { clinica_id: c2.id, nome: 'Caixa' } });
  await prisma.movimentacaoFinanceira.create({
    data: {
      clinica_id: c2.id,
      conta_financeira_id: contaOutra.id,
      forma_pagamento: 'pix',
      tipo: 'entrada',
      valor: 5000,
      data: dataSemHora('2026-03-15'),
    },
  });
  tokAdmin2 = await criarUsuario(c2.id, 'admin');

  // ---- clínica 3 (sem dashboard)
  const c3 = await criarClinica(planoSemDashboard.id);
  tokAdmin3 = await criarUsuario(c3.id, 'admin');
}, 180_000);

afterAll(async () => {
  if (clinicas.length) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.permitir_exclusao_prontuario = 'on'`);
      const ondeClinica = { clinica_id: { in: clinicas } };
      await tx.retorno.deleteMany({ where: ondeClinica });
      await tx.listaEspera.deleteMany({ where: ondeClinica });
      await tx.solicitacaoAgendamento.deleteMany({ where: ondeClinica });
      await tx.movimentacaoFinanceira.deleteMany({ where: { ...ondeClinica, estorno_de_id: { not: null } } });
      await tx.movimentacaoFinanceira.deleteMany({ where: ondeClinica });
      await tx.titulo.deleteMany({ where: ondeClinica });
      await tx.agendamento.deleteMany({ where: ondeClinica });
      await tx.clinica.deleteMany({ where: { id: { in: clinicas } } });
    });
  }
  if (planos.length) await prisma.plano.deleteMany({ where: { id: { in: planos } } });
  await app?.close();
});

describe('GET /dashboard', () => {
  it('403 quando o recurso dashboard está desligado', async () => {
    const r = await get(tokAdmin3, MARCO);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ erro: 'recurso_indisponivel', recurso: 'dashboard' });
  });

  it('valida o período (máx. 366 dias, fim ≥ início, ambas as datas)', async () => {
    expect((await get(tokAdmin, '/dashboard?inicio=2025-01-01&fim=2026-03-01')).statusCode).toBe(400);
    expect((await get(tokAdmin, '/dashboard?inicio=2026-03-10&fim=2026-03-01')).statusCode).toBe(400);
    expect((await get(tokAdmin, '/dashboard?inicio=2026-03-10')).statusCode).toBe(400);
    expect((await get(tokAdmin, '/dashboard?inicio=2026-02-30&fim=2026-03-01')).statusCode).toBe(400);
    expect((await get(tokAdmin, `/dashboard?profissional_id=${profOutra.id}`)).statusCode).toBe(404);
  });

  it('padrão: mês corrente no fuso da clínica', async () => {
    const r = await get(tokAdmin, '/dashboard');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.periodo.inicio).toBe(`${hoje.slice(0, 7)}-01`);
    expect(b.periodo.fim.slice(0, 7)).toBe(hoje.slice(0, 7));
    expect(b.periodo.fuso).toBe(FUSO);
  });

  it('admin: taxas, séries e ocupação num cenário controlado (sem dados de outra clínica)', async () => {
    const r = await get(tokAdmin, MARCO);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.periodo).toMatchObject({ inicio: '2026-03-01', fim: '2026-03-31', dias: 31 });
    expect(b.periodo_anterior).toEqual({ inicio: '2026-01-29', fim: '2026-02-28' });
    expect(b.agenda).toMatchObject({
      total: 11,
      agendados: 0,
      confirmados: 1,
      compareceram: 1,
      atendidos: 5,
      faltas: 2,
      cancelados: 2,
      realizados_base: 9,
    });
    // comparecimento (1+5)/9, faltas 2/9, confirmação (1+1+5)/9, cancelamento 2/11
    expect(b.agenda.taxa_comparecimento).toBeCloseTo(6 / 9, 3);
    expect(b.agenda.taxa_faltas).toBeCloseTo(2 / 9, 3);
    expect(b.agenda.taxa_confirmacao).toBeCloseTo(7 / 9, 3);
    expect(b.agenda.taxa_cancelamento).toBeCloseTo(2 / 11, 3);
    expect(b.agenda_anterior.total).toBe(1);

    expect(b.por_dia).toHaveLength(31);
    expect(b.por_dia.at(-1)).toMatchObject({ data: '2026-03-31', total: 1, atendidos: 1 });
    expect(b.por_dia.reduce((s: number, d: { total: number }) => s + d.total, 0)).toBe(11);

    const ids = b.por_profissional.map((p: { profissional: { id: string } }) => p.profissional.id);
    expect(ids).toEqual([profA.id, profB.id]);
    expect(b.por_profissional[0]).toMatchObject({ total: 8, atendidos: 4, faltas: 2, cancelados: 1 });

    expect(b.por_dia_semana).toHaveLength(7);
    expect(b.por_dia_semana.reduce((s: number, d: { total: number }) => s + d.total, 0)).toBe(9);
    expect(b.por_hora.find((h: { hora: number }) => h.hora === 23)?.total).toBe(1);

    expect(b.pendencias).toEqual({ solicitacoes_pendentes: 1, lista_espera: 1, retornos_pendentes: 2, retornos_vencidos: 1 });
  });

  it('admin: financeiro efetivo (estornos ignorados), títulos e ticket médio', async () => {
    const f = (await get(tokAdmin, MARCO)).json().financeiro;
    expect(f).toMatchObject({
      receitas: '300.00',
      despesas: '30.00',
      saldo: '270.00',
      anterior: { receitas: '70.00', despesas: '0.00', saldo: '70.00' },
      a_receber: '700.00',
      a_pagar: '40.00',
      vencidos: 1,
      receber_vencido: { valor: '80.00', quantidade: 1 },
      receber_proximos_7_dias: { valor: '120.00', quantidade: 1 },
      pagar_proximos_7_dias: { valor: '40.00', quantidade: 1 },
      ticket_medio: '150.00',
      atendimentos_recebidos: 2,
    });
    const porProf = Object.fromEntries(
      f.receita_por_profissional.map((p: { profissional: { id: string }; total: string }) => [p.profissional.id, p.total]),
    );
    expect(porProf).toEqual({ [profA.id]: '100.00', [profB.id]: '200.00' });
  });

  it('recepção: agenda completa, sem bloco financeiro', async () => {
    const b = (await get(tokRecepcao, MARCO)).json();
    expect(b.agenda.total).toBe(11);
    expect(b.financeiro).toBeNull();
    expect(b.pendencias.solicitacoes_pendentes).toBe(1);
  });

  it('admin pode filtrar por profissional', async () => {
    const b = (await get(tokAdmin, `${MARCO}&profissional_id=${profB.id}`)).json();
    expect(b.agenda.total).toBe(3);
    expect(b.escopo).toMatchObject({ profissional_id: profB.id, profissional_forcado: false });
    expect(b.pendencias.retornos_pendentes).toBe(1);
  });

  it('profissional vê só os próprios números, mesmo pedindo outro profissional', async () => {
    const r = await get(tokProfA, `${MARCO}&profissional_id=${profB.id}&profissionalId=${profB.id}`);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.escopo).toMatchObject({ profissional_id: profA.id, profissional_forcado: true });
    expect(b.agenda).toMatchObject({ total: 8, atendidos: 3, compareceram: 1, faltas: 2, cancelados: 1 });
    expect(b.agenda.taxa_comparecimento).toBeCloseTo(4 / 7, 3);
    expect(b.agenda.novos_pacientes).toBe(1); // P2: primeiro agendamento com A em março
    expect(b.por_profissional).toHaveLength(1);
    expect(b.por_profissional[0].profissional.id).toBe(profA.id);
    expect(b.financeiro).toBeNull();
    expect(b.pendencias).toEqual({
      solicitacoes_pendentes: null,
      lista_espera: null,
      retornos_pendentes: 1,
      retornos_vencidos: 1,
    });
  });

  it('isolamento: a outra clínica só vê os próprios números; recursos desligados ⇒ null', async () => {
    const b = (await get(tokAdmin2, MARCO)).json();
    expect(b.agenda).toMatchObject({ total: 4, faltas: 4 });
    expect(b.agenda.taxa_faltas).toBe(1);
    expect(b.financeiro).toBeNull(); // plano sem `financeiro`
    expect(b.pendencias).toEqual({
      solicitacoes_pendentes: null,
      lista_espera: null,
      retornos_pendentes: null,
      retornos_vencidos: null,
    });
    expect(b.por_profissional.map((p: { profissional: { id: string } }) => p.profissional.id)).toEqual([profOutra.id]);
  });

  it('agenda de hoje', async () => {
    const b = (await get(tokAdmin, '/dashboard')).json();
    expect(Array.isArray(b.hoje)).toBe(true);
  });
});
