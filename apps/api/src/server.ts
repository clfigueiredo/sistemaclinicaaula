import { buildApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { fecharFilas } from './servicos/filas';
import { iniciarWorkers } from './workers';

async function main() {
  const app = await buildApp();

  if (env.EXECUTAR_WORKERS) {
    await iniciarWorkers(app.log);
  }

  const encerrar = async (sinal: string) => {
    app.log.info(`Recebido ${sinal}, encerrando...`);
    await app.close();
    await fecharFilas();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((erro) => {
  console.error('Falha ao iniciar a API:', erro);
  process.exit(1);
});
