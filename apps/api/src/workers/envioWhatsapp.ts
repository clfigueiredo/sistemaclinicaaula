/**
 * Worker da fila NOMES_FILAS.ENVIO_WHATSAPP.
 *
 * Um job por mensagem (jobId = id da mensagem). O espaçamento de 20–40 s é POR CLÍNICA
 * (reservarVezDaClinica, chave Redis por clínica): se a clínica ainda não pode enviar, o job é
 * adiado para o instante liberado (moveToDelayed + DelayedError — não conta como tentativa).
 * Concorrência > 1 para que clínicas diferentes não esperem umas pelas outras.
 * Falha temporária (rede, 5xx) ⇒ retry com backoff exponencial (OPCOES_PADRAO_JOB: 3 tentativas).
 */
import { DelayedError, type Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { criarWorker, NOMES_FILAS, type JobEnvioWhatsapp } from '../servicos/filas';
import { AguardarVez, processarEnvio, reservarVezDaClinica } from '../servicos/whatsapp/envio';

export const CONCORRENCIA_ENVIO = 5;

export function iniciarWorkerEnvioWhatsapp() {
  const worker = criarWorker<JobEnvioWhatsapp>(
    NOMES_FILAS.ENVIO_WHATSAPP,
    async (job: Job<JobEnvioWhatsapp>, token?: string) => {
      const tentativas = job.opts.attempts ?? 1;
      const ultimaTentativa = job.attemptsMade + 1 >= tentativas;
      try {
        return await processarEnvio(job.data.mensagemId, {
          ultimaTentativa,
          antesDeEnviar: () => reservarVezDaClinica(job.data.clinicaId),
        });
      } catch (e) {
        if (e instanceof AguardarVez) {
          await job.moveToDelayed(Date.now() + e.ms, token);
          throw new DelayedError();
        }
        throw e;
      }
    },
    { concurrency: CONCORRENCIA_ENVIO },
  );

  // Falha definitiva por erro inesperado (ex.: banco fora): não deixa a mensagem pendente para sempre.
  worker.on('failed', async (job, erro) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    try {
      await prisma.mensagemWhatsapp.updateMany({
        where: { id: job.data.mensagemId, status: 'pendente' },
        data: { status: 'falhou', erro: String(erro?.message ?? 'erro').slice(0, 500) },
      });
    } catch {
      /* ignora */
    }
  });
  return worker;
}
