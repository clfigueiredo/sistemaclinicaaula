/**
 * API dos retornos.   Contrato: docs/FASE2.md §5.
 *
 * Datas previstas trafegam como 'YYYY-MM-DD'. O convite (WhatsApp) consome `max_mensagens` ⇒ invalida `chavesMe.me`.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesMe } from './me';
import type { Paginado, StatusAgendamento, StatusRetorno } from './tipos';

export const chavesRetornos = {
  todos: ['retornos'] as const,
  lista: (filtros: object) => [...chavesRetornos.todos, 'lista', filtros] as const,
  agendamento: (agendamentoId: string) => [...chavesRetornos.todos, 'agendamento', agendamentoId] as const,
  configuracao: () => [...chavesRetornos.todos, 'configuracao'] as const,
};

export type Retorno = {
  id: string;
  paciente_id: string;
  profissional_id: string;
  agendamento_origem_id: string;
  agendamento_retorno_id: string | null;
  /** 'YYYY-MM-DD' */
  data_prevista: string;
  status: StatusRetorno;
  observacao: string | null;
  convite_enviado_em: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  /** Em aberto (pendente/convidado) com data prevista antes de hoje (fuso da clínica). */
  vencido: boolean;
  paciente: { id: string; nome: string; telefone: string | null; whatsapp: string | null; aceita_whatsapp: boolean };
  profissional: { id: string; nome: string; cor_agenda: string };
  agendamento_origem: { id: string; inicio: string; status: StatusAgendamento };
  agendamento_retorno: { id: string; inicio: string; status: StatusAgendamento } | null;
};

export type FiltroStatusRetorno = StatusRetorno | 'abertos' | 'vencidos';

export type FiltrosRetornos = {
  status?: FiltroStatusRetorno;
  inicio?: string;
  fim?: string;
  profissional_id?: string;
  paciente_id?: string;
  pagina?: number;
  por_pagina?: number;
};

export type ResultadoWhatsapp = { enfileirada: boolean; erro?: string };

export type ConfigRetornos = { convite_ativo: boolean; dias_antecedencia: number };

function useInvalidarRetornos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: chavesRetornos.todos });
}

export function useRetornos(filtros: FiltrosRetornos) {
  return useQuery({
    queryKey: chavesRetornos.lista(filtros),
    queryFn: () => api.get<Paginado<Retorno>>('/retornos', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useRetornoDoAgendamento(agendamentoId: string) {
  return useQuery({
    queryKey: chavesRetornos.agendamento(agendamentoId),
    queryFn: () => api.get<Retorno | null>(`/retornos/agendamento/${agendamentoId}`),
  });
}

export function useCriarRetorno() {
  const invalidar = useInvalidarRetornos();
  return useMutation({
    mutationFn: (dados: { agendamento_origem_id: string; dias?: number; data_prevista?: string; observacao?: string | null }) =>
      api.post<Retorno>('/retornos', dados),
    onSuccess: invalidar,
  });
}

export function useEditarRetorno() {
  const invalidar = useInvalidarRetornos();
  return useMutation({
    mutationFn: ({ id, ...dados }: { id: string; dias?: number; data_prevista?: string; observacao?: string | null }) =>
      api.put<Retorno>(`/retornos/${id}`, dados),
    onSuccess: invalidar,
  });
}

export function useMudarStatusRetorno() {
  const invalidar = useInvalidarRetornos();
  return useMutation({
    mutationFn: ({
      id,
      ...dados
    }: {
      id: string;
      status: 'agendado' | 'cancelado' | 'pendente';
      agendamento_retorno_id?: string | null;
    }) => api.patch<Retorno>(`/retornos/${id}/status`, dados),
    onSuccess: invalidar,
  });
}

export function useConvidarRetorno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ retorno: Retorno; whatsapp: ResultadoWhatsapp }>(`/retornos/${id}/convidar`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chavesRetornos.todos });
      qc.invalidateQueries({ queryKey: ['whatsapp'] });
      qc.invalidateQueries({ queryKey: chavesMe.me });
    },
  });
}

export function useConfigRetornos(habilitado = true) {
  return useQuery({
    queryKey: chavesRetornos.configuracao(),
    queryFn: () => api.get<ConfigRetornos>('/retornos/configuracao'),
    enabled: habilitado,
  });
}

export function useSalvarConfigRetornos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: Partial<ConfigRetornos>) => api.put<ConfigRetornos>('/retornos/configuracao', dados),
    onSuccess: (cfg) => qc.setQueryData(chavesRetornos.configuracao(), cfg),
  });
}

/** Mensagem amigável para o erro de envio do WhatsApp (resultado de enfileirarMensagem). */
export function mensagemErroWhatsapp(erro?: string): string {
  switch (erro) {
    case 'sem_consentimento':
      return 'O paciente não autorizou mensagens de WhatsApp.';
    case 'telefone_invalido':
      return 'O paciente não tem um número de WhatsApp válido.';
    case 'recurso_indisponivel':
      return 'O plano da clínica não inclui WhatsApp.';
    case 'limite_atingido':
      return 'Limite de mensagens do plano atingido.';
    case 'assinatura_inativa':
      return 'Assinatura inativa: o envio de WhatsApp está parado.';
    case 'fila_indisponivel':
      return 'Fila de envio indisponível no momento. Tente novamente.';
    default:
      return 'Não foi possível enviar o convite.';
  }
}
