/**
 * Cadastros da clínica: profissionais (+ grade + bloqueios), convênios e usuários.
 * Cria os PRÓPRIOS dados (planos/clínicas com nomes únicos) — sem truncate global.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PapelUsuario } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';

let app: FastifyInstance;
const sufixo = randomUUID().slice(0, 8);
let docSeq = 0;

function documentoUnico() {
  docSeq++;
  return `9${Date.now().toString().slice(-9)}${String(docSeq).padStart(4, '0')}`.slice(0, 14);
}

async function garantirCatalogo() {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      update: {},
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
    });
  }
}

async function criarPlano(limite: number | null) {
  const cfg = { habilitado: true, limite, periodo: 'total' as const };
  return prisma.plano.create({
    data: {
      nome: `Plano cadastros ${sufixo} ${limite ?? 'ilimitado'}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo as CodigoRecurso,
          ...(r.tipo === 'limite' ? cfg : { habilitado: true, limite: null, periodo: 'total' as const }),
        })),
      },
    },
  });
}

async function criarClinica(nome: string, planoId: string) {
  const clinica = await prisma.clinica.create({ data: { nome: `${nome} ${sufixo}`, documento: documentoUnico() } });
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'teste' } });
  const admin = await criarUsuario(clinica.id, 'admin');
  return { clinica, admin, headers: cabecalho(clinica.id, admin.id, 'admin') };
}

let usuarioSeq = 0;
async function criarUsuario(clinicaId: string, papel: PapelUsuario) {
  usuarioSeq++;
  return prisma.usuario.create({
    data: {
      clinica_id: clinicaId,
      nome: `Usuário ${usuarioSeq}`,
      email: `u${usuarioSeq}.${sufixo}@cadastros.local`,
      senha_hash: 'x',
      papel,
    },
  });
}

function cabecalho(clinicaId: string, usuarioId: string, papel: PapelUsuario) {
  return { authorization: `Bearer ${assinarTokenClinica(app, { usuarioId, clinicaId, papel })}` };
}

let planoTeste: { id: string };
let planoGrande: { id: string };
const clinicasCriadas: string[] = [];
const planosCriados: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await garantirCatalogo();
  planoTeste = await criarPlano(1);
  planoGrande = await criarPlano(null);
  planosCriados.push(planoTeste.id, planoGrande.id);
});

afterAll(async () => {
  // Remove só o que este arquivo criou (cascade apaga os dados das clínicas).
  await prisma.clinica.deleteMany({ where: { id: { in: clinicasCriadas } } });
  await prisma.plano.deleteMany({ where: { id: { in: planosCriados } } });
  await app.close();
  await prisma.$disconnect();
});

async function novaClinica(nome: string, plano: 'teste' | 'grande') {
  const c = await criarClinica(nome, plano === 'teste' ? planoTeste.id : planoGrande.id);
  clinicasCriadas.push(c.clinica.id);
  return c;
}

describe('profissionais', () => {
  it('plano de teste: 2º profissional bloqueado e reativar também é bloqueado', async () => {
    const { headers } = await novaClinica('Clínica Limite', 'teste');
    const r1 = await app.inject({ method: 'POST', url: '/profissionais', headers, payload: { nome: 'Dra. Um' } });
    expect(r1.statusCode).toBe(201);
    expect(r1.json()).toMatchObject({ nome: 'Dra. Um', duracao_consulta_min: 30, ativo: true });
    expect(r1.json().cor_agenda).toMatch(/^#[0-9a-f]{6}$/);

    const r2 = await app.inject({ method: 'POST', url: '/profissionais', headers, payload: { nome: 'Dr. Dois' } });
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toMatchObject({ erro: 'limite_atingido', recurso: 'max_profissionais', limite: 1, uso: 1 });

    // desativa o 1º → libera vaga → cria o 2º → tenta reativar o 1º (bloqueado)
    const id1 = r1.json().id;
    const d = await app.inject({ method: 'PUT', url: `/profissionais/${id1}`, headers, payload: { ativo: false } });
    expect(d.statusCode).toBe(200);
    expect(d.json().ativo).toBe(false);
    const r3 = await app.inject({ method: 'POST', url: '/profissionais', headers, payload: { nome: 'Dr. Dois' } });
    expect(r3.statusCode).toBe(201);
    const re = await app.inject({ method: 'PUT', url: `/profissionais/${id1}`, headers, payload: { ativo: true } });
    expect(re.statusCode).toBe(403);
    expect(re.json().erro).toBe('limite_atingido');

    const ativos = await app.inject({ method: 'GET', url: '/profissionais?ativos=true', headers });
    expect(ativos.json().map((p: { nome: string }) => p.nome)).toEqual(['Dr. Dois']);
  });

  it('grade: aceita manhã e tarde, rejeita sobreposição e início >= fim', async () => {
    const { headers } = await novaClinica('Clínica Grade', 'grande');
    const p = (await app.inject({ method: 'POST', url: '/profissionais', headers, payload: { nome: 'Dr. Grade' } })).json();

    const ok = await app.inject({
      method: 'PUT',
      url: `/profissionais/${p.id}/horarios`,
      headers,
      payload: [
        { dia_semana: 1, hora_inicio: '13:00', hora_fim: '18:00' },
        { dia_semana: 1, hora_inicio: '08:00', hora_fim: '12:00' },
        { dia_semana: 3, hora_inicio: '08:00', hora_fim: '12:00' },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveLength(3);
    expect(ok.json()[0]).toMatchObject({ dia_semana: 1, hora_inicio: '08:00' });

    const sobreposta = await app.inject({
      method: 'PUT',
      url: `/profissionais/${p.id}/horarios`,
      headers,
      payload: {
        horarios: [
          { dia_semana: 2, hora_inicio: '08:00', hora_fim: '12:00' },
          { dia_semana: 2, hora_inicio: '11:00', hora_fim: '14:00' },
        ],
      },
    });
    expect(sobreposta.statusCode).toBe(400);
    expect(sobreposta.json().erro).toBe('horarios_sobrepostos');

    const invertida = await app.inject({
      method: 'PUT',
      url: `/profissionais/${p.id}/horarios`,
      headers,
      payload: [{ dia_semana: 2, hora_inicio: '12:00', hora_fim: '08:00' }],
    });
    expect(invertida.statusCode).toBe(400);

    // grade anterior intacta
    const det = await app.inject({ method: 'GET', url: `/profissionais/${p.id}`, headers });
    expect(det.json().horarios).toHaveLength(3);
  });

  it('bloqueios: do profissional e da clínica toda aparecem no período', async () => {
    const { clinica, headers } = await novaClinica('Clínica Bloqueio', 'grande');
    const p = (await app.inject({ method: 'POST', url: '/profissionais', headers, payload: { nome: 'Dr. Bloq' } })).json();
    const recep = await criarUsuario(clinica.id, 'recepcao');
    const hRecep = cabecalho(clinica.id, recep.id, 'recepcao');

    const b1 = await app.inject({
      method: 'POST',
      url: '/profissionais/bloqueios',
      headers: hRecep,
      payload: { profissional_id: p.id, inicio: '2030-01-10T12:00:00Z', fim: '2030-01-10T15:00:00Z', motivo: 'Congresso' },
    });
    expect(b1.statusCode).toBe(201);
    const feriado = await app.inject({
      method: 'POST',
      url: '/profissionais/bloqueios',
      headers,
      payload: { profissional_id: null, inicio: '2030-01-11T03:00:00Z', fim: '2030-01-12T03:00:00Z', motivo: 'Feriado' },
    });
    expect(feriado.statusCode).toBe(201);
    const invertido = await app.inject({
      method: 'POST',
      url: '/profissionais/bloqueios',
      headers,
      payload: { inicio: '2030-01-11T03:00:00Z', fim: '2030-01-10T03:00:00Z' },
    });
    expect(invertido.statusCode).toBe(400);

    const lista = await app.inject({
      method: 'GET',
      url: `/profissionais/bloqueios?inicio=2030-01-01T00:00:00Z&fim=2030-02-01T00:00:00Z&profissionalId=${p.id}`,
      headers,
    });
    expect(lista.json().map((b: { motivo: string }) => b.motivo)).toEqual(['Congresso', 'Feriado']);

    const del = await app.inject({ method: 'DELETE', url: `/profissionais/bloqueios/${b1.json().id}`, headers: hRecep });
    expect(del.statusCode).toBe(204);
  });

  it('isolamento: clínica A não lê nem edita profissional da clínica B', async () => {
    const a = await novaClinica('Clínica Iso A', 'grande');
    const b = await novaClinica('Clínica Iso B', 'grande');
    const pb = (await app.inject({ method: 'POST', url: '/profissionais', headers: b.headers, payload: { nome: 'Da B' } })).json();

    expect((await app.inject({ method: 'GET', url: `/profissionais/${pb.id}`, headers: a.headers })).statusCode).toBe(404);
    const put = await app.inject({ method: 'PUT', url: `/profissionais/${pb.id}`, headers: a.headers, payload: { nome: 'Hack' } });
    expect(put.statusCode).toBe(404);
    const grade = await app.inject({ method: 'PUT', url: `/profissionais/${pb.id}/horarios`, headers: a.headers, payload: [] });
    expect(grade.statusCode).toBe(404);
    const bloq = await app.inject({
      method: 'POST',
      url: '/profissionais/bloqueios',
      headers: a.headers,
      payload: { profissional_id: pb.id, inicio: '2030-01-10T12:00:00Z', fim: '2030-01-10T15:00:00Z' },
    });
    expect(bloq.statusCode).toBe(404);
    const listaA = await app.inject({ method: 'GET', url: '/profissionais', headers: a.headers });
    expect(listaA.json()).toEqual([]);
    const aindaB = await prisma.profissional.findUnique({ where: { id: pb.id } });
    expect(aindaB?.nome).toBe('Da B');
  });

  it('recepção lê mas não cria profissional', async () => {
    const { clinica } = await novaClinica('Clínica Papéis', 'grande');
    const recep = await criarUsuario(clinica.id, 'recepcao');
    const h = cabecalho(clinica.id, recep.id, 'recepcao');
    expect((await app.inject({ method: 'GET', url: '/profissionais', headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/profissionais', headers: h, payload: { nome: 'Dr. X' } })).statusCode).toBe(403);
  });
});

describe('convênios', () => {
  it('nome duplicado (sem diferenciar maiúsculas) → 409; em uso não exclui', async () => {
    const { headers } = await novaClinica('Clínica Convênio', 'grande');
    const c = await app.inject({ method: 'POST', url: '/convenios', headers, payload: { nome: 'Unimed' } });
    expect(c.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: '/convenios', headers, payload: { nome: '  unimed ' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('convenio_duplicado');

    const outro = (await app.inject({ method: 'POST', url: '/convenios', headers, payload: { nome: 'Amil' } })).json();
    const renomear = await app.inject({ method: 'PUT', url: `/convenios/${outro.id}`, headers, payload: { nome: 'UNIMED' } });
    expect(renomear.statusCode).toBe(409);

    await prisma.paciente.create({
      data: { clinica_id: (await prisma.convenio.findUniqueOrThrow({ where: { id: c.json().id } })).clinica_id, nome: 'Pac', convenio_id: c.json().id },
    });
    const del = await app.inject({ method: 'DELETE', url: `/convenios/${c.json().id}`, headers });
    expect(del.statusCode).toBe(409);
    expect(del.json().erro).toBe('convenio_em_uso');
    const desativar = await app.inject({ method: 'PUT', url: `/convenios/${c.json().id}`, headers, payload: { ativo: false } });
    expect(desativar.json().ativo).toBe(false);
    const ativos = await app.inject({ method: 'GET', url: '/convenios?ativos=true', headers });
    expect(ativos.json().map((x: { nome: string }) => x.nome)).toEqual(['Amil']);
    expect((await app.inject({ method: 'DELETE', url: `/convenios/${outro.id}`, headers })).statusCode).toBe(204);
  });
});

describe('usuários', () => {
  it('recepcionista conta no limite e admin não', async () => {
    const { headers } = await novaClinica('Clínica Usuários', 'teste');
    const base = { senha: 'segredo1' };
    const admin2 = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers,
      payload: { ...base, nome: 'Outro Admin', email: `adm2.${sufixo}@x.local`, papel: 'admin' },
    });
    expect(admin2.statusCode).toBe(201);
    expect(admin2.json()).not.toHaveProperty('senha_hash');

    const r1 = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers,
      payload: { ...base, nome: 'Recep Um', email: `rec1.${sufixo}@x.local`, papel: 'recepcao' },
    });
    expect(r1.statusCode).toBe(201);
    const r2 = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers,
      payload: { ...base, nome: 'Recep Dois', email: `rec2.${sufixo}@x.local`, papel: 'recepcao' },
    });
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toMatchObject({ erro: 'limite_atingido', recurso: 'max_recepcionistas' });

    // mais admins continuam liberados
    const admin3 = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers,
      payload: { ...base, nome: 'Admin Três', email: `adm3.${sufixo}@x.local`, papel: 'admin' },
    });
    expect(admin3.statusCode).toBe(201);
    // rebaixar admin para recepção também consome o limite
    const rebaixar = await app.inject({ method: 'PUT', url: `/usuarios/${admin3.json().id}`, headers, payload: { papel: 'recepcao' } });
    expect(rebaixar.statusCode).toBe(403);

    // e-mail duplicado
    const dup = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers,
      payload: { ...base, nome: 'Dup', email: `ADM2.${sufixo}@x.local`, papel: 'admin' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().erro).toBe('email_em_uso');
  });

  it('recepção não pode criar usuário (403)', async () => {
    const { clinica } = await novaClinica('Clínica Recep', 'grande');
    const recep = await criarUsuario(clinica.id, 'recepcao');
    const h = cabecalho(clinica.id, recep.id, 'recepcao');
    const r = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: h,
      payload: { nome: 'Novo', email: `novo.${sufixo}@x.local`, senha: 'segredo1', papel: 'admin' },
    });
    expect(r.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/usuarios', headers: h })).statusCode).toBe(403);
  });

  it('papel profissional exige vínculo único; admin não se desativa; último admin protegido', async () => {
    const { admin, headers } = await novaClinica('Clínica Vínculo', 'grande');
    const p = (await app.inject({ method: 'POST', url: '/profissionais', headers, payload: { nome: 'Dr. Vínculo' } })).json();

    const semVinculo = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers,
      payload: { nome: 'Prof', email: `prof.${sufixo}@x.local`, senha: 'segredo1', papel: 'profissional' },
    });
    expect(semVinculo.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers,
      payload: { nome: 'Prof', email: `prof.${sufixo}@x.local`, senha: 'segredo1', papel: 'profissional', profissional_id: p.id },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().profissional).toMatchObject({ id: p.id });
    const repetido = await app.inject({ method: 'PUT', url: `/usuarios/${admin.id}`, headers, payload: { profissional_id: p.id } });
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().erro).toBe('profissional_vinculado');

    const auto = await app.inject({ method: 'PUT', url: `/usuarios/${admin.id}`, headers, payload: { ativo: false } });
    expect(auto.statusCode).toBe(400);

    // promove o profissional a admin, e ele tenta rebaixar o admin original: permitido (há outro admin)
    await app.inject({ method: 'PUT', url: `/usuarios/${ok.json().id}`, headers, payload: { papel: 'admin' } });
    const h2 = cabecalho((await prisma.usuario.findUniqueOrThrow({ where: { id: admin.id } })).clinica_id, ok.json().id, 'admin');
    const desativaOriginal = await app.inject({ method: 'PUT', url: `/usuarios/${admin.id}`, headers: h2, payload: { ativo: false } });
    expect(desativaOriginal.statusCode).toBe(200);
    // o único admin ativo restante não consegue se rebaixar
    const rebaixar = await app.inject({ method: 'PUT', url: `/usuarios/${ok.json().id}`, headers: h2, payload: { papel: 'recepcao' } });
    expect(rebaixar.statusCode).toBe(400);
    const senha = await app.inject({ method: 'PUT', url: `/usuarios/${admin.id}/senha`, headers: h2, payload: { senha: 'novasenha' } });
    expect(senha.statusCode).toBe(204);
  });
});
