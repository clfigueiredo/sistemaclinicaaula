/**
 * Caixa: movimentações (listar com filtros + totais efetivos, lançar, editar descrição/categoria, estornar)
 * e recebimentos por consulta (caixa ou "a receber do convênio").
 *
 * Regras:
 *   - Valor, tipo, data, conta e forma NUNCA mudam. Só admin edita descrição/categoria (PUT).
 *   - Estorno (só admin) = nova movimentação inversa com `estorno_de_id` (uma vez; estorno não se estorna).
 *     Se a original baixou um título, o título volta a `aberto`.
 *   - Datas de lançamento não podem ser futuras (caixa é realizado; o futuro é título).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { exigirPapel } from '../../plugins/auth';
import type { DbTenant } from '../../plugins/tenant';
import { ErroNegocio, ou404 } from '../../utils/erros';
import {
  CATEGORIA_CONSULTAS,
  CATEGORIA_CONVENIOS,
  ParamsId,
  assegurarNaoFutura,
  categoriaPadraoId,
  dataSemHora,
  dec,
  ehErroUnico,
  fusoDaClinica,
  hojeNoFuso,
  moeda,
  resolverPeriodo,
  validarCategoria,
  validarConta,
  validarPaciente,
  validarProfissional,
  zDataIso,
  zFormaPagamento,
  zId,
  zPagina,
  zPeriodo,
  zTextoOpcional,
  zValor,
} from './comum';
import {
  includeMovimentacao,
  includeTitulo,
  serializarMovimentacao,
  serializarTitulo,
  somarEfetivas,
} from './servico';
import { WHERE_MOVIMENTACAO_EFETIVA } from '../../servicos/financeiroComum';

const ORIGENS = ['manual', 'consulta', 'titulo', 'repasse', 'estorno'] as const;

async function carregarAgendamento(db: DbTenant, id: string) {
  const a = ou404(
    await db.agendamento.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tipo: true,
        inicio: true,
        paciente_id: true,
        profissional_id: true,
        paciente: { select: { nome: true } },
        profissional: { select: { nome: true } },
        convenio: { select: { nome: true } },
      },
    }),
    'Agendamento não encontrado.',
  );
  if (a.status === 'cancelado') {
    throw new ErroNegocio(409, 'agendamento_cancelado', 'Não é possível registrar recebimento de um agendamento cancelado.');
  }
  return a;
}

function descricaoConsulta(a: { inicio: Date; paciente: { nome: string } }, fuso: string) {
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }).format(a.inicio);
  return `Consulta de ${a.paciente.nome} em ${dia}`;
}

const rotas: FastifyPluginAsyncZod = async (app) => {
  // ----------------------------------------------------------------------- listar
  app.get(
    '/movimentacoes',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: {
        querystring: z.object({
          ...zPeriodo,
          ...zPagina,
          conta_id: zId('Conta').optional(),
          tipo: z.enum(['entrada', 'saida']).optional(),
          origem: z.enum(ORIGENS).optional(),
          categoria_id: zId('Categoria').optional(),
          profissional_id: zId('Profissional').optional(),
          paciente_id: zId('Paciente').optional(),
          forma_pagamento: zFormaPagamento.optional(),
          busca: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (request) => {
      const q = request.query;
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const periodo = resolverPeriodo(q, fuso);
      const base: Prisma.MovimentacaoFinanceiraWhereInput = {
        data: { gte: dataSemHora(periodo.inicio), lte: dataSemHora(periodo.fim) },
        ...(q.conta_id ? { conta_financeira_id: q.conta_id } : {}),
        ...(q.origem ? { origem: q.origem } : {}),
        ...(q.categoria_id ? { categoria_id: q.categoria_id } : {}),
        ...(q.profissional_id ? { profissional_id: q.profissional_id } : {}),
        ...(q.paciente_id ? { paciente_id: q.paciente_id } : {}),
        ...(q.forma_pagamento ? { forma_pagamento: q.forma_pagamento } : {}),
        ...(q.busca
          ? {
              OR: [
                { descricao: { contains: q.busca, mode: 'insensitive' } },
                { paciente: { nome: { contains: q.busca, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const where: Prisma.MovimentacaoFinanceiraWhereInput = { ...base, ...(q.tipo ? { tipo: q.tipo } : {}) };
      const [itens, total, soma] = await Promise.all([
        request.db.movimentacaoFinanceira.findMany({
          where,
          include: includeMovimentacao,
          orderBy: [{ data: 'desc' }, { criado_em: 'desc' }],
          skip: (q.pagina - 1) * q.por_pagina,
          take: q.por_pagina,
        }),
        request.db.movimentacaoFinanceira.count({ where }),
        somarEfetivas(request.db, where),
      ]);
      return {
        itens: itens.map(serializarMovimentacao),
        total,
        pagina: q.pagina,
        porPagina: q.por_pagina,
        periodo,
        totais: {
          entradas: moeda(soma.entradas),
          saidas: moeda(soma.saidas),
          saldo: moeda(soma.entradas.sub(soma.saidas)),
        },
      };
    },
  );

  // ----------------------------------------------------------------------- lançar
  app.post(
    '/movimentacoes',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: {
        body: z.object({
          tipo: z.enum(['entrada', 'saida'], { error: 'Tipo inválido.' }),
          data: zDataIso('Data'),
          valor: zValor(),
          conta_financeira_id: zId('Conta'),
          forma_pagamento: zFormaPagamento,
          categoria_id: zId('Categoria').nullish(),
          descricao: zTextoOpcional(300),
          paciente_id: zId('Paciente').nullish(),
          profissional_id: zId('Profissional').nullish(),
          agendamento_id: zId('Agendamento').nullish(),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      assegurarNaoFutura(b.data, fuso);
      await validarConta(db, b.conta_financeira_id);
      await validarCategoria(db, b.categoria_id, b.tipo);
      await validarPaciente(db, b.paciente_id);
      await validarProfissional(db, b.profissional_id);

      let pacienteId = b.paciente_id ?? null;
      let profissionalId = b.profissional_id ?? null;
      if (b.agendamento_id) {
        const a = await carregarAgendamento(db, b.agendamento_id);
        if ((pacienteId && pacienteId !== a.paciente_id) || (profissionalId && profissionalId !== a.profissional_id)) {
          throw new ErroNegocio(400, 'vinculo_inconsistente', 'Paciente/profissional não correspondem ao agendamento.');
        }
        pacienteId = a.paciente_id;
        profissionalId = a.profissional_id;
      }

      const criada = await db.movimentacaoFinanceira.create({
        data: {
          tipo: b.tipo,
          origem: b.agendamento_id && b.tipo === 'entrada' ? 'consulta' : 'manual',
          data: dataSemHora(b.data),
          valor: dec(b.valor),
          conta_financeira_id: b.conta_financeira_id,
          categoria_id: b.categoria_id ?? null,
          forma_pagamento: b.forma_pagamento,
          descricao: b.descricao,
          paciente_id: pacienteId,
          profissional_id: profissionalId,
          agendamento_id: b.agendamento_id ?? null,
          criado_por: request.usuarioClinica!.id,
        },
        include: includeMovimentacao,
      });
      reply.status(201);
      return serializarMovimentacao(criada);
    },
  );

  // ----------------------------------------------------------------------- editar (só descrição/categoria)
  app.put(
    '/movimentacoes/:id',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        params: ParamsId,
        body: z.object({ descricao: zTextoOpcional(300).optional(), categoria_id: zId('Categoria').nullish() }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const m = ou404(await request.db.movimentacaoFinanceira.findUnique({ where: { id } }), 'Movimentação não encontrada.');
      if (request.body.categoria_id !== undefined) await validarCategoria(request.db, request.body.categoria_id, m.tipo);
      const atualizada = await request.db.movimentacaoFinanceira.update({
        where: { id },
        data: {
          ...(request.body.descricao !== undefined ? { descricao: request.body.descricao } : {}),
          ...(request.body.categoria_id !== undefined ? { categoria_id: request.body.categoria_id } : {}),
        },
        include: includeMovimentacao,
      });
      return serializarMovimentacao(atualizada);
    },
  );

  // ----------------------------------------------------------------------- estorno
  app.post(
    '/movimentacoes/:id/estorno',
    {
      preHandler: exigirPapel('admin'),
      schema: { params: ParamsId, body: z.object({ motivo: zTextoOpcional(300) }).optional() },
    },
    async (request, reply) => {
      const { id } = request.params;
      const motivo = request.body?.motivo ?? null;
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const hoje = hojeNoFuso(fuso);

      try {
        const estorno = await request.db.$transaction(async (tx) => {
          // Trava a original: dois estornos simultâneos não passam (e o único em estorno_de_id garante).
          await tx.$executeRawUnsafe(
            'SELECT id FROM movimentacoes_financeiras WHERE id = $1::uuid AND clinica_id = $2::uuid FOR UPDATE',
            id,
            request.clinicaId,
          );
          const original = ou404(
            await tx.movimentacaoFinanceira.findUnique({ where: { id }, include: { estornada_por: { select: { id: true } } } }),
            'Movimentação não encontrada.',
          );
          if (original.origem === 'estorno') {
            throw new ErroNegocio(409, 'estorno_de_estorno', 'Um estorno não pode ser estornado.');
          }
          if (original.estornada_por) {
            throw new ErroNegocio(409, 'ja_estornada', 'Esta movimentação já foi estornada.');
          }
          const base = original.descricao ? `Estorno: ${original.descricao}` : 'Estorno';
          const criado = await tx.movimentacaoFinanceira.create({
            data: {
              tipo: original.tipo === 'entrada' ? 'saida' : 'entrada',
              origem: 'estorno',
              data: dataSemHora(hoje < paraIso(original.data) ? paraIso(original.data) : hoje),
              valor: original.valor,
              conta_financeira_id: original.conta_financeira_id,
              categoria_id: original.categoria_id,
              forma_pagamento: original.forma_pagamento,
              descricao: motivo ? `${base} — ${motivo}` : base,
              agendamento_id: original.agendamento_id,
              paciente_id: original.paciente_id,
              profissional_id: original.profissional_id,
              titulo_id: original.titulo_id,
              repasse_inicio: original.repasse_inicio,
              repasse_fim: original.repasse_fim,
              estorno_de_id: original.id,
              criado_por: request.usuarioClinica!.id,
            },
            include: includeMovimentacao,
          });
          if (original.titulo_id && original.origem === 'titulo') {
            await tx.titulo.updateMany({
              where: { id: original.titulo_id, status: 'pago' },
              data: { status: 'aberto', pago_em: null, valor_pago: null },
            });
          }
          return criado;
        });
        reply.status(201);
        return serializarMovimentacao(estorno);
      } catch (e) {
        if (ehErroUnico(e)) throw new ErroNegocio(409, 'ja_estornada', 'Esta movimentação já foi estornada.');
        throw e;
      }
    },
  );

  // ----------------------------------------------------------------------- recebimentos por consulta
  app.get(
    '/recebimentos/agendamento/:agendamentoId',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: { params: z.object({ agendamentoId: zId('Agendamento') }) },
    },
    async (request) => {
      const { agendamentoId } = request.params;
      ou404(
        await request.db.agendamento.findUnique({ where: { id: agendamentoId }, select: { id: true } }),
        'Agendamento não encontrado.',
      );
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const [itens, soma, titulos] = await Promise.all([
        request.db.movimentacaoFinanceira.findMany({
          where: { agendamento_id: agendamentoId },
          include: includeMovimentacao,
          orderBy: { criado_em: 'asc' },
        }),
        request.db.movimentacaoFinanceira.aggregate({
          where: { AND: [WHERE_MOVIMENTACAO_EFETIVA, { agendamento_id: agendamentoId, tipo: 'entrada' }] },
          _sum: { valor: true },
        }),
        request.db.titulo.findMany({
          where: { agendamento_id: agendamentoId },
          include: includeTitulo,
          orderBy: { criado_em: 'asc' },
        }),
      ]);
      const hoje = hojeNoFuso(fuso);
      return {
        itens: itens.map(serializarMovimentacao),
        total: moeda(soma._sum.valor),
        titulos: titulos.map((t) => serializarTitulo(t, hoje)),
      };
    },
  );

  app.post(
    '/recebimentos',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: {
        body: z.object({
          agendamento_id: zId('Agendamento'),
          valor: zValor(),
          forma_pagamento: zFormaPagamento,
          conta_financeira_id: zId('Conta'),
          categoria_id: zId('Categoria').nullish(),
          data: zDataIso('Data').optional(),
          descricao: zTextoOpcional(300),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      const data = b.data ?? hojeNoFuso(fuso);
      assegurarNaoFutura(data, fuso);
      const a = await carregarAgendamento(db, b.agendamento_id);
      await validarConta(db, b.conta_financeira_id);
      await validarCategoria(db, b.categoria_id, 'entrada');
      const categoriaId = b.categoria_id ?? (await categoriaPadraoId(db, CATEGORIA_CONSULTAS, 'receita'));

      const criada = await db.movimentacaoFinanceira.create({
        data: {
          tipo: 'entrada',
          origem: 'consulta',
          data: dataSemHora(data),
          valor: dec(b.valor),
          conta_financeira_id: b.conta_financeira_id,
          categoria_id: categoriaId,
          forma_pagamento: b.forma_pagamento,
          descricao: b.descricao ?? descricaoConsulta(a, fuso),
          agendamento_id: a.id,
          paciente_id: a.paciente_id,
          profissional_id: a.profissional_id,
          criado_por: request.usuarioClinica!.id,
        },
        include: includeMovimentacao,
      });
      reply.status(201);
      return serializarMovimentacao(criada);
    },
  );

  /** Consulta de convênio: lança um título A RECEBER do convênio (em vez de entrada no caixa). */
  app.post(
    '/recebimentos/convenio',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: {
        body: z.object({
          agendamento_id: zId('Agendamento'),
          valor: zValor(),
          vencimento: zDataIso('Vencimento'),
          categoria_id: zId('Categoria').nullish(),
          descricao: zTextoOpcional(300),
          observacoes: zTextoOpcional(500),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      const a = await carregarAgendamento(db, b.agendamento_id);
      if (a.tipo !== 'convenio') {
        throw new ErroNegocio(409, 'agendamento_particular', 'Somente consultas de convênio podem ser lançadas como a receber do convênio.');
      }
      await validarCategoria(db, b.categoria_id, 'receber');
      const categoriaId = b.categoria_id ?? (await categoriaPadraoId(db, CATEGORIA_CONVENIOS, 'receita'));
      const convenio = a.convenio?.nome ?? 'Convênio';
      const titulo = await db.titulo.create({
        data: {
          tipo: 'receber',
          descricao: b.descricao ?? `${descricaoConsulta(a, fuso)} (${convenio})`,
          valor: dec(b.valor),
          vencimento: dataSemHora(b.vencimento),
          categoria_id: categoriaId,
          paciente_id: a.paciente_id,
          profissional_id: a.profissional_id,
          fornecedor: convenio,
          forma_pagamento: 'convenio',
          agendamento_id: a.id,
          observacoes: b.observacoes ?? null,
          criado_por: request.usuarioClinica!.id,
        },
        include: includeTitulo,
      });
      reply.status(201);
      return serializarTitulo(titulo, hojeNoFuso(fuso));
    },
  );
};

function paraIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default rotas;
