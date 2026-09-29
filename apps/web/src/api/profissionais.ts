/**
 * API do módulo profissionais — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type Profissional = { id: string; ... };
 *
 *   export const chavesProfissional = {
 *     todos: ['profissionais'] as const,
 *     lista: (filtros?: object) => [...chavesProfissional.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesProfissional.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaProfissional(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesProfissional.lista(filtros), queryFn: () => api.get<Profissional[]>('/profissionais', filtros) });
 *   }
 *
 *   export function useCriarProfissional() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<Profissional, 'id'>) => api.post<Profissional>('/profissionais', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesProfissional.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 */
export {};
