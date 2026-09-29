/**
 * ============================================================================
 * whatsappService — ÚNICO ponto de contato com o provedor de WhatsApp.
 * ============================================================================
 * Regra do projeto: nenhum outro módulo chama a API do WPPConnect diretamente. Assim dá para
 * trocar o provedor (ex.: API oficial da Meta) implementando esta mesma interface.
 *
 * Provedores (adaptadores):
 *   - wppconnectAdapter.ts → WPPConnect Server (padrão; env WPPCONNECT_URL, WPPCONNECT_SECRET_KEY)
 *   - fakeAdapter.ts       → testes (não envia nada; grava o que "enviou" em memória)
 * Trocar o provedor: `definirProvedorWhatsapp(adaptador)` (testes) ou mudar `criarProvedorPadrao`.
 *
 * Uma sessão por clínica; o nome da sessão é derivado do clinicaId (ver nomeSessao) e os dados
 * da sessão (token, status, telefone) ficam em `whatsapp_sessoes` (prisma cru, pois o serviço
 * também é chamado pelos workers e pelo webhook, sem request).
 *
 * ENVIO: `enviarMensagem` só é chamado pelo worker da fila (servicos/whatsapp/envio.ts). Para
 * mandar uma mensagem de qualquer lugar use `enfileirarMensagem` (envio.ts).
 * ============================================================================
 */
import { criarAdaptadorWppconnect } from './wppconnectAdapter';
import type { WhatsappService } from './tipos';

export * from './tipos';

// ----------------------------------------------------------------------------
// Fábrica / injeção de dependência
// ----------------------------------------------------------------------------

let provedorAtual: WhatsappService | null = null;
let fabrica: () => WhatsappService = criarAdaptadorWppconnect;

function provedor(): WhatsappService {
  if (!provedorAtual) provedorAtual = fabrica();
  return provedorAtual;
}

/** Troca o provedor (ex.: adaptador fake nos testes, ou API oficial da Meta no futuro). null = volta ao padrão. */
export function definirProvedorWhatsapp(novo: WhatsappService | null): void {
  provedorAtual = novo;
}

/** Troca a fábrica do provedor padrão (usada quando nenhum provedor foi definido). */
export function definirFabricaProvedorWhatsapp(nova: () => WhatsappService): void {
  fabrica = nova;
  provedorAtual = null;
}

/**
 * Fachada usada pelo resto do sistema. Delega ao provedor atual.
 */
export const whatsappService: WhatsappService = {
  iniciarSessao: (id) => provedor().iniciarSessao(id),
  obterQrCode: (id) => provedor().obterQrCode(id),
  status: (id) => provedor().status(id),
  desconectar: (id) => provedor().desconectar(id),
  enviarMensagem: (id, tel, txt) => provedor().enviarMensagem(id, tel, txt),
  interpretarWebhook: (corpo) => provedor().interpretarWebhook(corpo),
};

