/**
 * API do agendamento online.   [STUB — fase 2, DONO: agendamento-online]  Contrato: docs/FASE2.md §2.
 *
 * Rotas PÚBLICAS (/publico/clinicas/:slug...) funcionam sem login: o cliente HTTP manda o token da clínica
 * se houver, e a API ignora. Chaves públicas começam com 'publico'.
 * Aprovar solicitação consome max_agendamentos: invalide também chavesMe.me e ['agendamentos'].
 *
 * Hooks previstos: useClinicaPublica(slug), useDisponibilidadePublica(slug, profissionalId, data),
 * useEnviarSolicitacao(slug), useSolicitacoes(filtros), useResumoSolicitacoes (polling 60 s),
 * useSolicitacao(id), useAprovarSolicitacao, useRecusarSolicitacao, useConfigAgendamentoOnline,
 * useSalvarConfigAgendamentoOnline.
 */
export const chavesAgendamentoOnline = {
  publico: (slug: string) => ['publico', 'clinica', slug] as const,
  disponibilidadePublica: (slug: string, profissionalId: string, data: string) =>
    ['publico', 'clinica', slug, 'disponibilidade', { profissionalId, data }] as const,
  todos: ['solicitacoes'] as const,
  lista: (filtros: object) => [...chavesAgendamentoOnline.todos, 'lista', filtros] as const,
  resumo: () => [...chavesAgendamentoOnline.todos, 'resumo'] as const,
  detalhe: (id: string) => [...chavesAgendamentoOnline.todos, 'detalhe', id] as const,
  configuracao: ['agendamento-online', 'configuracao'] as const,
};
