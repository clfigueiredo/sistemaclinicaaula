/**
 * API do agendamento online (docs/FASE2.md §2).
 *
 * Rotas PÚBLICAS (/publico/clinicas/:slug...) funcionam sem login (sessão 'nenhuma': não manda token nem
 * derruba a sessão do usuário logado se algo falhar). Chaves públicas começam com 'publico'.
 * Aprovar solicitação consome max_agendamentos: invalida também chavesMe.me e ['agendamentos'].
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesMe } from './me';
import type { Paginado, StatusSolicitacaoAgendamento, TipoAgendamento } from './tipos';

export const chavesAgendamentoOnline = {
  publico: (slug: string) => ['publico', 'clinica', slug] as const,
  disponibilidadePublica: (slug: string, profissionalId: string, data: string) =>
    ['publico', 'clinica', slug, 'disponibilidade', { profissionalId, data }] as const,
  todos: ['solicitacoes'] as const,
  lista: (filtros: object) => [...chavesAgendamentoOnline.todos, 'lista', filtros] as const,
  resumo: () => [...chavesAgendamentoOnline.todos, 'resumo'] as const,
  detalhe: (id: string) => [...chavesAgendamentoOnline.todos, 'detalhe', id] as const,
  configuracao: ['agendamento-online', 'configuracao'] as const,
};

// ----------------------------------------------------------------------------- tipos

export type ProfissionalPublico = {
  id: string;
  nome: string;
  especialidade: string | null;
  duracao_consulta_min: number;
};

export type ClinicaPublica = {
  clinica: {
    nome: string;
    slug: string;
    telefone: string | null;
    endereco: string | null;
    cidade: string | null;
    uf: string | null;
    fuso_horario: string;
  };
  mensagem_boas_vindas: string | null;
  antecedencia_min_horas: number;
  dias_a_frente: number;
  /** Hoje (AAAA-MM-DD) no fuso da clínica. */
  hoje: string;
  profissionais: ProfissionalPublico[];
};

export type HorarioPublico = { inicio: string; fim: string; hora: string };
export type DisponibilidadePublica = { data: string; fuso: string; horarios: HorarioPublico[] };

export type DadosSolicitacao = {
  profissional_id: string;
  inicio: string;
  nome: string;
  telefone: string;
  email?: string | null;
  cpf?: string | null;
  nascimento?: string | null;
  observacoes?: string | null;
  aceita_whatsapp: boolean;
  /** Honeypot (fica escondido; humanos não preenchem). */
  website?: string;
};

export type SolicitacaoCriada = {
  id: string;
  status: 'pendente';
  inicio: string;
  fim: string;
  profissional: { nome: string };
};

export type Solicitacao = {
  id: string;
  profissional_id: string;
  inicio: string;
  fim: string;
  status: StatusSolicitacaoAgendamento;
  nome: string;
  telefone: string;
  email: string | null;
  cpf: string | null;
  nascimento: string | null;
  observacoes: string | null;
  aceita_whatsapp: boolean;
  paciente_id: string | null;
  agendamento_id: string | null;
  motivo_recusa: string | null;
  analisado_por: string | null;
  analisado_em: string | null;
  criado_em: string;
  atualizado_em: string;
  profissional: { id: string; nome: string; especialidade: string | null };
  paciente: { id: string; nome: string } | null;
};

export type PacienteCandidato = {
  id: string;
  nome: string;
  cpf: string | null;
  whatsapp: string | null;
  telefone: string | null;
  nascimento: string | null;
  aceita_whatsapp: boolean;
  motivo: 'cpf' | 'telefone';
};

export type SolicitacaoDetalhe = Solicitacao & { pacientes_candidatos: PacienteCandidato[] };

export type ResultadoWhatsapp = { enfileirada: boolean; erro?: string } | null;

export type DadosAprovacao = {
  paciente_id?: string | null;
  tipo?: TipoAgendamento;
  convenio_id?: string | null;
  observacoes?: string | null;
};

export type ResultadoAprovacao = {
  solicitacao: Solicitacao;
  agendamento_id: string;
  paciente_id: string;
  paciente_criado: boolean;
  whatsapp: ResultadoWhatsapp;
};

export type ConfigAgendamentoOnline = {
  ativo: boolean;
  antecedencia_min_horas: number;
  dias_a_frente: number;
  mensagem_boas_vindas: string | null;
  max_pendentes_por_telefone: number;
  slug: string | null;
  link_publico: string | null;
  profissionais: { id: string; nome: string; ativo: boolean; agendamento_online: boolean; especialidade: string | null }[];
};

export type DadosConfigAgendamentoOnline = Partial<
  Omit<ConfigAgendamentoOnline, 'slug' | 'link_publico' | 'profissionais'>
> & { profissionais_visiveis?: string[] };

export type FiltroSolicitacoes = { status?: StatusSolicitacaoAgendamento; pagina?: number; por_pagina?: number };

/** Texto amigável dos erros de envio do WhatsApp (resultado de enfileirarMensagem). */
export const ERROS_WHATSAPP: Record<string, string> = {
  sem_consentimento: 'o paciente não autorizou mensagens pelo WhatsApp',
  telefone_invalido: 'o telefone é inválido',
  assinatura_inativa: 'a assinatura está inativa',
  recurso_indisponivel: 'o plano não inclui WhatsApp',
  limite_atingido: 'o limite de mensagens do plano foi atingido',
  fila_indisponivel: 'a fila de envio está indisponível',
};

export function descreverWhatsapp(w: ResultadoWhatsapp): string | null {
  if (!w) return null;
  if (w.enfileirada) return 'Mensagem de WhatsApp enfileirada para envio.';
  return `WhatsApp não enviado: ${ERROS_WHATSAPP[w.erro ?? ''] ?? w.erro ?? 'erro desconhecido'}.`;
}

// ----------------------------------------------------------------------------- públicas

const semSessao = { sessao: 'nenhuma' as const };

export function useClinicaPublica(slug: string) {
  return useQuery({
    queryKey: chavesAgendamentoOnline.publico(slug),
    queryFn: () => api.get<ClinicaPublica>(`/publico/clinicas/${encodeURIComponent(slug)}`, undefined, semSessao),
    enabled: !!slug,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useDisponibilidadePublica(slug: string, profissionalId: string | null, data: string | null) {
  return useQuery({
    queryKey: chavesAgendamentoOnline.disponibilidadePublica(slug, profissionalId ?? '', data ?? ''),
    queryFn: () =>
      api.get<DisponibilidadePublica>(
        `/publico/clinicas/${encodeURIComponent(slug)}/disponibilidade`,
        { profissional_id: profissionalId, data },
        semSessao,
      ),
    enabled: !!slug && !!profissionalId && !!data,
    staleTime: 30_000,
  });
}

export function useEnviarSolicitacao(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: DadosSolicitacao) =>
      api.post<SolicitacaoCriada>(`/publico/clinicas/${encodeURIComponent(slug)}/solicitacoes`, dados, semSessao),
    onSettled: () => qc.invalidateQueries({ queryKey: chavesAgendamentoOnline.publico(slug) }),
  });
}

// ----------------------------------------------------------------------------- internas

export function useSolicitacoes(filtros: FiltroSolicitacoes) {
  return useQuery({
    queryKey: chavesAgendamentoOnline.lista(filtros),
    queryFn: () => api.get<Paginado<Solicitacao>>('/solicitacoes', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useResumoSolicitacoes(habilitado = true) {
  return useQuery({
    queryKey: chavesAgendamentoOnline.resumo(),
    queryFn: () => api.get<{ pendentes: number }>('/solicitacoes/resumo', undefined, { silencioso: true }),
    enabled: habilitado,
    refetchInterval: 60_000,
  });
}

export function useSolicitacao(id: string | null | undefined) {
  return useQuery({
    queryKey: chavesAgendamentoOnline.detalhe(id ?? ''),
    queryFn: () => api.get<SolicitacaoDetalhe>(`/solicitacoes/${id}`),
    enabled: !!id,
  });
}

export function useAprovarSolicitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dados }: DadosAprovacao & { id: string }) =>
      api.post<ResultadoAprovacao>(`/solicitacoes/${id}/aprovar`, dados),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chavesAgendamentoOnline.todos });
      qc.invalidateQueries({ queryKey: chavesMe.me });
      qc.invalidateQueries({ queryKey: ['agendamentos'] });
      qc.invalidateQueries({ queryKey: ['pacientes'] });
    },
  });
}

export function useRecusarSolicitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dados }: { id: string; motivo?: string | null; notificar?: boolean }) =>
      api.post<{ solicitacao: Solicitacao; whatsapp: ResultadoWhatsapp }>(`/solicitacoes/${id}/recusar`, dados),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chavesAgendamentoOnline.todos });
      qc.invalidateQueries({ queryKey: chavesMe.me });
    },
  });
}

export function useConfigAgendamentoOnline() {
  return useQuery({
    queryKey: chavesAgendamentoOnline.configuracao,
    queryFn: () => api.get<ConfigAgendamentoOnline>('/agendamento-online/configuracao'),
  });
}

export function useSalvarConfigAgendamentoOnline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: DadosConfigAgendamentoOnline) =>
      api.put<ConfigAgendamentoOnline>('/agendamento-online/configuracao', dados),
    onSuccess: (cfg) => {
      qc.setQueryData(chavesAgendamentoOnline.configuracao, cfg);
      qc.invalidateQueries({ queryKey: ['profissionais'] });
    },
  });
}
