import type { FastifyRequest } from 'fastify';

/** Ações padronizadas (use estas; strings livres são aceitas para casos novos). */
export type AcaoLog = 'visualizar' | 'listar' | 'criar' | 'baixar' | 'exportar' | (string & {});

/**
 * Registra acesso em `logs_acesso` (LGPD). OBRIGATÓRIO ao visualizar/criar registros de
 * prontuário e ao baixar anexos. Usa request.db (clinica_id do token) e o usuário autenticado.
 *
 *   await logAcesso(request, 'visualizar', 'prontuario', pacienteId);
 *   await logAcesso(request, 'criar', 'prontuario_registro', registro.id);
 *   await logAcesso(request, 'baixar', 'anexo', anexo.id);
 */
export async function logAcesso(
  request: FastifyRequest,
  acao: AcaoLog,
  entidade: string,
  entidadeId?: string | null,
): Promise<void> {
  if (!request.clinicaId || !request.usuarioClinica) {
    throw new Error('logAcesso exige uma requisição autenticada da clínica (autenticarClinica).');
  }
  const userAgent = request.headers['user-agent'];
  await request.db.logAcesso.create({
    data: {
      usuario_id: request.usuarioClinica.id,
      acao,
      entidade,
      entidade_id: entidadeId ?? null,
      ip: request.ip,
      user_agent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
    },
  });
}
