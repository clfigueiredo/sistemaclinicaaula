/**
 * Workers BullMQ.
 *
 * Decisão: em DEV os workers rodam no MESMO processo da API quando EXECUTAR_WORKERS=true
 * (padrão do .env). Em produção, rode num processo separado com `npm run start:worker`
 * (src/worker.ts) e deixe EXECUTAR_WORKERS=false na API. Para separar também em dev:
 * EXECUTAR_WORKERS=false no .env + `npm run dev:worker` num segundo terminal.
 *
 * Registrados:
 *   - NOMES_FILAS.ENVIO_WHATSAPP (workers/envioWhatsapp.ts): envio com intervalo aleatório 20–40 s por clínica
 *   - NOMES_FILAS.LEMBRETES (workers/lembretes.ts): job diário 09:00 que enfileira os lembretes de amanhã
 *
 * Shutdown gracioso: `fecharFilas()` (servicos/filas.ts) fecha os workers (espera os jobs em
 * andamento), as filas e a conexão Redis — chamado por server.ts e worker.ts em SIGINT/SIGTERM.
 */
import { iniciarWorkerEnvioWhatsapp } from './envioWhatsapp';
import { agendarJobDiarioLembretes, iniciarWorkerLembretes } from './lembretes';

type Logger = { info: (msg: string) => void; error?: (...args: unknown[]) => void };

let iniciados = false;

export async function iniciarWorkers(log: Logger = console): Promise<void> {
  if (iniciados) return;
  iniciados = true;

  const envio = iniciarWorkerEnvioWhatsapp();
  const lembretes = iniciarWorkerLembretes();
  for (const w of [envio, lembretes]) {
    w.on('error', (erro) => (log.error ?? console.error)(`Worker ${w.name}: ${erro.message}`));
  }
  await agendarJobDiarioLembretes();
  log.info('Workers: envio-whatsapp (intervalo 20–40 s por clínica) e lembretes (diário 09:00) iniciados.');
}
