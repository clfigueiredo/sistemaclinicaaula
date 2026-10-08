/**
 * E-mails transacionais — porta de entrada para os outros módulos.
 *
 *   import { enfileirarEmail, linksSistema } from '../../servicos/email';
 *   await enfileirarEmail({ tipo: 'boas_vindas', para, variaveis, referencia: usuario.id, clinicaId });
 *
 * Nada fora de servicos/email (e do worker/botão de teste do admin) chama o provedor SMTP direto.
 */
import { env } from '../../config/env';

export * from './tipos';
export { emailService, definirProvedorEmail } from './emailService';
export {
  enfileirarEmail,
  processarEnvioEmail,
  definirEnfileiradorEmail,
  TENTATIVAS_EMAIL,
  mascararTokensConteudo,
  type NovoEmail,
  type ResultadoEnfileirar,
} from './envio';
export { CATALOGO_EMAILS, TIPOS_EMAIL, variaveisDeExemplo } from './modelosPadrao';
export { montarEmail, escaparHtml, substituirVariaveis, type ConteudoModelo, type EmailMontado } from './renderizar';
export {
  obterConfiguracaoEmail,
  paraConfigSmtp,
  configSmtpAtiva,
  obterModeloEmail,
  listarModelosEmail,
  ID_CONFIGURACAO_EMAIL,
  type ModeloEfetivo,
} from './configuracao';

/** Links do painel da clínica usados nos e-mails (WEB_URL_PUBLICA = domínio do app). */
export function linksSistema() {
  const base = env.WEB_URL_PUBLICA;
  return {
    acesso: `${base}/login`,
    esqueciSenha: `${base}/esqueci-senha`,
    redefinirSenha: (token: string) => `${base}/redefinir-senha?token=${encodeURIComponent(token)}`,
  };
}

/** Formatos usados nas variáveis (pt-BR). */
export const formatoEmail = {
  moeda: (valor: number | string | { toString(): string }) =>
    Number(valor.toString()).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  /** Data sem hora: Date de coluna @db.Date (UTC 00:00) ⇒ formata em UTC; instantes ⇒ no fuso informado. */
  data: (d: Date, fuso = 'UTC') => d.toLocaleDateString('pt-BR', { timeZone: fuso }),
};
