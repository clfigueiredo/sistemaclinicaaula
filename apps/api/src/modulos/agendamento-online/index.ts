/**
 * Módulo agendamento-online — página pública /agendar/:slug + solicitações para a recepção.   [STUB — fase 2]
 *
 * Contrato completo: docs/FASE2.md §2. Recurso do plano: `agendamento_online`.
 * Tabelas: solicitacoes_agendamento, configuracoes_clinica (campos ao_*), clinicas.slug,
 * profissionais.agendamento_online. Prefixo "" (as rotas trazem o caminho completo).
 *
 * PÚBLICAS (sem JWT; rate limit por IP via `config: { rateLimit: {...} }`):
 *   GET  /publico/clinicas/:slug                         dados da clínica + profissionais visíveis + config pública
 *   GET  /publico/clinicas/:slug/disponibilidade?profissional_id&data=YYYY-MM-DD   horários livres
 *   POST /publico/clinicas/:slug/solicitacoes            cria solicitação `pendente` (honeypot `website`)
 *   Disponível só se: clínica ativa + assinatura ativa (assinaturaEstaAtiva) + recurso habilitado
 *   (assegurarRecurso) + configuracoes_clinica.ao_ativo. Caso contrário 404 `agendamento_indisponivel`
 *   (mesma resposta para slug inexistente — não revela o motivo). Resolva a clínica pelo slug com o prisma
 *   cru e use `criarDbTenant(clinica.id)` para reusar os serviços da agenda (calcularDisponibilidade…).
 *
 * INTERNAS (autenticarClinica + exigirRecurso('agendamento_online')):
 *   GET  /solicitacoes?status&pagina&por_pagina          admin, recepção   Paginado
 *   GET  /solicitacoes/resumo                            admin, recepção   { pendentes } (badge do menu/topo)
 *   GET  /solicitacoes/:id                               admin, recepção   + pacientes_candidatos (CPF/telefone)
 *   POST /solicitacoes/:id/aprovar                       admin, recepção   cria/casa paciente + agendamento
 *   POST /solicitacoes/:id/recusar                       admin, recepção   { motivo?, notificar? }
 *   GET  /agendamento-online/configuracao                admin
 *   PUT  /agendamento-online/configuracao                admin             (slug é editado em PUT /me/clinica)
 *
 * Regras:
 *   - Solicitação NÃO consome max_agendamentos; a APROVAÇÃO consome (assegurarLimite com tx) e cria o
 *     agendamento com as validações normais: travarAgendaProfissional + validarHorario
 *     (modulos/agendamentos/servico.ts), `criado_por` = usuário que aprovou.
 *   - Anti-abuso: rate limit por IP, honeypot, máx. `ao_max_pendentes_por_telefone` pendentes por telefone
 *     (409 `limite_solicitacoes`), grava ip/user_agent. Horário revalidado no POST (409 `horario_indisponivel`).
 *   - WhatsApp pela fila, DEPOIS do commit: aprovada ⇒ tipo `agendamento_confirmado`
 *     (textoAgendamentoOnlineConfirmado); recusada ⇒ `agendamento_recusado` (textoAgendamentoOnlineRecusado)
 *     com `pacienteId: null, telefone, consentimentoExterno: solicitacao.aceita_whatsapp`.
 *   - Worker: workers/solicitacoesAgendamento.ts (expira pendentes cujo horário passou).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';

export const prefixo = '';

const modulo: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- públicas
  await app.register(async (publico) => {
    // TODO(agendamento-online): GET /publico/clinicas/:slug, /disponibilidade, POST /solicitacoes
    // com `config: { rateLimit: { max: 60, timeWindow: '1 minute' } }` nos GET e max 5/min no POST.
    void publico;
  });

  // ---------------------------------------------------------------- internas
  await app.register(async (interno) => {
    interno.addHook('onRequest', autenticarClinica);
    interno.addHook('preHandler', exigirRecurso('agendamento_online'));
    // TODO(agendamento-online): /solicitacoes* e /agendamento-online/configuracao
  });
};

export default modulo;
