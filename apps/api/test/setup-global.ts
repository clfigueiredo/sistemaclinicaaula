import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Cria o banco de teste (se não existir) e aplica as migrations. */
export default async function setup() {
  const urlTeste =
    process.env.DATABASE_URL_TESTE ?? 'postgresql://clinica:clinica@localhost:5432/clinica_teste?schema=public';
  const nomeBanco = new URL(urlTeste).pathname.replace('/', '');
  const urlAdmin = new URL(urlTeste);
  urlAdmin.pathname = '/postgres';

  const admin = new PrismaClient({ datasourceUrl: urlAdmin.toString() });
  try {
    const existe = await admin.$queryRawUnsafe<unknown[]>('SELECT 1 FROM pg_database WHERE datname = $1', nomeBanco);
    if (existe.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${nomeBanco}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: urlTeste },
    stdio: 'pipe',
  });
}
