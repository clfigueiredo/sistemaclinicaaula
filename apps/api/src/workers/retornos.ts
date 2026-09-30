/**
 * Worker da fila NOMES_FILAS.RETORNOS + agendamento do job diário (09:30).   [STUB — fase 2]
 *
 * DONO: módulo `retornos` (docs/FASE2.md). Já registrado em workers/index.ts — o dono só implementa
 * `processarRetornos` (e ajusta o CRON se precisar). Use o prisma CRU filtrando clinica_id manualmente (ou
 * `criarDbTenant(clinicaId)`), `assegurarAssinaturaAtiva`/`assinaturaEstaAtiva` e `assegurarRecurso(clinicaId,
 * 'retorno_automatico')` antes de agir numa clínica. Idempotente: o job pode rodar mais de uma vez no mesmo dia.
 *
 * O que fazer:
 *   - Reconciliar: retorno `pendente`/`lembrado` com agendamento posterior do mesmo paciente+profissional
 *     (não cancelado) ⇒ `agendado` + agendamento_retorno_id.
 *   - Se configuracoes_clinica.retorno_convite_ativo e faltarem <= retorno_dias_antecedencia dias para
 *     data_prevista, retorno `pendente` sem convite ⇒ enfileirarMensagem({ tipo: 'convite_retorno',
 *     conteudo: textoConviteRetorno(...) }) e marcar `lembrado` + convite_enviado_em (mesmo se o envio
 *     falhar por falta de consentimento — registre e não tente de novo todo dia).
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { criarWorker, NOMES_FILAS, obterFila, type JobPorClinica } from '../servicos/filas';

export const CRON_RETORNOS = '30 9 * * *';
export const ID_AGENDADOR_RETORNOS = 'retornos-diario';

export async function agendarJobDiarioRetornos(): Promise<void> {
  await obterFila<JobPorClinica>(NOMES_FILAS.RETORNOS).upsertJobScheduler(
    ID_AGENDADOR_RETORNOS,
    { pattern: CRON_RETORNOS, tz: env.TZ_PADRAO },
    { name: ID_AGENDADOR_RETORNOS, data: {}, opts: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } } },
  );
}

/** TODO(retornos): implementar. Retorne um resumo (vai para o log do BullMQ). */
export async function processarRetornos(_dados: JobPorClinica): Promise<{ processadas: number }> {
  return { processadas: 0 };
}

export function iniciarWorkerDiarioRetornos() {
  return criarWorker<JobPorClinica>(
    NOMES_FILAS.RETORNOS,
    async (job: Job<JobPorClinica>) => processarRetornos(job.data),
    { concurrency: 1 },
  );
}
