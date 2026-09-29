/**
 * Testes do painel super admin (admin-planos e admin-clinicas).
 * Cria os próprios dados com nomes/documentos únicos — NÃO limpa o banco (outros testes rodam em paralelo).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { criarDbTenant } from '../src/plugins/tenant';
import { assegurarLimite, CATALOGO_RECURSOS, obterUsoERecursos } from '../src/plugins/recursos';
import { assinarTokenClinica, assinarTokenPlataforma } from '../src/plugins/auth';
import { buildApp, type App } from '../src/app';

const sufixo = randomUUID().slice(0, 8);
let app: App;
let tokenAdmin: string;
let cadastroOriginal: string | null = null;
const planosCriados: string[] = [];
const clinicasCriadas: string[] = [];
let adminId: string;

function docUnico() {
  return `9${randomUUID().replace(/\D/g, '')}${Date.now()}`.slice(0, 14);
}

const headers = () => ({ authorization: `Bearer ${tokenAdmin}` });

function recursosTudoUm() {
  return CATALOGO_RECURSOS.map((r) =>
    r.tipo === 'limite'
      ? { codigo: r.codigo, habilitado: true, limite: 1, periodo: 'total' as const }
      : { codigo: r.codigo, habilitado: r.codigo === 'whatsapp' },
  );
}

async function criarPlanoApi(corpo: Record<string, unknown>) {
  const r = await app.inject({ method: 'POST', url: '/admin/planos', headers: headers(), payload: corpo });
  expect(r.statusCode, r.body).toBe(201);
  planosCriados.push(r.json().id);
  return r.json();
}

async function criarClinica(nome: string, planoId: string) {
  const clinica = await prisma.clinica.create({ data: { nome: `${nome} ${sufixo}`, documento: docUnico() } });
  clinicasCriadas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'teste' } });
  const admin = await prisma.usuario.create({
    data: { clinica_id: clinica.id, nome: 'Admin', email: `admin-${randomUUID()}@teste.local`, senha_hash: 'x', papel: 'admin' },
  });
  return { clinica, admin };
}

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      update: {},
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
    });
  }
  cadastroOriginal = (await prisma.plano.findFirst({ where: { plano_cadastro: true } }))?.id ?? null;
  const admin = await prisma.usuarioPlataforma.create({
    data: { nome: 'Super Teste', email: `super-${sufixo}@teste.local`, senha_hash: 'x' },
  });
  adminId = admin.id;
  app = await buildApp();
  await app.ready();
  tokenAdmin = assinarTokenPlataforma(app, admin.id);
});

afterAll(async () => {
  // Restaura o plano de cadastro original (se existia) e remove os dados criados aqui.
  try {
    if (cadastroOriginal && (await prisma.plano.findUnique({ where: { id: cadastroOriginal } }))) {
      await prisma.$transaction([
        prisma.plano.updateMany({ where: { plano_cadastro: true }, data: { plano_cadastro: false } }),
        prisma.plano.update({ where: { id: cadastroOriginal }, data: { plano_cadastro: true } }),
      ]);
    }
    await prisma.clinica.deleteMany({ where: { id: { in: clinicasCriadas } } });
    await prisma.plano.deleteMany({ where: { id: { in: planosCriados }, plano_cadastro: false } });
    await prisma.usuarioPlataforma.deleteMany({ where: { id: adminId } });
  } catch {
    /* outro teste pode ter limpado o banco */
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('acesso', () => {
  it('sem token → 401; token de clínica → 403', async () => {
    const semToken = await app.inject({ method: 'GET', url: '/admin/planos' });
    expect(semToken.statusCode).toBe(401);

    const plano = await criarPlanoApi({ nome: `Acesso ${sufixo}`, recursos: recursosTudoUm() });
    const { clinica, admin } = await criarClinica('Clínica Acesso', plano.id);
    const tokenClinica = assinarTokenClinica(app, { usuarioId: admin.id, clinicaId: clinica.id, papel: 'admin' });
    for (const url of ['/admin/planos', '/admin/recursos', '/admin/clinicas', '/admin/dashboard']) {
      const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tokenClinica}` } });
      expect(r.statusCode, url).toBe(403);
    }
  });
});

describe('recursos e planos', () => {
  it('GET /admin/recursos devolve o catálogo', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/recursos', headers: headers() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(CATALOGO_RECURSOS.length);
    expect(r.json()[0]).toMatchObject({ codigo: 'max_profissionais', tipo: 'limite' });
  });

  it('valida o corpo do plano', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/admin/planos',
      headers: headers(),
      payload: { nome: 'x', preco: -1, recursos: [{ codigo: 'inexistente', habilitado: true }] },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('validacao');
  });

  it('cria e edita recursos numa única requisição', async () => {
    const plano = await criarPlanoApi({ nome: `Editar ${sufixo}`, preco: 99.9, recursos: recursosTudoUm() });
    expect(plano.recursos).toHaveLength(CATALOGO_RECURSOS.length);
    expect(plano.recursos.find((r: { codigo: string }) => r.codigo === 'max_profissionais')).toMatchObject({
      habilitado: true,
      limite: 1,
      periodo: 'total',
    });

    const r = await app.inject({
      method: 'PUT',
      url: `/admin/planos/${plano.id}`,
      headers: headers(),
      payload: {
        nome: `Editado ${sufixo}`,
        recursos: [
          { codigo: 'max_profissionais', habilitado: true, limite: null, periodo: 'total' },
          { codigo: 'max_agendamentos', habilitado: true, limite: 500, periodo: 'mensal' },
          { codigo: 'financeiro', habilitado: true, limite: 10, periodo: 'mensal' },
          { codigo: 'max_anexos', habilitado: false, limite: 3 },
        ],
      },
    });
    expect(r.statusCode, r.body).toBe(200);
    const recursos = Object.fromEntries(
      (r.json().recursos as { codigo: string }[]).map((x) => [x.codigo, x]),
    ) as Record<string, unknown>;
    expect(r.json().nome).toBe(`Editado ${sufixo}`);
    expect(r.json().preco).toBe('99.9');
    expect(recursos.max_profissionais).toMatchObject({ habilitado: true, limite: null });
    expect(recursos.max_agendamentos).toMatchObject({ habilitado: true, limite: 500, periodo: 'mensal' });
    // liga/desliga ignora limite/período
    expect(recursos.financeiro).toMatchObject({ habilitado: true, limite: null, periodo: null });
    expect(recursos.max_anexos).toMatchObject({ habilitado: false });
    // não enviado → mantém
    expect(recursos.max_recepcionistas).toMatchObject({ habilitado: true, limite: 1 });
  });

  it('só um plano pode ser o plano de cadastro', async () => {
    const a = await criarPlanoApi({ nome: `Cadastro A ${sufixo}`, plano_cadastro: true, recursos: recursosTudoUm() });
    expect(a.plano_cadastro).toBe(true);
    const b = await criarPlanoApi({ nome: `Cadastro B ${sufixo}`, recursos: recursosTudoUm() });

    const r = await app.inject({ method: 'PATCH', url: `/admin/planos/${b.id}/cadastro`, headers: headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().plano_cadastro).toBe(true);
    const marcados = await prisma.plano.findMany({ where: { plano_cadastro: true } });
    expect(marcados.map((p) => p.id)).toEqual([b.id]);

    // plano de cadastro não pode ser desativado nem desmarcado
    const desativar = await app.inject({
      method: 'PATCH',
      url: `/admin/planos/${b.id}/ativo`,
      headers: headers(),
      payload: { ativo: false },
    });
    expect(desativar.statusCode).toBe(409);
    const desmarcar = await app.inject({
      method: 'PUT',
      url: `/admin/planos/${b.id}`,
      headers: headers(),
      payload: { plano_cadastro: false },
    });
    expect(desmarcar.statusCode).toBe(409);

    // plano inativo não pode virar plano de cadastro
    await app.inject({ method: 'PATCH', url: `/admin/planos/${a.id}/ativo`, headers: headers(), payload: { ativo: false } });
    const inativo = await app.inject({ method: 'PATCH', url: `/admin/planos/${a.id}/cadastro`, headers: headers() });
    expect(inativo.statusCode).toBe(409);
    expect(inativo.json().erro).toBe('plano_inativo');
  });

  it('não apaga plano com assinaturas; apaga plano sem assinaturas', async () => {
    const usado = await criarPlanoApi({ nome: `Usado ${sufixo}`, recursos: recursosTudoUm() });
    await criarClinica('Clínica Plano Usado', usado.id);
    const r1 = await app.inject({ method: 'DELETE', url: `/admin/planos/${usado.id}`, headers: headers() });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().erro).toBe('plano_em_uso');

    const livre = await criarPlanoApi({ nome: `Livre ${sufixo}` });
    const r2 = await app.inject({ method: 'DELETE', url: `/admin/planos/${livre.id}`, headers: headers() });
    expect(r2.statusCode).toBe(204);
    expect(await prisma.plano.findUnique({ where: { id: livre.id } })).toBeNull();

    const lista = await app.inject({ method: 'GET', url: '/admin/planos', headers: headers() });
    expect(lista.json().find((p: { id: string }) => p.id === usado.id)).toMatchObject({ total_clinicas: 1 });
  });
});

describe('clínicas e assinaturas', () => {
  it('trocar para um plano maior libera o 2º profissional', async () => {
    const teste = await criarPlanoApi({ nome: `Teste ${sufixo}`, recursos: recursosTudoUm() });
    const grande = await criarPlanoApi({
      nome: `Grande ${sufixo}`,
      preco: 199,
      recursos: CATALOGO_RECURSOS.map((r) => ({ codigo: r.codigo, habilitado: true, limite: null })),
    });
    const { clinica } = await criarClinica('Clínica Upgrade', teste.id);
    await criarDbTenant(clinica.id).profissional.create({ data: { nome: 'Primeiro' } });
    await expect(assegurarLimite(clinica.id, 'max_profissionais')).rejects.toMatchObject({ codigo: 'limite_atingido' });

    const r = await app.inject({
      method: 'PUT',
      url: `/admin/clinicas/${clinica.id}/assinatura`,
      headers: headers(),
      payload: { plano_id: grande.id },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().plano.id).toBe(grande.id);
    expect(r.json().assinatura.status).toBe('ativa'); // teste → plano pago = ativa
    expect(r.json().recursos.max_profissionais).toMatchObject({ limite: null, uso: 1 });

    await expect(assegurarLimite(clinica.id, 'max_profissionais')).resolves.toMatchObject({ limite: null, uso: 1 });
    const uso = await obterUsoERecursos(clinica.id);
    expect(uso.plano?.id).toBe(grande.id);
  });

  it('muda status/expiração, ativa/desativa e lista/detalha sem senha', async () => {
    const plano = await criarPlanoApi({ nome: `Status ${sufixo}`, recursos: recursosTudoUm() });
    const { clinica } = await criarClinica('Clínica Status', plano.id);

    const bloq = await app.inject({
      method: 'PUT',
      url: `/admin/clinicas/${clinica.id}/assinatura`,
      headers: headers(),
      payload: { status: 'bloqueada', expira_em: '2030-01-31T00:00:00.000Z' },
    });
    expect(bloq.statusCode, bloq.body).toBe(200);
    expect(bloq.json().assinatura).toMatchObject({ status: 'bloqueada', somente_leitura: true });
    expect(bloq.json().assinatura.expira_em).toBe('2030-01-31T00:00:00.000Z');

    const invalido = await app.inject({
      method: 'PUT',
      url: `/admin/clinicas/${clinica.id}/assinatura`,
      headers: headers(),
      payload: { status: 'qualquer' },
    });
    expect(invalido.statusCode).toBe(400);

    const inativar = await app.inject({
      method: 'PATCH',
      url: `/admin/clinicas/${clinica.id}`,
      headers: headers(),
      payload: { status: 'inativa' },
    });
    expect(inativar.json().clinica.status).toBe('inativa');

    const det = await app.inject({ method: 'GET', url: `/admin/clinicas/${clinica.id}`, headers: headers() });
    expect(det.statusCode).toBe(200);
    expect(det.json().usuarios).toHaveLength(1);
    expect(det.json().usuarios[0].senha_hash).toBeUndefined();

    const lista = await app.inject({
      method: 'GET',
      url: `/admin/clinicas?busca=${encodeURIComponent(`Clínica Status ${sufixo}`)}&status=bloqueada&pagina=1&porPagina=5`,
      headers: headers(),
    });
    expect(lista.statusCode, lista.body).toBe(200);
    expect(lista.json().total).toBe(1);
    expect(lista.json().itens[0]).toMatchObject({
      id: clinica.id,
      status: 'inativa',
      assinatura: { status: 'bloqueada', plano: { id: plano.id } },
      contadores: { usuarios: 1 },
    });
  });

  it('dashboard responde com totais e clínicas no limite', async () => {
    const plano = await criarPlanoApi({ nome: `Dash ${sufixo}`, recursos: recursosTudoUm() });
    const { clinica } = await criarClinica('Clínica Dash', plano.id);
    await criarDbTenant(clinica.id).profissional.create({ data: { nome: 'Único' } });

    const r = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: headers() });
    expect(r.statusCode, r.body).toBe(200);
    const d = r.json();
    expect(d.total_clinicas).toBeGreaterThanOrEqual(1);
    expect(d.cadastros_30_dias).toHaveLength(30);
    expect(d.por_status).toHaveProperty('teste');
    expect(d.por_plano.find((p: { plano_id: string }) => p.plano_id === plano.id)).toMatchObject({ total: 1 });
    const noLimite = d.clinicas_no_limite.find((c: { id: string }) => c.id === clinica.id);
    expect(noLimite?.recursos).toEqual([
      expect.objectContaining({ codigo: 'max_profissionais', uso: 1, limite: 1 }),
    ]);
  });
});
