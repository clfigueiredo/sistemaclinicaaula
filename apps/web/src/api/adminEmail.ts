/**
 * API dos e-mails transacionais (super admin): configuração do SMTP, modelos editáveis e histórico de envios.
 * Rotas /admin/* usam o token do super admin automaticamente. A senha/API key NUNCA volta da API
 * (só `senha_mascarada`, ex.: '••••1234').
 *
 *   GET|PUT /admin/email/configuracao · POST /admin/email/configuracao/testar
 *   GET     /admin/email/modelos · PUT|DELETE /admin/email/modelos/:tipo
 *   POST    /admin/email/modelos/:tipo/previa · POST /admin/email/modelos/:tipo/teste
 *   GET     /admin/email/envios?tipo&status&busca&pagina&por_pagina · GET /admin/email/envios/:id
 *   POST    /admin/email/envios/:id/reenviar
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';

export const chavesAdminEmail = {
  todos: ['admin', 'email'] as const,
  configuracao: () => [...chavesAdminEmail.todos, 'configuracao'] as const,
  modelos: () => [...chavesAdminEmail.todos, 'modelos'] as const,
  envios: (filtros: object) => [...chavesAdminEmail.todos, 'envios', filtros] as const,
  envio: (id: string) => [...chavesAdminEmail.todos, 'envio', id] as const,
};

// ----------------------------------------------------------------------------- tipos

export type TipoEmail = 'boas_vindas' | 'redefinir_senha' | 'pagamento_confirmado' | 'aviso_renovacao' | 'pagamento_renovado';
export type StatusEmail = 'pendente' | 'enviado' | 'falhou' | 'ignorado';

export const ROTULOS_TIPO_EMAIL: Record<TipoEmail, string> = {
  boas_vindas: 'Boas-vindas',
  redefinir_senha: 'Redefinição de senha',
  pagamento_confirmado: 'Pagamento confirmado',
  aviso_renovacao: 'Aviso de renovação',
  pagamento_renovado: 'Mensalidade recebida',
};

export const ROTULOS_STATUS_EMAIL: Record<StatusEmail, string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  falhou: 'Falhou',
  ignorado: 'Ignorado',
};

/** Motivos gravados em `erro` pelo backend ⇒ texto amigável. */
export const MOTIVOS_EMAIL: Record<string, string> = {
  email_desativado: 'Envio desativado no painel',
  modelo_desligado: 'Modelo desligado',
  envio_incerto: 'Envio incerto (processo interrompido)',
  enviando: 'Enviando…',
  senha_ilegivel: 'Senha do SMTP ilegível (salve a API key de novo)',
};

export function motivoEmail(erro: string | null): string | null {
  if (!erro) return null;
  if (MOTIVOS_EMAIL[erro]) return MOTIVOS_EMAIL[erro];
  if (erro.startsWith('fila_indisponivel')) return 'Fila de envio indisponível';
  return erro;
}

export type ConfiguracaoEmail = {
  ativo: boolean;
  smtp_host: string;
  smtp_porta: number;
  smtp_seguro: boolean;
  smtp_usuario: string;
  senha_definida: boolean;
  /** '••••1234' (vazio se não há senha salva). */
  senha_mascarada: string;
  remetente_nome: string;
  remetente_email: string | null;
  responder_para: string | null;
  /** Tem senha e remetente (dá para enviar). */
  completa: boolean;
  atualizado_em: string;
};

export type DadosConfiguracaoEmail = {
  ativo?: boolean;
  smtp_host?: string;
  smtp_porta?: number;
  smtp_seguro?: boolean;
  smtp_usuario?: string;
  /** Vazio/ausente mantém a atual. */
  smtp_senha?: string;
  remetente_nome?: string;
  /** '' limpa. */
  remetente_email?: string;
  responder_para?: string;
};

export type VariavelEmail = { nome: string; descricao: string; exemplo: string };
export type ConteudoModeloEmail = { assunto: string; corpo: string; texto_botao: string };

export type ModeloEmail = ConteudoModeloEmail & {
  tipo: TipoEmail;
  nome: string;
  descricao: string;
  desligavel: boolean;
  variaveis: VariavelEmail[];
  /** Variável cujo valor é o link do botão. */
  variavelLink: string;
  ativo: boolean;
  /** true = texto editado no painel; false = padrão do sistema. */
  personalizado: boolean;
  atualizado_em: string | null;
  padrao: ConteudoModeloEmail;
};

export type PreviaEmail = { assunto: string; html: string; texto: string };

export type EnvioEmail = {
  id: string;
  tipo: TipoEmail;
  destinatario: string;
  assunto: string;
  status: StatusEmail;
  erro: string | null;
  tentativas: number;
  clinica: { id: string; nome: string } | null;
  criado_em: string;
  enviado_em: string | null;
};

export type EnvioEmailDetalhe = EnvioEmail & { html: string; texto: string; id_externo: string | null };

export type ListaEnviosEmail = { itens: EnvioEmail[]; total: number; pagina: number; por_pagina: number };

export type FiltrosEnviosEmail = {
  tipo?: TipoEmail;
  status?: StatusEmail;
  busca?: string;
  pagina?: number;
  por_pagina?: number;
};

// ----------------------------------------------------------------------------- configuração

export function useConfiguracaoEmail() {
  return useQuery({
    queryKey: chavesAdminEmail.configuracao(),
    queryFn: () => api.get<ConfiguracaoEmail>('/admin/email/configuracao'),
  });
}

export function useSalvarConfiguracaoEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: DadosConfiguracaoEmail) => api.put<ConfiguracaoEmail>('/admin/email/configuracao', dados),
    onSuccess: (salva) => {
      qc.setQueryData(chavesAdminEmail.configuracao(), salva);
      qc.invalidateQueries({ queryKey: chavesAdminEmail.configuracao() });
    },
  });
}

export function useTestarConfiguracaoEmail() {
  return useMutation({
    mutationFn: (para: string) => api.post<{ ok: true }>('/admin/email/configuracao/testar', { para }),
  });
}

// ----------------------------------------------------------------------------- modelos

export function useModelosEmail() {
  return useQuery({
    queryKey: chavesAdminEmail.modelos(),
    queryFn: () => api.get<ModeloEmail[]>('/admin/email/modelos'),
  });
}

export function useSalvarModeloEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tipo, ...dados }: ConteudoModeloEmail & { tipo: TipoEmail; ativo: boolean }) =>
      api.put<ModeloEmail>(`/admin/email/modelos/${tipo}`, dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesAdminEmail.modelos() }),
  });
}

export function useRestaurarModeloEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tipo: TipoEmail) => api.delete<void>(`/admin/email/modelos/${tipo}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesAdminEmail.modelos() }),
  });
}

/** Pré-visualização (mutation: chamada sob demanda, com debounce no editor). */
export function usePreviaModeloEmail() {
  return useMutation({
    mutationFn: ({ tipo, ...dados }: ConteudoModeloEmail & { tipo: TipoEmail }) =>
      api.post<PreviaEmail>(`/admin/email/modelos/${tipo}/previa`, dados),
  });
}

export function useTesteModeloEmail() {
  return useMutation({
    mutationFn: ({ tipo, ...dados }: ConteudoModeloEmail & { tipo: TipoEmail; para: string }) =>
      api.post<{ ok: true }>(`/admin/email/modelos/${tipo}/teste`, dados),
  });
}

// ----------------------------------------------------------------------------- envios

export function useEnviosEmail(filtros: FiltrosEnviosEmail) {
  return useQuery({
    queryKey: chavesAdminEmail.envios(filtros),
    queryFn: () => api.get<ListaEnviosEmail>('/admin/email/envios', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useEnvioEmail(id: string | null) {
  return useQuery({
    queryKey: chavesAdminEmail.envio(id ?? ''),
    queryFn: () => api.get<EnvioEmailDetalhe>(`/admin/email/envios/${id}`),
    enabled: !!id,
  });
}

export function useReenviarEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<EnvioEmail>(`/admin/email/envios/${id}/reenviar`),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: [...chavesAdminEmail.todos, 'envios'] });
      qc.invalidateQueries({ queryKey: chavesAdminEmail.envio(id) });
    },
  });
}
