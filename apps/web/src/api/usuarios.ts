/**
 * API do módulo usuarios — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type Usuario = { id: string; ... };
 *
 *   export const chavesUsuario = {
 *     todos: ['usuarios'] as const,
 *     lista: (filtros?: object) => [...chavesUsuario.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesUsuario.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaUsuario(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesUsuario.lista(filtros), queryFn: () => api.get<Usuario[]>('/usuarios', filtros) });
 *   }
 *
 *   export function useCriarUsuario() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<Usuario, 'id'>) => api.post<Usuario>('/usuarios', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesUsuario.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 */
export {};
