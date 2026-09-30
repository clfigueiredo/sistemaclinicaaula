/**
 * Serviços do módulo financeiro compartilhados entre rotas e o worker de recorrências:
 * serialização (Decimal → "0.00", @db.Date → 'YYYY-MM-DD'), status derivado de títulos,
 * geração idempotente dos títulos de recorrências e cálculo de repasses.
 */
import type { Prisma, Recorrencia } from '@prisma/client';
import type { DbTenant } from '../../plugins/tenant';
import { WHERE_MOVIMENTACAO_EFETIVA } from '../../servicos/financeiroComum';
import {
  ZERO,
  dataSemHora,
  dec,
  moeda,
  moedaOuNull,
  paraDataIso,
  primeiroDiaMes,
  somarMeses,
} from './comum';

// ----------------------------------------------------------------------------- movimentações

export const includeMovimentacao = {
  conta: { select: { id: true, nome: true } },
  categoria: { select: { id: true, nome: true, tipo: true } },
  paciente: { select: { id: true, nome: true } },
  profissional: { select: { id: true, nome: true } },
  titulo: { select: { id: true, descricao: true, tipo: true } },
  criador: { select: { id: true, nome: true } },
  estornada_por: { select: { id: true, data: true, criado_em: true } },
} satisfies Prisma.MovimentacaoFinanceiraInclude;

export type MovimentacaoCompleta = Prisma.MovimentacaoFinanceiraGetPayload<{ include: typeof includeMovimentacao }>;

export function serializarMovimentacao(m: MovimentacaoCompleta) {
  return {
    id: m.id,
    tipo: m.tipo,
    origem: m.origem,
    data: paraDataIso(m.data),
    valor: moeda(m.valor),
    forma_pagamento: m.forma_pagamento,
    descricao: m.descricao,
    conta_financeira_id: m.conta_financeira_id,
    categoria_id: m.categoria_id,
    agendamento_id: m.agendamento_id,
    paciente_id: m.paciente_id,
    profissional_id: m.profissional_id,
    titulo_id: m.titulo_id,
    estorno_de_id: m.estorno_de_id,
    repasse_inicio: m.repasse_inicio ? paraDataIso(m.repasse_inicio) : null,
    repasse_fim: m.repasse_fim ? paraDataIso(m.repasse_fim) : null,
    criado_em: m.criado_em,
    conta: m.conta,
    categoria: m.categoria,
    paciente: m.paciente,
    profissional: m.profissional,
    titulo: m.titulo,
    criador: m.criador,
    estornada: !!m.estornada_por,
    estorno_id: m.estornada_por?.id ?? null,
  };
}

/** Soma das movimentações efetivas (sem estornos nem estornadas) de um where. */
export async function somarEfetivas(
  db: DbTenant,
  where: Prisma.MovimentacaoFinanceiraWhereInput,
): Promise<{ entradas: Prisma.Decimal; saidas: Prisma.Decimal; qtdEntradas: number; qtdSaidas: number }> {
  const grupos = await db.movimentacaoFinanceira.groupBy({
    by: ['tipo'],
    where: { AND: [where, WHERE_MOVIMENTACAO_EFETIVA] },
    _sum: { valor: true },
    _count: { _all: true },
  });
  const e = grupos.find((g) => g.tipo === 'entrada');
  const s = grupos.find((g) => g.tipo === 'saida');
  return {
    entradas: dec(e?._sum.valor),
    saidas: dec(s?._sum.valor),
    qtdEntradas: e?._count._all ?? 0,
    qtdSaidas: s?._count._all ?? 0,
  };
}

// ----------------------------------------------------------------------------- títulos

export const includeTitulo = {
  categoria: { select: { id: true, nome: true, tipo: true } },
  paciente: { select: { id: true, nome: true } },
  profissional: { select: { id: true, nome: true } },
  recorrencia: { select: { id: true, descricao: true, ativo: true } },
  movimentacoes: {
    select: { id: true, data: true, valor: true, origem: true, estornada_por: { select: { id: true } } },
    orderBy: { criado_em: 'desc' },
  },
} satisfies Prisma.TituloInclude;

export type TituloCompleto = Prisma.TituloGetPayload<{ include: typeof includeTitulo }>;

export function statusExibicao(t: { status: string; vencimento: Date }, hoje: string) {
  if (t.status === 'aberto' && paraDataIso(t.vencimento) < hoje) return 'vencido' as const;
  return t.status as 'aberto' | 'pago' | 'cancelado';
}

export function serializarTitulo(t: TituloCompleto, hoje: string) {
  const baixa = t.movimentacoes.find((m) => m.origem === 'titulo' && !m.estornada_por);
  return {
    id: t.id,
    tipo: t.tipo,
    descricao: t.descricao,
    valor: moeda(t.valor),
    vencimento: paraDataIso(t.vencimento),
    status: t.status,
    status_exibicao: statusExibicao(t, hoje),
    categoria_id: t.categoria_id,
    paciente_id: t.paciente_id,
    profissional_id: t.profissional_id,
    fornecedor: t.fornecedor,
    forma_pagamento: t.forma_pagamento,
    parcela_numero: t.parcela_numero,
    parcela_total: t.parcela_total,
    grupo_parcelas_id: t.grupo_parcelas_id,
    recorrencia_id: t.recorrencia_id,
    competencia: t.competencia ? paraDataIso(t.competencia) : null,
    observacoes: t.observacoes,
    agendamento_id: t.agendamento_id,
    pago_em: t.pago_em,
    valor_pago: moedaOuNull(t.valor_pago),
    cancelado_em: t.cancelado_em,
    criado_em: t.criado_em,
    categoria: t.categoria,
    paciente: t.paciente,
    profissional: t.profissional,
    recorrencia: t.recorrencia,
    movimentacao_id: baixa?.id ?? null,
  };
}

// ----------------------------------------------------------------------------- recorrências

/** Vencimento da recorrência numa competência ('YYYY-MM-01'), com dia limitado ao fim do mês. */
export function vencimentoNaCompetencia(competencia: string, dia: number): string {
  return somarMeses(competencia, 0, dia);
}

/**
 * Garante os títulos do mês corrente (se o vencimento ainda não passou) e do próximo mês de uma
 * recorrência ativa. Idempotente: único (recorrencia_id, competencia) + ON CONFLICT DO NOTHING.
 * Respeita `inicio` (vencimento >= início) e `fim` (vencimento <= fim). Devolve quantos títulos criou.
 */
export async function gerarTitulosRecorrencia(
  db: DbTenant,
  rec: Recorrencia,
  hoje: string,
  criadoPor: string | null = null,
): Promise<number> {
  if (!rec.ativo) return 0;
  const inicio = paraDataIso(rec.inicio);
  const fim = rec.fim ? paraDataIso(rec.fim) : null;
  const atual = primeiroDiaMes(hoje);
  const candidatas = [atual, somarMeses(atual, 1)];

  const novos: Prisma.TituloCreateManyInput[] = [];
  for (const competencia of candidatas) {
    const vencimento = vencimentoNaCompetencia(competencia, rec.dia_vencimento);
    if (competencia === atual && vencimento < hoje) continue;
    if (vencimento < inicio) continue;
    if (fim && vencimento > fim) continue;
    novos.push({
      clinica_id: rec.clinica_id,
      tipo: rec.tipo,
      descricao: rec.descricao,
      valor: rec.valor,
      vencimento: dataSemHora(vencimento),
      categoria_id: rec.categoria_id,
      paciente_id: rec.paciente_id,
      profissional_id: rec.profissional_id,
      fornecedor: rec.fornecedor,
      forma_pagamento: rec.forma_pagamento,
      recorrencia_id: rec.id,
      competencia: dataSemHora(competencia),
      criado_por: criadoPor,
    });
  }
  if (novos.length === 0) return 0;

  const { count } = await db.titulo.createMany({ data: novos, skipDuplicates: true });
  const maior = novos[novos.length - 1]!.competencia as Date;
  if (!rec.ultima_competencia || rec.ultima_competencia < maior) {
    await db.recorrencia.update({ where: { id: rec.id }, data: { ultima_competencia: maior } });
  }
  return count;
}

// ----------------------------------------------------------------------------- repasses

export type LinhaRepasse = {
  profissional: { id: string; nome: string; ativo: boolean };
  percentual: string | null;
  total_entradas: string;
  quantidade_entradas: number;
  valor_repasse: string;
  pago: string;
  saldo: string;
};

/**
 * Repasse por profissional no período: total_entradas = Σ entradas efetivas com profissional_id;
 * valor_repasse = total × % / 100 (arredondado a centavos); pago = Σ saídas efetivas origem `repasse`
 * com período de referência contido no filtro; saldo = valor_repasse − pago.
 */
export async function calcularRepasses(
  db: DbTenant,
  periodo: { inicio: string; fim: string },
  profissionalId?: string,
): Promise<LinhaRepasse[]> {
  const inicio = dataSemHora(periodo.inicio);
  const fim = dataSemHora(periodo.fim);

  const [profissionais, entradas, pagos] = await Promise.all([
    db.profissional.findMany({
      where: profissionalId ? { id: profissionalId } : {},
      select: { id: true, nome: true, ativo: true, percentual_repasse: true },
      orderBy: { nome: 'asc' },
    }),
    db.movimentacaoFinanceira.groupBy({
      by: ['profissional_id'],
      where: {
        AND: [
          WHERE_MOVIMENTACAO_EFETIVA,
          {
            tipo: 'entrada',
            data: { gte: inicio, lte: fim },
            profissional_id: profissionalId ? profissionalId : { not: null },
          },
        ],
      },
      _sum: { valor: true },
      _count: { _all: true },
    }),
    db.movimentacaoFinanceira.groupBy({
      by: ['profissional_id'],
      where: {
        AND: [
          WHERE_MOVIMENTACAO_EFETIVA,
          {
            tipo: 'saida',
            origem: 'repasse',
            repasse_inicio: { gte: inicio },
            repasse_fim: { lte: fim },
            profissional_id: profissionalId ? profissionalId : { not: null },
          },
        ],
      },
      _sum: { valor: true },
    }),
  ]);

  const linhas: LinhaRepasse[] = [];
  for (const p of profissionais) {
    const e = entradas.find((x) => x.profissional_id === p.id);
    const pg = pagos.find((x) => x.profissional_id === p.id);
    const total = dec(e?._sum.valor);
    const pago = dec(pg?._sum.valor);
    // Inativo sem movimento no período não aparece (a menos que filtrado explicitamente).
    if (!profissionalId && !p.ativo && total.isZero() && pago.isZero()) continue;
    const pct = p.percentual_repasse;
    const repasse = pct ? total.mul(pct).div(100).toDecimalPlaces(2) : ZERO;
    linhas.push({
      profissional: { id: p.id, nome: p.nome, ativo: p.ativo },
      percentual: pct ? moeda(pct) : null,
      total_entradas: moeda(total),
      quantidade_entradas: e?._count._all ?? 0,
      valor_repasse: moeda(repasse),
      pago: moeda(pago),
      saldo: moeda(repasse.sub(pago)),
    });
  }
  return linhas;
}

/** Entradas efetivas vinculadas ao profissional no período (detalhe do repasse). */
export async function entradasDoProfissional(
  db: DbTenant,
  profissionalId: string,
  periodo: { inicio: string; fim: string },
) {
  const itens = await db.movimentacaoFinanceira.findMany({
    where: {
      AND: [
        WHERE_MOVIMENTACAO_EFETIVA,
        {
          tipo: 'entrada',
          profissional_id: profissionalId,
          data: { gte: dataSemHora(periodo.inicio), lte: dataSemHora(periodo.fim) },
        },
      ],
    },
    select: {
      id: true,
      data: true,
      valor: true,
      forma_pagamento: true,
      descricao: true,
      origem: true,
      agendamento_id: true,
      paciente: { select: { id: true, nome: true } },
      categoria: { select: { id: true, nome: true } },
    },
    orderBy: [{ data: 'desc' }, { criado_em: 'desc' }],
    take: 1000,
  });
  return itens.map((m) => ({ ...m, data: paraDataIso(m.data), valor: moeda(m.valor) }));
}
