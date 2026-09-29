/**
 * Módulo admin-clinicas — Clínicas e assinaturas (painel super admin)
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/admin/clinicas"):
 *   GET    /admin/clinicas            lista (busca, status, plano) com assinatura
 *   GET    /admin/clinicas/:id        detalhe + uso dos recursos (obterUsoERecursos)
 *   PATCH  /admin/clinicas/:id        dados/status da clínica (ativa|inativa)
 *   PUT    /admin/clinicas/:id/assinatura  troca plano/status/expira_em
 *   GET    /admin/dashboard           (opcional) totais para o dashboard do admin
 *
 * - Usa o prisma CRU. Nunca exclua clínicas com prontuário (trigger de imutabilidade).
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * prisma cru (plataforma),
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarAdmin } from '../../plugins/auth';

export const prefixo = '/admin/clinicas';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarAdmin);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
