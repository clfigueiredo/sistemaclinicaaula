/**
 * Módulo lista-espera — pacientes aguardando vaga + sugestões quando um horário é liberado.   [STUB — fase 2]
 *
 * Contrato completo: docs/FASE2.md §3. Recurso do plano: `lista_espera`. Tabela: lista_espera.
 *
 * Rotas (prefixo "/lista-espera"; autenticarClinica + exigirRecurso('lista_espera')):
 *   GET   /lista-espera?status&profissional_id&pagina&por_pagina   admin, recepção (profissional: 403 em todo o módulo)
 *   POST  /lista-espera                                admin, recepção   { paciente_id, profissional_id?, dias_semana?, turnos?, observacao? }
 *   PUT   /lista-espera/:id                            admin, recepção
 *   PATCH /lista-espera/:id/status                     admin, recepção   { status, agendamento_id? }
 *   GET   /lista-espera/sugestoes?agendamento_id       admin, recepção   itens compatíveis com o horário do agendamento
 *                                                                         CANCELADO/FALTOU (profissional, dia da semana, turno)
 *   GET   /lista-espera/vagas-recentes                 admin, recepção   cancelamentos futuros recentes com sugestões
 *                                                                         (alimenta o aviso no topo — AvisoTopoListaEspera)
 *   POST  /lista-espera/:id/oferecer                   admin, recepção   { agendamento_id } ⇒ WhatsApp `oferta_horario`
 *
 * Regras:
 *   - Integração com o cancelamento: NÃO há hook no módulo agendamentos. A agenda (PainelAgendamento) mostra
 *     <SugestoesListaEspera /> para agendamento cancelado/faltou, que chama GET /lista-espera/sugestoes.
 *     O horário só é "vago" se ainda não houver outro agendamento ocupando (validarConflito / calcularDisponibilidade).
 *   - Turnos (fuso da clínica): manhã < 12:00, tarde 12:00–17:59, noite ≥ 18:00. Listas vazias = qualquer.
 *   - Oferta: enfileirarMensagem({ tipo: 'oferta_horario', conteudo: textoOfertaHorario(...) }) e grava
 *     ultima_oferta_em. Agendar de fato é pela agenda normal; depois PATCH status `agendado` + agendamento_id.
 *   - Valide paciente/profissional/agendamento pelo request.db.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';

export const prefixo = '/lista-espera';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('lista_espera'));
  // TODO(lista-espera): implementar as rotas acima.
};

export default modulo;
