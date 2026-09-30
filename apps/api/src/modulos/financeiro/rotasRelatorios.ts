/**
 * Relatórios financeiros (admin). Receitas/despesas usam valores EFETIVOS (WHERE_MOVIMENTACAO_EFETIVA:
 * nem estornos, nem estornadas). Fluxo de caixa: saldo inicial = saldo_inicial das contas + Σ efetivas
 * anteriores ao período; por dia ou por mês. Exportação CSV (separador ';', decimal ',', UTF-8 com BOM).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { exigirPapel } from '../../plugins/auth';
import type { DbTenant } from '../../plugins/tenant';
import { ou404 } from '../../utils/erros';
import { WHERE_MOVIMENTACAO_EFETIVA } from '../../servicos/financeiroComum';
import {
  ZERO,
  dataSemHora,
  dec,
  fusoDaClinica,
  hojeNoFuso,
  moeda,
  paraDataIso,
  resolverPeriodo,
  somarDias,
  zId,
  zPeriodo,
} from './comum';
import { calcularRepasses } from './servico';

const ROTULO_FORMA: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  convenio: 'Convênio',
  outro: 'Outro',
};
const ROTULO_ORIGEM: Record<string, string> = {
  manual: 'Lançamento',
  consulta: 'Consulta',
  titulo: 'Conta paga/recebida',
  repasse: 'Repasse',
  estorno: 'Estorno',
};

function efetivasNoPeriodo(p: { inicio: string; fim: string }, extra: Prisma.MovimentacaoFinanceiraWhereInput = {}) {
  return { AND: [WHERE_MOVIMENTACAO_EFETIVA, { data: { gte: dataSemHora(p.inicio), lte: dataSemHora(p.fim) }, ...extra }] };
}

async function montarResumo(db: DbTenant, periodo: { inicio: string; fim: string }, hoje: string) {
  const where = efetivasNoPeriodo(periodo);
  const hojeData = dataSemHora(hoje);
  const [porTipo, porCategoria, porForma, porProfissional, porDia, aReceber, aPagar, vencidos] = await Promise.all([
    db.movimentacaoFinanceira.groupBy({ by: ['tipo'], where, _sum: { valor: true } }),
    db.movimentacaoFinanceira.groupBy({ by: ['categoria_id', 'tipo'], where, _sum: { valor: true }, _count: { _all: true } }),
    db.movimentacaoFinanceira.groupBy({ by: ['forma_pagamento', 'tipo'], where, _sum: { valor: true } }),
    db.movimentacaoFinanceira.groupBy({
      by: ['profissional_id'],
      where: efetivasNoPeriodo(periodo, { tipo: 'entrada', profissional_id: { not: null } }),
      _sum: { valor: true },
      _count: { _all: true },
    }),
    db.movimentacaoFinanceira.groupBy({ by: ['data', 'tipo'], where, _sum: { valor: true }, orderBy: { data: 'asc' } }),
    db.titulo.aggregate({ where: { tipo: 'receber', status: 'aberto' }, _sum: { valor: true }, _count: { _all: true } }),
    db.titulo.aggregate({ where: { tipo: 'pagar', status: 'aberto' }, _sum: { valor: true }, _count: { _all: true } }),
    db.titulo.groupBy({
      by: ['tipo'],
      where: { status: 'aberto', vencimento: { lt: hojeData } },
      _sum: { valor: true },
      _count: { _all: true },
    }),
  ]);

  const idsCat = porCategoria.map((c) => c.categoria_id).filter((x): x is string => !!x);
  const idsProf = porProfissional.map((p) => p.profissional_id).filter((x): x is string => !!x);
  const [categorias, profissionais] = await Promise.all([
    idsCat.length ? db.categoriaFinanceira.findMany({ where: { id: { in: idsCat } }, select: { id: true, nome: true } }) : [],
    idsProf.length
      ? db.profissional.findMany({ where: { id: { in: idsProf } }, select: { id: true, nome: true, percentual_repasse: true } })
      : [],
  ]);

  const receitas = dec(porTipo.find((t) => t.tipo === 'entrada')?._sum.valor);
  const despesas = dec(porTipo.find((t) => t.tipo === 'saida')?._sum.valor);

  const formas = new Map<string, { entradas: Prisma.Decimal; saidas: Prisma.Decimal }>();
  for (const f of porForma) {
    const atual = formas.get(f.forma_pagamento) ?? { entradas: ZERO, saidas: ZERO };
    if (f.tipo === 'entrada') atual.entradas = atual.entradas.add(dec(f._sum.valor));
    else atual.saidas = atual.saidas.add(dec(f._sum.valor));
    formas.set(f.forma_pagamento, atual);
  }

  const dias = new Map<string, { entradas: Prisma.Decimal; saidas: Prisma.Decimal }>();
  for (const d of porDia) {
    const k = paraDataIso(d.data);
    const atual = dias.get(k) ?? { entradas: ZERO, saidas: ZERO };
    if (d.tipo === 'entrada') atual.entradas = atual.entradas.add(dec(d._sum.valor));
    else atual.saidas = atual.saidas.add(dec(d._sum.valor));
    dias.set(k, atual);
  }

  const vencReceber = vencidos.find((v) => v.tipo === 'receber');
  const vencPagar = vencidos.find((v) => v.tipo === 'pagar');

  return {
    periodo,
    receitas: moeda(receitas),
    despesas: moeda(despesas),
    saldo: moeda(receitas.sub(despesas)),
    por_categoria: porCategoria
      .map((c) => ({
        categoria_id: c.categoria_id,
        categoria: categorias.find((x) => x.id === c.categoria_id)?.nome ?? 'Sem categoria',
        tipo: c.tipo === 'entrada' ? ('receita' as const) : ('despesa' as const),
        total: moeda(c._sum.valor),
        quantidade: c._count._all,
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    por_forma_pagamento: [...formas.entries()]
      .map(([forma, v]) => ({ forma_pagamento: forma, entradas: moeda(v.entradas), saidas: moeda(v.saidas) }))
      .sort((a, b) => Number(b.entradas) + Number(b.saidas) - Number(a.entradas) - Number(a.saidas)),
    por_profissional: porProfissional
      .map((p) => {
        const prof = profissionais.find((x) => x.id === p.profissional_id);
        return {
          profissional: { id: p.profissional_id!, nome: prof?.nome ?? '—' },
          entradas: moeda(p._sum.valor),
          quantidade: p._count._all,
        };
      })
      .sort((a, b) => Number(b.entradas) - Number(a.entradas)),
    por_dia: [...dias.entries()].map(([data, v]) => ({ data, entradas: moeda(v.entradas), saidas: moeda(v.saidas) })),
    a_receber_aberto: moeda(aReceber._sum.valor),
    a_pagar_aberto: moeda(aPagar._sum.valor),
    vencidos: (vencReceber?._count._all ?? 0) + (vencPagar?._count._all ?? 0),
    vencidos_detalhe: {
      receber: { quantidade: vencReceber?._count._all ?? 0, valor: moeda(vencReceber?._sum.valor) },
      pagar: { quantidade: vencPagar?._count._all ?? 0, valor: moeda(vencPagar?._sum.valor) },
    },
  };
}

async function montarFluxo(
  db: DbTenant,
  periodo: { inicio: string; fim: string },
  agrupamento: 'dia' | 'mes',
  contaId?: string,
) {
  const filtroConta = contaId ? { conta_financeira_id: contaId } : {};
  const [contas, anteriores, noPeriodo] = await Promise.all([
    db.contaFinanceira.aggregate({ where: contaId ? { id: contaId } : {}, _sum: { saldo_inicial: true } }),
    db.movimentacaoFinanceira.groupBy({
      by: ['tipo'],
      where: { AND: [WHERE_MOVIMENTACAO_EFETIVA, { data: { lt: dataSemHora(periodo.inicio) }, ...filtroConta }] },
      _sum: { valor: true },
    }),
    db.movimentacaoFinanceira.groupBy({
      by: ['data', 'tipo'],
      where: efetivasNoPeriodo(periodo, filtroConta),
      _sum: { valor: true },
      orderBy: { data: 'asc' },
    }),
  ]);
  const saldoInicial = dec(contas._sum.saldo_inicial)
    .add(dec(anteriores.find((a) => a.tipo === 'entrada')?._sum.valor))
    .sub(dec(anteriores.find((a) => a.tipo === 'saida')?._sum.valor));

  const chave = (iso: string) => (agrupamento === 'mes' ? iso.slice(0, 7) : iso);
  const buckets = new Map<string, { entradas: Prisma.Decimal; saidas: Prisma.Decimal }>();
  // Todos os dias/meses do período (inclusive os vazios) para o gráfico ficar contínuo.
  for (let d = periodo.inicio; d <= periodo.fim; d = somarDias(d, 1)) {
    if (!buckets.has(chave(d))) buckets.set(chave(d), { entradas: ZERO, saidas: ZERO });
  }
  for (const g of noPeriodo) {
    const b = buckets.get(chave(paraDataIso(g.data)))!;
    if (g.tipo === 'entrada') b.entradas = b.entradas.add(dec(g._sum.valor));
    else b.saidas = b.saidas.add(dec(g._sum.valor));
  }
  let saldo = saldoInicial;
  let totalEntradas = ZERO;
  let totalSaidas = ZERO;
  const linhas = [...buckets.entries()].map(([data, v]) => {
    saldo = saldo.add(v.entradas).sub(v.saidas);
    totalEntradas = totalEntradas.add(v.entradas);
    totalSaidas = totalSaidas.add(v.saidas);
    return { data, entradas: moeda(v.entradas), saidas: moeda(v.saidas), saldo: moeda(saldo) };
  });
  return {
    periodo,
    agrupamento,
    saldo_inicial: moeda(saldoInicial),
    saldo_final: moeda(saldo),
    total_entradas: moeda(totalEntradas),
    total_saidas: moeda(totalSaidas),
    dias: linhas,
  };
}

// ----------------------------------------------------------------------------- CSV

/** Valor numérico já formatado (pt-BR) — sai como número, sem o escape de fórmula aplicado aos textos. */
class NumeroCsv {
  constructor(readonly valor: string) {}
}

/**
 * Célula CSV. TEXTO que começa com = + - @ TAB ou CR recebe o prefixo ' (evita injeção de fórmula ao abrir no
 * Excel/LibreOffice — "CSV injection": nome de paciente, descrição, categoria… são digitados por usuários).
 * Números (`number` ou `NumeroCsv`) saem como estão (ex.: "-150,00" continua número).
 */
function celula(v: unknown): string {
  if (v instanceof NumeroCsv) return v.valor;
  if (typeof v === 'number') return String(v);
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function numeroBr(v: string) {
  return new NumeroCsv(v.replace('.', ','));
}
function dataBr(iso: string) {
  return iso.length === 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
function csv(cabecalho: string[], linhas: unknown[][]): string {
  return '﻿' + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';
}

const TIPOS_EXPORTACAO = ['movimentacoes', 'categorias', 'formas', 'profissionais', 'fluxo', 'repasses'] as const;

const rotas: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/relatorios/resumo',
    { preHandler: exigirPapel('admin'), schema: { querystring: z.object({ ...zPeriodo }) } },
    async (request) => {
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const periodo = resolverPeriodo(request.query, fuso);
      return montarResumo(request.db, periodo, hojeNoFuso(fuso));
    },
  );

  app.get(
    '/relatorios/fluxo-caixa',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        querystring: z.object({
          ...zPeriodo,
          conta_id: zId('Conta').optional(),
          agrupamento: z.enum(['dia', 'mes']).default('dia'),
        }),
      },
    },
    async (request) => {
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const periodo = resolverPeriodo(request.query, fuso);
      if (request.query.conta_id) {
        ou404(
          await request.db.contaFinanceira.findUnique({ where: { id: request.query.conta_id }, select: { id: true } }),
          'Conta financeira não encontrada.',
        );
      }
      return montarFluxo(request.db, periodo, request.query.agrupamento, request.query.conta_id);
    },
  );

  app.get(
    '/relatorios/exportar',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        querystring: z.object({
          ...zPeriodo,
          tipo: z.enum(TIPOS_EXPORTACAO, { error: 'Tipo de exportação inválido.' }),
          agrupamento: z.enum(['dia', 'mes']).default('dia'),
        }),
      },
    },
    async (request, reply) => {
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      const periodo = resolverPeriodo(request.query, fuso);
      const { tipo } = request.query;
      let conteudo: string;

      if (tipo === 'movimentacoes') {
        const itens = await db.movimentacaoFinanceira.findMany({
          where: { data: { gte: dataSemHora(periodo.inicio), lte: dataSemHora(periodo.fim) } },
          include: {
            conta: { select: { nome: true } },
            categoria: { select: { nome: true } },
            paciente: { select: { nome: true } },
            profissional: { select: { nome: true } },
            estornada_por: { select: { id: true } },
          },
          orderBy: [{ data: 'asc' }, { criado_em: 'asc' }],
          take: 50_000,
        });
        conteudo = csv(
          ['Data', 'Tipo', 'Origem', 'Valor', 'Conta', 'Categoria', 'Forma de pagamento', 'Descrição', 'Paciente', 'Profissional', 'Situação'],
          itens.map((m) => [
            dataBr(paraDataIso(m.data)),
            m.tipo === 'entrada' ? 'Entrada' : 'Saída',
            ROTULO_ORIGEM[m.origem],
            numeroBr((m.tipo === 'saida' ? '-' : '') + moeda(m.valor)),
            m.conta.nome,
            m.categoria?.nome ?? '',
            ROTULO_FORMA[m.forma_pagamento],
            m.descricao ?? '',
            m.paciente?.nome ?? '',
            m.profissional?.nome ?? '',
            m.origem === 'estorno' ? 'Estorno' : m.estornada_por ? 'Estornada' : 'Efetiva',
          ]),
        );
      } else if (tipo === 'fluxo') {
        const f = await montarFluxo(db, periodo, request.query.agrupamento);
        conteudo = csv(
          [request.query.agrupamento === 'mes' ? 'Mês' : 'Data', 'Entradas', 'Saídas', 'Saldo acumulado'],
          [
            ['Saldo inicial', '', '', numeroBr(f.saldo_inicial)],
            ...f.dias.map((d) => [dataBr(d.data), numeroBr(d.entradas), numeroBr(d.saidas), numeroBr(d.saldo)]),
          ],
        );
      } else if (tipo === 'repasses') {
        const linhas = await calcularRepasses(db, periodo);
        conteudo = csv(
          ['Profissional', 'Percentual', 'Total recebido', 'Valor do repasse', 'Pago', 'Saldo a pagar'],
          linhas.map((l) => [
            l.profissional.nome,
            l.percentual ? numeroBr(l.percentual) : '',
            numeroBr(l.total_entradas),
            numeroBr(l.valor_repasse),
            numeroBr(l.pago),
            numeroBr(l.saldo),
          ]),
        );
      } else {
        const r = await montarResumo(db, periodo, hojeNoFuso(fuso));
        if (tipo === 'categorias') {
          conteudo = csv(
            ['Categoria', 'Tipo', 'Quantidade', 'Total'],
            r.por_categoria.map((c) => [c.categoria, c.tipo === 'receita' ? 'Receita' : 'Despesa', c.quantidade, numeroBr(c.total)]),
          );
        } else if (tipo === 'formas') {
          conteudo = csv(
            ['Forma de pagamento', 'Entradas', 'Saídas'],
            r.por_forma_pagamento.map((f) => [ROTULO_FORMA[f.forma_pagamento] ?? f.forma_pagamento, numeroBr(f.entradas), numeroBr(f.saidas)]),
          );
        } else {
          conteudo = csv(
            ['Profissional', 'Quantidade', 'Entradas'],
            r.por_profissional.map((p) => [p.profissional.nome, p.quantidade, numeroBr(p.entradas)]),
          );
        }
      }

      const nome = `financeiro-${tipo}-${periodo.inicio}_${periodo.fim}.csv`;
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${nome}"`)
        .send(conteudo);
    },
  );
};

export default rotas;
