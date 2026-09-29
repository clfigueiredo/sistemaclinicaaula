/**
 * API do módulo convenios — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type Convenio = { id: string; ... };
 *
 *   export const chavesConvenio = {
 *     todos: ['convenios'] as const,
 *     lista: (filtros?: object) => [...chavesConvenio.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesConvenio.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaConvenio(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesConvenio.lista(filtros), queryFn: () => api.get<Convenio[]>('/convenios', filtros) });
 *   }
 *
 *   export function useCriarConvenio() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<Convenio, 'id'>) => api.post<Convenio>('/convenios', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesConvenio.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 */
export {};
