/**
 * Módulo pacientes — Pacientes + alergias + medicações (prefixo "/pacientes")
 *
 *   GET    /pacientes?busca=&pagina=&porPagina=&inativos=   todos os papéis
 *          → { itens: [{ id, nome, cpf, nascimento, telefone, whatsapp, convenio_id, aceita_whatsapp, ativo, convenio }], total, pagina, porPagina }
 *          Busca por nome (sem diferenciar maiúsculas/acentos), CPF ou telefone/WhatsApp. Ordenado por nome.
 *          Por padrão só pacientes ativos (inativos=true inclui os inativos).
 *   GET    /pacientes/:id               todos os papéis → paciente completo + convenio + alergias + medicacoes
 *                                        (recepção recebe alergias/medicacoes = null: dados clínicos)
 *   POST   /pacientes                   admin, recepcao
 *   PUT    /pacientes/:id               admin, recepcao (substituição completa; `ativo` opcional inativa/reativa)
 *   POST   /pacientes/:id/alergias                 admin, profissional
 *   PUT    /pacientes/:id/alergias/:alergiaId      admin, profissional
 *   DELETE /pacientes/:id/alergias/:alergiaId      admin, profissional
 *   POST   /pacientes/:id/medicacoes               admin, profissional
 *   PUT    /pacientes/:id/medicacoes/:medicacaoId  admin, profissional
 *   DELETE /pacientes/:id/medicacoes/:medicacaoId  admin, profissional
 *
 * Regras:
 * - Sem exclusão física de paciente: use `ativo: false` no PUT.
 * - CPF opcional, validado e único por clínica (409 `cpf_em_uso`).
 * - telefone/whatsapp normalizados para dígitos com DDI 55.
 * - aceita_whatsapp (consentimento LGPD) é explícito, default false, e exige número de WhatsApp.
 * - Alergias/medicações são dados clínicos: recepção não vê nem edita.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Prisma, type Paciente } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { erros, ou404 } from '../../utils/erros';
import {
  CorpoAlergia,
  CorpoMedicacao,
  CorpoPaciente,
  FiltrosLista,
  ParamsAlergia,
  ParamsId,
  ParamsMedicacao,
} from './esquemas';

export const prefixo = '/pacientes';

/** Data (coluna DATE) → "AAAA-MM-DD" (evita deslocamento de fuso no front). */
function dataIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function serializar<T extends Pick<Paciente, 'nascimento'>>(p: T) {
  return { ...p, nascimento: dataIso(p.nascimento) };
}

const CAMPOS_LISTA = {
  id: true,
  nome: true,
  cpf: true,
  nascimento: true,
  telefone: true,
  whatsapp: true,
  convenio_id: true,
  aceita_whatsapp: true,
  ativo: true,
  convenio: { select: { id: true, nome: true } },
} satisfies Prisma.PacienteSelect;

/** Minúsculas e sem acento (para busca). */
function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const ACENTOS = 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ';
const SEM_ACENTOS = 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn';

/** Busca por nome (acento/caixa-insensível), CPF ou telefone. SQL cru ⇒ filtra clinica_id manualmente. */
async function buscarIds(request: FastifyRequest, busca: string, incluirInativos: boolean, pagina: number, porPagina: number) {
  const termo = `%${escaparLike(normalizarTexto(busca))}%`;
  const digitos = busca.replace(/\D/g, '');
  const condDigitos =
    digitos.length >= 3
      ? Prisma.sql`OR p.cpf LIKE ${`%${digitos}%`} OR p.telefone LIKE ${`%${digitos}%`} OR p.whatsapp LIKE ${`%${digitos}%`}`
      : Prisma.empty;
  const condAtivo = incluirInativos ? Prisma.empty : Prisma.sql`AND p.ativo = true`;
  const where = Prisma.sql`
    WHERE p.clinica_id = ${request.clinicaId}::uuid ${condAtivo}
      AND (lower(translate(p.nome, ${ACENTOS}, ${SEM_ACENTOS})) LIKE ${termo} ${condDigitos})`;

  const [linhas, contagem] = await Promise.all([
    request.db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM pacientes p ${where}
      ORDER BY lower(translate(p.nome, ${ACENTOS}, ${SEM_ACENTOS})), p.id
      LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
    request.db.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total FROM pacientes p ${where}`,
  ]);
  return { ids: linhas.map((l) => l.id), total: Number(contagem[0]?.total ?? 0) };
}

/** Garante que o CPF não está em uso por outro paciente da clínica. */
async function assegurarCpfLivre(request: FastifyRequest, cpf: string | null, ignorarId?: string) {
  if (!cpf) return;
  const existente = await request.db.paciente.findFirst({
    where: { cpf, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existente) throw erros.conflito('Já existe um paciente com este CPF nesta clínica.', 'cpf_em_uso');
}

async function validarConvenio(request: FastifyRequest, convenioId: string | null) {
  if (!convenioId) return;
  ou404(await request.db.convenio.findUnique({ where: { id: convenioId } }), 'Convênio não encontrado.');
}

function dadosPaciente(corpo: CorpoPaciente) {
  const { nascimento, ativo, ...resto } = corpo;
  return {
    ...resto,
    nascimento: nascimento ? new Date(`${nascimento}T00:00:00Z`) : null,
    ...(ativo === undefined ? {} : { ativo }),
  };
}

async function obterPaciente(request: FastifyRequest, id: string) {
  return ou404(await request.db.paciente.findUnique({ where: { id }, select: { id: true } }), 'Paciente não encontrado.');
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);

  // ------------------------------------------------------------------ lista / busca
  app.get('/', { schema: { querystring: FiltrosLista } }, async (request) => {
    const { busca, pagina, porPagina, inativos } = request.query;
    const incluirInativos = inativos === 'true';

    if (busca) {
      const { ids, total } = await buscarIds(request, busca, incluirInativos, pagina, porPagina);
      const pacientes = await request.db.paciente.findMany({ where: { id: { in: ids } }, select: CAMPOS_LISTA });
      const porId = new Map(pacientes.map((p) => [p.id, p]));
      const itens = ids.map((id) => porId.get(id)).filter((p) => !!p).map(serializar);
      return { itens, total, pagina, porPagina };
    }

    const where: Prisma.PacienteWhereInput = incluirInativos ? {} : { ativo: true };
    const [pacientes, total] = await Promise.all([
      request.db.paciente.findMany({
        where,
        select: CAMPOS_LISTA,
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
      request.db.paciente.count({ where }),
    ]);
    return { itens: pacientes.map(serializar), total, pagina, porPagina };
  });

  // ------------------------------------------------------------------ detalhe
  app.get('/:id', { schema: { params: ParamsId } }, async (request) => {
    const verClinico = request.usuarioClinica!.papel !== 'recepcao';
    const paciente = ou404(
      await request.db.paciente.findUnique({
        where: { id: request.params.id },
        include: {
          convenio: { select: { id: true, nome: true, ativo: true } },
          ...(verClinico
            ? {
                alergias: { orderBy: { criado_em: 'asc' } },
                medicacoes: { orderBy: { criado_em: 'asc' } },
              }
            : {}),
        },
      }),
      'Paciente não encontrado.',
    );
    return {
      ...serializar(paciente),
      // Recepção não vê dados clínicos (null ≠ "sem alergias").
      alergias: verClinico ? (paciente as typeof paciente & { alergias: unknown[] }).alergias : null,
      medicacoes: verClinico ? (paciente as typeof paciente & { medicacoes: unknown[] }).medicacoes : null,
    };
  });

  // ------------------------------------------------------------------ criar / editar
  app.post(
    '/',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { body: CorpoPaciente } },
    async (request, reply) => {
      const corpo = request.body;
      await validarConvenio(request, corpo.convenio_id);
      await assegurarCpfLivre(request, corpo.cpf);
      const paciente = await request.db.paciente.create({ data: dadosPaciente(corpo) });
      return reply.status(201).send(serializar(paciente));
    },
  );

  app.put(
    '/:id',
    { preHandler: exigirPapel('admin', 'recepcao'), schema: { params: ParamsId, body: CorpoPaciente } },
    async (request) => {
      const { id } = request.params;
      const corpo = request.body;
      await obterPaciente(request, id);
      await validarConvenio(request, corpo.convenio_id);
      await assegurarCpfLivre(request, corpo.cpf, id);
      const paciente = await request.db.paciente.update({ where: { id }, data: dadosPaciente(corpo) });
      return serializar(paciente);
    },
  );

  // ------------------------------------------------------------------ alergias (dados clínicos)
  const clinico = exigirPapel('admin', 'profissional');

  app.post(
    '/:id/alergias',
    { preHandler: clinico, schema: { params: ParamsId, body: CorpoAlergia } },
    async (request, reply) => {
      await obterPaciente(request, request.params.id);
      const alergia = await request.db.pacienteAlergia.create({
        data: { ...request.body, paciente_id: request.params.id },
      });
      return reply.status(201).send(alergia);
    },
  );

  app.put(
    '/:id/alergias/:alergiaId',
    { preHandler: clinico, schema: { params: ParamsAlergia, body: CorpoAlergia } },
    async (request) => {
      const { id, alergiaId } = request.params;
      ou404(
        await request.db.pacienteAlergia.findFirst({ where: { id: alergiaId, paciente_id: id } }),
        'Alergia não encontrada.',
      );
      return request.db.pacienteAlergia.update({ where: { id: alergiaId }, data: request.body });
    },
  );

  app.delete('/:id/alergias/:alergiaId', { preHandler: clinico, schema: { params: ParamsAlergia } }, async (request, reply) => {
    const { id, alergiaId } = request.params;
    ou404(
      await request.db.pacienteAlergia.findFirst({ where: { id: alergiaId, paciente_id: id } }),
      'Alergia não encontrada.',
    );
    await request.db.pacienteAlergia.delete({ where: { id: alergiaId } });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ medicações (dados clínicos)
  app.post(
    '/:id/medicacoes',
    { preHandler: clinico, schema: { params: ParamsId, body: CorpoMedicacao } },
    async (request, reply) => {
      await obterPaciente(request, request.params.id);
      const medicacao = await request.db.pacienteMedicacao.create({
        data: { ...request.body, paciente_id: request.params.id },
      });
      return reply.status(201).send(medicacao);
    },
  );

  app.put(
    '/:id/medicacoes/:medicacaoId',
    { preHandler: clinico, schema: { params: ParamsMedicacao, body: CorpoMedicacao } },
    async (request) => {
      const { id, medicacaoId } = request.params;
      ou404(
        await request.db.pacienteMedicacao.findFirst({ where: { id: medicacaoId, paciente_id: id } }),
        'Medicação não encontrada.',
      );
      return request.db.pacienteMedicacao.update({ where: { id: medicacaoId }, data: request.body });
    },
  );

  app.delete(
    '/:id/medicacoes/:medicacaoId',
    { preHandler: clinico, schema: { params: ParamsMedicacao } },
    async (request, reply) => {
      const { id, medicacaoId } = request.params;
      ou404(
        await request.db.pacienteMedicacao.findFirst({ where: { id: medicacaoId, paciente_id: id } }),
        'Medicação não encontrada.',
      );
      await request.db.pacienteMedicacao.delete({ where: { id: medicacaoId } });
      return reply.status(204).send();
    },
  );
};

export default modulo;
