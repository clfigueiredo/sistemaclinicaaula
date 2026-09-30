import path from 'node:path';
import { z } from 'zod';

/**
 * Variáveis de ambiente validadas com Zod. As variáveis são carregadas do .env da RAIZ
 * pelos scripts npm (dotenv-cli). Importe `env` em vez de ler process.env diretamente.
 */
const booleano = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const esquemaEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3333),
  /** Interface em que a API escuta (0.0.0.0 = todas; 127.0.0.1 = só local). */
  HOST: z.string().default('0.0.0.0'),
  /**
   * Confiar em X-Forwarded-For/Proto (IP real do cliente no rate limit e em logs_acesso).
   * 'false' (padrão) = ignora os cabeçalhos; '1' = confia em 1 proxy (Caddy na frente da API);
   * 'true' = confia em qualquer um (NÃO use exposto à internet); ou lista de IPs/CIDRs separada por vírgula.
   */
  TRUST_PROXY: z.string().default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter pelo menos 16 caracteres'),
  JWT_EXPIRA_EM: z.string().default('12h'),
  WEB_URL: z.string().default('http://localhost:5173'),
  EXECUTAR_WORKERS: booleano,
  UPLOAD_DIR: z.string().default('./uploads'),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(10),
  WPPCONNECT_URL: z.string().default('http://localhost:21465'),
  WPPCONNECT_SECRET_KEY: z.string().default(''),
  WEBHOOK_TOKEN: z.string().default(''),
  TZ_PADRAO: z.string().default('America/Sao_Paulo'),
});

const resultado = esquemaEnv.safeParse(process.env);
if (!resultado.success) {
  console.error('❌ Variáveis de ambiente inválidas:', z.flattenError(resultado.error).fieldErrors);
  throw new Error('Variáveis de ambiente inválidas. Confira o arquivo .env na raiz do projeto.');
}

// ----------------------------------------------------------------------------
// Segredos: em produção, recusa valores fracos/de exemplo; em dev só avisa.
// ----------------------------------------------------------------------------

const PALAVRAS_DE_EXEMPLO = ['troque', 'exemplo', 'changeme'];
const MIN_SEGREDO = 32;

type EnvSegredos = Pick<z.infer<typeof esquemaEnv>, 'JWT_SECRET' | 'WEBHOOK_TOKEN' | 'WPPCONNECT_SECRET_KEY' | 'REDIS_URL'>;

/** Lista os problemas de segurança da configuração (vazia = ok). Exportada para testes. */
export function problemasDeSeguranca(e: EnvSegredos): string[] {
  const problemas: string[] = [];
  for (const nome of ['JWT_SECRET', 'WEBHOOK_TOKEN', 'WPPCONNECT_SECRET_KEY'] as const) {
    const valor = e[nome] ?? '';
    if (valor.length < MIN_SEGREDO) {
      problemas.push(`${nome} deve ter pelo menos ${MIN_SEGREDO} caracteres (gere com: openssl rand -hex 32).`);
    }
    const minusculo = valor.toLowerCase();
    const palavra = PALAVRAS_DE_EXEMPLO.find((p) => minusculo.includes(p));
    if (palavra) problemas.push(`${nome} parece um valor de exemplo (contém "${palavra}"). Gere um segredo novo.`);
  }
  let senhaRedis = '';
  try {
    senhaRedis = decodeURIComponent(new URL(e.REDIS_URL).password);
  } catch {
    problemas.push('REDIS_URL inválida.');
  }
  if (!senhaRedis) problemas.push('REDIS_URL deve incluir senha (redis://:SENHA@host:6379).');
  return problemas;
}

/** Em produção lança erro se houver problemas; em desenvolvimento apenas avisa (console.warn). */
export function validarSegurancaEnv(e: EnvSegredos & { NODE_ENV: string }): void {
  if (e.NODE_ENV === 'test') return;
  const problemas = problemasDeSeguranca(e);
  if (!problemas.length) return;
  if (e.NODE_ENV === 'production') {
    console.error('❌ Configuração insegura para produção:\n - ' + problemas.join('\n - '));
    throw new Error('Configuração insegura para produção. Corrija as variáveis de ambiente (veja docs/DEPLOY.md).');
  }
  console.warn('⚠️  Configuração insegura (aceita só em desenvolvimento):\n - ' + problemas.join('\n - '));
}

validarSegurancaEnv(resultado.data);

/** Converte TRUST_PROXY para o formato aceito pelo Fastify. */
export function interpretarTrustProxy(
  valor: string,
): boolean | string | ((endereco: string, salto: number) => boolean) {
  const v = valor.trim().toLowerCase();
  if (v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) {
    // N = confia nos N proxies mais próximos (mesma semântica do trustProxy numérico do Fastify).
    const saltos = Number(v);
    return (_endereco, salto) => salto < saltos;
  }
  return valor.trim(); // IPs/CIDRs separados por vírgula
}

export const env = {
  ...resultado.data,
  /** Caminho absoluto do diretório de uploads (UPLOAD_DIR é relativo ao cwd de apps/api). */
  UPLOAD_DIR_ABS: path.resolve(process.cwd(), resultado.data.UPLOAD_DIR),
  /** Origens liberadas no CORS. */
  ORIGENS_WEB: resultado.data.WEB_URL.split(',').map((s) => s.trim()).filter(Boolean),
  /** TRUST_PROXY já convertido para o Fastify. */
  TRUST_PROXY_FASTIFY: interpretarTrustProxy(resultado.data.TRUST_PROXY),
};

export type Env = typeof env;
