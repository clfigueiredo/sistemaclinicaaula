/**
 * Adaptador Mercado Pago (fetch nativo, sem SDK).
 *
 * API — https://www.mercadopago.com.br/developers   Base https://api.mercadopago.com
 *   Autenticação: `Authorization: Bearer <access_token>`. Sandbox × produção = credenciais de teste × produção
 *   (mesma URL); em sandbox o link devolvido é o `sandbox_init_point`.
 *
 * Endpoints usados:
 *   GET  /users/me                                   testar conexão (leitura)
 *   GET  /v1/customers/search?email= · POST /v1/customers   cliente (o Mercado Pago exige e-mail)
 *   POST /checkout/preferences                       cobrança avulsa = preferência do Checkout Pro (link `init_point`,
 *                                                    Pix/boleto/cartão conforme os métodos permitidos); external_reference
 *                                                    = id da cobrança local (é assim que o pagamento volta para ela)
 *   PUT  /checkout/preferences/:id { expires }       cancelar cobrança (expira o link)
 *   POST /preapproval · PUT /preapproval/:id         recorrência nativa (disponível, não usada pelo fluxo)
 *   GET  /v1/payments/:id                            confirmação do webhook (o corpo do webhook só traz o id)
 *
 * Webhook (POST /webhooks/pagamentos/mercado_pago): header `x-signature: ts=<ts>,v1=<hex>` + `x-request-id`.
 * v1 = HMAC-SHA256(assinatura secreta, `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`) — data.id vem da query
 * (`?data.id=`), em minúsculas se alfanumérico. Depois de validar, o pagamento é CONSULTADO na API e só o status
 * devolvido pela API vale (approved ⇒ paga; refunded/charged_back ⇒ estornada; demais ⇒ ignorado, porque um
 * pagamento recusado/expirado não invalida a fatura — o cliente pode tentar de novo pelo mesmo link).
 */
import { env } from '../../config/env';
import { cabecalho, hmacSha256Hex, requisitarJson, segredosIguais, testarComSeguranca } from './http';
import {
  ErroGatewayPagamento,
  type ConfigGateway,
  type EventoPagamento,
  type GatewayPagamento,
  type MetodoCobranca,
  type RequisicaoWebhook,
} from './tipos';

export const URL_MERCADO_PAGO = 'https://api.mercadopago.com';

/** Tipos de pagamento do Mercado Pago por método nosso (para `excluded_payment_types`). */
const TIPOS_MP: Record<MetodoCobranca, string[]> = {
  pix: ['bank_transfer'],
  boleto: ['ticket'],
  cartao: ['credit_card', 'debit_card', 'prepaid_card'],
};

type PagamentoMP = {
  id: number | string;
  status?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  date_approved?: string | null;
};

export function criarAdaptadorMercadoPago(config: ConfigGateway): GatewayPagamento {
  if (config.credenciais.provedor !== 'mercado_pago') {
    throw new ErroGatewayPagamento('Credenciais do Mercado Pago inválidas.', 'mercado_pago');
  }
  const token = config.credenciais.access_token;
  /** Pagamento consultado na validação do webhook, reaproveitado na interpretação (mesma requisição). */
  const consultados = new WeakMap<RequisicaoWebhook, PagamentoMP | null>();

  function chamar<T>(caminho: string, init: { method?: string; corpo?: unknown; idempotencia?: string } = {}) {
    return requisitarJson<T>('mercado_pago', `${URL_MERCADO_PAGO}${caminho}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.corpo !== undefined && { 'Content-Type': 'application/json' }),
        ...(init.idempotencia && { 'X-Idempotency-Key': init.idempotencia }),
      },
      body: init.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
    });
  }

  function tiposExcluidos(metodo?: MetodoCobranca): { id: string }[] {
    const permitidos = metodo ? [metodo] : config.metodos.length ? config.metodos : (['pix', 'boleto', 'cartao'] as MetodoCobranca[]);
    return (Object.keys(TIPOS_MP) as MetodoCobranca[])
      .filter((m) => !permitidos.includes(m))
      .flatMap((m) => TIPOS_MP[m].map((id) => ({ id })));
  }

  function idDoRecurso(req: RequisicaoWebhook): string | null {
    const q = req.query['data.id'] ?? (req.query.data as Record<string, unknown> | undefined)?.id ?? req.query.id;
    const corpo = req.corpo as { data?: { id?: unknown } } | null;
    const bruto = q ?? corpo?.data?.id;
    if (bruto === undefined || bruto === null || bruto === '') return null;
    const id = String(bruto);
    return /^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id;
  }

  function topico(req: RequisicaoWebhook): string | null {
    const corpo = req.corpo as { type?: unknown; topic?: unknown } | null;
    const t = req.query.type ?? req.query.topic ?? corpo?.type ?? corpo?.topic;
    return typeof t === 'string' ? t : null;
  }

  return {
    provedor: 'mercado_pago',

    testarConexao: () =>
      testarComSeguranca('mercado_pago', async () => {
        const eu = await chamar<{ id?: number; nickname?: string }>('/users/me');
        if (config.ambiente === 'producao' && token.startsWith('TEST-')) {
          throw new ErroGatewayPagamento('O Access Token informado é de TESTE, mas o ambiente está como produção.', 'mercado_pago');
        }
        return `Conexão com o Mercado Pago funcionando${eu.nickname ? ` (conta ${eu.nickname})` : ''}.`;
      }),

    async criarCliente(dados) {
      if (!dados.email) {
        throw new ErroGatewayPagamento(
          'O Mercado Pago exige o e-mail da clínica para cadastrar o cliente. Preencha o e-mail no cadastro da clínica.',
          'mercado_pago',
        );
      }
      const busca = await chamar<{ results?: { id: string }[] }>(`/v1/customers/search?email=${encodeURIComponent(dados.email)}`);
      if (busca.results?.[0]) return { clienteExternoId: busca.results[0].id };
      const doc = dados.documento.replace(/\D/g, '');
      const criado = await chamar<{ id: string }>('/v1/customers', {
        method: 'POST',
        corpo: {
          email: dados.email,
          first_name: dados.nome.slice(0, 100),
          identification: { type: doc.length > 11 ? 'CNPJ' : 'CPF', number: doc },
          description: `Clínica ${dados.clinicaId}`,
        },
      });
      return { clienteExternoId: criado.id };
    },

    async criarAssinatura(dados) {
      const cliente = await chamar<{ email?: string }>(`/v1/customers/${encodeURIComponent(dados.clienteExternoId)}`);
      const r = await chamar<{ id: string }>('/preapproval', {
        method: 'POST',
        idempotencia: `assinatura-${dados.referencia}`,
        corpo: {
          reason: dados.descricao.slice(0, 250),
          external_reference: dados.referencia,
          payer_email: cliente.email,
          back_url: env.WEB_URL_PUBLICA,
          status: 'pending',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: dados.valor,
            currency_id: 'BRL',
            start_date: `${dados.proximoVencimento}T12:00:00.000-03:00`,
          },
        },
      });
      return { assinaturaExternaId: r.id, bruto: r };
    },

    async criarCobranca(dados) {
      const cliente = await chamar<{ email?: string }>(`/v1/customers/${encodeURIComponent(dados.clienteExternoId)}`).catch(
        () => ({}) as { email?: string },
      );
      const r = await chamar<{ id: string; init_point?: string; sandbox_init_point?: string }>('/checkout/preferences', {
        method: 'POST',
        idempotencia: `cobranca-${dados.referencia}`,
        corpo: {
          items: [
            {
              id: dados.referencia,
              title: dados.descricao.slice(0, 250),
              quantity: 1,
              unit_price: dados.valor,
              currency_id: 'BRL',
            },
          ],
          external_reference: dados.referencia,
          ...(cliente.email && { payer: { email: cliente.email } }),
          payment_methods: { excluded_payment_types: tiposExcluidos(dados.metodo), installments: 1 },
          statement_descriptor: 'SISTEMA CLINICA',
        },
      });
      const link = config.ambiente === 'sandbox' ? (r.sandbox_init_point ?? r.init_point) : r.init_point;
      return { idExterno: r.id, status: 'pendente', linkPagamento: link ?? null, bruto: r };
    },

    async cancelar(alvo) {
      if (alvo.tipo === 'cobranca') {
        await chamar(`/checkout/preferences/${encodeURIComponent(alvo.idExterno)}`, {
          method: 'PUT',
          corpo: { expires: true, expiration_date_to: new Date().toISOString() },
        });
      } else {
        await chamar(`/preapproval/${encodeURIComponent(alvo.idExterno)}`, { method: 'PUT', corpo: { status: 'cancelled' } });
      }
    },

    async validarWebhook(req) {
      const segredo = config.segredoWebhook;
      const assinatura = cabecalho(req.cabecalhos, 'x-signature');
      if (!segredo || !assinatura) return false;
      let ts: string | null = null;
      let v1: string | null = null;
      for (const parte of assinatura.split(',')) {
        const [k, v] = parte.split('=').map((s) => s?.trim());
        if (k === 'ts' && v) ts = v;
        else if (k === 'v1' && v) v1 = v;
      }
      if (!ts || !v1) return false;
      const id = idDoRecurso(req);
      const requestId = cabecalho(req.cabecalhos, 'x-request-id');
      // Manifesto oficial; partes ausentes são omitidas (documentação do Mercado Pago).
      const manifesto =
        (id ? `id:${id};` : '') + (requestId ? `request-id:${requestId};` : '') + `ts:${ts};`;
      if (!segredosIguais(v1, hmacSha256Hex(segredo, manifesto))) return false;

      // Autêntico: confirma o status direto na API (erros temporários propagam ⇒ o Mercado Pago reenvia).
      if (topico(req) === 'payment' && id) {
        const pagamento = await chamar<PagamentoMP>(`/v1/payments/${encodeURIComponent(id)}`);
        consultados.set(req, pagamento);
      } else {
        consultados.set(req, null);
      }
      return true;
    },

    interpretarWebhook(req) {
      const pagamento = consultados.get(req);
      if (!pagamento) return null; // outros tópicos (merchant_order, planos…) são ignorados
      const status = pagamento.status ?? '';
      const acao: EventoPagamento['acao'] =
        status === 'approved'
          ? 'cobranca_paga'
          : status === 'refunded' || status === 'charged_back'
            ? 'cobranca_estornada'
            : 'ignorar';
      return {
        idEvento: `pagamento:${pagamento.id}:${status}`,
        tipo: `payment.${status || 'desconhecido'}`,
        acao,
        cobrancaIdExterno: null,
        referencia: pagamento.external_reference ?? null,
        valor: typeof pagamento.transaction_amount === 'number' ? pagamento.transaction_amount : null,
        pagoEm: acao === 'cobranca_paga' ? (pagamento.date_approved ? new Date(pagamento.date_approved) : new Date()) : null,
        bruto: pagamento,
      };
    },
  };
}
