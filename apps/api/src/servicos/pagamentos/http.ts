/**
 * Utilitários HTTP e de segurança compartilhados pelos adaptadores de pagamento (fetch nativo, sem SDK).
 *
 *   const dados = await requisitarJson('stripe', 'https://api.stripe.com/v1/balance', { headers });
 *
 * Erros viram ErroGatewayPagamento com mensagem amigável em pt-BR:
 *   - 401/403 ⇒ credencial recusada (temporario = false)
 *   - 4xx     ⇒ mensagem do próprio gateway (temporario = false)
 *   - 5xx, 429, timeout, rede ⇒ temporario = true (o chamador pode tentar de novo)
 * Nunca inclui credenciais na mensagem nem no `detalhe`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErroGatewayPagamento, type ProvedorPagamento, type ResultadoTesteConexao } from './tipos';

export const NOMES_GATEWAY: Record<ProvedorPagamento, string> = {
  asaas: 'Asaas',
  stripe: 'Stripe',
  mercado_pago: 'Mercado Pago',
};

export const TIMEOUT_GATEWAY_MS = 15_000;

/** Extrai a mensagem de erro dos formatos de Asaas, Stripe e Mercado Pago. */
export function mensagemDoGateway(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const c = corpo as Record<string, unknown>;
  // Asaas: { errors: [{ code, description }] }
  if (Array.isArray(c.errors) && c.errors.length) {
    const e = c.errors[0] as Record<string, unknown>;
    if (typeof e.description === 'string') return e.description;
  }
  // Stripe: { error: { message } }
  if (c.error && typeof c.error === 'object') {
    const e = c.error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
  }
  // Mercado Pago: { message, cause: [{ description }] }
  if (Array.isArray(c.cause) && c.cause.length) {
    const e = c.cause[0] as Record<string, unknown>;
    if (typeof e.description === 'string' && e.description) return e.description;
  }
  if (typeof c.message === 'string') return c.message;
  if (typeof c.error === 'string') return c.error;
  return null;
}

export async function requisitarJson<T = Record<string, unknown>>(
  provedor: ProvedorPagamento,
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_GATEWAY_MS,
): Promise<T> {
  const nome = NOMES_GATEWAY[provedor];
  let resposta: Response;
  try {
    resposta = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
    throw new ErroGatewayPagamento(
      timeout ? `O ${nome} não respondeu a tempo. Tente novamente.` : `Não foi possível conectar ao ${nome}.`,
      provedor,
      true,
    );
  }

  const texto = await resposta.text().catch(() => '');
  let corpo: unknown = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = texto;
    }
  }

  if (resposta.ok) return (corpo ?? {}) as T;

  const doGateway = mensagemDoGateway(corpo);
  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroGatewayPagamento(
      `Credenciais recusadas pelo ${nome} (HTTP ${resposta.status}). Confira a chave e o ambiente (sandbox/produção).`,
      provedor,
      false,
      { status: resposta.status, mensagem: doGateway },
    );
  }
  const temporario = resposta.status >= 500 || resposta.status === 429;
  throw new ErroGatewayPagamento(
    doGateway
      ? `${nome}: ${doGateway}`
      : temporario
        ? `O ${nome} está indisponível no momento (HTTP ${resposta.status}). Tente novamente.`
        : `O ${nome} recusou a requisição (HTTP ${resposta.status}).`,
    provedor,
    temporario,
    { status: resposta.status, corpo },
  );
}

/** Converte qualquer erro de um teste de conexão em { ok: false, mensagem }. */
export async function testarComSeguranca(
  provedor: ProvedorPagamento,
  chamada: () => Promise<string>,
): Promise<ResultadoTesteConexao> {
  try {
    return { ok: true, mensagem: await chamada() };
  } catch (e) {
    if (e instanceof ErroGatewayPagamento) return { ok: false, mensagem: e.message };
    return { ok: false, mensagem: `Falha inesperada ao testar o ${NOMES_GATEWAY[provedor]}.` };
  }
}

/** Comparação de segredos em tempo constante (tamanhos diferentes ⇒ false, sem vazar por timing do conteúdo). */
export function segredosIguais(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Compara com ele mesmo para gastar tempo equivalente e devolve false.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function hmacSha256Hex(segredo: string, mensagem: string): string {
  return createHmac('sha256', segredo).update(mensagem, 'utf8').digest('hex');
}

/** Primeiro valor de um cabeçalho (Node junta repetidos em array). Nome em minúsculas. */
export function cabecalho(cabecalhos: Record<string, string | string[] | undefined>, nome: string): string | null {
  const v = cabecalhos[nome.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

/** Converte reais (number) em centavos inteiros sem erro de ponto flutuante. */
export function paraCentavos(valor: number): number {
  return Math.round(valor * 100);
}

/** 'YYYY-MM-DD' ⇒ timestamp Unix (s) do fim do dia em America/Sao_Paulo (23:59:59 -03:00). */
export function fimDoDiaUnix(dataIso: string): number {
  return Math.floor(new Date(`${dataIso}T23:59:59-03:00`).getTime() / 1000);
}

/** Corpo application/x-www-form-urlencoded com a notação de colchetes do Stripe (a[b][0]=c). */
export function formUrlEncoded(dados: Record<string, unknown>): string {
  const partes: string[] = [];
  const adicionar = (chave: string, valor: unknown) => {
    if (valor === undefined || valor === null) return;
    if (Array.isArray(valor)) {
      valor.forEach((v, i) => adicionar(`${chave}[${i}]`, v));
    } else if (typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) adicionar(`${chave}[${k}]`, v);
    } else {
      partes.push(`${encodeURIComponent(chave)}=${encodeURIComponent(String(valor))}`);
    }
  };
  for (const [k, v] of Object.entries(dados)) adicionar(k, v);
  return partes.join('&');
}
