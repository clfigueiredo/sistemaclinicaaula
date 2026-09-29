/**
 * API do módulo agendamentos (agenda): tipos + hooks TanStack Query.
 *
 * Chaves: ['agendamentos', ...]. Mutations invalidam ['agendamentos'] e ['me'] (uso do plano).
 * Para a tela da agenda também há rotas de apoio no próprio módulo:
 *   GET /agendamentos/profissionais  (profissional logado recebe só ele mesmo)
 *   GET /agendamentos/bloqueios?inicio&fim[&profissionalId]
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesMe } from './me';
import type { StatusAgendamento, TipoAgendamento } from './tipos';

export type Agendamento = {
  id: string;
  paciente_id: string;
  profissional_id: string;
  convenio_id: string | null;
  inicio: string;
  fim: string;
  tipo: TipoAgendamento;
  status: StatusAgendamento;
  observacoes: string | null;
  criado_por: string | null;
  lembrete_enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
  paciente: { id: string; nome: string; telefone: string | null; whatsapp: string | null };
  profissional: { id: string; nome: string; cor_agenda: string };
  convenio: { id: string; nome: string } | null;
};

export type ProfissionalAgenda = {
  id: string;
  nome: string;
  especialidade: string | null;
  registro: string | null;
  duracao_consulta_min: number;
  cor_agenda: string;
  ativo: boolean;
};

export type BloqueioAgenda = {
  id: string;
  profissional_id: string | null;
  inicio: string;
  fim: string;
  motivo: string | null;
};

export type HorarioLivre = { inicio: string; fim: string; hora: string };

export type Disponibilidade = {
  profissional_id: string;
  data: string;
  duracao_min: number;
  fuso: string;
  horarios: HorarioLivre[];
};

export type FiltroAgendamentos = {
  inicio?: string;
  fim?: string;
  profissionalId?: string;
  pacienteId?: string;
};

export type DadosAgendamento = {
  paciente_id: string;
  profissional_id: string;
  inicio: string;
  fim?: string;
  tipo: TipoAgendamento;
  convenio_id?: string | null;
  observacoes?: string | null;
  encaixe?: boolean;
};

export const chavesAgendamento = {
  todos: ['agendamentos'] as const,
  lista: (filtros?: FiltroAgendamentos) => [...chavesAgendamento.todos, 'lista', filtros ?? {}] as const,
  detalhe: (id: string) => [...chavesAgendamento.todos, 'detalhe', id] as const,
  disponibilidade: (profissionalId: string, data: string, ignorarId?: string) =>
    [...chavesAgendamento.todos, 'disponibilidade', profissionalId, data, ignorarId ?? null] as const,
  profissionais: () => [...chavesAgendamento.todos, 'profissionais'] as const,
  bloqueios: (filtros: { inicio: string; fim: string; profissionalId?: string }) =>
    [...chavesAgendamento.todos, 'bloqueios', filtros] as const,
};

/** Agendamentos por período (inicio/fim) ou histórico de um paciente (pacienteId). */
export function useAgendamentos(filtros: FiltroAgendamentos, habilitado = true) {
  return useQuery({
    queryKey: chavesAgendamento.lista(filtros),
    queryFn: () => api.get<Agendamento[]>('/agendamentos', filtros),
    enabled: habilitado && (!!filtros.pacienteId || (!!filtros.inicio && !!filtros.fim)),
    placeholderData: keepPreviousData,
  });
}

export function useAgendamento(id: string | null | undefined) {
  return useQuery({
    queryKey: chavesAgendamento.detalhe(id ?? ''),
    queryFn: () => api.get<Agendamento>(`/agendamentos/${id}`),
    enabled: !!id,
  });
}

export function useDisponibilidade(
  profissionalId: string | null | undefined,
  data: string | null | undefined,
  ignorarId?: string,
) {
  return useQuery({
    queryKey: chavesAgendamento.disponibilidade(profissionalId ?? '', data ?? '', ignorarId),
    queryFn: () =>
      api.get<Disponibilidade>('/agendamentos/disponibilidade', { profissionalId, data, ignorarId }),
    enabled: !!profissionalId && !!data,
  });
}

export function useProfissionaisAgenda() {
  return useQuery({
    queryKey: chavesAgendamento.profissionais(),
    queryFn: () => api.get<ProfissionalAgenda[]>('/agendamentos/profissionais'),
    staleTime: 60_000,
  });
}

export function useBloqueiosAgenda(filtros: { inicio: string; fim: string; profissionalId?: string } | null) {
  return useQuery({
    queryKey: chavesAgendamento.bloqueios(filtros ?? { inicio: '', fim: '' }),
    queryFn: () => api.get<BloqueioAgenda[]>('/agendamentos/bloqueios', filtros!),
    enabled: !!filtros,
    placeholderData: keepPreviousData,
  });
}

function useInvalidarAgenda() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: chavesAgendamento.todos });
    qc.invalidateQueries({ queryKey: chavesMe.me });
  };
}

export function useCriarAgendamento() {
  const invalidar = useInvalidarAgenda();
  return useMutation({
    mutationFn: (dados: DadosAgendamento) => api.post<Agendamento>('/agendamentos', dados),
    onSuccess: invalidar,
  });
}

export function useEditarAgendamento() {
  const invalidar = useInvalidarAgenda();
  return useMutation({
    mutationFn: ({ id, ...dados }: Partial<DadosAgendamento> & { id: string }) =>
      api.put<Agendamento>(`/agendamentos/${id}`, dados),
    onSuccess: invalidar,
  });
}

export function useMudarStatusAgendamento() {
  const invalidar = useInvalidarAgenda();
  return useMutation({
    mutationFn: ({ id, status, motivo }: { id: string; status: StatusAgendamento; motivo?: string }) =>
      api.patch<Agendamento>(`/agendamentos/${id}/status`, { status, motivo }),
    onSuccess: invalidar,
  });
}

/** Transições permitidas (espelha o backend) — usado para mostrar só as ações válidas. */
export const TRANSICOES_STATUS: Record<StatusAgendamento, StatusAgendamento[]> = {
  agendado: ['confirmado', 'compareceu', 'cancelado', 'faltou'],
  confirmado: ['compareceu', 'cancelado', 'faltou'],
  compareceu: ['atendido'],
  atendido: [],
  cancelado: [],
  faltou: [],
};

/** Remarcar (mudar data/hora) só é permitido nesses status. */
export const STATUS_REMARCAVEIS: StatusAgendamento[] = ['agendado', 'confirmado'];
