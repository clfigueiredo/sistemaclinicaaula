/**
 * Worker da fila NOMES_FILAS.FINANCEIRO_RECORRENCIAS + agendamento do job diário (06:00).   [STUB — fase 2]
 *
 * DONO: módulo `financeiro` (docs/FASE2.md). Já registrado em workers/index.ts — o dono só implementa
 * `processarRecorrencias` (e ajusta o CRON se precisar). Use o prisma CRU filtrando clinica_id manualmente (ou
 * `criarDbTenant(clinicaId)`), `assegurarAssinaturaAtiva`/`assinaturaEstaAtiva` e `assegurarRecurso(clinicaId,
 * 'financeiro')` antes de agir numa clínica. Idempotente: o job pode rodar mais de uma vez no mesmo dia.
 *
 * O que fazer:
 *   - Para cada recorrência ativa (inicio <= hoje, fim nulo ou >= competência), gerar o título do mês
 *     corrente e do PRÓXIMO mês se ainda não existirem (único (recorrencia_id, competencia) ⇒ idempotente;
 *     trate P2002 como "já gerado"); atualizar `ultima_competencia`.
 *   - dia_vencimento > dias do mês ⇒ último dia do mês. Datas @db.Date = meia-noite UTC.
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { criarWorker, NOMES_FILAS, obterFila, type JobPorClinica } from '../servicos/filas';

export const CRON_RECORRENCIAS = '0 6 * * *';
export const ID_AGENDADOR_RECORRENCIAS = 'financeiro-recorrencias-diario';

export async function agendarJobDiarioRecorrencias(): Promise<void> {
  await obterFila<JobPorClinica>(NOMES_FILAS.FINANCEIRO_RECORRENCIAS).upsertJobScheduler(
    ID_AGENDADOR_RECORRENCIAS,
    { pattern: CRON_RECORRENCIAS, tz: env.TZ_PADRAO },
    { name: ID_AGENDADOR_RECORRENCIAS, data: {}, opts: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } } },
  );
}

/** TODO(financeiro): implementar. Retorne um resumo (vai para o log do BullMQ). */
export async function processarRecorrencias(_dados: JobPorClinica): Promise<{ processadas: number }> {
  return { processadas: 0 };
}

export function iniciarWorkerDiarioRecorrencias() {
  return criarWorker<JobPorClinica>(
    NOMES_FILAS.FINANCEIRO_RECORRENCIAS,
    async (job: Job<JobPorClinica>) => processarRecorrencias(job.data),
    { concurrency: 1 },
  );
}
