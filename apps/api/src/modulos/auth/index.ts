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
 *        Depois do commit enfileira o e-mail de boas-vindas (servicos/email — a senha NUNCA vai no e-mail).
 *
 * Esqueci minha senha (lógica em ./redefinicaoSenha.ts; usuários da clínica, não o super admin):
 *   POST /auth/esqueci-senha                 { email }         → 204 SEMPRE (não revela se o e-mail existe).
 *        O trabalho roda em segundo plano, depois da resposta (tempo igual para e-mail existente ou não): um link
 *        por usuário ativo com o e-mail em clínica ativa (o e-mail é único por clínica), máx. 3 links/hora por
 *        usuário, válido por 1 hora; e-mail `redefinir_senha` com o link. Assinatura suspensa não impede.
 *   GET  /auth/redefinir-senha/validar?token= → { valido: true, clinica, email (mascarado) }
 *                                               | 400 { erro: 'token_invalido' }
 *   POST /auth/redefinir-senha               { token, senha }  → 204 | 400 token_invalido. Troca a senha, grava
 *        senha_alterada_em (derruba as sessões abertas) e invalida o link usado e os outros pendentes do usuário.
 *
 * Rate limit por IP (IP real só com TRUST_PROXY configurado atrás do proxy): 10/minuto nas rotas de login,
 * 5/minuto no cadastro, 3/minuto no esqueci-senha e 10/minuto na validação/redefinição. E-mail inexistente roda
 * bcrypt contra HASH_FALSO no login (timing).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { assinarTokenClinica, assinarTokenPlataforma } from '../../plugins/auth';
import { ErroNegocio } from '../../utils/erros';
import { somenteDigitos, validarCpfOuCnpj } from '../../utils/documento';
import { gerarSlugUnico } from '../../utils/slug';
import { conferirSenha, conferirSenhaFalsa, gerarHashSenha } from '../../utils/senha';
import { enfileirarEmail, linksSistema } from '../../servicos/email';
import {
  aguardarSolicitacoesRedefinicao,
  dispararSolicitacaoRedefinicao,
  redefinirSenhaComToken,
  validarTokenRedefinicao,
} from './redefinicaoSenha';

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
const limiteEsqueciSenha = { rateLimit: { max: 3, timeWindow: '1 minute' } };
const limiteRedefinicao = { rateLimit: { max: 10, timeWindow: '1 minute' } };

/** Mesma regra de senha do cadastro e da redefinição. */
const senhaNova = z.string().min(6, 'A senha deve ter pelo menos 6 caracteres').max(100);
const tokenRedefinicao = z.string().trim().min(1, 'Link inválido').max(200);

const erroCredenciais = () => new ErroNegocio(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');

/** Anti-abuso: o auto-cadastro não verifica o e-mail, então no máx. 1 boas-vindas por destinatário a cada 24 h
 * (sem isso, cadastros em série com o e-mail de outra pessoa virariam um relé de mensagens pelo nosso domínio). */
const JANELA_BOAS_VINDAS_MS = 24 * 60 * 60 * 1000;

async function enviarBoasVindas(dados: Parameters<typeof enfileirarEmail>[0]) {
  const recentes = await prisma.emailEnviado.count({
    where: {
      tipo: 'boas_vindas',
      destinatario: dados.para.trim().toLowerCase(),
      criado_em: { gte: new Date(Date.now() - JANELA_BOAS_VINDAS_MS) },
    },
  });
  if (recentes > 0) return;
  await enfileirarEmail(dados);
}

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
    senha: senhaNova,
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

      // Boas-vindas depois do commit. enfileirarEmail não lança e não é aguardado: não atrasa nem derruba a resposta.
      const links = linksSistema();
      void enviarBoasVindas({
        tipo: 'boas_vindas',
        para: usuario.email,
        referencia: usuario.id,
        clinicaId: clinica.id,
        variaveis: {
          responsavel: dados.responsavel,
          clinica: clinica.nome,
          email: usuario.email,
          link_acesso: links.acesso,
          link_esqueci_senha: links.esqueciSenha,
        },
      }).catch((erro: unknown) => request.log.error({ err: erro }, 'Falha ao enfileirar e-mail de boas-vindas'));

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

  // ------------------------------------------------------------------ esqueci minha senha
  // Ao desligar a API, espera os pedidos em segundo plano terminarem (não deixa link gerado sem e-mail).
  app.addHook('onClose', async () => {
    await aguardarSolicitacoesRedefinicao();
  });

  app.post(
    '/esqueci-senha',
    { config: limiteEsqueciSenha, schema: { body: z.object({ email }) } },
    async (request, reply) => {
      // Sem await: a resposta sai antes de qualquer consulta (sem enumeração por tempo). Erros só no log.
      dispararSolicitacaoRedefinicao(request.body.email, request.ip, request.log);
      return reply.status(204).send();
    },
  );

  app.get(
    '/redefinir-senha/validar',
    { config: limiteRedefinicao, schema: { querystring: z.object({ token: tokenRedefinicao }) } },
    async (request) => validarTokenRedefinicao(request.query.token),
  );

  app.post(
    '/redefinir-senha',
    { config: limiteRedefinicao, schema: { body: z.object({ token: tokenRedefinicao, senha: senhaNova }) } },
    async (request, reply) => {
      await redefinirSenhaComToken(request.body.token, request.body.senha);
      return reply.status(204).send();
    },
  );
};

export default modulo;
