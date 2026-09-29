/**
 * Módulo profissionais — Profissionais + grade de horários + bloqueios de agenda
 *
 * Rotas (prefixo "/profissionais"):
 *   GET    /profissionais?ativos=true         lista → [{ id, nome, especialidade, registro, telefone, email,
 *                                             duracao_consulta_min, cor_agenda, ativo }] (todos os papéis)
 *   GET    /profissionais/:id                 detalhe + `horarios` (grade) + `bloqueios` (vigentes/futuros do
 *                                             profissional) + `usuario` vinculado (todos os papéis)
 *   POST   /profissionais                     admin; consome `max_profissionais` (assegurarLimite em transação)
 *   PUT    /profissionais/:id                 admin; campos parciais + `ativo` (reativar consome o limite)
 *   PUT    /profissionais/:id/horarios        admin; substitui a grade: [{ dia_semana 0-6, hora_inicio, hora_fim }]
 *                                             (ou { horarios: [...] }); início < fim, sem sobreposição no dia
 *   GET    /profissionais/bloqueios?inicio=&fim=&profissionalId=&somenteClinica=
 *                                             bloqueios que cruzam o período (todos os papéis). Com
 *                                             profissionalId, inclui também os da clínica toda.
 *   POST   /profissionais/bloqueios           admin e recepção; { profissional_id (null = clínica toda), inicio, fim, motivo }
 *   DELETE /profissionais/bloqueios/:id       admin e recepção
 *
 * Decisão: recepção também cria/remove bloqueios (ela opera a agenda no dia a dia).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { assegurarLimite } from '../../plugins/recursos';
import { ou404 } from '../../utils/erros';
import {
  PALETA_CORES_AGENDA,
  corpoBloqueio,
  corpoCriarProfissional,
  corpoEditarProfissional,
  corpoGrade,
  filtroBloqueios,
  validarGrade,
} from './esquemas';

export const prefixo = '/profissionais';

const MSG_NAO_ENCONTRADO = 'Profissional não encontrado.';

/** Campos devolvidos na lista (contrato consumido por agenda/pacientes). */
const selecaoLista = {
  id: true,
  nome: true,
  especialidade: true,
  registro: true,
  telefone: true,
  email: true,
  duracao_consulta_min: true,
  cor_agenda: true,
  ativo: true,
} satisfies Prisma.ProfissionalSelect;

const paramsId = z.object({ id: z.uuid('Identificador inválido') });

const selecaoBloqueio = {
  id: true,
  profissional_id: true,
  inicio: true,
  fim: true,
  motivo: true,
  criado_em: true,
  profissional: { select: { id: true, nome: true, cor_agenda: true } },
} satisfies Prisma.BloqueioAgendaSelect;

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);

  // ------------------------------------------------------------------ bloqueios
  // (rotas estáticas registradas antes de /:id por clareza; o roteador já prioriza as estáticas)

  app.get('/bloqueios', { schema: { querystring: filtroBloqueios } }, async (request) => {
    const { inicio, fim, profissionalId, somenteClinica } = request.query;
    const where: Prisma.BloqueioAgendaWhereInput = {};
    if (inicio) where.fim = { gt: inicio };
    if (fim) where.inicio = { lt: fim };
    if (somenteClinica) where.profissional_id = null;
    else if (profissionalId) where.OR = [{ profissional_id: profissionalId }, { profissional_id: null }];
    return request.db.bloqueioAgenda.findMany({ where, select: selecaoBloqueio, orderBy: { inicio: 'asc' } });
  });

  app.post(
    '/bloqueios',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { body: corpoBloqueio } },
    async (request, reply) => {
      const { profissional_id, inicio, fim, motivo } = request.body;
      if (profissional_id) {
        ou404(await request.db.profissional.findUnique({ where: { id: profissional_id } }), MSG_NAO_ENCONTRADO);
      }
      const bloqueio = await request.db.bloqueioAgenda.create({
        data: { profissional_id: profissional_id ?? null, inicio, fim, motivo: motivo ?? null },
        select: selecaoBloqueio,
      });
      reply.status(201);
      return bloqueio;
    },
  );

  app.delete(
    '/bloqueios/:id',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { params: paramsId } },
    async (request, reply) => {
      const r = await request.db.bloqueioAgenda.deleteMany({ where: { id: request.params.id } });
      ou404(r.count > 0 ? r : null, 'Bloqueio não encontrado.');
      return reply.status(204).send();
    },
  );

  // ------------------------------------------------------------------ profissionais

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
      return request.db.profissional.findMany({
        where: {
          ...(ativos !== undefined ? { ativo: ativos } : {}),
          ...(busca ? { nome: { contains: busca, mode: 'insensitive' } } : {}),
        },
        select: selecaoLista,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      });
    },
  );

  app.get('/:id', { schema: { params: paramsId } }, async (request) => {
    const { id } = request.params;
    const profissional = ou404(
      await request.db.profissional.findUnique({
        where: { id },
        select: {
          ...selecaoLista,
          criado_em: true,
          atualizado_em: true,
          usuario: { select: { id: true, nome: true, email: true, papel: true, ativo: true } },
        },
      }),
      MSG_NAO_ENCONTRADO,
    );
    const [horarios, bloqueios] = await Promise.all([
      request.db.profissionalHorario.findMany({
        where: { profissional_id: id },
        select: { id: true, dia_semana: true, hora_inicio: true, hora_fim: true },
        orderBy: [{ dia_semana: 'asc' }, { hora_inicio: 'asc' }],
      }),
      request.db.bloqueioAgenda.findMany({
        where: { profissional_id: id, fim: { gte: new Date() } },
        select: selecaoBloqueio,
        orderBy: { inicio: 'asc' },
      }),
    ]);
    return { ...profissional, horarios, bloqueios };
  });

  app.post(
    '/',
    { preHandler: exigirPapel('admin'), schema: { body: corpoCriarProfissional } },
    async (request, reply) => {
      const dados = request.body;
      const criado = await request.db.$transaction(async (tx) => {
        await assegurarLimite(request.clinicaId, 'max_profissionais', { tx });
        let cor = dados.cor_agenda;
        if (!cor) {
          const total = await tx.profissional.count();
          cor = PALETA_CORES_AGENDA[total % PALETA_CORES_AGENDA.length];
        }
        return tx.profissional.create({
          data: {
            nome: dados.nome,
            especialidade: dados.especialidade ?? null,
            registro: dados.registro ?? null,
            telefone: dados.telefone ?? null,
            email: dados.email ?? null,
            duracao_consulta_min: dados.duracao_consulta_min ?? 30,
            cor_agenda: cor,
          },
          select: selecaoLista,
        });
      });
      reply.status(201);
      return criado;
    },
  );

  app.put(
    '/:id',
    { preHandler: exigirPapel('admin'), schema: { params: paramsId, body: corpoEditarProfissional } },
    async (request) => {
      const { id } = request.params;
      const dados = request.body;
      return request.db.$transaction(async (tx) => {
        const atual = ou404(await tx.profissional.findUnique({ where: { id } }), MSG_NAO_ENCONTRADO);
        if (dados.ativo === true && !atual.ativo) {
          // Reativar volta a consumir o limite do plano.
          await assegurarLimite(request.clinicaId, 'max_profissionais', { tx });
        }
        const data: Prisma.ProfissionalUpdateInput = {};
        for (const campo of [
          'nome',
          'especialidade',
          'registro',
          'telefone',
          'email',
          'duracao_consulta_min',
          'cor_agenda',
          'ativo',
        ] as const) {
          if (dados[campo] !== undefined) (data as Record<string, unknown>)[campo] = dados[campo];
        }
        return tx.profissional.update({ where: { id }, data, select: selecaoLista });
      });
    },
  );

  app.put(
    '/:id/horarios',
    { preHandler: exigirPapel('admin'), schema: { params: paramsId, body: corpoGrade } },
    async (request) => {
      const { id } = request.params;
      const grade = validarGrade(request.body);
      ou404(await request.db.profissional.findUnique({ where: { id } }), MSG_NAO_ENCONTRADO);
      return request.db.$transaction(async (tx) => {
        await tx.profissionalHorario.deleteMany({ where: { profissional_id: id } });
        if (grade.length) {
          await tx.profissionalHorario.createMany({ data: grade.map((g) => ({ ...g, profissional_id: id })) });
        }
        return tx.profissionalHorario.findMany({
          where: { profissional_id: id },
          select: { id: true, dia_semana: true, hora_inicio: true, hora_fim: true },
          orderBy: [{ dia_semana: 'asc' }, { hora_inicio: 'asc' }],
        });
      });
    },
  );
};

export default modulo;
