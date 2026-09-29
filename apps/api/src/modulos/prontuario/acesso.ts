/**
 * Regras de acesso ao prontuário (registros e anexos).
 *
 * - recepcao: nunca (403) — também barrado por exigirPapel no módulo inteiro.
 * - admin: lê o prontuário de qualquer paciente da clínica. Só ESCREVE registros se estiver
 *   vinculado a um profissional (o registro sai em nome desse profissional). Pode enviar anexos.
 * - profissional: só pacientes "seus" = com agendamento com ele OU registro de prontuário feito por ele.
 */
import type { FastifyRequest } from 'fastify';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';

export async function pacienteEhDoProfissional(request: FastifyRequest, pacienteId: string, profissionalId: string) {
  const [agendamento, registro] = await Promise.all([
    request.db.agendamento.findFirst({
      where: { paciente_id: pacienteId, profissional_id: profissionalId },
      select: { id: true },
    }),
    request.db.prontuarioRegistro.findFirst({
      where: { paciente_id: pacienteId, profissional_id: profissionalId },
      select: { id: true },
    }),
  ]);
  return !!(agendamento || registro);
}

/** Garante que o usuário pode acessar o prontuário/anexos do paciente. Lança 403/404. */
export async function assegurarAcessoProntuario(request: FastifyRequest, pacienteId: string) {
  const usuario = request.usuarioClinica!;
  if (usuario.papel === 'recepcao') throw erros.proibido('A recepção não tem acesso ao prontuário.');

  const paciente = ou404(
    await request.db.paciente.findUnique({ where: { id: pacienteId }, select: { id: true, nome: true } }),
    'Paciente não encontrado.',
  );
  if (usuario.papel === 'admin') return paciente;

  if (!usuario.profissionalId) {
    throw new ErroNegocio(
      403,
      'sem_profissional_vinculado',
      'Seu usuário não está vinculado a um profissional. Fale com o administrador da clínica.',
    );
  }
  if (!(await pacienteEhDoProfissional(request, pacienteId, usuario.profissionalId))) {
    throw new ErroNegocio(
      403,
      'paciente_nao_vinculado',
      'Você só pode acessar o prontuário de pacientes atendidos ou agendados com você.',
    );
  }
  return paciente;
}

/** profissional_id de quem escreve no prontuário (profissional ou admin vinculado). */
export function profissionalAutor(request: FastifyRequest): string {
  const id = request.usuarioClinica!.profissionalId;
  if (!id) {
    throw new ErroNegocio(
      403,
      'sem_profissional_vinculado',
      'Apenas usuários vinculados a um profissional podem escrever no prontuário.',
    );
  }
  return id;
}
