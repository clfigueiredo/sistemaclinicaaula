/**
 * Módulo contratacao — a própria clínica contrata um plano pago com pagamento online, e a landing page lista
 * os planos.
 *
 * Prefixo "" (as rotas trazem o caminho completo).
 *
 * PÚBLICO (sem JWT, rate limit por IP):
 *   GET  /publico/planos     planos ativos com `exibir_landing` (preço crescente): { id, nome, descricao, preco,
 *                            gratuito, plano_cadastro, recursos: [{ codigo, nome, tipo, limite, periodo }] (só os inclusos) }
 *
 * CLÍNICA (admin da clínica):
 *   GET  /contratacao        { plano_atual, status_assinatura, pode_contratar, motivo, mensagem, planos, pendente }
 *                            planos = ativos + `contratavel` + preço > 0; pendente = cobrança de contratação em aberto
 *   POST /contratacao        { plano_id } ⇒ 201 { cobranca, link_pagamento } — gera a cobrança no gateway ativo
 *                            (vencimento hoje). Mesma escolha com cobrança pendente ⇒ devolve a mesma (200);
 *                            outra escolha ⇒ cancela a anterior e gera nova.
 *
 * Regras:
 * - Só clínica em plano GRATUITO (teste grátis) contrata por aqui; troca entre planos pagos continua com o super admin.
 * - O plano só muda quando o gateway confirma o pagamento (webhook ⇒ admin-cobranca/servico.ts, `aplicarEvento`):
 *   troca o plano, assinatura `ativa`, `expira_em` = fim do ciclo, cobrança mensal automática ligada.
 * - Cobrança de contratação em aberto não conta como dívida (não deixa a clínica `vencida`).
 * - Prisma CRU (planos, cobranças e assinaturas são da plataforma); a clínica vem sempre do token.
 * - Uma contratação por vez por clínica (advisory lock na transação que envolve a geração).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Plano, PlanoRecurso } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { exigirPapel } from '../../plugins/auth';
import { CATALOGO_RECURSOS } from '../../plugins/recursos';
import { provedorAtivo } from '../../servicos/pagamentos';
import { ErroNegocio, ou404 } from '../../utils/erros';
import { cancelarCobranca, gerarCobranca, hojeIso, serializarCobranca } from '../admin-cobranca/servico';

export const prefixo = '';

const CorpoContratar = z.object({ plano_id: z.uuid('Plano inválido') });

/** Plano para vitrine (landing e /planos): só o que interessa ao cliente, recursos inclusos na ordem do catálogo. */
function serializarPlanoPublico(plano: Plano & { recursos: PlanoRecurso[] }) {
  const recursos = [...CATALOGO_RECURSOS]
    .sort((a, b) => a.ordem - b.ordem)
    .flatMap((r) => {
      const pr = plano.recursos.find((x) => x.recurso_codigo === r.codigo);
      if (!pr?.habilitado) return [];
      const ehLimite = r.tipo === 'limite';
      return [
        {
          codigo: r.codigo,
          nome: r.nome,
          tipo: r.tipo,
          limite: ehLimite ? pr.limite : null,
          periodo: ehLimite ? pr.periodo : null,
        },
      ];
    });
  return {
    id: plano.id,
    nome: plano.nome,
    descricao: plano.descricao,
    preco: plano.preco.toFixed(2),
    gratuito: !(plano.preco.toNumber() > 0),
    plano_cadastro: plano.plano_cadastro,
    recursos,
  };
}

const ordemPlanos = [{ preco: 'asc' as const }, { nome: 'asc' as const }];

async function planosContrataveis() {
  const planos = await prisma.plano.findMany({
    where: { ativo: true, contratavel: true, preco: { gt: 0 } },
    include: { recursos: true },
    orderBy: ordemPlanos,
  });
  return planos.map(serializarPlanoPublico);
}

/** Cobranças de contratação em aberto da clínica (a mais recente primeiro). */
function contratacoesEmAberto(clinicaId: string) {
  return prisma.cobranca.findMany({
    where: { clinica_id: clinicaId, plano_contratado_id: { not: null }, status: { in: ['pendente', 'vencida'] } },
    omit: { payload: true },
    include: { plano_contratado: { select: { nome: true } } },
    orderBy: { criado_em: 'desc' },
  });
}

type Situacao = { pode: boolean; motivo: 'plano_pago' | 'assinatura_inativa' | 'pagamento_indisponivel' | null; mensagem: string | null };

async function situacaoContratacao(clinicaId: string) {
  const assinatura = await prisma.assinatura.findUnique({
    where: { clinica_id: clinicaId },
    include: { plano: { select: { id: true, nome: true, preco: true } } },
  });
  let situacao: Situacao = { pode: true, motivo: null, mensagem: null };
  if (assinatura && assinatura.plano.preco.toNumber() > 0) {
    situacao = {
      pode: false,
      motivo: 'plano_pago',
      mensagem: 'Sua clínica já está num plano pago. Para trocar de plano, fale com o suporte.',
    };
  } else if (assinatura && (assinatura.status === 'cancelada' || assinatura.status === 'bloqueada')) {
    situacao = {
      pode: false,
      motivo: 'assinatura_inativa',
      mensagem: 'Sua assinatura está suspensa. Fale com o suporte para regularizar.',
    };
  } else if (!(await provedorAtivo())) {
    situacao = {
      pode: false,
      motivo: 'pagamento_indisponivel',
      mensagem: 'O pagamento online está indisponível no momento. Fale com o suporte para contratar um plano.',
    };
  }
  return { assinatura, situacao };
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ público (landing page)
  app.get('/publico/planos', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_request, reply) => {
    const planos = await prisma.plano.findMany({
      where: { ativo: true, exibir_landing: true },
      include: { recursos: true },
      orderBy: ordemPlanos,
    });
    reply.header('Cache-Control', 'public, max-age=60');
    return planos.map(serializarPlanoPublico);
  });

  // ------------------------------------------------------------------ clínica
  app.get('/contratacao', { preHandler: exigirPapel('admin') }, async (request) => {
    const { assinatura, situacao } = await situacaoContratacao(request.clinicaId);
    const [planos, abertas] = await Promise.all([planosContrataveis(), contratacoesEmAberto(request.clinicaId)]);
    const pendente = abertas.find((c) => c.status === 'pendente') ?? null;
    return {
      plano_atual: assinatura
        ? { id: assinatura.plano.id, nome: assinatura.plano.nome, preco: assinatura.plano.preco.toFixed(2) }
        : null,
      status_assinatura: assinatura?.status ?? null,
      pode_contratar: situacao.pode,
      motivo: situacao.motivo,
      mensagem: situacao.mensagem,
      planos,
      pendente: pendente
        ? { ...serializarCobranca(pendente), plano_nome: pendente.plano_contratado?.nome ?? null }
        : null,
    };
  });

  app.post(
    '/contratacao',
    {
      preHandler: exigirPapel('admin'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: CorpoContratar },
    },
    async (request, reply) => {
      const clinicaId = request.clinicaId;
      const { situacao } = await situacaoContratacao(clinicaId);
      if (!situacao.pode) throw new ErroNegocio(409, situacao.motivo!, situacao.mensagem!);

      const plano = ou404(await prisma.plano.findUnique({ where: { id: request.body.plano_id } }), 'Plano não encontrado.');
      if (!plano.ativo || !plano.contratavel || !(plano.preco.toNumber() > 0)) {
        throw new ErroNegocio(409, 'plano_indisponivel', 'Este plano não está disponível para contratação.');
      }

      // Uma contratação por vez por clínica: o lock fica preso à transação enquanto a cobrança é gerada no gateway.
      const resultado = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contratacao:${clinicaId}`}))`;
          const abertas = await contratacoesEmAberto(clinicaId);
          const mesma = abertas.find((c) => c.status === 'pendente' && c.plano_contratado_id === plano.id && c.link_pagamento);
          if (mesma) return { cobranca: serializarCobranca(mesma), nova: false };
          // Escolha anterior (outro plano, ou vencida sem pagamento): cancela para não ficarem duas em aberto.
          for (const c of abertas) await cancelarCobranca(c.id);
          const cobranca = await gerarCobranca({
            clinicaId,
            vencimento: hojeIso(),
            planoContratado: { id: plano.id, nome: plano.nome, preco: plano.preco.toNumber() },
          });
          return { cobranca: cobranca!, nova: true };
        },
        { maxWait: 10_000, timeout: 60_000 },
      );

      request.log.info(
        { clinicaId, planoId: plano.id, cobrancaId: resultado.cobranca.id, nova: resultado.nova },
        'Contratação de plano pela clínica',
      );
      return reply
        .status(resultado.nova ? 201 : 200)
        .send({ cobranca: resultado.cobranca, link_pagamento: resultado.cobranca.link_pagamento });
    },
  );
};

export default modulo;
