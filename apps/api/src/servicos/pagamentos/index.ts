/**
 * Fábrica de gateways de pagamento (cobrança do SaaS).   [STUB — fase 2, dono: admin-cobranca]
 *
 *   const gw = await obterGatewayAtivo();          // null se nenhum ativo/configurado
 *   const gw = await obterGateway('asaas');        // por provedor (ex.: no webhook)
 *   await gw.criarCobranca({...});
 *
 * Carrega `gateways_pagamento` (prisma cru), decifra as credenciais (utils/cripto.ts) e instancia o
 * adaptador. Testes: `definirFabricaGateway(fn)` injeta um fake (null volta ao padrão).
 */
import type { ProvedorPagamento } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { descriptografar, descriptografarJson } from '../../utils/cripto';
import { criarAdaptadorAsaas } from './asaasAdapter';
import { criarAdaptadorMercadoPago } from './mercadoPagoAdapter';
import { criarAdaptadorStripe } from './stripeAdapter';
import type { ConfigGateway, CredenciaisGateway, GatewayPagamento } from './tipos';

export * from './tipos';

export const PROVEDORES_PAGAMENTO: readonly ProvedorPagamento[] = ['asaas', 'stripe', 'mercado_pago'];

export const NOMES_PROVEDORES: Record<ProvedorPagamento, string> = {
  asaas: 'Asaas',
  stripe: 'Stripe',
  mercado_pago: 'Mercado Pago',
};

type Fabrica = (config: ConfigGateway) => GatewayPagamento;

const fabricaPadrao: Fabrica = (config) => {
  switch (config.provedor) {
    case 'asaas':
      return criarAdaptadorAsaas(config);
    case 'stripe':
      return criarAdaptadorStripe(config);
    case 'mercado_pago':
      return criarAdaptadorMercadoPago(config);
  }
};

let fabrica: Fabrica = fabricaPadrao;

/** Testes: injeta uma fábrica fake. null = padrão. */
export function definirFabricaGateway(nova: Fabrica | null): void {
  fabrica = nova ?? fabricaPadrao;
}

/** Monta a configuração decifrada de um provedor (null se não cadastrado ou sem credenciais). */
export async function carregarConfigGateway(provedor: ProvedorPagamento): Promise<ConfigGateway | null> {
  const g = await prisma.gatewayPagamento.findUnique({ where: { provedor } });
  if (!g || !g.credenciais_cifradas) return null;
  return {
    provedor: g.provedor,
    ambiente: g.ambiente,
    credenciais: descriptografarJson<CredenciaisGateway>(g.credenciais_cifradas),
    segredoWebhook: g.segredo_webhook_cifrado ? descriptografar(g.segredo_webhook_cifrado) : null,
    metodos: g.metodos,
  };
}

export async function obterGateway(provedor: ProvedorPagamento): Promise<GatewayPagamento | null> {
  const config = await carregarConfigGateway(provedor);
  return config ? fabrica(config) : null;
}

/** Gateway marcado como ativo (só um — índice único parcial). */
export async function obterGatewayAtivo(): Promise<GatewayPagamento | null> {
  const ativo = await prisma.gatewayPagamento.findFirst({ where: { ativo: true }, select: { provedor: true } });
  return ativo ? obterGateway(ativo.provedor) : null;
}
