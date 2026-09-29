/**
 * API do módulo admin-planos — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type Plano = { id: string; ... };
 *
 *   export const chavesPlano = {
 *     todos: ['admin', 'planos'] as const,
 *     lista: (filtros?: object) => [...chavesPlano.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesPlano.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaPlano(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesPlano.lista(filtros), queryFn: () => api.get<Plano[]>('/admin/planos', filtros) });
 *   }
 *
 *   export function useCriarPlano() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<Plano, 'id'>) => api.post<Plano>('/admin/planos', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesPlano.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 * Chaves de query do admin DEVEM começar com 'admin' (são limpas no logout do super admin).
 *
 */
export {};
