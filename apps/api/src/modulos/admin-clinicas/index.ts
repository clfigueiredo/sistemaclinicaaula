/**
 * Módulo admin-clinicas — Clínicas, assinaturas e dashboard (painel super admin).
 *
 * Prefixo "/admin" (todas as rotas exigem token de plataforma — autenticarAdmin):
 *   GET   /admin/dashboard                  totais: clínicas, por status (efetivo), por plano, cadastros
 *                                           dos últimos 30 dias (série diária), clínicas no limite (upsell)
 *   GET   /admin/clinicas                   ?busca=&status=&planoId=&situacao=&pagina=&porPagina=
 *                                           → { itens: [{ ..., assinatura{status, plano}, contadores }], total, pagina, porPagina }
 *   GET   /admin/clinicas/:id               { clinica, assinatura, plano, recursos (uso x limite), usuarios, whatsapp, contadores }
 *   PATCH /admin/clinicas/:id               { status: 'ativa' | 'inativa' } — ativa/desativa a clínica
 *   PUT   /admin/clinicas/:id/assinatura    { plano_id?, status?, expira_em? (ISO | null) } — troca plano/status/expiração.
 *                                           Sem assinatura → cria (plano_id obrigatório). Saindo de `teste` para plano
 *                                           pago sem status explícito → `ativa`.
 *
 * - Prisma CRU (plataforma). Uso dos recursos via obterUsoERecursos (mesma regra do /me).
 * - Nada é gravado em logs_acesso (é plataforma); as ações são registradas via request.log.
 * - Nunca exclua clínicas com prontuário (trigger de imutabilidade) — por isso só ativar/desativar.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { autenticarAdmin } from '../../plugins/auth';
import { ErroNegocio, ou404 } from '../../utils/erros';
import { listarClinicas, montarDashboard, obterDetalheClinica, STATUS_ASSINATURA } from './servico';

export const prefixo = '/admin';

const ParamsId = z.object({ id: z.uuid('Identificador inválido') });

const statusAssinatura = z.enum(STATUS_ASSINATURA as ['teste', 'ativa', 'vencida', 'cancelada', 'bloqueada'], {
  error: 'Status de assinatura inválido',
});

const ConsultaLista = z.object({
  busca: z.string().trim().max(120, 'Busca muito longa').optional(),
  status: z
    .enum(['teste', 'ativa', 'vencida', 'cancelada', 'bloqueada', 'sem_assinatura'], { error: 'Status inválido' })
    .optional(),
  planoId: z.uuid('Plano inválido').optional(),
  situacao: z.enum(['ativa', 'inativa'], { error: 'Situação inválida' }).optional(),
  pagina: z.coerce.number().int().min(1, 'Página inválida').default(1),
  porPagina: z.coerce.number().int().min(1).max(100, 'Máximo de 100 por página').default(20),
});

const CorpoStatusClinica = z.object({
  status: z.enum(['ativa', 'inativa'], { error: 'Status inválido (use ativa ou inativa)' }),
});

const CorpoAssinatura = z
  .object({
    plano_id: z.uuid('Plano inválido').optional(),
    status: statusAssinatura.optional(),
    /** null = não expira. */
    expira_em: z.union([z.null(), z.coerce.date({ error: 'Data de expiração inválida' })]).optional(),
  })
  .refine((d) => d.plano_id !== undefined || d.status !== undefined || d.expira_em !== undefined, {
    message: 'Informe o plano, o status ou a data de expiração',
  });

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarAdmin);

  // ------------------------------------------------------------------ dashboard
  app.get('/dashboard', async () => montarDashboard());

  // ------------------------------------------------------------------ clínicas
  app.get('/clinicas', { schema: { querystring: ConsultaLista } }, async (request) => listarClinicas(request.query));

  app.get('/clinicas/:id', { schema: { params: ParamsId } }, async (request) => obterDetalheClinica(request.params.id));

  app.patch('/clinicas/:id', { schema: { params: ParamsId, body: CorpoStatusClinica } }, async (request) => {
    const { id } = request.params;
    ou404(await prisma.clinica.findUnique({ where: { id }, select: { id: true } }), 'Clínica não encontrada.');
    await prisma.clinica.update({ where: { id }, data: { status: request.body.status } });
    request.log.info(
      { clinicaId: id, status: request.body.status, admin: request.adminPlataforma?.id },
      'Situação da clínica alterada pelo super admin',
    );
    return obterDetalheClinica(id);
  });

  app.put('/clinicas/:id/assinatura', { schema: { params: ParamsId, body: CorpoAssinatura } }, async (request) => {
    const { id } = request.params;
    const { plano_id, status, expira_em } = request.body;

    await prisma.$transaction(async (tx) => {
      const clinica = ou404(
        await tx.clinica.findUnique({ where: { id }, include: { assinatura: true } }),
        'Clínica não encontrada.',
      );
      const atual = clinica.assinatura;

      let novoPlano: { id: string; preco: { toNumber(): number } } | null = null;
      if (plano_id !== undefined && plano_id !== atual?.plano_id) {
        const plano = ou404(await tx.plano.findUnique({ where: { id: plano_id } }), 'Plano não encontrado.');
        if (!plano.ativo) {
          throw new ErroNegocio(409, 'plano_inativo', 'Este plano está inativo. Ative-o antes de atribuí-lo a uma clínica.');
        }
        novoPlano = plano;
      }

      if (!atual) {
        if (!novoPlano) {
          throw new ErroNegocio(400, 'plano_obrigatorio', 'A clínica não tem assinatura: informe o plano para criá-la.');
        }
        await tx.assinatura.create({
          data: {
            clinica_id: id,
            plano_id: novoPlano.id,
            status: status ?? (novoPlano.preco.toNumber() > 0 ? 'ativa' : 'teste'),
            expira_em: expira_em ?? null,
          },
        });
        return;
      }

      let statusFinal = status;
      // Saindo do teste para um plano pago sem status explícito → assinatura ativa.
      if (statusFinal === undefined && novoPlano && atual.status === 'teste' && novoPlano.preco.toNumber() > 0) {
        statusFinal = 'ativa';
      }
      await tx.assinatura.update({
        where: { id: atual.id },
        data: {
          ...(novoPlano && { plano_id: novoPlano.id, inicio: new Date() }),
          ...(statusFinal !== undefined && { status: statusFinal }),
          ...(expira_em !== undefined && { expira_em }),
        },
      });
    });

    request.log.info(
      { clinicaId: id, plano_id, status, expira_em, admin: request.adminPlataforma?.id },
      'Assinatura da clínica alterada pelo super admin',
    );
    return obterDetalheClinica(id);
  });
};

export default modulo;
