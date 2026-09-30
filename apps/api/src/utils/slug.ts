/**
 * Slug público da clínica (URL do agendamento online: /agendar/:slug).
 *
 *   gerarSlug('Clínica São José')        → 'clinica-sao-jose'
 *   validarSlug('clinica-sao-jose')      → true
 *   await gerarSlugUnico('Clínica X')     → 'clinica-x' ou 'clinica-x-2', 'clinica-x-3'…
 *
 * Mesma regra do SQL da migration fase2_produto (e do CHECK `clinicas_slug_formato`):
 * minúsculas sem acento, dígitos e hífens simples; sem hífen nas pontas; 3–60 caracteres.
 */
import { prisma } from '../lib/prisma';

export const TAMANHO_MAX_SLUG = 60;
export const REGEX_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Slugs reservados (colidiriam com rotas do front ou confundiriam o paciente). */
export const SLUGS_RESERVADOS = new Set(['admin', 'api', 'login', 'cadastro', 'agendar', 'publico', 'novo', 'nova']);

export function gerarSlug(texto: string): string {
  const base = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAMANHO_MAX_SLUG)
    .replace(/-+$/g, '');
  return base || 'clinica';
}

export function validarSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= TAMANHO_MAX_SLUG && REGEX_SLUG.test(slug) && !SLUGS_RESERVADOS.has(slug);
}

type ClienteClinica = { clinica: { findFirst: (args: { where: { slug: string }; select: { id: true } }) => Promise<unknown> } };

/**
 * Gera um slug livre a partir do nome (prisma cru por padrão, ou o `tx` de uma transação).
 * O índice único `clinicas_slug_key` continua sendo a garantia final (P2002 em corrida).
 */
export async function gerarSlugUnico(nome: string, cliente: ClienteClinica = prisma as unknown as ClienteClinica) {
  let base = gerarSlug(nome);
  if (base.length < 3 || SLUGS_RESERVADOS.has(base)) base = `clinica-${base}`.slice(0, TAMANHO_MAX_SLUG);
  for (let n = 1; n < 1000; n++) {
    const sufixo = n === 1 ? '' : `-${n}`;
    const candidato = `${base.slice(0, TAMANHO_MAX_SLUG - sufixo.length).replace(/-+$/g, '')}${sufixo}`;
    const existe = await cliente.clinica.findFirst({ where: { slug: candidato }, select: { id: true } });
    if (!existe) return candidato;
  }
  return `${base.slice(0, 40)}-${Date.now().toString(36)}`;
}
