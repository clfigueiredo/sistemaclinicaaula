/** Tipos e erros do serviço de WhatsApp (independentes do provedor). */
import type { StatusSessaoWhatsapp } from '@prisma/client';

/** 'desconectada' | 'iniciando' | 'aguardando_qr' | 'conectada' | 'erro' */
export type StatusConexaoWhatsapp = StatusSessaoWhatsapp;

export type ResultadoSessao = {
  status: StatusConexaoWhatsapp;
  /** QR code como data URL base64 (quando status = 'aguardando_qr'). */
  qrCode: string | null;
};

export type ResultadoStatus = {
  status: StatusConexaoWhatsapp;
  /** Número conectado (só dígitos, formato internacional) quando conectado. */
  telefone: string | null;
};

export type ResultadoEnvio = {
  /** ID da mensagem no provedor (vai para mensagens_whatsapp.id_externo). */
  idExterno: string | null;
};

/** Mensagem recebida, normalizada a partir do webhook do provedor. */
export type MensagemRecebida = {
  nomeSessao: string;
  telefone: string;
  texto: string;
  idExterno: string | null;
  recebidaEm: Date;
};

/** Evento do webhook normalizado (independente do provedor). */
export type EventoWhatsapp =
  | ({ tipo: 'mensagem' } & MensagemRecebida)
  | { tipo: 'status'; nomeSessao: string; status: StatusConexaoWhatsapp; telefone: string | null }
  | { tipo: 'qrcode'; nomeSessao: string; qrCode: string | null };

/**
 * Erro do provedor. `temporario` = vale a pena tentar de novo (rede, 5xx, sessão reiniciando).
 */
export class ErroProvedorWhatsapp extends Error {
  constructor(
    mensagem: string,
    public readonly temporario: boolean,
    public readonly codigo = 'erro_provedor',
  ) {
    super(mensagem);
    this.name = 'ErroProvedorWhatsapp';
  }
}

export interface WhatsappService {
  /** Cria/inicia a sessão da clínica no provedor (gera token se preciso). */
  iniciarSessao(clinicaId: string): Promise<ResultadoSessao>;
  /** QR code atual para parear o celular. */
  obterQrCode(clinicaId: string): Promise<ResultadoSessao>;
  /** Status da conexão da clínica (também atualiza whatsapp_sessoes). */
  status(clinicaId: string): Promise<ResultadoStatus>;
  /** Desconecta (logout) a sessão da clínica. */
  desconectar(clinicaId: string): Promise<void>;
  /**
   * Envia texto. NÃO chamar direto de rotas: o envio acontece SÓ no worker da fila
   * (NOMES_FILAS.ENVIO_WHATSAPP), respeitando intervalo, consentimento e limites.
   * Lança ErroProvedorWhatsapp em falha.
   */
  enviarMensagem(clinicaId: string, telefone: string, texto: string): Promise<ResultadoEnvio>;
  /** Converte o corpo do webhook do provedor num evento interno (ou null se não interessa). */
  interpretarWebhook(corpo: unknown): EventoWhatsapp | null;
}

/** Nome da sessão no provedor para uma clínica. */
export function nomeSessao(clinicaId: string): string {
  return `clinica_${clinicaId.replace(/-/g, '')}`;
}
