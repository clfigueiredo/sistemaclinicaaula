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
  | 'agendamento_online';

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
