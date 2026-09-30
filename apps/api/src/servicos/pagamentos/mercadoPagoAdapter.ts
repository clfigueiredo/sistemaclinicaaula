/**
 * Adaptador Mercado Pago.   [STUB — fase 2, dono: admin-cobranca]
 *
 * API: https://www.mercadopago.com.br/developers (Bearer <access_token>)
 * Sandbox × produção: config.ambiente (mesma URL https://api.mercadopago.com; sandbox = credenciais de teste (TEST-...)).
 * Webhook: POST /webhooks/pagamentos/mercado_pago — header `x-signature` (ts, v1) + `x-request-id`; o corpo traz só o id: consulte GET /v1/payments/:id.
 * Use fetch nativo (sem SDK) e lance ErroGatewayPagamento (temporario = true para 5xx/timeout).
 */
import { ErroGatewayPagamento, type ConfigGateway, type GatewayPagamento } from './tipos';

export function criarAdaptadorMercadoPago(config: ConfigGateway): GatewayPagamento {
  const naoImplementado = (): never => {
    throw new ErroGatewayPagamento('Integração Mercado Pago ainda não implementada.', 'mercado_pago');
  };
  void config;
  return {
    provedor: 'mercado_pago',
    criarCliente: async () => naoImplementado(),
    criarAssinatura: async () => naoImplementado(),
    criarCobranca: async () => naoImplementado(),
    cancelar: async () => naoImplementado(),
    // TODO(admin-cobranca): validar x-signature (manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com HMAC-SHA256 do segredo).
    validarWebhook: () => false,
    interpretarWebhook: () => null,
  };
}
