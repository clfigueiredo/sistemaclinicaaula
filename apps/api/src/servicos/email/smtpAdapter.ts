/**
 * Provedor SMTP genérico (nodemailer). Serve para Resend (smtp.resend.com:465, usuário `resend`, senha = API key),
 * Brevo, Amazon SES, Hostinger etc. — trocar de provedor é só mudar a configuração no painel do super admin.
 */
import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { ErroProvedorEmail, type ConfigSmtp, type MensagemEmail, type ProvedorEmail } from './tipos';

const TIMEOUT_MS = 20_000;

function criarTransporte(config: ConfigSmtp) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.porta,
    secure: config.seguro,
    // Sem TLS implícito, STARTTLS é obrigatório em produção (evita downgrade que exporia a API key). Em dev/teste fica
    // oportunista para funcionar com o Mailpit (porta 1025, sem TLS).
    requireTLS: !config.seguro && env.NODE_ENV === 'production',
    auth: { user: config.usuario, pass: config.senha },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
}

/** Códigos SMTP 4xx e erros de rede são temporários; 5xx (auth, destinatário recusado) não. */
function traduzirErro(erro: unknown): ErroProvedorEmail {
  const e = erro as { responseCode?: number; code?: string; message?: string };
  const codigo = e.responseCode;
  const temporaria = codigo ? codigo >= 400 && codigo < 500 : e.code !== 'EAUTH';
  const mensagem = e.code === 'EAUTH' ? 'Usuário ou senha (API key) do SMTP recusados.' : (e.message ?? 'Falha no SMTP.');
  return new ErroProvedorEmail(mensagem.slice(0, 500), temporaria);
}

export function criarAdaptadorSmtp(): ProvedorEmail {
  return {
    async enviar(config: ConfigSmtp, mensagem: MensagemEmail) {
      const transporte = criarTransporte(config);
      try {
        const info = await transporte.sendMail({
          from: { name: config.remetenteNome, address: config.remetenteEmail },
          to: mensagem.para,
          ...(config.responderPara && { replyTo: config.responderPara }),
          subject: mensagem.assunto,
          html: mensagem.html,
          text: mensagem.texto,
        });
        return { idExterno: info.messageId ?? null };
      } catch (erro) {
        throw traduzirErro(erro);
      } finally {
        transporte.close();
      }
    },
    async verificar(config: ConfigSmtp) {
      const transporte = criarTransporte(config);
      try {
        await transporte.verify();
      } catch (erro) {
        throw traduzirErro(erro);
      } finally {
        transporte.close();
      }
    },
  };
}
