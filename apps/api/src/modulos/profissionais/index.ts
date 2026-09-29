/**
 * Módulo profissionais — Profissionais + grade de horários + bloqueios de agenda
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/profissionais"):
 *   GET    /profissionais                     lista (todos os papéis)
 *   GET    /profissionais/:id                 detalhe com horários
 *   POST   /profissionais                     exigirPapel("admin") + verificarLimite("max_profissionais")
 *   PUT    /profissionais/:id                 exigirPapel("admin") (reativar também verifica limite)
 *   PUT    /profissionais/:id/horarios        substitui a grade semanal (dia_semana 0-6, "HH:mm")
 *   GET    /profissionais/bloqueios           bloqueios (filtro profissional_id; null = clínica toda)
 *   POST   /profissionais/bloqueios           exigirPapel("admin", "recepcao")
 *   DELETE /profissionais/bloqueios/:id
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * dados SEMPRE via request.db (tenant), nunca clinica_id do body/query,
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';

export const prefixo = '/profissionais';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
