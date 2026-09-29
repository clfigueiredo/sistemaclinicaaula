/**
 * Testes do módulo prontuário + anexos. Cria os PRÓPRIOS dados (nomes únicos) — sem truncate.
 * Uploads vão para um diretório temporário do SO (env.UPLOAD_DIR_ABS é trocado antes do buildApp).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PapelUsuario } from '@prisma/client';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { buildApp, type App } from '../src/app';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';

const U = randomUUID().slice(0, 8);
const DIR_UPLOAD = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-anexos-'));
let app: App;

type Usuario = { id: string; token: string };
type Clinica = {
  id: string;
  planoId: string;
  admin: Usuario;
  recepcao: Usuario;
  prof1: Usuario & { profissionalId: string };
  prof2: Usuario & { profissionalId: string };
  pacienteDoProf1: string;
  pacienteSemVinculo: string;
};
let A: Clinica; // plano teste: 1 anexo
let B: Clinica; // ilimitado

async function criarUsuario(clinicaId: string, papel: PapelUsuario, rotulo: string, profissionalId: string | null = null) {
  const u = await prisma.usuario.create({
    data: {
      clinica_id: clinicaId,
      nome: `${rotulo} ${U}`,
      email: `${rotulo.replace(/\W/g, '')}.${randomUUID().slice(0, 6)}@teste.local`,
      senha_hash: 'x',
      papel,
      profissional_id: profissionalId,
    },
  });
  return {
    id: u.id,
    token: assinarTokenClinica(app, { usuarioId: u.id, clinicaId, papel, profissionalId }),
  };
}

async function criarClinica(rotulo: string, limiteAnexos: number | null): Promise<Clinica> {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  const plano = await prisma.plano.create({
    data: {
      nome: `Plano prontuário ${U} ${rotulo}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          habilitado: true,
          limite: r.codigo === 'max_anexos' ? limiteAnexos : null,
          periodo: 'total' as const,
        })),
      },
    },
  });
  const clinica = await prisma.clinica.create({
    data: { nome: `Clínica ${rotulo} ${U}`, documento: `8${Date.now()}${Math.floor(Math.random() * 1e6)}` },
  });
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: plano.id, status: 'teste' } });
  const p1 = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: `Dra. Um ${U}` } });
  const p2 = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: `Dr. Dois ${U}` } });
  const pac1 = await prisma.paciente.create({ data: { clinica_id: clinica.id, nome: `Paciente do Um ${U}` } });
  const pac2 = await prisma.paciente.create({ data: { clinica_id: clinica.id, nome: `Paciente sem vínculo ${U}` } });
  await prisma.agendamento.create({
    data: {
      clinica_id: clinica.id,
      paciente_id: pac1.id,
      profissional_id: p1.id,
      inicio: new Date(),
      fim: new Date(Date.now() + 30 * 60_000),
    },
  });
  return {
    id: clinica.id,
    planoId: plano.id,
    admin: await criarUsuario(clinica.id, 'admin', 'Admin'),
    recepcao: await criarUsuario(clinica.id, 'recepcao', 'Recepção'),
    prof1: { ...(await criarUsuario(clinica.id, 'profissional', 'Prof Um', p1.id)), profissionalId: p1.id },
    prof2: { ...(await criarUsuario(clinica.id, 'profissional', 'Prof Dois', p2.id)), profissionalId: p2.id },
    pacienteDoProf1: pac1.id,
    pacienteSemVinculo: pac2.id,
  };
}

const h = (token: string) => ({ authorization: `Bearer ${token}` });

function multipart(nomeArquivo: string, conteudo: Buffer, campos: Record<string, string> = {}) {
  const boundary = `----limite${randomUUID().replace(/-/g, '')}`;
  const partes: Buffer[] = [];
  for (const [k, v] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  partes.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${nomeArquivo}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    conteudo,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('conteudo de teste')]);
const PDF = Buffer.from('%PDF-1.4\n% teste\n');

async function enviar(token: string, pacienteId: string, nome: string, conteudo: Buffer, campos?: Record<string, string>) {
  const m = multipart(nome, conteudo, campos);
  return app.inject({
    method: 'POST',
    url: `/prontuario/pacientes/${pacienteId}/anexos`,
    headers: { ...h(token), ...m.headers },
    payload: m.payload,
  });
}

beforeAll(async () => {
  env.UPLOAD_DIR_ABS = DIR_UPLOAD;
  app = await buildApp();
  await app.ready();
  A = await criarClinica('A', 1);
  B = await criarClinica('B', null);
});

/**
 * Limpa só o que este arquivo criou. Registros de prontuário só podem ser apagados com a flag de sessão
 * `app.permitir_exclusao_prontuario` (trigger de imutabilidade); correções antes dos corrigidos (FK RESTRICT).
 */
async function limparClinicas(clinicas: Clinica[]) {
  const ids = clinicas.map((c) => c.id);
  if (!ids.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.permitir_exclusao_prontuario = 'on'`);
    await tx.anexo.deleteMany({ where: { clinica_id: { in: ids } } });
    for (let i = 0; i < 20; i++) {
      const r = await tx.prontuarioRegistro.deleteMany({ where: { clinica_id: { in: ids }, correcoes: { none: {} } } });
      if (r.count === 0) break;
    }
    await tx.agendamento.deleteMany({ where: { clinica_id: { in: ids } } });
    await tx.clinica.deleteMany({ where: { id: { in: ids } } });
    await tx.plano.deleteMany({ where: { id: { in: clinicas.map((c) => c.planoId) } } });
  });
}

afterAll(async () => {
  await app?.close();
  await limparClinicas([A, B].filter(Boolean));
  await prisma.$disconnect();
  fs.rmSync(DIR_UPLOAD, { recursive: true, force: true });
});

describe('prontuário: permissões', () => {
  it('recepção recebe 403 em todas as rotas do prontuário e anexos', async () => {
    const t = A.recepcao.token;
    const pac = A.pacienteDoProf1;
    const reqs = [
      app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac}`, headers: h(t) }),
      app.inject({ method: 'POST', url: `/prontuario/pacientes/${pac}`, headers: h(t), payload: { texto: 'x' } }),
      app.inject({ method: 'GET', url: `/prontuario/pacientes/${pac}/anexos`, headers: h(t) }),
      enviar(t, pac, 'exame.pdf', PDF),
      app.inject({ method: 'GET', url: `/prontuario/anexos/${randomUUID()}/download`, headers: h(t) }),
    ];
    for (const r of await Promise.all(reqs)) expect(r.statusCode).toBe(403);
  });

  it('profissional só acessa pacientes seus', async () => {
    const r = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${A.pacienteDoProf1}`, headers: h(A.prof2.token) });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('paciente_nao_vinculado');
    const r2 = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${A.pacienteSemVinculo}`,
      headers: h(A.prof1.token),
      payload: { texto: 'Tentativa' },
    });
    expect(r2.statusCode).toBe(403);
    const r3 = await enviar(A.prof2.token, A.pacienteDoProf1, 'x.pdf', PDF);
    expect(r3.statusCode).toBe(403);
  });

  it('admin sem vínculo lê, mas não escreve registro', async () => {
    const r = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${A.pacienteSemVinculo}`, headers: h(A.admin.token) });
    expect(r.statusCode).toBe(200);
    const w = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${A.pacienteSemVinculo}`,
      headers: h(A.admin.token),
      payload: { texto: 'Admin escrevendo' },
    });
    expect(w.statusCode).toBe(403);
    expect(w.json().erro).toBe('sem_profissional_vinculado');
  });

  it('isolamento: paciente de outra clínica → 404', async () => {
    const r = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${B.pacienteDoProf1}`, headers: h(A.admin.token) });
    expect(r.statusCode).toBe(404);
    const w = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${B.pacienteDoProf1}`,
      headers: h(A.prof1.token),
      payload: { texto: 'x' },
    });
    expect(w.statusCode).toBe(404);
  });
});

describe('prontuário: registros imutáveis', () => {
  let registroId: string;

  it('profissional cria registro sempre com o próprio profissional_id e gera log', async () => {
    const agendamento = await prisma.agendamento.findFirstOrThrow({ where: { paciente_id: A.pacienteDoProf1 } });
    const r = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${A.pacienteDoProf1}`,
      headers: h(A.prof1.token),
      payload: {
        texto: 'Paciente relata cefaleia há 3 dias.',
        agendamento_id: agendamento.id,
        profissional_id: A.prof2.profissionalId, // ignorado
      },
    });
    expect(r.statusCode).toBe(201);
    const reg = r.json();
    registroId = reg.id;
    expect(reg).toMatchObject({
      profissional_id: A.prof1.profissionalId,
      autor_id: A.prof1.id,
      agendamento_id: agendamento.id,
      profissional: { nome: `Dra. Um ${U}` },
    });
    const log = await prisma.logAcesso.findFirst({
      where: { clinica_id: A.id, usuario_id: A.prof1.id, acao: 'criar', entidade: 'prontuario', entidade_id: registroId },
    });
    expect(log).not.toBeNull();
  });

  it('agendamento de outro paciente → 404', async () => {
    const outro = await prisma.agendamento.create({
      data: {
        clinica_id: A.id,
        paciente_id: A.pacienteSemVinculo,
        profissional_id: A.prof2.profissionalId,
        inicio: new Date(),
        fim: new Date(),
      },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${A.pacienteDoProf1}`,
      headers: h(A.prof1.token),
      payload: { texto: 'x', agendamento_id: outro.id },
    });
    expect(r.statusCode).toBe(404);
  });

  it('visualizar grava log e lista o mais recente primeiro; correção = novo registro', async () => {
    const c = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${A.pacienteDoProf1}`,
      headers: h(A.prof1.token),
      payload: { texto: 'Correção: cefaleia há 5 dias.', corrige_registro_id: registroId },
    });
    expect(c.statusCode).toBe(201);
    expect(c.json().corrige_registro_id).toBe(registroId);

    const antes = await prisma.logAcesso.count({
      where: { clinica_id: A.id, usuario_id: A.prof1.id, acao: 'visualizar', entidade: 'prontuario' },
    });
    const r = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${A.pacienteDoProf1}`, headers: h(A.prof1.token) });
    expect(r.statusCode).toBe(200);
    const lista = r.json();
    expect(lista[0].id).toBe(c.json().id);
    expect(lista[1]).toMatchObject({ id: registroId, texto: 'Paciente relata cefaleia há 3 dias.' });
    expect(lista[1].correcoes.map((x: { id: string }) => x.id)).toEqual([c.json().id]);
    const depois = await prisma.logAcesso.count({
      where: {
        clinica_id: A.id,
        usuario_id: A.prof1.id,
        acao: 'visualizar',
        entidade: 'prontuario',
        entidade_id: A.pacienteDoProf1,
      },
    });
    expect(depois).toBe(antes + 1);
  });

  it('só o autor corrige o próprio registro', async () => {
    // prof2 passa a ter vínculo com o paciente
    await prisma.agendamento.create({
      data: {
        clinica_id: A.id,
        paciente_id: A.pacienteDoProf1,
        profissional_id: A.prof2.profissionalId,
        inicio: new Date(),
        fim: new Date(),
      },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${A.pacienteDoProf1}`,
      headers: h(A.prof2.token),
      payload: { texto: 'Corrigindo o colega', corrige_registro_id: registroId },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('correcao_nao_permitida');
  });

  it('não existem rotas de update/delete do prontuário', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      for (const url of [`/prontuario/pacientes/${A.pacienteDoProf1}`, `/prontuario/${registroId}`, `/prontuario/registros/${registroId}`]) {
        const r = await app.inject({ method, url, headers: h(A.admin.token), payload: method === 'DELETE' ? undefined : { texto: 'hack' } });
        expect([404, 405]).toContain(r.statusCode);
      }
    }
    const reg = await prisma.prontuarioRegistro.findUniqueOrThrow({ where: { id: registroId } });
    expect(reg.texto).toBe('Paciente relata cefaleia há 3 dias.');
  });

  it('recepção não consegue ler o prontuário mesmo com papel "profissional" no token (vale o papel do banco)', async () => {
    const tokenForjado = assinarTokenClinica(app, {
      usuarioId: A.recepcao.id,
      clinicaId: A.id,
      papel: 'profissional',
      profissionalId: A.prof1.profissionalId,
    });
    const r = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${A.pacienteDoProf1}`, headers: h(tokenForjado) });
    expect(r.statusCode).toBe(403);
  });
});

describe('anexos', () => {
  it('tipo proibido → 400; conteúdo que não bate com a extensão → 400', async () => {
    const r = await enviar(B.prof1.token, B.pacienteDoProf1, 'virus.exe', Buffer.from('MZ....'));
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('tipo_arquivo_invalido');
    const r2 = await enviar(B.prof1.token, B.pacienteDoProf1, 'falso.png', Buffer.from('<html>não é png</html>'));
    expect(r2.statusCode).toBe(400);
  });

  it('upload, listagem e download autenticado com log', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: `/prontuario/pacientes/${B.pacienteDoProf1}`,
      headers: h(B.prof1.token),
      payload: { texto: 'Solicito hemograma.' },
    });
    const up = await enviar(B.prof1.token, B.pacienteDoProf1, 'Hemograma São José.pdf', PDF, { registro_id: reg.json().id });
    expect(up.statusCode).toBe(201);
    const anexo = up.json();
    expect(anexo).toMatchObject({
      nome_arquivo: 'Hemograma São José.pdf',
      mime_tipo: 'application/pdf',
      tamanho: PDF.length,
      registro_id: reg.json().id,
      usuario: { id: B.prof1.id },
    });

    // arquivo gravado com nome aleatório dentro de UPLOAD_DIR/<clinica_id>
    const db = await prisma.anexo.findUniqueOrThrow({ where: { id: anexo.id } });
    expect(db.caminho.startsWith(`${B.id}/`)).toBe(true);
    expect(db.caminho).not.toContain('Hemograma');
    expect(fs.existsSync(path.join(DIR_UPLOAD, db.caminho))).toBe(true);

    const lista = await app.inject({ method: 'GET', url: `/prontuario/pacientes/${B.pacienteDoProf1}/anexos`, headers: h(B.admin.token) });
    expect(lista.json().map((a: { id: string }) => a.id)).toContain(anexo.id);

    const down = await app.inject({ method: 'GET', url: `/prontuario/anexos/${anexo.id}/download`, headers: h(B.prof1.token) });
    expect(down.statusCode).toBe(200);
    expect(down.headers['content-type']).toContain('application/pdf');
    expect(down.headers['content-disposition']).toContain("filename*=UTF-8''Hemograma%20S%C3%A3o%20Jos%C3%A9.pdf");
    expect(down.rawPayload.equals(PDF)).toBe(true);
    const log = await prisma.logAcesso.findFirst({
      where: { clinica_id: B.id, usuario_id: B.prof1.id, acao: 'baixar', entidade: 'anexo', entidade_id: anexo.id },
    });
    expect(log).not.toBeNull();

    // outra clínica e profissional sem vínculo não baixam
    const outraClinica = await app.inject({ method: 'GET', url: `/prontuario/anexos/${anexo.id}/download`, headers: h(A.admin.token) });
    expect(outraClinica.statusCode).toBe(404);
    const semVinculo = await app.inject({ method: 'GET', url: `/prontuario/anexos/${anexo.id}/download`, headers: h(B.prof2.token) });
    expect(semVinculo.statusCode).toBe(403);
    const recep = await app.inject({ method: 'GET', url: `/prontuario/anexos/${anexo.id}/download`, headers: h(B.recepcao.token) });
    expect(recep.statusCode).toBe(403);
  });

  it('plano de teste: 2º anexo → 403 limite_atingido', async () => {
    const r1 = await enviar(A.prof1.token, A.pacienteDoProf1, 'raio-x.png', PNG);
    expect(r1.statusCode).toBe(201);
    const r2 = await enviar(A.prof1.token, A.pacienteDoProf1, 'raio-x-2.png', PNG);
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toMatchObject({ erro: 'limite_atingido', recurso: 'max_anexos', limite: 1, uso: 1 });
    expect(await prisma.anexo.count({ where: { clinica_id: A.id } })).toBe(1);
    // nenhum arquivo órfão gravado
    expect(fs.readdirSync(path.join(DIR_UPLOAD, A.id))).toHaveLength(1);
  });
});
