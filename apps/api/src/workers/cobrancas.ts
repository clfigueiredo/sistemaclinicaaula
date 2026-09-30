/**
 * Worker da fila NOMES_FILAS.COBRANCAS + agendamento do job diário (07:00).   [STUB — fase 2]
 *
 * DONO: módulo `admin-cobranca` (docs/FASE2.md). Já registrado em workers/index.ts — o dono só implementa
 * `processarCobrancas` (e ajusta o CRON se precisar). Dados de PLATAFORMA: use o prisma CRU (cobrancas,
 * assinaturas, gateways_pagamento). Idempotente: o job pode rodar mais de uma vez no mesmo dia.
 *
 * O que fazer:
 *   - Cobranças `pendente` com vencimento < hoje ⇒ `vencida`.
 *   - Assinatura com cobrança vencida há mais de `gateways_pagamento.dias_tolerancia` dias (gateway ativo)
 *     ⇒ assinatura `vencida` (ou `bloqueada`, decisão documentada no módulo). Paga ⇒ `ativa` é feito pelo webhook.
 *   - (Opcional) gerar a cobrança do próximo ciclo quando o gateway não gerencia a recorrência.
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { criarWorker, NOMES_FILAS, obterFila, type JobCobrancas } from '../servicos/filas';

export const CRON_COBRANCAS = '0 7 * * *';
export const ID_AGENDADOR_COBRANCAS = 'cobrancas-diario';

export async function agendarJobDiarioCobrancas(): Promise<void> {
  await obterFila<JobCobrancas>(NOMES_FILAS.COBRANCAS).upsertJobScheduler(
    ID_AGENDADOR_COBRANCAS,
    { pattern: CRON_COBRANCAS, tz: env.TZ_PADRAO },
    { name: ID_AGENDADOR_COBRANCAS, data: {}, opts: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } } },
  );
}

/** TODO(admin-cobranca): implementar. Retorne um resumo (vai para o log do BullMQ). */
export async function processarCobrancas(_dados: JobCobrancas): Promise<{ processadas: number }> {
  return { processadas: 0 };
}

export function iniciarWorkerDiarioCobrancas() {
  return criarWorker<JobCobrancas>(
    NOMES_FILAS.COBRANCAS,
    async (job: Job<JobCobrancas>) => processarCobrancas(job.data),
    { concurrency: 1 },
  );
}
