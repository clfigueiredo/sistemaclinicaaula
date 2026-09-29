/**
 * API do módulo WhatsApp: conexão (QR/status), histórico, avisos da recepção e lembretes.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesMe } from './me';
import type { Paginado, StatusAgendamento } from './tipos';

export type StatusSessaoWhatsapp = 'desconectada' | 'iniciando' | 'aguardando_qr' | 'conectada' | 'erro';
export type TipoMensagemWhatsapp = 'lembrete' | 'confirmacao' | 'aviso';
export type DirecaoMensagemWhatsapp = 'entrada' | 'saida';
export type StatusMensagemWhatsapp = 'pendente' | 'enviada' | 'falhou' | 'recebida';

export type StatusWhatsapp = {
  recurso_habilitado: boolean;
  status: StatusSessaoWhatsapp;
  telefone: string | null;
  qr_code: string | null;
  atualizado_em: string | null;
  erro_provedor: string | null;
};

export type MensagemWhatsapp = {
  id: string;
  telefone: string;
  tipo: TipoMensagemWhatsapp | null;
  direcao: DirecaoMensagemWhatsapp;
  conteudo: string;
  status: StatusMensagemWhatsapp;
  erro: string | null;
  enviada_em: string | null;
  criado_em: string;
  paciente: { id: string; nome: string } | null;
  agendamento: {
    id: string;
    inicio: string;
    status: StatusAgendamento;
    profissional: { id: string; nome: string };
  } | null;
};

export type AvisoWhatsapp = Omit<MensagemWhatsapp, 'status'> & { lido: boolean };

export type ResultadoLembretes = {
  selecionados: number;
  enfileirados: number;
  falharam: number;
  erros: Record<string, number>;
};

export const ROTULOS_STATUS_SESSAO: Record<StatusSessaoWhatsapp, string> = {
  desconectada: 'Desconectado',
  iniciando: 'Iniciando…',
  aguardando_qr: 'Aguardando leitura do QR code',
  conectada: 'Conectado',
  erro: 'Erro na conexão',
};

export const ROTULOS_TIPO_MENSAGEM: Record<TipoMensagemWhatsapp, string> = {
  lembrete: 'Lembrete',
  confirmacao: 'Resposta automática',
  aviso: 'Aviso',
};

export const ROTULOS_STATUS_MENSAGEM: Record<StatusMensagemWhatsapp, string> = {
  pendente: 'Na fila',
  enviada: 'Enviada',
  falhou: 'Falhou',
  recebida: 'Recebida',
};

export const chavesWhatsapp = {
  todos: ['whatsapp'] as const,
  status: () => [...chavesWhatsapp.todos, 'status'] as const,
  mensagens: (pagina: number) => [...chavesWhatsapp.todos, 'mensagens', { pagina }] as const,
  avisos: (filtros?: { naoLidos?: boolean }) => [...chavesWhatsapp.todos, 'avisos', filtros ?? {}] as const,
};

/** Status da conexão. `pollingMs` liga o polling (ex.: 3000 enquanto aguarda o QR). */
export function useStatusWhatsapp(opcoes: { habilitado?: boolean; pollingMs?: number | false } = {}) {
  return useQuery({
    queryKey: chavesWhatsapp.status(),
    queryFn: () => api.get<StatusWhatsapp>('/whatsapp/status'),
    enabled: opcoes.habilitado ?? true,
    refetchInterval: opcoes.pollingMs ?? false,
  });
}

export function useMensagensWhatsapp(pagina: number, habilitado = true) {
  return useQuery({
    queryKey: chavesWhatsapp.mensagens(pagina),
    queryFn: () => api.get<Paginado<MensagemWhatsapp>>('/whatsapp/mensagens', { pagina, por_pagina: 20 }),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });
}

export function useAvisosWhatsapp(filtros: { naoLidos?: boolean } = {}, habilitado = true) {
  return useQuery({
    queryKey: chavesWhatsapp.avisos(filtros),
    queryFn: () =>
      api.get<{ itens: AvisoWhatsapp[]; nao_lidos: number }>('/whatsapp/avisos', {
        nao_lidos: filtros.naoLidos ? 'true' : undefined,
      }),
    enabled: habilitado,
    refetchInterval: 60_000,
  });
}

function useInvalidarWhatsapp() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: chavesWhatsapp.todos });
    qc.invalidateQueries({ queryKey: chavesMe.me });
  };
}

export function useConectarWhatsapp() {
  const invalidar = useInvalidarWhatsapp();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ status: StatusSessaoWhatsapp; qr_code: string | null; telefone: string | null }>('/whatsapp/conectar'),
    onSuccess: (dados) => {
      // Mostra o QR imediatamente, antes do próximo polling.
      qc.setQueryData<StatusWhatsapp>(chavesWhatsapp.status(), (atual) =>
        atual ? { ...atual, status: dados.status, qr_code: dados.qr_code, telefone: dados.telefone } : atual,
      );
      invalidar();
    },
  });
}

export function useDesconectarWhatsapp() {
  const invalidar = useInvalidarWhatsapp();
  return useMutation({
    mutationFn: () => api.post<{ status: 'desconectada' }>('/whatsapp/desconectar'),
    onSuccess: invalidar,
  });
}

export function useMarcarAvisoLido() {
  const invalidar = useInvalidarWhatsapp();
  return useMutation({
    mutationFn: (id: string) => api.post<{ id: string; lido: true }>(`/whatsapp/avisos/${id}/lido`),
    onSuccess: invalidar,
  });
}

export function useExecutarLembretes() {
  const invalidar = useInvalidarWhatsapp();
  return useMutation({
    mutationFn: () => api.post<ResultadoLembretes>('/whatsapp/lembretes/executar'),
    onSuccess: invalidar,
  });
}
