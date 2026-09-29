/**
 * Worker da fila NOMES_FILAS.LEMBRETES + agendamento do job diário.
 *
 * Job repetível (BullMQ Job Scheduler) todo dia às 09:00 (fuso TZ_PADRAO, America/Sao_Paulo):
 * para cada clínica com sessão conectada e recurso `whatsapp`, enfileira os lembretes das
 * consultas de AMANHÃ (no fuso de cada clínica). Pode receber { clinicaId } para rodar só uma.
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { criarWorker, NOMES_FILAS, obterFila, type JobLembretes } from '../servicos/filas';
import { processarLembretesClinica, processarLembretesTodasClinicas } from '../servicos/whatsapp/lembretes';

export type JobLembretesClinica = JobLembretes & { clinicaId?: string };

export const CRON_LEMBRETES = '0 9 * * *';
export const ID_AGENDADOR_LEMBRETES = 'lembretes-diarios';

export async function agendarJobDiarioLembretes(): Promise<void> {
  await obterFila<JobLembretesClinica>(NOMES_FILAS.LEMBRETES).upsertJobScheduler(
    ID_AGENDADOR_LEMBRETES,
    { pattern: CRON_LEMBRETES, tz: env.TZ_PADRAO },
    { name: ID_AGENDADOR_LEMBRETES, data: {}, opts: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } } },
  );
}

export function iniciarWorkerLembretes() {
  return criarWorker<JobLembretesClinica>(
    NOMES_FILAS.LEMBRETES,
    async (job: Job<JobLembretesClinica>) => {
      const referencia = job.data.data ? new Date(job.data.data) : new Date();
      if (job.data.clinicaId) return [await processarLembretesClinica(job.data.clinicaId, { referencia })];
      return processarLembretesTodasClinicas(referencia);
    },
    { concurrency: 1 },
  );
}
