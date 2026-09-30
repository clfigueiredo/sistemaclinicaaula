/**
 * Módulo admin-cobranca — cobrança automática do SaaS (Asaas, Stripe, Mercado Pago).
 *
 * Contrato: docs/FASE2.md §7. Dados de PLATAFORMA (prisma cru): gateways_pagamento, cobrancas,
 * eventos_gateway, assinaturas (gateway, cliente_externo_id, assinatura_externa_id, dia_vencimento).
 * Gateways só via servicos/pagamentos (obterGateway/obterGatewayAtivo). Segredos: utils/cripto.ts.
 * Regras de negócio e decisões (recorrência pelo nosso worker, tolerância ⇒ `vencida`): ./servico.ts.
 * Prefixo "" (as rotas trazem o caminho completo).
 *
 * SUPER ADMIN (autenticarAdmin):
 *   GET    /admin/cobranca/gateways                       os 3 provedores (configurados ou não) — NUNCA devolve segredo
 *   PUT    /admin/cobranca/gateways/:provedor             { ambiente?, credenciais?, segredo_webhook?, dias_tolerancia?,
 *                                                          metodos?, dia_vencimento_padrao?, descricao_cobranca? }
 *                                                          campo de segredo vazio/ausente = mantém o atual; segredo_webhook null = remove
 *   POST   /admin/cobranca/gateways/:provedor/ativar      desativa os outros e ativa este (transação). 409 gateway_nao_configurado
 *   POST   /admin/cobranca/gateways/:provedor/desativar
 *   POST   /admin/cobranca/gateways/:provedor/testar      chamada leve ao gateway ⇒ { ok, mensagem }
 *   GET    /admin/cobranca/cobrancas?status&clinica_id&de&ate&pagina&por_pagina   Paginado + totais
 *   GET    /admin/cobranca/clinicas/:clinicaId            cobrança automática da clínica + últimas cobranças
 *   POST   /admin/cobranca/clinicas/:clinicaId/cobrancas  { vencimento, valor?, descricao?, metodo? } (gateway ativo) ⇒ 201
 *   POST   /admin/cobranca/clinicas/:clinicaId/assinatura { dia_vencimento, metodo?, gerar_agora? } liga a cobrança recorrente
 *                                                          (metodo ⇒ assinaturas.metodo_cobranca, usado pelo worker)
 *   DELETE /admin/cobranca/clinicas/:clinicaId/assinatura desliga a cobrança recorrente (cobranças existentes ficam)
 *   POST   /admin/cobranca/cobrancas/:id/cancelar         cancela no gateway e aqui (pendente/vencida)
 *   GET    /admin/cobranca/eventos?gateway&pagina&por_pagina   webhooks recebidos (diagnóstico)
 *
 * CLÍNICA (admin da clínica):
 *   GET  /cobrancas/minhas          faturas da própria clínica (request.db.cobranca — só leitura, filtrado pelo tenant), sem payload
 *
 * WEBHOOKS (público, sem JWT):
 *   POST /webhooks/pagamentos/:gateway   (asaas | stripe | mercado_pago) — ver processarWebhook (servico.ts)
 *   URL a configurar no painel do gateway: `${env.API_URL_PUBLICA}/webhooks/pagamentos/<gateway>`.
 */
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import type { GatewayPagamento as RegistroGateway, Prisma, ProvedorPagamento } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { autenticarAdmin, exigirPapel } from '../../plugins/auth';
import {
  carregarConfigGateway,
  credencialPrincipal,
  NOMES_PROVEDORES,
  obterGateway,
  opcoesDoRegistro,
  PROVEDORES_PAGAMENTO,
  separarArmazenado,
  urlWebhook,
  type CredenciaisArmazenadas,
} from '../../servicos/pagamentos';
import { dataSemHora } from '../../servicos/financeiroComum';
import { criptografar, criptografarJson, descriptografarJson, ErroCripto, finalSegredo } from '../../utils/cripto';
import { ErroNegocio, ou404 } from '../../utils/erros';
import {
  ativarCobrancaAutomatica,
  cancelarCobranca,
  desativarCobrancaAutomatica,
  gerarCobranca,
  processarWebhook,
  resumoAssinatura,
  serializarCobranca,
} from './servico';

export const prefixo = '';

declare module 'fastify' {
  interface FastifyRequest {
    /** Corpo cru da requisição (só nas rotas de webhook de pagamento — validação HMAC). */
    corpoCru?: string;
  }
}

// ----------------------------------------------------------------------------- esquemas

const provedor = z.enum(['asaas', 'stripe', 'mercado_pago'], { error: 'Gateway inválido' });
const metodo = z.enum(['pix', 'boleto', 'cartao'], { error: 'Método inválido (pix, boleto ou cartão)' });
const statusCobranca = z.enum(['pendente', 'paga', 'vencida', 'cancelada', 'estornada'], { error: 'Status inválido' });
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)');
const segredo = z.string().trim().max(1000, 'Valor muito longo');

const ParamsProvedor = z.object({ provedor });
const ParamsClinica = z.object({ clinicaId: z.uuid('Clínica inválida') });
const ParamsId = z.object({ id: z.uuid('Identificador inválido') });

const CorpoGateway = z.object({
  ambiente: z.enum(['sandbox', 'producao'], { error: 'Ambiente inválido (sandbox ou produção)' }).optional(),
  credenciais: z
    .object({
      api_key: segredo.optional(),
      secret_key: segredo.optional(),
      publishable_key: segredo.optional(),
      access_token: segredo.optional(),
      public_key: segredo.optional(),
    })
    .optional(),
  segredo_webhook: z.union([segredo, z.null()]).optional(),
  dias_tolerancia: z.number().int('Use um número inteiro').min(0, 'Mínimo 0 dias').max(60, 'Máximo 60 dias').optional(),
  metodos: z.array(metodo).min(1, 'Selecione ao menos um método').optional(),
  dia_vencimento_padrao: z.number().int().min(1, 'Dia entre 1 e 28').max(28, 'Dia entre 1 e 28').optional(),
  descricao_cobranca: z.string().trim().min(3, 'Descrição muito curta').max(200, 'Máximo de 200 caracteres').optional(),
});

const ConsultaCobrancas = z.object({
  status: statusCobranca.optional(),
  clinica_id: z.uuid('Clínica inválida').optional(),
  de: dataIso.optional(),
  ate: dataIso.optional(),
  pagina: z.coerce.number().int().min(1, 'Página inválida').default(1),
  por_pagina: z.coerce.number().int().min(1).max(100, 'Máximo de 100 por página').default(20),
});

const CorpoNovaCobranca = z.object({
  vencimento: dataIso,
  valor: z.number().positive('Valor deve ser maior que zero').max(1_000_000, 'Valor muito alto').optional(),
  descricao: z.string().trim().max(200, 'Máximo de 200 caracteres').optional(),
  metodo: metodo.optional(),
});

const CorpoCobrancaAutomatica = z.object({
  dia_vencimento: z.number().int().min(1, 'Dia entre 1 e 28').max(28, 'Dia entre 1 e 28'),
  metodo: metodo.optional(),
  gerar_agora: z.boolean().optional(),
});

const ConsultaEventos = z.object({
  gateway: provedor.optional(),
  pagina: z.coerce.number().int().min(1, 'Página inválida').default(1),
  por_pagina: z.coerce.number().int().min(1).max(100, 'Máximo de 100 por página').default(20),
});

// ----------------------------------------------------------------------------- gateways (visão sem segredos)

function lerArmazenado(g: RegistroGateway | null | undefined): { json: CredenciaisArmazenadas | null; ilegivel: boolean } {
  if (!g?.credenciais_cifradas) return { json: null, ilegivel: false };
  try {
    return { json: descriptografarJson<CredenciaisArmazenadas>(g.credenciais_cifradas), ilegivel: false };
  } catch (e) {
    if (e instanceof ErroCripto) return { json: null, ilegivel: true };
    throw e;
  }
}

function visaoGateway(p: ProvedorPagamento, g: RegistroGateway | null | undefined) {
  const { json, ilegivel } = lerArmazenado(g);
  const { credenciais } = separarArmazenado(json);
  const opcoes = opcoesDoRegistro(g);
  return {
    provedor: p,
    nome: NOMES_PROVEDORES[p],
    configurado: !!credenciais,
    credenciais_ilegiveis: ilegivel,
    ambiente: g?.ambiente ?? 'sandbox',
    ativo: g?.ativo ?? false,
    credenciais_final: credenciais ? (g?.credenciais_final ?? '') : null,
    segredo_webhook_configurado: !!g?.segredo_webhook_cifrado,
    segredo_webhook_final: g?.segredo_webhook_cifrado ? (g.segredo_webhook_final ?? '') : null,
    dias_tolerancia: g?.dias_tolerancia ?? 5,
    metodos: g?.metodos ?? ['pix', 'boleto'],
    dia_vencimento_padrao: opcoes.dia_vencimento_padrao,
    descricao_cobranca: opcoes.descricao_cobranca,
    url_webhook: urlWebhook(p),
    atualizado_em: g?.atualizado_em ?? null,
  };
}

async function obterVisao(p: ProvedorPagamento) {
  return visaoGateway(p, await prisma.gatewayPagamento.findUnique({ where: { provedor: p } }));
}

type CorpoGatewayT = z.infer<typeof CorpoGateway>;

/** Mescla credenciais: campo vazio/ausente mantém o valor salvo. */
function mesclarCredenciais(
  p: ProvedorPagamento,
  atual: CredenciaisArmazenadas | null,
  novas: CorpoGatewayT['credenciais'],
): Record<string, string> {
  const campos: Record<ProvedorPagamento, string[]> = {
    asaas: ['api_key'],
    stripe: ['secret_key', 'publishable_key'],
    mercado_pago: ['access_token', 'public_key'],
  };
  const base = (atual && atual.provedor === p ? atual : {}) as Record<string, unknown>;
  const r: Record<string, string> = {};
  for (const campo of campos[p]) {
    const novo = (novas as Record<string, string | undefined> | undefined)?.[campo];
    const valor = novo && novo.length ? novo : base[campo];
    if (typeof valor === 'string' && valor) r[campo] = valor;
  }
  return r;
}

function validarCredenciais(p: ProvedorPagamento, cred: Record<string, string>, ambiente: 'sandbox' | 'producao', webhook: string | null) {
  if (p === 'stripe') {
    const sk = cred.secret_key;
    if (sk) {
      if (!/^(sk|rk)_(test|live)_\w+$/.test(sk)) {
        throw new ErroNegocio(400, 'credencial_invalida', 'A secret key do Stripe deve começar com sk_test_ ou sk_live_.');
      }
      const teste = /^(sk|rk)_test_/.test(sk);
      if (teste && ambiente === 'producao') {
        throw new ErroNegocio(400, 'ambiente_incompativel', 'A chave sk_test_ é de teste: selecione o ambiente sandbox.');
      }
      if (!teste && ambiente === 'sandbox') {
        throw new ErroNegocio(400, 'ambiente_incompativel', 'A chave sk_live_ é de produção: selecione o ambiente produção.');
      }
    }
    if (webhook && !webhook.startsWith('whsec_')) {
      throw new ErroNegocio(400, 'credencial_invalida', 'O signing secret do webhook do Stripe começa com whsec_.');
    }
  }
  if (webhook !== null && webhook.length < 8) {
    throw new ErroNegocio(400, 'credencial_invalida', 'O segredo do webhook deve ter pelo menos 8 caracteres.');
  }
}

async function salvarGateway(p: ProvedorPagamento, corpo: CorpoGatewayT) {
  const atual = await prisma.gatewayPagamento.findUnique({ where: { provedor: p } });
  const { json } = lerArmazenado(atual);
  const ambiente = corpo.ambiente ?? atual?.ambiente ?? 'sandbox';
  const cred = mesclarCredenciais(p, json, corpo.credenciais);
  const webhookNovo = typeof corpo.segredo_webhook === 'string' && corpo.segredo_webhook.length ? corpo.segredo_webhook : null;
  validarCredenciais(p, cred, ambiente, webhookNovo);

  const metodos = corpo.metodos ? [...new Set(corpo.metodos)] : undefined;
  if (p === 'stripe' && metodos && !metodos.some((m) => m !== 'pix')) {
    throw new ErroNegocio(400, 'metodo_nao_suportado', 'O Stripe não oferece Pix em faturas: habilite cartão e/ou boleto.');
  }

  // Só credenciais no JSON cifrado; opções gerais em colunas próprias.
  const armazenado = { ...cred, provedor: p } as CredenciaisArmazenadas;
  const principal = credencialPrincipal(armazenado);

  const dados: Prisma.GatewayPagamentoUncheckedUpdateInput = {
    ambiente,
    credenciais_cifradas: criptografarJson(armazenado),
    credenciais_final: principal ? finalSegredo(principal) || null : null,
    ...(corpo.dias_tolerancia !== undefined && { dias_tolerancia: corpo.dias_tolerancia }),
    ...(metodos && { metodos }),
    ...(corpo.dia_vencimento_padrao !== undefined && { dia_vencimento_padrao: corpo.dia_vencimento_padrao }),
    ...(corpo.descricao_cobranca !== undefined && { descricao_cobranca: corpo.descricao_cobranca }),
    ...(webhookNovo && { segredo_webhook_cifrado: criptografar(webhookNovo), segredo_webhook_final: finalSegredo(webhookNovo) || null }),
    ...(corpo.segredo_webhook === null && { segredo_webhook_cifrado: null, segredo_webhook_final: null }),
  };
  await prisma.gatewayPagamento.upsert({
    where: { provedor: p },
    create: { ...(dados as Prisma.GatewayPagamentoUncheckedCreateInput), provedor: p },
    update: dados,
  });
}

// ----------------------------------------------------------------------------- módulo

const modulo: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- super admin
  await app.register(async (base) => {
    const admin = base.withTypeProvider<ZodTypeProvider>();
    admin.addHook('onRequest', autenticarAdmin);

    admin.get('/admin/cobranca/gateways', async () => {
      const registros = await prisma.gatewayPagamento.findMany();
      return PROVEDORES_PAGAMENTO.map((p) => visaoGateway(p, registros.find((r) => r.provedor === p)));
    });

    admin.put('/admin/cobranca/gateways/:provedor', { schema: { params: ParamsProvedor, body: CorpoGateway } }, async (request) => {
      const p = request.params.provedor;
      await salvarGateway(p, request.body);
      request.log.info({ gateway: p, admin: request.adminPlataforma?.id }, 'Configuração do gateway de pagamento alterada');
      return obterVisao(p);
    });

    admin.post('/admin/cobranca/gateways/:provedor/ativar', { schema: { params: ParamsProvedor } }, async (request) => {
      const p = request.params.provedor;
      const visao = await obterVisao(p);
      if (!visao.configurado) {
        throw new ErroNegocio(409, 'gateway_nao_configurado', `Salve as credenciais do ${visao.nome} antes de ativá-lo.`);
      }
      await prisma.$transaction(async (tx) => {
        await tx.gatewayPagamento.updateMany({ where: { ativo: true, provedor: { not: p } }, data: { ativo: false } });
        await tx.gatewayPagamento.update({ where: { provedor: p }, data: { ativo: true } });
      });
      request.log.info({ gateway: p, admin: request.adminPlataforma?.id }, 'Gateway de pagamento ativado');
      return obterVisao(p);
    });

    admin.post('/admin/cobranca/gateways/:provedor/desativar', { schema: { params: ParamsProvedor } }, async (request) => {
      const p = request.params.provedor;
      await prisma.gatewayPagamento.updateMany({ where: { provedor: p }, data: { ativo: false } });
      request.log.info({ gateway: p, admin: request.adminPlataforma?.id }, 'Gateway de pagamento desativado');
      return obterVisao(p);
    });

    admin.post('/admin/cobranca/gateways/:provedor/testar', { schema: { params: ParamsProvedor } }, async (request) => {
      const p = request.params.provedor;
      let gw;
      try {
        if (!(await carregarConfigGateway(p))) {
          return { ok: false, mensagem: `Salve as credenciais do ${NOMES_PROVEDORES[p]} antes de testar a conexão.` };
        }
        gw = await obterGateway(p);
      } catch (e) {
        if (e instanceof ErroCripto) {
          return {
            ok: false,
            mensagem: 'Não foi possível decifrar as credenciais salvas (a CHAVE_CRIPTOGRAFIA mudou?). Cadastre-as novamente.',
          };
        }
        throw e;
      }
      if (!gw) return { ok: false, mensagem: `Salve as credenciais do ${NOMES_PROVEDORES[p]} antes de testar a conexão.` };
      const r = await gw.testarConexao();
      request.log.info({ gateway: p, ok: r.ok }, 'Teste de conexão com gateway de pagamento');
      return r;
    });

    admin.get('/admin/cobranca/cobrancas', { schema: { querystring: ConsultaCobrancas } }, async (request) => {
      const q = request.query;
      const base: Prisma.CobrancaWhereInput = {
        ...(q.clinica_id && { clinica_id: q.clinica_id }),
        ...((q.de || q.ate) && {
          vencimento: { ...(q.de && { gte: dataSemHora(q.de) }), ...(q.ate && { lte: dataSemHora(q.ate) }) },
        }),
      };
      const where: Prisma.CobrancaWhereInput = { ...base, ...(q.status && { status: q.status }) };
      const [itens, total, porStatus] = await Promise.all([
        prisma.cobranca.findMany({
          where,
          omit: { payload: true },
          include: { clinica: { select: { id: true, nome: true, email: true } } },
          orderBy: [{ vencimento: 'desc' }, { criado_em: 'desc' }],
          skip: (q.pagina - 1) * q.por_pagina,
          take: q.por_pagina,
        }),
        prisma.cobranca.count({ where }),
        prisma.cobranca.groupBy({ by: ['status'], where: base, _sum: { valor: true }, _count: { _all: true } }),
      ]);
      const soma = (s: string) => porStatus.find((g) => g.status === s)?._sum.valor?.toFixed(2) ?? '0.00';
      const qtd = (s: string) => porStatus.find((g) => g.status === s)?._count._all ?? 0;
      return {
        itens: itens.map((c) => ({ ...serializarCobranca(c), clinica: c.clinica })),
        total,
        pagina: q.pagina,
        porPagina: q.por_pagina,
        totais: {
          recebido: soma('paga'),
          pendente: soma('pendente'),
          vencido: soma('vencida'),
          quantidade: { paga: qtd('paga'), pendente: qtd('pendente'), vencida: qtd('vencida') },
        },
      };
    });

    admin.get('/admin/cobranca/clinicas/:clinicaId', { schema: { params: ParamsClinica } }, async (request) => {
      const { clinicaId } = request.params;
      const clinica = ou404(
        await prisma.clinica.findUnique({ where: { id: clinicaId }, select: { id: true, nome: true, email: true, documento: true } }),
        'Clínica não encontrada.',
      );
      const cobrancas = await prisma.cobranca.findMany({
        where: { clinica_id: clinicaId },
        omit: { payload: true },
        orderBy: { vencimento: 'desc' },
        take: 12,
      });
      return { clinica, assinatura: await resumoAssinatura(clinicaId), cobrancas: cobrancas.map(serializarCobranca) };
    });

    admin.post(
      '/admin/cobranca/clinicas/:clinicaId/cobrancas',
      { schema: { params: ParamsClinica, body: CorpoNovaCobranca } },
      async (request, reply) => {
        const cobranca = await gerarCobranca({ clinicaId: request.params.clinicaId, ...request.body });
        request.log.info(
          { clinicaId: request.params.clinicaId, cobranca: cobranca.id, admin: request.adminPlataforma?.id },
          'Cobrança gerada pelo super admin',
        );
        return reply.code(201).send(cobranca);
      },
    );

    admin.post(
      '/admin/cobranca/clinicas/:clinicaId/assinatura',
      { schema: { params: ParamsClinica, body: CorpoCobrancaAutomatica } },
      async (request) => {
        const r = await ativarCobrancaAutomatica({
          clinicaId: request.params.clinicaId,
          diaVencimento: request.body.dia_vencimento,
          metodo: request.body.metodo,
          gerarAgora: request.body.gerar_agora,
        });
        request.log.info({ clinicaId: request.params.clinicaId, admin: request.adminPlataforma?.id }, 'Cobrança automática ativada');
        return r;
      },
    );

    admin.delete('/admin/cobranca/clinicas/:clinicaId/assinatura', { schema: { params: ParamsClinica } }, async (request) => {
      const r = await desativarCobrancaAutomatica(request.params.clinicaId);
      request.log.info({ clinicaId: request.params.clinicaId, admin: request.adminPlataforma?.id }, 'Cobrança automática desativada');
      return r;
    });

    admin.post('/admin/cobranca/cobrancas/:id/cancelar', { schema: { params: ParamsId } }, async (request) => {
      const r = await cancelarCobranca(request.params.id);
      request.log.info({ cobranca: request.params.id, admin: request.adminPlataforma?.id }, 'Cobrança cancelada pelo super admin');
      return r;
    });

    admin.get('/admin/cobranca/eventos', { schema: { querystring: ConsultaEventos } }, async (request) => {
      const q = request.query;
      const where: Prisma.EventoGatewayWhereInput = q.gateway ? { gateway: q.gateway } : {};
      const [itens, total] = await Promise.all([
        prisma.eventoGateway.findMany({
          where,
          orderBy: { recebido_em: 'desc' },
          skip: (q.pagina - 1) * q.por_pagina,
          take: q.por_pagina,
        }),
        prisma.eventoGateway.count({ where }),
      ]);
      return { itens, total, pagina: q.pagina, porPagina: q.por_pagina };
    });
  });

  // ---------------------------------------------------------------- clínica
  await app.register(async (base) => {
    const clinica = base.withTypeProvider<ZodTypeProvider>();
    clinica.addHook('onRequest', exigirPapel('admin'));

    clinica.get('/cobrancas/minhas', async (request) => {
      const itens = await request.db.cobranca.findMany({
        omit: { payload: true },
        orderBy: [{ vencimento: 'desc' }, { criado_em: 'desc' }],
        take: 100,
      });
      return itens.map((c) => {
        const s = serializarCobranca(c);
        // Link só enquanto dá para pagar.
        return { ...s, link_pagamento: s.status === 'pendente' || s.status === 'vencida' ? s.link_pagamento : null };
      });
    });
  });

  // ---------------------------------------------------------------- webhooks (corpo cru neste escopo)
  await app.register(async (base) => {
    const webhooks = base.withTypeProvider<ZodTypeProvider>();
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

    webhooks.post('/webhooks/pagamentos/:gateway', { schema: { params: z.object({ gateway: provedor }) } }, async (request, reply) => {
      const r = await processarWebhook(request.params.gateway, {
        corpoCru: request.corpoCru ?? '',
        corpo: request.body ?? null,
        cabecalhos: request.headers,
        query: (request.query ?? {}) as Record<string, unknown>,
      });
      request.log.info({ gateway: request.params.gateway, status: r.status }, 'Webhook de pagamento recebido');
      return reply.code(r.status).send(r.corpo);
    });
  });
};

export default modulo;
