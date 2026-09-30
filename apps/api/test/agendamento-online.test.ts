/**
 * Agendamento online: rotas públicas (sem vazamento, anti-abuso, disponibilidade), aprovação/recusa pela
 * recepção (limite do plano, WhatsApp só com consentimento, conflito), isolamento entre clínicas, worker.
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
import { expirarSolicitacoes } from '../src/workers/solicitacoesAgendamento';

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
      nome: `AO ${sufixo} ${++seq}`,
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

const recursosPadrao: Partial<Record<CodigoRecurso, Cfg>> = {
  agendamento_online: ilimitado,
  max_agendamentos: ilimitado,
  whatsapp: ilimitado,
  max_mensagens: ilimitado,
  max_profissionais: ilimitado,
};

function ipUnico() {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${++seq % 250}`;
}

function telefoneUnico() {
  return `119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

/** Dia local (fuso da clínica) daqui a `dias` dias e o instante UTC de uma hora nele. */
function dia(dias: number) {
  return formatInTimeZone(addDays(new Date(), dias), FUSO, 'yyyy-MM-dd');
}
function instante(d: string, hora: string) {
  return fromZonedTime(`${d}T${hora}:00`, FUSO);
}

async function criarClinica(opcoes: { plano?: string; ativo?: boolean; statusAssinatura?: 'ativa' | 'vencida' } = {}) {
  const planoId = opcoes.plano ?? (await criarPlano(recursosPadrao)).id;
  const n = ++seq;
  const slug = `ao-teste-${sufixo}-${n}`;
  const clinica = await prisma.clinica.create({
    data: { nome: `Clínica AO ${sufixo} ${n}`, documento: `7${Date.now()}${n}`.slice(0, 14), slug, telefone: '1133334444' },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({
    data: { clinica_id: clinica.id, plano_id: planoId, status: opcoes.statusAssinatura ?? 'ativa' },
  });
  await prisma.configuracaoClinica.create({
    data: { clinica_id: clinica.id, ao_ativo: opcoes.ativo ?? true, ao_antecedencia_min_horas: 2, ao_dias_a_frente: 30 },
  });
  const mkUsuario = (papel: PapelUsuario, profissionalId: string | null = null) =>
    prisma.usuario.create({
      data: {
        clinica_id: clinica.id,
        nome: `${papel} ${n}`,
        email: `${papel}.${n}.${sufixo}@ao.teste`,
        senha_hash: 'x',
        papel,
        profissional_id: profissionalId,
      },
    });
  const profissional = await prisma.profissional.create({
    data: { clinica_id: clinica.id, nome: 'Dra. Online Teste', duracao_consulta_min: 30 },
  });
  const oculto = await prisma.profissional.create({
    data: { clinica_id: clinica.id, nome: 'Dr. Oculto', agendamento_online: false },
  });
  for (const p of [profissional, oculto]) {
    await prisma.profissionalHorario.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        clinica_id: clinica.id,
        profissional_id: p.id,
        dia_semana: d,
        hora_inicio: '08:00',
        hora_fim: '18:00',
      })),
    });
  }
  const admin = await mkUsuario('admin');
  const recepcao = await mkUsuario('recepcao');
  const usuarioProf = await mkUsuario('profissional', profissional.id);
  const token = (u: { id: string; papel: PapelUsuario; profissional_id: string | null }) =>
    assinarTokenClinica(app, { usuarioId: u.id, clinicaId: clinica.id, papel: u.papel, profissionalId: u.profissional_id });
  return {
    clinica,
    slug,
    profissional,
    oculto,
    tokenAdmin: token(admin),
    tokenRecepcao: token(recepcao),
    tokenProfissional: token(usuarioProf),
  };
}
type Clin = Awaited<ReturnType<typeof criarClinica>>;

function solicitar(c: Clin, corpo: Record<string, unknown>, ip = ipUnico()) {
  return app.inject({
    method: 'POST',
    url: `/publico/clinicas/${c.slug}/solicitacoes`,
    remoteAddress: ip,
    payload: {
      profissional_id: c.profissional.id,
      nome: 'Maria Visitante',
      telefone: telefoneUnico(),
      aceita_whatsapp: true,
      ...corpo,
    },
  });
}

function comToken(token: string) {
  return { authorization: `Bearer ${token}` };
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

// ----------------------------------------------------------------------------- públicas

describe('rotas públicas', () => {
  it('dados da clínica só com profissionais visíveis e sem dados sensíveis', async () => {
    const c = await criarClinica();
    const r = await app.inject({ method: 'GET', url: `/publico/clinicas/${c.slug}`, remoteAddress: ipUnico() });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.clinica.nome).toBe(c.clinica.nome);
    expect(b.clinica).not.toHaveProperty('documento');
    expect(b.clinica).not.toHaveProperty('id');
    expect(b.profissionais.map((p: { id: string }) => p.id)).toEqual([c.profissional.id]);
    expect(b.dias_a_frente).toBe(30);
  });

  it('disponibilidade só devolve horários, sem ocupados por agendamento ou solicitação pendente', async () => {
    const c = await criarClinica();
    const d = dia(3);
    const paciente = await prisma.paciente.create({
      data: { clinica_id: c.clinica.id, nome: 'Paciente Secreto Sigiloso', cpf: '52998224725' },
    });
    await prisma.agendamento.create({
      data: {
        clinica_id: c.clinica.id,
        paciente_id: paciente.id,
        profissional_id: c.profissional.id,
        inicio: instante(d, '10:00'),
        fim: instante(d, '10:30'),
        observacoes: 'Observação sigilosa',
      },
    });
    const s = await solicitar(c, { inicio: instante(d, '11:00').toISOString(), nome: 'Visitante Pendente' });
    expect(s.statusCode).toBe(201);

    const r = await app.inject({
      method: 'GET',
      url: `/publico/clinicas/${c.slug}/disponibilidade?profissional_id=${c.profissional.id}&data=${d}`,
      remoteAddress: ipUnico(),
    });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(Object.keys(b).sort()).toEqual(['data', 'fuso', 'horarios']);
    for (const h of b.horarios) expect(Object.keys(h).sort()).toEqual(['fim', 'hora', 'inicio']);
    const horas = b.horarios.map((h: { hora: string }) => h.hora);
    expect(horas).toContain('08:00');
    expect(horas).toContain('10:30');
    expect(horas).not.toContain('10:00');
    expect(horas).not.toContain('11:00');
    expect(r.body).not.toContain('Sigiloso');
    expect(r.body).not.toContain('Visitante');
    expect(r.body).not.toContain('52998224725');

    // fora da janela (dias à frente) e profissional oculto
    const longe = await app.inject({
      method: 'GET',
      url: `/publico/clinicas/${c.slug}/disponibilidade?profissional_id=${c.profissional.id}&data=${dia(40)}`,
      remoteAddress: ipUnico(),
    });
    expect(longe.json().horarios).toEqual([]);
    const oculto = await app.inject({
      method: 'GET',
      url: `/publico/clinicas/${c.slug}/disponibilidade?profissional_id=${c.oculto.id}&data=${d}`,
      remoteAddress: ipUnico(),
    });
    expect(oculto.statusCode).toBe(404);
  });

  it('respeita a antecedência mínima', async () => {
    const c = await criarClinica();
    await prisma.configuracaoClinica.update({ where: { clinica_id: c.clinica.id }, data: { ao_antecedencia_min_horas: 168 } });
    const r = await app.inject({
      method: 'GET',
      url: `/publico/clinicas/${c.slug}/disponibilidade?profissional_id=${c.profissional.id}&data=${dia(3)}`,
      remoteAddress: ipUnico(),
    });
    expect(r.json().horarios).toEqual([]);
  });

  it('clínica sem recurso, desligada, com assinatura vencida ou slug inexistente ⇒ 404', async () => {
    const semRecurso = await criarClinica({ plano: (await criarPlano({ max_agendamentos: ilimitado })).id });
    const desligada = await criarClinica({ ativo: false });
    const vencida = await criarClinica({ statusAssinatura: 'vencida' });
    for (const slug of [semRecurso.slug, desligada.slug, vencida.slug, `nao-existe-${sufixo}`]) {
      const r = await app.inject({ method: 'GET', url: `/publico/clinicas/${slug}`, remoteAddress: ipUnico() });
      expect(r.statusCode).toBe(404);
      expect(r.json().erro).toBe('agendamento_indisponivel');
    }
    const post = await solicitar(desligada, { inicio: instante(dia(3), '09:00').toISOString() });
    expect(post.statusCode).toBe(404);
  });

  it('revalida o horário, honeypot, limite por telefone e rate limit', async () => {
    const c = await criarClinica();
    const d = dia(4);
    const tel = telefoneUnico();

    const ok = await solicitar(c, { inicio: instante(d, '09:00').toISOString(), telefone: tel, cpf: '529.982.247-25' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'pendente', profissional: { nome: 'Dra. Online Teste' } });

    // mesmo horário (pendente) e horário fora da grade de slots
    const ocupado = await solicitar(c, { inicio: instante(d, '09:00').toISOString() });
    expect(ocupado.statusCode).toBe(409);
    expect(ocupado.json().erro).toBe('horario_indisponivel');
    const quebrado = await solicitar(c, { inicio: instante(d, '09:15').toISOString() });
    expect(quebrado.json().erro).toBe('horario_indisponivel');

    // honeypot: 201 falso, nada gravado
    const antes = await prisma.solicitacaoAgendamento.count({ where: { clinica_id: c.clinica.id } });
    const robo = await solicitar(c, { inicio: instante(d, '13:00').toISOString(), website: 'http://spam' });
    expect(robo.statusCode).toBe(201);
    expect(await prisma.solicitacaoAgendamento.count({ where: { clinica_id: c.clinica.id } })).toBe(antes);

    // limite de pendentes por telefone (padrão 2)
    expect((await solicitar(c, { inicio: instante(d, '10:00').toISOString(), telefone: tel })).statusCode).toBe(201);
    const terceira = await solicitar(c, { inicio: instante(d, '11:00').toISOString(), telefone: tel });
    expect(terceira.statusCode).toBe(409);
    expect(terceira.json().erro).toBe('limite_solicitacoes');

    // validação
    const invalida = await solicitar(c, { inicio: instante(d, '14:00').toISOString(), cpf: '111.111.111-11' });
    expect(invalida.statusCode).toBe(400);

    // rate limit: 5 por minuto por IP
    const ip = ipUnico();
    const codigos: number[] = [];
    for (let i = 0; i < 6; i++) {
      codigos.push((await solicitar(c, { inicio: instante(d, '15:00').toISOString(), website: 'x' }, ip)).statusCode);
    }
    expect(codigos.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(codigos[5]).toBe(429);

    // grava ip e user-agent
    const gravada = await prisma.solicitacaoAgendamento.findUniqueOrThrow({ where: { id: ok.json().id } });
    expect(gravada.ip).toBeTruthy();
    expect(gravada.cpf).toBe('52998224725');
    expect(gravada.telefone.startsWith('55')).toBe(true);
  });
});

// ----------------------------------------------------------------------------- internas

describe('solicitações (recepção)', () => {
  it('lista, resumo e detalhe com pacientes candidatos', async () => {
    const c = await criarClinica();
    const tel = telefoneUnico();
    const existente = await prisma.paciente.create({
      data: { clinica_id: c.clinica.id, nome: 'João Existente', whatsapp: `55${tel}`, aceita_whatsapp: true },
    });
    const s = await solicitar(c, { inicio: instante(dia(5), '09:00').toISOString(), telefone: tel });
    const id = s.json().id;

    const resumo = await app.inject({ method: 'GET', url: '/solicitacoes/resumo', headers: comToken(c.tokenRecepcao) });
    expect(resumo.json()).toEqual({ pendentes: 1 });
    const lista = await app.inject({ method: 'GET', url: '/solicitacoes?status=pendente', headers: comToken(c.tokenRecepcao) });
    expect(lista.json()).toMatchObject({ total: 1, pagina: 1 });
    expect(lista.json().itens[0].profissional.nome).toBe('Dra. Online Teste');
    const det = await app.inject({ method: 'GET', url: `/solicitacoes/${id}`, headers: comToken(c.tokenAdmin) });
    expect(det.json().pacientes_candidatos).toEqual([expect.objectContaining({ id: existente.id, motivo: 'telefone' })]);

    const prof = await app.inject({ method: 'GET', url: '/solicitacoes', headers: comToken(c.tokenProfissional) });
    expect(prof.statusCode).toBe(403);
  });

  it('aprovação cria paciente + agendamento, consome o limite e enfileira WhatsApp com consentimento', async () => {
    const plano = await criarPlano({ ...recursosPadrao, max_agendamentos: { habilitado: true, limite: 1, periodo: 'total' } });
    const c = await criarClinica({ plano: plano.id });
    const d = dia(6);
    const s1 = (await solicitar(c, { inicio: instante(d, '09:00').toISOString(), nome: 'Ana Aprovada', cpf: '52998224725', email: 'ana@teste.com' })).json();
    const s2 = (await solicitar(c, { inicio: instante(d, '10:00').toISOString() })).json();

    const r = await app.inject({
      method: 'POST',
      url: `/solicitacoes/${s1.id}/aprovar`,
      headers: comToken(c.tokenRecepcao),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.solicitacao.status).toBe('aprovada');
    expect(b.paciente_criado).toBe(true);
    expect(b.whatsapp).toEqual({ enfileirada: true });
    expect(jobs).toHaveLength(1);

    const ag = await prisma.agendamento.findUniqueOrThrow({ where: { id: b.agendamento_id }, include: { paciente: true } });
    expect(ag.inicio.toISOString()).toBe(s1.inicio);
    expect(ag.paciente.nome).toBe('Ana Aprovada');
    expect(ag.paciente.cpf).toBe('52998224725');
    expect(ag.paciente.aceita_whatsapp).toBe(true);
    const msg = await prisma.mensagemWhatsapp.findFirstOrThrow({ where: { clinica_id: c.clinica.id, tipo: 'agendamento_confirmado' } });
    expect(msg.agendamento_id).toBe(b.agendamento_id);
    expect(msg.conteudo).toContain('agendada');

    // limite do plano (1 agendamento) atingido
    const r2 = await app.inject({ method: 'POST', url: `/solicitacoes/${s2.id}/aprovar`, headers: comToken(c.tokenAdmin), payload: {} });
    expect(r2.statusCode).toBe(403);
    expect(r2.json().erro).toBe('limite_atingido');
    expect((await prisma.solicitacaoAgendamento.findUniqueOrThrow({ where: { id: s2.id } })).status).toBe('pendente');

    // já analisada
    const r3 = await app.inject({ method: 'POST', url: `/solicitacoes/${s1.id}/aprovar`, headers: comToken(c.tokenAdmin), payload: {} });
    expect(r3.statusCode).toBe(409);
  });

  it('sem consentimento não enfileira; paciente escolhido é usado', async () => {
    const c = await criarClinica();
    const existente = await prisma.paciente.create({ data: { clinica_id: c.clinica.id, nome: 'Paciente Escolhido' } });
    const s = (await solicitar(c, { inicio: instante(dia(7), '09:00').toISOString(), aceita_whatsapp: false })).json();
    const r = await app.inject({
      method: 'POST',
      url: `/solicitacoes/${s.id}/aprovar`,
      headers: comToken(c.tokenAdmin),
      payload: { paciente_id: existente.id },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ paciente_id: existente.id, paciente_criado: false, whatsapp: null });
    expect(jobs).toHaveLength(0);
    expect(await prisma.mensagemWhatsapp.count({ where: { clinica_id: c.clinica.id } })).toBe(0);
  });

  it('aprovação em horário que ficou ocupado ⇒ 409', async () => {
    const c = await criarClinica();
    const d = dia(8);
    const s = (await solicitar(c, { inicio: instante(d, '09:00').toISOString() })).json();
    const pac = await prisma.paciente.create({ data: { clinica_id: c.clinica.id, nome: 'Encaixado' } });
    await prisma.agendamento.create({
      data: {
        clinica_id: c.clinica.id,
        paciente_id: pac.id,
        profissional_id: c.profissional.id,
        inicio: instante(d, '09:00'),
        fim: instante(d, '09:30'),
      },
    });
    const r = await app.inject({ method: 'POST', url: `/solicitacoes/${s.id}/aprovar`, headers: comToken(c.tokenAdmin), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toBe('horario_ocupado');
    expect((await prisma.solicitacaoAgendamento.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('pendente');
  });

  it('recusa com motivo envia WhatsApp sem paciente (consentimento externo)', async () => {
    const c = await criarClinica();
    const s = (await solicitar(c, { inicio: instante(dia(9), '09:00').toISOString(), nome: 'Rui Recusado' })).json();
    const r = await app.inject({
      method: 'POST',
      url: `/solicitacoes/${s.id}/recusar`,
      headers: comToken(c.tokenRecepcao),
      payload: { motivo: 'Profissional em congresso' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().solicitacao).toMatchObject({ status: 'recusada', motivo_recusa: 'Profissional em congresso' });
    expect(r.json().whatsapp).toEqual({ enfileirada: true });
    const msg = await prisma.mensagemWhatsapp.findFirstOrThrow({ where: { clinica_id: c.clinica.id } });
    expect(msg).toMatchObject({ tipo: 'agendamento_recusado', paciente_id: null, consentimento_externo: true });
    expect(msg.conteudo).toContain('Profissional em congresso');
    expect(msg.conteudo).toContain(`/agendar/${c.slug}`);

    const denovo = await app.inject({ method: 'POST', url: `/solicitacoes/${s.id}/recusar`, headers: comToken(c.tokenRecepcao), payload: {} });
    expect(denovo.statusCode).toBe(409);
  });

  it('isolamento: não aprova nem vê solicitação de outra clínica', async () => {
    const a = await criarClinica();
    const b = await criarClinica();
    const s = (await solicitar(a, { inicio: instante(dia(10), '09:00').toISOString() })).json();
    const ver = await app.inject({ method: 'GET', url: `/solicitacoes/${s.id}`, headers: comToken(b.tokenAdmin) });
    expect(ver.statusCode).toBe(404);
    const aprovar = await app.inject({ method: 'POST', url: `/solicitacoes/${s.id}/aprovar`, headers: comToken(b.tokenAdmin), payload: {} });
    expect(aprovar.statusCode).toBe(404);
    const recusar = await app.inject({ method: 'POST', url: `/solicitacoes/${s.id}/recusar`, headers: comToken(b.tokenAdmin), payload: {} });
    expect(recusar.statusCode).toBe(404);
    expect((await prisma.solicitacaoAgendamento.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('pendente');
  });

  it('configuração (admin) e profissionais visíveis', async () => {
    const c = await criarClinica();
    const get = await app.inject({ method: 'GET', url: '/agendamento-online/configuracao', headers: comToken(c.tokenAdmin) });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ ativo: true, slug: c.slug });
    expect(get.json().link_publico).toMatch(new RegExp(`/agendar/${c.slug}$`));

    const put = await app.inject({
      method: 'PUT',
      url: '/agendamento-online/configuracao',
      headers: comToken(c.tokenAdmin),
      payload: { dias_a_frente: 60, mensagem_boas_vindas: 'Bem-vindo!', profissionais_visiveis: [c.oculto.id] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ dias_a_frente: 60, mensagem_boas_vindas: 'Bem-vindo!' });
    const vis = put.json().profissionais.filter((p: { agendamento_online: boolean }) => p.agendamento_online);
    expect(vis.map((p: { id: string }) => p.id)).toEqual([c.oculto.id]);

    const recep = await app.inject({ method: 'GET', url: '/agendamento-online/configuracao', headers: comToken(c.tokenRecepcao) });
    expect(recep.statusCode).toBe(403);
    const invalido = await app.inject({
      method: 'PUT',
      url: '/agendamento-online/configuracao',
      headers: comToken(c.tokenAdmin),
      payload: { profissionais_visiveis: [randomUUID()] },
    });
    expect(invalido.statusCode).toBe(404);
  });

  it('worker expira pendentes cujo horário passou', async () => {
    const c = await criarClinica();
    const passado = await prisma.solicitacaoAgendamento.create({
      data: {
        clinica_id: c.clinica.id,
        profissional_id: c.profissional.id,
        inicio: new Date(Date.now() - 3_600_000),
        fim: new Date(Date.now() - 1_800_000),
        nome: 'Atrasado',
        telefone: `55${telefoneUnico()}`,
      },
    });
    const futuro = (await solicitar(c, { inicio: instante(dia(3), '09:00').toISOString() })).json();
    const r = await expirarSolicitacoes({ clinicaId: c.clinica.id });
    expect(r.processadas).toBe(1);
    expect((await prisma.solicitacaoAgendamento.findUniqueOrThrow({ where: { id: passado.id } })).status).toBe('expirada');
    expect((await prisma.solicitacaoAgendamento.findUniqueOrThrow({ where: { id: futuro.id } })).status).toBe('pendente');
    expect((await expirarSolicitacoes({ clinicaId: c.clinica.id })).processadas).toBe(0);
  });
});
