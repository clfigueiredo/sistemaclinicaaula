/**
 * Worker da fila NOMES_FILAS.SOLICITACOES_AGENDAMENTO + agendamento do job de hora em hora.
 *
 * Módulo dono: `agendamento-online` (docs/FASE2.md). Pula clínicas com assinatura inativa (as pendentes delas
 * expiram na primeira execução após a reativação). Idempotente: o job pode rodar várias vezes.
 *
 * Regras:
 *   - Solicitações `pendente` cujo `inicio` já passou ⇒ `expirada` (updateMany por clínica).
 *   - Nada é enviado ao paciente na expiração.
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { expirarSolicitacoesPendentes } from '../modulos/agendamento-online/servico';
import { criarWorker, NOMES_FILAS, obterFila, type JobPorClinica } from '../servicos/filas';

export const CRON_SOLICITACOES = '15 * * * *';
export const ID_AGENDADOR_SOLICITACOES = 'solicitacoes-agendamento-expirar';

export async function agendarJobExpirarSolicitacoes(): Promise<void> {
  await obterFila<JobPorClinica>(NOMES_FILAS.SOLICITACOES_AGENDAMENTO).upsertJobScheduler(
    ID_AGENDADOR_SOLICITACOES,
    { pattern: CRON_SOLICITACOES, tz: env.TZ_PADRAO },
    { name: ID_AGENDADOR_SOLICITACOES, data: {}, opts: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } } },
  );
}

/** Expira as solicitações pendentes cujo horário já passou. Resumo vai para o log do BullMQ. */
export async function expirarSolicitacoes(dados: JobPorClinica): Promise<{ processadas: number }> {
  return expirarSolicitacoesPendentes({ clinicaId: dados.clinicaId });
}

export function iniciarWorkerExpirarSolicitacoes() {
  return criarWorker<JobPorClinica>(
    NOMES_FILAS.SOLICITACOES_AGENDAMENTO,
    async (job: Job<JobPorClinica>) => expirarSolicitacoes(job.data),
    { concurrency: 1 },
  );
}
