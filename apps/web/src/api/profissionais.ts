/**
 * API do módulo profissionais: profissionais, grade semanal de horários e bloqueios de agenda.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesMe } from './me';
import type { Papel } from './tipos';

export type Profissional = {
  id: string;
  nome: string;
  especialidade: string | null;
  registro: string | null;
  telefone: string | null;
  email: string | null;
  duracao_consulta_min: number;
  cor_agenda: string;
  ativo: boolean;
};

export type HorarioProfissional = {
  id?: string;
  /** 0 = domingo … 6 = sábado */
  dia_semana: number;
  hora_inicio: string;
  hora_fim: string;
};

export type BloqueioAgenda = {
  id: string;
  /** null = clínica toda (feriado, recesso…) */
  profissional_id: string | null;
  inicio: string;
  fim: string;
  motivo: string | null;
  criado_em: string;
  profissional: { id: string; nome: string; cor_agenda: string } | null;
};

export type ProfissionalDetalhe = Profissional & {
  criado_em: string;
  atualizado_em: string;
  usuario: { id: string; nome: string; email: string; papel: Papel; ativo: boolean } | null;
  horarios: HorarioProfissional[];
  /** Bloqueios vigentes e futuros do profissional. */
  bloqueios: BloqueioAgenda[];
};

export type DadosProfissional = {
  nome: string;
  especialidade?: string | null;
  registro?: string | null;
  telefone?: string | null;
  email?: string | null;
  duracao_consulta_min?: number;
  cor_agenda?: string;
};

export type DadosBloqueio = {
  profissional_id: string | null;
  inicio: string;
  fim: string;
  motivo?: string | null;
};

export type FiltrosProfissionais = { ativos?: boolean; busca?: string };
export type FiltrosBloqueios = { inicio?: string; fim?: string; profissionalId?: string; somenteClinica?: boolean };

/** Paleta padrão de cores da agenda (igual à da API). */
export const PALETA_CORES_AGENDA = [
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#ca8a04',
  '#0891b2',
  '#dc2626',
  '#4f46e5',
];

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DIAS_SEMANA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const chavesProfissional = {
  todos: ['profissionais'] as const,
  lista: (filtros?: FiltrosProfissionais) => [...chavesProfissional.todos, 'lista', filtros ?? {}] as const,
  detalhe: (id: string) => [...chavesProfissional.todos, 'detalhe', id] as const,
  bloqueios: (filtros?: FiltrosBloqueios) => [...chavesProfissional.todos, 'bloqueios', filtros ?? {}] as const,
};

export function useListaProfissionais(filtros?: FiltrosProfissionais) {
  return useQuery({
    queryKey: chavesProfissional.lista(filtros),
    queryFn: () => api.get<Profissional[]>('/profissionais', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useProfissional(id: string | undefined) {
  return useQuery({
    queryKey: chavesProfissional.detalhe(id ?? ''),
    queryFn: () => api.get<ProfissionalDetalhe>(`/profissionais/${id}`),
    enabled: !!id,
  });
}

export function useBloqueios(filtros?: FiltrosBloqueios, habilitado = true) {
  return useQuery({
    queryKey: chavesProfissional.bloqueios(filtros),
    queryFn: () => api.get<BloqueioAgenda[]>('/profissionais/bloqueios', filtros),
    enabled: habilitado,
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return (comMe = false) => {
    qc.invalidateQueries({ queryKey: chavesProfissional.todos });
    if (comMe) qc.invalidateQueries({ queryKey: chavesMe.me });
  };
}

export function useCriarProfissional() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: DadosProfissional) => api.post<Profissional>('/profissionais', dados),
    onSuccess: () => invalidar(true),
  });
}

export function useEditarProfissional(id: string) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: Partial<DadosProfissional> & { ativo?: boolean }) =>
      api.put<Profissional>(`/profissionais/${id}`, dados),
    onSuccess: (_r, dados) => invalidar(dados.ativo !== undefined),
  });
}

/** Ativa/desativa qualquer profissional (útil em listas). */
export function useAlterarStatusProfissional() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.put<Profissional>(`/profissionais/${id}`, { ativo }),
    onSuccess: () => invalidar(true),
  });
}

export function useSalvarHorarios(id: string) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (horarios: HorarioProfissional[]) =>
      api.put<HorarioProfissional[]>(`/profissionais/${id}/horarios`, {
        horarios: horarios.map(({ dia_semana, hora_inicio, hora_fim }) => ({ dia_semana, hora_inicio, hora_fim })),
      }),
    onSuccess: () => invalidar(),
  });
}

export function useCriarBloqueio() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: DadosBloqueio) => api.post<BloqueioAgenda>('/profissionais/bloqueios', dados),
    onSuccess: () => invalidar(),
  });
}

export function useRemoverBloqueio() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/profissionais/bloqueios/${id}`),
    onSuccess: () => invalidar(),
  });
}
