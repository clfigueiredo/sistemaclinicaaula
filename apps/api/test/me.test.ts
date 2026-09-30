/**
 * PUT /me/clinica — edição dos dados cadastrais da própria clínica.
 * Cria os PRÓPRIOS dados (nomes únicos) — sem truncate.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PapelUsuario } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';
import { gerarHashSenha } from '../src/utils/senha';

const U = randomUUID().slice(0, 8);
let app: App;
let planoId: string;
const clinicas: string[] = [];

const h = (token: string) => ({ authorization: `Bearer ${token}` });

async function criarClinica(sufixo: string) {
  const clinica = await prisma.clinica.create({
    data: {
      nome: `Clínica Me ${sufixo} ${U}`,
      documento: `8${Date.now()}${Math.floor(Math.random() * 1e5)}`.slice(0, 14),
    },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  return clinica;
}

async function token(clinicaId: string, papel: PapelUsuario) {
  const u = await prisma.usuario.create({
    data: {
      clinica_id: clinicaId,
      nome: `${papel} ${U}`,
      email: `${papel}.${randomUUID().slice(0, 6)}.${U}@me.local`,
      senha_hash: await gerarHashSenha('senha-123'),
      papel,
    },
  });
  return assinarTokenClinica(app, { usuarioId: u.id, clinicaId, papel, profissionalId: null });
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
      nome: `Plano me ${U}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({ recurso_codigo: r.codigo, habilitado: true, limite: null, periodo: 'total' as const })),
      },
    },
  });
  planoId = plano.id;
});

afterAll(async () => {
  await app?.close();
  if (clinicas.length) await prisma.clinica.deleteMany({ where: { id: { in: clinicas } } });
  if (planoId) await prisma.plano.deleteMany({ where: { id: planoId } });
  await prisma.$disconnect();
});

describe('PUT /me/clinica', () => {
  it('admin edita os dados da própria clínica, normalizando telefone, CEP e UF', async () => {
    const clinica = await criarClinica('A');
    const t = await token(clinica.id, 'admin');
    const res = await app.inject({
      method: 'PUT',
      url: '/me/clinica',
      headers: h(t),
      payload: {
        nome: 'Clínica Nova',
        telefone: '(11) 98765-4321',
        cep: '01310-100',
        uf: 'sp',
        cidade: 'São Paulo',
        email: 'Contato@Clinica.COM',
        fuso_horario: 'America/Manaus',
      },
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo).toMatchObject({
      nome: 'Clínica Nova',
      telefone: '11987654321',
      cep: '01310100',
      uf: 'SP',
      cidade: 'São Paulo',
      email: 'contato@clinica.com',
      fuso_horario: 'America/Manaus',
      documento: clinica.documento,
    });

    // String vazia limpa o campo.
    const limpar = await app.inject({ method: 'PUT', url: '/me/clinica', headers: h(t), payload: { cidade: '' } });
    expect(limpar.statusCode).toBe(200);
    expect(limpar.json().cidade).toBeNull();
  });

  it('não permite alterar documento nem status pelo corpo', async () => {
    const clinica = await criarClinica('B');
    const t = await token(clinica.id, 'admin');
    const res = await app.inject({
      method: 'PUT',
      url: '/me/clinica',
      headers: h(t),
      payload: { nome: 'Outro nome', documento: '00000000000', status: 'inativa' },
    });
    expect(res.statusCode).toBe(200);
    const salva = await prisma.clinica.findUniqueOrThrow({ where: { id: clinica.id } });
    expect(salva.documento).toBe(clinica.documento);
    expect(salva.status).toBe('ativa');
  });

  it('recepção e profissional recebem 403', async () => {
    const clinica = await criarClinica('C');
    for (const papel of ['recepcao', 'profissional'] as const) {
      const t = await token(clinica.id, papel);
      const res = await app.inject({ method: 'PUT', url: '/me/clinica', headers: h(t), payload: { nome: 'Nome válido' } });
      expect(res.statusCode).toBe(403);
    }
  });

  it('valida os campos (400)', async () => {
    const clinica = await criarClinica('D');
    const t = await token(clinica.id, 'admin');
    for (const payload of [{ cep: '123' }, { uf: 'São' }, { email: 'invalido' }, { fuso_horario: 'Europe/Lisbon' }, { nome: 'A' }]) {
      const res = await app.inject({ method: 'PUT', url: '/me/clinica', headers: h(t), payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('só altera a clínica do token (isolamento)', async () => {
    const a = await criarClinica('E');
    const b = await criarClinica('F');
    const t = await token(a.id, 'admin');
    await app.inject({ method: 'PUT', url: '/me/clinica', headers: h(t), payload: { nome: 'Só a clínica A' } });
    const clinicaB = await prisma.clinica.findUniqueOrThrow({ where: { id: b.id } });
    expect(clinicaB.nome).toBe(b.nome);
  });
});
