/**
 * Módulo admin-planos — Planos e recursos (painel super admin)
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/admin/planos"):
 *   GET    /admin/planos              lista planos com recursos
 *   GET    /admin/planos/recursos     catálogo de recursos (tabela `recursos`)
 *   GET    /admin/planos/:id          detalhe
 *   POST   /admin/planos              cria plano + plano_recursos
 *   PUT    /admin/planos/:id          atualiza plano + plano_recursos (habilitado, limite, periodo)
 *   PATCH  /admin/planos/:id/cadastro marca como plano_cadastro (desmarca os outros na mesma transação)
 *
 * - Usa o prisma CRU (src/lib/prisma.ts): dados de plataforma, sem clinica_id.
 * - Só um plano pode ter plano_cadastro = true (há índice único parcial no banco).
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * prisma cru (plataforma),
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarAdmin } from '../../plugins/auth';

export const prefixo = '/admin/planos';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarAdmin);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
