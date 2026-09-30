/**
 * API da lista de espera (docs/FASE2.md §3).
 *
 * Oferecer horário consome max_mensagens: invalida também ['whatsapp'] e chavesMe.me.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesMe } from './me';
import type { Paginado, StatusListaEspera, Turno } from './tipos';

export const chavesListaEspera = {
  todos: ['lista-espera'] as const,
  lista: (filtros: object) => [...chavesListaEspera.todos, 'lista', filtros] as const,
  sugestoes: (agendamentoId: string) => [...chavesListaEspera.todos, 'sugestoes', agendamentoId] as const,
  vagasRecentes: () => [...chavesListaEspera.todos, 'vagas-recentes'] as const,
};

export type ItemListaEspera = {
  id: string;
  paciente_id: string;
  profissional_id: string | null;
  dias_semana: number[];
  turnos: Turno[];
  observacao: string | null;
  status: StatusListaEspera;
  agendamento_id: string | null;
  ultima_oferta_em: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  paciente: { id: string; nome: string; telefone: string | null; whatsapp: string | null; aceita_whatsapp: boolean };
  profissional: { id: string; nome: string } | null;
};

export type FiltroListaEspera = {
  status?: StatusListaEspera | 'todos';
  profissional_id?: string;
  pagina?: number;
  por_pagina?: number;
};

export type DadosItemListaEspera = {
  paciente_id: string;
  profissional_id?: string | null;
  dias_semana?: number[];
  turnos?: Turno[];
  observacao?: string | null;
};

export type SugestoesListaEspera = {
  agendamento: { id: string | null; inicio: string; fim: string; profissional: { id: string; nome: string } };
  horario_livre: boolean;
  sugestoes: ItemListaEspera[];
};

export type VagasRecentes = {
  total: number;
  itens: { agendamento_id: string; inicio: string; profissional: { id: string; nome: string }; sugestoes: number }[];
};

export type ResultadoOferta = {
  whatsapp: { enfileirada: boolean; erro?: string };
  ultima_oferta_em: string | null;
};

export const DIAS_SEMANA_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function useListaEspera(filtros: FiltroListaEspera) {
  return useQuery({
    queryKey: chavesListaEspera.lista(filtros),
    queryFn: () => api.get<Paginado<ItemListaEspera>>('/lista-espera', filtros),
    placeholderData: keepPreviousData,
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: chavesListaEspera.todos });
}

export function useCriarItemListaEspera() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: DadosItemListaEspera) => api.post<ItemListaEspera>('/lista-espera', dados),
    onSuccess: invalidar,
  });
}

export function useEditarItemListaEspera() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: Partial<Omit<DadosItemListaEspera, 'paciente_id'>> & { id: string }) =>
      api.put<ItemListaEspera>(`/lista-espera/${id}`, dados),
    onSuccess: invalidar,
  });
}

export function useMudarStatusListaEspera() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: { id: string; status: StatusListaEspera; agendamento_id?: string | null }) =>
      api.patch<ItemListaEspera>(`/lista-espera/${id}/status`, dados),
    onSuccess: invalidar,
  });
}

export function useSugestoesListaEspera(agendamentoId: string | null | undefined) {
  return useQuery({
    queryKey: chavesListaEspera.sugestoes(agendamentoId ?? ''),
    queryFn: () => api.get<SugestoesListaEspera>('/lista-espera/sugestoes', { agendamento_id: agendamentoId }),
    enabled: !!agendamentoId,
  });
}

export function useVagasRecentes(habilitado = true) {
  return useQuery({
    queryKey: chavesListaEspera.vagasRecentes(),
    queryFn: () => api.get<VagasRecentes>('/lista-espera/vagas-recentes', undefined, { silencioso: true }),
    enabled: habilitado,
    refetchInterval: 60_000,
  });
}

export function useOferecerHorario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, agendamento_id }: { id: string; agendamento_id: string }) =>
      api.post<ResultadoOferta>(`/lista-espera/${id}/oferecer`, { agendamento_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chavesListaEspera.todos });
      qc.invalidateQueries({ queryKey: ['whatsapp'] });
      qc.invalidateQueries({ queryKey: chavesMe.me });
    },
  });
}

/** "Seg, Qua · Manhã" (ou "Qualquer dia · Qualquer turno"). */
export function descreverPreferencias(item: Pick<ItemListaEspera, 'dias_semana' | 'turnos'>, rotulosTurno: Record<Turno, string>) {
  const dias = item.dias_semana.length ? item.dias_semana.map((d) => DIAS_SEMANA_CURTOS[d]).join(', ') : 'Qualquer dia';
  const turnos = item.turnos.length ? item.turnos.map((t) => rotulosTurno[t]).join(', ') : 'Qualquer turno';
  return `${dias} · ${turnos}`;
}
