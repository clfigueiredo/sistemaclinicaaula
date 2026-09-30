/**
 * Tipos compartilhados entre os módulos do front (espelham as respostas da API).
 * Tipos específicos de um módulo ficam no arquivo do próprio módulo em src/api/<modulo>.ts.
 */

export type Papel = 'admin' | 'recepcao' | 'profissional';

export type StatusAssinatura = 'teste' | 'ativa' | 'vencida' | 'cancelada' | 'bloqueada';

export type PeriodoLimite = 'total' | 'mensal';

export type CodigoRecurso =
  | 'max_profissionais'
  | 'max_recepcionistas'
  | 'max_agendamentos'
  | 'max_anexos'
  | 'whatsapp'
  | 'max_mensagens'
  | 'financeiro'
  | 'agendamento_online'
  // Fase 2 do produto
  | 'lista_espera'
  | 'documentos_pdf'
  | 'retorno_automatico'
  | 'dashboard';

export type StatusAgendamento = 'agendado' | 'confirmado' | 'compareceu' | 'atendido' | 'cancelado' | 'faltou';

export type TipoAgendamento = 'particular' | 'convenio';

export type ResumoRecurso = {
  nome: string;
  tipo: 'limite' | 'booleano';
  habilitado: boolean;
  /** null = ilimitado */
  limite: number | null;
  periodo: PeriodoLimite | null;
  /** null para recursos liga/desliga */
  uso: number | null;
};

export type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  profissionalId: string | null;
};

/** Resposta de GET /me */
export type Me = {
  usuario: UsuarioSessao;
  papel: Papel;
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
    /** Endereço público do agendamento online: /agendar/:slug (null = sem agendamento online). */
    slug: string | null;
    status: 'ativa' | 'inativa';
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
};

/** Resposta de GET /admin/me */
export type AdminMe = { usuario: { id: string; nome: string; email: string } };

/** Resposta paginada padrão (sugestão para listas grandes). */
export type Paginado<T> = { itens: T[]; total: number; pagina: number; porPagina: number };

export const ROTULOS_PAPEL: Record<Papel, string> = {
  admin: 'Administrador',
  recepcao: 'Recepção',
  profissional: 'Profissional',
};

export const ROTULOS_STATUS_AGENDAMENTO: Record<StatusAgendamento, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  compareceu: 'Compareceu',
  atendido: 'Atendido',
  cancelado: 'Cancelado',
  faltou: 'Faltou',
};

export const ROTULOS_STATUS_ASSINATURA: Record<StatusAssinatura, string> = {
  teste: 'Teste grátis',
  ativa: 'Ativa',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
  bloqueada: 'Bloqueada',
};

// ============================================================================
// Fase 2 do produto — enums compartilhados (espelham o schema Prisma). Contratos: docs/FASE2.md
// Valores monetários vêm da API como string decimal ("150.00"); envie number.
// Datas sem hora (vencimento, data da movimentação, data_prevista) trafegam como 'YYYY-MM-DD'.
// ============================================================================

export type FormaPagamento =
  | 'dinheiro'
  | 'pix'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'boleto'
  | 'transferencia'
  | 'convenio'
  | 'outro';

export const ROTULOS_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  convenio: 'Convênio',
  outro: 'Outro',
};

export type TipoContaFinanceira = 'caixa' | 'banco' | 'carteira_digital' | 'outro';
export const ROTULOS_TIPO_CONTA: Record<TipoContaFinanceira, string> = {
  caixa: 'Caixa',
  banco: 'Banco',
  carteira_digital: 'Carteira digital',
  outro: 'Outro',
};

export type TipoCategoriaFinanceira = 'receita' | 'despesa';
export type TipoMovimentacao = 'entrada' | 'saida';
export type OrigemMovimentacao = 'manual' | 'consulta' | 'titulo' | 'repasse' | 'estorno';
export const ROTULOS_ORIGEM_MOVIMENTACAO: Record<OrigemMovimentacao, string> = {
  manual: 'Lançamento',
  consulta: 'Consulta',
  titulo: 'Conta paga/recebida',
  repasse: 'Repasse',
  estorno: 'Estorno',
};

export type TipoTitulo = 'pagar' | 'receber';
/** `vencido` é derivado pela API (aberto e vencimento < hoje); não existe no banco. */
export type StatusTitulo = 'aberto' | 'pago' | 'cancelado' | 'vencido';
export const ROTULOS_STATUS_TITULO: Record<StatusTitulo, string> = {
  aberto: 'Em aberto',
  pago: 'Pago',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
};

export type StatusSolicitacaoAgendamento = 'pendente' | 'aprovada' | 'recusada' | 'expirada';
export const ROTULOS_STATUS_SOLICITACAO: Record<StatusSolicitacaoAgendamento, string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  expirada: 'Expirada',
};

export type StatusListaEspera = 'aguardando' | 'agendado' | 'removido';
export const ROTULOS_STATUS_LISTA_ESPERA: Record<StatusListaEspera, string> = {
  aguardando: 'Aguardando',
  agendado: 'Agendado',
  removido: 'Removido',
};

export type Turno = 'manha' | 'tarde' | 'noite';
export const ROTULOS_TURNO: Record<Turno, string> = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };

export type TipoDocumentoClinico = 'receita' | 'atestado' | 'declaracao' | 'pedido_exame';
export const ROTULOS_TIPO_DOCUMENTO: Record<TipoDocumentoClinico, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
  declaracao: 'Declaração',
  pedido_exame: 'Pedido de exame',
};

export type StatusRetorno = 'pendente' | 'agendado' | 'lembrado' | 'cancelado';
export const ROTULOS_STATUS_RETORNO: Record<StatusRetorno, string> = {
  pendente: 'Pendente',
  agendado: 'Agendado',
  lembrado: 'Convidado',
  cancelado: 'Cancelado',
};

export type ProvedorPagamento = 'asaas' | 'stripe' | 'mercado_pago';
export const ROTULOS_PROVEDOR_PAGAMENTO: Record<ProvedorPagamento, string> = {
  asaas: 'Asaas',
  stripe: 'Stripe',
  mercado_pago: 'Mercado Pago',
};
export type AmbienteGateway = 'sandbox' | 'producao';
export type MetodoCobranca = 'pix' | 'boleto' | 'cartao';
export const ROTULOS_METODO_COBRANCA: Record<MetodoCobranca, string> = { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão' };
export type StatusCobranca = 'pendente' | 'paga' | 'vencida' | 'cancelada' | 'estornada';
export const ROTULOS_STATUS_COBRANCA: Record<StatusCobranca, string> = {
  pendente: 'Pendente',
  paga: 'Paga',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
  estornada: 'Estornada',
};
