/**
 * Regressão das correções de segurança (auditoria):
 *   vínculo profissional–paciente (prontuário, anexos, alergias/medicações), troca de paciente no
 *   agendamento, profissional inativo, troca de senha (senha_atual + invalidação de tokens),
 *   validação de segredos do env, TRUST_PROXY, máscara do token no log e bcrypt falso no login.
 * Cria os PRÓPRIOS dados (nomes únicos) — sem truncate.
 */
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PapelUsuario } from '@prisma/client';
import { buildApp, mascararSegredosUrl, type App } from '../src/app';
import { interpretarTrustProxy, problemasDeSeguranca, validarSegurancaEnv } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';
import { gerarHashSenha } from '../src/utils/senha';

const U = randomUUID().slice(0, 8);
const FUSO = 'America/Sao_Paulo';
const SENHA = 'senha-antiga-123';
let app: App;

type Usuario = { id: string; token: string };
let clinicaId: string;
let planoId: string;
let admin: Usuario;
let recepcao: Usuario;
let prof: Usuario & { profissionalId: string };
let adminProf: Usuario & { profissionalId: string };
let outroUsuario: Usuario;

const h = (token: string) => ({ authorization: `Bearer ${token}` });

let seq = 0;
async function criarUsuario(papel: PapelUsuario, profissionalId: string | null = null): Promise<Usuario> {
  const u = await prisma.usuario.create({
    data: {
      clinica_id: clinicaId,
      nome: `${papel} ${++seq} ${U}`,
      email: `${papel}.${seq}.${U}@seguranca.local`,
      senha_hash: await gerarHashSenha(SENHA),
      papel,
      profissional_id: profissionalId,
    },
  });
  return { id: u.id, token: assinarTokenClinica(app, { usuarioId: u.id, clinicaId, papel, profissionalId }) };
}

async function criarPaciente(nome: string) {
  return prisma.paciente.create({ data: { clinica_id: clinicaId, nome: `${nome} ${U}` } });
}

/** Amanhã às `hora` no fuso da clínica. */
function amanha(hora: string) {
  const dia = formatInTimeZone(addDays(new Date(), 1), FUSO, 'yyyy-MM-dd');
  return fromZonedTime(`${dia}T${hora}:00`, FUSO).toISOString();
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  const plano = await prisma.plano.create({
    data: {
      nome: `Plano segurança ${U}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({ recurso_codigo: r.codigo, habilitado: true, limite: null, periodo: 'total' as const })),
      },
    },
  });
  planoId = plano.id;
  const clinica = await prisma.clinica.create({
    data: { nome: `Clínica Segurança ${U}`, documento: `7${Date.now()}${Math.floor(Math.random() * 1e5)}`.slice(0, 14) },
  });
  clinicaId = clinica.id;
  await prisma.assinatura.create({ data: { clinica_id: clinicaId, plano_id: planoId, status: 'ativa' } });

  const p1 = await prisma.profissional.create({ data: { clinica_id: clinicaId, nome: `Dra. Segura ${U}` } });
  const p2 = await prisma.profissional.create({ data: { clinica_id: clinicaId, nome: `Dr. Admin ${U}` } });
  // Grade de todos os dias (06–22 h) para o profissional poder agendar pela API.
  for (let dia = 0; dia < 7; dia++) {
    await prisma.profissionalHorario.create({
      data: { clinica_id: clinicaId, profissional_id: p1.id, dia_semana: dia, hora_inicio: '06:00', hora_fim: '22:00' },
    });
  }
  admin = await criarUsuario('admin');
  recepcao = await criarUsuario('recepcao');
  prof = { ...(await criarUsuario('profissional', p1.id)), profissionalId: p1.id };
  adminProf = { ...(await criarUsuario('admin', p2.id)), profissionalId: p2.id };
  outroUsuario = await criarUsuario('recepcao');
});

afterAll(async () => {
  await app?.close();
  if (clinicaId) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.permitir_exclusao_prontuario = 'on'`);
      await tx.prontuarioRegistro.deleteMany({ where: { clinica_id: clinicaId } });
      await tx.agendamento.deleteMany({ where: { clinica_id: clinicaId } });
      await tx.clinica.deleteMany({ where: { id: clinicaId } });
    });
  }
  if (planoId) await prisma.plano.deleteMany({ where: { id: planoId } });
  await prisma.$disconnect();
});

// ----------------------------------------------------------------------------- item 1 e 3

describe('vínculo profissional–paciente', () => {
  it('profissional que agenda paciente alheio NÃO ganha acesso a prontuário, anexos nem alergias', async () => {
    const alheio = await criarPaciente('Paciente alheio');
    await prisma.pacienteAlergia.create({ data: { clinica_id: clinicaId, paciente_id: alheio.id, descricao: 'Iodo' } });

    const ag = await app.inject({
      method: 'POST',
      url: '/agendamentos',
      headers: h(prof.token),
      payload: { paciente_id: alheio.id, profissional_id: prof.profissionalId, inicio: amanha('10:00') },
    });
    expect(ag.statusCode).toBe(201);

    const pront = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${alheio.id}`, headers: h(prof.token) });
    expect(pront.statusCode).toBe(403);
    expect(pront.json().erro).toBe('paciente_nao_vinculado');
    const escrever = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${alheio.id}`,
      headers: h(prof.token),
      payload: { texto: 'Tentativa' },
    });
    expect(escrever.statusCode).toBe(403);
    const anexos = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${alheio.id}/anexos`, headers: h(prof.token) });
    expect(anexos.statusCode).toBe(403);

    // Alergias/medicações (item 3): dados cadastrais sim, clínicos não.
    const det = await app.inject({ method: 'GET', url: `/pacientes/${alheio.id}`, headers: h(prof.token) });
    expect(det.statusCode).toBe(200);
    expect(det.json()).toMatchObject({ nome: `Paciente alheio ${U}`, alergias: null, medicacoes: null });
    const novaAlergia = await app.inject({
      method: 'POST',
      url: `/pacientes/${alheio.id}/alergias`,
      headers: h(prof.token),
      payload: { descricao: 'Látex' },
    });
    expect(novaAlergia.statusCode).toBe(403);
    const alergia = await prisma.pacienteAlergia.findFirstOrThrow({ where: { paciente_id: alheio.id } });
    for (const req of [
      { method: 'PUT' as const, url: `/pacientes/${alheio.id}/alergias/${alergia.id}`, payload: { descricao: 'Alterada' } },
      { method: 'DELETE' as const, url: `/pacientes/${alheio.id}/alergias/${alergia.id}` },
      { method: 'POST' as const, url: `/pacientes/${alheio.id}/medicacoes`, payload: { nome: 'Losartana' } },
    ]) {
      const r = await app.inject({ ...req, headers: h(prof.token) });
      expect(r.statusCode).toBe(403);
    }
    expect((await prisma.pacienteAlergia.findUniqueOrThrow({ where: { id: alergia.id } })).descricao).toBe('Iodo');

    // Marcar "compareceu" num agendamento próprio FUTURO também não libera (só após o horário).
    const st = await app.inject({
      method: 'PATCH',
      url: `/agendamentos/${ag.json().id}/status`,
      headers: h(prof.token),
      payload: { status: 'compareceu' },
    });
    expect(st.statusCode).toBe(200);
    const pront2 = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${alheio.id}`, headers: h(prof.token) });
    expect(pront2.statusCode).toBe(403);

    // Admin continua vendo tudo.
    const detAdmin = await app.inject({ method: 'GET', url: `/pacientes/${alheio.id}`, headers: h(admin.token) });
    expect(detAdmin.json().alergias).toMatchObject([{ descricao: 'Iodo' }]);
  });

  it('agendamento próprio com atendimento já realizado (compareceu, horário passado) libera o acesso', async () => {
    const pac = await criarPaciente('Atendido pelo próprio');
    await prisma.agendamento.create({
      data: {
        clinica_id: clinicaId,
        paciente_id: pac.id,
        profissional_id: prof.profissionalId,
        inicio: new Date(Date.now() - 3_600_000),
        fim: new Date(Date.now() - 1_800_000),
        status: 'compareceu',
        criado_por: prof.id,
      },
    });
    const r = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac.id}`, headers: h(prof.token) });
    expect(r.statusCode).toBe(200);
  });

  it('agendamento criado pela recepção para o profissional libera o acesso; cancelado não', async () => {
    const pac = await criarPaciente('Agendado pela recepção');
    const ag = await app.inject({
      method: 'POST',
      url: '/agendamentos',
      headers: h(recepcao.token),
      payload: { paciente_id: pac.id, profissional_id: prof.profissionalId, inicio: amanha('11:00') },
    });
    expect(ag.statusCode).toBe(201);
    const pront = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac.id}`, headers: h(prof.token) });
    expect(pront.statusCode).toBe(200);
    const anexos = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac.id}/anexos`, headers: h(prof.token) });
    expect(anexos.statusCode).toBe(200);
    const det = await app.inject({ method: 'GET', url: `/pacientes/${pac.id}`, headers: h(prof.token) });
    expect(det.json().alergias).toEqual([]);
    const alergia = await app.inject({
      method: 'POST',
      url: `/pacientes/${pac.id}/alergias`,
      headers: h(prof.token),
      payload: { descricao: 'Dipirona' },
    });
    expect(alergia.statusCode).toBe(201);

    const cancelar = await app.inject({
      method: 'PATCH',
      url: `/agendamentos/${ag.json().id}/status`,
      headers: h(recepcao.token),
      payload: { status: 'cancelado' },
    });
    expect(cancelar.statusCode).toBe(200);
    const semVinculo = await criarPaciente('Só cancelado');
    await prisma.agendamento.create({
      data: {
        clinica_id: clinicaId,
        paciente_id: semVinculo.id,
        profissional_id: prof.profissionalId,
        inicio: new Date(),
        fim: new Date(),
        status: 'cancelado',
        criado_por: recepcao.id,
      },
    });
    const r = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${semVinculo.id}`, headers: h(prof.token) });
    expect(r.statusCode).toBe(403);
  });

  it('PUT /agendamentos/:id: profissional não troca o paciente (403); ninguém troca após o atendimento (409)', async () => {
    const vinculado = await criarPaciente('Vinculado');
    const alvo = await criarPaciente('Alvo');
    const ag = await app.inject({
      method: 'POST',
      url: '/agendamentos',
      headers: h(recepcao.token),
      payload: { paciente_id: vinculado.id, profissional_id: prof.profissionalId, inicio: amanha('12:00') },
    });
    expect(ag.statusCode).toBe(201);
    const id = ag.json().id;

    const troca = await app.inject({ method: 'PUT', url: `/agendamentos/${id}`, headers: h(prof.token), payload: { paciente_id: alvo.id } });
    expect(troca.statusCode).toBe(403);
    expect(troca.json().erro).toBe('troca_paciente_proibida');
    expect((await prisma.agendamento.findUniqueOrThrow({ where: { id } })).paciente_id).toBe(vinculado.id);
    const pront = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${alvo.id}`, headers: h(prof.token) });
    expect(pront.statusCode).toBe(403);

    // Profissional pode editar outros campos do próprio agendamento.
    const obs = await app.inject({ method: 'PUT', url: `/agendamentos/${id}`, headers: h(prof.token), payload: { observacoes: 'Ok' } });
    expect(obs.statusCode).toBe(200);

    await app.inject({ method: 'PATCH', url: `/agendamentos/${id}/status`, headers: h(recepcao.token), payload: { status: 'compareceu' } });
    const depois = await app.inject({ method: 'PUT', url: `/agendamentos/${id}`, headers: h(recepcao.token), payload: { paciente_id: alvo.id } });
    expect(depois.statusCode).toBe(409);
    expect(depois.json().erro).toBe('troca_paciente_proibida');
  });
});

// ----------------------------------------------------------------------------- item 9

describe('profissional inativo', () => {
  it('usuário vinculado a profissional inativo não lê nem escreve prontuário/anexos', async () => {
    const pac = await criarPaciente('Do inativo');
    await prisma.agendamento.create({
      data: { clinica_id: clinicaId, paciente_id: pac.id, profissional_id: prof.profissionalId, inicio: new Date(), fim: new Date() },
    });
    expect((await app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac.id}`, headers: h(prof.token) })).statusCode).toBe(200);

    await prisma.profissional.update({ where: { id: prof.profissionalId }, data: { ativo: false } });
    await prisma.profissional.update({ where: { id: adminProf.profissionalId }, data: { ativo: false } });
    try {
      const reqs = [
        app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac.id}`, headers: h(prof.token) }),
        app.inject({ method: 'POST', url: `/prontuario/pacientes/${pac.id}`, headers: h(prof.token), payload: { texto: 'x' } }),
        app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac.id}/anexos`, headers: h(prof.token) }),
        // admin vinculado a profissional inativo não escreve em nome dele
        app.inject({ method: 'POST', url: `/prontuario/pacientes/${pac.id}`, headers: h(adminProf.token), payload: { texto: 'x' } }),
      ];
      for (const r of await Promise.all(reqs)) {
        expect(r.statusCode).toBe(403);
        expect(r.json().erro).toBe('profissional_inativo');
      }
      const det = await app.inject({ method: 'GET', url: `/pacientes/${pac.id}`, headers: h(prof.token) });
      expect(det.json().alergias).toBeNull();
      expect(await prisma.prontuarioRegistro.count({ where: { paciente_id: pac.id } })).toBe(0);
    } finally {
      await prisma.profissional.updateMany({
        where: { id: { in: [prof.profissionalId, adminProf.profissionalId] } },
        data: { ativo: true },
      });
    }
  });
});

// ----------------------------------------------------------------------------- item 8

describe('troca de senha', () => {
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('admin trocando a PRÓPRIA senha precisa da senha atual; tokens antigos deixam de valer', async () => {
    const semAtual = await app.inject({ method: 'PUT', url: `/usuarios/${admin.id}/senha`, headers: h(admin.token), payload: { senha: 'nova-senha-1' } });
    expect(semAtual.statusCode).toBe(400);
    expect(semAtual.json().erro).toBe('senha_atual_invalida');
    const errada = await app.inject({
      method: 'PUT',
      url: `/usuarios/${admin.id}/senha`,
      headers: h(admin.token),
      payload: { senha: 'nova-senha-1', senha_atual: 'errada' },
    });
    expect(errada.statusCode).toBe(400);

    await espera(1100); // iat tem resolução de segundos
    const ok = await app.inject({
      method: 'PUT',
      url: `/usuarios/${admin.id}/senha`,
      headers: h(admin.token),
      payload: { senha: 'nova-senha-1', senha_atual: SENHA },
    });
    expect(ok.statusCode).toBe(200);
    const novoToken = ok.json().token as string;
    expect(novoToken).toBeTruthy();

    expect((await app.inject({ method: 'GET', url: '/me', headers: h(admin.token) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/me', headers: h(novoToken) })).statusCode).toBe(200);
    admin = { ...admin, token: novoToken };
  });

  it('admin redefine a senha de OUTRO usuário sem senha atual; o token antigo dele é invalidado', async () => {
    expect((await app.inject({ method: 'GET', url: '/me', headers: h(outroUsuario.token) })).statusCode).toBe(200);
    await espera(1100);
    const r = await app.inject({
      method: 'PUT',
      url: `/usuarios/${outroUsuario.id}/senha`,
      headers: h(admin.token),
      payload: { senha: 'redefinida-1' },
    });
    expect(r.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/me', headers: h(outroUsuario.token) })).statusCode).toBe(401);
  });

  it('não-admin não redefine senha de outro usuário', async () => {
    const r = await app.inject({ method: 'PUT', url: `/usuarios/${admin.id}/senha`, headers: h(recepcao.token), payload: { senha: 'hack123' } });
    expect(r.statusCode).toBe(403);
  });
});

// ----------------------------------------------------------------------------- item 6

describe('validação de segredos do ambiente', () => {
  const forte = 'a'.repeat(16) + 'b'.repeat(16) + 'c';
  const bom = { JWT_SECRET: forte, WEBHOOK_TOKEN: forte, WPPCONNECT_SECRET_KEY: forte, REDIS_URL: 'redis://:s3nh4@redis:6379' };

  it('aceita segredos longos e Redis com senha', () => {
    expect(problemasDeSeguranca(bom)).toEqual([]);
    expect(() => validarSegurancaEnv({ ...bom, NODE_ENV: 'production' })).not.toThrow();
  });

  it('recusa segredo curto, valor de exemplo e Redis sem senha', () => {
    const problemas = problemasDeSeguranca({
      JWT_SECRET: 'troque-por-uma-string-longa-e-aleatoria-com-32+-caracteres',
      WEBHOOK_TOKEN: 'curto',
      WPPCONNECT_SECRET_KEY: 'CHANGEME'.repeat(5),
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(problemas.join('\n')).toMatch(/JWT_SECRET parece um valor de exemplo/);
    expect(problemas.join('\n')).toMatch(/WEBHOOK_TOKEN deve ter pelo menos 32/);
    expect(problemas.join('\n')).toMatch(/WPPCONNECT_SECRET_KEY parece um valor de exemplo \(contém "changeme"\)/);
    expect(problemas.join('\n')).toMatch(/REDIS_URL deve incluir senha/);
    expect(problemasDeSeguranca({ ...bom, JWT_SECRET: `exemplo-${forte}` })).toHaveLength(1);
  });

  it('produção lança erro; desenvolvimento só avisa', () => {
    const fraco = { ...bom, REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'production' };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() => validarSegurancaEnv(fraco)).toThrow(/insegura/);
      expect(() => validarSegurancaEnv({ ...fraco, NODE_ENV: 'development' })).not.toThrow();
      expect(aviso).toHaveBeenCalledTimes(1);
    } finally {
      erro.mockRestore();
      aviso.mockRestore();
    }
  });
});

// ----------------------------------------------------------------------------- item 7

describe('TRUST_PROXY', () => {
  it('interpreta os valores', () => {
    expect(interpretarTrustProxy('false')).toBe(false);
    expect(interpretarTrustProxy('')).toBe(false);
    expect(interpretarTrustProxy('true')).toBe(true);
    expect(interpretarTrustProxy('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8, 127.0.0.1');
    const umSalto = interpretarTrustProxy('1') as (a: string, i: number) => boolean;
    expect(umSalto('172.18.0.5', 0)).toBe(true);
    expect(umSalto('1.2.3.4', 1)).toBe(false);
  });

  it('padrão (sem TRUST_PROXY): X-Forwarded-For é ignorado', async () => {
    const a = await buildApp();
    a.get('/teste-ip', async (request) => ({ ip: request.ip }));
    await a.ready();
    try {
      const r = await a.inject({ method: 'GET', url: '/teste-ip', headers: { 'x-forwarded-for': '203.0.113.9' } });
      expect(r.json().ip).not.toBe('203.0.113.9');
    } finally {
      await a.close();
    }
  });
});

// ----------------------------------------------------------------------------- item 10

describe('log sem o token do webhook', () => {
  it('mascara token= na URL', () => {
    expect(mascararSegredosUrl('/webhooks/whatsapp?token=abc123&x=1')).toBe('/webhooks/whatsapp?token=***&x=1');
    expect(mascararSegredosUrl('/a?x=1&TOKEN=abc')).toBe('/a?x=1&TOKEN=***');
    expect(mascararSegredosUrl('/saude')).toBe('/saude');
  });

  it('o log da requisição não contém o token', async () => {
    const linhas: string[] = [];
    const stream = new Writable({
      write(pedaco, _enc, cb) {
        linhas.push(String(pedaco));
        cb();
      },
    });
    const a = await buildApp({ logger: { level: 'info', stream } });
    try {
      await a.inject({ method: 'POST', url: '/webhooks/whatsapp?token=segredo-do-webhook-XYZ', payload: {} });
    } finally {
      await a.close();
    }
    const log = linhas.join('');
    expect(log).toContain('token=***');
    expect(log).not.toContain('segredo-do-webhook-XYZ');
  });
});

// ----------------------------------------------------------------------------- item 11

describe('login sem enumeração por tempo', () => {
  async function medir(email: string) {
    const a = performance.now();
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'qualquer-senha' } });
    expect(r.statusCode).toBe(401);
    return performance.now() - a;
  }

  it('e-mail inexistente leva tempo comparável ao de um e-mail existente (bcrypt contra hash falso)', async () => {
    const existente = (await prisma.usuario.findUniqueOrThrow({ where: { id: recepcao.id } })).email;
    const inexistente = `ninguem.${U}@seguranca.local`;
    await medir(inexistente); // aquece
    let tExiste = 0;
    let tNaoExiste = 0;
    for (let i = 0; i < 3; i++) {
      tExiste += await medir(existente);
      tNaoExiste += await medir(inexistente);
    }
    // Sem o bcrypt falso o e-mail inexistente responde muito mais rápido (só a consulta ao banco).
    expect(tNaoExiste).toBeGreaterThan(tExiste * 0.4);
  });

  it('super admin: e-mail inexistente também passa pelo bcrypt', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/admin/login', payload: { email: `x.${U}@nada.local`, senha: 'abc' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().erro).toBe('credenciais_invalidas');
  });
});
