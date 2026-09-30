/**
 * Módulo auth — login do super admin, login de usuários da clínica e auto-cadastro.
 *
 *   POST /auth/admin/login   { email, senha }                 → { token, usuario }
 *   POST /auth/login         { email, senha, clinicaId? }     → { token, usuario, clinica }
 *        Se o e-mail+senha valerem em MAIS de uma clínica e `clinicaId` não vier:
 *        200 { selecionarClinica: true, clinicas: [{ id, nome }] } → o front mostra a lista e
 *        reenvia o login com `clinicaId`. (Só lista clínicas em que a senha confere.)
 *   POST /auth/cadastro      { nomeClinica, documento, responsavel, email, telefone, senha }
 *        → 201 { token, usuario, clinica }. Cria em UMA transação: clínica + usuário admin +
 *        assinatura (status 'teste', expira_em null) no plano marcado como plano_cadastro. A clínica recebe
 *        um `slug` único gerado do nome (utils/slug.ts — URL pública do agendamento online).
 *
 * Rate limit: 10 tentativas/minuto por IP nas rotas de login e 5/minuto no cadastro (IP real só com
 * TRUST_PROXY configurado atrás do proxy). E-mail inexistente roda bcrypt contra HASH_FALSO (timing).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { assinarTokenClinica, assinarTokenPlataforma } from '../../plugins/auth';
import { ErroNegocio } from '../../utils/erros';
import { somenteDigitos, validarCpfOuCnpj } from '../../utils/documento';
import { gerarSlugUnico } from '../../utils/slug';
import { conferirSenha, conferirSenhaFalsa, gerarHashSenha } from '../../utils/senha';

export const prefixo = '/auth';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('E-mail inválido'));

const credenciais = z.object({
  email,
  senha: z.string().min(1, 'Informe a senha'),
});

const limiteLogin = { rateLimit: { max: 10, timeWindow: '1 minute' } };

const erroCredenciais = () => new ErroNegocio(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');

const modulo: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ super admin
  app.post(
    '/admin/login',
    { config: limiteLogin, schema: { body: credenciais } },
    async (request) => {
      const { email, senha } = request.body;
      const admin = await prisma.usuarioPlataforma.findUnique({ where: { email } });
      // E-mail inexistente também roda um bcrypt (hash falso): mesmo tempo de resposta, sem enumeração.
      const senhaOk = admin ? await conferirSenha(senha, admin.senha_hash) : await conferirSenhaFalsa(senha);
      if (!admin || !admin.ativo || !senhaOk) throw erroCredenciais();
      return {
        token: assinarTokenPlataforma(app, admin.id),
        usuario: { id: admin.id, nome: admin.nome, email: admin.email },
      };
    },
  );

  // ------------------------------------------------------------------ usuário da clínica
  app.post(
    '/login',
    {
      config: limiteLogin,
      schema: { body: credenciais.extend({ clinicaId: z.uuid().optional() }) },
    },
    async (request) => {
      const { email, senha, clinicaId } = request.body;
      const candidatos = await prisma.usuario.findMany({
        where: { email, ativo: true, ...(clinicaId ? { clinica_id: clinicaId } : {}) },
        include: { clinica: { select: { id: true, nome: true, status: true } } },
      });

      const validos = [];
      for (const u of candidatos) {
        if (await conferirSenha(senha, u.senha_hash)) validos.push(u);
      }
      // E-mail inexistente também roda um bcrypt (hash falso): mesmo tempo de resposta, sem enumeração.
      if (candidatos.length === 0) await conferirSenhaFalsa(senha);
      if (validos.length === 0) throw erroCredenciais();

      const ativos = validos.filter((u) => u.clinica.status === 'ativa');
      if (ativos.length === 0) {
        throw new ErroNegocio(403, 'clinica_inativa', 'Esta clínica está inativa. Entre em contato com o suporte.');
      }
      if (ativos.length > 1) {
        return {
          selecionarClinica: true as const,
          clinicas: ativos.map((u) => ({ id: u.clinica.id, nome: u.clinica.nome })),
        };
      }

      const usuario = ativos[0]!;
      await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimo_acesso_em: new Date() } });
      return {
        token: assinarTokenClinica(app, {
          usuarioId: usuario.id,
          clinicaId: usuario.clinica_id,
          papel: usuario.papel,
          profissionalId: usuario.profissional_id,
        }),
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          papel: usuario.papel,
          profissionalId: usuario.profissional_id,
        },
        clinica: { id: usuario.clinica.id, nome: usuario.clinica.nome },
      };
    },
  );

  // ------------------------------------------------------------------ auto-cadastro
  const corpoCadastro = z.object({
    nomeClinica: z.string().trim().min(2, 'Informe o nome da clínica').max(150),
    documento: z
      .string()
      .transform(somenteDigitos)
      .refine(validarCpfOuCnpj, 'CPF ou CNPJ inválido'),
    responsavel: z.string().trim().min(2, 'Informe o nome do responsável').max(150),
    email,
    telefone: z
      .string()
      .transform(somenteDigitos)
      .refine((t) => t.length >= 10 && t.length <= 13, 'Telefone inválido'),
    senha: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres').max(100),
  });

  app.post(
    '/cadastro',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: corpoCadastro } },
    async (request, reply) => {
      const dados = request.body;
      const senhaHash = await gerarHashSenha(dados.senha);

      const resultado = await prisma.$transaction(async (tx) => {
        const plano = await tx.plano.findFirst({ where: { plano_cadastro: true, ativo: true } });
        if (!plano) {
          throw new ErroNegocio(
            503,
            'cadastro_indisponivel',
            'O cadastro está temporariamente indisponível. Tente novamente mais tarde.',
          );
        }
        if (await tx.clinica.findUnique({ where: { documento: dados.documento } })) {
          throw new ErroNegocio(409, 'documento_em_uso', 'Já existe uma clínica cadastrada com este CPF/CNPJ.');
        }
        if (await tx.usuario.findFirst({ where: { email: dados.email } })) {
          throw new ErroNegocio(409, 'email_em_uso', 'Este e-mail já está em uso. Faça login ou use outro e-mail.');
        }

        const clinica = await tx.clinica.create({
          data: {
            nome: dados.nomeClinica,
            // Fase 2: slug público do agendamento online (admin pode editar em Configurações).
            slug: await gerarSlugUnico(dados.nomeClinica, tx),
            documento: dados.documento,
            responsavel: dados.responsavel,
            email: dados.email,
            telefone: dados.telefone,
          },
        });
        const usuario = await tx.usuario.create({
          data: {
            clinica_id: clinica.id,
            nome: dados.responsavel,
            email: dados.email,
            senha_hash: senhaHash,
            papel: 'admin',
          },
        });
        await tx.assinatura.create({
          data: { clinica_id: clinica.id, plano_id: plano.id, status: 'teste', expira_em: null },
        });
        return { clinica, usuario };
      });

      const { clinica, usuario } = resultado;
      reply.status(201);
      return {
        token: assinarTokenClinica(app, {
          usuarioId: usuario.id,
          clinicaId: clinica.id,
          papel: usuario.papel,
          profissionalId: null,
        }),
        usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel, profissionalId: null },
        clinica: { id: clinica.id, nome: clinica.nome },
      };
    },
  );
};

export default modulo;
