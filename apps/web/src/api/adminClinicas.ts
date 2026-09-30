/**
 * API do módulo admin-clinicas (super admin): clínicas, assinaturas e dashboard.
 *
 *   GET   /admin/dashboard
 *   GET   /admin/clinicas?busca=&status=&planoId=&situacao=&pagina=&porPagina=
 *   GET   /admin/clinicas/:id
 *   PATCH /admin/clinicas/:id                { status: 'ativa' | 'inativa' }
 *   PUT   /admin/clinicas/:id/assinatura     { plano_id?, status?, expira_em? }
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import type { CodigoRecurso, Paginado, Papel, PeriodoLimite, ResumoRecurso, StatusAssinatura } from './tipos';

export type SituacaoClinica = 'ativa' | 'inativa';

export type ClinicaListaAdmin = {
  id: string;
  nome: string;
  documento: string;
  responsavel: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  status: SituacaoClinica;
  criado_em: string;
  assinatura: {
    status: StatusAssinatura;
    status_cadastrado: StatusAssinatura;
    expira_em: string | null;
    plano: { id: string; nome: string; preco: string };
  } | null;
  contadores: { usuarios: number; profissionais: number; pacientes: number; agendamentos: number };
};

export type FiltrosClinicas = {
  busca?: string;
  status?: StatusAssinatura | 'sem_assinatura';
  planoId?: string;
  situacao?: SituacaoClinica;
  pagina?: number;
  porPagina?: number;
};

export type UsuarioClinicaAdmin = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  profissional_id: string | null;
  ultimo_acesso_em: string | null;
  criado_em: string;
};

export type DetalheClinicaAdmin = {
  clinica: {
    id: string;
    nome: string;
    documento: string;
    responsavel: string | null;
    email: string | null;
    telefone: string | null;
    endereco: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    fuso_horario: string;
    status: SituacaoClinica;
    criado_em: string;
    atualizado_em: string;
  };
  assinatura: {
    id: string;
    status: StatusAssinatura | null;
    status_cadastrado: StatusAssinatura;
    inicio: string;
    expira_em: string | null;
    somente_leitura: boolean;
  } | null;
  plano: { id: string; nome: string; preco: string } | null;
  recursos: Record<CodigoRecurso, ResumoRecurso>;
  usuarios: UsuarioClinicaAdmin[];
  whatsapp: { status: string; telefone: string | null } | null;
  contadores: { pacientes: number; agendamentos: number; profissionais: number; registros_prontuario: number };
};

export type DadosAssinatura = {
  plano_id?: string;
  status?: StatusAssinatura;
  /** ISO; null = não expira */
  expira_em?: string | null;
};

export type ClinicaNoLimite = {
  id: string;
  nome: string;
  plano: { id: string; nome: string };
  status: StatusAssinatura;
  recursos: { codigo: CodigoRecurso; nome: string; uso: number; limite: number; periodo: PeriodoLimite }[];
};

export type DashboardAdmin = {
  total_clinicas: number;
  clinicas_ativas: number;
  clinicas_inativas: number;
  sem_assinatura: number;
  por_status: Record<StatusAssinatura, number>;
  por_plano: { plano_id: string; nome: string; ativo: boolean; preco: string; total: number }[];
  cadastros_30_dias: { data: string; total: number }[];
  novos_30_dias: number;
  receita_mensal_estimada: string;
  clinicas_no_limite: ClinicaNoLimite[];
};

export const chavesClinicaAdmin = {
  todos: ['admin', 'clinicas'] as const,
  lista: (filtros?: FiltrosClinicas) => [...chavesClinicaAdmin.todos, 'lista', filtros ?? {}] as const,
  detalhe: (id: string) => [...chavesClinicaAdmin.todos, 'detalhe', id] as const,
  dashboard: ['admin', 'dashboard'] as const,
};

export function useDashboardAdmin() {
  return useQuery({
    queryKey: chavesClinicaAdmin.dashboard,
    queryFn: () => api.get<DashboardAdmin>('/admin/dashboard'),
    staleTime: 30_000,
  });
}

export function useListaClinicasAdmin(filtros: FiltrosClinicas) {
  return useQuery({
    queryKey: chavesClinicaAdmin.lista(filtros),
    queryFn: () => api.get<Paginado<ClinicaListaAdmin>>('/admin/clinicas', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useClinicaAdmin(id: string | undefined) {
  return useQuery({
    queryKey: chavesClinicaAdmin.detalhe(id ?? ''),
    queryFn: () => api.get<DetalheClinicaAdmin>(`/admin/clinicas/${id}`),
    enabled: !!id,
  });
}

function useAposAlterarClinica() {
  const qc = useQueryClient();
  return (dados: DetalheClinicaAdmin) => {
    qc.setQueryData(chavesClinicaAdmin.detalhe(dados.clinica.id), dados);
    qc.invalidateQueries({ queryKey: chavesClinicaAdmin.todos });
    qc.invalidateQueries({ queryKey: chavesClinicaAdmin.dashboard });
    qc.invalidateQueries({ queryKey: ['admin', 'planos'] }); // total de clínicas por plano
  };
}

export function useAlterarSituacaoClinica(id: string) {
  const apos = useAposAlterarClinica();
  return useMutation({
    mutationFn: (status: SituacaoClinica) => api.patch<DetalheClinicaAdmin>(`/admin/clinicas/${id}`, { status }),
    onSuccess: apos,
  });
}

export function useAlterarAssinatura(id: string) {
  const apos = useAposAlterarClinica();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: DadosAssinatura) =>
      api.put<DetalheClinicaAdmin & { cobranca_automatica?: { ativada: boolean; mensagem: string } | null }>(
        `/admin/clinicas/${id}/assinatura`,
        dados,
      ),
    onSuccess: (dados) => {
      apos(dados);
      // Trocar para plano pago pode ligar a cobrança automática (bloco de cobrança do detalhe).
      qc.invalidateQueries({ queryKey: ['admin', 'cobranca'] });
    },
  });
}
