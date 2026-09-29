/**
 * Módulo convenios — Convênios (apenas nome; sem TISS)
 *
 * Rotas (prefixo "/convenios"):
 *   GET    /convenios?ativos=true&busca=  lista → [{ id, nome, ativo, uso: { pacientes, agendamentos } }] (todos os papéis)
 *   POST   /convenios                     admin e recepção; { nome } — nome único por clínica (sem diferenciar
 *                                         maiúsculas/minúsculas) → 409 convenio_duplicado
 *   PUT    /convenios/:id                 admin e recepção; { nome?, ativo? }
 *   DELETE /convenios/:id                 admin e recepção; só se não estiver em uso por pacientes/agendamentos
 *                                         (senão 409 convenio_em_uso — desative em vez de excluir)
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import type { DbTenant } from '../../plugins/tenant';
import { ErroNegocio, ou404 } from '../../utils/erros';

export const prefixo = '/convenios';

const MSG_NAO_ENCONTRADO = 'Convênio não encontrado.';

const nome = z.string().trim().min(2, 'Informe o nome do convênio').max(100, 'Máximo de 100 caracteres');
const paramsId = z.object({ id: z.uuid('Identificador inválido') });

const selecao = {
  id: true,
  nome: true,
  ativo: true,
  criado_em: true,
  _count: { select: { pacientes: true, agendamentos: true } },
} satisfies Prisma.ConvenioSelect;

type ConvenioSelecionado = Prisma.ConvenioGetPayload<{ select: typeof selecao }>;

function formatar({ _count, ...c }: ConvenioSelecionado) {
  return { ...c, uso: { pacientes: _count.pacientes, agendamentos: _count.agendamentos } };
}

async function assegurarNomeLivre(db: DbTenant, valor: string, ignorarId?: string) {
  const existente = await db.convenio.findFirst({
    where: { nome: { equals: valor, mode: 'insensitive' }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existente) {
    throw new ErroNegocio(409, 'convenio_duplicado', `Já existe um convênio chamado "${valor}".`);
  }
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);

  app.get(
    '/',
    {
      schema: {
        querystring: z.object({
          ativos: z
            .enum(['true', 'false'])
            .optional()
            .transform((v) => (v === undefined ? undefined : v === 'true')),
          busca: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (request) => {
      const { ativos, busca } = request.query;
      const lista = await request.db.convenio.findMany({
        where: {
          ...(ativos !== undefined ? { ativo: ativos } : {}),
          ...(busca ? { nome: { contains: busca, mode: 'insensitive' } } : {}),
        },
        select: selecao,
        orderBy: { nome: 'asc' },
      });
      return lista.map(formatar);
    },
  );

  app.post(
    '/',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { body: z.object({ nome }) } },
    async (request, reply) => {
      await assegurarNomeLivre(request.db, request.body.nome);
      const criado = await request.db.convenio.create({ data: { nome: request.body.nome }, select: selecao });
      reply.status(201);
      return formatar(criado);
    },
  );

  app.put(
    '/:id',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: { params: paramsId, body: z.object({ nome: nome.optional(), ativo: z.boolean().optional() }) },
    },
    async (request) => {
      const { id } = request.params;
      ou404(await request.db.convenio.findUnique({ where: { id }, select: { id: true } }), MSG_NAO_ENCONTRADO);
      if (request.body.nome !== undefined) await assegurarNomeLivre(request.db, request.body.nome, id);
      const atualizado = await request.db.convenio.update({
        where: { id },
        data: {
          ...(request.body.nome !== undefined ? { nome: request.body.nome } : {}),
          ...(request.body.ativo !== undefined ? { ativo: request.body.ativo } : {}),
        },
        select: selecao,
      });
      return formatar(atualizado);
    },
  );

  app.delete(
    '/:id',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { params: paramsId } },
    async (request, reply) => {
      const { id } = request.params;
      const convenio = formatar(
        ou404(await request.db.convenio.findUnique({ where: { id }, select: selecao }), MSG_NAO_ENCONTRADO),
      );
      if (convenio.uso.pacientes > 0 || convenio.uso.agendamentos > 0) {
        throw new ErroNegocio(
          409,
          'convenio_em_uso',
          'Este convênio está vinculado a pacientes ou agendamentos e não pode ser excluído. Desative-o para que não apareça mais nas seleções.',
          { uso: convenio.uso },
        );
      }
      await request.db.convenio.delete({ where: { id } });
      return reply.status(204).send();
    },
  );
};

export default modulo;
