/**
 * Módulo lista-espera — pacientes aguardando vaga + sugestões quando um horário é liberado.
 *
 * Contrato completo: docs/FASE2.md §3. Recurso do plano: `lista_espera`. Tabela: lista_espera.
 *
 * Rotas (prefixo "/lista-espera"; autenticarClinica + exigirRecurso('lista_espera'); admin e recepção —
 * profissional recebe 403 em todo o módulo):
 *   GET   /lista-espera?status&profissional_id&paciente_id&pagina&por_pagina
 *            status padrão `aguardando` (`todos` = sem filtro). Mais antigos primeiro (ordem de entrada).
 *   POST  /lista-espera                  { paciente_id, profissional_id?, dias_semana?, turnos?, observacao? }
 *            409 `ja_na_lista` se o paciente já aguarda o mesmo profissional (ou "qualquer").
 *   PUT   /lista-espera/:id              idem (parcial)
 *   PATCH /lista-espera/:id/status       { status, agendamento_id? }
 *   GET   /lista-espera/sugestoes?agendamento_id | ?profissional_id&inicio[&fim]
 *            { agendamento, horario_livre, sugestoes } — itens compatíveis com o horário (agendamento precisa
 *            estar cancelado/faltou ⇒ senão 409 `agendamento_ativo`).
 *   GET   /lista-espera/vagas-recentes   cancelamentos dos últimos 7 dias, início futuro, horário ainda livre, ≥ 1 sugestão
 *   POST  /lista-espera/:id/oferecer     { agendamento_id } ⇒ WhatsApp `oferta_horario` (só com aceita_whatsapp)
 *
 * Regras:
 *   - Compatível: status aguardando; profissional nulo ou igual; dias_semana vazio ou contém o dia; turnos vazio ou
 *     contém o turno (manhã < 12h, tarde 12–18h, noite ≥ 18h, fuso da clínica). O paciente do próprio agendamento
 *     cancelado não é sugerido.
 *   - Oferta: paciente sem consentimento ⇒ { enfileirada: false, erro: 'sem_consentimento' } (nada é gravado);
 *     horário já ocupado/passado ⇒ 409 `horario_indisponivel`. `ultima_oferta_em` só quando enfileirada.
 *   - Agendar de fato é pela rota normal de agendamentos; depois PATCH status `agendado` + agendamento_id.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { addMinutes, subDays } from 'date-fns';
import { z } from 'zod';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';
import { enfileirarMensagem } from '../../servicos/whatsapp/envio';
import { textoOfertaHorario } from '../../servicos/whatsapp/mensagens';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';
import { obterFuso, STATUS_LIVRES } from '../agendamentos/servico';
import { buscarCompativeis, horarioLivre, selecaoItem } from './servico';

export const prefixo = '/lista-espera';

const STATUS = ['aguardando', 'agendado', 'removido'] as const;
const TURNOS = ['manha', 'tarde', 'noite'] as const;

const Id = z.object({ id: z.uuid('ID inválido.') });

const FiltroLista = z.object({
  status: z.enum([...STATUS, 'todos'], 'Status inválido.').default('aguardando'),
  profissional_id: z.uuid('Profissional inválido.').optional(),
  paciente_id: z.uuid('Paciente inválido.').optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(20),
});

const diasSemana = z
  .array(z.number().int().min(0, 'Dia da semana inválido.').max(6, 'Dia da semana inválido.'))
  .max(7)
  .transform((d) => [...new Set(d)].sort());
const turnos = z.array(z.enum(TURNOS, 'Turno inválido.')).max(3).transform((t) => [...new Set(t)]);
const observacao = z.string().trim().max(1000, 'Máximo de 1000 caracteres.').nullish();

const CorpoCriar = z.object({
  paciente_id: z.uuid('Selecione o paciente.'),
  profissional_id: z.uuid('Profissional inválido.').nullish(),
  dias_semana: diasSemana.optional(),
  turnos: turnos.optional(),
  observacao,
});

const CorpoEditar = z.object({
  profissional_id: z.uuid('Profissional inválido.').nullish(),
  dias_semana: diasSemana.optional(),
  turnos: turnos.optional(),
  observacao,
});

const CorpoStatus = z.object({
  status: z.enum(STATUS, 'Status inválido.'),
  agendamento_id: z.uuid('Agendamento inválido.').nullish(),
});

const data = (rotulo: string) =>
  z.coerce.date({ error: `${rotulo} inválido(a).` }).refine((d) => !Number.isNaN(d.getTime()), `${rotulo} inválido(a).`);

const FiltroSugestoes = z
  .object({
    agendamento_id: z.uuid('Agendamento inválido.').optional(),
    profissional_id: z.uuid('Profissional inválido.').optional(),
    inicio: data('Início').optional(),
    fim: data('Fim').optional(),
  })
  .refine((f) => f.agendamento_id || (f.profissional_id && f.inicio), {
    message: 'Informe o agendamento ou o profissional e o início.',
    path: ['agendamento_id'],
  });

const CorpoOferecer = z.object({ agendamento_id: z.uuid('Agendamento inválido.') });

// ----------------------------------------------------------------------------- helpers

async function validarProfissional(request: FastifyRequest, id: string | null | undefined) {
  if (!id) return null;
  const p = ou404(await request.db.profissional.findUnique({ where: { id } }), 'Profissional não encontrado.');
  if (!p.ativo) throw erros.invalido('Este profissional está inativo.', 'profissional_inativo');
  return p;
}

async function buscarItem(request: FastifyRequest, id: string) {
  return ou404(
    await request.db.listaEspera.findUnique({ where: { id }, select: selecaoItem }),
    'Item da lista de espera não encontrado.',
  );
}

async function assegurarSemDuplicado(
  request: FastifyRequest,
  pacienteId: string,
  profissionalId: string | null,
  ignorarId?: string,
) {
  const dup = await request.db.listaEspera.findFirst({
    where: {
      paciente_id: pacienteId,
      status: 'aguardando',
      profissional_id: profissionalId,
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { id: true },
  });
  if (dup) {
    throw new ErroNegocio(409, 'ja_na_lista', 'Este paciente já está na lista de espera para este profissional.', {
      item_id: dup.id,
    });
  }
}

/** Agendamento liberado (cancelado/faltou) cujo horário será oferecido. */
async function agendamentoLiberado(request: FastifyRequest, id: string) {
  const ag = ou404(
    await request.db.agendamento.findUnique({
      where: { id },
      select: {
        id: true,
        inicio: true,
        fim: true,
        status: true,
        paciente_id: true,
        profissional: { select: { id: true, nome: true } },
      },
    }),
    'Agendamento não encontrado.',
  );
  if (!STATUS_LIVRES.includes(ag.status)) {
    throw erros.conflito('Este agendamento não foi cancelado: o horário não está vago.', 'agendamento_ativo');
  }
  return ag;
}

// ----------------------------------------------------------------------------- rotas

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirPapel('admin', 'recepcao'));
  app.addHook('preHandler', exigirRecurso('lista_espera'));

  // --------------------------------------------------------------------- listar
  app.get('/', { schema: { querystring: FiltroLista } }, async (request) => {
    const q = request.query;
    const where: Prisma.ListaEsperaWhereInput = {
      ...(q.status !== 'todos' ? { status: q.status } : {}),
      ...(q.profissional_id ? { profissional_id: q.profissional_id } : {}),
      ...(q.paciente_id ? { paciente_id: q.paciente_id } : {}),
    };
    const [itens, total] = await Promise.all([
      request.db.listaEspera.findMany({
        where,
        select: selecaoItem,
        orderBy: q.status === 'aguardando' ? [{ criado_em: 'asc' }] : [{ atualizado_em: 'desc' }],
        skip: (q.pagina - 1) * q.por_pagina,
        take: q.por_pagina,
      }),
      request.db.listaEspera.count({ where }),
    ]);
    return { itens, total, pagina: q.pagina, porPagina: q.por_pagina };
  });

  // --------------------------------------------------------------------- criar
  app.post('/', { schema: { body: CorpoCriar } }, async (request, reply) => {
    const b = request.body;
    const paciente = ou404(await request.db.paciente.findUnique({ where: { id: b.paciente_id } }), 'Paciente não encontrado.');
    if (!paciente.ativo) throw erros.invalido('Este paciente está inativo.', 'paciente_inativo');
    const prof = await validarProfissional(request, b.profissional_id);
    await assegurarSemDuplicado(request, paciente.id, prof?.id ?? null);
    const item = await request.db.listaEspera.create({
      data: {
        paciente_id: paciente.id,
        profissional_id: prof?.id ?? null,
        dias_semana: b.dias_semana ?? [],
        turnos: b.turnos ?? [],
        observacao: b.observacao || null,
        criado_por: request.usuarioClinica!.id,
      },
      select: selecaoItem,
    });
    return reply.status(201).send(item);
  });

  // --------------------------------------------------------------------- sugestões (antes de /:id)
  app.get('/sugestoes', { schema: { querystring: FiltroSugestoes } }, async (request) => {
    const q = request.query;
    const fuso = await obterFuso(request.db, request.clinicaId);
    let base: {
      id: string | null;
      inicio: Date;
      fim: Date;
      paciente_id: string | null;
      profissional: { id: string; nome: string };
    };
    if (q.agendamento_id) {
      const ag = await agendamentoLiberado(request, q.agendamento_id);
      base = { id: ag.id, inicio: ag.inicio, fim: ag.fim, paciente_id: ag.paciente_id, profissional: ag.profissional };
    } else {
      const prof = ou404(
        await request.db.profissional.findUnique({ where: { id: q.profissional_id! }, select: { id: true, nome: true, duracao_consulta_min: true } }),
        'Profissional não encontrado.',
      );
      const inicio = q.inicio!;
      const fim = q.fim ?? addMinutes(inicio, prof.duracao_consulta_min);
      if (fim <= inicio) throw erros.invalido('O fim deve ser depois do início.');
      base = { id: null, inicio, fim, paciente_id: null, profissional: { id: prof.id, nome: prof.nome } };
    }
    const [livre, sugestoes] = await Promise.all([
      horarioLivre(request.db, { profissionalId: base.profissional.id, inicio: base.inicio, fim: base.fim }),
      buscarCompativeis(request.db, {
        profissionalId: base.profissional.id,
        inicio: base.inicio,
        fuso,
        ignorarPacienteId: base.paciente_id ?? undefined,
      }),
    ]);
    return {
      agendamento: { id: base.id, inicio: base.inicio, fim: base.fim, profissional: base.profissional },
      horario_livre: livre,
      sugestoes,
    };
  });

  // --------------------------------------------------------------------- vagas recentes (aviso no topo)
  app.get('/vagas-recentes', async (request) => {
    const agora = new Date();
    const fuso = await obterFuso(request.db, request.clinicaId);
    const cancelados = await request.db.agendamento.findMany({
      where: { status: 'cancelado', cancelado_em: { gte: subDays(agora, 7) }, inicio: { gt: agora } },
      select: { id: true, inicio: true, fim: true, paciente_id: true, profissional: { select: { id: true, nome: true } } },
      orderBy: { inicio: 'asc' },
      take: 50,
    });
    const itens: { agendamento_id: string; inicio: Date; profissional: { id: string; nome: string }; sugestoes: number }[] = [];
    const vistos = new Set<string>();
    for (const ag of cancelados) {
      const chave = `${ag.profissional.id}:${ag.inicio.getTime()}`;
      if (vistos.has(chave)) continue; // o mesmo horário cancelado mais de uma vez conta como uma vaga
      vistos.add(chave);
      if (!(await horarioLivre(request.db, { profissionalId: ag.profissional.id, inicio: ag.inicio, fim: ag.fim }))) continue;
      const n = (
        await buscarCompativeis(
          request.db,
          { profissionalId: ag.profissional.id, inicio: ag.inicio, fuso, ignorarPacienteId: ag.paciente_id },
          50,
        )
      ).length;
      if (n > 0) itens.push({ agendamento_id: ag.id, inicio: ag.inicio, profissional: ag.profissional, sugestoes: n });
    }
    return { total: itens.length, itens };
  });

  // --------------------------------------------------------------------- editar
  app.put('/:id', { schema: { params: Id, body: CorpoEditar } }, async (request) => {
    const b = request.body;
    const atual = await buscarItem(request, request.params.id);
    const dados: Prisma.ListaEsperaUncheckedUpdateInput = {};
    if (b.profissional_id !== undefined) {
      const novoId = b.profissional_id ?? null;
      if (novoId !== atual.profissional_id) {
        await validarProfissional(request, novoId);
        if (atual.status === 'aguardando') await assegurarSemDuplicado(request, atual.paciente_id, novoId, atual.id);
      }
      dados.profissional_id = novoId;
    }
    if (b.dias_semana !== undefined) dados.dias_semana = b.dias_semana;
    if (b.turnos !== undefined) dados.turnos = b.turnos;
    if (b.observacao !== undefined) dados.observacao = b.observacao || null;
    return request.db.listaEspera.update({ where: { id: atual.id }, data: dados, select: selecaoItem });
  });

  // --------------------------------------------------------------------- status
  app.patch('/:id/status', { schema: { params: Id, body: CorpoStatus } }, async (request) => {
    const { status, agendamento_id } = request.body;
    const atual = await buscarItem(request, request.params.id);
    const dados: Prisma.ListaEsperaUncheckedUpdateInput = { status };
    if (status === 'agendado') {
      if (agendamento_id) {
        const ag = ou404(
          await request.db.agendamento.findUnique({ where: { id: agendamento_id }, select: { id: true, paciente_id: true } }),
          'Agendamento não encontrado.',
        );
        if (ag.paciente_id !== atual.paciente_id) {
          throw erros.invalido('O agendamento informado é de outro paciente.', 'agendamento_outro_paciente');
        }
        dados.agendamento_id = ag.id;
      }
    } else if (status === 'aguardando') {
      if (atual.status === 'aguardando') return atual;
      await assegurarSemDuplicado(request, atual.paciente_id, atual.profissional_id, atual.id);
      dados.agendamento_id = null;
    }
    return request.db.listaEspera.update({ where: { id: atual.id }, data: dados, select: selecaoItem });
  });

  // --------------------------------------------------------------------- oferecer horário
  app.post('/:id/oferecer', { schema: { params: Id, body: CorpoOferecer } }, async (request) => {
    const item = await buscarItem(request, request.params.id);
    if (item.status !== 'aguardando') {
      throw erros.conflito('Só é possível oferecer horário a quem está aguardando.', 'status_invalido');
    }
    const ag = await agendamentoLiberado(request, request.body.agendamento_id);
    if (!(await horarioLivre(request.db, { profissionalId: ag.profissional.id, inicio: ag.inicio, fim: ag.fim }))) {
      throw new ErroNegocio(409, 'horario_indisponivel', 'Este horário já foi ocupado ou já passou.');
    }
    if (!item.paciente.aceita_whatsapp) {
      return { whatsapp: { enfileirada: false, erro: 'sem_consentimento' }, ultima_oferta_em: item.ultima_oferta_em };
    }
    const [clinica, fuso] = await Promise.all([
      request.db.clinica.findUnique({ where: { id: request.clinicaId }, select: { nome: true, telefone: true } }),
      obterFuso(request.db, request.clinicaId),
    ]);
    const r = await enfileirarMensagem({
      clinicaId: request.clinicaId,
      pacienteId: item.paciente.id,
      agendamentoId: ag.id,
      tipo: 'oferta_horario',
      conteudo: textoOfertaHorario({
        paciente: item.paciente.nome,
        clinica: clinica?.nome ?? '',
        profissional: ag.profissional.nome,
        inicio: ag.inicio,
        fuso,
        telefoneClinica: clinica?.telefone ?? null,
      }),
    });
    if (!r.enfileirada) {
      return { whatsapp: { enfileirada: false, erro: r.erro }, ultima_oferta_em: item.ultima_oferta_em };
    }
    const atualizado = await request.db.listaEspera.update({
      where: { id: item.id },
      data: { ultima_oferta_em: new Date() },
      select: { ultima_oferta_em: true },
    });
    return { whatsapp: { enfileirada: true }, ultima_oferta_em: atualizado.ultima_oferta_em };
  });
};

export default modulo;
