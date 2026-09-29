/**
 * Módulo prontuario — Prontuário (IMUTÁVEL) + anexos (prefixo "/prontuario")
 *
 *   GET  /prontuario/pacientes/:pacienteId          registros (mais recente primeiro) + logAcesso('visualizar')
 *   POST /prontuario/pacientes/:pacienteId          novo registro { texto, agendamento_id?, corrige_registro_id? } + logAcesso('criar')
 *   GET  /prontuario/pacientes/:pacienteId/anexos   ver anexos.ts
 *   POST /prontuario/pacientes/:pacienteId/anexos   ver anexos.ts
 *   GET  /prontuario/anexos/:id/download            ver anexos.ts
 *
 * NÃO existem rotas de update/delete: correção = novo registro com `corrige_registro_id`
 * (a extensão tenant e um trigger no banco também bloqueiam update/delete).
 *
 * Permissões (ver acesso.ts):
 * - recepcao → 403 em todas as rotas do módulo.
 * - admin → lê tudo; escreve registro só se vinculado a um profissional (sai em nome dele); envia anexos.
 * - profissional → só pacientes "seus" (agendamento com ele ou registro feito por ele); o registro sai sempre
 *   com o profissional_id do próprio usuário. Primeiro registro de um paciente exige agendamento com ele.
 * - Correção: só do registro do mesmo paciente e do mesmo profissional autor.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { ErroNegocio, ou404 } from '../../utils/erros';
import { logAcesso } from '../../utils/logAcesso';
import { assegurarAcessoProntuario, profissionalAutor } from './acesso';
import { rotasAnexos } from './anexos';

export const prefixo = '/prontuario';

const ParamsPaciente = z.object({ pacienteId: z.uuid('Paciente inválido') });

const CorpoRegistro = z.object({
  texto: z.string().trim().min(1, 'Escreva o registro').max(50_000, 'Registro muito longo'),
  agendamento_id: z.uuid('Agendamento inválido').nullish(),
  corrige_registro_id: z.uuid('Registro inválido').nullish(),
});

const INCLUDE_REGISTRO = {
  profissional: { select: { id: true, nome: true, especialidade: true, registro: true } },
  autor: { select: { id: true, nome: true } },
  agendamento: { select: { id: true, inicio: true } },
  anexos: { select: { id: true, nome_arquivo: true, mime_tipo: true, tamanho: true } },
  correcoes: { select: { id: true, criado_em: true } },
} as const;

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  // Recepção NUNCA acessa o prontuário (regra 4 do CLAUDE.md).
  app.addHook('preHandler', exigirPapel('admin', 'profissional'));

  app.get('/pacientes/:pacienteId', { schema: { params: ParamsPaciente } }, async (request) => {
    const { pacienteId } = request.params;
    await assegurarAcessoProntuario(request, pacienteId);
    const registros = await request.db.prontuarioRegistro.findMany({
      where: { paciente_id: pacienteId },
      include: INCLUDE_REGISTRO,
      orderBy: { criado_em: 'desc' },
    });
    await logAcesso(request, 'visualizar', 'prontuario', pacienteId);
    return registros;
  });

  app.post(
    '/pacientes/:pacienteId',
    { schema: { params: ParamsPaciente, body: CorpoRegistro } },
    async (request, reply) => {
      const { pacienteId } = request.params;
      const { texto, agendamento_id, corrige_registro_id } = request.body;
      const profissionalId = profissionalAutor(request);
      await assegurarAcessoProntuario(request, pacienteId);

      if (agendamento_id) {
        ou404(
          await request.db.agendamento.findFirst({
            where: { id: agendamento_id, paciente_id: pacienteId },
            select: { id: true },
          }),
          'Agendamento não encontrado para este paciente.',
        );
      }
      if (corrige_registro_id) {
        const original = ou404(
          await request.db.prontuarioRegistro.findFirst({
            where: { id: corrige_registro_id, paciente_id: pacienteId },
            select: { profissional_id: true },
          }),
          'Registro a corrigir não encontrado.',
        );
        if (original.profissional_id !== profissionalId) {
          throw new ErroNegocio(
            403,
            'correcao_nao_permitida',
            'Só o profissional que escreveu o registro pode registrar uma correção dele.',
          );
        }
      }

      const registro = await request.db.prontuarioRegistro.create({
        data: {
          paciente_id: pacienteId,
          profissional_id: profissionalId,
          autor_id: request.usuarioClinica!.id,
          agendamento_id: agendamento_id ?? null,
          corrige_registro_id: corrige_registro_id ?? null,
          texto,
        },
        include: INCLUDE_REGISTRO,
      });
      await logAcesso(request, 'criar', 'prontuario', registro.id);
      return reply.status(201).send(registro);
    },
  );

  await app.register(rotasAnexos);
};

export default modulo;
