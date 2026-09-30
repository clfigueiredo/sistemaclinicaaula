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
 *                                           pago sem status explícito → `ativa`. Plano PAGO atribuído com gateway de
 *                                           cobrança ativo ⇒ liga a cobrança automática (admin-cobranca:
 *                                           ativarCobrancaAutomatica; dia = o da assinatura ou o padrão do gateway).
 *                                           Resposta = detalhe + `cobranca_automatica: null | { ativada, mensagem }`
 *                                           (falha no gateway não desfaz a troca de plano).
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
import { provedorAtivo } from '../../servicos/pagamentos';
import { ativarCobrancaAutomatica } from '../admin-cobranca/servico';
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

    const planoPagoAtribuido = await prisma.$transaction(async (tx) => {
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
        return novoPlano.preco.toNumber() > 0;
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
      return !!novoPlano && novoPlano.preco.toNumber() > 0;
    });

    request.log.info(
      { clinicaId: id, plano_id, status, expira_em, admin: request.adminPlataforma?.id },
      'Assinatura da clínica alterada pelo super admin',
    );
    const cobranca_automatica = planoPagoAtribuido ? await ligarCobrancaAutomatica(id, request.log) : null;
    return { ...(await obterDetalheClinica(id)), cobranca_automatica };
  });
};

/**
 * Plano pago atribuído: liga a cobrança automática no gateway ativo (se houver). Nunca lança — sem gateway
 * ativo devolve null; falha no gateway vira `{ ativada: false, mensagem }` (o plano já foi trocado).
 */
async function ligarCobrancaAutomatica(
  clinicaId: string,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
): Promise<{ ativada: boolean; mensagem: string } | null> {
  const provedor = await provedorAtivo();
  if (!provedor) return null;
  const [assinatura, gateway] = await Promise.all([
    prisma.assinatura.findUnique({ where: { clinica_id: clinicaId }, select: { status: true, dia_vencimento: true } }),
    prisma.gatewayPagamento.findUnique({ where: { provedor }, select: { dia_vencimento_padrao: true } }),
  ]);
  if (!assinatura || assinatura.status === 'cancelada' || assinatura.status === 'bloqueada') return null;
  const diaVencimento = assinatura.dia_vencimento ?? gateway?.dia_vencimento_padrao ?? 10;
  try {
    const r = await ativarCobrancaAutomatica({ clinicaId, diaVencimento });
    log.info({ clinicaId, gateway: provedor, diaVencimento }, 'Cobrança automática ligada ao atribuir plano pago');
    return {
      ativada: true,
      mensagem: r.cobranca
        ? `Cobrança automática ativada (vencimento todo dia ${diaVencimento}); primeira cobrança gerada.`
        : `Cobrança automática ativada (vencimento todo dia ${diaVencimento}).`,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Erro desconhecido';
    log.warn({ clinicaId, gateway: provedor, erro: mensagem }, 'Falha ao ligar a cobrança automática');
    return { ativada: false, mensagem: `Plano alterado, mas a cobrança automática não foi ativada: ${mensagem}` };
  }
}

export default modulo;
