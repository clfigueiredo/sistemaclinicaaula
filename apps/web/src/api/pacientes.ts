/**
 * API do módulo pacientes: tipos + hooks TanStack Query.
 *
 * Chaves: ['pacientes', ...]. Alergias/medicações vêm no detalhe do paciente (null para a recepção).
 * Também expõe hooks de leitura de outros módulos usados nas telas de pacientes
 * (convênios ativos para o select e histórico de agendamentos do paciente).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErroApi } from './cliente';
import type { StatusAgendamento, TipoAgendamento } from './tipos';

export type Sexo = 'feminino' | 'masculino' | 'outro';

export type PacienteResumo = {
  id: string;
  nome: string;
  cpf: string | null;
  /** AAAA-MM-DD */
  nascimento: string | null;
  telefone: string | null;
  whatsapp: string | null;
  convenio_id: string | null;
  aceita_whatsapp: boolean;
  ativo: boolean;
  convenio: { id: string; nome: string } | null;
};

export type Alergia = { id: string; paciente_id: string; descricao: string; gravidade: string | null; criado_em: string };
export type Medicacao = {
  id: string;
  paciente_id: string;
  nome: string;
  dosagem: string | null;
  frequencia: string | null;
  observacoes: string | null;
  criado_em: string;
};

export type Paciente = Omit<PacienteResumo, 'convenio'> & {
  sexo: Sexo | null;
  email: string | null;
  endereco: string | null;
  numero_carteirinha: string | null;
  contato_emergencia: string | null;
  observacoes: string | null;
  criado_em: string;
  atualizado_em: string;
  convenio: { id: string; nome: string; ativo: boolean } | null;
  /** null = sem permissão para ver dados clínicos (recepção). */
  alergias: Alergia[] | null;
  medicacoes: Medicacao[] | null;
};

/** Corpo de POST/PUT /pacientes (telefones podem ir mascarados: a API normaliza para DDI 55). */
export type DadosPaciente = {
  nome: string;
  cpf: string | null;
  nascimento: string | null;
  sexo: Sexo | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  endereco: string | null;
  convenio_id: string | null;
  numero_carteirinha: string | null;
  contato_emergencia: string | null;
  aceita_whatsapp: boolean;
  observacoes: string | null;
  ativo?: boolean;
};

export type FiltrosPacientes = { busca?: string; pagina?: number; porPagina?: number; inativos?: boolean };
export type ListaPacientes = { itens: PacienteResumo[]; total: number; pagina: number; porPagina: number };

export const chavesPaciente = {
  todos: ['pacientes'] as const,
  lista: (filtros: FiltrosPacientes = {}) => [...chavesPaciente.todos, 'lista', filtros] as const,
  detalhe: (id: string) => [...chavesPaciente.todos, 'detalhe', id] as const,
  consultas: (id: string) => [...chavesPaciente.todos, 'consultas', id] as const,
};

export function useListaPacientes(filtros: FiltrosPacientes) {
  return useQuery({
    queryKey: chavesPaciente.lista(filtros),
    queryFn: () =>
      api.get<ListaPacientes>('/pacientes', {
        busca: filtros.busca,
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        inativos: filtros.inativos ? 'true' : undefined,
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePaciente(id: string | undefined) {
  return useQuery({
    queryKey: chavesPaciente.detalhe(id ?? ''),
    queryFn: () => api.get<Paciente>(`/pacientes/${id}`),
    enabled: !!id,
    retry: (n, e) => !(e instanceof ErroApi && [403, 404].includes(e.status)) && n < 2,
  });
}

export function useCriarPaciente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: DadosPaciente) => api.post<Paciente>('/pacientes', dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesPaciente.todos }),
  });
}

export function useEditarPaciente(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: DadosPaciente) => api.put<Paciente>(`/pacientes/${id}`, dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesPaciente.todos }),
  });
}

// ------------------------------------------------------------------ alergias / medicações

export type DadosAlergia = { descricao: string; gravidade: string | null };
export type DadosMedicacao = { nome: string; dosagem: string | null; frequencia: string | null; observacoes: string | null };

function useMutacaoClinica<T>(pacienteId: string, fn: (dados: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesPaciente.detalhe(pacienteId) }),
  });
}

export function useAdicionarAlergia(pacienteId: string) {
  return useMutacaoClinica(pacienteId, (d: DadosAlergia) => api.post<Alergia>(`/pacientes/${pacienteId}/alergias`, d));
}
export function useRemoverAlergia(pacienteId: string) {
  return useMutacaoClinica(pacienteId, (id: string) => api.delete(`/pacientes/${pacienteId}/alergias/${id}`));
}
export function useAdicionarMedicacao(pacienteId: string) {
  return useMutacaoClinica(pacienteId, (d: DadosMedicacao) =>
    api.post<Medicacao>(`/pacientes/${pacienteId}/medicacoes`, d),
  );
}
export function useRemoverMedicacao(pacienteId: string) {
  return useMutacaoClinica(pacienteId, (id: string) => api.delete(`/pacientes/${pacienteId}/medicacoes/${id}`));
}

// ------------------------------------------------------------------ leituras de outros módulos

export type ConvenioOpcao = { id: string; nome: string; ativo: boolean };

function comoLista<T>(r: T[] | { itens: T[] } | undefined | null): T[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.itens ?? []);
}

/** Convênios ativos para selects (GET /convenios?ativos=true — módulo convênios). */
export function useConveniosAtivos() {
  return useQuery({
    queryKey: ['convenios', 'lista', { ativos: true }],
    queryFn: async () => comoLista(await api.get<ConvenioOpcao[] | { itens: ConvenioOpcao[] }>('/convenios', { ativos: true })),
    staleTime: 60_000,
  });
}

export type ConsultaPaciente = {
  id: string;
  inicio: string;
  fim: string;
  status: StatusAgendamento;
  tipo: TipoAgendamento;
  observacoes?: string | null;
  profissional: { id: string; nome: string; cor_agenda: string } | null;
  convenio?: { id: string; nome: string } | null;
};

/** Histórico de agendamentos do paciente (GET /agendamentos?pacienteId= — módulo agenda). */
export function useConsultasPaciente(pacienteId: string) {
  return useQuery({
    queryKey: chavesPaciente.consultas(pacienteId),
    queryFn: async () => {
      const lista = comoLista(
        await api.get<ConsultaPaciente[] | { itens: ConsultaPaciente[] }>('/agendamentos', { pacienteId }),
      );
      return [...lista].sort((a, b) => b.inicio.localeCompare(a.inicio));
    },
    retry: (n, e) => !(e instanceof ErroApi && [403, 404, 501].includes(e.status)) && n < 2,
  });
}
