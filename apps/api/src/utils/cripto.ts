/**
 * Criptografia simétrica de segredos guardados no banco (ex.: credenciais dos gateways de pagamento).
 *
 *   AES-256-GCM, chave de 32 bytes = env.CHAVE_CRIPTOGRAFIA (64 hex; em dev/teste há uma chave de
 *   desenvolvimento se a variável não estiver definida — ver config/env.ts).
 *
 *   const cifrado = criptografar('sk_live_abc123');   // "v1:<iv b64>:<tag b64>:<dados b64>"
 *   descriptografar(cifrado);                          // 'sk_live_abc123'
 *   mascararSegredo('sk_live_abc123');                 // '••••c123'   (NUNCA devolva o segredo em claro)
 *   finalSegredo('sk_live_abc123');                    // 'c123'       (para colunas *_final)
 *
 * IV aleatório de 12 bytes por valor (mesmo texto ⇒ cifrados diferentes). O tag de autenticação detecta
 * adulteração ou chave errada: descriptografar lança ErroCripto.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

export class ErroCripto extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroCripto';
  }
}

function chave(chaveHex?: string): Buffer {
  const hex = chaveHex ?? env.CHAVE_CRIPTOGRAFIA_EFETIVA;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new ErroCripto('Chave de criptografia inválida (esperado 64 hex).');
  return Buffer.from(hex, 'hex');
}

/** Cifra um texto. `chaveHex` só para testes/rotação; o padrão é a chave do ambiente. */
export function criptografar(texto: string, chaveHex?: string): string {
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chave(chaveHex), iv, { authTagLength: TAMANHO_TAG });
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [VERSAO, iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join(':');
}

/** Decifra um valor produzido por `criptografar`. Lança ErroCripto se o formato/chave/tag não conferirem. */
export function descriptografar(cifrado: string, chaveHex?: string): string {
  const partes = cifrado.split(':');
  if (partes.length !== 4 || partes[0] !== VERSAO) throw new ErroCripto('Formato de segredo cifrado inválido.');
  const [, ivB64, tagB64, dadosB64] = partes as [string, string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  // GCM aceitaria tags truncadas (4–16 bytes) — com tag curta a falsificação fica viável. Exige 16/12 bytes.
  if (tag.length !== TAMANHO_TAG || iv.length !== TAMANHO_IV) {
    throw new ErroCripto('Formato de segredo cifrado inválido.');
  }
  try {
    const decifra = createDecipheriv(ALGORITMO, chave(chaveHex), iv, { authTagLength: TAMANHO_TAG });
    decifra.setAuthTag(tag);
    return Buffer.concat([decifra.update(Buffer.from(dadosB64, 'base64')), decifra.final()]).toString('utf8');
  } catch {
    throw new ErroCripto('Não foi possível decifrar o segredo (chave diferente ou dado adulterado).');
  }
}

/** Cifra um objeto como JSON (ex.: credenciais { api_key, ... }). */
export function criptografarJson(valor: unknown, chaveHex?: string): string {
  return criptografar(JSON.stringify(valor), chaveHex);
}

export function descriptografarJson<T = unknown>(cifrado: string, chaveHex?: string): T {
  return JSON.parse(descriptografar(cifrado, chaveHex)) as T;
}

/** Últimos 4 caracteres (para as colunas `*_final`). Segredo com menos de 8 caracteres ⇒ '' (não revela). */
export function finalSegredo(segredo: string | null | undefined): string {
  if (!segredo || segredo.length < 8) return '';
  return segredo.slice(-4);
}

/** Versão para exibição: "••••" + últimos 4 (ou só "••••" se curto/vazio). */
export function mascararSegredo(segredo: string | null | undefined): string {
  if (!segredo) return '';
  return `••••${finalSegredo(segredo)}`;
}
