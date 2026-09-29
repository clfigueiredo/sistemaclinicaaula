/**
 * Módulo convenios — Convênios (apenas nome; sem TISS)
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/convenios"):
 *   GET    /convenios          lista (filtro ativo)
 *   POST   /convenios          exigirPapel("admin", "recepcao")
 *   PUT    /convenios/:id      exigirPapel("admin", "recepcao")
 *   DELETE /convenios/:id      exigirPapel("admin") — prefira desativar (ativo=false)
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * dados SEMPRE via request.db (tenant), nunca clinica_id do body/query,
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';

export const prefixo = '/convenios';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
