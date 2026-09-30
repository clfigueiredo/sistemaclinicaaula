/**
 * Worker da fila NOMES_FILAS.RETORNOS + agendamento do job diário (09:30). Lógica em modulos/retornos/servico.ts.
 *
 * DONO: módulo `retornos` (docs/FASE2.md). Para cada clínica ativa, com assinatura ativa e o recurso
 * `retorno_automatico`:
 *   - Reconcilia: retorno `pendente`/`lembrado` com agendamento posterior do mesmo paciente+profissional
 *     (não cancelado/falta, até 90 dias após a data prevista) ⇒ `agendado` + agendamento_retorno_id;
 *     `agendado` cujo agendamento foi cancelado ⇒ volta a `pendente`.
 *   - Convites (se configuracoes_clinica.retorno_convite_ativo): retorno `pendente` nunca convidado, com
 *     data_prevista entre hoje e hoje + retorno_dias_antecedencia, paciente com `aceita_whatsapp` ⇒
 *     enfileirarMensagem({ tipo: 'convite_retorno' }) e `lembrado` + convite_enviado_em (uma única vez).
 * Idempotente: o job pode rodar mais de uma vez no mesmo dia.
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { enviarConvitesAutomaticos, reconciliarAgendados } from '../modulos/retornos/servico';
import { assegurarRecurso, assinaturaEstaAtiva } from '../plugins/recursos';
import { criarWorker, NOMES_FILAS, obterFila, type JobPorClinica } from '../servicos/filas';
import { hojeNoFuso } from '../servicos/financeiroComum';
import { ErroNegocio } from '../utils/erros';

export const CRON_RETORNOS = '30 9 * * *';
export const ID_AGENDADOR_RETORNOS = 'retornos-diario';

export async function agendarJobDiarioRetornos(): Promise<void> {
  await obterFila<JobPorClinica>(NOMES_FILAS.RETORNOS).upsertJobScheduler(
    ID_AGENDADOR_RETORNOS,
    { pattern: CRON_RETORNOS, tz: env.TZ_PADRAO },
    { name: ID_AGENDADOR_RETORNOS, data: {}, opts: { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } } },
  );
}

export type ResumoRetornos = { processadas: number; agendados: number; reabertos: number; convites: number; falhas: number };

/**
 * Processa todas as clínicas com retornos em aberto (ou só `dados.clinicaId`).
 * `dados.data` ('YYYY-MM-DD') substitui "hoje" (testes/reprocessamento).
 */
export async function processarRetornos(dados: JobPorClinica): Promise<ResumoRetornos> {
  const resumo: ResumoRetornos = { processadas: 0, agendados: 0, reabertos: 0, convites: 0, falhas: 0 };
  const ids = dados.clinicaId
    ? [dados.clinicaId]
    : (
        await prisma.retorno.findMany({
          where: { status: { in: ['pendente', 'lembrado', 'agendado'] } },
          distinct: ['clinica_id'],
          select: { clinica_id: true },
        })
      ).map((r) => r.clinica_id);

  for (const clinicaId of ids) {
    try {
      if (!(await assinaturaEstaAtiva(clinicaId))) continue;
      try {
        await assegurarRecurso(clinicaId, 'retorno_automatico');
      } catch (e) {
        if (e instanceof ErroNegocio) continue;
        throw e;
      }
      const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId }, select: { fuso_horario: true } });
      const hoje = dados.data ?? hojeNoFuso(clinica?.fuso_horario || env.TZ_PADRAO);
      const rec = await reconciliarAgendados(clinicaId);
      const conv = await enviarConvitesAutomaticos(clinicaId, hoje);
      resumo.processadas++;
      resumo.agendados += rec.agendados;
      resumo.reabertos += rec.reabertos;
      resumo.convites += conv.enviados;
      resumo.falhas += conv.falhas;
    } catch (e) {
      // Uma clínica com problema não impede as demais.
      console.error(`Retornos: falha na clínica ${clinicaId}: ${(e as Error).message}`);
    }
  }
  return resumo;
}

export function iniciarWorkerDiarioRetornos() {
  return criarWorker<JobPorClinica>(
    NOMES_FILAS.RETORNOS,
    async (job: Job<JobPorClinica>) => processarRetornos(job.data),
    { concurrency: 1 },
  );
}
