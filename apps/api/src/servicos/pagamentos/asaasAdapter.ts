/**
 * Adaptador Asaas (fetch nativo, sem SDK).
 *
 * API v3 — https://docs.asaas.com
 *   Base: sandbox https://api-sandbox.asaas.com/v3 · produção https://api.asaas.com/v3
 *   Autenticação: header `access_token: <api_key>` (+ User-Agent, exigido pelo Asaas para contas novas).
 *
 * Endpoints usados:
 *   GET    /customers?limit=1                  testar conexão (leitura, sem efeito colateral)
 *   GET    /customers?cpfCnpj=…  · POST /customers     cliente (reaproveita pelo CPF/CNPJ)
 *   POST   /payments                           cobrança avulsa (billingType PIX | BOLETO | CREDIT_CARD | UNDEFINED)
 *   DELETE /payments/:id                       cancelar cobrança
 *   POST   /subscriptions · DELETE /subscriptions/:id   recorrência nativa (disponível, não usada pelo fluxo —
 *                                              o nosso worker gera uma cobrança por ciclo; ver admin-cobranca)
 *
 * Webhook (POST /webhooks/pagamentos/asaas): o Asaas envia o "Token de autenticação" cadastrado no painel
 * no header `asaas-access-token` — comparado em tempo constante com o segredo do webhook salvo aqui.
 * Sem segredo configurado, TODO webhook é recusado. Corpo: { id, event, payment: { id, status, externalReference, … } }.
 */
import { cabecalho, requisitarJson, segredosIguais, testarComSeguranca } from './http';
import {
  ErroGatewayPagamento,
  type ConfigGateway,
  type EventoPagamento,
  type GatewayPagamento,
  type MetodoCobranca,
  type StatusCobranca,
} from './tipos';

export const URL_ASAAS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
} as const;

const TIPO_COBRANCA: Record<MetodoCobranca, string> = { pix: 'PIX', boleto: 'BOLETO', cartao: 'CREDIT_CARD' };

const STATUS_ASAAS: Record<string, StatusCobranca> = {
  PENDING: 'pendente',
  AWAITING_RISK_ANALYSIS: 'pendente',
  RECEIVED: 'paga',
  CONFIRMED: 'paga',
  RECEIVED_IN_CASH: 'paga',
  OVERDUE: 'vencida',
  REFUNDED: 'estornada',
  CHARGEBACK_REQUESTED: 'estornada',
};

const ACAO_EVENTO: Record<string, EventoPagamento['acao']> = {
  PAYMENT_CREATED: 'cobranca_criada',
  PAYMENT_CONFIRMED: 'cobranca_paga',
  PAYMENT_RECEIVED: 'cobranca_paga',
  PAYMENT_RECEIVED_IN_CASH: 'cobranca_paga',
  PAYMENT_OVERDUE: 'cobranca_vencida',
  PAYMENT_DELETED: 'cobranca_cancelada',
  PAYMENT_REFUNDED: 'cobranca_estornada',
  PAYMENT_CHARGEBACK_REQUESTED: 'cobranca_estornada',
};

type PagamentoAsaas = {
  id: string;
  status?: string;
  value?: number;
  externalReference?: string | null;
  subscription?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
};

/** 'YYYY-MM-DD' do Asaas ⇒ Date (meio-dia de Brasília, para não trocar de dia por fuso). */
function dataAsaas(d: string | null | undefined): Date | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  return new Date(`${d.slice(0, 10)}T12:00:00-03:00`);
}

export function criarAdaptadorAsaas(config: ConfigGateway): GatewayPagamento {
  if (config.credenciais.provedor !== 'asaas') {
    throw new ErroGatewayPagamento('Credenciais do Asaas inválidas.', 'asaas');
  }
  const apiKey = config.credenciais.api_key;
  const base = URL_ASAAS[config.ambiente];

  function chamar<T>(caminho: string, init: { method?: string; corpo?: unknown } = {}) {
    return requisitarJson<T>('asaas', `${base}${caminho}`, {
      method: init.method ?? 'GET',
      headers: {
        access_token: apiKey,
        'User-Agent': 'SistemaClinica/1.0',
        Accept: 'application/json',
        ...(init.corpo !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: init.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
    });
  }

  function tipoCobranca(metodo?: MetodoCobranca): string {
    if (metodo) return TIPO_COBRANCA[metodo];
    // Um único método permitido ⇒ usa-o; senão o cliente escolhe na fatura (UNDEFINED).
    if (config.metodos.length === 1) return TIPO_COBRANCA[config.metodos[0]!];
    return 'UNDEFINED';
  }

  return {
    provedor: 'asaas',

    testarConexao: () =>
      testarComSeguranca('asaas', async () => {
        await chamar('/customers?limit=1');
        return `Conexão com o Asaas (${config.ambiente === 'sandbox' ? 'sandbox' : 'produção'}) funcionando.`;
      }),

    async criarCliente(dados) {
      const existentes = await chamar<{ data?: { id: string; deleted?: boolean }[] }>(
        `/customers?cpfCnpj=${encodeURIComponent(dados.documento)}&limit=10`,
      );
      const existente = existentes.data?.find((c) => !c.deleted);
      if (existente) return { clienteExternoId: existente.id };
      const criado = await chamar<{ id: string }>('/customers', {
        method: 'POST',
        corpo: {
          name: dados.nome,
          cpfCnpj: dados.documento,
          email: dados.email || undefined,
          mobilePhone: dados.telefone || undefined,
          externalReference: dados.clinicaId,
        },
      });
      return { clienteExternoId: criado.id };
    },

    async criarAssinatura(dados) {
      const r = await chamar<{ id: string }>('/subscriptions', {
        method: 'POST',
        corpo: {
          customer: dados.clienteExternoId,
          billingType: tipoCobranca(dados.metodo),
          value: dados.valor,
          nextDueDate: dados.proximoVencimento,
          cycle: 'MONTHLY',
          description: dados.descricao,
          externalReference: dados.referencia,
        },
      });
      return { assinaturaExternaId: r.id, bruto: r };
    },

    async criarCobranca(dados) {
      const r = await chamar<PagamentoAsaas>('/payments', {
        method: 'POST',
        corpo: {
          customer: dados.clienteExternoId,
          billingType: tipoCobranca(dados.metodo),
          value: dados.valor,
          dueDate: dados.vencimento,
          description: dados.descricao.slice(0, 500),
          externalReference: dados.referencia,
        },
      });
      return {
        idExterno: r.id,
        status: STATUS_ASAAS[r.status ?? ''] ?? 'pendente',
        linkPagamento: r.invoiceUrl ?? r.bankSlipUrl ?? null,
        bruto: r,
      };
    },

    async cancelar(alvo) {
      const caminho = alvo.tipo === 'cobranca' ? '/payments/' : '/subscriptions/';
      await chamar(`${caminho}${encodeURIComponent(alvo.idExterno)}`, { method: 'DELETE' });
    },

    validarWebhook(req) {
      return segredosIguais(cabecalho(req.cabecalhos, 'asaas-access-token'), config.segredoWebhook);
    },

    interpretarWebhook(req) {
      const corpo = req.corpo as { id?: string; event?: string; payment?: PagamentoAsaas } | null;
      if (!corpo || typeof corpo !== 'object' || typeof corpo.event !== 'string') return null;
      const pagamento = corpo.payment;
      if (!pagamento?.id) return null; // eventos que não são de cobrança (ex.: transferências)
      const acao = ACAO_EVENTO[corpo.event] ?? 'ignorar';
      return {
        idEvento: corpo.id || `${corpo.event}:${pagamento.id}:${pagamento.status ?? ''}`,
        tipo: corpo.event,
        acao,
        cobrancaIdExterno: pagamento.id,
        assinaturaIdExterno: pagamento.subscription ?? null,
        referencia: pagamento.externalReference ?? null,
        valor: typeof pagamento.value === 'number' ? pagamento.value : null,
        pagoEm:
          acao === 'cobranca_paga'
            ? (dataAsaas(pagamento.clientPaymentDate) ?? dataAsaas(pagamento.paymentDate) ?? dataAsaas(pagamento.confirmedDate) ?? new Date())
            : null,
        bruto: corpo,
      };
    },
  };
}
