/**
 * Worker da fila NOMES_FILAS.COBRANCAS + agendamento do job diário (07:00).   [fase 2, dono: admin-cobranca]
 *
 * Lógica em modulos/admin-cobranca/servico.ts (`executarJobCobrancas`), testável sem Redis:
 *   1. cobranças `pendente` com vencimento < hoje ⇒ `vencida`;
 *   2. gera no gateway ATIVO a cobrança do próximo ciclo das assinaturas com cobrança automática
 *      (gateway + dia_vencimento), até 10 dias antes do vencimento, no máximo uma por mês, no método
 *      preferido da assinatura (`assinaturas.metodo_cobranca`, se habilitado no gateway) e com a descrição
 *      `gateways_pagamento.descricao_cobranca`;
 *   3. cobrança em aberto há mais de `dias_tolerancia` dias ⇒ assinatura `ativa` → `vencida`
 *      (volta a `ativa` pelo webhook de pagamento). `bloqueada` fica para bloqueio manual.
 * Sem gateway ativo: só marca vencidas/tolerância e registra no log. Idempotente (pode rodar várias vezes).
 * `dados.data` ('YYYY-MM-DD') simula o dia (testes/reprocessamento); padrão = hoje em TZ_PADRAO.
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { executarJobCobrancas, type ResumoJobCobrancas } from '../modulos/admin-cobranca/servico';
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

/** Resumo vai para o retorno do job (log do BullMQ). */
export async function processarCobrancas(dados: JobCobrancas): Promise<ResumoJobCobrancas> {
  const hoje = dados.data && /^\d{4}-\d{2}-\d{2}$/.test(dados.data) ? dados.data : undefined;
  return executarJobCobrancas(hoje);
}

export function iniciarWorkerDiarioCobrancas() {
  return criarWorker<JobCobrancas>(
    NOMES_FILAS.COBRANCAS,
    async (job: Job<JobCobrancas>) => processarCobrancas(job.data),
    { concurrency: 1 },
  );
}
