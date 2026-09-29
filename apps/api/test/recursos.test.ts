import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { subMonths } from 'date-fns';
import { prisma } from '../src/lib/prisma';
import { criarDbTenant } from '../src/plugins/tenant';
import { assegurarLimite, assegurarRecurso, obterUsoERecursos, verificarLimite } from '../src/plugins/recursos';
import { assinarTokenClinica, exigirPapel } from '../src/plugins/auth';
import { buildApp } from '../src/app';
import { criarCenario } from './cenario';

let cen: Awaited<ReturnType<typeof criarCenario>>;

beforeEach(async () => {
  cen = await criarCenario();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('verificarLimite / assegurarLimite', () => {
  it('plano de teste permite o 1º profissional e bloqueia o 2º', async () => {
    const clinicaId = cen.a.clinica.id;
    const db = criarDbTenant(clinicaId);

    await expect(assegurarLimite(clinicaId, 'max_profissionais')).resolves.toMatchObject({ limite: 1, uso: 0 });
    await db.profissional.create({ data: { nome: 'Primeiro' } });

    await expect(assegurarLimite(clinicaId, 'max_profissionais')).rejects.toMatchObject({
      status: 403,
      codigo: 'limite_atingido',
      extras: { recurso: 'max_profissionais', limite: 1, uso: 1 },
    });
  });

  it('profissional inativo não conta', async () => {
    const clinicaId = cen.a.clinica.id;
    await criarDbTenant(clinicaId).profissional.create({ data: { nome: 'Inativo', ativo: false } });
    await expect(assegurarLimite(clinicaId, 'max_profissionais')).resolves.toMatchObject({ uso: 0 });
  });

  it('admin não conta no limite de recepcionistas', async () => {
    const clinicaId = cen.a.clinica.id;
    const db = criarDbTenant(clinicaId);
    await expect(assegurarLimite(clinicaId, 'max_recepcionistas')).resolves.toMatchObject({ uso: 0 });
    await db.usuario.create({ data: { nome: 'Recep', email: 'r@a.local', senha_hash: 'x', papel: 'recepcao' } });
    await expect(assegurarLimite(clinicaId, 'max_recepcionistas')).rejects.toMatchObject({ codigo: 'limite_atingido' });
  });

  it('período mensal ignora o que foi criado em meses anteriores', async () => {
    const clinicaId = cen.b.clinica.id; // plano Grande: 2 agendamentos/mês
    const db = criarDbTenant(clinicaId);
    const prof = await db.profissional.create({ data: { nome: 'P' } });
    const pac = await db.paciente.create({ data: { nome: 'Pac' } });
    const base = { paciente_id: pac.id, profissional_id: prof.id, inicio: new Date(), fim: new Date() };
    await db.agendamento.create({ data: { ...base, criado_em: subMonths(new Date(), 2) } });
    await db.agendamento.create({ data: base });
    await expect(assegurarLimite(clinicaId, 'max_agendamentos')).resolves.toMatchObject({ limite: 2, uso: 1 });
    await db.agendamento.create({ data: base });
    await expect(assegurarLimite(clinicaId, 'max_agendamentos')).rejects.toMatchObject({ codigo: 'limite_atingido' });
  });

  it('funciona dentro de transação do request.db (com trava)', async () => {
    const clinicaId = cen.a.clinica.id;
    const db = criarDbTenant(clinicaId);
    await db.$transaction(async (tx) => {
      await assegurarLimite(clinicaId, 'max_profissionais', { tx });
      await tx.profissional.create({ data: { nome: 'Na transação' } });
    });
    await expect(
      db.$transaction(async (tx) => {
        await assegurarLimite(clinicaId, 'max_profissionais', { tx });
        await tx.profissional.create({ data: { nome: 'Não deve criar' } });
      }),
    ).rejects.toMatchObject({ codigo: 'limite_atingido' });
    expect(await db.profissional.count()).toBe(1);
  });

  it('mensagens: conta só saída pendente/enviada', async () => {
    const clinicaId = cen.a.clinica.id;
    const db = criarDbTenant(clinicaId);
    await db.mensagemWhatsapp.create({ data: { telefone: '1', direcao: 'entrada', conteudo: '1', status: 'recebida' } });
    await db.mensagemWhatsapp.create({ data: { telefone: '1', direcao: 'saida', conteudo: 'x', status: 'falhou' } });
    await expect(assegurarLimite(clinicaId, 'max_mensagens')).resolves.toMatchObject({ uso: 0 });
    await db.mensagemWhatsapp.create({ data: { telefone: '1', direcao: 'saida', conteudo: 'x', status: 'enviada' } });
    await expect(assegurarLimite(clinicaId, 'max_mensagens')).rejects.toMatchObject({ codigo: 'limite_atingido' });
  });

  it('assegurarRecurso barra recurso desabilitado no plano', async () => {
    await expect(assegurarRecurso(cen.a.clinica.id, 'whatsapp')).resolves.toBeUndefined();
    await expect(assegurarRecurso(cen.a.clinica.id, 'financeiro')).rejects.toMatchObject({
      codigo: 'recurso_indisponivel',
    });
  });

  it('obterUsoERecursos devolve mapa com uso', async () => {
    await criarDbTenant(cen.a.clinica.id).profissional.create({ data: { nome: 'X' } });
    const r = await obterUsoERecursos(cen.a.clinica.id);
    expect(r.plano?.nome).toBe('Teste grátis');
    expect(r.recursos.max_profissionais).toMatchObject({ habilitado: true, limite: 1, periodo: 'total', uso: 1 });
    expect(r.recursos.whatsapp).toMatchObject({ habilitado: true, uso: null });
    expect(r.assinatura?.somente_leitura).toBe(false);
  });
});

describe('preHandlers HTTP', () => {
  async function montarApp() {
    const app = await buildApp();
    app.post(
      '/teste/profissionais',
      { preHandler: [exigirPapel('admin'), verificarLimite('max_profissionais')] },
      async (request) => request.db.profissional.create({ data: { nome: 'Via HTTP' } }),
    );
    await app.ready();
    return app;
  }

  it('responde 403 limite_atingido no 2º profissional do plano de teste', async () => {
    const app = await montarApp();
    const token = assinarTokenClinica(app, { usuarioId: cen.a.admin.id, clinicaId: cen.a.clinica.id, papel: 'admin' });
    const headers = { authorization: `Bearer ${token}` };
    const r1 = await app.inject({ method: 'POST', url: '/teste/profissionais', headers });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: 'POST', url: '/teste/profissionais', headers });
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toMatchObject({ erro: 'limite_atingido', recurso: 'max_profissionais', limite: 1, uso: 1 });
    expect(r2.json().mensagem).toMatch(/upgrade/);
    await app.close();
  });

  it('exigirPapel barra papel sem permissão', async () => {
    const app = await montarApp();
    const recep = await prisma.usuario.create({
      data: { clinica_id: cen.a.clinica.id, nome: 'R', email: 'rr@a.local', senha_hash: 'x', papel: 'recepcao' },
    });
    const token = assinarTokenClinica(app, { usuarioId: recep.id, clinicaId: cen.a.clinica.id, papel: 'admin' });
    // papel do token é ignorado: vale o papel atual do banco
    const r = await app.inject({ method: 'POST', url: '/teste/profissionais', headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('proibido');
    await app.close();
  });

  it('assinatura vencida/bloqueada deixa a clínica somente leitura', async () => {
    const app = await montarApp();
    await prisma.assinatura.update({ where: { clinica_id: cen.a.clinica.id }, data: { status: 'bloqueada' } });
    const token = assinarTokenClinica(app, { usuarioId: cen.a.admin.id, clinicaId: cen.a.clinica.id, papel: 'admin' });
    const headers = { authorization: `Bearer ${token}` };
    const post = await app.inject({ method: 'POST', url: '/teste/profissionais', headers });
    expect(post.statusCode).toBe(403);
    expect(post.json().erro).toBe('assinatura_inativa');
    const get = await app.inject({ method: 'GET', url: '/me', headers });
    expect(get.statusCode).toBe(200);
    expect(get.json().assinatura.somente_leitura).toBe(true);

    // teste com expira_em no passado também vira somente leitura
    await prisma.assinatura.update({
      where: { clinica_id: cen.a.clinica.id },
      data: { status: 'ativa', expira_em: new Date(Date.now() - 1000) },
    });
    const post2 = await app.inject({ method: 'POST', url: '/teste/profissionais', headers });
    expect(post2.json().erro).toBe('assinatura_inativa');
    await app.close();
  });
});
