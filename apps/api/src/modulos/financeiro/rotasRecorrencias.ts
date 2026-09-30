/**
 * Recorrências (admin): modelos mensais que geram títulos. Criar gera o título do mês corrente (se o
 * vencimento ainda não passou) e do próximo; o job diário garante o do próximo mês (idempotente).
 * Encerrar (ativo=false) não apaga títulos já gerados. Mudanças valem para os títulos gerados depois.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma, Recorrencia } from '@prisma/client';
import { z } from 'zod';
import { exigirPapel } from '../../plugins/auth';
import { ErroNegocio, ou404 } from '../../utils/erros';
import {
  ParamsId,
  dataSemHora,
  dec,
  fusoDaClinica,
  hojeNoFuso,
  moeda,
  paraDataIso,
  validarCategoria,
  validarPaciente,
  validarProfissional,
  zDataIso,
  zFormaPagamento,
  zId,
  zTextoOpcional,
  zValor,
} from './comum';
import { gerarTitulosRecorrencia, includeTitulo, serializarTitulo } from './servico';

const includeRecorrencia = {
  categoria: { select: { id: true, nome: true, tipo: true } },
  paciente: { select: { id: true, nome: true } },
  profissional: { select: { id: true, nome: true } },
} satisfies Prisma.RecorrenciaInclude;

type RecorrenciaCompleta = Prisma.RecorrenciaGetPayload<{ include: typeof includeRecorrencia }>;

function serializar(r: RecorrenciaCompleta, contagem?: { abertos: number; total: number }) {
  return {
    id: r.id,
    tipo: r.tipo,
    descricao: r.descricao,
    valor: moeda(r.valor),
    dia_vencimento: r.dia_vencimento,
    frequencia: r.frequencia,
    inicio: paraDataIso(r.inicio),
    fim: r.fim ? paraDataIso(r.fim) : null,
    ativo: r.ativo,
    categoria_id: r.categoria_id,
    paciente_id: r.paciente_id,
    profissional_id: r.profissional_id,
    fornecedor: r.fornecedor,
    forma_pagamento: r.forma_pagamento,
    ultima_competencia: r.ultima_competencia ? paraDataIso(r.ultima_competencia) : null,
    criado_em: r.criado_em,
    categoria: r.categoria,
    paciente: r.paciente,
    profissional: r.profissional,
    titulos_abertos: contagem?.abertos ?? 0,
    titulos_gerados: contagem?.total ?? 0,
  };
}

const zDia = z.number({ error: 'Informe o dia do vencimento.' }).int().min(1, 'Dia entre 1 e 31.').max(31, 'Dia entre 1 e 31.');

const rotas: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/recorrencias',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        querystring: z.object({
          tipo: z.enum(['pagar', 'receber']).optional(),
          ativo: z
            .enum(['true', 'false'])
            .optional()
            .transform((v) => (v === undefined ? undefined : v === 'true')),
        }),
      },
    },
    async (request) => {
      const { tipo, ativo } = request.query;
      const lista = await request.db.recorrencia.findMany({
        where: { ...(tipo ? { tipo } : {}), ...(ativo !== undefined ? { ativo } : {}) },
        include: includeRecorrencia,
        orderBy: [{ ativo: 'desc' }, { descricao: 'asc' }],
      });
      const grupos = lista.length
        ? await request.db.titulo.groupBy({
            by: ['recorrencia_id', 'status'],
            where: { recorrencia_id: { in: lista.map((r) => r.id) } },
            _count: { _all: true },
          })
        : [];
      return lista.map((r) => {
        const g = grupos.filter((x) => x.recorrencia_id === r.id);
        return serializar(r, {
          abertos: g.filter((x) => x.status === 'aberto').reduce((s, x) => s + x._count._all, 0),
          total: g.reduce((s, x) => s + x._count._all, 0),
        });
      });
    },
  );

  app.post(
    '/recorrencias',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        body: z.object({
          tipo: z.enum(['pagar', 'receber'], { error: 'Tipo inválido.' }),
          descricao: z.string({ error: 'Informe a descrição.' }).trim().min(2, 'Mínimo de 2 caracteres.').max(200),
          valor: zValor(),
          dia_vencimento: zDia,
          inicio: zDataIso('Início').optional(),
          fim: zDataIso('Fim').nullish(),
          categoria_id: zId('Categoria').nullish(),
          paciente_id: zId('Paciente').nullish(),
          profissional_id: zId('Profissional').nullish(),
          fornecedor: zTextoOpcional(150),
          forma_pagamento: zFormaPagamento.nullish(),
          ativo: z.boolean().default(true),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      const hoje = hojeNoFuso(fuso);
      const inicio = b.inicio ?? hoje;
      if (b.fim && b.fim < inicio) {
        throw new ErroNegocio(400, 'periodo_invalido', 'O fim deve ser igual ou posterior ao início.');
      }
      await validarCategoria(db, b.categoria_id, b.tipo);
      await validarPaciente(db, b.paciente_id);
      await validarProfissional(db, b.profissional_id);

      const rec = await db.recorrencia.create({
        data: {
          tipo: b.tipo,
          descricao: b.descricao,
          valor: dec(b.valor),
          dia_vencimento: b.dia_vencimento,
          inicio: dataSemHora(inicio),
          fim: b.fim ? dataSemHora(b.fim) : null,
          ativo: b.ativo,
          categoria_id: b.categoria_id ?? null,
          paciente_id: b.paciente_id ?? null,
          profissional_id: b.profissional_id ?? null,
          fornecedor: b.fornecedor,
          forma_pagamento: b.forma_pagamento ?? null,
          criado_por: request.usuarioClinica!.id,
        },
      });
      await gerarTitulosRecorrencia(db, rec, hoje, request.usuarioClinica!.id);
      const [completa, titulos] = await Promise.all([
        db.recorrencia.findUniqueOrThrow({ where: { id: rec.id }, include: includeRecorrencia }),
        db.titulo.findMany({ where: { recorrencia_id: rec.id }, include: includeTitulo, orderBy: { vencimento: 'asc' } }),
      ]);
      reply.status(201);
      return {
        ...serializar(completa, { abertos: titulos.length, total: titulos.length }),
        titulos: titulos.map((t) => serializarTitulo(t, hoje)),
      };
    },
  );

  app.put(
    '/recorrencias/:id',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        params: ParamsId,
        body: z.object({
          descricao: z.string().trim().min(2, 'Mínimo de 2 caracteres.').max(200).optional(),
          valor: zValor().optional(),
          dia_vencimento: zDia.optional(),
          fim: zDataIso('Fim').nullish(),
          categoria_id: zId('Categoria').nullish(),
          paciente_id: zId('Paciente').nullish(),
          profissional_id: zId('Profissional').nullish(),
          fornecedor: zTextoOpcional(150).optional(),
          forma_pagamento: zFormaPagamento.nullish(),
          ativo: z.boolean().optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const b = request.body;
      const db = request.db;
      const atual: Recorrencia = ou404(await db.recorrencia.findUnique({ where: { id } }), 'Recorrência não encontrada.');
      if (b.fim && b.fim < paraDataIso(atual.inicio)) {
        throw new ErroNegocio(400, 'periodo_invalido', 'O fim deve ser igual ou posterior ao início.');
      }
      if (b.categoria_id !== undefined) await validarCategoria(db, b.categoria_id, atual.tipo);
      if (b.paciente_id !== undefined) await validarPaciente(db, b.paciente_id);
      if (b.profissional_id !== undefined) await validarProfissional(db, b.profissional_id);

      const rec = await db.recorrencia.update({
        where: { id },
        data: {
          ...(b.descricao !== undefined ? { descricao: b.descricao } : {}),
          ...(b.valor !== undefined ? { valor: dec(b.valor) } : {}),
          ...(b.dia_vencimento !== undefined ? { dia_vencimento: b.dia_vencimento } : {}),
          ...(b.fim !== undefined ? { fim: b.fim ? dataSemHora(b.fim) : null } : {}),
          ...(b.categoria_id !== undefined ? { categoria_id: b.categoria_id } : {}),
          ...(b.paciente_id !== undefined ? { paciente_id: b.paciente_id } : {}),
          ...(b.profissional_id !== undefined ? { profissional_id: b.profissional_id } : {}),
          ...(b.fornecedor !== undefined ? { fornecedor: b.fornecedor } : {}),
          ...(b.forma_pagamento !== undefined ? { forma_pagamento: b.forma_pagamento } : {}),
          ...(b.ativo !== undefined ? { ativo: b.ativo } : {}),
        },
      });
      const fuso = await fusoDaClinica(db, request.clinicaId);
      // Reativada (ou ainda ativa): garante os títulos do mês corrente/próximo que faltarem.
      if (rec.ativo) await gerarTitulosRecorrencia(db, rec, hojeNoFuso(fuso), request.usuarioClinica!.id);
      const [completa, grupos] = await Promise.all([
        db.recorrencia.findUniqueOrThrow({ where: { id }, include: includeRecorrencia }),
        db.titulo.groupBy({ by: ['status'], where: { recorrencia_id: id }, _count: { _all: true } }),
      ]);
      return serializar(completa, {
        abertos: grupos.find((g) => g.status === 'aberto')?._count._all ?? 0,
        total: grupos.reduce((s, g) => s + g._count._all, 0),
      });
    },
  );
};

export default rotas;
