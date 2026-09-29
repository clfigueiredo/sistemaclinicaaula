/**
 * API do módulo admin-clinicas — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type ClinicaAdmin = { id: string; ... };
 *
 *   export const chavesClinicaAdmin = {
 *     todos: ['admin', 'clinicas'] as const,
 *     lista: (filtros?: object) => [...chavesClinicaAdmin.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesClinicaAdmin.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaClinicaAdmin(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesClinicaAdmin.lista(filtros), queryFn: () => api.get<ClinicaAdmin[]>('/admin/clinicas', filtros) });
 *   }
 *
 *   export function useCriarClinicaAdmin() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<ClinicaAdmin, 'id'>) => api.post<ClinicaAdmin>('/admin/clinicas', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesClinicaAdmin.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 * Chaves de query do admin DEVEM começar com 'admin' (são limpas no logout do super admin).
 *
 */
export {};
