/**
 * API da lista de espera.   [STUB — fase 2, DONO: lista-espera]  Contrato: docs/FASE2.md §3.
 *
 * Hooks previstos: useListaEspera(filtros), useCriarItemListaEspera, useEditarItemListaEspera,
 * useMudarStatusListaEspera, useSugestoesListaEspera(agendamentoId), useVagasRecentes (polling 60 s),
 * useOferecerHorario (invalidar também ['whatsapp'] e chavesMe.me — consome max_mensagens).
 */
export const chavesListaEspera = {
  todos: ['lista-espera'] as const,
  lista: (filtros: object) => [...chavesListaEspera.todos, 'lista', filtros] as const,
  sugestoes: (agendamentoId: string) => [...chavesListaEspera.todos, 'sugestoes', agendamentoId] as const,
  vagasRecentes: () => [...chavesListaEspera.todos, 'vagas-recentes'] as const,
};
