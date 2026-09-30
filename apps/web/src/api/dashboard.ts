/**
 * API do dashboard da clínica (DONO: dashboard). Contrato: docs/FASE2.md §6 e o cabeçalho de
 * apps/api/src/modulos/dashboard/index.ts.
 * (Não confundir com o dashboard do super admin: GET /admin/dashboard em adminClinicas.ts.)
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './cliente';
import type { Papel, StatusAgendamento, TipoAgendamento } from './tipos';

export const chavesDashboard = {
  todos: ['dashboard'] as const,
  resumo: (filtros: object) => [...chavesDashboard.todos, filtros] as const,
};

export type FiltrosDashboard = { inicio: string; fim: string; profissionalId?: string };

export type ResumoAgendaDashboard = {
  total: number;
  agendados: number;
  confirmados: number;
  compareceram: number;
  atendidos: number;
  faltas: number;
  cancelados: number;
  /** Não cancelados com início já alcançado (base das taxas de comparecimento e faltas). */
  realizados_base: number;
  /** 0–1; null quando não há base. */
  taxa_comparecimento: number | null;
  taxa_faltas: number | null;
  taxa_confirmacao: number | null;
  taxa_cancelamento: number | null;
  novos_pacientes: number;
};

type ProfissionalResumo = { id: string; nome: string; cor_agenda: string | null };
type ValorQuantidade = { valor: string; quantidade: number };

export type FinanceiroDashboard = {
  receitas: string;
  despesas: string;
  saldo: string;
  anterior: { receitas: string; despesas: string; saldo: string };
  a_receber: string;
  a_pagar: string;
  vencidos: number;
  receber_vencido: ValorQuantidade;
  receber_proximos_7_dias: ValorQuantidade;
  pagar_vencido: ValorQuantidade;
  pagar_proximos_7_dias: ValorQuantidade;
  ticket_medio: string | null;
  atendimentos_recebidos: number;
  por_categoria: { categoria: string; tipo: 'receita' | 'despesa'; total: string }[];
  receita_por_profissional: { profissional: ProfissionalResumo; total: string; lancamentos: number }[];
};

export type DashboardClinica = {
  periodo: { inicio: string; fim: string; fuso: string; dias: number; hoje: string };
  periodo_anterior: { inicio: string; fim: string };
  escopo: { papel: Papel; profissional_id: string | null; profissional_forcado: boolean };
  agenda: ResumoAgendaDashboard;
  agenda_anterior: ResumoAgendaDashboard;
  por_profissional: {
    profissional: ProfissionalResumo & { ativo: boolean };
    total: number;
    confirmados: number;
    atendidos: number;
    faltas: number;
    cancelados: number;
    taxa_comparecimento: number | null;
  }[];
  por_dia: { data: string; total: number; atendidos: number; faltas: number; cancelados: number }[];
  por_dia_semana: { dia_semana: number; total: number }[];
  por_hora: { hora: number; total: number }[];
  hoje: {
    id: string;
    inicio: string;
    fim: string;
    status: StatusAgendamento;
    tipo: TipoAgendamento;
    paciente: { id: string; nome: string };
    profissional: ProfissionalResumo;
  }[];
  financeiro: FinanceiroDashboard | null;
  /** Cada item é null quando o recurso correspondente está desligado (ou o papel não tem acesso). */
  pendencias: {
    solicitacoes_pendentes: number | null;
    lista_espera: number | null;
    retornos_pendentes: number | null;
    retornos_vencidos: number | null;
  };
};

export function useDashboard(filtros: FiltrosDashboard, habilitado = true) {
  return useQuery({
    queryKey: chavesDashboard.resumo(filtros),
    queryFn: () =>
      api.get<DashboardClinica>('/dashboard', {
        inicio: filtros.inicio,
        fim: filtros.fim,
        profissional_id: filtros.profissionalId,
      }),
    enabled: habilitado,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
