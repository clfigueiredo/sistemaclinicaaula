/**
 * Módulo retornos — "retorno em X dias" + convite pelo WhatsApp + lista para a equipe.
 *
 * Contrato: docs/FASE2.md §5. Recurso do plano: `retorno_automatico`. Tabelas: retornos,
 * configuracoes_clinica (retorno_convite_ativo, retorno_dias_antecedencia). Lógica compartilhada com o job
 * diário em ./servico.ts (workers/retornos.ts).
 *
 * Rotas (prefixo "/retornos"; autenticarClinica + exigirRecurso('retorno_automatico')):
 *   GET   /retornos?status&inicio&fim&profissional_id&paciente_id&pagina&por_pagina
 *           todos (profissional: só os da própria agenda). status: pendente|lembrado|agendado|cancelado|
 *           abertos (pendente+lembrado)|vencidos (abertos com data prevista < hoje). Datas = data_prevista.
 *           ⇒ Paginado<Retorno> (+ paciente, profissional, agendamento_origem, agendamento_retorno, vencido)
 *   GET   /retornos/agendamento/:agendamentoId     todos   retorno do agendamento de origem (ou null)
 *   POST  /retornos                                todos   { agendamento_origem_id, dias? (1–730) | data_prevista?, observacao? }
 *           201. 409 `status_invalido` (origem ≠ compareceu/atendido), 409 `retorno_existente`.
 *   PUT   /retornos/:id                            todos   { dias? | data_prevista?, observacao? } (só pendente/lembrado;
 *           mudar a data zera o convite e volta a `pendente`)
 *   PATCH /retornos/:id/status                     todos   { status: 'agendado' | 'cancelado' | 'pendente', agendamento_retorno_id? }
 *           agendado: agendamento do MESMO paciente E do MESMO profissional, não cancelado, posterior à origem.
 *           pendente: reabre um retorno cancelado/agendado (remove o vínculo).
 *   POST  /retornos/:id/convidar                   admin, recepção   convite agora pelo WhatsApp ⇒ { retorno, whatsapp }
 *   GET   /retornos/configuracao                   admin   { convite_ativo, dias_antecedencia }
 *   PUT   /retornos/configuracao                   admin   { convite_ativo?, dias_antecedencia? (0–60) }
 *
 * Regras: profissional só atua em retornos/agendamentos da própria agenda (403 `retorno_de_outro_profissional`).
 * data_prevista = dia local da origem + dias (fuso da clínica), gravada como @db.Date ('YYYY-MM-DD' na API).
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma, StatusRetorno } from '@prisma/client';
import { z } from 'zod';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';
import { atualizarConfiguracaoClinica, obterConfiguracaoClinica } from '../../servicos/configuracaoClinica';
import { dataSemHora, hojeNoFuso } from '../../servicos/financeiroComum';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';
import { obterFuso } from '../agendamentos/servico';
import { calcularDataPrevista, enfileirarConvite, serializarRetorno, STATUS_ABERTOS } from './servico';

export const prefixo = '/retornos';

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)');
const ParamsId = z.object({ id: z.uuid('Retorno inválido') });

const Filtros = z.object({
  status: z.enum(['pendente', 'lembrado', 'agendado', 'cancelado', 'abertos', 'vencidos'], 'Status inválido').optional(),
  inicio: DATA.optional(),
  fim: DATA.optional(),
  profissional_id: z.uuid('Profissional inválido').optional(),
  paciente_id: z.uuid('Paciente inválido').optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(20),
});

const CorpoCriar = z
  .object({
    agendamento_origem_id: z.uuid('Agendamento inválido'),
    dias: z.number().int('Informe um número inteiro de dias').min(1, 'Mínimo de 1 dia').max(730, 'Máximo de 730 dias').optional(),
    data_prevista: DATA.optional(),
    observacao: z.string().trim().max(1000, 'Observação muito longa').nullish(),
  })
  .refine((c) => c.dias !== undefined || c.data_prevista !== undefined, {
    message: 'Informe em quantos dias ou a data prevista do retorno.',
    path: ['dias'],
  });

const CorpoEditar = z.object({
  dias: z.number().int().min(1, 'Mínimo de 1 dia').max(730, 'Máximo de 730 dias').optional(),
  data_prevista: DATA.optional(),
  observacao: z.string().trim().max(1000, 'Observação muito longa').nullish(),
});

const CorpoStatus = z.object({
  status: z.enum(['agendado', 'cancelado', 'pendente'], 'Status inválido'),
  agendamento_retorno_id: z.uuid('Agendamento inválido').nullish(),
});

const CorpoConfig = z.object({
  convite_ativo: z.boolean().optional(),
  dias_antecedencia: z.number().int().min(0, 'Mínimo de 0 dias').max(60, 'Máximo de 60 dias').optional(),
});

const INCLUDE_RETORNO = {
  paciente: { select: { id: true, nome: true, telefone: true, whatsapp: true, aceita_whatsapp: true } },
  profissional: { select: { id: true, nome: true, cor_agenda: true } },
  agendamento_origem: { select: { id: true, inicio: true, status: true } },
  agendamento_retorno: { select: { id: true, inicio: true, status: true } },
} as const;

/** profissional_id obrigatório para o papel profissional (null para admin/recepção). */
function profissionalDoUsuario(request: FastifyRequest): string | null {
  const u = request.usuarioClinica!;
  if (u.papel !== 'profissional') return null;
  if (!u.profissionalId) {
    throw new ErroNegocio(
      403,
      'sem_profissional_vinculado',
      'Seu usuário não está vinculado a um profissional. Fale com o administrador da clínica.',
    );
  }
  return u.profissionalId;
}

function assegurarDoProfissional(request: FastifyRequest, profissionalId: string) {
  const proprio = profissionalDoUsuario(request);
  if (proprio && proprio !== profissionalId) {
    throw new ErroNegocio(403, 'retorno_de_outro_profissional', 'Você só pode gerenciar retornos da sua própria agenda.');
  }
}

async function contexto(request: FastifyRequest) {
  const fuso = await obterFuso(request.db, request.clinicaId!);
  return { fuso, hoje: hojeNoFuso(fuso) };
}

async function buscarRetorno(request: FastifyRequest, id: string) {
  const retorno = ou404(
    await request.db.retorno.findUnique({ where: { id }, include: INCLUDE_RETORNO }),
    'Retorno não encontrado.',
  );
  assegurarDoProfissional(request, retorno.profissional_id);
  return retorno;
}

function validarDataPrevista(data: Date, origemInicio: Date, fuso: string) {
  if (data.getTime() <= calcularDataPrevista(origemInicio, fuso, 0).getTime()) {
    throw erros.invalido('A data do retorno precisa ser posterior à data da consulta.', 'data_invalida');
  }
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('retorno_automatico'));

  // ------------------------------------------------------------------ configuração (admin)
  app.get('/configuracao', { preHandler: exigirPapel('admin') }, async (request) => {
    const cfg = await obterConfiguracaoClinica(request.db);
    return { convite_ativo: cfg.retorno_convite_ativo, dias_antecedencia: cfg.retorno_dias_antecedencia };
  });

  app.put('/configuracao', { preHandler: exigirPapel('admin'), schema: { body: CorpoConfig } }, async (request) => {
    const { convite_ativo, dias_antecedencia } = request.body;
    const cfg = await atualizarConfiguracaoClinica(request.db, {
      ...(convite_ativo !== undefined && { retorno_convite_ativo: convite_ativo }),
      ...(dias_antecedencia !== undefined && { retorno_dias_antecedencia: dias_antecedencia }),
    });
    return { convite_ativo: cfg.retorno_convite_ativo, dias_antecedencia: cfg.retorno_dias_antecedencia };
  });

  // ------------------------------------------------------------------ lista
  app.get('/', { schema: { querystring: Filtros } }, async (request) => {
    const f = request.query;
    const { hoje } = await contexto(request);
    const proprio = profissionalDoUsuario(request);

    const dataPrevista: Prisma.DateTimeFilter = {};
    if (f.inicio) dataPrevista.gte = dataSemHora(f.inicio);
    if (f.fim) dataPrevista.lte = dataSemHora(f.fim);
    let status: Prisma.RetornoWhereInput['status'];
    if (f.status === 'abertos') status = { in: STATUS_ABERTOS };
    else if (f.status === 'vencidos') {
      status = { in: STATUS_ABERTOS };
      const ontem = new Date(dataSemHora(hoje).getTime() - 86_400_000);
      dataPrevista.lte = dataPrevista.lte && dataPrevista.lte < ontem ? dataPrevista.lte : ontem;
    } else if (f.status) status = f.status as StatusRetorno;

    const where: Prisma.RetornoWhereInput = {
      ...(status && { status }),
      ...(Object.keys(dataPrevista).length && { data_prevista: dataPrevista }),
      ...(proprio ? { profissional_id: proprio } : f.profissional_id ? { profissional_id: f.profissional_id } : {}),
      ...(f.paciente_id && { paciente_id: f.paciente_id }),
    };
    const [itens, total] = await Promise.all([
      request.db.retorno.findMany({
        where,
        include: INCLUDE_RETORNO,
        orderBy: [{ data_prevista: 'asc' }, { criado_em: 'asc' }],
        skip: (f.pagina - 1) * f.por_pagina,
        take: f.por_pagina,
      }),
      request.db.retorno.count({ where }),
    ]);
    return { itens: itens.map((r) => serializarRetorno(r, hoje)), total, pagina: f.pagina, porPagina: f.por_pagina };
  });

  // ------------------------------------------------------------------ retorno de um agendamento de origem
  app.get(
    '/agendamento/:agendamentoId',
    { schema: { params: z.object({ agendamentoId: z.uuid('Agendamento inválido') }) } },
    async (request, reply) => {
      const agendamento = ou404(
        await request.db.agendamento.findUnique({
          where: { id: request.params.agendamentoId },
          select: { id: true, profissional_id: true },
        }),
        'Agendamento não encontrado.',
      );
      assegurarDoProfissional(request, agendamento.profissional_id);
      const retorno = await request.db.retorno.findUnique({
        where: { agendamento_origem_id: agendamento.id },
        include: INCLUDE_RETORNO,
      });
      if (!retorno) return reply.type('application/json').send('null');
      return serializarRetorno(retorno, (await contexto(request)).hoje);
    },
  );

  // ------------------------------------------------------------------ criar
  app.post('/', { schema: { body: CorpoCriar } }, async (request, reply) => {
    const { agendamento_origem_id, dias, data_prevista, observacao } = request.body;
    const origem = ou404(
      await request.db.agendamento.findUnique({
        where: { id: agendamento_origem_id },
        select: { id: true, paciente_id: true, profissional_id: true, inicio: true, status: true },
      }),
      'Agendamento não encontrado.',
    );
    assegurarDoProfissional(request, origem.profissional_id);
    if (origem.status !== 'compareceu' && origem.status !== 'atendido') {
      throw erros.conflito(
        'O retorno só pode ser definido para consultas com status "Compareceu" ou "Atendido".',
        'status_invalido',
      );
    }
    if (await request.db.retorno.findUnique({ where: { agendamento_origem_id }, select: { id: true } })) {
      throw erros.conflito('Esta consulta já tem um retorno definido. Altere o existente.', 'retorno_existente');
    }
    const { fuso, hoje } = await contexto(request);
    const data = data_prevista ? dataSemHora(data_prevista) : calcularDataPrevista(origem.inicio, fuso, dias!);
    validarDataPrevista(data, origem.inicio, fuso);

    const retorno = await request.db.retorno.create({
      data: {
        paciente_id: origem.paciente_id,
        profissional_id: origem.profissional_id,
        agendamento_origem_id: origem.id,
        data_prevista: data,
        observacao: observacao || null,
        criado_por: request.usuarioClinica!.id,
      },
      include: INCLUDE_RETORNO,
    });
    return reply.status(201).send(serializarRetorno(retorno, hoje));
  });

  // ------------------------------------------------------------------ editar data/observação
  app.put('/:id', { schema: { params: ParamsId, body: CorpoEditar } }, async (request) => {
    const atual = await buscarRetorno(request, request.params.id);
    if (!STATUS_ABERTOS.includes(atual.status)) {
      throw erros.conflito('Só é possível alterar retornos pendentes ou convidados.', 'status_invalido');
    }
    const { dias, data_prevista, observacao } = request.body;
    const { fuso, hoje } = await contexto(request);
    const dados: Prisma.RetornoUpdateInput = {};
    if (dias !== undefined || data_prevista !== undefined) {
      const nova = data_prevista
        ? dataSemHora(data_prevista)
        : calcularDataPrevista(atual.agendamento_origem.inicio, fuso, dias!);
      validarDataPrevista(nova, atual.agendamento_origem.inicio, fuso);
      if (nova.getTime() !== atual.data_prevista.getTime()) {
        // Data nova ⇒ novo convite no momento certo.
        Object.assign(dados, { data_prevista: nova, status: 'pendente', convite_enviado_em: null });
      }
    }
    if (observacao !== undefined) dados.observacao = observacao || null;
    const retorno = await request.db.retorno.update({ where: { id: atual.id }, data: dados, include: INCLUDE_RETORNO });
    return serializarRetorno(retorno, hoje);
  });

  // ------------------------------------------------------------------ status
  app.patch('/:id/status', { schema: { params: ParamsId, body: CorpoStatus } }, async (request) => {
    const atual = await buscarRetorno(request, request.params.id);
    const { status, agendamento_retorno_id } = request.body;
    const { hoje } = await contexto(request);
    let dados: Prisma.RetornoUncheckedUpdateInput;

    if (status === 'agendado') {
      if (atual.status === 'cancelado') {
        throw erros.conflito('Retorno cancelado. Reabra-o antes de marcar como agendado.', 'status_invalido');
      }
      let vinculo: string | null = null;
      if (agendamento_retorno_id) {
        const ag = ou404(
          await request.db.agendamento.findFirst({
            // Mesmo paciente E mesmo profissional do retorno (não vincula agenda de outro profissional).
            where: { id: agendamento_retorno_id, paciente_id: atual.paciente_id, profissional_id: atual.profissional_id },
            select: { id: true, status: true, inicio: true },
          }),
          'Agendamento não encontrado para este paciente e profissional.',
        );
        if (ag.id === atual.agendamento_origem_id || ag.inicio <= atual.agendamento_origem.inicio) {
          throw erros.invalido('O agendamento do retorno precisa ser posterior à consulta de origem.', 'agendamento_invalido');
        }
        if (ag.status === 'cancelado' || ag.status === 'faltou') {
          throw erros.conflito('Este agendamento está cancelado ou com falta.', 'agendamento_invalido');
        }
        vinculo = ag.id;
      }
      dados = { status: 'agendado', agendamento_retorno_id: vinculo };
    } else if (status === 'cancelado') {
      if (atual.status === 'cancelado') throw erros.conflito('O retorno já está cancelado.', 'status_invalido');
      dados = { status: 'cancelado' };
    } else {
      if (STATUS_ABERTOS.includes(atual.status)) throw erros.conflito('O retorno já está em aberto.', 'status_invalido');
      dados = { status: atual.convite_enviado_em ? 'lembrado' : 'pendente', agendamento_retorno_id: null };
    }
    const retorno = await request.db.retorno.update({ where: { id: atual.id }, data: dados, include: INCLUDE_RETORNO });
    return serializarRetorno(retorno, hoje);
  });

  // ------------------------------------------------------------------ convite manual (WhatsApp)
  app.post(
    '/:id/convidar',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { params: ParamsId } },
    async (request) => {
      const atual = await buscarRetorno(request, request.params.id);
      if (!STATUS_ABERTOS.includes(atual.status)) {
        throw erros.conflito('Só é possível convidar retornos pendentes ou já convidados.', 'status_invalido');
      }
      const resultado = await enfileirarConvite(request.clinicaId!, atual);
      const whatsapp = resultado.enfileirada ? { enfileirada: true } : { enfileirada: false, erro: resultado.erro };
      let retorno = atual;
      if (resultado.enfileirada) {
        retorno = await request.db.retorno.update({
          where: { id: atual.id },
          data: { status: 'lembrado', convite_enviado_em: new Date() },
          include: INCLUDE_RETORNO,
        });
      }
      return { retorno: serializarRetorno(retorno, (await contexto(request)).hoje), whatsapp };
    },
  );
};

export default modulo;
