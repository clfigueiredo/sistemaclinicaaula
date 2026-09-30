/**
 * API do módulo financeiro. Contrato: docs/FASE2.md §1 (+ extras documentados em apps/api/src/modulos/financeiro/index.ts).
 *
 * Valores chegam como string decimal ("150.00") — use Number()/formatarMoeda; envie number.
 * Datas sem hora ('YYYY-MM-DD'): vencimento, data da movimentação, períodos.
 * Toda mutação invalida `chavesFinanceiro.todos` (saldos/totais dependem de tudo).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import type {
  FormaPagamento,
  OrigemMovimentacao,
  Paginado,
  StatusTitulo,
  TipoCategoriaFinanceira,
  TipoContaFinanceira,
  TipoMovimentacao,
  TipoTitulo,
} from './tipos';

export const chavesFinanceiro = {
  todos: ['financeiro'] as const,
  contas: () => [...chavesFinanceiro.todos, 'contas'] as const,
  categorias: (tipo?: string) => [...chavesFinanceiro.todos, 'categorias', { tipo }] as const,
  movimentacoes: (filtros: object) => [...chavesFinanceiro.todos, 'movimentacoes', filtros] as const,
  recebimentosAgendamento: (agendamentoId: string) =>
    [...chavesFinanceiro.todos, 'recebimentos', agendamentoId] as const,
  titulos: (filtros: object) => [...chavesFinanceiro.todos, 'titulos', filtros] as const,
  recorrencias: () => [...chavesFinanceiro.todos, 'recorrencias'] as const,
  repasses: (filtros: object) => [...chavesFinanceiro.todos, 'repasses', filtros] as const,
  entradasRepasse: (filtros: object) => [...chavesFinanceiro.todos, 'repasses', 'entradas', filtros] as const,
  meusRecebimentos: (filtros: object) => [...chavesFinanceiro.todos, 'meus-recebimentos', filtros] as const,
  relatorios: (tipo: string, filtros: object) => [...chavesFinanceiro.todos, 'relatorios', tipo, filtros] as const,
  profissionais: () => [...chavesFinanceiro.todos, 'profissionais'] as const,
};

// ----------------------------------------------------------------------------- tipos

export type Periodo = { inicio: string; fim: string };
type Ref = { id: string; nome: string };

export type ContaFinanceira = {
  id: string;
  nome: string;
  tipo: TipoContaFinanceira;
  saldo_inicial: string;
  saldo_atual: string;
  ativo: boolean;
  criado_em: string;
};

export type CategoriaFinanceira = {
  id: string;
  nome: string;
  tipo: TipoCategoriaFinanceira;
  padrao: boolean;
  ativo: boolean;
  criado_em: string;
};

export type Movimentacao = {
  id: string;
  tipo: TipoMovimentacao;
  origem: OrigemMovimentacao;
  data: string;
  valor: string;
  forma_pagamento: FormaPagamento;
  descricao: string | null;
  conta_financeira_id: string;
  categoria_id: string | null;
  agendamento_id: string | null;
  paciente_id: string | null;
  profissional_id: string | null;
  titulo_id: string | null;
  estorno_de_id: string | null;
  repasse_inicio: string | null;
  repasse_fim: string | null;
  criado_em: string;
  conta: Ref;
  categoria: (Ref & { tipo: TipoCategoriaFinanceira }) | null;
  paciente: Ref | null;
  profissional: Ref | null;
  titulo: { id: string; descricao: string; tipo: TipoTitulo } | null;
  criador: Ref | null;
  estornada: boolean;
  estorno_id: string | null;
};

export type Totais = { entradas: string; saidas: string; saldo: string };
export type ListaMovimentacoes = Paginado<Movimentacao> & { periodo: Periodo; totais: Totais };

export type FiltrosMovimentacoes = Partial<Periodo> & {
  conta_id?: string;
  tipo?: TipoMovimentacao;
  origem?: OrigemMovimentacao;
  categoria_id?: string;
  profissional_id?: string;
  paciente_id?: string;
  forma_pagamento?: FormaPagamento;
  busca?: string;
  pagina?: number;
  por_pagina?: number;
};

export type NovaMovimentacao = {
  tipo: TipoMovimentacao;
  data: string;
  valor: number;
  conta_financeira_id: string;
  forma_pagamento: FormaPagamento;
  categoria_id?: string | null;
  descricao?: string | null;
  paciente_id?: string | null;
  profissional_id?: string | null;
  agendamento_id?: string | null;
};

export type Titulo = {
  id: string;
  tipo: TipoTitulo;
  descricao: string;
  valor: string;
  vencimento: string;
  status: Exclude<StatusTitulo, 'vencido'>;
  status_exibicao: StatusTitulo;
  categoria_id: string | null;
  paciente_id: string | null;
  profissional_id: string | null;
  fornecedor: string | null;
  forma_pagamento: FormaPagamento | null;
  parcela_numero: number | null;
  parcela_total: number | null;
  grupo_parcelas_id: string | null;
  recorrencia_id: string | null;
  competencia: string | null;
  observacoes: string | null;
  agendamento_id: string | null;
  pago_em: string | null;
  valor_pago: string | null;
  cancelado_em: string | null;
  criado_em: string;
  categoria: (Ref & { tipo: TipoCategoriaFinanceira }) | null;
  paciente: Ref | null;
  profissional: Ref | null;
  recorrencia: { id: string; descricao: string; ativo: boolean } | null;
  movimentacao_id: string | null;
};

export type FiltroStatusTitulo = 'aberto' | 'a_vencer' | 'vencido' | 'pago' | 'cancelado';
export type FiltrosTitulos = Partial<Periodo> & {
  tipo: TipoTitulo;
  status?: FiltroStatusTitulo;
  paciente_id?: string;
  profissional_id?: string;
  categoria_id?: string;
  busca?: string;
  pagina?: number;
  por_pagina?: number;
};
type Agregado = { quantidade: number; valor: string };
export type ListaTitulos = Paginado<Titulo> & {
  totais: { a_vencer: Agregado; vencidos: Agregado; pagos_periodo: Agregado };
};

export type DadosTitulo = {
  descricao: string;
  valor: number;
  vencimento: string;
  categoria_id?: string | null;
  paciente_id?: string | null;
  profissional_id?: string | null;
  fornecedor?: string | null;
  forma_pagamento?: FormaPagamento | null;
  observacoes?: string | null;
};

export type DadosBaixa = {
  data: string;
  conta_financeira_id: string;
  forma_pagamento: FormaPagamento;
  juros?: number;
  desconto?: number;
  valor_pago?: number;
  descricao?: string | null;
};

export type Recorrencia = {
  id: string;
  tipo: TipoTitulo;
  descricao: string;
  valor: string;
  dia_vencimento: number;
  frequencia: 'mensal';
  inicio: string;
  fim: string | null;
  ativo: boolean;
  categoria_id: string | null;
  paciente_id: string | null;
  profissional_id: string | null;
  fornecedor: string | null;
  forma_pagamento: FormaPagamento | null;
  ultima_competencia: string | null;
  criado_em: string;
  categoria: Ref | null;
  paciente: Ref | null;
  profissional: Ref | null;
  titulos_abertos: number;
  titulos_gerados: number;
};

export type DadosRecorrencia = {
  tipo?: TipoTitulo;
  descricao?: string;
  valor?: number;
  dia_vencimento?: number;
  inicio?: string;
  fim?: string | null;
  categoria_id?: string | null;
  paciente_id?: string | null;
  profissional_id?: string | null;
  fornecedor?: string | null;
  forma_pagamento?: FormaPagamento | null;
  ativo?: boolean;
};

export type ProfissionalRepasse = {
  id: string;
  nome: string;
  especialidade: string | null;
  ativo: boolean;
  percentual_repasse: string | null;
};

export type LinhaRepasse = {
  profissional: { id: string; nome: string; ativo: boolean };
  percentual: string | null;
  total_entradas: string;
  quantidade_entradas: number;
  valor_repasse: string;
  pago: string;
  saldo: string;
};

export type EntradaRepasse = {
  id: string;
  data: string;
  valor: string;
  forma_pagamento: FormaPagamento;
  descricao: string | null;
  origem: OrigemMovimentacao;
  agendamento_id: string | null;
  paciente: Ref | null;
  categoria: Ref | null;
};

export type MeusRecebimentos = {
  periodo: Periodo;
  itens: EntradaRepasse[];
  total_entradas: string;
  percentual: string | null;
  valor_repasse: string;
  pago: string;
  saldo: string;
};

export type ResumoFinanceiro = {
  periodo: Periodo;
  receitas: string;
  despesas: string;
  saldo: string;
  por_categoria: { categoria_id: string | null; categoria: string; tipo: TipoCategoriaFinanceira; total: string; quantidade: number }[];
  por_forma_pagamento: { forma_pagamento: FormaPagamento; entradas: string; saidas: string }[];
  por_profissional: { profissional: Ref; entradas: string; quantidade: number }[];
  por_dia: { data: string; entradas: string; saidas: string }[];
  a_receber_aberto: string;
  a_pagar_aberto: string;
  vencidos: number;
  vencidos_detalhe: { receber: Agregado; pagar: Agregado };
};

export type FluxoCaixa = {
  periodo: Periodo;
  agrupamento: 'dia' | 'mes';
  saldo_inicial: string;
  saldo_final: string;
  total_entradas: string;
  total_saidas: string;
  dias: { data: string; entradas: string; saidas: string; saldo: string }[];
};

export type RecebimentosAgendamento = { itens: Movimentacao[]; total: string; titulos: Titulo[] };

export type TipoExportacao = 'movimentacoes' | 'categorias' | 'formas' | 'profissionais' | 'fluxo' | 'repasses';

// ----------------------------------------------------------------------------- hooks: cadastros

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: chavesFinanceiro.todos });
}

export function useContasFinanceiras() {
  return useQuery({
    queryKey: chavesFinanceiro.contas(),
    queryFn: () => api.get<ContaFinanceira[]>('/financeiro/contas'),
  });
}

export function useSalvarConta() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({
      id,
      ...dados
    }: { id?: string; nome?: string; tipo?: TipoContaFinanceira; saldo_inicial?: number; ativo?: boolean }) =>
      id ? api.put<ContaFinanceira>(`/financeiro/contas/${id}`, dados) : api.post<ContaFinanceira>('/financeiro/contas', dados),
    onSuccess: invalidar,
  });
}

export function useCategoriasFinanceiras(tipo?: TipoCategoriaFinanceira) {
  return useQuery({
    queryKey: chavesFinanceiro.categorias(tipo),
    queryFn: () => api.get<CategoriaFinanceira[]>('/financeiro/categorias', { tipo }),
    staleTime: 60_000,
  });
}

export function useSalvarCategoria() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: { id?: string; nome?: string; tipo?: TipoCategoriaFinanceira; ativo?: boolean }) =>
      id
        ? api.put<CategoriaFinanceira>(`/financeiro/categorias/${id}`, dados)
        : api.post<CategoriaFinanceira>('/financeiro/categorias', dados),
    onSuccess: invalidar,
  });
}

export function useProfissionaisRepasse(habilitado = true) {
  return useQuery({
    queryKey: chavesFinanceiro.profissionais(),
    queryFn: () => api.get<ProfissionalRepasse[]>('/financeiro/profissionais'),
    enabled: habilitado,
  });
}

export function useDefinirPercentualRepasse() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, percentual_repasse }: { id: string; percentual_repasse: number | null }) =>
      api.put<ProfissionalRepasse>(`/financeiro/profissionais/${id}/repasse`, { percentual_repasse }),
    onSuccess: invalidar,
  });
}

// ----------------------------------------------------------------------------- hooks: caixa

export function useMovimentacoes(filtros: FiltrosMovimentacoes) {
  return useQuery({
    queryKey: chavesFinanceiro.movimentacoes(filtros),
    queryFn: () => api.get<ListaMovimentacoes>('/financeiro/movimentacoes', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useCriarMovimentacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: NovaMovimentacao) => api.post<Movimentacao>('/financeiro/movimentacoes', dados),
    onSuccess: invalidar,
  });
}

export function useEditarMovimentacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: { id: string; descricao?: string | null; categoria_id?: string | null }) =>
      api.put<Movimentacao>(`/financeiro/movimentacoes/${id}`, dados),
    onSuccess: invalidar,
  });
}

export function useEstornarMovimentacao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo?: string | null }) =>
      api.post<Movimentacao>(`/financeiro/movimentacoes/${id}/estorno`, { motivo }),
    onSuccess: invalidar,
  });
}

export function useRecebimentosAgendamento(agendamentoId: string) {
  return useQuery({
    queryKey: chavesFinanceiro.recebimentosAgendamento(agendamentoId),
    queryFn: () => api.get<RecebimentosAgendamento>(`/financeiro/recebimentos/agendamento/${agendamentoId}`),
  });
}

export function useRegistrarRecebimento() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: {
      agendamento_id: string;
      valor: number;
      forma_pagamento: FormaPagamento;
      conta_financeira_id: string;
      categoria_id?: string | null;
      data?: string;
      descricao?: string | null;
    }) => api.post<Movimentacao>('/financeiro/recebimentos', dados),
    onSuccess: invalidar,
  });
}

export function useLancarAReceberConvenio() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: { agendamento_id: string; valor: number; vencimento: string; observacoes?: string | null }) =>
      api.post<Titulo>('/financeiro/recebimentos/convenio', dados),
    onSuccess: invalidar,
  });
}

// ----------------------------------------------------------------------------- hooks: títulos

export function useTitulos(filtros: FiltrosTitulos) {
  return useQuery({
    queryKey: chavesFinanceiro.titulos(filtros),
    queryFn: () => api.get<ListaTitulos>('/financeiro/titulos', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useCriarTitulo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: DadosTitulo & { tipo: TipoTitulo; parcelas?: number }) =>
      api.post<Titulo[]>('/financeiro/titulos', dados),
    onSuccess: invalidar,
  });
}

export function useEditarTitulo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: Partial<DadosTitulo> & { id: string }) => api.put<Titulo>(`/financeiro/titulos/${id}`, dados),
    onSuccess: invalidar,
  });
}

export function useBaixarTitulo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: DadosBaixa & { id: string }) =>
      api.post<{ titulo: Titulo; movimentacao: Movimentacao }>(`/financeiro/titulos/${id}/baixa`, dados),
    onSuccess: invalidar,
  });
}

export function useCancelarTitulo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => api.post<Titulo>(`/financeiro/titulos/${id}/cancelar`),
    onSuccess: invalidar,
  });
}

// ----------------------------------------------------------------------------- hooks: recorrências

export function useRecorrencias() {
  return useQuery({
    queryKey: chavesFinanceiro.recorrencias(),
    queryFn: () => api.get<Recorrencia[]>('/financeiro/recorrencias'),
  });
}

export function useSalvarRecorrencia() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: DadosRecorrencia & { id?: string }) =>
      id
        ? api.put<Recorrencia>(`/financeiro/recorrencias/${id}`, dados)
        : api.post<Recorrencia & { titulos: Titulo[] }>('/financeiro/recorrencias', dados),
    onSuccess: invalidar,
  });
}

// ----------------------------------------------------------------------------- hooks: repasses

export function useRepasses(filtros: Partial<Periodo> & { profissional_id?: string }) {
  return useQuery({
    queryKey: chavesFinanceiro.repasses(filtros),
    queryFn: () => api.get<LinhaRepasse[]>('/financeiro/repasses', filtros),
    placeholderData: keepPreviousData,
  });
}

export function useEntradasRepasse(filtros: Partial<Periodo> & { profissional_id?: string }, habilitado = true) {
  return useQuery({
    queryKey: chavesFinanceiro.entradasRepasse(filtros),
    queryFn: () => api.get<EntradaRepasse[]>('/financeiro/repasses/entradas', filtros),
    enabled: habilitado,
  });
}

export function usePagarRepasse() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: {
      profissional_id: string;
      inicio: string;
      fim: string;
      valor: number;
      data: string;
      conta_financeira_id: string;
      forma_pagamento: FormaPagamento;
      descricao?: string | null;
    }) => api.post<Movimentacao>('/financeiro/repasses/pagamentos', dados),
    onSuccess: invalidar,
  });
}

export function useMeusRecebimentos(filtros: Partial<Periodo>, habilitado = true) {
  return useQuery({
    queryKey: chavesFinanceiro.meusRecebimentos(filtros),
    queryFn: () => api.get<MeusRecebimentos>('/financeiro/meus-recebimentos', filtros),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });
}

// ----------------------------------------------------------------------------- hooks: relatórios

export function useResumoFinanceiro(periodo: Periodo) {
  return useQuery({
    queryKey: chavesFinanceiro.relatorios('resumo', periodo),
    queryFn: () => api.get<ResumoFinanceiro>('/financeiro/relatorios/resumo', periodo),
    placeholderData: keepPreviousData,
  });
}

export function useFluxoCaixa(filtros: Periodo & { conta_id?: string; agrupamento?: 'dia' | 'mes' }) {
  return useQuery({
    queryKey: chavesFinanceiro.relatorios('fluxo', filtros),
    queryFn: () => api.get<FluxoCaixa>('/financeiro/relatorios/fluxo-caixa', filtros),
    placeholderData: keepPreviousData,
  });
}

/** Baixa o CSV e dispara o download no navegador. */
export async function exportarCsv(tipo: TipoExportacao, periodo: Periodo, agrupamento?: 'dia' | 'mes') {
  const blob = await api.baixar('/financeiro/relatorios/exportar', { tipo, ...periodo, agrupamento });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `financeiro-${tipo}-${periodo.inicio}_${periodo.fim}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
