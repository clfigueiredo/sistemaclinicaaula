/**
 * Módulo me — dados da sessão atual.
 *
 *   GET /me        (token de clínica) → usuário, clínica, papel, assinatura, plano e
 *                  recursos { [codigo]: { nome, tipo, habilitado, limite, periodo, uso } }
 *   GET /admin/me  (token de plataforma) → dados do super admin
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarAdmin, autenticarClinica } from '../../plugins/auth';
import { obterUsoERecursos } from '../../plugins/recursos';
import { ou404 } from '../../utils/erros';

export const prefixo = '';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', { onRequest: autenticarClinica }, async (request) => {
    const usuario = request.usuarioClinica!;
    const clinica = ou404(
      await request.db.clinica.findUnique({
        where: { id: request.clinicaId },
        select: {
          id: true,
          nome: true,
          documento: true,
          responsavel: true,
          email: true,
          telefone: true,
          endereco: true,
          cidade: true,
          uf: true,
          cep: true,
          fuso_horario: true,
          status: true,
        },
      }),
      'Clínica não encontrada.',
    );
    const resumo = await obterUsoERecursos(request.clinicaId);
    return {
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
        profissionalId: usuario.profissionalId,
      },
      papel: usuario.papel,
      clinica,
      ...resumo,
    };
  });

  app.get('/admin/me', { onRequest: autenticarAdmin }, async (request) => {
    return { usuario: request.adminPlataforma! };
  });
};

export default modulo;
