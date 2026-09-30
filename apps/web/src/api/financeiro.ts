/**
 * API do módulo financeiro.   [STUB — fase 2, DONO: financeiro]  Contrato: docs/FASE2.md §1.
 *
 * Padrão: chaves abaixo + useQuery para leitura + useMutation com invalidateQueries(chavesFinanceiro.todos)
 * no onSuccess. Valores chegam como string decimal ("150.00") — use Number()/formatarMoeda; envie number.
 * Datas sem hora ('YYYY-MM-DD'): vencimento, data da movimentação.
 *
 * Hooks previstos: useContasFinanceiras, useCategoriasFinanceiras(tipo?), useMovimentacoes(filtros),
 * useCriarMovimentacao, useEstornarMovimentacao, useRecebimentosAgendamento(agendamentoId),
 * useRegistrarRecebimento, useTitulos(filtros), useCriarTitulo, useBaixarTitulo, useCancelarTitulo,
 * useRecorrencias, useSalvarRecorrencia, useRepasses(filtros), usePagarRepasse, useMeusRecebimentos,
 * useResumoFinanceiro(periodo), useFluxoCaixa, useProfissionaisRepasse, useDefinirPercentualRepasse.
 */
export const chavesFinanceiro = {
  todos: ['financeiro'] as const,
  contas: () => [...chavesFinanceiro.todos, 'contas'] as const,
  categorias: (tipo?: string) => [...chavesFinanceiro.todos, 'categorias', { tipo }] as const,
  movimentacoes: (filtros: object) => [...chavesFinanceiro.todos, 'movimentacoes', filtros] as const,
  recebimentosAgendamento: (agendamentoId: string) =>
    [...chavesFinanceiro.todos, 'recebimentos', agendamentoId] as const,
  titulos: (filtros: object) => [...chavesFinanceiro.todos, 'titulos', filtros] as const,
  recorrencias: () => [...chavesFinanceiro.todos, 'recorrencias'] as const,
  repasses: (filtros: object) => [...chavesFinanceiro.todos, 'repasses', filtros] as const,
  meusRecebimentos: (filtros: object) => [...chavesFinanceiro.todos, 'meus-recebimentos', filtros] as const,
  relatorios: (tipo: string, filtros: object) => [...chavesFinanceiro.todos, 'relatorios', tipo, filtros] as const,
  profissionais: () => [...chavesFinanceiro.todos, 'profissionais'] as const,
};
