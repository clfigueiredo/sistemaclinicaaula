/**
 * "Esqueci minha senha" dos usuários da clínica (lógica das rotas em auth/index.ts).
 *
 * - O token vai só no link do e-mail (`crypto.randomBytes(32)`, base64url); no banco fica o SHA-256 hex.
 * - Vale VALIDADE_TOKEN_MS (1 hora) e uma única vez. Redefinir grava `senha_alterada_em` (derruba as sessões
 *   abertas — ver autenticarClinica) e invalida os outros links pendentes do mesmo usuário.
 * - O e-mail é único POR CLÍNICA: o mesmo endereço em N clínicas recebe N e-mails (um link por clínica).
 * - Enumeração de e-mails: a rota responde 204 SEMPRE e o trabalho (consultas, tokens, e-mail) roda em segundo
 *   plano, depois da resposta (`dispararSolicitacaoRedefinicao`) ⇒ o tempo de resposta não depende de o e-mail
 *   existir. Erros desse trabalho só vão para o log.
 * - Assinatura suspensa NÃO impede (o admin precisa entrar para pagar a fatura); clínica inativa e usuário
 *   inativo, sim.
 * - `TokenRedefinicaoSenha` é tabela de plataforma: só pelo prisma cru (nunca via request.db).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../../lib/prisma';
import { enfileirarEmail, linksSistema } from '../../servicos/email';
import { ErroNegocio } from '../../utils/erros';
import { chaveIp } from '../../utils/ip';
import { gerarHashSenha } from '../../utils/senha';

export const VALIDADE_TOKEN_MS = 60 * 60 * 1000;
export const TEXTO_VALIDADE_TOKEN = '1 hora';
/** Máximo de links criados por usuário na janela abaixo (passou ⇒ não gera, em silêncio). */
export const MAX_TOKENS_POR_JANELA = 3;
export const JANELA_LIMITE_TOKENS_MS = 60 * 60 * 1000;

export const erroTokenInvalido = () =>
  new ErroNegocio(400, 'token_invalido', 'Este link é inválido ou expirou. Peça um novo.');

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** "maria@dominio.com" ⇒ "ma***@dominio.com". */
export function mascararEmail(email: string): string {
  const [local = '', dominio = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${dominio}`;
}

// ----------------------------------------------------------------------------
// Solicitar (POST /auth/esqueci-senha)
// ----------------------------------------------------------------------------

/**
 * Gera um link para cada usuário ATIVO com o e-mail em clínica ativa e enfileira os e-mails.
 * Devolve quantos links foram gerados (uso interno/testes — a rota nunca revela isso).
 */
export async function solicitarRedefinicaoSenha(email: string, ip: string | null | undefined): Promise<number> {
  const usuarios = await prisma.usuario.findMany({
    where: { email, ativo: true, clinica: { status: 'ativa' } },
    select: { id: true, nome: true, email: true, clinica_id: true, clinica: { select: { nome: true } } },
  });

  let gerados = 0;
  for (const usuario of usuarios) {
    const token = randomBytes(32).toString('base64url');
    const registro = await prisma.$transaction(async (tx) => {
      // Trava por usuário: pedidos simultâneos não furam o limite por hora.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `redefinir-senha:${usuario.id}`);
      const recentes = await tx.tokenRedefinicaoSenha.count({
        where: { usuario_id: usuario.id, criado_em: { gte: new Date(Date.now() - JANELA_LIMITE_TOKENS_MS) } },
      });
      if (recentes >= MAX_TOKENS_POR_JANELA) return null;
      // Só o link mais recente vale: um pedido novo invalida os anteriores ainda pendentes.
      await tx.tokenRedefinicaoSenha.updateMany({
        where: { usuario_id: usuario.id, usado_em: null, expira_em: { gt: new Date() } },
        data: { usado_em: new Date() },
      });
      return tx.tokenRedefinicaoSenha.create({
        data: {
          usuario_id: usuario.id,
          token_hash: hashToken(token),
          expira_em: new Date(Date.now() + VALIDADE_TOKEN_MS),
          ip: chaveIp(ip),
        },
      });
    });
    if (!registro) continue;
    gerados++;

    // Depois do commit; enfileirarEmail não lança.
    await enfileirarEmail({
      tipo: 'redefinir_senha',
      para: usuario.email,
      referencia: registro.id,
      clinicaId: usuario.clinica_id,
      variaveis: {
        nome: usuario.nome,
        clinica: usuario.clinica.nome,
        link_redefinir: linksSistema().redefinirSenha(token),
        validade: TEXTO_VALIDADE_TOKEN,
      },
    });
  }
  return gerados;
}

const solicitacoesEmAndamento = new Set<Promise<unknown>>();

/**
 * Dispara a solicitação SEM bloquear a resposta (tempo de resposta igual para e-mail existente ou não).
 * Erros só vão para o log.
 */
export function dispararSolicitacaoRedefinicao(email: string, ip: string | null | undefined, log: FastifyBaseLogger): void {
  const tarefa = solicitarRedefinicaoSenha(email, ip)
    .catch((erro: unknown) => {
      log.error({ err: erro }, 'Falha ao processar pedido de redefinição de senha');
    })
    .finally(() => {
      solicitacoesEmAndamento.delete(tarefa);
    });
  solicitacoesEmAndamento.add(tarefa);
}

/** Espera as solicitações disparadas em segundo plano terminarem (testes e desligamento da API). */
export async function aguardarSolicitacoesRedefinicao(): Promise<void> {
  while (solicitacoesEmAndamento.size) await Promise.allSettled([...solicitacoesEmAndamento]);
}

// ----------------------------------------------------------------------------
// Validar (GET /auth/redefinir-senha/validar)
// ----------------------------------------------------------------------------

const incluirUsuario = {
  usuario: {
    select: { id: true, email: true, ativo: true, clinica: { select: { nome: true, status: true } } },
  },
} as const;

type TokenComUsuario = {
  usado_em: Date | null;
  expira_em: Date;
  usuario: { ativo: boolean; clinica: { status: string } };
};

function tokenUtilizavel(t: TokenComUsuario | null, agora = new Date()): boolean {
  return !!t && !t.usado_em && t.expira_em > agora && t.usuario.ativo && t.usuario.clinica.status === 'ativa';
}

export async function validarTokenRedefinicao(token: string) {
  const registro = await prisma.tokenRedefinicaoSenha.findUnique({
    where: { token_hash: hashToken(token) },
    include: incluirUsuario,
  });
  if (!registro || !tokenUtilizavel(registro)) throw erroTokenInvalido();
  return { valido: true as const, clinica: registro.usuario.clinica.nome, email: mascararEmail(registro.usuario.email) };
}

// ----------------------------------------------------------------------------
// Redefinir (POST /auth/redefinir-senha)
// ----------------------------------------------------------------------------

export async function redefinirSenhaComToken(token: string, senha: string): Promise<void> {
  const tokenHash = hashToken(token);
  // Barra token inválido antes do bcrypt (custo) — a transação confere de novo sob trava.
  const previa = await prisma.tokenRedefinicaoSenha.findUnique({ where: { token_hash: tokenHash }, include: incluirUsuario });
  if (!previa || !tokenUtilizavel(previa)) throw erroTokenInvalido();
  const senhaHash = await gerarHashSenha(senha);

  await prisma.$transaction(async (tx) => {
    // FOR UPDATE: dois envios simultâneos do mesmo link — o segundo espera e vê `usado_em` preenchido.
    const travado = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tokens_redefinicao_senha WHERE token_hash = ${tokenHash} FOR UPDATE`;
    if (!travado.length) throw erroTokenInvalido();
    const registro = await tx.tokenRedefinicaoSenha.findUnique({ where: { id: travado[0]!.id }, include: incluirUsuario });
    const agora = new Date();
    if (!registro || !tokenUtilizavel(registro, agora)) throw erroTokenInvalido();

    await tx.usuario.update({
      where: { id: registro.usuario_id },
      // senha_alterada_em derruba os tokens de sessão emitidos antes (ver autenticarClinica).
      data: { senha_hash: senhaHash, senha_alterada_em: agora },
    });
    await tx.tokenRedefinicaoSenha.update({ where: { id: registro.id }, data: { usado_em: agora } });
    await tx.tokenRedefinicaoSenha.updateMany({
      where: { usuario_id: registro.usuario_id, usado_em: null },
      data: { usado_em: agora },
    });
  });
}
