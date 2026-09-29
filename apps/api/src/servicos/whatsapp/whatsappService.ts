/**
 * ============================================================================
 * whatsappService — ÚNICO ponto de contato com o provedor de WhatsApp.
 * ============================================================================
 * Regra do projeto: nenhum outro módulo chama a API do WPPConnect diretamente. Assim dá para
 * trocar o provedor (ex.: API oficial da Meta) implementando esta mesma interface.
 *
 * Provedor atual: WPPConnect Server (docker-compose; env WPPCONNECT_URL, WPPCONNECT_SECRET_KEY).
 * Uma sessão por clínica; o nome da sessão é derivado do clinicaId (ver nomeSessao) e os dados
 * da sessão (token, status, telefone) ficam em `whatsapp_sessoes` (use o prisma cru aqui, pois o
 * serviço também é chamado pelos workers, sem request).
 *
 * TODO(fase 2 — agente WhatsApp): implementar o provedor WPPConnect com fetch nativo (Node 20+)
 * e o parser do webhook. Pode criar arquivos auxiliares nesta pasta (ex.: wppconnect.ts).
 * ============================================================================
 */
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

export interface WhatsappService {
  /** Cria/inicia a sessão da clínica no provedor (gera token se preciso). */
  iniciarSessao(clinicaId: string): Promise<ResultadoSessao>;
  /** QR code atual para parear o celular. */
  obterQrCode(clinicaId: string): Promise<ResultadoSessao>;
  /** Status da conexão da clínica. */
  status(clinicaId: string): Promise<ResultadoStatus>;
  /** Desconecta (logout) a sessão da clínica. */
  desconectar(clinicaId: string): Promise<void>;
  /**
   * Envia texto. NÃO chamar direto de rotas: o envio acontece SÓ no worker da fila
   * (NOMES_FILAS.ENVIO_WHATSAPP), respeitando intervalo, consentimento e limites.
   */
  enviarMensagem(clinicaId: string, telefone: string, texto: string): Promise<ResultadoEnvio>;
  /** Converte o corpo do webhook do provedor numa mensagem recebida (ou null se não for mensagem de texto). */
  interpretarWebhook(corpo: unknown): MensagemRecebida | null;
}

/** Nome da sessão no provedor para uma clínica. */
export function nomeSessao(clinicaId: string): string {
  return `clinica_${clinicaId.replace(/-/g, '')}`;
}

function naoImplementado(metodo: string): never {
  throw new Error(`whatsappService.${metodo}: não implementado (TODO fase 2 — módulo WhatsApp).`);
}

// TODO(fase 2): substituir pelo provedor WPPConnect real.
export const whatsappService: WhatsappService = {
  iniciarSessao: async () => naoImplementado('iniciarSessao'),
  obterQrCode: async () => naoImplementado('obterQrCode'),
  status: async () => naoImplementado('status'),
  desconectar: async () => naoImplementado('desconectar'),
  enviarMensagem: async () => naoImplementado('enviarMensagem'),
  interpretarWebhook: () => naoImplementado('interpretarWebhook'),
};
