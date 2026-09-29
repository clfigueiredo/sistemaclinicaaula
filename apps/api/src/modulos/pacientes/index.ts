/**
 * Módulo pacientes — Pacientes + alergias + medicações
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/pacientes"):
 *   GET    /pacientes                  busca paginada (nome, cpf, telefone)
 *   GET    /pacientes/:id              dados cadastrais + alergias + medicações
 *   POST   /pacientes                  admin/recepcao
 *   PUT    /pacientes/:id              admin/recepcao
 *   POST   /pacientes/:id/alergias     | DELETE /pacientes/:id/alergias/:alergiaId
 *   POST   /pacientes/:id/medicacoes   | DELETE /pacientes/:id/medicacoes/:medicacaoId
 *
 * - aceita_whatsapp é o consentimento LGPD (checkbox explícito no cadastro).
 * - Sem nested writes: crie alergias/medicações em chamadas separadas (ver tenant.ts).
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * dados SEMPRE via request.db (tenant), nunca clinica_id do body/query,
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';

export const prefixo = '/pacientes';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
