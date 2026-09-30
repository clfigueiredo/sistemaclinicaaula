/**
 * Fábrica de gateways de pagamento (cobrança do SaaS).   [fase 2, dono: admin-cobranca]
 *
 *   const gw = await obterGatewayAtivo();          // null se nenhum ativo/configurado
 *   const gw = await obterGateway('asaas');        // por provedor (ex.: no webhook)
 *   await gw.criarCobranca({...});
 *
 * Carrega `gateways_pagamento` (prisma cru), decifra as credenciais (utils/cripto.ts) e instancia o
 * adaptador. Testes: `definirFabricaGateway(fn)` injeta um fake (null volta ao padrão).
 */
import type { ProvedorPagamento } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { descriptografar, descriptografarJson } from '../../utils/cripto';
import { criarAdaptadorAsaas } from './asaasAdapter';
import { criarAdaptadorMercadoPago } from './mercadoPagoAdapter';
import { criarAdaptadorStripe } from './stripeAdapter';
import {
  OPCOES_GATEWAY_PADRAO,
  type ConfigGateway,
  type CredenciaisArmazenadas,
  type CredenciaisGateway,
  type GatewayPagamento,
  type OpcoesGateway,
} from './tipos';

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

/** URL que o super admin cadastra no painel do gateway. */
export function urlWebhook(provedor: ProvedorPagamento): string {
  return `${env.API_URL_PUBLICA}/webhooks/pagamentos/${provedor}`;
}

/** Credencial principal (a que identifica a conta) de cada provedor. */
export function credencialPrincipal(c: Partial<CredenciaisArmazenadas> | null | undefined): string | null {
  if (!c) return null;
  const v = c.provedor === 'asaas' ? c.api_key : c.provedor === 'stripe' ? c.secret_key : c.provedor === 'mercado_pago' ? c.access_token : null;
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Credenciais do JSON cifrado (descarta o campo legado `opcoes`, que virou coluna). */
export function separarArmazenado(json: CredenciaisArmazenadas | null): { credenciais: CredenciaisGateway | null } {
  if (!json) return { credenciais: null };
  const { opcoes: _legado, ...credenciais } = json;
  return { credenciais: credencialPrincipal(json) ? (credenciais as CredenciaisGateway) : null };
}

/** Opções gerais do gateway a partir das colunas (padrões se não houver registro). */
export function opcoesDoRegistro(g: { dia_vencimento_padrao: number; descricao_cobranca: string } | null | undefined): OpcoesGateway {
  if (!g) return { ...OPCOES_GATEWAY_PADRAO };
  return { dia_vencimento_padrao: g.dia_vencimento_padrao, descricao_cobranca: g.descricao_cobranca };
}

/** Monta a configuração decifrada de um provedor (null se não cadastrado ou sem credenciais). */
export async function carregarConfigGateway(provedor: ProvedorPagamento): Promise<ConfigGateway | null> {
  const g = await prisma.gatewayPagamento.findUnique({ where: { provedor } });
  if (!g || !g.credenciais_cifradas) return null;
  const { credenciais } = separarArmazenado(descriptografarJson<CredenciaisArmazenadas>(g.credenciais_cifradas));
  if (!credenciais) return null;
  return {
    provedor: g.provedor,
    ambiente: g.ambiente,
    credenciais,
    segredoWebhook: g.segredo_webhook_cifrado ? descriptografar(g.segredo_webhook_cifrado) : null,
    metodos: g.metodos,
    diasTolerancia: g.dias_tolerancia,
    opcoes: opcoesDoRegistro(g),
  };
}

export async function obterGateway(provedor: ProvedorPagamento): Promise<GatewayPagamento | null> {
  const config = await carregarConfigGateway(provedor);
  return config ? fabrica(config) : null;
}

/** Gateway + configuração (quando o chamador precisa das opções/tolerância). */
export async function obterGatewayComConfig(
  provedor: ProvedorPagamento,
): Promise<{ gateway: GatewayPagamento; config: ConfigGateway } | null> {
  const config = await carregarConfigGateway(provedor);
  return config ? { gateway: fabrica(config), config } : null;
}

/** Provedor marcado como ativo (ou null). */
export async function provedorAtivo(): Promise<ProvedorPagamento | null> {
  const ativo = await prisma.gatewayPagamento.findFirst({ where: { ativo: true }, select: { provedor: true } });
  return ativo?.provedor ?? null;
}

/** Gateway marcado como ativo (só um — índice único parcial). */
export async function obterGatewayAtivo(): Promise<GatewayPagamento | null> {
  const ativo = await prisma.gatewayPagamento.findFirst({ where: { ativo: true }, select: { provedor: true } });
  return ativo ? obterGateway(ativo.provedor) : null;
}
