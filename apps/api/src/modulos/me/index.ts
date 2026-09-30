/**
 * Módulo me — dados da sessão atual.
 *
 *   GET /me        (token de clínica) → usuário, clínica, papel, assinatura, plano e
 *                  recursos { [codigo]: { nome, tipo, habilitado, limite, periodo, uso } }
 *   GET /me/onboarding (admin) → passos do onboarding concluídos
 *                  { profissional, horarios, convenios, whatsapp } (booleans)
 *   PUT /me/clinica (admin) → edita os dados cadastrais da própria clínica
 *                  (documento e status não são editáveis aqui — só pelo super admin)
 *   GET /admin/me  (token de plataforma) → dados do super admin
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticarAdmin, autenticarClinica, exigirPapel } from '../../plugins/auth';
import { obterUsoERecursos } from '../../plugins/recursos';
import { ou404 } from '../../utils/erros';

export const prefixo = '';

const CAMPOS_CLINICA = {
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
} as const;

/** Fusos horários do Brasil aceitos na configuração da clínica. */
export const FUSOS_BRASIL = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Noronha',
] as const;

/** Texto opcional: string vazia vira null (limpa o campo). */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .transform((v) => (v === '' ? null : v))
    .nullish();

const corpoClinica = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da clínica').max(150, 'Máximo de 150 caracteres').optional(),
  responsavel: textoOpcional(150),
  email: z
    .union([z.literal(''), z.email('E-mail inválido').max(150)])
    .transform((v) => (v === '' ? null : v.toLowerCase()))
    .nullish(),
  telefone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'Telefone inválido')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  endereco: textoOpcional(200),
  cidade: textoOpcional(100),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'UF inválida')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  cep: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 8, 'CEP inválido')
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  fuso_horario: z.enum(FUSOS_BRASIL, 'Fuso horário inválido').optional(),
});

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', { onRequest: autenticarClinica }, async (request) => {
    const usuario = request.usuarioClinica!;
    const clinica = ou404(
      await request.db.clinica.findUnique({
        where: { id: request.clinicaId },
        select: CAMPOS_CLINICA,
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

  app.put(
    '/me/clinica',
    { preHandler: exigirPapel('admin'), schema: { body: corpoClinica } },
    async (request) => {
      // Campos ausentes (undefined) não são alterados; null limpa o campo.
      const clinica = await request.db.clinica.update({
        where: { id: request.clinicaId },
        data: request.body,
        select: CAMPOS_CLINICA,
      });
      request.log.info({ clinicaId: request.clinicaId }, 'dados da clínica atualizados');
      return clinica;
    },
  );

  app.get('/admin/me', { onRequest: autenticarAdmin }, async (request) => {
    return { usuario: request.adminPlataforma! };
  });
};

export default modulo;
