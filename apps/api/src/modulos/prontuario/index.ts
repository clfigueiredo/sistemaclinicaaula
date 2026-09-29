/**
 * Módulo prontuario — Prontuário (imutável) + anexos
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/prontuario"):
 *   GET    /prontuario/pacientes/:pacienteId          registros (exigirPapel("admin","profissional")) + logAcesso visualizar
 *   POST   /prontuario/pacientes/:pacienteId          novo registro + logAcesso criar (sem update/delete!)
 *   GET    /prontuario/pacientes/:pacienteId/anexos   lista anexos
 *   POST   /prontuario/pacientes/:pacienteId/anexos   multipart; verificarLimite("max_anexos"); grava em env.UPLOAD_DIR_ABS
 *   GET    /prontuario/anexos/:id/download            stream do arquivo + logAcesso baixar
 *
 * - RECEPÇÃO NÃO VÊ PRONTUÁRIO: todas as rotas com exigirPapel("admin", "profissional").
 * - Profissional só vê prontuário dos SEUS pacientes (com agendamento com ele) — regra da arquitetura.
 * - Correção = novo registro com corrige_registro_id. update/delete lançam erro (extensão + trigger).
 * - Anexos: request.file() do @fastify/multipart (já registrado; limite UPLOAD_MAX_MB). Não sirva a pasta de uploads como estática.
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * dados SEMPRE via request.db (tenant), nunca clinica_id do body/query,
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';

export const prefixo = '/prontuario';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
