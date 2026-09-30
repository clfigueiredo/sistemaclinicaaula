/**
 * Módulo retornos — "retorno em X dias" + convite pelo WhatsApp + lista para a recepção.   [STUB — fase 2]
 *
 * Contrato completo: docs/FASE2.md §5. Recurso do plano: `retorno_automatico`. Tabelas: retornos,
 * configuracoes_clinica (retorno_convite_ativo, retorno_dias_antecedencia).
 *
 * Rotas (prefixo "/retornos"; autenticarClinica + exigirRecurso('retorno_automatico')):
 *   GET   /retornos?status&inicio&fim&profissional_id&pagina&por_pagina   todos (profissional: só os dele)
 *   GET   /retornos/agendamento/:agendamentoId     todos   retorno do agendamento de origem (ou null)
 *   POST  /retornos                                todos   { agendamento_origem_id, dias? | data_prevista?, observacao? }
 *   PUT   /retornos/:id                            todos   { data_prevista?, observacao? } (só pendente/lembrado)
 *   PATCH /retornos/:id/status                     todos   { status: 'agendado' | 'cancelado', agendamento_retorno_id? }
 *   POST  /retornos/:id/convidar                   admin, recepção   envia o convite agora (WhatsApp)
 *   GET   /retornos/configuracao                   admin
 *   PUT   /retornos/configuracao                   admin   { convite_ativo?, dias_antecedencia? }
 *
 * Regras:
 *   - Origem precisa estar `compareceu` ou `atendido` (409 `status_invalido`); um retorno por origem
 *     (409 `retorno_existente` — use PUT). Profissional só em agendamentos da própria agenda.
 *   - data_prevista = dia local da origem + dias (fuso da clínica), gravada como @db.Date.
 *   - Integração com a agenda: <DefinirRetorno /> no PainelAgendamento (status compareceu/atendido).
 *     NÃO há hook no módulo agendamentos: o job diário (workers/retornos.ts) reconcilia `agendado`
 *     (agendamento futuro do mesmo paciente+profissional) e envia os convites (tipo `convite_retorno`,
 *     textoConviteRetorno, link `${env.WEB_URL_PUBLICA}/agendar/<slug>` se agendamento online ativo).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';

export const prefixo = '/retornos';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('retorno_automatico'));
  // TODO(retornos): implementar as rotas acima.
};

export default modulo;
