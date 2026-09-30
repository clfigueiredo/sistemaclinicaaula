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
 *   Fase 2 do produto (stubs no-op até os módulos donos implementarem — ver docs/FASE2.md):
 *   - FINANCEIRO_RECORRENCIAS (workers/recorrenciasFinanceiras.ts, dono: financeiro) diário 06:00
 *   - RETORNOS (workers/retornos.ts, dono: retornos) diário 09:30
 *   - SOLICITACOES_AGENDAMENTO (workers/solicitacoesAgendamento.ts, dono: agendamento-online) de hora em hora
 *   - COBRANCAS (workers/cobrancas.ts, dono: admin-cobranca) diário 07:00
 *
 * Shutdown gracioso: `fecharFilas()` (servicos/filas.ts) fecha os workers (espera os jobs em
 * andamento), as filas e a conexão Redis — chamado por server.ts e worker.ts em SIGINT/SIGTERM.
 */
import { iniciarWorkerEnvioWhatsapp } from './envioWhatsapp';
import { agendarJobDiarioLembretes, iniciarWorkerLembretes } from './lembretes';
import { agendarJobDiarioRecorrencias, iniciarWorkerDiarioRecorrencias } from './recorrenciasFinanceiras';
import { agendarJobDiarioRetornos, iniciarWorkerDiarioRetornos } from './retornos';
import { agendarJobExpirarSolicitacoes, iniciarWorkerExpirarSolicitacoes } from './solicitacoesAgendamento';
import { agendarJobDiarioCobrancas, iniciarWorkerDiarioCobrancas } from './cobrancas';

type Logger = { info: (msg: string) => void; error?: (...args: unknown[]) => void };

let iniciados = false;

export async function iniciarWorkers(log: Logger = console): Promise<void> {
  if (iniciados) return;
  iniciados = true;

  const workers = [
    iniciarWorkerEnvioWhatsapp(),
    iniciarWorkerLembretes(),
    // Fase 2
    iniciarWorkerDiarioRecorrencias(),
    iniciarWorkerDiarioRetornos(),
    iniciarWorkerExpirarSolicitacoes(),
    iniciarWorkerDiarioCobrancas(),
  ];
  for (const w of workers) {
    w.on('error', (erro) => (log.error ?? console.error)(`Worker ${w.name}: ${erro.message}`));
  }
  await agendarJobDiarioLembretes();
  await agendarJobDiarioRecorrencias();
  await agendarJobDiarioRetornos();
  await agendarJobExpirarSolicitacoes();
  await agendarJobDiarioCobrancas();
  log.info(
    'Workers: envio-whatsapp (20–40 s por clínica), lembretes (09:00), financeiro-recorrencias (06:00), ' +
      'retornos (09:30), solicitacoes-agendamento (de hora em hora) e cobrancas (07:00) iniciados.',
  );
}
