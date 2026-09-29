/**
 * Módulo usuarios — Usuários da clínica
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/usuarios"):
 *   GET    /usuarios           exigirPapel("admin")
 *   POST   /usuarios           exigirPapel("admin"); papel recepcao → verificarLimite("max_recepcionistas")
 *   PUT    /usuarios/:id       exigirPapel("admin"); mudar para recepcao/reativar recepcao → assegurarLimite
 *   PUT    /usuarios/:id/senha redefinir senha (admin) ou a própria senha
 *
 * - Senha com gerarHashSenha() de src/utils/senha.ts. E-mail único por clínica (@@unique clinica_id+email).
 * - O admin não conta no limite de recepcionistas. Papel profissional exige profissional_id da mesma clínica.
 * - Não permitir que o último admin ativo seja desativado/rebaixado.
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * dados SEMPRE via request.db (tenant), nunca clinica_id do body/query,
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';

export const prefixo = '/usuarios';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
