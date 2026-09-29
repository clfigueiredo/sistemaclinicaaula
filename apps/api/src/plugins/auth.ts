/**
 * ============================================================================
 * AUTENTICAÇÃO (JWT) — dois tipos de token
 * ============================================================================
 *
 *   Plataforma (super admin): { tipo: 'plataforma', usuarioId }
 *   Clínica:                  { tipo: 'clinica', usuarioId, clinicaId, papel, profissionalId? }
 *
 * Guards (use como hook `onRequest` do módulo ou como `preHandler` da rota):
 *
 *   autenticarAdmin     → exige token de plataforma; preenche request.adminPlataforma
 *   autenticarClinica   → exige token de clínica; recarrega o usuário do banco (ativo, papel atual),
 *                         preenche request.usuarioClinica, request.clinicaId, request.db (tenant)
 *                         e request.assinatura; bloqueia métodos não-GET se a assinatura estiver
 *                         vencida/cancelada/bloqueada (somente leitura).
 *   exigirPapel(...p)   → autentica a clínica (se ainda não autenticada) e exige um dos papéis.
 *
 * Exemplo em um módulo:
 *   const modulo: FastifyPluginAsyncZod = async (app) => {
 *     app.addHook('onRequest', autenticarClinica);             // todas as rotas do módulo
 *     app.get('/', async (request) => request.db.convenio.findMany());
 *     app.post('/', { preHandler: exigirPapel('admin') }, handler);
 *   };
 * ============================================================================
 */
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PapelUsuario, StatusAssinatura } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ErroNegocio, erros } from '../utils/erros';
import { criarDbTenant, type DbTenant } from './tenant';
import { ehSomenteLeitura, statusEfetivo } from './recursos';

export type TokenPlataforma = { tipo: 'plataforma'; usuarioId: string };
export type TokenClinica = {
  tipo: 'clinica';
  usuarioId: string;
  clinicaId: string;
  papel: PapelUsuario;
  profissionalId?: string | null;
};
export type TokenPayload = TokenPlataforma | TokenClinica;

export type UsuarioClinicaAutenticado = {
  id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  profissionalId: string | null;
  clinicaId: string;
};

export type AdminPlataformaAutenticado = { id: string; nome: string; email: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Prisma com escopo da clínica do token. Só existe após autenticarClinica. */
    db: DbTenant;
    /** clinica_id do token (única fonte válida de clinica_id). Só existe após autenticarClinica. */
    clinicaId: string;
    usuarioClinica: UsuarioClinicaAutenticado | null;
    adminPlataforma: AdminPlataformaAutenticado | null;
    assinatura: { status: StatusAssinatura | null; somenteLeitura: boolean } | null;
  }
}

const METODOS_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

async function verificarToken(request: FastifyRequest): Promise<TokenPayload> {
  try {
    return await request.jwtVerify<TokenPayload>();
  } catch {
    throw erros.naoAutenticado();
  }
}

export async function autenticarAdmin(request: FastifyRequest, _reply?: FastifyReply): Promise<void> {
  if (request.adminPlataforma) return;
  const token = await verificarToken(request);
  if (token.tipo !== 'plataforma') throw erros.proibido('Acesso restrito ao administrador da plataforma.');
  const admin = await prisma.usuarioPlataforma.findUnique({ where: { id: token.usuarioId } });
  if (!admin || !admin.ativo) throw erros.naoAutenticado();
  request.adminPlataforma = { id: admin.id, nome: admin.nome, email: admin.email };
}

export async function autenticarClinica(request: FastifyRequest, _reply?: FastifyReply): Promise<void> {
  if (request.usuarioClinica) return;
  const token = await verificarToken(request);
  if (token.tipo !== 'clinica') throw erros.proibido('Este recurso é exclusivo dos usuários da clínica.');

  const usuario = await prisma.usuario.findFirst({
    where: { id: token.usuarioId, clinica_id: token.clinicaId },
    include: { clinica: { select: { status: true, assinatura: { select: { status: true, expira_em: true } } } } },
  });
  if (!usuario || !usuario.ativo) throw erros.naoAutenticado();
  if (usuario.clinica.status !== 'ativa') {
    throw new ErroNegocio(403, 'clinica_inativa', 'Esta clínica está inativa. Entre em contato com o suporte.');
  }

  const status = usuario.clinica.assinatura ? statusEfetivo(usuario.clinica.assinatura) : null;
  const somenteLeitura = ehSomenteLeitura(status);
  if (somenteLeitura && !METODOS_LEITURA.has(request.method)) {
    throw new ErroNegocio(
      403,
      'assinatura_inativa',
      'Sua assinatura está vencida, cancelada ou bloqueada: o sistema está em modo somente leitura. Regularize o plano para voltar a editar.',
      { status },
    );
  }

  request.usuarioClinica = {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papel,
    profissionalId: usuario.profissional_id,
    clinicaId: usuario.clinica_id,
  };
  request.clinicaId = usuario.clinica_id;
  request.assinatura = { status, somenteLeitura };
  request.db = criarDbTenant(usuario.clinica_id);
}

/** preHandler que exige um dos papéis. Autentica a clínica se ainda não foi feito. */
export function exigirPapel(...papeis: PapelUsuario[]) {
  return async function exigirPapelHandler(request: FastifyRequest, reply: FastifyReply) {
    await autenticarClinica(request, reply);
    if (!papeis.includes(request.usuarioClinica!.papel)) {
      throw erros.proibido('Seu perfil não tem permissão para esta ação.');
    }
  };
}

/** Assina token de clínica. */
export function assinarTokenClinica(app: FastifyInstance, dados: Omit<TokenClinica, 'tipo'>): string {
  return app.jwt.sign({ tipo: 'clinica', ...dados });
}

/** Assina token de plataforma (super admin). */
export function assinarTokenPlataforma(app: FastifyInstance, usuarioId: string): string {
  return app.jwt.sign({ tipo: 'plataforma', usuarioId });
}

export const pluginAuth = fp(
  async (app) => {
    await app.register(fastifyJwt, {
      secret: env.JWT_SECRET,
      sign: { expiresIn: env.JWT_EXPIRA_EM },
    });
    app.decorateRequest('db', null as unknown as DbTenant);
    app.decorateRequest('clinicaId', '');
    app.decorateRequest('usuarioClinica', null);
    app.decorateRequest('adminPlataforma', null);
    app.decorateRequest('assinatura', null);
  },
  { name: 'auth' },
);
