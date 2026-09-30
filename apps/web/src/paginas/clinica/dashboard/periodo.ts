// Períodos pré-definidos do dashboard e formatação de variações/taxas.
import { differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, subDays, subMonths } from 'date-fns';

export const MAX_DIAS_PERIODO = 366;

export type ChavePeriodo = 'este_mes' | 'mes_passado' | '7d' | '30d' | '90d' | 'personalizado';

export const ROTULOS_PERIODO: Record<ChavePeriodo, string> = {
  este_mes: 'Este mês',
  mes_passado: 'Mês passado',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  personalizado: 'Personalizado',
};

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Intervalo (datas locais 'YYYY-MM-DD') de um período pré-definido. */
export function intervaloDoPeriodo(chave: Exclude<ChavePeriodo, 'personalizado'>, hoje = new Date()) {
  switch (chave) {
    case 'este_mes':
      return { inicio: iso(startOfMonth(hoje)), fim: iso(endOfMonth(hoje)) };
    case 'mes_passado': {
      const m = subMonths(hoje, 1);
      return { inicio: iso(startOfMonth(m)), fim: iso(endOfMonth(m)) };
    }
    case '7d':
      return { inicio: iso(subDays(hoje, 6)), fim: iso(hoje) };
    case '30d':
      return { inicio: iso(subDays(hoje, 29)), fim: iso(hoje) };
    case '90d':
      return { inicio: iso(subDays(hoje, 89)), fim: iso(hoje) };
  }
}

/** Mensagem de erro do intervalo personalizado (null = válido). */
export function validarIntervalo(inicio: string, fim: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return 'Informe as duas datas.';
  const dias = differenceInCalendarDays(parseISO(fim), parseISO(inicio));
  if (dias < 0) return 'A data final deve ser igual ou posterior à inicial.';
  if (dias >= MAX_DIAS_PERIODO) return `O período máximo é de ${MAX_DIAS_PERIODO} dias.`;
  return null;
}

export function formatarPercentual(taxa: number | null | undefined, casas = 0): string {
  if (taxa === null || taxa === undefined) return '—';
  return (taxa * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

export function formatarNumero(n: number): string {
  return n.toLocaleString('pt-BR');
}

export function formatarDiaCurto(dataIso: string): string {
  return format(parseISO(dataIso), 'dd/MM');
}

export type Variacao = { direcao: 'alta' | 'baixa' | 'igual'; texto: string } | null;

/** Variação de uma contagem/valor (percentual) em relação ao período anterior. */
export function variacaoRelativa(atual: number, anterior: number): Variacao {
  if (anterior === 0 && atual === 0) return { direcao: 'igual', texto: 'sem variação' };
  if (anterior === 0) return { direcao: 'alta', texto: 'novo no período' };
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.5) return { direcao: 'igual', texto: 'estável' };
  const sinal = pct > 0 ? '+' : '−';
  return {
    direcao: pct > 0 ? 'alta' : 'baixa',
    texto: `${sinal}${Math.abs(pct).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`,
  };
}

/** Variação de uma taxa em pontos percentuais. */
export function variacaoTaxa(atual: number | null, anterior: number | null): Variacao {
  if (atual === null || anterior === null) return null;
  const pp = (atual - anterior) * 100;
  if (Math.abs(pp) < 0.5) return { direcao: 'igual', texto: 'estável' };
  const sinal = pp > 0 ? '+' : '−';
  return {
    direcao: pp > 0 ? 'alta' : 'baixa',
    texto: `${sinal}${Math.abs(pp).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`,
  };
}
