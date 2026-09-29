/**
 * Tratamento de erros padronizado. Formato de resposta de erro:
 *   { erro: string (código), mensagem: string (pt-BR, pronta para exibir), ...extras }
 *
 * - ErroNegocio(status, codigo, mensagem, extras)       → status informado
 * - Validação Zod (schema da rota ou .parse manual)     → 400 { erro: 'validacao', detalhes: [{ campo, mensagem }] }
 * - Prisma P2002 (único) → 409 'registro_duplicado'; P2025 → 404; P2003 (FK) → 409 'registro_vinculado'
 * - Erros do Fastify com statusCode (429, 413, 415…)   → mesmo status
 * - Demais                                              → 500 'erro_interno' (logado)
 */
import fp from 'fastify-plugin';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { ErroNegocio } from '../utils/erros';

type Detalhe = { campo: string; mensagem: string };

export const pluginErros = fp(
  async (app) => {
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof ErroNegocio) {
        return reply.status(error.status).send({ erro: error.codigo, mensagem: error.message, ...error.extras });
      }

      if (hasZodFastifySchemaValidationErrors(error)) {
        const detalhes: Detalhe[] = error.validation.map((v) => ({
          campo: [error.validationContext, ...String(v.instancePath ?? '').split('/').filter(Boolean)].join('.'),
          mensagem: v.message ?? 'inválido',
        }));
        return reply.status(400).send({ erro: 'validacao', mensagem: 'Dados inválidos. Confira os campos.', detalhes });
      }

      if (error instanceof ZodError) {
        const detalhes: Detalhe[] = error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }));
        return reply.status(400).send({ erro: 'validacao', mensagem: 'Dados inválidos. Confira os campos.', detalhes });
      }

      if (isResponseSerializationError(error)) {
        request.log.error({ err: error }, 'Erro de serialização da resposta');
        return reply.status(500).send({ erro: 'erro_interno', mensagem: 'Erro interno ao montar a resposta.' });
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.status(409).send({
            erro: 'registro_duplicado',
            mensagem: 'Já existe um registro com esses dados.',
            campos: (error.meta?.target as string[] | undefined) ?? [],
          });
        }
        if (error.code === 'P2025') {
          return reply.status(404).send({ erro: 'nao_encontrado', mensagem: 'Registro não encontrado.' });
        }
        if (error.code === 'P2003') {
          return reply.status(409).send({
            erro: 'registro_vinculado',
            mensagem: 'Operação não permitida: o registro está vinculado a outros dados.',
          });
        }
      }

      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        const mensagens: Record<number, string> = {
          429: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
          413: 'Arquivo ou requisição grande demais.',
          415: 'Tipo de conteúdo não suportado.',
        };
        return reply.status(statusCode).send({
          erro: (error as { code?: string }).code?.toLowerCase() ?? 'requisicao_invalida',
          mensagem: mensagens[statusCode] ?? (error as Error).message,
        });
      }

      request.log.error({ err: error }, 'Erro não tratado');
      return reply.status(500).send({ erro: 'erro_interno', mensagem: 'Erro interno. Tente novamente em instantes.' });
    });

    app.setNotFoundHandler((request, reply) => {
      reply.status(404).send({ erro: 'rota_nao_encontrada', mensagem: `Rota ${request.method} ${request.url} não existe.` });
    });
  },
  { name: 'erros' },
);
