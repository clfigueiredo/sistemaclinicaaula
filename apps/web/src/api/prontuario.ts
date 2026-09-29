/**
 * API do módulo prontuario — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type RegistroProntuario = { id: string; ... };
 *
 *   export const chavesRegistroProntuario = {
 *     todos: ['prontuario'] as const,
 *     lista: (filtros?: object) => [...chavesRegistroProntuario.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesRegistroProntuario.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaRegistroProntuario(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesRegistroProntuario.lista(filtros), queryFn: () => api.get<RegistroProntuario[]>('/prontuario', filtros) });
 *   }
 *
 *   export function useCriarRegistroProntuario() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<RegistroProntuario, 'id'>) => api.post<RegistroProntuario>('/prontuario', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesRegistroProntuario.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 */
export {};
