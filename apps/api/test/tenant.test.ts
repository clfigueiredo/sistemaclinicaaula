import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { criarDbTenant } from '../src/plugins/tenant';
import { buildApp } from '../src/app';
import { assinarTokenClinica } from '../src/plugins/auth';
import { criarCenario } from './cenario';

let cen: Awaited<ReturnType<typeof criarCenario>>;
let pacienteA: { id: string };
let pacienteB: { id: string };

beforeAll(async () => {
  cen = await criarCenario();
  const dbA = criarDbTenant(cen.a.clinica.id);
  const dbB = criarDbTenant(cen.b.clinica.id);
  pacienteA = await dbA.paciente.create({ data: { nome: 'Paciente da A' } });
  pacienteB = await dbB.paciente.create({ data: { nome: 'Paciente da B' } });
  await dbB.paciente.create({ data: { nome: 'Outro da B' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('extensão tenant (request.db)', () => {
  it('create injeta o clinica_id do token e ignora o enviado', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    const p = await dbA.paciente.create({ data: { nome: 'Tentativa', clinica_id: cen.b.clinica.id } });
    expect(p.clinica_id).toBe(cen.a.clinica.id);
    await prisma.paciente.delete({ where: { id: p.id } });
  });

  it('findMany/count só enxergam a própria clínica', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    const lista = await dbA.paciente.findMany();
    expect(lista.map((p) => p.id)).toEqual([pacienteA.id]);
    expect(await dbA.paciente.count()).toBe(1);
    expect(await criarDbTenant(cen.b.clinica.id).paciente.count()).toBe(2);
    // mesmo forçando clinica_id da outra clínica no where
    expect(await dbA.paciente.findMany({ where: { clinica_id: cen.b.clinica.id } })).toHaveLength(1);
  });

  it('findUnique/findFirst de registro de outra clínica retorna null', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    expect(await dbA.paciente.findUnique({ where: { id: pacienteB.id } })).toBeNull();
    expect(await dbA.paciente.findFirst({ where: { id: pacienteB.id } })).toBeNull();
    expect(await dbA.paciente.findUnique({ where: { id: pacienteA.id } })).not.toBeNull();
  });

  it('update/delete de registro de outra clínica falham; updateMany/deleteMany não afetam', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    await expect(dbA.paciente.update({ where: { id: pacienteB.id }, data: { nome: 'hack' } })).rejects.toMatchObject({
      code: 'P2025',
    });
    await expect(dbA.paciente.delete({ where: { id: pacienteB.id } })).rejects.toMatchObject({ code: 'P2025' });
    const r = await dbA.paciente.updateMany({ where: { id: pacienteB.id }, data: { nome: 'hack' } });
    expect(r.count).toBe(0);
    const d = await dbA.paciente.deleteMany({ where: { id: pacienteB.id } });
    expect(d.count).toBe(0);
    const b = await prisma.paciente.findUnique({ where: { id: pacienteB.id } });
    expect(b?.nome).toBe('Paciente da B');
  });

  it('update não permite mover o registro para outra clínica', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    const p = await dbA.paciente.update({
      where: { id: pacienteA.id },
      data: { observacoes: 'ok', clinica_id: cen.b.clinica.id },
    });
    expect(p.clinica_id).toBe(cen.a.clinica.id);
  });

  it('createMany e upsert gravam na clínica do token', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    await dbA.convenio.createMany({ data: [{ nome: 'Conv 1' }, { nome: 'Conv 2', clinica_id: cen.b.clinica.id }] });
    expect(await prisma.convenio.count({ where: { clinica_id: cen.a.clinica.id } })).toBe(2);
    expect(await prisma.convenio.count({ where: { clinica_id: cen.b.clinica.id } })).toBe(0);
    const up = await dbA.convenio.upsert({
      where: { clinica_id_nome: { clinica_id: cen.b.clinica.id, nome: 'Conv 3' } },
      create: { nome: 'Conv 3' },
      update: {},
    });
    expect(up.clinica_id).toBe(cen.a.clinica.id);
  });

  it('transação interativa mantém o filtro', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    const total = await dbA.$transaction(async (tx) => {
      await tx.convenio.create({ data: { nome: 'Na transação' } });
      return tx.paciente.count();
    });
    expect(total).toBe(1);
    expect(
      await prisma.convenio.count({ where: { clinica_id: cen.a.clinica.id, nome: 'Na transação' } }),
    ).toBe(1);
  });

  it('aggregate e groupBy filtram', async () => {
    const dbB = criarDbTenant(cen.b.clinica.id);
    const agg = await dbB.paciente.aggregate({ _count: { _all: true } });
    expect(agg._count._all).toBe(2);
    const grupos = await dbB.paciente.groupBy({ by: ['clinica_id'], _count: { _all: true } });
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.clinica_id).toBe(cen.b.clinica.id);
  });

  it('modelos de plataforma: clínica só a própria; UsuarioPlataforma proibido; plano só leitura', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    const clinicas = await dbA.clinica.findMany();
    expect(clinicas.map((c) => c.id)).toEqual([cen.a.clinica.id]);
    await expect(dbA.clinica.findUnique({ where: { id: cen.b.clinica.id } })).rejects.toMatchObject({
      codigo: 'nao_encontrado',
    });
    await expect(dbA.usuarioPlataforma.findMany()).rejects.toMatchObject({ codigo: 'proibido' });
    await expect(dbA.plano.update({ where: { id: cen.planoTeste.id }, data: { nome: 'x' } })).rejects.toMatchObject({
      codigo: 'proibido',
    });
    const assinaturas = await dbA.assinatura.findMany();
    expect(assinaturas).toHaveLength(1);
    expect(assinaturas[0]!.clinica_id).toBe(cen.a.clinica.id);
  });

  it('prontuário é imutável (extensão e trigger do banco)', async () => {
    const dbA = criarDbTenant(cen.a.clinica.id);
    const reg = await dbA.prontuarioRegistro.create({ data: { paciente_id: pacienteA.id, texto: 'Consulta inicial' } });
    await expect(
      dbA.prontuarioRegistro.update({ where: { id: reg.id }, data: { texto: 'alterado' } }),
    ).rejects.toMatchObject({ codigo: 'prontuario_imutavel' });
    await expect(dbA.prontuarioRegistro.delete({ where: { id: reg.id } })).rejects.toMatchObject({
      codigo: 'prontuario_imutavel',
    });
    // prisma cru também é barrado pelo trigger
    await expect(prisma.prontuarioRegistro.update({ where: { id: reg.id }, data: { texto: 'x' } })).rejects.toThrow(
      /imutável/,
    );
    await expect(prisma.prontuarioRegistro.delete({ where: { id: reg.id } })).rejects.toThrow(/imutável/);
  });

  it('create pelo prisma cru sem clinica_id falha (falha fechada)', async () => {
    await expect(prisma.convenio.create({ data: { nome: 'Sem clínica' } })).rejects.toThrow();
  });

  it('HTTP: GET /me devolve só a clínica do token', async () => {
    const app = await buildApp();
    await app.ready();
    const token = assinarTokenClinica(app, {
      usuarioId: cen.a.admin.id,
      clinicaId: cen.a.clinica.id,
      papel: 'admin',
    });
    const r = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    expect(r.json().clinica.id).toBe(cen.a.clinica.id);

    // token com clinicaId trocado (usuário não pertence à clínica B) → 401
    const forjado = assinarTokenClinica(app, {
      usuarioId: cen.a.admin.id,
      clinicaId: cen.b.clinica.id,
      papel: 'admin',
    });
    const r2 = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${forjado}` } });
    expect(r2.statusCode).toBe(401);
    await app.close();
  });
});
