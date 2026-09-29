/**
 * Workers BullMQ.
 *
 * Decisão: em DEV os workers rodam no MESMO processo da API quando EXECUTAR_WORKERS=true
 * (padrão do .env). Em produção, rode num processo separado com `npm run start:worker`
 * (src/worker.ts) e deixe EXECUTAR_WORKERS=false na API. Para separar também em dev:
 * EXECUTAR_WORKERS=false no .env + `npm run dev:worker` num segundo terminal.
 *
 * TODO(fase 2 — agente WhatsApp): registrar aqui os workers de
 *   - NOMES_FILAS.LEMBRETES (job repeatable diário que enfileira os lembretes de amanhã)
 *   - NOMES_FILAS.ENVIO_WHATSAPP (envio com intervalo aleatório 20–40 s por clínica)
 * usando criarWorker() de src/servicos/filas.ts. Crie os processadores em arquivos próprios
 * nesta pasta (ex.: workers/lembretes.ts, workers/envioWhatsapp.ts).
 */
type Logger = { info: (msg: string) => void };

export async function iniciarWorkers(log: Logger = console): Promise<void> {
  // TODO(fase 2): criarWorker(NOMES_FILAS.ENVIO_WHATSAPP, ...); criarWorker(NOMES_FILAS.LEMBRETES, ...)
  log.info('Workers: nenhum worker registrado ainda (fase 2).');
}
