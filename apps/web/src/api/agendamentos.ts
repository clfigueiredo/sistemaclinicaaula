/**
 * API do módulo agendamentos — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type Agendamento = { id: string; ... };
 *
 *   export const chavesAgendamento = {
 *     todos: ['agendamentos'] as const,
 *     lista: (filtros?: object) => [...chavesAgendamento.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesAgendamento.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaAgendamento(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesAgendamento.lista(filtros), queryFn: () => api.get<Agendamento[]>('/agendamentos', filtros) });
 *   }
 *
 *   export function useCriarAgendamento() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<Agendamento, 'id'>) => api.post<Agendamento>('/agendamentos', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesAgendamento.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 */
export {};
