/**
 * Regras de acesso ao prontuário (registros e anexos) e aos dados clínicos do paciente
 * (alergias/medicações — reutilizado pelo módulo pacientes).
 *
 * - recepcao: nunca (403) — também barrado por exigirPapel no módulo inteiro.
 * - admin: lê o prontuário de qualquer paciente da clínica. Só ESCREVE registros se estiver
 *   vinculado a um profissional ATIVO (o registro sai em nome desse profissional). Pode enviar anexos.
 * - profissional: precisa estar vinculado a um profissional ATIVO (senão 403 `profissional_inativo`)
 *   e só acessa pacientes "seus" (senão 403 `paciente_nao_vinculado`).
 *
 * VÍNCULO profissional–paciente (pacienteEhDoProfissional). O paciente é "do profissional" se:
 *   1. existe registro de prontuário desse profissional para o paciente; OU
 *   2. existe agendamento do profissional com o paciente, status diferente de `cancelado`, criado
 *      por OUTRO usuário (criado_por ≠ usuário atual, ou nulo — ex.: seed/usuário removido); OU
 *   3. existe agendamento do profissional com o paciente com status `compareceu` ou `atendido`
 *      e início já alcançado (inicio ≤ agora) — cobre o profissional que agenda sozinho.
 * Motivo: o próprio profissional pode criar agendamentos na sua agenda (POST /agendamentos). Sem as
 * restrições acima bastaria ele agendar qualquer paciente para ganhar acesso ao prontuário dele.
 * Agendamentos criados por ele mesmo só valem depois do atendimento (e no horário marcado). A troca
 * de paciente de um agendamento é proibida ao papel profissional (PUT /agendamentos/:id).
 */
import type { FastifyRequest } from 'fastify';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';

export async function pacienteEhDoProfissional(request: FastifyRequest, pacienteId: string, profissionalId: string) {
  const usuarioId = request.usuarioClinica!.id;
  const [agendamento, registro] = await Promise.all([
    request.db.agendamento.findFirst({
      where: {
        paciente_id: pacienteId,
        profissional_id: profissionalId,
        OR: [
          // (2) agendado por outra pessoa (recepção, admin…)
          {
            status: { not: 'cancelado' },
            OR: [{ criado_por: null }, { criado_por: { not: usuarioId } }],
          },
          // (3) atendimento realizado (inclusive agendado por ele mesmo), já no horário
          { status: { in: ['compareceu', 'atendido'] }, inicio: { lte: new Date() } },
        ],
      },
      select: { id: true },
    }),
    request.db.prontuarioRegistro.findFirst({
      where: { paciente_id: pacienteId, profissional_id: profissionalId },
      select: { id: true },
    }),
  ]);
  return !!(agendamento || registro);
}

const erroSemProfissional = () =>
  new ErroNegocio(
    403,
    'sem_profissional_vinculado',
    'Seu usuário não está vinculado a um profissional. Fale com o administrador da clínica.',
  );

const erroProfissionalInativo = () =>
  new ErroNegocio(
    403,
    'profissional_inativo',
    'O profissional vinculado ao seu usuário está inativo. Fale com o administrador da clínica.',
  );

/** Garante que o profissional existe na clínica e está ativo. */
async function assegurarProfissionalAtivo(request: FastifyRequest, profissionalId: string) {
  const prof = await request.db.profissional.findUnique({ where: { id: profissionalId }, select: { ativo: true } });
  if (!prof?.ativo) throw erroProfissionalInativo();
}

/**
 * Garante que o usuário pode acessar os dados clínicos do paciente (prontuário, anexos, alergias,
 * medicações). Lança 403/404. Devolve { id, nome } do paciente.
 */
export async function assegurarAcessoProntuario(request: FastifyRequest, pacienteId: string) {
  const usuario = request.usuarioClinica!;
  if (usuario.papel === 'recepcao') throw erros.proibido('A recepção não tem acesso ao prontuário.');

  const paciente = ou404(
    await request.db.paciente.findUnique({ where: { id: pacienteId }, select: { id: true, nome: true } }),
    'Paciente não encontrado.',
  );
  if (usuario.papel === 'admin') return paciente;

  if (!usuario.profissionalId) throw erroSemProfissional();
  await assegurarProfissionalAtivo(request, usuario.profissionalId);
  if (!(await pacienteEhDoProfissional(request, pacienteId, usuario.profissionalId))) {
    throw new ErroNegocio(
      403,
      'paciente_nao_vinculado',
      'Você só pode acessar os dados clínicos de pacientes atendidos ou agendados com você.',
    );
  }
  return paciente;
}

/**
 * Versão booleana para leituras "parciais" (ex.: GET /pacientes/:id devolve alergias/medicações = null
 * a quem não pode vê-las). Não lança 404: o chamador já buscou o paciente.
 */
export async function podeVerDadosClinicos(request: FastifyRequest, pacienteId: string): Promise<boolean> {
  const usuario = request.usuarioClinica!;
  if (usuario.papel === 'admin') return true;
  if (usuario.papel !== 'profissional' || !usuario.profissionalId) return false;
  const prof = await request.db.profissional.findUnique({ where: { id: usuario.profissionalId }, select: { ativo: true } });
  if (!prof?.ativo) return false;
  return pacienteEhDoProfissional(request, pacienteId, usuario.profissionalId);
}

/** profissional_id de quem escreve no prontuário (profissional ou admin vinculado a profissional ATIVO). */
export async function profissionalAutor(request: FastifyRequest): Promise<string> {
  const id = request.usuarioClinica!.profissionalId;
  if (!id) {
    throw new ErroNegocio(
      403,
      'sem_profissional_vinculado',
      'Apenas usuários vinculados a um profissional podem escrever no prontuário.',
    );
  }
  await assegurarProfissionalAtivo(request, id);
  return id;
}
