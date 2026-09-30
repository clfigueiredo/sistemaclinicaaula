/**
 * Módulo me — dados da sessão atual.
 *
 *   GET /me        (token de clínica) → usuário, clínica, papel, assinatura, plano e
 *                  recursos { [codigo]: { nome, tipo, habilitado, limite, periodo, uso } }
 *   GET /me/onboarding (admin) → passos do onboarding concluídos
 *                  { profissional, horarios, convenios, whatsapp } (booleans)
 *   GET /admin/me  (token de plataforma) → dados do super admin
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarAdmin, autenticarClinica, exigirPapel } from '../../plugins/auth';
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

  app.get('/me/onboarding', { preHandler: exigirPapel('admin') }, async (request) => {
    const [profissionais, comHorarios, convenios, sessao] = await Promise.all([
      request.db.profissional.count({ where: { ativo: true } }),
      request.db.profissional.count({ where: { ativo: true, horarios: { some: {} } } }),
      request.db.convenio.count({ where: { ativo: true } }),
      request.db.whatsappSessao.findFirst({ select: { status: true } }),
    ]);
    return {
      profissional: profissionais > 0,
      horarios: comHorarios > 0,
      convenios: convenios > 0,
      whatsapp: sessao?.status === 'conectada',
    };
  });

  app.get('/admin/me', { onRequest: autenticarAdmin }, async (request) => {
    return { usuario: request.adminPlataforma! };
  });
};

export default modulo;
