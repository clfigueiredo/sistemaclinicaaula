/**
 * ============================================================================
 * Cobrança automática do SaaS — contrato dos gateways (Asaas, Stripe, Mercado Pago).   [fase 2]
 * ============================================================================
 *
 * DONO: módulo `admin-cobranca` (docs/FASE2.md). Nenhum outro módulo chama a API de um gateway
 * diretamente: tudo passa por `obterGateway(provedor)` / `obterGatewayAtivo()` (./index.ts).
 *
 * Credenciais: `gateways_pagamento.credenciais_cifradas` (JSON cifrado — utils/cripto.ts). O adaptador
 * recebe as credenciais JÁ decifradas em `ConfigGateway`; nunca as registre em log.
 *
 * Valores monetários: number em REAIS com 2 casas (o adaptador converte para centavos quando o gateway
 * exigir — Stripe). Datas de vencimento: 'YYYY-MM-DD'.
 * ============================================================================
 */
import type { AmbienteGateway, MetodoCobranca, ProvedorPagamento, StatusCobranca } from '@prisma/client';

export type { AmbienteGateway, MetodoCobranca, ProvedorPagamento, StatusCobranca };

/** Credenciais por provedor (o que fica cifrado em credenciais_cifradas). */
export type CredenciaisGateway =
  | { provedor: 'asaas'; api_key: string }
  | { provedor: 'stripe'; secret_key: string; publishable_key?: string }
  | { provedor: 'mercado_pago'; access_token: string; public_key?: string };

/**
 * Opções gerais do gateway que NÃO têm coluna própria no schema (congelado): gravadas junto das
 * credenciais no JSON cifrado (`credenciais_cifradas.opcoes`). Não são segredo — só moram ali.
 */
export type OpcoesGateway = {
  /** Dia do mês (1–28) sugerido ao ativar a cobrança recorrente de uma clínica. */
  dia_vencimento_padrao: number;
  /** Texto da descrição da cobrança. `{plano}` e `{competencia}` (MM/AAAA) são substituídos. */
  descricao_cobranca: string;
};

export const OPCOES_GATEWAY_PADRAO: OpcoesGateway = {
  dia_vencimento_padrao: 10,
  descricao_cobranca: 'Mensalidade do sistema — plano {plano} ({competencia})',
};

/** O que fica no JSON cifrado: credenciais + opções gerais. */
export type CredenciaisArmazenadas = CredenciaisGateway & { opcoes?: Partial<OpcoesGateway> };

export type ConfigGateway = {
  provedor: ProvedorPagamento;
  ambiente: AmbienteGateway;
  credenciais: CredenciaisGateway;
  /** Segredo de validação de webhook (decifrado), se o provedor usar. */
  segredoWebhook: string | null;
  metodos: MetodoCobranca[];
  /** Dias após o vencimento antes de a assinatura virar `vencida`. */
  diasTolerancia: number;
  opcoes: OpcoesGateway;
};

export type ResultadoTesteConexao = { ok: boolean; mensagem: string };

export type DadosCliente = {
  clinicaId: string;
  nome: string;
  /** CPF/CNPJ só dígitos. */
  documento: string;
  email?: string | null;
  telefone?: string | null;
};

export type DadosAssinaturaGateway = {
  clienteExternoId: string;
  valor: number;
  /** Primeiro vencimento 'YYYY-MM-DD'. */
  proximoVencimento: string;
  descricao: string;
  metodo?: MetodoCobranca;
  /** Referência nossa (id da assinatura) — vai em metadata/externalReference. */
  referencia: string;
};

export type DadosCobrancaGateway = {
  clienteExternoId: string;
  valor: number;
  vencimento: string;
  descricao: string;
  metodo?: MetodoCobranca;
  /** Referência nossa (id da cobrança local) — vai em metadata/externalReference. */
  referencia: string;
};

export type ResultadoCobrancaGateway = {
  idExterno: string;
  status: StatusCobranca;
  linkPagamento: string | null;
  /** Payload bruto para auditoria (cobrancas.payload). */
  bruto?: unknown;
};

/** Evento de webhook já normalizado. */
export type EventoPagamento = {
  /** ID único do evento no gateway (idempotência: eventos_gateway (gateway, id_evento)). */
  idEvento: string;
  /** Tipo bruto do gateway (ex.: PAYMENT_RECEIVED, invoice.paid, payment.updated). */
  tipo: string;
  /** Efeito normalizado. */
  acao: 'cobranca_paga' | 'cobranca_vencida' | 'cobranca_cancelada' | 'cobranca_estornada' | 'cobranca_criada' | 'ignorar';
  /** ID da cobrança no gateway (cobrancas.id_externo), se houver. */
  cobrancaIdExterno?: string | null;
  assinaturaIdExterno?: string | null;
  /** Referência nossa enviada na criação (id da cobrança/assinatura local). */
  referencia?: string | null;
  valor?: number | null;
  pagoEm?: Date | null;
  bruto: unknown;
};

export type RequisicaoWebhook = {
  /** Corpo CRU (string) — necessário para validar assinatura HMAC (Stripe). */
  corpoCru: string;
  corpo: unknown;
  cabecalhos: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
};

export class ErroGatewayPagamento extends Error {
  constructor(
    mensagem: string,
    public readonly provedor: ProvedorPagamento,
    public readonly temporario = false,
    public readonly detalhe?: unknown,
  ) {
    super(mensagem);
    this.name = 'ErroGatewayPagamento';
  }
}

/** Contrato que cada adaptador implementa. */
export interface GatewayPagamento {
  readonly provedor: ProvedorPagamento;
  /** Chamada leve e sem efeitos colaterais para conferir credenciais/ambiente. Nunca lança. */
  testarConexao(): Promise<ResultadoTesteConexao>;
  /** Cria (ou reaproveita) o cliente no gateway. Retorna o ID externo (assinaturas.cliente_externo_id). */
  criarCliente(dados: DadosCliente): Promise<{ clienteExternoId: string }>;
  /** Assinatura recorrente gerenciada pelo gateway (assinaturas.assinatura_externa_id). */
  criarAssinatura(dados: DadosAssinaturaGateway): Promise<{ assinaturaExternaId: string; bruto?: unknown }>;
  /** Cobrança avulsa (fatura de um ciclo). */
  criarCobranca(dados: DadosCobrancaGateway): Promise<ResultadoCobrancaGateway>;
  /** Cancela uma cobrança ou assinatura no gateway. */
  cancelar(alvo: { tipo: 'cobranca' | 'assinatura'; idExterno: string }): Promise<void>;
  /** Valida autenticidade do webhook (token/HMAC). false ⇒ a rota responde 401 e não processa. */
  validarWebhook(req: RequisicaoWebhook): Promise<boolean> | boolean;
  /** Normaliza o webhook. null ⇒ evento irrelevante (responde 200 e ignora). */
  interpretarWebhook(req: RequisicaoWebhook): EventoPagamento | null | Promise<EventoPagamento | null>;
}
