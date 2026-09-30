/**
 * Adaptador Stripe.   [STUB — fase 2, dono: admin-cobranca]
 *
 * API: https://docs.stripe.com/api (Bearer <secret_key>, form-urlencoded, valores em centavos)
 * Sandbox × produção: config.ambiente (mesma URL https://api.stripe.com; sandbox = chaves sk_test_).
 * Webhook: POST /webhooks/pagamentos/stripe — assinatura HMAC no header `Stripe-Signature` sobre o corpo CRU (segredo whsec_).
 * Use fetch nativo (sem SDK) e lance ErroGatewayPagamento (temporario = true para 5xx/timeout).
 */
import { ErroGatewayPagamento, type ConfigGateway, type GatewayPagamento } from './tipos';

export function criarAdaptadorStripe(config: ConfigGateway): GatewayPagamento {
  const naoImplementado = (): never => {
    throw new ErroGatewayPagamento('Integração Stripe ainda não implementada.', 'stripe');
  };
  void config;
  return {
    provedor: 'stripe',
    criarCliente: async () => naoImplementado(),
    criarAssinatura: async () => naoImplementado(),
    criarCobranca: async () => naoImplementado(),
    cancelar: async () => naoImplementado(),
    // TODO(admin-cobranca): validar Stripe-Signature (t=..., v1=HMAC-SHA256(segredo, `${t}.${corpoCru}`)) com tolerância de 5 min.
    validarWebhook: () => false,
    interpretarWebhook: () => null,
  };
}
