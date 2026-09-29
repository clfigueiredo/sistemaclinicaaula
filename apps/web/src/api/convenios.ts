/**
 * API do módulo convênios (apenas o nome; sem faturamento TISS).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';

export type Convenio = {
  id: string;
  nome: string;
  ativo: boolean;
  criado_em: string;
  /** Quantos pacientes/agendamentos usam o convênio (em uso = não pode ser excluído). */
  uso: { pacientes: number; agendamentos: number };
};

export type FiltrosConvenios = { ativos?: boolean; busca?: string };

export const chavesConvenio = {
  todos: ['convenios'] as const,
  lista: (filtros?: FiltrosConvenios) => [...chavesConvenio.todos, 'lista', filtros ?? {}] as const,
};

export function useListaConvenios(filtros?: FiltrosConvenios) {
  return useQuery({
    queryKey: chavesConvenio.lista(filtros),
    queryFn: () => api.get<Convenio[]>('/convenios', filtros),
  });
}

export function useCriarConvenio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: { nome: string }) => api.post<Convenio>('/convenios', dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesConvenio.todos }),
  });
}

export function useEditarConvenio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dados }: { id: string; nome?: string; ativo?: boolean }) =>
      api.put<Convenio>(`/convenios/${id}`, dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesConvenio.todos }),
  });
}

export function useExcluirConvenio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/convenios/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesConvenio.todos }),
  });
}
