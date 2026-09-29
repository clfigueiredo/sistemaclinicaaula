/**
 * Módulo agendamentos — Agenda / agendamentos
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "/agendamentos"):
 *   GET    /agendamentos?inicio&fim&profissional_id   eventos do período (profissional vê só a própria agenda)
 *   GET    /agendamentos/disponibilidade?profissional_id&data   horários livres (grade − bloqueios − ocupados)
 *   POST   /agendamentos            assegurarLimite(clinicaId, "max_agendamentos", { tx }) dentro de $transaction
 *   PUT    /agendamentos/:id        remarcar/editar
 *   PATCH  /agendamentos/:id/status agendado→confirmado→compareceu→atendido | cancelado | faltou
 *
 * - Validar que paciente_id/profissional_id/convenio_id são da clínica (findUnique via request.db).
 * - tipo "convenio" exige convenio_id. criado_por = request.usuarioClinica.id.
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * dados SEMPRE via request.db (tenant), nunca clinica_id do body/query,
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';

export const prefixo = '/agendamentos';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  // TODO(fase 2): implementar as rotas listadas acima.
};

export default modulo;
