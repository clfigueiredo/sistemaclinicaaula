import fs from 'node:fs';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from './config/env';
import { pluginErros } from './plugins/erros';
import { pluginAuth } from './plugins/auth';
import { registrarModulos } from './modulos';

export type OpcoesApp = { logger?: FastifyServerOptions['logger'] };

function loggerPadrao(): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'test') return false;
  if (env.NODE_ENV === 'development') {
    return {
      level: env.LOG_LEVEL,
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    };
  }
  return { level: env.LOG_LEVEL };
}

/** Monta a aplicação Fastify (exportada para testes: `const app = await buildApp(); app.inject(...)`). */
export async function buildApp(opcoes: OpcoesApp = {}) {
  const app = Fastify({
    logger: opcoes.logger ?? loggerPadrao(),
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(pluginErros);
  await app.register(cors, {
    origin: env.ORIGENS_WEB,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  // global: false → só rotas com `config: { rateLimit: {...} }` são limitadas (ex.: login).
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 5 },
  });
  await app.register(pluginAuth);

  fs.mkdirSync(env.UPLOAD_DIR_ABS, { recursive: true });

  app.get('/saude', async () => ({ status: 'ok', horario: new Date().toISOString() }));

  await registrarModulos(app);
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
