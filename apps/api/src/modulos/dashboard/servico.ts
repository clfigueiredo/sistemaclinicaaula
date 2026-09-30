/**
 * Cálculos do dashboard da clínica (somente leitura). Contrato: docs/FASE2.md §6.
 *
 * SQL cru (`$queryRaw`) NÃO é filtrado pelo tenant: toda consulta daqui filtra `clinica_id` explicitamente.
 * Timestamps (`timestamp(3)` sem fuso, gravados em UTC) são passados como texto 'YYYY-MM-DD HH:mm:ss.SSS'
 * com cast `::timestamp` (independe do TimeZone da sessão). Datas locais: `(col AT TIME ZONE 'UTC') AT TIME ZONE fuso`.
 */
import { Prisma } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import type { DbTenant } from '../../plugins/tenant';
import { dataSemHora, paraDataIso, paraNumero, WHERE_MOVIMENTACAO_EFETIVA } from '../../servicos/financeiroComum';

const DIA_MS = 86_400_000;

// ----------------------------------------------------------------------------- datas

export function somarDias(iso: string, dias: number): string {
  return paraDataIso(new Date(dataSemHora(iso).getTime() + dias * DIA_MS));
}

export function diasEntre(inicio: string, fim: string): number {
  return Math.round((dataSemHora(fim).getTime() - dataSemHora(inicio).getTime()) / DIA_MS);
}

/** Início (inclusivo) e fim (exclusivo) em UTC de um intervalo de dias locais [inicio, fim]. */
export function intervaloUtc(inicio: string, fim: string, fuso: string) {
  return {
    de: fromZonedTime(`${inicio}T00:00:00`, fuso),
    ate: fromZonedTime(`${somarDias(fim, 1)}T00:00:00`, fuso),
  };
}

/** Date → literal de `timestamp` sem fuso (UTC). */
function ts(d: Date) {
  return Prisma.sql`${d.toISOString().slice(0, 23).replace('T', ' ')}::timestamp`;
}

function filtroProfissional(profissionalId: string | null, coluna = Prisma.raw('a.profissional_id')) {
  return profissionalId ? Prisma.sql`AND ${coluna} = ${profissionalId}::uuid` : Prisma.empty;
}

const taxa = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 10_000) / 10_000 : null);
const dinheiro = (v: Prisma.Decimal | number | string | null | undefined) => paraNumero(v).toFixed(2);

// ----------------------------------------------------------------------------- agenda

export type Escopo = { clinicaId: string; fuso: string; profissionalId: string | null };

type LinhaResumo = {
  total: number;
  agendados: number;
  confirmados: number;
  compareceram: number;
  atendidos: number;
  faltas: number;
  cancelados: number;
  passados_validos: number;
  passados_presentes: number;
  passados_faltas: number;
};

/** Contagens por status + base das taxas (agendamentos não cancelados com início já alcançado). */
export async function resumoAgenda(db: DbTenant, e: Escopo, de: Date, ate: Date, agora: Date) {
  const [l] = await db.$queryRaw<LinhaResumo[]>`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE a.status = 'agendado')::int AS agendados,
      count(*) FILTER (WHERE a.status = 'confirmado')::int AS confirmados,
      count(*) FILTER (WHERE a.status = 'compareceu')::int AS compareceram,
      count(*) FILTER (WHERE a.status = 'atendido')::int AS atendidos,
      count(*) FILTER (WHERE a.status = 'faltou')::int AS faltas,
      count(*) FILTER (WHERE a.status = 'cancelado')::int AS cancelados,
      count(*) FILTER (WHERE a.status <> 'cancelado' AND a.inicio <= ${ts(agora)})::int AS passados_validos,
      count(*) FILTER (WHERE a.status IN ('compareceu', 'atendido') AND a.inicio <= ${ts(agora)})::int AS passados_presentes,
      count(*) FILTER (WHERE a.status = 'faltou' AND a.inicio <= ${ts(agora)})::int AS passados_faltas
    FROM agendamentos a
    WHERE a.clinica_id = ${e.clinicaId}::uuid
      AND a.inicio >= ${ts(de)} AND a.inicio < ${ts(ate)}
      ${filtroProfissional(e.profissionalId)}`;
  const r = l!;
  const naoCancelados = r.total - r.cancelados;
  return {
    total: r.total,
    agendados: r.agendados,
    confirmados: r.confirmados,
    compareceram: r.compareceram,
    atendidos: r.atendidos,
    faltas: r.faltas,
    cancelados: r.cancelados,
    /** Base das taxas de comparecimento/faltas: não cancelados com início já alcançado. */
    realizados_base: r.passados_validos,
    /** (compareceu + atendido) / não cancelados já passados. null = sem base. */
    taxa_comparecimento: taxa(r.passados_presentes, r.passados_validos),
    /** faltou / não cancelados já passados. */
    taxa_faltas: taxa(r.passados_faltas, r.passados_validos),
    /** (confirmado + compareceu + atendido) / não cancelados. */
    taxa_confirmacao: taxa(r.confirmados + r.compareceram + r.atendidos, naoCancelados),
    /** cancelado / total. */
    taxa_cancelamento: taxa(r.cancelados, r.total),
  };
}

type LinhaDia = { data: string; total: number; atendidos: number; faltas: number; cancelados: number };

/** Série diária (todos os dias do período, com zeros). */
export async function serieDiaria(db: DbTenant, e: Escopo, inicio: string, fim: string, de: Date, ate: Date) {
  const linhas = await db.$queryRaw<LinhaDia[]>`
    SELECT to_char(((a.inicio AT TIME ZONE 'UTC') AT TIME ZONE ${e.fuso})::date, 'YYYY-MM-DD') AS data,
      count(*)::int AS total,
      count(*) FILTER (WHERE a.status IN ('compareceu', 'atendido'))::int AS atendidos,
      count(*) FILTER (WHERE a.status = 'faltou')::int AS faltas,
      count(*) FILTER (WHERE a.status = 'cancelado')::int AS cancelados
    FROM agendamentos a
    WHERE a.clinica_id = ${e.clinicaId}::uuid
      AND a.inicio >= ${ts(de)} AND a.inicio < ${ts(ate)}
      ${filtroProfissional(e.profissionalId)}
    GROUP BY 1`;
  const porData = new Map(linhas.map((l) => [l.data, l]));
  const dias = diasEntre(inicio, fim);
  return Array.from({ length: dias + 1 }, (_, i) => {
    const data = somarDias(inicio, i);
    const l = porData.get(data);
    return { data, total: l?.total ?? 0, atendidos: l?.atendidos ?? 0, faltas: l?.faltas ?? 0, cancelados: l?.cancelados ?? 0 };
  });
}

/** Distribuição (não cancelados) por dia da semana (0 = domingo) e por hora local. */
export async function distribuicaoHorarios(db: DbTenant, e: Escopo, de: Date, ate: Date) {
  const linhas = await db.$queryRaw<{ dia_semana: number; hora: number; total: number }[]>`
    SELECT extract(dow FROM (a.inicio AT TIME ZONE 'UTC') AT TIME ZONE ${e.fuso})::int AS dia_semana,
      extract(hour FROM (a.inicio AT TIME ZONE 'UTC') AT TIME ZONE ${e.fuso})::int AS hora,
      count(*)::int AS total
    FROM agendamentos a
    WHERE a.clinica_id = ${e.clinicaId}::uuid
      AND a.inicio >= ${ts(de)} AND a.inicio < ${ts(ate)}
      AND a.status <> 'cancelado'
      ${filtroProfissional(e.profissionalId)}
    GROUP BY 1, 2`;
  const porDiaSemana = Array.from({ length: 7 }, (_, dia) => ({
    dia_semana: dia,
    total: linhas.filter((l) => l.dia_semana === dia).reduce((s, l) => s + l.total, 0),
  }));
  const horas = new Map<number, number>();
  for (const l of linhas) horas.set(l.hora, (horas.get(l.hora) ?? 0) + l.total);
  const porHora = [...horas.entries()].sort((a, b) => a[0] - b[0]).map(([hora, total]) => ({ hora, total }));
  return { porDiaSemana, porHora };
}

type LinhaProf = {
  id: string;
  nome: string;
  cor_agenda: string;
  ativo: boolean;
  total: number;
  confirmados: number;
  atendidos: number;
  faltas: number;
  cancelados: number;
};

/** Ocupação por profissional (só quem tem agendamento no período). */
export async function porProfissional(db: DbTenant, e: Escopo, de: Date, ate: Date) {
  const linhas = await db.$queryRaw<LinhaProf[]>`
    SELECT p.id, p.nome, p.cor_agenda, p.ativo,
      count(*)::int AS total,
      count(*) FILTER (WHERE a.status = 'confirmado')::int AS confirmados,
      count(*) FILTER (WHERE a.status IN ('compareceu', 'atendido'))::int AS atendidos,
      count(*) FILTER (WHERE a.status = 'faltou')::int AS faltas,
      count(*) FILTER (WHERE a.status = 'cancelado')::int AS cancelados
    FROM agendamentos a
    JOIN profissionais p ON p.id = a.profissional_id AND p.clinica_id = a.clinica_id
    WHERE a.clinica_id = ${e.clinicaId}::uuid
      AND a.inicio >= ${ts(de)} AND a.inicio < ${ts(ate)}
      ${filtroProfissional(e.profissionalId)}
    GROUP BY p.id
    ORDER BY count(*) DESC, p.nome`;
  return linhas.map((l) => ({
    profissional: { id: l.id, nome: l.nome, cor_agenda: l.cor_agenda, ativo: l.ativo },
    total: l.total,
    confirmados: l.confirmados,
    atendidos: l.atendidos,
    faltas: l.faltas,
    cancelados: l.cancelados,
    taxa_comparecimento: taxa(l.atendidos, l.atendidos + l.faltas),
  }));
}

/**
 * Novos pacientes no período. Clínica inteira: pacientes cadastrados no período.
 * Com profissional: pacientes cujo PRIMEIRO agendamento (não cancelado) com ele caiu no período.
 */
export async function novosPacientes(db: DbTenant, e: Escopo, de: Date, ate: Date) {
  if (!e.profissionalId) {
    return db.paciente.count({ where: { criado_em: { gte: de, lt: ate } } });
  }
  const [l] = await db.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total FROM (
      SELECT a.paciente_id, min(a.inicio) AS primeiro
      FROM agendamentos a
      WHERE a.clinica_id = ${e.clinicaId}::uuid AND a.status <> 'cancelado'
        ${filtroProfissional(e.profissionalId)}
      GROUP BY a.paciente_id
    ) t
    WHERE t.primeiro >= ${ts(de)} AND t.primeiro < ${ts(ate)}`;
  return l?.total ?? 0;
}

/** Agendamentos de hoje (fuso da clínica), inclusive cancelados (o front decide como exibir). */
export async function agendaDeHoje(db: DbTenant, e: Escopo, hoje: string) {
  const { de, ate } = intervaloUtc(hoje, hoje, e.fuso);
  const itens = await db.agendamento.findMany({
    where: { inicio: { gte: de, lt: ate }, ...(e.profissionalId ? { profissional_id: e.profissionalId } : {}) },
    orderBy: { inicio: 'asc' },
    take: 100,
    select: {
      id: true,
      inicio: true,
      fim: true,
      status: true,
      tipo: true,
      paciente: { select: { id: true, nome: true } },
      profissional: { select: { id: true, nome: true, cor_agenda: true } },
    },
  });
  return itens;
}

// ----------------------------------------------------------------------------- financeiro

/** Receitas e despesas efetivas (sem estornos nem estornadas) entre dois dias (inclusivo). */
export async function totaisFinanceiros(db: DbTenant, inicio: string, fim: string) {
  const grupos = await db.movimentacaoFinanceira.groupBy({
    by: ['tipo'],
    where: { ...WHERE_MOVIMENTACAO_EFETIVA, data: { gte: dataSemHora(inicio), lte: dataSemHora(fim) } },
    _sum: { valor: true },
  });
  const receitas = paraNumero(grupos.find((g) => g.tipo === 'entrada')?._sum.valor);
  const despesas = paraNumero(grupos.find((g) => g.tipo === 'saida')?._sum.valor);
  return { receitas, despesas, saldo: Math.round((receitas - despesas) * 100) / 100 };
}

export async function blocoFinanceiro(
  db: DbTenant,
  clinicaId: string,
  inicio: string,
  fim: string,
  anterior: { inicio: string; fim: string },
  hoje: string,
) {
  const periodoData = { gte: dataSemHora(inicio), lte: dataSemHora(fim) };
  const hojeD = dataSemHora(hoje);
  const em7 = dataSemHora(somarDias(hoje, 7));
  const somaTitulos = (where: Prisma.TituloWhereInput) =>
    db.titulo.aggregate({ where: { status: 'aberto', ...where }, _sum: { valor: true }, _count: { _all: true } });

  const [
    atual,
    ant,
    porCategoria,
    porProf,
    ticket,
    receberAberto,
    receberVencido,
    receberProximos,
    pagarAberto,
    pagarVencido,
    pagarProximos,
  ] = await Promise.all([
    totaisFinanceiros(db, inicio, fim),
    totaisFinanceiros(db, anterior.inicio, anterior.fim),
    db.movimentacaoFinanceira.groupBy({
      by: ['categoria_id', 'tipo'],
      where: { ...WHERE_MOVIMENTACAO_EFETIVA, data: periodoData },
      _sum: { valor: true },
    }),
    db.movimentacaoFinanceira.groupBy({
      by: ['profissional_id'],
      where: { ...WHERE_MOVIMENTACAO_EFETIVA, tipo: 'entrada', profissional_id: { not: null }, data: periodoData },
      _sum: { valor: true },
      _count: { _all: true },
    }),
    // Ticket médio: entradas efetivas vinculadas a agendamento ÷ agendamentos distintos recebidos.
    db.$queryRaw<{ total: Prisma.Decimal | null; atendimentos: number }[]>`
      SELECT sum(m.valor) AS total, count(DISTINCT m.agendamento_id)::int AS atendimentos
      FROM movimentacoes_financeiras m
      WHERE m.clinica_id = ${clinicaId}::uuid
        AND m.tipo = 'entrada' AND m.agendamento_id IS NOT NULL
        AND m.origem <> 'estorno'
        AND NOT EXISTS (SELECT 1 FROM movimentacoes_financeiras e
                        WHERE e.estorno_de_id = m.id AND e.clinica_id = m.clinica_id)
        AND m.data >= ${inicio}::date AND m.data <= ${fim}::date`,
    somaTitulos({ tipo: 'receber' }),
    somaTitulos({ tipo: 'receber', vencimento: { lt: hojeD } }),
    somaTitulos({ tipo: 'receber', vencimento: { gte: hojeD, lte: em7 } }),
    somaTitulos({ tipo: 'pagar' }),
    somaTitulos({ tipo: 'pagar', vencimento: { lt: hojeD } }),
    somaTitulos({ tipo: 'pagar', vencimento: { gte: hojeD, lte: em7 } }),
  ]);

  const idsCategorias = porCategoria.map((g) => g.categoria_id).filter((id): id is string => !!id);
  const idsProf = porProf.map((g) => g.profissional_id).filter((id): id is string => !!id);
  const [categorias, profissionais] = await Promise.all([
    idsCategorias.length
      ? db.categoriaFinanceira.findMany({ where: { id: { in: idsCategorias } }, select: { id: true, nome: true } })
      : [],
    idsProf.length
      ? db.profissional.findMany({ where: { id: { in: idsProf } }, select: { id: true, nome: true, cor_agenda: true } })
      : [],
  ]);
  const nomeCategoria = new Map(categorias.map((c) => [c.id, c.nome]));
  const profPorId = new Map(profissionais.map((p) => [p.id, p]));

  const t = ticket[0];
  const atendimentosPagos = t?.atendimentos ?? 0;
  const resumoTitulo = (a: Awaited<ReturnType<typeof somaTitulos>>) => ({
    valor: dinheiro(a._sum.valor),
    quantidade: a._count._all,
  });

  return {
    receitas: atual.receitas.toFixed(2),
    despesas: atual.despesas.toFixed(2),
    saldo: atual.saldo.toFixed(2),
    anterior: {
      receitas: ant.receitas.toFixed(2),
      despesas: ant.despesas.toFixed(2),
      saldo: ant.saldo.toFixed(2),
    },
    /** Títulos a receber/pagar em aberto (qualquer vencimento). */
    a_receber: dinheiro(receberAberto._sum.valor),
    a_pagar: dinheiro(pagarAberto._sum.valor),
    /** Quantidade de títulos vencidos (receber + pagar). */
    vencidos: receberVencido._count._all + pagarVencido._count._all,
    receber_vencido: resumoTitulo(receberVencido),
    receber_proximos_7_dias: resumoTitulo(receberProximos),
    pagar_vencido: resumoTitulo(pagarVencido),
    pagar_proximos_7_dias: resumoTitulo(pagarProximos),
    ticket_medio: atendimentosPagos > 0 ? (paraNumero(t?.total) / atendimentosPagos).toFixed(2) : null,
    atendimentos_recebidos: atendimentosPagos,
    por_categoria: porCategoria
      .map((g) => ({
        categoria: g.categoria_id ? (nomeCategoria.get(g.categoria_id) ?? 'Sem categoria') : 'Sem categoria',
        tipo: g.tipo === 'entrada' ? ('receita' as const) : ('despesa' as const),
        total: dinheiro(g._sum.valor),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    receita_por_profissional: porProf
      .map((g) => {
        const p = profPorId.get(g.profissional_id!);
        return {
          profissional: { id: g.profissional_id!, nome: p?.nome ?? '—', cor_agenda: p?.cor_agenda ?? null },
          total: dinheiro(g._sum.valor),
          lancamentos: g._count._all,
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total)),
  };
}

// ----------------------------------------------------------------------------- pendências

export async function pendencias(
  db: DbTenant,
  habilitados: { agendamento_online: boolean; lista_espera: boolean; retorno_automatico: boolean },
  opcoes: { profissionalId: string | null; ehProfissional: boolean; hoje: string },
) {
  const { profissionalId, ehProfissional } = opcoes;
  const filtroProf = profissionalId ? { profissional_id: profissionalId } : {};
  const [solicitacoes, espera, retornosPendentes, retornosVencidos] = await Promise.all([
    // Solicitações e lista de espera são telas de admin/recepção: o profissional não recebe esses números.
    habilitados.agendamento_online && !ehProfissional
      ? db.solicitacaoAgendamento.count({ where: { status: 'pendente', ...filtroProf } })
      : null,
    habilitados.lista_espera && !ehProfissional
      ? db.listaEspera.count({
          where: {
            status: 'aguardando',
            ...(profissionalId ? { OR: [{ profissional_id: profissionalId }, { profissional_id: null }] } : {}),
          },
        })
      : null,
    habilitados.retorno_automatico
      ? db.retorno.count({ where: { status: { in: ['pendente', 'lembrado'] }, ...filtroProf } })
      : null,
    habilitados.retorno_automatico
      ? db.retorno.count({
          where: { status: { in: ['pendente', 'lembrado'] }, data_prevista: { lt: dataSemHora(opcoes.hoje) }, ...filtroProf },
        })
      : null,
  ]);
  return {
    solicitacoes_pendentes: solicitacoes,
    lista_espera: espera,
    retornos_pendentes: retornosPendentes,
    retornos_vencidos: retornosVencidos,
  };
}
