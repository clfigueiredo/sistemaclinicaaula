/**
 * Contas a pagar e a receber (títulos): listar com filtros + totais, criar (com parcelamento), editar
 * (só `aberto`), baixar (gera movimentação na mesma transação) e cancelar.
 * "vencido" é derivado: status aberto e vencimento < hoje (fuso da clínica).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { exigirPapel } from '../../plugins/auth';
import { ErroNegocio, ou404 } from '../../utils/erros';
import {
  ParamsId,
  assegurarNaoFutura,
  dataSemHora,
  dec,
  fusoDaClinica,
  hojeNoFuso,
  instanteDaData,
  intervaloInstantes,
  moeda,
  primeiroDiaMes,
  somarMeses,
  ultimoDiaMes,
  validarCategoria,
  validarConta,
  validarPaciente,
  validarProfissional,
  zDataIso,
  zFormaPagamento,
  zId,
  zPagina,
  zTextoOpcional,
  zValor,
  zValorOuZero,
} from './comum';
import { includeMovimentacao, includeTitulo, serializarMovimentacao, serializarTitulo } from './servico';

const STATUS_FILTRO = ['aberto', 'a_vencer', 'vencido', 'pago', 'cancelado'] as const;

const CamposTitulo = {
  descricao: z.string({ error: 'Informe a descrição.' }).trim().min(2, 'Mínimo de 2 caracteres.').max(200, 'Máximo de 200 caracteres.'),
  valor: zValor(),
  vencimento: zDataIso('Vencimento'),
  categoria_id: zId('Categoria').nullish(),
  paciente_id: zId('Paciente').nullish(),
  profissional_id: zId('Profissional').nullish(),
  fornecedor: zTextoOpcional(150),
  forma_pagamento: zFormaPagamento.nullish(),
  observacoes: zTextoOpcional(1000),
};

/** Divide o total em N parcelas: base arredondada para baixo; os centavos restantes vão para a última. */
export function dividirParcelas(total: number, n: number): string[] {
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / n);
  const partes = Array.from({ length: n }, (_, i) => (i === n - 1 ? centavos - base * (n - 1) : base));
  return partes.map((c) => (c / 100).toFixed(2));
}

const rotas: FastifyPluginAsyncZod = async (app) => {
  // ----------------------------------------------------------------------- listar
  app.get(
    '/titulos',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: {
        querystring: z.object({
          ...zPagina,
          tipo: z.enum(['pagar', 'receber']).optional(),
          status: z.enum(STATUS_FILTRO).optional(),
          inicio: zDataIso('Início').optional(),
          fim: zDataIso('Fim').optional(),
          paciente_id: zId('Paciente').optional(),
          profissional_id: zId('Profissional').optional(),
          categoria_id: zId('Categoria').optional(),
          recorrencia_id: zId('Recorrência').optional(),
          busca: z.string().trim().max(100).optional(),
        }),
      },
    },
    async (request) => {
      const q = request.query;
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const hoje = hojeNoFuso(fuso);
      const hojeData = dataSemHora(hoje);
      if (q.inicio && q.fim && q.fim < q.inicio) {
        throw new ErroNegocio(400, 'periodo_invalido', 'O fim do período deve ser igual ou posterior ao início.');
      }

      const base: Prisma.TituloWhereInput = {
        ...(q.tipo ? { tipo: q.tipo } : {}),
        ...(q.paciente_id ? { paciente_id: q.paciente_id } : {}),
        ...(q.profissional_id ? { profissional_id: q.profissional_id } : {}),
        ...(q.categoria_id ? { categoria_id: q.categoria_id } : {}),
        ...(q.recorrencia_id ? { recorrencia_id: q.recorrencia_id } : {}),
        ...(q.busca
          ? {
              OR: [
                { descricao: { contains: q.busca, mode: 'insensitive' } },
                { fornecedor: { contains: q.busca, mode: 'insensitive' } },
                { paciente: { nome: { contains: q.busca, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const venc: Prisma.DateTimeFilter = {
        ...(q.inicio ? { gte: dataSemHora(q.inicio) } : {}),
        ...(q.fim ? { lte: dataSemHora(q.fim) } : {}),
      };
      const comPeriodo: Prisma.TituloWhereInput = q.inicio || q.fim ? { ...base, vencimento: venc } : base;

      const filtroStatus: Record<(typeof STATUS_FILTRO)[number], Prisma.TituloWhereInput> = {
        aberto: { status: 'aberto' },
        a_vencer: { status: 'aberto', vencimento: { gte: hojeData } },
        vencido: { status: 'aberto', vencimento: { lt: hojeData } },
        pago: { status: 'pago' },
        cancelado: { status: 'cancelado' },
      };
      const where: Prisma.TituloWhereInput = q.status ? { AND: [comPeriodo, filtroStatus[q.status]] } : comPeriodo;

      // Pagos no período: pelo pago_em (instante, fuso da clínica). Sem período informado = mês corrente.
      const periodoPagos =
        q.inicio || q.fim
          ? { inicio: q.inicio ?? '2000-01-01', fim: q.fim ?? '2999-12-31' }
          : { inicio: primeiroDiaMes(hoje), fim: ultimoDiaMes(hoje) };
      const pagosIntervalo = intervaloInstantes(periodoPagos, fuso);

      const [itens, total, aVencer, vencidos, pagos] = await Promise.all([
        request.db.titulo.findMany({
          where,
          include: includeTitulo,
          orderBy: q.status === 'pago' ? [{ pago_em: 'desc' }] : [{ vencimento: 'asc' }, { criado_em: 'asc' }],
          skip: (q.pagina - 1) * q.por_pagina,
          take: q.por_pagina,
        }),
        request.db.titulo.count({ where }),
        request.db.titulo.aggregate({
          where: { AND: [comPeriodo, filtroStatus.a_vencer] },
          _sum: { valor: true },
          _count: { _all: true },
        }),
        request.db.titulo.aggregate({
          where: { AND: [comPeriodo, filtroStatus.vencido] },
          _sum: { valor: true },
          _count: { _all: true },
        }),
        request.db.titulo.aggregate({
          where: { ...base, status: 'pago', pago_em: pagosIntervalo },
          _sum: { valor_pago: true },
          _count: { _all: true },
        }),
      ]);

      return {
        itens: itens.map((t) => serializarTitulo(t, hoje)),
        total,
        pagina: q.pagina,
        porPagina: q.por_pagina,
        totais: {
          a_vencer: { quantidade: aVencer._count._all, valor: moeda(aVencer._sum.valor) },
          vencidos: { quantidade: vencidos._count._all, valor: moeda(vencidos._sum.valor) },
          pagos_periodo: { quantidade: pagos._count._all, valor: moeda(pagos._sum.valor_pago) },
        },
      };
    },
  );

  app.get(
    '/titulos/:id',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { params: ParamsId } },
    async (request) => {
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const t = ou404(
        await request.db.titulo.findUnique({ where: { id: request.params.id }, include: includeTitulo }),
        'Título não encontrado.',
      );
      return serializarTitulo(t, hojeNoFuso(fuso));
    },
  );

  // ----------------------------------------------------------------------- criar (com parcelas)
  app.post(
    '/titulos',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        body: z.object({
          tipo: z.enum(['pagar', 'receber'], { error: 'Tipo inválido.' }),
          ...CamposTitulo,
          parcelas: z.number().int('Número de parcelas inválido.').min(1).max(48, 'Máximo de 48 parcelas.').default(1),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      await validarCategoria(db, b.categoria_id, b.tipo);
      await validarPaciente(db, b.paciente_id);
      await validarProfissional(db, b.profissional_id);
      if (b.parcelas > 1 && b.valor * 100 < b.parcelas) {
        throw new ErroNegocio(400, 'valor_insuficiente', 'O valor é pequeno demais para esse número de parcelas.');
      }

      const valores = dividirParcelas(b.valor, b.parcelas);
      const grupo = b.parcelas > 1 ? randomUUID() : null;
      const dia = Number(b.vencimento.slice(8, 10));
      const criados = await db.$transaction(async (tx) => {
        const lista = [];
        for (let i = 0; i < b.parcelas; i++) {
          lista.push(
            await tx.titulo.create({
              data: {
                tipo: b.tipo,
                descricao: b.descricao,
                valor: dec(valores[i]!),
                vencimento: dataSemHora(somarMeses(b.vencimento, i, dia)),
                categoria_id: b.categoria_id ?? null,
                paciente_id: b.paciente_id ?? null,
                profissional_id: b.profissional_id ?? null,
                fornecedor: b.fornecedor,
                forma_pagamento: b.forma_pagamento ?? null,
                observacoes: b.observacoes,
                parcela_numero: grupo ? i + 1 : null,
                parcela_total: grupo ? b.parcelas : null,
                grupo_parcelas_id: grupo,
                criado_por: request.usuarioClinica!.id,
              },
              include: includeTitulo,
            }),
          );
        }
        return lista;
      });
      reply.status(201);
      const hoje = hojeNoFuso(fuso);
      return criados.map((t) => serializarTitulo(t, hoje));
    },
  );

  // ----------------------------------------------------------------------- editar (só aberto)
  app.put(
    '/titulos/:id',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        params: ParamsId,
        body: z.object({
          descricao: CamposTitulo.descricao.optional(),
          valor: CamposTitulo.valor.optional(),
          vencimento: CamposTitulo.vencimento.optional(),
          categoria_id: CamposTitulo.categoria_id,
          paciente_id: CamposTitulo.paciente_id,
          profissional_id: CamposTitulo.profissional_id,
          fornecedor: zTextoOpcional(150).optional(),
          forma_pagamento: CamposTitulo.forma_pagamento,
          observacoes: zTextoOpcional(1000).optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const b = request.body;
      const db = request.db;
      const atual = ou404(await db.titulo.findUnique({ where: { id } }), 'Título não encontrado.');
      if (atual.status !== 'aberto') {
        throw new ErroNegocio(409, 'titulo_nao_aberto', 'Só é possível editar títulos em aberto.');
      }
      if (b.categoria_id !== undefined) await validarCategoria(db, b.categoria_id, atual.tipo);
      if (b.paciente_id !== undefined) await validarPaciente(db, b.paciente_id);
      if (b.profissional_id !== undefined) await validarProfissional(db, b.profissional_id);

      const r = await db.titulo.updateMany({
        where: { id, status: 'aberto' },
        data: {
          ...(b.descricao !== undefined ? { descricao: b.descricao } : {}),
          ...(b.valor !== undefined ? { valor: dec(b.valor) } : {}),
          ...(b.vencimento !== undefined ? { vencimento: dataSemHora(b.vencimento) } : {}),
          ...(b.categoria_id !== undefined ? { categoria_id: b.categoria_id } : {}),
          ...(b.paciente_id !== undefined ? { paciente_id: b.paciente_id } : {}),
          ...(b.profissional_id !== undefined ? { profissional_id: b.profissional_id } : {}),
          ...(b.fornecedor !== undefined ? { fornecedor: b.fornecedor } : {}),
          ...(b.forma_pagamento !== undefined ? { forma_pagamento: b.forma_pagamento } : {}),
          ...(b.observacoes !== undefined ? { observacoes: b.observacoes } : {}),
        },
      });
      if (r.count === 0) throw new ErroNegocio(409, 'titulo_nao_aberto', 'Só é possível editar títulos em aberto.');
      const fuso = await fusoDaClinica(db, request.clinicaId);
      const t = await db.titulo.findUniqueOrThrow({ where: { id }, include: includeTitulo });
      return serializarTitulo(t, hojeNoFuso(fuso));
    },
  );

  // ----------------------------------------------------------------------- baixa
  app.post(
    '/titulos/:id/baixa',
    {
      preHandler: exigirPapel('admin', 'recepcao'),
      schema: {
        params: ParamsId,
        body: z.object({
          data: zDataIso('Data do pagamento'),
          conta_financeira_id: zId('Conta'),
          forma_pagamento: zFormaPagamento,
          juros: zValorOuZero('Juros/multa').default(0),
          desconto: zValorOuZero('Desconto').default(0),
          valor_pago: zValor('Valor pago').optional(),
          descricao: zTextoOpcional(300),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const b = request.body;
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      assegurarNaoFutura(b.data, fuso, 'A data do pagamento');
      await validarConta(db, b.conta_financeira_id);
      const titulo = ou404(await db.titulo.findUnique({ where: { id } }), 'Título não encontrado.');
      if (titulo.status !== 'aberto') {
        throw new ErroNegocio(409, 'titulo_nao_aberto', 'Este título não está em aberto.');
      }
      const valorPago = b.valor_pago !== undefined ? dec(b.valor_pago) : titulo.valor.add(dec(b.juros)).sub(dec(b.desconto));
      if (valorPago.lte(0)) {
        throw new ErroNegocio(400, 'valor_invalido', 'O valor pago deve ser maior que zero.');
      }
      const parcela = titulo.parcela_total ? ` (${titulo.parcela_numero}/${titulo.parcela_total})` : '';

      const resultado = await db.$transaction(async (tx) => {
        const r = await tx.titulo.updateMany({
          where: { id, status: 'aberto' },
          data: { status: 'pago', pago_em: instanteDaData(b.data, fuso), valor_pago: valorPago, forma_pagamento: b.forma_pagamento },
        });
        if (r.count === 0) throw new ErroNegocio(409, 'titulo_nao_aberto', 'Este título não está em aberto.');
        const movimentacao = await tx.movimentacaoFinanceira.create({
          data: {
            tipo: titulo.tipo === 'pagar' ? 'saida' : 'entrada',
            origem: 'titulo',
            data: dataSemHora(b.data),
            valor: valorPago,
            conta_financeira_id: b.conta_financeira_id,
            categoria_id: titulo.categoria_id,
            forma_pagamento: b.forma_pagamento,
            descricao: b.descricao ?? `${titulo.descricao}${parcela}`,
            paciente_id: titulo.paciente_id,
            profissional_id: titulo.profissional_id,
            agendamento_id: titulo.agendamento_id,
            titulo_id: titulo.id,
            criado_por: request.usuarioClinica!.id,
          },
          include: includeMovimentacao,
        });
        const atualizado = await tx.titulo.findUniqueOrThrow({ where: { id }, include: includeTitulo });
        return { atualizado, movimentacao };
      });
      return {
        titulo: serializarTitulo(resultado.atualizado, hojeNoFuso(fuso)),
        movimentacao: serializarMovimentacao(resultado.movimentacao),
      };
    },
  );

  // ----------------------------------------------------------------------- cancelar
  app.post(
    '/titulos/:id/cancelar',
    { preHandler: exigirPapel('admin'), schema: { params: ParamsId } },
    async (request) => {
      const { id } = request.params;
      const db = request.db;
      ou404(await db.titulo.findUnique({ where: { id }, select: { id: true } }), 'Título não encontrado.');
      const r = await db.titulo.updateMany({
        where: { id, status: 'aberto' },
        data: { status: 'cancelado', cancelado_em: new Date() },
      });
      if (r.count === 0) throw new ErroNegocio(409, 'titulo_nao_aberto', 'Só é possível cancelar títulos em aberto.');
      const fuso = await fusoDaClinica(db, request.clinicaId);
      const t = await db.titulo.findUniqueOrThrow({ where: { id }, include: includeTitulo });
      return serializarTitulo(t, hojeNoFuso(fuso));
    },
  );
};

export default rotas;
