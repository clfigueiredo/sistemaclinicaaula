/**
 * Worker da fila NOMES_FILAS.FINANCEIRO_RECORRENCIAS + agendamento do job diário (06:00).
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
import { prisma } from '../lib/prisma';
import { assegurarRecurso, assinaturaEstaAtiva } from '../plugins/recursos';
import { criarDbTenant } from '../plugins/tenant';
import { criarWorker, NOMES_FILAS, obterFila, type JobPorClinica } from '../servicos/filas';
import { hojeNoFuso } from '../servicos/financeiroComum';
import { gerarTitulosRecorrencia } from '../modulos/financeiro/servico';

export const CRON_RECORRENCIAS = '0 6 * * *';
export const ID_AGENDADOR_RECORRENCIAS = 'financeiro-recorrencias-diario';

export async function agendarJobDiarioRecorrencias(): Promise<void> {
  await obterFila<JobPorClinica>(NOMES_FILAS.FINANCEIRO_RECORRENCIAS).upsertJobScheduler(
    ID_AGENDADOR_RECORRENCIAS,
    { pattern: CRON_RECORRENCIAS, tz: env.TZ_PADRAO },
    { name: ID_AGENDADOR_RECORRENCIAS, data: {}, opts: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } } },
  );
}

/**
 * Para cada clínica com recorrências ativas (ou só `dados.clinicaId`), com assinatura ativa e recurso
 * `financeiro` habilitado, garante os títulos do mês corrente (se o vencimento não passou) e do próximo.
 * `dados.data` ('YYYY-MM-DD') substitui "hoje" (testes/reprocessamento). Idempotente.
 */
export async function processarRecorrencias(
  dados: JobPorClinica = {},
): Promise<{ processadas: number; titulosGerados: number; clinicas: number; ignoradas: number }> {
  const clinicas = await prisma.recorrencia.findMany({
    where: { ativo: true, ...(dados.clinicaId ? { clinica_id: dados.clinicaId } : {}) },
    distinct: ['clinica_id'],
    select: { clinica_id: true, clinica: { select: { fuso_horario: true, status: true } } },
  });

  let processadas = 0;
  let titulosGerados = 0;
  let ignoradas = 0;
  for (const c of clinicas) {
    if (c.clinica.status !== 'ativa' || !(await assinaturaEstaAtiva(c.clinica_id))) {
      ignoradas++;
      continue;
    }
    try {
      await assegurarRecurso(c.clinica_id, 'financeiro');
    } catch {
      ignoradas++;
      continue;
    }
    const hoje = dados.data && /^\d{4}-\d{2}-\d{2}$/.test(dados.data) ? dados.data : hojeNoFuso(c.clinica.fuso_horario);
    const db = criarDbTenant(c.clinica_id);
    const recorrencias = await db.recorrencia.findMany({ where: { ativo: true } });
    for (const rec of recorrencias) {
      titulosGerados += await gerarTitulosRecorrencia(db, rec, hoje);
      processadas++;
    }
  }
  return { processadas, titulosGerados, clinicas: clinicas.length, ignoradas };
}

export function iniciarWorkerDiarioRecorrencias() {
  return criarWorker<JobPorClinica>(
    NOMES_FILAS.FINANCEIRO_RECORRENCIAS,
    async (job: Job<JobPorClinica>) => processarRecorrencias(job.data),
    { concurrency: 1 },
  );
}
