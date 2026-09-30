/**
 * API da cobrança automática do SaaS (super admin) + faturas da clínica.   [fase 2, DONO: admin-cobranca]
 * Contrato: docs/FASE2.md §7. Rotas /admin/* usam o token do super admin automaticamente.
 * Segredos NUNCA voltam da API (só os últimos 4 caracteres em `credenciais_final`/`segredo_webhook_final`).
 *
 *   GET    /admin/cobranca/gateways · PUT /admin/cobranca/gateways/:provedor
 *   POST   /admin/cobranca/gateways/:provedor/(ativar|desativar|testar)
 *   GET    /admin/cobranca/cobrancas?status&clinica_id&de&ate&pagina&por_pagina
 *   GET    /admin/cobranca/clinicas/:clinicaId
 *   POST   /admin/cobranca/clinicas/:clinicaId/cobrancas · POST|DELETE /admin/cobranca/clinicas/:clinicaId/assinatura
 *   POST   /admin/cobranca/cobrancas/:id/cancelar
 *   GET    /admin/cobranca/eventos?gateway&pagina&por_pagina
 *   GET    /cobrancas/minhas            (admin da clínica — token da clínica)
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import type {
  AmbienteGateway,
  MetodoCobranca,
  Paginado,
  ProvedorPagamento,
  StatusAssinatura,
  StatusCobranca,
} from './tipos';

export const chavesAdminCobranca = {
  todos: ['admin', 'cobranca'] as const,
  gateways: () => [...chavesAdminCobranca.todos, 'gateways'] as const,
  cobrancas: (filtros: object) => [...chavesAdminCobranca.todos, 'cobrancas', filtros] as const,
  clinica: (id: string) => [...chavesAdminCobranca.todos, 'clinica', id] as const,
  eventos: (filtros: object) => [...chavesAdminCobranca.todos, 'eventos', filtros] as const,
  /** Faturas da própria clínica (token da clínica — não começa com 'admin'). */
  minhas: ['cobrancas', 'minhas'] as const,
};

// ----------------------------------------------------------------------------- tipos

export type GatewayConfigurado = {
  provedor: ProvedorPagamento;
  nome: string;
  configurado: boolean;
  /** Credenciais gravadas mas impossíveis de decifrar (CHAVE_CRIPTOGRAFIA trocada). */
  credenciais_ilegiveis: boolean;
  ambiente: AmbienteGateway;
  ativo: boolean;
  credenciais_final: string | null;
  segredo_webhook_configurado: boolean;
  segredo_webhook_final: string | null;
  dias_tolerancia: number;
  metodos: MetodoCobranca[];
  dia_vencimento_padrao: number;
  descricao_cobranca: string;
  url_webhook: string;
  atualizado_em: string | null;
};

export type DadosGateway = {
  ambiente?: AmbienteGateway;
  /** Campos vazios/ausentes mantêm o valor salvo. */
  credenciais?: { api_key?: string; secret_key?: string; publishable_key?: string; access_token?: string; public_key?: string };
  /** '' ou ausente mantém; null remove. */
  segredo_webhook?: string | null;
  dias_tolerancia?: number;
  metodos?: MetodoCobranca[];
  dia_vencimento_padrao?: number;
  descricao_cobranca?: string;
};

export type Cobranca = {
  id: string;
  clinica_id: string;
  assinatura_id: string | null;
  gateway: ProvedorPagamento;
  id_externo: string | null;
  descricao: string | null;
  valor: string;
  /** 'YYYY-MM-DD' */
  vencimento: string;
  status: StatusCobranca;
  metodo: MetodoCobranca | null;
  link_pagamento: string | null;
  pago_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type CobrancaAdmin = Cobranca & { clinica: { id: string; nome: string; email: string | null } };

export type ListaCobrancasAdmin = Paginado<CobrancaAdmin> & {
  totais: {
    recebido: string;
    pendente: string;
    vencido: string;
    quantidade: { paga: number; pendente: number; vencida: number };
  };
};

export type FiltrosCobrancas = {
  status?: StatusCobranca;
  clinica_id?: string;
  de?: string;
  ate?: string;
  pagina?: number;
  por_pagina?: number;
};

export type AssinaturaCobranca = {
  id: string;
  status: StatusAssinatura;
  expira_em: string | null;
  gateway: ProvedorPagamento | null;
  dia_vencimento: number | null;
  /** Método preferido da cobrança automática (null = o cliente escolhe no link). */
  metodo_cobranca: MetodoCobranca | null;
  cobranca_automatica: boolean;
  cliente_no_gateway: boolean;
  plano: { id: string; nome: string; preco: string };
};

export type CobrancaDaClinica = {
  clinica: { id: string; nome: string; email: string | null; documento: string };
  assinatura: AssinaturaCobranca | null;
  cobrancas: Cobranca[];
};

export type DadosNovaCobranca = { vencimento: string; valor?: number; descricao?: string; metodo?: MetodoCobranca };
export type DadosCobrancaAutomatica = { dia_vencimento: number; metodo?: MetodoCobranca; gerar_agora?: boolean };

export type EventoGateway = {
  id: string;
  gateway: ProvedorPagamento;
  id_evento: string;
  tipo: string;
  payload: unknown;
  processado_em: string | null;
  erro: string | null;
  recebido_em: string;
};

export type FiltrosEventos = { gateway?: ProvedorPagamento; pagina?: number; por_pagina?: number };

// ----------------------------------------------------------------------------- gateways

export function useGatewaysPagamento() {
  return useQuery({
    queryKey: chavesAdminCobranca.gateways(),
    queryFn: () => api.get<GatewayConfigurado[]>('/admin/cobranca/gateways'),
  });
}

function useAposAlterarGateway() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: chavesAdminCobranca.gateways() });
}

export function useSalvarGateway(provedor: ProvedorPagamento) {
  const apos = useAposAlterarGateway();
  return useMutation({
    mutationFn: (dados: DadosGateway) => api.put<GatewayConfigurado>(`/admin/cobranca/gateways/${provedor}`, dados),
    onSuccess: apos,
  });
}

export function useAtivarGateway() {
  const apos = useAposAlterarGateway();
  return useMutation({
    mutationFn: (provedor: ProvedorPagamento) => api.post<GatewayConfigurado>(`/admin/cobranca/gateways/${provedor}/ativar`),
    onSuccess: apos,
  });
}

export function useDesativarGateway() {
  const apos = useAposAlterarGateway();
  return useMutation({
    mutationFn: (provedor: ProvedorPagamento) => api.post<GatewayConfigurado>(`/admin/cobranca/gateways/${provedor}/desativar`),
    onSuccess: apos,
  });
}

export function useTestarGateway() {
  return useMutation({
    mutationFn: (provedor: ProvedorPagamento) =>
      api.post<{ ok: boolean; mensagem: string }>(`/admin/cobranca/gateways/${provedor}/testar`),
  });
}

// ----------------------------------------------------------------------------- cobranças

export function useCobrancas(filtros: FiltrosCobrancas) {
  return useQuery({
    queryKey: chavesAdminCobranca.cobrancas(filtros),
    queryFn: () => api.get<ListaCobrancasAdmin>('/admin/cobranca/cobrancas', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useCobrancaClinica(clinicaId: string | undefined) {
  return useQuery({
    queryKey: chavesAdminCobranca.clinica(clinicaId ?? ''),
    queryFn: () => api.get<CobrancaDaClinica>(`/admin/cobranca/clinicas/${clinicaId}`),
    enabled: !!clinicaId,
  });
}

function useAposAlterarCobranca() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [...chavesAdminCobranca.todos, 'cobrancas'] });
    qc.invalidateQueries({ queryKey: [...chavesAdminCobranca.todos, 'clinica'] });
    qc.invalidateQueries({ queryKey: ['admin', 'clinicas'] });
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  };
}

export function useCriarCobranca() {
  const apos = useAposAlterarCobranca();
  return useMutation({
    mutationFn: ({ clinicaId, ...dados }: DadosNovaCobranca & { clinicaId: string }) =>
      api.post<Cobranca>(`/admin/cobranca/clinicas/${clinicaId}/cobrancas`, dados),
    onSuccess: apos,
  });
}

export function useCancelarCobranca() {
  const apos = useAposAlterarCobranca();
  return useMutation({
    mutationFn: (id: string) => api.post<Cobranca>(`/admin/cobranca/cobrancas/${id}/cancelar`),
    onSuccess: apos,
  });
}

export function useAtivarCobrancaClinica() {
  const apos = useAposAlterarCobranca();
  return useMutation({
    mutationFn: ({ clinicaId, ...dados }: DadosCobrancaAutomatica & { clinicaId: string }) =>
      api.post<{ assinatura: AssinaturaCobranca | null; cobranca: Cobranca | null }>(
        `/admin/cobranca/clinicas/${clinicaId}/assinatura`,
        dados,
      ),
    onSuccess: apos,
  });
}

export function useDesativarCobrancaClinica() {
  const apos = useAposAlterarCobranca();
  return useMutation({
    mutationFn: (clinicaId: string) =>
      api.delete<{ assinatura: AssinaturaCobranca | null }>(`/admin/cobranca/clinicas/${clinicaId}/assinatura`),
    onSuccess: apos,
  });
}

// ----------------------------------------------------------------------------- eventos

export function useEventosGateway(filtros: FiltrosEventos) {
  return useQuery({
    queryKey: chavesAdminCobranca.eventos(filtros),
    queryFn: () => api.get<Paginado<EventoGateway>>('/admin/cobranca/eventos', filtros),
    placeholderData: keepPreviousData,
  });
}

// ----------------------------------------------------------------------------- clínica

/** Faturas da própria clínica (admin da clínica). */
export function useMinhasCobrancas(habilitado = true) {
  return useQuery({
    queryKey: chavesAdminCobranca.minhas,
    queryFn: () => api.get<Cobranca[]>('/cobrancas/minhas'),
    enabled: habilitado,
  });
}
