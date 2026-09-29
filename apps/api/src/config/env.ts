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
  HOST: z.string().default('0.0.0.0'),
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

export const env = {
  ...resultado.data,
  /** Caminho absoluto do diretório de uploads (UPLOAD_DIR é relativo ao cwd de apps/api). */
  UPLOAD_DIR_ABS: path.resolve(process.cwd(), resultado.data.UPLOAD_DIR),
  /** Origens liberadas no CORS. */
  ORIGENS_WEB: resultado.data.WEB_URL.split(',').map((s) => s.trim()).filter(Boolean),
};

export type Env = typeof env;
