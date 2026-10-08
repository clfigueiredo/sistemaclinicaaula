/**
 * Fachada do envio de e-mail. O resto do sistema NÃO chama o provedor direto: usa `enfileirarEmail`
 * (./envio.ts), que grava o histórico e põe na fila. Só o worker e o botão "testar" chamam `emailService`.
 */
import { criarAdaptadorSmtp } from './smtpAdapter';
import type { ConfigSmtp, MensagemEmail, ProvedorEmail, ResultadoEnvioEmail } from './tipos';

let provedorAtual: ProvedorEmail | null = null;

function provedor(): ProvedorEmail {
  if (!provedorAtual) provedorAtual = criarAdaptadorSmtp();
  return provedorAtual;
}

/** Troca o provedor (fake nos testes). null = volta ao SMTP. */
export function definirProvedorEmail(novo: ProvedorEmail | null): void {
  provedorAtual = novo;
}

export const emailService = {
  enviar: (config: ConfigSmtp, mensagem: MensagemEmail): Promise<ResultadoEnvioEmail> =>
    provedor().enviar(config, mensagem),
  verificar: (config: ConfigSmtp): Promise<void> => provedor().verificar(config),
};
