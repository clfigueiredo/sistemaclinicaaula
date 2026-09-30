/**
 * Utilitários internos do módulo financeiro: esquemas Zod reutilizáveis, datas 'YYYY-MM-DD',
 * dinheiro (Prisma.Decimal ⇄ string "150.00"), categorias/conta padrão e marcador de agendamento em títulos.
 */
import { Prisma, type TipoMovimentacao, type TipoTitulo } from '@prisma/client';
import { z } from 'zod';
import { fromZonedTime } from 'date-fns-tz';
import type { DbTenant } from '../../plugins/tenant';
import { ErroNegocio, ou404 } from '../../utils/erros';
import { dataSemHora, hojeNoFuso, paraDataIso } from '../../servicos/financeiroComum';
import { obterFuso } from '../agendamentos/servico';

// ----------------------------------------------------------------------------- esquemas

export const FORMAS_PAGAMENTO = [
  'dinheiro',
  'pix',
  'cartao_credito',
  'cartao_debito',
  'boleto',
  'transferencia',
  'convenio',
  'outro',
] as const;

export const zId = (rotulo = 'Identificador') => z.uuid(`${rotulo} inválido.`);
export const ParamsId = z.object({ id: zId() });

/** 'YYYY-MM-DD' válido (inclusive dia do calendário). */
export const zDataIso = (rotulo = 'Data') =>
  z
    .string({ error: `Informe ${rotulo.toLowerCase()}.` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${rotulo} inválida (use AAAA-MM-DD).`)
    .refine((s) => {
      const d = new Date(`${s}T00:00:00.000Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, `${rotulo} inválida.`);

/** Valor em reais (> 0, até 2 casas). */
export const zValor = (rotulo = 'Valor') =>
  z
    .number({ error: `Informe ${rotulo.toLowerCase()}.` })
    .positive(`${rotulo} deve ser maior que zero.`)
    .max(99_999_999.99, `${rotulo} muito alto.`)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, `${rotulo} deve ter no máximo 2 casas decimais.`);

/** Valor em reais que pode ser zero (juros, desconto, saldo inicial). */
export const zValorOuZero = (rotulo = 'Valor') =>
  z
    .number({ error: `${rotulo} inválido.` })
    .min(0, `${rotulo} não pode ser negativo.`)
    .max(99_999_999.99, `${rotulo} muito alto.`)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, `${rotulo} deve ter no máximo 2 casas decimais.`);

export const zFormaPagamento = z.enum(FORMAS_PAGAMENTO, { error: 'Forma de pagamento inválida.' });

export const zTextoOpcional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));

export const zPagina = {
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(20),
};

/** Query com período opcional (padrão: mês corrente no fuso da clínica). */
export const zPeriodo = {
  inicio: zDataIso('Início').optional(),
  fim: zDataIso('Fim').optional(),
};

export const MAX_DIAS_PERIODO = 731;

// ----------------------------------------------------------------------------- dinheiro

export const ZERO = new Prisma.Decimal(0);

export function dec(v: number | string | Prisma.Decimal | null | undefined): Prisma.Decimal {
  if (v === null || v === undefined) return ZERO;
  return new Prisma.Decimal(typeof v === 'number' ? v.toFixed(2) : v);
}

/** Decimal → "150.00". */
export function moeda(v: Prisma.Decimal | number | string | null | undefined): string {
  return dec(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

export function moedaOuNull(v: Prisma.Decimal | null | undefined): string | null {
  return v === null || v === undefined ? null : moeda(v);
}

// ----------------------------------------------------------------------------- datas

export { dataSemHora, hojeNoFuso, paraDataIso };

export async function fusoDaClinica(db: DbTenant, clinicaId: string): Promise<string> {
  return obterFuso(db, clinicaId);
}

function doisDigitos(n: number) {
  return String(n).padStart(2, '0');
}

export function diasNoMes(ano: number, mes1a12: number): number {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

/** Soma meses a um 'YYYY-MM-DD' mantendo o dia (limitado ao último dia do mês) — ou forçando `dia`. */
export function somarMeses(iso: string, meses: number, dia?: number): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const diaFinal = Math.min(dia ?? d, diasNoMes(ano, mes));
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(diaFinal)}`;
}

export function primeiroDiaMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function ultimoDiaMes(iso: string): string {
  const [a, m] = iso.split('-').map(Number) as [number, number];
  return `${iso.slice(0, 7)}-${doisDigitos(diasNoMes(a, m))}`;
}

export function somarDias(iso: string, dias: number): string {
  const d = dataSemHora(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraDataIso(d);
}

export function diferencaDias(inicio: string, fim: string): number {
  return Math.round((dataSemHora(fim).getTime() - dataSemHora(inicio).getTime()) / 86_400_000);
}

/** Resolve o período (padrão: mês corrente no fuso) e valida ordem/tamanho. */
export function resolverPeriodo(
  q: { inicio?: string; fim?: string },
  fuso: string,
  maxDias = MAX_DIAS_PERIODO,
): { inicio: string; fim: string } {
  const hoje = hojeNoFuso(fuso);
  const inicio = q.inicio ?? primeiroDiaMes(q.fim ?? hoje);
  const fim = q.fim ?? ultimoDiaMes(inicio);
  if (fim < inicio) throw new ErroNegocio(400, 'periodo_invalido', 'O fim do período deve ser igual ou posterior ao início.');
  if (diferencaDias(inicio, fim) > maxDias) {
    throw new ErroNegocio(400, 'periodo_invalido', `O período máximo é de ${maxDias} dias.`);
  }
  return { inicio, fim };
}

/** Instantes UTC [início 00:00, fim+1 00:00) do período no fuso da clínica (para colunas DateTime). */
export function intervaloInstantes(periodo: { inicio: string; fim: string }, fuso: string) {
  return {
    gte: fromZonedTime(`${periodo.inicio}T00:00:00`, fuso),
    lt: fromZonedTime(`${somarDias(periodo.fim, 1)}T00:00:00`, fuso),
  };
}

/** Instante para `pago_em` a partir da data da baixa: agora (se hoje) ou meio-dia daquele dia no fuso. */
export function instanteDaData(dataIso: string, fuso: string): Date {
  return dataIso === hojeNoFuso(fuso) ? new Date() : fromZonedTime(`${dataIso}T12:00:00`, fuso);
}

export function assegurarNaoFutura(dataIso: string, fuso: string, rotulo = 'A data') {
  if (dataIso > hojeNoFuso(fuso)) {
    throw new ErroNegocio(400, 'data_futura', `${rotulo} não pode ser no futuro.`);
  }
}

// ----------------------------------------------------------------------------- categorias e contas padrão

export const CATEGORIAS_PADRAO: { nome: string; tipo: 'receita' | 'despesa' }[] = [
  { nome: 'Consultas', tipo: 'receita' },
  { nome: 'Procedimentos', tipo: 'receita' },
  { nome: 'Mensalidades', tipo: 'receita' },
  { nome: 'Convênios', tipo: 'receita' },
  { nome: 'Outras receitas', tipo: 'receita' },
  { nome: 'Aluguel', tipo: 'despesa' },
  { nome: 'Salários', tipo: 'despesa' },
  { nome: 'Repasses a profissionais', tipo: 'despesa' },
  { nome: 'Materiais e insumos', tipo: 'despesa' },
  { nome: 'Impostos e taxas', tipo: 'despesa' },
  { nome: 'Marketing', tipo: 'despesa' },
  { nome: 'Outras despesas', tipo: 'despesa' },
];

export const CATEGORIA_CONSULTAS = 'Consultas';
export const CATEGORIA_CONVENIOS = 'Convênios';
export const CATEGORIA_REPASSES = 'Repasses a profissionais';

/** Cria as categorias padrão na primeira vez (idempotente: ON CONFLICT DO NOTHING). */
export async function garantirCategoriasPadrao(db: DbTenant): Promise<void> {
  const existe = await db.categoriaFinanceira.findFirst({ where: { padrao: true }, select: { id: true } });
  if (existe) return;
  await db.categoriaFinanceira.createMany({
    data: CATEGORIAS_PADRAO.map((c) => ({ ...c, padrao: true })),
    skipDuplicates: true,
  });
}

/** Id de uma categoria padrão pelo nome (null se renomeada/desativada). */
export async function categoriaPadraoId(
  db: DbTenant,
  nome: string,
  tipo: 'receita' | 'despesa',
): Promise<string | null> {
  await garantirCategoriasPadrao(db);
  const c = await db.categoriaFinanceira.findFirst({
    where: { nome, tipo, ativo: true },
    select: { id: true },
    orderBy: { padrao: 'desc' },
  });
  return c?.id ?? null;
}

/** Cria a conta "Caixa" se a clínica ainda não tem nenhuma conta. */
export async function garantirContaPadrao(db: DbTenant): Promise<void> {
  const existe = await db.contaFinanceira.findFirst({ select: { id: true } });
  if (existe) return;
  try {
    await db.contaFinanceira.create({ data: { nome: 'Caixa', tipo: 'caixa' } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
}

// ----------------------------------------------------------------------------- validação de FKs

export function tipoCategoriaDe(tipo: TipoMovimentacao | TipoTitulo): 'receita' | 'despesa' {
  return tipo === 'entrada' || tipo === 'receber' ? 'receita' : 'despesa';
}

export async function validarCategoria(db: DbTenant, id: string | null | undefined, tipo: TipoMovimentacao | TipoTitulo) {
  if (!id) return null;
  const c = ou404(await db.categoriaFinanceira.findUnique({ where: { id } }), 'Categoria não encontrada.');
  const esperado = tipoCategoriaDe(tipo);
  if (c.tipo !== esperado) {
    throw new ErroNegocio(
      400,
      'categoria_incompativel',
      esperado === 'receita' ? 'Escolha uma categoria de receita.' : 'Escolha uma categoria de despesa.',
    );
  }
  return c;
}

export async function validarConta(db: DbTenant, id: string) {
  const c = ou404(await db.contaFinanceira.findUnique({ where: { id } }), 'Conta financeira não encontrada.');
  if (!c.ativo) throw new ErroNegocio(409, 'conta_inativa', 'Esta conta financeira está desativada.');
  return c;
}

export async function validarPaciente(db: DbTenant, id: string | null | undefined) {
  if (!id) return null;
  return ou404(await db.paciente.findUnique({ where: { id }, select: { id: true } }), 'Paciente não encontrado.');
}

export async function validarProfissional(db: DbTenant, id: string | null | undefined) {
  if (!id) return null;
  return ou404(
    await db.profissional.findUnique({ where: { id }, select: { id: true, nome: true, percentual_repasse: true } }),
    'Profissional não encontrado.',
  );
}

export function ehErroUnico(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
