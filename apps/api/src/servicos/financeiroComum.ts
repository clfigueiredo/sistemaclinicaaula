/**
 * Regras financeiras compartilhadas entre os módulos `financeiro` e `dashboard` (fase 2).
 *
 * VALOR EFETIVO (receitas/despesas de relatórios e KPIs):
 *   uma movimentação conta se NÃO é um estorno e NÃO foi estornada. Assim o par (original, estorno)
 *   some dos totais, e o saldo de caixa continua correto somando tudo (entradas − saídas, estornos inclusos).
 *
 *   request.db.movimentacaoFinanceira.aggregate({
 *     where: { ...WHERE_MOVIMENTACAO_EFETIVA, tipo: 'entrada', data: { gte, lte } },
 *     _sum: { valor: true },
 *   })
 *
 * SALDO DE UMA CONTA: saldo_inicial + Σ entradas − Σ saídas (TODAS, inclusive estornos).
 *
 * Datas `@db.Date` (movimentacoes.data, titulos.vencimento…): o Prisma lê/grava meia-noite UTC.
 * Converta 'YYYY-MM-DD' com `dataSemHora()` e devolva com `paraDataIso()`.
 * "Hoje" é o dia no fuso da clínica: `hojeNoFuso(fuso)`.
 */
import type { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';

export const WHERE_MOVIMENTACAO_EFETIVA = {
  origem: { not: 'estorno' },
  estornada_por: { is: null },
} satisfies Prisma.MovimentacaoFinanceiraWhereInput;

/** 'YYYY-MM-DD' → Date meia-noite UTC (formato das colunas @db.Date). */
export function dataSemHora(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Data inválida: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Date de coluna @db.Date → 'YYYY-MM-DD'. */
export function paraDataIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/** Dia de hoje ('YYYY-MM-DD') no fuso da clínica. */
export function hojeNoFuso(fuso: string, agora = new Date()): string {
  return formatInTimeZone(agora, fuso, 'yyyy-MM-dd');
}

/** Converte Prisma.Decimal/number/string em number com 2 casas (para somas em memória). */
export function paraNumero(valor: Prisma.Decimal | number | string | null | undefined): number {
  if (valor === null || valor === undefined) return 0;
  return Math.round(Number(valor) * 100) / 100;
}
