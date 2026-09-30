/**
 * Módulo admin-cobranca — cobrança automática do SaaS (Asaas, Stripe, Mercado Pago).   [STUB — fase 2]
 *
 * Contrato completo: docs/FASE2.md §7. Dados de PLATAFORMA (prisma cru): gateways_pagamento, cobrancas,
 * eventos_gateway, assinaturas (gateway, cliente_externo_id, assinatura_externa_id, dia_vencimento).
 * Gateways só via servicos/pagamentos (obterGateway/obterGatewayAtivo). Segredos: utils/cripto.ts.
 * Prefixo "" (as rotas trazem o caminho completo).
 *
 * SUPER ADMIN (autenticarAdmin):
 *   GET  /admin/cobranca/gateways                       os 3 provedores (configurados ou não) — NUNCA devolve segredo
 *   PUT  /admin/cobranca/gateways/:provedor             { ambiente?, credenciais?, segredo_webhook?, dias_tolerancia?, metodos? }
 *   POST /admin/cobranca/gateways/:provedor/ativar      desativa os outros e ativa este (transação)
 *   POST /admin/cobranca/gateways/:provedor/desativar
 *   POST /admin/cobranca/gateways/:provedor/testar      chamada simples ao gateway ⇒ { ok, mensagem }
 *   GET  /admin/cobranca/cobrancas?status&clinica_id&pagina&por_pagina
 *   POST /admin/cobranca/clinicas/:clinicaId/cobrancas  { valor?, vencimento, descricao?, metodo? } (gateway ativo)
 *   POST /admin/cobranca/clinicas/:clinicaId/assinatura { dia_vencimento, metodo? } ativa a cobrança recorrente
 *   POST /admin/cobranca/cobrancas/:id/cancelar
 *   GET  /admin/cobranca/eventos?gateway&pagina         webhooks recebidos (diagnóstico)
 *
 * CLÍNICA (autenticarClinica, admin):
 *   GET  /cobrancas/minhas                              faturas da própria clínica (request.db.cobranca — só leitura,
 *                                                        já filtrado pelo tenant) — sem payload
 *
 * WEBHOOKS (público, sem JWT):
 *   POST /webhooks/pagamentos/:gateway   (asaas | stripe | mercado_pago)
 *     1. gateway.validarWebhook(req) — false ⇒ 401 (corpo CRU disponível em request.corpoCru neste escopo)
 *     2. gateway.interpretarWebhook(req) — null ⇒ 200 { ignorado: true }
 *     3. idempotência: INSERT eventos_gateway (gateway, id_evento) — P2002 ⇒ 200 { duplicado: true }
 *     4. aplica: cobranca_paga ⇒ cobrança `paga` + pago_em; assinatura `ativa`. vencida/cancelada/estornada ⇒
 *        atualiza a cobrança (bloqueio da assinatura é do job diário, após dias_tolerancia).
 *     5. processado_em / erro no evento. Responde 200 sempre que o evento for autêntico.
 *   URL a configurar no painel do gateway: `${env.API_URL_PUBLICA}/webhooks/pagamentos/<gateway>`.
 *
 * Regras: credenciais cifradas (criptografarJson) + `credenciais_final` (finalSegredo); respostas só com
 * `mascararSegredo`. Só um gateway ativo (índice parcial). Worker: workers/cobrancas.ts.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarAdmin, exigirPapel } from '../../plugins/auth';

export const prefixo = '';

declare module 'fastify' {
  interface FastifyRequest {
    /** Corpo cru da requisição (só nas rotas de webhook de pagamento — validação HMAC). */
    corpoCru?: string;
  }
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- super admin
  await app.register(async (admin) => {
    admin.addHook('onRequest', autenticarAdmin);
    // TODO(admin-cobranca): /admin/cobranca/*
  });

  // ---------------------------------------------------------------- clínica
  await app.register(async (clinica) => {
    clinica.addHook('onRequest', exigirPapel('admin'));
    // TODO(admin-cobranca): GET /cobrancas/minhas
  });

  // ---------------------------------------------------------------- webhooks (corpo cru neste escopo)
  await app.register(async (webhooks) => {
    webhooks.removeAllContentTypeParsers();
    webhooks.addContentTypeParser('*', { parseAs: 'string' }, (request, corpo, feito) => {
      const texto = typeof corpo === 'string' ? corpo : corpo.toString('utf8');
      request.corpoCru = texto;
      if (!texto) return feito(null, {});
      try {
        feito(null, JSON.parse(texto));
      } catch {
        // Mercado Pago/Asaas mandam JSON; outros formatos ficam como texto (o adaptador decide).
        feito(null, texto);
      }
    });
    // TODO(admin-cobranca): POST /webhooks/pagamentos/:gateway
  });
};

export default modulo;
