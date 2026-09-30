/**
 * Módulo retornos + job diário (convites e detecção de agendamento).
 * Cria os próprios dados (nomes/documentos únicos) e apaga no fim — não limpa o banco.
 * WhatsApp: enfileirador em memória + adaptador fake (nada sai para o Redis/WPPConnect).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PapelUsuario, PeriodoLimite } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';
import { criarDbTenant } from '../src/plugins/tenant';
import { atualizarConfiguracaoClinica } from '../src/servicos/configuracaoClinica';
import type { JobEnvioWhatsapp } from '../src/servicos/filas';
import { definirEnfileirador } from '../src/servicos/whatsapp/envio';
import { criarAdaptadorFake } from '../src/servicos/whatsapp/fakeAdapter';
import { definirProvedorWhatsapp } from '../src/servicos/whatsapp/whatsappService';
import { processarRetornos } from '../src/workers/retornos';

const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
const clinicas: string[] = [];
const planos: string[] = [];
const ligado = { habilitado: true, limite: null, periodo: 'total' as PeriodoLimite };
const jobs: JobEnvioWhatsapp[] = [];

async function criarPlano(recursos: Partial<Record<CodigoRecurso, typeof ligado>>) {
  const plano = await prisma.plano.create({
    data: {
      nome: `Retornos ${sufixo} ${++seq}`,
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

async function criarClinica(planoId: string) {
  const clinica = await prisma.clinica.create({
    data: { nome: `Clínica Retorno ${sufixo} ${++seq}`, documento: `6${Date.now()}${seq}`.slice(0, 14) },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  const db = criarDbTenant(clinica.id);
  async function usuario(papel: PapelUsuario, profissionalId: string | null = null) {
    const u = await db.usuario.create({
      data: { nome: `${papel} ${++seq}`, email: `${papel}.${seq}.${sufixo}@ret.teste`, senha_hash: 'x', papel, profissional_id: profissionalId },
    });
    const token = assinarTokenClinica(app, { usuarioId: u.id, clinicaId: clinica.id, papel, profissionalId });
    return { usuario: u, h: { authorization: `Bearer ${token}` } };
  }
  async function agendamento(pacienteId: string, profissionalId: string, inicioIso: string, status = 'agendado') {
    const inicio = new Date(inicioIso);
    return db.agendamento.create({
      data: {
        paciente_id: pacienteId,
        profissional_id: profissionalId,
        inicio,
        fim: new Date(inicio.getTime() + 30 * 60_000),
        status: status as 'agendado',
      },
    });
  }
  return { clinica, db, usuario, agendamento };
}

type Clinica = Awaited<ReturnType<typeof criarClinica>>;
type Usu = Awaited<ReturnType<Clinica['usuario']>>;
let A: Clinica, B: Clinica;
let admin: Usu, recepcao: Usu, prof: Usu, outroProf: Usu, adminB: Usu;
let profId: string, prof2Id: string;
let comConsentimento: string, semConsentimento: string;

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  app = await buildApp({ logger: false });
  definirEnfileirador(async (job) => {
    jobs.push(job);
  });
  definirProvedorWhatsapp(criarAdaptadorFake());

  const plano = await criarPlano({ retorno_automatico: ligado, whatsapp: ligado, max_mensagens: ligado });
  A = await criarClinica(plano.id);
  B = await criarClinica(plano.id);
  const p1 = await A.db.profissional.create({ data: { nome: 'Dra. Ana Retorno' } });
  const p2 = await A.db.profissional.create({ data: { nome: 'Dr. Bruno Outro' } });
  profId = p1.id;
  prof2Id = p2.id;
  admin = await A.usuario('admin');
  recepcao = await A.usuario('recepcao');
  prof = await A.usuario('profissional', p1.id);
  outroProf = await A.usuario('profissional', p2.id);
  adminB = await B.usuario('admin');
  comConsentimento = (
    await A.db.paciente.create({ data: { nome: 'Maria Consentiu', whatsapp: '5511999990001', aceita_whatsapp: true } })
  ).id;
  semConsentimento = (
    await A.db.paciente.create({ data: { nome: 'Pedro Não Consentiu', whatsapp: '5511999990002', aceita_whatsapp: false } })
  ).id;
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

describe('retornos — definição a partir do atendimento', () => {
  it('cria retorno em X dias para consulta atendida (dia local + dias) e recusa duplicado', async () => {
    const origem = await A.agendamento(comConsentimento, profId, '2026-09-01T13:00:00Z', 'atendido');
    const r = await app.inject({
      method: 'POST',
      url: '/retornos',
      headers: prof.h,
      payload: { agendamento_origem_id: origem.id, dias: 30, observacao: 'Trazer exames' },
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pendente',
      data_prevista: '2026-10-01',
      paciente_id: comConsentimento,
      profissional_id: profId,
      observacao: 'Trazer exames',
      agendamento_origem: { id: origem.id },
    });
    const dup = await app.inject({ method: 'POST', url: '/retornos', headers: admin.h, payload: { agendamento_origem_id: origem.id, dias: 7 } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('retorno_existente');

    const doAgendamento = await app.inject({ method: 'GET', url: `/retornos/agendamento/${origem.id}`, headers: recepcao.h });
    expect(doAgendamento.statusCode).toBe(200);
    expect(doAgendamento.json().id).toBe(r.json().id);
  });

  it('exige status compareceu/atendido, dias ou data e respeita a agenda do profissional', async () => {
    const agendado = await A.agendamento(semConsentimento, profId, '2026-09-02T13:00:00Z', 'agendado');
    const r = await app.inject({ method: 'POST', url: '/retornos', headers: recepcao.h, payload: { agendamento_origem_id: agendado.id, dias: 15 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toBe('status_invalido');

    const sem = await app.inject({ method: 'GET', url: `/retornos/agendamento/${agendado.id}`, headers: recepcao.h });
    expect(sem.statusCode).toBe(200);
    expect(sem.json()).toBeNull();

    const compareceu = await A.agendamento(semConsentimento, profId, '2026-09-03T13:00:00Z', 'compareceu');
    const semDias = await app.inject({ method: 'POST', url: '/retornos', headers: recepcao.h, payload: { agendamento_origem_id: compareceu.id } });
    expect(semDias.statusCode).toBe(400);
    const dataPassada = await app.inject({
      method: 'POST',
      url: '/retornos',
      headers: recepcao.h,
      payload: { agendamento_origem_id: compareceu.id, data_prevista: '2026-09-03' },
    });
    expect(dataPassada.statusCode).toBe(400);
    const deOutro = await app.inject({ method: 'POST', url: '/retornos', headers: outroProf.h, payload: { agendamento_origem_id: compareceu.id, dias: 7 } });
    expect(deOutro.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/retornos',
      headers: recepcao.h,
      payload: { agendamento_origem_id: compareceu.id, data_prevista: '2026-09-28' },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().criado_por).toBe(recepcao.usuario.id);
  });

  it('lista com filtros; profissional só vê os seus', async () => {
    const todos = await app.inject({ method: 'GET', url: '/retornos?status=abertos', headers: recepcao.h });
    expect(todos.statusCode).toBe(200);
    expect(todos.json().total).toBe(2);
    expect(todos.json().itens[0]).toHaveProperty('paciente.aceita_whatsapp');
    const outro = await app.inject({ method: 'GET', url: '/retornos', headers: outroProf.h });
    expect(outro.json().total).toBe(0);
    const forcado = await app.inject({ method: 'GET', url: `/retornos?profissional_id=${profId}`, headers: outroProf.h });
    expect(forcado.json().total).toBe(0);
    const periodo = await app.inject({ method: 'GET', url: '/retornos?inicio=2026-10-01&fim=2026-10-31', headers: admin.h });
    expect(periodo.json().total).toBe(1);
    expect(periodo.json().itens[0].data_prevista).toBe('2026-10-01');
  });
});

describe('retornos — job diário', () => {
  it('envia o convite uma única vez e só para quem consentiu', async () => {
    await atualizarConfiguracaoClinica(A.db, { retorno_convite_ativo: true, retorno_dias_antecedencia: 7 });
    // "Hoje" = 25/09: retorno de 01/10 (consentiu) está na janela de 7 dias; o de 28/09 (não consentiu) também.
    const antes = jobs.length;
    const r1 = await processarRetornos({ clinicaId: A.clinica.id, data: '2026-09-25' });
    expect(r1).toMatchObject({ processadas: 1, convites: 1 });
    expect(jobs.length).toBe(antes + 1);

    const msgs = await A.db.mensagemWhatsapp.findMany({ where: { tipo: 'convite_retorno' } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ paciente_id: comConsentimento, status: 'pendente', telefone: '5511999990001' });
    expect(msgs[0]!.conteudo).toContain('01/10/2026');
    expect(msgs[0]!.conteudo).toContain('Dra. Ana Retorno');

    const convidado = await A.db.retorno.findFirstOrThrow({ where: { paciente_id: comConsentimento } });
    expect(convidado.status).toBe('lembrado');
    expect(convidado.convite_enviado_em).not.toBeNull();
    const naoConsentiu = await A.db.retorno.findFirstOrThrow({ where: { paciente_id: semConsentimento } });
    expect(naoConsentiu).toMatchObject({ status: 'pendente', convite_enviado_em: null });

    const r2 = await processarRetornos({ clinicaId: A.clinica.id, data: '2026-09-26' });
    expect(r2.convites).toBe(0);
    expect(jobs.length).toBe(antes + 1);
    expect(await A.db.mensagemWhatsapp.count({ where: { tipo: 'convite_retorno' } })).toBe(1);
  });

  it('não envia fora da janela nem com o convite automático desligado', async () => {
    const origem = await A.agendamento(comConsentimento, prof2Id, '2026-09-05T13:00:00Z', 'atendido');
    const r = await app.inject({ method: 'POST', url: '/retornos', headers: admin.h, payload: { agendamento_origem_id: origem.id, dias: 60 } });
    expect(r.json().data_prevista).toBe('2026-11-04');
    await processarRetornos({ clinicaId: A.clinica.id, data: '2026-09-25' });
    expect((await A.db.retorno.findUniqueOrThrow({ where: { id: r.json().id } })).status).toBe('pendente');

    await atualizarConfiguracaoClinica(A.db, { retorno_convite_ativo: false });
    await processarRetornos({ clinicaId: A.clinica.id, data: '2026-11-01' });
    expect((await A.db.retorno.findUniqueOrThrow({ where: { id: r.json().id } })).status).toBe('pendente');
    await atualizarConfiguracaoClinica(A.db, { retorno_convite_ativo: true });
  });

  it('detecta o agendamento do retorno e marca como agendado', async () => {
    const novo = await A.agendamento(comConsentimento, profId, '2026-10-02T14:00:00Z', 'agendado');
    // Agendamento com OUTRO profissional não conta.
    await A.agendamento(semConsentimento, prof2Id, '2026-09-29T14:00:00Z', 'agendado');
    const r = await processarRetornos({ clinicaId: A.clinica.id, data: '2026-09-27' });
    expect(r.agendados).toBe(1);
    const ret = await A.db.retorno.findFirstOrThrow({ where: { paciente_id: comConsentimento, profissional_id: profId } });
    expect(ret).toMatchObject({ status: 'agendado', agendamento_retorno_id: novo.id });
    const outro = await A.db.retorno.findFirstOrThrow({ where: { paciente_id: semConsentimento } });
    expect(outro.status).toBe('pendente');

    // Cancelou o agendamento do retorno ⇒ volta a ficar em aberto.
    await A.db.agendamento.update({ where: { id: novo.id }, data: { status: 'cancelado' } });
    const r2 = await processarRetornos({ clinicaId: A.clinica.id, data: '2026-09-28' });
    expect(r2.reabertos).toBe(1);
    // Já tinha sido convidado ⇒ volta a `lembrado` (sem novo convite).
    expect((await A.db.retorno.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe('lembrado');
  });

  it('ignora clínica sem o recurso', async () => {
    const semRecurso = await criarClinica((await criarPlano({ whatsapp: ligado, max_mensagens: ligado })).id);
    const p = await semRecurso.db.profissional.create({ data: { nome: 'Dr. X' } });
    const pac = await semRecurso.db.paciente.create({ data: { nome: 'Y', whatsapp: '5511999990009', aceita_whatsapp: true } });
    const origem = await semRecurso.agendamento(pac.id, p.id, '2026-09-01T13:00:00Z', 'atendido');
    await semRecurso.db.retorno.create({
      data: { paciente_id: pac.id, profissional_id: p.id, agendamento_origem_id: origem.id, data_prevista: new Date('2026-09-28T00:00:00Z') },
    });
    const r = await processarRetornos({ clinicaId: semRecurso.clinica.id, data: '2026-09-25' });
    expect(r.processadas).toBe(0);
    const u = await semRecurso.usuario('admin');
    const http = await app.inject({ method: 'GET', url: '/retornos', headers: u.h });
    expect(http.statusCode).toBe(403);
    expect(http.json().erro).toBe('recurso_indisponivel');
  });
});

describe('retornos — ações, configuração e isolamento', () => {
  let retornoId: string;

  it('marca como agendado (valida o agendamento no tenant), cancela e reabre', async () => {
    const ret = await A.db.retorno.findFirstOrThrow({ where: { paciente_id: semConsentimento } });
    retornoId = ret.id;
    const deOutroPaciente = await A.agendamento(comConsentimento, profId, '2026-10-10T13:00:00Z');
    const r1 = await app.inject({
      method: 'PATCH',
      url: `/retornos/${ret.id}/status`,
      headers: recepcao.h,
      payload: { status: 'agendado', agendamento_retorno_id: deOutroPaciente.id },
    });
    expect(r1.statusCode).toBe(404);
    const agB = await B.db.paciente.create({ data: { nome: 'Paciente B' } });
    const r2 = await app.inject({
      method: 'PATCH',
      url: `/retornos/${ret.id}/status`,
      headers: recepcao.h,
      payload: { status: 'agendado', agendamento_retorno_id: agB.id },
    });
    expect(r2.statusCode).toBe(404);

    const certo = await A.agendamento(semConsentimento, profId, '2026-10-12T13:00:00Z');
    const ok = await app.inject({
      method: 'PATCH',
      url: `/retornos/${ret.id}/status`,
      headers: recepcao.h,
      payload: { status: 'agendado', agendamento_retorno_id: certo.id },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'agendado', agendamento_retorno: { id: certo.id } });

    const cancelar = await app.inject({ method: 'PATCH', url: `/retornos/${ret.id}/status`, headers: prof.h, payload: { status: 'cancelado' } });
    expect(cancelar.json().status).toBe('cancelado');
    const editarCancelado = await app.inject({ method: 'PUT', url: `/retornos/${ret.id}`, headers: prof.h, payload: { dias: 10 } });
    expect(editarCancelado.statusCode).toBe(409);
    const reabrir = await app.inject({ method: 'PATCH', url: `/retornos/${ret.id}/status`, headers: admin.h, payload: { status: 'pendente' } });
    expect(reabrir.json()).toMatchObject({ status: 'pendente', agendamento_retorno_id: null });
    const editar = await app.inject({ method: 'PUT', url: `/retornos/${ret.id}`, headers: prof.h, payload: { dias: 10, observacao: 'Ligar antes' } });
    expect(editar.statusCode, editar.body).toBe(200);
    expect(editar.json()).toMatchObject({ data_prevista: '2026-09-13', observacao: 'Ligar antes', vencido: true });
  });

  it('convite manual: admin/recepção; sem consentimento não envia', async () => {
    const pelaProf = await app.inject({ method: 'POST', url: `/retornos/${retornoId}/convidar`, headers: prof.h });
    expect(pelaProf.statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: `/retornos/${retornoId}/convidar`, headers: recepcao.h });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ whatsapp: { enfileirada: false, erro: 'sem_consentimento' }, retorno: { status: 'pendente' } });
  });

  it('configuração: só admin', async () => {
    const get = await app.inject({ method: 'GET', url: '/retornos/configuracao', headers: admin.h });
    expect(get.json()).toEqual({ convite_ativo: true, dias_antecedencia: 7 });
    const put = await app.inject({ method: 'PUT', url: '/retornos/configuracao', headers: admin.h, payload: { dias_antecedencia: 10 } });
    expect(put.json()).toEqual({ convite_ativo: true, dias_antecedencia: 10 });
    const invalido = await app.inject({ method: 'PUT', url: '/retornos/configuracao', headers: admin.h, payload: { dias_antecedencia: 61 } });
    expect(invalido.statusCode).toBe(400);
    const recep = await app.inject({ method: 'PUT', url: '/retornos/configuracao', headers: recepcao.h, payload: { convite_ativo: false } });
    expect(recep.statusCode).toBe(403);
  });

  it('isolamento: outra clínica não vê nem altera', async () => {
    const lista = await app.inject({ method: 'GET', url: '/retornos', headers: adminB.h });
    expect(lista.json().total).toBe(0);
    const patch = await app.inject({ method: 'PATCH', url: `/retornos/${retornoId}/status`, headers: adminB.h, payload: { status: 'cancelado' } });
    expect(patch.statusCode).toBe(404);
    const ret = await A.db.retorno.findUniqueOrThrow({ where: { id: retornoId } });
    const doAg = await app.inject({ method: 'GET', url: `/retornos/agendamento/${ret.agendamento_origem_id}`, headers: adminB.h });
    expect(doAg.statusCode).toBe(404);
    const criar = await app.inject({ method: 'POST', url: '/retornos', headers: adminB.h, payload: { agendamento_origem_id: ret.agendamento_origem_id, dias: 5 } });
    expect(criar.statusCode).toBe(404);
  });
});

describe('retornos — vínculo na hora ao criar agendamento', () => {
  it('POST /agendamentos marca o retorno em aberto do mesmo paciente+profissional (dentro da janela)', async () => {
    const plano = await criarPlano({ retorno_automatico: ligado, max_agendamentos: ligado });
    const C = await criarClinica(plano.id);
    const adm = await C.usuario('admin');
    const p = await C.db.profissional.create({ data: { nome: 'Dra. Carla Vínculo' } });
    const outro = await C.db.profissional.create({ data: { nome: 'Dr. Davi Outro' } });
    const pac = await C.db.paciente.create({ data: { nome: 'Paciente Vínculo' } });
    const origem = await C.agendamento(pac.id, p.id, '2026-08-01T13:00:00Z', 'atendido');
    const retorno = await C.db.retorno.create({
      data: { paciente_id: pac.id, profissional_id: p.id, agendamento_origem_id: origem.id, data_prevista: new Date('2026-08-31T00:00:00Z') },
    });
    const criar = (profissionalId: string, inicio: string) =>
      app.inject({
        method: 'POST',
        url: '/agendamentos',
        headers: adm.h,
        payload: { paciente_id: pac.id, profissional_id: profissionalId, inicio, encaixe: true },
      });

    // Outro profissional: não vincula.
    const r1 = await criar(outro.id, '2026-09-10T13:00:00Z');
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json().retorno_vinculado_id).toBeNull();
    // Fora da janela (data prevista + 90 dias): não vincula.
    const r2 = await criar(p.id, '2026-12-15T13:00:00Z');
    expect(r2.json().retorno_vinculado_id).toBeNull();
    // Mesmo profissional, dentro da janela: vincula na hora.
    const r3 = await criar(p.id, '2026-09-10T15:00:00Z');
    expect(r3.statusCode, r3.body).toBe(201);
    expect(r3.json().retorno_vinculado_id).toBe(retorno.id);
    expect(await C.db.retorno.findUniqueOrThrow({ where: { id: retorno.id } })).toMatchObject({
      status: 'agendado',
      agendamento_retorno_id: r3.json().id,
    });
  });

  it('sem o recurso retorno_automatico não mexe nos retornos', async () => {
    const plano = await criarPlano({ max_agendamentos: ligado });
    const C = await criarClinica(plano.id);
    const adm = await C.usuario('admin');
    const p = await C.db.profissional.create({ data: { nome: 'Dr. Sem Recurso' } });
    const pac = await C.db.paciente.create({ data: { nome: 'Paciente Sem Recurso' } });
    const origem = await C.agendamento(pac.id, p.id, '2026-08-01T13:00:00Z', 'atendido');
    const retorno = await C.db.retorno.create({
      data: { paciente_id: pac.id, profissional_id: p.id, agendamento_origem_id: origem.id, data_prevista: new Date('2026-08-31T00:00:00Z') },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/agendamentos',
      headers: adm.h,
      payload: { paciente_id: pac.id, profissional_id: p.id, inicio: '2026-09-10T13:00:00Z', encaixe: true },
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().retorno_vinculado_id).toBeNull();
    expect((await C.db.retorno.findUniqueOrThrow({ where: { id: retorno.id } })).status).toBe('pendente');
  });
});

describe('retornos — segurança (auditoria B6)', () => {
  it('agendamento vinculado precisa ser do mesmo paciente E do mesmo profissional do retorno', async () => {
    const pac = await A.db.paciente.create({ data: { nome: `Paciente B6 ${sufixo}` } });
    const origem = await A.agendamento(pac.id, profId, '2026-09-02T13:00:00Z', 'atendido');
    const ret = await A.db.retorno.create({
      data: { paciente_id: pac.id, profissional_id: profId, agendamento_origem_id: origem.id, data_prevista: new Date('2026-10-02T00:00:00Z') },
    });
    const deOutroProf = await A.agendamento(pac.id, prof2Id, '2026-10-03T13:00:00Z');
    for (const quem of [prof, admin]) {
      const r = await app.inject({
        method: 'PATCH',
        url: `/retornos/${ret.id}/status`,
        headers: quem.h,
        payload: { status: 'agendado', agendamento_retorno_id: deOutroProf.id },
      });
      expect(r.statusCode).toBe(404);
    }
    expect((await A.db.retorno.findUniqueOrThrow({ where: { id: ret.id } })).status).toBe('pendente');

    const doMesmo = await A.agendamento(pac.id, profId, '2026-10-04T13:00:00Z');
    const ok = await app.inject({
      method: 'PATCH',
      url: `/retornos/${ret.id}/status`,
      headers: prof.h,
      payload: { status: 'agendado', agendamento_retorno_id: doMesmo.id },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});
