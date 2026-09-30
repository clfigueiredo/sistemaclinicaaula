/**
 * Adaptador Asaas.   [STUB — fase 2, dono: admin-cobranca]
 *
 * API: https://docs.asaas.com (header `access_token: <api_key>`)
 * Sandbox × produção: config.ambiente (https://sandbox.asaas.com/api/v3 | https://api.asaas.com/v3).
 * Webhook: POST /webhooks/pagamentos/asaas — header `asaas-access-token` = segredo do webhook; id do evento em `id`.
 * Use fetch nativo (sem SDK) e lance ErroGatewayPagamento (temporario = true para 5xx/timeout).
 */
import { ErroGatewayPagamento, type ConfigGateway, type GatewayPagamento } from './tipos';

export function criarAdaptadorAsaas(config: ConfigGateway): GatewayPagamento {
  const naoImplementado = (): never => {
    throw new ErroGatewayPagamento('Integração Asaas ainda não implementada.', 'asaas');
  };
  void config;
  return {
    provedor: 'asaas',
    criarCliente: async () => naoImplementado(),
    criarAssinatura: async () => naoImplementado(),
    criarCobranca: async () => naoImplementado(),
    cancelar: async () => naoImplementado(),
    // TODO(admin-cobranca): validar header asaas-access-token com timingSafeEqual contra config.segredoWebhook.
    validarWebhook: () => false,
    interpretarWebhook: () => null,
  };
}
