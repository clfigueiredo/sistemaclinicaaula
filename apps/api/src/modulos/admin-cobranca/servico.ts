/**
 * Regras da cobrança automática do SaaS (plataforma — prisma CRU). Usado pelas rotas do módulo e pelo
 * worker diário (workers/cobrancas.ts).
 *
 * DECISÕES
 *   - Recorrência: o NOSSO worker gera uma cobrança avulsa por ciclo (mensal) no gateway ativo, para os três
 *     gateways. Assim Pix/boleto/cartão, tolerância, cancelamento e histórico funcionam igual em todos, sem
 *     depender da recorrência nativa de cada um (os adaptadores implementam `criarAssinatura`, mas o fluxo não usa).
 *   - Cobrança automática de uma clínica = `assinaturas.gateway` + `assinaturas.dia_vencimento` preenchidos
 *     (POST /admin/cobranca/clinicas/:id/assinatura). A cobrança do ciclo é gerada até
 *     ANTECEDENCIA_GERACAO_DIAS antes do vencimento; nunca mais de uma por mês (qualquer status — uma cobrança
 *     cancelada pelo super admin significa "não cobrar este mês").
 *   - Tolerância: cobrança em aberto (pendente/vencida) há MAIS de `dias_tolerancia` dias do vencimento ⇒
 *     assinatura `ativa` → `vencida` (somente leitura; volta a `ativa` sozinha quando o pagamento é confirmado).
 *     Não usamos `bloqueada`: esse status fica reservado para bloqueio manual do super admin.
 *   - Pagamento confirmado ⇒ cobrança `paga` + `pago_em`; assinatura `ativa` (exceto se `cancelada`/`bloqueada`
 *     manualmente) e `expira_em` = fim do ciclo pago (vencimento + 1 mês) + dias de tolerância. Se o worker
 *     parar, a expiração ainda leva a clínica para somente leitura (statusEfetivo) — nunca antes do prazo.
 *   - Estorno/cancelamento/vencimento vindos do gateway só mudam o status da cobrança.
 *   - Sem gateway ativo: nada é gerado (o worker só registra no log); nada quebra.
 */
import { Prisma, type Cobranca, type MetodoCobranca, type ProvedorPagamento, type StatusCobranca } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import {
  ErroGatewayPagamento,
  obterGateway,
  obterGatewayComConfig,
  provedorAtivo,
  type EventoPagamento,
  type GatewayPagamento,
  type RequisicaoWebhook,
} from '../../servicos/pagamentos';
import { NOMES_GATEWAY } from '../../servicos/pagamentos/http';
import { dataSemHora, hojeNoFuso, paraDataIso } from '../../servicos/financeiroComum';
import { ErroNegocio, ou404 } from '../../utils/erros';

export const ANTECEDENCIA_GERACAO_DIAS = 10;
export const TOLERANCIA_PADRAO_DIAS = 5;
const STATUS_EM_ABERTO: StatusCobranca[] = ['pendente', 'vencida'];

// ----------------------------------------------------------------------------- datas ('YYYY-MM-DD')

export function hojeIso(agora = new Date()): string {
  return hojeNoFuso(env.TZ_PADRAO, agora);
}

export function somarDias(iso: string, dias: number): string {
  const d = dataSemHora(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraDataIso(d);
}

function diasNoMes(ano: number, mes1a12: number): number {
  return new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();
}

/** Soma meses mantendo o dia (limitado ao último dia do mês). */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const dia = Math.min(d, diasNoMes(ano, mes));
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Próximo vencimento (hoje ou depois) no dia do mês informado (1–28). */
export function proximoVencimento(hoje: string, dia: number): string {
  const esteMes = `${hoje.slice(0, 8)}${String(dia).padStart(2, '0')}`;
  return esteMes >= hoje ? esteMes : somarMeses(esteMes, 1);
}

export function diferencaDias(de: string, ate: string): number {
  return Math.round((dataSemHora(ate).getTime() - dataSemHora(de).getTime()) / 86_400_000);
}

function limitesDoMes(iso: string): { gte: Date; lte: Date } {
  const inicio = `${iso.slice(0, 8)}01`;
  return { gte: dataSemHora(inicio), lte: dataSemHora(somarDias(somarMeses(inicio, 1), -1)) };
}

/** Fim do dia (23:59:59.999) no fuso padrão da plataforma. */
function fimDoDia(iso: string): Date {
  return fromZonedTime(`${iso}T23:59:59.999`, env.TZ_PADRAO);
}

export function montarDescricao(modelo: string, plano: string, vencimento: string): string {
  const competencia = `${vencimento.slice(5, 7)}/${vencimento.slice(0, 4)}`;
  return modelo.replaceAll('{plano}', plano).replaceAll('{competencia}', competencia).slice(0, 500);
}

// ----------------------------------------------------------------------------- serialização

export type CobrancaSerializada = ReturnType<typeof serializarCobranca>;

export function serializarCobranca(c: Omit<Cobranca, 'payload'> & { payload?: unknown }) {
  return {
    id: c.id,
    clinica_id: c.clinica_id,
    assinatura_id: c.assinatura_id,
    gateway: c.gateway,
    id_externo: c.id_externo,
    descricao: c.descricao,
    valor: c.valor.toFixed(2),
    vencimento: paraDataIso(c.vencimento),
    status: c.status,
    metodo: c.metodo,
    link_pagamento: c.link_pagamento,
    pago_em: c.pago_em,
    criado_em: c.criado_em,
    atualizado_em: c.atualizado_em,
  };
}

/** Converte erro de gateway em erro HTTP amigável (502 = o gateway recusou; 503 = indisponível). */
export function traduzirErroGateway(e: unknown): never {
  if (e instanceof ErroGatewayPagamento) {
    throw new ErroNegocio(e.temporario ? 503 : 502, e.temporario ? 'gateway_indisponivel' : 'erro_gateway', e.message, {
      gateway: e.provedor,
    });
  }
  throw e;
}

// ----------------------------------------------------------------------------- cliente e cobrança

async function carregarClinicaParaCobranca(clinicaId: string) {
  const clinica = ou404(
    await prisma.clinica.findUnique({
      where: { id: clinicaId },
      include: { assinatura: { include: { plano: { select: { id: true, nome: true, preco: true } } } } },
    }),
    'Clínica não encontrada.',
  );
  if (!clinica.assinatura) {
    throw new ErroNegocio(409, 'sem_assinatura', 'A clínica não tem assinatura. Atribua um plano antes de cobrar.');
  }
  return { clinica, assinatura: clinica.assinatura };
}

type ClinicaComAssinatura = Awaited<ReturnType<typeof carregarClinicaParaCobranca>>;

/** Cliente da clínica no gateway (cria na primeira vez ou ao trocar de gateway). */
async function garantirCliente({ clinica, assinatura }: ClinicaComAssinatura, gateway: GatewayPagamento): Promise<string> {
  if (assinatura.gateway === gateway.provedor && assinatura.cliente_externo_id) return assinatura.cliente_externo_id;
  let clienteExternoId: string;
  try {
    ({ clienteExternoId } = await gateway.criarCliente({
      clinicaId: clinica.id,
      nome: clinica.nome,
      documento: clinica.documento,
      email: clinica.email,
      telefone: clinica.telefone,
    }));
  } catch (e) {
    traduzirErroGateway(e);
  }
  await prisma.assinatura.update({
    where: { id: assinatura.id },
    data: {
      gateway: gateway.provedor,
      cliente_externo_id: clienteExternoId,
      // Assinatura externa é de outro gateway: não vale mais.
      ...(assinatura.gateway !== gateway.provedor && { assinatura_externa_id: null }),
    },
  });
  assinatura.gateway = gateway.provedor;
  assinatura.cliente_externo_id = clienteExternoId;
  return clienteExternoId;
}

async function exigirGatewayAtivo() {
  const provedor = await provedorAtivo();
  if (!provedor) {
    throw new ErroNegocio(
      409,
      'gateway_inativo',
      'Nenhum gateway de pagamento está ativo. Configure e ative um gateway na aba "Gateways".',
    );
  }
  const gc = await obterGatewayComConfig(provedor);
  if (!gc) {
    throw new ErroNegocio(409, 'gateway_nao_configurado', `O gateway ${NOMES_GATEWAY[provedor]} está ativo, mas sem credenciais.`);
  }
  return gc;
}

export type DadosNovaCobranca = {
  clinicaId: string;
  vencimento: string;
  valor?: number;
  descricao?: string;
  metodo?: MetodoCobranca;
};

/**
 * Gera uma cobrança no gateway ATIVO: grava a cobrança local (pendente), cria no gateway com
 * `referencia` = id local e completa com id externo + link. Falha no gateway ⇒ nada fica gravado.
 */
export async function gerarCobranca(dados: DadosNovaCobranca, hoje = hojeIso()) {
  const { gateway, config } = await exigirGatewayAtivo();
  const ctx = await carregarClinicaParaCobranca(dados.clinicaId);
  const { assinatura } = ctx;

  if (dados.vencimento < hoje) throw new ErroNegocio(400, 'vencimento_passado', 'O vencimento não pode ser anterior a hoje.');
  const valor = Math.round((dados.valor ?? assinatura.plano.preco.toNumber()) * 100) / 100;
  if (!(valor > 0)) {
    throw new ErroNegocio(400, 'valor_invalido', 'Informe um valor maior que zero (o plano da clínica é gratuito).');
  }
  if (dados.metodo && !config.metodos.includes(dados.metodo)) {
    throw new ErroNegocio(400, 'metodo_nao_permitido', 'Este método de pagamento não está habilitado no gateway ativo.');
  }
  const descricao =
    dados.descricao?.trim() || montarDescricao(config.opcoes.descricao_cobranca, assinatura.plano.nome, dados.vencimento);

  const clienteExternoId = await garantirCliente(ctx, gateway);

  const local = await prisma.cobranca.create({
    data: {
      clinica_id: dados.clinicaId,
      assinatura_id: assinatura.id,
      gateway: gateway.provedor,
      descricao,
      valor,
      vencimento: dataSemHora(dados.vencimento),
      metodo: dados.metodo ?? null,
      status: 'pendente',
    },
  });

  try {
    const r = await gateway.criarCobranca({
      clienteExternoId,
      valor,
      vencimento: dados.vencimento,
      descricao,
      metodo: dados.metodo,
      referencia: local.id,
    });
    const atualizada = await prisma.cobranca.update({
      where: { id: local.id },
      data: {
        id_externo: r.idExterno,
        link_pagamento: r.linkPagamento,
        status: r.status === 'paga' ? 'paga' : 'pendente',
        payload: (r.bruto ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    return serializarCobranca(atualizada);
  } catch (e) {
    await prisma.cobranca.delete({ where: { id: local.id } }).catch(() => undefined);
    traduzirErroGateway(e);
  }
}

/** Já existe cobrança (qualquer status) da clínica no mês desse vencimento? */
async function existeCobrancaNoMes(clinicaId: string, vencimento: string): Promise<boolean> {
  const n = await prisma.cobranca.count({ where: { clinica_id: clinicaId, vencimento: limitesDoMes(vencimento) } });
  return n > 0;
}

export type DadosCobrancaAutomatica = { clinicaId: string; diaVencimento: number; metodo?: MetodoCobranca; gerarAgora?: boolean };

/**
 * Liga a cobrança automática de uma clínica no gateway ativo (cliente no gateway + dia de vencimento) e,
 * se `gerarAgora`, já gera a cobrança do próximo vencimento (se ainda não houver uma naquele mês).
 * Pode ser chamada por outros módulos (ex.: ao atribuir um plano pago no admin-clinicas).
 */
export async function ativarCobrancaAutomatica(dados: DadosCobrancaAutomatica, hoje = hojeIso()) {
  const { gateway } = await exigirGatewayAtivo();
  const ctx = await carregarClinicaParaCobranca(dados.clinicaId);
  if (!(ctx.assinatura.plano.preco.toNumber() > 0)) {
    throw new ErroNegocio(409, 'plano_gratuito', 'O plano da clínica é gratuito: não há o que cobrar.');
  }
  await garantirCliente(ctx, gateway);
  await prisma.assinatura.update({ where: { id: ctx.assinatura.id }, data: { dia_vencimento: dados.diaVencimento } });

  let cobranca: CobrancaSerializada | null = null;
  if (dados.gerarAgora !== false) {
    const vencimento = proximoVencimento(hoje, dados.diaVencimento);
    if (!(await existeCobrancaNoMes(dados.clinicaId, vencimento))) {
      cobranca = (await gerarCobranca({ clinicaId: dados.clinicaId, vencimento, metodo: dados.metodo }, hoje)) ?? null;
    }
  }
  return { assinatura: await resumoAssinatura(dados.clinicaId), cobranca };
}

export async function desativarCobrancaAutomatica(clinicaId: string) {
  const { assinatura } = await carregarClinicaParaCobranca(clinicaId);
  await prisma.assinatura.update({ where: { id: assinatura.id }, data: { dia_vencimento: null } });
  return { assinatura: await resumoAssinatura(clinicaId) };
}

export async function resumoAssinatura(clinicaId: string) {
  const a = await prisma.assinatura.findUnique({
    where: { clinica_id: clinicaId },
    include: { plano: { select: { id: true, nome: true, preco: true } } },
  });
  if (!a) return null;
  return {
    id: a.id,
    status: a.status,
    expira_em: a.expira_em,
    gateway: a.gateway,
    dia_vencimento: a.dia_vencimento,
    cobranca_automatica: !!(a.gateway && a.dia_vencimento),
    cliente_no_gateway: !!a.cliente_externo_id,
    plano: { id: a.plano.id, nome: a.plano.nome, preco: a.plano.preco.toFixed(2) },
  };
}

export async function cancelarCobranca(id: string) {
  const c = ou404(await prisma.cobranca.findUnique({ where: { id } }), 'Cobrança não encontrada.');
  if (!STATUS_EM_ABERTO.includes(c.status)) {
    throw new ErroNegocio(409, 'cobranca_nao_cancelavel', 'Só é possível cancelar cobranças pendentes ou vencidas.');
  }
  if (c.id_externo) {
    const gw = await obterGateway(c.gateway);
    if (gw) {
      try {
        await gw.cancelar({ tipo: 'cobranca', idExterno: c.id_externo });
      } catch (e) {
        traduzirErroGateway(e);
      }
    }
    // Gateway não configurado mais: cancela só aqui (o link antigo continua no gateway).
  }
  const atualizada = await prisma.cobranca.update({ where: { id }, data: { status: 'cancelada' } });
  return serializarCobranca(atualizada);
}

// ----------------------------------------------------------------------------- webhook

export type RespostaWebhook = { status: number; corpo: Record<string, unknown> };

/**
 * Processa um webhook: autenticidade ⇒ normalização ⇒ idempotência (eventos_gateway) ⇒ efeito.
 * Responde 200 para todo evento autêntico (mesmo ignorado), 401 se não autêntico e 5xx se o efeito
 * falhar (o gateway reenvia; o evento com `erro` e sem `processado_em` é reprocessado).
 */
export async function processarWebhook(provedor: ProvedorPagamento, req: RequisicaoWebhook): Promise<RespostaWebhook> {
  const naoAutenticado: RespostaWebhook = {
    status: 401,
    corpo: { erro: 'webhook_invalido', mensagem: 'Webhook não autenticado.' },
  };
  let gateway: GatewayPagamento | null;
  try {
    gateway = await obterGateway(provedor);
  } catch {
    return naoAutenticado; // credenciais ilegíveis (chave trocada) ⇒ não dá para autenticar
  }
  if (!gateway) return naoAutenticado;

  let evento: EventoPagamento | null;
  try {
    if (!(await gateway.validarWebhook(req))) return naoAutenticado;
    evento = await gateway.interpretarWebhook(req);
  } catch (e) {
    if (e instanceof ErroGatewayPagamento) {
      return { status: 503, corpo: { erro: 'gateway_indisponivel', mensagem: e.message } };
    }
    throw e;
  }
  if (!evento) return { status: 200, corpo: { ignorado: true } };

  // Idempotência: (gateway, id_evento) único.
  let registroId: string;
  try {
    const criado = await prisma.eventoGateway.create({
      data: {
        gateway: provedor,
        id_evento: evento.idEvento.slice(0, 250),
        tipo: evento.tipo.slice(0, 120),
        payload: (evento.bruto ?? {}) as Prisma.InputJsonValue,
      },
    });
    registroId = criado.id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    const existente = await prisma.eventoGateway.findUnique({
      where: { gateway_id_evento: { gateway: provedor, id_evento: evento.idEvento.slice(0, 250) } },
    });
    // Reprocessa só o que falhou antes; o resto (processado ou em andamento) é duplicado.
    if (!existente || existente.processado_em || !existente.erro) return { status: 200, corpo: { duplicado: true } };
    const retomado = await prisma.eventoGateway.updateMany({
      where: { id: existente.id, processado_em: null, erro: existente.erro },
      data: { erro: null },
    });
    if (retomado.count === 0) return { status: 200, corpo: { duplicado: true } };
    registroId = existente.id;
  }

  try {
    const aviso = await aplicarEvento(provedor, evento);
    await prisma.eventoGateway.update({ where: { id: registroId }, data: { processado_em: new Date(), erro: aviso } });
    return { status: 200, corpo: aviso ? { ok: true, aviso } : { ok: true } };
  } catch (e) {
    await prisma.eventoGateway
      .update({ where: { id: registroId }, data: { erro: ((e as Error).message || 'Erro ao processar').slice(0, 500) } })
      .catch(() => undefined);
    throw e;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aplica o efeito do evento. Retorna um aviso (gravado em eventos_gateway.erro) ou null. */
async function aplicarEvento(provedor: ProvedorPagamento, evento: EventoPagamento): Promise<string | null> {
  if (evento.acao === 'ignorar' || evento.acao === 'cobranca_criada') return null;

  return prisma.$transaction(async (tx) => {
    let cobranca: Cobranca | null = null;
    if (evento.cobrancaIdExterno) {
      cobranca = await tx.cobranca.findUnique({
        where: { gateway_id_externo: { gateway: provedor, id_externo: evento.cobrancaIdExterno } },
      });
    }
    if (!cobranca && evento.referencia && UUID.test(evento.referencia)) {
      cobranca = await tx.cobranca.findFirst({ where: { id: evento.referencia, gateway: provedor } });
    }
    if (!cobranca) return 'Cobrança não encontrada para este evento (ignorado).';

    // Trava a linha: dois eventos diferentes da mesma cobrança não se atropelam.
    await tx.$queryRaw`SELECT id FROM cobrancas WHERE id = ${cobranca.id}::uuid FOR UPDATE`;
    cobranca = (await tx.cobranca.findUnique({ where: { id: cobranca.id } }))!;
    const payload = (evento.bruto ?? Prisma.JsonNull) as Prisma.InputJsonValue;

    switch (evento.acao) {
      case 'cobranca_paga': {
        if (cobranca.status !== 'paga') {
          await tx.cobranca.update({
            where: { id: cobranca.id },
            data: { status: 'paga', pago_em: evento.pagoEm ?? new Date(), payload },
          });
        }
        const assinatura = cobranca.assinatura_id
          ? await tx.assinatura.findUnique({ where: { id: cobranca.assinatura_id } })
          : await tx.assinatura.findUnique({ where: { clinica_id: cobranca.clinica_id } });
        if (!assinatura) return null;
        const gw = await tx.gatewayPagamento.findUnique({ where: { provedor }, select: { dias_tolerancia: true } });
        const tolerancia = gw?.dias_tolerancia ?? TOLERANCIA_PADRAO_DIAS;
        const fimCiclo = fimDoDia(somarDias(somarMeses(paraDataIso(cobranca.vencimento), 1), tolerancia));
        const avancar = !assinatura.expira_em || assinatura.expira_em < fimCiclo;
        const manual = assinatura.status === 'cancelada' || assinatura.status === 'bloqueada';
        await tx.assinatura.update({
          where: { id: assinatura.id },
          data: {
            ...(!manual && { status: 'ativa' }),
            ...(avancar && { expira_em: fimCiclo }),
          },
        });
        return manual ? `Pagamento registrado; assinatura mantida como ${assinatura.status} (status definido manualmente).` : null;
      }
      case 'cobranca_vencida':
        if (cobranca.status === 'pendente') {
          await tx.cobranca.update({ where: { id: cobranca.id }, data: { status: 'vencida', payload } });
        }
        return null;
      case 'cobranca_cancelada':
        if (STATUS_EM_ABERTO.includes(cobranca.status)) {
          await tx.cobranca.update({ where: { id: cobranca.id }, data: { status: 'cancelada', payload } });
        }
        return null;
      case 'cobranca_estornada':
        if (cobranca.status !== 'estornada' && cobranca.status !== 'cancelada') {
          await tx.cobranca.update({ where: { id: cobranca.id }, data: { status: 'estornada', payload } });
        }
        return null;
    }
    return null;
  });
}

// ----------------------------------------------------------------------------- job diário

export type ResumoJobCobrancas = {
  processadas: number;
  marcadas_vencidas: number;
  geradas: number;
  assinaturas_vencidas: number;
  erros: number;
  aviso?: string;
};

type Log = { info: (msg: string) => void; warn: (msg: string) => void };

/**
 * Job diário (idempotente — pode rodar várias vezes no mesmo dia):
 *   1. cobranças `pendente` com vencimento < hoje ⇒ `vencida`;
 *   2. gera a cobrança do próximo ciclo das assinaturas com cobrança automática (gateway ativo);
 *   3. tolerância: cobrança em aberto há mais de N dias ⇒ assinatura `ativa` → `vencida`.
 */
export async function executarJobCobrancas(hoje = hojeIso(), log: Log = console): Promise<ResumoJobCobrancas> {
  const resumo: ResumoJobCobrancas = { processadas: 0, marcadas_vencidas: 0, geradas: 0, assinaturas_vencidas: 0, erros: 0 };
  const dataHoje = dataSemHora(hoje);

  // 1. vencidas
  const vencidas = await prisma.cobranca.updateMany({
    where: { status: 'pendente', vencimento: { lt: dataHoje } },
    data: { status: 'vencida' },
  });
  resumo.marcadas_vencidas = vencidas.count;

  // 2. geração do próximo ciclo
  const ativo = await provedorAtivo();
  if (!ativo) {
    resumo.aviso = 'Nenhum gateway de pagamento ativo: nenhuma cobrança gerada.';
    log.info(`[cobrancas] ${resumo.aviso}`);
  } else {
    const assinaturas = await prisma.assinatura.findMany({
      where: {
        gateway: { not: null },
        dia_vencimento: { not: null },
        status: { in: ['ativa', 'vencida'] },
        clinica: { status: 'ativa' },
        plano: { preco: { gt: 0 } },
      },
      select: { clinica_id: true, dia_vencimento: true },
    });
    for (const a of assinaturas) {
      const vencimento = proximoVencimento(hoje, a.dia_vencimento!);
      if (diferencaDias(hoje, vencimento) > ANTECEDENCIA_GERACAO_DIAS) continue;
      resumo.processadas++;
      if (await existeCobrancaNoMes(a.clinica_id, vencimento)) continue;
      try {
        await gerarCobranca({ clinicaId: a.clinica_id, vencimento }, hoje);
        resumo.geradas++;
      } catch (e) {
        resumo.erros++;
        log.warn(`[cobrancas] Falha ao gerar cobrança da clínica ${a.clinica_id}: ${(e as Error).message}`);
      }
    }
  }

  // 3. tolerância
  const tolerancias = new Map(
    (await prisma.gatewayPagamento.findMany({ select: { provedor: true, dias_tolerancia: true } })).map((g) => [
      g.provedor,
      g.dias_tolerancia,
    ]),
  );
  const emAberto = await prisma.cobranca.findMany({
    where: {
      status: { in: STATUS_EM_ABERTO },
      vencimento: { lt: dataHoje },
      clinica: { assinatura: { is: { status: 'ativa' } } },
    },
    select: { clinica_id: true, gateway: true, vencimento: true },
  });
  const estouradas = new Set<string>();
  for (const c of emAberto) {
    const limite = somarDias(paraDataIso(c.vencimento), tolerancias.get(c.gateway) ?? TOLERANCIA_PADRAO_DIAS);
    if (hoje > limite) estouradas.add(c.clinica_id);
  }
  if (estouradas.size) {
    const r = await prisma.assinatura.updateMany({
      where: { clinica_id: { in: [...estouradas] }, status: 'ativa' },
      data: { status: 'vencida' },
    });
    resumo.assinaturas_vencidas = r.count;
    log.info(`[cobrancas] ${r.count} assinatura(s) marcada(s) como vencida(s) por falta de pagamento.`);
  }
  return resumo;
}
