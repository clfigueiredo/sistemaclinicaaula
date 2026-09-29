/**
 * API do módulo whatsapp — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type SessaoWhatsapp = { id: string; ... };
 *
 *   export const chavesSessaoWhatsapp = {
 *     todos: ['whatsapp'] as const,
 *     lista: (filtros?: object) => [...chavesSessaoWhatsapp.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesSessaoWhatsapp.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaSessaoWhatsapp(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesSessaoWhatsapp.lista(filtros), queryFn: () => api.get<SessaoWhatsapp[]>('/whatsapp', filtros) });
 *   }
 *
 *   export function useCriarSessaoWhatsapp() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<SessaoWhatsapp, 'id'>) => api.post<SessaoWhatsapp>('/whatsapp', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesSessaoWhatsapp.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 */
export {};
