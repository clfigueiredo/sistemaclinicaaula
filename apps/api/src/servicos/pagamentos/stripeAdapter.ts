/**
 * Adaptador Stripe (fetch nativo, sem SDK).
 *
 * API — https://docs.stripe.com/api   Base https://api.stripe.com/v1 (sandbox = chaves sk_test_, produção = sk_live_)
 *   Autenticação: `Authorization: Bearer <secret_key>`; corpo application/x-www-form-urlencoded; valores em
 *   centavos; `Stripe-Version` fixada para o formato das respostas/eventos não mudar sem aviso.
 *
 * Endpoints usados:
 *   GET  /v1/balance                            testar conexão (leitura) + confere livemode × ambiente
 *   GET  /v1/customers/search · POST /v1/customers     cliente (metadata.clinica_id)
 *   POST /v1/invoices → POST /v1/invoiceitems → POST /v1/invoices/:id/finalize
 *                                               cobrança avulsa = fatura `send_invoice` com vencimento; o link é a
 *                                               `hosted_invoice_url` (cartão e boleto; Stripe não oferece Pix em faturas)
 *   POST /v1/invoices/:id/void                  cancelar cobrança
 *   POST /v1/products + POST /v1/subscriptions (price_data inline) · DELETE /v1/subscriptions/:id
 *                                               recorrência nativa (disponível, não usada pelo fluxo — ver admin-cobranca)
 *
 * Webhook (POST /webhooks/pagamentos/stripe): header `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]`;
 * v1 = HMAC-SHA256(segredo whsec_…, `${t}.${corpoCru}`), comparado em tempo constante, com tolerância de 5 min.
 * Eventos: invoice.paid ⇒ paga · invoice.overdue / invoice.marked_uncollectible ⇒ vencida · invoice.voided ⇒ cancelada ·
 * charge.refunded (total, com invoice) ⇒ estornada.
 */
import {
  cabecalho,
  fimDoDiaUnix,
  formUrlEncoded,
  hmacSha256Hex,
  paraCentavos,
  requisitarJson,
  segredosIguais,
  testarComSeguranca,
} from './http';
import {
  ErroGatewayPagamento,
  type ConfigGateway,
  type EventoPagamento,
  type GatewayPagamento,
  type MetodoCobranca,
  type StatusCobranca,
} from './tipos';

export const URL_STRIPE = 'https://api.stripe.com/v1';
export const VERSAO_API_STRIPE = '2024-06-20';
/** Tolerância da assinatura do webhook (mesmo padrão das bibliotecas oficiais). */
export const TOLERANCIA_WEBHOOK_STRIPE_S = 300;

const TIPO_PAGAMENTO: Partial<Record<MetodoCobranca, string>> = { cartao: 'card', boleto: 'boleto' };

const STATUS_FATURA: Record<string, StatusCobranca> = {
  draft: 'pendente',
  open: 'pendente',
  paid: 'paga',
  void: 'cancelada',
  uncollectible: 'vencida',
};

type FaturaStripe = {
  id: string;
  status?: string;
  hosted_invoice_url?: string | null;
  metadata?: Record<string, string> | null;
  subscription?: string | null;
  amount_paid?: number;
  status_transitions?: { paid_at?: number | null } | null;
};

type EventoStripe = { id?: string; type?: string; data?: { object?: Record<string, unknown> } };

export function criarAdaptadorStripe(config: ConfigGateway): GatewayPagamento {
  if (config.credenciais.provedor !== 'stripe') {
    throw new ErroGatewayPagamento('Credenciais do Stripe inválidas.', 'stripe');
  }
  const secretKey = config.credenciais.secret_key;

  function chamar<T>(caminho: string, init: { method?: string; corpo?: Record<string, unknown>; idempotencia?: string } = {}) {
    return requisitarJson<T>('stripe', `${URL_STRIPE}${caminho}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Stripe-Version': VERSAO_API_STRIPE,
        Accept: 'application/json',
        ...(init.corpo !== undefined && { 'Content-Type': 'application/x-www-form-urlencoded' }),
        ...(init.idempotencia && { 'Idempotency-Key': init.idempotencia }),
      },
      body: init.corpo !== undefined ? formUrlEncoded(init.corpo) : undefined,
    });
  }

  function tiposPagamento(metodo?: MetodoCobranca): string[] | undefined {
    if (metodo) {
      const t = TIPO_PAGAMENTO[metodo];
      if (!t) throw new ErroGatewayPagamento('O Stripe não oferece Pix em faturas. Use cartão ou boleto.', 'stripe');
      return [t];
    }
    const tipos = config.metodos.map((m) => TIPO_PAGAMENTO[m]).filter((t): t is string => !!t);
    return tipos.length ? tipos : undefined; // vazio ⇒ padrão da conta Stripe
  }

  return {
    provedor: 'stripe',

    testarConexao: () =>
      testarComSeguranca('stripe', async () => {
        const saldo = await chamar<{ livemode?: boolean }>('/balance');
        if (saldo.livemode === true && config.ambiente === 'sandbox') {
          throw new ErroGatewayPagamento('A chave informada é de PRODUÇÃO (sk_live_), mas o ambiente está como sandbox.', 'stripe');
        }
        if (saldo.livemode === false && config.ambiente === 'producao') {
          throw new ErroGatewayPagamento('A chave informada é de TESTE (sk_test_), mas o ambiente está como produção.', 'stripe');
        }
        return `Conexão com o Stripe (${saldo.livemode ? 'produção' : 'modo de teste'}) funcionando.`;
      }),

    async criarCliente(dados) {
      try {
        const busca = await chamar<{ data?: { id: string }[] }>(
          `/customers/search?query=${encodeURIComponent(`metadata['clinica_id']:'${dados.clinicaId}'`)}&limit=1`,
        );
        if (busca.data?.[0]) return { clienteExternoId: busca.data[0].id };
      } catch (e) {
        // A busca pode não estar disponível em todas as contas/regiões: segue criando.
        if (e instanceof ErroGatewayPagamento && e.temporario) throw e;
      }
      const criado = await chamar<{ id: string }>('/customers', {
        method: 'POST',
        idempotencia: `cliente-${dados.clinicaId}`,
        corpo: {
          name: dados.nome,
          email: dados.email || undefined,
          phone: dados.telefone || undefined,
          metadata: { clinica_id: dados.clinicaId, documento: dados.documento },
        },
      });
      return { clienteExternoId: criado.id };
    },

    async criarAssinatura(dados) {
      const produto = await chamar<{ id: string }>('/products', {
        method: 'POST',
        idempotencia: `produto-${dados.referencia}`,
        corpo: { name: dados.descricao.slice(0, 250) },
      });
      const r = await chamar<{ id: string }>('/subscriptions', {
        method: 'POST',
        idempotencia: `assinatura-${dados.referencia}`,
        corpo: {
          customer: dados.clienteExternoId,
          collection_method: 'send_invoice',
          days_until_due: 5,
          billing_cycle_anchor: fimDoDiaUnix(dados.proximoVencimento),
          proration_behavior: 'none',
          items: [
            {
              price_data: {
                currency: 'brl',
                product: produto.id,
                unit_amount: paraCentavos(dados.valor),
                recurring: { interval: 'month' },
              },
            },
          ],
          payment_settings: { payment_method_types: tiposPagamento(dados.metodo) },
          metadata: { referencia: dados.referencia },
        },
      });
      return { assinaturaExternaId: r.id, bruto: r };
    },

    async criarCobranca(dados) {
      const fatura = await chamar<FaturaStripe>('/invoices', {
        method: 'POST',
        idempotencia: `cobranca-${dados.referencia}-fatura`,
        corpo: {
          customer: dados.clienteExternoId,
          collection_method: 'send_invoice',
          due_date: fimDoDiaUnix(dados.vencimento),
          currency: 'brl',
          description: dados.descricao.slice(0, 500),
          auto_advance: false,
          pending_invoice_items_behavior: 'exclude',
          payment_settings: { payment_method_types: tiposPagamento(dados.metodo) },
          metadata: { referencia: dados.referencia },
        },
      });
      try {
        await chamar('/invoiceitems', {
          method: 'POST',
          idempotencia: `cobranca-${dados.referencia}-item`,
          corpo: {
            customer: dados.clienteExternoId,
            invoice: fatura.id,
            amount: paraCentavos(dados.valor),
            currency: 'brl',
            description: dados.descricao.slice(0, 500),
          },
        });
        const final = await chamar<FaturaStripe>(`/invoices/${encodeURIComponent(fatura.id)}/finalize`, {
          method: 'POST',
          idempotencia: `cobranca-${dados.referencia}-finalizar`,
          corpo: {},
        });
        return {
          idExterno: final.id,
          status: STATUS_FATURA[final.status ?? ''] ?? 'pendente',
          linkPagamento: final.hosted_invoice_url ?? null,
          bruto: final,
        };
      } catch (e) {
        // Não deixa rascunho órfão no Stripe (melhor esforço).
        await chamar(`/invoices/${encodeURIComponent(fatura.id)}`, { method: 'DELETE' }).catch(() => undefined);
        throw e;
      }
    },

    async cancelar(alvo) {
      if (alvo.tipo === 'cobranca') {
        await chamar(`/invoices/${encodeURIComponent(alvo.idExterno)}/void`, { method: 'POST', corpo: {} });
      } else {
        await chamar(`/subscriptions/${encodeURIComponent(alvo.idExterno)}`, { method: 'DELETE' });
      }
    },

    validarWebhook(req) {
      const segredo = config.segredoWebhook;
      const assinatura = cabecalho(req.cabecalhos, 'stripe-signature');
      if (!segredo || !assinatura || typeof req.corpoCru !== 'string') return false;
      let t: string | null = null;
      const v1: string[] = [];
      for (const parte of assinatura.split(',')) {
        const i = parte.indexOf('=');
        if (i < 0) continue;
        const k = parte.slice(0, i).trim();
        const v = parte.slice(i + 1).trim();
        if (k === 't') t = v;
        else if (k === 'v1') v1.push(v);
      }
      if (!t || !/^\d+$/.test(t) || v1.length === 0) return false;
      if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > TOLERANCIA_WEBHOOK_STRIPE_S) return false;
      const esperado = hmacSha256Hex(segredo, `${t}.${req.corpoCru}`);
      return v1.some((v) => segredosIguais(v, esperado));
    },

    interpretarWebhook(req) {
      const ev = req.corpo as EventoStripe | null;
      if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || typeof ev.type !== 'string') return null;
      const obj = (ev.data?.object ?? {}) as Record<string, unknown>;
      const base = { idEvento: ev.id, tipo: ev.type, bruto: ev };

      if (ev.type.startsWith('invoice.')) {
        const f = obj as unknown as FaturaStripe;
        const acoes: Record<string, EventoPagamento['acao']> = {
          'invoice.paid': 'cobranca_paga',
          'invoice.overdue': 'cobranca_vencida',
          'invoice.marked_uncollectible': 'cobranca_vencida',
          'invoice.voided': 'cobranca_cancelada',
          'invoice.finalized': 'cobranca_criada',
        };
        const acao = acoes[ev.type] ?? 'ignorar';
        const pagoEm = f.status_transitions?.paid_at ? new Date(f.status_transitions.paid_at * 1000) : new Date();
        return {
          ...base,
          acao,
          cobrancaIdExterno: f.id ?? null,
          assinaturaIdExterno: typeof f.subscription === 'string' ? f.subscription : null,
          referencia: f.metadata?.referencia ?? null,
          valor: typeof f.amount_paid === 'number' ? f.amount_paid / 100 : null,
          pagoEm: acao === 'cobranca_paga' ? pagoEm : null,
        };
      }

      if (ev.type === 'charge.refunded') {
        const fatura = typeof obj.invoice === 'string' ? obj.invoice : null;
        // Só estorno total de uma fatura nossa interessa.
        if (!fatura || obj.refunded !== true) return { ...base, acao: 'ignorar' };
        return { ...base, acao: 'cobranca_estornada', cobrancaIdExterno: fatura };
      }

      return { ...base, acao: 'ignorar' };
    },
  };
}
