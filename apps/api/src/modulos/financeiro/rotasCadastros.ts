/**
 * Cadastros financeiros: contas (saldo atual calculado), categorias (padrão sob demanda) e
 * percentual de repasse dos profissionais.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { exigirPapel } from '../../plugins/auth';
import type { DbTenant } from '../../plugins/tenant';
import { ErroNegocio, ou404 } from '../../utils/erros';
import {
  ParamsId,
  dec,
  garantirCategoriasPadrao,
  garantirContaPadrao,
  moeda,
  zValorOuZero,
} from './comum';

const TIPOS_CONTA = ['caixa', 'banco', 'carteira_digital', 'outro'] as const;
const zNome = (rotulo: string) =>
  z.string({ error: `Informe o nome ${rotulo}.` }).trim().min(2, 'Mínimo de 2 caracteres.').max(80, 'Máximo de 80 caracteres.');
const zAtivosQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

async function saldosPorConta(db: DbTenant): Promise<Map<string, Prisma.Decimal>> {
  // Saldo = saldo_inicial + Σ entradas − Σ saídas (TODAS, inclusive estornos).
  const grupos = await db.movimentacaoFinanceira.groupBy({
    by: ['conta_financeira_id', 'tipo'],
    _sum: { valor: true },
  });
  const mapa = new Map<string, Prisma.Decimal>();
  for (const g of grupos) {
    const atual = mapa.get(g.conta_financeira_id) ?? dec(0);
    const v = dec(g._sum.valor);
    mapa.set(g.conta_financeira_id, g.tipo === 'entrada' ? atual.add(v) : atual.sub(v));
  }
  return mapa;
}

function serializarConta(
  c: { id: string; nome: string; tipo: string; saldo_inicial: Prisma.Decimal; ativo: boolean; criado_em: Date },
  movimento: Prisma.Decimal | undefined,
) {
  return {
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    saldo_inicial: moeda(c.saldo_inicial),
    ativo: c.ativo,
    criado_em: c.criado_em,
    saldo_atual: moeda(c.saldo_inicial.add(movimento ?? 0)),
  };
}

async function assegurarNomeContaLivre(db: DbTenant, nome: string, ignorarId?: string) {
  const existe = await db.contaFinanceira.findFirst({
    where: { nome: { equals: nome, mode: 'insensitive' }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existe) throw new ErroNegocio(409, 'conta_duplicada', `Já existe uma conta chamada "${nome}".`);
}

async function assegurarNomeCategoriaLivre(db: DbTenant, nome: string, tipo: 'receita' | 'despesa', ignorarId?: string) {
  const existe = await db.categoriaFinanceira.findFirst({
    where: { nome: { equals: nome, mode: 'insensitive' }, tipo, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existe) throw new ErroNegocio(409, 'categoria_duplicada', `Já existe uma categoria de ${tipo} chamada "${nome}".`);
}

const rotas: FastifyPluginAsyncZod = async (app) => {
  // ----------------------------------------------------------------------- contas
  app.get(
    '/contas',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { querystring: z.object({ ativos: zAtivosQuery }) } },
    async (request) => {
      await garantirContaPadrao(request.db);
      const [contas, saldos] = await Promise.all([
        request.db.contaFinanceira.findMany({
          where: request.query.ativos !== undefined ? { ativo: request.query.ativos } : {},
          orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
        }),
        saldosPorConta(request.db),
      ]);
      return contas.map((c) => serializarConta(c, saldos.get(c.id)));
    },
  );

  app.post(
    '/contas',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        body: z.object({
          nome: zNome('da conta'),
          tipo: z.enum(TIPOS_CONTA, { error: 'Tipo de conta inválido.' }).default('caixa'),
          saldo_inicial: zValorOuZero('Saldo inicial').default(0),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      await assegurarNomeContaLivre(request.db, b.nome);
      const conta = await request.db.contaFinanceira.create({
        data: { nome: b.nome, tipo: b.tipo, saldo_inicial: dec(b.saldo_inicial) },
      });
      reply.status(201);
      return serializarConta(conta, undefined);
    },
  );

  app.put(
    '/contas/:id',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        params: ParamsId,
        body: z.object({
          nome: zNome('da conta').optional(),
          tipo: z.enum(TIPOS_CONTA, { error: 'Tipo de conta inválido.' }).optional(),
          saldo_inicial: zValorOuZero('Saldo inicial').optional(),
          ativo: z.boolean().optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const b = request.body;
      ou404(await request.db.contaFinanceira.findUnique({ where: { id }, select: { id: true } }), 'Conta financeira não encontrada.');
      if (b.nome !== undefined) await assegurarNomeContaLivre(request.db, b.nome, id);
      if (b.ativo === false) {
        const ativas = await request.db.contaFinanceira.count({ where: { ativo: true, id: { not: id } } });
        if (ativas === 0) {
          throw new ErroNegocio(409, 'ultima_conta', 'Mantenha pelo menos uma conta financeira ativa.');
        }
      }
      const conta = await request.db.contaFinanceira.update({
        where: { id },
        data: {
          ...(b.nome !== undefined ? { nome: b.nome } : {}),
          ...(b.tipo !== undefined ? { tipo: b.tipo } : {}),
          ...(b.saldo_inicial !== undefined ? { saldo_inicial: dec(b.saldo_inicial) } : {}),
          ...(b.ativo !== undefined ? { ativo: b.ativo } : {}),
        },
      });
      const saldos = await saldosPorConta(request.db);
      return serializarConta(conta, saldos.get(conta.id));
    },
  );

  // ----------------------------------------------------------------------- categorias
  app.get(
    '/categorias',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: {
        querystring: z.object({
          tipo: z.enum(['receita', 'despesa'], { error: 'Tipo inválido.' }).optional(),
          ativos: zAtivosQuery,
        }),
      },
    },
    async (request) => {
      await garantirCategoriasPadrao(request.db);
      const { tipo, ativos } = request.query;
      return request.db.categoriaFinanceira.findMany({
        where: { ...(tipo ? { tipo } : {}), ...(ativos !== undefined ? { ativo: ativos } : {}) },
        select: { id: true, nome: true, tipo: true, padrao: true, ativo: true, criado_em: true },
        orderBy: [{ tipo: 'asc' }, { ativo: 'desc' }, { nome: 'asc' }],
      });
    },
  );

  const selCategoria = { id: true, nome: true, tipo: true, padrao: true, ativo: true, criado_em: true } as const;

  app.post(
    '/categorias',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        body: z.object({
          nome: zNome('da categoria'),
          tipo: z.enum(['receita', 'despesa'], { error: 'Tipo inválido.' }),
          ativo: z.boolean().default(true),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      await assegurarNomeCategoriaLivre(request.db, b.nome, b.tipo);
      const c = await request.db.categoriaFinanceira.create({ data: b, select: selCategoria });
      reply.status(201);
      return c;
    },
  );

  app.put(
    '/categorias/:id',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        params: ParamsId,
        body: z.object({ nome: zNome('da categoria').optional(), ativo: z.boolean().optional() }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const atual = ou404(await request.db.categoriaFinanceira.findUnique({ where: { id } }), 'Categoria não encontrada.');
      if (request.body.nome !== undefined) await assegurarNomeCategoriaLivre(request.db, request.body.nome, atual.tipo, id);
      return request.db.categoriaFinanceira.update({ where: { id }, data: request.body, select: selCategoria });
    },
  );

  // ----------------------------------------------------------------------- profissionais (percentual de repasse)
  app.get('/profissionais', { preHandler: exigirPapel('admin') }, async (request) => {
    const lista = await request.db.profissional.findMany({
      select: { id: true, nome: true, especialidade: true, ativo: true, percentual_repasse: true },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    });
    return lista.map((p) => ({ ...p, percentual_repasse: p.percentual_repasse ? moeda(p.percentual_repasse) : null }));
  });

  app.put(
    '/profissionais/:id/repasse',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        params: ParamsId,
        body: z.object({
          percentual_repasse: z
            .number({ error: 'Percentual inválido.' })
            .min(0, 'O percentual deve ser entre 0 e 100.')
            .max(100, 'O percentual deve ser entre 0 e 100.')
            .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Use no máximo 2 casas decimais.')
            .nullable(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      ou404(await request.db.profissional.findUnique({ where: { id }, select: { id: true } }), 'Profissional não encontrado.');
      const pct = request.body.percentual_repasse;
      const p = await request.db.profissional.update({
        where: { id },
        data: { percentual_repasse: pct === null ? null : dec(pct) },
        select: { id: true, nome: true, especialidade: true, ativo: true, percentual_repasse: true },
      });
      return { ...p, percentual_repasse: p.percentual_repasse ? moeda(p.percentual_repasse) : null };
    },
  );
};

export default rotas;
