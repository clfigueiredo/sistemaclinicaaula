/**
 * Contratação de plano pela própria clínica (admin) — módulo contratacao da API.
 *
 *   GET  /contratacao      planos contratáveis, plano atual, se pode contratar e a cobrança pendente
 *   POST /contratacao      { plano_id } ⇒ { cobranca, link_pagamento } (o plano só muda quando o pagamento é confirmado)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesAdminCobranca, type Cobranca } from './adminCobranca';
import { chavesMe } from './me';
import type { CodigoRecurso, PeriodoLimite, StatusAssinatura } from './tipos';

export type RecursoPlanoPublico = {
  codigo: CodigoRecurso;
  nome: string;
  tipo: 'limite' | 'booleano';
  /** null = ilimitado (ou recurso liga/desliga). */
  limite: number | null;
  periodo: PeriodoLimite | null;
};

export type PlanoPublico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: string;
  gratuito: boolean;
  plano_cadastro: boolean;
  /** Só os recursos inclusos no plano, na ordem do catálogo. */
  recursos: RecursoPlanoPublico[];
};

export type SituacaoContratacao = {
  plano_atual: { id: string; nome: string; preco: string } | null;
  status_assinatura: StatusAssinatura | null;
  pode_contratar: boolean;
  motivo: 'plano_pago' | 'assinatura_inativa' | 'pagamento_indisponivel' | null;
  mensagem: string | null;
  planos: PlanoPublico[];
  pendente: (Cobranca & { plano_nome: string | null }) | null;
};

export const chavesContratacao = {
  situacao: ['contratacao'] as const,
};

/** Enquanto houver cobrança pendente, consulta de 10 em 10 s para perceber o pagamento confirmado. */
export function useContratacao() {
  return useQuery({
    queryKey: chavesContratacao.situacao,
    queryFn: () => api.get<SituacaoContratacao>('/contratacao'),
    refetchInterval: (q) => (q.state.data?.pendente ? 10_000 : false),
  });
}

export function useContratarPlano() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planoId: string) =>
      api.post<{ cobranca: Cobranca; link_pagamento: string | null }>('/contratacao', { plano_id: planoId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chavesContratacao.situacao });
      qc.invalidateQueries({ queryKey: chavesAdminCobranca.minhas });
    },
  });
}

/** Depois do pagamento confirmado: o plano mudou, então recarrega /me (recursos e limites) e as faturas. */
export function useAtualizarAposPagamento() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: chavesMe.me });
    qc.invalidateQueries({ queryKey: chavesAdminCobranca.minhas });
  };
}

/** Texto curto de um recurso incluso ("Até 3 profissionais", "Mensagens WhatsApp: 500/mês", "Financeiro"). */
export function descreverRecurso(r: RecursoPlanoPublico): string {
  if (r.tipo === 'booleano') return r.nome;
  if (r.limite === null) return `${r.nome}: ilimitado`;
  return `${r.nome}: ${r.limite.toLocaleString('pt-BR')}${r.periodo === 'mensal' ? '/mês' : ''}`;
}
