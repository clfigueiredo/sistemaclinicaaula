/**
 * Módulo agendamentos — Agenda.
 *
 * Rotas (prefixo "/agendamentos"; todas exigem token de clínica):
 *   GET    /agendamentos?inicio&fim&profissionalId&pacienteId
 *            Lista com paciente{id,nome,telefone,whatsapp}, profissional{id,nome,cor_agenda}, convenio{id,nome}.
 *            Exige `inicio`+`fim` (máx. 62 dias) OU `pacienteId` (histórico, mais recentes primeiro).
 *            Papel `profissional`: sempre só a própria agenda (profissionalId do usuário).
 *   GET    /agendamentos/disponibilidade?profissionalId&data=YYYY-MM-DD[&duracao][&ignorarId]
 *            Horários livres (grade − bloqueios − ocupados − passado).
 *   GET    /agendamentos/profissionais       profissionais ativos visíveis na agenda (profissional: só ele)
 *   GET    /agendamentos/bloqueios?inicio&fim[&profissionalId]   bloqueios do período (para exibir)
 *   GET    /agendamentos/:id
 *   POST   /agendamentos            admin, recepção; profissional só na própria agenda.
 *            Consome max_agendamentos (assegurarLimite com tx, na mesma transação do conflito).
 *   PUT    /agendamentos/:id        editar/remarcar (mesmas validações; não consome limite)
 *   PATCH  /agendamentos/:id/status { status, motivo? }
 *            agendado → confirmado|compareceu|cancelado|faltou; confirmado → compareceu|cancelado|faltou;
 *            compareceu → atendido. Demais ⇒ 409 transicao_invalida. Cancelar grava
 *            `motivo_cancelamento` e `cancelado_em`.
 *   Sem DELETE: cancelar é o caminho.
 *
 * Decisões:
 *   - Datas em UTC no banco; grade/dia da semana/"passado" avaliados no fuso da clínica (clinicas.fuso_horario).
 *   - Início no passado ou fora da grade ⇒ 400, exceto com `encaixe: true` (só admin). Bloqueio,
 *     sobreposição e profissional inativo NUNCA são ignorados.
 *   - Cancelado e faltou liberam o horário.
 *   - Remarcar (mudar início/fim/profissional) só em agendado/confirmado; volta o status para
 *     `agendado` e zera `lembrete_enviado_em` (a confirmação era para o horário antigo).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import type { Prisma, StatusAgendamento } from '@prisma/client';
import { z } from 'zod';
import { addMinutes, differenceInCalendarDays } from 'date-fns';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { assegurarLimite } from '../../plugins/recursos';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';
import {
  STATUS_REMARCAVEIS,
  TRANSICOES,
  buscarBloqueios,
  calcularDisponibilidade,
  obterFuso,
  travarAgendaProfissional,
  validarBloqueio,
  validarConflito,
  validarGrade,
  type ClienteAgenda,
} from './servico';

export const prefixo = '/agendamentos';

const MAX_DIAS_INTERVALO = 62;
const STATUS = ['agendado', 'confirmado', 'compareceu', 'atendido', 'cancelado', 'faltou'] as const;

// ----------------------------------------------------------------------------- esquemas

const data = (rotulo: string) =>
  z.coerce.date({ error: `${rotulo} inválido(a).` }).refine((d) => !Number.isNaN(d.getTime()), `${rotulo} inválido(a).`);

const Id = z.object({ id: z.uuid('ID inválido.') });

const FiltroLista = z
  .object({
    inicio: data('Início').optional(),
    fim: data('Fim').optional(),
    profissionalId: z.uuid('Profissional inválido.').optional(),
    pacienteId: z.uuid('Paciente inválido.').optional(),
  })
  .refine((f) => f.pacienteId || (f.inicio && f.fim), {
    message: 'Informe o período (inicio e fim) ou o paciente.',
    path: ['inicio'],
  })
  .refine((f) => !f.inicio || !f.fim || f.fim > f.inicio, { message: 'O fim deve ser depois do início.', path: ['fim'] })
  .refine((f) => !f.inicio || !f.fim || differenceInCalendarDays(f.fim, f.inicio) <= MAX_DIAS_INTERVALO, {
    message: `O período máximo é de ${MAX_DIAS_INTERVALO} dias.`,
    path: ['fim'],
  });

const FiltroDisponibilidade = z.object({
  profissionalId: z.uuid('Profissional inválido.'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD.'),
  duracao: z.coerce.number().int().min(5).max(480).optional(),
  ignorarId: z.uuid().optional(),
});

const FiltroBloqueios = z.object({
  inicio: data('Início'),
  fim: data('Fim'),
  profissionalId: z.uuid('Profissional inválido.').optional(),
});

const observacoes = z.string().trim().max(2000, 'Máximo de 2000 caracteres.').nullish();

const CorpoCriar = z.object({
  paciente_id: z.uuid('Selecione o paciente.'),
  profissional_id: z.uuid('Selecione o profissional.'),
  inicio: data('Início'),
  fim: data('Fim').optional(),
  tipo: z.enum(['particular', 'convenio']).default('particular'),
  convenio_id: z.uuid('Convênio inválido.').nullish(),
  observacoes,
  /** Só admin: permite início no passado e fora da grade (bloqueio e conflito continuam valendo). */
  encaixe: z.boolean().optional(),
});

const CorpoEditar = z.object({
  paciente_id: z.uuid('Selecione o paciente.').optional(),
  profissional_id: z.uuid('Selecione o profissional.').optional(),
  inicio: data('Início').optional(),
  fim: data('Fim').optional(),
  tipo: z.enum(['particular', 'convenio']).optional(),
  convenio_id: z.uuid('Convênio inválido.').nullish(),
  observacoes,
  encaixe: z.boolean().optional(),
});

const CorpoStatus = z.object({
  status: z.enum(STATUS, 'Status inválido.'),
  motivo: z.string().trim().max(500, 'Máximo de 500 caracteres.').optional(),
});

// ----------------------------------------------------------------------------- helpers

const selecaoAgendamento = {
  id: true,
  paciente_id: true,
  profissional_id: true,
  convenio_id: true,
  inicio: true,
  fim: true,
  tipo: true,
  status: true,
  observacoes: true,
  motivo_cancelamento: true,
  cancelado_em: true,
  criado_por: true,
  lembrete_enviado_em: true,
  criado_em: true,
  atualizado_em: true,
  paciente: { select: { id: true, nome: true, telefone: true, whatsapp: true } },
  profissional: { select: { id: true, nome: true, cor_agenda: true } },
  convenio: { select: { id: true, nome: true } },
} satisfies Prisma.AgendamentoSelect;

/** Profissional (papel) só enxerga/age na própria agenda. Retorna o profissionalId forçado ou undefined. */
function profissionalForcado(request: FastifyRequest): string | undefined {
  const u = request.usuarioClinica!;
  if (u.papel !== 'profissional') return undefined;
  if (!u.profissionalId) {
    throw erros.proibido('Seu usuário não está vinculado a um profissional. Fale com o administrador.');
  }
  return u.profissionalId;
}

function exigirMesmaAgenda(request: FastifyRequest, profissionalId: string) {
  const forcado = profissionalForcado(request);
  if (forcado && forcado !== profissionalId) {
    throw erros.proibido('Você só pode gerenciar a sua própria agenda.');
  }
}

async function buscarVisivel(request: FastifyRequest, id: string) {
  const ag = ou404(
    await request.db.agendamento.findUnique({ where: { id }, select: selecaoAgendamento }),
    'Agendamento não encontrado.',
  );
  const forcado = profissionalForcado(request);
  if (forcado && ag.profissional_id !== forcado) throw erros.naoEncontrado('Agendamento não encontrado.');
  return ag;
}

async function validarConvenio(request: FastifyRequest, tipo: 'particular' | 'convenio', convenioId?: string | null) {
  if (tipo === 'particular') return null;
  if (!convenioId) throw erros.invalido('Selecione o convênio para agendamentos por convênio.', 'convenio_obrigatorio');
  const conv = ou404(await request.db.convenio.findUnique({ where: { id: convenioId } }), 'Convênio não encontrado.');
  if (!conv.ativo) throw erros.invalido('Este convênio está inativo.', 'convenio_inativo');
  return conv.id;
}

async function validarProfissional(request: FastifyRequest, profissionalId: string) {
  const prof = ou404(
    await request.db.profissional.findUnique({ where: { id: profissionalId } }),
    'Profissional não encontrado.',
  );
  if (!prof.ativo) throw erros.invalido('Este profissional está inativo.', 'profissional_inativo');
  return prof;
}

function validarEncaixe(request: FastifyRequest, encaixe?: boolean) {
  if (encaixe && request.usuarioClinica!.papel !== 'admin') {
    throw erros.proibido('Somente o administrador pode fazer encaixe fora da grade ou no passado.');
  }
  return !!encaixe;
}

/** Validações de horário comuns a criar e remarcar (executar dentro da transação, após a trava). */
async function validarHorario(
  tx: ClienteAgenda,
  a: { profissionalId: string; inicio: Date; fim: Date; fuso: string; encaixe: boolean; ignorarId?: string },
) {
  if (a.fim <= a.inicio) throw erros.invalido('O fim deve ser depois do início.', 'intervalo_invalido');
  if (a.fim.getTime() - a.inicio.getTime() > 12 * 3_600_000) {
    throw erros.invalido('A duração máxima de um agendamento é de 12 horas.', 'intervalo_invalido');
  }
  if (!a.encaixe) {
    if (a.inicio.getTime() < Date.now() - 60_000) {
      throw new ErroNegocio(400, 'horario_passado', 'Não é possível agendar em um horário que já passou.');
    }
    await validarGrade(tx, a.profissionalId, a.inicio, a.fim, a.fuso);
  }
  await validarBloqueio(tx, a.profissionalId, a.inicio, a.fim);
  await validarConflito(tx, a.profissionalId, a.inicio, a.fim, a.ignorarId);
}

// ----------------------------------------------------------------------------- rotas

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);

  // --------------------------------------------------------------------- listar
  app.get('/', { schema: { querystring: FiltroLista } }, async (request) => {
    const { inicio, fim, pacienteId } = request.query;
    const profissionalId = profissionalForcado(request) ?? request.query.profissionalId;
    const porPeriodo = !!(inicio && fim);
    return request.db.agendamento.findMany({
      where: {
        ...(porPeriodo ? { inicio: { lt: fim }, fim: { gt: inicio } } : {}),
        ...(profissionalId ? { profissional_id: profissionalId } : {}),
        ...(pacienteId ? { paciente_id: pacienteId } : {}),
      },
      select: selecaoAgendamento,
      orderBy: { inicio: porPeriodo ? 'asc' : 'desc' },
      take: porPeriodo ? 5000 : 500,
    });
  });

  // --------------------------------------------------------------------- disponibilidade
  app.get('/disponibilidade', { schema: { querystring: FiltroDisponibilidade } }, async (request) => {
    const q = request.query;
    exigirMesmaAgenda(request, q.profissionalId);
    const prof = ou404(
      await request.db.profissional.findUnique({ where: { id: q.profissionalId } }),
      'Profissional não encontrado.',
    );
    const fuso = await obterFuso(request.db, request.clinicaId);
    const duracao = q.duracao ?? prof.duracao_consulta_min;
    const horarios = prof.ativo
      ? await calcularDisponibilidade(request.db, {
          profissionalId: prof.id,
          dia: q.data,
          duracaoMin: duracao,
          fuso,
          ignorarId: q.ignorarId,
        })
      : [];
    return { profissional_id: prof.id, data: q.data, duracao_min: duracao, fuso, horarios };
  });

  // --------------------------------------------------------------------- apoio à tela da agenda
  app.get('/profissionais', async (request) => {
    const forcado = profissionalForcado(request);
    return request.db.profissional.findMany({
      where: { ativo: true, ...(forcado ? { id: forcado } : {}) },
      select: {
        id: true,
        nome: true,
        especialidade: true,
        registro: true,
        duracao_consulta_min: true,
        cor_agenda: true,
        ativo: true,
      },
      orderBy: { nome: 'asc' },
    });
  });

  app.get('/bloqueios', { schema: { querystring: FiltroBloqueios } }, async (request) => {
    const { inicio, fim } = request.query;
    if (fim <= inicio) throw erros.invalido('O fim deve ser depois do início.');
    if (differenceInCalendarDays(fim, inicio) > MAX_DIAS_INTERVALO) {
      throw erros.invalido(`O período máximo é de ${MAX_DIAS_INTERVALO} dias.`);
    }
    const profissionalId = profissionalForcado(request) ?? request.query.profissionalId;
    const lista = await buscarBloqueios(request.db, profissionalId, inicio, fim);
    return lista.map((b) => ({
      id: b.id,
      profissional_id: b.profissional_id,
      inicio: b.inicio,
      fim: b.fim,
      motivo: b.motivo,
    }));
  });

  // --------------------------------------------------------------------- detalhe
  app.get('/:id', { schema: { params: Id } }, async (request) => buscarVisivel(request, request.params.id));

  // --------------------------------------------------------------------- criar
  app.post(
    '/',
    { preHandler: exigirPapel('admin', 'recepcao', 'profissional'), schema: { body: CorpoCriar } },
    async (request, reply) => {
      const b = request.body;
      exigirMesmaAgenda(request, b.profissional_id);
      const encaixe = validarEncaixe(request, b.encaixe);

      const paciente = ou404(
        await request.db.paciente.findUnique({ where: { id: b.paciente_id } }),
        'Paciente não encontrado.',
      );
      if (!paciente.ativo) throw erros.invalido('Este paciente está inativo.', 'paciente_inativo');
      const prof = await validarProfissional(request, b.profissional_id);
      const convenioId = await validarConvenio(request, b.tipo, b.convenio_id);
      const fuso = await obterFuso(request.db, request.clinicaId);
      const fim = b.fim ?? addMinutes(b.inicio, prof.duracao_consulta_min);

      const criado = await request.db.$transaction(async (tx) => {
        // Trava do limite (por clínica) + trava da agenda do profissional: conflito e criação atômicos.
        await assegurarLimite(request.clinicaId, 'max_agendamentos', { tx });
        await travarAgendaProfissional(tx, request.clinicaId, prof.id);
        await validarHorario(tx, { profissionalId: prof.id, inicio: b.inicio, fim, fuso, encaixe });
        return tx.agendamento.create({
          data: {
            paciente_id: paciente.id,
            profissional_id: prof.id,
            inicio: b.inicio,
            fim,
            tipo: b.tipo,
            convenio_id: convenioId,
            observacoes: b.observacoes || null,
            criado_por: request.usuarioClinica!.id,
          },
          select: selecaoAgendamento,
        });
      });
      return reply.status(201).send(criado);
    },
  );

  // --------------------------------------------------------------------- editar / remarcar
  app.put(
    '/:id',
    { preHandler: exigirPapel('admin', 'recepcao', 'profissional'), schema: { params: Id, body: CorpoEditar } },
    async (request) => {
      const b = request.body;
      const atual = await buscarVisivel(request, request.params.id);
      const encaixe = validarEncaixe(request, b.encaixe);

      const profissionalId = b.profissional_id ?? atual.profissional_id;
      exigirMesmaAgenda(request, profissionalId);
      const inicio = b.inicio ?? atual.inicio;
      const fim = b.fim ?? (b.inicio ? new Date(b.inicio.getTime() + (atual.fim.getTime() - atual.inicio.getTime())) : atual.fim);
      const remarcou =
        profissionalId !== atual.profissional_id ||
        inicio.getTime() !== atual.inicio.getTime() ||
        fim.getTime() !== atual.fim.getTime();

      if (remarcou && !STATUS_REMARCAVEIS.includes(atual.status)) {
        throw new ErroNegocio(
          409,
          'nao_remarcavel',
          'Só é possível remarcar agendamentos com status agendado ou confirmado. Para um novo horário, crie outro agendamento.',
        );
      }

      const dados: Prisma.AgendamentoUncheckedUpdateInput = {};
      if (b.paciente_id && b.paciente_id !== atual.paciente_id) {
        const pac = ou404(await request.db.paciente.findUnique({ where: { id: b.paciente_id } }), 'Paciente não encontrado.');
        if (!pac.ativo) throw erros.invalido('Este paciente está inativo.', 'paciente_inativo');
        dados.paciente_id = pac.id;
      }
      if (b.tipo !== undefined || b.convenio_id !== undefined) {
        const tipo = b.tipo ?? atual.tipo;
        const convId = b.convenio_id !== undefined ? b.convenio_id : atual.convenio_id;
        // Só revalida o convênio se ele mudou (um convênio desativado depois não trava a edição).
        dados.tipo = tipo;
        dados.convenio_id =
          tipo === 'convenio' && convId === atual.convenio_id && atual.tipo === 'convenio'
            ? convId
            : await validarConvenio(request, tipo, convId);
      }
      if (b.observacoes !== undefined) dados.observacoes = b.observacoes || null;

      if (!remarcou) {
        return request.db.agendamento.update({ where: { id: atual.id }, data: dados, select: selecaoAgendamento });
      }

      if (profissionalId !== atual.profissional_id) await validarProfissional(request, profissionalId);
      const fuso = await obterFuso(request.db, request.clinicaId);
      return request.db.$transaction(async (tx) => {
        await travarAgendaProfissional(tx, request.clinicaId, profissionalId);
        await validarHorario(tx, { profissionalId, inicio, fim, fuso, encaixe, ignorarId: atual.id });
        return tx.agendamento.update({
          where: { id: atual.id },
          data: {
            ...dados,
            profissional_id: profissionalId,
            inicio,
            fim,
            // a confirmação/lembrete valiam para o horário antigo
            ...(inicio.getTime() !== atual.inicio.getTime() ? { status: 'agendado', lembrete_enviado_em: null } : {}),
          },
          select: selecaoAgendamento,
        });
      });
    },
  );

  // --------------------------------------------------------------------- status
  app.patch(
    '/:id/status',
    { preHandler: exigirPapel('admin', 'recepcao', 'profissional'), schema: { params: Id, body: CorpoStatus } },
    async (request) => {
      const { status, motivo } = request.body;
      const atual = await buscarVisivel(request, request.params.id);
      if (!TRANSICOES[atual.status].includes(status as StatusAgendamento)) {
        throw new ErroNegocio(
          409,
          'transicao_invalida',
          atual.status === 'cancelado'
            ? 'Agendamento cancelado não pode ser reaberto. Crie um novo agendamento.'
            : `Não é possível mudar o status de "${atual.status}" para "${status}".`,
          { status_atual: atual.status, permitidos: TRANSICOES[atual.status] },
        );
      }
      const dados: Prisma.AgendamentoUpdateManyMutationInput = { status };
      if (status === 'cancelado') {
        dados.motivo_cancelamento = motivo || null;
        dados.cancelado_em = new Date();
      }
      // updateMany com o status atual no where: evita sobrescrever uma mudança concorrente (ex.: WhatsApp).
      const r = await request.db.agendamento.updateMany({ where: { id: atual.id, status: atual.status }, data: dados });
      if (r.count === 0) {
        throw erros.conflito('O status deste agendamento foi alterado por outra pessoa. Atualize a tela.', 'transicao_invalida');
      }
      return buscarVisivel(request, atual.id);
    },
  );
};

export default modulo;
