/**
 * API do módulo pacientes — TODO(fase 2): tipos + hooks TanStack Query deste módulo.
 *
 * Padrão (copie e adapte):
 *
 *   import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
 *   import { api } from './cliente';
 *   import { chavesMe } from './me';
 *
 *   export type Paciente = { id: string; ... };
 *
 *   export const chavesPaciente = {
 *     todos: ['pacientes'] as const,
 *     lista: (filtros?: object) => [...chavesPaciente.todos, 'lista', filtros ?? {}] as const,
 *     detalhe: (id: string) => [...chavesPaciente.todos, 'detalhe', id] as const,
 *   };
 *
 *   export function useListaPaciente(filtros?: { busca?: string }) {
 *     return useQuery({ queryKey: chavesPaciente.lista(filtros), queryFn: () => api.get<Paciente[]>('/pacientes', filtros) });
 *   }
 *
 *   export function useCriarPaciente() {
 *     const qc = useQueryClient();
 *     return useMutation({
 *       mutationFn: (dados: Omit<Paciente, 'id'>) => api.post<Paciente>('/pacientes', dados),
 *       onSuccess: () => {
 *         qc.invalidateQueries({ queryKey: chavesPaciente.todos });
 *         qc.invalidateQueries({ queryKey: chavesMe.me }); // se consome recurso do plano (atualiza uso)
 *       },
 *     });
 *   }
 *
 */
export {};
