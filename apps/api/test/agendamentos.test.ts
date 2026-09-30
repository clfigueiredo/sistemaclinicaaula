/**
 * Testes do módulo de agenda. Cria os próprios dados (nomes/documentos únicos) — não faz truncate,
 * pois outros testes podem rodar no mesmo banco.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';
import { instanteLocal, partesLocais } from '../src/modulos/agendamentos/servico';

const FUSO = 'America/Sao_Paulo';
const sufixo = randomUUID().slice(0, 8);
const documento = () => String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

let app: FastifyInstance;
const ids = { clinicas: [] as string[], planos: [] as string[] };

async function criarPlano(limiteAgendamentos: number | null) {
  const plano = await prisma.plano.create({
    data: {
      nome: `Plano agenda ${limiteAgendamentos ?? 'ilimitado'} ${sufixo}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          habilitado: true,
          limite: r.codigo === 'max_agendamentos' ? limiteAgendamentos : null,
          periodo: 'total' as const,
        })),
      },
    },
  });
  ids.planos.push(plano.id);
  return plano;
}

async function criarClinica(nome: string, planoId: string) {
  const clinica = await prisma.clinica.create({ data: { nome: `${nome} ${sufixo}`, documento: documento() } });
  ids.clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  const usuario = (papel: 'admin' | 'recepcao' | 'profissional', profissional_id?: string) =>
    prisma.usuario.create({
      data: {
        clinica_id: clinica.id,
        nome: `${papel} ${nome}`,
        email: `${papel}-${randomUUID().slice(0, 8)}@agenda.teste`,
        senha_hash: 'x',
        papel,
        profissional_id,
      },
    });
  const token = (u: { id: string; papel: 'admin' | 'recepcao' | 'profissional'; profissional_id: string | null }) =>
    `Bearer ${assinarTokenClinica(app, { usuarioId: u.id, clinicaId: clinica.id, papel: u.papel, profissionalId: u.profissional_id })}`;
  return { clinica, usuario, token };
}

// Dia de teste: daqui a 7 dias (no fuso da clínica), sempre no futuro.
const dia = formatInTimeZone(addDays(new Date(), 7), FUSO, 'yyyy-MM-dd');
const diaSemana = partesLocais(instanteLocal(dia, '12:00', FUSO), FUSO).diaSemana;
const as = (hhmm: string) => instanteLocal(dia, hhmm, FUSO).toISOString();

let A: Awaited<ReturnType<typeof criarClinica>>;
let B: Awaited<ReturnType<typeof criarClinica>>;
const h: Record<string, string> = {};
const d: Record<string, string> = {};

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  app = await buildApp();
  await app.ready();

  const grande = await criarPlano(null);
  const teste = await criarPlano(1);
  A = await criarClinica('Clínica Agenda A', grande.id);
  B = await criarClinica('Clínica Agenda B', teste.id);

  // Clínica A: dois profissionais com grade 08:00–12:00 no dia de teste
  const cA = A.clinica.id;
  const prof1 = await prisma.profissional.create({
    data: { clinica_id: cA, nome: 'Dra. Um', duracao_consulta_min: 30, cor_agenda: '#2563eb' },
  });
  const prof2 = await prisma.profissional.create({ data: { clinica_id: cA, nome: 'Dr. Dois', duracao_consulta_min: 30 } });
  for (const p of [prof1, prof2]) {
    await prisma.profissionalHorario.create({
      data: { clinica_id: cA, profissional_id: p.id, dia_semana: diaSemana, hora_inicio: '08:00', hora_fim: '12:00' },
    });
  }
  // bloqueio do profissional 1 às 10:00–11:00
  await prisma.bloqueioAgenda.create({
    data: { clinica_id: cA, profissional_id: prof1.id, inicio: new Date(as('10:00')), fim: new Date(as('11:00')), motivo: 'Reunião' },
  });
  const pac = await prisma.paciente.create({ data: { clinica_id: cA, nome: 'Paciente A', telefone: '11999990000' } });
  const conv = await prisma.convenio.create({ data: { clinica_id: cA, nome: `Conv ${sufixo}` } });

  const admin = await A.usuario('admin');
  const recep = await A.usuario('recepcao');
  const profU = await A.usuario('profissional', prof1.id);
  Object.assign(h, { adminA: A.token(admin), recepA: A.token(recep), profA: A.token(profU) });
  Object.assign(d, { prof1: prof1.id, prof2: prof2.id, pacA: pac.id, convA: conv.id });

  // Clínica B (plano teste: 1 agendamento)
  const cB = B.clinica.id;
  const profB = await prisma.profissional.create({ data: { clinica_id: cB, nome: 'Dr. B' } });
  await prisma.profissionalHorario.create({
    data: { clinica_id: cB, profissional_id: profB.id, dia_semana: diaSemana, hora_inicio: '08:00', hora_fim: '18:00' },
  });
  const pacB = await prisma.paciente.create({ data: { clinica_id: cB, nome: 'Paciente B' } });
  const adminB = await B.usuario('admin');
  h.adminB = B.token(adminB);
  Object.assign(d, { profB: profB.id, pacB: pacB.id });
});

afterAll(async () => {
  if (ids.clinicas.length) {
    await prisma.agendamento.deleteMany({ where: { clinica_id: { in: ids.clinicas } } });
    await prisma.clinica.deleteMany({ where: { id: { in: ids.clinicas } } });
  }
  if (ids.planos.length) await prisma.plano.deleteMany({ where: { id: { in: ids.planos } } });
  await app?.close();
  await prisma.$disconnect();
});

const post = (auth: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/agendamentos', headers: { authorization: auth }, payload });

describe('criar agendamento', () => {
  it('dentro da grade → 201, fim padrão = duração do profissional, criado_por do token', async () => {
    const r = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof1, inicio: as('09:00') });
    expect(r.statusCode).toBe(201);
    const ag = r.json();
    d.ag1 = ag.id;
    expect(ag).toMatchObject({ status: 'agendado', tipo: 'particular', inicio: as('09:00'), fim: as('09:30') });
    expect(ag.paciente).toMatchObject({ id: d.pacA, nome: 'Paciente A', telefone: '11999990000' });
    expect(ag.profissional).toMatchObject({ id: d.prof1, cor_agenda: '#2563eb' });
    expect(ag.criado_por).toBeTruthy();
  });

  it('fora da grade → 400 fora_da_grade', async () => {
    const r = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof1, inicio: as('13:00') });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('fora_da_grade');
    // termina depois do fim da grade
    const r2 = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof1, inicio: as('11:45') });
    expect(r2.json().erro).toBe('fora_da_grade');
  });

  it('em bloqueio (do profissional ou da clínica toda) → 409 horario_bloqueado', async () => {
    const r = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof1, inicio: as('10:30') });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toBe('horario_bloqueado');

    const geral = await prisma.bloqueioAgenda.create({
      data: { clinica_id: A.clinica.id, profissional_id: null, inicio: new Date(as('11:30')), fim: new Date(as('12:00')) },
    });
    const r2 = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof2, inicio: as('11:30') });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().erro).toBe('horario_bloqueado');
    await prisma.bloqueioAgenda.delete({ where: { id: geral.id } });
  });

  it('sobreposição com outro agendamento do mesmo profissional → 409 horario_ocupado', async () => {
    const r = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof1, inicio: as('09:15') });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toBe('horario_ocupado');
    // outro profissional no mesmo horário: ok
    const r2 = await post(h.adminA!, { paciente_id: d.pacA, profissional_id: d.prof2, inicio: as('09:00') });
    expect(r2.statusCode).toBe(201);
    d.agProf2 = r2.json().id;
  });

  it('horário no passado → 400; encaixe só para admin', async () => {
    const ontem = formatInTimeZone(addDays(new Date(), -1), FUSO, 'yyyy-MM-dd');
    const inicio = instanteLocal(ontem, '09:00', FUSO).toISOString();
    const r = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof2, inicio });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('horario_passado');
    const r2 = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof2, inicio, encaixe: true });
    expect(r2.statusCode).toBe(403);
    const r3 = await post(h.adminA!, { paciente_id: d.pacA, profissional_id: d.prof2, inicio, encaixe: true });
    expect(r3.statusCode).toBe(201);
  });

  it('convênio exige convenio_id ativo', async () => {
    const r = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof2, inicio: as('10:00'), tipo: 'convenio' });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('convenio_obrigatorio');
    const r2 = await post(h.recepA!, {
      paciente_id: d.pacA,
      profissional_id: d.prof2,
      inicio: as('10:00'),
      tipo: 'convenio',
      convenio_id: d.convA,
    });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().convenio).toMatchObject({ id: d.convA });
  });

  it('isolamento: paciente/profissional de outra clínica → 404', async () => {
    const r = await post(h.recepA!, { paciente_id: d.pacB, profissional_id: d.prof1, inicio: as('11:00') });
    expect(r.statusCode).toBe(404);
    const r2 = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.profB, inicio: as('11:00') });
    expect(r2.statusCode).toBe(404);
    const r3 = await app.inject({ method: 'GET', url: `/agendamentos/${d.ag1}`, headers: { authorization: h.adminB! } });
    expect(r3.statusCode).toBe(404);
  });

  it('limite do plano de teste: 2º agendamento → 403 limite_atingido', async () => {
    const r1 = await post(h.adminB!, { paciente_id: d.pacB, profissional_id: d.profB, inicio: as('09:00') });
    expect(r1.statusCode).toBe(201);
    const r2 = await post(h.adminB!, { paciente_id: d.pacB, profissional_id: d.profB, inicio: as('14:00') });
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toMatchObject({ erro: 'limite_atingido', recurso: 'max_agendamentos', limite: 1, uso: 1 });
  });
});

describe('listar e permissões', () => {
  it('lista por período com os relacionamentos', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/agendamentos?inicio=${encodeURIComponent(as('00:00'))}&fim=${encodeURIComponent(as('23:59'))}`,
      headers: { authorization: h.recepA! },
    });
    expect(r.statusCode).toBe(200);
    const lista = r.json() as { profissional_id: string }[];
    expect(lista.length).toBeGreaterThanOrEqual(3);
    expect(new Set(lista.map((a) => a.profissional_id))).toEqual(new Set([d.prof1, d.prof2]));
  });

  it('exige período ou paciente', async () => {
    const r = await app.inject({ method: 'GET', url: '/agendamentos', headers: { authorization: h.recepA! } });
    expect(r.statusCode).toBe(400);
  });

  it('profissional só vê a própria agenda (mesmo pedindo outro profissional)', async () => {
    const url = `/agendamentos?inicio=${encodeURIComponent(as('00:00'))}&fim=${encodeURIComponent(as('23:59'))}&profissionalId=${d.prof2}`;
    const r = await app.inject({ method: 'GET', url, headers: { authorization: h.profA! } });
    expect(r.statusCode).toBe(200);
    const lista = r.json() as { profissional_id: string }[];
    expect(lista.length).toBeGreaterThan(0);
    expect(lista.every((a) => a.profissional_id === d.prof1)).toBe(true);

    const det = await app.inject({ method: 'GET', url: `/agendamentos/${d.agProf2}`, headers: { authorization: h.profA! } });
    expect(det.statusCode).toBe(404);

    const criar = await post(h.profA!, { paciente_id: d.pacA, profissional_id: d.prof2, inicio: as('11:00') });
    expect(criar.statusCode).toBe(403);
    const propria = await post(h.profA!, { paciente_id: d.pacA, profissional_id: d.prof1, inicio: as('11:00') });
    expect(propria.statusCode).toBe(201);

    const profs = await app.inject({ method: 'GET', url: '/agendamentos/profissionais', headers: { authorization: h.profA! } });
    expect((profs.json() as { id: string }[]).map((p) => p.id)).toEqual([d.prof1]);
  });

  it('histórico por paciente', async () => {
    const r = await app.inject({ method: 'GET', url: `/agendamentos?pacienteId=${d.pacA}`, headers: { authorization: h.adminA! } });
    expect(r.statusCode).toBe(200);
    expect((r.json() as unknown[]).length).toBeGreaterThanOrEqual(4);
  });
});

describe('disponibilidade', () => {
  it('exclui horários ocupados e bloqueados', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/agendamentos/disponibilidade?profissionalId=${d.prof1}&data=${dia}`,
      headers: { authorization: h.recepA! },
    });
    expect(r.statusCode).toBe(200);
    const horas = (r.json().horarios as { hora: string }[]).map((x) => x.hora);
    // grade 08:00–12:00 em 30 min; ocupados 09:00 e 11:00; bloqueio 10:00–11:00
    expect(horas).toEqual(['08:00', '08:30', '09:30', '11:30']);
  });

  it('dia sem grade → lista vazia', async () => {
    const outro = formatInTimeZone(addDays(new Date(), 8), FUSO, 'yyyy-MM-dd');
    const r = await app.inject({
      method: 'GET',
      url: `/agendamentos/disponibilidade?profissionalId=${d.prof1}&data=${outro}`,
      headers: { authorization: h.recepA! },
    });
    expect(r.json().horarios).toEqual([]);
  });
});

describe('editar e status', () => {
  it('remarcar valida conflito (ignorando ele mesmo) e grade', async () => {
    const put = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: `/agendamentos/${d.ag1}`, headers: { authorization: h.recepA! }, payload });
    const mesmo = await put({ inicio: as('09:00'), fim: as('09:30'), observacoes: 'Primeira consulta' });
    expect(mesmo.statusCode).toBe(200);
    expect(mesmo.json().observacoes).toBe('Primeira consulta');
    expect((await put({ inicio: as('11:00') })).json().erro).toBe('horario_ocupado');
    expect((await put({ inicio: as('12:00') })).json().erro).toBe('fora_da_grade');
    const ok = await put({ inicio: as('08:00') });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ inicio: as('08:00'), fim: as('08:30') });
  });

  it('transições válidas e inválidas', async () => {
    const patch = (status: string, motivo?: string) =>
      app.inject({
        method: 'PATCH',
        url: `/agendamentos/${d.ag1}/status`,
        headers: { authorization: h.recepA! },
        payload: { status, motivo },
      });
    const inval = await patch('atendido');
    expect(inval.statusCode).toBe(409);
    expect(inval.json().erro).toBe('transicao_invalida');
    expect((await patch('confirmado')).json().status).toBe('confirmado');
    const canc = await patch('cancelado', 'Paciente viajou');
    expect(canc.statusCode).toBe(200);
    expect(canc.json().status).toBe('cancelado');
    expect(canc.json().motivo_cancelamento).toBe('Paciente viajou');
    expect(canc.json().cancelado_em).toBeTruthy();
    // O motivo não é mais concatenado nas observações.
    expect(canc.json().observacoes ?? '').not.toMatch(/Paciente viajou/);
    const reabrir = await patch('agendado');
    expect(reabrir.statusCode).toBe(409);
    // cancelado não pode ser remarcado; e libera o horário
    const put = await app.inject({
      method: 'PUT',
      url: `/agendamentos/${d.ag1}`,
      headers: { authorization: h.recepA! },
      payload: { inicio: as('09:30') },
    });
    expect(put.json().erro).toBe('nao_remarcavel');
    const novo = await post(h.recepA!, { paciente_id: d.pacA, profissional_id: d.prof1, inicio: as('08:00') });
    expect(novo.statusCode).toBe(201);
  });

  it('fluxo completo agendado → confirmado → compareceu → atendido', async () => {
    const id = d.agProf2;
    for (const status of ['confirmado', 'compareceu', 'atendido']) {
      const r = await app.inject({
        method: 'PATCH',
        url: `/agendamentos/${id}/status`,
        headers: { authorization: h.adminA! },
        payload: { status },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe(status);
    }
  });
});
