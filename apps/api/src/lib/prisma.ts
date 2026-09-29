import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Prisma "CRU" (sem filtro de tenant).
 *
 * ⚠️ Use SOMENTE em: módulos do super admin (admin-*), auth, workers, seed e serviços de
 * plataforma. Em rotas da clínica use SEMPRE `request.db` (ver src/plugins/tenant.ts).
 */
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') globalParaPrisma.prisma = prisma;
