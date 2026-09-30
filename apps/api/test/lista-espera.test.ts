/**
 * Lista de espera: CRUD (admin/recepção; profissional 403), sugestões compatíveis com o horário liberado,
 * oferta por WhatsApp respeitando o consentimento, vagas recentes e isolamento.
 * Adaptador FAKE de WhatsApp + enfileirador em memória. Cria os próprios dados e apaga no fim.
 */
import { randomUUID } from 'node:crypto';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PapelUsuario, PeriodoLimite } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';
import type { JobEnvioWhatsapp } from '../src/servicos/filas';
import { definirEnfileirador } from '../src/servicos/whatsapp/envio';
import { criarAdaptadorFake } from '../src/servicos/whatsapp/fakeAdapter';
import { definirProvedorWhatsapp } from '../src/servicos/whatsapp/whatsappService';

const FUSO = 'America/Sao_Paulo';
const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
const clinicas: string[] = [];
const planos: string[] = [];
const jobs: JobEnvioWhatsapp[] = [];

type Cfg = { habilitado: boolean; limite: number | null; periodo: PeriodoLimite };
const ilimitado: Cfg = { habilitado: true, limite: null, periodo: 'total' };

async function criarPlano(recursos: Partial<Record<CodigoRecurso, Cfg>>) {
  const plano = await prisma.plano.create({
    data: {
      nome: `LE ${sufixo} ${++seq}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          ...(recursos[r.codigo] ?? { habilitado: false, limite: null, periodo: 'total' as const }),
        })),
      },
    },
  });
  planos.push(plano.id);
  return plano;
}

function instante(dias: number, hora: string) {
  const d = formatInTimeZone(addDays(new Date(), dias), FUSO, 'yyyy-MM-dd');
  return fromZonedTime(`${d}T${hora}:00`, FUSO);
}

/** Dia da semana (0 = domingo) de um instante no fuso da clínica. */
function diaSemana(i: Date) {
  return Number(formatInTimeZone(i, FUSO, 'i')) % 7;
}

async function criarClinica(recursos: Partial<Record<CodigoRecurso, Cfg>> = {}) {
  const plano = await criarPlano({
    lista_espera: ilimitado,
    whatsapp: ilimitado,
    max_mensagens: ilimitado,
    max_agendamentos: ilimitado,
    ...recursos,
  });
  const n = ++seq;
  const clinica = await prisma.clinica.create({
    data: { nome: `Clínica LE ${sufixo} ${n}`, documento: `6${Date.now()}${n}`.slice(0, 14), telefone: '1133335555' },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: plano.id, status: 'ativa' } });
  const profissional = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: 'Dra. Espera' } });
  const outro = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: 'Dr. Outro' } });
  await prisma.profissionalHorario.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      clinica_id: clinica.id,
      profissional_id: profissional.id,
      dia_semana: d,
      hora_inicio: '08:00',
      hora_fim: '20:00',
    })),
  });
  const mk = (papel: PapelUsuario, profissionalId: string | null = null) =>
    prisma.usuario.create({
      data: {
        clinica_id: clinica.id,
        nome: `${papel} ${n}`,
        email: `${papel}.${n}.${sufixo}@le.teste`,
        senha_hash: 'x',
        papel,
        profissional_id: profissionalId,
      },
    });
  const token = (u: { id: string; papel: PapelUsuario; profissional_id: string | null }) =>
    assinarTokenClinica(app, { usuarioId: u.id, clinicaId: clinica.id, papel: u.papel, profissionalId: u.profissional_id });
  return {
    clinica,
    profissional,
    outro,
    tokenAdmin: token(await mk('admin')),
    tokenRecepcao: token(await mk('recepcao')),
    tokenProfissional: token(await mk('profissional', profissional.id)),
  };
}
type Clin = Awaited<ReturnType<typeof criarClinica>>;

async function criarPaciente(c: Clin, nome: string, aceita = true) {
  return prisma.paciente.create({
    data: {
      clinica_id: c.clinica.id,
      nome,
      whatsapp: `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      aceita_whatsapp: aceita,
    },
  });
}

async function agendamentoCancelado(c: Clin, inicio: Date, pacienteId?: string) {
  const pid = pacienteId ?? (await criarPaciente(c, `Cancelou ${++seq}`)).id;
  return prisma.agendamento.create({
    data: {
      clinica_id: c.clinica.id,
      paciente_id: pid,
      profissional_id: c.profissional.id,
      inicio,
      fim: new Date(inicio.getTime() + 30 * 60_000),
      status: 'cancelado',
      cancelado_em: new Date(),
    },
  });
}

const h = (token: string) => ({ authorization: `Bearer ${token}` });

function adicionar(c: Clin, token: string, corpo: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/lista-espera', headers: h(token), payload: corpo });
}

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  definirProvedorWhatsapp(criarAdaptadorFake());
  definirEnfileirador(async (job) => {
    jobs.push(job);
  });
  app = await buildApp({ logger: false });
});

beforeEach(() => {
  jobs.length = 0;
});

afterAll(async () => {
  definirEnfileirador(null);
  definirProvedorWhatsapp(null);
  if (clinicas.length) {
    await prisma.$transaction(async (tx) => {
      await tx.mensagemWhatsapp.deleteMany({ where: { clinica_id: { in: clinicas } } });
      await tx.clinica.deleteMany({ where: { id: { in: clinicas } } });
    });
  }
  if (planos.length) await prisma.plano.deleteMany({ where: { id: { in: planos } } });
  await app.close();
});

describe('lista de espera', () => {
  it('recepção faz o CRUD; profissional não gerencia; recurso desligado ⇒ 403', async () => {
    const c = await criarClinica();
    const pac = await criarPaciente(c, 'Paula Aguardando');
    const criado = await adicionar(c, c.tokenRecepcao, {
      paciente_id: pac.id,
      profissional_id: c.profissional.id,
      dias_semana: [3, 1, 1],
      turnos: ['manha'],
      observacao: 'Prefere cedo',
    });
    expect(criado.statusCode).toBe(201);
    const item = criado.json();
    expect(item).toMatchObject({ status: 'aguardando', dias_semana: [1, 3], turnos: ['manha'] });
    expect(item.paciente).toMatchObject({ id: pac.id, aceita_whatsapp: true });

    const dup = await adicionar(c, c.tokenRecepcao, { paciente_id: pac.id, profissional_id: c.profissional.id });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('ja_na_lista');

    const lista = await app.inject({ method: 'GET', url: '/lista-espera', headers: h(c.tokenRecepcao) });
    expect(lista.json()).toMatchObject({ total: 1, pagina: 1 });

    const put = await app.inject({
      method: 'PUT',
      url: `/lista-espera/${item.id}`,
      headers: h(c.tokenAdmin),
      payload: { profissional_id: null, turnos: ['tarde', 'noite'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ profissional_id: null, turnos: ['tarde', 'noite'] });

    const remover = await app.inject({
      method: 'PATCH',
      url: `/lista-espera/${item.id}/status`,
      headers: h(c.tokenRecepcao),
      payload: { status: 'removido' },
    });
    expect(remover.json().status).toBe('removido');
    expect((await app.inject({ method: 'GET', url: '/lista-espera', headers: h(c.tokenRecepcao) })).json().total).toBe(0);

    for (const [method, url] of [
      ['GET', '/lista-espera'],
      ['POST', '/lista-espera'],
      ['GET', '/lista-espera/vagas-recentes'],
    ] as const) {
      const r = await app.inject({ method, url, headers: h(c.tokenProfissional), payload: method === 'POST' ? { paciente_id: pac.id } : undefined });
      expect(r.statusCode).toBe(403);
    }

    const sem = await criarClinica({ lista_espera: { habilitado: false, limite: null, periodo: 'total' } });
    const r = await app.inject({ method: 'GET', url: '/lista-espera', headers: h(sem.tokenAdmin) });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('recurso_indisponivel');
  });

  it('sugestões compatíveis com o horário liberado, por ordem de entrada', async () => {
    const c = await criarClinica();
    const inicio = instante(5, '10:00'); // manhã
    const dia = diaSemana(inicio);
    const cancelado = await agendamentoCancelado(c, inicio);

    const qualquer = await criarPaciente(c, 'A Qualquer');
    const mesmoProf = await criarPaciente(c, 'B Mesmo Profissional');
    const outroProf = await criarPaciente(c, 'C Outro Profissional');
    const noite = await criarPaciente(c, 'D Só Noite');
    const outroDia = await criarPaciente(c, 'E Outro Dia');
    const quemCancelou = cancelado.paciente_id;

    expect((await adicionar(c, c.tokenAdmin, { paciente_id: qualquer.id })).statusCode).toBe(201);
    await adicionar(c, c.tokenAdmin, { paciente_id: mesmoProf.id, profissional_id: c.profissional.id, dias_semana: [dia], turnos: ['manha'] });
    await adicionar(c, c.tokenAdmin, { paciente_id: outroProf.id, profissional_id: c.outro.id });
    await adicionar(c, c.tokenAdmin, { paciente_id: noite.id, turnos: ['noite'] });
    await adicionar(c, c.tokenAdmin, { paciente_id: outroDia.id, dias_semana: [(dia + 1) % 7] });
    await adicionar(c, c.tokenAdmin, { paciente_id: quemCancelou });

    const r = await app.inject({
      method: 'GET',
      url: `/lista-espera/sugestoes?agendamento_id=${cancelado.id}`,
      headers: h(c.tokenRecepcao),
    });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.horario_livre).toBe(true);
    expect(b.agendamento.profissional.id).toBe(c.profissional.id);
    expect(b.sugestoes.map((s: { paciente: { id: string } }) => s.paciente.id)).toEqual([qualquer.id, mesmoProf.id]);

    // por profissional + início (sem agendamento)
    const livre = await app.inject({
      method: 'GET',
      url: `/lista-espera/sugestoes?profissional_id=${c.outro.id}&inicio=${encodeURIComponent(instante(5, '19:00').toISOString())}`,
      headers: h(c.tokenRecepcao),
    });
    expect(livre.json().sugestoes.map((s: { paciente: { id: string } }) => s.paciente.id)).toEqual([
      qualquer.id,
      outroProf.id,
      noite.id,
      quemCancelou,
    ]);

    // vagas recentes (aviso no topo)
    const vagas = await app.inject({ method: 'GET', url: '/lista-espera/vagas-recentes', headers: h(c.tokenAdmin) });
    expect(vagas.json().itens).toEqual([expect.objectContaining({ agendamento_id: cancelado.id, sugestoes: 2 })]);

    // horário ocupado por outro agendamento ⇒ não está mais livre
    await prisma.agendamento.create({
      data: {
        clinica_id: c.clinica.id,
        paciente_id: outroDia.id,
        profissional_id: c.profissional.id,
        inicio,
        fim: new Date(inicio.getTime() + 30 * 60_000),
      },
    });
    const ocupado = await app.inject({
      method: 'GET',
      url: `/lista-espera/sugestoes?agendamento_id=${cancelado.id}`,
      headers: h(c.tokenRecepcao),
    });
    expect(ocupado.json().horario_livre).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/lista-espera/vagas-recentes', headers: h(c.tokenAdmin) })).json().total).toBe(0);

    // agendamento ativo ⇒ 409
    const ativo = await prisma.agendamento.findFirstOrThrow({ where: { clinica_id: c.clinica.id, status: 'agendado' } });
    const r409 = await app.inject({ method: 'GET', url: `/lista-espera/sugestoes?agendamento_id=${ativo.id}`, headers: h(c.tokenAdmin) });
    expect(r409.statusCode).toBe(409);
  });

  it('oferta por WhatsApp respeita o consentimento; agendar marca a entrada como agendada', async () => {
    const c = await criarClinica();
    const inicio = instante(6, '14:00');
    const cancelado = await agendamentoCancelado(c, inicio);
    const semConsent = await criarPaciente(c, 'Sem Consentimento', false);
    const comConsent = await criarPaciente(c, 'Com Consentimento', true);
    const itemSem = (await adicionar(c, c.tokenAdmin, { paciente_id: semConsent.id })).json();
    const itemCom = (await adicionar(c, c.tokenAdmin, { paciente_id: comConsent.id })).json();

    const r1 = await app.inject({
      method: 'POST',
      url: `/lista-espera/${itemSem.id}/oferecer`,
      headers: h(c.tokenRecepcao),
      payload: { agendamento_id: cancelado.id },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().whatsapp).toEqual({ enfileirada: false, erro: 'sem_consentimento' });
    expect(jobs).toHaveLength(0);
    expect(await prisma.mensagemWhatsapp.count({ where: { clinica_id: c.clinica.id } })).toBe(0);

    const r2 = await app.inject({
      method: 'POST',
      url: `/lista-espera/${itemCom.id}/oferecer`,
      headers: h(c.tokenRecepcao),
      payload: { agendamento_id: cancelado.id },
    });
    expect(r2.json().whatsapp).toEqual({ enfileirada: true });
    expect(r2.json().ultima_oferta_em).toBeTruthy();
    expect(jobs).toHaveLength(1);
    const msg = await prisma.mensagemWhatsapp.findFirstOrThrow({ where: { clinica_id: c.clinica.id } });
    expect(msg).toMatchObject({ tipo: 'oferta_horario', paciente_id: comConsent.id });
    expect(msg.conteudo).toContain('Dra. Espera');

    // agendar pela rota normal e marcar a entrada
    const ag = await app.inject({
      method: 'POST',
      url: '/agendamentos',
      headers: h(c.tokenRecepcao),
      payload: { paciente_id: comConsent.id, profissional_id: c.profissional.id, inicio: inicio.toISOString() },
    });
    expect(ag.statusCode).toBe(201);
    const agId = ag.json().id;
    const marcar = await app.inject({
      method: 'PATCH',
      url: `/lista-espera/${itemCom.id}/status`,
      headers: h(c.tokenRecepcao),
      payload: { status: 'agendado', agendamento_id: agId },
    });
    expect(marcar.statusCode).toBe(200);
    expect(marcar.json()).toMatchObject({ status: 'agendado', agendamento_id: agId });

    // horário ocupado agora ⇒ oferta recusada
    const r3 = await app.inject({
      method: 'POST',
      url: `/lista-espera/${itemSem.id}/oferecer`,
      headers: h(c.tokenRecepcao),
      payload: { agendamento_id: cancelado.id },
    });
    expect(r3.statusCode).toBe(409);
    expect(r3.json().erro).toBe('horario_indisponivel');

    // agendamento de outro paciente não pode ser vinculado
    const errado = await app.inject({
      method: 'PATCH',
      url: `/lista-espera/${itemSem.id}/status`,
      headers: h(c.tokenRecepcao),
      payload: { status: 'agendado', agendamento_id: agId },
    });
    expect(errado.statusCode).toBe(400);
  });

  it('isolamento entre clínicas', async () => {
    const a = await criarClinica();
    const b = await criarClinica();
    const pacA = await criarPaciente(a, 'Paciente A');
    const item = (await adicionar(a, a.tokenAdmin, { paciente_id: pacA.id })).json();
    const cancelA = await agendamentoCancelado(a, instante(4, '09:00'));

    expect((await adicionar(b, b.tokenAdmin, { paciente_id: pacA.id })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: `/lista-espera/${item.id}`, headers: h(b.tokenAdmin), payload: { observacao: 'x' } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/lista-espera/sugestoes?agendamento_id=${cancelA.id}`, headers: h(b.tokenAdmin) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/lista-espera/${item.id}/oferecer`,
          headers: h(b.tokenAdmin),
          payload: { agendamento_id: cancelA.id },
        })
      ).statusCode,
    ).toBe(404);
  });
});
