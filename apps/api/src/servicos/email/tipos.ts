/** Tipos do envio de e-mail (provedor trocável — mesmo princípio do whatsappService). */

export type ConfigSmtp = {
  host: string;
  porta: number;
  /** true = TLS implícito (465); false = STARTTLS (587). */
  seguro: boolean;
  usuario: string;
  senha: string;
  remetenteNome: string;
  remetenteEmail: string;
  responderPara: string | null;
};

export type MensagemEmail = {
  para: string;
  assunto: string;
  html: string;
  texto: string;
};

export type ResultadoEnvioEmail = { idExterno: string | null };

export interface ProvedorEmail {
  enviar(config: ConfigSmtp, mensagem: MensagemEmail): Promise<ResultadoEnvioEmail>;
  /** Testa conexão + autenticação (botão "testar" do painel). */
  verificar(config: ConfigSmtp): Promise<void>;
}

/** Falha do provedor. `temporaria` = vale tentar de novo (rede, 4xx do SMTP); senão desiste (auth, destinatário inválido). */
export class ErroProvedorEmail extends Error {
  constructor(
    mensagem: string,
    public readonly temporaria: boolean,
  ) {
    super(mensagem);
    this.name = 'ErroProvedorEmail';
  }
}
