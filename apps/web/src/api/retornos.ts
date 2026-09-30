/**
 * API dos retornos.   [STUB — fase 2, DONO: retornos]  Contrato: docs/FASE2.md §5.
 *
 * Hooks previstos: useRetornos(filtros), useRetornoDoAgendamento(agendamentoId), useCriarRetorno,
 * useEditarRetorno, useMudarStatusRetorno, useConvidarRetorno (invalidar ['whatsapp'] e chavesMe.me),
 * useConfigRetornos, useSalvarConfigRetornos.
 */
export const chavesRetornos = {
  todos: ['retornos'] as const,
  lista: (filtros: object) => [...chavesRetornos.todos, 'lista', filtros] as const,
  agendamento: (agendamentoId: string) => [...chavesRetornos.todos, 'agendamento', agendamentoId] as const,
  configuracao: () => [...chavesRetornos.todos, 'configuracao'] as const,
};
