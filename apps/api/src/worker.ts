/** Processo separado só com os workers BullMQ (produção: `npm run start:worker`). */
import { prisma } from './lib/prisma';
import { fecharFilas } from './servicos/filas';
import { iniciarWorkers } from './workers';

async function main() {
  await iniciarWorkers(console);
  console.info('Processo de workers em execução.');
  const encerrar = async () => {
    await fecharFilas();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void encerrar());
  process.on('SIGTERM', () => void encerrar());
}

main().catch((erro) => {
  console.error('Falha ao iniciar os workers:', erro);
  process.exit(1);
});
