/**
 * Worker da fila NOMES_FILAS.EMAILS: envia um e-mail transacional por job (lógica em servicos/email/envio.ts).
 * Falha temporária do SMTP ⇒ o job lança e o BullMQ tenta de novo (até TENTATIVAS_EMAIL, espera exponencial);
 * na última tentativa o registro vira `falhou` com o motivo (visível em /admin/email → Envios).
 */
import type { Job } from 'bullmq';
import { processarEnvioEmail } from '../servicos/email/envio';
import { criarWorker, NOMES_FILAS, type JobEnvioEmail } from '../servicos/filas';

export function iniciarWorkerEmails() {
  return criarWorker<JobEnvioEmail>(
    NOMES_FILAS.EMAILS,
    async (job: Job<JobEnvioEmail>) => {
      const tentativas = job.opts.attempts ?? 1;
      const ultimaTentativa = job.attemptsMade + 1 >= tentativas;
      return processarEnvioEmail(job.data.emailId, ultimaTentativa);
    },
    { concurrency: 2 },
  );
}
